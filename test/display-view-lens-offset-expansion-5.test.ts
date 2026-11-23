// SPDX-License-Identifier: Apache-2.0
/**
 * #685 steps 2–3, the fast method `lens.catalogue/view-offset-expansion` (display-view-lens-signal.ts, `offsetExpansion`): with more
 * than one query offset (the box pixel aperture, the four-spot filter), each offset's plane point and field factor come from a
 * second-order expansion about its nearest site centre instead of one lens mapping per offset, and a lattice point whose offsets all
 * read one material takes (Σ_o w_o·F_o)·L_m. Go/no-go (the uniform-window method's own): every site within 1e-6 relative of the full
 * method (each offset through the lens).
 * #755: one of six files with the checks of the single 2.28.0 file (test/helpers/display-view-lens-offset-expansion.ts holds the
 * shared check), so that the coverage shards can spread them.
 * This part: the box with the four-spot filter, and a rotating camera under a rolling shutter.
 */
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions } from "../src/index.js";
import { BOUND, BOX, check, request } from "./helpers/display-view-lens-offset-expansion.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("catalogue-lens display view: the offsets' lens mapping to second order (#685), the filter and motion", () => {
  it("keeps the box with the four-spot filter, and a rotating camera under a rolling shutter, within the bound", async () => {
    for (const options of [request("pv-16-2.8", 2.8, { ...BOX, antiAliasing: { kind: "four-spot" } }), request("pv-24-1.4-pro", 1.4, { ...BOX, antiAliasing: { kind: "four-spot" } }),
      { ...request("pv-24-1.8", 2.8, { ...BOX, temporalSampleCount: 2 }), output: { width: 120, height: 80 }, motion: { angularVelocityRadPerSec: { yaw: 0.5, roll: 3 }, shutter: "rolling", rollingShutterSkewSeconds: 0.004 } }] as SimulateCaptureOptions[]) {
      expect((await check(options, 7)).largest, JSON.stringify(options.lens) + JSON.stringify(options.motion ?? {})).toBeLessThan(BOUND);
    }
  }, scaledTimeout(300_000));
});
