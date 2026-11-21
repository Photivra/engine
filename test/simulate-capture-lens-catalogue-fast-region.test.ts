// SPDX-License-Identifier: Apache-2.0
/**
 * #733: a fast catalogue-lens region takes the whole frame's method. The run-time check of the fast method (#568) reads sites fixed
 * by the whole frame (its top-left 2 × 2 block and the block at its centre), not the region's own top-left block, so a region equals
 * the same pixels of the whole render and reports the same `applied`. Before the fix the first region below started on the Siemens
 * star's fine detail, failed the check there and rendered with the exact method (392 of 4,608 samples differed, by up to 421 codes).
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const W = 480, H = 320;
const base: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, lens: { catalogue: "pv-50-1.8", fNumber: 1.8 }, fast: true,
  output: { width: W, height: H, format: "srgb-16" } };
const regionOf = (region: { x: number; y: number; width: number; height: number }): SimulateCaptureOptions => ({ ...base, output: { ...base.output!, region } });
const differing = (whole: SimulateCaptureResult, part: SimulateCaptureResult, r: { x: number; y: number; width: number; height: number }): number => {
  let n = 0;
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width * 3; x++) if (whole.image.samples[((r.y + y) * W + r.x) * 3 + x] !== part.image.samples[y * r.width * 3 + x]) n++;
  return n;
};
const applied = (r: SimulateCaptureResult): boolean | undefined => r.diagnostics.fast.applied["lens.catalogue"];
const expectedSignal = (r: SimulateCaptureResult): Record<string, unknown> => r.assumptions.find((a) => a.id === "raw.expectedSignal")!.value as Record<string, unknown>;

describe("lens.catalogue fast method: the check is fixed by the frame (#733)", () => {
  it("regions on fine detail, at the corner and around the centre equal the same pixels of the whole frame and report the same method", async () => {
    const whole = await simulateCapture(base);
    expect(applied(whole)).toBe(true);
    // The ticket's regions (the first two failed the check at their own top-left block), the frame corner, and a 3 × 2 set of parts
    // around the centre whose joins are the whole frame's.
    const regions = [{ x: 216, y: 144, width: 48, height: 32 }, { x: 238, y: 158, width: 4, height: 4 }, { x: 0, y: 0, width: 48, height: 32 },
      ...[0, 1, 2].flatMap((i) => [0, 1].map((j) => ({ x: 192 + 32 * i, y: 128 + 32 * j, width: 32, height: 32 })))];
    for (const region of regions) {
      const part = await simulateCapture(regionOf(region));
      expect(applied(part), JSON.stringify(region)).toBe(true);
      expect(differing(whole, part, region), JSON.stringify(region)).toBe(0);
      expect(expectedSignal(part).verificationRelativeDifference, JSON.stringify(region)).toBe(expectedSignal(whole).verificationRelativeDifference);
    }
    expect(expectedSignal(whole)).toMatchObject({ method: "per-site-integrated-electrons-catalogue-psf-field-grid", verificationSites: 8 });
  }, scaledTimeout(120_000));
});
