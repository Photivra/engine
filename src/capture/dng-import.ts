// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * Browser-safe reader for DNG and TIFF-EP raw files with a CFA (colour filter array) mosaic or LinearRaw data.
 *
 * It was written independently from the published TIFF 6.0 tag definitions, the Adobe Digital
 * Negative (DNG) Specification 1.7.1.0 and the Exif 2.32/3.0 CFAPattern definition (CIPA DC-008;
 * the TIFF/EP tags are also specified in ISO 12234-2). No third-party reader source was used.
 *
 * It returns the stored raw codes plus the metadata the engine's RAW development needs: CFA
 * pattern, black and white levels, active area, default crop, colour matrices, as-shot neutral,
 * calibration illuminants and orientation. It never applies linearization, black subtraction,
 * white balance, demosaicing or colour transforms (`developDngStageImage` does the DNG stages).
 *
 * 2.22.0 (#598, phone RAW files): lossy JPEG (Compression 34892, DNG 1.4.0.0) and JPEG XL (52546, DNG 1.7.0.0) raw data,
 * Row/ColumnInterleaveFactor, the opcode lists, the profile gain table map, RGBTables and semantic masks, a `maximumBytes` memory
 * pre-check and a half-size LinearRaw preview. Every DNG 1.5–1.7 tag that would change the rendering and is not returned or
 * applied is named in `assumptions`; none of them fails an import.
 *
 * Input is untrusted. Every offset, count, IFD (image file directory) chain, strip or tile table
 * and decoded size is checked against the buffer and explicit limits before allocation. IFD loops,
 * IFDs that alias each other, oversized frames and over-long tag arrays fail with
 * `InvalidConfigurationError`.
 * @see docs/IMPORT_AND_PNG.md for supported subsets and limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseLosslessJpeg } from "./lossless-jpeg.js";
import { parseLossyJpeg } from "./lossy-jpeg.js";
import { readJpegXlTilePng, type DngJpegXlDecoder } from "./jpeg-xl-tiles.js";
import { parseDngOpcodeList, type DngOpcode } from "./dng-opcodes.js";
import { parseDngProfileGainTableMap, parseDngRgbTables, type DngProfileGainTableMap, type DngRgbTables } from "./dng-profile-maps.js";

/**
 * 1.1.0 (2.22.0): lossy JPEG and JPEG XL raw data, opcode lists, profile maps, semantic masks, `scale`, `assumptions`.
 * 1.2.0 (2.24.0): `noiseProfile`, `exif` (ISO, exposure time, f-number, focal length, CompositeImage, SubjectArea), `analogBalance`,
 * `cameraCalibration1/2` with their signatures, `asShotWhiteXy`.
 */
export const DNG_IMPORT_SCHEMA_VERSION = "1.2.0" as const;
/**
 * Upper bound for `maximumPixels`: 200 MP (megapixels) of 16-bit codes is 400 MB. `maximumBytes` bounds the estimated peak memory
 * of the import (default 1 GiB, at most 4 GiB).
 */
export const DNG_IMPORT_LIMITS = /* @__PURE__ */ Object.freeze({ defaultMaximumPixels: 64_000_000, maximumPixels: 200_000_000, defaultMaximumIfds: 64, maximumIfds: 1024,
  defaultMaximumBytes: 1_073_741_824, maximumBytes: 4_294_967_296 });
export interface DngImportInput {
  bytes: Uint8Array;
  /** Pixel-count limit (width x height), checked before any decode allocation. Default 64 000 000, at most 200 000 000. */
  maximumPixels?: number;
  /** Total IFDs (main chain plus SubIFDs) visited. Default 64, at most 1024. */
  maximumIfds?: number;
  /**
   * Estimated peak memory of the import, bytes (the codes, the largest strip or tile's decode buffers and its decoder's working
   * memory; see docs/IMPORT_AND_PNG.md, "Memory"), checked before any image allocation. Default 1 073 741 824 (1 GiB), at most 4 GiB.
   */
  maximumBytes?: number;
  /**
   * "half": a half-size preview of a LinearRaw image, each output pixel the rounded mean of a 2 × 2 block of stored codes, decoded
   * strip by strip (a quarter of the codes' memory). Areas, crops and black-level deltas are halved; CFA images are refused.
   * Default "full".
   */
  size?: "full" | "half";
}
/** {@link importDngRawImage}'s input: {@link DngImportInput} plus the JPEG XL decoder a 52546 file needs. */
export interface DngImportAsyncInput extends DngImportInput {
  /** Decodes one JPEG XL strip or tile to PNG (`createJxlOxideDngDecoder`). Needed only for JPEG XL raw data or masks. */
  jpegXlDecoder?: DngJpegXlDecoder;
}
/** A decoded semantic mask (DNG 1.6 SemanticName, NewSubFileType 0x10004, PhotometricInterpretation 52527). */
export interface ImportedDngSemanticMask {
  name: string;
  /** SemanticInstanceID, or null. */
  instanceId: string | null;
  width: number;
  height: number;
  /** Mask values 0..1 (code / (2^bits − 1)), row-major. */
  data: Float32Array;
}
/** Repeating CFA pattern. Its origin is the top-left corner of `activeArea` (DNG 1.7.1.0, PhotometricInterpretation). */
export interface ImportedDngCfa {
  repeatRows: number;
  repeatColumns: number;
  /** Row-major plane indices into `planeColors`, length repeatRows x repeatColumns. */
  pattern: number[];
  /** CFAPlaneColor: 0 red, 1 green, 2 blue, 3 cyan, 4 magenta, 5 yellow, 6 white. Default [0, 1, 2]. */
  planeColors: number[];
}
/** Black level (the code for zero light) pattern, from BlackLevel, BlackLevelRepeatDim and BlackLevelDeltaH/V. Origin is the active-area top-left. */
export interface ImportedDngBlackLevel {
  repeatRows: number;
  repeatColumns: number;
  /** Row-column-sample order, length repeatRows x repeatColumns x samplesPerPixel. */
  values: number[];
  /** Per active-area column offset, or null when absent (all zeros). */
  deltaH: number[] | null;
  /** Per active-area row offset, or null when absent (all zeros). */
  deltaV: number[] | null;
}
/**
 * 2.24.0: one NoiseProfile (51041) pair per color plane (CFAPlaneColor order for a mosaic, sample order for LinearRaw). The DNG
 * specification 1.7.1.0 models the noise of the linear, black-subtracted signal x = (value − black)/(white − black), x in 0..1, as
 * white and spatially independent with variance S·x + O; it leaves out fixed-pattern noise. A two-value tag applies to every plane.
 */
export interface ImportedDngNoiseProfilePlane { scale: number; offset: number }
/** Exif SubjectArea (0x9214, Exif 2.32 §4.6.6): a point, a circle (centre and diameter) or a rectangle (centre, width and height), in stored-image pixels. */
export type ImportedDngSubjectArea =
  | { kind: "point"; x: number; y: number }
  | { kind: "circle"; x: number; y: number; diameter: number }
  | { kind: "rectangle"; x: number; y: number; width: number; height: number };
