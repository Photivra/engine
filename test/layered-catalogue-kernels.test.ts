// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0, #741 and #748 at module level (`src/facade/layered-catalogue-kernels.ts`): a catalogue lens's kernels on layered
 * chart scenes and the focus they take.
 *
 * 1. Each surface's kernel is the single-plane path's catalogue bokeh kernel (`genericLensBokehKernel`'s axis kernel) bit for bit,
 *    null at the focus distance; with a cat's eye, the zone plan's kernels at each zone's field tangent; a plan that closes the
 *    pupil is refused. On the layered sum a uniform scene stays within 7 % across card edges (the shaped kernel's linear
 *    tap-to-pupil approximation of the layered visibility, measured here).
 * 2. Accuracy of the model (each surface's kernel, then the lens's PSF with its axial colour) against the lens's defocused wave
 *    PSF computed directly (test/helpers/layered-catalogue-wave-psf.ts) at the frame's centre and corner: edge positions per
 *    spectral node. Owner decision 4's go/no-go for a per-wavelength signed blur used the same reference (not taken; see the
 *    module comment).
 * 3. Occlusion with the nominal ray map σ·c/2 against a brute-force aperture integration of the kernel's own cubic ray map
 *    (σ·c/2 − b/2 + b·ρ²)·P: the nominal radius is within 6 % of the local swing and closer than the linear part (σ·c − b)/2.
 * 4. #748: the sampled focus sets every surface's blur (each equals `calculateDefocusCircle` there within 1e-12) and the kernels
 *    equal a request focused there; with breathing, a card edge on the centre row moves by the predicted site count.
 */
import { describe, expect, it } from "vitest";
import { calculateDefocusCircle, resolveGenericLens, simulateGenericLensFocusError } from "../src/index.js";
import { genericLensBokehKernel, createGenericLensPsfProfile } from "../src/optics/generic-lens-psf.js";
import { genericLensBreathingScale } from "../src/equipment/generic-lens-framing.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions, type ResolvedDefocusBokehOptions } from "../src/optics/defocus-bokeh-kernel.js";
import { convolveSiteKernels } from "../src/optics/defocus-disc-kernel.js";
import { planDefocusBokehZones } from "../src/facade/defocus-bokeh-zones.js";
import type { ResolvedGenericLens } from "../src/equipment/generic-lens-catalogue.js";
import type { SiteKernelFieldZones } from "../src/facade/diffraction-provider.js";
import type { LayeredChartDepth } from "../src/facade/layered-chart-scene.js";
import type { LayeredCatalogueSurfaceKernel } from "../src/facade/layered-catalogue-kernels.js";
import { resolveLensSampledPsfKernel, type ResolveLensSampledPsfInput } from "../src/optics/lens-psf-profile.js";
import { layeredChartDepths, resolveLayeredChartScene, type LayeredChartScene } from "../src/facade/layered-chart-scene.js";
import { createLayeredCatalogueKernels, layeredCatalogueFocus, layeredCatalogueSignedBlurSites } from "../src/facade/layered-catalogue-kernels.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, type LayeredSceneLayer } from "../src/facade/layered-scene-signal.js";
import { createLayeredLatticeGeometry } from "../src/facade/layered-lattice-geometry.js";
import { edgeSpread, padKernel, waveCellPsf } from "./helpers/layered-catalogue-wave-psf.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const AREA = { widthMm: 36, heightMm: 24 }, PITCH = 4, FOCUS = 3;
const EVIDENCE = [{ sourceOrigin: "photivra" as const, sourceReference: "test:layered-catalogue-kernels", reuseStatus: "photivra-owned" as const }];
const lensOf = (lensId: string, focusDistanceM = FOCUS): ResolvedGenericLens => resolveGenericLens({ lensId, activeImagingArea: AREA, focusDistanceM });
const optionsOf = (lens: ResolvedGenericLens, catsEye: boolean): ResolvedDefocusBokehOptions => {
  const b = lens.character.bokeh;
  return resolveDefocusBokehOptions(catsEye ? b : { blades: b.blades, sphericalAberration: b.sphericalAberration }, "lens.defocus");
};
/** Rows of a (2R + 1)² kernel reversed (#553's +Y down to the PSF profile's +Y up). */
const flipRows = (w: Float64Array, R: number): Float64Array => {
  const n = 2 * R + 1, out = new Float64Array(w.length);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[(n - 1 - j) * n + i] = w[j * n + i]!;
  return out;
};

