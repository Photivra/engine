// SPDX-License-Identifier: Apache-2.0
/**
 * #649: the display view with lens corrections and sharpening renders its passes in bands of rows that share one per-call site store
 * and one per-call store of real pixels' recorded terms, skips the view-size passes that the sharpening discards and draws no noise
 * for the passes whose samples are not used. Every step forms the same values from the same operands, so #649 alone keeps the samples,
 * expected values and noise of 2.26.0. The hashes were first recorded on 2.26.0 (94f56f3) before the change; every case uses a
 * catalogue lens, which #655 (one kernel pass, uniform windows) moves by rounding, so they were re-recorded for 2.27.0 (see LOCKS
 * below: samples unchanged) and now lock 2.27.0's own results, on x64 and arm64 alike (#508), with the default bands and with bands
 * of a few rows. The scene-lookup, sample and site-evaluation counts are left out: they count the work done, which the change reduces.
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewCallStore, createDisplayViewSiteStore, displayViewDetailBand } from "../src/facade/display-view-detail.js";
import type { DisplayViewExpectedSignal } from "../src/facade/display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";
import { displayViewDigests, type DisplayViewDigests } from "./helpers/display-view-digests.js";

const W = 192, H = 128, all = { distortion: true, lateralColor: true, vignetting: true }, sharpening = { radiusPixels: 1, amount: 1 };
const request = (output: SimulateCaptureOptions["output"], fast = true): SimulateCaptureOptions => ({ scene: { preset: "slanted-edge", angleDegrees: 20 }, subjectDistanceM: 2,
  lens: { catalogue: "pv-24-1.8", fNumber: 1.8 }, fast, sensor: { pixelPitchMicrometers: 36000 / W, spectralStepNanometers: 40 }, output: { width: W, height: H, ...output },
  exposure: { mode: "manual", shutterSeconds: 1 / 2000, iso: 100 } });
/** 8, 2 and 1 real pixels per display pixel per axis. */
const views: Record<string, SimulateDisplayViewOptions> = { "8x": { width: 24, height: 16 }, "2x": { width: 96, height: 64 }, "1x": { width: W, height: H } };
const requests: Record<string, SimulateCaptureOptions["output"]> = { plain: {}, corrections: { lensCorrections: all }, sharpening: { sharpening }, both: { lensCorrections: all, sharpening } };

