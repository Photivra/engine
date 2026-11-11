// SPDX-License-Identifier: Apache-2.0

/**
 * The image-plane print in the GPU display view's Quality passes (#581): diffraction kernels, the defocus disc, the anti-aliasing
 * filter's spots and AHD for a photo, loaded with the image-plane GPU module (only after `prepareImagePlaneScenes()`). Passes 1
 * and 2 are the print's own; pass 3 (the display pixels) and the host finishing are the Quality renderer's, unchanged.
 *
 * **What the reference computes** (expected-signal.ts, the radiance path): with site kernels, per site of channel c,
 * Σ_g Σ_d Σ_n C_n,c(d)·L_n(p_g + d), where L_n(p) is the print's spectral radiance at spectral node n at lattice point p (the
 * provider's `radianceAt` on the lattice formula) and C_n,c(d) the reference's combined kernel per node (`perNode` of its
 * tables: Σ_members w·A_c(λ_n)·K_n(t)); without kernels, per query offset w·Σ_n A_c(λ_n)·L_n(p_o), the same value as the direct
 * path's `signalAt`.
 *
 * **Pass 1 (lattice radiance).** One invocation per lattice point of each group: the exact point (p + c)·g in double-float32
 * (p + c is exact in float32, checked by the Quality host; the scale's hi + lo from float64), the print-local point, the print's
 * edge in the composite kernel's bound arithmetic, the pixel coordinates, the bilinear weights as the Speed module forms them,
 * and for every node n
 *
 *   L_n = W_n·Σ_j b_j·(ρ_black + (ρ_white − ρ_black)·Σ_corners w_jk·s_k(λ_n)),
 *
 * the reference's arithmetic regrouped. Each pixel's lattice cell and fractions come from the host (float64, as the reference
 * decodes the pixel), per band for the rows its lattice windows reach: 16 bytes per pixel (the cell, and per channel the smaller
 * of f and 1 − f rounded once, with a bit for which), so every corner weight carries at most 2E relative per channel. All terms
 * are non-negative: L_n carries `IMAGE_PLANE_LATTICE_U`·E relative (s 1, three channel weights 6, the nested trilinear form 6,
 * the paper 3, the bilinear weights 4, their products and sums 4, the moved-weight budget 1, W_n 2: 27, declared 32), or the
 * point is flagged: on the print's edge, near a nearest-pixel edge, or where a bilinear weight moved by the point's error could
 * change the value by more than E of it (the Speed module's rule, per node).
 *
 * **Mixed light (#597).** Under `illumination` W_n is replaced by the irradiance / π at the point, E_n(p) = Σ_i w_i(p)·T_i,n +
 * Σ_j c_j,n·h_j/d_j³ (src/facade/mixed-illumination.ts), from the light table (`imagePlaneLightTable`: the parts and the spectra at
 * the nodes, no channel value). The blend's position t is formed in double-float32 with te, its error beyond its own low part; each
 * weight comes from its own distance to the segment's ends (rounded once: E relative, plus te times the segment's slope); a regions
 * edge, or a hard edge of equal stops, within the point's bound flags it; a choice of the neighbouring segment moves the weights by
 * at most te times the steepest slope; each point source's h/d³ is a bounded value (B arithmetic). The node value's computed bound
 * (the tables' rounding, the weights, the products and the sums) must stay within (IMAGE_PLANE_LIGHT_U − 1)·E of it, else the point
 * is flagged, so a lit point carries (IMAGE_PLANE_LATTICE_U + IMAGE_PLANE_LIGHT_U)·E relative.
 *
 * **Flagged points.** With site kernels the reference evaluates the lattice formula itself, so the host replaces a flagged
 * point's values with the reference's own `radianceAt` there and clears its flag (as #492 resolves uncertain chart materials).
 * Without kernels the reference reads the environment's own query points, so a site that reads a flagged point (with a nonzero
 * weight) is flagged and its display pixels are recomputed on the host.
 *
 * **Pass 2 (sites).** The blocked sum (#492's order) of Σ_n L_n·C_n,c(t) over each group's dense tap rectangle (without kernels the
 * members' span, zero where no member sits): a term carries L's bound, the table's rounding and the product, the node sum's N − 1,
 * and the row, group and total additions, so the electrons carry (IMAGE_PLANE_LATTICE_U + N + cw + ch + G + 4)·E relative.
 * Then the Quality site tail (readout moments, white clip, running bounds), unchanged.
 */

import { ImageKernelExecutionError, WEBGPU_F32_UNIT_ROUNDOFF } from "./image-kernel-execution.js";
import { BUFFER_USAGE, linearDispatch, runComputePass, type GpuResourceScope, type WebGpuRuntime } from "./webgpu-runtime.js";
import { dwSplit } from "./chart-composite-gpu.js";
import type { ChartCompositeProductPath } from "./wgsl-chart-composite-kernel.js";
import { displayViewModuleCommonWgsl } from "./display-view-composite-material-module.js";
import { DISPLAY_VIEW_QUALITY_COMMON_WGSL, DISPLAY_VIEW_QUALITY_GROUP_WORDS, DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE } from "./wgsl-display-view-quality-kernel.js";
import { latticeCoordinate, type DisplayViewQualityImagePasses, type SignalGather } from "./display-view-quality-gpu.js";
import { queryGeometry } from "./display-view-speed-gpu.js";
import { displayViewSignalTables, type DisplayViewExpectedSignalInput } from "../facade/expected-signal.js";
import type { DisplayViewGpuSetup } from "../facade/display-view.js";
import { calculateIlluminantIrradianceScale, type ImagePlaneSignalScene } from "../facade/scene-radiance.js";

