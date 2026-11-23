// SPDX-License-Identifier: Apache-2.0
/**
 * The layered edge sum by runs (#749, #750) through a lens map (#744): where a point's rows do not hold (curved card edges,
 * `rowsHold` false) the run sum takes `share` per tap and so equals the direct sum bit for bit; where they hold, runs over the
 * half-planes' rows equal the direct sum within 1e-9 relative. Part 1 of 3: the barrel distortion and the fisheye (every second row). The cases and the check are in
 * test/helpers/layered-edge-runs-lens.ts (one file split for the per-file coverage budget; the cases, rows and bounds are unchanged).
 */
import { it } from "vitest";
import { EDGE_RUNS_LENS_CASES, checkEdgeRunsLens } from "./helpers/layered-edge-runs-lens.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

for (const c of EDGE_RUNS_LENS_CASES.slice(0, 2)) it(c.name + ": runs equal the direct sum (share per tap where rows do not hold)", () => checkEdgeRunsLens(c, 0, 2), scaledTimeout(300_000));
