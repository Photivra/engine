// SPDX-License-Identifier: Apache-2.0

/**
 * #739 (2.28.0): the body of `simulateFalseColor` (false-color-entry.ts), loaded on demand as its own chunk. It imports no engine
 * module at run time: the entry passes it the facade functions it uses ({@link FalseColorDeps}), so its chunk holds this module only.
 *
 * What it computes. For every native site the request's expected photo electrons are read three times, once per channel response
 * (red, green, blue), through the display view's expected signal with the site's channel fixed (`channelAt: () => c`): the same
 * optics, anti-aliasing filter, pixel aperture, exposure and site lattice as the capture, each site integrated from the spectrum it
 * reads when it is read (no table holds a value per channel). The plane of a site's own CFA channel is the capture's noise-free
 * mosaic. Both images are developed by the view's own noise-free chain: the normalized value k_c·(E + dark) clipped at white, the
 * white-balance gains, the highlight clip at the smallest gain, the camera → linear sRGB matrix, the tone curve and the clip to
 * [0, 1]. The capture side demosaics the mosaic first (the bilinear kernels, or AHD's two candidates and its homogeneity choice on
 * the noise-free mosaic, a tie averaging them, as `createAhdDemosaicTask`); the reference develops each site's three planes as they
 * are (a full-color sensor). Per output pixel the metric is the a*b* distance of the two in CIELAB (D65 white, `portableCbrt`).
 */

import type { PreparedDisplayView } from "./simulate-display-view.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput, DisplayViewKernelTap, DisplayViewSetup } from "./display-view.js";
import type { DisplayViewResult, SimulateCaptureAssumption, SimulateCaptureOptions } from "./simulate-capture.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";

/** Measurement options of {@link FalseColorResult} (the second argument of `simulateFalseColor`). */
export interface SimulateFalseColorOptions {
  /** Output-pixel rectangle of the frame to measure. Default: the whole frame. Its values equal the same pixels of the whole frame bit for bit. */
  region?: { x: number; y: number; width: number; height: number };
  /** Up to 8 strictly increasing CIELAB a*b* differences in (0, 200] for `chromaDifference.fractionAbove`. Default [1, 2, 5] (reporting levels; no claim about visibility). */
  thresholds?: readonly number[];
  /** `true` or `{ maximum }`: also return the per-pixel map. `maximum` (default 20, in (0, 200]) is the difference shown as white. */
  map?: boolean | { maximum?: number };
  /** Also return the two developed images (sRGB 8-bit RGBA). Default false. */
  images?: boolean;
}

/** Limits of {@link SimulateFalseColorOptions} (exported by the entry as SIMULATE_FALSE_COLOR_LIMITS). */
const LIMITS = { maximumThresholds: 8, maximumDifference: 200 } as const;

/** Result of `simulateFalseColor`: the demosaic's color error per output pixel, summarized. Not a capture. */
export interface FalseColorResult {
  kind: "false-color";
  label: string;
  facadeVersion: string;
  engineApiVersion: string;
  /** The measured rectangle, in output pixels. */
  width: number;
  height: number;
  region?: { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number };
  demosaic: "bilinear" | "ahd";
  /** d = √((a*₁ − a*₂)² + (b*₁ − b*₂)²) per pixel, summarized; the percentiles from a histogram of resolution 0.01 (each the upper edge of its bin, at most the maximum). */
  chromaDifference: {
    pixelCount: number; mean: number; rootMeanSquare: number; median: number; percentile95: number; percentile99: number;
    maximum: number; maximumAt: { x: number; y: number };
    fractionAbove: readonly { threshold: number; fraction: number }[];
  };
  /** Mean CIE 1976 ΔE*ab (lightness included), for context. */
  colorDifference: { meanDeltaE76: number };
  /** Mean CIELAB chroma C*ab of each image: tells a neutral scene from a colored one. */
  meanChroma: { capture: number; reference: number };
  /** `measure.map`: d per pixel (row-major) and a gray image of min(1, d / maximum), sRGB-encoded, alpha 255. */
  map?: { width: number; height: number; maximum: number; values: Float32Array; rgba: Uint8ClampedArray };
  /** `measure.images`: the capture-side and reference images, developed, sRGB 8-bit RGBA. */
  images?: { capture: Uint8ClampedArray; reference: Uint8ClampedArray };
  exposure: DisplayViewResult["exposure"];
  scene: DisplayViewResult["scene"];
  diagnostics: { siteEvaluations: number; sceneLookups: number; timingsMs: { signal: number; measure: number; total: number } };
  provenance: { scientificStatus: "approximation"; cameraPresetId: string; cameraPresetVersion: string; evidence: readonly EvidenceProvenance[]; composedContracts: readonly string[];
    limitations: readonly string[] };
  /** The request's assumptions, then `falseColor.reference`, `falseColor.capture` and `falseColor.metric`. */
  assumptions: readonly SimulateCaptureAssumption[];
}

