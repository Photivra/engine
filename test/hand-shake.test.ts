// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateHandShakeAngularDisplacement, calculateHandShakeRmsDisplacement, createHandShakeTrajectory, evaluateSrgbDecoding, HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC,
  InvalidConfigurationError, simulateCapture, type HandShakeTrajectory, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { shakenAngularVelocity } from "../src/motion/camera-rotation.js";
import { handShakeQuadruples } from "../src/motion/hand-shake.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #641: the hand-shake trajectory (src/motion/hand-shake.ts) and `motion.handheld`. The references are the model's own closed forms
 * (θ(0) = 0, the bound 2·Σa, the RMS rate √(Σ(2πf·a)²/2), the phase-averaged displacement), evaluated independently here, and, for the
 * capture, the edge spread a still edge gets from the trajectory's image displacements at the temporal midpoints.
 */
const DEG = Math.PI / 180;
const handShakeAngularDisplacement = (trajectory: HandShakeTrajectory, timeSeconds: number): { pitch: number; yaw: number; roll: number } =>
  calculateHandShakeAngularDisplacement({ trajectory, timeSeconds }).value;
const handShakeRmsDisplacementRad = (trajectory: HandShakeTrajectory, timeSeconds: number): number => calculateHandShakeRmsDisplacement({ trajectory, timeSeconds }).value.rmsDisplacementRad;

