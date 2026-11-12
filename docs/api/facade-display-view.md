# facade/display-view.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## bindDisplayViewCorrectionStates

2.10 (#447), deprecated in 2.22.0: added states another realm computed to this realm's cache. The display view keeps no
correction states since 2.22.0, so this checks `entries` as before (an array of `{ key, gridKeys, values }` with a non-empty
string key, an Int32Array of grid keys and a Float64Array of 3 finite values per key; otherwise an
InvalidConfigurationError) and returns 0: nothing is stored and no render reads them. Kept until 3.0.0.

```ts
export function bindDisplayViewCorrectionStates(entries: readonly DisplayViewCorrectionStateSet[]): number;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DisplayViewCorrectionStateKeys

2.10 (#447), deprecated in 2.22.0: the grid keys of the states a region needs (`PreparedDisplayView.collectCorrectionStates`).

```ts
export interface DisplayViewCorrectionStateKeys { key: string; gridKeys: Int32Array }
```

## DisplayViewCorrectionStateSet

2.10 (#447), deprecated in 2.22.0: the AHD low-signal correction states of one setup, as a realm sent them to another. The
display view keeps no correction states since 2.22.0, so {@link serializeDisplayViewCorrectionStates} returns none.
Kept until 3.0.0.

```ts
export interface DisplayViewCorrectionStateSet { key: string; gridKeys: Int32Array; values: Float64Array }
```

## serializeDisplayViewCorrectionStates

2.10 (#447), deprecated in 2.22.0: returned the AHD low-signal correction states this realm held. The display view keeps no
correction states since 2.22.0 (the correction was removed; docs/DISPLAY_VIEW.md, "AHD at low signal"), so this returns an
empty array. Kept until 3.0.0.

```ts
export function serializeDisplayViewCorrectionStates(): DisplayViewCorrectionStateSet[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
