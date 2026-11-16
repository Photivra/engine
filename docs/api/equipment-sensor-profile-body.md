# equipment/sensor-profile-body.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## resolveSensorProfileIsoSettings

#635: the profile's ISO settings, the third-stop markings from its base ISO to its maximum ({@link SENSOR_PROFILE_ISO_MARKINGS}): the
values `exposure.iso` takes with this profile, in ascending order. The record is checked as a capture checks it.

```ts
export function resolveSensorProfileIsoSettings(profile: SensorProfile): readonly number[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SENSOR_PROFILE_ISO_ANCHOR

The engine's ISO anchor (see the module comment): white charge 60 000 e⁻ at ISO 100, 36 µm², QE 0.5.

```ts
SENSOR_PROFILE_ISO_ANCHOR = Object.freeze({ iso: 100, fullWellElectrons: 60000, pixelAreaSquareMicrometers: 36, peakQuantumEfficiency: .5 })
```
