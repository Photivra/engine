// SPDX-License-Identifier: Apache-2.0
/**
 * Float32 JavaScript emulations of the sensor-stage, temporal-sum and chart-radiance WGSL kernels, for the
 * in-process fake WebGPU device. They mirror the WGSL line by line; real-device conformance lives in
 * test/webgpu.
 *
 * The sensor and chart emulations run on an `EmulationArithmetic`. `nearestArithmetic` rounds every
 * operation to nearest (Math.fround) with correctly rounded transcendentals. `adversarialArithmetic` models
 * what the WGSL accuracy table permits (W3C WGSL, "Floating Point Accuracy" and "Reassociation and
 * Fusion") in the least favourable way the model can express: every + − × and integer conversion rounds to
 * a randomly chosen neighbour of the exact result (WGSL fixes no rounding direction), `/` is off by up to
 * 2.5 ULP, `sqrt` by up to 4.5 ULP, `log` by up to 3 ULP (2^-21 absolute on [0.5, 2]), `exp` by up to
 * (3 + 2|x|) ULP, and multi-term sums are added in a random order (reassociation). The sensor and chart
 * tests show that no unflagged site or point changes under it.
 */
import { SENSOR_AUX, SENSOR_EXTRAS, SENSOR_NORMAL_ERROR, SENSOR_PIECE_WORDS, SENSOR_REALIZED_CLAMP, uniformThresholdInteger } from "../../src/gpu/wgsl-sensor-kernel.js";

const f = Math.fround;
const E = 2 ** -23, INV32 = f(2 ** -32), TWO_PI_INV32 = f(2 * Math.PI / 2 ** 32), MARGIN = 2, CPU_REL = f(2 ** -47), LOG_ABS = 2 ** -21, Z_ERR = SENSOR_NORMAL_ERROR;
const M07 = uniformThresholdInteger(0.07), M013 = uniformThresholdInteger(0.013);
const SIN = [-1 / 6, 1 / 120, -1 / 5040, 1 / 362880, -1 / 39916800].map(f), COS = [-1 / 2, 1 / 24, -1 / 720, 1 / 40320, -1 / 3628800, 1 / 479001600].map(f);

/** The float32 operations the kernels use, as the emulation evaluates them. */
export interface EmulationArithmetic {
  add(a: number, b: number): number;
  sub(a: number, b: number): number;
  mul(a: number, b: number): number;
  div(a: number, b: number): number;
  sqrt(x: number): number;
  log(x: number): number;
  exp(x: number): number;
  /** u32 → f32 (or i32 → f32) conversion. */
  convert(n: number): number;
  /** The sum of several float32 terms, each addition rounded; the kernel's left-to-right order unless reassociated. */
  sum(terms: readonly number[]): number;
  /** Whether a reassociated variant of a split expression is taken this time (adversarial mode only). */
  reassociate(): boolean;
}

/** Round to nearest after every operation; correctly rounded transcendentals (the kernel on an exact device). */
export const nearestArithmetic: EmulationArithmetic = {
  add: (a, b) => f(a + b), sub: (a, b) => f(a - b), mul: (a, b) => f(a * b), div: (a, b) => f(a / b),
  sqrt: x => f(Math.sqrt(x)), log: x => f(Math.log(x)), exp: x => f(Math.exp(x)), convert: n => f(n),
  sum: terms => terms.reduce((s, t) => f(s + t), 0), reassociate: () => false
};

const bitsView = new Float32Array(1), intView = new Int32Array(bitsView.buffer);
/** The float32 `n` ULPs away from `x` (toward ±∞ for positive n, toward zero for negative n), for finite normal x. */
export function moveUlps(x: number, n: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  bitsView[0] = x;
  intView[0] = intView[0]! + (x > 0 ? n : -n);
  return bitsView[0]!;
}
/** The float32 neighbours of an exact (float64) value: the nearest and the one on the other side (equal when exact). */
function neighbours(exact: number): [number, number] {
  const nearest = f(exact);
  if (nearest === exact || !Number.isFinite(nearest)) return [nearest, nearest];
  bitsView[0] = nearest;
  // Step one ULP toward the exact value's side.
  intView[0] = intView[0]! + ((exact > nearest) === (nearest > 0) ? 1 : -1);
  return [nearest, bitsView[0]!];
}

