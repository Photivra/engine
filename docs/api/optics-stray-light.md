# optics/stray-light.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLensStrayLightIrradiance

Adds off-path spectral irradiance before the sensor integrates the exposure, never after tone mapping.
Source powers are integrated over profile.referenceEntranceAreaMm2 at this instant and wavelength.
The Gaussian templates are independently parameterized approximations, not ray tracing through a
lens prescription.

```ts
export function calculateLensStrayLightIrradiance(input: {
  profile: LensStrayLightProfile; state: OpticalProfileState; enabled: boolean;
  imagePointMm: LensFieldPointMm; wavelengthNm: number; wavelengthBasis: "air" | "vacuum";
  timeSeconds: number; primarySpectralIrradianceWPerM2PerNm: number;
  sources: readonly StrayLightSource[]; meterDomain: "primary-only" | "primary-plus-stray";
}): CalculationResult<StrayLightIrradiance>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## LensStrayLightProfile

One explicit wavelength and an exact generic camera state. Models clean optics only.

```ts
export interface LensStrayLightProfile {
  schemaVersion: "0.1.0";
  id: string;
  version: string;
  state: OpticalProfileState;
  evidence: GenericOpticalEvidence;
  interaction: "lens-reflections" | "sensor-lens-reflections";
  wavelengthNm: number;
  wavelengthBasis: "air" | "vacuum";
  maximumSourceAngleDegrees: number;
  /** Area over which the caller's incident source power was integrated. */
  referenceEntranceAreaMm2: number;
  responses: readonly ParametricStrayLightResponse[];
}
```

## ParametricStrayLightResponse

One ghost (reflection path) or veil (broad scatter) response. Its shape is normalized over the infinite image plane.

```ts
export interface ParametricStrayLightResponse {
  id: string;
  kind: "ghost" | "veil";
  /** Centroid response in mm per degree of the two declared source field angles. */
  centroidMmPerDegree: readonly [number, number, number, number];
  offsetMm: LensFieldPointMm;
  sigmaMm: number;
  /** Fraction of source power entering this response at the axis. */
  axisPowerFraction: number;
  /** Power fraction versus angle: F(rho) = F(0) * (1 + slope * rho²), where rho = source angle / maximum angle. */
  angularSlope: number;
}
```

## parseLensStrayLightProfile

Strict generic profile parser. Checks that the profile adds no energy at any source angle in its range.

```ts
export function parseLensStrayLightProfile(value: unknown): LensStrayLightProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## StrayLightIrradiance

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StrayLightIrradiance {
  profileId: string;
  profileVersion: string;
  interaction: LensStrayLightProfile["interaction"];
  imagePointMm: LensFieldPointMm;
  wavelengthNm: number;
  wavelengthBasis: "air" | "vacuum";
  timeSeconds: number;
  primarySpectralIrradianceWPerM2PerNm: number;
  ghostSpectralIrradianceWPerM2PerNm: number;
  veilSpectralIrradianceWPerM2PerNm: number;
  totalSpectralIrradianceWPerM2PerNm: number;
  /** If primary-only, the meter leaves these additions out. The sensor always receives the total. */
  meterDomain: "primary-only" | "primary-plus-stray";
  meterSpectralIrradianceWPerM2PerNm: number;
  contributions: readonly { sourceId: string; responseId: string; kind: "ghost" | "veil"; spectralIrradianceWPerM2PerNm: number }[];
}
```

## StrayLightSource

The direction can lie outside the active frame. It is not clipped to the crop.

```ts
export interface StrayLightSource {
  id: string;
  fieldAngleXDegrees: number;
  fieldAngleYDegrees: number;
  incidentSpectralPowerWPerNm: number;
  /** Fraction of this source let in, for example after a flag or hood decision. Not a global hood factor. */
  admittedFraction: number;
}
```
