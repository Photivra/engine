// SPDX-License-Identifier: Apache-2.0
/**
 * Float32 JavaScript emulation (Math.fround after every operation; correctly rounded exp, sqrt and log2) of the display
 * view's three Quality kernels (`wgsl-display-view-quality-kernel.ts`: lattice materials, site moments, display pixels),
 * for the in-process fake WebGPU device. It mirrors the WGSL line by line, running-bound pairs included; the material module
 * is an emulator object (`ChartMaterialEmulator`). Real-device conformance lives in test/webgpu.
 */
import { DISPLAY_VIEW_QUALITY_AUX, DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS, DISPLAY_VIEW_QUALITY_CHOICE_SIGMA, DISPLAY_VIEW_QUALITY_FLAG, DISPLAY_VIEW_QUALITY_GEOMETRY_STRIDE, DISPLAY_VIEW_QUALITY_GROUP_WORDS,
  DISPLAY_VIEW_QUALITY_OUTPUT_FLOATS, DISPLAY_VIEW_QUALITY_SITE_FLOATS, DISPLAY_VIEW_QUALITY_SLOPE_U, DISPLAY_VIEW_QUALITY_TAP_WORDS, DISPLAY_VIEW_QUALITY_UNCERTAINTY_LIMIT } from "../../src/gpu/wgsl-display-view-quality-kernel.js";
import { DISPLAY_VIEW_CLIP_MEAN_U, DISPLAY_VIEW_CLIP_VARIANCE_U, DISPLAY_VIEW_REINHARD_MEAN_U, DISPLAY_VIEW_REINHARD_VARIANCE_U } from "../../src/gpu/wgsl-display-view-speed-kernel.js";
import { AHD_KEY_FLOOR, AHD_KEY_LEVELS, AHD_KEY_OCTAVES, AHD_KEY_STEPS } from "../../src/facade/display-view.js";
import type { ChartMaterialEmulator } from "./fake-webgpu-stages.js";
import { ExactSum } from "./exact-sum-emulation.js";
import { clipState } from "./fake-webgpu-display-view.js";

const f = Math.fround;
const E = f(2 ** -23), REACH = 8.5, CM = f(DISPLAY_VIEW_CLIP_MEAN_U), CV = f(DISPLAY_VIEW_CLIP_VARIANCE_U), CS = f(DISPLAY_VIEW_QUALITY_SLOPE_U);
const RM = f(DISPLAY_VIEW_REINHARD_MEAN_U), RV = f(DISPLAY_VIEW_REINHARD_VARIANCE_U), RS = 64;
const STRIDE = DISPLAY_VIEW_QUALITY_GEOMETRY_STRIDE, SITE = DISPLAY_VIEW_QUALITY_SITE_FLOATS, GROUP = DISPLAY_VIEW_QUALITY_GROUP_WORDS, TAP = DISPLAY_VIEW_QUALITY_TAP_WORDS, CF = DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS;
const PHI_C = f(0.3989422804014327), AS = [f(0.2316419), f(0.319381530), f(-0.356563782), f(1.781477937), f(-1.821255978), f(1.330274429)];
const UNCERTAINTY_LIMIT = f(DISPLAY_VIEW_QUALITY_UNCERTAINTY_LIMIT), CHOICE_SIGMA = f(DISPLAY_VIEW_QUALITY_CHOICE_SIGMA);
const KEY_TOP = AHD_KEY_OCTAVES * AHD_KEY_STEPS - 1, KEY_FLOOR = f(AHD_KEY_FLOOR), LOG2E = f(1.4426950408889634), LOG_ABS = f(4.76837158203125e-7);

/** A value with its absolute bound. */
type B = [number, number];
const bAdd = (a: B, b: B): B => { const v = f(a[0] + b[0]); return [v, f(f(a[1] + b[1]) + f(E * Math.abs(v)))]; };
const bMul = (a: B, b: B): B => { const v = f(a[0] * b[0]); return [v, f(f(f(Math.abs(a[0]) * b[1]) + f(Math.abs(b[0]) * a[1])) + f(E * Math.abs(v)))]; };
const bScale = (a: B, k: number): B => { const v = f(a[0] * k); return [v, f(f(a[1] * Math.abs(k)) + f(E * Math.abs(v)))]; };
const bRounded = (k: number): B => [k, f(E * Math.abs(k))];
const bDiv = (a: B, b: B): B => { const v = f(a[0] / b[0]); return [v, f(f(f(a[1] + f(Math.abs(v) * b[1])) / Math.abs(b[0])) + f(f(2.5 * E) * Math.abs(v)))]; };
const bSqrt = (a: B): B => { const s = f(Math.sqrt(Math.max(a[0], 0))); return s > 0 ? [s, f(Math.min(f(a[1] / f(2 * s)), f(Math.sqrt(a[1]))) + f(f(4.5 * E) * s))] : [0, f(Math.sqrt(a[1]))]; };
const Z: B = [0, 0];

