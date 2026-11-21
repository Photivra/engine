// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  createSensorSpectralCoverageParticipant,
  type SensorSpectralResponseProfile
} from "../src/index.js";

const evidence = (ref: string) =>
  [{
    sourceOrigin: "photivra" as const,
    sourceReference: ref,
    reuseStatus: "photivra-owned" as const
  }] as const;

const directProfile = (
  wavelengthBasis:
    "air" | "vacuum" | "unspecified" = "vacuum"
): SensorSpectralResponseProfile => ({
  schemaVersion: "0.1.0",
  profileId: "sensor",
  colorSamplingProfileId: "color",
  evidence: evidence("profile"),
  channels: [
    {
      channelId: "green",
      kind:
        "effective-external-quantum-efficiency",
      responseScope:
        "site-incident-effective-channel-response",
      scientificStatus: "approximation",
      uncertainty: {
        kind: "not-quantified",
        limitation: "test"
      },
      evidence: evidence("channel"),
      conditionDependence:
        "not-modeled",
      externalQuantumEfficiency: {
        wavelengthUnit: "nm",
        wavelengthBasis,
        interpolation:
          "piecewise-linear",
        outsideRangeBehavior:
          "fail-closed",
        evidence: evidence("curve"),
        samples: [
          {
            wavelengthNanometers: 400,
            value: 0.1
          },
          {
            wavelengthNanometers: 500,
            value: 0.5
          },
          {
            wavelengthNanometers: 700,
            value: 0.2
          }
        ]
      }
    }
  ]
});

const separableProfile =
  (): SensorSpectralResponseProfile => ({
    schemaVersion: "0.1.0",
    profileId: "separable",
    colorSamplingProfileId: "color",
    evidence: evidence("profile"),
    channels: [
      {
        channelId: "green",
        kind:
          "separable-channel-filter-and-detector-eqe",
        responseScope:
          "site-incident-channel-filter-times-detector-eqe",
        combinationRule: "multiply",
        scientificStatus: "approximation",
        uncertainty: {
          kind: "not-quantified",
          limitation: "test"
        },
        evidence: evidence("channel"),
        conditionDependence:
          "not-modeled",
        channelFilterTransmittance: {
          wavelengthUnit: "nm",
          wavelengthBasis: "vacuum",
          interpolation:
            "piecewise-linear",
          outsideRangeBehavior:
            "fail-closed",
          evidence:
            evidence("filter"),
          samples: [
            {
              wavelengthNanometers:
                450,
              value: 0.1
            },
            {
              wavelengthNanometers:
                550,
              value: 0.8
            },
            {
              wavelengthNanometers:
                650,
              value: 0.1
            }
          ]
        },
        detectorExternalQuantumEfficiency: {
          wavelengthUnit: "nm",
          wavelengthBasis: "vacuum",
          interpolation:
            "piecewise-linear",
          outsideRangeBehavior:
            "fail-closed",
          evidence:
            evidence("detector"),
          samples: [
            {
              wavelengthNanometers:
                400,
              value: 0.2
            },
            {
              wavelengthNanometers:
                500,
              value: 0.4
            },
            {
              wavelengthNanometers:
                600,
              value: 0.5
            },
            {
              wavelengthNanometers:
                700,
              value: 0.2
            }
          ]
        }
      }
    ]
  });

describe("sensor shared spectral coverage adapter", () => {
  it("exposes response support and internal interpolation knots without applying response values", () => {
    const participant =
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            directProfile(),
          channelId: "green"
        }
      );

    expect(participant).toEqual({
      participantId:
        "sensor-response:sensor:green",
      role: "sensor-response",
      wavelengthBasis: "vacuum",
      wavelengthRangeNanometers: {
        minimum: 400,
        maximum: 700
      },
      breakpointsNanometers: [
        500
      ]
    });
  });

  it("uses the overlapping support and knot union for separable response components", () => {
    const participant =
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            separableProfile(),
          channelId: "green",
          participantId:
            "sensor-green"
        }
      );

    expect(
      participant
        .wavelengthRangeNanometers
    ).toEqual({
      minimum: 450,
      maximum: 650
    });
    expect(
      participant.breakpointsNanometers
    ).toEqual([
      500,
      550,
      600
    ]);
    expect(participant.participantId)
      .toBe("sensor-green");
  });

  it("fails closed on unresolved wavelength basis or missing channel", () => {
    expect(() =>
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            directProfile("unspecified"),
          channelId: "green"
        }
      )
    ).toThrow(
      "requires a resolved air or vacuum wavelength basis"
    );

    expect(() =>
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            directProfile(),
          channelId: "red"
        }
      )
    ).toThrow(
      "No spectral response is declared"
    );
  });

  it("rejects an empty explicit participant ID", () => {
    expect(() =>
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            directProfile(),
          channelId: "green",
          participantId: " "
        }
      )
    ).toThrow(
      "participantId must be a non-empty string"
    );
  });
});

describe("sensor coverage adapter additional branches", () => {
  it("supports direct A/W responsivity coverage", () => {
    const profile:
      SensorSpectralResponseProfile = {
      schemaVersion: "0.1.0",
      profileId: "responsivity",
      colorSamplingProfileId: "color",
      evidence: evidence("profile"),
      channels: [
        {
          channelId: "green",
          kind:
            "effective-spectral-responsivity",
          responseScope:
            "sensor-package-incident-effective-channel-response",
          scientificStatus:
            "approximation",
          uncertainty: {
            kind: "not-quantified",
            limitation: "test"
          },
          evidence: evidence("channel"),
          conditionDependence:
            "not-modeled",
          spectralResponsivity: {
            wavelengthUnit: "nm",
            wavelengthBasis: "vacuum",
            interpolation:
              "piecewise-linear",
            outsideRangeBehavior:
              "fail-closed",
            evidence:
              evidence("responsivity"),
            samples: [
              {
                wavelengthNanometers:
                  450,
                amperesPerWatt: 0.2
              },
              {
                wavelengthNanometers:
                  550,
                amperesPerWatt: 0.4
              },
              {
                wavelengthNanometers:
                  650,
                amperesPerWatt: 0.1
              }
            ]
          }
        }
      ]
    };

    const participant =
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            profile,
          channelId: "green"
        }
      );

    expect(
      participant.breakpointsNanometers
    ).toEqual([550]);
  });

  it("rejects an empty channel ID", () => {
    expect(() =>
      createSensorSpectralCoverageParticipant(
        {
          spectralResponseProfile:
            directProfile(),
          channelId: " "
        }
      )
    ).toThrow(
      "channelId must be a non-empty string"
    );
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  it("rejects a non-string participant ID with a domain error", () => {
    expect(() => createSensorSpectralCoverageParticipant({ spectralResponseProfile: directProfile(), channelId: "green", participantId: 5 as unknown as string }))
      .toThrow(expect.objectContaining({ name: "InvalidConfigurationError" }));
  });
});
