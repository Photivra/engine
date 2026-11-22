// SPDX-License-Identifier: Apache-2.0

/**
 * The project's own WGSL (WebGPU shader language) compute kernels for the `webgpu-f32` image-kernel
 * backend. Each kernel evaluates the same equations, in the same order, as its float64 CPU reference:
 * - SDR: `calculateSdrRendering` / native capture SDR (exposure → tone → gamut → sRGB → nearest-ties-up);
 * - RAW development: `createNativeRawDevelopmentTask` (CFA kernel sums → WB gains → camera→XYZ →
 *   XYZ→linear sRGB → SDR);
 * - irradiance convolution: `convolveIrradianceRows` (source-indexed isoplanatic-patch gather).
 * The host packers in image-kernel-accelerator.ts use matching uniform layouts.
 */

/**
 * Counter slots shared by the SDR-producing kernels. `linearBoundBits` holds the float32 bits of the
 * largest per-sample linear bound of a luminance tone curve (a maximum, not a sum: non-negative float32
 * bit patterns order like their values). `luminanceDomain` counts samples outside the float32 domain.
 */
export const SDR_COUNTER = /* @__PURE__ */ Object.freeze({ negative: 0, above: 1, changed: 2, low: 3, high: 4, outOfGamut: 5, uncertain: 6, gamutUncertain: 7,
  saturatedPixels: 8, whiteBalanceClipped: 9, reconstructedPixels: 10, linearBoundBits: 11, luminanceDomain: 12 });
export const SDR_COUNTER_SLOTS = 16;
/** Tone modes of the luminance kernels (`Params.tone_mode`); 0 is a per-channel curve. */
export const SDR_TONE_MODE = /* @__PURE__ */ Object.freeze({ perChannel: 0, extendedReinhard: 1, nakaRushton: 2 });
export const LINEAR_WORKGROUP_SIZE = 256;
/** RAW_HIGHLIGHT_RECONSTRUCTION_START as a WGSL literal (rounded once to float32 by the compiler). */
const RAW_HIGHLIGHT_START_WGSL = "0.8";
export const CONVOLUTION_WORKGROUP_EDGE = 16;

/*
 * #690: each shader literal below is wrapped as a pure call. Its `${SDR_COUNTER.…}` interpolations read object properties, which a
 * bundler cannot prove free of side effects, so a bare literal stays in every bundle that imports this module, used or not (the
 * display view's GPU session uses only IRRADIANCE_CONVOLUTION_WGSL). The strings are the same; the wrap only lets them be dropped.
 */

/**
 * Shared SDR sample renderer. `band0`/`band1` are absolute classification bands around 0 and 1 inside
 * which the float32 decision may differ from float64; such samples increment the uncertainty counter.
 * A zero result from a non-zero source (underflow) and tiny positive Reinhard inputs are also uncertain.
 */
