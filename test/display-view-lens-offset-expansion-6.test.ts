// SPDX-License-Identifier: Apache-2.0
/**
 * #685 steps 2–3, the fast method `lens.catalogue/view-offset-expansion`: the default with more than one query offset, how it is
 * reported, where it is off, and regions with it on. #755: one of six files (test/display-view-lens-offset-expansion-1.test.ts to
 * -5.test.ts measure the method against the full method).
 */
import { describe, expect, it } from "vitest";
import { simulateDisplayView, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../src/index.js";
import { BOX, request } from "./helpers/display-view-lens-offset-expansion.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("catalogue-lens display view: the offsets' lens mapping to second order (#685), the flag and regions", () => {
  it("is the fast default with more than one offset, reported in view.lensPsf; off with fast: false, the point aperture or a fisheye", async () => {
    const view = { width: 48, height: 32 };
    const value = async (options: SimulateCaptureOptions, shown: SimulateDisplayViewOptions = view): Promise<unknown> =>
      ((await simulateDisplayView(options, shown)).assumptions.find((a) => a.id === "view.lensPsf")!.value as { offsetMapping: unknown }).offsetMapping;
    expect(await value(request("pv-50-1.8", 4, BOX))).toBe("second-order-expansion");
    // #755: with fast: false the view resolves the lens PSF at every site of the 3,000 × 2,000 frame (about 105 s locally without
    // coverage, past a coverage shard's limit on CI with V8's counters). Coverage runs (PHOTIVRA_COVERAGE_RUN, vitest.config.ts) read
    // the same request's report from a 4 × 4 region of the view, which runs the same code on fewer sites; every other run renders the
    // whole view.
    const exactView = process.env.PHOTIVRA_COVERAGE_RUN === "1" ? { ...view, region: { x: 22, y: 14, width: 4, height: 4 } } : view;
    expect(await value({ ...request("pv-50-1.8", 4, BOX), fast: false }, exactView)).toBeNull();
    expect(await value(request("pv-50-1.8", 4, {}))).toBeNull();
    expect(await value(request("pv-8-3.5-fisheye-pro", 5.6, BOX))).toBeNull();
    // A region equals the same pixels of the whole view with the method on (a centre's coefficients depend only on its 3 × 3 centres).
    const options = request("pv-24-1.8", 1.8, BOX), whole = await simulateDisplayView(options, view), part = await simulateDisplayView(options, { ...view, region: { x: 9, y: 7, width: 20, height: 11 } });
    for (let y = 0; y < 11; y++) for (let x = 0; x < 60; x++) expect(part.image.samples[y * 60 + x], `${x}, ${y}`).toBe(whole.image.samples[(y + 7) * 144 + 27 + x]);
  }, scaledTimeout(300_000));
});