/**
 * The adversarial arithmetic (see the module notes). Deterministic for a seed; `extreme` is the share of
 * operations that take the largest allowed error instead of a uniformly drawn one.
 */
export function adversarialArithmetic(seed: number, extreme = 0.5): EmulationArithmetic {
  let s = seed >>> 0 || 1;
  const random = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
  const directed = (exact: number): number => { const [a, b] = neighbours(exact); return random() < 0.5 ? a : b; };
  // Up to `ulps` ULPs beyond correct rounding (the correctly rounded value is already within 0.5 ULP), either direction.
  const perturb = (nearest: number, ulps: number): number => {
    const magnitude = random() < extreme ? ulps : Math.floor(random() * (ulps + 1));
    return moveUlps(nearest, random() < 0.5 ? magnitude : -magnitude);
  };
  return {
    add: (a, b) => directed(a + b), sub: (a, b) => directed(a - b), mul: (a, b) => directed(a * b),
    div: (a, b) => perturb(f(a / b), 2),
    sqrt: x => perturb(f(Math.sqrt(x)), 4),
    log: (x): number => {
      const nearest = f(Math.log(x));
      if (x >= 0.5 && x <= 2) {
        // Absolute 2^-21: nearest plus a random absolute offset that keeps the total below the bound.
        const room = LOG_ABS - Math.abs(nearest - Math.log(x));
        return f(nearest + (random() < 0.5 ? 1 : -1) * 0.9 * room * (random() < extreme ? 1 : random()));
      }
      return perturb(nearest, 2);
    },
    exp: x => perturb(f(Math.exp(x)), 2 + 2 * Math.floor(Math.abs(x))),
    convert: n => directed(n),
    sum: (terms): number => {
      const order = terms.slice();
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
      return order.reduce((acc, t) => directed(acc + t), 0);
    },
    reassociate: () => random() < 0.5
  };
}

function fmix(value: number): number {
  let h = value >>> 0;
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 0x85ebca6b) >>> 0; h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  return h;
}
function mixBlock(hash: number, block: number): number {
  let k = Math.imul(block, 0xcc9e2d51) >>> 0;
  k = ((k << 15) | (k >>> 17)) >>> 0;
  k = Math.imul(k, 0x1b873593) >>> 0;
  let h = (hash ^ k) >>> 0;
  h = ((h << 13) | (h >>> 19)) >>> 0;
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}

