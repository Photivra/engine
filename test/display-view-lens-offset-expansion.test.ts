// SPDX-License-Identifier: Apache-2.0
/**
 * #685 steps 2–3, the fast method `lens.catalogue/view-offset-expansion` (display-view-lens-signal.ts, `offsetExpansion`): with more
 * than one query offset (the box pixel aperture, the four-spot filter), each offset's plane point and field factor come from a
 * second-order expansion about its nearest site centre instead of one lens mapping per offset, and a lattice point whose offsets all
 * read one material takes (Σ_o w_o·F_o)·L_m. Go/no-go (the uniform-window method's own): every site within 1e-6 relative of the full
 * method (each offset through the lens), on every catalogue lens wide open and at its narrowest f-number.
 */
import { describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE, resolveGenericLens, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { prepareDisplayViewLensSignal } from "../src/facade/display-view-lens-signal.js";
import { createOffsetExpansion } from "../src/facade/display-view-offset-expansion.js";
import { exposure, fullFrame } from "./helpers/display-view-lens-catalogue.js";
import { prepare } from "./helpers/display-view-lens-uniform-windows.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const BOUND = 1e-6;
/** The largest relative difference, expansion against the full method, on every `step`-th row (and the last). */
async function check(options: SimulateCaptureOptions, step = 61): Promise<{ largest: number }> {
  const { lens: setup, W, H, input } = await prepare(options);
  const rows = [...Array.from({ length: Math.ceil(H / step) }, (_, k) => step * k), H - 1];
  const full = prepareDisplayViewLensSignal({ ...setup, uniformWindows: false, offsetExpansion: undefined }, W, H, 0, "test")(input);
  const fast = prepareDisplayViewLensSignal({ ...setup, uniformWindows: false, offsetExpansion: createOffsetExpansion }, W, H, 0, "test")(input);
  let largest = 0;
  for (const y of rows) {
    full.window(0, y, W, y + 1); fast.window(0, y, W, y + 1);
    for (let x = 0; x < W; x++) { const a = fast.site(x, y), b = full.site(x, y); largest = Math.max(largest, b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / b); }
  }
  return { largest };
}
const request = (lensId: string, fNumber: number, sensor: Record<string, unknown>): SimulateCaptureOptions => {
  const resolved = resolveGenericLens({ lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
  return { scene: { preset: "dead-leaves" }, output: fullFrame(12), sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80, ...sensor },
    subjectDistanceM: resolved.minimumFocusDistanceM * 2, exposure: { ...exposure, shutterSeconds: (fNumber / 8) ** 2 / 125 }, lens: { catalogue: lensId, fNumber } };
};
const BOX = { pixelAperture: { kind: "box", samplesPerAxis: 2 } };

describe("catalogue-lens display view: the offsets' lens mapping to second order (#685)", () => {
  it("keeps every site within 1e-6 of the full method on every catalogue lens, wide open and at its narrowest, with the 2 × 2 box", async () => {
    let largest = 0;
    for (const lens of GENERIC_LENS_CATALOGUE.filter((l) => l.set !== "phone" && l.kind !== "fisheye")) {
      const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
      for (const fNumber of [resolved.widestFNumber, resolved.narrowestFNumber]) {
        const r = await check(request(lens.lensId, fNumber, BOX), 97);
        largest = Math.max(largest, r.largest);
        expect(r.largest, lens.lensId + " f/" + fNumber).toBeLessThan(BOUND);
      }
    }
    if (process.env.EXPANSION_REPORT) (await import("node:fs")).writeFileSync(process.env.EXPANSION_REPORT, String(largest));
    // The expansion is an approximation: it ran (it differs somewhere), within its bound.
    expect(largest).toBeGreaterThan(0);
  }, scaledTimeout(600_000));

  it("keeps the box with the four-spot filter, and a rotating camera under a rolling shutter, within the bound", async () => {
    for (const options of [request("pv-16-2.8", 2.8, { ...BOX, antiAliasing: { kind: "four-spot" } }), request("pv-24-1.4-pro", 1.4, { ...BOX, antiAliasing: { kind: "four-spot" } }),
      { ...request("pv-24-1.8", 2.8, { ...BOX, temporalSampleCount: 2 }), output: { width: 120, height: 80 }, motion: { angularVelocityRadPerSec: { yaw: 0.5, roll: 3 }, shutter: "rolling", rollingShutterSkewSeconds: 0.004 } }] as SimulateCaptureOptions[]) {
      expect((await check(options, 7)).largest, JSON.stringify(options.lens) + JSON.stringify(options.motion ?? {})).toBeLessThan(BOUND);
    }
  }, scaledTimeout(300_000));

  it("is the fast default with more than one offset, reported in view.lensPsf; off with fast: false, the point aperture or a fisheye", async () => {
    const view = { width: 48, height: 32 };
    const value = async (options: SimulateCaptureOptions): Promise<unknown> => ((await simulateDisplayView(options, view)).assumptions.find((a) => a.id === "view.lensPsf")!.value as { offsetMapping: unknown }).offsetMapping;
    expect(await value(request("pv-50-1.8", 4, BOX))).toBe("second-order-expansion");
    expect(await value({ ...request("pv-50-1.8", 4, BOX), fast: false })).toBeNull();
    expect(await value(request("pv-50-1.8", 4, {}))).toBeNull();
    expect(await value(request("pv-8-3.5-fisheye-pro", 5.6, BOX))).toBeNull();
    // A region equals the same pixels of the whole view with the method on (a centre's coefficients depend only on its 3 × 3 centres).
    const options = request("pv-24-1.8", 1.8, BOX), whole = await simulateDisplayView(options, view), part = await simulateDisplayView(options, { ...view, region: { x: 9, y: 7, width: 20, height: 11 } });
    for (let y = 0; y < 11; y++) for (let x = 0; x < 60; x++) expect(part.image.samples[y * 60 + x], `${x}, ${y}`).toBe(whole.image.samples[(y + 7) * 144 + 27 + x]);
  }, scaledTimeout(300_000));
});
