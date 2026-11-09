// SPDX-License-Identifier: Apache-2.0

/**
 * Sensor optical stack: the layers in front of the photodiodes (such as cover glass, infrared- and
 * ultraviolet-cut filters, a birefringent low-pass filter and microlenses), described as metadata,
 * plus an optional declared anti-aliasing (AA) blur kernel.
 *
 * Whether a component is physically present is recorded separately from its net AA effect. That lets
 * the schema describe designs that cancel the AA effect without claiming the hardware is missing.
 * Component presence alone creates no optical effect. Thickness, refractive index, spectral
 * transmission, angle of acceptance, focus shift and microlens collection need separate models.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigFiniteNumber as requireFiniteNumber } from "../core/record-validation.js";


export type SensorOpticalStackComponentRole =
  | "cover-glass"
  | "infrared-cut"
  | "ultraviolet-cut"
  | "anti-reflection"
  | "birefringent-low-pass"
  | "wave-plate"
  | "other-optical-filter";

export interface SensorOpticalStackComponent {
  componentId: string;
  /**
   * A component can have several roles, because one physical element can do
   * more than one optical or filtering job.
   */
  roles: readonly SensorOpticalStackComponentRole[];
  evidence: readonly EvidenceProvenance[];
}

export interface SensorMicrolensDeclaration {
  presence: "present" | "absent";
  evidence: readonly EvidenceProvenance[];
  /**
   * Being present does not establish any model of angle, spectrum, fill factor
   * or collection efficiency.
   */
  opticalEffectModel: "unresolved";
}

export interface AntiAliasingPointSplitComponent {
  /**
   * Physical offset on the native sensor from where the light would otherwise
   * land. +X right, +Y down. Units: micrometres.
   */
  offsetMicrometers: {
    x: number;
    y: number;
  };
  /**
   * Normalized weight (dimensionless). A point-splitting kernel only describes
   * where the light goes; the stack's total throughput is not part of it.
   */
  normalizedWeight: number;
}

export type SensorEffectiveAntiAliasingSpatialResponse =
  | {
      /**
       * Documented absence (or cancellation) of deliberate AA splitting. It does
       * not mean the rest of the sensor stack has no optical effect.
       */
      kind: "absent";
      evidence: readonly EvidenceProvenance[];
    }
  | {
      /**
       * An AA effect is known to exist, but its spatial response is not
       * specified well enough to use.
       */
      kind: "present-unresolved";
      evidence: readonly EvidenceProvenance[];
    }
  | {
      /**
       * Generic approximation: each point is split into weighted copies at
       * offsets in native sensor physical coordinates.
       */
      kind: "normalized-point-splitting-kernel";
      evidence: readonly EvidenceProvenance[];
      coordinateSystem: "native-sensor-physical";
      scope:
        "field-wavelength-polarization-invariant-approximation";
      components: readonly AntiAliasingPointSplitComponent[];
    };

export interface SensorOpticalStackProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  evidence: readonly EvidenceProvenance[];
  /**
   * In order from the side light enters towards the sensor.
   *
   * These components are descriptive metadata only. Their presence does not
   * create transmission, focus-shift, aberration or spectral effects.
   */
  orderedComponents?: readonly SensorOpticalStackComponent[];
  /**
   * Omitted means "unknown, not stated".
   *
   * This is separate from which components are present, so a stack can
   * contain low-pass hardware while its net AA effect is absent or cancelled.
   */
  effectiveAntiAliasingSpatialResponse?: SensorEffectiveAntiAliasingSpatialResponse;
  /**
   * Omitted means "unknown, not stated".
   */
  microlens?: SensorMicrolensDeclaration;
}

export interface ResolvedAntiAliasingSpatialKernel {
  profileId: string;
  effectiveResponse:
    | "absent"
    | "normalized-point-splitting-kernel";
  coordinateSystem: "native-sensor-physical";
  components: readonly AntiAliasingPointSplitComponent[];
  normalizedWeightSum: number;
  throughputIncluded: false;
  spectralTransmissionIncluded: false;
  fieldDependenceIncluded: false;
  wavelengthDependenceIncluded: false;
  polarizationDependenceIncluded: false;
  microlensResponseIncluded: false;
  coverFilterStackEffectsIncluded: false;
  wholeSensorOpticalStackResponse: false;
  provenance: {
    profile: readonly EvidenceProvenance[];
    antiAliasingResponse: readonly EvidenceProvenance[];
  };
}

const COMPONENT_ROLES = new Set<SensorOpticalStackComponentRole>([
  "cover-glass",
  "infrared-cut",
  "ultraviolet-cut",
  "anti-reflection",
  "birefringent-low-pass",
  "wave-plate",
  "other-optical-filter"
]);

function parseComponentRoles(
  value: unknown,
  path: string
): readonly SensorOpticalStackComponentRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      path + " must be a non-empty array."
    );
  }

  const roles = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      !COMPONENT_ROLES.has(
        entry as SensorOpticalStackComponentRole
      )
    ) {
      throw new InvalidConfigurationError(
        path + "[" + index + "] is invalid."
      );
    }
    return entry as SensorOpticalStackComponentRole;
  });

  if (new Set(roles).size !== roles.length) {
    throw new InvalidConfigurationError(
      path + " must not contain duplicate roles."
    );
  }

  return roles;
}

