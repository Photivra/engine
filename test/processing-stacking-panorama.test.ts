// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createFocusStackTask, createPanoramaTask, InvalidConfigurationError, InvalidScientificInputError, type PanoramaFrame } from "../src/index.js";
import { applyPhysicalCameraRotation } from "../src/motion/camera-rotation.js";
import { convolveSeparable, gaussianKernel } from "../src/processing/image-ops.js";
import { mulberry32, psnr, rgbImage, runTask } from "./helpers/processing-fixture.js";

function drain(g: Generator<void, void, void>): void { while (g.next().done !== true) { /* drain */ } }

describe("focus stacking", () => {
  it("selects the sharp slice of a synthetic depth stack and beats every input frame", async () => {
    const W = 60, H = 24, random = mulberry32(11), noise = Float32Array.from({ length: W * H * 3 }, () => random());
    const sharp = { width: W, height: H, data: new Float32Array(noise.length) };
    drain(convolveSeparable(noise, W, H, 3, gaussianKernel(0.6), new Float32Array(noise.length), sharp.data));
    const blurred = new Float32Array(noise.length);
    drain(convolveSeparable(sharp.data, W, H, 3, gaussianKernel(2.5), new Float32Array(noise.length), blurred));
    const band = (x: number): number => Math.floor(x / 20);
    const frames = [0, 1, 2].map((k) => rgbImage(W, H, (x, y, c) => (band(x) === k ? sharp.data : blurred)[3 * (y * W + x) + c]!));
    const out = await runTask((p) => createFocusStackTask({ frames }, p));
    for (let y = 3; y < H - 3; y++) for (let x = 0; x < W; x++) if (x % 20 > 3 && x % 20 < 16) expect(out.selectedFrameIndex[y * W + x]).toBe(band(x));
    const quality = psnr(out.data, sharp.data);
    for (const f of frames) expect(quality).toBeGreaterThan(psnr(f.data, sharp.data) + 6);
    const single = await runTask((p) => createFocusStackTask({ frames: [frames[1]!] }, p));
    for (let i = 0; i < single.data.length; i++) expect(single.data[i]).toBeCloseTo(frames[1]!.data[i]!, 5);
    expect(() => createFocusStackTask({ frames: [] }, { yieldControl: async () => {} })).toThrow(InvalidConfigurationError);
  });
});

/** Analytic scene radiance as a function of reference-frame longitude θ and latitude φ. */
const scene = (theta: number, phi: number, c: number): number => 0.5 + 0.2 * Math.sin(6 * theta + c) * Math.cos(4 * phi) + 0.05 * c;
function renderFrame(yaw: number, pitch: number, exposure: number, W = 48, H = 36, f = 40): PanoramaFrame {
  const rotationRad = { pitch, yaw, roll: 0 };
  const image = rgbImage(W, H, (x, y, c) => {
    const d = applyPhysicalCameraRotation({ x: (x + 0.5 - W / 2) / f, y: -(y + 0.5 - H / 2) / f, z: 1 }, rotationRad, "camera-to-reference");
    return exposure * scene(Math.atan2(d.x, d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)), c);
  });
  return { image, focalLengthPixels: f, rotationRad };
}
const canvas = { projection: "equirectangular" as const, width: 120, height: 40, longitudeRangeRad: [-1, 1] as const, latitudeRangeRad: [-0.33, 0.33] as const };
const truth = (u: number, v: number, c: number): number => scene(-1 + (u + 0.5) / 120 * 2, 0.33 - (v + 0.5) / 40 * 0.66, c);

