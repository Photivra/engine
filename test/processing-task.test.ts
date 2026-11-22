// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  createBilateralFilterTask, createDurandDorseyToneMappingTask, createExposureFusionTask, createFocusStackTask, createHdrBracketMergeTask,
  createNonLocalMeansTask, createPanoramaTask, createReinhardGlobalToneMappingTask, createSyntheticFilmGrainTask, createUnsharpMaskTask, InvalidConfigurationError, InvalidScientificInputError, PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES, type ProcessingTask } from "../src/index.js";
import { createProcessingTask } from "../src/processing/processing-task.js";
import { rgbImage, runTask } from "./helpers/processing-fixture.js";

const image = rgbImage(16, 16, (x, y) => (x + y) / 32);

describe("processing task contract", () => {
  it("is single-use, transfers output once and reports progress per row", async () => {
    const seen: number[] = [];
    const task = createUnsharpMaskTask({ image, radiusSigmaPixels: 1, amount: 1 }, { yieldControl: async () => {}, onProgress: (p) => seen.push(p.completedTileCount) });
    expect(task.state).toBe("ready"); expect(task.totalTileCount).toBe(64); expect(task.estimatedWorkingBytes).toBe(16 * 16 * 36);
    await task.run();
    expect(seen).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    await expect(task.run()).rejects.toThrow(InvalidConfigurationError);
    task.takeOutput(); expect(task.state).toBe("transferred");
    expect(() => task.takeOutput()).toThrow(InvalidConfigurationError);
  });

  it("cancels between rows, disposes, and fails closed on non-finite input", async () => {
    let task = createUnsharpMaskTask({ image, radiusSigmaPixels: 1, amount: 1 }, { yieldControl: async () => { task.cancel(); } });
    await expect(task.run()).rejects.toThrow(/aborted/u);
    expect(task.state).toBe("cancelled"); expect(() => task.takeOutput()).toThrow(InvalidConfigurationError);
    const disposed = createUnsharpMaskTask({ image, radiusSigmaPixels: 1, amount: 1 }, { yieldControl: async () => {} });
    disposed.dispose(); expect(disposed.state).toBe("disposed"); await expect(disposed.run()).rejects.toThrow(InvalidConfigurationError);
    const bad = rgbImage(4, 4, () => 0.5); bad.data[7] = Number.NaN;
    task = createUnsharpMaskTask({ image: bad, radiusSigmaPixels: 1, amount: 1 }, { yieldControl: async () => {} });
    await expect(task.run()).rejects.toThrow(InvalidScientificInputError); expect(task.state).toBe("failed");
  });

  it("bounds working memory and validates the provider", () => {
    expect(PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES).toBe(2 ** 30);
    expect(() => createUnsharpMaskTask({ image, radiusSigmaPixels: 1, amount: 1, maximumWorkingBytes: 1000 }, { yieldControl: async () => {} }))
      .toThrow(/exceeds maximumWorkingBytes/u);
    expect(() => createUnsharpMaskTask({ image, radiusSigmaPixels: 1, amount: 1 }, {} as never)).toThrow(InvalidConfigurationError);
    expect(() => createUnsharpMaskTask({ image: { ...image, data: new Float64Array(768) as unknown as Float32Array }, radiusSigmaPixels: 1, amount: 1 },
      { yieldControl: async () => {} })).toThrow(InvalidConfigurationError);
  });

  it("yields on the time-budget cadence without changing output, and rejects progress plan drift", async () => {
    let clock = 0, yields = 0;
    const make = (budget: number): ProcessingTask<number> => createProcessingTask({ provider: { yieldControl: async () => { yields++; } }, totalTileCount: 10, estimatedWorkingBytes: 0,
      maximumWorkingBytes: 1, cadence: { budgetMilliseconds: budget, now: () => (clock += 1) },
      body: function* () { for (let i = 0; i < 10; i++) yield; return 42; } });
    const every = make(0); await every.run(); expect(yields).toBe(11); expect(every.takeOutput()).toBe(42);
    yields = 0; const sparse = make(1000); await sparse.run(); expect(yields).toBe(1); expect(sparse.takeOutput()).toBe(42);
    const drift = createProcessingTask({ provider: { yieldControl: async () => {} }, totalTileCount: 3, estimatedWorkingBytes: 0, maximumWorkingBytes: 1,
      body: function* () { yield; return 0; } });
    await expect(drift.run()).rejects.toThrow(/progress accounting/u);
  });

  // #671: the progress plan of every operator matches its body on one-frame, 1 × 1 and 1 × N inputs.
  it.each([[1, 1], [1, 5], [5, 1], [3, 2]])("completes every operator's progress plan on a %i × %i input", async (w, h) => {
    const img = rgbImage(w, h, (x, y, c) => 0.2 + 0.1 * c + 0.05 * ((x + y) % 3));
    const pano = { projection: "equirectangular" as const, width: w, height: h, longitudeRangeRad: [-0.2, 0.2] as const, latitudeRangeRad: [-0.1, 0.1] as const };
    const frame = { image: img, focalLengthPixels: 4, rotationRad: { pitch: 0, yaw: 0, roll: 0 } };
    const codes = Float32Array.from({ length: w * h }, (_, i) => 200 + 10 * i);
    const raw = { exposureTimeSeconds: 0.01, codes, blackLevelCode: 64, whiteLevelCode: 4000, conversionGainElectronsPerCode: 2, readNoiseElectrons: 3 };
    await runTask((p) => createFocusStackTask({ frames: [img] }, p));
    await runTask((p) => createExposureFusionTask({ frames: [img] }, p));
    await runTask((p) => createReinhardGlobalToneMappingTask({ image: img, inputColorSpace: "linear-srgb-d65" }, p));
    await runTask((p) => createDurandDorseyToneMappingTask({ image: img, inputColorSpace: "linear-srgb-d65" }, p));
    await runTask((p) => createBilateralFilterTask({ image: img, spatialSigmaPixels: 1, rangeSigma: 0.1 }, p));
    await runTask((p) => createNonLocalMeansTask({ image: img, filteringParameter: 0.1 }, p));
    await runTask((p) => createUnsharpMaskTask({ image: img, radiusSigmaPixels: 1, amount: 1 }, p));
    await runTask((p) => createSyntheticFilmGrainTask({ image: img, seedUint32: 1, intensity: 0.02 }, p));
    await runTask((p) => createHdrBracketMergeTask({ sampleCount: w * h, frames: [raw] }, p));
    for (const blending of ["feather", "multi-band"] as const) for (const exposureCompensation of ["gain", "none"] as const) {
      await runTask((p) => createPanoramaTask({ frames: [frame], canvas: pano, blending, exposureCompensation }, p));
    }
  });
});
