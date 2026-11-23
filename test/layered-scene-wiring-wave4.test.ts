// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0 wave-4 wiring (group LW2) of layered chart scenes through the public API: a catalogue lens (#741), its focus scatter and
 * breathing (#748), camera rotation with a global or rolling shutter (#746), the layered GPU route (#750) and the tabulated native
 * RAW path of layered captures (#751). Each whole render goes through simulateCapture or simulateDisplayView; the capture's environment
 * is checked against the view per site within 1e-9 relative, regions against the whole frame, and the tabulated RAW against the chain.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { calculateDefocusCircle, calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, estimateDisplayViewRender, prepareDisplayView, prepareLayeredChartScenes,
  simulateCapture, simulateDisplayView, type LayeredChartScene, type SimulateCaptureOptions } from "../src/index.js";
import { preparedDisplayViewParts, simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createLayeredSceneProvider } from "../src/facade/layered-scene-provider.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";
import { LAYERED_MOTION_WORK_LIMIT } from "../src/facade/layered-scene-setup.js";
import type { LayeredFramePoint } from "../src/facade/layered-lattice-geometry.js";
import type { LayeredSceneLattice } from "../src/facade/layered-scene-signal.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const exposure = { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } as const;
/** A near card in front of the focus plane, a card at it and a back plane behind it. */
const scene: LayeredChartScene = { kind: "layered-chart", cards: [
  { distanceM: 1, centerU: -0.45, centerV: -0.05, width: 1.0, height: 0.5, scene: { preset: "slanted-edge" } },
  { distanceM: 2, centerU: 0.3, centerV: 0.1, width: 0.9, height: 0.6, scene: { preset: "siemens-star", cycles: 12 } }],
backPlane: { distanceM: 4, reflectance: 0.5 } };
/** A catalogue lens on a 36 × 24 mm frame of 96 × 64 sites (375 µm), so it keeps its full-frame focal length: blur radii of about 1 site. */
const catalogue = (lens: Record<string, unknown> = {}, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene, subjectDistanceM: 2,
  lens: { catalogue: "pv-50-1.8", fNumber: 1.8, focusDistanceM: 2, ...lens } as never, sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 80 },
  output: { width: 96, height: 64 }, exposure, ...extra });
/** An ideal 50 mm lens on 12 µm sites with camera rotation (0.2 rad/s of yaw moves the image about 7 sites in the exposure). */
const moving = (motion: Record<string, unknown>, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene, subjectDistanceM: 2,
  lens: { ideal: { focalLengthMm: 50, widestFNumber: 1.2 }, fNumber: 5.6, focusDistanceM: 2 } as never, sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80 },
  output: { width: 48, height: 32 }, exposure, motion: motion as never, ...extra });

type Electrons = { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } };
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as Electrons).photo.value.photoSignal.expectedGeneratedElectronCount;
}
const assumed = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): Record<string, unknown> => r.assumptions.find((a) => a.id === id)?.value as Record<string, unknown>;

/** The capture's environment at sampled sites, read through a layered provider of the view's lattice, against the view: the largest relative difference. */
async function captureAgainstView(request: SimulateCaptureOptions, sites = 40): Promise<number> {
  const capture = await simulateCapture(request), { signal, signalInput } = await simulateDisplayViewWithInternals(request, { width: 12, height: 8, samplesPerAxis: 1 });
  const lattice = (signal as unknown as { lattice: LayeredSceneLattice }).lattice;
  const native = capture.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, H = native.pixelHeight, width = request.output!.width!, height = request.output!.height!;
  // The plane's metres per frame unit (the framed width at the subject distance is that times the breathing scale, 1 / frameScale).
  const metresPerFrameUnit = capture.scene.framedWidthM / 2 * lattice.parts.geometry.frameScale;
  const base = createPlanarSceneRadianceProvider({ scene: { preset: "uniform" }, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: capture.scene.illuminant.illuminanceLux,
    distanceM: request.subjectDistanceM!, framedWidthM: 2 * metresPerFrameUnit, aspect: height / width, sceneId: "facade-scene", providerProfileId: "facade-provider" });
  const provider = createLayeredSceneProvider({ base, lattice, wavelengthsNm: signalInput.wavelengthsNm, nativeWidth: W, nativeHeight: H, outputWidth: width, distanceM: request.subjectDistanceM!,
    metresPerFrameUnit });
  let worst = 0;
  for (let k = 0; k < sites; k++) {
    const index = (k * 7919 + 13) % (W * H), x = index % W, y = Math.floor(index / W);
    const reference = electrons(capture.request.siteInput(index).environment, provider.evaluateRadiance.bind(provider));
    worst = Math.max(worst, Math.abs(signal.site(x, y) - reference) / reference);
  }
  return worst;
}