const phi = (z: number): number => f(PHI_C * f(Math.exp(f(f(f(-0.5) * z) * z))));
function pq(z: number): [number, number] {
  const x = Math.abs(z), t = f(1 / f(1 + f(AS[0]! * x)));
  const q = f(f(phi(x) * t) * f(AS[1]! + f(t * f(AS[2]! + f(t * f(AS[3]! + f(t * f(AS[4]! + f(t * AS[5]!)))))))));
  return z >= 0 ? [f(1 - q), q] : [q, f(1 - q)];
}
interface Moments { mean: B; variance: B; slope: B }
function upperClip(m: B, v: B, top: number): Moments {
  if (!(v[0] > 0)) { const decided = v[1] === 0 && (f(m[0] - m[1]) >= top || f(m[0] + m[1]) < top); return { mean: [Math.min(m[0], top), m[1]], variance: [0, v[1]], slope: [m[0] < top ? 1 : 0, decided ? 0 : 1] }; }
  const s = bSqrt(v), z = f(f(top - m[0]) / s[0]);
  if (z > REACH) return { mean: m, variance: v, slope: [1, 0] };
  if (z < -REACH) return { mean: [top, 0], variance: [0, 0], slope: [0, 0] };
  const [P, Q] = pq(z), d = phi(z), delta = f(d - f(z * Q));
  const ratio = f(f(f(P - f(z * d)) + f(f(z * z) * Q)) - f(delta * delta));
  const rhoZ = f(f(2 * Q) * f(z + delta));
  return { mean: [f(m[0] - f(s[0] * delta)), f(f(f(P * m[1]) + f(d * s[1])) + f(f(CM * E) * s[0]))],
    variance: [f(v[0] * Math.max(0, ratio)), f(f(f(f(s[0] * Math.abs(rhoZ)) * m[1]) + f(f(s[0] * Math.abs(f(f(2 * ratio) - f(z * rhoZ)))) * s[1])) + f(f(CV * E) * v[0]))],
    slope: [P, Math.min(1, f(f(f(f(d * m[1]) + f(f(Math.abs(z) * d) * s[1])) / s[0]) + f(CS * E)))] };
}
function unitClip(m: B, v: B, skew: B): Moments {
  if (!(v[0] > 0)) {
    const decided = v[1] === 0 && ((f(m[0] - m[1]) > 0 && f(m[0] + m[1]) < 1) || f(m[0] + m[1]) <= 0 || f(m[0] - m[1]) >= 1);
    return { mean: [Math.min(1, Math.max(0, m[0])), m[1]], variance: [0, v[1]], slope: [m[0] > 0 && m[0] < 1 ? 1 : 0, decided ? 0 : 1] };
  }
  const s = bSqrt(v), a = f(-m[0] / s[0]), b = f(f(1 - m[0]) / s[0]);
  if (a < -REACH && b > REACH) return { mean: m, variance: v, slope: [1, 0] };
  let pa = 0, da = 0, pb = 1, qb = 0, db = 0;
  if (!(a < -REACH)) { pa = pq(a)[0]; da = phi(a); }
  if (!(b > REACH)) { const p = pq(b); pb = p[0]; qb = p[1]; db = phi(b); }
  const inside = f(pb - pa), gamma = Math.min(1, Math.max(-1, skew[0])), aa = f(a * da), bb = f(b * db);
  const eg = f(f(f(a * pa) + f(da - db)) + f(b * qb));
  const eg2 = f(f(f(f(f(a * a) * pa) + inside) - f(bb - aa)) + f(f(b * b) * qb));
  const normalMean = f(m[0] + f(s[0] * eg));
  let mean = normalMean, shift = 0;
  if (gamma !== 0) { shift = f(f(f(s[0] * gamma) / 6) * f(aa - bb)); mean = f(normalMean + shift); }
  const dShift = f(f(f(f(0.1) * s[0]) * Math.min(2, skew[1])) + f(f(f(0.1) * Math.abs(gamma)) * s[1])) + f(E * Math.abs(shift));
  const rho = f(eg2 - f(eg * eg)), rhoA = f(f(2 * pa) * f(a - eg)), rhoB = f(f(2 * qb) * f(b - eg));
  const dMean = f(f(f(f(m[1] * inside) + f(Math.abs(f(da - db)) * s[1])) + f(f(f(2 * CM) * E) * s[0])) + dShift);
  const normalVariance = f(v[0] * rho);
  const dNormal = f(f(f(f(s[0] * Math.abs(f(rhoA + rhoB))) * m[1]) + f(f(s[0] * Math.abs(f(f(f(2 * rho) - f(a * rhoA)) - f(b * rhoB)))) * s[1])) + f(f(f(2 * CV) * E) * v[0]));
  const variance = Math.max(0, f(normalVariance - f(shift * f(f(2 * normalMean) + shift))));
  let dVar = f(dNormal + f(2 * f(f(dShift * f(Math.abs(normalMean) + Math.abs(shift))) + f(Math.abs(shift) * dMean))));
  if (shift > dShift) dVar = Math.min(dVar, Math.max(variance, f(Math.max(0, normalVariance) + dNormal)));
  return { mean: [mean, dMean], variance: [variance, dVar],
    slope: [inside, Math.min(1, f(f(f(f(Math.abs(f(da - db)) * m[1]) + f(Math.abs(f(aa - bb)) * s[1])) / s[0]) + f(f(2 * CS) * E)))] };
}
function reinhardMoments(m: B, v: B, aux: Float32Array): Moments {
  if (!(v[0] > 0)) {
    if (m[0] > 0) { const h = f(m[0] / f(1 + m[0])); return { mean: [h, f(m[1] + f(f(4 * E) * h))], variance: [0, v[1]], slope: [f(1 / f(f(1 + m[0]) * f(1 + m[0]))), Math.min(1, f(f(2 * m[1]) + f(6 * E)))] }; }
    return { mean: [0, m[1]], variance: [0, v[1]], slope: [0, 1] };
  }
  const s = bSqrt(v), zlo = Math.max(f(-m[0] / s[0]), -REACH);
  if (!(REACH > zlo)) return { mean: [0, f(m[1] + s[1])], variance: [0, v[1]], slope: [0, 1] };
  const hm = m[0] > 0 ? f(m[0] / f(1 + m[0])) : 0, zwidth = f(f(REACH - zlo) / 4);
  let e1 = 0, e2 = 0, ed = 0;
  for (let p = 0; p < 4; p++) {
    const zc = f(zlo + f(f(p + 0.5) * zwidth)), zhalf = f(zwidth / 2);
    for (let k = 0; k < 16; k++) {
      const z = f(zc + f(zhalf * aux[DISPLAY_VIEW_QUALITY_AUX.gaussLegendre + k]!)), x = f(m[0] + f(s[0] * z));
      const weight = f(f(zhalf * aux[DISPLAY_VIEW_QUALITY_AUX.gaussLegendre + 16 + k]!) * phi(z)), h = f(x / f(1 + x));
      e1 = f(e1 + f(weight * h)); e2 = f(e2 + f(f(weight * f(h - hm)) * f(h - hm))); ed = f(ed + f(weight / f(f(1 + x) * f(1 + x))));
    }
  }
  const shifted = f(e1 - hm), variance = Math.max(0, f(e2 - f(shifted * shifted)));
  return { mean: [e1, f(f(m[1] + s[1]) + f(f(RM * E) * Math.abs(e1)))], variance: [variance, f(f(f(f(2 * s[0]) * m[1]) + f(2 * v[1])) + f(f(RV * E) * variance))],
    slope: [ed, Math.min(1, f(f(f(2 * m[1]) + f(2 * s[1])) + f(RS * E)))] };
}

