// SPDX-License-Identifier: Apache-2.0

/**
 * #593, #601 (2.22.0): the display view's coupled rendering steps on the GPU, shared by the Speed kernel and the Quality pixel
 * pass: the luminance tone curves by conditioning on luminance (`cp_tone`), and `highlightMode: "reconstruct"` and the
 * desaturation by the 3-D Gauss–Hermite rule over the development chain (`cp_chain`), the float32 forms of
 * src/facade/display-view-rendering.ts with the request's fast or full rule. On demand: a kernel takes this text only for a view
 * that asks for the coupled steps (its pipeline label ends in `+coupled`); every other view takes `DISPLAY_VIEW_COUPLED_STUB_WGSL`.
 *
 * Constants come from the kernel's aux table after its own entries (`cp_k(i)`, which each kernel defines), laid out as
 * `DISPLAY_VIEW_COUPLED` (the host's `displayViewCoupledConstants`). The kernels define `phi` and `pq` (Abramowitz–Stegun) and
 * `CLIP_REACH`; nothing else is shared.
 *
 * Error bounds (first order, float32, E = 2^-23; docs/WEBGPU.md, "Coupled rendering steps"). Every function returns, besides
 * its moments, absolute bounds of the mean and the variance against the float64 reference and the slopes' relative bound:
 * - tone: per node the clipped-normal terms (`CLIP_MEAN_U`·r·σ, `CLIP_VARIANCE_U`·r²·σ²), the conditional variance's
 *   cancellation (0.8·r·√(32·E·Σ_kk)), the node position through the slope and the ratio's relative error (log2 and exp2 per the
 *   WGSL accuracy table, the image-kernel accelerator's tone analysis); then one E per node of the sums;
 * - chain: per node the rounding of the developed pixel (white balance and blend 8E of the largest channel, matrix 3E per term,
 *   tone ratio η, desaturation 8E) carried to the output through the node's own slopes, plus the node point's rounding through
 *   the slopes; then one E per node of the sums. The chain is continuous (clip, blend, maximum and desaturation all are), so a
 *   branch taken differently on either side of a kink moves the output by at most the slope times the input's error;
 * - inputs: the caller's bounds of the means through |slopes|, of the variances through 0.8·|slopes|·√δ.
 * A decision the reference takes on a threshold (the blend's reach, a component reaching 1 with the desaturation, the fast
 * rule's range, a node at L = 0 where the ratio jumps) that the float32 values cannot settle sets the pixel's recompute flag:
 * the host renders that display pixel with the reference.
 */

/** Layout of the coupled-constants buffer (float32 words). */
export const DISPLAY_VIEW_COUPLED = /* @__PURE__ */ Object.freeze({
  on: 0, luminance: 1, tone: 2, a: 3, n: 4, inverseWhite: 5, ratioAtZero: 6, weights: 7, reconstruct: 10, desaturate: 11, fast: 12,
  gains: 13, clipLevel: 16, matrix: 17, chainPoints: 26, chainX: 27, chainW: 43, hermiteX: 59, hermiteW: 67, legendreX: 75, legendreW: 91, size: 107
});
/** The largest finite float32 stands for r(0+) = ∞ (Naka–Rushton below exponent 1). */
export const DISPLAY_VIEW_COUPLED_INFINITE_RATIO = 3.4028234663852886e38;

import { DISPLAY_VIEW_COUPLED_DECLARATIONS_WGSL } from "./wgsl-display-view-coupled-stub.js";

const E_LITERAL = "1.1920928955078125e-7";
const C = DISPLAY_VIEW_COUPLED;

