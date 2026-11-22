// SPDX-License-Identifier: Apache-2.0
// #734: a large defocus disc with `lens.diffraction` computed each run tile once per diffraction tile, not once per spectral node,
// whatever the lattice's share of the cache. Values are unchanged (each node's gather reads the same run-tile values).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLargeDefocusNodeLattice, LARGE_DEFOCUS_CACHE_BYTES, LARGE_DEFOCUS_TILE, type LargeDefocusNodeLattice } from "../src/facade/large-defocus-lattice.js";
import { siteKernelRuns } from "../src/optics/site-kernel-runs.js";
import { simulateCapture } from "../src/index.js";

/** A uniform disc kernel of radius R (row-major (2R + 1)² taps), normalized. */
function disc(R: number): Float64Array {
  const k = new Float64Array((2 * R + 1) ** 2);
  let sum = 0;
  for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) if (u * u + v * v <= R * R) { k[t] = 1; sum++; }
  for (let t = 0; t < k.length; t++) k[t]! /= sum;
  return k;
}
/** A diffraction-like site kernel of radius 2 per wavelength (normalized, depends on the wavelength). */
function diffraction(nm: number): Float64Array {
  const R = 2, k = new Float64Array(25), s = nm / 400;
  let sum = 0;
  for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) { k[t] = Math.exp(-(u * u + v * v) / (2 * s * s)); sum += k[t]!; }
  for (let t = 0; t < 25; t++) k[t]! /= sum;
  return k;
}

function lattice(nodes: number, lattices: number): { L: LargeDefocusNodeLattice; sources: () => number } {
  const wavelengthsNm = Array.from({ length: nodes }, (_, n) => 400 + (300 * n) / Math.max(1, nodes - 1));
  let sources = 0;
  const L = createLargeDefocusNodeLattice({
    kernel: { runs: siteKernelRuns(disc(104), 104), diffraction: { radius: 2, kernelAt: diffraction } },
    wavelengthsNm, capacityBytes: LARGE_DEFOCUS_CACHE_BYTES / lattices,
    source: (x0, y0, width, height) => {
      sources++;
      return (node): Float64Array => {
        const out = new Float64Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = 0.5 + 0.4 * Math.sin((x0 + x) * 0.37 + (y0 + y) * 0.11 + node);
        return out;
      };
    }
  });
  return { L, sources: () => sources };
}

/** Reads every node of a 16 × 12 block inside one tile. */
function readBlock(L: { valueAt(n: number, x: number, y: number): number }, nodes: number): number[] {
  const values: number[] = [];
  for (let y = 20; y < 32; y++) for (let x = 20; x < 36; x++) for (let n = 0; n < nodes; n++) values.push(L.valueAt(n, x, y));
  return values;
}

describe("large defocus lattice with diffraction (#734)", () => {
  it("computes the 9 run tiles of one diffraction tile once, at 20 nodes and 9 lattices (180 before)", { timeout: 60_000 }, () => {
    const { L, sources } = lattice(20, 9);
    readBlock(L, 20);
    expect(sources()).toBe(9);
  });
  it("computes 9 run tiles at 81 nodes and 4 lattices (729 before)", { timeout: 60_000 }, () => {
    const { L, sources } = lattice(81, 4);
    readBlock(L, 81);
    expect(sources()).toBe(9);
  });
  it("gives the same values whatever the lattice's share of the cache", { timeout: 60_000 }, () => {
    const small = lattice(20, 9), large = lattice(20, 1);
    const a = readBlock(small.L, 20), b = readBlock(large.L, 20);
    expect(a).toEqual(b);
    // A block across a tile corner reads four diffraction tiles and the same values from either share.
    const corner = (L: LargeDefocusNodeLattice): number[] => { const v: number[] = []; for (let y = LARGE_DEFOCUS_TILE - 3; y < LARGE_DEFOCUS_TILE + 3; y++) for (let x = LARGE_DEFOCUS_TILE - 3; x < LARGE_DEFOCUS_TILE + 3; x++) for (let n = 0; n < 20; n++) v.push(L.valueAt(n, x, y)); return v; };
    expect(corner(small.L)).toEqual(corner(large.L));
  });
  it("renders the issue's 3 × 3 box request at no more than 4 × the CPU of its 2 × 2 box (37 × before)", async () => {
    const request = (samplesPerAxis: number): Parameters<typeof simulateCapture>[0] => ({ scene: { preset: "siemens-star" as const }, subjectDistanceM: 5, fast: false,
      sensor: { pixelAperture: { kind: "box" as const, samplesPerAxis } },
      lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 0.5, defocus: { model: "geometric-disc" as const }, diffraction: "circular-aperture" as const },
      output: { width: 600, height: 400, format: "srgb-16" as const, region: { x: 292, y: 194, width: 16, height: 12 } } });
    const sha = (a: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
    const raws: Record<number, string> = {};
    const cpu = async (n: number): Promise<number> => { const t = process.cpuUsage(); const r = await simulateCapture(request(n)); const d = process.cpuUsage(t); raws[n] = sha(r.raw.codes); return (d.user + d.system) / 1e6; };
    await cpu(2);
    const two = await cpu(2), three = await cpu(3);
    // Expected about 9/4; 4 leaves room for a loaded machine (before: 108 s against 3 s).
    expect(three / two).toBeLessThan(4);
    // The RAW codes of 2.28.0 step 5's tree (8405ae2), on which the 3 × 3 request took 109 CPU s: unchanged.
    expect(raws).toEqual({ 2: "dbc58400995c536e5d2662846ce97bbeeb60d07d5e5cf01cd71acbf767ea5403", 3: "28e79fbaca839ebc339492b18d27274425882b967783d429e2f9dcd1ac1c84c7" });
    // 240 s, or 600 s under coverage (owner decision 2026-11-22): the test takes about 100 s alone under V8 coverage
    // locally and about 280 s on the hosted runners, so 240 s failed whenever its coverage shard ran slowly.
  }, Number(process.env.PHOTIVRA_TEST_TIMEOUT_SCALE) >= 4 ? 600_000 : 240_000);
});
