// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #607 go items (2.24.0): measurements from an imported DNG's RAW data, computed per site at use (no table indexed by signal level).
 *
 * - {@link calculateDngRawClipping}: per color plane, the share of sites at the white level (exact by definition: the linearized code
 *   reaches WhiteLevel) and within a margin below it (a threshold choice; the #607 research found that a sensor's saturation can sit
 *   just below the file's single WhiteLevel, which is the smallest of its phases' whites).
 * - {@link estimateDngRawNoise}: the signal-dependent noise var(x) = S·x + O of each color plane, fitted from one image (Foi, Trimeche,
 *   Katkovnik & Egiazarian 2008, IEEE TIP 17(10), Poisson–Gaussian model), with the robust median absolute deviation of the finest
 *   diagonal Haar detail (Donoho & Johnstone 1994, Biometrika 81(3): σ = 1.4826 · MAD). On engine captures of known noise the
 *   σ at the median signal read −7.6 % to +3.0 % of the NoiseProfile on charts with flat areas or edges (green plane), and +9.6 % to +38 %
 *   on dense fine texture, which leaks into the detail band (#607, docs/research/photo-feasibility.md, section 2); re-measured on every
 *   color plane for 2.24.0 (test/dng-raw-analysis.test.ts scenes): −10 % to +0.5 % on charts, +9 % to +38 % on dead leaves.
 *
 * The signal is x = (linearized code − black)/(WhiteLevel − black), the DNG 1.7.1.0 normalization that NoiseProfile uses, over the
 * default crop (the image a raw converter shows). Opcode lists are not applied (they act on the developed stages).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import type { ImportedDngRaw, ImportedDngRect } from "./dng-import.js";

/** CFAPlaneColor names (DNG 1.7.1.0). */
const PLANE_NAMES = ["red", "green", "blue", "cyan", "magenta", "yellow", "white"] as const;


function fail(name: string, message: string): never { throw new InvalidConfigurationError(name + ": " + message); }

/**
 * Internal: per-site access to an imported DNG's normalized linear signal. `x(i)` is (linearized code − black)/(white − black) for
 * stored index i, unclipped; `plane(xs, ys)` is the color plane (CFA) or sample (LinearRaw) of a site.
 */
export interface DngSiteAccess {
  /** The region measured: the default crop, rounded inward to whole sites and kept inside the ActiveArea. */
  region: ImportedDngRect;
  /** Color planes (CFA) or samples (LinearRaw). */
  planes: number;
  planeNames: string[];
  /** Normalized value of stored sample `index` (row-major then sample) at active-area-relative column `ax`, row `ay`, sample `s`. */
  value(code: number, ax: number, ay: number, s: number): number;
  /** Linearized code of a stored code. */
  linear(code: number): number;
  /** Black level at active-area-relative (ax, ay), sample s (the BlackLevel pattern plus the deltas). */
  black(ax: number, ay: number, s: number): number;
  /** Color plane of the site at active-area-relative (ax, ay) for a CFA image; the sample index otherwise. */
  planeOf(ax: number, ay: number, s: number): number;
}

/** Internal: checks an ImportedDngRaw record (the parser's output) and prepares per-site access. */
export function prepareDngSiteAccess(raw: ImportedDngRaw, name: string): DngSiteAccess {
  if (raw === null || typeof raw !== "object" || !(raw.codes instanceof Uint16Array) || !raw.blackLevel || !Array.isArray(raw.whiteLevel) || !raw.activeArea)
    fail(name, "raw must be an ImportedDngRaw (parseDngRawImage or importDngRawImage).");
  const { activeArea: a, defaultCrop: c, linearizationTable: table, blackLevel, whiteLevel, cfa } = raw;
  const ax = Math.floor(a.x), ay = Math.floor(a.y), aw = Math.floor(a.width), ah = Math.floor(a.height);
  const x0 = Math.min(aw, Math.max(0, Math.ceil(c.x))), y0 = Math.min(ah, Math.max(0, Math.ceil(c.y)));
  const x1 = Math.max(x0, Math.min(aw, Math.floor(c.x + c.width))), y1 = Math.max(y0, Math.min(ah, Math.floor(c.y + c.height)));
  if (x1 - x0 < 2 || y1 - y0 < 2) fail(name, "the default crop holds fewer than 2 × 2 sites.");
  const { repeatRows: rr, repeatColumns: rc, values, deltaH, deltaV } = blackLevel, spp = raw.samplesPerPixel;
  const linear = (code: number): number => table ? table[Math.min(code, table.length - 1)]! : code;
  const black = (x: number, y: number, s: number): number => values[((y % rr) * rc + (x % rc)) * spp + s]! + (deltaH?.[x] ?? 0) + (deltaV?.[y] ?? 0);
  const planes = cfa ? cfa.planeColors.length : spp;
  const planeNames = cfa ? cfa.planeColors.map((k) => PLANE_NAMES[k] ?? "plane-" + k) : Array.from({ length: spp }, (_, s) => "sample-" + s);
  const planeOf = cfa ? (x: number, y: number): number => cfa.pattern[(y % cfa.repeatRows) * cfa.repeatColumns + (x % cfa.repeatColumns)]! : (_x: number, _y: number, s: number): number => s;
  return {
    region: { x: ax + x0, y: ay + y0, width: x1 - x0, height: y1 - y0 }, planes, planeNames, linear, black, planeOf,
    value(code: number, x: number, y: number, s: number): number { const b = black(x, y, s), span = whiteLevel[s]! - b; return span > 0 ? (linear(code) - b) / span : 0; }
  };
}

// ------------------------------------------------------------------ clipping

export interface CalculateDngRawClippingOptions {
  /**
   * Near-white margin, a fraction of the code span below the white level (default 0.01: x ≥ 0.99, the threshold of the #607 research's
   * real-file inventory). A threshold choice, not a property of the file. 0 to 0.25.
   */
  marginFraction?: number;
}
export interface DngRawClippingPlane {
  plane: number;
  color: string;
  sites: number;
  /** Sites whose linearized code reaches WhiteLevel (exact by definition). */
  atWhiteLevel: number;
  /** Sites at x ≥ 1 − marginFraction (includes `atWhiteLevel`). */
  nearWhiteLevel: number;
  fractionAtWhiteLevel: number;
  fractionNearWhiteLevel: number;
}
export interface DngRawClipping {
  region: ImportedDngRect;
  marginFraction: number;
  planes: DngRawClippingPlane[];
  /** CFA: the share of all sites at the white level; LinearRaw: the share of pixels with any sample at it. */
  fractionAtWhiteLevel: number;
  fractionNearWhiteLevel: number;
  /** "exact": a CFA mosaic, losslessly stored; "processed": LinearRaw (a converter's demosaic and processing came first); "lossy": a lossy source. */
  confidence: "exact" | "processed" | "lossy";
  /** The claim the numbers support, in words. */
  label: string;
  assumptions: string[];
}

/** Clipping on the RAW: per color plane, the sites at the white level and near it (see the module comment). */
export function calculateDngRawClipping(raw: ImportedDngRaw, options: CalculateDngRawClippingOptions = {}): DngRawClipping {
  const name = "calculateDngRawClipping";
  if (options === null || typeof options !== "object") fail(name, "options must be an object.");
  for (const key of Object.keys(options)) if (key !== "marginFraction") fail(name, "unknown option " + JSON.stringify(key) + ".");
  const margin = options.marginFraction ?? 0.01;
  if (typeof margin !== "number" || !(margin >= 0 && margin <= 0.25)) fail(name, "marginFraction must be a number from 0 to 0.25.");
  const site = prepareDngSiteAccess(raw, name), { region: r } = site, spp = raw.samplesPerPixel, a = raw.activeArea, ax = Math.floor(a.x), ay = Math.floor(a.y);
  const counts = Array.from({ length: site.planes }, () => ({ sites: 0, at: 0, near: 0 }));
  let anyAt = 0, anyNear = 0;
  for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
    let pixelAt = false, pixelNear = false;
    for (let s = 0; s < spp; s++) {
      const code = raw.codes[(y * raw.width + x) * spp + s]!, rx = x - ax, ry = y - ay, k = counts[site.planeOf(rx, ry, s)]!;
      const at = site.linear(code) >= raw.whiteLevel[s]!, near = at || site.value(code, rx, ry, s) >= 1 - margin;
      k.sites++; if (at) k.at++; if (near) k.near++;
      pixelAt ||= at; pixelNear ||= near;
    }
    if (pixelAt) anyAt++;
    if (pixelNear) anyNear++;
  }
  const total = r.width * r.height, confidence = raw.lossySource ? "lossy" : raw.photometricInterpretation === "cfa" ? "exact" : "processed";
  const assumptions = ["Measured over the default crop (" + r.width + " × " + r.height + " sites at " + r.x + ", " + r.y + "); opcode lists are not applied.",
    "Near white: x = (linearized code − black)/(WhiteLevel − black) ≥ " + (1 - margin) + " (marginFraction " + margin + ", a threshold choice)."];
  if (raw.linearizationTable) assumptions.push("Codes are compared after the LinearizationTable.");
  if (confidence === "processed") assumptions.push("LinearRaw data: a converter demosaiced (and may have processed) the RAW; clipping is that of the stored values, not proven sensor clipping.");
  if (confidence === "lossy") assumptions.push("Lossy raw data: coding error can move values across the white level.");
  return {
    region: { ...r }, marginFraction: margin,
    planes: counts.map((k, p) => ({ plane: p, color: site.planeNames[p]!, sites: k.sites, atWhiteLevel: k.at, nearWhiteLevel: k.near,
      fractionAtWhiteLevel: k.sites ? k.at / k.sites : 0, fractionNearWhiteLevel: k.sites ? k.near / k.sites : 0 })),
    fractionAtWhiteLevel: anyAt / total, fractionNearWhiteLevel: anyNear / total, confidence,
    label: confidence === "exact" ? "Share of the sensor's sites that are clipped (at the RAW white level), by color." :
      "Share of the stored RAW values at the white level, by channel (the file was processed before it was stored; not proven sensor clipping).",
    assumptions
  };
}

