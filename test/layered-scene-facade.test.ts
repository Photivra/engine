// SPDX-License-Identifier: Apache-2.0
/**
 * #652, layered chart scenes through the public API (chunk I2 of the 2.27.0 plan): test 1 (a single-card scene equals today's
 * single-plane render byte for byte) and test 4 (capture and view agree per site within 1e-9 relative; the box-downsized capture
 * against the view within the slanted-edge thresholds), the implied geometric disc, `result.scene.layers`, the fast and full
 * occlusion rows, the GPU label and the 2.27.0 refusals. The module tests are test/layered-scene-*.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, prepareDisplayView, prepareLayeredChartScenes, resolveLayeredChartPreset, simulateCapture, simulateDisplayView,
  simulateIdealReference, LAYERED_CHART_LIMITS, type LayeredChartScene, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createLayeredSceneProvider } from "../src/facade/layered-scene-provider.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const exposure = { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } as const;
/** A slanted-edge card in front of the focus plane over the left of the frame, a Siemens-star card behind it, and a back plane. */
const scene: LayeredChartScene = { kind: "layered-chart", cards: [
  { distanceM: 1.6, centerU: -0.45, centerV: -0.05, width: 1.0, height: 0.5, scene: { preset: "slanted-edge" } },
  { distanceM: 2, centerU: 0.3, centerV: 0.1, width: 0.9, height: 0.6, scene: { preset: "siemens-star", cycles: 12 }, depthLabel: true }],
backPlane: { distanceM: 3, reflectance: 0.5 } };
const layeredOptions = (extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 2 },
  sensor: { pixelPitchMicrometers: 3, spectralStepNanometers: 40 }, output: { width: 96, height: 64 }, exposure, ...extra });

type Electrons = { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } };
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as Electrons).photo.value.photoSignal.expectedGeneratedElectronCount;
}

