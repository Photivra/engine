// SPDX-License-Identifier: Apache-2.0
/**
 * #731 (owner decision 2026-11-21: fast and exact requests): a capture's tabulated RAW path with kernels (diffraction, a small defocus
 * disc) on a chart or material scene takes the display view's per-tap sum of the pre-integrated spectral radiance (#643, #653): one
 * set of (2R + 1)² taps per site instead of one per lattice group (N² groups for an N × N box pixel aperture). The same sum regrouped:
 * the expected electrons agree with the per-material sums to rounding (measured below), and the run-time check against the chain
 * stays at 1e-9.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { createDisplayViewExpectedSignal } from "../src/facade/expected-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const request = (n: number, fast?: boolean): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" }, lens: { fNumber: 8, diffraction: "circular-aperture" },
  sensor: { pixelPitchMicrometers: 1.4, pixelAperture: { kind: "box", samplesPerAxis: n } },
  output: { width: 4000, height: 3000, region: { x: 1984, y: 1488, width: 32, height: 24 } }, ...(fast === undefined ? {} : { fast }) });
const expectedSignal = (r: { assumptions: readonly { id: string; value: unknown }[] }): Record<string, unknown> =>
  r.assumptions.find((a) => a.id === "raw.expectedSignal")!.value as Record<string, unknown>;

describe("capture: the per-tap sum with kernels on fast and exact requests (#731)", () => {
  it("reports the per-tap sum on both flags, and the fast and exact captures of one explicit box agree", async () => {
    const fast = await simulateCapture(request(4, true)), exact = await simulateCapture(request(4, false));
    for (const r of [fast, exact]) expect(expectedSignal(r)).toMatchObject({ method: "per-site-integrated-electrons", sum: "per-tap", tolerance: 1e-9 });
    expect(Buffer.from(fast.image.samples).equals(Buffer.from(exact.image.samples))).toBe(true);
    // Without kernels there is no tap sum to regroup.
    const plain = await simulateCapture({ ...request(1), lens: { fNumber: 8 } });
    expect(expectedSignal(plain).sum).toBeUndefined();
  }, scaledTimeout(300_000));

  it("agrees with the per-material sums to rounding: within 1e-13 relative over every site of the region (measured: 1.5e-14 at most)", async () => {
    const { signalInput } = await simulateDisplayViewWithInternals({ ...request(4), output: { width: 4000, height: 3000 } }, { width: 4000, height: 3000, region: { x: 1984, y: 1488, width: 32, height: 24 } });
    const perTap = createDisplayViewExpectedSignal({ ...signalInput, perTapSum: true }), sums = createDisplayViewExpectedSignal({ ...signalInput, perTapSum: false });
    perTap.window(1984, 1488, 2016, 1512); sums.window(1984, 1488, 2016, 1512);
    let worst = 0;
    for (let y = 1488; y < 1512; y++) for (let x = 1984; x < 2016; x++) { const a = perTap.site(x, y), b = sums.site(x, y); worst = Math.max(worst, Math.abs(a - b) / b); }
    expect(worst).toBeLessThan(1e-13);
  }, scaledTimeout(300_000));
});
