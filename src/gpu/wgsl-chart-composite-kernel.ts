// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernel of the `webgpu-f32` chart-radiance stage for composite charts, the 2.3 chart elements and
 * declared `material-layers` scenes (#477), one invocation per query point. It resolves the point to a mask
 * layer or a composite element, classifies the material there with the element's own geometry (the float64
 * constants `resolveChartScene` decided with, uploaded once per prepared scene), and reads the material's
 * value from the host's float64 table. The eight 2.0 presets as plain charts keep their own kernel
 * (wgsl-chart-kernel.ts); as composite elements they run here.
 *
 * **Bound arithmetic.** Every float32 value carries an a-priori bound on its distance from the exact
 * value of the same expression: `B(v, e)` with |v − exact| ≤ e. A constant the host rounded from float64
 * carries E·|c| (E = 2^-23: one WGSL rounding of `+ − ×`, which the spec lets fall in either direction,
 * W3C WGSL "Floating Point Accuracy"); `+ − ×` add E·|v| each; `/` adds the WGSL 2.5-ULP bound (2.5·E·|v|);
 * a point carries its low float32 part (its float64 coordinate to 2^-48). A decision (sign, floor,
 * comparison) whose value lies within SAFETY (4) times its bound, plus 10^-14 relative slack for the
 * reference's own float64 rounding, flags the point, and the host recomputes it with the reference. So
 * every unflagged point has exactly the reference's material.
 *
 * **Double-float32 for the chirps.** The zone plate's phase k·r² and the sine star's angle would be decided
 * to about 2^-24 relative in plain float32, which at hundreds of cycles is wider than a 1024-level step
 * and would flag most points. Points are therefore uploaded as float32 pairs (hi + lo, the float64 point to
 * 2^-48), and the element frames, r², k·r² and the star's cross products are evaluated in double-float32
 * (TwoSum, Veltkamp split and Dekker TwoProduct; Joldes, Muller & Popescu, "Tight and rigorous error
 * bounds for basic building blocks of double-word arithmetic", ACM TOMS 44(2), 2017, free author copy on
 * HAL: each operation is within a few u² relative), with a declared bound of 2^-40 relative per result.
 * These algorithms need the written evaluation order and round-to-nearest `+ − ×`, and WGSL lets an
 * implementation reassociate and fuse (W3C WGSL § 15.7.5 "Reassociation and Fusion": "An implementation may fuse
 * operations if the transformed expression is at least as accurate as the original formulation"), round in either
 * direction (§ 15.7.4), and evaluate `fma` unfused (§ 15.7.2, § 17.5.32). WGSL has no way to forbid a fusion, so
 * the host probes the compiled building blocks before using them (`CHART_COMPOSITE_PROBE_WGSL`) with inputs whose
 * low parts are non-zero and whose sums and products round up or down to the nearest float32.
 *
 * **Two product paths (2.11.0).** Dekker's TwoProduct and the final Fast2Sum of the double-word product depend on
 * every rounded product being rounded before it is added: a fusion of `a*b - p`, of Veltkamp's `t - (t - a)` with
 * t = 4097·a, or of `p.h + l` with p.h = a.h·b.h changes them (the last adds the product's error twice). The fma path
 * (`two_prod_fma`, `d_mul_fma`) never adds a rounded product: TwoProduct is fma(a, b, −p) (exact for a fused fma;
 * Joldes, Muller & Popescu 2017, Algorithm 2), and the double-word product forms its hi part as fma(a.h, b.h, t) and
 * its error as fma(a.h, b.h, −s) + t, where only t = a.h·b.l + a.l·b.h, an ordinary bounded sum, may be fused. It
 * is within 9u² (first order) of the exact product (docs/WEBGPU.md), inside the declared 2^-40. The probe runs both
 * paths; the kernel is compiled with Dekker's when it passes (so an unfused device keeps its results bit for bit),
 * else with the fma one when it passes, else the device is refused. TwoSum, Fast2Sum and the double-word sum hold no
 * product and so cannot be fused; the zone plate's phase reduction subtracts 2·round(psi.h/2), an exact product, so
 * a fusion leaves it unchanged; the star's cross products and the lattice-point recovery are double-word products
 * and sums. The bound arithmetic stays valid under fusion: a fused multiply-add rounds once, so its result is
 * within E·|v| of the exact value of the same expression, the term `+` already adds (the product's own E·|v| term
 * is then a bound on a rounding that did not happen).
 *
 * **The rounding barrier (2.11.0).** Metal's compiler reassociated the error-free transforms on an Apple M5 Pro (the probe
 * of October 27, 2026: class `reassociated`, every differing low part zero, the value (a + b) − a → b gives), which neither
 * product path survives. Every operation of the transforms, and every value of the bound arithmetic, is therefore wrapped in
 * `ob`: the result's bits XORed with a word the host sets to 0 (a uniform: `params.zero`, `lattice.zero`, the probe's
 * `probe_zero`), which a compiler cannot see through, so it can neither regroup nor fuse across it and each operation rounds
 * once, as written. On a device that already evaluates as written it changes no value. On the M5 Pro the probe then reports
 * `exact` on the Dekker path (docs/WEBGPU.md). The probe still decides on every device.
 *
 * **No `sin`, `cos` or `atan2` decides anything.** The zone plate reduces its phase to [−1, 1] cycles
 * exactly (Sterbenz) and evaluates cos by quadrant reduction and a Taylor polynomial in bound arithmetic
 * (truncation ≤ 4·10^-13 on [0, π/4 + ε], the Lagrange remainder). A Siemens star (bar or sine profile) is
 * a table of its sector boundary directions, with the level of each sector read from the reference itself;
 * the sector is found by a rough `atan2` and a bucket table, then decided exactly by double-float32 cross
 * products with the two bracketing boundary directions (a point the rough guess misplaces beyond the
 * search window is flagged, never misclassified). See docs/WEBGPU.md, "Scene radiance on the GPU".
 */

