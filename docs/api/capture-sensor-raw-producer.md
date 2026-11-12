# capture/sensor-raw-producer.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseSensorRawProducerInput

Validates the complete per-site exposure inputs. Charge, noise or RAW codes are never accepted as a shortcut.

```ts
export function parseSensorRawProducerInput(value: unknown): SensorRawProducerInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_RAW_PRODUCER_NOISE_MODEL

Version of the capture noise model. It fixes the hashed per-site seed schedule and the signed electronic
readout behaviour.

0.4.0: exact ADC rounding with ties up, normal-approximation Poisson draws for means of 1e9 and above,
optional post-ADC digital gain and INL (integral non-linearity), and optional per-sensor fixed-pattern noise.

```ts
SENSOR_RAW_PRODUCER_NOISE_MODEL = Object.freeze({ id: "photivra-native-raw-noise", version: "0.4.0" } as const)
```

## SENSOR_RAW_PRODUCER_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_RAW_PRODUCER_SCHEMA_VERSION = "0.3.0" as const
```

## SensorRawProducerExposureWindowInput

Exposure schedule for the full sensor. The producer owns the sampling coordinates.

```ts
export type SensorRawProducerExposureWindowInput = Omit<CalculateCaptureExposureWindowsInput,
  "nativeRaster" | "activeCaptureRect" | "samplePointsNative">;
```

## SensorRawProducerInput

Input for one bounded frame. It is never a conversion from separate RGB pixels.

```ts
export interface SensorRawProducerInput {
  frame: Omit<SensorRawFrameInput, "samples">;
  sites: readonly SensorRawProducerSiteInput[];
  /** If omitted, every event uses the existing global window 0..shutterSeconds. */
  exposureWindow?: SensorRawProducerExposureWindowInput;
}
```

## SensorRawProducerResult

Codes produced by the engine, with per-step diagnostics. The upstream radiance and response are as declared, not verified.

```ts
export interface SensorRawProducerResult {
  schemaVersion: typeof SENSOR_RAW_PRODUCER_SCHEMA_VERSION;
  codeProducer: "engine-charge-capacity-noise-adc";
  upstreamOrigin: "declared-eqe-and-dark-exposure-results";
  upstreamRadiometryVerified: false;
  seedSchedule: "murmur3-capture-seed-native-index-stream-v2";
  frame: SensorRawFrame;
  localExposureWindows?: CalculationResult<CaptureExposureWindows>;
  sites: readonly {
    accumulatedCharge: ReturnType<typeof composeSensorAccumulatedCharge>;
    capacity: ReturnType<typeof assessSensorPhysicalChargeCapacity>;
    realization: ReturnType<typeof simulateSensorChargeRealization>;
    readout: ReturnType<typeof simulateSensorRawCode>;
  }[];
}
```

## SensorRawProducerSiteInput

For each native site: one declared exposure event (EQE photo signal, dark signal, charge completeness) and its readout state.

```ts
export interface SensorRawProducerSiteInput {
  charge: ComposeSensorAccumulatedChargeInput;
  samplingProfile: SensorChargeSamplingProfile;
  capacityProfile: SensorPhysicalChargeCapacityProfile;
  operatingStateId: string;
  readoutProfile: SensorReadoutConversionProfile;
  regimeId: string;
  /** Optional fixed-pattern noise (FPN) for this sensor; one profile for the whole frame. Omit it to disable FPN. */
  fixedPatternNoise?: SensorFixedPatternNoiseProfile;
}
```

## simulateSensorRawFrame

Runs accumulated charge → capacity → Poisson noise → read noise and ADC → native sample → immutable frame.

```ts
export function simulateSensorRawFrame(input: SensorRawProducerInput): CalculationResult<SensorRawProducerResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