async function digest(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<DisplayViewDigests> {
  const { result, internals } = await simulateDisplayViewWithInternals(options, view);
  return displayViewDigests(result.image.samples, [internals.expected, internals.noiseStd, internals.saturated],
    JSON.stringify([internals.saturatedPixelCount, internals.detailPixelCount, internals.uniformPixelCount, internals.estimation, result.diagnostics.highlight]));
}

// Re-recorded for 2.27.0 on the integration branch (x64 Node 24.1.0 under Rosetta 2 and arm64, the same hashes): samples of all 17
// cases unchanged. The two exact cases (fast: false) differ from 2.26.0 by rounding (#655's one kernel pass, #653): site electrons
// within 6.6·10⁻¹⁶ and expected values within 2.3·10⁻¹⁵ relative. The fast cases also take #655's uniform-window fast method
// (lens.catalogue/view-uniform-window, new fast default): site electrons within 5.8·10⁻⁹, expected values within 6.1·10⁻⁹ relative.
// 2.28.0 (#697): each case also locks `samples` (the image bytes only) and `internals` (expected values, noise, the saturation flags
// and the counts), recorded at main (99782e7, 2.27.0's results) on x64 (Node 24.1.0 under Rosetta 2) and arm64. A change that claims
// "samples unchanged" leaves the `samples` locks as they are. `combined` is the lock recorded before; it is kept for 2.28.0 only.
/** [case, x64 locks]; the arm64 hash of a lock whose bytes differ there is in ARM64_HASHES (none: every case is the same on both). */
const LOCKS: readonly [string, Readonly<DisplayViewDigests>][] = [
  ["plain-8x", { combined: "49bfac9dbebe35cee05b192b73b05f2ee79f16b6213ae4da9500bf99b8ab8414", samples: "afa824be89d4ebd5fa9bc84e6c541cee421a97935b02c7557d99128dee2b6d57", internals: "6821ef1ccf0c782c99fe95bd8167cad76143d15fc0d94ddc822a0674fd5c6d7e" }],
  ["plain-2x", { combined: "c785724e99f7d2ad04ba32c7ddc10e2c9856faf4775e09e7fc510e70362053c3", samples: "573089e10c67edd3b76c1874c2dfb92fae4fd3fcdc4554e2cb6a955cf37203da", internals: "2fb35f1a1d9ce8464536bd12c6ff565db550ec049af47c454c1c2a0c8a761ec1" }],
  ["plain-1x", { combined: "477595a8ad9d346c7f156b167155940308332ef9b48f77181518fa026ad277cc", samples: "e81cdf931ac4279e31c5eacfb891d81cb578be6711208ffceebb6777f64533f1", internals: "c3ae03e081da2e9f0e4643580666ea89c2c4b1da65d6c057f1c4f2f109556f74" }],
  ["corrections-8x", { combined: "11a2f3f9cf150c08812ea07f71bcb6b9e7bbb7209d100b622f9dd5605d34adee", samples: "b0a7eeb0a3dee2e6668fe10f59903ed2dd2b4a16b2e2273feeba0466e3364458", internals: "db97bd927a5e6d7ddedc0be22c873a990f116919ee2db53c7a3377c3f25ad04e" }],
  ["corrections-2x", { combined: "0f637acc0bd2b6392efbee23e6a3e613abe6cb7c7f47168dff3884baf84b9ce9", samples: "baa235cc626715b162b5a656f0b1b45133564a586816880fcb8c5b0c4d59e2a9", internals: "499e3fce196befc801fdb0666667f64f7f98f6b327d95b88c3ab8bac2a3ef171" }],
  ["corrections-1x", { combined: "08f0c03d3f594b98f6f36ea38b81e9f2e44cf72d4bdc7c576c99be1a2405d50d", samples: "70a179534009238c4c6b1e2423cee4525b2b82e2f00b9a40a598e940c2259c2b", internals: "e17451540af8e38262336fc6e11ec36d3344f56a91f25a018676940e2651b9e6" }],
  ["sharpening-8x", { combined: "5cd2f0eeb0128f218513a3f098f681eab6099972888f7c84cc4fdb60f7d33060", samples: "0d2d608643e9981ca6a91cb9601a3511cc8bdd122e1d81f07a308b7f8948e13c", internals: "f9cb1b2595366d899a11377cc9c5eff12f6d7421bb8e2671f2e1e7c220554551" }],
  ["sharpening-2x", { combined: "5259e9f52e7d6b63b3b1d430a79f4cfe4628dfb161f06017c0312e670dea9b41", samples: "d995b6bad9c88a858ed602ae1b50977d7958c649042c296cd698a94027071122", internals: "a415871c6b747f161593b7a1e365d21556a98d5423e75589fadbbff724551883" }],
  ["sharpening-1x", { combined: "0c1704ede2a49a408ba48517d00c03c8ca80de4514474069e9bba3f795f84c7a", samples: "c349e92bbc2b0d8c935b97d14f033213925595250da9f3750ae81e96b5062f7e", internals: "fa4f7800041b3f3b68bb35b893e48d313af4869f4e85823d2a0214e1e4b27985" }],
  ["both-8x", { combined: "936904ee80576a6fa320a6da59d8456a8d668e4e30fd043dfa958605d7047f0b", samples: "aba11a1d2911e2a002615825b574e5a46a117d56c00f11154fd4218545d66b8e", internals: "1146b49f9b1c63176d09cfc5a263bc9ab0611567ae31ac707252c8ef0002d59f" }],
  ["both-2x", { combined: "25cb2ec15a96794cc713ef1d47af6383cdc19c3994097a67493bc8128b8ce7b6", samples: "2362440e41c7f9a8715c6f4066cacff6d79648521dcdfb4410c8156851a9219d", internals: "e541f02468aae49c39f508f77d74936766bfac148821733fa3aec07d3c38f699" }],
  ["both-1x", { combined: "82087e6fcffc097cc065c15d2a971a28e265673dd90fb7a831b4bb04ee122697", samples: "2a5cb4b0df934903a1a02e553d805b0219dedd254ee9e4ad3b6e880a8f765b80", internals: "c092244933402c5f058653c1027ef6d35d2a0e1ed35775ee2f97b9ef5e8df983" }],
  ["corrections-exact-8x", { combined: "eeaf125c60cc9a00ae125125d8aeab32e7c746e3fd878c56cc72c039f7ed209f", samples: "3b40b1ef247ed250996cc41cd1743f574fb8e1dbf1aa6bcda89c283fea049036", internals: "d0930e3a6ef59e00d37588437af2e4f96a3c8cec0062c2dcaf53cf6e759379cc" }],
  ["both-exact-2x", { combined: "22d652bd70c729c1972219a32d5cabd55f16c24dd104f1f3cecac5618109a3d0", samples: "529586d138b9b651d95a77bc581dfc02673bd6189ef4d44922d5bc400f6efd2a", internals: "1d58465e13c00e51dc292a1b99d93d9dffb032de660938c77502862064edc041" }],
  ["both-ahd-2x", { combined: "801b33fc0f3e4d88798a47532d1b7b1d497e3d0c6765b467cef67264e85e9e86", samples: "7c0fc5443b38b4ccd46aa48a82882e3da2b01b6bed69c64e766a26ea2a50afa6", internals: "769aaf156cceef9271cdbda6ac17c38fdf7b006136b9db23baf8d75292b29c82" }],
  ["both-region-2x", { combined: "324f73acd7ed6bdf37096ca1148ebc150dd49003842269a2bd27800ba1c1012a", samples: "58ebc14a59f1827a7925340d2fde6f513fec3b7d2df80a27ff346126d4c5fc11", internals: "95b8c5c442afbbd5c6cc77b6dc9abbd27fcaee629bd7588faee74f765a078476" }],
  ["neighbors-2x", { combined: "d52a978216597fc0a962437624d43c055dbcfa39d4af6f6d2d07daf01eb90fe2", samples: "65a65677704a491094e31a30dd02391ffe228e4af733b854f6f0b2187e302748", internals: "edfcdefc4dd5fdefb1e803e3147f89cce1a3d2258a1fb8f74f83dc9e790adcd0" }],
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
  it("keeps the recorded samples, expected values and noise", async () => {
    // Record all three digests of each case with RECORD_DETAIL_HASHES=1 (prints them; asserts nothing).
    if (process.env.RECORD_DETAIL_HASHES === "1") {
      for (const [name, c] of Object.entries(CASES)) console.log(JSON.stringify([process.arch, name, await digest(...c)]));
      return;
    }
    expect(LOCKS.map(([name]) => name).sort()).toEqual(Object.keys(CASES).sort());
    const pixels = displayViewDetailBand.pixels;
    try {
      // The default bands (one band for these views), then bands of a few rows (2,000 real pixels: 1 to 10 display rows).
      for (const band of [pixels, 2000]) {
        displayViewDetailBand.pixels = band;
        for (const [name, lock] of LOCKS) {
          const got = await digest(...CASES[name]!);
          for (const key of ["samples", "internals", "combined"] as const) expect(got[key], name + " " + band + " " + key).toBe(hashLockOnThisArchitecture(lock[key], ARM64_HASHES));
        }
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
