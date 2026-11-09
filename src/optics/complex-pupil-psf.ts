// SPDX-License-Identifier: Apache-2.0

/**
 * PSF (point-spread function) from a declared complex pupil: amplitude and phase sampled on a grid.
 *
 * The profile parser validates untrusted input and returns the normalized typed contract. Unknown
 * enum values, missing required fields and incompatible scientific data are rejected.
 *
 * The complex pupil is evaluated by summing the declared amplitude and phase over a bounded, regular
 * pupil grid. The PSF shape is normalized separately from the pupil throughput. A single blur radius
 * cannot stand in for coherent phase, pupil energy, or the wavelength and field range where the
 * profile applies. Numeric profiles need provenance showing the data is owned or reusable.
 * @see docs/PSF_FOUNDATION.md for the equations, units, coordinate conventions, known blockers and
 * support limits.
 */

import {
  approximationResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseFocusPlane,
  type FocusPlane
} from "./focus-state.js";
import type {
  LensPsfKernel,
  LensPsfScientificStatus,
  LensPsfUncertainty
} from "./lens-psf-profile.js";
import { requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigFinite as requireFinite, parseConfigScientificStatus as parseStatus, requireConfigNonNegativeSafeInteger as requireNonNegativeSafeInteger, requireConfigPositiveSafeInteger as requirePositiveSafeInteger, parseConfigLimitations as parseLimitations, requireConfigFiniteAboveZero as requirePositiveFinite, requireConfigUnitInterval as requireUnitInterval } from "../core/record-validation.js";

export const LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const;

export interface LensComplexPupilGrid {
  widthSamples: number;
  heightSamples: number;
  pupilSamplePitchMmX: number;
  pupilSamplePitchMmY: number;
  centerSampleX: number;
  centerSampleY: number;
  relativeAmplitude:
    readonly number[];
  opticalPathDifferenceMicrometers:
    readonly number[];
}

export interface LensComplexPupilProfile {
  schemaVersion:
    typeof LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  opticalDomain:
    "lens-primary-optical-path-only";
  representation:
    "complex-pupil-amplitude-plus-opd";
  pupilCoordinateSystem:
    "pupil-plane-metric-aligned-to-image-plane";
  imageFieldAxes:
    "+X right, +Y up";
  amplitudeMeaning:
    "relative-complex-pupil-amplitude-shape";
  wavefrontMeaning:
    "optical-path-difference-micrometers";
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  kernelEnergyNormalization:
    "unit-energy-shape";
  propagationModel:
    "scalar-fraunhofer-discrete-reference";
  context: {
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
  };
  responseIncludes: {
    diffraction: true;
    aberration: boolean;
    defocus: boolean;
    pupilClippingShape:
      boolean;
  };
  relativePupilThroughputFactor:
    number;
  grid: LensComplexPupilGrid;
  sensorOpticalStackIncluded:
    false;
  sensorSamplingIncluded:
    false;
  reconstructionIncluded:
    false;
  strayLightIncluded: false;
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    LensPsfUncertainty;
  limitations: readonly string[];
}

export interface CalculateLensComplexPupilPsfInput {
  profile:
    LensComplexPupilProfile;
  /** Physical propagation distance from pupil to image, in mm. If omitted, the
   * nominal focal-plane reference is used. At finite focus the caller must
   * resolve the supported principal-plane geometry; profile metadata does not. */
  propagationDistanceMm?: number;
}

export interface LensComplexPupilPsf {
  propagationDistanceMm: number;
  propagationDistanceSource: "explicit" | "nominal-focal-plane-reference";
  profileId: string;
  profileVersion: string;
  scientificStatus:
    LensPsfScientificStatus;
  context:
    LensComplexPupilProfile["context"];
  kernel: LensPsfKernel;
  /** Nyquist sampling diagnostics and the applied zero padding. */
  sampling: LensComplexPupilPsfSampling;
  relativePupilThroughputFactor:
    number;
  throughputOwnership:
    "separate-relative-pupil-throughput-factor";
  diffractionAndAberrationJointlyEvaluated:
    true;
  pupilClippingShapeIncluded:
    boolean;
  pupilClippingThroughputAppliedToKernel:
    false;
  scalarFraunhoferReference:
    true;
  full2dOrientationPreserved:
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
  componentEvidence: {
    pupilProfile:
      readonly EvidenceProvenance[];
  };
  uncertainty:
    LensPsfUncertainty;
}

