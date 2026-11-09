// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure capabilities of generic Photivra camera bodies and lenses: which ISO, shutter and aperture
 * settings they offer.
 *
 * This is capability metadata only. ISO values say nothing about how noise or gain is implemented.
 * Shutter-duration capability does not imply a particular shutter mechanism or sensor-readout
 * schedule.
 *
 * For lenses, "widest" means the smallest available f-number. This avoids the ambiguous phrases
 * "minimum aperture" and "maximum aperture".
 * @see docs/GENERIC_TIER_PRESETS.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceBackedFact,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, rejectUnknownVariantFields, requireConfigRecord as requireRecord, requireTrimmedConfigString as requireNonEmptyString, requireConfigPositiveFinite as requirePositiveFinite, parseConfigAvailability as parseAvailability } from "../core/record-validation.js";

type UnknownRecord = Record<string, unknown>;

export const GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const;

export type GenericCapabilityAvailability =
  | "supported"
  | "unsupported"
  | "unknown";

export interface NumericCapabilityRange {
  minimum: number;
  maximum: number;
}

export type NumericSettingGrid =
  | {
      kind: "continuous-within-range";
    }
  | {
      kind: "discrete-values";
      values:
        EvidenceBackedFact<
          readonly number[]
        >;
    };

export interface GenericBodyExposureCapabilityProfile {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  shutter: {
    durationSecondsRange:
      EvidenceBackedFact<
        NumericCapabilityRange
      >;
    settingGrid: NumericSettingGrid;
  };
  iso: {
    range:
      EvidenceBackedFact<
        NumericCapabilityRange
      >;
    settingGrid: NumericSettingGrid;
    autoIso:
      EvidenceBackedFact<
        GenericCapabilityAvailability
      >;
  };
}

export interface FocalLengthFNumberSample {
  focalLengthMm: number;
  fNumber: number;
}

export type WidestAvailableFNumberCapability =
  | {
      kind: "constant";
      fNumber:
        EvidenceBackedFact<number>;
    }
  | {
      kind:
        "piecewise-linear-by-focal-length";
      samples:
        EvidenceBackedFact<
          readonly FocalLengthFNumberSample[]
        >;
    };

export interface GenericLensExposureCapabilityProfile {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  evidence: readonly EvidenceProvenance[];
  focalLengthMmRange:
    EvidenceBackedFact<
      NumericCapabilityRange
    >;
  aperture: {
    widestAvailableFNumber:
      WidestAvailableFNumberCapability;
    narrowestAvailableFNumber:
      EvidenceBackedFact<number>;
    settingGrid: NumericSettingGrid;
  };
}

export type ResolvedNumericSettingGrid =
  | {
      kind: "continuous-within-range";
    }
  | {
      kind: "discrete-values";
      values: readonly number[];
    };

export interface ResolvedGenericEquipmentExposureCapabilities {
  schemaVersion:
    typeof GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION;
  scientificStatus: "approximation";
  bodyProfile: {
    profileId: string;
    profileVersion: string;
  };
  lensProfile: {
    profileId: string;
    profileVersion: string;
  };
  selectedFocalLengthMm: number;
  aperture: {
    widestAvailableFNumber: number;
    narrowestAvailableFNumber: number;
    settingGrid:
      ResolvedNumericSettingGrid;
  };
  shutter: {
    minimumSeconds: number;
    maximumSeconds: number;
    settingGrid:
      ResolvedNumericSettingGrid;
  };
  iso: {
    minimum: number;
    maximum: number;
    settingGrid:
      ResolvedNumericSettingGrid;
    autoIsoAvailability:
      GenericCapabilityAvailability;
    /**
     * Optional bounds that apply only to Auto ISO. Manual ISO still uses the
     * minimum, the maximum and the complete standard setting grid.
     */
    autoIsoMinimum?: number;
    autoIsoMaximum?: number;
  };
  sourceProfilesMutated: false;
  exactNamedEquipmentEmulationClaimed:
    false;
}

