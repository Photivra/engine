// SPDX-License-Identifier: Apache-2.0

/**
 * WGSL kernels of the layered chart scene's display view on the GPU (#750, 2.29.0 group LGPU): passes 1 and 2 of the Quality path
 * (`wgsl-display-view-quality-kernel.ts`) for a layered scene on the planar map. Pass 3 (the display pixels) is the Quality kernel's
 * own. The float64 reference is the layered sum of `facade/layered-scene-signal.ts` through `renderDisplayView`:
 *
 *   S(p)[n] = Σ_k Σ_t D_k(t)·V_k(p, t)·L_k(p − t)[n]          (each lattice point p of each lattice group)
 *   site_c(x) = Σ_g Σ_d Σ_n C_{n,c}(d)·S_g(x + d)[n] + dark_c   (each native site x of channel c)
 *
 * with D_k surface k's defocus kernel, V_k the share of tap t's pupil region whose rays reach surface k (the visibility's
 * `share`), L_k the surface's spectral radiance at the nodes, and C_{n,c}(d) the reference's combined kernel per node and channel
 * (Σ_members w·A_c(λ_n)·K_n(t), `displayViewSignalTables`). No value holds a channel response summed over the spectrum: S and L are
 * spectral radiance at the nodes, and A_c enters per node when a site is read.
 *
 * 1. **Sum** (`displayViewLayeredSumWgsl`): one invocation per lattice point and spectral node. A point that sees one surface (its
 *    code has bit 31) sums every tap of that surface's kernel; an edge point sums the spans of its surfaces' lists, each span a run of taps [u0, u1] of one kernel
 *    row with a factor f (1 for taps whose regions all reach the surface, V for a tap whose region reaches part of it). The host
 *    forms every point's code and spans with the reference's own geometry and visibility in float64 (`display-view-layered-gpu.ts`),
 *    so every V is the reference's. The sum is blocked: a row partial over its taps, a surface partial over its rows, the total
 *    over the surfaces.
 * 2. **Sites** (`displayViewLayeredSitesWgsl`): one invocation per native site: Σ_g Σ_dy Σ_dx Σ_n C·S as the image-plane Quality
 *    pass sums its lattice radiance (`IMAGE_PLANE_QUALITY_SITES_WGSL`), then the Quality path's readout moments (`write_site`).
 *
 * **Bounds (first order; the host doubles every pixel bound).** Every term is non-negative. A sum term w·f·L carries the host
 * roundings of w, f and L (E/2 each, E = 2⁻²³), the product w·f (E; none when f = 1) and the product with L (E), and at most 2R
 * additions in its row, 2R in its surface and K − 1 over the surfaces: S carries (4R + K + 2.5)·E relative. A site term C·S adds C's
 * rounding (E/2) and the product (E), then at most N − 1 + cw − 1 + ch − 1 + G − 1 additions and the dark electrons (one addition,
 * host-rounded E/2): the site carries (4R + K + N + cw + ch + G + 2)·E relative, inside `params.site_gamma`, plus `site_tiny`
 * (what a device that flushes results below the float32 normal range can drop; WGSL allows it).
 *
 * Precision assumptions are those of the Quality kernels (the W3C WGSL accuracy table: + − × one rounding in either direction), and
 * the blocked order is the Quality defocus pass's (docs/WEBGPU.md, "Defocus on the GPU").
 */

/** What the layered shaders take from the Quality kernels: the common declarations, `write_site`, the group record words, the workgroup size. */
export type DisplayViewLayeredWgslHost = readonly [commonWgsl: string, siteTailWgsl: string, groupWords: number, workgroupSize: number];

/** Words per span: k·65536 + (tv + R_k), u0 (i32), u1 (i32), f (f32). */
export const DISPLAY_VIEW_LAYERED_SPAN_WORDS = 4;
/**
 * Words per lattice point of a sum dispatch: the code (bit 31 and the surface for a point that sees one surface, else its count of
 * surface lists) and its first list entry; each entry (after the points) is two words too, a list's first span and span count.
 */
export const DISPLAY_VIEW_LAYERED_POINT_WORDS = 2;
/** Bit 31 of a point's code: the point sees one surface (bits 0–15). */
export const DISPLAY_VIEW_LAYERED_SINGLE = 0x80000000;
/** Words of the sum pass's uniform (`SumParams`). */
export const DISPLAY_VIEW_LAYERED_SUM_PARAM_WORDS = 8;
/** Words of the site pass's own uniform (`LayeredSites`): the absolute term `site_tiny`, padded. */
export const DISPLAY_VIEW_LAYERED_SITE_PARAM_WORDS = 4;

/**
 * Pass 1. Bindings: 0 the sum uniform, 1 the Quality group records, 2 the dispatch's point and list-entry words, 3 its spans, 4 the
 * surfaces' kernels, 5 the surface and window table (per surface its kernel's offset and radius; then per surface k and group g at
 * 2K + (k·G + g)·4 its radiance window: first value, x0, y0, width), 6 the radiance windows (N values per point), 7 the sums out.
 */
