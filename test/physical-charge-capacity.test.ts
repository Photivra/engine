// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assessSensorPhysicalChargeCapacity,
  parseSensorPhysicalChargeCapacityProfile,
  type SensorAccumulatedChargeComposition,
  type SensorPhysicalChargeCapacityProfile
} from "../src/index.js";

const evidence = (ref: string) =>
  [{
    sourceOrigin: "photivra" as const,
    sourceReference: ref,
    reuseStatus: "photivra-owned" as const
  }] as const;

const site = { x: 1, y: 0 };

function charge(
  total = 80,
  overrides:
    Partial<SensorAccumulatedChargeComposition> = {}
): SensorAccumulatedChargeComposition {
  return {
    completenessProfileId:
      "complete",
    colorSamplingProfileId:
      "color",
    channelId: "green",
    site,
    bindingId: "binding",
    timeReference:
      "first-opening-boundary-phase",
    startOffsetSecondsFromOpeningReference:
      0,
    endOffsetSecondsFromOpeningReference:
      1,
    localExposureDurationSeconds:
      1,
    photoExpectedElectronCount:
      Math.max(0, total - 2),
    darkExpectedElectronCount: 2,
    additionalExpectedElectronCount:
      0,
    totalExpectedStoredElectronCount:
      total,
    additionalComponents: [],
    accumulatedChargeCompleteness:
      "complete-for-physical-storage-capacity-assessment",
    completenessScientificStatus:
      "calibrated",
    allCountsAreExpectationValues:
      true,
    integerChargeSampled: false,
    photoSignalIncluded: true,
    darkChargeIncluded: true,
    otherChargeIncluded: false,
    darkShotNoiseApplied: false,
    photoShotNoiseApplied: false,
    readNoiseApplied: false,
    physicalFullWellAssessmentAuthorized:
      true,
    cameraSaturationAssessmentAuthorized:
      false,
    saturationAssessed: false,
    bloomingModeled: false,
    adcQuantizationApplied:
      false,
    rawCodeValueProduced: false,
    componentEvidence: {
      completeness:
        evidence("complete"),
      photoSignal: {
        stationarity:
          evidence("stationarity"),
        exposureBinding: {
          binding:
            evidence("binding"),
          colorSamplingProfile:
            evidence("color"),
          nominalExposureDuration:
            evidence("duration"),
          openingBoundary: [],
          closingBoundary: []
        }
      },
      darkCurrent: {
        darkCurrent:
          evidence("dark"),
        siteApproximation: [],
        exposure: {
          stationarity:
            evidence("stationarity"),
          exposureBinding: {
            binding:
              evidence("binding"),
            colorSamplingProfile:
              evidence("color"),
            nominalExposureDuration:
              evidence("duration"),
            openingBoundary: [],
            closingBoundary: []
          }
        }
      }
    },
    ...overrides
  };
}

function capacity(
  overrides:
    Partial<SensorPhysicalChargeCapacityProfile> = {}
): SensorPhysicalChargeCapacityProfile {
  return {
    schemaVersion: "0.1.0",
    profileId: "capacity",
    colorSamplingProfileId:
      "color",
    channelId: "green",
    capacityMeaning:
      "physical-charge-storage-capacity-electrons",
    capacityElectrons: 100,
    scientificStatus:
      "calibrated",
    uncertainty: {
      kind: "relative",
      fraction: 0.05,
      basis: "test"
    },
    evidence:
      evidence("capacity"),
    siteApplicability: {
      kind: "exact-site",
      site
    },
    operatingState: {
      stateId: "state-a",
      evidence:
        evidence("state-a")
    },
    temperatureApplicability: {
      kind:
        "exact-reference-temperature",
      temperatureC: 20
    },
    ...overrides
  };
}

