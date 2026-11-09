// SPDX-License-Identifier: Apache-2.0

/**
 * Capture geometry: how the native sensor, the active capture area, the camera's physical
 * orientation and the final output crop relate to each other.
 *
 * It converts points, vectors and rectangles between native and oriented pixel coordinates,
 * maps oriented positions to the optical image plane and back, and computes field of view (FOV)
 * for the active capture and the final output.
 * @see docs/PHYSICS_FOUNDATION.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  calculateFieldOfViewBounds
} from "../camera/field-of-view.js";
import {
  calculatedResult,
  type CalculationProvenance,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite,
  requirePositiveInteger
} from "../core/validation.js";
import {
  type NativeImageRaster,
  type RasterDimensions,
  type SensorImagingArea
} from "../sensor/sensor-geometry.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { fullRect } from "../core/shared-helpers.js";

export type CaptureOrientation =
  | "landscape"
  | "portrait-clockwise"
  | "landscape-inverted"
  | "portrait-counter-clockwise";

const CAPTURE_ORIENTATIONS = new Set<CaptureOrientation>([
  "landscape",
  "portrait-clockwise",
  "landscape-inverted",
  "portrait-counter-clockwise"
]);

export interface RasterPoint {
  x: number;
  y: number;
}

export interface RasterVector {
  x: number;
  y: number;
}

/**
 * Integer half-open rectangle in raster coordinates.
 *
 * Coordinates use a top-left origin with +X to the right and +Y downward.
 * The covered extent is [x, x + width) × [y, y + height).
 */
export interface RasterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhysicalBoundsFromOpticalAxisMm {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface NormalizedRasterUv {
  /** 0 at the left edge, 1 at the right edge. */
  u: number;
  /** 0 at the top edge, 1 at the bottom edge. */
  v: number;
}

/**
 * A point on the optical image plane, in millimetres, before camera orientation is applied.
 *
 * The origin is the optical axis. +X points right and +Y points up.
 */
export interface ImagePlaneMetricPointMm {
  x: number;
  y: number;
}

export interface MapOrientedPhysicalUvToImagePlaneInput {
  uv: NormalizedRasterUv;
  /**
   * Physical region represented by the normalized raster, after physical
   * camera orientation, using the capture contract's +Y-down physical basis.
   */
  orientedPhysicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
  orientation: CaptureOrientation;
}

export interface MapImagePlanePointToOrientedPhysicalUvInput {
  imagePlanePointMm: ImagePlaneMetricPointMm;
  /**
   * Physical region represented by the normalized raster, after physical
   * camera orientation, using the capture contract's +Y-down physical basis.
   */
  orientedPhysicalBoundsFromOpticalAxisMm: PhysicalBoundsFromOpticalAxisMm;
  orientation: CaptureOrientation;
}

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

export interface TransformRasterPointInput {
  point: RasterPoint;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
}

export interface TransformRasterVectorInput {
  vector: RasterVector;
  orientation: CaptureOrientation;
}

export interface TransformRasterRectInput {
  rect: RasterRect;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
}

export interface CalculateActiveCaptureFieldOfViewInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
  activeCaptureRect?: RasterRect;
  focalLengthMm: number;
  focusDistanceM?: number;
}

export interface CalculateOutputFieldOfViewInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  orientation: CaptureOrientation;
  activeCaptureRect?: RasterRect;
  outputCropRect?: RasterRect;
  focalLengthMm: number;
  focusDistanceM?: number;
}

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

function requireCaptureOrientation(
  value: unknown
): asserts value is CaptureOrientation {
  if (
    typeof value !== "string" ||
    !CAPTURE_ORIENTATIONS.has(value as CaptureOrientation)
  ) {
    throw new InvalidConfigurationError("orientation is invalid.");
  }
}

function requireRasterDimensions(
  name: string,
  raster: RasterDimensions
): void {
  requireInputObject(raster, name);
  requirePositiveInteger(`${name}.pixelWidth`, raster.pixelWidth);
  requirePositiveInteger(`${name}.pixelHeight`, raster.pixelHeight);
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidScientificInputError(
      `${name} must be a non-negative safe integer.`
    );
  }
}

