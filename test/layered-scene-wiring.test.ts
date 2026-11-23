// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0 wave-3 wiring (group LW1) of layered chart scenes through the public API: lens distortion, vignetting and fisheye
 * projections (#744), mixed illumination (#745), large blur and the kernel checks before allocation (#749), chartSize (#761), the
 * view's focus mask (#752) and the pixel query (#747). Each whole render goes through simulateCapture or simulateDisplayView; the
 * capture's environment is checked against the view per site within 1e-9 relative, and regions against the whole frame.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, prepareDisplayView, prepareLayeredChartScenes, simulateCapture,
  simulateDisplayView, type LayeredChartScene, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createLayeredSceneProvider } from "../src/facade/layered-scene-provider.js";
import { calculateLayeredChartSurfaceAtPixel } from "../src/facade/layered-chart-pixel.js";
import { calculateLayeredChartSurfaceAt } from "../src/facade/layered-chart-query.js";
import type { LayeredSceneLattice } from "../src/facade/layered-scene-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const exposure = { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } as const;
const scene: LayeredChartScene = { kind: "layered-chart", cards: [
  { distanceM: 1.6, centerU: -0.45, centerV: -0.05, width: 1.0, height: 0.5, scene: { preset: "slanted-edge" } },
  { distanceM: 2, centerU: 0.3, centerV: 0.1, width: 0.9, height: 0.6, scene: { preset: "siemens-star", cycles: 12 } }],
backPlane: { distanceM: 3, reflectance: 0.5 } };
/** An ideal 50 mm lens open to f/1.2 (the tier lens stops at f/4). */
const ideal = (focalLengthMm: number): { ideal: { focalLengthMm: number; widestFNumber: number } } => ({ ideal: { focalLengthMm, widestFNumber: 1.2 } });
const lens = { ...ideal(50), fNumber: 4, focusDistanceM: 2 } as const;
const options = (extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene, subjectDistanceM: 2, lens,
  sensor: { pixelPitchMicrometers: 3, spectralStepNanometers: 40 }, output: { width: 48, height: 32 }, exposure, ...extra });
// A barrel distortion (1.2 % at the corner) and a vignetting profile over the 0.144 × 0.096 mm frame (3 µm sites) and the blur's reach beyond it.
const HALF_DIAGONAL_MM = Math.hypot(0.072, 0.048);
const distortion = { kind: "radial", profile: { normalizationRadiusMm: HALF_DIAGONAL_MM, maximumNormalizedRadius: 5, coefficients: { k1: -0.012, k2: 0, k3: 0 } } } as const;
const vignetting = { normalizationRadiusMm: HALF_DIAGONAL_MM, maximumNormalizedRadius: 5, coefficients: { r2: -0.03, r4: 0, r6: 0 } } as const;
/** A fisheye framing: 375 µm sites, a 36 × 24 mm frame of 96 × 64 pixels; the corner is about 53° off the axis at 24 mm (equisolid). */
const fisheye = (focalLengthMm: number): SimulateCaptureOptions => ({ scene, subjectDistanceM: 2, lens: { ...ideal(focalLengthMm), fNumber: 4, focusDistanceM: 2, projection: "fisheye-equisolid-angle" },
  sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 40 }, output: { width: 96, height: 64 }, exposure });

type Electrons = { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } };
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as Electrons).photo.value.photoSignal.expectedGeneratedElectronCount;
}

/**
 * The capture's environment at sampled sites (its own lens field mapping, vignetting and query offsets) read through a layered provider of
 * the view's lattice, against the view's expected signal: the largest relative difference, and the count of edge sites.
 */
