# output/capture-corrected-sdr.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureCorrectedSdr

Runs a bounded committed capture through colour/WB → native lens correction → oriented output
view → SDR. No physical simulation stage is run.

```ts
export function calculateCaptureCorrectedSdr(input: CaptureCorrectedSdrInput): CalculationResult<CaptureCorrectedSdrResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CAPTURE_CORRECTED_SDR_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CAPTURE_CORRECTED_SDR_SCHEMA_VERSION = "0.1.0" as const
```

## CaptureCorrectedSdrInput

Input: a capture plus an explicit lens-correction choice in native optical coordinates. Camera
body, lens and mode identities are taken as the capture producer declared them.

```ts
export interface CaptureCorrectedSdrInput extends CaptureSdrInput {
  correction: {
    profile: GenericLensCorrectionProfile;
    state: OpticalProfileState;
    /** Native optical coordinates (+X right, +Y up), in the RGB space after the selected colour/WB step. */
    coordinateFrame: "native-optical-linear-srgb-d65";
    selections: Readonly<Record<string, "on" | "off" | "auto">>;
    selectionKind: ResolvedLensCorrectionPlan["selectionKind"];
    /** Seconds from exposure start, not the capture's scene-clock time. */
    frameTimeSeconds: number;
    resampler: GeometricResampler;
    clippingLevel: number;
    invalidSupport: "reject" | "joint-valid-crop";
    outputImageStateId: string;
  };
}
```

## CaptureCorrectedSdrResult

A derived output view. It never replaces the committed capture's physical geometry.

```ts
export interface CaptureCorrectedSdrResult extends Omit<CaptureSdrResult, "schemaVersion"> {
  schemaVersion: typeof CAPTURE_CORRECTED_SDR_SCHEMA_VERSION;
  sceneTimeSeconds: number;
  plan: CalculationResult<ResolvedLensCorrectionPlan>;
  correction: ReturnType<typeof calculateLensCorrectedCapture>;
  projection: ReturnType<typeof calculateFieldOfView>;
  /** Valid-source mask over the full oriented output. The nested correction plans still use native optical coordinates. */
  validSourceMask: readonly boolean[];
  outputView: { imageStateId: string; rect: RasterRect; pixelWidth: number; pixelHeight: number; samples: readonly number[] };
}
```

## parseCaptureCorrectedSdrInput

Strictly parses untrusted input. Running the calculation also checks the capture's optics,
native pixel-grid binding and source history.

```ts
export function parseCaptureCorrectedSdrInput(input: unknown): CaptureCorrectedSdrInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