// ------------------------------------------------------------------ noise

export interface EstimateDngRawNoiseOptions {
  /** Normalized signal levels x (0 < x < 1) at which to report σ, in addition to each plane's median signal. At most 32. */
  signalLevels?: readonly number[];
  /** Equal-count bins of block means (default 16, 2–64). */
  bins?: number;
  /** Minimum blocks per bin (default 200, 20–100 000). */
  minimumBlocksPerBin?: number;
}
export interface DngRawNoiseBin { meanSignal: number; variance: number; blocks: number }
export interface DngRawNoisePlane {
  plane: number;
  color: string;
  /** Blocks kept after the range and smoothness screens, of all 2 × 2 blocks of this plane. */
  blocksKept: number;
  blocksTotal: number;
  bins: DngRawNoiseBin[];
  /** The fitted var(x) = scale·x + offset, or null when fewer than two bins remain. The offset is poorly determined (#607). */
  fit: { scale: number; offset: number } | null;
  /** The plane's median signal x, and σ there (null without a fit or for a variance ≤ 0). */
  medianSignal: number;
  sigmaAtMedian: number | null;
  /** σ at each requested level (null where the fitted variance is ≤ 0 or there is no fit). */
  sigmaAtLevels: { signal: number; sigma: number | null }[];
  /** The file's NoiseProfile σ at the median signal, and measured ÷ stated, or null without a NoiseProfile. */
  profileSigmaAtMedian: number | null;
  measuredToProfile: number | null;
}
export interface DngRawNoise {
  region: ImportedDngRect;
  planes: DngRawNoisePlane[];
  /** "measured": the σ the data shows at typical signal; it may read high on fine texture (an upper bound there). */
  confidence: "measured";
  label: string;
  assumptions: string[];
}

