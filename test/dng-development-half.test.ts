// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDngRawImage, simulateCapture, developDngImage, SIMULATE_CAPTURE_FAST_METHODS, InvalidConfigurationError, InvalidScientificInputError,
  type ImportedDngRaw, type DevelopDngImageOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { writeTiff, packBits, rationalPairs } from "./helpers/dng-test-writer.js";

/*
 * 2.25.0 (#622): the half-size development of an imported DNG for on-screen previews. Engine-written DNGs of synthetic chart
 * scenes give the inputs; no photo is used. The full-size path is checked against digests of the 2.24.0-era output.
 */

const sha = (a: Uint8Array | Uint16Array): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
const decode = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const encode = (v: number): number => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

/**
 * The mean in linear light of a 96 × 64 srgb-16 image's 2 × 2 block under half-size pixel (x, y), component k; null where a code is
 * clipped (0 or 65535), since the half-size paths average before the gamut clip.
 */
function block(full: ArrayLike<number>, x: number, y: number, k: number): number | null {
  let lin = 0;
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const v = full[3 * ((2 * y + dy!) * 96 + 2 * x + dx!) + k]!;
    if (v === 0 || v === 65535) return null;
    lin += decode(v / 65535) / 4;
  }
  return lin;
}

let cached: ImportedDngRaw | undefined;
async function chart(): Promise<ImportedDngRaw> {
  if (cached) return cached;
  const c = await simulateCapture({ scene: { preset: "color-patches" }, sensor: { noiseSeed: 3 }, output: { width: 96, height: 64, format: "dng" } });
  return cached = parseDngRawImage({ bytes: c.image.dng! });
}

/** The full-size outputs of the code before #622 (recorded on 78c5cfbc). */
const FULL: [string, DevelopDngImageOptions, string][] = [
  ["fast srgb-8", {}, "a19312e04e72eb51f44c32e2a141455518a75c6ae6979fe1731565b1b6a20c64"],
  ["exact srgb-16", { fast: false, format: "srgb-16" }, "627fbe59bc38a52b5049dc1df51af2b09743770d01c983b4f95e207c655ac309"],
  ["orientation 6, Standard look", { toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } }, "c61e1a85c3b06ca9fe530d5c3a7fac71c21fded9e9dbcc64e80ec31539c1acb7"]
];

