// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  parseCaptureModeProfile,
  resolveCaptureMode,
  type CaptureModeProfile,
  type SourcedCaptureModeFact
} from "../src/index.js";

type OwnedEvidence = readonly [
  {
    sourceOrigin: "photivra";
    sourceReference: string;
    reuseStatus: "photivra-owned";
  }
];

const evidence = (sourceReference: string): OwnedEvidence =>
  [
    {
      sourceOrigin: "photivra",
      sourceReference,
      reuseStatus: "photivra-owned"
    }
  ] as const;

const fact = <T>(
  value: T,
  sourceReference: string
): SourcedCaptureModeFact<T> => ({
  value,
  evidence: evidence(sourceReference)
});

const nativeRaster = {
  pixelWidth: 6000,
  pixelHeight: 4000
};

function profile(
  modes: CaptureModeProfile["modes"]
): CaptureModeProfile {
  return {
    schemaVersion: "0.1.0",
    modes
  };
}

describe("capture mode contract", () => {
  it("represents a native single-frame mode without mutating sensor identity", () => {
    const parsed = parseCaptureModeProfile({
      schemaVersion: "0.1.0",
      modes: [
        {
          modeId: "native",
          evidence: evidence("test:native-mode"),
          acquisition: {
            kind: "single-frame"
          },
          perFrameSampling: {
            kind: "native-effective-raster"
          },
          processedImageRaster: fact(
            nativeRaster,
            "test:native-processed-raster"
          )
        }
      ]
    });

    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: parsed,
      modeId: "native"
    });

    expect(resolved.acquisition).toEqual({
      kind: "single-frame",
      frameCount: 1
    });
    expect(resolved.perFrameSampling).toEqual({
      kind: "native-effective-raster",
      raster: nativeRaster
    });
    expect(resolved.physicalSensorGeometryMutation).toBe(false);
    expect(resolved.photositeCountInference).toBe(
      "not-permitted-from-native-or-processed-raster"
    );
    expect(resolved.finalOutputRasterOwnership).toBe(
      "downstream-capture-output-geometry"
    );
  });

  it("derives grouped per-frame sampling while preserving unknown combination domain", () => {
    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "grouped",
          evidence: evidence("test:grouped"),
          acquisition: {
            kind: "single-frame"
          },
          perFrameSampling: {
            kind: "grouped-native-samples",
            groupWidthSamples: fact(
              2,
              "test:group-width"
            ),
            groupHeightSamples: fact(
              2,
              "test:group-height"
            )
          },
          processedImageRaster: fact(
            {
              pixelWidth: 3000,
              pixelHeight: 2000
            },
            "test:grouped-processed"
          )
        }
      ]),
      modeId: "grouped"
    });

    expect(resolved.perFrameSampling).toMatchObject({
      kind: "grouped-native-samples",
      raster: {
        pixelWidth: 3000,
        pixelHeight: 2000
      }
    });
    expect(
      resolved.perFrameSampling.kind ===
        "grouped-native-samples"
        ? resolved.perFrameSampling.combinationDomain
        : undefined
    ).toBeUndefined();
  });

  it("keeps charge-domain and post-conversion digital grouping distinct", () => {
    const modes: CaptureModeProfile["modes"] = [
      {
        modeId: "charge-binning",
        evidence: evidence("test:charge-mode"),
        acquisition: {
          kind: "single-frame"
        },
        perFrameSampling: {
          kind: "grouped-native-samples",
          groupWidthSamples: fact(2, "test:cw"),
          groupHeightSamples: fact(2, "test:ch"),
          combinationDomain: fact(
            "charge-domain",
            "test:charge-domain"
          )
        },
        processedImageRaster: fact(
          { pixelWidth: 3000, pixelHeight: 2000 },
          "test:charge-output"
        )
      },
      {
        modeId: "digital-grouping",
        evidence: evidence("test:digital-mode"),
        acquisition: {
          kind: "single-frame"
        },
        perFrameSampling: {
          kind: "grouped-native-samples",
          groupWidthSamples: fact(2, "test:dw"),
          groupHeightSamples: fact(2, "test:dh"),
          combinationDomain: fact(
            "post-conversion-digital",
            "test:digital-domain"
          )
        },
        processedImageRaster: fact(
          { pixelWidth: 3000, pixelHeight: 2000 },
          "test:digital-output"
        )
      }
    ];

    const charge = resolveCaptureMode({
      nativeRaster,
      profile: profile(modes),
      modeId: "charge-binning"
    });
    const digital = resolveCaptureMode({
      nativeRaster,
      profile: profile(modes),
      modeId: "digital-grouping"
    });

    expect(
      charge.perFrameSampling.kind ===
        "grouped-native-samples"
        ? charge.perFrameSampling.combinationDomain?.value
        : undefined
    ).toBe("charge-domain");
    expect(
      digital.perFrameSampling.kind ===
        "grouped-native-samples"
        ? digital.perFrameSampling.combinationDomain?.value
        : undefined
    ).toBe("post-conversion-digital");
  });

  it("represents remosaic as reconstruction rather than a different physical sensor", () => {
    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "remosaic",
          evidence: evidence("test:remosaic-mode"),
          acquisition: {
            kind: "single-frame"
          },
          perFrameSampling: {
            kind: "native-effective-raster"
          },
          reconstructionStages: [
            fact("remosaic", "test:remosaic-stage")
          ],
          processedImageRaster: fact(
            { pixelWidth: 6000, pixelHeight: 4000 },
            "test:remosaic-output"
          ),
          dependencies: [
            "color-sampling-model",
            "mode-specific-readout-timing"
          ]
        }
      ]),
      modeId: "remosaic"
    });

    expect(
      resolved.reconstructionStages.map(
        (stage) => stage.value
      )
    ).toEqual(["remosaic"]);
    expect(resolved.dependencies).toEqual([
      "color-sampling-model",
      "mode-specific-readout-timing"
    ]);
    expect(resolved.nativeRaster).toEqual(nativeRaster);
    expect(resolved.physicalSensorGeometryMutation).toBe(false);
  });

  it("represents pixel-shift multi-frame acquisition without treating output MP as sensor MP", () => {
    const offsets = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 },
      { x: 0.5, y: 0.5 }
    ] as const;

    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "pixel-shift-4",
          evidence: evidence("test:pixel-shift"),
          acquisition: {
            kind: "fixed-multi-frame",
            frameCount: fact(4, "test:frame-count")
          },
          perFrameSampling: {
            kind: "native-effective-raster"
          },
          interFrameSensorOffsetsNativeSamples: fact(
            offsets,
            "test:offset-sequence"
          ),
          reconstructionStages: [
            fact(
              "pixel-shift-combination",
              "test:pixel-shift-stage"
            )
          ],
          processedImageRaster: fact(
            {
              pixelWidth: 12000,
              pixelHeight: 8000
            },
            "test:pixel-shift-processed"
          ),
          dependencies: [
            "inter-frame-registration",
            "color-sampling-model"
          ]
        }
      ]),
      modeId: "pixel-shift-4"
    });

    expect(
      resolved.acquisition.kind === "fixed-multi-frame"
        ? resolved.acquisition.frameCount.value
        : undefined
    ).toBe(4);
    expect(
      resolved.interFrameSensorOffsetsNativeSamples?.value
    ).toEqual(offsets);
    expect(resolved.processedImageMegapixels).toBe(96);
    expect(resolved.nativeRaster).toEqual(nativeRaster);
    expect(resolved.nativeRasterSemantic).toBe(
      "effective-image-sampling-grid-not-photosite-count"
    );
    expect(resolved.photositeCountInference).toBe(
      "not-permitted-from-native-or-processed-raster"
    );
  });

  it("supports variable multi-frame computational capture without inventing a fixed frame count", () => {
    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "computational",
          evidence: evidence("test:computational-mode"),
          acquisition: {
            kind: "variable-multi-frame",
            evidence: evidence("test:variable-frames"),
            minimumFrameCount: fact(
              2,
              "test:min-frames"
            )
          },
          perFrameSampling: {
            kind: "grouped-native-samples",
            groupWidthSamples: fact(
              2,
              "test:group-width"
            ),
            groupHeightSamples: fact(
              2,
              "test:group-height"
            ),
            combinationDomain: fact(
              "post-conversion-digital",
              "test:digital-grouping"
            )
          },
          reconstructionStages: [
            fact(
              "multi-frame-computational-combination",
              "test:computational-stage"
            )
          ],
          processedImageRaster: fact(
            {
              pixelWidth: 3000,
              pixelHeight: 2000
            },
            "test:computational-output"
          ),
          dependencies: [
            "inter-frame-registration"
          ]
        }
      ]),
      modeId: "computational"
    });

    expect(resolved.acquisition.kind).toBe(
      "variable-multi-frame"
    );
    expect(
      resolved.acquisition.kind === "variable-multi-frame"
        ? resolved.acquisition.minimumFrameCount?.value
        : undefined
    ).toBe(2);
    expect(
      resolved.acquisition.kind === "variable-multi-frame"
        ? resolved.acquisition.maximumFrameCount
        : undefined
    ).toBeUndefined();
  });

  it("supports a declared per-frame sampling raster when simple grouping would be misleading", () => {
    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "declared-sampling",
          evidence: evidence("test:declared-mode"),
          acquisition: {
            kind: "single-frame"
          },
          perFrameSampling: {
            kind: "declared-effective-raster",
            raster: fact(
              {
                pixelWidth: 3840,
                pixelHeight: 2160
              },
              "test:declared-raster"
            )
          },
          processedImageRaster: fact(
            {
              pixelWidth: 3840,
              pixelHeight: 2160
            },
            "test:declared-output"
          )
        }
      ]),
      modeId: "declared-sampling"
    });

    expect(resolved.perFrameSampling.kind).toBe(
      "declared-effective-raster"
    );
    expect(
      resolved.perFrameSampling.kind ===
        "declared-effective-raster"
        ? resolved.perFrameSampling.raster.value
        : undefined
    ).toEqual({
      pixelWidth: 3840,
      pixelHeight: 2160
    });
  });

  it("fails closed when integer grouping does not exactly divide the native effective raster", () => {
    expect(() =>
      resolveCaptureMode({
        nativeRaster,
        profile: profile([
          {
            modeId: "invalid-grouping",
            evidence: evidence("test:invalid-grouping"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "grouped-native-samples",
              groupWidthSamples: fact(
                7,
                "test:group-width"
              ),
              groupHeightSamples: fact(
                2,
                "test:group-height"
              )
            },
            processedImageRaster: fact(
              {
                pixelWidth: 857,
                pixelHeight: 2000
              },
              "test:invalid-output"
            )
          }
        ]),
        modeId: "invalid-grouping"
      })
    ).toThrow("exactly divisible");
  });

  it("fails closed when a fixed multi-frame sensor-offset sequence count does not match frame count", () => {
    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "bad-offset-count",
            evidence: evidence("test:bad-offsets"),
            acquisition: {
              kind: "fixed-multi-frame",
              frameCount: fact(
                4,
                "test:frame-count"
              )
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            interFrameSensorOffsetsNativeSamples: fact(
              [
                { x: 0, y: 0 },
                { x: 0.5, y: 0 }
              ],
              "test:short-offset-sequence"
            ),
            processedImageRaster: fact(
              nativeRaster,
              "test:processed"
            )
          }
        ]
      })
    ).toThrow("length must equal");
  });

  it("rejects duplicate mode ids, reconstruction stages and dependencies", () => {
    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "same",
            evidence: evidence("test:first"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            processedImageRaster: fact(
              nativeRaster,
              "test:first-output"
            )
          },
          {
            modeId: "same",
            evidence: evidence("test:second"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            processedImageRaster: fact(
              nativeRaster,
              "test:second-output"
            )
          }
        ]
      })
    ).toThrow("duplicate modeId");

    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "duplicate-stage",
            evidence: evidence("test:duplicate-stage"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            reconstructionStages: [
              fact("remosaic", "test:r1"),
              fact("remosaic", "test:r2")
            ],
            processedImageRaster: fact(
              nativeRaster,
              "test:processed"
            )
          }
        ]
      })
    ).toThrow("duplicate stages");

    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "duplicate-dependency",
            evidence: evidence("test:duplicate-dep"),
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            processedImageRaster: fact(
              nativeRaster,
              "test:processed"
            ),
            dependencies: [
              "color-sampling-model",
              "color-sampling-model"
            ]
          }
        ]
      })
    ).toThrow("must not contain duplicates");
  });

  it("rejects invalid variable frame ranges and malformed evidence-backed facts", () => {
    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "bad-range",
            evidence: evidence("test:bad-range"),
            acquisition: {
              kind: "variable-multi-frame",
              evidence: evidence("test:variable"),
              minimumFrameCount: fact(5, "test:min"),
              maximumFrameCount: fact(3, "test:max")
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            processedImageRaster: fact(
              nativeRaster,
              "test:processed"
            )
          }
        ]
      })
    ).toThrow("must not exceed");

    expect(() =>
      parseCaptureModeProfile({
        schemaVersion: "0.1.0",
        modes: [
          {
            modeId: "missing-evidence",
            evidence: [],
            acquisition: {
              kind: "single-frame"
            },
            perFrameSampling: {
              kind: "native-effective-raster"
            },
            processedImageRaster: fact(
              nativeRaster,
              "test:processed"
            )
          }
        ]
      })
    ).toThrow("must be a non-empty array");
  });

  it("keeps final output geometry outside the capture-mode contract", () => {
    const resolved = resolveCaptureMode({
      nativeRaster,
      profile: profile([
        {
          modeId: "mode",
          evidence: evidence("test:mode"),
          acquisition: {
            kind: "single-frame"
          },
          perFrameSampling: {
            kind: "native-effective-raster"
          },
          processedImageRaster: fact(
            {
              pixelWidth: 4000,
              pixelHeight: 3000
            },
            "test:processed"
          )
        }
      ]),
      modeId: "mode"
    });

    expect(resolved.processedImageRaster.value).toEqual({
      pixelWidth: 4000,
      pixelHeight: 3000
    });
    expect(resolved.finalOutputRasterOwnership).toBe(
      "downstream-capture-output-geometry"
    );
  });
});

describe("sparse arrays (sensor-12, #701)", () => {
  it("refuses inter-frame offsets with holes", () => {
    expect(() => parseCaptureModeProfile(profile([{
      modeId: "pixel-shift-4", evidence: evidence("test:pixel-shift"),
      acquisition: { kind: "fixed-multi-frame", frameCount: fact(4, "test:frame-count") },
      perFrameSampling: { kind: "native-effective-raster" },
      interFrameSensorOffsetsNativeSamples: fact(new Array(4) as never, "test:offset-sequence"),
      reconstructionStages: [fact("pixel-shift-combination", "test:pixel-shift-stage")],
      processedImageRaster: fact({ pixelWidth: 12000, pixelHeight: 8000 }, "test:pixel-shift-processed"),
      dependencies: ["inter-frame-registration", "color-sampling-model"]
    } as never]))).toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});
