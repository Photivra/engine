// SPDX-License-Identifier: Apache-2.0

/**
 * #589: the lateral color `simulateCapture` renders with `lens.catalogue`, measured where neither the blur nor the demosaic
 * enters, against the lens's own model Δr(λ) = L·R·H·D(λ) (docs/LENS_CATALOGUE.md, "Models").
 *
 * The measure: an isolated source on one lattice point of a corner region, and the intensity centroid of each
 * CFA channel's RAW sites, from the sites' expected electrons (the mean the capture's Poisson draws are made from), fast blend
 * and exact kernels. A channel's sites sample every second tap of the kernel, so the source is put on the four lattice points
 * of one 2 × 2 cell in turn: summed over the four, each channel sees every tap once, and its centroid is the channel-weighted
 * kernel centroid exactly. Any blur common to the channels drops out of the blue-minus-red difference, and nothing is
 * demosaiced or color-converted.
 *
 * The model is taken at the channels' own effective dispersion D̄_c = Σ A_c(λ)·L_white(λ)·D(λ) / Σ A_c(λ)·L_white(λ), with
 * A_c the capture's own channel response at its spectral nodes; with single wavelengths of 610 and 465 nm (the lens
 * corrections' channel wavelengths) the model is larger by the ratio checked below. The developed edge measure of
 * test/simulate-capture-lens-catalogue.test.ts is not this displacement; docs/LENS_CATALOGUE.md, "Lateral color in RAW".
 */
import { afterEach, describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE, resolveGenericLens, simulateCapture, type SimulateCaptureResult } from "../src/index.js";
import { createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

afterEach(() => setCatalogueLensSignalTestHook(undefined));

const PRO = "pv-24-1.4-pro", CONSUMER = "pv-24-1.8", PITCH = 6, SIZE = 48;
const FULL_FRAME = { widthMm: 36, heightMm: 24 };
const widest = (id: string): number => GENERIC_LENS_CATALOGUE.find((lens) => lens.lensId === id)!.widestFNumber;

/**
 * A 48-pixel region of a full frame at 6 µm, 120 pixels in from the top-right corner (as in
 * test/simulate-capture-lens-catalogue.test.ts), wide open, the default 20 nm spectral step. Returns the capture and the catalogue
 * signal's input (the PSF, channel responses and scene).
 */
async function corner(id: string): Promise<{ result: SimulateCaptureResult; input: CatalogueLensSignalInput }> {
  const W = 36000 / PITCH, H = 24000 / PITCH, x = W - 120 - SIZE, y = 120;
  let input: CatalogueLensSignalInput | undefined;
  setCatalogueLensSignalTestHook({ onInput: (given) => { input ??= given; } });
  const result = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.5 }, subjectDistanceM: 3, fast: true,
    output: { width: W, height: H, maximumPixels: 2 ** 27, format: "srgb-16", region: { x, y, width: SIZE, height: SIZE } },
    sensor: { pixelPitchMicrometers: PITCH }, lens: { catalogue: id, fNumber: widest(id) }, exposure: { mode: "manual", shutterSeconds: (widest(id) / 8) ** 2 / 125, iso: 100 } });
  setCatalogueLensSignalTestHook(undefined);
  expect(result.diagnostics.fast.applied["lens.catalogue"]).toBe(true);
  return { result, input: input! };
}

/**
 * Blue-minus-red RAW centroid (sites, +x right, +y up) of a point source on the lattice point nearest the region's centre,
 * summed over the four points of its 2 × 2 cell. The scene is replaced by one bright lattice point; the lattice points' chart
 * coordinates are read from the signal's own scene queries.
 */
function blueMinusRed(input: CatalogueLensSignalInput, rect: { x: number; y: number; width: number; height: number }, exactKernels: boolean): { x: number; y: number; site: { x: number; y: number } } {
  const x1 = rect.x + rect.width, y1 = rect.y + rect.height, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const queried = new Map<string, [number, number]>();
  const probe = createCatalogueLensSignal({ ...input, scene: { ...input.scene, materialAt: (u, v) => { queried.set(u + ":" + v, [u, v]); return 0; } } });
  probe.window(rect.x, rect.y, x1, y1);
  probe.site(cx, cy);
  const points = [...queried.values()], step = 2 / input.nativeWidth;
  const nearest = (u: number, v: number): [number, number] => points.reduce((best, p) => (Math.hypot(p[0] - u, p[1] - v) < Math.hypot(best[0] - u, best[1] - v) ? p : best));
  const mean = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length], [0, 0]);
  // The lattice point at the centre of the queried patch and its neighbours to the right (+u), below (−v) and both.
  const p00 = nearest(mean[0]!, mean[1]!), p10 = nearest(p00[0] + step, p00[1]), p01 = nearest(p00[0], p00[1] - step), p11 = nearest(p10[0], p10[1] - step);
  const sums = [0, 1, 2].map(() => ({ e: 0, x: 0, y: 0 }));
  for (const [[pu, pv], dx, dy] of [[p00, 0, 0], [p10, 1, 0], [p01, 0, 1], [p11, 1, 1]] as const) {
    const signal = createCatalogueLensSignal({ ...input, exactKernels, scene: { ...input.scene, materials: [{ neutral: 0 }, { neutral: 1 }],
      materialAt: (u, v) => (Math.abs(u - pu) < step * 1e-6 && Math.abs(v - pv) < step * 1e-6 ? 1 : 0) } });
    signal.window(rect.x, rect.y, x1, y1);
    for (let y = rect.y; y < y1; y++) for (let x = rect.x; x < x1; x++) {
      const e = signal.site(x, y), s = sums[input.channelAt(x, y)]!;
      s.e += e; s.x += e * (x - dx); s.y += e * (y - dy);
    }
  }
  for (const s of sums) expect(s.e).toBeGreaterThan(0);
  const [red, , blue] = sums.map((s) => ({ x: s.x / s.e, y: s.y / s.e }));
  // Native rows run down the frame: +y up is minus the row.
  return { x: blue!.x - red!.x, y: -(blue!.y - red!.y), site: { x: Math.round(red!.x), y: Math.round(red!.y) } };
}

