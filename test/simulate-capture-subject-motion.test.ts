// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, evaluateSrgbDecoding, prepareDisplayView, simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { subjectSourcePoint } from "../src/motion/subject-motion.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #551: subject motion on the scene plane. "Done when": zero velocity equals a static capture; the blur length is v·T·m within
 * sampling error; a rolling shutter skews a moving subject by its readout skew. Also: rotation about the axis, a region over a
 * still background (panning), the display view's sideways motion and refusals, and the fast method's temporal midpoints.
 */
const D = 2, F = 50, PITCH_M = 6e-6, T = 0.01;
/** Magnification m = v′/D, with the thin-lens image distance v′ = f·D/(D − f) (focus at the subject). */
const M = (F / 1000) / (D - F / 1000);
/** Sites on the sensor per metre on the scene plane. */
const SITES_PER_M = M / PITCH_M;
const edge = { kind: "reflectance-function" as const, sceneId: "edge", evaluate: (p: { xM: number }): number => (p.xM >= 0 ? 0.8 : 0.05) };
const request = (width: number, height: number, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene: edge, subjectDistanceM: D,
  lens: { focalLengthMm: F }, exposure: { mode: "manual", shutterSeconds: T, iso: 100 }, illuminanceLux: 25_000,
  output: { width, height, format: "srgb-16", toneCurve: "identity" }, ...extra } as SimulateCaptureOptions);
/** Linear green per column, averaged over rows [y0, y1). */
function profile(r: { image: { width: number; samples: ArrayLike<number> } }, y0: number, y1: number): number[] {
  const w = r.image.width, scale = r.image.samples instanceof Uint8Array ? 255 : 65535;
  return Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = y0; y < y1; y++) s += evaluateSrgbDecoding(r.image.samples[(y * w + x) * 3 + 1]! / scale);
    return s / (y1 - y0);
  });
}
/** The column where a rising profile first crosses fraction f between its low and high ends (linear interpolation). */
function crossing(row: readonly number[], f: number): number {
  const lo = row[0]!, hi = row[row.length - 1]!, level = lo + f * (hi - lo);
  for (let x = 0; x + 1 < row.length; x++) if (row[x]! < level && row[x + 1]! >= level) return x + (level - row[x]!) / (row[x + 1]! - row[x]!);
  return NaN;
}
/** Width of the ramp from 10 % to 90 %, scaled to the full ramp of a linear transition (÷ 0.8). */
const rampWidth = (row: readonly number[]): number => (crossing(row, 0.9) - crossing(row, 0.1)) / 0.8;
const samples = (r: SimulateCaptureResult): number[] => Array.from(r.image.samples);

