// SPDX-License-Identifier: Apache-2.0

/**
 * Geometric image transforms (warps) such as distortion correction and projection changes, and
 * a resampler that applies them.
 *
 * A mapping goes from destination (output) points to source (captured) points. Preparing a
 * mapping fixes it for one still or frame; a change in time needs a new preparation.
 *
 * Transform kinds:
 * - `affine` and `radial` (schema 0.1.0, unchanged).
 * - From mapping schema 0.2.0: `brown-conrady` (radial plus tangential lens distortion) and
 *   `projection-remap` (a change of ideal projection, for example fisheye capture to a
 *   rectilinear or equirectangular view).
 *
 * A mapping that uses only 0.1.0 kinds keeps schema and model version 0.1.0 and gives identical output.
 * @see docs/DIGITAL_OPTICS_FOUNDATION.md for equations, coordinate/unit conventions, blockers and
 * support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  calculateRadialDistortionMapping, calculateInverseRadialDistortionMapping,
  validateRadialDistortionProfile, type RadialDistortionProfile, type LensFieldPointMm
} from "../optics/radial-distortion.js";
import { choice, finite, list, positive, record, textValue } from "../optics/profile-contract.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";
import {
  brownConradyForwardValue, brownConradyInverseValue, validateBrownConradyDistortionProfile,
  type BrownConradyDistortionProfile, type ValidatedBrownConradyDistortionProfile
} from "../optics/brown-conrady-distortion.js";
import {
  lensProjectionRemapValue, lensProjectionSignedAxisAngle, parseLensProjectionModel,
  type LensProjectionModel
} from "../camera/lens-projection.js";
import { point } from "../optics/stray-light.js";

/** A domain change separates maps: only adjacent maps in the same domain share one resampling pass. */
export type GeometricImageDomain = "raw-channel" | "reconstructed-linear" | "processed-output";
/** Jacobian (derivative) d(source mm)/d(destination mm), in row-major order. */
export type GeometricJacobian = readonly [number, number, number, number];
interface TransformIdentity {
  id: string;
  version: string;
  domain: GeometricImageDomain;
  purpose: "distortion" | "breathing" | "digital-stabilization" | "orientation-crop" | "lateral-ca" | "projection";
}
/** Explicit destination-to-source affine map, which can include rotation, shear and offset. */
export interface AffineGeometricTransform extends TransformIdentity {
  kind: "affine";
  matrix: GeometricJacobian;
  offsetMm: LensFieldPointMm;
}
/** Radial distortion. A correction reads the physically distorted data at the position mapped from each ideal (undistorted) destination point. */
export interface RadialGeometricTransform extends TransformIdentity {
  kind: "radial";
  profile: RadialDistortionProfile;
}
/** Schema 0.2.0: Brown-Conrady distortion. A correction reads the distorted data at the position mapped from each ideal destination point. */
export interface BrownConradyGeometricTransform extends TransformIdentity {
  kind: "brown-conrady";
  profile: BrownConradyDistortionProfile;
}
/** One ideal projection and its mapping scale (focal length, or mm per radian for equirectangular). */
export interface GeometricProjectionDeclaration {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
}
/**
 * Schema 0.2.0: change of projection. Each destination point becomes a scene direction (using
 * the destination projection), then a source point (using the source projection). Purpose must
 * be "projection".
 */
export interface ProjectionRemapGeometricTransform extends TransformIdentity {
  kind: "projection-remap";
  destinationProjection: GeometricProjectionDeclaration;
  sourceProjection: GeometricProjectionDeclaration;
}
export type DigitalGeometricTransform =
  | AffineGeometricTransform
  | RadialGeometricTransform
  | BrownConradyGeometricTransform
  | ProjectionRemapGeometricTransform;
