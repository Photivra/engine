// SPDX-License-Identifier: Apache-2.0

/**
 * Internal float64 scene geometry and ray intersection for the browser-native capture reference
 * executor ("Path A"; see docs/BROWSER_NATIVE_CAPTURE_ROBUST_GEOMETRY.md).
 *
 * It holds a compact, immutable geometry representation and is deliberately not exported from
 * the package.
 *
 * Scope is narrower than the planned final scene envelope: rectangles and boxes in metres,
 * axis-aligned in their local space, with rigid translation and rotation only. Scale, shear and
 * a defensible bound for near-coincident float64 hits are not done yet.
 */
import { freezeOwnedData } from "../core/owned-data.js";
import { requirePublicOpaqueId } from "../core/record-validation.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export const BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION = "0.1.0" as const;

export interface BrowserNativeReferenceVector3 {
  x: number;
  y: number;
  z: number;
}

export interface BrowserNativeReferenceQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BrowserNativeReferenceRigidTransform {
  /** World-space translation of the local primitive frame. */
  translationM: BrowserNativeReferenceVector3;
  /**
   * Rotation from local to world coordinates, as a quaternion. Preparation
   * normalizes it, fixes its sign to one canonical choice, and removes -0 values
   * so identical rotations compare equal.
   */
  rotationQuaternion: BrowserNativeReferenceQuaternion;
}

export interface BrowserNativeAxisAlignedRectangle {
  kind: "axis-aligned-rectangle";
  primitiveId: string;
  /**
   * Closed bounds in metres. Exactly one axis has minimum === maximum; that
   * zero-thickness axis defines the rectangle's plane.
   */
  minimumM: BrowserNativeReferenceVector3;
  maximumM: BrowserNativeReferenceVector3;
  /** Optional rigid local-to-world transform; omission is identity. */
  worldFromLocal?: BrowserNativeReferenceRigidTransform;
}

export interface BrowserNativeAxisAlignedBox {
  kind: "axis-aligned-box";
  primitiveId: string;
  /** Closed bounds in metres; each maximum is strictly greater than its minimum. */
  minimumM: BrowserNativeReferenceVector3;
  maximumM: BrowserNativeReferenceVector3;
  /** Optional rigid local-to-world transform; omission is identity. */
  worldFromLocal?: BrowserNativeReferenceRigidTransform;
}

export type BrowserNativeReferencePrimitive =
  | BrowserNativeAxisAlignedRectangle
  | BrowserNativeAxisAlignedBox;

export interface PrepareBrowserNativeReferenceGeometryInput {
  schemaVersion: typeof BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION;
  sourceStateId: string;
  providerSceneId: string;
  sourceRevision: string;
  primitives: readonly BrowserNativeReferencePrimitive[];
}

export interface PreparedBrowserNativeReferenceGeometry {
  schemaVersion: typeof BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION;
  sourceStateId: string;
  providerSceneId: string;
  sourceRevision: string;
  coordinateUnit: "m";
  primitiveBoundaryRule: "closed";
  forwardHitRule: "strict-positive-ray-parameter";
  boxInsideOriginRule: "first-forward-exit-surface";
  primitiveOrderMeaning: "none";
  primitives: readonly BrowserNativeReferencePrimitive[];
  limitations: readonly [
    "Local-space axis-aligned rectangles/boxes support rigid translation/rotation only; scale and shear are not implemented.",
    "Float64 computation is a reference arithmetic choice, not exact real arithmetic.",
    "Near-coincident distinct-hit ambiguity bounds are not yet qualified; exact distinct ties fail closed."
  ];
}

export interface BrowserNativeReferenceRay {
  originM: BrowserNativeReferenceVector3;
  /**
   * Aperture-ray callers normally supply a unit vector. This reference code keeps
   * the direction exactly as given and never renormalizes it. distanceM uses the
   * vector's actual (finite) length.
   */
  directionUnitVector: BrowserNativeReferenceVector3;
}

export type BrowserNativeReferenceHitResult =
  | {
      kind: "hit";
      primitiveId: string;
      rayParameter: number;
      distanceM: number;
      pointM: BrowserNativeReferenceVector3;
    }
  | { kind: "miss" }
  | {
      kind: "unsupported";
      reason:
        | "ray-origin-on-primitive-boundary"
        | "coplanar-rectangle-ray"
        | "coincident-distinct-first-hit"
        | "non-finite-intersection";
    };

