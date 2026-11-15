// SPDX-License-Identifier: Apache-2.0
/**
 * #631: chart fit and coverage through the catalogue fisheyes (equisolid projection with the lens's distortion), and #632's focus
 * breathing in the framing helpers and the capture. The rendered chart's edges are measured on the developed image and compared with
 * the predicted image size.
 */
import { describe, expect, it } from "vitest";
import { calculateChartFraming, calculateSubjectDistanceForFraming, resolveGenericLens, simulateCapture, InvalidConfigurationError, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const fullFrame = { widthMm: 36, heightMm: 24 };
const close = (actual: number, expected: number, relative = 1e-12): void => { expect(Math.abs(actual / expected - 1)).toBeLessThan(relative); };
const FISHEYES = ["pv-8-3.5-fisheye-pro", "pv-15-2.8-fisheye-pro"] as const;

/** The chart's width in pixels along the image's centre row: the outermost crossings of the level halfway between surround and chart (green). */
function centreRowWidth(r: SimulateCaptureResult): number {
  const { width, height, samples } = r.image, row = Math.floor(height / 2), g = (x: number): number => samples[(row * width + x) * 3 + 1]!;
  let lo = Infinity, hi = -Infinity;
  for (let x = 0; x < width; x++) { lo = Math.min(lo, g(x)); hi = Math.max(hi, g(x)); }
  const mid = (lo + hi) / 2;
  let left = NaN, right = NaN;
  for (let x = 0; x + 1 < width; x++) if (g(x) < mid && g(x + 1) >= mid) { left = x + (mid - g(x)) / (g(x + 1) - g(x)); break; }
  for (let x = width - 1; x > 0; x--) if (g(x) < mid && g(x - 1) >= mid) { right = x - (mid - g(x)) / (g(x - 1) - g(x)); break; }
  return right - left;
}

describe("calculateChartFraming with a catalogue fisheye (#631)", () => {
  it("images the chart through the equisolid projection and the lens's distortion (worked example, PV 15 2.8 Fisheye Pro on full frame)", () => {
    // 1 m chart at 1 m: θ = atan(0.5) = 26.57°, v = 15·1000/985 mm, r_i = 2v·sin(θ/2), r = r_i·(1 + 0.005·(r_i/21.63)²).
    const r = calculateChartFraming({ sensor: fullFrame, catalogue: "pv-15-2.8-fisheye-pro", chart: { widthM: 1, heightM: 1 }, subjectDistanceM: 1 });
    const v = 15 * 1000 / 985, ideal = 2 * v * Math.sin(Math.atan(0.5) / 2), halfDiagonal = Math.hypot(18, 12), k1 = 0.01 * 0.5;
    close(r.chartImageMm.width, 2 * ideal * (1 + k1 * (ideal / halfDiagonal) ** 2));
    close(r.coverage.frameWidthFraction, r.chartImageMm.width / 36);
    close(r.coverage.frameHeightFraction, r.chartImageMm.width / 24);
    // The thin lens would put the edge at v·tan θ = 7.6 mm from the centre, against the fisheye's 7.4 mm.
    expect(r.chartImageMm.width).toBeLessThan(2 * v * 0.5);
    expect(r.lens!.projection).toBe("fisheye-equisolid-angle");
    expect(r.lens!.breathingScale).toBe(1);
    expect(r.prime).toBeNull();
    expect(r.minimumFocusDistanceM).toBe(resolveGenericLens({ lensId: "pv-15-2.8-fisheye-pro", activeImagingArea: fullFrame }).minimumFocusDistanceM);
    // The frame's width edge (18 mm) looks out at θ = 2·asin(r_i/2v) from the axis, r_i its undistorted radius (72.2° at this focus).
    let edge = 18;
    for (let i = 0; i < 50; i++) edge = 18 / (1 + k1 * (edge / halfDiagonal) ** 2);
    const theta = 2 * Math.asin(edge / (2 * v));
    close(r.lens!.fieldOfViewDegrees.width!, 2 * theta * 180 / Math.PI, 1e-12);
    close(r.lens!.framedWidthM!, 2 * Math.tan(theta), 1e-12);
    expect(r.assumptions.map((a) => a.id)).toContain("model.catalogue-lens-framing");
  });

  it("reports no framed plane where the frame edge lies outside the circular fisheye's image circle", () => {
    const r = calculateChartFraming({ sensor: fullFrame, catalogue: "pv-8-3.5-fisheye-pro", chart: { widthM: 1 }, subjectDistanceM: 1 });
    // The 8 mm's image circle has radius 2·8·sin 45° ≈ 11.3 mm: the 18 mm and 12 mm edges are outside it.
    expect(r.lens!.framedWidthM).toBeNull();
    expect(r.lens!.framedHeightM).toBeNull();
    expect(r.lens!.fieldOfViewDegrees).toEqual({ width: null, height: null });
    expect(r.coverage.frameWidthFraction).toBeLessThan(11.4 / 18);
  });

  it("keeps the thin-lens framing for a rectilinear catalogue lens", () => {
    const lens = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: fullFrame });
    const a = calculateChartFraming({ sensor: fullFrame, catalogue: "pv-50-1.8", chart: { widthM: 0.42, heightM: 0.28 }, subjectDistanceM: 2 });
    const b = calculateChartFraming({ sensor: fullFrame, focalLengthMm: lens.focalLengthMm, chart: { widthM: 0.42, heightM: 0.28 }, subjectDistanceM: 2 });
    close(a.coverage.frameWidthFraction, b.coverage.frameWidthFraction, 1e-14);
    close(a.framedWidthM, b.framedWidthM, 1e-14);
    close(a.lens!.framedWidthM!, b.framedWidthM, 1e-14);
  });

  it("fits every fit mode so that the fitted side's coverage is 1, for both fisheyes and on a crop sensor", () => {
    for (const sensor of [fullFrame, { widthMm: 23.5, heightMm: 15.6 }]) for (const id of FISHEYES) for (const fit of ["contain", "width", "height", "cover"] as const) {
      const chart = { widthM: 0.6, heightM: 0.4 };
      const target = calculateSubjectDistanceForFraming({ sensor, catalogue: id, chart, fit });
      const r = calculateChartFraming({ sensor, catalogue: id, chart, subjectDistanceM: target.subjectDistanceM });
      const { frameWidthFraction: w, frameHeightFraction: h } = r.coverage;
      close(fit === "width" ? w : fit === "height" ? h : fit === "contain" ? Math.max(w, h) : Math.min(w, h), 1, 1e-9);
      close(w, target.coverage.frameWidthFraction, 1e-12);
      expect(target.lens!.lensId).toBe(id);
      expect(target.belowMinimumFocus).toBe(target.subjectDistanceM < target.minimumFocusDistanceM);
    }
  });

  it("refuses a focal length together with a catalogue lens, and unknown catalogue fields", () => {
    expect(() => calculateChartFraming({ sensor: fullFrame, focalLengthMm: 15, catalogue: "pv-15-2.8-fisheye-pro", chart: { widthM: 1 }, subjectDistanceM: 1 }))
      .toThrow(InvalidConfigurationError);
    expect(() => calculateSubjectDistanceForFraming({ sensor: fullFrame, catalogue: { kind: "pv-15-2.8-fisheye-pro", fast: true } as never, chart: { widthM: 1 } }))
      .toThrow(/Unknown catalogue field/);
    expect(() => calculateSubjectDistanceForFraming({ sensor: fullFrame, catalogue: "pv-15", chart: { widthM: 1 } })).toThrow(/catalogue id/);
  });
});

