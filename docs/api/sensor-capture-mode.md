# sensor/capture-mode.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CaptureModeAcquisition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureModeAcquisition =
  | SingleFrameCaptureAcquisition
  | FixedMultiFrameCaptureAcquisition
  | VariableMultiFrameCaptureAcquisition;
```

## CaptureModeDefinition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureModeDefinition {
  modeId: string;
  /**
   * Evidence that this mode exists and for how it captures overall. Facts in
   * the fields below keep their own evidence where needed.
   */
  evidence: readonly EvidenceProvenance[];
  acquisition: CaptureModeAcquisition;
  perFrameSampling: CaptureModePerFrameSampling;
  /**
   * Optional ordered sequence of sensor shifts, for modes with a fixed number
   * of frames. The whole sequence is one evidence-backed fact, because
   * published documentation usually describes it as a unit.
   */
  interFrameSensorOffsetsNativeSamples?: SourcedCaptureModeFact<
    readonly CaptureModeSensorOffsetNativeSamples[]
  >;
  /**
   * Ordered reconstruction or combination stages. These labels only name the
   * stages for later reconstruction models; they implement no algorithm.
   */
  reconstructionStages?: readonly SourcedCaptureModeFact<CaptureModeReconstructionStage>[];
  /**
   * Image size produced by the capture mode and reconstruction, before the
   * final output crop or resampling.
   *
   * It does not change the physical sensor geometry or field of view.
   */
  processedImageRaster: SourcedCaptureModeFact<RasterDimensions>;
  /**
   * Explicit downstream scientific/model dependencies for this mode.
   */
  dependencies?: readonly CaptureModeDependency[];
}
```

## CaptureModeDependency

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureModeDependency =
  | "color-sampling-model"
  | "mode-specific-readout-timing"
  | "radiometric-calibration"
  | "inter-frame-registration";
```

## CaptureModePerFrameSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureModePerFrameSampling =
  | NativeEffectiveCaptureSampling
  | GroupedNativeCaptureSampling
  | DeclaredEffectiveCaptureSampling;
```

## CaptureModeProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureModeProfile {
  schemaVersion: "0.1.0";
  modes: readonly CaptureModeDefinition[];
}
```

## CaptureModeReconstructionStage

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureModeReconstructionStage =
  | "remosaic"
  | "pixel-shift-combination"
  | "multi-frame-computational-combination";
```

## CaptureModeSampleCombinationDomain

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureModeSampleCombinationDomain =
  | "charge-domain"
  | "pre-conversion-analog"
  | "post-conversion-digital";
```

## CaptureModeSensorOffsetNativeSamples

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureModeSensorOffsetNativeSamples {
  /**
   * Horizontal sensor shift, in units of the native sample pitch. This says
   * nothing about the physical photodiode pitch.
   */
  x: number;
  /**
   * Vertical sensor shift, in units of the native sample pitch. This says
   * nothing about the physical photodiode pitch.
   */
  y: number;
}
```

## DeclaredEffectiveCaptureSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DeclaredEffectiveCaptureSampling {
  kind: "declared-effective-raster";
  /**
   * Sample grid per frame, for a mode whose relationship to the native grid
   * cannot safely be written as simple integer grouping.
   */
  raster: SourcedCaptureModeFact<RasterDimensions>;
}
```

## FixedMultiFrameCaptureAcquisition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FixedMultiFrameCaptureAcquisition {
  kind: "fixed-multi-frame";
  frameCount: SourcedCaptureModeFact<number>;
}
```

## GroupedNativeCaptureSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GroupedNativeCaptureSampling {
  kind: "grouped-native-samples";
  groupWidthSamples: SourcedCaptureModeFact<number>;
  groupHeightSamples: SourcedCaptureModeFact<number>;
  /**
   * Omitted means "unknown, not stated". Do not guess where samples are
   * combined from the word "binning" or from the ratio of image sizes.
   */
  combinationDomain?: SourcedCaptureModeFact<CaptureModeSampleCombinationDomain>;
}
```

## NativeEffectiveCaptureSampling

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEffectiveCaptureSampling {
  kind: "native-effective-raster";
}
```

## parseCaptureModeProfile

Parses a capture-mode profile. Sensor physics is never guessed from output
resolution or marketing mode names.

The profile's parts are independent of each other: the frame sequence,
sampling within each frame, optional sensor shift between frames,
reconstruction stages, the processed image size and downstream dependencies.

```ts
export function parseCaptureModeProfile(
  value: unknown
): CaptureModeProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveCaptureMode

Resolves one capture mode against the selected sensor's native pixel grid.

Resolution changes do not change the physical sensor geometry. The returned
processed image size is before output, and must not be used to work out crop
factor, field of view or the physical photosite count.

```ts
export function resolveCaptureMode(
  input: ResolveCaptureModeInput
): ResolvedCaptureMode;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveCaptureModeInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveCaptureModeInput {
  nativeRaster: NativeImageRaster;
  profile: CaptureModeProfile;
  modeId: string;
}
```

## ResolvedCaptureMode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedCaptureMode {
  modeId: string;
  modeEvidence: readonly EvidenceProvenance[];
  nativeRaster: NativeImageRaster;
  nativeRasterSemantic:
    "effective-image-sampling-grid-not-photosite-count";
  acquisition:
    | {
        kind: "single-frame";
        frameCount: 1;
      }
    | {
        kind: "fixed-multi-frame";
        frameCount: SourcedCaptureModeFact<number>;
      }
    | {
        kind: "variable-multi-frame";
        evidence: readonly EvidenceProvenance[];
        minimumFrameCount?: SourcedCaptureModeFact<number>;
        maximumFrameCount?: SourcedCaptureModeFact<number>;
      };
  perFrameSampling:
    | {
        kind: "native-effective-raster";
        raster: NativeImageRaster;
      }
    | {
        kind: "grouped-native-samples";
        raster: RasterDimensions;
        groupWidthSamples: SourcedCaptureModeFact<number>;
        groupHeightSamples: SourcedCaptureModeFact<number>;
        combinationDomain?: SourcedCaptureModeFact<CaptureModeSampleCombinationDomain>;
      }
    | {
        kind: "declared-effective-raster";
        raster: SourcedCaptureModeFact<RasterDimensions>;
      };
  interFrameSensorOffsetsNativeSamples?: SourcedCaptureModeFact<
    readonly CaptureModeSensorOffsetNativeSamples[]
  >;
  reconstructionStages: readonly SourcedCaptureModeFact<CaptureModeReconstructionStage>[];
  processedImageRaster: SourcedCaptureModeFact<RasterDimensions>;
  processedImageMegapixels: number;
  dependencies: readonly CaptureModeDependency[];
  physicalSensorGeometryMutation: false;
  photositeCountInference:
    "not-permitted-from-native-or-processed-raster";
  finalOutputRasterOwnership:
    "downstream-capture-output-geometry";
}
```

## SingleFrameCaptureAcquisition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SingleFrameCaptureAcquisition {
  kind: "single-frame";
}
```

## SourcedCaptureModeFact

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SourcedCaptureModeFact<T> = EvidenceBackedFact<T>;
```

## VariableMultiFrameCaptureAcquisition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface VariableMultiFrameCaptureAcquisition {
  kind: "variable-multi-frame";
  /**
   * Evidence that the mode uses a variable number of frames, even when the
   * exact frame-count limits are not published.
   */
  evidence: readonly EvidenceProvenance[];
  minimumFrameCount?: SourcedCaptureModeFact<number>;
  maximumFrameCount?: SourcedCaptureModeFact<number>;
}
```