/** The k-th smallest value of `a` (reordered in place): Hoare's selection with a median-of-three pivot, linear on average. */
function select(a: Float64Array, k: number): number {
  let lo = 0, hi = a.length - 1;
  while (hi > lo) {
    const mid = (lo + hi) >> 1, x = a[lo]!, y = a[mid]!, z = a[hi]!;
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) { const t = a[i]!; a[i] = a[j]!; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k]!;
  }
  return a[k]!;
}
/** Median of a Float64Array (reordered in place). */
function medianInPlace(a: Float64Array): number {
  const n = a.length, upper = select(a, n >> 1);
  if (n % 2) return upper;
  let lower = -Infinity;
  for (let i = 0; i < n >> 1; i++) if (a[i]! > lower) lower = a[i]!; // after selection, a[0 .. n/2 − 1] ≤ the upper middle
  return (lower + upper) / 2;
}
/** Median absolute deviation of `values` (a copy is sorted). */
function mad(values: Float64Array): number {
  const m = medianInPlace(Float64Array.from(values)), d = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) d[i] = Math.abs(values[i]! - m);
  return medianInPlace(d);
}

/**
 * Internal: the #607 noise fit of one set of blocks (means m, diagonal details d, structure h). Range screen 0.002 < m < 0.95; smoothness
 * screen h < 6σ with σ = 1.4826·MAD(d) of all kept blocks; equal-count bins by m; σ²_bin = (1.4826·MAD(d_bin))²; weighted least squares
 * var = S·m + O with weights n_bin/σ⁴_bin (the variance of a variance estimate ∝ σ⁴/n).
 */
