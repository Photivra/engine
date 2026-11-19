// SPDX-License-Identifier: Apache-2.0
/**
 * #649: the display view with lens corrections and sharpening renders its passes in bands of rows that share one per-call site store
 * and one per-call store of real pixels' recorded terms, skips the view-size passes that the sharpening discards and draws no noise
 * for the passes whose samples are not used. Every step forms the same values from the same operands, so the samples, expected values
 * and noise are those of 2.26.0: these hashes were recorded on 2.26.0 (94f56f3) before the change, on x64 (Node 24.1.0 under
 * Rosetta 2) and on arm64 (Node 26.13.1), the same on both (#508), and hold unchanged after it, with the default bands and with bands
 * of a few rows. The scene-lookup, sample and site-evaluation counts are left out: they count the work done, which the change reduces.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewCallStore, createDisplayViewSiteStore, displayViewDetailBand } from "../src/facade/display-view-detail.js";
import type { DisplayViewExpectedSignal } from "../src/facade/display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";

const W = 192, H = 128, all = { distortion: true, lateralColor: true, vignetting: true }, sharpening = { radiusPixels: 1, amount: 1 };
const request = (output: SimulateCaptureOptions["output"], fast = true): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2,
  lens: { catalogue: "pv-24-1.8", fNumber: 1.8 }, fast, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 }, output: { width: W, height: H, ...output },
  exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } });
/** 8, 2 and 1 real pixels per display pixel per axis. */
const views: Record<string, SimulateDisplayViewOptions> = { "8x": { width: 24, height: 16 }, "2x": { width: 96, height: 64 }, "1x": { width: W, height: H } };
const requests: Record<string, SimulateCaptureOptions["output"]> = { plain: {}, corrections: { lensCorrections: all }, sharpening: { sharpening }, both: { lensCorrections: all, sharpening } };

