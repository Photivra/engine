# core/pixel-limits.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## FULL_RESOLUTION_CEILING_PIXELS

Hard ceiling of an opt-in raised pixel limit: 2^27 = 134 217 728 pixels (16 384 × 8 192).

```ts
FULL_RESOLUTION_CEILING_PIXELS = 134_217_728
```

## FULL_RESOLUTION_DEFAULT_PIXELS

Default pixel limit of the full-resolution stages.

```ts
FULL_RESOLUTION_DEFAULT_PIXELS = 24_000_000
```
