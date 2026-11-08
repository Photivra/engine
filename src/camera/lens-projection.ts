// SPDX-License-Identifier: Apache-2.0

/**
 * Ideal lens projection (mapping) functions. They convert between a scene direction and a point on the
 * image plane.
 *
 * A radial projection maps the field angle theta (the angle from the optical axis) to the image
 * radius r:
 *   rectilinear       r = f tan(theta)          (gnomonic / pinhole)
 *   equidistant       r = f theta               ("f-theta" fisheye)
 *   equisolid-angle   r = 2 f sin(theta / 2)    (equal-area fisheye)
 *   stereographic     r = 2 f tan(theta / 2)    (conformal fisheye)
 *   orthographic      r = f sin(theta)
 * The image point keeps the direction's azimuth about the optical axis, so every radial projection is
 * rotationally symmetric. Equirectangular (spherical, or cylindrical equidistant) is not radial:
 * x = f * longitude, y = f * latitude, where f is the image distance per radian.
 *
 * Sources: Kannala & Brandt 2006 (IEEE TPAMI 28:1335, generic camera model listing these
 * projections, eqs. 1-5; free author copy); Miyamoto 1964 (JOSA 54:1060, fish-eye projection
 * functions); Snyder 1987 (Map Projections - A Working Manual, USGS PP 1395, free) for the
 * equirectangular and stereographic projections. Also see: Kingslake 1989 (A History of the
 * Photographic Lens, ch. on fish-eye lenses); Ray 2002 (Applied Photographic Optics, 3rd ed., ch. 6
 * and 47).
 *
 * These are ideal mapping functions. Real fisheye lenses deviate from them. Modelling a real lens
 * would need a calibrated polynomial (for example Kannala-Brandt) with defensible provenance.
 *
 * Camera frame: +X right, +Y up, +Z along the optical axis toward the scene. Image-plane coordinates
 * use the same non-inverted +X right / +Y up convention as the rest of the engine.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import { rejectUnknownFields, requireInputKeys } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Ideal projection model discriminator. `rectilinear` is the engine default. */
export type LensProjectionModel =
  | "rectilinear"
  | "fisheye-equidistant"
  | "fisheye-equisolid-angle"
  | "fisheye-stereographic"
  | "fisheye-orthographic"
  | "equirectangular";

/** Radial (rotationally symmetric) projection models. */
export type RadialLensProjectionModel = Exclude<
  LensProjectionModel,
  "equirectangular"
>;

export const LENS_PROJECTION_MODELS: readonly LensProjectionModel[] =
  /* @__PURE__ */ Object.freeze([
    "rectilinear",
    "fisheye-equidistant",
    "fisheye-equisolid-angle",
    "fisheye-stereographic",
    "fisheye-orthographic",
    "equirectangular"
  ]);

export interface LensDirection {
  /** Camera-frame direction component, +X right. Any positive length. */
  x: number;
  /** Camera-frame direction component, +Y up. */
  y: number;
  /** Camera-frame direction component along the optical axis toward the scene. */
  z: number;
}

export interface CalculateLensProjectionImagePointInput {
  projectionModel: LensProjectionModel;
  /**
   * Projection scale in millimetres: the focal length f of the mapping function, or for
   * equirectangular the image distance per radian.
   */
  focalLengthMm: number;
  /** Scene direction in the camera frame. Need not be normalized; must be non-zero. */
  direction: LensDirection;
}

export interface LensProjectionImagePoint {
  projectionModel: LensProjectionModel;
  imagePointMm: { x: number; y: number };
  /** Angle between the direction and the optical axis, in radians. */
  fieldAngleRadians: number;
  /** Distance of the image point from the optical axis, in millimetres. */
  imageRadiusMm: number;
}

export interface CalculateLensProjectionDirectionInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Image-plane point relative to the optical axis, in millimetres. */
  imagePointMm: { x: number; y: number };
}

export interface LensProjectionDirection {
  projectionModel: LensProjectionModel;
  /** Unit direction in the camera frame. */
  direction: LensDirection;
  fieldAngleRadians: number;
  imageRadiusMm: number;
}

export interface CalculateLensProjectionFieldOfViewInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Centred sensor/capture dimension along one axis through the optical axis, in mm. */
  sensorDimensionMm: number;
}

