// SPDX-License-Identifier: Apache-2.0

/**
 * #549: the generic lens catalogue's data (30 lenses, owner's names, apertures, close focus, projections, set baselines and
 * adjustments), its resolution on a sensor, the seeded focus-scatter sampler, and the PSF builder (against the engine's own
 * diffraction kernels, its sampling, and the orientation of coma and lateral colour).
 */
import { describe, expect, it } from "vitest";
import {
  GENERIC_LENS_CATALOGUE, GENERIC_LENS_IDS, GENERIC_LENS_SET_BASELINES, GENERIC_PRIME_THIRD_STOP_F_NUMBERS, createDiffractionLimitedPsfProfile, resolveGenericLens,
  simulateGenericLensFocusError, InvalidConfigurationError, InvalidScientificInputError, createGenericLensCorrectionProfile, calculatePeripheralIlluminationCorrection,
  parseGenericLensCorrectionProfile, type GenericLensCorrectionProfile, type IlluminationLensCorrection, type OpticalProfileState, type ResolvedGenericLens
} from "../src/index.js";
import { createGenericLensPsfProfile, genericLensPsfKernelRadius, GENERIC_LENS_PSF_WAVELENGTHS_NM } from "../src/optics/generic-lens-psf.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";

const FULL_FRAME = { widthMm: 36, heightMm: 24 };
const EVIDENCE = [{ sourceOrigin: "photivra" as const, sourceReference: "test:generic-lens-catalogue", reuseStatus: "photivra-owned" as const }];