/** What a prepared view's parts give this module (simulate-display-view.ts, PreparedViewParts). */
interface Parts {
  setupOf(v: { width: number; height: number; samplesPerAxis: number; bitDepth: 8 | 16; format: "srgb-8" | "srgb-16"; region?: { x: number; y: number; width: number; height: number } },
    run: { started: number; viewStarted: number; checkAbort(): void; yieldControl(): Promise<void> }): { setup: DisplayViewSetup; signal: DisplayViewExpectedSignal };
  context: Record<string, unknown> & { width: number; height: number; lens?: ((input: DisplayViewExpectedSignalInput, span?: number) => DisplayViewExpectedSignal) | undefined };
}

/** The facade functions the body uses, passed by the entry (false-color-entry.ts) so that this chunk imports nothing. */
export interface FalseColorDeps {
  prepareDisplayView(options: SimulateCaptureOptions, prepareOptions: { gpu: "off" }): Promise<PreparedDisplayView>;
  parts(prepared: PreparedDisplayView): Parts;
  createSignal(input: DisplayViewExpectedSignalInput, spanColumns?: number): DisplayViewExpectedSignal;
  createAhdDirectionPlane(labMatrix: readonly (readonly number[])[], nativeWidth: number, nativeHeight: number, columns: number, rows: number,
    site: (x: number, y: number) => number): { origin(x0: number): void; direction(x: number, y: number): number };
  allowKeys(value: unknown, name: string, keys: readonly string[]): Record<string, unknown>;
  fail(message: string): never;
  failResult(message: string): never;
  cbrt(x: number): number;
  encodeSrgb(linear: number): number;
  yieldControl(): Promise<void>;
  now(): number;
  versions: { facade: string; engine: string };
  evidence: readonly EvidenceProvenance[];
}

const NAME = "simulateFalseColor";
/** Output rows per band: sites are read and developed band by band, so memory follows the band, not the frame. */
const BAND_ROWS = 32;
/** Histogram bins of the a*b* difference: 0.01 wide over [0, 200], and one bin above. */
const BIN = 0.01, BINS = 20001;
/** CIE 1976 L*a*b* constants (CIE 15:2018): ε = 216/24389, κ = 24389/27. */
const LAB_EPSILON = 216 / 24389, LAB_KAPPA = 24389 / 27;
/** Linear sRGB (D65) → CIE XYZ (IEC 61966-2-1), and the D65 white it maps (1, 1, 1) to. */
const SRGB_TO_XYZ = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]] as const;

