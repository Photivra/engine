// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { DngGainSwitchEntry } from "../src/capture/dng-gain-switch.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.24.0 (owner decision 2026-11-11): the what-if takes a camera's dual-gain switch from the cited catalog when the caller passes
 * none. The shipped catalog is empty (no reviewed source states a photo-mode switch point clearly), so the lookup is tested with a
 * test-only entry for the engine's own virtual camera, whose switch the capture reports (ISO 800, professional tier).
 */
const TEST_ENTRY: DngGainSwitchEntry = { make: "Photivra", model: "Photivra Virtual Camera", highGainFromIso: 800,
  source: { title: "test entry: the engine capture's result.sensor.readNoise.highGainFromIso", url: "https://github.com/Photivra/engine", terms: "test only", accessed: "2026-11-11" } };
vi.mock("../src/capture/dng-gain-switch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/capture/dng-gain-switch.js")>();
  return { ...actual, DNG_GAIN_SWITCH_CATALOG: Object.freeze([TEST_ENTRY]) };
});
const { parseDngRawImage, simulateCapture, assessDngRawWhatIf, simulateDngRawWhatIf } = await import("../src/index.js");

describe("dual-gain switch catalog (2.24.0)", () => {
  it("uses the catalog's switch when the caller passes none, and refuses across it", async () => {
    const c = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.18 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
      output: { width: 32, height: 32, format: "dng" } });
    const raw = parseDngRawImage({ bytes: c.image.dng! });
    expect(c.sensor.readNoise.highGainFromIso).toBe(TEST_ENTRY.highGainFromIso);
    const within = simulateDngRawWhatIf(raw, { iso: 400, exposureStops: -2, seed: 1 });
    expect(within.gainSwitch).toEqual({ highGainFromIso: 800, from: "catalog", entry: TEST_ENTRY });
    expect(within.assumptions.join("\n")).toMatch(/from DNG_GAIN_SWITCH_CATALOG \(Photivra Photivra Virtual Camera/u);
    expect(assessDngRawWhatIf(raw, { iso: 1600, seed: 1 }).refusals.map((r) => r.reason)).toEqual(["crosses-gain-switch"]);
    // The caller's value wins over the catalog.
    expect(simulateDngRawWhatIf(raw, { iso: 1600, highGainFromIso: null, seed: 1 }).gainSwitch).toMatchObject({ highGainFromIso: null, from: "request", entry: null });
    // Another model is not on the list: the ISO what-if refuses, a darker exposure still works.
    const other = { ...raw, model: "Another Camera" };
    expect(assessDngRawWhatIf(other, { iso: 400, seed: 1 }).refusals.map((r) => r.reason)).toEqual(["gain-mode-unknown"]);
    expect(simulateDngRawWhatIf(other, { exposureStops: -1, seed: 1 }).gainSwitch.from).toBe("not-needed");
  }, scaledTimeout(30_000));
});