type Axis = "x" | "y" | "z";
const AXES: readonly Axis[] = ["x", "y", "z"];

function requireFiniteVector(
  value: BrowserNativeReferenceVector3,
  label: string
): BrowserNativeReferenceVector3 {
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.z)
  ) {
    throw new InvalidScientificInputError(
      `${label} must contain finite metric coordinates.`
    );
  }
  return {
    x: value.x === 0 ? 0 : value.x,
    y: value.y === 0 ? 0 : value.y,
    z: value.z === 0 ? 0 : value.z
  };
}

function prepareRigidTransform(
  value: BrowserNativeReferenceRigidTransform | undefined
): BrowserNativeReferenceRigidTransform | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new InvalidConfigurationError(
      "Reference rigid transform must be an object."
    );
  }
  const translationM = requireFiniteVector(
    value.translationM,
    "Reference rigid transform translation"
  );
  const q = value.rotationQuaternion;
  if (
    typeof q !== "object" ||
    q === null ||
    !Number.isFinite(q.x) ||
    !Number.isFinite(q.y) ||
    !Number.isFinite(q.z) ||
    !Number.isFinite(q.w)
  ) {
    throw new InvalidScientificInputError(
      "Reference rigid transform quaternion must contain finite values."
    );
  }
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(length) || length === 0) {
    throw new InvalidScientificInputError(
      "Reference rigid transform quaternion must be finite and nonzero."
    );
  }

  let rotationQuaternion = {
    x: q.x / length,
    y: q.y / length,
    z: q.z / length,
    w: q.w / length
  };
  const firstNonzero = [
    rotationQuaternion.w,
    rotationQuaternion.x,
    rotationQuaternion.y,
    rotationQuaternion.z
  ].find((component) => component !== 0);
  if (firstNonzero !== undefined && firstNonzero < 0) {
    rotationQuaternion = {
      x: -rotationQuaternion.x,
      y: -rotationQuaternion.y,
      z: -rotationQuaternion.z,
      w: -rotationQuaternion.w
    };
  }
  rotationQuaternion = {
    x: rotationQuaternion.x === 0 ? 0 : rotationQuaternion.x,
    y: rotationQuaternion.y === 0 ? 0 : rotationQuaternion.y,
    z: rotationQuaternion.z === 0 ? 0 : rotationQuaternion.z,
    w: rotationQuaternion.w === 0 ? 0 : rotationQuaternion.w
  };
  return { translationM, rotationQuaternion };
}

function requireNonEmptyRevision(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidScientificInputError(
      "Reference geometry requires a non-empty source revision."
    );
  }
  return value.trim();
}

function validatePrimitive(
  primitive: BrowserNativeReferencePrimitive
): BrowserNativeReferencePrimitive {
  if (typeof primitive !== "object" || primitive === null) {
    throw new InvalidConfigurationError(
      "Reference geometry primitive must be an object."
    );
  }
  const primitiveId = requirePublicOpaqueId(
    primitive.primitiveId,
    "Reference geometry primitive requires a public opaque ID."
  );
  const minimumM = requireFiniteVector(primitive.minimumM, "Primitive minimum");
  const maximumM = requireFiniteVector(primitive.maximumM, "Primitive maximum");
  const worldFromLocal = prepareRigidTransform(primitive.worldFromLocal);

  for (const axis of AXES) {
    if (minimumM[axis] > maximumM[axis]) {
      throw new InvalidScientificInputError(
        "Reference primitive bounds must not be reversed."
      );
    }
  }

  const equalAxes = AXES.filter(
    (axis) => minimumM[axis] === maximumM[axis]
  );

  if (primitive.kind === "axis-aligned-rectangle") {
    if (
      equalAxes.length !== 1 ||
      AXES.some(
        (axis) =>
          minimumM[axis] !== maximumM[axis] &&
          !(minimumM[axis] < maximumM[axis])
      )
    ) {
      throw new InvalidScientificInputError(
        "Reference rectangle requires exactly one zero-thickness axis and two positive extents."
      );
    }
    return {
      kind: primitive.kind,
      primitiveId,
      minimumM,
      maximumM,
      ...(worldFromLocal === undefined ? {} : { worldFromLocal })
    };
  }

  if (primitive.kind === "axis-aligned-box") {
    if (
      equalAxes.length !== 0 ||
      AXES.some((axis) => !(minimumM[axis] < maximumM[axis]))
    ) {
      throw new InvalidScientificInputError(
        "Reference box requires three strictly positive extents."
      );
    }
    return {
      kind: primitive.kind,
      primitiveId,
      minimumM,
      maximumM,
      ...(worldFromLocal === undefined ? {} : { worldFromLocal })
    };
  }

  throw new InvalidScientificInputError(
    "Unsupported reference geometry primitive kind."
  );
}

