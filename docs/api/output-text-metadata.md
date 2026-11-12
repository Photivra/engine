# output/text-metadata.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## addJpegTextMetadata

Returns a copy of a baseline JPEG with the text fields added: merged into its XMP APP1 packet (or a new packet
after the last leading APPn segment when it has none), plus a COM segment for `comment`. Every other byte,
including the entropy-coded data, is unchanged. Reads marker segments only up to SOS. The engine's own
`output.metadata` path calls this function, so for the same JPEG and text the bytes are the same.

Root export (#388). `metadata` is checked as `output.metadata` is (see the module notes); a JPEG without SOI,
a malformed or truncated segment before SOS, an XMP APP1 segment after a non-APPn segment, an XMP packet that is
not UTF-8 or has no `rdf:RDF`, or text that makes the packet larger than one APP1 segment fails with
`InvalidConfigurationError`. The input is not changed.

```ts
export function addJpegTextMetadata(jpeg: Uint8Array, metadata: Readonly<OutputTextMetadata>): Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## addPngTextMetadata

Returns a copy of a PNG with one text chunk per field inserted before the first IDAT chunk. Other chunks are
unchanged. The engine's own `output.metadata` path calls this function, so for the same PNG and text the bytes
are the same.

Root export (#388). `metadata` is checked as `output.metadata` is (see the module notes); a file without the PNG
signature, or without an IDAT chunk inside its bytes, fails with `InvalidConfigurationError`. Chunk CRCs before
IDAT are not checked. The input is not changed.

```ts
export function addPngTextMetadata(png: Uint8Array, metadata: Readonly<OutputTextMetadata>): Uint8Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## OutputTextMetadata

Caller-supplied text written into JPEG, PNG and DNG outputs. Every field is optional; at least one must be set.

```ts
export interface OutputTextMetadata {
  /** What the image shows. JPEG/DNG `dc:description`, PNG Description, DNG ImageDescription (appended when ASCII). */
  description?: string;
  /** Name and version of the caller's software. JPEG/DNG `xmp:CreatorTool`, PNG Software. */
  software?: string;
  /** Rights statement. JPEG/DNG `dc:rights`; the PNG keyword and DNG tag 33432 (when ASCII) of the same name. */
  copyright?: string;
  /** Free-text comment. JPEG COM segment and `exif:UserComment`, PNG Comment, DNG `exif:UserComment`. */
  comment?: string;
}
```