describe("hand-shake trajectory (#641)", () => {
  it("is deterministic for a seed, and a different seed gives another trajectory", () => {
    expect(createHandShakeTrajectory({ seed: 12 })).toEqual(createHandShakeTrajectory({ seed: 12 }));
    expect(createHandShakeTrajectory()).toEqual(createHandShakeTrajectory({ seed: 0, stabilizationStops: 0 }));
    expect(createHandShakeTrajectory({ seed: 13 }).components).not.toEqual(createHandShakeTrajectory({ seed: 12 }).components);
    // The phases and jitters are a pinned xorshift32 stream: seed 0's first component, bit for bit on every platform.
    const first = createHandShakeTrajectory().components[0]!;
    expect(first.axis).toBe("pitch");
    expect(first.frequencyHz).toBeGreaterThan(0.7 * 2 ** -0.25);
    expect(first.frequencyHz).toBeLessThan(0.7 * 2 ** 0.25);
    expect(handShakeAngularDisplacement(createHandShakeTrajectory({ seed: 5 }), 0.37)).toEqual(handShakeAngularDisplacement(createHandShakeTrajectory({ seed: 5 }), 0.37));
  });

  it("starts at the exposure start, stays within its bound at every time and has the cited RMS rate", () => {
    for (const seed of [0, 1, 2, 3, 42, 4294967295]) {
      const t = createHandShakeTrajectory({ seed });
      expect(handShakeAngularDisplacement(t, 0)).toEqual({ pitch: 0, yaw: 0, roll: 0 });
      // Bound: 2·Σ a on each axis, recomputed here.
      for (const axis of ["pitch", "yaw"] as const) {
        const bound = 2 * t.components.filter((c) => c.axis === axis).reduce((s, c) => s + c.amplitudeRad, 0);
        expect(t.boundRad[axis]).toBeCloseTo(bound, 15);
      }
      let largest = { pitch: 0, yaw: 0 };
      for (let i = 0; i <= 60_000; i++) {
        const d = handShakeAngularDisplacement(t, i * 0.0005);
        expect(d.roll).toBe(0);
        largest = { pitch: Math.max(largest.pitch, Math.abs(d.pitch)), yaw: Math.max(largest.yaw, Math.abs(d.yaw)) };
      }
      expect(largest.pitch).toBeLessThanOrEqual(t.boundRad.pitch);
      expect(largest.yaw).toBeLessThanOrEqual(t.boundRad.yaw);
      // Bounded well below what a constant 4.39 °/s turns in 30 s (132°): under 3° per axis.
      expect(Math.max(t.boundRad.pitch, t.boundRad.yaw)).toBeLessThan(3 * DEG);
      // RMS angular speed over the phases: √(Σ (2πf·a)²/2) over both axes = 4.39 °/s (Xiao et al. 2009).
      const speed = Math.sqrt(t.components.reduce((s, c) => s + (2 * Math.PI * c.frequencyHz * c.amplitudeRad) ** 2 / 2, 0));
      expect(speed / HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC).toBeCloseTo(1, 12);
      // How it grows: linear at first (within 10 % at 100 ms, Xiao et al. 2007), then it levels off near a degree.
      const v = HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC;
      expect(handShakeRmsDisplacementRad(t, 0.001) / (v * 0.001)).toBeCloseTo(1, 4);
      expect(handShakeRmsDisplacementRad(t, 0.1) / (v * 0.1)).toBeGreaterThan(0.88);
      for (const seconds of [1, 3, 30]) expect(handShakeRmsDisplacementRad(t, seconds)).toBeLessThan(1.6 * DEG);
      // The tremor component lies in 8–12 Hz (McAuley & Marsden 2000), the sway ones below 7 Hz.
      for (const c of t.components) expect(c.frequencyHz).toBeLessThan(12);
      expect(t.components.filter((c) => c.frequencyHz >= 8)).toHaveLength(2);
    }
  });

  it("scales by 2^−stops with stabilization, and the engine's velocity fold is the same rotation", () => {
    const none = createHandShakeTrajectory({ seed: 3 });
    for (const stops of [1, 2.5, 4]) {
      const stabilized = createHandShakeTrajectory({ seed: 3, stabilizationStops: stops });
      expect(stabilized.scale).toBeCloseTo(2 ** -stops, 15);
      for (const time of [0.01, 0.2, 1.7]) {
        const a = handShakeAngularDisplacement(none, time), b = handShakeAngularDisplacement(stabilized, time);
        expect(b.pitch / a.pitch).toBeCloseTo(2 ** -stops, 12);
        expect(b.yaw / a.yaw).toBeCloseTo(2 ** -stops, 12);
      }
      expect(handShakeRmsDisplacementRad(stabilized, 0.25) / handShakeRmsDisplacementRad(none, 0.25)).toBeCloseTo(2 ** -stops, 12);
    }
    // shakenAngularVelocity(ω, shake, t)·t = ω·t + θ(t), as every render path forms it.
    const omega = { pitch: 0.01, yaw: -0.02, roll: 0.003 }, shake = handShakeQuadruples(none);
    for (const time of [0.003, 0.4, 2]) {
      const w = shakenAngularVelocity(omega, shake, time), d = handShakeAngularDisplacement(none, time);
      expect(w.pitch * time).toBeCloseTo(omega.pitch * time + d.pitch, 14);
      expect(w.yaw * time).toBeCloseTo(omega.yaw * time + d.yaw, 14);
      expect(w.roll * time).toBeCloseTo(omega.roll * time, 14);
    }
    expect(shakenAngularVelocity(omega, shake, 0)).toBe(omega);
  });

  it("refuses invalid options", async () => {
    expect(() => createHandShakeTrajectory({ seed: -1 })).toThrow(/seed must be an integer/u);
    expect(() => createHandShakeTrajectory({ seed: 1.5 })).toThrow(/seed must be an integer/u);
    expect(() => createHandShakeTrajectory({ stabilizationStops: 11 })).toThrow(/stabilizationStops must be a number from 0 to 10/u);
    expect(() => createHandShakeTrajectory({ stabilizationStops: Number.NaN })).toThrow(InvalidConfigurationError);
    expect(() => createHandShakeTrajectory({ seeds: 1 } as never)).toThrow(/createHandShakeTrajectory input has unknown field "seeds"/u);
    expect(() => calculateHandShakeAngularDisplacement({ trajectory: { components: [{ axis: "roll", amplitudeRad: 1, frequencyHz: 1, phaseTurns: 0 }] } as never, timeSeconds: 1 }))
      .toThrow(/trajectory must be a hand-shake trajectory/u);
    expect(() => calculateHandShakeRmsDisplacement({ trajectory: createHandShakeTrajectory(), timeSeconds: -1 })).toThrow(/timeSeconds must be a finite number/u);
    const options = { output: { width: 8, height: 8 } } as SimulateCaptureOptions;
    await expect(simulateCapture({ ...options, motion: { handheld: { seeds: 1 } as never } })).rejects.toThrow(/motion\.handheld has unknown field "seeds"/u);
    await expect(simulateCapture({ ...options, motion: { handheld: 3 as never } })).rejects.toThrow(/motion\.handheld must be a record/u);
  });
});

// The capture: a still vertical edge seen through a handheld camera spreads by the yaw displacements' image positions.
const D = 2, F = 50, PITCH_MM = 0.006, T = 1 / 8, N = 32;
const edge = { kind: "reflectance-function" as const, sceneId: "edge", evaluate: (p: { xM: number }): number => (p.xM >= 0 ? 0.8 : 0.05) };
const request = (motion: SimulateCaptureOptions["motion"]): SimulateCaptureOptions => ({ scene: edge, subjectDistanceM: D, lens: { focalLengthMm: F },
  exposure: { mode: "manual", shutterSeconds: T, iso: 100 }, illuminanceLux: 3_000, sensor: { temporalSampleCount: N },
  output: { width: 160, height: 16, format: "srgb-16", toneCurve: "identity" }, ...(motion ? { motion } : {}) } as SimulateCaptureOptions);
