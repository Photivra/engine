// SPDX-License-Identifier: Apache-2.0
/**
 * `foundation-06` (#699, owner decision 2026-11-21): automatic exposure takes its log2 and exp2 (and the meter policies' pow) from the
 * engine's portable functions (src/core/portable-math.ts), so the settings it resolves have the same bits on every supported Node.js
 * line; V8's Math.log2 and Math.pow differ in the last bits between V8 12, 13 and 14. Before 2.28.0 four of 76 requests of the review's
 * sweep (24 × 16 Siemens star, DNG) resolved to other last bits on Node 22 than on Node 24 and 26; two of them are below. The other two
 * (program mode at 58,568 and 46,989 lux) still differ there, because the meter's own zone signal differs by 2 ulp (its scene radiance
 * uses V8's Math); docs/NUMERICAL_CORRECTNESS.md lists them. No image byte changed in the sweep.
 */
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";

const hex = (x: number): string => { const b = Buffer.alloc(8); b.writeDoubleBE(x); return b.toString("hex"); };
const request = (extra: Partial<SimulateCaptureOptions>): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" }, output: { width: 24, height: 16, format: "dng" }, ...extra });

describe("automatic exposure resolves to the same bits on every Node.js line (foundation-06)", () => {
  it("aperture priority with ±1/2 stop compensation and program mode at 6,680 lux", async () => {
    for (const [extra, fNumber, shutterSeconds] of [
      [{ exposure: { mode: "aperture-priority", compensationStops: 0.5 }, lens: { fNumber: 8 } }, "4020000000000000", "3f7d0b7791d376ca"],
      [{ exposure: { mode: "aperture-priority", compensationStops: -0.5 }, lens: { fNumber: 8 } }, "4020000000000000", "3f6d0b7791d376ca"],
      [{ exposure: { mode: "program" }, illuminanceLux: 6680 }, "40168a508ed47acd", "3f80624dd2f1a9fc"]
    ] as [Partial<SimulateCaptureOptions>, string, string][]) {
      const settings = (await simulateCapture(request(extra))).exposure.settings;
      expect([hex(settings.fNumber), hex(settings.shutterSeconds), settings.iso], JSON.stringify(extra)).toEqual([fNumber, shutterSeconds, 100]);
    }
  });
});
