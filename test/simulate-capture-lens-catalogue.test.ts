// SPDX-License-Identifier: Apache-2.0

/**
 * #549: `simulateCapture` with `lens.catalogue`. Each characteristic of the owner's table is measured on its chart, and the
 * professional lens is better than the consumer one where the table says so:
 * - sharpness across the frame: slanted edges at the centre and the corner of a full frame (10–90 % edge rise);
 * - coma: a point at the corner (outward centroid shift wide open minus stopped down, which leaves only coma: lateral colour
 *   does not change with the aperture and the other aberrations are symmetric);
 * - lateral colour: the blue–red edge offset at the corner (minus the centre's, the demosaic's own offset);
 * - distortion: the bow of a grid line near the frame edge; vignetting: a uniform field's corner fall-off;
 * - fisheyes: the circular image and the full-frame one. Plus `lens.defocus`, `lens.focusScatter` and the refusals.
 */
import { describe, expect, it } from "vitest";
import {
  GENERIC_LENS_CATALOGUE, resolveGenericLens, simulateCapture, simulateDisplayView, SIMULATE_CAPTURE_COST_OPTIONS, InvalidConfigurationError,
  type SimulateCaptureOptions, type SimulateCaptureResult
} from "../src/index.js";
import { calculateSensorEnvironmentRadianceQuery } from "../src/optics/sensor-environment-query.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const widest = (id: string): number => GENERIC_LENS_CATALOGUE.find((lens) => lens.lensId === id)!.widestFNumber;
/** Linear-light values of one channel of an srgb-16 image. */
function linear(r: SimulateCaptureResult, channel: number): Float64Array {
  const s = r.image.samples, n = r.image.width * r.image.height;
  return Float64Array.from({ length: n }, (_, i) => { const e = s[i * 3 + channel]! / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; });
}
/** Exposure for a mid-grey reference at f/8 1/125 s, kept at any f-number. */
const exposureAt = (fNumber: number): NonNullable<SimulateCaptureOptions["exposure"]> => ({ mode: "manual", shutterSeconds: (fNumber / 8) ** 2 / 125, iso: 100 });

/** A full frame (36 × 24 mm) at `pitch` µm: the region of `size` pixels at the centre or 120 pixels in from the top-right corner. */
function frame(pitch: number, size: number, where: "centre" | "corner"): { W: number; H: number; x0: number; y0: number; centre: { u: number; v: number } } {
  const W = Math.round(36000 / pitch), H = Math.round(24000 / pitch);
  const [x0, y0] = where === "corner" ? [W - 120 - size, 120] : [W / 2 - size / 2, H / 2 - size / 2];
  return { W, H, x0, y0, centre: { u: (x0 + size / 2 - W / 2) / (W / 2), v: (H / 2 - y0 - size / 2) / (W / 2) } };
}
/** The chart point (frame units) whose distorted image lands at the image point (u, v): r_d = r_i(1 + k1·ρ_i²). */
function undistort(id: string, u: number, v: number, aspect: number): { u: number; v: number } {
  const k1 = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: 36, heightMm: 24 } }).character.distortion.corner;
  const rd = Math.hypot(u, v) / Math.hypot(1, aspect);
  if (rd === 0) return { u, v };
  let ri = rd;
  for (let i = 0; i < 60; i++) ri = rd / (1 + k1 * ri * ri);
  return { u: u * ri / rd, v: v * ri / rd };
}
async function regionCapture(id: string, fNumber: number, pitch: number, size: number, where: "centre" | "corner",
  element: (at: { u: number; v: number }, pixel: number) => Element, fast = false): Promise<SimulateCaptureResult> {
  const f = frame(pitch, size, where), at = undistort(id, f.centre.u, f.centre.v, f.H / f.W);
  return simulateCapture({ scene: { preset: "composite", background: { preset: "uniform", reflectance: 0.02 }, elements: [element(at, 2 / f.W)] }, subjectDistanceM: 3,
    output: { width: f.W, height: f.H, maximumPixels: 2 ** 27, format: "srgb-16", region: { x: f.x0, y: f.y0, width: size, height: size } },
    sensor: { pixelPitchMicrometers: pitch, spectralStepNanometers: 50 }, lens: { catalogue: id, fNumber }, exposure: exposureAt(fNumber), fast }).then((r) => (fast ? ranFast(r) : r));
}

