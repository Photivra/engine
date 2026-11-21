// SPDX-License-Identifier: Apache-2.0
/**
 * #392: the per-real-pixel memo replays a sample's recorded terms when another sample of the same display pixel lands on the
 * same real pixel. Views barely smaller than the frame put most of a display pixel's samples on a few real pixels. Their
 * hashes were recorded before the memo on 2.6.0 (abb8b27), where the memo changed no byte; since #393 these views take the
 * exact area mean (each footprint at most 25 real pixels), and the hashes were re-recorded with that deliberate reference change.
 * The AHD case was re-recorded for #457 (AHD's choice on the noise-free mosaic): its expected values moved by up to 11.3 8-bit
 * codes, toward the capture (1.51 → 0.61 codes RMS against 16 reference captures). Recorded on Linux x64 (CI; #508).
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";
import { displayViewDigests } from "./helpers/display-view-digests.js";

// #508: the hashes were recorded on x64 and hold there. The diffraction case takes Math.sin, Math.cos and others from the
// capture's diffraction kernels, whose results differ by one ulp between V8 on arm64 and on x64, so on arm64 (Apple silicon,
// Linux arm64) it is locked to its own arm64 hash, keyed by the x64 lock (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks
// and platforms"). The Speed case is the same on both. Re-recorded for 2.21.0 (signals integrated from the material spectrum per
// site): samples unchanged; expected values within 1.8·10⁻¹⁴ and noise standard deviations within 4.6·10⁻¹⁴ relative. Re-recorded for
// 2.26.0 (#643, the per-tap chart signal, x64 Node 24.1.0 under Rosetta 2 and arm64): samples unchanged; expected values within
// 1.5·10⁻¹⁴ and noise standard deviations within 3.6·10⁻¹⁵ relative of 2.25.0.
// Re-recorded for 2.27.0 (#653, the per-tap chart signal read from the pre-integrated spectral radiance; x64 Node 24.1.0 under
// Rosetta 2 and arm64): samples unchanged; expected values within 1.4·10⁻¹⁴ and noise standard deviations within 3.5·10⁻¹⁵
// relative of 2.26.0.
// 2.28.0 (#697): each case also locks `samples` (the image bytes only) and `internals` (expected values, noise standard deviations,
// diagnostics), recorded at main (99782e7, 2.27.0's results) on x64 (Node 24.1.0 under Rosetta 2) and arm64. A change that claims
// "samples unchanged" leaves the `samples` locks as they are. `combined` is the lock above; it is kept for 2.28.0 only.
// Record all three with RECORD_DISPLAY_VIEW_HASHES=1 (prints them; asserts nothing).
interface Lock { combined: string; samples: string; internals: string }
const ARM64_PIXEL_MEMO_HASHES: Readonly<Record<string, string>> = {
  // #697: the internals locks whose bytes differ on arm64 (the samples locks are the same on both).
  "b74ec7e74686ba94443b003034ef02b616c0a60870e3ca0dbf1f2fa3657a4e60": "7c56d42b09539e40509bffd04c3d5657ed5e4c1ea142ad9065e00d7a158fe13f",
  "079004b53b8cf2521b0207a3c74f555cd39d49363f755698d1618a1cdc4c8470": "4609390df12291c129be1edf470894fb2d0cf2aebf876870256b5b703f36a472"
};

describe("display view per-real-pixel memo (#392)", () => {
  it("keeps the bytes of views where samples share real pixels", async () => {
    const cases: [SimulateCaptureOptions, SimulateDisplayViewOptions, Lock][] = [
      // Speed (direct sites), 1.2 × 1.2 real pixels per display pixel.
      [{ scene: { preset: "dead-leaves" }, sensor: { pixelPitchMicrometers: 2 }, output: { width: 60, height: 40 } }, { width: 50, height: 33 }, { combined: "0cc1cf1ec466fbdf8bfee6822a151a75892f2f17e8b614da3a8a21eb981d55cd", samples: "3fb428007f59f143b175a161b359f0e03ecc775fbd3e386c1197415daf926886", internals: "865621939c2de3de2d429628ceb3c710ee93cc3506f7784b0d871354b56dc701" }],
      // Chart materials with diffraction (the filled path and the site ring) and the 2 × 2 box, with AHD.
      [{ scene: { preset: "siemens-star" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { pixelPitchMicrometers: 3, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
        output: { width: 60, height: 40, demosaic: "ahd" } }, { width: 50, height: 33 }, { combined: "b74ec7e74686ba94443b003034ef02b616c0a60870e3ca0dbf1f2fa3657a4e60", samples: "0f4de02d7a22895b6ea3cb9880aaf6821573f6bac6586b9d986a9b46db2069ac", internals: "079004b53b8cf2521b0207a3c74f555cd39d49363f755698d1618a1cdc4c8470" }]
    ];
    const recorded: unknown[] = [];
    for (const [k, [options, view, lock]] of cases.entries()) {
      const { result, internals } = await simulateDisplayViewWithInternals(options, view);
      const diagnostics: Partial<typeof result.diagnostics> = { ...result.diagnostics };
      delete diagnostics.timingsMs;
      // #395: diagnostics.fast is additive; it is checked on its own and left out of the recorded digests.
      // 2.20.0: the view's AHD low-signal correction is its fast method (the view's default), so AHD views report the approximation.
      // 2.28.0 (#732): the diffraction window is a fast method too (the view's default).
      expect(diagnostics.fast?.assurance).toBe(Object.values(diagnostics.fast?.applied ?? {}).includes(true) ? "approximation-with-a-priori-bound" : "engine-reference");
      delete diagnostics.fast;
      // #533: diagnostics.highlight is additive too (it changes no sample); it is checked on its own and left out of the digests.
      expect(diagnostics.highlight).toEqual({ saturatedPixelCount: internals.saturatedPixelCount, statistic: "expected-value" });
      delete diagnostics.highlight;
      const got = displayViewDigests(result.image.samples, [internals.expected, internals.noiseStd], JSON.stringify(diagnostics));
      if (process.env.RECORD_DISPLAY_VIEW_HASHES === "1") { recorded.push([k + 1, got]); continue; }
      for (const key of ["samples", "internals", "combined"] as const)
        expect(got[key], `case ${k + 1} ${key}`).toBe(hashLockOnThisArchitecture(lock[key], ARM64_PIXEL_MEMO_HASHES));
    }
    if (recorded.length > 0) console.log(JSON.stringify({ arch: process.arch, node: process.version, recorded }));
  }, testTimeout(120_000));
});
