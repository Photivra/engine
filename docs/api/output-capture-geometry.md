# output/capture-geometry.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ActiveCaptureFieldOfView

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ActiveCaptureFieldOfView {
  orientation: CaptureOrientation;
  horizontalDegrees: number;
  verticalDegrees: number;
  /**
   * The larger of the two corner-to-corner diagonal angles. For a centred
   * crop the two diagonals are equal.
   */
  diagonalDegrees: number;
  horizontalBoundsDegrees: {
    minimum: number;
    maximum: number;
  };
  verticalBoundsDegrees: {
    minimum: number;
    maximum: number;
  };
  diagonalDegreesByCornerPair: {
    topLeftToBottomRight: number;
    topRightToBottomLeft: number;
  };
  activeImagingArea: SensorImagingArea;
  centerOffsetFromOpticalAxisMm: RasterVector;
  projection: {
    projectionDistanceMm: number;
    provenance: CalculationProvenance;
  };
}
```

## calculateActiveCaptureFieldOfView

Calculates the field of view (FOV) of the active physical capture area after
camera orientation. Horizontal and vertical FOV can be asymmetric about the
optical axis; both corner-to-corner diagonals are reported.

The final digital (output) crop is deliberately not included.

```ts
export function calculateActiveCaptureFieldOfView(
  input: CalculateActiveCaptureFieldOfViewInput
): CalculationResult<ActiveCaptureFieldOfView>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateActiveCaptureFieldOfViewInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateActiveCaptureFieldOfViewInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
  activeCaptureRect?: RasterRect;
  focalLengthMm: number;
  focusDistanceM?: number;
}
```

## calculateOutputFieldOfView

Calculates the final visible field of view after the active capture area,
orientation and digital (output) crop. Output resolution does not affect it.

```ts
export function calculateOutputFieldOfView(
  input: CalculateOutputFieldOfViewInput
): CalculationResult<OutputFieldOfView>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateOutputFieldOfViewInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateOutputFieldOfViewInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
  activeCaptureRect?: RasterRect;
  outputCropRect?: RasterRect;
  focalLengthMm: number;
  focusDistanceM?: number;
}
```

## CaptureOrientation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CaptureOrientation =
  | "landscape"
  | "portrait-clockwise"
  | "landscape-inverted"
  | "portrait-counter-clockwise";
```

## ImagePlaneMetricPointMm

A point on the optical image plane, in millimetres, before camera orientation is applied.

The origin is the optical axis. +X points right and +Y points up.

```ts
export interface ImagePlaneMetricPointMm {
  x: number;
  y: number;
}
```

## mapImagePlanePointToOrientedPhysicalUv

Maps an optical image-plane point (before camera orientation) to normalized
coordinates in an oriented physical image region.

This is the exact inverse of mapOrientedPhysicalUvToImagePlanePoint(). A point
outside the region is rejected. A tiny tolerance only absorbs floating-point
round-trip error at an edge.

```ts
export function mapImagePlanePointToOrientedPhysicalUv(
  input: MapImagePlanePointToOrientedPhysicalUvInput
): NormalizedRasterUv;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MapImagePlanePointToOrientedPhysicalUvInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MapImagePlanePointToOrientedPhysicalUvInput {
  imagePlanePointMm: ImagePlaneMetricPointMm;
  /**
   * Physical region represented by the normalized raster, after physical
   * camera orientation, using the capture contract's +Y-down physical basis.
   */
  orientedPhysicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
  orientation: CaptureOrientation;
}
```

## MapOrientedPhysicalUvToImagePlaneInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MapOrientedPhysicalUvToImagePlaneInput {
  uv: NormalizedRasterUv;
  /**
   * Physical region represented by the normalized raster, after physical
   * camera orientation, using the capture contract's +Y-down physical basis.
   */
  orientedPhysicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
  orientation: CaptureOrientation;
}
```

## mapOrientedPhysicalUvToImagePlanePoint

Maps normalized (0–1) coordinates in an oriented physical image region to the
optical image plane used by the lens-field and camera-mapping APIs, before
camera orientation.

The input bounds are after camera orientation and use +Y down. The returned
point has its origin on the optical axis, with +X right and +Y up. No lens or
projection equation is applied.

```ts
export function mapOrientedPhysicalUvToImagePlanePoint(
  input: MapOrientedPhysicalUvToImagePlaneInput
): ImagePlaneMetricPointMm;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NormalizedRasterUv

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NormalizedRasterUv {
  /** 0 at the left edge, 1 at the right edge. */
  u: number;
  /** 0 at the top edge, 1 at the bottom edge. */
  v: number;
}
```

## OutputFieldOfView

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface OutputFieldOfView {
  orientation: CaptureOrientation;
  horizontalDegrees: number;
  verticalDegrees: number;
  diagonalDegrees: number;
  horizontalBoundsDegrees: {
    minimum: number;
    maximum: number;
  };
  verticalBoundsDegrees: {
    minimum: number;
    maximum: number;
  };
  diagonalDegreesByCornerPair: {
    topLeftToBottomRight: number;
    topRightToBottomLeft: number;
  };
  outputImagingArea: SensorImagingArea;
  centerOffsetFromOpticalAxisMm: RasterVector;
  projection: {
    projectionDistanceMm: number;
    provenance: CalculationProvenance;
  };
}
```