describe("a catalogue lens's layered kernels (#741)", () => {
  it("are the single-plane path's bokeh kernels, bit for bit; null at the focus distance", () => {
    for (const lensId of ["pv-85-1.8", "pv-85-1.2-pro", "pv-200-2-pro"]) {
      const lens = lensOf(lensId), sc = [-31.5, -8, -2, -0.4, 0, 0.3, 2, 8, 40];
      const kernels = createLayeredCatalogueKernels({ lens, pitchMicrometers: PITCH, depths: sc.map((c) => ({ signedBlurRadiusSites: c / 2 })), bokeh: optionsOf(lens, false),
        createKernel: createDefocusBokehSiteKernel });
      sc.forEach((c, k) => {
        const got = kernels[k]!;
        if (c === 0) { expect(got).toEqual({ kernel: null, signedBlurSites: 0 }); return; }
        const want = genericLensBokehKernel(lens, Math.abs(c), c < 0 ? -1 : 1, PITCH, false).axis;
        expect(got.kernel!.radius).toBe(want.radius);
        expect(got.kernel!.shaped).toBe(true);
        expect(Array.from(got.kernel!.weights)).toEqual(Array.from(want.weights));
        expect(got.signedBlurSites).toBe(layeredCatalogueSignedBlurSites(lens, PITCH, c));
        expect(got.zones).toBeUndefined();
      });
    }
  });

  it("take the cat's eye per field zone, and refuse a plan that closes the pupil", () => {
    const lens = lensOf("pv-35-1.2-pro"), options = optionsOf(lens, true), W = 600, H = 400;
    expect(options.catsEye).toBeDefined();
    const fieldOf = (x: number, y: number): { x: number; y: number } => ({ x: (x - W / 2) * PITCH / 1000 / lens.focalLengthMm, y: -(y - H / 2) * PITCH / 1000 / lens.focalLengthMm });
    let plans = 0;
    const input = { lens, pitchMicrometers: PITCH, depths: [{ signedBlurRadiusSites: -6 }, { signedBlurRadiusSites: 0 }, { signedBlurRadiusSites: 9 }], bokeh: options,
      createKernel: createDefocusBokehSiteKernel, planZones: (radius: number, kernelAt: Parameters<typeof planDefocusBokehZones>[0]["kernelAt"]): { zones: SiteKernelFieldZones; minimumOpenAreaRatio: number } => {
        plans++;
        return planDefocusBokehZones({ options, nativeWidth: W, nativeHeight: H, radius, fNumber: lens.character.fNumber, focalLengthMm: lens.focalLengthMm, fieldOf, kernelAt });
      } };
    const kernels = createLayeredCatalogueKernels(input);
    expect(plans).toBe(2);
    expect(kernels[1]).toEqual({ kernel: null, signedBlurSites: 0 });
    for (const k of [0, 2]) {
      const { kernel, zones, signedBlurSites: s } = kernels[k]!;
      expect(zones).toBeDefined();
      const corner = zones!.kernelOf(0), field = fieldOf(zones!.size / 2, zones!.size / 2);
      const direct = createDefocusBokehSiteKernel({ diameterSites: Math.abs(s), side: s < 0 ? -1 : 1, fNumber: lens.character.fNumber, focalLengthMm: lens.focalLengthMm,
        pitchMicrometers: PITCH, options, field });
      expect(corner.length).toBe(kernel!.weights.length);
      expect(Array.from(padKernel(direct.weights, direct.radius, kernel!.radius))).toEqual(Array.from(corner));
    }
    expect(() => createLayeredCatalogueKernels({ ...input, planZones: (): { zones: SiteKernelFieldZones; minimumOpenAreaRatio: number } => ({ zones: { size: 1, columns: 1, rows: 1, kernelOf: () => new Float64Array(1) }, minimumOpenAreaRatio: 0 }) }))
      .toThrow(/close the pupil/u);
    expect(() => createLayeredCatalogueKernels({ lens: input.lens, pitchMicrometers: PITCH, depths: input.depths, bokeh: options, createKernel: createDefocusBokehSiteKernel })).toThrow(/zone plan/u);
  });

  // The shaped kernel's taps follow its cubic ray map while the visibility maps taps to the pupil linearly (layered-scene-signal.ts:
  // "V is the share of the disc's rays in the tap's region"), so across card edges a uniform scene is not exactly uniform: measured
  // 6.0 % here (pv-85-1.8 at f/1.8, b = 0.98 sites), against 15.2 % for the same lens's W040 through lens.defocus referred to the
  // paraxial focus, and 0.01 % for discs. A labelled approximation of the layered sum, not of this module.
  it("render on the layered sum: a uniform scene stays within 7 % across card edges", () => {
    const lens = lensOf("pv-85-1.8"), W = 64, H = 32, white = Float64Array.of(1, 1);
    const kernels = createLayeredCatalogueKernels({ lens, pitchMicrometers: PITCH, depths: [{ signedBlurRadiusSites: -9 }, { signedBlurRadiusSites: 3 }, { signedBlurRadiusSites: 12 }],
      bokeh: optionsOf(lens, false), createKernel: createDefocusBokehSiteKernel });
    const rects = [{ u0: -0.5, u1: 0.1, v0: -0.2, v1: 0.3 }, { u0: -0.2, u1: 0.6, v0: -0.4, v1: 0.1 }, null];
    const layers: LayeredSceneLayer[] = kernels.map((k, i) => ({ rect: rects[i]!, blurRadiusSites: [-9, 3, 12][i]!, kernel: k.kernel,
      scene: { kind: "materials", materialAt: () => 0, materials: [{ neutral: 0.5 }], whiteRadiance: white } }));
    const lattice = createLayeredSceneLattice({ nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: [450, 650], layers, occlusionSamples: LAYERED_OCCLUSION_SAMPLES.full });
    const g = lattice.groupOf(0, 0), out = new Float64Array(2);
    let worst = 0;
    for (let q = 0; q < H; q++) for (let p = 0; p < W; p++) { lattice.spectrumAt(g, p, q, out); worst = Math.max(worst, Math.abs(out[0]! / 0.5 - 1), Math.abs(out[1]! / 0.5 - 1)); }
    expect(lattice.edgePoints).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.07);
  });
});

