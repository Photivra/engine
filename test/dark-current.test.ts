// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateSensorDarkCurrentCharge,
  parseSensorDarkCurrentProfile,
  type SensorDarkCurrentProfile,
  type SensorEqeExposureIntegration
} from "../src/index.js";

const evidence = (ref: string) =>
  [{
    sourceOrigin: "photivra" as const,
    sourceReference: ref,
    reuseStatus: "photivra-owned" as const
  }] as const;

function exposure(
  overrides:
    Partial<SensorEqeExposureIntegration> = {}
): SensorEqeExposureIntegration {
  return {
    kind: "eqe-expected-counts",
    colorSamplingProfileId:
      "color",
    channelId: "green",
    site: { x: 1, y: 0 },
    bindingId: "binding",
    stationarityProfileId:
      "stationarity",
    stationarityStatus:
      "established",
    timeReference:
      "first-opening-boundary-phase",
    startOffsetSecondsFromOpeningReference:
      0,
    endOffsetSecondsFromOpeningReference:
      0.5,
    localExposureDurationSeconds:
      0.5,
    integrationMethod:
      "constant-rate-times-local-exposure-duration",
    timeStationarityEstablished:
      true,
    temporalIntegrationApplied:
      true,
    exposureDurationApplied:
      true,
    timeVaryingSignalIntegrated:
      false,
    multiFrameSequenceIntegrated:
      false,
    darkChargeIncluded: false,
    otherChargeIncluded: false,
    accumulatedSignalCompleteness:
      "photo-signal-only",
    physicalFullWellAssessmentAuthorized:
      false,
    cameraSaturationAssessmentAuthorized:
      false,
    saturationAssessed: false,
    shotNoiseApplied: false,
    readNoiseApplied: false,
    adcQuantizationApplied:
      false,
    rawCodeValueProduced: false,
    componentEvidence: {
      stationarity:
        evidence("test:stationarity"),
      exposureBinding: {
        binding:
          evidence("test:binding"),
        colorSamplingProfile:
          evidence("test:color"),
        nominalExposureDuration:
          evidence("test:duration"),
        openingBoundary: [],
        closingBoundary: []
      }
    },
    incidentPhotonRatePerSecond:
      100,
    expectedGeneratedElectronRatePerSecond:
      40,
    expectedIncidentPhotonCount:
      50,
    expectedGeneratedElectronCount:
      20,
    countsAreExpectationValues:
      true,
    integerPhotonCountSampled:
      false,
    integerElectronCountSampled:
      false,
    chargeCalculated: false,
    currentCalculated: false,
    ...overrides
  };
}

function exactProfile(
  overrides:
    Partial<SensorDarkCurrentProfile> = {}
): SensorDarkCurrentProfile {
  return {
    schemaVersion: "0.1.0",
    profileId: "dark",
    colorSamplingProfileId:
      "color",
    channelId: "green",
    scientificStatus:
      "calibrated",
    uncertainty: {
      kind: "relative",
      fraction: 0.05,
      basis: "test"
    },
    evidence:
      evidence("test:dark-current"),
    chargeMeaning:
      "pre-compensation-thermally-generated-electrons",
    siteApplicability: {
      kind: "exact-site",
      site: { x: 1, y: 0 }
    },
    temperatureModel: {
      kind:
        "fixed-reference-temperature",
      referenceTemperatureC: 20,
      darkCurrentElectronsPerSecond:
        4
    },
    darkCurrentCompensationIncluded:
      false,
    spatialDarkCurrentNonuniformityModeled:
      true,
    ...overrides
  };
}

