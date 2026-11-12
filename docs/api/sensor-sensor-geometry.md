# sensor/sensor-geometry.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateImagingAreaMetrics

Calculates metrics of the physical imaging area, independent of pixel count.

Crop factor is the ratio of diagonals to a 36 × 24 mm reference frame. It
does not include any digital or output crop.

```ts
export function calculateImagingAreaMetrics(
  imagingArea: SensorImagingArea
): CalculationResult<ImagingAreaMetrics>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateSensorGeometryMetrics

Calculates metrics of the physical imaging area, the native pixel grid and
the sample spacing, keeping sensor size and resolution independent.

The grid is assumed to cover the whole imaging area. The derived pitch is
only the spacing between samples. Do not read it as the photosite's fill
factor or light-collecting area.

```ts
export function calculateSensorGeometryMetrics(
  input: CalculateSensorGeometryMetricsInput
): CalculationResult<SensorGeometryMetrics>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorGeometryMetricsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorGeometryMetricsInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
}
```

## ImagingAreaMetrics

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImagingAreaMetrics {
  /** Physical imaging-area diagonal in millimetres. */
  diagonalMm: number;
  /** Physical width divided by physical height. */
  aspectRatio: number;
  /**
   * Diagonal crop factor relative to a 36 × 24 mm reference frame.
   *
   * It describes the physical imaging area only, and does not include any
   * later digital or output crop.
   */
  cropFactor35Mm: number;
}
```

## NativeImageRaster

The native pixel grid of an imaging area.

This alias names the role. For other grids, such as active or output
images, use RasterDimensions.

```ts
export type NativeImageRaster = RasterDimensions;
```

## RasterDimensions

Width and height of an image grid in pixels.

Pixels here are image samples. That does not mean each sample matches one
physical photodiode (photosite).

```ts
export interface RasterDimensions {
  /** Horizontal image-sample/pixel count. */
  pixelWidth: number;
  /** Vertical image-sample/pixel count. */
  pixelHeight: number;
}
```

## SensorGeometryMetrics

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorGeometryMetrics {
  imagingArea: ImagingAreaMetrics;
  nativeRaster: {
    /** Exact product of native raster width and height. */
    totalImageSamples: number;
    /** Derived megapixels from the exact native raster. */
    megapixels: number;
    /** Native raster width divided by native raster height. */
    aspectRatio: number;
  };
  sampling: {
    /**
     * Horizontal sample spacing (pitch) in micrometres.
     *
     * This is the spacing between image samples, not the photodiode's active area.
     */
    pitchXMicrometers: number;
    /**
     * Vertical sample spacing (pitch) in micrometres.
     *
     * This is the spacing between image samples, not the photodiode's active area.
     */
    pitchYMicrometers: number;
    /** Horizontal sampling pitch divided by vertical sampling pitch. */
    pitchAspectRatio: number;
  };
}
```

## SensorImagingArea

The physical light-sensitive imaging area used for image formation.

It is deliberately not the size of the sensor package or die.

```ts
export interface SensorImagingArea {
  /** Physical active imaging width in millimetres. */
  widthMm: number;
  /** Physical active imaging height in millimetres. */
  heightMm: number;
}
```
