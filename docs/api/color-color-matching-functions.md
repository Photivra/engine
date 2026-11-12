# color/color-matching-functions.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS

Wavelength domain over which the analytic CIE 1931 fit is accepted (the domain it was fitted on).

```ts
ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS: Readonly<SpectralWavelengthRangeNanometers> = Object.freeze({ minimum: 360, maximum: 830 })
```

## ColorimetricObserver

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ColorimetricObserver = "cie-1931-2-degree" | "cie-1964-10-degree" | "caller-defined";
```

## ColorimetricQuadratureNode

One wavelength quadrature node; d-lambda is in nanometres.

```ts
export interface ColorimetricQuadratureNode {
  wavelengthNanometers: number;
  wavelengthMeasureNanometers: number;
}
```

## ColorimetricSpectralSample

One tabulated spectral value at one wavelength.

```ts
export interface ColorimetricSpectralSample extends SpectralWavelengthSample {
  value: number;
}
```

## ColorimetricSpectrum

A spectral distribution or spectral factor (reflectance, transmittance, relative SPD,
sensitivity).
- `tabulated` is the JSON form: strictly increasing wavelengths, linear interpolation, and an
  error (fail closed) outside the table.
- `function` is an in-process evaluator (for example a Planckian SPD). It must be finite over
  its declared range.

```ts
export type ColorimetricSpectrum =
  | { kind: "tabulated"; samples: readonly ColorimetricSpectralSample[] }
  | { kind: "function"; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers; evaluate: (wavelengthNanometers: number) => number };
```

## COLORIMETRY_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
COLORIMETRY_MODEL_VERSION = "2.0.0" as const
```

## ColorMatchingFunctionsSource

Selects a colour-matching-function source.

```ts
export type ColorMatchingFunctionsSource =
  | { kind: "analytic-cie-1931-multi-lobe-fit" }
  | {
      kind: "tabulated";
      observer: ColorimetricObserver;
      /** Caller identity for the dataset (for example a DOI); recorded in provenance. */
      datasetId: string;
      samples: readonly TabulatedColorMatchingSample[];
    };
```

## createColorimetricMidpointQuadrature

Builds deterministic uniform midpoint wavelength nodes covering the range. Every
node carries its d-lambda measure in nm; the measures sum to the range width.

```ts
export function createColorimetricMidpointQuadrature(input: CreateColorimetricMidpointQuadratureInput): ColorimetricQuadratureNode[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateColorimetricMidpointQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateColorimetricMidpointQuadratureInput {
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  /** Hard upper bound on each midpoint subinterval width, nm. */
  maximumSubintervalWidthNanometers: number;
}
```

## estimateCie1931ColorMatchingFunctions

Evaluates the engine's multi-lobe analytic approximation of the CIE 1931 2° colour-matching
functions at one wavelength (nm, standard-air wavelength as in the CIE tables). Approximation:
see the module notes for the measured fit error. The values are non-negative over the domain.

```ts
export function estimateCie1931ColorMatchingFunctions(wavelengthNanometers: number): CieXyzTristimulus;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## IntegratedSpectrumXyz

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IntegratedSpectrumXyz {
  xyz: CieXyzTristimulus;
  /** Tristimulus values of S(λ) alone under the same normalization (the adopted white). */
  whiteXyz: CieXyzTristimulus;
  chromaticity: CieXyChromaticity | null;
  normalizationFactor: number;
  observer: ColorimetricObserver;
  nodeCount: number;
}
```

## integrateSpectrumToXyz

Integrates a spectrum (optionally multiplied by a reflectance/transmittance factor)
against colour-matching functions with caller-explicit quadrature (the tristimulus integral of
Wyman, Sloan & Shirley 2013, Eq. 1; also CIE 15:2018 §7).
Provenance is `approximation` for the analytic CMF fit and `calculated` for
caller-tabulated CMFs. Either way, the caller chooses the quadrature.

```ts
export function integrateSpectrumToXyz(input: IntegrateSpectrumToXyzInput): CalculationResult<IntegratedSpectrumXyz>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## IntegrateSpectrumToXyzInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IntegrateSpectrumToXyzInput {
  quadratureNodes: readonly ColorimetricQuadratureNode[];
  /** Illuminant SPD or emitted spectral radiance S(λ). */
  spectralDistribution: ColorimetricSpectrum;
  /** Optional spectral reflectance/transmittance factor R(λ); omitted means R = 1. */
  spectralFactor?: ColorimetricSpectrum;
  colorMatchingFunctions: ColorMatchingFunctionsSource;
  normalization: TristimulusNormalization;
}
```

## MAX_COLORIMETRIC_QUADRATURE_NODES

Upper bound on quadrature nodes per integration call.

```ts
MAX_COLORIMETRIC_QUADRATURE_NODES = 100_000
```

## MAX_COLORIMETRIC_TABLE_SAMPLES

Upper bound on samples in a caller-supplied tabulated spectrum or CMF table.

```ts
MAX_COLORIMETRIC_TABLE_SAMPLES = 100_000
```

## parseColorimetricQuadratureNodes

Validates explicit quadrature nodes (positive wavelengths and positive measures).

```ts
export function parseColorimetricQuadratureNodes(nodes: unknown): ColorimetricQuadratureNode[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## prepareColorimetricSpectrum

Validates a tabulated or functional spectrum (values must be finite; sign is not restricted).

```ts
export function prepareColorimetricSpectrum(spectrum: ColorimetricSpectrum, path = "spectrum"): PreparedColorimetricSpectrum;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## prepareColorMatchingFunctions

Validates a colour-matching-function source once for repeated evaluation.
Tabulated values may be signed only for `caller-defined` observers; CIE observers
require non-negative values.

```ts
export function prepareColorMatchingFunctions(source: ColorMatchingFunctionsSource): PreparedColorMatchingFunctions;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PreparedColorimetricSpectrum

A validated spectrum ready for evaluation.

```ts
export interface PreparedColorimetricSpectrum {
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  evaluate(wavelengthNanometers: number): number;
}
```

## PreparedColorMatchingFunctions

Validated, reusable colour-matching functions.

```ts
export interface PreparedColorMatchingFunctions {
  observer: ColorimetricObserver;
  sourceKind: ColorMatchingFunctionsSource["kind"];
  datasetId: string;
  scientificStatus: "approximation" | "caller-tabulated";
  wavelengthRangeNanometers: SpectralWavelengthRangeNanometers;
  /** x̄, ȳ, z̄ at one wavelength in nm; throws outside the declared range. */
  evaluate(wavelengthNanometers: number): CieXyzTristimulus;
}
```

## TabulatedColorMatchingSample

One tabulated colour-matching sample.

```ts
export interface TabulatedColorMatchingSample extends SpectralWavelengthSample {
  xBar: number;
  yBar: number;
  zBar: number;
}
```

## TristimulusNormalization

Normalization of integrated tristimulus values.
- `white-luminance-one`: k = 1 / Σ S ȳ Δλ, so the perfect reflecting diffuser (or the
  illuminant itself) has Y = 1 (relative colorimetry with Y scaled to 1; also CIE 15:2018).
- `scale`: X = factor · Σ …; for example 683.002 lm/W with spectral radiance in
  W·m⁻²·sr⁻¹·nm⁻¹ yields luminance in cd/m² (the caller owns the unit semantics).

```ts
export type TristimulusNormalization = { kind: "white-luminance-one" } | { kind: "scale"; factor: number };
```
