// SPDX-License-Identifier: Apache-2.0

/**
 * #567: a catalogue lens's own bokeh with `lens.defocus`, measured on the point grid. The oracle is #553's shaped kernel
 * (`createDefocusBokehSiteKernel`, rows +Y down as the image) for the lens's bokeh options, referred to its balanced focus.
 * Blades: the outline's seven-fold angular term and its phase. Cat's eye: blurring adds cumulants, so the defocused point's
 * centroid and covariance minus those of the same point in focus (the lens's PSF and the point's own size) are the kernel's.
 * Spherical aberration: the rim against the centre in front of and behind the focus plane. A plain disc has no seven-fold
 * term, no centroid shift or tilt and a flat profile, so each check fails for the 2.17.0 disc.
 */
import { describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE, calculateDefocusBokehKernel, resolveGenericLens, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions } from "../src/optics/defocus-bokeh-kernel.js";
import { resolveDefocusDisc } from "../src/optics/defocus-disc-kernel.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** An 18 × 12 mm frame of 6 µm sites; 5 × 3 points at x = 300, 900, …, y = 333, 1000, 1667; subject 2 m. */
const W = 3000, H = 2000, S = 40, AREA = { widthMm: 18, heightMm: 12 };
/** The focus distance that gives a blur of `c` sites behind (side +1) or in front of (−1) the focus plane. */
function focusFor(id: string, N: number, c: number, side: 1 | -1): number {
  const f = resolveGenericLens({ lensId: id, activeImagingArea: AREA }).focalLengthMm / 1000, k = c * 6e-6 * N * (2 - f) / (f * f);
  return side > 0 ? 2 / (1 + k) : 2 / (1 - k);
}
/**
 * `gain`: the exposure over the mid-grey reference (the points are small, so a brighter one lowers their relative shot noise).
 * `extra`: the cat's eye (2.20.0: lens.catalogue's exact method, so `catsEye` sets `fast: !catsEye`), `fast` (default true; null: omitted,
 * the format decides) and output fields (`format`, a smaller region `size`).
 */
const capture = (id: string, N: number, focusDistanceM: number, at: { x: number; y: number }, defocus = true, gain = 96,
  extra: { catsEye?: boolean; fast?: boolean | null; format?: "jpeg" | "png" | "srgb-16"; size?: number } = {}): Promise<SimulateCaptureResult> => simulateCapture({
  scene: { preset: "point-grid", radius: 0.0005, pointReflectance: 0.9, backgroundReflectance: 0 } as SimulateCaptureOptions["scene"], subjectDistanceM: 2,
  output: { width: W, height: H, format: extra.format ?? "srgb-16", region: { x: at.x - (extra.size ?? S) / 2, y: at.y - (extra.size ?? S) / 2, width: extra.size ?? S, height: extra.size ?? S } },
  sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 50 }, exposure: { mode: "manual", shutterSeconds: (N / 8) ** 2 / 125 * gain, iso: 100 },
  lens: { catalogue: id, fNumber: N, focusDistanceM, ...(defocus ? { defocus: { model: "geometric-disc" as const } } : {}) },
  ...(extra.fast === null ? {} : { fast: extra.catsEye !== undefined ? !extra.catsEye : extra.fast ?? true }) });

