// SPDX-License-Identifier: Apache-2.0

/**
 * Constant-rate exposure: multiplies a sensor response rate by the exposure time.
 *
 * This shortcut (rate × duration) is allowed only when the caller declares the rate constant
 * (stationary) for this exact site and local shutter interval. With EQE (external quantum
 * efficiency) the result is expected photons and electrons. With A/W responsivity it is charge in
 * coulombs, with no assumed conversion to electrons. Counts stay fractional expected values, before
 * any random sampling. Time-varying signals are not handled here.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import {
  approximationResult,
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type {
  SensorEqeElectronRate
} from "./eqe-electron-rate.js";
import type {
  SensorInstantaneousRateResult,
  SensorRateLocalExposureBinding
} from "./local-exposure-binding.js";
import type {
  SensorResponsivityPhotocurrent
} from "./responsivity-photocurrent.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireConfigFinite as requireFinite, requireConfigString as requireNonEmptyString, requireInputNonNegativeFinite as requireNonNegativeFiniteRate, requireConfigNonNegativeSafeInteger as requireNonNegativeSafeInteger } from "../core/record-validation.js";
import { sameSite } from "../core/shared-helpers.js";


export type SensorRateStationarityStatus =
  | "established"
  | "approximation";

export interface SensorRateTemporalStationarityProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  rateDomain:
    SensorRateLocalExposureBinding["rateDomain"];
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  localExposureWindow: {
    timeReference:
      "first-opening-boundary-phase";
    startOffsetSecondsFromOpeningReference:
      number;
    endOffsetSecondsFromOpeningReference:
      number;
  };
  stationarityMeaning:
    "reported-rate-constant-through-bound-local-exposure";
  status:
    SensorRateStationarityStatus;
  evidence: readonly EvidenceProvenance[];
  limitation?: string;
}

export interface IntegrateStationarySensorRateInput {
  rate:
    SensorInstantaneousRateResult;
  exposureBinding:
    SensorRateLocalExposureBinding;
  stationarityProfile:
    SensorRateTemporalStationarityProfile;
}

interface SensorTemporalIntegrationCommon {
  colorSamplingProfileId: string;
  channelId: string;
  site: {
    x: number;
    y: number;
  };
  bindingId: string;
  stationarityProfileId: string;
  stationarityStatus:
    SensorRateStationarityStatus;
  timeReference:
    "first-opening-boundary-phase";
  startOffsetSecondsFromOpeningReference:
    number;
  endOffsetSecondsFromOpeningReference:
    number;
  localExposureDurationSeconds:
    number;
  integrationMethod:
    "constant-rate-times-local-exposure-duration";
  timeStationarityEstablished: true;
  temporalIntegrationApplied: true;
  exposureDurationApplied: true;
  timeVaryingSignalIntegrated: false;
  multiFrameSequenceIntegrated: false;
  darkChargeIncluded: false;
  otherChargeIncluded: false;
  accumulatedSignalCompleteness:
    "photo-signal-only";
  physicalFullWellAssessmentAuthorized:
    false;
  cameraSaturationAssessmentAuthorized:
    false;
  saturationAssessed: false;
  shotNoiseApplied: false;
  readNoiseApplied: false;
  adcQuantizationApplied: false;
  rawCodeValueProduced: false;
  componentEvidence: {
    stationarity:
      readonly EvidenceProvenance[];
    exposureBinding:
      SensorRateLocalExposureBinding["componentEvidence"];
  };
}

export interface SensorEqeExposureIntegration
  extends SensorTemporalIntegrationCommon {
  kind: "eqe-expected-counts";
  incidentPhotonRatePerSecond: number;
  expectedGeneratedElectronRatePerSecond:
    number;
  expectedIncidentPhotonCount: number;
  expectedGeneratedElectronCount:
    number;
  countsAreExpectationValues: true;
  integerPhotonCountSampled: false;
  integerElectronCountSampled: false;
  chargeCalculated: false;
  currentCalculated: false;
}

export interface SensorResponsivityExposureIntegration
  extends SensorTemporalIntegrationCommon {
  kind:
    "responsivity-photocurrent-charge";
  photocurrentMagnitudeAmperes: number;
  photochargeMagnitudeCoulombs:
    number;
  currentSignConvention:
    "magnitude-only-no-circuit-polarity";
  chargeSignConvention:
    "magnitude-only-no-carrier-or-circuit-polarity";
  carrierCountInferred: false;
  electronCountCalculated: false;
  photonCountCalculated: false;
  detectorBandwidthModeled: false;
}

export type SensorStationaryRateExposureIntegration =
  | SensorEqeExposureIntegration
  | SensorResponsivityExposureIntegration;

/**
 * Validates untrusted input and returns it as a normalized, typed value. Unknown enum values,
 * missing required fields and inconsistent scientific data are rejected.
 *
 * The profile declares that a rate is constant (stationary) for an exact site and local shutter
 * interval, which is what allows rate × duration.
 * @param value - Untrusted data. TypeScript types alone are not validation.
 * @returns The result. Success does not imply calibration.
 *
 * @see docs/API_REFERENCE.md for the package export and its full type definitions.
 */
