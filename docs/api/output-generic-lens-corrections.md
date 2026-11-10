# output/generic-lens-corrections.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createGenericLensCorrectionProfile

Builds the catalogue lens's generic correction profile for one camera state: a radial distortion map (the lens's own
r_d = r(1 + k1ρ²), read at each ideal destination point), per-channel lateral-colour scales 1 + L·D(λ_channel), and the
relative-illumination gain at the state's aperture (strength 1). From profile version 1.1.0 (#584) the vignetting component
(version 1.1.0) carries the distortion's area factor (`distortionAreaFactor`): its gain is det J(ρ_i)/E(ρ_s) at the capture's
sensor point, so it flattens a flat-field capture. The result passes `parseGenericLensCorrectionProfile`.

```ts
export function createGenericLensCorrectionProfile(input: CreateGenericLensCorrectionProfileInput): GenericLensCorrectionProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateGenericLensCorrectionProfileInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateGenericLensCorrectionProfileInput {
  /** A catalogue id (`GENERIC_LENS_IDS`); `state.lensId` must be the same id. */
  lensId: string;
  /** The sensor's active capture area, mm (the lens is scaled to it as in `resolveGenericLens`). */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** The exact camera state the profile applies to: its focal length must be the lens's on this sensor, its aperture in range. */
  state: OpticalProfileState;
}
```
