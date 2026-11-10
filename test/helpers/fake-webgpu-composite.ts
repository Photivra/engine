// SPDX-License-Identifier: Apache-2.0
/**
 * Float32 JavaScript emulation of the composite chart kernel (src/gpu/wgsl-chart-composite-kernel.ts), its double-float32 probe and
 * the display view's composite material module, for the fake WebGPU device. A line-by-line port: the same bound arithmetic, the
 * same decisions, the same flags, for both product paths (Dekker's and the fma one).
 *
 * Every float32 operation runs on a `CompositeArithmetic` (2.11.0, the M5 Pro finding):
 * - `nearest` (the default): every + − × rounds to nearest, in the written order, unfused; `fma` is fused (one rounding).
 * - `fused-contraction`: what WGSL permits under "Reassociation and Fusion" ("an implementation may fuse operations if the
 *   transformed expression is at least as accurate"), as a compiler does it after inlining: a multiplication whose rounded
 *   result is an operand of an addition or a subtraction (through `let` bindings and function calls, that is in the dataflow) may
 *   be evaluated together with it as one fused multiply-add, rounded once. A multiplication stays symbolic (`Prod`) until a
 *   consumer rounds it: an addition or subtraction fuses it (per the policy: the first product operand, the second, or a seeded
 *   random choice per site, including not fusing); every other consumer (abs, a comparison, a division, round, floor, a store)
 *   takes the rounded product. `fma` is fused, or, with `fma: "unfused"`, an ordinary multiply and add (WGSL allows both, § fma).
 * - `reassociation`: the algebraic simplification a fast-math compiler applies to the error-free transforms ((a + b) − a to b,
 *   t − (t − a) to a), so TwoSum, Fast2Sum and Veltkamp's split lose their low parts; everything else rounds to nearest.
 */
import { DIGIT_SEGMENTS, NUMERAL_ADVANCE, SEGMENTS } from "../../src/facade/chart-scenes.js";
import { dwAdd, dwMul, dwMulFma, dwSub, fmaF32, probeExpectation, quickTwoSum as quickTwoSumF32, twoProd, twoProdFma as twoProdFmaF32, twoSum as twoSumF32,
  type Dw } from "../../src/gpu/chart-composite-gpu.js";
import { CHART_RECORD_STRIDE, type ChartCompositeProductPath } from "../../src/gpu/wgsl-chart-composite-kernel.js";
import { DISPLAY_VIEW_LATTICE } from "../../src/gpu/display-view-composite-material-module.js";

const f = Math.fround;
const E = f(2 ** -23), DW = f(2 ** -40), TINY = f(2 ** -120), SAFETY = 4, SLACK = f(1e-14), PI = f(3.14159265358979), HALF_PI = f(1.5707963267948966), QUARTER_PI = f(0.7853981633974483);
const SEGMENT_ORDER = "abcdefg";
const SEGMENT_BOX = SEGMENT_ORDER.split("").map((s) => SEGMENTS[s]!.map((x) => f(Number(x.toFixed(2)))) as [number, number, number, number]);
const DIGIT_MASK = DIGIT_SEGMENTS.map((segments) => segments.split("").reduce((mask, s) => mask | (1 << SEGMENT_ORDER.indexOf(s)), 0));

/** How the emulated device evaluates the composite kernel's float32 arithmetic (see the module notes). */
export type CompositeArithmetic =
  | { kind: "nearest" }
  | { kind: "fused-contraction"; choose?: "first" | "second" | { seed: number }; fma?: "fused" | "unfused" }
  | { kind: "reassociation" };
export const NEAREST_COMPOSITE_ARITHMETIC: CompositeArithmetic = Object.freeze({ kind: "nearest" });

/** A product not yet rounded: what a fusing compiler can still add to with one rounding. */
class Prod { constructor(readonly a: number, readonly b: number) {} }
type V = number | Prod;
interface Ops {
  mul(a: number, b: number): V;
  add(x: V, y: V): number;
  sub(x: V, y: V): number;
  neg(x: V): V;
  /** The rounded value (a product rounds here). */
  v(x: V): number;
  fma(a: number, b: number, c: number): number;
  readonly reassociate: boolean;
  /** Round to nearest in the written order, no fusion, no rewriting (the `nearest` model). */
  readonly nearest: boolean;
}
const round = (x: V): number => (x instanceof Prod ? f(x.a * x.b) : x);

function opsOf(model: CompositeArithmetic): Ops {
  if (model.kind !== "fused-contraction") {
    // No operation here returns a `Prod`, so every V is a number: no rounding call per operand (each call costs under V8 coverage).
    return { mul: (a, b) => f(a * b), add: (x, y) => f((x as number) + (y as number)), sub: (x, y) => f((x as number) - (y as number)), neg: (x) => -(x as number),
      v: (x) => x as number, fma: fmaF32, reassociate: model.kind === "reassociation", nearest: model.kind === "nearest" };
  }
  const choose = model.choose ?? "first";
  let s = typeof choose === "object" ? (choose.seed >>> 0 || 1) : 1;
  const random = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
  /** 0: no fusion; 1: fuse the first operand's product; 2: the second's. */
  const pick = (x: V, y: V): 0 | 1 | 2 => {
    const px = x instanceof Prod, py = y instanceof Prod;
    if (!px && !py) return 0;
    if (choose === "first") return px ? 1 : 2;
    if (choose === "second") return py ? 2 : 1;
    const r = random();
    if (r < 1 / 3) return 0;
    if (px && py) return r < 2 / 3 ? 1 : 2;
    return px ? 1 : 2;
  };
  return {
    mul: (a, b) => new Prod(a, b),
    add: (x, y): number => { const p = pick(x, y); return p === 1 ? fmaF32((x as Prod).a, (x as Prod).b, round(y)) : p === 2 ? fmaF32((y as Prod).a, (y as Prod).b, round(x)) : f(round(x) + round(y)); },
    sub: (x, y): number => { const p = pick(x, y); return p === 1 ? fmaF32((x as Prod).a, (x as Prod).b, -round(y)) : p === 2 ? fmaF32(-(y as Prod).a, (y as Prod).b, round(x)) : f(round(x) - round(y)); },
    // A negated product folds into a fused multiply-add as one (fneg of fmul).
    neg: (x) => (x instanceof Prod ? new Prod(-x.a, x.b) : -x),
    v: round,
    fma: model.fma === "unfused" ? (a, b, c): number => f(f(a * b) + c) : fmaF32,
    reassociate: false,
    nearest: false
  };
}

/** A double word whose parts may still be unrounded products (Dekker's TwoProduct returns p = a·b). */
type DV = readonly [V, V];

