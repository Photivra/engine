// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createZonedGather, gatherInterior, kernelTaps } from "../src/facade/diffraction-provider.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { compareDisplayViews, displayViewGpuFixture, renderOnGpuQuality, runtimeOf } from "./helpers/display-view-gpu-fixture.js";

/*
 * #553: lens.defocus with bokeh options in the capture and the display view: visible on the point grid out of focus, the
 * cat's eye by field zone, front against back, and byte-identical requests without the options.
 */

const W = 240, H = 144;
/** A point grid of 5 × 3 small bright disks on a dark ground, 6 µm sites, 50 mm f/4, subject 2 m. */
const pointGrid = (focusDistanceM: number, defocus: Record<string, unknown>): SimulateCaptureOptions => ({
  scene: { preset: "point-grid", radius: 0.015, backgroundReflectance: 0.02 } as SimulateCaptureOptions["scene"], subjectDistanceM: 2,
  lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM, defocus: { model: "geometric-disc", ...defocus } as never },
  sensor: { pixelPitchMicrometers: 6 }, output: { width: W, height: H } });
const bokehOf = (r: SimulateCaptureResult): Record<string, unknown> => (r.assumptions.find((a) => a.id === "lens.defocus")!.value as { bokeh: Record<string, unknown> }).bokeh;

/** Green samples of the output image (sRGB code values). */
const green = (r: { image: { samples: ArrayLike<number> } }, width: number, x: number, y: number): number => r.image.samples[(y * width + x) * 3 + 1]!;

/** A blob around (cx, cy): weights above the background, their centroid and second moments, and the radial extent per direction. */
function blob(r: SimulateCaptureResult, cx: number, cy: number, half: number): { xx: number; yy: number; cx: number; extents: number[] } {
  let background = 0, n = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) === half) { background += green(r, W, x, y); n++; }
  background /= n;
  let peak = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) peak = Math.max(peak, green(r, W, x, y));
  const level = background + 0.4 * (peak - background);
  let sw = 0, sx = 0, sy = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
    const w = Math.max(0, green(r, W, x, y) - level);
    sw += w; sx += w * x; sy += w * y;
  }
  const mx = sx / sw, my = sy / sw;
  let xx = 0, yy = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
    const w = Math.max(0, green(r, W, x, y) - level);
    xx += w * (x - mx) ** 2; yy += w * (y - my) ** 2;
  }
  // Radial extent of the thresholded blob in 36 directions (sub-pixel steps from the centroid).
  const extents: number[] = [];
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * 2 * Math.PI;
    let t = 0;
    while (t < half && green(r, W, Math.round(mx + t * Math.cos(a)), Math.round(my + t * Math.sin(a))) > level) t += 0.25;
    extents.push(t);
  }
  return { xx: xx / sw, yy: yy / sw, cx: mx - cx, extents };
}

