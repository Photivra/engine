// SPDX-License-Identifier: Apache-2.0
/**
 * Float32 emulation (Math.fround after every operation; correctly rounded exp2, log2 and sqrt) of the display view's coupled GPU
 * steps (`DISPLAY_VIEW_COUPLED_WGSL`, src/gpu/wgsl-display-view-coupled.ts), line by line, for the Speed and Quality emulators.
 */
import { DISPLAY_VIEW_COUPLED as K } from "../../src/gpu/wgsl-display-view-coupled.js";

const f = Math.fround;
const E = f(2 ** -23), REACH = 8.5, START = f(0.8), NB_H = f(0.98), CMU = 1400, CVU = 36000;
const PHI_C = f(0.3989422804014327), AS = [f(0.2316419), f(0.319381530), f(-0.356563782), f(1.781477937), f(-1.821255978), f(1.330274429)];
const phi = (z: number): number => f(PHI_C * f(Math.exp(f(f(f(-0.5) * z) * z))));
function pq(z: number): [number, number] {
  const x = Math.abs(z), t = f(1 / f(1 + f(AS[0]! * x)));
  const q = f(f(phi(x) * t) * f(AS[1]! + f(t * f(AS[2]! + f(t * f(AS[3]! + f(t * f(AS[4]! + f(t * AS[5]!)))))))));
  return z >= 0 ? [f(1 - q), q] : [q, f(1 - q)];
}
type V = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]): number => f(f(f(a[0]! * b[0]!) + f(a[1]! * b[1]!)) + f(a[2]! * b[2]!));
const unit = (k: number): V => [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
const add = (a: readonly number[], b: readonly number[]): V => [f(a[0]! + b[0]!), f(a[1]! + b[1]!), f(a[2]! + b[2]!)];
const scale = (a: readonly number[], s: number): V => [f(a[0]! * s), f(a[1]! * s), f(a[2]! * s)];
const vabs = (a: readonly number[]): V => [Math.abs(a[0]!), Math.abs(a[1]!), Math.abs(a[2]!)];
const sel3 = (x: number, y: number, z: number): number => (x > y ? (x > z ? 0 : 2) : (y > z ? 1 : 2));

export interface CpOut { hm: V; hv: V; a: [V, V, V]; bm: V; bv: V; ju: number; flag: boolean; top: boolean }
const zero = (): CpOut => ({ hm: [0, 0, 0], hv: [0, 0, 0], a: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bm: [0, 0, 0], bv: [0, 0, 0], ju: 0, flag: false, top: false });

/** The coupled steps over the constants buffer `k` (`DISPLAY_VIEW_COUPLED` layout). */
export function coupledEmulator(k: Float32Array, neighbors = false): {
  on: boolean; luminance: boolean; reconstruct: boolean; desaturate: boolean; neighbors: boolean; rho: V;
  reach(cm: V, cv: V): number; tone(mu: V, s: [V, V, V], dmu: V, dsv: V): CpOut; chain(cm: V, c00: number, c01: number, c02: number, c11: number, c12: number, c22: number, dcm: V, dcv: V): CpOut;
} {
  const on = k[0] !== 0, luminance = on && k[K.luminance] !== 0, reconstruct = on && k[K.reconstruct] !== 0, desaturate = on && k[K.desaturate] !== 0;
  const w: V = [k[K.weights]!, k[K.weights + 1]!, k[K.weights + 2]!];
  const mrow = (r: number): V => [k[K.matrix + 3 * r]!, k[K.matrix + 1 + 3 * r]!, k[K.matrix + 2 + 3 * r]!];
  function ratio(l: number): V {
    const a = k[K.a]!;
    if (k[K.tone] === 2) { const d = f(1 + l); return [f(f(1 + f(l * a)) / d), f(f(a - 1) / f(d * d)), 16]; }
    const n = k[K.n]!, iw = k[K.inverseWhite]!, lg = f(Math.log2(f(a / l))), z = f(n * lg);
    let g: number, ug: number;
    if (z >= 0) { const p = f(2 ** -z); g = f(p / f(1 + p)); ug = f(1 / f(1 + p)); } else { const u = f(2 ** z); g = f(1 / f(1 + u)); ug = f(u / f(1 + u)); }
    const dz = f(f(n * f(8.5 + f(3 * Math.abs(lg)))) + Math.abs(z));
    return [f(f(g * iw) / l), f(f(f(g * f(f(n * ug) - 1)) * iw) / f(l * l)), f(f(2 * f(f(f(0.7 * dz) + 3) + f(2 * Math.abs(z)))) + 24)];
  }
  function clip(m: number, v: number): [number, number, number, number] {
    if (!(v > 0)) { const inside = m > 0 && m < 1; return [Math.min(1, Math.max(0, m)), 0, inside ? 1 : 0, m >= 1 ? 1 : 0]; }
    const s = f(Math.sqrt(v)), a = f(-m / s), b = f(f(1 - m) / s);
    let pa = 0, da = 0, pb = 1, qb = 0, db = 0;
    if (a > REACH) pa = 1; else if (!(a < -REACH)) { pa = pq(a)[0]; da = phi(a); }
    if (b < -REACH) { pb = 0; qb = 1; } else if (!(b > REACH)) { const p = pq(b); pb = p[0]; qb = p[1]; db = phi(b); }
    const inside = f(pb - pa), eg = f(f(f(a * pa) + f(da - db)) + f(b * qb));
    const eg2 = f(f(f(f(f(a * a) * pa) + inside) - f(f(b * db) - f(a * da))) + f(f(b * b) * qb));
    return [f(m + f(s * eg)), Math.max(0, f(v * f(eg2 - f(eg * eg)))), inside, qb];
  }
  function reach(cm: V, cv: V): number {
    let state = 0;
    const start = neighbors ? NB_H : START;
    for (let i = 0; i < 3; i++) {
      const top = f(cm[i]! + f(REACH * f(Math.sqrt(Math.max(0, cv[i]!))))), margin = f(f(16 * E) * f(Math.abs(cm[i]!) + Math.abs(top)));
      if (!(top < f(start - margin))) { if (top >= f(start + margin)) return 1; state = 2; }
    }
    return state;
  }
  function tone(mu: V, S: [V, V, V], dmu: V, dsv: V): CpOut {
    const mul = dot(w, mu), sw: V = [dot(S[0], w), dot(S[1], w), dot(S[2], w)], vl = dot(w, sw), sl = vl > 0 ? f(Math.sqrt(vl)) : 0;
    const beta: V = sl > 0 ? [f(sw[0] / vl), f(sw[1] / vl), f(sw[2] / vl)] : [0, 0, 0], skk: V = [S[0][0], S[1][1], S[2][2]];
    const cv = [0, 1, 2].map((i) => Math.max(0, f(skk[i]! - f(beta[i]! * sw[i]!)))) as V;
    const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
    let centre: V = mu.map(clamp01) as V;
    if (mul > 0) { const r = ratio(mul)[0]; centre = mu.map((x) => clamp01(f(x * r))) as V; }
    const t = zero(), second: V = [0, 0, 0], J: [V, V, V] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const dl = f(f(8 * E) * f(Math.abs(mul) + f(9 * sl))), hi = f(mul + f(REACH * sl)), ratioMargin = f(f(64 * E) * f(Math.abs(mul) + sl));
    const fastTest = f(mul - f(f(2 * REACH) * sl)), fastOn = k[K.fast] !== 0, fast = fastOn && (fastTest > 0 || hi < 0);
    if (fastOn && sl > 0 && Math.abs(fastTest) <= ratioMargin) t.flag = true;
    const lo = f(mul - f(REACH * sl)), split = lo < 0 && hi > 0;
    if (sl > 0 && (Math.abs(lo) <= ratioMargin || Math.abs(hi) <= ratioMargin)) t.flag = true;
    let pieces = 1, nodes = 1;
    if (sl > 0) { if (fast) nodes = 8; else { nodes = 64; if (split) pieces = 2; } }
    let count = 0;
    for (let piece = 0; piece < pieces; piece++) {
      let za = -REACH, zb = REACH;
      if (pieces === 2) { if (piece === 0) zb = f(-mul / sl); else za = f(-mul / sl); }
      for (let i = 0; i < nodes; i++) {
        let l = mul, weight = 1;
        if (nodes === 8) { l = f(mul + f(sl * k[K.hermiteX + i]!)); weight = k[K.hermiteW + i]!; }
        else if (nodes === 64) {
          const width = f(f(zb - za) / 4), hw = f(width / 2), z = f(f(za + f(f(Math.floor(i / 16) + 0.5) * width)) + f(hw * k[K.legendreX + (i % 16)]!));
          l = f(mul + f(sl * z)); weight = f(f(hw * k[K.legendreW + (i % 16)]!) * phi(z));
        }
        count = f(count + 1);
        let r = 1, rp = 0, eta = 0;
        if (l > 0) [r, rp, eta] = ratio(l);
        t.ju = Math.max(t.ju, eta);
        for (let c = 0; c < 3; c++) {
          const m = f(mu[c]! + f(beta[c]! * f(l - mul))), q = clip(f(r * m), f(f(r * r) * cv[c]!)), d = f(q[0]! - centre[c]!);
          t.hm[c] = f(t.hm[c]! + f(weight * q[0]!));
          second[c] = f(second[c]! + f(weight * f(q[1]! + f(d * d))));
          const zv = f(f(r * r) * cv[c]!);
          if (zv > 0) {
            const sz = f(Math.sqrt(zv)), b = f(f(1 - f(r * m)) / sz);
            if (!(b > REACH)) t.top = true;
            if (Math.abs(f(b - REACH)) <= f(f(64 * E) * f(REACH + f(Math.abs(f(r * m)) / sz)))) t.flag = true;
          } else if (f(r * m) >= 1) t.top = true;
          const e1 = f(q[0] - q[3]);
          const term = add(scale(unit(c), f(r * q[2])), rp !== 0 ? scale(w, f(f(rp * e1) / r)) : [0, 0, 0]);
          J[c] = add(J[c]!, scale(term, weight));
          const err = f(f(f(f(f(f(CMU * E) * r) * f(Math.sqrt(cv[c]!))) + f(f(0.8 * r) * f(Math.sqrt(f(f(32 * E) * skk[c]!))))) +
            f(f(q[2]! * f(Math.abs(f(rp * m)) + f(r * Math.abs(beta[c]!)))) * dl)) + f(f(Math.abs(q[0]!) * eta) * E));
          t.bm[c] = f(t.bm[c]! + f(weight * err));
          t.bv[c] = f(t.bv[c]! + f(weight * f(f(2 * err) + f(f(f(f(CVU * E) * r) * r) * cv[c]!))));
        }
      }
    }
    const r0 = k[K.ratioAtZero]!;
    if (sl > 0 && r0 !== 1 && Math.abs(mul) < f(REACH * sl)) {
      const density = f(phi(f(mul / sl)) / sl);
      for (let c = 0; c < 3; c++) {
        const m = f(mu[c]! - f(beta[c]! * mul)), below = clip(m, cv[c]!)[0]!;
        let above: number;
        if (r0 > 1e30) above = cv[c]! > 0 ? pq(f(m / f(Math.sqrt(cv[c]!))))[0]! : m > 0 ? 1 : 0;
        else above = clip(f(r0 * m), f(f(r0 * r0) * cv[c]!))[0]!;
        J[c] = add(J[c]!, scale(w, f(density * f(above - below))));
      }
    }
    const shifted = [0, 1, 2].map((c) => f(t.hm[c]! - centre[c]!));
    t.hv = [0, 1, 2].map((c) => Math.max(0, f(second[c]! - f(shifted[c]! * shifted[c]!)))) as V;
    t.a = J;
    for (let c = 0; c < 3; c++) {
      const ak = vabs(J[c]!);
      t.bm[c] = f(f(f(t.bm[c]! + f(f(count * E) * Math.abs(t.hm[c]!))) + dot(ak, dmu)) + f(0.8 * dot(ak, dsv.map((x) => f(Math.sqrt(x))))));
      t.bv[c] = f(f(f(t.bv[c]! + f(f(count * E) * second[c]!)) + f(f(2 * Math.abs(shifted[c]!)) * t.bm[c]!)) + dot(ak.map((x) => f(x * x)), dsv));
    }
    t.ju = f(f(t.ju + f(4 * count)) * E);
    return t;
  }
  interface Node { out: V; t: [V, V, V]; err: V; flag: boolean }
  function develop(c: V): Node {
    const g: V = [k[K.gains]!, k[K.gains + 1]!, k[K.gains + 2]!], lc = k[K.clipLevel]!, u: V = [f(c[0] * g[0]), f(c[1] * g[1]), f(c[2] * g[2])];
    let b: V = [...u];
    const jb: [V, V, V] = [[g[0], 0, 0], [0, g[1], 0], [0, 0, g[2]]];
    const node: Node = { out: [0, 0, 0], t: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], err: [0, 0, 0], flag: false };
    let eb = f(f(8 * E) * Math.max(Math.abs(u[0]), Math.max(Math.abs(u[1]), Math.abs(u[2]))));
    if (neighbors) {
      // #605: nb_rebuild (src/gpu/wgsl-display-view-neighbors.ts).
      const r = api.rho, kept = [c[0] < NB_H, c[1] < NB_H, c[2] < NB_H];
      let e = 1;
      if (!(kept[0] && kept[1] && kept[2]) && !(r[0] < 0)) {
        if (!kept[0] && !kept[1] && !kept[2]) {
          const q = [0, 1, 2].map((i) => (r[i]! > 0 ? f(u[i]! / r[i]!) : 0)), m = sel3(q[0]!, q[1]!, q[2]!);
          b = [f(q[m]! * r[0]), f(q[m]! * r[1]), f(q[m]! * r[2])];
          for (let i = 0; i < 3; i++) jb[i] = r[m]! > 0 ? scale(unit(m), f(f(r[i]! * g[m]!) / r[m]!)) : [0, 0, 0];
          e = 6;
        } else {
          const ku = [0, 1, 2].map((i) => (kept[i] ? u[i]! : 0)), kr = [0, 1, 2].map((i) => (kept[i] ? r[i]! : 0));
          const su = f(f(ku[0]! + ku[1]!) + ku[2]!), sr = f(f(kr[0]! + kr[1]!) + kr[2]!), sc = sr > 0 ? f(su / sr) : 0;
          for (let i = 0; i < 3; i++) {
            const t = f(sc * r[i]!);
            if (!kept[i] && t > u[i]!) { b[i] = t; jb[i] = sr > 0 ? ([0, 1, 2].map((j) => (kept[j] ? f(f(r[i]! * g[j]!) / sr) : 0)) as V) : [0, 0, 0]; }
          }
          e = 10;
        }
      }
      eb = f(f(e * E) * Math.max(Math.abs(b[0]), Math.max(Math.abs(b[1]), Math.abs(b[2]))));
    } else if (!reconstruct) { for (let i = 0; i < 3; i++) if (u[i]! > lc) { b[i] = lc; jb[i]![i] = 0; } }
    else {
      const si = sel3(c[0], c[1], c[2]), s = c[si]!;
      if (s > START) {
        const kk: V = [Math.min(u[0]!, lc), Math.min(u[1]!, lc), Math.min(u[2]!, lc)], ni = sel3(kk[0]!, kk[1]!, kk[2]!), n = kk[ni]!, ns = u[ni]! > lc ? 0 : g[ni]!;
        const t = s >= 1 ? 1 : f(f(s - START) / f(1 - START)), ts = s >= 1 ? 0 : f(1 / f(1 - START));
        b = [0, 1, 2].map((i) => f(f(f(1 - t) * u[i]!) + f(t * n))) as V;
        for (let i = 0; i < 3; i++) jb[i] = add(add(scale(unit(i), f(f(1 - t) * g[i]!)), scale(unit(ni), f(t * ns))), scale(unit(si), f(f(n - u[i]!) * ts)));
      }
    }
    const y: V = [0, 0, 0], ey: V = [0, 0, 0], mj: [V, V, V] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let r = 0; r < 3; r++) {
      const m = mrow(r);
      y[r] = dot(m, b); ey[r] = dot(vabs(m), b.map((x) => f(f(f(3 * E) * Math.abs(x)) + eb)));
      mj[r] = add(add(scale(jb[0], m[0]), scale(jb[1], m[1])), scale(jb[2], m[2]));
    }
    let z: V = [...y], eta = 0;
    const jt: [V, V, V] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (luminance) {
      const l = dot(w, y), el = f(dot(vabs(w), ey) + f(f(4 * E) * dot(vabs(w), vabs(y))));
      if (k[K.ratioAtZero] !== 1 && Math.abs(l) <= el) node.flag = true;
      if (l > 0) {
        const q = ratio(l); eta = q[2];
        z = scale(y, q[0]);
        for (let i = 0; i < 3; i++) jt[i] = add(scale(unit(i), q[0]!), scale(w, f(y[i]! * q[1]!)));
      }
    } else if (k[K.tone] === 1) {
      for (let i = 0; i < 3; i++) if (y[i]! > 0) { z[i] = f(y[i]! / f(1 + y[i]!)); jt[i] = scale(unit(i), f(1 / f(f(1 + y[i]!) * f(1 + y[i]!)))); }
    }
    let ez: V = [0, 1, 2].map((i) => f(dot(vabs(jt[i]!), ey) + f(f(Math.abs(z[i]!) * f(eta + 4)) * E))) as V;
    const jz: [V, V, V] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const ti = sel3(z[0]!, z[1]!, z[2]!), zt = z[ti]!;
    if (desaturate && zt > 1) {
      const lp = dot(w, z);
      if (lp >= 1) { node.out = [1, 1, 1]; return node; }
      const d = f(zt - lp), a = f(f(1 - lp) / d), dd = f(d * d), ut = unit(ti);
      const da = [0, 1, 2].map((j) => f(f(f(-w[j]! * d) - f(f(1 - lp) * f(ut[j]! - w[j]!))) / dd)) as V;
      for (let i = 0; i < 3; i++) jz[i] = add(add(scale(w, f(1 - a)), scale(unit(i), a)), scale(da, f(z[i]! - lp)));
      z = z.map((x) => f(lp + f(a * f(x - lp)))) as V;
      ez = [0, 1, 2].map((i) => f(dot(vabs(jz[i]!), ez) + f(f(8 * E) * f(1 + Math.abs(z[i]!))))) as V;
    }
    node.out = z.map((x) => Math.min(1, Math.max(0, x))) as V;
    node.err = ez;
    const jo: [V, V, V] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++) if (z[i]! > 0 && z[i]! < 1) jo[i] = add(add(scale(jt[0]!, jz[i]![0]!), scale(jt[1]!, jz[i]![1]!)), scale(jt[2]!, jz[i]![2]!));
    for (let i = 0; i < 3; i++) node.t[i] = add(add(scale(mj[0]!, jo[i]![0]!), scale(mj[1]!, jo[i]![1]!)), scale(mj[2]!, jo[i]![2]!));
    return node;
  }
  function chain(cm: V, c00: number, c01: number, c02: number, c11: number, c12: number, c22: number, dcm: V, dcv: V): CpOut {
    const l00 = f(Math.sqrt(Math.max(0, c00))), l10 = l00 > 0 ? f(c01 / l00) : 0, l20 = l00 > 0 ? f(c02 / l00) : 0;
    const l11 = f(Math.sqrt(Math.max(0, f(c11 - f(l10 * l10))))), l21 = l11 > 0 ? f(f(c12 - f(l20 * l10)) / l11) : 0;
    const l22 = f(Math.sqrt(Math.max(0, f(f(c22 - f(l20 * l20)) - f(l21 * l21)))));
    const anyNoise = l00 > 0 || l11 > 0 || l22 > 0, second = l11 > 0 || l21 !== 0 || l22 > 0;
    const n = anyNoise ? k[K.chainPoints]! : 1, nj = second ? n : 1, nk = l22 > 0 ? n : 1;
    const centre = develop(cm).out, t = zero();
    let e: V = [0, 0, 0], q: V = [0, 0, 0], count = 0;
    for (let i = 0; i < n; i++) {
      const x0 = anyNoise ? k[K.chainX + i]! : 0, wi = anyNoise ? k[K.chainW + i]! : 1;
      for (let j = 0; j < nj; j++) {
        const x1 = second ? k[K.chainX + j]! : 0, wj = second ? f(wi * k[K.chainW + j]!) : wi;
        for (let m = 0; m < nk; m++) {
          const x2 = l22 > 0 ? k[K.chainX + m]! : 0, weight = l22 > 0 ? f(wj * k[K.chainW + m]!) : wj;
          const c: V = [f(cm[0] + f(l00 * x0)), f(f(cm[1] + f(l10 * x0)) + f(l11 * x1)), f(f(f(cm[2] + f(l20 * x0)) + f(l21 * x1)) + f(l22 * x2))];
          const spread: V = [Math.abs(f(l00 * x0)), f(Math.abs(f(l10 * x0)) + Math.abs(f(l11 * x1))), f(f(Math.abs(f(l20 * x0)) + Math.abs(f(l21 * x1))) + Math.abs(f(l22 * x2)))];
          const dc = scale(add(vabs(cm), spread), f(3 * E));
          const node = develop(c);
          if (node.flag) t.flag = true;
          if (neighbors) {
            const roots = f(f(f(Math.sqrt(dcv[0])) + f(Math.sqrt(dcv[1]))) + f(Math.sqrt(dcv[2]))), tol = [0, 1, 2].map((i2) => f(f(f(dc[i2]! + dcm[i2]!) + f(5 * roots)) + f(16 * E)));
            if ([0, 1, 2].some((i2) => Math.abs(f(c[i2]! - NB_H)) <= tol[i2]!)) t.flag = true;
          }
          count = f(count + 1);
          const d = [0, 1, 2].map((i2) => f(node.out[i2]! - centre[i2]!));
          e = add(e, scale(node.out, weight));
          q = add(q, scale([f(d[0]! * d[0]!), f(d[1]! * d[1]!), f(d[2]! * d[2]!)], weight));
          for (let r = 0; r < 3; r++) t.a[r] = add(t.a[r]!, scale(node.t[r]!, weight));
          const err = add(node.err, [dot(vabs(node.t[0]), dc), dot(vabs(node.t[1]), dc), dot(vabs(node.t[2]), dc)]);
          t.bm = add(t.bm, scale(err, weight));
          t.bv = add(t.bv, scale(scale(err, weight), 2));
        }
      }
    }
    const shifted = [0, 1, 2].map((i) => f(e[i]! - centre[i]!));
    t.hm = e;
    t.hv = [0, 1, 2].map((i) => Math.max(0, f(q[i]! - f(shifted[i]! * shifted[i]!)))) as V;
    for (let r = 0; r < 3; r++) {
      const row = vabs(t.a[r]!);
      t.bm[r] = f(f(f(t.bm[r]! + f(f(count * E) * Math.abs(e[r]!))) + dot(row, dcm)) + f(0.8 * dot(row, dcv.map((x) => f(Math.sqrt(x))))));
      t.bv[r] = f(f(f(t.bv[r]! + f(f(count * E) * q[r]!)) + f(f(2 * Math.abs(shifted[r]!)) * t.bm[r]!)) + dot(row.map((x) => f(x * x)), dcv));
    }
    t.ju = f(f(f(4 * count) + 64) * E);
    return t;
  }
  const api = { on, luminance, reconstruct, desaturate, neighbors, rho: [0, 0, 0] as V, reach, tone, chain };
  return api;
}

/** #605: the kernels' `nb_skip`, `nb_ratio` and `nb_flag` (src/gpu/wgsl-display-view-neighbors.ts) over the band's flag buffer. */
export function neighborRatioEmulator(flags: Uint32Array, count: number, cp: ReturnType<typeof coupledEmulator>): { skip(i: number): boolean; ratio(i: number, r: number): boolean; flag(): number } {
  const floats = new Float32Array(flags.buffer, flags.byteOffset, flags.length);
  let need = false;
  return {
    skip(i): boolean { need = false; return cp.neighbors && flags[3 * count + i] === 0xfffffffe; },
    ratio(i, r): boolean {
      if (!cp.neighbors) return true;
      const o = flags[3 * count + i]!;
      if (o >= 0xfffffffe) { need = true; return false; }
      cp.rho = [floats[o + 3 * r]!, floats[o + 3 * r + 1]!, floats[o + 3 * r + 2]!];
      return true;
    },
    flag(): number { return need ? 128 : 0; }
  };
}
