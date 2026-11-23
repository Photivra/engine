# facade/layered-chart-query.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLayeredChartSurfaceAt

From 2.29.0 (#747): the surface of a layered chart scene that the chief ray through frame point (u, v) sees, and its distance.
Frame units as the scene's: u = ±1 at the frame's left and right edges, v up, v = ±aspect at the top and bottom (aspect = height /
width of the frame). The nearest card whose closed rectangle holds the point, else the far surface, which has no edge: every
point has a surface, the one the display view's pilot reads. Pure; the lens is not involved (frame units are angles), so a caller
with a rectilinear lens maps a pixel centre (x, y) of a W × H frame to u = (x + ½ − W/2)·2/W, v = −(y + ½ − H/2)·2/W.
The scene is validated as a request's is (`InvalidConfigurationError`); u and v must be finite.

```ts
export function calculateLayeredChartSurfaceAt(input: { scene: LayeredChartScene; aspect: number; u: number; v: number }): LayeredChartSurfaceAt;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## LayeredChartSurfaceAt

The surface a frame point sees (#747).

```ts
export interface LayeredChartSurfaceAt {
  kind: "card" | "back-plane";
  /** Card index in the scene's `cards`, or −1 for the back plane. */
  index: number;
  /** The surface's distance from the lens plane along the axis, metres: the value focus control's `finite-surface` target takes. */
  distanceM: number;
  /** The frame point asked for. */
  framePoint: { u: number; v: number };
}
```