/** Serializable prepared mapping. Maps are applied in the listed order, from destination towards source. */
export interface PreparedGeometricMapping {
  /** 0.1.0 when only affine and radial kinds are used; 0.2.0 when a kind added in 2.0 is present. */
  schemaVersion: "0.1.0" | "0.2.0";
  frameTimeSeconds: number;
  transforms: readonly DigitalGeometricTransform[];
  semanticKey: string;
  groups: readonly { domain: GeometricImageDomain; componentIds: readonly string[] }[];
}
/** A regular grid of pixel centres on the optical plane: +X right, +Y up; rows run top to bottom. */
export interface GeometricRaster {
  width: number;
  height: number;
  centerMm: LensFieldPointMm;
  pitchMm: number;
}
/** The resampling filter, chosen independently of the mapping. Any prefiltering (anti-aliasing) is the caller's job. */
export interface GeometricResampler {
  id: string;
  version: string;
  filter: "nearest" | "bilinear";
  antialias: "none" | "source-prefiltered";
}
export interface GeometricMappingPoint {
  sourcePointMm: LensFieldPointMm;
  jacobian: GeometricJacobian;
  determinant: number;
  principalStretches: readonly [number, number];
  anisotropy: number;
  components: readonly { id: string; sourcePointMm: LensFieldPointMm; jacobian: GeometricJacobian }[];
}
export interface GeometricSamplingPlan {
  mapping: PreparedGeometricMapping;
  sourceRaster: GeometricRaster;
  destinationRaster: GeometricRaster;
  resampler: GeometricResampler;
  points: readonly GeometricMappingPoint[];
  /** True where the selected filter has full source support around the pixel centre. Edges are not extended. */
  validSourceMask: readonly boolean[];
  /** Largest axis-aligned rectangle of valid pixels (half-open). Null if there is none. */
  jointCrop: { x: number; y: number; width: number; height: number } | null;
  requiresPrefilter: boolean;
  canResample: boolean;
  physicalCapturedFovDegrees: { horizontal: number; vertical: number };
  /** Angular extent of the mapped pixel-centre rays kept by the joint crop. It is not the edge-to-edge FOV. */
  retainedSampleRayEnvelopeDegrees: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

function multiply(a: GeometricJacobian, b: GeometricJacobian): GeometricJacobian {
  return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
    a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3]];
}
function determinant(m: GeometricJacobian): number { return m[0]*m[3]-m[1]*m[2]; }
function inverse(m: GeometricJacobian): GeometricJacobian {
  const d = determinant(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) throw new InvalidScientificInputError("Singular or ill-conditioned affine map.");
  return [m[3]/d, -m[1]/d, -m[2]/d, m[0]/d];
}
function affine(p: LensFieldPointMm, m: GeometricJacobian, o: LensFieldPointMm): LensFieldPointMm {
  return { x: m[0]*p.x+m[1]*p.y+o.x, y: m[2]*p.x+m[3]*p.y+o.y };
}
/** Strictly parses transform data. Unknown kinds or fields and profiles that cannot be inverted are rejected. */
export function parseDigitalGeometricTransform(value: unknown): DigitalGeometricTransform {
  const r = record(value, ["id", "version", "domain", "purpose", "kind", "matrix", "offsetMm", "profile",
    "destinationProjection", "sourceProjection"]);
  const identity = {
    id: textValue(r.id), version: textValue(r.version),
    domain: choice(r.domain, ["raw-channel", "reconstructed-linear", "processed-output"]),
    purpose: choice(r.purpose, ["distortion", "breathing", "digital-stabilization", "orientation-crop", "lateral-ca", "projection"])
  };
  const kind = choice(r.kind, ["affine", "radial", "brown-conrady", "projection-remap"]);
  if ((kind === "projection-remap") !== (identity.purpose === "projection")) {
    throw new InvalidScientificInputError("Purpose \"projection\" is used exactly by projection-remap transforms.");
  }
  if (kind !== "projection-remap" && (r.destinationProjection !== undefined || r.sourceProjection !== undefined)) {
    throw new InvalidScientificInputError("Only projection-remap transforms carry projection declarations.");
  }
  if (kind === "projection-remap") {
    if (r.matrix !== undefined || r.offsetMm !== undefined || r.profile !== undefined) {
      throw new InvalidScientificInputError("Projection remap cannot contain affine or distortion fields.");
    }
    const projection = (v: unknown): GeometricProjectionDeclaration => {
      const d = record(v, ["projectionModel", "focalLengthMm"]);
      return { projectionModel: parseLensProjectionModel(d.projectionModel), focalLengthMm: positive(d.focalLengthMm, "focalLengthMm") };
    };
    return { ...identity, kind, destinationProjection: projection(r.destinationProjection), sourceProjection: projection(r.sourceProjection) };
  }
  if (kind === "brown-conrady") {
    if (r.matrix !== undefined || r.offsetMm !== undefined) throw new InvalidScientificInputError("Brown-Conrady map cannot contain affine fields.");
    const p = record(r.profile, ["normalizationRadiusMm", "maximumNormalizedRadius", "coefficients"]);
    const c = record(p.coefficients, ["k1", "k2", "k3", "p1", "p2"]);
    const profile = { normalizationRadiusMm: positive(p.normalizationRadiusMm, "normalizationRadiusMm"),
      maximumNormalizedRadius: positive(p.maximumNormalizedRadius, "maximumNormalizedRadius"),
      coefficients: { k1: finite(c.k1, "k1"), k2: finite(c.k2, "k2"), k3: finite(c.k3, "k3"), p1: finite(c.p1, "p1"), p2: finite(c.p2, "p2") } };
    validateBrownConradyDistortionProfile(profile);
    return { ...identity, kind, profile };
  }
  if (kind === "affine") {
    if (r.profile !== undefined) throw new InvalidScientificInputError("Affine map cannot contain radial profile.");
    const entries = list(r.matrix, 4).map((v) => finite(v, "matrix"));
    if (entries.length !== 4) throw new InvalidScientificInputError("Matrix must have four entries.");
    const matrix = entries as [number, number, number, number];
    inverse(matrix);
    return { ...identity, kind, matrix, offsetMm: point(r.offsetMm) };
  }
  if (r.matrix !== undefined || r.offsetMm !== undefined) throw new InvalidScientificInputError("Radial map cannot contain affine fields.");
  const p = record(r.profile, ["normalizationRadiusMm", "maximumNormalizedRadius", "coefficients"]);
  const c = record(p.coefficients, ["k1", "k2", "k3"]);
  const profile = { normalizationRadiusMm: positive(p.normalizationRadiusMm, "normalizationRadiusMm"),
    maximumNormalizedRadius: positive(p.maximumNormalizedRadius, "maximumNormalizedRadius"),
    coefficients: { k1: finite(c.k1, "k1"), k2: finite(c.k2, "k2"), k3: finite(c.k3, "k3") } };
  validateRadialDistortionProfile(profile);
  return { ...identity, kind, profile };
}