describe("the model against the lens's defocused wave PSF (#741, owner decision 4)", () => {
  it("edge positions per node: within 0.2 site at the centre, 0.35 at the corner; L1 within 1.5", () => {
    const lens = lensOf("pv-85-1.8"), N = lens.character.fNumber, f = lens.focalLengthMm, options = optionsOf(lens, false);
    const psf = createGenericLensPsfProfile({ lens, focusDistanceM: FOCUS, sitePitchMicrometers: PITCH, fieldHalfExtentMm: { x: 18, y: 12 }, frameHalfMm: { x: 18, y: 12 }, evidence: EVIDENCE });
    const Rp = psf.kernelRadiusSites;
    const worst = { centre: 0, corner: 0, l1: 0 };
    for (const field of [{ x: 0, y: 0 }, { x: 18, y: 12 }]) for (const c of [-8, 8]) for (const nm of [450, 550, 650]) {
      const [surface] = createLayeredCatalogueKernels({ lens, pitchMicrometers: PITCH, depths: [{ signedBlurRadiusSites: c / 2 }], bokeh: options, createKernel: createDefocusBokehSiteKernel });
      const Rk = surface!.kernel!.radius, lensPsf = Float64Array.from(resolveLensSampledPsfKernel({ profile: psf.profile, focalLengthMm: f, focus: { kind: "finite", distanceM: FOCUS },
        apertureFNumber: N, fieldPointMm: field, wavelengthNm: nm, signedDefocusImagePlaneMicrometers: 0 } as ResolveLensSampledPsfInput).normalizedIntensity);
      const model = convolveSiteKernels(flipRows(surface!.kernel!.weights, Rk), Rk, lensPsf, Rp), R = Rk + Rp + 4;
      const ref = waveCellPsf({ lens, focusDistanceM: FOCUS, pitchMicrometers: PITCH, fieldMm: field, wavelengthNm: nm, defocusMicrometers: c * PITCH / (8 * N), radius: R }).kernel;
      let total = 0;
      for (const v of ref) total += v;
      const a = padKernel(model, Rk + Rp, R), b = ref.map((v) => v / total);
      let l1 = 0;
      for (let i = 0; i < a.length; i++) l1 += Math.abs(a[i]! - b[i]!);
      worst.l1 = Math.max(worst.l1, l1);
      for (const axis of [0, 1] as const) {
        const d = Math.abs(edgeSpread(a, R, axis).position - edgeSpread(b, R, axis).position);
        if (field.x === 0) worst.centre = Math.max(worst.centre, d); else worst.corner = Math.max(worst.corner, d);
      }
    }
    expect(worst.centre).toBeLessThan(0.2);
    expect(worst.corner).toBeLessThan(0.35);
    expect(worst.l1).toBeLessThan(1.5);
  }, scaledTimeout(120_000));
});

