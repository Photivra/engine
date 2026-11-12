# capture/jpeg-xl-tiles.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createJxlOxideDngDecoder

A {@link DngJpegXlDecoder} over jxl-oxide-wasm: `forceSrgb` off (the samples stay in the codestream's encoding), one render per
tile, and the image object freed after it. Usage: `import init, * as jxl from "jxl-oxide-wasm"; await init();
createJxlOxideDngDecoder(jxl)`.

```ts
export function createJxlOxideDngDecoder(module: JxlOxideModule): DngJpegXlDecoder;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DngJpegXlDecoder

Decodes one JPEG XL codestream (a DNG strip or tile) to PNG bytes in the codestream's own colour encoding (no colour conversion).

```ts
export type DngJpegXlDecoder = (codestream: Uint8Array) => Uint8Array | Promise<Uint8Array>;
```

## JxlOxideModule

The part of the jxl-oxide-wasm module the adapter uses (its `JxlImage` class, after the module's `init`).

```ts
export interface JxlOxideModule {
  JxlImage: new () => { feedBytes(bytes: Uint8Array): unknown; tryInit(): boolean; render(): { encodeToPng(): Uint8Array }; forceSrgb: boolean; free(): void };
}
```
