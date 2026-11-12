# capture/simulated-capture.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CaptureExposureSource

Identifies a procedural or physical source, without making up a linear master plane.

```ts
export type CaptureExposureSource = SimulatedCaptureInput["source"] | (Omit<SimulatedCaptureInput["source"], "kind"> & {kind:"scene-radiance-source"});
```

## CaptureFloatStorage

External bytes belong to the caller. The engine never reads a path or URL.

```ts
export type CaptureFloatStorage =
  | { kind: "inline-float64"; samples: readonly number[] }
  | { kind: "external-float32" | "external-float64"; byteOrder: "little-endian"; artifactId: string; sha256: string; sampleCount: number };
```

## CaptureLinearImageState

Which kind of linear data a plane holds. These are different domains, not one interchangeable "linear" flag.

```ts
export type CaptureLinearImageState = "scene-referred-xyz" | "virtual-sensor-channels" | "color-transformed-linear-rgb";
```

## CaptureLinearPlane

Linear float plane. All channels are sampled at the same positions and interleaved in row-major order.

```ts
export interface CaptureLinearPlane {
  id: string;
  imageStateId: string;
  imageState: CaptureLinearImageState;
  rasterBinding: "oriented-active-capture" | "output";
  pixelWidth: number;
  pixelHeight: number;
  channelIds: readonly string[];
  colorProfile: CapturePublicProfileReference | null;
  /** Set for colorimetric (RGB) encodings; null for raw sensor channels with no colour meaning yet. */
  encodingReferenceWhiteXyz: CaptureWhiteXyz | null;
  /** How values are normalized. Independent of capture saturation and of any later integer white level. */
  referenceWhiteValue: number;
  whiteBalanceApplication: "intent-only" | "applied-rgb-gains" | "applied-chromatic-adaptation" | "not-applicable";
  captureSaturation:
    | { kind: "not-modeled" }
    | { kind: "declared-virtual-white"; whiteLevel: number; upstreamClippedSampleCount: number };
  appliedTransforms: readonly { profile: CapturePublicProfileReference; kind: "linear-color" | "chromatic-adaptation" | "digital-lens-correction" }[];
  storage: CaptureFloatStorage;
}
```

## CapturePublicProfileReference

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CapturePublicProfileReference { id: string; version: string }
```

## CaptureWhiteBalanceIntent

A resolved white-balance state (ResolvedWhiteBalanceState), cleaned for public metadata. No WB estimator is rerun.

```ts
export interface CaptureWhiteBalanceIntent {
  stateId: string;
  source: ResolvedWhiteBalanceState["source"];
  locked: boolean;
  channelGains: WhiteBalanceChannelGains;
  sourceProfile: CapturePublicProfileReference | null;
}
```

## CaptureWhiteXyz

Normalized tristimulus white; Y=1. This is not a spectrum or Kelvin value.

```ts
export interface CaptureWhiteXyz { x: number; y: 1; z: number }
```

## createCaptureWhiteBalanceIntent

Converts the validated shooting WB to the allowed public metadata fields, dropping private extras.

```ts
export function createCaptureWhiteBalanceIntent(input: { state: ResolvedWhiteBalanceState }): CaptureWhiteBalanceIntent;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createSimulatedCapture

Commits a capture with a manifest of float master planes. No radiance generation, clipping, WB or file encoding.

```ts
export function createSimulatedCapture(input: SimulatedCaptureInput): CalculationResult<SimulatedCapture>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSimulatedCapture

Parses an archived capture, recomputing and checking all derived geometry/focal metadata.

```ts
export function parseSimulatedCapture(value: unknown): SimulatedCapture;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveSimulatedCapturePlane

Requires the exact image state of the plane. Callers cannot substitute another kind of "linear".

```ts
export function resolveSimulatedCapturePlane(input: {
  capture: SimulatedCapture; planeId: string; requiredImageState: CaptureLinearImageState;
}): CaptureLinearPlane;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## serializeSimulatedCapture

Canonical JSON of the allowed fields, including sample values and IDs. Excludes private caches and file layout.

```ts
export function serializeSimulatedCapture(input: { capture: SimulatedCapture }): string;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SIMULATED_CAPTURE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SIMULATED_CAPTURE_SCHEMA_VERSION = "0.2.0" as const
```

## SimulatedCapture

The immutable committed capture. Geometry and equivalent focal length are computed, never taken from the caller.

```ts
export interface SimulatedCapture extends SimulatedCaptureInput {
  schemaVersion: typeof SIMULATED_CAPTURE_SCHEMA_VERSION;
  engineApiVersion: string;
  resolvedGeometry: ResolvedCaptureGeometry;
  equivalentFocalLength35Mm: number;
}
```

## SimulatedCaptureInput

Input from an upstream master or capture provider, independent of file format. Not a preview image.

```ts
export interface SimulatedCaptureInput {
  captureId: string;
  sceneStateId: string;
  /** Seconds on the declared scene clock, not an embedded wall-clock timestamp. */
  sceneTimeSeconds: number;
  geometry: ResolveCaptureGeometryInput;
  exposure: { focalLengthMm: number; aperture: number; shutterSeconds: number; iso: number };
  focus: FocusPlane;
  noise: { seedUint32: number; realizationId: string; model: CapturePublicProfileReference };
  source: {
    kind: "scene-linear-master" | "sensor-derived-linear" | "color-transformed-linear-master";
    artifactId: string;
    sha256: string;
    dynamicRangeHistory: "unknown" | "no-loss-declared" | "upstream-clipped";
  };
  whiteBalanceIntent: CaptureWhiteBalanceIntent | null;
  /** The adopted (WB) white is a camera choice. It is not automatically the encoding white. */
  adoptedWhiteXyz: CaptureWhiteXyz | null;
  models: readonly { profile: CapturePublicProfileReference; scientificStatus: ProvenanceKind; publicEvidenceIds: readonly string[] }[];
  planes: readonly CaptureLinearPlane[];
}
```
