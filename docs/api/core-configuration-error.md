# core/configuration-error.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## InvalidConfigurationError

Error thrown when external configuration data does not match a public
runtime schema.

```ts
export class InvalidConfigurationError extends TypeError {
  readonly code = "INVALID_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigurationError";
  }
}
```
