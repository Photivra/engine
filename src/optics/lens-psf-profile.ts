// SPDX-License-Identifier: Apache-2.0

/**
 * Sampled lens PSF (point-spread function) profiles, and MTF-only diagnostic profiles.
 *
 * The parsers validate untrusted input and return the normalized typed contract. Unknown enum
 * values, missing required fields and incompatible scientific data are rejected.
 *
 * The resolver finds the sampled PSF for a declared optical state and query point. It never
 * extrapolates and never invents missing dimensions.
 *
 * A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
 * position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
 * the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
 * has no phase or spatial information, so it cannot justify rendering one unique PSF.
 * @see docs/PSF_FOUNDATION.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { freezeOwnedData } from "../core/owned-data.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseFocusPlane,
  type FocusPlane
} from "./focus-state.js";
import { requireInputKeys, rejectUnknownFields, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS } from "../core/record-validation.js";

type UnknownRecord = Record<string, unknown>;

export const LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;
export const LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export type LensPsfScientificStatus =
  | "calibrated"
  | "approximation";

export type LensPsfUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

/**
 * Kernel interpolation between regular-grid nodes.
 * - `bounded-regular-grid-multilinear`: the legacy weighted sum of kernel values. Blending kernels
 *   whose peaks sit at different positions gives several peaks.
 * - `bounded-regular-grid-centroid-aligned`: each node kernel is first shifted so its intensity
 *   centroid sits at the weighted (interpolated) centroid. Then the same multilinear weights are
 *   applied. Shifted or asymmetric PSFs therefore blend into one peak at the interpolated position.
 * - `rotationally-symmetric-radial-field-centroid-aligned`: for a rotationally symmetric lens. Nodes
 *   are declared only along the +X field axis (fieldYmm = [0], fieldXmm >= 0). A query at field
 *   (x, y) is interpolated, with centroid alignment, at radius hypot(x, y). The kernel is then
 *   rotated by atan2(y, x) about its centre, with the kernel row index increasing with image +Y (the
 *   convention the environment PSF quadrature applies), so an asymmetric kernel points the same way
 *   as in the 2-D grid modes. The sample pitch must be square.
 * Shifts and rotations use bilinear resampling. This smooths the kernel slightly (by at most about
 * one sample). Samples outside the kernel are zero, and the result is renormalised to unit energy.
 */
export type LensSampledPsfInterpolation =
  | "bounded-regular-grid-multilinear"
  | "bounded-regular-grid-centroid-aligned"
  | "rotationally-symmetric-radial-field-centroid-aligned";

const LENS_SAMPLED_PSF_INTERPOLATIONS: readonly LensSampledPsfInterpolation[] = [
  "bounded-regular-grid-multilinear",
  "bounded-regular-grid-centroid-aligned",
  "rotationally-symmetric-radial-field-centroid-aligned"
];

export interface LensPsfKernel {
  widthSamples: number;
  heightSamples: number;
  samplePitchMicrometersX: number;
  samplePitchMicrometersY: number;
  centerSampleX: number;
  centerSampleY: number;
  normalizedIntensity:
    readonly number[];
}

export interface LensPsfGridAxes {
  focalLengthMm:
    readonly number[];
  focusDiopters:
    readonly number[];
  apertureFNumber:
    readonly number[];
  fieldXmm:
    readonly number[];
  fieldYmm:
    readonly number[];
  wavelengthNm:
    readonly number[];
  signedDefocusImagePlaneMicrometers:
    readonly number[];
}

export interface LensSampledPsfGridCoordinate {
  focalLengthMm: number;
  focusDiopters: number;
  apertureFNumber: number;
  fieldXmm: number;
  fieldYmm: number;
  wavelengthNm: number;
  signedDefocusImagePlaneMicrometers:
    number;
}

export interface LensSampledPsfGridNode {
  nodeId: string;
  coordinate:
    LensSampledPsfGridCoordinate;
  kernel: LensPsfKernel;
  bestFocusImagePlaneOffsetMicrometers:
    number;
  relativePupilThroughputFactor:
    number;
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    LensPsfUncertainty;
}

export interface LensSampledPsfProfile {
  schemaVersion:
    typeof LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  opticalDomain:
    "lens-primary-optical-path-only";
  coordinateSystem:
    "image-plane-metric";
  fieldAxes:
    "+X right, +Y up";
  kernelEnergyNormalization:
    "unit-energy-shape";
  interpolation:
    LensSampledPsfInterpolation;
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  responseIncludes: {
    diffraction: boolean;
    aberration: boolean;
    defocus: boolean;
    pupilClippingShape:
      boolean;
  };
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded:
    false;
  reconstructionIncluded:
    false;
  strayLightIncluded: false;
  axes: LensPsfGridAxes;
  nodes:
    readonly LensSampledPsfGridNode[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface ResolveLensSampledPsfInput {
  profile:
    LensSampledPsfProfile;
  focalLengthMm: number;
  focus: FocusPlane;
  apertureFNumber: number;
  fieldPointMm: {
    x: number;
    y: number;
  };
  wavelengthNm: number;
  signedDefocusImagePlaneMicrometers:
    number;
}

export interface ResolvedLensSampledPsf {
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  resolutionStatus:
    | "exact-grid-sample"
    | "interpolated";
  coordinate:
    LensSampledPsfGridCoordinate;
  focus: FocusPlane;
  kernel: LensPsfKernel;
  bestFocusImagePlaneOffsetMicrometers:
    number;
  relativePupilThroughputFactor:
    number;
  sourceNodes:
    readonly {
      nodeId: string;
      weight: number;
      evidence:
        readonly EvidenceProvenance[];
      uncertainty:
        LensPsfUncertainty;
    }[];
  responseIncludes:
    LensSampledPsfProfile["responseIncludes"];
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  longitudinalChromaticFocusMayVaryWithWavelength:
    true;
  fieldCurvatureMayVaryWithFieldPosition:
    true;
  geometricDistortionModified:
    false;
  lateralChromaticPositionShiftApplied:
    false;
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded: false;
  reconstructionIncluded: false;
  strayLightIncluded: false;
  scalarSharpnessScoreProduced:
    false;
}

export interface LensMtfDiagnosticSample {
  spatialFrequencyCyclesPerMm:
    number;
  sagittalMagnitude: number;
  tangentialMagnitude: number;
}

export interface LensMtfDiagnosticProfile {
  schemaVersion:
    typeof LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  opticalDomain:
    "lens-primary-optical-path-only";
  phaseInformationAvailable:
    false;
  magnitudeMeaning:
    "mtf-magnitude-only";
  fieldPointMm: {
    x: number;
    y: number;
  };
  focalLengthMm: number;
  focus: FocusPlane;
  apertureFNumber: number;
  wavelengthNm: number | null;
  samples:
    readonly LensMtfDiagnosticSample[];
  evidence:
    readonly EvidenceProvenance[];
  limitations: readonly string[];
}

export interface MtfOnlyPsfRenderabilityAssessment {
  profileId: string;
  psfReconstructionAuthorized:
    false;
  reason:
    "mtf-magnitude-lacks-phase-and-does-not-uniquely-determine-psf";
  diagnosticUseAuthorized: true;
}

interface AxisBracket {
  lower: number;
  upper: number;
  /** Positions of lower and upper in the axis values. */
  lowerIndex: number;
  upperIndex: number;
  fraction: number;
  exact: boolean;
}

interface WeightedNode {
  node:
    LensSampledPsfGridNode;
  weight: number;
}

const AXIS_KEYS = [
  "focalLengthMm",
  "focusDiopters",
  "apertureFNumber",
  "fieldXmm",
  "fieldYmm",
  "wavelengthNm",
  "signedDefocusImagePlaneMicrometers"
] as const;

type AxisKey =
  typeof AXIS_KEYS[number];

function requireRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[] | null
): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new InvalidConfigurationError(
      path + " must be an object."
    );
  }
  if (allowedKeys !== null) rejectUnknownFields(value, allowedKeys, path);
  return value as UnknownRecord;
}