export interface CalculateLensProjectionFieldOfViewBoundsInput {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
  /** Signed minimum sensor coordinate along one axis through the optical axis, in mm. */
  minimumSensorCoordinateMm: number;
  /** Signed maximum sensor coordinate along the same axis, in mm. */
  maximumSensorCoordinateMm: number;
}

export interface LensProjectionFieldOfView {
  projectionModel: LensProjectionModel;
  degrees: number;
  radians: number;
  /** Projection scale used by the mapping, in millimetres. */
  projectionDistanceMm: number;
}

export interface LensProjectionFieldOfViewBounds {
  projectionModel: LensProjectionModel;
  minimumRadians: number;
  maximumRadians: number;
  radians: number;
  minimumDegrees: number;
  maximumDegrees: number;
  degrees: number;
  projectionDistanceMm: number;
}

const HALF_PI = Math.PI / 2;

/** Runtime parser for the projection discriminator. Rejects (fails closed on) unknown values. */
export function parseLensProjectionModel(
  value: unknown
): LensProjectionModel {
  if (
    typeof value !== "string" ||
    !(LENS_PROJECTION_MODELS as readonly string[]).includes(value)
  ) {
    throw new InvalidConfigurationError(
      "projectionModel must be one of " +
        LENS_PROJECTION_MODELS.join(", ") +
        "."
    );
  }
  return value as LensProjectionModel;
}

function requireRecord(name: string, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidConfigurationError(`${name} must be an object.`);
  }
}

function requireFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidScientificInputError(`${name} must be a finite number.`);
  }
  return value;
}

/**
 * Largest field angle (radians) a radial model maps, and whether the model can reach it.
 * Rectilinear, stereographic, equidistant and equisolid exclude the limit: the radius there is
 * infinite, or the azimuth of the backward direction is undefined. Orthographic reaches 90 degrees.
 */
function radialFieldAngleLimit(model: RadialLensProjectionModel): {
  radians: number;
  inclusive: boolean;
} {
  switch (model) {
    case "rectilinear":
      return { radians: HALF_PI, inclusive: false };
    case "fisheye-orthographic":
      return { radians: HALF_PI, inclusive: true };
    default:
      return { radians: Math.PI, inclusive: false };
  }
}

/** Image radius r(theta) for one radial model. */
export function radialProjectionImageRadius(
  model: RadialLensProjectionModel,
  focalLengthMm: number,
  fieldAngleRadians: number
): number {
  switch (model) {
    case "rectilinear":
      return focalLengthMm * Math.tan(fieldAngleRadians);
    case "fisheye-equidistant":
      return focalLengthMm * fieldAngleRadians;
    case "fisheye-equisolid-angle":
      return 2 * focalLengthMm * Math.sin(fieldAngleRadians / 2);
    case "fisheye-stereographic":
      return 2 * focalLengthMm * Math.tan(fieldAngleRadians / 2);
    case "fisheye-orthographic":
      return focalLengthMm * Math.sin(fieldAngleRadians);
  }
}

/**
 * Largest image radius a radial model reaches inside its field-angle domain, in mm
 * (Infinity for rectilinear and stereographic).
 */
function radialImageRadiusLimit(
  model: RadialLensProjectionModel,
  focalLengthMm: number
): { radiusMm: number; inclusive: boolean } {
  switch (model) {
    case "rectilinear":
    case "fisheye-stereographic":
      return { radiusMm: Number.POSITIVE_INFINITY, inclusive: false };
    case "fisheye-equidistant":
      return { radiusMm: Math.PI * focalLengthMm, inclusive: false };
    case "fisheye-equisolid-angle":
      return { radiusMm: 2 * focalLengthMm, inclusive: false };
    case "fisheye-orthographic":
      return { radiusMm: focalLengthMm, inclusive: true };
  }
}

/**
 * @internal Whether an image radius lies inside a radial model's image circle (the domain of {@link radialProjectionFieldAngle}).
 * Equirectangular is not radial and returns true.
 */
export function insideRadialImageCircle(model: LensProjectionModel, focalLengthMm: number, imageRadiusMm: number): boolean {
  if (model === "equirectangular") return true;
  const limit = radialImageRadiusLimit(model, focalLengthMm);
  return imageRadiusMm >= 0 && (imageRadiusMm < limit.radiusMm || (limit.inclusive && imageRadiusMm === limit.radiusMm));
}

