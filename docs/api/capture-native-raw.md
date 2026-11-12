# capture/native-raw.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateNativeRawPlan

Plans the task and checks the image size, resources and profiles before any callback or output allocation. No placeholder plane is made.

```ts
export function calculateNativeRawPlan(input: NativeRawInput): NativeRawPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createNativeRawTask

Runs validated per-site events (EQE photo signal, dark signal, charge completeness) through the shared
reference per-site physics.

Tiles are read and committed one at a time. The task yields to the host at tile boundaries once about
8 ms of work has passed since the last yield, and after the final tile. It checks for cancellation
before every tile, after every read and after every yield.

```ts
export function createNativeRawTask(input: NativeRawInput,provider: NativeRawProvider): NativeRawTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NATIVE_RAW_LIMITS

`maximumPixels` is the default pixel limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`.

```ts
NATIVE_RAW_LIMITS = Object.freeze({ maximumPixels: 24_000_000, ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS, maximumDimension: 16_384,
  tileWidth: 256, tileHeight: 1, outputBytesPerPixel: 7 })
```

## NATIVE_RAW_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
NATIVE_RAW_SCHEMA_VERSION = "0.1.0" as const
```

## NativeRawExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NativeRawExposure = Omit<SimulatedCapture, "schemaVersion" | "planes" | "source"> & {source:CaptureExposureSource};
```

## NativeRawExposureInput

A shooting event and where its source came from. Not a finished float master or committed RAW frame.

```ts
export type NativeRawExposureInput = Omit<SimulatedCaptureInput, "planes" | "source"> & {source:CaptureExposureSource};
```

## NativeRawInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawInput {
  exposure: NativeRawExposureInput;
  frameId: string;
  modeId: string;
  captureModeProfile: NativeRawProducerFrameContext["captureModeProfile"];
  colorSamplingProfile: NativeRawProducerFrameContext["colorSamplingProfile"];
  bindingProfile: NativeRawProducerFrameContext["bindingProfile"];
  exposureWindow?: SensorRawProducerExposureWindowInput;
  maximumOutputBytes: number;
  /** Optional tile width for execution, in native sites, 1–256. Default 256. It does not affect sampling. */
  tileWidth?: number;
  /**
   * Optional opt-in pixel limit for large sensors: an integer from 1 to `NATIVE_RAW_LIMITS.ceilingPixels`.
   * Default `NATIVE_RAW_LIMITS.maximumPixels` (24 000 000). `maximumOutputBytes` still applies. A raised limit
   * also raises the native environment tasks' whole-event query budget ceiling in proportion
   * (2 000 000 000 per 24 000 000 pixels). It does not affect sampling.
   */
  maximumPixels?: number;
}
```

## NativeRawOutput

Row-major arrays owned only by the output. They cannot be attached to the bounded SensorRawFrame type.

```ts
export interface NativeRawOutput {
  plan: NativeRawPlan;
  codes: Uint16Array;
  blackLevels: Uint16Array;
  digitalSaturationCodes: Uint16Array;
  /** Saturation flags. Bit 0: physical charge clamp; bit 1: pre-ADC clamp; bit 2: digital saturation. */
  saturationFlags: Uint8Array;
  /**
   * Effective white (full-saturation) code for each absolute CFA repeat phase, indexed
   * `phaseY*repeatWidthSites+phaseX`: min(digital saturation, round(black + min(capacity, pre-ADC
   * saturation)/gain)). See `calculateEffectiveSaturationCode`. A few bytes, not one value per pixel.
   */
  effectiveSaturationCodes: Uint16Array;
}
```

## NativeRawPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawPlan {
  schemaVersion: typeof NATIVE_RAW_SCHEMA_VERSION;
  exposure: NativeRawExposure;
  frame: NativeRawProducerFrameContext;
  exposureWindow?: SensorRawProducerExposureWindowInput;
  pixelCount: number;
  outputBytes: number;
  tileCount: number;
  /** Present only when an execution tile width was given. Otherwise the plan keeps its earlier shape. */
  tileWidth?: number;
  /** Present only when a pixel limit was given. Otherwise the plan keeps its earlier shape. */
  maximumPixels?: number;
  upstreamRadiometryVerified: false;
  seedSchedule: "murmur3-capture-seed-native-index-stream-v2";
}
```

## NativeRawProvider

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawProvider {
  readTile(request: Readonly<NativeRawTileRequest>, signal: AbortSignal): Promise<NativeRawTile>;
  yieldControl(signal: AbortSignal): Promise<void>;
}
```

## NativeRawTask

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawTask {
  readonly plan: NativeRawPlan;
  readonly state: NativeRawTaskState;
  readonly completedTileCount: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  takeOutput(): NativeRawOutput;
}
```

## NativeRawTaskState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NativeRawTaskState = "ready" | "running" | "completed" | "cancelled" | "failed" | "disposed" | "transferred";
```

## NativeRawTile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawTile extends NativeRawTileRequest { sites: readonly SensorRawProducerSiteInput[] }
```

## NativeRawTileRequest

Tile rectangle, in absolute full-sensor CFA coordinates, before orientation, active-area crop or output scaling.

```ts
export interface NativeRawTileRequest { captureId: string; frameId: string; x: number; y: number; width: number; height: number }
```
