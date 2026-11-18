// SPDX-License-Identifier: Apache-2.0
/**
 * #655 (G1): the catalogue-lens passes (src/gpu/wgsl-display-view-lens-kernel.ts) on the fake device, line by line in float32
 * (Math.fround after every operation, round to nearest): the lens lattice (the double-float32 mapping on the Dekker product path,
 * the factor's bound arithmetic and the composite chart kernel's classification), the pre-integrated points and the sites.
 */
import { dwAdd, dwMul, type Dw } from "../../src/gpu/chart-composite-gpu.js";
import { DISPLAY_VIEW_LATTICE } from "../../src/gpu/display-view-composite-material-module.js";
import { DISPLAY_VIEW_QUALITY_GROUP_WORDS } from "../../src/gpu/wgsl-display-view-quality-kernel.js";
import { DISPLAY_VIEW_LENS_MIXED, DISPLAY_VIEW_LENS_PARAMS as P, DISPLAY_VIEW_LENS_POINT_WORDS } from "../../src/gpu/wgsl-display-view-lens-kernel.js";
import { createCompositeMaterialEmulator, nearestBoundOps, type B } from "./fake-webgpu-composite.js";
import { bAdd, bMul, bRounded, bScale, channelOf, nodeTotal, readParams, writeSite, type BoundedValue } from "./fake-webgpu-display-view-quality.js";

const f = Math.fround;
const E = f(2 ** -23), U2 = f(2 ** -48), GROUP = DISPLAY_VIEW_QUALITY_GROUP_WORDS;
const dwSub = (a: Dw, b: Dw): Dw => dwAdd(a, [-b[0], -b[1]]);

