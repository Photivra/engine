// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  InvalidScientificInputError,
  assessSensorPhysicalChargeCapacity,
  calculateExpectedSensorReadout,
  createSensorRawCaptureSample,
  parseSensorChargeSamplingProfile,
  parseSensorRawReconstructionProfile,
  parseSensorReadoutConversionProfile,
  resolveCaptureModeColorSamplingContributors,
  resolveSensorRawReconstruction,
  resolveSensorReadoutRegime,
  simulateSensorChargeRealization,
  simulateSensorRawCode,
  type CaptureModeProfile,
  type NativeEffectiveRasterColorSamplingBindingProfile,
  type SensorAccumulatedChargeComposition,
  type SensorChargeRealization,
  type SensorChargeSamplingProfile,
  type SensorColorSamplingProfile,
  type SensorPhysicalChargeCapacityAssessment,
  type SensorPhysicalChargeCapacityProfile,
  type SensorRawCaptureSample,
  type SensorRawCodeSample,
  type SensorRawReconstructionProfile,
  type SensorReadoutConversionProfile
} from "../src/index.js";
import { characterizeReadout } from "../src/sensor/sensor-characteristics.js";

type OwnedEvidence = readonly [{
  sourceOrigin: "photivra";
  sourceReference: string;
  reuseStatus: "photivra-owned";
}];

const evidence = (
  ref: string
): OwnedEvidence => [{
  sourceOrigin: "photivra",
  sourceReference: ref,
  reuseStatus: "photivra-owned"
}] as const;

const site = {
  x: 1,
  y: 0
};

const charge = (
  total = 25,
  overrides:
    Partial<SensorAccumulatedChargeComposition> = {}
): SensorAccumulatedChargeComposition => ({
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
    Math.max(0, total - 5),
  darkExpectedElectronCount: 2,
  additionalExpectedElectronCount:
    3,
  totalExpectedStoredElectronCount:
    total,
  additionalComponents: [{
    componentId: "leakage",
    kind: "leakage",
    expectedElectronCount: 3,
    scientificStatus:
      "approximation",
    uncertainty: {
      kind: "not-quantified",
      limitation: "test"
    },
    evidence:
      evidence("leakage")
  }],
  accumulatedChargeCompleteness:
    "complete-for-physical-storage-capacity-assessment",
  completenessScientificStatus:
    "approximation",
  allCountsAreExpectationValues:
    true,
  integerChargeSampled: false,
  photoSignalIncluded: true,
  darkChargeIncluded: true,
  otherChargeIncluded: true,
  darkShotNoiseApplied: false,
  photoShotNoiseApplied: false,
  readNoiseApplied: false,
  physicalFullWellAssessmentAuthorized:
    true,
  cameraSaturationAssessmentAuthorized:
    false,
  saturationAssessed: false,
  bloomingModeled: false,
  adcQuantizationApplied: false,
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
});

const capacityProfile =
  (): SensorPhysicalChargeCapacityProfile => ({
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
    }
  });

const capacity = (
  accumulated =
    charge()
): SensorPhysicalChargeCapacityAssessment =>
  assessSensorPhysicalChargeCapacity({
    accumulatedCharge:
      accumulated,
    capacityProfile:
      capacityProfile(),
    operatingStateId: "state-a",
    operatingTemperatureC: 20
  }).value;

const samplingProfile =
  (
    model:
      "poisson" |
      "deterministic-expected-electron-equivalent" =
      "deterministic-expected-electron-equivalent"
  ): SensorChargeSamplingProfile =>
    parseSensorChargeSamplingProfile({
      schemaVersion: "0.1.0",
      profileId:
        "charge-sampling",
      completenessProfileId:
        "complete",
      scientificStatus:
        "approximation",
      photoShotNoiseModel:
        "poisson",
      darkShotNoiseModel:
        "poisson",
      additionalComponentPolicies: [{
        componentId: "leakage",
        model
      }],
      evidence:
        evidence("charge-sampling"),
      limitations: [
        "Test charge sampling profile."
      ]
    });

const readoutProfile =
  (): SensorReadoutConversionProfile =>
    parseSensorReadoutConversionProfile({
      schemaVersion: "0.1.0",
      profileId:
        "readout",
      colorSamplingProfileId:
        "color",
      channelId: "green",
      regimeSelectionOwnedBy:
        "explicit-upstream-camera-state-not-inferred-from-iso",
      regimes: [
        {
          regimeId: "base",
          scientificStatus:
            "approximation",
          systemConversionGainElectronsPerCode: {
            value: 0.5,
            evidence:
              evidence("gain-base")
          },
          preAdcSaturationElectronEquivalent: {
            value: 90,
            evidence:
              evidence("analog-limit-base")
          },
          readNoiseComponents: [
            {
              componentId:
                "input-read",
              rmsElectrons: {
                value: 2,
                evidence:
                  evidence("read-rms")
              },
              evidence:
                evidence("read-component")
            }
          ],
          adc: {
            bitDepth: 12,
            blackLevelCode: 64,
            digitalSaturationCode:
              4095,
            transfer:
              "uniform-round-half-up"
          },
          evidence:
            evidence("regime-base"),
          limitations: [
            "Generic test regime."
          ]
        },
        {
          regimeId:
            "high-gain",
          scientificStatus:
            "approximation",
          systemConversionGainElectronsPerCode: {
            value: 0.25,
            evidence:
              evidence("gain-high")
          },
          preAdcSaturationElectronEquivalent: {
            value: 50,
            evidence:
              evidence("analog-limit-high")
          },
          readNoiseComponents: [
            {
              componentId:
                "input-read",
              rmsElectrons: {
                value: 1,
                evidence:
                  evidence("read-high")
              },
              evidence:
                evidence("read-component-high")
            }
          ],
          adc: {
            bitDepth: 12,
            blackLevelCode: 64,
            digitalSaturationCode:
              3500,
            transfer:
              "uniform-round-half-up"
          },
          evidence:
            evidence("regime-high"),
          limitations: [
            "Generic high-gain test regime."
          ]
        }
      ],
      evidence:
        evidence("readout-profile")
    });

