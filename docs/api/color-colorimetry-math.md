# color/colorimetry-math.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## Cie1960UvChromaticity

CIE 1960 UCS (u, v) chromaticity coordinates (dimensionless).

```ts
export interface Cie1960UvChromaticity {
  u: number;
  v: number;
}
```

## CieXyChromaticity

CIE 1931 (x, y) chromaticity coordinates (dimensionless).

```ts
export interface CieXyChromaticity {
  x: number;
  y: number;
}
```

## CieXyzTristimulus

Relative CIE XYZ tristimulus values. Units are relative (dimensionless);
a normalized white has `y = 1` unless a function documents another scale.

```ts
export interface CieXyzTristimulus {
  x: number;
  y: number;
  z: number;
}
```

## ColorMatrix3x3

Row-major 3×3 matrix; `m[row][column]`. Applied as `m · v` to column vectors.

```ts
export type ColorMatrix3x3 = readonly [ColorVector3, ColorVector3, ColorVector3];
```

## ColorVector3

Three-component vector (dimensionless unless documented otherwise).

```ts
export type ColorVector3 = readonly [number, number, number];
```