/** Inverse theta(r) for one radial model; throws outside the image circle. */
export function radialProjectionFieldAngle(
  model: RadialLensProjectionModel,
  focalLengthMm: number,
  imageRadiusMm: number
): number {
  const limit = radialImageRadiusLimit(model, focalLengthMm);
  if (
    imageRadiusMm < 0 ||
    imageRadiusMm > limit.radiusMm ||
    (!limit.inclusive && imageRadiusMm === limit.radiusMm)
  ) {
    throw new InvalidScientificInputError(
      `Image radius lies outside the ${model} image circle.`
    );
  }
  switch (model) {
    case "rectilinear":
      return Math.atan(imageRadiusMm / focalLengthMm);
    case "fisheye-equidistant":
      return imageRadiusMm / focalLengthMm;
    case "fisheye-equisolid-angle":
      return 2 * Math.asin(imageRadiusMm / (2 * focalLengthMm));
    case "fisheye-stereographic":
      return 2 * Math.atan(imageRadiusMm / (2 * focalLengthMm));
    case "fisheye-orthographic":
      return Math.asin(Math.min(1, imageRadiusMm / focalLengthMm));
  }
}

function assumptions(model: LensProjectionModel): readonly string[] {
  const common = [
    "Ideal mapping function of a perfect projection; real lenses deviate from it and need calibrated distortion data",
    "Camera frame +X right, +Y up, +Z toward the scene; image plane +X right, +Y up (non-inverted)"
  ];
  if (model === "equirectangular") {
    return [
      "Equirectangular (spherical) projection: x = f * longitude, y = f * latitude, longitude measured about +Y from +Z",
      ...common
    ];
  }
  return [
    `Radial projection ${model}; image azimuth equals scene azimuth about the optical axis`,
    ...common
  ];
}

function validateCommon(
  input: { projectionModel: unknown; focalLengthMm: number },
  name: string
): LensProjectionModel {
  requireRecord(name, input);
  const model = parseLensProjectionModel(input.projectionModel);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  return model;
}

/**
 * Maps one camera-frame scene direction to its ideal image-plane point under the declared
 * projection model.
 */
export function calculateLensProjectionImagePoint(
  input: CalculateLensProjectionImagePointInput
): CalculationResult<LensProjectionImagePoint> {
  requireInputKeys(input, "calculateLensProjectionImagePoint", ["projectionModel", "focalLengthMm", "direction"]);
  const model = validateCommon(input, "input");
  requireRecord("direction", input.direction);
  rejectUnknownFields(input.direction, ["x", "y", "z"], "direction");
  const x = requireFinite("direction.x", input.direction.x);
  const y = requireFinite("direction.y", input.direction.y);
  const z = requireFinite("direction.z", input.direction.z);
  const length = Math.hypot(x, y, z);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new InvalidScientificInputError(
      "direction must be a finite non-zero vector."
    );
  }
  const { imagePointMm, fieldAngleRadians } = lensProjectionImagePointValue(
    model,
    input.focalLengthMm,
    x,
    y,
    z
  );

  return calculatedResult(
    {
      projectionModel: model,
      imagePointMm,
      fieldAngleRadians,
      imageRadiusMm: Math.hypot(imagePointMm.x, imagePointMm.y)
    },
    `${model}-lens-projection`,
    "1.0.0",
    assumptions(model)
  );
}

/**
 * Inverse-maps one image-plane point to its unit camera-frame scene direction under the declared
 * projection model. It rejects points outside the model's image circle. For equirectangular, it
 * rejects points outside +/-pi longitude and +/-pi/2 latitude.
 */