describe("sensor stochastic charge realization", () => {
  it("produces deterministic seeded photo/dark shot-noise realization separate from expectation values", () => {
    const first =
      simulateSensorChargeRealization({
        accumulatedCharge:
          charge(),
        samplingProfile:
          samplingProfile(),
        seedUint32: 12345
      }).value;
    const second =
      simulateSensorChargeRealization({
        accumulatedCharge:
          charge(),
        samplingProfile:
          samplingProfile(),
        seedUint32: 12345
      }).value;

    expect(first).toEqual(second);
    expect(
      Number.isSafeInteger(
        first
          .photoRealizedElectronCount
      )
    ).toBe(true);
    expect(
      Number.isSafeInteger(
        first
          .darkRealizedElectronCount
      )
    ).toBe(true);
    expect(
      first.additionalComponents[0]
        ?.realizedElectronEquivalentCount
    ).toBe(3);
    expect(first).toMatchObject({
      photoShotNoiseApplied:
        true,
      darkShotNoiseApplied:
        true,
      electronicReadNoiseApplied:
        false,
      physicalSaturationApplied:
        false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced:
        false,
      deterministicSeededRealization:
        true
    });
    expect(
      charge()
        .totalExpectedStoredElectronCount
    ).toBe(25);
  });

  it("supports explicit Poisson sampling for an additional charge component and the large-mean Poisson path", () => {
    const large =
      charge(1000, {
        photoExpectedElectronCount:
          995,
        totalExpectedStoredElectronCount:
          1000
      });

    const result =
      simulateSensorChargeRealization({
        accumulatedCharge:
          large,
        samplingProfile:
          samplingProfile(
            "poisson"
          ),
        seedUint32: 7
      }).value;

    expect(
      Number.isSafeInteger(
        result
          .photoRealizedElectronCount
      )
    ).toBe(true);
    expect(
      Number.isSafeInteger(
        result
          .additionalComponents[0]
          ?.realizedElectronEquivalentCount
      )
    ).toBe(true);
    expect(
      result
        .totalRealizedStoredElectronEquivalentCount
    ).toBeGreaterThanOrEqual(0);
  });

  it("requires explicit sampling policy for every additional stored-charge component", () => {
    expect(() =>
      simulateSensorChargeRealization({
        accumulatedCharge:
          charge(),
        samplingProfile:
          parseSensorChargeSamplingProfile({
            ...samplingProfile(),
            additionalComponentPolicies:
              []
          }),
        seedUint32: 1
      })
    ).toThrow(
      "exactly one policy"
    );
  });

  it("fails closed on invalid seed and modified upstream charge state", () => {
    expect(() =>
      simulateSensorChargeRealization({
        accumulatedCharge:
          charge(),
        samplingProfile:
          samplingProfile(),
        seedUint32: -1
      })
    ).toThrow(
      "unsigned 32-bit integer"
    );

    expect(() =>
      simulateSensorChargeRealization({
        accumulatedCharge:
          charge(25, {
            saturationAssessed:
              true
          } as never),
        samplingProfile:
          samplingProfile(),
        seedUint32: 1
      })
    ).toThrow(
      "complete unsaturated pre-readout"
    );
  });
});

