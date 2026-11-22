// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  integrateStationarySensorRateOverLocalExposure,
  parseSensorRateTemporalStationarityProfile,
  type SensorEqeElectronRate,
  type SensorRateLocalExposureBinding,
  type SensorRateTemporalStationarityProfile,
  type SensorResponsivityPhotocurrent
} from "../src/index.js";

const evidence = (ref: string) =>
  [{
    sourceOrigin: "photivra" as const,
    sourceReference: ref,
    reuseStatus: "photivra-owned" as const
  }] as const;

const site = {
  x: 1,
  y: 0
};

function eqeRate(
  overrides:
    Partial<SensorEqeElectronRate> = {}
): SensorEqeElectronRate {
  return {
    colorSamplingProfileId:
      "color",
    responseProfileId:
      "spectral",
    responseApplicationProfileId:
      "application",
    operatingRangeProfileId:
      "range",
    site,
    channelId: "green",
    sourceResponseKind:
      "effective-external-quantum-efficiency",
    responseScope:
      "site-incident-effective-channel-response",
    responseReferencePlane:
      "site-incident",
    wavelengthBasis:
      "vacuum",
    wavelengthRangeNanometers: {
      minimum: 400,
      maximum: 500
    },
    spectralNodeCount: 1,
    perWavelength: [],
    incidentPhotonRatePerSecond:
      100,
    expectedGeneratedElectronRatePerSecond:
      40,
    summationMethod:
      "kahan-compensated",
    responseApplicationPerformed:
      true,
    quantumEfficiencyApplied:
      true,
    spectralResponsivityApplied:
      false,
    channelFilterTransmissionApplied:
      false,
    photonRateCalculated: true,
    electronRateCalculated: true,
    photonCountCalculated:
      false,
    electronCountCalculated:
      false,
    currentCalculated: false,
    temporalIntegrationApplied:
      false,
    exposureDurationApplied:
      false,
    saturationAssessed: false,
    shotNoiseApplied: false,
    readNoiseApplied: false,
    adcQuantizationApplied:
      false,
    rawCodeValueProduced:
      false,
    responseUncertaintyPropagated:
      false,
    photonEnergyUncertaintyPropagated:
      false,
    quadratureConvergenceErrorEstimated:
      false,
    ...overrides
  };
}

function currentRate(
  overrides:
    Partial<SensorResponsivityPhotocurrent> = {}
): SensorResponsivityPhotocurrent {
  return {
    colorSamplingProfileId:
      "color",
    responseProfileId:
      "spectral-aw",
    responseApplicationProfileId:
      "application-aw",
    operatingRangeProfileId:
      "range-aw",
    electricalApplicabilityProfileId:
      "electrical",
    site,
    channelId: "green",
    sourceResponseKind:
      "effective-spectral-responsivity",
    responseScope:
      "site-incident-effective-channel-response",
    responseReferencePlane:
      "site-incident",
    wavelengthBasis:
      "vacuum",
    wavelengthRangeNanometers: {
      minimum: 400,
      maximum: 500
    },
    electricalReferenceConditions: {
      bias: {
        kind:
          "zero-bias-photovoltaic"
      },
      readoutLoad: {
        kind:
          "virtual-ground-current-readout"
      }
    },
    operatingElectricalConditions: {
      bias: {
        kind:
          "zero-bias-photovoltaic"
      },
      readoutLoad: {
        kind:
          "virtual-ground-current-readout"
      }
    },
    electricalConditionPolicy: {
      kind:
        "exact-match-required"
    },
    electricalCompatibility:
      "exact-match",
    spectralNodeCount: 1,
    perWavelength: [],
    photocurrentMagnitudeAmperes:
      1e-6,
    currentSignConvention:
      "magnitude-only-no-circuit-polarity",
    summationMethod:
      "kahan-compensated",
    responseApplicationPerformed:
      true,
    spectralResponsivityApplied:
      true,
    quantumEfficiencyApplied:
      false,
    photonRateCalculated:
      false,
    electronRateCalculated:
      false,
    currentCalculated: true,
    chargeCalculated: false,
    temporalResponseModel:
      "quasi-static-steady-state-only",
    detectorBandwidthModeled:
      false,
    transimpedanceGainApplied:
      false,
    voltageCalculated: false,
    temporalIntegrationApplied:
      false,
    exposureDurationApplied:
      false,
    saturationAssessed: false,
    readoutElectronicsLinearityAssessed:
      false,
    shotNoiseApplied: false,
    readNoiseApplied: false,
    adcQuantizationApplied:
      false,
    rawCodeValueProduced:
      false,
    responseUncertaintyPropagated:
      false,
    electricalApplicabilityUncertaintyPropagated:
      false,
    quadratureConvergenceErrorEstimated:
      false,
    componentEvidence: {
      electricalApplicability:
        evidence("test:electrical"),
      electricalConditionAssumption:
        []
    },
    ...overrides
  };
}

