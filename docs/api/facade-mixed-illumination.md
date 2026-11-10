# facade/mixed-illumination.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## MixedIllumination

2.22 (#550), `simulateCapture` `illumination`: two or more sources blended across the chart (docs/MIXED_ILLUMINATION.md). It
replaces `illuminant` and `illuminanceLux`. Coordinates are chart-local with `chartSize` and frame units without it; (0, 0) is
the frame center.

```ts
export interface MixedIllumination {
  sources: readonly MixedIlluminationSource[];
  blend: MixedIlluminationBlend;
}
```

## MixedIlluminationBlend

How the sources blend across the chart. `linear-gradient` and `radial` map a point to a position t in [0, 1] (its projection
onto `from` → `to`, clamped; or its distance from `center` over `radius`, clamped) and crossfade linearly between consecutive
sources at their `stops` (one per source, non-decreasing in [0, 1]; default evenly spaced from 0 to 1): source 0 alone up to
stops[0], the last source alone from its stop on, and two equal stops a hard edge (the later source from the stop on).
`regions` gives each point the source of the first rectangle that contains it (bounds inclusive) and `outsideSource` elsewhere.

```ts
export type MixedIlluminationBlend =
  | { kind: "linear-gradient"; from: MixedIlluminationPoint; to: MixedIlluminationPoint; stops?: readonly number[] }
  | { kind: "radial"; center?: MixedIlluminationPoint; radius: number; stops?: readonly number[] }
  | { kind: "regions"; regions: readonly { source: number; uMin: number; uMax: number; vMin: number; vMax: number }[]; outsideSource: number };
```

## MixedIlluminationPoint

A point in chart coordinates (see {@link MixedIllumination}).

```ts
export interface MixedIlluminationPoint { u: number; v: number }
```

## MixedIlluminationSource

One light source of a mixed illumination: an illuminant (as `simulateCapture` `illuminant` takes it) at an illuminance.

```ts
export interface MixedIlluminationSource {
  illuminant: CaptureIlluminant;
  /** Illuminance this source alone gives where its weight is 1, lux, (0, 1e7]. */
  illuminanceLux: number;
}
```
