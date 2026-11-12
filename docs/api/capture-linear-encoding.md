# capture/linear-encoding.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLinearCaptureEncoding

Converts one inline float plane to integer codes. The capture data is not changed.

Mapping: blackCode + (sample-blackValue)/(referenceWhiteValue-blackValue)
* (referenceWhiteCode-blackCode). It clips only when the policy says so, then rounds.

```ts
export function calculateLinearCaptureEncoding(input: LinearCaptureEncodingInput): CalculationResult<EncodedLinearCapture>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EncodedLinearCapture

16-bit unsigned codes, not tied to a file format. The metadata keeps their colour, white-balance (WB) and saturation meaning.

```ts
export interface EncodedLinearCapture {
  schemaVersion: typeof LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION;
  captureId: string;
  /** Cleaned-up copy of the capture's geometry, settings, WB, adopted white and model provenance, without the float planes. */
  captureMetadata: Omit<SimulatedCapture, "planes">;
  sourcePlane: Omit<CaptureLinearPlane, "storage">;
  encoding: LinearCaptureEncoding;
  sampleLayout: "row-major-interleaved";
  bitDepth: 16;
  codeMinimum: 0;
  codeMaximum: 65535;
  referenceWhiteValue: number;
  /** Codes per relative source unit; same scale for all channels. */
  scale: number;
  minimumRepresentableValue: number;
  maximumRepresentableValue: number;
  /** Headroom: (maximum value − black) / (reference white − black). */
  headroomFactor: number;
  /** Largest rounding error for in-range samples, 0.5/scale. Clipping error is not included. */
  maximumRoundingError: number;
  clippedLowSampleCount: number;
  clippedHighSampleCount: number;
  /** Linear encoding never picks a default rendering exposure or display white. */
  defaultRenderingExposureEv: null;
  samples: readonly number[];
}
```

## LINEAR_CAPTURE_ENCODING_MODEL_VERSION

Version of the `uniform-linear-capture-uint16` model. 0.2.0 made rounding exact: nearest, ties up (Math.round).

```ts
LINEAR_CAPTURE_ENCODING_MODEL_VERSION = "0.2.0" as const
```

## LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION = "0.1.0" as const
```

## LinearCaptureEncoding

The same linear mapping for every channel. The reference white value comes from the source plane.

```ts
export interface LinearCaptureEncoding {
  schemaVersion: typeof LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION;
  /** Relative source sample value assigned blackCode; may be negative. */
  blackValue: number;
  /** Integer code for blackValue, 0..65534. A nonzero offset can keep negative samples. */
  blackCode: number;
  /** Code at the plane's referenceWhiteValue, strictly above blackCode, at most 65535. */
  referenceWhiteCode: number;
  negativeValues: "preserve-if-representable" | "reject";
  outOfRange: "clip" | "reject";
  rounding: "nearest-ties-up";
}
```

## LinearCaptureEncodingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LinearCaptureEncodingInput {
  capture: SimulatedCapture;
  planeId: string;
  /** Identifies the exact source plane, so a plane with a different meaning cannot be swapped in. */
  requiredImageState: CaptureLinearImageState;
  encoding: LinearCaptureEncoding;
}
```

## parseLinearCaptureEncoding

Strictly parses an encoding profile. It never fills in a default clipping or rounding policy.

```ts
export function parseLinearCaptureEncoding(value: unknown): LinearCaptureEncoding;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
