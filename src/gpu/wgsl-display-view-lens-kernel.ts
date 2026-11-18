// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernels of the display view's catalogue-lens path on the GPU (#655, chunk G1): passes 1 and 2 of the Quality path
 * (`wgsl-display-view-quality-kernel.ts`) for a still camera behind a catalogue lens, whose sites read a field-dependent PSF.
 * Pass 3 (the display pixels) is the Quality kernel's own. The float64 reference is the lens signal of
 * `facade/display-view-lens-signal.ts` (its `psfSite`): site = Σ_n A_c(λ_n)·Σ_t K_{z,n}(t)·B(x − t)[n], with K_{z,n} the PSF of the
 * site's field zone at node n and B(p)[n] = Σ_o w_o·F(p + o)·L_{m(p + o)}(λ_n) the spectral radiance of lattice point p pre-integrated
 * over the query offsets with each point's field factor F. No cache holds a channel response summed over the spectrum: the
 * response A_c enters per node, per site, when the site is read.
 *
 * 1. **Lens lattice** (`displayViewLensLatticeWgsl`): one invocation per lattice point of each lattice group (the Quality path's
 *    group windows): the sensor point (p + c)·p_mm in double-float32 (c = 0.5 + f − W/2, exact in float32), the inverse radial
 *    distortion by Newton steps on t = r² (h(t) = t·s(t)² − d², s(t) = 1 + k1·t + k2·t² + k3·t³; the start r₀ = d/s(d) of
 *    `radial-distortion-newton.ts`), the ideal point x/s(t), the rectilinear plane point κ·x_ideal with κ = D/(p_d·m) (scene distance,
 *    projection distance, metres per frame unit), and the composite chart kernel's classification of that point
 *    (`material`, #477) with its uncertainty flag; the field factor F = T(ρ²)·1/(s·(s + 2t·s′)) (vignetting throughput times the
 *    distortion area factor) in bound arithmetic. Three words per point: material (flag in bit 31), F, F's absolute bound.
 * 2. **Pre-integration** (`DISPLAY_VIEW_LENS_POINTS_WGSL`): one invocation per point of the band's B window (its sites widened by the
 *    kernel radius): B[n], the material every offset read (0x7fffffff when they differ), F̄ = Σ_o w_o·F and the largest relative
 *    bound of the factors read.
 * 3. **Sites** (`DISPLAY_VIEW_LENS_SITES_WGSL`): one invocation per native site: the zone's kernels per node over the (2R + 1)² taps,
 *    the channel response per node, the integer sum of the node partials and the dark electrons (EXACT_SUM_WGSL), then the Quality
 *    path's readout moments (`write_site`). With `uniform_windows` (the CPU's fast method `lens.catalogue/view-uniform-window`) a site
 *    whose taps all read one material takes the CPU's second-order form Σ_n L_m·A_c·(F̄₀·S_n + ∇F̄·M_n + ½·Σ H_ij·M_ij,n), evaluated in
 *    bound arithmetic: the GPU takes the same method at the same sites as the reference.
 *
 * **The point's bound.** The composite kernel takes a double-float32 point within DW = 2⁻⁴⁰ of the exact point, relative (its `bd`).
 * The mapping's double-float32 operations each carry at most 7u² relative (u = 2⁻²⁴; Joldes, Muller and Popescu, "Tight and rigorous
 * error bounds for basic building blocks of double-word arithmetic", ACM TOMS 44(2), 2017: 3u² for the sum, 7u² for the product with
 * Dekker's or the fma TwoProduct), and the quotient two corrections of a float32 quotient. The kernel bounds the root of the Newton
 * steps a posteriori: |t − t*| ≤ (|h(t)| + ε_h)/(0.999·h′(t)) with ε_h = 128u²·(|t·s²| + d²), the evaluation error of h; the scale's
 * relative error is then |s′|·|t − t*|/s plus 48u²·(|s′|·t + 1) (its Horner evaluation, the error of d²); the point adds 32u² (the
 * sensor point, the two corrections of the quotient, κ). A point whose bound exceeds `point_limit` (2⁻⁴¹, half the composite
 * kernel's allowance) is flagged, and the host resolves its material with the reference's own float64 lookup. The reference's own
 * rounding is the composite kernel's SLACK (10⁻¹⁴ relative to the decision value plus one).
 *
 * **The site's bound.** Every term of the full sum is non-negative: K (host-rounded, E/2), B (its products, the offsets' sum and
 * the factor's relative bound), the product (E), the taps' sum (taps − 1 additions), the response (E/2, E), the exact node sum (E)
 * and the dark electrons (E/2): (taps + members + 8)·E (`gamma`) plus the factors' largest relative bound, times the electrons, plus
 * `site_tiny` (what a device that flushes below the float32 normal range can drop). The uniform form is mixed-sign and carries the
 * bound arithmetic of the Quality kernels (`b_add`, `b_mul`, first order; the host doubles the pixel's bounds).
 *
 * Precision assumptions are those of the Quality kernels (the W3C WGSL accuracy table: + − × one rounding, division 2.5 ULP), and
 * the double-float32 arithmetic runs behind the composite kernel's rounding barrier on the product path its device probe chose.
 *
 * This module and its host (`display-view-lens-gpu.ts`) are part of the on-demand Quality chunk (#594): they load with the Quality
 * kernels, whose parameters, `write_site` and exact sum they share.
 */

import { chartCompositeMaterialWgsl } from "./display-view-composite-material-module.js";
import type { ChartCompositeProductPath } from "./wgsl-chart-composite-kernel.js";
import { DISPLAY_VIEW_QUALITY_COMMON_WGSL, DISPLAY_VIEW_QUALITY_GROUP_WORDS, DISPLAY_VIEW_QUALITY_MAXIMUM_NODES, DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL,
  DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE } from "./wgsl-display-view-quality-kernel.js";
import { EXACT_SUM_WGSL } from "./wgsl-exact-sum.js";

/** Words per lattice point of the lens lattice pass: material (flag in bit 31), field factor F (f32), F's absolute bound (f32). */
export const DISPLAY_VIEW_LENS_POINT_WORDS = 3;
/** Words of the lens lattice uniform (`LensParams`). */
export const DISPLAY_VIEW_LENS_PARAM_WORDS = 24;
/** Words of the pre-integration uniform (`PointParams`) and of the sites uniform (`LensSites`). */
export const DISPLAY_VIEW_LENS_POINT_PARAM_WORDS = 8;
export const DISPLAY_VIEW_LENS_SITE_PARAM_WORDS = 12;
/** Newton steps of the lens lattice pass before its a-posteriori bound (quadratic convergence needs 4 to 6 from r₀ on the catalogue profiles). */
export const DISPLAY_VIEW_LENS_NEWTON_STEPS = 6;
/** The point bound above which the lens lattice pass flags a point (2⁻⁴¹ relative: half the composite kernel's DW). */
export const DISPLAY_VIEW_LENS_POINT_LIMIT = 2 ** -41;
/** The material word of a pre-integrated point whose offsets read different materials. */
export const DISPLAY_VIEW_LENS_MIXED = 0x7fffffff;

/** Layout of `LensParams` (word indices). */
export const DISPLAY_VIEW_LENS_PARAMS = /* @__PURE__ */ Object.freeze({ total: 0, groups: 1, radial: 2, vignetting: 3, mmHi: 4, mmLo: 5, invRn2Hi: 6, invRn2Lo: 7,
  k1Hi: 8, k1Lo: 9, k2Hi: 10, k2Lo: 11, k3Hi: 12, k3Lo: 13, kappaHi: 14, kappaLo: 15, tMax: 16, invRv2: 17, v2: 18, v4: 19, v6: 20, pointLimit: 21, steps: 22 });

/**
 * Pass 1 for a device's double-float32 product path: the composite kernel's classification (its common part, records at @group(1)
 * bindings 0 and 1, and its `lattice` uniform at binding 2 for the placement and the rounding barrier's zero) and the lens mapping.
 */
export function displayViewLensLatticeWgsl(path: ChartCompositeProductPath): string {
  return /* wgsl */ `
const E: f32 = 1.1920928955078125e-7;
const SLACK: f32 = 1e-14;
${chartCompositeMaterialWgsl(path)}
const U2: f32 = 3.552713678800501e-15;
const LENS_GROUP: u32 = ${DISPLAY_VIEW_QUALITY_GROUP_WORDS}u;
struct LensParams {
  total: u32, groups: u32, radial: u32, vignetting: u32,
  mm_h: f32, mm_l: f32, inv_rn2_h: f32, inv_rn2_l: f32,
  k1_h: f32, k1_l: f32, k2_h: f32, k2_l: f32,
  k3_h: f32, k3_l: f32, kappa_h: f32, kappa_l: f32,
  t_max: f32, inv_rv2: f32, v2: f32, v4: f32,
  v6: f32, point_limit: f32, steps: u32, pad: u32,
};
@group(0) @binding(0) var<uniform> lens: LensParams;
@group(0) @binding(1) var<storage, read> lens_groups: array<u32>;
@group(0) @binding(2) var<storage, read_write> lens_out: array<u32>;
// a / b in double-float32: a float32 quotient and two corrections from the double-float32 remainder.
fn d_div(a: D, b: D) -> D {
  var q = D(ob(a.h / b.h), 0.0);
  for (var k = 0u; k < 2u; k = k + 1u) {
    let r = d_sub(a, d_mul(b, q));
    q = d_add(q, D(ob(r.h / b.h), 0.0));
  }
  return q;
}
// s(t) = 1 + k1·t + k2·t² + k3·t³ (Horner).
fn lens_scale(t: D) -> D {
  let k1 = D(lens.k1_h, lens.k1_l);
  let k2 = D(lens.k2_h, lens.k2_l);
  let k3 = D(lens.k3_h, lens.k3_l);
  return d_add(D(1.0, 0.0), d_mul(t, d_add(k1, d_mul(t, d_add(k2, d_mul(t, k3))))));
}
// h'(t) = s·(s + 2t·s'(t)) in float32 (a Newton step's slope and the bound's denominator).
fn lens_slope(t: f32, s: f32) -> f32 {
  let sp = lens.k1_h + t * (2.0 * lens.k2_h + 3.0 * lens.k3_h * t);
  return s * (s + 2.0 * t * sp);
}
struct LensPoint { u: D, v: D, t: B, s: B, rel: f32 }
// The plane point (frame units, +v up) of sensor point (x, y) mm (+y down), and the root t = r² with the scale s, both bounded.
fn lens_map(x: D, y: D) -> LensPoint {
  var out: LensPoint;
  let ix = x;
  let iy = d_neg(y);
  var ux = ix;
  var uy = iy;
  out.t = B(0.0, 0.0);
  out.s = B(1.0, 0.0);
  out.rel = 8.0 * U2;
  if (lens.radial != 0u) {
    let d2 = d_mul(d_add(d_mul(ix, ix), d_mul(iy, iy)), D(lens.inv_rn2_h, lens.inv_rn2_l));
    if (d2.h > 0.0) {
      let s0 = 1.0 + d2.h * (lens.k1_h + d2.h * (lens.k2_h + d2.h * lens.k3_h));
      var t = D(d2.h / (s0 * s0), 0.0);
      for (var k = 0u; k < lens.steps; k = k + 1u) {
        let s = lens_scale(t);
        let h = d_sub(d_mul(t, d_mul(s, s)), d2);
        t = d_sub(t, D(ob(h.h / lens_slope(t.h, s.h)), 0.0));
      }
      let s = lens_scale(t);
      let g = d_mul(t, d_mul(s, s));
      let h = d_sub(g, d2);
      let low = 0.999 * lens_slope(t.h, s.h);
      if (!(low > 0.0) || !(t.h > 0.0) || !(t.h <= lens.t_max)) { material_uncertain = true; }
      let dt = (abs(h.h) + abs(h.l) + 128.0 * U2 * (abs(g.h) + d2.h)) / max(low, 1e-30);
      let sp = abs(lens.k1_h + t.h * (2.0 * lens.k2_h + 3.0 * lens.k3_h * t.h));
      let rel_s = (sp * dt + 48.0 * U2 * (sp * t.h + 1.0)) / abs(s.h);
      out.t = B(t.h, abs(t.l) + dt + E * t.h);
      out.s = B(s.h, abs(s.l) + rel_s * abs(s.h));
      out.rel = 32.0 * U2 + rel_s;
      ux = d_div(ix, s);
      uy = d_div(iy, s);
    }
  }
  if (!(out.rel <= lens.point_limit)) { material_uncertain = true; }
  let kappa = D(lens.kappa_h, lens.kappa_l);
  out.u = d_mul(ux, kappa);
  out.v = d_mul(uy, kappa);
  return out;
}
// F = T·A: the vignetting throughput 1 + v2·ρ² + v4·ρ⁴ + v6·ρ⁶ at the sensor point (ρ² = |x|²/R_v²) and the distortion area factor
// 1/(s·(1 + 3k1·t + 5k2·t² + 7k3·t³)), in bound arithmetic.
fn lens_area(t: B, s: B) -> B {
  if (lens.radial == 0u) { return B(1.0, 0.0); }
  let rd = badd(bx(1.0), bmul(t, badd(bc(3.0 * lens.k1_h), bmul(t, badd(bc(5.0 * lens.k2_h), bmul(t, bc(7.0 * lens.k3_h)))))));
  // The coefficients' low parts (the host's float64 values beyond float32) as an absolute term of the derivative.
  let tail = abs(t.v) * (3.0 * abs(lens.k1_l) + abs(t.v) * (5.0 * abs(lens.k2_l) + 7.0 * abs(lens.k3_l) * abs(t.v)));
  return bdiv(bx(1.0), bmul(s, B(rd.v, rd.e + tail)));
}
fn lens_throughput(x: D, y: D) -> B {
  if (lens.vignetting == 0u) { return B(1.0, 0.0); }
  let xb = B(x.h, abs(x.l) + E * abs(x.h));
  let yb = B(y.h, abs(y.l) + E * abs(y.h));
  let r2 = bmul(badd(bmul(xb, xb), bmul(yb, yb)), bc(lens.inv_rv2));
  return badd(bx(1.0), bmul(r2, badd(bc(lens.v2), bmul(r2, badd(bc(lens.v4), bmul(r2, bc(lens.v6)))))));
}
fn lens_material(u0: D, v0: D) -> u32 {
  var u = u0;
  var v = v0;
  if (lattice.placed != 0u) {
    let k = D(lattice.chart_k_hi, lattice.chart_k_lo);
    u = d_mul(u, k);
    v = d_mul(v, k);
    if (!(le(babs(bd(u)), bx(1.0)) && le(babs(bd(v)), bc(lattice.chart_aspect)))) { return lattice.surround; }
  }
  return material(vec4<f32>(u.h, u.l, v.h, v.l));
}
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let i = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (i >= lens.total) { return; }
  var g = 0u;
  for (var k = 1u; k < lens.groups; k = k + 1u) { if (i >= lens_groups[k * LENS_GROUP + 4u]) { g = k; } }
  let base = g * LENS_GROUP;
  let lx0 = bitcast<i32>(lens_groups[base]);
  let ly0 = bitcast<i32>(lens_groups[base + 1u]);
  let lw = lens_groups[base + 2u];
  let local = i - lens_groups[base + 4u];
  let q = ly0 + i32(local / lw);
  let p = lx0 + i32(local % lw);
  // The lattice constants are exact in float32 (the host's check), so these sums are exact.
  let sx = f32(p) + bitcast<f32>(lens_groups[base + 6u]);
  let sy = f32(q) + bitcast<f32>(lens_groups[base + 7u]);
  let mm = D(lens.mm_h, lens.mm_l);
  let x = d_mul(D(sx, 0.0), mm);
  let y = d_mul(D(sy, 0.0), mm);
  material_uncertain = false;
  let mapped = lens_map(x, y);
  let factor = bmul(lens_throughput(x, y), lens_area(mapped.t, mapped.s));
  let m = lens_material(mapped.u, mapped.v);
  let o = ${DISPLAY_VIEW_LENS_POINT_WORDS}u * i;
  lens_out[o] = m | select(0u, 0x80000000u, material_uncertain || !(factor.v > 0.0));
  lens_out[o + 1u] = bitcast<u32>(factor.v);
  lens_out[o + 2u] = bitcast<u32>(factor.e);
}
`;
}

/** Pass 1b: the pre-integrated spectral radiance of every point of the band's B window (see the module comment). */
export const DISPLAY_VIEW_LENS_POINTS_WGSL = /* wgsl */ `
const LENS_GROUP: u32 = ${DISPLAY_VIEW_QUALITY_GROUP_WORDS}u;
struct PointParams { bx0: i32, by0: i32, bw: u32, total: u32, members: u32, nodes: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> pp: PointParams;
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(2) var<storage, read> members: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> lattice: array<u32>;
@group(0) @binding(4) var<storage, read> spectra: array<f32>;
@group(0) @binding(5) var<storage, read_write> points: array<f32>;
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let i = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (i >= pp.total) { return; }
  let N = pp.nodes;
  let S = N + 3u;
  let p = pp.bx0 + i32(i % pp.bw);
  let q = pp.by0 + i32(i / pp.bw);
  let o = i * S;
  for (var n = 0u; n < N; n = n + 1u) { points[o + n] = 0.0; }
  var fbar = 0.0;
  var rel = 0.0;
  var first_material = 0u;
  var mixed = false;
  var uncertain = false;
  for (var k = 0u; k < pp.members; k = k + 1u) {
    let member = members[k];
    let base = u32(member.x) * LENS_GROUP;
    let lx = p + i32(member.y) - bitcast<i32>(groups[base]);
    let ly = q + i32(member.z) - bitcast<i32>(groups[base + 1u]);
    let idx = 3u * (groups[base + 4u] + u32(ly) * groups[base + 2u] + u32(lx));
    let raw = lattice[idx];
    let f = bitcast<f32>(lattice[idx + 1u]);
    let fe = bitcast<f32>(lattice[idx + 2u]);
    let m = raw & 0x7fffffffu;
    if ((raw >> 31u) != 0u) { uncertain = true; }
    if (k == 0u) { first_material = m; } else if (m != first_material) { mixed = true; }
    let wf = member.w * f;
    fbar = fbar + wf;
    rel = max(rel, fe / f);
    let l = m * N;
    for (var n = 0u; n < N; n = n + 1u) { points[o + n] = points[o + n] + wf * spectra[l + n]; }
  }
  let word = select(first_material, ${DISPLAY_VIEW_LENS_MIXED}u, mixed) | select(0u, 0x80000000u, uncertain);
  points[o + N] = bitcast<f32>(word);
  points[o + N + 1u] = fbar;
  points[o + N + 2u] = rel;
}
`;

/** Pass 2: the site electrons through the zone's PSF, the readout moments and the white clip (see the module comment). */
export const DISPLAY_VIEW_LENS_SITES_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}
struct LensSites {
  radius: u32, taps: u32, zone: u32, zone_x0: u32,
  zone_y0: u32, zones_x: u32, bx0: i32, by0: i32,
  bw: u32, uniform_windows: u32, members: u32, gamma: f32,
};
@group(0) @binding(1) var<uniform> ls: LensSites;
@group(0) @binding(2) var<storage, read> points: array<f32>;
@group(0) @binding(3) var<storage, read> kernels: array<f32>;
@group(0) @binding(4) var<storage, read> moments: array<f32>;
@group(0) @binding(5) var<storage, read_write> sites: array<f32>;
@group(0) @binding(6) var<storage, read> responses: array<f32>;
@group(0) @binding(7) var<storage, read> spectra: array<f32>;
${EXACT_SUM_WGSL}
${DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL}
alias Nodes = array<f32, ${DISPLAY_VIEW_QUALITY_MAXIMUM_NODES}>;
fn point_of(x: i32, y: i32) -> u32 { return (u32(y - ls.by0) * ls.bw + u32(x - ls.bx0)) * (params.nodes + 3u); }
// F̄ of a point with its absolute bound: the factors' largest relative bound plus the offsets' sum.
fn fbar_of(x: i32, y: i32) -> vec2<f32> {
  let o = point_of(x, y) + params.nodes;
  let f = points[o + 1u];
  return vec2<f32>(f, f * (points[o + 2u] + (f32(ls.members) + 1.0) * E));
}
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let local = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (local >= params.count) { return; }
  let i = params.site_first + local;
  let ii = i % params.site_w;
  let jj = i / params.site_w;
  let x = params.site_x0 + i32(ii);
  let y = params.site_y0 + i32(jj);
  let c = channel_of(x, y);
  let N = params.nodes;
  let R = i32(ls.radius);
  let w = 2 * R + 1;
  let T = ls.taps;
  let slot = (u32(y) / ls.zone - ls.zone_y0) * ls.zones_x + (u32(x) / ls.zone - ls.zone_x0);
  let m0 = bitcast<u32>(points[point_of(x, y) + N]);
  var uni = ls.uniform_windows != 0u && R >= 1 && m0 < ${DISPLAY_VIEW_LENS_MIXED}u;
  var flag = 0u;
  var relf = 0.0;
  for (var t = 0u; t < T; t = t + 1u) {
    let o = point_of(x - (i32(t) % w - R), y - (i32(t) / w - R)) + N;
    let word = bitcast<u32>(points[o]);
    if ((word >> 31u) != 0u) { flag = 1u; }
    if (word != m0) { uni = false; }
    relf = max(relf, points[o + 2u]);
  }
  if (uni) {
    // The CPU's second-order form: F̄(x − t) ≈ F̄₀ + ∇F̄·d + ½·dᵀHd, the derivatives by central differences of the neighbouring points.
    let f0 = fbar_of(x, y);
    let xp = fbar_of(x + 1, y);
    let xm = fbar_of(x - 1, y);
    let yp = fbar_of(x, y + 1);
    let ym = fbar_of(x, y - 1);
    let gx = b_scale(b_sub(xp, xm), 0.5);
    let gy = b_scale(b_sub(yp, ym), 0.5);
    let hxx = b_add(b_sub(xp, b_scale(f0, 2.0)), xm);
    let hyy = b_add(b_sub(yp, b_scale(f0, 2.0)), ym);
    let hxy = b_scale(b_add(b_sub(b_sub(fbar_of(x + 1, y + 1), fbar_of(x - 1, y + 1)), fbar_of(x + 1, y - 1)), fbar_of(x - 1, y - 1)), 0.25);
    let mb = slot * 6u * N;
    var total = vec2<f32>(0.0, 0.0);
    for (var n = 0u; n < N; n = n + 1u) {
      let first = b_add(b_add(b_mul(f0, b_rounded(moments[mb + n])), b_mul(gx, b_rounded(moments[mb + N + n]))), b_mul(gy, b_rounded(moments[mb + 2u * N + n])));
      let second = b_add(b_scale(b_add(b_mul(hxx, b_rounded(moments[mb + 3u * N + n])), b_mul(hyy, b_rounded(moments[mb + 4u * N + n]))), 0.5),
        b_mul(hxy, b_rounded(moments[mb + 5u * N + n])));
      let la = b_mul(b_rounded(spectra[(m0 & 0x7fffffffu) * N + n]), b_rounded(responses[c * N + n]));
      total = b_add(total, b_mul(la, b_add(first, second)));
    }
    let e = b_add(total, b_rounded(dark_of(c)));
    write_site(i, c, e.x, e.y + params.site_tiny, flag);
    return;
  }
  var partial: Nodes;
  let kb = slot * N * T;
  for (var t = 0u; t < T; t = t + 1u) {
    let o = point_of(x - (i32(t) % w - R), y - (i32(t) / w - R));
    for (var n = 0u; n < N; n = n + 1u) { partial[n] = partial[n] + kernels[kb + n * T + t] * points[o + n]; }
  }
  for (var n = 0u; n < N; n = n + 1u) { partial[n] = partial[n] * responses[c * N + n]; }
  let dark = dark_of(c);
  var anchor = exact_exponent(dark);
  for (var n = 0u; n < N; n = n + 1u) { if (partial[n] > 0.0) { anchor = max(anchor, exact_exponent(partial[n])); } }
  var sum: ExactSum;
  sum.anchor = anchor;
  for (var n = 0u; n < N; n = n + 1u) { exact_add(&sum, partial[n]); }
  exact_add(&sum, dark);
  let e = exact_round(&sum);
  let de = e * (ls.gamma + relf * (1.0 + ls.gamma)) + params.site_tiny;
  write_site(i, c, e, de, flag);
}
`;