/**
 * Validates, copies, sorts by primitive ID and freezes internal scene geometry.
 *
 * Sorting means the order of the caller's array cannot secretly affect visibility.
 * It is not a tie-break rule: two different primitives hit at exactly the same
 * first distance are still unsupported.
 */
export function prepareBrowserNativeReferenceGeometry(
  input: PrepareBrowserNativeReferenceGeometryInput
): PreparedBrowserNativeReferenceGeometry {
  if (
    typeof input !== "object" ||
    input === null ||
    input.schemaVersion !== BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION ||
    !Array.isArray(input.primitives) ||
    input.primitives.length < 1
  ) {
    throw new InvalidScientificInputError(
      "Reference geometry requires schema 0.1.0 and at least one primitive."
    );
  }

  const sourceStateId = requirePublicOpaqueId(
    input.sourceStateId,
    "Reference geometry requires a public source-state ID."
  );
  const providerSceneId = requirePublicOpaqueId(
    input.providerSceneId,
    "Reference geometry requires a public provider-scene ID."
  );
  const sourceRevision = requireNonEmptyRevision(input.sourceRevision);

  const ids = new Set<string>();
  const primitives = input.primitives.map((value) => {
    const primitive = validatePrimitive(value);
    if (ids.has(primitive.primitiveId)) {
      throw new InvalidScientificInputError(
        "Reference primitive IDs must be unique."
      );
    }
    ids.add(primitive.primitiveId);
    return primitive;
  });
  primitives.sort((first, second) =>
    first.primitiveId < second.primitiveId
      ? -1
      : first.primitiveId > second.primitiveId
        ? 1
        : 0
  );

  return freezeOwnedData({
    schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
    sourceStateId,
    providerSceneId,
    sourceRevision,
    coordinateUnit: "m" as const,
    primitiveBoundaryRule: "closed" as const,
    forwardHitRule: "strict-positive-ray-parameter" as const,
    boxInsideOriginRule: "first-forward-exit-surface" as const,
    primitiveOrderMeaning: "none" as const,
    primitives,
    limitations: [
      "Local-space axis-aligned rectangles/boxes support rigid translation/rotation only; scale and shear are not implemented.",
      "Float64 computation is a reference arithmetic choice, not exact real arithmetic.",
      "Near-coincident distinct-hit ambiguity bounds are not yet qualified; exact distinct ties fail closed."
    ] as const
  });
}

function validateRay(ray: BrowserNativeReferenceRay): {
  ray: BrowserNativeReferenceRay;
  directionMagnitude: number;
} {
  if (typeof ray !== "object" || ray === null) {
    throw new InvalidConfigurationError("Reference ray must be an object.");
  }
  const originM = requireFiniteVector(ray.originM, "Reference ray origin");
  const directionUnitVector = requireFiniteVector(
    ray.directionUnitVector,
    "Reference ray direction"
  );
  const directionMagnitude = Math.hypot(
    directionUnitVector.x,
    directionUnitVector.y,
    directionUnitVector.z
  );
  if (!Number.isFinite(directionMagnitude) || directionMagnitude <= 0) {
    throw new InvalidScientificInputError(
      "Reference ray direction must be finite and nonzero."
    );
  }
  return {
    ray: { originM, directionUnitVector },
    directionMagnitude
  };
}

function rotateVectorByUnitQuaternion(
  vector: BrowserNativeReferenceVector3,
  quaternion: BrowserNativeReferenceQuaternion
): BrowserNativeReferenceVector3 {
  const tx = 2 * (quaternion.y * vector.z - quaternion.z * vector.y);
  const ty = 2 * (quaternion.z * vector.x - quaternion.x * vector.z);
  const tz = 2 * (quaternion.x * vector.y - quaternion.y * vector.x);
  return {
    x:
      vector.x +
      quaternion.w * tx +
      (quaternion.y * tz - quaternion.z * ty),
    y:
      vector.y +
      quaternion.w * ty +
      (quaternion.z * tx - quaternion.x * tz),
    z:
      vector.z +
      quaternion.w * tz +
      (quaternion.x * ty - quaternion.y * tx)
  };
}

