# facade/layered-scene-enable.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## prepareLayeredChartScenes

2.27.0 (#652): enables `{ kind: "layered-chart" }` scenes (docs/LAYERED_SCENES.md) in this JavaScript realm by loading their
code (a lazy chunk of about 10 KB gzip). Call it once, in the worker that captures, before the first request with such a scene;
later calls resolve at once. A request with a layered scene before it fails with a message saying so.

```ts
export async function prepareLayeredChartScenes(): Promise<void>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
