// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor spectral response: how strongly each sensor channel responds at each wavelength, as an EQE
 * (external quantum efficiency) curve, an A/W responsivity curve, or a colour-filter curve times a
 * detector EQE curve.
 *
 * Responses are never guessed from channel names (such as "red") or the CFA type, and are never
 * extrapolated outside the sampled range. A numeric curve can be embedded only with evidence that the
 * data is reusable or owned by Photivra; a public reference without reuse permission can support
 * metadata but does not by itself allow copying its numbers into the engine.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseSpectralWavelengthBasis,
  type SpectralWavelengthBasis,
  type SpectralWavelengthSample
} from "../core/spectral.js";
export type { SpectralWavelengthBasis } from "../core/spectral.js";
import {
  parseSensorColorSamplingProfile,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import { requireInputKeys, rejectUnknownVariantFields, UNCERTAINTY_VARIANT_FIELDS, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, parseConfigScientificStatus as parseScientificStatus, requireConfigFiniteNumber as requireFinite, requireConfigFraction as requireFraction, requireConfigNumberAboveZero as requirePositiveFinite } from "../core/record-validation.js";

type UnknownRecord = Record<string, unknown>;

export type SensorSpectralResponseScientificStatus =
  | "calibrated"
  | "approximation";

export type SensorSpectralResponseUncertainty =
  | {
      kind: "relative";
      fraction: number;
      basis: string;
    }
  | {
      kind: "not-quantified";
      limitation: string;
    };

export interface SensorSpectralReferenceConditions {
  temperatureC?: number;
  incidenceAngleDegreesFromNormal?: number;
  polarization?:
    | "unpolarized"
    | "unspecified";
}

export interface SpectralFractionSample
  extends SpectralWavelengthSample {
  value: number;
}

export interface SpectralResponsivitySample
  extends SpectralWavelengthSample {
  amperesPerWatt: number;
}

interface SpectralCurveBase {
  wavelengthUnit: "nm";
  wavelengthBasis: SpectralWavelengthBasis;
  interpolation: "piecewise-linear";
  outsideRangeBehavior: "fail-closed";
  evidence: readonly EvidenceProvenance[];
}

export interface SpectralFractionCurve
  extends SpectralCurveBase {
  samples: readonly SpectralFractionSample[];
}

export interface SpectralResponsivityCurve
  extends SpectralCurveBase {
  samples: readonly SpectralResponsivitySample[];
}

interface SensorSpectralChannelResponseBase {
  channelId: string;
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  evidence: readonly EvidenceProvenance[];
  referenceConditions?:
    SensorSpectralReferenceConditions;
  conditionDependence:
    "not-modeled";
}

export type EffectiveSensorResponseScope =
  | "site-incident-effective-channel-response"
  | "sensor-package-incident-effective-channel-response";

export type SensorSpectralChannelResponse =
  | (SensorSpectralChannelResponseBase & {
      kind:
        "effective-external-quantum-efficiency";
      responseScope:
        EffectiveSensorResponseScope;
      externalQuantumEfficiency:
        SpectralFractionCurve;
    })
  | (SensorSpectralChannelResponseBase & {
      kind:
        "effective-spectral-responsivity";
      responseScope:
        EffectiveSensorResponseScope;
      spectralResponsivity:
        SpectralResponsivityCurve;
    })
  | (SensorSpectralChannelResponseBase & {
      kind:
        "separable-channel-filter-and-detector-eqe";
      responseScope:
        "site-incident-channel-filter-times-detector-eqe";
      combinationRule: "multiply";
      channelFilterTransmittance:
        SpectralFractionCurve;
      detectorExternalQuantumEfficiency:
        SpectralFractionCurve;
    });

/**
 * Current channel-binding format. v2 (package 2.0.0) serializes the parsed channel with sorted keys.
 * v1 (package 1.5.0 and earlier) used the unparsed channel's JSON in insertion order; it is rejected
 * with an explicit version error instead of being compared.
 */
export const SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT =
  "photivra-spectral-channel-response-canonical-json-v2" as const;

export interface SensorSpectralResponseChannelBinding {
  format:
    typeof SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT;
  canonicalJson: string;
}

/**
 * Versioned response data for the channels of one exact colour-sampling profile.
 * Each channel declares an effective EQE, an effective A/W response, or separate
 * filter and detector EQE curves, with its sampled range, interpolation and an
 * explicit wavelength basis (air or vacuum). Reference conditions, evidence and
 * uncertainty each keep their own validity. Names such as red, green or blue
 * never fill in a missing curve or justify extrapolation.
 */
export interface SensorSpectralResponseProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  evidence: readonly EvidenceProvenance[];
  channels:
    readonly SensorSpectralChannelResponse[];
}