/** Prepares a deterministic mapping for one still or frame. A change in time needs a new preparation. */
export function prepareGeometricMapping(input: {
  transforms: readonly DigitalGeometricTransform[]; frameTimeSeconds: number;
}): CalculationResult<PreparedGeometricMapping> {
  requireInputKeys(input, "prepareGeometricMapping", ["transforms", "frameTimeSeconds"]);
  const time = finite(input.frameTimeSeconds, "frameTimeSeconds");
  if (time < 0) throw new InvalidScientificInputError("Time is seconds from exposure start.");
  const transforms = list(input.transforms, 32).map(parseDigitalGeometricTransform);
  if (new Set(transforms.map((t) => t.id)).size !== transforms.length) throw new InvalidScientificInputError("Duplicate transform IDs.");
  const groups: { domain: GeometricImageDomain; componentIds: string[] }[] = [];
  for (const t of transforms) {
    const last = groups.at(-1);
    if (last?.domain === t.domain) last.componentIds.push(t.id);
    else groups.push({ domain: t.domain, componentIds: [t.id] });
  }
  const version = transforms.some((t) => t.kind === "brown-conrady" || t.kind === "projection-remap") ? "0.2.0" as const : "0.1.0" as const;
  return approximationResult({ schemaVersion: version, frameTimeSeconds: time, transforms,
    semanticKey: JSON.stringify({ frameTimeSeconds: time, transforms }), groups },
  "composed-digital-geometry", version, ["Explicit inverse maps; incompatible domains require separate image stages", "No physical PSF, photon or noise-history recalculation"]);
}

