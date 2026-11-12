# sensor/fixed-pattern-noise.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorFixedPatternSite

Computes the fixed-pattern values of one absolute colour-sampling site.

- PRNU gain g = max(0, 1 + σ_PRNU·z₁);
- hot pixel when u < f_hot, then dark factor d = m_hot; otherwise d = max(0, 1 + σ_DSNU·z₂);
- row offset σ_row·z(row y), column offset σ_col·z(column x), in input-referred electrons.

Each z is a standard normal value and u a uniform value, each from its own stream hashed with
MurmurHash3 from (sensorInstanceSeed, x, y, stream). Row values use x = 0 and column values y = 0,
so a whole row or column shares one value. Cutting negative factors off at zero shifts the mean
factor by less than 1e-6 for σ ≤ 0.2.

```ts
export function calculateSensorFixedPatternSite(input: {
  profile: SensorFixedPatternNoiseProfile; site: { x: number; y: number };
}): SensorFixedPatternSiteValues;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSensorFixedPatternNoiseProfile

Validates an untrusted fixed-pattern noise profile. Unknown keys, out-of-range parameters and
missing evidence are rejected. The PRNU and DSNU relative standard deviations are limited to 0.5
and 5, and the hot-pixel multiplier to 1–1e6.

```ts
export function parseSensorFixedPatternNoiseProfile(value: unknown): SensorFixedPatternNoiseProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_FIXED_PATTERN_NOISE_MODEL

Versioned identity of the pattern-generation equations and seed schedule.

```ts
SENSOR_FIXED_PATTERN_NOISE_MODEL = Object.freeze({ id: "photivra-sensor-fixed-pattern", version: "1.0.0" } as const)
```

## SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION = "0.1.0" as const
```

## SensorFixedPatternNoiseProfile

Explicit fixed-pattern parameters for one sensor instance. Every component is required; a zero
standard deviation, fraction or RMS disables that component.

```ts
export interface SensorFixedPatternNoiseProfile {
  schemaVersion: typeof SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  /** The colour-sampling grid whose absolute site coordinates index the pattern. */
  colorSamplingProfileId: string;
  scientificStatus: "approximation";
  /** Identifies the physical sensor. Independent of every per-capture noise seed. */
  sensorInstanceSeedUint32: number;
  /** EMVA 1288 PRNU: spatial standard deviation of the photo response divided by its mean. */
  photoResponseNonUniformity: { relativeStandardDeviation: EvidenceBackedFact<number> };
  /** Spatial standard deviation of the dark-current rate divided by the population-mean rate. */
  darkSignalNonUniformity: { relativeStandardDeviation: EvidenceBackedFact<number> };
  /** Fraction of sites whose dark-current rate is the population mean times the multiplier. */
  hotPixels: { siteFraction: EvidenceBackedFact<number>; darkCurrentMultiplier: EvidenceBackedFact<number> };
  /** Fixed readout offset per row, in input-referred electrons, normally distributed with zero mean. */
  rowOffset: { rmsElectrons: EvidenceBackedFact<number> };
  /** Fixed readout offset per column, in input-referred electrons, normally distributed with zero mean. */
  columnOffset: { rmsElectrons: EvidenceBackedFact<number> };
  patternDistribution: "normal-factors-truncated-at-zero";
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## SensorFixedPatternSiteValues

The deterministic pattern values of one colour-sampling site.

```ts
export interface SensorFixedPatternSiteValues {
  profileId: string;
  modelId: typeof SENSOR_FIXED_PATTERN_NOISE_MODEL.id;
  modelVersion: typeof SENSOR_FIXED_PATTERN_NOISE_MODEL.version;
  site: { x: number; y: number };
  /** Multiplies the expected photo charge (1 = no PRNU); never negative. */
  photoResponseGainFactor: number;
  /** Multiplies the population-mean dark expectation (1 = no DSNU); never negative. */
  darkCurrentFactor: number;
  hotPixel: boolean;
  rowOffsetElectrons: number;
  columnOffsetElectrons: number;
  /** rowOffsetElectrons + columnOffsetElectrons, added at readout. */
  readoutOffsetElectrons: number;
}
```