const E = 2 * WEBGPU_F32_UNIT_ROUNDOFF;
/** Relative roundings of a lattice point's radiance (see the module comment). */
export const IMAGE_PLANE_LATTICE_U = 32;
/**
 * #597: relative roundings of the mixed light at a lattice point (a point whose computed bound exceeds IMAGE_PLANE_LIGHT_U − 1 is
 * flagged; see the module comment), added to IMAGE_PLANE_LATTICE_U for a lit print.
 */
export const IMAGE_PLANE_LIGHT_U = 40;
/** #597: layout of the light table (float32 / u32 words; see `imagePlaneLightTable`). */
export const IMAGE_PLANE_LIGHT = /* @__PURE__ */ Object.freeze({ kind: 0, sources: 1, points: 2, regions: 3, outside: 4, regionsAt: 6, pointsAt: 7, tablesAt: 8, slack: 9,
  surround: 10, maximumInverse: 11, halfHi: 12, halfLo: 13, aU: 16, aV: 18, dU: 20, dV: 22, inverse: 24, stops: 26, regionWords: 9, pointWords: 6, maximumPoints: 8 });
/** Lattice nodes of the print (5 × 5 × 5). */
const NODES = 125;
/** Words per pixel record. */
const RECORD_WORDS = 4;
/** Layout of the photo uniform (u32 / float32 words, 96 bytes). */
export const IMAGE_PLANE_QUALITY_PARAMS = /* @__PURE__ */ Object.freeze({ width: 0, height: 1, nearest: 2, nodes: 3, row0: 4, zero: 5, lit: 6, suHi: 8, suLo: 9, svHi: 10, svLo: 11,
  kHi: 12, kLo: 13, halfWHi: 14, halfWLo: 15, halfHHi: 16, halfHLo: 17, aspectHi: 18, aspectLo: 19, slackX: 20, slackY: 21, black: 22, span: 23, words: 24 });
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120, FLOAT32_MINIMUM_NORMAL = 2 ** -126;

const L = IMAGE_PLANE_LIGHT;
/**
 * #597: the mixed light at a lattice point (see the module comment): `light_prepare` once per point (the blend's source and weights
 * with their error bound, and each point source's h/d³ as a bounded value), then `light_at(n)` per node, flagging the point when the
 * computed bound exceeds (IMAGE_PLANE_LIGHT_U − 1)·E of the value.
 */