export function fitBlockNoise(m: Float64Array, d: Float64Array, h: Float64Array, bins: number, minimum: number): { kept: number; bins: DngRawNoiseBin[]; fit: { scale: number; offset: number } | null } {
  let n = 0;
  const range = new Uint32Array(m.length);
  for (let i = 0; i < m.length; i++) if (m[i]! > 0.002 && m[i]! < 0.95) range[n++] = i;
  let kept = range.subarray(0, n);
  if (n > 0) {
    const dr = new Float64Array(n);
    for (let j = 0; j < n; j++) dr[j] = d[kept[j]!]!;
    const limit = 6 * Math.max(1.4826 * mad(dr), 1e-9);
    let k = 0;
    for (let j = 0; j < n; j++) if (h[kept[j]!]! < limit) kept[k++] = kept[j]!;
    kept = kept.subarray(0, k);
  }
  const total = kept.length, means = new Float64Array(total), out: DngRawNoiseBin[] = [];
  for (let j = 0; j < total; j++) means[j] = m[kept[j]!]!;
  const per = Math.max(minimum, Math.floor(total / bins)), count = Math.floor(total / per);
  if (count >= 1) {
    const sorted = Float64Array.from(means).sort(), edges = Float64Array.from({ length: count - 1 }, (_, k) => sorted[(k + 1) * per]!);
    // Bin of each kept block (equal-count bins by mean), then a counting sort of the blocks by bin.
    const bin = new Uint16Array(total), sizes = new Uint32Array(count);
    for (let j = 0; j < total; j++) {
      let lo = 0, hi = edges.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (means[j]! >= edges[mid]!) lo = mid + 1; else hi = mid; }
      bin[j] = lo; sizes[lo]!++;
    }
    const starts = new Uint32Array(count);
    for (let b = 1; b < count; b++) starts[b] = starts[b - 1]! + sizes[b - 1]!;
    const fill = Uint32Array.from(starts), details = new Float64Array(total), sums = new Float64Array(count);
    for (let j = 0; j < total; j++) { const b = bin[j]!; details[fill[b]!++] = d[kept[j]!]!; sums[b] = sums[b]! + means[j]!; }
    for (let b = 0; b < count; b++) {
      const size = sizes[b]!;
      if (size < Math.min(minimum, per)) continue;
      out.push({ meanSignal: sums[b]! / size, variance: (1.4826 * mad(details.subarray(starts[b]!, starts[b]! + size))) ** 2, blocks: size });
    }
  }
  if (out.length < 2) return { kept: total, bins: out, fit: null };
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const b of out) { const w = b.blocks / (b.variance ** 2 + 1e-30); sw += w; sx += w * b.meanSignal; sy += w * b.variance; sxx += w * b.meanSignal ** 2; sxy += w * b.meanSignal * b.variance; }
  const det = sw * sxx - sx * sx;
  if (!(Math.abs(det) > 0)) return { kept: total, bins: out, fit: null };
  const scale = (sw * sxy - sx * sy) / det, offset = (sy - scale * sx) / sw;
  return { kept: total, bins: out, fit: Number.isFinite(scale) && Number.isFinite(offset) ? { scale, offset } : null };
}