export function calculateLensProjectionDirection(
  input: CalculateLensProjectionDirectionInput
): CalculationResult<LensProjectionDirection> {
  requireInputKeys(input, "calculateLensProjectionDirection", ["projectionModel", "focalLengthMm", "imagePointMm"]);
  const model = validateCommon(input, "input");
  requireRecord("imagePointMm", input.imagePointMm);
  rejectUnknownFields(input.imagePointMm, ["x", "y"], "imagePointMm");
  const px = requireFinite("imagePointMm.x", input.imagePointMm.x);
  const py = requireFinite("imagePointMm.y", input.imagePointMm.y);
  const imageRadiusMm = Math.hypot(px, py);
  const direction = lensProjectionDirectionValue(
    model,
    input.focalLengthMm,
    px,
    py
  );

  return calculatedResult(
    {
      projectionModel: model,
      direction,
      fieldAngleRadians: Math.atan2(
        Math.hypot(direction.x, direction.y),
        direction.z
      ),
      imageRadiusMm
    },
    `inverse-${model}-lens-projection`,
    "1.0.0",
    assumptions(model)
  );
}

/** Signed angle subtended along one axis through the optical axis for a signed coordinate. */
function signedAxisAngle(
  model: LensProjectionModel,
  focalLengthMm: number,
  coordinateMm: number
): number {
  if (model === "equirectangular") {
    // Along a horizontal or vertical line through the centre the angle is linear in position.
    return coordinateMm / focalLengthMm;
  }
  const theta = radialProjectionFieldAngle(
    model,
    focalLengthMm,
    Math.abs(coordinateMm)
  );
  return coordinateMm < 0 ? -theta : theta;
}

/**
 * Angular field of view across a centred sensor dimension along one axis through the optical
 * axis: 2 * theta(d / 2) for radial models and d / f for equirectangular.
 *
 * For equirectangular, the result is the longitude span for a horizontal dimension and the latitude
 * span for a vertical one. A sensor dimension larger than a fisheye's image circle is rejected, not
 * clipped.
 */
export function calculateLensProjectionFieldOfView(
  input: CalculateLensProjectionFieldOfViewInput
): CalculationResult<LensProjectionFieldOfView> {
  requireInputKeys(input, "calculateLensProjectionFieldOfView", ["projectionModel", "focalLengthMm", "sensorDimensionMm"]);
  const model = validateCommon(input, "input");
  requirePositiveFinite("sensorDimensionMm", input.sensorDimensionMm);
  const radians =
    2 *
    signedAxisAngle(model, input.focalLengthMm, input.sensorDimensionMm / 2);
  if (model === "equirectangular" && radians > 2 * Math.PI) {
    throw new InvalidScientificInputError(
      "sensorDimensionMm exceeds the full 360-degree equirectangular span."
    );
  }
  return calculatedResult(
    {
      projectionModel: model,
      radians,
      degrees: (radians * 180) / Math.PI,
      projectionDistanceMm: input.focalLengthMm
    },
    `${model}-field-of-view`,
    "1.0.0",
    [
      ...assumptions(model),
      "Field of view is measured along one axis through the optical axis"
    ]
  );
}

/**
 * Asymmetric angular span between two signed sensor coordinates on one axis through the optical
 * axis, for off-centre crops.
 */
export function calculateLensProjectionFieldOfViewBounds(
  input: CalculateLensProjectionFieldOfViewBoundsInput
): CalculationResult<LensProjectionFieldOfViewBounds> {
  requireInputKeys(input, "calculateLensProjectionFieldOfViewBounds", ["projectionModel", "focalLengthMm", "minimumSensorCoordinateMm", "maximumSensorCoordinateMm"]);
  const model = validateCommon(input, "input");
  const minimum = requireFinite(
    "minimumSensorCoordinateMm",
    input.minimumSensorCoordinateMm
  );
  const maximum = requireFinite(
    "maximumSensorCoordinateMm",
    input.maximumSensorCoordinateMm
  );
  if (maximum <= minimum) {
    throw new InvalidScientificInputError(
      "maximumSensorCoordinateMm must be greater than minimumSensorCoordinateMm."
    );
  }
  const minimumRadians = signedAxisAngle(model, input.focalLengthMm, minimum);
  const maximumRadians = signedAxisAngle(model, input.focalLengthMm, maximum);
  const radians = maximumRadians - minimumRadians;
  if (model === "equirectangular" && radians > 2 * Math.PI) {
    throw new InvalidScientificInputError(
      "Sensor bounds exceed the full 360-degree equirectangular span."
    );
  }
  return calculatedResult(
    {
      projectionModel: model,
      minimumRadians,
      maximumRadians,
      radians,
      minimumDegrees: (minimumRadians * 180) / Math.PI,
      maximumDegrees: (maximumRadians * 180) / Math.PI,
      degrees: (radians * 180) / Math.PI,
      projectionDistanceMm: input.focalLengthMm
    },
    `asymmetric-${model}-field-of-view`,
    "1.0.0",
    [
      ...assumptions(model),
      "Signed sensor-plane bounds are measured relative to the optical axis along one axis through it"
    ]
  );
}

