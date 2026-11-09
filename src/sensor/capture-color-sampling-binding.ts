// SPDX-License-Identifier: Apache-2.0

/**
 * Links the sensor's native image pixel grid to its grid of colour-sampling sites (for example the
 * cells of a CFA, colour filter array), and finds which sites feed each capture-mode sample.
 *
 * The link exists only because the caller supplies an evidence-backed binding. Matching grid sizes
 * are never taken as proof of a one-to-one link. This first version supports only regular
 * rectangular blocks of sites that share the native top-left corner.
 * @see docs/MOTION_AND_SIGNAL.md for equations, coordinate/unit conventions, blockers and support
 * limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import {
  parseEvidenceList,
  type EvidenceProvenance
} from "../core/evidence-provenance.js";
import {
  InvalidScientificInputError,
  requirePositiveInteger
} from "../core/validation.js";
import {
  resolveCaptureMode,
  type CaptureModeProfile,
  type CaptureModeSampleCombinationDomain,
  type CaptureModeSensorOffsetNativeSamples,
  type SourcedCaptureModeFact
} from "./capture-mode.js";
import {
  parseSensorColorSamplingProfile,
  type SensorColorSamplingProfile
} from "./color-sampling.js";
import type { NativeImageRaster } from "./sensor-geometry.js";
import { requireInputObject, requireInputKeys, requireConfigRecord as requireRecord, requireConfigString as requireNonEmptyString, requireConfigPositiveSafeInteger as requirePositiveSafeInteger } from "../core/record-validation.js";


export interface NativeEffectiveRasterColorSamplingBindingProfile {
  schemaVersion: "0.1.0";
  bindingId: string;
  colorSamplingProfileId: string;
  /**
   * The exact native image grid this binding has evidence for. Do not reuse
   * the binding with another grid just because another sensor or mode has
   * similar dimensions or the same aspect ratio.
   */
  nativeRaster: NativeImageRaster;
  /**
   * Evidence for the link between the native image grid and the colour-site
   * grid itself.
   *
   * Capture-mode and colour-layout facts keep their own separate evidence.
   */
  evidence: readonly EvidenceProvenance[];
  relationship: {
    kind: "regular-native-effective-sample-blocks";
    /**
     * Number of colour-sampling sites one native image sample spans
     * horizontally.
     */
    sitesPerNativeSampleX: number;
    /**
     * Number of colour-sampling sites one native image sample spans
     * vertically.
     */
    sitesPerNativeSampleY: number;
    /**
     * Both grids start at the same native sensor top-left corner.
     *
     * This keeps the CFA phase absolute through later active-area crops and
     * orientation changes.
     */
    anchor: "shared-native-top-left";
  };
}

export interface ColorSamplingSiteGridDimensions {
  widthSites: number;
  heightSites: number;
}

export interface ResolvedNativeEffectiveRasterColorSamplingBinding {
  bindingId: string;
  colorSamplingProfileId: string;
  nativeRaster: NativeImageRaster;
  relationshipMeaning:
    | "one-native-effective-sample-to-one-color-site"
    | "one-native-effective-sample-to-rectangular-color-site-block";
  relationship: {
    kind: "regular-native-effective-sample-blocks";
    sitesPerNativeSampleX: number;
    sitesPerNativeSampleY: number;
    anchor: "shared-native-top-left";
  };
  colorSamplingSiteGrid: ColorSamplingSiteGridDimensions;
  totalColorSamplingSites: number;
  nativeImageRasterBindingEstablished: true;
  physicalPhotodiodeBindingEstablished: false;
  physicalPhotodiodeCountInference: "not-permitted";
  spectralResponseEstablished: false;
  componentEvidence: {
    binding: readonly EvidenceProvenance[];
    colorSamplingProfile: readonly EvidenceProvenance[];
  };
}

