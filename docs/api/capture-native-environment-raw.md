# capture/native-environment-raw.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateNativeRawRowBands

Splits a plan's native rows into at most `count` contiguous bands of nearly equal height (the first
`height % count` bands are one row taller), in row order. Deterministic: it depends only on the raster height and
`count`. Use one band per worker with createNativeEnvironmentRawPartitionTask.

```ts
export function calculateNativeRawRowBands(plan:Pick<NativeRawPlan,"exposure">,count:number):NativeRawRowBand[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## composeNativeEnvironmentRawPartitions

Assembles the partitions of one capture into the output createNativeEnvironmentRawTask would have returned for
the same input (byte-identical RAW arrays and white levels, the summed provider evaluation count).

The partitions must be in row order and cover every native row exactly once, and each must come from
createNativeEnvironmentRawPartitionTask with this same input. It rejects, with InvalidConfigurationError, a
different input, a gap or overlap, wrong array types or lengths, a second shared state or readout identity, two
white levels for one CFA phase, a missing phase, or a total evaluation count above the input's budget. It cannot
verify how a partition was computed: posted partitions are the caller's own data.

```ts
export function composeNativeEnvironmentRawPartitions(input:NativeEnvironmentRawInput,partitions:readonly NativeEnvironmentRawPartition[]):NativeEnvironmentRawOutput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNativeEnvironmentRawPartitionTask

Creates the task for one row band of a native environment capture (opt-in parallel execution, 2.0).

Run one partition per worker (or one after another) with the same input, each worker using its own provider, then
merge them with composeNativeEnvironmentRawPartitions. The merged output is byte-identical to the single
createNativeEnvironmentRawTask output for the same input and a deterministic provider: noise seeds use absolute
native indices, and tiles, plans and per-site values are those of the whole-frame task.

Each partition checks the same inputs and limits before its callbacks. maximumProviderEvaluations bounds each
partition's own work; the merge also rejects a total above it. Frame-wide checks that span sites (one shared
state, one readout identity, one white level per CFA phase) run inside each band and again across bands in the
merge. Callbacks are split across partitions, and when several partitions fail, which error is seen first depends
on the caller's scheduling. Optical-stage retention is not supported in a partition.

The package bundles no worker code: the caller creates workers (Web Workers or Node worker threads), runs this
task inside each and posts the partition back.

```ts
export function createNativeEnvironmentRawPartitionTask(input:NativeEnvironmentRawInput,rows:NativeRawRowBand,
  provider:NativeEnvironmentRawProvider):NativeEnvironmentRawPartitionTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNativeEnvironmentRawTask

Creates the native RAW task. Every tile is planned and checked against the limits before its radiance
callbacks run, and no partial output is ever returned.

The task also yields to the host between sites inside a tile once about 8 ms of work has passed (one budget
shared with the tile loop). Cancellation is checked after each such yield, so cancel() takes effect within
about one site's work. Yield timing never changes tile requests, limit checks, callbacks or output.

```ts
export function createNativeEnvironmentRawTask(input:NativeEnvironmentRawInput,provider:NativeEnvironmentRawProvider):NativeEnvironmentRawTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNativeEnvironmentSensorStageTask

Re-runs only the sensor stage from a retained optical stage. No radiance callback is called.

Use it when only post-optics settings change: noise seed, ISO and its readout regime and gain,
fixed-pattern noise, charge, dark-current and capacity profiles, white-balance intent, capture identity
or tile width. White balance and rendering are then applied by createNativeRawDevelopmentTask as usual.

RAW codes are bit-identical to a full createNativeEnvironmentRawTask with the same final inputs, as long
as the radiance provider is a deterministic function of its request.

Any optical difference is rejected with InvalidConfigurationError before output. That includes scene
binding, geometry or orientation, focal length, aperture, shutter or exposure window, focus,
frame/CFA/binding profiles, and any site environment field such as PSF, field throughput, pupil, motion,
spectral or temporal sampling and provider profiles.

providerEvaluationCount is 0. The caller still owns the stage; it is not used up.

```ts
export function createNativeEnvironmentSensorStageTask(input:NativeEnvironmentSensorStageInput,opticalStage:NativeEnvironmentOpticalStage,
  provider:NativeEnvironmentSensorStageProvider):NativeEnvironmentRawTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NativeEnvironmentPhotoTile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentPhotoTile extends NativeRawTileRequest {
  sites:readonly {nativeIndex:number;expectedIncidentPhotonCount:number;expectedGeneratedElectronCount:number}[];
}
```

## NativeEnvironmentRadianceQuery

One radiance query of a batch: the frozen provider request and, for an ideal-pupil ray, its frozen aperture ray.

```ts
export interface NativeEnvironmentRadianceQuery {
  request: Readonly<SceneRadianceEvaluationRequest>;
  apertureRay?: Readonly<SensorApertureRay>;
}
```

## NativeEnvironmentRawInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawInput {
  raw: NativeRawInput;
  sceneBinding: SimulateEnvironmentSensorRawFrameInput["sceneBinding"];
  /** Budget of provider calls for the whole capture, checked before work starts; at most 2 billion. Staying within it does not imply convergence. */
  maximumProviderEvaluations: number;
  /**
   * Optional: keep the optical stage (per-site expected photo signal, tied to every optical input) on the
   * output, for createNativeEnvironmentSensorStageTask. If omitted, behaviour and output shape are unchanged.
   */
  opticalStage?: NativeEnvironmentOpticalStageRetention;
}
```

## NativeEnvironmentRawOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawOutput {
  raw: NativeRawOutput;
  sceneBinding: NativeEnvironmentRawInput["sceneBinding"];
  providerEvaluationCount: number;
  upstreamOrigin: "executed-environment-query-provider-optics-psf-eqe";
  providerTransportVerified: false;
  productionPlanActivated: false;
  /** Present only when NativeEnvironmentRawInput.opticalStage was requested. The caller owns and disposes it. */
  opticalStage?: NativeEnvironmentOpticalStage;
}
```

## NativeEnvironmentRawPartition

One partition's result: plain data and typed arrays only, so it can be posted from a worker (transfer the four
arrays' buffers). Merge every partition of a capture with composeNativeEnvironmentRawPartitions.

```ts
export interface NativeEnvironmentRawPartition {
  rows: NativeRawRowBand;
  /** Canonical JSON of the capture input (raw, sceneBinding, maximumProviderEvaluations); the merge requires it to match. */
  inputCanonical: string;
  /** Canonical JSON of the band's shared source/optical/motion state; every partition must match. */
  sharedStateCanonical: string;
  /** Readout identity of the band's first site; every partition must match (one readout identity per frame). */
  readoutIdentity: { readoutProfileId: string; regimeId: string; fixedPatternProfileId: string | null; fixedPatternSeedUint32: number | null };
  /** The band's rows only, row-major, as in NativeRawOutput. */
  codes: Uint16Array;
  blackLevels: Uint16Array;
  digitalSaturationCodes: Uint16Array;
  saturationFlags: Uint8Array;
  /** Effective white code per CFA phase; 0 for a phase the band does not contain. */
  effectiveSaturationCodes: Uint16Array;
  providerEvaluationCount: number;
}
```

## NativeEnvironmentRawPartitionTask

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawPartitionTask extends Omit<NativeRawTask,"takeOutput"> {
  readonly rows: NativeRawRowBand;
  readonly providerEvaluationCount: number;
  takeOutput(): NativeEnvironmentRawPartition;
}
```

## NativeEnvironmentRawProvider

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawProvider {
  /** Supplies physical site profiles, not photo counts or precomputed RAW codes. */
  readTile(request: Readonly<NativeRawTileRequest>,signal:AbortSignal):Promise<NativeEnvironmentRawTile>;
  evaluateRadiance: SimulateEnvironmentSensorRawFrameInput["evaluateRadiance"];
  evaluateApertureRadiance?: SimulateEnvironmentSensorRawFrameInput["evaluateApertureRadiance"];
  /**
   * Optional batched light sampling (2.0, additive). When present, the engine makes one call per tile instead of one
   * evaluateRadiance or evaluateApertureRadiance call per query. `queries` holds every query of the tile's sites, in
   * exactly the order the per-query callbacks would be made, each with the same frozen request (and aperture ray).
   * Return one result per query, in the same order; a promise is allowed (for example a GPU readback). Each result
   * is validated by the same parser and binding checks as a per-query result, so for the same results the output is
   * byte-identical. The per-query evaluators stay required as the reference contract, but are not called.
   */
  evaluateRadianceBatch?(queries:readonly NativeEnvironmentRadianceQuery[],signal:AbortSignal):
    readonly SceneRadianceEvaluationResult[]|Promise<readonly SceneRadianceEvaluationResult[]>;
  /** Optional, bounded diagnostic callback. Counts are expected values before any noise, clipping or ADC (analogue-to-digital conversion). */
  observePhotoTile?(tile:Readonly<NativeEnvironmentPhotoTile>,signal:AbortSignal):void|Promise<void>;
  yieldControl(signal:AbortSignal):Promise<void>;
}
```

## NativeEnvironmentRawTask

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawTask extends Omit<NativeRawTask,"takeOutput"> {
  readonly providerEvaluationCount: number;
  takeOutput(): NativeEnvironmentRawOutput;
}
```

## NativeEnvironmentRawTile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEnvironmentRawTile extends NativeRawTileRequest {
  sites: SimulateEnvironmentSensorRawFrameInput["sites"];
}
```

## NativeRawRowBand

A band of whole native rows, [y, y + height), in absolute full-sensor coordinates.

```ts
export interface NativeRawRowBand { y: number; height: number }
```