/** The double-float32 building blocks of the kernel (COMMON_TEMPLATE) on an arithmetic. */
function doubleWord(K: Ops, path: ChartCompositeProductPath): {
  twoSum(a: V, b: V): Dw; quickTwoSum(a: V, b: V): Dw; twoProdDekker(a: number, b: number): DV; twoProdFma(a: number, b: number): DV;
  dMulDekker(a: Dw, b: Dw): Dw; dMulFma(a: Dw, b: Dw): Dw; dAdd(a: Dw, b: Dw): Dw; dSub(a: Dw, b: Dw): Dw; dMul(a: Dw, b: Dw): Dw } {
  // Round to nearest: the engine's float32 building blocks (src/gpu/chart-composite-gpu.ts), operation for operation the ones below
  // on that model, without a call per operation (see nearestBoundOps).
  if (K.nearest) {
    const n = (x: V): number => x as number;
    return { twoSum: (a, b) => twoSumF32(n(a), n(b)), quickTwoSum: (a, b) => quickTwoSumF32(n(a), n(b)), twoProdDekker: twoProd, twoProdFma: twoProdFmaF32,
      dMulDekker: dwMul, dMulFma: (a, b) => dwMulFma(a, b), dAdd: dwAdd, dSub: dwSub, dMul: path === "dekker" ? dwMul : (a, b): Dw => dwMulFma(a, b) };
  }
  const { add, sub, mul } = K;
  const twoSum = (a: V, b: V): Dw => {
    const s = add(a, b);
    if (K.reassociate) return [s, 0];
    const bb = sub(s, a);
    return [s, add(sub(a, sub(s, bb)), sub(b, bb))];
  };
  const quickTwoSum = (a: V, b: V): Dw => { const s = add(a, b); return K.reassociate ? [s, 0] : [s, sub(b, sub(s, a))]; };
  const split = (a: number): Dw => {
    if (K.reassociate) return [a, 0];
    const t = mul(4097, a), h = sub(t, sub(t, a));
    return [h, sub(a, h)];
  };
  const twoProdDekker = (a: number, b: number): DV => {
    const p = mul(a, b), sa = split(a), sb = split(b);
    return [p, add(add(add(sub(mul(sa[0], sb[0]), p), mul(sa[0], sb[1])), mul(sa[1], sb[0])), mul(sa[1], sb[1]))];
  };
  const twoProdFma = (a: number, b: number): DV => { const p = mul(a, b); return [p, K.fma(a, b, -K.v(p))]; };
  const dMulDekker = (a: Dw, b: Dw): Dw => {
    const p = twoProdDekker(a[0], b[0]), t = add(mul(a[0], b[1]), mul(a[1], b[0])), l = add(p[1], t);
    return quickTwoSum(p[0], l);
  };
  const dMulFma = (a: Dw, b: Dw): Dw => {
    const t = add(mul(a[0], b[1]), mul(a[1], b[0])), s = K.fma(a[0], b[0], t);
    return [s, add(K.fma(a[0], b[0], -s), t)];
  };
  const dAdd = (a: Dw, b: Dw): Dw => {
    const s = twoSum(a[0], b[0]), t = twoSum(a[1], b[1]), c = add(s[1], t[0]), v = quickTwoSum(s[0], c), w = add(v[1], t[1]);
    return quickTwoSum(v[0], w);
  };
  const dSub = (a: Dw, b: Dw): Dw => dAdd(a, [-b[0], -b[1]]);
  return { twoSum, quickTwoSum, twoProdDekker, twoProdFma, dMulDekker, dMulFma, dAdd, dSub, dMul: path === "dekker" ? dMulDekker : dMulFma };
}

let corruptProbe = false;
/** Makes the probe return zeros (a device that reassociates the double-float32 arithmetic) until turned off again. */
export function setCompositeProbeCorruption(corrupt: boolean): void { corruptProbe = corrupt; }

/** The product path of a composite kernel pipeline label, or null for another label. */
function pathOfLabel(label: string): ChartCompositeProductPath | null {
  return label === "photivra-chart-composite" ? "dekker" : label === "photivra-chart-composite-fma" ? "fma" : null;
}

/** Dispatches the composite kernel (either product path) or its probe by pipeline label; false for any other label. */
export function emulateComposite(label: string, data: (binding: number) => ArrayBuffer, model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): boolean {
  const u32 = (b: number): Uint32Array => new Uint32Array(data(b)), f32 = (b: number): Float32Array => new Float32Array(data(b));
  const path = pathOfLabel(label);
  if (path) { emulateCompositeChart(u32(0), f32(1), f32(2), f32(3), u32(4), u32(5), f32(6), u32(7), path, model); return true; }
  if (label === "photivra-chart-composite-probe") { emulateCompositeProbe(f32(0), f32(1), model); if (corruptProbe) f32(1).fill(0); return true; }
  return false;
}

/** The probe (CHART_COMPOSITE_PROBE_WGSL) on an arithmetic: eight floats per input. */
export function emulateCompositeProbe(input: Float32Array, output: Float32Array, model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): void {
  const K = opsOf(model), d = doubleWord(K, "dekker");
  for (let i = 0; i < input.length / 4; i++) {
    const [x, y, z, w] = [input[4 * i]!, input[4 * i + 1]!, input[4 * i + 2]!, input[4 * i + 3]!];
    const s = d.twoSum(x, y), m = d.twoProdDekker(x, y), a = d.dAdd([x, y], [z, w]), mf = d.twoProdFma(x, y);
    const q = d.dMulDekker([x, y], [z, w]), qf = d.dMulFma([x, y], [z, w]);
    output.set([s[1], K.v(m[1]), a[1], K.v(mf[1]), q[0], q[1], qf[0], qf[1]], 8 * i);
  }
}
/** The probe's output on an exact device (round to nearest, unfused, fused fma). */
export function exactProbeOutput(inputs: readonly (readonly [number, number, number, number])[]): Float32Array {
  return Float32Array.from(inputs.flatMap((row) => probeExpectation(row)));
}

export function emulateCompositeChart(p: Uint32Array, points: Float32Array, table: Float32Array, af: Float32Array, ai: Uint32Array, selectors: Uint32Array,
  values: Float32Array, flags: Uint32Array, path: ChartCompositeProductPath = "dekker", model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): void {
  const [count, columns, wavelengthMode] = [p[0]!, p[1]!, p[2]!], emulator = createCompositeMaterialEmulator(af, ai, path, model);
  for (let i = 0; i < count; i++) {
    emulator.reset();
    const m = emulator.material(points[4 * i]!, points[4 * i + 1]!, points[4 * i + 2]!, points[4 * i + 3]!);
    if (wavelengthMode !== 0) values[i] = table[m * columns + selectors[i]!]!;
    else for (let c = 0; c < columns; c++) values[i * columns + c] = table[m * columns + c]!;
    flags[i] = emulator.flagged ? 1 : 0;
  }
}

interface B { v: V; e: number }