const SDR_FUNCTIONS = /* @__PURE__ */ ((): string => /* wgsl */ `
var<workgroup> local_counters: array<atomic<u32>, ${SDR_COUNTER_SLOTS}>;
fn count(slot: u32) { atomicAdd(&local_counters[slot], 1u); }
fn encode_srgb(x: f32) -> f32 {
  if (x == 1.0) { return 1.0; }
  if (x <= 0.0031308) { return x * 12.92; }
  return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
fn render_sample(e: f32, source_nonzero: bool, band0: f32, band1: f32, reinhard: bool, reject: bool, maximum: f32) -> u32 {
  // Gamut decisions (mapped < 0, mapped > 1) depend only on the sign band and, for identity tone, the band at 1.
  var gamut_uncertain = (e == 0.0 && source_nonzero) || (!reinhard && abs(e - 1.0) <= band1);
  if (band0 > 0.0 && abs(e) <= band0) { gamut_uncertain = true; }
  var uncertain = gamut_uncertain || abs(e - 1.0) <= band1;
  if (reinhard && e > 0.0 && e < 9.5367431640625e-7) { uncertain = true; }
  if (uncertain) { count(${SDR_COUNTER.uncertain}u); }
  if (gamut_uncertain) { count(${SDR_COUNTER.gamutUncertain}u); }
  if (e < 0.0) { count(${SDR_COUNTER.negative}u); }
  if (e > 1.0) { count(${SDR_COUNTER.above}u); }
  var mapped = e;
  if (reinhard && e > 0.0) { mapped = e / (1.0 + e); }
  if (mapped != e) { count(${SDR_COUNTER.changed}u); }
  var linear = mapped;
  if (mapped < 0.0 || mapped > 1.0) {
    if (reject) { count(${SDR_COUNTER.outOfGamut}u); }
    else if (mapped < 0.0) { count(${SDR_COUNTER.low}u); linear = 0.0; }
    else { count(${SDR_COUNTER.high}u); linear = 1.0; }
  }
  let code = floor(encode_srgb(linear) * maximum + 0.5);
  return u32(clamp(code, 0.0, maximum));
}
fn clear_counters(local_index: u32) {
  if (local_index < ${SDR_COUNTER_SLOTS}u) { atomicStore(&local_counters[local_index], 0u); }
  workgroupBarrier();
}
fn flush_counters(local_index: u32) {
  workgroupBarrier();
  if (local_index < ${SDR_COUNTER_SLOTS}u) {
    let value = atomicLoad(&local_counters[local_index]);
    if (local_index == ${SDR_COUNTER.linearBoundBits}u) { atomicMax(&counters[local_index], value); }
    else if (value > 0u) { atomicAdd(&counters[local_index], value); }
  }
}
`)();

/**
 * Luminance tone curves (`prepareSdrPixelTone`): every component of a pixel is scaled by h(L) = f(L)/L,
 * L = kr·r + kg·g + kb·b, when L > 0. The kernel evaluates h directly (algebraically equal to f(L)/L):
 * - extended Reinhard: h = (1 + L/Lw²)/(1 + L);
 * - Naka–Rushton: h = (1/g(Lw))/(L·(1 + (σ/L)ⁿ)), with P = (σ/L)ⁿ = exp2(n·log2(σ/L)) and, for P ≥ 1,
 *   the equal form (1/g(Lw))·P⁻¹/(L·(1 + P⁻¹)) so nothing overflows.
 * Per sample it also evaluates an a-priori bound on |m_gpu − m_reference| from the inputs' bounds ε
 * (see docs/WEBGPU.md, "Luminance tone curves"). The bound itself is evaluated in float32 and inflated.
 * Uniform fields used: tone_mode, tone = (Reinhard: 1/Lw²; Naka–Rushton: σ, n, 1/g(Lw), σⁿ), lum = (kr, kg, kb, T).
 */
