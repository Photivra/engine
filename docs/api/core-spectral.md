# core/spectral.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseSpectralWavelengthBasis

Parses a wavelength basis. It never converts between air and vacuum.

```ts
export function parseSpectralWavelengthBasis(
  value: unknown,
  path = "wavelengthBasis"
): SpectralWavelengthBasis;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSpectralWavelengthRangeNanometers

Parses a positive non-empty wavelength interval in nanometres.

```ts
export function parseSpectralWavelengthRangeNanometers(
  value: unknown,
  path = "wavelengthRangeNanometers"
): SpectralWavelengthRangeNanometers;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSpectralWavelengthSample

Parses one positive wavelength coordinate in nanometres.

```ts
export function parseSpectralWavelengthSample(
  value: unknown,
  path = "spectralSample"
): SpectralWavelengthSample;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SpectralWavelengthBasis

Whether wavelengths are measured in air or in vacuum.

"unspecified" is allowed only where a downstream contract explicitly accepts
unresolved or approximate wavelengths. Calibrated physical calculations must
resolve the basis first.

```ts
export type SpectralWavelengthBasis =
  | "air"
  | "vacuum"
  | "unspecified";
```

## SpectralWavelengthRangeNanometers

Closed wavelength interval expressed in nanometres.

```ts
export interface SpectralWavelengthRangeNanometers {
  minimum: number;
  maximum: number;
}
```

## SpectralWavelengthSample

One wavelength coordinate expressed in nanometres.

```ts
export interface SpectralWavelengthSample {
  wavelengthNanometers: number;
}
```