/** The channel-weighted dispersion D̄_c of channel c (0 red, 2 blue) for the neutral scene: the capture's own channel response. */
function effectiveDispersion(input: CatalogueLensSignalInput, channel: number): number {
  let weighted = 0, total = 0;
  input.wavelengthsNm.forEach((nm, n) => { const w = input.electronsPerRadiance[channel]![n]! * input.scene.whiteRadiance[n]!; weighted += w * genericLensDispersion(nm); total += w; });
  return weighted / total;
}

describe("lens.catalogue lateral color in RAW, against the lens model (#589)", () => {
  it("the large-blur consumer corner renders the model's L·R·H·(D̄_blue − D̄_red); the small-blur pro corner falls short (cell quantization)", async () => {
    const share: Record<string, { radial: number; angleDegrees: number; x: number; y: number }> = {};
    for (const id of [PRO, CONSUMER]) {
      const { result, input } = await corner(id), rect = result.region!.nativeRect;
      const fast = blueMinusRed(input, rect, false), exact = blueMinusRed(input, rect, true);
      // The fast method's blend and the exact method's per-site kernels give the same centroids.
      expect(Math.abs(exact.x - fast.x) + Math.abs(exact.y - fast.y), id).toBeLessThan(2e-3);
      // The model at the source's site: Δ = L·(D̄_blue − D̄_red)·(x, y) with (x, y) the image point (Δr = L·R·H·D = L·r·D).
      const L = resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME }).character.lateralColor.fraction;
      const mm = PITCH / 1000, px = (exact.site.x + 0.5 - input.nativeWidth / 2) * mm, py = -(exact.site.y + 0.5 - input.nativeHeight / 2) * mm;
      const dD = effectiveDispersion(input, 2) - effectiveDispersion(input, 0), model = { x: L * dD * px * 1000 / PITCH, y: L * dD * py * 1000 / PITCH };
      share[id] = { radial: Math.hypot(exact.x, exact.y) / Math.hypot(model.x, model.y), angleDegrees: (Math.atan2(exact.y, exact.x) - Math.atan2(model.y, model.x)) * 180 / Math.PI,
        x: exact.x, y: exact.y };
      // The single-wavelength model (610 and 465 nm, the lens corrections' channel wavelengths) is larger: this sensor's red channel
      // reaches into the green and blue (effective dispersion 0.20, about 566 nm), its blue channel's is 1.04 (about 454 nm).
      expect(dD / (genericLensDispersion(465) - genericLensDispersion(610))).toBeCloseTo(0.833, 2);
    }
    // Measured November 9, 2026 (6 µm, 20 nm step), share of the model: consumer 103 % radially, 2° off the radial direction
    // (x 101 %, y 109 %; 0.80 px right and 0.56 px up); the consumer's large blur does not reduce its lateral color.
    const consumer = share[CONSUMER]!, pro = share[PRO]!;
    expect(consumer.radial).toBeGreaterThan(0.97);
    expect(consumer.radial).toBeLessThan(1.06);
    expect(Math.abs(consumer.angleDegrees)).toBeLessThan(3);
    expect(consumer.x).toBeCloseTo(0.80, 1);
    // The pro lens's PSF is narrower than a site: the node kernels' site cells quantize its centroid and the render gives 64 %
    // radially, 14° towards the x axis (x 73 %, y 38 %; 0.17 and 0.06 px). Pinned as found; docs/LENS_CATALOGUE.md.
    expect(pro.radial).toBeGreaterThan(0.6);
    expect(pro.radial).toBeLessThan(0.8);
    expect(pro.angleDegrees).toBeLessThan(-8);
    expect(consumer.x / pro.x).toBeGreaterThan(3);
  }, scaledTimeout(120_000));
});
