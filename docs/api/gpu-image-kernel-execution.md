# gpu/image-kernel-execution.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ChartCompositeProbeComponent

A component of the composite chart kernel's double-float32 probe (see {@link ChartCompositeProbeRecord}). The first four are the
outputs of the probe before 2.11.0: `two-sum` is TwoSum's low part (`s.l`), `two-product` Dekker's TwoProduct low part (`m.l`),
`double-word-add` the double-word sum's low part (`a.l`), `double-word-multiply` the Dekker double-word product (`q.h`, `q.l`).

```ts
export type ChartCompositeProbeComponent = "two-sum" | "two-product" | "double-word-add" | "double-word-multiply" | "fma-two-product" | "fma-double-word-multiply";
```

## ChartCompositeProbeMismatch

One probe output that differs from its expected value: the component, the probe input's index, and the float32 bits (hex).

```ts
export interface ChartCompositeProbeMismatch {
  component: ChartCompositeProbeComponent;
  input: number;
  got: string;
  want: string;
}
```

## ChartCompositeProbeRecord

The composite chart kernel's device probe (docs/WEBGPU.md, "Scene radiance on the GPU"): how the device evaluated the kernel's
double-float32 building blocks, and which product path the kernel was compiled with. Diagnostic; it never changes a result.

- `deviceClass`: `exact` (the written order, round to nearest); `contracted` (only the Dekker product paths differ, consistent
  with a multiply and an add fused into one rounding); `reassociated` (a sum path differs and every differing sum low part is
  zero, the value an algebraic simplification of (a + b) − a to b gives); `other` (anything else, such as a sum path that differs
  with non-zero low parts, as a rounding not to nearest gives, or a non-finite output).
- `productPath`: `dekker` when the Dekker path passes, else `fma` when the fma path passes (which needs a fused `fma`), else null
  (the device is refused for composite charts, the 2.3 elements and material-layers scenes).
- `fmaFused`: whether every fma TwoProduct low part was exact (a fused `fma`; WGSL also allows an unfused one).

```ts
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
```

## composeRelativeErrorBounds

Composes two `relative-to-reference` bounds through a pipeline `second ∘ first`, where the second
stage is linear with non-negative weights summing to at most `secondWeightSum` per output (convolution,
temporal sums). With |ã − a| ≤ r₁a + a₁ elementwise and |B̃x − Bx| ≤ r₂Bx + a₂:
|B̃ã − Ba| ≤ |B̃ã − Bã| + |B(ã − a)| ≤ r₂(1 + r₁)Ba + r₂W·a₁ + a₂ + r₁Ba + W·a₁,
so r = r₁ + r₂ + r₁r₂ and a = a₂ + W·a₁·(1 + r₂). See docs/WEBGPU.md, "Accuracy contract".

```ts
export function composeRelativeErrorBounds(first: ImageKernelRelativeErrorBound, second: ImageKernelRelativeErrorBound,
  secondWeightSum: number): ImageKernelRelativeErrorBound;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ImageKernelAdapterDescription

#481: the WebGPU adapter a device came from, as `GPUAdapter.info` describes it (W3C WebGPU, `GPUAdapterInfo`): each field
is the browser's string, or empty when the browser withholds it. Diagnostic only; it never changes a result.

```ts
export interface ImageKernelAdapterDescription {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}
```

## ImageKernelBackend

Requested or actual execution backend.

```ts
export type ImageKernelBackend = "cpu-reference" | "webgpu-f32";
```

## ImageKernelCodeErrorBound

Integer output codes: |code_webgpu − code_reference| ≤ maximumAbsoluteCodeDifference for every sample.

```ts
export interface ImageKernelCodeErrorBound {
  kind: "integer-code-difference";
  maximumAbsoluteCodeDifference: number;
  /** Bound on the float32 linear value entering the sRGB transfer, after tone and gamut handling. */
  linearAbsoluteBound: number;
  /** Declared bound on the WGSL sRGB transfer evaluation (pow), see WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND. */
  transferAbsoluteBound: number;
}
```

## ImageKernelExecution

Label attached to every accelerated result.

```ts
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
```

## ImageKernelRelativeErrorBound

Non-negative linear sums: |v_webgpu − v_reference| ≤ relative·v_reference + absolute for every sample.

```ts
export interface ImageKernelRelativeErrorBound {
  kind: "relative-to-reference";
  relative: number;
  absolute: number;
}
```

## ImageKernelSeededRealizationBound

Seeded stochastic stages (the sensor stage). Random states are integer arithmetic and bit-identical to
the reference. A site is flagged when any float32 decision (sampling test, saturation limit, rounding)
fell inside its a-priori bound. Every unflagged site has exactly the reference code and flags; only
flagged sites may differ, and the statistical-equivalence tests cover them (docs/WEBGPU.md).

```ts
export interface ImageKernelSeededRealizationBound {
  kind: "exact-except-flagged-sites";
  /** Number of flagged sites; equal to the execution's `diagnosticUncertaintySampleCount`. */
  flaggedSiteCount: number;
  noiseModel: { id: string; version: string };
  seedSchedule: string;
}
```

## WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND

Declared absolute error bound for the WGSL sRGB encode on [0, 1]: `1.055·pow(x, 1/2.4) − 0.055`. pow
takes its accuracy from exp2(y·log2 x) (log2: 3 ULP, or 2^-21 absolute on [0.5, 2]; exp2: 3 + 2|x|
ULP). The worst case over [0.0031308, 1] is about 2.5e-6. The bound 2^-17 ≈ 7.6e-6 keeps a 3× margin,
and also covers the small jump where the sRGB segments join (< 1e-7).

```ts
WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND = 2 ** -17
```

## WEBGPU_F32_UNIT_ROUNDOFF

IEEE 754 binary32 unit roundoff.

```ts
WEBGPU_F32_UNIT_ROUNDOFF = 2 ** -24
```