describe("layered chart scenes through the public API (#652)", () => {
  beforeAll(async () => { await prepareLayeredChartScenes(); await prepareLayeredChartScenes(); });
  it("test 1: a single card filling the frame renders today's single-plane bytes, with the geometric disc implied", async () => {
    const aspect = 24 / 32, base = { subjectDistanceM: 1.6, sensor: { pixelPitchMicrometers: 4, spectralStepNanometers: 40 }, output: { width: 32, height: 24 }, exposure } as const;
    const chart = { preset: "siemens-star", cycles: 8 } as const;
    const card = { kind: "layered-chart", cards: [{ distanceM: 1.6, centerU: 0, centerV: 0, width: 2, height: 2 * aspect, scene: chart }] } as const;
    for (const lens of [{ focalLengthMm: 50, fNumber: 4, focusDistanceM: 2 }, { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.6 }, { focalLengthMm: 50, fNumber: 5.6, focusDistanceM: 1.2, diffraction: "circular-aperture" as const }]) {
      const plain = { ...base, scene: chart, lens: { ...lens, defocus: { model: "geometric-disc" as const } } }, layered = { ...base, scene: card, lens };
      const [a, b] = [await simulateCapture(plain), await simulateCapture(layered)];
      expect(Array.from(b.image.samples)).toEqual(Array.from(a.image.samples));
      expect(b.scene.layers).toHaveLength(1);
      expect(b.scene.layers![0]).toMatchObject({ kind: "card", index: 0, distanceM: 1.6 });
      // One lens.defocus record: the single-plane path's own (the implied disc resolved at the card's distance).
      expect(b.assumptions.filter((x) => x.id === "lens.defocus")).toHaveLength(1);
      expect(b.assumptions.find((x) => x.id === "lens.defocus")!.kind).toBe("model");
      const view = { width: 8, height: 6 };
      expect(Array.from((await simulateDisplayView(layered, view)).image.samples)).toEqual(Array.from((await simulateDisplayView(plain, view)).image.samples));
      expect(Array.from((await simulateIdealReference(layered)).image.samples)).toEqual(Array.from((await simulateIdealReference(plain)).image.samples));
    }
  }, scaledTimeout(240_000));

  it("test 1: a single card elsewhere in the frame is its print as a material scene, defocused at the card's distance", async () => {
    const card: LayeredChartScene = { kind: "layered-chart", cards: [{ distanceM: 1.6, centerU: 0.2, centerV: 0, width: 1, height: 0.8, scene: { preset: "slanted-edge" } }] };
    const options = { scene: card, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 2 }, sensor: { spectralStepNanometers: 40 }, output: { width: 24, height: 16 }, exposure };
    const r = await simulateCapture(options);
    expect(r.scene.preset).toBe("layered-chart");
    const disc = r.assumptions.find((a) => a.id === "lens.defocus" && a.kind === "model")!.value as { subjectDistanceM: number; diameterSites: number };
    expect(disc.subjectDistanceM).toBe(1.6);
    expect(disc.diameterSites).toBeCloseTo(r.scene.layers![0]!.defocusDiameterSites, 12);
  }, scaledTimeout(60_000));

  it("test 4: capture and view agree per site within 1e-9 relative (pixel aperture, diffraction)", async () => {
    for (const extra of [{}, { lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 2, diffraction: "circular-aperture" as const } },
      { sensor: { pixelPitchMicrometers: 3, spectralStepNanometers: 40, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } } }]) {
      const options = layeredOptions({ output: { width: 48, height: 32 }, ...extra });
      const capture = await simulateCapture(options), { signal, signalInput } = await simulateDisplayViewWithInternals(options, { width: 12, height: 8, samplesPerAxis: 1 });
      const lattice = (signal as unknown as { lattice: Parameters<typeof createLayeredSceneProvider>[0]["lattice"] }).lattice;
      const native = capture.raw.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, H = native.pixelHeight;
      const box = (extra as { sensor?: { pixelAperture?: { samplesPerAxis: number } } }).sensor?.pixelAperture?.samplesPerAxis ?? 1;
      const nodes = Array.from({ length: box * box }, (_, i) => ({ x: (i % box + 0.5) / box - 0.5, y: (Math.floor(i / box) + 0.5) / box - 0.5 }));
      const base = createPlanarSceneRadianceProvider({ scene: { preset: "uniform" }, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: capture.scene.illuminant.illuminanceLux,
        distanceM: 2, framedWidthM: capture.scene.framedWidthM, aspect: 32 / 48, sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const provider = createLayeredSceneProvider({ base, lattice, wavelengthsNm: signalInput.wavelengthsNm, nativeWidth: W, nativeHeight: H, outputWidth: 48, distanceM: 2,
        metresPerFrameUnit: capture.scene.framedWidthM / 2, queryOffsetsSites: nodes });
      let worst = 0, edge = 0;
      for (let k = 0; k < 60; k++) {
        const index = (k * 7919 + 13) % (W * H), x = index % W, y = Math.floor(index / W);
        const reference = electrons(capture.request.siteInput(index).environment, provider.evaluateRadiance.bind(provider));
        worst = Math.max(worst, Math.abs(signal.site(x, y) - reference) / reference);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lattice.siteSurface(x, y, 1) < 0) edge++;
      expect(edge).toBeGreaterThan(20);
      expect(worst).toBeLessThan(1e-9);
    }
  }, scaledTimeout(240_000));

  it("test 4: the box-downsized capture matches the view within the slanted-edge thresholds", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    const options = layeredOptions({ output: { width: 192, height: 128 } });
    const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
    const { internals, result } = await simulateDisplayViewWithInternals(options, { width: 24, height: 16, samplesPerAxis: 16 });
    let sq = 0, max = 0;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) {
      let reference = 0;
      for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 192 + x) * 3 + k]!) / 64;
      const difference = encode8(internals.expected[(j * 24 + i) * 3 + k]!) - encode8(reference);
      sq += difference * difference; max = Math.max(max, Math.abs(difference));
    }
    expect(Math.sqrt(sq / (16 * 24 * 3))).toBeLessThan(0.6);
    expect(max).toBeLessThan(3);
    expect(result.scene.layers!.map((l) => l.kind)).toEqual(["card", "card", "back-plane"]);
  }, scaledTimeout(240_000));

  it("reports scene.layers and the occlusion rows: fast for the view and sRGB samples, full for exports, the ideal reference and fast: false", async () => {
    const rows = (r: { assumptions: readonly { id: string; value: unknown }[] }): unknown => (r.assumptions.find((a) => a.id === "scene.layers")!.value as { occlusionSamples: number }).occlusionSamples;
    const options = layeredOptions({ output: { width: 24, height: 16 } });
    const capture = await simulateCapture(options);
    expect(rows(capture)).toBe(4);
    // Several surfaces: the implied disc is recorded once, as the layered sum's default.
    expect(capture.assumptions.filter((a) => a.id === "lens.defocus").map((a) => a.kind)).toEqual(["default"]);
    expect(rows(await simulateCapture({ ...options, fast: false }))).toBe(16);
    expect(rows(await simulateCapture({ ...options, output: { ...options.output, format: "png" } }))).toBe(16);
    expect(rows(await simulateIdealReference(options))).toBe(16);
    expect(rows(await simulateDisplayView(options, { width: 12, height: 8 }))).toBe(4);
    const layers = capture.scene.layers!;
    expect(layers.map((l) => [l.kind, l.index, l.distanceM])).toEqual([["card", 0, 1.6], ["card", 1, 2], ["back-plane", -1, 3]]);
    expect(layers[1]).toMatchObject({ defocusDiameterSites: 0, signedBlurRadiusSites: 0, withinDepthOfField: true });
    expect(layers[0]!.signedBlurRadiusSites).toBeLessThan(0);
    expect(layers[2]!.signedBlurRadiusSites).toBeCloseTo(layers[2]!.defocusDiameterSites / 2, 12);
    expect(layers[0]!.withinDepthOfField).toBe(false);
  }, scaledTimeout(120_000));

  it("renders regions identical to the whole view, the preset with point lights and the cat's eye in the view, labelled on the CPU", async () => {
    const options = layeredOptions({ output: { width: 96, height: 64 } });
    const prepared = await prepareDisplayView(options, { gpu: "auto" });
    const whole = await prepared.render({ width: 24, height: 16 }), part = await prepared.render({ width: 24, height: 16, region: { x: 5, y: 3, width: 9, height: 7 } });
    for (let j = 0; j < 7; j++) for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++)
      expect(part.image.samples[(j * 9 + i) * 3 + k]).toBe(whole.image.samples[((j + 3) * 24 + i + 5) * 3 + k]);
    expect(whole.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
    // gpu-06 (#702): the reason names no release, which would be wrong in the next one.
    expect(whole.diagnostics.fast.execution.limitations.join(" ")).toMatch(/layered chart scenes render on the CPU \(#652\)/u);
    expect(whole.diagnostics.fast.execution.limitations.join(" ")).not.toMatch(/\b2\.\d+\.\d+\b/u);
    const preset = resolveLayeredChartPreset({ scale: "tabletop", cards: 3, focusDistanceM: 1, lens: { focalLengthMm: 50 }, aspect: 2 / 3 });
    const lit = await simulateDisplayView({ scene: preset, subjectDistanceM: 1, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1,
      defocus: { model: "geometric-disc", blades: { count: 6 }, catsEye: { apertures: [{ radiusMm: 9, shiftPerTanFieldMm: 40 }] } } },
    sensor: { spectralStepNanometers: 40 }, output: { width: 96, height: 64 }, exposure }, { width: 24, height: 16 });
    expect(lit.scene.layers).toHaveLength(4);
    expect((lit.assumptions.find((a) => a.id === "scene.layers")!.value as { catsEye: boolean }).catsEye).toBe(true);
  }, scaledTimeout(240_000));

  it("refuses what 2.27.0 does not render, with clear messages", async () => {
    const options = layeredOptions({ output: { width: 16, height: 12 } });
    const lens = options.lens!;
    const cases: [Partial<SimulateCaptureOptions>, RegExp][] = [
      [{ motion: { angularVelocityRadPerSec: { yaw: 0.1 } } }, /does not support motion\.angularVelocityRadPerSec in 2\.27\.0/],
      [{ motion: { subject: { velocityMPerSec: { x: 0.1 } } } }, /does not support motion\.subject/],
      [{ lens: { ...lens, projection: "fisheye-equidistant" } }, /lens\.projection other than "rectilinear"/],
      [{ lens: { ...lens, distortion: { kind: "radial", profile: { normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { k1: -0.1, k2: 0, k3: 0 } } } } }, /does not support lens\.distortion/],
      [{ lens: { ...lens, vignetting: { normalizationRadiusMm: 1, maximumNormalizedRadius: 1, coefficients: { r2: -0.2, r4: 0, r6: 0 } } } }, /does not support lens\.vignetting/],
      [{ lens: { ...lens, pupilSampling: { radialSamples: 2, angularSamples: 8 } } }, /does not support lens\.pupilSampling/],
      [{ lens: { catalogue: "pv-50-1.8", fNumber: 4 } }, /does not support lens\.catalogue/],
      [{ chartSize: { widthM: 0.5 } }, /does not support chartSize/],
      [{ illumination: { sources: [{ illuminant: { kind: "cie-a" }, illuminanceLux: 1000 }] } } as never, /does not support illumination \(mixed lighting\)/],
      [{ lens: { ...lens, diffraction: "circular-aperture", defocus: { model: "geometric-disc", catsEye: { apertures: [{ radiusMm: 9, shiftPerTanFieldMm: 40 }] } } } }, /catsEye cannot be combined with lens\.diffraction/],
      [{ lens: { ...lens, focusDistanceM: 10, defocus: { model: "geometric-disc", blades: { count: 7 } } }, sensor: { pixelPitchMicrometers: 1, spectralStepNanometers: 40 } },
        /kernel radius of \d+ sites; at card edges the layered sum takes at most 128 for a shaped kernel/]];
    // A caller PSF: the one a plain chart capture with diffraction resolves (a valid lens.psf, so the layered refusal is what fails).
    const psf = (await simulateCapture({ ...options, scene: { preset: "uniform", reflectance: 0.5 }, lens: { ...lens, diffraction: "circular-aperture" } })).request.diffraction!.psf;
    cases.push([{ lens: { ...lens, psf } } as never, /does not support lens\.psf in 2\.27\.0: a caller PSF declares its own defocus/]);
    for (const [extra, message] of cases) await expect(simulateCapture({ ...options, ...extra } as SimulateCaptureOptions), String(message)).rejects.toThrow(message);
    const crowded: LayeredChartScene = { ...scene, backPlane: { distanceM: 3, pointLights: { seed: 1, columns: 16, rows: 12, luminousIntensityCandela: 1 } } };
    await expect(simulateCapture({ ...options, scene: crowded })).rejects.toThrow(/two lights can fall in one site/);
    // A grid pitch above one site, but jitter 0.9 brings grid neighbours within one site of each other on both axes (measured before
    // the check: 6,000 lights in 5,923 distinct sites of the 240 × 160 frame), so one light of such a pair would be lost.
    const jittered: LayeredChartScene = { ...scene, backPlane: { distanceM: 3, pointLights: { seed: 1, columns: 100, rows: 60, jitter: 0.9, luminousIntensityCandela: 1 } } };
    for (const run of [simulateCapture({ ...options, output: { width: 240, height: 160 }, scene: jittered }), simulateDisplayView({ ...options, output: { width: 240, height: 160 }, scene: jittered }, { width: 24, height: 16 })])
      await expect(run).rejects.toThrow(/two lights can fall in one site \(closer than one site on both axes\), so one would be lost/);
    await expect(simulateDisplayView({ ...options, scene: { kind: "layered-chart", cards: [scene.cards[0]!] }, lens: { ...lens,
      defocus: { model: "geometric-disc", catsEye: { apertures: [{ radiusMm: 9, shiftPerTanFieldMm: 40 }] } } } }, { width: 8, height: 6 })).rejects.toThrow(/one card without a back plane/);
    expect(LAYERED_CHART_LIMITS.maximumCards).toBe(16);
  }, scaledTimeout(120_000));
});
