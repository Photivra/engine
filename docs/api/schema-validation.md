# schema/validation.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parseCameraConfiguration

Parses and validates an untrusted camera configuration.

```ts
export function parseCameraConfiguration(
  value: unknown
): CameraConfiguration;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSceneDefinition

Parses and validates an untrusted renderer-independent scene definition.

```ts
export function parseSceneDefinition(value: unknown): SceneDefinition;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
