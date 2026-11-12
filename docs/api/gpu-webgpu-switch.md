# gpu/webgpu-switch.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## getWebGpuEnabled

Whether this realm may use WebGPU when a caller asks for it.

```ts
export function getWebGpuEnabled(): boolean;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## setWebGpuEnabled

Turns WebGPU on (`true`, the default) or off (`false`) for this realm. Anything but a boolean is refused.

```ts
export function setWebGpuEnabled(enabled: boolean): void;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