export const displayViewLayeredSumWgsl = (groupWords: number, workgroupSize: number): string => /* wgsl */ `
struct SumParams { count: u32, first: u32, groups: u32, nodes: u32, surfaces: u32, point_base: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<uniform> sp: SumParams;
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(2) var<storage, read> points: array<u32>;
@group(0) @binding(3) var<storage, read> spans: array<u32>;
@group(0) @binding(4) var<storage, read> kernels: array<f32>;
@group(0) @binding(5) var<storage, read> windows: array<u32>;
@group(0) @binding(6) var<storage, read> radiance: array<f32>;
@group(0) @binding(7) var<storage, read_write> sums: array<f32>;
const GROUP: u32 = ${groupWords}u;
// The radiance of surface k at lattice point (x, y) of group g, node n (inside the surface's window).
fn radiance_at(k: u32, g: u32, x: i32, y: i32, n: u32) -> f32 {
  let w = 2u * sp.surfaces + (k * sp.groups + g) * 4u;
  let x0 = bitcast<i32>(windows[w + 1u]);
  let y0 = bitcast<i32>(windows[w + 2u]);
  return radiance[windows[w] + (u32(y - y0) * windows[w + 3u] + u32(x - x0)) * sp.nodes + n];
}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let local = gid.x + gid.y * wg.x * ${workgroupSize}u;
  if (local >= sp.count) { return; }
  let N = sp.nodes;
  let n = local % N;
  let at = local / N;
  let i = sp.first + at;
  var g = 0u;
  for (var k = 1u; k < sp.groups; k = k + 1u) { if (i >= groups[k * GROUP + 4u]) { g = k; } }
  let base = g * GROUP;
  let lw = groups[base + 2u];
  let rel = i - groups[base + 4u];
  let p = bitcast<i32>(groups[base]) + i32(rel % lw);
  let q = bitcast<i32>(groups[base + 1u]) + i32(rel / lw);
  let code = points[(at + sp.point_base) * 2u];
  var total = 0.0;
  if ((code & ${DISPLAY_VIEW_LAYERED_SINGLE}u) != 0u) {
    // One surface: every tap of its kernel, a row partial per kernel row.
    let k = code & 0xffffu;
    let ko = windows[2u * k];
    let R = i32(windows[2u * k + 1u]);
    let side = u32(2 * R + 1);
    for (var tv = -R; tv <= R; tv = tv + 1) {
      var row = 0.0;
      let wrow = ko + u32(tv + R) * side;
      for (var tu = -R; tu <= R; tu = tu + 1) { row = row + kernels[wrow + u32(tu + R)] * radiance_at(k, g, p - tu, q - tv, n); }
      total = total + row;
    }
  } else {
    // An edge point: its surfaces' lists (each a first span and a count), their spans in order of surface and kernel row.
    let entry0 = points[(at + sp.point_base) * 2u + 1u];
    var row = 0.0;
    var surface = 0.0;
    var key = 0xffffffffu;
    for (var e = entry0; e < entry0 + code; e = e + 1u) {
    let span0 = points[2u * e];
    for (var s = span0; s < span0 + points[2u * e + 1u]; s = s + 1u) {
      let o = s * ${DISPLAY_VIEW_LAYERED_SPAN_WORDS}u;
      let kr = spans[o];
      if (kr != key) {
        surface = surface + row;
        row = 0.0;
        if ((kr >> 16u) != (key >> 16u)) { total = total + surface; surface = 0.0; }
        key = kr;
      }
      let k = kr >> 16u;
      let ko = windows[2u * k];
      let R = i32(windows[2u * k + 1u]);
      let tv = i32(kr & 0xffffu) - R;
      let wrow = ko + u32(tv + R) * u32(2 * R + 1);
      let f = bitcast<f32>(spans[o + 3u]);
      for (var tu = bitcast<i32>(spans[o + 1u]); tu <= bitcast<i32>(spans[o + 2u]); tu = tu + 1) {
        row = row + (kernels[wrow + u32(tu + R)] * f) * radiance_at(k, g, p - tu, q - tv, n);
      }
    }
    }
    total = total + (surface + row);
  }
  sums[i * N + n] = total;
}
`;

/**
 * Pass 2 (the image-plane Quality pass's blocked sum without its flags). Bindings: 0 the Quality params, 1 the group records,
 * 3 the combined kernel table C at (n·3 + c)·T + t, 4 the sums, 5 the sites out, 6 the layered site uniform (`site_tiny`).
 */
export const displayViewLayeredSitesWgsl = (commonWgsl: string, siteTailWgsl: string, workgroupSize: number): string => /* wgsl */ `${commonWgsl}
@group(0) @binding(1) var<storage, read> groups: array<u32>;
@group(0) @binding(3) var<storage, read> table: array<f32>;
@group(0) @binding(4) var<storage, read> lattice: array<f32>;
@group(0) @binding(5) var<storage, read_write> sites: array<f32>;
struct LayeredSites { tiny: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(6) var<uniform> layered: LayeredSites;
${siteTailWgsl}
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) wg: vec3<u32>) {
  let local = gid.x + gid.y * wg.x * ${workgroupSize}u;
  if (local >= params.count) { return; }
  let i = params.site_first + local;
  let ii = i % params.site_w;
  let jj = i / params.site_w;
  let c = channel_of(params.site_x0 + i32(ii), params.site_y0 + i32(jj));
  let T = params.taps;
  let N = params.nodes;
  var sum = 0.0;
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
        for (var n = 0u; n < N; n = n + 1u) { cell = cell + lattice[point * N + n] * table[(n * 3u + c) * T + t]; }
        row_sum = row_sum + cell;
      }
      group_sum = group_sum + row_sum;
    }
    sum = sum + group_sum;
  }
  let e = sum + dark_of(c);
  write_site(i, c, e, params.site_gamma * e + layered.tiny, 0u);
}
`;
