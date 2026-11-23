// SPDX-License-Identifier: Apache-2.0
/**
 * #685 steps 2–3, the fast method `lens.catalogue/view-offset-expansion` (display-view-lens-signal.ts, `offsetExpansion`): with more
 * than one query offset (the box pixel aperture, the four-spot filter), each offset's plane point and field factor come from a
 * second-order expansion about its nearest site centre instead of one lens mapping per offset, and a lattice point whose offsets all
 * read one material takes (Σ_o w_o·F_o)·L_m. Go/no-go (the uniform-window method's own): every site within 1e-6 relative of the full
 * method (each offset through the lens).
 * #755: one of six files with the checks of the single 2.28.0 file (test/helpers/display-view-lens-offset-expansion.ts holds the
 * shared check), so that the coverage shards can spread them.
 * This part: every catalogue lens wide open and at its narrowest f-number, part 1 of 4 (offsetExpansionLenses).
 */
import { describe, expect, it } from "vitest";
import { BOUND, everyLensCheck, offsetExpansionLenses } from "./helpers/display-view-lens-offset-expansion.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("catalogue-lens display view: the offsets' lens mapping to second order (#685), lenses part 1 of 4", () => {
  it("keeps every site within 1e-6 of the full method on each lens of part 1, wide open and at its narrowest, with the 2 × 2 box", async () => {
    const largest = await everyLensCheck(offsetExpansionLenses(1), (value, label) => expect(value, label).toBeLessThan(BOUND));
    if (process.env.EXPANSION_REPORT) (await import("node:fs")).writeFileSync(process.env.EXPANSION_REPORT + ".1", String(largest));
    // The expansion is an approximation: it ran (it differs somewhere), within its bound.
    expect(largest).toBeGreaterThan(0);
  }, scaledTimeout(300_000));
});
