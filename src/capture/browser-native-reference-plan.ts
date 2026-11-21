// SPDX-License-Identifier: Apache-2.0

/**
 * Internal: the prepared record for one browser-native capture event.
 *
 * It freezes the capture-wide inputs that are known before any per-site profile is
 * read. It does not prepare the per-site optical, sensor or readout profiles; those
 * are listed explicitly as unresolved, so caching or reuse cannot silently ignore them.
 */
import { stringifyCanonicalJson } from "../core/canonical-json.js";
import { parseEvidenceList } from "../core/evidence-provenance.js";
import { freezeOwnedData } from "../core/owned-data.js";
import {
  requireAllowlistedRecord,
  requirePublicOpaqueId
} from "../core/record-validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  calculateNativeRawPlan,
  nativeRawMaximumProviderEvaluations,
  type NativeRawPlan
} from "./native-raw.js";
import type { NativeEnvironmentRawInput } from "./native-environment-raw.js";
import {
  prepareBrowserNativeReferenceGeometry,
  type PrepareBrowserNativeReferenceGeometryInput,
  type PreparedBrowserNativeReferenceGeometry
} from "./browser-native-reference-geometry.js";

export const BROWSER_NATIVE_REFERENCE_EVENT_PLAN_VERSION = "0.1.0" as const;
export const BROWSER_NATIVE_REFERENCE_INTEGRATOR_VERSION = "0.1.0" as const;

export interface PrepareBrowserNativeReferenceEventPlanInput {
  event: NativeEnvironmentRawInput;
  geometry: PrepareBrowserNativeReferenceGeometryInput;
}

export interface PreparedBrowserNativeReferenceEventPlan {
  version: typeof BROWSER_NATIVE_REFERENCE_EVENT_PLAN_VERSION;
  integrator: {
    lane: "path-a";
    version: typeof BROWSER_NATIVE_REFERENCE_INTEGRATOR_VERSION;
    arithmetic: "binary64";
    samplingMeaning: "existing-committed-discrete-support";
  };
  rawPlan: NativeRawPlan;
  sceneBinding: {
    sceneStateId: string;
    providerSceneId: string;
    evidence: ReturnType<typeof parseEvidenceList>;
  };
  maximumProviderEvaluations: number;
  geometry: PreparedBrowserNativeReferenceGeometry;
  reuseScope: "event-envelope-and-geometry-only";
  unresolvedDynamicDependencies: readonly [
    "site-environment-profile",
    "site-dark-current-profile",
    "site-charge-profile",
    "site-readout-profile"
  ];
  /**
   * Collision-free canonical identity of the prepared inputs in this record.
   * It is an internal equality key, not a security hash.
   */
  identityJson: string;
}

function canonical(value: unknown): string {
  return stringifyCanonicalJson(value, {
    undefinedObjectProperties: "omit",
    nonFiniteNumberMessage:
      "Browser-native reference prepared identity requires finite numbers.",
    unsupportedValueMessage:
      "Browser-native reference prepared identity requires plain serializable data."
  });
}

function parseSceneBinding(
  value: NativeEnvironmentRawInput["sceneBinding"]
): PreparedBrowserNativeReferenceEventPlan["sceneBinding"] {
  const record = requireAllowlistedRecord(
    value,
    ["sceneStateId", "providerSceneId", "evidence"],
    "Invalid browser-native reference scene binding."
  );
  return {
    sceneStateId: requirePublicOpaqueId(
      record.sceneStateId,
      "Browser-native reference scene binding requires a public scene-state ID."
    ),
    providerSceneId: requirePublicOpaqueId(
      record.providerSceneId,
      "Browser-native reference scene binding requires a public provider-scene ID."
    ),
    evidence: parseEvidenceList(
      record.evidence,
      "browserNativeReferenceSceneBinding.evidence"
    )
  };
}

/**
 * Freezes the capture-wide identity for the reference executor before any source
 * light is computed.
 *
 * Per-site profiles stay listed as unresolved. So this record cannot be reused as
 * a complete prepared capture plan; those profiles must be prepared and validated
 * (browser-native-reference-site) before execution.
 */
export function prepareBrowserNativeReferenceEventPlan(
  input: PrepareBrowserNativeReferenceEventPlanInput
): PreparedBrowserNativeReferenceEventPlan {
  if (typeof input !== "object" || input === null) {
    throw new InvalidConfigurationError(
      "Browser-native reference prepared event requires an input object."
    );
  }

  if (typeof input.event !== "object" || input.event === null) {
    throw new InvalidConfigurationError(
      "Browser-native reference prepared event requires an event object."
    );
  }
  const rawPlan = calculateNativeRawPlan(input.event.raw);
  const sceneBinding = parseSceneBinding(input.event.sceneBinding);
  const geometry = prepareBrowserNativeReferenceGeometry(input.geometry);
  const maximumProviderEvaluations = input.event.maximumProviderEvaluations;

  if (
    typeof maximumProviderEvaluations !== "number" ||
    !Number.isSafeInteger(maximumProviderEvaluations) ||
    maximumProviderEvaluations < rawPlan.pixelCount ||
    maximumProviderEvaluations > nativeRawMaximumProviderEvaluations(rawPlan)
  ) {
    throw new InvalidConfigurationError(
      "Browser-native reference event requires the existing bounded whole-event provider-evaluation budget."
    );
  }

  if (
    rawPlan.exposure.sceneTimeSeconds !== 0 ||
    sceneBinding.sceneStateId !== rawPlan.exposure.sceneStateId ||
    geometry.sourceStateId !== sceneBinding.sceneStateId ||
    geometry.providerSceneId !== sceneBinding.providerSceneId
  ) {
    throw new InvalidConfigurationError(
      "Browser-native reference geometry, scene binding, and opening-reference capture must identify the same source state."
    );
  }

  const integrator = {
    lane: "path-a" as const,
    version: BROWSER_NATIVE_REFERENCE_INTEGRATOR_VERSION,
    arithmetic: "binary64" as const,
    samplingMeaning: "existing-committed-discrete-support" as const
  };
  const reuseScope = "event-envelope-and-geometry-only" as const;
  const unresolvedDynamicDependencies = [
    "site-environment-profile",
    "site-dark-current-profile",
    "site-charge-profile",
    "site-readout-profile"
  ] as const;

  const identityJson = canonical({
    version: BROWSER_NATIVE_REFERENCE_EVENT_PLAN_VERSION,
    integrator,
    rawPlan,
    sceneBinding,
    maximumProviderEvaluations,
    geometry,
    reuseScope,
    unresolvedDynamicDependencies
  });

  return freezeOwnedData({
    version: BROWSER_NATIVE_REFERENCE_EVENT_PLAN_VERSION,
    integrator,
    rawPlan,
    sceneBinding,
    maximumProviderEvaluations,
    geometry,
    reuseScope,
    unresolvedDynamicDependencies,
    identityJson
  });
}
