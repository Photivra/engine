# output/geometric-transforms.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AffineGeometricTransform

Explicit destination-to-source affine map, which can include rotation, shear and offset.

```ts
export interface AffineGeometricTransform extends TransformIdentity {
  kind: "affine";
  matrix: GeometricJacobian;
  offsetMm: LensFieldPointMm;
}
```

## BrownConradyGeometricTransform

Schema 0.2.0: Brown-Conrady distortion. A correction reads the distorted data at the position mapped from each ideal destination point.

```ts
export interface BrownConradyGeometricTransform extends TransformIdentity {
  kind: "brown-conrady";
  profile: BrownConradyDistortionProfile;
}
```

## calculateComposedGeometricMapping

Maps a display point to the capture, with the full local derivatives in each direction.

```ts
export function calculateComposedGeometricMapping(input: {
  mapping: PreparedGeometricMapping; destinationPointMm: LensFieldPointMm;
}): CalculationResult<GeometricMappingPoint>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateForwardGeometricMapping

Maps a capture point to the display, for focus, metering and overlays. It inverts the same maps.

```ts
export function calculateForwardGeometricMapping(input: {
  mapping: PreparedGeometricMapping; sourcePointMm: LensFieldPointMm;
}): CalculationResult<LensFieldPointMm>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateGeometricResampling

Resamples an already-formed single-channel image once. A null output sample marks missing source data.

```ts
export function calculateGeometricResampling(input: {
  plan: GeometricSamplingPlan; sourceSamples: readonly number[];
}): CalculationResult<{ samples: readonly (number | null)[]; resamplePasses: 1; resampler: GeometricResampler }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateGeometricSamplingPlan

Composes compatible inverse maps, then resolves one shared plan for validity, crop and anti-aliasing (AA).

```ts
export function calculateGeometricSamplingPlan(input: {
  mapping: PreparedGeometricMapping; sourceRaster: GeometricRaster; destinationRaster: GeometricRaster;
  resampler: GeometricResampler; physicalProjectionDistanceMm: number;
  /**
   * Ideal projection of the captured (source) image, used for the reported angles. Omitted or
   * "rectilinear" keeps the existing atan(mm / projection distance) angles exactly.
   */
  sourceProjectionModel?: LensProjectionModel;
}): CalculationResult<GeometricSamplingPlan>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DigitalGeometricTransform

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type DigitalGeometricTransform =
  | AffineGeometricTransform
  | RadialGeometricTransform
  | BrownConradyGeometricTransform
  | ProjectionRemapGeometricTransform;
```

## GeometricImageDomain

A domain change separates maps: only adjacent maps in the same domain share one resampling pass.

```ts
export type GeometricImageDomain = "raw-channel" | "reconstructed-linear" | "processed-output";
```

## GeometricJacobian

Jacobian (derivative) d(source mm)/d(destination mm), in row-major order.

```ts
export type GeometricJacobian = readonly [number, number, number, number];
```

## GeometricMappingPoint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GeometricMappingPoint {
  sourcePointMm: LensFieldPointMm;
  jacobian: GeometricJacobian;
  determinant: number;
  principalStretches: readonly [number, number];
  anisotropy: number;
  components: readonly { id: string; sourcePointMm: LensFieldPointMm; jacobian: GeometricJacobian }[];
}
```

## GeometricProjectionDeclaration

One ideal projection and its mapping scale (focal length, or mm per radian for equirectangular).

```ts
export interface GeometricProjectionDeclaration {
  projectionModel: LensProjectionModel;
  focalLengthMm: number;
}
```

## GeometricRaster

A regular grid of pixel centres on the optical plane: +X right, +Y up; rows run top to bottom.

```ts
export interface GeometricRaster {
  width: number;
  height: number;
  centerMm: LensFieldPointMm;
  pitchMm: number;
}
```

## GeometricResampler

The resampling filter, chosen independently of the mapping. Any prefiltering (anti-aliasing) is the caller's job.

```ts
export interface GeometricResampler {
  id: string;
  version: string;
  filter: "nearest" | "bilinear";
  antialias: "none" | "source-prefiltered";
}
```

## GeometricSamplingPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GeometricSamplingPlan {
  mapping: PreparedGeometricMapping;
  sourceRaster: GeometricRaster;
  destinationRaster: GeometricRaster;
  resampler: GeometricResampler;
  points: readonly GeometricMappingPoint[];
  /** True where the selected filter has full source support around the pixel centre. Edges are not extended. */
  validSourceMask: readonly boolean[];
  /** Largest axis-aligned rectangle of valid pixels (half-open). Null if there is none. */
  jointCrop: { x: number; y: number; width: number; height: number } | null;
  requiresPrefilter: boolean;
  canResample: boolean;
  physicalCapturedFovDegrees: { horizontal: number; vertical: number };
  /** Angular extent of the mapped pixel-centre rays kept by the joint crop. It is not the edge-to-edge FOV. */
  retainedSampleRayEnvelopeDegrees: { minX: number; maxX: number; minY: number; maxY: number } | null;
}
```

## parseDigitalGeometricTransform

Strictly parses transform data. Unknown kinds or fields and profiles that cannot be inverted are rejected.

```ts
export function parseDigitalGeometricTransform(value: unknown): DigitalGeometricTransform;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PreparedGeometricMapping

Serializable prepared mapping. Maps are applied in the listed order, from destination towards source.

```ts
export interface PreparedGeometricMapping {
  /** 0.1.0 when only affine and radial kinds are used; 0.2.0 when a kind added in 2.0 is present. */
  schemaVersion: "0.1.0" | "0.2.0";
  frameTimeSeconds: number;
  transforms: readonly DigitalGeometricTransform[];
  semanticKey: string;
  groups: readonly { domain: GeometricImageDomain; componentIds: readonly string[] }[];
}
```

## prepareGeometricMapping

Prepares a deterministic mapping for one still or frame. A change in time needs a new preparation.

```ts
export function prepareGeometricMapping(input: {
  transforms: readonly DigitalGeometricTransform[]; frameTimeSeconds: number;
}): CalculationResult<PreparedGeometricMapping>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ProjectionRemapGeometricTransform

Schema 0.2.0: change of projection. Each destination point becomes a scene direction (using
the destination projection), then a source point (using the source projection). Purpose must
be "projection".

```ts
export interface ProjectionRemapGeometricTransform extends TransformIdentity {
  kind: "projection-remap";
  destinationProjection: GeometricProjectionDeclaration;
  sourceProjection: GeometricProjectionDeclaration;
}
```

## RadialGeometricTransform

Radial distortion. A correction reads the physically distorted data at the position mapped from each ideal (undistorted) destination point.

```ts
export interface RadialGeometricTransform extends TransformIdentity {
  kind: "radial";
  profile: RadialDistortionProfile;
}
```
