# core/image-formation.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## getImageFormationContract

Returns the image-formation contract: the order of stages and who owns each one.

The result is descriptive metadata. It is not a renderer, and a listed stage is not
necessarily available yet.

```ts
export function getImageFormationContract(): ImageFormationContract;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## IMAGE_FORMATION_CONTRACT_VERSION

Version of the public image-formation ordering contract.

It is separate from the package, root-engine and composed proof-of-concept (POC)
versions. It covers only stage order and ownership. It does not mean every listed
stage is implemented.

```ts
IMAGE_FORMATION_CONTRACT_VERSION = "0.4.0" as const
```

## ImageFormationContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationContract {
  version: typeof IMAGE_FORMATION_CONTRACT_VERSION;
  domains: readonly ImageFormationDomainId[];
  coordinateSpaces: readonly ImageFormationCoordinateSpaceContract[];
  stages: readonly ImageFormationStageContract[];
  effectPlacements: readonly ImageFormationEffectPlacement[];
  temporal: ImageFormationTemporalContract;
  renderer: ImageFormationRendererContract;
  notes: readonly string[];
}
```

## ImageFormationCoordinateSpaceContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationCoordinateSpaceContract {
  id: ImageFormationCoordinateSpaceId;
  unit: "m" | "mm" | "px" | "display-dependent";
  origin: string;
  axes: string;
  note: string;
}
```

## ImageFormationCoordinateSpaceId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageFormationCoordinateSpaceId =
  | "scene-metric"
  | "image-plane-metric"
  | "native-sensor-physical"
  | "native-raster"
  | "oriented-capture-raster"
  | "output-raster"
  | "display";
```

## ImageFormationDomainId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageFormationDomainId =
  | "scene-ray-geometry"
  | "scene-radiance-formation"
  | "lens-pupil-throughput"
  | "field-wavelength-psf"
  | "temporal-exposure-readout"
  | "sensor-output-display";
```

## ImageFormationEffectId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageFormationEffectId =
  | "focus-breathing"
  | "geometric-distortion"
  | "lateral-chromatic-aberration"
  | "illumination-vignetting"
  | "mechanical-vignetting"
  | "non-circular-diffraction"
  | "field-curvature"
  | "field-sharpness-falloff"
  | "field-dependent-bokeh"
  | "spatial-camera-rotation"
  | "rolling-readout"
  | "photosite-cfa-sampling"
  | "photon-charge-statistics"
  | "read-noise-conversion"
  | "demosaic-remosaic";
```

## ImageFormationEffectPlacement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationEffectPlacement {
  id: ImageFormationEffectId;
  primaryStage: ImageFormationStageId;
  coupledStages: readonly ImageFormationStageId[];
  note: string;
}
```

## ImageFormationImplementationStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageFormationImplementationStatus =
  | "existing-foundation"
  | "partial-foundation"
  | "reserved-contract";
```

## ImageFormationRendererContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationRendererContract {
  geometricWarpSampling: "inverse-map-destination-to-source";
  alphaRepresentation: "premultiplied";
  occlusionRule: "preserve-depth-order-across-warps";
  previewAndReferenceShareScientificContract: true;
  backendMayApproximateButNotRedefineSemantics: true;
  note: string;
}
```

## ImageFormationStageContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationStageContract {
  id: ImageFormationStageId;
  domain: ImageFormationDomainId;
  status: ImageFormationImplementationStatus;
  coordinateSpaces: readonly ImageFormationCoordinateSpaceId[];
  requiredUpstreamStages: readonly ImageFormationStageId[];
  coupledStages: readonly ImageFormationStageId[];
  purpose: string;
}
```

## ImageFormationStageId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ImageFormationStageId =
  | "scene-ray-projection"
  | "scene-radiance-evaluation"
  | "lens-field-pupil-evaluation"
  | "field-wavelength-psf"
  | "temporal-exposure-readout"
  | "sensor-optical-stack"
  | "photosite-cfa-sampling"
  | "sensor-charge-statistics"
  | "read-noise-conversion"
  | "adc-quantization"
  | "reconstruction"
  | "physical-orientation-transform"
  | "output-crop-resample"
  | "display-processing";
```

## ImageFormationTemporalContract

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationTemporalContract {
  authoritativeTimeUnit: "s";
  origin: "exposure-start";
  normalizedTimeIsDerivedOnly: true;
  exposureDurationAndReadoutTimingAreIndependent: true;
  globalReadoutDoesNotImplyZeroMotionBlur: true;
  nativeReadoutDirectionRemainsNativeUnderOrientation: true;
  note: string;
}
```