function parseUncertainty(
  value: unknown,
  path: string
): LensPsfUncertainty {
  const record =
    requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);
  if (record.kind === "relative") {
    const fraction =
      requireFinite(
        record.fraction,
        path + ".fraction"
      );
    if (fraction < 0) {
      throw new InvalidConfigurationError(
        path +
          ".fraction must be nonnegative."
      );
    }
    return {
      kind: "relative",
      fraction,
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

function parseGrid(
  value: unknown
): LensComplexPupilGrid {
  const record =
    requireRecord(
      value,
      "lensComplexPupil.grid", ["widthSamples", "heightSamples", "centerSampleX", "centerSampleY", "relativeAmplitude", "opticalPathDifferenceMicrometers", "pupilSamplePitchMmX", "pupilSamplePitchMmY"]
    );
  const widthSamples =
    requirePositiveSafeInteger(
      record.widthSamples,
      "lensComplexPupil.grid.widthSamples"
    );
  const heightSamples =
    requirePositiveSafeInteger(
      record.heightSamples,
      "lensComplexPupil.grid.heightSamples"
    );
  const total =
    widthSamples *
    heightSamples;
  if (
    !Number.isSafeInteger(total) ||
    total > 4096
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil grid must contain at most 4096 samples."
    );
  }
  const centerSampleX =
    requireNonNegativeSafeInteger(
      record.centerSampleX,
      "lensComplexPupil.grid.centerSampleX"
    );
  const centerSampleY =
    requireNonNegativeSafeInteger(
      record.centerSampleY,
      "lensComplexPupil.grid.centerSampleY"
    );
  if (
    centerSampleX >=
      widthSamples ||
    centerSampleY >=
      heightSamples
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil grid center must lie within the pupil array."
    );
  }
  if (
    !Array.isArray(
      record.relativeAmplitude
    ) ||
    record.relativeAmplitude
      .length !== total
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil.grid.relativeAmplitude length must equal widthSamples × heightSamples."
    );
  }
  if (
    !Array.isArray(
      record
        .opticalPathDifferenceMicrometers
    ) ||
    record
      .opticalPathDifferenceMicrometers
      .length !== total
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil.grid.opticalPathDifferenceMicrometers length must equal widthSamples × heightSamples."
    );
  }

  const relativeAmplitude =
    record.relativeAmplitude.map(
      (entry, index) =>
        requireUnitInterval(
          entry,
          "lensComplexPupil.grid.relativeAmplitude[" +
            index +
            "]"
        )
    );
  if (
    !relativeAmplitude.some(
      (value) =>
        value > 0
    )
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil must contain at least one non-zero pupil-amplitude sample."
    );
  }
  const opd =
    record
      .opticalPathDifferenceMicrometers
      .map(
        (entry, index) =>
          requireFinite(
            entry,
            "lensComplexPupil.grid.opticalPathDifferenceMicrometers[" +
              index +
              "]"
          )
      );

  return {
    widthSamples,
    heightSamples,
    pupilSamplePitchMmX:
      requirePositiveFinite(
        record
          .pupilSamplePitchMmX,
        "lensComplexPupil.grid.pupilSamplePitchMmX"
      ),
    pupilSamplePitchMmY:
      requirePositiveFinite(
        record
          .pupilSamplePitchMmY,
        "lensComplexPupil.grid.pupilSamplePitchMmY"
      ),
    centerSampleX,
    centerSampleY,
    relativeAmplitude,
    opticalPathDifferenceMicrometers:
      opd
  };
}

