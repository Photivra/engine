// SPDX-License-Identifier: Apache-2.0

/**
 * Foundation contract for the PSF (point-spread function) and pupil.
 *
 * The contract lists the diagnostics that exist today. It also reserves names for future
 * contributions. A reserved contribution is not implemented.
 *
 * The evaluator runs today's PSF-related diagnostics in one explicit context: field position,
 * depth, wavelength and pupil. It does not combine them into a synthetic PSF or blur radius. The
 * field position is recorded even though the current defocus-circle and circular-Airy diagnostics
 * do not depend on it. Future field-dependent contributions can use the same context without
 * changing these primitives.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import {
  calculatedResult,
  type CalculationProvenance,
  type CalculationResult
} from "../core/calculation-result.js";
import {
  InvalidScientificInputError,
  requirePositiveFinite
} from "../core/validation.js";
import type { LensFieldPointMm } from "./radial-distortion.js";
import { calculateDefocusCircle } from "./depth-of-field.js";
import { calculateAiryDisk } from "./diffraction.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";

export const PSF_FOUNDATION_VERSION = "0.3.0" as const;

export type PsfContributionId =
  | "geometric-defocus-circle"
  | "circular-diffraction-first-zero"
  | "non-circular-diffraction"
  | "mechanical-pupil-clipping"
  | "field-curvature"
  | "field-dependent-aberration"
  | "field-dependent-bokeh";

export type PsfContributionStatus =
  | "implemented-diagnostic"
  | "implemented-framework"
  | "reserved-contract";

export interface PsfContributionContract {
  id: PsfContributionId;
  status: PsfContributionStatus;
  dependsOn: readonly (
    | "field-position"
    | "focus-depth"
    | "pupil"
    | "wavelength"
  )[];
  note: string;
}

export interface PsfFoundationContract {
  version: typeof PSF_FOUNDATION_VERSION;
  coordinateSpace: "image-plane-metric";
  fieldAxes: "+X right, +Y up";
  compositionPolicy:
    "separate-diagnostics-plus-explicit-profiled-combined-psf";
  contributions: readonly PsfContributionContract[];
  previewReferencePolicy: {
    previewMayApproximate: true;
    referenceMayUseHigherFidelity: true;
    mustPreserveContributionSemantics: true;
  };
  notes: readonly string[];
}

export interface CalculatePsfFoundationComponentsInput {
  focalLengthMm: number;
  aperture: number;
  focusDistanceM: number;
  subjectDistanceM: number;
  /**
   * Image-plane field position relative to the optical axis, in millimetres.
   * +X is right and +Y is up.
   */
  fieldPointMm: LensFieldPointMm;
  /**
   * Physical image-plane radius. It is used only to normalize the field
   * position so diagnostics can be compared across cases. It is not a lens
   * calibration or a validity limit.
   */
  fieldNormalizationRadiusMm: number;
  spectralBasis: {
    kind: "monochromatic";
    wavelengthNm: number;
  };
}

export interface PsfFoundationComponents {
  context: {
    field: {
      imagePointMm: LensFieldPointMm;
      radiusMm: number;
      normalizationRadiusMm: number;
      normalizedRadius: number;
    };
    depth: {
      focusDistanceM: number;
      subjectDistanceM: number;
    };
    spectralBasis: {
      kind: "monochromatic";
      wavelengthNm: number;
    };
    pupil: {
      kind: "ideal-circular-f-number-derived";
      apertureFNumber: number;
      diameterMm: number;
    };
  };
  contributions: {
    geometricDefocus: {
      id: "geometric-defocus-circle";
      diameterMm: number;
      provenance: CalculationProvenance;
    };
    circularDiffraction: {
      id: "circular-diffraction-first-zero";
      firstZeroDiameterMicrometers: number;
      provenance: CalculationProvenance;
    };
  };
  composition: {
    status: "not-composed";
    note: string;
  };
}