/** The kernel's bound arithmetic and decisions on an arithmetic, with the shared `flagged` state. */
interface BoundOps {
  bds(a: Dw, scale: number): B; bd(a: Dw): B; bc(c: number): B; bx(c: number): B; badd(a: B, b: B): B; bsub(a: B, b: B): B; bmul(a: B, b: B): B; bneg(a: B): B; babs(a: B): B;
  bdiv(a: B, b: B): B; margin(x: B): number; ge0(x: B): boolean; ge(a: B, b: B): boolean; gt(a: B, b: B): boolean; lt(a: B, b: B): boolean; le(a: B, b: B): boolean;
  bfloor(x: B, lo: number, hi: number): number;
}
/**
 * The same bound arithmetic written out in float32 for the round-to-nearest models (`nearest`, `reassociation`: neither fuses nor
 * rewrites the bound arithmetic), operation for operation as `boundOps` evaluates it there, without a call per operation: V8 coverage
 * made the per-operation calls about 2.4 times slower (test/display-view-composite-gpu.test.ts, M5 Pro: 95 s before the arithmetic
 * models, 230 s through `boundOps`).
 */
function nearestBoundOps(flag: () => void): BoundOps {
  const n = (x: V): number => x as number;
  const bds = (a: Dw, scale: number): B => ({ v: a[0], e: f(f(Math.abs(a[1]) + f(DW * f(f(Math.abs(a[0]) + Math.abs(a[1])) + scale))) + TINY) });
  const bd = (a: Dw): B => bds(a, 0);
  const bc = (c: number): B => ({ v: c, e: f(f(E * Math.abs(c)) + TINY) });
  const bx = (c: number): B => ({ v: c, e: 0 });
  const badd = (a: B, b: B): B => { const v = f(n(a.v) + n(b.v)); return { v, e: f(f(a.e + b.e) + f(E * Math.abs(v))) }; };
  const bsub = (a: B, b: B): B => { const v = f(n(a.v) - n(b.v)); return { v, e: f(f(a.e + b.e) + f(E * Math.abs(v))) }; };
  const bmul = (a: B, b: B): B => {
    const av = n(a.v), bv = n(b.v), v = f(av * bv);
    return { v, e: f(f(f(f(Math.abs(av) * b.e) + f(Math.abs(bv) * a.e)) + f(a.e * b.e)) + f(E * Math.abs(v))) };
  };
  const bneg = (a: B): B => ({ v: -n(a.v), e: a.e });
  const babs = (a: B): B => ({ v: Math.abs(n(a.v)), e: a.e });
  const bdiv = (a: B, b: B): B => {
    const av = n(a.v), bv = n(b.v), v = f(av / bv), d = f(Math.abs(bv) - f(SAFETY * b.e));
    if (!(d > 0)) { flag(); return { v, e: f(3e38) }; }
    const e = f(f(f(a.e + f(f(f(Math.abs(av) + a.e) * b.e) / d)) / Math.abs(bv)) + f(f(5 * E) * Math.abs(v)));
    return { v, e };
  };
  const margin = (x: B): number => f(f(SAFETY * x.e) + f(SLACK * f(Math.abs(n(x.v)) + 1)));
  const ge0 = (x: B): boolean => { const v = n(x.v); if (!(Math.abs(v) > margin(x))) flag(); return v >= 0; };
  const ge = (a: B, b: B): boolean => ge0(bsub(a, b)), gt = (a: B, b: B): boolean => !ge0(bsub(b, a)), lt = (a: B, b: B): boolean => !ge0(bsub(a, b)), le = (a: B, b: B): boolean => ge0(bsub(b, a));
  const bfloor = (x: B, lo: number, hi: number): number => {
    const xv = n(x.v), fl = Math.floor(xv), m = wgslRound(xv), g = margin(x);
    if (g >= 0.5) { flag(); return fl; }
    if (m >= lo && m <= hi && !(Math.abs(f(xv - m)) > g)) flag();
    return fl;
  };
  return { bds, bd, bc, bx, badd, bsub, bmul, bneg, babs, bdiv, margin, ge0, ge, gt, lt, le, bfloor };
}
/** The bound arithmetic of a model: written out for the round-to-nearest models, through the model's operations under contraction. */
function boundsOf(model: CompositeArithmetic, K: Ops, flag: () => void): BoundOps { return model.kind === "fused-contraction" ? boundOps(K, flag) : nearestBoundOps(flag); }
function boundOps(K: Ops, flag: () => void): BoundOps {
  const { add, sub, mul, v: r } = K;
  const bds = (a: Dw, scale: number): B => ({ v: a[0], e: add(add(Math.abs(a[1]), mul(DW, add(add(Math.abs(a[0]), Math.abs(a[1])), scale))), TINY) });
  const bd = (a: Dw): B => bds(a, 0);
  const bc = (c: number): B => ({ v: c, e: add(mul(E, Math.abs(c)), TINY) });
  const bx = (c: number): B => ({ v: c, e: 0 });
  const badd = (a: B, b: B): B => { const v = add(a.v, b.v); return { v, e: add(add(a.e, b.e), mul(E, Math.abs(v))) }; };
  const bsub = (a: B, b: B): B => { const v = sub(a.v, b.v); return { v, e: add(add(a.e, b.e), mul(E, Math.abs(v))) }; };
  const bmul = (a: B, b: B): B => {
    const av = r(a.v), bv = r(b.v), v = mul(av, bv);
    return { v, e: add(add(add(mul(Math.abs(av), b.e), mul(Math.abs(bv), a.e)), mul(a.e, b.e)), mul(E, Math.abs(r(v)))) };
  };
  const bneg = (a: B): B => ({ v: K.neg(a.v), e: a.e });
  const babs = (a: B): B => ({ v: Math.abs(r(a.v)), e: a.e });
  const bdiv = (a: B, b: B): B => {
    const av = r(a.v), bv = r(b.v), v = f(av / bv), d = sub(Math.abs(bv), mul(SAFETY, b.e));
    if (!(d > 0)) { flag(); return { v, e: f(3e38) }; }
    // WGSL: (a.e + (abs(a.v) + a.e) * b.e / d) / abs(b.v) + 5.0 * E * abs(v)  (5.0 * E is a constant expression).
    const e = add(f(add(a.e, f(r(mul(add(Math.abs(av), a.e), b.e)) / d)) / Math.abs(bv)), mul(f(5 * E), Math.abs(v)));
    return { v, e };
  };
  const margin = (x: B): number => add(mul(SAFETY, x.e), mul(SLACK, add(Math.abs(r(x.v)), 1)));
  const ge0 = (x: B): boolean => { const v = r(x.v); if (!(Math.abs(v) > margin(x))) flag(); return v >= 0; };
  const ge = (a: B, b: B): boolean => ge0(bsub(a, b)), gt = (a: B, b: B): boolean => !ge0(bsub(b, a)), lt = (a: B, b: B): boolean => !ge0(bsub(a, b)), le = (a: B, b: B): boolean => ge0(bsub(b, a));
  const bfloor = (x: B, lo: number, hi: number): number => {
    const xv = r(x.v), n = Math.floor(xv), m = wgslRound(xv), g = margin(x);
    if (g >= 0.5) { flag(); return n; }
    if (m >= lo && m <= hi && !(Math.abs(sub(x.v, m)) > g)) flag();
    return n;
  };
  return { bds, bd, bc, bx, badd, bsub, bmul, bneg, babs, bdiv, margin, ge0, ge, gt, lt, le, bfloor };
}

