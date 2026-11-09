// SPDX-License-Identifier: Apache-2.0

/**
 * Provenance records: where a scientific fact or data set came from, and whether Photivra
 * may reuse it. Parsers for one record and for a non-empty list of records.
 * @see docs/API_STYLE.md for equations, coordinate/unit conventions, blockers and support limits.
 */

import { InvalidConfigurationError } from "./configuration-error.js";
import { requireConfigRecord as requireRecord, requireConfigRecordString as requireNonEmptyString } from "./record-validation.js";


export type EvidenceSourceOrigin =
  | "manufacturer"
  | "third-party"
  | "photivra";

export type EvidenceReuseStatus =
  | "factual-reference-only"
  | "reusable-data"
  | "photivra-owned";

/**
 * Where one scientific fact or numeric data set came from, and what reuse rights apply.
 *
 * Being publicly available does not grant permission to copy. The engine stores the
 * source reference as metadata and never fetches it. A record is a declaration for a
 * human to review. It does not verify a calibration or a licence.
 */
export interface EvidenceProvenance {
  /** Who originated the underlying fact/data. */
  sourceOrigin: EvidenceSourceOrigin;
  /**
   * Public/stable source reference or Photivra evidence identifier.
   *
   * The engine does not fetch this reference at runtime.
   */
  sourceReference: string;
  /**
   * How Photivra may use the referenced material.
   *
   * This is independent of who the source is. A manufacturer or third party can
   * publish material that is only a factual reference, or data explicitly licensed
   * for reuse.
   */
  reuseStatus: EvidenceReuseStatus;
  /** Required when reuseStatus is reusable-data. */
  license?: string;
  note?: string;
}

export interface EvidenceBackedFact<T> {
  value: T;
  /** One or more independent evidence records supporting this fact. */
  evidence: readonly EvidenceProvenance[];
}

const SOURCE_ORIGINS = new Set<EvidenceSourceOrigin>([
  "manufacturer",
  "third-party",
  "photivra"
]);

const REUSE_STATUSES = new Set<EvidenceReuseStatus>([
  "factual-reference-only",
  "reusable-data",
  "photivra-owned"
]);

/**
 * Parses one provenance (evidence) record.
 *
 * Source origin and reuse status are independent of each other. The parser rejects
 * only combinations that contradict themselves.
 */
export function parseEvidenceProvenance(
  value: unknown,
  path: string
): EvidenceProvenance {
  const record = requireRecord(value, path, ["sourceOrigin", "sourceReference", "reuseStatus", "license", "note"]);
  const sourceOrigin = requireNonEmptyString(record, "sourceOrigin", path);
  const sourceReference = requireNonEmptyString(
    record,
    "sourceReference",
    path
  );
  const reuseStatus = requireNonEmptyString(record, "reuseStatus", path);

  if (!SOURCE_ORIGINS.has(sourceOrigin as EvidenceSourceOrigin)) {
    throw new InvalidConfigurationError(`${path}.sourceOrigin is invalid.`);
  }
  if (!REUSE_STATUSES.has(reuseStatus as EvidenceReuseStatus)) {
    throw new InvalidConfigurationError(`${path}.reuseStatus is invalid.`);
  }

  const typedOrigin = sourceOrigin as EvidenceSourceOrigin;
  const typedReuseStatus = reuseStatus as EvidenceReuseStatus;

  if (
    typedReuseStatus === "photivra-owned" &&
    typedOrigin !== "photivra"
  ) {
    throw new InvalidConfigurationError(
      `${path}.photivra-owned evidence must have sourceOrigin "photivra".`
    );
  }

  const license = record.license;
  if (
    license !== undefined &&
    (typeof license !== "string" || license.trim().length === 0)
  ) {
    throw new InvalidConfigurationError(
      `${path}.license must be a non-empty string when supplied.`
    );
  }
  if (typedReuseStatus === "reusable-data" && license === undefined) {
    throw new InvalidConfigurationError(
      `${path}.license is required for reusable-data provenance.`
    );
  }

  const note = record.note;
  if (
    note !== undefined &&
    (typeof note !== "string" || note.trim().length === 0)
  ) {
    throw new InvalidConfigurationError(
      `${path}.note must be a non-empty string when supplied.`
    );
  }

  return {
    sourceOrigin: typedOrigin,
    sourceReference,
    reuseStatus: typedReuseStatus,
    ...(license === undefined ? {} : { license }),
    ...(note === undefined ? {} : { note })
  };
}

/**
 * Parses a non-empty evidence array.
 */
export function parseEvidenceList(
  value: unknown,
  path: string
): readonly EvidenceProvenance[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      `${path} must be a non-empty array.`
    );
  }

  return value.map((entry, index) =>
    parseEvidenceProvenance(entry, `${path}[${index}]`)
  );
}