/**
 * Re-validates a prepared mapping from its defining fields (transforms and frame time). Its derived
 * fields (schema version, semantic key, groups) are recomputed, never trusted.
 */
function reprepareGeometricMapping(mapping: PreparedGeometricMapping): PreparedGeometricMapping {
  requireInputObject(mapping, "prepareGeometricMapping input");
  return prepareGeometricMapping({ transforms: mapping.transforms, frameTimeSeconds: mapping.frameTimeSeconds }).value;
}

/** Maps a display point to the capture, with the full local derivatives in each direction. */
export function calculateComposedGeometricMapping(input: {
  mapping: PreparedGeometricMapping; destinationPointMm: LensFieldPointMm;
}): CalculationResult<GeometricMappingPoint> {
  requireInputKeys(input, "calculateComposedGeometricMapping", ["mapping", "destinationPointMm"]);
  const mapping = reprepareGeometricMapping(input.mapping);
  return calculatePreparedGeometricMappingPoint(mapping, input.destinationPointMm);
}

/** Only a mapping parsed and copied within this call; prepared state from outside is never accepted. */
const VALIDATED_BROWN_CONRADY = new WeakMap<BrownConradyGeometricTransform, ValidatedBrownConradyDistortionProfile>();
/** Validates a parsed transform's profile once per prepared mapping (the transform object is call-local). */
function validatedBrownConrady(t: BrownConradyGeometricTransform): ValidatedBrownConradyDistortionProfile {
  let v = VALIDATED_BROWN_CONRADY.get(t);
  if (v === undefined) { v = validateBrownConradyDistortionProfile(t.profile); VALIDATED_BROWN_CONRADY.set(t, v); }
  return v;
}

function calculatePreparedGeometricMappingPoint(
  mapping: PreparedGeometricMapping,
  destinationPointMm: LensFieldPointMm
): CalculationResult<GeometricMappingPoint> {
  let p = point(destinationPointMm);
  let j: GeometricJacobian = [1, 0, 0, 1];
  const components: GeometricMappingPoint["components"][number][] = [];
  for (const t of mapping.transforms) {
    let local: GeometricJacobian;
    if (t.kind === "affine") {
      // Give each point its own result arrays when one mapping serves many points.
      local = [...t.matrix];
      p = affine(p, local, t.offsetMm);
    } else if (t.kind === "brown-conrady") {
      const mapped = brownConradyForwardValue(validatedBrownConrady(t), p);
      local = [...mapped.jacobian];
      p = mapped.mappedImagePointMm;
    } else if (t.kind === "projection-remap") {
      const mapped = lensProjectionRemapValue(t.destinationProjection.projectionModel, t.destinationProjection.focalLengthMm,
        t.sourceProjection.projectionModel, t.sourceProjection.focalLengthMm, p.x, p.y);
      local = [...mapped.jacobian];
      p = { ...mapped.sourcePointMm };
    } else {
      const { k1, k2, k3 } = t.profile.coefficients;
      const r2 = (p.x*p.x+p.y*p.y)/t.profile.normalizationRadiusMm**2;
      const s = 1+k1*r2+k2*r2*r2+k3*r2*r2*r2;
      const d = 2*(k1+2*k2*r2+3*k3*r2*r2)/t.profile.normalizationRadiusMm**2;
      local = [s+d*p.x*p.x, d*p.x*p.y, d*p.x*p.y, s+d*p.y*p.y];
      p = calculateRadialDistortionMapping({ imagePointMm: p, profile: t.profile }).value.mappedImagePointMm;
    }
    j = multiply(local, j);
    components.push({ id: t.id, sourcePointMm: { ...p }, jacobian: local });
  }
  // Singular values from the eigenvalues of the symmetric matrix JᵀJ. Computing the smaller one as
  // det/smax avoids cancellation error.
  const a = j[0]*j[0]+j[2]*j[2], b = j[0]*j[1]+j[2]*j[3], c = j[1]*j[1]+j[3]*j[3];
  const maximum = Math.sqrt((a+c+Math.hypot(a-c, 2*b))/2);
  const det = determinant(j), minimum = Math.abs(det)/maximum;
  return approximationResult({ sourcePointMm: p, jacobian: j, determinant: det,
    principalStretches: [maximum, minimum], anisotropy: maximum/minimum, components },
  "composed-digital-geometry-point", "0.1.0", ["Jacobian warps already-formed blur and noise; it creates no captured detail"]);
}

