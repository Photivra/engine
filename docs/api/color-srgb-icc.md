# color/srgb-icc.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createSrgbIccProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export function createSrgbIccProfile():Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SRGB_ICC_PROFILE_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SRGB_ICC_PROFILE_VERSION="0.1.0" as const
```