function requireNonEmptyString(
  value: unknown,
  path: string
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a non-empty string."
    );
  }
  return value.trim();
}

function requireFinite(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new InvalidConfigurationError(
      path + " must be finite."
    );
  }
  return value;
}

function requirePositiveFinite(
  value: unknown,
  path: string
): number {
  const parsed =
    requireFinite(value, path);
  if (parsed <= 0) {
    throw new InvalidConfigurationError(
      path +
        " must be greater than zero."
    );
  }
  return parsed;
}

function requireNonNegativeFinite(
  value: unknown,
  path: string
): number {
  const parsed =
    requireFinite(value, path);
  if (parsed < 0) {
    throw new InvalidConfigurationError(
      path +
        " must be greater than or equal to zero."
    );
  }
  return parsed;
}

function requireUnitInterval(
  value: unknown,
  path: string
): number {
  const parsed =
    requireFinite(value, path);
  if (
    parsed < 0 ||
    parsed > 1
  ) {
    throw new InvalidConfigurationError(
      path +
        " must lie from zero through one."
    );
  }
  return parsed;
}

function requirePositiveSafeInteger(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a positive safe integer."
    );
  }
  return value;
}

function requireNonNegativeSafeInteger(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a non-negative safe integer."
    );
  }
  return value;
}

function parseStatus(
  value: unknown,
  path: string
): LensPsfScientificStatus {
  if (
    value !== "calibrated" &&
    value !== "approximation"
  ) {
    throw new InvalidConfigurationError(
      path + " is invalid."
    );
  }
  return value;
}

function parseUncertainty(
  value: unknown,
  path: string
): LensPsfUncertainty {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);
  if (record.kind === "relative") {
    return {
      kind: "relative",
      fraction:
        requireNonNegativeFinite(
          record.fraction,
          path + ".fraction"
        ),
      basis:
        requireNonEmptyString(
          record.basis,
          path + ".basis"
        )
    };
  }
  if (
    record.kind ===
    "not-quantified"
  ) {
    return {
      kind: "not-quantified",
      limitation:
        requireNonEmptyString(
          record.limitation,
          path +
            ".limitation"
        )
    };
  }
  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseLimitations(
  value: unknown,
  path: string
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(
      path + " must be an array."
    );
  }
  const parsed =
    value.map(
      (entry, index) =>
        requireNonEmptyString(
          entry,
          path +
            "[" +
            index +
            "]"
        )
    );
  if (
    new Set(parsed).size !==
    parsed.length
  ) {
    throw new InvalidConfigurationError(
      path +
        " must not contain duplicates."
    );
  }
  return parsed;
}

function parseAxis(
  value: unknown,
  path: string,
  options: {
    positive?: boolean;
    nonNegative?: boolean;
  } = {}
): readonly number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a non-empty array."
    );
  }
  const parsed =
    value.map(
      (entry, index) => {
        const itemPath =
          path +
          "[" +
          index +
          "]";
        if (options.positive) {
          return requirePositiveFinite(
            entry,
            itemPath
          );
        }
        if (
          options.nonNegative
        ) {
          return requireNonNegativeFinite(
            entry,
            itemPath
          );
        }
        return requireFinite(
          entry,
          itemPath
        );
      }
    );
  for (
    let index = 1;
    index < parsed.length;
    index += 1
  ) {
    if (
      parsed[index]! <=
      parsed[index - 1]!
    ) {
      throw new InvalidConfigurationError(
        path +
          " must be strictly increasing with unique values."
      );
    }
  }
  return parsed;
}

function parseKernel(
  value: unknown,
  path: string
): LensPsfKernel {
  const record =
    requireRecord(value, path, ["widthSamples", "heightSamples", "centerSampleX", "centerSampleY", "normalizedIntensity", "samplePitchMicrometersX", "samplePitchMicrometersY"]);
  const widthSamples =
    requirePositiveSafeInteger(
      record.widthSamples,
      path + ".widthSamples"
    );
  const heightSamples =
    requirePositiveSafeInteger(
      record.heightSamples,
      path + ".heightSamples"
    );
  const total =
    widthSamples *
    heightSamples;
  if (!Number.isSafeInteger(total)) {
    throw new InvalidConfigurationError(
      path +
        " sample count must remain a safe integer."
    );
  }
  const centerSampleX =
    requireNonNegativeSafeInteger(
      record.centerSampleX,
      path + ".centerSampleX"
    );
  const centerSampleY =
    requireNonNegativeSafeInteger(
      record.centerSampleY,
      path + ".centerSampleY"
    );
  if (
    centerSampleX >=
      widthSamples ||
    centerSampleY >=
      heightSamples
  ) {
    throw new InvalidConfigurationError(
      path +
        " center sample must lie within the kernel grid."
    );
  }
  if (
    !Array.isArray(
      record.normalizedIntensity
    ) ||
    record
      .normalizedIntensity
      .length !== total
  ) {
    throw new InvalidConfigurationError(
      path +
        ".normalizedIntensity length must equal widthSamples × heightSamples."
    );
  }
  const normalizedIntensity =
    record
      .normalizedIntensity
      .map(
        (entry, index) =>
          requireNonNegativeFinite(
            entry,
            path +
              ".normalizedIntensity[" +
              index +
              "]"
          )
      );
  const sum =
    normalizedIntensity.reduce(
      (acc, entry) =>
        acc + entry,
      0
    );
  if (
    !Number.isFinite(sum) ||
    Math.abs(sum - 1) >
      1e-10
  ) {
    throw new InvalidConfigurationError(
      path +
        ".normalizedIntensity must sum to one."
    );
  }

  return {
    widthSamples,
    heightSamples,
    samplePitchMicrometersX:
      requirePositiveFinite(
        record
          .samplePitchMicrometersX,
        path +
          ".samplePitchMicrometersX"
      ),
    samplePitchMicrometersY:
      requirePositiveFinite(
        record
          .samplePitchMicrometersY,
        path +
          ".samplePitchMicrometersY"
      ),
    centerSampleX,
    centerSampleY,
    normalizedIntensity
  };
}