const LUMINANCE_FUNCTIONS = /* @__PURE__ */ ((): string => /* wgsl */ `
const LU: f32 = 5.9604644775390625e-8;
const ULP1: f32 = 1.1920928955078125e-7;
fn count_max(slot: u32, value: f32) { atomicMax(&local_counters[slot], bitcast<u32>(max(value, 0.0))); }
// (h, eta, abs_h): |h_gpu - h(l)| <= eta*h(l) + abs_h for the exact h at this float32 l > 0.
fn tone_h(l: f32) -> vec3<f32> {
  if (params.tone_mode == ${SDR_TONE_MODE.extendedReinhard}u) {
    return vec3<f32>((1.0 + l * params.tone.x) / (1.0 + l), 14.0 * LU, 0.0);
  }
  let lg = log2(params.tone.x / l);
  let n = params.tone.y;
  let z = n * lg;
  // log2: 2^-21 absolute or 3 ULP; the sigma/l division and sigma's rounding; the product's rounding.
  let dz = n * (4.76837158203125e-7 + 3.0 * ULP1 * abs(lg) + 9.0 * LU) + 2.0 * LU * abs(z);
  // exp2: 3 + 2|z| ULP; plus slack for the float64 reference's pow.
  let rho = 0.7 * dz * (1.0 + dz) + (3.0 + 2.0 * abs(z)) * ULP1 + 9.094947e-13 * (1.0 + abs(z));
  let eta = 2.0 * rho + 16.0 * LU;
  if (z >= 0.0) {
    let p = exp2(-z);
    var abs_h = 0.0;
    // Below 2^-120 the power may have flushed to zero: bound h absolutely instead.
    if (p < 7.52316384526264e-37) { abs_h = params.tone.z * 3.009265538105056e-36 / l; }
    return vec3<f32>(params.tone.z * p / (l * (1.0 + p)), eta, abs_h);
  }
  let p = exp2(z);
  return vec3<f32>(params.tone.z / (l * (1.0 + p)), eta, 0.0);
}
struct Toned { m: vec3<f32>, delta: vec3<f32>, changed_uncertain: bool };
fn luminance_tone(e: vec3<f32>, eps: vec3<f32>) -> Toned {
  var t: Toned;
  let ae = abs(e);
  let ea = ae + eps;
  let s = (params.lum.x * ae.x + params.lum.y * ae.y) + params.lum.z * ae.z;
  let l = (params.lum.x * e.x + params.lum.y * e.y) + params.lum.z * e.z;
  let lambda = (((params.lum.x * eps.x + params.lum.y * eps.y) + params.lum.z * eps.z) + 6.0 * LU * s) * 1.001;
  if (l < -2.0 * lambda || (l == 0.0 && lambda == 0.0)) {
    // L < 0 for the reference too: both keep the exposed values.
    t.m = e; t.delta = eps; t.changed_uncertain = false;
    return t;
  }
  if (l > 2.0 * lambda) {
    let r = tone_h(l);
    let q = lambda / l;
    let f = exp2(params.lum.w * log2((1.0 + q) / (1.0 - q))) / (1.0 - q) * 1.01;
    let fq = params.lum.w * f * q;
    let hh = r.x * (1.0 + 2.0 * r.y) + r.z;
    t.m = e * r.x;
    t.delta = (eps * hh * (1.0 + fq) + ea * (hh * (r.y + fq) + r.z) + 2.0 * LU * abs(t.m)) * 1.001;
    t.changed_uncertain = abs(r.x - 1.0) <= 2.0 * (r.y + fq) * max(1.0, r.x) + r.z + 4.0 * LU;
    return t;
  }
  // |L| is inside its classification band: either branch may run, so bound both.
  var hsup = max(1.0, params.tone.x);
  if (params.tone_mode == ${SDR_TONE_MODE.nakaRushton}u) {
    hsup = params.tone.z * exp2((params.tone.y - 1.0) * log2(3.0 * lambda)) / params.tone.w * 1.01;
  }
  var m = e;
  if (l > 0.0) { m = e * tone_h(l).x; }
  t.m = m;
  t.delta = (2.0 * ea * (1.0 + hsup * (1.0 + 1e-3))) * 1.001;
  t.changed_uncertain = true;
  return t;
}
// Classification, gamut handling and encoding of one luminance-toned sample (e exposed, m toned).
fn render_toned(e: f32, source_nonzero: bool, band0: f32, band1: f32, m: f32, delta: f32, changed_uncertain: bool, reject: bool, maximum: f32) -> u32 {
  var uncertain = (e == 0.0 && source_nonzero) || abs(e - 1.0) <= band1 || (band0 > 0.0 && abs(e) <= band0) || (changed_uncertain && e != 0.0);
  // The reference value lies in [m - delta, m + delta]: uncertain only if that interval straddles a decision.
  let gamut_uncertain = (m - delta < 0.0 && m + delta >= 0.0) || (m + delta > 1.0 && m - delta <= 1.0);
  if (gamut_uncertain) { uncertain = true; count(${SDR_COUNTER.gamutUncertain}u); }
  if (uncertain) { count(${SDR_COUNTER.uncertain}u); }
  if (e < 0.0) { count(${SDR_COUNTER.negative}u); }
  if (e > 1.0) { count(${SDR_COUNTER.above}u); }
  if (m != e) { count(${SDR_COUNTER.changed}u); }
  if (!(abs(m) + delta <= 1.2676506002282294e30)) { count(${SDR_COUNTER.luminanceDomain}u); }
  var linear = m;
  var bound = min(delta, 1.0);
  if (m < 0.0 || m > 1.0) {
    if (reject) { count(${SDR_COUNTER.outOfGamut}u); }
    else if (m < 0.0) { count(${SDR_COUNTER.low}u); linear = 0.0; }
    else { count(${SDR_COUNTER.high}u); linear = 1.0; }
  }
  // Clipping is 1-Lipschitz; when both values clip to the same end the difference is zero.
  if (!reject && (m - delta >= 1.0 || m + delta <= 0.0)) { bound = 0.0; }
  count_max(${SDR_COUNTER.linearBoundBits}u, bound);
  let code = floor(encode_srgb(linear) * maximum + 0.5);
  return u32(clamp(code, 0.0, maximum));
}
`)();

