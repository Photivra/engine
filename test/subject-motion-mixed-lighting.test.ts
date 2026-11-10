// SPDX-License-Identifier: Apache-2.0
/**
 * Owner decision (2026-11-09, 2.22.0): `motion.subject` (#551) with `illumination` (#550). The revealed 18 % background takes the
 * plane's irradiance at each point: the blend and the point sources, integrated from the spectrum at use. Checked on the RAW
 * against a still 18 % scene under the same lighting, in the display view, and through the exposure build-up (#534).
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, simulateExposureBuildUp, type MixedIllumination, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const DAY = { kind: "planckian" as const, temperatureKelvin: 6500 }, LAMP = { kind: "cie-a" as const };
const GRADIENT: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 30000 }, { illuminant: LAMP, illuminanceLux: 3000 }],
  blend: { kind: "linear-gradient", from: { u: -0.9, v: 0 }, to: { u: -0.1, v: 0 } } };
/** A lamp low over the left edge of the revealed rectangle (h: half the framed width): a strong inverse-square falloff across it. */
const POINT = (h: number): MixedIllumination => ({ points: [{ illuminant: { kind: "planckian", temperatureKelvin: 3200 }, position: { xM: -0.8 * h, yM: 0, heightM: 0.2 * h },
  intensity: { illuminanceLux: 8000, distanceM: 0.2 * h } }] });
const W = 64, H = 16, T = 1 / 30;
/** The subject: a bright rectangle over the frame's left part that leaves it within about 0.1 % of the exposure. */
async function subjectRequest(lighting: MixedIllumination | ((h: number) => MixedIllumination), extra: Partial<SimulateCaptureOptions> = {}): Promise<{ moving: SimulateCaptureOptions; still: SimulateCaptureOptions }> {
  const probe: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.9 }, illumination: GRADIENT, exposure: { mode: "manual", shutterSeconds: T, iso: 100 },
    sensor: { spectralStepNanometers: 20, noiseSeed: 5 }, output: { width: W, height: H, format: "srgb-16", whiteBalance: { kelvin: 5000 } }, fast: false, ...extra };
  // The framed width follows the output width (width × pitch), so the probe has the request's own size.
  const framed = (await simulateCapture({ ...probe, sensor: { ...probe.sensor, spectralStepNanometers: 100 } })).scene.framedWidthM, h = framed / 2;
  const base: SimulateCaptureOptions = { ...probe, illumination: typeof lighting === "function" ? lighting(h) : lighting };
  return { moving: { ...base, motion: { subject: { velocityMPerSec: { x: 1e5 * h }, region: { centerXM: -h / 2, centerYM: 0, widthM: h / 2, heightM: 4 * h } } } },
    still: { ...base, scene: { preset: "uniform", reflectance: 0.18 } } };
}
/** Black-subtracted mean code of one CFA phase over native columns [x0, x1). */
function columnMeans(r: SimulateCaptureResult, x0: number, x1: number, phase: 0 | 1 | 2 | 3): number[] {
  const width = W + 2, rows = r.raw.codes.length / width, out: number[] = [];
  for (let x = x0; x < x1; x++) {
    if ((x & 1) !== (phase & 1)) continue;
    let sum = 0, n = 0;
    for (let y = phase >> 1; y < rows; y += 2) { sum += r.raw.codes[y * width + x]! - r.raw.blackLevels[y * width + x]!; n++; }
    out.push(sum / n);
  }
  return out;
}

describe("a moving subject under mixed lighting (#550 with #551)", () => {
  for (const [name, illumination] of [["a gradient blend", GRADIENT], ["a point source", POINT]] as const) {
    it("reveals an 18 % background lit by " + name + " at each point", async () => {
      const { moving, still } = await subjectRequest(illumination);
      const a = await simulateCapture(moving), b = await simulateCapture(still);
      // The rest rectangle spans u in [-0.75, -0.25]: output columns 8 … 24, native 9 … 25; columns 12 … 23 keep a margin.
      for (const phase of [0, 1, 2, 3] as const) {
        const m = columnMeans(a, 12, 24, phase), s = columnMeans(b, 12, 24, phase);
        for (let i = 0; i < m.length; i++) {
          expect(s[i]!, name + " phase " + phase).toBeGreaterThan(30);
          // Shot noise of a mean over 8 sites, plus the subject's 0.1 % of the exposure (at 5× the reflectance).
          expect(Math.abs(m[i]! / s[i]! - 1), name + " phase " + phase + " column " + i).toBeLessThan(0.01 + 4 / Math.sqrt(8 * s[i]!));
        }
        // The lighting varies across the rectangle (so a single-illuminant background would not match).
        expect(Math.max(...s) / Math.min(...s), name).toBeGreaterThan(1.1);
      }
    }, scaledTimeout(60_000));
  }

  it("matches in the display view (sideways motion, global shutter)", async () => {
    const { moving, still } = await subjectRequest(GRADIENT, { sensor: { spectralStepNanometers: 20, noiseSeed: 5, temporalSampleCount: 16 } });
    const a = await simulateDisplayView(moving, { width: W, height: H }), b = await simulateDisplayView(still, { width: W, height: H });
    for (let x = 13; x < 25; x++) for (let c = 0; c < 3; c++) {
      const i = (8 * W + x) * 3 + c;
      expect(Math.abs(a.image.samples[i]! - b.image.samples[i]!), "column " + x + " channel " + c).toBeLessThanOrEqual(0.01 * 65535);
    }
    // As for any moving subject, the view refuses a rolling shutter and a subject rotation.
    await expect(simulateDisplayView({ ...moving, motion: { ...moving.motion!, shutter: "rolling" } }, { width: 8, height: 4 })).rejects.toThrow(/rolling/u);
    await expect(simulateDisplayView({ ...moving, motion: { subject: { angularVelocityRadPerSec: 1 } } }, { width: 8, height: 4 })).rejects.toThrow(/sideways/u);
  }, scaledTimeout(60_000));

  it("builds up with both (#534): the whole exposure byte for byte, counts that never decrease", async () => {
    const { moving } = await subjectRequest(POINT, { output: { width: 32, height: 16 }, sensor: { spectralStepNanometers: 50, noiseSeed: 5, temporalSampleCount: 8,
      readNoise: { lowGainElectrons: 0, highGainElectrons: 0 } } });
    const options = { ...moving, motion: { subject: { velocityMPerSec: { x: 30 }, region: (moving.motion!.subject as { region: NonNullable<unknown> }).region } } } as SimulateCaptureOptions;
    const build = await simulateExposureBuildUp(options, { fractions: [0.3, 0.6, 1] }), ordinary = await simulateCapture(options);
    expect(build.frames[2]!.result.raw.codes).toEqual(ordinary.raw.codes);
    expect(build.frames[2]!.result.image.samples).toEqual(ordinary.image.samples);
    const codes = build.frames.map((f) => f.result.raw.codes);
    for (let i = 0; i < codes[0]!.length; i++) { expect(codes[0]![i]!).toBeLessThanOrEqual(codes[1]![i]!); expect(codes[1]![i]!).toBeLessThanOrEqual(codes[2]![i]!); }
  }, scaledTimeout(60_000));
});