function binding(
  rateDomain:
    "eqe-electron-rate" |
    "responsivity-photocurrent" =
      "eqe-electron-rate"
): SensorRateLocalExposureBinding {
  return {
    rateDomain,
    rateIdentity:
      rateDomain ===
        "eqe-electron-rate"
        ? {
            responseProfileId:
              "spectral",
            responseApplicationProfileId:
              "application",
            operatingRangeProfileId:
              "range"
          }
        : {
            responseProfileId:
              "spectral-aw",
            responseApplicationProfileId:
              "application-aw",
            operatingRangeProfileId:
              "range-aw",
            electricalApplicabilityProfileId:
              "electrical"
          },
    colorSamplingProfileId:
      "color",
    channelId: "green",
    site,
    bindingId: "binding",
    bindingRelationship:
      "one-native-effective-sample-to-one-color-site",
    timingCoordinateRule:
      "one-to-one-color-site-center-equals-native-effective-sample-center",
    nativeRasterPoint: {
      x: 1.5,
      y: 0.5
    },
    shutterMechanism:
      "electronic",
    timeReference:
      "first-opening-boundary-phase",
    localExposureWindow: {
      pointNative: {
        x: 1.5,
        y: 0.5
      },
      openingNormalizedScanPosition:
        null,
      closingNormalizedScanPosition:
        null,
      startOffsetSecondsFromOpeningReference:
        0.002,
      endOffsetSecondsFromOpeningReference:
        0.012,
      localExposureDurationSeconds:
        0.01
    },
    localExposureDurationSeconds:
      0.01,
    exposureEventMeaning:
      "single-capture-local-exposure-window",
    nativeImageRasterBindingEstablished:
      true,
    channelAtSiteValidated:
      true,
    physicalPhotodiodeTimingRegistrationEstablished:
      false,
    multiFrameSequenceBindingEstablished:
      false,
    timeStationarityEstablished:
      false,
    constantRateTemporalIntegrationAuthorized:
      false,
    temporalIntegrationApplied:
      false,
    componentEvidence: {
      binding:
        evidence("test:binding"),
      colorSamplingProfile:
        evidence("test:color"),
      nominalExposureDuration:
        evidence("test:duration"),
      openingBoundary: [],
      closingBoundary: []
    }
  };
}

function stationarity(
  rateDomain:
    "eqe-electron-rate" |
    "responsivity-photocurrent" =
      "eqe-electron-rate",
  overrides:
    Partial<SensorRateTemporalStationarityProfile> = {}
): SensorRateTemporalStationarityProfile {
  return {
    schemaVersion: "0.1.0",
    profileId:
      "stationarity",
    rateDomain,
    colorSamplingProfileId:
      "color",
    channelId: "green",
    site,
    bindingId: "binding",
    localExposureWindow: {
      timeReference:
        "first-opening-boundary-phase",
      startOffsetSecondsFromOpeningReference:
        0.002,
      endOffsetSecondsFromOpeningReference:
        0.012
    },
    stationarityMeaning:
      "reported-rate-constant-through-bound-local-exposure",
    status: "established",
    evidence:
      evidence("test:stationarity"),
    ...overrides
  };
}

