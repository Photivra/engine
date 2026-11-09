// SPDX-License-Identifier: Apache-2.0

/**
 * Combines the scientific status, evidence and uncertainty of several pipeline stages into one
 * record, without inventing a single numeric uncertainty.
 *
 * The combined status can be no better than the weakest required input. Each component's
 * evidence and uncertainty is kept exactly as given, after validation.
 * @see docs/API_STYLE.md for equations, coordinate/unit conventions, blockers and support limits.
 */

import {
  validateCalculationQuality,
  type CalculationQuality
} from "./calculation-result.js";
import { InvalidScientificInputError } from "./validation.js";
import {
  parseEvidenceProvenance,
  type EvidenceProvenance
} from "./evidence-provenance.js";
import { requireInputKeys, requireTrimmedConfigString as requireNonEmptyString, requireInputNonNegativeFinite as requireNonNegativeFinite } from "./record-validation.js";
import { InvalidConfigurationError } from "./configuration-error.js";

export const SCIENTIFIC_ASSURANCE_CONTRACT_VERSION =
  "0.1.0" as const;

export type ScientificAssuranceStatus =
  | "calibrated"
  | "approximation"
  | "unknown";

export type ScientificAssuranceBasisKind =
  | "evidence-backed-fact"
  | "photivra-model-assumption"
  | "not-applicable";

export type ScientificAssuranceSourceKind =
  | "profile"
  | "result"
  | "model"
  | "fixture";

export interface ScientificAssuranceSourceIdentity {
  kind: ScientificAssuranceSourceKind;
  id: string;
  version?: string;
}

export type ScientificAssuranceComponentUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "absolute";
      plusMinus: number;
      unit: string;
      basis?: string;
    }
  | {
      kind: "calculation-quality";
      quality: CalculationQuality;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    }
  | {
      kind: "unknown";
      limitation: string;
    }
  | {
      kind: "not-applicable";
      reason: string;
    };

export interface ScientificAssuranceComponent {
  componentId: string;
  role: string;
  required: boolean;
  sourceIdentity:
    ScientificAssuranceSourceIdentity;
  basisKind:
    ScientificAssuranceBasisKind;
  scientificStatus:
    ScientificAssuranceStatus;
  evidenceRequirement:
    | "required"
    | "not-required";
  evidence:
    readonly EvidenceProvenance[];
  uncertainty:
    ScientificAssuranceComponentUncertainty;
  limitations:
    readonly string[];
}

export type ComposedScientificUncertaintyStatus =
  | {
      kind: "unknown";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-quantified";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-propagated";
      componentIds:
        readonly string[];
      limitation: string;
    }
  | {
      kind: "not-applicable";
      componentIds:
        readonly string[];
      limitation: string;
    };

/**
 * Combined status and kept evidence for one declared scientific result across stages.
 *
 * - A required input that is incomplete or approximate limits the combined status.
 * - Deterministic processing cannot turn an approximation into a calibration.
 * - Uncertainty components stay separate unless an explicit mathematical propagation
 *   model justifies combining them.
 * - A count of successful stages is not an accuracy bound.
 */
export interface ComposedScientificAssurance {
  version:
    typeof SCIENTIFIC_ASSURANCE_CONTRACT_VERSION;
  scientificStatus:
    ScientificAssuranceStatus;
  weakestRequiredComponentIds:
    readonly string[];
  evidenceStatus:
    | "complete"
    | "missing-required-evidence";
  missingRequiredEvidenceComponentIds:
    readonly string[];
  uncertainty:
    ComposedScientificUncertaintyStatus;
  components:
    readonly ScientificAssuranceComponent[];
  componentEvidencePreserved: true;
  componentUncertaintyPreserved: true;
  aggregateNumericUncertaintyFabricated:
    false;
  downstreamStatusPromotedAboveInputs:
    false;
}

export interface ComposeScientificAssuranceInput {
  components:
    readonly ScientificAssuranceComponent[];
}

const SCIENTIFIC_STATUSES =
  new Set<ScientificAssuranceStatus>([
    "calibrated",
    "approximation",
    "unknown"
  ]);

const BASIS_KINDS =
  new Set<ScientificAssuranceBasisKind>([
    "evidence-backed-fact",
    "photivra-model-assumption",
    "not-applicable"
  ]);

const SOURCE_KINDS =
  new Set<ScientificAssuranceSourceKind>([
    "profile",
    "result",
    "model",
    "fixture"
  ]);

