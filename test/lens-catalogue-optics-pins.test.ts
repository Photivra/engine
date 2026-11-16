// SPDX-License-Identifier: Apache-2.0
/**
 * #631, #632: catalogue-lens captures and display views without `flare` or `breathing` are unchanged. The digests were recorded
 * on 2.25.0 before #631 and #632 (origin/release-2.25.0 at a3a53b80) with this file; a fisheye's `result.scene.chart` (its
 * coverage, #631) is the one intended change, so the fisheye cases pin the image and RAW only.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const sha = (data: ArrayBufferView | string): string => createHash("sha256")
  .update(typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex").slice(0, 16);
const frame = (lens: NonNullable<SimulateCaptureOptions["lens"]>, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" },
  subjectDistanceM: 3, output: { width: 48, height: 32, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 750, spectralStepNanometers: 50 }, lens,
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, ...extra });

const CASES: Record<string, { options: SimulateCaptureOptions; assumptions: boolean }> = {
  "PV 24 1.8 fast": { options: frame({ catalogue: { kind: "pv-24-1.8", fast: true }, fNumber: 1.8 }), assumptions: true },
  "PV 100 2.8 Macro Pro close, chart size": { options: frame({ catalogue: "pv-100-2.8-macro-pro", fNumber: 4 }, { subjectDistanceM: 0.3, chartSize: { widthM: 0.06 }, fast: true }), assumptions: true },
  "PV 15 2.8 Fisheye Pro exact, chart size": { options: frame({ catalogue: { kind: "pv-15-2.8-fisheye-pro", fast: false }, fNumber: 4 },
    { output: { width: 24, height: 16, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 1000, spectralStepNanometers: 100 }, chartSize: { widthM: 2 } }), assumptions: false },
  "PV 8 3.5 Fisheye Pro fast, chart size": { options: frame({ catalogue: { kind: "pv-8-3.5-fisheye-pro", fast: true } }, { chartSize: { widthM: 3 } }), assumptions: false }
};

describe("catalogue captures without flare or breathing (#631, #632)", () => {
  it("are byte-identical to 2.25.0 before #631 and #632", async () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, { options, assumptions }] of Object.entries(CASES)) {
      const r = await simulateCapture(options);
      out[name] = { samples: sha(r.image.samples as ArrayBufferView), codes: sha(r.raw.codes), ...(assumptions ? { assumptions: sha(JSON.stringify(r.assumptions)) } : {}) };
    }
    const view = await simulateDisplayView(frame({ catalogue: "pv-50-1.8", fNumber: 2.8 }), { width: 24, height: 16 });
    out["PV 50 1.8 display view"] = { samples: sha(view.image.samples as ArrayBufferView) };
    if (process.env.PIN_PRINT) console.log(JSON.stringify(out, null, 1));
    expect(out).toEqual(PINS);
  }, scaledTimeout(300_000));
});

const PINS: Record<string, Record<string, string>> = {
  "PV 24 1.8 fast": { samples: "5e02b2f4be51b560", codes: "f97541696387f501", assumptions: "6a1000e56b706ff0" },
  "PV 100 2.8 Macro Pro close, chart size": { samples: "b77ba45604470c0a", codes: "dc24930e926963f6", assumptions: "c0329abf114fc628" },
  "PV 15 2.8 Fisheye Pro exact, chart size": { samples: "f2fa557623a3be59", codes: "72979384de3ef81e" },
  "PV 8 3.5 Fisheye Pro fast, chart size": { samples: "1333add135ce336f", codes: "3f33f092ac4dd8c8" },
  "PV 50 1.8 display view": { samples: "51b018180f574ca8" }
};
