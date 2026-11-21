// SPDX-License-Identifier: Apache-2.0

/**
 * Blurs a sampled image-plane quantity with caller-supplied PSF (point-spread function) kernels, one
 * kernel per patch of the image. The quantity must be linear and additive (for example irradiance).
 * Each patch is treated as shift-invariant ("isoplanatic"): the same PSF applies everywhere inside it.
 * The PSFs are incoherent intensity PSFs.
 *
 * This is the CPU float64 reference for the optics-as-convolution step (#277). The `webgpu-f32`
 * path runs the same equation; see docs/WEBGPU.md.
 *
 * Equation (indexed by source site; an energy-conserving scatter written as a gather):
 *   out(x, y) = Σ_{v=-r..r} Σ_{u=-r..r} in(x − u, y − v) · K_{p(x − u, y − v)}(u, v)
 * where `p(s)` is the patch containing the **source** site and `K_p(u, v)` is the fraction of the source
 * site's quantity that lands at displacement (+u right, +v down), in grid sites.
 *
 * Incoherent imaging is a linear sum of intensity PSFs: the output intensity is the input intensity
 * convolved with the intensity PSF (MIT OpenCourseWare 2.71 Optics, Spring 2009, lecture 22, free).
 * A PSF that varies across the field is approximated as constant inside each patch, as in methods
 * that divide the image into isoplanatic subsections (van de Ketterij et al., arXiv:2011.01738,
 * sec. 1, free). Also see: Goodman, Introduction to Fourier Optics, 4th ed., 2017, §7.1. Camera
 * simulators such as ISETCam use the same piecewise shift-invariant method
 * (Farrell et al., Proc. SPIE 8299, 2012). The caller chooses the patch size and kernels, and so
 * owns the patch approximation.
 *
 * Edges: the grid holds every source. Sources outside the grid are not represented. Anything
 * scattered outside the grid is lost; compare `inputSum` with `outputSum` to see how much. There is no
 * padding, reflection or renormalization.
 */
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { FULL_RESOLUTION_CEILING_PIXELS, resolveRaisedLimit } from "../core/pixel-limits.js";

export const IRRADIANCE_CONVOLUTION_SCHEMA_VERSION = "0.1.0" as const;
/** `maximumPixels` is the default grid limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`. */
export const IRRADIANCE_CONVOLUTION_LIMITS = /* @__PURE__ */ Object.freeze({
  maximumPixels: 24_000_000,
  ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS,
  maximumDimension: 16_384,
  maximumKernelRadius: 32,
  maximumPatchCount: 4_096,
  maximumKernelWeights: 4_194_304,
  /** A kernel may lose energy (vignetting, transmission) but may not create it, beyond rounding slack. */
  maximumKernelSum: 1 + 2 ** -20,
  /** Inputs larger than this are rejected so that float32 execution cannot overflow. */
  maximumSampleMagnitude: 2 ** 100
});

export interface IrradianceConvolutionInput {
  schemaVersion: typeof IRRADIANCE_CONVOLUTION_SCHEMA_VERSION;
  width: number;
  height: number;
  /** Row-major samples. Finite, non-negative, linear and additive (for example irradiance, or expected photons per site). */
  samples: Float32Array | Float64Array;
  /** Kernel half-width in grid sites. Each kernel is (2r+1)×(2r+1). */
  kernelRadius: number;
  /** Patch size in grid sites. The last row and column of patches may be partial. */
  patchWidth: number;
  patchHeight: number;
  /**
   * Finite non-negative weights, `[patchRow][patchColumn][v + r][u + r]`, one kernel per patch in
   * row-major patch order. Each kernel sums to at most 1 (+2^-20 rounding slack).
   */
  kernels: Float32Array | Float64Array;
  boundary: "zero-outside-grid";
  /**
   * Optional opt-in grid limit for large images: an integer from 1 to `IRRADIANCE_CONVOLUTION_LIMITS.ceilingPixels`.
   * Default `IRRADIANCE_CONVOLUTION_LIMITS.maximumPixels` (24 000 000). It does not change the result.
   */
  maximumPixels?: number;
}

