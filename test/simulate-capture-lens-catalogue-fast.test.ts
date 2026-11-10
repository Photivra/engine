// SPDX-License-Identifier: Apache-2.0
/**
 * #568: `lens.catalogue`'s fast method (`fast: true`). Its sum without the field-grid blend is the exact chain's (checked against
 * the environment PSF quadrature at run-time verification sites to 1e-9); the blend's error is measured site by site against the
 * exact kernels; and the flag follows the #395 convention. The chart measures (edge rise, coma, lateral color, distortion,
 * vignetting) are compared with the exact method in test/simulate-capture-lens-catalogue.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, InvalidConfigurationError, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { CATALOGUE_FAST_VERIFICATION_TOLERANCE, createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const exposureAt = (fNumber: number): NonNullable<SimulateCaptureOptions["exposure"]> => ({ mode: "manual", shutterSeconds: (fNumber / 8) ** 2 / 125, iso: 100 });
/** A whole full frame (36 × 24 mm) W pixels wide, optionally a region of it. */
const fullFrame = (id: string, fNumber: number, W: number, scene: SimulateCaptureOptions["scene"], extra: Partial<SimulateCaptureOptions> = {},
  region?: { x: number; y: number; width: number; height: number }): SimulateCaptureOptions => ({ scene, subjectDistanceM: 5,
  output: { width: W, height: W * 2 / 3, format: "srgb-16", maximumPixels: 2 ** 27, ...(region ? { region } : {}) }, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 50 },
  lens: { catalogue: id, fNumber }, exposure: exposureAt(fNumber), ...extra });
const expected = (r: SimulateCaptureResult): { method: string; verificationRelativeDifference?: number } =>
  r.assumptions.find((a) => a.id === "raw.expectedSignal")!.value as { method: string; verificationRelativeDifference?: number };
const star = { preset: "siemens-star" as const };
/** Squares 23 pixels wide on a 6000-pixel frame: edges in every region. */
const fine = { preset: "checkerboard" as const, squaresAcross: 256, darkReflectance: 0.05, lightReflectance: 0.6 };

afterEach(() => setCatalogueLensSignalTestHook(undefined));

