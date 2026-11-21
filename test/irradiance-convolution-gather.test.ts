// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateIrradianceConvolution, IRRADIANCE_CONVOLUTION_SCHEMA_VERSION } from "../src/index.js";
import { calculateIrradianceConvolutionPlan, convolveIrradianceRows, createIrradianceConvolutionInteriorRunner,
  type IrradianceConvolutionInput, type IrradianceConvolutionPlan } from "../src/optics/irradiance-convolution.js";

/*
 * #727: the gather clips its tap ranges once per row and pixel and reads each source column's patch from a table, with the
 * same products in the same order. The oracle below is the 2.27.0 loop, copied unchanged (a test per tap, the patch column
 * by division); every value must be the same double (`Object.is`).
 */
function gatherAsIn2270(plan: IrradianceConvolutionPlan, samples: Float32Array | Float64Array, kernels: Float32Array | Float64Array,
  y0: number, y1: number, output: Float64Array): void {
  const { width, height, kernelRadius: r, kernelSize, tapCount, patchWidth, patchHeight, patchColumns, patchRows } = plan;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let v = -r; v <= r; v++) {
        const sy = y - v;
        if (sy < 0 || sy >= height) continue;
        const patchRowBase = Math.min(Math.floor(sy / patchHeight), patchRows - 1) * patchColumns;
        const kernelRow = (v + r) * kernelSize + r, sampleRow = sy * width;
        for (let u = -r; u <= r; u++) {
          const sx = x - u;
          if (sx < 0 || sx >= width) continue;
          const patch = patchRowBase + Math.min(Math.floor(sx / patchWidth), patchColumns - 1);
          sum += samples[sampleRow + sx]! * kernels[patch * tapCount + kernelRow + u]!;
        }
      }
      output[(y - y0) * width + x] = sum;
    }
  }
}

/** Deterministic xorshift32 values in [0, 1). */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function input(width: number, height: number, kernelRadius: number, patchWidth: number, patchHeight: number, seed: number,
  float32 = false): IrradianceConvolutionInput {
  const next = stream(seed), size = 2 * kernelRadius + 1, taps = size * size;
  const patches = Math.ceil(width / patchWidth) * Math.ceil(height / patchHeight);
  const samples = float32 ? new Float32Array(width * height) : new Float64Array(width * height);
  for (let i = 0; i < samples.length; i++) samples[i] = next() * 1000;
  const kernels = float32 ? new Float32Array(patches * taps) : new Float64Array(patches * taps);
  for (let p = 0; p < patches; p++) {
    let total = 0;
    for (let t = 0; t < taps; t++) { kernels[p * taps + t] = next(); total += kernels[p * taps + t]!; }
    // Scaled below unit sum (a kernel may lose energy, not create it).
    for (let t = 0; t < taps; t++) kernels[p * taps + t] = kernels[p * taps + t]! / (total * 1.001);
  }
  return { schemaVersion: IRRADIANCE_CONVOLUTION_SCHEMA_VERSION, width, height, samples, kernelRadius, patchWidth, patchHeight, kernels,
    boundary: "zero-outside-grid" };
}

function expectSameDoubles(actual: Float64Array, expected: Float64Array): void {
  expect(actual.length).toBe(expected.length);
  let differing = 0;
  for (let i = 0; i < actual.length; i++) if (!Object.is(actual[i], expected[i])) differing++;
  expect(differing).toBe(0);
}

describe("irradiance convolution gather (#727): clipped tap ranges, the same values", () => {
  it("gives the 2.27.0 loop's values bit for bit: patches with partial last ones, one patch, r beyond the grid, float32 arrays", () => {
    const cases: [number, number, number, number, number, boolean][] = [
      [37, 29, 4, 8, 7, false], // 5 × 5 patches, the last column and row partial
      [64, 48, 7, 64, 48, false], // one patch
      [5, 3, 9, 2, 2, false], // r larger than the width and the height
      [1, 1, 3, 1, 1, false], [23, 1, 5, 4, 1, false], [1, 19, 2, 1, 6, false], // single row or column
      [41, 33, 6, 13, 11, true], // float32 samples and kernels
      [30, 20, 0, 7, 9, false] // r = 0
    ];
    for (const [k, [width, height, r, pw, ph, float32]] of cases.entries()) {
      const request = input(width, height, r, pw, ph, 100 + k, float32), plan = calculateIrradianceConvolutionPlan(request);
      const expected = new Float64Array(width * height);
      gatherAsIn2270(plan, request.samples, request.kernels, 0, height, expected);
      expectSameDoubles(calculateIrradianceConvolution(request).values, expected);
      // A band of rows, as the accelerator's CPU path writes it.
      const y0 = Math.floor(height / 3), y1 = Math.max(y0 + 1, Math.floor((2 * height) / 3)), band = new Float64Array((y1 - y0) * width);
      convolveIrradianceRows(plan, request.samples, request.kernels, y0, y1, band);
      expectSameDoubles(band, expected.subarray(y0 * width, y1 * width));
    }
  });

  it("keeps the interior entry point equal to the full gather's interior", () => {
    const request = input(40, 31, 5, 40, 31, 7), { width, height, kernelRadius: r, samples, kernels, ...geometry } = request;
    const full = calculateIrradianceConvolution(request).values, interior = createIrradianceConvolutionInteriorRunner({ width, height,
      kernelRadius: r, ...geometry })(samples, kernels);
    const expected = new Float64Array((width - 2 * r) * (height - 2 * r));
    for (let y = r; y < height - r; y++) for (let x = r; x < width - r; x++) expected[(y - r) * (width - 2 * r) + x - r] = full[y * width + x]!;
    expectSameDoubles(interior, expected);
  });
});
