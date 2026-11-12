# color/rgb-color-spaces.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## Bt1886Eotf

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface Bt1886Eotf {
  whiteLuminanceCdPerSquareMeter: number;
  blackLuminanceCdPerSquareMeter: number;
  /** a = (Lw^(1/γ) − Lb^(1/γ))^γ */
  a: number;
  /** b = Lb^(1/γ) / (Lw^(1/γ) − Lb^(1/γ)) */
  b: number;
  /** L = a · max(V + b, 0)^2.4 in cd/m². */
  decode(signal: number): number;
  /** Inverse: V = (L/a)^(1/2.4) − b. */
  encode(luminanceCdPerSquareMeter: number): number;
}
```

## calculateRgbToXyzMatrices

Derives RGB ↔ XYZ matrices from primaries and white chromaticity: columns are the primaries'
XYZ (Y = 1) scaled so that RGB (1, 1, 1) maps to the white (W3C CSS Color 4, free; also SMPTE
RP 177). The derivation is written out in docs/COLORIMETRY.md.

```ts
export function calculateRgbToXyzMatrices(input: { primaries: RgbPrimaryChromaticities; whiteChromaticity: CieXyChromaticity }): CalculationResult<RgbToXyzMatrices>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## evaluateBt709InverseOetf

Inverse of the BT.709 OETF: L = V/4.5 for V < 0.081, otherwise ((V + 0.099)/1.099)^(1/0.45).

```ts
export function evaluateBt709InverseOetf(encoded: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## evaluateBt709Oetf

ITU-R BT.709-6 / BT.2020-2 (10-bit) OETF: V = 4.5 L for L < 0.018, otherwise
1.099 L^0.45 − 0.099. Scene-referred camera encoding, not a display EOTF.

```ts
export function evaluateBt709Oetf(sceneLinear: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## evaluateSrgbDecoding

sRGB / Display P3 decoding of one non-linear component.

```ts
export function evaluateSrgbDecoding(encoded: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## evaluateSrgbEncoding

sRGB / Display P3 encoding (W3C CSS Color 4; also IEC 61966-2-1) of one linear component; negative values use the linear segment.

```ts
export function evaluateSrgbEncoding(linear: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## prepareBt1886Eotf

Prepares the ITU-R BT.1886 reference EOTF (γ = 2.4) for a display's white and black luminance.

```ts
export function prepareBt1886Eotf(input: { whiteLuminanceCdPerSquareMeter: number; blackLuminanceCdPerSquareMeter: number }): Bt1886Eotf;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveRgbColorSpace

Resolves a named RGB colour space with numerically derived matrices (all D65).

```ts
export function resolveRgbColorSpace(id: RgbColorSpaceId): CalculationResult<RgbColorSpaceDefinition>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RgbColorSpaceDefinition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RgbColorSpaceDefinition extends RgbToXyzMatrices {
  id: RgbColorSpaceId;
  primaries: RgbPrimaryChromaticities;
  whiteChromaticity: CieXyChromaticity;
  /** Conventional non-linear (SDR) encoding of this space. */
  transferFunction: RgbTransferFunctionId;
  sources: readonly string[];
}
```

## RgbColorSpaceId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RgbColorSpaceId = "srgb" | "display-p3" | "rec709" | "rec2020";
```

## RgbPrimaryChromaticities

RGB primaries as CIE 1931 xy chromaticities.

```ts
export interface RgbPrimaryChromaticities {
  red: CieXyChromaticity;
  green: CieXyChromaticity;
  blue: CieXyChromaticity;
}
```

## RgbToXyzMatrices

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RgbToXyzMatrices {
  /** Linear RGB (white = 1, 1, 1) → XYZ with white Y = 1. */
  rgbToXyz: ColorMatrix3x3;
  xyzToRgb: ColorMatrix3x3;
  whiteXyz: CieXyzTristimulus;
}
```

## RgbTransferFunctionId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RgbTransferFunctionId = "srgb" | "bt709-oetf-bt1886-eotf" | "bt2020-oetf";
```