/** Validated, immutable geometry of a convolution request. Sample arrays are borrowed, not copied. */
export interface IrradianceConvolutionPlan {
  width: number;
  height: number;
  kernelRadius: number;
  kernelSize: number;
  tapCount: number;
  patchWidth: number;
  patchHeight: number;
  patchColumns: number;
  patchRows: number;
  /** Largest kernel sum and largest input magnitude. The float32 error bound uses them. */
  maximumKernelSum: number;
  maximumSampleMagnitude: number;
}

function positiveInteger(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new InvalidConfigurationError("Invalid irradiance convolution geometry.");
  }
  return value;
}

/** Checks every sample (finite, non-negative, within the declared magnitude) and returns the largest. */
function checkedMaximumSampleMagnitude(samples: Float32Array | Float64Array): number {
  let maximumSampleMagnitude = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    // Negated comparison also rejects NaN.
    if (!(v >= 0 && v <= IRRADIANCE_CONVOLUTION_LIMITS.maximumSampleMagnitude)) {
      throw new InvalidConfigurationError("Irradiance samples must be finite, non-negative and within the declared magnitude.");
    }
    if (v > maximumSampleMagnitude) maximumSampleMagnitude = v;
  }
  return maximumSampleMagnitude;
}

/** Checks every kernel weight (finite, in [0, 1]) and kernel sum (at most 1 plus slack) and returns the largest sum. */
function checkedMaximumKernelSum(kernels: Float32Array | Float64Array, patchCount: number, tapCount: number): number {
  let maximumKernelSum = 0;
  for (let p = 0; p < patchCount; p++) {
    let sum = 0;
    for (let t = p * tapCount, end = t + tapCount; t < end; t++) {
      const w = kernels[t]!;
      if (!(w >= 0 && w <= 1)) throw new InvalidConfigurationError("PSF kernel weights must be finite and within [0, 1].");
      sum += w;
    }
    if (sum > IRRADIANCE_CONVOLUTION_LIMITS.maximumKernelSum) throw new InvalidConfigurationError("A PSF kernel may not create energy (sum exceeds 1).");
    if (sum > maximumKernelSum) maximumKernelSum = sum;
  }
  return maximumKernelSum;
}

/** Validates the request and returns its plan. Every sample and weight is checked once. */
export function calculateIrradianceConvolutionPlan(input: IrradianceConvolutionInput): IrradianceConvolutionPlan {
  const r = requireAllowlistedRecord(input, ["schemaVersion", "width", "height", "samples", "kernelRadius", "patchWidth",
    "patchHeight", "kernels", "boundary", "maximumPixels"], "Invalid irradiance convolution input.");
  const L = IRRADIANCE_CONVOLUTION_LIMITS;
  if (r.schemaVersion !== IRRADIANCE_CONVOLUTION_SCHEMA_VERSION || r.boundary !== "zero-outside-grid") {
    throw new InvalidConfigurationError("Unsupported irradiance convolution schema or boundary.");
  }
  const width = positiveInteger(r.width, L.maximumDimension), height = positiveInteger(r.height, L.maximumDimension);
  const maximumPixels = resolveRaisedLimit(r.maximumPixels, L.maximumPixels, L.ceilingPixels,
    "Irradiance convolution maximumPixels must be an integer from 1 to " + L.ceilingPixels + ".");
  if (width * height > maximumPixels) throw new InvalidConfigurationError("Irradiance convolution grid exceeds the pixel limit.");
  const radius = r.kernelRadius;
  if (typeof radius !== "number" || !Number.isSafeInteger(radius) || radius < 0 || radius > L.maximumKernelRadius) {
    throw new InvalidConfigurationError("Invalid irradiance convolution kernel radius.");
  }
  const patchWidth = positiveInteger(r.patchWidth, width), patchHeight = positiveInteger(r.patchHeight, height);
  const patchColumns = Math.ceil(width / patchWidth), patchRows = Math.ceil(height / patchHeight);
  const kernelSize = 2 * radius + 1, tapCount = kernelSize * kernelSize, patchCount = patchColumns * patchRows;
  if (patchCount > L.maximumPatchCount || patchCount * tapCount > L.maximumKernelWeights) {
    throw new InvalidConfigurationError("Irradiance convolution kernels exceed the declared limits.");
  }
  const samples = r.samples, kernels = r.kernels;
  if (!(samples instanceof Float32Array || samples instanceof Float64Array) || samples.length !== width * height ||
      !(kernels instanceof Float32Array || kernels instanceof Float64Array) || kernels.length !== patchCount * tapCount) {
    throw new InvalidConfigurationError("Irradiance convolution arrays do not match the declared geometry.");
  }
  const maximumSampleMagnitude = checkedMaximumSampleMagnitude(samples);
  const maximumKernelSum = checkedMaximumKernelSum(kernels, patchCount, tapCount);
  return Object.freeze({ width, height, kernelRadius: radius, kernelSize, tapCount, patchWidth, patchHeight, patchColumns, patchRows,
    maximumKernelSum, maximumSampleMagnitude });
}

