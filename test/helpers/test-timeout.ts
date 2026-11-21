// SPDX-License-Identifier: Apache-2.0

/**
 * Scales an explicit per-test timeout by the factor vitest.config.ts sets: 4 for coverage runs
 * (V8 instrumentation slows heavy numerical fixtures roughly 3-4x), 3 for other runs on CI
 * (shared hosted runners, #668) and 1 for local runs, which keep their original deadline.
 */
export function scaledTimeout(milliseconds: number): number {
  const scale = Number(process.env.PHOTIVRA_TEST_TIMEOUT_SCALE ?? "1");
  return milliseconds * (Number.isFinite(scale) && scale >= 1 ? scale : 1);
}