describe("sensor conversion/read-noise/ADC chain", () => {
  it("resolves explicit conversion regimes without any ISO inference", () => {
    const base =
      resolveSensorReadoutRegime({
        profile:
          readoutProfile(),
        regimeId: "base"
      });
    const high =
      resolveSensorReadoutRegime({
        profile:
          readoutProfile(),
        regimeId: "high-gain"
      });

    expect(
      base.regime
        .systemConversionGainElectronsPerCode
        .value
    ).toBe(0.5);
    expect(
      high.regime
        .systemConversionGainElectronsPerCode
        .value
    ).toBe(0.25);
    expect(
      base.regimeSelectionOwnedBy
    ).toBe(
      "explicit-upstream-camera-state-not-inferred-from-iso"
    );
    expect(
      base
        .combinedReadNoiseRmsElectrons
    ).toBe(2);
  });

  it("calculates expected electronic readout without sampling read noise or quantizing the expectation", () => {
    const accumulated =
      charge(25);
    const result =
      calculateExpectedSensorReadout({
        accumulatedCharge:
          accumulated,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile:
          readoutProfile(),
        regimeId: "base"
      }).value;

    expect(result).toMatchObject({
      expectedStoredElectronCount:
        25,
      expectedElectronEquivalentAfterPreAdcSaturation:
        25,
      preAdcSaturationAppliedToExpectation:
        false,
      systemConversionGainElectronsPerCode:
        0.5,
      expectedCodeBeforeBlackOffset:
        50,
      blackLevelCode: 64,
      expectedCodeBeforeQuantization:
        114,
      electronicReadNoiseMeanElectrons:
        0,
      electronicReadNoiseRmsElectrons:
        2,
      electronicReadNoiseSampled:
        false,
      adcQuantizationApplied:
        false,
      rawCodeValueProduced:
        false,
      isoUsedToInferRegime:
        false
    });
  });

  it("refuses expected linear readout when expected stored charge is already above physical capacity", () => {
    const accumulated =
      charge(120);

    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge:
          accumulated,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile:
          readoutProfile(),
        regimeId: "base"
      })
    ).toThrow(
      "above physical capacity"
    );
  });

  it("generates deterministic RAW code with separate physical, electronic, pre-ADC, and digital stages", () => {
    const accumulated =
      charge(25);
    const realization =
      simulateSensorChargeRealization({
        accumulatedCharge:
          accumulated,
        samplingProfile:
          samplingProfile(),
        seedUint32: 99
      }).value;

    const input = {
      chargeRealization:
        realization,
      physicalCapacityAssessment:
        capacity(accumulated),
      readoutProfile:
        readoutProfile(),
      regimeId: "base",
      readNoiseSeedUint32:
        100
    } as const;

    const first =
      simulateSensorRawCode(
        input
      ).value;
    const second =
      simulateSensorRawCode(
        input
      ).value;

    expect(first).toEqual(second);
    expect(
      Number.isSafeInteger(
        first.rawCode
      )
    ).toBe(true);
    expect(first.rawCode)
      .toBeGreaterThanOrEqual(0);
    expect(first.rawCode)
      .toBeLessThanOrEqual(
        first.digitalSaturationCode
      );
    expect(first).toMatchObject({
      bloomingModeled: false,
      electronicReadNoiseApplied:
        true,
      conversionGainApplied:
        true,
      adcQuantizationApplied:
        true,
      rawCodeValueProduced:
        true,
      isoUsedToInferRegime:
        false,
      deterministicSeededRealization:
        true
    });
  });

  it("applies a scalar physical-capacity clamp without claiming blooming", () => {
    const accumulated =
      charge(25);
    const base =
      simulateSensorChargeRealization({
        accumulatedCharge:
          accumulated,
        samplingProfile:
          samplingProfile(),
        seedUint32: 1
      }).value;
    const saturated:
      SensorChargeRealization = {
      ...base,
      totalRealizedStoredElectronEquivalentCount:
        140
    };

    const raw =
      simulateSensorRawCode({
        chargeRealization:
          saturated,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile:
          readoutProfile(),
        regimeId: "base",
        readNoiseSeedUint32:
          2
      }).value;

    expect(
      raw
        .electronEquivalentAfterPhysicalScalarSaturation
    ).toBe(100);
    expect(
      raw.physicalScalarSaturationApplied
    ).toBe(true);
    expect(
      raw.overflowElectronEquivalentDiagnostic
    ).toBe(40);
    expect(raw.bloomingModeled)
      .toBe(false);
  });

  it("keeps pre-ADC and digital saturation distinct", () => {
    const accumulated =
      charge(25);
    const base =
      simulateSensorChargeRealization({
        accumulatedCharge:
          accumulated,
        samplingProfile:
          samplingProfile(),
        seedUint32: 1
      }).value;
    const high:
      SensorChargeRealization = {
      ...base,
      totalRealizedStoredElectronEquivalentCount:
        80
    };

    const raw =
      simulateSensorRawCode({
        chargeRealization: high,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile:
          readoutProfile(),
        regimeId: "high-gain",
        readNoiseSeedUint32:
          5
      }).value;

    expect(
      raw
        .preAdcSaturationElectronEquivalent
    ).toBe(50);
    expect(
      raw.preAdcSaturationApplied
    ).toBe(true);
    expect(
      raw.physicalScalarSaturationApplied
    ).toBe(false);
    expect(raw.rawCode)
      .toBeLessThanOrEqual(
        raw.digitalSaturationCode
      );
  });

  it("validates readout profile ADC and regime identity", () => {
    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [{
          ...readoutProfile()
            .regimes[0],
          adc: {
            bitDepth: 12,
            blackLevelCode:
              4095,
            digitalSaturationCode:
              4095,
            transfer:
              "uniform-round-half-up"
          }
        }]
      })
    ).toThrow(
      "digitalSaturationCode"
    );

    expect(() =>
      resolveSensorReadoutRegime({
        profile:
          readoutProfile(),
        regimeId: "missing"
      })
    ).toThrow(
      "not declared"
    );
  });
});

const nativeRaster = {
  pixelWidth: 8,
  pixelHeight: 6
};

const colorProfile =
  (): SensorColorSamplingProfile => ({
    schemaVersion: "0.1.0",
    profileId: "color",
    evidence:
      evidence("color-profile"),
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
      anchor:
        "native-sensor-top-left-site"
    }
  });

const bindingProfile =
  (): NativeEffectiveRasterColorSamplingBindingProfile => ({
    schemaVersion: "0.1.0",
    bindingId:
      "color-binding",
    colorSamplingProfileId:
      "color",
    nativeRaster,
    evidence:
      evidence("color-binding"),
    relationship: {
      kind:
        "regular-native-effective-sample-blocks",
      sitesPerNativeSampleX: 1,
      sitesPerNativeSampleY: 1,
      anchor:
        "shared-native-top-left"
    }
  });

const nativeModeProfile =
  (): CaptureModeProfile => ({
    schemaVersion: "0.1.0",
    modes: [{
      modeId: "native",
      evidence:
        evidence("native-mode"),
      acquisition: {
        kind: "single-frame"
      },
      perFrameSampling: {
        kind:
          "native-effective-raster"
      },
      processedImageRaster: {
        value: nativeRaster,
        evidence:
          evidence("native-output")
      },
      dependencies: [
        "color-sampling-model"
      ]
    }]
  });

const groupedModeProfile =
  (): CaptureModeProfile => ({
    schemaVersion: "0.1.0",
    modes: [{
      modeId: "grouped",
      evidence:
        evidence("grouped-mode"),
      acquisition: {
        kind: "single-frame"
      },
      perFrameSampling: {
        kind:
          "grouped-native-samples",
        groupWidthSamples: {
          value: 2,
          evidence:
            evidence("group-width")
        },
        groupHeightSamples: {
          value: 2,
          evidence:
            evidence("group-height")
        }
      },
      processedImageRaster: {
        value: {
          pixelWidth: 4,
          pixelHeight: 3
        },
        evidence:
          evidence("grouped-output")
      },
      dependencies: [
        "color-sampling-model"
      ]
    }]
  });