/** The parameter words of the Quality passes (`Params`). */
function readParams(pw: Uint32Array, pf: Float32Array): Record<string, number> {
  const pi = new Int32Array(pw.buffer, pw.byteOffset, pw.length);
  return { count: pw[0]!, row0: pw[1]!, regionW: pw[2]!, margin: pw[5]!, nativeW: pw[6]!, nativeH: pw[7]!, columns: pw[8]!, tone: pw[9]!, reach: pw[10]!, candidates: pw[11]!,
    siteX0: pi[12]!, siteY0: pi[13]!, siteW: pw[14]!, siteH: pw[15]!, correction: pw[16]!, stateCount: pw[17]!, taps: pw[18]!, groups: pw[19]!, latticeTotal: pw[20]!,
    k0: pf[24]!, k1: pf[25]!, k2: pf[26]!, reach2: pf[27]!, dark0: pf[28]!, dark1: pf[29]!, dark2: pf[30]!, clipLevel: pf[31]!, c00: pf[32]!, c01: pf[33]!, c02: pf[34]!, threshold: pf[35]!,
    g0: pf[36]!, g1: pf[37]!, g2: pf[38]!, scaleU: pf[39]!, scaleV: pf[49]!, siteGamma: pf[50]!, siteFirst: pw[51]!, siteTiny: pf[52]! };
}

/** Pass 1. */
export function emulateDisplayViewQualityLattice(pw: Uint32Array, pf: Float32Array, groups: Uint32Array, lattice: Uint32Array, material: ChartMaterialEmulator): void {
  const P = readParams(pw, pf), gi = new Int32Array(groups.buffer, groups.byteOffset, groups.length), gf = new Float32Array(groups.buffer, groups.byteOffset, groups.length);
  for (let i = 0; i < P.latticeTotal!; i++) {
    let g = 0;
    for (let k = 1; k < P.groups!; k++) if (i >= groups[k * GROUP + 4]!) g = k;
    const base = g * GROUP, lw = groups[base + 2]!, local = i - groups[base + 4]!;
    const q = gi[base + 1]! + Math.floor(local / lw), p = gi[base]! + (local % lw);
    const u = f(f(f(p) + gf[base + 6]!) * P.scaleU!), v = f(f(f(q) + gf[base + 7]!) * P.scaleV!);
    material.reset();
    const m = material.material(u, v);
    lattice[i] = (m | (material.flagged ? 0x80000000 : 0)) >>> 0;
  }
}

/** The end of pass 2 (`write_site`): the readout moments, the white clip and their bounds of site i. */
function writeSite(P: Record<string, number>, sites: Float32Array, sw: Uint32Array, i: number, c: number, e: number, de: number, flag: number): void {
  const k = [P.k0!, P.k1!, P.k2!], c0 = [P.c00!, P.c01!, P.c02!];
  const kc = k[c]!, mean = f(kc * e), variance = f(f(f(kc * kc) * e) + c0[c]!), third = f(f(f(kc * kc) * kc) * e);
  let m: B = [mean, f(f(kc * de) + f(f(2 * E) * mean))], v: B = [variance, f(f(f(kc * kc) * de) + f(f(4 * E) * variance))];
  const gap = f(1 - mean), state = clipState(m[0], m[1], v[0], v[1], P.reach2!), bits = flag | (state === 1 ? 2 : 0) | (state === 2 ? 4 : 0);
  if (!(gap > 0 && f(gap * gap) > f(P.reach2! * variance))) { const clipped = upperClip(m, v, 1); m = clipped.mean; v = clipped.variance; }
  const o = i * SITE;
  sites[o] = m[0]; sites[o + 1] = v[0]; sites[o + 2] = third; sites[o + 3] = m[1]; sites[o + 4] = v[1]; sites[o + 5] = f(f(f(f(kc * kc) * kc) * de) + f(f(5 * E) * third));
  sw[o + 6] = bits; sites[o + 7] = e;
}
const channelOf = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));