/**
 * Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
 * missing required fields and incompatible scientific data are rejected here.
 *
 * The complex pupil is evaluated by summing the declared amplitude and phase over a bounded, regular
 * pupil grid. The PSF shape is normalized separately from the pupil throughput. A single blur radius
 * cannot stand in for coherent phase, pupil energy, or the wavelength and field range where the
 * profile applies. Numeric profiles need provenance showing the data is owned or reusable.
 * @param value - unknown. Untrusted input; TypeScript types alone are not validation.
 * @returns LensComplexPupilProfile. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function parseLensComplexPupilProfile(
  value: unknown
): LensComplexPupilProfile {
  const record =
    requireRecord(
      value,
      "lensComplexPupil", ["schemaVersion", "opticalDomain", "representation", "pupilCoordinateSystem", "imageFieldAxes", "amplitudeMeaning", "wavefrontMeaning", "throughputOwnership", "kernelEnergyNormalization", "propagationModel", "sensorOpticalStackIncluded", "sensorSamplingIncluded", "reconstructionIncluded", "strayLightIncluded", "scientificStatus", "uncertainty", "context", "responseIncludes", "profileId", "profileVersion", "relativePupilThroughputFactor", "grid", "evidence", "limitations"]
    );
  if (
    record.schemaVersion !==
    LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      'lensComplexPupil.schemaVersion must be "' +
        LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.opticalDomain !==
      "lens-primary-optical-path-only" ||
    record.representation !==
      "complex-pupil-amplitude-plus-opd" ||
    record.pupilCoordinateSystem !==
      "pupil-plane-metric-aligned-to-image-plane" ||
    record.imageFieldAxes !==
      "+X right, +Y up" ||
    record.amplitudeMeaning !==
      "relative-complex-pupil-amplitude-shape" ||
    record.wavefrontMeaning !==
      "optical-path-difference-micrometers" ||
    record.throughputOwnership !==
      "separate-relative-pupil-throughput-factor" ||
    record.kernelEnergyNormalization !==
      "unit-energy-shape" ||
    record.propagationModel !==
      "scalar-fraunhofer-discrete-reference"
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil representation/coordinate/energy semantics are invalid."
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
      "V1 complex pupil profiles must exclude sensor/reconstruction/stray-light effects."
    );
  }
  const status =
    parseStatus(
      record.scientificStatus,
      "lensComplexPupil.scientificStatus"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      "lensComplexPupil.uncertainty"
    );
  if (
    status === "calibrated" &&
    uncertainty.kind ===
      "not-quantified"
  ) {
    throw new InvalidConfigurationError(
      "Calibrated complex-pupil profiles must declare quantified relative uncertainty."
    );
  }
  const context =
    requireRecord(
      record.context,
      "lensComplexPupil.context", ["fieldPointMm", "focalLengthMm", "focus", "apertureFNumber", "wavelengthNm", "signedDefocusImagePlaneMicrometers"]
    );
  const field =
    requireRecord(
      context.fieldPointMm,
      "lensComplexPupil.context.fieldPointMm", ["x", "y"]
    );
  const response =
    requireRecord(
      record.responseIncludes,
      "lensComplexPupil.responseIncludes", ["diffraction", "aberration", "defocus", "pupilClippingShape"]
    );
  if (
    response.diffraction !==
    true ||
    typeof response.aberration !==
      "boolean" ||
    typeof response.defocus !==
      "boolean" ||
    typeof response.pupilClippingShape !==
      "boolean"
  ) {
    throw new InvalidConfigurationError(
      "lensComplexPupil.responseIncludes is invalid; diffraction must be included in this pupil propagation path."
    );
  }

  return {
    schemaVersion:
      LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION,
    profileId:
      requireNonEmptyString(
        record.profileId,
        "lensComplexPupil.profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        "lensComplexPupil.profileVersion"
      ),
    scientificStatus:
      status,
    opticalDomain:
      "lens-primary-optical-path-only",
    representation:
      "complex-pupil-amplitude-plus-opd",
    pupilCoordinateSystem:
      "pupil-plane-metric-aligned-to-image-plane",
    imageFieldAxes:
      "+X right, +Y up",
    amplitudeMeaning:
      "relative-complex-pupil-amplitude-shape",
    wavefrontMeaning:
      "optical-path-difference-micrometers",
    throughputOwnership:
      "separate-relative-pupil-throughput-factor",
    kernelEnergyNormalization:
      "unit-energy-shape",
    propagationModel:
      "scalar-fraunhofer-discrete-reference",
    context: {
      focalLengthMm:
        requirePositiveFinite(
          context.focalLengthMm,
          "lensComplexPupil.context.focalLengthMm"
        ),
      focus:
        parseFocusPlane(
          context.focus
        ),
      apertureFNumber:
        requirePositiveFinite(
          context.apertureFNumber,
          "lensComplexPupil.context.apertureFNumber"
        ),
      fieldPointMm: {
        x:
          requireFinite(
            field.x,
            "lensComplexPupil.context.fieldPointMm.x"
          ),
        y:
          requireFinite(
            field.y,
            "lensComplexPupil.context.fieldPointMm.y"
          )
      },
      wavelengthNm:
        requirePositiveFinite(
          context.wavelengthNm,
          "lensComplexPupil.context.wavelengthNm"
        ),
      signedDefocusImagePlaneMicrometers:
        requireFinite(
          context
            .signedDefocusImagePlaneMicrometers,
          "lensComplexPupil.context.signedDefocusImagePlaneMicrometers"
        )
    },
    responseIncludes: {
      diffraction: true,
      aberration:
        response.aberration as boolean,
      defocus:
        response.defocus as boolean,
      pupilClippingShape:
        response
          .pupilClippingShape as boolean
    },
    relativePupilThroughputFactor:
      requireUnitInterval(
        record
          .relativePupilThroughputFactor,
        "lensComplexPupil.relativePupilThroughputFactor"
      ),
    grid:
      parseGrid(record.grid),
    sensorOpticalStackIncluded:
      false,
    sensorSamplingIncluded:
      false,
    reconstructionIncluded:
      false,
    strayLightIncluded:
      false,
    evidence:
      parseEvidenceList(
        record.evidence,
        "lensComplexPupil.evidence"
      ),
    uncertainty,
    limitations:
      parseLimitations(
        record.limitations,
        "lensComplexPupil.limitations"
      )
  };
}

interface ComplexValue {
  re: number;
  im: number;
}

function pupilComplexValue(
  amplitude: number,
  opdMicrometers: number,
  wavelengthMicrometers:
    number
): ComplexValue {
  const phase =
    2 *
    Math.PI *
    opdMicrometers /
    wavelengthMicrometers;
  return {
    re:
      amplitude *
      Math.cos(phase),
    im:
      amplitude *
      Math.sin(phase)
  };
}

export interface LensComplexPupilPsfSampling {
  criterion: "discrete-intensity-alias-free-goodman-q-above-2";
  /** Number of pupil samples spanned by non-zero amplitude, per axis. */
  pupilSupportSamplesX: number;
  pupilSupportSamplesY: number;
  /**
   * Sampled pupil diameter D = (support samples - 1) x pupil pitch: the
   * centre-to-centre span of the outermost non-zero samples, in millimetres.
   */
  pupilSupportDiameterMmX: number;
  pupilSupportDiameterMmY: number;
  /**
   * Widest support allowed by the declared f-number at the resolved propagation distance:
   * propagationDistanceMm / apertureFNumber, in millimetres. For the nominal focal-plane reference
   * this is focalLengthMm / apertureFNumber.
   */
  declaredPupilDiameterMm: number;
  /** Declared pupil grid size before zero padding. */
  pupilGridWidthSamples: number;
  pupilGridHeightSamples: number;
  /** DFT size after zero padding; equals the output kernel size. */
  transformWidthSamples: number;
  transformHeightSamples: number;
  zeroPaddingApplied: boolean;
  /**
   * Achieved Goodman sampling factor Q = lambda*(z/D)/imagePitch =
   * transform samples / (support samples - 1). Always greater than 2. Null
   * when the support is a single sample on that axis (no finite diameter).
   */
  samplingFactorQX: number | null;
  samplingFactorQY: number | null;
}

