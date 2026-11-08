// SPDX-License-Identifier: Apache-2.0
/**
 * #492 step 2b: `lens.defocus` out of focus in the display view. The disc enters the expected-signal tables as a site
 * kernel (combined with each node's diffraction kernel when `lens.diffraction` is on), so the estimators run unchanged on
 * the blurred lattice signal.
 *
 * - Analytic: a straight edge blurred by a uniform disc has a closed-form edge-spread function (the circular-segment area
 *   fraction). The defocused view of a sharp edge is checked against the in-focus view of a scene whose reflectance is
 *   that closed form, at one and at several real pixels per display pixel.
 * - Against the capture's model: the defocused view against the in-focus view of the scene blurred by the disc on the
 *   site lattice beforehand, which is the radiance the capture's defocus gives each site query
 *   (`scripts/lib/display-view-defocus-cases.mjs`), with the #480 thresholds.
 * - Prepared views, limits, the GPU fallback, and the hash locks of the request without the option.
 */
import { describe, expect, it } from "vitest";
import { cielabOfXyz, deltaE2000 } from "../src/color/color-difference.ts";
import { resolveRgbColorSpace } from "../src/color/rgb-color-spaces.ts";
import { setDisplayViewGpuRendererFactory } from "../src/facade/display-view-gpu.ts";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.ts";
import { registerDisplayViewSpeedGpuRenderer } from "../src/gpu/display-view-speed-gpu.ts";
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.ts";
import { prepareDisplayView, simulateCapture, simulateDisplayView } from "../src/index.ts";
import { createAcceptanceMetrics, judge } from "../scripts/lib/display-view-acceptance.mjs";
import { DEFOCUS_CASES, defocusCaseRequests } from "../scripts/lib/display-view-defocus-cases.mjs";
import { createFakeGpu } from "./helpers/fake-webgpu.ts";
import { scaledTimeout } from "./helpers/test-timeout.ts";

const { compareExpectedImages } = createAcceptanceMetrics({ deltaE2000, cielabOfXyz, srgb: resolveRgbColorSpace("srgb").value });
const DEFOCUS = { model: "geometric-disc" };

/** Disc edge-spread function: the fraction of a disc of radius r beyond a line at signed distance t from its centre (circular-segment area). */
function discEdgeSpread(t, r) {
  if (t <= -r) return 0;
  if (t >= r) return 1;
  return 0.5 + (t * Math.sqrt(r * r - t * t) + r * r * Math.asin(t / r)) / (Math.PI * r * r);
}
const recorded = (result, id) => result.assumptions.find((a) => a.id === id).value;