export interface ResolveSensorSpectralResponseAtWavelengthInput {
  colorSamplingProfile:
    SensorColorSamplingProfile;
  spectralResponseProfile:
    SensorSpectralResponseProfile;
  channelId: string;
  wavelengthNanometers: number;
  wavelengthBasis: SpectralWavelengthBasis;
}

export type ResolvedSensorSpectralResponseValue =
  | {
      kind:
        "effective-external-quantum-efficiency";
      externalQuantumEfficiency: number;
      composition:
        | "direct-effective-response"
        | "channel-filter-transmittance-times-detector-eqe";
      channelFilterTransmittance?: number;
      detectorExternalQuantumEfficiency?: number;
    }
  | {
      kind:
        "effective-spectral-responsivity";
      amperesPerWatt: number;
      composition:
        "direct-effective-response";
    };

export interface ResolvedSensorSpectralResponse {
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  sourceResponseKind:
    SensorSpectralChannelResponse["kind"];
  responseScope:
    SensorSpectralChannelResponse["responseScope"];
  scientificStatus:
    SensorSpectralResponseScientificStatus;
  uncertainty:
    SensorSpectralResponseUncertainty;
  wavelengthNanometers: number;
  wavelengthBasis: SpectralWavelengthBasis;
  wavelengthBasisResolved: boolean;
  declaredWavelengthRangeNanometers: {
    minimum: number;
    maximum: number;
  };
  interpolation:
    "piecewise-linear";
  interpolationUsed: boolean;
  outsideRangeBehavior:
    "fail-closed";
  response:
    ResolvedSensorSpectralResponseValue;
  referenceConditions?:
    SensorSpectralReferenceConditions;
  conditionDependenceModeled: false;
  fieldAngleDependenceModeled: false;
  temperatureDependenceModeled: false;
  polarizationDependenceModeled: false;
  spectralIrradianceIntegrated: false;
  wavelengthIntegrationPerformed: false;
  qeResponsivityConversionPerformed: false;
  photonsCalculated: false;
  electronsCalculated: false;
  rawCodeValueProduced: false;
  componentEvidence: {
    profile: readonly EvidenceProvenance[];
    channel: readonly EvidenceProvenance[];
    curves:
      readonly (readonly EvidenceProvenance[])[];
  };
}

function requireReusableCurveEvidence(
  value: unknown,
  path: string
): readonly EvidenceProvenance[] {
  const evidence = parseEvidenceList(
    value,
    path
  );

  if (
    !evidence.some(
      (entry) =>
        entry.reuseStatus ===
          "reusable-data" ||
        entry.reuseStatus ===
          "photivra-owned"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain reusable-data or photivra-owned evidence because the curve contains reusable numeric data."
    );
  }

  return evidence;
}

