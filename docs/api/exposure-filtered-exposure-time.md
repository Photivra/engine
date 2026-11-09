# exposure/filtered-exposure-time.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFilteredExposureTime

Shutter time that keeps the same exposure after adding front-of-lens filters, such as a
neutral-density (ND) filter: t / T, with T the combined transmittance of the filter profiles.
Aperture and ISO are unchanged.

Exact under the linear sensor model (exposure H = E·t); film reciprocity failure is not modelled.
Nominal filters vary: a "10-stop" or ND1000 (OD 3.0, 9.97 stops) filter transmits roughly, not
exactly, its rating, so the result is only as good as the profile. The envelope is an
approximation whenever any profile's `scientificStatus` is `"approximation"`.

Example: 1/125 s with `GENERIC_ND_FILTER_PROFILES[10]` (exactly 2^-10) gives 1024/125 = 8.192 s;
on a third-stop dial, 8 s.

```ts
export function calculateFilteredExposureTime(
  input: CalculateFilteredExposureTimeInput
): CalculationResult<FilteredExposureTime>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFilteredExposureTimeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFilteredExposureTimeInput {
  /** Shutter time without the filter, in seconds. */
  shutterSeconds: number;
  /**
   * One front-of-lens filter profile, or several in light-path order (scene side first), as
   * accepted by `composeFrontOfLensFilterTransmission`.
   */
  filter: FrontOfLensFilterProfile | readonly FrontOfLensFilterProfile[];
  /**
   * Optional shutter dial, in seconds (for example `GENERIC_THIRD_STOP_SHUTTER_SECONDS`). When
   * given, the result also reports the nearest dial value (nearest in stops, the shorter on a tie).
   */
  shutterDialSeconds?: readonly number[];
  /** Wavelength at which the filters are resolved. Defaults to 550 nm. Neutral filters do not depend on it. */
  wavelengthNanometers?: number;
  /** Wavelength basis; defaults to the first filter profile's basis and must match every profile. */
  wavelengthBasis?: Exclude<SpectralWavelengthBasis, "unspecified">;
  /** Incident polarization, which matters only when a polarizer is in the stack. Omitted means unpolarized. */
  incidentPolarization?: LinearPolarizationState;
}
```

## FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS

Wavelength used when the caller gives none: 550 nm, near the photopic peak. Neutral filters do not depend on it.

```ts
FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS = 550 as const
```

## FilteredExposureDialSetting

The dial value nearest the exact filtered shutter time.

```ts
export interface FilteredExposureDialSetting {
  /** Nearest dial value in seconds. */
  shutterSeconds: number;
  /**
   * log2(dial / exact filtered time): exposure of the dial setting relative to the unfiltered
   * exposure, in stops. Positive is brighter (longer), negative darker.
   */
  exposureErrorStops: number;
  /** `"maximum"` when the exact time is longer than every dial value (use bulb for the exact time), `"minimum"` when shorter than every one. */
  clamped: false | "minimum" | "maximum";
  /** How the dial value was chosen. */
  quantizationPolicy: "nearest-log2-shorter-on-tie";
}
```

## FilteredExposureTime

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FilteredExposureTime {
  /** Shutter time without the filter, in seconds. */
  shutterSeconds: number;
  /** Shutter time that gives the same exposure with the filter: shutterSeconds / linearTransmissionFactor. */
  filteredShutterSeconds: number;
  /** Combined intensity transmittance T of the filter stack, in (0, 1]. */
  linearTransmissionFactor: number;
  /** Combined attenuation −log2 T, in stops. */
  attenuationStops: number;
  /** Shutter multiplier 1/T = 2^attenuationStops. */
  exposureFactor: number;
  /** Wavelength at which the filters were resolved, in nanometres. */
  wavelengthNanometers: number;
  /** The filter-stack transmission this result is based on, with each filter's identity and evidence. */
  filterTransmission: ComposedFrontOfLensFilterTransmission;
  /** Nearest shutter-dial value; present only when `shutterDialSeconds` was given. */
  dial?: FilteredExposureDialSetting;
}
```