/** #751: the capture's RAW codes on the tabulated path and on the environment chain: the codes that differ, and whether the tabulated path ran. */
async function tabulatedAgainstChain(request: SimulateCaptureOptions): Promise<{ differing: number; tabulated: boolean }> {
  const fast = await simulateCapture(request);
  setTabulatedNativeRawEnabled(false);
  let chain: Awaited<ReturnType<typeof simulateCapture>>;
  try { chain = await simulateCapture(request); } finally { setTabulatedNativeRawEnabled(true); }
  let differing = 0;
  for (let i = 0; i < fast.raw.codes.length; i++) if (fast.raw.codes[i] !== chain.raw.codes[i]) differing++;
  return { differing, tabulated: assumed(fast, "raw.expectedSignal")?.scene === "layered-sum" && assumed(chain, "raw.expectedSignal") === undefined };
}

describe("layered chart scenes, 2.29.0 wiring (LW2)", () => {
  beforeAll(async () => { await prepareLayeredChartScenes(); });

  it("#741: a catalogue lens: each surface takes the lens's bokeh and the PSF per field zone; the capture's environment equals the view per site within 1e-9", async () => {
    const request = catalogue(), capture = await simulateCapture(request), layers = assumed(capture, "scene.layers");
    expect(layers.catalogue).toMatchObject({ kernels: "lens-bokeh", psfZoneSites: 2, breathingScale: 1 });
    expect((layers.kernelRadiusSites as number[])[0]).toBeGreaterThan(0);
    // The lattice holds the lens's PSF: the environment declares none, and the zones are lens.catalogue's fast method (96 sites > 64 zones).
    expect((capture.request.siteInput(0).environment as { psf: { kind: string } }).psf.kind).toBe("not-applied");
    expect(capture.diagnostics.fast.applied["lens.catalogue"]).toBe(true);
    expect(await captureAgainstView(request)).toBeLessThan(1e-9);
    // fast: false resolves the PSF per site (zones of one site) and the cat's eye of a fast normal lens per field zone.
    const exact = catalogue({}, { fast: false }), exactLayers = assumed(await simulateCapture(exact), "scene.layers");
    expect(exactLayers.catalogue).toMatchObject({ psfZoneSites: 1 });
    expect(exactLayers.catsEye).toBe(true);
    expect(await captureAgainstView(exact)).toBeLessThan(1e-9);
    // The fast method leaves the cat's eye out, labelled.
    expect(layers.catsEye).toBe(false);
    expect(assumed(capture, "fast.lens.catalogue.catsEye")).toEqual({ method: "bokeh-without-cats-eye" });
    // A region equals the whole view's pixels.
    const prepared = await prepareDisplayView(request, { gpu: "off" });
    const whole = await prepared.render({ width: 48, height: 32 }), part = await prepared.render({ width: 48, height: 32, region: { x: 7, y: 5, width: 11, height: 9 } });
    for (let j = 0; j < 9; j++) for (let i = 0; i < 11; i++) for (let k = 0; k < 3; k++)
      expect(part.image.samples[(j * 11 + i) * 3 + k]).toBe(whole.image.samples[((j + 5) * 48 + i + 7) * 3 + k]);
    // The flare is refused (its veil is formed from a single-plane scene's materials).
    await expect(simulateCapture(catalogue({ catalogue: { kind: "pv-50-1.8", flare: true } }))).rejects.toThrow(/does not support lens\.catalogue\.flare in 2\.29\.0/);
  }, scaledTimeout(240_000));

  it("#797: a catalogue fisheye is refused where it reads 75° or more off the axis, on a whole capture, a region and a view alike", async () => {
    for (const kind of ["pv-15-2.8-fisheye-pro", "pv-8-3.5-fisheye-pro"]) {
      const options = catalogue({ catalogue: kind, fNumber: 4 });
      await expect(simulateCapture(options), kind).rejects.toThrow(/render only within 75° of the axis/);
      await expect(simulateCapture({ ...options, output: { ...options.output, region: { x: 40, y: 24, width: 8, height: 8 } } } as SimulateCaptureOptions), kind)
        .rejects.toThrow(/render only within 75° of the axis/);
      await expect(simulateDisplayView(options, { width: 48, height: 32 }), kind).rejects.toThrow(/render only within 75° of the axis/);
    }
  }, scaledTimeout(120_000));

  it("#748: with lens.focusScatter every surface's blur and kernel are those of a request focused at the sampled focus; each blur is the defocus circle there", async () => {
    const scattered = catalogue({ focusScatter: { seed: 7, shotIndex: 2 } }), a = await simulateCapture(scattered);
    const sampled = assumed(a, "lens.focusScatter").focusDistanceM as number, f = assumed(a, "lens.catalogue").focalLengthMm as number;
    expect(sampled).not.toBe(2);
    const b = await simulateCapture(catalogue({ focusDistanceM: sampled }));
    expect(a.scene.layers).toEqual(b.scene.layers);
    expect(assumed(a, "scene.layers")).toEqual(assumed(b, "scene.layers"));
    // The frame keeps the requested focus's framing (the facade's thin-lens framing, as on the single-plane path), so the images differ only by that scale.
    let codes = 0;
    for (let i = 0; i < a.image.samples.length; i++) codes = Math.max(codes, Math.abs(a.image.samples[i]! - b.image.samples[i]!));
    expect(codes).toBeGreaterThan(0);
    expect(a.scene.framedWidthM).toBe((await simulateCapture(catalogue())).scene.framedWidthM);
    for (const layer of a.scene.layers!) {
      const c = calculateDefocusCircle({ focalLengthMm: f, aperture: 1.8, focusDistanceM: sampled, subjectDistanceM: layer.distanceM }).value.diameterMm * 1000 / 375;
      expect(Math.abs(layer.defocusDiameterSites - c)).toBeLessThanOrEqual(1e-12 * Math.max(1, c));
    }
  }, scaledTimeout(120_000));

  it("#748: with lens.catalogue.breathing a card larger than the frame equals the single-plane render within 1e-9, and a card edge moves by the predicted sites", async () => {
    // Close focus, where the PV 50 1.8 breathes most; one card in focus, larger than the frame (alone it is the single-plane material scene of its
    // print; with a back plane behind it the layered sum runs, and every site sees the card).
    // The exact method on both (the single-plane fast view takes the uniform-window field factor, #655).
    const near = { fast: false, subjectDistanceM: 0.5, lens: { catalogue: { kind: "pv-50-1.8", breathing: true }, fNumber: 4, focusDistanceM: 0.5 } as never, sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 80 },
      output: { width: 96, height: 64 }, exposure };
    const card = { distanceM: 0.5, centerU: 0, centerV: 0, width: 2.6, height: 1.8, scene: { preset: "siemens-star", cycles: 16 } } as const;
    const single = await simulateDisplayViewWithInternals({ ...near, scene: { kind: "layered-chart", cards: [card] } }, { width: 24, height: 16, samplesPerAxis: 1 });
    const layered = await simulateDisplayViewWithInternals({ ...near, scene: { kind: "layered-chart", cards: [card], backPlane: { distanceM: 2, reflectance: 0.5 } } }, { width: 24, height: 16, samplesPerAxis: 1 });
    const scale = (assumed(layered.result, "scene.layers").catalogue as { breathingScale: number }).breathingScale;
    expect(scale).toBeLessThan(0.99);
    expect((layered.signal as unknown as { lattice: LayeredSceneLattice }).lattice.parts.geometry.frameScale).toBeCloseTo(1 / scale, 12);
    let worst = 0;
    const W = 98, H = 66;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const a = single.signal.site(x, y), b = layered.signal.site(x, y);
      worst = Math.max(worst, Math.abs(a - b) / Math.abs(a));
    }
    expect(worst).toBeLessThan(1e-9);
    // A dark card's right edge at u0 = −0.7 on the centre row, on a bright plane: its half-way crossing (red sites of one row) moves by
    // u0·(w/2)·(1/k − 1) sites (w the output width, k the breathing scale: the edge is where the lens map's point is u0 / k), within one site.
    const u0 = -0.7, edgeScene: LayeredChartScene = { kind: "layered-chart", cards: [{ distanceM: 0.5, centerU: u0 - 0.15, centerV: 0, width: 0.3, height: 1, scene: { preset: "uniform", reflectance: 0.05 } }],
      backPlane: { distanceM: 0.6, reflectance: 0.9 } };
    const crossing = async (breathing: boolean): Promise<number> => {
      const v = await simulateDisplayViewWithInternals({ ...near, lens: { catalogue: { kind: "pv-50-1.8", breathing }, fNumber: 4, focusDistanceM: 0.5 } as never, scene: edgeScene },
        { width: 24, height: 16, samplesPerAxis: 1 });
      const xs = Array.from({ length: 16 }, (_, i) => 6 + 2 * i), values = xs.map((x) => v.signal.site(x, 32)), half = (values[0]! + values[15]!) / 2;
      for (let i = 0; i < 15; i++) if ((values[i]! - half) * (values[i + 1]! - half) <= 0) return xs[i]! + 2 * (half - values[i]!) / (values[i + 1]! - values[i]!);
      return NaN;
    };
    const moved = await crossing(true) - await crossing(false), predicted = u0 * 48 * (1 / scale - 1);
    expect(Math.abs(moved - predicted)).toBeLessThan(1);
    expect(Math.abs(predicted)).toBeGreaterThan(0.5);
  }, scaledTimeout(240_000));

  it("#746: camera rotation, global and rolling: the capture's environment equals the view per site within 1e-9; the midpoints are the flat scenes'", async () => {
    for (const motion of [{ angularVelocityRadPerSec: { yaw: 0.2 } }, { angularVelocityRadPerSec: { yaw: 0.2, pitch: 0.05, roll: 0.3 }, shutter: "rolling" }, { handheld: { seed: 3 } }]) {
      const request = moving(motion), name = JSON.stringify(motion);
      expect(await captureAgainstView(request), name).toBeLessThan(1e-9);
      const layers = assumed(await simulateCapture(request), "scene.layers");
      expect(layers.motion, name).toEqual({ temporalMidpoints: 8, shutter: "shutter" in motion ? "rolling-every-row" : "global", maximumWork: LAYERED_MOTION_WORK_LIMIT });
    }
    // fast: false takes 16 midpoints, as on flat scenes; the estimate counts them.
    const exact = moving({ angularVelocityRadPerSec: { yaw: 0.2 } }, { fast: false });
    expect((assumed(await simulateCapture(exact), "scene.layers").motion as { temporalMidpoints: number }).temporalMidpoints).toBe(16);
    const prepared = await prepareDisplayView(exact, { gpu: "off" });
    expect(estimateDisplayViewRender(prepared, { width: 12, height: 8 }).signal.temporalMidpoints).toBe(16);
    // A moving camera does not take the GPU passes, nor does a lens map.
    expect(preparedDisplayViewParts(prepared, "test")[0].gpuRequest.layeredGpu).toBeUndefined();
    // A moving subject stays refused.
    await expect(simulateCapture(moving({ subject: { velocityMPerSec: { x: 0.1 } } }))).rejects.toThrow(/does not support motion\.subject in 2\.29\.0: which surface moves is not defined by the request/);
  }, scaledTimeout(240_000));

  it("#746: work above 2²⁴ layered sums is refused before any lattice is built, with the numbers; a region of the frame renders", async () => {
    const big = moving({ angularVelocityRadPerSec: { yaw: 0.2 } }, { output: { width: 2048, height: 1366 } });
    await expect(simulateCapture(big)).rejects.toThrow(/reads \d+ sites × 8 midpoints = \d+, above the bound of 16777216 \(2²⁴/);
    await expect(simulateDisplayView(big, { width: 32, height: 21 })).rejects.toThrow(/above the bound of 16777216/);
    // A small region of the same frame (its footprint and reach) is within the bound.
    const part = await simulateDisplayView(big, { width: 2048, height: 1366, region: { x: 1000, y: 600, width: 16, height: 12 } });
    expect(part.image.samples.length).toBe(16 * 12 * 3);
    expect(LAYERED_MOTION_WORK_LIMIT).toBe(2 ** 24);
  }, scaledTimeout(120_000));

  it("#750: a view on the planar map renders on the GPU through the layered passes, within one code of the CPU; through a lens it does not ask", async () => {
    const planar = { ...moving({}), motion: undefined } as unknown as SimulateCaptureOptions;
    const prepared = await prepareDisplayView(planar, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
    try {
      expect(preparedDisplayViewParts(prepared, "test")[0].gpuRequest.layeredGpu).toBeTypeOf("function");
      const on = await prepared.render({ width: 24, height: 16 }), off = await simulateDisplayView(planar, { width: 24, height: 16 });
      expect(on.diagnostics.fast.execution.backend).toBe("webgpu-f32");
      for (let i = 0; i < off.image.samples.length; i++) expect(Math.abs(on.image.samples[i]! - off.image.samples[i]!)).toBeLessThanOrEqual(1);
    } finally { prepared.dispose(); }
    const lensed = await prepareDisplayView(catalogue(), { gpu: "off" });
    expect(preparedDisplayViewParts(lensed, "test")[0].gpuRequest.layeredGpu).toBeUndefined();
  }, scaledTimeout(180_000));

  it("#751: a layered capture takes the tabulated native RAW path; its RAW equals the environment chain's code for code; a region equals the whole frame", async () => {
    for (const request of [{ ...moving({}), motion: undefined } as unknown as SimulateCaptureOptions, moving({ angularVelocityRadPerSec: { yaw: 0.2 }, shutter: "rolling" }), catalogue()]) {
      const { differing, tabulated } = await tabulatedAgainstChain(request);
      expect(tabulated).toBe(true);
      expect(differing).toBe(0);
    }
    const request = catalogue(), whole = await simulateCapture(request), part = await simulateCapture({ ...request, output: { ...request.output, region: { x: 20, y: 10, width: 24, height: 16 } } } as SimulateCaptureOptions);
    const W = 98, nr = part.region!.nativeRect;
    for (let j = 0; j < nr.height; j++) for (let i = 0; i < nr.width; i++) expect(part.raw.codes[j * nr.width + i]).toBe(whole.raw.codes[(nr.y + j) * W + nr.x + i]);
  }, scaledTimeout(240_000));

  it("the view's pilot maps its planar point through the lens map once", async () => {
    const request = catalogue(), { signal } = await simulateDisplayViewWithInternals(request, { width: 12, height: 8, samplesPerAxis: 1 });
    const lattice = (signal as unknown as { lattice: LayeredSceneLattice }).lattice, geometry = lattice.parts.geometry, at: LayeredFramePoint = { u: 0, v: 0, factor: 1 };
    for (const [u, v] of [[-0.9, 0.5], [-0.45, -0.05], [0.31, 0.12], [0.8, -0.6]] as const) {
      const p = geometry.rasterFramePoint(u, v, at), chief = lattice.chiefSurface(p.u, p.v);
      expect(signal.pilot(u, v)).toBe(chief.surface * 65536 + chief.material);
    }
  }, scaledTimeout(60_000));
});
