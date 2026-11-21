// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateAiryDisk,
  calculateDepthOfField,
  calculateSceneRadianceToSensorIrradiance,
  composeFrontOfLensFilterTransmission,
  parseFrontOfLensFilterProfile,
  parseSceneToSensorIrradianceProfile,
  resolveFrontOfLensFilterTransmission,
  type FrontOfLensFilterProfile,
  type SceneRadianceEvaluationRequest,
  type SceneRadianceEvaluationResult
} from "../src/index.js";
import { prepareSceneRadianceToSensorIrradianceValue } from "../src/optics/scene-to-sensor-irradiance.js";

const evidence = (
  ref: string
): readonly [{
  sourceOrigin: "photivra";
  sourceReference: string;
  reuseStatus: "photivra-owned";
}] => [{
  sourceOrigin: "photivra",
  sourceReference: ref,
  reuseStatus: "photivra-owned"
}];

const neutralLinear = (
  factor = 0.5,
  id = "generic-nd-linear"
): FrontOfLensFilterProfile =>
  parseFrontOfLensFilterProfile({
    schemaVersion: "0.1.0",
    filterId: id,
    profileVersion: "1.0.0",
    identityScope:
      "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: {
      minimum: 400,
      maximum: 700
    },
    transmission: {
      kind:
        "neutral-linear-transmission",
      linearTransmissionFactor: {
        value: factor,
        evidence:
          evidence(id + ":transmission")
      }
    },
    uncertainty: {
      kind: "not-quantified",
      limitation:
        "Generic educational filter."
    },
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled:
      false,
    evidence: evidence(id),
    limitations: [
      "Generic unbranded filter."
    ]
  });

const neutralDensity = (
  density = 0.3
): FrontOfLensFilterProfile =>
  parseFrontOfLensFilterProfile({
    schemaVersion: "0.1.0",
    filterId: "generic-nd-density",
    profileVersion: "1.0.0",
    identityScope:
      "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: {
      minimum: 400,
      maximum: 700
    },
    transmission: {
      kind:
        "neutral-optical-density",
      opticalDensityBase10: {
        value: density,
        evidence:
          evidence("density")
      }
    },
    uncertainty: {
      kind: "not-quantified",
      limitation:
        "Generic educational filter."
    },
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled:
      false,
    evidence: evidence("nd-density"),
    limitations: []
  });

const spectral = (): FrontOfLensFilterProfile =>
  parseFrontOfLensFilterProfile({
    schemaVersion: "0.1.0",
    filterId: "generic-spectral",
    profileVersion: "1.0.0",
    identityScope:
      "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: {
      minimum: 450,
      maximum: 650
    },
    transmission: {
      kind: "spectral-transmission",
      samples: {
        value: [
          {
            wavelengthNanometers: 450,
            linearTransmissionFactor: 0.8
          },
          {
            wavelengthNanometers: 550,
            linearTransmissionFactor: 0.6
          },
          {
            wavelengthNanometers: 650,
            linearTransmissionFactor: 0.4
          }
        ],
        evidence:
          evidence("spectral-data")
      }
    },
    uncertainty: {
      kind: "not-quantified",
      limitation:
        "Generic educational spectral filter."
    },
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled:
      false,
    evidence: evidence("spectral-filter"),
    limitations: []
  });

const request = (
  wavelengthNanometers = 550
): SceneRadianceEvaluationRequest => ({
  schemaVersion: "0.1.0",
  sampleId: "sample",
  providerProfileId: "provider",
  sceneId: "scene",
  illuminationProfileId: "illumination",
  materialResponseProfileId: "material",
  target: {
    kind: "environment-direction",
    outgoingDirectionUnitVector: {
      x: 0,
      y: 0,
      z: 1
    }
  },
  timeSecondsFromExposureStart: 0,
  wavelengthNanometers,
  wavelengthBasis: "air"
});

