// SPDX-License-Identifier: Apache-2.0

/**
 * Sampling aperture: where the colour-sampling sites sit physically on the sensor, and the
 * light-sensitive area of each site as a simple geometric shape.
 *
 * Site pitch and origin are declared facts, never derived from NativeImageRaster. The sensitive
 * region, when known, is a plain geometric rectangle. It does not include microlens effects, charge
 * diffusion, electrical crosstalk, QE (quantum efficiency), throughput, spectral response or an
 * effective light-collection area.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  resolveNativeEffectiveRasterColorSamplingBinding,
  type NativeEffectiveRasterColorSamplingBindingProfile
} from "./capture-color-sampling-binding.js";
import {
  resolveColorSamplingSite,
  type NativeColorSamplingSiteIndex,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import type {
  NativeImageRaster,
  SensorImagingArea
} from "./sensor-geometry.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigFiniteNumber as requireFinite } from "../core/record-validation.js";


export interface SensorSiteCenterLatticeRegistration {
  kind: "regular-rectangular-site-center-lattice";
  coordinateSystem: "native-sensor-physical";
  /** Horizontal centre-to-centre site spacing (pitch) in micrometres. */
  pitchXMicrometers: number;
  /** Vertical centre-to-centre site spacing (pitch) in micrometres. */
  pitchYMicrometers: number;
  /**
   * Centre of the first site, measured from the imaging area's physical
   * top-left corner. +X right, +Y down. Units: micrometres.
   */
  firstSiteCenterFromImagingAreaTopLeftMicrometers: {
    x: number;
    y: number;
  };
  evidence: readonly EvidenceProvenance[];
}

export type SensorGeometricSensitiveAperture =
  | {
      /**
       * The light-sensitive area is known to matter, but its shape is not
       * known well enough to use.
       */
      kind: "unresolved";
      evidence: readonly EvidenceProvenance[];
    }
  | {
      /**
       * A simple approximation of the sensitive area as a rectangle.
       *
       * The rectangle must stay inside one grid cell, so neighbouring
       * sensitive areas never overlap in schema 0.1.0.
       */
      kind: "uniform-axis-aligned-rectangle";
      widthMicrometers: number;
      heightMicrometers: number;
      centerOffsetFromSiteCenterMicrometers: {
        x: number;
        y: number;
      };
      evidence: readonly EvidenceProvenance[];
    };

export interface SensorSamplingApertureProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  colorSamplingBindingId: string;
  evidence: readonly EvidenceProvenance[];
  siteCenterLattice: SensorSiteCenterLatticeRegistration;
  geometricSensitiveAperture: SensorGeometricSensitiveAperture;
}

export interface ResolveSensorSamplingApertureInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  colorSamplingProfile: SensorColorSamplingProfile;
  colorSamplingBindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  samplingApertureProfile: SensorSamplingApertureProfile;
  site: NativeColorSamplingSiteIndex;
}

export interface NativeSensorPhysicalPointMm {
  x: number;
  y: number;
}

