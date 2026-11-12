# core/calculation-result.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AbsoluteUncertaintyEstimate

Absolute symmetric uncertainty around a result quantity.

```ts
export interface AbsoluteUncertaintyEstimate extends UncertaintyEstimateBase {
  kind: "absolute";
  /** Symmetric ± magnitude in the explicitly named unit. */
  plusMinus: number;
  /** Explicit unit such as mm, m, px, or "1" for dimensionless values. */
  unit: string;
}
```

## approximationResult

Creates an approximation-result envelope.

```ts
export function approximationResult<T>(
  value: T,
  model: string,
  modelVersion: string,
  assumptions: readonly string[],
  quality?: CalculationQuality
): CalculationResult<T>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatedResult

Creates a deterministic calculated-result envelope.

```ts
export function calculatedResult<T>(
  value: T,
  model: string,
  modelVersion: string,
  assumptions?: readonly string[],
  quality?: CalculationQuality
): CalculationResult<T>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculationProvenance

Metadata describing how a numerical result was produced.

```ts
export interface CalculationProvenance {
  /** Classification of the result's scientific origin. */
  kind: ProvenanceKind;
  /** Stable identifier for the model or equation set. */
  model: string;
  /** Version of the model, independent of the package version. */
  modelVersion: string;
  /** Concise assumptions that materially affect interpretation. */
  assumptions?: readonly string[];
}
```

## CalculationQuality

Optional quality metadata for a calculation result.

Uncertainty components stay separate. Do not add them, combine them in
quadrature (root-sum-of-squares) or merge them in any other way, unless you use
a scientifically justified method that documents its independence and
correlation assumptions.

```ts
export interface CalculationQuality {
  uncertainty?: readonly UncertaintyEstimate[];
  validRanges?: readonly CalculationValidRange[];
  notes?: readonly string[];
}
```

## CalculationResult

Standard result envelope for public scientific calculations.

Deterministic analytical results stay lightweight. They omit `quality` when
there is no defensible uncertainty or accuracy metadata to report.

Read-only from 2.0.0: the envelope, `provenance` and `quality` are frozen deeply and `value`
at its top level. Copy a value before changing it. Typed arrays inside a value stay mutable.
See docs/API_STYLE.md "Read-only results".

```ts
export interface CalculationResult<T> {
  readonly value: T;
  readonly provenance: CalculationProvenance;
  readonly quality?: CalculationQuality;
}
```

## CalculationValidRange

The documented parameter range in which a model or calibration is valid.
It says where the model applies. It is not a statistical interval.

```ts
export interface CalculationValidRange {
  /** JSON-style input/model parameter path, e.g. input.focusDistanceM. */
  parameterPath: string;
  /** Explicit unit such as m, mm, ISO, or "1" for dimensionless values. */
  unit: string;
  minimum?: number;
  maximum?: number;
  note?: string;
}
```

## calibratedResult

Creates a calibrated-result envelope with explicit quality metadata.

```ts
export function calibratedResult<T>(
  value: T,
  model: string,
  modelVersion: string,
  assumptions: readonly string[],
  quality: CalculationQuality
): CalculationResult<T>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## estimatedResult

Creates an estimated-result envelope with explicit quality metadata.

```ts
export function estimatedResult<T>(
  value: T,
  model: string,
  modelVersion: string,
  assumptions: readonly string[],
  quality: CalculationQuality
): CalculationResult<T>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ProvenanceKind

Scientific provenance labels used throughout the public API.

```ts
export type ProvenanceKind =
  | "calculated"
  | "calibrated"
  | "estimated"
  | "approximation";
```

## RelativeUncertaintyEstimate

Relative symmetric uncertainty around a result quantity.

```ts
export interface RelativeUncertaintyEstimate extends UncertaintyEstimateBase {
  kind: "relative";
  /** Symmetric ± fractional magnitude; 0.05 means ±5%. */
  fraction: number;
}
```

## UncertaintyConfidence

Optional confidence metadata for a quantified uncertainty estimate.

Give a confidence level only when you can state its basis. Do not use it as a
general, subjective confidence score.

```ts
export interface UncertaintyConfidence {
  /** Confidence/coverage level as a fraction in the interval (0, 1]. */
  level: number;
  /** Concise description of the statistical/empirical basis. */
  basis: string;
}
```

## UncertaintyEstimate

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type UncertaintyEstimate =
  | AbsoluteUncertaintyEstimate
  | RelativeUncertaintyEstimate;
```

## UncertaintySource

Source category for a quantified uncertainty estimate.

```ts
export type UncertaintySource =
  | "measurement"
  | "model-approximation"
  | "calibration";
```

## validateCalculationQuality

Validates result-quality metadata before it enters a public result envelope.

```ts
export function validateCalculationQuality(
  quality: CalculationQuality | undefined
): void;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
