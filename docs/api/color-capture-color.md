# color/capture-color.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateCaptureColorTransform

Converts a bounded inline XYZ (ideal-camera) plane to unclamped linear sRGB.
It reuses the resolved white-balance intent. It never estimates the lighting and never changes
exposure or noise. Adapting to the adopted white (XYZ diagonal by default, or an explicit
Bradford or CAT16 cone-space transform) is labelled an approximation, and
is separate from RGB gains.

```ts
export function calculateCaptureColorTransform(input: CaptureColorTransformInput): CalculationResult<CaptureColorTransformResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CAPTURE_COLOR_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CAPTURE_COLOR_MODEL_VERSION = "0.1.0" as const
```

## CaptureChromaticAdaptationTransform

Cone-space transform for adapting to the adopted white. If omitted, the original
XYZ-diagonal scaling (model id `photivra-xyz-diagonal-adaptation`) is used unchanged.

```ts
export type CaptureChromaticAdaptationTransform = "bradford" | "cat16";
```

## CaptureColorModel

Profile data gives callers the complete row-major matrices and the conditions where they apply.

```ts
export interface CaptureColorModel {
  version: typeof CAPTURE_COLOR_MODEL_VERSION;
  cameraProfile: CapturePublicProfileReference;
  outputProfile: CapturePublicProfileReference;
  referenceIlluminant: "D65";
  observer: "cie-1931-2-degree";
  referenceWhiteXyz: { x: number; y: 1; z: number };
  cameraRgbToXyz: Matrix;
  xyzToCameraRgb: Matrix;
  scientificStatus: "calculated";
  validConditions: readonly string[];
  publicEvidenceIds: readonly string[];
}
```

## CaptureColorTransformInput

IDs name a new derived plane. The source capture is never changed.

```ts
export interface CaptureColorTransformInput {
  capture: SimulatedCapture;
  sourcePlaneId: string;
  outputPlaneId: string;
  outputImageStateId: string;
  whiteBalance: CaptureColorWhiteBalance;
}
```

## CaptureColorTransformResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureColorTransformResult {
  plane: CaptureLinearPlane;
  colorModel: CaptureColorModel;
  sourcePlaneId: string;
  sourceImageStateId: string;
  whiteBalance: CaptureColorWhiteBalance;
  /** Matrix on CIE XYZ, identity when no adaptation; row-major, dimensionless. */
  chromaticAdaptationMatrix: Matrix;
  /** False: under mixed lighting, even scaling to the adopted white is a choice the camera makes. */
  claimsUniqueSceneWhite: false;
}
```

## CaptureColorWhiteBalance

One explicit colour interpretation. Gains and adaptation cannot both apply white balance by accident.

```ts
export type CaptureColorWhiteBalance =
  | { kind: "preserve-intent" }
  | { kind: "apply-resolved-rgb-gains"; channelBasis: CapturePublicProfileReference }
  | { kind: "adopted-white-xyz-scaling"; transform?: CaptureChromaticAdaptationTransform };
```

## LINEAR_CAPTURE_RGB_PROFILE

Linear light with sRGB primaries and a D65 white. No sRGB transfer curve is applied.

```ts
LINEAR_CAPTURE_RGB_PROFILE = Object.freeze({ id: "linear-srgb-d65", version: CAPTURE_COLOR_MODEL_VERSION })
```

## parseCaptureColorTransformInput

Validates the whole capture and its explicit transform policy, read from untrusted JSON.

```ts
export function parseCaptureColorTransformInput(value: unknown): CaptureColorTransformInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveCaptureColorModel

Returns the versioned ideal camera basis, independent of rendering/serializer state.

```ts
export function resolveCaptureColorModel(): CaptureColorModel;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## VIRTUAL_COLOR_CAMERA_PROFILE

Explicit ideal colorimetric camera, not measured spectral sensor channels.

```ts
VIRTUAL_COLOR_CAMERA_PROFILE = Object.freeze({ id: "photivra-colorimetric-rgb-d65", version: CAPTURE_COLOR_MODEL_VERSION })
```