function parseUncertainty(
  value: unknown,
  path: string
): SensorSpectralResponseUncertainty {
  const record = requireRecord(value, path, null);
  rejectUnknownVariantFields(record, "kind", UNCERTAINTY_VARIANT_FIELDS, path);

  if (record.kind === "relative") {
    const fraction = requireFinite(
      record.fraction,
      path + ".fraction"
    );
    if (fraction < 0) {
      throw new InvalidConfigurationError(
        path +
          ".fraction must be greater than or equal to zero."
      );
    }
    return {
      kind: "relative",
      fraction,
      basis: requireNonEmptyString(
        record.basis,
        path + ".basis"
      )
    };
  }

  if (record.kind === "not-quantified") {
    return {
      kind: "not-quantified",
      limitation: requireNonEmptyString(
        record.limitation,
        path + ".limitation"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseReferenceConditions(
  value: unknown,
  path: string
): SensorSpectralReferenceConditions {
  const record = requireRecord(value, path, ["temperatureC", "incidenceAngleDegreesFromNormal", "polarization"]);
  const temperatureC =
    record.temperatureC === undefined
      ? undefined
      : requireFinite(
          record.temperatureC,
          path + ".temperatureC"
        );
  const incidenceAngleDegreesFromNormal =
    record.incidenceAngleDegreesFromNormal ===
    undefined
      ? undefined
      : requireFinite(
          record.incidenceAngleDegreesFromNormal,
          path +
            ".incidenceAngleDegreesFromNormal"
        );

  if (
    incidenceAngleDegreesFromNormal !==
      undefined &&
    (incidenceAngleDegreesFromNormal < 0 ||
      incidenceAngleDegreesFromNormal > 90)
  ) {
    throw new InvalidConfigurationError(
      path +
        ".incidenceAngleDegreesFromNormal must be from 0 through 90 degrees."
    );
  }

  const polarization =
    record.polarization;
  if (
    polarization !== undefined &&
    polarization !== "unpolarized" &&
    polarization !== "unspecified"
  ) {
    throw new InvalidConfigurationError(
      path + ".polarization is invalid."
    );
  }

  if (
    temperatureC === undefined &&
    incidenceAngleDegreesFromNormal ===
      undefined &&
    polarization === undefined
  ) {
    throw new InvalidConfigurationError(
      path +
        " must declare at least one reference condition."
    );
  }

  return {
    ...(temperatureC === undefined
      ? {}
      : { temperatureC }),
    ...(incidenceAngleDegreesFromNormal ===
    undefined
      ? {}
      : {
          incidenceAngleDegreesFromNormal
        }),
    ...(polarization === undefined
      ? {}
      : { polarization })
  };
}

function parseCurveBase(
  record: UnknownRecord,
  path: string
): SpectralCurveBase {
  if (record.wavelengthUnit !== "nm") {
    throw new InvalidConfigurationError(
      path +
        '.wavelengthUnit must be "nm".'
    );
  }
  if (
    record.interpolation !==
    "piecewise-linear"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.interpolation must be "piecewise-linear".'
    );
  }
  if (
    record.outsideRangeBehavior !==
    "fail-closed"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.outsideRangeBehavior must be "fail-closed".'
    );
  }

  return {
    wavelengthUnit: "nm",
    wavelengthBasis:
      parseSpectralWavelengthBasis(
        record.wavelengthBasis,
        path + ".wavelengthBasis"
      ),
    interpolation: "piecewise-linear",
    outsideRangeBehavior: "fail-closed",
    evidence:
      requireReusableCurveEvidence(
        record.evidence,
        path + ".evidence"
      )
  };
}

function parseFractionSamples(
  value: unknown,
  path: string
): readonly SpectralFractionSample[] {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain at least two wavelength samples."
    );
  }

  let previousWavelength =
    Number.NEGATIVE_INFINITY;

  return value.map((entry, index) => {
    const record = requireRecord(
      entry,
      path + "[" + index + "]", ["wavelengthNanometers", "value"]
    );
    const wavelengthNanometers =
      requirePositiveFinite(
        record.wavelengthNanometers,
        path +
          "[" +
          index +
          "].wavelengthNanometers"
      );

    if (
      wavelengthNanometers <=
      previousWavelength
    ) {
      throw new InvalidConfigurationError(
        path +
          " wavelengths must be strictly increasing."
      );
    }
    previousWavelength =
      wavelengthNanometers;

    return {
      wavelengthNanometers,
      value: requireFraction(
        record.value,
        path +
          "[" +
          index +
          "].value"
      )
    };
  });
}

function parseResponsivitySamples(
  value: unknown,
  path: string
): readonly SpectralResponsivitySample[] {
  if (
    !Array.isArray(value) ||
    value.length < 2
  ) {
    throw new InvalidConfigurationError(
      path +
        " must contain at least two wavelength samples."
    );
  }

  let previousWavelength =
    Number.NEGATIVE_INFINITY;

  return value.map((entry, index) => {
    const record = requireRecord(
      entry,
      path + "[" + index + "]", ["wavelengthNanometers", "amperesPerWatt"]
    );
    const wavelengthNanometers =
      requirePositiveFinite(
        record.wavelengthNanometers,
        path +
          "[" +
          index +
          "].wavelengthNanometers"
      );

    if (
      wavelengthNanometers <=
      previousWavelength
    ) {
      throw new InvalidConfigurationError(
        path +
          " wavelengths must be strictly increasing."
      );
    }
    previousWavelength =
      wavelengthNanometers;

    const amperesPerWatt =
      requireFinite(
        record.amperesPerWatt,
        path +
          "[" +
          index +
          "].amperesPerWatt"
      );
    if (amperesPerWatt < 0) {
      throw new InvalidConfigurationError(
        path +
          "[" +
          index +
          "].amperesPerWatt must be greater than or equal to zero."
      );
    }

    return {
      wavelengthNanometers,
      amperesPerWatt
    };
  });
}