export function parseSensorRateTemporalStationarityProfile(
  value: unknown
): SensorRateTemporalStationarityProfile {
  const record = requireRecord(
    value,
    "sensorRateTemporalStationarity", ["schemaVersion", "rateDomain", "site", "localExposureWindow", "stationarityMeaning", "status", "limitation", "profileId", "colorSamplingProfileId", "channelId", "bindingId", "evidence"]
  );

  if (
    record.schemaVersion !== "0.1.0"
  ) {
    throw new InvalidConfigurationError(
      'sensorRateTemporalStationarity.schemaVersion must be "0.1.0".'
    );
  }

  if (
    record.rateDomain !==
      "eqe-electron-rate" &&
    record.rateDomain !==
      "responsivity-photocurrent"
  ) {
    throw new InvalidConfigurationError(
      "sensorRateTemporalStationarity.rateDomain is invalid."
    );
  }

  const site = requireRecord(
    record.site,
    "sensorRateTemporalStationarity.site", ["x", "y"]
  );
  const localExposureWindow =
    requireRecord(
      record.localExposureWindow,
      "sensorRateTemporalStationarity.localExposureWindow", ["timeReference", "startOffsetSecondsFromOpeningReference", "endOffsetSecondsFromOpeningReference"]
    );

  if (
    localExposureWindow.timeReference !==
    "first-opening-boundary-phase"
  ) {
    throw new InvalidConfigurationError(
      'sensorRateTemporalStationarity.localExposureWindow.timeReference must be "first-opening-boundary-phase".'
    );
  }

  if (
    record.stationarityMeaning !==
    "reported-rate-constant-through-bound-local-exposure"
  ) {
    throw new InvalidConfigurationError(
      "sensorRateTemporalStationarity.stationarityMeaning is invalid."
    );
  }

  if (
    record.status !== "established" &&
    record.status !== "approximation"
  ) {
    throw new InvalidConfigurationError(
      "sensorRateTemporalStationarity.status is invalid."
    );
  }

  const limitation =
    record.limitation === undefined
      ? undefined
      : requireNonEmptyString(
          record.limitation,
          "sensorRateTemporalStationarity.limitation"
        );

  if (
    record.status === "approximation" &&
    limitation === undefined
  ) {
    throw new InvalidConfigurationError(
      "sensorRateTemporalStationarity.limitation is required for an approximation."
    );
  }

  const start =
    requireFinite(
      localExposureWindow
        .startOffsetSecondsFromOpeningReference,
      "sensorRateTemporalStationarity.localExposureWindow.startOffsetSecondsFromOpeningReference"
    );
  const end =
    requireFinite(
      localExposureWindow
        .endOffsetSecondsFromOpeningReference,
      "sensorRateTemporalStationarity.localExposureWindow.endOffsetSecondsFromOpeningReference"
    );

  if (!(end > start)) {
    throw new InvalidConfigurationError(
      "sensorRateTemporalStationarity.localExposureWindow end must be greater than start."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId:
      requireNonEmptyString(
        record.profileId,
        "sensorRateTemporalStationarity.profileId"
      ),
    rateDomain:
      record.rateDomain,
    colorSamplingProfileId:
      requireNonEmptyString(
        record.colorSamplingProfileId,
        "sensorRateTemporalStationarity.colorSamplingProfileId"
      ),
    channelId:
      requireNonEmptyString(
        record.channelId,
        "sensorRateTemporalStationarity.channelId"
      ),
    site: {
      x: requireNonNegativeSafeInteger(
        site.x,
        "sensorRateTemporalStationarity.site.x"
      ),
      y: requireNonNegativeSafeInteger(
        site.y,
        "sensorRateTemporalStationarity.site.y"
      )
    },
    bindingId:
      requireNonEmptyString(
        record.bindingId,
        "sensorRateTemporalStationarity.bindingId"
      ),
    localExposureWindow: {
      timeReference:
        "first-opening-boundary-phase",
      startOffsetSecondsFromOpeningReference:
        start,
      endOffsetSecondsFromOpeningReference:
        end
    },
    stationarityMeaning:
      "reported-rate-constant-through-bound-local-exposure",
    status:
      record.status,
    evidence:
      parseEvidenceList(
        record.evidence,
        "sensorRateTemporalStationarity.evidence"
      ),
    ...(limitation === undefined
      ? {}
      : { limitation })
  };
}

function requireRateSite(
  rate:
    SensorInstantaneousRateResult
): {
  x: number;
  y: number;
} {
  requireInputObject(rate, "rate input");
  if (
    rate.site === undefined ||
    !Number.isSafeInteger(rate.site.x) ||
    rate.site.x < 0 ||
    !Number.isSafeInteger(rate.site.y) ||
    rate.site.y < 0
  ) {
    throw new InvalidScientificInputError(
      "rate.site is required for temporal integration."
    );
  }
  return {
    x: rate.site.x,
    y: rate.site.y
  };
}

function validateBinding(
  rate:
    SensorInstantaneousRateResult,
  binding:
    SensorRateLocalExposureBinding
): {
  rateDomain:
    SensorRateLocalExposureBinding["rateDomain"];
  site: {
    x: number;
    y: number;
  };
  duration: number;
} {
  const site = requireRateSite(rate);

  if (
    !sameSite(site, binding.site) ||
    binding.colorSamplingProfileId !==
      rate.colorSamplingProfileId ||
    binding.channelId !==
      rate.channelId
  ) {
    throw new InvalidScientificInputError(
      "rate and exposureBinding must reference the same color site/channel."
    );
  }

  const rateDomain =
    rate.sourceResponseKind ===
      "effective-spectral-responsivity"
      ? "responsivity-photocurrent"
      : "eqe-electron-rate";

  if (
    binding.rateDomain !==
      rateDomain ||
    binding
      .nativeImageRasterBindingEstablished !==
      true ||
    binding.channelAtSiteValidated !==
      true ||
    binding
      .constantRateTemporalIntegrationAuthorized !==
      false ||
    binding.timeStationarityEstablished !==
      false ||
    binding.temporalIntegrationApplied !==
      false ||
    binding
      .multiFrameSequenceBindingEstablished !==
      false
  ) {
    throw new InvalidScientificInputError(
      "exposureBinding must remain an unintegrated local timing binding for the same rate domain."
    );
  }

  if (
    binding.rateIdentity
      .responseProfileId !==
      rate.responseProfileId ||
    binding.rateIdentity
      .responseApplicationProfileId !==
      rate.responseApplicationProfileId ||
    binding.rateIdentity
      .operatingRangeProfileId !==
      rate.operatingRangeProfileId
  ) {
    throw new InvalidScientificInputError(
      "exposureBinding response-rate identity must match the rate."
    );
  }

  if (
    rateDomain ===
      "responsivity-photocurrent"
  ) {
    const current =
      rate as SensorResponsivityPhotocurrent;
    if (
      binding.rateIdentity
        .electricalApplicabilityProfileId !==
      current
        .electricalApplicabilityProfileId
    ) {
      throw new InvalidScientificInputError(
        "exposureBinding electrical applicability identity must match the A/W rate."
      );
    }
  } else if (
    binding.rateIdentity
      .electricalApplicabilityProfileId !==
      undefined
  ) {
    throw new InvalidScientificInputError(
      "EQE exposureBinding must not carry an A/W electrical applicability identity."
    );
  }

  const window =
    binding.localExposureWindow;
  const duration =
    window
      .endOffsetSecondsFromOpeningReference -
    window
      .startOffsetSecondsFromOpeningReference;

  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(
      binding.localExposureDurationSeconds
    ) ||
    binding.localExposureDurationSeconds !==
      duration
  ) {
    throw new InvalidScientificInputError(
      "exposureBinding local duration must exactly equal end minus start and remain positive."
    );
  }

  return {
    rateDomain,
    site,
    duration
  };
}

