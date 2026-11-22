// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, parseRadiometryReadinessProfile } from "../src/index.js";
import { expectRejection, type Json, type RejectionCase } from "./helpers/rejection-table.js";

const evidence = [{ sourceOrigin: "photivra", sourceReference: "test:radiometry-rejections", reuseStatus: "photivra-owned" }];
const artifact = (c: string): Json => ({ id: "artifact-" + c, checksumSha256: c.repeat(64) });
const common = (requirement: string, status = "calibrated"): Json => ({ requirement, scientificStatus: status, modelId: requirement,
  modelVersion: "1.0.0", evidence, uncertainty: { kind: "relative", fraction: 0.05, basis: "test" } });

/** Components 0-5: scene radiance, optical transmission, pupil vignetting, collection area, exposure integration, sensor response. */
function base(): Json {
  return { schemaVersion: "0.1.0", components: [
    { ...common("scene-spectral-radiance"), representation: "spectral-data", dataArtifact: artifact("a") },
    { ...common("optical-transmission"), representation: "spectral-data", dataArtifact: artifact("b") },
    { ...common("pupil-vignetting"), representation: "spatial-data", dataArtifact: artifact("c") },
    { ...common("photosite-collection-area"), areaModel: "effective-collection-area", effectiveCollectionAreaSquareMicrometers: 20 },
    { ...common("exposure-integration"), integrationModel: "uniform-boxcar" },
    { ...common("sensor-response"), responseRepresentation: "spectral-quantum-efficiency", dataArtifact: artifact("d") }
  ] };
}

describe("radiometry readiness profile branches", () => {
  it("accepts every alternative representation with its required status and fields", () => {
    const p = base();
    p.components[0] = { ...common("scene-spectral-radiance", "approximation"), representation: "documented-spectral-approximation",
      dataArtifact: artifact("a") };
    p.components[1] = { ...common("optical-transmission", "approximation"), representation: "t-stop-approximation", tStop: 2.2 };
    p.components[2] = { ...common("pupil-vignetting", "approximation"), representation: "documented-approximation" };
    // Fill factor 1 is the inclusive upper bound of a fraction.
    p.components[3] = { ...common("photosite-collection-area"), areaModel: "geometric-area-times-fill-factor",
      geometricCellAreaSquareMicrometers: 16, fillFactor: 1 };
    p.components[4] = { ...common("exposure-integration"), integrationModel: "documented-shutter-function", dataArtifact: artifact("e") };
    p.components[5] = { ...common("sensor-response", "approximation"), responseRepresentation: "effective-qe-approximation",
      effectiveQuantumEfficiency: 0 };
    p.components[5].uncertainty = { kind: "absolute", plusMinus: 0.01, unit: "1", basis: "test" };
    p.components[4].uncertainty = { kind: "not-quantified", limitation: "test" };
    const parsed = parseRadiometryReadinessProfile(p);
    expect(parsed.components.map((c) => c.requirement)).toEqual(base().components.map((c: Json) => c.requirement));
    expect(parsed.components[3]).toMatchObject({ fillFactor: 1, geometricCellAreaSquareMicrometers: 16 });
    expect(parsed.components[5]).toMatchObject({ effectiveQuantumEfficiency: 0, uncertainty: { kind: "absolute", plusMinus: 0.01 } });
  });

  const cases: RejectionCase[] = [
    ["a non-object component", (p): void => { p.components[0] = "scene"; }, "components[0] must be an object."],
    ["a blank model id", (p): void => { p.components[0].modelId = ""; }, ".modelId must be a non-empty string."],
    ["a zero collection area", (p): void => { p.components[3].effectiveCollectionAreaSquareMicrometers = 0; },
      ".effectiveCollectionAreaSquareMicrometers must be a finite number greater than zero."],
    ["a negative relative uncertainty", (p): void => { p.components[0].uncertainty.fraction = -0.1; },
      ".fraction must be finite and greater than or equal to zero."],
    ["a negative absolute uncertainty", (p): void => { p.components[0].uncertainty = { kind: "absolute", plusMinus: -1, unit: "1", basis: "x" }; },
      ".plusMinus must be finite and greater than or equal to zero."],
    ["an unknown uncertainty kind", (p): void => { p.components[0].uncertainty = { kind: "interval" }; }, ".uncertainty.kind is invalid."],
    ["an unknown scientific status", (p): void => { p.components[0].scientificStatus = "measured"; }, ".scientificStatus is invalid."],
    ["an unknown requirement", (p): void => { p.components[0].requirement = "lens-flare"; }, ".requirement is invalid."],
    ["an unknown scene representation", (p): void => { p.components[0].representation = "rgb"; }, "components[0].representation is invalid."],
    ["a calibrated scene approximation", (p): void => { p.components[0].representation = "documented-spectral-approximation"; },
      'must declare scientificStatus "approximation"'],
    ["an unknown transmission representation", (p): void => { p.components[1].representation = "f-stop"; }, "components[1].representation is invalid."],
    ["an unknown vignetting representation", (p): void => { p.components[2].representation = "cos4"; }, "components[2].representation is invalid."],
    ["an unknown area model", (p): void => { p.components[3].areaModel = "pitch-squared"; }, ".areaModel is invalid."],
    ["a zero fill factor", (p): void => { p.components[3] = { ...p.components[3], areaModel: "geometric-area-times-fill-factor",
      geometricCellAreaSquareMicrometers: 16, fillFactor: 0 }; }, ".fillFactor must be a finite fraction"],
    ["an unknown integration model", (p): void => { p.components[4].integrationModel = "gaussian"; }, ".integrationModel is invalid."],
    ["an unknown response representation", (p): void => { p.components[5].responseRepresentation = "iso-sensitivity"; },
      ".responseRepresentation is invalid."],
    ["an unsupported schema version", (p): void => { p.schemaVersion = "0.2.0"; }, 'radiometryReadiness.schemaVersion must be "0.1.0".'],
    ["non-array components", (p): void => { p.components = {}; }, "radiometryReadiness.components must be an array."]
  ];
  it.each(cases)("rejects %s", (_name, mutate, message) => {
    expectRejection(base, parseRadiometryReadinessProfile, InvalidConfigurationError, mutate, message);
  });
});

describe("fields of another representation (sensor-13, #701)", () => {
  it("refuses a spectral-data optical transmission that also carries t-stop or area fields", () => {
    for (const [key, value] of [["tStop", "banana"], ["fillFactor", -5], ["effectiveQuantumEfficiency", 99]] as const) {
      expectRejection(base, parseRadiometryReadinessProfile, InvalidConfigurationError, (p): void => { p.components[1][key] = value; }, `has unknown field "${key}".`);
    }
    expect(() => parseRadiometryReadinessProfile(base())).not.toThrow();
  });

  it("takes a field set to undefined as left out, as 2.27.0 did", () => {
    const profile = base();
    profile.components[1].tStop = undefined;
    profile.components[1].fillFactor = undefined;
    expect(() => parseRadiometryReadinessProfile(profile)).not.toThrow();
  });
});