function parseFractionCurve(
  value: unknown,
  path: string
): SpectralFractionCurve {
  const record = requireRecord(
    value,
    path, ["wavelengthUnit", "interpolation", "outsideRangeBehavior", "wavelengthBasis", "evidence", "samples"]
  );
  return {
    ...parseCurveBase(record, path),
    samples: parseFractionSamples(
      record.samples,
      path + ".samples"
    )
  };
}

function parseResponsivityCurve(
  value: unknown,
  path: string
): SpectralResponsivityCurve {
  const record = requireRecord(
    value,
    path, ["wavelengthUnit", "interpolation", "outsideRangeBehavior", "wavelengthBasis", "evidence", "samples"]
  );
  return {
    ...parseCurveBase(record, path),
    samples: parseResponsivitySamples(
      record.samples,
      path + ".samples"
    )
  };
}

function validateCalibratedWavelengthBasis(
  scientificStatus:
    SensorSpectralResponseScientificStatus,
  curves: readonly (
    | SpectralFractionCurve
    | SpectralResponsivityCurve
  )[],
  path: string
): void {
  if (
    scientificStatus === "calibrated" &&
    curves.some(
      (curve) =>
        curve.wavelengthBasis ===
        "unspecified"
    )
  ) {
    throw new InvalidConfigurationError(
      path +
        ' calibrated responses must declare wavelengthBasis "air" or "vacuum".'
    );
  }
}

function usableRange(
  curves: readonly (
    | SpectralFractionCurve
    | SpectralResponsivityCurve
  )[]
): {
  minimum: number;
  maximum: number;
} {
  const minimum = Math.max(
    ...curves.map(
      (curve) =>
        curve.samples[0]!
          .wavelengthNanometers
    )
  );
  const maximum = Math.min(
    ...curves.map(
      (curve) =>
        curve.samples[
          curve.samples.length - 1
        ]!.wavelengthNanometers
    )
  );

  if (!(minimum < maximum)) {
    throw new InvalidConfigurationError(
      "Separable spectral-response component curves must have a non-empty overlapping wavelength interval."
    );
  }

  return { minimum, maximum };
}

