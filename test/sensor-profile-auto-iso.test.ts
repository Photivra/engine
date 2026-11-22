// SPDX-License-Identifier: Apache-2.0
/*
 * #672: exposure.iso "auto" with its default whole-stop steps on every sensor profile. A profile whose base ISO is below 100 (and not
 * 50) used to lose ISO 100, the reference exposure's ISO, from its whole-stop list, and every exposure mode refused the request.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveSensorProfile, resolveSensorProfileIsoSettings, SENSOR_PROFILES, simulateCapture, type SensorProfile, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Mode = "manual" | "aperture-priority" | "shutter-priority" | "program";
const MODES: readonly Mode[] = ["manual", "aperture-priority", "shutter-priority", "program"];
const sha = (data: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex").slice(0, 16);
const autoIso = (mode: Mode): NonNullable<SimulateCaptureOptions["exposure"]> =>
  ({ mode, iso: "auto", ...(mode === "aperture-priority" ? { autoIso: { slowestPreferredShutterSeconds: 1 / 60 } } : {}) });
const capture = (illuminanceLux: number, extra: Partial<SimulateCaptureOptions>, exposure: SimulateCaptureOptions["exposure"]): Promise<SimulateCaptureResult> =>
  simulateCapture({ scene: { preset: "uniform" }, illuminanceLux, output: { width: 8, height: 8 }, ...extra, ...(exposure ? { exposure } : {}) });
const WHOLE_FROM_100 = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400];
const ff = resolveSensorProfile("full-frame-24mp-bsi-2020s");
/** A single-gain copy of a profile with another base ISO (a caller's own profile). */
const copy = (baseIso: number): SensorProfile => ({ ...ff, id: "copy-" + baseIso, baseIso, maximumIso: 102400,
  readNoise: { lowGainElectrons: 3, highGainElectrons: 3, highGainFromIso: null }, highGainFullWellElectrons: null });

describe("Auto ISO in whole stops on every sensor profile (#672)", () => {
  it.each(SENSOR_PROFILES.map((p) => [p.id, p] as const))("%s: every mode resolves, the base ISO in bright light and above ISO 640 in the dark", async (_, p) => {
    const settings = resolveSensorProfileIsoSettings(p);
    for (const mode of MODES) {
      const bright = await capture(2e6, { sensor: { profile: p } }, autoIso(mode)), dark = await capture(0.5, { sensor: { profile: p } }, autoIso(mode));
      for (const r of [bright, dark]) expect(settings).toContain(r.exposure.settings.iso);
      // The base ISO stays in the whole-stop list (owner decision of 2026-11-21).
      expect(bright.exposure.settings.iso, mode).toBe(p.baseIso);
      // Within a stop of the profile's Auto ISO maximum (base 125 reaches 64 000 of 102 400).
      if (mode !== "program") expect(dark.exposure.settings.iso * 2, mode).toBeGreaterThan(dark.exposure.autoIso!.autoIsoMaximum!);
      expect(dark.exposure.settings.iso, mode).toBeGreaterThan(640);
    }
  }, scaledTimeout(60_000));

  it("counts the whole stops from ISO 100 on a base-80 or base-40 profile, with the base ISO kept", async () => {
    const chosen = async (p: SensorProfile, lux: number): Promise<number> => (await capture(lux, { sensor: { profile: p } }, autoIso("manual"))).exposure.settings.iso;
    const isos = async (p: SensorProfile): Promise<number[]> => [...new Set(await Promise.all([2e6, 2e5, 2e4, 4e3, 1e3, 500, 250, 125, 60, 30, 15, 8, 4, 2, 1, 0.5].map((lux) => chosen(p, lux))))].sort((a, b) => a - b);
    expect(await isos(resolveSensorProfile("full-frame-45mp-stacked-2020s"))).toEqual(expect.arrayContaining([80, 100, 400, 1600, 25600]));
    for (const p of [resolveSensorProfile("full-frame-45mp-stacked-2020s"), resolveSensorProfile("phone-50mp-stacked"), copy(32), copy(64)]) {
      for (const iso of await isos(p)) expect([p.baseIso, ...WHOLE_FROM_100], p.id).toContain(iso);
    }
  }, scaledTimeout(60_000));

  it("keeps the bytes and settings of requests that resolved before (recorded at 2.27.0)", async () => {
    const sports = resolveSensorProfile("full-frame-24mp-stacked-sports-2020s");
    const cases: [string, Partial<SimulateCaptureOptions>, SimulateCaptureOptions["exposure"], number, number, string][] = [
      ["tier, manual", {}, { mode: "manual" }, 5, 25600, "72683d3e98e762ae"],
      ["tier, aperture priority", {}, { mode: "aperture-priority", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }, 5, 25600, "0676246793f9d9e4"],
      ["tier, shutter priority", {}, { mode: "shutter-priority" }, 500, 800, "89d14b2ce70b10a5"],
      ["tier, program", {}, { mode: "program" }, 0.5, 6400, "f60fa17ffdf556e1"],
      ["base 100 profile, manual", { sensor: { profile: ff } }, { mode: "manual" }, 5, 51200, "09acea7a3ef9ea9c"],
      ["base 125 profile, shutter priority", { sensor: { profile: sports } }, { mode: "shutter-priority" }, 5, 64000, "1897841b47bd263c"],
      ["base 50 copy, manual", { sensor: { profile: copy(50) } }, { mode: "manual" }, 2e5, 50, "a96089a3acf6ab70"],
      // A base-160 copy keeps its list (160, 320, 640): it contains the reference ISO, so it resolved before and is unchanged.
      ["base 160 copy, aperture priority", { sensor: { profile: copy(160) } }, { mode: "aperture-priority", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }, 0.5, 640, "2505b7fb8fedad65"],
    ];
    for (const [name, extra, exposure, lux, iso, hash] of cases) {
      const r = await capture(lux, extra, { iso: "auto", ...exposure });
      expect([name, r.exposure.settings.iso, sha(r.raw.codes)]).toEqual([name, iso, hash]);
    }
  }, scaledTimeout(60_000));
});