function validateRasterRect(
  name: string,
  rect: RasterRect,
  bounds: RasterDimensions
): void {
  requireInputObject(rect, name);
  requireNonNegativeInteger(`${name}.x`, rect.x);
  requireNonNegativeInteger(`${name}.y`, rect.y);
  requirePositiveInteger(`${name}.width`, rect.width);
  requirePositiveInteger(`${name}.height`, rect.height);

  if (
    rect.x + rect.width > bounds.pixelWidth ||
    rect.y + rect.height > bounds.pixelHeight
  ) {
    throw new InvalidScientificInputError(
      `${name} must fit entirely within its raster bounds.`
    );
  }
}

function validateRasterPoint(
  name: string,
  point: RasterPoint,
  bounds: RasterDimensions
): void {
  requireInputObject(point, name);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new InvalidScientificInputError(
      `${name} coordinates must be finite.`
    );
  }
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x > bounds.pixelWidth ||
    point.y > bounds.pixelHeight
  ) {
    throw new InvalidScientificInputError(
      `${name} must lie within the raster edge-coordinate bounds.`
    );
  }
}

function validateRasterVector(name: string, vector: RasterVector): void {
  requireInputObject(vector, name);
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    throw new InvalidScientificInputError(
      `${name} coordinates must be finite.`
    );
  }
}

const PHYSICAL_EDGE_TOLERANCE_ULPS = 16;

function physicalCoordinateTolerance(
  value: number,
  minimum: number,
  maximum: number
): number {
  const span = maximum - minimum;
  const scale = Math.max(
    Math.abs(value),
    Math.abs(minimum),
    Math.abs(maximum),
    Math.abs(span),
    Number.MIN_VALUE
  );
  return Number.EPSILON * PHYSICAL_EDGE_TOLERANCE_ULPS * scale;
}

function validatePhysicalBounds(
  name: string,
  bounds: PhysicalBoundsFromOpticalAxisMm
): void {
  requireInputObject(bounds, name);
  for (const key of ["left", "right", "top", "bottom"] as const) {
    if (!Number.isFinite(bounds[key])) {
      throw new InvalidScientificInputError(
        `${name}.${key} must be finite.`
      );
    }
  }
  if (bounds.right <= bounds.left) {
    throw new InvalidScientificInputError(
      `${name} must have right greater than left.`
    );
  }
  if (bounds.bottom <= bounds.top) {
    throw new InvalidScientificInputError(
      `${name} must have bottom greater than top.`
    );
  }

  const horizontalSpan = bounds.right - bounds.left;
  const verticalSpan = bounds.bottom - bounds.top;
  if (
    !Number.isFinite(horizontalSpan) ||
    !Number.isFinite(verticalSpan) ||
    horizontalSpan <=
      physicalCoordinateTolerance(bounds.left, bounds.left, bounds.right) ||
    verticalSpan <=
      physicalCoordinateTolerance(bounds.top, bounds.top, bounds.bottom)
  ) {
    throw new InvalidScientificInputError(
      `${name} must have numerically resolvable finite spans relative to the optical-axis coordinate magnitude.`
    );
  }
}

function validateNormalizedUv(name: string, uv: NormalizedRasterUv): void {
  requireInputObject(uv, name);
  if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) {
    throw new InvalidScientificInputError(
      `${name} coordinates must be finite.`
    );
  }
  if (uv.u < 0 || uv.u > 1 || uv.v < 0 || uv.v > 1) {
    throw new InvalidScientificInputError(
      `${name} coordinates must lie within [0, 1].`
    );
  }
}

function normalizePhysicalCoordinateToUv(
  name: string,
  value: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) {
    throw new InvalidScientificInputError(`${name} must be finite.`);
  }

  const span = maximum - minimum;
  const tolerance = physicalCoordinateTolerance(
    value,
    minimum,
    maximum
  );

  if (value < minimum - tolerance || value > maximum + tolerance) {
    throw new InvalidScientificInputError(
      `${name} must lie within the supplied oriented physical bounds.`
    );
  }

  const clamped = Math.max(minimum, Math.min(maximum, value));
  return (clamped - minimum) / span;
}

