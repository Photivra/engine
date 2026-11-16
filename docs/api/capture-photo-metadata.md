# capture/photo-metadata.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## parsePhotoMetadata

Reads the capture metadata of a JPEG, HEIC/HEIF or (2.26.0) PNG file from its headers: the Exif capture settings (exposure time,
f-number, the ISO fields, focal length, FocalLengthIn35mmFilm, DigitalZoomRatio, CompositeImage, the focal-plane
resolution), make, model, Software, Orientation and the image size, and the extra images and annotations the file declares
(by type and size only). No pixel data is decoded, and maker notes and GPS data are never read.

Input is untrusted: every read is bounded (see {@link PHOTO_METADATA_LIMITS}), and a malformed or truncated part is named in
`assumptions` and skipped.

```ts
export function parsePhotoMetadata(input: PhotoMetadataInput): PhotoMetadata;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PHOTO_METADATA_LIMITS

The bounds every read is checked against.

```ts
PHOTO_METADATA_LIMITS = Object.freeze({
  /** JPEG marker segments walked per image (the primary and each Multi-Picture Format entry). */
  maximumJpegSegments: 4096,
  /** Boxes walked per HEIF box level. */
  maximumBoxes: 4096,
  /** HEIF items, references and property associations read. */
  maximumItems: 4096,
  /** Entries in one Exif or MPF IFD. */
  maximumIfdEntries: 1024,
  /** Multi-Picture Format entries read. */
  maximumMpfEntries: 64,
  /** Bytes copied for one HEIF Exif or XMP item, or an assembled extended XMP packet. */
  maximumItemDataBytes: 4_194_304,
  /** XMP namespaces returned per packet. */
  maximumXmpNamespaces: 256,
  /** 2.26.0 (#647): PNG chunks walked (their data is skipped by its length, never decoded). */
  maximumPngChunks: 4096
})
```

## PHOTO_METADATA_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PHOTO_METADATA_SCHEMA_VERSION = "1.0.0" as const
```

## PHOTO_METADATA_XMP_NAMESPACES

Published XMP namespaces the reader classifies, with the kind of annotation each declares. Any other namespace is still
listed in `xmpNamespaces`.

```ts
PHOTO_METADATA_XMP_NAMESPACES: Readonly<Record<string, "gain-map" | "depth-map" | "embedded-image" | "container">> = Object.freeze({
  /** Adobe gain map (hdrgm), as Android Ultra HDR also uses it. */
  "http://ns.adobe.com/hdr-gain-map/1.0/": "gain-map",
  /** Google depth map (GDepth). */
  "http://ns.google.com/photos/1.0/depthmap/": "depth-map",
  /** Google Dynamic Depth depth map. */
  "http://ns.google.com/photos/dd/1.0/depthmap/": "depth-map",
  /** Google embedded image (GImage). */
  "http://ns.google.com/photos/1.0/image/": "embedded-image",
  /** Google container (Container:Directory), whose items are read for their Semantic and Length. */
  "http://ns.google.com/photos/1.0/container/": "container"
})
```

## PhotoAnnotation

A marker in the metadata that declares a rendition or a map, without its data being read.

```ts
export interface PhotoAnnotation {
  /**
   * "gain-map", "depth-map" or "embedded-image" (a namespace of {@link PHOTO_METADATA_XMP_NAMESPACES}, or ISO 21496-1 gain-map
   * metadata in a JPEG APP2 segment), or "container-item" (one item of a Google container directory).
   */
  kind: "gain-map" | "depth-map" | "embedded-image" | "container-item";
  source: "xmp" | "jpeg-app2-iso-21496-1";
  /** The XMP namespace, or null for the APP2 segment. */
  namespace: string | null;
  /** A container item's Semantic ("Primary", "GainMap", ...), or null. */
  label: string | null;
  /** A container item's Length in bytes, or the APP2 segment's size, or null. */
  bytes: number | null;
  /** Index into `extraImages` of the image whose metadata holds the marker, or null for the primary image. */
  image: number | null;
}
```

