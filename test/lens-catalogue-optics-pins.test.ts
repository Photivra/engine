// SPDX-License-Identifier: Apache-2.0
/**
 * #631, #632: catalogue-lens captures and display views without `flare` or `breathing` are unchanged. The digests were recorded
 * on 2.25.0 before #631 and #632 (origin/release-2.25.0 at a3a53b80) with this file; a fisheye's `result.scene.chart` (its
 * coverage, #631) is the one intended change, so the fisheye cases pin the image and RAW only. 2.25.0 CI: the two `assumptions` digests
 * included two engine-dependent diagnostics (see `portable` below; CI's Linux x64 legs and macOS arm64 gave different digests), so those
 * are masked. With the masks the digests are the same on a3a53b80 (before #629, #631, #632, #633), on e225-lens-render before the optics
 * merge (2b8fcae0) and on release-2.25.0 at 8b9ff24, on arm64 and x86-64, and on Node 22.13.0, 24 and 26: no pinned output changed.
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

/**
 * The digests must not depend on the JavaScript engine or the platform, so the values below whose last bits follow the engine are taken out of
 * the exact comparison (`portable`); every other field, every sample and every RAW code stays exact.
 * - `verificationRelativeDifference` (`raw.expectedSignal`): the largest relative difference between the fast and the exact electrons at the
 *   fast method's four check sites, a difference of two computations whose last bits follow the engine's Math functions (1.34e-7 on macOS
 *   arm64, Node 24 and 26). Pinned as present, not by value.
 * - `maximumTruncatedEnergyFraction` (`lens.catalogue.character.psf`): 1 − the PSF window's energy, a rounding residue of the FFT sum when
 *   the window holds all the energy: 3.9968e-15 on arm64 (macOS and Linux, Node 24 and 26) and 4.1078e-15 on x86-64 (Node 24.1.0 under
 *   Rosetta; CI's Linux x64 legs gave the same digest, b8e6451a4c260130). Below 1e-12 it is pinned as "below 1e-12"; a real truncation
 *   (above it) stays exact.
 * - Four values computed with `**` (non-integer powers: the pupil-ratio scaling a⁴ of the spherical aberration, the PSF's pupil phase step):
 *   `sphericalWaves` and `balancingDefocusWaves` (`lens.catalogue.character.aberrationsWaves550`), `w040Micrometers`
 *   (`…bokeh.sphericalAberration`) and `maximumPhaseStepWaves` (`…psf`). Node 22's V8 rounds `x ** y` differently in the last bit
 *   (docs/DISPLAY_VIEW.md, "Same bytes in every engine"): on the PV 100 2.8 Macro Pro case 0.04874029999999998 against
 *   0.048740299999999986 (Node 24 and 26), 0.02680716499999999 against 0.026807164999999994, 0.03713128373541503 against
 *   0.037131283735415105 (CI's Node 22.13.0 digest 6c35e9e41d85cc28; arm64 Node 22.13.0 here gives the same dump). These are pinned to 12
 *   significant digits, so a change of the lens character beyond 1e-12 relative still fails; nothing else in the dumps differs.
 */
const ROUNDED = new Set(["sphericalWaves", "balancingDefocusWaves", "w040Micrometers", "maximumPhaseStepWaves"]);
const portable = (key: string, value: unknown): unknown => (key === "verificationRelativeDifference" ? "engine-dependent"
  : key === "maximumTruncatedEnergyFraction" && typeof value === "number" && Math.abs(value) < 1e-12 ? "below 1e-12"
  : ROUNDED.has(key) && typeof value === "number" ? Number(value.toPrecision(12)) : value);

describe("catalogue captures without flare or breathing (#631, #632)", () => {
  it("are byte-identical to 2.25.0 before #631 and #632", async () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, { options, assumptions }] of Object.entries(CASES)) {
      const r = await simulateCapture(options);
      out[name] = { samples: sha(r.image.samples as ArrayBufferView), codes: sha(r.raw.codes), ...(assumptions ? { assumptions: sha(JSON.stringify(r.assumptions, portable)) } : {}) };
    }
    const view = await simulateDisplayView(frame({ catalogue: "pv-50-1.8", fNumber: 2.8 }), { width: 24, height: 16 });
    out["PV 50 1.8 display view"] = { samples: sha(view.image.samples as ArrayBufferView) };
    if (process.env.PIN_PRINT) console.log(JSON.stringify(out, null, 1));
    expect(out).toEqual(PINS);
  }, scaledTimeout(300_000));
});

// 2.28.0 (#674, the catalogue PSF's exact cell integration): the samples and codes of PV 100 2.8 Macro Pro close and PV 8 3.5 Fisheye
// Pro fast, and the assumptions of PV 24 1.8 fast and PV 100 2.8 Macro Pro close (the PSF's truncated energy), the same on x64 and arm64.
// 2.28.0 (#733): the two fast cases' `assumptions` digests re-recorded: their check reads the frame's top-left and centre blocks
// (raw.expectedSignal verificationSites 8 and its text, fast.lens.catalogue gridPointsResolved); samples and codes unchanged.
const PINS: Record<string, Record<string, string>> = {
  "PV 24 1.8 fast": { samples: "5e02b2f4be51b560", codes: "f97541696387f501", assumptions: "62091c1990d54043" },
  "PV 100 2.8 Macro Pro close, chart size": { samples: "c6f792ebe95db2bd", codes: "37a3fed383b2e8e0", assumptions: "47f8eab32c639c53" },
  "PV 15 2.8 Fisheye Pro exact, chart size": { samples: "f2fa557623a3be59", codes: "72979384de3ef81e" },
  "PV 8 3.5 Fisheye Pro fast, chart size": { samples: "1c90c27c64779848", codes: "f81b2844d9a0ed4d" },
  "PV 50 1.8 display view": { samples: "51b018180f574ca8" }
};