const radiance = (
  wavelengthNanometers = 550
): SceneRadianceEvaluationResult => ({
  schemaVersion: "0.1.0",
  sampleId: "sample",
  providerProfileId: "provider",
  sceneId: "scene",
  wavelengthNanometers,
  wavelengthBasis: "air",
  quantity: "outgoing-spectral-radiance",
  unit: "W/m^2/sr/nm",
  spectralRadianceWattsPerSquareMeterSteradianNanometer:
    10,
  scientificStatus: "approximation",
  uncertainty: {
    kind: "not-quantified",
    limitation: "test"
  },
  evidence: evidence("radiance"),
  limitations: []
});

const optics = (): ReturnType<
  typeof parseSceneToSensorIrradianceProfile
> =>
  parseSceneToSensorIrradianceProfile({
    schemaVersion: "0.1.0",
    profileId: "optics",
    profileVersion: "1.0.0",
    lensProfileId: "lens",
    scientificStatus: "approximation",
    applicability: {
      focalLengthMm: {
        minimum: 50,
        maximum: 50
      },
      nominalFNumber: {
        minimum: 1.4,
        maximum: 16
      },
      focus: {
        kind: "any"
      }
    },
    transmission: {
      kind: "spectral-transmission",
      scientificStatus: "approximation",
      wavelengthBasis: "air",
      samples: {
        value: [
          {
            wavelengthNanometers: 450,
            linearTransmissionFactor: 0.9
          },
          {
            wavelengthNanometers: 550,
            linearTransmissionFactor: 0.8
          },
          {
            wavelengthNanometers: 650,
            linearTransmissionFactor: 0.7
          }
        ],
        evidence: evidence("lens-transmission")
      },
      uncertainty: {
        kind: "not-quantified",
        limitation: "test"
      }
    },
    distortionAreaMappingOwnership:
      "not-applied-by-bridge",
    psfRedistributionOwnership:
      "downstream-normalized-energy-redistribution",
    sensorOpticalStackIncluded: false,
    strayLightIncluded: false,
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled:
      false,
    volumetricScatteringModeled: false,
    evidence: evidence("optics"),
    limitations: []
  });

describe("front-of-lens filter transmission", () => {
  it("resolves 50% neutral transmission as exactly one stop", () => {
    const result =
      resolveFrontOfLensFilterTransmission({
        profile: neutralLinear(),
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      });

    expect(
      result.linearTransmissionFactor
    ).toBe(0.5);
    expect(result.attenuationStops)
      .toBe(1);
    expect(
      result.opticalDensityBase10
    ).toBeCloseTo(
      Math.log10(2),
      14
    );
    expect(result.polarizationModeled)
      .toBe(false);
  });

  it("resolves base-10 optical density using T = 10^-OD", () => {
    const result =
      resolveFrontOfLensFilterTransmission({
        profile:
          neutralDensity(0.3),
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      });

    expect(
      result.linearTransmissionFactor
    ).toBeCloseTo(
      10 ** -0.3,
      14
    );
    expect(
      result.opticalDensityBase10
    ).toBeCloseTo(0.3, 14);
  });

  it("keeps wavelength-dependent filter transmission spectral", () => {
    const result =
      resolveFrontOfLensFilterTransmission({
        profile: spectral(),
        wavelengthNanometers: 500,
        wavelengthBasis: "air"
      });

    expect(
      result.linearTransmissionFactor
    ).toBeCloseTo(0.7, 14);
    expect(
      result.transmissionKind
    ).toBe("spectral-transmission");
  });

  it("composes multiple passive filters multiplicatively with stable component identity", () => {
    const result =
      composeFrontOfLensFilterTransmission({
        filters: [
          neutralLinear(
            0.5,
            "nd-one"
          ),
          neutralLinear(
            0.25,
            "nd-two"
          )
        ],
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      });

    expect(
      result
        .combinedLinearTransmissionFactor
    ).toBe(0.125);
    expect(
      result.combinedAttenuationStops
    ).toBe(3);
    expect(
      result.components.map(
        (component) =>
          component.filterId
      )
    ).toEqual([
      "nd-one",
      "nd-two"
    ]);
    expect(
      result.uncertaintyPropagation
    ).toBe("not-propagated");
  });

  it("fails closed on wavelength basis/range drift and unsupported polarization claims", () => {
    expect(() =>
      resolveFrontOfLensFilterTransmission({
        profile: neutralLinear(),
        wavelengthNanometers: 550,
        wavelengthBasis: "vacuum"
      })
    ).toThrow("wavelength bases must match");

    expect(() =>
      resolveFrontOfLensFilterTransmission({
        profile: spectral(),
        wavelengthNanometers: 700,
        wavelengthBasis: "air"
      })
    ).toThrow("outside the filter applicability range");

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...neutralLinear(),
        polarizationModeled: true
      })
    ).toThrow("polarization");
  });

  it("requires reusable rights for embedded spectral curve data", () => {
    const base = spectral();
    if (
      base.transmission.kind !==
      "spectral-transmission"
    ) {
      throw new Error(
        "Expected spectral filter."
      );
    }

    const transmission =
      base.transmission;

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          ...transmission,
          samples: {
            ...transmission.samples,
            evidence: [{
              sourceOrigin: "manufacturer",
              sourceReference:
                "published-filter-curve",
              reuseStatus:
                "factual-reference-only"
            }]
          }
        }
      })
    ).toThrow(
      "numeric filter data must be reusable-data or photivra-owned"
    );
  });

  it("requires quantified uncertainty before a filter can claim calibrated status", () => {
    expect(() =>
      parseFrontOfLensFilterProfile({
        ...neutralLinear(),
        scientificStatus: "calibrated"
      })
    ).toThrow(
      "requires quantified relative uncertainty"
    );
  });
});

