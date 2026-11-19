// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { expectRegionEqualsWhole, type ViewRegion } from "./helpers/view-equivalence.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #651: with camera rotation under a rolling shutter and the defocus disc regrouped, a request takes one method whatever the region's
 * size: row bands when fast, single rows with fast: false. A small region (which the cost rule would once have given the tap sum at each
 * row's own instants) equals the same pixels of a larger region and of the whole view, bit for bit, in samples and expected values.
 */

const request = (fast: boolean): SimulateCaptureOptions => ({ scene: { preset: "siemens-star", cycles: 24 }, subjectDistanceM: 0.63, output: { width: 240, height: 160 },
  sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 80 }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
  lens: { focalLengthMm: 50, fNumber: 8, focusDistanceM: 0.95 * 0.63, defocus: { model: "geometric-disc" } },
  motion: { angularVelocityRadPerSec: { yaw: 0.0766 }, shutter: "rolling", rollingShutterSkewSeconds: 0.0005 }, ...(fast ? {} : { fast: false }) } as SimulateCaptureOptions);

describe("rolling-shutter lens view: one method for every region (#651)", () => {
  for (const fast of [true, false]) {
    it((fast ? "fast (row bands)" : "fast: false (rows)") + ": a 1 × 1 and a 12 × 8 region equal the same pixels of a 160 × 120 region and the whole view", async () => {
      const options = request(fast), whole: ViewRegion = { x: 0, y: 0, width: 240, height: 160 };
      const render = async (region: ViewRegion): Promise<{ samples: ArrayLike<number>; expected: ArrayLike<number>; bands: { rows: number } | undefined }> => {
        const run = await simulateDisplayViewWithInternals(options, { width: 240, height: 160, samplesPerAxis: 1, region });
        const defocus = run.result.assumptions.find((a) => a.id === "view.defocus")!.value as { rollingBands?: { rows: number } };
        return { samples: run.result.image.samples, expected: run.internals.expected, bands: defocus.rollingBands };
      };
      const all = await render(whole), large: ViewRegion = { x: 40, y: 20, width: 160, height: 120 }, big = await render(large);
      // Every render reports the same row blocks: bands of several rows when fast, single rows with fast: false.
      expect(all.bands).toBeDefined();
      if (fast) expect(all.bands!.rows).toBeGreaterThan(1); else expect(all.bands!.rows).toBe(1);
      expectRegionEqualsWhole(all.samples, whole, big.samples, large);
      expectRegionEqualsWhole(all.expected, whole, big.expected, large);
      for (const small of [{ x: 117, y: 73, width: 1, height: 1 }, { x: 100, y: 60, width: 12, height: 8 }]) {
        const part = await render(small);
        expect(part.bands).toEqual(all.bands);
        expectRegionEqualsWhole(big.samples, large, part.samples, small);
        expectRegionEqualsWhole(big.expected, large, part.expected, small);
        expectRegionEqualsWhole(all.samples, whole, part.samples, small);
        expectRegionEqualsWhole(all.expected, whole, part.expected, small);
      }
    }, scaledTimeout(300_000));
  }
});
