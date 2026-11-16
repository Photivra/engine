# output/text-metadata.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

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