describe("sensor dark-current charge", () => {
  it("integrates exact-site dark current over the exact local exposure duration", () => {
    const result =
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile(),
        operatingTemperatureC: 20
      });

    expect(
      result.value
        .darkCurrentElectronsPerSecond
    ).toBe(4);
    expect(
      result.value
        .expectedDarkElectronCount
    ).toBeCloseTo(2, 12);
    expect(
      result.value
        .temperatureInterpolationUsed
    ).toBe(false);
    expect(
      result.value
        .physicalFullWellAssessmentAuthorized
    ).toBe(false);
    expect(
      result.value
        .darkShotNoiseApplied
    ).toBe(false);
  });

  it("interpolates only inside a measured temperature table", () => {
    const result =
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            temperatureModel: {
              kind:
                "piecewise-linear-temperature-table",
              interpolation:
                "piecewise-linear",
              outsideRangeBehavior:
                "fail-closed",
              samples: [
                {
                  temperatureC: 0,
                  darkCurrentElectronsPerSecond:
                    1
                },
                {
                  temperatureC: 20,
                  darkCurrentElectronsPerSecond:
                    5
                },
                {
                  temperatureC: 40,
                  darkCurrentElectronsPerSecond:
                    13
                }
              ]
            }
          }),
        operatingTemperatureC: 30
      });

    expect(
      result.value
        .darkCurrentElectronsPerSecond
    ).toBeCloseTo(9, 12);
    expect(
      result.value
        .expectedDarkElectronCount
    ).toBeCloseTo(4.5, 12);
    expect(
      result.value
        .temperatureInterpolationUsed
    ).toBe(true);

    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            temperatureModel: {
              kind:
                "piecewise-linear-temperature-table",
              interpolation:
                "piecewise-linear",
              outsideRangeBehavior:
                "fail-closed",
              samples: [
                {
                  temperatureC: 0,
                  darkCurrentElectronsPerSecond:
                    1
                },
                {
                  temperatureC: 20,
                  darkCurrentElectronsPerSecond:
                    5
                }
              ]
            }
          }),
        operatingTemperatureC: 30
      })
    ).toThrow("extrapolation");
  });

  it("interpolates ln(rate) between samples for the log-linear (exponential-in-temperature) table", () => {
    const table = (samples: { temperatureC: number; darkCurrentElectronsPerSecond: number }[]): SensorDarkCurrentProfile => exactProfile({
      temperatureModel: { kind: "log-linear-temperature-table", interpolation: "log-linear", outsideRangeBehavior: "fail-closed", samples } });
    const profile = table([{ temperatureC: 20, darkCurrentElectronsPerSecond: 10 }, { temperatureC: 40, darkCurrentElectronsPerSecond: 100 }]);
    const mid = calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: profile, operatingTemperatureC: 30 }).value;
    // Science review: linear gives 55 e-/s at 30 C; the geometric mean sqrt(10*100) = 31.62 follows the exponential law.
    expect(mid.darkCurrentElectronsPerSecond).toBeCloseTo(Math.sqrt(1000), 12);
    expect(mid.temperatureModel).toBe("log-linear-temperature-table");
    expect(mid.temperatureInterpolationUsed).toBe(true);
    // A constant doubling temperature between samples is reproduced exactly: 10 -> 80 over 30 C doubles every 10 C.
    const doubling = table([{ temperatureC: 0, darkCurrentElectronsPerSecond: 10 }, { temperatureC: 30, darkCurrentElectronsPerSecond: 80 }]);
    for (const [t, rate] of [[10, 20], [20, 40]] as const) {
      expect(calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: doubling, operatingTemperatureC: t })
        .value.darkCurrentElectronsPerSecond).toBeCloseTo(rate, 12);
    }
    expect(calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: profile, operatingTemperatureC: 40 })
      .value.darkCurrentElectronsPerSecond).toBe(100);
    expect(() => calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: profile, operatingTemperatureC: 41 })).toThrow("extrapolation");
    expect(() => parseSensorDarkCurrentProfile(table([{ temperatureC: 0, darkCurrentElectronsPerSecond: 0 },
      { temperatureC: 10, darkCurrentElectronsPerSecond: 1 }]))).toThrow("strictly positive");
    expect(() => parseSensorDarkCurrentProfile(exactProfile({ temperatureModel: { kind: "log-linear-temperature-table",
      interpolation: "piecewise-linear", outsideRangeBehavior: "fail-closed", samples: [] } as never }))).toThrow();
  });

  it("does not invent a temperature law for a fixed-reference calibration", () => {
    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile(),
        operatingTemperatureC: 21
      })
    ).toThrow(
      "exact reference temperature"
    );
  });

  it("supports an explicit uniform-site mean only as approximation", () => {
    const result =
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            scientificStatus:
              "approximation",
            uncertainty: {
              kind:
                "not-quantified",
              limitation:
                "population mean only"
            },
            siteApplicability: {
              kind:
                "uniform-site-mean-approximation",
              limitation:
                "Pixel-to-pixel dark-current variation is not represented.",
              evidence:
                evidence(
                  "test:population-mean"
                )
            },
            spatialDarkCurrentNonuniformityModeled:
              false
          }),
        operatingTemperatureC: 20
      });

    expect(result.provenance.kind)
      .toBe("approximation");
    expect(
      result.value
        .spatialDarkCurrentNonuniformityModeled
    ).toBe(false);
    expect(
      result.value.componentEvidence
        .siteApproximation
    ).toEqual(
      evidence(
        "test:population-mean"
      )
    );
  });

  it("fails closed on site and color/channel identity mismatch", () => {
    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            siteApplicability: {
              kind: "exact-site",
              site: { x: 0, y: 0 }
            }
          }),
        operatingTemperatureC: 20
      })
    ).toThrow(
      "does not apply to the exposure site"
    );

    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            colorSamplingProfileId:
              "other"
          }),
        operatingTemperatureC: 20
      })
    ).toThrow(
      "color/channel identity"
    );
  });

  it("rejects a calibrated profile without quantified uncertainty", () => {
    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        uncertainty: {
          kind: "not-quantified",
          limitation:
            "not measured"
        }
      })
    ).toThrow(
      "must declare quantified"
    );
  });

  it("rejects uniform-site mean profiles that claim calibration or modeled spatial nonuniformity", () => {
    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        siteApplicability: {
          kind:
            "uniform-site-mean-approximation",
          limitation: "mean only",
          evidence:
            evidence("test:mean")
        },
        spatialDarkCurrentNonuniformityModeled:
          false
      })
    ).toThrow(
      "must remain an approximation"
    );

    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile({
          scientificStatus:
            "approximation",
          uncertainty: {
            kind:
              "not-quantified",
            limitation: "mean"
          }
        }),
        siteApplicability: {
          kind:
            "uniform-site-mean-approximation",
          limitation: "mean only",
          evidence:
            evidence("test:mean")
        },
        spatialDarkCurrentNonuniformityModeled:
          true
      })
    ).toThrow(
      "cannot claim spatial dark-current nonuniformity"
    );
  });

  it("validates temperature tables and forbids compensation semantics", () => {
    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        darkCurrentCompensationIncluded:
          true
      })
    ).toThrow(
      "darkCurrentCompensationIncluded"
    );

    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        temperatureModel: {
          kind:
            "piecewise-linear-temperature-table",
          interpolation:
            "piecewise-linear",
          outsideRangeBehavior:
            "fail-closed",
          samples: [
            {
              temperatureC: 20,
              darkCurrentElectronsPerSecond:
                2
            },
            {
              temperatureC: 20,
              darkCurrentElectronsPerSecond:
                3
            }
          ]
        }
      })
    ).toThrow(
      "strictly increasing"
    );
  });

  it("fails closed when dark-charge accumulation overflows", () => {
    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure({
          localExposureDurationSeconds:
            2
        }),
        darkCurrentProfile:
          exactProfile({
            temperatureModel: {
              kind:
                "fixed-reference-temperature",
              referenceTemperatureC:
                20,
              darkCurrentElectronsPerSecond:
                Number.MAX_VALUE
            }
          }),
        operatingTemperatureC: 20
      })
    ).toThrow(
      "must remain finite"
    );
  });

  it("validates dark-current table metadata and runtime temperature inputs", () => {
    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        temperatureModel: {
          kind:
            "piecewise-linear-temperature-table",
          interpolation: "bad",
          outsideRangeBehavior:
            "fail-closed",
          samples: [
            {
              temperatureC: 0,
              darkCurrentElectronsPerSecond:
                1
            },
            {
              temperatureC: 20,
              darkCurrentElectronsPerSecond:
                2
            }
          ]
        }
      })
    ).toThrow("interpolation");

    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        temperatureModel: {
          kind:
            "piecewise-linear-temperature-table",
          interpolation:
            "piecewise-linear",
          outsideRangeBehavior:
            "extrapolate",
          samples: [
            {
              temperatureC: 0,
              darkCurrentElectronsPerSecond:
                1
            },
            {
              temperatureC: 20,
              darkCurrentElectronsPerSecond:
                2
            }
          ]
        }
      })
    ).toThrow("outsideRangeBehavior");

    expect(() =>
      parseSensorDarkCurrentProfile({
        ...exactProfile(),
        spatialDarkCurrentNonuniformityModeled:
          "yes"
      })
    ).toThrow(
      "spatialDarkCurrentNonuniformityModeled"
    );

    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile(),
        operatingTemperatureC:
          Number.NaN
      })
    ).toThrow(
      "operatingTemperatureC must be finite"
    );
  });

  it("uses an exact measured temperature-table sample without interpolation", () => {
    const result =
      calculateSensorDarkCurrentCharge({
        exposure: exposure(),
        darkCurrentProfile:
          exactProfile({
            temperatureModel: {
              kind:
                "piecewise-linear-temperature-table",
              interpolation:
                "piecewise-linear",
              outsideRangeBehavior:
                "fail-closed",
              samples: [
                {
                  temperatureC: 0,
                  darkCurrentElectronsPerSecond:
                    1
                },
                {
                  temperatureC: 20,
                  darkCurrentElectronsPerSecond:
                    5
                }
              ]
            }
          }),
        operatingTemperatureC: 20
      });

    expect(
      result.value
        .darkCurrentElectronsPerSecond
    ).toBe(5);
    expect(
      result.value
        .temperatureInterpolationUsed
    ).toBe(false);
  });

  it("rejects modified or incomplete exposure integrations", () => {
    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure({
          darkChargeIncluded: true
        } as never),
        darkCurrentProfile:
          exactProfile(),
        operatingTemperatureC: 20
      })
    ).toThrow(
      "photo-signal-only"
    );

    expect(() =>
      calculateSensorDarkCurrentCharge({
        exposure: exposure({
          localExposureDurationSeconds:
            Number.POSITIVE_INFINITY
        }),
        darkCurrentProfile:
          exactProfile(),
        operatingTemperatureC: 20
      })
    ).toThrow(
      "duration must be finite"
    );
  });
});

