// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assessSensorCameraSaturationCapacity,
  parseSensorCameraSaturationCapacityProfile,
  type SensorAccumulatedChargeComposition,
  type SensorCameraSaturationCapacityProfile
} from "../src/index.js";

const evidence = (ref: string) =>
  [{
    sourceOrigin: "photivra" as const,
    sourceReference: ref,
    reuseStatus: "photivra-owned" as const
  }] as const;

const site = { x: 1, y: 0 };

function charge(
  photoSignal = 80,
  totalStored = 95,
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
      photoSignal,
    darkExpectedElectronCount:
      Math.max(
        0,
        totalStored - photoSignal
      ),
    additionalExpectedElectronCount:
      0,
    totalExpectedStoredElectronCount:
      totalStored,
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

function profile(
  overrides:
    Partial<SensorCameraSaturationCapacityProfile> = {}
): SensorCameraSaturationCapacityProfile {
  return {
    schemaVersion: "0.1.0",
    profileId: "camera-sat",
    colorSamplingProfileId:
      "color",
    channelId: "green",
    capacityMeaning:
      "camera-signal-saturation-capacity-electrons",
    signalDomain:
      "dark-corrected-photo-generated-electron-equivalent",
    saturationCapacityElectrons:
      100,
    scientificStatus:
      "calibrated",
    uncertainty: {
      kind: "relative",
      fraction: 0.03,
      basis: "test"
    },
    evidence:
      evidence("camera-saturation"),
    measurementMethodId:
      "test-method",
    measurementMethodEvidence:
      evidence("test-method"),
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
  "sensor camera saturation-capacity assessment",
  () => {
    it("compares dark-corrected photo signal rather than total stored charge", () => {
      const result =
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(80, 150),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        });

      expect(
        result.value
          .expectedPhotoSignalElectronCount
      ).toBe(80);
      expect(
        result.value
          .totalExpectedStoredElectronCountDiagnostic
      ).toBe(150);
      expect(
        result.value
          .totalStoredChargeUsedForCameraSaturationComparison
      ).toBe(false);
      expect(
        result.value
          .expectedCameraSignalCapacityStatus
      ).toBe("below-capacity");
      expect(
        result.value
          .expectedSignalToCameraSaturationRatio
      ).toBeCloseTo(0.8, 12);
      expect(
        result.value
          .physicalChargeCapacityUsed
      ).toBe(false);
    });

    it("distinguishes at and above camera capacity without clipping output", () => {
      const at =
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(100, 110),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        }).value;
      expect(
        at.expectedCameraSignalCapacityStatus
      ).toBe("at-capacity");
      expect(
        at.expectedPhotoSignalExceedsCameraCapacity
      ).toBe(false);

      const above =
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(120, 130),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        }).value;
      expect(
        above.expectedCameraSignalCapacityStatus
      ).toBe("above-capacity");
      expect(
        above.expectedPhotoSignalExceedsCameraCapacity
      ).toBe(true);
      expect(
        above.expectedSignalHeadroomElectrons
      ).toBeCloseTo(-20, 12);
      expect(
        above.clampApplied
      ).toBe(false);
      expect(
        above
          .outputSignalAfterSaturationCalculated
      ).toBe(false);
    });

    it("does not infer analog or digital limiting mechanism from saturation capacity", () => {
      const result =
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        }).value;

      expect(
        result
          .limitingSaturationMechanismResolved
      ).toBe(false);
      expect(
        result
          .analogClippingThresholdModeled
      ).toBe(false);
      expect(
        result
          .digitalClippingThresholdModeled
      ).toBe(false);
      expect(
        result.adcMaximumCodeUsed
      ).toBe(false);
      expect(
        result
          .physicalStoredChargeModified
      ).toBe(false);
    });

    it("binds capacity to exact site, channel, and operating state", () => {
      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile({
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
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile({
              channelId: "red"
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
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile(),
          operatingStateId:
            "other",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "operatingStateId"
      );
    });

    it("requires exact reference temperature when declared", () => {
      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            25
        })
      ).toThrow(
        "reference temperature"
      );
    });

    it("keeps population means or unmodeled temperature explicitly approximate", () => {
      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          siteApplicability: {
            kind:
              "channel-population-mean-approximation",
            limitation:
              "channel population mean",
            evidence:
              evidence("mean")
          }
        })
      ).toThrow(
        "must remain an approximation"
      );

      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          temperatureApplicability: {
            kind: "not-modeled",
            limitation:
              "temperature dependence unknown",
            evidence:
              evidence("temp")
          }
        })
      ).toThrow(
        "must remain an approximation"
      );

      const result =
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile({
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
                  "channel-population-mean-approximation",
                limitation:
                  "channel population mean",
                evidence:
                  evidence("mean")
              },
              temperatureApplicability: {
                kind: "not-modeled",
                limitation:
                  "temperature dependence unknown",
                evidence:
                  evidence("temp")
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
        evidence("temp")
      );
    });

    it("rejects physical full-well semantics in the camera capacity profile", () => {
      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          capacityMeaning:
            "physical-charge-storage-capacity-electrons"
        })
      ).toThrow(
        "capacityMeaning"
      );

      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          signalDomain:
            "total-stored-electrons"
        })
      ).toThrow(
        "signalDomain"
      );
    });

    it("rejects calibrated saturation capacity without quantified uncertainty", () => {
      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
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

    it("validates camera-capacity applicability metadata and runtime temperature", () => {
      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          siteApplicability: {
            kind: "unknown"
          }
        })
      ).toThrow(
        "siteApplicability.kind"
      );

      expect(() =>
        parseSensorCameraSaturationCapacityProfile({
          ...profile(),
          scientificStatus:
            "unknown"
        })
      ).toThrow(
        "scientificStatus"
      );

      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            Number.NaN
        })
      ).toThrow(
        "operatingTemperatureC must be finite"
      );
    });

    it("fails closed when the electron-equivalent capacity comparison overflows", () => {
      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(
              Number.MAX_VALUE,
              Number.MAX_VALUE
            ),
          saturationProfile:
            profile({
              saturationCapacityElectrons:
                Number.MIN_VALUE
            }),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "comparison must remain finite"
      );
    });

    it("requires unmodified pre-saturation charge composition and finite photo signal", () => {
      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(80, 95, {
              saturationAssessed:
                true
            } as never),
          saturationProfile:
            profile(),
          operatingStateId:
            "state-a",
          operatingTemperatureC:
            20
        })
      ).toThrow(
        "pre-saturation"
      );

      expect(() =>
        assessSensorCameraSaturationCapacity({
          accumulatedCharge:
            charge(80, 95, {
              photoExpectedElectronCount:
                Number.NaN
            }),
          saturationProfile:
            profile(),
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
    const noSite: Record<string, unknown> = { ...charge(80, 150) }; delete noSite.site;
    expect(() => assessSensorCameraSaturationCapacity({ accumulatedCharge: noSite as never, saturationProfile: profile(), operatingStateId: "state-a", operatingTemperatureC: 20 }))
      .toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});