/** ISO 12233-style slanted-edge analysis: per-row edge centroid, line fit, 4× oversampled ESF; the 10–90 % rise and the 50 % position. */
function edge(r: SimulateCaptureResult): { rise: number; blueMinusRed: number } {
  const S = r.image.width, g = linear(r, 1), rows: number[] = [];
  for (let y = 0; y < S; y++) {
    let m0 = 0, m1 = 0;
    for (let x = 1; x < S; x++) { const d = Math.abs(g[y * S + x]! - g[y * S + x - 1]!); m0 += d; m1 += d * (x - 0.5); }
    rows.push(m1 / m0);
  }
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  rows.forEach((xe, y) => { sy += y; sx += xe; syy += y * y; sxy += y * xe; });
  const b = (S * sxy - sy * sx) / (S * syy - sy * sy), a = (sx - b * sy) / S;
  function crossings(values: Float64Array): { x10: number; x50: number; x90: number } {
    const bins = new Float64Array(S * 4 + 8), counts = new Float64Array(S * 4 + 8), mid = S * 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = Math.round((x - (a + b * y)) * 4) + mid;
      if (k >= 0 && k < bins.length) { bins[k] = bins[k]! + values[y * S + x]!; counts[k] = counts[k]! + 1; }
    }
    const e = Array.from(bins, (v, k) => (counts[k] ? v / counts[k]! : NaN));
    for (let k = 0; k < e.length; k++) if (Number.isNaN(e[k])) e[k] = e[k - 1] ?? e.find((q) => !Number.isNaN(q))!;
    const lo = e.slice(mid - 60, mid - 40).reduce((p, q) => p + q, 0) / 20, hi = e.slice(mid + 40, mid + 60).reduce((p, q) => p + q, 0) / 20;
    const cross = (level: number): number => {
      for (let k = mid - 40; k < mid + 40; k++) {
        const p = (e[k]! - lo) / (hi - lo), q = (e[k + 1]! - lo) / (hi - lo);
        if (p < level && q >= level) return (k + (level - p) / (q - p) - mid) / 4;
      }
      return NaN;
    };
    return { x10: cross(0.1), x50: cross(0.5), x90: cross(0.9) };
  }
  const green = crossings(g), red = crossings(linear(r, 0)), blue = crossings(linear(r, 2));
  return { rise: green.x90 - green.x10, blueMinusRed: blue.x50 - red.x50 };
}
type Element = NonNullable<Extract<SimulateCaptureOptions["scene"], { preset: "composite" }>["elements"]>[number];
const slantedEdge = (at: { u: number; v: number }, pixel: number): Element => ({ scene: { preset: "slanted-edge" as const, angleDegrees: 5, darkReflectance: 0.05, lightReflectance: 0.5 },
  centerU: at.u, centerV: at.v, width: 150 * pixel, height: 150 * pixel });
const point = (at: { u: number; v: number }, pixel: number): Element => ({ scene: { preset: "uniform" as const, reflectance: 1 }, centerU: at.u, centerV: at.v, width: 1.5 * pixel,
  height: 1.5 * pixel, mask: "ellipse" as const });

