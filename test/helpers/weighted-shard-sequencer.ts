// SPDX-License-Identifier: Apache-2.0
import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import weights from "../shard-weights.json" with { type: "json" };

/*
 * `--shard=k/n` by measured time instead of Vitest's hash order (Photivra/engine#510).
 * Vitest's default cuts the hash-sorted file list into n runs of equal file count, so one
 * part can draw several of the slow numerical files: on the October 2026 CI runs coverage
 * shard 2 took 13.5 of its 15 minutes while shard 1 took 7. This assigns files longest
 * first to the part with the least time so far (the LPT rule), from the per-file times in
 * test/shard-weights.json. A file without a recorded time weighs the median. The split is
 * a pure function of the file list, so every part computes the same partition and each
 * file runs in exactly one part (test/weighted-shard-sequencer.test.ts). Within a part the
 * files start longest first, so the slowest file, which no split can shorten, starts at once.
 * A file without a recorded time starts before every recorded one (#665): it may be the
 * slowest, and if it is fast, starting it first costs nothing. Ranked last (before 2.28.0) or at
 * the median (397 ms), a new slow file started after the part's heavy files and could push the
 * part past its limit. Start order cannot help a part that draws several new slow files at the
 * median's weight, so a test fails while a test file has no recorded time: a pull request that
 * adds one enters an estimate in test/shard-weights.json by hand (its local time under coverage
 * times about 2.8, the CI-to-local ratio of the 2.27.0 record). Measured times replace the table
 * at the next full re-record from all ten `coverage-timings-k` artifacts of one run
 * (scripts/record-shard-weights.mjs rewrites the whole table).
 */
/** The order in which a part's files start: unrecorded files first (by name), then by recorded time, longest first, ties by name. */
export function startOrder(files: readonly string[], recorded: Readonly<Record<string, number>>): string[] {
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const unrecorded = files.filter((file) => recorded[file] === undefined).sort(byName);
  const known = files.filter((file) => recorded[file] !== undefined).sort((a, b) => recorded[b]! - recorded[a]! || byName(a, b));
  return [...unrecorded, ...known];
}

export function partition(files: readonly string[], count: number, recorded: Readonly<Record<string, number>>, alone: readonly string[] = []): string[][] {
  const known = Object.values(recorded).sort((a, b) => a - b);
  const median = known.length === 0 ? 1 : known[Math.floor(known.length / 2)]!;
  const unique = [...new Set(files)];
  // 2.24.0: a file in `alone` (shard-weights.json, coverage runs only) gets a part of its own, so no other file shares that
  // runner while it runs; the rest are spread over the other parts. At least one part always stays open for the rest.
  const solo = [...new Set(alone)].filter((file) => unique.includes(file)).sort().slice(0, Math.max(0, count - 1));
  const weighted = unique.filter((file) => !solo.includes(file))
    .map((file) => ({ file, weight: recorded[file] ?? median }))
    .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const parts = Array.from({ length: count }, (_, i) => ({ total: 0, files: i < solo.length ? [solo[i]!] : [] as string[], closed: i < solo.length }));
  const open = parts.filter((part) => !part.closed);
  for (const { file, weight } of weighted) {
    let lightest = open[0]!;
    for (const part of open) if (part.total < lightest.total) lightest = part;
    lightest.files.push(file);
    lightest.total += weight;
  }
  return parts.map((part) => part.files);
}

export default class WeightedShardSequencer extends BaseSequencer {
  private key(spec: TestSpecification): string {
    return relative(this.ctx.config.root, spec.moduleId).split("\\").join("/");
  }

  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { shard } = this.ctx.config;
    if (!shard) return specs;
    // The `alone` files have their own part in the coverage shards only (the Node test parts run without coverage, where they are short).
    const alone = this.ctx.config.coverage?.enabled ? (weights as { alone?: readonly string[] }).alone ?? [] : [];
    const part = new Set(partition(specs.map((spec) => this.key(spec)), shard.count, weights.files, alone)[shard.index - 1]);
    return specs.filter((spec) => part.has(this.key(spec)));
  }

  override async sort(specs: TestSpecification[]): Promise<TestSpecification[]> {
    if (!this.ctx.config.shard) return super.sort(specs);
    const byKey = new Map<string, TestSpecification[]>();
    for (const spec of specs) byKey.set(this.key(spec), [...(byKey.get(this.key(spec)) ?? []), spec]);
    return startOrder([...byKey.keys()], weights.files).flatMap((key) => byKey.get(key)!);
  }
}
