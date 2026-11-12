# color/sensor-color-development.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## RAW_HIGHLIGHT_RECONSTRUCTION_START

Normalized channel level where `reconstruct` starts blending toward neutral.

```ts
RAW_HIGHLIGHT_RECONSTRUCTION_START = 0.8
```

## RawHighlightMode

RAW development highlight policy; see the module notes.

```ts
export type RawHighlightMode = "clip" | "reconstruct";
```

## SENSOR_COLOR_DEVELOPMENT_MODEL

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SENSOR_COLOR_DEVELOPMENT_MODEL = Object.freeze({ id: "sensor-color-development", version: "2.0.0" } as const)
```