export interface ResolveGenericEquipmentExposureCapabilitiesInput {
  bodyProfile:
    GenericBodyExposureCapabilityProfile;
  lensProfile:
    GenericLensExposureCapabilityProfile;
  selectedFocalLengthMm: number;
}

export function parseRange(
  value: unknown,
  path: string
): NumericCapabilityRange {
  const record = requireRecord(
    value,
    path, ["minimum", "maximum"]
  );
  const minimum =
    requirePositiveFinite(
      record.minimum,
      path + ".minimum"
    );
  const maximum =
    requirePositiveFinite(
      record.maximum,
      path + ".maximum"
    );
  if (minimum > maximum) {
    throw new InvalidConfigurationError(
      path +
        ".minimum must be less than or equal to maximum."
    );
  }
  return {
    minimum,
    maximum
  };
}

function parseSourcedRange(
  value: unknown,
  path: string
): EvidenceBackedFact<
  NumericCapabilityRange
> {
  const record = requireRecord(
    value,
    path, ["value", "evidence"]
  );
  return {
    value: parseRange(
      record.value,
      path + ".value"
    ),
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

function parseSourcedPositiveNumber(
  value: unknown,
  path: string
): EvidenceBackedFact<number> {
  const record = requireRecord(
    value,
    path, ["value", "evidence"]
  );
  return {
    value: requirePositiveFinite(
      record.value,
      path + ".value"
    ),
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

function parseSourcedAvailability(
  value: unknown,
  path: string
): EvidenceBackedFact<
  GenericCapabilityAvailability
> {
  const record = requireRecord(
    value,
    path, ["value", "evidence"]
  );
  return {
    value: parseAvailability(
      record.value,
      path + ".value"
    ),
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

function parseDiscreteValues(
  value: unknown,
  range: NumericCapabilityRange,
  path: string
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

  let previous =
    Number.NEGATIVE_INFINITY;
  return value.map(
    (entry, index) => {
      const parsed =
        requirePositiveFinite(
          entry,
          path +
            "[" +
            index +
            "]"
        );
      if (parsed <= previous) {
        throw new InvalidConfigurationError(
          path +
            " must be strictly increasing with no duplicates."
        );
      }
      if (
        parsed < range.minimum ||
        parsed > range.maximum
      ) {
        throw new InvalidConfigurationError(
          path +
            " values must lie inside the declared capability range."
        );
      }
      previous = parsed;
      return parsed;
    }
  );
}

function parseSettingGrid(
  value: unknown,
  range: NumericCapabilityRange,
  path: string
): NumericSettingGrid {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", { "continuous-within-range": ["kind"], "discrete-values": ["kind", "values"] }, path);

  if (
    record.kind ===
    "continuous-within-range"
  ) {
    return {
      kind:
        "continuous-within-range"
    };
  }

  if (
    record.kind ===
    "discrete-values"
  ) {
    const valuesFact =
      requireRecord(
        record.values,
        path + ".values", ["value", "evidence"]
      );
    return {
      kind: "discrete-values",
      values: {
        value: parseDiscreteValues(
          valuesFact.value,
          range,
          path +
            ".values.value"
        ),
        evidence: parseEvidenceList(
          valuesFact.evidence,
          path +
            ".values.evidence"
        )
      }
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function requireApproximationProfileHeader(
  record: UnknownRecord,
  path: string
): {
  profileId: string;
  profileVersion: string;
  evidence:
    readonly EvidenceProvenance[];
} {
  if (
    record.schemaVersion !==
    GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION
  ) {
    throw new InvalidConfigurationError(
      path +
        '.schemaVersion must be "' +
        GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION +
        '".'
    );
  }
  if (
    record.scientificStatus !==
    "approximation"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.scientificStatus must be "approximation" in schema 0.1.0.'
    );
  }

  return {
    profileId:
      requireNonEmptyString(
        record.profileId,
        path + ".profileId"
      ),
    profileVersion:
      requireNonEmptyString(
        record.profileVersion,
        path + ".profileVersion"
      ),
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

/**
 * Parses a generic Photivra body exposure-capability profile.
 *
 * This is capability metadata only. ISO values say nothing about how noise or
 * gain is implemented. Shutter-duration capability does not imply a
 * particular shutter mechanism or sensor-readout schedule.
 */
export function parseGenericBodyExposureCapabilityProfile(
  value: unknown
): GenericBodyExposureCapabilityProfile {
  const record = requireRecord(
    value,
    "genericBodyExposureCapabilityProfile", ["schemaVersion", "scientificStatus", "profileId", "profileVersion", "evidence", "shutter", "iso"]
  );
  const header =
    requireApproximationProfileHeader(
      record,
      "genericBodyExposureCapabilityProfile"
    );

  const shutter = requireRecord(
    record.shutter,
    "genericBodyExposureCapabilityProfile.shutter", ["durationSecondsRange", "settingGrid"]
  );
  const shutterRange =
    parseSourcedRange(
      shutter.durationSecondsRange,
      "genericBodyExposureCapabilityProfile.shutter.durationSecondsRange"
    );

  const iso = requireRecord(
    record.iso,
    "genericBodyExposureCapabilityProfile.iso", ["range", "settingGrid", "autoIso"]
  );
  const isoRange =
    parseSourcedRange(
      iso.range,
      "genericBodyExposureCapabilityProfile.iso.range"
    );

  return {
    schemaVersion:
      GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION,
    ...header,
    scientificStatus:
      "approximation",
    shutter: {
      durationSecondsRange:
        shutterRange,
      settingGrid:
        parseSettingGrid(
          shutter.settingGrid,
          shutterRange.value,
          "genericBodyExposureCapabilityProfile.shutter.settingGrid"
        )
    },
    iso: {
      range: isoRange,
      settingGrid:
        parseSettingGrid(
          iso.settingGrid,
          isoRange.value,
          "genericBodyExposureCapabilityProfile.iso.settingGrid"
        ),
      autoIso:
        parseSourcedAvailability(
          iso.autoIso,
          "genericBodyExposureCapabilityProfile.iso.autoIso"
        )
    }
  };
}

function parseFocalSamples(
  value: unknown,
  focalRange:
    NumericCapabilityRange,
  path: string
): readonly FocalLengthFNumberSample[] {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain at least two samples."
    );
  }

  let previousFocal =
    Number.NEGATIVE_INFINITY;
  const samples = value.map(
    (entry, index) => {
      const samplePath =
        path +
        "[" +
        index +
        "]";
      const record = requireRecord(
        entry,
        samplePath, ["focalLengthMm", "fNumber"]
      );
      const focalLengthMm =
        requirePositiveFinite(
          record.focalLengthMm,
          samplePath +
            ".focalLengthMm"
        );
      if (
        focalLengthMm <=
        previousFocal
      ) {
        throw new InvalidConfigurationError(
          path +
            " focal lengths must be strictly increasing."
        );
      }
      previousFocal =
        focalLengthMm;
      return {
        focalLengthMm,
        fNumber:
          requirePositiveFinite(
            record.fNumber,
            samplePath +
              ".fNumber"
          )
      };
    }
  );

  if (
    samples[0]!.focalLengthMm !==
      focalRange.minimum ||
    samples[
      samples.length - 1
    ]!.focalLengthMm !==
      focalRange.maximum
  ) {
    throw new InvalidConfigurationError(
      path +
        " must begin at the declared minimum focal length and end at the declared maximum focal length."
    );
  }

  return samples;
}

function parseWidestFNumberCapability(
  value: unknown,
  focalRange:
    NumericCapabilityRange,
  narrowestFNumber: number,
  path: string
): WidestAvailableFNumberCapability {
  const record = requireRecord(
    value,
    path, null
  );
  rejectUnknownVariantFields(record, "kind", { constant: ["kind", "fNumber"], "piecewise-linear-by-focal-length": ["kind", "samples"] }, path);

  if (record.kind === "constant") {
    const fNumber =
      parseSourcedPositiveNumber(
        record.fNumber,
        path + ".fNumber"
      );
    if (
      fNumber.value >
      narrowestFNumber
    ) {
      throw new InvalidConfigurationError(
        path +
          ".fNumber must not exceed narrowestAvailableFNumber."
      );
    }
    return {
      kind: "constant",
      fNumber
    };
  }

  if (
    record.kind ===
    "piecewise-linear-by-focal-length"
  ) {
    const samplesFact =
      requireRecord(
        record.samples,
        path + ".samples", ["value", "evidence"]
      );
    const samples =
      parseFocalSamples(
        samplesFact.value,
        focalRange,
        path +
          ".samples.value"
      );
    if (
      samples.some(
        (sample) =>
          sample.fNumber >
          narrowestFNumber
      )
    ) {
      throw new InvalidConfigurationError(
        path +
          " sample f-numbers must not exceed narrowestAvailableFNumber."
      );
    }
    return {
      kind:
        "piecewise-linear-by-focal-length",
      samples: {
        value: samples,
        evidence: parseEvidenceList(
          samplesFact.evidence,
          path +
            ".samples.evidence"
        )
      }
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Parses a generic Photivra lens exposure-capability profile.
 *
 * "Widest" means the smallest available f-number. This avoids the ambiguous
 * phrases "minimum aperture" and "maximum aperture".
 */
export function parseGenericLensExposureCapabilityProfile(
  value: unknown
): GenericLensExposureCapabilityProfile {
  const record = requireRecord(
    value,
    "genericLensExposureCapabilityProfile", ["schemaVersion", "scientificStatus", "profileId", "profileVersion", "evidence", "focalLengthMmRange", "aperture"]
  );
  const header =
    requireApproximationProfileHeader(
      record,
      "genericLensExposureCapabilityProfile"
    );

  const focalRange =
    parseSourcedRange(
      record.focalLengthMmRange,
      "genericLensExposureCapabilityProfile.focalLengthMmRange"
    );
  const aperture = requireRecord(
    record.aperture,
    "genericLensExposureCapabilityProfile.aperture", ["narrowestAvailableFNumber", "widestAvailableFNumber", "settingGrid"]
  );
  const narrowest =
    parseSourcedPositiveNumber(
      aperture.narrowestAvailableFNumber,
      "genericLensExposureCapabilityProfile.aperture.narrowestAvailableFNumber"
    );
  const widest =
    parseWidestFNumberCapability(
      aperture.widestAvailableFNumber,
      focalRange.value,
      narrowest.value,
      "genericLensExposureCapabilityProfile.aperture.widestAvailableFNumber"
    );

  const broadApertureRange = {
    minimum:
      widest.kind === "constant"
        ? widest.fNumber.value
        : Math.min(
            ...widest.samples.value.map(
              (sample) =>
                sample.fNumber
            )
          ),
    maximum: narrowest.value
  };

  return {
    schemaVersion:
      GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION,
    ...header,
    scientificStatus:
      "approximation",
    focalLengthMmRange:
      focalRange,
    aperture: {
      widestAvailableFNumber:
        widest,
      narrowestAvailableFNumber:
        narrowest,
      settingGrid:
        parseSettingGrid(
          aperture.settingGrid,
          broadApertureRange,
          "genericLensExposureCapabilityProfile.aperture.settingGrid"
        )
    }
  };
}

function interpolateWidestFNumber(
  capability:
    WidestAvailableFNumberCapability,
  selectedFocalLengthMm: number
): number {
  if (capability.kind === "constant") {
    return capability.fNumber.value;
  }

  const samples =
    capability.samples.value;
  for (
    let index = 1;
    index < samples.length;
    index += 1
  ) {
    const right = samples[index]!;
    if (
      selectedFocalLengthMm <=
      right.focalLengthMm
    ) {
      const left =
        samples[index - 1]!;
      const span =
        right.focalLengthMm -
        left.focalLengthMm;
      const phase =
        (selectedFocalLengthMm -
          left.focalLengthMm) /
        span;
      return (
        left.fNumber +
        phase *
          (right.fNumber -
            left.fNumber)
      );
    }
  }

  return samples[
    samples.length - 1
  ]!.fNumber;
}

function resolveGrid(
  grid: NumericSettingGrid,
  minimum: number,
  maximum: number,
  path: string
): ResolvedNumericSettingGrid {
  if (
    grid.kind ===
    "continuous-within-range"
  ) {
    return {
      kind:
        "continuous-within-range"
    };
  }

  const values =
    grid.values.value.filter(
      (value) =>
        value >= minimum &&
        value <= maximum
    );
  if (values.length === 0) {
    throw new InvalidScientificInputError(
      path +
        " has no discrete values inside the resolved capability range."
    );
  }

  return {
    kind: "discrete-values",
    values
  };
}

/**
 * Resolves the exposure-relevant capability subset for one generic body+lens
 * combination at one selected focal length.
 *
 * The source profiles are not changed. This resolver does not choose exposure
 * settings. It only provides the range of available settings (the capability
 * envelope) that the exposure-mode resolvers use.
 */
export function resolveGenericEquipmentExposureCapabilities(
  input:
    ResolveGenericEquipmentExposureCapabilitiesInput
): ResolvedGenericEquipmentExposureCapabilities {
  requireInputKeys(input, "resolveGenericEquipmentExposureCapabilities", ["bodyProfile", "lensProfile", "selectedFocalLengthMm"]);
  const body =
    parseGenericBodyExposureCapabilityProfile(
      input.bodyProfile
    );
  const lens =
    parseGenericLensExposureCapabilityProfile(
      input.lensProfile
    );

  if (
    typeof input.selectedFocalLengthMm !==
      "number" ||
    !Number.isFinite(
      input.selectedFocalLengthMm
    ) ||
    input.selectedFocalLengthMm <= 0
  ) {
    throw new InvalidScientificInputError(
      "selectedFocalLengthMm must be finite and greater than zero."
    );
  }

  const focalRange =
    lens.focalLengthMmRange.value;
  if (
    input.selectedFocalLengthMm <
      focalRange.minimum ||
    input.selectedFocalLengthMm >
      focalRange.maximum
  ) {
    throw new InvalidScientificInputError(
      "selectedFocalLengthMm lies outside the lens capability range."
    );
  }

  const widest =
    interpolateWidestFNumber(
      lens.aperture
        .widestAvailableFNumber,
      input.selectedFocalLengthMm
    );
  const narrowest =
    lens.aperture
      .narrowestAvailableFNumber
      .value;

  if (
    !Number.isFinite(widest) ||
    widest <= 0 ||
    widest > narrowest
  ) {
    throw new InvalidScientificInputError(
      "Resolved aperture range is invalid."
    );
  }

  const shutterRange =
    body.shutter
      .durationSecondsRange.value;
  const isoRange =
    body.iso.range.value;

  return {
    schemaVersion:
      GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION,
    scientificStatus:
      "approximation",
    bodyProfile: {
      profileId: body.profileId,
      profileVersion:
        body.profileVersion
    },
    lensProfile: {
      profileId: lens.profileId,
      profileVersion:
        lens.profileVersion
    },
    selectedFocalLengthMm:
      input.selectedFocalLengthMm,
    aperture: {
      widestAvailableFNumber:
        widest,
      narrowestAvailableFNumber:
        narrowest,
      settingGrid:
        resolveGrid(
          lens.aperture
            .settingGrid,
          widest,
          narrowest,
          "lens aperture setting grid"
        )
    },
    shutter: {
      minimumSeconds:
        shutterRange.minimum,
      maximumSeconds:
        shutterRange.maximum,
      settingGrid:
        resolveGrid(
          body.shutter.settingGrid,
          shutterRange.minimum,
          shutterRange.maximum,
          "body shutter setting grid"
        )
    },
    iso: {
      minimum: isoRange.minimum,
      maximum: isoRange.maximum,
      settingGrid:
        resolveGrid(
          body.iso.settingGrid,
          isoRange.minimum,
          isoRange.maximum,
          "body ISO setting grid"
        ),
      autoIsoAvailability:
        body.iso.autoIso.value
    },
    sourceProfilesMutated: false,
    exactNamedEquipmentEmulationClaimed:
      false
  };
}
