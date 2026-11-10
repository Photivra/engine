// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernel of the display view's Speed path on the GPU (#478): one invocation per display pixel of the exact
 * area mean (docs/DISPLAY_VIEW.md, "Exact area mean") without diffraction, with the bilinear demosaic and chart
 * materials. It evaluates `renderDisplayView`'s per-sample loop (facade/display-view.ts) for every real pixel of the
 * display pixel's footprint, in the reference's operation order where the order matters, in float32:
 *
 * 1. the real pixels the footprint covers and their overlap weights a_j = w_j / A (the host computes the 1-D overlaps
 *    divided by the scale in float64; the kernel multiplies the two axes);
 * 2. for every native site the real pixels' demosaic reads (the footprint plus one site of reach), the expected
 *    electrons: the scene material at the pixel aperture's query offsets (the material module, `material_at`), the
 *    material's channel signal from a table the host computed in float64 (Σ_λ A_c(λ)·L(λ)), or (#581) the image-plane
 *    module's channel signal at the point (`scene_value`), summed over the offsets in the reference's order, plus the dark
 *    electrons;
 * 3. the readout moments of each site (mean k·e, variance k²·e + c₀, third cumulant k³·e) and the clip at the white
 *    level (the clipped-normal moments, in a cancellation-free standardized form);
 * 4. per real pixel the bilinear kernels, white balance and highlight clip, the colour matrix, the tone curve
 *    (identity, or positive Reinhard by the reference's 4 × 16-point Gauss–Legendre rule) and the clip to [0, 1] with
 *    the first-order skewness term;
 * 5. the display pixel's expected value Σ_j a_j·E[L_j], the linear (Stein) covariance Σ_c B_c·σ_c²·a_c·a_cᵀ with the
 *    closed-form B_c of the footprint, and the independent residual Σ_j a_j²·r_j.
 *
 * It outputs, per display pixel, the three means, the three variances (linear plus residual), the three covariances
 * and two running error terms: the absolute error bound of the mean and of the variance that the clip steps
 * contribute (a fixed formula evaluated from the pixel's own float32 values; docs/WEBGPU.md, "Display view (Speed)").
 * #533: it also decides each real pixel's saturation probability where the float32 values leave no doubt: a site is
 * certainly unclipped or certainly clipped when its standardized distance from white, with the site's mean moved by twice
 * `DISPLAY_VIEW_SITE_RELATIVE_U`·E of itself, still exceeds twice the reference's 8.5 (where the reference's probability is
 * exactly 0 or 1), and a real pixel is certainly saturated (P = 1) when a site its demosaic reads is certainly clipped and
 * certainly not (P = 0) when all are certainly unclipped. Three flag words per display pixel: bit 0 of the first the
 * material flag, bit 1 a real pixel left undecided (the host computes the pixel's count with the reference); the other two
 * a bit per real pixel j·nx + i of the footprint with P = 1.
 * The host adds the output quantization term, draws the noise, encodes and rounds (`display-view-speed-gpu.ts`), so
 * the noise draw is the CPU's bit for bit.
 *
 * Precision: float32 with an a-priori bound per step from the WGSL accuracy table (+ − × within one float32 rounding in
 * either direction, E = 2^-23; division 2.5 ULP, sqrt 4.5 ULP, exp 3 + 2|x| ULP; no trigonometric built-in is used). Every quotient that is a constant of
 * the request (the overlaps over the scale, the axis sums over the squared scale, 1/Σw² of the demosaic kernels) is
 * computed on the host in float64 and uploaded. Data-dependent quotients (z = (t − m)/s, the Abramowitz–Stegun t,
 * the skewness) carry the 2.5 ULP bound.
 */

export const DISPLAY_VIEW_WORKGROUP_SIZE = 64;
/** Largest footprint per axis (real pixels): the site window is (n + 2)² ≤ 64 entries of private storage. */
export const DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS = 6;
export const DISPLAY_VIEW_GPU_WINDOW_SIDE = DISPLAY_VIEW_GPU_MAXIMUM_PIXELS_PER_AXIS + 2;
/** Largest number of query offsets (pixel-aperture nodes × filter spots) the aux table holds. */
export const DISPLAY_VIEW_GPU_MAXIMUM_OFFSETS = 16;
/** Floats per display pixel in the output buffer: m0 m1 m2, v00 v11 v22 (linear + residual), c01 c02 c12, mean bound, variance bound. */
export const DISPLAY_VIEW_OUTPUT_FLOATS = 11;
/** #533: flag words per display pixel: the flags (bit 0 material uncertain, bit 1 a highlight undecided), then the 36-bit saturated mask. */
export const DISPLAY_VIEW_FLAG_WORDS = 3;
/**
 * #533: relative bound of a site's float32 mean and variance against the reference's float64, in units of E: the electrons'
 * sum of at most 16 offsets (each term a host-rounded weight and table value and one product), the dark electrons, and the
 * readout's products and sum carry at most 26 E; 64 leaves the rest as spare.
 */
export const DISPLAY_VIEW_SITE_RELATIVE_U = 64;
/** Floats per column or row record of the geometry buffer. */
export const DISPLAY_VIEW_GEOMETRY_STRIDE = 20;
/** Layout of the aux table (float32 words). */
export const DISPLAY_VIEW_AUX = /* @__PURE__ */ Object.freeze({
  /** Per offset o: ou (0.5 + ox − W/2), ov (0.5 + oy − H/2), weight, 0. */
  offsets: 0,
  /** Per phase p, channel c, tap t: dx, dy, weight, 0 (4 taps; unused taps have weight 0). */
  taps: 64,
  /** Per phase p, channel c: 1 / Σ_t w_t² (host float64). */
  inverseW2: 256,
  /** 16 Gauss–Legendre nodes then 16 weights on [−1, 1]. */
  gaussLegendre: 272,
  size: 304
});
/** Uniform parameter words (see `Params` below): 40 words, 160 bytes. */
export const DISPLAY_VIEW_PARAM_WORDS = 40;
/** The `E` of the bounds: one WGSL rounding of + − × in either direction, 2^-23 (W3C WGSL "Floating Point Accuracy"; #471, #487). */
const E_LITERAL = "1.1920928955078125e-7";
/**
 * Clip-step constants of the running bound, in units of E (docs/WEBGPU.md, "Display view (Speed)", derivation): the
 * absolute error of the clipped-normal mean in units of the standard deviation (`CLIP_MEAN_U`) and of its variance in
 * units of the variance (`CLIP_VARIANCE_U`), for one clip side. The host doubles every bound (MARGIN).
 */
export const DISPLAY_VIEW_CLIP_MEAN_U = 1400;
export const DISPLAY_VIEW_CLIP_VARIANCE_U = 36000;
/** The additional relative error of the Reinhard quadrature, in units of E, for the mean and the variance. */
export const DISPLAY_VIEW_REINHARD_MEAN_U = 256;
export const DISPLAY_VIEW_REINHARD_VARIANCE_U = 512;

const literal = (value: number): string => {
  const text = String(Math.fround(value));
  return /[.e]/u.test(text) ? text : `${text}.0`;
};

/**
 * The kernel's own WGSL, without the material module. `assembleDisplayViewSpeedWgsl` appends a module that defines
 * `fn material_at(p: vec2<f32>) -> u32` and `var<private> material_uncertain: bool` (set to true when the point's
 * classification is within its bound of a material boundary; the kernel then flags the display pixel for host
 * recomputation), and the adapter `scene_value(p, c) = site_table[material_at(p)·3 + c]`. #581: a module may instead define
 * `fn scene_value(p: vec2<f32>, c: u32) -> f32` itself (the image-plane module: the print's channel signal at p) and then
 * declares how many roundings it adds (`DisplayViewGpuMaterialModule.extraSiteRoundings`). The module may declare bindings
 * in @group(1) and use the constants E and SLACK declared here.
 */
export const DISPLAY_VIEW_SPEED_KERNEL_WGSL = /* wgsl */ `
const E: f32 = ${E_LITERAL};
const SLACK: f32 = 1e-14;
const CLIP_REACH: f32 = 8.5;
const CLIP_MEAN_U: f32 = ${literal(DISPLAY_VIEW_CLIP_MEAN_U)};
const CLIP_VARIANCE_U: f32 = ${literal(DISPLAY_VIEW_CLIP_VARIANCE_U)};
const SITE_RELATIVE_U: f32 = ${literal(DISPLAY_VIEW_SITE_RELATIVE_U)};
const WINDOW: u32 = ${DISPLAY_VIEW_GPU_WINDOW_SIDE}u;
const STRIDE: u32 = ${DISPLAY_VIEW_GEOMETRY_STRIDE}u;
struct Params {
  count: u32, row0: u32, region_w: u32, region_x: u32,
  region_y: u32, margin: u32, native_w: u32, native_h: u32,
  columns: u32, tone: u32, offsets: u32, pad0: u32,
  k0: f32, k1: f32, k2: f32, reach2: f32,
  dark0: f32, dark1: f32, dark2: f32, clip_level: f32,
  c0_0: f32, c0_1: f32, c0_2: f32, pad1: f32,
  g0: f32, g1: f32, g2: f32, pad2: f32,
  m00: f32, m01: f32, m02: f32, m10: f32,
  m11: f32, m12: f32, m20: f32, m21: f32,
  m22: f32, scale_u: f32, scale_v: f32, pad3: f32,
};
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> aux: array<f32>;
@group(0) @binding(2) var<storage, read> geometry: array<f32>;
@group(0) @binding(3) var<storage, read> site_table: array<f32>;
@group(0) @binding(4) var<storage, read_write> out: array<f32>;
@group(0) @binding(5) var<storage, read_write> flags: array<u32>;

var<private> site_mean: array<f32, 64>;
var<private> site_var: array<f32, 64>;
var<private> site_third: array<f32, 64>;
var<private> site_bound: array<f32, 64>;
// #533: 0 certainly below white, 1 certainly at or above it, 2 undecided.
var<private> site_clip: array<u32, 64>;

fn k_of(c: u32) -> f32 { if (c == 0u) { return params.k0; } if (c == 1u) { return params.k1; } return params.k2; }
fn dark_of(c: u32) -> f32 { if (c == 0u) { return params.dark0; } if (c == 1u) { return params.dark1; } return params.dark2; }
fn c0_of(c: u32) -> f32 { if (c == 0u) { return params.c0_0; } if (c == 1u) { return params.c0_1; } return params.c0_2; }
fn g_of(c: u32) -> f32 { if (c == 0u) { return params.g0; } if (c == 1u) { return params.g1; } return params.g2; }
fn m_of(r: u32, c: u32) -> f32 {
  let i = r * 3u + c;
  switch (i) {
    case 0u: { return params.m00; } case 1u: { return params.m01; } case 2u: { return params.m02; }
    case 3u: { return params.m10; } case 4u: { return params.m11; } case 5u: { return params.m12; }
    case 6u: { return params.m20; } case 7u: { return params.m21; } default: { return params.m22; }
  }
}
// Standard normal density, as the reference forms it: 0.3989422804014327·exp(−0.5·z·z).
fn phi(z: f32) -> f32 { return 0.3989422804014327 * exp(-0.5 * z * z); }
// Abramowitz & Stegun 26.2.17: returns (Φ(z), 1 − Φ(z)), each formed from the tail q directly where it is small.
fn pq(z: f32) -> vec2<f32> {
  let x = abs(z);
  let t = 1.0 / (1.0 + 0.2316419 * x);
  let q = phi(x) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (z >= 0.0) { return vec2<f32>(1.0 - q, q); }
  return vec2<f32>(q, 1.0 - q);
}
// #533: whether a site with mean m (bound dm) and variance v (bound dv) is certainly below white (0), certainly at or above it
// (1) or undecided (2): the reference's clip probability is exactly 0 or 1 beyond 8.5 standard deviations, and the decision here
// asks for twice that distance (4·reach²) after moving the mean by twice its bound and the variance up by twice its bound.
fn clip_state(m: f32, dm: f32, v: f32, dv: f32) -> u32 {
  let gap = 1.0 - m;
  let wide = 4.0 * params.reach2 * (v + 2.0 * dv);
  let below = gap - 2.0 * dm;
  let above = gap + 2.0 * dm;
  if (below > 0.0 && below * below > wide) { return 0u; }
  if (above < 0.0 && above * above > wide) { return 1u; }
  return 2u;
}
// Moments of min(Y, top) for Y ~ N(m, v): (mean, variance, slope P). The variance is v·(P − zφ + z²Q − δ²) with
// δ = φ − zQ: algebraically E[min²] − E[min]² without the m² cancellation.
fn upper_clip(m: f32, v: f32, top: f32) -> vec3<f32> {
  if (!(v > 0.0)) { return vec3<f32>(min(m, top), 0.0, select(0.0, 1.0, m < top)); }
  let s = sqrt(v);
  let z = (top - m) / s;
  if (z > CLIP_REACH) { return vec3<f32>(m, v, 1.0); }
  if (z < -CLIP_REACH) { return vec3<f32>(top, 0.0, 0.0); }
  let p = pq(z);
  let d = phi(z);
  let delta = d - z * p.y;
  let mean = m - s * delta;
  let ratio = p.x - z * d + z * z * p.y - delta * delta;
  return vec3<f32>(mean, v * max(0.0, ratio), p.x);
}
// Moments of clip(Y, 0, 1) for Y with mean m, variance v and standardized skewness γ (|γ| ≤ 1): (mean, variance, inside).
// With Z standard normal, W = m + s·g(Z), g = clip(Z, a, b): E[g] = aΦa + φa − φb + bQb, E[g²] = a²Φa + (Φb − Φa) −
// (bφb − aφa) + b²Qb; the mean adds the reference's Edgeworth term (s·γ/6)·(aφa − bφb).
fn unit_clip(m: f32, v: f32, skewness: f32) -> vec3<f32> {
  if (!(v > 0.0)) { return vec3<f32>(clamp(m, 0.0, 1.0), 0.0, select(0.0, 1.0, m > 0.0 && m < 1.0)); }
  let s = sqrt(v);
  let a = -m / s;
  let b = (1.0 - m) / s;
  if (a < -CLIP_REACH && b > CLIP_REACH) { return vec3<f32>(m, v, 1.0); }
  var pa = 0.0; var da = 0.0;
  if (!(a < -CLIP_REACH)) { pa = pq(a).x; da = phi(a); }
  var pb = 1.0; var qb = 0.0; var db = 0.0;
  if (!(b > CLIP_REACH)) { let p = pq(b); pb = p.x; qb = p.y; db = phi(b); }
  let inside = pb - pa;
  let gamma = clamp(skewness, -1.0, 1.0);
  let aa = a * da;
  let bb = b * db;
  let eg = a * pa + (da - db) + b * qb;
  let eg2 = a * a * pa + inside - (bb - aa) + b * b * qb;
  let normal_mean = m + s * eg;
  var mean = normal_mean;
  var skew_shift = 0.0;
  if (gamma != 0.0) { skew_shift = s * gamma / 6.0 * (aa - bb); mean = normal_mean + skew_shift; }
  // The reference forms E[Y²] − (E[Y] + shift)², so the shift also enters its variance: −shift·(2·E[Y] + shift).
  return vec3<f32>(mean, max(0.0, v * (eg2 - eg * eg) - skew_shift * (2.0 * normal_mean + skew_shift)), inside);
}
// Positive Reinhard per channel then the clip to [0, 1]: h(x) = x/(1 + x) for x > 0, else 0. Composite 16-point
// Gauss–Legendre over [max(0, m − 8.5s), m + 8.5s] in 4 panels, as the reference; the variance is formed about h(m).
fn reinhard_moments(m: f32, v: f32) -> vec3<f32> {
  if (!(v > 0.0)) {
    if (m > 0.0) { return vec3<f32>(m / (1.0 + m), 0.0, 1.0 / ((1.0 + m) * (1.0 + m))); }
    return vec3<f32>(0.0, 0.0, 0.0);
  }
  let s = sqrt(v);
  // The reference's panels [max(0, m − 8.5s), m + 8.5s] in standardized units z = (x − m)/s, so the node's z is formed
  // without the cancellation x − m: zlo = max(−m/s, −8.5), weight = zhalf·w_k·φ(z_k) (= half·w_k·φ((x − m)/s)/s), x = m + s·z.
  let zlo = max(-m / s, -CLIP_REACH);
  if (!(CLIP_REACH > zlo)) { return vec3<f32>(0.0, 0.0, 0.0); }
  let hm = select(0.0, m / (1.0 + m), m > 0.0);
  var e1 = 0.0; var e2 = 0.0; var ed = 0.0;
  let zwidth = (CLIP_REACH - zlo) / 4.0;
  for (var p = 0u; p < 4u; p = p + 1u) {
    let zc = zlo + (f32(p) + 0.5) * zwidth;
    let zhalf = zwidth / 2.0;
    for (var k = 0u; k < 16u; k = k + 1u) {
      let z = zc + zhalf * aux[${DISPLAY_VIEW_AUX.gaussLegendre}u + k];
      let x = m + s * z;
      let weight = zhalf * aux[${DISPLAY_VIEW_AUX.gaussLegendre + 16}u + k] * phi(z);
      let h = x / (1.0 + x);
      e1 = e1 + weight * h;
      e2 = e2 + weight * (h - hm) * (h - hm);
      ed = ed + weight / ((1.0 + x) * (1.0 + x));
    }
  }
  let shifted = e1 - hm;
  return vec3<f32>(e1, max(0.0, e2 - shifted * shifted), ed);
}
fn reflect_x(x: i32) -> i32 { if (x < 0) { return -x; } if (x >= i32(params.native_w)) { return 2 * i32(params.native_w) - 2 - x; } return x; }
fn reflect_y(y: i32) -> i32 { if (y < 0) { return -y; } if (y >= i32(params.native_h)) { return 2 * i32(params.native_h) - 2 - y; } return y; }
fn channel_of(x: i32, y: i32) -> u32 {
  if ((y & 1) == 0) { return select(1u, 0u, (x & 1) == 0); }
  return select(2u, 1u, (x & 1) == 0);
}
// The expected photo electrons of native site (x, y): Σ_o w_o·scene_value(p_o, c) in offset order (directSite); with a material
// module scene_value is table[m_o, c].
fn site_electrons(x: i32, y: i32, c: u32) -> f32 {
  var sum = 0.0;
  let fx = f32(x);
  let fy = f32(y);
  for (var o = 0u; o < params.offsets; o = o + 1u) {
    let base = ${DISPLAY_VIEW_AUX.offsets}u + 4u * o;
    let u = (fx + aux[base]) * params.scale_u;
    let v = (fy + aux[base + 1u]) * params.scale_v;
    sum = sum + aux[base + 2u] * scene_value(vec2<f32>(u, v), c);
  }
  return sum;
}
@compute @workgroup_size(${DISPLAY_VIEW_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let i = gid.x + gid.y * groups.x * ${DISPLAY_VIEW_WORKGROUP_SIZE}u;
  if (i >= params.count) { return; }
  material_uncertain = false;
  let rx = i % params.region_w;
  let ry = params.row0 + i / params.region_w;
  let col = rx * STRIDE;
  let row = (params.columns + ry) * STRIDE;
  let col_first = bitcast<i32>(geometry[col]);
  let nx = bitcast<u32>(geometry[col + 1u]);
  let row_first = bitcast<i32>(geometry[row]);
  let ny = bitcast<u32>(geometry[row + 1u]);
  let margin = i32(params.margin);
  // 2. and 3.: the sites of the footprint plus one site of reach, once each.
  let x0 = col_first + margin - 1;
  let y0 = row_first + margin - 1;
  let window_w = nx + 2u;
  for (var sj = 0u; sj < ny + 2u; sj = sj + 1u) {
    let sy = reflect_y(y0 + i32(sj));
    for (var si = 0u; si < window_w; si = si + 1u) {
      let sx = reflect_x(x0 + i32(si));
      let c = channel_of(sx, sy);
      let e = site_electrons(sx, sy, c) + dark_of(c);
      let kc = k_of(c);
      let mean = kc * e;
      let variance = kc * kc * e + c0_of(c);
      let gap = 1.0 - mean;
      let slot = sj * window_w + si;
      site_third[slot] = kc * kc * kc * e;
      site_clip[slot] = clip_state(mean, SITE_RELATIVE_U * E * mean, variance, SITE_RELATIVE_U * E * variance);
      if (gap > 0.0 && gap * gap > params.reach2 * variance) {
        site_mean[slot] = mean; site_var[slot] = variance; site_bound[slot] = 0.0;
      } else {
        let clipped = upper_clip(mean, variance, 1.0);
        site_mean[slot] = clipped.x; site_var[slot] = clipped.y; site_bound[slot] = sqrt(variance);
      }
    }
  }
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
  let reinhard = params.tone == 1u;
  var s0 = 0.0; var s1 = 0.0; var s2 = 0.0;
  var c00 = 0.0; var c01 = 0.0; var c02 = 0.0; var c11 = 0.0; var c12 = 0.0; var c22 = 0.0;
  var r0 = 0.0; var r1 = 0.0; var r2 = 0.0;
  var bound_mean = 0.0; var bound_var = 0.0;
  // #533: the saturated real pixels (bit j·nx + i) and whether any real pixel is undecided.
  var mask0 = 0u; var mask1 = 0u; var undecided = false;
  // 4. and 5.: every real pixel of the footprint with its overlap weight.
  for (var j = 0u; j < ny; j = j + 1u) {
    let ay = geometry[row + 2u + j];
    for (var ii = 0u; ii < nx; ii = ii + 1u) {
      let aj = geometry[col + 2u + ii] * ay;
      let x = col_first + i32(ii) + margin;
      let y = row_first + i32(j) + margin;
      let phase = u32(y & 1) * 2u + u32(x & 1);
      var cm: array<f32, 3>; var cvv: array<f32, 3>; var cth: array<f32, 3>; var csv: array<f32, 3>; var cb: array<f32, 3>;
      var clipped = false; var near_white = false;
      for (var c = 0u; c < 3u; c = c + 1u) {
        var mean = 0.0; var variance = 0.0; var third = 0.0; var bnd = 0.0;
        let taps = ${DISPLAY_VIEW_AUX.taps}u + (phase * 3u + c) * 16u;
        for (var t = 0u; t < 4u; t = t + 1u) {
          let w = aux[taps + 4u * t + 2u];
          let slot = u32((i32(j) + 1 + i32(aux[taps + 4u * t + 1u])) * i32(window_w) + i32(ii) + 1 + i32(aux[taps + 4u * t]));
          mean = mean + w * site_mean[slot];
          variance = variance + w * w * site_var[slot];
          third = third + w * w * w * site_third[slot];
          bnd = max(bnd, select(0.0, site_bound[slot], w != 0.0));
          if (w != 0.0) { if (site_clip[slot] == 1u) { clipped = true; } else if (site_clip[slot] == 2u) { near_white = true; } }
        }
        cm[c] = mean; cvv[c] = variance; cth[c] = third; cb[c] = bnd;
        csv[c] = variance * aux[${DISPLAY_VIEW_AUX.inverseW2}u + phase * 3u + c];
      }
      if (clipped) {
        let bit = j * nx + ii;
        if (bit < 32u) { mask0 = mask0 | (1u << bit); } else { mask1 = mask1 | (1u << (bit - 32u)); }
      } else if (near_white) { undecided = true; }
      // White balance and the highlight clip at the smallest gain: bm, bv, bs (slope), with the clip's bound terms.
      var bm: array<f32, 3>; var bv: array<f32, 3>; var bs: array<f32, 3>; var bbm: array<f32, 3>; var bbv: array<f32, 3>;
      for (var c = 0u; c < 3u; c = c + 1u) {
        let gc = g_of(c);
        let um = gc * cm[c];
        let uv = gc * gc * cvv[c];
        let gap = params.clip_level - um;
        bbm[c] = gc * CLIP_MEAN_U * cb[c];
        bbv[c] = gc * gc * CLIP_VARIANCE_U * cb[c] * cb[c];
        if (gap > 0.0 && gap * gap > params.reach2 * uv) { bm[c] = um; bv[c] = uv; bs[c] = gc; }
        else {
          let clipped = upper_clip(um, uv, params.clip_level);
          bm[c] = clipped.x; bv[c] = clipped.y; bs[c] = gc * clipped.z;
          bbm[c] = bbm[c] + CLIP_MEAN_U * sqrt(uv);
          bbv[c] = bbv[c] + CLIP_VARIANCE_U * uv;
        }
      }
      // Colour matrix, then the rendering of each component (tone curve, clip to [0, 1]).
      var hm: array<f32, 3>; var hv: array<f32, 3>; var hs: array<f32, 3>; var hbm: array<f32, 3>; var hbv: array<f32, 3>;
      for (var comp = 0u; comp < 3u; comp = comp + 1u) {
        let r0m = m_of(comp, 0u); let r1m = m_of(comp, 1u); let r2m = m_of(comp, 2u);
        let mean = r0m * bm[0] + r1m * bm[1] + r2m * bm[2];
        let variance = r0m * r0m * bv[0] + r1m * r1m * bv[1] + r2m * r2m * bv[2];
        var bm_c = abs(r0m) * bbm[0] + abs(r1m) * bbm[1] + abs(r2m) * bbm[2];
        var bv_c = r0m * r0m * bbv[0] + r1m * r1m * bbv[1] + r2m * r2m * bbv[2];
        if (!reinhard && mean > 0.0 && mean < 1.0 && mean * mean > params.reach2 * variance && (1.0 - mean) * (1.0 - mean) > params.reach2 * variance) {
          hm[comp] = mean; hv[comp] = variance; hs[comp] = 1.0;
        } else if (reinhard) {
          let moments = reinhard_moments(mean, variance);
          hm[comp] = moments.x; hv[comp] = moments.y; hs[comp] = moments.z;
          bm_c = bm_c + 2.0 * CLIP_MEAN_U * sqrt(variance);
          bv_c = bv_c + 2.0 * CLIP_VARIANCE_U * variance;
        } else {
          // κ₃ of the component: Σ_c (M_comp,c·Γ_c)³·Σ_t w_t³·κ₃(site) (the sites of one channel share the coefficient).
          let k0 = r0m * bs[0]; let k1 = r1m * bs[1]; let k2 = r2m * bs[2];
          let third = k0 * k0 * k0 * cth[0] + k1 * k1 * k1 * cth[1] + k2 * k2 * k2 * cth[2];
          let skew = select(0.0, third / (variance * sqrt(variance)), variance > 0.0);
          let moments = unit_clip(mean, variance, skew);
          hm[comp] = moments.x; hv[comp] = moments.y; hs[comp] = moments.z;
          bm_c = bm_c + 2.0 * CLIP_MEAN_U * sqrt(variance);
          bv_c = bv_c + 2.0 * CLIP_VARIANCE_U * variance;
        }
        hbm[comp] = bm_c; hbv[comp] = bv_c;
      }
      s0 = s0 + aj * hm[0]; s1 = s1 + aj * hm[1]; s2 = s2 + aj * hm[2];
      // Linear (Stein) part with B_c·σ_c², and the pixel's own linear variance for the residual.
      var l0 = 0.0; var l1 = 0.0; var l2 = 0.0;
      var lb0 = 0.0; var lb1 = 0.0; var lb2 = 0.0;
      for (var c = 0u; c < 3u; c = c + 1u) {
        let a0 = hs[0] * m_of(0u, c) * bs[c];
        let a1 = hs[1] * m_of(1u, c) * bs[c];
        let a2 = hs[2] * m_of(2u, c) * bs[c];
        var bc = b0; if (c == 1u) { bc = b1; } if (c == 2u) { bc = b2; }
        let wgt = aj * bc * csv[c];
        c00 = c00 + wgt * a0 * a0; c01 = c01 + wgt * a0 * a1; c02 = c02 + wgt * a0 * a2;
        c11 = c11 + wgt * a1 * a1; c12 = c12 + wgt * a1 * a2; c22 = c22 + wgt * a2 * a2;
        l0 = l0 + a0 * a0 * cvv[c]; l1 = l1 + a1 * a1 * cvv[c]; l2 = l2 + a2 * a2 * cvv[c];
        // The clip bound of each channel's variance enters the covariance through a_j·B_c·(Δσ_c²/Σw²)·a_i·a_j and the
        // residual's linear prediction through a²·Δσ_c².
        lb0 = lb0 + (a0 * a0) * bbv[c]; lb1 = lb1 + (a1 * a1) * bbv[c]; lb2 = lb2 + (a2 * a2) * bbv[c];
        bound_var = bound_var + aj * bc * (bbv[c] * aux[${DISPLAY_VIEW_AUX.inverseW2}u + phase * 3u + c]) * max(a0 * a0, max(a1 * a1, a2 * a2));
      }
      r0 = r0 + aj * aj * max(0.0, hv[0] - l0);
      r1 = r1 + aj * aj * max(0.0, hv[1] - l1);
      r2 = r2 + aj * aj * max(0.0, hv[2] - l2);
      bound_mean = bound_mean + aj * max(hbm[0], max(hbm[1], hbm[2]));
      bound_var = bound_var + aj * aj * (max(hbv[0], max(hbv[1], hbv[2])) + max(lb0, max(lb1, lb2)));
    }
  }
  let o = i * ${DISPLAY_VIEW_OUTPUT_FLOATS}u;
  out[o] = s0; out[o + 1u] = s1; out[o + 2u] = s2;
  out[o + 3u] = c00 + r0; out[o + 4u] = c11 + r1; out[o + 5u] = c22 + r2;
  out[o + 6u] = c01; out[o + 7u] = c02; out[o + 8u] = c12;
  out[o + 9u] = bound_mean * E; out[o + 10u] = bound_var * E;
  flags[3u * i] = select(0u, 1u, material_uncertain) | select(0u, 2u, undecided);
  flags[3u * i + 1u] = mask0;
  flags[3u * i + 2u] = mask1;
}
`;

/** The material table lookup a material module's `material_at` feeds (the kernel's `scene_value`). */
export const DISPLAY_VIEW_MATERIAL_SCENE_VALUE_WGSL = /* wgsl */ `
fn scene_value(p: vec2<f32>, c: u32) -> f32 { return site_table[material_at(p) * 3u + c]; }
`;
/** The full shader: the kernel plus a material module (see `DISPLAY_VIEW_SPEED_KERNEL_WGSL`), and the table adapter unless the module defines `scene_value`. */
export function assembleDisplayViewSpeedWgsl(materialModuleWgsl: string): string {
  const adapter = /\bfn scene_value\(/u.test(materialModuleWgsl) ? "" : DISPLAY_VIEW_MATERIAL_SCENE_VALUE_WGSL;
  return DISPLAY_VIEW_SPEED_KERNEL_WGSL + "\n" + materialModuleWgsl + "\n" + adapter;
}
