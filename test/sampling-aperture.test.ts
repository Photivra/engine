// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  parseSensorSamplingApertureProfile,
  resolveSensorSamplingAperture,
  type NativeEffectiveRasterColorSamplingBindingProfile,
  type SensorColorSamplingProfile,
  type SensorSamplingApertureProfile
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

const imagingArea = {
  widthMm: 4,
  heightMm: 2
};

const nativeRaster = {
  pixelWidth: 4,
  pixelHeight: 2
};

function colorProfile(
  profileId = "bayer-like"
): SensorColorSamplingProfile {
  return {
    schemaVersion: "0.1.0",
    profileId,
    evidence: evidence(
      "test:color:" + profileId
    ),
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
  };
}

function bindingProfile(
  options: {
    bindingId?: string;
    colorSamplingProfileId?: string;
    sitesPerNativeSampleX?: number;
    sitesPerNativeSampleY?: number;
  } = {}
): NativeEffectiveRasterColorSamplingBindingProfile {
  return {
    schemaVersion: "0.1.0",
    bindingId:
      options.bindingId ?? "binding",
    colorSamplingProfileId:
      options.colorSamplingProfileId ??
      "bayer-like",
    nativeRaster,
    evidence: evidence("test:binding"),
    relationship: {
      kind:
        "regular-native-effective-sample-blocks",
      sitesPerNativeSampleX:
        options.sitesPerNativeSampleX ?? 1,
      sitesPerNativeSampleY:
        options.sitesPerNativeSampleY ?? 1,
      anchor: "shared-native-top-left"
    }
  };
}

function apertureProfile(
  options: {
    profileId?: string;
    colorSamplingProfileId?: string;
    colorSamplingBindingId?: string;
    pitchXMicrometers?: number;
    pitchYMicrometers?: number;
    firstXMicrometers?: number;
    firstYMicrometers?: number;
    widthMicrometers?: number;
    heightMicrometers?: number;
    offsetXMicrometers?: number;
    offsetYMicrometers?: number;
  } = {}
): SensorSamplingApertureProfile {
  return {
    schemaVersion: "0.1.0",
    profileId:
      options.profileId ?? "sampling",
    colorSamplingProfileId:
      options.colorSamplingProfileId ??
      "bayer-like",
    colorSamplingBindingId:
      options.colorSamplingBindingId ??
      "binding",
    evidence: evidence("test:sampling"),
    siteCenterLattice: {
      kind:
        "regular-rectangular-site-center-lattice",
      coordinateSystem:
        "native-sensor-physical",
      pitchXMicrometers:
        options.pitchXMicrometers ?? 1000,
      pitchYMicrometers:
        options.pitchYMicrometers ?? 1000,
      firstSiteCenterFromImagingAreaTopLeftMicrometers:
        {
          x:
            options.firstXMicrometers ??
            500,
          y:
            options.firstYMicrometers ??
            500
        },
      evidence: evidence("test:lattice")
    },
    geometricSensitiveAperture: {
      kind:
        "uniform-axis-aligned-rectangle",
      widthMicrometers:
        options.widthMicrometers ?? 800,
      heightMicrometers:
        options.heightMicrometers ?? 600,
      centerOffsetFromSiteCenterMicrometers:
        {
          x:
            options.offsetXMicrometers ??
            0,
          y:
            options.offsetYMicrometers ??
            0
        },
      evidence: evidence("test:aperture")
    }
  };
}