/** Outward (radial) offset of a point image's centroid from where the distorted point lies (the region's centre), pixels. */
function radialCentroidOffset(r: SimulateCaptureResult, where: { u: number; v: number }): number {
  const S = r.image.width, g = linear(r, 1), background = [...g].sort((p, q) => p - q)[Math.floor(g.length / 2)]!;
  let peak = 0;
  for (let i = 0; i < g.length; i++) if (g[i]! > g[peak]!) peak = i;
  const px = peak % S, py = Math.floor(peak / S);
  let m0 = 0, mx = 0, my = 0;
  for (let y = Math.max(0, py - 8); y <= Math.min(S - 1, py + 8); y++) for (let x = Math.max(0, px - 8); x <= Math.min(S - 1, px + 8); x++) {
    const w = Math.max(0, g[y * S + x]! - background); m0 += w; mx += w * x; my += w * y;
  }
  const ux = where.u / Math.hypot(where.u, where.v), uy = -where.v / Math.hypot(where.u, where.v);
  return (mx / m0 - (S / 2 - 0.5)) * ux + (my / m0 - (S / 2 - 0.5)) * uy;
}

/**
 * #568: each chart measure below is also taken with lens.catalogue's fast method (`fast: true`), which must run and agree with the
 * exact method within FAST_TOLERANCE (measured 2026-11-09: edge rise within 0.01 px, lateral colour 0.003 px, coma, distortion and
 * vignetting 0.000).
 */
const FAST_TOLERANCE = { rise: 0.02, coma: 0.02, lateral: 0.02, distortion: 0.02, vignettingStops: 0.005 };
function fastAgrees(measure: keyof typeof FAST_TOLERANCE, name: string, fast: number, exact: number): void {
  expect(Math.abs(fast - exact), "fast " + measure + " " + name).toBeLessThan(FAST_TOLERANCE[measure]);
}
function ranFast(r: SimulateCaptureResult): SimulateCaptureResult {
  expect(r.diagnostics.fast.applied["lens.catalogue"]).toBe(true);
  return r;
}

