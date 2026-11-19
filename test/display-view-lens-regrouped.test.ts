// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { lastDisplayViewLensSetup, prepareDisplayViewLensSignal, regroupedLensDefocusCheaper, rollingLensBands, type DisplayViewLensSetup } from "../src/facade/display-view-lens-signal.js";
import { LENS_ROW_BAND_MAXIMUM_SHIFT_SITES } from "../src/facade/display-view-lens-regroup.js";
import { renderDisplayView } from "../src/facade/display-view.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { siteKernelRuns } from "../src/optics/site-kernel-runs.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #651: the lens signal's defocus regrouped (src/facade/display-view-lens-regroup.ts and the fixed tiles of display-view-lens-signal.ts):
 * the in-focus signal at every site position (all three channels from one lattice lookup per point), then the disc by runs. Under a
 * global shutter by fixed tiles; under a rolling shutter by row blocks, each row at its own instants (the full method) or at its band's
 * middle row's (the fast method). The reference is the tap sum the view forms with the combined kernels (2.26.0's lens signal).
 * Equivalence (the 2.27.0 plan's tolerance): every site's expected electrons within 1e-9 relative, 8-bit samples within one code.
 */

const UNIT_TAP = Float64Array.of(1);
interface Prepared { lens: DisplayViewLensSetup; W: number; H: number; input: DisplayViewExpectedSignalInput; regrouped: DisplayViewExpectedSignalInput; radius: number }
async function prepare(options: SimulateCaptureOptions, view = { width: 4, height: 4, samplesPerAxis: 1 }): Promise<Prepared & { setup: Awaited<ReturnType<typeof simulateDisplayViewWithInternals>>["setup"] }> {
  const { signalInput, result, setup } = await simulateDisplayViewWithInternals(options, view);
  const last = lastDisplayViewLensSetup()!, diameter = (result.assumptions.find((a) => a.id === "lens.defocus")!.value as { diameterSites: number }).diameterSites;
  const disc = createDefocusDiscSiteKernel(diameter)!;
  // Without diffraction the combined kernel is the disc at every node; the regrouped input reads the lattice through a unit tap.
  expect(signalInput.kernels!.radius).toBe(disc.radius);
  const regrouped: DisplayViewExpectedSignalInput = { ...signalInput, kernels: { radius: 0, perNode: signalInput.wavelengthsNm.map(() => UNIT_TAP) },
    largeKernel: siteKernelRuns(disc.weights, disc.radius), inFocusPerTap: true, perTapSum: false };
  return { lens: last.lens, W: last.nativeWidth, H: last.nativeHeight, input: { ...signalInput, perTapSum: false }, regrouped, radius: disc.radius, setup };
}
function sites(signal: DisplayViewExpectedSignal, W: number, H: number): Float64Array {
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y += 4) {
    signal.window(0, y, W, Math.min(H, y + 4));
    for (let j = y; j < Math.min(H, y + 4); j++) for (let x = 0; x < W; x++) out[j * W + x] = signal.site(x, j);
  }
  return out;
}
function largestRelative(a: Float64Array, b: Float64Array): number {
  let largest = 0;
  for (let i = 0; i < a.length; i++) largest = Math.max(largest, b[i] === 0 ? (a[i] === 0 ? 0 : Infinity) : Math.abs(a[i]! - b[i]!) / b[i]!);
  return largest;
}
const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, Math.max(0, l)) ** (1 / 2.4) - 0.055);

const vignetting = { normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { r2: -0.35, r4: 0.05, r6: 0 } };
const barrel = { kind: "radial", profile: { normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0.02, k3: 0 } } } as const;
const base: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 12 }, subjectDistanceM: 2, output: { width: 24, height: 16 }, sensor: { spectralStepNanometers: 80 },
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } };
const rotation = { angularVelocityRadPerSec: { pitch: 0.2, yaw: 0.5, roll: 3 } };
// Focus distances that give disc radii of 3, 11 and about 40 sites (50 mm f/4, subject at 2 m, 6 µm sites).
const radii: [number, number][] = [[3, 1.8], [11, 1.4], [40, 0.8]];
const kinds: [string, (focusDistanceM: number) => SimulateCaptureOptions][] = [
  ["vignetting and distortion, still", (f): SimulateCaptureOptions => ({ ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: f, defocus: { model: "geometric-disc" }, vignetting, distortion: barrel } })],
  ["rotation, 3 midpoints, global shutter", (f): SimulateCaptureOptions => ({ ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: f, defocus: { model: "geometric-disc" }, vignetting }, motion: rotation,
    sensor: { ...base.sensor, temporalSampleCount: 3 } })],
  ["rotation, 3 midpoints, rolling shutter, distortion and vignetting", (f): SimulateCaptureOptions => ({ ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: f, defocus: { model: "geometric-disc" }, vignetting,
    distortion: barrel }, motion: { ...rotation, shutter: "rolling", rollingShutterSkewSeconds: 0.004 }, sensor: { ...base.sensor, temporalSampleCount: 3 } })],
  ["rotation, 8 midpoints, rolling shutter, the box aperture", (f): SimulateCaptureOptions => ({ ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: f, defocus: { model: "geometric-disc" } },
    motion: { ...rotation, shutter: "rolling", rollingShutterSkewSeconds: 0.004 }, sensor: { ...base.sensor, temporalSampleCount: 8, pixelAperture: { kind: "box", samplesPerAxis: 2 } } })]
];