const LIGHT_WGSL = /* wgsl */ `
var<private> blend_i: u32;
var<private> blend_w0: f32;
var<private> blend_w1: f32;
var<private> blend_e0: f32;
var<private> blend_e1: f32;
var<private> blend_amb: f32;
var<private> fall_v: array<f32, ${L.maximumPoints}>;
var<private> fall_e: array<f32, ${L.maximumPoints}>;
fn lw(i: u32) -> u32 { return bitcast<u32>(light[i]); }
fn ld(i: u32) -> D { return D(light[i], light[i + 1u]); }
// a > b for double-float32 values.
fn d_gt(a: D, b: D) -> bool { let d = d_sub(a, b); return d.h > 0.0 || (d.h == 0.0 && d.l > 0.0); }
// sqrt of a bounded value: |√x − √x̃| ≤ e / (2√(v − e)), and WGSL's sqrt within 5E (inherited from 1 / inverseSqrt).
fn bsqrt(a: B) -> B {
  let v = sqrt(max(a.v, 0.0));
  let low = a.v - SAFETY * a.e;
  if (!(low > 0.0)) { material_uncertain = true; return B(v, 3.0e38); }
  return B(v, a.e / (2.0 * sqrt(low)) + 5.0 * E * v);
}
fn light_prepare(u: D, v: D) {
  let kind = lw(${L.kind}u);
  let S = lw(${L.sources}u);
  blend_i = 0u; blend_w0 = 1.0; blend_w1 = 0.0; blend_e0 = 0.0; blend_e1 = 0.0; blend_amb = 0.0;
  // A point's error beyond its double-float32 arithmetic: the recovery and the reference's own rounding (the host's slack).
  let ce = 4.0 * DW * (abs(u.h) + abs(v.h) + 1.0) + light[${L.slack}u];
  if (kind == 3u) {
    var source = lw(${L.outside}u);
    let bu = bd(u);
    let bv = bd(v);
    for (var r = 0u; r < lw(${L.regions}u); r = r + 1u) {
      let b = lw(${L.regionsAt}u) + r * ${L.regionWords}u;
      if (ge(bu, bd(ld(b + 1u))) && le(bu, bd(ld(b + 3u))) && ge(bv, bd(ld(b + 5u))) && le(bv, bd(ld(b + 7u)))) { source = lw(b); break; }
    }
    blend_i = source;
  } else if (kind != 0u) {
    // t in double-float32 and te, its error bound beyond its own low part (the arithmetic and the point's error).
    var t: D;
    var te: f32;
    let a_u = d_sub(u, ld(${L.aU}u));
    let a_v = d_sub(v, ld(${L.aV}u));
    let inv = ld(${L.inverse}u);
    let ce_t = ce + 4.0 * DW * (abs(light[${L.aU}u]) + abs(light[${L.aV}u]));
    if (kind == 1u) {
      let x = d_mul(a_u, ld(${L.dU}u));
      let y = d_mul(a_v, ld(${L.dV}u));
      let scale = (abs(x.h) + abs(y.h)) * abs(inv.h);
      t = d_mul(d_add(x, y), inv);
      te = 8.0 * DW * (scale + 1.0) + ce_t * (abs(light[${L.dU}u]) + abs(light[${L.dV}u])) * abs(inv.h);
      if (t.h < 0.0) { t = D(0.0, 0.0); }
      if (d_gt(t, D(1.0, 0.0))) { t = D(1.0, 0.0); }
    } else {
      // The distance in double-float32: the float32 root and one Newton step.
      let dd = d_add(d_mul(a_u, a_u), d_mul(a_v, a_v));
      let r0 = sqrt(max(dd.h, 0.0));
      var r = D(r0, 0.0);
      if (r0 > 0.0) { let res = d_sub(dd, d_mul(D(r0, 0.0), D(r0, 0.0))); r = quick_two_sum(r0, ob(ob(res.h + res.l) / ob(2.0 * r0))); }
      t = d_mul(r, inv);
      te = 8.0 * DW * (abs(t.h) + 1.0) + 2.0 * ce_t * abs(inv.h);
      if (d_gt(t, D(1.0, 0.0))) { t = D(1.0, 0.0); }
    }
    // The segment [s_i, s_i+1) that holds t (the reference's order); a hard edge (equal stops) within the bound of t flags the point.
    var i = 0u;
    loop { if (i + 1u >= S) { break; } if (d_gt(ld(${L.stops}u + (i + 1u) * 4u), t)) { break; } i = i + 1u; }
    for (var k = 0u; k + 1u < S; k = k + 1u) {
      if (light[${L.stops}u + k * 4u + 2u] == 0.0 && abs(d_sub(t, ld(${L.stops}u + k * 4u)).h) <= SAFETY * te + DW * (abs(t.h) + 1.0)) { material_uncertain = true; }
    }
    let si = ld(${L.stops}u + i * 4u);
    // A neighbouring segment's choice moves the weights by at most t's bound times the steepest segment's slope.
    blend_amb = te * light[${L.maximumInverse}u];
    if (i + 1u < S && d_gt(t, si)) {
      // Each weight from its own distance to the segment's ends (double-float32, rounded once), so a small weight keeps a small relative error.
      let inv_i = ld(${L.stops}u + i * 4u + 2u);
      let fd = d_mul(d_sub(t, si), inv_i);
      let gd = d_mul(d_sub(ld(${L.stops}u + (i + 1u) * 4u), t), inv_i);
      blend_w1 = clamp(ob(fd.h + fd.l), 0.0, 1.0);
      blend_w0 = clamp(ob(gd.h + gd.l), 0.0, 1.0);
      let common = (te + 4.0 * DW * (abs(t.h) + abs(si.h) + 1.0)) * abs(inv_i.h);
      blend_e1 = E * blend_w1 + common;
      blend_e0 = E * blend_w0 + common;
    }
    blend_i = i;
  }
  // Point sources: h/d³ at the point in metres (print-local × the print's half width), as bounded values.
  let half = ld(${L.halfHi}u);
  let x = d_mul(u, half);
  let y = d_mul(v, half);
  let cm = ce * abs(half.h) + 4.0 * DW * (abs(x.h) + abs(y.h));
  for (var j = 0u; j < lw(${L.points}u); j = j + 1u) {
    let b = lw(${L.pointsAt}u) + j * ${L.pointWords}u;
    var dx = bds(d_sub(x, ld(b)), abs(x.h) + abs(light[b]));
    dx.e = dx.e + cm;
    var dy = bds(d_sub(y, ld(b + 2u)), abs(y.h) + abs(light[b + 2u]));
    dy.e = dy.e + cm;
    let h = bd(ld(b + 4u));
    let d2 = badd(badd(bmul(dx, dx), bmul(dy, dy)), bmul(h, h));
    let fall = bdiv(h, bmul(d2, bsqrt(d2)));
    fall_v[j] = fall.v;
    fall_e[j] = fall.e;
  }
}
// The irradiance / π at node n of the prepared point: the blend's sources and the point sources from their spectra at the nodes.
fn light_at(n: u32) -> f32 {
  let N = photo.nodes;
  let S = lw(${L.sources}u);
  let P = lw(${L.points}u);
  let tab = lw(${L.tablesAt}u);
  var value = 0.0;
  var err = 0.0;
  if (S > 0u) {
    let ti = light[tab + blend_i * N + n];
    var top = ti;
    for (var s = 0u; s < S; s = s + 1u) { top = max(top, light[tab + s * N + n]); }
    var tj = 0.0;
    if (blend_w1 == 0.0) { value = ti; } else { tj = light[tab + (blend_i + 1u) * N + n]; value = blend_w0 * ti + blend_w1 * tj; }
    err = 3.0 * E * value + blend_e0 * ti + blend_e1 * tj + blend_amb * top;
  }
  for (var j = 0u; j < P; j = j + 1u) {
    let c = light[tab + (S + j) * N + n];
    let term = c * fall_v[j];
    value = value + term;
    err = err + c * fall_e[j] + 2.0 * E * term;
  }
  err = err + f32(P + 1u) * E * value;
  if (!(err <= ${IMAGE_PLANE_LIGHT_U - 1}.0 * E * value)) { material_uncertain = true; }
  return value;
}
`;

/**
 * #597: the light table of a lit print at the spectral nodes (the layout `IMAGE_PLANE_LIGHT`): the blend (kind, sources, its geometry
 * and stops with each segment's inverse width, 0 at a hard edge), the regions, the point sources (x, y, h in metres), then per node
 * T_i,n = k_i·S_i(λ_n)/π for each blend source and c_j·S_j(λ_n)/π for each point source: spectra only, no channel value. `slack` is the
 * reference's own rounding of a query point in print-local units.
 */
