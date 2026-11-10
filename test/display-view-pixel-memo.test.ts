// SPDX-License-Identifier: Apache-2.0
/**
 * #392: the per-real-pixel memo replays a sample's recorded terms when another sample of the same display pixel lands on the
 * same real pixel. Views barely smaller than the frame put most of a display pixel's samples on a few real pixels. Their
 * hashes were recorded before the memo on 2.6.0 (abb8b27), where the memo changed no byte; since #393 these views take the
 * exact area mean (each footprint at most 25 real pixels), and the hashes were re-recorded with that deliberate reference change.
 * The AHD case was re-recorded for #457 (AHD's choice on the noise-free mosaic): its expected values moved by up to 11.3 8-bit
 * codes, toward the capture (1.51 → 0.61 codes RMS against 16 reference captures). Recorded on Linux x64 (CI; #508).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";

// #508: the hashes were recorded on x64 and hold there. The diffraction case takes Math.sin, Math.cos and others from the
// capture's diffraction kernels, whose results differ by one ulp between V8 on arm64 and on x64, so on arm64 (Apple silicon,
// Linux arm64) it is locked to its own arm64 hash, keyed by the x64 lock (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks
// and platforms"). The Speed case is the same on both. Re-recorded for 2.21.0 (signals integrated from the material spectrum per
// site): samples unchanged; expected values within 1.8·10⁻¹⁴ and noise standard deviations within 4.6·10⁻¹⁴ relative.
const ARM64_PIXEL_MEMO_HASHES: Readonly<Record<string, string>> = {
  "6f77a4d5eec371f42886ae84599d6c21cc0835b1d704379427bde2c355055dec": "bf25121859432a36f58d6162c8c6454d8b6b13b75257e6f9d663d885435c0f9a"
};

describe("display view per-real-pixel memo (#392)", () => {
  it("keeps the bytes of views where samples share real pixels", async () => {
    const cases: [SimulateCaptureOptions, SimulateDisplayViewOptions, string][] = [
      // Speed (direct sites), 1.2 × 1.2 real pixels per display pixel.
      [{ scene: { preset: "dead-leaves" }, sensor: { pixelPitchMicrometers: 2 }, output: { width: 60, height: 40 } }, { width: 50, height: 33 }, "0cc1cf1ec466fbdf8bfee6822a151a75892f2f17e8b614da3a8a21eb981d55cd"],
      // Chart materials with diffraction (the filled path and the site ring) and the 2 × 2 box, with AHD.
      [{ scene: { preset: "siemens-star" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { pixelPitchMicrometers: 3, pixelAperture: { kind: "box", samplesPerAxis: 2 } },
        output: { width: 60, height: 40, demosaic: "ahd" } }, { width: 50, height: 33 }, "6f77a4d5eec371f42886ae84599d6c21cc0835b1d704379427bde2c355055dec"]
    ];
    for (const [options, view, expected] of cases) {
      const { result, internals } = await simulateDisplayViewWithInternals(options, view);
      const diagnostics: Partial<typeof result.diagnostics> = { ...result.diagnostics }, hash = createHash("sha256");
      delete diagnostics.timingsMs;
      // #395: diagnostics.fast is additive; it is checked on its own and left out of the recorded digests.
      expect(diagnostics.fast?.assurance).toBe("engine-reference");
      delete diagnostics.fast;
      // #533: diagnostics.highlight is additive too (it changes no sample); it is checked on its own and left out of the digests.
      expect(diagnostics.highlight).toEqual({ saturatedPixelCount: internals.saturatedPixelCount, statistic: "expected-value" });
      delete diagnostics.highlight;
      for (const a of [result.image.samples, internals.expected, internals.noiseStd]) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      hash.update(JSON.stringify(diagnostics));
      expect(hash.digest("hex")).toBe(hashLockOnThisArchitecture(expected, ARM64_PIXEL_MEMO_HASHES));
    }
  }, testTimeout(120_000));
});
