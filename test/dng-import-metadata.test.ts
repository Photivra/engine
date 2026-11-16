// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseDngRawImage, simulateCapture, DNG_IMPORT_SCHEMA_VERSION, type ImportedDngRaw } from "../src/index.js";
import { writeTiff, packBits, type IfdSpec, type TagSpec } from "./helpers/dng-test-writer.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.25.0 (#618): Software, DigitalZoomRatio, FocalLengthIn35mmFilm, the focal-plane resolution and the enhanced-image IFD
 * (NewSubFileType 16) with EnhanceParams. Synthetic DNGs built here; no photo is used.
 */

const RATIONAL = 5;
const ascii = (s: string): number[] => [...new TextEncoder().encode(s), 0];
const width = 16, height = 12;
function rawIfd(extra: TagSpec[] = []): IfdSpec {
  const codes = Uint16Array.from({ length: width * height }, (_, i) => 1000 + (i * 37) % 500);
  return {
    tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] }, { id: 258, type: 3, values: [16] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [32803] }, { id: 277, type: 3, values: [1] }, { id: 278, type: 4, values: [height] },
      { id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }, { id: 50714, type: 4, values: [512] }, { id: 50717, type: 4, values: [16383] }, ...extra],
    chunks: { offsetTag: 273, countTag: 279, data: [packBits(codes, width, 16, true)] }
  };
}
/** IFD 0 is a small preview; the raw image and the enhanced image are SubIFDs. */
function dng(options: { main?: TagSpec[]; exif?: TagSpec[]; enhanced?: TagSpec[][] } = {}): Uint8Array {
  const enhanced = (options.enhanced ?? []).map((tags): IfdSpec => ({
    tags: ([{ id: 254, type: 4, values: [16] }, { id: 256, type: 4, values: [width * 2] }, { id: 257, type: 4, values: [height * 2] }, { id: 258, type: 3, values: [16, 16, 16] },
      { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [34892] }, { id: 277, type: 3, values: [3] }] as TagSpec[]).filter((d) => !tags.some((t) => t.id === d.id)).concat(tags)
  }));
  return writeTiff(true, [{
    tags: [{ id: 254, type: 4, values: [1] }, { id: 256, type: 4, values: [4] }, { id: 257, type: 4, values: [3] }, { id: 262, type: 3, values: [2] },
      { id: 271, type: 2, values: ascii("Synthetic") }, { id: 50706, type: 1, values: [1, 7, 1, 0] }, ...(options.main ?? [])],
    subIfds: [rawIfd(), ...enhanced],
    ...(options.exif ? { exifIfd: { tags: options.exif } } : {})
  }]);
}