/** The variance (sites²) of the line spread: the derivative of the row-averaged linear green profile near the edge, as a distribution. */
function lineSpreadVariance(r: SimulateCaptureResult): number {
  const w = r.image.width, h = r.image.height, row = Array.from({ length: w }, (_, x) => {
    let s = 0;
    for (let y = 0; y < h; y++) s += evaluateSrgbDecoding(r.image.samples[(y * w + x) * 3 + 1]! / 65535);
    return s / h;
  });
  // The columns within 50 of the edge (column 80): the spread is under 30 sites, and the far columns carry only noise.
  const lsf = row.slice(1).map((v, x) => (Math.abs(x + 0.5 - w / 2) <= 50 ? v - row[x]! : 0)), total = lsf.reduce((a, b) => a + b, 0);
  const mean = lsf.reduce((a, v, x) => a + v * x, 0) / total;
  return lsf.reduce((a, v, x) => a + v * (x - mean) ** 2, 0) / total;
}
/** The variance (sites²) of the edge's image shifts at the N temporal midpoints: d·tan(yaw(t))/pitch, d the thin-lens image distance. */
function predictedVariance(stops: number): number {
  const t = createHandShakeTrajectory({ seed: 9, stabilizationStops: stops }), d = F * D * 1000 / (D * 1000 - F);
  const x = Array.from({ length: N }, (_, i) => d * Math.tan(handShakeAngularDisplacement(t, (i + 0.5) * T / N).yaw) / PITCH_MM);
  const mean = x.reduce((a, b) => a + b, 0) / N;
  return x.reduce((a, v) => a + (v - mean) ** 2, 0) / N;
}

describe("motion.handheld captures (#641)", () => {
  it("is deterministic per seed, records the trajectory and spreads an edge as the trajectory predicts, 2^−stops narrower when stabilized", async () => {
    const still = await simulateCapture(request(undefined));
    const shaken = await simulateCapture(request({ handheld: { seed: 9 } })), again = await simulateCapture(request({ handheld: { seed: 9 } }));
    expect(Array.from(again.image.samples)).toEqual(Array.from(shaken.image.samples));
    expect(Array.from((await simulateCapture(request({ handheld: { seed: 10 } }))).image.samples)).not.toEqual(Array.from(shaken.image.samples));
    const assumption = shaken.assumptions.find((a) => a.id === "motion.handheld")!;
    expect(assumption.value).toMatchObject({ seed: 9, stabilizationStops: 0, modelVersion: "1.0.0" });
    const stabilized = await simulateCapture(request({ handheld: { seed: 9, stabilizationStops: 2 } }));
    const base = lineSpreadVariance(still);
    const spread0 = Math.sqrt(lineSpreadVariance(shaken) - base), spread2 = Math.sqrt(Math.max(0, lineSpreadVariance(stabilized) - base));
    const predicted0 = Math.sqrt(predictedVariance(0)), predicted2 = Math.sqrt(predictedVariance(2));
    // The prediction is exact for the midpoint quadrature; the measured spread carries the demosaic and the sampling of the shifts on the sites.
    expect(predicted0).toBeGreaterThan(3);
    expect(Math.abs(spread0 / predicted0 - 1)).toBeLessThan(0.1);
    expect(predicted2 / predicted0).toBeCloseTo(0.25, 3);
    expect(Math.abs(spread2 / spread0 - 0.25)).toBeLessThan(0.06);
  }, scaledTimeout(120_000));

  it("keeps a long handheld exposure bounded, unlike the constant rotation", async () => {
    const options = { scene: { preset: "siemens-star" }, output: { width: 16, height: 12 }, exposure: { mode: "manual", shutterSeconds: 30, iso: 100 }, illuminanceLux: 0.5,
      sensor: { temporalSampleCount: 4 } } as SimulateCaptureOptions;
    const r = await simulateCapture({ ...options, motion: { handheld: { seed: 1 } } });
    const value = r.assumptions.find((a) => a.id === "motion.handheld")!.value as { rmsDisplacementDegreesOverExposure: number; boundDegrees: { pitch: number; yaw: number } };
    expect(value.rmsDisplacementDegreesOverExposure).toBeLessThan(1.6);
    expect(Math.max(value.boundDegrees.pitch, value.boundDegrees.yaw)).toBeLessThan(3);
  }, scaledTimeout(60_000));
});
