// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assessSensorResponseApplicationCompatibility,
  assessSensorResponseOperatingRange,
  calculateSensorEqeElectronRate,
  calculateSensorSpatialSamplingQuadrature,
  calculateSensorSpectralQuadrature,
  InvalidScientificInputError,
  reduceSensorSpatioSpectralIrradiance,
  type SensorResponseApplicationProfile,
  type SensorResponseOperatingRangeProfile,
  type SensorSpectralResponseProfile,
  type SensorSpatioSpectralIrradianceSample,
  type SourcedAirPhaseRefractiveIndex,
  SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT
} from "../src/index.js";
import { expectRejection, type Json, type RejectionCase } from "./helpers/rejection-table.js";
import {
  absentStack, bindingProfile, colorProfile as fixtureColorProfile, imagingArea, makeQuadrature, nativeRaster, samplingProfile
} from "./helpers/spatial-sample-fixture.js";

import { createSensorSpectralResponseChannelBinding } from "../src/sensor/spectral-response.js";
import { evidence, operatingConditions, colorProfile, spectralProfile, applicationProfile, operatingProfile } from "./helpers/eqe-response-fixture.js";

/**
 * #712: a photosite-scale chain. The sensitive aperture is 6 × 6 µm (36 µm², also the response's incident area), so each 50 nm bin
 * of the 400–500 nm range (a 50 nm maximum subinterval) collects
 * irradiance × 1.8e-9 W (1.8e-12 W at 1e-3 W/m²/nm), and the operating range's
 * linear input range is 0 to 1e-11 W per bin.
 */
function photositeQuadrature(): ReturnType<typeof calculateSensorSpatialSamplingQuadrature>["value"] {
  const sampling = samplingProfile();
  return calculateSensorSpatialSamplingQuadrature({ imagingArea, nativeRaster, colorSamplingProfile: fixtureColorProfile(),
    colorSamplingBindingProfile: bindingProfile(), opticalStackProfile: absentStack(), site: { x: 1, y: 0 }, spatialSampleCountX: 1, spatialSampleCountY: 1,
    samplingApertureProfile: { ...sampling, geometricSensitiveAperture: { kind: "uniform-axis-aligned-rectangle", widthMicrometers: 6, heightMicrometers: 6,
      centerOffsetFromSiteCenterMicrometers: { x: 0, y: 0 }, evidence: sampling.geometricSensitiveAperture.evidence } } }).value;
}
function photositeApplicationProfile(profile: SensorResponseApplicationProfile): SensorResponseApplicationProfile {
  return { ...profile, incidentAreaBasis: { kind: "geometric-sensitive-aperture", areaSquareMicrometers: 36 } };
}
function photositeOperatingProfile(profile: SensorResponseOperatingRangeProfile): SensorResponseOperatingRangeProfile {
  return { ...profile, inputRange: { ...profile.inputRange, minimumInclusive: 0, maximumInclusive: 1e-11 } };
}