function orientRaster(
  raster: RasterDimensions,
  orientation: CaptureOrientation
): RasterDimensions {
  return orientation === "portrait-clockwise" ||
    orientation === "portrait-counter-clockwise"
    ? {
        pixelWidth: raster.pixelHeight,
        pixelHeight: raster.pixelWidth
      }
    : {
        pixelWidth: raster.pixelWidth,
        pixelHeight: raster.pixelHeight
      };
}

function rotateVector(
  vector: RasterVector,
  orientation: CaptureOrientation
): RasterVector {
  switch (orientation) {
    case "landscape":
      return { x: vector.x, y: vector.y };
    case "portrait-clockwise":
      return { x: -vector.y, y: vector.x };
    case "landscape-inverted":
      return { x: -vector.x, y: -vector.y };
    case "portrait-counter-clockwise":
      return { x: vector.y, y: -vector.x };
  }
}

function inverseRotateVector(
  vector: RasterVector,
  orientation: CaptureOrientation
): RasterVector {
  switch (orientation) {
    case "landscape":
      return { x: vector.x, y: vector.y };
    case "portrait-clockwise":
      return { x: vector.y, y: -vector.x };
    case "landscape-inverted":
      return { x: -vector.x, y: -vector.y };
    case "portrait-counter-clockwise":
      return { x: -vector.y, y: vector.x };
  }
}

/**
 * Converts a point in native pixel coordinates to oriented capture coordinates.
 * Coordinates are continuous and measured from pixel edges, so a pixel centre is at +0.5.
 */
export function transformNativeRasterPointToOriented(
  input: TransformRasterPointInput
): RasterPoint {
  requireInputKeys(input, "transformNativeRasterPointToOriented", ["point", "nativeRaster", "orientation"]);
  requireCaptureOrientation(input.orientation);
  requireRasterDimensions("nativeRaster", input.nativeRaster);
  validateRasterPoint("point", input.point, input.nativeRaster);

  const { pixelWidth: width, pixelHeight: height } = input.nativeRaster;
  switch (input.orientation) {
    case "landscape":
      return { ...input.point };
    case "portrait-clockwise":
      return { x: height - input.point.y, y: input.point.x };
    case "landscape-inverted":
      return { x: width - input.point.x, y: height - input.point.y };
    case "portrait-counter-clockwise":
      return { x: input.point.y, y: width - input.point.x };
  }
}

/** Converts a point in oriented pixel coordinates (measured from pixel edges) back to native coordinates. */
export function transformOrientedRasterPointToNative(
  input: TransformRasterPointInput
): RasterPoint {
  requireInputKeys(input, "transformOrientedRasterPointToNative", ["point", "nativeRaster", "orientation"]);
  requireCaptureOrientation(input.orientation);
  requireRasterDimensions("nativeRaster", input.nativeRaster);
  const orientedRaster = orientRaster(input.nativeRaster, input.orientation);
  validateRasterPoint("point", input.point, orientedRaster);

  const { pixelWidth: width, pixelHeight: height } = input.nativeRaster;
  switch (input.orientation) {
    case "landscape":
      return { ...input.point };
    case "portrait-clockwise":
      return { x: input.point.y, y: height - input.point.x };
    case "landscape-inverted":
      return { x: width - input.point.x, y: height - input.point.y };
    case "portrait-counter-clockwise":
      return { x: width - input.point.y, y: input.point.x };
  }
}

/** Rotates a native raster vector into oriented coordinates. */
export function transformNativeRasterVectorToOriented(
  input: TransformRasterVectorInput
): RasterVector {
  requireInputKeys(input, "transformNativeRasterVectorToOriented", ["vector", "orientation"]);
  requireCaptureOrientation(input.orientation);
  validateRasterVector("vector", input.vector);
  return rotateVector(input.vector, input.orientation);
}

/** Rotates an oriented raster vector back into native coordinates. */
export function transformOrientedRasterVectorToNative(
  input: TransformRasterVectorInput
): RasterVector {
  requireInputKeys(input, "transformOrientedRasterVectorToNative", ["vector", "orientation"]);
  requireCaptureOrientation(input.orientation);
  validateRasterVector("vector", input.vector);
  return inverseRotateVector(input.vector, input.orientation);
}

/**
 * Maps normalized (0–1) coordinates in an oriented physical image region to the
 * optical image plane used by the lens-field and camera-mapping APIs, before
 * camera orientation.
 *
 * The input bounds are after camera orientation and use +Y down. The returned
 * point has its origin on the optical axis, with +X right and +Y up. No lens or
 * projection equation is applied.
 */
