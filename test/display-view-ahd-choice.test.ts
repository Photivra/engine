// SPDX-License-Identifier: Apache-2.0
/**
 * #457: where the scene decides AHD's choice between its two candidates (structure finer than a few sites), the display view's
 * expected value takes the candidate AHD chooses on the noise-free mosaic instead of the candidates' average.
 *
 * 1. The direction the view computes (`createAhdDirectionPlane`) is the engine's AHD task's own direction map
 *    (`createAhdDemosaicTask`, after Hirakawa & Parks 2005), borders included.
 * 2. The case that found the miss (validation set F, #454): the 24 MP 6 µm full frame shown 2028 wide (2.96 real pixels per
 *    display pixel, the exact area mean), a 32 × 32 block at the 36-cycle Siemens star's centre, f/8, ISO 100, against seven
 *    reference captures area-averaged in linear light (the method of scripts/validate-display-view.mjs). Before this change:
 *    Quality 5.13 codes RMS (limit 2), AHD alone 19.3 codes RMS against the seven-reference mean, where one reference is 3.08
 *    from that mean.
 */
import { describe, expect, it } from "vitest";
import { createAhdDemosaicTask, NATIVE_RAW_LIMITS, simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { createAhdDirectionPlane } from "../src/facade/display-view.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { bayerProfile, ROLES, runTask } from "./helpers/processing-fixture.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** A white-balanced camera → XYZ matrix (sRGB's rows times the gains 2, 1, 1.6), as the homogeneity metric sees it. */
const LAB = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]].map((row) => row.map((v, c) => v * [2, 1, 1.6][c]!));

describe("display view: AHD's choice on the noise-free mosaic (#457)", () => {
  it("is the AHD task's own direction at every pixel, borders included", async () => {
    const W = 64, H = 48;
    let seed = 7;
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const mosaics: [string, (x: number, y: number) => number][] = [
      ["random", (): number => 0.8 * random()],
      ["star", (x, y): number => (Math.sin(18 * Math.atan2(y - H / 2 + 0.3, x - W / 2 + 0.7)) > 0 ? 0.6 : 0.05) * [1, 0.9, 0.9, 0.7][(y & 1) * 2 + (x & 1)]!]
    ];
    for (const [name, value] of mosaics) {
      const samples = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) samples[y * W + x] = value(x, y);
      const task = await runTask((p) => createAhdDemosaicTask({ plane: { width: W, height: H, captureModeId: "native", colorSamplingProfile: bayerProfile(), samples },
        channelRoles: ROLES, cameraToXyz: LAB as never }, p));
      const plane = createAhdDirectionPlane(LAB, W, H, W, 64, (x, y) => samples[y * W + x]!);
      plane.origin(0);
      const counts = [0, 0, 0];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const direction = plane.direction(x, y);
        counts[direction]!++;
        expect(direction, `${name} (${x}, ${y})`).toBe(task.direction[y * W + x]);
      }
      // Both directions are taken on each mosaic, so the comparison exercises the choice.
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[1]).toBeGreaterThan(0);
    }
  });

  const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
  const code8 = (l: number): number => { const v = Math.min(1, Math.max(0, l)); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); };
  const rms = (a: Float64Array, b: Float64Array): number => { let sq = 0; for (let i = 0; i < a.length; i++) sq += (code8(a[i]!) - code8(b[i]!)) ** 2; return Math.sqrt(sq / a.length); };
  const options = (quality: boolean): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" },
    lens: { prime: 50, fNumber: 8, ...(quality ? { diffraction: "circular-aperture" as const } : {}) }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 }, subjectDistanceM: 5,
    sensor: { pixelPitchMicrometers: 6, ...(quality ? { antiAliasing: { kind: "four-spot" as const } } : {}) },
    output: { width: 6000, height: 4000, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels, demosaic: "ahd" } });
  /** The view's expected values on the block and the block of each of seven reference captures, area-averaged in linear light. */
  async function starCentre(quality: boolean): Promise<{ expected: Float64Array; references: Float64Array[]; estimation: string }> {
    const o = options(quality), vw = 2028, vh = 1352, sx = 6000 / vw, sy = 4000 / vh, b = { x: 998, y: 660, width: 32, height: 32 }, n = b.width * b.height;
    const { internals } = await simulateDisplayViewWithInternals(o, { width: vw, height: vh, region: b, format: "srgb-16" });
    const rx0 = Math.floor(b.x * sx), ry0 = Math.floor(b.y * sy), rw = Math.ceil((b.x + b.width) * sx) - rx0, rh = Math.ceil((b.y + b.height) * sy) - ry0, references: Float64Array[] = [];
    for (let seed = 1; seed <= 7; seed++) {
      const capture = await simulateCapture({ ...o, sensor: { ...o.sensor, noiseSeed: seed }, output: { ...o.output, format: "srgb-16", region: { x: rx0, y: ry0, width: rw, height: rh } } });
      const block = new Float64Array(3 * n);
      for (let j = 0; j < b.height; j++) for (let i = 0; i < b.width; i++) {
        const X0 = (b.x + i) * sx, X1 = X0 + sx, Y0 = (b.y + j) * sy, Y1 = Y0 + sy;
        for (let y = Math.floor(Y0); y < Math.ceil(Y1); y++) for (let x = Math.floor(X0); x < Math.ceil(X1); x++) {
          const w = (Math.min(Y1, y + 1) - Math.max(Y0, y)) * (Math.min(X1, x + 1) - Math.max(X0, x)) / (sx * sy);
          for (let k = 0; k < 3; k++) block[3 * (j * b.width + i) + k]! += w * decode(capture.image.samples[3 * ((y - ry0) * rw + x - rx0) + k]!);
        }
      }
      references.push(block);
    }
    return { expected: internals.expected, references, estimation: internals.estimation };
  }

  it("Quality at the star's centre, 2028 wide on the 24 MP frame: within the 2-code expected-value limit (5.13 before)", async () => {
    const { expected, references, estimation } = await starCentre(true);
    expect(estimation).toBe("exact-area-mean");
    // The validation metric: the mean over the seven references of the RMS against each (measured 0.78 codes).
    const metric = references.reduce((sum, r) => sum + rms(expected, r), 0) / references.length;
    expect(metric).toBeLessThanOrEqual(2);
  }, testTimeout(300_000));

  it("AHD alone at the star's centre: as close to the seven-reference mean as one reference is (19.3 codes before)", async () => {
    const { expected, references } = await starCentre(false);
    const mean = new Float64Array(expected.length);
    for (const r of references) for (let i = 0; i < mean.length; i++) mean[i]! += r[i]! / references.length;
    const spread = references.reduce((sum, r) => sum + rms(r, mean), 0) / references.length;
    // Measured: 2.84 codes against one reference's 3.08.
    expect(rms(expected, mean)).toBeLessThanOrEqual(spread);
  }, testTimeout(300_000));
});