async function captureAgainstView(request: SimulateCaptureOptions, sites = 60): Promise<{ worst: number; edges: number; lattice: LayeredSceneLattice }> {
  const capture = await simulateCapture(request), { signal, signalInput } = await simulateDisplayViewWithInternals(request, { width: 12, height: 8, samplesPerAxis: 1 });
  const lattice = (signal as unknown as { lattice: LayeredSceneLattice }).lattice;
  const native = capture.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, H = native.pixelHeight, width = request.output!.width!, height = request.output!.height!;
  const base = createPlanarSceneRadianceProvider({ scene: { preset: "uniform" }, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: capture.scene.illuminant.illuminanceLux,
    distanceM: request.subjectDistanceM!, framedWidthM: capture.scene.framedWidthM, aspect: height / width, sceneId: "facade-scene", providerProfileId: "facade-provider" });
  const provider = createLayeredSceneProvider({ base, lattice, wavelengthsNm: signalInput.wavelengthsNm, nativeWidth: W, nativeHeight: H, outputWidth: width, distanceM: request.subjectDistanceM!,
    metresPerFrameUnit: capture.scene.framedWidthM / 2 });
  let worst = 0, edges = 0;
  for (let k = 0; k < sites; k++) {
    const index = (k * 7919 + 13) % (W * H), x = index % W, y = Math.floor(index / W);
    const reference = electrons(capture.request.siteInput(index).environment, provider.evaluateRadiance.bind(provider));
    worst = Math.max(worst, Math.abs(signal.site(x, y) - reference) / reference);
  }
  const still = lattice.groupOf(0, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lattice.siteSurface(still, x, y, 1) < 0) edges++;
  return { worst, edges, lattice };
}

