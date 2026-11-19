# facade/layered-chart-scene.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLayeredChartDepths

The depth report of a resolved scene (`result.scene.layers`).

```ts
export function calculateLayeredChartDepths(input: { scene: ResolvedLayeredChartScene; focalLengthMm: number; aperture: number; focusDistanceM: number;
  circleOfConfusionMm: number; pixelPitchMicrometers: number }): LayeredChartDepth[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## LAYERED_CHART_LIMITS

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
LAYERED_CHART_LIMITS = Object.freeze({ maximumCards: 16, maximumLightsAcross: 256, maximumCandela: 1e7 })
```

## LAYERED_CHART_PRESET_SCALES

Preset scales: the first depth step from the focus plane.

```ts
LAYERED_CHART_PRESET_SCALES = Object.freeze({ macro: 0.001, tabletop: 0.01, large: 0.25 })
```

## LAYERED_CHART_PRESET_STEP_RATIO

Growth of successive depth steps away from the focus plane (owner decision 5 of the 2.27.0 plan).

```ts
LAYERED_CHART_PRESET_STEP_RATIO = 1.5
```

## LayeredChartBackPlane

The back plane: an unbounded, lit, neutral or spectral surface behind every card.

```ts
export interface LayeredChartBackPlane {
  distanceM: number;
  /** Default 0.18. */
  reflectance?: ChartReflectance;
  pointLights?: LayeredChartPointLights;
}
```

## LayeredChartCard

One opaque card, in frame units as seen from the lens.

```ts
export interface LayeredChartCard {
  /** Distance from the lens plane, metres. */
  distanceM: number;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
  /** The card's print, resolved in the card's own frame (aspect height / width). */
  scene: ChartScene;
  /** Prints the card's distance in millimetres (seven-segment digits) in its top-right corner. Default false. */
  depthLabel?: boolean;
}
```

## LayeredChartDepth

Per surface: its distance, blur diameter and whether it lies within the depth of field.

```ts
export interface LayeredChartDepth {
  kind: "card" | "back-plane";
  index: number;
  distanceM: number;
  /** Geometric blur-circle diameter in sites (`calculateDefocusCircle` / pitch); 0 at the focus distance. */
  defocusDiameterSites: number;
  /**
   * Signed blur radius in sites, +c/2 behind the focus plane and −c/2 in front of it: the layered sum's ray map (the image of
   * pupil point P at this surface is offset by this radius times P).
   */
  signedBlurRadiusSites: number;
  /** Between the near and far limits of `calculateDepthOfField` at the circle of confusion. */
  withinDepthOfField: boolean;
}
```

## LayeredChartPointLights

Point lights on the back plane: a seeded, jittered grid over the frame.

```ts
export interface LayeredChartPointLights {
  /** Seed of the jitter (an unsigned 32-bit integer). */
  seed: number;
  /** Grid columns and rows over the frame, 1 to 256 each. */
  columns: number;
  rows: number;
  /** Jitter of each light within its grid cell, a fraction of the cell in [0, 1). Default 0.5. */
  jitter?: number;
  /** Luminous intensity of each light, candela, (0, 1e7]. */
  luminousIntensityCandela: number;
  /** Relative spectrum of the lights. Default CIE illuminant A. */
  spectrum?: CaptureIlluminant;
}
```

## LayeredChartScene

A layered chart scene (`scene.kind: "layered-chart"`).

```ts
export interface LayeredChartScene {
  kind: "layered-chart";
  /** 1 to {@link LAYERED_CHART_LIMITS}.maximumCards cards, nearest first, at strictly increasing distances. */
  cards: readonly LayeredChartCard[];
  backPlane?: LayeredChartBackPlane;
}
```

## LayeredFrameRectangle

A frame-unit rectangle, u0 ≤ u ≤ u1, v0 ≤ v ≤ v1.

```ts
export interface LayeredFrameRectangle { u0: number; v0: number; u1: number; v1: number }
```

## ResolvedLayeredChartScene

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedLayeredChartScene {
  kind: "layered-chart";
  /** Cards nearest first, then the back plane when there is one. The last surface is the far surface (rect null). */
  surfaces: readonly ResolvedLayeredSurface[];
  /** True for one card and no back plane: a single-plane chart scene (the facade's existing path). */
  singlePlane: boolean;
  /** Frame aspect (height / width) the scene was resolved for. */
  aspect: number;
}
```

## ResolvedLayeredSurface

One resolved surface, nearest first.

```ts
export interface ResolvedLayeredSurface {
  kind: "card" | "back-plane";
  /** Card index in the scene's `cards`, or −1 for the back plane. */
  index: number;
  distanceM: number;
  /** The surface's rectangle in frame units; null for the far surface, which has no edge. */
  rect: LayeredFrameRectangle | null;
  /** Reflectance materials of the surface's print. */
  materials: ResolvedChartScene["materials"];
  /** The material at a frame point (u, v as seen from the lens), defined everywhere (prints continue beyond their card). */
  materialAt(u: number, v: number): number;
  /** Back plane with lights: the lights' frame positions and spectral intensity, W·sr⁻¹·nm⁻¹. */
  lights?: { u: Float64Array; v: Float64Array; pitchU: number; pitchV: number; columns: number; rows: number; intensityAt(nm: number): number };
}
```

## resolveLayeredChartPreset

The staircase preset: `cards` cards (default 5, 1 to 9) with one at the focus distance, the rest stepping back and to the right,
each overlapping the one behind it, and a back plane with a grid of point lights one step beyond the farthest card.

Spacing. Behind the focus plane the steps grow geometrically from the scale's first step (`macro` 1 mm, `tabletop` 1 cm,
`large` 0.25 m) by {@link LAYERED_CHART_PRESET_STEP_RATIO}: d_i = s + first·(1 + 1.5 + … + 1.5^(i−1)). In front of it the cards
are placed symmetric in defocus: the blur diameter c = f²·|s − d|/(N·d·(s − f)) is proportional to |s − d|/d, so the front
card matching d_i is at s·d_i/(2·d_i − s), whatever the lens. More cards then sit where sharpness changes fastest.
Each card shows a Siemens star and its depth label. The lights' intensity, 0.05 cd per square metre of distance, gives every
scale the same illuminance at the lens (a starting value, to be revisited once the presets can be looked at).

```ts
export function resolveLayeredChartPreset(input: { scale: keyof typeof LAYERED_CHART_PRESET_SCALES; cards?: number; focusDistanceM: number;
  lens: { focalLengthMm: number }; aspect?: number; pointLights?: boolean }): LayeredChartScene;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
