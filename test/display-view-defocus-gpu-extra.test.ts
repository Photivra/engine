// SPDX-License-Identifier: Apache-2.0
/**
 * #492: the extra defocus cases of test/display-view-defocus-gpu.test.ts (a composite under the label layer, the Siemens star, the
 * disc at its cap and the combined kernels near the cap) on the float32 emulation against the CPU reference, in a file of their own
 * since 2.22.0 so that the coverage shards balance. The checks are the same (test/helpers/display-view-defocus-gpu-check.ts).
 */
import { describe, expect, it } from "vitest";
import { DEFOCUS_GPU_EXTRA } from "./helpers/display-view-defocus-gpu-fixtures.js";
import { checkDefocusGpuCase as checkCase } from "./helpers/display-view-defocus-gpu-check.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const report: Record<string, unknown>[] = [];

describe("#492: defocus in the GPU display view (float32 emulation) vs the CPU reference: extra cases", () => {
  it.each(DEFOCUS_GPU_EXTRA.map((c) => [c.name, c] as const))("%s: inside the a-priori bounds; samples within one code; the #480 thresholds met", async (_name, c) => {
    const row = await checkCase(c);
    // The composite's label glyphs and 1024-level elements and the star's diagonals put lattice points exactly on boundaries.
    if (!/cap, 1\.4 µm f\/|disc at its cap/u.test(c.name)) expect(row.latticePointsResolved).toBeGreaterThan(0);
    report.push(row);
  }, scaledTimeout(1_800_000));

  it("reports the measured agreement", () => {
    process.stdout.write("[display-view defocus gpu emulation, extra cases] " + JSON.stringify(report, null, 1) + "\n");
  });
});
