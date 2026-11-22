// SPDX-License-Identifier: Apache-2.0
/*
 * Test files left out of coverage runs only (owner decision 2026-11-21). Every file here still
 * runs, with its full workload and assertions, in the plain test jobs and in local runs.
 *
 * - display-view-lens-offset-expansion.test.ts (#685) checks every catalogue lens against the full
 *   method. Under V8 coverage it took about 13 minutes alone on a fast local machine; the hosted
 *   runners are about 2.8 times slower, which is past a coverage shard's 20-minute job limit.
 *   The code it exercises is also reached by other display-view lens tests (box aperture on a
 *   catalogue lens). #755 tracks making it fast enough to return.
 *
 * test/coverage-excluded-tests.test.ts keeps this list to the files named here.
 */
export const coverageExcludedTests: readonly string[] = ["test/display-view-lens-offset-expansion.test.ts"];
