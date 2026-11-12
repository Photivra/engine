# exposure/exposure.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateEquivalentIso

Calculates the ISO (gain) setting that keeps the nominal rendered exposure
the same after aperture, shutter or both change. Assumes nothing else
changes.

This is an exposure-compensation relation, not a sensor-noise model.

```ts
export function calculateEquivalentIso(
  input: CalculateEquivalentIsoInput
): CalculationResult<number>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateEquivalentIsoInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateEquivalentIsoInput {
  baseIso: number;
  baseAperture: number;
  baseShutterSeconds: number;
  aperture: number;
  shutterSeconds: number;
}
```

## calculateExposureValue100

Calculates EV100 from aperture and shutter duration.

```ts
export function calculateExposureValue100(
  input: CalculateExposureValue100Input
): CalculationResult<number>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateExposureValue100Input

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateExposureValue100Input {
  /** F-number. */
  aperture: number;
  /** Shutter duration in seconds. */
  shutterSeconds: number;
}
```

## calculateRelativeOpticalExposure

Compares image-plane optical exposure using the proportional relation
shutterSeconds / aperture^2.

This does not include scene light, lens transmission, vignetting or sensor
response. Do not read it as a photon count.

```ts
export function calculateRelativeOpticalExposure(
  input: CalculateRelativeOpticalExposureInput
): CalculationResult<RelativeOpticalExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateRelativeOpticalExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateRelativeOpticalExposureInput {
  aperture: number;
  shutterSeconds: number;
  referenceAperture: number;
  referenceShutterSeconds: number;
}
```

## calculateRelativeRenderedExposure

Calculates a relative linear rendering exposure from aperture, shutter, and
nominal ISO gain.

This relation is for deterministic educational rendering, relative to a
declared reference exposure. ISO is treated as a brightness (gain) control;
it does not create photons. This function does not model sensor noise,
clipping, tone mapping, lens transmission or absolute scene luminance.

```ts
export function calculateRelativeRenderedExposure(
  input: CalculateRelativeRenderedExposureInput
): CalculationResult<RelativeRenderedExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateRelativeRenderedExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateRelativeRenderedExposureInput {
  aperture: number;
  shutterSeconds: number;
  iso: number;
  referenceAperture: number;
  referenceShutterSeconds: number;
  referenceIso: number;
}
```

## RelativeOpticalExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RelativeOpticalExposure {
  /** Relative light exposure at the image plane; 1 equals the reference. */
  factor: number;
  /** Difference from the reference in stops. Positive means more light exposure. */
  stops: number;
}
```

## RelativeRenderedExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RelativeRenderedExposure {
  /** Nominal linear rendering multiplier; 1 equals the reference settings. */
  factor: number;
  /** Difference from the reference in stops. Positive means a brighter rendering. */
  stops: number;
  /** Image-plane optical exposure ratio before nominal ISO gain. */
  opticalFactor: number;
  /** Nominal ISO gain ratio relative to the reference ISO. */
  isoGainFactor: number;
}
```