interface Moments { x: number; y: number; xx: number; yy: number; xy: number; total: number }
/** Weighted moments (rows +Y down) of non-negative weights w[(j)·width + i] about their centroid. */
function moments(w: ArrayLike<number>, width: number): Moments {
  let t = 0, sx = 0, sy = 0;
  for (let k = 0; k < w.length; k++) { const v = w[k]!, i = k % width, j = Math.floor(k / width); t += v; sx += v * i; sy += v * j; }
  const x = sx / t, y = sy / t;
  let xx = 0, yy = 0, xy = 0;
  for (let k = 0; k < w.length; k++) {
    const v = w[k]! / t, dx = (k % width) - x, dy = Math.floor(k / width) - y;
    xx += v * dx * dx; yy += v * dy * dy; xy += v * dx * dy;
  }
  return { x, y, xx, yy, xy, total: t };
}
/** Linear green of the region, the mean of its border (the dark ground) taken off. */
function light(r: SimulateCaptureResult): Float64Array {
  const g = Float64Array.from({ length: S * S }, (_, k) => { const e = r.image.samples[k * 3 + 1]! / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; });
  let ground = 0, n = 0;
  for (let k = 0; k < g.length; k++) { const i = k % S, j = Math.floor(k / S); if (i === 0 || j === 0 || i === S - 1 || j === S - 1) { ground += g[k]!; n++; } }
  return g.map((v) => Math.max(0, v - ground / n));
}
/** #553's kernel for the catalogue lens at this focus, referred to its balanced focus (signed blur σc − b), at a field point (mm, +Y up). */
function oracleKernel(id: string, N: number, focusDistanceM: number, field = { xMm: 0, yMm: 0 }): ReturnType<typeof createDefocusBokehSiteKernel> {
  const lens = resolveGenericLens({ lensId: id, activeImagingArea: AREA, fNumber: N, focusDistanceM });
  const options = resolveDefocusBokehOptions(lens.character.bokeh, "test"), f = lens.focalLengthMm;
  const c = resolveDefocusDisc({ focalLengthMm: f, aperture: N, focusDistanceM, subjectDistanceM: 2, pitchMicrometers: 6 }).diameterSites;
  const side = 2 > focusDistanceM ? 1 : -1, signed = side * c - 8 * N * options.sphericalAberration!.w040Micrometers / 6;
  return createDefocusBokehSiteKernel({ diameterSites: Math.abs(signed), side: signed < 0 ? -1 : 1, fNumber: N, focalLengthMm: f, pitchMicrometers: 6, options,
    field: { x: field.xMm / f, y: field.yMm / f } });
}
function oracle(id: string, N: number, focusDistanceM: number, field: { xMm: number; yMm: number }): Moments {
  const k = oracleKernel(id, N, focusDistanceM, field), m = moments(k.weights, k.width);
  return { ...m, x: m.x - k.radius, y: m.y - k.radius };
}
/** The angular Fourier terms 0–8 (size, phase) of a blob's outline: its radius at half its peak in 168 directions from its centroid (rows +Y down). */
function harmonics(w: ArrayLike<number>, width: number): { size: number; phase: number }[] {
  const m = moments(w, width), peak = Math.max(...Array.from(w)), at = (x: number, y: number): number => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, g = (a: number, b: number): number => (a < 0 || b < 0 || a >= width || b >= width ? 0 : w[b * width + a]!);
    return (1 - v) * ((1 - u) * g(i, j) + u * g(i + 1, j)) + v * ((1 - u) * g(i, j + 1) + u * g(i + 1, j + 1));
  };
  const radii: number[] = [];
  for (let k = 0; k < 168; k++) {
    const a = k / 168 * 2 * Math.PI;
    let t = 0;
    while (t < width && at(m.x + t * Math.cos(a), m.y + t * Math.sin(a)) > peak / 2) t += 0.05;
    radii.push(t);
  }
  return Array.from({ length: 9 }, (_, n) => {
    let re = 0, im = 0;
    radii.forEach((r, k) => { const a = n * k / 168 * 2 * Math.PI; re += r * Math.cos(a); im -= r * Math.sin(a); });
    return { size: Math.hypot(re, im) / 168, phase: Math.atan2(im, re) };
  });
}
/** Cumulants of the defocused point minus those of the point in focus: the blur's own. */
async function blurOf(id: string, N: number, focus: number, at: { x: number; y: number }, catsEye?: boolean): Promise<{ blur: Moments; result: SimulateCaptureResult }> {
  const result = await capture(id, N, focus, at, true, 96, catsEye === undefined ? {} : { catsEye }), sharp = moments(light(await capture(id, N, 2, at, false)), S), blurred = moments(light(result), S);
  return { result, blur: { x: blurred.x - sharp.x, y: blurred.y - sharp.y, xx: blurred.xx - sharp.xx, yy: blurred.yy - sharp.yy, xy: blurred.xy - sharp.xy, total: blurred.total } };
}