interface PupilSamplingPlan {
  sampling: LensComplexPupilPsfSampling;
  outputCenterX: number;
  outputCenterY: number;
}

function supportSpan(
  grid: LensComplexPupilGrid,
  axis: "x" | "y"
): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  grid.relativeAmplitude.forEach((amplitude, index) => {
    if (amplitude > 0) {
      const coordinate =
        axis === "x"
          ? index % grid.widthSamples
          : Math.floor(index / grid.widthSamples);
      minimum = Math.min(minimum, coordinate);
      maximum = Math.max(maximum, coordinate);
    }
  });
  return maximum - minimum + 1;
}

/**
 * Sampling guard for the discrete Fraunhofer reference (Ban et al.,
 * arXiv:2511.06936, eqs. 6-9, free: N*dp = lambda*f/dc, Q = lambda*F/dc and
 * Q >= 2. Also see: Goodman, Introduction to Fourier Optics, sampling of
 * DFT/FFT Fraunhofer propagation).
 *
 * A DFT (discrete Fourier transform) of size M over pupil pitch dp gives an
 * image-plane pitch of lambda*z/(M*dp).
 *
 * The intensity PSF is the transform of the pupil autocorrelation. That
 * autocorrelation is twice as wide as the pupil. So Nyquist sampling of the
 * intensity needs Q = lambda*(z/D)/pitch = M*dp/D >= 2.
 *
 * For a pupil spanning S samples, the discrete autocorrelation has 2S-1 lags.
 * So M >= 2S-1 is the exact condition for no circular wrap-around, and it
 * implies Q = M/(S-1) > 2. The declared grid is zero padded to that size.
 *
 * The non-zero support must also fit inside the declared f/N cone. Its
 * diameter D may not exceed z/N for the resolved propagation distance z; that
 * is, the image-side cone D/z may not be wider than 1/N. With the nominal
 * focal-plane reference (z = f) this is the entrance-aperture diameter f/N. An
 * exit pupil declared at its own distance z uses that distance
 * (docs/PSF_FOUNDATION.md).
 */
