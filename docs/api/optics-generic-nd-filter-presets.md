# optics/generic-nd-filter-presets.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_ND_FILTER_PROFILES

Frozen generic ND filter profiles keyed by stops: `GENERIC_ND_FILTER_PROFILES[10]` transmits
exactly 1/1024. Spectrally flat over 380–780 nm (air), idealized (`scientificStatus:
"approximation"`), unbranded. 1/125 s with the 10-stop preset gives 1024/125 ≈ 8.19 s in
`calculateFilteredExposureTime`.

```ts
GENERIC_ND_FILTER_PROFILES: Readonly<Record<GenericNdFilterStops, FrontOfLensFilterProfile>> = freezeOwnedData({
  3: idealNdProfile(3),
  6: idealNdProfile(6),
  10: idealNdProfile(10)
})
```

## GENERIC_ND_FILTER_STOPS

Attenuations, in stops, of the generic ND presets.

```ts
GENERIC_ND_FILTER_STOPS = Object.freeze([3, 6, 10] as const)
```

## GenericNdFilterStops

One of the generic ND preset attenuations: 3, 6 or 10 stops.

```ts
export type GenericNdFilterStops = (typeof GENERIC_ND_FILTER_STOPS)[number];
```