function parseChannelResponse(
  value: unknown,
  path: string
): SensorSpectralChannelResponse {
  const record = requireRecord(
    value,
    path, ["channelId", "scientificStatus", "uncertainty", "evidence", "referenceConditions", "conditionDependence", "kind", "responseScope", "externalQuantumEfficiency", "spectralResponsivity", "combinationRule", "channelFilterTransmittance", "detectorExternalQuantumEfficiency"]
  );
  const channelId =
    requireNonEmptyString(
      record.channelId,
      path + ".channelId"
    );
  const scientificStatus =
    parseScientificStatus(
      record.scientificStatus,
      path + ".scientificStatus"
    );
  const uncertainty =
    parseUncertainty(
      record.uncertainty,
      path + ".uncertainty"
    );
  const evidence =
    parseEvidenceList(
      record.evidence,
      path + ".evidence"
    );
  const referenceConditions =
    record.referenceConditions ===
    undefined
      ? undefined
      : parseReferenceConditions(
          record.referenceConditions,
          path + ".referenceConditions"
        );

  if (
    record.conditionDependence !==
    "not-modeled"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.conditionDependence must be "not-modeled".'
    );
  }

  const common = {
    channelId,
    scientificStatus,
    uncertainty,
    evidence,
    ...(referenceConditions === undefined
      ? {}
      : { referenceConditions }),
    conditionDependence:
      "not-modeled" as const
  };

  if (
    record.kind ===
    "effective-external-quantum-efficiency"
  ) {
    if (
      record.responseScope !==
        "site-incident-effective-channel-response" &&
      record.responseScope !==
        "sensor-package-incident-effective-channel-response"
    ) {
      throw new InvalidConfigurationError(
        path +
          ".responseScope is invalid."
      );
    }
    const curve = parseFractionCurve(
      record.externalQuantumEfficiency,
      path +
        ".externalQuantumEfficiency"
    );
    validateCalibratedWavelengthBasis(
      scientificStatus,
      [curve],
      path
    );
    return {
      ...common,
      kind:
        "effective-external-quantum-efficiency",
      responseScope:
        record.responseScope,
      externalQuantumEfficiency:
        curve
    };
  }

  if (
    record.kind ===
    "effective-spectral-responsivity"
  ) {
    if (
      record.responseScope !==
        "site-incident-effective-channel-response" &&
      record.responseScope !==
        "sensor-package-incident-effective-channel-response"
    ) {
      throw new InvalidConfigurationError(
        path +
          ".responseScope is invalid."
      );
    }
    const curve =
      parseResponsivityCurve(
        record.spectralResponsivity,
        path +
          ".spectralResponsivity"
      );
    validateCalibratedWavelengthBasis(
      scientificStatus,
      [curve],
      path
    );
    return {
      ...common,
      kind:
        "effective-spectral-responsivity",
      responseScope:
        record.responseScope,
      spectralResponsivity: curve
    };
  }

  if (
    record.kind ===
    "separable-channel-filter-and-detector-eqe"
  ) {
    if (
      record.responseScope !==
      "site-incident-channel-filter-times-detector-eqe"
    ) {
      throw new InvalidConfigurationError(
        path +
          ".responseScope is invalid."
      );
    }
    if (
      record.combinationRule !==
      "multiply"
    ) {
      throw new InvalidConfigurationError(
        path +
          '.combinationRule must be "multiply".'
      );
    }

    const filterCurve =
      parseFractionCurve(
        record.channelFilterTransmittance,
        path +
          ".channelFilterTransmittance"
      );
    const detectorCurve =
      parseFractionCurve(
        record.detectorExternalQuantumEfficiency,
        path +
          ".detectorExternalQuantumEfficiency"
      );

    if (
      filterCurve.wavelengthBasis !==
      detectorCurve.wavelengthBasis
    ) {
      throw new InvalidConfigurationError(
        path +
          " separable curves must use the same wavelength basis."
      );
    }

    usableRange([
      filterCurve,
      detectorCurve
    ]);
    validateCalibratedWavelengthBasis(
      scientificStatus,
      [
        filterCurve,
        detectorCurve
      ],
      path
    );

    return {
      ...common,
      kind:
        "separable-channel-filter-and-detector-eqe",
      responseScope:
        "site-incident-channel-filter-times-detector-eqe",
      combinationRule: "multiply",
      channelFilterTransmittance:
        filterCurve,
      detectorExternalQuantumEfficiency:
        detectorCurve
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Parses wavelength-dependent response data for sensor channels. Responses are
 * never guessed from channel names or the CFA type.
 *
 * An embedded multi-point curve needs evidence that the data is reusable or
 * owned by Photivra. A public reference without reuse permission can support
 * metadata, but does not by itself allow copying numeric curve data into the engine.
 */
export function parseSensorSpectralResponseProfile(
  value: unknown
): SensorSpectralResponseProfile {
  const profile = requireRecord(
    value,
    "sensorSpectralResponse", ["schemaVersion", "channels", "profileId", "colorSamplingProfileId", "evidence"]
  );

  if (
    profile.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorSpectralResponse.schemaVersion must be "0.1.0".'
    );
  }

  if (
    !Array.isArray(profile.channels) ||
    profile.channels.length === 0
  ) {
    throw new InvalidConfigurationError(
      "sensorSpectralResponse.channels must be a non-empty array."
    );
  }

  const channels =
    profile.channels.map(
      (entry, index) =>
        parseChannelResponse(
          entry,
          "sensorSpectralResponse.channels[" +
            index +
            "]"
        )
    );

  const channelIds = channels.map(
    (entry) => entry.channelId
  );
  if (
    new Set(channelIds).size !==
    channelIds.length
  ) {
    throw new InvalidConfigurationError(
      "sensorSpectralResponse.channels must not contain duplicate channel IDs."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      profile.profileId,
      "sensorSpectralResponse.profileId"
    ),
    colorSamplingProfileId:
      requireNonEmptyString(
        profile.colorSamplingProfileId,
        "sensorSpectralResponse.colorSamplingProfileId"
      ),
    evidence: parseEvidenceList(
      profile.evidence,
      "sensorSpectralResponse.evidence"
    ),
    channels
  };
}

/**
 * Creates an exact binding to one parsed response channel's data, so a swapped numeric curve cannot
 * hide behind an unchanged profile ID.
 *
 * The binding includes the channel's EQE or A/W curve (or its separately evidenced filter × detector
 * EQE curves), its range, interpolation and wavelength basis, and the exact canonical channel data.
 * The channel is parsed first and serialized with sorted object keys, so property order never changes
 * the binding and a malformed channel throws.
 * @param response - The input; see `SensorSpectralChannelResponse` for its fields, units and coordinates.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function createSensorSpectralResponseChannelBinding(
  response: SensorSpectralChannelResponse
): SensorSpectralResponseChannelBinding {
  return {
    format:
      SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT,
    // Parse first so the binding never repeats unvalidated input, then sort keys
    // so channels with the same content bind identically whatever their key order.
    canonicalJson:
      stringifyCanonicalJson(
        parseChannelResponse(
          response,
          "sensorSpectralResponseChannel"
        ),
        {
          undefinedObjectProperties: "omit",
          nonFiniteNumberMessage:
            "sensorSpectralResponseChannel must contain finite numbers.",
          unsupportedValueMessage:
            "sensorSpectralResponseChannel must be plain JSON data."
        }
      )
  };
}

/**
 * Rejects a channel binding stored in a reduction unless it uses the current format. A v1 binding from
 * package 1.5.0 or earlier fails with an explicit version error: a different serializer produced it, so
 * comparing it would report a misleading data mismatch. Recompute the spectral quadrature and reduction
 * with this release to get a v2 binding.
 * Internal to the repository; not exported from the package.
 */
export function requireCurrentSensorSpectralResponseChannelBinding(
  binding: unknown
): void {
  const format =
    typeof binding === "object" && binding !== null
      ? (binding as { format?: unknown }).format
      : undefined;
  if (format === SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT) return;
  throw new InvalidConfigurationError(
    format === "photivra-spectral-channel-response-canonical-json-v1"
      ? "Response-channel binding format v1 (package 1.5.0 and earlier) is not supported; recompute the spectral quadrature and reduction to obtain a v2 binding."
      : "Response-channel binding has an unsupported format; expected " + SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT + "."
  );
}

function topologyChannelIds(
  profile: SensorColorSamplingProfile
): readonly string[] {
  if (
    profile.layout.kind ===
    "layered"
  ) {
    throw new InvalidScientificInputError(
      "Layered color sampling remains spatially unresolved; schema 0.1.0 spectral response cannot yet be composed into per-site layered sampling."
    );
  }

  if (
    profile.layout.kind ===
    "monochrome"
  ) {
    return [profile.layout.channelId];
  }

  return [
    ...new Set(
      profile.layout.siteChannelIds
    )
  ];
}

function interpolateFraction(
  curve: SpectralFractionCurve,
  wavelengthNanometers: number
): {
  value: number;
  interpolationUsed: boolean;
} {
  return interpolateCurve(
    curve.samples,
    wavelengthNanometers,
    (sample) => sample.value
  );
}

function interpolateResponsivity(
  curve: SpectralResponsivityCurve,
  wavelengthNanometers: number
): {
  value: number;
  interpolationUsed: boolean;
} {
  return interpolateCurve(
    curve.samples,
    wavelengthNanometers,
    (sample) =>
      sample.amperesPerWatt
  );
}

function interpolateCurve<T extends {
  wavelengthNanometers: number;
}>(
  samples: readonly T[],
  wavelengthNanometers: number,
  valueOf: (sample: T) => number
): {
  value: number;
  interpolationUsed: boolean;
} {
  const first = samples[0]!;
  const last =
    samples[samples.length - 1]!;

  if (
    wavelengthNanometers <
      first.wavelengthNanometers ||
    wavelengthNanometers >
      last.wavelengthNanometers
  ) {
    throw new InvalidScientificInputError(
      "Requested wavelength is outside the declared spectral-response range; extrapolation/zero-fill is not permitted."
    );
  }

  for (
    let index = 0;
    index < samples.length;
    index += 1
  ) {
    const sample = samples[index]!;
    if (
      wavelengthNanometers ===
      sample.wavelengthNanometers
    ) {
      return {
        value: valueOf(sample),
        interpolationUsed: false
      };
    }

    if (
      wavelengthNanometers <
      sample.wavelengthNanometers
    ) {
      const previous =
        samples[index - 1]!;
      const phase =
        (wavelengthNanometers -
          previous.wavelengthNanometers) /
        (sample.wavelengthNanometers -
          previous.wavelengthNanometers);
      return {
        value:
          valueOf(previous) +
          phase *
            (valueOf(sample) -
              valueOf(previous)),
        interpolationUsed: true
      };
    }
  }

  return {
    value: valueOf(last),
    interpolationUsed: false
  };
}

/**
 * Returns one sensor channel's response at one wavelength.
 *
 * It checks the response profile against the exact colour-sampling profile,
 * rejects layered layouts whose sampling is not defined, uses only the declared
 * piecewise-linear interpolation, and never extrapolates.
 *
 * Both a direct effective response and separate filter × detector QE curves are
 * supported. QE and A/W responsivity are different physical quantities; this
 * API does not convert between them.
 */
export function resolveParsedSensorSpectralResponseAtWavelength(
  input:
    ResolveSensorSpectralResponseAtWavelengthInput
): CalculationResult<ResolvedSensorSpectralResponse> {
  const colorProfile =
    input.colorSamplingProfile;
  const responseProfile =
    input.spectralResponseProfile;

  if (
    responseProfile
      .colorSamplingProfileId !==
    colorProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Spectral-response colorSamplingProfileId must match the supplied color-sampling profile."
    );
  }

  const knownChannelIds =
    topologyChannelIds(colorProfile);
  const knownSet =
    new Set(knownChannelIds);

  for (
    const response of
    responseProfile.channels
  ) {
    if (
      !knownSet.has(
        response.channelId
      )
    ) {
      throw new InvalidScientificInputError(
        "Spectral-response profile declares a channel ID that is not present in the linked color-sampling topology."
      );
    }
  }

  if (
    typeof input.channelId !==
      "string" ||
    input.channelId.trim().length ===
      0
  ) {
    throw new InvalidConfigurationError(
      "channelId must be a non-empty string."
    );
  }
  if (
    !knownSet.has(input.channelId)
  ) {
    throw new InvalidScientificInputError(
      "channelId is not present in the linked color-sampling topology."
    );
  }

  const response =
    responseProfile.channels.find(
      (entry) =>
        entry.channelId ===
        input.channelId
    );
  if (response === undefined) {
    throw new InvalidScientificInputError(
      "No spectral response is declared for the requested channelId."
    );
  }

  if (
    typeof input.wavelengthNanometers !==
      "number" ||
    !Number.isFinite(
      input.wavelengthNanometers
    ) ||
    input.wavelengthNanometers <= 0
  ) {
    throw new InvalidScientificInputError(
      "wavelengthNanometers must be finite and greater than zero."
    );
  }

  if (
    input.wavelengthBasis !==
      "air" &&
    input.wavelengthBasis !==
      "vacuum" &&
    input.wavelengthBasis !==
      "unspecified"
  ) {
    throw new InvalidConfigurationError(
      "wavelengthBasis is invalid."
    );
  }

  const curves:
    (
      | SpectralFractionCurve
      | SpectralResponsivityCurve
    )[] = [];

  let resolvedValue:
    ResolvedSensorSpectralResponseValue;
  let interpolationUsed: boolean;
  let wavelengthBasis:
    SpectralWavelengthBasis;

  if (
    response.kind ===
    "effective-external-quantum-efficiency"
  ) {
    const curve =
      response.externalQuantumEfficiency;
    curves.push(curve);
    wavelengthBasis =
      curve.wavelengthBasis;

    if (
      input.wavelengthBasis !==
      wavelengthBasis
    ) {
      throw new InvalidScientificInputError(
        "Requested wavelengthBasis must exactly match the response curve; Photivra does not convert air/vacuum/unspecified wavelength coordinates implicitly."
      );
    }

    const resolved =
      interpolateFraction(
        curve,
        input.wavelengthNanometers
      );
    interpolationUsed =
      resolved.interpolationUsed;
    resolvedValue = {
      kind:
        "effective-external-quantum-efficiency",
      externalQuantumEfficiency:
        resolved.value,
      composition:
        "direct-effective-response"
    };
  } else if (
    response.kind ===
    "effective-spectral-responsivity"
  ) {
    const curve =
      response.spectralResponsivity;
    curves.push(curve);
    wavelengthBasis =
      curve.wavelengthBasis;

    if (
      input.wavelengthBasis !==
      wavelengthBasis
    ) {
      throw new InvalidScientificInputError(
        "Requested wavelengthBasis must exactly match the response curve; Photivra does not convert air/vacuum/unspecified wavelength coordinates implicitly."
      );
    }

    const resolved =
      interpolateResponsivity(
        curve,
        input.wavelengthNanometers
      );
    interpolationUsed =
      resolved.interpolationUsed;
    resolvedValue = {
      kind:
        "effective-spectral-responsivity",
      amperesPerWatt:
        resolved.value,
      composition:
        "direct-effective-response"
    };
  } else {
    const filterCurve =
      response
        .channelFilterTransmittance;
    const detectorCurve =
      response
        .detectorExternalQuantumEfficiency;
    curves.push(
      filterCurve,
      detectorCurve
    );
    wavelengthBasis =
      filterCurve.wavelengthBasis;

    if (
      input.wavelengthBasis !==
      wavelengthBasis
    ) {
      throw new InvalidScientificInputError(
        "Requested wavelengthBasis must exactly match the separable response curves."
      );
    }

    const filter =
      interpolateFraction(
        filterCurve,
        input.wavelengthNanometers
      );
    const detector =
      interpolateFraction(
        detectorCurve,
        input.wavelengthNanometers
      );

    interpolationUsed =
      filter.interpolationUsed ||
      detector.interpolationUsed;

    resolvedValue = {
      kind:
        "effective-external-quantum-efficiency",
      externalQuantumEfficiency:
        filter.value *
        detector.value,
      composition:
        "channel-filter-transmittance-times-detector-eqe",
      channelFilterTransmittance:
        filter.value,
      detectorExternalQuantumEfficiency:
        detector.value
    };
  }

  const range = usableRange(curves);

  return calculatedResult(
    {
      profileId:
        responseProfile.profileId,
      colorSamplingProfileId:
        responseProfile
          .colorSamplingProfileId,
      channelId: response.channelId,
      sourceResponseKind:
        response.kind,
      responseScope:
        response.responseScope,
      scientificStatus:
        response.scientificStatus,
      uncertainty:
        response.uncertainty,
      wavelengthNanometers:
        input.wavelengthNanometers,
      wavelengthBasis,
      wavelengthBasisResolved:
        wavelengthBasis !==
        "unspecified",
      declaredWavelengthRangeNanometers:
        range,
      interpolation:
        "piecewise-linear",
      interpolationUsed,
      outsideRangeBehavior:
        "fail-closed",
      response: resolvedValue,
      ...(response.referenceConditions ===
      undefined
        ? {}
        : {
            referenceConditions:
              response.referenceConditions
          }),
      conditionDependenceModeled:
        false,
      fieldAngleDependenceModeled:
        false,
      temperatureDependenceModeled:
        false,
      polarizationDependenceModeled:
        false,
      spectralIrradianceIntegrated:
        false,
      wavelengthIntegrationPerformed:
        false,
      qeResponsivityConversionPerformed:
        false,
      photonsCalculated: false,
      electronsCalculated: false,
      rawCodeValueProduced: false,
      componentEvidence: {
        profile:
          responseProfile.evidence,
        channel: response.evidence,
        curves: curves.map(
          (curve) => curve.evidence
        )
      }
    },
    "sensor-spectral-response-lookup",
    "1.0.0",
    [
      "Channel IDs are exact semantic identifiers from the linked color-sampling topology; names do not imply spectral behavior.",
      "Piecewise-linear interpolation is applied only inside the declared wavelength range; no extrapolation or implicit zero response is permitted.",
      "Air, vacuum and unspecified wavelength bases are never converted implicitly.",
      "Direct effective response is preserved when decomposition is not established; separable filter×detector-QE is composed only when explicitly declared.",
      "Spectral responsivity in A/W and external QE remain distinct physical representations and are not converted by this API.",
      "Reference-condition metadata does not create field-angle, temperature or polarization dependence models.",
      "Spectral irradiance integration, wavelength integration, photon/electron conversion and RAW-domain output remain future work."
    ]
  );
}

/**
 * Public spectral-response lookup for untrusted, unparsed profiles.
 *
 * The profiles are parsed here, once. Internal code that has already parsed
 * both profiles can call resolveParsedSensorSpectralResponseAtWavelength, to
 * avoid parsing them again for every wavelength node.
 */
export function resolveSensorSpectralResponseAtWavelength(
  input:
    ResolveSensorSpectralResponseAtWavelengthInput
): CalculationResult<ResolvedSensorSpectralResponse> {
  requireInputKeys(input, "resolveSensorSpectralResponseAtWavelength", ["colorSamplingProfile", "spectralResponseProfile", "channelId", "wavelengthNanometers", "wavelengthBasis"]);
  const colorProfile =
    parseSensorColorSamplingProfile(
      input.colorSamplingProfile
    );
  const responseProfile =
    parseSensorSpectralResponseProfile(
      input.spectralResponseProfile
    );

  return resolveParsedSensorSpectralResponseAtWavelength({
    ...input,
    colorSamplingProfile:
      colorProfile,
    spectralResponseProfile:
      responseProfile
  });
}