function buildPipeline(
  kind:
    | "direct-eqe"
    | "separable-eqe"
    | "responsivity" = "direct-eqe",
  wavelengthBasis:
    "air" | "vacuum" = "vacuum",
  maximumSubintervalWidthNanometers =
    100,
  spatialEstablished = true,
  photositeIrradiance?: number
): {
  reduction: ReturnType<
    typeof reduceSensorSpatioSpectralIrradiance
  >["value"];
  compatibility: ReturnType<
    typeof assessSensorResponseApplicationCompatibility
  >["value"];
  operatingRange: ReturnType<
    typeof assessSensorResponseOperatingRange
  >["value"];
  responseProfile:
    SensorSpectralResponseProfile;
} {
  const spatial =
    photositeIrradiance === undefined
      ? makeQuadrature().value
      : photositeQuadrature();
  const responseProfile =
    spectralProfile(
      kind,
      wavelengthBasis
    );
  const spectral =
    calculateSensorSpectralQuadrature({
      colorSamplingProfile:
        colorProfile(),
      spectralResponseProfile:
        responseProfile,
      channelId: "green",
      wavelengthBasis,
      wavelengthRangeNanometers: {
        minimum: 400,
        maximum: 500
      },
      maximumSubintervalWidthNanometers
    }).value;

  const sampleValues:
    SensorSpatioSpectralIrradianceSample[] =
      spectral.nodes.flatMap(
        (spectralNode) =>
          spatial.nodes.map(
            (spatialNode) => ({
              node: {
                spatialNode: {
                  antiAliasingComponentIndex:
                    spatialNode
                      .antiAliasingComponentIndex,
                  apertureSampleXIndex:
                    spatialNode
                      .apertureSampleXIndex,
                  apertureSampleYIndex:
                    spatialNode
                      .apertureSampleYIndex
                },
                spectralSampleIndex:
                  spectralNode
                    .spectralSampleIndex,
                wavelengthNanometers:
                  spectralNode
                    .wavelengthNanometers
              },
              spectralIrradianceWattsPerSquareMeterPerNanometer:
                photositeIrradiance ?? 2
            })
          )
      );

  const reduction =
    reduceSensorSpatioSpectralIrradiance({
      spatialQuadrature: spatial,
      spectralQuadrature:
        spectral,
      sampleValues
    }).value;

  const compatibility =
    assessSensorResponseApplicationCompatibility({
      reduction,
      applicationProfile:
        photositeIrradiance === undefined
          ? applicationProfile()
          : photositeApplicationProfile(applicationProfile()),
      sourcePlane: {
        value: "site-incident",
        evidence: evidence(
          "test:site-plane"
        )
      },
      operatingConditions
    }).value;

  const operatingRange =
    assessSensorResponseOperatingRange({
      reduction,
      compatibility,
      operatingRangeProfile:
        photositeIrradiance === undefined
          ? operatingProfile(
              wavelengthBasis,
              spatialEstablished
            )
          : photositeOperatingProfile(
              operatingProfile(
                wavelengthBasis,
                spatialEstablished
              )
            )
    }).value;

  return {
    reduction,
    compatibility,
    operatingRange,
    responseProfile
  };
}

/** Deep copy with every object's keys in reverse insertion order (#276 key-order regression). */
function reverseKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeyOrder) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entry]) => [key, reverseKeyOrder(entry)])
  ) as T;
}

