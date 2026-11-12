# color/camera-color-matrix.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CameraColorMatrixFit

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraColorMatrixFit {
  constraint: CameraMatrixFitConstraint;
  /** Row-major camera RGB → XYZ (XYZ white Y = 1; camera white green = 1). */
  cameraRgbToXyz: ColorMatrix3x3;
  xyzToCameraRgb: ColorMatrix3x3;
  illuminantWhiteXyz: CieXyzTristimulus;
  /** Camera response to the perfect diffuser (green = 1); its reciprocal gives neutral WB gains. */
  cameraWhiteRgb: ColorVector3;
  patches: readonly CameraMatrixPatchReport[];
  meanDeltaE2000: number;
  maximumDeltaE2000: number;
  /** Root-mean-square XYZ residual over all patches and components. */
  rmsXyzResidual: number;
}
```

## CameraMatrixFitConstraint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CameraMatrixFitConstraint = "least-squares" | "white-point-preserving-least-squares";
```

## CameraMatrixPatchReport

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraMatrixPatchReport {
  patchId: string;
  cameraRgb: ColorVector3;
  targetXyz: CieXyzTristimulus;
  predictedXyz: CieXyzTristimulus;
  deltaE2000: number;
}
```

## CameraMatrixTrainingPatch

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraMatrixTrainingPatch {
  patchId: string;
  reflectance: ColorimetricSpectrum;
}
```

## CameraSpectralSensitivities

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CameraSpectralSensitivities {
  red: ColorimetricSpectrum;
  green: ColorimetricSpectrum;
  blue: ColorimetricSpectrum;
}
```

## estimateCameraColorMatrix

Fits a camera-RGB → XYZ matrix from spectral sensitivities, training reflectances,
an illuminant and CMFs, and reports the per-patch CIEDE2000 residual.

```ts
export function estimateCameraColorMatrix(input: EstimateCameraColorMatrixInput): CalculationResult<CameraColorMatrixFit>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateCameraColorMatrixInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateCameraColorMatrixInput {
  quadratureNodes: readonly ColorimetricQuadratureNode[];
  illuminant: ColorimetricSpectrum;
  cameraSpectralSensitivities: CameraSpectralSensitivities;
  patches: readonly CameraMatrixTrainingPatch[];
  colorMatchingFunctions: ColorMatchingFunctionsSource;
  constraint: CameraMatrixFitConstraint;
}
```

## MAX_CAMERA_MATRIX_TRAINING_PATCHES

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
MAX_CAMERA_MATRIX_TRAINING_PATCHES = 10_000
```
