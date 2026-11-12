# sensor/pixel-pitch.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePixelPitch

Calculates horizontal pixel pitch from active sensor width and pixel count.

```ts
export function calculatePixelPitch(
  input: CalculatePixelPitchInput
): CalculationResult<PixelPitch>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculatePixelPitchInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculatePixelPitchInput {
  /** Physical sensor width in millimetres. */
  sensorWidthMm: number;
  /** Horizontal active pixel count. */
  pixelWidth: number;
}
```

## PixelPitch

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PixelPitch {
  /** Horizontal pixel pitch in micrometres. */
  micrometers: number;
  /** Horizontal pixel pitch in millimetres. */
  millimeters: number;
}
```