/** The coupled steps (see the module comment). */
export const DISPLAY_VIEW_COUPLED_WGSL = /* wgsl */ `${DISPLAY_VIEW_COUPLED_DECLARATIONS_WGSL}
const CP_E: f32 = ${E_LITERAL};
const CP_CLIP_MEAN_U: f32 = 1400.0;
const CP_CLIP_VARIANCE_U: f32 = 36000.0;
const CP_START: f32 = 0.8;
fn cp_luminance() -> bool { return cp_k(${C.luminance}u) != 0.0; }
fn cp_reconstruct() -> bool { return cp_k(${C.reconstruct}u) != 0.0; }
fn cp_desaturate() -> bool { return cp_k(${C.desaturate}u) != 0.0; }
fn cp_w() -> vec3<f32> { return vec3<f32>(cp_k(${C.weights}u), cp_k(${C.weights + 1}u), cp_k(${C.weights + 2}u)); }
fn cp_m(r: u32) -> vec3<f32> { return vec3<f32>(cp_k(${C.matrix}u + 3u * r), cp_k(${C.matrix + 1}u + 3u * r), cp_k(${C.matrix + 2}u + 3u * r)); }
fn cp_dot(a: vec3<f32>, b: vec3<f32>) -> f32 { return (a.x * b.x + a.y * b.y) + a.z * b.z; }
fn cp_unit(k: u32) -> vec3<f32> { return vec3<f32>(select(0.0, 1.0, k == 0u), select(0.0, 1.0, k == 1u), select(0.0, 1.0, k == 2u)); }
// The tone ratio r(L) = f(L)/L, its slope r′ and its relative bound η in units of E (L > 0).
fn cp_ratio(l: f32) -> vec3<f32> {
  let a = cp_k(${C.a}u);
  if (cp_k(${C.tone}u) == 2.0) { let d = 1.0 + l; return vec3<f32>((1.0 + l * a) / d, (a - 1.0) / (d * d), 16.0); }
  let n = cp_k(${C.n}u);
  let iw = cp_k(${C.inverseWhite}u);
  let lg = log2(a / l);
  let z = n * lg;
  var g = 0.0; var ug = 0.0;
  if (z >= 0.0) { let p = exp2(-z); g = p / (1.0 + p); ug = 1.0 / (1.0 + p); }
  else { let u = exp2(z); g = 1.0 / (1.0 + u); ug = u / (1.0 + u); }
  let dz = n * (8.5 + 3.0 * abs(lg)) + abs(z);
  return vec3<f32>(g * iw / l, g * (n * ug - 1.0) * iw / (l * l), 2.0 * (0.7 * dz + 3.0 + 2.0 * abs(z)) + 24.0);
}
// clip(Z, 0, 1) for Z ~ N(m, v), standardized (cancellation-free): (mean, variance, P(0 < Z < 1), P(Z ≥ 1)).
fn cp_clip(m: f32, v: f32) -> vec4<f32> {
  if (!(v > 0.0)) { let inside = m > 0.0 && m < 1.0; return vec4<f32>(clamp(m, 0.0, 1.0), 0.0, select(0.0, 1.0, inside), select(0.0, 1.0, m >= 1.0)); }
  let s = sqrt(v);
  let a = -m / s;
  let b = (1.0 - m) / s;
  var pa = 0.0; var da = 0.0;
  if (a > CLIP_REACH) { pa = 1.0; } else if (!(a < -CLIP_REACH)) { pa = pq(a).x; da = phi(a); }
  var pb = 1.0; var qb = 0.0; var db = 0.0;
  if (b < -CLIP_REACH) { pb = 0.0; qb = 1.0; } else if (!(b > CLIP_REACH)) { let p = pq(b); pb = p.x; qb = p.y; db = phi(b); }
  let inside = pb - pa;
  let eg = a * pa + (da - db) + b * qb;
  let eg2 = a * a * pa + inside - (b * db - a * da) + b * b * qb;
  return vec4<f32>(m + s * eg, max(0.0, v * (eg2 - eg * eg)), inside, qb);
}
// Whether the reconstruct blend is within reach of channels with means cm and variances cv: 0 no, 1 yes, 2 undecided in float32.
fn cp_reconstruct_reach(cm: vec3<f32>, cv: vec3<f32>) -> u32 {
  var state = 0u;
  for (var k = 0u; k < 3u; k = k + 1u) {
    let top = cm[k] + CLIP_REACH * sqrt(max(0.0, cv[k]));
    let margin = 16.0 * CP_E * (abs(cm[k]) + abs(top));
    if (!(top < CP_START - margin)) { if (top >= CP_START + margin) { return 1u; } state = 2u; }
  }
  return state;
}
fn cp_tone(mu: vec3<f32>, s0: vec3<f32>, s1: vec3<f32>, s2: vec3<f32>, dmu: vec3<f32>, dsv: vec3<f32>) -> CpOut {
  let w = cp_w();
  let mul = cp_dot(w, mu);
  let sw = vec3<f32>(cp_dot(s0, w), cp_dot(s1, w), cp_dot(s2, w));
  let vl = cp_dot(w, sw);
  let sl = select(0.0, sqrt(vl), vl > 0.0);
  var beta = vec3<f32>(0.0);
  if (sl > 0.0) { beta = sw / vl; }
  let skk = vec3<f32>(s0.x, s1.y, s2.z);
  let cv = max(vec3<f32>(0.0), skk - beta * sw);
  var centre = clamp(mu, vec3<f32>(0.0), vec3<f32>(1.0));
  if (mul > 0.0) { centre = clamp(mu * cp_ratio(mul).x, vec3<f32>(0.0), vec3<f32>(1.0)); }
  var t: CpOut;
  var second = vec3<f32>(0.0);
  var j = array<vec3<f32>, 3>(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  let dl = 8.0 * CP_E * (abs(mul) + 9.0 * sl);
  let hi = mul + CLIP_REACH * sl;
  let ratio_margin = 64.0 * CP_E * (abs(mul) + sl);
  // The fast rule's range test and the split at L = 0, as the reference takes them (undecided: recompute).
  let fast_test = mul - 2.0 * CLIP_REACH * sl;
  let fast = cp_k(${C.fast}u) != 0.0 && (fast_test > 0.0 || hi < 0.0);
  if (cp_k(${C.fast}u) != 0.0 && sl > 0.0 && abs(fast_test) <= ratio_margin) { t.flag = true; }
  let split = mul - CLIP_REACH * sl < 0.0 && hi > 0.0;
  if (sl > 0.0 && (abs(mul - CLIP_REACH * sl) <= ratio_margin || abs(hi) <= ratio_margin)) { t.flag = true; }
  var pieces = 1u; var nodes = 1u;
  if (sl > 0.0) { if (fast) { nodes = 8u; } else { nodes = 64u; if (split) { pieces = 2u; } } }
  var count = 0.0;
  for (var piece = 0u; piece < pieces; piece = piece + 1u) {
    var za = -CLIP_REACH; var zb = CLIP_REACH;
    if (pieces == 2u) { if (piece == 0u) { zb = -mul / sl; } else { za = -mul / sl; } }
    for (var i = 0u; i < nodes; i = i + 1u) {
      var l = mul; var weight = 1.0;
      if (nodes == 8u) { l = mul + sl * cp_k(${C.hermiteX}u + i); weight = cp_k(${C.hermiteW}u + i); }
      else if (nodes == 64u) {
        let width = (zb - za) / 4.0;
        let hw = width / 2.0;
        let z = za + (f32(i / 16u) + 0.5) * width + hw * cp_k(${C.legendreX}u + (i % 16u));
        l = mul + sl * z;
        weight = hw * cp_k(${C.legendreW}u + (i % 16u)) * phi(z);
      }
      count = count + 1.0;
      var r = 1.0; var rp = 0.0; var eta = 0.0;
      if (l > 0.0) { let q = cp_ratio(l); r = q.x; rp = q.y; eta = q.z; }
      t.ju = max(t.ju, eta);
      for (var k = 0u; k < 3u; k = k + 1u) {
        let m = mu[k] + beta[k] * (l - mul);
        let c = cp_clip(r * m, r * r * cv[k]);
        let d = c.x - centre[k];
        t.hm[k] = t.hm[k] + weight * c.x;
        second[k] = second[k] + weight * (c.y + d * d);
        // The reference's test of a component reaching 1 (b ≤ 8.5 standard deviations); undecided in float32: recompute.
        let zv = r * r * cv[k];
        if (zv > 0.0) {
          let b = (1.0 - r * m) / sqrt(zv);
          if (!(b > CLIP_REACH)) { t.top = true; }
          if (abs(b - CLIP_REACH) <= 64.0 * CP_E * (CLIP_REACH + abs(r * m) / sqrt(zv))) { t.flag = true; }
        } else if (r * m >= 1.0) { t.top = true; }
        let e1 = c.x - c.w;
        j[k] = j[k] + weight * (cp_unit(k) * (r * c.z) + select(vec3<f32>(0.0), w * (rp * e1 / r), rp != 0.0));
        let err = CP_CLIP_MEAN_U * CP_E * r * sqrt(cv[k]) + 0.8 * r * sqrt(32.0 * CP_E * skk[k]) + c.z * (abs(rp * m) + r * abs(beta[k])) * dl + abs(c.x) * eta * CP_E;
        t.bm[k] = t.bm[k] + weight * err;
        t.bv[k] = t.bv[k] + weight * (2.0 * err + CP_CLIP_VARIANCE_U * CP_E * r * r * cv[k]);
      }
    }
  }
  let r0 = cp_k(${C.ratioAtZero}u);
  if (sl > 0.0 && r0 != 1.0 && abs(mul) < CLIP_REACH * sl) {
    let density = phi(mul / sl) / sl;
    for (var k = 0u; k < 3u; k = k + 1u) {
      let m = mu[k] - beta[k] * mul;
      let below = cp_clip(m, cv[k]).x;
      var above = 0.0;
      if (r0 > 1e30) { if (cv[k] > 0.0) { above = pq(m / sqrt(cv[k])).x; } else { above = select(0.0, 1.0, m > 0.0); } }
      else { above = cp_clip(r0 * m, r0 * r0 * cv[k]).x; }
      j[k] = j[k] + w * (density * (above - below));
    }
  }
  let shifted = t.hm - centre;
  t.hv = max(vec3<f32>(0.0), second - shifted * shifted);
  t.a0 = j[0]; t.a1 = j[1]; t.a2 = j[2];
  for (var k = 0u; k < 3u; k = k + 1u) {
    let ak = abs(j[k]);
    t.bm[k] = t.bm[k] + count * CP_E * abs(t.hm[k]) + cp_dot(ak, dmu) + 0.8 * cp_dot(ak, sqrt(dsv));
    t.bv[k] = t.bv[k] + count * CP_E * second[k] + 2.0 * abs(shifted[k]) * t.bm[k] + cp_dot(ak * ak, dsv);
  }
  t.ju = (t.ju + 4.0 * count) * CP_E;
  return t;
}
// One node of the development chain at camera channels c: the rendered pixel, the slopes ∂out/∂c (rows), the rounding bound
// per component (before the node point's own rounding) and whether a luminance at 0 makes the ratio's jump undecided.
struct CpNode { out: vec3<f32>, t0: vec3<f32>, t1: vec3<f32>, t2: vec3<f32>, err: vec3<f32>, flag: bool };
fn cp_develop(c: vec3<f32>) -> CpNode {
  let g = vec3<f32>(cp_k(${C.gains}u), cp_k(${C.gains + 1}u), cp_k(${C.gains + 2}u));
  let lc = cp_k(${C.clipLevel}u);
  let u = c * g;
  var b = u;
  var jb = array<vec3<f32>, 3>(vec3<f32>(g.x, 0.0, 0.0), vec3<f32>(0.0, g.y, 0.0), vec3<f32>(0.0, 0.0, g.z));
  var node: CpNode;
  if (!cp_reconstruct()) {
    for (var k = 0u; k < 3u; k = k + 1u) { if (u[k] > lc) { b[k] = lc; jb[k][k] = 0.0; } }
  } else {
    let s = select(select(c.z, c.y, c.y > c.z), select(c.z, c.x, c.x > c.z), c.x > c.y);
    if (s > CP_START) {
      let si = select(select(2u, 1u, c.y > c.z), select(2u, 0u, c.x > c.z), c.x > c.y);
      let kk = min(u, vec3<f32>(lc));
      let n = select(select(kk.z, kk.y, kk.y > kk.z), select(kk.z, kk.x, kk.x > kk.z), kk.x > kk.y);
      let ni = select(select(2u, 1u, kk.y > kk.z), select(2u, 0u, kk.x > kk.z), kk.x > kk.y);
      let ns = select(g[ni], 0.0, u[ni] > lc);
      let t = select((s - CP_START) / (1.0 - CP_START), 1.0, s >= 1.0);
      let ts = select(1.0 / (1.0 - CP_START), 0.0, s >= 1.0);
      b = (1.0 - t) * u + t * n;
      for (var k = 0u; k < 3u; k = k + 1u) {
        var row = cp_unit(k) * ((1.0 - t) * g[k]);
        row = row + cp_unit(ni) * (t * ns) + cp_unit(si) * ((n - u[k]) * ts);
        jb[k] = row;
      }
    }
  }
  let eb = 8.0 * CP_E * max(abs(u.x), max(abs(u.y), abs(u.z)));
  var y = vec3<f32>(0.0); var ey = vec3<f32>(0.0);
  var mj = array<vec3<f32>, 3>(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  for (var r = 0u; r < 3u; r = r + 1u) {
    let m = cp_m(r);
    y[r] = cp_dot(m, b);
    ey[r] = cp_dot(abs(m), 3.0 * CP_E * abs(b) + vec3<f32>(eb));
    mj[r] = m.x * jb[0] + m.y * jb[1] + m.z * jb[2];
  }
  // Tone (luminance curve, positive Reinhard or identity).
  var z = y;
  var jt = array<vec3<f32>, 3>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
  var eta = 0.0;
  let w = cp_w();
  if (cp_luminance()) {
    let l = cp_dot(w, y);
    let el = cp_dot(abs(w), ey) + 4.0 * CP_E * cp_dot(abs(w), abs(y));
    if (cp_k(${C.ratioAtZero}u) != 1.0 && abs(l) <= el) { node.flag = true; }
    if (l > 0.0) {
      let q = cp_ratio(l);
      eta = q.z;
      z = y * q.x;
      for (var k = 0u; k < 3u; k = k + 1u) { jt[k] = cp_unit(k) * q.x + w * (y[k] * q.y); }
    }
  } else if (cp_k(${C.tone}u) == 1.0) {
    for (var k = 0u; k < 3u; k = k + 1u) { if (y[k] > 0.0) { z[k] = y[k] / (1.0 + y[k]); jt[k] = cp_unit(k) / ((1.0 + y[k]) * (1.0 + y[k])); } }
  }
  var ez = vec3<f32>(0.0);
  for (var k = 0u; k < 3u; k = k + 1u) { ez[k] = cp_dot(abs(jt[k]), ey) + abs(z[k]) * (eta + 4.0) * CP_E; }
  // Desaturation toward the luminance (#601).
  var jz = array<vec3<f32>, 3>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
  let ti = select(select(2u, 1u, z.y > z.z), select(2u, 0u, z.x > z.z), z.x > z.y);
  let zt = z[ti];
  if (cp_desaturate() && zt > 1.0) {
    let lp = cp_dot(w, z);
    if (lp >= 1.0) {
      node.out = vec3<f32>(1.0);
      node.err = vec3<f32>(0.0);
      return node;
    }
    let d = zt - lp;
    let a = (1.0 - lp) / d;
    for (var k = 0u; k < 3u; k = k + 1u) {
      let da = (-w * d - (1.0 - lp) * (cp_unit(ti) - w)) / (d * d);
      jz[k] = w * (1.0 - a) + cp_unit(k) * a + (z[k] - lp) * da;
    }
    z = lp + a * (z - lp);
    var ez2 = vec3<f32>(0.0);
    for (var k = 0u; k < 3u; k = k + 1u) { ez2[k] = cp_dot(abs(jz[k]), ez) + 8.0 * CP_E * (1.0 + abs(z[k])); }
    ez = ez2;
  }
  node.out = clamp(z, vec3<f32>(0.0), vec3<f32>(1.0));
  node.err = ez;
  var jo = array<vec3<f32>, 3>(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0));
  for (var k = 0u; k < 3u; k = k + 1u) {
    if (z[k] > 0.0 && z[k] < 1.0) { jo[k] = jz[k].x * jt[0] + jz[k].y * jt[1] + jz[k].z * jt[2]; }
  }
  node.t0 = jo[0].x * mj[0] + jo[0].y * mj[1] + jo[0].z * mj[2];
  node.t1 = jo[1].x * mj[0] + jo[1].y * mj[1] + jo[1].z * mj[2];
  node.t2 = jo[2].x * mj[0] + jo[2].y * mj[1] + jo[2].z * mj[2];
  return node;
}
fn cp_chain(cm: vec3<f32>, c00: f32, c01: f32, c02: f32, c11: f32, c12: f32, c22: f32, dcm: vec3<f32>, dcv: vec3<f32>) -> CpOut {
  let l00 = sqrt(max(0.0, c00));
  let l10 = select(0.0, c01 / l00, l00 > 0.0);
  let l20 = select(0.0, c02 / l00, l00 > 0.0);
  let l11 = sqrt(max(0.0, c11 - l10 * l10));
  let l21 = select(0.0, (c12 - l20 * l10) / l11, l11 > 0.0);
  let l22 = sqrt(max(0.0, c22 - l20 * l20 - l21 * l21));
  let any_noise = l00 > 0.0 || l11 > 0.0 || l22 > 0.0;
  let second_axis = l11 > 0.0 || l21 != 0.0 || l22 > 0.0;
  let n = select(1u, u32(cp_k(${C.chainPoints}u)), any_noise);
  let nj = select(1u, n, second_axis);
  let nk = select(1u, n, l22 > 0.0);
  let centre = cp_develop(cm).out;
  var t: CpOut;
  var e = vec3<f32>(0.0); var q = vec3<f32>(0.0); var count = 0.0;
  for (var i = 0u; i < n; i = i + 1u) {
    let x0 = select(0.0, cp_k(${C.chainX}u + i), any_noise);
    let wi = select(1.0, cp_k(${C.chainW}u + i), any_noise);
    for (var jj = 0u; jj < nj; jj = jj + 1u) {
      let x1 = select(0.0, cp_k(${C.chainX}u + jj), second_axis);
      let wj = select(wi, wi * cp_k(${C.chainW}u + jj), second_axis);
      for (var kk = 0u; kk < nk; kk = kk + 1u) {
        let x2 = select(0.0, cp_k(${C.chainX}u + kk), l22 > 0.0);
        let weight = select(wj, wj * cp_k(${C.chainW}u + kk), l22 > 0.0);
        let c = vec3<f32>(cm.x + l00 * x0, cm.y + l10 * x0 + l11 * x1, cm.z + l20 * x0 + l21 * x1 + l22 * x2);
        let dc = 3.0 * CP_E * (abs(cm) + vec3<f32>(abs(l00 * x0), abs(l10 * x0) + abs(l11 * x1), abs(l20 * x0) + abs(l21 * x1) + abs(l22 * x2)));
        let node = cp_develop(c);
        if (node.flag) { t.flag = true; }
        count = count + 1.0;
        let d = node.out - centre;
        e = e + weight * node.out;
        q = q + weight * (d * d);
        t.a0 = t.a0 + weight * node.t0; t.a1 = t.a1 + weight * node.t1; t.a2 = t.a2 + weight * node.t2;
        let err = node.err + vec3<f32>(cp_dot(abs(node.t0), dc), cp_dot(abs(node.t1), dc), cp_dot(abs(node.t2), dc));
        t.bm = t.bm + weight * err;
        t.bv = t.bv + 2.0 * (weight * err);
      }
    }
  }
  let shifted = e - centre;
  t.hm = e;
  t.hv = max(vec3<f32>(0.0), q - shifted * shifted);
  let rows = array<vec3<f32>, 3>(abs(t.a0), abs(t.a1), abs(t.a2));
  for (var k = 0u; k < 3u; k = k + 1u) {
    t.bm[k] = t.bm[k] + count * CP_E * abs(e[k]) + cp_dot(rows[k], dcm) + 0.8 * cp_dot(rows[k], sqrt(dcv));
    t.bv[k] = t.bv[k] + count * CP_E * q[k] + 2.0 * abs(shifted[k]) * t.bm[k] + cp_dot(rows[k] * rows[k], dcv);
  }
  t.ju = (4.0 * count + 64.0) * CP_E;
  return t;
}
`;