function parseAxes(
  value: unknown
): LensPsfGridAxes {
  const record =
    requireRecord(
      value,
      "lensPsfProfile.axes", ["focalLengthMm", "focusDiopters", "apertureFNumber", "fieldXmm", "fieldYmm", "wavelengthNm", "signedDefocusImagePlaneMicrometers"]
    );
  return {
    focalLengthMm:
      parseAxis(
        record.focalLengthMm,
        "lensPsfProfile.axes.focalLengthMm",
        {
          positive: true
        }
      ),
    focusDiopters:
      parseAxis(
        record.focusDiopters,
        "lensPsfProfile.axes.focusDiopters",
        {
          nonNegative: true
        }
      ),
    apertureFNumber:
      parseAxis(
        record.apertureFNumber,
        "lensPsfProfile.axes.apertureFNumber",
        {
          positive: true
        }
      ),
    fieldXmm:
      parseAxis(
        record.fieldXmm,
        "lensPsfProfile.axes.fieldXmm"
      ),
    fieldYmm:
      parseAxis(
        record.fieldYmm,
        "lensPsfProfile.axes.fieldYmm"
      ),
    wavelengthNm:
      parseAxis(
        record.wavelengthNm,
        "lensPsfProfile.axes.wavelengthNm",
        {
          positive: true
        }
      ),
    signedDefocusImagePlaneMicrometers:
      parseAxis(
        record
          .signedDefocusImagePlaneMicrometers,
        "lensPsfProfile.axes.signedDefocusImagePlaneMicrometers"
      )
  };
}

function parseCoordinate(
  value: unknown,
  path: string
): LensSampledPsfGridCoordinate {
  const record =
    requireRecord(value, path, ["focalLengthMm", "focusDiopters", "apertureFNumber", "fieldXmm", "fieldYmm", "wavelengthNm", "signedDefocusImagePlaneMicrometers"]);
  return {
    focalLengthMm:
      requirePositiveFinite(
        record.focalLengthMm,
        path + ".focalLengthMm"
      ),
    focusDiopters:
      requireNonNegativeFinite(
        record.focusDiopters,
        path + ".focusDiopters"
      ),
    apertureFNumber:
      requirePositiveFinite(
        record.apertureFNumber,
        path +
          ".apertureFNumber"
      ),
    fieldXmm:
      requireFinite(
        record.fieldXmm,
        path + ".fieldXmm"
      ),
    fieldYmm:
      requireFinite(
        record.fieldYmm,
        path + ".fieldYmm"
      ),
    wavelengthNm:
      requirePositiveFinite(
        record.wavelengthNm,
        path + ".wavelengthNm"
      ),
    signedDefocusImagePlaneMicrometers:
      requireFinite(
        record
          .signedDefocusImagePlaneMicrometers,
        path +
          ".signedDefocusImagePlaneMicrometers"
      )
  };
}

function coordinateKey(
  coordinate:
    LensSampledPsfGridCoordinate
): string {
  return AXIS_KEYS.map(
    (key) =>
      coordinate[key]
        .toString()
  ).join("|");
}

function axisContains(
  values:
    readonly number[],
  target: number
): boolean {
  return values.some(
    (value) =>
      value === target
  );
}

function validateNodeCoordinate(
  axes: LensPsfGridAxes,
  coordinate:
    LensSampledPsfGridCoordinate,
  path: string
): void {
  for (
    const key of AXIS_KEYS
  ) {
    if (
      !axisContains(
        axes[key],
        coordinate[key]
      )
    ) {
      throw new InvalidConfigurationError(
        path +
          "." +
          key +
          " must exactly match one declared grid-axis value."
      );
    }
  }
}

function parseNode(
  value: unknown,
  index: number,
  axes: LensPsfGridAxes,
  status:
    LensPsfScientificStatus
): LensSampledPsfGridNode {
  const path =
    "lensPsfProfile.nodes[" +
    index +
    "]";
  const record =
    requireRecord(value, path, ["coordinate", "uncertainty", "nodeId", "kernel", "bestFocusImagePlaneOffsetMicrometers", "relativePupilThroughputFactor", "evidence"]);
  const coordinate =
    parseCoordinate(
      record.coordinate,
      path + ".coordinate"
    );
  validateNodeCoordinate(
    axes,
    coordinate,
    path + ".coordinate"
  );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      path + ".uncertainty"
    );
  if (
    status === "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      path +
        " calibrated PSF data must declare quantified relative uncertainty."
    );
  }

  return {
    nodeId:
      requireNonEmptyString(
        record.nodeId,
        path + ".nodeId"
      ),
    coordinate,
    kernel:
      parseKernel(
        record.kernel,
        path + ".kernel"
      ),
    bestFocusImagePlaneOffsetMicrometers:
      requireFinite(
        record
          .bestFocusImagePlaneOffsetMicrometers,
        path +
          ".bestFocusImagePlaneOffsetMicrometers"
      ),
    relativePupilThroughputFactor:
      requireUnitInterval(
        record
          .relativePupilThroughputFactor,
        path +
          ".relativePupilThroughputFactor"
      ),
    evidence:
      parseEvidenceList(
        record.evidence,
        path + ".evidence"
      ),
    uncertainty
  };
}

function expectedNodeCount(
  axes: LensPsfGridAxes
): number {
  let count = 1;
  for (
    const key of AXIS_KEYS
  ) {
    count *= axes[key].length;
    if (
      !Number.isSafeInteger(count) ||
      count > 100_000
    ) {
      throw new InvalidConfigurationError(
        "lensPsfProfile regular grid must contain at most 100000 nodes."
      );
    }
  }
  return count;
}

function sameKernelGeometry(
  first: LensPsfKernel,
  second: LensPsfKernel
): boolean {
  return (
    first.widthSamples ===
      second.widthSamples &&
    first.heightSamples ===
      second.heightSamples &&
    first
      .samplePitchMicrometersX ===
      second
        .samplePitchMicrometersX &&
    first
      .samplePitchMicrometersY ===
      second
        .samplePitchMicrometersY &&
    first.centerSampleX ===
      second.centerSampleX &&
    first.centerSampleY ===
      second.centerSampleY
  );
}

/** Private profile declarations owned by the engine, registered by markEngineOwnedLensSampledPsfProfile. */
const ENGINE_OWNED_PROFILES = new WeakSet<object>();
/** Deep-frozen parse of a deep-frozen engine-owned declaration. */
const PARSED_OWNED_PROFILES = new WeakMap<object, LensSampledPsfProfile>();
/** Nodes by grid position (see buildGridNodeIndex). */
interface GridNodeIndex {
  readonly strides: readonly number[];
  readonly nodes: readonly (LensSampledPsfGridNode | undefined)[];
}
/** Grid node index of a cached, deep-frozen parse. */
const TRUSTED_NODE_INDEX = new WeakMap<LensSampledPsfProfile, GridNodeIndex>();

