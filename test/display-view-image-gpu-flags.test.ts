// SPDX-License-Identifier: Apache-2.0
/**
 * #716: the image-plane Speed module flags a bilinear value (its display pixel is then recomputed on the host) only when the
 * point's error could move it by more than E of it, the move bounded by the neighboring pixels' differences in the cells the
 * error reaches and the error derived for the double-float32 steps (docs/WEBGPU.md, "The image-plane module"). Before #716 the
 * flag compared twice the brightest neighbor times 2⁻³⁸·(X + Y) with the value, so large photos were recomputed in whole
 * regions (the fixture at 6000 × 4000: 2,611 of 27,405 display pixels; a noisy ramp at 17000 × 1400: 768, the right fifth of
 * the print). On the float32 emulation (test/helpers/fake-webgpu*.ts); test/webgpu/display-view.webgpu.ts runs the image-plane
 * cases on a device.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareImagePlaneScenes } from "../src/index.js";
import type { ImagePlaneScene } from "../src/index.js";
import { IMAGE_PLANE_GPU_CASES, photo, syntheticPhoto } from "./helpers/image-plane-fixtures.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { IMAGE_PLANE_POINT_PROBE } from "./helpers/fake-webgpu-composite.js";
import { imagePlanePointSlack } from "../src/gpu/display-view-image-quality.js";
import { SMALL_VIEW, compareDisplayViews, displayViewGpuFixture, renderOnGpu, runtimeOf } from "./helpers/display-view-gpu-fixture.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** A gray ramp over encoded values 20..120 with ±4 codes of uniform noise (seeded): no edges, only pixel-to-pixel noise. */
function noisyRamp(width: number, height: number): ImagePlaneScene["image"] {
  let seed = 708;
  const random = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2 ** 32; };
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const base = 20 + 100 * (y / (height - 1));
    for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(base + 8 * (random() - 0.5))));
  }
  return { width, height, channels: 3, encoding: "srgb-8", data };
}

describe("image-plane Speed module: the moved-value flag on large photos (#716)", () => {
  beforeAll(async () => { await prepareImagePlaneScenes(); });
  // [photo, the largest flagged share of the display pixels]: the fixture's bar pattern keeps a few edge pixels; the ramp has none.
  const cases: [string, () => ImagePlaneScene["image"], number][] = [
    ["the fixture photo at 6000 × 4000 (24 MP)", (): ImagePlaneScene["image"] => syntheticPhoto(6000, 4000), 0.01],
    ["a noisy gray ramp at 17000 × 1400 (23.8 MP)", (): ImagePlaneScene["image"] => noisyRamp(17000, 1400), 0]
  ];
  it.each(cases)("%s fitted in the frame: few or no flagged pixels, inside the bounds, samples within one code", async (name, make, share) => {
    const fixture = await displayViewGpuFixture({ ...IMAGE_PLANE_GPU_CASES[1]![1], scene: photo(make()) }, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const gpu = await renderOnGpu(runtime, fixture), a = compareDisplayViews(fixture.cpu, gpu);
    console.log(`#716 ${name}: ${gpu.flaggedPixelIndices.length} of ${a.pixels} display pixels flagged; ΔE2000 max ${a.deltaEMaximum.toExponential(1)}, σ units max ${a.sigmaUnitsMaximum.toExponential(1)}, ` +
      `bound used ${(100 * a.largestExpectedRatio).toFixed(1)} % / ${(100 * a.largestVarianceRatio).toFixed(1)} %`);
    expect(gpu.execution.backend).toBe("webgpu-f32");
    expect(gpu.flaggedPixelIndices.length).toBeLessThanOrEqual(share * a.pixels);
    expect(a.outsideExpectedBound + a.outsideVarianceBound).toBe(0);
    expect(a.largestCodeDifference).toBeLessThanOrEqual(1);
    expect(Array.from(gpu.hostRecomputedPixelIndices)).toEqual(Array.from(gpu.flaggedPixelIndices));
    runtime.destroy();
  }, scaledTimeout(600_000));

  // The derived point bound against the emulation's own double-float32 arithmetic: per mapped point, |X_gpu − X| with X formed in
  // float64 from the recovered site and offset ((x + c_o)·g·k + 1)·W/2, and the same for Y, within half of the device's term of δ.
  it("the device's pixel coordinates stay within half of the derived bound (6000 × 4000 photo, every mapped point)", async () => {
    const fixture = await displayViewGpuFixture({ ...IMAGE_PLANE_GPU_CASES[1]![1], scene: photo(syntheticPhoto(6000, 4000)) }, SMALL_VIEW), runtime = await runtimeOf(createFakeGpu().gpu);
    const { signalInput, setup } = fixture.input, k = setup.gpu!.placement!.chartUnitsPerFrameUnit, scene = (signalInput.scene as unknown as { image: { scene: { width: number; height: number; aspect: number } } }).image.scene;
    const W = signalInput.nativeWidth, H = signalInput.nativeHeight, g = 2 / signalInput.outputWidth, halfW = scene.width / 2, halfH = scene.height / (2 * scene.aspect);
    let worst = 0, points = 0;
    const record = (sites: readonly [number, number], offsets: readonly [number, number], x: readonly [number, number], y: readonly [number, number]): void => {
      const o = signalInput.offsets, u = (sites[0] + 0.5 + o[offsets[0]]!.x - W / 2) * g * k, v = -(sites[1] + 0.5 + o[offsets[1]]!.y - H / 2) * g * k;
      const X = (u + 1) * halfW, Y = (scene.aspect - v) * halfH;
      // The device's term of δ (imagePlanePointSlack less the reference's 4·10⁻¹⁴·k·half, plus the shader's 2⁻⁴⁴·|X|).
      const dx = imagePlanePointSlack(halfW, k, 1) - 4e-14 * k * halfW + 2 ** -44 * Math.abs(X), dy = imagePlanePointSlack(halfH, k, scene.aspect) - 4e-14 * k * halfH + 2 ** -44 * Math.abs(Y);
      worst = Math.max(worst, Math.abs(x[0] + x[1] - X) / dx, Math.abs(y[0] + y[1] - Y) / dy);
      points++;
    };
    // The first render runs the device's self-check (its own photo); the probe records the second.
    await renderOnGpu(runtime, fixture);
    IMAGE_PLANE_POINT_PROBE.record = record;
    try { await renderOnGpu(runtime, fixture); } finally { delete IMAGE_PLANE_POINT_PROBE.record; runtime.destroy(); }
    console.log(`#716 point bound: ${points} points, largest error ${worst.toFixed(3)} of the device's term of δ`);
    expect(points).toBeGreaterThan(100_000);
    expect(worst).toBeLessThan(0.5);
  }, scaledTimeout(600_000));
});