/**
 * 2.24.0: the capture settings the file states, from the Exif IFD (34665; Exif 2.32, CIPA DC-008-2019), else the same tags in IFD 0
 * or the raw IFD (TIFF/EP). Every field is null when the tag is absent or malformed (a malformed one is named in `assumptions`).
 */
export interface ImportedDngExif {
  /** ExposureTime (0x829A), seconds. */
  exposureTimeSeconds: number | null;
  /** FNumber (0x829D). */
  fNumber: number | null;
  /** FocalLength (0x920A), mm (the lens's actual focal length, not the 35 mm equivalent). */
  focalLengthMillimeters: number | null;
  /** PhotographicSensitivity (0x8827, formerly ISOSpeedRatings): the first value; 65535 means "65535 or more" (Exif 2.32). */
  photographicSensitivity: number | null;
  /** SensitivityType (0x8830): which sensitivity PhotographicSensitivity holds (0 unknown, 1 SOS, 2 REI, 3 ISO speed, 4–7 combinations). */
  sensitivityType: number | null;
  /** StandardOutputSensitivity (0x8831). */
  standardOutputSensitivity: number | null;
  /** RecommendedExposureIndex (0x8832). */
  recommendedExposureIndex: number | null;
  /** ISOSpeed (0x8833). */
  isoSpeed: number | null;
  /**
   * The ISO setting: RecommendedExposureIndex, else ISOSpeed, else StandardOutputSensitivity, else PhotographicSensitivity below
   * 65535 (CIPA DC-004 names the REI as the camera's exposure-index setting); null when none is stated.
   */
  iso: number | null;
  isoSource: "recommended-exposure-index" | "iso-speed" | "standard-output-sensitivity" | "photographic-sensitivity" | null;
  /** CompositeImage (0xA460): 0 unknown, 1 not a composite, 2 a general composite, 3 a composite captured while shooting. */
  compositeImage: 0 | 1 | 2 | 3 | null;
  /** SourceImageNumberOfCompositeImage (0xA461): the source images in all and those used. */
  compositeSourceImages: { total: number; used: number } | null;
  subjectArea: ImportedDngSubjectArea | null;
}
/** Half-open raster rectangle in stored-image pixel coordinates (+X right, +Y down). */
export interface ImportedDngRect { x: number; y: number; width: number; height: number }
export interface ImportedDngRaw {
  schemaVersion: typeof DNG_IMPORT_SCHEMA_VERSION;
  byteOrder: "little-endian" | "big-endian";
  /** DNGVersion bytes, or null for a TIFF-EP file without DNG tags. */
  dngVersion: [number, number, number, number] | null;
  make: string | null;
  model: string | null;
  uniqueCameraModel: string | null;
  /** TIFF/Exif Orientation 1..8 (default 1). Codes are returned in stored, not oriented, order. */
  orientation: number;
  width: number;
  height: number;
  samplesPerPixel: number;
  bitsPerSample: number;
  compression: "uncompressed" | "lossless-jpeg" | "lossy-jpeg" | "jpeg-xl";
  /**
   * True when the raw data went through a lossy coder: lossy JPEG always; JPEG XL when JXLDistance (52553) is above 0 or absent
   * (the file then does not say it is lossless).
   */
  lossySource: boolean;
  /** 1, or 0.5 for a `size: "half"` preview (every geometry field is already halved). */
  scale: 1 | 0.5;
  photometricInterpretation: "cfa" | "linear-raw";
  /** Stored raw codes, row-major then sample, length width x height x samplesPerPixel. */
  codes: Uint16Array;
  cfa: ImportedDngCfa | null;
  /** LinearizationTable when present; not applied to `codes`. */
  linearizationTable: Uint16Array | null;
  blackLevel: ImportedDngBlackLevel;
  /** WhiteLevel per sample (default 2^bitsPerSample − 1). */
  whiteLevel: number[];
  /** ActiveArea as a rectangle (default the whole image). */
  activeArea: ImportedDngRect;
  /** DefaultCropOrigin/Size relative to the active-area origin; may be fractional (RATIONAL). */
  defaultCrop: ImportedDngRect;
  /** XYZ → camera (reference) matrices, row-major colorPlanes x 3, or null. */
  colorMatrix1: number[] | null;
  colorMatrix2: number[] | null;
  /** CalibrationIlluminant1/2 (Exif LightSource code), or null when absent. */
  calibrationIlluminant1: number | null;
  calibrationIlluminant2: number | null;
  /** AsShotNeutral in camera (reference) coordinates, or null. */
  asShotNeutral: number[] | null;
  /** RawDataUniqueID as 32 lowercase hex digits, or null. */
  rawDataUniqueId: string | null;
  /** ForwardMatrix1/2 (white-balanced camera → XYZ D50), row-major 3 x colorPlanes, or null. */
  forwardMatrix1: number[] | null;
  forwardMatrix2: number[] | null;
  /** BaselineExposure plus BaselineExposureOffset (stops), or null when neither is present. */
  baselineExposure: number | null;
  /** OpcodeList1/2/3 (raw IFD), parsed but not applied (`developDngStageImage` applies them), or null when absent. */
  opcodeList1: DngOpcode[] | null;
  opcodeList2: DngOpcode[] | null;
  opcodeList3: DngOpcode[] | null;
  /** ProfileGainTableMap2 (IFD 0), else ProfileGainTableMap (raw IFD), or null; applied by `applyDngProfileGainTableMap`. */
  profileGainTableMap: DngProfileGainTableMap | null;
  /** RGBTables (IFD 0), or null; applied by `applyDngRgbTables`. */
  rgbTables: DngRgbTables | null;
  /** Decoded semantic masks, for `applyDngRgbTables`. */
  semanticMasks: ImportedDngSemanticMask[];
  /** 2.24.0: NoiseProfile per color plane, or null when absent or malformed. */
  noiseProfile: ImportedDngNoiseProfilePlane[] | null;
  /** 2.24.0: the capture settings the file states. */
  exif: ImportedDngExif;
  /** 2.24.0: AnalogBalance (50727), one per color plane, or null. */
  analogBalance: number[] | null;
  /** 2.24.0: CameraCalibration1/2 (50723/50724), row-major colorPlanes × colorPlanes, or null. */
  cameraCalibration1: number[] | null;
  cameraCalibration2: number[] | null;
  /** 2.24.0: CameraCalibrationSignature (50931) and ProfileCalibrationSignature (50932), or null. */
  cameraCalibrationSignature: string | null;
  profileCalibrationSignature: string | null;
  /** 2.24.0: AsShotWhiteXY (50729), or null. */
  asShotWhiteXy: { x: number; y: number } | null;
  /** What the import did not do: tags present but not returned or applied, masks not decoded, lossy sources, inferred layouts. */
  assumptions: string[];
}

const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4] as const;
interface Entry { type: number; count: number; at: number }
type Ifd = Map<number, Entry>;
function fail(message: string): never { throw new InvalidConfigurationError("DNG import: " + message); }
function limit(value: number | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(name + " must be an integer from 1 to " + max + ".");
  return value;
}