/** The composite kernel's `material(p)` on its packed records, as a reusable emulator: a double-float32 point (hi, lo per axis) in, the material index out. */
export interface CompositeMaterialEmulator { material(px: number, pxl: number, py: number, pyl: number): number; readonly flagged: boolean; reset(): void }
export function createCompositeMaterialEmulator(af: Float32Array, ai: Uint32Array, path: ChartCompositeProductPath = "dekker",
  model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): CompositeMaterialEmulator {
  let flagged = false;
  const K = opsOf(model), r = K.v, { add, sub, mul } = K, D = doubleWord(K, path);
  const { bds, bd, bc, bx, badd, bsub, bmul, bneg, babs, bdiv, margin, ge0, ge, gt, lt, le, bfloor } = boundsOf(model, K, () => { flagged = true; });
  const parityEven = (i: number, j: number): boolean => (((i | 0) + (j | 0)) & 1) === 0;
  const toI32 = (x: number): number => Math.max(-2147483648, Math.min(2147483647, Math.trunc(x)));
  // --- Taylor cos / sin ---
  const horner = (coefficients: number[], t: B): B => {
    let q = bc(coefficients[0]!);
    for (let k = 1; k < coefficients.length; k++) q = badd(bmul(q, t), bc(coefficients[k]!));
    return q;
  };
  const bcosPoly = (y: B): B => {
    const q = horner([2.08767569878681e-9, -2.755731922398589e-7, 2.48015873015873e-5, -0.001388888888888889, 0.041666666666666664, -0.5, 1].map(f), bmul(y, y));
    return { v: q.v, e: add(q.e, f(4e-13)) };
  };
  const bsinPoly = (z: B): B => {
    const q = horner([1.605904383682161e-10, -2.505210838544172e-8, 2.7557319223985893e-6, -0.0001984126984126984, 0.008333333333333333, -0.16666666666666666, 1].map(f), bmul(z, z));
    const s = bmul(q, z);
    return { v: s.v, e: add(s.e, f(2e-14)) };
  };
  const bcos = (x: B): B => {
    let y = babs(x), negate = false;
    if (r(y.v) > HALF_PI) { y = bsub(bc(PI), y); negate = true; }
    let c = r(y.v) > QUARTER_PI ? bsinPoly(bsub(bc(HALF_PI), y)) : bcosPoly(y);
    if (negate) c = bneg(c);
    return c;
  };
  const barsMaterial = (x: B, origin: number, w: number): number => {
    const n = bfloor(bdiv(bsub(x, bc(origin)), bc(w)), -3e38, 3e38);
    return parityEven(toI32(n), 0) ? 0 : 1;
  };
  const numeralInk = (u: B, v: B, lu0: number, lv0: number, h: number, digits: number): boolean => {
    const x = bdiv(bsub(u, bc(lu0)), bc(h)), y = bdiv(bsub(v, bc(lv0)), bc(h));
    if (lt(y, bx(0)) || gt(y, bx(1)) || lt(x, bx(0))) return false;
    const n = ai[digits]!, k = bfloor(bdiv(x, bc(f(NUMERAL_ADVANCE))), 0, n);
    if (k >= n) return false;
    const cx = bsub(x, bmul(bx(k), bc(f(NUMERAL_ADVANCE)))), mask = DIGIT_MASK[ai[digits + 1 + k]!]!;
    for (let s = 0; s < 7; s++) {
      if ((mask & (1 << s)) === 0) continue;
      const box = SEGMENT_BOX[s]!;
      if (ge(cx, bc(box[0])) && le(cx, bc(box[2])) && ge(y, bc(box[1])) && le(y, bc(box[3]))) return true;
    }
    return false;
  };
  const starCross = (dirs: number, k: number, x: Dw, y: Dw): B => {
    const o = dirs + 4 * k, cx: Dw = [af[o]!, af[o + 1]!], sx: Dw = [af[o + 2]!, af[o + 3]!];
    return bds(D.dSub(D.dMul(cx, y), D.dMul(sx, x)), add(Math.abs(r(mul(cx[0], y[0]))), Math.abs(r(mul(sx[0], x[0])))));
  };
  const mod = (a: number, n: number): number => ((a % n) + n) % n;
  const classify = (kind: number, ioff: number, foff: number, xd: Dw, yd: Dw): number => {
    const u = bd(xd), v = bd(yd);
    switch (kind) {
      case 0: return 0;
      case 1: return ge0(bsub(bmul(u, bc(af[foff]!)), bmul(v, bc(af[foff + 1]!)))) ? 1 : 0;
      case 2: {
        const n = ai[ioff]!, dirs = ai[ioff + 1]!, levels = ai[ioff + 2]!, buckets = ai[ioff + 3]!, m = ai[ioff + 4]!, w = ai[ioff + 5]!;
        const q = bd(D.dAdd(D.dMul(xd, xd), D.dMul(yd, yd)));
        if (gt(q, bc(af[foff]!))) return ai[ioff + 6]!;
        const a = f(Math.atan2(yd[0], xd[0]));
        const j = Math.min(m - 1, Math.max(0, Math.floor(f(r(mul(add(a, PI), m)) / f(2 * PI)))));
        const k0 = ai[buckets + j]!;
        let lo = k0 - w, hi = k0 + w + 1;
        const clo = starCross(dirs, mod(lo, n), xd, yd), chi = starCross(dirs, mod(hi, n), xd, yd);
        if (!ge0(clo) || ge0(chi)) { flagged = true; return 0; }
        for (let step = 0; step < 32 && hi - lo > 1; step++) {
          const mid = Math.trunc((lo + hi) / 2), c = starCross(dirs, mod(mid, n), xd, yd);
          if (r(c.v) >= 0) lo = mid; else hi = mid;
        }
        if (hi - lo > 1) flagged = true;
        const kl = mod(lo, n), kh = mod(hi, n);
        if (!ge0(starCross(dirs, kl, xd, yd)) || ge0(starCross(dirs, kh, xd, yd))) flagged = true;
        return ai[levels + kl]!;
      }
      case 3: {
        const steps = ai[ioff]!, t = bmul(bmul(badd(u, bx(1)), bx(0.5)), bx(steps));
        return Math.min(steps - 1, Math.max(0, bfloor(t, 1, steps - 1)));
      }
      case 5: {
        const size = bc(af[foff]!), aspect = bc(af[foff + 1]!);
        const i = bfloor(bdiv(badd(u, bx(1)), size), -3e38, 3e38), j = bfloor(bdiv(bsub(aspect, v), size), -3e38, 3e38);
        return parityEven(toI32(i), toI32(j)) ? 1 : 0;
      }
      case 6: {
        const columns = ai[ioff]!, rows = ai[ioff + 1]!, centers = ai[ioff + 2]!;
        const i = Math.min(columns - 1, Math.max(0, bfloor(bdiv(badd(u, bx(1)), bc(af[foff]!)), 1, columns - 1)));
        const j = Math.min(rows - 1, Math.max(0, bfloor(bdiv(bsub(bc(af[foff + 2]!), v), bc(af[foff + 1]!)), 1, rows - 1)));
        const c = centers + 2 * (j * columns + i), dx = bsub(u, bc(af[c]!)), dy = bsub(v, bc(af[c + 1]!));
        return le(badd(bmul(dx, dx), bmul(dy, dy)), bc(af[foff + 3]!)) ? 1 : 0;
      }
      case 7: {
        const columns = ai[ioff]!, rows = ai[ioff + 1]!, n = ai[ioff + 2]!, background = ai[ioff + 3]!;
        const fx = bdiv(badd(u, bx(1)), bc(af[foff]!)), fy = bdiv(bsub(bc(af[foff + 2]!), v), bc(af[foff + 1]!));
        const i = bfloor(fx, -3e38, 3e38), j = bfloor(fy, -3e38, 3e38);
        if (i < 0 || j < 0 || i >= columns || j >= rows) return background;
        const index = j * columns + i, x = bsub(fx, bx(i)), y = bsub(fy, bx(j)), g0 = bc(af[foff + 3]!), g1 = bc(af[foff + 4]!);
        if (index >= n || lt(x, g0) || gt(x, g1) || lt(y, g0) || gt(y, g1)) return background;
        return index;
      }
      case 8: {
        const nx = ai[ioff]!, ny = ai[ioff + 1]!, csr = ai[ioff + 2]!, entries = ai[ioff + 3]!, disks = ai[ioff + 4]!, mean = ai[ioff + 5]!, cell = bc(af[foff + 2]!);
        const i = bfloor(bdiv(bsub(u, bc(af[foff]!)), cell), -3e38, 3e38), j = bfloor(bdiv(bsub(v, bc(af[foff + 1]!)), cell), -3e38, 3e38);
        if (i < 0 || j < 0 || i >= nx || j >= ny) return mean;
        const c = j * nx + i;
        for (let e = ai[csr + c]!; e < ai[csr + c + 1]!; e++) {
          const d = disks + 4 * ai[entries + e]!, dx = bsub(u, bc(af[d]!)), dy = bsub(v, bc(af[d + 1]!));
          if (le(badd(bmul(dx, dx), bmul(dy, dy)), bc(af[d + 2]!))) return af[d + 3]!;
        }
        return mean;
      }
      case 9: {
        const groups = ai[ioff]!, gf = ai[ioff + 1]!, digits = ai[ioff + 2]!;
        for (let g = 0; g < groups; g++) {
          const o = gf + CHART_RECORD_STRIDE.barGroupFloats * g, a = (k: number): number => af[o + k]!;
          if (lt(u, bc(a(0))) || gt(u, bc(a(1)))) continue;
          if (ge(u, bc(a(2))) && lt(u, bc(a(4))) && ge(v, bc(a(3))) && le(v, bc(a(5)))) return barsMaterial(u, a(2), a(10));
          if (ge(u, bc(a(6))) && le(u, bc(a(8))) && gt(v, bc(a(7))) && le(v, bc(a(9)))) {
            const n = bfloor(bdiv(bsub(bc(a(9)), v), bc(a(10))), -3e38, 3e38);
            return parityEven(toI32(n), 0) ? 0 : 1;
          }
          if (a(11) !== 0 && numeralInk(u, v, a(12), a(13), a(14), digits + a(15))) return 0;
          return 1;
        }
        return 1;
      }
      case 10: {
        const horizontal = ai[ioff] === 0, lines = ai[ioff + 1]!;
        let s: B, y: B;
        if (horizontal) { s = bmul(badd(u, bx(1)), bx(0.5)); y = v; } else { s = bdiv(badd(v, bc(af[foff]!)), bc(af[foff + 4]!)); y = u; }
        if (lt(s, bx(0)) || gt(s, bx(1))) return 1;
        const w = bdiv(bc(af[foff + 1]!), badd(bc(af[foff + 2]!), bmul(bc(af[foff + 3]!), s))), half = bmul(w, bx(f(r(mul(sub(mul(2, lines), 1), 0.5)))));
        if (lt(y, bneg(half)) || ge(y, half)) return 1;
        const n = bfloor(bdiv(badd(y, half), w), -3e38, 3e38);
        return parityEven(toI32(n), 0) ? 0 : 1;
      }
      case 11: {
        const q = D.dAdd(D.dMul(xd, xd), D.dMul(yd, yd));
        if (gt(bd(q), bc(af[foff]!))) return 1024;
        const psi = D.dMul(q, [af[foff + 1]!, af[foff + 2]!]);
        if (!(Math.abs(psi[0]) < 1048576)) { flagged = true; return 0; }
        const n = mul(2, wgslRound(r(mul(psi[0], 0.5)))), rr = add(sub(psi[0], n), psi[1]);
        const phase: B = { v: rr, e: add(add(mul(DW, add(Math.abs(psi[0]), Math.abs(psi[1]))), mul(E, Math.abs(rr))), TINY) };
        const c = bcos(bmul(bc(PI), phase)), t = bmul(bx(512), badd(bx(1), c));
        return Math.min(1023, Math.max(0, bfloor(t, 1, 1023)));
      }
      case 12: {
        const columns = ai[ioff]!, rows = ai[ioff + 1]!, cellW = bc(af[foff]!), cellH = bc(af[foff + 1]!), aspect = bc(af[foff + 2]!);
        const i = Math.min(columns - 1, Math.max(0, bfloor(bdiv(badd(u, bx(1)), cellW), 1, columns - 1)));
        const j = Math.min(rows - 1, Math.max(0, bfloor(bdiv(bsub(aspect, v), cellH), 1, rows - 1)));
        const du = bsub(u, badd(bx(-1), bmul(bx(f(i + 0.5)), cellW))), dv = bsub(v, bsub(aspect, bmul(bx(f(j + 0.5)), cellH)));
        const c = bc(af[foff + 3]!), s = bc(af[foff + 4]!), half = bc(af[foff + 5]!);
        const x = bsub(bmul(du, c), bmul(dv, s)), y = badd(bmul(du, s), bmul(dv, c));
        return le(babs(x), half) && le(babs(y), half) ? 0 : 1;
      }
      case 13: {
        const spacing = bc(af[foff]!), half = bc(af[foff + 1]!), sv = r(spacing.v);
        const nu = wgslRound(f(r(u.v) / sv)), nv = wgslRound(f(r(v.v) / sv));
        const du = babs(bsub(u, bmul(spacing, bx(nu)))), dv = babs(bsub(v, bmul(spacing, bx(nv))));
        return le(du, half) || le(dv, half) ? 1 : 0;
      }
      case 14: {
        const inverted = ai[ioff] !== 0, q = badd(bmul(u, u), bmul(v, v));
        if (gt(q, bc(af[foff]!))) return 2;
        if (gt(q, bc(af[foff + 1]!))) return 0;
        const same = ge0(u) === ge0(v);
        return same !== inverted ? 0 : 1;
      }
      default: flagged = true; return 0;
    }
  };
  const shapeContains = (shape: number, x: B, y: B): boolean => {
    const kind = ai[shape]!, data = ai[shape + 1]!, edges = ai[shape + 2]!, mx = margin(x), my = margin(y);
    if (add(x.v, mx) < af[data]! || sub(x.v, mx) > af[data + 2]! || add(y.v, my) < af[data + 1]! || sub(y.v, my) > af[data + 3]!) return false;
    if (kind === 1) {
      const dx = bsub(x, bc(af[data + 4]!)), dy = bsub(y, bc(af[data + 5]!)), d2 = badd(bmul(dx, dx), bmul(dy, dy));
      return ge(d2, bc(af[data + 6]!)) && le(d2, bc(af[data + 7]!));
    }
    let winding = 0;
    for (let k = 0; k < edges; k++) {
      const o = data + 4 + 4 * k, x0 = bc(af[o]!), y0 = bc(af[o + 1]!), x1 = bc(af[o + 2]!), y1 = bc(af[o + 3]!);
      if (ge(y, y0)) {
        if (gt(y1, y)) { const side = bsub(bmul(bsub(x1, x0), bsub(y, y0)), bmul(bsub(x, x0), bsub(y1, y0))); if (gt(side, bx(0))) winding++; }
      } else if (le(y1, y)) {
        const side = bsub(bmul(bsub(x1, x0), bsub(y, y0)), bmul(bsub(x, x0), bsub(y1, y0)));
        if (lt(side, bx(0))) winding--;
      }
    }
    return winding !== 0;
  };
  const material = (px: number, pxl: number, py: number, pyl: number): number => {
    const ud: Dw = [px, pxl], vd: Dw = [py, pyl], u = bd(ud), v = bd(vd), layers = ai[1]!, hl = ai[3]!;
    for (let l = layers; l > 0; l--) {
      const h = hl + CHART_RECORD_STRIDE.layer * (l - 1), fo = ai[h + 6]!;
      const u0 = bc(af[fo]!), v0 = bc(af[fo + 1]!), u1 = bc(af[fo + 2]!), v1 = bc(af[fo + 3]!);
      if (lt(u, u0) || gt(u, u1) || lt(v, v0) || gt(v, v1)) continue;
      const x = bmul(bsub(u, u0), bc(af[fo + 4]!)), y = bmul(bsub(v1, v), bc(af[fo + 5]!)), cellsX = ai[h]!, cellsY = ai[h + 1]!;
      const i = Math.min(cellsX - 1, Math.max(0, Math.floor(f(r(x.v) / af[fo + 6]!)))), j = Math.min(cellsY - 1, Math.max(0, Math.floor(f(r(y.v) / af[fo + 7]!))));
      const cell = j * cellsX + i, start = ai[ai[h + 2]! + cell]!, end = ai[ai[h + 2]! + cell + 1]!;
      for (let e = start; e < end; e++) {
        const shape = ai[h + 4]! + CHART_RECORD_STRIDE.shape * ai[ai[h + 3]! + e]!;
        if (shapeContains(shape, x, y)) return ai[h + 8]!;
      }
      return ai[h + 7]!;
    }
    const elements = ai[0]!, he = ai[2]!;
    for (let i = elements; i > 0; i--) {
      const h = he + CHART_RECORD_STRIDE.element * (i - 1), kind = ai[h]!, offset = ai[h + 1]!, ioff = ai[h + 2]!, foff = ai[h + 3]!, placement = ai[h + 4]!;
      if (placement === 0) return offset + classify(kind, ioff, foff + CHART_RECORD_STRIDE.placementFloats, ud, vd);
      const du = D.dSub(ud, [af[foff]!, af[foff + 1]!]), dv = D.dSub(vd, [af[foff + 2]!, af[foff + 3]!]), hw = bc(af[foff + 4]!), hh = bc(af[foff + 5]!);
      const bu = bds(du, add(Math.abs(ud[0]), Math.abs(af[foff]!))), bv = bds(dv, add(Math.abs(vd[0]), Math.abs(af[foff + 2]!)));
      if (lt(bu, bneg(hw)) || gt(bu, hw) || lt(bv, bneg(hh)) || gt(bv, hh)) continue;
      if (placement === 2) { const a = bdiv(bu, hw), b = bdiv(bv, hh); if (gt(badd(bmul(a, a), bmul(b, b)), bx(1))) continue; }
      const scale: Dw = [af[foff + 6]!, af[foff + 7]!];
      return offset + classify(kind, ioff, foff + CHART_RECORD_STRIDE.placementFloats, D.dMul(du, scale), D.dMul(dv, scale));
    }
    flagged = true;
    return 0;
  };
  return { material, get flagged(): boolean { return flagged; }, reset(): void { flagged = false; } };
}