/**
 * Internal: registers a private profile declaration owned by the engine, so that repeated
 * resolveLensSampledPsf calls reuse one parse. The declaration is a structured clone that caller code
 * never sees.
 *
 * The first resolve parses it exactly like untrusted input. It then deep-freezes the declaration and
 * caches the frozen parse with its node index. A frozen declaration cannot change, so the cached
 * parse stays exact. Caller objects that were never registered are always parsed again.
 */
export function markEngineOwnedLensSampledPsfProfile(value: unknown): void {
  if (typeof value === "object" && value !== null) ENGINE_OWNED_PROFILES.add(value);
}

function parseOwnedOrUntrustedProfile(value: unknown): LensSampledPsfProfile {
  if (typeof value !== "object" || value === null || !ENGINE_OWNED_PROFILES.has(value)) {
    return parseLensSampledPsfProfile(value);
  }
  const cached = PARSED_OWNED_PROFILES.get(value);
  if (cached !== undefined) return cached;
  const parsed = parseLensSampledPsfProfile(value);
  try {
    freezeOwnedData(value);
  } catch {
    // Not plain data that freezeOwnedData accepts (for example typed-array storage), so do not cache.
    ENGINE_OWNED_PROFILES.delete(value);
    return parsed;
  }
  freezeOwnedData(parsed);
  TRUSTED_NODE_INDEX.set(parsed, buildGridNodeIndex(parsed));
  PARSED_OWNED_PROFILES.set(value, parsed);
  return parsed;
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
 * position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
 * the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
 * has no phase or spatial information, so it cannot justify rendering one unique PSF.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns LensSampledPsfProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseLensSampledPsfProfile(
  value: unknown
): LensSampledPsfProfile {
  const record =
    requireRecord(
      value,
      "lensPsfProfile", ["schemaVersion", "opticalDomain", "coordinateSystem", "fieldAxes", "kernelEnergyNormalization", "interpolation", "throughputOwnership", "sensorOpticalStackIncluded", "sensorSamplingIncluded", "reconstructionIncluded", "strayLightIncluded", "scientificStatus", "responseIncludes", "axes", "nodes", "profileId", "profileVersion", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'lensPsfProfile.schemaVersion must be "' +
        LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.opticalDomain !==
    "lens-primary-optical-path-only"
  ) {
    throw new InvalidConfigurationError(
      'lensPsfProfile.opticalDomain must be "lens-primary-optical-path-only".'
    );
  }
  if (
    record.coordinateSystem !==
      "image-plane-metric" ||
    record.fieldAxes !==
      "+X right, +Y up"
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile image-plane coordinate semantics are invalid."
    );
  }
  if (
    record.kernelEnergyNormalization !==
      "unit-energy-shape" ||
    !(LENS_SAMPLED_PSF_INTERPOLATIONS as readonly unknown[]).includes(
      record.interpolation
    ) ||
    record.throughputOwnership !==
      "separate-relative-pupil-throughput-factor"
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile normalization/interpolation/throughput ownership is invalid."
    );
  }
  if (
    record.sensorOpticalStackIncluded !==
      false ||
    record.sensorSamplingIncluded !==
      false ||
    record.reconstructionIncluded !==
      false ||
    record.strayLightIncluded !==
      false
  ) {
    throw new InvalidConfigurationError(
      "V1 lens PSF profiles must remain lens-primary-optical-path-only and exclude sensor/reconstruction/stray-light effects."
    );
  }

  const status =
    parseStatus(
      record.scientificStatus,
      "lensPsfProfile.scientificStatus"
    );
  const response =
    requireRecord(
      record.responseIncludes,
      "lensPsfProfile.responseIncludes", ["diffraction", "aberration", "defocus", "pupilClippingShape"]
    );
  for (
    const key of [
      "diffraction",
      "aberration",
      "defocus",
      "pupilClippingShape"
    ] as const
  ) {
    if (
      typeof response[key] !==
      "boolean"
    ) {
      throw new InvalidConfigurationError(
        "lensPsfProfile.responseIncludes." +
          key +
          " must be boolean."
      );
    }
  }
  const axes =
    parseAxes(record.axes);
  if (
    !Array.isArray(
      record.nodes
    )
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile.nodes must be an array."
    );
  }
  if (
    record.nodes.length !==
    expectedNodeCount(axes)
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile.nodes must contain exactly one node for every regular-grid coordinate."
    );
  }
  const nodes =
    record.nodes.map(
      (node, index) =>
        parseNode(
          node,
          index,
          axes,
          status
        )
    );
  const ids =
    nodes.map(
      (node) =>
        node.nodeId
    );
  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile.nodes must not contain duplicate nodeId values."
    );
  }
  const coordinateKeys =
    nodes.map(
      (node) =>
        coordinateKey(
          node.coordinate
        )
    );
  if (
    new Set(coordinateKeys).size !==
    coordinateKeys.length
  ) {
    throw new InvalidConfigurationError(
      "lensPsfProfile.nodes must not contain duplicate grid coordinates."
    );
  }

  const firstKernel =
    nodes[0]?.kernel;
  if (firstKernel === undefined) {
    throw new InvalidConfigurationError(
      "lensPsfProfile.nodes must not be empty."
    );
  }
  for (
    const node of nodes
  ) {
    if (
      !sameKernelGeometry(
        firstKernel,
        node.kernel
      )
    ) {
      throw new InvalidConfigurationError(
        "Every lensPsfProfile node must use identical PSF kernel grid geometry for multilinear interpolation."
      );
    }
  }

  if (
    record.interpolation ===
    "rotationally-symmetric-radial-field-centroid-aligned"
  ) {
    if (
      axes.fieldYmm.length !== 1 ||
      axes.fieldYmm[0] !== 0 ||
      axes.fieldXmm.some((value) => value < 0)
    ) {
      throw new InvalidConfigurationError(
        "Rotationally symmetric PSF profiles must declare fieldYmm = [0] and non-negative fieldXmm radii."
      );
    }
    if (
      firstKernel.samplePitchMicrometersX !==
      firstKernel.samplePitchMicrometersY
    ) {
      throw new InvalidConfigurationError(
        "Rotationally symmetric PSF profiles require square kernel sample pitch for rotation."
      );
    }
  }

  return {
    schemaVersion:
      LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "lensPsfProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "lensPsfProfile.profileVersion"
      ),
    scientificStatus:
      status,
    opticalDomain:
      "lens-primary-optical-path-only",
    coordinateSystem:
      "image-plane-metric",
    fieldAxes:
      "+X right, +Y up",
    kernelEnergyNormalization:
      "unit-energy-shape",
    interpolation:
      record.interpolation as LensSampledPsfInterpolation,
    throughputOwnership:
      "separate-relative-pupil-throughput-factor",
    responseIncludes: {
      diffraction:
        response.diffraction as boolean,
      aberration:
        response.aberration as boolean,
      defocus:
        response.defocus as boolean,
      pupilClippingShape:
        response
          .pupilClippingShape as boolean
    },
    sensorOpticalStackIncluded:
      false,
    sensorSamplingIncluded:
      false,
    reconstructionIncluded:
      false,
    strayLightIncluded:
      false,
    axes,
    nodes,
    evidence:
      parseEvidenceList(
        record.evidence,
        "lensPsfProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "lensPsfProfile.limitations"
      )
  };
}