/**
 * @internal Image point of a non-zero camera-frame direction under one model (no envelope).
 * Shared by the public mapping, geometric remaps and the environment ray query.
 */
export function lensProjectionImagePointValue(
  model: LensProjectionModel,
  focalLengthMm: number,
  x: number,
  y: number,
  z: number
): { imagePointMm: { x: number; y: number }; fieldAngleRadians: number } {
  const length = Math.hypot(x, y, z);
  const f = focalLengthMm;
  const transverse = Math.hypot(x, y);
  const fieldAngleRadians = Math.atan2(transverse, z);

  let imagePointMm: { x: number; y: number };
  if (model === "equirectangular") {
    const latitude = Math.asin(Math.max(-1, Math.min(1, y / length)));
    const horizontal = Math.hypot(x, z);
    if (horizontal === 0) {
      // Poles have an undefined longitude; the projection is singular there.
      throw new InvalidScientificInputError(
        "Equirectangular projection is undefined at the poles (direction parallel to +/-Y)."
      );
    }
    const longitude = Math.atan2(x, z);
    imagePointMm = { x: f * longitude, y: f * latitude };
  } else {
    const limit = radialFieldAngleLimit(model);
    if (
      fieldAngleRadians > limit.radians ||
      (!limit.inclusive && fieldAngleRadians === limit.radians)
    ) {
      throw new InvalidScientificInputError(
        `direction lies outside the ${model} projection domain.`
      );
    }
    const radius = radialProjectionImageRadius(model, f, fieldAngleRadians);
    imagePointMm =
      transverse === 0
        ? { x: 0, y: 0 }
        : { x: (radius * x) / transverse, y: (radius * y) / transverse };
  }

  return { imagePointMm, fieldAngleRadians };
}

/** @internal Unit camera-frame direction of one image point under one model (no envelope). */
export function lensProjectionDirectionValue(
  model: LensProjectionModel,
  focalLengthMm: number,
  px: number,
  py: number
): LensDirection {
  const f = focalLengthMm;
  const imageRadiusMm = Math.hypot(px, py);

  let direction: LensDirection;
  if (model === "equirectangular") {
    const longitude = px / f;
    const latitude = py / f;
    if (Math.abs(longitude) > Math.PI || Math.abs(latitude) > HALF_PI) {
      throw new InvalidScientificInputError(
        "imagePointMm lies outside the equirectangular longitude/latitude domain."
      );
    }
    const cosLatitude = Math.cos(latitude);
    direction = {
      x: cosLatitude * Math.sin(longitude),
      y: Math.sin(latitude),
      z: cosLatitude * Math.cos(longitude)
    };
  } else {
    const theta = radialProjectionFieldAngle(model, f, imageRadiusMm);
    const sinTheta = Math.sin(theta);
    direction =
      imageRadiusMm === 0
        ? { x: 0, y: 0, z: 1 }
        : {
            x: (sinTheta * px) / imageRadiusMm,
            y: (sinTheta * py) / imageRadiusMm,
            z: Math.cos(theta)
          };
  }

  return direction;
}

/** d r / d theta of a radial model. */
function radialDerivative(
  model: RadialLensProjectionModel,
  f: number,
  theta: number
): number {
  switch (model) {
    case "rectilinear":
      return f / Math.cos(theta) ** 2;
    case "fisheye-equidistant":
      return f;
    case "fisheye-equisolid-angle":
      return f * Math.cos(theta / 2);
    case "fisheye-stereographic":
      return f / Math.cos(theta / 2) ** 2;
    case "fisheye-orthographic":
      return f * Math.cos(theta);
  }
}

type Matrix32 = readonly [readonly [number, number], readonly [number, number], readonly [number, number]];