/** One strip or tile to decode into the image. */
interface Chunk { data: Uint8Array; x0: number; y0: number; width: number; rows: number }
/** A planned image IFD: its layout, its chunks and how to decode one. */
interface ImagePlan { width: number; height: number; spp: number; bits: number; code: number; chunks: Chunk[]; jpegTables: Uint8Array | undefined; legacy: boolean }
/** Rendering-relevant tags that are not returned or applied, by tag id (DNG 1.4–1.7 tag names). */
const UNAPPLIED_TAGS: readonly [number, string][] = [[50938, "ProfileHueSatMapData1"], [50939, "ProfileHueSatMapData2"], [50940, "ProfileToneCurve"], [50982, "ProfileLookTableData"],
  [51110, "DefaultBlackRender"], [52529, "CalibrationIlluminant3"], [52531, "ColorMatrix3"], [52532, "ForwardMatrix3"], [52533, "IlluminantData1"], [52534, "IlluminantData2"],
  [52535, "IlluminantData3"], [52551, "ProfileDynamicRange"], [51182, "EnhanceParams"], [52545, "JUMBF (C2PA)"], [52539, "RGBTables (draft)"]];
/** Estimated JPEG XL decoder working memory per sample, bytes (an estimate, not measured: 32-bit channels, a float render and the PNG). */
const JXL_WORKING_BYTES_PER_SAMPLE = 16;

