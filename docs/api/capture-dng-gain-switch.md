# capture/dng-gain-switch.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DNG_GAIN_SWITCH_CATALOG

The curated list (empty in 2.24.0; see the module comment for how to add an entry).

```ts
DNG_GAIN_SWITCH_CATALOG: readonly DngGainSwitchEntry[] = Object.freeze([])
```

## DngGainSwitchEntry

One camera's dual-gain switch point with its source.

```ts
export interface DngGainSwitchEntry {
  /** The file's Make tag (271). */
  make: string;
  /** The file's Model tag (272). */
  model: string;
  /** The ISO setting from which the high conversion gain is used for photos, or null for one conversion gain. */
  highGainFromIso: number | null;
  /** Where the value is stated, and on what terms it is reused. */
  source: { title: string; url: string; terms: string; accessed: string };
}
```

## resolveDngGainSwitch

The catalog's entry for an imported file's camera (its Make and Model), or null when the camera is not on the list.

```ts
export function resolveDngGainSwitch(raw: { make: string | null; model: string | null }): DngGainSwitchEntry | null;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