describe("simulateCapture lens.catalogue on the charts (#549)", () => {
  const PRO = "pv-24-1.4-pro", CONSUMER = "pv-24-1.8";

  it("sharpness across the frame: the pro lens's edges are sharper at the centre and the corner, and the consumer's corner is softer than its centre", async () => {
    const rise = async (id: string, where: "centre" | "corner", fNumber = widest(id)): Promise<number> => {
      const exact = edge(await regionCapture(id, fNumber, 6, 48, where, slantedEdge)).rise, fast = edge(await regionCapture(id, fNumber, 6, 48, where, slantedEdge, true)).rise;
      fastAgrees("rise", id + " " + where, fast, exact);
      return exact;
    };
    const proCentre = await rise(PRO, "centre"), proCorner = await rise(PRO, "corner"), consumerCentre = await rise(CONSUMER, "centre"), consumerCorner = await rise(CONSUMER, "corner");
    expect(proCorner).toBeLessThan(consumerCorner);
    expect(proCentre).toBeLessThanOrEqual(consumerCentre);
    expect(consumerCorner).toBeGreaterThan(consumerCentre + 0.2);
    // Measured 2026-11-07 (6 µm, 48 rows): pro 0.91 / 1.08 px, consumer 1.00 / 1.43 px (centre / corner).
    expect(consumerCorner - proCorner).toBeGreaterThan(0.2);
  }, scaledTimeout(120_000));

  it("coma: the consumer lens's corner point flares outward wide open; the pro lens's much less", async () => {
    const f = frame(3, 32, "corner"), shift = async (id: string, fast: boolean): Promise<number> =>
      radialCentroidOffset(await regionCapture(id, widest(id), 3, 32, "corner", point, fast), f.centre) - radialCentroidOffset(await regionCapture(id, 5.6, 3, 32, "corner", point, fast), f.centre);
    const comaShift = async (id: string): Promise<number> => { const exact = await shift(id, false); fastAgrees("coma", id, await shift(id, true), exact); return exact; };
    const consumer = await comaShift(CONSUMER), pro = await comaShift(PRO);
    // Measured 2026-11-07 (3 µm, 50 nm spectral step): consumer 0.36 px outward, pro 0.02 px.
    expect(consumer).toBeGreaterThan(0.25);
    expect(pro).toBeLessThan(consumer / 3);
  }, scaledTimeout(120_000));

  it("lateral colour: blue and red edges separate at the corner, three times more with the consumer lens", async () => {
    const offset = async (id: string, fast: boolean): Promise<number> => edge(await regionCapture(id, widest(id), 6, 48, "corner", slantedEdge, fast)).blueMinusRed -
      edge(await regionCapture(id, widest(id), 6, 48, "centre", slantedEdge, fast)).blueMinusRed;
    const ca = async (id: string): Promise<number> => { const exact = await offset(id, false); fastAgrees("lateral", id, await offset(id, true), exact); return exact; };
    const consumer = await ca(CONSUMER), pro = await ca(PRO);
    // Expected horizontal component of L·R·(D_blue − D_red) at the corner: about 1 px (consumer) and 0.3 px (pro) at 6 µm.
    expect(consumer).toBeGreaterThan(0.5);
    expect(pro).toBeLessThan(consumer / 1.8);
    expect(pro).toBeGreaterThan(0);
  }, scaledTimeout(120_000));

  /** Whole-frame view (36 × 24 mm on 120 × 80 or 300 × 200 pixels): the field-scale characters. */
  const wholeFrame = (id: string, fNumber: number, scene: SimulateCaptureOptions["scene"], W: number, fast = false): Promise<SimulateCaptureResult> => simulateCapture({ scene, subjectDistanceM: 5,
    output: { width: W, height: W * 2 / 3, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 50 }, lens: { catalogue: id, fNumber }, exposure: exposureAt(fNumber), fast }).then((r) => (fast ? ranFast(r) : r));

  it("distortion: a grid line near the frame edge bows by the lens's k1, barrel, more for the consumer lens", async () => {
    const W = 300, H = 200;
    const bowOf = async (id: string, fast: boolean): Promise<{ measured: number; expected: number }> => {
      // Vertical lines at u = 0, ±0.45, ±0.9; horizontal ones at v = 0, ±0.45, so rows 66 (v ≈ 0.22) and 7 (v ≈ 0.62) cross only the vertical line.
      const r = await wholeFrame(id, 8, { preset: "line-grid", spacing: 0.45, lineWidth: 0.03, lineReflectance: 0.05, backgroundReflectance: 0.6 }, W, fast), g = linear(r, 1);
      /** The x position of the vertical line at u = 0.9 in row y (centroid of darkness in a window). */
      const lineX = (y: number): number => {
        // Darkness relative to the row's background, flat-fielded by a line through the window's ends (vignetting dims it towards the corner).
        let left = 0, right = 0, m0 = 0, m1 = 0;
        for (let k = 0; k < 4; k++) { left += g[y * W + 266 + k]! / 4; right += g[y * W + 294 + k]! / 4; }
        for (let x = 266; x < 298; x++) {
          const w = Math.max(0, 0.7 - g[y * W + x]! / (left + (right - left) * (x - 267.5) / 28)); m0 += w; m1 += w * (x + 0.5);
        }
        return m1 / m0;
      };
      // Two rows each (the Bayer mosaic samples a thin line differently on even and odd rows).
      const mid = (lineX(66) + lineX(67)) / 2, top = (lineX(7) + lineX(8)) / 2;
      // r_d = r(1 + k1ρ²): the line's x at the middle row and at row 9 (ρ from the half-diagonal).
      const k1 = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: 36, heightMm: 24 } }).character.distortion.corner, half = Math.hypot(W / 2, H / 2);
      const xd = (x: number, y: number): number => x * (1 + k1 * (x * x + y * y) / half ** 2);
      return { measured: mid - top, expected: xd(0.9 * W / 2, H / 2 - 67) - xd(0.9 * W / 2, H / 2 - 8) };
    };
    const bow = async (id: string): Promise<{ measured: number; expected: number }> => {
      const exact = await bowOf(id, false);
      fastAgrees("distortion", id, (await bowOf(id, true)).measured, exact.measured);
      return exact;
    };
    const consumer = await bow(CONSUMER), pro = await bow(PRO);
    // Measured 2026-11-07 (120 µm pixels, so positions move in steps): consumer 0.60 px (expected 0.92), pro within 0.5 px of its 0.31.
    expect(consumer.measured).toBeGreaterThan(0.3);
    expect(Math.abs(consumer.measured - consumer.expected)).toBeLessThan(0.5);
    expect(Math.abs(pro.measured - pro.expected)).toBeLessThan(0.5);
    expect(consumer.measured).toBeGreaterThan(pro.measured);
  }, scaledTimeout(240_000));

  it("vignetting: the corner fall-off follows the profile (with the distortion's area factor), more for the consumer lens and less stopped down", async () => {
    const W = 120, H = 80;
    const falloffOf = async (id: string, fNumber: number, fast: boolean): Promise<{ measured: number; expected: number }> => {
      const g = linear(await wholeFrame(id, fNumber, { preset: "uniform", reflectance: 0.5 }, W, fast), 1);
      const mean = (x0: number, y0: number, n: number): number => { let s = 0; for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) s += g[y * W + x]!; return s / (n * n); };
      const c = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: 36, heightMm: 24 }, fNumber }).character;
      const rho = Math.hypot(W / 2 - 1.5, H / 2 - 1.5) / Math.hypot(W / 2, H / 2), b = 1 - 2 ** (-c.vignetting.cornerStops / 2), k1 = c.distortion.corner;
      // Relative illumination (1 − bρ²)² times the distortion area factor 1/det J, det J = (1 + k1ρ_i²)(1 + 3k1ρ_i²) (ρ_i ≈ ρ here).
      const expected = -Math.log2((1 - b * rho * rho) ** 2) + Math.log2((1 + k1 * rho * rho) * (1 + 3 * k1 * rho * rho));
      return { measured: Math.log2(mean(W / 2 - 4, H / 2 - 4, 8) / mean(0, 0, 3)), expected };
    };
    const falloff = async (id: string, fNumber: number): Promise<{ measured: number; expected: number }> => {
      const exact = await falloffOf(id, fNumber, false);
      fastAgrees("vignettingStops", id + " f/" + fNumber, (await falloffOf(id, fNumber, true)).measured, exact.measured);
      return exact;
    };
    const consumer = await falloff(CONSUMER, 1.8), pro = await falloff(PRO, 1.4), consumerStopped = await falloff(CONSUMER, 5.6);
    for (const v of [consumer, pro, consumerStopped]) expect(Math.abs(v.measured - v.expected)).toBeLessThan(0.08);
    expect(consumer.measured).toBeGreaterThan(pro.measured + 0.3);
    expect(consumerStopped.measured).toBeLessThan(consumer.measured - 0.5);
  }, scaledTimeout(120_000));

  it("fisheyes: the 8 mm draws its 180° circle with black outside it; the 15 mm fills the frame", async () => {
    const W = 60, H = 40, checker = { preset: "checkerboard" as const, squaresAcross: 16, darkReflectance: 0.3, lightReflectance: 0.6 };
    const circular = linear(await wholeFrame("pv-8-3.5-fisheye-pro", 3.5, checker, W), 1), full = linear(await wholeFrame("pv-15-2.8-fisheye-pro", 2.8, checker, W), 1);
    const at = (img: Float64Array, x: number, y: number): number => img[y * W + x]!;
    // The circle's radius 2·8·sin 45° = 11.3 mm < the 12 mm half-height: the corners and the frame's left and right ends are black.
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [0, H / 2], [W - 1, H / 2]] as const) expect(at(circular, x, y)).toBeLessThan(0.002);
    expect(at(circular, W / 2, H / 2)).toBeGreaterThan(0.05);
    for (const [x, y] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]] as const) expect(at(full, x, y)).toBeGreaterThan(0.006);
  }, scaledTimeout(120_000));
});