/** Noise level from the RAW mosaic (see the module comment). Refuses LinearRaw (demosaiced noise is correlated) and lossy data. */
export function estimateDngRawNoise(raw: ImportedDngRaw, options: EstimateDngRawNoiseOptions = {}): DngRawNoise {
  const name = "estimateDngRawNoise";
  if (options === null || typeof options !== "object") fail(name, "options must be an object.");
  for (const key of Object.keys(options)) if (!["signalLevels", "bins", "minimumBlocksPerBin"].includes(key)) fail(name, "unknown option " + JSON.stringify(key) + ".");
  const levels = options.signalLevels ?? [];
  if (!Array.isArray(levels) || levels.length > 32 || levels.some((v) => typeof v !== "number" || !(v > 0 && v < 1))) fail(name, "signalLevels must be at most 32 numbers between 0 and 1.");
  const bins = options.bins ?? 16, minimum = options.minimumBlocksPerBin ?? 200;
  if (!Number.isInteger(bins) || bins < 2 || bins > 64) fail(name, "bins must be an integer from 2 to 64.");
  if (!Number.isInteger(minimum) || minimum < 20 || minimum > 100_000) fail(name, "minimumBlocksPerBin must be an integer from 20 to 100000.");
  const site = prepareDngSiteAccess(raw, name);
  if (raw.photometricInterpretation !== "cfa" || !raw.cfa) throw new InvalidScientificInputError(name + ": the file is LinearRaw (demosaiced); its noise is correlated across pixels, so no RAW noise level can be measured.");
  if (raw.lossySource) throw new InvalidScientificInputError(name + ": the raw data is lossy; coding error is not RAW noise.");
  if (raw.scale !== 1) throw new InvalidScientificInputError(name + ": a half-size preview has averaged codes.");
  const { cfa } = raw, rr = cfa.repeatRows, rc = cfa.repeatColumns, r = site.region, ax = Math.floor(raw.activeArea.x), ay = Math.floor(raw.activeArea.y);
  // Blocks: per CFA phase, non-overlapping 2 × 2 blocks of that phase's sites; d = (p00 − p01 − p10 + p11)/2 has variance σ² for
  // independent noise, h = |p00 + p10 − p01 − p11|/2 + |p00 + p01 − p10 − p11|/2 measures structure.
  // Each phase's first stored site inside the region (phase origin: the active-area top-left), its block and site counts.
  const phases = Array.from({ length: rr * rc }, (_, k) => {
    const px = k % rc, py = (k - px) / rc;
    const sx = r.x + ((((px - (r.x - ax)) % rc) + rc) % rc), sy = r.y + ((((py - (r.y - ay)) % rr) + rr) % rr);
    // Blocks need their second site inside the region: sx + 2·rc·i + rc ≤ right − 1.
    const bw = Math.max(0, Math.floor((r.x + r.width - 1 - rc - sx) / (2 * rc)) + 1), bh = Math.max(0, Math.floor((r.y + r.height - 1 - rr - sy) / (2 * rr)) + 1);
    const cw = Math.max(0, Math.ceil((r.x + r.width - sx) / rc)), ch = Math.max(0, Math.ceil((r.y + r.height - sy) / rr));
    return { sx, sy, plane: site.planeOf(sx - ax, sy - ay, 0), blocks: bw * bh, bw, bh, sites: cw * ch, cw, ch };
  });
  const blocks = Array.from({ length: site.planes }, (_, p) => {
    const mine = phases.filter((q) => q.plane === p), nb = mine.reduce((t, q) => t + q.blocks, 0), ns = mine.reduce((t, q) => t + q.sites, 0);
    return { m: new Float64Array(nb), d: new Float64Array(nb), h: new Float64Array(nb), signal: new Float64Array(ns), total: 0, sites: 0 };
  });
  const at = (x: number, y: number): number => site.value(raw.codes[y * raw.width + x]!, x - ax, y - ay, 0);
  for (const q of phases) {
    const k = blocks[q.plane]!;
    for (let j = 0; j < q.bh; j++) for (let i = 0; i < q.bw; i++) {
      const x = q.sx + 2 * rc * i, y = q.sy + 2 * rr * j, a = at(x, y), b = at(x + rc, y), c = at(x, y + rr), e = at(x + rc, y + rr), t = k.total++;
      k.m[t] = (a + b + c + e) / 4; k.d[t] = (a - b - c + e) / 2; k.h[t] = Math.abs(a + c - b - e) / 2 + Math.abs(a + b - c - e) / 2;
    }
    for (let j = 0; j < q.ch; j++) for (let i = 0; i < q.cw; i++) k.signal[k.sites++] = at(q.sx + rc * i, q.sy + rr * j);
  }
  const planes = blocks.map((k, p): DngRawNoisePlane => {
    const result = fitBlockNoise(k.m, k.d, k.h, bins, minimum);
    const median = k.signal.length ? medianInPlace(k.signal) : 0;
    const sigma = (x: number): number | null => { if (!result.fit) return null; const v = result.fit.scale * x + result.fit.offset; return v > 0 ? Math.sqrt(v) : null; };
    const np = raw.noiseProfile?.[p], stated = np ? Math.sqrt(np.scale * Math.max(0, median) + np.offset) : null, measured = sigma(median);
    return { plane: p, color: site.planeNames[p]!, blocksKept: result.kept, blocksTotal: k.total, bins: result.bins, fit: result.fit, medianSignal: median,
      sigmaAtMedian: measured, sigmaAtLevels: levels.map((x) => ({ signal: x, sigma: sigma(x) })), profileSigmaAtMedian: stated,
      measuredToProfile: stated && measured !== null ? measured / stated : null };
  });
  return {
    region: { ...r }, planes, confidence: "measured",
    label: "Measured RAW noise (σ at this brightness); may read high on fine texture.",
    assumptions: [
      "Poisson–Gaussian fit var = S·x + O from 2 × 2 same-color blocks: robust MAD of the diagonal Haar detail per signal bin (Foi et al. 2008; Donoho & Johnstone 1994).",
      "Accuracy on engine captures (#607; ISO 100 and 3200, every color plane): σ at the median signal −10 % to +0.5 % of the true noise on charts with flat areas or edges, +9 % to +38 % on dense fine texture (texture reads as noise).",
      "The offset O is poorly determined; σ at typical signal is the reliable figure. Fixed-pattern noise is not separated.",
      "Measured over the default crop (" + r.width + " × " + r.height + " sites); opcode lists are not applied."
    ]
  };
}
