// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseLossyJpeg } from "../src/capture/lossy-jpeg.js";
import { encodeExportJpeg } from "../src/capture/export-jpeg.js";
import { InvalidConfigurationError } from "../src/index.js";
import { encodeBaselineJpeg } from "./helpers/phone-dng-fixtures.js";

function smooth(width: number, height: number, nf: number, seed = 1): Uint8Array {
  const out = new Uint8Array(width * height * nf);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < nf; c++)
    out[(y * width + x) * nf + c] = Math.round(128 + 90 * Math.sin((x + 3 * c + seed) / 7) * Math.cos((y - 2 * c) / 9));
  return out;
}
const maxError = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

describe("lossy (sequential DCT) JPEG decoder (#598)", () => {
  it("decodes grey and three-component baseline streams within one code at quantization step 1", () => {
    for (const [width, height] of [[8, 8], [37, 21], [64, 3]] as const) {
      const grey = smooth(width, height, 1);
      const g = parseLossyJpeg(encodeBaselineJpeg({ width, height, components: [{ id: 1, h: 1, v: 1 }], samples: grey, step: 1 }).jpeg, { maximumSamples: width * height });
      expect(g).toMatchObject({ width, height, components: 1, colorTransform: "none" });
      expect(maxError(g.samples, grey)).toBeLessThanOrEqual(1);
      const rgb = smooth(width, height, 3);
      // Component identifiers R, G, B and no JFIF/Adobe segment: stored as RGB (T.872 convention).
      const r = parseLossyJpeg(encodeBaselineJpeg({ width, height, components: [0x52, 0x47, 0x42].map((id) => ({ id, h: 1, v: 1 })), samples: rgb, step: 1, restartInterval: 2 }).jpeg, { maximumSamples: width * height * 3 });
      expect(r.colorTransform).toBe("none");
      expect(maxError(r.samples, rgb)).toBeLessThanOrEqual(1);
    }
  });

  it("reads the engine's own 4:4:4 YCbCr export with its JFIF segment and converts it to RGB", () => {
    const width = 24, height = 16, rgb = smooth(width, height, 3, 5);
    const jpeg = encodeExportJpeg({ width, height, samples: Array.from(rgb), quantizationStep: 1, exif: new Uint8Array(0), xmp: new Uint8Array(0) });
    const d = parseLossyJpeg(jpeg, { maximumSamples: width * height * 3 });
    expect(d.colorTransform).toBe("ycbcr-to-rgb");
    expect(maxError(d.samples, rgb)).toBeLessThanOrEqual(3);
  });

  it("upsamples subsampled components, reads separate tables, restarts and non-interleaved scans", () => {
    const width = 40, height = 26, flat = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) { flat[i * 3] = 100 + (i % width); flat[i * 3 + 1] = 120; flat[i * 3 + 2] = 140; }
    const adobeRgb = [0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0];
    for (const scanPerComponent of [false, true]) {
      const { jpeg, tables } = encodeBaselineJpeg({ width, height, components: [{ id: 1, h: 2, v: 2 }, { id: 2, h: 1, v: 1 }, { id: 3, h: 1, v: 2 }], samples: flat, step: 1,
        restartInterval: 3, separateTables: true, scanPerComponent, app: [adobeRgb] });
      expect(() => parseLossyJpeg(jpeg, { maximumSamples: 1e6 })).toThrow(InvalidConfigurationError);
      const d = parseLossyJpeg(jpeg, { maximumSamples: 1e6, tables: tables! });
      expect(d.colorTransform).toBe("none");
      // Constant chroma survives subsampling; the full-resolution component keeps its ramp.
      for (let i = 0; i < width * height; i++) { expect(Math.abs(d.samples[i * 3 + 1]! - 120)).toBeLessThanOrEqual(1); expect(Math.abs(d.samples[i * 3 + 2]! - 140)).toBeLessThanOrEqual(1); }
      expect(maxError(d.samples.filter((_, i) => i % 3 === 0), flat.filter((_, i) => i % 3 === 0))).toBeLessThanOrEqual(1);
    }
  });

  it("refuses other processes, oversize frames and corrupt streams", () => {
    const { jpeg } = encodeBaselineJpeg({ width: 16, height: 16, components: [{ id: 1, h: 1, v: 1 }], samples: smooth(16, 16, 1), step: 2 });
    expect(() => parseLossyJpeg(jpeg, { maximumSamples: 255 })).toThrow(/sample limit/u);
    const sof = jpeg.indexOf(0xc0, 2);
    const progressive = jpeg.slice(); progressive[sof] = 0xc2;
    expect(() => parseLossyJpeg(progressive, { maximumSamples: 1e4 })).toThrow(/sequential/u);
    const twelve = jpeg.slice(); twelve[sof + 3] = 12;
    expect(() => parseLossyJpeg(twelve, { maximumSamples: 1e4 })).toThrow(/8-bit/u);
    // Fixed-seed mutation fuzz: every outcome is an image or a domain error.
    let state = 7;
    const next = (): number => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state / 2 ** 32; };
    for (let k = 0; k < 400; k++) {
      const m = jpeg.slice(0, k % 5 === 0 ? Math.floor(next() * jpeg.length) : jpeg.length);
      for (let j = 0; j < 3; j++) m[Math.floor(next() * m.length)] = Math.floor(next() * 256);
      try { parseLossyJpeg(m, { maximumSamples: 1e5 }); } catch (e) { expect(e).toBeInstanceOf(InvalidConfigurationError); }
    }
  });
});