export interface NativeEffectiveSampleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColorSamplingSiteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureModeFullFrameSampleIndex {
  /**
   * Zero-based index in the selected mode's full-frame sample grid (per frame).
   * Convert crop-relative coordinates to absolute full-frame indices before
   * calling this API.
   */
  x: number;
  y: number;
}

export interface ColorSamplingChannelSiteCount {
  channelId: string;
  siteCount: number;
}

export type ColorSamplingChannelComposition =
  | {
      kind: "single-channel";
      channelId: string;
    }
  | {
      kind: "mixed-channels";
      channelIds: readonly string[];
    };

export interface GroupedCaptureModeSamplingAnchorDeclaration {
  anchor: "native-effective-raster-top-left";
  evidence: readonly EvidenceProvenance[];
}

export interface ResolveCaptureModeColorSamplingContributorsInput {
  nativeRaster: NativeImageRaster;
  captureModeProfile: CaptureModeProfile;
  modeId: string;
  colorSamplingProfile: SensorColorSamplingProfile;
  bindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  modeSampleIndexFullFrame: CaptureModeFullFrameSampleIndex;
  /**
   * Required for modes that group native samples, because the capture-mode
   * profile declares grouping factors but does not prove where the groups start.
   */
  groupedSamplingAnchor?: GroupedCaptureModeSamplingAnchorDeclaration;
}

export interface ResolvedCaptureModeColorSamplingContributors {
  modeId: string;
  colorSamplingProfileId: string;
  modeSampleCoordinateSystem:
    "capture-mode-full-frame-effective-sample-index";
  modeSampleIndexFullFrame: CaptureModeFullFrameSampleIndex;
  modeSampleRaster: {
    pixelWidth: number;
    pixelHeight: number;
  };
  modeSamplingKind:
    | "native-effective-raster"
    | "grouped-native-samples";
  nativeEffectiveSampleRect: NativeEffectiveSampleRect;
  colorSamplingSiteRect: ColorSamplingSiteRect;
  colorSamplingSiteGrid: ColorSamplingSiteGridDimensions;
  totalContributorSites: number;
  channelSiteCounts: readonly ColorSamplingChannelSiteCount[];
  channelComposition: ColorSamplingChannelComposition;
  /**
   * Present only when the selected capture mode groups several native samples
   * into one sample per frame.
   */
  grouping:
    | {
        groupWidthSamples: SourcedCaptureModeFact<number>;
        groupHeightSamples: SourcedCaptureModeFact<number>;
        combinationDomain?: SourcedCaptureModeFact<CaptureModeSampleCombinationDomain>;
        anchor: "native-effective-raster-top-left";
        anchorEvidence: readonly EvidenceProvenance[];
      }
    | null;
  /**
   * The sensor-shift sequence stays attached to the sensor and capture mode.
   *
   * The sensor and its CFA move together, so these offsets must not change
   * which colour channel a site belongs to.
   */
  interFrameSensorOffsetsNativeSamples?: SourcedCaptureModeFact<
    readonly CaptureModeSensorOffsetNativeSamples[]
  >;
  sensorShiftChangesColorSiteAssignment: false;
  sensorShiftOpticalRegistration:
    "outside-this-contract";
  structuralSourceStage: "pre-reconstruction";
  completeDownstreamPixelDependencyEstablished: false;
  signalCombinationWeightingEstablished: false;
  spectralResponseEstablished: false;
  physicalPhotodiodeBindingEstablished: false;
  physicalPhotodiodeCountInference: "not-permitted";
  componentEvidence: {
    binding: readonly EvidenceProvenance[];
    colorSamplingProfile: readonly EvidenceProvenance[];
    captureMode: readonly EvidenceProvenance[];
  };
}

