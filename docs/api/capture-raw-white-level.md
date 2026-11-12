# capture/raw-white-level.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateEffectiveSaturationCode

W as documented above; throws unless B < W ≤ D. Ties round up, matching the ADC.

Accepts an `EffectiveSaturationReadout` or a whole `SensorRawCodeSample`, optionally with the
regime's `integralNonLinearity`. From 2.0.0 any other field is rejected with
`InvalidConfigurationError`, and the `integralNonLinearity` record and its knots are checked too.

```ts
export function calculateEffectiveSaturationCode(readout: EffectiveSaturationReadout): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EffectiveSaturationReadout

Readout fields the white level depends on; a `SensorRawCodeSample` satisfies this shape.

```ts
export interface EffectiveSaturationReadout {
  physicalChargeCapacityElectrons: number;
  preAdcSaturationElectronEquivalent: number;
  systemConversionGainElectronsPerCode: number;
  blackLevelCode: number;
  digitalSaturationCode: number;
  /** ADC code-range maximum (2^bits − 1), when known. */
  adcMaximumCode?: number;
  /** Post-ADC digital gain d ≥ 1; omitted means 1. */
  digitalGain?: number;
  /** Declared ADC integral non-linearity, the readout regime's `adc.integralNonLinearity`. */
  integralNonLinearity?: { kind: "piecewise-linear-code-offset"; knots: readonly { code: number; offsetCodes: number }[] };
}
```
