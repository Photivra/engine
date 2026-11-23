// SPDX-License-Identifier: Apache-2.0

/**
 * Internal: prepares one native sensor site (pixel) for the browser-native reference executor.
 *
 * The site's environment, dark-current, charge-completeness and readout inputs are validated,
 * copied, given a canonical identity and frozen once. Photo and dark signal, accumulated charge,
 * random noise and RAW values are still computed at execution time.
 */
import { requireAboveAbsoluteZeroCelsius } from "../core/temperature-validation.js";
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { freezeOwnedData } from "../core/owned-data.js";
import {
  requireAllowlistedRecord,
  requirePublicOpaqueId
} from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  parseSensorAccumulatedChargeCompletenessProfile,
  parseSensorAdditionalStoredChargeComponent
} from "../sensor/accumulated-charge.js";
import { resolveCaptureModeColorSamplingContributors } from "../sensor/capture-color-sampling-binding.js";
import { parseSensorDarkCurrentProfile } from "../sensor/dark-current.js";
import { parseSensorPhysicalChargeCapacityProfile } from "../sensor/physical-charge-capacity.js";
import {
  parseSensorChargeSamplingProfile,
  parseSensorReadoutConversionProfile,
  resolveSensorReadoutRegime
} from "../sensor/raw-readout.js";
import {
  planEnvironmentRawSite,
  type SimulateEnvironmentSensorRawFrameInput
} from "./environment-raw-producer.js";
import type { PreparedBrowserNativeReferenceEventPlan } from "./browser-native-reference-plan.js";

export const BROWSER_NATIVE_REFERENCE_SITE_PLAN_VERSION = "0.2.0" as const;

type EnvironmentReferencePlan = ReturnType<typeof planEnvironmentRawSite>;
type EnvironmentReferenceGroup =
  EnvironmentReferencePlan["instants"][number]["groups"][number];
type EnvironmentReferenceTap = EnvironmentReferenceGroup["taps"][number];
type EnvironmentReferenceRay =
  NonNullable<EnvironmentReferenceTap["apertureRays"]>[number];

export interface PreparedBrowserNativeReferenceCompactExecutionPlan {
  sceneBindings: EnvironmentReferencePlan["sceneBindings"];
  sensor: EnvironmentReferencePlan["owned"]["sensor"];
  optics: EnvironmentReferencePlan["owned"]["optics"];
  instants: readonly {
    temporalSampleIndex: number;
    time: number;
    apertureRaysBySpatial: readonly (readonly EnvironmentReferenceRay[])[];
    groups: readonly {
      node: EnvironmentReferenceGroup["node"];
      spatialOrdinal: number;
      kernelSampleX: number;
      kernelSampleY: number;
      point: EnvironmentReferenceTap["point"];
      request: EnvironmentReferenceTap["request"];
      sourcePointImagePlaneMm: EnvironmentReferenceTap["sourcePointImagePlaneMm"];
      fieldThroughput: EnvironmentReferenceTap["fieldThroughput"];
    }[];
  }[];
}