describe("the generic lens catalogue (#549)", () => {
  it("defines the owner's 30 lenses: 17 professional and 13 consumer, named PV <focal> <aperture>", () => {
    const pro = [[8, 3.5, "PV 8 3.5 Fisheye Pro"], [10, 3.2, "PV 10 3.2 Pro"], [15, 2.8, "PV 15 2.8 Fisheye Pro"], [16, 1.8, "PV 16 1.8 Pro"], [20, 1.4, "PV 20 1.4 Pro"],
      [24, 1.4, "PV 24 1.4 Pro"], [35, 1.2, "PV 35 1.2 Pro"], [50, 1.2, "PV 50 1.2 Pro"], [85, 1.2, "PV 85 1.2 Pro"], [100, 2.8, "PV 100 2.8 Macro Pro"], [200, 2, "PV 200 2 Pro"],
      [300, 2.8, "PV 300 2.8 Pro"], [400, 2.8, "PV 400 2.8 Pro"], [500, 4, "PV 500 4 Pro"], [600, 4, "PV 600 4 Pro"], [800, 5.6, "PV 800 5.6 Pro"], [1200, 8, "PV 1200 8 Pro"]] as const;
    const consumer = [[16, 2.8], [20, 2], [24, 1.8], [35, 1.8], [50, 1.8], [85, 1.8], [100, 2], [200, 5.6], [300, 5.6], [400, 5.6], [500, 5.6], [600, 6.3], [800, 9]] as const;
    expect(GENERIC_LENS_CATALOGUE).toHaveLength(30);
    expect(GENERIC_LENS_IDS).toEqual(GENERIC_LENS_CATALOGUE.map((lens) => lens.lensId));
    const professional = GENERIC_LENS_CATALOGUE.filter((lens) => lens.set === "professional"), consumers = GENERIC_LENS_CATALOGUE.filter((lens) => lens.set === "consumer");
    expect(professional.map((lens) => [lens.equivalentFocalLengthMm, lens.widestFNumber, lens.name])).toEqual(pro.map((row) => [...row]));
    expect(consumers.map((lens) => [lens.equivalentFocalLengthMm, lens.widestFNumber])).toEqual(consumer.map((row) => [...row]));
    expect(consumers.map((lens) => lens.name)).toEqual(consumer.map(([f, n]) => "PV " + f + " " + n));
    expect(GENERIC_LENS_IDS).toContain("pv-50-1.2-pro");
    expect(GENERIC_LENS_IDS).toContain("pv-50-1.8");
    expect(GENERIC_LENS_IDS).toContain("pv-100-2.8-macro-pro");
    expect(GENERIC_LENS_IDS).toContain("pv-8-3.5-fisheye-pro");
    expect(new Set(GENERIC_LENS_IDS).size).toBe(30);
  });

  it("gives every lens a short plain-English summary (at most 40 characters, US spelling) that agrees with its character values", () => {
    for (const lens of GENERIC_LENS_CATALOGUE) {
      expect(lens.summary.length, lens.lensId).toBeGreaterThan(0);
      expect(lens.summary.length, lens.lensId).toBeLessThanOrEqual(40);
      // US spelling, no product names, and nothing the catalogue does not model (bokeh shape: the defocus is a disc).
      expect(lens.summary, lens.lensId).not.toMatch(/colour|grey|fall-off|licence|optimis|bokeh|PV /iu);
      const a = lens.adjustments;
      if (/barrel/u.test(lens.summary)) expect(a.distortion, lens.lensId).toBeLessThan(0);
      if (/pincushion/u.test(lens.summary)) expect(a.distortion, lens.lensId).toBeGreaterThan(0);
      if (/nearly no distortion/u.test(lens.summary)) expect(Math.abs(a.distortion), lens.lensId).toBeLessThanOrEqual(0.3);
      if (/low coma/u.test(lens.summary)) expect(a.coma ?? 1, lens.lensId).toBeLessThan(1);
      else if (/coma/u.test(lens.summary)) expect(a.coma ?? 1, lens.lensId).toBeGreaterThan(1);
      if (/axial color/u.test(lens.summary)) expect(a.axialColor ?? 1, lens.lensId).toBeGreaterThan(1);
      if (/lateral color/u.test(lens.summary)) expect(a.lateralColor ?? 1, lens.lensId).toBeGreaterThan(1);
      if (/fisheye/iu.test(lens.summary)) expect(lens.kind, lens.lensId).toBe("fisheye");
      if (/little falloff/u.test(lens.summary)) expect(a.vignetting ?? 1, lens.lensId).toBeLessThan(1);
      expect(resolveGenericLens({ lensId: lens.lensId, activeImagingArea: FULL_FRAME }).summary).toBe(lens.summary);
    }
  });

  it("uses the generic smallest apertures, close focus and projections", () => {
    for (const lens of GENERIC_LENS_CATALOGUE) {
      expect(lens.narrowestFNumber).toBe(lens.equivalentFocalLengthMm <= 16 ? 16 : lens.equivalentFocalLengthMm <= 135 ? 22 : 32);
      expect(lens.maximumMagnification).toBe(lens.lensId === "pv-100-2.8-macro-pro" ? 1 : 0.15);
      expect(lens.projection).toBe(lens.kind === "fisheye" ? "fisheye-equisolid-angle" : "rectilinear");
      expect(lens.kind === "fisheye").toBe(lens.set === "professional" && (lens.equivalentFocalLengthMm === 8 || lens.equivalentFocalLengthMm === 15));
      expect(lens.note.length).toBeGreaterThan(10);
    }
    expect(GENERIC_LENS_CATALOGUE.find((lens) => lens.equivalentFocalLengthMm === 8)!.fisheyeImage).toBe("circular");
    expect(GENERIC_LENS_CATALOGUE.find((lens) => lens.equivalentFocalLengthMm === 15)!.fisheyeImage).toBe("full-frame");
    // Close focus: max(0.10 m, f(1 + 1/m)); the macro reaches 1:1 at 2f.
    const macro = resolveGenericLens({ lensId: "pv-100-2.8-macro-pro", activeImagingArea: FULL_FRAME });
    expect(macro.minimumFocusDistanceM).toBeCloseTo(0.2, 12);
    expect(macro.maximumMagnification).toBeCloseTo(1, 12);
    const fifty = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME });
    expect(fifty.minimumFocusDistanceM).toBeCloseTo(0.05 * (1 + 1 / 0.15), 12);
    expect(fifty.fNumbers).toEqual(GENERIC_PRIME_THIRD_STOP_F_NUMBERS.filter((n) => n >= 1.8 && n <= 22));
    expect(resolveGenericLens({ lensId: "pv-8-3.5-fisheye-pro", activeImagingArea: FULL_FRAME }).minimumFocusDistanceM).toBe(0.1);
  });

  it("scales focal lengths by the crop factor, like lens.prime", () => {
    const apsc = resolveGenericLens({ lensId: "pv-50-1.2-pro", activeImagingArea: { widthMm: 24, heightMm: 16 } });
    expect(apsc.cropFactor35Mm).toBeCloseTo(1.5, 12);
    expect(apsc.focalLengthMm).toBeCloseTo(50 / 1.5, 10);
    expect(apsc.halfDiagonalMm).toBeCloseTo(Math.hypot(24, 16) / 2, 12);
    const fisheye = resolveGenericLens({ lensId: "pv-8-3.5-fisheye-pro", activeImagingArea: FULL_FRAME });
    expect(fisheye.imageCircleRadiusMm).toBeCloseTo(16 * Math.SQRT1_2, 12);
    expect(fisheye.imageCircleRadiusMm!).toBeLessThan(12);
    expect(resolveGenericLens({ lensId: "pv-15-2.8-fisheye-pro", activeImagingArea: FULL_FRAME }).imageCircleRadiusMm!).toBeGreaterThan(Math.hypot(18, 12) - 0.5);
  });

  it("gives every set baseline the owner's ordering: professional better than consumer", () => {
    const pro = GENERIC_LENS_SET_BASELINES.professional, consumer = GENERIC_LENS_SET_BASELINES.consumer;
    for (const key of Object.keys(pro) as (keyof typeof pro)[]) {
      if (key === "breathingFraction") expect(Math.abs(pro[key])).toBeLessThan(Math.abs(consumer[key]));
      else expect(pro[key]).toBeLessThan(consumer[key]);
    }
  });

  it("resolves the character: pupil scaling with the f-number, close focus, colour, distortion and vignetting", () => {
    const wide = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME }).character;
    const stopped = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, fNumber: 3.6 }).character;
    expect(stopped.pupilScale).toBeCloseTo(0.5, 12);
    expect(stopped.aberrations.sphericalWaves / wide.aberrations.sphericalWaves).toBeCloseTo(1 / 16, 12);
    expect(stopped.aberrations.comaWaves / wide.aberrations.comaWaves).toBeCloseTo(1 / 8, 12);
    expect(stopped.aberrations.astigmatismWaves / wide.aberrations.astigmatismWaves).toBeCloseTo(1 / 4, 12);
    expect(wide.aberrations.balancingDefocusWaves).toBe(-wide.aberrations.sphericalWaves);
    // Optical vignetting fades over two stops; natural vignetting stays.
    const consumer = GENERIC_LENS_SET_BASELINES.consumer, adjust = 0.8;
    expect(wide.vignetting.cornerStops).toBeCloseTo((consumer.naturalVignettingStops + consumer.opticalVignettingStops) * adjust, 12);
    expect(resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, fNumber: 7.2 }).character.vignetting.cornerStops).toBeCloseTo(consumer.naturalVignettingStops * adjust, 12);
    // E(1) = 2^-stops, decreasing over the frame.
    const p = wide.vignetting.profile, e = (rho: number): number => 1 + p.coefficients.r2 * rho ** 2 + p.coefficients.r4 * rho ** 4;
    expect(Math.log2(e(1))).toBeCloseTo(-wide.vignetting.cornerStops, 12);
    expect(e(0.5)).toBeGreaterThan(e(1));
    expect(wide.distortion.profile.coefficients.k1).toBe(wide.distortion.corner);
    expect(wide.distortion.corner).toBeCloseTo(-0.3 * consumer.distortionMagnitude, 12);
    expect(wide.lateralColor.cornerMicrometers).toBeCloseTo(0.6 * consumer.lateralColorFraction * Math.hypot(18, 12) * 1000, 9);
    // Close focus raises the aberrations by 1 + c·m/m_max.
    const close = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, focusDistanceM: fiftyMinimum() }).character;
    expect(close.magnification).toBeCloseTo(0.15, 9);
    expect(close.closeFocusGain).toBeCloseTo(1 + consumer.closeFocusFactor, 9);
    expect(close.aberrations.comaWaves / wide.aberrations.comaWaves).toBeCloseTo(1 + consumer.closeFocusFactor, 9);
    expect(close.breathing.fieldOfViewChange).toBeCloseTo(close.breathing.atMinimumFocus, 9);
    expect(genericLensDispersion(587.5618)).toBeCloseTo(0, 12);
    expect(genericLensDispersion(486.1327) - genericLensDispersion(656.2725)).toBeCloseTo(1, 12);
  });

  it("keeps the pro set's close-focus performance better, and the macro's best of all", () => {
    const gain = (id: string): number => {
      const lens = resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME });
      return resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME, focusDistanceM: lens.minimumFocusDistanceM }).character.closeFocusGain;
    };
    expect(gain("pv-50-1.2-pro")).toBeLessThan(gain("pv-50-1.8"));
    expect(gain("pv-100-2.8-macro-pro")).toBeLessThan(gain("pv-50-1.2-pro"));
  });

  it("refuses unknown ids, f-numbers outside the range and focus closer than the minimum", () => {
    expect(() => resolveGenericLens({ lensId: "pv-50-1.4", activeImagingArea: FULL_FRAME })).toThrow(InvalidConfigurationError);
    expect(() => resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, fNumber: 1.4 })).toThrow(/outside the PV 50 1.8 range f\/1.8–f\/22/);
    expect(() => resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, focusDistanceM: 0.2 })).toThrow(/minimum focus/);
    expect(() => resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: { widthMm: 0, heightMm: 24 } })).toThrow(InvalidScientificInputError);
    expect(() => resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, extra: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});

