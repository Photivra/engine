# core/version.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ENGINE_API_VERSION

Version of the engine release. Since 1.0.1 it equals the npm package version.

New captures and plans record this version as their creator. Archived records keep the
version they were made with. Proof-of-concept (POC), schema and model contracts have their
own versions. Release checks confirm it matches package.json and the packed package.

```ts
ENGINE_API_VERSION = "2.19.0" as const
```
