# capture/raw-frame-reconstruction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseRawFrameReconstructionInput

Revalidates the committed RAW codes and geometry and checks that every CFA phase has a kernel. No external image plane can supply output values.

```ts
export function parseRawFrameReconstructionInput(value: unknown): RawFrameReconstructionInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## RAW_FRAME_RECONSTRUCTION_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
RAW_FRAME_RECONSTRUCTION_SCHEMA_VERSION = "0.1.0" as const
```

## RawFrameReconstruction

Traceable sensor-channel values. Not colorimetric RGB and not a rendered photograph.

```ts
export interface RawFrameReconstruction {
  schemaVersion: typeof RAW_FRAME_RECONSTRUCTION_SCHEMA_VERSION;
  rawFrame: SensorRawFrame;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
  region: RasterRect;
  linearPlane: {
    imageState: "virtual-sensor-channels";
    rasterBinding: "native-reconstruction-region";
    pixelWidth: number;
    pixelHeight: number;
    channelIds: readonly string[];
    /** Interleaved values over the native region, row-major. Black-subtracted and normalized; can be negative. */
    samples: readonly number[];
  };
  /** Per-pixel result envelopes and the exact weighted RAW contributions, in the same row-major order. */
  pixels: readonly CalculationResult<SensorRawReconstructedPixel>[];
  lineage: "engine-reconstructed-from-attached-raw";
  producerOriginVerified: false;
  whiteBalanceApplied: false;
  colorTransformApplied: false;
  physicalOrientationApplied: false;
  outputCropApplied: false;
  sharpeningApplied: false;
  denoisingApplied: false;
}
```

## RawFrameReconstructionInput

Input to the bounded reference reconstruction. Region coordinates are in the full native sensor frame.

```ts
export interface RawFrameReconstructionInput {
  rawFrame: SensorRawFrame;
  region: RasterRect;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
}
```

## RawFrameReconstructionPhaseProfile

A kernel is chosen explicitly for each absolute native CFA repeat phase, not guessed from channel names.

```ts
export interface RawFrameReconstructionPhaseProfile {
  phaseX: number;
  phaseY: number;
  profile: SensorRawReconstructionProfile;
}
```

## resolveRawFrameReconstruction

Computes each pixel with the sensor module's explicit linear reconstruction, using only the attached native RAW samples.

```ts
export function resolveRawFrameReconstruction(input: RawFrameReconstructionInput): CalculationResult<RawFrameReconstruction>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