describe(
  "sensor EQE electron-rate conversion",
  () => {
    it("converts per-node vacuum spectral power to photon and expected electron rates", () => {
      const pipeline =
        buildPipeline();
      const result =
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        });

      const node =
        result.value.perWavelength[0]!;
      const expectedPower =
        2 *
        480_000 *
        1e-12 *
        100;
      const expectedPhotonEnergy =
        6.62607015e-34 *
        299_792_458 /
        (450e-9);
      const expectedPhotonRate =
        expectedPower /
        expectedPhotonEnergy;
      const expectedElectronRate =
        expectedPhotonRate * 0.4;

      expect(
        node.radiantPowerContributionWatts
      ).toBeCloseTo(
        expectedPower,
        15
      );
      expect(
        node.photonEnergyJoules /
          expectedPhotonEnergy
      ).toBeCloseTo(1, 14);
      expect(
        node.incidentPhotonRatePerSecond /
          expectedPhotonRate
      ).toBeCloseTo(1, 12);
      expect(
        node.effectiveExternalQuantumEfficiency
      ).toBeCloseTo(0.4, 12);
      expect(
        node.expectedGeneratedElectronRatePerSecond /
          expectedElectronRate
      ).toBeCloseTo(1, 12);
      expect(
        result.value
          .incidentPhotonRatePerSecond /
          expectedPhotonRate
      ).toBeCloseTo(1, 12);
      expect(
        result.value
          .expectedGeneratedElectronRatePerSecond /
          expectedElectronRate
      ).toBeCloseTo(1, 12);
      expect(
        result.value
          .summationMethod
      ).toBe("kahan-compensated");
    });

    it("uses the existing resolver for separable filter times detector EQE", () => {
      const pipeline =
        buildPipeline(
          "separable-eqe"
        );
      const result =
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        }).value;

      const node =
        result.perWavelength[0]!;
      expect(
        node.responseComposition
      ).toBe(
        "channel-filter-transmittance-times-detector-eqe"
      );
      expect(
        node.channelFilterTransmittance
      ).toBeCloseTo(0.5, 12);
      expect(
        node.detectorExternalQuantumEfficiency
      ).toBeCloseTo(0.6, 12);
      expect(
        node.effectiveExternalQuantumEfficiency
      ).toBeCloseTo(0.3, 12);
      expect(
        result
          .channelFilterTransmissionApplied
      ).toBe(true);
    });

    it("supports air-basis nodes only with exact per-node phase-index data", () => {
      const pipeline =
        buildPipeline(
          "direct-eqe",
          "air"
        );
      const result =
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile,
          airPhotonEnergyContext: {
            samples: [{
              spectralSampleIndex: 0,
              refractiveIndex: {
                wavelengthNanometers:
                  450,
                wavelengthBasis:
                  "air",
                definition:
                  "vacuum-wavelength-divided-by-air-wavelength",
                phaseRefractiveIndex:
                  1.00027,
                scientificStatus:
                  "calibrated",
                uncertainty: {
                  kind: "relative",
                  fraction: 1e-7,
                  basis: "test"
                },
                evidence: evidence(
                  "test:air-index"
                ),
                referenceConditions: {
                  temperatureC: 20,
                  pressurePascal:
                    101_325
                }
              }
            }],
            operatingConditions: {
              temperatureC: 20,
              pressurePascal:
                101_325
            },
            conditionPolicy: {
              kind:
                "exact-match-required"
            }
          }
        }).value;

      expect(
        result.perWavelength[0]
          ?.vacuumWavelengthNanometers
      ).toBeCloseTo(
        450 * 1.00027,
        12
      );
      expect(
        result.perWavelength[0]
          ?.airConditionCompatibility
      ).toBe("exact-match");
    });

    it("rejects A/W responsivity before any rate conversion", () => {
      const pipeline =
        buildPipeline(
          "responsivity"
        );

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "photon-rate-to-electrons"
      );
    });

    it("rejects an operating-range assessment that lacks spatial superposition authorization", () => {
      const pipeline =
        buildPipeline(
          "direct-eqe",
          "vacuum",
          100,
          false
        );

      expect(
        pipeline.operatingRange
          .responseRateConversionAuthorized
      ).toBe(false);
      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "authorize a clean"
      );
    });

    it("binds response calibration evidence, not only profile IDs", () => {
      const pipeline =
        buildPipeline();

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            spectralProfile(
              "direct-eqe",
              "vacuum",
              "test:different-curve-evidence"
            )
        })
      ).toThrow(
        "response-channel binding"
      );
    });

    it("rejects numeric EQE calibration drift even when IDs and evidence are unchanged", () => {
      const pipeline =
        buildPipeline();
      const original =
        spectralProfile();
      const channel =
        original.channels[0]!;
      if (
        channel.kind !==
        "effective-external-quantum-efficiency"
      ) {
        throw new Error(
          "test fixture must be direct EQE"
        );
      }
      const drifted = {
        ...original,
        channels: [{
          ...channel,
          externalQuantumEfficiency: {
            ...channel
              .externalQuantumEfficiency,
            samples: [
              {
                wavelengthNanometers:
                  400,
                value: 0.25
              },
              {
                wavelengthNanometers:
                  500,
                value: 0.65
              }
            ]
          }
        }]
      } as SensorSpectralResponseProfile;

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            drifted
        })
      ).toThrow(
        "response-channel binding"
      );
    });

    it("rejects missing air phase-index samples", () => {
      const pipeline =
        buildPipeline(
          "direct-eqe",
          "air"
        );

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "exactly one refractive-index sample"
      );
    });

    it("rejects mutated per-wavelength radiant-power contributions", () => {
      const pipeline =
        buildPipeline();
      const mutated = {
        ...pipeline.reduction,
        perWavelength:
          pipeline.reduction
            .perWavelength.map(
              (node, index) =>
                index === 0
                  ? {
                      ...node,
                      wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts:
                        node
                          .wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts *
                        2
                    }
                  : node
            )
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction: mutated,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "must equal spectral flux density"
      );
    });

    it("rejects A/W response even if an external authorization snapshot is forged to the EQE path", () => {
      const pipeline =
        buildPipeline(
          "responsivity"
        );
      const compatibility = {
        ...pipeline.compatibility,
        requiredSignalPath:
          "photon-rate-to-electrons" as const
      };
      const operatingRange = {
        ...pipeline.operatingRange,
        requiredSignalPath:
          "photon-rate-to-electrons" as const
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility,
          operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "not A/W responsivity"
      );
    });

    it("fails closed when a wavelength-node photon-rate calculation overflows", () => {
      const pipeline =
        buildPipeline();
      const node =
        pipeline.reduction
          .perWavelength[0]!;
      const hugeContribution =
        Number.MAX_VALUE;
      const hugeFluxDensity =
        hugeContribution /
        node.wavelengthMeasureNanometers;
      const reduction = {
        ...pipeline.reduction,
        perWavelength: [{
          ...node,
          geometricApertureIncidentSpectralFluxWattsPerNanometer:
            hugeFluxDensity,
          wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts:
            hugeContribution
        }],
        wavelengthIntegratedGeometricApertureIncidentFluxWatts:
          hugeContribution
      };
      const operatingRange = {
        ...pipeline.operatingRange,
        inputRange: {
          ...pipeline.operatingRange
            .inputRange,
          minimumInclusive: 0,
          maximumInclusive:
            Number.MAX_VALUE
        },
        evaluatedInput: {
          ...pipeline.operatingRange
            .evaluatedInput,
          value: hugeContribution
        },
        evaluatedSpectralNodeInputs: [{
          ...pipeline.operatingRange
            .evaluatedSpectralNodeInputs![0]!,
          value: hugeContribution
        }]
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "rate calculation must remain finite"
      );
    });

    it("fails closed when finite wavelength-node rates overflow only in the total sum", () => {
      const pipeline =
        buildPipeline(
          "direct-eqe",
          "vacuum",
          50
        );
      const contribution =
        4e289;
      const reduction = {
        ...pipeline.reduction,
        perWavelength:
          pipeline.reduction
            .perWavelength.map(
              (node) => ({
                ...node,
                geometricApertureIncidentSpectralFluxWattsPerNanometer:
                  contribution /
                  node
                    .wavelengthMeasureNanometers,
                wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts:
                  contribution
              })
            ),
        wavelengthIntegratedGeometricApertureIncidentFluxWatts:
          contribution * 2
      };
      const operatingRange = {
        ...pipeline.operatingRange,
        inputRange: {
          ...pipeline.operatingRange
            .inputRange,
          minimumInclusive: 0,
          maximumInclusive: 1e300
        },
        evaluatedInput: {
          ...pipeline.operatingRange
            .evaluatedInput,
          value: contribution * 2
        },
        evaluatedSpectralNodeInputs:
          pipeline.operatingRange
            .evaluatedSpectralNodeInputs!
            .map((entry) => ({
              ...entry,
              value: contribution
            }))
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "Total EQE photon/electron rates must remain finite"
      );
    });

    it("keeps exposure, counts, saturation, noise, current and RAW downstream", () => {
      const pipeline =
        buildPipeline();
      const result =
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        });

      expect(
        result.provenance.kind
      ).toBe("approximation");
      expect(
        result.value
          .responseApplicationPerformed
      ).toBe(true);
      expect(
        result.value
          .quantumEfficiencyApplied
      ).toBe(true);
      expect(
        result.value
          .photonRateCalculated
      ).toBe(true);
      expect(
        result.value
          .electronRateCalculated
      ).toBe(true);
      expect(
        result.value
          .photonCountCalculated
      ).toBe(false);
      expect(
        result.value
          .electronCountCalculated
      ).toBe(false);
      expect(
        result.value
          .temporalIntegrationApplied
      ).toBe(false);
      expect(
        result.value
          .saturationAssessed
      ).toBe(false);
      expect(
        result.value
          .shotNoiseApplied
      ).toBe(false);
      expect(
        result.value
          .currentCalculated
      ).toBe(false);
      expect(
        result.value
          .rawCodeValueProduced
      ).toBe(false);
      expect(
        result.value
          .responseUncertaintyPropagated
      ).toBe(false);
      expect(
        result.value
          .photonEnergyUncertaintyPropagated
      ).toBe(false);
    });

    it("uses multiple spectral nodes without collapsing to broadband-average QE", () => {
      const pipeline =
        buildPipeline(
          "direct-eqe",
          "vacuum",
          50
        );
      const result =
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        }).value;

      expect(
        result.spectralNodeCount
      ).toBe(2);
      expect(
        result.perWavelength.map(
          (node) =>
            node
              .effectiveExternalQuantumEfficiency
        )
      ).toEqual([
        0.3,
        0.5
      ]);
      expect(
        result.perWavelength.every(
          (node) =>
            node.radiantPowerContributionWatts >
            0
        )
      ).toBe(true);
    });

    it("rejects stale per-bin operating-range authorization", () => {
      const pipeline =
        buildPipeline();

      const evaluated =
        pipeline.operatingRange
          .evaluatedSpectralNodeInputs;
      expect(evaluated).toBeDefined();

      const staleValue = {
        ...pipeline.operatingRange,
        evaluatedSpectralNodeInputs:
          evaluated!.map(
            (entry, index) =>
              index === 0
                ? {
                    ...entry,
                    value:
                      entry.value * 2
                  }
                : entry
          )
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            staleValue,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "spectral-node values must match"
      );

      const staleRange = {
        ...pipeline.operatingRange,
        evaluatedWavelengthRangeNanometers:
          {
            minimum: 410,
            maximum: 500
          }
      };

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            staleRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "wavelength range must exactly match"
      );
    });

    it("rejects malformed reduction spectral-node identity", () => {
      const pipeline =
        buildPipeline();

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction: {
            ...pipeline.reduction,
            spectralNodeCount: 2
          },
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "exactly spectralNodeCount entries"
      );

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction: {
            ...pipeline.reduction,
            perWavelength:
              pipeline.reduction
                .perWavelength.map(
                  (entry) => ({
                    ...entry,
                    spectralSampleIndex:
                      1
                  })
                )
          },
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "exact contiguous range"
      );
    });

    it("rejects air context on vacuum data and duplicate air sample identities", () => {
      const vacuum =
        buildPipeline();

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            vacuum.reduction,
          compatibility:
            vacuum.compatibility,
          operatingRange:
            vacuum.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            vacuum.responseProfile,
          airPhotonEnergyContext: {
            samples: [],
            conditionPolicy: {
              kind:
                "assume-compatible",
              limitation:
                "invalid for vacuum",
              evidence:
                evidence("bad")
            }
          }
        })
      ).toThrow(
        "must be omitted for vacuum"
      );

      const air =
        buildPipeline(
          "direct-eqe",
          "air",
          50
        );
      const indexSample = (
        spectralSampleIndex: number,
        wavelengthNanometers: number
      ): {
        spectralSampleIndex: number;
        refractiveIndex:
          SourcedAirPhaseRefractiveIndex;
      } => ({
        spectralSampleIndex,
        refractiveIndex: {
          wavelengthNanometers,
          wavelengthBasis:
            "air" as const,
          definition:
            "vacuum-wavelength-divided-by-air-wavelength" as const,
          phaseRefractiveIndex:
            1.00027,
          scientificStatus:
            "approximation" as const,
          uncertainty: {
            kind:
              "not-quantified" as const,
            limitation:
              "test"
          },
          evidence:
            evidence("air-index")
        }
      });

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            air.reduction,
          compatibility:
            air.compatibility,
          operatingRange:
            air.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            air.responseProfile,
          airPhotonEnergyContext: {
            samples: [
              indexSample(0, 425),
              indexSample(0, 475)
            ],
            conditionPolicy: {
              kind:
                "assume-compatible",
              limitation:
                "test",
              evidence:
                evidence("air-policy")
            }
          }
        })
      ).toThrow(
        "unique in-range spectral sample identities"
      );
    });

    it("rejects response uncertainty and profile identity drift", () => {
      const pipeline =
        buildPipeline();
      const changed =
        spectralProfile();
      const channel =
        changed.channels[0]!;
      const changedResponse = {
        ...changed,
        channels: [{
          ...channel,
          uncertainty: {
            kind:
              "relative" as const,
            fraction: 0.03,
            basis: "different"
          }
        }]
      } as SensorSpectralResponseProfile;

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile:
            colorProfile(),
          spectralResponseProfile:
            changedResponse
        })
      ).toThrow(
        "response-channel binding"
      );

      expect(() =>
        calculateSensorEqeElectronRate({
          reduction:
            pipeline.reduction,
          compatibility:
            pipeline.compatibility,
          operatingRange:
            pipeline.operatingRange,
          colorSamplingProfile: {
            ...colorProfile(),
            profileId:
              "different-color"
          },
          spectralResponseProfile:
            pipeline.responseProfile
        })
      ).toThrow(
        "profiles must exactly match"
      );
    });

    it("binds a spectral response channel independently of key order and never from unparsed input", () => {
      const channel = buildPipeline().responseProfile.channels[0]!;
      const binding = createSensorSpectralResponseChannelBinding(channel);
      expect(createSensorSpectralResponseChannelBinding(reverseKeyOrder(channel))).toEqual(binding);
      // 2.0.0: an unparsed field is rejected by name instead of being dropped from the binding.
      expect(() => createSensorSpectralResponseChannelBinding({ ...channel, unexpected: "caller-only" } as unknown as typeof channel))
        .toThrow('sensorSpectralResponseChannel has unknown field "unexpected".');
      expect(binding.canonicalJson).not.toContain("caller-only");
      expect(() => createSensorSpectralResponseChannelBinding({ ...channel, channelId: "" })).toThrow("channelId");
    });

    it("uses binding format v2 and rejects a 1.5.0 v1 binding with an explicit version error", () => {
      const pipeline = buildPipeline();
      expect(pipeline.reduction.responseChannelBinding?.format).toBe("photivra-spectral-channel-response-canonical-json-v2");
      expect(SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT).toBe("photivra-spectral-channel-response-canonical-json-v2");
      const legacy = {
        ...pipeline.reduction,
        responseChannelBinding: { ...pipeline.reduction.responseChannelBinding!, format: "photivra-spectral-channel-response-canonical-json-v1" }
      } as unknown as typeof pipeline.reduction;
      const input = {
        compatibility: pipeline.compatibility,
        operatingRange: pipeline.operatingRange,
        colorSamplingProfile: colorProfile(),
        spectralResponseProfile: pipeline.responseProfile
      };
      expect(() => calculateSensorEqeElectronRate({ ...input, reduction: legacy })).toThrow(/format v1 \(package 1\.5\.0 and earlier\) is not supported/);
      const unknown = { ...pipeline.reduction, responseChannelBinding: { ...pipeline.reduction.responseChannelBinding!, format: "other" } } as unknown as typeof pipeline.reduction;
      expect(() => calculateSensorEqeElectronRate({ ...input, reduction: unknown })).toThrow(/unsupported format/);
      expect(() => calculateSensorEqeElectronRate({ ...input, reduction: pipeline.reduction })).not.toThrow();
    });

    it("matches semantically equal reduction metadata regardless of key order", () => {
      const pipeline = buildPipeline();
      const baseline = calculateSensorEqeElectronRate({
        reduction: pipeline.reduction,
        compatibility: pipeline.compatibility,
        operatingRange: pipeline.operatingRange,
        colorSamplingProfile: colorProfile(),
        spectralResponseProfile: pipeline.responseProfile
      });
      const reordered = calculateSensorEqeElectronRate({
        reduction: reverseKeyOrder(pipeline.reduction),
        compatibility: pipeline.compatibility,
        operatingRange: pipeline.operatingRange,
        colorSamplingProfile: colorProfile(),
        spectralResponseProfile: reverseKeyOrder(pipeline.responseProfile)
      });
      expect(reordered.value.perWavelength).toEqual(baseline.value.perWavelength);
    });
  }
);

