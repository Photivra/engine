// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createNativeEnvironmentRawPartitionTask, createNativeEnvironmentRawTask, composeNativeEnvironmentRawPartitions, calculateNativeRawRowBands,
  calculateNativeRawPlan, simulateCapture, type NativeEnvironmentRawInput, type NativeEnvironmentRawOutput, type NativeEnvironmentRawPartition, type NativeEnvironmentRawProvider,
  type NativeEnvironmentRawTile, type NativeRawRowBand, type SceneRadianceEvaluationRequest, type SceneRadianceEvaluationResult } from "../src/index.js";
import { nativeEnvironmentWorkload, nativeEnvironmentWorkloads } from "./helpers/native-environment-workloads.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { nativeEnvironmentLeanStatistics } from "../src/capture/native-environment-lean.js";

/*
 * Opt-in parallel execution (2.0, #275): a capture split into row-band partitions, run separately (as workers would)
 * and merged, must equal the single-task output byte for byte. Seeds use absolute native indices, so the split
 * never changes a value.
 */
const sha = (bytes: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
function summary(output: NativeEnvironmentRawOutput): Record<string, unknown> {
  const raw = output.raw;
  return { codes: sha(raw.codes), black: sha(raw.blackLevels), saturation: sha(raw.digitalSaturationCodes), flags: sha(raw.saturationFlags),
    white: Array.from(raw.effectiveSaturationCodes), evaluations: output.providerEvaluationCount, pixels: raw.codes.length, plan: raw.plan };
}
async function single(input: NativeEnvironmentRawInput, provider: NativeEnvironmentRawProvider): Promise<NativeEnvironmentRawOutput> {
  const task = createNativeEnvironmentRawTask(input, provider);
  await task.run();
  return task.takeOutput();
}
/** Runs every band (concurrently on this thread, like independent workers) and posts each result through structuredClone. */
async function partitioned(input: NativeEnvironmentRawInput, provider: () => NativeEnvironmentRawProvider, bands: readonly NativeRawRowBand[]):
  Promise<NativeEnvironmentRawPartition[]> {
  return Promise.all(bands.map(async band => {
    const task = createNativeEnvironmentRawPartitionTask(input, band, provider());
    await task.run();
    const partition = task.takeOutput();
    expect(task.state).toBe("transferred");
    return structuredClone(partition, { transfer: [partition.codes.buffer, partition.blackLevels.buffer, partition.digitalSaturationCodes.buffer,
      partition.saturationFlags.buffer] });
  }));
}

const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "photivra:partition-test", reuseStatus: "photivra-owned" as const }];
function result(q: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult {
  const d = q.target.kind === "environment-direction" ? q.target.outgoingDirectionUnitVector : { x: 0, y: 0, z: 1 };
  return { schemaVersion: "0.1.0", sampleId: q.sampleId, sceneId: q.sceneId, providerProfileId: q.providerProfileId,
    wavelengthNanometers: q.wavelengthNanometers, wavelengthBasis: q.wavelengthBasis, quantity: "outgoing-spectral-radiance", unit: "W/m^2/sr/nm",
    spectralRadianceWattsPerSquareMeterSteradianNanometer: 0.02*(1+0.6*Math.sin(900*d.x)*Math.cos(700*d.y))*(0.5+q.wavelengthNanometers/1000),
    scientificStatus: "approximation", uncertainty: { kind: "not-quantified", limitation: "Test analytic field." }, evidence, limitations: ["Test analytic field."] };
}
let facade: { input: NativeEnvironmentRawInput; provider: (mutate?: (site: NativeEnvironmentRawTile["sites"][number], index: number) => void) => NativeEnvironmentRawProvider };
beforeAll(async () => {
  const capture = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 6, height: 6 } });
  const input = { ...capture.request.environmentRaw, raw: { ...capture.request.environmentRaw.raw, tileWidth: 3 } };
  const width = input.raw.exposure.geometry.nativeRaster.pixelWidth;
  facade = { input, provider: (mutate): NativeEnvironmentRawProvider => ({
    readTile: async (r): Promise<NativeEnvironmentRawTile> => ({ ...r, sites: Array.from({ length: r.width }, (_, j) => {
      const index = r.y*width+r.x+j, site = capture.request.siteInput(index);
      mutate?.(site, index);
      return site;
    }) }),
    evaluateRadiance: result, yieldControl: async (): Promise<void> => {} }) };
}, scaledTimeout(60_000));