import { DIGIT_SEGMENTS, NUMERAL_ADVANCE, SEGMENTS } from "../facade/chart-scenes.js";

export const CHART_COMPOSITE_WORKGROUP_SIZE = 256;

/** Element kind codes of the record headers. */
export const CHART_ELEMENT_KIND = /* @__PURE__ */ Object.freeze({ uniform: 0, "slanted-edge": 1, "siemens-star": 2, "step-wedge": 3, checkerboard: 5, "point-grid": 6, patches: 7,
  "dead-leaves": 8, "bar-groups": 9, "hyperbolic-wedge": 10, "zone-plate": 11, "slanted-squares": 12, "line-grid": 13, fiducial: 14 } as const);
/** Placement modes of an element record: the background fills the frame; elements are rectangles or ellipses. */
export const CHART_PLACEMENT = /* @__PURE__ */ Object.freeze({ frame: 0, rectangle: 1, ellipse: 2 } as const);
/** Words per element header, layer header and shape header in the u32 record array. */
export const CHART_RECORD_STRIDE = /* @__PURE__ */ Object.freeze({ element: 8, layer: 16, shape: 4, placementFloats: 10, barGroupFloats: 16 } as const);

const SEGMENT_ORDER = "abcdefg";
const segmentRows = SEGMENT_ORDER.split("").map((s) => `vec4<f32>(${SEGMENTS[s]!.map((x) => x.toFixed(2)).join(", ")})`).join(", ");
const digitMasks = DIGIT_SEGMENTS.map((segments) => segments.split("").reduce((mask, s) => mask | (1 << SEGMENT_ORDER.indexOf(s)), 0)).map((m) => m + "u").join(", ");

