# output/generic-lens-corrections.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateChannelEffectiveDispersion

#589: each channel's effective dispersion for the catalogue lenses' lateral colour, D̄_c = Σ w·D(λ) / Σ w with
w = response_c(λ)·illuminant(λ) at the nodes and D the normalised Cauchy dispersion (`genericLensDispersion`: 0 at the
Fraunhofer d line, F minus C = 1). Under lateral colour L·r·D(λ) a neutral surface's image in channel c moves by L·r·D̄_c, so
blue minus red is L·r·(D̄_blue − D̄_red). Pass the result as `channelDispersion` to `createGenericLensCorrectionProfile`.
`simulateCapture`'s `output.lensCorrections` computes it from the capture's own channels and reports it in its assumption.
An approximation: a weighted mean over a neutral surface; a colored surface weights the band differently.

```ts
export function calculateChannelEffectiveDispersion(input: CalculateChannelEffectiveDispersionInput): CalculationResult<ChannelDispersion>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateChannelEffectiveDispersionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateChannelEffectiveDispersionInput {
  /** Spectral nodes, nm, strictly increasing, within 300–1100 nm. */
  wavelengthsNm: readonly number[];
  /** Each channel's response at the nodes (any common linear unit, ≥ 0; for example electrons per unit spectral radiance). */
  channelResponse: { red: readonly number[]; green: readonly number[]; blue: readonly number[] };
  /** The illuminant's relative spectral power at the nodes (≥ 0; the scale cancels). */
  illuminant: readonly number[];
}
```

## createGenericLensCorrectionProfile

Builds the catalogue lens's generic correction profile for one camera state: a radial distortion map (the lens's own
r_d = r(1 + k1ρ²), read at each ideal destination point), per-channel lateral-colour scales 1 + L·D̄_channel (`channelDispersion`,
by default D at the generic channel wavelengths), and the relative-illumination gain at the state's aperture (strength 1). From
profile version 1.1.0 (#584) the vignetting component (version 1.1.0) carries the distortion's area factor
(`distortionAreaFactor`): its gain is det J(ρ_i)/E(ρ_s) at the capture's sensor point, so it flattens a flat-field capture. The
result passes `parseGenericLensCorrectionProfile`.

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
  /**
   * #589: each channel's effective dispersion (`calculateChannelEffectiveDispersion` for the camera's channels and the light).
   * Default: D at {@link GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM} (610, 540 and 465 nm), a generic approximation.
   */
  channelDispersion?: ChannelDispersion;
}
```
