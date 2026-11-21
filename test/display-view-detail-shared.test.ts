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
// 2.28.0 (#674, the catalogue PSF's exact cell integration): every case re-recorded on x64 (Node 24.1.0 under Rosetta 2) and arm64,
// the same on both: the internals of all 17 and the samples of the 12 at 2 and 1 real pixels per display pixel moved (the 8x cases'
// samples hold).
/** [case, x64 locks]; the arm64 hash of a lock whose bytes differ there is in ARM64_HASHES (none: every case is the same on both). */
const LOCKS: readonly [string, Readonly<DisplayViewDigests>][] = [
  ["plain-8x", { combined: "413a16a15156db080b7272c67795fbcd581f439a0c55871c77347254d0293abe", samples: "afa824be89d4ebd5fa9bc84e6c541cee421a97935b02c7557d99128dee2b6d57", internals: "aa2800c4386346a93125580f47748f9239fd872ee6d59f6542aeece73d9267ee" }],
  ["plain-2x", { combined: "8480616483ec096c10aba25fd023c4c79820841b777fd0ecdcc98efb2fd68bb8", samples: "8fd4043fece064c999cdada7c489ccf72f24d8ceab922b93303b66625d5d9fac", internals: "8a40f67ea1802ebf8249b428bab1a2cd829350be35d939271cd5d7629bec6e7d" }],
  ["plain-1x", { combined: "d967d372cd548a9f12456721985be2a00d5381735798170df18de01ec55425f7", samples: "fa27a4ee64e296770815cb0fdb3170db7fab261469fcb46ccab1678137df52fb", internals: "c037bfb1dcd7ff78309339e5ee97dfea82136716721e49ec84945e8c1fe31801" }],
  ["corrections-8x", { combined: "8d04391e77f6688ae70d54c914e33cb15efa569f212a3474eebefffe6e188c23", samples: "b0a7eeb0a3dee2e6668fe10f59903ed2dd2b4a16b2e2273feeba0466e3364458", internals: "724a7285b6df943e2d1eaac9fab7cd31b9d3701be2ee202a163d8eb6185845e7" }],
  ["corrections-2x", { combined: "936b370b1b54b3d967f9cb0750b79ca271db9a072d671d91db512c3e87daf090", samples: "4867c46d91adeca6882ec7625a0869a6df6869e8df1b30038ebfd2fd3e1ad76d", internals: "181d9dd07d86486cf3e9ca252f73a84f274ac3bcc0fa408dbea039fc2c41e9ba" }],
  ["corrections-1x", { combined: "69972dba80f2cde56d965e975f5eb85a512b6130dae2b3919a47518694ccdec2", samples: "7428ebf5d92c107244aa7bc1a8c2ac6d27e4f9c94fe616a0b3cca9b94a76c638", internals: "c92e94315529aeb24697ed4f8456feff924edf1777c426170ec3041ab5292fd9" }],
  ["sharpening-8x", { combined: "926ff47965c70a6649b536404d9ab01ddc2e92301f4254a7db37466e6d1a5d91", samples: "0d2d608643e9981ca6a91cb9601a3511cc8bdd122e1d81f07a308b7f8948e13c", internals: "28531c28487a99c45eceb8d961ff2ff92f096a0c291e44aa3149163739a958dd" }],
  ["sharpening-2x", { combined: "474318a8c1e0b91f86cb5399e52e2073d4bdea08eb40e5849df1b0382c7245ea", samples: "68513f3dad6688e88b3bdd504e6161ffa5d4e23035a86382b1be98c75e025d14", internals: "178d660d26095121860784541165d942d1d501315b107ef1a33e4dcc42b61335" }],
  ["sharpening-1x", { combined: "c56d2124dc896cb79f6fc78ab0f570f09c8a5bf0b9084074219b8968147d8fff", samples: "b3a290bd6a4ecb9d799c5e7388adfc44459f0a9edbc5e0dc08e8ee4e1a592e14", internals: "038ef1a7b32edbc3a5a29c8a3516c43675a7bc9b8c24d89e8a73659d4e019d2d" }],
  ["both-8x", { combined: "823e32c2605258ff5f7b3ccb6710a2b0e87ed59e1ce026e5d9c18f2170c6cd1c", samples: "aba11a1d2911e2a002615825b574e5a46a117d56c00f11154fd4218545d66b8e", internals: "47f63ed31de8415121814bae1d937d25a5fc9831e018a2e8fd1fe4eca6512b07" }],
  ["both-2x", { combined: "be093293694b379dd9db2d08223ad2e38a1b8c05c743c799385522be5f22e76d", samples: "58bfc575fcc506fa8d6124f34430059306d4fb769e1a4c432557bfbeb4324610", internals: "2da9ae9e288c95e5d306ee4d10ce5302ff33ee5ee1e5908f6c994221c638e6c1" }],
  ["both-1x", { combined: "ec0863d6c3010e14b4c9f4561db73b1b965960f92cd04ffa570bc807d9dc2212", samples: "e391ac96045f6b0edf798c6e3e4eb81cb9e0b14c9fab6eed52e8049fec1edb9c", internals: "368fca9a5dd8180238171696da32dd5ffa8a309139924eb3753f1466d06fb941" }],
  ["corrections-exact-8x", { combined: "e038694b9605c664f0c5c82c6ee267114ff5abf80d93a5f648676d022dcaa04e", samples: "3b40b1ef247ed250996cc41cd1743f574fb8e1dbf1aa6bcda89c283fea049036", internals: "97e5fa5286ca231ee6f524fe2b5a013769096d58290f5211a759ca59f14eb416" }],
  ["both-exact-2x", { combined: "1cefdd28541987846641a920a7dcc22faabf0dc289f2f33bcce28158a529ba59", samples: "a376a67546ba1a2a04ffd926b0991a0ceb6ade58a26ad61da90474d38c957275", internals: "8baa161013a4421ba27d6788729ede1054617ccfc0dc8773871571f07d0cb45f" }],
  ["both-ahd-2x", { combined: "ea4d0c069a94edbe84f648b04aa297f6d1b041ca5fe22934c97cc37cd9a4966e", samples: "4a1635daceee863ebb786cce30faea7415aa37c92ca9797561202f9749f279be", internals: "2538b4cad2c57da49a1f8866e5975cd8dd22ae6259db768c4656e1cd0394899a" }],
  ["both-region-2x", { combined: "1590494f94bc5bd9adfa3e47b5a46a43f198d7ff63b02ceee5a85118e5127dfd", samples: "fd710a095fdc876395c790ea34096998ce5b1d3787df71afd61bd0e5b0b80dee", internals: "1b02a324dc9502db4f2ededf4acda5fdf0e566596965d66bdf0a169b8a124e2e" }],
  ["neighbors-2x", { combined: "186850740c1eb8c49cd46677c52a9fc1ce4935b040a328dc7778b073af18b49b", samples: "f58d46509d9fd8805a1b4dee9d840dc39266ca6f69eb3c9a6e8109f9b0137984", internals: "42fba5e41af8aba95452c50b5c7647bedaa4fde75ecb0a3746b9a73d746fa0b4" }],
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