export function mapOrientedPhysicalUvToImagePlanePoint(
  input: MapOrientedPhysicalUvToImagePlaneInput
): ImagePlaneMetricPointMm {
  requireInputKeys(input, "mapOrientedPhysicalUvToImagePlanePoint", ["uv", "orientedPhysicalBoundsFromOpticalAxisMm", "orientation"]);
  requireCaptureOrientation(input.orientation);
  validateNormalizedUv("uv", input.uv);
  validatePhysicalBounds(
    "orientedPhysicalBoundsFromOpticalAxisMm",
    input.orientedPhysicalBoundsFromOpticalAxisMm
  );

  const bounds = input.orientedPhysicalBoundsFromOpticalAxisMm;
  const orientedPhysicalPoint = {
    x: bounds.left + input.uv.u * (bounds.right - bounds.left),
    y: bounds.top + input.uv.v * (bounds.bottom - bounds.top)
  };
  const nativePhysicalPoint = inverseRotateVector(
    orientedPhysicalPoint,
    input.orientation
  );

  return {
    x: nativePhysicalPoint.x,
    y: -nativePhysicalPoint.y
  };
}

/**
 * Maps an optical image-plane point (before camera orientation) to normalized
 * coordinates in an oriented physical image region.
 *
 * This is the exact inverse of mapOrientedPhysicalUvToImagePlanePoint(). A point
 * outside the region is rejected. A tiny tolerance only absorbs floating-point
 * round-trip error at an edge.
 */
export function mapImagePlanePointToOrientedPhysicalUv(
  input: MapImagePlanePointToOrientedPhysicalUvInput
): NormalizedRasterUv {
  requireInputKeys(input, "mapImagePlanePointToOrientedPhysicalUv", ["imagePlanePointMm", "orientedPhysicalBoundsFromOpticalAxisMm", "orientation"]);
  requireCaptureOrientation(input.orientation);
  validateRasterVector("imagePlanePointMm", input.imagePlanePointMm);
  validatePhysicalBounds(
    "orientedPhysicalBoundsFromOpticalAxisMm",
    input.orientedPhysicalBoundsFromOpticalAxisMm
  );

  const bounds = input.orientedPhysicalBoundsFromOpticalAxisMm;
  const nativePhysicalPoint = {
    x: input.imagePlanePointMm.x,
    y: -input.imagePlanePointMm.y
  };
  const orientedPhysicalPoint = rotateVector(
    nativePhysicalPoint,
    input.orientation
  );
  return {
    u: normalizePhysicalCoordinateToUv(
      "imagePlanePointMm.x",
      orientedPhysicalPoint.x,
      bounds.left,
      bounds.right
    ),
    v: normalizePhysicalCoordinateToUv(
      "imagePlanePointMm.y",
      orientedPhysicalPoint.y,
      bounds.top,
      bounds.bottom
    )
  };
}

/** Transforms an integer half-open native raster rectangle into oriented coordinates. */
export function transformNativeRasterRectToOriented(
  input: TransformRasterRectInput
): RasterRect {
  requireInputKeys(input, "transformNativeRasterRectToOriented", ["rect", "nativeRaster", "orientation"]);
  requireCaptureOrientation(input.orientation);
  requireRasterDimensions("nativeRaster", input.nativeRaster);
  validateRasterRect("rect", input.rect, input.nativeRaster);

  const { pixelWidth: width, pixelHeight: height } = input.nativeRaster;
  const { x, y, width: rectWidth, height: rectHeight } = input.rect;
  switch (input.orientation) {
    case "landscape":
      return { ...input.rect };
    case "portrait-clockwise":
      return {
        x: height - (y + rectHeight),
        y: x,
        width: rectHeight,
        height: rectWidth
      };
    case "landscape-inverted":
      return {
        x: width - (x + rectWidth),
        y: height - (y + rectHeight),
        width: rectWidth,
        height: rectHeight
      };
    case "portrait-counter-clockwise":
      return {
        x: y,
        y: width - (x + rectWidth),
        width: rectHeight,
        height: rectWidth
      };
  }
}

