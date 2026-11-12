// SPDX-License-Identifier: Apache-2.0
/**
 * Float32 JavaScript emulation (Math.fround after every operation; correctly rounded exp and sqrt) of the display view's
 * Speed kernel (`DISPLAY_VIEW_SPEED_KERNEL_WGSL`, src/gpu/wgsl-display-view-speed-kernel.ts), for the in-process fake
 * WebGPU device. It mirrors the WGSL line by line; the material module is an emulator object (`ChartMaterialEmulator`
 * for the chart presets). Real-device conformance lives in test/webgpu.
 */
import { DISPLAY_VIEW_AUX, DISPLAY_VIEW_CLIP_MEAN_U, DISPLAY_VIEW_CLIP_VARIANCE_U, DISPLAY_VIEW_GEOMETRY_STRIDE, DISPLAY_VIEW_OUTPUT_FLOATS,
  DISPLAY_VIEW_SITE_RELATIVE_U } from "../../src/gpu/wgsl-display-view-speed-kernel.js";
import type { ChartMaterialEmulator } from "./fake-webgpu-stages.js";
import { coupledEmulator, neighborRatioEmulator } from "./fake-webgpu-display-view-coupled.js";

const f = Math.fround;
const E = f(2 ** -23), REACH = 8.5, CM = f(DISPLAY_VIEW_CLIP_MEAN_U), CV = f(DISPLAY_VIEW_CLIP_VARIANCE_U), STRIDE = DISPLAY_VIEW_GEOMETRY_STRIDE;
const PHI_C = f(0.3989422804014327), AS = [f(0.2316419), f(0.319381530), f(-0.356563782), f(1.781477937), f(-1.821255978), f(1.330274429)];

const phi = (z: number): number => f(PHI_C * f(Math.exp(f(f(f(-0.5) * z) * z))));
function pq(z: number): [number, number] {
  const x = Math.abs(z), t = f(1 / f(1 + f(AS[0]! * x)));
  const q = f(f(phi(x) * t) * f(AS[1]! + f(t * f(AS[2]! + f(t * f(AS[3]! + f(t * f(AS[4]! + f(t * AS[5]!)))))))));
  return z >= 0 ? [f(1 - q), q] : [q, f(1 - q)];
}
/** #533: `clip_state` of the kernels: 0 certainly below white, 1 certainly at or above it, 2 undecided. */
export function clipState(m: number, dm: number, v: number, dv: number, reach2: number): number {
  const gap = f(1 - m), wide = f(f(4 * reach2) * f(v + f(2 * dv))), below = f(gap - f(2 * dm)), above = f(gap + f(2 * dm));
  if (below > 0 && f(below * below) > wide) return 0;
  if (above < 0 && f(above * above) > wide) return 1;
  return 2;
}
function upperClip(m: number, v: number, top: number): [number, number, number] {
  if (!(v > 0)) return [Math.min(m, top), 0, m < top ? 1 : 0];
  const s = f(Math.sqrt(v)), z = f(f(top - m) / s);
  if (z > REACH) return [m, v, 1];
  if (z < -REACH) return [top, 0, 0];
  const [P, Q] = pq(z), d = phi(z), delta = f(d - f(z * Q)), mean = f(m - f(s * delta));
  const ratio = f(f(f(P - f(z * d)) + f(f(z * z) * Q)) - f(delta * delta));
  return [mean, f(v * Math.max(0, ratio)), P];
}
function unitClip(m: number, v: number, skewness: number): [number, number, number] {
  if (!(v > 0)) return [Math.min(1, Math.max(0, m)), 0, m > 0 && m < 1 ? 1 : 0];
  const s = f(Math.sqrt(v)), a = f(-m / s), b = f(f(1 - m) / s);
  if (a < -REACH && b > REACH) return [m, v, 1];
  let pa = 0, da = 0, pb = 1, qb = 0, db = 0;
  if (!(a < -REACH)) { pa = pq(a)[0]; da = phi(a); }
  if (!(b > REACH)) { const p = pq(b); pb = p[0]; qb = p[1]; db = phi(b); }
  const inside = f(pb - pa), gamma = Math.min(1, Math.max(-1, skewness)), aa = f(a * da), bb = f(b * db);
  const eg = f(f(f(a * pa) + f(da - db)) + f(b * qb));
  const eg2 = f(f(f(f(f(a * a) * pa) + inside) - f(bb - aa)) + f(f(b * b) * qb));
  const normalMean = f(m + f(s * eg));
  let mean = normalMean, shift = 0;
  if (gamma !== 0) { shift = f(f(f(s * gamma) / 6) * f(aa - bb)); mean = f(normalMean + shift); }
  return [mean, Math.max(0, f(f(v * f(eg2 - f(eg * eg))) - f(shift * f(f(2 * normalMean) + shift)))), inside];
}
function reinhardMoments(m: number, v: number, aux: Float32Array): [number, number, number] {
  if (!(v > 0)) return m > 0 ? [f(m / f(1 + m)), 0, f(1 / f(f(1 + m) * f(1 + m)))] : [0, 0, 0];
  const s = f(Math.sqrt(v)), zlo = Math.max(f(-m / s), -REACH);
  if (!(REACH > zlo)) return [0, 0, 0];
  const hm = m > 0 ? f(m / f(1 + m)) : 0, zwidth = f(f(REACH - zlo) / 4);
  let e1 = 0, e2 = 0, ed = 0;
  for (let p = 0; p < 4; p++) {
    const zc = f(zlo + f(f(p + 0.5) * zwidth)), zhalf = f(zwidth / 2);
    for (let k = 0; k < 16; k++) {
      const z = f(zc + f(zhalf * aux[DISPLAY_VIEW_AUX.gaussLegendre + k]!)), x = f(m + f(s * z));
      const weight = f(f(zhalf * aux[DISPLAY_VIEW_AUX.gaussLegendre + 16 + k]!) * phi(z)), h = f(x / f(1 + x));
      e1 = f(e1 + f(weight * h));
      e2 = f(e2 + f(f(weight * f(h - hm)) * f(h - hm)));
      ed = f(ed + f(weight / f(f(1 + x) * f(1 + x))));
    }
  }
  const shifted = f(e1 - hm);
  return [e1, Math.max(0, f(e2 - f(shifted * shifted))), ed];
}