/** The common part's first constants (#658: parts, so that a display-view module takes the common part without the kernel's E and SLACK). */
const COMMON_CONSTANTS_WGSL = /* wgsl */ `
const DW: f32 = 9.094947017729282e-13;
const TINY: f32 = 7.52316384526264e-37;
const SAFETY: f32 = 4.0;
`;
/** The rest of the common part: double-float32 with its rounding barrier, the bound arithmetic and `bfloor`. */
const COMMON_BODY_TEMPLATE = /* wgsl */ `
const PI: f32 = 3.14159265358979;
const HALF_PI: f32 = 1.5707963267948966;
const QUARTER_PI: f32 = 0.7853981633974483;

struct D { h: f32, l: f32 }
struct B { v: f32, e: f32 }

var<private> flagged: bool;

// --- double-float32 (evaluation order matters; the host probes it) ---
// The rounding barrier (2.11.0): ob(x) is x, its bits XORed with a word the host sets to 0 (a uniform), so a
// compiler cannot know it is x. Every operation of the error-free transforms is wrapped, so none can be fused with or
// reassociated across its neighbours (W3C WGSL § 15.7.5 permits both; Metal's compiler simplifies (a + b) - a to b, the M5 Pro
// probe of October 27, 2026), and each rounds once, as written. On a device that already evaluates as written it changes nothing.
fn ob(x: f32) -> f32 { return bitcast<f32>(bitcast<u32>(x) ^ BARRIER_ZERO); }
fn two_sum(a: f32, b: f32) -> D { let s = ob(a + b); let bb = ob(s - a); let e = ob(ob(a - ob(s - bb)) + ob(b - bb)); return D(s, e); }
fn quick_two_sum(a: f32, b: f32) -> D { let s = ob(a + b); let e = ob(b - ob(s - a)); return D(s, e); }
// The Dekker product path: Veltkamp's split and Dekker's TwoProduct, exact only when every + - x is evaluated unfused as written.
fn split(a: f32) -> D { let t = ob(4097.0 * a); let h = ob(t - ob(t - a)); return D(h, ob(a - h)); }
fn two_prod_dekker(a: f32, b: f32) -> D {
  let p = ob(a * b); let sa = split(a); let sb = split(b);
  let e = ob(ob(ob(ob(ob(sa.h * sb.h) - p) + ob(sa.h * sb.l)) + ob(sa.l * sb.h)) + ob(sa.l * sb.l));
  return D(p, e);
}
fn d_mul_dekker(a: D, b: D) -> D {
  let p = two_prod_dekker(a.h, b.h);
  let t = ob(ob(a.h * b.l) + ob(a.l * b.h));
  let l = ob(p.l + t);
  return quick_two_sum(p.h, l);
}
// The fma product path, for a device whose fma is fused (the probe checks it): TwoProduct as fma(a, b, -p), and a double-word
// product in which no rounded product is an operand of an addition (the hi part is fma(a.h, b.h, t), its error fma(a.h, b.h, -s)),
// so a contraction of a*b + c into one rounding cannot change it; only t, an ordinary bounded sum, may be contracted.
fn two_prod_fma(a: f32, b: f32) -> D { let p = ob(a * b); return D(p, ob(fma(a, b, -p))); }
fn d_mul_fma(a: D, b: D) -> D {
  let t = ob(ob(a.h * b.l) + ob(a.l * b.h));
  let s = ob(fma(a.h, b.h, t));
  return D(s, ob(ob(fma(a.h, b.h, -s)) + t));
}
fn d_add(a: D, b: D) -> D {
  let s = two_sum(a.h, b.h); let t = two_sum(a.l, b.l);
  let c = ob(s.l + t.h); let v = quick_two_sum(s.h, c);
  let w = ob(v.l + t.l); return quick_two_sum(v.h, w);
}
fn d_neg(a: D) -> D { return D(-a.h, -a.l); }
fn d_sub(a: D, b: D) -> D { return d_add(a, d_neg(b)); }
fn d_mul(a: D, b: D) -> D { return d_mul_PRODUCT_PATH(a, b); }
// A double-float32 result as a bounded value: its high part, with the low part and the declared 2^-40 error, relative to the
// result and to \`scale\`, the magnitude of the operands it was formed from (a difference of nearly equal terms keeps their error).
fn bds(a: D, scale: f32) -> B { return B(a.h, abs(a.l) + DW * (abs(a.h) + abs(a.l) + scale) + TINY); }
fn bd(a: D) -> B { return bds(a, 0.0); }

// --- bound arithmetic (each value rounds once, as written: the barrier keeps a compiler from regrouping them) ---
fn bc(c: f32) -> B { return B(c, E * abs(c) + TINY); }
fn bx(c: f32) -> B { return B(c, 0.0); }
fn badd(a: B, b: B) -> B { let v = ob(a.v + b.v); return B(v, a.e + b.e + E * abs(v)); }
fn bsub(a: B, b: B) -> B { let v = ob(a.v - b.v); return B(v, a.e + b.e + E * abs(v)); }
fn bmul(a: B, b: B) -> B { let v = ob(a.v * b.v); return B(v, abs(a.v) * b.e + abs(b.v) * a.e + a.e * b.e + E * abs(v)); }
fn bneg(a: B) -> B { return B(-a.v, a.e); }
fn babs(a: B) -> B { return B(abs(a.v), a.e); }
// WGSL division: 2.5 ULP (at most 5u relative) for a denominator within the normal range; a denominator within its bound of 0 flags.
fn bdiv(a: B, b: B) -> B {
  let v = ob(a.v / b.v);
  let d = abs(b.v) - SAFETY * b.e;
  if (!(d > 0.0)) { flagged = true; return B(v, 3.0e38); }
  let e = (a.e + (abs(a.v) + a.e) * b.e / d) / abs(b.v) + 5.0 * E * abs(v);
  return B(v, e);
}
fn margin(x: B) -> f32 { return SAFETY * x.e + SLACK * (abs(x.v) + 1.0); }
// x >= 0 for the exact value; flags when the sign is not decided by the bound.
fn ge0(x: B) -> bool { if (!(abs(x.v) > margin(x))) { flagged = true; } return x.v >= 0.0; }
fn ge(a: B, b: B) -> bool { return ge0(bsub(a, b)); }
fn gt(a: B, b: B) -> bool { return !ge0(bsub(b, a)); }
fn lt(a: B, b: B) -> bool { return !ge0(bsub(a, b)); }
fn le(a: B, b: B) -> bool { return ge0(bsub(b, a)); }
// floor of the exact value; flags when x lies within its margin of an integer in [lo, hi] (or when the margin is a half or more).
fn bfloor(x: B, lo: f32, hi: f32) -> f32 {
  let n = floor(x.v); let m = round(x.v); let g = margin(x);
  if (g >= 0.5) { flagged = true; return n; }
  if (m >= lo && m <= hi && !(abs(x.v - m) > g)) { flagged = true; }
  return n;
}
fn parity_even(i: i32, j: i32) -> bool { return ((i + j) & 1) == 0; }
`;
const COMMON_TEMPLATE = /* wgsl */ `
const E: f32 = 1.1920928955078125e-7;
${COMMON_CONSTANTS_WGSL}
const SLACK: f32 = 1e-14;
${COMMON_BODY_TEMPLATE}`;

