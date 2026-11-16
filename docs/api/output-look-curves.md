# output/look-curves.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## FLAT_LOOK

Photivra's Flat look: contrast 1, white at 32; 18 % linear gray stays at 0.18.

```ts
FLAT_LOOK: NakaRushtonLook = Object.freeze({ toneCurve: "naka-rushton-luminance" as const,
  toneCurveParameters: Object.freeze({ exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 }) })
```

## NakaRushtonLook

A look: the `naka-rushton-luminance` tone curve with its parameters, ready to spread into a rendering or `output` options.

```ts
export interface NakaRushtonLook {
  readonly toneCurve: "naka-rushton-luminance";
  readonly toneCurveParameters: { readonly exponent: number; readonly semiSaturation: number; readonly whiteLuminance: number };
}
```

## PinLookMidGrayOptions

Where to pin the look's mid-gray.

```ts
export interface PinLookMidGrayOptions {
  /** The linear relative luminance at which the application's exposure develops a mid-gray (18 %) chart, for example 0.13. */
  linearMidGray: number;
  /** The tone-mapped linear level that mid-gray should come out at; default `linearMidGray` (the same as a linear look). */
  outputLevel?: number;
}
```

## resolveMidGrayPinnedLook

Derives a look whose tone curve maps `linearMidGray` to `outputLevel` (default: to itself), keeping its contrast and white
luminance and solving its semi-saturation in closed form (module comment). `resolveMidGrayPinnedLook(STANDARD_LOOK, { linearMidGray: 0.18 })`
gives the Standard look's own σ to within its four published decimals.

```ts
export function resolveMidGrayPinnedLook(look: NakaRushtonLook, options: PinLookMidGrayOptions): NakaRushtonLook;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## STANDARD_LOOK

Photivra's Standard look: contrast 1.5, white at 8× mid-gray luminance; 18 % linear gray stays at 0.18.

```ts
STANDARD_LOOK: NakaRushtonLook = Object.freeze({ toneCurve: "naka-rushton-luminance" as const,
  toneCurveParameters: Object.freeze({ exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 }) })
```