export interface NativeSensorPhysicalBoundsMm {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ResolvedSensorSamplingAperture {
  profileId: string;
  colorSamplingProfileId: string;
  colorSamplingBindingId: string;
  coordinateSystem: "native-sensor-physical";
  site: NativeColorSamplingSiteIndex;
  channelId: string;
  siteGrid: {
    widthSites: number;
    heightSites: number;
  };
  lattice: {
    pitchXMicrometers: number;
    pitchYMicrometers: number;
    firstSiteCenterFromImagingAreaTopLeftMicrometers: {
      x: number;
      y: number;
    };
    siteCenterFromImagingAreaTopLeftMicrometers: {
      x: number;
      y: number;
    };
    siteCenterFromOpticalAxisMm: NativeSensorPhysicalPointMm;
    nominalCellAreaSquareMicrometers: number;
  };
  geometricSensitiveAperture: {
    kind: "uniform-axis-aligned-rectangle";
    widthMicrometers: number;
    heightMicrometers: number;
    centerOffsetFromSiteCenterMicrometers: {
      x: number;
      y: number;
    };
    centerFromOpticalAxisMm: NativeSensorPhysicalPointMm;
    boundsFromOpticalAxisMm: NativeSensorPhysicalBoundsMm;
    areaSquareMicrometers: number;
    geometricSensitiveAreaFractionOfLatticeCell: number;
    spatialWeighting:
      "uniform-unit-area-average";
    neighboringGeometricApertureOverlap:
      "none-by-model";
  };
  /**
   * Fixed statements of what this result does not establish.
   */
  sitePitchDerivedFromNativeImageRaster: false;
  apertureDerivedFromSitePitch: false;
  antiAliasingResponseIncluded: false;
  microlensSpatialRedistributionIncluded: false;
  chargeDiffusionIncluded: false;
  electricalCrosstalkIncluded: false;
  spectralResponseIncluded: false;
  quantumEfficiencyIncluded: false;
  opticalThroughputIncluded: false;
  radiometricCollectionAreaEstablished: false;
  physicalPhotodiodeGeometryEstablished: false;
  provenance: {
    profile: readonly EvidenceProvenance[];
    lattice: readonly EvidenceProvenance[];
    aperture: readonly EvidenceProvenance[];
  };
}

function requirePositiveFinite(
  value: unknown,
  path: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new InvalidConfigurationError(
      path +
        " must be a finite number greater than zero."
    );
  }
  return value;
}