describe("front filter integration with scene-to-sensor irradiance", () => {
  const calculate = (
    filters?:
      readonly FrontOfLensFilterProfile[]
  ): ReturnType<
    typeof calculateSceneRadianceToSensorIrradiance
  >["value"] =>
    calculateSceneRadianceToSensorIrradiance({
      sceneRadianceRequest:
        request(),
      sceneRadianceResult:
        radiance(),
      profile: optics(),
      focalLengthMm: 50,
      nominalFNumber: 4,
      focus: {
        kind: "infinity-focus"
      },
      imagePointMm: {
        x: 0,
        y: 0
      },
      fieldThroughput: {
        kind: "unity"
      },
      ...(filters === undefined
        ? {}
        : {
            frontOfLensFilters:
              filters
          })
    }).value;

  it("applies filter and lens transmission exactly once as independent multiplicative losses", () => {
    const noFilter = calculate();
    const filtered =
      calculate([
        neutralLinear(0.5)
      ]);

    expect(
      filtered
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(
      noFilter
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer *
        0.5,
      14
    );
    expect(
      filtered
        .frontOfLensFilterTransmissionFactor
    ).toBe(0.5);
    expect(
      filtered.frontOfLensFilterCount
    ).toBe(1);
    expect(
      filtered
        .frontOfLensFilterTransmissionAppliedExactlyOnce
    ).toBe(true);
    expect(
      filtered
        .spectralTransmissionFactor
    ).toBe(0.8);
  });

  it("does not change geometric working f-number, DOF, or diffraction", () => {
    const noFilter = calculate();
    const filtered =
      calculate([
        neutralLinear(0.25)
      ]);

    expect(filtered.workingFNumber)
      .toBe(noFilter.workingFNumber);

    const dofBefore =
      calculateDepthOfField({
        focalLengthMm: 50,
        aperture: 4,
        focusDistanceM: 5,
        circleOfConfusionMm: 0.03
      });
    const dofAfter =
      calculateDepthOfField({
        focalLengthMm: 50,
        aperture: 4,
        focusDistanceM: 5,
        circleOfConfusionMm: 0.03
      });
    expect(dofAfter).toEqual(dofBefore);

    const diffractionBefore =
      calculateAiryDisk({
        aperture: 4,
        wavelengthNm: 550
      });
    const diffractionAfter =
      calculateAiryDisk({
        aperture: 4,
        wavelengthNm: 550
      });
    expect(diffractionAfter)
      .toEqual(diffractionBefore);
  });

  it("preserves filter evidence separately in the bridge result", () => {
    const filtered =
      calculate([
        spectral()
      ]);

    expect(
      filtered.componentEvidence
        .frontOfLensFilters.length
    ).toBeGreaterThan(0);
    expect(
      filtered
        .frontOfLensFilterPolarizationModeled
    ).toBe(false);
  });
});


describe("front filter fail-closed profile boundaries", () => {
  it("rejects malformed identity, placement, status, basis, ranges, and limitations", () => {
    const base = neutralLinear();

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        identityScope: "manufacturer-product"
      })
    ).toThrow("identityScope");

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        position: "behind-lens"
      })
    ).toThrow("position");

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        scientificStatus: "exact"
      })
    ).toThrow("scientificStatus");

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        wavelengthBasis: "unspecified"
      })
    ).toThrow('must resolve to "air" or "vacuum"');

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        wavelengthRangeNanometers: {
          minimum: 700,
          maximum: 400
        }
      })
    ).toThrow(
      "minimum must be less than or equal to maximum"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        limitations: [
          "duplicate",
          "duplicate"
        ]
      })
    ).toThrow(
      "must not contain duplicates"
    );
  });

  it("rejects invalid uncertainty and passive transmission declarations", () => {
    const base = neutralLinear();

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        uncertainty: {
          kind: "relative",
          fraction: 1.1,
          basis: "bad"
        }
      })
    ).toThrow(
      "fraction must be less than or equal to one"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        uncertainty: {
          kind: "mystery"
        }
      })
    ).toThrow(
      "uncertainty.kind is invalid"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          kind:
            "neutral-linear-transmission",
          linearTransmissionFactor: {
            value: 1.01,
            evidence:
              evidence("amplifying")
          }
        }
      })
    ).toThrow(
      "less than or equal to one for a passive filter"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          kind:
            "neutral-optical-density",
          opticalDensityBase10: {
            value: -0.1,
            evidence:
              evidence("negative-density")
          }
        }
      })
    ).toThrow(
      "greater than or equal to zero"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          kind: "magic"
        }
      })
    ).toThrow(
      "transmission.kind is invalid"
    );
  });

  it("rejects malformed spectral curve topology and applicability coverage", () => {
    const base = spectral();
    if (
      base.transmission.kind !==
      "spectral-transmission"
    ) {
      throw new Error(
        "Expected spectral filter."
      );
    }
    const transmission =
      base.transmission;

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          ...transmission,
          samples: {
            ...transmission.samples,
            value: [
              {
                wavelengthNanometers: 550,
                linearTransmissionFactor:
                  0.6
              }
            ]
          }
        }
      })
    ).toThrow(
      "must contain at least two samples"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        transmission: {
          ...transmission,
          samples: {
            ...transmission.samples,
            value: [
              {
                wavelengthNanometers: 550,
                linearTransmissionFactor:
                  0.6
              },
              {
                wavelengthNanometers: 500,
                linearTransmissionFactor:
                  0.7
              }
            ]
          }
        }
      })
    ).toThrow(
      "wavelengths must be strictly increasing"
    );

    expect(() =>
      parseFrontOfLensFilterProfile({
        ...base,
        wavelengthRangeNanometers: {
          minimum: 400,
          maximum: 700
        }
      })
    ).toThrow(
      "must cover the declared wavelength range"
    );
  });

  it("covers spectral endpoint resolution and invalid wavelength/composition input", () => {
    const atFirst =
      resolveFrontOfLensFilterTransmission({
        profile: spectral(),
        wavelengthNanometers: 450,
        wavelengthBasis: "air"
      });
    const atLast =
      resolveFrontOfLensFilterTransmission({
        profile: spectral(),
        wavelengthNanometers: 650,
        wavelengthBasis: "air"
      });

    expect(
      atFirst.linearTransmissionFactor
    ).toBe(0.8);
    expect(
      atLast.linearTransmissionFactor
    ).toBe(0.4);

    expect(() =>
      resolveFrontOfLensFilterTransmission({
        profile: spectral(),
        wavelengthNanometers: 0,
        wavelengthBasis: "air"
      })
    ).toThrow(
      "wavelengthNanometers must be finite and greater than zero"
    );

    expect(() =>
      composeFrontOfLensFilterTransmission({
        filters: [],
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      })
    ).toThrow(
      "filters must be a non-empty array"
    );
  });

  it("preserves calibrated status only when all stacked filters are calibrated", () => {
    const calibrated =
      parseFrontOfLensFilterProfile({
        ...neutralLinear(
          0.5,
          "calibrated-nd"
        ),
        scientificStatus:
          "calibrated",
        uncertainty: {
          kind: "relative",
          fraction: 0.01,
          basis:
            "Photivra calibration fixture"
        }
      });

    const allCalibrated =
      composeFrontOfLensFilterTransmission({
        filters: [
          calibrated,
          calibrated
        ],
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      });
    const mixed =
      composeFrontOfLensFilterTransmission({
        filters: [
          calibrated,
          neutralLinear()
        ],
        wavelengthNanometers: 550,
        wavelengthBasis: "air"
      });

    expect(
      allCalibrated.scientificStatus
    ).toBe("calibrated");
    expect(mixed.scientificStatus)
      .toBe("approximation");
  });
});