describe("layered chart scenes, 2.29.0 wiring (LW1)", () => {
  beforeAll(async () => { await prepareLayeredChartScenes(); });

  it("#744: renders through a distortion and vignetting; the capture's environment equals the view per site within 1e-9", async () => {
    for (const extra of [{ distortion }, { vignetting }, { distortion, vignetting, diffraction: "circular-aperture" as const }]) {
      const request = options({ lens: { ...lens, ...extra } }), name = Object.keys(extra).join(" + ");
      const environment = (await simulateCapture(request)).request.siteInput(0).environment as { lensFieldMapping?: unknown; fieldThroughput: { kind: string } };
      expect(environment.lensFieldMapping !== undefined, name).toBe("distortion" in extra);
      expect(environment.fieldThroughput.kind, name).toBe("vignetting" in extra ? "radial-illumination-vignetting" : "unity");
      const { worst, edges, lattice } = await captureAgainstView(request);
      expect(lattice.parts.geometry.planar, name).toBe(false);
      expect(edges, name).toBeGreaterThan(20);
      expect(worst, name).toBeLessThan(1e-9);
    }
    // Vignetting darkens the corners against the centre (the same scene without it does not).
    const corner = (r: { image: { samples: Uint8Array | Uint16Array } }): number => r.image.samples[0]!;
    const flat: LayeredChartScene = { kind: "layered-chart", cards: [{ distanceM: 2.5, centerU: 0, centerV: 0, width: 0.2, height: 0.2, scene: { preset: "uniform" } }], backPlane: { distanceM: 3, reflectance: 0.5 } };
    const dim = { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } as const;
    const lit = await simulateDisplayView(options({ scene: flat, exposure: dim }), { width: 12, height: 8 }), vignetted = await simulateDisplayView(options({ scene: flat, exposure: dim, lens: { ...lens, vignetting } }), { width: 12, height: 8 });
    expect(corner(vignetted)).toBeLessThan(corner(lit));
  }, scaledTimeout(240_000));

  it("#744: a fisheye renders within 75° of the axis and is refused at 75° and beyond, or outside the image circle", async () => {
    const inside = fisheye(24);
    const capture = await simulateCapture(inside), view = await simulateDisplayView(inside, { width: 24, height: 16 });
    expect(capture.scene.layers).toHaveLength(3);
    expect(view.image.samples.length).toBe(24 * 16 * 3);
    const { worst } = await captureAgainstView(inside, 30);
    expect(worst).toBeLessThan(1e-9);
    // 15 mm: the corner looks about 92° off the axis; 11 mm: the corners are outside the image circle (r > 2f).
    await expect(simulateCapture(fisheye(15))).rejects.toThrow(/^Layered chart scenes with a fisheye lens render only within 75° of the axis \(15° inside the horizon\); this request reads points \d+\.\d° off the axis/);
    await expect(simulateDisplayView(fisheye(15), { width: 24, height: 16 })).rejects.toThrow(/render only within 75° of the axis/);
    await expect(simulateCapture(fisheye(10))).rejects.toThrow(/this request reads points outside the image circle/);
  }, scaledTimeout(240_000));

  it("#745: mixed illumination lights every surface by the blend at its own frame point; capture equals view per site within 1e-9", async () => {
    const illumination = { sources: [{ illuminant: { kind: "cie-a" }, illuminanceLux: 800 }, { illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 1600 }],
      blend: { kind: "linear-gradient", from: { u: -0.8, v: 0 }, to: { u: 0.8, v: 0 } } };
    const request = options({ illumination } as never);
    const { worst, edges } = await captureAgainstView(request);
    expect(edges).toBeGreaterThan(20);
    expect(worst).toBeLessThan(1e-9);
    const view = await simulateDisplayView(request, { width: 12, height: 8 });
    expect(view.assumptions.find((a) => a.id === "scene.layers")!.value).toMatchObject({ illumination: "blend-at-each-frame-point" });
    // The blend runs from warm (left) to cool (right): the back plane's red / blue falls across the frame.
    const rb = (x: number, y: number): number => view.image.samples[(y * 12 + x) * 3]! / view.image.samples[(y * 12 + x) * 3 + 2]!;
    expect(rb(0, 0)).toBeGreaterThan(rb(11, 0));
  }, scaledTimeout(240_000));

  it("#749: a large disc renders by runs; a shaped kernel above 128 and a disc above 512 are refused before a kernel is built", async () => {
    // 1 µm sites at f/2, focused at 2 m: the near card's disc radius is about 100 sites.
    const near = { ...options({ lens: { ...ideal(50), fNumber: 2, focusDistanceM: 2 }, sensor: { pixelPitchMicrometers: 1, spectralStepNanometers: 40 }, output: { width: 64, height: 48 } }) };
    const prepared = await prepareDisplayView(near, { gpu: "off" });
    const part = await prepared.render({ width: 32, height: 24, region: { x: 4, y: 10, width: 4, height: 4 }, samplesPerAxis: 2 });
    const radii = (part.assumptions.find((a) => a.id === "scene.layers")!.value as { kernelRadiusSites: number[] }).kernelRadiusSites;
    expect(Math.max(...radii)).toBeGreaterThan(64);
    const whole = await prepared.render({ width: 32, height: 24, samplesPerAxis: 2 });
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++)
      expect(part.image.samples[(j * 4 + i) * 3 + k]).toBe(whole.image.samples[((j + 10) * 32 + i + 4) * 3 + k]);
    // A shaped kernel of thousands of sites: refused by its radius, before the builder would allocate it.
    const started = Date.now();
    await expect(simulateCapture({ ...near, lens: { ...ideal(50), fNumber: 1.4, focusDistanceM: 0.6, defocus: { model: "geometric-disc", blades: { count: 7 } } },
      sensor: { pixelPitchMicrometers: 0.5, spectralStepNanometers: 40 } })).rejects.toThrow(/^lens\.defocus: a surface's blur needs a kernel radius of \d{4,} sites; at card edges the layered sum takes at most 128 for a shaped kernel/);
    await expect(simulateCapture({ ...near, lens: { ...ideal(50), fNumber: 1.4, focusDistanceM: 0.6 }, sensor: { pixelPitchMicrometers: 0.5, spectralStepNanometers: 40 } }))
      .rejects.toThrow(/^lens\.defocus: The blur circle is [\d,]+ sites across; the engine renders at most 1,025 sites \(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES\)\.$/);
    expect(Date.now() - started).toBeLessThan(scaledTimeout(20_000));
  }, scaledTimeout(240_000));

  it("#761: chartSize places the cards in chart units; the far surface continues beyond the chart", async () => {
    const plain = options(), framedWidthM = (await simulateCapture(plain)).scene.framedWidthM;
    // A chart as wide as the frame: chart units are frame units, the same bytes.
    const same = await simulateCapture({ ...plain, chartSize: { widthM: framedWidthM } }), base = await simulateCapture(plain);
    expect(Array.from(same.image.samples)).toEqual(Array.from(base.image.samples));
    expect(same.scene.chart).toMatchObject({ frameWidthFraction: 1 });
    expect(same.assumptions.some((a) => a.id === "chartSize.surroundReflectance")).toBe(false);
    // A chart half the frame's width: the cards at half their frame size, the same as the cards scaled by ½ in frame units.
    const half = await simulateDisplayView({ ...plain, chartSize: { widthM: framedWidthM / 2 } }, { width: 24, height: 16, samplesPerAxis: 4 });
    const scaled: LayeredChartScene = { ...scene, cards: scene.cards.map((c) => ({ ...c, centerU: c.centerU / 2, centerV: c.centerV / 2, width: c.width / 2, height: c.height / 2 })) };
    const reference = await simulateDisplayView({ ...plain, scene: scaled }, { width: 24, height: 16, samplesPerAxis: 4 });
    let differ = 0, most = 0;
    for (let i = 0; i < half.image.samples.length; i++) { const d = Math.abs(half.image.samples[i]! - reference.image.samples[i]!); if (d > 0) differ++; most = Math.max(most, d); }
    expect(most).toBeLessThanOrEqual(1);
    expect(differ).toBeLessThan(half.image.samples.length / 50);
    expect(half.assumptions.find((a) => a.id === "scene.layers")!.value).toMatchObject({ chartUnitsPerFrameUnit: 2 });
  }, scaledTimeout(240_000));

  it("#752: the focus mask scores each surface's pixels as its depth report; regions equal the whole view; one value on a single plane", async () => {
    for (const fNumber of [2, 4, 8]) {
      const request = options({ lens: { ...lens, fNumber }, output: { width: 48, height: 32 } });
      const prepared = await prepareDisplayView(request);
      const whole = await prepared.render({ width: 48, height: 32, samplesPerAxis: 1, focusMask: true }), mask = whole.view.focusMask!;
      const layers = whole.scene.layers!, c0 = Math.hypot(48, 32) * 3 / 1000 / 1500;
      expect(mask).toMatchObject({ width: 48, height: 32, circleOfConfusionMm: c0 });
      expect(mask.label).toMatch(/^Geometric thin-lens focus guide/);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 48; x++) {
        const at = calculateLayeredChartSurfaceAt({ scene, aspect: 32 / 48, u: (x + 0.5 - 24) * 2 / 48, v: -(y + 0.5 - 16) * 2 / 48 });
        const layer = layers.find((l) => l.kind === at.kind && l.index === at.index)!, expected = Math.max(0, 1 - layer.defocusDiameterSites * 3 / 1000 / c0);
        expect(Math.abs(mask.score[y * 48 + x]! - expected)).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(expected) * 2 ** -24));
        expect(mask.score[y * 48 + x]! > 0).toBe(layer.withinDepthOfField);
      }
      const part = await prepared.render({ width: 48, height: 32, samplesPerAxis: 1, focusMask: { circleOfConfusionMm: c0 }, region: { x: 7, y: 5, width: 11, height: 9 } });
      for (let j = 0; j < 9; j++) for (let i = 0; i < 11; i++) expect(part.view.focusMask!.score[j * 11 + i]).toBe(mask.score[(j + 5) * 48 + i + 7]);
      // fast: false gives the same mask.
      const exact = await simulateDisplayView({ ...request, fast: false }, { width: 48, height: 32, samplesPerAxis: 1, focusMask: true });
      expect(Array.from(exact.view.focusMask!.score)).toEqual(Array.from(mask.score));
      prepared.dispose();
    }
    // A single-plane scene: one value, the subject distance's blur against c0.
    const flat = await simulateDisplayView({ ...options(), scene: { preset: "siemens-star" }, subjectDistanceM: 3, lens: { ...lens, fNumber: 8 } }, { width: 12, height: 8, focusMask: { circleOfConfusionMm: 0.1 } });
    expect(new Set(flat.view.focusMask!.score).size).toBe(1);
    expect(flat.view.focusMask!.score[0]).toBeCloseTo(1 - 50 * 50 * 1000 / (8 * 3000 * 1950) / 0.1, 6);
    expect((await simulateDisplayView(options(), { width: 12, height: 8 })).view.focusMask).toBeUndefined();
    for (const focusMask of ["yes", null, { circleOfConfusionMm: -1 }, { c: 1 }])
      await expect(simulateDisplayView(options(), { width: 12, height: 8, focusMask } as never)).rejects.toThrow(/view\.focusMask/);
  }, scaledTimeout(240_000));

  it("#747: the surface at a pixel through the lens equals the view's pilot read and the focus mask, for every pixel", async () => {
    const requests: [string, SimulateCaptureOptions][] = [["rectilinear", options()], ["distortion", options({ lens: { ...lens, distortion } })], ["fisheye", fisheye(24)]];
    for (const [name, request] of requests) {
      const { signal } = await simulateDisplayViewWithInternals(request, { width: 12, height: 8, samplesPerAxis: 1 });
      const lattice = (signal as unknown as { lattice: LayeredSceneLattice }).lattice, geometry = lattice.parts.geometry, W = request.output!.width!, H = request.output!.height!;
      const view = await simulateDisplayView(request, { width: W, height: H, samplesPerAxis: 1, focusMask: true }), layers = view.scene.layers!;
      const surfaces = [...scene.cards.map((_, i) => ({ kind: "card", index: i })), { kind: "back-plane", index: -1 }];
      const given = request.lens as { ideal: { focalLengthMm: number }; focusDistanceM: number; projection?: string; distortion?: unknown };
      const r = { focalLengthMm: given.ideal.focalLengthMm, focusDistanceM: given.focusDistanceM, ...(given.projection ? { projection: given.projection } : {}), ...(given.distortion ? { distortion: given.distortion } : {}) };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const at = calculateLayeredChartSurfaceAtPixel({ scene, output: { width: W, height: H }, pixel: { x, y }, sensor: { pixelPitchMicrometers: request.sensor!.pixelPitchMicrometers! },
          lens: r, subjectDistanceM: request.subjectDistanceM! })!;
        const p = geometry.rasterFramePoint((x + 0.5 - W / 2) * 2 / W, -(y + 0.5 - H / 2) * 2 / W, { u: 0, v: 0, factor: 1 });
        expect(at, name).not.toBeNull();
        expect([at.kind, at.index], name + " " + x + "," + y).toEqual([surfaces[lattice.chiefSurface(p.u, p.v).surface]!.kind, surfaces[lattice.chiefSurface(p.u, p.v).surface]!.index]);
        const layer = layers.find((l) => l.kind === at.kind && l.index === at.index)!;
        expect(view.view.focusMask!.score[y * W + x]! > 0, name).toBe(layer.withinDepthOfField);
      }
    }
    // Outside a fisheye's image circle (a 10 mm equisolid lens on this frame): no scene.
    expect(calculateLayeredChartSurfaceAtPixel({ scene, output: { width: 96, height: 64 }, pixel: { x: 0, y: 0 }, sensor: { pixelPitchMicrometers: 375 },
      lens: { focalLengthMm: 10, projection: "fisheye-equisolid-angle" }, subjectDistanceM: 2 })).toBeNull();
    expect(() => calculateLayeredChartSurfaceAtPixel({ scene, output: { width: 96, height: 64 }, pixel: { x: 96, y: 0 }, sensor: { pixelPitchMicrometers: 3 }, lens: { focalLengthMm: 50 }, subjectDistanceM: 2 }))
      .toThrow(/pixel\.x must be an integer from 0 to 95/);
  }, scaledTimeout(240_000));

  it("a capture's region equals the whole frame through the lens map and the blend", async () => {
    for (const request of [options({ lens: { ...lens, distortion, vignetting } }), options({ illumination: { sources: [{ illuminant: { kind: "cie-a" }, illuminanceLux: 800 },
      { illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 1600 }], blend: { kind: "linear-gradient", from: { u: -0.8, v: 0 }, to: { u: 0.8, v: 0 } } } } as never)]) {
      const whole = await simulateCapture(request), part = await simulateCapture({ ...request, output: { ...request.output, region: { x: 9, y: 5, width: 14, height: 11 } } });
      for (let j = 0; j < 11; j++) for (let i = 0; i < 14; i++) for (let k = 0; k < 3; k++)
        expect(part.image.samples[(j * 14 + i) * 3 + k]).toBe(whole.image.samples[((j + 5) * 48 + i + 9) * 3 + k]);
    }
  }, scaledTimeout(240_000));
});