export function imagePlaneLightTable(light: NonNullable<ImagePlaneSignalScene["image"]["light"]>, wavelengths: readonly number[], surroundReflectance: number, slack: number):
  { table: Float32Array<ArrayBuffer>; largestIrradiance: number } {
  const resolved = light.layout;
  if (!resolved) throw new ImageKernelExecutionError("unsupported-on-backend", "The print's mixed light carries no parts for the GPU; use cpu-reference.");
  // The blend's sources come first, then the point sources (their report carries the position and the intensity, c = I·k(1 lux)).
  const blend = resolved.blend as { kind: string; from?: { u: number; v: number }; to?: { u: number; v: number }; center?: { u: number; v: number }; radius?: number;
    regions?: readonly { source: number; uMin: number; uMax: number; vMin: number; vMax: number }[]; outsideSource?: number; stops?: readonly number[] } | null;
  const sources = resolved.sources.filter((s) => s.report.position === undefined), points = resolved.sources.filter((s) => s.report.position !== undefined).map((s) => {
    const position = s.report.position as { xM: number; yM: number; heightM: number };
    return { ...position, scale: calculateIlluminantIrradianceScale(s.illuminant.shape, 1) * (s.report.intensityCandela as number), shape: s.illuminant.shape };
  });
  const S = sources.length, P = points.length, N = wavelengths.length, regions = blend?.regions ?? [];
  if (P > L.maximumPoints) throw new ImageKernelExecutionError("unsupported-on-backend", "More point sources than the GPU pass holds.");
  const regionsAt = L.stops + 4 * S, pointsAt = regionsAt + L.regionWords * regions.length, tablesAt = pointsAt + L.pointWords * P;
  const table = new Float32Array(tablesAt + (S + P) * N), words = new Uint32Array(table.buffer);
  const pair = (at: number, x: number): void => { [table[at], table[at + 1]] = dwSplit(x); };
  words[L.kind] = blend === null ? 0 : blend.kind === "linear-gradient" ? 1 : blend.kind === "radial" ? 2 : 3;
  words[L.sources] = S; words[L.points] = P; words[L.regions] = regions.length; words[L.outside] = blend?.outsideSource ?? 0;
  words[L.regionsAt] = regionsAt; words[L.pointsAt] = pointsAt; words[L.tablesAt] = tablesAt;
  table[L.slack] = slack; table[L.surround] = surroundReflectance;
  pair(L.halfHi, light.halfWidthM);
  if (blend?.kind === "linear-gradient") {
    const from = blend.from!, du = blend.to!.u - from.u, dv = blend.to!.v - from.v;
    pair(L.aU, from.u); pair(L.aV, from.v); pair(L.dU, du); pair(L.dV, dv); pair(L.inverse, 1 / (du * du + dv * dv));
  } else if (blend?.kind === "radial") { pair(L.aU, blend.center!.u); pair(L.aV, blend.center!.v); pair(L.inverse, 1 / blend.radius!); }
  let maximumInverse = 0;
  const stops = blend?.stops ?? [];
  stops.forEach((stop, i) => {
    const next = stops[i + 1], inverse = next !== undefined && next > stop ? 1 / (next - stop) : 0;
    pair(L.stops + 4 * i, stop); pair(L.stops + 4 * i + 2, inverse);
    maximumInverse = Math.max(maximumInverse, inverse);
  });
  table[L.maximumInverse] = maximumInverse;
  regions.forEach((r, i) => {
    const at = regionsAt + L.regionWords * i;
    words[at] = r.source; pair(at + 1, r.uMin); pair(at + 3, r.uMax); pair(at + 5, r.vMin); pair(at + 7, r.vMax);
  });
  points.forEach((p, j) => { const at = pointsAt + L.pointWords * j; pair(at, p.xM); pair(at + 2, p.yM); pair(at + 4, p.heightM); });
  // The largest irradiance / π anywhere (the blend's largest source and every point at normal incidence, 1/h²), for the tiny-value bound.
  let largestIrradiance = 0;
  wavelengths.forEach((nm, n) => {
    let top = 0, atNormal = 0;
    sources.forEach((source, i) => { const value = source.irradianceScale * source.illuminant.shape.evaluate(nm) / Math.PI; table[tablesAt + i * N + n] = value; top = Math.max(top, value); });
    points.forEach((p, j) => { const value = p.scale * p.shape.evaluate(nm) / Math.PI; table[tablesAt + (S + j) * N + n] = value; atNormal += value / (p.heightM * p.heightM); });
    largestIrradiance = Math.max(largestIrradiance, top + atNormal);
  });
  for (let i = tablesAt; i < table.length; i++) if (!(table[i]! >= 0 && table[i]! <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A light's spectrum is outside the float32 domain.");
  return { table, largestIrradiance };
}

/** The display-view helpers of the composite kernel's common part, with the barrier word read from the photo uniform. */
const photoCommon = (path: ChartCompositeProductPath): string => displayViewModuleCommonWgsl(path).replace(/\blattice\.zero\b/gu, "photo.zero");

/** Pass 1's WGSL (see the module comment). */
export function imagePlaneQualityLatticeWgsl(path: ChartCompositeProductPath): string {
  return `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(2) var<storage, read_write> lattice_values: array<f32>;
@group(0) @binding(3) var<storage, read_write> lattice_flags: array<u32>;
struct PhotoParams {
  width: u32, height: u32, nearest: u32, nodes: u32, row0: u32, zero: u32, lit: u32, pad1: u32,
  su_hi: f32, su_lo: f32, sv_hi: f32, sv_lo: f32, k_hi: f32, k_lo: f32, hw_hi: f32, hw_lo: f32,
  hh_hi: f32, hh_lo: f32, aspect_hi: f32, aspect_lo: f32, slack_x: f32, slack_y: f32, black: f32, span: f32,
};
@group(1) @binding(0) var<storage, read> records: array<u32>;
@group(1) @binding(1) var<uniform> photo: PhotoParams;
@group(1) @binding(2) var<storage, read> node_table: array<f32>;
@group(1) @binding(3) var<storage, read> light: array<f32>;
${photoCommon(path)}
${LIGHT_WGSL}
fn pixel_slack(x: D, slack: f32) -> f32 { return 4.0 * (DW * (abs(x.h) + 1.0)) + 4.0 * slack; }
struct Axis { i0: u32, i1: u32, w0: f32, w1: f32 }
fn bilinear_axis(s: D, n: u32) -> Axis {
  var f0 = floor(s.h);
  if (f0 == s.h && s.l < 0.0) { f0 = f0 - 1.0; }
  let frac = d_sub(s, D(f0, 0.0));
  let comp = d_sub(D(ob(f0 + 1.0), 0.0), s);
  var w0 = 0.0; var w1 = 0.0;
  if (frac.h <= 0.5) { w1 = ob(frac.h + frac.l); w0 = ob(1.0 - w1); } else { w0 = ob(comp.h + comp.l); w1 = ob(1.0 - w0); }
  let last = i32(n) - 1;
  return Axis(u32(clamp(i32(f0), 0, last)), u32(clamp(i32(f0) + 1, 0, last)), w0, w1);
}
// A channel's two corner weights from its record: the stored smaller one and 1 minus it.
fn channel_weights(word: u32, bit: u32, small: f32) -> vec2<f32> {
  if (((word >> bit) & 1u) == 0u) { return vec2<f32>(ob(1.0 - small), small); }
  return vec2<f32>(small, ob(1.0 - small));
}
struct Pixel { base: u32, r: vec2<f32>, g: vec2<f32>, b: vec2<f32> }
fn pixel_at(i: u32, j: u32) -> Pixel {
  let o = ((j - photo.row0) * photo.width + i) * ${RECORD_WORDS}u;
  let w = records[o];
  return Pixel((w & 3u) * 25u + ((w >> 2u) & 3u) * 5u + ((w >> 4u) & 3u), channel_weights(w, 6u, bitcast<f32>(records[o + 1u])),
    channel_weights(w, 7u, bitcast<f32>(records[o + 2u])), channel_weights(w, 8u, bitcast<f32>(records[o + 3u])));
}
fn node(k: u32, n: u32) -> f32 { return node_table[k * photo.nodes + n]; }
// The white radiance at node n, or (#597) under mixed light the irradiance / π at the point.
fn white_at(white: u32, n: u32) -> f32 { if (photo.lit != 0u) { return light_at(n); } return node_table[white + n]; }
// One pixel's reflectance at node n: the reference's nested trilinear form, then the paper.
fn pixel_value(px: Pixel, n: u32) -> f32 {
  let b = px.base;
  let lat = px.r.x * (px.g.x * (px.b.x * node(b, n) + px.b.y * node(b + 1u, n)) + px.g.y * (px.b.x * node(b + 5u, n) + px.b.y * node(b + 6u, n))) +
    px.r.y * (px.g.x * (px.b.x * node(b + 25u, n) + px.b.y * node(b + 26u, n)) + px.g.y * (px.b.x * node(b + 30u, n) + px.b.y * node(b + 31u, n)));
  return photo.black + photo.span * lat;
}
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let i = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (i >= params.lattice_total) { return; }
  var g = 0u;
  for (var k = 1u; k < params.groups; k = k + 1u) { if (i >= groups[k * GROUP + 4u]) { g = k; } }
  let base = g * GROUP;
  let lw = groups[base + 2u];
  let local = i - groups[base + 4u];
  let q = bitcast<i32>(groups[base + 1u]) + i32(local / lw);
  let p = bitcast<i32>(groups[base]) + i32(local % lw);
  material_uncertain = false;
  let N = photo.nodes;
  let out = i * N;
  let white = ${NODES}u * N;
  let k = D(photo.k_hi, photo.k_lo);
  let u = d_mul(d_mul(D(f32(p) + bitcast<f32>(groups[base + 6u]), 0.0), D(photo.su_hi, photo.su_lo)), k);
  let v = d_mul(d_mul(D(f32(q) + bitcast<f32>(groups[base + 7u]), 0.0), D(photo.sv_hi, photo.sv_lo)), k);
  let aspect = D(photo.aspect_hi, photo.aspect_lo);
  // #597: under mixed light the irradiance at the point (its blend and point sources) replaces the white radiance per node.
  if (photo.lit != 0u) { light_prepare(u, v); }
  if (!(le(babs(bd(u)), bx(1.0)) && le(babs(bd(v)), bd(aspect)))) {
    for (var n = 0u; n < N; n = n + 1u) {
      if (photo.lit != 0u) { lattice_values[out + n] = light[${L.surround}u] * light_at(n); } else { lattice_values[out + n] = node_table[white + N + n]; }
    }
    lattice_flags[i] = select(0u, 1u, material_uncertain);
    return;
  }
  let x = d_mul(d_add(u, D(1.0, 0.0)), D(photo.hw_hi, photo.hw_lo));
  let y = d_mul(d_sub(aspect, v), D(photo.hh_hi, photo.hh_lo));
  if (photo.nearest != 0u) {
    let last_x = f32(photo.width - 1u);
    let last_y = f32(photo.height - 1u);
    let px = pixel_at(u32(clamp(bfloor(bd(x), 1.0, last_x), 0.0, last_x)), u32(clamp(bfloor(bd(y), 1.0, last_y), 0.0, last_y)));
    for (var n = 0u; n < N; n = n + 1u) { lattice_values[out + n] = white_at(white, n) * pixel_value(px, n); }
  } else {
    let ax = bilinear_axis(d_sub(x, D(0.5, 0.0)), photo.width);
    let ay = bilinear_axis(d_sub(y, D(0.5, 0.0)), photo.height);
    let p00 = pixel_at(ax.i0, ay.i0);
    let p10 = pixel_at(ax.i1, ay.i0);
    let p01 = pixel_at(ax.i0, ay.i1);
    let p11 = pixel_at(ax.i1, ay.i1);
    let slack = (pixel_slack(x, photo.slack_x) + pixel_slack(y, photo.slack_y)) * 2.0;
    for (var n = 0u; n < N; n = n + 1u) {
      let s00 = pixel_value(p00, n);
      let s10 = pixel_value(p10, n);
      let s01 = pixel_value(p01, n);
      let s11 = pixel_value(p11, n);
      let value = ay.w0 * (ax.w0 * s00 + ax.w1 * s10) + ay.w1 * (ax.w0 * s01 + ax.w1 * s11);
      if (!(slack * max(max(s00, s10), max(s01, s11)) <= E * value)) { material_uncertain = true; }
      lattice_values[out + n] = white_at(white, n) * value;
    }
  }
  lattice_flags[i] = select(0u, 1u, material_uncertain);
}
`;
}

/** Pass 2's WGSL (see the module comment): the blocked sum over the nodes, then the Quality site tail. */
export const IMAGE_PLANE_QUALITY_SITES_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(3) var<storage, read> table: array<f32>;
@group(0) @binding(4) var<storage, read> lattice: array<f32>;
@group(0) @binding(5) var<storage, read_write> sites: array<f32>;
@group(0) @binding(6) var<storage, read> lattice_flags: array<u32>;
${DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL}
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let local = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (local >= params.count) { return; }
  let i = params.site_first + local;
  let ii = i % params.site_w;
  let jj = i / params.site_w;
  let c = channel_of(params.site_x0 + i32(ii), params.site_y0 + i32(jj));
  let T = params.taps;
  let N = bitcast<u32>(params.pad_h);
  var sum = 0.0;
  var flagged = false;
  for (var k = 0u; k < params.groups; k = k + 1u) {
    let g = k * GROUP;
    let lw = groups[g + 2u];
    let cw = lw - params.site_w + 1u;
    let ch = groups[g + 3u] - params.site_h + 1u;
    let lattice0 = groups[g + 4u] + jj * lw + ii;
    let tap0 = groups[g + 5u];
    var group_sum = 0.0;
    for (var dy = 0u; dy < ch; dy = dy + 1u) {
      let row = lattice0 + dy * lw;
      let row_tap = tap0 + dy * cw;
      var row_sum = 0.0;
      for (var dx = 0u; dx < cw; dx = dx + 1u) {
        let point = row + dx;
        let t = row_tap + dx;
        var cell = 0.0;
        var weight = 0.0;
        for (var n = 0u; n < N; n = n + 1u) {
          let w = table[(n * 3u + c) * T + t];
          weight = weight + w;
          cell = cell + lattice[point * N + n] * w;
        }
        if (lattice_flags[point] != 0u && weight > 0.0) { flagged = true; }
        row_sum = row_sum + cell;
      }
      group_sum = group_sum + row_sum;
    }
    sum = sum + group_sum;
  }
  let e = sum + dark_of(c);
  write_site(i, c, e, params.site_gamma * e + params.site_tiny, select(0u, 1u, flagged));
}
`;

/**
 * The print's gather: per group its dense tap rectangle (with site kernels the reference's combined window; without them the
 * members' span), the lattice extent beyond the site window and the point constants, and the table C_n,c(t) at (n·3 + c)·T + t,
 * the reference's float64 values rounded once.
 */
export function imagePlaneQualityGather(signalInput: DisplayViewExpectedSignalInput, largestLitRadiance?: number): SignalGather {
  const tables = displayViewSignalTables(signalInput), W = signalInput.nativeWidth, H = signalInput.nativeHeight, R = signalInput.kernels ? signalInput.kernels.radius : 0;
  const N = signalInput.wavelengthsNm.length, A = signalInput.electronsPerRadiance, groups: SignalGather["groups"] = [];
  const rects = tables.groups.map((group) => {
    const cw = signalInput.kernels ? group.cw : group.maxIx - group.minIx + 1, ch = signalInput.kernels ? group.ch : group.maxIy - group.minIy + 1;
    return { group, cw, ch, dpMin: group.minIx - R, dqMin: group.minIy - R };
  });
  let T = 0;
  for (const r of rects) {
    groups.push({ dpMin: r.dpMin, dqMin: r.dqMin, dpSpan: r.cw - 1, dqSpan: r.ch - 1, cu: 0.5 + r.group.fx - W / 2, cv: 0.5 + r.group.fy - H / 2, firstTap: T, cw: r.cw, ch: r.ch });
    T += r.cw * r.ch;
  }
  const table = new Float32Array(N * 3 * T), tiny = new Float64Array(T);
  let largestRadiance = 0;
  rects.forEach((r, g) => {
    const first = groups[g]!.firstTap;
    for (let n = 0; n < N; n++) for (let c = 0; c < 3; c++) {
      const values = new Float64Array(r.cw * r.ch);
      if (signalInput.kernels) values.set(r.group.perNode[n]![c]!);
      else for (const member of r.group.members) { const at = (member.iy - r.group.minIy) * r.cw + member.ix - r.group.minIx; values[at] = values[at]! + member.weight * A[c]![n]!; }
      for (let t = 0; t < values.length; t++) {
        const value = values[t]!;
        if (!(value >= 0 && value <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A combined kernel value is outside the float32 domain.");
        table[(n * 3 + c) * T + first + t] = value;
        if (value > 0 && value < FLOAT32_MINIMUM_NORMAL) tiny[first + t] = Math.max(tiny[first + t]!, value);
      }
    }
  });
  const image = (signalInput.scene as { image?: ImagePlaneSignalScene["image"] }).image!;
  if (largestLitRadiance !== undefined) largestRadiance = largestLitRadiance;
  else for (const w of image.whiteRadiance) largestRadiance = Math.max(largestRadiance, w);
  let tinyMass = 0;
  for (let t = 0; t < T; t++) tinyMass += tiny[t]! * largestRadiance * N;
  return { groups, taps: new Uint32Array(0), tapCount: T, nodes: N, table, spread: new Float32Array(3 * Math.max(1, T)), materials: 0, tinyMass };
}

/** The print's Quality passes for a setup (see `DisplayViewQualityImagePasses`), with the double-word product path the device's probe chose. */
export function imagePlaneQualityPasses(runtime: WebGpuRuntime, gpu: DisplayViewGpuSetup, path: ChartCompositeProductPath): DisplayViewQualityImagePasses {
  const signalInput = gpu.signalInput, image = (signalInput.scene as { image?: ImagePlaneSignalScene["image"] }).image;
  if (!image || !gpu.placement) throw new ImageKernelExecutionError("unsupported-on-backend", "The setup carries no image-plane print and placement; use cpu-reference.");
  // #597: under mixed light, the light's table (its parts and spectra at the nodes), which replaces the white radiance in pass 1.
  const k0 = gpu.placement.chartUnitsPerFrameUnit, lit = image.light ? imagePlaneLightTable(image.light, signalInput.wavelengthsNm, image.surroundReflectance, 1e-14 * k0) : undefined;
  const scene = image.scene, N = signalInput.wavelengthsNm.length, gather = imagePlaneQualityGather(signalInput, lit?.largestIrradiance);
  let cw = 0, ch = 0;
  for (const g of gather.groups) { cw = Math.max(cw, g.cw); ch = Math.max(ch, g.ch); }
  // The lattice scale: the lattice formula's g with site kernels, else the environment's query lattice (checked within 2⁻⁴⁰ by queryGeometry).
  const g = 2 / signalInput.outputWidth, geometry = signalInput.kernels ? { scaleU: g, scaleV: -g } : queryGeometry(signalInput);
  const halfW = scene.width / 2, halfH = scene.height / (2 * scene.aspect), k = gpu.placement.chartUnitsPerFrameUnit;
  // The node table: s_k(λ_n) per node, then W_n, then the surround's radiance per node.
  const nodeTable = new Float32Array((NODES + 2) * N);
  signalInput.wavelengthsNm.forEach((nm, n) => {
    const reflectances = scene.nodeReflectances(nm);
    for (let node = 0; node < NODES; node++) nodeTable[node * N + n] = reflectances[node]!;
    nodeTable[NODES * N + n] = image.whiteRadiance[n]!;
    nodeTable[(NODES + 1) * N + n] = image.surroundReflectance * image.whiteRadiance[n]!;
  });
  const P = IMAGE_PLANE_QUALITY_PARAMS, params = new ArrayBuffer(4 * P.words), words = new Uint32Array(params), floats = new Float32Array(params);
  words[P.width] = scene.width; words[P.height] = scene.height; words[P.nearest] = scene.interpolation === "nearest" ? 1 : 0; words[P.nodes] = N; words[P.zero] = 0; words[P.lit] = lit ? 1 : 0;
  const lightTable = lit ? lit.table : new Float32Array(1);
  [floats[P.suHi], floats[P.suLo]] = dwSplit(geometry.scaleU); [floats[P.svHi], floats[P.svLo]] = dwSplit(geometry.scaleV); [floats[P.kHi], floats[P.kLo]] = dwSplit(k);
  [floats[P.halfWHi], floats[P.halfWLo]] = dwSplit(halfW); [floats[P.halfHHi], floats[P.halfHLo]] = dwSplit(halfH); [floats[P.aspectHi], floats[P.aspectLo]] = dwSplit(scene.aspect);
  floats[P.slackX] = 1e-14 * k * halfW; floats[P.slackY] = 1e-14 * k * halfH; floats[P.black] = scene.paperBlackReflectance; floats[P.span] = scene.paperWhiteReflectance - scene.paperBlackReflectance;
  const label = path === "dekker" ? "image-plane" : "image-plane-fma";
  const fractions = new Float64Array(3);
  const passes: DisplayViewQualityImagePasses = {
    gather, siteGamma: (IMAGE_PLANE_LATTICE_U + (lit ? IMAGE_PLANE_LIGHT_U : 0) + N + cw + ch + gather.groups.length + 4) * E, pointFloats: N,
    lattice: ["photivra-display-view-quality-photo-lattice:" + label, imagePlaneQualityLatticeWgsl(path)],
    sites: ["photivra-display-view-quality-photo-sites", IMAGE_PLANE_QUALITY_SITES_WGSL],
    async runLattice(band, pipeline, latticeParams, groupBuffer, groupWords, latticeTotal, signal): Promise<{ values: GPUBuffer; flags: GPUBuffer; resolved: number }> {
      let values = band.buffer("photivra-display-view-photo-lattice", latticeTotal * 4 * N, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
      let flags = band.buffer("photivra-display-view-photo-lattice-flags", latticeTotal * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
      const group0 = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: latticeParams } },
        { binding: 1, resource: { buffer: groupBuffer } }, { binding: 2, resource: { buffer: values } }, { binding: 3, resource: { buffer: flags } }] });
      const [valueData, flagData] = await runComputePass(runtime, band, pipeline, [group0, bandGroup(band, pipeline.getBindGroupLayout(1), groupWords)],
        linearDispatch(latticeTotal, DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
        [{ buffer: values, bytes: latticeTotal * 4 * N }, { buffer: flags, bytes: latticeTotal * 4 }], signal);
      const valueArray = new Float32Array(valueData!, 0, latticeTotal * N), flagArray = new Uint32Array(flagData!, 0, latticeTotal), resolved = resolve(valueArray, flagArray, groupWords);
      if (resolved > 0) { values = band.upload("photivra-display-view-photo-lattice-resolved", valueArray, BUFFER_USAGE.STORAGE); flags = band.upload("photivra-display-view-photo-flags-resolved", flagArray, BUFFER_USAGE.STORAGE); }
      return { values, flags, resolved };
    }
  };
  function bandGroup(scope: GpuResourceScope, layout: GPUBindGroupLayout, groupWords: Uint32Array): GPUBindGroup {
      // The pixel rows the band's lattice windows reach (the print-local v of each window's first and last rows, two rows of margin).
      const ints = new Int32Array(groupWords.buffer, groupWords.byteOffset, groupWords.length), groupFloats = new Float32Array(groupWords.buffer, groupWords.byteOffset, groupWords.length);
      let low = Infinity, high = -Infinity;
      for (let gi = 0; gi < gather.groups.length; gi++) {
        const base = gi * DISPLAY_VIEW_QUALITY_GROUP_WORDS, cv = groupFloats[base + 7]!;
        for (const q of [ints[base + 1]!, ints[base + 1]! + groupWords[base + 3]! - 1]) {
          const Y = (scene.aspect - (q + cv) * geometry.scaleV * k) * halfH;
          low = Math.min(low, Y); high = Math.max(high, Y);
        }
      }
      const row0 = Math.max(0, Math.min(scene.height - 1, Math.floor(low) - 2)), row1 = Math.max(row0, Math.min(scene.height - 1, Math.floor(high) + 2));
      const records = new Uint32Array((row1 - row0 + 1) * scene.width * RECORD_WORDS), recordFloats = new Float32Array(records.buffer);
      for (let j = row0, o = 0; j <= row1; j++) for (let i = 0; i < scene.width; i++, o += RECORD_WORDS) {
        const cell = scene.pixelLattice(j * scene.width + i, fractions);
        let word = Math.floor(cell / 25) | ((Math.floor(cell / 5) % 5) << 2) | ((cell % 5) << 4);
        for (let c = 0; c < 3; c++) {
          const f = fractions[c]!, high1 = f > 0.5;
          if (high1) word |= 1 << (6 + c);
          recordFloats[o + 1 + c] = high1 ? 1 - f : f;
        }
        records[o] = word;
      }
      const bandParams = params.slice(0);
      new Uint32Array(bandParams)[P.row0] = row0;
      if (records.byteLength > runtime.maximumStorageBindingBytes) throw new ImageKernelExecutionError("insufficient-limits", "A band's pixel records exceed the device's storage binding limit.");
      return runtime.device.createBindGroup({ layout, entries: [
        { binding: 0, resource: { buffer: scope.upload("photivra-display-view-photo-records", records, BUFFER_USAGE.STORAGE) } },
        { binding: 1, resource: { buffer: scope.upload("photivra-display-view-photo-params", new Uint8Array(bandParams), BUFFER_USAGE.UNIFORM) } },
        { binding: 2, resource: { buffer: scope.upload("photivra-display-view-photo-nodes", nodeTable, BUFFER_USAGE.STORAGE) } },
        { binding: 3, resource: { buffer: scope.upload("photivra-display-view-photo-light", lightTable, BUFFER_USAGE.STORAGE) } }] });
  }
  function resolve(values: Float32Array, flags: Uint32Array, groupWords: Uint32Array): number {
      if (!signalInput.kernels) return 0;
      // The reference's lattice point (createDisplayViewExpectedSignal's latticeU / latticeV) and its radiance per node.
      const ints = new Int32Array(groupWords.buffer, groupWords.byteOffset, groupWords.length), groupsOf = displayViewSignalTables(signalInput).groups;
      const W = signalInput.nativeWidth, H = signalInput.nativeHeight, scale = 2 / signalInput.outputWidth;
      let resolved = 0;
      groupsOf.forEach((group, gi) => {
        const base = gi * DISPLAY_VIEW_QUALITY_GROUP_WORDS, lx0 = ints[base]!, ly0 = ints[base + 1]!, lw = groupWords[base + 2]!, lh = groupWords[base + 3]!, first = groupWords[base + 4]!;
        for (let local = 0; local < lw * lh; local++) {
          if (flags[first + local] === 0) continue;
          const p = lx0 + (local % lw), q = ly0 + Math.floor(local / lw);
          const u = latticeCoordinate(p, group.fx, W, scale), v = -latticeCoordinate(q, group.fy, H, scale);
          for (let n = 0; n < N; n++) values[(first + local) * N + n] = signalInput.scene.kind === "radiance" ? signalInput.scene.radianceAt(u, v, signalInput.wavelengthsNm[n]!) : 0;
          flags[first + local] = 0;
          resolved++;
        }
      });
      return resolved;
  }
  return passes;
}
