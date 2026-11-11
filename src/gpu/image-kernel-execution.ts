// SPDX-License-Identifier: Apache-2.0

/**
 * Execution-backend labels, error bounds and domain errors for the optional image-kernel accelerator.
 *
 * `cpu-reference` is the float64 engine reference and the default. `webgpu-f32` is a separate float32
 * approximation backend. Every one of its results carries a forward-error bound worked out in advance
 * from:
 * - IEEE 754 binary32 rounding (unit roundoff u = 2^-24; γ_k = k·u/(1 − k·u), the classical factor
 *   in error bounds for floating-point sums and inner products: Rump & Jeannerod, SIAM J. Matrix
 *   Anal. Appl. 35(2), 2014, sec. 1, free author copy. Also see: Higham, Accuracy and Stability of
 *   Numerical Algorithms, 2nd ed., SIAM 2002, §2–§3);
 * - the WGSL built-in accuracy table (W3C WebGPU Shading Language, §"Floating Point Accuracy").
 * See docs/WEBGPU.md.
 */

import { requireInputObject } from "../core/record-validation.js";
import { InvalidScientificInputError } from "../core/validation.js";

/** Requested or actual execution backend. */
export type ImageKernelBackend = "cpu-reference" | "webgpu-f32";

/** Why a requested WebGPU backend was not used (only with `fallback: "cpu-reference"`). */
/** Why a requested `webgpu-f32` backend ran the CPU reference instead. `webgpu-disabled`: `setWebGpuEnabled(false)` in this realm. */
export type ImageKernelFallbackReason = "webgpu-unavailable" | "webgpu-disabled" | "adapter-unavailable" | "device-request-failed" |
  "insufficient-limits" | "unsupported-platform-endianness";

/**
 * Failure classes reported by {@link ImageKernelExecutionError}. `conformance-failed` (#481): a device failed the display view's
 * run-time self-check with `gpu: "require"`. `quality-code-unavailable` (2.22.0, #594): the display view's on-demand GPU
 * full-quality code could not be loaded (for example a failed chunk download); `prepareQualityPaths()` rejects with it, and a
 * render with `gpu: "require"` fails with it.
 */
export type ImageKernelFailureReason = ImageKernelFallbackReason | "device-lost" | "out-of-memory" | "gpu-validation" |
  "aborted" | "disposed" | "busy" | "unsupported-on-backend" | "unsupported-float32-domain" | "indeterminate-float32-classification" | "conformance-failed" |
  "quality-code-unavailable";

/** Domain error for getting and running a backend. Input validation still throws the engine's existing errors. */
export class ImageKernelExecutionError extends Error {
  readonly code = "IMAGE_KERNEL_EXECUTION";
  readonly reason: ImageKernelFailureReason;

  constructor(reason: ImageKernelFailureReason, message: string) {
    super(message);
    this.name = "ImageKernelExecutionError";
    this.reason = reason;
  }
}

/** Integer output codes: |code_webgpu − code_reference| ≤ maximumAbsoluteCodeDifference for every sample. */
export interface ImageKernelCodeErrorBound {
  kind: "integer-code-difference";
  maximumAbsoluteCodeDifference: number;
  /** Bound on the float32 linear value entering the sRGB transfer, after tone and gamut handling. */
  linearAbsoluteBound: number;
  /** Declared bound on the WGSL sRGB transfer evaluation (pow), see WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND. */
  transferAbsoluteBound: number;
}

/** Non-negative linear sums: |v_webgpu − v_reference| ≤ relative·v_reference + absolute for every sample. */
export interface ImageKernelRelativeErrorBound {
  kind: "relative-to-reference";
  relative: number;
  absolute: number;
}

/**
 * Seeded stochastic stages (the sensor stage). Random states are integer arithmetic and bit-identical to
 * the reference. A site is flagged when any float32 decision (sampling test, saturation limit, rounding)
 * fell inside its a-priori bound. Every unflagged site has exactly the reference code and flags; only
 * flagged sites may differ, and the statistical-equivalence tests cover them (docs/WEBGPU.md).
 */
export interface ImageKernelSeededRealizationBound {
  kind: "exact-except-flagged-sites";
  /** Number of flagged sites; equal to the execution's `diagnosticUncertaintySampleCount`. */
  flaggedSiteCount: number;
  noiseModel: { id: string; version: string };
  seedSchedule: string;
}

/**
 * #481: the WebGPU adapter a device came from, as `GPUAdapter.info` describes it (W3C WebGPU, `GPUAdapterInfo`): each field
 * is the browser's string, or empty when the browser withholds it. Diagnostic only; it never changes a result.
 */
