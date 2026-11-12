# capture/native-environment-optical-stage.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS

Fixed retention limits. The per-site footprint of a retained optical stage is
`fixedBytesPerSite + bytesPerTemporalSamplePerSite × temporalSampleCount` bytes of typed-array storage;
distinct environment and photo templates (each about one site's input size) are capped separately.

```ts
NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS = Object.freeze({
  /** Two one-byte template indices plus seven float64 values (site x/y, window start/end/duration, photon/electron counts). */
  fixedBytesPerSite: 58,
  /** Three float64 values per temporal midpoint: time, incident-photon rate, generated-electron rate. */
  bytesPerTemporalSamplePerSite: 24,
  /** Distinct per-site environment inputs once the site index and integration ID are removed. */
  maximumEnvironmentTemplates: 256,
  /** Distinct photo-signal identity/evidence records once per-site numbers are removed. */
  maximumPhotoTemplates: 256
})
```

## NativeEnvironmentOpticalStage

Opaque, engine-owned optical-stage result. It is valid only for captures whose optical binding and every
site's environment input are strictly equal to those that produced it. dispose() zeroes and releases the
storage; a disposed stage refuses every later use.

```ts
export interface NativeEnvironmentOpticalStage {
  readonly kind: "native-environment-optical-stage";
  readonly pixelCount: number;
  readonly temporalSampleCount: number;
  /** Typed-array bytes held: pixelCount × (fixedBytesPerSite + bytesPerTemporalSamplePerSite × temporalSampleCount). */
  readonly retainedBytes: number;
  /** Radiance callbacks the producing task executed; reuse executes none. */
  readonly providerEvaluationCount: number;
  readonly disposed: boolean;
  dispose(): void;
}
```

## NativeEnvironmentOpticalStageRetention

Optional request on NativeEnvironmentRawInput to keep the optical stage. The byte budget covers the typed-array storage described by the limits.

```ts
export interface NativeEnvironmentOpticalStageRetention {
  maximumRetainedBytes: number;
}
```

## NativeEnvironmentSensorStageInput

Input for a post-optics re-run. `raw` may differ from the original capture only in post-optics fields.

```ts
export interface NativeEnvironmentSensorStageInput {
  raw: NativeRawInput;
  sceneBinding: SimulateEnvironmentSensorRawFrameInput["sceneBinding"];
}
```

## NativeEnvironmentSensorStageProvider

Supplies the same physical site inputs as the original capture. Environments must equal the retained ones exactly.

```ts
export interface NativeEnvironmentSensorStageProvider {
  readTile(request: Readonly<NativeRawTileRequest>, signal: AbortSignal): Promise<{ captureId: string; frameId: string; x: number; y: number;
    width: number; height: number; sites: SimulateEnvironmentSensorRawFrameInput["sites"] }>;
  yieldControl(signal: AbortSignal): Promise<void>;
}
```