describe("developDngImage size \"half\" (#622)", () => {
  it("leaves the full-size path unchanged byte for byte", async () => {
    const raw = await chart();
    for (const [name, options, digest] of FULL) {
      const input = name.startsWith("orientation") ? { ...raw, orientation: 6 } : raw;
      const full = await developDngImage(input, options), explicit = await developDngImage(input, { ...options, size: "full" });
      expect(sha(full.samples), name).toBe(digest);
      expect(sha(explicit.samples), name).toBe(digest);
      expect(full.size).toBe("full");
    }
  }, scaledTimeout(120_000));

  it("bins each CFA repeat on the fast path: half the size, the full-size image's means, reported as bin-2x2", async () => {
    const raw = await chart();
    const half = await developDngImage(raw, { size: "half", format: "srgb-16" }), full = await developDngImage(raw, { format: "srgb-16" });
    expect(half).toMatchObject({ width: 48, height: 32, size: "half", demosaic: "bin-2x2", fast: { requested: true, defaultedFrom: "format" } });
    expect(half.assumptions.join("\n")).toMatch(/fast\.developDngImage\.size\.half/u);
    // Against the exact half size (the reference): no bias, small differences except at edges, where binning shifts red and
    // blue by half a site (measured on this chart: median about 2.5 × 10⁻³ in linear light; on a uniform patch the noise alone).
    const exact = await developDngImage(raw, { size: "half", format: "srgb-16", fast: false }), d: number[] = [];
    let bias = 0;
    for (let y = 2; y < 30; y++) for (let x = 2; x < 46; x++) for (let k = 0; k < 3; k++) {
      const i = 3 * (y * 48 + x) + k, v = decode(half.samples[i]! / 65535) - decode(exact.samples[i]! / 65535);
      d.push(Math.abs(v)); bias += v;
    }
    d.sort((p, q) => p - q);
    expect(Math.abs(bias / d.length)).toBeLessThan(2e-3);
    expect(d[d.length >> 1]).toBeLessThan(1e-2);
    expect(full.width).toBe(96);
  }, scaledTimeout(120_000));

  it("averages the exact full-size development in linear light with fast: false", async () => {
    const raw = await chart();
    const half = await developDngImage(raw, { size: "half", format: "srgb-16", fast: false }), full = await developDngImage(raw, { format: "srgb-16", fast: false });
    expect(half).toMatchObject({ width: 48, height: 32, size: "half", demosaic: "ahd", fast: { requested: false, defaultedFrom: "request" } });
    expect(half.assumptions.join("\n")).toMatch(/averaged over each 2 × 2 block in linear light/u);
    let max = 0, n = 0;
    for (let y = 1; y < 31; y++) for (let x = 1; x < 47; x++) for (let k = 0; k < 3; k++) {
      const lin = block(full.samples, x, y, k);
      if (lin === null) continue;
      n++;
      max = Math.max(max, Math.abs(half.samples[3 * (y * 48 + x) + k]! - Math.round(65535 * encode(lin))));
    }
    expect(n).toBeGreaterThan(3000);
    expect(max).toBeLessThanOrEqual(2); // the full-size codes are themselves rounded to 16 bits
  }, scaledTimeout(120_000));

  it("maps an odd crop outward, orients and counts clipping on the half grid", async () => {
    const raw = await chart();
    const odd = { ...raw, defaultCrop: { x: 3, y: 1, width: 89, height: 61 } };
    const half = await developDngImage(odd, { size: "half" });
    // x: [⌊3/2⌋, ⌈92/2⌉) = [1, 46); y: [0, 31).
    expect([half.width, half.height]).toEqual([45, 31]);
    const whole = await developDngImage(raw, { size: "half", crop: "active-area" });
    for (let y = 0; y < 31; y++) for (let x = 0; x < 45; x++) for (let k = 0; k < 3; k++) expect(half.samples[3 * (y * 45 + x) + k]).toBe(whole.samples[3 * (y * 48 + x + 1) + k]);
    const rotated = await developDngImage({ ...raw, orientation: 6 }, { size: "half" }), flat = await developDngImage(raw, { size: "half" });
    expect([rotated.width, rotated.height]).toEqual([32, 48]);
    for (const [x, y] of [[0, 0], [7, 3], [47, 31]] as const) for (let k = 0; k < 3; k++) expect(rotated.samples[3 * (x * 32 + (31 - y)) + k]).toBe(flat.samples[3 * (y * 48 + x) + k]);
    const pushed = await developDngImage(raw, { size: "half", exposurePushStops: 8 }), pushedExact = await developDngImage(raw, { size: "half", fast: false, exposurePushStops: 8 });
    expect(pushed.clippedPixelCount).toBe(flat.clippedPixelCount); // the push is after the white-balance clip
    expect(pushedExact.clippedPixelCount).toBeLessThanOrEqual(48 * 32);
  }, scaledTimeout(120_000));

  it("averages a LinearRaw image and refuses what it cannot halve", async () => {
    const raw = await chart();
    // A uniform 16 × 12 LinearRaw file (written here) stays uniform at 8 × 6.
    const codes = Uint16Array.from({ length: 16 * 12 * 3 }, (_, i) => 512 + [4000, 8000, 5000][i % 3]!);
    const linear = parseDngRawImage({ bytes: writeTiff(true, [{
      tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [16] }, { id: 257, type: 4, values: [12] }, { id: 258, type: 3, values: [16, 16, 16] },
        { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [34892] }, { id: 277, type: 3, values: [3] }, { id: 278, type: 4, values: [12] },
        { id: 50706, type: 1, values: [1, 6, 0, 0] }, { id: 50714, type: 4, values: [512, 512, 512] }, { id: 50717, type: 4, values: [16383, 16383, 16383] },
        { id: 50721, type: 10, values: rationalPairs([.8, -.2, -.1, -.3, 1.2, .1, 0, .1, .7]) }, { id: 50728, type: 5, values: rationalPairs([.5, 1, .6]) },
        { id: 50778, type: 3, values: [21] }],
      chunks: { offsetTag: 273, countTag: 279, data: [packBits(codes, 16 * 3, 16, true)] } }]) });
    const a = await developDngImage(linear, { size: "half" }), b = await developDngImage(linear);
    expect(a).toMatchObject({ width: 8, height: 6, demosaic: "bin-2x2" });
    for (let i = 0; i < a.samples.length; i++) expect(a.samples[i]).toBe(b.samples[i % 3]);
    await expect(developDngImage(raw, { size: "quarter" as never })).rejects.toThrow(InvalidConfigurationError);
    await expect(developDngImage({ ...raw, scale: 0.5 }, { size: "half" })).rejects.toThrow(InvalidConfigurationError);
    await expect(developDngImage({ ...raw, cfa: { ...raw.cfa!, pattern: [0, 0, 1, 2] } }, { size: "half" })).rejects.toThrow(InvalidScientificInputError);
  }, scaledTimeout(120_000));

  it("is registered as a fast-and-exact choice", () => {
    expect(SIMULATE_CAPTURE_FAST_METHODS.find((e) => e.id === "developDngImage/size.half")).toMatchObject({ methods: "fast-and-exact", runs: ["developDngImage"], report: { field: "demosaic" } });
  });
});