const contributorsAt = (
  x: number,
  y: number
): ReturnType<typeof resolveCaptureModeColorSamplingContributors> =>
  resolveCaptureModeColorSamplingContributors({
    nativeRaster,
    captureModeProfile:
      nativeModeProfile(),
    modeId: "native",
    colorSamplingProfile:
      colorProfile(),
    bindingProfile:
      bindingProfile(),
    modeSampleIndexFullFrame: {
      x,
      y
    }
  });

const baseRaw = ():
  SensorRawCodeSample => {
    const accumulated =
      charge(25);
    return simulateSensorRawCode({
      chargeRealization:
        simulateSensorChargeRealization({
          accumulatedCharge:
            accumulated,
          samplingProfile:
            samplingProfile(),
          seedUint32: 11
        }).value,
      physicalCapacityAssessment:
        capacity(accumulated),
      readoutProfile:
        readoutProfile(),
      regimeId: "base",
      readNoiseSeedUint32: 12
    }).value;
  };

const rawAt = (
  x: number,
  y: number,
  channelId: string,
  rawCode: number
): SensorRawCodeSample => ({
  ...baseRaw(),
  site: {
    x,
    y
  },
  channelId,
  rawCode
});

const captureRawAt = (
  x: number,
  y: number,
  channelId: string,
  rawCode: number
): SensorRawCaptureSample =>
  createSensorRawCaptureSample({
    rawCode:
      rawAt(
        x,
        y,
        channelId,
        rawCode
      ),
    contributors:
      contributorsAt(x, y)
  });

const reconstructionProfile =
  (): SensorRawReconstructionProfile =>
    parseSensorRawReconstructionProfile({
      schemaVersion: "0.1.0",
      profileId:
        "linear-neighborhood",
      profileVersion: "1.0.0",
      captureModeId: "native",
      colorSamplingProfileId:
        "color",
      scientificStatus:
        "approximation",
      method:
        "explicit-linear-native-neighborhood",
      normalization:
        "weights-sum-to-one-per-output-channel",
      negativeBlackSubtractedValuesAllowed:
        true,
      kernels: [
        {
          outputChannelId:
            "red",
          contributions: [{
            offsetX: -1,
            offsetY: 0,
            sourceChannelId:
              "red",
            weight: 1
          }]
        },
        {
          outputChannelId:
            "green",
          contributions: [{
            offsetX: 0,
            offsetY: 0,
            sourceChannelId:
              "green",
            weight: 1
          }]
        },
        {
          outputChannelId:
            "blue",
          contributions: [{
            offsetX: 0,
            offsetY: 1,
            sourceChannelId:
              "blue",
            weight: 1
          }]
        }
      ],
      evidence:
        evidence("reconstruction"),
      limitations: [
        "Simple explicit test interpolation."
      ]
    });

describe("RAW capture-mode/CFA binding and reconstruction", () => {
  it("creates one native RAW capture sample with absolute CFA phase preserved", () => {
    const sample =
      captureRawAt(
        1,
        0,
        "green",
        1064
      );

    expect(sample).toMatchObject({
      version: "0.1.0",
      captureModeId: "native",
      modeSampleIndexFullFrame: {
        x: 1,
        y: 0
      },
      colorSamplingSite: {
        x: 1,
        y: 0
      },
      channelId: "green",
      rawCode: 1064,
      blackLevelCode: 64,
      cfaPhasePreservedInNativeCoordinates:
        true,
      physicalOrientationApplied:
        false,
      outputRotationApplied:
        false,
      groupedModeCombinationApplied:
        false,
      reconstructionApplied:
        false,
      aliasingModeled: false,
      moireModeled: false
    });
    expect(
      sample
        .blackSubtractedNormalizedCode
    ).toBeCloseTo(
      1000 / 4031,
      12
    );
  });

  it("fails closed for grouped capture modes until combination weights exist", () => {
    const contributors =
      resolveCaptureModeColorSamplingContributors({
        nativeRaster,
        captureModeProfile:
          groupedModeProfile(),
        modeId: "grouped",
        colorSamplingProfile:
          colorProfile(),
        bindingProfile:
          bindingProfile(),
        modeSampleIndexFullFrame: {
          x: 0,
          y: 0
        },
        groupedSamplingAnchor: {
          anchor:
            "native-effective-raster-top-left",
          evidence:
            evidence("group-anchor")
        }
      });

    expect(() =>
      createSensorRawCaptureSample({
        rawCode:
          rawAt(
            0,
            0,
            "red",
            1000
          ),
        contributors
      })
    ).toThrow(
      "grouped/remosaic modes need explicit signal-combination weights"
    );
  });

  it("reconstructs an explicit native CFA neighborhood without changing RAW samples or claiming aliasing", () => {
    const red =
      captureRawAt(
        0,
        0,
        "red",
        1064
      );
    const green =
      captureRawAt(
        1,
        0,
        "green",
        2064
      );
    const blue =
      captureRawAt(
        1,
        1,
        "blue",
        3064
      );
    const before =
      JSON.stringify([
        red,
        green,
        blue
      ]);

    const result =
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [
          red,
          green,
          blue
        ]
      }).value;

    expect(
      result.outputChannels.map(
        (entry) =>
          entry.channelId
      )
    ).toEqual([
      "red",
      "green",
      "blue"
    ]);
    expect(
      result.outputChannels[0]
        ?.linearBlackSubtractedNormalizedValue
    ).toBeCloseTo(
      1000 / 4031,
      12
    );
    expect(
      result.outputChannels[1]
        ?.linearBlackSubtractedNormalizedValue
    ).toBeCloseTo(
      2000 / 4031,
      12
    );
    expect(
      result.outputChannels[2]
        ?.linearBlackSubtractedNormalizedValue
    ).toBeCloseTo(
      3000 / 4031,
      12
    );
    expect(result).toMatchObject({
      cfaAware: true,
      captureModeAware: true,
      sharpeningApplied: false,
      denoisingApplied: false,
      aliasingModeled: false,
      moireModeled: false,
      preSamplingOpticalTransferAdequacyEstablished:
        false,
      reconstructionDoesNotModifyRawSamples:
        true
    });
    expect(
      JSON.stringify([
        red,
        green,
        blue
      ])
    ).toBe(before);
  });

  it("validates each RAW sample against the declared CFA topology", () => {
    const invalid =
      captureRawAt(
        1,
        0,
        "green",
        2064
      );
    const tampered = {
      ...invalid,
      channelId: "red"
    };

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [
          tampered
        ]
      })
    ).toThrow(
      "channelId must match the declared color-sampling topology"
    );
  });

  it("fails closed when reconstruction data or kernel normalization is incomplete", () => {
    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        kernels: [{
          outputChannelId:
            "red",
          contributions: [{
            offsetX: 0,
            offsetY: 0,
            sourceChannelId:
              "red",
            weight: 0.5
          }]
        }]
      })
    ).toThrow(
      "weights must sum to one"
    );

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [
          captureRawAt(
            1,
            0,
            "green",
            2064
          )
        ]
      })
    ).toThrow(
      "missing a required site/channel contribution"
    );
  });
});


