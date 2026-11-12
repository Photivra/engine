# facade/image-plane-enable.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## prepareImagePlaneScenes

2.21 (#581): enables `{ kind: "image-plane" }` scenes (a photo as a flat print, docs/IMAGE_PLANE.md) in this JavaScript realm by
loading their module (a lazy chunk of about 14 KB gzip with its lattice data). Call it once, in the worker that captures, before
the first request with such a scene; later calls resolve at once. A request with an image-plane scene before it fails with a
message saying so.

```ts
export async function prepareImagePlaneScenes(): Promise<void>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