export function emulateSensor(u32: Uint32Array, i32: Int32Array, pf: Float32Array, means: Uint32Array, meanFloats: Float32Array, aux: Float32Array, out: Uint32Array,
  A: EmulationArithmetic = nearestArithmetic): void {
  const [count, row0, regionW, nativeW, regionX, regionY, seed, components, knots, digital, saturation, adcMax, capacityFloor, thresholdFloor, black] =
    Array.from(u32.subarray(0, 15)) as number[];
  const satQuantized = i32[15]!;
  const [capacityFrac, thresholdFrac, invGain, invResidual, digitalGain, digitalResidual, inlSlope, inlOffsetMax] = Array.from(pf.subarray(16, 24)) as number[];
  const [siteWords, poissonCount, extras] = Array.from(u32.subarray(24, 27)) as number[];
  const fpnESlackParam = pf[28]!, fpnCSlackParam = pf[29]!, inlKnot = pf[30]!, meanInts = new Int32Array(means.buffer, means.byteOffset, means.length);
  const CLAMP = SENSOR_REALIZED_CLAMP;
  const { add, sub, mul, div, convert } = A;
  let state = 0, radius = 0, ip = 0, uncertain!: boolean;
  // The fraction accumulator is kept as a list of terms so that the sum can be taken in any order.
  let fpTerms: number[] = [];
  const start = (s: number): void => { state = fmix((s ^ 0x9e3779b9) >>> 0); if (state === 0) state = 0x6d2b79f5; };
  const next = (): number => { state = (state ^ (state << 13)) >>> 0; state = (state ^ (state >>> 17)) >>> 0; state = (state ^ (state << 5)) >>> 0; return state; };
  const unit = (bits: number): number => f(add(convert(bits), .5) * INV32);
  const check = (distance: number, margin: number): void => { if (Math.abs(distance) <= margin) uncertain = true; };
  const lnUnit = (bits: number): number => {
    if (bits < 0x80000000) return A.log(unit(bits));
    const w = f(add(convert(0xffffffff - bits), .5) * INV32), r = div(-w, sub(2, w)), r2 = mul(r, r);
    let p = f(1 / 23);
    for (const n of [21, 19, 17, 15, 13, 11, 9, 7, 5, 3]) p = add(mul(p, r2), f(1 / n));
    p = add(mul(p, r2), 1);
    return mul(f(2 * r), p);
  };
  const cosUnit = (bits: number): number => {
    const octant = bits >>> 29, low = bits & 0x1fffffff, even = (octant & 1) === 0;
    const g = even ? mul(add(convert(low), .5), TWO_PI_INV32) : mul(add(convert(0x1fffffff - low), .5), TWO_PI_INV32), g2 = mul(g, g);
    let c = COS[5]!;
    for (const j of [4, 3, 2, 1, 0]) c = add(mul(c, g2), COS[j]!);
    c = add(mul(c, g2), 1);
    let s = SIN[4]!;
    for (const j of [3, 2, 1, 0]) s = add(mul(s, g2), SIN[j]!);
    s = mul(g, add(mul(s, g2), 1));
    const cb = even ? c : s, sb = even ? s : c, q = octant >>> 1;
    return q === 0 ? cb : q === 1 ? -sb : q === 2 ? -cb : sb;
  };
  const stdNormal = (): number => { const b1 = next(), b2 = next(); radius = A.sqrt(f(-2 * lnUnit(b1))); return mul(radius, cosUnit(b2)); };
  const poissonSmall = (mean: number): number => {
    const threshold = A.exp(-mean);
    let product = 1, n = 0;
    for (;;) {
      n++;
      product = mul(product, unit(next()));
      check(sub(product, threshold), MARGIN * (3 * n + 4 + 3 * mean) * E * Math.max(product, threshold));
      if (!(product > threshold)) break;
      if (n >= 1000) { uncertain = true; break; }
    }
    return n - 1;
  };
  const log1pMinus = (t: number): number => {
    const d = add(2, t), s = div(t, d), s2 = mul(s, s);
    let p = f(1 / 25);
    for (const n of [23, 21, 19, 17, 15, 13, 11, 9, 7, 5]) p = add(mul(p, s2), f(1 / n));
    p = add(mul(p, s2), f(1 / 3));
    return add(div(-mul(t, t), d), mul(mul(f(2 * s), s2), p));
  };
  const ptrs = (mi: number, mf: number): number => {
    const mean = add(convert(mi), mf), sq = A.sqrt(mean), b = add(f(.931), mul(f(2.53), sq)), a = add(f(-.059), mul(f(.02483), b));
    const invAlpha = add(f(1.1239), div(f(1.1328), sub(b, f(3.4)))), vR = sub(f(.9277), div(f(3.6224), sub(b, 2))), lnMean = A.log(mean);
    for (let iteration = 0; iteration < 64; iteration++) {
      const su = next(), sv = next();
      let m = su, sign = -1;
      if (su >= 0x80000000) { m = 0xffffffff - su; sign = 1; }
      const us = unit(m), u = f(sign * unit(0x7fffffff - m)), v = unit(sv);
      const scale = add(div(f(2 * a), us), b), t = mul(scale, u), x = A.sum([t, mf, f(.43)]), fl = Math.floor(x);
      const ex = MARGIN * (25 * E * Math.abs(t) + 4 * E + f(4.5e-16) * (Math.abs(t) + mean + 1));
      if (sub(x, fl) <= ex || sub(add(fl, 1), x) <= ex) uncertain = true;
      if (fl <= -1073741824 || fl >= 1073741824) continue;
      const k = mi + fl;
      if (m >= M07) {
        if (k >= 0) check(sub(v, vR), MARGIN * (7 * E + 2 * E * v));
        if (v <= vR && k >= 0) return k;
      }
      if (k < 0 || (m < M013 && sv > m)) continue;
      const lhs = A.log(div(mul(v, invAlpha), add(div(a, mul(us, us)), b)));
      const dl = 32 * E + LOG_ABS + 3 * E * Math.abs(lhs);
      let rhs: number, dr: number;
      if (k === 0) { rhs = -mean; dr = 3 * E * mean + CPU_REL * mean; } else {
        const kf = convert(k), dd = add(convert(mi - k), mf), t2 = div(dd, kf);
        let kg: number, dk: number;
        if (Math.abs(t2) <= .5) { kg = mul(kf, log1pMinus(t2)); dk = 25 * E * Math.abs(kg) + E; } else {
          const lr = A.log(div(mean, kf));
          kg = sub(mul(kf, lr), dd);
          dk = kf * (6 * E + LOG_ABS + 5 * E * Math.abs(lr)) + 2 * E * Math.abs(dd) + E + E * Math.abs(kg);
        }
        const lnk = A.log(kf);
        const corr = k < 256 ? aux[k]! : sub(div(1, mul(12, kf)), div(1, mul(mul(mul(360, kf), kf), kf)));
        rhs = sub(sub(sub(kg, mul(.5, lnk)), f(0.5 * Math.log(2 * Math.PI))), corr);
        dr = dk + 0.5 * LOG_ABS + 1.5 * E * lnk + 2 * E + 3 * E * (Math.abs(kg) + .5 * lnk + 1) + CPU_REL * (mean + kf * (Math.abs(lnMean) + lnk + 1));
      }
      check(sub(lhs, rhs), MARGIN * (dl + dr));
      if (lhs <= rhs) return k;
    }
    uncertain = true;
    return mi;
  };
  const poisson = (word: number, frac: number): number => {
    const category = word >>> 30, mi = word & 0x3fffffff;
    if (category === 0) return 0;
    if (category === 1) return poissonSmall(add(convert(mi), frac));
    if (category === 2) return ptrs(mi, frac);
    const z = stdNormal(), y = add(add(mul(A.sqrt(add(convert(mi), frac)), z), frac), .5);
    return Math.max(0, mi + Math.floor(y));
  };
  // Integer-arithmetic split of product·2^s (product < 2^24): the kernel's add_scaled.
  const addScaled = (product: number, s: number, scale: number): void => {
    if (product === 0) return;
    if (s >= 0) { ip += product * 2 ** s; return; }
    if (s <= -24) { fpTerms.push(f(product * scale)); return; }
    ip += Math.floor(product / 2 ** -s);
    fpTerms.push(f((product % 2 ** -s) * scale));
  };
  const scaled = (n: number, base: number): void => {
    const hi = n >>> 12, lo = n & 0xfff;
    for (let j = 0; j < 4; j++) {
      const m = aux[base + SENSOR_PIECE_WORDS * j]!, s = aux[base + SENSOR_PIECE_WORDS * j + 1]!, scale = aux[base + SENSOR_PIECE_WORDS * j + 2]!;
      addScaled(hi * m, s + 12, f(scale * 4096)); addScaled(lo * m, s, scale);
    }
  };
  // The fraction sum, then its normalization (floor split); returns the fraction.
  const settle = (): number => { const total = A.sum(fpTerms); const fl = Math.floor(total); ip += fl; fpTerms = []; return sub(total, fl); };
  const inlOffset = (code: number): number => {
    const base = SENSOR_AUX.knots, n = knots!;
    if (code <= aux[base]!) return aux[base + n]!;
    if (code >= aux[base + n - 1]!) return aux[base + 2 * n - 1]!;
    let low = 0, high = n - 1;
    while (high - low > 1) { const middle = (low + high) >>> 1; if (aux[base + middle]! <= code) low = middle; else high = middle; }
    return add(aux[base + n + low]!, mul(sub(code, aux[base + low]!), aux[base + 2 * n + low]!));
  };
  for (let i = 0; i < count!; i++) {
    const row = row0! + Math.floor(i / regionW!), index = ((regionY! + row) * nativeW! + regionX! + i % regionW!) >>> 0;
    uncertain = false;
    start(fmix((mixBlock(mixBlock(mixBlock(0, seed!), index), 0) ^ 12) >>> 0));
    const base = i * siteWords!;
    const photo = poisson(means[base]!, meanFloats[base + 1]!), dark = poisson(means[base + 2]!, meanFloats[base + 3]!);
    let realized = Math.min(photo + dark, CLAMP);
    for (let k = 0; k < poissonCount!; k++) realized = Math.min(realized + poisson(means[base + 4 + 2 * k]!, meanFloats[base + 5 + 2 * k]!), CLAMP);
    let cursor = base + 4 + 2 * poissonCount!;
    const deterministic = (extras! & SENSOR_EXTRAS.deterministic) !== 0, pattern = (extras! & SENSOR_EXTRAS.fixedPattern) !== 0;
    let rFrac = 0, detSlack = 0;
    if (deterministic) { realized = Math.min(realized + means[cursor]!, CLAMP); rFrac = meanFloats[cursor + 1]!; detSlack = E; cursor += 2; }
    let tFloor = thresholdFloor!, tFrac = thresholdFrac!, fpnESlack = 0;
    if (pattern) { tFloor = meanInts[cursor]!; tFrac = meanFloats[cursor + 1]!; fpnESlack = fpnESlackParam; }
    start(fmix((mixBlock(mixBlock(mixBlock(0, seed!), index), 1) ^ 12) >>> 0));
    const noiseTerms: number[] = [];
    let noiseBound = 0;
    for (let c = 0; c < components!; c++) {
      const sigma = aux[SENSOR_AUX.sigma + c]!;
      if (sigma !== 0) { const z = stdNormal(); noiseTerms.push(mul(z, sigma)); noiseBound = noiseBound + sigma * radius * (Z_ERR + 2 + components!) * E; }
    }
    const noise = A.sum(noiseTerms);
    let flags = 0, aInt = realized, aFrac = rFrac;
    if (!deterministic) {
      if (realized > capacityFloor!) { flags = 1; aInt = capacityFloor!; aFrac = capacityFrac!; }
    } else {
      const w = convert(realized - capacityFloor!), dcap = A.reassociate() ? A.sum([w, rFrac, -capacityFrac!]) : add(w, sub(rFrac, capacityFrac!));
      check(dcap, MARGIN * (3 * E * Math.abs(w) + 6 * E + CPU_REL * (realized + 1)));
      if (dcap > 0) { flags = 1; aInt = capacityFloor!; aFrac = capacityFrac!; }
    }
    const whole = convert(aInt - tFloor), diff = A.reassociate() ? A.sum([whole, aFrac, -tFrac, noise]) : add(add(whole, sub(aFrac, tFrac)), noise);
    check(diff, MARGIN * (noiseBound + 4 * E * Math.abs(whole) + 3 * E * Math.abs(noise) + 8 * E + CPU_REL * (aInt + Math.abs(noise)) + fpnESlack + detSlack));
    let q: number;
    if (diff > 0) { flags |= 2; q = satQuantized; } else {
      ip = black!; fpTerms = [];
      let fpnCSlack = 0;
      if (pattern) { ip += meanInts[cursor + 2]!; fpTerms.push(meanFloats[cursor + 3]!); fpnCSlack = fpnCSlackParam; }
      scaled(aInt, SENSOR_AUX.inversePieces);
      const noiseCodes = mul(noise, invGain!), fracCodes = mul(aFrac, invGain!);
      fpTerms.push(fracCodes, noiseCodes);
      const aCodes = mul(convert(aInt), invGain!);
      let margin = MARGIN * (13 * E * (13 + fracCodes + Math.abs(noiseCodes)) + 3 * E * fracCodes + 2 * E * Math.abs(noiseCodes) + noiseBound * invGain! +
        aInt * invResidual! + CPU_REL * (aCodes + Math.abs(noiseCodes) + black!) + fpnCSlack + detSlack * invGain!);
      let fp: number;
      if (knots! > 0) {
        if (A.reassociate()) {
          // (S − floor S) + offset reassociated as (S + offset) − floor S: the offset is evaluated at the same ideal.
          const total = A.sum(fpTerms), fl = Math.floor(total), ideal = add(convert(ip + fl), sub(total, fl)), offset = inlOffset(ideal);
          ip += fl; fpTerms = [];
          fp = sub(add(total, offset), fl);
          margin = margin * (1 + inlSlope!) + MARGIN * (inlSlope! * 2 * E * (Math.abs(ideal) + 1 + inlKnot) + 11 * E * (inlOffsetMax! + 1) +
            CPU_REL * (Math.abs(ideal) + inlOffsetMax!) * (1 + inlSlope!));
        } else {
          fp = settle();
          const ideal = add(convert(ip), fp), offset = inlOffset(ideal);
          fp = add(fp, offset);
          margin = margin * (1 + inlSlope!) + MARGIN * (inlSlope! * 2 * E * (Math.abs(ideal) + 1 + inlKnot) + 11 * E * (inlOffsetMax! + 1) +
            CPU_REL * (Math.abs(ideal) + inlOffsetMax!) * (1 + inlSlope!));
        }
        const fl = Math.floor(fp); ip += fl; fp = sub(fp, fl);
      } else fp = settle();
      if ((digital! & 4) === 0) check(sub(fp, .5), margin);
      q = ip + (fp >= .5 ? 1 : 0);
    }
    if ((digital! & 1) !== 0) {
      const adc = Math.min(Math.max(q, 0), adcMax!), delta = adc - black!, estimate = mul(convert(delta), digitalGain!);
      if (estimate >= 16777216) q = 16777216;
      else if (estimate <= -16777216) q = -16777216;
      else {
        ip = 0; fpTerms = [];
        scaled(Math.abs(delta), SENSOR_AUX.digitalPieces);
        const total = A.sum(fpTerms), fl = Math.floor(total);
        if ((digital! & 2) === 0) check(sub(sub(total, fl), .5), MARGIN * (90 * E + Math.abs(delta) * digitalResidual! + CPU_REL * (Math.abs(estimate) + black!)));
        ip += fl; fpTerms = [];
        const fp = sub(total, fl);
        let wholePart = ip, fraction = fp;
        if (delta < 0) { wholePart = -ip; if (fp > 0) { wholePart = -ip - 1; fraction = sub(1, fp); } }
        q = wholePart + black! + (fraction >= .5 ? 1 : 0);
      }
    }
    if (q >= saturation!) flags |= 4;
    if (q < 0) flags |= 8;
    out[i] = (Math.min(Math.max(q, 0), saturation!) | (flags << 16) | (uncertain ? 1 << 20 : 0)) >>> 0;
  }
}

