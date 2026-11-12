# facade/chart-scenes.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BarGroupsChartScene

2.3: groups of three dark bars on a light plate (the three-bar concept of the US Air Force 1951 target,
a US-government publication, in the engine's own arrangement): one group per frequency, vertical bars (horizontal resolution)
in the upper row and horizontal bars (vertical resolution) below, optionally labelled with engine-drawn
seven-segment numerals. Frequencies are line widths per picture height (LW/PH, as in ISO 12233), where
the picture height is the chart's height: one bar is PH/LW wide.

```ts
export interface BarGroupsChartScene {
  preset: "bar-groups";
  /** One group per entry, left to right: integers 1..100000. Default [100, 200, 400, 800]. 1..32 entries. */
  lineWidthsPerPictureHeight?: readonly number[];
  /** Draw each group's LW/PH value below it. Default true. */
  numerals?: boolean;
  darkReflectance?: number;
  lightReflectance?: number;
}
```

## calculateBarGroupTargets

The bar groups of a `bar-groups` chart, or of every `bar-groups` element of a composite, in the chart's
frame units (2.3). `aspect` is the chart's height / width, as for {@link resolveChartScene}.

```ts
export function calculateBarGroupTargets(input: { scene: ChartScene; aspect: number }): ChartBarGroupTarget[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePointGridCenters

Centres (frame units) of a point grid: one disk centred in each of columns × rows equal cells, row-major from the top-left.

```ts
export function calculatePointGridCenters(input: { columns: number; rows: number; aspect: number }): { u: number; v: number }[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateSlantedSquareEdges

Squares and edges of a `slanted-squares` chart, or of every `slanted-squares` element of a composite, in
the chart's frame units (2.3), for slanted-edge regions of interest (Burns, PICS 2000). Directions are unit
vectors along each edge (u right, v up).

```ts
export function calculateSlantedSquareEdges(input: { scene: ChartScene; aspect: number }): ChartSlantedSquare[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateStepWedgeReflectances

Step reflectances of a step wedge. `equal-density` spaces optical density D = -log10(R) evenly, which
gives geometric reflectance steps, as on a photographic step tablet. `linear` spaces reflectance evenly.

```ts
export function calculateStepWedgeReflectances(input: { steps: number; minimumReflectance: number; maximumReflectance: number;
  spacing: "equal-density" | "linear" }): number[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CHART_CONTINUOUS_LEVELS

Neutral levels that represent a continuous pattern (grey ramp; 2.3 sine star, zone plate and dead-leaves greys).

```ts
CHART_CONTINUOUS_LEVELS = 1024
```

## CHART_SCENE_DEFAULTS

Engine-chosen chart parameters, each reported when the caller omitted it.

```ts
CHART_SCENE_DEFAULTS = Object.freeze({
  uniform: Object.freeze({ reflectance: 0.18 }),
  "slanted-edge": Object.freeze({ angleDegrees: 5, darkReflectance: 0.15, lightReflectance: 0.6 }),
  "siemens-star": Object.freeze({ cycles: 36, radiusFraction: 0.9, darkReflectance: 0.05, lightReflectance: 0.8, backgroundReflectance: 0.18 }),
  "step-wedge": Object.freeze({ steps: 11, minimumReflectance: 0.03, maximumReflectance: 0.9, spacing: "equal-density" as const }),
  "grey-ramp": Object.freeze({ minimumReflectance: 0.03, maximumReflectance: 0.9 }),
  checkerboard: Object.freeze({ squaresAcross: 8, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "point-grid": Object.freeze({ columns: 5, rows: 3, radius: 0.01, pointReflectance: 0.9, backgroundReflectance: 0.02 }),
  patches: Object.freeze({ gapFraction: 0.1, backgroundReflectance: 0.18 }),
  "dead-leaves": Object.freeze({ radiusMinimum: 0.01, radiusMaximum: 0.5, minimumReflectance: 0.2, maximumReflectance: 0.6, seed: 1 }),
  "bar-groups": Object.freeze({ lineWidthsPerPictureHeight: Object.freeze([100, 200, 400, 800]), numerals: true, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "hyperbolic-wedge": Object.freeze({ orientation: "horizontal" as const, lineCount: 5, minimumLineWidthsPerPictureHeight: 100,
    maximumLineWidthsPerPictureHeight: 1000, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "zone-plate": Object.freeze({ radiusFraction: 0.9, maximumCyclesPerPictureHeight: 200, darkReflectance: 0.1, lightReflectance: 0.7, backgroundReflectance: 0.18 }),
  "slanted-squares": Object.freeze({ columns: 3, rows: 2, sizeFraction: 0.5, angleDegrees: 5, darkReflectance: 0.15, lightReflectance: 0.6 }),
  "line-grid": Object.freeze({ spacing: 1 / 3, lineWidth: 0.01, lineReflectance: 0.42, backgroundReflectance: 0.6 }),
  fiducial: Object.freeze({ radiusFraction: 0.8, ringFraction: 0.18, inverted: false, darkReflectance: 0.05, lightReflectance: 0.8, backgroundReflectance: 0.18 }),
  "color-patches": Object.freeze({ patchIds: COLOR_PATCH_IDS, gapFraction: 0.1, backgroundReflectance: 0.18 }),
  composite: Object.freeze({ background: Object.freeze({ preset: "uniform" as const, reflectance: 0.18 }) })
})
```

## CHART_SCENE_PRESETS

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CHART_SCENE_PRESETS: readonly ChartScenePresetId[] = Object.freeze(["uniform", "slanted-edge", "siemens-star",
  "step-wedge", "grey-ramp", "checkerboard", "point-grid", "patches", "dead-leaves", "bar-groups", "hyperbolic-wedge", "zone-plate",
  "slanted-squares", "line-grid", "fiducial", "color-patches", "composite"] as const)
```

## CHART_SPECTRAL_RANGE_NANOMETERS

Wavelength range every chart spectrum must cover (the facade's sensor quadrature range).

```ts
CHART_SPECTRAL_RANGE_NANOMETERS = Object.freeze({ minimum: 380, maximum: 780 })
```

## ChartBarGroupTarget

One bar group of a `bar-groups` chart or composite element, in the chart's frame units.

```ts
export interface ChartBarGroupTarget {
  /** Composite element index, or null for a plain `bar-groups` chart. */
  elementIndex: number | null;
  lineWidthsPerPictureHeight: number;
  /** Line pairs (cycles) per picture height: LW/PH ÷ 2. */
  cyclesPerPictureHeight: number;
  /** Width of one bar, frame units. */
  lineWidth: number;
  /** The three vertical bars (horizontal resolution) and the three horizontal bars (vertical resolution). */
  verticalBars: ChartRectangle;
  horizontalBars: ChartRectangle;
}
```

## ChartElementScene

Any chart preset except `composite`: a composite's background or element.

```ts
export type ChartElementScene = UniformChartScene | SlantedEdgeChartScene | SiemensStarChartScene | StepWedgeChartScene | GreyRampChartScene |
  CheckerboardChartScene | PointGridChartScene | PatchChartScene | ColorPatchesChartScene | DeadLeavesChartScene | BarGroupsChartScene | HyperbolicWedgeChartScene |
  ZonePlateChartScene | SlantedSquaresChartScene | LineGridChartScene | FiducialChartScene;
```

## ChartRectangle

An axis-aligned rectangle in chart frame units: u0 ≤ u ≤ u1, v0 ≤ v ≤ v1.

```ts
export interface ChartRectangle { u0: number; v0: number; u1: number; v1: number }
```

## ChartReflectance

A neutral (spectrally flat) reflectance in [0, 1], a caller reflectance spectrum (values in [0, 1]) or, from 2.14, a
built-in color patch `{ kind: "color-patch", patchId }`.

```ts
export type ChartReflectance = number | ColorimetricSpectrum | ColorPatchReflectance;
```

## ChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ChartScene = ChartElementScene | CompositeChartScene;
```

## ChartScenePresetId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ChartScenePresetId = ChartScene["preset"];
```

## ChartSlantedSquare

One square of a `slanted-squares` chart and its four edges, in the chart's frame units.

```ts
export interface ChartSlantedSquare {
  elementIndex: number | null;
  center: { u: number; v: number };
  /** Side length, frame units. */
  side: number;
  /** Clockwise rotation, degrees. */
  angleDegrees: number;
  darkReflectance: number;
  lightReflectance: number;
  /** `left`/`right` edges are near-vertical (horizontal MTF), `top`/`bottom` near-horizontal (vertical MTF). */
  edges: { side: "left" | "right" | "top" | "bottom"; midpoint: { u: number; v: number }; direction: { u: number; v: number }; length: number }[];
}
```

## CheckerboardChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CheckerboardChartScene {
  preset: "checkerboard";
  /** Squares across the frame width, 2..256. Default 8. */
  squaresAcross?: number;
  darkReflectance?: number;
  lightReflectance?: number;
}
```

## ColorPatchesChartScene

2.14: the built-in Photivra color patches (`getColorPatchSet()`) in a grid, drawn like `patches`: row-major, each
patch centred in an equal cell with a neutral gap around it. The spectra are the engine's own analytic designs; no
third-party chart data, names, order or layout are used.

```ts
export interface ColorPatchesChartScene {
  preset: "color-patches";
  /** Patches to draw, row-major, distinct. Default: the whole set in `COLOR_PATCH_IDS` order (30 patches, six per row). */
  patchIds?: readonly ColorPatchId[];
  /** Patches per row, 1 to the patch count. Default min(6, patch count). */
  columns?: number;
  /** Gap between patches as a fraction of the cell size, [0, 0.5). Default 0.1. */
  gapFraction?: number;
  /** Neutral reflectance of the gaps and empty cells. Default 0.18. */
  backgroundReflectance?: number;
}
```

## ColorPatchReflectance

2.14: one of the engine's built-in color patches (see `getColorPatchSet()`): its reflectance spectrum, Photivra's own
analytic design, rendered through the same spectral path as a caller spectrum.

```ts
export interface ColorPatchReflectance { kind: "color-patch"; patchId: ColorPatchId }
```

## CompositeChartElement

One element of a composite chart: a preset drawn inside its placement rectangle (frame units of the
composite). The element sees its own frame: u = ±1 at the rectangle's left and right edges, aspect =
height / width, and LW/PH frequencies still refer to the composite's picture height.

```ts
export interface CompositeChartElement {
  scene: ChartElementScene;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
  /** `rectangle` (default) or `ellipse` inscribed in the rectangle; outside it, earlier elements or the background show. */
  mask?: "rectangle" | "ellipse";
}
```

## CompositeChartScene

2.3: an ordered list of elements over a background. Later elements cover earlier ones. The engine
provides only the generic parts; a branded or product-specific layout stays in the application.

```ts
export interface CompositeChartScene {
  preset: "composite";
  /** Fills the whole composite frame. Default `{ preset: "uniform", reflectance: 0.18 }`. */
  background?: ChartElementScene;
  /** 1..256 elements, drawn in order. */
  elements: readonly CompositeChartElement[];
}
```

## DeadLeavesChartScene

2.3: seeded dead-leaves texture (Matheron's random closed set model, in the scale-invariant form used for
camera texture measurement by Cao, Guichard and Hornung): opaque disks with Poisson-distributed centres,
radius density ∝ r⁻³ on [radiusMinimum, radiusMaximum] and a grey drawn uniformly in [minimum, maximum]
reflectance. Disks are drawn in order with earlier disks on top until every point of the chart (plus 0.1
frame units around it) is covered, which samples the stationary dead-leaves image exactly (Kendall and
Thönnes' backward "perfect simulation"). Radii are in frame units (fraction of the frame half-width).

```ts
export interface DeadLeavesChartScene {
  preset: "dead-leaves";
  /** Smallest disk radius, frame units, [0.002, radiusMaximum). Default 0.01. */
  radiusMinimum?: number;
  /** Largest disk radius, frame units, (radiusMinimum, 2]. Default 0.5. */
  radiusMaximum?: number;
  /** Grey range (neutral reflectances). Defaults 0.2 and 0.6. */
  minimumReflectance?: number;
  maximumReflectance?: number;
  /** Random seed (uint32); the same seed gives the same disks on every platform. Default 1. */
  seed?: number;
}
```

## FiducialChartScene

2.3: registration fiducial: a 2 × 2 checker disk inside a dark ring; `inverted` swaps the checker phase (an orientation cue).

```ts
export interface FiducialChartScene {
  preset: "fiducial";
  /** Disk radius as a fraction of the frame half-height, (0, 1]. Default 0.8. */
  radiusFraction?: number;
  /** Ring width as a fraction of the radius, (0, 1). Default 0.18. */
  ringFraction?: number;
  /** Default false: the upper-right and lower-left quadrants are dark. */
  inverted?: boolean;
  darkReflectance?: number;
  lightReflectance?: number;
  backgroundReflectance?: number;
}
```

## GreyRampChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface GreyRampChartScene {
  preset: "grey-ramp";
  /** Continuous ramp, linear in reflectance from left (minimum) to right (maximum). */
  minimumReflectance?: number;
  maximumReflectance?: number;
}
```

## HyperbolicWedgeChartScene

2.3: hyperbolic wedge: `lineCount` dark lines separated by light gaps of the same width, whose width
shrinks along the wedge axis so that the frequency rises linearly from the minimum to the maximum LW/PH.
The line edges are hyperbolas. `horizontal`: the axis runs left to right and the lines are nearly
horizontal (vertical resolution); `vertical`: the axis runs bottom to top (horizontal resolution).

```ts
export interface HyperbolicWedgeChartScene {
  preset: "hyperbolic-wedge";
  orientation?: "horizontal" | "vertical";
  /** Dark lines, 1..50. Default 5. */
  lineCount?: number;
  /** LW/PH at the start and end of the axis. Defaults 100 and 1000. */
  minimumLineWidthsPerPictureHeight?: number;
  maximumLineWidthsPerPictureHeight?: number;
  darkReflectance?: number;
  lightReflectance?: number;
}
```

## LineGridChartScene

2.3: straight lines at every multiple of `spacing` from the centre in u and v (a distortion and registration grid).

```ts
export interface LineGridChartScene {
  preset: "line-grid";
  /** Distance between lines, frame units, (0, 2]. Default 1/3 (six cells across). */
  spacing?: number;
  /** Line width, frame units, (0, spacing). Default 0.01. */
  lineWidth?: number;
  lineReflectance?: number;
  backgroundReflectance?: number;
}
```

## PatchChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PatchChartScene {
  preset: "patches";
  /** Caller reflectance per patch, row-major; the facade bundles no color-chart data. 1..1024 patches. */
  patches: readonly { patchId: string; reflectance: ChartReflectance }[];
  /** Patches per row. Default ceil(sqrt(patch count)). */
  columns?: number;
  /** Gap between patches as a fraction of the cell size, [0, 0.5). Default 0.1. */
  gapFraction?: number;
  backgroundReflectance?: number;
}
```

## PointGridChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PointGridChartScene {
  preset: "point-grid";
  /** Grid columns and rows of small disks centred in equal cells. Defaults 5 × 3. */
  columns?: number;
  rows?: number;
  /** Disk radius in frame units (fraction of the frame half-width). Default 0.01. */
  radius?: number;
  pointReflectance?: number;
  backgroundReflectance?: number;
}
```

## resolveChartScene

Validates a chart description and resolves every default. `aspect` is the frame height/width. Unknown
fields are rejected so that a mistyped parameter never silently falls back to a default.

```ts
export function resolveChartScene(input: { scene: ChartScene; aspect: number }): ResolvedChartScene;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedChartScene

A validated chart: every parameter resolved, plus which ones came from {@link CHART_SCENE_DEFAULTS}.

```ts
export interface ResolvedChartScene {
  preset: ChartScenePresetId;
  /** Fully resolved parameters (spectra are reported as `"caller-spectrum"`). */
  parameters: Readonly<Record<string, unknown>>;
  /** Names of parameters filled from defaults. */
  defaultedParameters: readonly string[];
  /** Frame aspect (height / width) the chart was resolved for. */
  aspect: number;
  /**
   * Material index at a frame point (u right, v up). The index points into `materials`, starting at 0.
   * Points outside the framed rectangle still evaluate (the pattern continues as defined), so blur and
   * small framing differences stay well defined.
   */
  materialAt(u: number, v: number): number;
  /** Reflectance materials: a neutral number or a prepared caller spectrum. */
  materials: readonly ({ kind: "neutral"; reflectance: number } | { kind: "spectrum"; spectrum: PreparedColorimetricSpectrum })[];
  /** Reflectance in [0, 1] at a frame point and wavelength (nm). */
  reflectanceAt(u: number, v: number, wavelengthNanometers: number): number;
}
```

## SiemensStarChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SiemensStarChartScene {
  preset: "siemens-star";
  /** Light/dark sector pairs around the star, 2..360. Default 36. */
  cycles?: number;
  /** Star radius as a fraction of the frame half-height, (0, 1]. Default 0.9. */
  radiusFraction?: number;
  darkReflectance?: number;
  lightReflectance?: number;
  /** Reflectance outside the star. Default 0.18. */
  backgroundReflectance?: number;
  /**
   * 2.3: angular reflectance profile. `bar` (default): square-wave sectors. `sine`: a sinusoidal star,
   * R(θ) = mid + amp·sin(2π·cycles·(θ/2π + ½)) between the dark and light reflectances, zero crossings at
   * the bar star's sector edges, quantized to {@link CHART_CONTINUOUS_LEVELS} levels. Reported in the
   * parameters only when given, so 2.2 scene digests are unchanged.
   */
  profile?: "bar" | "sine";
}
```

## SlantedEdgeChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SlantedEdgeChartScene {
  preset: "slanted-edge";
  /** Clockwise tilt of the edge from vertical, degrees, in (-45, 45). Default 5. */
  angleDegrees?: number;
  /** Left (dark) side reflectance. Default 0.15. */
  darkReflectance?: number;
  /** Right (light) side reflectance. Default 0.6 (4:1 with the default dark side). */
  lightReflectance?: number;
}
```

## SlantedSquaresChartScene

2.3: a field of dark squares rotated clockwise by `angleDegrees` on a light background, one centred in
each of columns × rows equal cells: every square gives two near-vertical and two near-horizontal slanted
edges (Burns, PICS 2000). See {@link calculateSlantedSquareEdges}.

```ts
export interface SlantedSquaresChartScene {
  preset: "slanted-squares";
  columns?: number;
  rows?: number;
  /** Square side as a fraction of the smaller cell side, (0, 1); the rotated square must stay in its cell. Default 0.5. */
  sizeFraction?: number;
  /** Clockwise rotation, degrees, in (-45, 45). Default 5. */
  angleDegrees?: number;
  /** Square (dark) and background (light) reflectances. Defaults 0.15 and 0.6 (4:1). */
  darkReflectance?: number;
  lightReflectance?: number;
}
```

## StepWedgeChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StepWedgeChartScene {
  preset: "step-wedge";
  /** Number of equal-width vertical steps from left (minimum) to right (maximum), 2..64. Default 11. */
  steps?: number;
  minimumReflectance?: number;
  maximumReflectance?: number;
  /** `equal-density` (geometric, default) or `linear` reflectance spacing. */
  spacing?: "equal-density" | "linear";
}
```

## UniformChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface UniformChartScene { preset: "uniform"; reflectance?: ChartReflectance }
```

## ZonePlateChartScene

2.3: circular zone plate R(r) = mid + amp·cos(π·k·r²): the local frequency k·r rises linearly from 0 at
the centre to `maximumCyclesPerPictureHeight` at the rim (the quadratic-phase chirp of a Fresnel zone
plate). Quantized to {@link CHART_CONTINUOUS_LEVELS} levels.

```ts
export interface ZonePlateChartScene {
  preset: "zone-plate";
  /** Plate radius as a fraction of the frame half-height, (0, 1]. Default 0.9. */
  radiusFraction?: number;
  /** Frequency at the rim, cycles per picture height. Default 200. */
  maximumCyclesPerPictureHeight?: number;
  darkReflectance?: number;
  lightReflectance?: number;
  backgroundReflectance?: number;
}
```