/** Transforms an oriented integer half-open rectangle back to native coordinates. */
export function transformOrientedRasterRectToNative(
  input: TransformRasterRectInput
): RasterRect {
  requireInputKeys(input, "transformOrientedRasterRectToNative", ["rect", "nativeRaster", "orientation"]);
  requireCaptureOrientation(input.orientation);
  requireRasterDimensions("nativeRaster", input.nativeRaster);
  const orientedRaster = orientRaster(input.nativeRaster, input.orientation);
  validateRasterRect("rect", input.rect, orientedRaster);

  const { pixelWidth: width, pixelHeight: height } = input.nativeRaster;
  const { x, y, width: rectWidth, height: rectHeight } = input.rect;
  switch (input.orientation) {
    case "landscape":
      return { ...input.rect };
    case "portrait-clockwise":
      return {
        x: y,
        y: height - (x + rectWidth),
        width: rectHeight,
        height: rectWidth
      };
    case "landscape-inverted":
      return {
        x: width - (x + rectWidth),
        y: height - (y + rectHeight),
        width: rectWidth,
        height: rectHeight
      };
    case "portrait-counter-clockwise":
      return {
        x: width - (y + rectHeight),
        y: x,
        width: rectHeight,
        height: rectWidth
      };
  }
}

function nativePhysicalBoundsFromRect(
  imagingArea: SensorImagingArea,
  nativeRaster: NativeImageRaster,
  rect: RasterRect
): PhysicalBoundsFromOpticalAxisMm {
  const pitchX = imagingArea.widthMm / nativeRaster.pixelWidth;
  const pitchY = imagingArea.heightMm / nativeRaster.pixelHeight;

  return {
    left: rect.x * pitchX - imagingArea.widthMm / 2,
    right:
      (rect.x + rect.width) * pitchX - imagingArea.widthMm / 2,
    top: rect.y * pitchY - imagingArea.heightMm / 2,
    bottom:
      (rect.y + rect.height) * pitchY - imagingArea.heightMm / 2
  };
}

function orientPhysicalBounds(
  bounds: PhysicalBoundsFromOpticalAxisMm,
  orientation: CaptureOrientation
): PhysicalBoundsFromOpticalAxisMm {
  const corners = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom }
  ].map((corner) => rotateVector(corner, orientation));

  return {
    left: Math.min(...corners.map((corner) => corner.x)),
    right: Math.max(...corners.map((corner) => corner.x)),
    top: Math.min(...corners.map((corner) => corner.y)),
    bottom: Math.max(...corners.map((corner) => corner.y))
  };
}

function physicalBoundsFromRectWithinBounds(
  sourceBounds: PhysicalBoundsFromOpticalAxisMm,
  sourceRaster: RasterDimensions,
  rect: RasterRect
): PhysicalBoundsFromOpticalAxisMm {
  const pitchX =
    (sourceBounds.right - sourceBounds.left) / sourceRaster.pixelWidth;
  const pitchY =
    (sourceBounds.bottom - sourceBounds.top) / sourceRaster.pixelHeight;

  return {
    left: sourceBounds.left + rect.x * pitchX,
    right: sourceBounds.left + (rect.x + rect.width) * pitchX,
    top: sourceBounds.top + rect.y * pitchY,
    bottom: sourceBounds.top + (rect.y + rect.height) * pitchY
  };
}

function validateOutputAspectRatio(
  cropRect: RasterRect,
  outputRaster: RasterDimensions
): void {
  // Keep one scale factor for both axes. Allow only the sub-pixel mismatch that
  // comes from rounding an ideal scaled size to whole pixels. A fixed percentage
  // tolerance would allow visible stretching along one axis at large sizes.
  const widthScaleMinimum =
    (outputRaster.pixelWidth - 0.5) / cropRect.width;
  const widthScaleMaximum =
    (outputRaster.pixelWidth + 0.5) / cropRect.width;
  const heightScaleMinimum =
    (outputRaster.pixelHeight - 0.5) / cropRect.height;
  const heightScaleMaximum =
    (outputRaster.pixelHeight + 0.5) / cropRect.height;

  const minimumCommonScale = Math.max(
    widthScaleMinimum,
    heightScaleMinimum
  );
  const maximumCommonScale = Math.min(
    widthScaleMaximum,
    heightScaleMaximum
  );

  if (minimumCommonScale > maximumCommonScale) {
    throw new InvalidScientificInputError(
      "outputRaster must preserve outputCropRect aspect ratio within nearest-integer raster rounding; implicit geometric stretching is not supported."
    );
  }
}