function fiftyMinimum(): number { return resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME }).minimumFocusDistanceM; }

describe("the focus-scatter sampler (#549)", () => {
  const base = { lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, fNumber: 1.8, focusDistanceM: 2, seed: 7 };
  it("is seeded and reproducible, and differs between shots and seeds", () => {
    const a = simulateGenericLensFocusError(base), b = simulateGenericLensFocusError(base);
    expect(a).toEqual(b);
    expect(simulateGenericLensFocusError({ ...base, shotIndex: 1 }).standardNormal).not.toBe(a.standardNormal);
    expect(simulateGenericLensFocusError({ ...base, seed: 8 }).standardNormal).not.toBe(a.standardNormal);
    expect(a.scientificStatus).toBe("approximation");
    // Recorded value, so a change to the stream or the transform is seen.
    expect(a.standardNormal).toBe(-0.5020345123616705);
  });

  it("has the declared spread: σ·2Nc in image space, larger for the consumer lens", () => {
    const errors = (lensId: string, fNumber: number): number[] => Array.from({ length: 4000 }, (_, shotIndex) =>
      simulateGenericLensFocusError({ ...base, lensId, fNumber, shotIndex }).imageSideErrorMicrometers);
    const consumer = errors("pv-50-1.8", 1.8), pro = errors("pv-50-1.2-pro", 1.8);
    const stats = (v: number[]): { mean: number; sd: number } => { const m = v.reduce((p, q) => p + q, 0) / v.length; return { mean: m, sd: Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / (v.length - 1)) }; };
    const c = 2 * Math.hypot(18, 12) / 1500, dof = 2 * 1.8 * c * 1000;
    expect(Math.abs(stats(consumer).mean)).toBeLessThan(0.05 * 0.3 * dof);
    expect(stats(consumer).sd / (0.3 * dof)).toBeGreaterThan(0.95);
    expect(stats(consumer).sd / (0.3 * dof)).toBeLessThan(1.05);
    expect(stats(pro).sd / (0.1 * dof)).toBeCloseTo(1, 1);
    expect(stats(pro).sd).toBeLessThan(stats(consumer).sd);
  });

  it("moves the focus distance through the thin lens and holds it within the lens's range", () => {
    const s = simulateGenericLensFocusError(base), f = 50, v0 = 1 / (1 / f - 1 / 2000);
    expect(1 / (1 / f - 1 / (s.focusDistanceM * 1000))).toBeCloseTo(v0 + s.imageSideErrorMicrometers / 1000, 9);
    const near = simulateGenericLensFocusError({ ...base, focusDistanceM: fiftyMinimum(), circleOfConfusionMm: 5 });
    expect(near.focusDistanceM).toBeGreaterThanOrEqual(fiftyMinimum());
    expect(() => simulateGenericLensFocusError({ ...base, seed: -1 })).toThrow(InvalidScientificInputError);
  });
});