describe("sensor EQE electron-rate authorization-chain rejection branches", () => {
  // Two 50 nm spectral nodes so ordering, weight and power-sum checks have more than one entry.
  const base = (): Json => {
    const pipeline = buildPipeline("direct-eqe", "vacuum", 50);
    return structuredClone({ reduction: pipeline.reduction, compatibility: pipeline.compatibility, operatingRange: pipeline.operatingRange,
      colorSamplingProfile: colorProfile(), spectralResponseProfile: pipeline.responseProfile });
  };
  it("converts the two-node base pipeline", () => {
    expect(base().reduction.perWavelength).toHaveLength(2);
    expect(() => calculateSensorEqeElectronRate(base())).not.toThrow();
  });
  const cases: RejectionCase[] = [
    ["a reduction that already applied QE", (i): void => { i.reduction.quantumEfficiencyApplied = true; },
      "reduction must remain pre-response and pre-temporal before EQE rate conversion."],
    ["a compatibility for another channel", (i): void => { i.compatibility.channelId = "red"; }, "compatibility identities must exactly match the reduction."],
    ["an aggregate spectral input model", (i): void => { i.operatingRange.spectralInputModel = { kind: "aggregate" }; },
      "operatingRange must establish per-spectral-bin input-range applicability"],
    ["no spatial linearity model", (i): void => { i.operatingRange.spatialLinearityModel = { kind: "unknown" }; },
      "operatingRange must establish linear superposition over the geometric aperture."],
    ["an operating range for another channel", (i): void => { i.operatingRange.channelId = "red"; },
      "operatingRange identities must exactly match the reduction and compatibility assessment."],
    ["non-increasing reduction wavelengths", (i): void => { i.reduction.perWavelength[1].wavelengthNanometers = i.reduction.perWavelength[0].wavelengthNanometers; },
      "reduction per-wavelength samples must be strictly increasing in wavelength."],
    ["overflowing wavelength weights", (i): void => { for (const w of i.reduction.perWavelength) w.normalizedWavelengthWeight = Number.MAX_VALUE; },
      "reduction normalized wavelength weights must remain finite."],
    ["weights that do not sum to one", (i): void => { for (const w of i.reduction.perWavelength) w.normalizedWavelengthWeight = 0.4; },
      "reduction normalized wavelength weights must sum to 1."],
    ["a total power that disagrees with its contributions", (i): void => { i.reduction.wavelengthIntegratedGeometricApertureIncidentFluxWatts *= 2; },
      "reduction total geometric-aperture radiant power must match the sum of per-wavelength contributions."],
    ["missing evaluated spectral-node inputs", (i): void => { i.operatingRange.evaluatedSpectralNodeInputs = []; },
      "operatingRange must carry one evaluated spectral-node input for every reduction wavelength node."],
    ["a shifted evaluated spectral node", (i): void => { i.operatingRange.evaluatedSpectralNodeInputs[0].wavelengthNanometers += 1; },
      "operatingRange spectral-node identities must exactly match the reduction."],
    ["an unspecified wavelength basis", (i): void => { i.reduction.wavelengthBasis = "unspecified"; },
      "EQE electron-rate conversion requires a resolved air or vacuum wavelength basis."],
    ["a reduction built from a differently classified response", (i): void => { i.reduction.responseScientificStatus = "approximation"; },
      "Resolved spectral response metadata must exactly match the response used to construct the reduction."],
    ["reduction curve evidence that differs from the response", (i): void => { i.reduction.componentEvidence.spectral.curves = []; },
      "Resolved spectral response evidence must match the calibration evidence carried by the reduction."]
  ];
  it.each(cases)("rejects %s", (_name, mutate, message) => {
    expectRejection(base, calculateSensorEqeElectronRate, InvalidScientificInputError, mutate, message);
  });
});