/** Pass 1 (`displayViewLensLatticeWgsl`, Dekker's product path). Bindings: 0 params, 1 groups, 2 output; 100 af, 101 ai, 102 the lattice uniform. */
export function emulateLensLattice(pw: Uint32Array, groups: Uint32Array, out: Uint32Array, af: Float32Array, ai: Uint32Array, latticeWords: Uint32Array): void {
  const pf = new Float32Array(pw.buffer, pw.byteOffset, pw.length), gi = new Int32Array(groups.buffer, groups.byteOffset, groups.length), gf = new Float32Array(groups.buffer, groups.byteOffset, groups.length);
  const lf = new Float32Array(latticeWords.buffer, latticeWords.byteOffset, latticeWords.length);
  const material = createCompositeMaterialEmulator(af, ai, "dekker");
  let uncertain: boolean;
  const K = nearestBoundOps(() => { uncertain = true; });
  const { bc, bx, badd, bmul, bdiv, babs, bd, le } = K;
  const k1: Dw = [pf[P.k1Hi]!, pf[P.k1Lo]!], k2: Dw = [pf[P.k2Hi]!, pf[P.k2Lo]!], k3: Dw = [pf[P.k3Hi]!, pf[P.k3Lo]!];
  const scaleOf = (t: Dw): Dw => dwAdd([1, 0], dwMul(t, dwAdd(k1, dwMul(t, dwAdd(k2, dwMul(t, k3))))));
  const slope = (t: number, s: number): number => { const sp = f(k1[0] + f(t * f(f(2 * k2[0]) + f(f(3 * k3[0]) * t)))); return f(s * f(s + f(f(2 * t) * sp))); };
  const div = (a: Dw, b: Dw): Dw => { let q: Dw = [f(a[0] / b[0]), 0]; for (let k = 0; k < 2; k++) { const r = dwSub(a, dwMul(b, q)); q = dwAdd(q, [f(r[0] / b[0]), 0]); } return q; };
  const radial = pw[P.radial] !== 0, vignetting = pw[P.vignetting] !== 0, mm: Dw = [pf[P.mmHi]!, pf[P.mmLo]!], kappa: Dw = [pf[P.kappaHi]!, pf[P.kappaLo]!];
  const placed = latticeWords[DISPLAY_VIEW_LATTICE.placed] !== 0, chartK: Dw = [lf[DISPLAY_VIEW_LATTICE.chartKHi]!, lf[DISPLAY_VIEW_LATTICE.chartKLo]!];
  for (let i = 0; i < pw[P.total]!; i++) {
    let g = 0;
    for (let k = 1; k < pw[P.groups]!; k++) if (i >= groups[k * GROUP + 4]!) g = k;
    const base = g * GROUP, lw = groups[base + 2]!, local = i - groups[base + 4]!;
    const q = gi[base + 1]! + Math.floor(local / lw), p = gi[base]! + (local % lw);
    const x = dwMul([f(p + gf[base + 6]!), 0], mm), y = dwMul([f(q + gf[base + 7]!), 0], mm);
    uncertain = false;
    material.reset();
    // lens_map
    const ix = x, iy: Dw = [-y[0], -y[1]];
    let ux = ix, uy = iy, tB: B = { v: 0, e: 0 }, sB: B = { v: 1, e: 0 }, rel = f(8 * U2);
    if (radial) {
      const d2 = dwMul(dwAdd(dwMul(ix, ix), dwMul(iy, iy)), [pf[P.invRn2Hi]!, pf[P.invRn2Lo]!]);
      if (d2[0] > 0) {
        const s0 = f(1 + f(d2[0] * f(k1[0] + f(d2[0] * f(k2[0] + f(d2[0] * k3[0]))))));
        let t: Dw = [f(d2[0] / f(s0 * s0)), 0];
        for (let k = 0; k < pw[P.steps]!; k++) {
          const s = scaleOf(t), h = dwSub(dwMul(t, dwMul(s, s)), d2);
          t = dwSub(t, [f(h[0] / slope(t[0], s[0])), 0]);
        }
        const s = scaleOf(t), gd = dwMul(t, dwMul(s, s)), h = dwSub(gd, d2), low = f(0.999 * slope(t[0], s[0]));
        if (!(low > 0) || !(t[0] > 0) || !(t[0] <= pf[P.tMax]!)) uncertain = true;
        const dt = f(f(f(Math.abs(h[0]) + Math.abs(h[1])) + f(f(128 * U2) * f(Math.abs(gd[0]) + d2[0]))) / Math.max(low, f(1e-30)));
        const sp = Math.abs(f(k1[0] + f(t[0] * f(f(2 * k2[0]) + f(f(3 * k3[0]) * t[0])))));
        const relS = f(f(f(sp * dt) + f(f(48 * U2) * f(f(sp * t[0]) + 1))) / Math.abs(s[0]));
        tB = { v: t[0], e: f(f(Math.abs(t[1]) + dt) + f(E * t[0])) };
        sB = { v: s[0], e: f(Math.abs(s[1]) + f(relS * Math.abs(s[0]))) };
        rel = f(f(32 * U2) + relS);
        ux = div(ix, s); uy = div(iy, s);
      }
    }
    if (!(rel <= pf[P.pointLimit]!)) uncertain = true;
    let u = dwMul(ux, kappa), v = dwMul(uy, kappa);
    // lens_throughput · lens_area
    let throughput: B = { v: 1, e: 0 };
    if (vignetting) {
      const xb: B = { v: x[0], e: f(Math.abs(x[1]) + f(E * Math.abs(x[0]))) }, yb: B = { v: y[0], e: f(Math.abs(y[1]) + f(E * Math.abs(y[0]))) };
      const r2 = bmul(badd(bmul(xb, xb), bmul(yb, yb)), bc(pf[P.invRv2]!));
      throughput = badd(bx(1), bmul(r2, badd(bc(pf[P.v2]!), bmul(r2, badd(bc(pf[P.v4]!), bmul(r2, bc(pf[P.v6]!)))))));
    }
    let area: B = { v: 1, e: 0 };
    if (radial) {
      const rd = badd(bx(1), bmul(tB, badd(bc(f(3 * k1[0])), bmul(tB, badd(bc(f(5 * k2[0])), bmul(tB, bc(f(7 * k3[0]))))))));
      const tv = Math.abs(tB.v as number), tail = f(tv * f(f(3 * Math.abs(k1[1])) + f(tv * f(f(5 * Math.abs(k2[1])) + f(f(7 * Math.abs(k3[1])) * tv)))));
      area = bdiv(bx(1), bmul(sB, { v: rd.v, e: f(rd.e + tail) }));
    }
    const factor = bmul(throughput, area);
    // lens_material
    let m: number;
    if (placed) {
      u = dwMul(u, chartK); v = dwMul(v, chartK);
      if (!(le(babs(bd(u)), bx(1)) && le(babs(bd(v)), bc(lf[DISPLAY_VIEW_LATTICE.chartAspect]!)))) m = latticeWords[DISPLAY_VIEW_LATTICE.surround]!;
      else m = material.material(u[0], u[1], v[0], v[1]);
    } else m = material.material(u[0], u[1], v[0], v[1]);
    const o = DISPLAY_VIEW_LENS_POINT_WORDS * i, fv = factor.v as number;
    out[o] = (m | ((uncertain || material.flagged || !(fv > 0)) ? 0x80000000 : 0)) >>> 0;
    new Float32Array(out.buffer, out.byteOffset, out.length).set([fv, factor.e], o + 1);
  }
}