const fisheyeCapture = (id: string, chartWidthM: number, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({
  scene: { preset: "uniform", reflectance: 0.8 }, chartSize: { widthM: chartWidthM, heightM: chartWidthM, surroundReflectance: 0.05 }, subjectDistanceM: 1,
  output: { width: 96, height: 64, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 50 },
  lens: { catalogue: { kind: id, fast: true }, fNumber: 8 }, exposure: { mode: "manual", shutterSeconds: 1 / 30, iso: 100 }, ...extra });

describe("simulateCapture's chart coverage through a catalogue fisheye (#631)", () => {
  it("reports calculateChartFraming's coverage, and the rendered chart has that width", async () => {
    for (const [id, chartWidthM] of [["pv-15-2.8-fisheye-pro", 1.6], ["pv-8-3.5-fisheye-pro", 2]] as const) {
      const r = await simulateCapture(fisheyeCapture(id, chartWidthM));
      const helper = calculateChartFraming({ sensor: fullFrame, catalogue: id, chart: { widthM: chartWidthM, heightM: chartWidthM }, subjectDistanceM: 1 });
      const chart = r.scene.chart!;
      close(chart.frameWidthFraction, helper.coverage.frameWidthFraction, 1e-12);
      close(chart.frameHeightFraction, helper.coverage.frameHeightFraction, 1e-12);
      close(chart.imageWidthPixels, helper.chartImageMm.width / 0.375, 1e-12);
      // The rendered width along the centre row, within a pixel (the PSF and the demosaic blur both edges alike).
      expect(Math.abs(centreRowWidth(r) - chart.imageWidthPixels)).toBeLessThan(1);
      // The thin-lens framing (2.25.0 before #631) put the edges several pixels farther out.
      const thin = chartWidthM * 1e6 * chart.magnification / 375;
      expect(thin - chart.imageWidthPixels).toBeGreaterThan(4);
    }
  }, scaledTimeout(240_000));
});

describe("focus breathing (#632, lens.catalogue.breathing)", () => {
  const macro = (breathing: boolean): SimulateCaptureOptions => ({ scene: { preset: "uniform", reflectance: 0.8 }, chartSize: { widthM: 0.05, heightM: 0.05, surroundReflectance: 0.05 },
    subjectDistanceM: 0.3, output: { width: 384, height: 256, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 36000 / 384, spectralStepNanometers: 50 },
    lens: { catalogue: { kind: "pv-100-2.8-macro-pro", fast: true, breathing }, fNumber: 8 }, exposure: { mode: "manual", shutterSeconds: 1 / 250, iso: 100 } });

  it("narrows the field by the lens's breathing at the focus distance: the chart is 1/(1 + Δ) times larger, as the helpers report", async () => {
    const lens = resolveGenericLens({ lensId: "pv-100-2.8-macro-pro", activeImagingArea: fullFrame, focusDistanceM: 0.3 });
    const delta = lens.character.breathing.fieldOfViewChange;
    expect(delta).toBeLessThan(-0.015);
    const off = await simulateCapture(macro(false)), on = await simulateCapture(macro(true));
    const report = on.assumptions.find((a) => a.id === "lens.catalogue.breathing")!.value as { breathingScale: number; fieldOfViewChange: number };
    close(report.breathingScale, 1 + delta, 1e-14);
    close(on.scene.framedWidthM, off.scene.framedWidthM * (1 + delta), 1e-14);
    close(on.scene.chart!.frameWidthFraction, off.scene.chart!.frameWidthFraction / (1 + delta), 1e-14);
    const helper = calculateChartFraming({ sensor: fullFrame, catalogue: { kind: "pv-100-2.8-macro-pro", breathing: true }, chart: { widthM: 0.05, heightM: 0.05 }, subjectDistanceM: 0.3 });
    close(helper.coverage.frameWidthFraction, on.scene.chart!.frameWidthFraction, 1e-12);
    close(helper.lens!.breathingScale, 1 + delta, 1e-14);
    // Rendered: the chart's width grows by 1/(1 + Δ), within a quarter of a pixel.
    // Rendered: at f/8 the PSF is far inside a site, so the chart's image is its site centres inside the chart: on the centre row, the
    // sites whose plane point d·(1 + Δ)·s/v lies within the chart (s the site's sensor position). Counted within an edge site on each side.
    const v = 100 * 300 / 200, pitchMm = 36 / 384;
    const predicted = (k: number): number => { let n = 0; for (let x = 0; x < 384; x++) if (Math.abs(300 * k * (x + 0.5 - 192) * pitchMm / v) <= 25) n++; return n; };
    expect(Math.abs(centreRowWidth(off) - predicted(1))).toBeLessThan(2);
    expect(Math.abs(centreRowWidth(on) - predicted(1 + delta))).toBeLessThan(2);
    expect(predicted(1 + delta) - predicted(1)).toBeGreaterThan(5);
    expect(off.assumptions.some((a) => a.id === "lens.catalogue.breathing")).toBe(false);
  }, scaledTimeout(240_000));

  it("finds the fit distance with breathing included", () => {
    const chart = { widthM: 0.05, heightM: 0.05 };
    const fit = calculateSubjectDistanceForFraming({ sensor: fullFrame, catalogue: { kind: "pv-100-2.8-macro-pro", breathing: true }, chart });
    const plain = calculateSubjectDistanceForFraming({ sensor: fullFrame, catalogue: "pv-100-2.8-macro-pro", chart });
    close(Math.max(fit.coverage.frameWidthFraction, fit.coverage.frameHeightFraction), 1, 1e-9);
    // A narrower field at close focus: the chart fills the frame from farther away.
    expect(fit.subjectDistanceM).toBeGreaterThan(plain.subjectDistanceM);
    expect(fit.lens!.breathingScale).toBeLessThan(1);
  });

  it("is refused with motion.subject", async () => {
    await expect(simulateCapture({ ...macro(true), motion: { subject: { velocityMPerSec: { x: 0.01, y: 0 } } } })).rejects.toThrow(/breathing cannot be combined with motion.subject/);
    await expect(simulateCapture({ ...macro(true), lens: { catalogue: { kind: "pv-100-2.8-macro-pro", breathing: 1 as never } } })).rejects.toThrow(/must be a boolean/);
  });
});
