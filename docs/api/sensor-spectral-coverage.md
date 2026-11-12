# sensor/spectral-coverage.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSensorSpectralCoverageParticipant

Converts one parsed sensor response channel into the shared continuous
spectral-coverage format.

It gives only the wavelength range and interpolation breakpoints. It does not
apply QE or A/W responsivity, and says nothing about scene or optics coverage.

```ts
export function createSensorSpectralCoverageParticipant(
  input:
    CreateSensorSpectralCoverageParticipantInput
): SpectralCoverageParticipant;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateSensorSpectralCoverageParticipantInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateSensorSpectralCoverageParticipantInput {
  spectralResponseProfile:
    SensorSpectralResponseProfile;
  channelId: string;
  participantId?: string;
}
```