/**
 * The composite classification: the segment and digit tables, the cos and sin polynomials, the element and layer classifiers and
 * `material(p)`. The display view's composite module takes it from here (#658: a seam, not a search of the kernel's text).
 */
export const CHART_COMPOSITE_MATERIAL_WGSL = /* wgsl */ `
const SEGMENT_BOX = array<vec4<f32>, 7>(${segmentRows});
const DIGIT_MASK = array<u32, 10>(${digitMasks});
const NUMERAL_ADVANCE: f32 = ${NUMERAL_ADVANCE};

// --- Taylor cos and sin on [0, pi/4 + eps] in bound arithmetic (remainders 4e-13 and 2e-14) ---
fn bcos_poly(y: B) -> B {
  let t = bmul(y, y);
  var p = bc(2.08767569878681e-9);
  p = badd(bmul(p, t), bc(-2.755731922398589e-7));
  p = badd(bmul(p, t), bc(2.48015873015873e-5));
  p = badd(bmul(p, t), bc(-0.001388888888888889));
  p = badd(bmul(p, t), bc(0.041666666666666664));
  p = badd(bmul(p, t), bc(-0.5));
  p = badd(bmul(p, t), bc(1.0));
  return B(p.v, p.e + 4.0e-13);
}
fn bsin_poly(z: B) -> B {
  let t = bmul(z, z);
  var p = bc(1.605904383682161e-10);
  p = badd(bmul(p, t), bc(-2.505210838544172e-8));
  p = badd(bmul(p, t), bc(2.7557319223985893e-6));
  p = badd(bmul(p, t), bc(-0.0001984126984126984));
  p = badd(bmul(p, t), bc(0.008333333333333333));
  p = badd(bmul(p, t), bc(-0.16666666666666666));
  p = badd(bmul(p, t), bc(1.0));
  let s = bmul(p, z);
  return B(s.v, s.e + 2.0e-14);
}
// cos(x) for |x| <= pi + eps: fold to [0, pi/2], then to [0, pi/4] through sin(pi/2 - y). The Taylor coefficients are rationals
// rounded once to float32 (bc: u relative each).
fn bcos(x: B) -> B {
  var y = babs(x);
  var negate = false;
  if (y.v > HALF_PI) { y = bsub(bc(PI), y); negate = true; }
  var c: B;
  if (y.v > QUARTER_PI) { c = bsin_poly(bsub(bc(HALF_PI), y)); } else { c = bcos_poly(y); }
  if (negate) { c = bneg(c); }
  return c;
}

fn bars_material(x: B, origin: f32, w: f32) -> u32 {
  let t = bdiv(bsub(x, bc(origin)), bc(w));
  let n = bfloor(t, -3.0e38, 3.0e38);
  return select(1u, 0u, parity_even(i32(n), 0));
}
fn numeral_ink(u: B, v: B, lu0: f32, lv0: f32, h: f32, digits: u32) -> bool {
  let x = bdiv(bsub(u, bc(lu0)), bc(h));
  let y = bdiv(bsub(v, bc(lv0)), bc(h));
  if (lt(y, bx(0.0)) || gt(y, bx(1.0)) || lt(x, bx(0.0))) { return false; }
  let count = ai[digits];
  let k = bfloor(bdiv(x, bc(NUMERAL_ADVANCE)), 0.0, f32(count));
  if (k >= f32(count)) { return false; }
  let cx = bsub(x, bmul(bx(k), bc(NUMERAL_ADVANCE)));
  let mask = DIGIT_MASK[ai[digits + 1u + u32(k)]];
  for (var s = 0u; s < 7u; s++) {
    if ((mask & (1u << s)) == 0u) { continue; }
    let box = SEGMENT_BOX[s];
    if (ge(cx, bc(box.x)) && le(cx, bc(box.z)) && ge(y, bc(box.y)) && le(y, bc(box.w))) { return true; }
  }
  return false;
}

// Sign of the cross product of boundary k's direction with the point: >= 0 when the point's angle is at or past the boundary.
fn star_cross(dirs: u32, k: u32, x: D, y: D) -> B {
  let o = dirs + 4u * k;
  let cx = D(af[o], af[o + 1u]); let sx = D(af[o + 2u], af[o + 3u]);
  return bds(d_sub(d_mul(cx, y), d_mul(sx, x)), abs(cx.h * y.h) + abs(sx.h * x.h));
}

fn classify(kind: u32, ioff: u32, foff: u32, xd: D, yd: D) -> u32 {
  let u = bd(xd); let v = bd(yd);
  switch (kind) {
    case 0u: { return 0u; }
    case 1u: {
      let d = bsub(bmul(u, bc(af[foff])), bmul(v, bc(af[foff + 1u])));
      return select(0u, 1u, ge0(d));
    }
    case 2u: {
      let n = ai[ioff]; let dirs = ai[ioff + 1u]; let levels = ai[ioff + 2u]; let buckets = ai[ioff + 3u]; let m = ai[ioff + 4u]; let w = i32(ai[ioff + 5u]);
      let q = bd(d_add(d_mul(xd, xd), d_mul(yd, yd)));
      if (gt(q, bc(af[foff]))) { return ai[ioff + 6u]; }
      let a = atan2(yd.h, xd.h);
      let j = u32(clamp(floor((a + PI) * f32(m) / (2.0 * PI)), 0.0, f32(m - 1u)));
      let k0 = i32(ai[buckets + j]);
      var lo = k0 - w; var hi = k0 + w + 1;
      let ni = i32(n);
      let clo = star_cross(dirs, u32((lo % ni + ni) % ni), xd, yd);
      let chi = star_cross(dirs, u32((hi % ni + ni) % ni), xd, yd);
      if (!ge0(clo) || ge0(chi)) { flagged = true; return 0u; }
      for (var step = 0u; step < 32u && hi - lo > 1; step++) {
        let mid = (lo + hi) / 2;
        let c = star_cross(dirs, u32((mid % ni + ni) % ni), xd, yd);
        if (c.v >= 0.0) { lo = mid; } else { hi = mid; }
      }
      if (hi - lo > 1) { flagged = true; }
      let kl = u32((lo % ni + ni) % ni); let kh = u32((hi % ni + ni) % ni);
      if (!ge0(star_cross(dirs, kl, xd, yd)) || ge0(star_cross(dirs, kh, xd, yd))) { flagged = true; }
      return ai[levels + kl];
    }
    case 3u: {
      let steps = f32(ai[ioff]);
      let t = bmul(bmul(badd(u, bx(1.0)), bx(0.5)), bx(steps));
      return u32(clamp(bfloor(t, 1.0, steps - 1.0), 0.0, steps - 1.0));
    }
    case 5u: {
      let size = bc(af[foff]); let aspect = bc(af[foff + 1u]);
      let i = bfloor(bdiv(badd(u, bx(1.0)), size), -3.0e38, 3.0e38);
      let j = bfloor(bdiv(bsub(aspect, v), size), -3.0e38, 3.0e38);
      return select(0u, 1u, parity_even(i32(i), i32(j)));
    }
    case 6u: {
      let columns = ai[ioff]; let rows = ai[ioff + 1u]; let centers = ai[ioff + 2u];
      let i = u32(clamp(bfloor(bdiv(badd(u, bx(1.0)), bc(af[foff])), 1.0, f32(columns - 1u)), 0.0, f32(columns - 1u)));
      let j = u32(clamp(bfloor(bdiv(bsub(bc(af[foff + 2u]), v), bc(af[foff + 1u])), 1.0, f32(rows - 1u)), 0.0, f32(rows - 1u)));
      let c = centers + 2u * (j * columns + i);
      let dx = bsub(u, bc(af[c])); let dy = bsub(v, bc(af[c + 1u]));
      let d2 = badd(bmul(dx, dx), bmul(dy, dy));
      return select(0u, 1u, le(d2, bc(af[foff + 3u])));
    }
    case 7u: {
      let columns = ai[ioff]; let rows = ai[ioff + 1u]; let count = ai[ioff + 2u]; let background = ai[ioff + 3u];
      let fx = bdiv(badd(u, bx(1.0)), bc(af[foff])); let fy = bdiv(bsub(bc(af[foff + 2u]), v), bc(af[foff + 1u]));
      let i = bfloor(fx, -3.0e38, 3.0e38); let j = bfloor(fy, -3.0e38, 3.0e38);
      if (i < 0.0 || j < 0.0 || i >= f32(columns) || j >= f32(rows)) { return background; }
      let index = u32(j) * columns + u32(i);
      let x = bsub(fx, bx(i)); let y = bsub(fy, bx(j));
      let g0 = bc(af[foff + 3u]); let g1 = bc(af[foff + 4u]);
      if (index >= count || lt(x, g0) || gt(x, g1) || lt(y, g0) || gt(y, g1)) { return background; }
      return index;
    }
    case 8u: {
      let nx = ai[ioff]; let ny = ai[ioff + 1u]; let csr = ai[ioff + 2u]; let entries = ai[ioff + 3u]; let disks = ai[ioff + 4u]; let mean = ai[ioff + 5u];
      let cell = bc(af[foff + 2u]);
      let i = bfloor(bdiv(bsub(u, bc(af[foff])), cell), -3.0e38, 3.0e38);
      let j = bfloor(bdiv(bsub(v, bc(af[foff + 1u])), cell), -3.0e38, 3.0e38);
      if (i < 0.0 || j < 0.0 || i >= f32(nx) || j >= f32(ny)) { return mean; }
      let c = u32(j) * nx + u32(i);
      let start = ai[csr + c]; let end = ai[csr + c + 1u];
      for (var e = start; e < end; e++) {
        let d = disks + 4u * ai[entries + e];
        let dx = bsub(u, bc(af[d])); let dy = bsub(v, bc(af[d + 1u]));
        let d2 = badd(bmul(dx, dx), bmul(dy, dy));
        if (le(d2, bc(af[d + 2u]))) { return u32(af[d + 3u]); }
      }
      return mean;
    }
    case 9u: {
      let groups = ai[ioff]; let gf = ai[ioff + 1u]; let digits = ai[ioff + 2u];
      for (var g = 0u; g < groups; g++) {
        let o = gf + ${CHART_RECORD_STRIDE.barGroupFloats}u * g;
        if (lt(u, bc(af[o])) || gt(u, bc(af[o + 1u]))) { continue; }
        if (ge(u, bc(af[o + 2u])) && lt(u, bc(af[o + 4u])) && ge(v, bc(af[o + 3u])) && le(v, bc(af[o + 5u]))) { return bars_material(u, af[o + 2u], af[o + 10u]); }
        if (ge(u, bc(af[o + 6u])) && le(u, bc(af[o + 8u])) && gt(v, bc(af[o + 7u])) && le(v, bc(af[o + 9u]))) {
          let t = bdiv(bsub(bc(af[o + 9u]), v), bc(af[o + 10u]));
          let n = bfloor(t, -3.0e38, 3.0e38);
          return select(1u, 0u, parity_even(i32(n), 0));
        }
        if (af[o + 11u] != 0.0 && numeral_ink(u, v, af[o + 12u], af[o + 13u], af[o + 14u], digits + u32(af[o + 15u]))) { return 0u; }
        return 1u;
      }
      return 1u;
    }
    case 10u: {
      let horizontal = ai[ioff] == 0u; let lines = f32(ai[ioff + 1u]);
      var s: B; var y: B;
      if (horizontal) { s = bmul(badd(u, bx(1.0)), bx(0.5)); y = v; } else { s = bdiv(badd(v, bc(af[foff])), bc(af[foff + 4u])); y = u; }
      if (lt(s, bx(0.0)) || gt(s, bx(1.0))) { return 1u; }
      let w = bdiv(bc(af[foff + 1u]), badd(bc(af[foff + 2u]), bmul(bc(af[foff + 3u]), s)));
      let half = bmul(w, bx((2.0 * lines - 1.0) * 0.5));
      if (lt(y, bneg(half)) || ge(y, half)) { return 1u; }
      let n = bfloor(bdiv(badd(y, half), w), -3.0e38, 3.0e38);
      return select(1u, 0u, parity_even(i32(n), 0));
    }
    case 11u: {
      let q = d_add(d_mul(xd, xd), d_mul(yd, yd));
      if (gt(bd(q), bc(af[foff]))) { return 1024u; }
      let psi = d_mul(q, D(af[foff + 1u], af[foff + 2u]));
      if (!(abs(psi.h) < 1048576.0)) { flagged = true; return 0u; }
      let n = 2.0 * round(psi.h * 0.5);
      let r = (psi.h - n) + psi.l;
      let phase = B(r, DW * (abs(psi.h) + abs(psi.l)) + E * abs(r) + TINY);
      let c = bcos(bmul(bc(PI), phase));
      let t = bmul(bx(512.0), badd(bx(1.0), c));
      return u32(clamp(bfloor(t, 1.0, 1023.0), 0.0, 1023.0));
    }
    case 12u: {
      let columns = ai[ioff]; let rows = ai[ioff + 1u];
      let cellW = bc(af[foff]); let cellH = bc(af[foff + 1u]); let aspect = bc(af[foff + 2u]);
      let i = clamp(bfloor(bdiv(badd(u, bx(1.0)), cellW), 1.0, f32(columns - 1u)), 0.0, f32(columns - 1u));
      let j = clamp(bfloor(bdiv(bsub(aspect, v), cellH), 1.0, f32(rows - 1u)), 0.0, f32(rows - 1u));
      let du = bsub(u, badd(bx(-1.0), bmul(bx(i + 0.5), cellW)));
      let dv = bsub(v, bsub(aspect, bmul(bx(j + 0.5), cellH)));
      let c = bc(af[foff + 3u]); let s = bc(af[foff + 4u]); let half = bc(af[foff + 5u]);
      let x = bsub(bmul(du, c), bmul(dv, s)); let y = badd(bmul(du, s), bmul(dv, c));
      return select(1u, 0u, le(babs(x), half) && le(babs(y), half));
    }
    case 13u: {
      let spacing = bc(af[foff]); let half = bc(af[foff + 1u]);
      let nu = round(u.v / spacing.v); let nv = round(v.v / spacing.v);
      let du = babs(bsub(u, bmul(spacing, bx(nu)))); let dv = babs(bsub(v, bmul(spacing, bx(nv))));
      return select(0u, 1u, le(du, half) || le(dv, half));
    }
    case 14u: {
      let inverted = ai[ioff] != 0u;
      let q = badd(bmul(u, u), bmul(v, v));
      if (gt(q, bc(af[foff]))) { return 2u; }
      if (gt(q, bc(af[foff + 1u]))) { return 0u; }
      let same = ge0(u) == ge0(v);
      return select(1u, 0u, same != inverted);
    }
    default: { flagged = true; return 0u; }
  }
}

// Whether the point (mask units, bounded) is inside the shape; a point outside the bounding box by more than its margin is not.
fn shape_contains(shape: u32, x: B, y: B) -> bool {
  let kind = ai[shape]; let data = ai[shape + 1u]; let edges = ai[shape + 2u];
  let mx = margin(x); let my = margin(y);
  if (x.v + mx < af[data] || x.v - mx > af[data + 2u] || y.v + my < af[data + 1u] || y.v - my > af[data + 3u]) { return false; }
  if (kind == 1u) {
    let dx = bsub(x, bc(af[data + 4u])); let dy = bsub(y, bc(af[data + 5u]));
    let d2 = badd(bmul(dx, dx), bmul(dy, dy));
    return ge(d2, bc(af[data + 6u])) && le(d2, bc(af[data + 7u]));
  }
  var winding = 0;
  for (var k = 0u; k < edges; k++) {
    let o = data + 4u + 4u * k;
    let x0 = bc(af[o]); let y0 = bc(af[o + 1u]); let x1 = bc(af[o + 2u]); let y1 = bc(af[o + 3u]);
    if (ge(y, y0)) {
      if (gt(y1, y)) {
        let side = bsub(bmul(bsub(x1, x0), bsub(y, y0)), bmul(bsub(x, x0), bsub(y1, y0)));
        if (gt(side, bx(0.0))) { winding = winding + 1; }
      }
    } else if (le(y1, y)) {
      let side = bsub(bmul(bsub(x1, x0), bsub(y, y0)), bmul(bsub(x, x0), bsub(y1, y0)));
      if (lt(side, bx(0.0))) { winding = winding - 1; }
    }
  }
  return winding != 0;
}

// The material of a point: the topmost layer holding it, else the topmost element holding it, else the background.
fn material(p: vec4<f32>) -> u32 {
  let ud = D(p.x, p.y); let vd = D(p.z, p.w);
  let u = bd(ud); let v = bd(vd);
  let layers = ai[1]; let hl = ai[3];
  for (var l = layers; l > 0u; l--) {
    let h = hl + ${CHART_RECORD_STRIDE.layer}u * (l - 1u);
    let f = ai[h + 6u];
    let u0 = bc(af[f]); let v0 = bc(af[f + 1u]); let u1 = bc(af[f + 2u]); let v1 = bc(af[f + 3u]);
    if (lt(u, u0) || gt(u, u1) || lt(v, v0) || gt(v, v1)) { continue; }
    let x = bmul(bsub(u, u0), bc(af[f + 4u])); let y = bmul(bsub(v1, v), bc(af[f + 5u]));
    let cellsX = ai[h]; let cellsY = ai[h + 1u];
    let i = u32(clamp(floor(x.v / af[f + 6u]), 0.0, f32(cellsX - 1u)));
    let j = u32(clamp(floor(y.v / af[f + 7u]), 0.0, f32(cellsY - 1u)));
    let cell = j * cellsX + i;
    let start = ai[ai[h + 2u] + cell]; let end = ai[ai[h + 2u] + cell + 1u];
    for (var e = start; e < end; e++) {
      let shape = ai[h + 4u] + ${CHART_RECORD_STRIDE.shape}u * ai[ai[h + 3u] + e];
      if (shape_contains(shape, x, y)) { return ai[h + 8u]; }
    }
    return ai[h + 7u];
  }
  let elements = ai[0]; let he = ai[2];
  for (var i = elements; i > 0u; i--) {
    let h = he + ${CHART_RECORD_STRIDE.element}u * (i - 1u);
    let kind = ai[h]; let offset = ai[h + 1u]; let ioff = ai[h + 2u]; let foff = ai[h + 3u]; let placement = ai[h + 4u];
    if (placement == ${CHART_PLACEMENT.frame}u) { return offset + classify(kind, ioff, foff + ${CHART_RECORD_STRIDE.placementFloats}u, ud, vd); }
    let du = d_sub(ud, D(af[foff], af[foff + 1u])); let dv = d_sub(vd, D(af[foff + 2u], af[foff + 3u]));
    let hw = bc(af[foff + 4u]); let hh = bc(af[foff + 5u]);
    let bu = bds(du, abs(ud.h) + abs(af[foff])); let bv = bds(dv, abs(vd.h) + abs(af[foff + 2u]));
    if (lt(bu, bneg(hw)) || gt(bu, hw) || lt(bv, bneg(hh)) || gt(bv, hh)) { continue; }
    if (placement == ${CHART_PLACEMENT.ellipse}u) {
      let a = bdiv(bu, hw); let b = bdiv(bv, hh);
      if (gt(badd(bmul(a, a), bmul(b, b)), bx(1.0))) { continue; }
    }
    let scale = D(af[foff + 6u], af[foff + 7u]);
    return offset + classify(kind, ioff, foff + ${CHART_RECORD_STRIDE.placementFloats}u, d_mul(du, scale), d_mul(dv, scale));
  }
  flagged = true;
  return 0u;
}

`;