export interface PreparedBrowserNativeReferenceSite {
  version: typeof BROWSER_NATIVE_REFERENCE_SITE_PLAN_VERSION;
  nativeIndex: number;
  eventIdentityJson: string;
  environment: ReturnType<typeof planEnvironmentRawSite>["owned"];
  sharedSourceOpticalStateIdentityJson: string;
  executionPlan: PreparedBrowserNativeReferenceCompactExecutionPlan | null;
  expectedProviderEvaluationCount: number;
  logicalSupport: {
    spatialNodeCount: number;
    temporalNodeCount: number;
    pupilSampleCount: number;
    spectralNodeCount: number;
    spectralWavelengthsNanometers: readonly number[];
    committedSourceSampleCount: number;
    plannedUniqueGeometryCount: number;
  };
  darkCurrentProfile: ReturnType<typeof parseSensorDarkCurrentProfile>;
  operatingTemperatureC: number;
  charge: {
    completenessProfile: ReturnType<
      typeof parseSensorAccumulatedChargeCompletenessProfile
    >;
    additionalChargeComponents?: readonly ReturnType<
      typeof parseSensorAdditionalStoredChargeComponent
    >[];
  };
  readout: {
    samplingProfile: ReturnType<typeof parseSensorChargeSamplingProfile>;
    capacityProfile: ReturnType<typeof parseSensorPhysicalChargeCapacityProfile>;
    operatingStateId: string;
    readoutProfile: ReturnType<typeof parseSensorReadoutConversionProfile>;
    regimeId: string;
  };
  unresolvedExecutionDependencies: readonly [
    "photo-signal",
    "dark-charge",
    "accumulated-charge",
    "stochastic-realization",
    "raw-code"
  ];
  identityJson: string;
}

function canonical(value: unknown): string {
  return stringifyCanonicalJson(value, {
    undefinedObjectProperties: "omit",
    nonFiniteNumberMessage:
      "Browser-native prepared site identity requires finite numbers.",
    unsupportedValueMessage:
      "Browser-native prepared site identity requires plain serializable data."
  });
}

function prepareCompactExecutionPlan(
  plan: EnvironmentReferencePlan
): PreparedBrowserNativeReferenceCompactExecutionPlan | null {
  if (plan.owned.psf.kind !== "not-applied" || plan.owned.pupil === undefined) {
    return null;
  }

  const spatialCount = plan.spatialQuadrature.nodes.length;
  const spectralCount = plan.spectralQuadrature.nodes.length;
  const instants = plan.instants.map((instant) => {
    const apertureRaysBySpatial = Array.from(
      { length: spatialCount },
      (_, spatialOrdinal) => {
        const firstGroup = instant.groups[spatialOrdinal];
        if (firstGroup === undefined || firstGroup.taps.length !== 1) {
          throw new InvalidConfigurationError(
            "Browser-native compact execution requires one tap per spatial/spectral group."
          );
        }
        const firstTap = firstGroup.taps[0]!;
        if (firstTap.apertureRays === undefined) {
          throw new InvalidConfigurationError(
            "Browser-native compact execution requires explicit ideal-pupil rays."
          );
        }

        const rayIdentity = canonical(firstTap.apertureRays);
        const pointIdentity = canonical({
          point: firstTap.point,
          fieldThroughput: firstTap.fieldThroughput
        });
        for (
          let spectralOrdinal = 1;
          spectralOrdinal < spectralCount;
          spectralOrdinal++
        ) {
          const group =
            instant.groups[spectralOrdinal * spatialCount + spatialOrdinal];
          if (group === undefined || group.taps.length !== 1) {
            throw new InvalidConfigurationError(
              "Browser-native compact execution requires rectangular spectral/spatial support."
            );
          }
          const tap = group.taps[0]!;
          if (
            tap.apertureRays === undefined ||
            canonical(tap.apertureRays) !== rayIdentity ||
            canonical({
              point: tap.point,
              fieldThroughput: tap.fieldThroughput
            }) !== pointIdentity
          ) {
            throw new InvalidConfigurationError(
              "Browser-native compact execution may reuse geometry only when every wavelength preserves the exact ray/spatial support."
            );
          }
        }
        return firstTap.apertureRays;
      }
    );

    const groups = instant.groups.map((group, groupIndex) => {
      if (group.taps.length !== 1) {
        throw new InvalidConfigurationError(
          "Browser-native compact execution does not retain sampled-PSF tap expansion."
        );
      }
      const tap = group.taps[0]!;
      return {
        node: group.node,
        spatialOrdinal: groupIndex % spatialCount,
        kernelSampleX: tap.kernelSampleX,
        kernelSampleY: tap.kernelSampleY,
        point: tap.point,
        request: tap.request,
        sourcePointImagePlaneMm: tap.sourcePointImagePlaneMm,
        fieldThroughput: tap.fieldThroughput
      };
    });

    return {
      temporalSampleIndex: instant.temporalSampleIndex,
      time: instant.time,
      apertureRaysBySpatial,
      groups
    };
  });

  return {
    sceneBindings: plan.sceneBindings,
    sensor: plan.owned.sensor,
    optics: plan.owned.optics,
    instants
  };
}