function validateStationarity(
  stationarity:
    SensorRateTemporalStationarityProfile,
  binding:
    SensorRateLocalExposureBinding,
  rateDomain:
    SensorRateLocalExposureBinding["rateDomain"],
  site: {
    x: number;
    y: number;
  }
): void {
  if (
    stationarity.rateDomain !==
      rateDomain ||
    stationarity
      .colorSamplingProfileId !==
      binding.colorSamplingProfileId ||
    stationarity.channelId !==
      binding.channelId ||
    !sameSite(
      stationarity.site,
      site
    ) ||
    stationarity.bindingId !==
      binding.bindingId ||
    stationarity
      .localExposureWindow
      .timeReference !==
      binding.timeReference ||
    stationarity
      .localExposureWindow
      .startOffsetSecondsFromOpeningReference !==
      binding.localExposureWindow
        .startOffsetSecondsFromOpeningReference ||
    stationarity
      .localExposureWindow
      .endOffsetSecondsFromOpeningReference !==
      binding.localExposureWindow
        .endOffsetSecondsFromOpeningReference
  ) {
    throw new InvalidScientificInputError(
      "stationarityProfile must apply to the exact bound rate domain, site, binding, and local exposure window."
    );
  }
}

/**
 * Integrates one response rate, declared constant, over its exact local
 * exposure window.
 *
 * This is the constant-rate approximation only. It does not sample or
 * integrate a time-varying signal. EQE rates give expected photons and
 * electrons; A/W rates give coulombs. Counts stay fractional.
 */
