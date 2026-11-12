# output/capture-sdr.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureSdr

Renders the validated capture color state without correction or resampling.

```ts
export function calculateCaptureSdr(input: CaptureSdrInput): CalculationResult<CaptureSdrResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CAPTURE_SDR_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CAPTURE_SDR_SCHEMA_VERSION = "0.1.0" as const
```

## CaptureSdrInput

Either select an existing RGB image state or derive one explicitly. White balance is never estimated here.

```ts
export interface CaptureSdrInput {
  capture: SimulatedCapture;
  sourcePlaneId: string;
  color: { kind: "already-transformed" } | {
    kind: "transform";
    outputPlaneId: string;
    outputImageStateId: string;
    whiteBalance: CaptureColorTransformInput["whiteBalance"];
  };
  profile: SdrRenderingProfile;
}
```

## CaptureSdrResult

Result. The source capture history, the optional colour derivation and the SDR diagnostics are kept separate.

```ts
export interface CaptureSdrResult {
  schemaVersion: typeof CAPTURE_SDR_SCHEMA_VERSION;
  captureId: string;
  sourcePlaneId: string;
  sourceImageStateId: string;
  rasterBinding: CaptureLinearPlane["rasterBinding"];
  sourceCaptureSaturation: CaptureLinearPlane["captureSaturation"];
  sourceDynamicRangeHistory: SimulatedCapture["source"]["dynamicRangeHistory"];
  noiseRealizationId: string;
  whiteBalance: "applied-here" | "already-applied-upstream" | "not-required";
  color: CalculationResult<CaptureColorTransformResult> | null;
  rendering: CalculationResult<SdrRenderingResult>;
}
```

## parseCaptureSdrInput

Validates untrusted input: the capture and the explicit colour and rendering choices.

```ts
export function parseCaptureSdrInput(value: unknown): CaptureSdrInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
