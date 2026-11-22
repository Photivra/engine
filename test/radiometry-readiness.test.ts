// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  assessRadiometryReadiness,
  parseRadiometryReadinessProfile,
  simulatePocCamera
} from "../src/index.js";

const evidence = [
  {
    sourceOrigin: "photivra",
    sourceReference: "photivra:test-calibration",
    reuseStatus: "photivra-owned"
  }
] as const;

const uncertainty = {
  kind: "relative",
  fraction: 0.05,
  basis: "Test-only documented calibration uncertainty."
} as const;

interface MutableRadiometryFixture {
  schemaVersion: "0.1.0";
  components: Array<Record<string, unknown>>;
}

function completeProfile(): MutableRadiometryFixture {
  return {
    schemaVersion: "0.1.0",
    components: [
      {
        requirement: "scene-spectral-radiance",
        scientificStatus: "calibrated",
        modelId: "scene-spectrum",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        representation: "spectral-data",
        dataArtifact: {
          id: "scene-spectrum-v1",
          checksumSha256: "a".repeat(64)
        }
      },
      {
        requirement: "optical-transmission",
        scientificStatus: "calibrated",
        modelId: "lens-transmission",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        representation: "spectral-data",
        dataArtifact: {
          id: "lens-transmission-v1",
          checksumSha256: "b".repeat(64)
        }
      },
      {
        requirement: "pupil-vignetting",
        scientificStatus: "calibrated",
        modelId: "pupil-vignetting",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        representation: "spatial-data",
        dataArtifact: {
          id: "pupil-vignetting-v1",
          checksumSha256: "c".repeat(64)
        }
      },
      {
        requirement: "photosite-collection-area",
        scientificStatus: "calibrated",
        modelId: "collection-area",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        areaModel: "effective-collection-area",
        effectiveCollectionAreaSquareMicrometers: 20
      },
      {
        requirement: "exposure-integration",
        scientificStatus: "calibrated",
        modelId: "shutter-integration",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        integrationModel: "uniform-boxcar"
      },
      {
        requirement: "sensor-response",
        scientificStatus: "calibrated",
        modelId: "qe-curve",
        modelVersion: "1.0.0",
        evidence,
        uncertainty,
        responseRepresentation: "spectral-quantum-efficiency",
        dataArtifact: {
          id: "qe-v1",
          checksumSha256: "d".repeat(64)
        }
      }
    ]
  };
}