/**
 * Reference gather for output rows `[y0, y1)`, written into `output` at `(y - y0) * width + x`.
 * The summation order (v outer, u inner, both ascending) is part of the contract shared with the
 * WGSL (WebGPU shader) kernel.
 * @internal
 */
export function convolveIrradianceRows(plan: IrradianceConvolutionPlan, samples: Float32Array | Float64Array,
  kernels: Float32Array | Float64Array, y0: number, y1: number, output: Float64Array): void {
  const { width, height, kernelRadius: r, kernelSize, tapCount, patchWidth, patchHeight, patchColumns, patchRows } = plan;
  // 2.28.0 (#727): the tap ranges are clipped to the grid once per row and pixel instead of testing every tap, and each source
  // column's kernel offset (its patch column × tapCount) is read from a table built once per call (an index cache: no signal is
  // tabulated). The taps, their products and their order (v outer, u inner, both ascending) are unchanged, so every value is the same.
  const columnKernelOffset = new Int32Array(width);
  for (let sx = 0; sx < width; sx++) columnKernelOffset[sx] = Math.min(Math.floor(sx / patchWidth), patchColumns - 1) * tapCount;
  for (let y = y0; y < y1; y++) {
    // Taps with 0 ≤ y − v < height and 0 ≤ x − u < width.
    const vFirst = Math.max(-r, y - height + 1), vLast = Math.min(r, y);
    for (let x = 0; x < width; x++) {
      const uFirst = Math.max(-r, x - width + 1), uLast = Math.min(r, x);
      let sum = 0;
      for (let v = vFirst; v <= vLast; v++) {
        const sy = y - v;
        const patchRowOffset = Math.min(Math.floor(sy / patchHeight), patchRows - 1) * patchColumns * tapCount;
        const kernelRow = patchRowOffset + (v + r) * kernelSize + r, sampleRow = sy * width + x;
        for (let u = uFirst; u <= uLast; u++) {
          sum += samples[sampleRow - u]! * kernels[columnKernelOffset[x - u]! + kernelRow + u]!;
        }
      }
      output[(y - y0) * width + x] = sum;
    }
  }
}

/** Synchronous float64 reference for bounded grids. Use the image-kernel accelerator for large grids. */
export function calculateIrradianceConvolution(input: IrradianceConvolutionInput): { plan: IrradianceConvolutionPlan; values: Float64Array } {
  const plan = calculateIrradianceConvolutionPlan(input);
  const values = new Float64Array(plan.width * plan.height);
  convolveIrradianceRows(plan, input.samples, input.kernels, 0, plan.height, values);
  return { plan, values };
}

