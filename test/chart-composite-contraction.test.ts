// SPDX-License-Identifier: Apache-2.0
/**
 * The composite chart kernel's device probe and product paths under fused contraction (2.11.0, the owner's M5 Pro run of October 27,
 * 2026: every material-layers case refused by the probe). WGSL lets an implementation fuse a multiply and an add into one rounding
 * and reassociate (W3C WGSL, § 15.7.5 "Reassociation and Fusion"), and lets `fma` be unfused (§ 15.7.2, § 17.5.32). On the fake
 * device's emulation of those behaviours (test/helpers/fake-webgpu-composite.ts): the fma emulation is exactly rounded; the probe
 * names the differing components and classifies the device; under fused contraction the as-written (Dekker) probe fails, as on the
 * M5 Pro, and the new probe picks the fma path, with which every unflagged query again equals the reference; with an unfused fma
 * the device is refused as contracted, under reassociation as reassociated; the fma path's double-word product stays inside the
 * kernel's declared 2^-40 per operation.
 */
import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { calculateChartRadianceBatch, calculateChartRadianceBatchPlan, createImageKernelAccelerator, type ChartCompositeProbeRecord, type ChartScene } from "../src/index.js";
import { ChartCompositeProbeError, chartMaterialTable, integrateChartQueries, classifyChartCompositeProbe, describeChartCompositeProbe, dwCrossTerm, dwMulDekker, dwMulFma, fmaF32, packChartScene, PROBE_INPUTS,
  probeExpectation, splitPoints, type Dw } from "../src/gpu/chart-composite-gpu.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { emulateCompositeChart, emulateCompositeProbe, exactProbeOutput, type CompositeArithmetic } from "./helpers/fake-webgpu-composite.js";
import { allElementsComposite, compositeBatchInput, FIXTURE_ASPECT, layeredScene, viewPoints, VIEW_SIZES } from "./helpers/chart-composite-fixtures.js";

const f = Math.fround;
const report: Record<string, unknown>[] = [];
afterAll(() => {
  if (!report.length) return;
  console.info(`[chart-composite-contraction] ${JSON.stringify(report)}`);
  if (process.env.PHOTIVRA_REPORT_FILE) writeFileSync(process.env.PHOTIVRA_REPORT_FILE, JSON.stringify(report, null, 1));
});

/** The contraction models the tests run: the first or the second product operand fused, and seeded random choices per site (some not fused). */
const CONTRACTIONS: [string, CompositeArithmetic][] = [
  ["fused contraction (first product operand)", { kind: "fused-contraction", choose: "first" }],
  ["fused contraction (second product operand)", { kind: "fused-contraction", choose: "second" }],
  ...[3, 7, 11].map((seed): [string, CompositeArithmetic] => [`fused contraction (random per site, seed ${seed})`, { kind: "fused-contraction", choose: { seed } }])
];

/** a·b + c rounded once to float32, to nearest, ties to even, in exact integer arithmetic (the reference for `fmaF32`). */
function exactFma(a: number, b: number, c: number): number {
  const parts = (x: number): [bigint, number] => {
    if (x === 0) return [0n, 0];
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x);
    const hi = view.getUint32(0), lo = view.getUint32(4), exponent = (hi >>> 20) & 0x7ff;
    const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), m = exponent === 0 ? mantissa : mantissa | (1n << 52n);
    return [x < 0 ? -m : m, (exponent === 0 ? 1 : exponent) - 1075];
  };
  const [ma, ea] = parts(a), [mb, eb] = parts(b), [mc, ec] = parts(c), ep = ea + eb, e0 = Math.min(ep, ec);
  const total = ((ma * mb) << BigInt(ep - e0)) + (mc << BigInt(ec - e0));
  if (total === 0n) return 0;
  const negative = total < 0n, magnitude = negative ? -total : total, bits = magnitude.toString(2).length;
  let q = magnitude, shift = 0;
  if (bits > 24) {
    shift = bits - 24; q = magnitude >> BigInt(shift);
    const rest = magnitude - (q << BigInt(shift)), half = 1n << BigInt(shift - 1);
    if (rest > half || (rest === half && (q & 1n) === 1n)) q += 1n;
  }
  const value = Number(q) * 2 ** (e0 + shift);
  return negative ? -value : value;
}

