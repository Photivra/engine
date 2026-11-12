# optics/diffraction.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AiryDisk

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AiryDisk {
  /**
   * Diameter of the first dark ring of the diffraction pattern, in
   * micrometres: 2.44 * wavelength * f-number.
   */
  firstZeroDiameterMicrometers: number;
}
```

## calculateAiryDisk

Calculates the Airy-disk diameter to the first dark ring for an ideal
circular aperture.

It uses the standard diffraction relation d = 2.44 * lambda * N. This is an
independent implementation of that relation. It does not model lens
aberrations or non-circular pupils.

```ts
export function calculateAiryDisk(
  input: CalculateAiryDiskInput
): CalculationResult<AiryDisk>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateAiryDiskInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateAiryDiskInput {
  /** F-number. */
  aperture: number;
  /** Wavelength in nanometres. Defaults are intentionally left to callers. */
  wavelengthNm: number;
}
```