describe("lens.defocus bokeh character in the capture (#553)", () => {
  it("is visible on the point grid out of focus: a pentagon instead of a disc, labelled, from the shaped kernel", async () => {
    // Subject 2 m, focus 1.4 m: a 23-site blur behind the focus plane.
    const round = await simulateCapture(pointGrid(1.4, {}));
    const bladed = await simulateCapture(pointGrid(1.4, { blades: { count: 5 } }));
    const bokeh = bokehOf(bladed);
    expect(bokeh).toMatchObject({ side: "behind-focus", method: "exact-polygon-cell-area", axisOpenAreaRatio: 1 });
    expect(bladed.assumptions.find((a) => a.id === "lens.defocus")!.explanation).toMatch(/shaped by the lens instead \(#553/u);
    expect(bladed.assumptions.find((a) => a.id === "raw.expectedSignal")!.value).toMatchObject({ method: "tabulated-expected-electrons" });
    // The centre point (cell 2 of 5, row 1 of 3): the disc's blob is round, the pentagon's has five corners.
    const spread = (e: number[]): number => Math.max(...e) / Math.min(...e);
    const a = blob(round, 120, 72, 23), b = blob(bladed, 120, 72, 23);
    expect(spread(a.extents)).toBeLessThan(1.1);
    expect(spread(b.extents)).toBeGreaterThan(1.15);
    // Five-fold: the extent is largest near the five vertex directions, so its autocorrelation at a 72° lag beats the one at 36°.
    const corr = (e: number[], lag: number): number => { const m = e.reduce((s, v) => s + v, 0) / e.length; return e.reduce((s, v, i) => s + (v - m) * (e[(i + lag) % e.length]! - m), 0); };
    expect(corr(b.extents, 7)).toBeGreaterThan(0);
    expect(corr(b.extents, 4)).toBeLessThan(0);
  }, scaledTimeout(60_000));

  it("differs in front of and behind the focus plane with spherical aberration: soft-edged behind, bright-rimmed in front", async () => {
    const sa = { sphericalAberration: { w040Micrometers: 0.5, atFNumber: 4 } };
    const rimOverCentre = (r: SimulateCaptureResult, edge: number): number => {
      let rim = 0, nr = 0, centre = 0, nc = 0;
      for (let y = 72 - 22; y <= 72 + 22; y++) for (let x = 120 - 22; x <= 120 + 22; x++) {
        const d = Math.hypot(x - 120, y - 72) / edge;
        if (d < 0.3) { centre += green(r, W, x, y); nc++; } else if (d > 0.7 && d < 0.85) { rim += green(r, W, x, y); nr++; }
      }
      return (rim / nr) / (centre / nc);
    };
    const behind = await simulateCapture(pointGrid(1.4, sa)), front = await simulateCapture(pointGrid(3.5, sa));
    expect(bokehOf(behind)).toMatchObject({ side: "behind-focus", method: "pupil-ray-binning" });
    expect(bokehOf(front)).toMatchObject({ side: "in-front-of-focus", method: "pupil-ray-binning" });
    // b = 8·N·W040/pitch = 2.67 sites; behind: edge c/2 + b, in front: |−c/2 + b|.
    expect(bokehOf(behind).sphericalAberrationSites).toBeCloseTo(8 * 4 * 0.5 / 6, 12);
    const cBehind = (behind.assumptions.find((a) => a.id === "lens.defocus")!.value as { diameterSites: number }).diameterSites;
    const cFront = (front.assumptions.find((a) => a.id === "lens.defocus")!.value as { diameterSites: number }).diameterSites;
    expect(rimOverCentre(behind, cBehind / 2 + 8 * 4 * 0.5 / 6)).toBeLessThan(0.97);
    expect(rimOverCentre(front, cFront / 2 - 8 * 4 * 0.5 / 6)).toBeGreaterThan(1.03);
  }, scaledTimeout(60_000));

  it("clips the blur into a cat's eye toward the frame's corners, by field zone, and keeps the axis whole", async () => {
    // A 1.44 mm frame sees little field, so the clipping aperture shifts 400 mm per tan θ (about 4.5 mm at the left and right points; the pupil of f/4 has a radius of 6.25 mm).
    const catsEye = { catsEye: { apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 400 }], fieldZonesAcrossLongSide: 10 } };
    const clipped = await simulateCapture(pointGrid(1.4, catsEye)), round = await simulateCapture(pointGrid(1.4, {}));
    const bokeh = bokehOf(clipped) as { catsEye: { columns: number; rows: number; minimumOpenAreaRatio: number; largestAdjacentOpenAreaRatioChange: number; lightLossApplied: boolean } };
    expect(bokeh.catsEye).toMatchObject({ columns: 10, lightLossApplied: false });
    expect(bokeh.catsEye.minimumOpenAreaRatio).toBeLessThan(0.8);
    expect(bokeh.catsEye.largestAdjacentOpenAreaRatioChange).toBeGreaterThan(0);
    // The cat's eye skips the tabulated path (one kernel per node there).
    expect((clipped.assumptions.find((a) => a.id === "raw.expectedSignal")?.value as { method?: string } | undefined)?.method).not.toBe("tabulated-expected-electrons");
    // The left-middle point (cell 0, row 1) lies along −X: its blob is narrower along X than along Y; the centre point stays round.
    const left = blob(clipped, 24, 72, 23), centre = blob(clipped, 120, 72, 23), roundLeft = blob(round, 24, 72, 23);
    expect(left.xx / left.yy).toBeLessThan(0.8);
    expect(Math.abs(centre.xx / centre.yy - 1)).toBeLessThan(0.1);
    expect(Math.abs(roundLeft.xx / roundLeft.yy - 1)).toBeLessThan(0.1);
    // Behind the focus plane the light kept is on the field point's side (toward −X here).
    expect(left.cx).toBeLessThan(-0.5);
  }, scaledTimeout(120_000));

  it("renders the cat's eye in image space with vignetting, and region renders equal the whole frame", async () => {
    const options: SimulateCaptureOptions = { ...pointGrid(1.4, { catsEye: { apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 400 }], fieldZonesAcrossLongSide: 6 } }),
      output: { width: 96, height: 64 } };
    const whole = await simulateCapture(options);
    const region = { x: 30, y: 20, width: 24, height: 18 };
    const part = await simulateCapture({ ...options, output: { ...options.output!, region } });
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++)
      expect(part.image.samples[y * region.width * 3 + x]).toBe(whole.image.samples[((region.y + y) * 96 + region.x) * 3 + x]);
    const vignetted = await simulateCapture({ ...options, lens: { ...options.lens!, vignetting: { normalizationRadiusMm: 0.6, maximumNormalizedRadius: 1, coefficients: { r2: -0.2, r4: 0, r6: 0 } } } });
    expect((vignetted.assumptions.find((a) => a.id === "lens.defocus")!.value as { execution: string }).execution).toBe("image-space-convolution");
    expect(bokehOf(vignetted)).toHaveProperty("catsEye");
  }, scaledTimeout(120_000));

  it("keeps requests byte-identical: without bokeh options, and in focus with them", async () => {
    const base = pointGrid(1.4, {}), undefinedOptions = pointGrid(1.4, { blades: undefined, sphericalAberration: undefined, catsEye: undefined });
    const a = await simulateCapture(base), b = await simulateCapture(undefinedOptions);
    expect(Array.from(b.raw.codes)).toEqual(Array.from(a.raw.codes));
    expect(b.assumptions).toEqual(a.assumptions);
    expect(bokehOf(a)).toBeUndefined();
    const inFocus = await simulateCapture(pointGrid(2, {})), inFocusBladed = await simulateCapture(pointGrid(2, { blades: { count: 6 }, sphericalAberration: { w040Micrometers: 1, atFNumber: 4 } }));
    expect(Array.from(inFocusBladed.raw.codes)).toEqual(Array.from(inFocus.raw.codes));
    expect(bokehOf(inFocusBladed)).toEqual({ options: { blades: { count: 6, firstBladeEdgeAngleDegrees: 0, curvature: 0, circularAtOrBelowFNumber: null },
      sphericalAberration: { w040Micrometers: 1, atFNumber: 4 } } });
  }, scaledTimeout(60_000));

  it("validates the options and refuses unsupported combinations by name", async () => {
    await expect(simulateCapture(pointGrid(1.4, { blades: { count: 40 } }))).rejects.toThrow(/lens\.defocus\.blades\.count/u);
    await expect(simulateCapture(pointGrid(1.4, { onionRings: true }))).rejects.toThrow(/Unknown lens\.defocus field: onionRings/u);
    const catsEye = { catsEye: { apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 400 }] } };
    await expect(simulateCapture({ ...pointGrid(1.4, catsEye), lens: { ...pointGrid(1.4, catsEye).lens!, diffraction: "circular-aperture" } }))
      .rejects.toThrow(/catsEye cannot be combined with lens\.diffraction/u);
    await expect(simulateDisplayView(pointGrid(1.4, catsEye), { width: 60, height: 36 })).rejects.toThrow(/simulateDisplayView does not support lens\.defocus\.catsEye/u);
    await expect(simulateCapture(pointGrid(1.4, { catsEye: { apertures: [{ radiusMm: 1, shiftPerTanFieldMm: 4000 }] } }))).rejects.toThrow(/close the pupil/u);
    await expect(simulateCapture(pointGrid(1.4, { sphericalAberration: { w040Micrometers: 40, atFNumber: 4 } }))).rejects.toThrow(/limit is 64 sites/u);
  }, scaledTimeout(60_000));
});

