// SPDX-License-Identifier: Apache-2.0

/**
 * #743 (2.29.0): `simulateFalseColor` with `measure.noise`, loaded on demand as its own chunk (only for a request with
 * `measure.noise`). Like the body (false-color.ts) it imports no engine module at run time: the entry passes it the body's
 * `measureFalseColor`, the body's dependencies and the capture functions it uses.
 *
 * What it computes. The body measures the noise-free case (`demosaicOnly`, the result's `chromaDifference`). This module adds two
 * measures against the same noise-free full-color reference:
 * - `withNoise`: the capture's noisy mosaic, demosaiced (the request's bilinear kernels, or AHD's candidates with its direction chosen
 *   on the noisy mosaic) and developed alike. The mosaic is the RAW of the capture itself (`runCapture`, the path of `simulateCapture`,
 *   at full quality and the measure's noise seed): its draws are the capture's own seeded streams and readout chain, so it equals the
 *   RAW `simulateCapture` returns for that request and seed.
 * - `noiseOnly`: a full-color sensor with noise. Each site's own channel is the capture's noisy code; its two other channels are read
 *   by two more runs of the same capture whose sensor stage (the exposure build-up hook, capture/exposure-build-up-stage.ts) replaces
 *   the site's photo and dark counts with draws for that channel's expected electrons, from this module's own stream IDs. So every
 *   plane goes through the capture's own readout chain (full-well clip, read noise, pre-ADC clip, ADC, digital gain) at that site.
 *
 * The expected electrons of the extra planes are the display view's expected signal with the site's channel fixed, integrated per site
 * from the spectrum when the site is read (as the body's planes); no table holds a value per channel. Codes are normalized as the
 * capture's development normalizes them (`normalizedRawSite`: 1 at a flag or at white, else (code − black)/(white − black) times the
 * development push, clipped at 1).
 */

import type { FalseColorDeps, FalseColorNoise, FalseColorResult, FalseColorStatistics, SimulateFalseColorOptions } from "./false-color.js";
import type { DisplayViewKernelTap, DisplayViewSetup } from "./display-view.js";
import type { runCapture as RunCapture, SimulateCaptureOptions, SimulateCaptureResult } from "./simulate-capture.js";
import type { ExposureBuildUpStage } from "../capture/exposure-build-up-stage.js";
import type { ResettableUniformStream } from "../sensor/stochastic-seed.js";

const NAME = "simulateFalseColor";
/** The first stream ID of the extra planes' draws (`deriveNativeSiteStreamSeedUint32`): plane j (1, 2) draws its photo and dark counts from base + 2(j − 1) and reads its read noise from base + 2(j − 1) + 1. */
export const FALSE_COLOR_NOISE_STREAM_BASE = 0x46434e00;
const BAND_ROWS = 32, BIN = 0.01, BINS = 20001;
const LAB_EPSILON = 216 / 24389, LAB_KAPPA = 24389 / 27;
const SRGB_TO_XYZ = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]] as const;

/** Internal test hook (never set by the engine): sees the three runs' RAW and the native rectangle they cover. */
export const falseColorNoiseTestHook: { runs?: (runs: readonly SimulateCaptureResult["raw"][], rect: { x: number; y: number; width: number; height: number }) => void } = {};

/** Accumulates the statistics block of `chromaDifference` (the same rules as the body). */
function statistics(N: number, thresholds: readonly number[], mapped: boolean): { add(d: number, i: number, x: number, y: number): void; values: Float32Array | undefined; done(): FalseColorStatistics } {
  const histogram = new Float64Array(BINS), above = new Float64Array(thresholds.length), values = mapped ? new Float32Array(N) : undefined;
  let sum = 0, sumSquares = 0, maximum = -1, maximumAt = { x: 0, y: 0 };
  return {
    values,
    add(d, i, x, y): void {
      sum += d; sumSquares += d * d;
      if (d > maximum) { maximum = d; maximumAt = { x, y }; }
      histogram[Math.min(BINS - 1, Math.floor(d / BIN))]! += 1;
      for (let t = 0; t < thresholds.length; t++) if (d > thresholds[t]!) above[t]! += 1;
      if (values) values[i] = d;
    },
    done(): FalseColorStatistics {
      const percentile = (q: number): number => {
        const rank = Math.max(1, Math.ceil(q * N));
        let seen = 0;
        for (let b = 0; b < BINS; b++) { seen += histogram[b]!; if (seen >= rank) return Math.min(maximum, (b + 1) * BIN); }
        return maximum;
      };
      return Object.freeze({ pixelCount: N, mean: sum / N, rootMeanSquare: Math.sqrt(sumSquares / N), median: percentile(0.5), percentile95: percentile(0.95), percentile99: percentile(0.99),
        maximum, maximumAt, fractionAbove: Object.freeze(thresholds.map((threshold, t) => Object.freeze({ threshold, fraction: above[t]! / N }))) });
    }
  };
}

