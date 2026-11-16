// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, JPEG_EXIF_CAPTURE_SETTING_KEYS, resolveJpegExifCaptureSettings, parseLossyJpeg, parsePhotoMetadata, setJpegExifCaptureSettings,
  simulateCapture, type JpegExifCaptureSettings } from "../src/index.js";
import { exportTiffAscii, exportTiffBytes, exportTiffNumbers, packExportJpegExif } from "../src/capture/export-tiff.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** The JPEG's segments before the first scan: marker and payload. */
function segments(jpeg: Uint8Array): { marker: number; payload: Uint8Array }[] {
  const out: { marker: number; payload: Uint8Array }[] = [];
  for (let o = 2; ;) {
    const marker = jpeg[o+1]!, length = jpeg[o+2]! << 8 | jpeg[o+3]!;
    if (marker === 0xda) return out;
    out.push({ marker, payload: jpeg.subarray(o+4, o+2+length) });
    o += 2+length;
  }
}
/** A minimal little-endian TIFF reader of the Exif APP1 block: tag id → [type, values or text]. */
function exifTags(jpeg: Uint8Array): Map<number, number[] | string> {
  const app1 = segments(jpeg).filter((s) => s.marker === 0xe1 && new TextDecoder().decode(s.payload.subarray(0, 4)) === "Exif");
  expect(app1).toHaveLength(1);
  const t = app1[0]!.payload.subarray(6), v = new DataView(t.buffer, t.byteOffset, t.byteLength), tags = new Map<number, number[] | string>();
  expect(v.getUint16(0, true)).toBe(0x4949);
  const read = (ifd: number): void => {
    const n = v.getUint16(ifd, true);
    for (let i = 0; i < n; i++) {
      const e = ifd+2+i*12, id = v.getUint16(e, true), type = v.getUint16(e+2, true), count = v.getUint32(e+4, true);
      const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type]!*count, at = size <= 4 ? e+8 : v.getUint32(e+8, true);
      if (type === 2) tags.set(id, new TextDecoder().decode(t.subarray(at, at+count-1)));
      else if (type === 5 || type === 10) tags.set(id, Array.from({ length: count }, (_, k) => type === 5 ? v.getUint32(at+8*k, true)/v.getUint32(at+8*k+4, true) : v.getInt32(at+8*k, true)/v.getUint32(at+8*k+4, true)));
      else if (type === 3) tags.set(id, Array.from({ length: count }, (_, k) => v.getUint16(at+2*k, true)));
      else if (type === 4) tags.set(id, Array.from({ length: count }, (_, k) => v.getUint32(at+4*k, true)));
      else tags.set(id, Array.from(t.subarray(at, at+count)));
      if (id === 34665) read(v.getUint32(e+8, true));
    }
  };
  read(v.getUint32(4, true));
  return tags;
}
const has = (bytes: Uint8Array, text: string): boolean => new TextDecoder("latin1").decode(bytes).includes(text);

const SETTINGS: JpegExifCaptureSettings = { exposureTimeSeconds: 1/250, fNumber: 5.6, iso: 400, focalLengthMillimeters: 23.5, focalLengthIn35mmFilmMillimeters: 35,
  exposureBiasEv: -1/3, whiteBalance: "manual", dateTaken: { local: "2026-11-15T10:30:05.250", offset: "+01:00" }, software: "Photivra test" };

async function engineJpeg(): Promise<Uint8Array> {
  const r = await simulateCapture({ scene: { preset: "color-patches" }, sensor: { spectralStepNanometers: 100 }, output: { width: 24, height: 16, format: "jpeg" } });
  return r.image.jpeg!;
}

