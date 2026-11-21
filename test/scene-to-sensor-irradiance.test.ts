// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateIlluminationVignetting,
  InvalidConfigurationError,
  InvalidScientificInputError,
  calculateSceneRadianceToSensorIrradiance,
  parseSceneToSensorIrradianceProfile,
  type SceneRadianceEvaluationRequest,
  type SceneRadianceEvaluationResult,
  type SceneToSensorIrradianceProfile,
  type SceneToSensorIrradianceResult
} from "../src/index.js";
import { expectRejection, type Json, type MixedRejectionCase, type RejectionCase } from "./helpers/rejection-table.js";

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

const request = (
  wavelengthNanometers = 550,
  wavelengthBasis:
    "air" | "vacuum" = "air"
): SceneRadianceEvaluationRequest => ({
  schemaVersion: "0.1.0",
  sampleId: "sample-1",
  providerProfileId: "provider-1",
  sceneId: "scene-1",
  illuminationProfileId: "illumination-1",
  materialResponseProfileId: "materials-1",
  target: {
    kind: "environment-direction",
    outgoingDirectionUnitVector: {
      x: 0,
      y: 0,
      z: 1
    }
  },
  timeSecondsFromExposureStart: 0.125,
  wavelengthNanometers,
  wavelengthBasis
});

const radiance = (
  value = 10,
  wavelengthNanometers = 550,
  wavelengthBasis:
    "air" | "vacuum" = "air"
): SceneRadianceEvaluationResult => ({
  schemaVersion: "0.1.0",
  sampleId: "sample-1",
  providerProfileId: "provider-1",
  sceneId: "scene-1",
  wavelengthNanometers,
  wavelengthBasis,
  quantity: "outgoing-spectral-radiance",
  unit: "W/m^2/sr/nm",
  spectralRadianceWattsPerSquareMeterSteradianNanometer:
    value,
  scientificStatus: "approximation",
  uncertainty: {
    kind: "not-quantified",
    limitation: "test scene radiance"
  },
  evidence: evidence("scene-radiance"),
  limitations: [
    "Test approximation."
  ]
});

const spectralProfile = (
  factors:
    readonly [number, number, number] =
      [0.8, 0.6, 0.4]
): SceneToSensorIrradianceProfile =>
  parseSceneToSensorIrradianceProfile({
    schemaVersion: "0.1.0",
    profileId: "optics-1",
    profileVersion: "1.0.0",
    lensProfileId: "lens-generic-1",
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
            linearTransmissionFactor:
              factors[0]
          },
          {
            wavelengthNanometers: 550,
            linearTransmissionFactor:
              factors[1]
          },
          {
            wavelengthNanometers: 650,
            linearTransmissionFactor:
              factors[2]
          }
        ],
        evidence:
          evidence("transmission-data")
      },
      uncertainty: {
        kind: "not-quantified",
        limitation:
          "Generic approximation."
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
    evidence: evidence("optical-profile"),
    limitations: [
      "Generic optical-throughput profile."
    ]
  });

const tStopProfile = (
  workingTStop = 4.5
): SceneToSensorIrradianceProfile =>
  parseSceneToSensorIrradianceProfile({
    schemaVersion: "0.1.0",
    profileId: "optics-tstop",
    profileVersion: "1.0.0",
    lensProfileId: "lens-generic-1",
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
      kind:
        "effective-working-t-stop-approximation",
      scientificStatus:
        "approximation",
      workingTStop: {
        value: workingTStop,
        evidence: evidence("working-tstop")
      },
      wavelengthBasis: "air",
      wavelengthRangeNanometers: {
        minimum: 450,
        maximum: 650
      },
      uncertainty: {
        kind: "not-quantified",
        limitation:
          "Photometric approximation used spectrally over declared range."
      },
      limitation:
        "Effective working T-stop approximation."
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
    evidence: evidence("optical-profile"),
    limitations: [
      "Generic optical-throughput profile."
    ]
  });

const calculate = (
  overrides: Partial<
    Parameters<
      typeof calculateSceneRadianceToSensorIrradiance
    >[0]
  > = {}
): SceneToSensorIrradianceResult =>
  calculateSceneRadianceToSensorIrradiance({
    sceneRadianceRequest: request(),
    sceneRadianceResult: radiance(),
    profile: spectralProfile(),
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
    ...overrides
  }).value;

