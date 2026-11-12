# optics/diffraction-psf-profile.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createDiffractionLimitedPsfProfile

Creates a sampled lens PSF profile for an ideal diffraction-limited lens with a circular pupil: one
unit-sum Airy kernel per wavelength on one shared (2R+1)² grid, with the truncated energy reported per
wavelength. The profile declares the given focal length, f-number and focus exactly, and the field axes
±`fieldHalfExtentMm` with the same kernel at every field node.

```ts
export function createDiffractionLimitedPsfProfile(input: CreateDiffractionLimitedPsfProfileInput): CalculationResult<DiffractionLimitedPsfProfile>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateDiffractionLimitedPsfProfileInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateDiffractionLimitedPsfProfileInput {
  /** Only `circular` in 2.1.0 (polygon pupils: `calculateIdealPolygonDiffractionPsf` gives point densities). */
  aperture: "circular";
  focalLengthMm: number;
  apertureFNumber: number;
  focus: FocusPlane;
  /** Strictly increasing wavelengths, nm, in the medium of propagation (no air/vacuum conversion is applied). 1–400. */
  wavelengthsNm: readonly number[];
  /** Square sample pitch of every kernel, µm. */
  samplePitchMicrometers: number;
  /** Kernel half-width in samples; each kernel is (2R + 1)². 0–32. */
  kernelRadiusSamples: number;
  /** Half-extent of the image field over which the on-axis PSF is declared (profile field axes ±x, ±y), mm. */
  fieldHalfExtentMm: { x: number; y: number };
  profileId: string;
}
```

## DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS

Input limits: at most 400 wavelengths, kernel radius 0–32 samples (the irradiance-convolution limit). 400 is the finest spectral
sampling of `simulateCapture` and the display view (`sensor.spectralStepNanometers` 1 nm over 380–780 nm), so `lens.diffraction`
builds one exact kernel per spectral node at every allowed step; it was 64 before 2.15.0, which refused every step under 6.25 nm.
The work and memory are linear in the count (measured in docs/PSF_FOUNDATION.md, "Spectral nodes").

```ts
DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS = Object.freeze({ maximumWavelengths: 400, maximumKernelRadiusSamples: 32 })
```

## DIFFRACTION_LIMITED_PSF_PROFILE_MODEL

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
DIFFRACTION_LIMITED_PSF_PROFILE_MODEL = Object.freeze({
  modelId: "photivra-diffraction-limited-circular-pupil-psf" as const, modelVersion: "1.0.0" as const })
```

## DiffractionLimitedPsfProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DiffractionLimitedPsfProfile {
  profile: LensSampledPsfProfile;
  model: typeof DIFFRACTION_LIMITED_PSF_PROFILE_MODEL;
  pupilDiameterMm: number;
  pupilToImageDistanceMm: number;
  workingFNumber: number;
  kernelRadiusSamples: number;
  samplePitchMicrometers: number;
  wavelengths: readonly DiffractionLimitedPsfWavelength[];
  /** Largest truncated energy over the wavelengths. */
  maximumTruncatedEnergyFraction: number;
  /**
   * How the cells were integrated. 2.5: wavelengths with β = p·f_c ≥ `AIRY_REAL_SPACE_MINIMUM_BETA` (192 in 2.5–2.8.1, then 32) use the real-space
   * encircled-energy method; `realSpaceWavelengthsNm` lists them, and `method` is `"frequency-domain-and-real-space"` when both ran.
   * `maximumRadialNodes` counts frequency-domain radial nodes (0 when only the real-space method ran); `maximumAngularNodes` the
   * angular nodes of either method (for the real-space method, all θ nodes of one wavelength).
   */
  quadrature: { method: "polar-frequency-domain-trapezoid-gauss-legendre" | "real-space-encircled-energy-gauss-legendre" | "frequency-domain-and-real-space";
    maximumRadialNodes: number; maximumAngularNodes: number; realSpaceWavelengthsNm?: readonly number[] };
}
```

## DiffractionLimitedPsfWavelength

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DiffractionLimitedPsfWavelength {
  wavelengthNm: number;
  /** f_c = 1/(λ·N_w), cycles per µm. */
  cutoffFrequencyCyclesPerMicrometer: number;
  /** 1.21967·λ·N_w, µm. */
  firstZeroRadiusMicrometers: number;
  /** Σ of the cell energies inside the window before renormalization (of a total of 1). */
  capturedEnergyFraction: number;
  /** 1 − capturedEnergyFraction: the Airy tail energy outside the window, put back by renormalization. */
  truncatedEnergyFraction: number;
  /** Fraction of the renormalized kernel in the centre sample. */
  centreSampleFraction: number;
}
```
