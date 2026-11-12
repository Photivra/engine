# facade/chart-material-layers.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CHART_MASK_INDEX_GRAIN

The cell index grain of every layer: cells across and down the mask box.

```ts
CHART_MASK_INDEX_GRAIN = Object.freeze({ cellsX: 64, cellsY: 16 })
```

## CHART_MATERIAL_LAYER_LIMITS

Limits of a declared scene.

```ts
CHART_MATERIAL_LAYER_LIMITS = Object.freeze({ maximumLayers: 16, maximumShapes: 4096, maximumRings: 256, maximumEdges: 65_536 })
```

## ChartMaskAnnulus

A stroked circle: the points at distance innerRadius ≤ d ≤ outerRadius from the centre, mask units.

```ts
export interface ChartMaskAnnulus { kind: "annulus"; centerX: number; centerY: number; innerRadius: number; outerRadius: number }
```

## ChartMaskLayer

A shape mask printed over the chart: its box [0, unitsWidth] × [0, unitsHeight] (y down) fills `rectangle` (frame units, v up).

```ts
export interface ChartMaskLayer {
  kind: "shape-mask";
  rectangle: { u0: number; v0: number; u1: number; v1: number };
  unitsWidth: number;
  unitsHeight: number;
  /** 1 to 4096 shapes, in order; the ink material where any contains the point. */
  shapes: readonly ChartMaskShape[];
  backgroundReflectance: ChartReflectance;
  inkReflectance: ChartReflectance;
}
```

## ChartMaskPolygon

A filled polygon: rings as flat [x0, y0, x1, y1, …] in mask units (y down), non-zero winding over all rings.

```ts
export interface ChartMaskPolygon { kind: "polygon"; rings: readonly (readonly number[])[] }
```

## ChartMaskShape

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ChartMaskShape = ChartMaskPolygon | ChartMaskAnnulus;
```

## ChartMaterialLayerScene

A chart under 1 to 16 shape-mask layers, as data; `resolveChartMaterialLayers` evaluates it.

```ts
export interface ChartMaterialLayerScene { kind: "material-layers"; sceneId: string; chart: ChartScene; layers: readonly ChartMaskLayer[] }
```

## resolveChartMaterialLayers

Validates a declared material scene and resolves its chart (in a frame of `aspect` = height / width) and its
layers. `materialAt` is the float64 reference the GPU stage is checked against, and `callerScene` is the same
scene for `simulateCapture`'s `scene` option.

```ts
export function resolveChartMaterialLayers(input: { scene: ChartMaterialLayerScene; aspect: number }): ResolvedChartMaterialLayers;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedChartMaskLayer

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedChartMaskLayer {
  rectangle: { u0: number; v0: number; u1: number; v1: number };
  unitsWidth: number;
  unitsHeight: number;
  /** Mask units per frame unit: unitsWidth / (u1 − u0) and unitsHeight / (v1 − v0). */
  scaleX: number;
  scaleY: number;
  shapes: readonly ResolvedChartMaskShape[];
  cellsX: number;
  cellsY: number;
  cellWidth: number;
  cellHeight: number;
  /** Per cell (row by row), the shape indices whose bounding box meets the cell grown by one cell. */
  cells: readonly Uint32Array[];
  backgroundMaterial: number;
  inkMaterial: number;
  /** Whether a point in mask units is ink (through the cell index). */
  containsUnits(x: number, y: number): boolean;
}
```

## ResolvedChartMaskShape

Internal: a shape with its bounding box and flattened edges (polygon) or squared radii (annulus).

```ts
export type ResolvedChartMaskShape =
  | { kind: "polygon"; box: readonly [number, number, number, number]; edges: Float64Array }
  | { kind: "annulus"; box: readonly [number, number, number, number]; centerX: number; centerY: number; inner2: number; outer2: number };
```

## ResolvedChartMaterialLayers

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedChartMaterialLayers {
  kind: "material-layers";
  sceneId: string;
  /** The chart under the layers; its materials come first in `materials`. */
  chart: ResolvedChartScene;
  layers: readonly ResolvedChartMaskLayer[];
  materials: ResolvedChartScene["materials"];
  /** Internal: the caller input behind each material (undefined for an engine neutral), for the scene digest. */
  materialInputs: readonly unknown[];
  /** Material index at a frame point (u right, v up): the topmost layer whose rectangle holds the point, else the chart. */
  materialAt(u: number, v: number): number;
  /** The same scene as a caller material scene for `simulateCapture` and the display view (chart-local coordinates when the chart has a size). */
  callerScene: CallerMaterialScene;
}
```