/** The written-order (Dekker) components of the probe all equal the round-to-nearest evaluation: the criterion of the probe before 2.11.0. */
function asWrittenProbePasses(got: Float32Array): boolean {
  return PROBE_INPUTS.every((row, i) => { const want = probeExpectation(row); return [0, 1, 2, 4, 5].every((k) => Object.is(got[8 * i + k], want[k])); });
}
function probeOn(model: CompositeArithmetic): { got: Float32Array; record: ChartCompositeProbeRecord } {
  const got = new Float32Array(8 * PROBE_INPUTS.length);
  emulateCompositeProbe(Float32Array.from(PROBE_INPUTS.flat()), got, model);
  return { got, record: classifyChartCompositeProbe(got) };
}

describe("fma emulation and the fma path's double-word product", () => {
  it("fmaF32 is a·b + c rounded once (to nearest, ties to even): random and near-midpoint triples against exact integer arithmetic", () => {
    let s = 491;
    const random = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
    const float = (): number => f((random() * 2 - 1) * 2 ** Math.floor(random() * 40 - 20));
    for (let k = 0; k < 20000; k++) {
      const a = float(), b = float(), p = a * b;
      // c: random; the product's rounding error cancelled (the TwoProduct case); and sums on or next to a float32 midpoint.
      const ulp = 2 ** (Math.floor(Math.log2(Math.abs(p))) - 23);
      for (const c of [float(), -f(p), f(-f(p) + ulp / 2), f(ulp * (Math.floor(random() * 8) + 0.5) - p), f(-p + f(p)) ]) expect(fmaF32(a, b, c), `${a} ${b} ${c}`).toBe(exactFma(a, b, c));
    }
    expect(fmaF32(1 + 2 ** -23, 1 + 2 ** -23, -1)).toBe(2 ** -22);
  });

  it("the fma double-word product is within 10 u² of the exact product for every allowed cross-term evaluation (the kernel declares 2^-40 = 256 u²)", () => {
    let s = 7, worstFma = 0, worstDekker = 0;
    const random = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
    const word = (): Dw => { const h = f((random() * 2 - 1) * 2 ** Math.floor(random() * 30 - 15)), l = f((random() * 2 - 1) * Math.abs(h) * 2 ** -24); return [h, l]; };
    for (let k = 0; k < 100000; k++) {
      const a = word(), b = word(), P = a[0] * b[0], rest = a[0] * b[1] + a[1] * b[0] + a[1] * b[1];
      for (const c of ["none", "first", "second"] as const) {
        const t = dwCrossTerm(a, b, c);
        for (const [mul, fma] of [[dwMulFma, true], [dwMulDekker, false]] as const) {
          const r = mul(a, b, t), relative = Math.abs(((r[0] - P) + r[1]) - rest) / Math.abs(P) / 2 ** -48;
          if (fma) worstFma = Math.max(worstFma, relative); else worstDekker = Math.max(worstDekker, relative);
        }
      }
    }
    report.push({ check: "double-word product, worst |error| / (u²·|product|) over 3 × 10^5 normalized products", fmaPath: worstFma, dekkerPath: worstDekker });
    expect(worstFma).toBeLessThanOrEqual(10);
    expect(worstDekker).toBeLessThanOrEqual(10);
  });
});