function focusDiopters(
  focus: FocusPlane
): number {
  const parsed =
    parseFocusPlane(focus);
  return parsed.kind ===
    "infinity"
    ? 0
    : 1 /
      parsed.distanceM;
}

function requireScientificFinite(
  value: number,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new InvalidScientificInputError(
      path + " must be finite."
    );
  }
  return value;
}

function requireScientificPositiveFinite(
  value: number,
  path: string
): number {
  const parsed =
    requireScientificFinite(
      value,
      path
    );
  if (parsed <= 0) {
    throw new InvalidScientificInputError(
      path +
        " must be greater than zero."
    );
  }
  return parsed;
}

function bracketAxis(
  values:
    readonly number[],
  target: number,
  path: string
): AxisBracket {
  const minimum =
    values[0]!;
  const maximum =
    values[
      values.length - 1
    ]!;
  const scale =
    Math.max(
      1,
      Math.abs(target),
      Math.abs(minimum),
      Math.abs(maximum)
    );
  const tolerance =
    Number.EPSILON *
    64 *
    scale;
  if (
    target <
      minimum - tolerance ||
    target >
      maximum + tolerance
  ) {
    throw new InvalidScientificInputError(
      path +
        " lies outside the declared PSF profile grid; extrapolation is not permitted."
    );
  }

  for (
    let index = 0;
    index < values.length;
    index += 1
  ) {
    const value = values[index]!;
    if (
      Math.abs(
        target - value
      ) <= tolerance
    ) {
      return {
        lower: value,
        upper: value,
        lowerIndex: index,
        upperIndex: index,
        fraction: 0,
        exact: true
      };
    }
  }

  for (
    let index = 0;
    index <
      values.length - 1;
    index += 1
  ) {
    const lower =
      values[index]!;
    const upper =
      values[index + 1]!;
    if (
      target > lower &&
      target < upper
    ) {
      return {
        lower,
        upper,
        lowerIndex: index,
        upperIndex: index + 1,
        fraction:
          (target - lower) /
          (upper - lower),
        exact: false
      };
    }
  }

  throw new InvalidScientificInputError(
    path +
      " could not be bracketed inside the declared PSF profile grid."
  );
}

function queryCoordinate(
  input:
    ResolveLensSampledPsfInput
): {
  coordinate:
    LensSampledPsfGridCoordinate;
  focus: FocusPlane;
} {
  const focus =
    parseFocusPlane(
      input.focus
    );
  return {
    coordinate: {
      focalLengthMm:
        requireScientificPositiveFinite(
          input.focalLengthMm,
          "focalLengthMm"
        ),
      focusDiopters:
        focusDiopters(focus),
      apertureFNumber:
        requireScientificPositiveFinite(
          input.apertureFNumber,
          "apertureFNumber"
        ),
      fieldXmm:
        requireScientificFinite(
          input.fieldPointMm.x,
          "fieldPointMm.x"
        ),
      fieldYmm:
        requireScientificFinite(
          input.fieldPointMm.y,
          "fieldPointMm.y"
        ),
      wavelengthNm:
        requireScientificPositiveFinite(
          input.wavelengthNm,
          "wavelengthNm"
        ),
      signedDefocusImagePlaneMicrometers:
        requireScientificFinite(
          input
            .signedDefocusImagePlaneMicrometers,
          "signedDefocusImagePlaneMicrometers"
        )
    },
    focus
  };
}

function bracketCoordinate(
  axes: LensPsfGridAxes,
  coordinate:
    LensSampledPsfGridCoordinate
): Record<AxisKey, AxisBracket> {
  return {
    focalLengthMm:
      bracketAxis(
        axes.focalLengthMm,
        coordinate.focalLengthMm,
        "focalLengthMm"
      ),
    focusDiopters:
      bracketAxis(
        axes.focusDiopters,
        coordinate.focusDiopters,
        "focus"
      ),
    apertureFNumber:
      bracketAxis(
        axes.apertureFNumber,
        coordinate.apertureFNumber,
        "apertureFNumber"
      ),
    fieldXmm:
      bracketAxis(
        axes.fieldXmm,
        coordinate.fieldXmm,
        "fieldPointMm.x"
      ),
    fieldYmm:
      bracketAxis(
        axes.fieldYmm,
        coordinate.fieldYmm,
        "fieldPointMm.y"
      ),
    wavelengthNm:
      bracketAxis(
        axes.wavelengthNm,
        coordinate.wavelengthNm,
        "wavelengthNm"
      ),
    signedDefocusImagePlaneMicrometers:
      bracketAxis(
        axes
          .signedDefocusImagePlaneMicrometers,
        coordinate
          .signedDefocusImagePlaneMicrometers,
        "signedDefocusImagePlaneMicrometers"
      )
  };
}

/** Flat-index strides of the regular grid over AXIS_KEYS (the last axis varies fastest). */
function gridStrides(axes: LensPsfGridAxes): number[] {
  const strides = new Array<number>(AXIS_KEYS.length);
  let stride = 1;
  for (let a = AXIS_KEYS.length - 1; a >= 0; a -= 1) {
    strides[a] = stride;
    stride *= axes[AXIS_KEYS[a]!].length;
  }
  return strides;
}

/**
 * Nodes indexed by grid position. Node coordinates match declared axis values exactly (checked by the
 * parser, with `===`, so −0 and 0 are one position) and are unique, so each position holds at most one node.
 */
function buildGridNodeIndex(profile: LensSampledPsfProfile): GridNodeIndex {
  const strides = gridStrides(profile.axes);
  const nodes = new Array<LensSampledPsfGridNode | undefined>(AXIS_KEYS.reduce((n, key) => n * profile.axes[key].length, 1));
  for (const node of profile.nodes) {
    let flat = 0;
    for (let a = 0; a < AXIS_KEYS.length; a += 1) {
      const key = AXIS_KEYS[a]!;
      flat += profile.axes[key].indexOf(node.coordinate[key]) * strides[a]!;
    }
    nodes[flat] = node;
  }
  return { strides, nodes };
}