async function digest(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<string> {
  const { result, internals } = await simulateDisplayViewWithInternals(options, view), hash = createHash("sha256");
  for (const a of [result.image.samples, internals.expected, internals.noiseStd, internals.saturated]) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  hash.update(JSON.stringify([internals.saturatedPixelCount, internals.detailPixelCount, internals.uniformPixelCount, internals.estimation, result.diagnostics.highlight]));
  return hash.digest("hex");
}

// Re-recorded for 2.27.0 on the integration branch (x64 Node 24.1.0 under Rosetta 2 and arm64, the same hashes): samples of all 17
// cases unchanged. The two exact cases (fast: false) differ from 2.26.0 by rounding (#655's one kernel pass, #653): site electrons
// within 6.6·10⁻¹⁶ and expected values within 2.3·10⁻¹⁵ relative. The fast cases also take #655's uniform-window fast method
// (lens.catalogue/view-uniform-window, new fast default): site electrons within 5.8·10⁻⁹, expected values within 6.1·10⁻⁹ relative.
/** [case, x64 lock]; the arm64 hash of a lock whose bytes differ there is in ARM64_HASHES (none: every case is the same on both). */
const LOCKS: readonly [string, string][] = [
  ["plain-8x", "49bfac9dbebe35cee05b192b73b05f2ee79f16b6213ae4da9500bf99b8ab8414"],
  ["plain-2x", "c785724e99f7d2ad04ba32c7ddc10e2c9856faf4775e09e7fc510e70362053c3"],
  ["plain-1x", "477595a8ad9d346c7f156b167155940308332ef9b48f77181518fa026ad277cc"],
  ["corrections-8x", "11a2f3f9cf150c08812ea07f71bcb6b9e7bbb7209d100b622f9dd5605d34adee"],
  ["corrections-2x", "0f637acc0bd2b6392efbee23e6a3e613abe6cb7c7f47168dff3884baf84b9ce9"],
  ["corrections-1x", "08f0c03d3f594b98f6f36ea38b81e9f2e44cf72d4bdc7c576c99be1a2405d50d"],
  ["sharpening-8x", "5cd2f0eeb0128f218513a3f098f681eab6099972888f7c84cc4fdb60f7d33060"],
  ["sharpening-2x", "5259e9f52e7d6b63b3b1d430a79f4cfe4628dfb161f06017c0312e670dea9b41"],
  ["sharpening-1x", "0c1704ede2a49a408ba48517d00c03c8ca80de4514474069e9bba3f795f84c7a"],
  ["both-8x", "936904ee80576a6fa320a6da59d8456a8d668e4e30fd043dfa958605d7047f0b"],
  ["both-2x", "25cb2ec15a96794cc713ef1d47af6383cdc19c3994097a67493bc8128b8ce7b6"],
  ["both-1x", "82087e6fcffc097cc065c15d2a971a28e265673dd90fb7a831b4bb04ee122697"],
  ["corrections-exact-8x", "eeaf125c60cc9a00ae125125d8aeab32e7c746e3fd878c56cc72c039f7ed209f"],
  ["both-exact-2x", "22d652bd70c729c1972219a32d5cabd55f16c24dd104f1f3cecac5618109a3d0"],
  ["both-ahd-2x", "801b33fc0f3e4d88798a47532d1b7b1d497e3d0c6765b467cef67264e85e9e86"],
  ["both-region-2x", "324f73acd7ed6bdf37096ca1148ebc150dd49003842269a2bd27800ba1c1012a"],
  ["neighbors-2x", "d52a978216597fc0a962437624d43c055dbcfa39d4af6f6d2d07daf01eb90fe2"],
];
const ARM64_HASHES: Readonly<Record<string, string>> = {
};
type Case = [SimulateCaptureOptions, SimulateDisplayViewOptions];
const CASES: Record<string, Case> = {};
for (const [r, output] of Object.entries(requests)) for (const [v, view] of Object.entries(views)) CASES[r + "-" + v] = [request(output), view];
CASES["corrections-exact-8x"] = [request({ lensCorrections: all }, false), views["8x"]!];
CASES["both-exact-2x"] = [request({ lensCorrections: all, sharpening }, false), views["2x"]!];
CASES["both-ahd-2x"] = [request({ lensCorrections: all, sharpening, demosaic: "ahd" }), views["2x"]!];
CASES["both-region-2x"] = [request({ lensCorrections: all, sharpening }), { ...views["2x"]!, region: { x: 37, y: 9, width: 41, height: 30 } }];
CASES["neighbors-2x"] = [request({ lensCorrections: { distortion: true, lateralColor: true }, highlightMode: "reconstruct-neighbors" }), views["2x"]!];

describe("display view lens corrections and sharpening share their sites and pixels across passes (#649)", () => {
  it("keeps the 2.26.0 samples, expected values and noise", async () => {
    if (process.env.RECORD_DETAIL_HASHES === "1") {
      for (const [name, c] of Object.entries(CASES)) console.log(JSON.stringify([name, await digest(...c)]));
      return;
    }
    expect(LOCKS.map(([name]) => name).sort()).toEqual(Object.keys(CASES).sort());
    const pixels = displayViewDetailBand.pixels;
    try {
      // The default bands (one band for these views), then bands of a few rows (2,000 real pixels: 1 to 10 display rows).
      for (const band of [pixels, 2000]) {
        displayViewDetailBand.pixels = band;
        for (const [name, lock] of LOCKS) expect(await digest(...CASES[name]!), name + " " + band).toBe(hashLockOnThisArchitecture(lock, ARM64_HASHES));
      }
    } finally { displayViewDetailBand.pixels = pixels; }
  }, scaledTimeout(900_000));

  it("keeps each site's or real pixel's record until its tile is the least recently used one over the budget", () => {
    // Tiles of 4 × 4 sites, 2 values and a flag per site: 16·8·3 = 384 B per tile; a budget of 800 B holds two tiles.
    const store = createDisplayViewCallStore(2, 800), value = (x: number, y: number): number => x * 1000 + y;
    const write = (x: number, y: number): void => { expect(store.find(x, y, 2)).toBe(false); store.records[store.offset] = value(x, y); store.records[store.offset + 1] = -x; store.filled(); };
    const held = (x: number, y: number): boolean => store.find(x, y, 2) && store.records[store.offset] === value(x, y) && store.records[store.offset + 1] === -x;
    write(1, 1); write(2, 3); write(5, 0);
    expect([held(1, 1), held(2, 3), held(5, 0), held(3, 3)]).toEqual([true, true, true, false]);
    // Tile (0, 0) is the most recent after the reads above (held(3, 3) is in it), so a third tile drops tile (1, 0).
    write(9, 9);
    expect([held(9, 9), held(1, 1)]).toEqual([true, true]);
    // Tile (1, 0) comes back empty and drops tile (2, 2), now the least recently used.
    expect([held(5, 0), held(1, 1), held(9, 9)]).toEqual([false, true, false]);
    // Another record size starts over.
    expect(store.find(1, 1, 3)).toBe(false);
  });

  it("reads each site through the signal once per call, and again where materials become tracked", () => {
    let reads = 0, tracked = false;
    const signal = { window() { /* none */ }, site(x: number, y: number) { reads++; return x + y / 8; }, pilot: () => 0, lookups: 7, get uniformMaterial() { return tracked ? 3 : -1; },
      get tracksMaterial() { return tracked; }, cachesSites: true, marksReads: false, markReads() { /* none */ } } as DisplayViewExpectedSignal;
    const store = createDisplayViewSiteStore(signal);
    expect([store.site(3, 4), store.site(3, 4), store.site(70, 1), store.site(3, 4)]).toEqual([3.5, 3.5, 70.125, 3.5]);
    expect(reads).toBe(2);
    expect([store.lookups, store.cachesSites, store.marksReads, store.tracksMaterial, store.uniformMaterial]).toEqual([7, true, false, false, -1]);
    tracked = true;
    expect(store.site(3, 4)).toBe(3.5);
    expect([reads, store.uniformMaterial]).toEqual([3, 3]);
    expect(store.site(3, 4)).toBe(3.5);
    expect([reads, store.uniformMaterial]).toEqual([3, 3]);
  });
});