describe("lens.defocus bokeh in the display view (#553)", () => {
  it("renders the shaped kernel (blades, spherical aberration) and labels it", async () => {
    const view = { width: 120, height: 72 };
    const round = await simulateDisplayView(pointGrid(1.4, {}), view), bladed = await simulateDisplayView(pointGrid(1.4, { blades: { count: 5 } }), view);
    expect(bladed.assumptions.find((a) => a.id === "view.defocus")!.value).toMatchObject({ kernel: "shaped-kernel" });
    expect(Array.from(bladed.image.samples)).not.toEqual(Array.from(round.image.samples));
  }, scaledTimeout(60_000));
});

describe("lens.defocus bokeh in the GPU display view (float32 emulation, no src/gpu change) (#553)", () => {
  it("gathers a shaped, asymmetric kernel (5 blades with spherical aberration) within the a-priori bounds of the CPU reference", async () => {
    const options = pointGrid(1.4, { blades: { count: 5 }, sphericalAberration: { w040Micrometers: 0.5, atFNumber: 4 } });
    const fixture = await displayViewGpuFixture(options, { width: 120, height: 72, region: { x: 52, y: 28, width: 16, height: 16 } }), runtime = await runtimeOf(createFakeGpu().gpu);
    try {
      expect(fixture.input.setup.gpu?.defocusRadius).toBeGreaterThan(0);
      const gpu = await renderOnGpuQuality(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
      expect(gpu.blockedSum).toBe(true);
      expect(a.outsideExpectedBound).toBe(0);
      expect(a.outsideVarianceBound).toBe(0);
      expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    } finally { runtime.destroy(); }
  }, scaledTimeout(300_000));
});

describe("zoned gather (#553)", () => {
  const R = 2, width = 2 * R + 1, nativeWidth = 9, nativeHeight = 6, gridWidth = nativeWidth + 2 * R, rows = nativeHeight;
  const samples = Float64Array.from({ length: gridWidth * (rows + 2 * R) }, (_, k) => ((k * 7919) % 101) / 100);
  const kernelA = Float64Array.from({ length: width * width }, (_, k) => (k % 3 + 1) / 50);
  const kernelB = Float64Array.from({ length: width * width }, (_, k) => (k === 12 ? 0.5 : k % 4 === 0 ? 0.08 : 0));
  it("gives gatherInterior's bits when every zone holds one kernel", () => {
    const zoned = createZonedGather({ size: 3, columns: 3, rows: 2, kernelOf: () => kernelA }, R, gridWidth, nativeWidth, nativeHeight, 0);
    expect(Array.from(zoned(samples, 0, 0, nativeWidth, rows))).toEqual(Array.from(gatherInterior(samples, kernelTaps(kernelA, R, gridWidth), gridWidth, nativeWidth, rows, R)));
  });
  it("sums each output site with its own zone's kernel", () => {
    const zoned = createZonedGather({ size: 3, columns: 3, rows: 2, kernelOf: (z) => (z % 2 === 0 ? kernelA : kernelB) }, R, gridWidth, nativeWidth, nativeHeight, 0);
    const out = zoned(samples, 0, 0, nativeWidth, rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < nativeWidth; x++) {
      const k = (Math.floor(y / 3) * 3 + Math.floor(x / 3)) % 2 === 0 ? kernelA : kernelB;
      let sum = 0;
      for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) sum += k[(v + R) * width + u + R]! * samples[(y + R - v) * gridWidth + x + R - u]!;
      expect(out[y * nativeWidth + x]).toBeCloseTo(sum, 14);
    }
  });
});
