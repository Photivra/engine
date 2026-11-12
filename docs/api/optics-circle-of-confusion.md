# optics/circle-of-confusion.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## EquivalentViewingCircleOfConfusion

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EquivalentViewingCircleOfConfusion {
  circleOfConfusionMm: number;
  sensorDiagonalMm: number;
  referenceSensorDiagonalMm: number;
  scaleFactor: number;
}
```

## estimateEquivalentViewingCircleOfConfusion

Estimates a circle-of-confusion criterion for equivalent final viewing. It
scales a caller-supplied reference criterion in proportion to the sensor
diagonal.

This is a viewing (acceptable-sharpness) convention, not a physical blur
threshold.

```ts
export function estimateEquivalentViewingCircleOfConfusion(
  input: EstimateEquivalentViewingCircleOfConfusionInput
): CalculationResult<EquivalentViewingCircleOfConfusion>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateEquivalentViewingCircleOfConfusionInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateEquivalentViewingCircleOfConfusionInput {
  sensorWidthMm: number;
  sensorHeightMm: number;
  referenceSensorWidthMm: number;
  referenceSensorHeightMm: number;
  referenceCircleOfConfusionMm: number;
}
```