/** Pointwise SDR over a packed float32 band; one invocation per sample. */
export const SDR_WGSL = /* @__PURE__ */ ((): string => /* wgsl */ `
struct Params { count: u32, reinhard: u32, reject: u32, pad0: u32, scale: f32, maximum: f32, band1: f32, pad1: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> codes: array<u32>;
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>, ${SDR_COUNTER_SLOTS}>;
${SDR_FUNCTIONS}
@compute @workgroup_size(${LINEAR_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) local_index: u32,
        @builtin(num_workgroups) groups: vec3<u32>) {
  clear_counters(local_index);
  let i = gid.x + gid.y * groups.x * ${LINEAR_WORKGROUP_SIZE}u;
  if (i < params.count) {
    let s = source[i];
    codes[i] = render_sample(s * params.scale, s != 0.0, 0.0, params.band1, params.reinhard != 0u, params.reject != 0u, params.maximum);
  }
  flush_counters(local_index);
}
`)();

/** Pointwise SDR with a luminance tone curve over a packed float32 band; one invocation per pixel. */
export const SDR_LUMINANCE_WGSL = /* @__PURE__ */ ((): string => /* wgsl */ `
struct Params { pixels: u32, reject: u32, tone_mode: u32, pad0: u32, scale: f32, maximum: f32, band1: f32, pad1: f32,
  tone: vec4<f32>, lum: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read_write> codes: array<u32>;
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>, ${SDR_COUNTER_SLOTS}>;
${SDR_FUNCTIONS}
${LUMINANCE_FUNCTIONS}
@compute @workgroup_size(${LINEAR_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) local_index: u32,
        @builtin(num_workgroups) groups: vec3<u32>) {
  clear_counters(local_index);
  let i = gid.x + gid.y * groups.x * ${LINEAR_WORKGROUP_SIZE}u;
  if (i < params.pixels) {
    let s = vec3<f32>(source[i * 3u], source[i * 3u + 1u], source[i * 3u + 2u]);
    let e = s * params.scale;
    // Source, scale and product roundings (plus the reference's own), and an absolute term where a non-zero source may underflow.
    var eps = 4.0 * LU * abs(e);
    for (var j = 0u; j < 3u; j++) {
      if (s[j] != 0.0 && abs(e[j]) < 7.888609052210118e-31) { eps[j] = eps[j] + 2.350988701644575e-38 * max(1.0, params.scale); }
    }
    let t = luminance_tone(e, eps);
    let reject = params.reject != 0u;
    for (var j = 0u; j < 3u; j++) {
      codes[i * 3u + j] = render_toned(e[j], s[j] != 0.0, 0.0, params.band1, t.m[j], t.delta[j], t.changed_uncertain, reject, params.maximum);
    }
  }
  flush_counters(local_index);
}
`)();