/** 2.21.0: `node_total`, the exact sum of the per-node partials and the dark electrons, rounded once (EXACT_SUM_WGSL). */
const exact = new ExactSum();
function nodeTotal(partial: Float32Array, N: number, dark: number): number {
  let anchor = ExactSum.exponent(dark);
  for (let k = 0; k < N; k++) if (partial[k]! > 0) anchor = Math.max(anchor, ExactSum.exponent(partial[k]!));
  exact.reset(anchor);
  for (let k = 0; k < N; k++) exact.add(partial[k]!);
  exact.add(dark);
  return exact.round();
}

/** Pass 2 (the tap list), over the dispatch's `count` sites from `site_first`. */
export function emulateDisplayViewQualitySites(pw: Uint32Array, pf: Float32Array, groups: Uint32Array, taps: Uint32Array, table: Float32Array, lattice: Uint32Array, sites: Float32Array, spread: Float32Array): void {
  const P = readParams(pw, pf), sw = new Uint32Array(sites.buffer, sites.byteOffset, sites.length), dark = [P.dark0!, P.dark1!, P.dark2!];
  const T = P.taps!, N = pw[53]!, spectra = 3 * T * N, partial = new Float32Array(N);
  for (let local = 0; local < P.count!; local++) {
    const i = P.siteFirst! + local, ii = i % P.siteW!, jj = Math.floor(i / P.siteW!), x = P.siteX0! + ii, y = P.siteY0! + jj, c = channelOf(x, y);
    let uncertainty = 0;
    partial.fill(0);
    for (let t = 0; t < T; t++) {
      const tb = t * TAP, g = taps[tb]! * GROUP, index = groups[g + 4]! + (jj + taps[tb + 2]!) * groups[g + 2]! + ii + taps[tb + 1]!, raw = lattice[index]!;
      if ((raw >>> 31) !== 0) uncertainty = f(uncertainty + spread[c * T + t]!);
      const kb = (c * T + t) * N, lb = spectra + (raw & 0x7fffffff) * N;
      for (let n = 0; n < N; n++) partial[n] = f(partial[n]! + f(table[kb + n]! * table[lb + n]!));
    }
    const e = nodeTotal(partial, N, dark[c]!), flag = uncertainty > f(UNCERTAINTY_LIMIT * e) ? 1 : 0, de = f(f(f(P.siteGamma! * e) + uncertainty) + P.siteTiny!);
    writeSite(P, sites, sw, i, c, e, de, flag);
  }
}

/** Pass 2 with the blocked sum (#492): per node, rows, then groups, then the total; no tap records. */
export function emulateDisplayViewQualitySitesBlocked(pw: Uint32Array, pf: Float32Array, groups: Uint32Array, table: Float32Array, lattice: Uint32Array, sites: Float32Array, spread: Float32Array): void {
  const P = readParams(pw, pf), sw = new Uint32Array(sites.buffer, sites.byteOffset, sites.length), dark = [P.dark0!, P.dark1!, P.dark2!];
  const T = P.taps!, N = pw[53]!, spectra = 3 * T * N, total = new Float32Array(N), groupSum = new Float32Array(N), rowSum = new Float32Array(N);
  for (let local = 0; local < P.count!; local++) {
    const i = P.siteFirst! + local, ii = i % P.siteW!, jj = Math.floor(i / P.siteW!), x = P.siteX0! + ii, y = P.siteY0! + jj, c = channelOf(x, y);
    let uncertainty = 0;
    total.fill(0);
    for (let k = 0; k < P.groups!; k++) {
      const g = k * GROUP, lw = groups[g + 2]!, cw = lw - P.siteW! + 1, ch = groups[g + 3]! - P.siteH! + 1, lattice0 = groups[g + 4]! + jj * lw + ii, tap0 = groups[g + 5]!;
      let groupUncertainty = 0;
      groupSum.fill(0);
      for (let dy = 0; dy < ch; dy++) {
        const row = lattice0 + dy * lw, rowTap = tap0 + dy * cw;
        let rowUncertainty = 0;
        rowSum.fill(0);
        for (let dx = 0; dx < cw; dx++) {
          const raw = lattice[row + dx]!, t = rowTap + dx;
          if ((raw >>> 31) !== 0) rowUncertainty = f(rowUncertainty + spread[c * T + t]!);
          const kb = (c * T + t) * N, lb = spectra + (raw & 0x7fffffff) * N;
          for (let n = 0; n < N; n++) rowSum[n] = f(rowSum[n]! + f(table[kb + n]! * table[lb + n]!));
        }
        for (let n = 0; n < N; n++) groupSum[n] = f(groupSum[n]! + rowSum[n]!);
        groupUncertainty = f(groupUncertainty + rowUncertainty);
      }
      for (let n = 0; n < N; n++) total[n] = f(total[n]! + groupSum[n]!);
      uncertainty = f(uncertainty + groupUncertainty);
    }
    const e = nodeTotal(total, N, dark[c]!), flag = uncertainty > f(UNCERTAINTY_LIMIT * e) ? 1 : 0;
    const de = f(f(f(P.siteGamma! * e) + f(uncertainty * f(1 + P.siteGamma!))) + P.siteTiny!);
    writeSite(P, sites, sw, i, c, e, de, flag);
  }
}