describe("catalogue lens bokeh values (#567)", () => {
  it("gives each lens blades, its own W040 and, for the fast wides and normals, a cat's eye matching its optical vignetting", () => {
    const withCatsEye: string[] = [];
    for (const entry of GENERIC_LENS_CATALOGUE) {
      const lens = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } }), b = lens.character.bokeh;
      expect(b.blades, entry.lensId).toEqual(entry.set === "professional" ? { count: 9, firstBladeEdgeAngleDegrees: 0, curvature: 0.7, circularAtOrBelowFNumber: entry.widestFNumber } :
        { count: 7, firstBladeEdgeAngleDegrees: 0, curvature: 0.3, circularAtOrBelowFNumber: entry.widestFNumber });
      expect(b.sphericalAberration).toEqual({ w040Micrometers: lens.character.aberrations.sphericalWaves * 0.55, atFNumber: entry.widestFNumber });
      if (!b.catsEye) continue;
      withCatsEye.push(entry.lensId);
      // Wide open at the frame corner the open pupil is 2^−(optical vignetting stops), the part of the corner fall-off that stopping down
      // removes (resolveGenericLens fades it out by f/(4·N0)).
      const stopped = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 }, fNumber: 4 * entry.widestFNumber });
      const opticalStops = lens.character.vignetting.cornerStops - stopped.character.vignetting.cornerStops;
      const kernel = (N: number): number => calculateDefocusBokehKernel({ focalLengthMm: lens.focalLengthMm, aperture: N, focusDistanceM: 2, subjectDistanceM: 3, pixelPitchMicrometers: 6,
        bokeh: { catsEye: b.catsEye! }, fieldTangent: { x: lens.halfDiagonalMm / lens.focalLengthMm, y: 0 } }).value.openAreaRatio;
      expect(kernel(entry.widestFNumber), entry.lensId).toBeCloseTo(2 ** -opticalStops, 4);
      expect(kernel(2 * entry.widestFNumber)).toBeGreaterThan(kernel(entry.widestFNumber));
    }
    expect(withCatsEye).toEqual(["pv-16-1.8-pro", "pv-20-1.4-pro", "pv-24-1.4-pro", "pv-35-1.2-pro", "pv-50-1.2-pro", "pv-20-2", "pv-24-1.8", "pv-35-1.8", "pv-50-1.8"]);
    // Resolved at a working f-number and close focus, the W040 is the lens's own there (with its close-focus gain).
    const close = resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: AREA, fNumber: 4, focusDistanceM: 0.5 });
    expect(close.character.bokeh.sphericalAberration).toEqual({ w040Micrometers: close.character.aberrations.sphericalWaves * 0.55, atFNumber: 4 });
  });
});

