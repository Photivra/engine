// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { serializeSimulatedCaptureDngFromParts, simulateCapture, type SimulateCaptureDngPart, type SimulateCaptureOptions } from "../src/index.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** Splits an output frame into a grid of regions and renders each as its own call, as a worker pool would. */
async function partsOf(options: SimulateCaptureOptions, columns: number, rows: number): Promise<SimulateCaptureDngPart[]> {
  const width = options.output!.width!, height = options.output!.height!;
  const edge = (i: number, count: number, length: number): number => (i === count ? length : 2 * Math.round((i * length) / count / 2));
  const parts: SimulateCaptureDngPart[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = edge(c, columns, width), y = edge(r, rows, height);
    const region = { x, y, width: edge(c + 1, columns, width) - x, height: edge(r + 1, rows, height) - y };
    // The app renders the parts as sRGB.
    // A region takes no capture time and no auto white balance; neither changes the RAW codes (the DNG measures auto white balance
    // over the joined frame).
    const output = { ...options.output!, format: "srgb-8" as const, region };
    delete output.dng;
    if (output.whiteBalance === "auto") output.whiteBalance = "scene-illuminant";
    // #728, #732: a part renders with the join's fast (an sRGB region is fast by default; a DNG, JPEG or PNG join is exact).
    const joinFast = options.fast ?? !["dng", "jpeg", "png"].includes(options.output?.format ?? "srgb-8");
    const result = await simulateCapture({ ...options, fast: joinFast, output });
    parts.push({ raw: result.raw, region: result.region! });
  }
  return parts;
}

describe("whole-frame DNG from region parts (#391)", () => {
  it("writes the bytes of the whole-frame DNG: bilinear and AHD, with and without diffraction and the box aperture, chart and function scenes", async () => {
    for (const options of [
      { scene: { preset: "siemens-star" }, output: { width: 40, height: 28, format: "dng" } },
      { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } },
        output: { width: 40, height: 28, format: "dng", demosaic: "ahd" } },
      { scene: { preset: "slanted-edge" }, output: { width: 36, height: 24, format: "dng", whiteBalance: "auto", dng: { capturedAtUtc: "2026-10-25T12:00:00.000Z" } } },
      { scene: { kind: "reflectance-function", sceneId: "dng-parts-function", evaluate: ({ u }: { u: number }): number => (u > 0 ? 0.6 : 0.2) },
        lens: { diffraction: "circular-aperture" }, output: { width: 32, height: 24, format: "dng" } }
    ] as SimulateCaptureOptions[]) {
      const whole = await simulateCapture(options);
      const joined = await serializeSimulatedCaptureDngFromParts(options, await partsOf(options, 3, 2));
      expect(joined.bytes.length, JSON.stringify(options.scene)).toBe(whole.image.dng!.length);
      expect(Buffer.from(joined.bytes).equals(Buffer.from(whole.image.dng!)), JSON.stringify(options.scene)).toBe(true);
    }
  }, scaledTimeout(300_000));

  it("is the same with the environment path's parts as with the tabulated path's, auto white balance included", async () => {
    const options = { scene: { preset: "dead-leaves" }, output: { width: 32, height: 24, format: "dng", whiteBalance: "auto" } } as SimulateCaptureOptions;
    const whole = await simulateCapture(options);
    setTabulatedNativeRawEnabled(false);
    try {
      const joined = await serializeSimulatedCaptureDngFromParts(options, await partsOf(options, 2, 2));
      expect(Buffer.from(joined.bytes).equals(Buffer.from(whole.image.dng!))).toBe(true);
    } finally {
      setTabulatedNativeRawEnabled(true);
    }
  }, scaledTimeout(300_000));

  it("refuses parts that miss sites, come from another request, or a request with a region", async () => {
    const options = { scene: { preset: "siemens-star" }, output: { width: 24, height: 16, format: "dng" } } as SimulateCaptureOptions;
    const parts = await partsOf(options, 2, 1);
    await expect(serializeSimulatedCaptureDngFromParts(options, parts.slice(0, 1))).rejects.toThrow("do not cover every native site");
    const other = await partsOf({ ...options, exposure: { mode: "manual", iso: 800, shutterSeconds: 1 / 250 } } as SimulateCaptureOptions, 2, 1);
    await expect(serializeSimulatedCaptureDngFromParts(options, [parts[0]!, other[1]!])).rejects.toThrow("not the same request");
    await expect(serializeSimulatedCaptureDngFromParts({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 8, height: 8 } } }, parts)).rejects.toThrow("no output.region");
    await expect(serializeSimulatedCaptureDngFromParts({ ...options, output: { ...options.output, format: "png" } }, parts)).rejects.toThrow("output.format \"dng\"");
    await expect(serializeSimulatedCaptureDngFromParts(options, [])).rejects.toThrow("at least one part");
    // #730 facade-03: undefined parts are refused as [] and null are, not rendered as a whole capture.
    await expect(serializeSimulatedCaptureDngFromParts(options, undefined as unknown as [])).rejects.toThrow("at least one part");
    await expect(serializeSimulatedCaptureDngFromParts({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 8, height: 8 } } }, undefined as unknown as [])).rejects.toThrow("no output.region");
  }, scaledTimeout(120_000));
});
