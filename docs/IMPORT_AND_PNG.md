# DNG import and PNG output

This page covers two file-format tools added in engine 2.0.0:

- `parseDngRawImage` reads a DNG or TIFF-EP raw file and returns its stored raw codes plus the metadata the RAW development path needs.
- `parsePhotoMetadata` (2.25.0) reads the capture metadata of a JPEG or HEIC/HEIF file from its headers, without decoding pixels ([JPEG and HEIF metadata](#jpeg-and-heif-metadata-2250)).
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
| `noiseProfile` (2.24.0) | NoiseProfile (51041) as one `{ scale, offset }` pair per color plane: var(x) = S·x + O for x = (code − black)/(white − black), white and spatially independent noise (fixed-pattern noise is left out). A two-value tag applies to every plane. `null` when absent; a malformed tag (S ≤ 0, O < 0, a wrong count) is reported in `assumptions` and returned as `null`. |
| `exif` (2.24.0) | The capture settings the file states, from the Exif IFD (34665), else the same tags in IFD 0 or the raw IFD (TIFF/EP): `exposureTimeSeconds`, `fNumber`, `focalLengthMillimeters` (actual, not 35 mm equivalent), `photographicSensitivity` (65535 means "65535 or more"), `sensitivityType`, `standardOutputSensitivity`, `recommendedExposureIndex`, `isoSpeed`, the resolved `iso` and its `isoSource` (RecommendedExposureIndex, else ISOSpeed, else StandardOutputSensitivity, else PhotographicSensitivity below 65535), `compositeImage` (0xA460: 0 unknown, 1 not a composite, 2 composite, 3 composite captured while shooting), `compositeSourceImages` (0xA461), `subjectArea` (0x9214: a point, circle or rectangle), and (2.26.0, #648) `subjectDistanceMeters` (0x9206, RATIONAL: meters, or the words `"unknown"` for a numerator of 0 and `"infinity"` for 0xFFFFFFFF, as Exif 2.32 §4.6.5 defines them; another zero denominator is reported and ignored) and `subjectDistanceRange` (0xA40C: `"unknown"`, `"macro"`, `"close-view"` or `"distant-view"` for codes 0–3; other codes are reported and ignored). Each is `null` when absent; a malformed one is reported in `assumptions`. |
| `analogBalance`, `cameraCalibration1/2`, `cameraCalibrationSignature`, `profileCalibrationSignature`, `asShotWhiteXy` (2.24.0) | As stored, or `null`; used by `developDngImage`. |
| `exif` additions (2.25.0, schema 1.3.0) | `focalLengthIn35mmFilmMillimeters` (FocalLengthIn35mmFilm, 0xA405, a whole number of mm; 0, "unknown" in Exif, is `null`), `digitalZoomRatio` (0xA404; a stated 0, "not used", is 1; a value between 0 and 1 is reported and `null`), `focalPlaneResolution` (FocalPlaneX/YResolution 0xA20E/0xA20F with FocalPlaneResolutionUnit 0xA210: `x`, `y`, `unit` "inch" (2, the default), "centimeter" (3) or "none" (1), `unitStated`, and pixels per millimeter) and `pixelDimensions` (PixelX/YDimension 0xA002/0xA003). The fields and rules are shared with `parsePhotoMetadata`. |
| `software` (2.25.0) | Software (305), IFD 0 else the raw IFD, as stored, or `null`. |
| `enhancedImages` (2.25.0) | One entry per enhanced-image IFD (NewSubFileType 16, DNG 1.6): `width`, `height`, `samplesPerPixel`, `bitsPerSample`, `photometricInterpretation` and `compression` codes, and `enhanceParams` (EnhanceParams, 51182, the writer's description of the enhancement, as stored). The enhanced pixels are not decoded; `assumptions` still says the raw image is used. |

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
| ProfileHueSatMap, ProfileLookTable, ProfileToneCurve, DefaultBlackRender, CalibrationIlluminant3, ColorMatrix3, ForwardMatrix3, IlluminantData1–3, ProfileDynamicRange, JUMBF, depth, enhanced and gain-map image IFDs | Reported in `assumptions` as present and not applied. From 2.25.0 the enhanced-image IFDs and their EnhanceParams are also returned as `enhancedImages` (not decoded). |
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


### RAW measurements, what-if and development (2.24.0)

From the [#607 feasibility research](https://github.com/Photivra/engine/issues/607) (report `docs/research/photo-feasibility.md`, merged separately), the capabilities rated "go", each computed per site at use (no table indexed by signal level).

- **`calculateDngRawClipping(raw, { marginFraction? })`** counts, per color plane over the default crop, the sites whose linearized code reaches WhiteLevel (exact by definition) and those at x ≥ 1 − `marginFraction` (default 0.01, a threshold choice: a sensor's saturation can sit just below the file's single WhiteLevel, the smallest of its phases' whites). `confidence` is `"exact"` for a lossless CFA mosaic, `"processed"` for LinearRaw (the stored values, not proven sensor clipping) and `"lossy"`. Honest claim: "N % of the sensor is clipped (red/green/blue)".
- **`estimateDngRawNoise(raw, { signalLevels?, bins?, minimumBlocksPerBin? })`** fits var(x) = S·x + O per color plane from one image (Foi, Trimeche, Katkovnik & Egiazarian 2008, Poisson–Gaussian model) with the robust MAD of the finest diagonal Haar detail of 2 × 2 same-color blocks (σ = 1.4826·MAD, Donoho & Johnstone 1994), blocks with structure screened out, binned by signal. It reports σ at the plane's median signal and at the requested levels, and the ratio to the file's NoiseProfile. On engine captures of known noise (ISO 100 and 3200, 256 × 256) σ at the median read 0.90 to 1.005 of the NoiseProfile on charts with flat areas and edges, and 1.09 to 1.38 on dense fine texture (dead leaves), where texture reads as noise; the offset O is poorly determined. Honest claim: "measured noise ≈ σ at this brightness (may read high on fine texture)". LinearRaw (demosaiced noise is correlated), lossy data and half-size previews are refused.
- **`simulateDngRawWhatIf(raw, { exposureStops?, iso?, sourceIso?, highGainFromIso?, seed, verifyNoiseProfile? })`** returns the RAW of the same scene with less light (`exposureStops` < 0) and/or a higher ISO, from the file's NoiseProfile: each site gets Gaussian noise of variance f·g²·S·x̂·(1 − f) + g²·O·(1 − f²) − g²·q (f the light factor, g the ISO factor, q = 1/12 LSB², x̂ the site's own value), so shot and read noise stay consistent; the target profile is S' = g·S, O' = g²·(O − q) + q. The draws are seeded per site (MurmurHash3 stream seeds, a portable Box–Muller), so a seed gives the same codes on every JavaScript engine. A positive `exposureStops` is not a cleaner capture: it is returned as `developmentPushStops`, labeled "brightened in editing (same noise, not a longer exposure)". Every result has a `label` ("Simulation: this RAW with 2 stops less light at ISO 400, using the sensor's noise model."). **Refusals** (`DngRawWhatIfRefusedError.refusals`, or `assessDngRawWhatIf` beforehand): `not-a-mosaic` (LinearRaw), `lossy-raw-data`, `no-noise-profile`, `half-size-preview`, `linearization-table` (not supported in 2.24.0), `noise-profile-mismatch` (the green plane's measured σ is below 0.85 of the profile's, owner decision 2026-11-11: the data was denoised or merged after capture; the research's phone RAW measured 0.084, and 32 engine RAWs of smooth and textured scenes at ISO 100–12800 measured 0.95 or more; a file whose noise cannot be measured, because it has too few smooth blocks (small, very dark or smooth images) or no positive fitted variance (noise-free data), is not refused: `measuredToProfile` is `null` and an assumption says "The file's noise could not be measured, so its NoiseProfile was not verified." (2.28.0, #719; owner decision 2026-11-21)), `iso-unknown`, `iso-below-photo` (needs noise removal), `gain-mode-unknown` (an ISO change needs the camera's dual-gain switch: the caller's `highGainFromIso`, or `null` for a single conversion gain, else the camera's entry in `DNG_GAIN_SWITCH_CATALOG`; the file does not state it, and a camera without an entry is refused, while a darker exposure needs none) and `crosses-gain-switch` (owner decision 2026-11-11: an ISO what-if stays within the photo's own conversion-gain mode; across the switch the photo's profile gives up to 2× too much shadow noise). Validation (engine captures, 128 × 128 uniform patches at seven reflectances, the research's statistic: the simulated ÷ real per-phase variance against its 95 % interval): two stops darker 25 of 28 inside, ISO 100 → 400 26 of 28, ISO 800 → 6400 18 of 18 (about 95 % expected by chance), ratios 0.93–1.07, means within 4 standard errors; across the switch (ISO 100 → 1600, refused) 21 of 28 with ratios up to 1.28. Fixed-pattern noise is not in NoiseProfile and is kept as the photo has it. **Clipped sites** (at the white level in the photo) stay at the white level: their true light is unknown, so with less signal (light factor × ISO factor below 1) the white level is an upper bound, and they would read between black + f·g·(white − black) and white. `clippedSitesKept` counts them, and an assumption names the count and the bound when it is above 0 (2.28.0, #679; owner decision 2026-11-21: labeled, values unchanged).
- **`developDngImage(raw, options?)`** (async) is the full color development of an imported DNG. Before 2.24.0 the engine had the stage image (`developDngStageImage`), the demosaic tasks, the gain-map and RGB-table functions and the SDR renderer, but nothing joined them for an imported file; this is that glue: the stage image, a bilinear (`fast`) or AHD (full quality) demosaic of a 2 × 2 Bayer mosaic and OpcodeList3, camera → XYZ (D50) as the DNG specification maps it (ColorMatrix and ForwardMatrix interpolated in inverse CCT between the CIE calibration illuminants, CameraCalibration when its signature matches, AnalogBalance, the white found from the camera neutral by iteration, each white-balanced channel clipped at 1), ProfileGainTableMap, BaselineExposure (option `baselineExposure`, default true), the push (`exposurePushStops`, labeled), the engine's SDR tone curve (default identity, as `simulateCapture`), RGBTables, gamut handling and the sRGB encoding, then the default crop and the Orientation. `whiteBalance`: `"as-shot"` (AsShotNeutral, else AsShotWhiteXY, else D65), `{ kelvin, duv?, whiteLocus? }`, `{ chromaticity }` or `{ cameraNeutral }`. On the engine's own DNG it reproduces the engine's sRGB development exactly away from the 2-pixel border (the engine reads sites outside the ActiveArea there; this function mirrors). The camera neutral is normalized to its largest component (the DNG convention); the engine's own development keeps green at 1, so under a white whose red or blue neutral exceeds green the two differ by that factor in exposure. The profile's own tone curve, hue/saturation and look tables are not applied (named in `assumptions`).

- **Half-size preview (2.25.0, #622).** `developDngImage(raw, { size: "half" })` develops a half-size image for on-screen use. With `fast` (the default for `"srgb-8"` and `"srgb-16"`) each 2 × 2 CFA repeat is binned into one RGB pixel: the mean of its sites of each color, so a Bayer repeat gives red and blue from one site and green from two, with no demosaic (`demosaic: "bin-2x2"`); OpcodeList3 then runs at scale 0.5 (bad-pixel and pitched-area opcodes are skipped and named, as for a half-size import), and the color, ProfileGainTableMap, BaselineExposure, push, tone curve, RGBTables, crop and Orientation follow on the half grid. With `fast: false` the exact full-size development (AHD) is averaged over each 2 × 2 block in linear light before the tone curve and gamut handling, the exact reference for the half size. A LinearRaw image is averaged over 2 × 2 blocks. The stage grid is halved (an odd last row or column is dropped) and the crop maps outward to [⌊x/2⌋, ⌈(x + w)/2⌉) on each axis, so an odd crop origin or size gains at most one half-size pixel per edge. The binned red and blue sit half a site from the pixel center, an approximation that shows at edges: against the exact half size on engine DNGs (192 × 128 stage images, measured on this tree, linear-light component differences away from a 2-pixel border) a uniform 18 % patch measured a mean of 2.0 × 10⁻³ (the noise), bias −2.6 × 10⁻⁶; the color patches a median of 2.5 × 10⁻³ and a 99th percentile of 0.13 (at patch edges); a Siemens star a median of 5.0 × 10⁻³ and a 99th percentile of 0.72 (its aliased center). Saving should use the full size (`size` omitted or `"full"`), which is unchanged. A file imported at half size (`importDngRawImage` with `size: "half"`) is refused. Speed: on a synthetic 6000 × 4000 mosaic, one run on a heavily loaded machine (load average about 400, so the absolute times are far above an idle machine's), the fast half size took 41.6 s and 74.9 s (two runs) against 144.8 s for the fast full size; the stage image (linearization, black level, OpcodeList1/2) still runs at full size.

### Adding a gain-switch entry (2.24.0)

`DNG_GAIN_SWITCH_CATALOG` (`src/capture/dng-gain-switch.ts`; `resolveDngGainSwitch(raw)` looks a file up) lists cameras' dual-gain switch points. It is empty in 2.24.0 and still empty in 2.25.0 after a second review (#623): the one stated switch point found (a cinema camera manual that also covers CinemaDNG stills) could not be tied to Make and Model tags checked on a file, and the other sources give base sensitivities, video-only values or have no reuse terms (THIRD_PARTY.md, "Dual-gain switch points"). Without an entry, pass the camera's `highGainFromIso` (or `null`) to `simulateDngRawWhatIf`. To add a camera:

1. Find a free-to-use source that **states** the ISO setting from which the camera uses its high conversion gain for photos (manufacturer documentation, or openly published measurements whose terms allow reuse of the facts). A value derived from overlapping menu ranges, read off a chart or measured by us is not enough.
2. Add `{ make, model, highGainFromIso, source: { title, url, terms, accessed } }`, with `make` and `model` exactly as the file's Make (271) and Model (272) tags state them (check them on a file from that camera; the make is compared without case).
3. Add the line to THIRD_PARTY.md, "Dual-gain switch points", and a CHANGELOG entry. `test/dng-raw-analysis.test.ts` checks every entry for a source, terms and no duplicates.

### Rewriting a DNG without personal data (2.25.0)

`serializeRewrittenDng({ bytes, edits?, maximumIfds? })` (#620) writes a DNG from a DNG file, optionally with edited development settings, and leaves out personal data. It writes **only** the tags on `DNG_REWRITE_ALLOWED_TAGS` (an allowlist, so a tag a camera adds later is dropped too):

- `raw`: the raw image's layout and data tags (size, compression, CFA pattern and plane colors, linearization, black and white levels, active and masked areas, default crop and scale, the opcode lists, NoiseProfile, the profile gain table map, the interleave factors and the JPEG XL tags), read from the raw IFD;
- `camera`: DNGVersion and DNGBackwardVersion, Make, Model, UniqueCameraModel, Software, Orientation and the color profile (color, forward, reduction and calibration matrices with their illuminants and signatures, AnalogBalance, AsShotNeutral or AsShotWhiteXY, BaselineExposure and its offset, BaselineNoise and BaselineSharpness, LinearResponseLimit, the profile name, embed policy, hue/saturation and look tables, tone curve, ProfileGainTableMap2, RGBTables and the DNG 1.6 third-illuminant tags), read from IFD 0, else the raw IFD;
- `exif`: the capture settings that the DNG import's `exif` reads (`ExifCaptureFields`: exposure time, f-number, focal length and its 35 mm value, the sensitivity tags, digital zoom, the focal-plane resolution, the pixel dimensions, CompositeImage and SubjectArea), ExposureBiasValue and the lens's specification, make and model, written to an Exif IFD;
- `mask`: each semantic mask's layout, data, name, instance id and MaskSubArea.

Everything else is left out, among it: GPS data, BodySerialNumber, CameraSerialNumber and LensSerialNumber, CameraOwnerName, Artist, Copyright, ImageDescription and UserComment, MakerNote and DNGPrivateData, XMP and IPTC, ImageUniqueID and RawDataUniqueID, OriginalRawFileName and OriginalRawFileData, the dates, the digests, previews and thumbnails, depth and gain-map images, enhanced images and Content Credentials (JUMBF). The result lists the tag ids it wrote (`writtenTags`), the ids it left out (`omittedTags`; values are never returned) and the images it did not write (`omittedImages`).

- **Raw data.** Each strip or tile is copied byte for byte: uncompressed, lossless JPEG, lossy JPEG and JPEG XL data are not decoded or re-encoded, and the file keeps the source's byte order, so every copied value keeps its meaning. The written file has one IFD 0 holding the raw image (NewSubFileType 0), an Exif IFD and the semantic masks as SubIFDs. It reads back through `parseDngRawImage` / `importDngRawImage` with the same codes and the same development fields, so `developDngImage` gives the same pixels (tested on synthetic DNGs in both byte orders and on the engine's own DNG export). Opening in other RAW editors is not tested in the repository.
- **Edits** (`edits`): `asShotNeutral` (one positive value per color plane; AsShotWhiteXY is then left out) or `asShotWhiteXy` (AsShotNeutral is then left out), `baselineExposure` (stops, written as the total, BaselineExposureOffset left out, so the import reads back the value), `defaultCrop` (inside the active area; whole numbers as LONG, others as RATIONAL with a power-of-ten denominator) and `orientation` (1–8). Other settings are kept as the source states them.
- **Refused:** a file without DNGVersion (TIFF/EP files are not rewritten), BigTIFF, and the import's structural errors (IFD loops, out-of-range offsets, too many IFDs). The input is untrusted: every offset and count is checked against the buffer before it is read.

### Untrusted input

The reader treats every file as hostile:

- Every IFD offset, tag value extent, strip/tile offset and byte count is checked against the buffer before it is read.
- IFD chains and SubIFDs are walked with a visited set: a loop or two IFDs at one offset fail. The total IFD count is capped (`maximumIfds`, default 64, at most 1024) and SubIFD nesting is limited to three levels.
- Duplicate tags in one IFD, zero rational denominators, non-finite values and tag arrays longer than their defined size fail.
- `width × height` is checked against `maximumPixels` (default 64 000 000, at most 200 000 000) before any image allocation; tiles are also capped. A lossless JPEG frame header is checked against the strip or tile's sample count before its output is allocated, so a small stream cannot declare a huge frame (decompression bomb).
- Truncated entropy data, invalid Huffman codes, over-subscribed Huffman tables, missing restart markers and reconstructed samples above the declared precision or BitsPerSample fail.

`test/dng-import.test.ts` covers engine-exported DNG round trips (identical codes, CFA, black and white levels, active area, matrices, neutral, orientation and RawDataUniqueID), uncompressed 8/10/12/14/16-bit strips and tiles in both byte orders, lossless JPEG tiles for all seven predictors with restarts and point transform, the 16-bit difference special case, SubIFD discovery, and a fixed-seed mutation fuzz (3000 corrupted and truncated files) in which every outcome is either a decoded image or an `InvalidConfigurationError`. The lossless JPEG streams in these tests come from a separate test-only encoder; no real-camera DNG corpus is committed, so interoperability with specific camera files is not claimed.

### 35 mm-equivalent focal length and focal-plane resolution (2.25.0)

A file can state its imaging area two ways: through FocalLengthIn35mmFilm with FocalLength (`calculateImagingAreaFromFocalLength35Mm`, docs/PHYSICS_FOUNDATION.md, "Sensor equivalence from a file's 35 mm-equivalent focal length"), or through the focal-plane resolution (image pixels ÷ pixels per millimeter). Prefer the 35 mm route when the file states it.

- The focal-plane resolution refers to the image size the camera recorded. A converter can keep the camera's values while storing an image of another size, so the area computed from the stored size is wrong by that size ratio. On a private test set of converted DNGs (aggregates only; no file is in the repository) the area from the focal-plane route came out 2× too large in each dimension, or about half as large, for some files of a body whose other files gave the sensor's size. Use the focal-plane resolution only with `exif.pixelDimensions` from the same Exif block, and check it against the 35 mm route when both exist.
- FocalLengthIn35mmFilm is a whole number of millimeters, so the crop factor it gives is known only to ±0.5 mm in the 35 mm value (±1.9 % at 27 mm, ±1 % at 50 mm). Exif does not say whether a writer computes it on the diagonal (the engine's convention) or rounds to the nearest millimeter; `calculateImagingAreaFromFocalLength35Mm` states both assumptions and returns the interval.
- With DigitalZoomRatio above 1, a writer may include the digital crop in FocalLengthIn35mmFilm; the derived area is then that of the cropped image, not the sensor's.

## JPEG and HEIF metadata (2.25.0)

From 2.26.0 (#647) `parsePhotoMetadata` also reads PNG files: their IHDR size and their `eXIf` chunk ([PNG eXIf](#png-exif-2260)).

```ts
import { parsePhotoMetadata } from '@photivra/engine';

// `head` holds the file, or its first few hundred kilobytes (the headers come first in both formats).
export function describePhoto(head: Uint8Array) {
  const photo = parsePhotoMetadata({ bytes: head });
  // photo.exif: exposure time, f-number, ISO (as the DNG import resolves it), focal length and its 35 mm equivalent,
  //   digital zoom, CompositeImage, focal-plane resolution, make, model, Software and Orientation, or null without Exif
  // photo.width / photo.height: the primary image's stored size
  // photo.extraImages: the thumbnail, MPF entries, HEIF auxiliary images, thumbnails and tone maps, by type and size
  // photo.annotations: gain-map, depth and embedded-image markers in XMP, ISO 21496-1 gain-map metadata
  return { composite: photo.exif?.compositeImage ?? null, extras: photo.extraImages.map((image) => image.kind) };
}
```

`parsePhotoMetadata` reads only headers; no pixel data is decoded. It returns:

| Field | Meaning |
| --- | --- |
| `format`, `brands` | "jpeg", "heif" or (2.26.0) "png"; for HEIF the ftyp major brand and compatible brands (a file must name one of mif1, mif2, msf1, heic, heix, heim, heis, hevc, hevx, avif or avis). |
| `width`, `height` | The primary image's stored size: the JPEG frame header (SOFn), the primary HEIF item's ispe property (for a grid, the whole image), or the PNG IHDR. Before rotation. |
| `heifRotationDegrees`, `heifMirrorAxis` | The primary HEIF item's irot (anticlockwise, degrees) and imir (0: a vertical axis, 1: a horizontal axis), which a HEIF reader applies for display; `null` when absent and for JPEG. |
| `exif` | The Exif block (JPEG APP1; the HEIF Exif item that describes the primary image; the PNG eXIf chunk): `make`, `model`, `software`, `orientation` (1–8) and the capture fields the DNG import returns as `exif` (above), resolved by the same code. `null` when the file has no Exif block. |
| `xmpNamespaces` | The namespaces the primary image's XMP declares (JPEG APP1 and extended XMP; HEIF XMP items that describe the primary image), sorted. |
| `extraImages` | Each declared extra image: `source`, `kind`, `kindBasis`, the declared `type`, `width`, `height` and stored `bytes`. Sources: the Exif IFD 1 thumbnail; Multi-Picture Format entries after the first (CIPA DC-007 type codes: large thumbnails, panorama, disparity and multi-angle frames; an undefined type whose own XMP declares a gain map is a gain map, `kindBasis` "xmp"); HEIF auxiliary images (auxC), thumbnails (thmb), tone-map items (tmap, ISO 21496-1) and their gain-map inputs, and other image items that are not the primary image or one of its tiles. |
| `annotations` | Markers that declare a rendition or a map: the namespaces in `PHOTO_METADATA_XMP_NAMESPACES` (Adobe gain map, Google depth map and Dynamic Depth depth map, Google embedded image), each item of a Google container directory (its Semantic and Length; "GainMap" is a gain map), and ISO 21496-1 gain-map metadata in a JPEG APP2 segment. `image` is the index of the extra image whose metadata holds the marker, or `null` for the primary image. |
| `assumptions` | Each part that was malformed, truncated or ignored. |

How `kind` is decided (`kindBasis`): "specification" for a code or URN the format's specification defines (MPF type codes; the CICP and HEVC alpha and depth URNs; thmb; tmap and its second input); "name" for words in a maker's auxC URN ("gainmap", "matte", "disparity", "depth", "alpha"), which no registry defines; "xmp" as above; "none" for any other type, returned as stored. The auxiliary images are not decoded, and nothing is said about what a maker's map means beyond its declared type.

Not read: maker notes, the GPS and Interoperability IFDs, XMP values other than the container items' Semantic and Length, ICC profiles, and the image data. Text tags (Make, Model, Software) are returned as stored (ASCII or Exif 3.0's UTF-8 type), at most 4096 bytes.

### PNG eXIf (2.26.0)

A PNG (PNG specification, third edition, W3C 2025) stores Exif in an `eXIf` chunk (§11.3.3.6): the Exif block from its TIFF
header on, without the `Exif\0\0` identifier of a JPEG APP1 segment. `parsePhotoMetadata` walks the chunks by their stated
lengths (§5.3) from the signature to IEND, so IDAT and every other chunk's data are skipped and nothing is decompressed. It
reads:

- the IHDR (§11.2.1, the first chunk): `width` and `height`;
- the first `eXIf`, wherever it lies (before or after IDAT), with the same Exif rules, fields and thumbnail as a JPEG's.

The IHDR's and eXIf's CRC-32s are checked; a mismatch skips that chunk. Reported in `assumptions`, and otherwise skipped:

- a second eXIf (the specification allows one);
- an eXIf that starts with `Exif\0\0` (stepped over, then read);
- an eXIf above 4 MiB (`maximumItemDataBytes`);
- a first chunk that is not IHDR;
- a chunk whose length is above 2^31 − 1 or whose type is not four letters (the walk stops there);
- more than `PHOTO_METADATA_LIMITS.maximumPngChunks` (4096) chunks;
- bytes that end inside a chunk or before IEND (a prefix of the file is accepted).

XMP in a PNG (an iTXt chunk) is not read.

### Untrusted input (photo metadata)

- Every offset, length, count and box size is checked against the bytes before it is read; a part that fails a check is named in `assumptions` and skipped. Only input that is not a JPEG (FF D8 FF), a HEIF file (an ftyp box with a HEIF brand) or a PNG (its 8-byte signature), or a malformed ftyp box, fails with `InvalidConfigurationError`.
- There is no recursion: the box levels (file, meta, iinf, iref, iprp/ipco/ipma, iloc) and the IFDs (IFD 0, the Exif IFD, IFD 1) are fixed, and the IFDs are walked with a visited set.
- `PHOTO_METADATA_LIMITS` bounds every loop: 4096 marker segments per JPEG image, 4096 boxes per level, 4096 HEIF items (and references), 16,384 property associations and 16,384 iloc extents, 1024 entries per IFD, 64 MPF entries and 256 XMP namespaces. At most 4 MiB is copied for one HEIF Exif or XMP item or an extended XMP packet; everything else is read in place.
- XMP is not parsed as XML: namespace declarations and the container items' two properties are matched with bounded patterns.
- A prefix of the file is accepted: what lies beyond it is reported as truncated.

`test/photo-metadata.test.ts` builds JPEG (both Exif byte orders, MPF, extended XMP, ISO 21496-1 APP2) and HEIF (grid primary with tiles, auxiliary images, thumbnail, tone map, Exif and XMP items in mdat and idat, iloc versions 0–2, ipma versions 0 and 1) files from the specifications with `test/helpers/photo-test-writer.ts`; no photo is used. It checks every field, the shared Exif rules against the DNG import, every prefix of a file, named hostile structures (loops, huge counts and sizes, box and item floods) and a fixed-seed mutation fuzz (10,000 mutated or truncated files), in which every outcome is well-formed metadata (finite numbers, valid indices) or an `InvalidConfigurationError`. Interoperability with specific cameras' files is not claimed.

## Writing capture settings into a JPEG's Exif block (2.25.0)

`setJpegExifCaptureSettings(jpeg, settings)` returns the JPEG with its Exif block replaced by one written from an allowlist of capture settings (`JPEG_EXIF_CAPTURE_SETTING_KEYS`; any other key is refused): `exposureTimeSeconds`, `fNumber`, `iso`, `focalLengthMillimeters`, `focalLengthIn35mmFilmMillimeters` (the names of the shared Exif capture fields, so `parsePhotoMetadata` reads the same values back), `exposureBiasEv`, `whiteBalance` (`"auto"` or `"manual"`), `dateTaken` (`{ local: "YYYY-MM-DDTHH:MM:SS[.fff]", offset?: "+HH:MM" }`, written as DateTimeOriginal, SubSecTimeOriginal and OffsetTimeOriginal), `software` and `orientation` (default 1). An omitted or null setting writes no tag.

- Tags written (Exif 2.32): IFD 0 Orientation and Software; Exif ExposureTime (a whole-number reciprocal such as 1/250 exactly as 1/N), FNumber, PhotographicSensitivity, SensitivityType 2 with RecommendedExposureIndex (as the engine's exports write ISO), DateTimeOriginal, OffsetTimeOriginal, SubSecTimeOriginal, ExposureBiasValue, FocalLength, WhiteBalance, FocalLengthIn35mmFilm; and the mandatory tags of a compressed primary image (resolution 72 dpi meaning "unknown", YCbCrPositioning, ExifVersion, FlashpixVersion, ComponentsConfiguration, ColorSpace sRGB, PixelX/YDimension from the frame header).
- Every Exif APP1 segment already in the file is removed, so nothing from an earlier Exif block (make, model, serial numbers, owner, GPS, maker notes, thumbnails) is carried over. The new block goes after SOI (after a leading JFIF segment). Other segments (JFIF, XMP, the ICC profile) and the scan data are kept byte for byte, so the decoded pixels are unchanged; an XMP packet from elsewhere is not filtered.
- `resolveJpegExifCaptureSettings(fields)` turns read Exif fields (`parsePhotoMetadata(...).exif` or a DNG import's `exif`) into settings: exposure time, f-number, ISO, focal length and 35 mm focal length only.
- It works on any baseline or progressive JPEG with a frame header before its first scan, including the engine's own (`simulateCapture` with `output.format: "jpeg"`, `createPrintJpegTask`). It is a separate step, not an option of those encoders, so the capture and display-view bundles do not grow.
- Tests: `test/jpeg-exif-writer.test.ts` (read back with `parsePhotoMetadata` and a separate TIFF reader, identical decoded pixels, idempotence, an earlier Exif block with marker strings that are all absent afterwards, refused settings and every header prefix).

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
- CIPA DC-008 (Exif 2.32 / 3.0), free at <https://www.cipa.jp/e/std/std-sec.html> — CFAPattern; (2.24.0) ExposureTime, FNumber, FocalLength, PhotographicSensitivity, SensitivityType, StandardOutputSensitivity, RecommendedExposureIndex, ISOSpeed, CompositeImage, SourceImageNumberOfCompositeImage, SubjectArea; (2.25.0) FocalLengthIn35mmFilm, DigitalZoomRatio, FocalPlaneX/YResolution and FocalPlaneResolutionUnit, PixelX/YDimension, the APP1 Exif layout, IFD 1 thumbnails and (Exif 3.0) the UTF-8 type; (2.26.0) SubjectDistance and SubjectDistanceRange; the DNG specification above defines CFARepeatPatternDim/CFAPattern use and origin. The TIFF/EP tags are also specified in ISO 12234-2.
- ITU-T Recommendation T.81 (1992), free at <https://www.w3.org/Graphics/JPEG/itu-t81.pdf> (identical text: ISO/IEC 10918-1), Annex H (lossless processes), Annex C and F.2.2.3 (Huffman tables and decoding), F.1.2.3 (restart), A.3.3 and Annex F (sequential DCT decoding, 2.22.0).
- W3C, *Portable Network Graphics (PNG) Specification (Third Edition)*, W3C Recommendation 24 June 2025 — chunks, filters, cICP, mDCV, cLLI, sRGB gAMA/cHRM values.
- IETF RFC 1950 (zlib) and RFC 1951 (DEFLATE).
- ITU-T Recommendation H.273 — colour primaries and transfer characteristics code points.
- ITU-R BT.2020; ITU-T H.265 Annex D (mastering display colour volume and content light level SEI semantics); W3C CSS Color 4 `display-p3` (P3 primaries) — meaning of the signalled values, all free. Also specified in SMPTE ST 2086, CTA-861.3 and SMPTE EG 432-1.

- A. Foi, M. Trimeche, V. Katkovnik, K. Egiazarian, "Practical Poissonian-Gaussian noise modeling and fitting for single-image raw-data", *IEEE Trans. Image Processing* 17(10), 2008 (author copy freely available) — the noise model of the 2.24.0 RAW noise estimate and what-if.
- D. L. Donoho, I. M. Johnstone, "Ideal spatial adaptation by wavelet shrinkage", *Biometrika* 81(3), 1994 — the MAD noise estimate.
- K. Hirakawa, T. W. Parks, "Adaptive homogeneity-directed demosaicing algorithm", *IEEE Trans. Image Processing* 14(3), 2005 — the full-quality demosaic of `developDngImage` (the engine's existing `createAhdDemosaicTask`).

- (2.25.0) CIPA DC-007-2009, *Multi-Picture Format*, free at <https://www.cipa.jp/e/std/std-sec.html> — the APP2 MP header, MP Index IFD, MPEntry layout and type codes.
- (2.25.0) Adobe, *XMP Specification Part 3: Storage in Files* — APP1 XMP and extended XMP in JPEG, and the published XMP namespaces of Adobe's gain map (hdrgm) and Google's depth map, Dynamic Depth, image and container (Android developer documentation).
- (2.25.0) ISO/IEC 14496-12 (ISO base media file format, in ISO's freely available standards) — box structure and the ftyp, meta, hdlr, pitm, iinf/infe, iloc, iref, iprp/ipco/ipma and idat boxes. The ispe, auxC, irot and imir properties, the Exif item's 4-byte TIFF-header offset and the auxiliary URNs are layouts and identifiers assigned in ISO/IEC 23008-12 (HEIF), whose text was not used; the freely published AVIF specification (Alliance for Open Media, v1.2.0) uses the same properties and describes the tone-map derived item (tmap: first input the base image, second the gain map) for ISO 21496-1 gain maps. The JPEG APP2 identifier of ISO 21496-1 gain-map metadata and the hdrgm and container XMP of a JPEG gain map are from the freely published Android Ultra HDR image format (v1.1). ISO 21496-1 itself was not used.

Only factual identifiers (tag numbers, code points, chunk layouts, fixed values) are taken from these standards.