export interface ImageKernelAdapterDescription {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

/**
 * A component of the composite chart kernel's double-float32 probe (see {@link ChartCompositeProbeRecord}). The first four are the
 * outputs of the probe before 2.11.0: `two-sum` is TwoSum's low part (`s.l`), `two-product` Dekker's TwoProduct low part (`m.l`),
 * `double-word-add` the double-word sum's low part (`a.l`), `double-word-multiply` the Dekker double-word product (`q.h`, `q.l`).
 */
export type ChartCompositeProbeComponent = "two-sum" | "two-product" | "double-word-add" | "double-word-multiply" | "fma-two-product" | "fma-double-word-multiply";

/** One probe output that differs from its expected value: the component, the probe input's index, and the float32 bits (hex). */
export interface ChartCompositeProbeMismatch {
  component: ChartCompositeProbeComponent;
  input: number;
  got: string;
  want: string;
}

/**
 * The composite chart kernel's device probe (docs/WEBGPU.md, "Scene radiance on the GPU"): how the device evaluated the kernel's
 * double-float32 building blocks, and which product path the kernel was compiled with. Diagnostic; it never changes a result.
 *
 * - `deviceClass`: `exact` (the written order, round to nearest); `contracted` (only the Dekker product paths differ, consistent
 *   with a multiply and an add fused into one rounding); `reassociated` (a sum path differs and every differing sum low part is
 *   zero, the value an algebraic simplification of (a + b) − a to b gives); `other` (anything else, such as a sum path that differs
 *   with non-zero low parts, as a rounding not to nearest gives, or a non-finite output).
 * - `productPath`: `dekker` when the Dekker path passes, else `fma` when the fma path passes (which needs a fused `fma`), else null
 *   (the device is refused for composite charts, the 2.3 elements and material-layers scenes).
 * - `fmaFused`: whether every fma TwoProduct low part was exact (a fused `fma`; WGSL also allows an unfused one).
 */
export interface ChartCompositeProbeRecord {
  deviceClass: "exact" | "contracted" | "reassociated" | "other";
  productPath: "dekker" | "fma" | null;
  fmaFused: boolean;
  /** Probe inputs, each checked on every component. */
  inputs: number;
  /** Differing outputs per component. */
  mismatchCounts: Readonly<Record<ChartCompositeProbeComponent, number>>;
  /** The indices of the probe inputs (`PROBE_INPUTS`) whose output differs, per component. */
  mismatchedInputs: Readonly<Record<ChartCompositeProbeComponent, readonly number[]>>;
  /** The first differing outputs (at most eight), in component order. */
  mismatches: readonly ChartCompositeProbeMismatch[];
}

/** Label attached to every accelerated result. */
export interface ImageKernelExecution {
  backend: ImageKernelBackend;
  requestedBackend: ImageKernelBackend;
  fallbackReason: ImageKernelFallbackReason | null;
  arithmetic: "float64" | "float32";
  assurance: "engine-reference" | "approximation-with-a-priori-bound";
  /**
   * The exact-or-fast flag in the facade's words (#395): false for `cpu-reference` (the engine reference), true for
   * `webgpu-f32` (a bounded approximation). `backend` still names where the work ran.
   */
  fast: boolean;
  /**
   * True only for `cpu-reference`. Bit-exact identities (SHA-256 artifact bindings, byte-parity fixtures,
   * cross-engine determinism hashes) are CPU-only and must never be computed from a `webgpu-f32` result.
   */
  bitIdenticalToReference: boolean;
  errorBound: ImageKernelCodeErrorBound | ImageKernelRelativeErrorBound | ImageKernelSeededRealizationBound | null;
  /**
   * Diagnostic counts equal the reference when no sample fell inside a float32 classification band
   * (`diagnosticUncertaintySampleCount === 0`). Otherwise each count differs by at most that many
   * samples.
   */
  diagnosticsExact: boolean;
  diagnosticUncertaintySampleCount: number;
  limitations: readonly string[];
}

/** IEEE 754 binary32 unit roundoff. */
export const WEBGPU_F32_UNIT_ROUNDOFF = 2 ** -24;
/**
 * Declared absolute error bound for the WGSL sRGB encode on [0, 1]: `1.055·pow(x, 1/2.4) − 0.055`. pow
 * takes its accuracy from exp2(y·log2 x) (log2: 3 ULP, or 2^-21 absolute on [0.5, 2]; exp2: 3 + 2|x|
 * ULP). The worst case over [0.0031308, 1] is about 2.5e-6. The bound 2^-17 ≈ 7.6e-6 keeps a 3× margin,
 * and also covers the small jump where the sRGB segments join (< 1e-7).
 */
export const WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND = 2 ** -17;
/** Largest slope of the sRGB encode on [0, 1] (the linear segment, 12.92). */
export const SRGB_ENCODE_LIPSCHITZ = 12.92;

/** Higham's γ_k for binary32. */
export function float32Gamma(k: number): number {
  const ku = k * WEBGPU_F32_UNIT_ROUNDOFF;
  return ku < 1 ? ku / (1 - ku) : Number.POSITIVE_INFINITY;
}

/** Integer-code bound from a bound on the linear value: |Δcode| ≤ ⌊maximum·(12.92·δ_L + δ_E)⌋ + 1, capped at maximum. */
export function integerCodeBound(maximum: number, linearAbsoluteBound: number): ImageKernelCodeErrorBound {
  const linear = Math.min(1, linearAbsoluteBound);
  const real = maximum * (SRGB_ENCODE_LIPSCHITZ * linear + WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND);
  return { kind: "integer-code-difference", maximumAbsoluteCodeDifference: Math.min(maximum, Math.floor(real) + 1),
    linearAbsoluteBound: linear, transferAbsoluteBound: WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND };
}

/**
 * Composes two `relative-to-reference` bounds through a pipeline `second ∘ first`, where the second
 * stage is linear with non-negative weights summing to at most `secondWeightSum` per output (convolution,
 * temporal sums). With |ã − a| ≤ r₁a + a₁ elementwise and |B̃x − Bx| ≤ r₂Bx + a₂:
 * |B̃ã − Ba| ≤ |B̃ã − Bã| + |B(ã − a)| ≤ r₂(1 + r₁)Ba + r₂W·a₁ + a₂ + r₁Ba + W·a₁,
 * so r = r₁ + r₂ + r₁r₂ and a = a₂ + W·a₁·(1 + r₂). See docs/WEBGPU.md, "Accuracy contract".
 */
export function composeRelativeErrorBounds(first: ImageKernelRelativeErrorBound, second: ImageKernelRelativeErrorBound,
  secondWeightSum: number): ImageKernelRelativeErrorBound {
  requireInputObject(first, "composeRelativeErrorBounds first bound");
  requireInputObject(second, "composeRelativeErrorBounds second bound");
  for (const v of [first.relative, first.absolute, second.relative, second.absolute, secondWeightSum]) {
    if (!(typeof v === "number" && v >= 0 && v <= Number.MAX_VALUE)) {
      throw new InvalidScientificInputError("Error bounds and weight sums must be finite and non-negative.");
    }
  }
  return { kind: "relative-to-reference", relative: first.relative + second.relative + first.relative * second.relative,
    absolute: second.absolute + secondWeightSum * first.absolute * (1 + second.relative) };
}

export const CPU_REFERENCE_LIMITATIONS = /* @__PURE__ */ Object.freeze(["Float64 engine reference execution; results are the reference by definition"]);
export const WEBGPU_F32_LIMITATIONS = /* @__PURE__ */ Object.freeze([
  "Float32 WebGPU execution is an approximation of the float64 reference within the reported a-priori bound",
  "Not bit-identical to the reference: never use for SHA-256 artifact identities, byte-parity evidence or determinism hashes",
  "Bound assumes a conforming WebGPU implementation (correctly rounded f32 add/multiply/divide, WGSL accuracy table)",
  "Execution speed depends on the adapter; software adapters do not represent GPU performance"
]);

export function cpuExecution(requestedBackend: ImageKernelBackend, fallbackReason: ImageKernelFallbackReason | null): ImageKernelExecution {
  return { backend: "cpu-reference", requestedBackend, fallbackReason, arithmetic: "float64", assurance: "engine-reference", fast: false,
    bitIdenticalToReference: true, errorBound: null, diagnosticsExact: true, diagnosticUncertaintySampleCount: 0, limitations: CPU_REFERENCE_LIMITATIONS };
}

export function webGpuExecution(errorBound: ImageKernelExecution["errorBound"], uncertainty: number): ImageKernelExecution {
  return { backend: "webgpu-f32", requestedBackend: "webgpu-f32", fallbackReason: null, arithmetic: "float32",
    assurance: "approximation-with-a-priori-bound", fast: true, bitIdenticalToReference: false, errorBound, diagnosticsExact: uncertainty === 0,
    diagnosticUncertaintySampleCount: uncertainty, limitations: WEBGPU_F32_LIMITATIONS };
}