/**
 * The multilinear corners of a bracketed query and their weights, in a fixed order: axes in AXIS_KEYS order,
 * lower before upper, zero-weight options skipped. Each weight is the product of its per-axis weights in that order.
 */
function resolveWeightedNodes(
  profile:
    LensSampledPsfProfile,
  brackets:
    Record<
      AxisKey,
      AxisBracket
    >
): readonly WeightedNode[] {
  const index = TRUSTED_NODE_INDEX.get(profile) ?? buildGridNodeIndex(profile);
  let flats = [0], weights = [1];
  for (let a = 0; a < AXIS_KEYS.length; a += 1) {
    const bracket = brackets[AXIS_KEYS[a]!], stride = index.strides[a]!;
    const nextFlats: number[] = [], nextWeights: number[] = [];
    for (let c = 0; c < flats.length; c += 1) {
      if (bracket.exact) {
        nextFlats.push(flats[c]! + bracket.lowerIndex * stride);
        nextWeights.push(weights[c]! * 1);
        continue;
      }
      const lowerWeight = 1 - bracket.fraction, upperWeight = bracket.fraction;
      if (lowerWeight !== 0) { nextFlats.push(flats[c]! + bracket.lowerIndex * stride); nextWeights.push(weights[c]! * lowerWeight); }
      if (upperWeight !== 0) { nextFlats.push(flats[c]! + bracket.upperIndex * stride); nextWeights.push(weights[c]! * upperWeight); }
    }
    flats = nextFlats;
    weights = nextWeights;
  }
  return flats.map((flat, c) => {
    const node = index.nodes[flat];
    if (node === undefined) {
      throw new InvalidScientificInputError(
        "PSF profile grid is missing a required interpolation corner."
      );
    }
    return { node, weight: weights[c]! };
  });
}

function interpolateKernel(
  weighted:
    readonly WeightedNode[]
): LensPsfKernel {
  const first =
    weighted[0]?.node.kernel;
  if (first === undefined) {
    throw new InvalidScientificInputError(
      "PSF interpolation requires at least one source node."
    );
  }
  const values =
    new Array<number>(
      first
        .normalizedIntensity
        .length
    ).fill(0);

  for (
    const entry of weighted
  ) {
    for (
      let index = 0;
      index < values.length;
      index += 1
    ) {
      values[index]! +=
        entry.weight *
        entry.node.kernel
          .normalizedIntensity[index]!;
    }
  }

  const sum =
    values.reduce(
      (acc, value) =>
        acc + value,
      0
    );
  if (
    !Number.isFinite(sum) ||
    sum <= 0
  ) {
    throw new InvalidScientificInputError(
      "Interpolated PSF energy must remain finite and positive."
    );
  }
  const normalized =
    values.map(
      (value) =>
        value / sum
    );

  return {
    widthSamples:
      first.widthSamples,
    heightSamples:
      first.heightSamples,
    samplePitchMicrometersX:
      first
        .samplePitchMicrometersX,
    samplePitchMicrometersY:
      first
        .samplePitchMicrometersY,
    centerSampleX:
      first.centerSampleX,
    centerSampleY:
      first.centerSampleY,
    normalizedIntensity:
      normalized
  };
}

function kernelCentroid(
  kernel: LensPsfKernel
): { x: number; y: number } {
  let sum = 0;
  let x = 0;
  let y = 0;
  for (let row = 0; row < kernel.heightSamples; row += 1) {
    for (let column = 0; column < kernel.widthSamples; column += 1) {
      const value = kernel.normalizedIntensity[row * kernel.widthSamples + column]!;
      sum += value;
      x += value * (column - kernel.centerSampleX);
      y += value * (row - kernel.centerSampleY);
    }
  }
  return { x: x / sum, y: y / sum };
}

/** Bilinear sample at fractional array coordinates; zero outside the kernel. */
function bilinearSample(
  kernel: LensPsfKernel,
  column: number,
  row: number
): number {
  const x0 = Math.floor(column);
  const y0 = Math.floor(row);
  const fx = column - x0;
  const fy = row - y0;
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= kernel.widthSamples || y >= kernel.heightSamples
      ? 0
      : kernel.normalizedIntensity[y * kernel.widthSamples + x]!;
  const top = fx === 0 ? at(x0, y0) : (1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0);
  if (fy === 0) {
    return top;
  }
  const bottom = fx === 0 ? at(x0, y0 + 1) : (1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1);
  return (1 - fy) * top + fy * bottom;
}

function normalizedKernel(
  template: LensPsfKernel,
  values: readonly number[]
): LensPsfKernel {
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new InvalidScientificInputError(
      "Interpolated PSF energy must remain finite and positive."
    );
  }
  return {
    widthSamples: template.widthSamples,
    heightSamples: template.heightSamples,
    samplePitchMicrometersX: template.samplePitchMicrometersX,
    samplePitchMicrometersY: template.samplePitchMicrometersY,
    centerSampleX: template.centerSampleX,
    centerSampleY: template.centerSampleY,
    normalizedIntensity: values.map((value) => value / sum)
  };
}

/**
 * Centroid-aligned interpolation. Each node kernel is shifted so its intensity centroid lands on the
 * weighted centroid. Then the multilinear weights are applied. A single exact node is returned
 * unchanged.
 */
function interpolateKernelCentroidAligned(
  weighted: readonly WeightedNode[]
): LensPsfKernel {
  const first = weighted[0]?.node.kernel;
  if (first === undefined) {
    throw new InvalidScientificInputError(
      "PSF interpolation requires at least one source node."
    );
  }
  if (weighted.length === 1) {
    // An exact grid node is already a validated unit-energy kernel; return it bit-for-bit.
    return { ...first, normalizedIntensity: [...first.normalizedIntensity] };
  }
  const centroids = weighted.map((entry) => kernelCentroid(entry.node.kernel));
  const target = centroids.reduce(
    (acc, centroid, index) => ({
      x: acc.x + weighted[index]!.weight * centroid.x,
      y: acc.y + weighted[index]!.weight * centroid.y
    }),
    { x: 0, y: 0 }
  );
  const values = new Array<number>(first.normalizedIntensity.length).fill(0);
  weighted.forEach((entry, index) => {
    const dx = centroids[index]!.x - target.x;
    const dy = centroids[index]!.y - target.y;
    for (let row = 0; row < first.heightSamples; row += 1) {
      for (let column = 0; column < first.widthSamples; column += 1) {
        values[row * first.widthSamples + column]! +=
          entry.weight * bilinearSample(entry.node.kernel, column + dx, row + dy);
      }
    }
  });
  return normalizedKernel(first, values);
}

/**
 * Rotates a kernel by angleRadians (counter-clockwise from image +X towards image +Y) about its centre sample.
 * The row index increases with image +Y, the convention the environment PSF quadrature applies (`sensorPsfSourcePoint`:
 * tap (kx, ky) lands at image offset (+(kx − cx)·pₓ, +(ky − cy)·p_y), +Y up), so a kernel declared along +X and rotated to
 * field azimuth atan2(y, x) points the same way in the rendered image as a 2-D grid node declared at (x, y). Before 2.19.0
 * this read rows as image −Y, which mirrored asymmetric kernels in y (#566).
 */