/** Pass 1b (`displayViewLensPointsWgsl`). Bindings: 0 params, 1 groups, 2 members, 3 lattice, 4 spectra, 5 points. */
export function emulateLensPoints(pw: Uint32Array, groups: Uint32Array, members: Float32Array, lattice: Uint32Array, spectra: Float32Array, points: Float32Array): void {
  const pi = new Int32Array(pw.buffer, pw.byteOffset, pw.length), gi = new Int32Array(groups.buffer, groups.byteOffset, groups.length), lf = new Float32Array(lattice.buffer, lattice.byteOffset, lattice.length);
  const pu = new Uint32Array(points.buffer, points.byteOffset, points.length);
  const bx0 = pi[0]!, by0 = pi[1]!, bw = pw[2]!, total = pw[3]!, count = pw[4]!, N = pw[5]!, S = N + 3;
  for (let i = 0; i < total; i++) {
    const p = bx0 + (i % bw), q = by0 + Math.floor(i / bw), o = i * S;
    points.fill(0, o, o + N);
    let fbar = 0, rel = 0, first = 0, mixed = false, uncertain = false;
    for (let k = 0; k < count; k++) {
      const base = members[4 * k]! * GROUP, lx = p + members[4 * k + 1]! - gi[base]!, ly = q + members[4 * k + 2]! - gi[base + 1]!;
      const at = 3 * (groups[base + 4]! + ly * groups[base + 2]! + lx), raw = lattice[at]!, fv = lf[at + 1]!, fe = lf[at + 2]!, m = raw & 0x7fffffff;
      if ((raw >>> 31) !== 0) uncertain = true;
      if (k === 0) first = m; else if (m !== first) mixed = true;
      const wf = f(members[4 * k + 3]! * fv);
      fbar = f(fbar + wf);
      rel = Math.max(rel, f(fe / fv));
      for (let n = 0; n < N; n++) points[o + n] = f(points[o + n]! + f(wf * spectra[m * N + n]!));
    }
    pu[o + N] = ((mixed ? DISPLAY_VIEW_LENS_MIXED : first) | (uncertain ? 0x80000000 : 0)) >>> 0;
    points[o + N + 1] = fbar; points[o + N + 2] = rel;
  }
}

