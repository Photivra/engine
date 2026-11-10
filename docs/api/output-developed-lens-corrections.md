# output/developed-lens-corrections.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ChannelDispersion

A normalized dispersion per channel (`genericLensDispersion` units: 0 at the d line, F minus C = 1).

```ts
export type ChannelDispersion = Readonly<Record<LensCorrectionChannel, number>>;
```

## GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM

Effective wavelengths of the red, green and blue channels for the lateral-colour map, nm: a generic approximation of where
a camera's channel responses peak, not a measured camera. The default of `createGenericLensCorrectionProfile` without a
`channelDispersion`; `simulateCapture`'s `output.lensCorrections` uses the capture's own channels instead (#589).

```ts
GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM: Readonly<Record<LensCorrectionChannel, number>> = Object.freeze({ red: 610, green: 540, blue: 465 })
```