/** Unit direction of an image point and its derivative d(direction)/d(point) (3 x 2). */
function directionWithDerivative(
  model: LensProjectionModel,
  f: number,
  px: number,
  py: number
): { direction: LensDirection; derivative: Matrix32 } {
  const direction = lensProjectionDirectionValue(model, f, px, py);
  if (model === "equirectangular") {
    const lambda = px / f;
    const phi = py / f;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const cl = Math.cos(lambda);
    const sl = Math.sin(lambda);
    return {
      direction,
      derivative: [
        [(cp * cl) / f, (-sp * sl) / f],
        [0, cp / f],
        [(-cp * sl) / f, (-sp * cl) / f]
      ]
    };
  }
  const rho = Math.hypot(px, py);
  if (rho === 0) {
    const a = 1 / radialDerivative(model, f, 0);
    return { direction, derivative: [[a, 0], [0, a], [0, 0]] };
  }
  const theta = radialProjectionFieldAngle(model, f, rho);
  const dTheta = 1 / radialDerivative(model, f, theta);
  const a = Math.sin(theta) / rho;
  const aPrime = (Math.cos(theta) * dTheta * rho - Math.sin(theta)) / (rho * rho);
  const ux = px / rho;
  const uy = py / rho;
  const dz = -Math.sin(theta) * dTheta;
  return {
    direction,
    derivative: [
      [a + aPrime * px * ux, aPrime * px * uy],
      [aPrime * py * ux, a + aPrime * py * uy],
      [dz * ux, dz * uy]
    ]
  };
}

/** Image point of a unit direction and its derivative d(point)/d(direction) (2 x 3). */
function imagePointWithDerivative(
  model: LensProjectionModel,
  f: number,
  v: LensDirection
): { point: { x: number; y: number }; derivative: readonly [readonly [number, number, number], readonly [number, number, number]] } {
  const point = lensProjectionImagePointValue(model, f, v.x, v.y, v.z).imagePointMm;
  if (model === "equirectangular") {
    const h2 = v.x * v.x + v.z * v.z;
    const c = Math.sqrt(Math.max(0, 1 - v.y * v.y));
    return {
      point,
      derivative: [
        [(f * v.z) / h2, 0, (-f * v.x) / h2],
        [0, f / c, 0]
      ]
    };
  }
  const t = Math.hypot(v.x, v.y);
  const theta = Math.atan2(t, v.z);
  if (theta < 1e-9) {
    const g = radialDerivative(model, f, 0);
    return { point, derivative: [[g, 0, 0], [0, g, 0]] };
  }
  const s = Math.sin(theta);
  const g = radialProjectionImageRadius(model, f, theta);
  const b = g / s;
  const bPrime = (radialDerivative(model, f, theta) * s - g * Math.cos(theta)) / (s * s);
  // q = b(theta) (vx, vy); on the unit sphere d theta = -d vz / sin theta.
  const k = -bPrime / s;
  return {
    point,
    derivative: [
      [b, 0, k * v.x],
      [0, b, k * v.y]
    ]
  };
}

/**
 * @internal Destination-to-source remap between two ideal projections: the destination point is
 * unprojected with the destination model and reprojected with the source model. Returns the
 * source point and the 2 x 2 Jacobian d(source)/d(destination), row-major.
 */
export function lensProjectionRemapValue(
  destinationModel: LensProjectionModel,
  destinationFocalLengthMm: number,
  sourceModel: LensProjectionModel,
  sourceFocalLengthMm: number,
  px: number,
  py: number
): { sourcePointMm: { x: number; y: number }; jacobian: readonly [number, number, number, number] } {
  const inverse = directionWithDerivative(destinationModel, destinationFocalLengthMm, px, py);
  const forward = imagePointWithDerivative(sourceModel, sourceFocalLengthMm, inverse.direction);
  const d = inverse.derivative;
  const q = forward.derivative;
  const j = (row: 0 | 1, column: 0 | 1): number =>
    q[row][0] * d[0][column] + q[row][1] * d[1][column] + q[row][2] * d[2][column];
  return {
    sourcePointMm: forward.point,
    jacobian: [j(0, 0), j(0, 1), j(1, 0), j(1, 1)]
  };
}

/** @internal Signed angle along one axis through the optical axis (exported for sampling plans). */
export function lensProjectionSignedAxisAngle(
  model: LensProjectionModel,
  focalLengthMm: number,
  coordinateMm: number
): number {
  return signedAxisAngle(model, focalLengthMm, coordinateMm);
}