describe("dark-current edge inputs (sensor-11, sensor-23, #701)", () => {
  const table = (samples: { temperatureC: number; darkCurrentElectronsPerSecond: number }[]): SensorDarkCurrentProfile => exactProfile({
    temperatureModel: { kind: "log-linear-temperature-table", interpolation: "log-linear", outsideRangeBehavior: "fail-closed", samples } });

  it("rejects an exposure without a site with a domain error", () => {
    const noSite: Record<string, unknown> = { ...exposure() }; delete noSite.site;
    expect(() => calculateSensorDarkCurrentCharge({ exposure: noSite as never, darkCurrentProfile: exactProfile(), operatingTemperatureC: 20 }))
      .toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });

  it("interpolates an extreme log-linear table without overflow", () => {
    const wide = table([{ temperatureC: 0, darkCurrentElectronsPerSecond: 1e-200 }, { temperatureC: 10, darkCurrentElectronsPerSecond: 1e200 }]);
    expect(calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: wide, operatingTemperatureC: 5 }).value.darkCurrentElectronsPerSecond)
      .toBeCloseTo(1, 12);
    const subnormal = table([{ temperatureC: 0, darkCurrentElectronsPerSecond: 5e-324 }, { temperatureC: 10, darkCurrentElectronsPerSecond: 1 }]);
    const rate = calculateSensorDarkCurrentCharge({ exposure: exposure(), darkCurrentProfile: subnormal, operatingTemperatureC: 5 }).value.darkCurrentElectronsPerSecond;
    expect(Number.isFinite(rate) && rate > 0).toBe(true);
    expect(rate).toBeCloseTo(Math.exp(0.5 * Math.log(5e-324)), 170);
  });
});
