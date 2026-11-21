// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  parseNativeEffectiveRasterColorSamplingBindingProfile,
  parseSensorColorSamplingProfile,
  resolveCaptureModeColorSamplingContributors,
  resolveNativeEffectiveRasterColorSamplingBinding,
  type CaptureModeProfile,
  type GroupedCaptureModeSamplingAnchorDeclaration,
  type NativeEffectiveRasterColorSamplingBindingProfile,
  type SensorColorSamplingProfile
} from "../src/index.js";

type OwnedEvidence = readonly [
  {
    sourceOrigin: "photivra";
    sourceReference: string;
    reuseStatus: "photivra-owned";
  }
];

const evidence = (
  sourceReference: string
): OwnedEvidence =>
  [
    {
      sourceOrigin: "photivra",
      sourceReference,
      reuseStatus: "photivra-owned"
    }
  ] as const;

const nativeRaster = {
  pixelWidth: 8,
  pixelHeight: 6
};

const bayerLikeProfile =
  (): SensorColorSamplingProfile => ({
    schemaVersion: "0.1.0",
    profileId: "bayer-like",
    evidence: evidence("test:bayer-like"),
    coordinateSystem:
      "native-sensor-color-sampling-site-index",
    layout: {
      kind: "periodic-mosaic",
      repeatWidthSites: 2,
      repeatHeightSites: 2,
      siteChannelIds: [
        "red",
        "green",
        "green",
        "blue"
      ],
      anchor: "native-sensor-top-left-site"
    }
  });

const quadLikeProfile =
  (): SensorColorSamplingProfile => ({
    schemaVersion: "0.1.0",
    profileId: "quad-like",
    evidence: evidence("test:quad-like"),
    coordinateSystem:
      "native-sensor-color-sampling-site-index",
    layout: {
      kind: "periodic-mosaic",
      repeatWidthSites: 4,
      repeatHeightSites: 4,
      siteChannelIds: [
        "red", "red", "green", "green",
        "red", "red", "green", "green",
        "green", "green", "blue", "blue",
        "green", "green", "blue", "blue"
      ],
      anchor: "native-sensor-top-left-site"
    }
  });

const binding = (
  profileId = "bayer-like",
  sitesPerNativeSampleX = 1,
  sitesPerNativeSampleY = 1
): NativeEffectiveRasterColorSamplingBindingProfile => ({
  schemaVersion: "0.1.0",
  bindingId: "test-binding",
  colorSamplingProfileId: profileId,
  nativeRaster,
  evidence: evidence("test:binding"),
  relationship: {
    kind: "regular-native-effective-sample-blocks",
    sitesPerNativeSampleX,
    sitesPerNativeSampleY,
    anchor: "shared-native-top-left"
  }
});

const topLeftGroupingAnchor =
  (): GroupedCaptureModeSamplingAnchorDeclaration => ({
    anchor: "native-effective-raster-top-left",
    evidence: evidence("test:group-anchor")
  });

function modeProfile(
  mode: CaptureModeProfile["modes"][number]
): CaptureModeProfile {
  return {
    schemaVersion: "0.1.0",
    modes: [mode]
  };
}

function nativeMode(
  extra: Partial<CaptureModeProfile["modes"][number]> = {}
): CaptureModeProfile["modes"][number] {
  return {
    modeId: "native",
    evidence: evidence("test:native-mode"),
    acquisition: {
      kind: "single-frame"
    },
    perFrameSampling: {
      kind: "native-effective-raster"
    },
    processedImageRaster: {
      value: nativeRaster,
      evidence: evidence("test:native-output")
    },
    dependencies: [
      "color-sampling-model"
    ],
    ...extra
  };
}