function parseOrderedComponents(
  value: unknown,
  path: string
): readonly SensorOpticalStackComponent[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      path + " must be a non-empty array."
    );
  }

  const components = value.map((entry, index) => {
    const record = requireRecord(
      entry,
      path + "[" + index + "]", ["componentId", "roles", "evidence"]
    );

    return {
      componentId: requireNonEmptyString(
        record.componentId,
        path + "[" + index + "].componentId"
      ),
      roles: parseComponentRoles(
        record.roles,
        path + "[" + index + "].roles"
      ),
      evidence: parseEvidenceList(
        record.evidence,
        path + "[" + index + "].evidence"
      )
    };
  });

  const ids = components.map(
    (component) => component.componentId
  );
  if (new Set(ids).size !== ids.length) {
    throw new InvalidConfigurationError(
      path + " must not contain duplicate componentId values."
    );
  }

  return components;
}

function parsePointSplitComponents(
  value: unknown,
  path: string
): readonly AntiAliasingPointSplitComponent[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      path + " must be a non-empty array."
    );
  }

  const components = value.map((entry, index) => {
    const record = requireRecord(
      entry,
      path + "[" + index + "]", ["offsetMicrometers", "normalizedWeight"]
    );
    const offset = requireRecord(
      record.offsetMicrometers,
      path + "[" + index + "].offsetMicrometers", ["x", "y"]
    );
    const normalizedWeight = requireFiniteNumber(
      record.normalizedWeight,
      path + "[" + index + "].normalizedWeight"
    );

    if (normalizedWeight <= 0) {
      throw new InvalidConfigurationError(
        path +
          "[" +
          index +
          "].normalizedWeight must be greater than zero."
      );
    }

    return {
      offsetMicrometers: {
        x: requireFiniteNumber(
          offset.x,
          path +
            "[" +
            index +
            "].offsetMicrometers.x"
        ),
        y: requireFiniteNumber(
          offset.y,
          path +
            "[" +
            index +
            "].offsetMicrometers.y"
        )
      },
      normalizedWeight
    };
  });

  const weightSum = components.reduce(
    (sum, component) =>
      sum + component.normalizedWeight,
    0
  );

  if (
    !Number.isFinite(weightSum) ||
    Math.abs(weightSum - 1) > 1e-12
  ) {
    throw new InvalidConfigurationError(
      path +
        " normalizedWeight values must sum to 1 within 1e-12."
    );
  }

  return components;
}