/** The view's noise-free development (the body's `developer`). */
function developer(setup: DisplayViewSetup): (r: number, g: number, b: number, out: Float64Array) => void {
  const [g0, g1, g2] = setup.gains, L = setup.clipLevel, M = setup.matrix, reinhard = setup.toneCurve === "positive-reinhard-per-channel";
  return (r, g, b, out) => {
    const c0 = Math.min(g0 * r, L), c1 = Math.min(g1 * g, L), c2 = Math.min(g2 * b, L);
    for (let k = 0; k < 3; k++) {
      let y = M[k]![0]! * c0 + M[k]![1]! * c1 + M[k]![2]! * c2;
      if (reinhard) y = y > 0 ? y / (1 + y) : 0;
      out[k] = y < 0 ? 0 : y > 1 ? 1 : y;
    }
  };
}

/** CIELAB of clipped linear sRGB (the body's `toLab`). */
function toLab(rgb: Float64Array, lab: Float64Array, cbrt: (x: number) => number): void {
  const R = rgb[0]!, G = rgb[1]!, B = rgb[2]!, f = (t: number): number => (t > LAB_EPSILON ? cbrt(t) : (LAB_KAPPA * t + 16) / 116);
  const w = SRGB_TO_XYZ, fx = f((w[0][0] * R + w[0][1] * G + w[0][2] * B) / (w[0][0] + w[0][1] + w[0][2])),
    fy = f((w[1][0] * R + w[1][1] * G + w[1][2] * B) / (w[1][0] + w[1][1] + w[1][2])), fz = f((w[2][0] * R + w[2][1] * G + w[2][2] * B) / (w[2][0] + w[2][1] + w[2][2]));
  lab[0] = 116 * fy - 16; lab[1] = 500 * (fx - fy); lab[2] = 200 * (fy - fz);
}