const CONTRIBUTIONS = [
  {
    id: "geometric-defocus-circle",
    status: "implemented-diagnostic",
    dependsOn: ["focus-depth", "pupil"],
    note:
      "Existing thin-lens geometric defocus diameter. This is a blur-circle diagnostic, not a complete intensity PSF."
  },
  {
    id: "circular-diffraction-first-zero",
    status: "implemented-diagnostic",
    dependsOn: ["pupil", "wavelength"],
    note:
      "Existing ideal circular-pupil first-zero Airy diameter. This is a diffraction-size diagnostic, not a sampled intensity PSF."
  },
  {
    id: "non-circular-diffraction",
    status: "implemented-framework",
    dependsOn: ["pupil", "wavelength"],
    note:
      "Implemented ideal on-axis regular-polygon Fraunhofer PSF density with explicit equal-area physical pupil scaling. Curved blades, aberration and off-axis/clipped real pupils are not inferred."
  },
  {
    id: "mechanical-pupil-clipping",
    status: "implemented-framework",
    dependsOn: ["pupil", "field-position"],
    note:
      "Implemented through explicit sampled-PSF or complex-pupil profile semantics. PSF shape and relative pupil throughput remain separately owned to avoid double counting."
  },
  {
    id: "field-curvature",
    status: "implemented-framework",
    dependsOn: ["field-position", "focus-depth"],
    note:
      "Implemented as explicit field-dependent best-focus image-plane offset in the lens-PSF profile framework. It remains separate from geometric distortion."
  },
  {
    id: "field-dependent-aberration",
    status: "implemented-framework",
    dependsOn: ["field-position", "focus-depth", "pupil", "wavelength"],
    note:
      "Implemented through full 2D sampled PSF kernels and explicit complex-pupil amplitude/OPD propagation. No scalar lens-sharpness score is produced."
  },
  {
    id: "field-dependent-bokeh",
    status: "implemented-framework",
    dependsOn: ["field-position", "focus-depth", "pupil"],
    note:
      "Implemented through signed-defocus sampled PSF context and optional pupil-clipping shape. Visibility/depth compositing remains renderer work."
  }
] as const satisfies readonly PsfContributionContract[];

const NOTES = [
  "This foundation preserves the legacy defocus/Airy diagnostics separately while the lens-PSF framework can resolve explicitly profiled combined primary-optical PSFs. It still never emits one scalar lens-sharpness result.",
  "Existing geometric defocus and circular Airy outputs remain independently named scientific diagnostics with their own provenance.",
  "Framework contributions require explicit profile/evaluator APIs; the ideal polygon diffraction evaluator is standalone and is not silently composed into the legacy diagnostics or POC.",
  "Illumination vignetting is a separate throughput-only model and is not a PSF contribution.",
  "Real-lens PSF calibration requires defensible provenance, compatible reuse rights, and explicit limitations/uncertainty."
] as const;

/**
 * Returns the public PSF/pupil foundation contract.
 *
 * The contract lists today's diagnostics and reserves names for future
 * contributions. A reserved contribution is not implemented.
 */
export function getPsfFoundationContract(): PsfFoundationContract {
  return {
    version: PSF_FOUNDATION_VERSION,
    coordinateSpace: "image-plane-metric",
    fieldAxes: "+X right, +Y up",
    compositionPolicy:
      "separate-diagnostics-plus-explicit-profiled-combined-psf",
    contributions: CONTRIBUTIONS.map((contribution) => ({
      ...contribution,
      dependsOn: [...contribution.dependsOn]
    })),
    previewReferencePolicy: {
      previewMayApproximate: true,
      referenceMayUseHigherFidelity: true,
      mustPreserveContributionSemantics: true
    },
    notes: [...NOTES]
  };
}

/**
 * Evaluates today's PSF-related diagnostics in one explicit context (field
 * position, depth, wavelength and pupil). It does not combine them into a
 * synthetic PSF or blur radius.
 *
 * The field position is recorded even though the current defocus-circle and
 * circular-Airy diagnostics do not depend on it. Future field-dependent
 * contributions can use the same context without changing these primitives.
 */
