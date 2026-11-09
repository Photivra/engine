// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { simulateCaptureFromParts, simulateCapture, type SimulateCaptureDngPart, type SimulateCaptureOptions, type SimulateCaptureProgress,
  type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { applyUnsharpMask, correctDiffractionInPlace, designDiffractionCorrectionFilter, drainDetailRows, unsharpMaskKernel } from "../src/processing/development-detail.js";

/**
 * Splits an output frame into a grid of regions and renders each as its own call, as the app's worker pool does: the region
 * request is the whole request with `output.region`, without the whole-image detail stages, `output.dng` and auto white balance.
 */
async function partsOf(options: SimulateCaptureOptions, columns: number, rows: number): Promise<SimulateCaptureDngPart[]> {
  const width = options.output!.width!, height = options.output!.height!;
  const edge = (i: number, count: number, length: number): number => (i === count ? length : 2 * Math.round((i * length) / count / 2));
  const parts: SimulateCaptureDngPart[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = edge(c, columns, width), y = edge(r, rows, height);
    const region = { x, y, width: edge(c + 1, columns, width) - x, height: edge(r + 1, rows, height) - y };
    const output = { ...options.output!, format: "srgb-8" as const, region };
    delete output.dng; delete output.sharpening; delete output.diffractionCorrection;
    delete output.colorEncoding; delete output.gamutMapping; delete output.bitDepth;
    if (output.whiteBalance === "auto") output.whiteBalance = "scene-illuminant";
    const result = await simulateCapture({ ...options, output });
    parts.push({ raw: result.raw, region: result.region! });
  }
  return parts;
}

function expectSameCapture(joined: SimulateCaptureResult, whole: SimulateCaptureResult, label: string): void {
  expect(joined.image.width, label).toBe(whole.image.width);
  expect(Buffer.from(joined.image.samples.buffer, joined.image.samples.byteOffset, joined.image.samples.byteLength)
    .equals(Buffer.from(whole.image.samples.buffer, whole.image.samples.byteOffset, whole.image.samples.byteLength)), label + " samples").toBe(true);
  for (const file of ["jpeg", "png", "dng"] as const) {
    expect(joined.image[file] === undefined, label + " " + file).toBe(whole.image[file] === undefined);
    if (whole.image[file]) expect(Buffer.from(joined.image[file]!).equals(Buffer.from(whole.image[file]!)), label + " " + file).toBe(true);
  }
  expect(Buffer.from(joined.raw.codes.buffer).equals(Buffer.from(whole.raw.codes.buffer)), label + " raw").toBe(true);
  expect(joined.diagnostics.detail, label).toEqual(whole.diagnostics.detail);
  expect(joined.diagnostics.rendering, label).toEqual(whole.diagnostics.rendering);
  expect(joined.diagnostics.highlight, label).toEqual(whole.diagnostics.highlight);
  expect(joined.diagnostics.options, label).toEqual(whole.diagnostics.options);
  expect(joined.diagnostics.providerEvaluationCount).toBe(0);
  expect(joined.assumptions.find((a) => a.id === "parts")?.value).toEqual({ partCount: expect.any(Number) as number });
}