/** Validates each call of a runner: the first in full, later ones by their own arrays against the first call's plan (#453). */
function createRunnerValidation(geometry: Omit<IrradianceConvolutionInput, "samples" | "kernels">):
  (samples: Float32Array | Float64Array, kernels: Float32Array | Float64Array) => IrradianceConvolutionPlan {
  let plan: IrradianceConvolutionPlan | undefined;
  return (samples, kernels) => {
    if (plan === undefined) return (plan = calculateIrradianceConvolutionPlan({ ...geometry, samples, kernels }));
    const patchCount = plan.patchColumns * plan.patchRows;
    if (!(samples instanceof Float32Array || samples instanceof Float64Array) || samples.length !== plan.width * plan.height ||
        !(kernels instanceof Float32Array || kernels instanceof Float64Array) || kernels.length !== patchCount * plan.tapCount) {
      throw new InvalidConfigurationError("Irradiance convolution arrays do not match the declared geometry.");
    }
    checkedMaximumSampleMagnitude(samples);
    checkedMaximumKernelSum(kernels, patchCount, plan.tapCount);
    return plan;
  };
}

/**
 * Internal (#453; not exported from the package): runs several convolutions that share one geometry (width, height,
 * kernel radius, patch size, boundary, pixel limit) with one validation of that geometry. The first call is
 * `calculateIrradianceConvolution` itself, with every check. Each later call checks its own arrays exactly as the plan
 * does (array types and lengths against the geometry, every sample, every kernel weight and kernel sum, with the same
 * messages) and then runs the same gather (`convolveIrradianceRows`) with the first call's plan, whose geometry fields are
 * the same numbers a full validation of this call would give. The values are therefore identical to one
 * `calculateIrradianceConvolution` per call; only the repeated record and geometry checks are skipped.
 * @internal
 */
export function createIrradianceConvolutionRunner(geometry: Omit<IrradianceConvolutionInput, "samples" | "kernels">):
  (samples: Float32Array | Float64Array, kernels: Float32Array | Float64Array) => Float64Array {
  const validate = createRunnerValidation(geometry);
  return (samples, kernels) => {
    const plan = validate(samples, kernels), values = new Float64Array(plan.width * plan.height);
    convolveIrradianceRows(plan, samples, kernels, 0, plan.height, values);
    return values;
  };
}

/**
 * Internal (#419; not exported from the package): `createIrradianceConvolutionRunner` for one patch (patch = grid), returning only
 * the interior, the values at least `kernelRadius` sites from every edge: (width − 2r) × (height − 2r), row-major. Every call is
 * validated exactly as the runner validates it (the first in full, with `calculateIrradianceConvolution`'s checks and messages).
 * Each interior value is the runner's value bit for bit: no tap of it leaves the grid, so `convolveIrradianceRows`'s boundary
 * tests skip nothing, its patch is the only one (index 0), and this gather adds the same products (sample × weight) in the same
 * order (v outer, u inner, both ascending, every tap). Only the 2r edge rows and columns, which the caller discards, are not computed.
 * @internal
 */
export function createIrradianceConvolutionInteriorRunner(geometry: Omit<IrradianceConvolutionInput, "samples" | "kernels">):
  (samples: Float32Array | Float64Array, kernels: Float32Array | Float64Array) => Float64Array {
  const validate = createRunnerValidation(geometry);
  return (samples, kernels) => {
    const plan = validate(samples, kernels), { width, height, kernelRadius: r, kernelSize } = plan;
    if (plan.patchColumns !== 1 || plan.patchRows !== 1 || width <= 2 * r || height <= 2 * r) {
      throw new InvalidConfigurationError("The interior convolution needs one patch and a grid wider and taller than 2r.");
    }
    const innerWidth = width - 2 * r, values = new Float64Array(innerWidth * (height - 2 * r));
    for (let y = r; y < height - r; y++) {
      for (let x = r; x < width - r; x++) {
        let sum = 0;
        for (let v = -r; v <= r; v++) {
          const sampleRow = (y - v) * width + x, kernelRow = (v + r) * kernelSize + r;
          for (let u = -r; u <= r; u++) sum += samples[sampleRow - u]! * kernels[kernelRow + u]!;
        }
        values[(y - r) * innerWidth + x - r] = sum;
      }
    }
    return values;
  };
}
