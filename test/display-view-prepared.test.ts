// SPDX-License-Identifier: Apache-2.0
/**
 * #387: a prepared display view renders the same results as separate simulateDisplayView calls, byte for byte (samples, view,
 * exposure, scene, diagnostics except timings, assumptions), for regions and whole views, concurrently, and cancels per render.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { InvalidConfigurationError, prepareDisplayView, resolveChartScene, simulateDisplayView, type DisplayViewResult, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** The result without its timings, as plain data. */
function comparable(result: DisplayViewResult): unknown {
  const diagnostics: Partial<DisplayViewResult["diagnostics"]> = { ...result.diagnostics };
  delete diagnostics.timingsMs;
  return { ...result, image: { ...result.image, samples: Array.from(result.image.samples) }, diagnostics };
}

const rings = (p: { u: number; v: number }): number => { const t = 20 * (p.u * p.u + p.v * p.v), f = t - Math.floor(t); return 0.1 + 0.6 * (f < 0.5 ? 2 * f : 2 - 2 * f); };
const REQUESTS: [string, SimulateCaptureOptions][] = [
  ["Speed, chart", { scene: { preset: "siemens-star" }, sensor: { pixelPitchMicrometers: 3, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 96, height: 64 } }],
  ["Quality, chart", { scene: { preset: "dead-leaves" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { pixelPitchMicrometers: 2, antiAliasing: { kind: "four-spot" } },
    exposure: { iso: 1600, shutterSeconds: 1 / 1000 }, output: { width: 80, height: 60, demosaic: "ahd" } }],
  ["Speed, caller scene", { scene: { kind: "reflectance-function", sceneId: "rings", evaluate: rings }, illuminant: { kind: "planckian", temperatureKelvin: 3200 },
    output: { width: 72, height: 48, whiteBalance: { kelvin: 3200 } } }]
];

describe("prepared display view (#387)", () => {
  it.each(REQUESTS)("%s: regions and whole views equal separate calls", async (_, options) => {
    const prepared = await prepareDisplayView(options, { gpu: "off" });
    const w = Math.round((options.output!.width as number) * 0.6), h = Math.round((options.output!.height as number) * 0.6);
    const views: SimulateDisplayViewOptions[] = [{ width: w, height: h }, { width: w, height: h, region: { x: 0, y: 0, width: 7, height: 5 } },
      { width: w, height: h, region: { x: w - 9, y: h - 4, width: 9, height: 4 }, format: "srgb-16" }, { width: 20, height: 13, samplesPerAxis: 4 }];
    for (const view of views) expect(comparable(await prepared.render(view))).toEqual(comparable(await simulateDisplayView(options, view)));
  }, testTimeout(120_000));

  // The Quality chart takes the filled path, whose tables and lattice rings the renders of one prepared view share (2.9).
  it.each(REQUESTS.slice(0, 2))("%s: renders concurrently with the results of separate calls", async (_, options) => {
    const prepared = await prepareDisplayView(options, { gpu: "off" });
    const regions = [0, 1, 2, 3].map((i) => ({ width: 48, height: 32, region: { x: (i % 2) * 24, y: Math.floor(i / 2) * 16, width: 24, height: 16 } }));
    const together = await Promise.all(regions.map((view) => prepared.render(view)));
    for (let i = 0; i < regions.length; i++) expect(comparable(together[i]!)).toEqual(comparable(await simulateDisplayView(options, regions[i]!)));
  }, testTimeout(60_000));

  // #454: the request shape of scripts/benchmark-display-view.mjs --app, scaled down: a caller material scene (a composite
  // chart plus a stand-in label), the 2 × 2 box, Quality options, and a device-pixel view (3 × 3 real pixels per display
  // pixel, so the exact area mean) rendered as parts, centre first, from one prepared view.
  it("app-request shape: parts of a prepared device-pixel view hash equal to separate calls", async () => {
    const width = 120, height = 81, view = { width: 40, height: 27 }, aspect = view.height / view.width;
    const chart = resolveChartScene({ scene: { preset: "composite", background: { preset: "line-grid" },
      elements: [{ scene: { preset: "siemens-star" }, centerU: 0, centerV: 0, width: 0.8, height: 0.8, mask: "ellipse" }, { scene: { preset: "step-wedge" }, centerU: 0, centerV: -0.55, width: 0.9, height: 0.12 }] }, aspect });
    const materials = chart.materials.map((m) => (m.kind === "neutral" ? m.reflectance : 0.18)), label = materials.length;
    const options: SimulateCaptureOptions = {
      scene: { kind: "material-function", sceneId: "test:app-request", materials: [...materials, 0.85, 0.06],
        materialAt: (p) => { const u = p.chartU ?? p.u, v = p.chartV ?? p.v; return u < -0.5 && v < -0.45 ? label + (Math.floor(u * 40) % 2 === 0 ? 1 : 0) : chart.materialAt(u, v); } },
      chartSize: { widthM: 0.12, heightM: 0.081 }, subjectDistanceM: 0.5,
      lens: { prime: 50, fNumber: 11, diffraction: "circular-aperture" }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
      sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } },
      output: { width, height, format: "srgb-8", demosaic: "ahd" }
    };
    const prepared = await prepareDisplayView(options, { gpu: "off" }), side = 12, parts: { x: number; y: number; width: number; height: number }[] = [];
    for (let y = 0; y < view.height; y += side) for (let x = 0; x < view.width; x += side) parts.push({ x, y, width: Math.min(side, view.width - x), height: Math.min(side, view.height - y) });
    const centre = (r: { x: number; y: number; width: number; height: number }): number => Math.hypot(r.x + r.width / 2 - view.width / 2, r.y + r.height / 2 - view.height / 2);
    parts.sort((a, b) => centre(a) - centre(b));
    const hash = (result: DisplayViewResult): string => createHash("sha256").update(JSON.stringify(comparable(result))).digest("hex");
    for (const region of parts) {
      const part = await prepared.render({ ...view, region });
      expect(part.assumptions.find((a) => a.id === "view.estimation")?.value).toMatchObject({ method: "exact-area-mean-over-real-pixels" });
      expect(hash(part)).toBe(hash(await simulateDisplayView(options, { ...view, region })));
    }
  }, testTimeout(120_000));

  it("raises request errors when preparing, view errors when rendering, and cancels one render", async () => {
    await expect(prepareDisplayView({ scene: { preset: "uniform" }, output: { width: 16, height: 16, region: { x: 0, y: 0, width: 4, height: 4 } } })).rejects.toThrow(InvalidConfigurationError);
    const prepared = await prepareDisplayView({ scene: { preset: "uniform" }, output: { width: 16, height: 16 } });
    await expect(prepared.render({ width: 17, height: 4 })).rejects.toThrow(InvalidConfigurationError);
    await expect(prepared.render(undefined as never)).rejects.toThrow(InvalidConfigurationError);
    await expect(prepared.render({ width: 4, height: 4 }, { extra: 1 } as never)).rejects.toThrow(InvalidConfigurationError);
    const controller = new AbortController();
    controller.abort();
    await expect(prepared.render({ width: 4, height: 4 }, { signal: controller.signal })).rejects.toThrow(/aborted/u);
    expect((await prepared.render({ width: 4, height: 4 })).image.width).toBe(4);
  }, testTimeout(30_000));
});