/**
 * The display view's composite material module (#491, src/gpu/display-view-composite-material-module.ts) on the fake device: the
 * lattice recovery of the exact query point from the kernel's float32 point (p / scale_hi, the nearest offset lattice, the point
 * re-formed in double-float32), the fixed-size chart's placement, then the composite kernel's `material`. Line by line the WGSL.
 */
export function createCompositeDisplayViewMaterialEmulator(latticeWords: Uint32Array, latticeFloats: Float32Array, offsets: Float32Array, af: Float32Array, ai: Uint32Array,
  path: ChartCompositeProductPath = "dekker", model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): { material(u: number, v: number): number; readonly flagged: boolean; reset(): void } {
  const inner = createCompositeMaterialEmulator(af, ai, path, model);
  const L = DISPLAY_VIEW_LATTICE, count = latticeWords[L.offsets]!, placed = latticeWords[L.placed] !== 0, surround = latticeWords[L.surround]!, tolerance = latticeFloats[L.tolerance]!;
  const scaleU: Dw = [latticeFloats[L.scaleUHi]!, latticeFloats[L.scaleULo]!], scaleV: Dw = [latticeFloats[L.scaleVHi]!, latticeFloats[L.scaleVLo]!];
  const k: Dw = [latticeFloats[L.chartKHi]!, latticeFloats[L.chartKLo]!], aspect = latticeFloats[L.chartAspect]!;
  let uncertain = false;
  const K = opsOf(model), D = doubleWord(K, path), { bd, bc, bx, babs, le } = boundsOf(model, K, () => { uncertain = true; });
  const latticePoint = (p: number, scale: Dw, axis: 0 | 1): Dw => {
    const rough = f(p / scale[0]);
    let best = f(3e38), site = 0, cHi = 0, cLo = 0;
    for (let o = 0; o < count; o++) {
      const hi = offsets[4 * o + 2 * axis]!, lo = offsets[4 * o + 2 * axis + 1]!, d = K.sub(rough, hi), n = wgslRound(d), r = Math.abs(K.sub(d, n));
      if (r < best) { best = r; site = n; cHi = hi; cLo = lo; }
    }
    if (!(best <= tolerance)) uncertain = true;
    return D.dMul(D.dAdd([site, 0], [cHi, cLo]), scale);
  };
  return {
    material(pu: number, pv: number): number {
      let u = latticePoint(pu, scaleU, 0), v = latticePoint(pv, scaleV, 1);
      if (placed) {
        u = D.dMul(u, k); v = D.dMul(v, k);
        if (!(le(babs(bd(u)), bx(1)) && le(babs(bd(v)), bc(aspect)))) return surround;
      }
      return inner.material(u[0], u[1], v[0], v[1]);
    },
    get flagged(): boolean { return uncertain || inner.flagged; },
    reset(): void { uncertain = false; inner.reset(); }
  };
}

