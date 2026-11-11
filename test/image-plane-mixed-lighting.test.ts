// SPDX-License-Identifier: Apache-2.0
/**
 * #597 (2.22.0): mixed lighting (#550) over an image-plane print (#581). Each site integrates the print's reflectance spectrum times
 * the blended irradiance per spectral node at use (no per-pixel signal cache; the pixels' reflectance spectra are cached). Checked
 * against the print under each single light, on the ideal reference, the RAW, the display view, a moving subject (#551) and the
 * exports.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepareImagePlaneScenes, simulateCapture, simulateDisplayView, simulateIdealReference, type MixedIllumination, type SimulateCaptureOptions } from "../src/index.js";
import { resolveImagePlaneScene } from "../src/facade/image-plane.js";
import { syntheticPhoto } from "./helpers/image-plane-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const DAY = { kind: "planckian" as const, temperatureKelvin: 6500 }, LAMP = { kind: "cie-a" as const };
const PRINT: SimulateCaptureOptions = { scene: { kind: "image-plane", sceneId: "print", image: syntheticPhoto(64, 48) }, chartSize: { widthM: 0.02, surroundReflectance: 0.18 },
  output: { width: 48, height: 32, format: "srgb-16", whiteBalance: { kelvin: 5000 } }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 }, sensor: { noiseSeed: 3 } };
/** The print's left half under the lamp, the rest (its right half and the surround) in daylight. */
const HALVES: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 8000 }],
  blend: { kind: "regions", regions: [{ source: 1, uMin: -1, uMax: -0.001, vMin: -1, vMax: 1 }], outsideSource: 0 } };
const largestDifference = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0, to = a.length): number => { let d = 0; for (let i = from; i < to; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!)); return d; };

describe("mixed lighting over an image-plane print (#597)", () => {
  beforeAll(async () => { await prepareImagePlaneScenes(); });

  it("lights each half of the print with its own source (ideal reference)", async () => {
    const [mixed, day, lamp] = await Promise.all([simulateIdealReference({ ...PRINT, illumination: HALVES }), simulateIdealReference({ ...PRINT, illuminant: DAY, illuminanceLux: 8000 }),
      simulateIdealReference({ ...PRINT, illuminant: LAMP, illuminanceLux: 8000 })]);
    const width = 48, fraction = 0.02 / (await simulateCapture({ ...PRINT, output: { ...PRINT.output, format: "srgb-8" } })).scene.framedWidthM;
    for (let y = 0; y < 32; y += 3) for (const [part, expected] of [[-0.5, lamp], [0.5, day]] as const) {
      const x = Math.floor(width / 2 + part * fraction * width / 2), at = (y * width + x) * 3;
      // The same radiance, ρ·(k·S)/π against (ρ·k·S)/π: equal but for the last bit, so within one code.
      expect(largestDifference(mixed.image.samples, expected.image.samples, at, at + 3)).toBeLessThanOrEqual(1);
    }
  }, scaledTimeout(60_000));

  it("takes the radiance path on the RAW: a blend of two equal sources is the single light, and the sites integrate at use", async () => {
    const same: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: DAY, illuminanceLux: 8000 }], blend: { kind: "linear-gradient", from: { u: -1, v: 0 }, to: { u: 1, v: 0 } } };
    const [mixed, single] = await Promise.all([simulateCapture({ ...PRINT, illumination: same, output: { ...PRINT.output, format: "dng" } }),
      simulateCapture({ ...PRINT, illuminant: DAY, illuminanceLux: 8000, output: { ...PRINT.output, format: "dng" } })]);
    expect(mixed.assumptions.find((a) => a.id === "raw.expectedSignal")?.value).toMatchObject({ method: "per-site-integrated-electrons" });
    // The same expected electrons summed in another order and the same seeded noise: equal codes but for rare ties.
    let differing = 0;
    for (let i = 0; i < single.raw.codes.length; i++) if (mixed.raw.codes[i] !== single.raw.codes[i]) differing++;
    expect(largestDifference(mixed.raw.codes, single.raw.codes)).toBeLessThanOrEqual(1);
    expect(differing).toBeLessThanOrEqual(0.002 * single.raw.codes.length);
    expect(mixed.image.dng!.length).toBeGreaterThan(0);
  }, scaledTimeout(60_000));

  it("falls off from a point source across the print, in the capture and the display view alike", async () => {
    // A lamp 5 mm above the print's left part (the print is 20 mm wide; the frame about 28 mm).
    const lamp: MixedIllumination = { points: [{ illuminant: { kind: "planckian", temperatureKelvin: 3200 }, position: { xM: -0.006, yM: 0, heightM: 0.005 }, intensity: { illuminanceLux: 30000, distanceM: 0.005 } }] };
    const options: SimulateCaptureOptions = { ...PRINT, scene: { kind: "image-plane", sceneId: "flat", image: { width: 2, height: 2, channels: 3, encoding: "srgb-8", data: new Uint8Array(12).fill(180) } },
      illumination: lamp, fast: false };
    const capture = await simulateCapture(options), view = await simulateDisplayView(options, { width: 24, height: 16 });
    const green = (samples: ArrayLike<number>, width: number, x: number, y: number): number => samples[(y * width + x) * 3 + 1]!;
    // Brightest under the lamp (left), darker to the right, in both.
    expect(green(capture.image.samples, 48, 10, 16)).toBeGreaterThan(green(capture.image.samples, 48, 38, 16));
    expect(green(view.image.samples, 24, 5, 8)).toBeGreaterThan(green(view.image.samples, 24, 19, 8));
    // The view is the capture resized: each display pixel near the area mean of its 2 × 2 real pixels (the capture's noise and the 8-bit step apart).
    const decode = (code: number, scale = 65535): number => { const e = code / scale; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    for (const [x, y] of [[5, 8], [12, 8], [19, 8]] as const) {
      let mean = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) mean += decode(green(capture.image.samples, 48, 2 * x + dx!, 2 * y + dy!)) / 4;
      expect(Math.abs(decode(green(view.image.samples, 24, x, y), 255) / mean - 1)).toBeLessThan(0.1);
    }
  }, scaledTimeout(60_000));

  it("works with a moving subject (#551) and the JPEG export", async () => {
    const framed = (await simulateCapture({ ...PRINT, output: { ...PRINT.output, width: 8, height: 6 } })).scene.framedWidthM, h = framed / 2;
    const r = await simulateCapture({ ...PRINT, illumination: HALVES, output: { ...PRINT.output, format: "jpeg" }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 },
      motion: { subject: { velocityMPerSec: { x: 2 * h }, region: { centerXM: -h / 2, centerYM: 0, widthM: h / 4, heightM: h / 4 } } } });
    expect(r.image.jpeg!.length).toBeGreaterThan(100);
    expect(r.assumptions.find((a) => a.id === "scene.illumination")).toBeDefined();
  }, scaledTimeout(60_000));

  it("caches each pixel's reflectance spectrum without changing a value", async () => {
    const scene = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image: syntheticPhoto(16, 12) }, 0.75);
    const points = Array.from({ length: 50 }, (_, i) => [Math.sin(i) * 0.99, Math.cos(i * 1.3) * 0.74] as const);
    for (const nm of [450, 550, 650]) {
      const nodes = scene.nodeReflectances(nm);
      for (const [cu, cv] of points) {
        const direct = scene.sampleAt(cu, cv, nodes, 1);
        expect(scene.reflectanceAt(cu, cv, nm)).toBe(direct);
        expect(scene.reflectanceAt(cu, cv, nm)).toBe(direct);
      }
    }
  });
});