function planPupilSampling(
  profile: LensComplexPupilProfile,
  propagationDistanceMm: number
): PupilSamplingPlan {
  const grid = profile.grid;
  const supportX = supportSpan(grid, "x");
  const supportY = supportSpan(grid, "y");
  const diameterX = (supportX - 1) * grid.pupilSamplePitchMmX;
  const diameterY = (supportY - 1) * grid.pupilSamplePitchMmY;
  const declaredDiameter =
    propagationDistanceMm / profile.context.apertureFNumber;
  // Relative allowance for floating-point rounding only.
  const limit = declaredDiameter * (1 + 1e-9);
  if (diameterX > limit || diameterY > limit) {
    throw new InvalidScientificInputError(
      "Complex-pupil amplitude support spans " +
        diameterX.toPrecision(6) +
        " x " +
        diameterY.toPrecision(6) +
        " mm between outermost non-zero samples, wider than the declared f/N cone diameter " +
        declaredDiameter.toPrecision(6) +
        " mm (propagationDistanceMm / apertureFNumber)."
    );
  }
  const transformWidth = Math.max(grid.widthSamples, 2 * supportX - 1);
  const transformHeight = Math.max(grid.heightSamples, 2 * supportY - 1);
  return {
    sampling: {
      criterion: "discrete-intensity-alias-free-goodman-q-above-2",
      pupilSupportSamplesX: supportX,
      pupilSupportSamplesY: supportY,
      pupilSupportDiameterMmX: diameterX,
      pupilSupportDiameterMmY: diameterY,
      declaredPupilDiameterMm: declaredDiameter,
      pupilGridWidthSamples: grid.widthSamples,
      pupilGridHeightSamples: grid.heightSamples,
      transformWidthSamples: transformWidth,
      transformHeightSamples: transformHeight,
      zeroPaddingApplied:
        transformWidth !== grid.widthSamples ||
        transformHeight !== grid.heightSamples,
      samplingFactorQX:
        supportX > 1 ? transformWidth / (supportX - 1) : null,
      samplingFactorQY:
        supportY > 1 ? transformHeight / (supportY - 1) : null
    },
    // Symmetric padding keeps zero frequency at the declared centre, shifted
    // by the leading padding.
    outputCenterX:
      grid.centerSampleX +
      Math.floor((transformWidth - grid.widthSamples) / 2),
    outputCenterY:
      grid.centerSampleY +
      Math.floor((transformHeight - grid.heightSamples) / 2)
  };
}

function twiddleTable(size: number): { cos: number[]; sin: number[] } {
  const cos: number[] = [];
  const sin: number[] = [];
  for (let index = 0; index < size; index += 1) {
    const angle = (-2 * Math.PI * index) / size;
    cos.push(Math.cos(angle));
    sin.push(Math.sin(angle));
  }
  return { cos, sin };
}