/** Pass 3. */
export function emulateDisplayViewQualityPixels(pw: Uint32Array, pf: Float32Array, aux: Float32Array, geometry: Float32Array, sites: Float32Array, stateKeys: Int32Array, stateValues: Float32Array,
  bitmap: Uint32Array, out: Float32Array, flags: Uint32Array): void {
  const P = readParams(pw, pf), M = Array.from(pf.subarray(40, 49)), g = [P.g0!, P.g1!, P.g2!], gainAtClip = Array.from(pw.subarray(21, 24)), reinhard = P.tone === 1, count = P.candidates!, share = count === 2 ? 0.5 : 1;
  const geometryInts = new Int32Array(geometry.buffer, geometry.byteOffset, geometry.length), auxWords = new Uint32Array(aux.buffer, aux.byteOffset, aux.length), siteWords = new Uint32Array(sites.buffer, sites.byteOffset, sites.length);
  const reflectX = (x: number): number => (x < 0 ? -x : x >= P.nativeW! ? 2 * P.nativeW! - 2 - x : x), reflectY = (y: number): number => (y < 0 ? -y : y >= P.nativeH! ? 2 * P.nativeH! - 2 - y : y);
  let pixelFlags = 0;
  const siteAt = (x: number, y: number): number => {
    const rx = reflectX(x) - P.siteX0!, ry = reflectY(y) - P.siteY0!;
    if (rx < 0 || ry < 0 || rx >= P.siteW! || ry >= P.siteH!) { pixelFlags |= DISPLAY_VIEW_QUALITY_FLAG.siteOutsideWindow; return 0; }
    const o = (ry * P.siteW! + rx) * SITE;
    pixelFlags |= siteWords[o + 6]! & 1;
    return o;
  };
  const findState = (key: number): number => {
    let lo = 0, hi = P.stateCount!;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (stateKeys[mid]! < key) lo = mid + 1; else hi = mid; }
    return lo < P.stateCount! && stateKeys[lo] === key ? lo : P.stateCount!;
  };
  const flatCorrection = (m: B[]): B[] => {
    const base: number[] = [], frac: number[] = [], dg: number[] = [];
    for (let i = 0; i < 3; i++) {
      const clamped = Math.min(1, Math.max(KEY_FLOOR, m[i]![0])), gg = f(f(f(Math.log2(clamped)) + AHD_KEY_OCTAVES) * AHD_KEY_STEPS);
      const b = Math.min(Math.max(Math.floor(gg), 0), KEY_TOP);
      base.push(b); frac.push(f(gg - b));
      const slope = m[i]![0] > KEY_FLOOR && m[i]![0] < 1 ? f(f(LOG2E * m[i]![1]) / clamped) : 0;
      dg.push(f(f(AHD_KEY_STEPS * f(f(slope + LOG_ABS) + f(36 * E))) + f(f(2 * E) * f(gg + 1))));
    }
    const values = new Float32Array(24);
    let missing = false;
    const weightOf = (corner: number): number => { let w = 1; for (let i = 0; i < 3; i++) w = f(w * (((corner >> i) & 1) === 1 ? frac[i]! : f(1 - frac[i]!))); return w; };
    for (let corner = 0; corner < 8; corner++) {
      const i0 = base[0]! + (corner & 1), i1 = base[1]! + ((corner >> 1) & 1), i2 = base[2]! + ((corner >> 2) & 1), key = (i0 * AHD_KEY_LEVELS + i1) * AHD_KEY_LEVELS + i2;
      if (weightOf(corner) === 0) continue;
      bitmap[key >>> 5] = (bitmap[key >>> 5]! | (1 << (key & 31))) >>> 0;
      const at = findState(key);
      if (at >= P.stateCount!) { missing = true; continue; }
      for (let c = 0; c < 3; c++) values[corner * 3 + c] = stateValues[at * 3 + c]!;
    }
    if (missing) { pixelFlags |= DISPLAY_VIEW_QUALITY_FLAG.stateMissing; return [Z, Z, Z]; }
    const corr: B[] = [];
    for (let c = 0; c < 3; c++) {
      let sum = 0, mag = 0;
      for (let corner = 0; corner < 8; corner++) { const w = weightOf(corner); sum = f(sum + f(w * values[corner * 3 + c]!)); mag = f(mag + Math.abs(f(w * values[corner * 3 + c]!))); }
      let slopeTerm = 0;
      for (let i = 0; i < 3; i++) {
        let largest = 0;
        for (let corner = 0; corner < 8; corner++) { if (((corner >> i) & 1) === 1) continue; largest = Math.max(largest, Math.abs(f(values[(corner | (1 << i)) * 3 + c]! - values[corner * 3 + c]!))); }
        slopeTerm = f(slopeTerm + f(dg[i]! * largest));
      }
      corr.push([sum, f(slopeTerm + f(f(12 * E) * mag))]);
    }
    return corr;
  };
  const CB = DISPLAY_VIEW_QUALITY_AUX.candidates, CSTRIDE = DISPLAY_VIEW_QUALITY_AUX.candidatePhaseStride;
  for (let i = 0; i < P.count!; i++) {
    pixelFlags = 0;
    const rx = i % P.regionW!, ry = P.row0! + Math.floor(i / P.regionW!), col = rx * STRIDE, row = (P.columns! + ry) * STRIDE;
    const colFirst = geometryInts[col]!, nx = geometryInts[col + 1]!, rowFirst = geometryInts[row]!, ny = geometryInts[row + 1]!, margin = P.margin!;
    const G = (at: number): number => geometry[at]!;
    const xbE = G(col + 8), xbO = G(col + 9), xppE = G(col + 10), xppO = G(col + 11), xqqE = G(col + 12), xqqO = G(col + 13), xpqE = G(col + 14), xpqO = G(col + 15);
    const ybE = G(row + 8), ybO = G(row + 9), yppE = G(row + 10), yppO = G(row + 11), yqqE = G(row + 12), yqqO = G(row + 13), ypqE = G(row + 14), ypqO = G(row + 15);
    const green = (xpp: number, xqq: number, xpq: number, ypp: number, yqq: number, ypq: number): number =>
      f(f(f(f(f(f(xpp * ypp) + f(xqq * ypp)) + f(xpp * yqq)) + f(f(2 * xpq) * ypp)) + f(f(2 * xpp) * ypq)) + f(f(2 * xpq) * ypq));
    const bOf = [f(xbE * ybE), f(green(xppO, xqqO, xpqO, yppE, yqqE, ypqE) + green(xppE, xqqE, xpqE, yppO, yqqO, ypqO)), f(xbO * ybO)];
    const s: B[] = [Z, Z, Z], cov: B[] = [Z, Z, Z, Z, Z, Z], res: B[] = [Z, Z, Z];
    const choice = [0, 0, 0];
    let mask0 = 0, mask1 = 0, undecided = false;
    for (let j = 0; j < ny; j++) {
      const ay = G(row + 2 + j);
      for (let ii = 0; ii < nx; ii++) {
        const ajv = f(G(col + 2 + ii) * ay), aj: B = [ajv, f(f(3 * E) * Math.abs(ajv))], x = colFirst + ii + margin, y = rowFirst + j + margin, phase = (y & 1) * 2 + (x & 1);
        const csv: B[] = [];
        for (let c = 0; c < 3; c++) {
          let variance: B = Z;
          const tb = DISPLAY_VIEW_QUALITY_AUX.bilinear + (phase * 3 + c) * 16;
          for (let t = 0; t < 4; t++) {
            const w = aux[tb + 4 * t + 2]!;
            if (w === 0) continue;
            const o = siteAt(x + aux[tb + 4 * t]!, y + aux[tb + 4 * t + 1]!);
            variance = bAdd(variance, bScale([sites[o + 1]!, sites[o + 4]!], f(w * w)));
          }
          csv.push(bMul(variance, bRounded(aux[DISPLAY_VIEW_QUALITY_AUX.inverseW2 + phase * 3 + c]!)));
        }
        const cb = CB + phase * CSTRIDE, entries = auxWords[cb]!;
        let clipAny = 0;
        const clipBits = (o: number): number => (siteWords[o + 6]! >>> 1) & 3;
        for (let c = 0; c < 3; c++) {
          const tb = DISPLAY_VIEW_QUALITY_AUX.bilinear + (phase * 3 + c) * 16;
          for (let t = 0; t < 4; t++) { if (aux[tb + 4 * t + 2] === 0) continue; clipAny |= clipBits(siteAt(x + aux[tb + 4 * t]!, y + aux[tb + 4 * t + 1]!)); }
        }
        for (let n = 0; n < entries; n++) {
          const eb = cb + 4 + n * CF;
          let used = false;
          for (let k = 0; k < 3 * count; k++) if (aux[eb + 2 + k] !== 0) used = true;
          if (used) clipAny |= clipBits(siteAt(x + aux[eb]!, y + aux[eb + 1]!));
        }
        if ((clipAny & 1) !== 0) { const bit = j * nx + ii; if (bit < 32) mask0 = (mask0 | (1 << bit)) >>> 0; else mask1 = (mask1 | (1 << (bit - 32))) >>> 0; }
        else if ((clipAny & 2) !== 0) undecided = true;
        const eMean: B[] = [Z, Z, Z], cmAverage: B[] = [Z, Z, Z];
        let pixelVariance: B = Z;
        let bs: B[] = [], hs: B[] = [];
        const hCand: B[] = [Z, Z, Z, Z, Z, Z];
        for (let d = 0; d < count; d++) {
          const cm: B[] = [Z, Z, Z], C: B[] = [Z, Z, Z, Z, Z, Z], exact = [true, true, true];
          for (let n = 0; n < entries; n++) {
            const eb = cb + 4 + n * CF + 2 + d * 3, w0 = aux[eb]!, w1 = aux[eb + 1]!, w2 = aux[eb + 2]!;
            if (w0 === 0 && w1 === 0 && w2 === 0) continue;
            const o = siteAt(x + aux[cb + 4 + n * CF]!, y + aux[cb + 4 + n * CF + 1]!), sm: B = [sites[o]!, sites[o + 3]!], sv: B = [sites[o + 1]!, sites[o + 4]!];
            const white = sm[1] === 0 && sm[0] === 1;
            exact[0] = exact[0]! && (white || w0 === 0); exact[1] = exact[1]! && (white || w1 === 0); exact[2] = exact[2]! && (white || w2 === 0);
            cm[0] = bAdd(cm[0]!, bScale(sm, w0)); cm[1] = bAdd(cm[1]!, bScale(sm, w1)); cm[2] = bAdd(cm[2]!, bScale(sm, w2));
            C[0] = bAdd(C[0]!, bScale(sv, f(w0 * w0))); C[1] = bAdd(C[1]!, bScale(sv, f(w0 * w1))); C[2] = bAdd(C[2]!, bScale(sv, f(w0 * w2)));
            C[3] = bAdd(C[3]!, bScale(sv, f(w1 * w1))); C[4] = bAdd(C[4]!, bScale(sv, f(w1 * w2))); C[5] = bAdd(C[5]!, bScale(sv, f(w2 * w2)));
          }
          for (let c = 0; c < 3; c++) { if (exact[c]) cm[c] = [cm[c]![0], 0]; cmAverage[c] = bAdd(cmAverage[c]!, bScale(cm[c]!, share)); }
          const bm: B[] = [], bv: B[] = []; bs = [];
          for (let c = 0; c < 3; c++) {
            const gc = bRounded(g[c]!), um: B = exact[c] && cm[c]![0] === 1 && gainAtClip[c] === 1 ? [P.clipLevel!, 0] : bMul(gc, cm[c]!), uv = bMul(bMul(gc, gc), C[c === 0 ? 0 : c === 1 ? 3 : 5]!), gap = f(P.clipLevel! - um[0]);
            if (gap > 0 && f(gap * gap) > f(P.reach2! * uv[0])) { bm.push(um); bv.push(uv); bs.push(gc); }
            else { const clipped = upperClip(um, uv, P.clipLevel!); bm.push(clipped.mean); bv.push(clipped.variance); bs.push(bMul(gc, clipped.slope)); }
          }
          const hm: B[] = [], hv: B[] = []; hs = [];
          for (let comp = 0; comp < 3; comp++) {
            const r0 = bRounded(M[comp * 3]!), r1 = bRounded(M[comp * 3 + 1]!), r2 = bRounded(M[comp * 3 + 2]!);
            const mean = bAdd(bAdd(bMul(r0, bm[0]!), bMul(r1, bm[1]!)), bMul(r2, bm[2]!));
            let variance = bAdd(bAdd(bMul(bMul(r0, r0), bv[0]!), bMul(bMul(r1, r1), bv[1]!)), bMul(bMul(r2, r2), bv[2]!));
            const x01 = bMul(bMul(bMul(r0, r1), bMul(bs[0]!, bs[1]!)), C[1]!), x02 = bMul(bMul(bMul(r0, r2), bMul(bs[0]!, bs[2]!)), C[2]!), x12 = bMul(bMul(bMul(r1, r2), bMul(bs[1]!, bs[2]!)), C[4]!);
            variance = bAdd(variance, bScale(bAdd(bAdd(x01, x02), x12), 2));
            let moments: Moments;
            if (!reinhard && mean[0] > 0 && mean[0] < 1 && f(mean[0] * mean[0]) > f(P.reach2! * variance[0]) && f(f(1 - mean[0]) * f(1 - mean[0])) > f(P.reach2! * variance[0])) moments = { mean, variance, slope: [1, 0] };
            else if (reinhard) moments = reinhardMoments(mean, variance, aux);
            else {
              let third: B = Z;
              const k0 = bMul(r0, bs[0]!), k1 = bMul(r1, bs[1]!), k2 = bMul(r2, bs[2]!);
              for (let n = 0; n < entries; n++) {
                const eb = cb + 4 + n * CF + 2 + d * 3, w0 = aux[eb]!, w1 = aux[eb + 1]!, w2 = aux[eb + 2]!;
                if (w0 === 0 && w1 === 0 && w2 === 0) continue;
                const o = siteAt(x + aux[cb + 4 + n * CF]!, y + aux[cb + 4 + n * CF + 1]!);
                const coefficient = bAdd(bAdd(bScale(k0, w0), bScale(k1, w1)), bScale(k2, w2)), cube = bMul(bMul(coefficient, coefficient), coefficient);
                third = bAdd(third, bMul(cube, [sites[o + 2]!, sites[o + 5]!]));
              }
              const skew: B = variance[0] > 0 ? bDiv(third, bMul(variance, bSqrt(variance))) : Z;
              moments = unitClip(mean, variance, skew);
            }
            hm.push(moments.mean); hv.push(moments.variance); hs.push(moments.slope);
            hCand[d * 3 + comp] = moments.mean;
            eMean[comp] = bAdd(eMean[comp]!, bScale(moments.mean, share));
            pixelVariance = [Math.max(pixelVariance[0], moments.variance[0]), Math.max(pixelVariance[1], moments.variance[1])];
          }
          const an: B[] = [];
          for (let c = 0; c < 3; c++) { an[c] = bMul(bMul(hs[0]!, bRounded(M[c]!)), bs[c]!); an[3 + c] = bMul(bMul(hs[1]!, bRounded(M[3 + c]!)), bs[c]!); an[6 + c] = bMul(bMul(hs[2]!, bRounded(M[6 + c]!)), bs[c]!); }
          for (let c = 0; c < 3; c++) {
            const wgt = bMul(bMul(bScale(aj, share), bRounded(bOf[c]!)), csv[c]!);
            cov[0] = bAdd(cov[0]!, bMul(bMul(wgt, an[c]!), an[c]!)); cov[1] = bAdd(cov[1]!, bMul(bMul(wgt, an[c]!), an[3 + c]!)); cov[2] = bAdd(cov[2]!, bMul(bMul(wgt, an[c]!), an[6 + c]!));
            cov[3] = bAdd(cov[3]!, bMul(bMul(wgt, an[3 + c]!), an[3 + c]!)); cov[4] = bAdd(cov[4]!, bMul(bMul(wgt, an[3 + c]!), an[6 + c]!)); cov[5] = bAdd(cov[5]!, bMul(bMul(wgt, an[6 + c]!), an[6 + c]!));
          }
          const cIndex = [[0, 1, 2], [1, 3, 4], [2, 4, 5]];
          for (let comp = 0; comp < 3; comp++) {
            let l: B = Z;
            for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) l = bAdd(l, bMul(bMul(an[comp * 3 + p]!, an[comp * 3 + q]!), C[cIndex[p]![q]!]!));
            const t: B = [f(share * Math.max(0, f(hv[comp]![0] - l[0]))), f(share * f(hv[comp]![1] + l[1]))];
            res[comp] = bAdd(res[comp]!, bMul(bMul(aj, aj), t));
          }
        }
        if (count === 2) for (let comp = 0; comp < 3; comp++) {
          const diff = Math.abs(f(hCand[comp]![0] - hCand[3 + comp]![0])), both = f(hCand[comp]![1] + hCand[3 + comp]![1]);
          choice[comp] = f(choice[comp]! + f(f(aj[0] * 0.5) * diff));
          eMean[comp] = [eMean[comp]![0], f(eMean[comp]![1] + f(0.5 * f(diff + both)))];
        }
        for (let comp = 0; comp < 3; comp++) s[comp] = bAdd(s[comp]!, bMul(aj, eMean[comp]!));
        if (count === 2) {
          let x0: B = Z, x1: B = Z, x2: B = Z;
          for (let n = 0; n < entries; n++) {
            const eb = cb + 4 + n * CF, o = siteAt(x + aux[eb]!, y + aux[eb + 1]!);
            const d0 = bScale(bs[0]!, f(aux[eb + 2]! - aux[eb + 5]!)), d1 = bScale(bs[1]!, f(aux[eb + 3]! - aux[eb + 6]!)), d2 = bScale(bs[2]!, f(aux[eb + 4]! - aux[eb + 7]!)), sv: B = [sites[o + 1]!, sites[o + 4]!];
            const a = bMul(hs[0]!, bAdd(bAdd(bMul(bRounded(M[0]!), d0), bMul(bRounded(M[1]!), d1)), bMul(bRounded(M[2]!), d2)));
            const b = bMul(hs[1]!, bAdd(bAdd(bMul(bRounded(M[3]!), d0), bMul(bRounded(M[4]!), d1)), bMul(bRounded(M[5]!), d2)));
            const c = bMul(hs[2]!, bAdd(bAdd(bMul(bRounded(M[6]!), d0), bMul(bRounded(M[7]!), d1)), bMul(bRounded(M[8]!), d2)));
            x0 = bAdd(x0, bMul(bMul(a, a), sv)); x1 = bAdd(x1, bMul(bMul(b, b), sv)); x2 = bAdd(x2, bMul(bMul(c, c), sv));
          }
          const ajaj = bMul(aj, aj);
          res[0] = bAdd(res[0]!, bMul(ajaj, bScale(x0, 0.25))); res[1] = bAdd(res[1]!, bMul(ajaj, bScale(x1, 0.25))); res[2] = bAdd(res[2]!, bMul(ajaj, bScale(x2, 0.25)));
        }
        if (P.correction === 1) {
          if (Math.abs(f(pixelVariance[0] - P.threshold!)) <= pixelVariance[1]) pixelFlags |= DISPLAY_VIEW_QUALITY_FLAG.thresholdTie;
          if (pixelVariance[0] > P.threshold!) {
            const corr = flatCorrection(cmAverage);
            for (let comp = 0; comp < 3; comp++) s[comp] = bAdd(s[comp]!, bMul(aj, corr[comp]!));
            pixelFlags |= DISPLAY_VIEW_QUALITY_FLAG.corrected;
          }
        }
      }
    }
    const sigmaOf = (v: number): number => f(CHOICE_SIGMA * f(Math.sqrt(Math.max(v, 0))));
    if (choice[0]! > sigmaOf(f(cov[0]![0] + res[0]![0])) || choice[1]! > sigmaOf(f(cov[3]![0] + res[1]![0])) || choice[2]! > sigmaOf(f(cov[5]![0] + res[2]![0]))) pixelFlags |= DISPLAY_VIEW_QUALITY_FLAG.ahdChoice;
    const o = i * DISPLAY_VIEW_QUALITY_OUTPUT_FLOATS;
    out[o] = s[0]![0]; out[o + 1] = s[1]![0]; out[o + 2] = s[2]![0];
    out[o + 3] = f(cov[0]![0] + res[0]![0]); out[o + 4] = f(cov[3]![0] + res[1]![0]); out[o + 5] = f(cov[5]![0] + res[2]![0]);
    out[o + 6] = cov[1]![0]; out[o + 7] = cov[2]![0]; out[o + 8] = cov[4]![0];
    out[o + 9] = Math.max(s[0]![1], s[1]![1], s[2]![1]);
    out[o + 10] = Math.max(f(cov[0]![1] + res[0]![1]), f(cov[3]![1] + res[1]![1]), f(cov[5]![1] + res[2]![1]), cov[1]![1], cov[2]![1], cov[4]![1]);
    flags[3 * i] = (pixelFlags | (undecided ? DISPLAY_VIEW_QUALITY_FLAG.highlightUndecided : 0)) >>> 0; flags[3 * i + 1] = mask0; flags[3 * i + 2] = mask1;
  }
}