function validateSourceIdentity(
  value:
    ScientificAssuranceSourceIdentity,
  path: string
): ScientificAssuranceSourceIdentity {
  if (
    !SOURCE_KINDS.has(
      value.kind as
        ScientificAssuranceSourceKind
    )
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  return {
    kind: value.kind,
    id:
      requireNonEmptyString(
        value.id,
        path + ".id"
      ),
    ...(value.version === undefined
      ? {}
      : {
          version:
            requireNonEmptyString(
              value.version,
              path + ".version"
            )
        })
  };
}

function validateUncertainty(
  value:
    ScientificAssuranceComponentUncertainty,
  path: string
): ScientificAssuranceComponentUncertainty {
  if (value.kind === "relative") {
    const fraction =
      requireNonNegativeFinite(
        value.fraction,
        path + ".fraction"
      );
    if (fraction > 1) {
      throw new InvalidScientificInputError(
        path +
          ".fraction must be less than or equal to one."
      );
    }
    return {
      kind: "relative",
      fraction,
      basis:
        requireNonEmptyString(
          value.basis,
          path + ".basis"
        )
    };
  }

  if (value.kind === "absolute") {
    return {
      kind: "absolute",
      plusMinus:
        requireNonNegativeFinite(
          value.plusMinus,
          path + ".plusMinus"
        ),
      unit:
        requireNonEmptyString(
          value.unit,
          path + ".unit"
        ),
      ...(value.basis === undefined
        ? {}
        : {
            basis:
              requireNonEmptyString(
                value.basis,
                path + ".basis"
              )
          })
    };
  }

  if (
    value.kind ===
    "calculation-quality"
  ) {
    validateCalculationQuality(
      value.quality
    );
    if (
      value.quality
        .uncertainty ===
        undefined ||
      value.quality
        .uncertainty.length ===
        0
    ) {
      throw new InvalidScientificInputError(
        path +
          ".quality must include quantified uncertainty components; use another semantic uncertainty state otherwise."
      );
    }
    return {
      kind:
        "calculation-quality",
      quality: value.quality
    };
  }

  if (
    value.kind ===
    "not-quantified"
  ) {
    return {
      kind: "not-quantified",
      limitation:
        requireNonEmptyString(
          value.limitation,
          path + ".limitation"
        )
    };
  }

  if (value.kind === "unknown") {
    return {
      kind: "unknown",
      limitation:
        requireNonEmptyString(
          value.limitation,
          path + ".limitation"
        )
    };
  }

  if (
    value.kind ===
    "not-applicable"
  ) {
    return {
      kind: "not-applicable",
      reason:
        requireNonEmptyString(
          value.reason,
          path + ".reason"
        )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function validateLimitations(
  value: readonly string[],
  path: string
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(
      path + " must be an array."
    );
  }

  const parsed =
    value.map((entry, index) =>
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
    throw new InvalidScientificInputError(
      path +
        " must not contain duplicates."
    );
  }

  return parsed;
}

function validateComponent(
  value:
    ScientificAssuranceComponent,
  index: number
): ScientificAssuranceComponent {
  const path =
    "components[" +
    index +
    "]";

  if (
    typeof value.required !==
    "boolean"
  ) {
    throw new InvalidConfigurationError(
      path +
        ".required must be boolean."
    );
  }

  if (
    !BASIS_KINDS.has(
      value.basisKind as
        ScientificAssuranceBasisKind
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".basisKind is invalid."
    );
  }

  if (
    !SCIENTIFIC_STATUSES.has(
      value.scientificStatus as
        ScientificAssuranceStatus
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ".scientificStatus is invalid."
    );
  }

  if (
    value.basisKind ===
      "evidence-backed-fact" &&
    value.evidenceRequirement !==
      "required"
  ) {
    throw new InvalidScientificInputError(
      path +
        '.basisKind "evidence-backed-fact" requires evidenceRequirement "required".'
    );
  }

  if (
    value.evidenceRequirement !==
      "required" &&
    value.evidenceRequirement !==
      "not-required"
  ) {
    throw new InvalidConfigurationError(
      path +
        ".evidenceRequirement is invalid."
    );
  }

  if (!Array.isArray(value.evidence)) {
    throw new InvalidConfigurationError(
      path +
        ".evidence must be an array."
    );
  }

  const evidence =
    value.evidence.map(
      (entry, evidenceIndex) =>
        parseEvidenceProvenance(
          entry,
          path +
            ".evidence[" +
            evidenceIndex +
            "]"
        )
    );

  return {
    componentId:
      requireNonEmptyString(
        value.componentId,
        path + ".componentId"
      ),
    role:
      requireNonEmptyString(
        value.role,
        path + ".role"
      ),
    required: value.required,
    sourceIdentity:
      validateSourceIdentity(
        value.sourceIdentity,
        path +
          ".sourceIdentity"
      ),
    basisKind:
      value.basisKind,
    scientificStatus:
      value.scientificStatus,
    evidenceRequirement:
      value.evidenceRequirement,
    evidence,
    uncertainty:
      validateUncertainty(
        value.uncertainty,
        path + ".uncertainty"
      ),
    limitations:
      validateLimitations(
        value.limitations,
        path + ".limitations"
      )
  };
}

function statusRank(
  value:
    ScientificAssuranceStatus
): number {
  if (value === "unknown") {
    return 0;
  }
  if (
    value === "approximation"
  ) {
    return 1;
  }
  return 2;
}

function composedUncertainty(
  required:
    readonly ScientificAssuranceComponent[]
): ComposedScientificUncertaintyStatus {
  const unknown =
    required.filter(
      (component) =>
        component.uncertainty.kind ===
        "unknown"
    );

  if (unknown.length > 0) {
    return {
      kind: "unknown",
      componentIds:
        unknown.map(
          (component) =>
            component.componentId
        ),
      limitation:
        "At least one required component has unknown uncertainty; no aggregate numeric uncertainty is claimed."
    };
  }

  const unquantified =
    required.filter(
      (component) =>
        component.uncertainty.kind ===
        "not-quantified"
    );

  if (
    unquantified.length > 0
  ) {
    return {
      kind: "not-quantified",
      componentIds:
        unquantified.map(
          (component) =>
            component.componentId
        ),
      limitation:
        "At least one required component has unquantified uncertainty; absence of a numeric bound is not zero uncertainty."
    };
  }

  const quantified =
    required.filter(
      (component) =>
        component.uncertainty.kind ===
          "relative" ||
        component.uncertainty.kind ===
          "absolute" ||
        component.uncertainty.kind ===
          "calculation-quality"
    );

  if (quantified.length > 0) {
    return {
      kind: "not-propagated",
      componentIds:
        quantified.map(
          (component) =>
            component.componentId
        ),
      limitation:
        "Quantified component uncertainties are preserved but are not numerically combined without an explicit propagation model and correlation assumptions."
    };
  }

  return {
    kind: "not-applicable",
    componentIds:
      required.map(
        (component) =>
          component.componentId
      ),
    limitation:
      "No required component declares a quantitative uncertainty applicable to this composition."
  };
}

/**
 * Combines the scientific status, evidence and uncertainty of several inputs into one
 * record, without inventing a single numeric uncertainty.
 *
 * The combined status can be no better than the weakest required input. Each component's
 * evidence and uncertainty is kept exactly as given, after validation.
 */
export function composeScientificAssurance(
  input:
    ComposeScientificAssuranceInput
): ComposedScientificAssurance {
  requireInputKeys(input, "composeScientificAssurance", ["components"]);
  if (
    !Array.isArray(
      input.components
    ) ||
    input.components.length === 0
  ) {
    throw new InvalidConfigurationError(
      "components must be a non-empty array."
    );
  }

  const components =
    input.components.map(
      validateComponent
    );

  const ids =
    components.map(
      (component) =>
        component.componentId
    );

  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new InvalidScientificInputError(
      "components must not contain duplicate componentId values."
    );
  }

  const required =
    components.filter(
      (component) =>
        component.required
    );

  if (required.length === 0) {
    throw new InvalidScientificInputError(
      "At least one scientific-assurance component must be required."
    );
  }

  let weakestRank =
    Number.POSITIVE_INFINITY;

  for (const component of required) {
    weakestRank =
      Math.min(
        weakestRank,
        statusRank(
          component.scientificStatus
        )
      );
  }

  const weakest =
    required.filter(
      (component) =>
        statusRank(
          component.scientificStatus
        ) === weakestRank
    );

  const statusFromInputs =
    weakestRank === 0
      ? "unknown"
      : weakestRank === 1
        ? "approximation"
        : "calibrated";

  const missingRequiredEvidence =
    required.filter(
      (component) =>
        component
          .evidenceRequirement ===
          "required" &&
        component.evidence.length === 0
    );

  const scientificStatus:
    ScientificAssuranceStatus =
      missingRequiredEvidence.length >
      0
        ? "unknown"
        : statusFromInputs;

  const weakestRequiredComponentIds =
    missingRequiredEvidence.length >
    0
      ? missingRequiredEvidence.map(
          (component) =>
            component.componentId
        )
      : weakest.map(
          (component) =>
            component.componentId
        );

  return {
    version:
      SCIENTIFIC_ASSURANCE_CONTRACT_VERSION,
    scientificStatus,
    weakestRequiredComponentIds,
    evidenceStatus:
      missingRequiredEvidence
        .length === 0
        ? "complete"
        : "missing-required-evidence",
    missingRequiredEvidenceComponentIds:
      missingRequiredEvidence.map(
        (component) =>
          component.componentId
      ),
    uncertainty:
      composedUncertainty(
        required
      ),
    components,
    componentEvidencePreserved:
      true,
    componentUncertaintyPreserved:
      true,
    aggregateNumericUncertaintyFabricated:
      false,
    downstreamStatusPromotedAboveInputs:
      false
  };
}
