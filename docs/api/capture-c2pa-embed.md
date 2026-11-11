# capture/c2pa-embed.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## bindC2paManifestStore

Embeds a placeholder C2PA Manifest Store in a JPEG or TIFF/DNG export and returns the new file with its hard binding:
the exclusions for `c2pa.hash.data` and where the store sits (C2PA 2.4 §A.3.1, §A.3.6, §18.5, §10.4; see the module notes).
The input file is not changed. Only the first store of a file can be added; a file that already has one is rejected.

```ts
export function bindC2paManifestStore(input: BindC2paManifestStoreInput): C2paBoundFile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## BindC2paManifestStoreInput

Input of `bindC2paManifestStore`.

```ts
export interface BindC2paManifestStoreInput {
  /** A JPEG, or a TIFF-based file such as a DNG, as written by the engine's exporters. It is read, never changed. */
  file: Uint8Array;
  /**
   * The placeholder store (§10.4): a JUMBF C2PA Manifest Store sized for the final signature. For JPEG it may instead be the
   * same store already split into APP11 segments (what the C2PA reference SDK's placeholder call returns), as long as that
   * split is the one described above.
   */
  manifestStore: Uint8Array;
}
```

## C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE

IPTC digital source type for media created purely by an algorithm (https://cv.iptc.org/newscodes/digitalsourcetype/).

```ts
C2PA_ALGORITHMIC_MEDIA_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia" as const
```

## C2PA_MANIFEST_STORE_MAXIMUM_BYTES

Largest manifest store the engine embeds, bytes (an engine limit, not a C2PA one).

```ts
C2PA_MANIFEST_STORE_MAXIMUM_BYTES = 33_554_432
```

## C2paBoundFile

A file with a manifest store embedded, and its binding.

```ts
export interface C2paBoundFile { bytes: Uint8Array; binding: C2paHardBinding }
```

## C2paByteRange

A byte range of a file: `start` is a zero-based offset, `length` a byte count.

```ts
export interface C2paByteRange { start: number; length: number }
```

## C2paDataHash

SHA-256 over every byte of the file outside the exclusions, in file order (§18.5): the `hash` of `c2pa.hash.data`.

```ts
export interface C2paDataHash { alg: "sha256"; hash: Uint8Array; hashHex: string; hashedByteCount: number }
```

## C2paHardBinding

Where the manifest store sits in a file and which bytes the data hash excludes. Plain data: it can be kept, sent to a
worker or serialized, and must be passed back unchanged to `setC2paManifestStore`.

```ts
export interface C2paHardBinding {
  /** `image/jpeg`, or for TIFF files `image/dng` when the main IFD has DNGVersion (50706), otherwise `image/tiff`. */
  mediaType: "image/jpeg" | "image/dng" | "image/tiff";
  /** Length of the file with the store embedded, bytes. */
  fileLength: number;
  /** The `exclusions` of the `c2pa.hash.data` assertion, ascending and non-overlapping (§18.5). */
  exclusions: readonly C2paByteRange[];
  /** JPEG: every C2PA APP11 segment, markers and length fields included. TIFF/DNG: the store's own bytes. */
  manifestRegion: C2paByteRange;
  /** Length of the JUMBF manifest store itself, bytes. A replacement store must have exactly this length. */
  manifestStoreLength: number;
}
```

## calculateC2paDataHash

SHA-256 over every byte of a file outside the given exclusions, in file order: the value of `hash` in a `c2pa.hash.data`
assertion with `alg` "sha256" (C2PA 2.4 §18.5). It uses Web Crypto (`crypto.subtle`, browsers in secure contexts and
Node 22+). The bytes outside the exclusions are copied once into one array before hashing.

```ts
export async function calculateC2paDataHash(input: CalculateC2paDataHashInput): Promise<C2paDataHash>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## CalculateC2paDataHashInput

Input of `calculateC2paDataHash`.

```ts
export interface CalculateC2paDataHashInput {
  /** The bound file. */
  file: Uint8Array;
  /** The binding's exclusions (or any ascending, non-overlapping ranges inside the file). */
  exclusions: readonly C2paByteRange[];
}
```

## setC2paManifestStore

Writes the final, signed manifest store over the placeholder of a bound file (C2PA 2.4 §10.4.4). The store must have
exactly the placeholder's length, so the file's length, every offset and every byte outside the exclusions stay the same
and the data hash computed before signing still holds. The binding is checked against the file first.

```ts
export function setC2paManifestStore(input: SetC2paManifestStoreInput): Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SetC2paManifestStoreInput

Input of `setC2paManifestStore`.

```ts
export interface SetC2paManifestStoreInput {
  /** The bound file (`C2paBoundFile.bytes`). It is read, never changed. */
  file: Uint8Array;
  /** The binding `bindC2paManifestStore` returned for it. */
  binding: C2paHardBinding;
  /** The final, signed store: exactly `binding.manifestStoreLength` bytes, as JUMBF or (JPEG) in the same APP11 split. */
  manifestStore: Uint8Array;
}
```