/**
 * Packed native RAW development of one band of output rows; one invocation per output pixel.
 * `normalized` holds the host's float64 site values, rounded once to float32. A saturated site
 * (flagged, or at or above its phase white level) is exactly 1. Any other site is
 * (code − black)/(white − black) ≤ 1 − 1/65535. So a saturated contributing site is recognised exactly.
 * Highlight handling matches `prepareSensorColorDevelopment` (clip at the smallest applied gain, or the
 * declared neutral blend).
 */
export const RAW_DEVELOPMENT_WGSL = /* @__PURE__ */ ((): string => /* wgsl */ `
struct Params {
  width: u32, count: u32, row0: u32, reinhard: u32,
  reject: u32, repeat_w: u32, repeat_h: u32, region_w: u32,
  origin_x: i32, origin_y: i32, axx: i32, axy: i32,
  ayx: i32, ayy: i32, region_x: i32, region_y: i32,
  scale: f32, maximum: f32, band0: f32, band1: f32,
  clip_level: f32, reconstruct: u32, band_u: f32, band_s: f32,
  gains: vec4<f32>,
  m0: vec4<f32>, m1: vec4<f32>, m2: vec4<f32>,
  x0: vec4<f32>, x1: vec4<f32>, x2: vec4<f32>,
  tone_mode: u32, pad0: u32, pad1: u32, pad2: u32,
  tone: vec4<f32>, lum: vec4<f32>,
};
struct Tap { ox: i32, oy: i32, w: f32, pad: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> normalized: array<f32>;
@group(0) @binding(2) var<storage, read> taps: array<Tap>;
@group(0) @binding(3) var<storage, read> phases: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> codes: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, ${SDR_COUNTER_SLOTS}>;
${SDR_FUNCTIONS}
${LUMINANCE_FUNCTIONS}
var<private> saturated: bool;
fn channel(phase: u32, c: u32, nx: i32, ny: i32) -> f32 {
  let range = phases[phase * 3u + c];
  var value = 0.0;
  for (var k = 0u; k < range.y; k++) {
    let t = taps[range.x + k];
    let sx = nx + t.ox - params.region_x;
    let sy = ny + t.oy - params.region_y;
    let site = normalized[u32(sy) * params.region_w + u32(sx)];
    if (site == 1.0) { saturated = true; }
    value = value + site * t.w;
  }
  return value;
}
fn row3(m: vec4<f32>, v: vec3<f32>) -> f32 { return ((0.0 + m.x * v.x) + m.y * v.y) + m.z * v.z; }
fn max3(v: vec3<f32>) -> f32 {
  if (v.x > v.y) { if (v.x > v.z) { return v.x; } return v.z; }
  if (v.y > v.z) { return v.y; }
  return v.z;
}
@compute @workgroup_size(${LINEAR_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) local_index: u32,
        @builtin(num_workgroups) groups: vec3<u32>) {
  clear_counters(local_index);
  let i = gid.x + gid.y * groups.x * ${LINEAR_WORKGROUP_SIZE}u;
  if (i < params.count) {
    let col = i32(i % params.width);
    let row = i32(params.row0 + i / params.width);
    let nx = params.origin_x + params.axx * col + params.axy * row;
    let ny = params.origin_y + params.ayx * col + params.ayy * row;
    let phase = (u32(ny) % params.repeat_h) * params.repeat_w + u32(nx) % params.repeat_w;
    saturated = false;
    let c = vec3<f32>(channel(phase, 0u, nx, ny), channel(phase, 1u, nx, ny), channel(phase, 2u, nx, ny));
    if (saturated) { count(${SDR_COUNTER.saturatedPixels}u); }
    let u = vec3<f32>(c.x * params.gains.x, c.y * params.gains.y, c.z * params.gains.z);
    let clip = params.clip_level;
    let k = vec3<f32>(select(u.x, clip, u.x > clip), select(u.y, clip, u.y > clip), select(u.z, clip, u.z > clip));
    var b = k;
    if (params.reconstruct == 0u) {
      for (var j = 0u; j < 3u; j++) {
        if (u[j] > clip) { count(${SDR_COUNTER.whiteBalanceClipped}u); }
        if (abs(u[j] - clip) <= params.band_u) { count(${SDR_COUNTER.uncertain}u); }
      }
    } else {
      let s = max3(c);
      if (abs(s - ${RAW_HIGHLIGHT_START_WGSL}) <= params.band_s) { count(${SDR_COUNTER.uncertain}u); }
      if (s > ${RAW_HIGHLIGHT_START_WGSL}) {
        var t = 1.0;
        if (s < 1.0) { t = (s - ${RAW_HIGHLIGHT_START_WGSL}) / (1.0 - ${RAW_HIGHLIGHT_START_WGSL}); }
        let n = max3(k);
        b = (1.0 - t) * u + t * vec3<f32>(n, n, n);
        count(${SDR_COUNTER.reconstructedPixels}u);
      } else {
        b = u;
      }
    }
    let xyz = vec3<f32>(row3(params.m0, b), row3(params.m1, b), row3(params.m2, b));
    let rgb = vec3<f32>(row3(params.x0, xyz), row3(params.x1, xyz), row3(params.x2, xyz));
    let reinhard = params.reinhard != 0u;
    let reject = params.reject != 0u;
    if (params.tone_mode == ${SDR_TONE_MODE.perChannel}u) {
      for (var j = 0u; j < 3u; j++) {
        codes[i * 3u + j] = render_sample(rgb[j] * params.scale, false, params.band0, params.band1, reinhard, reject, params.maximum);
      }
    } else {
      // band0 bounds each exposed value against the reference (the development chain's a-priori bound).
      let e = rgb * params.scale;
      let t = luminance_tone(e, vec3<f32>(params.band0, params.band0, params.band0));
      for (var j = 0u; j < 3u; j++) {
        codes[i * 3u + j] = render_toned(e[j], false, params.band0, params.band1, t.m[j], t.delta[j], t.changed_uncertain, reject, params.maximum);
      }
    }
  }
  flush_counters(local_index);
}
`)();

