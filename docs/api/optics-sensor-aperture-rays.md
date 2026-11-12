# optics/sensor-aperture-rays.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorApertureRays

Polar midpoint rule with equal-area cells. Weights are normalized as an average, so they never
apply the f-number a second time.

```ts
export function calculateSensorApertureRays(input: CalculateSensorApertureRaysInput): CalculationResult<SensorApertureRays>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorApertureRaysInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorApertureRaysInput {
  sourcePointNativeSensorMm: { x: number; y: number };
  focalLengthMm: number;
  nominalFNumber: number;
  focus: FocusPlane;
  pupil: IdealCircularPupil;
  angularVelocityRadPerSec: CameraAngularVelocityRadPerSec;
  timeSecondsFromOpeningReference: number;
}
```

## IdealCircularPupil

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface IdealCircularPupil {
  kind: "ideal-uniform-circular-pupil";
  radialSampleCount: number;
  angularSampleCount: number;
  evidence: readonly EvidenceProvenance[];
  limitation: string;
}
```

## SensorApertureRay

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorApertureRay {
  /** Lens principal-plane origin and look direction in exposure-opening camera axes. */
  originM: { x: number; y: number; z: number };
  directionUnitVector: { x: number; y: number; z: number };
  pupilPointMm: { x: number; y: number };
  weight: number;
  pupilSampleIndex: number;
}
```

## SensorApertureRays

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorApertureRays {
  rays: readonly SensorApertureRay[];
  projectionDistanceMm: number;
  pupilRadiusMm: number;
  focus: FocusPlane;
  pupil: IdealCircularPupil;
  sceneVisibilityCalculated: false;
  radiometryCalculated: false;
  apertureAreaApplied: false;
}
```