describe("native environment RAW partitions (opt-in parallel execution)", () => {
  it("splits rows into deterministic contiguous bands", () => {
    const plan = { exposure: { geometry: { nativeRaster: { pixelWidth: 4, pixelHeight: 10 } } } } as Parameters<typeof calculateNativeRawRowBands>[0];
    expect(calculateNativeRawRowBands(plan, 3)).toEqual([{ y: 0, height: 4 }, { y: 4, height: 3 }, { y: 7, height: 3 }]);
    expect(calculateNativeRawRowBands(plan, 1)).toEqual([{ y: 0, height: 10 }]);
    expect(calculateNativeRawRowBands(plan, 64)).toHaveLength(10);
    for (const count of [0, 1.5, 1025, Number.NaN]) expect(() => calculateNativeRawRowBands(plan, count)).toThrow(/partition count/);
  });

  // #678: a plan that carries every optional field (tileWidth, maximumPixels, exposureWindow) is accepted.
  it("splits the plan of a capture that raised maximumPixels, with every optional plan field set", async () => {
    const output = { width: 8, height: 8 };
    const plain = await simulateCapture({ scene: { preset: "slanted-edge" }, output });
    const raised = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { ...output, maximumPixels: 30_000_000 } });
    expect(raised.plan.maximumPixels).toBe(30_000_000);
    expect(calculateNativeRawRowBands(raised.plan, 2)).toEqual(calculateNativeRawRowBands(plain.plan, 2));
    const full = await simulateCapture({ scene: { preset: "slanted-edge" }, motion: { shutter: "rolling" }, output: { ...output, maximumPixels: 30_000_000 } });
    const plan = calculateNativeRawPlan({ ...full.request.environmentRaw.raw, tileWidth: 3 });
    for (const key of ["tileWidth", "maximumPixels", "exposureWindow"]) expect(Object.keys(plan)).toContain(key);
    expect(calculateNativeRawRowBands(plan, 4)).toEqual(calculateNativeRawRowBands(plain.plan, 4));
    expect(() => calculateNativeRawRowBands({ ...plan, extra: 1 } as typeof plan, 4)).toThrow(/unknown field "extra"/u);
  });

  it.each(nativeEnvironmentWorkloads)("merges %s partitions byte-identically to the single task", async kind => {
    const { input, provider } = nativeEnvironmentWorkload(kind);
    const expected = summary(await single(input, provider));
    for (const bands of [[{ y: 0, height: 2 }], [{ y: 0, height: 1 }, { y: 1, height: 1 }]]) {
      expect(summary(composeNativeEnvironmentRawPartitions(input, await partitioned(input, () => provider, bands)))).toEqual(expected);
    }
  });

  it("merges facade partitions byte-identically for 1, 2, 3 and per-row bands, with lean execution inside each band", async () => {
    const { input, provider } = facade, expected = summary(await single(input, provider()));
    const plan = (expected.plan as NativeEnvironmentRawOutput["raw"]["plan"]), height = plan.exposure.geometry.nativeRaster.pixelHeight;
    for (const count of [1, 2, 3, height]) {
      const bands = calculateNativeRawRowBands(plan, count), before = nativeEnvironmentLeanStatistics.executedSites;
      expect(summary(composeNativeEnvironmentRawPartitions(input, await partitioned(input, provider, bands)))).toEqual(expected);
      // Bands of at least three rows have lean sites after their first two rows (one template per CFA phase).
      if (count <= 3) expect(nativeEnvironmentLeanStatistics.executedSites - before).toBeGreaterThan(0);
    }
  }, scaledTimeout(120_000));

  it("rejects partitions that do not form exactly one capture", async () => {
    const { input, provider } = facade;
    const plan = createNativeEnvironmentRawTask(input, provider()).plan, bands = calculateNativeRawRowBands(plan, 2);
    const parts = await partitioned(input, provider, bands);
    const merge = (list: readonly NativeEnvironmentRawPartition[], from = input): NativeEnvironmentRawOutput => composeNativeEnvironmentRawPartitions(from, list);
    expect(() => merge([parts[1]!, parts[0]!])).toThrow(/every row once/);
    expect(() => merge([parts[0]!])).toThrow(/every row once/);
    expect(() => merge([parts[0]!, parts[0]!])).toThrow(/every row once/);
    expect(() => merge([])).toThrow(/dense list/);
    expect(() => merge([parts[0]!, { ...parts[1]!, codes: parts[1]!.codes.slice(1) }])).toThrow(/partition arrays/);
    expect(() => merge([parts[0]!, { ...parts[1]!, saturationFlags: new Uint16Array(parts[1]!.saturationFlags.length) as unknown as Uint8Array }])).toThrow(/partition arrays/);
    expect(() => merge([parts[0]!, { ...parts[1]!, extra: 1 } as NativeEnvironmentRawPartition])).toThrow(/Invalid native RAW partition/);
    expect(() => merge(parts, { ...input, raw: { ...input.raw, exposure: { ...input.raw.exposure, noise: { ...input.raw.exposure.noise, seedUint32: 99 } } } }))
      .toThrow(/different input/);
    expect(() => merge([parts[0]!, { ...parts[1]!, sharedStateCanonical: parts[1]!.sharedStateCanonical + " " }])).toThrow(/one shared/);
    expect(() => merge([parts[0]!, { ...parts[1]!, readoutIdentity: { ...parts[1]!.readoutIdentity, regimeId: "other" } }])).toThrow(/one readout identity/);
    const white = parts[1]!.effectiveSaturationCodes.slice(); white[0] = white[0]! - 1;
    expect(() => merge([parts[0]!, { ...parts[1]!, effectiveSaturationCodes: white }])).toThrow(/one effective white level/);
    expect(() => merge([parts[0]!, { ...parts[1]!, providerEvaluationCount: input.maximumProviderEvaluations }])).toThrow(/query budget/);
    expect(merge(parts).raw.codes.length).toBe(plan.pixelCount);
  }, scaledTimeout(120_000));

  it("finds a second shared state across bands, and rejects bad bands and optical-stage retention", async () => {
    const { input, provider } = facade;
    const plan = createNativeEnvironmentRawTask(input, provider()).plan, height = plan.exposure.geometry.nativeRaster.pixelHeight;
    const width = plan.exposure.geometry.nativeRaster.pixelWidth, bands = calculateNativeRawRowBands(plan, 2);
    // Each band is consistent on its own; only the merge sees that the second band's optics state differs.
    const differing = (): NativeEnvironmentRawProvider => provider((site, index) => {
      if (index >= bands[1]!.y*width) (site.environment as unknown as { motion: unknown }).motion = { angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 1e-6 },
        timeReference: "first-opening-boundary-phase", environmentDirectionConvention: "outgoing-radiance-toward-camera" };
    });
    await expect(single(input, differing())).rejects.toThrow(/one shared/);
    expect(() => composeNativeEnvironmentRawPartitions(input, [])).toThrow();
    const parts = await partitioned(input, differing, bands);
    expect(() => composeNativeEnvironmentRawPartitions(input, parts)).toThrow(/one shared/);
    for (const band of [{ y: -1, height: 2 }, { y: 0, height: 0 }, { y: height-1, height: 2 }, { y: 0.5, height: 1 }, { y: 0, height: 1, extra: 1 }]) {
      expect(() => createNativeEnvironmentRawPartitionTask(input, band as NativeRawRowBand, provider())).toThrow(/row band/);
    }
    expect(() => createNativeEnvironmentRawPartitionTask({ ...input, opticalStage: { maximumRetainedBytes: 1e9 } }, bands[0]!, provider())).toThrow(/optical stage/);
    expect(() => composeNativeEnvironmentRawPartitions({ ...input, opticalStage: { maximumRetainedBytes: 1e9 } }, parts)).toThrow(/optical stage/);
    const task = createNativeEnvironmentRawPartitionTask(input, bands[0]!, provider());
    expect(() => task.takeOutput()).toThrow(/unavailable/);
  }, scaledTimeout(120_000));
});