describe("display view with lens.defocus (#492 step 2b)", () => {
  /*
   * An edge at angle θ through a site-cell boundary, 6 µm full frame, 50 mm f/2.8 and f/16, subject 2 m, focus 1.6 m.
   * Axis-aligned (θ = 0) on the cell boundary, the lattice blur is the closed form exactly at every site centre (each
   * kernel column is the disc's strip between two cell boundaries: test/defocus-disc-kernel.test.ts), so the two views
   * agree to rounding through the demosaic, development and both estimators. Slanted (θ = 5°), the lattice blur counts
   * each kernel cell the edge crosses on the side of its centre; the difference is at most the largest summed weight of
   * the crossed cells times the display swing between the two sides.
   * Measured (this change): θ = 0 within 7.3e-15 (linear) at 1, 3 and 8 real pixels per display pixel; θ = 5° at most
   * 0.14 (f/2.8, r = 9.6 sites), 0.34 (f/8) and 0.57 (f/16, r = 1.68) of that bound at 1:1, less at coarser scales.
   */
  it("blurs a straight edge into the disc's closed-form edge-spread function", async () => {
    const W = 6000, H = 4000, g = 2 / W, LO = 0.1, HI = 0.5;
    for (const fNumber of [2.8, 16]) for (const degrees of [0, 5]) {
      const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
      const distance = (p) => c * (p.u / g) + s * (-p.v / g);
      const base = { scene: { kind: "material-function", sceneId: "edge", materials: [LO, HI], materialAt: (p) => (distance(p) > 0 ? 1 : 0) },
        subjectDistanceM: 2, exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 125) * (fNumber / 8) ** 2 }, sensor: { pixelPitchMicrometers: 6 },
        output: { width: W, height: H, maximumPixels: W * H * 2 }, lens: { prime: 50, fNumber, focusDistanceM: 1.6 } };
      const lens = base.lens;
      for (const k of [1, 3, 8]) {
        const vw = W / k, vh = Math.round(H / k), rw = Math.ceil(48 / k), rh = Math.ceil(16 / k);
        const view = { width: vw, height: vh, region: { x: Math.floor((vw - rw) / 2), y: Math.floor((vh - rh) / 2), width: rw, height: rh } };
        const blurred = await simulateDisplayViewWithInternals({ ...base, lens: { ...lens, defocus: DEFOCUS } }, view);
        const r = recorded(blurred.result, "lens.defocus").diameterSites / 2;
        const closed = await simulateDisplayViewWithInternals({ ...base, scene: { kind: "reflectance-function", sceneId: "edge-esf", evaluate: (p) => LO + (HI - LO) * discEdgeSpread(distance(p), r) } }, view);
        expect(blurred.internals.estimation).toBe(closed.internals.estimation);
        let worst = 0;
        for (let i = 0; i < blurred.internals.expected.length; i++) worst = Math.max(worst, Math.abs(blurred.internals.expected[i] - closed.internals.expected[i]));
        if (degrees === 0) { expect(worst).toBeLessThan(1e-13); continue; }
        // The crossed-cell bound: the largest summed weight of the kernel cells a 5° line crosses, over the line's offsets.
        const kernel = createDefocusDiscSiteKernel(2 * r), R = kernel.radius, h = 0.5 * (c + s);
        let crossed = 0;
        for (let e = 0; e < 1; e += 0.05) {
          let sum = 0;
          for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) if (Math.abs(c * u + s * v - e) < h) sum += kernel.weights[(v + R) * kernel.width + u + R];
          crossed = Math.max(crossed, sum);
        }
        const flat = async (material) => (await simulateDisplayViewWithInternals({ ...base, scene: { ...base.scene, materialAt: () => material } },
          { width: vw, height: vh, region: { x: 0, y: 0, width: 1, height: 1 } })).internals.expected;
        const dark = await flat(0), light = await flat(1), swing = Math.max(...[0, 1, 2].map((ch) => light[ch] - dark[ch]));
        expect(worst).toBeGreaterThan(0);
        expect(worst).toBeLessThanOrEqual(crossed * swing);
      }
    }
  }, scaledTimeout(120_000));

  /*
   * A subset of `scripts/accept-display-view-defocus.mjs` (which runs all 24 cases at 1, 4 and 8 real pixels per display
   * pixel): both pitches, f/2.8 and f/16, front and back focus, Speed and Quality (diffraction combined with the disc).
   * The two views agree to rounding, far inside the #480 thresholds. Measured over all 72 renders of the script (96 × 64
   * blocks): ΔE2000 at most 6.6e-11 on the exact area mean and 1.6e-7 on the stratified estimate (the two scenes' pilot
   * grids can classify a pixel differently, which changes its sample count, not its expectation), |Δ|/σ at most 1.3e-7.
   */
  it("matches the in-focus view of the scene blurred by the capture's lattice convolution, within the #480 thresholds", async () => {
    const chosen = DEFOCUS_CASES.filter((c) => [0, 1, 10, 11, 12, 22].includes(c.id));
    for (const c of chosen) for (const k of c.quality ? [1, 8] : [1, 4, 8]) {
      const requests = defocusCaseRequests(c, { k, block: { width: 64, height: 48 } });
      const candidate = await simulateDisplayViewWithInternals(requests.candidate, requests.view);
      const disc = recorded(candidate.result, "lens.defocus"), viewDefocus = recorded(candidate.result, "view.defocus");
      expect(disc.diameterSites).toBeGreaterThan(1);
      expect(viewDefocus.defocusKernelRadiusSites).toBe(disc.kernelRadiusSites);
      const reference = await simulateDisplayViewWithInternals(requests.referenceFor(createDefocusDiscSiteKernel(disc.diameterSites)), requests.view);
      const { width, height } = requests.view.region;
      const m = compareExpectedImages({ width, height, reference: reference.internals.expected, candidate: candidate.internals.expected, referenceNoiseStd: reference.internals.noiseStd });
      expect(judge(m).pass, `case ${c.id} at 1:${k}`).toBe(true);
      expect(m.maxDeltaE).toBeLessThan(1e-6);
      expect(m.maxSigma).toBeLessThan(1e-6);
      expect(m.maxCode8).toBeLessThan(1e-6);
    }
  }, scaledTimeout(240_000));

  /*
   * The capture (#492 step 2a) applies the same per-node kernels as an object-space convolution, so the capture of the
   * sharp scene with the option and the capture of the scene blurred beforehand, at the same noise seed, give the same
   * RAW (the same expected electrons to rounding, so the same draws). With the display-view comparison above this closes
   * the chain: view with the option = view of the pre-blurred scene ≈ capture of it (#480) = capture with the option.
   */
  it("the defocused capture equals the capture of the scene blurred beforehand, at the same seed", async () => {
    const c = DEFOCUS_CASES.find((x) => x.pitch === "6" && x.fNumber === 8 && x.focusFactor === 0.8 && !x.quality);
    const requests = defocusCaseRequests(c, { k: 1, block: { width: 32, height: 24 } });
    const region = { x: requests.view.region.x, y: requests.view.region.y, width: 32, height: 24 };
    const withRegion = (options) => ({ ...options, output: { ...options.output, region } });
    const capture = await simulateCapture(withRegion(requests.candidate));
    const view = await simulateDisplayView(requests.candidate, requests.view);
    const kernel = createDefocusDiscSiteKernel(recorded(view, "lens.defocus").diameterSites);
    const reference = await simulateCapture(withRegion(requests.referenceFor(kernel)));
    let same = 0, largest = 0;
    for (let i = 0; i < capture.raw.codes.length; i++) { const d = Math.abs(capture.raw.codes[i] - reference.raw.codes[i]); if (d === 0) same++; largest = Math.max(largest, d); }
    // Measured: every code identical here and in 8 cases of scripts/accept-display-view-defocus.mjs --capture.
    expect(same / capture.raw.codes.length).toBeGreaterThanOrEqual(0.999);
    expect(largest).toBeLessThanOrEqual(1);
  }, scaledTimeout(120_000));

  it("prepared views cache the combined kernels: regions are byte-identical to the whole view and to simulateDisplayView", async () => {
    const options = { scene: { preset: "slanted-edge", angleDegrees: 5 }, subjectDistanceM: 2,
      lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 1.7, diffraction: "circular-aperture", defocus: DEFOCUS },
      sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" } }, output: { width: 240, height: 160, demosaic: "ahd" } };
    const view = { width: 80, height: 54 };
    const prepared = await prepareDisplayView(options);
    try {
      const whole = await prepared.render(view), direct = await simulateDisplayView(options, view);
      expect(Array.from(whole.image.samples)).toEqual(Array.from(direct.image.samples));
      expect(recorded(whole, "view.defocus")).toMatchObject({ kernel: "diffraction-convolved-with-disc", scientificStatus: "approximation" });
      for (const region of [{ x: 0, y: 0, width: 30, height: 20 }, { x: 31, y: 17, width: 40, height: 30 }, { x: 79, y: 53, width: 1, height: 1 }]) {
        const part = await prepared.render({ ...view, region });
        for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) for (let ch = 0; ch < 3; ch++)
          expect(part.image.samples[(y * region.width + x) * 3 + ch]).toBe(whole.image.samples[((region.y + y) * view.width + region.x + x) * 3 + ch]);
      }
      // The disc changes the view: the same request in focus differs.
      const sharp = await simulateDisplayView({ ...options, lens: { ...options.lens, focusDistanceM: 2 } }, view);
      expect(Array.from(sharp.image.samples)).not.toEqual(Array.from(whole.image.samples));
    } finally { prepared.dispose(); }
  }, scaledTimeout(60_000));

  it("combines the disc with each node's diffraction kernel by a full 2-D convolution of total radius R_diff + R_defocus", async () => {
    // The convolution itself: a unit tap is the identity, sums multiply, and the result is the separable product for separable inputs.
    const disc = createDefocusDiscSiteKernel(7.3), unit = Float64Array.of(1);
    expect(Array.from(convolveSiteKernels(unit, 0, disc.weights, disc.radius))).toEqual(Array.from(disc.weights));
    const a = Float64Array.from({ length: 9 }, (_, i) => [0.1, 0.2, 0.1][i % 3] * [0.25, 0.5, 0.25][Math.floor(i / 3)]);
    const b = Float64Array.from({ length: 25 }, (_, i) => [1, 2, 3, 2, 1][i % 5] * [0, 1, 1, 1, 0][Math.floor(i / 5)] / 27);
    const ab = convolveSiteKernels(a, 1, b, 2);
    expect(ab.length).toBe(49);
    expect(ab.reduce((sum, v) => sum + v, 0)).toBeCloseTo(a.reduce((x, v) => x + v, 0) * b.reduce((x, v) => x + v, 0), 14);
    // (a ∗ b)(0, 0) = Σ_s a(s)·b(−s): rows (0.25, 0.5, 0.25)·(1, 1, 1)/27·… computed directly.
    let centre = 0;
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) centre += a[(y + 1) * 3 + x + 1] * b[(-y + 2) * 5 + -x + 2];
    expect(ab[3 * 7 + 3]).toBeCloseTo(centre, 15);
    expect(() => convolveSiteKernels(a, 2, b, 2)).toThrow(/\(2R \+ 1\)²/u);
    // In the view: the expected-signal input carries one kernel per node of radius R_diff + R_defocus, each summing to that node's diffraction kernel's sum.
    const options = { scene: { preset: "slanted-edge" }, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 1.6, diffraction: "circular-aperture" },
      output: { width: 64, height: 48 } };
    const plain = await simulateDisplayViewWithInternals(options, { width: 32, height: 24 });
    const defocused = await simulateDisplayViewWithInternals({ ...options, lens: { ...options.lens, defocus: DEFOCUS } }, { width: 32, height: 24 });
    const d = recorded(defocused.result, "lens.defocus"), v = recorded(defocused.result, "view.defocus"), Rd = plain.signalInput.kernels.radius;
    expect(v).toMatchObject({ defocusKernelRadiusSites: d.kernelRadiusSites, diffractionKernelRadiusSites: Rd, kernelRadiusSites: Rd + d.kernelRadiusSites });
    expect(defocused.signalInput.kernels.radius).toBe(Rd + d.kernelRadiusSites);
    const discKernel = createDefocusDiscSiteKernel(d.diameterSites);
    defocused.signalInput.kernels.perNode.forEach((combined, n) => {
      expect(Array.from(combined)).toEqual(Array.from(convolveSiteKernels(plain.signalInput.kernels.perNode[n], Rd, discKernel.weights, discKernel.radius)));
    });
    // Without diffraction every node shares the disc itself, and the view leaves the environment's query points for the lattice.
    const speed = await simulateDisplayViewWithInternals({ ...options, lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 1.6, defocus: DEFOCUS } }, { width: 32, height: 24 });
    expect(speed.signalInput.kernels.radius).toBe(d.kernelRadiusSites);
    for (const k of speed.signalInput.kernels.perNode) expect(k).toBe(speed.signalInput.kernels.perNode[0]);
    expect(Array.from(speed.signalInput.kernels.perNode[0])).toEqual(Array.from(discKernel.weights));
    expect(speed.signalInput.queryPoint).toBeUndefined();
    expect(recorded(speed.result, "view.defocus")).toMatchObject({ kernel: "disc", diffractionKernelRadiusSites: null });
  }, scaledTimeout(60_000));

  /*
   * The combined radius may exceed the 64 columns the lattice rings keep beyond the raster (those points are looked up
   * directly): up to 32 + 64 = 96 sites, the two caps, as in the capture. Checked against the pre-blurred reference and
   * for region identity at a combined radius above 64; a disc past its own cap fails as in the capture.
   */
  it("takes a combined kernel radius above 64 sites, and refuses a disc past its own cap", async () => {
    const c = { pitch: "1.4", fNumber: 8, focusFactor: 0.6, quality: true };
    const requests = defocusCaseRequests(c, { k: 2, block: { width: 24, height: 16 } });
    const candidate = { ...requests.candidate, lens: { ...requests.candidate.lens, diffraction: { kind: "circular-aperture", kernelRadiusSamples: 32 } } };
    const view = await simulateDisplayViewWithInternals(candidate, requests.view);
    const radii = recorded(view.result, "view.defocus");
    expect(radii.diffractionKernelRadiusSites).toBe(32);
    expect(radii.kernelRadiusSites).toBeGreaterThan(64);
    const reference = requests.referenceFor(createDefocusDiscSiteKernel(recorded(view.result, "lens.defocus").diameterSites));
    const expected = await simulateDisplayViewWithInternals({ ...reference, lens: { ...reference.lens, diffraction: { kind: "circular-aperture", kernelRadiusSamples: 32 } } }, requests.view);
    const { width, height } = requests.view.region;
    const m = compareExpectedImages({ width, height, reference: expected.internals.expected, candidate: view.internals.expected, referenceNoiseStd: expected.internals.noiseStd });
    expect(m.maxDeltaE).toBeLessThan(1e-6);
    const prepared = await prepareDisplayView(candidate);
    try {
      const whole = await prepared.render(requests.view);
      const part = await prepared.render({ ...requests.view, region: { ...requests.view.region, width: 5, height: 3 } });
      for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) for (let ch = 0; ch < 3; ch++) expect(part.image.samples[(y * 5 + x) * 3 + ch]).toBe(whole.image.samples[(y * width + x) * 3 + ch]);
      expect(Array.from(whole.image.samples)).toEqual(Array.from(view.result.image.samples));
    } finally { prepared.dispose(); }
    // A disc past the kernel's own cap (512 sites since #564; this one is about 1,250 sites across) fails as in the capture.
    await expect(simulateDisplayView({ ...requests.candidate, lens: { prime: 300, fNumber: 2.8, focusDistanceM: 0.4, defocus: DEFOCUS } }, requests.view))
      .rejects.toThrow(/^lens\.defocus: The blur circle is .* across; the engine renders at most 1,025 sites \(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES\)\.$/u);
  }, scaledTimeout(240_000));

  // #564: a disc above the direct radius (here 388 sites across, radius 194) is applied by runs to each channel's in-focus signal.
  // The reference is the in-focus view of the scene blurred beforehand by the same disc, directly, as for the cases above.
  it("renders a disc above 64 sites by runs, against the scene blurred beforehand (Speed and Quality)", async () => {
    for (const quality of [false, true]) {
      const requests = defocusCaseRequests({ pitch: "1.4", fNumber: 2.8, focusFactor: 0.45, quality }, { k: 2, block: { width: 16, height: 12 } });
      const view = await simulateDisplayViewWithInternals(requests.candidate, requests.view);
      expect(recorded(view.result, "view.defocus")).toMatchObject({ defocusKernelRadiusSites: 194, convolution: "runs" });
      expect(recorded(view.result, "lens.defocus")).toMatchObject({ kernelRadiusSites: 194, convolution: "runs" });
      const reference = await simulateDisplayViewWithInternals(requests.referenceFor(createDefocusDiscSiteKernel(recorded(view.result, "lens.defocus").diameterSites)), requests.view);
      const { width, height } = requests.view.region;
      const m = compareExpectedImages({ width, height, reference: reference.internals.expected, candidate: view.internals.expected, referenceNoiseStd: reference.internals.noiseStd });
      expect(m.maxDeltaE).toBeLessThan(1e-6);
    }
  }, scaledTimeout(240_000));

  /*
   * The Speed-only renderer (`registerDisplayViewSpeedGpuRenderer`, #478) has no defocus gather: with the defocus kernel in
   * the expected signal its render-time check refuses the request, so gpu "auto" renders this CPU path, labelled,
   * byte-identical to the CPU reference; in focus the GPU still takes the request. The engine's combined renderer gathers the
   * disc in its Quality site pass (#492 step 2c: test/display-view-defocus-gpu.test.ts).
   */
  it("gpu \"auto\" renders a defocused view on the CPU path, labelled unsupported-on-backend", async () => {
    const options = { scene: { preset: "checkerboard", squaresAcross: 12 }, lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 4, defocus: DEFOCUS },
      sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 120, height: 80 } };
    const view = { width: 40, height: 27 };
    const previous = registerDisplayViewSpeedGpuRenderer();
    try {
      const auto = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      const rendered = await auto.render(view), cpu = await simulateDisplayView(options, view);
      expect(rendered.diagnostics.fast.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "unsupported-on-backend" });
      expect(Array.from(rendered.image.samples)).toEqual(Array.from(cpu.image.samples));
      auto.dispose();
      const focused = await prepareDisplayView({ ...options, lens: { ...options.lens, focusDistanceM: 5 } }, { gpu: "auto", gpuDevice: createFakeGpu().gpu });
      expect((await focused.render(view)).diagnostics.fast.execution.backend).toBe("webgpu-f32");
      focused.dispose();
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(60_000));
});
