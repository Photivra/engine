# DNG import and PNG output

This page covers two file-format tools added in engine 2.0.0:

- `parseDngRawImage` reads a DNG or TIFF-EP raw file and returns its stored raw codes plus the metadata the RAW development path needs.
- `serializePngImage` writes 8- or 16-bit RGB PNG files with explicit colour signalling, including wide-gamut (Display P3, BT.2020) encodings. The BT.2100 PQ and HLG transfer code points are not offered in 2.0 (their patent holders offer only licence-on-request declarations; see the patent review in `THIRD_PARTY.md`).

Both are browser-safe: they work on `Uint8Array`/`Uint16Array` data, do no file or network IO, and add no dependency (2.22.0's JPEG XL support takes the caller's decoder). Both were written from the published specifications listed under [Sources](#sources); no third-party reader, decoder or encoder source was used.

## DNG import

```ts
import { parseDngRawImage } from '@photivra/engine';

// `fileBytes` holds the DNG file the caller read (from fetch, a file input or the file system).
export function readDng(fileBytes: Uint8Array) {
  const dng = parseDngRawImage({ bytes: fileBytes, maximumPixels: 64_000_000 });
  // dng.codes: Uint16Array, row-major, width x height x samplesPerPixel stored raw codes
  // dng.cfa: { repeatRows, repeatColumns, pattern, planeColors } with its origin at the active-area top-left
  // dng.blackLevel / dng.whiteLevel / dng.activeArea / dng.defaultCrop / dng.colorMatrix1 / dng.asShotNeutral ...
  return dng;
}
```

### What it returns

| Field | Meaning |
| --- | --- |
| `codes` | Stored raw codes in stored (not oriented) order. Nothing is applied: no linearization, black subtraction, scaling, white balance or demosaicing. |
| `cfa` | CFARepeatPatternDim and CFAPattern as plane indices into `planeColors` (CFAPlaneColor; 0 red, 1 green, 2 blue). The pattern's origin is the top-left corner of `activeArea`, as the DNG specification defines. `null` for LinearRaw. |
| `blackLevel` | BlackLevel in row-column-sample order with its repeat size, plus BlackLevelDeltaH/V when present. Origin: active-area top-left. Values may be fractional (RATIONAL). |
| `whiteLevel` | WhiteLevel per sample; default 2^BitsPerSample − 1. |
| `activeArea`, `defaultCrop` | ActiveArea as a rectangle; DefaultCropOrigin/Size relative to the active-area origin (may be fractional). |
| `colorMatrix1/2` | ColorMatrix1/2 (XYZ → camera reference space), row-major, or `null`. |
| `asShotNeutral`, `calibrationIlluminant1/2` | As stored; illuminants use Exif LightSource codes. |
| `linearizationTable` | Returned when present, never applied to `codes`. |
| `orientation`, `make`, `model`, `uniqueCameraModel`, `dngVersion`, `rawDataUniqueId` | As stored. `dngVersion` is `null` for a TIFF-EP file. |

To feed the engine's development path, a caller subtracts the black level per CFA phase, divides by `whiteLevel − black`, and uses `colorMatrix1` (camera ← XYZ) or its inverse as the sensor colour profile. The engine's own `ExportSensorColorProfile.normalizedCameraChannelsToXyz` is the inverse of the matrix the engine writes as ColorMatrix1.

### Supported files

- Classic TIFF in either byte order (`II` or `MM`). BigTIFF is rejected.
- The primary image is the first IFD, in IFD-chain then SubIFD order, with NewSubFileType 0 and PhotometricInterpretation 32803 (CFA) or 34892 (LinearRaw). DNG preview IFDs are skipped.
- Compression 1 (uncompressed) and 7 (lossless Huffman JPEG), in strips or tiles, chunky planar configuration, unsigned integer samples of 8 to 16 bits.
- Uncompressed packing follows the DNG BitsPerSample rule: 8-bit samples are bytes, 16-bit samples use the file byte order, and other depths (10, 12, 14 ...) are packed MSB-first ("FillOrder 1, big-endian, even if the TIFF file itself uses little-endian byte order") with each row starting on a byte boundary.
- Lossless JPEG follows ITU-T T.81 Annex H: one SOF3 frame, precision 2–16, 1–4 components with 1×1 sampling, one interleaved scan, predictors 1–7, point transform, DRI restart intervals of whole lines and 0xFF00 stuffing. As the DNG specification allows, the JPEG frame may have a different width, height and component count from the tile as long as the total sample count matches (CFA tiles are commonly coded as half-width two-component frames). For DNGVersion below 1.1.0.0 the reader applies the specification's "Compatibility Issue 2" (16 extra bits after the 16-bit difference category).
- CFALayout 1 (rectangular) only.

Not supported, and rejected with `InvalidConfigurationError` naming the compression: Deflate (8) and other compressions, floating-point samples, planar configuration 2, more than 16 bits per sample, staggered CFA layouts, multi-scan or subsampled lossless JPEG. From 2.22.0 lossy JPEG (34892) and JPEG XL (52546) raw data are read ([Phone RAW files](#phone-raw-files-2220)). NoiseProfile, maker notes and the camera-profile tags listed there as "reported" are not returned.

### Phone RAW files (2.22.0)

Phones save computational RAW files as DNG 1.6/1.7, usually LinearRaw (already demosaiced), 48 MP or more, and often compressed with JPEG XL or lossy JPEG (#598). Real phone files have not yet been checked: the owner's own sample files (iOS RAW in each format and an Android pro-mode file) and the DNG 1.7.1.0 specification PDF are pending with the owner, so every statement below is tested on synthetic files built from the specifications (`test/dng-import-phone.test.ts`), not on phone output.

| Compression | Reader | Notes |
| --- | --- | --- |
| 34892, lossy JPEG (DNG 1.4.0.0) | `parseDngRawImage` and `importDngRawImage` | 8-bit LinearRaw or masks only (the DNG rule). The engine's own sequential-DCT decoder (`parseLossyJpeg`: T.81 SOF0/SOF1, Huffman, 8- or 16-bit quantization tables, restart intervals, interleaved or non-interleaved scans, JPEGTables (347) shared by every tile, centred linear chroma upsampling, YCbCr → RGB per T.871 unless an APP14 transform of 0 or component ids R, G, B say RGB). The values are gamma-coded: OpcodeList2 MapPolynomial or MapTable, or a LinearizationTable, makes them linear (`developDngStageImage` applies them). `lossySource` is true. |
| 52546, JPEG XL (DNG 1.7.0.0) | `importDngRawImage` with `jpegXlDecoder` | The engine has no JPEG XL decoder and no runtime dependency. The application supplies the decoder: it installs jxl-oxide-wasm itself and loads it (a dynamic `import()`) only when a JPEG XL DNG is opened; `createJxlOxideDngDecoder` adapts the prebuilt jxl-oxide WebAssembly package (npm `jxl-oxide-wasm` 0.12.6, MIT OR Apache-2.0; owner's choice), which returns each tile as a PNG with no colour conversion (`forceSrgb` off). The engine reads that PNG with the platform's `DecompressionStream` and requires 16-bit output for tiles of more than 8 bits. jxl-oxide writes a b-bit sample as round(v·65535/(2^b − 1)); the reader inverts it exactly. Measured: lossless 8-, 12-, 14- and 16-bit grey and RGB tiles round-trip bit-exactly. Lossy JPEG XL (JXLDistance > 0, or no JXLDistance tag) is labelled `lossySource` and reported. `parseDngRawImage` refuses JPEG XL raw data and names `importDngRawImage`. |

```ts
import { createJxlOxideDngDecoder, importDngRawImage } from '@photivra/engine';

// `jxl` is the jxl-oxide-wasm module after its init(), loaded by the app only when a file needs it.
export async function readPhoneDng(fileBytes: Uint8Array, jxl: Parameters<typeof createJxlOxideDngDecoder>[0]) {
  return importDngRawImage({ bytes: fileBytes, jpegXlDecoder: createJxlOxideDngDecoder(jxl), size: 'half' });
}
```

Tags phones add, and what the import does with them:

| Tags | Import |
| --- | --- |
| OpcodeList1/2/3 (51008, 51009, 51022) | Parsed (`opcodeList1/2/3`) and applied by `developDngStageImage` ([Opcode lists](#opcode-lists-2220)). A malformed list is reported and ignored. |
| ProfileGainTableMap2 (52544, IFD 0), else ProfileGainTableMap (52525, raw IFD) | Parsed (`profileGainTableMap`; 8- and 16-bit integer, half- and single-precision gains) and applied by `applyDngProfileGainTableMap`. |
| RGBTables (52543) | Parsed (`rgbTables`) and applied by `applyDngRgbTables`, with the semantic masks. |
| Semantic masks (NewSubFileType 0x10004, PhotometricInterpretation 52527; SemanticName 52526, SemanticInstanceID 52528) | Decoded to 0..1 (`semanticMasks`); MaskSubArea (52536) is reported and the mask spans the whole image. |
| RowInterleaveFactor (50975), ColumnInterleaveFactor (52547) | Undone after decoding. The stored order (each field of every R-th row or column stored together) is inferred from the DNG SDK and reported until a phone file confirms it. |
| ForwardMatrix1/2, BaselineExposure (+ BaselineExposureOffset) | Returned. |
| ProfileHueSatMap, ProfileLookTable, ProfileToneCurve, DefaultBlackRender, CalibrationIlluminant3, ColorMatrix3, ForwardMatrix3, IlluminantData1–3, ProfileDynamicRange, EnhanceParams, JUMBF, depth, enhanced and gain-map image IFDs | Reported in `assumptions` as present and not applied. |
| JXLDistance (52553) | Read for `lossySource`. JXLEffort, JXLDecodeSpeed, ImageSequenceInfo, ImageStats, ProfileGroupName and other informational tags are ignored. |

None of these tags fails an import. The DNG 1.7.1.0 specification PDF could not be downloaded while 2.22.0 was written (HTTP 403); the layouts of the opcode lists, the profile gain table map and RGBTables were checked against the DNG SDK 1.7.1 source and still need checking against the PDF's sections.

### Memory (2.22.0)

`maximumBytes` (default 1 GiB, at most 4 GiB) is checked before any image allocation against an estimate: the output codes (2 bytes per sample; a half-size preview adds 4-byte sums for a quarter of the samples), the largest strip or tile's samples twice (decode buffer and copy) and its decoder's working memory (lossless JPEG 2 bytes, lossy JPEG 3 bytes, JPEG XL an assumed 16 bytes per sample: jxl-oxide's 32-bit channels, its float render and the PNG; not measured). Row/column interleave adds a second copy of the codes. The `maximumPixels` limit (default 64 MP) stays, so a 48 MP file passes it. For a 48 MP LinearRaw RGB file the codes are 288 MB; `size: "half"` decodes strip by strip into 2 × 2 means (72 MB of codes plus 144 MB of sums). These are arithmetic estimates; measurements on phones are pending with the owner's samples. JPEG XL tiles are decoded one at a time, so only one tile's decoder memory is live; an app can run the import in a worker it terminates afterwards to release the WebAssembly memory.

### Opcode lists (2.22.0)

`developDngStageImage(raw, { format?, fast?, opcodes? })` builds the DNG's stage image, normalized to 0..1: OpcodeList1 on the stored codes; LinearizationTable, black subtraction (BlackLevel with its repeat pattern and BlackLevelDeltaH/V, origin the ActiveArea's top-left) and division by WhiteLevel − black over the ActiveArea; OpcodeList2; and, for LinearRaw, OpcodeList3. For a CFA mosaic it stops at stage 2, and the caller applies OpcodeList3 with `applyDngOpcodes(image, raw.opcodeList3, { stage: 3, fast })` after demosaicing. Every opcode reports whether it was applied.

| Opcode | Applied as |
| --- | --- |
| MapTable (7) | value → table[round(value·65535)] / 65535 (index clamped to the table) |
| MapPolynomial (8) | value → Σ cᵢ·valueⁱ, clipped to 0..1 |
| GainMap (9) | gain bilinear between map points at the pixel centre's relative position (held at the map's edges), map plane min(plane, MapPlanes − 1); result at most 1 |
| DeltaPerRow/Column (10, 11), ScalePerRow/Column (12, 13) | one value per pitched row or column, clipped to 0..1 |
| FixVignetteRadial (3) | gain 1 + k0r² + … + k4r¹⁰, r normalized to 1 at the farthest corner from the optical centre |
| WarpRectilinear (1) (#600) | source = centre + m·[(dx, dy)(kr0 + kr1r² + kr2r⁴ + kr3r⁶) + tangential terms], one parameter set for all planes or one per plane, held within the image. Resampling: cubic convolution (Keys, a = −0.75, the DNG SDK's kernel) at full quality; bilinear with `fast` (registered as `dngImport.warpRectilinear`; default from `format`: fast for "srgb-8"/"srgb-16" and when omitted, full quality for the exports "dng", "jpeg" and "png"). The SDK quantizes the fractional position to its resampling grid; this reader uses the exact position. |
| FixBadPixelsConstant (4), FixBadPixelsList (5) (#600) | on single-plane CFA data: the mean of the nearest good same-colour neighbours, green first the four diagonals, then the four at distance 2, then the four at (±2, ±2); red and blue the four at distance 2, then (±2, ±2). The DNG SDK estimates isolated list points along the smoother direction instead; this reader uses the ring mean for every bad pixel. |
| WarpFisheye (2), TrimBounds (6), WarpRectilinear2 (14), unknown ids | reported, not applied (with whether the file marks them optional) |

In a half-size preview pixel-coordinate parameters are halved; pitched areas and bad-pixel opcodes are then reported, not applied.

### Profile gain table map and RGBTables (2.22.0)

Both act on the file's own developed values (owner, 2026-11-10), at fixed places of a DNG development: camera RGB → white balance → linear ProPhoto (RIMM, D50) RGB with 1 the clipping white → **ProfileGainTableMap** → BaselineExposure → look table → tone curve → **RGBTables** → output space (the DNG SDK's render order).

- `applyDngProfileGainTableMap({ image, map, baselineExposureStops?, region?, overrange? })`: the weight t = clamp(w·(R, G, B, min, max)·2^BaselineExposure, 0, 1)^γ selects a gain by linear interpolation at t·N in the table (index clamped to N − 1), bilinear between map points at the pixel centre's position in the stage-3 image; R, G and B are multiplied by it and clipped to 0..1 unless `overrange`.
- `applyDngRgbTables({ image, tables, masks? })`: each 3D table converts ProPhoto RGB to its primaries (sRGB, Adobe RGB, P3, Rec. 2020 or ProPhoto, Bradford-adapted to D50, derived from the primaries' chromaticities), clips to 0..1 (GamutExtension "extend" adds the clipped part back afterwards), encodes with its gamma (linear, sRGB, 1.8, 2.2 or the Rec. 2020 OETF), interpolates tetrahedrally, decodes and converts back. The background table (empty name) covers the whole image; masked tables composite by weighted sum or in sequence, as the file's CompositeMethod says. A table whose mask is missing is reported and skipped. The matrices are computed from published chromaticities, so they can differ slightly from the SDK's own matrices (an approximation; the difference was not measured).


### Untrusted input

The reader treats every file as hostile:

- Every IFD offset, tag value extent, strip/tile offset and byte count is checked against the buffer before it is read.
- IFD chains and SubIFDs are walked with a visited set: a loop or two IFDs at one offset fail. The total IFD count is capped (`maximumIfds`, default 64, at most 1024) and SubIFD nesting is limited to three levels.
- Duplicate tags in one IFD, zero rational denominators, non-finite values and tag arrays longer than their defined size fail.
- `width × height` is checked against `maximumPixels` (default 64 000 000, at most 200 000 000) before any image allocation; tiles are also capped. A lossless JPEG frame header is checked against the strip or tile's sample count before its output is allocated, so a small stream cannot declare a huge frame (decompression bomb).
- Truncated entropy data, invalid Huffman codes, over-subscribed Huffman tables, missing restart markers and reconstructed samples above the declared precision or BitsPerSample fail.

`test/dng-import.test.ts` covers engine-exported DNG round trips (identical codes, CFA, black and white levels, active area, matrices, neutral, orientation and RawDataUniqueID), uncompressed 8/10/12/14/16-bit strips and tiles in both byte orders, lossless JPEG tiles for all seven predictors with restarts and point transform, the 16-bit difference special case, SubIFD discovery, and a fixed-seed mutation fuzz (3000 corrupted and truncated files) in which every outcome is either a decoded image or an `InvalidConfigurationError`. The lossless JPEG streams in these tests come from a separate test-only encoder; no real-camera DNG corpus is committed, so interoperability with specific camera files is not claimed.

## PNG output

```ts
import { serializePngImage } from '@photivra/engine';

// Two pixels of 16-bit linear BT.2020 RGB (code values already scaled by the caller).
const png = serializePngImage({
  width: 2, height: 1, bitDepth: 16,
  samples: Uint16Array.of(32768, 30000, 28000, 65535, 65535, 65535),
  colourEncoding: { kind: 'cicp', primaries: 'bt2020', transfer: 'linear', fullRange: true },
  masteringDisplay: { redXy: [0.708, 0.292], greenXy: [0.17, 0.797], blueXy: [0.131, 0.046], whiteXy: [0.3127, 0.329],
    maximumLuminanceCdPerSquareMeter: 1000, minimumLuminanceCdPerSquareMeter: 0.0001 },
  contentLightLevel: { maximumContentLightLevelCdPerSquareMeter: 1000, maximumFrameAverageLightLevelCdPerSquareMeter: 200 }
});
if (png[1] !== 0x50) throw new Error('not a PNG');
```

The encoder writes the caller's integer code values unchanged. Converting linear light to an encoded signal (for example sRGB), choosing primaries and mapping out-of-gamut colours are the caller's job; the colorimetry module provides those transfer functions and primaries.

### Colour signalling

`colourEncoding` is required and is exactly one of:

| `kind` | Chunks written | Meaning |
| --- | --- | --- |
| `srgb` | `sRGB` (rendering intent) + `gAMA` 45455 + `cHRM` | The sRGB chunk, with the gAMA/cHRM values the PNG specification lists as the only ones allowed beside it, for older decoders. |
| `icc` | `iCCP` | A caller-supplied ICC profile (header size must equal its length), zlib-compressed. The profile name is 1–79 Latin-1 characters. |
| `cicp` | `cICP` | ITU-T H.273 code points. PNG permits only MatrixCoefficients 0 (RGB). |

cICP code points (H.273; matching the PNG specification's examples):

| Option | Code | Standard |
| --- | --- | --- |
| `primaries: 'bt709'` | 1 | ITU-R BT.709 (same primaries as sRGB) |
| `primaries: 'display-p3'` | 12 | P3 primaries, D65 white (W3C CSS Color 4 `display-p3`; also SMPTE EG 432-1) |
| `primaries: 'bt2020'` | 9 | ITU-R BT.2020 |
| `transfer: 'bt709'` | 1 | ITU-R BT.709 |
| `transfer: 'linear'` | 8 | Linear |
| `transfer: 'srgb'` | 13 | sRGB (W3C CSS Color 4; also IEC 61966-2-1) |

So Display P3 is `{ primaries: 'display-p3', transfer: 'srgb', fullRange: true }` (cICP `0C 0D 00 01`) and linear BT.2020 is `09 08 00 01`.

Static display metadata is written only with `cicp`, as the PNG specification requires a cICP chunk alongside mDCV. It stays available without PQ and HLG: the PNG Third Edition (§11.3.2.7) says mDCV "may also be included with HLG and SDR image formats (for example ITU-R BT.709)", and both chunks are caller-supplied descriptions, not a transfer function:

- `masteringDisplay` → `mDCV` (W3C PNG Third Edition; also SMPTE ST 2086): R, G, B and white CIE 1931 xy chromaticities stored in units of 0.00002, maximum and minimum luminance in units of 0.0001 cd/m².
- `contentLightLevel` → `cLLI` (W3C PNG Third Edition; also CTA-861.3): MaxCLL and MaxFALL in units of 0.0001 cd/m²; 0 means unknown. MaxFALL above a known MaxCLL is rejected.

The engine does not compute MaxCLL/MaxFALL or mastering metadata; the caller supplies them.

Each `colourEncoding` kind accepts only its own fields (`srgb`: `kind`, `renderingIntent`; `icc`: `kind`, `profileName`, `profile`; `cicp`: `kind`, `primaries`, `transfer`, `fullRange`), and `masteringDisplay` and `contentLightLevel` accept only their documented fields. Code-point names are looked up in maps, so a name such as `"constructor"` or `"toString"` is rejected instead of reaching `Object.prototype`.

### Pixels and compression

- Colour type 2 (truecolour), bit depth 8 (`Uint8Array`) or 16 (`Uint16Array`, written big-endian), no interlacing, at most 65535 pixels per side and 100 000 000 pixels. From 2.2 the optional `maximumPixels` input raises the pixel limit up to `PNG_ENCODER_LIMITS.ceilingPixels` (2^27 = 134 217 728), for example for a 12 252 × 8 168 (100.07 MP) image; the bytes written do not depend on it. Measured memory and time are in the quick start's [Large images](QUICK_START.md#large-images).
- Filtering: one PNG filter type for every row (`none`, `sub`, `up`, `average`, `paeth`) or `adaptive` (default), the specification's suggested heuristic: per row, the type with the minimum sum of absolute signed filtered bytes (ties go to the lower type).
- Compression: zlib (RFC 1950) holding either stored DEFLATE blocks or one fixed-Huffman block (RFC 1951) with a greedy LZ77 matcher (3-byte hash, 32 KiB window, at most 64 chain probes). This is a deterministic, modest compressor, not a size-optimal one. Output bytes depend only on the input; a platform `CompressionStream` is deliberately not used, because its output is not specified byte for byte. IDAT is split into 1 MiB chunks. The fixed-Huffman codes are precomputed bit-reversed, the LZ77 hash rolls from byte to byte, and each filter type has its own loop; `test/png-encoder.test.ts` pins a SHA-256 over every filter and compression mode, so these speed-ups keep the output bytes unchanged.

`test/png-encoder.test.ts` decodes every output with Node's zlib and an independent reconstruction-filter implementation, checks every chunk CRC, and requires exact 8- and 16-bit round trips for all filters and both compression modes. It checks cICP, mDCV and cLLI bytes against the PNG specification's worked examples, and that `pq` and `hlg` are rejected. During development the outputs were also opened with Pillow 12.3.0: every file decoded, 8-bit pixels matched exactly, and 16-bit files (which Pillow reduces to 8-bit RGB) matched the high byte of every sample. Pillow does not interpret cICP, mDCV or cLLI, so their display behaviour was not verified in a viewer.

### Not provided: AVIF and HEIC

AVIF and HEIC still images are AV1 and HEVC intra frames inside an ISO-BMFF (HEIF) container. Writing them needs a full AV1 or HEVC encoder (transforms, intra prediction, entropy coding and, for HEVC, patent-licensed technology). That is far outside a dependency-free scientific engine, and pulling in a codec would add a large native or WebAssembly dependency with its own licence review. PNG with cICP carries wide-gamut signalling losslessly; a host application that needs AVIF or HEIC can transcode the PNG or the 16-bit samples with a platform or third-party encoder.

## Sources

- Adobe, *Digital Negative (DNG) Specification*, version 1.7.1.0, September 2023 — tag definitions, BitsPerSample packing, lossless JPEG use, ActiveArea/CFA/BlackLevel origin, Compatibility Issue 2, lossy JPEG and JPEG XL compression, opcode lists, ProfileGainTableMap, RGBTables, semantic masks.
- Adobe DNG SDK 1.7.1 source — read, not copied, for the 2.22.0 opcode, gain-table-map and RGBTables layouts and evaluation order while the 1.7.1.0 PDF was unreachable; to be checked against the PDF.
- ISO/IEC 18181-1:2022 (JPEG XL codestream) — only for the test-only lossless encoder in `test/helpers/phone-dng-fixtures.ts`; decoding is the caller's jxl-oxide.
- ITU-T Recommendation T.871 (JFIF; YCbCr conversion and chroma siting) and T.872 (the APP14 colour-transform convention), both free.
- Adobe, *TIFF Revision 6.0*, 1992 — file structure, IFDs, field types, strips and tiles.
- CIPA DC-008 (Exif 2.32 / 3.0), free at <https://www.cipa.jp/e/std/std-sec.html> — CFAPattern; the DNG specification above defines CFARepeatPatternDim/CFAPattern use and origin. The TIFF/EP tags are also specified in ISO 12234-2.
- ITU-T Recommendation T.81 (1992), free at <https://www.w3.org/Graphics/JPEG/itu-t81.pdf> (identical text: ISO/IEC 10918-1), Annex H (lossless processes), Annex C and F.2.2.3 (Huffman tables and decoding), F.1.2.3 (restart), A.3.3 and Annex F (sequential DCT decoding, 2.22.0).
- W3C, *Portable Network Graphics (PNG) Specification (Third Edition)*, W3C Recommendation 24 June 2025 — chunks, filters, cICP, mDCV, cLLI, sRGB gAMA/cHRM values.
- IETF RFC 1950 (zlib) and RFC 1951 (DEFLATE).
- ITU-T Recommendation H.273 — colour primaries and transfer characteristics code points.
- ITU-R BT.2020; ITU-T H.265 Annex D (mastering display colour volume and content light level SEI semantics); W3C CSS Color 4 `display-p3` (P3 primaries) — meaning of the signalled values, all free. Also specified in SMPTE ST 2086, CTA-861.3 and SMPTE EG 432-1.

Only factual identifiers (tag numbers, code points, chunk layouts, fixed values) are taken from these standards.