/** Rejects what changes color after the demosaic or has no expected-signal path, with this function's name. */
function refuse(options: SimulateCaptureOptions, deps: FalseColorDeps): void {
  const o = options as unknown as Record<string, Record<string, unknown> | undefined> & { fast?: unknown };
  const output = o.output ?? {}, lens = o.lens ?? {}, sensor = o.sensor ?? {}, scene = o.scene ?? {};
  const no = (what: string, why: string): never => deps.fail(NAME + " does not support " + what + ": " + why);
  if (o.fast === true) no("fast: true", "it always measures the full-quality path (fast: false).");
  const curve = output.toneCurve;
  if (curve === "extended-reinhard-luminance" || curve === "naka-rushton-luminance") no("output.toneCurve \"" + String(curve) + "\"", "a luminance tone curve couples the colors after the demosaic.");
  if (output.highlightMode === "reconstruct" || output.highlightMode === "reconstruct-neighbors") no("output.highlightMode \"" + String(output.highlightMode) + "\"", "highlight reconstruction changes color after the demosaic.");
  if (output.gamutHandling === "desaturate-to-luminance") no("output.gamutHandling \"desaturate-to-luminance\"", "it changes color after the demosaic.");
  for (const key of ["lensCorrections", "sharpening", "diffractionCorrection"]) if (output[key] !== undefined) no("output." + key, "it acts on the developed image after the demosaic.");
  if (output.region !== undefined) no("output.region", "use the second argument's region.");
  if (output.format === "jpeg" || output.format === "png" || output.format === "dng") no("output.format \"" + String(output.format) + "\"", "the measure is computed on expected values, not on a file.");
  if (output.whiteBalance === "auto") no("output.whiteBalance \"auto\"", "its statistics would come from the noisy capture.");
  if (lens.pupilSampling !== undefined) no("lens.pupilSampling", "it has no expected-signal path.");
  if (lens.psf !== undefined) no("lens.psf", "a caller PSF has no expected-signal path.");
  if ((lens.defocus as Record<string, unknown> | undefined)?.catsEye !== undefined) no("lens.defocus.catsEye", "it has no expected-signal path.");
  if ((sensor.characteristics as Record<string, unknown> | undefined)?.fixedPatternNoise || sensor.fixedPatternNoise !== undefined) no("sensor.fixedPatternNoise", "the measure is noise-free.");
  if (scene.kind === "layered-chart" || scene.preset === "layered-chart") no("layered chart scenes", "they have no single expected signal per site here.");
}

function parseMeasure(measure: SimulateFalseColorOptions | undefined, W: number, H: number, deps: FalseColorDeps):
  { region: { x: number; y: number; width: number; height: number }; partial: boolean; thresholds: number[]; map: number | undefined; images: boolean } {
  const m = measure === undefined ? {} : deps.allowKeys(measure, "measure", ["region", "thresholds", "map", "images"]);
  const integer = (v: unknown, name: string, lo: number, hi: number): number => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) deps.fail(NAME + ": " + name + " must be an integer from " + lo + " to " + hi + ".");
    return v as number;
  };
  const difference = (v: unknown, name: string): number => {
    if (typeof v !== "number" || !(v > 0) || !(v <= LIMITS.maximumDifference)) deps.fail(NAME + ": " + name + " must be a number in (0, 200].");
    return v as number;
  };
  let region = { x: 0, y: 0, width: W, height: H }, partial = false;
  if (m.region !== undefined) {
    const r = deps.allowKeys(m.region, "measure.region", ["x", "y", "width", "height"]);
    const x = integer(r.x, "measure.region.x", 0, W - 1), y = integer(r.y, "measure.region.y", 0, H - 1);
    region = { x, y, width: integer(r.width, "measure.region.width", 1, W - x), height: integer(r.height, "measure.region.height", 1, H - y) };
    partial = true;
  }
  let thresholds = [1, 2, 5];
  if (m.thresholds !== undefined) {
    if (!Array.isArray(m.thresholds) || m.thresholds.length < 1 || m.thresholds.length > LIMITS.maximumThresholds) deps.fail(NAME + ": measure.thresholds must be an array of 1 to 8 numbers.");
    thresholds = (m.thresholds as unknown[]).map((t, i) => difference(t, "measure.thresholds[" + i + "]"));
    for (let i = 1; i < thresholds.length; i++) if (!(thresholds[i]! > thresholds[i - 1]!)) deps.fail(NAME + ": measure.thresholds must be strictly increasing.");
  }
  let map: number | undefined;
  if (m.map === true) map = 20;
  else if (m.map !== undefined && m.map !== false) {
    const mm = deps.allowKeys(m.map, "measure.map", ["maximum"]);
    map = mm.maximum === undefined ? 20 : difference(mm.maximum, "measure.map.maximum");
  }
  if (m.images !== undefined && typeof m.images !== "boolean") deps.fail(NAME + ": measure.images must be a boolean.");
  return { region, partial, thresholds, map, images: m.images === true };
}

