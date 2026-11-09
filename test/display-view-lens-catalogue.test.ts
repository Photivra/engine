// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, GENERIC_LENS_CATALOGUE, prepareDisplayView, resolveGenericLens, simulateCapture, simulateDisplayView,
  type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { DISPLAY_VIEW_LENS_PSF_ZONES } from "../src/facade/display-view-lens-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #569: the display view with lens.catalogue (src/facade/display-view-lens-signal.ts, createDisplayViewLensPsf). As for #563
 * (test/display-view-lens.test.ts), the reference is the capture's own environment record of each site (its catalogue PSF, resolved at
 * the site's own point by the environment PSF quadrature, its distortion, projection and vignetting), evaluated with the capture's scene.
 *
 * Tolerances. On frames of at most DISPLAY_VIEW_LENS_PSF_ZONES sites per side every zone is one site, so each site reads the PSF the
 * capture resolves at its centre: agreement to 1e-12 relative (rounding) with the point aperture. With the 2 × 2 box and the four-spot
 * filter the capture resolves the PSF at each query's own point, a fraction of a site away (2.5e-3 relative at most in the case below, out of focus). On a whole
 * 6 µm full frame (94-site zones) the zone approximation leaves at most 1 % per site and 3e-4 on average over the sampled sites
 * (measured: 0.66 % and 1.2e-4 at most over the lenses below, at dead-leaves edges, where the PSF's change matters most).
 */

const exposure = { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } as const;

/** Expected photo electrons of one site's environment record with an evaluator (the environment chain, noise-free). */
function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}
/** The capture's scene as a provider; like the capture's for a catalogue fisheye, a ray at or beyond 90° sees zero radiance. */
function sceneEvaluator(options: SimulateCaptureOptions, r: SimulateCaptureResult): (request: { target: { outgoingDirectionUnitVector: { x: number; y: number; z: number } } }) => unknown {
  const provider = createPlanarSceneRadianceProvider({ scene: options.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
    distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
  return (request) => {
    if (-request.target.outgoingDirectionUnitVector.z > 0) return provider.evaluateRadiance(request as never);
    const result = provider.evaluateRadiance({ ...request, target: { ...request.target, outgoingDirectionUnitVector: { x: 0, y: 0, z: -1 } } } as never);
    return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: 0 };
  };
}
type Signal = Awaited<ReturnType<typeof simulateDisplayViewWithInternals>>["signal"];
/**
 * Relative differences between the view's site values and the reference at `count` sites spread over the native raster (its corners and
 * centre included), or every site (count undefined). The capture may be a region capture: its site records are the whole frame's.
 */
function differences(capture: SimulateCaptureResult, signal: Signal, evaluate: unknown, pitch: number, count?: number): { largest: number; mean: number } {
  const area = (capture.request.siteInput(0).environment as unknown as { sensor: { spatialSampling: { imagingArea: { widthMm: number; heightMm: number } } } }).sensor.spatialSampling.imagingArea;
  const W = Math.round(area.widthMm * 1000 / pitch), H = Math.round(area.heightMm * 1000 / pitch), sites: [number, number][] = [];
  if (count === undefined) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sites.push([x, y]);
  else {
    sites.push([0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, H >> 1]);
    for (let k = 0; sites.length < count; k++) sites.push([(k * 7919 + 13) % W, (k * 3571 + 7) % H]);
  }
  let largest = 0, sum = 0;
  for (const [x, y] of sites) {
    const reference = electrons(capture.request.siteInput(y * W + x).environment, evaluate), value = signal.site(x, y);
    const d = reference === 0 ? (value === 0 ? 0 : Infinity) : Math.abs(value - reference) / reference;
    largest = Math.max(largest, d); sum += d;
  }
  return { largest, mean: sum / sites.length };
}
/** A full frame (36 × 24 mm) of `pitch` µm and its capture of a 2 × 2 region (whose site records cover the whole frame). */
const fullFrame = (pitch: number): NonNullable<SimulateCaptureOptions["output"]> => ({ width: Math.round(36000 / pitch), height: Math.round(24000 / pitch), maximumPixels: 2 ** 27 });

describe("display view with lens.catalogue (#569)", () => {
  it("one-site zones: every site's expected electrons are the capture's PSF quadrature's (coma, lateral colour, fisheyes, radiance scenes)", async () => {
    expect(DISPLAY_VIEW_LENS_PSF_ZONES).toBe(64);
    // 60 × 40 sites of 1.5 µm: the catalogue lens scaled to that frame, kernels of radius 3–10 sites (the profile's orientation matters).
    const small = { output: { width: 60, height: 40 }, sensor: { pixelPitchMicrometers: 1.5, spectralStepNanometers: 80 }, subjectDistanceM: 3, exposure };
    const rings = { kind: "reflectance-function", sceneId: "rings", evaluate: (p: { u: number; v: number }): number => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) } as const;
    const cases: [string, SimulateCaptureOptions][] = [
      ["PV 50 1.2 Pro wide open", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-50-1.2-pro", fNumber: 1.2 } }],
      ["PV 8 3.5 Fisheye Pro (black outside its 180° circle)", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-8-3.5-fisheye-pro", fNumber: 3.5 } }],
      ["PV 15 2.8 Fisheye Pro", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-15-2.8-fisheye-pro", fNumber: 2.8 } }],
      ["PV 50 1.8 on a radiance scene", { ...small, scene: rings, lens: { catalogue: "pv-50-1.8", fNumber: 1.8 } } as SimulateCaptureOptions]
    ];
    for (const [name, options] of cases) {
      const capture = await simulateCapture(options), { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
      const lensPsf = result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number; kernelRadiusSites: number };
      expect(lensPsf.zoneSites, name).toBe(1);
      expect(differences(capture, signal, sceneEvaluator(options, capture), 1.5, 400).largest, name).toBeLessThan(1e-12);
      expect(result.diagnostics.fast.execution.backend).toBe("cpu-reference");
    }
  }, scaledTimeout(240_000));

  it("one-site zones with the box aperture, the four-spot filter, AHD, lens.defocus and lens.focusScatter: within 5e-3 of the capture", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: { width: 60, height: 40, demosaic: "ahd" }, subjectDistanceM: 3, exposure,
      sensor: { pixelPitchMicrometers: 1.5, spectralStepNanometers: 80, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } },
      lens: { catalogue: "pv-24-1.4-pro", fNumber: 2, focusDistanceM: 2.6, defocus: { model: "geometric-disc" }, focusScatter: { seed: 7 } } };
    const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
    const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
    // The view records the capture's resolved focus scatter and its disc folded into the lens's PSF.
    expect(result.assumptions.find((a) => a.id === "lens.focusScatter")!.value).toEqual(capture.assumptions.find((a) => a.id === "lens.focusScatter")!.value);
    expect((result.assumptions.find((a) => a.id === "lens.defocus")!.value as { execution: string }).execution).toBe("catalogue-lens-psf");
    // The capture resolves the PSF at each of the 16 query points, up to 0.75 sites from the centre the view resolves it at: 2.5e-3 at most here.
    expect(differences(capture, signal, sceneEvaluator(options, capture), 1.5, 300).largest).toBeLessThan(5e-3);
  }, scaledTimeout(240_000));

  it("a whole 6 µm full frame (94-site zones): within 1 % per site and 3e-4 on average of the capture", async () => {
    const cases: [string, number, number][] = [["pv-24-1.8", 1.8, 3], ["pv-16-2.8", 2.8, 3], ["pv-100-2.8-macro-pro", 22, 0.2], ["pv-8-3.5-fisheye-pro", 3.5, 3]];
    for (const [lensId, fNumber, subjectDistanceM] of cases) {
      const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: fullFrame(6), sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 }, subjectDistanceM, exposure,
        lens: { catalogue: lensId, fNumber } };
      const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
      const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 12, height: 8, samplesPerAxis: 1 });
      expect((result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number }).zoneSites).toBe(94);
      const d = differences(capture, signal, sceneEvaluator(options, capture), 6, 300);
      expect(d.largest, lensId).toBeLessThan(0.01);
      expect(d.mean, lensId).toBeLessThan(3e-4);
    }
  }, scaledTimeout(300_000));

  it("every one of the 30 lenses renders at its widest and narrowest f-number at its close focus, each site near the capture's", async () => {
    expect(GENERIC_LENS_CATALOGUE).toHaveLength(30);
    for (const lens of GENERIC_LENS_CATALOGUE) {
      const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
      for (const fNumber of [resolved.widestFNumber, resolved.narrowestFNumber]) {
        const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: fullFrame(12), sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80 },
          subjectDistanceM: resolved.minimumFocusDistanceM, exposure: { ...exposure, shutterSeconds: (fNumber / 8) ** 2 / 125 }, lens: { catalogue: lens.lensId, fNumber } };
        const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
        const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
        const name = lens.lensId + " f/" + fNumber;
        expect(result.exposure.settings.fNumber, name).toBe(fNumber);
        expect(result.scene.distanceM, name).toBe(resolved.minimumFocusDistanceM);
        expect(result.image.samples.every((v) => Number.isFinite(v)), name).toBe(true);
        expect(differences(capture, signal, sceneEvaluator(options, capture), 12, 12).largest, name).toBeLessThan(0.01);
      }
    }
  }, scaledTimeout(600_000));

  it("matches the box-downsized capture: an edge through the consumer 24 mm wide open, with lateral colour and vignetting", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2, lens: { catalogue: "pv-24-1.8", fNumber: 1.8 },
      sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 40 }, output: { width: 192, height: 128 }, exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } };
    const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
    const { internals, result } = await simulateDisplayViewWithInternals(options, { width: 24, height: 16, samplesPerAxis: 16 });
    expect((result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number }).zoneSites).toBe(4);
    let sq = 0, max = 0;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 24; i++) for (let k = 0; k < 3; k++) {
      let reference = 0;
      for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 192 + x) * 3 + k]!) / 64;
      const difference = encode8(internals.expected[(j * 24 + i) * 3 + k]!) - encode8(reference);
      sq += difference * difference; max = Math.max(max, Math.abs(difference));
    }
    // The thresholds of the rectilinear slanted-edge test (test/display-view.test.ts); the reference keeps its own noise.
    expect(Math.sqrt(sq / (16 * 24 * 3))).toBeLessThan(0.6);
    expect(max).toBeLessThan(3);
  }, scaledTimeout(240_000));

  it("regions equal the whole view, prepared renders equal simulateDisplayView, and the GPU modes fall back to the CPU, labelled", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 16 }, output: { width: 240, height: 160 }, sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
      subjectDistanceM: 3, exposure, lens: { catalogue: "pv-16-2.8", fNumber: 2.8 } };
    const view = { width: 60, height: 40 };
    const whole = await simulateDisplayView(options, view);
    expect(whole.assumptions.some((a) => a.id === "view.lensPsf")).toBe(true);
    const region = await simulateDisplayView(options, { ...view, region: { x: 13, y: 9, width: 20, height: 14 } });
    for (let y = 0; y < 14; y++) for (let x = 0; x < 20; x++) for (let k = 0; k < 3; k++)
      expect(region.image.samples[(y * 20 + x) * 3 + k]).toBe(whole.image.samples[((y + 9) * 60 + x + 13) * 3 + k]);
    const prepared = await prepareDisplayView(options, { gpu: "auto" });
    const rendered = await prepared.render(view);
    expect(Array.from(rendered.image.samples)).toEqual(Array.from(whole.image.samples));
    expect(rendered.diagnostics.fast.execution.backend).toBe("cpu-reference");
    expect(rendered.diagnostics.fast.execution.fallbackReason).toBe("unsupported-on-backend");
    prepared.dispose();
  }, scaledTimeout(240_000));

  it("refuses what the capture refuses: settings outside the lens's range and closer than its close focus", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: { width: 240, height: 160 }, sensor: { pixelPitchMicrometers: 6 }, subjectDistanceM: 3, exposure };
    await expect(simulateDisplayView({ ...options, lens: { catalogue: "pv-50-1.8", fNumber: 1.4 } }, { width: 12, height: 8 })).rejects.toThrow(/outside the PV 50 1.8 range/);
    await expect(simulateDisplayView({ ...options, subjectDistanceM: 0.05, lens: { catalogue: "pv-50-1.8", fNumber: 2 } }, { width: 12, height: 8 })).rejects.toThrow(/focuses no closer than/);
    await expect(simulateDisplayView({ ...options, lens: { catalogue: "pv-50-1.8", diffraction: "circular-aperture" } }, { width: 12, height: 8 })).rejects.toThrow(/cannot be combined with lens.diffraction/);
  }, scaledTimeout(60_000));
});