/** Mirrors `main` of the display-view Speed kernel for the `count` display pixels of the band. */
export function emulateDisplayViewSpeed(pw: Uint32Array, pf: Float32Array, aux: Float32Array, geometry: Float32Array, table: Float32Array, out: Float32Array,
  flags: Uint32Array, material: ChartMaterialEmulator, coupledConstants: Float32Array = new Float32Array(1), neighbors = false): void {
  const cp = coupledEmulator(coupledConstants, neighbors);
  const nb = neighborRatioEmulator(flags, pw[0]!, cp);
  const [count, row0, regionW, , , margin, nativeW, nativeH, columns, tone, offsets] = Array.from(pw.subarray(0, 11)) as number[];
  const k = [pf[12]!, pf[13]!, pf[14]!], reach2 = pf[15]!, dark = [pf[16]!, pf[17]!, pf[18]!], L = pf[19]!, c0 = [pf[20]!, pf[21]!, pf[22]!], g = [pf[24]!, pf[25]!, pf[26]!];
  const M = Array.from(pf.subarray(28, 37)), scaleU = pf[37]!, scaleV = pf[38]!, geometryInts = new Int32Array(geometry.buffer, geometry.byteOffset, geometry.length);
  const reinhard = tone === 1;
  const reflectX = (x: number): number => (x < 0 ? -x : x >= nativeW! ? 2 * nativeW! - 2 - x : x), reflectY = (y: number): number => (y < 0 ? -y : y >= nativeH! ? 2 * nativeH! - 2 - y : y);
  const channelOf = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
  const siteMean = new Float32Array(64), siteVar = new Float32Array(64), siteThird = new Float32Array(64), siteBound = new Float32Array(64), siteClip = new Uint8Array(64);
  const SITE_U = f(DISPLAY_VIEW_SITE_RELATIVE_U);
  const nodes = pw[11]!;
  const materialSignal = (m: number, c: number): number => {
    let s = 0, b = 0;
    for (let k = 0; k < nodes; k++) {
      b = f(b + f(table[c * nodes + k]! * table[(3 + m) * nodes + k]!));
      if ((k & 15) === 15) { s = f(s + b); b = 0; }
    }
    return f(s + b);
  };
  const siteElectrons = (x: number, y: number, c: number): number => {
    let sum = 0, last = -1, value = 0;
    const fx = f(x), fy = f(y);
    for (let o = 0; o < offsets!; o++) {
      const base = DISPLAY_VIEW_AUX.offsets + 4 * o;
      const u = f(f(fx + aux[base]!) * scaleU), v = f(f(fy + aux[base + 1]!) * scaleV);
      if (material.value) value = material.value(u, v, c);
      else {
        const m = material.material(u, v);
        if (m !== last) { value = materialSignal(m, c); last = m; }
      }
      sum = f(sum + f(aux[base + 2]! * value));
    }
    return sum;
  };
  const cm = new Float32Array(3), cvv = new Float32Array(3), cth = new Float32Array(3), csv = new Float32Array(3), cb = new Float32Array(3);
  const bm = new Float32Array(3), bv = new Float32Array(3), bs = new Float32Array(3), bbm = new Float32Array(3), bbv = new Float32Array(3);
  const hm = new Float32Array(3), hv = new Float32Array(3), hs = new Float32Array(3), hbm = new Float32Array(3), hbv = new Float32Array(3);
  for (let i = 0; i < count!; i++) {
    if (nb.skip(i)) continue;
    material.reset();
    const rx = i % regionW!, ry = row0! + Math.floor(i / regionW!), col = rx * STRIDE, row = (columns! + ry) * STRIDE;
    const colFirst = geometryInts[col]!, nx = geometryInts[col + 1]!, rowFirst = geometryInts[row]!, ny = geometryInts[row + 1]!;
    const x0 = colFirst + margin! - 1, y0 = rowFirst + margin! - 1, windowW = nx + 2;
    for (let sj = 0; sj < ny + 2; sj++) {
      const sy = reflectY(y0 + sj);
      for (let si = 0; si < windowW; si++) {
        const sx = reflectX(x0 + si), c = channelOf(sx, sy), e = f(siteElectrons(sx, sy, c) + dark[c]!), kc = k[c]!;
        const mean = f(kc * e), variance = f(f(f(kc * kc) * e) + c0[c]!), gap = f(1 - mean), slot = sj * windowW + si;
        siteThird[slot] = f(f(f(kc * kc) * kc) * e);
        siteClip[slot] = clipState(mean, f(f(SITE_U * E) * mean), variance, f(f(SITE_U * E) * variance), reach2);
        if (gap > 0 && f(gap * gap) > f(reach2 * variance)) { siteMean[slot] = mean; siteVar[slot] = variance; siteBound[slot] = 0; }
        else { const [cm0, cv0] = upperClip(mean, variance, 1); siteMean[slot] = cm0; siteVar[slot] = cv0; siteBound[slot] = f(Math.sqrt(variance)); }
      }
    }
    const G = (at: number): number => geometry[at]!;
    const xbE = G(col + 8), xbO = G(col + 9), xppE = G(col + 10), xppO = G(col + 11), xqqE = G(col + 12), xqqO = G(col + 13), xpqE = G(col + 14), xpqO = G(col + 15);
    const ybE = G(row + 8), ybO = G(row + 9), yppE = G(row + 10), yppO = G(row + 11), yqqE = G(row + 12), yqqO = G(row + 13), ypqE = G(row + 14), ypqO = G(row + 15);
    const green = (xpp: number, xqq: number, xpq: number, ypp: number, yqq: number, ypq: number): number =>
      f(f(f(f(f(f(xpp * ypp) + f(xqq * ypp)) + f(xpp * yqq)) + f(f(2 * xpq) * ypp)) + f(f(2 * xpp) * ypq)) + f(f(2 * xpq) * ypq));
    const b = [f(xbE * ybE), f(green(xppO, xqqO, xpqO, yppE, yqqE, ypqE) + green(xppE, xqqE, xpqE, yppO, yqqO, ypqO)), f(xbO * ybO)];
    let coupledFlag = false;
    let s0 = 0, s1 = 0, s2 = 0, c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0, r0 = 0, r1 = 0, r2 = 0, boundMean = 0, boundVar = 0, mask0 = 0, mask1 = 0, undecided = false;
    for (let j = 0; j < ny; j++) {
      const ay = G(row + 2 + j);
      for (let ii = 0; ii < nx; ii++) {
        const aj = f(G(col + 2 + ii) * ay), x = colFirst + ii + margin!, y = rowFirst + j + margin!, phase = (y & 1) * 2 + (x & 1);
        let clipped = false, nearWhite = false;
        for (let c = 0; c < 3; c++) {
          let mean = 0, variance = 0, third = 0, bnd = 0;
          const taps = DISPLAY_VIEW_AUX.taps + (phase * 3 + c) * 16;
          for (let t = 0; t < 4; t++) {
            const w = aux[taps + 4 * t + 2]!, slot = (j + 1 + aux[taps + 4 * t + 1]!) * windowW + ii + 1 + aux[taps + 4 * t]!;
            mean = f(mean + f(w * siteMean[slot]!)); variance = f(variance + f(f(w * w) * siteVar[slot]!)); third = f(third + f(f(f(w * w) * w) * siteThird[slot]!));
            bnd = Math.max(bnd, w !== 0 ? siteBound[slot]! : 0);
            if (w !== 0) { if (siteClip[slot] === 1) clipped = true; else if (siteClip[slot] === 2) nearWhite = true; }
          }
          cm[c] = mean; cvv[c] = variance; cth[c] = third; cb[c] = bnd; csv[c] = f(variance * aux[DISPLAY_VIEW_AUX.inverseW2 + phase * 3 + c]!);
        }
        // #593: reconstruct's reach (the chain), and the unclipped white balance out of it.
        let chainRun = false;
        if (cp.on && cp.reconstruct) { const reach = cp.reach([cm[0]!, cm[1]!, cm[2]!], [cvv[0]!, cvv[1]!, cvv[2]!]); if (reach === 2) coupledFlag = true; chainRun = reach >= 1; }
        const unclipped = cp.on && cp.reconstruct;
        if (clipped) { const bit = j * nx + ii; if (bit < 32) mask0 = (mask0 | (1 << bit)) >>> 0; else mask1 = (mask1 | (1 << (bit - 32))) >>> 0; }
        else if (nearWhite) undecided = true;
        for (let c = 0; c < 3; c++) {
          const gc = g[c]!, um = f(gc * cm[c]!), uv = f(f(gc * gc) * cvv[c]!), gap = f(L - um);
          bbm[c] = f(f(gc * CM) * cb[c]!); bbv[c] = f(f(f(f(gc * gc) * CV) * cb[c]!) * cb[c]!);
          if (unclipped || (gap > 0 && f(gap * gap) > f(reach2 * uv))) { bm[c] = um; bv[c] = uv; bs[c] = gc; }
          else { const [m1, v1, p1] = upperClip(um, uv, L); bm[c] = m1; bv[c] = v1; bs[c] = f(gc * p1); bbm[c] = f(bbm[c]! + f(CM * f(Math.sqrt(uv)))); bbv[c] = f(bbv[c]! + f(CV * uv)); }
        }
        for (let comp = 0; comp < 3; comp++) {
          const r0m = M[comp * 3]!, r1m = M[comp * 3 + 1]!, r2m = M[comp * 3 + 2]!;
          const mean = f(f(f(r0m * bm[0]!) + f(r1m * bm[1]!)) + f(r2m * bm[2]!));
          const variance = f(f(f(f(r0m * r0m) * bv[0]!) + f(f(r1m * r1m) * bv[1]!)) + f(f(r2m * r2m) * bv[2]!));
          let bmC = f(f(f(Math.abs(r0m) * bbm[0]!) + f(Math.abs(r1m) * bbm[1]!)) + f(Math.abs(r2m) * bbm[2]!));
          let bvC = f(f(f(f(r0m * r0m) * bbv[0]!) + f(f(r1m * r1m) * bbv[1]!)) + f(f(r2m * r2m) * bbv[2]!));
          if (!reinhard && mean > 0 && mean < 1 && f(mean * mean) > f(reach2 * variance) && f(f(1 - mean) * f(1 - mean)) > f(reach2 * variance)) { hm[comp] = mean; hv[comp] = variance; hs[comp] = 1; }
          else if (reinhard) {
            const [m1, v1, d1] = reinhardMoments(mean, variance, aux); hm[comp] = m1; hv[comp] = v1; hs[comp] = d1;
            bmC = f(bmC + f(f(2 * CM) * f(Math.sqrt(variance)))); bvC = f(bvC + f(f(2 * CV) * variance));
          } else {
            const k0 = f(r0m * bs[0]!), k1 = f(r1m * bs[1]!), k2 = f(r2m * bs[2]!);
            const third = f(f(f(f(f(k0 * k0) * k0) * cth[0]!) + f(f(f(k1 * k1) * k1) * cth[1]!)) + f(f(f(k2 * k2) * k2) * cth[2]!));
            const skew = variance > 0 ? f(third / f(variance * f(Math.sqrt(variance)))) : 0;
            const [m1, v1, d1] = unitClip(mean, variance, skew); hm[comp] = m1; hv[comp] = v1; hs[comp] = d1;
            bmC = f(bmC + f(f(2 * CM) * f(Math.sqrt(variance)))); bvC = f(bvC + f(f(2 * CV) * variance));
          }
          hbm[comp] = bmC; hbv[comp] = bvC;
        }
        // #593, #601: the coupled steps (cp_tone, cp_chain) as the kernel takes them.
        let jm: number[][] | null = null, ju = 0;
        if (cp.on) {
          if (!chainRun && cp.luminance) {
            const mu = [0, 0, 0], dmu = [0, 0, 0], dsv = [0, 0, 0], srow = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (let r = 0; r < 3; r++) {
              mu[r] = f(f(f(M[r * 3]! * bm[0]!) + f(M[r * 3 + 1]! * bm[1]!)) + f(M[r * 3 + 2]! * bm[2]!));
              dmu[r] = f(f(f(f(Math.abs(M[r * 3]!) * bbm[0]!) + f(Math.abs(M[r * 3 + 1]!) * bbm[1]!)) + f(Math.abs(M[r * 3 + 2]!) * bbm[2]!)) * E);
              dsv[r] = f(f(f(f(f(M[r * 3]! * M[r * 3]!) * bbv[0]!) + f(f(M[r * 3 + 1]! * M[r * 3 + 1]!) * bbv[1]!)) + f(f(M[r * 3 + 2]! * M[r * 3 + 2]!) * bbv[2]!)) * E);
              for (let q = 0; q < 3; q++) srow[r]![q] = f(f(f(f(M[r * 3]! * M[q * 3]!) * bv[0]!) + f(f(M[r * 3 + 1]! * M[q * 3 + 1]!) * bv[1]!)) + f(f(M[r * 3 + 2]! * M[q * 3 + 2]!) * bv[2]!));
            }
            const t = cp.tone(mu as [number, number, number], srow as [[number, number, number], [number, number, number], [number, number, number]], dmu as [number, number, number], dsv as [number, number, number]);
            if (t.flag) coupledFlag = true;
            if (cp.desaturate && t.top) chainRun = true;
            else {
              jm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
              for (let comp = 0; comp < 3; comp++) {
                hm[comp] = t.hm[comp]!; hv[comp] = t.hv[comp]!; hbm[comp] = f(t.bm[comp]! / E); hbv[comp] = f(t.bv[comp]! / E);
                const row = t.a[comp]!;
                for (let c = 0; c < 3; c++) jm[comp]![c] = f(f(f(f(row[0] * M[c]!) + f(row[1] * M[3 + c]!)) + f(row[2] * M[6 + c]!)) * bs[c]!);
              }
              ju = f(t.ju / E);
            }
          } else if (!chainRun && cp.desaturate && tone !== 1) {
            for (let comp = 0; comp < 3; comp++) {
              const top = f(hm[comp]! + f(REACH * f(Math.sqrt(hv[comp]!))));
              if (hm[comp]! > 0 && top >= f(0.999)) chainRun = true;
              if (hm[comp]! > 0 && f(hm[comp]! - f(f(2 * hbm[comp]!) * E)) < f(0.999) && Math.abs(f(top - f(0.999))) <= f(f(2 * f(f(hbm[comp]! * E) + f(REACH * Math.min(f(Math.sqrt(f(hbv[comp]! * E))), f(f(hbv[comp]! * E) / f(2 * f(Math.sqrt(hv[comp]!)))))))) + f(64 * E))) coupledFlag = true;
            }
          }
          if (chainRun && nb.ratio(i, j * nx + ii)) {
            const dcm = [0, 1, 2].map((c) => f(f(CM * cb[c]!) * E)) as [number, number, number];
            const dcv = [0, 1, 2].map((c) => f(f(f(CV * cb[c]!) * cb[c]!) * E)) as [number, number, number];
            const t = cp.chain([cm[0]!, cm[1]!, cm[2]!], cvv[0]!, 0, 0, cvv[1]!, 0, cvv[2]!, dcm, dcv);
            if (t.flag) coupledFlag = true;
            jm = t.a.map((r) => [...r]);
            for (let comp = 0; comp < 3; comp++) { hm[comp] = t.hm[comp]!; hv[comp] = t.hv[comp]!; hbm[comp] = f(t.bm[comp]! / E); hbv[comp] = f(t.bv[comp]! / E); }
            ju = f(t.ju / E);
          }
        }
        s0 = f(s0 + f(aj * hm[0]!)); s1 = f(s1 + f(aj * hm[1]!)); s2 = f(s2 + f(aj * hm[2]!));
        let l0 = 0, l1 = 0, l2 = 0, lb0 = 0, lb1 = 0, lb2 = 0;
        for (let c = 0; c < 3; c++) {
          const a0 = jm ? jm[0]![c]! : f(f(hs[0]! * M[c]!) * bs[c]!), a1 = jm ? jm[1]![c]! : f(f(hs[1]! * M[3 + c]!) * bs[c]!),
            a2 = jm ? jm[2]![c]! : f(f(hs[2]! * M[6 + c]!) * bs[c]!), wgt = f(f(aj * b[c]!) * csv[c]!);
          const vb = f(bbv[c]! + f(f(2 * ju) * cvv[c]!));
          c00 = f(c00 + f(f(wgt * a0) * a0)); c01 = f(c01 + f(f(wgt * a0) * a1)); c02 = f(c02 + f(f(wgt * a0) * a2));
          c11 = f(c11 + f(f(wgt * a1) * a1)); c12 = f(c12 + f(f(wgt * a1) * a2)); c22 = f(c22 + f(f(wgt * a2) * a2));
          l0 = f(l0 + f(f(a0 * a0) * cvv[c]!)); l1 = f(l1 + f(f(a1 * a1) * cvv[c]!)); l2 = f(l2 + f(f(a2 * a2) * cvv[c]!));
          lb0 = f(lb0 + f(f(a0 * a0) * vb)); lb1 = f(lb1 + f(f(a1 * a1) * vb)); lb2 = f(lb2 + f(f(a2 * a2) * vb));
          boundVar = f(boundVar + f(f(f(aj * b[c]!) * f(vb * aux[DISPLAY_VIEW_AUX.inverseW2 + phase * 3 + c]!)) * Math.max(f(a0 * a0), Math.max(f(a1 * a1), f(a2 * a2)))));
        }
        r0 = f(r0 + f(f(aj * aj) * Math.max(0, f(hv[0]! - l0)))); r1 = f(r1 + f(f(aj * aj) * Math.max(0, f(hv[1]! - l1)))); r2 = f(r2 + f(f(aj * aj) * Math.max(0, f(hv[2]! - l2))));
        boundMean = f(boundMean + f(aj * Math.max(hbm[0]!, Math.max(hbm[1]!, hbm[2]!))));
        boundVar = f(boundVar + f(f(aj * aj) * f(Math.max(hbv[0]!, Math.max(hbv[1]!, hbv[2]!)) + Math.max(lb0, Math.max(lb1, lb2)))));
      }
    }
    const o = i * DISPLAY_VIEW_OUTPUT_FLOATS;
    out[o] = s0; out[o + 1] = s1; out[o + 2] = s2; out[o + 3] = f(c00 + r0); out[o + 4] = f(c11 + r1); out[o + 5] = f(c22 + r2);
    out[o + 6] = c01; out[o + 7] = c02; out[o + 8] = c12; out[o + 9] = f(boundMean * E); out[o + 10] = f(boundVar * E);
    flags[3 * i] = (material.flagged || coupledFlag ? 1 : 0) | (undecided ? 2 : 0) | nb.flag(); flags[3 * i + 1] = mask0; flags[3 * i + 2] = mask1;
  }
}
/** Internal test hooks. */
export const _upperClip = upperClip, _unitClip = unitClip, _reinhardMoments = reinhardMoments;