function parseBoundNativeRaster(
  value: unknown
): NativeImageRaster {
  const nativeRaster = requireRecord(
    value,
    "colorSamplingBinding.nativeRaster", ["pixelWidth", "pixelHeight"]
  );
  const pixelWidth =
    requirePositiveSafeInteger(
      nativeRaster.pixelWidth,
      "colorSamplingBinding.nativeRaster.pixelWidth"
    );
  const pixelHeight =
    requirePositiveSafeInteger(
      nativeRaster.pixelHeight,
      "colorSamplingBinding.nativeRaster.pixelHeight"
    );

  if (
    !Number.isSafeInteger(
      pixelWidth * pixelHeight
    )
  ) {
    throw new InvalidConfigurationError(
      "colorSamplingBinding.nativeRaster total image-sample count must be a safe integer."
    );
  }

  return {
    pixelWidth,
    pixelHeight
  };
}

function safeProduct(
  values: readonly number[],
  path: string
): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (!Number.isSafeInteger(result)) {
      throw new InvalidScientificInputError(
        path + " must remain a safe integer."
      );
    }
  }
  return result;
}

function validateNativeRaster(
  raster: NativeImageRaster
): void {
  requireInputObject(raster, "raster input");
  requirePositiveInteger(
    "nativeRaster.pixelWidth",
    raster.pixelWidth
  );
  requirePositiveInteger(
    "nativeRaster.pixelHeight",
    raster.pixelHeight
  );
  safeProduct(
    [raster.pixelWidth, raster.pixelHeight],
    "nativeRaster total image-sample count"
  );
}

function requireFullFrameSampleIndex(
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
        " must be a non-negative safe integer full-frame mode sample index."
    );
  }
  return value;
}

/**
 * Parses the explicit link between the native image pixel grid and the separate
 * grid of colour-sampling sites.
 *
 * This first version supports only regular rectangular blocks of sites that
 * share the native top-left corner. Irregular mappings, sparse exceptions and
 * mode-specific declared grids would need new, explicit contracts.
 */
export function parseNativeEffectiveRasterColorSamplingBindingProfile(
  value: unknown
): NativeEffectiveRasterColorSamplingBindingProfile {
  const profile = requireRecord(
    value,
    "colorSamplingBinding", ["schemaVersion", "relationship", "bindingId", "colorSamplingProfileId", "nativeRaster", "evidence"]
  );

  if (profile.schemaVersion !== "0.1.0") {
    throw new InvalidConfigurationError(
      'colorSamplingBinding.schemaVersion must be "0.1.0".'
    );
  }

  const relationship = requireRecord(
    profile.relationship,
    "colorSamplingBinding.relationship", ["kind", "anchor", "sitesPerNativeSampleX", "sitesPerNativeSampleY"]
  );

  if (
    relationship.kind !==
    "regular-native-effective-sample-blocks"
  ) {
    throw new InvalidConfigurationError(
      "colorSamplingBinding.relationship.kind is invalid."
    );
  }

  if (
    relationship.anchor !==
    "shared-native-top-left"
  ) {
    throw new InvalidConfigurationError(
      'colorSamplingBinding.relationship.anchor must be "shared-native-top-left".'
    );
  }

  return {
    schemaVersion: "0.1.0",
    bindingId: requireNonEmptyString(
      profile.bindingId,
      "colorSamplingBinding.bindingId"
    ),
    colorSamplingProfileId:
      requireNonEmptyString(
        profile.colorSamplingProfileId,
        "colorSamplingBinding.colorSamplingProfileId"
      ),
    nativeRaster: parseBoundNativeRaster(
      profile.nativeRaster
    ),
    evidence: parseEvidenceList(
      profile.evidence,
      "colorSamplingBinding.evidence"
    ),
    relationship: {
      kind:
        "regular-native-effective-sample-blocks",
      sitesPerNativeSampleX:
        requirePositiveSafeInteger(
          relationship.sitesPerNativeSampleX,
          "colorSamplingBinding.relationship.sitesPerNativeSampleX"
        ),
      sitesPerNativeSampleY:
        requirePositiveSafeInteger(
          relationship.sitesPerNativeSampleY,
          "colorSamplingBinding.relationship.sitesPerNativeSampleY"
        ),
      anchor: "shared-native-top-left"
    }
  };
}