describe("sensor RAW closeout validation and edge boundaries", () => {
  it("validates charge-sampling profile schema, models, and component policy identity", () => {
    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        scientificStatus: "calibrated"
      })
    ).toThrow("scientificStatus");

    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        photoShotNoiseModel: "gaussian"
      })
    ).toThrow("must be Poisson");

    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        additionalComponentPolicies: "none"
      })
    ).toThrow("must be an array");

    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        additionalComponentPolicies: [{
          componentId: "leakage",
          model: "unknown"
        }]
      })
    ).toThrow(".model is invalid");

    expect(() =>
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        additionalComponentPolicies: [
          {
            componentId: "same",
            model: "poisson"
          },
          {
            componentId: "same",
            model: "poisson"
          }
        ]
      })
    ).toThrow("duplicate componentId");
  });

  it("handles zero expected charge without inventing stochastic carriers", () => {
    const zeroCharge =
      charge(0, {
        photoExpectedElectronCount: 0,
        darkExpectedElectronCount: 0,
        additionalExpectedElectronCount: 0,
        totalExpectedStoredElectronCount: 0,
        additionalComponents: [],
        otherChargeIncluded: false
      });
    const zeroProfile =
      parseSensorChargeSamplingProfile({
        ...samplingProfile(),
        additionalComponentPolicies: []
      });

    const result =
      simulateSensorChargeRealization({
        accumulatedCharge: zeroCharge,
        samplingProfile: zeroProfile,
        seedUint32: 0
      }).value;

    expect(
      result.photoRealizedElectronCount
    ).toBe(0);
    expect(
      result.darkRealizedElectronCount
    ).toBe(0);
    expect(
      result.totalRealizedStoredElectronEquivalentCount
    ).toBe(0);
  });

  it("validates readout schema, ADC envelope, and read-noise component identity", () => {
    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimeSelectionOwnedBy: "iso-inferred"
      })
    ).toThrow("regimeSelectionOwnedBy");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: []
      })
    ).toThrow("non-empty array");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [
          readoutProfile().regimes[0],
          readoutProfile().regimes[0]
        ]
      })
    ).toThrow("duplicate regimeId");

    const base =
      readoutProfile().regimes[0]!;

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [{
          ...base,
          adc: {
            ...base.adc,
            bitDepth: 0
          }
        }]
      })
    ).toThrow("bitDepth");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [{
          ...base,
          adc: {
            ...base.adc,
            blackLevelCode: -1
          }
        }]
      })
    ).toThrow("blackLevelCode");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [{
          ...base,
          adc: {
            ...base.adc,
            transfer: "truncate"
          }
        }]
      })
    ).toThrow("uniform-round-half-up");

    expect(() =>
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        regimes: [{
          ...base,
          readNoiseComponents: [
            base.readNoiseComponents[0],
            base.readNoiseComponents[0]
          ]
        }]
      })
    ).toThrow("duplicate componentId");

    expect(() =>
      resolveSensorReadoutRegime({
        profile: readoutProfile(),
        regimeId: " "
      })
    ).toThrow("non-empty string");
  });

  it("keeps expected pre-ADC and digital saturation diagnostics explicit", () => {
    const base =
      readoutProfile().regimes[0]!;
    const narrow =
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        profileId: "narrow-readout",
        regimes: [{
          ...base,
          regimeId: "narrow",
          systemConversionGainElectronsPerCode: {
            value: 0.001,
            evidence: evidence("tiny-gain")
          },
          preAdcSaturationElectronEquivalent: {
            value: 10,
            evidence: evidence("low-pre-adc")
          },
          readNoiseComponents: [],
          adc: {
            bitDepth: 12,
            blackLevelCode: 64,
            digitalSaturationCode: 1000,
            transfer: "uniform-round-half-up"
          }
        }]
      });
    const accumulated = charge(25);
    const result =
      calculateExpectedSensorReadout({
        accumulatedCharge: accumulated,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile: narrow,
        regimeId: "narrow"
      }).value;

    expect(
      result.preAdcSaturationAppliedToExpectation
    ).toBe(true);
    expect(
      result.expectedElectronEquivalentAfterPreAdcSaturation
    ).toBe(10);
    expect(
      result.expectedDigitalSaturation
    ).toBe(true);
    expect(
      result.electronicReadNoiseRmsElectrons
    ).toBe(0);
  });

  it("rejects expected-readout identity drift across capacity and conversion profiles", () => {
    const accumulated = charge(25);
    const assessed =
      capacity(accumulated);

    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge: accumulated,
        physicalCapacityAssessment: {
          ...assessed,
          bindingId: "other-binding"
        },
        readoutProfile:
          readoutProfile(),
        regimeId: "base"
      })
    ).toThrow(
      "identity must match the accumulated charge"
    );

    const wrongChannel =
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        profileId:
          "wrong-channel-readout",
        channelId: "red"
      });

    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge: accumulated,
        physicalCapacityAssessment:
          assessed,
        readoutProfile:
          wrongChannel,
        regimeId: "base"
      })
    ).toThrow(
      "profile color/channel identity"
    );
  });

  it("rejects a capacity assessment computed for a different charge (#273)", () => {
    const large = charge(120);
    const stale = capacity(charge(80));

    expect(stale.expectedChargeCapacityStatus)
      .toBe("below-capacity");
    expect(capacity(large).expectedChargeCapacityStatus)
      .toBe("above-capacity");
    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge: large,
        physicalCapacityAssessment: stale,
        readoutProfile: readoutProfile(),
        regimeId: "base"
      })
    ).toThrow(
      "total expected stored electrons differ"
    );

    // A mismatch fails closed even when both totals are below capacity.
    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge: charge(25),
        physicalCapacityAssessment:
          capacity(charge(30)),
        readoutProfile: readoutProfile(),
        regimeId: "base"
      })
    ).toThrow(
      "total expected stored electrons differ"
    );

    // The below/at-capacity flag derives from the assessment's own totals, not its status label.
    expect(() =>
      calculateExpectedSensorReadout({
        accumulatedCharge: large,
        physicalCapacityAssessment: {
          ...stale,
          totalExpectedStoredElectronCount: 120
        },
        readoutProfile: readoutProfile(),
        regimeId: "base"
      })
    ).toThrow(
      "above physical capacity"
    );

    const atCapacity = charge(100);
    expect(
      calculateExpectedSensorReadout({
        accumulatedCharge: atCapacity,
        physicalCapacityAssessment:
          capacity(atCapacity),
        readoutProfile: readoutProfile(),
        regimeId: "base"
      }).value
        .expectedStoredChargeBelowOrAtPhysicalCapacity
    ).toBe(true);

    const realization =
      simulateSensorChargeRealization({
        accumulatedCharge: large,
        samplingProfile: samplingProfile(),
        seedUint32: 7
      }).value;
    expect(() =>
      simulateSensorRawCode({
        chargeRealization: realization,
        physicalCapacityAssessment: stale,
        readoutProfile: readoutProfile(),
        regimeId: "base",
        readNoiseSeedUint32: 8
      })
    ).toThrow(
      "total expected stored electrons differ"
    );
  });

  it("reports digital saturation on both paths when the code lands exactly on the saturation code (#273)", () => {
    const base =
      readoutProfile().regimes[0]!;
    const boundary =
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        profileId: "boundary-readout",
        regimes: [{
          ...base,
          regimeId: "boundary",
          systemConversionGainElectronsPerCode: {
            value: 0.5,
            evidence: evidence("boundary-gain")
          },
          readNoiseComponents: [],
          adc: {
            bitDepth: 12,
            blackLevelCode: 0,
            digitalSaturationCode: 50,
            transfer: "uniform-round-half-up"
          }
        }]
      });
    const accumulated = charge(25);
    const assessed = capacity(accumulated);

    const expected =
      calculateExpectedSensorReadout({
        accumulatedCharge: accumulated,
        physicalCapacityAssessment: assessed,
        readoutProfile: boundary,
        regimeId: "boundary"
      }).value;
    expect(expected.expectedCodeBeforeQuantization)
      .toBe(50);
    expect(expected.expectedDigitalSaturation)
      .toBe(true);

    const realization =
      simulateSensorChargeRealization({
        accumulatedCharge: accumulated,
        samplingProfile: samplingProfile(),
        seedUint32: 11
      }).value;
    const raw = (realized: number): SensorRawCodeSample =>
      simulateSensorRawCode({
        chargeRealization: {
          ...realization,
          totalRealizedStoredElectronEquivalentCount:
            realized
        },
        physicalCapacityAssessment: assessed,
        readoutProfile: boundary,
        regimeId: "boundary",
        readNoiseSeedUint32: 12
      }).value;

    const atWhite = raw(25);
    expect(atWhite.quantizedCodeBeforeDigitalClamp)
      .toBe(50);
    expect(atWhite.rawCode).toBe(50);
    expect(atWhite.digitalSaturationApplied)
      .toBe(true);

    const belowWhite = raw(24.5);
    expect(belowWhite.rawCode).toBe(49);
    expect(belowWhite.digitalSaturationApplied)
      .toBe(false);
  });

  it("covers zero-read-noise RAW conversion and explicit digital saturation", () => {
    const accumulated = charge(25);
    const realization =
      simulateSensorChargeRealization({
        accumulatedCharge:
          accumulated,
        samplingProfile:
          samplingProfile(),
        seedUint32: 22
      }).value;
    const base =
      readoutProfile().regimes[0]!;
    const digitalLimited =
      parseSensorReadoutConversionProfile({
        ...readoutProfile(),
        profileId:
          "digital-limited",
        regimes: [{
          ...base,
          regimeId:
            "digital-limited",
          systemConversionGainElectronsPerCode: {
            value: 0.001,
            evidence:
              evidence("digital-gain")
          },
          preAdcSaturationElectronEquivalent: {
            value: 90,
            evidence:
              evidence("digital-pre-adc")
          },
          readNoiseComponents: [{
            componentId:
              "zero-read-noise",
            rmsElectrons: {
              value: 0,
              evidence:
                evidence("zero-noise")
            },
            evidence:
              evidence("zero-noise-component")
          }],
          adc: {
            bitDepth: 12,
            blackLevelCode: 0,
            digitalSaturationCode:
              1000,
            transfer:
              "uniform-round-half-up"
          }
        }]
      });

    const raw =
      simulateSensorRawCode({
        chargeRealization:
          realization,
        physicalCapacityAssessment:
          capacity(accumulated),
        readoutProfile:
          digitalLimited,
        regimeId:
          "digital-limited",
        readNoiseSeedUint32:
          23
      }).value;

    expect(
      raw.totalElectronicReadNoiseElectrons
    ).toBe(0);
    expect(
      raw.digitalSaturationApplied
    ).toBe(true);
    expect(raw.rawCode)
      .toBe(1000);
    expect(
      raw.lowerCodeClampApplied
    ).toBe(false);
  });

  it("rejects invalid RAW realization seeds, values, and identity drift", () => {
    const accumulated = charge(25);
    const realization =
      simulateSensorChargeRealization({
        accumulatedCharge:
          accumulated,
        samplingProfile:
          samplingProfile(),
        seedUint32: 33
      }).value;
    const assessed =
      capacity(accumulated);

    expect(() =>
      simulateSensorRawCode({
        chargeRealization:
          realization,
        physicalCapacityAssessment:
          assessed,
        readoutProfile:
          readoutProfile(),
        regimeId: "base",
        readNoiseSeedUint32:
          -1
      })
    ).toThrow(
      "unsigned 32-bit integer"
    );

    expect(() =>
      simulateSensorRawCode({
        chargeRealization: {
          ...realization,
          totalRealizedStoredElectronEquivalentCount:
            -1
        },
        physicalCapacityAssessment:
          assessed,
        readoutProfile:
          readoutProfile(),
        regimeId: "base",
        readNoiseSeedUint32:
          1
      })
    ).toThrow(
      "must be finite and nonnegative"
    );

    expect(() =>
      simulateSensorRawCode({
        chargeRealization:
          realization,
        physicalCapacityAssessment: {
          ...assessed,
          channelId: "red"
        },
        readoutProfile:
          readoutProfile(),
        regimeId: "base",
        readNoiseSeedUint32:
          1
      })
    ).toThrow(
      "identity must match the charge realization"
    );
  });

  it("validates RAW capture sample CFA/profile/site identity and code span", () => {
    const contributors =
      contributorsAt(1, 0);
    const valid =
      rawAt(
        1,
        0,
        "green",
        1064
      );

    expect(() =>
      createSensorRawCaptureSample({
        rawCode: {
          ...valid,
          colorSamplingProfileId:
            "other-color"
        },
        contributors
      })
    ).toThrow(
      "color-sampling profile identity"
    );

    expect(() =>
      createSensorRawCaptureSample({
        rawCode: {
          ...valid,
          channelId: "red"
        },
        contributors
      })
    ).toThrow(
      "channel must match"
    );

    expect(() =>
      createSensorRawCaptureSample({
        rawCode: {
          ...valid,
          site: {
            x: 2,
            y: 0
          }
        },
        contributors
      })
    ).toThrow(
      "site must match"
    );

    expect(() =>
      createSensorRawCaptureSample({
        rawCode: {
          ...valid,
          digitalSaturationCode:
            valid.blackLevelCode
        },
        contributors
      })
    ).toThrow(
      "span must be positive"
    );
  });

  it("validates reconstruction profile discriminants and kernel uniqueness", () => {
    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        schemaVersion: "9.9.9"
      })
    ).toThrow("schemaVersion");

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        method: "nearest"
      })
    ).toThrow("method");

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        normalization: "none"
      })
    ).toThrow("normalization");

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        negativeBlackSubtractedValuesAllowed:
          false
      })
    ).toThrow(
      "negativeBlackSubtractedValuesAllowed"
    );

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        kernels: []
      })
    ).toThrow(
      "non-empty array"
    );

    const kernel =
      reconstructionProfile()
        .kernels[0]!;

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        kernels: [
          kernel,
          {
            ...kernel,
            contributions:
              kernel.contributions
          }
        ]
      })
    ).toThrow(
      "duplicate outputChannelId"
    );

    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        kernels: [{
          outputChannelId: "red",
          contributions: []
        }]
      })
    ).toThrow(
      "contributions must be a non-empty array"
    );

    const contribution =
      kernel.contributions[0]!;
    expect(() =>
      parseSensorRawReconstructionProfile({
        ...reconstructionProfile(),
        kernels: [{
          outputChannelId: "red",
          contributions: [
            contribution,
            contribution
          ]
        }]
      })
    ).toThrow(
      "duplicate site/channel references"
    );
  });

  it("fails reconstruction closed on profile/sample identity, duplicates, and out-of-domain kernel coordinates", () => {
    const red =
      captureRawAt(
        0,
        0,
        "red",
        1064
      );
    const green =
      captureRawAt(
        1,
        0,
        "green",
        2064
      );

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile: {
          ...colorProfile(),
          profileId: "other-color"
        },
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [green]
      })
    ).toThrow(
      "profile identity must match"
    );

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: []
      })
    ).toThrow(
      "non-empty RAW neighborhood"
    );

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          reconstructionProfile(),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [
          green,
          green
        ]
      })
    ).toThrow(
      "duplicate site/channel"
    );

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          parseSensorRawReconstructionProfile({
            ...reconstructionProfile(),
            profileId:
              "negative-kernel",
            kernels: [{
              outputChannelId:
                "red",
              contributions: [{
                offsetX: -1,
                offsetY: 0,
                sourceChannelId:
                  "red",
                weight: 1
              }]
            }]
          }),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 0,
          y: 0
        },
        samples: [red]
      })
    ).toThrow(
      "outside the non-negative native sensor coordinate domain"
    );
  });

  it("rejects non-finite reconstructed values rather than silently clamping them", () => {
    const green =
      captureRawAt(
        1,
        0,
        "green",
        2064
      );
    const tampered = {
      ...green,
      blackSubtractedNormalizedCode:
        Number.NaN
    };

    expect(() =>
      resolveSensorRawReconstruction({
        profile:
          parseSensorRawReconstructionProfile({
            ...reconstructionProfile(),
            profileId:
              "green-only",
            kernels: [{
              outputChannelId:
                "green",
              contributions: [{
                offsetX: 0,
                offsetY: 0,
                sourceChannelId:
                  "green",
                weight: 1
              }]
            }]
          }),
        colorSamplingProfile:
          colorProfile(),
        centerSite: {
          x: 1,
          y: 0
        },
        samples: [tampered]
      })
    ).toThrow(
      "must remain finite"
    );
  });
});

