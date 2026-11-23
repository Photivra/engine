# facade/focus-mask.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DisplayViewFocusMask

The in-focus mask of a display view (#752), for the rendered rectangle, row-major.

```ts
export interface DisplayViewFocusMask {
  width: number;
  height: number;
  /** The circle of confusion c₀ the score is relative to, mm (default the frame's diagonal / 1500). */
  circleOfConfusionMm: number;
  /** Per pixel max(0, 1 − c / c₀), c the geometric blur-circle diameter of the surface the pixel centre sees: above 0 within the depth of field. */
  score: Float32Array;
  label: string;
}
```
