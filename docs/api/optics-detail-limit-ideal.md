# optics/detail-limit-ideal.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateIdealLensDetailLimit

`calculateDetailLimit` for an ideal lens (`lens.kind: "ideal"`, diffraction and defocus only), from 2.29.0 (#765): the same
checks and the same result, in a module without the lens catalogue, so a bundle that needs only ideal lenses stays small.
A catalogue lens is refused; use `calculateDetailLimit` for it.

```ts
export function calculateIdealLensDetailLimit(input: CalculateIdealLensDetailLimitInput): CalculationResult<DetailLimit>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateIdealLensDetailLimitInput

The input of {@link calculateIdealLensDetailLimit}: that of `calculateDetailLimit` with an ideal lens.

```ts
export type CalculateIdealLensDetailLimitInput = Omit<CalculateDetailLimitInput, "lens"> & { lens: DetailLimitIdealLens };
```

## DETAIL_LIMIT_LIMITS

Limits of `calculateDetailLimit`: the wavelength range and the largest wavefront (sum of the magnitudes of its terms, in
waves) whose transfer function is integrated. Beyond it the blur is geometric and the quadrature would grow without
bound; use `calculateDefocusCircle` for such a blur.

```ts
DETAIL_LIMIT_LIMITS = Object.freeze({ minimumWavelengthNm: 380, maximumWavelengthNm: 780, maximumWavefrontWaves: 64 })
```
