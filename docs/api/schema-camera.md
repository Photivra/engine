# schema/camera.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CameraConfiguration

Renderer-independent camera configuration consumed by simulation modules.

```ts
export interface CameraConfiguration {
  sensor: SensorConfiguration;
  lens: LensConfiguration;
  exposure: ExposureConfiguration;
  focus: FocusConfiguration;
  stabilization?: StabilizationConfiguration;
}
```

## CameraSupport

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type CameraSupport = "handheld" | "braced" | "monopod" | "tripod";
```

## ExposureConfiguration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ExposureConfiguration {
  shutterSeconds: number;
  iso: number;
}
```

## FocusConfiguration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FocusConfiguration {
  focusDistanceM: number;
}
```

## LensConfiguration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface LensConfiguration {
  focalLengthMm: number;
  aperture: number;
}
```

## SensorConfiguration

The legacy CameraConfiguration: one set of camera settings, with units, for the
proof-of-concept (POC) simulation. It is not a full description of what a camera can do.

Its parser is in schema/validation. Newer ISO and exposure capabilities are separate types,
so adding a control policy never changes the meaning of saved POC data.

```ts
export interface SensorConfiguration {
  widthMm: number;
  heightMm: number;
  pixelWidth: number;
  pixelHeight: number;
}
```

## StabilizationConfiguration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StabilizationConfiguration {
  bodyEnabled: boolean;
  lensEnabled: boolean;
  support: CameraSupport;
}
```