describe("RAW capture sample and reconstruction inputs (sensor-11, sensor-17, #701)", () => {
  const domain = expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) });
  const reconstruct = (samples: unknown[], centerSite: unknown = { x: 1, y: 0 }): ReturnType<typeof resolveSensorRawReconstruction> => resolveSensorRawReconstruction({
    profile: reconstructionProfile(), colorSamplingProfile: colorProfile(), centerSite: centerSite as never, samples: samples as never });
  const neighborhood = (): SensorRawCaptureSample[] => [captureRawAt(0, 0, "red", 1064), captureRawAt(1, 0, "green", 2064), captureRawAt(1, 1, "blue", 3064)];

  it("rejects a missing raw code, center site or sample with a domain error", () => {
    expect(() => createSensorRawCaptureSample({ rawCode: undefined as never, contributors: contributorsAt(0, 0) })).toThrow(domain);
    expect(() => reconstruct(neighborhood(), null)).toThrow(domain);
    expect(() => reconstruct([null, ...neighborhood()])).toThrow(domain);
  });

  it("refuses a raw code that is not an integer code inside the ADC range", () => {
    for (const rawCode of [Number.NaN, 99999, -5, 1064.5]) {
      expect(() => createSensorRawCaptureSample({ rawCode: rawAt(0, 0, "red", rawCode), contributors: contributorsAt(0, 0) }), String(rawCode)).toThrow(InvalidScientificInputError);
    }
    expect(() => createSensorRawCaptureSample({ rawCode: { ...rawAt(0, 0, "red", 1064), blackLevelCode: 64.5 }, contributors: contributorsAt(0, 0) })).toThrow(InvalidScientificInputError);
    expect(captureRawAt(0, 0, "red", 1064).rawCode).toBe(1064);
  });

  it("refuses a sample value that is not a number instead of coercing it", () => {
    const [red, green, blue] = neighborhood();
    expect(() => reconstruct([{ ...red!, blackSubtractedNormalizedCode: "0.5" }, green, blue])).toThrow(InvalidScientificInputError);
    expect(reconstruct([red, green, blue]).value.outputChannels.length).toBeGreaterThan(0);
  });
});