/** The shared parser: walks the IFDs, plans the image and reads the metadata. Decoding is done by the sync or async caller. */
interface Prepared {
  image: ImagePlan; little: boolean; assumptions: string[];
  masks: { name: string; instanceId: string | null; ifd: Ifd }[];
  plan(ifd: Ifd, kind: "raw" | "mask"): ImagePlan;
  write(chunk: Chunk, samples: Uint16Array): void;
  finish(masks: ImportedDngSemanticMask[]): ImportedDngRaw;
}
function prepare(input: DngImportInput, keys: readonly string[]): Prepared {
  if (input === null || typeof input !== "object") fail("input must be an object.");
  for (const key of Object.keys(input)) if (!keys.includes(key)) fail(`unknown input field. Unknown field ${JSON.stringify(key)}.`);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) fail("bytes must be a Uint8Array.");
  const maximumPixels = limit(input.maximumPixels, DNG_IMPORT_LIMITS.defaultMaximumPixels, DNG_IMPORT_LIMITS.maximumPixels, "maximumPixels");
  const maximumIfds = limit(input.maximumIfds, DNG_IMPORT_LIMITS.defaultMaximumIfds, DNG_IMPORT_LIMITS.maximumIfds, "maximumIfds");
  const maximumBytes = limit(input.maximumBytes, DNG_IMPORT_LIMITS.defaultMaximumBytes, DNG_IMPORT_LIMITS.maximumBytes, "maximumBytes");
  if (input.size !== undefined && input.size !== "full" && input.size !== "half") fail('size must be "full" or "half".');
  const half = input.size === "half";
  const n = bytes.length, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (n < 8) fail("file is too short.");
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) fail("missing TIFF byte-order mark.");
  const u16 = (o: number): number => view.getUint16(o, little), u32 = (o: number): number => view.getUint32(o, little);
  if (u16(2) === 43) fail("BigTIFF is not supported.");
  if (u16(2) !== 42) fail("missing TIFF magic number.");

  const visited = new Set<number>(), ifds: Ifd[] = [];
  const readIfd = (offset: number): { ifd: Ifd; next: number } => {
    if (offset < 8 || offset % 2 !== 0 || offset + 2 > n) fail("IFD offset out of range.");
    if (visited.has(offset)) fail("IFD loop or aliased IFD.");
    if (visited.size >= maximumIfds) fail("too many IFDs.");
    visited.add(offset);
    const count = u16(offset), end = offset + 2 + count * 12;
    if (count === 0 || end + 4 > n) fail("IFD exceeds the file.");
    const ifd: Ifd = new Map();
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12, id = u16(p), type = u16(p + 2), c = u32(p + 4);
      if (ifd.has(id)) fail("duplicate tag in one IFD.");
      if (type < 1 || type > 13) continue; // TIFF 6.0: readers skip fields of unknown type.
      const size = TYPE_SIZES[type]! * c, at = size <= 4 ? p + 8 : u32(p + 8);
      if (at + size > n) fail("tag value exceeds the file.");
      ifd.set(id, { type, count: c, at });
    }
    return { ifd, next: u32(end) };
  };
  const walk = (offset: number, depth: number): void => {
    for (let next = offset; next !== 0;) {
      const { ifd, next: following } = readIfd(next);
      ifds.push(ifd);
      const sub = ifd.get(330);
      if (sub) {
        if (depth >= 3) fail("SubIFD nesting is too deep.");
        if ((sub.type !== 4 && sub.type !== 13) || sub.count > maximumIfds) fail("invalid SubIFDs tag.");
        for (let i = 0; i < sub.count; i++) walk(u32(sub.at + i * 4), depth + 1);
      }
      next = following;
    }
  };
  walk(u32(4), 0);

  const numbers = (entry: Entry | undefined, maximumCount: number): number[] | null => {
    if (!entry) return null;
    if (entry.count > maximumCount) fail("tag count exceeds its expected size.");
    const out: number[] = [], { type, at } = entry;
    for (let i = 0; i < entry.count; i++) {
      switch (type) {
        case 1: case 7: out.push(bytes[at + i]!); break;
        case 6: out.push(view.getInt8(at + i)); break;
        case 3: out.push(u16(at + i * 2)); break;
        case 8: out.push(view.getInt16(at + i * 2, little)); break;
        case 4: case 13: out.push(u32(at + i * 4)); break;
        case 9: out.push(view.getInt32(at + i * 4, little)); break;
        case 5: case 10: {
          const num = type === 5 ? u32(at + i * 8) : view.getInt32(at + i * 8, little), den = type === 5 ? u32(at + i * 8 + 4) : view.getInt32(at + i * 8 + 4, little);
          if (den === 0) fail("rational with zero denominator.");
          out.push(num / den); break;
        }
        case 11: out.push(view.getFloat32(at + i * 4, little)); break;
        case 12: out.push(view.getFloat64(at + i * 8, little)); break;
        default: fail("unsupported tag type.");
      }
      if (!Number.isFinite(out[i])) fail("non-finite tag value.");
    }
    return out;
  };
  const integers = (entry: Entry | undefined, maximumCount: number, types: readonly number[]): number[] | null => {
    if (entry && !types.includes(entry.type)) fail("tag has an unsupported field type.");
    return numbers(entry, maximumCount);
  };
  const ascii = (entry: Entry | undefined): string | null => {
    if (!entry) return null;
    if ((entry.type !== 2 && entry.type !== 1) || entry.count > 4096) fail("invalid ASCII tag.");
    let s = "";
    for (let i = 0; i < entry.count && bytes[entry.at + i] !== 0; i++) s += String.fromCharCode(bytes[entry.at + i]!);
    return s;
  };
  const one = (ifd: Ifd, id: number, fallback: number): number => {
    const v = integers(ifd.get(id), 1, [3, 4]);
    return v ? v[0]! : fallback;
  };
  const blob = (entry: Entry | undefined): Uint8Array | null => entry ? bytes.subarray(entry.at, entry.at + entry.count * TYPE_SIZES[entry.type]!) : null;

  const raw = ifds.find((ifd) => one(ifd, 254, 0) === 0 && [32803, 34892].includes(one(ifd, 262, -1)));
  if (!raw) fail("no primary CFA or LinearRaw image IFD.");
  const ifd0 = ifds[0]!;
  // DNG places camera-level tags in IFD 0; TIFF-EP files may carry them only in the raw IFD.
  const pick = (id: number): Entry | undefined => ifd0.get(id) ?? raw.get(id);
  const dngVersionTag = integers(ifd0.get(50706), 4, [1]);
  const dngVersion = dngVersionTag && dngVersionTag.length === 4 ? dngVersionTag as [number, number, number, number] : null;
  if (dngVersionTag && !dngVersion) fail("invalid DNGVersion.");
  const assumptions: string[] = [];

  /** Plans one image IFD (the raw image or a mask): layout checks and the strip or tile table. */
  const plan = (ifd: Ifd, kind: "raw" | "mask"): ImagePlan => {
    const width = one(ifd, 256, 0), height = one(ifd, 257, 0), spp = one(ifd, 277, 1), code = one(ifd, 259, 1), photometric = one(ifd, 262, 0);
    if (width < 1 || height < 1 || width > 65535 * 4 || height > 65535 * 4) fail("invalid image dimensions.");
    if (width * height > maximumPixels) fail("image exceeds the pixel limit.");
    if (kind === "mask" ? spp !== 1 : photometric === 32803 ? spp !== 1 : spp < 1 || spp > 4) fail("unsupported SamplesPerPixel.");
    if (spp > 1 && one(ifd, 284, 1) !== 1) fail("only chunky PlanarConfiguration is supported.");
    const bps = integers(ifd.get(258), spp, [3]) ?? [1];
    if (bps.length !== spp || bps.some((b) => b !== bps[0])) fail("BitsPerSample must be equal for every sample.");
    const bits = bps[0]!;
    if (bits < 8 || bits > 16) fail("only 8 to 16 bits per sample are supported.");
    if (one(ifd, 339, 1) !== 1) fail("only unsigned integer samples are supported.");
    if (![1, 7, 34892, 52546].includes(code)) fail("Compression " + code + " is not supported (supported: 1 uncompressed, 7 lossless JPEG, 34892 lossy JPEG, 52546 JPEG XL).");
    if (code === 34892 && (bits !== 8 || photometric === 32803)) fail("lossy JPEG (Compression 34892) raw data must be 8-bit LinearRaw or a mask (DNG 1.4.0.0).");
    const tiled = ifd.has(322) || ifd.has(324);
    const tileWidth = tiled ? one(ifd, 322, 0) : width, tileLength = tiled ? one(ifd, 323, 0) : Math.min(height, one(ifd, 278, 0xffffffff));
    if (tileWidth < 1 || tileLength < 1 || tileWidth > 65535 * 4 || tileLength > 65535 * 4 || (tiled && tileWidth * tileLength > maximumPixels)) fail("invalid strip or tile size.");
    const across = Math.ceil(width / tileWidth), down = Math.ceil(height / tileLength), count = across * down;
    const offsets = integers(ifd.get(tiled ? 324 : 273), count, [3, 4]), counts = integers(ifd.get(tiled ? 325 : 279), count, [3, 4]);
    if (!offsets || !counts || offsets.length !== count || counts.length !== count) fail("strip or tile tables do not match the image layout.");
    const chunks: Chunk[] = [];
    for (let i = 0; i < count; i++) {
      if (offsets[i]! + counts[i]! > n) fail("strip or tile data exceeds the file.");
      const tx = i % across, ty = Math.floor(i / across);
      // Strips cover whole rows (the last may be short); tiles are always full-size and clipped on copy.
      chunks.push({ data: bytes.subarray(offsets[i]!, offsets[i]! + counts[i]!), x0: tx * tileWidth, y0: ty * tileLength, width: tiled ? tileWidth : width, rows: tiled ? tileLength : Math.min(tileLength, height - ty * tileLength) });
    }
    return { width, height, spp, bits, code, chunks, jpegTables: blob(ifd.get(347)) ?? undefined, legacy: dngVersion !== null && (dngVersion[0] < 1 || (dngVersion[0] === 1 && dngVersion[1] < 1)) };
  };

  const image = plan(raw, "raw"), { width, height, spp, bits: bitsPerSample, code: compressionCode } = image;
  const photometric = one(raw, 262, 0), cfaImage = photometric === 32803;
  const rowInterleave = one(raw, 50975, 1), columnInterleave = one(raw, 52547, 1);
  if (rowInterleave < 1 || rowInterleave > height || columnInterleave < 1 || columnInterleave > width) fail("invalid RowInterleaveFactor or ColumnInterleaveFactor.");
  const interleaved = rowInterleave > 1 || columnInterleave > 1;
  if (half && cfaImage) fail('size "half" needs LinearRaw data; this file is a CFA mosaic.');
  if (half && interleaved) fail('size "half" is not available for row- or column-interleaved data.');
  if (interleaved) assumptions.push("dngImport.interleave: RowInterleaveFactor " + rowInterleave + " and ColumnInterleaveFactor " + columnInterleave + " undone; the stored order (each field of rows or columns stored together, field by field) is inferred from the DNG SDK, not yet verified on a phone file.");

  // Memory pre-check (estimates, docs/IMPORT_AND_PNG.md "Memory"): output codes (plus the half-size sums), one chunk's decoded
  // samples twice (decode buffer and copy), and its decoder's working memory.
  const outWidth = half ? Math.ceil(width / 2) : width, outHeight = half ? Math.ceil(height / 2) : height;
  const largest = Math.max(...image.chunks.map((c) => c.width * c.rows)) * spp;
  const decoderBytes = compressionCode === 52546 ? largest * JXL_WORKING_BYTES_PER_SAMPLE : compressionCode === 34892 ? largest * 2 + largest : largest * 2;
  const estimate = outWidth * outHeight * spp * 2 + (half ? outWidth * outHeight * spp * 4 : 0) + (interleaved ? width * height * spp * 2 : 0) + largest * 4 + decoderBytes;
  if (estimate > maximumBytes) fail("the import needs an estimated " + Math.ceil(estimate / 1048576) + " MiB, above maximumBytes (" + Math.floor(maximumBytes / 1048576) + " MiB); raise maximumBytes or use size \"half\" for a LinearRaw preview.");

  const maxCode = 2 ** bitsPerSample - 1, codes = new Uint16Array(outWidth * outHeight * spp), sums = half ? new Uint32Array(outWidth * outHeight * spp) : null;
  const write = (chunk: Chunk, samples: Uint16Array): void => {
    for (let y = 0; y < chunk.rows && chunk.y0 + y < height; y++) {
      const columns = Math.min(chunk.width, width - chunk.x0) * spp, from = y * chunk.width * spp;
      if (sums) {
        const row = ((chunk.y0 + y) >> 1) * outWidth;
        for (let i = 0; i < columns; i++) {
          const v = samples[from + i]!;
          if (v > maxCode) fail("raw code exceeds BitsPerSample.");
          const x = chunk.x0 + Math.floor(i / spp), at = (row + (x >> 1)) * spp + (i % spp);
          sums[at] = sums[at]! + v;
        }
        continue;
      }
      const to = ((chunk.y0 + y) * width + chunk.x0) * spp;
      for (let i = 0; i < columns; i++) {
        const v = samples[from + i]!;
        if (v > maxCode) fail("raw code exceeds BitsPerSample.");
        codes[to + i] = v;
      }
    }
  };

  // CFA description.
  let cfa: ImportedDngCfa | null = null, colorPlanes = spp;
  if (cfaImage) {
    const dim = integers(raw.get(33421), 2, [3]), pattern = integers(raw.get(33422), 256, [1]);
    if (!dim || dim.length !== 2 || dim[0]! < 1 || dim[1]! < 1 || !pattern || pattern.length !== dim[0]! * dim[1]!) fail("CFA images require CFARepeatPatternDim and a matching CFAPattern.");
    const planeColors = integers(raw.get(50710), 16, [1]) ?? [0, 1, 2];
    if (planeColors.length < 1 || planeColors.some((c) => c > 6) || new Set(planeColors).size !== planeColors.length) fail("invalid CFAPlaneColor.");
    if (pattern.some((v) => v >= planeColors.length)) fail("CFAPattern references an undefined plane.");
    if (one(raw, 50711, 1) !== 1) fail("only rectangular CFALayout is supported.");
    cfa = { repeatRows: dim[0]!, repeatColumns: dim[1]!, pattern, planeColors };
    colorPlanes = planeColors.length;
  }

  // Active area, levels and crop.
  const area = integers(raw.get(50829), 4, [3, 4]) ?? [0, 0, height, width];
  if (area.length !== 4 || area[0]! >= area[2]! || area[1]! >= area[3]! || area[2]! > height || area[3]! > width) fail("ActiveArea is outside the image.");
  const activeArea = { x: area[1]!, y: area[0]!, width: area[3]! - area[1]!, height: area[2]! - area[0]! };
  const repeat = integers(raw.get(50713), 2, [3]) ?? [1, 1];
  if (repeat.length !== 2 || repeat[0]! < 1 || repeat[1]! < 1 || repeat[0]! * repeat[1]! > 1024) fail("invalid BlackLevelRepeatDim.");
  const levelCount = repeat[0]! * repeat[1]! * spp;
  const black = integers(raw.get(50714), levelCount, [3, 4, 5]) ?? Array<number>(levelCount).fill(0);
  if (black.length !== levelCount) fail("BlackLevel count does not match BlackLevelRepeatDim.");
  const deltaH = integers(raw.get(50715), activeArea.width, [10]), deltaV = integers(raw.get(50716), activeArea.height, [10]);
  if ((deltaH && deltaH.length !== activeArea.width) || (deltaV && deltaV.length !== activeArea.height)) fail("BlackLevelDelta count does not match the ActiveArea.");
  const whiteLevel = integers(raw.get(50717), spp, [3, 4]) ?? Array<number>(spp).fill(maxCode);
  if (whiteLevel.length !== spp) fail("WhiteLevel count does not match SamplesPerPixel.");
  const origin = integers(raw.get(50719), 2, [3, 4, 5]) ?? [0, 0], size = integers(raw.get(50720), 2, [3, 4, 5]) ?? [width, height];
  if (origin.length !== 2 || size.length !== 2 || size[0]! <= 0 || size[1]! <= 0 || origin[0]! < 0 || origin[1]! < 0) fail("invalid default crop.");
  const linear = integers(raw.get(50712), 65536, [3]);

  const matrix = (id: number, transpose = false): number[] | null => {
    const m = integers(pick(id), colorPlanes * 3, [10]);
    if (m && m.length !== colorPlanes * 3) fail((transpose ? "ForwardMatrix" : "ColorMatrix") + " count does not match the colour planes.");
    return m;
  };
  const neutral = integers(pick(50728), colorPlanes, [3, 5]);
  if (neutral && (neutral.length !== colorPlanes || neutral.some((v) => v <= 0))) fail("invalid AsShotNeutral.");
  const illuminant = (id: number): number | null => { const v = integers(pick(id), 1, [3]); return v ? v[0]! : null; };
  const uniqueId = integers(pick(50781), 16, [1]);
  if (uniqueId && uniqueId.length !== 16) fail("RawDataUniqueID must have 16 bytes.");
  const orientation = one(ifd0.has(274) ? ifd0 : raw, 274, 1);
  if (orientation < 1 || orientation > 8) fail("invalid Orientation.");

  // Phone tags (#598): parsed when present; a malformed one is reported, never a failure.
  const optional = <T>(name: string, read: () => T): T | null => {
    try { return read(); } catch (error) {
      if (!(error instanceof InvalidConfigurationError)) throw error;
      assumptions.push("dngImport.ignored: " + name + " is malformed and was ignored (" + error.message + ").");
      return null;
    }
  };
  const opcodes = (id: number, name: string): DngOpcode[] | null => { const b = blob(raw.get(id)); return b ? optional(name, () => parseDngOpcodeList(b)) : null; };
  const opcodeList1 = opcodes(51008, "OpcodeList1"), opcodeList2 = opcodes(51009, "OpcodeList2"), opcodeList3 = opcodes(51022, "OpcodeList3");
  const pgtm2 = blob(ifd0.get(52544)), pgtm1 = blob(raw.get(52525));
  const profileGainTableMap = (pgtm2 ? optional("ProfileGainTableMap2", () => parseDngProfileGainTableMap(pgtm2, little, 2)) : null)
    ?? (pgtm1 ? optional("ProfileGainTableMap", () => parseDngProfileGainTableMap(pgtm1, little, 1)) : null);
  const rgbBlob = blob(ifd0.get(52543)), rgbTables = rgbBlob ? optional("RGBTables", () => parseDngRgbTables(rgbBlob, little)) : null;
  const exposure = integers(pick(50730), 1, [10]), exposureOffset = integers(pick(51109), 1, [10]);
  const baselineExposure = exposure || exposureOffset ? (exposure?.[0] ?? 0) + (exposureOffset?.[0] ?? 0) : null;
  for (const [id, name] of UNAPPLIED_TAGS) if (ifd0.has(id) || raw.has(id)) assumptions.push("dngImport.notApplied: " + name + " (" + id + ") is present and not applied.");
  for (const ifd of ifds) {
    const type = one(ifd, 254, 0);
    if (type === 8 || type === 9) assumptions.push("dngImport.notApplied: a depth map IFD is present and not decoded.");
    if (type === 16) assumptions.push("dngImport.notApplied: an enhanced-image IFD (NewSubFileType 16) is present and not decoded; the raw image is used.");
    if (type === 32 || one(ifd, 262, 0) === 52553) assumptions.push("dngImport.notApplied: a gain-map image IFD (NewSubFileType 32) is present and not applied.");
  }
  if (compressionCode === 34892) assumptions.push("dngImport.lossySource: the raw data is lossy JPEG (Compression 34892), 8-bit and gamma-coded; OpcodeList2 or the LinearizationTable makes it linear.");
  const jxlDistance = integers(ifd0.get(52553) ?? raw.get(52553), 1, [11, 12]);
  const lossyJxl = compressionCode === 52546 && !(jxlDistance && jxlDistance[0]! <= 0);
  if (lossyJxl) assumptions.push("dngImport.lossySource: the JPEG XL raw data is " + (jxlDistance ? "lossy (JXLDistance " + jxlDistance[0] + ")." : "not marked lossless (no JXLDistance tag)."));
  if (linear) assumptions.push("dngImport.linearizationTable: returned, not applied to codes (developDngStageImage applies it).");
  if (opcodeList1 || opcodeList2 || opcodeList3) assumptions.push("dngImport.opcodes: the opcode lists are returned, not applied to codes (developDngStageImage applies them).");
  if (profileGainTableMap) assumptions.push("dngImport.profileGainTableMap: returned (version " + profileGainTableMap.version + "); applyDngProfileGainTableMap applies it in a development.");
  if (rgbTables) assumptions.push("dngImport.rgbTables: returned (" + rgbTables.tables.length + " tables); applyDngRgbTables applies them in a development.");

  // 2.24.0: NoiseProfile (raw IFD, else IFD 0) and the Exif capture settings; a malformed tag is reported, never a failure.
  const noiseProfile = optional("NoiseProfile", () => {
    const v = integers(raw.get(51041) ?? ifd0.get(51041), 2 * colorPlanes, [12]);
    if (!v) return null;
    if (v.length !== 2 && v.length !== 2 * colorPlanes) fail("NoiseProfile must have 2 or 2 × ColorPlanes values.");
    const planes = Array.from({ length: colorPlanes }, (_, p) => ({ scale: v.length === 2 ? v[0]! : v[2 * p]!, offset: v.length === 2 ? v[1]! : v[2 * p + 1]! }));
    if (planes.some((q) => !(q.scale > 0) || !(q.offset >= 0))) fail("NoiseProfile needs S > 0 and O >= 0.");
    return planes;
  });
  const exifIfd = ifd0.has(34665) ? optional("Exif IFD", () => {
    const at = integers(ifd0.get(34665), 1, [4, 13]);
    return at ? readIfd(at[0]!).ifd : null;
  }) : null;
  const exifEntry = (id: number): Entry | undefined => exifIfd?.get(id) ?? ifd0.get(id) ?? raw.get(id);
  const exifNumber = (id: number, name: string, types: readonly number[], count = 1): number[] | null => optional(name, () => {
    const v = integers(exifEntry(id), Math.max(count, 64), types);
    if (!v || v.length === 0) return null;
    if (v.some((x) => !(x >= 0))) fail(name + " must not be negative.");
    return v;
  });
  const positive = (id: number, name: string, types: readonly number[]): number | null => {
    const v = exifNumber(id, name, types)?.[0];
    if (v === undefined) return null;
    if (!(v > 0)) { assumptions.push("dngImport.ignored: " + name + " is " + v + " (not positive) and was ignored."); return null; }
    return v;
  };
  const photographicSensitivity = positive(34855, "PhotographicSensitivity", [3, 4]), recommendedExposureIndex = positive(34866, "RecommendedExposureIndex", [4]);
  const isoSpeed = positive(34867, "ISOSpeed", [4]), standardOutputSensitivity = positive(34865, "StandardOutputSensitivity", [4]);
  const isoChoice: [number | null, ImportedDngExif["isoSource"]][] = [[recommendedExposureIndex, "recommended-exposure-index"], [isoSpeed, "iso-speed"],
    [standardOutputSensitivity, "standard-output-sensitivity"], [photographicSensitivity !== null && photographicSensitivity < 65535 ? photographicSensitivity : null, "photographic-sensitivity"]];
  const isoPick = isoChoice.find(([v]) => v !== null);
  if (!isoPick && photographicSensitivity === 65535) assumptions.push("dngImport.exif: PhotographicSensitivity is 65535 (65535 or more) and no other sensitivity tag is present; iso is null.");
  const composite = exifNumber(42080, "CompositeImage", [3])?.[0] ?? null, sources = exifNumber(42081, "SourceImageNumberOfCompositeImage", [3], 2);
  const subject = exifNumber(37396, "SubjectArea", [3], 4);
  const subjectArea: ImportedDngSubjectArea | null = !subject ? null : subject.length === 2 ? { kind: "point", x: subject[0]!, y: subject[1]! }
    : subject.length === 3 ? { kind: "circle", x: subject[0]!, y: subject[1]!, diameter: subject[2]! }
      : subject.length === 4 ? { kind: "rectangle", x: subject[0]!, y: subject[1]!, width: subject[2]!, height: subject[3]! } : null;
  if (subject && !subjectArea) assumptions.push("dngImport.ignored: SubjectArea has " + subject.length + " values (2, 3 or 4 expected) and was ignored.");
  if (composite !== null && composite > 3) assumptions.push("dngImport.ignored: CompositeImage " + composite + " is not defined by Exif 2.32 and was ignored.");
  const exif: ImportedDngExif = {
    exposureTimeSeconds: positive(33434, "ExposureTime", [5]), fNumber: positive(33437, "FNumber", [5]), focalLengthMillimeters: positive(37386, "FocalLength", [5]),
    photographicSensitivity, sensitivityType: exifNumber(34864, "SensitivityType", [3])?.[0] ?? null, standardOutputSensitivity, recommendedExposureIndex, isoSpeed,
    iso: isoPick ? isoPick[0] : null, isoSource: isoPick ? isoPick[1] : null,
    compositeImage: composite !== null && composite <= 3 ? composite as 0 | 1 | 2 | 3 : null,
    compositeSourceImages: sources && sources.length === 2 ? { total: sources[0]!, used: sources[1]! } : null, subjectArea
  };
  const analogBalance = optional("AnalogBalance", () => {
    const v = integers(pick(50727), colorPlanes, [5]);
    if (v && (v.length !== colorPlanes || v.some((x) => !(x > 0)))) fail("AnalogBalance needs one positive value per color plane.");
    return v;
  });
  const calibration = (id: number, name: string): number[] | null => optional(name, () => {
    const v = integers(pick(id), colorPlanes * colorPlanes, [10]);
    if (v && v.length !== colorPlanes * colorPlanes) fail(name + " needs ColorPlanes × ColorPlanes values.");
    return v;
  });
  const whiteXy = optional("AsShotWhiteXY", () => {
    const v = integers(pick(50729), 2, [5]);
    if (v && (v.length !== 2 || !(v[0]! > 0) || !(v[1]! > 0) || v[0]! + v[1]! >= 1)) fail("AsShotWhiteXY must be a chromaticity.");
    return v ? { x: v[0]!, y: v[1]! } : null;
  });
  const calibrationExtras = { analogBalance, cameraCalibration1: calibration(50723, "CameraCalibration1"), cameraCalibration2: calibration(50724, "CameraCalibration2"),
    cameraCalibrationSignature: optional("CameraCalibrationSignature", () => ascii(pick(50931))), profileCalibrationSignature: optional("ProfileCalibrationSignature", () => ascii(pick(50932))),
    asShotWhiteXy: whiteXy };

  // Semantic masks (DNG 1.6): planned here, decoded with the image.
  const masks = ifds.filter((ifd) => one(ifd, 254, 0) === 0x10004 && one(ifd, 262, 0) === 52527).map((ifd) => {
    if (ifd.has(52536)) assumptions.push("dngImport.semanticMask: MaskSubArea is present; the mask is returned as stored and spans the whole image in applyDngRgbTables.");
    return { name: ascii(ifd.get(52526)) ?? "", instanceId: ascii(ifd.get(52528)), ifd };
  });

  const halve = (r: ImportedDngRect): ImportedDngRect => half ? { x: r.x / 2, y: r.y / 2, width: r.width / 2, height: r.height / 2 } : r;
  const pairMean = (values: number[] | null): number[] | null => values && half ? Array.from({ length: Math.ceil(values.length / 2) }, (_, i) => (values[2 * i]! + (values[2 * i + 1] ?? values[2 * i]!)) / 2) : values;
  const halfActive = half ? { x: Math.floor(activeArea.x / 2), y: Math.floor(activeArea.y / 2), width: Math.ceil((activeArea.x + activeArea.width) / 2) - Math.floor(activeArea.x / 2), height: Math.ceil((activeArea.y + activeArea.height) / 2) - Math.floor(activeArea.y / 2) } : activeArea;
  let blackLevel: ImportedDngBlackLevel = { repeatRows: repeat[0]!, repeatColumns: repeat[1]!, values: black, deltaH, deltaV };
  if (half) {
    // Half size: the black pattern is averaged over its repeat (a LinearRaw file normally has a 1 x 1 repeat), the deltas pairwise.
    const mean = Array.from({ length: spp }, (_, s) => { let t = 0; for (let k = 0; k < repeat[0]! * repeat[1]!; k++) t += black[k * spp + s]!; return t / (repeat[0]! * repeat[1]!); });
    blackLevel = { repeatRows: 1, repeatColumns: 1, values: mean, deltaH: pairMean(deltaH), deltaV: pairMean(deltaV) };
    if (repeat[0]! * repeat[1]! > 1) assumptions.push("dngImport.halfSize: the BlackLevel repeat pattern was averaged to one value per sample.");
    assumptions.push("dngImport.halfSize: a half-size preview; each code is the rounded mean of a 2 x 2 block of stored codes.");
    if (noiseProfile) assumptions.push("dngImport.halfSize: noiseProfile describes the stored codes, not the half-size means (whose noise variance is about a quarter, before rounding).");
  }

  const finish = (semanticMasks: ImportedDngSemanticMask[]): ImportedDngRaw => {
    if (sums) for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
      const count = (Math.min(2, height - 2 * y)) * (Math.min(2, width - 2 * x));
      for (let s = 0; s < spp; s++) { const at = (y * outWidth + x) * spp + s; codes[at] = Math.round(sums[at]! / count); }
    }
    const out = interleaved ? deinterleave(codes, width, height, spp, rowInterleave, columnInterleave) : codes;
    return {
      schemaVersion: DNG_IMPORT_SCHEMA_VERSION, byteOrder: little ? "little-endian" : "big-endian", dngVersion,
      make: ascii(pick(271)), model: ascii(pick(272)), uniqueCameraModel: ascii(pick(50708)), orientation,
      width: outWidth, height: outHeight, samplesPerPixel: spp, bitsPerSample,
      compression: compressionCode === 1 ? "uncompressed" : compressionCode === 7 ? "lossless-jpeg" : compressionCode === 34892 ? "lossy-jpeg" : "jpeg-xl",
      lossySource: compressionCode === 34892 || lossyJxl, scale: half ? 0.5 : 1,
      photometricInterpretation: cfaImage ? "cfa" : "linear-raw", codes: out, cfa,
      linearizationTable: linear ? Uint16Array.from(linear) : null,
      blackLevel, whiteLevel, activeArea: halfActive, defaultCrop: halve({ x: origin[0]!, y: origin[1]!, width: size[0]!, height: size[1]! }),
      colorMatrix1: matrix(50721), colorMatrix2: matrix(50722),
      calibrationIlluminant1: illuminant(50778), calibrationIlluminant2: illuminant(50779), asShotNeutral: neutral,
      rawDataUniqueId: uniqueId ? uniqueId.map((b) => b.toString(16).padStart(2, "0")).join("") : null,
      forwardMatrix1: matrix(50964, true), forwardMatrix2: matrix(50965, true), baselineExposure,
      opcodeList1, opcodeList2, opcodeList3, profileGainTableMap, rgbTables, semanticMasks, noiseProfile, exif, ...calibrationExtras, assumptions
    };
  };
  return { image, write, finish, masks, plan, assumptions, little };
}