describe("developing joined parts (#571)", () => {
  it("equals the whole-frame capture bit for bit: sharpening and diffraction correction on every development path", async () => {
    for (const options of [
      { scene: { preset: "slanted-edge" }, lens: { fNumber: 16, diffraction: "circular-aperture" },
        output: { width: 40, height: 28, format: "jpeg", diffractionCorrection: {}, sharpening: { radiusPixels: 1, amount: 0.5 } } },
      { scene: { preset: "siemens-star" }, output: { width: 36, height: 26, format: "srgb-16", sharpening: { radiusPixels: 2.3, amount: 1.5, threshold: 0.02 } } },
      { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { antiAliasing: { kind: "four-spot" } },
        output: { width: 40, height: 28, format: "srgb-8", demosaic: "ahd", whiteBalance: "auto", exposureCompensationStops: 1, diffractionCorrection: { kernelRadiusPixels: 6 }, sharpening: {} } },
      { scene: { preset: "dead-leaves" }, lens: { fNumber: 16, diffraction: "circular-aperture" },
        output: { width: 32, height: 24, format: "png", colorEncoding: "display-p3", diffractionCorrection: {} } },
      { scene: { preset: "slanted-edge" }, lens: { fNumber: 16, diffraction: "circular-aperture" },
        output: { width: 32, height: 24, format: "dng", diffractionCorrection: {}, sharpening: {}, dng: { capturedAtUtc: "2026-11-09T12:00:00.000Z" } } },
      // No detail stage: the ordinary development of the joined RAW.
      { scene: { preset: "siemens-star" }, output: { width: 32, height: 24, format: "jpeg" } }
    ] as SimulateCaptureOptions[]) {
      const whole = await simulateCapture(options);
      const joined = await simulateCaptureFromParts(options, await partsOf(options, 3, 2));
      expectSameCapture(joined, whole, JSON.stringify(options.output));
    }
  }, scaledTimeout(240_000));

  it("reports the whole-image stages row by row, after development, with no RAW stage", async () => {
    const options = { scene: { preset: "slanted-edge" }, lens: { fNumber: 16, diffraction: "circular-aperture" },
      output: { width: 24, height: 16, format: "jpeg", diffractionCorrection: {}, sharpening: {} } } as SimulateCaptureOptions;
    const parts = await partsOf(options, 2, 2);
    const events: SimulateCaptureProgress[] = [];
    await simulateCaptureFromParts({ ...options, onProgress: (p) => events.push(p) }, parts);
    const stages = events.map((e) => e.stage).filter((stage, i, all) => i === 0 || all[i - 1] !== stage);
    expect(stages).toEqual(["development", "diffraction-correction", "sharpening", "jpeg"]);
    for (const stage of ["diffraction-correction", "sharpening"] as const) {
      const rows = events.filter((e) => e.stage === stage);
      expect(rows.map((e) => e.completedTileCount)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
      expect(rows.every((e) => e.totalTileCount === 16)).toBe(true);
    }
    // The whole-frame capture reports the same stages after its RAW.
    const wholeStages: string[] = [];
    await simulateCapture({ ...options, onProgress: (p) => { if (wholeStages.at(-1) !== p.stage) wholeStages.push(p.stage); } });
    expect(wholeStages).toEqual(["raw", "development", "diffraction-correction", "sharpening", "jpeg"]);
  }, scaledTimeout(60_000));

  it("refuses a region request, missing sites, parts of another request and no parts", async () => {
    const options = { scene: { preset: "siemens-star" }, output: { width: 24, height: 16, format: "srgb-8", sharpening: {} } } as SimulateCaptureOptions;
    const parts = await partsOf(options, 2, 1);
    await expect(simulateCaptureFromParts(options, parts.slice(0, 1))).rejects.toThrow("The parts do not cover every native site");
    const other = await partsOf({ ...options, exposure: { mode: "manual", iso: 800, shutterSeconds: 1 / 250 } } as SimulateCaptureOptions, 2, 1);
    await expect(simulateCaptureFromParts(options, [parts[0]!, other[1]!])).rejects.toThrow("not the same request");
    await expect(simulateCaptureFromParts({ ...options, output: { width: 24, height: 16, region: { x: 0, y: 0, width: 8, height: 8 } } }, parts)).rejects.toThrow("no output.region");
    // With a detail stage the region is refused for the stage first.
    await expect(simulateCaptureFromParts({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 8, height: 8 } } }, parts)).rejects.toThrow("not combinable with output.region");
    await expect(simulateCaptureFromParts(options, [])).rejects.toThrow("simulateCaptureFromParts needs at least one part");
    const aborted = new AbortController();
    aborted.abort();
    await expect(simulateCaptureFromParts({ ...options, signal: aborted.signal }, parts)).rejects.toThrow("aborted");
  }, scaledTimeout(60_000));

  it("runs the detail stages row by row in place with the sums of whole-image passes (2.18.0's order), bit for bit", () => {
    let seed = 7;
    const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const [width, height, radius] of [[9, 7, 3], [5, 2, 4], [1, 1, 1], [12, 20, 16]] as const) {
      const rgb = Float64Array.from({ length: width * height * 3 }, () => random() * 1.2 - 0.05);
      const filter = designDiffractionCorrectionFilter({ workingFNumber: 11, pixelPitchMicrometers: 3, settings: { wavelengthNm: 550, regularization: 0.01, maximumGain: 4, kernelRadiusPixels: radius } });
      // Whole-image reference: a separate output image, each sample summed over dy, then dx, from zero.
      const expected = new Float64Array(rgb.length), size = 2 * radius + 1, clamp = (v: number, n: number): number => Math.min(n - 1, Math.max(0, v));
      for (let y = 0; y < height; y++) for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const w = filter.weights[(dy + radius) * size + dx + radius]!;
        if (w !== 0) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++)
          expected[(y * width + x) * 3 + c] = expected[(y * width + x) * 3 + c]! + w * rgb[(clamp(y + dy, height) * width + clamp(x + dx, width)) * 3 + c]!;
      }
      const inPlace = Float64Array.from(rgb), rows: number[] = [];
      const generator = correctDiffractionInPlace(inPlace, width, height, filter);
      for (let step = generator.next(); !step.done; step = generator.next()) rows.push(step.value);
      expect(rows).toEqual(Array.from({ length: height }, (_, i) => i + 1));
      expect(Array.from(inPlace)).toEqual(Array.from(expected));
      // Unsharp mask: horizontal image, vertical image, then the mask.
      const encoded = Float64Array.from(rgb, (v) => Math.min(1, Math.max(0, v))), sigma = radius / 3, k = unsharpMaskKernel(sigma), r = (k.length - 1) / 2;
      const horizontal = new Float64Array(encoded.length), blurred = new Float64Array(encoded.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
        let a = 0;
        for (let i = -r; i <= r; i++) a += k[i + r]! * encoded[(y * width + clamp(x + i, width)) * 3 + c]!;
        horizontal[(y * width + x) * 3 + c] = a;
      }
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
        let a = 0;
        for (let i = -r; i <= r; i++) a += k[i + r]! * horizontal[(clamp(y + i, height) * width + x) * 3 + c]!;
        blurred[(y * width + x) * 3 + c] = a;
      }
      const sharpened = Array.from(encoded, (x, i) => { const d = x - blurred[i]!; return d === 0 || Math.abs(d) < 0.01 ? x : Math.min(1, Math.max(0, x + 1.5 * d)); });
      expect(Array.from(applyUnsharpMask(encoded, width, height, { radiusPixels: sigma, amount: 1.5, threshold: 0.01 }).samples)).toEqual(sharpened);
      expect(drainDetailRows(correctDiffractionInPlace(Float64Array.from(rgb), width, height, filter))).toEqual({
        negativeSampleCount: expected.filter((v) => v < 0).length, aboveWhiteSampleCount: expected.filter((v) => v > 1).length });
    }
  });
});
