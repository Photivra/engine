// SPDX-License-Identifier: Apache-2.0
// #670 (2.28.0 step 6, owner decision 2026-11-21): the pre-integrated per-tap sum (`preintegratedSite`, expected-signal.ts) adds four
// spectral nodes at a time in their own accumulators. Each node's additions are the same and in the same order, so every bit is the
// same: these digests of the samples and of the float64 expected values were recorded on 2.28.0 step 5's tree (8405ae2) before the
// change, with 20 spectral nodes (a multiple of four) and with 81 (5 nm; the remainder loop), on x64 (Node 24.1) and arm64 (Node 26.13):
// the samples are the same on both; the float64 expected values differ by architecture (one-ulp Math results, #508) and are recorded per
// architecture (test/helpers/architecture-hash-locks.ts).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareDisplayView, renderPreparedDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";

const sha = (a: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
/** #710's small-pixel diffraction view, a 32 × 24 region at the centre, full quality. */
const request = (spectralStepNanometers: number): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" }, subjectDistanceM: 2, fast: false,
  lens: { prime: 50, fNumber: 8, diffraction: "circular-aperture" }, sensor: { pixelPitchMicrometers: 1.4, spectralStepNanometers },
  output: { width: 4000, height: 3000, format: "srgb-8" } }) as SimulateCaptureOptions;

async function digests(step: number): Promise<{ samples: string; expected: string; sceneLookups: number }> {
  const view = await prepareDisplayView(request(step), { gpu: "off" });
  const { result, internals } = await renderPreparedDisplayViewWithInternals(view, { width: 1000, height: 750, samplesPerAxis: 2, region: { x: 484, y: 363, width: 32, height: 24 } });
  return { samples: sha(result.image.samples), expected: sha(internals.expected), sceneLookups: result.diagnostics.sceneLookups };
}

describe("pre-integrated per-tap sum, four nodes at a time (#670)", () => {
  it("keeps every bit with 20 spectral nodes", async () => {
    expect(await digests(20)).toEqual(onThisArchitecture(RECORDED[20]!));
  }, 120_000);
  it("keeps every bit with 81 spectral nodes (the remainder loop)", async () => {
    expect(await digests(5)).toEqual(onThisArchitecture(RECORDED[5]!));
  }, 120_000);
});

/** x64 records; the arm64 expected-value digest by its x64 digest. */
const RECORDED: Record<number, { samples: string; expected: string; sceneLookups: number }> = {
  20: { samples: "45f5a7d6fd3b50afd79eb7d671a4e3b521352b678a33d3c6d92ea5d1223b3256", expected: "b04798dcec520dc34105114a797b428b9b81593e7c02587d2e68fc2a5104a86b", sceneLookups: 967522 },
  5: { samples: "f9dbe1afca92991545adc40b9964cf40eaabe1a6ac5026c099816b75a7bf78e7", expected: "7f93f2475683dd1cd3225e2d7a69e83cdfdc9fd9bd7ae4a90faa516c160e25cf", sceneLookups: 967522 }
};
const ARM64_EXPECTED: Record<string, string> = {
  b04798dcec520dc34105114a797b428b9b81593e7c02587d2e68fc2a5104a86b: "c50da52c391b45cc500fd7f27187b9e4acb0ea85125048c874376e27266f11e4",
  "7f93f2475683dd1cd3225e2d7a69e83cdfdc9fd9bd7ae4a90faa516c160e25cf": "2464e0a3844915af9bbe5144b473d940c68038ed1df87b5138d8378454a5765b"
};
const onThisArchitecture = (r: { samples: string; expected: string; sceneLookups: number }): typeof r => ({ ...r, expected: hashLockOnThisArchitecture(r.expected, ARM64_EXPECTED) });