describe("sensor sampling aperture foundation", () => {
  it("resolves physical site center and rectangular aperture in native sensor coordinates", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 1, y: 0 }
      });

    expect(result.channelId).toBe("green");
    expect(
      result.lattice
        .siteCenterFromImagingAreaTopLeftMicrometers
    ).toEqual({
      x: 1500,
      y: 500
    });
    expect(
      result.lattice
        .siteCenterFromOpticalAxisMm
    ).toEqual({
      x: -0.5,
      y: -0.5
    });
    const bounds =
      result.geometricSensitiveAperture
        .boundsFromOpticalAxisMm;
    expect(bounds.left).toBeCloseTo(-0.9, 12);
    expect(bounds.right).toBeCloseTo(-0.1, 12);
    expect(bounds.top).toBeCloseTo(-0.8, 12);
    expect(bounds.bottom).toBeCloseTo(-0.2, 12);
  });

  it("derives geometric sensitive area fraction without promoting it to QE or radiometric collection area", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 0, y: 0 }
      });

    expect(
      result.geometricSensitiveAperture
        .areaSquareMicrometers
    ).toBe(480_000);
    expect(
      result.lattice
        .nominalCellAreaSquareMicrometers
    ).toBe(1_000_000);
    expect(
      result.geometricSensitiveAperture
        .geometricSensitiveAreaFractionOfLatticeCell
    ).toBeCloseTo(0.48, 12);

    expect(
      result.quantumEfficiencyIncluded
    ).toBe(false);
    expect(
      result.radiometricCollectionAreaEstablished
    ).toBe(false);
    expect(
      result.physicalPhotodiodeGeometryEstablished
    ).toBe(false);
  });

  it("keeps site-center pitch independent from NativeImageRaster-derived pitch", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile("dense-grid"),
        colorSamplingBindingProfile:
          bindingProfile({
            colorSamplingProfileId:
              "dense-grid",
            sitesPerNativeSampleX: 2,
            sitesPerNativeSampleY: 2
          }),
        samplingApertureProfile:
          apertureProfile({
            colorSamplingProfileId:
              "dense-grid",
            pitchXMicrometers: 400,
            pitchYMicrometers: 400,
            firstXMicrometers: 400,
            firstYMicrometers: 400,
            widthMicrometers: 300,
            heightMicrometers: 300
          }),
        site: { x: 7, y: 3 }
      });

    expect(
      result.lattice.pitchXMicrometers
    ).toBe(400);
    expect(
      result.sitePitchDerivedFromNativeImageRaster
    ).toBe(false);
    expect(
      result.apertureDerivedFromSitePitch
    ).toBe(false);
    expect(result.siteGrid).toEqual({
      widthSites: 8,
      heightSites: 4
    });
  });

  it("supports an off-center sensitive rectangle while keeping it inside one lattice cell", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile({
            widthMicrometers: 600,
            heightMicrometers: 600,
            offsetXMicrometers: 100,
            offsetYMicrometers: -100
          }),
        site: { x: 1, y: 1 }
      });

    expect(
      result.geometricSensitiveAperture
        .centerOffsetFromSiteCenterMicrometers
    ).toEqual({
      x: 100,
      y: -100
    });
    expect(
      result.geometricSensitiveAperture
        .neighboringGeometricApertureOverlap
    ).toBe("none-by-model");
  });

  it("represents an unresolved aperture without deriving one from site pitch", () => {
    const unresolved =
      parseSensorSamplingApertureProfile({
        schemaVersion: "0.1.0",
        profileId: "unresolved",
        colorSamplingProfileId:
          "bayer-like",
        colorSamplingBindingId:
          "binding",
        evidence: evidence(
          "test:unresolved"
        ),
        siteCenterLattice: {
          kind:
            "regular-rectangular-site-center-lattice",
          coordinateSystem:
            "native-sensor-physical",
          pitchXMicrometers: 1000,
          pitchYMicrometers: 1000,
          firstSiteCenterFromImagingAreaTopLeftMicrometers:
            {
              x: 500,
              y: 500
            },
          evidence: evidence(
            "test:lattice"
          )
        },
        geometricSensitiveAperture: {
          kind: "unresolved",
          evidence: evidence(
            "test:aperture-unknown"
          )
        }
      });

    expect(
      unresolved.geometricSensitiveAperture
        .kind
    ).toBe("unresolved");

    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          unresolved,
        site: { x: 0, y: 0 }
      })
    ).toThrow("unresolved");
  });

  it("rejects a rectangle that extends outside its nominal lattice cell", () => {
    expect(() =>
      parseSensorSamplingApertureProfile(
        apertureProfile({
          widthMicrometers: 1100
        })
      )
    ).toThrow("within one regular site lattice cell");

    expect(() =>
      parseSensorSamplingApertureProfile(
        apertureProfile({
          widthMicrometers: 800,
          offsetXMicrometers: 200
        })
      )
    ).toThrow("within one regular site lattice cell");
  });

  it("fails closed when the physical lattice extends beyond the supplied imaging area", () => {
    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile({
            pitchXMicrometers: 1500
          }),
        site: { x: 0, y: 0 }
      })
    ).toThrow("lattice extends beyond");
  });

  it("validates aperture fit across the complete site grid, not only the requested site", () => {
    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile({
            firstXMicrometers: 200
          }),
        site: { x: 2, y: 0 }
      })
    ).toThrow("complete site grid");
  });

  it("accepts an exactly fitting lattice whose two extents differ by floating-point rounding only", () => {
    // 34 sites of 9.287925696594426 µm: widthMm · 1000 = 315.78947368421046 µm, while the far aperture edge
    // pitch/2 + 33·pitch + pitch/2 = 315.7894736842105 µm (one unit in the last place larger).
    const pitch = 9.287925696594426, sites = 34;
    const raster = { pixelWidth: sites, pixelHeight: sites };
    const area = { widthMm: sites * pitch / 1000, heightMm: sites * pitch / 1000 };
    expect(pitch / 2 + (sites - 1) * pitch + pitch / 2).toBeGreaterThan(area.widthMm * 1000);
    const profile = apertureProfile({ pitchXMicrometers: pitch, pitchYMicrometers: pitch, firstXMicrometers: pitch / 2, firstYMicrometers: pitch / 2,
      widthMicrometers: pitch, heightMicrometers: pitch });
    const binding = { ...bindingProfile(), nativeRaster: raster };
    const resolve = (site: { x: number; y: number }, samplingApertureProfile = profile, imagingArea = area): ReturnType<typeof resolveSensorSamplingAperture> => resolveSensorSamplingAperture({ imagingArea,
      nativeRaster: raster, colorSamplingProfile: colorProfile(), colorSamplingBindingProfile: binding, samplingApertureProfile, site });
    expect(resolve({ x: sites - 1, y: sites - 1 }).geometricSensitiveAperture.geometricSensitiveAreaFractionOfLatticeCell).toBe(1);
    expect(resolve({ x: 0, y: 0 }).channelId).toBe("red");

    // A genuinely oversized aperture or lattice is still rejected, however small the excess.
    const excess = 1e-9;
    expect(() => resolve({ x: 0, y: 0 }, apertureProfile({ pitchXMicrometers: pitch, pitchYMicrometers: pitch, firstXMicrometers: pitch / 2 + excess,
      firstYMicrometers: pitch / 2, widthMicrometers: pitch, heightMicrometers: pitch }))).toThrow("complete site grid");
    expect(() => resolve({ x: 0, y: 0 }, apertureProfile({ pitchXMicrometers: pitch, pitchYMicrometers: pitch, firstXMicrometers: pitch / 2 - excess,
      firstYMicrometers: pitch / 2, widthMicrometers: pitch, heightMicrometers: pitch }))).toThrow("complete site grid");
    expect(() => resolve({ x: 0, y: 0 }, profile, { widthMm: area.widthMm * (1 - 1e-12), heightMm: area.heightMm })).toThrow("complete site grid");
    expect(() => resolve({ x: 0, y: 0 }, profile, { widthMm: area.widthMm, heightMm: (sites - 1) * pitch / 1000 })).toThrow("lattice extends beyond");
  });

  it("fails closed when profile IDs do not match the color topology or binding", () => {
    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile({
            colorSamplingProfileId:
              "wrong-color"
          }),
        site: { x: 0, y: 0 }
      })
    ).toThrow("colorSamplingProfileId");

    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile({
            colorSamplingBindingId:
              "wrong-binding"
          }),
        site: { x: 0, y: 0 }
      })
    ).toThrow("colorSamplingBindingId");
  });

  it("fails closed for a site outside the bound color-site grid", () => {
    expect(() =>
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 4, y: 0 }
      })
    ).toThrow("bound color-sampling site grid");
  });

  it("keeps AA, microlens, diffusion, crosstalk, spectral and throughput effects outside the aperture model", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 0, y: 0 }
      });

    expect(
      result.antiAliasingResponseIncluded
    ).toBe(false);
    expect(
      result.microlensSpatialRedistributionIncluded
    ).toBe(false);
    expect(result.chargeDiffusionIncluded).toBe(
      false
    );
    expect(
      result.electricalCrosstalkIncluded
    ).toBe(false);
    expect(
      result.spectralResponseIncluded
    ).toBe(false);
    expect(
      result.opticalThroughputIncluded
    ).toBe(false);
  });

  it("uses a normalized spatial average while preserving physical area separately", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 0, y: 0 }
      });

    expect(
      result.geometricSensitiveAperture
        .spatialWeighting
    ).toBe("uniform-unit-area-average");
    expect(
      result.geometricSensitiveAperture
        .areaSquareMicrometers
    ).toBeGreaterThan(0);
    expect(
      result.radiometricCollectionAreaEstablished
    ).toBe(false);
  });

  it("does not expose physical camera orientation as part of native sampling aperture geometry", () => {
    const result =
      resolveSensorSamplingAperture({
        imagingArea,
        nativeRaster,
        colorSamplingProfile:
          colorProfile(),
        colorSamplingBindingProfile:
          bindingProfile(),
        samplingApertureProfile:
          apertureProfile(),
        site: { x: 0, y: 0 }
      });

    expect(
      "orientation" in
        (result as unknown as Record<
          string,
          unknown
        >)
    ).toBe(false);
    expect(result.coordinateSystem).toBe(
      "native-sensor-physical"
    );
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  it("rejects a missing site with a domain error", () => {
    expect(() => resolveSensorSamplingAperture({ imagingArea, nativeRaster, colorSamplingProfile: colorProfile(), colorSamplingBindingProfile: bindingProfile(),
      samplingApertureProfile: apertureProfile(), site: undefined as never })).toThrow(expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) }));
  });
});