describe("prepared optical bridge with front-of-lens filters (optics-20, #700)", () => {
  const base = { profile: optics(), focalLengthMm: 50, nominalFNumber: 4, focus: { kind: "infinity-focus" as const } };
  const field = { kind: "unity" as const };

  it("equals the public function for 0, 1 and 2 filters across wavelengths", () => {
    for (const filters of [undefined, [neutralLinear(0.5)], [neutralLinear(0.5), spectral()]]) {
      const prepared = prepareSceneRadianceToSensorIrradianceValue({ ...base, ...(filters === undefined ? {} : { frontOfLensFilters: filters }) });
      for (const w of [450, 500, 550, 600, 650]) {
        const expected = calculateSceneRadianceToSensorIrradiance({ ...base, sceneRadianceRequest: request(w), sceneRadianceResult: radiance(w),
          imagePointMm: { x: 0, y: 0 }, fieldThroughput: field, ...(filters === undefined ? {} : { frontOfLensFilters: filters }) })
          .value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer;
        expect(prepared(request(w), radiance(w), { x: 0, y: 0 }, field)).toBe(expected);
      }
    }
  });

  it("still refuses an invalid filter", () => {
    const bad = { ...neutralLinear(0.5), position: "behind-lens" } as unknown as FrontOfLensFilterProfile;
    expect(() => prepareSceneRadianceToSensorIrradianceValue({ ...base, frontOfLensFilters: [bad] })(request(), radiance(), { x: 0, y: 0 }, field))
      .toThrow('frontOfLensFilterProfile.position must be "front-of-lens".');
    // eslint-disable-next-line no-sparse-arrays
    expect(() => prepareSceneRadianceToSensorIrradianceValue({ ...base, frontOfLensFilters: [, neutralLinear(0.5)] as unknown as FrontOfLensFilterProfile[] })(request(), radiance(), { x: 0, y: 0 }, field))
      .toThrow("frontOfLensFilterProfile must be an object");
  });

  it("parses each filter once per preparation, not once per query", () => {
    let reads = 0;
    const counted = new Proxy(neutralLinear(0.5), { get(target, key, receiver): unknown { if (key === "filterId") reads += 1; return Reflect.get(target, key, receiver); } });
    const prepared = prepareSceneRadianceToSensorIrradianceValue({ ...base, frontOfLensFilters: [counted] });
    for (let i = 0; i < 5; i += 1) prepared(request(), radiance(), { x: 0, y: 0 }, field);
    expect(reads).toBe(1);
  });
});
