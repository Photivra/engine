// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveGenericEquipmentTierCatalog, simulateCapture } from "../src/index.js";
import { genericTierAssets } from "../src/equipment/generic-tier-assets.js";

/** Every plain record or array reachable from a value (typed arrays and their buffers are skipped), with its path. */
function plainNodes(value: unknown, path: string, out = new Map<object, string>()): Map<object, string> {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || out.has(value)) return out;
  out.set(value, path);
  for (const [key, entry] of Object.entries(value)) plainNodes(entry, `${path}.${key}`, out);
  return out;
}

const request = { scene: { preset: "uniform" }, output: { width: 8, height: 8 } } as const;

describe("engine-owned records shared between results cannot be rewritten (#682)", () => {
  it("two captures share no unfrozen object, and the tier evidence record is frozen", async () => {
    const a = await simulateCapture(request), b = await simulateCapture(request);
    const inB = plainNodes(b, "b");
    const sharedUnfrozen = [...plainNodes(a, "a")].filter(([node]) => inB.has(node) && !Object.isFrozen(node)).map(([, path]) => path);
    expect(sharedUnfrozen).toEqual([]);
    expect(a.provenance.evidence[1]).toBe(b.provenance.evidence[1]);
    expect(Object.isFrozen(a.provenance.evidence[1])).toBe(true);
    expect(() => { (a.provenance.evidence[1] as { sourceReference: string }).sourceReference = "changed"; }).toThrow(TypeError);
    expect(b.provenance.evidence[1]!.sourceReference).toBe("photivra:generic-tier-assets-v1");
  });

  it("the tier assets are frozen before the public catalogue is first asked for, so behaviour does not depend on call order", () => {
    const unfrozen = (value: unknown): string[] => [...plainNodes(value, "assets")].filter(([node]) => !Object.isFrozen(node)).map(([, path]) => path);
    // This file never asks for the public catalogue before this point; the capture above reads the assets directly.
    expect(unfrozen(genericTierAssets("2.1.0"))).toEqual([]);
    expect(unfrozen(genericTierAssets("2.0.0"))).toEqual([]);
    expect(resolveGenericEquipmentTierCatalog({ presetVersion: "2.1.0" })).toBe(genericTierAssets("2.1.0"));
  });
});