/** Decodes one chunk without a JPEG XL decoder; null for JPEG XL data. */
function decodeChunkSync(p: ImagePlan, chunk: Chunk, little: boolean): Uint16Array | null {
  const samples = chunk.width * chunk.rows * p.spp;
  if (p.code === 7) {
    const image = parseLosslessJpeg(chunk.data, { maximumSamples: samples, legacySixteenBitDifference: p.legacy });
    if (image.width * image.height * image.components !== samples) fail("lossless JPEG sample count does not match the strip or tile.");
    return image.samples;
  }
  if (p.code === 34892) {
    const image = parseLossyJpeg(chunk.data, { maximumSamples: samples, ...(p.jpegTables ? { tables: p.jpegTables } : {}) });
    if (image.width !== chunk.width || image.height !== chunk.rows || image.components !== p.spp) fail("lossy JPEG size or components do not match the strip or tile.");
    return Uint16Array.from(image.samples);
  }
  if (p.code === 52546) return null;
  return unpack(chunk.data, chunk.width * p.spp, chunk.rows, p.bits, little);
}
async function decodeChunk(p: ImagePlan, chunk: Chunk, little: boolean, decoder: DngJpegXlDecoder | undefined): Promise<Uint16Array> {
  const sync = decodeChunkSync(p, chunk, little);
  if (sync) return sync;
  if (!decoder) fail("JPEG XL (Compression 52546) data needs a jpegXlDecoder (importDngRawImage).");
  return readJpegXlTilePng(await decoder(chunk.data), chunk.width, chunk.rows, p.spp, p.bits);
}
/** Copies decoded chunks into a mask's 0..1 values. */
function maskValues(p: ImagePlan, decoded: Uint16Array[]): Float32Array {
  const out = new Float32Array(p.width * p.height), scale = 1 / (2 ** p.bits - 1);
  p.chunks.forEach((chunk, k) => {
    for (let y = 0; y < chunk.rows && chunk.y0 + y < p.height; y++) for (let x = 0; x < chunk.width && chunk.x0 + x < p.width; x++)
      out[(chunk.y0 + y) * p.width + chunk.x0 + x] = Math.min(1, decoded[k]![y * chunk.width + x]! * scale);
  });
  return out;
}

