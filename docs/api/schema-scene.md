# schema/scene.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SceneCapability

Capabilities intentionally advertised by a scene package.

```ts
export type SceneCapability =
  | "scene-linear-rgb"
  | "metric-depth"
  | "segmentation"
  | "occlusion-layers"
  | "motion-vectors"
  | "focus-targets"
  | "multi-resolution-layers"
  | "absolute-radiometry";
```

## SceneDefinition

Versioned, renderer-independent description of a curated synthetic scene.

Asset locations are deliberately left out of this scientific schema. Callers
can link the metadata to their own asset systems.

```ts
export interface SceneDefinition {
  schemaVersion: string;
  id: string;
  version: string;
  radiometry: SceneRadiometry;
  capabilities: readonly SceneCapability[];
  objects: readonly SceneObject[];
  focusTargetIds?: readonly string[];
}
```

## SceneMotion

Motion attached to an independently controllable scene object or region.

```ts
export interface SceneMotion {
  /** World-space linear velocity in metres per second. */
  linearVelocityMps: Vector3;
  /** Optional world-space angular velocity in radians per second. */
  angularVelocityRadPerSec?: Vector3;
}
```

## SceneObject

Semantic object/region within a curated synthetic scene.

```ts
export interface SceneObject {
  id: string;
  label?: string;
  /** Representative distance from the camera origin in metres. */
  distanceM: number;
  motion?: SceneMotion;
  tags?: readonly string[];
}
```

## SceneRadiometry

Describes how scene-linear image values relate to physical light.

```ts
export type SceneRadiometry =
  | {
      /**
       * Relative linear values keep light ratios correct but have no absolute
       * calibration, so they cannot be used to compute photon counts.
       */
      kind: "relative-linear";
      referenceValue: number;
    }
  | {
      /**
       * The scene package includes an absolute luminance reference, which can
       * support calibrated photometric exposure work. Luminance alone cannot give
       * photon counts. Simulating photons also needs defensible spectral and
       * optical calibration.
       */
      kind: "absolute-luminance";
      referenceValue: number;
      referenceLuminanceCdM2: number;
    };
```

## Vector3

Three-dimensional value in scene/world coordinates.

```ts
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
```