## PhysicalBoundsFromOpticalAxisMm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PhysicalBoundsFromOpticalAxisMm {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
```

## RasterPoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RasterPoint {
  x: number;
  y: number;
}
```

## RasterRect

Integer half-open rectangle in raster coordinates.

Coordinates use a top-left origin with +X to the right and +Y downward.
The covered extent is [x, x + width) × [y, y + height).

```ts
export interface RasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## RasterVector

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RasterVector {
  x: number;
  y: number;
}
```

## resolveCaptureGeometry

Resolves native sensor geometry, active capture area, physical camera orientation
and final digital (output) geometry, keeping each one distinct.

```ts
export function resolveCaptureGeometry(
  input: ResolveCaptureGeometryInput
): CalculationResult<ResolvedCaptureGeometry>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveCaptureGeometryInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveCaptureGeometryInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
  /**
   * Active capture rectangle in native sensor raster coordinates.
   *
   * Defaults to the full native raster.
   */
  activeCaptureRect?: RasterRect;
  /**
   * Final digital (output) crop, in oriented active-capture pixel coordinates.
   *
   * Defaults to the full oriented active capture.
   */
  outputCropRect?: RasterRect;
  /**
   * Final output image size after the optional digital crop and resampling.
   *
   * Defaults to the output-crop size. The output must keep the crop's aspect
   * ratio, allowing only a small tolerance for integer rounding.
   */
  outputRaster?: RasterDimensions;
}
```

## ResolvedCaptureGeometry

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedCaptureGeometry {
  native: {
    imagingArea: SensorImagingArea;
    raster: NativeImageRaster;
  };
  activeCapture: {
    nativeRect: RasterRect;
    imagingArea: SensorImagingArea;
    /**
     * Top-left active-area offset from the native imaging-area top-left.
     */
    physicalOffsetMm: {
      x: number;
      y: number;
    };
    /** Active-area center relative to the native optical axis. */
    centerOffsetFromOpticalAxisMm: RasterVector;
    /** Native physical bounds relative to the optical axis. */
    physicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
    /**
     * The current generic model assumes the native pixels evenly cover the
     * declared physical imaging area.
     */
    imagingAreaDerivation: "uniform-native-raster";
    raster: RasterDimensions;
  };
  orientedCapture: {
    orientation: CaptureOrientation;
    imagingArea: SensorImagingArea;
    /** Oriented physical bounds relative to the optical axis. */
    physicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
    raster: RasterDimensions;
  };
  output: {
    /**
     * Digital (output) crop, in oriented active-capture coordinates.
     *
     * This crop does not change the physical sensor or the active-capture
     * geometry.
     */
    cropRect: RasterRect;
    raster: RasterDimensions;
    /** Physical region retained by the digital/output crop. */
    imagingArea: SensorImagingArea;
    physicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
    centerOffsetFromOpticalAxisMm: RasterVector;
    sourceRetainedAreaFraction: number;
    /** Pixel resampling from the oriented active capture to the output image. */
    orientedCaptureToOutputScale: {
      x: number;
      y: number;
      axisRelativeDifference: number;
    };
  };
}
```

## transformNativeRasterPointToOriented

Converts a point in native pixel coordinates to oriented capture coordinates.
Coordinates are continuous and measured from pixel edges, so a pixel centre is at +0.5.

```ts
export function transformNativeRasterPointToOriented(
  input: TransformRasterPointInput
): RasterPoint;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## transformNativeRasterRectToOriented

Transforms an integer half-open native raster rectangle into oriented coordinates.

```ts
export function transformNativeRasterRectToOriented(
  input: TransformRasterRectInput
): RasterRect;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## transformNativeRasterVectorToOriented

Rotates a native raster vector into oriented coordinates.

```ts
export function transformNativeRasterVectorToOriented(
  input: TransformRasterVectorInput
): RasterVector;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## transformOrientedRasterPointToNative

Converts a point in oriented pixel coordinates (measured from pixel edges) back to native coordinates.

```ts
export function transformOrientedRasterPointToNative(
  input: TransformRasterPointInput
): RasterPoint;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## transformOrientedRasterRectToNative

Transforms an oriented integer half-open rectangle back to native coordinates.

```ts
export function transformOrientedRasterRectToNative(
  input: TransformRasterRectInput
): RasterRect;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## transformOrientedRasterVectorToNative

Rotates an oriented raster vector back into native coordinates.

```ts
export function transformOrientedRasterVectorToNative(
  input: TransformRasterVectorInput
): RasterVector;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## TransformRasterPointInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TransformRasterPointInput {
  point: RasterPoint;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
}
```

## TransformRasterRectInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TransformRasterRectInput {
  rect: RasterRect;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
}
```

## TransformRasterVectorInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface TransformRasterVectorInput {
  vector: RasterVector;
  orientation: CaptureOrientation;
}
```
