// SPDX-License-Identifier: Apache-2.0
/**
 * #655 step 6, go/no-go, part 2 of 2 (split for #693, 2.28.0): the uniform-window method against the full method, per site, on every
 * catalogue lens that is neither professional nor a phone (part 1, with the rest of #655's checks:
 * test/display-view-lens-catalogue-regrouped-1.test.ts). The two parts run in different coverage shards so that neither sets its
 * shard's run time; each asserts the bound and the uniform share on its own lenses, which implies the single test's assertions.
 */
import { describe, expect, it } from "vitest";
import { GENERIC_LENS_CATALOGUE } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { uniformWindowCheck, uniformWindowLenses } from "./helpers/display-view-lens-uniform-windows.js";

describe("catalogue-lens display view: the pre-integrated kernel pass (#655)", () => {
  it("uniform windows: every site within 1e-6 of the full method on every catalogue lens, widest and narrowest aperture (part 2 of 2: the other sets)", async () => {
    const lenses = uniformWindowLenses(2);
    expect(lenses.length).toBeGreaterThan(0);
    // The two parts cover every catalogue lens but the phones, each once.
    expect([...uniformWindowLenses(1), ...lenses].map((lens) => lens.lensId).sort())
      .toEqual(GENERIC_LENS_CATALOGUE.filter((lens) => lens.set !== "phone").map((lens) => lens.lensId).sort());
    const { largest, uniformSites, total } = await uniformWindowCheck(lenses);
    expect(uniformSites).toBeGreaterThan(0.2 * total);
    expect(largest).toBeLessThan(1e-6);
  }, scaledTimeout(900_000));
});
