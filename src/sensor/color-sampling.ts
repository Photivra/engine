// SPDX-License-Identifier: Apache-2.0

/**
 * Colour-sampling layout: which colour channel each sensor site measures. Examples are monochrome,
 * a repeating mosaic such as a Bayer CFA (colour filter array), or a layered (stacked) sensor.
 *
 * Sites form an abstract grid with zero-based integer indices, origin at the top left, +X right and
 * +Y down. A site is not necessarily one physical photodiode. The mosaic's repeat pattern is fixed to
 * this grid, so later crops or orientation changes must keep the original native site indices.
 * Layered layouts are described structurally only, because real layered sensors may sample each layer
 * at different densities or offsets.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigPositiveSafeInteger as requirePositiveSafeInteger } from "../core/record-validation.js";


export type NativeColorSamplingSiteCoordinateSystem =
  "native-sensor-color-sampling-site-index";

export type SensorColorSamplingProfileCoordinateSystem =
  | NativeColorSamplingSiteCoordinateSystem
  | "native-sensor-layered-spatial-relationship-not-resolved";

export interface NativeColorSamplingSiteIndex {
  /**
   * Zero-based integer site index from the native sensor's left edge.
   *
   * It indexes the abstract grid of colour-sampling sites. It is not a
   * NativeImageRaster coordinate and does not claim one site is one physical
   * photodiode.
   */
  x: number;
  /**
   * Zero-based integer site index from the native sensor's top edge.
   *
   * +Y points downward in native sensor-facing coordinates.
   */
  y: number;
}

export interface MonochromeColorSamplingLayout {
  kind: "monochrome";
  /**
   * A name for the measured channel only. It is not a spectral response
   * curve, wavelength, colour primary or calibration.
   */
  channelId: string;
}

export interface PeriodicMosaicColorSamplingLayout {
  kind: "periodic-mosaic";
  /**
   * Number of color-sampling sites in one horizontal repeat period.
   */
  repeatWidthSites: number;
  /**
   * Number of color-sampling sites in one vertical repeat period.
   */
  repeatHeightSites: number;
  /**
   * Channel IDs for one repeating tile, in row-major order.
   *
   * Length must equal repeatWidthSites × repeatHeightSites.
   */
  siteChannelIds: readonly string[];
  /**
   * The repeat tile starts at native sensor site (0, 0).
   *
   * Active-area crops and camera orientation must not silently reset this phase.
   */
  anchor: "native-sensor-top-left-site";
}

export interface LayeredColorSamplingLayout {
  kind: "layered";
  /**
   * Names for the layers or channels only. They do not define spectral
   * response, depth order, sampling density or alignment between layers.
   */
  layerChannelIds: readonly string[];
  /**
   * Layered layouts are described structurally only for now, because real
   * layered sensors may sample each layer differently.
   */
  spatialSamplingRelationship: "not-resolved";
}

export type SensorColorSamplingLayout =
  | MonochromeColorSamplingLayout
  | PeriodicMosaicColorSamplingLayout
  | LayeredColorSamplingLayout;

export interface SensorColorSamplingProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  /**
   * Evidence for this exact layout.
   *
   * Descriptive sensor-architecture metadata is a separate type.
   */
  evidence: readonly EvidenceProvenance[];
  coordinateSystem: SensorColorSamplingProfileCoordinateSystem;
  layout: SensorColorSamplingLayout;
}

export interface ResolveColorSamplingSiteInput {
  profile: SensorColorSamplingProfile;
  site: NativeColorSamplingSiteIndex;
}

export interface ResolvedColorSamplingSite {
  profileId: string;
  coordinateSystem: NativeColorSamplingSiteCoordinateSystem;
  site: NativeColorSamplingSiteIndex;
  mapping:
    | {
        kind: "monochrome";
        channelId: string;
      }
    | {
        kind: "periodic-mosaic";
        channelId: string;
        repeatCoordinate: {
          x: number;
          y: number;
        };
        repeatWidthSites: number;
        repeatHeightSites: number;
      };
  /**
   * States what this profile does not establish, for downstream code.
   */
  spectralResponseEstablished: false;
  nativeImageRasterBindingEstablished: false;
  physicalPhotodiodeBindingEstablished: false;
}

