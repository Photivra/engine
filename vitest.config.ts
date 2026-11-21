import { configDefaults, defineConfig } from "vitest/config";
import WeightedShardSequencer from "./test/helpers/weighted-shard-sequencer.js";
// #536: the tests run the shader text the build ships (comments and indentation stripped); PHOTIVRA_WGSL_MINIFY=0 runs the source text.
import { wgslMinifyPlugin } from "./scripts/lib/wgsl-minify.mjs";

/*
 * V8 coverage instrumentation slows the heavy numerical fixtures by roughly 3-4x on a
 * 4-core host (measured: the 128-time-node visibility capture took 4.5-5.3 s alone and
 * 16-21 s under coverage). Coverage runs therefore scale every timeout by the same factor;
 * test files with an explicit timeout use test/helpers/test-timeout.ts. No assertion, test
 * workload or coverage threshold changes.
 * #668 (owner decision 2026-11-21): plain runs on CI (GitHub Actions sets CI=true) scale by 3.
 * The hosted runners differ by about 1.7 times from one job to the next and the job's Vitest
 * workers share 4 vCPUs; on run 44533609809 GPU-emulation tests took up to 140 s against a
 * 120 s limit and 395 s against 300 s. Local runs keep a factor of 1, so a real slowdown
 * still shows on a developer's machine. The factor also covers the default and hook timeouts.
 */
const coverageRun = process.argv.some(
  (argument) => argument === "--coverage" || argument.startsWith("--coverage.") || argument.startsWith("--coverage=")
);
const timeoutScale = coverageRun ? 4 : process.env.CI ? 3 : 1;
/*
 * A sharded coverage run (`--shard=k/n`, the ten CI coverage shards) covers only part of the
 * suite, so it keeps raw coverage in its blob report and checks no threshold; the merge of all
 * parts (`vitest --merge-reports --coverage`, the required `verify (lts/*)` check) enforces the
 * thresholds below on the whole suite. Every other coverage run enforces them directly.
 */
const shardRun = process.argv.some((argument) => argument === "--shard" || argument.startsWith("--shard="));

export default defineConfig({
  plugins: process.env.PHOTIVRA_WGSL_MINIFY === "0" ? [] : [wgslMinifyPlugin()],
  test: {
    exclude: ["**/node_modules/**", ".claude/**", ...configDefaults.exclude],
    testTimeout: 5_000 * timeoutScale,
    hookTimeout: 10_000 * timeoutScale,
    env: { PHOTIVRA_TEST_TIMEOUT_SCALE: String(timeoutScale) },
    // `--shard=k/n` balanced by measured per-file time (test/helpers/weighted-shard-sequencer.ts).
    sequence: { sequencer: WeightedShardSequencer },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/api/poc-api-cli.ts",
        "src/schema/camera.ts",
        "src/schema/scene.ts"
      ],
      reporter: ["text", "json-summary"],
      thresholds: shardRun ? undefined : {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 80
      }
    }
  }
});