/** Source-indexed isoplanatic-patch convolution of one output-row band; one invocation per output site. */
export const IRRADIANCE_CONVOLUTION_WGSL = /* @__PURE__ */ ((): string => /* wgsl */ `
struct Params {
  width: u32, height: u32, radius: u32, size: u32,
  patch_w: u32, patch_h: u32, cols: u32, rows: u32,
  out_row0: u32, out_rows: u32, in_row0: u32, taps: u32,
};
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read> kernels: array<f32>;
@group(0) @binding(3) var<storage, read_write> result: array<f32>;
@compute @workgroup_size(${CONVOLUTION_WORKGROUP_EDGE}, ${CONVOLUTION_WORKGROUP_EDGE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let local_y = gid.y;
  if (x >= params.width || local_y >= params.out_rows) { return; }
  let y = i32(params.out_row0 + local_y);
  let r = i32(params.radius);
  var sum = 0.0;
  for (var v = -r; v <= r; v++) {
    let sy = y - v;
    if (sy < 0 || sy >= i32(params.height)) { continue; }
    let patch_row = min(u32(sy) / params.patch_h, params.rows - 1u) * params.cols;
    let kernel_row = (v + r) * i32(params.size) + r;
    let source_row = (u32(sy) - params.in_row0) * params.width;
    for (var u = -r; u <= r; u++) {
      let sx = i32(x) - u;
      if (sx < 0 || sx >= i32(params.width)) { continue; }
      let patch_index = patch_row + min(u32(sx) / params.patch_w, params.cols - 1u);
      sum = sum + source[source_row + u32(sx)] * kernels[patch_index * params.taps + u32(kernel_row + u)];
    }
  }
  result[local_y * params.width + x] = sum;
}
`)();
