// SPDX-License-Identifier: Apache-2.0

/**
 * #605 (2.23.0): `highlightMode: "reconstruct-neighbors"` (#602) in the display view's GPU kernels, Speed and Quality, fast and
 * full. The highlight step of the coupled chain (`cp_develop` in wgsl-display-view-coupled.ts) becomes the rebuild of
 * src/color/neighbor-highlight-reconstruction.ts (`rebuildClippedPixel`, `nb_rebuild` below), with each real pixel's region
 * ratios ρ from the host.
 *
 * **The ratios are found on the host and uploaded** (docs/WEBGPU.md, "Neighbor highlight reconstruction"): the reference's own
 * float64 code (`DisplayViewCoupledRendering.ratioAt`: the noise-free channels, the 8-connected clipped regions widened by the
 * margin, the ring's mean ratios fast or their harmonic fill by SOR full) gives ρ for exactly the real pixels whose chain needs
 * them, so every region decision is the reference's and ρ carries one float32 rounding. They travel in the band's flag buffer
 * after its flag words (no binding is added; the kernels stay within the 8 storage buffers per stage): one word per display
 * pixel (the offset of its block, `MISSING` or `SKIP`) and per block 3 floats for each real pixel of the footprint.
 *
 * Two dispatches per band: the first runs with every offset `MISSING`; a pixel whose chain needs a ratio skips the chain and
 * sets `DISPLAY_VIEW_NEIGHBORS_FLAG`. The host then computes the ratios of those pixels' footprints and runs the band again
 * with the other pixels `SKIP` (they return at once, so their first results stay in the output buffer). The kernels' default (`DISPLAY_VIEW_NEIGHBORS_STUB_WGSL`, wgsl-display-view-coupled-stub.ts)
 * computes every pixel in one dispatch.
 *
 * Bounds (first order, as the coupled steps', E = 2⁻²³): the rebuild's roundings, at most 10E of the largest rebuilt channel
 * (the products u = c·g, the sums of the kept channels and ratios, the quotient's 2.5E, the product s·ρ and ρ's own upload
 * rounding through ∂b/∂ρ, ≤ E·|b|), enter the chain where the blend's 8E did; the rebuild is continuous except where a channel
 * crosses the threshold (kept or clipped), so a node within its rounding, the channel mean's bound and the variance's (√δ
 * times 5, beyond the largest Gauss–Hermite node) of the threshold flags the display pixel for the host's reference.
 */

import type { DisplayViewSetup } from "../facade/display-view.js";
import { DISPLAY_VIEW_NEIGHBORS_STUB_WGSL } from "./wgsl-display-view-coupled-stub.js";
import { DISPLAY_VIEW_GEOMETRY_STRIDE as stride } from "./wgsl-display-view-speed-kernel.js";

/** The display-pixel flag bit of a chain that needed ratios the host had not given yet (both kernels' first flag word). */
export const DISPLAY_VIEW_NEIGHBORS_FLAG = 128;
const MISSING = 0xffffffff, SKIP = 0xfffffffe, FLAG_WORDS = 3;

const COMMON = /* wgsl */ `
const NB_H: f32 = 0.98;
struct NbOut { b: vec3<f32>, j0: vec3<f32>, j1: vec3<f32>, j2: vec3<f32>, err: f32 };
`;
/** The coupled steps' neighbor functions in a view without the reconstruction (with the kernels' stub). */
export const DISPLAY_VIEW_NEIGHBORS_OFF_WGSL = COMMON + DISPLAY_VIEW_NEIGHBORS_STUB_WGSL + /* wgsl */ `
fn nb_on() -> bool { return false; }
fn nb_rebuild(c: vec3<f32>, g: vec3<f32>) -> NbOut { var o: NbOut; return o; }
`;
/** The full form (with the coupled steps' text; it uses `CP_E`, `cp_unit`, `flags` and `params.count`). */
export const DISPLAY_VIEW_NEIGHBORS_WGSL = COMMON + /* wgsl */ `
var<private> nb_rho: vec3<f32>;
var<private> nb_need: bool;
fn nb_on() -> bool { return true; }
fn nb_skip(i: u32) -> bool { return flags[3u * params.count + i] == 0xfffffffeu; }
fn nb_ratio(i: u32, r: u32) -> bool {
  let o = flags[3u * params.count + i];
  if (o >= 0xfffffffeu) { nb_need = true; return false; }
  let p = o + 3u * r;
  nb_rho = vec3<f32>(bitcast<f32>(flags[p]), bitcast<f32>(flags[p + 1u]), bitcast<f32>(flags[p + 2u]));
  return true;
}
fn nb_flag() -> u32 { return select(0u, 128u, nb_need); }
fn nb_max(v: vec3<f32>) -> f32 { return max(abs(v.x), max(abs(v.y), abs(v.z))); }
fn nb_rebuild(c: vec3<f32>, g: vec3<f32>) -> NbOut {
  let u = c * g;
  let r = nb_rho;
  var j = array<vec3<f32>, 3>(vec3<f32>(g.x, 0.0, 0.0), vec3<f32>(0.0, g.y, 0.0), vec3<f32>(0.0, 0.0, g.z));
  var b = u;
  let k = c < vec3<f32>(NB_H);
  var e = 1.0;
  if (!all(k) && !(r.x < 0.0)) {
    if (!any(k)) {
      let q = select(vec3<f32>(0.0), u / select(vec3<f32>(1.0), r, r > vec3<f32>(0.0)), r > vec3<f32>(0.0));
      let m = select(select(2u, 1u, q.y > q.z), select(2u, 0u, q.x > q.z), q.x > q.y);
      b = q[m] * r;
      for (var n = 0u; n < 3u; n = n + 1u) { j[n] = vec3<f32>(0.0); if (r[m] > 0.0) { j[n] = cp_unit(m) * (r[n] * g[m] / r[m]); } }
      e = 6.0;
    } else {
      let ku = select(vec3<f32>(0.0), u, k);
      let kr = select(vec3<f32>(0.0), r, k);
      let su = (ku.x + ku.y) + ku.z;
      let sr = (kr.x + kr.y) + kr.z;
      let s = select(0.0, su / select(1.0, sr, sr > 0.0), sr > 0.0);
      for (var n = 0u; n < 3u; n = n + 1u) {
        let t = s * r[n];
        if (!k[n] && t > u[n]) { b[n] = t; j[n] = vec3<f32>(0.0); if (sr > 0.0) { j[n] = select(vec3<f32>(0.0), r[n] * g / sr, k); } }
      }
      e = 10.0;
    }
  }
  return NbOut(b, j[0], j[1], j[2], e * CP_E * nb_max(b));
}
`;