describe("consistency checks at photosite power (#712)", () => {
  // Per-bin powers of 1e-15 to 1e-10 W all differ by less than 1e-10, so an absolute tolerance accepted any of them as equal.
  const dim = buildPipeline("direct-eqe", "vacuum", 50, true, 1e-3), bright = buildPipeline("direct-eqe", "vacuum", 50, true, 3e-2);
  const convert = (chain: { reduction: unknown; compatibility: unknown; operatingRange: unknown }): unknown => calculateSensorEqeElectronRate({ reduction: chain.reduction, compatibility: chain.compatibility, operatingRange: chain.operatingRange, colorSamplingProfile: colorProfile(),
    spectralResponseProfile: dim.responseProfile } as Parameters<typeof calculateSensorEqeElectronRate>[0]);
  it("builds the dim chain authorized and the bright one blocked", () => {
    expect(dim.reduction.perWavelength.map((n) => n.wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts)
      .every((w) => Math.abs(w / 1.8e-12 - 1) < 1e-12)).toBe(true);
    expect(dim.operatingRange.status).toBe("rate-conversion-authorized");
    expect(bright.operatingRange.status).toBe("blocked");
    expect(() => convert(dim)).not.toThrow();
  });
  it("refuses a reduction paired with another chain's operating-range authorization", () => {
    expect(() => convert({ ...bright, operatingRange: dim.operatingRange })).toThrow("spectral-node values must match the reduction values");
  });
  it("refuses per-bin contributions or a total power that do not match the reduction", () => {
    const tripled = { ...dim.reduction, wavelengthIntegratedGeometricApertureIncidentFluxWatts: 0,
      perWavelength: dim.reduction.perWavelength.map((n) => ({ ...n,
        wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts: n.wavelengthIntegratedGeometricApertureIncidentFluxContributionWatts * 3 })) };
    expect(() => convert({ ...dim, reduction: tripled })).toThrow("contribution must equal spectral flux density");
    expect(() => convert({ ...dim, reduction: { ...dim.reduction, wavelengthIntegratedGeometricApertureIncidentFluxWatts: 0 } }))
      .toThrow("reduction total geometric-aperture radiant power must match");
    expect(() => convert({ ...bright, operatingRange: dim.operatingRange, reduction: { ...bright.reduction, wavelengthIntegratedGeometricApertureIncidentFluxWatts: 0 } }))
      .toThrow("reduction total geometric-aperture radiant power must match");
  });
  it("still accepts a zero-irradiance chain", () => {
    const zero = buildPipeline("direct-eqe", "vacuum", 50, true, 0);
    expect(zero.operatingRange.status).toBe("rate-conversion-authorized");
    expect(() => convert(zero)).not.toThrow();
  });
});