/** Maps a capture point to the display, for focus, metering and overlays. It inverts the same maps. */
export function calculateForwardGeometricMapping(input: {
  mapping: PreparedGeometricMapping; sourcePointMm: LensFieldPointMm;
}): CalculationResult<LensFieldPointMm> {
  requireInputKeys(input, "calculateForwardGeometricMapping", ["mapping", "sourcePointMm"]);
  let p = point(input.sourcePointMm);
  const mapping = reprepareGeometricMapping(input.mapping);
  for (const t of [...mapping.transforms].reverse()) {
    p = t.kind === "affine"
      ? affine({ x: p.x-t.offsetMm.x, y: p.y-t.offsetMm.y }, inverse(t.matrix), { x: 0, y: 0 })
      : t.kind === "brown-conrady"
        ? brownConradyInverseValue(validatedBrownConrady(t), p)
        : t.kind === "projection-remap"
          ? lensProjectionRemapValue(t.sourceProjection.projectionModel, t.sourceProjection.focalLengthMm,
            t.destinationProjection.projectionModel, t.destinationProjection.focalLengthMm, p.x, p.y).sourcePointMm
          : calculateInverseRadialDistortionMapping({ distortedImagePointMm: p, profile: t.profile }).value.sourceImagePointMm;
  }
  return approximationResult(p, "forward-digital-geometry-bridge", "0.1.0", ["Inverse of the authoritative destination-to-source geometry"]);
}