function validateDarkCurrentTemperature(
  profile: ReturnType<typeof parseSensorDarkCurrentProfile>,
  operatingTemperatureC: number
): void {
  if (!Number.isFinite(operatingTemperatureC)) {
    throw new InvalidScientificInputError(
      "Browser-native prepared site operating temperature must be finite."
    );
  }
  requireAboveAbsoluteZeroCelsius(operatingTemperatureC, "Browser-native prepared site operating temperature", InvalidScientificInputError);
  const model = profile.temperatureModel;
  if (model.kind === "fixed-reference-temperature") {
    if (operatingTemperatureC !== model.referenceTemperatureC) {
      throw new InvalidScientificInputError(
        "Browser-native prepared site dark current requires its exact fixed reference temperature."
      );
    }
    return;
  }
  const first = model.samples[0]!;
  const last = model.samples[model.samples.length - 1]!;
  if (
    operatingTemperatureC < first.temperatureC ||
    operatingTemperatureC > last.temperatureC
  ) {
    throw new InvalidScientificInputError(
      "Browser-native prepared site temperature is outside the dark-current measured range."
    );
  }
}

function validateCapacityApplicability(
  profile: ReturnType<typeof parseSensorPhysicalChargeCapacityProfile>,
  operatingStateId: string,
  operatingTemperatureC: number,
  colorSamplingProfileId: string,
  channelId: string,
  colorSamplingSite: { x: number; y: number }
): void {
  if (
    profile.colorSamplingProfileId !== colorSamplingProfileId ||
    profile.channelId !== channelId
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site capacity color/channel identity must match the bound CFA site."
    );
  }
  if (
    profile.siteApplicability.kind === "exact-site" &&
    (profile.siteApplicability.site.x !== colorSamplingSite.x ||
      profile.siteApplicability.site.y !== colorSamplingSite.y)
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site exact-site capacity must match the bound color-sampling site."
    );
  }
  if (profile.operatingState.stateId !== operatingStateId) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site operating state must match the charge-capacity profile."
    );
  }
  if (
    profile.temperatureApplicability.kind === "exact-reference-temperature" &&
    profile.temperatureApplicability.temperatureC !== operatingTemperatureC
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site temperature must match the charge-capacity reference temperature."
    );
  }
}

/**
 * Prepares one native site without keeping the per-sample execution graph.
 * planEnvironmentRawSite() still parses the environment and checks that its
 * bindings agree.
 */
