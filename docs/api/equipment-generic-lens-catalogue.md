# equipment/generic-lens-catalogue.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_LENS_CATALOGUE

The 30 lenses: 17 professional, then 13 consumer, each set by focal length.

```ts
GENERIC_LENS_CATALOGUE: readonly GenericLensCatalogueEntry[] = Object.freeze([...PRO.map((row) => entry("professional", row)),
  ...CONSUMER.map((row) => entry("consumer", row))])
```

## GENERIC_LENS_IDS

The catalogue ids, in catalogue order.

```ts
GENERIC_LENS_IDS: readonly string[] = Object.freeze(GENERIC_LENS_CATALOGUE.map((lens) => lens.lensId))
```

## GENERIC_LENS_SET_BASELINES

The set baselines (owner's table, #549), each lens's starting point before its adjustments.

```ts
GENERIC_LENS_SET_BASELINES: Readonly<Record<GenericLensSet, Readonly<GenericLensCharacterValues>>> = Object.freeze({
  professional: Object.freeze({ sphericalWaves: 0.25, comaWaves: 0.35, astigmatismWaves: 0.3, fieldCurvatureWaves: 0.15, axialColorWaves: 0.15,
    lateralColorFraction: 0.00008, distortionMagnitude: 0.01, naturalVignettingStops: 0.4, opticalVignettingStops: 0.6, veilingGlareFraction: 0.005, ghostFraction: 0.002,
    breathingFraction: -0.03, focusScatterDepthOfFocusFraction: 0.1, closeFocusFactor: 0.15 }),
  consumer: Object.freeze({ sphericalWaves: 0.5, comaWaves: 1.0, astigmatismWaves: 0.8, fieldCurvatureWaves: 0.45, axialColorWaves: 0.4,
    lateralColorFraction: 0.0003, distortionMagnitude: 0.03, naturalVignettingStops: 0.7, opticalVignettingStops: 1.1, veilingGlareFraction: 0.02, ghostFraction: 0.008,
    breathingFraction: -0.08, focusScatterDepthOfFocusFraction: 0.3, closeFocusFactor: 0.5 })
})
```

## GenericLensAdjustments

Per-lens multipliers of the set baseline (missing: 1). `distortion` is signed and required: −1 barrel, +1 pincushion at the baseline.

```ts
export type GenericLensAdjustments = { distortion: number } & Partial<Record<"spherical" | "coma" | "astigmatism" | "fieldCurvature" | "axialColor" | "lateralColor" |
  "vignetting" | "strayLight" | "breathing" | "focusScatter" | "closeFocus", number>>;
```

## GenericLensCatalogueEntry

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericLensCatalogueEntry {
  /** Catalogue id, for example "pv-50-1.2-pro". */
  lensId: string;
  /** Display name, for example "PV 50 1.2 Pro". */
  name: string;
  set: GenericLensSet;
  kind: GenericLensKind;
  /** Full-frame-equivalent focal length (36 × 24 mm reference). */
  equivalentFocalLengthMm: number;
  widestFNumber: number;
  narrowestFNumber: number;
  /** Largest magnification: 0.15 (the generic rule) or 1 for the professional macro. */
  maximumMagnification: number;
  projection: LensProjectionModel;
  /** Fisheyes only: a circular image inside the frame, or one that fills it. */
  fisheyeImage?: "circular" | "full-frame";
  adjustments: Readonly<GenericLensAdjustments>;
  /** Why this lens departs from its set's baseline. */
  note: string;
  /**
   * A short plain-English summary of the lens's character (at most 40 characters, US spelling), written from its adjustments and
   * `note`, for lists and pickers. It describes only what the catalogue models (bokeh shape is not modeled: the defocus is a disc).
   */
  summary: string;
}
```

## GenericLensCharacter

A catalogue lens's character resolved for a sensor, an f-number and a focus distance. Aberrations in waves at 550 nm.

```ts
export interface GenericLensCharacter {
  fNumber: number;
  focusDistanceM: number | null;
  /** Thin-lens magnification at the focus distance (0 at infinity). */
  magnification: number;
  /** 1 + c·m/m_max. */
  closeFocusGain: number;
  /** Pupil-radius ratio N0/N. */
  pupilScale: number;
  /** Resolved Seidel coefficients at the frame corner (H = 1), waves at 550 nm; `balancingDefocusWaves` = −spherical. */
  aberrations: { sphericalWaves: number; balancingDefocusWaves: number; comaWaves: number; astigmatismWaves: number; fieldCurvatureWaves: number; axialColorWaves: number };
  /** Lateral colour: F-to-C image-radius difference at the corner, fraction of the half-diagonal and micrometres on this sensor. */
  lateralColor: { fraction: number; cornerMicrometers: number };
  /** Radial distortion profile (normalised to the half-diagonal, valid to 1.25 of it, beyond the corner) and its corner value (fraction; negative = barrel). */
  distortion: { profile: RadialDistortionProfile; corner: number };
  /** Relative illumination profile (normalised to the half-diagonal, valid to 1.25 of it) and the corner fall-off in stops. */
  vignetting: { profile: IlluminationVignettingProfile; cornerStops: number };
  strayLight: { veilingGlareFraction: number; ghostFraction: number };
  /** Field-of-view change at this focus and at minimum focus, beyond thin-lens unit focusing (fraction, negative = narrower). */
  breathing: { fieldOfViewChange: number; atMinimumFocus: number };
  /** Standard deviation of the autofocus error as a fraction of the depth of focus 2·N·c. */
  focusScatterDepthOfFocusFraction: number;
}
```

## GenericLensCharacterValues

The character of a set, at each lens's widest aperture. Aberrations are in waves at 550 nm at the frame corner.

```ts
export interface GenericLensCharacterValues {
  /** Spherical aberration W040 (balanced by W020 = −W040): centre sharpness. */
  sphericalWaves: number;
  /** Coma W131 at H = 1: the comet-shaped point images of night photography. */
  comaWaves: number;
  /** Astigmatism W222 at H = 1: edge and corner sharpness. */
  astigmatismWaves: number;
  /** Field curvature W220 at H = 1: edge and corner sharpness. */
  fieldCurvatureWaves: number;
  /** Axial colour: the F-to-C difference of the defocus W020, waves at 550 nm. */
  axialColorWaves: number;
  /** Lateral colour: the F-to-C difference of the image radius at the corner, as a fraction of the half-diagonal. */
  lateralColorFraction: number;
  /** Corner distortion magnitude |k1| (fraction); each lens gives the sign (barrel −, pincushion +). */
  distortionMagnitude: number;
  /** Corner fall-off in stops that stays when stopped down (natural vignetting). */
  naturalVignettingStops: number;
  /** Extra corner fall-off in stops at the widest aperture (optical vignetting); gone two stops down. */
  opticalVignettingStops: number;
  /** Veiling glare: the fraction of the image's mean irradiance spread as a uniform veil. */
  veilingGlareFraction: number;
  /** Peak ghost power as a fraction of a bright source's power on the axis. */
  ghostFraction: number;
  /** Field-of-view change between infinity and minimum focus as a fraction (negative: narrower), beyond thin-lens unit focusing. */
  breathingFraction: number;
  /** Standard deviation of the autofocus error as a fraction of the depth of focus 2·N·c. */
  focusScatterDepthOfFocusFraction: number;
  /** c in the close-focus factor 1 + c·m/m_max. */
  closeFocusFactor: number;
}
```

## GenericLensFocusError

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GenericLensFocusError {
  lensId: string;
  /** The intended and the sampled focus distance, m (the sampled one held within minimum focus and a far limit). */
  intendedFocusDistanceM: number;
  focusDistanceM: number;
  /** The standard normal draw z and the image-side focus error z·σ·2Nc, µm (positive: a longer image distance, so focused nearer). */
  standardNormal: number;
  imageSideErrorMicrometers: number;
  /** σ (fraction of the depth of focus) and the depth of focus 2·N·c, µm. */
  depthOfFocusFraction: number;
  depthOfFocusMicrometers: number;
  /** True when the sampled image distance was held at the minimum-focus or the far (1000 m) limit. */
  held: "minimum-focus" | "far-limit" | null;
  scientificStatus: "approximation";
}
```

## GenericLensKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericLensKind = "standard" | "macro" | "fisheye";
```

## GenericLensSet

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type GenericLensSet = "professional" | "consumer";
```

## ResolvedGenericLens

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedGenericLens {
  lensId: string;
  name: string;
  set: GenericLensSet;
  kind: GenericLensKind;
  equivalentFocalLengthMm: number;
  /** Physical focal length on this sensor: equivalent ÷ crop factor. */
  focalLengthMm: number;
  cropFactor35Mm: number;
  /** Half-diagonal of the sensor, mm: field height H = 1 and ρ = 1 of the profiles. */
  halfDiagonalMm: number;
  widestFNumber: number;
  narrowestFNumber: number;
  /** Marked third-stop f-numbers within the range. */
  fNumbers: readonly number[];
  /** max(0.10 m, f·(1 + 1/m_max)), metres from the lens (thin lens). */
  minimumFocusDistanceM: number;
  maximumMagnification: number;
  projection: LensProjectionModel;
  fisheyeImage: "circular" | "full-frame" | null;
  /** Fisheyes: the radius of the 180° image circle on this sensor, 2·f·sin 45° (equisolid), mm. Null otherwise. */
  imageCircleRadiusMm: number | null;
  character: GenericLensCharacter;
  note: string;
  /** The catalogue entry's `summary`: a short plain-English description of the lens's character (at most 40 characters). */
  summary: string;
  evidence: readonly EvidenceProvenance[];
  scientificStatus: "approximation";
  limitations: readonly string[];
}
```

## resolveGenericLens

Resolves a catalogue lens for a sensor: its focal length (equivalent ÷ the diagonal crop factor), f-number range, close focus
and projection, and its character (aberrations, colour, distortion, vignetting, flare, breathing and focus scatter) at the
given f-number and focus distance. Every value is a labelled approximation of a generic lens, not a measured product.

```ts
export function resolveGenericLens(input: ResolveGenericLensInput): ResolvedGenericLens;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveGenericLensInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveGenericLensInput {
  /** A catalogue id (`GENERIC_LENS_IDS`). */
  lensId: string;
  /** The sensor's active capture area, mm. */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** Default: the widest aperture. Must lie in the lens's range. */
  fNumber?: number;
  /** Default: infinity. At least the minimum focus distance. */
  focusDistanceM?: number;
}
```

## simulateGenericLensFocusError

Focus consistency (#549): a seeded, reproducible autofocus error for one shot. The image-side error is z·σ·2Nc, with z a
standard normal draw from (seed, shotIndex) (MurmurHash3 stream seed, xorshift32 and Box–Muller, the generators of the
capture's sensor noise), σ the lens's focus scatter as a fraction of the depth of focus 2·N·c, and
c the circle of confusion. The thin-lens image distance of the intended focus moves by that error and the focus distance is
read back from it. An approximation of autofocus variation; off unless called (or `simulateCapture`'s `lens.focusScatter`).

```ts
export function simulateGenericLensFocusError(input: SimulateGenericLensFocusErrorInput): GenericLensFocusError;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SimulateGenericLensFocusErrorInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SimulateGenericLensFocusErrorInput {
  lensId: string;
  activeImagingArea: { widthMm: number; heightMm: number };
  fNumber: number;
  /** The intended focus distance, m. */
  focusDistanceM: number;
  /** uint32 seed of the shooting session. */
  seed: number;
  /** uint32 index of the shot in the session. Default 0. */
  shotIndex?: number;
  /** Circle of confusion for the depth of focus, mm. Default: the sensor diagonal / 1500. */
  circleOfConfusionMm?: number;
}
```