/** Develops normalized camera channels (r, g, b) to clipped linear sRGB in `out` (the view's noise-free chain). */
function developer(setup: DisplayViewSetup): (r: number, g: number, b: number, out: Float64Array, o: number) => void {
  const [g0, g1, g2] = setup.gains, L = setup.clipLevel, M = setup.matrix, reinhard = setup.toneCurve === "positive-reinhard-per-channel";
  return (r, g, b, out, o) => {
    const c0 = Math.min(g0 * r, L), c1 = Math.min(g1 * g, L), c2 = Math.min(g2 * b, L);
    for (let k = 0; k < 3; k++) {
      let y = M[k]![0]! * c0 + M[k]![1]! * c1 + M[k]![2]! * c2;
      if (reinhard) y = y > 0 ? y / (1 + y) : 0;
      out[o + k] = y < 0 ? 0 : y > 1 ? 1 : y;
    }
  };
}

/** CIELAB of clipped linear sRGB at rgb[o..o + 3] into lab[o..o + 3]. */
function toLab(rgb: Float64Array, o: number, lab: Float64Array, cbrt: (x: number) => number): void {
  const R = rgb[o]!, G = rgb[o + 1]!, B = rgb[o + 2]!, f = (t: number): number => (t > LAB_EPSILON ? cbrt(t) : (LAB_KAPPA * t + 16) / 116);
  const w = SRGB_TO_XYZ, fx = f((w[0][0] * R + w[0][1] * G + w[0][2] * B) / (w[0][0] + w[0][1] + w[0][2])),
    fy = f((w[1][0] * R + w[1][1] * G + w[1][2] * B) / (w[1][0] + w[1][1] + w[1][2])), fz = f((w[2][0] * R + w[2][1] * G + w[2][2] * B) / (w[2][0] + w[2][1] + w[2][2]));
  lab[o] = 116 * fy - 16; lab[o + 1] = 500 * (fx - fy); lab[o + 2] = 200 * (fy - fz);
}