function parseChannelIds(
  value: unknown,
  path: string,
  options: {
    allowDuplicates: boolean;
    exactLength?: number;
  }
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidConfigurationError(
      path + " must be a non-empty array."
    );
  }

  if (
    options.exactLength !== undefined &&
    value.length !== options.exactLength
  ) {
    throw new InvalidConfigurationError(
      path +
        " length must equal the declared repeating-tile site count."
    );
  }

  const ids = value.map((entry, index) =>
    requireNonEmptyString(
      entry,
      path + "[" + index + "]"
    )
  );

  if (
    !options.allowDuplicates &&
    new Set(ids).size !== ids.length
  ) {
    throw new InvalidConfigurationError(
      path + " must not contain duplicate channel IDs."
    );
  }

  return ids;
}

function parseLayout(
  value: unknown,
  path: string
): SensorColorSamplingLayout {
  const record = requireRecord(value, path, ["kind", "repeatWidthSites", "repeatHeightSites", "siteChannelIds", "anchor", "layerChannelIds", "spatialSamplingRelationship", "channelId"]);

  if (record.kind === "monochrome") {
    if (
      record.repeatWidthSites !== undefined ||
      record.repeatHeightSites !== undefined ||
      record.siteChannelIds !== undefined ||
      record.anchor !== undefined ||
      record.layerChannelIds !== undefined ||
      record.spatialSamplingRelationship !== undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " monochrome layout must omit mosaic/layered fields."
      );
    }

    return {
      kind: "monochrome",
      channelId: requireNonEmptyString(
        record.channelId,
        path + ".channelId"
      )
    };
  }

  if (record.kind === "periodic-mosaic") {
    if (
      record.channelId !== undefined ||
      record.layerChannelIds !== undefined ||
      record.spatialSamplingRelationship !== undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " periodic-mosaic layout must omit monochrome/layered fields."
      );
    }

    const repeatWidthSites =
      requirePositiveSafeInteger(
        record.repeatWidthSites,
        path + ".repeatWidthSites"
      );
    const repeatHeightSites =
      requirePositiveSafeInteger(
        record.repeatHeightSites,
        path + ".repeatHeightSites"
      );
    const repeatSiteCount =
      repeatWidthSites * repeatHeightSites;

    if (!Number.isSafeInteger(repeatSiteCount)) {
      throw new InvalidConfigurationError(
        path +
          " repeating-tile site count must be a safe integer."
      );
    }

    if (record.anchor !== "native-sensor-top-left-site") {
      throw new InvalidConfigurationError(
        path +
          '.anchor must be "native-sensor-top-left-site".'
      );
    }

    return {
      kind: "periodic-mosaic",
      repeatWidthSites,
      repeatHeightSites,
      siteChannelIds: parseChannelIds(
        record.siteChannelIds,
        path + ".siteChannelIds",
        {
          allowDuplicates: true,
          exactLength: repeatSiteCount
        }
      ),
      anchor: "native-sensor-top-left-site"
    };
  }

  if (record.kind === "layered") {
    if (
      record.channelId !== undefined ||
      record.repeatWidthSites !== undefined ||
      record.repeatHeightSites !== undefined ||
      record.siteChannelIds !== undefined ||
      record.anchor !== undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " layered layout must omit monochrome/mosaic fields."
      );
    }

    if (
      record.spatialSamplingRelationship !==
      "not-resolved"
    ) {
      throw new InvalidConfigurationError(
        path +
          '.spatialSamplingRelationship must be "not-resolved" for the first layered contract.'
      );
    }

    return {
      kind: "layered",
      layerChannelIds: parseChannelIds(
        record.layerChannelIds,
        path + ".layerChannelIds",
        {
          allowDuplicates: false
        }
      ),
      spatialSamplingRelationship: "not-resolved"
    };
  }

  throw new InvalidConfigurationError(
    path + ".kind is invalid."
  );
}

/**
 * Parses an exact colour-sampling layout. It is not tied to NativeImageRaster,
 * physical photodiodes, spectral response or a manufacturer's layout name.
 *
 * Repeating mosaics use an abstract grid of native sensor sites with zero-based
 * integer indices, origin at the top left, +X right and +Y down. The repeat
 * pattern is fixed to this grid, so later crops or orientation changes must keep
 * the original native site indices.
 *
 * Layered layouts are described structurally only, because real layered sensors
 * may sample each layer at different densities or offsets. There is no per-site
 * lookup for layered layouts until that is modelled explicitly.
 */