describe("simulateCapture lens.catalogue options (#549)", () => {
  const base: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, sensor: { spectralStepNanometers: 80 } };

  it("reports the lens, its character and the options that ran", async () => {
    const r = await simulateCapture({ ...base, lens: { catalogue: "pv-50-1.8", fNumber: 2.8 }, exposure: exposureAt(2.8) });
    const lens = r.assumptions.find((a) => a.id === "lens.catalogue")!, character = r.assumptions.find((a) => a.id === "lens.catalogue.character")!;
    expect((lens.value as { name: string }).name).toBe("PV 50 1.8");
    expect((character.value as { fNumber: number }).fNumber).toBe(2.8);
    expect(character.explanation).toMatch(/approximation/);
    expect((character.value as { notRendered: object }).notRendered).toHaveProperty("strayLight");
    expect(r.diagnostics.options).toEqual(["lens.distortion", "lens.vignetting", "lens.psf", "lens.catalogue"]);
    expect(SIMULATE_CAPTURE_COST_OPTIONS).toContain("lens.catalogue");
    expect(r.exposure.settings.fNumber).toBe(2.8);
    const fisheye = await simulateCapture({ ...base, subjectDistanceM: 2, lens: { catalogue: "pv-15-2.8-fisheye-pro", fNumber: 4 }, exposure: exposureAt(4) });
    expect(fisheye.diagnostics.options).toEqual(["lens.projection", "lens.distortion", "lens.vignetting", "lens.psf", "lens.catalogue"]);
  }, scaledTimeout(60_000));

  it("lens.defocus convolves the disc into the lens's PSF: an out-of-focus edge is wider, in focus nothing changes", async () => {
    // A 48 × 48 region at the centre of a full frame (36 × 24 mm at 6 µm), so the lens is the full-frame 50 mm.
    const options = (focusDistanceM: number, defocus: boolean): SimulateCaptureOptions => ({ ...base, scene: { preset: "slanted-edge", angleDegrees: 5, darkReflectance: 0.05, lightReflectance: 0.5 },
      output: { width: 6000, height: 4000, maximumPixels: 2 ** 27, format: "srgb-16", region: { x: 2976, y: 1976, width: 48, height: 48 } }, sensor: { spectralStepNanometers: 50 }, subjectDistanceM: 2,
      lens: { catalogue: "pv-50-1.8", fNumber: 4, focusDistanceM, ...(defocus ? { defocus: { model: "geometric-disc" as const } } : {}) }, exposure: exposureAt(4) });
    const sharp = await simulateCapture(options(2, false)), inFocus = await simulateCapture(options(2, true)), blurred = await simulateCapture(options(1.9, true));
    expect(inFocus.image.samples).toEqual(sharp.image.samples);
    expect(edge(blurred).rise).toBeGreaterThan(edge(sharp).rise + 0.5);
    const assumption = blurred.assumptions.find((a) => a.id === "lens.defocus")!;
    expect((assumption.value as { execution: string }).execution).toBe("catalogue-lens-psf");
    expect(blurred.diagnostics.options).toContain("lens.defocus");
    // A disc too large for the quadrature's combined limit is refused, with the reason.
    await expect(simulateCapture({ ...options(1, true), lens: { catalogue: "pv-50-1.8", fNumber: 1.8, focusDistanceM: 1, defocus: { model: "geometric-disc" } }, exposure: exposureAt(1.8) }))
      .rejects.toThrow(/over the limit of 16/);
  }, scaledTimeout(60_000));

  it("lens.focusScatter moves the focus by the seeded sample and is off by default", async () => {
    const options = (scatter: boolean): SimulateCaptureOptions => ({ ...base, subjectDistanceM: 2,
      lens: { catalogue: "pv-50-1.8", fNumber: 1.8, defocus: { model: "geometric-disc" }, ...(scatter ? { focusScatter: { seed: 3, shotIndex: 2 } } : {}) }, exposure: exposureAt(1.8) });
    const plain = await simulateCapture(options(false)), scattered = await simulateCapture(options(true)), again = await simulateCapture(options(true));
    expect(plain.assumptions.some((a) => a.id === "lens.focusScatter")).toBe(false);
    const sample = scattered.assumptions.find((a) => a.id === "lens.focusScatter")!.value as { focusDistanceM: number; intendedFocusDistanceM: number };
    expect(sample.intendedFocusDistanceM).toBe(2);
    expect(sample.focusDistanceM).not.toBe(2);
    expect((scattered.assumptions.find((a) => a.id === "lens.defocus")!.value as { focusDistanceM: number }).focusDistanceM).toBe(sample.focusDistanceM);
    expect(again.image.samples).toEqual(scattered.image.samples);
    expect(scattered.image.samples).not.toEqual(plain.image.samples);
  }, scaledTimeout(60_000));

  it("refuses combinations the lens sets itself, unknown ids and out-of-range settings, in the capture and the display view", async () => {
    for (const lens of [{ catalogue: "pv-50-1.8", prime: 50 }, { catalogue: "pv-50-1.8", focalLengthMm: 50 }, { catalogue: "pv-50-1.8", diffraction: "circular-aperture" },
      { catalogue: "pv-50-1.8", projection: "rectilinear" }, { catalogue: "pv-50-1.8", pupilSampling: { radialSamples: 1, angularSamples: 4 } }, { catalogue: "pv-50-1.4" },
      { focusScatter: { seed: 1 } }, { catalogue: "pv-50-1.8", focusScatter: { seed: 1, extra: 1 } }]) {
      await expect(simulateCapture({ ...base, lens: lens as never })).rejects.toThrow(InvalidConfigurationError);
    }
    await expect(simulateCapture({ ...base, lens: { catalogue: "pv-50-1.8", fNumber: 1.4 } })).rejects.toThrow(/outside the PV 50 1.8 range/);
    // On a whole full frame the 50 mm focuses no closer than 0.05·(1 + 1/0.15) = 0.383 m.
    await expect(simulateCapture({ ...base, output: { width: 24, height: 16 }, sensor: { pixelPitchMicrometers: 1500 }, subjectDistanceM: 0.3, lens: { catalogue: "pv-50-1.8", fNumber: 2 } }))
      .rejects.toThrow(/focuses no closer than 0.383/);
    // #569: the display view renders catalogue lenses (test/display-view-lens-catalogue.test.ts) and refuses what the capture refuses.
    await expect(simulateDisplayView({ ...base, lens: { catalogue: "pv-50-1.8", fNumber: 1.4 } }, { width: 12, height: 8 })).rejects.toThrow(/outside the PV 50 1.8 range/);
  });
});

