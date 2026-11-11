// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernels of the display view's Quality path on the GPU (#479): the exact area mean with diffraction kernels, the
 * anti-aliasing filter's spots and the AHD candidates, in three passes over one band of display
 * rows (docs/WEBGPU.md, "Display view (Quality) on the GPU"; the float64 reference is `renderDisplayView` with
 * `createDisplayViewExpectedSignal`, facade/display-view.ts and facade/expected-signal.ts):
 *
 * 1. **Lattice** (`DISPLAY_VIEW_QUALITY_LATTICE_WGSL` plus the material module): one invocation per lattice point of each
 *    lattice group (offsets that share a fractional shift, as the reference groups them): the chart material at
 *    (p + 0.5 + f_x − W/2)·g, −(q + 0.5 + f_y − H/2)·g (the reference's lattice formula, an exact float32 sum times the
 *    scale rounded once), with the module's uncertainty flag in the top bit.
 * 2. **Sites** (`DISPLAY_VIEW_QUALITY_SITES_WGSL`): one invocation per native site of the band's window: the expected
 *    electrons Σ_t V_c(m_t, t) over the taps t of every group (the combined kernel values per material and channel, formed on
 *    the host in float64 as the reference forms them: Σ_members w·Σ_λ A_c(λ)·K_λ·L_m(λ); without diffraction the offset
 *    weights times the material's channel signal), plus the dark electrons; the readout moments (mean k·e, variance k²e + c₀,
 *    third cumulant k³e) and the clip at the white level; and each quantity's running absolute error bound. With the defocus
 *    disc (#492) the variant `DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL` reads a factored table (one neutral row, one row per
 *    spectral material) and sums each group's dense tap rectangle in blocks, so its bound grows with the kernel's width.
 * 3. **Pixels** (`DISPLAY_VIEW_QUALITY_PIXELS_WGSL`): one invocation per display pixel of the band: for every real pixel of
 *    the footprint, the demosaic candidates (one bilinear, or AHD's two directional linear candidates, each with its full
 *    camera-channel covariance), white balance and the highlight clip, the colour matrix, the tone curve and the clip to
 *    [0, 1] with the skewness term, the candidates' average, the Stein covariance with the closed-form B_c, the independent
 *    residual, AHD's choice variance ¼·Var(H − V), the flag for AHD's choice on the noise-free mosaic, which the reference takes and
 *    the kernel does not (#457). 2.22.0: there is no low-signal correction (docs/DISPLAY_VIEW.md, "AHD at low signal").
 *
 * **Highlights (#533).** The site pass records whether each site is certainly below white, certainly at or above it, or
 * undecided (`clip_state`, from the site's mean and variance and their running bounds: certain only beyond twice the reference's
 * 8.5 standard deviations after moving the mean by twice its bound, where the reference's clip probability is exactly 0 or 1), in
 * bits 1 and 2 of its flag word. The pixel pass marks a real pixel saturated (P = 1) when a site its demosaic reads is certainly
 * clipped, and the display pixel `highlightUndecided` when a real pixel is neither that nor certainly unclipped. Three flag words
 * per display pixel: the flags, then a bit per real pixel j·nx + i of the footprint with P = 1 (36 bits).
 *
 * **Running bounds.** Every quantity after the site table is carried as a pair (value, absolute bound) in float32: the bound
 * of a sum is the sum of the bounds plus one rounding of the result, of a product |a|·Δb + |b|·Δa plus one rounding, of a
 * square root Δv/(2s) plus 4.5 ULP, of a quotient 2.5 ULP plus the propagated terms; the clipped-normal moments add the
 * Speed kernel's clip constants (CLIP_MEAN_U, CLIP_VARIANCE_U per standard deviation or variance) and propagate their inputs
 * with the moments' first-order derivatives at the pixel's own standardized clip levels (∂E/∂m = P(inside), ∂E/∂s = φa − φb,
 * ∂Var/∂m = −s(ρ_a + ρ_b), ∂Var/∂s = s(2ρ − aρ_a − bρ_b) with ρ_a = 2Φa(a − E[g]), ρ_b = 2Qb(b − E[g]), and the slope's
 * (φa − φb)/s and (aφa − bφb)/s; without noise a slope is exact unless the mean's interval straddles a clip level); the
 * Reinhard quadrature adds REINHARD_MEAN_U and REINHARD_VARIANCE_U. Mixed-sign sums (the AHD
 * kernels, the colour matrix) are therefore bounded by the magnitudes of their terms, not relative to their result. The
 * pixel's expected value and variance leave the kernel with their absolute bounds; the host doubles them (MARGIN) and adds
 * the footprint sum's relative term. Second-order terms (products of bounds) and the bound arithmetic's own float32
 * roundings are what the doubling covers.
 *
 * Precision assumptions are those of the Speed kernel: the W3C WGSL accuracy table (+ − × one rounding in either direction,
 * E = 2^-23; division 2.5 ULP, sqrt 4.5 ULP, exp (3 + 2|x|) ULP, log2 2^-21 absolute on [0.5, 2] and 3 ULP outside; no
 * trigonometric built-in).
 */

import { DISPLAY_VIEW_CLIP_MEAN_U, DISPLAY_VIEW_CLIP_VARIANCE_U, DISPLAY_VIEW_REINHARD_MEAN_U, DISPLAY_VIEW_REINHARD_VARIANCE_U } from "./wgsl-display-view-speed-kernel.js";
import { EXACT_SUM_WGSL } from "./wgsl-exact-sum.js";

export const DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE = 64;
/** Largest footprint per axis (real pixels), as the Speed kernel. */
export const DISPLAY_VIEW_QUALITY_MAXIMUM_PIXELS_PER_AXIS = 6;
/** Most spectral nodes the site passes integrate per site (2.21.0: the per-node partials are private arrays of this length). */
export const DISPLAY_VIEW_QUALITY_MAXIMUM_NODES = 96;
/** Uniform parameter words (see `Params`): 56 words, 224 bytes. */
export const DISPLAY_VIEW_QUALITY_PARAM_WORDS = 56;
/** Words per lattice-group record: lx0, ly0, lw, lh, lbase, first tap (the blocked site pass, #492), cu (f32), cv (f32). */
export const DISPLAY_VIEW_QUALITY_GROUP_WORDS = 8;
/** Words per tap record: group, dp offset, dq offset, pad. */
export const DISPLAY_VIEW_QUALITY_TAP_WORDS = 4;
/** Floats per native site of the site buffer: mean, variance, third cumulant, their three bounds, flag (u32 bits), electrons. */
export const DISPLAY_VIEW_QUALITY_SITE_FLOATS = 8;
/** Floats per display pixel in the output buffer: m0 m1 m2, v00 v11 v22, c01 c02 c12, mean bound, variance bound (absolute). */
export const DISPLAY_VIEW_QUALITY_OUTPUT_FLOATS = 11;
/** Floats per column or row record of the geometry buffer (the Speed layout). */
export const DISPLAY_VIEW_QUALITY_GEOMETRY_STRIDE = 20;
/** Candidate table: entries per phase (the 7 × 7 window of AHD's reach 3) and floats per entry (dx, dy, dh0, dh1, dh2, dv0, dv1, dv2). */
export const DISPLAY_VIEW_QUALITY_CANDIDATE_ENTRIES = 49;
export const DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS = 8;
const CANDIDATE_PHASE_STRIDE = 4 + DISPLAY_VIEW_QUALITY_CANDIDATE_ENTRIES * DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS;
/** Layout of the aux table (float32 words). */
export const DISPLAY_VIEW_QUALITY_AUX = /* @__PURE__ */ Object.freeze({
  /** Per phase p, channel c, tap t: dx, dy, weight, 0 (the bilinear kernels, 4 taps; unused taps have weight 0). */
  bilinear: 0,
  /** Per phase p, channel c: 1 / Σ_t w_t² of the bilinear kernel (host float64). */
  inverseW2: 192,
  /** 16 Gauss–Legendre nodes then 16 weights on [−1, 1]. */
  gaussLegendre: 208,
  /** Per phase: the entry count (as u32 bits) and 3 pad words, then the entries (dx, dy, dense weights of candidate 0 and 1 per channel). */
  candidates: 240,
  candidatePhaseStride: CANDIDATE_PHASE_STRIDE,
  size: 240 + 4 * CANDIDATE_PHASE_STRIDE
});
/** Pixel flag bits of the output flag word. */
export const DISPLAY_VIEW_QUALITY_FLAG = /* @__PURE__ */ Object.freeze({
  /** A site the pixel read had an uncertain lattice material (recompute on the host). */
  materialUncertain: 1,
  /** A site the pixel read lies outside the band's site window (a host geometry error; recompute). */
  siteOutsideWindow: 2,
  // Bits 4, 8 and 16 (the low-signal correction's state, threshold and applied flags) are unused since 2.22.0.
  /**
   * #457: the reference takes AHD's choice on the noise-free mosaic (one candidate, or their average on a tie), which the kernel
   * does not compute; it renders the average. The pixel is flagged (recompute) when Σ_j a_j·½|h(H) − h(V)| of some component
   * exceeds `DISPLAY_VIEW_QUALITY_CHOICE_SIGMA` times the pixel's noise standard deviation.
   */
  ahdChoice: 32,
  /** #533: a real pixel's saturation is undecided (the host computes the display pixel's count with the reference; its samples stay). */
  highlightUndecided: 64,
  /** The bits that require the host's recomputation. */
  recompute: 35
});
/** #533: flag words per display pixel: the flags, then the 36-bit mask of saturated real pixels. */
export const DISPLAY_VIEW_QUALITY_FLAG_WORDS = 3;
/**
 * #457: the largest move, in units of the display pixel's own noise σ, that AHD's choice between its candidates may make to a pixel
 * the kernel keeps (it renders the candidates' average and its bound carries the move); a larger one is recomputed on the host. A
 * design tolerance, not a measurement: 2^-10 σ is a tenth of the 0.01 σ to which the float32 tests hold the GPU to the reference.
 */
export const DISPLAY_VIEW_QUALITY_CHOICE_SIGMA = 2 ** -10;
/**
 * A site whose uncertain lattice points (the material module's flag) could move its electrons by more than this fraction of
 * their value is flagged for host recomputation; a smaller uncertainty enters the site's bound instead (the tap weights times
 * the largest value difference between any two materials at that tap).
 */
export const DISPLAY_VIEW_QUALITY_UNCERTAINTY_LIMIT = 2 ** -10;
/** Bound constant of a clipped-normal slope Φ(z) (in units of E): z's 8E through φ·|z| ≤ 0.24 plus the Abramowitz–Stegun 147E. */
export const DISPLAY_VIEW_QUALITY_SLOPE_U = 200;
/** Relative bound of the Reinhard slope E[h′] (in units of E). */
const REINHARD_SLOPE_U = 64;
/** The `E` of the bounds: one WGSL rounding of + − × in either direction, 2^-23. */
const E_LITERAL = "1.1920928955078125e-7";
const literal = (value: number): string => {
  const text = String(Math.fround(value));
  return /[.e]/u.test(text) ? text : `${text}.0`;
};

/** The parameter struct and the bound helpers shared by the three passes. */
export const DISPLAY_VIEW_QUALITY_COMMON_WGSL = /* wgsl */ `
const E: f32 = ${E_LITERAL};
const SLACK: f32 = 1e-14;
const CLIP_REACH: f32 = 8.5;
const CLIP_MEAN_U: f32 = ${literal(DISPLAY_VIEW_CLIP_MEAN_U)};
const CLIP_VARIANCE_U: f32 = ${literal(DISPLAY_VIEW_CLIP_VARIANCE_U)};
const CLIP_SLOPE_U: f32 = ${literal(DISPLAY_VIEW_QUALITY_SLOPE_U)};
const REINHARD_MEAN_U: f32 = ${literal(DISPLAY_VIEW_REINHARD_MEAN_U)};
const REINHARD_VARIANCE_U: f32 = ${literal(DISPLAY_VIEW_REINHARD_VARIANCE_U)};
const REINHARD_SLOPE_U: f32 = ${literal(REINHARD_SLOPE_U)};
const UNCERTAINTY_LIMIT: f32 = ${literal(2 ** -10)};
const STRIDE: u32 = ${DISPLAY_VIEW_QUALITY_GEOMETRY_STRIDE}u;
const SITE: u32 = ${DISPLAY_VIEW_QUALITY_SITE_FLOATS}u;
const GROUP: u32 = ${DISPLAY_VIEW_QUALITY_GROUP_WORDS}u;
const TAP: u32 = ${DISPLAY_VIEW_QUALITY_TAP_WORDS}u;
struct Params {
  count: u32, row0: u32, region_w: u32, region_x: u32,
  region_y: u32, margin: u32, native_w: u32, native_h: u32,
  columns: u32, tone: u32, reach: u32, candidates: u32,
  site_x0: i32, site_y0: i32, site_w: u32, site_h: u32,
  unused_16: u32, unused_17: u32, taps: u32, groups: u32,
  lattice_total: u32, gain_at_clip0: u32, gain_at_clip1: u32, gain_at_clip2: u32,
  k0: f32, k1: f32, k2: f32, reach2: f32,
  dark0: f32, dark1: f32, dark2: f32, clip_level: f32,
  c0_0: f32, c0_1: f32, c0_2: f32, unused_35: f32,
  g0: f32, g1: f32, g2: f32, scale_u: f32,
  m00: f32, m01: f32, m02: f32, m10: f32,
  m11: f32, m12: f32, m20: f32, m21: f32,
  m22: f32, scale_v: f32, site_gamma: f32, site_first: u32,
  site_tiny: f32, nodes: u32, pad_g: f32, pad_h: f32,
};
@group(0) @binding(0) var<uniform> params: Params;

fn k_of(c: u32) -> f32 { if (c == 0u) { return params.k0; } if (c == 1u) { return params.k1; } return params.k2; }
fn dark_of(c: u32) -> f32 { if (c == 0u) { return params.dark0; } if (c == 1u) { return params.dark1; } return params.dark2; }
fn c0_of(c: u32) -> f32 { if (c == 0u) { return params.c0_0; } if (c == 1u) { return params.c0_1; } return params.c0_2; }
fn g_of(c: u32) -> f32 { if (c == 0u) { return params.g0; } if (c == 1u) { return params.g1; } return params.g2; }
// Whether the channel's white-balance gain is the clip level itself (the smallest gain), exactly, in the reference's float64.
fn gain_at_clip(c: u32) -> bool { if (c == 0u) { return params.gain_at_clip0 == 1u; } if (c == 1u) { return params.gain_at_clip1 == 1u; } return params.gain_at_clip2 == 1u; }
fn m_of(r: u32, c: u32) -> f32 {
  let i = r * 3u + c;
  switch (i) {
    case 0u: { return params.m00; } case 1u: { return params.m01; } case 2u: { return params.m02; }
    case 3u: { return params.m10; } case 4u: { return params.m11; } case 5u: { return params.m12; }
    case 6u: { return params.m20; } case 7u: { return params.m21; } default: { return params.m22; }
  }
}
fn channel_of(x: i32, y: i32) -> u32 {
  if ((y & 1) == 0) { return select(1u, 0u, (x & 1) == 0); }
  return select(2u, 1u, (x & 1) == 0);
}
// A value with its absolute error bound (x: value, y: bound). First-order rules; the host doubles the final bound.
fn b_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { let v = a.x + b.x; return vec2<f32>(v, a.y + b.y + E * abs(v)); }
fn b_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { let v = a.x - b.x; return vec2<f32>(v, a.y + b.y + E * abs(v)); }
fn b_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { let v = a.x * b.x; return vec2<f32>(v, abs(a.x) * b.y + abs(b.x) * a.y + E * abs(v)); }
// Times an exact constant (a kernel weight, an integer, a power of two).
fn b_scale(a: vec2<f32>, k: f32) -> vec2<f32> { let v = a.x * k; return vec2<f32>(v, a.y * abs(k) + E * abs(v)); }
// #533: 0 when a site of mean m (bound dm) and variance v (bound dv) is certainly below white, 1 certainly at or above it, 2
// undecided (the Speed kernel's rule: twice the reference's 8.5 standard deviations, the mean moved by twice its bound).
fn clip_state(m: f32, dm: f32, v: f32, dv: f32) -> u32 {
  let gap = 1.0 - m;
  let wide = 4.0 * params.reach2 * (v + 2.0 * dv);
  let below = gap - 2.0 * dm;
  let above = gap + 2.0 * dm;
  if (below > 0.0 && below * below > wide) { return 0u; }
  if (above < 0.0 && above * above > wide) { return 1u; }
  return 2u;
}
// A host constant rounded once to float32 (a gain, a matrix entry).
fn b_rounded(k: f32) -> vec2<f32> { return vec2<f32>(k, E * abs(k)); }
fn b_div(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> { let v = a.x / b.x; return vec2<f32>(v, (a.y + abs(v) * b.y) / abs(b.x) + 2.5 * E * abs(v)); }
// |sqrt(v + d) - sqrt(v)| <= min(d / (2 sqrt v), sqrt d), plus the 4.5 ULP of the built-in.
fn b_sqrt(a: vec2<f32>) -> vec2<f32> {
  let s = sqrt(max(a.x, 0.0));
  if (s > 0.0) { return vec2<f32>(s, min(a.y / (2.0 * s), sqrt(a.y)) + 4.5 * E * s); }
  return vec2<f32>(0.0, sqrt(a.y));
}
// Standard normal density, as the reference forms it, and Abramowitz & Stegun 26.2.17 as (Φ, 1 − Φ).
fn phi(z: f32) -> f32 { return 0.3989422804014327 * exp(-0.5 * z * z); }
fn pq(z: f32) -> vec2<f32> {
  let x = abs(z);
  let t = 1.0 / (1.0 + 0.2316419 * x);
  let q = phi(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (z >= 0.0) { return vec2<f32>(1.0 - q, q); }
  return vec2<f32>(q, 1.0 - q);
}
struct Moments { mean: vec2<f32>, variance: vec2<f32>, slope: vec2<f32> }
// Moments of min(Y, top) for Y ~ N(m, v) with their bounds: Var = v·(Φ − zφ + z²Q − δ²), δ = φ − zQ (the Speed forms).
fn upper_clip(m: vec2<f32>, v: vec2<f32>, top: f32) -> Moments {
  var out: Moments;
  if (!(v.x > 0.0)) {
    // No noise on either side (a zero bound): the reference's slope is 1 or 0 by m < top, decided when m's interval lies on one side.
    let decided = v.y == 0.0 && (m.x - m.y >= top || m.x + m.y < top);
    out.mean = vec2<f32>(min(m.x, top), m.y); out.variance = vec2<f32>(0.0, v.y); out.slope = vec2<f32>(select(0.0, 1.0, m.x < top), select(1.0, 0.0, decided));
    return out;
  }
  let s = b_sqrt(v);
  let z = (top - m.x) / s.x;
  if (z > CLIP_REACH) { out.mean = m; out.variance = v; out.slope = vec2<f32>(1.0, 0.0); return out; }
  if (z < -CLIP_REACH) { out.mean = vec2<f32>(top, 0.0); out.variance = vec2<f32>(0.0, 0.0); out.slope = vec2<f32>(0.0, 0.0); return out; }
  let p = pq(z);
  let d = phi(z);
  let delta = d - z * p.y;
  let ratio = p.x - z * d + z * z * p.y - delta * delta;
  // First-order propagation of the inputs' bounds: with g = min(Z, z), E[g] = −δ and ρ = Var(g) = ratio, ∂E/∂m = Φ, ∂E/∂s = φ,
  // ∂Var/∂m = −s·ρ_z, ∂Var/∂s = s·(2ρ − z·ρ_z) with ρ_z = 2Q·(z + δ), ∂Φ/∂m = −φ/s and ∂Φ/∂s = −zφ/s.
  let rho_z = 2.0 * p.y * (z + delta);
  out.mean = vec2<f32>(m.x - s.x * delta, p.x * m.y + d * s.y + CLIP_MEAN_U * E * s.x);
  out.variance = vec2<f32>(v.x * max(0.0, ratio), s.x * abs(rho_z) * m.y + s.x * abs(2.0 * ratio - z * rho_z) * s.y + CLIP_VARIANCE_U * E * v.x);
  out.slope = vec2<f32>(p.x, min(1.0, (d * m.y + abs(z) * d * s.y) / s.x + CLIP_SLOPE_U * E));
  return out;
}
// Moments of clip(Y, 0, 1) for Y with mean m, variance v and standardized skewness γ (|γ| ≤ 1), with their bounds (the
// Speed forms: W = m + s·g(Z), E[g] = aΦa + φa − φb + bQb, E[g²] = a²Φa + (Φb − Φa) − (bφb − aφa) + b²Qb, the Edgeworth
// shift (s·γ/6)·(aφa − bφb) on the mean and −shift·(2·E[Y] + shift) on the variance).
fn unit_clip(m: vec2<f32>, v: vec2<f32>, skew: vec2<f32>) -> Moments {
  var out: Moments;
  if (!(v.x > 0.0)) {
    let decided = v.y == 0.0 && ((m.x - m.y > 0.0 && m.x + m.y < 1.0) || m.x + m.y <= 0.0 || m.x - m.y >= 1.0);
    out.mean = vec2<f32>(clamp(m.x, 0.0, 1.0), m.y); out.variance = vec2<f32>(0.0, v.y); out.slope = vec2<f32>(select(0.0, 1.0, m.x > 0.0 && m.x < 1.0), select(1.0, 0.0, decided));
    return out;
  }
  let s = b_sqrt(v);
  let a = -m.x / s.x;
  let b = (1.0 - m.x) / s.x;
  if (a < -CLIP_REACH && b > CLIP_REACH) { out.mean = m; out.variance = v; out.slope = vec2<f32>(1.0, 0.0); return out; }
  var pa = 0.0; var da = 0.0;
  if (!(a < -CLIP_REACH)) { pa = pq(a).x; da = phi(a); }
  var pb = 1.0; var qb = 0.0; var db = 0.0;
  if (!(b > CLIP_REACH)) { let p = pq(b); pb = p.x; qb = p.y; db = phi(b); }
  let inside = pb - pa;
  let gamma = clamp(skew.x, -1.0, 1.0);
  let aa = a * da;
  let bb = b * db;
  let eg = a * pa + (da - db) + b * qb;
  let eg2 = a * a * pa + inside - (bb - aa) + b * b * qb;
  let normal_mean = m.x + s.x * eg;
  var mean = normal_mean;
  var shift = 0.0;
  if (gamma != 0.0) { shift = s.x * gamma / 6.0 * (aa - bb); mean = normal_mean + shift; }
  // |aφa − bφb| ≤ 0.48, so |shift| ≤ 0.08·s·|γ| and a wrong γ moves it by at most 0.16·s.
  let d_shift = 0.1 * s.x * min(2.0, skew.y) + 0.1 * abs(gamma) * s.y + E * abs(shift);
  // First-order propagation of the inputs' bounds: with ρ = E[g²] − E[g]², ∂E[g]/∂a = Φa, ∂E[g]/∂b = Qb, ∂E[g²]/∂a = 2aΦa,
  // ∂E[g²]/∂b = 2bQb, so ρ_a = 2Φa(a − E[g]), ρ_b = 2Qb(b − E[g]); ∂E/∂m = inside, ∂E/∂s = φa − φb, ∂Var/∂m = −s(ρ_a + ρ_b),
  // ∂Var/∂s = s(2ρ − aρ_a − bρ_b); the slope's derivatives are (φa − φb)/s and (aφa − bφb)/s.
  let rho = eg2 - eg * eg;
  let rho_a = 2.0 * pa * (a - eg);
  let rho_b = 2.0 * qb * (b - eg);
  let d_mean = m.y * inside + abs(da - db) * s.y + 2.0 * CLIP_MEAN_U * E * s.x + d_shift;
  // The normal part X = v·ρ and its bound; the reference's variance is max(0, X − shift·(2·E[Y] + shift)), so it lies in
  // [0, X_cpu] when the shift term is non-negative on both sides (shift > Δshift), which caps the bound by max(Var, X + ΔX).
  let normal_variance = v.x * rho;
  let d_normal = s.x * abs(rho_a + rho_b) * m.y + s.x * abs(2.0 * rho - a * rho_a - b * rho_b) * s.y + 2.0 * CLIP_VARIANCE_U * E * v.x;
  let variance = max(0.0, normal_variance - shift * (2.0 * normal_mean + shift));
  var d_var = d_normal + 2.0 * (d_shift * (abs(normal_mean) + abs(shift)) + abs(shift) * d_mean);
  if (shift > d_shift) { d_var = min(d_var, max(variance, max(0.0, normal_variance) + d_normal)); }
  out.mean = vec2<f32>(mean, d_mean);
  out.variance = vec2<f32>(variance, d_var);
  out.slope = vec2<f32>(inside, min(1.0, (abs(da - db) * m.y + abs(aa - bb) * s.y) / s.x + 2.0 * CLIP_SLOPE_U * E));
  return out;
}
`;

/** The Gauss–Legendre Reinhard moments read the aux table, so they live in the pixel kernel. */
const REINHARD_WGSL = /* wgsl */ `
// Positive Reinhard per channel then the clip to [0, 1]: h(x) = x/(1 + x) for x > 0, else 0, by the reference's composite
// 16-point Gauss–Legendre rule in standardized units (the Speed forms), with the bounds of the quadrature (REINHARD_*_U)
// and of its inputs (|h′| ≤ 1, |h″| ≤ 2).
fn reinhard_moments(m: vec2<f32>, v: vec2<f32>) -> Moments {
  var out: Moments;
  if (!(v.x > 0.0)) {
    if (m.x > 0.0) {
      let h = m.x / (1.0 + m.x);
      out.mean = vec2<f32>(h, m.y + 4.0 * E * h); out.variance = vec2<f32>(0.0, v.y); out.slope = vec2<f32>(1.0 / ((1.0 + m.x) * (1.0 + m.x)), min(1.0, 2.0 * m.y + 6.0 * E));
      return out;
    }
    out.mean = vec2<f32>(0.0, m.y); out.variance = vec2<f32>(0.0, v.y); out.slope = vec2<f32>(0.0, 1.0);
    return out;
  }
  let s = b_sqrt(v);
  let zlo = max(-m.x / s.x, -CLIP_REACH);
  if (!(CLIP_REACH > zlo)) { out.mean = vec2<f32>(0.0, m.y + s.y); out.variance = vec2<f32>(0.0, v.y); out.slope = vec2<f32>(0.0, 1.0); return out; }
  let hm = select(0.0, m.x / (1.0 + m.x), m.x > 0.0);
  var e1 = 0.0; var e2 = 0.0; var ed = 0.0;
  let zwidth = (CLIP_REACH - zlo) / 4.0;
  for (var p = 0u; p < 4u; p = p + 1u) {
    let zc = zlo + (f32(p) + 0.5) * zwidth;
    let zhalf = zwidth / 2.0;
    for (var k = 0u; k < 16u; k = k + 1u) {
      let z = zc + zhalf * aux[${DISPLAY_VIEW_QUALITY_AUX.gaussLegendre}u + k];
      let x = m.x + s.x * z;
      let weight = zhalf * aux[${DISPLAY_VIEW_QUALITY_AUX.gaussLegendre + 16}u + k] * phi(z);
      let h = x / (1.0 + x);
      e1 = e1 + weight * h;
      e2 = e2 + weight * (h - hm) * (h - hm);
      ed = ed + weight / ((1.0 + x) * (1.0 + x));
    }
  }
  let shifted = e1 - hm;
  let variance = max(0.0, e2 - shifted * shifted);
  out.mean = vec2<f32>(e1, m.y + s.y + REINHARD_MEAN_U * E * abs(e1));
  out.variance = vec2<f32>(variance, 2.0 * s.x * m.y + 2.0 * v.y + REINHARD_VARIANCE_U * E * variance);
  out.slope = vec2<f32>(ed, min(1.0, 2.0 * m.y + 2.0 * s.y + REINHARD_SLOPE_U * E));
  return out;
}
`;

/**
 * Pass 1: the material of every lattice point of every group (the module's `material_at`, its uncertainty in bit 31; the output
 * is `lattice_out`, since a material module may declare its own `lattice`, as #491's composite module does). The group
 * records hold each group's lattice window (lx0, ly0, lw, lh), its first index in the lattice buffer and the point constants
 * c_u = 0.5 + f_x − W/2 and c_v = 0.5 + f_y − H/2 (exact in float32, checked by the host).
 */
export const DISPLAY_VIEW_QUALITY_LATTICE_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(2) var<storage, read_write> lattice_out: array<u32>;
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let i = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (i >= params.lattice_total) { return; }
  var g = 0u;
  for (var k = 1u; k < params.groups; k = k + 1u) { if (i >= groups[k * GROUP + 4u]) { g = k; } }
  let base = g * GROUP;
  let lx0 = bitcast<i32>(groups[base]);
  let ly0 = bitcast<i32>(groups[base + 1u]);
  let lw = groups[base + 2u];
  let local = i - groups[base + 4u];
  let q = ly0 + i32(local / lw);
  let p = lx0 + i32(local % lw);
  let u = (f32(p) + bitcast<f32>(groups[base + 6u])) * params.scale_u;
  let v = (f32(q) + bitcast<f32>(groups[base + 7u])) * params.scale_v;
  material_uncertain = false;
  let m = material_at(vec2<f32>(u, v));
  lattice_out[i] = m | select(0u, 0x80000000u, material_uncertain);
}
`;

/**
 * The end of pass 2, shared by both site passes: from the site's electrons e and their absolute bound de, the readout moments
 * (mean k·e, variance k²e + c₀, third cumulant k³e), the clip at the white level and their bounds, written to site i.
 */
export const DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL = /* wgsl */ `
fn write_site(i: u32, c: u32, e: f32, de: f32, flag: u32) {
  let kc = k_of(c);
  let mean = kc * e;
  let variance = kc * kc * e + c0_of(c);
  let third = kc * kc * kc * e;
  var m = vec2<f32>(mean, kc * de + 2.0 * E * mean);
  var v = vec2<f32>(variance, kc * kc * de + 4.0 * E * variance);
  let gap = 1.0 - mean;
  // #533: bits 1 (certainly clipped) and 2 (undecided) of the flag word.
  let state = clip_state(m.x, m.y, v.x, v.y);
  let bits = flag | select(0u, 2u, state == 1u) | select(0u, 4u, state == 2u);
  if (!(gap > 0.0 && gap * gap > params.reach2 * variance)) {
    let clipped = upper_clip(m, v, 1.0);
    m = clipped.mean; v = clipped.variance;
  }
  let o = i * SITE;
  sites[o] = m.x; sites[o + 1u] = v.x; sites[o + 2u] = third;
  sites[o + 3u] = m.y; sites[o + 4u] = v.y; sites[o + 5u] = kc * kc * kc * de + 5.0 * E * third;
  sites[o + 6u] = bitcast<f32>(bits); sites[o + 7u] = e;
}
`;

/**
 * The bindings of the site passes (pass 2); the blocked pass reads no tap records, so it declares no binding 2 (an automatic
 * layout leaves out a binding the entry point does not use, and the host binds it only for the tap-list pass).
 */
const siteBindingsWgsl = (tapRecords: boolean): string => /* wgsl */ `
@group(0) @binding(1) var<storage, read> groups: array<u32>;${tapRecords ? `
@group(0) @binding(2) var<storage, read> taps: array<u32>;` : ""}
@group(0) @binding(3) var<storage, read> table: array<f32>;
@group(0) @binding(4) var<storage, read> lattice: array<u32>;
@group(0) @binding(5) var<storage, read_write> sites: array<f32>;
@group(0) @binding(6) var<storage, read> spread: array<f32>;
${EXACT_SUM_WGSL}
alias Nodes = array<f32, ${DISPLAY_VIEW_QUALITY_MAXIMUM_NODES}>;
fn add_tap(p: ptr<function, Nodes>, c: u32, t: u32, m: u32) {
  let N = params.nodes;
  for (var n = 0u; n < N; n = n + 1u) { (*p)[n] = (*p)[n] + table[(c * params.taps + t) * N + n] * table[(3u * params.taps + m) * N + n]; }
}
fn add_nodes(p: ptr<function, Nodes>, q: ptr<function, Nodes>) { for (var n = 0u; n < params.nodes; n = n + 1u) { (*p)[n] = (*p)[n] + (*q)[n]; (*q)[n] = 0.0; } }
fn node_total(p: ptr<function, Nodes>, dark: f32) -> f32 {
  var anchor = exact_exponent(dark);
  for (var k = 0u; k < params.nodes; k = k + 1u) { if ((*p)[k] > 0.0) { anchor = max(anchor, exact_exponent((*p)[k])); } }
  var sum: ExactSum;
  sum.anchor = anchor;
  for (var k = 0u; k < params.nodes; k = k + 1u) { exact_add(&sum, (*p)[k]); }
  exact_add(&sum, dark);
  return exact_round(&sum);
}
`;

/**
 * Pass 2: the expected electrons, readout moments and white clip of every native site of the band's window, with their bounds.
 * 2.21.0 (signals integrated from the material spectrum per site): the site's electrons are Σ_t Σ_n C_c(t, n)·L_{m_t}(λ_n) +
 * dark_c, from the channel's per-node kernel values and the spectrum of the material each tap reads (`table`: C at
 * (c·T + t)·N + n, the spectra from 3·T·N), accumulated per node over the taps, then the node partials and the dark electrons
 * summed in integer arithmetic and rounded once (EXACT_SUM_WGSL). Every term is non-negative and carries two host roundings (E/2
 * each), its product (E) and at most T − 1 additions, then the final rounding (E), and the dark electrons their host rounding
 * (E/2), so the sum carries at most (T + 2.5)·E, inside (T + 3)·E
 * (`params.site_gamma`),
 * plus `params.site_tiny`, the host's absolute bound on what a device that flushes below the float32 normal range can drop. An uncertain lattice point adds the tap's value spread
 * over the materials (`spread`, host float64) to the site's uncertainty, which enters its bounds, or flags the site when it
 * exceeds UNCERTAINTY_LIMIT of the electrons. One dispatch covers the `params.count` sites from `params.site_first` (#492: the
 * host splits a band's sites over several dispatches so that no dispatch gathers more than its tap budget).
 */
export const DISPLAY_VIEW_QUALITY_SITES_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}${siteBindingsWgsl(true)}${DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL}
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
  var uncertainty = 0.0;
  let T = params.taps;
  var partial: Nodes;
  for (var t = 0u; t < T; t = t + 1u) {
    let tb = t * TAP;
    let g = taps[tb] * GROUP;
    let index = groups[g + 4u] + (jj + taps[tb + 2u]) * groups[g + 2u] + ii + taps[tb + 1u];
    let raw = lattice[index];
    if ((raw >> 31u) != 0u) { uncertainty = uncertainty + spread[c * T + t]; }
    add_tap(&partial, c, t, raw & 0x7fffffffu);
  }
  let e = node_total(&partial, dark_of(c));
  let flag = select(0u, 1u, uncertainty > UNCERTAINTY_LIMIT * e);
  let de = params.site_gamma * e + uncertainty + params.site_tiny;
  write_site(i, c, e, de, flag);
}
`;

/**
 * Pass 2 with the defocus disc (#492): the same site electrons, summed in blocks.
 *
 * - **Spectral table.** The pass reads the tap-list pass's table (2.21.0): the channel's per-node kernel values C_c(t, n) and each
 *   material's spectrum, so the signal of each tap is integrated from its material's spectrum when the site is read.
 * - **Blocked sum.** Every group's taps form a dense cw × ch rectangle (the combined kernel's window, row-major from the group's
 *   first tap, `groups[g + 5]`), so a site sums each row of a group into a row partial per node, the rows into a group partial
 *   and the groups into the total, then the nodes in integer arithmetic. No tap records are read: the tap's lattice offset
 *   within its group is its (dx, dy).
 *
 * Every term is non-negative and carries two host roundings (u each, u = E/2: the kernel value and the spectrum), one product
 * (E) and at most cw − 1 + ch − 1 + G − 1 inexact additions, then the integer sum of the node partials and the dark electrons,
 * rounded once (E), and the dark electrons' host rounding (E/2), so the electrons carry at most (cw_max + ch_max + G + 0.5)·E, inside (cw_max + ch_max + G + 3)·E (`params.site_gamma`;
 * recursive summation of the up to 4·(2·96 + 2)² = 150 544 taps of a combined radius of 96 would carry (T + 3)·E ≈ 1.8 %
 * instead). The uncertainty, summed the same way, is scaled by 1 + site_gamma, and `params.site_tiny` (host float64, rounded up)
 * bounds what a device that flushes results below the float32 normal range can drop (the tap-list pass adds it too).
 */
export const DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}${siteBindingsWgsl(false)}
${DISPLAY_VIEW_QUALITY_SITE_TAIL_WGSL}
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
  let T = params.taps;
  var total: Nodes;
  var group_sum: Nodes;
  var row_sum: Nodes;
  var uncertainty = 0.0;
  for (var k = 0u; k < params.groups; k = k + 1u) {
    let g = k * GROUP;
    let lw = groups[g + 2u];
    let cw = lw - params.site_w + 1u;
    let ch = groups[g + 3u] - params.site_h + 1u;
    let lattice0 = groups[g + 4u] + jj * lw + ii;
    let tap0 = groups[g + 5u];
    var group_uncertainty = 0.0;
    for (var dy = 0u; dy < ch; dy = dy + 1u) {
      let row = lattice0 + dy * lw;
      let row_tap = tap0 + dy * cw;
      var row_uncertainty = 0.0;
      for (var dx = 0u; dx < cw; dx = dx + 1u) {
        let raw = lattice[row + dx];
        let t = row_tap + dx;
        if ((raw >> 31u) != 0u) { row_uncertainty = row_uncertainty + spread[c * T + t]; }
        add_tap(&row_sum, c, t, raw & 0x7fffffffu);
      }
      add_nodes(&group_sum, &row_sum);
      group_uncertainty = group_uncertainty + row_uncertainty;
    }
    add_nodes(&total, &group_sum);
    uncertainty = uncertainty + group_uncertainty;
  }
  let e = node_total(&total, dark_of(c));
  let flag = select(0u, 1u, uncertainty > UNCERTAINTY_LIMIT * e);
  let de = params.site_gamma * e + uncertainty * (1.0 + params.site_gamma) + params.site_tiny;
  write_site(i, c, e, de, flag);
}
`;

/** Pass 3: the display pixels (see the module comment). */
export const DISPLAY_VIEW_QUALITY_PIXELS_WGSL = /* wgsl */ `${DISPLAY_VIEW_QUALITY_COMMON_WGSL}
const CAND_BASE: u32 = ${DISPLAY_VIEW_QUALITY_AUX.candidates}u;
const CAND_STRIDE: u32 = ${CANDIDATE_PHASE_STRIDE}u;
const FLAG_UNCERTAIN: u32 = ${DISPLAY_VIEW_QUALITY_FLAG.materialUncertain}u;
const FLAG_OUTSIDE: u32 = ${DISPLAY_VIEW_QUALITY_FLAG.siteOutsideWindow}u;
const FLAG_CHOICE: u32 = ${DISPLAY_VIEW_QUALITY_FLAG.ahdChoice}u;
const FLAG_HIGHLIGHT: u32 = ${DISPLAY_VIEW_QUALITY_FLAG.highlightUndecided}u;
const CHOICE_SIGMA: f32 = ${literal(DISPLAY_VIEW_QUALITY_CHOICE_SIGMA)};
@group(0) @binding(1) var<storage, read> aux: array<f32>;
@group(0) @binding(2) var<storage, read> geometry: array<f32>;
@group(0) @binding(3) var<storage, read> sites: array<f32>;
@group(0) @binding(4) var<storage, read_write> out: array<f32>;
@group(0) @binding(5) var<storage, read_write> flags: array<u32>;

var<private> pixel_flags: u32;
${REINHARD_WGSL}
fn reflect_x(x: i32) -> i32 { if (x < 0) { return -x; } if (x >= i32(params.native_w)) { return 2 * i32(params.native_w) - 2 - x; } return x; }
fn reflect_y(y: i32) -> i32 { if (y < 0) { return -y; } if (y >= i32(params.native_h)) { return 2 * i32(params.native_h) - 2 - y; } return y; }
// The site buffer offset of native site (x, y) (reflected at the raster's borders), or a flag when it lies outside the window.
fn site_at(x: i32, y: i32) -> u32 {
  let rx = reflect_x(x) - params.site_x0;
  let ry = reflect_y(y) - params.site_y0;
  if (rx < 0 || ry < 0 || rx >= i32(params.site_w) || ry >= i32(params.site_h)) { pixel_flags = pixel_flags | FLAG_OUTSIDE; return 0u; }
  let o = (u32(ry) * params.site_w + u32(rx)) * SITE;
  pixel_flags = pixel_flags | (bitcast<u32>(sites[o + 6u]) & 1u);
  return o;
}
// #533: the clip state bits (1 certainly clipped, 2 undecided) of the site at offset o.
fn clip_bits(o: u32) -> u32 { return (bitcast<u32>(sites[o + 6u]) >> 1u) & 3u; }
@compute @workgroup_size(${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let i = gid.x + gid.y * wg.x * ${DISPLAY_VIEW_QUALITY_WORKGROUP_SIZE}u;
  if (i >= params.count) { return; }
  pixel_flags = 0u;
  let rx = i % params.region_w;
  let ry = params.row0 + i / params.region_w;
  let col = rx * STRIDE;
  let row = (params.columns + ry) * STRIDE;
  let col_first = bitcast<i32>(geometry[col]);
  let nx = bitcast<u32>(geometry[col + 1u]);
  let row_first = bitcast<i32>(geometry[row]);
  let ny = bitcast<u32>(geometry[row + 1u]);
  let margin = i32(params.margin);
  let reinhard = params.tone == 1u;
  let count = params.candidates;
  let share = select(1.0, 0.5, count == 2u);
  // B_c of the footprint from the host's axis sums (each over its scale squared): red, green, blue.
  let xb_even = geometry[col + 8u]; let xb_odd = geometry[col + 9u];
  let xpp_even = geometry[col + 10u]; let xpp_odd = geometry[col + 11u];
  let xqq_even = geometry[col + 12u]; let xqq_odd = geometry[col + 13u];
  let xpq_even = geometry[col + 14u]; let xpq_odd = geometry[col + 15u];
  let yb_even = geometry[row + 8u]; let yb_odd = geometry[row + 9u];
  let ypp_even = geometry[row + 10u]; let ypp_odd = geometry[row + 11u];
  let yqq_even = geometry[row + 12u]; let yqq_odd = geometry[row + 13u];
  let ypq_even = geometry[row + 14u]; let ypq_odd = geometry[row + 15u];
  let b0 = xb_even * yb_even;
  let b1 = (xpp_odd * ypp_even + xqq_odd * ypp_even + xpp_odd * yqq_even + 2.0 * xpq_odd * ypp_even + 2.0 * xpp_odd * ypq_even + 2.0 * xpq_odd * ypq_even) +
    (xpp_even * ypp_odd + xqq_even * ypp_odd + xpp_even * yqq_odd + 2.0 * xpq_even * ypp_odd + 2.0 * xpp_even * ypq_odd + 2.0 * xpq_even * ypq_odd);
  let b2 = xb_odd * yb_odd;
  var s = array<vec2<f32>, 3>(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
  var cov = array<vec2<f32>, 6>(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
  var res = array<vec2<f32>, 3>(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
  // #457: Σ_j a_j·½|h(H) − h(V)| per component, how far the reference's choice can move the value from the candidates' average.
  var choice = array<f32, 3>(0.0, 0.0, 0.0);
  // #533: the saturated real pixels (bit j·nx + i) and whether a real pixel is undecided.
  var mask0 = 0u; var mask1 = 0u; var undecided = false;
  for (var j = 0u; j < ny; j = j + 1u) {
    let ay = geometry[row + 2u + j];
    for (var ii = 0u; ii < nx; ii = ii + 1u) {
      // The overlap weight a_j: two host roundings (the overlaps over the scale) and the product.
      let aj = vec2<f32>(geometry[col + 2u + ii] * ay, 3.0 * E * abs(geometry[col + 2u + ii] * ay));
      let x = col_first + i32(ii) + margin;
      let y = row_first + i32(j) + margin;
      let phase = u32(y & 1) * 2u + u32(x & 1);
      // Site variance of each channel through the bilinear kernels, over Σw² (for B_c).
      var csv: array<vec2<f32>, 3>;
      for (var c = 0u; c < 3u; c = c + 1u) {
        var variance = vec2<f32>(0.0, 0.0);
        let tb = ${DISPLAY_VIEW_QUALITY_AUX.bilinear}u + (phase * 3u + c) * 16u;
        for (var t = 0u; t < 4u; t = t + 1u) {
          let w = aux[tb + 4u * t + 2u];
          if (w == 0.0) { continue; }
          let o = site_at(x + i32(aux[tb + 4u * t]), y + i32(aux[tb + 4u * t + 1u]));
          variance = b_add(variance, b_scale(vec2<f32>(sites[o + 1u], sites[o + 4u]), w * w));
        }
        csv[c] = b_mul(variance, b_rounded(aux[${DISPLAY_VIEW_QUALITY_AUX.inverseW2}u + phase * 3u + c]));
      }
      let cb = CAND_BASE + phase * CAND_STRIDE;
      let entries = bitcast<u32>(aux[cb]);
      // #533: the sites the demosaic reads (the bilinear kernels and every candidate's entries), as the reference's sample does.
      var clip_any = 0u;
      for (var c = 0u; c < 3u; c = c + 1u) {
        let tb = ${DISPLAY_VIEW_QUALITY_AUX.bilinear}u + (phase * 3u + c) * 16u;
        for (var t = 0u; t < 4u; t = t + 1u) {
          if (aux[tb + 4u * t + 2u] == 0.0) { continue; }
          clip_any = clip_any | clip_bits(site_at(x + i32(aux[tb + 4u * t]), y + i32(aux[tb + 4u * t + 1u])));
        }
      }
      for (var n = 0u; n < entries; n = n + 1u) {
        let eb = cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u;
        var used = false;
        for (var k = 0u; k < 3u * count; k = k + 1u) { if (aux[eb + 2u + k] != 0.0) { used = true; } }
        if (used) { clip_any = clip_any | clip_bits(site_at(x + i32(aux[eb]), y + i32(aux[eb + 1u]))); }
      }
      if ((clip_any & 1u) != 0u) {
        let bit = j * nx + ii;
        if (bit < 32u) { mask0 = mask0 | (1u << bit); } else { mask1 = mask1 | (1u << (bit - 32u)); }
      } else if ((clip_any & 2u) != 0u) { undecided = true; }
      var e_mean = array<vec2<f32>, 3>(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
      var bs: array<vec2<f32>, 3>; var hs: array<vec2<f32>, 3>;
      var hv: array<vec2<f32>, 3>;
      // #457: each candidate's rendered mean, for the reference's choice between them.
      var h_cand = array<vec2<f32>, 6>(vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0), vec2<f32>(0.0));
      for (var d = 0u; d < count; d = d + 1u) {
        // Camera-channel mean and covariance of candidate d from its dense weights over the window.
        var cm: array<vec2<f32>, 3>;
        var C: array<vec2<f32>, 6>;
        // Whether every site a channel reads is exactly at white (a zero bound: the reference's site is exactly 1 too); the
        // dyadic kernel weights then sum exactly on both sides, so the channel's mean carries no error (the host checks the weights).
        var exact = array<bool, 3>(true, true, true);
        for (var c = 0u; c < 3u; c = c + 1u) { cm[c] = vec2<f32>(0.0, 0.0); }
        for (var k = 0u; k < 6u; k = k + 1u) { C[k] = vec2<f32>(0.0, 0.0); }
        for (var n = 0u; n < entries; n = n + 1u) {
          let eb = cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u + 2u + d * 3u;
          let w0 = aux[eb]; let w1 = aux[eb + 1u]; let w2 = aux[eb + 2u];
          if (w0 == 0.0 && w1 == 0.0 && w2 == 0.0) { continue; }
          let o = site_at(x + i32(aux[cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u]), y + i32(aux[cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u + 1u]));
          let sm = vec2<f32>(sites[o], sites[o + 3u]);
          let sv = vec2<f32>(sites[o + 1u], sites[o + 4u]);
          let white = sm.y == 0.0 && sm.x == 1.0;
          exact[0] = exact[0] && (white || w0 == 0.0); exact[1] = exact[1] && (white || w1 == 0.0); exact[2] = exact[2] && (white || w2 == 0.0);
          cm[0] = b_add(cm[0], b_scale(sm, w0)); cm[1] = b_add(cm[1], b_scale(sm, w1)); cm[2] = b_add(cm[2], b_scale(sm, w2));
          C[0] = b_add(C[0], b_scale(sv, w0 * w0)); C[1] = b_add(C[1], b_scale(sv, w0 * w1)); C[2] = b_add(C[2], b_scale(sv, w0 * w2));
          C[3] = b_add(C[3], b_scale(sv, w1 * w1)); C[4] = b_add(C[4], b_scale(sv, w1 * w2)); C[5] = b_add(C[5], b_scale(sv, w2 * w2));
        }
        for (var c = 0u; c < 3u; c = c + 1u) { if (exact[c]) { cm[c].y = 0.0; } }
        // White balance and the highlight clip at the smallest gain. A channel exactly at white whose gain is the clip level is
        // exactly at the clip level on both sides.
        var bm: array<vec2<f32>, 3>; var bv: array<vec2<f32>, 3>;
        for (var c = 0u; c < 3u; c = c + 1u) {
          let gc = b_rounded(g_of(c));
          var um = b_mul(gc, cm[c]);
          if (exact[c] && cm[c].x == 1.0 && gain_at_clip(c)) { um = vec2<f32>(params.clip_level, 0.0); }
          let uv = b_mul(b_mul(gc, gc), C[select(select(0u, 3u, c == 1u), 5u, c == 2u)]);
          let gap = params.clip_level - um.x;
          if (gap > 0.0 && gap * gap > params.reach2 * uv.x) { bm[c] = um; bv[c] = uv; bs[c] = gc; }
          else { let clipped = upper_clip(um, uv, params.clip_level); bm[c] = clipped.mean; bv[c] = clipped.variance; bs[c] = b_mul(gc, clipped.slope); }
        }
        // Colour matrix with the full channel covariance, then the rendering of each component.
        var hm: array<vec2<f32>, 3>;
        for (var comp = 0u; comp < 3u; comp = comp + 1u) {
          let r0 = b_rounded(m_of(comp, 0u)); let r1 = b_rounded(m_of(comp, 1u)); let r2 = b_rounded(m_of(comp, 2u));
          let mean = b_add(b_add(b_mul(r0, bm[0]), b_mul(r1, bm[1])), b_mul(r2, bm[2]));
          var variance = b_add(b_add(b_mul(b_mul(r0, r0), bv[0]), b_mul(b_mul(r1, r1), bv[1])), b_mul(b_mul(r2, r2), bv[2]));
          let x01 = b_mul(b_mul(b_mul(r0, r1), b_mul(bs[0], bs[1])), C[1]);
          let x02 = b_mul(b_mul(b_mul(r0, r2), b_mul(bs[0], bs[2])), C[2]);
          let x12 = b_mul(b_mul(b_mul(r1, r2), b_mul(bs[1], bs[2])), C[4]);
          variance = b_add(variance, b_scale(b_add(b_add(x01, x02), x12), 2.0));
          var moments: Moments;
          if (!reinhard && mean.x > 0.0 && mean.x < 1.0 && mean.x * mean.x > params.reach2 * variance.x && (1.0 - mean.x) * (1.0 - mean.x) > params.reach2 * variance.x) {
            moments.mean = mean; moments.variance = variance; moments.slope = vec2<f32>(1.0, 0.0);
          } else if (reinhard) {
            moments = reinhard_moments(mean, variance);
          } else {
            // κ₃ of the component: Σ_sites (Σ_c M_comp,c·Γ_c·w_c,site)³·κ₃(site), over the candidate's dense weights.
            var third = vec2<f32>(0.0, 0.0);
            let k0 = b_mul(r0, bs[0]); let k1 = b_mul(r1, bs[1]); let k2 = b_mul(r2, bs[2]);
            for (var n = 0u; n < entries; n = n + 1u) {
              let eb = cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u + 2u + d * 3u;
              let w0 = aux[eb]; let w1 = aux[eb + 1u]; let w2 = aux[eb + 2u];
              if (w0 == 0.0 && w1 == 0.0 && w2 == 0.0) { continue; }
              let o = site_at(x + i32(aux[cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u]), y + i32(aux[cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u + 1u]));
              let coefficient = b_add(b_add(b_scale(k0, w0), b_scale(k1, w1)), b_scale(k2, w2));
              let cube = b_mul(b_mul(coefficient, coefficient), coefficient);
              third = b_add(third, b_mul(cube, vec2<f32>(sites[o + 2u], sites[o + 5u])));
            }
            var skew = vec2<f32>(0.0, 0.0);
            if (variance.x > 0.0) { skew = b_div(third, b_mul(variance, b_sqrt(variance))); }
            moments = unit_clip(mean, variance, skew);
          }
          hm[comp] = moments.mean; hv[comp] = moments.variance; hs[comp] = moments.slope;
          h_cand[d * 3u + comp] = moments.mean;
          e_mean[comp] = b_add(e_mean[comp], b_scale(moments.mean, share));
        }
        // Linear (Stein) part with B_c·σ_c², and the pixel's own linear variance aᵀCa for the residual.
        var an: array<vec2<f32>, 9>;
        for (var c = 0u; c < 3u; c = c + 1u) {
          an[c] = b_mul(b_mul(hs[0], b_rounded(m_of(0u, c))), bs[c]);
          an[3u + c] = b_mul(b_mul(hs[1], b_rounded(m_of(1u, c))), bs[c]);
          an[6u + c] = b_mul(b_mul(hs[2], b_rounded(m_of(2u, c))), bs[c]);
          var bc = b0; if (c == 1u) { bc = b1; } if (c == 2u) { bc = b2; }
          let wgt = b_mul(b_mul(b_scale(aj, share), b_rounded(bc)), csv[c]);
          cov[0] = b_add(cov[0], b_mul(b_mul(wgt, an[c]), an[c])); cov[1] = b_add(cov[1], b_mul(b_mul(wgt, an[c]), an[3u + c])); cov[2] = b_add(cov[2], b_mul(b_mul(wgt, an[c]), an[6u + c]));
          cov[3] = b_add(cov[3], b_mul(b_mul(wgt, an[3u + c]), an[3u + c])); cov[4] = b_add(cov[4], b_mul(b_mul(wgt, an[3u + c]), an[6u + c])); cov[5] = b_add(cov[5], b_mul(b_mul(wgt, an[6u + c]), an[6u + c]));
        }
        for (var comp = 0u; comp < 3u; comp = comp + 1u) {
          var l = vec2<f32>(0.0, 0.0);
          for (var p = 0u; p < 3u; p = p + 1u) {
            for (var q = 0u; q < 3u; q = q + 1u) {
              var cij = C[0]; if (p + q == 1u) { cij = C[1]; } if ((p == 0u && q == 2u) || (p == 2u && q == 0u)) { cij = C[2]; } if (p == 1u && q == 1u) { cij = C[3]; }
              if ((p == 1u && q == 2u) || (p == 2u && q == 1u)) { cij = C[4]; } if (p == 2u && q == 2u) { cij = C[5]; }
              l = b_add(l, b_mul(b_mul(an[comp * 3u + p], an[comp * 3u + q]), cij));
            }
          }
          let t = vec2<f32>(share * max(0.0, hv[comp].x - l.x), share * (hv[comp].y + l.y));
          res[comp] = b_add(res[comp], b_mul(b_mul(aj, aj), t));
        }
      }
      if (count == 2u) {
        // #457: the reference takes AHD's choice on the noise-free mosaic, one candidate or (a tie) their average, so its value
        // lies within half the candidates' difference plus their bounds of the average: the bound carries that, and the move
        // accumulates in choice, which flags the pixel below when it exceeds CHOICE_SIGMA of the pixel's noise σ.
        for (var comp = 0u; comp < 3u; comp = comp + 1u) {
          let diff = abs(h_cand[comp].x - h_cand[3u + comp].x);
          let both = h_cand[comp].y + h_cand[3u + comp].y;
          choice[comp] = choice[comp] + aj.x * 0.5 * diff;
          e_mean[comp].y = e_mean[comp].y + 0.5 * (diff + both);
        }
      }
      for (var comp = 0u; comp < 3u; comp = comp + 1u) { s[comp] = b_add(s[comp], b_mul(aj, e_mean[comp])); }
      if (count == 2u) {
        // AHD's per-pixel choice: ¼·Var(H − V) at the last candidate's slopes, linear in the sites.
        var x0 = vec2<f32>(0.0, 0.0); var x1 = vec2<f32>(0.0, 0.0); var x2 = vec2<f32>(0.0, 0.0);
        for (var n = 0u; n < entries; n = n + 1u) {
          let eb = cb + 4u + n * ${DISPLAY_VIEW_QUALITY_CANDIDATE_FLOATS}u;
          let o = site_at(x + i32(aux[eb]), y + i32(aux[eb + 1u]));
          let d0 = b_scale(bs[0], aux[eb + 2u] - aux[eb + 5u]);
          let d1 = b_scale(bs[1], aux[eb + 3u] - aux[eb + 6u]);
          let d2 = b_scale(bs[2], aux[eb + 4u] - aux[eb + 7u]);
          let sv = vec2<f32>(sites[o + 1u], sites[o + 4u]);
          let a = b_mul(hs[0], b_add(b_add(b_mul(b_rounded(params.m00), d0), b_mul(b_rounded(params.m01), d1)), b_mul(b_rounded(params.m02), d2)));
          let b = b_mul(hs[1], b_add(b_add(b_mul(b_rounded(params.m10), d0), b_mul(b_rounded(params.m11), d1)), b_mul(b_rounded(params.m12), d2)));
          let c = b_mul(hs[2], b_add(b_add(b_mul(b_rounded(params.m20), d0), b_mul(b_rounded(params.m21), d1)), b_mul(b_rounded(params.m22), d2)));
          x0 = b_add(x0, b_mul(b_mul(a, a), sv)); x1 = b_add(x1, b_mul(b_mul(b, b), sv)); x2 = b_add(x2, b_mul(b_mul(c, c), sv));
        }
        let ajaj = b_mul(aj, aj);
        res[0] = b_add(res[0], b_mul(ajaj, b_scale(x0, 0.25))); res[1] = b_add(res[1], b_mul(ajaj, b_scale(x1, 0.25))); res[2] = b_add(res[2], b_mul(ajaj, b_scale(x2, 0.25)));
      }
    }
  }
  // #457: a pixel whose candidates' choice could move it by more than CHOICE_SIGMA of its own noise σ is recomputed on the host.
  if (choice[0] > CHOICE_SIGMA * sqrt(max(cov[0].x + res[0].x, 0.0)) || choice[1] > CHOICE_SIGMA * sqrt(max(cov[3].x + res[1].x, 0.0)) ||
      choice[2] > CHOICE_SIGMA * sqrt(max(cov[5].x + res[2].x, 0.0))) { pixel_flags = pixel_flags | FLAG_CHOICE; }
  let o = i * ${DISPLAY_VIEW_QUALITY_OUTPUT_FLOATS}u;
  out[o] = s[0].x; out[o + 1u] = s[1].x; out[o + 2u] = s[2].x;
  out[o + 3u] = cov[0].x + res[0].x; out[o + 4u] = cov[3].x + res[1].x; out[o + 5u] = cov[5].x + res[2].x;
  out[o + 6u] = cov[1].x; out[o + 7u] = cov[2].x; out[o + 8u] = cov[4].x;
  out[o + 9u] = max(s[0].y, max(s[1].y, s[2].y));
  out[o + 10u] = max(max(cov[0].y + res[0].y, cov[3].y + res[1].y), max(cov[5].y + res[2].y, max(cov[1].y, max(cov[2].y, cov[4].y))));
  flags[3u * i] = pixel_flags | select(0u, FLAG_HIGHLIGHT, undecided);
  flags[3u * i + 1u] = mask0;
  flags[3u * i + 2u] = mask1;
}
`;

/** The lattice pass with a material module appended (`fn material_at(p: vec2<f32>) -> u32`, `var<private> material_uncertain: bool`). */
export function assembleDisplayViewQualityLatticeWgsl(materialModuleWgsl: string): string {
  return DISPLAY_VIEW_QUALITY_LATTICE_WGSL + "\n" + materialModuleWgsl + "\n";
}
