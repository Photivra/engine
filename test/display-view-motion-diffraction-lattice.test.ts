// SPDX-License-Identifier: Apache-2.0
/**
 * #767: the display view with camera motion or a moving subject, `lens.diffraction`, the four-spot filter and a 2 × 2 box. The view's
 * lens signal (display-view-lens-signal.ts) already sums each site's kernel taps on the site lattice; it was refused by the capture's
 * per-tap count. Since #767 the capture's lattice flag (#761) also holds for a view, so the view counts its queries as the capture does,
 * without the taps, and reports `execution: "image-space-convolution"` where the taps pass 100000.
 */
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ calls: [] as { input: unknown; provider: unknown }[] }));
vi.mock("../src/facade/defocus-image-space-provider.js", async (importOriginal): Promise<typeof import("../src/facade/defocus-image-space-provider.js")> => {
  const actual = await importOriginal<typeof import("../src/facade/defocus-image-space-provider.js")>();
  return { ...actual, createDefocusImageSpaceProvider: (input): ReturnType<typeof actual.createDefocusImageSpaceProvider> => { const provider = actual.createDefocusImageSpaceProvider(input); captured.calls.push({ input, provider }); return provider; } };
});

import { calculateEnvironmentSensorPhotoSignal, estimateDisplayViewRender, prepareDisplayView, simulateCapture, simulateDisplayView, type PlanarSceneRadianceProvider,
  type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const electrons = (environment: unknown, evaluateRadiance: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never)
  .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
const filter = { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } as const;
type Request = { fNumber?: number; pitch?: number; shutterSeconds?: number; motion?: SimulateCaptureOptions["motion"]; lens?: object; sensor?: object; output?: object; scene?: string;
  width?: number; height?: number; fast?: boolean };
const request = (o: Request): SimulateCaptureOptions => ({
  scene: { preset: o.scene ?? "slanted-edge" }, subjectDistanceM: 2, lens: { prime: 50, fNumber: o.fNumber ?? 8, diffraction: "circular-aperture", ...o.lens },
  sensor: { pixelPitchMicrometers: o.pitch ?? 6, ...filter, ...o.sensor }, exposure: { mode: "manual", iso: 100, shutterSeconds: o.shutterSeconds ?? 1 / 15 },
  output: { width: o.width ?? 20, height: o.height ?? 14, ...o.output }, ...(o.motion ? { motion: o.motion } : {}), ...(o.fast === false ? { fast: false } : {}) } as SimulateCaptureOptions);
const yaw = { angularVelocityRadPerSec: { yaw: 0.02 } }, subject = { subject: { velocityMPerSec: { x: 0.5 } } }, handheld = { handheld: { seed: 7 } };
const defocus = { focusDistanceM: 1.8, defocus: { model: "geometric-disc" } };
type Assumed = { assumptions: readonly { id: string; value: unknown }[] };
const execution = (r: Assumed): string => (r.assumptions.find((a) => a.id === "lens.diffraction")!.value as { execution: string }).execution;

describe("the display view with motion, lens.diffraction and the anti-aliasing filter (#767)", () => {
  it("gives the capture's expected electrons per site within 1e-9 (every fifth site, fast: false)", async () => {
    const cases: [string, Request][] = [
      ["yaw 1/15 s", { motion: yaw }],
      ["hand shake", { motion: handheld }],
      ["subject f/8, 4 µm", { motion: subject, pitch: 4 }],
      ["subject f/16, 4 µm", { motion: subject, pitch: 4, fNumber: 16 }],
      ["yaw, dead leaves", { motion: yaw, scene: "dead-leaves" }],
      ["rolling yaw 1/60 s", { motion: { ...yaw, shutter: "rolling" }, shutterSeconds: 1 / 60 }],
      ["yaw, lens.defocus", { motion: yaw, lens: defocus }]];
    for (const [name, o] of cases) {
      const options = request({ ...o, fast: false });
      captured.calls.length = 0;
      const capture = await simulateCapture(options);
      // The capture's image-space provider: diffraction on the site lattice (#761), or diffraction ⊛ the disc with lens.defocus (#548).
      const { provider } = captured.calls.at(-1) as { provider: PlanarSceneRadianceProvider }, evaluate = provider.evaluateRadiance.bind(provider);
      const { signal } = await simulateDisplayViewWithInternals(options, { width: 10, height: 7, samplesPerAxis: 1 });
      const native = capture.plan.exposure.geometry.nativeRaster;
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i += 5) {
        const reference = electrons(capture.request.siteInput(i).environment, evaluate);
        largest = Math.max(largest, Math.abs(signal.site(i % native.pixelWidth, Math.floor(i / native.pixelWidth)) - reference) / reference);
      }
      expect(largest, name).toBeLessThan(1e-9);
    }
  }, scaledTimeout(240_000));

  it("matches the box-downsized capture: camera yaw and a moving subject at 1/60 s", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    for (const motion of [yaw, subject]) {
      const options = request({ motion, pitch: 3, shutterSeconds: 1 / 60, width: 96, height: 64, fast: false });
      const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
      const { internals } = await simulateDisplayViewWithInternals(options, { width: 12, height: 8, samplesPerAxis: 16 });
      let sq = 0, max = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) {
        let reference = 0;
        for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 96 + x) * 3 + k]!) / 64;
        const difference = encode8(internals.expected[(j * 12 + i) * 3 + k]!) - encode8(reference);
        sq += difference * difference; max = Math.max(max, Math.abs(difference));
      }
      // The thresholds of test/display-view-lens.test.ts ("matches the box-downsized capture"); the reference keeps its own noise.
      expect(Math.sqrt(sq / (8 * 12 * 3))).toBeLessThan(0.6);
      expect(max).toBeLessThan(3);
    }
  }, scaledTimeout(120_000));

  it("is region-identical and the same when prepared: yaw, a moving subject and rolling yaw, fast and full", async () => {
    for (const fast of [true, false]) for (const o of [{ motion: yaw }, { motion: subject }, { motion: { ...yaw, shutter: "rolling" as const }, shutterSeconds: 1 / 60 }]) {
      const options = request({ ...o, width: 48, height: 32, fast }), whole = await simulateDisplayView(options, { width: 16, height: 12 }), prepared = await prepareDisplayView(options);
      try {
        const part = await prepared.render({ width: 16, height: 12, region: { x: 5, y: 3, width: 6, height: 5 } }), expected: number[] = [];
        for (let y = 3; y < 8; y++) for (let x = 5 * 3; x < 11 * 3; x++) expected.push(whole.image.samples[y * 16 * 3 + x]!);
        expect(Array.from(part.image.samples)).toEqual(expected);
        expect(Array.from((await prepared.render({ width: 16, height: 12 })).image.samples)).toEqual(Array.from(whole.image.samples));
      } finally { prepared.dispose(); }
    }
  }, scaledTimeout(120_000));

  it("renders each combination, fast and full, on the CPU reference, with the capture's execution label", async () => {
    const vignetting = { vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } } };
    const cases: [string, Request][] = [
      ["yaw", { motion: yaw }], ["hand shake", { motion: handheld }], ["moving subject", { motion: subject }], ["panned subject", { motion: { ...yaw, ...subject } }],
      ["rolling yaw", { motion: { ...yaw, shutter: "rolling" }, shutterSeconds: 1 / 60 }], ["yaw, lens.defocus", { motion: yaw, lens: defocus }],
      ["yaw, AHD", { motion: yaw, output: { demosaic: "ahd" } }], ["still, vignetting, f/16 on 4 µm", { pitch: 4, fNumber: 16, lens: vignetting }]];
    const labels: string[] = [];
    for (const fast of [true, false]) for (const [name, o] of cases) {
      const prepared = await prepareDisplayView(request({ ...o, width: 48, height: 32, fast }));
      try {
        const s = estimateDisplayViewRender(prepared, { width: 24, height: 16 }).signal, result = await prepared.render({ width: 24, height: 16 });
        expect(result.image.samples.length, name).toBe(24 * 16 * 3);
        expect(result.diagnostics.fast.execution.backend, name).toBe("cpu-reference");
        // Temporal samples × spectral nodes × filter spots × box nodes × taps.
        const label = execution(result);
        expect(label, name).toBe(s.queryOffsets * s.spectralNodes * s.temporalMidpoints * s.tapsPerSite > 1e5 ? "image-space-convolution" : "environment-psf-quadrature");
        labels.push(label);
      } finally { prepared.dispose(); }
    }
    // Under 100000 taps on a fast request only: the moving subject (3 midpoints) and the still camera (one instant).
    expect(labels.filter((l) => l === "environment-psf-quadrature").length).toBe(2);
  }, scaledTimeout(120_000));

  it("keeps the refusals: a catalogue lens with motion and the filter, motion.subject under a rolling shutter or rotating, and a count over the bound without the taps", async () => {
    const view = { width: 24, height: 16 }, catalogue = { ...request({ motion: yaw, width: 48, height: 32, fast: false }), lens: { catalogue: "pv-50-1.8", fNumber: 8 } } as SimulateCaptureOptions;
    const catalogueText = "These options need 435456 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 16 × 21 × 1 × 4 × 4 × 81)";
    await expect(simulateCapture(catalogue)).rejects.toThrow(catalogueText);
    await expect(simulateDisplayView(catalogue, view)).rejects.toThrow(catalogueText);
    const sideways = /^simulateDisplayView does not support motion.subject with a rolling shutter or angularVelocityRadPerSec/u;
    await expect(simulateDisplayView(request({ motion: { ...subject, shutter: "rolling" }, width: 48, height: 32 }), view)).rejects.toThrow(sideways);
    await expect(simulateDisplayView(request({ motion: { subject: { angularVelocityRadPerSec: 1 } }, width: 48, height: 32 }), view)).rejects.toThrow(sideways);
    // 128 temporal samples at a 5 nm step: the same sentence for the capture and the view, the taps' factor 1.
    const count = request({ motion: yaw, sensor: { temporalSampleCount: 128, spectralStepNanometers: 5 }, width: 48, height: 32 });
    const countText = "These options need 165888 scene queries per site (temporal samples × spectral nodes × pupil rays × filter spots × pixel-aperture nodes × PSF taps: 128 × 81 × 1 × 4 × 4 × 1); the environment admits at most 100000.";
    await expect(simulateCapture(count)).rejects.toThrow(countText);
    await expect(simulateDisplayView(count, view)).rejects.toThrow(countText);
  }, scaledTimeout(60_000));

  it("estimates the render: taps at 16 midpoints, and site counts that bracket the render's diagnostics", async () => {
    const prepared = await prepareDisplayView(request({ motion: yaw, width: 48, height: 32, fast: false })), view = { width: 24, height: 16 };
    try {
      const estimate = estimateDisplayViewRender(prepared, view), d = (await prepared.render(view)).diagnostics;
      expect(estimate.signal.method).toBe("taps");
      expect(estimate.signal.temporalMidpoints).toBe(16);
      expect(d.sampleCount).toBeGreaterThanOrEqual(estimate.sampleCount.minimum);
      expect(d.sampleCount).toBeLessThanOrEqual(estimate.sampleCount.maximum);
      expect(d.siteEvaluations).toBeGreaterThanOrEqual(estimate.siteEvaluations.minimum);
      expect(d.siteEvaluations).toBeLessThanOrEqual(estimate.siteEvaluations.maximum);
    } finally { prepared.dispose(); }
  }, scaledTimeout(60_000));
});