function rayInPrimitiveLocalSpace(
  ray: BrowserNativeReferenceRay,
  transform: BrowserNativeReferenceRigidTransform | undefined
): BrowserNativeReferenceRay | null {
  if (transform === undefined) return ray;
  const inverse = {
    x: -transform.rotationQuaternion.x,
    y: -transform.rotationQuaternion.y,
    z: -transform.rotationQuaternion.z,
    w: transform.rotationQuaternion.w
  };
  const shiftedOrigin = {
    x: ray.originM.x - transform.translationM.x,
    y: ray.originM.y - transform.translationM.y,
    z: ray.originM.z - transform.translationM.z
  };
  const originM = rotateVectorByUnitQuaternion(shiftedOrigin, inverse);
  const directionUnitVector = rotateVectorByUnitQuaternion(
    ray.directionUnitVector,
    inverse
  );
  if (
    !Number.isFinite(originM.x) ||
    !Number.isFinite(originM.y) ||
    !Number.isFinite(originM.z) ||
    !Number.isFinite(directionUnitVector.x) ||
    !Number.isFinite(directionUnitVector.y) ||
    !Number.isFinite(directionUnitVector.z)
  ) {
    return null;
  }
  return { originM, directionUnitVector };
}

function pointAt(
  ray: BrowserNativeReferenceRay,
  rayParameter: number
): BrowserNativeReferenceVector3 | null {
  const point = {
    x: ray.originM.x + rayParameter * ray.directionUnitVector.x,
    y: ray.originM.y + rayParameter * ray.directionUnitVector.y,
    z: ray.originM.z + rayParameter * ray.directionUnitVector.z
  };
  return Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
    ? point
    : null;
}

function hit(
  primitiveId: string,
  ray: BrowserNativeReferenceRay,
  directionMagnitude: number,
  rayParameter: number
): BrowserNativeReferenceHitResult {
  const pointM = pointAt(ray, rayParameter);
  const distanceM = rayParameter * directionMagnitude;
  if (
    pointM === null ||
    !Number.isFinite(distanceM) ||
    !(distanceM > 0)
  ) {
    return { kind: "unsupported", reason: "non-finite-intersection" };
  }
  return {
    kind: "hit",
    primitiveId,
    rayParameter,
    distanceM,
    pointM
  };
}

function rectanglePlaneAxis(
  primitive: BrowserNativeAxisAlignedRectangle
): Axis {
  return AXES.find(
    (axis) => primitive.minimumM[axis] === primitive.maximumM[axis]
  )!;
}

function intersectRectangle(
  primitive: BrowserNativeAxisAlignedRectangle,
  ray: BrowserNativeReferenceRay,
  directionMagnitude: number
): BrowserNativeReferenceHitResult {
  const planeAxis = rectanglePlaneAxis(primitive);
  const planeCoordinate = primitive.minimumM[planeAxis];
  const originCoordinate = ray.originM[planeAxis];
  const directionCoordinate = ray.directionUnitVector[planeAxis];

  if (directionCoordinate === 0) {
    return originCoordinate === planeCoordinate
      ? { kind: "unsupported", reason: "coplanar-rectangle-ray" }
      : { kind: "miss" };
  }

  const rayParameter =
    (planeCoordinate - originCoordinate) / directionCoordinate;
  if (!Number.isFinite(rayParameter)) {
    return { kind: "unsupported", reason: "non-finite-intersection" };
  }
  if (rayParameter < 0) return { kind: "miss" };
  if (rayParameter === 0) {
    return {
      kind: "unsupported",
      reason: "ray-origin-on-primitive-boundary"
    };
  }

  const pointM = pointAt(ray, rayParameter);
  if (pointM === null) {
    return { kind: "unsupported", reason: "non-finite-intersection" };
  }

  for (const axis of AXES) {
    if (axis === planeAxis) continue;
    if (
      pointM[axis] < primitive.minimumM[axis] ||
      pointM[axis] > primitive.maximumM[axis]
    ) {
      return { kind: "miss" };
    }
  }

  return hit(
    primitive.primitiveId,
    ray,
    directionMagnitude,
    rayParameter
  );
}

function isInsideInclusive(
  primitive: BrowserNativeAxisAlignedBox,
  point: BrowserNativeReferenceVector3
): boolean {
  return AXES.every(
    (axis) =>
      point[axis] >= primitive.minimumM[axis] &&
      point[axis] <= primitive.maximumM[axis]
  );
}

