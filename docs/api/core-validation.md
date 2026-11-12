# core/validation.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## InvalidScientificInputError

Error thrown when a public scientific calculation receives invalid input.

```ts
export class InvalidScientificInputError extends RangeError {
  readonly code = "INVALID_SCIENTIFIC_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidScientificInputError";
  }
}
```

## InvalidScientificResultError

Error thrown when a calculation would return a non-finite number (NaN or ±Infinity).
Such values cannot be stored in JSON and break downstream consumers.

```ts
export class InvalidScientificResultError extends RangeError {
  readonly code = "INVALID_SCIENTIFIC_RESULT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidScientificResultError";
  }
}
```