/** The product path of the double-float32 arithmetic: Dekker's (unfused evaluation as written) or the fma one (a fused `fma`). */
export type ChartCompositeProductPath = "dekker" | "fma";
/** `zero`: the WGSL expression of the host's zero word the rounding barrier reads (a uniform the compiler cannot see). */
const productPath = (template: string, path: ChartCompositeProductPath, zero: string): string => template.replace("d_mul_PRODUCT_PATH", "d_mul_" + path).replaceAll("BARRIER_ZERO", zero);
const commonWgsl = (path: ChartCompositeProductPath, zero: string): string => productPath(COMMON_TEMPLATE, path, zero);
/** The common part without the kernel's own E and SLACK constants, for a display-view module (whose kernel preamble gives them). */
export const chartCompositeModuleCommonWgsl = (path: ChartCompositeProductPath, zero: string): string => productPath(COMMON_CONSTANTS_WGSL + COMMON_BODY_TEMPLATE, path, zero);

/** The composite kernel compiled with one product path (`d_mul`): the probe's choice for the device. */
export function chartCompositeWgsl(path: ChartCompositeProductPath): string {
  return /* wgsl */ `${commonWgsl(path, "params.zero")}
// zero: 0, set by the host; the rounding barrier's word.
struct Params { count: u32, columns: u32, wavelength_mode: u32, zero: u32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> table: array<f32>;
@group(0) @binding(3) var<storage, read> af: array<f32>;
@group(0) @binding(4) var<storage, read> ai: array<u32>;
@group(0) @binding(5) var<storage, read> selectors: array<u32>;
@group(0) @binding(6) var<storage, read_write> values: array<f32>;
@group(0) @binding(7) var<storage, read_write> flags: array<u32>;

${CHART_COMPOSITE_MATERIAL_WGSL}
@compute @workgroup_size(${CHART_COMPOSITE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let i = gid.x + gid.y * groups.x * ${CHART_COMPOSITE_WORKGROUP_SIZE}u;
  if (i >= params.count) { return; }
  flagged = false;
  let m = material(points[i]);
  if (params.wavelength_mode != 0u) {
    values[i] = table[m * params.columns + selectors[i]];
  } else {
    for (var c = 0u; c < params.columns; c++) { values[i * params.columns + c] = table[m * params.columns + c]; }
  }
  flags[i] = select(0u, 1u, flagged);
}
`;
}
/** The composite kernel with the Dekker product path (unchanged since #477). */
export const CHART_COMPOSITE_WGSL = chartCompositeWgsl("dekker");