describe(
  "constant-rate temporal integration",
  () => {
    it("integrates EQE photon/electron rates into expected counts without integer sampling", () => {
      const result =
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity()
        });

      expect(result.provenance.kind)
        .toBe("calculated");
      expect(result.value.kind)
        .toBe(
          "eqe-expected-counts"
        );

      if (
        result.value.kind !==
        "eqe-expected-counts"
      ) {
        throw new Error(
          "Unexpected integration kind"
        );
      }

      expect(
        result.value
          .expectedIncidentPhotonCount
      ).toBeCloseTo(1, 12);
      expect(
        result.value
          .expectedGeneratedElectronCount
      ).toBeCloseTo(0.4, 12);
      expect(
        result.value
          .countsAreExpectationValues
      ).toBe(true);
      expect(
        result.value
          .integerElectronCountSampled
      ).toBe(false);
      expect(
        result.value
          .localExposureDurationSeconds
      ).toBeCloseTo(0.01, 12);
    });

    it("integrates A/W photocurrent to charge magnitude without inferring carriers", () => {
      const result =
        integrateStationarySensorRateOverLocalExposure({
          rate:
            currentRate(),
          exposureBinding:
            binding(
              "responsivity-photocurrent"
            ),
          stationarityProfile:
            stationarity(
              "responsivity-photocurrent"
            )
        });

      expect(result.value.kind)
        .toBe(
          "responsivity-photocurrent-charge"
        );

      if (
        result.value.kind !==
        "responsivity-photocurrent-charge"
      ) {
        throw new Error(
          "Unexpected integration kind"
        );
      }

      expect(
        result.value
          .photochargeMagnitudeCoulombs
      ).toBeCloseTo(1e-8, 18);
      expect(
        result.value
          .carrierCountInferred
      ).toBe(false);
      expect(
        result.value
          .electronCountCalculated
      ).toBe(false);
      expect(
        result.value
          .chargeSignConvention
      ).toBe(
        "magnitude-only-no-carrier-or-circuit-polarity"
      );
    });

    it("keeps fractional expected EQE counts instead of rounding", () => {
      const result =
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate({
            incidentPhotonRatePerSecond:
              12.5,
            expectedGeneratedElectronRatePerSecond:
              3.25
          }),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity()
        }).value;

      if (
        result.kind !==
        "eqe-expected-counts"
      ) {
        throw new Error(
          "Unexpected integration kind"
        );
      }

      expect(
        result.expectedIncidentPhotonCount
      ).toBeCloseTo(0.125, 12);
      expect(
        result.expectedGeneratedElectronCount
      ).toBeCloseTo(0.0325, 12);
    });

    it("allows an explicit stationarity approximation while preserving its limitation", () => {
      const result =
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity(
              "eqe-electron-rate",
              {
                status:
                  "approximation",
                limitation:
                  "Illumination is assumed constant during this short exposure.",
                evidence:
                  evidence(
                    "test:stationarity-approx"
                  )
              }
            )
        });

      expect(result.provenance.kind)
        .toBe("approximation");
      expect(
        result.provenance
          .assumptions
      ).toContain(
        "Illumination is assumed constant during this short exposure."
      );
    });

    it("rejects stationarity evidence for another local window", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity(
              "eqe-electron-rate",
              {
                localExposureWindow: {
                  timeReference:
                    "first-opening-boundary-phase",
                  startOffsetSecondsFromOpeningReference:
                    0.002,
                  endOffsetSecondsFromOpeningReference:
                    0.02
                }
              }
            )
        })
      ).toThrow(
        "must apply to the exact"
      );
    });

    it("rejects stationarity declarations for another domain, site, or binding", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity(
              "responsivity-photocurrent"
            )
        })
      ).toThrow(
        "must apply to the exact"
      );

      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity(
              "eqe-electron-rate",
              {
                bindingId:
                  "other-binding"
              }
            )
        })
      ).toThrow(
        "must apply to the exact"
      );
    });

    it("rejects stale rate identity in the exposure binding", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding: {
            ...binding(),
            rateIdentity: {
              ...binding()
                .rateIdentity,
              operatingRangeProfileId:
                "other-range"
            }
          },
          stationarityProfile:
            stationarity()
        })
      ).toThrow(
        "response-rate identity"
      );
    });

    it("rejects inconsistent local duration snapshots", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding: {
            ...binding(),
            localExposureDurationSeconds:
              0.02
          },
          stationarityProfile:
            stationarity()
        })
      ).toThrow(
        "must exactly equal end minus start"
      );
    });

    it("rejects malformed or already-integrated rates", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate({
            expectedGeneratedElectronRatePerSecond:
              -1
          }),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity()
        })
      ).toThrow(
        "greater than or equal to zero"
      );

      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: currentRate({
            chargeCalculated:
              true
          } as never),
          exposureBinding:
            binding(
              "responsivity-photocurrent"
            ),
          stationarityProfile:
            stationarity(
              "responsivity-photocurrent"
            )
        })
      ).toThrow(
        "no prior charge integration"
      );
    });

    it("fails closed on temporal integration overflow", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate({
            incidentPhotonRatePerSecond:
              Number.MAX_VALUE,
            expectedGeneratedElectronRatePerSecond:
              Number.MAX_VALUE
          }),
          exposureBinding: {
            ...binding(),
            localExposureWindow: {
              ...binding()
                .localExposureWindow,
              endOffsetSecondsFromOpeningReference:
                2
            },
            localExposureDurationSeconds:
              1.998
          },
          stationarityProfile:
            stationarity(
              "eqe-electron-rate",
              {
                localExposureWindow: {
                  timeReference:
                    "first-opening-boundary-phase",
                  startOffsetSecondsFromOpeningReference:
                    0.002,
                  endOffsetSecondsFromOpeningReference:
                    2
                }
              }
            )
        })
      ).toThrow(
        "must remain finite"
      );
    });

    it("keeps saturation and non-photo charge explicitly unauthorized", () => {
      const result =
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding:
            binding(),
          stationarityProfile:
            stationarity()
        }).value;

      expect(
        result.accumulatedSignalCompleteness
      ).toBe("photo-signal-only");
      expect(
        result.darkChargeIncluded
      ).toBe(false);
      expect(
        result.otherChargeIncluded
      ).toBe(false);
      expect(
        result
          .physicalFullWellAssessmentAuthorized
      ).toBe(false);
      expect(
        result
          .cameraSaturationAssessmentAuthorized
      ).toBe(false);
      expect(
        result.saturationAssessed
      ).toBe(false);
      expect(
        result.timeVaryingSignalIntegrated
      ).toBe(false);
      expect(
        result.multiFrameSequenceIntegrated
      ).toBe(false);
    });

    it("rejects consumed/malformed local timing bindings", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding: {
            ...binding(),
            temporalIntegrationApplied:
              true
          } as never,
          stationarityProfile:
            stationarity()
        })
      ).toThrow(
        "must remain an unintegrated local timing binding"
      );
    });

    it("requires exact A/W electrical identity and forbids it on EQE bindings", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate:
            currentRate(),
          exposureBinding: {
            ...binding(
              "responsivity-photocurrent"
            ),
            rateIdentity: {
              ...binding(
                "responsivity-photocurrent"
              ).rateIdentity,
              electricalApplicabilityProfileId:
                "other-electrical"
            }
          },
          stationarityProfile:
            stationarity(
              "responsivity-photocurrent"
            )
        })
      ).toThrow(
        "electrical applicability identity"
      );

      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: eqeRate(),
          exposureBinding: {
            ...binding(),
            rateIdentity: {
              ...binding().rateIdentity,
              electricalApplicabilityProfileId:
                "illegal-electrical"
            }
          },
          stationarityProfile:
            stationarity()
        })
      ).toThrow(
        "must not carry an A/W electrical"
      );
    });

    it("fails closed on A/W charge overflow", () => {
      expect(() =>
        integrateStationarySensorRateOverLocalExposure({
          rate: currentRate({
            photocurrentMagnitudeAmperes:
              Number.MAX_VALUE
          }),
          exposureBinding: {
            ...binding(
              "responsivity-photocurrent"
            ),
            localExposureWindow: {
              ...binding(
                "responsivity-photocurrent"
              ).localExposureWindow,
              endOffsetSecondsFromOpeningReference:
                2
            },
            localExposureDurationSeconds:
              1.998
          },
          stationarityProfile:
            stationarity(
              "responsivity-photocurrent",
              {
                localExposureWindow: {
                  timeReference:
                    "first-opening-boundary-phase",
                  startOffsetSecondsFromOpeningReference:
                    0.002,
                  endOffsetSecondsFromOpeningReference:
                    2
                }
              }
            )
        })
      ).toThrow(
        "constant-current temporal integration must remain finite"
      );
    });

    it("validates stationarity profile schema and approximation limitation", () => {
      expect(() =>
        parseSensorRateTemporalStationarityProfile({
          ...stationarity(),
          schemaVersion: "9.9.9"
        })
      ).toThrow("schemaVersion");

      expect(() =>
        parseSensorRateTemporalStationarityProfile({
          ...stationarity(),
          status:
            "approximation",
          limitation: undefined
        })
      ).toThrow(
        "limitation is required"
      );

      expect(() =>
        parseSensorRateTemporalStationarityProfile({
          ...stationarity(),
          localExposureWindow: {
            ...stationarity()
              .localExposureWindow,
            endOffsetSecondsFromOpeningReference:
              0
          }
        })
      ).toThrow(
        "end must be greater than start"
      );
    });
  }
);

describe("nested input errors (sensor-11, #701)", () => {
  const domain = expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) });
  it("rejects a missing exposure binding or rate identity with a domain error", () => {
    expect(() => integrateStationarySensorRateOverLocalExposure({ rate: eqeRate(), exposureBinding: undefined as never, stationarityProfile: stationarity() })).toThrow(domain);
    const noIdentity: Record<string, unknown> = { ...binding() }; delete noIdentity.rateIdentity;
    expect(() => integrateStationarySensorRateOverLocalExposure({ rate: eqeRate(), exposureBinding: noIdentity as never, stationarityProfile: stationarity() })).toThrow(domain);
  });
});
