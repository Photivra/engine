# output/developed-lens-corrections.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM

Effective wavelengths of the red, green and blue channels for the lateral-colour map, nm: a generic approximation of where
a camera's channel responses peak, not a measured camera.

```ts
GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM: Readonly<Record<LensCorrectionChannel, number>> = Object.freeze({ red: 610, green: 540, blue: 465 })
```