describe("panorama from known rotations", () => {
  it("places positive-yaw content left (engine sign convention) and reprojects with bilinear accuracy", async () => {
    const one = await runTask((p) => createPanoramaTask({ frames: [renderFrame(0.6, 0, 1)], canvas, exposureCompensation: "none" }, p));
    const centre = Math.round((-0.6 + 1) / 2 * 120 - 0.5);
    expect(one.coverage[20 * 120 + centre]).toBe(1); expect(one.coverage[20 * 120 + 119]).toBe(0);
    for (const blending of ["feather", "multi-band"] as const) {
      const frames = [renderFrame(-0.6, 0, 1), renderFrame(0, 0.05, 1), renderFrame(0.6, -0.05, 1)];
      const out = await runTask((p) => createPanoramaTask({ frames, canvas, blending, exposureCompensation: "none" }, p));
      let worst = 0, covered = 0;
      // Multi-band blur reaches zero-filled pixels near the panorama's outer coverage edge; check pixels 6 px inside it.
      const margin = blending === "feather" ? 0 : 6, inside = (u: number, v: number): boolean => {
        for (let dv = -margin; dv <= margin; dv++) for (let du = -margin; du <= margin; du++) if (!(out.coverage[(v + dv) * 120 + u + du]! > 0)) return false;
        return true; };
      for (let v = 8; v < 32; v++) for (let u = 8; u < 112; u++) if (inside(u, v)) {
        covered++;
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out.data[3 * (v * 120 + u) + c]! - truth(u, v, c)));
      }
      expect(covered).toBeGreaterThan(0.8 * 104 * 24);
      expect(worst).toBeLessThan(blending === "feather" ? 0.01 : 0.005);
      expect(out.gains).toEqual([1, 1, 1]);
    }
  });

  it("recovers relative exposure with Brown–Lowe gain compensation", async () => {
    const exposures = [1, 1.25, 0.8], frames = [renderFrame(-0.6, 0, exposures[0]!), renderFrame(0, 0, exposures[1]!), renderFrame(0.6, 0, exposures[2]!)];
    const out = await runTask((p) => createPanoramaTask({ frames, canvas, gainPriorSigma: 1000 }, p));
    expect(out.gains[1]! / out.gains[0]!).toBeCloseTo(0.8, 2); expect(out.gains[2]! / out.gains[0]!).toBeCloseTo(1.25, 2);
    const ratios: number[] = [];
    for (let v = 4; v < 36; v++) for (let u = 4; u < 116; u++) if (out.coverage[v * 120 + u]! > 0) ratios.push(out.data[3 * (v * 120 + u) + 1]! / truth(u, v, 1));
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length, spread = Math.max(...ratios.map((r) => Math.abs(r / mean - 1)));
    expect(spread).toBeLessThan(0.02);
    // With the default σ_g = 0.1 prior the gains are pulled toward 1 but keep their order.
    const prior = await runTask((p) => createPanoramaTask({ frames, canvas }, p));
    expect(prior.gains[1]!).toBeLessThan(prior.gains[0]!); expect(prior.gains[2]!).toBeGreaterThan(prior.gains[0]!);
    expect(() => createPanoramaTask({ frames, canvas: { ...canvas, longitudeRangeRad: [1, -1] } }, { yieldControl: async () => {} })).toThrow(InvalidScientificInputError);
    expect(() => createPanoramaTask({ frames, canvas: { ...canvas, projection: "fisheye" as "cylindrical" } }, { yieldControl: async () => {} })).toThrow(InvalidConfigurationError);
  });

  it("completes a single frame with the default gain compensation, equal to compensation off (#671)", async () => {
    const small = { projection: "equirectangular" as const, width: 16, height: 8, longitudeRangeRad: [-1, 1] as const, latitudeRangeRad: [-0.33, 0.33] as const };
    for (const blending of ["feather", "multi-band"] as const) for (const c of [small, canvas]) {
      const frames = [renderFrame(0, 0, 1)];
      const out = await runTask((p) => createPanoramaTask({ frames, canvas: c, blending }, p));
      const off = await runTask((p) => createPanoramaTask({ frames, canvas: c, blending, exposureCompensation: "none" }, p));
      expect(out.gains).toEqual([1]);
      expect(out.coverage[(c.height >> 1) * c.width + (c.width >> 1)]).toBe(1);
      expect(Array.from(out.coverage)).toEqual(Array.from(off.coverage));
      expect(Array.from(out.data)).toEqual(Array.from(off.data));
    }
    const tiny = { width: 8, height: 6, data: new Float32Array(8 * 6 * 3).fill(0.5) };
    await runTask((p) => createPanoramaTask({ frames: [{ image: tiny, focalLengthPixels: 8, rotationRad: { pitch: 0, yaw: 0, roll: 0 } }], canvas: small }, p));
  });

  it("stitches onto a cylindrical canvas", async () => {
    const frames = [renderFrame(-0.4, 0, 1), renderFrame(0.4, 0, 1)];
    const cyl = { projection: "cylindrical" as const, width: 80, height: 30, longitudeRangeRad: [-0.8, 0.8] as const, latitudeRangeRad: [-0.3, 0.3] as const };
    const out = await runTask((p) => createPanoramaTask({ frames, canvas: cyl, exposureCompensation: "none" }, p));
    let worst = 0;
    for (let v = 2; v < 28; v++) for (let u = 2; u < 78; u++) if (out.coverage[v * 80 + u]! > 0) {
      const theta = -0.8 + (u + 0.5) / 80 * 1.6, h = Math.tan(0.3) - (v + 0.5) / 30 * 2 * Math.tan(0.3);
      worst = Math.max(worst, Math.abs(out.data[3 * (v * 80 + u)]! - scene(theta, Math.atan(h), 0)));
    }
    expect(worst).toBeLessThan(0.01);
  });
});