export function positiveModulo(value: number, size: number): number {
  const remainder = value % size;
  return remainder < 0 ? remainder + size : remainder;
}

function calculateDiscreteFraunhoferKernel(
  profile:
    LensComplexPupilProfile,
  propagationDistanceMm: number,
  plan: PupilSamplingPlan
): LensPsfKernel {
  const grid = profile.grid;
  const width = grid.widthSamples;
  const height = grid.heightSamples;
  const outWidth = plan.sampling.transformWidthSamples;
  const outHeight = plan.sampling.transformHeightSamples;
  const wavelengthMicrometers = profile.context.wavelengthNm / 1000;
  const wavelengthMm = profile.context.wavelengthNm / 1_000_000;
  const pupil: ComplexValue[] =
    grid.relativeAmplitude.map(
      (amplitude, index) =>
        pupilComplexValue(
          amplitude,
          grid.opticalPathDifferenceMicrometers[index]!,
          wavelengthMicrometers
        )
    );

  // Separable zero-padded DFT: pupil rows to image kx first, then columns.
  // Padding samples are zero, so only declared pupil samples are summed.
  const twiddleX = twiddleTable(outWidth);
  const twiddleY = twiddleTable(outHeight);
  const rowRe = new Float64Array(height * outWidth);
  const rowIm = new Float64Array(height * outWidth);
  for (let y = 0; y < height; y += 1) {
    for (let outX = 0; outX < outWidth; outX += 1) {
      const kx = outX - plan.outputCenterX;
      let re = 0;
      let im = 0;
      for (let x = 0; x < width; x += 1) {
        const source = pupil[y * width + x]!;
        const t = positiveModulo(kx * (x - grid.centerSampleX), outWidth);
        const cos = twiddleX.cos[t]!;
        const sin = twiddleX.sin[t]!;
        re += source.re * cos - source.im * sin;
        im += source.re * sin + source.im * cos;
      }
      rowRe[y * outWidth + outX] = re;
      rowIm[y * outWidth + outX] = im;
    }
  }

  const intensity = new Array<number>(outWidth * outHeight).fill(0);
  for (let outY = 0; outY < outHeight; outY += 1) {
    const ky = outY - plan.outputCenterY;
    for (let outX = 0; outX < outWidth; outX += 1) {
      let re = 0;
      let im = 0;
      for (let y = 0; y < height; y += 1) {
        const sourceRe = rowRe[y * outWidth + outX]!;
        const sourceIm = rowIm[y * outWidth + outX]!;
        const t = positiveModulo(ky * (y - grid.centerSampleY), outHeight);
        const cos = twiddleY.cos[t]!;
        const sin = twiddleY.sin[t]!;
        re += sourceRe * cos - sourceIm * sin;
        im += sourceRe * sin + sourceIm * cos;
      }
      intensity[outY * outWidth + outX] = re * re + im * im;
    }
  }

  const sum =
    intensity.reduce(
      (acc, value) =>
        acc + value,
      0
    );
  if (
    !Number.isFinite(sum) ||
    sum <= 0
  ) {
    throw new InvalidScientificInputError(
      "Complex-pupil propagation must produce finite positive PSF energy."
    );
  }
  const normalized =
    intensity.map(
      (value) =>
        value / sum
    );

  const samplePitchMmX =
    wavelengthMm * propagationDistanceMm /
    (outWidth * grid.pupilSamplePitchMmX);
  const samplePitchMmY =
    wavelengthMm * propagationDistanceMm /
    (outHeight * grid.pupilSamplePitchMmY);

  if (
    !Number.isFinite(
      samplePitchMmX
    ) ||
    !Number.isFinite(
      samplePitchMmY
    ) ||
    samplePitchMmX <= 0 ||
    samplePitchMmY <= 0
  ) {
    throw new InvalidScientificInputError(
      "Complex-pupil PSF sample pitch must remain finite and positive."
    );
  }

  return {
    widthSamples: outWidth,
    heightSamples: outHeight,
    samplePitchMicrometersX:
      samplePitchMmX *
      1000,
    samplePitchMicrometersY:
      samplePitchMmY *
      1000,
    centerSampleX: plan.outputCenterX,
    centerSampleY: plan.outputCenterY,
    normalizedIntensity:
      normalized
  };
}