describe("lower code clamp report with a declared digital gain (sensor-24, #701)", () => {
  it("reports the clamp for every site below code 0, with or without a digital gain", () => {
    const accumulated = charge(0);
    const realization = simulateSensorChargeRealization({ accumulatedCharge: accumulated, samplingProfile: samplingProfile(), seedUint32: 11 }).value;
    const counts = [undefined, 1, 2].map((digitalGain) => {
      const profile = structuredClone(readoutProfile()) as unknown as { regimes: { systemConversionGainElectronsPerCode: { value: number };
        readNoiseComponents: { rmsElectrons: { value: number } }[]; adc: Record<string, unknown> }[] };
      const regime = profile.regimes[0]!;
      regime.systemConversionGainElectronsPerCode.value = 1;
      regime.readNoiseComponents[0]!.rmsElectrons.value = 50;
      regime.adc.blackLevelCode = 0;
      if (digitalGain !== undefined) regime.adc.digitalGain = digitalGain;
      let below = 0, flagged = 0;
      for (let seed = 0; seed < 200; seed++) {
        const code = simulateSensorRawCode({ chargeRealization: realization, physicalCapacityAssessment: capacity(accumulated), readoutProfile: profile as never,
          regimeId: "base", readNoiseSeedUint32: seed }).value;
        if (Math.floor(code.codeBeforeQuantization + 0.5) < 0) below++;
        if (code.lowerCodeClampApplied) flagged++;
        expect(code.rawCode).toBeGreaterThanOrEqual(0);
      }
      return [below, flagged];
    });
    expect(counts[0]![0]).toBeGreaterThan(50);
    for (const [below, flagged] of counts) expect(flagged).toBe(below);
  });
});

describe("sensor.adcBitDepth with ADC integral non-linearity (sensor-25, #701)", () => {
  it("keeps the declared bit depth and refuses another one with a message naming sensor.adcBitDepth", () => {
    const withInl = structuredClone(readoutProfile()) as unknown as { regimes: { adc: Record<string, unknown> }[] };
    for (const regime of withInl.regimes) {
      regime.adc.integralNonLinearity = { kind: "piecewise-linear-code-offset", evidence: evidence("inl"),
        knots: [{ code: 0, offsetCodes: 0 }, { code: 2000, offsetCodes: 1 }, { code: 4095, offsetCodes: 0 }] };
    }
    const profile = parseSensorReadoutConversionProfile(withInl);
    expect(() => characterizeReadout(profile, 1, { adcBitDepth: 12 } as never)).not.toThrow();
    for (const adcBitDepth of [14, 16]) {
      expect(() => characterizeReadout(profile, 1, { adcBitDepth } as never), String(adcBitDepth)).toThrow(/^sensor\.adcBitDepth cannot change the bit depth/);
    }
  });
});