function angleBetweenSensorRaysDegrees(
  first: RasterVector,
  second: RasterVector,
  projectionDistanceMm: number
): number {
  const firstLength = Math.hypot(
    first.x,
    first.y,
    projectionDistanceMm
  );
  const secondLength = Math.hypot(
    second.x,
    second.y,
    projectionDistanceMm
  );
  const dot =
    first.x * second.x +
    first.y * second.y +
    projectionDistanceMm * projectionDistanceMm;
  const cosine = Math.max(
    -1,
    Math.min(1, dot / (firstLength * secondLength))
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function calculateBoundsFieldOfView(
  bounds: PhysicalBoundsFromOpticalAxisMm,
  focalLengthMm: number,
  focusDistanceM: number | undefined
): {
  horizontalDegrees: number;
  verticalDegrees: number;
  diagonalDegrees: number;
  horizontalBoundsDegrees: { minimum: number; maximum: number };
  verticalBoundsDegrees: { minimum: number; maximum: number };
  diagonalDegreesByCornerPair: {
    topLeftToBottomRight: number;
    topRightToBottomLeft: number;
  };
  projection: {
    projectionDistanceMm: number;
    provenance: CalculationProvenance;
  };
} {
  const fovInput = {
    focalLengthMm,
    ...(focusDistanceM === undefined ? {} : { focusDistanceM })
  };
  const horizontal = calculateFieldOfViewBounds({
    ...fovInput,
    minimumSensorCoordinateMm: bounds.left,
    maximumSensorCoordinateMm: bounds.right
  });
  const vertical = calculateFieldOfViewBounds({
    ...fovInput,
    minimumSensorCoordinateMm: bounds.top,
    maximumSensorCoordinateMm: bounds.bottom
  });
  const projectionDistanceMm = horizontal.value.projectionDistanceMm;
  const topLeft = { x: bounds.left, y: bounds.top };
  const topRight = { x: bounds.right, y: bounds.top };
  const bottomRight = { x: bounds.right, y: bounds.bottom };
  const bottomLeft = { x: bounds.left, y: bounds.bottom };
  const topLeftToBottomRight = angleBetweenSensorRaysDegrees(
    topLeft,
    bottomRight,
    projectionDistanceMm
  );
  const topRightToBottomLeft = angleBetweenSensorRaysDegrees(
    topRight,
    bottomLeft,
    projectionDistanceMm
  );

  return {
    horizontalDegrees: horizontal.value.degrees,
    verticalDegrees: vertical.value.degrees,
    diagonalDegrees: Math.max(
      topLeftToBottomRight,
      topRightToBottomLeft
    ),
    horizontalBoundsDegrees: {
      minimum: horizontal.value.minimumDegrees,
      maximum: horizontal.value.maximumDegrees
    },
    verticalBoundsDegrees: {
      minimum: vertical.value.minimumDegrees,
      maximum: vertical.value.maximumDegrees
    },
    diagonalDegreesByCornerPair: {
      topLeftToBottomRight,
      topRightToBottomLeft
    },
    projection: {
      projectionDistanceMm,
      provenance: horizontal.provenance
    }
  };
}

/**
 * Resolves native sensor geometry, active capture area, physical camera orientation
 * and final digital (output) geometry, keeping each one distinct.
 */
export function resolveCaptureGeometry(
  input: ResolveCaptureGeometryInput
): CalculationResult<ResolvedCaptureGeometry> {
  requireInputKeys(input, "resolveCaptureGeometry", ["imagingArea", "nativeRaster", "orientation", "activeCaptureRect", "outputCropRect", "outputRaster"]);
  requireCaptureOrientation(input.orientation);
  requireInputObject(input.imagingArea, "imagingArea");
  requirePositiveFinite("imagingArea.widthMm", input.imagingArea.widthMm);
  requirePositiveFinite("imagingArea.heightMm", input.imagingArea.heightMm);
  requireRasterDimensions("nativeRaster", input.nativeRaster);

  const activeCaptureRect =
    input.activeCaptureRect ?? fullRect(input.nativeRaster);
  validateRasterRect(
    "activeCaptureRect",
    activeCaptureRect,
    input.nativeRaster
  );

  const nativeBounds = nativePhysicalBoundsFromRect(
    input.imagingArea,
    input.nativeRaster,
    activeCaptureRect
  );
  const activeImagingArea: SensorImagingArea = {
    widthMm: nativeBounds.right - nativeBounds.left,
    heightMm: nativeBounds.bottom - nativeBounds.top
  };
  const activeRaster: RasterDimensions = {
    pixelWidth: activeCaptureRect.width,
    pixelHeight: activeCaptureRect.height
  };
  const orientedBounds = orientPhysicalBounds(
    nativeBounds,
    input.orientation
  );
  const orientedRaster = orientRaster(activeRaster, input.orientation);
  const orientedImagingArea: SensorImagingArea = {
    widthMm: orientedBounds.right - orientedBounds.left,
    heightMm: orientedBounds.bottom - orientedBounds.top
  };

  const outputCropRect =
    input.outputCropRect ?? fullRect(orientedRaster);
  validateRasterRect(
    "outputCropRect",
    outputCropRect,
    orientedRaster
  );

  const outputRaster: RasterDimensions = input.outputRaster ?? {
    pixelWidth: outputCropRect.width,
    pixelHeight: outputCropRect.height
  };
  requireRasterDimensions("outputRaster", outputRaster);
  validateOutputAspectRatio(outputCropRect, outputRaster);

  const outputBounds = physicalBoundsFromRectWithinBounds(
    orientedBounds,
    orientedRaster,
    outputCropRect
  );
  const outputImagingArea: SensorImagingArea = {
    widthMm: outputBounds.right - outputBounds.left,
    heightMm: outputBounds.bottom - outputBounds.top
  };
  const outputScaleX = outputRaster.pixelWidth / outputCropRect.width;
  const outputScaleY = outputRaster.pixelHeight / outputCropRect.height;
  const outputScaleAxisRelativeDifference =
    Math.abs(outputScaleX - outputScaleY) /
    ((outputScaleX + outputScaleY) / 2);

  return calculatedResult(
    {
      native: {
        imagingArea: { ...input.imagingArea },
        raster: { ...input.nativeRaster }
      },
      activeCapture: {
        nativeRect: { ...activeCaptureRect },
        imagingArea: activeImagingArea,
        physicalOffsetMm: {
          x: nativeBounds.left + input.imagingArea.widthMm / 2,
          y: nativeBounds.top + input.imagingArea.heightMm / 2
        },
        centerOffsetFromOpticalAxisMm: {
          x: (nativeBounds.left + nativeBounds.right) / 2,
          y: (nativeBounds.top + nativeBounds.bottom) / 2
        },
        physicalBoundsFromOpticalAxisMm: nativeBounds,
        imagingAreaDerivation: "uniform-native-raster",
        raster: activeRaster
      },
      orientedCapture: {
        orientation: input.orientation,
        imagingArea: orientedImagingArea,
        physicalBoundsFromOpticalAxisMm: orientedBounds,
        raster: orientedRaster
      },
      output: {
        cropRect: { ...outputCropRect },
        raster: { ...outputRaster },
        imagingArea: outputImagingArea,
        physicalBoundsFromOpticalAxisMm: outputBounds,
        centerOffsetFromOpticalAxisMm: {
          x: (outputBounds.left + outputBounds.right) / 2,
          y: (outputBounds.top + outputBounds.bottom) / 2
        },
        sourceRetainedAreaFraction:
          (outputCropRect.width * outputCropRect.height) /
          (orientedRaster.pixelWidth * orientedRaster.pixelHeight),
        orientedCaptureToOutputScale: {
          x: outputScaleX,
          y: outputScaleY,
          axisRelativeDifference: outputScaleAxisRelativeDifference
        }
      }
    },
    "capture-geometry-pipeline",
    "1.2.0",
    [
      "Native sensor raster coordinates use a top-left origin with +X right and +Y down.",
      "Raster rectangles are integer half-open extents.",
      "Physical camera orientation does not rotate or redefine the native sensor coordinate system.",
      "The generic active physical area is derived by assuming native image samples uniformly span the declared physical imaging area.",
      "Output crop/resampling is digital geometry and does not mutate physical sensor or active-capture identity.",
      "The physical image region retained by output crop is tracked explicitly for final framing and equivalent-viewing calculations.",
      "Output raster aspect ratio must remain consistent with the output crop; implicit geometric stretching is rejected."
    ]
  );
}

/**
 * Calculates the field of view (FOV) of the active physical capture area after
 * camera orientation. Horizontal and vertical FOV can be asymmetric about the
 * optical axis; both corner-to-corner diagonals are reported.
 *
 * The final digital (output) crop is deliberately not included.
 */
export function calculateActiveCaptureFieldOfView(
  input: CalculateActiveCaptureFieldOfViewInput
): CalculationResult<ActiveCaptureFieldOfView> {
  requireInputKeys(input, "calculateActiveCaptureFieldOfView", ["imagingArea", "nativeRaster", "orientation", "activeCaptureRect", "focalLengthMm", "focusDistanceM"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);

  const geometry = resolveCaptureGeometry({
    imagingArea: input.imagingArea,
    nativeRaster: input.nativeRaster,
    orientation: input.orientation,
    ...(input.activeCaptureRect === undefined
      ? {}
      : { activeCaptureRect: input.activeCaptureRect })
  }).value;

  const bounds =
    geometry.orientedCapture.physicalBoundsFromOpticalAxisMm;
  const fieldOfView = calculateBoundsFieldOfView(
    bounds,
    input.focalLengthMm,
    input.focusDistanceM
  );

  return calculatedResult(
    {
      orientation: input.orientation,
      ...fieldOfView,
      activeImagingArea: {
        ...geometry.orientedCapture.imagingArea
      },
      centerOffsetFromOpticalAxisMm: rotateVector(
        geometry.activeCapture.centerOffsetFromOpticalAxisMm,
        input.orientation
      )
    },
    "oriented-active-capture-field-of-view",
    "1.1.0",
    [
      "Rectilinear projection is evaluated from signed active-area bounds relative to the optical axis.",
      "Off-center active crops preserve asymmetric angular bounds rather than being treated as centered.",
      "Camera orientation rotates physical bounds while leaving the native sensor coordinate system unchanged.",
      "For off-center rectangles the two opposite-corner diagonal spans may differ; diagonalDegrees reports the larger span.",
      "Final digital/output crop is excluded from active-capture FOV."
    ]
  );
}

/**
 * Calculates the final visible field of view after the active capture area,
 * orientation and digital (output) crop. Output resolution does not affect it.
 */
export function calculateOutputFieldOfView(
  input: CalculateOutputFieldOfViewInput
): CalculationResult<OutputFieldOfView> {
  requireInputKeys(input, "calculateOutputFieldOfView", ["imagingArea", "nativeRaster", "orientation", "activeCaptureRect", "outputCropRect", "focalLengthMm", "focusDistanceM"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);

  const geometry = resolveCaptureGeometry({
    imagingArea: input.imagingArea,
    nativeRaster: input.nativeRaster,
    orientation: input.orientation,
    ...(input.activeCaptureRect === undefined
      ? {}
      : { activeCaptureRect: input.activeCaptureRect }),
    ...(input.outputCropRect === undefined
      ? {}
      : { outputCropRect: input.outputCropRect })
  }).value;
  const fieldOfView = calculateBoundsFieldOfView(
    geometry.output.physicalBoundsFromOpticalAxisMm,
    input.focalLengthMm,
    input.focusDistanceM
  );

  return calculatedResult(
    {
      orientation: input.orientation,
      ...fieldOfView,
      outputImagingArea: { ...geometry.output.imagingArea },
      centerOffsetFromOpticalAxisMm: {
        ...geometry.output.centerOffsetFromOpticalAxisMm
      }
    },
    "oriented-output-field-of-view",
    "1.0.0",
    [
      "Final visible FOV is derived from the physical image region retained by active capture and digital/output crop.",
      "Output raster resolution does not change field of view.",
      "Off-center output crops preserve asymmetric angular bounds.",
      "Physical sensor identity and active-capture 35 mm-equivalent focal length are unchanged by final digital crop."
    ]
  );
}

