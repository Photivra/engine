# equipment/generic-iso-settings.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GENERIC_THIRD_STOP_ISO_SETTINGS

Third-stop ISO settings of the 2.1.0 bodies: the conventional rounded markings of S = 100·2^(k/3), k = 0 … 24 (125 for
126.0, 160 for 158.7 …; each within 2 % of the exact value). The engine takes the setting as the exact ISO speed.

```ts
GENERIC_THIRD_STOP_ISO_SETTINGS = Object.freeze([100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600] as const)
```

## GENERIC_WHOLE_STOP_ISO_SETTINGS

Whole-stop ISO settings of the 2.0.0 bodies (each body's list stops at its maximum).

```ts
GENERIC_WHOLE_STOP_ISO_SETTINGS = Object.freeze([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] as const)
```