describe("subject motion (#551)", () => {
  it("equals a static capture at zero velocity, with or without a region and at either sample count", async () => {
    for (const fast of [true, false]) {
      const still = await simulateCapture(request(16, 8, { fast, sensor: { temporalSampleCount: fast ? 1 : 8 } }));
      const zero = await simulateCapture(request(16, 8, { fast, motion: { subject: { velocityMPerSec: { x: 0, y: 0 } } } }));
      const region = await simulateCapture(request(16, 8, { fast, motion: { subject: { velocityMPerSec: {}, region: { centerXM: 0, centerYM: 0, widthM: 0.004, heightM: 0.002 } } } }));
      expect(zero.assumptions.find((a) => a.id === "sensor.temporalSampleCount")?.value ?? zero.assumptions.find((a) => a.id === "fast.motion.subject")?.value).toBeDefined();
      expect(samples(zero)).toEqual(samples(still));
      expect(samples(region)).toEqual(samples(still));
      expect(zero.diagnostics.fast.applied["motion.subject"]).toBe(fast);
    }
    // A chart scene: the still capture takes the tabulated path, the moving one the environment chain (the same sums).
    const star = { scene: { preset: "siemens-star" as const }, output: { width: 16, height: 12 }, fast: false };
    const stillStar = await simulateCapture({ ...star, sensor: { temporalSampleCount: 8 } }), zeroStar = await simulateCapture({ ...star, motion: { subject: {} } });
    expect(samples(zeroStar)).toEqual(samples(stillStar));
  }, scaledTimeout(60_000));

  it("blurs a moving edge over v·T·m on the sensor", async () => {
    const still = await simulateCapture(request(64, 8));
    const L = 24, v = L / (T * SITES_PER_M);
    const moving = await simulateCapture(request(64, 8, { sensor: { temporalSampleCount: 64 }, motion: { subject: { velocityMPerSec: { x: v } } } }));
    expect(moving.assumptions.find((a) => a.id === "motion.subject")!.value).toMatchObject({ streakSites: expect.closeTo(L, 6) });
    const s = profile(still, 0, 8), m = profile(moving, 0, 8);
    expect(rampWidth(s)).toBeLessThan(2.5);
    // Within sampling error: the 64 midpoints step by L/64 sites, and the demosaic widens the ramp by about a site.
    expect(Math.abs(rampWidth(m) - L)).toBeLessThan(1.5);
    // The edge moves right (+x): the ramp's middle sits L/2 right of the still edge.
    expect(crossing(m, 0.5) - crossing(s, 0.5)).toBeCloseTo(L / 2, 0);
    // Moving up (+y) leaves a vertical edge sharp.
    const up = await simulateCapture(request(64, 8, { sensor: { temporalSampleCount: 64 }, motion: { subject: { velocityMPerSec: { y: v } } } }));
    expect(rampWidth(profile(up, 0, 8))).toBeLessThan(2.5);
  }, scaledTimeout(60_000));

  it("skews a moving subject by the rolling shutter's readout skew", async () => {
    const width = 48, height = 32, v = 0.15, skew = 0.02;
    const opts = (shutter: "global" | "rolling"): SimulateCaptureOptions => request(width, height, { exposure: { mode: "manual", shutterSeconds: 0.001, iso: 3200 },
      motion: { subject: { velocityMPerSec: { x: v } }, shutter, ...(shutter === "rolling" ? { rollingShutterSkewSeconds: skew } : {}) } });
    const global = await simulateCapture(opts("global")), rolling = await simulateCapture(opts("rolling"));
    // Each native row opens later; the margin is one site, so output row j is native row j + 1.
    const start = (row: number): number => rolling.request.siteInput((row + 1) * (width + 2)).charge.completenessProfile.startOffsetSecondsFromOpeningReference;
    const shift = (r: SimulateCaptureResult): number => crossing(profile(r, height - 4, height), 0.5) - crossing(profile(r, 0, 4), 0.5);
    const expected = v * SITES_PER_M * (start(height - 2.5) - start(1.5));
    expect(expected).toBeGreaterThan(5);
    expect(Math.abs(shift(global))).toBeLessThan(0.5);
    expect(Math.abs(shift(rolling) - expected)).toBeLessThan(0.75);
  }, scaledTimeout(60_000));

  it("moves the subject through lens.diffraction and lens.defocus (their lattices are read at each midpoint)", async () => {
    const L = 12, v = L / (T * SITES_PER_M), motion = { subject: { velocityMPerSec: { x: v } } }, sensor = { temporalSampleCount: 32 };
    for (const lens of [{ focalLengthMm: F, diffraction: "circular-aperture" }, { focalLengthMm: F, focusDistanceM: 1.9, defocus: { model: "geometric-disc" } }]) {
      const still = profile(await simulateCapture(request(48, 4, { lens, sensor } as Partial<SimulateCaptureOptions>)), 0, 4);
      const moving = profile(await simulateCapture(request(48, 4, { lens, sensor, motion } as Partial<SimulateCaptureOptions>)), 0, 4);
      expect(crossing(moving, 0.5) - crossing(still, 0.5), JSON.stringify(lens)).toBeCloseTo(L / 2, 0);
      expect(rampWidth(moving), JSON.stringify(lens)).toBeGreaterThan(L - 1.5);
    }
  }, scaledTimeout(60_000));

  it("rotates the subject about the optical axis", async () => {
    const width = 32, height = 48, omega = 30;
    const still = await simulateCapture(request(width, height));
    const turning = await simulateCapture(request(width, height, { sensor: { temporalSampleCount: 64 }, motion: { subject: { angularVelocityRadPerSec: omega } } }));
    // At y sites from the axis a vertical edge through it travels y·sin(ωt) sideways; the band of rows [0, 4) is centred 22 sites up.
    const L = 22 * Math.sin(omega * T);
    expect(Math.abs(rampWidth(profile(turning, 0, 4)) - L)).toBeLessThan(1.5);
    expect(Math.abs(rampWidth(profile(turning, height - 4, height)) - L)).toBeLessThan(1.5);
    expect(rampWidth(profile(turning, 22, 26))).toBeLessThan(rampWidth(profile(still, 22, 26)) + 0.75);
    // Counter-clockwise: the top of the edge moves left, the bottom right.
    expect(crossing(profile(turning, 0, 4), 0.5)).toBeLessThan(crossing(profile(still, 0, 4), 0.5) - L / 3);
    expect(crossing(profile(turning, height - 4, height), 0.5)).toBeGreaterThan(crossing(profile(still, height - 4, height), 0.5) + L / 3);
  }, scaledTimeout(60_000));

  it("moves a declared region over a still background, and panning keeps it sharp", async () => {
    // Two bright bars: one in the background (−3.5 to −1.5 mm), one inside the moving region (2.5 to 4.5 mm).
    const bars = { kind: "reflectance-function" as const, sceneId: "bars", evaluate: (p: { xM: number }): number =>
      (p.xM > -3.5e-3 && p.xM < -1.5e-3) || (p.xM > 2.5e-3 && p.xM < 4.5e-3) ? 0.8 : 0.05 };
    const v = 0.2, subject = { velocityMPerSec: { x: v }, region: { centerXM: 3.5e-3, centerYM: 0, widthM: 3e-3, heightM: 1 } };
    const opts = (yaw: number): SimulateCaptureOptions => request(64, 8, { scene: bars, sensor: { temporalSampleCount: 32 },
      motion: { subject, ...(yaw === 0 ? {} : { angularVelocityRadPerSec: { yaw } }) } });
    /** Columns of [x0, x1) partway between the window's low and high values: the blurred ones. */
    const blurred = (row: readonly number[], x0: number, x1: number): number => {
      const part = row.slice(x0, x1), lo = Math.min(...part), hi = Math.max(...part);
      return part.filter((value) => value > lo + 0.15 * (hi - lo) && value < hi - 0.15 * (hi - lo)).length;
    };
    const fixed = profile(await simulateCapture(opts(0)), 0, 8);
    // The camera's yaw follows the subject: ω = −v/D in the engine's rotation convention.
    const panned = profile(await simulateCapture(opts(-v / D)), 0, 8);
    const streak = v * T * SITES_PER_M;
    expect(streak).toBeGreaterThan(8);
    expect(blurred(fixed, 0, 32)).toBeLessThanOrEqual(3);
    expect(blurred(fixed, 32, 64)).toBeGreaterThanOrEqual(2 * Math.floor(streak) - 4);
    expect(blurred(panned, 32, 64)).toBeLessThanOrEqual(4);
    expect(blurred(panned, 0, 32)).toBeGreaterThanOrEqual(2 * Math.floor(streak) - 4);
  }, scaledTimeout(60_000));

  it("maps plane points as the model states", () => {
    const out = new Float64Array(2), region = { vx: 1, vy: 0, omega: 0, region: { cx: 0, cy: 0, hw: 1, hh: 1 } };
    expect(subjectSourcePoint(region, 0.5, 0, 1, out)).toBe(true);
    expect([...out]).toEqual([-0.5, 0]);
    // The rest rectangle's left part is revealed after the subject moves right; outside it the still scene shows.
    expect(subjectSourcePoint(region, -0.5, 0, 1, out)).toBe(false);
    expect(subjectSourcePoint(region, -3, 0, 1, out)).toBe(true);
    expect([...out]).toEqual([-3, 0]);
    const turning = { vx: 0, vy: 0, omega: Math.PI / 2, region: undefined };
    subjectSourcePoint(turning, 0, 1, 1, out);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(0, 12);
  });

  it("takes fewer temporal midpoints for a short streak on screen, and the default 8 when exact", async () => {
    const opts = request(32, 8, { motion: { subject: { velocityMPerSec: { x: 2.5 / (T * SITES_PER_M) } } } });
    const fast = await simulateCapture(opts), exact = await simulateCapture({ ...opts, fast: false });
    expect(fast.diagnostics.fast).toMatchObject({ applied: { "motion.subject": true }, assurance: "approximation-with-a-priori-bound" });
    expect(fast.assumptions.find((a) => a.id === "fast.motion.subject")!.value).toMatchObject({ temporalSampleCount: 4 });
    expect(exact.diagnostics.fast.applied["motion.subject"]).toBe(false);
    expect(exact.assumptions.find((a) => a.id === "sensor.temporalSampleCount")!.value).toBe(8);
    // An explicit count always wins.
    const explicit = await simulateCapture({ ...opts, sensor: { temporalSampleCount: 8 } });
    expect(explicit.diagnostics.fast.applied["motion.subject"]).toBe(false);
    expect(samples(explicit)).toEqual(samples(await simulateCapture({ ...opts, fast: false, output: { ...opts.output!, format: "srgb-16" } })));
  }, scaledTimeout(60_000));

  it("renders sideways motion in the display view and refuses what it cannot render", async () => {
    const L = 24, v = L / (T * SITES_PER_M), opts = request(64, 8, { motion: { subject: { velocityMPerSec: { x: v } } }, sensor: { temporalSampleCount: 32 } });
    const view = await simulateDisplayView(opts, { width: 64, height: 8 });
    expect(Math.abs(rampWidth(profile(view, 0, 8)) - L)).toBeLessThan(2);
    const prepared = await prepareDisplayView({ ...opts, fast: false });
    expect(Array.from((await prepared.render({ width: 64, height: 8 })).image.samples)).toEqual(Array.from(view.image.samples));
    await prepared.dispose();
    const capture = await simulateCapture(opts);
    expect(Math.abs(crossing(profile(view, 0, 8), 0.5) - crossing(profile(capture, 0, 8), 0.5))).toBeLessThan(0.75);
    await expect(simulateDisplayView(request(16, 8, { motion: { subject: { angularVelocityRadPerSec: 1 } } }), { width: 8, height: 4 })).rejects.toThrow(/angularVelocityRadPerSec.*sideways/u);
    await expect(simulateDisplayView(request(16, 8, { motion: { subject: { velocityMPerSec: { x: 1 } }, shutter: "rolling" } }), { width: 8, height: 4 })).rejects.toThrow(/rolling/u);
  }, scaledTimeout(60_000));

  it("rejects malformed subject motion before any radiance work", async () => {
    let calls = 0;
    const scene = { kind: "radiance-function" as const, sceneId: "never", evaluate: (): number => { calls++; return 0.01; } };
    const bad: unknown[] = [{ spin: 1 }, { velocityMPerSec: { x: Number.NaN } }, { velocityMPerSec: { z: 1 } }, { angularVelocityRadPerSec: "1" }, { region: { centerXM: 0, centerYM: 0, widthM: 0, heightM: 1 } },
      { revealedReflectance: 0.5 }, { fast: "yes" }, 3];
    for (const subject of bad) await expect(simulateCapture({ scene, motion: { subject } } as unknown as SimulateCaptureOptions), JSON.stringify(subject)).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ scene, lens: { pupilSampling: { radialSamples: 1, angularSamples: 4 } }, motion: { subject: {} } })).rejects.toThrow(/pupilSampling/u);
    expect(calls).toBe(0);
  });
});