function rotateKernel(
  kernel: LensPsfKernel,
  angleRadians: number
): LensPsfKernel {
  const cos = Math.cos(angleRadians);
  const sin = Math.sin(angleRadians);
  const values: number[] = [];
  for (let row = 0; row < kernel.heightSamples; row += 1) {
    // Row index increases with image +Y (sensorPsfSourcePoint).
    const y = row - kernel.centerSampleY;
    for (let column = 0; column < kernel.widthSamples; column += 1) {
      const x = column - kernel.centerSampleX;
      // Inverse rotation: destination (x, y) samples source R(-angle) (x, y).
      const sourceX = cos * x + sin * y;
      const sourceY = -sin * x + cos * y;
      values.push(
        bilinearSample(
          kernel,
          kernel.centerSampleX + sourceX,
          kernel.centerSampleY + sourceY
        )
      );
    }
  }
  return normalizedKernel(kernel, values);
}

function weightedScalar(
  weighted:
    readonly WeightedNode[],
  select:
    (
      node:
        LensSampledPsfGridNode
    ) => number
): number {
  return weighted.reduce(
    (sum, entry) =>
      sum +
      entry.weight *
        select(entry.node),
    0
  );
}

/** The resolved PSF before its result envelope; resolveLensSampledPsf and the lean native executor share it. */
interface ResolvedLensSampledPsfCore {
  profile: LensSampledPsfProfile;
  query: ReturnType<typeof queryCoordinate>;
  rotational: boolean;
  exact: boolean;
  weighted: readonly WeightedNode[];
  kernel: LensPsfKernel;
  bestFocus: number;
  throughput: number;
}

function resolveLensSampledPsfCore(
  input:
    ResolveLensSampledPsfInput
): ResolvedLensSampledPsfCore {
  requireInputKeys(input, "resolveLensSampledPsf", ["profile", "focalLengthMm", "focus", "apertureFNumber", "fieldPointMm", "wavelengthNm", "signedDefocusImagePlaneMicrometers"]);
  const profile =
    parseOwnedOrUntrustedProfile(
      input.profile
    );
  const query =
    queryCoordinate(input);
  const rotational =
    profile.interpolation ===
    "rotationally-symmetric-radial-field-centroid-aligned";
  const fieldRadiusMm = Math.hypot(
    query.coordinate.fieldXmm,
    query.coordinate.fieldYmm
  );
  const fieldAngleRadians = rotational
    ? Math.atan2(query.coordinate.fieldYmm, query.coordinate.fieldXmm)
    : 0;
  const brackets =
    bracketCoordinate(
      profile.axes,
      rotational
        ? { ...query.coordinate, fieldXmm: fieldRadiusMm, fieldYmm: 0 }
        : query.coordinate
    );
  const weighted =
    resolveWeightedNodes(
      profile,
      brackets
    );
  const exact =
    AXIS_KEYS.every(
      (key) =>
        brackets[key].exact
    ) && fieldAngleRadians === 0;
  const kernel =
    profile.interpolation === "bounded-regular-grid-multilinear"
      ? interpolateKernel(weighted)
      : fieldAngleRadians === 0
        ? interpolateKernelCentroidAligned(weighted)
        : rotateKernel(
            interpolateKernelCentroidAligned(weighted),
            fieldAngleRadians
          );
  const bestFocus =
    weightedScalar(
      weighted,
      (node) =>
        node
          .bestFocusImagePlaneOffsetMicrometers
    );
  // A multilinear blend is a convex combination, so it cannot exceed its largest node value. But its
  // floating-point weights can sum to a few ulps above 1. A result above 1 that lies within
  // 8·ε·(node count)·max of the largest node is that rounding error. It is clamped to the largest node
  // value (≤ 1, so the result is again a declared value). Results already within [0, 1] are unchanged.
  const blended =
    weightedScalar(
      weighted,
      (node) =>
        node
          .relativePupilThroughputFactor
    );
  const largestThroughput = Math.max(...weighted.map((entry) => entry.node.relativePupilThroughputFactor));
  const throughput =
    blended > 1 && largestThroughput <= 1 &&
    blended - largestThroughput <= 8 * Number.EPSILON * weighted.length * Math.max(1, largestThroughput)
      ? largestThroughput
      : blended;
  if (
    !Number.isFinite(
      bestFocus
    ) ||
    !Number.isFinite(
      throughput
    ) ||
    throughput < 0 ||
    throughput > 1
  ) {
    throw new InvalidScientificInputError(
      "Interpolated PSF metadata must remain finite and physically bounded."
    );
  }

  return { profile, query, rotational, exact, weighted, kernel, bestFocus, throughput };
}

/**
 * Internal (2.0 performance): the kernel resolveLensSampledPsf returns for the same input, computed by
 * the same code without building the result envelope. Throws whenever resolveLensSampledPsf would throw
 * before its envelope. Not exported from the package.
 */
export function resolveLensSampledPsfKernel(
  input:
    ResolveLensSampledPsfInput
): LensPsfKernel {
  return resolveLensSampledPsfCore(input).kernel;
}