export function emulateTemporalSum(p: Uint32Array, source: Float32Array, nodeData: ArrayBuffer, weights: Float32Array, result: Float32Array): void {
  const [width, height, nodes, outRow0, outRows, inRow0] = Array.from(p.subarray(0, 6)) as number[];
  const ints = new Int32Array(nodeData), floats = new Float32Array(nodeData);
  const sample = (sx: number, sy: number): number => source[(sy - inRow0!) * width! + sx]!;
  for (let ly = 0; ly < outRows!; ly++) for (let x = 0; x < width!; x++) {
    const y = outRow0! + ly;
    let sum = 0;
    for (let k = 0; k < nodes!; k++) {
      const sx = x + ints[k * 8]!, sy = y + ints[k * 8 + 1]!, b = floats.subarray(k * 8 + 4, k * 8 + 8);
      const left = sx >= 0 && sx < width!, right = sx + 1 >= 0 && sx + 1 < width!, top = sy >= 0 && sy < height!, bottom = sy + 1 >= 0 && sy + 1 < height!;
      let inner = 0;
      if (top && left) inner = f(inner + f(b[0]! * sample(sx, sy)));
      if (top && right) inner = f(inner + f(b[1]! * sample(sx + 1, sy)));
      if (bottom && left) inner = f(inner + f(b[2]! * sample(sx, sy + 1)));
      if (bottom && right) inner = f(inner + f(b[3]! * sample(sx + 1, sy + 1)));
      sum = f(sum + f(weights[k * outRows! + ly]! * inner));
    }
    result[ly * width! + x] = sum;
  }
}

