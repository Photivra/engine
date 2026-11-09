# optics/aperture-diameter.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ApertureDiameter

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ApertureDiameter {
  /** Focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** f-number supplied by the caller. */
  fNumber: number;
  /** Entrance-pupil diameter D = focalLengthMm / fNumber, in millimetres. */
  entrancePupilDiameterMm: number;
}
```

## calculateApertureDiameter

Entrance-pupil (aperture) diameter in millimetres: focal length ÷ f-number.

Exact by the definition of the f-number for an ideal lens focused at infinity. It is the
entrance pupil (the aperture stop as seen from the front), not the diaphragm's physical
opening. Close focus (working f-number N·(1 + m/P) with pupil magnification P) and focal-length
changes while focusing are not modelled.

Example: 50 mm at f/2 gives 25 mm; at f/4, 12.5 mm (half the diameter, a quarter of the area:
two stops).

```ts
export function calculateApertureDiameter(
  input: CalculateApertureDiameterInput
): CalculationResult<ApertureDiameter>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateApertureDiameterInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateApertureDiameterInput {
  /** Focal length of the lens in millimetres (the physical focal length, not a 35 mm equivalent). */
  focalLengthMm: number;
  /** f-number set on the lens (N = focal length / entrance-pupil diameter). */
  fNumber: number;
}
```