/** WGSL `round`: the nearest integer, halves to even (Math.round takes halves up). */
function wgslRound(x: number): number {
  if (Math.abs(x - Math.trunc(x)) === 0.5) return 2 * Math.round(x / 2);
  return Math.round(x);
}

/**
 * #581: the display view's image-plane module (src/gpu/display-view-image-material-module.ts) on the fake device: the lattice
 * recovery, the print's edge in bound arithmetic, the pixel coordinates in double-float32, the bilinear weights (the smaller of
 * f and 1 − f rounded once, the other as 1 minus it) or the nearest pixel, and the flag on a moved weight. Line by line the WGSL.
 */
export function createImagePlaneDisplayViewMaterialEmulator(photoWords: Uint32Array, photoFloats: Float32Array, signal: Float32Array, surround: Float32Array,
  latticeWords: Uint32Array, latticeFloats: Float32Array, offsets: Float32Array, path: ChartCompositeProductPath = "dekker", model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC):
  { material(u: number, v: number): number; value(u: number, v: number, c: number): number; readonly flagged: boolean; reset(): void } {
  const L = DISPLAY_VIEW_LATTICE, count = latticeWords[L.offsets]!, tolerance = latticeFloats[L.tolerance]!;
  const scaleU: Dw = [latticeFloats[L.scaleUHi]!, latticeFloats[L.scaleULo]!], scaleV: Dw = [latticeFloats[L.scaleVHi]!, latticeFloats[L.scaleVLo]!];
  const k: Dw = [latticeFloats[L.chartKHi]!, latticeFloats[L.chartKLo]!];
  const width = photoWords[0]!, height = photoWords[1]!, nearest = photoWords[2] !== 0, row0 = photoWords[3]!;
  const halfW: Dw = [photoFloats[4]!, photoFloats[5]!], halfH: Dw = [photoFloats[6]!, photoFloats[7]!], aspect: Dw = [photoFloats[8]!, photoFloats[9]!];
  const slackX = photoFloats[10]!, slackY = photoFloats[11]!;
  let uncertain = false;
  const K = opsOf(model), D = doubleWord(K, path), { bd, bx, babs, le, bfloor } = boundsOf(model, K, () => { uncertain = true; });
  const latticePoint = (p: number, scale: Dw, axis: 0 | 1): Dw => {
    const rough = f(p / scale[0]);
    let best = f(3e38), site = 0, cHi = 0, cLo = 0;
    for (let o = 0; o < count; o++) {
      const hi = offsets[4 * o + 2 * axis]!, lo = offsets[4 * o + 2 * axis + 1]!, d = K.sub(rough, hi), n = wgslRound(d), r = Math.abs(K.sub(d, n));
      if (r < best) { best = r; site = n; cHi = hi; cLo = lo; }
    }
    if (!(best <= tolerance)) uncertain = true;
    return D.dMul(D.dAdd([site, 0], [cHi, cLo]), scale);
  };
  const slackOf = (x: Dw, slack: number): number => K.add(f(4 * f(DW * K.add(Math.abs(x[0]), 1))), f(4 * slack));
  const axis = (s: Dw, n: number): [number, number, number, number] => {
    let f0 = Math.floor(s[0]);
    if (f0 === s[0] && s[1] < 0) f0 = f(f0 - 1);
    const frac = D.dSub(s, [f0, 0]), comp = D.dSub([K.add(f0, 1), 0], s);
    let w0: number, w1: number;
    if (frac[0] <= 0.5) { w1 = K.add(frac[0], frac[1]); w0 = K.sub(1, w1); } else { w0 = K.add(comp[0], comp[1]); w1 = K.sub(1, w0); }
    const last = n - 1;
    return [Math.min(last, Math.max(0, f0)), Math.min(last, Math.max(0, f0 + 1)), w0, w1];
  };
  const at = (i: number, j: number, c: number): number => signal[((j - row0) * width + i) * 3 + c]!;
  const value = (pu: number, pv: number, c: number): number => {
    const u = D.dMul(latticePoint(pu, scaleU, 0), k), v = D.dMul(latticePoint(pv, scaleV, 1), k);
    if (!(le(babs(bd(u)), bx(1)) && le(babs(bd(v)), bd(aspect)))) return surround[c]!;
    const x = D.dMul(D.dAdd(u, [1, 0]), halfW), y = D.dMul(D.dSub(aspect, v), halfH);
    if (nearest) {
      const lastX = width - 1, lastY = height - 1;
      const i = Math.min(lastX, Math.max(0, bfloor(bd(x), 1, lastX))), j = Math.min(lastY, Math.max(0, bfloor(bd(y), 1, lastY)));
      return at(i, j, c);
    }
    const [i0, i1, x0, x1] = axis(D.dSub(x, [0.5, 0]), width), [j0, j1, y0, y1] = axis(D.dSub(y, [0.5, 0]), height);
    const s00 = at(i0, j0, c), s10 = at(i1, j0, c), s01 = at(i0, j1, c), s11 = at(i1, j1, c);
    const result = K.add(K.v(K.mul(y0, K.add(K.mul(x0, s00), K.mul(x1, s10)))), K.v(K.mul(y1, K.add(K.mul(x0, s01), K.mul(x1, s11)))));
    const largest = Math.max(Math.max(s00, s10), Math.max(s01, s11));
    const moved = f(f(f(slackOf(x, slackX) + slackOf(y, slackY)) * 2) * largest);
    if (!(moved <= f(E * result))) uncertain = true;
    return result;
  };
  return { material: () => 0, value, get flagged(): boolean { return uncertain; }, reset(): void { uncertain = false; } };
}