describe(
  "sensor physical charge-capacity assessment",
  () => {
    it("reports expected charge below physical capacity without claiming stochastic saturation state", () => {
      const result =
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(80),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        });

      expect(
        result.value
          .expectedChargeCapacityStatus
      ).toBe("below-capacity");
      expect(
        result.value
          .expectedChargeToCapacityRatio
      ).toBeCloseTo(0.8, 12);
      expect(
        result.value
          .expectedChargeHeadroomElectrons
      ).toBeCloseTo(20, 12);
      expect(
        result.value
          .actualStochasticSaturationStateKnown
      ).toBe(false);
      expect(
        result.value
          .stochasticSaturationProbabilityAssessed
      ).toBe(false);
      expect(
        result.value.clampApplied
      ).toBe(false);
      expect(
        result.value.bloomingModeled
      ).toBe(false);
    });

    it("distinguishes at-capacity and above-capacity expectations without calculating post-saturation charge", () => {
      const at =
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(100),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        }).value;
      expect(
        at.expectedChargeCapacityStatus
      ).toBe("at-capacity");
      expect(
        at.expectedChargeExceedsCapacity
      ).toBe(false);

      const above =
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(125),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        }).value;
      expect(
        above.expectedChargeCapacityStatus
      ).toBe("above-capacity");
      expect(
        above.expectedChargeExceedsCapacity
      ).toBe(true);
      expect(
        above
          .expectedChargeHeadroomElectrons
      ).toBeCloseTo(-25, 12);
      expect(
        above
          .storedChargeAfterPhysicalSaturationCalculated
      ).toBe(false);
      expect(
        above.overflowChargeCalculated
      ).toBe(false);
    });

    it("binds capacity to exact site and operating state", () => {
      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity({
              siteApplicability: {
                kind: "exact-site",
                site: { x: 0, y: 0 }
              }
            }),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "does not apply"
      );

      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity(),
          operatingStateId:
            "other-state",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "operatingStateId"
      );
    });

    it("fails closed when exact reference temperature does not match", () => {
      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            25
        })
      ).toThrow(
        "reference temperature"
      );
    });

    it("permits uniform-site or unmodeled-temperature capacity only as approximation", () => {
      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          siteApplicability: {
            kind:
              "uniform-site-capacity-approximation",
            limitation:
              "population mean",
            evidence:
              evidence("mean")
          }
        })
      ).toThrow(
        "must remain an approximation"
      );

      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          temperatureApplicability: {
            kind: "not-modeled",
            limitation:
              "temperature dependence unknown",
            evidence:
              evidence("temp-unknown")
          }
        })
      ).toThrow(
        "must remain an approximation"
      );

      const result =
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity({
              scientificStatus:
                "approximation",
              uncertainty: {
                kind:
                  "not-quantified",
                limitation:
                  "approximate capacity"
              },
              siteApplicability: {
                kind:
                  "uniform-site-capacity-approximation",
                limitation:
                  "population mean",
                evidence:
                  evidence("mean")
              },
              temperatureApplicability: {
                kind: "not-modeled",
                limitation:
                  "temperature dependence unknown",
                evidence:
                  evidence("temp-unknown")
              }
            }),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            25
        });

      expect(result.provenance.kind)
        .toBe("approximation");
      expect(
        result.value.componentEvidence
          .siteApproximation
      ).toEqual(
        evidence("mean")
      );
      expect(
        result.value.componentEvidence
          .temperatureApproximation
      ).toEqual(
        evidence("temp-unknown")
      );
    });

    it("rejects calibrated capacity without quantified uncertainty", () => {
      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          uncertainty: {
            kind:
              "not-quantified",
            limitation: "unknown"
          }
        })
      ).toThrow(
        "must declare quantified"
      );
    });

    it("rejects camera saturation semantics masquerading as physical capacity", () => {
      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          capacityMeaning:
            "camera-saturation-capacity"
        })
      ).toThrow(
        "capacityMeaning"
      );
    });

    it("requires complete unsaturated stored-charge input", () => {
      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(80, {
              physicalFullWellAssessmentAuthorized:
                false
            } as never),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "complete stored-electron composition"
      );

      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(80, {
              saturationAssessed:
                true
            } as never),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "complete stored-electron composition"
      );
    });

    it("validates capacity applicability metadata and runtime temperature", () => {
      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          siteApplicability: {
            kind: "unknown"
          }
        })
      ).toThrow(
        "siteApplicability.kind"
      );

      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          temperatureApplicability: {
            kind: "unknown"
          }
        })
      ).toThrow(
        "temperatureApplicability.kind"
      );

      expect(() =>
        parseSensorPhysicalChargeCapacityProfile({
          ...capacity(),
          scientificStatus: "unknown"
        })
      ).toThrow(
        "scientificStatus"
      );

      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            Number.NaN
        })
      ).toThrow(
        "operatingTemperatureC must be finite"
      );
    });

    it("rejects mismatched color/channel identity and non-finite expected charge", () => {
      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(),
          capacityProfile:
            capacity({
              colorSamplingProfileId:
                "other"
            }),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "color/channel identity"
      );

      expect(() =>
        assessSensorPhysicalChargeCapacity({
          accumulatedCharge:
            charge(80, {
              totalExpectedStoredElectronCount:
                Number.NaN
            }),
          capacityProfile:
            capacity(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "finite and greater than or equal to zero"
      );
    });
  }
);

describe("nested input errors (sensor-11, #701)", () => {
  it("rejects accumulated charge without a site with a domain error", () => {
    const noSite: Record<string, unknown> = { ...charge(80) }; delete noSite.site;
    expect(() => assessSensorPhysicalChargeCapacity({ accumulatedCharge: noSite as never, capacityProfile: capacity(), operatingStateId: "state-a", operatingTemperatureC: 20 }))
      .toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});