function groupedMode(
  profileId = "grouped"
): CaptureModeProfile["modes"][number] {
  return {
    modeId: profileId,
    evidence: evidence("test:" + profileId),
    acquisition: {
      kind: "single-frame"
    },
    perFrameSampling: {
      kind: "grouped-native-samples",
      groupWidthSamples: {
        value: 2,
        evidence: evidence("test:group-width")
      },
      groupHeightSamples: {
        value: 2,
        evidence: evidence("test:group-height")
      },
      combinationDomain: {
        value: "pre-conversion-analog",
        evidence: evidence("test:combination-domain")
      }
    },
    processedImageRaster: {
      value: {
        pixelWidth: 4,
        pixelHeight: 3
      },
      evidence: evidence("test:grouped-output")
    },
    dependencies: [
      "color-sampling-model"
    ]
  };
}

describe("capture mode / color sampling binding", () => {
  it("requires an explicit binding even for a one-to-one relationship", () => {
    const parsed =
      parseNativeEffectiveRasterColorSamplingBindingProfile(
        binding()
      );
    const resolved =
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster,
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: parsed
      });

    expect(resolved.relationshipMeaning).toBe(
      "one-native-effective-sample-to-one-color-site"
    );
    expect(resolved.colorSamplingSiteGrid).toEqual({
      widthSites: 8,
      heightSites: 6
    });
    expect(
      resolved.nativeImageRasterBindingEstablished
    ).toBe(true);
    expect(
      resolved.physicalPhotodiodeBindingEstablished
    ).toBe(false);
  });

  it("binds one native effective sample to an evidenced rectangular color-site block", () => {
    const resolved =
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster,
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(
          "bayer-like",
          2,
          3
        )
      });

    expect(resolved.relationshipMeaning).toBe(
      "one-native-effective-sample-to-rectangular-color-site-block"
    );
    expect(resolved.colorSamplingSiteGrid).toEqual({
      widthSites: 16,
      heightSites: 18
    });
    expect(resolved.totalColorSamplingSites).toBe(
      288
    );
  });

  it("refuses to reuse a binding against a different native effective raster", () => {
    expect(() =>
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster: {
          pixelWidth: 4,
          pixelHeight: 3
        },
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding()
      })
    ).toThrow("must exactly match");
  });

  it("refuses a binding for the wrong color-sampling profile", () => {
    expect(() =>
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster,
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding("different-profile")
      })
    ).toThrow("colorSamplingProfileId");
  });

  it("keeps layered color unbound until per-layer spatial sampling exists", () => {
    const layered =
      parseSensorColorSamplingProfile({
        schemaVersion: "0.1.0",
        profileId: "layered",
        evidence: evidence("test:layered"),
        coordinateSystem:
          "native-sensor-layered-spatial-relationship-not-resolved",
        layout: {
          kind: "layered",
          layerChannelIds: [
            "layer-a",
            "layer-b",
            "layer-c"
          ],
          spatialSamplingRelationship:
            "not-resolved"
        }
      });

    expect(() =>
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster,
        colorSamplingProfile: layered,
        bindingProfile: binding("layered")
      })
    ).toThrow("per-layer spatial sampling");
  });

  it("resolves one native-mode sample to one absolute CFA site without crop-phase reset", () => {
    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          nativeMode()
        ),
        modeId: "native",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 3,
          y: 2
        }
      });

    expect(
      result.modeSampleCoordinateSystem
    ).toBe(
      "capture-mode-full-frame-effective-sample-index"
    );
    expect(result.nativeEffectiveSampleRect).toEqual({
      x: 3,
      y: 2,
      width: 1,
      height: 1
    });
    expect(result.colorSamplingSiteRect).toEqual({
      x: 3,
      y: 2,
      width: 1,
      height: 1
    });
    expect(result.channelComposition).toEqual({
      kind: "single-channel",
      channelId: "green"
    });
    expect(result.channelSiteCounts).toEqual([
      {
        channelId: "green",
        siteCount: 1
      }
    ]);
  });

  it("reports mixed CFA contributors for a grouped Bayer-like sample without inventing weights", () => {
    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          groupedMode()
        ),
        modeId: "grouped",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        },
        groupedSamplingAnchor:
          topLeftGroupingAnchor()
      });

    expect(result.nativeEffectiveSampleRect).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 2
    });
    expect(result.colorSamplingSiteRect).toEqual({
      x: 0,
      y: 0,
      width: 2,
      height: 2
    });
    expect(result.channelSiteCounts).toEqual([
      { channelId: "red", siteCount: 1 },
      { channelId: "green", siteCount: 2 },
      { channelId: "blue", siteCount: 1 }
    ]);
    expect(result.channelComposition).toEqual({
      kind: "mixed-channels",
      channelIds: [
        "red",
        "green",
        "blue"
      ]
    });
    expect(
      result.signalCombinationWeightingEstablished
    ).toBe(false);
    expect(
      result.grouping?.combinationDomain?.value
    ).toBe("pre-conversion-analog");
  });

  it("recognizes same-channel 2x2 groups in a Quad-Bayer-like topology without assuming signal math", () => {
    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          groupedMode("quad-grouped")
        ),
        modeId: "quad-grouped",
        colorSamplingProfile: quadLikeProfile(),
        bindingProfile: binding(
          "quad-like"
        ),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        },
        groupedSamplingAnchor:
          topLeftGroupingAnchor()
      });

    expect(result.channelSiteCounts).toEqual([
      {
        channelId: "red",
        siteCount: 4
      }
    ]);
    expect(result.channelComposition).toEqual({
      kind: "single-channel",
      channelId: "red"
    });
    expect(
      result.signalCombinationWeightingEstablished
    ).toBe(false);
  });

  it("preserves nonzero periodic phase for later full-frame grouped samples", () => {
    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          groupedMode()
        ),
        modeId: "grouped",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 1,
          y: 1
        },
        groupedSamplingAnchor:
          topLeftGroupingAnchor()
      });

    expect(result.nativeEffectiveSampleRect).toEqual({
      x: 2,
      y: 2,
      width: 2,
      height: 2
    });
    expect(result.colorSamplingSiteRect).toEqual({
      x: 2,
      y: 2,
      width: 2,
      height: 2
    });
    expect(result.channelSiteCounts).toEqual([
      { channelId: "red", siteCount: 1 },
      { channelId: "green", siteCount: 2 },
      { channelId: "blue", siteCount: 1 }
    ]);
  });

  it("requires separate evidence for grouped-mode origin instead of inferring top-left phase", () => {
    expect(() =>
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          groupedMode()
        ),
        modeId: "grouped",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        }
      })
    ).toThrow("grouping anchor");
  });

  it("rejects grouped-anchor metadata for native-effective sampling", () => {
    expect(() =>
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          nativeMode()
        ),
        modeId: "native",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        },
        groupedSamplingAnchor:
          topLeftGroupingAnchor()
      })
    ).toThrow("must be omitted");
  });

  it("fails closed for declared-effective-raster modes even when dimensions happen to match", () => {
    const declaredMode:
      CaptureModeProfile["modes"][number] = {
      modeId: "declared",
      evidence: evidence("test:declared"),
      acquisition: {
        kind: "single-frame"
      },
      perFrameSampling: {
        kind: "declared-effective-raster",
        raster: {
          value: nativeRaster,
          evidence: evidence("test:declared-raster")
        }
      },
      processedImageRaster: {
        value: nativeRaster,
        evidence: evidence("test:declared-output")
      },
      dependencies: [
        "color-sampling-model"
      ]
    };

    expect(() =>
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile:
          modeProfile(declaredMode),
        modeId: "declared",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        }
      })
    ).toThrow("no relationship may be inferred");
  });

  it("requires the capture mode to declare its color-sampling dependency", () => {
    const withoutDependency = nativeMode({
      dependencies: []
    });

    expect(() =>
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile:
          modeProfile(withoutDependency),
        modeId: "native",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        }
      })
    ).toThrow("color-sampling-model");
  });

  it("preserves pixel-shift metadata without changing CFA site assignment", () => {
    const offsets = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 }
    ] as const;

    const pixelShiftMode:
      CaptureModeProfile["modes"][number] = {
      modeId: "pixel-shift",
      evidence: evidence("test:pixel-shift"),
      acquisition: {
        kind: "fixed-multi-frame",
        frameCount: {
          value: 4,
          evidence: evidence("test:frames")
        }
      },
      perFrameSampling: {
        kind: "native-effective-raster"
      },
      interFrameSensorOffsetsNativeSamples: {
        value: offsets,
        evidence: evidence("test:offsets")
      },
      reconstructionStages: [
        {
          value: "pixel-shift-combination",
          evidence: evidence("test:combine")
        }
      ],
      processedImageRaster: {
        value: {
          pixelWidth: 16,
          pixelHeight: 12
        },
        evidence: evidence("test:processed")
      },
      dependencies: [
        "color-sampling-model",
        "inter-frame-registration"
      ]
    };

    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile:
          modeProfile(pixelShiftMode),
        modeId: "pixel-shift",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        }
      });

    expect(
      result.interFrameSensorOffsetsNativeSamples
        ?.value
    ).toEqual(offsets);
    expect(
      result.sensorShiftChangesColorSiteAssignment
    ).toBe(false);
    expect(
      result.sensorShiftOpticalRegistration
    ).toBe("outside-this-contract");
    expect(result.channelComposition).toEqual({
      kind: "single-channel",
      channelId: "red"
    });
  });

  it("supports more color sites per native effective sample without enumerating contributor arrays", () => {
    const result =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          nativeMode()
        ),
        modeId: "native",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(
          "bayer-like",
          4,
          4
        ),
        modeSampleIndexFullFrame: {
          x: 1,
          y: 1
        }
      });

    expect(result.colorSamplingSiteRect).toEqual({
      x: 4,
      y: 4,
      width: 4,
      height: 4
    });
    expect(result.totalContributorSites).toBe(
      16
    );
    expect(result.channelSiteCounts).toEqual([
      { channelId: "red", siteCount: 4 },
      { channelId: "green", siteCount: 8 },
      { channelId: "blue", siteCount: 4 }
    ]);
    expect(
      "contributorSites" in
        (result as unknown as Record<string, unknown>)
    ).toBe(false);
  });

  it("fails closed on out-of-range full-frame mode indices", () => {
    expect(() =>
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile: modeProfile(
          groupedMode()
        ),
        modeId: "grouped",
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(),
        modeSampleIndexFullFrame: {
          x: 4,
          y: 0
        },
        groupedSamplingAnchor:
          topLeftGroupingAnchor()
      })
    ).toThrow("must lie within");
  });

  it("fails closed when binding-derived site-grid cardinality is unsafe", () => {
    expect(() =>
      resolveNativeEffectiveRasterColorSamplingBinding({
        nativeRaster,
        colorSamplingProfile: bayerLikeProfile(),
        bindingProfile: binding(
          "bayer-like",
          Number.MAX_SAFE_INTEGER,
          1
        )
      })
    ).toThrow("safe integer");
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  const domain = expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) });
  it("rejects a missing sample index or a null grouping anchor with a domain error", () => {
    expect(() => resolveCaptureModeColorSamplingContributors({ nativeRaster, captureModeProfile: modeProfile(nativeMode()), modeId: "native",
      colorSamplingProfile: bayerLikeProfile(), bindingProfile: binding(), modeSampleIndexFullFrame: undefined as never })).toThrow(domain);
    expect(() => resolveCaptureModeColorSamplingContributors({ nativeRaster, captureModeProfile: modeProfile(groupedMode()), modeId: "grouped",
      colorSamplingProfile: bayerLikeProfile(), bindingProfile: binding(), modeSampleIndexFullFrame: { x: 0, y: 0 }, groupedSamplingAnchor: null as never })).toThrow(domain);
  });
});