/**
 * #581: the image-plane print's pass 1 (`imagePlaneQualityLatticeWgsl`, src/gpu/display-view-image-quality.ts): per lattice point
 * the exact point in double-float32, the print's edge, the pixel coordinates, the bilinear weights or the nearest pixel, and the
 * radiance per node from the pixel records and the node table, with the moved-weight flag. Line by line the WGSL.
 */
export function emulateImagePlaneQualityLattice(pw: Uint32Array, groups: Uint32Array, values: Float32Array, flags: Uint32Array, records: Uint32Array, photoWords: Uint32Array,
  photoFloats: Float32Array, nodeTable: Float32Array, path: ChartCompositeProductPath = "dekker", model: CompositeArithmetic = NEAREST_COMPOSITE_ARITHMETIC): void {
  const GROUP_WORDS = 8, latticeTotal = pw[20]!, groupCount = pw[19]!, gi = new Int32Array(groups.buffer, groups.byteOffset, groups.length), gf = new Float32Array(groups.buffer, groups.byteOffset, groups.length);
  const recordFloats = new Float32Array(records.buffer, records.byteOffset, records.length);
  const [width, height, nearest, N, row0] = [photoWords[0]!, photoWords[1]!, photoWords[2] !== 0, photoWords[3]!, photoWords[4]!];
  const F = (a: number): Dw => [photoFloats[a]!, photoFloats[a + 1]!];
  const su = F(8), sv = F(10), k = F(12), hw = F(14), hh = F(16), aspect = F(18), slackX = photoFloats[20]!, slackY = photoFloats[21]!, black = photoFloats[22]!, span = photoFloats[23]!;
  let uncertain: boolean;
  const K = opsOf(model), D = doubleWord(K, path), { bd, bx, babs, le, bfloor } = boundsOf(model, K, () => { uncertain = true; });
  const white = 125 * N;
  const pixelSlack = (x: Dw, slack: number): number => K.add(f(4 * f(DW * K.add(Math.abs(x[0]), 1))), f(4 * slack));
  const axis = (s: Dw, n: number): [number, number, number, number] => {
    let f0 = Math.floor(s[0]);
    if (f0 === s[0] && s[1] < 0) f0 = f(f0 - 1);
    const frac = D.dSub(s, [f0, 0]), comp = D.dSub([K.add(f0, 1), 0], s);
    let w0: number, w1: number;
    if (frac[0] <= 0.5) { w1 = K.add(frac[0], frac[1]); w0 = K.sub(1, w1); } else { w0 = K.add(comp[0], comp[1]); w1 = K.sub(1, w0); }
    return [Math.min(n - 1, Math.max(0, f0)), Math.min(n - 1, Math.max(0, f0 + 1)), w0, w1];
  };
  const weights = (word: number, bit: number, small: number): [number, number] => (((word >>> bit) & 1) === 0 ? [f(1 - small), small] : [small, f(1 - small)]);
  const pixelAt = (i: number, j: number): { base: number; r: [number, number]; g: [number, number]; b: [number, number] } => {
    const o = ((j - row0) * width + i) * 4, w = records[o]!;
    return { base: (w & 3) * 25 + ((w >>> 2) & 3) * 5 + ((w >>> 4) & 3), r: weights(w, 6, recordFloats[o + 1]!), g: weights(w, 7, recordFloats[o + 2]!), b: weights(w, 8, recordFloats[o + 3]!) };
  };
  const node = (kk: number, n: number): number => nodeTable[kk * N + n]!;
  const pixelValue = (px: ReturnType<typeof pixelAt>, n: number): number => {
    const b = px.base;
    const inner = (o: number): number => f(f(px.b[0] * node(b + o, n)) + f(px.b[1] * node(b + o + 1, n)));
    const mid = (o: number): number => f(f(px.g[0] * inner(o)) + f(px.g[1] * inner(o + 5)));
    const lat = f(f(px.r[0] * mid(0)) + f(px.r[1] * mid(25)));
    return f(black + f(span * lat));
  };
  for (let i = 0; i < latticeTotal; i++) {
    let g = 0;
    for (let kk = 1; kk < groupCount; kk++) if (i >= groups[kk * GROUP_WORDS + 4]!) g = kk;
    const base = g * GROUP_WORDS, lw = groups[base + 2]!, local = i - groups[base + 4]!;
    const q = gi[base + 1]! + Math.floor(local / lw), p = gi[base]! + (local % lw);
    uncertain = false;
    const out = i * N;
    const u = D.dMul(D.dMul([f(p + gf[base + 6]!), 0], su), k), v = D.dMul(D.dMul([f(q + gf[base + 7]!), 0], sv), k);
    if (!(le(babs(bd(u)), bx(1)) && le(babs(bd(v)), bd(aspect)))) {
      for (let n = 0; n < N; n++) values[out + n] = nodeTable[white + N + n]!;
      flags[i] = uncertain ? 1 : 0;
      continue;
    }
    const x = D.dMul(D.dAdd(u, [1, 0]), hw), y = D.dMul(D.dSub(aspect, v), hh);
    if (nearest) {
      const lastX = width - 1, lastY = height - 1;
      const px = pixelAt(Math.min(lastX, Math.max(0, bfloor(bd(x), 1, lastX))), Math.min(lastY, Math.max(0, bfloor(bd(y), 1, lastY))));
      for (let n = 0; n < N; n++) values[out + n] = f(nodeTable[white + n]! * pixelValue(px, n));
    } else {
      const [i0, i1, x0, x1] = axis(D.dSub(x, [0.5, 0]), width), [j0, j1, y0, y1] = axis(D.dSub(y, [0.5, 0]), height);
      const p00 = pixelAt(i0, j0), p10 = pixelAt(i1, j0), p01 = pixelAt(i0, j1), p11 = pixelAt(i1, j1);
      const slack = f(f(pixelSlack(x, slackX) + pixelSlack(y, slackY)) * 2);
      for (let n = 0; n < N; n++) {
        const s00 = pixelValue(p00, n), s10 = pixelValue(p10, n), s01 = pixelValue(p01, n), s11 = pixelValue(p11, n);
        const value = f(f(y0 * f(f(x0 * s00) + f(x1 * s10))) + f(y1 * f(f(x0 * s01) + f(x1 * s11))));
        if (!(f(slack * Math.max(Math.max(s00, s10), Math.max(s01, s11))) <= f(E * value))) uncertain = true;
        values[out + n] = f(nodeTable[white + n]! * value);
      }
    }
    flags[i] = uncertain ? 1 : 0;
  }
}