describe("occlusion with the nominal ray map (#741)", () => {
  it("is within 6 % of the local swing of the kernel's cubic ray map, and closer than its linear part", () => {
    const lens = lensOf("pv-85-1.8"), N = lens.character.fNumber, options = optionsOf(lens, false), W = 96, H = 8, n = 256;
    const b = 8 * N * options.sphericalAberration!.w040Micrometers / PITCH, white = Float64Array.of(1);
    for (const [front, back] of [[-8, 8], [-2, 32], [-32, 2]] as const) for (const [rf, rb] of [[0.9, 0.05], [0.05, 0.9]] as const) {
      const sc = [front, back], refl = [rf, rb], rects = [{ u0: -2, u1: 0, v0: -2, v1: 2 }, null];
      const kernels = createLayeredCatalogueKernels({ lens, pitchMicrometers: PITCH, depths: sc.map((c) => ({ signedBlurRadiusSites: c / 2 })), bokeh: options, createKernel: createDefocusBokehSiteKernel });
      const row = (rho: (k: number) => number): number[] => {
        const layers: LayeredSceneLayer[] = [0, 1].map((k) => ({ rect: rects[k]!, blurRadiusSites: rho(k), kernel: kernels[k]!.kernel,
          scene: { kind: "materials", materialAt: () => 0, materials: [{ neutral: refl[k]! }], whiteRadiance: white } }));
        const lattice = createLayeredSceneLattice({ nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: [550], layers, occlusionSamples: LAYERED_OCCLUSION_SAMPLES.full });
        const g = lattice.groupOf(0, 0), out = new Float64Array(1), values: number[] = [];
        for (let p = 0; p < W; p++) { lattice.spectrumAt(g, p, H >> 1, out); values.push(out[0]!); }
        return values;
      };
      // Brute force: n² staggered pupil points; the ray meets the front card (edge at u = 0) at x − (σc/2 − b/2 + b·ρ²)·Px.
      const brute: number[] = [];
      for (let p = 0; p < W; p++) {
        let sum = 0, count = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const px = -1 + (i + ((j * 0.6180339887498949) % 1)) * 2 / n, py = -1 + (j + ((i * 0.7548776662466927) % 1)) * 2 / n, r2 = px * px + py * py;
          if (r2 > 1) continue;
          count++;
          sum += (p - ((front - b) / 2 + b * r2) * px + 0.5 - W / 2) * 2 / W <= 0 ? rf : rb;
        }
        brute.push(sum / count);
      }
      const error = (values: number[]): number => Math.max(...values.map((v, i) => Math.abs(v - brute[i]!))) / Math.abs(rf - rb);
      const nominal = error(row((k) => sc[k]! / 2)), linear = error(row((k) => (sc[k]! - b) / 2));
      expect(nominal, `${front} ${back} ${rf}`).toBeLessThan(0.06);
      expect(nominal, `${front} ${back} ${rf}`).toBeLessThan(linear);
    }
  }, scaledTimeout(120_000));
});