/**
 * Validates and resolves the link between NativeImageRaster and an exact colour
 * sampling layout (monochrome or a repeating pattern such as a CFA).
 *
 * Matching dimensions are never taken as proof of a one-to-one link. The link
 * exists only because the caller supplied this evidence-backed binding profile.
 */
export function resolveNativeEffectiveRasterColorSamplingBinding(
  input: {
    nativeRaster: NativeImageRaster;
    colorSamplingProfile: SensorColorSamplingProfile;
    bindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  }
): ResolvedNativeEffectiveRasterColorSamplingBinding {
  requireInputKeys(input, "resolveNativeEffectiveRasterColorSamplingBinding", ["nativeRaster", "colorSamplingProfile", "bindingProfile"]);
  validateNativeRaster(input.nativeRaster);

  const colorSamplingProfile =
    parseSensorColorSamplingProfile(
      input.colorSamplingProfile
    );
  const bindingProfile =
    parseNativeEffectiveRasterColorSamplingBindingProfile(
      input.bindingProfile
    );

  if (
    bindingProfile.colorSamplingProfileId !==
    colorSamplingProfile.profileId
  ) {
    throw new InvalidScientificInputError(
      "Binding colorSamplingProfileId must match colorSamplingProfile.profileId."
    );
  }

  if (
    bindingProfile.nativeRaster.pixelWidth !==
      input.nativeRaster.pixelWidth ||
    bindingProfile.nativeRaster.pixelHeight !==
      input.nativeRaster.pixelHeight
  ) {
    throw new InvalidScientificInputError(
      "Binding nativeRaster must exactly match the supplied canonical native effective raster."
    );
  }

  if (colorSamplingProfile.layout.kind === "layered") {
    throw new InvalidScientificInputError(
      "Layered color sampling cannot be bound to NativeImageRaster until its per-layer spatial sampling relationship is explicitly modeled."
    );
  }

  if (
    colorSamplingProfile.coordinateSystem !==
    "native-sensor-color-sampling-site-index"
  ) {
    throw new InvalidScientificInputError(
      "Resolvable color sampling binding requires the native sensor color-sampling-site coordinate system."
    );
  }

  const widthSites = safeProduct(
    [
      input.nativeRaster.pixelWidth,
      bindingProfile.relationship
        .sitesPerNativeSampleX
    ],
    "color-sampling site-grid width"
  );
  const heightSites = safeProduct(
    [
      input.nativeRaster.pixelHeight,
      bindingProfile.relationship
        .sitesPerNativeSampleY
    ],
    "color-sampling site-grid height"
  );
  const totalColorSamplingSites =
    safeProduct(
      [widthSites, heightSites],
      "color-sampling site-grid total site count"
    );

  const oneToOne =
    bindingProfile.relationship
      .sitesPerNativeSampleX === 1 &&
    bindingProfile.relationship
      .sitesPerNativeSampleY === 1;

  return {
    bindingId: bindingProfile.bindingId,
    colorSamplingProfileId:
      bindingProfile.colorSamplingProfileId,
    nativeRaster: {
      ...input.nativeRaster
    },
    relationshipMeaning: oneToOne
      ? "one-native-effective-sample-to-one-color-site"
      : "one-native-effective-sample-to-rectangular-color-site-block",
    relationship: {
      ...bindingProfile.relationship
    },
    colorSamplingSiteGrid: {
      widthSites,
      heightSites
    },
    totalColorSamplingSites,
    nativeImageRasterBindingEstablished: true,
    physicalPhotodiodeBindingEstablished: false,
    physicalPhotodiodeCountInference:
      "not-permitted",
    spectralResponseEstablished: false,
    componentEvidence: {
      binding: bindingProfile.evidence,
      colorSamplingProfile:
        colorSamplingProfile.evidence
    }
  };
}