describe("the composite probe's classes and product path", () => {
  it("an exact device (round to nearest, unfused, fused fma) passes both paths and keeps the Dekker path", () => {
    const record = classifyChartCompositeProbe(exactProbeOutput(PROBE_INPUTS));
    expect(record).toMatchObject({ deviceClass: "exact", productPath: "dekker", fmaFused: true, inputs: PROBE_INPUTS.length, mismatches: [] });
    expect(probeOn({ kind: "nearest" }).record).toEqual(record);
  });

  it.each(CONTRACTIONS)("%s: the as-written probe fails (the M5 Pro result); the new probe classifies the device as contracted and picks the fma path", (name, model) => {
    const { got, record } = probeOn(model);
    report.push({ model: name, probe: record, line: describeChartCompositeProbe(record) });
    expect(asWrittenProbePasses(got)).toBe(false);
    expect(record.mismatchCounts["two-sum"] + record.mismatchCounts["double-word-add"]).toBe(0);
    expect(record.mismatchCounts["two-product"] + record.mismatchCounts["double-word-multiply"]).toBeGreaterThan(0);
    expect(record).toMatchObject({ deviceClass: "contracted", productPath: "fma", fmaFused: true });
    expect(record.mismatchCounts["fma-two-product"] + record.mismatchCounts["fma-double-word-multiply"]).toBe(0);
  });

  it("fused contraction with an unfused fma (WGSL allows both): contracted, both product paths fail, refused with the components named", () => {
    const { record } = probeOn({ kind: "fused-contraction", choose: "first", fma: "unfused" });
    expect(record).toMatchObject({ deviceClass: "contracted", productPath: null, fmaFused: false });
    expect(record.mismatchCounts["fma-two-product"]).toBeGreaterThan(0);
    const error = new ChartCompositeProbeError(record);
    expect(error.reason).toBe("unsupported-on-backend");
    expect(error.message).toMatch(/double-float32/u);
    expect(error.message).toMatch(/class contracted, product path none, fma not fused; differing of 16 inputs: .*double-word multiply \(q\) ×\d+ \[[\d,]+\].*fma TwoProduct \(mf\.l\) ×\d+ \[[\d,]+\].*first: \S.* got 0x[0-9a-f]{8} want 0x[0-9a-f]{8}/u);
    expect(error.message.length).toBeLessThan(600);
    for (const c of ["double-word-multiply", "fma-two-product"] as const) expect(record.mismatchedInputs[c]).toHaveLength(record.mismatchCounts[c]);
    expect(record.mismatches.length).toBeLessThanOrEqual(8);
    report.push({ model: "fused contraction, unfused fma", probe: record, message: error.message });
  });

  it("reassociation (fast-math simplification of the error-free transforms): reassociated, refused; a probe of zeros reads the same", () => {
    const { record } = probeOn({ kind: "reassociation" });
    expect(record).toMatchObject({ deviceClass: "reassociated", productPath: null });
    expect(record.mismatchCounts["two-sum"]).toBeGreaterThan(0);
    report.push({ model: "reassociation", probe: record, line: describeChartCompositeProbe(record) });
    expect(classifyChartCompositeProbe(new Float32Array(8 * PROBE_INPUTS.length))).toMatchObject({ deviceClass: "reassociated", productPath: null });
  });

  it("other: a TwoSum low part off by one unit (a rounding not to nearest), or a non-finite output", () => {
    const exact = exactProbeOutput(PROBE_INPUTS), directed = exact.slice(), nonFinite = exact.slice();
    const i = PROBE_INPUTS.findIndex((row) => probeExpectation(row)[0] !== 0);
    directed[8 * i] = directed[8 * i]! * (1 + 2 ** -20);
    expect(classifyChartCompositeProbe(directed)).toMatchObject({ deviceClass: "other", productPath: null, mismatchCounts: { "two-sum": 1 } });
    nonFinite[5] = Number.NaN;
    expect(classifyChartCompositeProbe(nonFinite)).toMatchObject({ deviceClass: "other", productPath: null });
    // A device that contracts only the cross-term sum of the double-word product (harmless there) keeps the Dekker path.
    const tOnly = exact.slice();
    PROBE_INPUTS.forEach((row, k) => {
      const [x, y, z, w] = row.map(f) as [number, number, number, number], q = dwMulDekker([x, y], [z, w], dwCrossTerm([x, y], [z, w], "first"));
      tOnly[8 * k + 4] = q[0]; tOnly[8 * k + 5] = q[1];
    });
    expect(classifyChartCompositeProbe(tOnly)).toMatchObject({ deviceClass: "exact", productPath: "dekker" });
  });
});