export function prepareBrowserNativeReferenceSite(
  eventPlan: PreparedBrowserNativeReferenceEventPlan,
  siteInput: SimulateEnvironmentSensorRawFrameInput["sites"][number],
  nativeIndex: number
): PreparedBrowserNativeReferenceSite {
  if (
    !Number.isSafeInteger(nativeIndex) ||
    nativeIndex < 0 ||
    nativeIndex >= eventPlan.rawPlan.pixelCount
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site requires an in-range absolute native index."
    );
  }

  const exposureWindow = eventPlan.rawPlan.exposureWindow;
  if (exposureWindow === undefined) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site requires the explicit committed shutter event."
    );
  }

  const site = structuredClone(siteInput);
  requireAllowlistedRecord(
    site,
    ["environment", "darkCurrentProfile", "operatingTemperatureC", "charge", "readout"],
    "Invalid browser-native prepared site fields."
  );
  requireAllowlistedRecord(
    site.charge,
    ["completenessProfile", "additionalChargeComponents"],
    "Invalid browser-native prepared charge fields."
  );
  requireAllowlistedRecord(
    site.readout,
    [
      "samplingProfile",
      "capacityProfile",
      "operatingStateId",
      "readoutProfile",
      "regimeId"
    ],
    "Invalid browser-native prepared readout fields."
  );

  const environmentPlan = planEnvironmentRawSite(
    site,
    nativeIndex,
    eventPlan.rawPlan.frame,
    eventPlan.sceneBinding,
    exposureWindow
  );

  if (environmentPlan.owned.lensFieldMapping !== undefined) {
    // The browser-native executor integrates irradiance itself and does not apply the distortion
    // area factor. Reject the input rather than silently dropping that factor.
    throw new InvalidConfigurationError(
      "Browser-native prepared sites do not yet support an environment lens field mapping."
    );
  }

  if (environmentPlan.count > 100_000) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site alone exceeds the existing per-source-tile provider-evaluation bound."
    );
  }

  const sharedSourceOpticalStateIdentityJson = canonical({
    sceneBindings: environmentPlan.owned.sceneBindings,
    optics: environmentPlan.owned.optics,
    motion: environmentPlan.owned.motion,
    psf: environmentPlan.owned.psf,
    pupil: environmentPlan.owned.pupil,
    fieldThroughput: environmentPlan.owned.fieldThroughput
  });
  const executionPlan = prepareCompactExecutionPlan(environmentPlan);

  const spatialNodeCount = environmentPlan.spatialQuadrature.nodes.length;
  const temporalNodeCount = environmentPlan.instants.length;
  const spectralNodeCount = environmentPlan.spectralQuadrature.nodes.length;
  const firstTap = environmentPlan.instants[0]?.groups[0]?.taps[0];
  const pupilSampleCount = firstTap?.apertureRays?.length ?? 1;
  const plannedUniqueGeometryCount =
    spatialNodeCount * temporalNodeCount * pupilSampleCount;
  if (
    !Number.isSafeInteger(plannedUniqueGeometryCount) ||
    plannedUniqueGeometryCount < 1 ||
    !Number.isSafeInteger(environmentPlan.count) ||
    environmentPlan.count !== plannedUniqueGeometryCount * spectralNodeCount
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site logical support cannot be reconciled with exact wavelength-independent geometry reuse."
    );
  }

  const darkCurrentProfile = parseSensorDarkCurrentProfile(
    site.darkCurrentProfile
  );
  validateDarkCurrentTemperature(
    darkCurrentProfile,
    site.operatingTemperatureC
  );

  const completenessProfile =
    parseSensorAccumulatedChargeCompletenessProfile(
      site.charge.completenessProfile
    );
  const additionalChargeComponents =
    site.charge.additionalChargeComponents === undefined
      ? undefined
      : site.charge.additionalChargeComponents.map(
          (component) => parseSensorAdditionalStoredChargeComponent(component)
        );

  const samplingProfile = parseSensorChargeSamplingProfile(
    site.readout.samplingProfile
  );
  const capacityProfile = parseSensorPhysicalChargeCapacityProfile(
    site.readout.capacityProfile
  );
  const operatingStateId = requirePublicOpaqueId(
    site.readout.operatingStateId,
    "Browser-native prepared site requires a public operating-state ID."
  );
  const readoutProfile = parseSensorReadoutConversionProfile(
    site.readout.readoutProfile
  );
  const regimeId = requirePublicOpaqueId(
    site.readout.regimeId,
    "Browser-native prepared site requires a public readout-regime ID."
  );

  const native = eventPlan.rawPlan.exposure.geometry.nativeRaster;
  const expectedSite = {
    x: nativeIndex % native.pixelWidth,
    y: Math.floor(nativeIndex / native.pixelWidth)
  };
  const contributors = resolveCaptureModeColorSamplingContributors({
    nativeRaster: native,
    captureModeProfile: eventPlan.rawPlan.frame.captureModeProfile,
    modeId: eventPlan.rawPlan.frame.modeId,
    colorSamplingProfile: eventPlan.rawPlan.frame.colorSamplingProfile,
    bindingProfile: eventPlan.rawPlan.frame.bindingProfile,
    modeSampleIndexFullFrame: expectedSite
  });
  if (
    contributors.totalContributorSites !== 1 ||
    contributors.channelComposition.kind !== "single-channel"
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site requires one exact native CFA contributor."
    );
  }

  const channelId = contributors.channelComposition.channelId;
  if (
    readoutProfile.colorSamplingProfileId !==
      eventPlan.rawPlan.frame.colorSamplingProfile.profileId ||
    readoutProfile.channelId !== channelId ||
    darkCurrentProfile.colorSamplingProfileId !==
      eventPlan.rawPlan.frame.colorSamplingProfile.profileId ||
    darkCurrentProfile.channelId !== channelId ||
    capacityProfile.colorSamplingProfileId !==
      eventPlan.rawPlan.frame.colorSamplingProfile.profileId ||
    capacityProfile.channelId !== channelId ||
    completenessProfile.profileId !== samplingProfile.completenessProfileId
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site readout, dark-current, capacity, sampling, and CFA identities must agree."
    );
  }

  if (
    darkCurrentProfile.siteApplicability.kind === "exact-site" &&
    (darkCurrentProfile.siteApplicability.site.x !==
      contributors.colorSamplingSiteRect.x ||
      darkCurrentProfile.siteApplicability.site.y !==
        contributors.colorSamplingSiteRect.y)
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site dark-current exact-site applicability must match the bound color-sampling site."
    );
  }

  validateCapacityApplicability(
    capacityProfile,
    operatingStateId,
    site.operatingTemperatureC,
    eventPlan.rawPlan.frame.colorSamplingProfile.profileId,
    channelId,
    {
      x: contributors.colorSamplingSiteRect.x,
      y: contributors.colorSamplingSiteRect.y
    }
  );

  const readout = resolveSensorReadoutRegime({
    profile: readoutProfile,
    regimeId
  });
  if (
    readout.regime.adc.bitDepth > 16 ||
    readout.regime.adc.digitalSaturationCode <=
      readout.regime.adc.blackLevelCode
  ) {
    throw new InvalidConfigurationError(
      "Browser-native prepared site requires a positive uint16 readout code span."
    );
  }

  const unresolvedExecutionDependencies = [
    "photo-signal",
    "dark-charge",
    "accumulated-charge",
    "stochastic-realization",
    "raw-code"
  ] as const;

  const prepared = {
    version: BROWSER_NATIVE_REFERENCE_SITE_PLAN_VERSION,
    nativeIndex,
    eventIdentityJson: eventPlan.identityJson,
    environment: environmentPlan.owned,
    sharedSourceOpticalStateIdentityJson,
    executionPlan,
    expectedProviderEvaluationCount: environmentPlan.count,
    logicalSupport: {
      spatialNodeCount,
      temporalNodeCount,
      pupilSampleCount,
      spectralNodeCount,
      spectralWavelengthsNanometers: environmentPlan.spectralQuadrature.nodes.map(
        (node) => node.wavelengthNanometers
      ),
      committedSourceSampleCount: environmentPlan.count,
      plannedUniqueGeometryCount
    },
    darkCurrentProfile,
    operatingTemperatureC: site.operatingTemperatureC,
    charge: {
      completenessProfile,
      ...(additionalChargeComponents === undefined
        ? {}
        : { additionalChargeComponents })
    },
    readout: {
      samplingProfile,
      capacityProfile,
      operatingStateId,
      readoutProfile,
      regimeId
    },
    unresolvedExecutionDependencies
  };

  return freezeOwnedData({
    ...prepared,
    identityJson: canonical(prepared)
  });
}
