// SPDX-License-Identifier: Apache-2.0
/**
 * #767: the display view with camera motion or a moving subject, `lens.diffraction`, the four-spot filter and a 2 × 2 box. The view's
 * lens signal (display-view-lens-signal.ts) already sums each site's kernel taps on the site lattice; it was refused by the capture's
 * per-tap count. Since #767 the capture's lattice flag (#761) also holds for a view, so the view counts its queries as the capture does,
 * without the taps, and reports `execution: "image-space-convolution"` where the taps pass 100000.
 *
 * Part 2 of 3 (against the box-downsized capture). Split from one file for the per-file coverage budget (2.29.0); the
 * requests are in test/helpers/display-view-motion-diffraction-cases.ts, and the cases and bounds are unchanged.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { request, subject, yaw } from "./helpers/display-view-motion-diffraction-cases.js";

describe("the display view with motion, lens.diffraction and the anti-aliasing filter (#767)", () => {
  it("matches the box-downsized capture: camera yaw and a moving subject at 1/60 s", async () => {
    const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    for (const motion of [yaw, subject]) {
      const options = request({ motion, pitch: 3, shutterSeconds: 1 / 60, width: 96, height: 64, fast: false });
      const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
      const { internals } = await simulateDisplayViewWithInternals(options, { width: 12, height: 8, samplesPerAxis: 16 });
      let sq = 0, max = 0;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) {
        let reference = 0;
        for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode(capture.image.samples[(y * 96 + x) * 3 + k]!) / 64;
        const difference = encode8(internals.expected[(j * 12 + i) * 3 + k]!) - encode8(reference);
        sq += difference * difference; max = Math.max(max, Math.abs(difference));
      }
      // The thresholds of test/display-view-lens.test.ts ("matches the box-downsized capture"); the reference keeps its own noise.
      expect(Math.sqrt(sq / (8 * 12 * 3))).toBeLessThan(0.6);
      expect(max).toBeLessThan(3);
    }
  }, scaledTimeout(120_000));
});