describe("focus scatter and breathing (#748)", () => {
  const scene: LayeredChartScene = { kind: "layered-chart", cards: [{ distanceM: 1.6, centerU: -0.3, centerV: 0, width: 0.8, height: 0.5, scene: { preset: "uniform", reflectance: 0.4 } },
    { distanceM: 2.4, centerU: 0.35, centerV: 0.1, width: 0.6, height: 0.4, scene: { preset: "uniform", reflectance: 0.4 } }], backPlane: { distanceM: 6 } };
  it("the sampled focus sets each surface's blur and kernel", () => {
    const resolved = resolveLayeredChartScene({ scene, aspect: 2 / 3 }), requested = 2;
    for (const seed of [1, 7, 12345]) {
      const lens0 = lensOf("pv-85-1.8", requested), N = lens0.character.fNumber, f = lens0.focalLengthMm;
      const sample = simulateGenericLensFocusError({ lensId: "pv-85-1.8", activeImagingArea: AREA, fNumber: N, focusDistanceM: requested, seed });
      const focus = layeredCatalogueFocus({ focusDistanceM: requested, sampledFocusDistanceM: sample.focusDistanceM });
      expect(focus).toEqual({ focusDistanceM: sample.focusDistanceM, breathingScale: 1, frameScale: 1 });
      expect(focus.focusDistanceM).not.toBe(requested);
      const depthsAt = (focusDistanceM: number): LayeredChartDepth[] => layeredChartDepths(resolved, { focalLengthMm: f, aperture: N, focusDistanceM, circleOfConfusionMm: 0.029, pixelPitchMicrometers: PITCH });
      const depths = depthsAt(focus.focusDistanceM);
      depths.forEach((d) => {
        const c = calculateDefocusCircle({ focalLengthMm: f, aperture: N, focusDistanceM: sample.focusDistanceM, subjectDistanceM: d.distanceM }).value.diameterMm * 1000 / PITCH;
        expect(Math.abs(d.defocusDiameterSites - c)).toBeLessThanOrEqual(1e-12 * Math.max(1, c));
      });
      const kernelsAt = (focusDistanceM: number, d: LayeredChartDepth[]): LayeredCatalogueSurfaceKernel[] => createLayeredCatalogueKernels({ lens: lensOf("pv-85-1.8", focusDistanceM), pitchMicrometers: PITCH, depths: d,
        bokeh: optionsOf(lensOf("pv-85-1.8", focusDistanceM), false), createKernel: createDefocusBokehSiteKernel });
      // A request focused at the sampled distance without scatter: the same kernels, bit for bit.
      const scattered = kernelsAt(focus.focusDistanceM, depths), focused = kernelsAt(sample.focusDistanceM, depthsAt(sample.focusDistanceM));
      expect(scattered.map((k) => [k.signedBlurSites, k.kernel && Array.from(k.kernel.weights)])).toEqual(focused.map((k) => [k.signedBlurSites, k.kernel && Array.from(k.kernel.weights)]));
    }
  });

  it("breathing scales every frame point: a card edge on the centre row moves by the predicted site count", () => {
    const lens = resolveGenericLens({ lensId: "pv-100-2.8-macro-pro", activeImagingArea: AREA, focusDistanceM: 0.5 });
    const k = genericLensBreathingScale(lens, 0.5);
    expect(Math.abs(k - 1)).toBeGreaterThan(0.01);
    const focus = layeredCatalogueFocus({ focusDistanceM: 0.5, breathingScale: k });
    expect(focus.frameScale).toBe(1 / k);
    const W = 400, H = 40, u0 = 0.5, layers = [{ rect: { u0, v0: -1, u1: 2, v1: 1 }, blurRadiusSites: 0, kernel: null }, { rect: null, blurRadiusSites: 0, kernel: null }];
    const edgeX = (frameScale: number): number => {
      const geometry = createLayeredLatticeGeometry({ nativeWidth: W, nativeHeight: H, outputWidth: W, layers, frameScale });
      const g = geometry.groupOf(0, 0), at = { u: 0, v: 0, factor: 1 };
      for (let p = 0; p < W; p++) { geometry.framePoint(g, p, H >> 1, at); if (geometry.chiefSurface(at.u, at.v) === 0) return p; }
      return W;
    };
    const moved = edgeX(focus.frameScale) - edgeX(1), predicted = u0 * W / 2 * (1 / k - 1);
    expect(Math.sign(moved)).toBe(Math.sign(predicted));
    expect(Math.abs(moved - predicted)).toBeLessThanOrEqual(1);
  });
});
