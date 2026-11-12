# sensor/signal-noise.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePhotoelectrons

Converts the mean incident photon count to the mean photoelectron count.

This is an expected value. This deterministic calculation does not generate
random shot noise.

```ts
export function calculatePhotoelectrons(
  input: CalculatePhotoelectronsInput
): CalculationResult<number>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculatePhotoelectronsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculatePhotoelectronsInput {
  /** Mean number of photons reaching the photosite (or measurement region). */
  incidentPhotons: number;
  /** Quantum efficiency from 0 to 1 inclusive. */
  quantumEfficiency: number;
}
```

## calculateSignalToNoise

Calculates the expected SNR from Poisson shot noise and independent RMS read
noise.

Variances add: total variance = signalElectrons + readNoiseElectrons^2.
Dark current, fixed-pattern noise, quantization, clipping and later
processing are deliberately left out.

```ts
export function calculateSignalToNoise(
  input: CalculateSignalToNoiseInput
): CalculationResult<SignalToNoise>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSignalToNoiseInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSignalToNoiseInput {
  /** Mean signal in electrons. */
  signalElectrons: number;
  /** RMS read noise in electrons. */
  readNoiseElectrons: number;
}
```

## SignalToNoise

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SignalToNoise {
  shotNoiseStdElectrons: number;
  combinedNoiseStdElectrons: number;
  snrLinear: number;
  /** Null when the signal is zero, because -Infinity dB cannot be stored in JSON. */
  snrDb: number | null;
}
```