describe("lens signal with the defocus regrouped (#651)", () => {
  for (const [radius, focusDistanceM] of radii) for (const [name, options] of kinds) {
    it("disc radius " + radius + ", " + name + ": every site within 1e-9 of the tap sum", async () => {
      const p = await prepare(options(focusDistanceM));
      expect(Math.abs(p.radius - radius)).toBeLessThanOrEqual(2);
      const full = { ...p.lens, rollingBands: false };
      const reference = sites(prepareDisplayViewLensSignal(full, p.W, p.H, 0, "test")(p.input), p.W, p.H);
      const regrouped = sites(prepareDisplayViewLensSignal(full, p.W, p.H, 0, "test")(p.regrouped), p.W, p.H);
      expect(largestRelative(regrouped, reference)).toBeLessThan(1e-9);
      if (p.lens.timesAt) {
        // The fast method on this small frame: its bands (if any) move the image by at most 1/128 site.
        const factory = prepareDisplayViewLensSignal({ ...p.lens, rollingBands: true }, p.W, p.H, 0, "test");
        expect(factory.rolling!.lines).toBe("rows");
        expect(factory.rolling!.bands.shiftSites).toBeLessThanOrEqual(LENS_ROW_BAND_MAXIMUM_SHIFT_SITES);
        expect(sites(factory(p.regrouped), p.W, p.H).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
      }
    }, scaledTimeout(180_000));
  }

  it("renders samples within one code of the tap sum, and regions equal the whole view (rolling shutter, rows and bands)", async () => {
    const options = kinds[2]![1](1.4), view = { width: 12, height: 8, samplesPerAxis: 2 };
    const p = await prepare(options, view), setup = p.setup;
    const render = async (signal: DisplayViewExpectedSignal, region = setup.region): Promise<Uint8Array | Uint16Array> =>
      (await renderDisplayView({ ...setup, region, signal, reachSites: setup.reachSites })).samples;
    const tap = await render(prepareDisplayViewLensSignal({ ...p.lens, rollingBands: false }, p.W, p.H, 0, "test")(p.input));
    for (const rollingBands of [false, true]) {
      const factory = prepareDisplayViewLensSignal({ ...p.lens, rollingBands }, p.W, p.H, 0, "test");
      const whole = await render(factory(p.regrouped));
      if (!rollingBands) for (let i = 0; i < whole.length; i++) expect(Math.abs(whole[i]! - tap[i]!)).toBeLessThanOrEqual(1);
      const region = { x: 3, y: 2, width: 6, height: 5 }, part = await render(factory(p.regrouped), region);
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) for (let k = 0; k < 3; k++) expect(part[(y * 6 + x) * 3 + k]).toBe(whole[((y + 2) * 12 + x + 3) * 3 + k]);
    }
  }, scaledTimeout(180_000));

  /*
   * Go/no-go of the fast method (#651 step 3): against the full method (each row at its own instants) on the validation charts, the
   * expected values within 0.1 code RMS and 1 code at most. A 1200 × 800 frame with the benchmark's lens, focus (disc radius 11), rotation and a
   * skew of 7.5 µs per row.
   */
  it("row bands: expected values within 0.1 code RMS and 1 code of the full method on the validation charts", async () => {
    let worstRms = 0, worstMax = 0, rows = 0;
    for (const scene of [{ preset: "siemens-star", cycles: 36 }, { preset: "slanted-edge", angleDegrees: 5 }, { preset: "dead-leaves" }]) {
      const name = scene.preset;
      const options: SimulateCaptureOptions = { scene, subjectDistanceM: 0.63, output: { width: 1200, height: 800 }, sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 40 },
        lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 0.504, defocus: { model: "geometric-disc" } }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
        motion: { angularVelocityRadPerSec: { yaw: 0.0766 }, shutter: "rolling", rollingShutterSkewSeconds: 0.006 } } as SimulateCaptureOptions;
      const p = await prepare(options, { width: 600, height: 400, region: { x: 276, y: 184, width: 48, height: 32 }, samplesPerAxis: 2 } as never);
      const full = prepareDisplayViewLensSignal({ ...p.lens, rollingBands: false }, p.W, p.H, 0, "test"), fast = prepareDisplayViewLensSignal({ ...p.lens, rollingBands: true }, p.W, p.H, 0, "test");
      rows = fast.bandRows!;
      expect(p.radius).toBeGreaterThan(8);
      const a = (await renderDisplayView({ ...p.setup, signal: full(p.regrouped) })).expected, b = (await renderDisplayView({ ...p.setup, signal: fast(p.regrouped) })).expected;
      let sq = 0, max = 0;
      for (let i = 0; i < a.length; i++) { const d = encode8(b[i]!) - encode8(a[i]!); sq += d * d; max = Math.max(max, Math.abs(d)); }
      worstRms = Math.max(worstRms, Math.sqrt(sq / a.length)); worstMax = Math.max(worstMax, max);
      if (process.env.BANDS_REPORT) process.stdout.write("row bands, " + name + ": " + rows + " rows, shift " + fast.rolling!.bands.shiftSites.toFixed(4) + " site, RMS " + Math.sqrt(sq / a.length).toFixed(4) + ", max " + max.toFixed(4) + "\n");
    }
    if (process.env.BANDS_REPORT) process.stdout.write("row bands: " + rows + " rows, RMS " + worstRms.toFixed(4) + " code, max " + worstMax.toFixed(4) + " code\n");
    expect(rows).toBeGreaterThan(1);
    expect(worstRms).toBeLessThan(0.1);
    expect(worstMax).toBeLessThan(1);
  }, scaledTimeout(600_000));

  it("chooses the band height so that every band moves the image by at most 1/128 site, and row blocks for every rolling render", async () => {
    const options: SimulateCaptureOptions = { ...base, output: { width: 240, height: 160 }, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.4, defocus: { model: "geometric-disc" } },
      motion: { angularVelocityRadPerSec: { yaw: 0.05, roll: 0.2 }, shutter: "rolling", rollingShutterSkewSeconds: 0.002 }, sensor: { ...base.sensor, temporalSampleCount: 4 } };
    const { lens, W, H } = await prepare(options), bands = rollingLensBands(lens.geometry, lens.timesAt!, W, H, lens.pitch);
    expect(bands.rows).toBeGreaterThan(1);
    expect(bands.rows % 2).toBe(1);
    // Every row of every band, at every fifth column: the image shift between the row's instants and its band's middle row's.
    const mm = lens.pitch / 1000;
    let worst = 0;
    for (let y = 0; y < H; y++) {
      const mid = Math.min(H - 1, Math.floor(y / bands.rows) * bands.rows + (bands.rows >> 1)), own = lens.timesAt!(0, y), band = lens.timesAt!(0, mid);
      for (let x = 0; x < W; x += 5) for (let i = 0; i < own.length; i++) {
        const xMm = (x + 0.5 - W / 2) * mm, yMm = (y + 0.5 - H / 2) * mm, s = lens.geometry.sensorPointOf(lens.geometry.lookOf(xMm, yMm, own[i]!), band[i]!)!;
        worst = Math.max(worst, Math.hypot(s.x - xMm, s.y - yMm) / mm);
      }
    }
    expect(worst).toBeLessThanOrEqual(LENS_ROW_BAND_MAXIMUM_SHIFT_SITES * 1.05);
    // A rolling view takes the row blocks for every render, whatever its size (one method per request); under a global shutter the
    // cost rule keeps the tap sum for a few sites of a small region and takes the fixed tiles for a large one.
    const factory = prepareDisplayViewLensSignal({ ...lens, rollingBands: true }, W, H, 0, "test"), full = prepareDisplayViewLensSignal({ ...lens, rollingBands: false }, W, H, 0, "test");
    expect(factory.bandRows).toBe(bands.rows);
    expect(full.bandRows).toBe(1);
    for (const f of [factory, full]) { expect(f.regroupedCheaper(1, 1, 1, 11, 0, 21)).toBe(true); expect(f.regroupedCheaper(250, 170, 40000, 11, 0, 21)).toBe(true); }
    const still = prepareDisplayViewLensSignal({ ...lens, timesAt: undefined }, W, H, 0, "test");
    expect(still.bandRows).toBeUndefined();
    expect(still.regroupedCheaper(10, 10, 20, 3, 0, 21)).toBe(false);
    expect(regroupedLensDefocusCheaper(30, 30, 50, 11, 0, 21, 8)).toBe(false);
    expect(regroupedLensDefocusCheaper(250, 170, 40000, 11, 0, 21, 8)).toBe(true);
    expect(regroupedLensDefocusCheaper(10, 10, 20, 3, 0, 21, 1)).toBe(false);
  }, scaledTimeout(180_000));
});