/** The coupled steps' neighbor functions: the full form with the reconstruction, else the off form. */
export const displayViewNeighborsWgsl = (on: boolean): string => on ? DISPLAY_VIEW_NEIGHBORS_WGSL : DISPLAY_VIEW_NEIGHBORS_OFF_WGSL;

/** Test hook (#605): the last render's ratio work: the dispatches, the pixels and real pixels given ratios, and the host's milliseconds. */
export const displayViewNeighborStats = { dispatches: 0, pixels: 0, realPixels: 0, hostMilliseconds: 0 };

/**
 * Runs one band's pixel dispatch with the ratios (see the module notes). `run` dispatches the band with the given flag-buffer
 * contents (its flag words first) and returns the flag words read back; the output buffer is the band's own across the calls.
 * `geometry` is the kernels' axis records (columns, then rows; both kernels' stride of 20 words). Returns the final flag words.
 */
export async function dispatchWithNeighborRatios(setup: DisplayViewSetup, geometry: Float32Array, first: number, count: number, limitBytes: number,
  run: (flags: Uint32Array<ArrayBuffer>) => Promise<Uint32Array>): Promise<Uint32Array> {
  const coupled = setup.coupled!, ints = new Int32Array(geometry.buffer, geometry.byteOffset, geometry.length), width = setup.region.width, rho = new Float64Array(3);
  const start = new Uint32Array((FLAG_WORDS + 1) * count);
  start.fill(MISSING, FLAG_WORDS * count);
  let flags = await run(start);
  displayViewNeighborStats.dispatches++;
  let pending: number[] = [];
  for (let i = 0; i < count; i++) if ((flags[FLAG_WORDS * i]! & DISPLAY_VIEW_NEIGHBORS_FLAG) !== 0) pending.push(i);
  if (pending.length > 0) coupled.bindView!(setup);
  while (pending.length > 0) {
    const t0 = performance.now(), words: number[] = Array.from(flags.subarray(0, FLAG_WORDS * count)), offsets = new Array<number>(count).fill(SKIP), data: number[] = [];
    const header = (FLAG_WORDS + 1) * count, floats = new Float32Array(1), bits = new Uint32Array(floats.buffer);
    let taken = 0;
    for (; taken < pending.length; taken++) {
      const i = pending[taken]!, p = first + i, rx = p % width, ry = (p - rx) / width, col = rx * stride, row = (width + ry) * stride, nx = ints[col + 1]!, ny = ints[row + 1]!;
      if (taken > 0 && 4 * (header + data.length + 3 * nx * ny) > limitBytes) break;
      offsets[i] = header + data.length;
      for (let j = 0; j < ny; j++) for (let ii = 0; ii < nx; ii++) {
        coupled.ratioAt!(ints[col]! + ii + setup.margin, ints[row]! + j + setup.margin, rho);
        for (let c = 0; c < 3; c++) { floats[0] = rho[c]!; data.push(bits[0]!); }
      }
      displayViewNeighborStats.realPixels += nx * ny;
    }
    displayViewNeighborStats.pixels += taken;
    const contents = Uint32Array.from([...words, ...offsets, ...data]);
    displayViewNeighborStats.hostMilliseconds += performance.now() - t0;
    flags = await run(contents);
    displayViewNeighborStats.dispatches++;
    pending = pending.slice(taken);
  }
  // A pixel still without its ratios cannot happen; it would take the host's reference (flag bit 0).
  for (let i = 0; i < count; i++) if ((flags[FLAG_WORDS * i]! & DISPLAY_VIEW_NEIGHBORS_FLAG) !== 0) flags[FLAG_WORDS * i] = flags[FLAG_WORDS * i]! | 1;
  return flags;
}