/**
 * Evaluates a declared complex pupil with explicit amplitude, phase and sampling support. Returns the
 * normalized PSF shape, and the pupil throughput as a separate quantity.
 *
 * The complex pupil is evaluated by summing the declared amplitude and phase over a bounded, regular
 * pupil grid. The PSF shape is normalized separately from the pupil throughput. A single blur radius
 * cannot stand in for coherent phase, pupil energy, or the wavelength and field range where the
 * profile applies. Numeric profiles need provenance showing the data is owned or reusable.
 * @param input - CalculateLensComplexPupilPsfInput. See that type for coordinates, units and profile binding.
 * @returns CalculationResult<LensComplexPupilPsf>. The result states its shape and scientific status; a successful call does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the root export and exact type graph.
 */
export function calculateLensComplexPupilPsf(
  input:
    CalculateLensComplexPupilPsfInput
): CalculationResult<LensComplexPupilPsf> {
  requireInputKeys(input, "calculateLensComplexPupilPsf", ["profile", "propagationDistanceMm"]);
  const profile =
    parseLensComplexPupilProfile(
      input.profile
    );
  const propagationDistanceMm = input.propagationDistanceMm === undefined ? profile.context.focalLengthMm : input.propagationDistanceMm;
  requirePositiveFinite(propagationDistanceMm, "propagationDistanceMm");
  const plan = planPupilSampling(profile, propagationDistanceMm);
  const kernel =
    calculateDiscreteFraunhoferKernel(
      profile,
      propagationDistanceMm,
      plan
    );

  return approximationResult(
    {
      propagationDistanceMm,
      propagationDistanceSource: input.propagationDistanceMm === undefined ? "nominal-focal-plane-reference" : "explicit",
      profileId:
        profile.profileId,
      profileVersion:
        profile.profileVersion,
      scientificStatus:
        profile.scientificStatus,
      context: {
        ...profile.context,
        focus: {
          ...profile.context.focus
        },
        fieldPointMm: {
          ...profile.context
            .fieldPointMm
        }
      },
      kernel,
      sampling: plan.sampling,
      relativePupilThroughputFactor:
        profile
          .relativePupilThroughputFactor,
      throughputOwnership:
        "separate-relative-pupil-throughput-factor",
      diffractionAndAberrationJointlyEvaluated:
        true,
      pupilClippingShapeIncluded:
        profile
          .responseIncludes
          .pupilClippingShape,
      pupilClippingThroughputAppliedToKernel:
        false,
      scalarFraunhoferReference:
        true,
      full2dOrientationPreserved:
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
        false,
      componentEvidence: {
        pupilProfile:
          profile.evidence
      },
      uncertainty:
        profile.uncertainty
    },
    "lens-complex-pupil-fraunhofer-psf",
    "2.0.0",
    [
      "The reference evaluator performs deterministic scalar Fraunhofer propagation of one explicit complex pupil amplitude plus optical-path-difference grid.",
      "The pupil is zero padded so the DFT spans at least 2S-1 samples for a non-zero support of S samples per axis: the discrete intensity PSF then has no wrap-around aliasing and Goodman's sampling factor Q = lambda*N/pitch exceeds 2. Pupil support wider than the declared f/N aperture is rejected.",
      "Physical sample pitch uses the explicit propagation distance when supplied; omission preserves the nominal focal-plane reference. Finite focus metadata does not resolve the pupil-to-image geometry automatically.",
      "Diffraction and aberration phase are evaluated together in the same pupil propagation; callers must not stack an independent diffraction blur over this result.",
      "The output PSF is unit-energy normalized. The explicit relativePupilThroughputFactor is not multiplied into the kernel and remains owned by the separate optical-throughput path.",
      "Pupil amplitude shape can represent mechanical clipping/cat-eye geometry without silently encoding unknown transmission loss.",
      "The pupil and image-plane axes preserve full 2D orientation; no radial or sagittal/tangential averaging is imposed.",
      "This scalar Fraunhofer grid is a bounded reference approximation, not a full vector electromagnetic, polarization, stray-light or sensor-system model.",
      "Sensor OLPF, microlens, CFA, sampling and reconstruction are downstream and excluded."
    ]
  );
}