/**
 * Undoes Row/ColumnInterleaveFactor (DNG 1.7.0.0): stored row s of a factor-R image holds image row (s mod ⌈H/R⌉)·R + ⌊s/⌈H/R⌉⌋
 * (each field of every R-th row stored together, field by field), and likewise for columns. Inferred from the DNG SDK's
 * `Interleave2D`; to be verified on a phone file.
 */
function deinterleave(codes: Uint16Array, width: number, height: number, spp: number, rows: number, columns: number): Uint16Array {
  const out = new Uint16Array(codes.length), fieldRows = Math.ceil(height / rows), fieldColumns = Math.ceil(width / columns);
  for (let s = 0; s < height; s++) {
    const y = (s % fieldRows) * rows + Math.floor(s / fieldRows);
    if (y >= height) fail("RowInterleaveFactor does not divide the stored rows into whole fields.");
    for (let t = 0; t < width; t++) {
      const x = (t % fieldColumns) * columns + Math.floor(t / fieldColumns);
      if (x >= width) fail("ColumnInterleaveFactor does not divide the stored columns into whole fields.");
      for (let c = 0; c < spp; c++) out[(y * width + x) * spp + c] = codes[(s * width + t) * spp + c]!;
    }
  }
  return out;
}

/**
 * Parse one DNG or TIFF-EP file and decode its primary CFA or LinearRaw image (the first IFD with NewSubFileType 0 and
 * PhotometricInterpretation 32803 or 34892, in IFD-chain then SubIFD order), synchronously.
 *
 * Supported raw data: Compression 1 at 8..16 bits/sample (8 bits as bytes, 16 bits in the file byte order, other depths packed
 * MSB-first with byte-aligned rows, per DNG BitsPerSample), Compression 7 lossless Huffman JPEG (T.81 Annex H) and Compression 34892
 * 8-bit lossy JPEG (T.81 sequential DCT), in strips or tiles, chunky planar configuration only. JPEG XL (52546) needs
 * {@link importDngRawImage}; a JPEG XL semantic mask is skipped here and named in `assumptions`.
 * @returns Owned typed arrays and plain metadata; nothing is applied to the codes.
 */
