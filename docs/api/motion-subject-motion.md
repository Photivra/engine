# motion/subject-motion.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SimulateCaptureSubjectMotion

`motion.subject` of `simulateCapture`: a moving subject on the scene plane (#551).

```ts
export interface SimulateCaptureSubjectMotion {
  /** Velocity on the scene plane, m/s: +x right, +y up as seen from the camera. Missing components are 0. */
  velocityMPerSec?: { x?: number; y?: number };
  /** Rotation about the optical axis direction, rad/s, counter-clockwise as seen from the camera (+x toward +y). Default 0. */
  angularVelocityRadPerSec?: number;
  /**
   * The moving part: a rectangle on the scene plane at rest (at the first opening reference), its centre and size in metres
   * (+x right, +y up from the optical axis). Omitted: the whole scene moves.
   */
  region?: { centerXM: number; centerYM: number; widthM: number; heightM: number };
  /** Exact or fast (2.20.0 convention): fast takes fewer temporal midpoints when the subject's streak is short (see the docs). */
  fast?: boolean;
}
```
