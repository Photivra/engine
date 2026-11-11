// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import * as engine from "../src/index.js";

const APPROVED_PUBLIC_VERB_PREFIXES = [
  "add",
  "apply",
  "assess",
  "bind",
  "calculate",
  "compose",
  "create",
  "develop",
  "distribute",
  "estimate",
  "evaluate",
  "get",
  "import",
  "integrate",
  "map",
  "meter",
  "parse",
  "prepare",
  "reduce",
  "resolve",
  "serialize",
  "set",
  "simulate",
  "transform",
  "validate"
] as const;

const RESULT_FACTORY_EXCEPTIONS = new Set([
  "approximationResult",
  "calibratedResult",
  "calculatedResult",
  "estimatedResult"
]);

const COMPATIBILITY_SENTINELS: readonly (keyof typeof engine)[] = [
  "ENGINE_API_VERSION",
  "POC_SIMULATION_API_VERSION",
  "calculateFieldOfView",
  "calculateDepthOfField",
  "calculateExposureValue100",
  "parseSensorArchitectureProfile",
  "getImageFormationContract",
  "createProductionImageFormationPlan",
  "simulatePocCamera"
];

describe("public API style and compatibility contract", () => {
  it("keeps lowercase public callables inside the documented verb families", () => {
    const unexpected = Object.entries(engine)
      .filter(([name, value]) =>
        typeof value === "function" &&
        /^[a-z]/u.test(name) &&
        !RESULT_FACTORY_EXCEPTIONS.has(name)
      )
      .map(([name]) => name)
      .filter(
        (name) =>
          !APPROVED_PUBLIC_VERB_PREFIXES.some((prefix) =>
            name.startsWith(prefix)
          )
      );

    expect(unexpected).toEqual([]);
  });

  it("keeps representative compatibility sentinels on the root surface", () => {
    for (const name of COMPATIBILITY_SENTINELS) {
      expect(engine[name], String(name)).toBeDefined();
    }

    expect(engine.calculateFieldOfView).toBeTypeOf("function");
    expect(engine.parseSensorArchitectureProfile).toBeTypeOf("function");
    expect(engine.createProductionImageFormationPlan).toBeTypeOf("function");
    expect(engine.simulatePocCamera).toBeTypeOf("function");
  });

  it("keeps independent public version surfaces semver-shaped", () => {
    const semver = /^\d+\.\d+\.\d+$/u;

    expect(engine.ENGINE_API_VERSION).toMatch(semver);
    expect(engine.POC_SIMULATION_API_VERSION).toMatch(semver);
  });
});