/** Pass 2 (`displayViewLensSitesWgsl`). Bindings: 0 params, 1 lens sites, 2 points, 3 kernels, 4 moments, 5 sites, 6 responses, 7 spectra. */
export function emulateLensSites(pw: Uint32Array, ls: Uint32Array, points: Float32Array, kernels: Float32Array, moments: Float32Array, sites: Float32Array, responses: Float32Array, spectra: Float32Array): void {
  const pf = new Float32Array(pw.buffer, pw.byteOffset, pw.length), Pq = readParams(pw, pf), sw = new Uint32Array(sites.buffer, sites.byteOffset, sites.length);
  const li = new Int32Array(ls.buffer, ls.byteOffset, ls.length), lf = new Float32Array(ls.buffer, ls.byteOffset, ls.length), pu = new Uint32Array(points.buffer, points.byteOffset, points.length);
  const R = ls[0]!, T = ls[1]!, Z = ls[2]!, zx0 = ls[3]!, zy0 = ls[4]!, zonesX = ls[5]!, bx0 = li[6]!, by0 = li[7]!, bw = ls[8]!, uniformOn = ls[9] !== 0, members = ls[10]!, gamma = lf[11]!;
  const N = pw[53]!, S = N + 3, w = 2 * R + 1, dark = [Pq.dark0!, Pq.dark1!, Pq.dark2!], partial = new Float32Array(N);
  const pointOf = (x: number, y: number): number => ((y - by0) * bw + (x - bx0)) * S;
  const fbarOf = (x: number, y: number): BoundedValue => { const o = pointOf(x, y) + N, fv = points[o + 1]!; return [fv, f(fv * f(points[o + 2]! + f(f(members + 1) * E)))]; };
  const bSub = (a: BoundedValue, b: BoundedValue): BoundedValue => { const v = f(a[0] - b[0]); return [v, f(f(a[1] + b[1]) + f(E * Math.abs(v)))]; };
  for (let local = 0; local < Pq.count!; local++) {
    const i = Pq.siteFirst! + local, ii = i % Pq.siteW!, jj = Math.floor(i / Pq.siteW!), x = Pq.siteX0! + ii, y = Pq.siteY0! + jj, c = channelOf(x, y);
    const slot = (Math.floor(y / Z) - zy0) * zonesX + (Math.floor(x / Z) - zx0), m0 = pu[pointOf(x, y) + N]!;
    let uniform = uniformOn && R >= 1 && m0 < DISPLAY_VIEW_LENS_MIXED, flag = 0, relf = 0;
    for (let t = 0; t < T; t++) {
      const o = pointOf(x - ((t % w) - R), y - (Math.floor(t / w) - R)) + N, word = pu[o]!;
      if ((word >>> 31) !== 0) flag = 1;
      if (word !== m0) uniform = false;
      relf = Math.max(relf, points[o + 2]!);
    }
    if (uniform) {
      const f0 = fbarOf(x, y), xp = fbarOf(x + 1, y), xm = fbarOf(x - 1, y), yp = fbarOf(x, y + 1), ym = fbarOf(x, y - 1);
      const gx = bScale(bSub(xp, xm), 0.5), gy = bScale(bSub(yp, ym), 0.5), hxx = bAdd(bSub(xp, bScale(f0, 2)), xm), hyy = bAdd(bSub(yp, bScale(f0, 2)), ym);
      const hxy = bScale(bAdd(bSub(bSub(fbarOf(x + 1, y + 1), fbarOf(x - 1, y + 1)), fbarOf(x + 1, y - 1)), fbarOf(x - 1, y - 1)), 0.25);
      const mb = slot * 6 * N;
      let total: BoundedValue = [0, 0];
      for (let n = 0; n < N; n++) {
        const first = bAdd(bAdd(bMul(f0, bRounded(moments[mb + n]!)), bMul(gx, bRounded(moments[mb + N + n]!))), bMul(gy, bRounded(moments[mb + 2 * N + n]!)));
        const second = bAdd(bScale(bAdd(bMul(hxx, bRounded(moments[mb + 3 * N + n]!)), bMul(hyy, bRounded(moments[mb + 4 * N + n]!))), 0.5), bMul(hxy, bRounded(moments[mb + 5 * N + n]!)));
        const la = bMul(bRounded(spectra[(m0 & 0x7fffffff) * N + n]!), bRounded(responses[c * N + n]!));
        total = bAdd(total, bMul(la, bAdd(first, second)));
      }
      const e = bAdd(total, bRounded(dark[c]!));
      writeSite(Pq, sites, sw, i, c, e[0], f(e[1] + Pq.siteTiny!), flag);
      continue;
    }
    partial.fill(0);
    const kb = slot * N * T;
    for (let t = 0; t < T; t++) {
      const o = pointOf(x - ((t % w) - R), y - (Math.floor(t / w) - R));
      for (let n = 0; n < N; n++) partial[n] = f(partial[n]! + f(kernels[kb + n * T + t]! * points[o + n]!));
    }
    for (let n = 0; n < N; n++) partial[n] = f(partial[n]! * responses[c * N + n]!);
    const e = nodeTotal(partial, N, dark[c]!), de = f(f(e * f(gamma + f(relf * f(1 + gamma)))) + Pq.siteTiny!);
    writeSite(Pq, sites, sw, i, c, e, de, flag);
  }
}