/**
 * Probe of the double-float32 building blocks on the compiled device, both product paths: for each input (x, y, z, w) it writes
 * TwoSum(x, y), the Dekker and the fma TwoProduct(x, y) low parts, the double-word sum (x, y) + (z, w) low part, and both paths'
 * double-word products (x, y)·(z, w), hi and lo. The host (`classifyChartCompositeProbe`) compares them with the exact values and
 * with the round-to-nearest evaluation in the written order, names the components that differ, classifies the device and picks
 * the product path the composite kernel is compiled with. The functions are the kernel's own (`COMMON_TEMPLATE`).
 */
export const CHART_COMPOSITE_PROBE_WGSL = /* wgsl */ `${commonWgsl("dekker", "probe_zero.x")}
@group(0) @binding(0) var<storage, read> input: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4<f32>>;
// x: 0, set by the host; the rounding barrier's word.
@group(0) @binding(2) var<uniform> probe_zero: vec4<u32>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&input)) { return; }
  let p = input[i];
  let s = two_sum(p.x, p.y);
  let m = two_prod_dekker(p.x, p.y);
  let a = d_add(D(p.x, p.y), D(p.z, p.w));
  let mf = two_prod_fma(p.x, p.y);
  let q = d_mul_dekker(D(p.x, p.y), D(p.z, p.w));
  let qf = d_mul_fma(D(p.x, p.y), D(p.z, p.w));
  output[2u * i] = vec4<f32>(s.l, m.l, a.l, mf.l);
  output[2u * i + 1u] = vec4<f32>(q.h, q.l, qf.h, qf.l);
}
`;
/** Floats the probe writes per input (two vec4). */
export const CHART_COMPOSITE_PROBE_OUTPUTS = 8;
export const CHART_COMPOSITE_PROBE_LABEL = "photivra-chart-composite-probe";
/** Pipeline label of the composite kernel per product path (the pipeline caches key on it). */
export function chartCompositeLabel(path: ChartCompositeProductPath): string { return path === "dekker" ? "photivra-chart-composite" : "photivra-chart-composite-fma"; }
export const CHART_COMPOSITE_LABEL = chartCompositeLabel("dekker");
