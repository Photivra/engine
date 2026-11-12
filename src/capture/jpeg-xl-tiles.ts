// SPDX-License-Identifier: Apache-2.0

/**
 * #598: JPEG XL (DNG Compression 52546, DNG 1.7.0.0) strips and tiles. The engine has no JPEG XL decoder and no runtime
 * dependency: the caller passes one (`importDngRawImage`'s `jpegXlDecoder`), which returns each tile as a PNG. The owner chose the
 * prebuilt jxl-oxide WebAssembly package (npm `jxl-oxide-wasm`, MIT OR Apache-2.0); `createJxlOxideDngDecoder` adapts it without
 * importing it, so the decoder is loaded only by an application that opens such a file (THIRD_PARTY.md, "JPEG XL").
 *
 * The PNG is read here (W3C PNG Specification, 3rd edition: IHDR, IDAT, IEND; zlib per RFC 1950/1951 through the platform's
 * `DecompressionStream("deflate")`; the five filter types of §9). It must be grey or RGB with no alpha, the tile's size, and 16-bit
 * for a tile of more than 8 bits. jxl-oxide writes a sample of bit depth b at 16 bits as round(v·65535/(2^b − 1)), so the stored
 * value is recovered exactly as round(p·(2^b − 1)/65535) (each step of 65535/(2^b − 1) ≥ 1 maps to a distinct value; measured
 * bit-exact for 8-, 12- and 16-bit lossless tiles in test/dng-import-phone.test.ts).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** Decodes one JPEG XL codestream (a DNG strip or tile) to PNG bytes in the codestream's own colour encoding (no colour conversion). */
export type DngJpegXlDecoder = (codestream: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The part of the jxl-oxide-wasm module the adapter uses (its `JxlImage` class, after the module's `init`). */
export interface JxlOxideModule {
  JxlImage: new () => { feedBytes(bytes: Uint8Array): unknown; tryInit(): boolean; render(): { encodeToPng(): Uint8Array }; forceSrgb: boolean; free(): void };
}

/**
 * A {@link DngJpegXlDecoder} over jxl-oxide-wasm: `forceSrgb` off (the samples stay in the codestream's encoding), one render per
 * tile, and the image object freed after it. Usage: `import init, * as jxl from "jxl-oxide-wasm"; await init();
 * createJxlOxideDngDecoder(jxl)`.
 */
export function createJxlOxideDngDecoder(module: JxlOxideModule): DngJpegXlDecoder {
  if (module === null || typeof module !== "object" || typeof module.JxlImage !== "function") throw new InvalidConfigurationError("createJxlOxideDngDecoder: module must be the initialized jxl-oxide-wasm module.");
  return (codestream) => {
    const image = new module.JxlImage();
    try {
      image.forceSrgb = false;
      image.feedBytes(codestream);
      if (!image.tryInit()) throw new InvalidConfigurationError("DNG import: the JPEG XL tile is truncated.");
      // encodeToPng takes the render result by value (it is freed by the call; a later free() fails).
      return image.render().encodeToPng();
    } finally { image.free(); }
  };
}

function fail(message: string): never { throw new InvalidConfigurationError("DNG import: " + message); }

/** @internal The decoded tile's samples at the DNG's bit depth, interleaved (pixel, channel). */
export async function readJpegXlTilePng(png: Uint8Array, width: number, height: number, channels: number, bits: number): Promise<Uint16Array> {
  if (!(png instanceof Uint8Array) || png.length < 33 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) fail("the JPEG XL decoder did not return a PNG.");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8, depth = 0, colorType = -1, w = 0, h = 0, idatBytes = 0;
  const idat: Uint8Array[] = [];
  while (p + 12 <= png.length) {
    const length = view.getUint32(p), type = String.fromCharCode(png[p + 4]!, png[p + 5]!, png[p + 6]!, png[p + 7]!);
    if (p + 12 + length > png.length) fail("the decoded PNG is truncated.");
    if (type === "IHDR") {
      w = view.getUint32(p + 8); h = view.getUint32(p + 12); depth = png[p + 16]!; colorType = png[p + 17]!;
      if (png[p + 20] !== 0) fail("the decoded PNG is interlaced.");
    } else if (type === "IDAT") { idat.push(png.subarray(p + 8, p + 8 + length)); idatBytes += length; }
    else if (type === "IEND") break;
    p += 12 + length;
  }
  const pngChannels = colorType === 0 ? 1 : colorType === 2 ? 3 : 0;
  if (!pngChannels) fail("the decoded JPEG XL tile has an alpha or palette channel; DNG tiles are grey or RGB.");
  if (w !== width || h !== height || pngChannels !== channels) fail("the decoded JPEG XL tile does not match the strip or tile size and SamplesPerPixel.");
  if (depth !== 16 && !(depth === 8 && bits === 8)) fail("the JPEG XL decoder returned " + depth + "-bit samples for a " + bits + "-bit tile.");
  const joined = new Uint8Array(idatBytes);
  let at = 0; for (const part of idat) { joined.set(part, at); at += part.length; }
  const bpp = channels * depth / 8, stride = 1 + width * bpp, expected = stride * height;
  const raw = await inflate(joined, expected);
  const out = new Uint16Array(width * height * channels), scale = (2 ** bits - 1) / 65535;
  let previous = new Uint8Array(stride - 1), row = new Uint8Array(stride - 1);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride]!;
    row.set(raw.subarray(y * stride + 1, (y + 1) * stride));
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0, b = previous[i]!, c = i >= bpp ? previous[i - bpp]! : 0;
      let predictor = 0;
      switch (filter) {
        case 0: break;
        case 1: predictor = a; break;
        case 2: predictor = b; break;
        case 3: predictor = (a + b) >> 1; break;
        case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
        default: fail("the decoded PNG has an invalid filter type.");
      }
      row[i] = (row[i]! + predictor) & 255;
    }
    const o = y * width * channels;
    if (depth === 8) for (let i = 0; i < width * channels; i++) out[o + i] = row[i]!;
    else for (let i = 0; i < width * channels; i++) {
      const v = (row[2 * i]! << 8) | row[2 * i + 1]!;
      out[o + i] = bits === 16 ? v : Math.round(v * scale);
    }
    [previous, row] = [row, previous];
  }
  return out;
}

/** zlib inflate through the platform's DecompressionStream; the output length must be exactly `expected`. */
async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") fail("this platform has no DecompressionStream.");
  const out = new Uint8Array(expected);
  let at = 0;
  try {
    const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > expected) { await reader.cancel(); fail("the decoded PNG holds more data than its size."); }
      out.set(value, at); at += value.length;
    }
  } catch (error) {
    if (error instanceof InvalidConfigurationError) throw error;
    fail("the decoded PNG's image data is corrupt.");
  }
  if (at !== expected) fail("the decoded PNG holds less data than its size.");
  return out;
}
