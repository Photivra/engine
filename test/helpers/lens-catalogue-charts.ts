// SPDX-License-Identifier: Apache-2.0
/**
 * #549: the chart helpers of test/simulate-capture-lens-catalogue.test.ts and -2.test.ts (split in 2.24.0 so that each file fits
 * its coverage shard): region captures on a full frame, the slanted-edge and point measures, and #568's fast-method agreement.
 */
import { expect } from "vitest";
import { GENERIC_LENS_CATALOGUE, resolveGenericLens, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../../src/index.js";

export const widest = (id: string): number => GENERIC_LENS_CATALOGUE.find((lens) => lens.lensId === id)!.widestFNumber;
/** Linear-light values of one channel of an srgb-16 image. */
export function linear(r: SimulateCaptureResult, channel: number): Float64Array {
  const s = r.image.samples, n = r.image.width * r.image.height;
  return Float64Array.from({ length: n }, (_, i) => { const e = s[i * 3 + channel]! / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; });
}
/** Exposure for a mid-grey reference at f/8 1/125 s, kept at any f-number. */
export const exposureAt = (fNumber: number): NonNullable<SimulateCaptureOptions["exposure"]> => ({ mode: "manual", shutterSeconds: (fNumber / 8) ** 2 / 125, iso: 100 });

/** A full frame (36 × 24 mm) at `pitch` µm: the region of `size` pixels at the centre or 120 pixels in from the top-right corner. */
export function frame(pitch: number, size: number, where: "centre" | "corner"): { W: number; H: number; x0: number; y0: number; centre: { u: number; v: number } } {
  const W = Math.round(36000 / pitch), H = Math.round(24000 / pitch);
  const [x0, y0] = where === "corner" ? [W - 120 - size, 120] : [W / 2 - size / 2, H / 2 - size / 2];
  return { W, H, x0, y0, centre: { u: (x0 + size / 2 - W / 2) / (W / 2), v: (H / 2 - y0 - size / 2) / (W / 2) } };
}
/** The chart point (frame units) whose distorted image lands at the image point (u, v): r_d = r_i(1 + k1·ρ_i²). */
export function undistort(id: string, u: number, v: number, aspect: number): { u: number; v: number } {
  const k1 = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: 36, heightMm: 24 } }).character.distortion.corner;
  const rd = Math.hypot(u, v) / Math.hypot(1, aspect);
  if (rd === 0) return { u, v };
  let ri = rd;
  for (let i = 0; i < 60; i++) ri = rd / (1 + k1 * ri * ri);
  return { u: u * ri / rd, v: v * ri / rd };
}
export async function regionCapture(id: string, fNumber: number, pitch: number, size: number, where: "centre" | "corner",
  element: (at: { u: number; v: number }, pixel: number) => Element, fast = false): Promise<SimulateCaptureResult> {
  const f = frame(pitch, size, where), at = undistort(id, f.centre.u, f.centre.v, f.H / f.W);
  return simulateCapture({ scene: { preset: "composite", background: { preset: "uniform", reflectance: 0.02 }, elements: [element(at, 2 / f.W)] }, subjectDistanceM: 3,
    output: { width: f.W, height: f.H, maximumPixels: 2 ** 27, format: "srgb-16", region: { x: f.x0, y: f.y0, width: size, height: size } },
    sensor: { pixelPitchMicrometers: pitch, spectralStepNanometers: 50 }, lens: { catalogue: id, fNumber }, exposure: exposureAt(fNumber), fast }).then((r) => (fast ? ranFast(r) : r));
}

/** ISO 12233-style slanted-edge analysis: per-row edge centroid, line fit, 4× oversampled ESF; the 10–90 % rise and the 50 % position. */
export function edge(r: SimulateCaptureResult): { rise: number; blueMinusRed: number } {
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
export type Element = NonNullable<Extract<SimulateCaptureOptions["scene"], { preset: "composite" }>["elements"]>[number];
export const slantedEdge = (at: { u: number; v: number }, pixel: number): Element => ({ scene: { preset: "slanted-edge" as const, angleDegrees: 5, darkReflectance: 0.05, lightReflectance: 0.5 },
  centerU: at.u, centerV: at.v, width: 150 * pixel, height: 150 * pixel });
export const point = (at: { u: number; v: number }, pixel: number): Element => ({ scene: { preset: "uniform" as const, reflectance: 1 }, centerU: at.u, centerV: at.v, width: 1.5 * pixel,
  height: 1.5 * pixel, mask: "ellipse" as const });

/** Outward (radial) offset of a point image's centroid from where the distorted point lies (the region's centre), pixels. */
export function radialCentroidOffset(r: SimulateCaptureResult, where: { u: number; v: number }): number {
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
export const FAST_TOLERANCE = { rise: 0.02, coma: 0.02, lateral: 0.02, distortion: 0.02, vignettingStops: 0.005 };
export function fastAgrees(measure: keyof typeof FAST_TOLERANCE, name: string, fast: number, exact: number): void {
  expect(Math.abs(fast - exact), "fast " + measure + " " + name).toBeLessThan(FAST_TOLERANCE[measure]);
}
export function ranFast(r: SimulateCaptureResult): SimulateCaptureResult {
  expect(r.diagnostics.fast.applied["lens.catalogue"]).toBe(true);
  return r;
}