/** @internal Shared lattice validation for downstream correction consumers. */
export function parseGeometricRaster(value: unknown): GeometricRaster {
  const r = record(value, ["width", "height", "centerMm", "pitchMm"]);
  const width = positive(r.width, "width"), height = positive(r.height, "height");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width*height > 65536) {
    throw new InvalidScientificInputError("Raster must have at most 65536 integral samples.");
  }
  return { width, height, centerMm: point(r.centerMm), pitchMm: positive(r.pitchMm, "pitchMm") };
}
function pixelPoint(r: GeometricRaster, x: number, y: number): LensFieldPointMm {
  return { x: r.centerMm.x+(x+.5-r.width/2)*r.pitchMm, y: r.centerMm.y-(y+.5-r.height/2)*r.pitchMm };
}
function pixelCoordinate(r: GeometricRaster, p: LensFieldPointMm): LensFieldPointMm {
  return { x: (p.x-r.centerMm.x)/r.pitchMm+r.width/2-.5, y: (r.centerMm.y-p.y)/r.pitchMm+r.height/2-.5 };
}
function supported(r: GeometricRaster, p: LensFieldPointMm, filter: GeometricResampler["filter"]): boolean {
  const q = pixelCoordinate(r, p);
  return filter === "nearest"
    ? Math.round(q.x) >= 0 && Math.round(q.x) < r.width && Math.round(q.y) >= 0 && Math.round(q.y) < r.height
    : q.x >= 0 && q.x <= r.width-1 && q.y >= 0 && q.y <= r.height-1;
}
/** @internal Shared deterministic crop for a validated pixel mask. */
export function calculateValidSourceCrop(mask: readonly boolean[], width: number, height: number): GeometricSamplingPlan["jointCrop"] {
  const heights = Array<number>(width).fill(0);
  let best: GeometricSamplingPlan["jointCrop"] = null, area = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) heights[x] = mask[y*width+x] ? heights[x]!+1 : 0;
    const stack: number[] = [];
    for (let x = 0; x <= width; x++) {
      const h = x === width ? 0 : heights[x]!;
      while (stack.length && heights[stack.at(-1)!]! > h) {
        const index = stack.pop()!, rectangleHeight = heights[index]!;
        const left = stack.length ? stack.at(-1)!+1 : 0, rectangleWidth = x-left;
        if (rectangleHeight*rectangleWidth > area) {
          area = rectangleHeight*rectangleWidth;
          best = { x: left, y: y-rectangleHeight+1, width: rectangleWidth, height: rectangleHeight };
        }
      }
      stack.push(x);
    }
  }
  return best;
}

/** Composes compatible inverse maps, then resolves one shared plan for validity, crop and anti-aliasing (AA). */
export function calculateGeometricSamplingPlan(input: {
  mapping: PreparedGeometricMapping; sourceRaster: GeometricRaster; destinationRaster: GeometricRaster;
  resampler: GeometricResampler; physicalProjectionDistanceMm: number;
  /**
   * Ideal projection of the captured (source) image, used for the reported angles. Omitted or
   * "rectilinear" keeps the existing atan(mm / projection distance) angles exactly.
   */
  sourceProjectionModel?: LensProjectionModel;
}): CalculationResult<GeometricSamplingPlan> {
  requireInputKeys(input, "calculateGeometricSamplingPlan", ["mapping", "sourceRaster", "destinationRaster", "resampler", "physicalProjectionDistanceMm", "sourceProjectionModel"]);
  const mapping = reprepareGeometricMapping(input.mapping);
  if (mapping.groups.length > 1) throw new InvalidScientificInputError("Separate incompatible-domain groups before resampling.");
  const source = parseGeometricRaster(input.sourceRaster), destination = parseGeometricRaster(input.destinationRaster);
  const r = record(input.resampler, ["id", "version", "filter", "antialias"]);
  const resampler: GeometricResampler = { id: textValue(r.id), version: textValue(r.version),
    filter: choice(r.filter, ["nearest", "bilinear"]), antialias: choice(r.antialias, ["none", "source-prefiltered"]) };
  const projection = positive(input.physicalProjectionDistanceMm, "physicalProjectionDistanceMm");
  const points: GeometricMappingPoint[] = [], mask: boolean[] = [];
  for (let y = 0; y < destination.height; y++) for (let x = 0; x < destination.width; x++) {
    const mapped = calculatePreparedGeometricMappingPoint(mapping, pixelPoint(destination, x, y)).value;
    points.push(mapped); mask.push(supported(source, mapped.sourcePointMm, resampler.filter));
  }
  const requiresPrefilter = points.some((p) => p.principalStretches[0]*destination.pitchMm/source.pitchMm > 1+1e-12);
  const crop = calculateValidSourceCrop(mask, destination.width, destination.height);
  const sourceModel = input.sourceProjectionModel === undefined ? "rectilinear" : parseLensProjectionModel(input.sourceProjectionModel);
  const angle = sourceModel === "rectilinear"
    ? (mm: number): number => Math.atan(mm/projection)*180/Math.PI
    : (mm: number): number => lensProjectionSignedAxisAngle(sourceModel, projection, mm)*180/Math.PI;
  const retained = points.filter((_, i) => crop !== null && i%destination.width >= crop.x &&
    i%destination.width < crop.x+crop.width && Math.floor(i/destination.width) >= crop.y &&
    Math.floor(i/destination.width) < crop.y+crop.height).map((p) => p.sourcePointMm);
  const envelope = retained.length ? { minX: Math.min(...retained.map((p) => angle(p.x))),
    maxX: Math.max(...retained.map((p) => angle(p.x))), minY: Math.min(...retained.map((p) => angle(p.y))),
    maxY: Math.max(...retained.map((p) => angle(p.y))) } : null;
  return approximationResult({ mapping, sourceRaster: source, destinationRaster: destination, resampler, points,
    validSourceMask: mask, jointCrop: crop, requiresPrefilter,
    canResample: !requiresPrefilter || resampler.antialias === "source-prefiltered",
    physicalCapturedFovDegrees: {
      horizontal: angle(source.centerMm.x+source.width*source.pitchMm/2)-angle(source.centerMm.x-source.width*source.pitchMm/2),
      vertical: angle(source.centerMm.y+source.height*source.pitchMm/2)-angle(source.centerMm.y-source.height*source.pitchMm/2)
    }, retainedSampleRayEnvelopeDegrees: envelope },
  "joint-geometric-sampling-plan", "0.1.0", ["Mask and crop are exact for this pixel-center lattice/filter, not continuous between-pixel support", "Compression requires explicitly source-prefiltered data; this API does not implement that prefilter", "No temporal trajectory crop guarantee"]);
}

