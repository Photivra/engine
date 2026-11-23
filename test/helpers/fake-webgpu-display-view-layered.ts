// SPDX-License-Identifier: Apache-2.0
/**
 * #750 (2.29.0, group LGPU): the layered passes (src/gpu/wgsl-display-view-layered-kernel.ts) on the fake device, line by line in
 * float32 (Math.fround after every operation, round to nearest): the blocked sum per lattice point and node, and the sites' blocked
 * sum over the combined kernels with the Quality site tail.
 */
import { DISPLAY_VIEW_QUALITY_GROUP_WORDS } from "../../src/gpu/wgsl-display-view-quality-kernel.js";
import { DISPLAY_VIEW_LAYERED_SINGLE, DISPLAY_VIEW_LAYERED_SPAN_WORDS } from "../../src/gpu/wgsl-display-view-layered-kernel.js";
import { channelOf, readParams, writeSite } from "./fake-webgpu-display-view-quality.js";

const f = Math.fround, GROUP = DISPLAY_VIEW_QUALITY_GROUP_WORDS;

/** Pass 1 (`displayViewLayeredSumWgsl`). Bindings: 0 sum params, 1 groups, 2 points, 3 spans, 4 kernels, 5 windows, 6 radiance, 7 sums. */
export function emulateLayeredSum(sp: Uint32Array, groups: Uint32Array, points: Uint32Array, spans: Uint32Array, kernels: Float32Array, windows: Uint32Array, radiance: Float32Array,
  sums: Float32Array): void {
  const [count, first, G, N, K, pointBase] = [sp[0]!, sp[1]!, sp[2]!, sp[3]!, sp[4]!, sp[5]!];
  const gi = new Int32Array(groups.buffer, groups.byteOffset, groups.length), wi = new Int32Array(windows.buffer, windows.byteOffset, windows.length);
  const sf = new Float32Array(spans.buffer, spans.byteOffset, spans.length), si = new Int32Array(spans.buffer, spans.byteOffset, spans.length);
  const radianceAt = (k: number, g: number, x: number, y: number, n: number): number => {
    const w = 2 * K + (k * G + g) * 4;
    return radiance[windows[w]! + ((y - wi[w + 2]!) * windows[w + 3]! + (x - wi[w + 1]!)) * N + n]!;
  };
  for (let local = 0; local < count; local++) {
    const n = local % N, at = Math.floor(local / N), i = first + at;
    let g = 0;
    for (let k = 1; k < G; k++) if (i >= groups[k * GROUP + 4]!) g = k;
    const base = g * GROUP, lw = groups[base + 2]!, rel = i - groups[base + 4]!, p = gi[base]! + (rel % lw), q = gi[base + 1]! + Math.floor(rel / lw);
    const code = points[(at + pointBase) * 2]!;
    let total = 0;
    if ((code & DISPLAY_VIEW_LAYERED_SINGLE) !== 0) {
      const k = code & 0xffff, ko = windows[2 * k]!, R = windows[2 * k + 1]!, side = 2 * R + 1;
      for (let tv = -R; tv <= R; tv++) {
        let row = 0;
        const wrow = ko + (tv + R) * side;
        for (let tu = -R; tu <= R; tu++) row = f(row + f(kernels[wrow + tu + R]! * radianceAt(k, g, p - tu, q - tv, n)));
        total = f(total + row);
      }
    } else {
      const entry0 = points[(at + pointBase) * 2 + 1]!;
      let row = 0, surface = 0, key = 0xffffffff;
      for (let e = entry0; e < entry0 + code; e++) for (let s = points[2 * e]!; s < points[2 * e]! + points[2 * e + 1]!; s++) {
        const o = s * DISPLAY_VIEW_LAYERED_SPAN_WORDS, kr = spans[o]!;
        if (kr !== key) {
          surface = f(surface + row); row = 0;
          if ((kr >>> 16) !== (key >>> 16)) { total = f(total + surface); surface = 0; }
          key = kr;
        }
        const k = kr >>> 16, ko = windows[2 * k]!, R = windows[2 * k + 1]!, tv = (kr & 0xffff) - R, wrow = ko + (tv + R) * (2 * R + 1), factor = sf[o + 3]!;
        for (let tu = si[o + 1]!; tu <= si[o + 2]!; tu++) row = f(row + f(f(kernels[wrow + tu + R]! * factor) * radianceAt(k, g, p - tu, q - tv, n)));
      }
      total = f(total + f(surface + row));
    }
    sums[i * N + n] = total;
  }
}

/** Pass 2 (`displayViewLayeredSitesWgsl`). Bindings: 0 the Quality params, 1 groups, 3 table, 4 sums, 5 sites, 6 the layered site uniform. */
export function emulateLayeredSites(pw: Uint32Array, pf: Float32Array, groups: Uint32Array, table: Float32Array, lattice: Float32Array, sites: Float32Array, layered: Float32Array): void {
  const P = readParams(pw, pf), sw = new Uint32Array(sites.buffer, sites.byteOffset, sites.length), dark = [P.dark0!, P.dark1!, P.dark2!];
  const T = P.taps!, N = pw[53]!;
  for (let local = 0; local < P.count!; local++) {
    const i = P.siteFirst! + local, ii = i % P.siteW!, jj = Math.floor(i / P.siteW!), c = channelOf(P.siteX0! + ii, P.siteY0! + jj);
    let sum = 0;
    for (let k = 0; k < P.groups!; k++) {
      const g = k * GROUP, lw = groups[g + 2]!, cw = lw - P.siteW! + 1, ch = groups[g + 3]! - P.siteH! + 1, lattice0 = groups[g + 4]! + jj * lw + ii, tap0 = groups[g + 5]!;
      let groupSum = 0;
      for (let dy = 0; dy < ch; dy++) {
        const row = lattice0 + dy * lw, rowTap = tap0 + dy * cw;
        let rowSum = 0;
        for (let dx = 0; dx < cw; dx++) {
          const point = row + dx, t = rowTap + dx;
          let cell = 0;
          for (let n = 0; n < N; n++) cell = f(cell + f(lattice[point * N + n]! * table[(n * 3 + c) * T + t]!));
          rowSum = f(rowSum + cell);
        }
        groupSum = f(groupSum + rowSum);
      }
      sum = f(sum + groupSum);
    }
    const e = f(sum + dark[c]!);
    writeSite(P, sites, sw, i, c, e, f(f(P.siteGamma! * e) + layered[0]!), 0);
  }
}
