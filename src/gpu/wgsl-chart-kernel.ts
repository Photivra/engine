// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernel for the `webgpu-f32` chart-radiance stage (#277), one invocation per query point. It
 * evaluates the chart's material classification (`resolveChartScene().materialAt`) in float32 and looks up
 * the material's value in a table the host computed in float64 with the reference's own operations.
 *
 * Every classification decision (half-plane, disk, sector, cell and gap boundaries) is evaluated with an
 * a-priori bound on how far the float32 decision value can be from the float64 reference value: the
 * point's float32 rounding, each float32 operation (E = 2^-23: one WGSL rounding of + − ×, in either
 * direction, W3C WGSL "Floating Point Accuracy"), the float32 rounding of the constants and the
 * reference's own float64 rounding. A point whose decision value lies within four times its bound is
 * flagged, and the host recomputes it with the reference. So every unflagged point has exactly the
 * reference's material, and its value is the reference value rounded once to float32.
 *
 * Siemens-star sectors are decided only by the signs of cross products with the sector boundary
 * directions (host float64 cos/sin, rounded once to float32): the sign of v chooses the half-plane, a
 * binary search over that half-plane's boundaries finds the sector, and the two enclosing cross products
 * carry the bound. The kernel calls no transcendental function, so neither the WGSL `atan2` bound nor the
 * realm's float64 `Math.atan2` enters. See docs/WEBGPU.md, "Scene radiance on the GPU".
 */

export const CHART_WORKGROUP_SIZE = 256;
/** Preset codes of `Params.preset`, in `CHART_SCENE_PRESETS` order. */
export const CHART_PRESET_CODE = /* @__PURE__ */ Object.freeze({ uniform: 0, "slanted-edge": 1, "siemens-star": 2, "step-wedge": 3, "grey-ramp": 4, checkerboard: 5,
  "point-grid": 6, patches: 7 } as const);

/**
 * The chart's material classification: the `flagged` flag and `material(p)` with its helpers. The display view's chart module
 * (display-view-chart-material-module.ts) takes it from here and renames it, so no search of the kernel's text is needed (#658).
 */