/** The host's coupled-constants buffer of a view (`DISPLAY_VIEW_COUPLED` layout), or the one-word stub buffer. */
export function displayViewCoupledConstants(setup: {
  gains: readonly number[]; clipLevel: number; matrix: readonly (readonly number[])[];
  rendering?: { toneCurve: string; toneCurveParameters?: { whiteLuminance: number } | { exponent: number; semiSaturation: number; whiteLuminance: number }; highlightMode: string; gamutHandling: string; fast: boolean };
  coupled?: { chainRule: { x: Float64Array; w: Float64Array }; luminanceRule: { x: Float64Array; w: Float64Array }; ratioAtZero: number; luminanceTone: boolean };
}, weights: readonly number[], legendre: { x: ArrayLike<number>; w: ArrayLike<number> }): Float32Array<ArrayBuffer> {
  const r = setup.rendering, k = setup.coupled;
  if (!r || !k) return new Float32Array(1);
  const out = new Float32Array(C.size), p = r.toneCurveParameters;
  out[C.on] = 1; out[C.luminance] = k.luminanceTone ? 1 : 0;
  out[C.tone] = r.toneCurve === "extended-reinhard-luminance" ? 2 : r.toneCurve === "naka-rushton-luminance" ? 3 : r.toneCurve === "positive-reinhard-per-channel" ? 1 : 0;
  if (p && "exponent" in p) {
    out[C.a] = p.semiSaturation; out[C.n] = p.exponent; out[C.inverseWhite] = 1 + (p.semiSaturation / p.whiteLuminance) ** p.exponent;
  } else if (p) out[C.a] = 1 / (p.whiteLuminance * p.whiteLuminance);
  out[C.ratioAtZero] = k.ratioAtZero === Infinity ? DISPLAY_VIEW_COUPLED_INFINITE_RATIO : k.ratioAtZero;
  out.set(weights, C.weights);
  out[C.reconstruct] = r.highlightMode === "reconstruct" ? 1 : 0; out[C.desaturate] = r.gamutHandling === "desaturate-to-luminance" ? 1 : 0; out[C.fast] = r.fast ? 1 : 0;
  out.set(setup.gains, C.gains); out[C.clipLevel] = setup.clipLevel; out.set(setup.matrix.flat(), C.matrix);
  out[C.chainPoints] = k.chainRule.x.length; out.set(k.chainRule.x, C.chainX); out.set(k.chainRule.w, C.chainW);
  out.set(k.luminanceRule.x, C.hermiteX); out.set(k.luminanceRule.w, C.hermiteW);
  out.set(Array.from(legendre.x), C.legendreX); out.set(Array.from(legendre.w), C.legendreW);
  return out;
}
