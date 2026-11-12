# sensor/color-sampling.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## LayeredColorSamplingLayout

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## MonochromeColorSamplingLayout

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface MonochromeColorSamplingLayout {
  kind: "monochrome";
  /**
   * A name for the measured channel only. It is not a spectral response
   * curve, wavelength, colour primary or calibration.
   */
  channelId: string;
}
```

## NativeColorSamplingSiteCoordinateSystem

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type NativeColorSamplingSiteCoordinateSystem =
  "native-sensor-color-sampling-site-index";
```

## NativeColorSamplingSiteIndex

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## parseSensorColorSamplingProfile

Parses an exact colour-sampling layout. It is not tied to NativeImageRaster,
physical photodiodes, spectral response or a manufacturer's layout name.

Repeating mosaics use an abstract grid of native sensor sites with zero-based
integer indices, origin at the top left, +X right and +Y down. The repeat
pattern is fixed to this grid, so later crops or orientation changes must keep
the original native site indices.

Layered layouts are described structurally only, because real layered sensors
may sample each layer at different densities or offsets. There is no per-site
lookup for layered layouts until that is modelled explicitly.

```ts
export function parseSensorColorSamplingProfile(
  value: unknown
): SensorColorSamplingProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PeriodicMosaicColorSamplingLayout

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## resolveColorSamplingSite

Returns which channel one native site measures, for monochrome or repeating
mosaic layouts.

It deliberately takes no NativeImageRaster. A separate binding
(capture-color-sampling-binding) must say how a capture mode's sample grid
maps onto this site grid before RAW or CFA sampling can be simulated.

Layered layouts are rejected, because how their layers line up spatially is
not defined yet.

```ts
export function resolveColorSamplingSite(
  input: ResolveColorSamplingSiteInput
): ResolvedColorSamplingSite;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveColorSamplingSiteInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveColorSamplingSiteInput {
  profile: SensorColorSamplingProfile;
  site: NativeColorSamplingSiteIndex;
}
```

## ResolvedColorSamplingSite

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## SensorColorSamplingLayout

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorColorSamplingLayout =
  | MonochromeColorSamplingLayout
  | PeriodicMosaicColorSamplingLayout
  | LayeredColorSamplingLayout;
```

## SensorColorSamplingProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## SensorColorSamplingProfileCoordinateSystem

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorColorSamplingProfileCoordinateSystem =
  | NativeColorSamplingSiteCoordinateSystem
  | "native-sensor-layered-spatial-relationship-not-resolved";
```
