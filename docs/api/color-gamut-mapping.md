# color/gamut-mapping.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateGamutMappedColor

Maps one D65-relative XYZ colour into a target RGB gamut (see module notes).

```ts
export function calculateGamutMappedColor(input: PrepareRgbGamutMappingInput & { xyz: CieXyzTristimulus }): CalculationResult<GamutMappedColor>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## GamutMappedColor

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GamutMappedColor {
  /** Linear RGB in the target space, each component in [0, 1]. */
  linearRgb: ColorVector3;
  /** True when lightness or chroma was changed. */
  adjusted: boolean;
  /** Lightness was outside [0, 100] and was clipped to black or white. */
  lightnessClipped: boolean;
}
```

## GamutMappingMethod

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GamutMappingMethod = "cielab-hue-preserving-chroma-compression";
```

## PreparedRgbGamutMapping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PreparedRgbGamutMapping {
  colorSpace: RgbColorSpaceId;
  kneeFraction: number;
  /** Maps one XYZ colour (D65-relative, white Y = 1). */
  map(xyz: ColorVector3): GamutMappedColor;
}
```

## prepareRgbGamutMapping

Validates the target space once and returns a reusable per-colour mapper.

```ts
export function prepareRgbGamutMapping(input: PrepareRgbGamutMappingInput): PreparedRgbGamutMapping;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PrepareRgbGamutMappingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrepareRgbGamutMappingInput {
  colorSpace: RgbColorSpaceId;
  method: GamutMappingMethod;
  /** Fraction of the boundary chroma left untouched, in [0, 1]. 1 means clip to the boundary. */
  kneeFraction: number;
}
```