/** Resamples an already-formed single-channel image once. A null output sample marks missing source data. */
export function calculateGeometricResampling(input: {
  plan: GeometricSamplingPlan; sourceSamples: readonly number[];
}): CalculationResult<{ samples: readonly (number | null)[]; resamplePasses: 1; resampler: GeometricResampler }> {
  requireInputKeys(input, "calculateGeometricResampling", ["plan", "sourceSamples"]);
  const prior = input.plan;
  requireInputObject(prior, "calculateGeometricResampling plan");
  // Re-plan from the defining fields; the derived plan fields are recomputed, never trusted.
  const plan = calculateGeometricSamplingPlan({ mapping: prior.mapping, sourceRaster: prior.sourceRaster,
    destinationRaster: prior.destinationRaster, resampler: prior.resampler, physicalProjectionDistanceMm: 1 }).value;
  if (!plan.canResample) throw new InvalidScientificInputError("Compression requires source-prefiltered data.");
  const source = list(input.sourceSamples, 65536).map((v) => finite(v, "source sample"));
  if (source.length !== plan.sourceRaster.width*plan.sourceRaster.height) throw new InvalidScientificInputError("Source sample count mismatch.");
  const samples = plan.points.map((p, index): number | null => {
    if (!plan.validSourceMask[index]) return null;
    const q = pixelCoordinate(plan.sourceRaster, p.sourcePointMm), width = plan.sourceRaster.width;
    if (plan.resampler.filter === "nearest") return source[Math.round(q.y)*width+Math.round(q.x)]!;
    const x = Math.floor(q.x), y = Math.floor(q.y), dx = q.x-x, dy = q.y-y;
    // A centre exactly on the boundary needs no missing neighbour. The border is never extended.
    const x1 = dx === 0 ? x : x+1, y1 = dy === 0 ? y : y+1;
    return (1-dy)*((1-dx)*source[y*width+x]!+dx*source[y*width+x1]!) +
      dy*((1-dx)*source[y1*width+x]!+dx*source[y1*width+x1]!);
  });
  return approximationResult({ samples, resamplePasses: 1, resampler: plan.resampler },
    "single-pass-geometric-resampling", "0.1.0", ["Warps captured blur/noise; does not recalculate the optical PSF"]);
}