/** `simulateFalseColor` (see false-color-entry.ts). */
export async function measureFalseColor(options: SimulateCaptureOptions, measure: SimulateFalseColorOptions | undefined, deps: FalseColorDeps): Promise<FalseColorResult> {
  const started = deps.now();
  if (typeof options !== "object" || options === null) deps.fail(NAME + " needs a capture request object.");
  refuse(options, deps);
  // Always the full-quality path, on the CPU.
  const prepared = await deps.prepareDisplayView({ ...options, fast: false }, { gpu: "off" });
  const parts = deps.parts(prepared), context = parts.context, W = context.width, H = context.height;
  if (context.layered) deps.fail(NAME + " does not support layered chart scenes: they have no single expected signal per site here.");
  const m = parseMeasure(measure, W, H, deps), region = m.region, signalOptions = (options as { signal?: AbortSignal }).signal;
  const checkAbort = (): void => { if (signalOptions?.aborted) deps.fail(NAME + " aborted."); };
  // The 1:1 view of the region: its setup gives the expected-signal input, the readout, the demosaic and the development.
  const { setup } = parts.setupOf({ width: W, height: H, samplesPerAxis: 1, bitDepth: 8, format: "srgb-8", ...(m.partial ? { region } : {}) },
    { started: 0, viewStarted: 0, checkAbort, yieldControl: deps.yieldControl });
  const input = setup.gpu!.reference!, NW = setup.nativeWidth, NH = setup.nativeHeight, margin = setup.margin, ahd = setup.ahdChoice !== undefined;
  const k = setup.readout.map((r) => r.perElectron), dark = setup.readout.map((r) => r.darkElectrons), develop = developer(setup);
  // AHD's candidates read 3 sites away and its choice 5 (createAhdDirectionPlane); the bilinear kernels 1.
  const reach = ahd ? 6 : 1, factory = context.lens ?? deps.createSignal, span = region.width + 2 * reach + 2;
  const signals = [0, 1, 2].map((c) => factory({ ...input, channelAt: () => c }, span));
  const own = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
  const rx = (x: number): number => (x < 0 ? -x : x >= NW ? 2 * NW - 2 - x : x), ry = (y: number): number => (y < 0 ? -y : y >= NH ? 2 * NH - 2 - y : y);
  const candidates = (setup.candidates ?? setup.demosaic.map((phase) => [phase])) as readonly (readonly (readonly DisplayViewKernelTap[])[])[][];
  // Per band: the native sites the band's pixels read (its rows and columns widened by the reach, clipped to the raster).
  const sx0 = Math.max(0, region.x + margin - reach), sx1 = Math.min(NW, region.x + region.width + margin + reach), sw = sx1 - sx0;
  let planes = [new Float64Array(0), new Float64Array(0), new Float64Array(0)], sy0 = 0, sy1 = 0, siteEvaluations = 0;
  /** Normalized expected value of native site (x, y) in channel c, clipped at white (inside the band's sites). */
  const value = (c: number, x: number, y: number): number => planes[c]![(y - sy0) * sw + x - sx0]!;
  const mosaic = (x: number, y: number): number => value(own(x, y), x, y);
  // AHD's plane keeps the band's columns and a power of two of rows above the rows one band reads plus 10.
  let planeRows = 1;
  while (planeRows < BAND_ROWS + 2 * reach + 10) planeRows *= 2;
  const plane = ahd ? deps.createAhdDirectionPlane(setup.ahdChoice!.labMatrix, NW, NH, sw, planeRows, mosaic) : undefined;
  const N = region.width * region.height, histogram = new Float64Array(BINS), thresholds = m.thresholds, above = new Float64Array(thresholds.length);
  const values = m.map === undefined ? undefined : new Float32Array(N), images = m.images ? { capture: new Uint8ClampedArray(4 * N), reference: new Uint8ClampedArray(4 * N) } : undefined;
  let sum = 0, sumSquares = 0, maximum = -1, maximumAt = { x: region.x, y: region.y }, sumDeltaE = 0, chromaCapture = 0, chromaReference = 0, signalMs = 0;
  const rgbC = new Float64Array(3), rgbR = new Float64Array(3), labC = new Float64Array(3), labR = new Float64Array(3), demosaiced = new Float64Array(3);
  const write = (to: Uint8ClampedArray, i: number, rgb: Float64Array): void => {
    for (let c = 0; c < 3; c++) to[4 * i + c] = Math.round(deps.encodeSrgb(rgb[c]!) * 255);
    to[4 * i + 3] = 255;
  };
  for (let by = region.y; by < region.y + region.height; by += BAND_ROWS) {
    checkAbort();
    await deps.yieldControl();
    const rows = Math.min(BAND_ROWS, region.y + region.height - by), t0 = deps.now();
    sy0 = Math.max(0, by + margin - reach); sy1 = Math.min(NH, by + rows + margin + reach);
    planes = [0, 1, 2].map((c) => {
      const s = signals[c]!, out = new Float64Array(sw * (sy1 - sy0)), kc = k[c]!, dc = dark[c]!;
      s.window(sx0, sy0, sx1, sy1);
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { const v = kc * (s.site(x, y) + dc); out[(y - sy0) * sw + x - sx0] = v < 1 ? v : 1; }
      siteEvaluations += sw * (sy1 - sy0);
      return out;
    });
    signalMs += deps.now() - t0;
    plane?.origin(sx0);
    for (let y = by; y < by + rows; y++) for (let x = region.x; x < region.x + region.width; x++) {
      const X = x + margin, Y = y + margin, phase = (Y & 1) * 2 + (X & 1), cands = candidates[phase]!;
      // The capture side: each candidate's kernels over the mosaic (read reflect-101), then AHD's choice (a tie averages them).
      const direction = cands.length === 2 ? plane!.direction(X, Y) : 0;
      for (let c = 0; c < 3; c++) {
        let h = 0, v = 0;
        for (const t of cands[0]![c]!) h += t.weight * mosaic(rx(X + t.dx), ry(Y + t.dy));
        if (cands.length === 2 && direction !== 0) for (const t of cands[1]![c]!) v += t.weight * mosaic(rx(X + t.dx), ry(Y + t.dy));
        demosaiced[c] = cands.length === 1 || direction === 0 ? h : direction === 1 ? v : (h + v) / 2;
      }
      develop(demosaiced[0]!, demosaiced[1]!, demosaiced[2]!, rgbC, 0);
      develop(value(0, X, Y), value(1, X, Y), value(2, X, Y), rgbR, 0);
      toLab(rgbC, 0, labC, deps.cbrt); toLab(rgbR, 0, labR, deps.cbrt);
      const da = labC[1]! - labR[1]!, db = labC[2]! - labR[2]!, dl = labC[0]! - labR[0]!, d = Math.sqrt(da * da + db * db);
      if (!Number.isFinite(d)) deps.failResult(NAME + ": a color difference is not finite.");
      const i = (y - region.y) * region.width + x - region.x;
      sum += d; sumSquares += d * d; sumDeltaE += Math.sqrt(dl * dl + d * d);
      chromaCapture += Math.hypot(labC[1]!, labC[2]!); chromaReference += Math.hypot(labR[1]!, labR[2]!);
      if (d > maximum) { maximum = d; maximumAt = { x, y }; }
      histogram[Math.min(BINS - 1, Math.floor(d / BIN))]! += 1;
      for (let t = 0; t < thresholds.length; t++) if (d > thresholds[t]!) above[t]! += 1;
      if (values) values[i] = d;
      if (images) { write(images.capture, i, rgbC); write(images.reference, i, rgbR); }
    }
  }
  const percentile = (q: number): number => {
    const rank = Math.max(1, Math.ceil(q * N));
    let seen = 0;
    for (let b = 0; b < BINS; b++) { seen += histogram[b]!; if (seen >= rank) return Math.min(maximum, (b + 1) * BIN); }
    return maximum;
  };
  let rgba: Uint8ClampedArray | undefined;
  if (values) {
    rgba = new Uint8ClampedArray(4 * N);
    for (let i = 0; i < N; i++) { const g = Math.round(deps.encodeSrgb(Math.min(1, values[i]! / m.map!)) * 255); rgba[4 * i] = g; rgba[4 * i + 1] = g; rgba[4 * i + 2] = g; rgba[4 * i + 3] = 255; }
  }
  const lookups = signals.reduce((total, s) => total + s.lookups, 0), total = deps.now() - started;
  const view = context as unknown as Record<string, unknown> & DisplayViewResultContext;
  const assumptions: SimulateCaptureAssumption[] = [...(view.assumptions as SimulateCaptureAssumption[])];
  assumptions.push({ id: "falseColor.reference", kind: "model", value: { sensor: "full-color", values: "expected", noise: "none" },
    explanation: "The reference reads every site's expected electrons with each of the three channel responses (a full-color sensor) through the capture's own optics, " +
      "anti-aliasing filter, pixel aperture, exposure and site lattice, and develops them without a demosaic: the image the same sensor would give without a color filter mosaic." });
  assumptions.push({ id: "falseColor.capture", kind: "model", value: { demosaic: ahd ? "ahd" : "bilinear", mosaic: "expected-values-clipped-at-white" },
    explanation: "The capture side keeps each site's own channel of the same values (the noise-free mosaic), demosaics it with the request's output.demosaic" +
      (ahd ? " (AHD's two candidates and its homogeneity choice on the noise-free mosaic; a tie averages them)" : " (the bilinear kernels)") + " and develops it with the same chain." });
  assumptions.push({ id: "falseColor.metric", kind: "model", value: { space: "CIELAB", white: "D65", difference: "a*b*", thresholds },
    explanation: "Per output pixel, d = √((Δa*)² + (Δb*)²) between the two developed images in CIE 1976 L*a*b* (linear sRGB → XYZ, D65 white): the chroma and hue part of ΔE*ab. " +
      "Lightness errors are not false color; their effect is in colorDifference.meanDeltaE76. The thresholds are reporting levels, with no claim about visibility." });
  return Object.freeze({
    kind: "false-color" as const,
    label: "False color: the demosaic's color error against a full-color sensor reading of the same capture (expected values); not a capture.",
    facadeVersion: deps.versions.facade, engineApiVersion: deps.versions.engine,
    width: region.width, height: region.height,
    ...(m.partial ? { region: { ...region, frameWidth: W, frameHeight: H } } : {}),
    demosaic: ahd ? "ahd" as const : "bilinear" as const,
    chromaDifference: Object.freeze({ pixelCount: N, mean: sum / N, rootMeanSquare: Math.sqrt(sumSquares / N), median: percentile(0.5), percentile95: percentile(0.95), percentile99: percentile(0.99),
      maximum, maximumAt, fractionAbove: Object.freeze(thresholds.map((threshold, t) => Object.freeze({ threshold, fraction: above[t]! / N }))) }),
    colorDifference: { meanDeltaE76: sumDeltaE / N },
    meanChroma: { capture: chromaCapture / N, reference: chromaReference / N },
    ...(values ? { map: { width: region.width, height: region.height, maximum: m.map!, values, rgba: rgba! } } : {}),
    ...(images ? { images } : {}),
    exposure: { mode: view.mode, settings: { fNumber: view.fNumber, shutterSeconds: view.shutterSeconds, iso: view.resolvedIso }, ev100: Math.log2(view.fNumber ** 2 / view.shutterSeconds), ...view.isoReport,
      standardExposureDeviationStops: view.standardExposureDeviationStops, standardExposureIlluminanceLux: view.standardExposureIlluminanceLux, greyCardDeviationStops: view.greyCardDeviationStops, metering: view.metering } as FalseColorResult["exposure"],
    scene: { sceneId: view.chart ? "chart:" + view.chart.preset : view.callerScene!.sceneId, preset: view.scenePreset, parameters: (view.chart ?? view.callerScene)!.parameters ?? {},
      illuminant: { id: view.illuminant.id, description: view.illuminant.description, illuminanceLux: view.illuminanceLux }, distanceM: view.subjectDistanceM,
      framedWidthM: view.framedWidthM, framedHeightM: view.framedWidthM * view.aspect, ...(view.chartReport ? { chart: view.chartReport } : {}), sourceSha256: view.sourceSha256 } as FalseColorResult["scene"],
    diagnostics: { siteEvaluations, sceneLookups: lookups, timingsMs: { signal: signalMs, measure: total - signalMs, total } },
    provenance: { scientificStatus: "approximation" as const, cameraPresetId: view.preset.presetId, cameraPresetVersion: view.preset.presetVersion, evidence: [...deps.evidence, ...view.preset.evidence],
      composedContracts: ["calculateEnvironmentSensorPhotoSignal", "prepareSensorColorDevelopment", ahd ? "createAhdDemosaicTask" : "bilinear demosaic", "display view expected signal"],
      limitations: ["Expected values only: no photon, dark or read noise and no ADC rounding (chroma noise is a separate quantity).",
        "Per output pixel, not weighted by viewing distance or display size (no S-CIELAB spatial filtering).",
        ...(ahd ? ["AHD's direction is chosen on the noise-free mosaic."] : [])] },
    assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a)))
  });
}

/** The resolved request fields the result reports (DisplayViewRunContext, simulate-capture.ts). */
interface DisplayViewResultContext {
  mode: DisplayViewResult["exposure"]["mode"]; fNumber: number; shutterSeconds: number; resolvedIso: number; isoReport: Record<string, unknown>;
  standardExposureDeviationStops: number | null; standardExposureIlluminanceLux: number | null; greyCardDeviationStops: number | null; metering: unknown;
  chart?: { preset: string; parameters?: Readonly<Record<string, unknown>> }; callerScene?: { sceneId: string; parameters?: Readonly<Record<string, unknown>> };
  scenePreset: string; illuminant: { id: string; description: string }; illuminanceLux: number; subjectDistanceM: number; framedWidthM: number; aspect: number;
  chartReport?: unknown; sourceSha256: string; preset: { presetId: string; presetVersion: string; evidence: readonly EvidenceProvenance[] }; layered?: unknown;
}
