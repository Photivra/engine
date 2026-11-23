// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseEvidenceList } from "../src/core/evidence-provenance.js";
import * as engine from "../src/index.js";
import { resolveGenericEquipmentTierCatalog, resolveSensorProfile, SENSOR_PROFILES, simulateCapture } from "../src/index.js";
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

describe("exported catalogue constants are frozen all the way down (#683)", () => {
  it("no exported object constant has an unfrozen plain record or array", () => {
    const unfrozen = Object.entries(engine).filter(([, value]) => typeof value === "object" && value !== null)
      .flatMap(([name, value]) => [...plainNodes(value, name)].filter(([node]) => !Object.isFrozen(node)).map(([, path]) => path));
    expect(unfrozen).toEqual([]);
  });

  it("a resolved sensor profile cannot be edited in place, and profiles share no writable part", async () => {
    const a = resolveSensorProfile("full-frame-24mp-bsi-2020s"), b = resolveSensorProfile("medium-format-100mp-bsi-16bit");
    expect(a.fixedPattern).toBe(b.fixedPattern);
    expect(() => { (a.fixedPattern as { prnu: number }).prnu = 0.5; }).toThrow(TypeError);
    expect(() => { (a.readNoise as { lowGainElectrons: number }).lowGainElectrons = 50; }).toThrow(TypeError);
    expect(b.fixedPattern.prnu).toBe(0.004);
    expect(a.readNoise.lowGainElectrons).toBe(6.4);
    // A modified copy still works, and the catalogue is unchanged.
    const custom = { ...a, readNoise: { ...a.readNoise, lowGainElectrons: 5 } };
    const r = { scene: { preset: "uniform" }, output: { width: 8, height: 8 } } as const;
    await expect(simulateCapture({ ...r, sensor: { profile: custom } })).resolves.toBeDefined();
    const first = await simulateCapture({ ...r, sensor: { profile: SENSOR_PROFILES[7]! } }), second = await simulateCapture({ ...r, sensor: { profile: SENSOR_PROFILES[7]! } });
    const inSecond = plainNodes(second, "second");
    expect([...plainNodes(first, "first")].filter(([node]) => inSecond.has(node) && !Object.isFrozen(node)).map(([, path]) => path)).toEqual([]);
  });
});

describe("parsed evidence of frozen lists (#730 facade-07)", () => {
  it("parses a frozen list once and gives every call its own records; other lists are parsed each time", () => {
    const record = Object.freeze({ sourceOrigin: "photivra", sourceReference: "test:frozen", reuseStatus: "photivra-owned" });
    const frozen = Object.freeze([record]);
    const first = parseEvidenceList(frozen, "e"), second = parseEvidenceList(frozen, "e");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    (first[0] as { note?: string }).note = "changed by a caller";
    expect(parseEvidenceList(frozen, "e")[0]).toEqual(record);
    // A list that is not frozen can change between calls; it is parsed again, and so is one whose records are not frozen.
    const open: { sourceOrigin: string; sourceReference: string; reuseStatus: string }[] = [{ ...record }];
    expect(parseEvidenceList(open, "e")[0]!.sourceReference).toBe("test:frozen");
    open[0]!.sourceReference = "test:changed";
    expect(parseEvidenceList(open, "e")[0]!.sourceReference).toBe("test:changed");
    const shallow = Object.freeze([{ ...record }]);
    parseEvidenceList(shallow, "e");
    (shallow[0] as { reuseStatus: string }).reuseStatus = "unknown";
    expect(() => parseEvidenceList(shallow, "e")).toThrow("e[0].reuseStatus is invalid.");
    // A frozen record with a getter can change; it is parsed again.
    let reference = "test:getter-1";
    const getter = Object.freeze([Object.freeze({ sourceOrigin: "photivra", get sourceReference() { return reference; }, reuseStatus: "photivra-owned" })]);
    expect(parseEvidenceList(getter, "e")[0]!.sourceReference).toBe("test:getter-1");
    reference = "test:getter-2";
    expect(parseEvidenceList(getter, "e")[0]!.sourceReference).toBe("test:getter-2");
    // An invalid frozen list is refused on every call.
    const bad = Object.freeze([Object.freeze({ sourceOrigin: "photivra", sourceReference: "x", reuseStatus: "owned" })]);
    for (let i = 0; i < 2; i++) expect(() => parseEvidenceList(bad, "e")).toThrow("e[0].reuseStatus is invalid.");
  });
});