describe("the fisheye support stays opt-in (#549)", () => {
  it("a lens field mapping without outsideImageCircle still refuses points outside the image circle", () => {
    const input = { sourcePointNativeSensorMm: { x: 20, y: 0 }, focalLengthMm: 8, focus: { kind: "infinity" as const }, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
      timeReference: "first-opening-boundary-phase" as const, timeSecondsFromOpeningReference: 0, environmentDirectionConvention: "outgoing-radiance-toward-camera" as const,
      request: { schemaVersion: "0.1.0" as const, sampleId: "s", providerProfileId: "p", sceneId: "scene", illuminationProfileId: "i", materialResponseProfileId: "m", wavelengthNanometers: 550,
        wavelengthBasis: "vacuum" as const } };
    const mapping = { projectionModel: "fisheye-equisolid-angle" as const, distortion: { kind: "none" as const }, radiometricAreaCorrection: "inverse-distortion-jacobian" as const };
    expect(() => calculateSensorEnvironmentRadianceQuery({ ...input, lensFieldMapping: mapping } as never)).toThrow(/image circle/);
    const back = calculateSensorEnvironmentRadianceQuery({ ...input, lensFieldMapping: { ...mapping, outsideImageCircle: "backward-ray" } } as never).value;
    expect(back.referenceLookDirectionUnitVector).toEqual({ x: 0, y: 0, z: -1 });
    expect(() => calculateSensorEnvironmentRadianceQuery({ ...input, lensFieldMapping: { ...mapping, outsideImageCircle: "zero" } } as never)).toThrow(InvalidConfigurationError);
  });
});