function countResidueInRange(
  start: number,
  length: number,
  period: number,
  residue: number
): number {
  const startResidue = start % period;
  const delta =
    (residue - startResidue + period) %
    period;

  if (delta >= length) {
    return 0;
  }

  return (
    1 +
    Math.floor(
      (length - 1 - delta) / period
    )
  );
}

function channelCountsForSiteRect(
  profile: SensorColorSamplingProfile,
  rect: ColorSamplingSiteRect
): readonly ColorSamplingChannelSiteCount[] {
  const totalSites = safeProduct(
    [rect.width, rect.height],
    "color-sampling contributor site count"
  );

  if (profile.layout.kind === "layered") {
    throw new InvalidScientificInputError(
      "Layered color sampling does not have resolvable site contributors in schema 0.1.0."
    );
  }

  if (profile.layout.kind === "monochrome") {
    return [
      {
        channelId: profile.layout.channelId,
        siteCount: totalSites
      }
    ];
  }

  const counts =
    new Map<string, number>();

  for (
    let tileY = 0;
    tileY < profile.layout.repeatHeightSites;
    tileY += 1
  ) {
    const countY = countResidueInRange(
      rect.y,
      rect.height,
      profile.layout.repeatHeightSites,
      tileY
    );
    if (countY === 0) {
      continue;
    }

    for (
      let tileX = 0;
      tileX < profile.layout.repeatWidthSites;
      tileX += 1
    ) {
      const countX = countResidueInRange(
        rect.x,
        rect.width,
        profile.layout.repeatWidthSites,
        tileX
      );
      if (countX === 0) {
        continue;
      }

      const tileIndex =
        tileY *
          profile.layout.repeatWidthSites +
        tileX;
      const channelId =
        profile.layout.siteChannelIds[
          tileIndex
        ];

      if (channelId === undefined) {
        throw new InvalidScientificInputError(
          "Periodic color-sampling tile resolution failed while calculating contributor counts."
        );
      }

      const siteCount = safeProduct(
        [countX, countY],
        "per-channel contributor site count"
      );
      const prior = counts.get(channelId) ?? 0;
      const next = prior + siteCount;
      if (!Number.isSafeInteger(next)) {
        throw new InvalidScientificInputError(
          "Per-channel contributor site count must remain a safe integer."
        );
      }
      counts.set(channelId, next);
    }
  }

  const result = Array.from(
    counts,
    ([channelId, siteCount]) => ({
      channelId,
      siteCount
    })
  );
  const countedTotal = result.reduce(
    (sum, entry) => sum + entry.siteCount,
    0
  );

  if (countedTotal !== totalSites) {
    throw new InvalidScientificInputError(
      "Color-sampling contributor channel counts do not cover the complete contributor site rectangle."
    );
  }

  return result;
}

/**
 * Finds which colour-sampling sites lie under one capture-mode sample, before any
 * reconstruction (demosaicing).
 *
 * The sample index is always absolute in the selected mode's full-frame grid. Crop-relative
 * indices are not accepted, so an active-area crop can never silently reset the CFA phase.
 *
 * For modes that group native samples, the returned rectangle covers every native sample in
 * the declared regular group. This only describes which sites lie under the sample. The engine
 * reports how many sites of each channel there are, but does not claim this is every dependency
 * of the final digital pixel. It never makes up combination weights, sum or average rules,
 * spectral response, or photon or electron values.
 *
 * Modes with a declared sample grid are rejected, because the capture-mode profile says their
 * relationship to the native grid cannot safely be written as simple integer grouping.
 *
 * Sensor shifts between frames are kept as capture-mode metadata only. The sensor and CFA move
 * together, so the shifts do not change which channel a site belongs to. Their effect on optical
 * registration belongs to a later spatial-sampling or image-formation model.
 */