export const CHART_MATERIAL_WGSL = /* wgsl */ `
var<private> flagged: bool;
fn check(distance: f32, bound: f32) { if (!(abs(distance) > SAFETY * bound)) { flagged = true; } }
// Flags t when it lies within the bound of an integer n with lo <= n <= hi.
fn check_integer(t: f32, bound: f32, lo: f32, hi: f32) {
  let n = round(t);
  if (SAFETY * bound >= 0.5) { flagged = true; return; }
  if (n >= lo && n <= hi) { check(t - n, bound); }
}
// x = (a + b) * scale, with the bound of its distance from the float64 reference value.
fn scaled_sum_bound(a: f32, b: f32, s: f32, scale: f32, x: f32, constant_rounding: f32) -> f32 {
  return E * ((abs(a) + abs(b) + abs(s)) * abs(scale) + (1.0 + constant_rounding) * abs(x)) + SLACK * (abs(x) + 1.0);
}
fn cross_d(u: f32, v: f32, k: u32) -> f32 { return v * aux[2u * k] - u * aux[2u * k + 1u]; }
fn cross_bound(u: f32, v: f32, k: u32, d: f32) -> f32 {
  return E * (3.0 * abs(v * aux[2u * k]) + 3.0 * abs(u * aux[2u * k + 1u]) + abs(d)) + SLACK * (abs(u) + abs(v));
}
fn material(p: vec2<f32>) -> u32 {
  let u = p.x;
  let v = p.y;
  switch (params.preset) {
    case 0u: { return 0u; }
    case 1u: {
      // Light where u·cos t − v·sin t ≥ 0.
      let a = u * params.f0;
      let b = v * params.f1;
      let d = a - b;
      check(d, E * (3.0 * abs(a) + 3.0 * abs(b) + abs(d)) + SLACK * (abs(u) + abs(v)));
      return select(0u, 1u, d >= 0.0);
    }
    case 2u: {
      let uu = u * u;
      let vv = v * v;
      let q = uu + vv;
      check(q - params.f0, E * (4.0 * q + 2.0 * params.f0) + SLACK * (q + params.f0));
      if (q > params.f0) { return 2u; }
      // Boundaries b_k = π(k/cycles − 1), k = 0 … 2·cycles. In the half-plane v ≥ 0 the angle lies in [0, π],
      // between b_cycles and b_2cycles; for v < 0 in [−π, 0), between b_0 and b_cycles. Within one half-plane,
      // sign(cross(k)) = sign(θ − b_k), so a binary search on the cross-product signs finds the sector. A point
      // within the bound of a boundary (the u-axis and the ±π cut included) is caught by the two final checks.
      var low = select(0u, params.na, v >= 0.0);
      var high = low + params.na;
      loop {
        if (high - low <= 1u) { break; }
        let middle = (low + high) >> 1u;
        if (cross_d(u, v, middle) >= 0.0) { low = middle; } else { high = middle; }
      }
      let k = low;
      let lo = cross_d(u, v, k);
      let hi = cross_d(u, v, k + 1u);
      if (lo < 0.0 || hi >= 0.0) { flagged = true; }
      check(lo, cross_bound(u, v, k, lo));
      check(hi, cross_bound(u, v, k + 1u, hi));
      return select(0u, 1u, k % 2u == 0u);
    }
    case 3u, 4u: {
      let s = u + 1.0;
      let t = s * params.f0;
      check_integer(t, scaled_sum_bound(u, 1.0, s, params.f0, t, 0.0), 1.0, f32(params.na - 1u));
      return u32(clamp(floor(t), 0.0, f32(params.na - 1u)));
    }
    case 5u: {
      let s = u + 1.0;
      let x = s * params.f0;
      let w = params.f1 - v;
      let y = w * params.f0;
      check_integer(x, scaled_sum_bound(u, 1.0, s, params.f0, x, 0.0), -3.0e38, 3.0e38);
      check_integer(y, scaled_sum_bound(params.f1, v, w, params.f0, y, 0.0), -3.0e38, 3.0e38);
      let i = i32(floor(x));
      let j = i32(floor(y));
      return select(0u, 1u, (i + j) % 2 == 0);
    }
    case 6u: {
      let s = u + 1.0;
      let x = s * params.f0;
      let w = params.f1 - v;
      let y = w * params.f2;
      check_integer(x, scaled_sum_bound(u, 1.0, s, params.f0, x, 0.0), 1.0, f32(params.na - 1u));
      check_integer(y, scaled_sum_bound(params.f1, v, w, params.f2, y, 1.0), 1.0, f32(params.nb - 1u));
      let i = u32(clamp(floor(x), 0.0, f32(params.na - 1u)));
      let j = u32(clamp(floor(y), 0.0, f32(params.nb - 1u)));
      let c = j * params.na + i;
      let dx = u - aux[2u * c];
      let dy = v - aux[2u * c + 1u];
      let ex = E * (abs(u) + abs(aux[2u * c]) + abs(dx));
      let ey = E * (abs(v) + abs(aux[2u * c + 1u]) + abs(dy));
      let d2 = dx * dx + dy * dy;
      check(d2 - params.f3, 2.0 * (abs(dx) * ex + abs(dy) * ey) + ex * ex + ey * ey + E * (2.0 * d2 + params.f3) + SLACK * (d2 + params.f3));
      return select(0u, 1u, d2 <= params.f3);
    }
    default: {
      let s = u + 1.0;
      let fx = s * params.f0;
      let w = params.f1 - v;
      let fy = w * params.f2;
      let bx = scaled_sum_bound(u, 1.0, s, params.f0, fx, 0.0);
      let by = scaled_sum_bound(params.f1, v, w, params.f2, fy, 1.0);
      check_integer(fx, bx, -3.0e38, 3.0e38);
      check_integer(fy, by, -3.0e38, 3.0e38);
      let background = params.nc;
      let ifx = floor(fx);
      let ify = floor(fy);
      if (ifx < 0.0 || ify < 0.0 || ifx >= f32(params.na) || ify >= f32(params.nb)) { return background; }
      let index = u32(ify) * params.na + u32(ifx);
      let x = fx - ifx;
      let y = fy - ify;
      check(x - params.f3, bx + E * params.f3);
      check(x - params.f4, bx + E * params.f4);
      check(y - params.f3, by + E * params.f3);
      check(y - params.f4, by + E * params.f4);
      if (index >= params.nc || x < params.f3 || x > params.f4 || y < params.f3 || y > params.f4) { return background; }
      return index;
    }
  }
}
`;

export const CHART_RADIANCE_WGSL = /* wgsl */ `
const E: f32 = 1.1920928955078125e-7;
const SAFETY: f32 = 4.0;
const SLACK: f32 = 1e-14;
struct Params {
  count: u32, columns: u32, preset: u32, na: u32,
  nb: u32, nc: u32, wavelength_mode: u32, pad0: u32,
  f0: f32, f1: f32, f2: f32, f3: f32,
  f4: f32, f5: f32, f6: f32, f7: f32,
};
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> points: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> table: array<f32>;
@group(0) @binding(3) var<storage, read> aux: array<f32>;
@group(0) @binding(4) var<storage, read> selectors: array<u32>;
@group(0) @binding(5) var<storage, read_write> values: array<f32>;
@group(0) @binding(6) var<storage, read_write> flags: array<u32>;

${CHART_MATERIAL_WGSL}
@compute @workgroup_size(${CHART_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let i = gid.x + gid.y * groups.x * ${CHART_WORKGROUP_SIZE}u;
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