describe("DNG import: Software, 35 mm focal length, digital zoom, focal-plane resolution and enhanced images (2.25.0, #618)", () => {
  it("returns them as typed values", () => {
    const raw = parseDngRawImage({ bytes: dng({
      main: [{ id: 305, type: 2, values: ascii("Converter 4.5") }],
      exif: [{ id: 37386, type: RATIONAL, values: [35, 1] }, { id: 41989, type: 3, values: [53] }, { id: 41988, type: RATIONAL, values: [3, 2] },
        { id: 41486, type: RATIONAL, values: [6000, 23.5] }, { id: 41487, type: RATIONAL, values: [4000, 15.6] }, { id: 41488, type: 3, values: [4] },
        { id: 40962, type: 4, values: [6000] }, { id: 40963, type: 4, values: [4000] }],
      enhanced: [[{ id: 51182, type: 2, values: ascii("denoise=1;scale=2") }]]
    }) });
    expect(raw.schemaVersion).toBe("1.3.0");
    expect(DNG_IMPORT_SCHEMA_VERSION).toBe("1.3.0");
    expect(raw.software).toBe("Converter 4.5");
    expect(raw.exif).toMatchObject({ focalLengthMillimeters: 35, focalLengthIn35mmFilmMillimeters: 53, digitalZoomRatio: 1.5, focalPlaneResolution: null,
      pixelDimensions: { width: 6000, height: 4000 } });
    // FocalPlaneResolutionUnit 4 is not an Exif 2.32 code: the resolution is reported and ignored.
    expect(raw.assumptions.join("\n")).toMatch(/FocalPlaneResolutionUnit 4/u);
    expect(raw.enhancedImages).toEqual([{ width: 32, height: 24, samplesPerPixel: 3, bitsPerSample: 16, photometricInterpretation: 34892, compression: 1, enhanceParams: "denoise=1;scale=2" }]);
    expect(raw.assumptions.join("\n")).toMatch(/enhanced-image IFD \(NewSubFileType 16\) is present and not decoded \(enhancedImages\)/u);
    expect(raw.width).toBe(width);
  });

  it("reads the focal-plane resolution in inches (the default) and centimeters, and leaves absent values null", () => {
    const inch = parseDngRawImage({ bytes: dng({ exif: [{ id: 41486, type: RATIONAL, values: [254, 1] }, { id: 41487, type: RATIONAL, values: [508, 1] }] }) });
    expect(inch.exif.focalPlaneResolution).toEqual({ x: 254, y: 508, unit: "inch", unitStated: false, pixelsPerMillimeterX: 10, pixelsPerMillimeterY: 20 });
    const cm = parseDngRawImage({ bytes: dng({ main: [{ id: 41486, type: RATIONAL, values: [100, 1] }, { id: 41487, type: RATIONAL, values: [100, 1] }, { id: 41488, type: 3, values: [3] }] }) });
    expect(cm.exif.focalPlaneResolution).toMatchObject({ unit: "centimeter", unitStated: true, pixelsPerMillimeterX: 10 });
    const none: ImportedDngRaw = parseDngRawImage({ bytes: dng() });
    expect(none).toMatchObject({ software: null, enhancedImages: [] });
    expect(none.exif).toMatchObject({ focalLengthIn35mmFilmMillimeters: null, digitalZoomRatio: null, focalPlaneResolution: null, pixelDimensions: null });
  });

  it("reports malformed values without failing, and reads several enhanced images", () => {
    const raw = parseDngRawImage({ bytes: dng({
      main: [{ id: 305, type: 3, values: [1] }],
      exif: [{ id: 41989, type: 5, values: [50, 1] }, { id: 41988, type: RATIONAL, values: [1, 0] }],
      enhanced: [[{ id: 51182, type: 3, values: [7] }], [{ id: 259, type: 3, values: [52546] }]]
    }) });
    expect(raw.software).toBeNull();
    expect(raw.exif).toMatchObject({ focalLengthIn35mmFilmMillimeters: null, digitalZoomRatio: null });
    expect(raw.enhancedImages.map((e) => [e.enhanceParams, e.compression])).toEqual([[null, 1], [null, 52546]]);
    const notes = raw.assumptions.join("\n");
    for (const pattern of [/Software is malformed/u, /FocalLengthIn35mmFilm is malformed/u, /DigitalZoomRatio is malformed/u, /EnhanceParams is malformed/u]) expect(notes).toMatch(pattern);
    const bad = parseDngRawImage({ bytes: dng({ enhanced: [[{ id: 256, type: 12, values: [1] }]] }) });
    expect(bad.enhancedImages).toEqual([]);
    expect(bad.assumptions.join("\n")).toMatch(/enhanced-image IFD is malformed/u);
  });

  it("keeps the engine's own DNG export's fields", async () => {
    const capture = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.18 }, illuminanceLux: 500, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 },
      output: { width: 32, height: 32, format: "dng" } });
    const raw = parseDngRawImage({ bytes: capture.image.dng! });
    expect(raw.enhancedImages).toEqual([]);
    expect(raw.exif.focalLengthMillimeters).toBe(50);
    expect(typeof raw.software === "string" || raw.software === null).toBe(true);
  }, scaledTimeout(30_000));
});