## PhotoExif

The Exif block's capture settings ({@link ExifCaptureFields}, as the DNG import returns them) and its IFD 0 identity tags.

```ts
export interface PhotoExif extends ExifCaptureFields {
  /** Make (0x010F), or null. */
  make: string | null;
  /** Model (0x0110), or null. */
  model: string | null;
  /** Software (0x0131), or null. */
  software: string | null;
  /** Orientation (0x0112), 1..8, or null when absent or out of range. */
  orientation: number | null;
}
```

## PhotoExtraImage

One extra image the file declares. Its pixels are not decoded.

```ts
export interface PhotoExtraImage {
  /**
   * Where it is declared: the Exif IFD 1 thumbnail, a Multi-Picture Format entry, a HEIF auxiliary image (auxC), a HEIF
   * thumbnail (a thmb reference), a HEIF tone-map derived item (tmap, ISO 21496-1) or its gain-map input, or another HEIF
   * image item that is not the primary image or one of its tiles.
   */
  source: "exif-thumbnail" | "jpeg-mpf" | "heif-auxiliary" | "heif-thumbnail" | "heif-tone-map" | "heif-gain-map-input" | "heif-image";
  kind: PhotoExtraImageKind;
  /**
   * How `kind` was decided: "specification" (a code or URN the format's specification defines), "name" (words in a maker's
   * auxiliary-type URN, such as "hdrgainmap" or "matte"), "xmp" (a published namespace in the image's own XMP) or "none" (kind
   * is "other").
   */
  kindBasis: "specification" | "name" | "xmp" | "none";
  /** The declared type as stored: the auxC URN, the MPF type code ("0x020002"), the HEIF item type ("hvc1", "tmap") or "jpeg". */
  type: string;
  width: number | null;
  height: number | null;
  /** Stored bytes (the MPF entry size, the thumbnail length or the HEIF item's extents), or null when not stated. */
  bytes: number | null;
}
```

## PhotoExtraImageKind

What an extra image is.

```ts
export type PhotoExtraImageKind = "thumbnail" | "large-thumbnail" | "gain-map" | "tone-mapped" | "depth" | "disparity" | "alpha" | "matte" | "panorama-frame"
  | "multi-angle-frame" | "other";
```

## PhotoMetadata

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PhotoMetadata {
  schemaVersion: typeof PHOTO_METADATA_SCHEMA_VERSION;
  /** 2.26.0 (#647): "png" for a PNG file (its eXIf chunk and IHDR size). */
  format: "jpeg" | "heif" | "png";
  /** HEIF: the ftyp major brand then the compatible brands; empty for a JPEG. */
  brands: string[];
  /** The primary image's stored size (JPEG frame header; HEIF ispe of the primary item; PNG IHDR), before any rotation, or null. */
  width: number | null;
  height: number | null;
  /**
   * HEIF only: the primary item's transformative properties, which a HEIF reader applies for display: irot (anticlockwise
   * rotation, degrees) and imir (0 mirrors about a vertical axis, 1 about a horizontal axis), or null when absent. An Exif
   * Orientation in a HEIF file is returned in `exif` as stored.
   */
  heifRotationDegrees: 0 | 90 | 180 | 270 | null;
  heifMirrorAxis: 0 | 1 | null;
  /** The primary image's Exif block, or null when the file has none (or it could not be read; see `assumptions`). */
  exif: PhotoExif | null;
  /** XMP namespaces declared by the primary image's XMP, sorted. */
  xmpNamespaces: string[];
  extraImages: PhotoExtraImage[];
  annotations: PhotoAnnotation[];
  /** What was skipped: malformed or truncated parts, ignored tags, data beyond the supplied bytes. */
  assumptions: string[];
}
```

## PhotoMetadataInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PhotoMetadataInput {
  /** The file, or a prefix of it that holds the headers. */
  bytes: Uint8Array;
}
```