function parseSiteCenterLattice(
  value: unknown,
  path: string
): SensorSiteCenterLatticeRegistration {
  const record = requireRecord(value, path, ["kind", "coordinateSystem", "firstSiteCenterFromImagingAreaTopLeftMicrometers", "pitchXMicrometers", "pitchYMicrometers", "evidence"]);

  if (
    record.kind !==
    "regular-rectangular-site-center-lattice"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }
  if (
    record.coordinateSystem !==
    "native-sensor-physical"
  ) {
    throw new InvalidConfigurationError(
      path +
        '.coordinateSystem must be "native-sensor-physical".'
    );
  }

  const firstCenter = requireRecord(
    record.firstSiteCenterFromImagingAreaTopLeftMicrometers,
    path +
      ".firstSiteCenterFromImagingAreaTopLeftMicrometers", ["x", "y"]
  );

  const firstX = requireFinite(
    firstCenter.x,
    path +
      ".firstSiteCenterFromImagingAreaTopLeftMicrometers.x"
  );
  const firstY = requireFinite(
    firstCenter.y,
    path +
      ".firstSiteCenterFromImagingAreaTopLeftMicrometers.y"
  );

  if (firstX < 0 || firstY < 0) {
    throw new InvalidConfigurationError(
      path +
        ".firstSiteCenterFromImagingAreaTopLeftMicrometers must not be negative."
    );
  }

  return {
    kind:
      "regular-rectangular-site-center-lattice",
    coordinateSystem:
      "native-sensor-physical",
    pitchXMicrometers:
      requirePositiveFinite(
        record.pitchXMicrometers,
        path + ".pitchXMicrometers"
      ),
    pitchYMicrometers:
      requirePositiveFinite(
        record.pitchYMicrometers,
        path + ".pitchYMicrometers"
      ),
    firstSiteCenterFromImagingAreaTopLeftMicrometers:
      {
        x: firstX,
        y: firstY
      },
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

function parseGeometricSensitiveAperture(
  value: unknown,
  path: string,
  lattice: SensorSiteCenterLatticeRegistration
): SensorGeometricSensitiveAperture {
  const record = requireRecord(value, path, ["kind", "widthMicrometers", "heightMicrometers", "centerOffsetFromSiteCenterMicrometers", "evidence"]);

  if (record.kind === "unresolved") {
    if (
      record.widthMicrometers !== undefined ||
      record.heightMicrometers !== undefined ||
      record.centerOffsetFromSiteCenterMicrometers !==
        undefined
    ) {
      throw new InvalidConfigurationError(
        path +
          " unresolved aperture must omit rectangle fields."
      );
    }
    return {
      kind: "unresolved",
      evidence: parseEvidenceList(
        record.evidence,
        path + ".evidence"
      )
    };
  }

  if (
    record.kind !==
    "uniform-axis-aligned-rectangle"
  ) {
    throw new InvalidConfigurationError(
      path + ".kind is invalid."
    );
  }

  const widthMicrometers =
    requirePositiveFinite(
      record.widthMicrometers,
      path + ".widthMicrometers"
    );
  const heightMicrometers =
    requirePositiveFinite(
      record.heightMicrometers,
      path + ".heightMicrometers"
    );
  const offset = requireRecord(
    record.centerOffsetFromSiteCenterMicrometers,
    path +
      ".centerOffsetFromSiteCenterMicrometers", ["x", "y"]
  );
  const offsetX = requireFinite(
    offset.x,
    path +
      ".centerOffsetFromSiteCenterMicrometers.x"
  );
  const offsetY = requireFinite(
    offset.y,
    path +
      ".centerOffsetFromSiteCenterMicrometers.y"
  );

  const halfCellX =
    lattice.pitchXMicrometers / 2;
  const halfCellY =
    lattice.pitchYMicrometers / 2;

  if (
    Math.abs(offsetX) +
      widthMicrometers / 2 >
      halfCellX ||
    Math.abs(offsetY) +
      heightMicrometers / 2 >
      halfCellY
  ) {
    throw new InvalidConfigurationError(
      path +
        " rectangle must remain within one regular site lattice cell."
    );
  }

  return {
    kind:
      "uniform-axis-aligned-rectangle",
    widthMicrometers,
    heightMicrometers,
    centerOffsetFromSiteCenterMicrometers:
      {
        x: offsetX,
        y: offsetY
      },
    evidence: parseEvidenceList(
      record.evidence,
      path + ".evidence"
    )
  };
}

/**
 * Parses where the colour-sampling sites sit physically, plus a simple geometric
 * model of each site's light-sensitive area.
 *
 * Site pitch and origin are declared facts, never derived from NativeImageRaster.
 * The rectangle, when given, is a geometric sensitive region only. It does not
 * include microlens effects, charge diffusion, electrical crosstalk, QE,
 * throughput, spectral response or an effective light-collection area.
 */
export function parseSensorSamplingApertureProfile(
  value: unknown
): SensorSamplingApertureProfile {
  const profile = requireRecord(
    value,
    "sensorSamplingAperture", ["schemaVersion", "siteCenterLattice", "profileId", "colorSamplingProfileId", "colorSamplingBindingId", "evidence", "geometricSensitiveAperture"]
  );

  if (profile.schemaVersion !== "0.1.0") {
    throw new InvalidConfigurationError(
      'sensorSamplingAperture.schemaVersion must be "0.1.0".'
    );
  }

  const siteCenterLattice =
    parseSiteCenterLattice(
      profile.siteCenterLattice,
      "sensorSamplingAperture.siteCenterLattice"
    );

  return {
    schemaVersion: "0.1.0",
    profileId: requireNonEmptyString(
      profile.profileId,
      "sensorSamplingAperture.profileId"
    ),
    colorSamplingProfileId:
      requireNonEmptyString(
        profile.colorSamplingProfileId,
        "sensorSamplingAperture.colorSamplingProfileId"
      ),
    colorSamplingBindingId:
      requireNonEmptyString(
        profile.colorSamplingBindingId,
        "sensorSamplingAperture.colorSamplingBindingId"
      ),
    evidence: parseEvidenceList(
      profile.evidence,
      "sensorSamplingAperture.evidence"
    ),
    siteCenterLattice,
    geometricSensitiveAperture:
      parseGeometricSensitiveAperture(
        profile.geometricSensitiveAperture,
        "sensorSamplingAperture.geometricSensitiveAperture",
        siteCenterLattice
      )
  };
}

function requireSiteIndex(
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
        " must be a non-negative safe integer color-sampling-site index."
    );
  }
  return value;
}