describe("composite chart radiance under fused contraction (fake device)", () => {
  const scenes: [string, ChartScene | ReturnType<typeof layeredScene>][] = [["all-elements composite", allElementsComposite()], ["material-layers (composite under the label layer)", layeredScene(FIXTURE_ASPECT)]];
  const points = Float64Array.from([...viewPoints(FIXTURE_ASPECT, VIEW_SIZES.app, 13), ...viewPoints(FIXTURE_ASPECT, VIEW_SIZES.coarse, 1, undefined, 4000, 5)]);

  it.each(scenes)("%s: the accelerator runs the fma path; every unflagged query equals the reference rounded once, as unfused; the Dekker kernel under contraction would not", async (name, scene) => {
    const rows: Record<string, unknown>[] = [];
    for (const [model, arithmetic] of [["unfused", { kind: "nearest" } as CompositeArithmetic], ...CONTRACTIONS.slice(0, 3)] as const) {
      const a = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu: createFakeGpu({ compositeArithmetic: arithmetic }).gpu });
      for (const mode of ["radiance", "spectral-integral"] as const) {
        const input = compositeBatchInput(scene, points, mode), reference = calculateChartRadianceBatch(input).values, result = await a.evaluateChartRadiance(input);
        for (let i = 0; i < reference.length; i++) if (result.values[i] !== f(reference[i]!)) expect.fail(`${model}, value ${i} in ${mode}: ${result.values[i]} vs ${reference[i]}`);
        if (mode === "spectral-integral") rows.push({ model, recomputed: result.hostRecomputedQueryIndices.length, fraction: result.hostRecomputedQueryIndices.length / (points.length / 2) });
      }
      a.dispose();
    }
    // The Dekker kernel itself under contraction, without the probe: unflagged queries whose value is not the reference's are misclassifications.
    const input = compositeBatchInput(scene, points, "spectral-integral"), plan = calculateChartRadianceBatchPlan(input), packed = packChartScene(plan), table = chartMaterialTable(plan);
    const reference = calculateChartRadianceBatch(input).values, count = plan.queryCount, columns = plan.columns;
    for (const [model, arithmetic] of CONTRACTIONS.slice(0, 2)) {
      for (const path of ["dekker", "fma"] as const) {
        const values = new Float32Array(count * columns), flags = new Uint32Array(count);
        emulateCompositeChart(Uint32Array.from([count, columns, 0, 0]), splitPoints(points), table, packed.af, packed.ai, new Uint32Array(1), values, flags, path, arithmetic);
        // 2.21.0: the kernel returns each query's material; the host integrates its spectrum against the channel weights.
        const skipped: number[] = [];
        for (let q = 0; q < count; q++) if (flags[q]) skipped.push(q);
        integrateChartQueries(plan, values, skipped);
        let wrong = 0, flagged = 0;
        for (let q = 0; q < count; q++) {
          if (flags[q]) { flagged++; continue; }
          for (let c = 0; c < columns; c++) if (values[q * columns + c] !== f(reference[q * columns + c]!)) { wrong++; break; }
        }
        rows.push({ model, kernel: path + " (no probe)", flagged, unflaggedMisclassified: wrong });
        if (path === "fma") expect(wrong, `${model}: the fma kernel misclassified ${wrong} unflagged queries`).toBe(0);
      }
    }
    report.push({ scene: name, queries: points.length / 2, rows });
  }, 600_000);
});