/** A resolved lens with its character replaced (for the PSF builder checks). */
function withCharacter(lens: ResolvedGenericLens, change: Partial<ResolvedGenericLens["character"]["aberrations"]>, lateral = lens.character.lateralColor.fraction): ResolvedGenericLens {
  return { ...lens, character: { ...lens.character, aberrations: { ...lens.character.aberrations, ...change }, lateralColor: { ...lens.character.lateralColor, fraction: lateral } } };
}
const NONE = { sphericalWaves: 0, balancingDefocusWaves: 0, comaWaves: 0, astigmatismWaves: 0, fieldCurvatureWaves: 0, axialColorWaves: 0 };
function kernelAt(psf: ReturnType<typeof createGenericLensPsfProfile>, x: number, y: number, nm: number): { values: number[]; radius: number } {
  const node = psf.profile.nodes.find((n) => n.coordinate.fieldXmm === x && n.coordinate.fieldYmm === y && n.coordinate.wavelengthNm === nm)!;
  return { values: [...node.kernel.normalizedIntensity], radius: node.kernel.centerSampleX };
}
/** Centroid (x right, y up: the kernel's row index increases with image +Y) and the third moment along a unit direction. */
function moments(k: { values: number[]; radius: number }, ux: number, uy: number): { x: number; y: number; skew: number } {
  const w = 2 * k.radius + 1;
  let x = 0, y = 0;
  k.values.forEach((v, i) => { x += v * (i % w - k.radius); y += v * (Math.floor(i / w) - k.radius); });
  let m2 = 0, m3 = 0;
  k.values.forEach((v, i) => { const t = (i % w - k.radius - x) * ux + (Math.floor(i / w) - k.radius - y) * uy; m2 += v * t * t; m3 += v * t ** 3; });
  return { x, y, skew: m3 / m2 ** 1.5 };
}

