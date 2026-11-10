// SPDX-License-Identifier: Apache-2.0

/**
 * #589: the lateral color `simulateCapture` renders with `lens.catalogue`, measured where neither the blur nor the demosaic
 * enters, against the lens's own model Δr(λ) = L·R·H·D(λ) (docs/LENS_CATALOGUE.md, "Models").
 *
 * The measure: an isolated source on one lattice point of a corner (or mid-field) region, and the intensity centroid of each
 * CFA channel's RAW sites, from the sites' expected electrons (the mean the capture's Poisson draws are made from), fast blend
 * and exact kernels. A channel's sites sample every second tap of the kernel, so the source is put on the four lattice points
 * of one 2 × 2 cell in turn: summed over the four, each channel sees every tap once, and its centroid is the channel-weighted
 * kernel centroid exactly. Any blur common to the channels drops out of the blue-minus-red difference, and nothing is
 * demosaiced or color-converted.
 *
 * The model is taken at the channels' own effective dispersion D̄_c = Σ A_c(λ)·L_white(λ)·D(λ) / Σ A_c(λ)·L_white(λ), with
 * A_c the capture's own channel response at its spectral nodes; with single wavelengths of 610 and 465 nm (the lens
 * corrections' channel wavelengths) the model is larger by the ratio checked below.
 */
import { afterEach, describe, expect, it } from "vitest";
import { calculateChannelEffectiveDispersion, createGenericLensCorrectionProfile, GENERIC_LENS_CATALOGUE, InvalidConfigurationError, InvalidScientificInputError, resolveGenericLens, simulateCapture,
  type SimulateCaptureResult } from "../src/index.js";
import { createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";
import { createGenericLensPsfProfile } from "../src/optics/generic-lens-psf.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

afterEach(() => setCatalogueLensSignalTestHook(undefined));

const PRO = "pv-24-1.4-pro", CONSUMER = "pv-24-1.8", PITCH = 6, SIZE = 48;
const FULL_FRAME = { widthMm: 36, heightMm: 24 };
const widest = (id: string): number => GENERIC_LENS_CATALOGUE.find((lens) => lens.lensId === id)!.widestFNumber;

/**
 * A 48-pixel region of a full frame at 6 µm, wide open, the default 20 nm spectral step: at the corner (120 pixels in from the
 * top-right, as in test/simulate-capture-lens-catalogue.test.ts) or mid-field (centred at half the frame's half-width and
 * half-height, up and right). Returns the capture and the catalogue signal's input (the PSF, channel responses and scene).
 */
async function region(id: string, where: "corner" | "mid"): Promise<{ result: SimulateCaptureResult; input: CatalogueLensSignalInput }> {
  const W = 36000 / PITCH, H = 24000 / PITCH, [x, y] = where === "corner" ? [W - 120 - SIZE, 120] : [W * 3 / 4 - SIZE / 2, H / 4 - SIZE / 2];
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
  const at = (c: number): number[] => Array.from(input.electronsPerRadiance[c]!);
  const d = calculateChannelEffectiveDispersion({ wavelengthsNm: [...input.wavelengthsNm], channelResponse: { red: at(0), green: at(1), blue: at(2) }, illuminant: Array.from(input.scene.whiteRadiance) }).value;
  return channel === 0 ? d.red : channel === 1 ? d.green : d.blue;
}

describe("lens.catalogue lateral color in RAW, against the lens model (#589)", () => {
  it("the blue-minus-red RAW displacement is L·R·H·(D̄_blue − D̄_red), corner and mid-field, both lenses, fast and exact", async () => {
    const measured: Record<string, { x: number; y: number }> = {};
    for (const id of [PRO, CONSUMER]) for (const where of ["corner", "mid"] as const) {
      const { result, input } = await region(id, where), rect = result.region!.nativeRect;
      const fast = blueMinusRed(input, rect, false);
      if (where === "corner") {
        // The fast method's blend and the exact method's per-site kernels give the same centroids.
        const exact = blueMinusRed(input, rect, true);
        expect(Math.abs(exact.x - fast.x) + Math.abs(exact.y - fast.y), id).toBeLessThan(2e-3);
      }
      // The model at the source's site: Δ = L·(D̄_blue − D̄_red)·(x, y) with (x, y) the image point (Δr = L·R·H·D = L·r·D).
      const L = resolveGenericLens({ lensId: id, activeImagingArea: FULL_FRAME }).character.lateralColor.fraction;
      const mm = PITCH / 1000, px = (fast.site.x + 0.5 - input.nativeWidth / 2) * mm, py = -(fast.site.y + 0.5 - input.nativeHeight / 2) * mm;
      const dD = effectiveDispersion(input, 2) - effectiveDispersion(input, 0), model = { x: L * dD * px * 1000 / PITCH, y: L * dD * py * 1000 / PITCH };
      // Measured November 9, 2026 (20 nm step): pro corner 96 / 97 %, mid-field 99 / 99 %; consumer corner 101 / 101 %, mid-field
      // 101 / 101 % of the model (x / y). Before #589 the site cells quantized and the window truncated the kernels' centroids:
      // pro corner 73 / 38 %, mid-field 19 / 12 %; consumer corner 101 / 109 %, mid-field 121 / 83 %.
      expect(fast.x / model.x, id + " " + where + " x").toBeGreaterThan(0.95);
      expect(fast.x / model.x, id + " " + where + " x").toBeLessThan(1.03);
      expect(fast.y / model.y, id + " " + where + " y").toBeGreaterThan(0.95);
      expect(fast.y / model.y, id + " " + where + " y").toBeLessThan(1.03);
      measured[id + " " + where] = fast;
      // The single-wavelength model (610 and 465 nm, the lens corrections' channel wavelengths) is larger: this sensor's red channel
      // reaches into the green and blue (effective dispersion 0.20, about 566 nm), its blue channel's is 1.04 (about 454 nm).
      expect(dD / (genericLensDispersion(465) - genericLensDispersion(610))).toBeCloseTo(0.833, 2);
    }
    // At 6 µm: consumer corner 0.80 px right and 0.52 px up, pro 0.22 and 0.15 px; the consumer's is 3.6 times the pro's (its L).
    expect(measured[CONSUMER + " corner"]!.x).toBeCloseTo(0.80, 1);
    expect(measured[PRO + " corner"]!.x).toBeCloseTo(0.22, 1);
    expect(measured[CONSUMER + " corner"]!.x / measured[PRO + " corner"]!.x).toBeGreaterThan(3);
  }, scaledTimeout(120_000));

  it("every node kernel's centroid is its PSF's first moment, the lateral color plus coma's mean tilt, on every lens", () => {
    const field = { fieldHalfExtentMm: { x: 18.05, y: 12.05 }, frameHalfMm: { x: 18, y: 12 }, evidence: [{ sourceOrigin: "photivra" as const, sourceReference: "test:589", reuseStatus: "photivra-owned" as const }] };
    let worst = 0, checked = 0;
    for (const entry of GENERIC_LENS_CATALOGUE) for (const pitch of [1.5, 6, 24]) {
      const lens = resolveGenericLens({ lensId: entry.lensId, activeImagingArea: FULL_FRAME, focusDistanceM: 10 }), c = lens.character;
      const psf = createGenericLensPsfProfile({ lens, focusDistanceM: 10, sitePitchMicrometers: pitch, ...field });
      const z = 1 / (1 / lens.focalLengthMm - 1 / 10000), workingF = z / (lens.focalLengthMm / c.fNumber);
      for (const node of psf.profile.nodes) {
        const k = node.kernel, w = k.widthSamples, at = node.coordinate, r = Math.hypot(at.fieldXmm, at.fieldYmm), H = Math.min(1, r / lens.halfDiagonalMm);
        let sum = 0, mx = 0, my = 0;
        k.normalizedIntensity.forEach((v, i) => { sum += v; mx += v * (i % w - k.centerSampleX); my += v * (Math.floor(i / w) - k.centerSampleY); });
        // 2·N_w·W131·H (W131 in µm at 550 nm) plus L·R·H·D(λ), along the field azimuth, in sites.
        const radial = (c.lateralColor.fraction * lens.halfDiagonalMm * 1000 * H * genericLensDispersion(at.wavelengthNm) + 2 * workingF * 0.55 * c.aberrations.comaWaves * H) / pitch;
        const tx = r > 0 ? radial * at.fieldXmm / r : 0, ty = r > 0 ? radial * at.fieldYmm / r : 0;
        // On the axis the PSF is symmetric (to rounding, which the alignment leaves alone).
        if (r === 0) { expect(Math.abs(mx / sum) + Math.abs(my / sum)).toBeLessThan(1e-8); continue; }
        // A centroid within a site of the window's edge cannot be reached (the PSF does not fit the largest window).
        if (Math.max(Math.abs(tx), Math.abs(ty)) > k.centerSampleX - 1) continue;
        worst = Math.max(worst, Math.abs(mx / sum - tx), Math.abs(my / sum - ty)); checked++;
      }
    }
    // Measured: at most 0.0045 sites over 7,328 nodes (the long telephotos at 1.5 µm, energy held at the window's edge).
    expect(checked).toBeGreaterThan(7_000);
    expect(worst).toBeLessThan(0.005);
  }, scaledTimeout(60_000));
});

describe("calculateChannelEffectiveDispersion and the correction profile's channelDispersion (#589)", () => {
  const nodes = [450, 550, 650];
  it("is each channel's response × illuminant weighted mean of D(λ), and the capture's lens corrections use it", async () => {
    const r = calculateChannelEffectiveDispersion({ wavelengthsNm: nodes, channelResponse: { red: [0, 1, 3], green: [1, 2, 1], blue: [2, 0, 0] }, illuminant: [1, 1, 2] });
    expect(r.provenance.kind).toBe("approximation");
    const D = genericLensDispersion;
    expect(r.value.red).toBeCloseTo((D(550) + 6 * D(650)) / 7, 14);
    expect(r.value.green).toBeCloseTo((D(450) + 2 * D(550) + 2 * D(650)) / 5, 14);
    expect(r.value.blue).toBe(D(450));
    // The scale of the response and of the illuminant cancels.
    const scaled = calculateChannelEffectiveDispersion({ wavelengthsNm: nodes, channelResponse: { red: [0, 7, 21], green: [7, 14, 7], blue: [14, 0, 0] }, illuminant: [3, 3, 6] }).value;
    expect(scaled.red).toBeCloseTo(r.value.red, 14);
    // The capture reports the dispersion its lens corrections use: the one this helper gives for its channels (test below's input).
    const { result, input } = await region(CONSUMER, "corner");
    const corrected = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 48, height: 32, lensCorrections: { lateralColor: true } }, sensor: { pixelPitchMicrometers: 750 },
      lens: { catalogue: CONSUMER, fNumber: 1.8 },
      exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } });
    const reported = (corrected.assumptions.find((a) => a.id === "output.lensCorrections")!.value as { channelDispersion: { red: number; blue: number } }).channelDispersion;
    expect(reported.red).toBeCloseTo(effectiveDispersion(input, 0), 12);
    expect(reported.blue).toBeCloseTo(effectiveDispersion(input, 2), 12);
    expect(result.region).toBeDefined();
  }, scaledTimeout(60_000));

  it("takes channelDispersion in createGenericLensCorrectionProfile (default: the generic channel wavelengths) and refuses bad input", () => {
    const area = { widthMm: 36, heightMm: 24 }, lens = resolveGenericLens({ lensId: CONSUMER, activeImagingArea: area, fNumber: 1.8 });
    const state = { bodyId: "b", bodyVersion: "1", lensId: CONSUMER, lensVersion: "1", focalLengthMm: lens.focalLengthMm, aperture: 1.8, focusDistanceM: 5, captureMode: "still" as const,
      outputWidth: 60, outputHeight: 40, frameRateHz: 0, stabilizationMode: "off" };
    type Affine = { transforms: Record<string, { matrix: number[] }> };
    const scales = (channelDispersion?: { red: number; green: number; blue: number }): Record<string, number> => {
      const ca = createGenericLensCorrectionProfile({ lensId: CONSUMER, activeImagingArea: area, state, ...(channelDispersion ? { channelDispersion } : {}) }).components[1] as unknown as Affine;
      return Object.fromEntries(Object.entries(ca.transforms).map(([c, t]) => [c, t.matrix[0]!]));
    };
    const L = lens.character.lateralColor.fraction;
    expect(scales()).toEqual({ red: 1 + L * genericLensDispersion(610), green: 1 + L * genericLensDispersion(540), blue: 1 + L * genericLensDispersion(465) });
    expect(scales({ red: 0.2, green: 0.19, blue: 1.04 })).toEqual({ red: 1 + L * 0.2, green: 1 + L * 0.19, blue: 1 + L * 1.04 });
    expect(() => scales({ red: 5, green: 0, blue: 0 })).toThrow(InvalidScientificInputError);
    expect(() => createGenericLensCorrectionProfile({ lensId: CONSUMER, activeImagingArea: area, state, channelDispersion: { red: 0, green: 0, blue: 0, alpha: 0 } as never })).toThrow(InvalidConfigurationError);
    const ok = { wavelengthsNm: nodes, channelResponse: { red: [1, 1, 1], green: [1, 1, 1], blue: [1, 1, 1] }, illuminant: [1, 1, 1] };
    for (const bad of [{ ...ok, wavelengthsNm: [450, 450, 650] }, { ...ok, wavelengthsNm: [200, 550, 650] }, { ...ok, illuminant: [1, -1, 1] }, { ...ok, illuminant: [1, 1] },
      { ...ok, channelResponse: { ...ok.channelResponse, blue: [0, 0, 0] } }, { ...ok, channelResponse: { ...ok.channelResponse, red: [NaN, 1, 1] } }])
      expect(() => calculateChannelEffectiveDispersion(bad), JSON.stringify(bad)).toThrow(InvalidScientificInputError);
    expect(() => calculateChannelEffectiveDispersion({ ...ok, extra: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});