describe("lens.catalogue with lens.defocus renders the lens's bokeh (#567)", () => {
  it("shows the blades: the stopped-down heptagon's seven-fold outline, upright, on the axis", async () => {
    const focus = focusFor("pv-50-1.8", 4, 24, 1), result = await capture("pv-50-1.8", 4, focus, { x: 1500, y: 1000 });
    expect(result.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ execution: "catalogue-lens-psf", bokeh: { method: "pupil-ray-binning", axisOpenAreaRatio: 1 } });
    expect(result.assumptions.find((a) => a.id === "lens.catalogue.character")!.value).toMatchObject({ bokeh: { blades: { count: 7 } } });
    const image = harmonics(light(result), S), kernel = harmonics(oracleKernel("pv-50-1.8", 4, focus).weights, oracleKernel("pv-50-1.8", 4, focus).width);
    // The outline's seven-fold term stands above its neighbours (a disc has none), with the kernel's phase: a vertical flip would turn it by π.
    expect(image[7]!.size).toBeGreaterThan(2 * Math.max(image[5]!.size, image[6]!.size, image[8]!.size));
    expect(image[7]!.size / kernel[7]!.size).toBeGreaterThan(0.5);
    expect(Math.abs(Math.atan2(Math.sin(image[7]!.phase - kernel[7]!.phase), Math.cos(image[7]!.phase - kernel[7]!.phase)))).toBeLessThan(Math.PI / 4);
  }, scaledTimeout(30_000));

  // 2.20.0: the cat's eye is lens.catalogue's exact method, so the defocused point renders exactly: about 13.5 s on an M5 Pro, so a 90 s deadline
  // (GitHub's runners are 2–4× slower; the exact tests below take 60 s for the same reason).
  it("clips a fast normal's blur into a cat's eye toward the corner, in the right orientation", async () => {
    // The top-left point (300, 333): field point up and to the left. The kept light lies toward the field point behind the focus plane.
    const N = 1.8, focus = focusFor("pv-50-1.8", N, 12, 1), at = { x: 300, y: 333 }, { blur, result } = await blurOf("pv-50-1.8", N, focus, at, true);
    const kernel = oracle("pv-50-1.8", N, focus, { xMm: (at.x - W / 2) * 0.006, yMm: (H / 2 - at.y) * 0.006 });
    expect(kernel.x).toBeLessThan(-0.2);
    expect(kernel.y).toBeLessThan(-0.1);
    expect(kernel.xy).toBeLessThan(-0.5);
    // Centroid shift and the tilt of the lemon (long axis across the radius: negative xy for a point up and to the left in rows +Y down).
    expect(blur.x).toBeLessThan(0.5 * kernel.x);
    expect(blur.y).toBeLessThan(0.25 * kernel.y);
    expect(blur.xy / kernel.xy).toBeGreaterThan(0.6);
    expect(blur.xy / kernel.xy).toBeLessThan(1.4);
    expect(result.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ bokeh: { catsEye: true } });
    expect(result.diagnostics.fast?.applied).toEqual({ "lens.catalogue": false });
  }, scaledTimeout(90_000));

  it("leaves the cat's eye out when lens.catalogue resolves to fast: sRGB by default, not the exported formats (the speed rule)", async () => {
    const N = 1.8, focus = focusFor("pv-50-1.8", N, 12, 1), at = { x: 300, y: 333 }, catsEyeOf = (r: SimulateCaptureResult): unknown =>
      (r.assumptions.find((a) => a.id === "lens.defocus")!.value as { bokeh: { catsEye: boolean } }).bokeh.catsEye;
    const plain = await capture("pv-50-1.8", N, focus, at), off = await capture("pv-50-1.8", N, focus, at, true, 96, { catsEye: false });
    expect(catsEyeOf(plain)).toBe(false);
    expect(plain.image.samples).toEqual(off.image.samples);
    expect(plain.assumptions.some((a) => a.id === "fast.lens.catalogue.catsEye")).toBe(true);
    // Without the cat's eye the off-axis blur is the axis kernel: its centroid stays (within the measurement's noise, about 0.5 site)
    // where the in-focus point's is, while the cat's eye's kernel moves it by 1.7 sites.
    const { blur } = await blurOf("pv-50-1.8", N, focus, at, false), clipped = oracle("pv-50-1.8", N, focus, { xMm: (at.x - W / 2) * 0.006, yMm: (H / 2 - at.y) * 0.006 });
    expect(Math.hypot(blur.x, blur.y)).toBeLessThan(0.4 * Math.hypot(clipped.x, clipped.y));
    const jpeg = await capture("pv-50-1.8", N, focus, at, true, 96, { format: "jpeg", size: 16, fast: null });
    expect(catsEyeOf(jpeg)).toBe(true);
    expect(jpeg.diagnostics.fast).toMatchObject({ requested: false, defaultedFrom: "format" });
    expect(catsEyeOf(await capture("pv-50-1.8", N, focus, at, true, 96, { format: "png", size: 16, fast: null }))).toBe(true);
    expect(catsEyeOf(await capture("pv-50-1.8", N, focus, at, true, 96, { format: "jpeg", size: 16, fast: true }))).toBe(false);
    expect(catsEyeOf(await capture("pv-50-1.8", N, focus, at, true, 96, { format: "srgb-16", size: 16, fast: null }))).toBe(false);
    // The 2.20.0 integration folded part F's catsEye option into lens.catalogue's fast resolution: it is no longer a field.
    await expect(simulateCapture({ scene: { preset: "uniform" }, output: { width: 64, height: 48 }, lens: { catalogue: { kind: "pv-50-1.8", catsEye: true } as never } }))
      .rejects.toThrow(/Unknown lens\.catalogue field: catsEye/u);
  }, scaledTimeout(60_000));

  it("renders the same bokeh on the exact catalogue method as on the fast one", async () => {
    // A 16 × 16 region around the top-left point of a lens without a cat's eye: the exact quadrature and the fast field grid agree.
    const id = "pv-200-5.6", N = 5.6, focus = focusFor(id, N, 12, 1), at = { x: 300, y: 333 }, size = 16;
    expect(resolveGenericLens({ lensId: id, activeImagingArea: AREA, fNumber: N }).character.bokeh.catsEye).toBeUndefined();
    const exact = await capture(id, N, focus, at, true, 96, { fast: false, size });
    const fast = await capture(id, N, focus, at, true, 96, { size });
    expect(exact.diagnostics.fast?.applied ?? {}).not.toHaveProperty("lens.catalogue", true);
    expect(fast.diagnostics.fast?.applied).toEqual({ "lens.catalogue": true });
    let peak = 0, worst = 0;
    for (let k = 0; k < size * size; k++) {
      peak = Math.max(peak, exact.image.samples[k * 3 + 1]!);
      worst = Math.max(worst, Math.abs(exact.image.samples[k * 3 + 1]! - fast.image.samples[k * 3 + 1]!));
    }
    expect(worst / peak).toBeLessThan(0.02);
  }, scaledTimeout(60_000));

  it("differs in front of and behind the focus plane with the lens's spherical aberration: soft-edged behind, bright-rimmed in front", async () => {
    const rimOverCentre = (r: SimulateCaptureResult, edge: number): number => {
      const g = light(r), m = moments(g, S);
      let rim = 0, nr = 0, centre = 0, nc = 0;
      for (let k = 0; k < g.length; k++) {
        const d = Math.hypot((k % S) - m.x, Math.floor(k / S) - m.y) / edge;
        if (d < 0.3) { centre += g[k]!; nc++; } else if (d > 0.6 && d < 0.8) { rim += g[k]!; nr++; }
      }
      return (rim / nr) / (centre / nc);
    };
    const id = "pv-200-5.6", N = 5.6, b = 8 * N * resolveGenericLens({ lensId: id, activeImagingArea: AREA, fNumber: N }).character.bokeh.sphericalAberration!.w040Micrometers / 6;
    const behind = await capture(id, N, focusFor(id, N, 10, 1), { x: 1500, y: 1000 }, true, 8), front = await capture(id, N, focusFor(id, N, 10, -1), { x: 1500, y: 1000 }, true, 8);
    // Edges: behind (c + b)/2, in front (c − b)/2 (the balanced focus moves both by −b/2).
    const ratioBehind = rimOverCentre(behind, (10 + b) / 2), ratioFront = rimOverCentre(front, (10 - b) / 2);
    expect(ratioBehind).toBeLessThan(0.7);
    expect(ratioFront).toBeGreaterThan(1.3);
  }, scaledTimeout(30_000));
});