describe("setJpegExifCaptureSettings (#621)", () => {
  it("writes the allowlisted capture settings into an engine JPEG, reads them back, and keeps the image data", async () => {
    const jpeg = await engineJpeg(), out = setJpegExifCaptureSettings(jpeg, SETTINGS);
    const meta = parsePhotoMetadata({ bytes: out });
    expect(meta.width).toBe(24);
    expect(meta.exif).toMatchObject({ exposureTimeSeconds: 1/250, fNumber: 5.6, iso: 400, isoSource: "recommended-exposure-index", photographicSensitivity: 400, sensitivityType: 2,
      recommendedExposureIndex: 400, focalLengthMillimeters: 23.5, focalLengthIn35mmFilmMillimeters: 35, software: "Photivra test", orientation: 1, make: null, model: null,
      pixelDimensions: { width: 24, height: 16 } });
    const tags = exifTags(out);
    expect(tags.get(33434)).toEqual([1/250]);
    expect(tags.get(37380)).toEqual([-1/3]);
    expect(tags.get(41987)).toEqual([1]);
    expect(tags.get(36867)).toBe("2026:11:15 10:30:05");
    expect(tags.get(37521)).toBe("250");
    expect(tags.get(36881)).toBe("+01:00");
    expect(tags.get(40961)).toEqual([1]);
    // Only the allowlist and the mandatory tags of a compressed primary image.
    expect([...tags.keys()].sort((a, b) => a-b)).toEqual([274, 282, 283, 296, 305, 531, 33434, 33437, 34665, 34855, 34864, 34866, 36864, 36867, 36881, 37121, 37380, 37386,
      37521, 40960, 40961, 40962, 40963, 41987, 41989]);
    // The old Exif block (its Software) is gone; the XMP and ICC segments and the scan are unchanged.
    expect(has(jpeg, "Photivra Print JPEG") && !has(out, "Photivra Print JPEG")).toBe(true);
    const others = (b: Uint8Array): string[] => segments(b).filter((s) => !(s.marker === 0xe1 && has(s.payload.subarray(0, 4), "Exif"))).map((s) => s.marker+":"+Array.from(s.payload).join(","));
    expect(others(out)).toEqual(others(jpeg));
    expect(segments(out)[0]!.marker).toBe(0xe0);
    expect(segments(out)[1]!.marker).toBe(0xe1);
    expect(parseLossyJpeg(out, { maximumSamples: 1e6 }).samples).toEqual(parseLossyJpeg(jpeg, { maximumSamples: 1e6 }).samples);
    // Writing again gives the same bytes; empty settings keep only the mandatory tags.
    expect(setJpegExifCaptureSettings(out, SETTINGS)).toEqual(out);
    expect([...exifTags(setJpegExifCaptureSettings(out, {})).keys()].sort((a, b) => a-b)).toEqual([274, 282, 283, 296, 531, 34665, 36864, 37121, 40960, 40961, 40962, 40963]);
  }, scaledTimeout(120_000));

  it("drops personal data from an earlier Exif block and takes settings from read Exif fields", async () => {
    const jpeg = await engineJpeg(), w = 24, h = 16;
    const hostile = packExportJpegExif([exportTiffAscii(271, "MAKE-MARKER"), exportTiffAscii(272, "MODEL-MARKER"), exportTiffAscii(315, "ARTIST-MARKER")],
      [exportTiffNumbers(40961, 3, [1]), exportTiffAscii(42033, "SERIAL-MARKER"), exportTiffAscii(42032, "OWNER-MARKER"), exportTiffBytes(37500, 7, new TextEncoder().encode("MAKERNOTE-MARKER")),
        exportTiffNumbers(34855, 3, [800])], { pixelWidth: w, pixelHeight: h });
    const app1 = Uint8Array.from([0xff, 0xe1, (hostile.length+8) >> 8, (hostile.length+8) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...hostile]);
    // Two Exif segments (one after the JFIF segment, one later): both are replaced.
    const seg = segments(jpeg), jfifEnd = 2+4+seg[0]!.payload.length;
    const doubled = Uint8Array.from([...jpeg.subarray(0, jfifEnd), ...app1, ...jpeg.subarray(jfifEnd, jfifEnd+4+seg[1]!.payload.length), ...app1, ...jpeg.subarray(jfifEnd+4+seg[1]!.payload.length)]);
    const read = parsePhotoMetadata({ bytes: doubled }).exif!;
    expect(read.make).toBe("MAKE-MARKER");
    const out = setJpegExifCaptureSettings(doubled, resolveJpegExifCaptureSettings(read));
    for (const marker of ["MAKE-MARKER", "MODEL-MARKER", "ARTIST-MARKER", "SERIAL-MARKER", "OWNER-MARKER", "MAKERNOTE-MARKER", "Photivra Print JPEG"]) expect(has(out, marker)).toBe(false);
    expect(parsePhotoMetadata({ bytes: out }).exif).toMatchObject({ photographicSensitivity: 800, iso: 800, make: null, exposureTimeSeconds: null });
    expect(resolveJpegExifCaptureSettings({ exposureTimeSeconds: 2.5, fNumber: null, iso: 100.5, focalLengthMillimeters: 50, focalLengthIn35mmFilmMillimeters: 0 }))
      .toEqual({ exposureTimeSeconds: 2.5, fNumber: null, iso: null, focalLengthMillimeters: 50, focalLengthIn35mmFilmMillimeters: null });
    const other = exifTags(setJpegExifCaptureSettings(jpeg, { exposureTimeSeconds: 2.5, exposureBiasEv: 0.7, orientation: 6 }));
    expect([other.get(33434), other.get(37380), other.get(274)]).toEqual([[2.5], [0.7], [6]]);
  }, scaledTimeout(120_000));

  it("refuses settings outside the allowlist or their ranges, and bytes that are not a JPEG", async () => {
    const jpeg = await engineJpeg();
    expect(JPEG_EXIF_CAPTURE_SETTING_KEYS).toContain("dateTaken");
    const bad: unknown[] = [null, { make: "X" }, { gpsLatitude: 1 }, { exposureTimeSeconds: 0 }, { fNumber: -1 }, { fNumber: Number.NaN }, { iso: 100.5 }, { iso: 0 },
      { focalLengthIn35mmFilmMillimeters: 70000 }, { exposureBiasEv: 65 }, { whiteBalance: "daylight" }, { software: "é" }, { software: "x".repeat(256) }, { orientation: 9 },
      { dateTaken: { local: "2026-02-29T10:00:00" } }, { dateTaken: { local: "2026-11-15 10:00:00" } }, { dateTaken: { local: "2026-11-15T24:00:00" } },
      { dateTaken: { local: "2026-11-15T10:00:00", offset: "+15:00" } }, { dateTaken: { local: "2026-11-15T10:00:00", zone: "UTC" } }];
    for (const settings of bad) expect(() => setJpegExifCaptureSettings(jpeg, settings as JpegExifCaptureSettings)).toThrow(InvalidConfigurationError);
    expect(() => setJpegExifCaptureSettings(jpeg, { dateTaken: { local: "2024-02-29T23:59:59" } })).not.toThrow();
    for (const bytes of [new Uint8Array(), Uint8Array.of(0xff, 0xd8), Uint8Array.of(0x89, 0x50, 0x4e, 0x47), jpeg.subarray(0, 40), Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2), "jpeg"]) {
      expect(() => setJpegExifCaptureSettings(bytes as Uint8Array, {})).toThrow(InvalidConfigurationError);
    }
    // Every prefix of the headers fails cleanly.
    const scan = jpeg.findIndex((b, i) => b === 0xff && jpeg[i+1] === 0xda);
    for (let n = 0; n < scan; n++) expect(() => setJpegExifCaptureSettings(jpeg.subarray(0, n), {})).toThrow(InvalidConfigurationError);
    expect(() => resolveJpegExifCaptureSettings(null as never)).toThrow(InvalidConfigurationError);
  }, scaledTimeout(120_000));
});