describe("the catalogue PSF builder (#549)", () => {
  const field = { fieldHalfExtentMm: { x: 18.05, y: 12.05 }, frameHalfMm: { x: 18, y: 12 }, evidence: EVIDENCE };

  it("without aberrations equals the engine's diffraction-limited site kernels (Airy, the same cells)", () => {
    const lens = withCharacter(resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, fNumber: 8, focusDistanceM: 3 }), NONE, 0);
    const pitch = 2, psf = createGenericLensPsfProfile({ lens, focusDistanceM: 3, sitePitchMicrometers: pitch, ...field });
    const airy = createDiffractionLimitedPsfProfile({ aperture: "circular", focalLengthMm: 50, apertureFNumber: 8, focus: { kind: "finite", distanceM: 3 }, wavelengthsNm: [550],
      samplePitchMicrometers: pitch, kernelRadiusSamples: psf.aberrationKernelRadiusSites, fieldHalfExtentMm: { x: 1, y: 1 }, profileId: "test-airy" }).value.profile.nodes[0]!.kernel.normalizedIntensity;
    const ours = kernelAt(psf, 0, 0, 550).values;
    expect(ours).toHaveLength(airy.length);
    let worst = 0;
    ours.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - airy[i]!)); });
    expect(worst).toBeLessThan(0.004);
    // The window reached its bound (the 780 nm Airy third ring); the energy outside it is reported.
    expect(psf.maximumTruncatedEnergyFraction).toBeLessThan(0.06);
  });

  it("samples every catalogue lens's wavefront within Nyquist, wide open and at minimum focus, at the corner", () => {
    for (const entry of GENERIC_LENS_CATALOGUE) {
      const probe = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: FULL_FRAME });
      const lens = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: FULL_FRAME, focusDistanceM: probe.minimumFocusDistanceM * 1.0001 });
      const psf = createGenericLensPsfProfile({ lens, focusDistanceM: lens.character.focusDistanceM!, sitePitchMicrometers: 6, ...field });
      expect(psf.maximumPhaseStepWaves, entry.lensId).toBeLessThanOrEqual(0.35);
      expect(psf.profile.nodes).toHaveLength(125);
      expect(psf.wavelengthsNm).toEqual([...GENERIC_LENS_PSF_WAVELENGTHS_NM]);
    }
  }, 120_000);

  it("points coma's flare and the blue image away from the axis, in every quadrant", () => {
    const lens = resolveGenericLens({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, focusDistanceM: 3 });
    const coma = createGenericLensPsfProfile({ lens: withCharacter(lens, { ...NONE, comaWaves: 1.2 }, 0), focusDistanceM: 3, sitePitchMicrometers: 2, ...field });
    const lateral = createGenericLensPsfProfile({ lens: withCharacter(lens, NONE), focusDistanceM: 3, sitePitchMicrometers: 2, ...field });
    for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as const) {
      const x = sx * 18.05, y = sy * 12.05, ux = x / Math.hypot(x, y), uy = y / Math.hypot(x, y);
      expect(moments(kernelAt(coma, x, y, 550), ux, uy).skew).toBeGreaterThan(0.5);
      const blue = moments(kernelAt(lateral, x, y, 450), ux, uy), red = moments(kernelAt(lateral, x, y, 650), ux, uy);
      // Lateral colour moves the 450 nm image outward and the 650 nm image inward by L·R·H·D(λ).
      const radial = (m: { x: number; y: number }): number => (m.x * ux + m.y * uy) * 2;
      const expected = (nm: number): number => lens.character.lateralColor.fraction * lens.halfDiagonalMm * 1000 * genericLensDispersion(nm);
      expect(radial(blue)).toBeCloseTo(expected(450), 0);
      expect(radial(red)).toBeCloseTo(expected(650), 0);
      expect(radial(blue)).toBeGreaterThan(0);
      expect(radial(red)).toBeLessThan(0);
    }
    // On the axis there is neither.
    expect(Math.abs(moments(kernelAt(coma, 0, 0, 550), 1, 0).skew)).toBeLessThan(1e-9);
  });

  it("is wider for the consumer lens than the professional one, at the corner and wide open", () => {
    const radius = (id: string): number => genericLensPsfKernelRadius({ lens: resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME, focusDistanceM: 3 }), focusDistanceM: 3, sitePitchMicrometers: 3 });
    expect(radius("pv-24-1.4-pro")).toBeLessThan(radius("pv-24-1.8"));
    const rms = (id: string): number => {
      const lens = resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME, focusDistanceM: 3 });
      const k = kernelAt(createGenericLensPsfProfile({ lens, focusDistanceM: 3, sitePitchMicrometers: 3, ...field }), 18.05, 12.05, 550), w = 2 * k.radius + 1;
      const m = moments(k, 1, 0);
      return Math.sqrt(k.values.reduce((s, v, i) => s + v * ((i % w - k.radius - m.x) ** 2 + (Math.floor(i / w) - k.radius - m.y) ** 2), 0));
    };
    expect(rms("pv-24-1.4-pro")).toBeLessThan(rms("pv-24-1.8"));
    expect(rms("pv-50-1.2-pro")).toBeLessThan(rms("pv-50-1.8"));
  });
});