/**
 * Relative rounding allowance for the lattice and aperture fit tests against the imaging area.
 *
 * The imaging extent (`widthMm · 1000`) and the far aperture edge (first centre + (n − 1)·pitch +
 * offset + width/2) reach the same real number through different chains of at most about eight
 * IEEE-754 double operations, each with a relative rounding error of at most ε/2 of a magnitude no
 * larger than the extent. A geometry that fits exactly can therefore miss by a few units in the last
 * place: a 34-site row of 9.287925696594426 µm sites gives 315.78947368421046 µm of imaging width but
 * a far aperture edge at 315.7894736842105 µm. The fit tests allow 8 ε of the extent (about 1.8e-15
 * relative; 5e-11 µm on a 30 mm sensor), far below any physical aperture difference, and still reject
 * every genuinely oversized lattice or aperture.
 */
export const APERTURE_FIT_RELATIVE_TOLERANCE = 8 * Number.EPSILON;

/** The fit-test allowance in micrometres for an imaging extent in micrometres. */
export function apertureFitAllowanceMicrometers(extentMicrometers: number): number {
  return APERTURE_FIT_RELATIVE_TOLERANCE * extentMicrometers;
}

function requirePositiveImagingArea(
  imagingArea: SensorImagingArea
): void {
  requireInputObject(imagingArea, "imagingArea input");
  if (
    !Number.isFinite(imagingArea.widthMm) ||
    imagingArea.widthMm <= 0 ||
    !Number.isFinite(imagingArea.heightMm) ||
    imagingArea.heightMm <= 0
  ) {
    throw new InvalidScientificInputError(
      "imagingArea width/height must be finite and greater than zero."
    );
  }
}

/**
 * Resolves one site's geometric sampling aperture in native sensor physical space.
 *
 * The result is a normalized footprint that averages evenly over its area, for
 * image sampling, plus its physical area and fill fraction. That geometric area
 * is deliberately not treated as light-collection efficiency or as the true
 * photodiode shape.
 */
