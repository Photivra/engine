# color/illuminants.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BOLTZMANN_CONSTANT_JOULES_PER_KELVIN

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
BOLTZMANN_CONSTANT_JOULES_PER_KELVIN = 1.380649e-23
```

## calculateChromaticityFromCorrelatedColorTemperature

Chromaticity for CCT and Duv: the locus point (Planckian or CIE daylight) offset by
Duv along the unit normal of the Planckian locus at the same temperature in the CIE
1960 UCS. For `cie-daylight`, Duv = 0 returns the daylight-locus point itself.
Throws InvalidScientificInputError when the offset point is not a physical chromaticity
(x ≥ 0, y > 0, x + y ≤ 1), for example 2000 K with Duv +0.02 (x + y ≈ 1.06).

```ts
export function calculateChromaticityFromCorrelatedColorTemperature(input: {
  correlatedColorTemperatureKelvin: number;
  duv: number;
  whiteLocus: WhiteLocus;
  locus: PlanckianLocusModel;
}): CalculationResult<CieXyChromaticity>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateCieDaylightComponentWeights

CIE daylight-locus chromaticity and S₁/S₂ weights for a CCT in 4000–25000 K
(CIE 15:2018 §4.1.2, paid; no free text of the formulas found). M₁, M₂ rounded to three decimals
reproduce the free CIE D55 and D65 tables (DOI 10.25039/CIE.DS.qewfb3kp, 10.25039/CIE.DS.hjfjmt59)
to their rounding; `coefficientRounding` makes that rounding explicit.
The temperature is used as given: D65's nominal 6500 K corresponds to 6504 K here.

```ts
export function calculateCieDaylightComponentWeights(input: {
  correlatedColorTemperatureKelvin: number;
  coefficientRounding: "none" | "cie-three-decimals";
}): CalculationResult<CieDaylightComponentWeights>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateCieIlluminantARelativeSpectralPower

CIE standard illuminant A relative SPD from its defining formula (100 at 560 nm),
with c₂ = 1.435e-2 m·K and T = 2848 K as in the standard (≈ 2856 K with the
current c₂). Valid 300–830 nm.

```ts
export function calculateCieIlluminantARelativeSpectralPower(wavelengthNanometers: number): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateCorrelatedColorTemperature

CCT and Duv of a chromaticity as the nearest point of the Planckian locus in the CIE
1960 UCS (Smet et al. 2023; also CIE 15:2018). Finds the root of the analytic temperature derivative
of the squared uv distance (safeguarded Newton with bisection fallback, bracketed by a cached coarse
scan in reciprocal temperature), converged until a step changes T by at most 1e-10 of T. Throws
(fails closed) when the nearest point lies beyond the model's range, or when |Duv| > 0.05 (see
{@link MAX_CORRELATED_COLOR_TEMPERATURE_DUV}). Duv is positive above the locus (toward green) and
negative below it, the engine's documented sign convention.

```ts
export function calculateCorrelatedColorTemperature(input: { chromaticity: CieXyChromaticity; locus: PlanckianLocusModel }): CalculationResult<CorrelatedColorTemperatureResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePlanckianChromaticity

Planckian chromaticity at T using either locus model.

```ts
export function calculatePlanckianChromaticity(input: { temperatureKelvin: number; locus: PlanckianLocusModel }): CalculationResult<CieXyChromaticity>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePlanckianSpectralRadiance

Planck's law for blackbody spectral radiance per unit (vacuum) wavelength:
L(λ, T) = 2hc² / λ⁵ / (exp(hc/(λkT)) − 1). Returns W·m⁻²·sr⁻¹·nm⁻¹.

```ts
export function calculatePlanckianSpectralRadiance(input: { temperatureKelvin: number; wavelengthNanometers: number }): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CIE_DAYLIGHT_LOCUS_RANGE_KELVIN

CIE daylight-locus validity, K.

```ts
CIE_DAYLIGHT_LOCUS_RANGE_KELVIN = Object.freeze({ minimum: 4000, maximum: 25000 })
```

## CIE_ILLUMINANT_A_RANGE_NANOMETERS

CIE illuminant A defining range (nm).

```ts
CIE_ILLUMINANT_A_RANGE_NANOMETERS = Object.freeze({ minimum: 300, maximum: 830 })
```

## CieDaylightBasis

Caller-supplied CIE daylight basis S₀, S₁, S₂ (tabulated; CIE dataset not bundled).

```ts
export interface CieDaylightBasis {
  s0: readonly ColorimetricSpectralSample[];
  s1: readonly ColorimetricSpectralSample[];
  s2: readonly ColorimetricSpectralSample[];
  /** Caller identity of the basis dataset (for example a DOI). */
  datasetId: string;
}
```

## CieDaylightComponentWeights

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CieDaylightComponentWeights {
  correlatedColorTemperatureKelvin: number;
  chromaticity: CieXyChromaticity;
  m1: number;
  m2: number;
  coefficientRounding: "none" | "cie-three-decimals";
}
```

## CorrelatedColorTemperatureResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CorrelatedColorTemperatureResult {
  correlatedColorTemperatureKelvin: number;
  /** Signed CIE 1960 uv distance from the locus; positive above (greenish), negative below (the engine's convention). */
  duv: number;
}
```

## createCieDaylightSpectrum

Builds a CIE D-series relative SPD S(λ) = S₀ + M₁S₁ + M₂S₂ on the S₀ wavelengths from
caller-supplied basis tables (S₁, S₂ linearly interpolated; fail closed outside range).

```ts
export function createCieDaylightSpectrum(input: {
  correlatedColorTemperatureKelvin: number;
  coefficientRounding: "none" | "cie-three-decimals";
  basis: CieDaylightBasis;
}): ColorimetricSpectrum;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createCieIlluminantASpectrum

CIE illuminant A as a function spectrum over its defining range.

```ts
export function createCieIlluminantASpectrum(): ColorimetricSpectrum;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createPlanckianSpectrum

Planckian spectral radiance (W·m⁻²·sr⁻¹·nm⁻¹) as a function spectrum over the given range.

```ts
export function createPlanckianSpectrum(input: { temperatureKelvin: number; wavelengthRangeNanometers: SpectralWavelengthRangeNanometers }): ColorimetricSpectrum;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## estimateCorrelatedColorTemperatureMcCamy

McCamy (1992) cubic estimate of CCT from CIE 1931 xy:
n = (x − 0.3320)/(0.1858 − y), CCT = 449 n³ + 3525 n² + 6823.3 n + 5520.33.
An approximation that carries no Duv. Measured for this engine (October 17, 2026) on points of a
Planckian locus integrated from the CIE 1931 2° 1 nm table (360–830 nm, exact c₂): it deviates by up
to 10 K over 2856–6504 K (largest near 3500 K), 19 K at 2000 K, 17 K at 8000 K, 118 K at 10000 K
and 442 K at 12500 K. See docs/COLORIMETRY.md.

```ts
export function estimateCorrelatedColorTemperatureMcCamy(input: { chromaticity: CieXyChromaticity }): CalculationResult<{ correlatedColorTemperatureKelvin: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## estimatePlanckianLocusChromaticity

Planckian-locus chromaticity at T (1000–100000 K): Planck's law integrated against the engine's
analytic CIE 1931 CMFs with 1 nm nodes from 360 to 830 nm. An approximation, because the CMFs are
an analytic fit; with tabulated CMFs use {@link calculatePlanckianChromaticity}.

```ts
export function estimatePlanckianLocusChromaticity(input: { temperatureKelvin: number }): CalculationResult<CieXyChromaticity>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MAX_CORRELATED_COLOR_TEMPERATURE_DUV

Engine limit: no CCT beyond |Duv| = 0.05, the range over which Smet et al. (2023, free) evaluate CCT
methods for nominally white light (CIE 15:2018 §9.5, paid, gives the same limit).

```ts
MAX_CORRELATED_COLOR_TEMPERATURE_DUV = 0.05
```

## PLANCK_CONSTANT_JOULE_SECONDS

Exact SI defining constants (BIPM SI Brochure, 9th edition, 2019).

```ts
PLANCK_CONSTANT_JOULE_SECONDS = 6.62607015e-34
```

## PLANCKIAN_LOCUS_RANGE_KELVIN

Temperature range of the Planckian-locus models, K.

```ts
PLANCKIAN_LOCUS_RANGE_KELVIN = Object.freeze({ minimum: 1000, maximum: 100000 })
```

## PlanckianLocusModel

Selects how the Planckian locus is evaluated.

```ts
export type PlanckianLocusModel =
  | {
      /** Planck's law integrated against the engine's analytic CIE 1931 CMFs, 1 nm nodes 360–830 nm (the default). */
      kind: "planck-analytic-cmf";
    }
  | {
      kind: "planck-integration";
      colorMatchingFunctions: ColorMatchingFunctionsSource;
      quadratureNodes: readonly ColorimetricQuadratureNode[];
    };
```

## SECOND_RADIATION_CONSTANT_METER_KELVIN

Second radiation constant c₂ = hc/k in m·K (derived from the exact constants).

```ts
SECOND_RADIATION_CONSTANT_METER_KELVIN = (PLANCK_CONSTANT_JOULE_SECONDS * SPEED_OF_LIGHT_METERS_PER_SECOND) / BOLTZMANN_CONSTANT_JOULES_PER_KELVIN
```

## SPEED_OF_LIGHT_METERS_PER_SECOND

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458
```

## WhiteLocus

Locus whose temperature defines a white for CCT + Duv.

```ts
export type WhiteLocus = "planckian" | "cie-daylight";
```
