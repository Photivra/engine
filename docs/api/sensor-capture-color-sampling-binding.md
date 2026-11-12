# sensor/capture-color-sampling-binding.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CaptureModeFullFrameSampleIndex

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CaptureModeFullFrameSampleIndex {
  /**
   * Zero-based index in the selected mode's full-frame sample grid (per frame).
   * Convert crop-relative coordinates to absolute full-frame indices before
   * calling this API.
   */
  x: number;
  y: number;
}
```

## ColorSamplingChannelComposition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ColorSamplingChannelComposition =
  | {
      kind: "single-channel";
      channelId: string;
    }
  | {
      kind: "mixed-channels";
      channelIds: readonly string[];
    };
```

## ColorSamplingChannelSiteCount

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ColorSamplingChannelSiteCount {
  channelId: string;
  siteCount: number;
}
```

## ColorSamplingSiteGridDimensions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ColorSamplingSiteGridDimensions {
  widthSites: number;
  heightSites: number;
}
```

## ColorSamplingSiteRect

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ColorSamplingSiteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## GroupedCaptureModeSamplingAnchorDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GroupedCaptureModeSamplingAnchorDeclaration {
  anchor: "native-effective-raster-top-left";
  evidence: readonly EvidenceProvenance[];
}
```

## NativeEffectiveRasterColorSamplingBindingProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## NativeEffectiveSampleRect

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeEffectiveSampleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

## parseNativeEffectiveRasterColorSamplingBindingProfile

Parses the explicit link between the native image pixel grid and the separate
grid of colour-sampling sites.

This first version supports only regular rectangular blocks of sites that
share the native top-left corner. Irregular mappings, sparse exceptions and
mode-specific declared grids would need new, explicit contracts.

```ts
export function parseNativeEffectiveRasterColorSamplingBindingProfile(
  value: unknown
): NativeEffectiveRasterColorSamplingBindingProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## resolveCaptureModeColorSamplingContributors

Finds which colour-sampling sites lie under one capture-mode sample, before any
reconstruction (demosaicing).

The sample index is always absolute in the selected mode's full-frame grid. Crop-relative
indices are not accepted, so an active-area crop can never silently reset the CFA phase.

For modes that group native samples, the returned rectangle covers every native sample in
the declared regular group. This only describes which sites lie under the sample. The engine
reports how many sites of each channel there are, but does not claim this is every dependency
of the final digital pixel. It never makes up combination weights, sum or average rules,
spectral response, or photon or electron values.

Modes with a declared sample grid are rejected, because the capture-mode profile says their
relationship to the native grid cannot safely be written as simple integer grouping.

Sensor shifts between frames are kept as capture-mode metadata only. The sensor and CFA move
together, so the shifts do not change which channel a site belongs to. Their effect on optical
registration belongs to a later spatial-sampling or image-formation model.

```ts
export function resolveCaptureModeColorSamplingContributors(
  input: ResolveCaptureModeColorSamplingContributorsInput
): ResolvedCaptureModeColorSamplingContributors;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveCaptureModeColorSamplingContributorsInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## ResolvedCaptureModeColorSamplingContributors

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## ResolvedNativeEffectiveRasterColorSamplingBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## resolveNativeEffectiveRasterColorSamplingBinding

Validates and resolves the link between NativeImageRaster and an exact colour
sampling layout (monochrome or a repeating pattern such as a CFA).

Matching dimensions are never taken as proof of a one-to-one link. The link
exists only because the caller supplied this evidence-backed binding profile.

```ts
export function resolveNativeEffectiveRasterColorSamplingBinding(
  input: {
    nativeRaster: NativeImageRaster;
    colorSamplingProfile: SensorColorSamplingProfile;
    bindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  }
): ResolvedNativeEffectiveRasterColorSamplingBinding;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
