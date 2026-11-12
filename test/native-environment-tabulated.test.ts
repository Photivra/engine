// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #394 step 2: chart presets and caller material scenes take their native RAW from tabulated expected electrons (the display
 * view's expected signal) with the native sensor stage and each site's own seeds. Its electrons differ from the environment
 * chain's only in the last bits, so a site can, rarely, draw a different integer; everything else is the environment path's.
 */
afterEach(() => setTabulatedNativeRawEnabled(true));

async function both(options: SimulateCaptureOptions): Promise<{ tabulated: SimulateCaptureResult; chain: SimulateCaptureResult; differing: number }> {
  setTabulatedNativeRawEnabled(false);
  const chain = await simulateCapture(options);
  setTabulatedNativeRawEnabled(true);
  const tabulated = await simulateCapture(options);
  expect(tabulated.raw.codes.length).toBe(chain.raw.codes.length);
  let differing = 0;
  for (let i = 0; i < chain.raw.codes.length; i++) if (tabulated.raw.codes[i] !== chain.raw.codes[i]) differing++;
  for (const key of ["blackLevels", "digitalSaturationCodes", "effectiveSaturationCodes"] as const) expect(Array.from(tabulated.raw[key])).toEqual(Array.from(chain.raw[key]));
  return { tabulated, chain, differing };
}

const method = (r: SimulateCaptureResult): unknown => (r.assumptions.find((a) => a.id === "raw.expectedSignal")?.value as { method?: string } | undefined)?.method;
const material = { kind: "material-function", sceneId: "test-tabulated-materials", materials: [0.2, 0.6, 0.85],
  materialAt: ({ u, v }: { u: number; v: number }): number => (u * u + v * v < 0.2 ? 2 : u > 0 ? 1 : 0) };

describe("tabulated native RAW for engine-built planar scenes (#394 step 2)", () => {
  it("gives the environment path's RAW for chart presets and material scenes in Speed and Quality", async () => {
    for (const options of [
      { scene: { preset: "siemens-star" }, output: { width: 48, height: 32 } },
      { scene: { preset: "dead-leaves" }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 48, height: 32 } },
      { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { antiAliasing: { kind: "four-spot" } }, output: { width: 48, height: 32, demosaic: "ahd" } },
      { scene: { preset: "slanted-edge" }, chartSize: { widthM: 0.3 }, subjectDistanceM: 2, output: { width: 48, height: 32, whiteBalance: "auto" } },
      { scene: { preset: "siemens-star" }, motion: { shutter: "rolling" }, output: { width: 48, height: 32 } },
      { scene: material, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, lens: { diffraction: "circular-aperture" }, output: { width: 48, height: 32 } },
      { scene: { preset: "siemens-star" }, lens: { diffraction: "circular-aperture" }, output: { width: 64, height: 48, region: { x: 20, y: 12, width: 16, height: 12 } } }
    ] as SimulateCaptureOptions[]) {
      const { tabulated, chain, differing } = await both(options);
      expect(method(tabulated)).toBe("per-site-integrated-electrons");
      expect(method(chain)).toBeUndefined();
      // Last-bit differences rarely change a draw; on these frames none did.
      expect(differing).toBe(0);
      expect(Array.from(tabulated.image.samples)).toEqual(Array.from(chain.image.samples));
      expect(tabulated.diagnostics.providerEvaluationCount).toBeLessThan(chain.diagnostics.providerEvaluationCount);
    }
  }, scaledTimeout(300_000));

  it("gives the same capture with warm caches, after another request, as from a fresh start", async () => {
    // The channel responses and site diffraction kernels are kept across calls; neither may change a result.
    const quality = { scene: { preset: "zone-plate" }, lens: { fNumber: 16, diffraction: "circular-aperture" }, sensor: { antiAliasing: { kind: "four-spot" } },
      output: { width: 48, height: 32, demosaic: "ahd", region: { x: 8, y: 4, width: 24, height: 16 } } } as SimulateCaptureOptions;
    const other = { ...quality, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 500 }, lens: { fNumber: 5.6, diffraction: "circular-aperture" } } as SimulateCaptureOptions;
    vi.resetModules();
    const fresh = await (await import("../src/index.js")).simulateCapture(quality);
    const engine = await import("../src/index.js");
    await engine.simulateCapture(other);
    const warm = await engine.simulateCapture(quality);
    expect(method(warm)).toBe("per-site-integrated-electrons");
    expect(Array.from(warm.raw.codes)).toEqual(Array.from(fresh.raw.codes));
    expect(Array.from(warm.image.samples)).toEqual(Array.from(fresh.image.samples));
  }, scaledTimeout(300_000));

  it("keeps the environment path where the tabulated signal does not apply", async () => {
    for (const options of [
      { scene: { preset: "dead-leaves" }, lens: { vignetting: { normalizationRadiusMm: 0.3, maximumNormalizedRadius: 1, coefficients: { r2: -0.5, r4: 0, r6: 0 } } }, output: { width: 32, height: 24 } },
      { scene: { preset: "siemens-star" }, motion: { angularVelocityRadPerSec: { yaw: 0.05 } }, output: { width: 32, height: 24 } },
      { scene: { preset: "siemens-star" }, lens: { projection: "fisheye-equidistant" }, output: { width: 32, height: 24 } },
      { scene: { kind: "reflectance-function", sceneId: "test-tabulated-function", evaluate: ({ u }: { u: number }): number => (u > 0 ? 0.6 : 0.2) }, output: { width: 32, height: 24 } }
    ] as SimulateCaptureOptions[]) expect(method(await simulateCapture(options))).toBeUndefined();
  }, scaledTimeout(300_000));

  it("honours an abort queued as a separate task", async () => {
    const controller = new AbortController();
    let tiles = 0, tilesAtAbort = -1;
    const capture = simulateCapture({ scene: { preset: "dead-leaves" }, output: { width: 384, height: 256 }, signal: controller.signal,
      onProgress: (p) => { if (p.stage === "raw" && ++tiles === 1) setTimeout(() => { tilesAtAbort = tiles; controller.abort(); }, 0); } });
    await expect(capture).rejects.toThrow("aborted");
    // The cancel ran at a host yield (about every 8 ms of work), well before the 258 native rows were done.
    expect(tilesAtAbort).toBeGreaterThan(0);
    expect(tiles).toBeLessThan(258 * 2);
  }, scaledTimeout(120_000));
});