/** A float32 emulation of the chart kernel's material classification (`material()` of wgsl-chart-kernel.ts) with its `flagged` state. */
export interface ChartMaterialEmulator { material(u: number, v: number): number; readonly flagged: boolean; reset(): void; /** #581: a module's own `scene_value`. */ value?(u: number, v: number, c: number): number }
/**
 * Mirrors `material()` of CHART_RADIANCE_WGSL on an `EmulationArithmetic`, from the kernel's uniform words (preset and integer
 * constants), floats (f0–f4) and aux table. `safety` is the kernel's SAFETY factor (4 in the chart kernel; 8 in the display view's
 * material module, whose query points carry a second float32 rounding).
 */
export function createChartMaterialEmulator(p: Uint32Array, pf: Float32Array, aux: Float32Array, safety: number, A: EmulationArithmetic = nearestArithmetic): ChartMaterialEmulator {
  const [preset, na, nb, nc] = Array.from(p.subarray(2, 6)) as number[];
  const [f0, f1, f2, f3, f4] = Array.from(pf.subarray(8, 13)) as number[];
  const SAFETY = safety, SLACK = 1e-14;
  const { add, sub, mul } = A;
  let flagged = false;
  const check = (d: number, bound: number): void => { if (!(Math.abs(d) > SAFETY * bound)) flagged = true; };
  const checkInteger = (t: number, bound: number, lo: number, hi: number): void => {
    const n = Math.round(t);
    if (SAFETY * bound >= 0.5) { flagged = true; return; }
    if (n >= lo && n <= hi) check(sub(t, n), bound);
  };
  const ssb = (a: number, b: number, s: number, scale: number, x: number, cr: number): number =>
    E * ((Math.abs(a) + Math.abs(b) + Math.abs(s)) * Math.abs(scale) + (1 + cr) * Math.abs(x)) + SLACK * (Math.abs(x) + 1);
  const cross = (u: number, v: number, k: number): number => sub(mul(v, aux[2 * k]!), mul(u, aux[2 * k + 1]!));
  const crossBound = (u: number, v: number, k: number, d: number): number =>
    E * (3 * Math.abs(mul(v, aux[2 * k]!)) + 3 * Math.abs(mul(u, aux[2 * k + 1]!)) + Math.abs(d)) + SLACK * (Math.abs(u) + Math.abs(v));
  const material = (u: number, v: number): number => {
    switch (preset) {
      case 0: return 0;
      case 1: {
        const a = mul(u, f0!), b = mul(v, f1!), d = sub(a, b);
        check(d, E * (3 * Math.abs(a) + 3 * Math.abs(b) + Math.abs(d)) + SLACK * (Math.abs(u) + Math.abs(v)));
        return d >= 0 ? 1 : 0;
      }
      case 2: {
        const q = add(mul(u, u), mul(v, v));
        check(sub(q, f0!), E * (4 * q + 2 * f0!) + SLACK * (q + f0!));
        if (q > f0!) return 2;
        let low = v >= 0 ? na! : 0, high = low + na!;
        while (high - low > 1) { const middle = (low + high) >>> 1; if (cross(u, v, middle) >= 0) low = middle; else high = middle; }
        const k = low, lo = cross(u, v, k), hi = cross(u, v, k + 1);
        if (lo < 0 || hi >= 0) flagged = true;
        check(lo, crossBound(u, v, k, lo));
        check(hi, crossBound(u, v, k + 1, hi));
        return k % 2 === 0 ? 1 : 0;
      }
      case 3: case 4: {
        const s = add(u, 1), t = mul(s, f0!);
        checkInteger(t, ssb(u, 1, s, f0!, t, 0), 1, na! - 1);
        return Math.min(na! - 1, Math.max(0, Math.floor(t)));
      }
      case 5: {
        const s = add(u, 1), x = mul(s, f0!), w = sub(f1!, v), y = mul(w, f0!);
        checkInteger(x, ssb(u, 1, s, f0!, x, 0), -3e38, 3e38);
        checkInteger(y, ssb(f1!, v, w, f0!, y, 0), -3e38, 3e38);
        return (Math.floor(x) + Math.floor(y)) % 2 === 0 ? 1 : 0;
      }
      case 6: {
        const s = add(u, 1), x = mul(s, f0!), w = sub(f1!, v), y = mul(w, f2!);
        checkInteger(x, ssb(u, 1, s, f0!, x, 0), 1, na! - 1);
        checkInteger(y, ssb(f1!, v, w, f2!, y, 1), 1, nb! - 1);
        const i = Math.min(na! - 1, Math.max(0, Math.floor(x))), j = Math.min(nb! - 1, Math.max(0, Math.floor(y))), c = j * na! + i;
        const dx = sub(u, aux[2 * c]!), dy = sub(v, aux[2 * c + 1]!);
        const ex = E * (Math.abs(u) + Math.abs(aux[2 * c]!) + Math.abs(dx)), ey = E * (Math.abs(v) + Math.abs(aux[2 * c + 1]!) + Math.abs(dy));
        const d2 = add(mul(dx, dx), mul(dy, dy));
        check(sub(d2, f3!), 2 * (Math.abs(dx) * ex + Math.abs(dy) * ey) + ex * ex + ey * ey + E * (2 * d2 + f3!) + SLACK * (d2 + f3!));
        return d2 <= f3! ? 1 : 0;
      }
      default: {
        const s = add(u, 1), fx = mul(s, f0!), w = sub(f1!, v), fy = mul(w, f2!);
        const bx = ssb(u, 1, s, f0!, fx, 0), by = ssb(f1!, v, w, f2!, fy, 1);
        checkInteger(fx, bx, -3e38, 3e38);
        checkInteger(fy, by, -3e38, 3e38);
        const ifx = Math.floor(fx), ify = Math.floor(fy);
        if (ifx < 0 || ify < 0 || ifx >= na! || ify >= nb!) return nc!;
        const index = ify * na! + ifx, x = sub(fx, ifx), y = sub(fy, ify);
        check(sub(x, f3!), bx + E * f3!); check(sub(x, f4!), bx + E * f4!); check(sub(y, f3!), by + E * f3!); check(sub(y, f4!), by + E * f4!);
        if (index >= nc! || x < f3! || x > f4! || y < f3! || y > f4!) return nc!;
        return index;
      }
    }
  };
  return { material, get flagged(): boolean { return flagged; }, reset(): void { flagged = false; } };
}

/** Mirrors CHART_RADIANCE_WGSL (wgsl-chart-kernel.ts) in float32. */
export function emulateChart(p: Uint32Array, pf: Float32Array, points: Float32Array, table: Float32Array, aux: Float32Array, selectors: Uint32Array,
  values: Float32Array, flags: Uint32Array, A: EmulationArithmetic = nearestArithmetic): void {
  const [count, columns, , , , , wavelengthMode] = Array.from(p.subarray(0, 7)) as number[];
  const emulator = createChartMaterialEmulator(p, pf, aux, 4, A);
  for (let i = 0; i < count!; i++) {
    emulator.reset();
    const m = emulator.material(points[2 * i]!, points[2 * i + 1]!);
    if (wavelengthMode !== 0) values[i] = table[m * columns! + selectors[i]!]!;
    else for (let c = 0; c < columns!; c++) values[i * columns! + c] = table[m * columns! + c]!;
    flags[i] = emulator.flagged ? 1 : 0;
  }
}