export function parseDngRawImage(input: DngImportInput): ImportedDngRaw {
  const ctx = prepare(input, ["bytes", "maximumPixels", "maximumIfds", "maximumBytes", "size"]);
  if (ctx.image.code === 52546) fail("JPEG XL (Compression 52546) raw data needs importDngRawImage with a jpegXlDecoder.");
  for (const chunk of ctx.image.chunks) ctx.write(chunk, decodeChunkSync(ctx.image, chunk, ctx.little)!);
  const masks: ImportedDngSemanticMask[] = [];
  for (const m of ctx.masks) {
    const p = ctx.plan(m.ifd, "mask");
    if (p.code === 52546) { ctx.assumptions.push("dngImport.semanticMask: mask " + JSON.stringify(m.name) + " is JPEG XL and was not decoded (use importDngRawImage)."); continue; }
    masks.push({ name: m.name, instanceId: m.instanceId, width: p.width, height: p.height, data: maskValues(p, p.chunks.map((c) => decodeChunkSync(p, c, ctx.little)!)) });
  }
  return ctx.finish(masks);
}

/**
 * {@link parseDngRawImage} for every supported compression, JPEG XL included: each JPEG XL strip or tile goes to `jpegXlDecoder` in
 * turn (one at a time, so only one tile's decoder memory is held), and its PNG is read at the DNG's bit depth (jpeg-xl-tiles.ts).
 */