function isInsideStrict(
  primitive: BrowserNativeAxisAlignedBox,
  point: BrowserNativeReferenceVector3
): boolean {
  return AXES.every(
    (axis) =>
      point[axis] > primitive.minimumM[axis] &&
      point[axis] < primitive.maximumM[axis]
  );
}

function intersectBox(
  primitive: BrowserNativeAxisAlignedBox,
  ray: BrowserNativeReferenceRay,
  directionMagnitude: number
): BrowserNativeReferenceHitResult {
  if (
    isInsideInclusive(primitive, ray.originM) &&
    !isInsideStrict(primitive, ray.originM)
  ) {
    return {
      kind: "unsupported",
      reason: "ray-origin-on-primitive-boundary"
    };
  }

  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;

  for (const axis of AXES) {
    const origin = ray.originM[axis];
    const direction = ray.directionUnitVector[axis];
    const minimum = primitive.minimumM[axis];
    const maximum = primitive.maximumM[axis];

    if (direction === 0) {
      if (origin < minimum || origin > maximum) return { kind: "miss" };
      continue;
    }

    const first = (minimum - origin) / direction;
    const second = (maximum - origin) / direction;
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return { kind: "unsupported", reason: "non-finite-intersection" };
    }
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return { kind: "miss" };
  }

  if (exit < 0) return { kind: "miss" };

  let rayParameter: number;
  if (entry > 0) {
    rayParameter = entry;
  } else if (isInsideStrict(primitive, ray.originM) && exit > 0) {
    rayParameter = exit;
  } else {
    return {
      kind: "unsupported",
      reason: "ray-origin-on-primitive-boundary"
    };
  }

  return hit(
    primitive.primitiveId,
    ray,
    directionMagnitude,
    rayParameter
  );
}

/**
 * Intersects one ray, exactly as supplied, with the prepared geometry.
 *
 * It deliberately rejects exact first-hit ties between different primitives, and
 * hits it cannot resolve on a boundary or coplanar surface. It does not yet provide
 * the near-coincident ambiguity bound (BNCE-GEO-002 in
 * docs/BROWSER_NATIVE_CAPTURE_ROBUST_GEOMETRY.md) that other backends will need.
 */
export function intersectBrowserNativeReferenceGeometry(
  prepared: PreparedBrowserNativeReferenceGeometry,
  rayInput: BrowserNativeReferenceRay
): BrowserNativeReferenceHitResult {
  if (
    prepared.schemaVersion !== BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION ||
    prepared.coordinateUnit !== "m" ||
    prepared.primitiveBoundaryRule !== "closed" ||
    prepared.forwardHitRule !== "strict-positive-ray-parameter" ||
    prepared.boxInsideOriginRule !== "first-forward-exit-surface" ||
    prepared.primitiveOrderMeaning !== "none"
  ) {
    throw new InvalidScientificInputError(
      "Unsupported prepared reference geometry contract."
    );
  }
  const { ray, directionMagnitude } = validateRay(rayInput);
  let best: Extract<BrowserNativeReferenceHitResult, { kind: "hit" }> | null =
    null;
  let tied = false;

  for (const primitive of prepared.primitives) {
    const localRay = rayInPrimitiveLocalSpace(ray, primitive.worldFromLocal);
    if (localRay === null) {
      return { kind: "unsupported", reason: "non-finite-intersection" };
    }
    const localResult =
      primitive.kind === "axis-aligned-rectangle"
        ? intersectRectangle(primitive, localRay, directionMagnitude)
        : intersectBox(primitive, localRay, directionMagnitude);

    if (localResult.kind === "unsupported") return localResult;
    if (localResult.kind === "miss") continue;

    const result = hit(
      localResult.primitiveId,
      ray,
      directionMagnitude,
      localResult.rayParameter
    );
    if (result.kind !== "hit") return result;

    // capture-33 (#698): a tie is reported only when another primitive shares the final minimum, so the answer does not
    // depend on primitive ID order (a tie between two farther primitives is superseded by a nearer hit).
    if (best === null || result.rayParameter < best.rayParameter) {
      best = result;
      tied = false;
      continue;
    }
    if (
      result.rayParameter === best.rayParameter &&
      result.primitiveId !== best.primitiveId
    ) {
      tied = true;
    }
  }

  if (tied) {
    return {
      kind: "unsupported",
      reason: "coincident-distinct-first-hit"
    };
  }
  return best ?? { kind: "miss" };
}