describe("lens.catalogue fast method (#568)", () => {
  it("without the grid blend its sum is the exact chain's: verification sites agree to 1e-9 (rectilinear, fisheye, defocus, regions)", async () => {
    setCatalogueLensSignalTestHook({ exactKernels: true });
    const cases: [string, SimulateCaptureOptions][] = [
      ["PV 24 1.8 wide open, whole frame", fullFrame("pv-24-1.8", 1.8, 96, star, { fast: true })],
      ["PV 24 1.8, spokes at the center", fullFrame("pv-24-1.8", 1.8, 192, star, { fast: true }, { x: 95, y: 63, width: 4, height: 4 })],
      ["PV 50 1.8, 6 µm corner region", fullFrame("pv-50-1.8", 1.8, 6000, { preset: "slanted-edge", angleDegrees: 5 }, { fast: true }, { x: 5800, y: 120, width: 8, height: 8 })],
      ["PV 15 2.8 fisheye, edge of the frame", fullFrame("pv-15-2.8-fisheye-pro", 2.8, 96, { preset: "checkerboard", squaresAcross: 16 }, { fast: true }, { x: 30, y: 0, width: 4, height: 4 })],
      ["PV 8 3.5 fisheye, inside the circle", fullFrame("pv-8-3.5-fisheye-pro", 3.5, 96, { preset: "checkerboard", squaresAcross: 16 }, { fast: true }, { x: 50, y: 30, width: 4, height: 4 })],
      ["PV 50 1.8 with lens.defocus", { ...fullFrame("pv-50-1.8", 4, 384, star, { fast: true }, { x: 190, y: 126, width: 4, height: 4 }),
        subjectDistanceM: 2, lens: { catalogue: "pv-50-1.8", fNumber: 4, focusDistanceM: 1.8, defocus: { model: "geometric-disc" } } }]
    ];
    for (const [name, options] of cases) {
      const r = await simulateCapture(options);
      expect(r.diagnostics.fast.applied["lens.catalogue"], name).toBe(true);
      expect(expected(r).method, name).toBe("tabulated-expected-electrons-catalogue-psf-field-grid");
      expect(expected(r).verificationRelativeDifference!, name).toBeLessThanOrEqual(1e-9);
    }
  }, scaledTimeout(120_000));

  it("the grid blend's error, site by site against the exact kernels, stays within its stated bound", async () => {
    const measure = async (options: SimulateCaptureOptions, sites: (W: number, H: number) => [number, number][]): Promise<{ ofPeak: number; relative: number }> => {
      let captured: CatalogueLensSignalInput | undefined;
      setCatalogueLensSignalTestHook({ onInput: (input) => { captured ??= input; } });
      await simulateCapture(options);
      setCatalogueLensSignalTestHook(undefined);
      const input = captured!, fast = createCatalogueLensSignal(input), exact = createCatalogueLensSignal({ ...input, exactKernels: true });
      let peak = 0, worst = 0, relative = 0;
      const pairs = sites(input.nativeWidth, input.nativeHeight).map(([x, y]) => { const e = exact.site(x, y), f = fast.site(x, y); peak = Math.max(peak, e); return [e, f] as const; });
      for (const [e, f] of pairs) { worst = Math.max(worst, Math.abs(f - e)); if (e > 0) relative = Math.max(relative, Math.abs(f - e) / e); }
      return { ofPeak: worst / peak, relative };
    };
    // Every 7th site of a 768-wide frame (the interactive size) and every site of a 6 µm corner region (the #549 charts' pixels).
    const stride = (W: number, H: number): [number, number][] => { const out: [number, number][] = []; for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) out.push([x, y]); return out; };
    const block = (x0: number, y0: number, n: number) => (): [number, number][] => { const out: [number, number][] = []; for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) out.push([x, y]); return out; };
    const results = {
      consumerWide768: await measure(fullFrame("pv-24-1.8", 1.8, 768, star, { fast: true }), stride),
      appDefault768: await measure(fullFrame("pv-50-1.8", 8, 768, star, { fast: true }), stride),
      consumerCorner6um: await measure(fullFrame("pv-24-1.8", 1.8, 6000, fine, { fast: true }, { x: 5832, y: 120, width: 48, height: 48 }), block(5834, 122, 44)),
      consumerMidField6um: await measure(fullFrame("pv-24-1.8", 1.8, 6000, fine, { fast: true }, { x: 4476, y: 1176, width: 48, height: 48 }), block(4478, 1178, 44)),
      fisheye768: await measure(fullFrame("pv-15-2.8-fisheye-pro", 2.8, 768, star, { fast: true }), stride)
    };
    // Measured 2026-11-09 (#589, the kernels' centroids aligned, at least 10 grid cells per interval): at most 2.0e-4 of the frame's
    // peak (6 µm mid-field) and 3.4e-3 of a site's own value (768 × 512, PV 24 1.8 wide open); docs/LENS_CATALOGUE.md.
    for (const [name, v] of Object.entries(results)) {
      expect(v.ofPeak, name).toBeLessThan(1e-3);
      expect(v.relative, name).toBeLessThan(CATALOGUE_FAST_VERIFICATION_TOLERANCE);
    }
  }, scaledTimeout(300_000));

  it("follows the exact-or-fast convention: off by default, the top-level flag, the record's kind and fast, and the report", async () => {
    const options = (lens: Record<string, unknown>, fast?: boolean): SimulateCaptureOptions => ({ ...fullFrame("pv-50-1.8", 8, 96, star), lens: { ...lens, fNumber: 8 } as never,
      ...(fast === undefined ? {} : { fast }) });
    const exact = await simulateCapture(options({ catalogue: "pv-50-1.8" }));
    expect(exact.diagnostics.fast).toEqual({ requested: false, applied: { "lens.catalogue": false }, assurance: "engine-reference" });
    expect(exact.assumptions.some((a) => a.id === "raw.expectedSignal")).toBe(false);
    expect(exact.assumptions.some((a) => a.id === "fast.lens.catalogue")).toBe(false);
    const top = await simulateCapture(options({ catalogue: "pv-50-1.8" }, true)), record = await simulateCapture(options({ catalogue: { kind: "pv-50-1.8", fast: true } }));
    for (const r of [top, record]) {
      expect(r.diagnostics.fast).toEqual({ requested: true, applied: { "lens.catalogue": true }, assurance: "approximation-with-a-priori-bound" });
      const assumption = r.assumptions.find((a) => a.id === "fast.lens.catalogue")!;
      expect((assumption.value as { method: string }).method).toBe("field-grid-bilinear-psf");
      expect(assumption.explanation).toMatch(/approximation/);
    }
    expect(Array.from(record.image.samples)).toEqual(Array.from(top.image.samples));
    // The record's fast: false overrides the top-level flag; the record without fast is the shorthand.
    const overridden = await simulateCapture(options({ catalogue: { kind: "pv-50-1.8", fast: false } }, true));
    expect(overridden.diagnostics.fast).toEqual({ requested: true, applied: { "lens.catalogue": false }, assurance: "engine-reference" });
    expect(Array.from(overridden.image.samples)).toEqual(Array.from(exact.image.samples));
    expect(Array.from((await simulateCapture(options({ catalogue: { kind: "pv-50-1.8" } }))).image.samples)).toEqual(Array.from(exact.image.samples));
    // The fast image differs from the exact one only where the blend's tiny error moves a Poisson draw by an electron (most codes are equal).
    let worst = 0, differing = 0;
    top.image.samples.forEach((v, i) => { const d = Math.abs(v - exact.image.samples[i]!); worst = Math.max(worst, d); if (d > 0) differing++; });
    // #589: 3.9 % of the codes differ here (96 × 64 at 375 µm: the blend of the aligned narrow kernels), by at most 91 (before #589,
    // where every kernel at this pitch was a single tap, under 2 %).
    expect(differing / top.image.samples.length).toBeLessThan(0.05);
    expect(worst).toBeLessThan(512);
  }, scaledTimeout(120_000));

  it("runs exact where the fast method does not apply, and refuses malformed records", async () => {
    // A box pixel aperture queries off the site centers: the exact method runs and the report says so.
    const box = await simulateCapture({ ...fullFrame("pv-50-1.8", 8, 48, star, { fast: true }), sensor: { pixelPitchMicrometers: 750, spectralStepNanometers: 80, pixelAperture: { kind: "box", samplesPerAxis: 2 } } });
    expect(box.diagnostics.fast.applied).toEqual({ "lens.catalogue": false, "sensor.pixelAperture.box": false });
    for (const catalogue of [{ kind: 50 }, { kind: "pv-50-1.8", fast: "yes" }, { kind: "pv-50-1.8", extra: 1 }, { fast: true }])
      await expect(simulateCapture({ ...fullFrame("pv-50-1.8", 8, 48, star), lens: { catalogue, fNumber: 8 } as never })).rejects.toThrow(InvalidConfigurationError);
    // The display view renders the record form with #569's per-zone PSF; the fast method is the capture's only, so it reports false.
    const view = await simulateDisplayView({ ...fullFrame("pv-50-1.8", 8, 48, star), lens: { catalogue: { kind: "pv-50-1.8", fast: true } } }, { width: 12, height: 8 });
    expect(view.diagnostics.fast).toMatchObject({ requested: true, applied: { "lens.catalogue": false }, assurance: "engine-reference" });
  }, scaledTimeout(120_000));
});