describe("the catalogue lenses' generic correction profiles (#549)", () => {
  const state = (lensId: string, focalLengthMm: number, aperture: number): OpticalProfileState => ({ bodyId: "photivra-test-body", bodyVersion: "1", lensId, lensVersion: "1", focalLengthMm, aperture,
    focusDistanceM: 3, captureMode: "still" as const, outputWidth: 600, outputHeight: 400, frameRateHz: 0, stabilizationMode: "off" });
  const profile = (lensId: string, aperture: number): GenericLensCorrectionProfile => createGenericLensCorrectionProfile({ lensId, activeImagingArea: FULL_FRAME,
    state: state(lensId, resolveGenericLens({ lensId, activeImagingArea: FULL_FRAME }).focalLengthMm, aperture) });

  it("inverts the lens's own distortion, lateral colour and vignetting, and parses", () => {
    const p = profile("pv-24-1.8", 1.8), lens = resolveGenericLens({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, fNumber: 1.8 });
    expect(parseGenericLensCorrectionProfile(p)).toEqual(p);
    expect(p.components.map((c) => c.kind)).toEqual(["geometry", "lateral-ca", "peripheral-illumination"]);
    const geometry = p.components[0]!;
    expect(geometry.kind === "geometry" && geometry.transform.kind === "radial" ? geometry.transform.profile.coefficients.k1 : NaN).toBe(lens.character.distortion.corner);
    const ca = p.components[1]!;
    if (ca.kind !== "lateral-ca" || ca.transforms.blue.kind !== "affine" || ca.transforms.red.kind !== "affine") throw new Error("lateral-ca");
    expect(ca.transforms.blue.matrix[0]).toBeGreaterThan(1);
    expect(ca.transforms.red.matrix[0]).toBeLessThan(1);
    const gain = (lensId: string, aperture: number): number => calculatePeripheralIlluminationCorrection({ component: profile(lensId, aperture).components[2] as IlluminationLensCorrection,
      imagePointMm: { x: 18, y: 12 }, signal: 0.1, noiseVariance: 0, clippingLevel: 10 }).value.gain;
    // #584: at the sensor corner the gain is det J/E, E(1) = 2^−cornerStops and det J = (1 + k1ρ_i²)(1 + 3k1ρ_i²) at ρ_i(1 + k1ρ_i²) = 1.
    const k1 = lens.character.distortion.corner;
    let ri = 1;
    for (let i = 0; i < 30; i++) ri -= (ri * (1 + k1 * ri * ri) - 1) / (1 + 3 * k1 * ri * ri);
    expect(gain("pv-24-1.8", 1.8)).toBeCloseTo(2 ** lens.character.vignetting.cornerStops * (1 + k1 * ri * ri) * (1 + 3 * k1 * ri * ri), 9);
    // Consumer lenses rely on the profile more: a larger corner gain than the pro lens at the same aperture.
    expect(gain("pv-24-1.8", 2.8)).toBeGreaterThan(gain("pv-24-1.4-pro", 2.8));
  });

  it("binds the profile to the catalogue lens's own state", () => {
    expect(() => createGenericLensCorrectionProfile({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, state: state("other", 24, 2) })).toThrow(/lensId/);
    expect(() => createGenericLensCorrectionProfile({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, state: state("pv-24-1.8", 25, 2) })).toThrow(/focalLengthMm/);
    expect(() => createGenericLensCorrectionProfile({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, state: state("pv-24-1.8", 24, 1.4) })).toThrow(/range/);
  });
});