export function resolveCaptureModeColorSamplingContributors(
  input: ResolveCaptureModeColorSamplingContributorsInput
): ResolvedCaptureModeColorSamplingContributors {
  requireInputKeys(input, "resolveCaptureModeColorSamplingContributors", ["nativeRaster", "captureModeProfile", "modeId", "colorSamplingProfile", "bindingProfile", "modeSampleIndexFullFrame", "groupedSamplingAnchor"]);
  const colorSamplingProfile =
    parseSensorColorSamplingProfile(
      input.colorSamplingProfile
    );
  const binding =
    resolveNativeEffectiveRasterColorSamplingBinding(
      {
        nativeRaster: input.nativeRaster,
        colorSamplingProfile,
        bindingProfile: input.bindingProfile
      }
    );
  const captureMode = resolveCaptureMode({
    nativeRaster: input.nativeRaster,
    profile: input.captureModeProfile,
    modeId: input.modeId
  });

  if (
    !captureMode.dependencies.includes(
      "color-sampling-model"
    )
  ) {
    throw new InvalidScientificInputError(
      "Selected capture mode must declare the color-sampling-model dependency before color-site contributors can be resolved."
    );
  }

  const modeX = requireFullFrameSampleIndex(
    input.modeSampleIndexFullFrame.x,
    "modeSampleIndexFullFrame.x"
  );
  const modeY = requireFullFrameSampleIndex(
    input.modeSampleIndexFullFrame.y,
    "modeSampleIndexFullFrame.y"
  );

  if (
    captureMode.perFrameSampling.kind ===
    "declared-effective-raster"
  ) {
    throw new InvalidScientificInputError(
      "declared-effective-raster capture modes require a separate mode-specific color-site binding; no relationship may be inferred from raster dimensions alone."
    );
  }

  const modeSampleRaster =
    captureMode.perFrameSampling.raster;

  if (
    modeX >= modeSampleRaster.pixelWidth ||
    modeY >= modeSampleRaster.pixelHeight
  ) {
    throw new InvalidScientificInputError(
      "modeSampleIndexFullFrame must lie within the selected mode's full-frame per-frame sampling raster."
    );
  }

  let nativeEffectiveSampleRect:
    NativeEffectiveSampleRect;
  let grouping:
    ResolvedCaptureModeColorSamplingContributors["grouping"];

  if (
    captureMode.perFrameSampling.kind ===
    "native-effective-raster"
  ) {
    if (input.groupedSamplingAnchor !== undefined) {
      throw new InvalidScientificInputError(
        "groupedSamplingAnchor must be omitted for native-effective-raster capture modes."
      );
    }

    nativeEffectiveSampleRect = {
      x: modeX,
      y: modeY,
      width: 1,
      height: 1
    };
    grouping = null;
  } else {
    if (
      input.groupedSamplingAnchor === undefined ||
      input.groupedSamplingAnchor.anchor !==
        "native-effective-raster-top-left"
    ) {
      throw new InvalidScientificInputError(
        "grouped-native-samples capture modes require an explicit native-effective-raster-top-left grouping anchor declaration."
      );
    }
    const groupingAnchorEvidence =
      parseEvidenceList(
        input.groupedSamplingAnchor.evidence,
        "groupedSamplingAnchor.evidence"
      );

    const groupWidth =
      captureMode.perFrameSampling
        .groupWidthSamples.value;
    const groupHeight =
      captureMode.perFrameSampling
        .groupHeightSamples.value;

    nativeEffectiveSampleRect = {
      x: safeProduct(
        [modeX, groupWidth],
        "native effective sample rectangle x"
      ),
      y: safeProduct(
        [modeY, groupHeight],
        "native effective sample rectangle y"
      ),
      width: groupWidth,
      height: groupHeight
    };
    grouping = {
      groupWidthSamples:
        captureMode.perFrameSampling
          .groupWidthSamples,
      groupHeightSamples:
        captureMode.perFrameSampling
          .groupHeightSamples,
      ...(captureMode.perFrameSampling
        .combinationDomain === undefined
        ? {}
        : {
            combinationDomain:
              captureMode.perFrameSampling
                .combinationDomain
          }),
      anchor:
        "native-effective-raster-top-left",
      anchorEvidence:
        groupingAnchorEvidence
    };
  }

  const sitesPerNativeX =
    binding.relationship
      .sitesPerNativeSampleX;
  const sitesPerNativeY =
    binding.relationship
      .sitesPerNativeSampleY;

  const colorSamplingSiteRect:
    ColorSamplingSiteRect = {
      x: safeProduct(
        [
          nativeEffectiveSampleRect.x,
          sitesPerNativeX
        ],
        "color-sampling contributor rectangle x"
      ),
      y: safeProduct(
        [
          nativeEffectiveSampleRect.y,
          sitesPerNativeY
        ],
        "color-sampling contributor rectangle y"
      ),
      width: safeProduct(
        [
          nativeEffectiveSampleRect.width,
          sitesPerNativeX
        ],
        "color-sampling contributor rectangle width"
      ),
      height: safeProduct(
        [
          nativeEffectiveSampleRect.height,
          sitesPerNativeY
        ],
        "color-sampling contributor rectangle height"
      )
    };

  if (
    colorSamplingSiteRect.x +
      colorSamplingSiteRect.width >
      binding.colorSamplingSiteGrid.widthSites ||
    colorSamplingSiteRect.y +
      colorSamplingSiteRect.height >
      binding.colorSamplingSiteGrid.heightSites
  ) {
    throw new InvalidScientificInputError(
      "Resolved color-sampling contributor rectangle exceeds the bound color-site grid."
    );
  }

  const totalContributorSites =
    safeProduct(
      [
        colorSamplingSiteRect.width,
        colorSamplingSiteRect.height
      ],
      "total contributor site count"
    );
  const channelSiteCounts =
    channelCountsForSiteRect(
      colorSamplingProfile,
      colorSamplingSiteRect
    );

  const firstChannel = channelSiteCounts[0];
  if (firstChannel === undefined) {
    throw new InvalidScientificInputError(
      "Resolved structural source region must contain at least one color-sampling channel."
    );
  }

  const channelComposition:
    ColorSamplingChannelComposition =
    channelSiteCounts.length === 1
      ? {
          kind: "single-channel",
          channelId: firstChannel.channelId
        }
      : {
          kind: "mixed-channels",
          channelIds:
            channelSiteCounts.map(
              (entry) => entry.channelId
            )
        };

  return {
    modeId: captureMode.modeId,
    colorSamplingProfileId:
      colorSamplingProfile.profileId,
    modeSampleCoordinateSystem:
      "capture-mode-full-frame-effective-sample-index",
    modeSampleIndexFullFrame: {
      x: modeX,
      y: modeY
    },
    modeSampleRaster: {
      ...modeSampleRaster
    },
    modeSamplingKind:
      captureMode.perFrameSampling.kind,
    nativeEffectiveSampleRect,
    colorSamplingSiteRect,
    colorSamplingSiteGrid: {
      ...binding.colorSamplingSiteGrid
    },
    totalContributorSites,
    channelSiteCounts,
    channelComposition,
    grouping,
    ...(captureMode
      .interFrameSensorOffsetsNativeSamples ===
    undefined
      ? {}
      : {
          interFrameSensorOffsetsNativeSamples:
            captureMode
              .interFrameSensorOffsetsNativeSamples
        }),
    sensorShiftChangesColorSiteAssignment:
      false,
    sensorShiftOpticalRegistration:
      "outside-this-contract",
    structuralSourceStage:
      "pre-reconstruction",
    completeDownstreamPixelDependencyEstablished:
      false,
    signalCombinationWeightingEstablished:
      false,
    spectralResponseEstablished: false,
    physicalPhotodiodeBindingEstablished:
      false,
    physicalPhotodiodeCountInference:
      "not-permitted",
    componentEvidence: {
      binding:
        binding.componentEvidence.binding,
      colorSamplingProfile:
        binding.componentEvidence
          .colorSamplingProfile,
      captureMode: captureMode.modeEvidence
    }
  };
}