export function parseSensorColorSamplingProfile(
  value: unknown
): SensorColorSamplingProfile {
  const profile = requireRecord(
    value,
    "sensorColorSampling", ["schemaVersion", "layout", "coordinateSystem", "profileId", "evidence"]
  );

  if (profile.schemaVersion !== "0.1.0") {
    throw new InvalidConfigurationError(
      'sensorColorSampling.schemaVersion must be "0.1.0".'
    );
  }

  const layout = parseLayout(
    profile.layout,
    "sensorColorSampling.layout"
  );

  const expectedCoordinateSystem =
    layout.kind === "layered"
      ? "native-sensor-layered-spatial-relationship-not-resolved"
      : "native-sensor-color-sampling-site-index";

  if (
    profile.coordinateSystem !==
    expectedCoordinateSystem
  ) {
    throw new InvalidConfigurationError(
      "sensorColorSampling.coordinateSystem does not match the declared layout kind."
    );
  }

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      profile.profileId,
      "sensorColorSampling.profileId"
    ),
    evidence: parseEvidenceList(
      profile.evidence,
      "sensorColorSampling.evidence"
    ),
    coordinateSystem: expectedCoordinateSystem,
    layout
  };
}

function requireNativeSiteIndex(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new InvalidScientificInputError(
      path +
        " must be a non-negative safe integer native color-sampling-site index."
    );
  }
  return value;
}

/**
 * Returns which channel one native site measures, for monochrome or repeating
 * mosaic layouts.
 *
 * It deliberately takes no NativeImageRaster. A separate binding
 * (capture-color-sampling-binding) must say how a capture mode's sample grid
 * maps onto this site grid before RAW or CFA sampling can be simulated.
 *
 * Layered layouts are rejected, because how their layers line up spatially is
 * not defined yet.
 */
export function resolveColorSamplingSite(
  input: ResolveColorSamplingSiteInput
): ResolvedColorSamplingSite {
  requireInputKeys(input, "resolveColorSamplingSite", ["profile", "site"]);
  const profile =
    parseSensorColorSamplingProfile(input.profile);

  if (
    typeof input.site !== "object" ||
    input.site === null
  ) {
    throw new InvalidConfigurationError(
      "site must be an object."
    );
  }

  const x = requireNativeSiteIndex(
    input.site.x,
    "site.x"
  );
  const y = requireNativeSiteIndex(
    input.site.y,
    "site.y"
  );

  if (profile.layout.kind === "layered") {
    throw new InvalidScientificInputError(
      "Layered color sampling is structural-only in schema 0.1.0; per-site resolution requires an explicit per-layer spatial sampling relationship."
    );
  }

  if (
    profile.coordinateSystem !==
    "native-sensor-color-sampling-site-index"
  ) {
    throw new InvalidScientificInputError(
      "Resolvable color sampling requires the native sensor color-sampling-site coordinate system."
    );
  }

  if (profile.layout.kind === "monochrome") {
    return {
      profileId: profile.profileId,
      coordinateSystem: profile.coordinateSystem,
      site: { x, y },
      mapping: {
        kind: "monochrome",
        channelId: profile.layout.channelId
      },
      spectralResponseEstablished: false,
      nativeImageRasterBindingEstablished: false,
      physicalPhotodiodeBindingEstablished: false
    };
  }

  const repeatX =
    x % profile.layout.repeatWidthSites;
  const repeatY =
    y % profile.layout.repeatHeightSites;
  const index =
    repeatY * profile.layout.repeatWidthSites +
    repeatX;
  const channelId =
    profile.layout.siteChannelIds[index];

  if (channelId === undefined) {
    throw new InvalidScientificInputError(
      "Periodic color-sampling tile resolution failed."
    );
  }

  return {
    profileId: profile.profileId,
    coordinateSystem: profile.coordinateSystem,
    site: { x, y },
    mapping: {
      kind: "periodic-mosaic",
      channelId,
      repeatCoordinate: {
        x: repeatX,
        y: repeatY
      },
      repeatWidthSites:
        profile.layout.repeatWidthSites,
      repeatHeightSites:
        profile.layout.repeatHeightSites
    },
    spectralResponseEstablished: false,
    nativeImageRasterBindingEstablished: false,
    physicalPhotodiodeBindingEstablished: false
  };
}