describe("nested input errors (sensor-11, sensor-15, sensor-16, #701)", () => {
  const domain = expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) });
  const sourcePlane = { value: "site-incident" as const, evidence: evidence("test:site-plane") };
  const assessRange = (reduction: unknown, compatibility: unknown): ReturnType<typeof assessSensorResponseOperatingRange> => assessSensorResponseOperatingRange({
    reduction: reduction as never, compatibility: compatibility as never, operatingRangeProfile: operatingProfile() });
  const assessCompatibility = (reduction: unknown, conditions: unknown, profile = applicationProfile()): ReturnType<typeof assessSensorResponseApplicationCompatibility> => assessSensorResponseApplicationCompatibility({
    reduction: reduction as never, applicationProfile: profile, sourcePlane, operatingConditions: conditions as never });

  it("rejects a null compatibility record in the EQE rate conversion", () => {
    const pipeline = buildPipeline();
    expect(() => calculateSensorEqeElectronRate({ reduction: pipeline.reduction, compatibility: null as never, operatingRange: pipeline.operatingRange,
      colorSamplingProfile: colorProfile(), spectralResponseProfile: pipeline.responseProfile })).toThrow(domain);
  });

  it("rejects a missing compatibility record or reduction fields in the operating-range check", () => {
    const { reduction, compatibility } = buildPipeline();
    expect(() => assessRange(reduction, undefined)).toThrow(domain);
    const noRange: Record<string, unknown> = { ...reduction }; delete noRange.wavelengthRangeNanometers;
    expect(() => assessRange(noRange, compatibility)).toThrow(domain);
    const noBins: Record<string, unknown> = { ...reduction }; delete noBins.perWavelength;
    expect(() => assessRange(noBins, compatibility)).toThrow(domain);
  });

  it("refuses an incomplete reduction instead of authorizing it (sensor-15)", () => {
    const { reduction, compatibility } = buildPipeline();
    expect(() => assessRange({ ...reduction, wavelengthRangeNanometers: {} }, compatibility)).toThrow(InvalidScientificInputError);
    expect(() => assessRange({ ...reduction, wavelengthRangeNanometers: { minimum: Number.NaN, maximum: 500 } }, compatibility)).toThrow(InvalidScientificInputError);
    expect(() => assessRange({ ...reduction, perWavelength: [] }, compatibility)).toThrow(InvalidScientificInputError);
    expect(assessRange(reduction, compatibility).value.responseRateConversionAuthorized).toBe(true);
  });

  it("rejects a reduction without responseUncertainty in the compatibility check", () => {
    const { reduction } = buildPipeline();
    const noUncertainty: Record<string, unknown> = { ...reduction }; delete noUncertainty.responseUncertainty;
    expect(() => assessCompatibility(noUncertainty, operatingConditions)).toThrow(domain);
  });

  it("validates operatingConditions and the response scope (sensor-16)", () => {
    const { reduction } = buildPipeline();
    expect(() => assessCompatibility(reduction, { temperatureC: 25, incidenceAngleDegreesFromNormal: 500, polarization: "unpolarized" })).toThrow(InvalidConfigurationErrorClass());
    expect(() => assessCompatibility(reduction, { ...operatingConditions, polarization: "sideways" })).toThrow(InvalidConfigurationErrorClass());
    expect(() => assessCompatibility(reduction, { ...operatingConditions, madeUp: "x" })).toThrow(InvalidConfigurationErrorClass());
    const assumeCompatible = { ...applicationProfile(), referenceConditionPolicy: { kind: "assume-compatible" as const, limitation: "test", evidence: evidence("test:assume") } };
    expect(() => assessCompatibility(reduction, "hot", assumeCompatible as never)).toThrow(InvalidConfigurationErrorClass());
    expect(() => assessCompatibility({ ...reduction, responseScope: "bogus" }, operatingConditions)).toThrow(domain);
    expect(assessCompatibility(reduction, operatingConditions).value.compatibilityStatus).not.toBe("blocked");
  });
});

function InvalidConfigurationErrorClass(): unknown {
  return expect.objectContaining({ name: "InvalidConfigurationError" });
}