export function calculatePsfFoundationComponents(
  input: CalculatePsfFoundationComponentsInput
): CalculationResult<PsfFoundationComponents> {
  requireInputKeys(input, "calculatePsfFoundationComponents", ["focalLengthMm", "aperture", "focusDistanceM", "subjectDistanceM", "fieldPointMm", "fieldNormalizationRadiusMm", "spectralBasis"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("aperture", input.aperture);
  requirePositiveFinite("focusDistanceM", input.focusDistanceM);
  requirePositiveFinite("subjectDistanceM", input.subjectDistanceM);
  requirePositiveFinite(
    "fieldNormalizationRadiusMm",
    input.fieldNormalizationRadiusMm
  );
  if (input.spectralBasis?.kind !== "monochromatic") {
    throw new InvalidConfigurationError(
      'spectralBasis.kind must be "monochromatic".'
    );
  }
  requirePositiveFinite(
    "spectralBasis.wavelengthNm",
    input.spectralBasis.wavelengthNm
  );

  // 2.28.0 (#726): a missing or null field point is a domain error, not a TypeError from reading its x.
  requireInputObject(input.fieldPointMm, "fieldPointMm");
  if (!Number.isFinite(input.fieldPointMm.x)) {
    throw new InvalidScientificInputError(
      "fieldPointMm.x must be finite."
    );
  }
  if (!Number.isFinite(input.fieldPointMm.y)) {
    throw new InvalidScientificInputError(
      "fieldPointMm.y must be finite."
    );
  }

  const defocus = calculateDefocusCircle({
    focalLengthMm: input.focalLengthMm,
    aperture: input.aperture,
    focusDistanceM: input.focusDistanceM,
    subjectDistanceM: input.subjectDistanceM
  });
  const diffraction = calculateAiryDisk({
    aperture: input.aperture,
    wavelengthNm: input.spectralBasis.wavelengthNm
  });

  const radiusMm = Math.hypot(
    input.fieldPointMm.x,
    input.fieldPointMm.y
  );

  return calculatedResult(
    {
      context: {
        field: {
          // The validated coordinates only (2.28.0, #726: unknown keys of the record were copied before).
          imagePointMm: { x: input.fieldPointMm.x, y: input.fieldPointMm.y },
          radiusMm,
          normalizationRadiusMm: input.fieldNormalizationRadiusMm,
          normalizedRadius: radiusMm / input.fieldNormalizationRadiusMm
        },
        depth: {
          focusDistanceM: input.focusDistanceM,
          subjectDistanceM: input.subjectDistanceM
        },
        spectralBasis: {
          kind: "monochromatic",
          wavelengthNm: input.spectralBasis.wavelengthNm
        },
        pupil: {
          kind: "ideal-circular-f-number-derived",
          apertureFNumber: input.aperture,
          diameterMm: input.focalLengthMm / input.aperture
        }
      },
      contributions: {
        geometricDefocus: {
          id: "geometric-defocus-circle",
          diameterMm: defocus.value.diameterMm,
          provenance: { ...defocus.provenance }
        },
        circularDiffraction: {
          id: "circular-diffraction-first-zero",
          firstZeroDiameterMicrometers:
            diffraction.value.firstZeroDiameterMicrometers,
          provenance: { ...diffraction.provenance }
        }
      },
      composition: {
        status: "not-composed",
        note:
          "No combined PSF, MTF, convolution kernel, or scalar sharpness value has been calculated."
      }
    },
    "psf-foundation-separated-components",
    "1.0.0",
    [
      "Current geometric defocus and ideal circular-pupil diffraction diagnostics are evaluated independently",
      "Field position is explicit context but does not alter the current field-invariant diagnostic primitives",
      "The result intentionally does not combine defocus and diffraction into one blur radius or PSF",
      "Illumination vignetting is excluded because it is a separate throughput-only stage"
    ]
  );
}