export function integrateStationarySensorRateOverLocalExposure(
  input:
    IntegrateStationarySensorRateInput
): CalculationResult<SensorStationaryRateExposureIntegration> {
  requireInputKeys(input, "integrateStationarySensorRateOverLocalExposure", ["rate", "exposureBinding", "stationarityProfile"]);
  const binding =
    validateBinding(
      input.rate,
      input.exposureBinding
    );
  const stationarity =
    parseSensorRateTemporalStationarityProfile(
      input.stationarityProfile
    );
  validateStationarity(
    stationarity,
    input.exposureBinding,
    binding.rateDomain,
    binding.site
  );

  const common = {
    colorSamplingProfileId:
      input.rate
        .colorSamplingProfileId,
    channelId:
      input.rate.channelId,
    site: binding.site,
    bindingId:
      input.exposureBinding.bindingId,
    stationarityProfileId:
      stationarity.profileId,
    stationarityStatus:
      stationarity.status,
    timeReference:
      input.exposureBinding
        .timeReference,
    startOffsetSecondsFromOpeningReference:
      input.exposureBinding
        .localExposureWindow
        .startOffsetSecondsFromOpeningReference,
    endOffsetSecondsFromOpeningReference:
      input.exposureBinding
        .localExposureWindow
        .endOffsetSecondsFromOpeningReference,
    localExposureDurationSeconds:
      binding.duration,
    integrationMethod:
      "constant-rate-times-local-exposure-duration" as const,
    timeStationarityEstablished:
      true as const,
    temporalIntegrationApplied:
      true as const,
    exposureDurationApplied:
      true as const,
    timeVaryingSignalIntegrated:
      false as const,
    multiFrameSequenceIntegrated:
      false as const,
    darkChargeIncluded:
      false as const,
    otherChargeIncluded:
      false as const,
    accumulatedSignalCompleteness:
      "photo-signal-only" as const,
    physicalFullWellAssessmentAuthorized:
      false as const,
    cameraSaturationAssessmentAuthorized:
      false as const,
    saturationAssessed:
      false as const,
    shotNoiseApplied:
      false as const,
    readNoiseApplied:
      false as const,
    adcQuantizationApplied:
      false as const,
    rawCodeValueProduced:
      false as const,
    componentEvidence: {
      stationarity:
        stationarity.evidence,
      exposureBinding:
        input.exposureBinding
          .componentEvidence
    }
  };

  const assumptions = [
    "The reported instantaneous rate is explicitly declared constant through this exact bound local exposure window.",
    "The integration is therefore rate × local duration; no temporal quadrature or time-varying signal samples are generated.",
    "Motion, flicker, flash, time-varying illumination/vignetting, shutter modulation and other temporal scene/optical effects are excluded unless already proven irrelevant by the stationarity evidence.",
    "A/W stationarity additionally treats the quasi-static detector-terminal photocurrent result as valid throughout the window; detector bandwidth/transient response remains unmodeled.",
    "This result contains photo-signal accumulation only. Dark current, defects, leakage, charge injection and other charge contributors are not included.",
    "Physical full-well and camera/digital saturation must not be assessed from this incomplete photo-signal accumulation alone.",
    "Shot/read noise, conversion gain, ADC/RAW conversion and reconstruction remain downstream."
  ];

  if (
    binding.rateDomain ===
      "eqe-electron-rate"
  ) {
    const rate =
      input.rate as
        SensorEqeElectronRate;
    const photonRate =
      requireNonNegativeFiniteRate(
        rate.incidentPhotonRatePerSecond,
        "rate.incidentPhotonRatePerSecond"
      );
    const electronRate =
      requireNonNegativeFiniteRate(
        rate
          .expectedGeneratedElectronRatePerSecond,
        "rate.expectedGeneratedElectronRatePerSecond"
      );
    const photonCount =
      photonRate *
      binding.duration;
    const electronCount =
      electronRate *
      binding.duration;

    if (
      !Number.isFinite(photonCount) ||
      !Number.isFinite(electronCount)
    ) {
      throw new InvalidScientificInputError(
        "EQE constant-rate temporal integration must remain finite."
      );
    }

    const result:
      SensorEqeExposureIntegration = {
        ...common,
        kind:
          "eqe-expected-counts",
        incidentPhotonRatePerSecond:
          photonRate,
        expectedGeneratedElectronRatePerSecond:
          electronRate,
        expectedIncidentPhotonCount:
          photonCount,
        expectedGeneratedElectronCount:
          electronCount,
        countsAreExpectationValues:
          true,
        integerPhotonCountSampled:
          false,
        integerElectronCountSampled:
          false,
        chargeCalculated: false,
        currentCalculated: false
      };

    return stationarity.status ===
      "established"
      ? calculatedResult(
          result,
          "sensor-stationary-eqe-exposure-integration",
          "1.0.0",
          assumptions
        )
      : approximationResult(
          result,
          "sensor-stationary-eqe-exposure-integration",
          "1.0.0",
          [
            ...assumptions,
            stationarity.limitation!
          ]
        );
  }

  const rate =
    input.rate as
      SensorResponsivityPhotocurrent;
  const current =
    requireNonNegativeFiniteRate(
      rate.photocurrentMagnitudeAmperes,
      "rate.photocurrentMagnitudeAmperes"
    );

  if (
    rate.temporalResponseModel !==
      "quasi-static-steady-state-only" ||
    rate.detectorBandwidthModeled !==
      false ||
    rate.chargeCalculated !== false
  ) {
    throw new InvalidScientificInputError(
      "A/W input must remain a quasi-static current result with no prior charge integration."
    );
  }

  const charge =
    current * binding.duration;
  if (!Number.isFinite(charge)) {
    throw new InvalidScientificInputError(
      "A/W constant-current temporal integration must remain finite."
    );
  }

  const result:
    SensorResponsivityExposureIntegration =
      {
        ...common,
        kind:
          "responsivity-photocurrent-charge",
        photocurrentMagnitudeAmperes:
          current,
        photochargeMagnitudeCoulombs:
          charge,
        currentSignConvention:
          rate.currentSignConvention,
        chargeSignConvention:
          "magnitude-only-no-carrier-or-circuit-polarity",
        carrierCountInferred: false,
        electronCountCalculated:
          false,
        photonCountCalculated:
          false,
        detectorBandwidthModeled:
          false
      };

  return stationarity.status ===
    "established"
    ? calculatedResult(
        result,
        "sensor-stationary-responsivity-exposure-integration",
        "1.0.0",
        assumptions
      )
    : approximationResult(
        result,
        "sensor-stationary-responsivity-exposure-integration",
        "1.0.0",
        [
          ...assumptions,
          stationarity.limitation!
        ]
      );
}