describe("radiometry readiness", () => {
  it("recognizes a fully declared calibrated path without enabling output", () => {
    const profile = parseRadiometryReadinessProfile(completeProfile());
    const assessment = assessRadiometryReadiness(profile);

    expect(assessment.status).toBe("calibrated-ready");
    expect(assessment.nominalPhotonEstimateReady).toBe(true);
    expect(assessment.calibratedPhotonClaimReady).toBe(true);
    expect(assessment.missingRequirements).toEqual([]);
    expect(assessment.approximateRequirements).toEqual([]);
    expect(assessment.composedPhotonOutputEnabled).toBe(false);
  });

  it("distinguishes approximate-only readiness from calibrated claims", () => {
    const raw = completeProfile();
    raw.components[1] = {
      ...raw.components[1]!,
      scientificStatus: "approximation",
      representation: "t-stop-approximation",
      tStop: 2.8
    };
    // The spectral-data artifact belongs to the replaced representation (refused since #701, sensor-13).
    delete (raw.components[1] as Record<string, unknown>).dataArtifact;
    const profile = parseRadiometryReadinessProfile(raw);
    const assessment = assessRadiometryReadiness(profile);

    expect(assessment.status).toBe("approximate-only");
    expect(assessment.nominalPhotonEstimateReady).toBe(true);
    expect(assessment.calibratedPhotonClaimReady).toBe(false);
    expect(assessment.approximateRequirements).toContain(
      "optical-transmission"
    );
  });

  it("reports missing prerequisites", () => {
    const raw = completeProfile();
    raw.components = raw.components.slice(0, 3);
    const assessment = assessRadiometryReadiness(
      parseRadiometryReadinessProfile(raw)
    );

    expect(assessment.status).toBe("not-ready");
    expect(assessment.nominalPhotonEstimateReady).toBe(false);
    expect(assessment.missingRequirements).toEqual([
      "photosite-collection-area",
      "exposure-integration",
      "sensor-response"
    ]);
  });

  it("blocks calibrated claims when uncertainty is not quantified", () => {
    const raw = completeProfile();
    raw.components[5] = {
      ...raw.components[5]!,
      uncertainty: {
        kind: "not-quantified",
        limitation: "No defensible uncertainty estimate yet."
      }
    };
    const assessment = assessRadiometryReadiness(
      parseRadiometryReadinessProfile(raw)
    );

    expect(assessment.status).toBe("approximate-only");
    expect(assessment.calibratedPhotonClaimReady).toBe(false);
    expect(assessment.unquantifiedUncertaintyRequirements).toContain(
      "sensor-response"
    );
  });

  it("requires an explicit collection-area model instead of geometric pitch alone", () => {
    const raw = completeProfile();
    raw.components[3] = {
      requirement: "photosite-collection-area",
      scientificStatus: "approximation",
      modelId: "bad-area",
      modelVersion: "1.0.0",
      evidence,
      uncertainty,
      geometricPitchXMicrometers: 6,
      geometricPitchYMicrometers: 6
    } as unknown as (typeof raw.components)[number];

    expect(() =>
      parseRadiometryReadinessProfile(raw)
    ).toThrow("Geometric sample pitch alone");
  });

  it("rejects inherently approximate representations mislabeled as calibrated", () => {
    const badTransmission = completeProfile();
    badTransmission.components[1] = {
      ...badTransmission.components[1],
      scientificStatus: "calibrated",
      representation: "t-stop-approximation",
      tStop: 2.8
    };
    expect(() =>
      parseRadiometryReadinessProfile(badTransmission)
    ).toThrow('must declare scientificStatus "approximation"');

    const badQeStatus = completeProfile();
    badQeStatus.components[5] = {
      ...badQeStatus.components[5],
      scientificStatus: "calibrated",
      responseRepresentation: "effective-qe-approximation",
      effectiveQuantumEfficiency: 0.6
    };
    expect(() =>
      parseRadiometryReadinessProfile(badQeStatus)
    ).toThrow('must declare scientificStatus "approximation"');
  });

  it("revalidates profiles passed directly to the assessor", () => {
    const profile = parseRadiometryReadinessProfile(completeProfile());
    const invalid = {
      ...profile,
      components: [
        ...profile.components,
        profile.components[0]!
      ]
    };

    expect(() =>
      assessRadiometryReadiness(
        invalid as typeof profile
      )
    ).toThrow("duplicate requirement IDs");
  });

  it("validates fill factor, quantum efficiency, artifacts, and uniqueness", () => {
    const badFill = completeProfile();
    badFill.components[3] = {
      ...badFill.components[3]!,
      areaModel: "geometric-area-times-fill-factor",
      geometricCellAreaSquareMicrometers: 36,
      fillFactor: 1.2
    };
    expect(() =>
      parseRadiometryReadinessProfile(badFill)
    ).toThrow("fillFactor");

    const badQe = completeProfile();
    badQe.components[5] = {
      ...badQe.components[5]!,
      scientificStatus: "approximation",
      responseRepresentation: "effective-qe-approximation",
      effectiveQuantumEfficiency: 1.2
    };
    expect(() =>
      parseRadiometryReadinessProfile(badQe)
    ).toThrow("effectiveQuantumEfficiency");

    const badHash = completeProfile();
    badHash.components[0] = {
      ...badHash.components[0]!,
      dataArtifact: {
        id: "scene-spectrum-v1",
        checksumSha256: "bad"
      }
    };
    expect(() =>
      parseRadiometryReadinessProfile(badHash)
    ).toThrow("SHA-256");

    const duplicate = completeProfile();
    duplicate.components.push(duplicate.components[0]!);
    expect(() =>
      parseRadiometryReadinessProfile(duplicate)
    ).toThrow("duplicate requirement IDs");
  });

  it("does not add photon/noise output to the composed POC", () => {
    const result = simulatePocCamera({
      sensor: {
        widthMm: 36,
        heightMm: 24,
        pixelWidth: 6000,
        pixelHeight: 4000
      },
      lens: {
        focalLengthMm: 50,
        aperture: 5.6
      },
      exposure: {
        shutterSeconds: 1 / 125,
        iso: 100
      },
      focus: {
        focusDistanceM: 5,
        circleOfConfusionMm: 0.03
      },
      crop: { factor: 1 },
      diffraction: { wavelengthNm: 550 },
      motion: {
        positionM: { x: 0, y: 0, z: 5 },
        velocityMps: { x: 0, y: 0, z: 0 }
      }
    });

    expect("photons" in result).toBe(false);
    expect("photoelectrons" in result).toBe(false);
    expect("signalToNoise" in result).toBe(false);
  });
});