describe("cell fit rounding allowance (sensor-20, #701)", () => {
  const parse = (pitch: number, width: number, offset: number): unknown => parseSensorSamplingApertureProfile(apertureProfile({ pitchXMicrometers: pitch, pitchYMicrometers: pitch,
    firstXMicrometers: pitch / 2, firstYMicrometers: pitch / 2, widthMicrometers: width, heightMicrometers: width, offsetXMicrometers: offset, offsetYMicrometers: -offset }));
  it("accepts apertures that touch the cell edge exactly in decimal", () => {
    expect(() => parse(0.3, 0.1, 0.1)).not.toThrow();
    expect(() => parse(1.4, 1.12, 0.14)).not.toThrow();
    expect(() => parse(0.57, 0.456, 0.057)).not.toThrow();
    let refused = 0, total = 0;
    for (let k = 50; k <= 1000; k++) {
      const pitch = k / 100;
      for (const [w, o] of [[0.8, 0.1], [0.6, 0.2], [0.5, 0.25], [0.4, 0.3], [0.2, 0.4]] as const) {
        total++;
        try { parse(pitch, Number((pitch * w).toFixed(4)), Number((pitch * o).toFixed(4))); } catch { refused++; }
      }
    }
    expect([refused, total]).toEqual([0, 4755]);
  });

  it("still refuses an aperture over the edge", () => {
    expect(() => parse(0.3, 0.1, 0.1 + 1e-6)).toThrow("within one regular site lattice cell");
    expect(() => parse(3.76, 3.008 + 2e-6, 0.376)).toThrow("within one regular site lattice cell");
  });
});