/**
 * Resolves the sampled PSF for a declared optical state and query point. It never extrapolates and
 * never invents missing dimensions.
 *
 * A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
 * position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
 * the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
 * has no phase or spatial information, so it cannot justify rendering one unique PSF.
 * @param input - ResolveLensSampledPsfInput. See that type for coordinates, units and profile binding.
 * @returns CalculationResult<ResolvedLensSampledPsf>. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function resolveLensSampledPsf(
  input:
    ResolveLensSampledPsfInput
): CalculationResult<ResolvedLensSampledPsf> {
  const { profile, query, rotational, exact, weighted, kernel, bestFocus, throughput } =
    resolveLensSampledPsfCore(input);
  return approximationResult(
    {
      profileId:
        profile.profileId,
      profileVersion:
        profile.profileVersion,
      scientificStatus:
        profile.scientificStatus,
      resolutionStatus:
        exact
          ? "exact-grid-sample"
          : "interpolated",
      coordinate:
        query.coordinate,
      focus:
        query.focus,
      kernel,
      bestFocusImagePlaneOffsetMicrometers:
        bestFocus,
      relativePupilThroughputFactor:
        throughput,
      sourceNodes:
        weighted.map(
          (entry) => ({
            nodeId:
              entry.node.nodeId,
            weight:
              entry.weight,
            evidence:
              entry.node.evidence,
            uncertainty:
              entry.node
                .uncertainty
          })
        ),
      responseIncludes: {
        ...profile
          .responseIncludes
      },
      throughputOwnership:
        "separate-relative-pupil-throughput-factor",
      longitudinalChromaticFocusMayVaryWithWavelength:
        true,
      fieldCurvatureMayVaryWithFieldPosition:
        true,
      geometricDistortionModified:
        false,
      lateralChromaticPositionShiftApplied:
        false,
      sensorOpticalStackIncluded:
        false,
      sensorSamplingIncluded:
        false,
      reconstructionIncluded:
        false,
      strayLightIncluded:
        false,
      scalarSharpnessScoreProduced:
        false
    },
    profile.interpolation === "bounded-regular-grid-multilinear"
      ? "lens-sampled-psf-bounded-interpolation"
      : rotational
        ? "lens-sampled-psf-rotational-centroid-aligned-interpolation"
        : "lens-sampled-psf-centroid-aligned-interpolation",
    "1.0.0",
    [
      ...(profile.interpolation === "bounded-regular-grid-multilinear"
        ? []
        : [
            "Node kernels are translated to the weighted intensity centroid before blending (bilinear resampling, outside samples zero, renormalised), so shifted PSFs blend into one peak.",
            ...(rotational
              ? ["Rotationally symmetric lens: nodes along +X are interpolated at the field radius and the kernel is rotated by the field azimuth."]
              : [])
          ]),
      "PSF intensity is a unit-energy shape; relative pupil throughput remains a separate factor for the optical-throughput path.",
      "Regular-grid interpolation is bounded and never extrapolates beyond declared focal-length, focus, aperture, field, wavelength or signed-defocus axes.",
      "Full 2D image-plane kernel orientation is preserved in +X right, +Y up coordinates; no radial or sagittal/tangential averaging is forced.",
      "bestFocusImagePlaneOffsetMicrometers may vary with field and wavelength, representing field-curvature and longitudinal-chromatic-focus behavior without changing geometric distortion or lateral chromatic position.",
      "Lens PSF remains upstream of sensor optical stack, sampling and reconstruction, and excludes stray-light/ghosting contributions.",
      "No scalar lens-quality, sharpness or bokeh-quality score is produced."
    ]
  );
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
 * position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
 * the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
 * has no phase or spatial information, so it cannot justify rendering one unique PSF.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns LensMtfDiagnosticProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseLensMtfDiagnosticProfile(
  value: unknown
): LensMtfDiagnosticProfile {
  const record =
    requireRecord(
      value,
      "lensMtfProfile", ["schemaVersion", "opticalDomain", "phaseInformationAvailable", "magnitudeMeaning", "samples", "fieldPointMm", "wavelengthNm", "profileId", "profileVersion", "focalLengthMm", "focus", "apertureFNumber", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'lensMtfProfile.schemaVersion must be "' +
        LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.opticalDomain !==
      "lens-primary-optical-path-only" ||
    record.phaseInformationAvailable !==
      false ||
    record.magnitudeMeaning !==
      "mtf-magnitude-only"
  ) {
    throw new InvalidConfigurationError(
      "lensMtfProfile optical/phase semantics are invalid."
    );
  }
  if (
    !Array.isArray(
      record.samples
    ) ||
    record.samples.length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "lensMtfProfile.samples must be a non-empty array."
    );
  }
  let priorFrequency =
    -1;
  const samples =
    record.samples.map(
      (entry, index) => {
        const path =
          "lensMtfProfile.samples[" +
          index +
          "]";
        const sample =
          requireRecord(
            entry,
            path, ["spatialFrequencyCyclesPerMm", "sagittalMagnitude", "tangentialMagnitude"]
          );
        const frequency =
          requireNonNegativeFinite(
            sample
              .spatialFrequencyCyclesPerMm,
            path +
              ".spatialFrequencyCyclesPerMm"
          );
        if (
          frequency <=
          priorFrequency
        ) {
          throw new InvalidConfigurationError(
            "lensMtfProfile sample frequencies must be strictly increasing."
          );
        }
        priorFrequency =
          frequency;
        return {
          spatialFrequencyCyclesPerMm:
            frequency,
          sagittalMagnitude:
            requireUnitInterval(
              sample
                .sagittalMagnitude,
              path +
                ".sagittalMagnitude"
            ),
          tangentialMagnitude:
            requireUnitInterval(
              sample
                .tangentialMagnitude,
              path +
                ".tangentialMagnitude"
            )
        };
      }
    );
  const field =
    requireRecord(
      record.fieldPointMm,
      "lensMtfProfile.fieldPointMm", ["x", "y"]
    );
  const wavelength =
    record.wavelengthNm ===
      null
      ? null
      : requirePositiveFinite(
          record.wavelengthNm,
          "lensMtfProfile.wavelengthNm"
        );

  return {
    schemaVersion:
      LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "lensMtfProfile.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "lensMtfProfile.profileVersion"
      ),
    opticalDomain:
      "lens-primary-optical-path-only",
    phaseInformationAvailable:
      false,
    magnitudeMeaning:
      "mtf-magnitude-only",
    fieldPointMm: {
      x:
        requireFinite(
          field.x,
          "lensMtfProfile.fieldPointMm.x"
        ),
      y:
        requireFinite(
          field.y,
          "lensMtfProfile.fieldPointMm.y"
        )
    },
    focalLengthMm:
      requirePositiveFinite(
        record.focalLengthMm,
        "lensMtfProfile.focalLengthMm"
      ),
    focus:
      parseFocusPlane(
        record.focus
      ),
    apertureFNumber:
      requirePositiveFinite(
        record.apertureFNumber,
        "lensMtfProfile.apertureFNumber"
      ),
    wavelengthNm:
      wavelength,
    samples,
    evidence:
      parseEvidenceList(
        record.evidence,
        "lensMtfProfile.evidence"
      ),
    limitations:
      parseLimitations(
        record.limitations,
        "lensMtfProfile.limitations"
      )
  };
}

/**
 * Explains why MTF-only evidence cannot determine one unique renderable PSF. Returns blockers instead
 * of making up phase information.
 *
 * A sampled lens PSF is tied to an exact generic optical state and to declared ranges of field
 * position, wavelength and signed defocus. Interpolation stays inside those declared ranges. It keeps
 * the normalized shape separate from the throughput. MTF (modulation transfer function) data alone
 * has no phase or spatial information, so it cannot justify rendering one unique PSF.
 * @param profile - LensMtfDiagnosticProfile. See that type for coordinates, units and profile binding.
 * @returns MtfOnlyPsfRenderabilityAssessment. Read the structured blockers before relying on any authorization.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function assessMtfOnlyPsfRenderability(
  profile:
    LensMtfDiagnosticProfile
): MtfOnlyPsfRenderabilityAssessment {
  const parsed =
    parseLensMtfDiagnosticProfile(
      profile
    );
  return {
    profileId:
      parsed.profileId,
    psfReconstructionAuthorized:
      false,
    reason:
      "mtf-magnitude-lacks-phase-and-does-not-uniquely-determine-psf",
    diagnosticUseAuthorized:
      true
  };
}