export async function importDngRawImage(input: DngImportAsyncInput): Promise<ImportedDngRaw> {
  const ctx = prepare(input, ["bytes", "maximumPixels", "maximumIfds", "maximumBytes", "size", "jpegXlDecoder"]);
  const decoder = input.jpegXlDecoder;
  if (decoder !== undefined && typeof decoder !== "function") fail("jpegXlDecoder must be a function.");
  for (const chunk of ctx.image.chunks) ctx.write(chunk, await decodeChunk(ctx.image, chunk, ctx.little, decoder));
  const masks: ImportedDngSemanticMask[] = [];
  for (const m of ctx.masks) {
    const p = ctx.plan(m.ifd, "mask");
    if (p.code === 52546 && !decoder) { ctx.assumptions.push("dngImport.semanticMask: mask " + JSON.stringify(m.name) + " is JPEG XL and no jpegXlDecoder was given."); continue; }
    const decoded: Uint16Array[] = [];
    for (const c of p.chunks) decoded.push(await decodeChunk(p, c, ctx.little, decoder));
    masks.push({ name: m.name, instanceId: m.instanceId, width: p.width, height: p.height, data: maskValues(p, decoded) });
  }
  return ctx.finish(masks);
}

/** Unpack uncompressed rows: 8-bit bytes, 16-bit words in file byte order, other depths MSB-first with byte-aligned rows. */
function unpack(data: Uint8Array, rowSamples: number, rows: number, bits: number, little: boolean): Uint16Array {
  const rowBytes = Math.ceil(rowSamples * bits / 8), out = new Uint16Array(rowSamples * rows);
  if (data.length < rowBytes * rows) fail("uncompressed strip or tile is truncated.");
  for (let y = 0; y < rows; y++) {
    const base = y * rowBytes, o = y * rowSamples;
    if (bits === 8) for (let i = 0; i < rowSamples; i++) out[o + i] = data[base + i]!;
    else if (bits === 16) for (let i = 0; i < rowSamples; i++) {
      const a = data[base + i * 2]!, b = data[base + i * 2 + 1]!;
      out[o + i] = little ? a | (b << 8) : (a << 8) | b;
    } else {
      // Bit accumulator, most significant bit first. At most bits + 7 <= 23 bits are pending, well within 32-bit integer range.
      let accumulator = 0, pending = 0, next = base;
      const mask = (1 << bits) - 1;
      for (let i = 0; i < rowSamples; i++) {
        while (pending < bits) { accumulator = ((accumulator << 8) | data[next++]!) & 0xffffff; pending += 8; }
        pending -= bits;
        out[o + i] = (accumulator >>> pending) & mask;
      }
    }
  }
  return out;
}