export function resolveSensorSamplingAperture(
  input: ResolveSensorSamplingApertureInput
): ResolvedSensorSamplingAperture {
  requireInputKeys(input, "resolveSensorSamplingAperture", ["imagingArea", "nativeRaster", "colorSamplingProfile", "colorSamplingBindingProfile", "samplingApertureProfile", "site"]);
  requirePositiveImagingArea(
    input.imagingArea
  );

  const profile =
    parseSensorSamplingApertureProfile(
      input.samplingApertureProfile
    );
  const binding =
    resolveNativeEffectiveRasterColorSamplingBinding(
      {
        nativeRaster: input.nativeRaster,
        colorSamplingProfile:
          input.colorSamplingProfile,
        bindingProfile:
          input.colorSamplingBindingProfile
      }
    );

  if (
    profile.colorSamplingProfileId !==
    binding.colorSamplingProfileId
  ) {
    throw new InvalidScientificInputError(
      "Sampling-aperture colorSamplingProfileId must match the resolved color-sampling profile."
    );
  }
  if (
    profile.colorSamplingBindingId !==
    binding.bindingId
  ) {
    throw new InvalidScientificInputError(
      "Sampling-aperture colorSamplingBindingId must match the resolved color-sampling binding."
    );
  }

  if (
    profile.geometricSensitiveAperture.kind ===
    "unresolved"
  ) {
    throw new InvalidScientificInputError(
      "Geometric sensitive aperture is unresolved; a spatial sampling aperture cannot be produced."
    );
  }

  const siteX = requireSiteIndex(
    input.site.x,
    "site.x"
  );
  const siteY = requireSiteIndex(
    input.site.y,
    "site.y"
  );

  if (
    siteX >=
      binding.colorSamplingSiteGrid.widthSites ||
    siteY >=
      binding.colorSamplingSiteGrid.heightSites
  ) {
    throw new InvalidScientificInputError(
      "site must lie within the bound color-sampling site grid."
    );
  }

  const lattice =
    profile.siteCenterLattice;
  const gridWidth =
    binding.colorSamplingSiteGrid.widthSites;
  const gridHeight =
    binding.colorSamplingSiteGrid.heightSites;
  const imagingWidthMicrometers =
    input.imagingArea.widthMm * 1000;
  const imagingHeightMicrometers =
    input.imagingArea.heightMm * 1000;

  const lastCenterX =
    lattice
      .firstSiteCenterFromImagingAreaTopLeftMicrometers
      .x +
    (gridWidth - 1) *
      lattice.pitchXMicrometers;
  const lastCenterY =
    lattice
      .firstSiteCenterFromImagingAreaTopLeftMicrometers
      .y +
    (gridHeight - 1) *
      lattice.pitchYMicrometers;

  const allowanceX = apertureFitAllowanceMicrometers(
    imagingWidthMicrometers
  );
  const allowanceY = apertureFitAllowanceMicrometers(
    imagingHeightMicrometers
  );

  if (
    lastCenterX > imagingWidthMicrometers + allowanceX ||
    lastCenterY > imagingHeightMicrometers + allowanceY
  ) {
    throw new InvalidScientificInputError(
      "Declared site-center lattice extends beyond the supplied physical imaging area."
    );
  }

  const aperture =
    profile.geometricSensitiveAperture;
  const apertureOffsetX =
    aperture.centerOffsetFromSiteCenterMicrometers.x;
  const apertureOffsetY =
    aperture.centerOffsetFromSiteCenterMicrometers.y;
  const apertureHalfWidth =
    aperture.widthMicrometers / 2;
  const apertureHalfHeight =
    aperture.heightMicrometers / 2;

  const firstApertureLeft =
    lattice.firstSiteCenterFromImagingAreaTopLeftMicrometers.x +
    apertureOffsetX -
    apertureHalfWidth;
  const firstApertureTop =
    lattice.firstSiteCenterFromImagingAreaTopLeftMicrometers.y +
    apertureOffsetY -
    apertureHalfHeight;
  const lastApertureRight =
    lastCenterX +
    apertureOffsetX +
    apertureHalfWidth;
  const lastApertureBottom =
    lastCenterY +
    apertureOffsetY +
    apertureHalfHeight;

  if (
    firstApertureLeft < -allowanceX ||
    firstApertureTop < -allowanceY ||
    lastApertureRight >
      imagingWidthMicrometers + allowanceX ||
    lastApertureBottom >
      imagingHeightMicrometers + allowanceY
  ) {
    throw new InvalidScientificInputError(
      "Declared geometric sensitive aperture does not fit within the supplied physical imaging area across the complete site grid."
    );
  }

  const siteCenterFromTopLeftX =
    lattice
      .firstSiteCenterFromImagingAreaTopLeftMicrometers
      .x +
    siteX * lattice.pitchXMicrometers;
  const siteCenterFromTopLeftY =
    lattice
      .firstSiteCenterFromImagingAreaTopLeftMicrometers
      .y +
    siteY * lattice.pitchYMicrometers;

  const apertureCenterFromTopLeftX =
    siteCenterFromTopLeftX +
    aperture
      .centerOffsetFromSiteCenterMicrometers
      .x;
  const apertureCenterFromTopLeftY =
    siteCenterFromTopLeftY +
    aperture
      .centerOffsetFromSiteCenterMicrometers
      .y;
  const apertureLeftTopX =
    apertureCenterFromTopLeftX -
    aperture.widthMicrometers / 2;
  const apertureRightBottomX =
    apertureCenterFromTopLeftX +
    aperture.widthMicrometers / 2;
  const apertureLeftTopY =
    apertureCenterFromTopLeftY -
    aperture.heightMicrometers / 2;
  const apertureRightBottomY =
    apertureCenterFromTopLeftY +
    aperture.heightMicrometers / 2;

  if (
    apertureLeftTopX < -allowanceX ||
    apertureLeftTopY < -allowanceY ||
    apertureRightBottomX >
      imagingWidthMicrometers + allowanceX ||
    apertureRightBottomY >
      imagingHeightMicrometers + allowanceY
  ) {
    throw new InvalidScientificInputError(
      "Resolved geometric sensitive aperture extends beyond the supplied physical imaging area."
    );
  }

  const siteCenterFromOpticalAxisMm = {
    x:
      -input.imagingArea.widthMm / 2 +
      siteCenterFromTopLeftX / 1000,
    y:
      -input.imagingArea.heightMm / 2 +
      siteCenterFromTopLeftY / 1000
  };
  const apertureCenterFromOpticalAxisMm = {
    x:
      -input.imagingArea.widthMm / 2 +
      apertureCenterFromTopLeftX / 1000,
    y:
      -input.imagingArea.heightMm / 2 +
      apertureCenterFromTopLeftY / 1000
  };
  const boundsFromOpticalAxisMm = {
    left:
      -input.imagingArea.widthMm / 2 +
      apertureLeftTopX / 1000,
    right:
      -input.imagingArea.widthMm / 2 +
      apertureRightBottomX / 1000,
    top:
      -input.imagingArea.heightMm / 2 +
      apertureLeftTopY / 1000,
    bottom:
      -input.imagingArea.heightMm / 2 +
      apertureRightBottomY / 1000
  };

  const areaSquareMicrometers =
    aperture.widthMicrometers *
    aperture.heightMicrometers;
  const nominalCellAreaSquareMicrometers =
    lattice.pitchXMicrometers *
    lattice.pitchYMicrometers;
  const geometricSensitiveAreaFractionOfLatticeCell =
    areaSquareMicrometers /
    nominalCellAreaSquareMicrometers;

  if (
    !Number.isFinite(areaSquareMicrometers) ||
    !Number.isFinite(
      nominalCellAreaSquareMicrometers
    ) ||
    !Number.isFinite(
      geometricSensitiveAreaFractionOfLatticeCell
    )
  ) {
    throw new InvalidScientificInputError(
      "Derived sampling-aperture geometry must remain finite."
    );
  }

  const channel =
    resolveColorSamplingSite({
      profile: input.colorSamplingProfile,
      site: {
        x: siteX,
        y: siteY
      }
    });

  return {
    profileId: profile.profileId,
    colorSamplingProfileId:
      profile.colorSamplingProfileId,
    colorSamplingBindingId:
      profile.colorSamplingBindingId,
    coordinateSystem:
      "native-sensor-physical",
    site: {
      x: siteX,
      y: siteY
    },
    channelId: channel.mapping.channelId,
    siteGrid: {
      widthSites: gridWidth,
      heightSites: gridHeight
    },
    lattice: {
      pitchXMicrometers:
        lattice.pitchXMicrometers,
      pitchYMicrometers:
        lattice.pitchYMicrometers,
      firstSiteCenterFromImagingAreaTopLeftMicrometers:
        {
          ...lattice
            .firstSiteCenterFromImagingAreaTopLeftMicrometers
        },
      siteCenterFromImagingAreaTopLeftMicrometers:
        {
          x: siteCenterFromTopLeftX,
          y: siteCenterFromTopLeftY
        },
      siteCenterFromOpticalAxisMm,
      nominalCellAreaSquareMicrometers
    },
    geometricSensitiveAperture: {
      kind:
        "uniform-axis-aligned-rectangle",
      widthMicrometers:
        aperture.widthMicrometers,
      heightMicrometers:
        aperture.heightMicrometers,
      centerOffsetFromSiteCenterMicrometers:
        {
          ...aperture
            .centerOffsetFromSiteCenterMicrometers
        },
      centerFromOpticalAxisMm:
        apertureCenterFromOpticalAxisMm,
      boundsFromOpticalAxisMm,
      areaSquareMicrometers,
      geometricSensitiveAreaFractionOfLatticeCell,
      spatialWeighting:
        "uniform-unit-area-average",
      neighboringGeometricApertureOverlap:
        "none-by-model"
    },
    sitePitchDerivedFromNativeImageRaster:
      false,
    apertureDerivedFromSitePitch: false,
    antiAliasingResponseIncluded: false,
    microlensSpatialRedistributionIncluded:
      false,
    chargeDiffusionIncluded: false,
    electricalCrosstalkIncluded: false,
    spectralResponseIncluded: false,
    quantumEfficiencyIncluded: false,
    opticalThroughputIncluded: false,
    radiometricCollectionAreaEstablished:
      false,
    physicalPhotodiodeGeometryEstablished:
      false,
    provenance: {
      profile: profile.evidence,
      lattice: lattice.evidence,
      aperture: aperture.evidence
    }
  };
}