function parseAntiAliasingResponse(
  value: unknown,
  path: string
): SensorEffectiveAntiAliasingSpatialResponse {
  const record = requireRecord(value, path, ["kind", "coordinateSystem", "scope", "components", "evidence"]);

  if (
    record.kind === "absent" ||
    record.kind === "present-unresolved"
  ) {
    if (
      record.coordinateSystem !== undefined ||
      record.scope !== undefined ||
      record.components !== undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " absent/present-unresolved responses must omit kernel fields."
      );
    }
    return {
      kind: record.kind,
      evidence: parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
    };
  }

  if (
    record.kind ===
    "normalized-point-splitting-kernel"
  ) {
    if (
      record.coordinateSystem !==
      "native-sensor-physical"
    ) {
      throw new InvalidConfigurationError(
        path +
          '.coordinateSystem must be "native-sensor-physical".'
      );
    }
    if (
      record.scope !==
      "field-wavelength-polarization-invariant-approximation"
    ) {
      throw new InvalidConfigurationError(
        path + ".scope is invalid."
      );
    }

    return {
      kind:
        "normalized-point-splitting-kernel",
      evidence: parseEvidenceList(
        record.evidence,
        path + ".evidence"
      ),
      coordinateSystem:
        "native-sensor-physical",
      scope:
        "field-wavelength-polarization-invariant-approximation",
      components: parsePointSplitComponents(
        record.components,
        path + ".components"
      )
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

function parseMicrolens(
  value: unknown,
  path: string
): SensorMicrolensDeclaration {
  const record = requireRecord(value, path, ["presence", "opticalEffectModel", "evidence"]);

  if (
    record.presence !== "present" &&
    record.presence !== "absent"
  ) {
    throw new InvalidConfigurationError(
      path + ".presence is invalid."
    );
  }

  if (record.opticalEffectModel !== "unresolved") {
    throw new InvalidConfigurationError(
      path +
        '.opticalEffectModel must be "unresolved" in schema 0.1.0.'
    );
  }

  return {
    presence: record.presence,
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    ),
    opticalEffectModel: "unresolved"
  };
}

/**
 * Parses descriptive sensor optical-stack metadata, plus an optional explicitly
 * declared anti-aliasing (AA) spatial response.
 *
 * Leave out unknown facts rather than guessing them. Physical presence of a
 * component is separate from the net AA response, so the schema can describe
 * designs that cancel the AA effect without claiming the hardware is missing.
 *
 * In schema 0.1.0, cover glass, filters and microlenses create no optical
 * effect. Thickness, refractive index, spectral transmission, angle of
 * acceptance, focus shift and microlens collection need later explicit models
 * or calibration.
 */
export function parseSensorOpticalStackProfile(
  value: unknown
): SensorOpticalStackProfile {
  const profile = requireRecord(
    value,
    "sensorOpticalStack", ["schemaVersion", "orderedComponents", "effectiveAntiAliasingSpatialResponse", "microlens", "profileId", "evidence"]
  );

  if (profile.schemaVersion !== "0.1.0") {
    throw new InvalidConfigurationError(
      'sensorOpticalStack.schemaVersion must be "0.1.0".'
    );
  }

  const orderedComponents =
    profile.orderedComponents === undefined
      ? undefined
      : parseOrderedComponents(
          profile.orderedComponents,
          "sensorOpticalStack.orderedComponents"
        );

  const effectiveAntiAliasingSpatialResponse =
    profile.effectiveAntiAliasingSpatialResponse ===
    undefined
      ? undefined
      : parseAntiAliasingResponse(
          profile.effectiveAntiAliasingSpatialResponse,
          "sensorOpticalStack.effectiveAntiAliasingSpatialResponse"
        );

  const microlens =
    profile.microlens === undefined
      ? undefined
      : parseMicrolens(
          profile.microlens,
          "sensorOpticalStack.microlens"
        );

  if (
    orderedComponents === undefined &&
    effectiveAntiAliasingSpatialResponse ===
      undefined &&
    microlens === undefined
  ) {
    throw new InvalidConfigurationError(
      "sensorOpticalStack must assert at least one optical-stack fact."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      profile.profileId,
      "sensorOpticalStack.profileId"
    ),
    evidence: parseEvidenceList(
      profile.evidence,
      "sensorOpticalStack.evidence"
    ),
    ...(orderedComponents === undefined
      ? {}
      : { orderedComponents }),
    ...(effectiveAntiAliasingSpatialResponse ===
    undefined
      ? {}
      : {
          effectiveAntiAliasingSpatialResponse
        }),
    ...(microlens === undefined
      ? {}
      : { microlens })
  };
}

/**
 * Resolves only the anti-aliasing (AA) spatial kernel.
 *
 * This is not the PSF (point-spread function) of the whole optical stack. Cover
 * glass and filter transmission, refraction, microlens behaviour, dependence on
 * field position, wavelength or polarization, and total throughput are excluded.
 *
 * A documented absent AA response gives a single component with weight 1 at zero
 * offset (no blur). An unknown response (field omitted) or one that is present
 * but unspecified is rejected.
 */
export function resolveAntiAliasingSpatialKernel(
  profileInput: SensorOpticalStackProfile
): ResolvedAntiAliasingSpatialKernel {
  const profile =
    parseSensorOpticalStackProfile(
      profileInput
    );
  const response =
    profile.effectiveAntiAliasingSpatialResponse;

  if (response === undefined) {
    throw new InvalidScientificInputError(
      "Effective anti-aliasing spatial response is unknown/unasserted for this optical-stack profile."
    );
  }

  if (response.kind === "present-unresolved") {
    throw new InvalidScientificInputError(
      "Effective anti-aliasing spatial response is present but unresolved; a spatial kernel cannot be produced."
    );
  }

  if (response.kind === "absent") {
    return {
      profileId: profile.profileId,
      effectiveResponse: "absent",
      coordinateSystem:
        "native-sensor-physical",
      components: [
        {
          offsetMicrometers: {
            x: 0,
            y: 0
          },
          normalizedWeight: 1
        }
      ],
      normalizedWeightSum: 1,
      throughputIncluded: false,
      spectralTransmissionIncluded: false,
      fieldDependenceIncluded: false,
      wavelengthDependenceIncluded: false,
      polarizationDependenceIncluded: false,
      microlensResponseIncluded: false,
      coverFilterStackEffectsIncluded: false,
      wholeSensorOpticalStackResponse: false,
      provenance: {
        profile: profile.evidence,
        antiAliasingResponse:
          response.evidence
      }
    };
  }

  const normalizedWeightSum =
    response.components.reduce(
      (sum, component) =>
        sum + component.normalizedWeight,
      0
    );

  return {
    profileId: profile.profileId,
    effectiveResponse:
      "normalized-point-splitting-kernel",
    coordinateSystem:
      "native-sensor-physical",
    components: response.components.map(
      (component) => ({
        offsetMicrometers: {
          ...component.offsetMicrometers
        },
        normalizedWeight:
          component.normalizedWeight
      })
    ),
    normalizedWeightSum,
    throughputIncluded: false,
    spectralTransmissionIncluded: false,
    fieldDependenceIncluded: false,
    wavelengthDependenceIncluded: false,
    polarizationDependenceIncluded: false,
    microlensResponseIncluded: false,
    coverFilterStackEffectsIncluded: false,
    wholeSensorOpticalStackResponse: false,
    provenance: {
      profile: profile.evidence,
      antiAliasingResponse:
        response.evidence
    }
  };
}