/** `simulateFalseColor` with `measure.noise` (see false-color-entry.ts). */
export async function measureFalseColorNoise(options: SimulateCaptureOptions, measure: SimulateFalseColorOptions, deps: FalseColorDeps,
  measureFalseColor: (options: SimulateCaptureOptions, measure: SimulateFalseColorOptions | undefined, deps: FalseColorDeps) => Promise<FalseColorResult>,
  runCapture: typeof RunCapture, stages: WeakMap<object, ExposureBuildUpStage>, poisson: (mean: number, random: ResettableUniformStream) => number,
  createStream: () => ResettableUniformStream, streamSeed: (seed: number, index: number, streamId: number) => number): Promise<FalseColorResult> {
  const started = deps.now();
  const { noise: noiseOption, ...rest } = deps.allowKeys(measure, "measure", ["region", "thresholds", "map", "images", "noise"]) as SimulateFalseColorOptions;
  if (noiseOption !== true && (typeof noiseOption !== "object" || noiseOption === null)) deps.fail(NAME + ": measure.noise must be true or { seed }.");
  const n = noiseOption === true ? {} : deps.allowKeys(noiseOption, "measure.noise", ["seed"]), chosen = n.seed;
  if (chosen !== undefined && (typeof chosen !== "number" || !Number.isInteger(chosen) || chosen < 0 || chosen > 0xffffffff))
    deps.fail(NAME + ": measure.noise.seed must be an integer from 0 to 4294967295.");
  // The noise-free measure (the body), keeping the setup it renders with.
  let parts: ReturnType<FalseColorDeps["parts"]> | undefined, setup: DisplayViewSetup | undefined;
  const base = await measureFalseColor(options, rest, { ...deps, parts: (prepared): ReturnType<FalseColorDeps["parts"]> => {
    const p = deps.parts(prepared);
    return parts = { ...p, setupOf: (v, run): ReturnType<typeof p.setupOf> => { const s = p.setupOf(v, run); setup = s.setup; return s; } };
  } });
  // The request's sensor.noiseSeed (checked by the body's request) unless measure.noise.seed replaces it.
  const sensor = (options.sensor ?? {}) as Record<string, unknown>, seed = (chosen ?? sensor.noiseSeed ?? 1) as number;
  const context = parts!.context, W = context.width, H = context.height, s = setup!, region = base.region ?? { x: 0, y: 0, width: W, height: H };
  const NW = s.nativeWidth, NH = s.nativeHeight, margin = s.margin, ahd = s.ahdChoice !== undefined, reach = ahd ? 6 : 1;
  const signalOptions = (options as { signal?: AbortSignal }).signal, checkAbort = (): void => { if (signalOptions?.aborted) deps.fail(NAME + " aborted."); };

  // The capture at full quality and the measure's seed: the whole frame, or the region widened by the reach (its native rectangle
  // then holds every site the region's pixels read; a region's sites are the whole frame's, absolute indices and seeds).
  const output = (options.output ?? {}) as Record<string, unknown>;
  const x0 = Math.max(0, region.x - reach), y0 = Math.max(0, region.y - reach), x1 = Math.min(W, region.x + region.width + reach), y1 = Math.min(H, region.y + region.height + reach);
  // Progress is the body's: the capture runs report none.
  const request: Record<string, unknown> = { ...options };
  delete request.onProgress;
  const captureOptions = { ...request, fast: false, sensor: { ...sensor, noiseSeed: seed },
    output: { ...output, ...(base.region ? { region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } } : {}) } } as SimulateCaptureOptions;
  const capture = async (stage?: ExposureBuildUpStage): Promise<SimulateCaptureResult> =>
    await runCapture(captureOptions, "capture", stage ? (raw: object): void => { stages.set(raw, stage); } : undefined) as SimulateCaptureResult;
  const t0 = deps.now(), first = await capture(), rect = first.region?.nativeRect ?? { x: 0, y: 0, width: NW, height: NH };
  const sx0 = Math.max(0, region.x + margin - reach), sx1 = Math.min(NW, region.x + region.width + margin + reach);
  const sy0 = Math.max(0, region.y + margin - reach), sy1 = Math.min(NH, region.y + region.height + margin + reach);
  if (sx0 < rect.x || sy0 < rect.y || sx1 > rect.x + rect.width || sy1 > rect.y + rect.height) deps.failResult(NAME + ": the capture's native rectangle does not hold the measured sites.");

  // Every channel's expected electrons at the rectangle's sites, read per site from the spectrum (the body's signals).
  const input = s.gpu!.reference!, factory = context.lens ?? deps.createSignal, RW = rect.width, RH = rect.height;
  const signals = [0, 1, 2].map((c) => factory({ ...input, channelAt: () => c }, RW + 2));
  const electrons = [0, 1, 2].map(() => new Float64Array(RW * RH));
  for (let by = rect.y; by < rect.y + RH; by += BAND_ROWS) {
    checkAbort();
    await deps.yieldControl();
    const ey = Math.min(rect.y + RH, by + BAND_ROWS);
    for (let c = 0; c < 3; c++) {
      const signal = signals[c]!, e = electrons[c]!;
      signal.window(rect.x, by, rect.x + RW, ey);
      for (let y = by; y < ey; y++) for (let x = rect.x; x < rect.x + RW; x++) e[(y - rect.y) * RW + x - rect.x] = signal.site(x, y);
    }
  }
  const own = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
  const electronsAt = (c: number, x: number, y: number): number => {
    if (x >= rect.x && x < rect.x + RW && y >= rect.y && y < rect.y + RH) return electrons[c]![(y - rect.y) * RW + x - rect.x]!;
    // A site outside the rectangle (a capture's verification site): read on its own (a window never changes a value).
    signals[c]!.window(x, y, x + 1, y + 1);
    return signals[c]!.site(x, y);
  };

  // The two extra planes: the capture's sensor stage with this module's counts and streams.
  const stream = createStream(), runs = [first];
  for (let j = 1; j <= 2; j++) {
    const charge = FALSE_COLOR_NOISE_STREAM_BASE + 2 * (j - 1), written = new Uint8Array(RW * RH);
    let count = 0;
    const stage: ExposureBuildUpStage = { photo: 0, dark: 0, read: charge + 1,
      split(index, _photoMean, darkMean) {
        const x = index % NW, y = (index - x) / NW;
        stream.reset(streamSeed(seed, index, charge));
        stage.photo = poisson(electronsAt((own(x, y) + j) % 3, x, y), stream);
        stage.dark = poisson(darkMean, stream);
        const i = (y - rect.y) * RW + x - rect.x;
        if (x >= rect.x && x < rect.x + RW && y >= rect.y && y < rect.y + RH && !written[i]) { written[i] = 1; count++; }
      } };
    runs.push(await capture(stage));
    if (count !== RW * RH) deps.failResult(NAME + ": the capture's sensor stage did not report every site (an unsupported render path).");
  }
  falseColorNoiseTestHook.runs?.(runs.map((r) => r.raw), rect);
  const captureMs = deps.now() - t0;

  // Normalized noisy value of native site (x, y) in channel c: the run that read channel c there, normalized as the capture develops it.
  const gain = (context.exposureGain as number | undefined) ?? 1, raws = runs.map((r) => r.raw);
  const noisy = (c: number, x: number, y: number): number => {
    const raw = raws[(c - own(x, y) + 3) % 3]!, i = (y - rect.y) * RW + x - rect.x, code = raw.codes[i]!, black = raw.blackLevels[i]!,
      white = raw.effectiveSaturationCodes[(y & 1) * 2 + (x & 1)]!;
    if (raw.saturationFlags[i] !== 0 || code >= white) return 1;
    const v = (code - black) / (white - black) * gain;
    return v >= 1 ? 1 : v;
  };
  const mosaic = (x: number, y: number): number => noisy(own(x, y), x, y);
  const k = s.readout.map((r) => r.perElectron), dark = s.readout.map((r) => r.darkElectrons), develop = developer(s);
  const expected = (c: number, x: number, y: number): number => { const v = k[c]! * (electronsAt(c, x, y) + dark[c]!); return v < 1 ? v : 1; };
  const rx = (x: number): number => (x < 0 ? -x : x >= NW ? 2 * NW - 2 - x : x), ry = (y: number): number => (y < 0 ? -y : y >= NH ? 2 * NH - 2 - y : y);
  const candidates = (s.candidates ?? s.demosaic.map((phase) => [phase])) as readonly (readonly (readonly DisplayViewKernelTap[])[])[][];
  let planeRows = 1;
  while (planeRows < BAND_ROWS + 2 * reach + 10) planeRows *= 2;
  const plane = ahd ? deps.createAhdDirectionPlane(s.ahdChoice!.labMatrix, NW, NH, sx1 - sx0, planeRows, mosaic) : undefined;
  const N = region.width * region.height, thresholds = base.chromaDifference.fractionAbove.map((f) => f.threshold), mapped = base.map !== undefined;
  const withNoise = statistics(N, thresholds, mapped), noiseOnly = statistics(N, thresholds, mapped);
  const images = base.images ? { withNoise: new Uint8ClampedArray(4 * N), noiseOnly: new Uint8ClampedArray(4 * N) } : undefined;
  const rgbW = new Float64Array(3), rgbN = new Float64Array(3), rgbR = new Float64Array(3), labW = new Float64Array(3), labN = new Float64Array(3), labR = new Float64Array(3), demosaiced = new Float64Array(3);
  const write = (to: Uint8ClampedArray, i: number, rgb: Float64Array): void => {
    for (let c = 0; c < 3; c++) to[4 * i + c] = Math.round(deps.encodeSrgb(rgb[c]!) * 255);
    to[4 * i + 3] = 255;
  };
  const difference = (a: Float64Array, b: Float64Array): number => {
    const da = a[1]! - b[1]!, db = a[2]! - b[2]!, d = Math.sqrt(da * da + db * db);
    if (!Number.isFinite(d)) deps.failResult(NAME + ": a color difference is not finite.");
    return d;
  };
  const t1 = deps.now();
  for (let by = region.y; by < region.y + region.height; by += BAND_ROWS) {
    checkAbort();
    await deps.yieldControl();
    const rows = Math.min(BAND_ROWS, region.y + region.height - by);
    plane?.origin(sx0);
    for (let y = by; y < by + rows; y++) for (let x = region.x; x < region.x + region.width; x++) {
      const X = x + margin, Y = y + margin, cands = candidates[(Y & 1) * 2 + (X & 1)]!, direction = cands.length === 2 ? plane!.direction(X, Y) : 0;
      for (let c = 0; c < 3; c++) {
        let h = 0, v = 0;
        for (const t of cands[0]![c]!) h += t.weight * mosaic(rx(X + t.dx), ry(Y + t.dy));
        if (cands.length === 2 && direction !== 0) for (const t of cands[1]![c]!) v += t.weight * mosaic(rx(X + t.dx), ry(Y + t.dy));
        demosaiced[c] = cands.length === 1 || direction === 0 ? h : direction === 1 ? v : (h + v) / 2;
      }
      develop(demosaiced[0]!, demosaiced[1]!, demosaiced[2]!, rgbW);
      develop(noisy(0, X, Y), noisy(1, X, Y), noisy(2, X, Y), rgbN);
      develop(expected(0, X, Y), expected(1, X, Y), expected(2, X, Y), rgbR);
      toLab(rgbW, labW, deps.cbrt); toLab(rgbN, labN, deps.cbrt); toLab(rgbR, labR, deps.cbrt);
      const i = (y - region.y) * region.width + x - region.x;
      withNoise.add(difference(labW, labR), i, x, y);
      noiseOnly.add(difference(labN, labR), i, x, y);
      if (images) { write(images.withNoise, i, rgbW); write(images.noiseOnly, i, rgbN); }
    }
  }
  const map = (values: Float32Array): NonNullable<FalseColorResult["map"]> => {
    const maximum = base.map!.maximum, rgba = new Uint8ClampedArray(4 * N);
    for (let i = 0; i < N; i++) { const g = Math.round(deps.encodeSrgb(Math.min(1, values[i]! / maximum)) * 255); rgba[4 * i] = g; rgba[4 * i + 1] = g; rgba[4 * i + 2] = g; rgba[4 * i + 3] = 255; }
    return { width: region.width, height: region.height, maximum, values, rgba };
  };
  const noise: FalseColorNoise = {
    seed, withNoise: withNoise.done(), noiseOnly: noiseOnly.done(), demosaicOnly: base.chromaDifference,
    ...(mapped ? { maps: { withNoise: map(withNoise.values!), noiseOnly: map(noiseOnly.values!), demosaicOnly: base.map! } } : {}),
    ...(images ? { images } : {}),
    timingsMs: { captures: captureMs, measure: deps.now() - t1, total: deps.now() - started }
  };
  return Object.freeze({ ...base, noise: Object.freeze(noise), assumptions: Object.freeze([...base.assumptions, Object.freeze({ id: "falseColor.noise", kind: "model" as const,
    value: { seed, mosaic: "capture-raw", extraPlanes: "capture-readout-own-streams", streamBase: FALSE_COLOR_NOISE_STREAM_BASE },
    explanation: "withNoise demosaics the capture's own noisy RAW (simulateCapture at fast: false and this seed" + (ahd ? "; AHD chooses its direction on the noisy mosaic" : "") +
      ") and develops it as the reference; noiseOnly develops a full-color sensor with noise: each site's own channel is the capture's code and its two other channels are drawn for " +
      "their expected electrons (photo and dark Poisson counts from their own streams) and read by the capture's own readout chain at that site; demosaicOnly is chromaDifference. " +
      "All three are against the noise-free full-color reference." })]) });
}
