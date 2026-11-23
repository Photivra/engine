// SPDX-License-Identifier: Apache-2.0
/**
 * The layered edge sum by runs (#749, #750) through a lens map (#744): where a point's rows do not hold (curved card edges,
 * `rowsHold` false) the run sum takes `share` per tap and so equals the direct sum bit for bit; where they hold, runs over the
 * half-planes' rows equal the direct sum within 1e-9 relative. Part 3 of 3: the large blur behind a far card's edge, rows 6, 18, … (part 2 has the rows 0, 12, …; together every sixth row, as before). The cases and the check are in
 * test/helpers/layered-edge-runs-lens.ts (one file split for the per-file coverage budget; the cases, rows and bounds are unchanged).
 */
import { it } from "vitest";
import { EDGE_RUNS_LENS_CASES, checkEdgeRunsLens } from "./helpers/layered-edge-runs-lens.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const c = EDGE_RUNS_LENS_CASES[2]!;
it(c.name + ", rows 6 + 12k" + ": runs equal the direct sum (share per tap where rows do not hold)", () => checkEdgeRunsLens(c, 6, 12), scaledTimeout(300_000));
