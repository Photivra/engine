# sensor/iso-gain.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createIsoGainReadoutRegimes

Builds a readout regime and signal-chain band for each exposure index (see the module comment
for the equations). The result is checked with the same rules as parseSensorReadoutConversionProfile.
Each regime carries an `exposureIndexGain` record of how it was derived.

```ts
export function createIsoGainReadoutRegimes(input: CreateIsoGainReadoutRegimesInput): IsoGainReadoutRegimes;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateIsoGainReadoutRegimesInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateIsoGainReadoutRegimesInput {
  regimeIdPrefix: string;
  scientificStatus: SensorSpectralResponseScientificStatus;
  baseExposureIndex: number;
  /** Strictly increasing settings, each at least the base exposure index. */
  exposureIndices: readonly number[];
  /** Q0: electron-equivalent signal that reaches digital saturation at the base exposure index. */
  baseSaturationElectronEquivalent: EvidenceBackedFact<number>;
  /** A_max: largest analog gain relative to the base regime (>= 1). */
  maximumAnalogGain: EvidenceBackedFact<number>;
  adc: { bitDepth: number; blackLevelCode: number; digitalSaturationCode: number };
  conversionGainModes: readonly IsoGainConversionGainMode[];
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## IsoGainConversionGainMode

One conversion-gain mode, active from its minimum exposure index up to the next mode's.

```ts
export interface IsoGainConversionGainMode {
  mode: SensorReadoutExposureIndexGain["conversionGainMode"];
  minimumExposureIndex: number;
  readNoiseRmsElectrons: EvidenceBackedFact<number>;
  /** Optional charge storage limit of this mode. Every regime's pre-ADC threshold must be at or below it. */
  maximumChargeElectrons?: EvidenceBackedFact<number>;
}
```

## IsoGainReadoutRegimes

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IsoGainReadoutRegimes {
  regimes: readonly SensorReadoutConversionRegime[];
  /** One single-value band per setting, ready for a GenericIsoSignalChainProfile. */
  standardRegimeBands: readonly GenericIsoStandardRegimeBand[];
}
```