describe("scene radiance to sensor irradiance bridge", () => {
  it("converts wavelength-resolved radiance to pre-sensor-stack irradiance", () => {
    const result = calculate();

    const expectedAcceptance =
      Math.PI / (4 * 4 * 4);
    const expected =
      10 *
      expectedAcceptance *
      0.6;

    expect(
      result
        .paraxialGeometricAcceptanceSolidAngleSteradians
    ).toBeCloseTo(
      expectedAcceptance,
      14
    );
    expect(
      result
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(expected, 14);

    expect(result).toMatchObject({
      inputQuantity:
        "outgoing-spectral-radiance",
      inputUnit: "W/m^2/sr/nm",
      outputQuantity:
        "sensor-plane-spectral-irradiance",
      outputUnit: "W/m^2/nm",
      transmissionPath:
        "spectral-transmission",
      spectralTransmissionFactor: 0.6,
      effectiveWorkingTStop: null,
      fieldThroughputFactor: 1,
      radianceAmplificationApplied:
        false,
      fieldThroughputAppliedExactlyOnce:
        true,
      universalCos4FalloffApplied:
        false,
      distortionAreaCorrectionApplied:
        false,
      psfRedistributionApplied:
        false,
      sensorOpticalStackApplied:
        false,
      cfaApplied: false,
      quantumEfficiencyApplied: false,
      spectralResponsivityApplied:
        false,
      strayLightApplied: false,
      calibratedSensorPlaneIrradianceClaimAuthorized:
        false
    });
  });

  it("maps zero scene radiance to exactly zero sensor irradiance", () => {
    const result = calculate({
      sceneRadianceResult:
        radiance(0)
    });

    expect(
      result
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBe(0);
  });

  it("increases ideal sensor irradiance when f-number is smaller", () => {
    const fast = calculate({
      nominalFNumber: 2
    });
    const slow = calculate({
      nominalFNumber: 4
    });

    expect(
      fast
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer /
        slow
          .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(4, 12);
  });

  it("reduces irradiance with optical transmission without changing geometric working f-number", () => {
    const high = calculate({
      profile:
        spectralProfile([
          0.9,
          0.8,
          0.7
        ])
    });
    const low = calculate({
      profile:
        spectralProfile([
          0.5,
          0.4,
          0.3
        ])
    });

    expect(high.workingFNumber)
      .toBe(low.workingFNumber);
    expect(
      low
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(
      high
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer /
        2,
      12
    );
  });

  it("interpolates spectral transmission at the requested wavelength", () => {
    const result = calculate({
      sceneRadianceRequest:
        request(500),
      sceneRadianceResult:
        radiance(10, 500)
    });

    expect(
      result
        .spectralTransmissionFactor
    ).toBeCloseTo(0.7, 12);
  });

  it("supports an explicitly declared ideal symmetric thin-lens working f-number at close focus", () => {
    const infinity = calculate({
      nominalFNumber: 4,
      focus: {
        kind: "infinity-focus"
      }
    });

    const close = calculate({
      nominalFNumber: 4,
      focus: {
        kind:
          "ideal-symmetric-thin-lens",
        objectDistanceM: 0.5,
        pupilMagnificationAssumption:
          "unity"
      }
    });

    expect(close.workingFNumber)
      .toBeGreaterThan(
        infinity.workingFNumber
      );
    expect(
      close
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeLessThan(
      infinity
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    );
    expect(close.focusModel).toBe(
      "ideal-symmetric-thin-lens"
    );
  });

  it("supports an evidence-backed supplied working f-number", () => {
    const result = calculate({
      focus: {
        kind:
          "supplied-working-f-number",
        focus: {
          kind: "finite",
          objectDistanceM: 0.4
        },
        workingFNumber: {
          value: 5.2,
          evidence:
            evidence("working-f-number")
        },
        basis:
          "Generic lens profile."
      }
    });

    expect(result.workingFNumber)
      .toBe(5.2);
    expect(
      result.componentEvidence
        .workingFNumber
    ).toEqual(
      evidence("working-f-number")
    );
  });

  it("applies field vignetting exactly once and does not add universal cos4 falloff", () => {
    const field =
      calculateIlluminationVignetting({
        imagePointMm: {
          x: 10,
          y: 0
        },
        profile: {
          normalizationRadiusMm: 20,
          maximumNormalizedRadius: 1,
          coefficients: {
            r2: -0.5,
            r4: 0,
            r6: 0
          }
        }
      }).value;

    const unity = calculate({
      imagePointMm: {
        x: 10,
        y: 0
      },
      fieldThroughput: {
        kind: "unity"
      }
    });
    const vignetted = calculate({
      imagePointMm: {
        x: 10,
        y: 0
      },
      fieldThroughput: {
        kind:
          "illumination-vignetting-result",
        result: field
      }
    });

    expect(
      vignetted.fieldThroughputFactor
    ).toBeCloseTo(
      field.linearThroughputFactor,
      12
    );
    expect(
      vignetted
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(
      unity
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer *
        field.linearThroughputFactor,
      12
    );
    expect(
      vignetted.universalCos4FalloffApplied
    ).toBe(false);
  });

  it("uses T-stop as an alternative effective throughput path without separately applying spectral transmission", () => {
    const result = calculate({
      nominalFNumber: 4,
      profile: tStopProfile(4.5)
    });

    const expected =
      10 *
      Math.PI /
      (4 * 4.5 * 4.5);

    expect(result.transmissionPath)
      .toBe(
        "effective-working-t-stop-approximation"
      );
    expect(
      result.spectralTransmissionFactor
    ).toBeNull();
    expect(
      result.effectiveWorkingTStop
    ).toBe(4.5);
    expect(
      result
        .tStopEquivalentTransmissionFactor
    ).toBeCloseTo(
      (4 / 4.5) ** 2,
      12
    );
    expect(
      result
        .sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer
    ).toBeCloseTo(expected, 12);
  });

  it("rejects a passive T-stop approximation smaller than the working f-number", () => {
    expect(() =>
      calculate({
        nominalFNumber: 4,
        profile: tStopProfile(3.5)
      })
    ).toThrow(
      "T-stop must not be smaller"
    );
  });

  it("keeps air/vacuum wavelength basis explicit and fails outside spectral support", () => {
    expect(() =>
      calculate({
        sceneRadianceRequest:
          request(550, "vacuum"),
        sceneRadianceResult:
          radiance(
            10,
            550,
            "vacuum"
          )
      })
    ).toThrow(
      "wavelength bases must match"
    );

    expect(() =>
      calculate({
        sceneRadianceRequest:
          request(700),
        sceneRadianceResult:
          radiance(10, 700)
      })
    ).toThrow(
      "outside the spectral transmission sample range"
    );
  });

  it("fails closed when request/result identity drifts", () => {
    expect(() =>
      calculate({
        sceneRadianceResult: {
          ...radiance(),
          sampleId: "other"
        }
      })
    ).toThrow(
      "request/result identity must match exactly"
    );
  });

  it("enforces focal/aperture/focus applicability", () => {
    expect(() =>
      calculate({
        focalLengthMm: 85
      })
    ).toThrow(
      "focalLengthMm lies outside"
    );

    const finiteOnly =
      parseSceneToSensorIrradianceProfile({
        ...spectralProfile(),
        applicability: {
          ...spectralProfile()
            .applicability,
          focus: {
            kind:
              "finite-distance-range",
            objectDistanceM: {
              minimum: 0.4,
              maximum: 1
            }
          }
        }
      });

    expect(() =>
      calculate({
        profile: finiteOnly,
        focus: {
          kind: "infinity-focus"
        }
      })
    ).toThrow(
      "requires a finite focus distance"
    );

    expect(() =>
      calculate({
        profile: finiteOnly,
        focus: {
          kind:
            "ideal-symmetric-thin-lens",
          objectDistanceM: 2,
          pupilMagnificationAssumption:
            "unity"
        }
      })
    ).toThrow(
      "focus object distance lies outside"
    );
  });

  it("rejects mismatched field-throughput coordinates", () => {
    const field =
      calculateIlluminationVignetting({
        imagePointMm: {
          x: 5,
          y: 0
        },
        profile: {
          normalizationRadiusMm: 20,
          maximumNormalizedRadius: 1,
          coefficients: {
            r2: -0.2,
            r4: 0,
            r6: 0
          }
        }
      }).value;

    expect(() =>
      calculate({
        imagePointMm: {
          x: 10,
          y: 0
        },
        fieldThroughput: {
          kind:
            "illumination-vignetting-result",
          result: field
        }
      })
    ).toThrow(
      "imagePointMm must match"
    );
  });

  it("is deterministic for identical physical inputs", () => {
    const first = calculate();
    const second = calculate();

    expect(second).toEqual(first);
  });
});

describe("optical bridge profile schema guards", () => {
  it("prevents spectral-transmission and T-stop fields from being double-applied", () => {
    expect(() =>
      parseSceneToSensorIrradianceProfile({
        ...spectralProfile(),
        transmission: {
          ...spectralProfile()
            .transmission,
          workingTStop: {
            value: 4.5,
            evidence:
              evidence("tstop")
          }
        }
      })
    ).toThrow(
      "must not include T-stop-only fields"
    );

    expect(() =>
      parseSceneToSensorIrradianceProfile({
        ...tStopProfile(),
        transmission: {
          ...tStopProfile()
            .transmission,
          samples: {
            value: [],
            evidence:
              evidence("samples")
          }
        }
      })
    ).toThrow(
      "must not include spectral transmission samples"
    );
  });

  it("requires reusable provenance for numeric spectral curves", () => {
    const profile =
      spectralProfile();
    if (
      profile.transmission.kind !==
      "spectral-transmission"
    ) {
      throw new Error(
        "Expected spectral profile."
      );
    }
    const transmission =
      profile.transmission;

    expect(() =>
      parseSceneToSensorIrradianceProfile({
        ...profile,
        transmission: {
          ...transmission,
          samples: {
            ...transmission
              .samples,
            evidence: [{
              sourceOrigin:
                "manufacturer",
              sourceReference:
                "published-curve",
              reuseStatus:
                "factual-reference-only"
            }]
          }
        }
      })
    ).toThrow(
      "numeric optical curve data must be reusable-data or photivra-owned"
    );
  });

  it("requires quantified uncertainty for calibrated spectral transmission", () => {
    const profile =
      spectralProfile();
    if (
      profile.transmission.kind !==
      "spectral-transmission"
    ) {
      throw new Error(
        "Expected spectral profile."
      );
    }

    expect(() =>
      parseSceneToSensorIrradianceProfile({
        ...profile,
        scientificStatus:
          "calibrated",
        transmission: {
          ...profile.transmission,
          scientificStatus:
            "calibrated",
          uncertainty: {
            kind:
              "not-quantified",
            limitation: "missing"
          }
        }
      })
    ).toThrow(
      "requires quantified relative uncertainty"
    );
  });

  it("allows calibrated optical data but does not promote approximate scene radiance to calibrated sensor irradiance", () => {
    const profile =
      spectralProfile();
    if (
      profile.transmission.kind !==
      "spectral-transmission"
    ) {
      throw new Error(
        "Expected spectral profile."
      );
    }

    const calibrated =
      parseSceneToSensorIrradianceProfile({
        ...profile,
        scientificStatus:
          "calibrated",
        transmission: {
          ...profile.transmission,
          scientificStatus:
            "calibrated",
          uncertainty: {
            kind: "relative",
            fraction: 0.02,
            basis:
              "Calibration repeatability."
          }
        }
      });

    const result = calculate({
      profile: calibrated
    });

    expect(
      result
        .opticalProfileScientificStatus
    ).toBe("calibrated");
    expect(result.scientificStatus)
      .toBe("approximation");
    expect(
      result
        .calibratedSensorPlaneIrradianceClaimAuthorized
    ).toBe(false);
  });
});

describe("optical bridge image point (optics-17, #700)", () => {
  const vignettingAt = (x: number, y: number): ReturnType<typeof calculateIlluminationVignetting>["value"] => calculateIlluminationVignetting({
    imagePointMm: { x, y },
    profile: { normalizationRadiusMm: 20, maximumNormalizedRadius: 1, coefficients: { r2: -0.5, r4: 0, r6: 0 } }
  }).value;

  it("refuses a non-finite, missing or non-number image point with a field-throughput result", () => {
    const field = { kind: "illumination-vignetting-result" as const, result: vignettingAt(10, 5) };
    expect(calculate({ imagePointMm: { x: 10, y: 5 }, fieldThroughput: field }).sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer).toBeGreaterThan(0);
    for (const imagePointMm of [{ x: NaN, y: NaN }, { x: Infinity, y: 0 }, {}, { x: 10 }, { x: "10", y: "5" }, { x: 0, y: 0 }]) {
      expect(() => calculate({ imagePointMm: imagePointMm as { x: number; y: number }, fieldThroughput: field }), JSON.stringify(imagePointMm))
        .toThrow(InvalidScientificInputError);
    }
  });
});

describe("optical bridge numerical fail-closed guards", () => {
  it("rejects a working f-number so small that paraxial acceptance overflows", () => {
    expect(() =>
      calculate({
        focus: {
          kind:
            "supplied-working-f-number",
          focus: {
            kind: "infinity"
          },
          workingFNumber: {
            value: Number.MIN_VALUE,
            evidence:
              evidence("tiny-working-fnumber")
          },
          basis:
            "Pathological test."
        }
      })
    ).toThrow(
      "Working f-number must be at least 0.5."
    );
  });

  it("rejects sensor-plane irradiance overflow even when every individual input is finite", () => {
    const base =
      spectralProfile([
        1,
        1,
        1
      ]);
    const ultraFast =
      parseSceneToSensorIrradianceProfile({
        ...base,
        applicability: {
          ...base.applicability,
          nominalFNumber: {
            minimum: 0.1,
            maximum: 16
          }
        }
      });

    expect(() =>
      calculate({
        sceneRadianceResult:
          radiance(
            Number.MAX_VALUE
          ),
        profile: ultraFast,
        nominalFNumber: 0.5
      })
    ).toThrow(
      "Sensor-plane spectral irradiance must remain finite"
    );
  });
});


describe("scene-to-sensor irradiance profile and context rejection branches", () => {
  const spectral = (): Json => structuredClone(spectralProfile());
  const tStop = (): Json => structuredClone(tStopProfile());
  const cases: RejectionCase[] = [
    ["a non-object applicability", (p): void => { p.applicability = null; }, "sceneToSensorIrradianceProfile.applicability must be an object."],
    ["a blank profile id", (p): void => { p.profileId = ""; }, "sceneToSensorIrradianceProfile.profileId must be a non-empty string."],
    ["a non-finite applicability bound", (p): void => { p.applicability.focalLengthMm.minimum = Number.NaN; }, ".focalLengthMm.minimum must be finite."],
    ["a zero sample wavelength", (p): void => { p.transmission.samples.value[0].wavelengthNanometers = 0; },
      ".wavelengthNanometers must be greater than zero."],
    ["a transmission above one", (p): void => { p.transmission.samples.value[0].linearTransmissionFactor = 1.2; },
      ".linearTransmissionFactor must be from zero through one."],
    ["an inverted applicability range", (p): void => { p.applicability.nominalFNumber = { minimum: 16, maximum: 1.4 }; },
      ".nominalFNumber.minimum must be less than or equal to maximum."],
    ["an unknown scientific status", (p): void => { p.scientificStatus = "measured"; }, "sceneToSensorIrradianceProfile.scientificStatus is invalid."],
    ["an unknown uncertainty kind", (p): void => { p.transmission.uncertainty = { kind: "interval" }; }, ".uncertainty.kind is invalid."],
    ["non-array limitations", (p): void => { p.limitations = "generic"; }, "sceneToSensorIrradianceProfile.limitations must be an array."],
    ["duplicate limitations", (p): void => { p.limitations = ["a", "a"]; }, "sceneToSensorIrradianceProfile.limitations must not contain duplicates."],
    ["a single transmission sample", (p): void => { p.transmission.samples.value = [p.transmission.samples.value[0]]; },
      " must contain at least two samples."],
    ["non-increasing transmission wavelengths", (p): void => { p.transmission.samples.value[1].wavelengthNanometers = 450; },
      " wavelengths must be strictly increasing."],
    ["an unknown transmission kind", (p): void => { p.transmission.kind = "photometric-t-stop"; }, ".transmission.kind is invalid."],
    ["an unspecified wavelength basis", (p): void => { p.transmission.wavelengthBasis = "unspecified"; }, ' must resolve to "air" or "vacuum".'],
    ["an unknown focus applicability", (p): void => { p.applicability.focus = { kind: "macro-only" }; }, ".applicability.focus.kind is invalid."],
    ["an unsupported schema version", (p): void => { p.schemaVersion = "0.2.0"; }, "sceneToSensorIrradianceProfile.schemaVersion must be"],
    ["a calibrated profile with approximate transmission", (p): void => { p.scientificStatus = "calibrated"; },
      "A calibrated optical bridge profile requires calibrated spectral transmission."]
  ];
  it.each(cases)("rejects a spectral profile with %s", (_name, mutate, message) => {
    expectRejection(spectral, parseSceneToSensorIrradianceProfile, InvalidConfigurationError, mutate, message);
  });
  it("rejects a calibrated T-stop approximation", () => {
    expectRejection(tStop, parseSceneToSensorIrradianceProfile, InvalidConfigurationError,
      (p: Json): void => { p.transmission.scientificStatus = "calibrated"; }, ' T-stop scientificStatus must be "approximation".');
  });

  const context = (): Json => ({ sceneRadianceRequest: request(), sceneRadianceResult: radiance(), profile: spectralProfile(), focalLengthMm: 50,
    nominalFNumber: 4, focus: { kind: "infinity-focus" }, imagePointMm: { x: 0, y: 0 }, fieldThroughput: { kind: "unity" } });
  it.each([
    ["a non-unity pupil magnification", (i: Json): void => { i.focus = { kind: "ideal-symmetric-thin-lens", objectDistanceM: 2,
      pupilMagnificationAssumption: "measured" }; }, 'Ideal symmetric thin-lens focus requires pupilMagnificationAssumption "unity".'],
    ["an unknown focus kind", (i: Json): void => { i.focus = { kind: "autofocus" }; }, "focus.kind is invalid.", InvalidConfigurationError],
    ["a zero supplied working f-number", (i: Json): void => { i.focus = { kind: "supplied-working-f-number",
      focus: { kind: "infinity" }, workingFNumber: { value: 0, evidence: evidence("working") }, basis: "test" }; }, "focus.workingFNumber.value must be finite and greater than zero."],
    ["an unknown field-throughput kind", (i: Json): void => { i.fieldThroughput = { kind: "cos4" }; }, "fieldThroughput.kind is invalid.", InvalidConfigurationError]
  ] as MixedRejectionCase[])("rejects a calculation with %s", (_name, mutate, message, errorClass) => {
    expectRejection(context, (i: Json) => calculateSceneRadianceToSensorIrradiance(i), errorClass ?? InvalidScientificInputError, mutate, message);
  });
});


describe("optical bridge working f-number bound (optics-19, #700)", () => {
  it("enforces a working f-number of at least 0.5 for every focus kind (optics-19)", () => {
    const base = spectralProfile([1, 1, 1]);
    const ultraFast = parseSceneToSensorIrradianceProfile({ ...base, applicability: { ...base.applicability, nominalFNumber: { minimum: 0.1, maximum: 16 } } });
    const atHalf = calculate({ profile: ultraFast, nominalFNumber: 0.5 });
    expect(atHalf.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer).toBeCloseTo(Math.PI * 10, 12);
    const supplied = (value: number): { kind: "supplied-working-f-number"; focus: { kind: "infinity" }; workingFNumber: { value: number; evidence: ReturnType<typeof evidence> }; basis: string } => ({ kind: "supplied-working-f-number" as const, focus: { kind: "infinity" as const },
      workingFNumber: { value, evidence: evidence("working-f-number") }, basis: "Test." });
    expect(calculate({ profile: ultraFast, nominalFNumber: 4, focus: supplied(0.5) }).sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer).toBeCloseTo(Math.PI * 10, 12);
    for (const overrides of [
      { nominalFNumber: 0.49 },
      { nominalFNumber: 0.3, focus: { kind: "ideal-symmetric-thin-lens" as const, objectDistanceM: 1e6, pupilMagnificationAssumption: "unity" as const } },
      { nominalFNumber: 4, focus: supplied(0.49) },
      { nominalFNumber: 4, focus: supplied(0.05) }
    ]) {
      expect(() => calculate({ profile: ultraFast, ...overrides }), JSON.stringify(overrides)).toThrow(/Working f-number must be at least 0\.5/);
    }
  });
});
