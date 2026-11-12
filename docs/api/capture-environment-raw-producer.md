# capture/environment-raw-producer.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## EnvironmentSensorRawFrame

Result: the approximate record of what ran, from provider to RAW.

- `sites` keeps the per-site optics and EQE results.
- `raw` keeps charge, capacity, seeded-noise and readout diagnostics, and the exact native frame.
- `providerEvaluationCount` is the actual (bounded) work done, not a quality score.

The cautious verification and activation flags belong to this standalone function. A parent
production plan records its own execution and does not upgrade them.

```ts
export interface EnvironmentSensorRawFrame {
  upstreamOrigin: "executed-environment-query-provider-optics-psf-eqe";
  providerTransportVerified: false;
  productionPlanActivated: false;
  providerEvaluationCount: number;
  sceneBinding: SimulateEnvironmentSensorRawFrameInput["sceneBinding"];
  sites: readonly ReturnType<typeof executeEnvironmentSensorPhotoSignal>[];
  raw: ReturnType<typeof simulateSensorRawFrame>;
}
```

## simulateEnvironmentSensorRawFrame

Simulates a RAW frame from a scene-radiance provider.

Before calling any provider code, it checks that the sites cover the full native
frame and that all inputs are supported. Dark current, charge completeness,
capacity, noise and ADC use the existing sensor modules. The returned RAW frame
works with the existing reconstruction and paired-export APIs.

```ts
export function simulateEnvironmentSensorRawFrame(input: SimulateEnvironmentSensorRawFrameInput): CalculationResult<EnvironmentSensorRawFrame>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SimulateEnvironmentSensorRawFrameInput

All native sites, in native order. Generated photo or dark charge cannot be passed in as a shortcut.

```ts
export interface SimulateEnvironmentSensorRawFrameInput {
  frame: SensorRawProducerInput["frame"];
  sceneBinding: { sceneStateId: string; providerSceneId: string; evidence: readonly EvidenceProvenance[] };
  /** The shared shutter schedule, tied to the committed frame duration. */
  exposureWindow: NonNullable<SensorRawProducerInput["exposureWindow"]>;
  sites: readonly {
    environment: Omit<CalculateEnvironmentSensorPhotoSignalInput, "evaluateRadiance" | "evaluateApertureRadiance">;
    darkCurrentProfile: SensorDarkCurrentProfile;
    operatingTemperatureC: number;
    charge: Omit<SensorRawProducerSiteInput["charge"], "photoSignal" | "darkCharge">;
    readout: Omit<SensorRawProducerSiteInput, "charge">;
  }[];
  evaluateRadiance: EnvironmentRadianceEvaluator;
  evaluateApertureRadiance?: EnvironmentApertureRadianceEvaluator;
}
```
