# sensor/sampling-aperture.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## NativeSensorPhysicalBoundsMm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeSensorPhysicalBoundsMm {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
```

## NativeSensorPhysicalPointMm

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeSensorPhysicalPointMm {
  x: number;
  y: number;
}
```

## parseSensorSamplingApertureProfile

Parses where the colour-sampling sites sit physically, plus a simple geometric
model of each site's light-sensitive area.

Site pitch and origin are declared facts, never derived from NativeImageRaster.
The rectangle, when given, is a geometric sensitive region only. It does not
include microlens effects, charge diffusion, electrical crosstalk, QE,
throughput, spectral response or an effective light-collection area.

```ts
export function parseSensorSamplingApertureProfile(
  value: unknown
): SensorSamplingApertureProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedSensorSamplingAperture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## resolveSensorSamplingAperture

Resolves one site's geometric sampling aperture in native sensor physical space.

The result is a normalized footprint that averages evenly over its area, for
image sampling, plus its physical area and fill fraction. That geometric area
is deliberately not treated as light-collection efficiency or as the true
photodiode shape.

```ts
export function resolveSensorSamplingAperture(
  input: ResolveSensorSamplingApertureInput
): ResolvedSensorSamplingAperture;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveSensorSamplingApertureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveSensorSamplingApertureInput {
  imagingArea: SensorImagingArea;
  nativeRaster: NativeImageRaster;
  colorSamplingProfile: SensorColorSamplingProfile;
  colorSamplingBindingProfile: NativeEffectiveRasterColorSamplingBindingProfile;
  samplingApertureProfile: SensorSamplingApertureProfile;
  site: NativeColorSamplingSiteIndex;
}
```

## SensorGeometricSensitiveAperture

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## SensorSamplingApertureProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSamplingApertureProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  colorSamplingProfileId: string;
  colorSamplingBindingId: string;
  evidence: readonly EvidenceProvenance[];
  siteCenterLattice: SensorSiteCenterLatticeRegistration;
  geometricSensitiveAperture: SensorGeometricSensitiveAperture;
}
```

## SensorSiteCenterLatticeRegistration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```
