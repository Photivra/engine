// SPDX-License-Identifier: Apache-2.0
/**
 * #635–#638: captures without the new behaviour are byte-identical. The digests were recorded on 2.25.0 before these issues
 * (origin/release-2.25.0 at 087dc6f3) with this file: a profile at its own pitch with the fixed pattern, a phone lens on the phone
 * profile (the frame now comes from `sensorProfileFrame`), a profile's downsized view, and tiers with a full well, read noise and the
 * fixed pattern (the full well's default reference and the density note change only with a profile). Their images, RAW codes and
 * assumptions are pinned (no fast catalogue method here, whose run-time check has engine-dependent last bits).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveSensorProfile, simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const sha = (data: ArrayBufferView | string): string => createHash("sha256")
  .update(typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex").slice(0, 16);
const base = (sensor: NonNullable<SimulateCaptureOptions["sensor"]>, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" },
  output: { width: 32, height: 24, format: "srgb-16" }, sensor: { spectralStepNanometers: 50, ...sensor }, exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 400 }, fast: false, ...extra });

const CASES: Record<string, SimulateCaptureOptions> = {
  "full frame BSI at its own pitch, fixed pattern": base({ profile: resolveSensorProfile("full-frame-24mp-bsi-2020s"), fixedPatternNoise: true }),
  "phone profile, PV 77 2.8 Phone (exact)": base({ profile: resolveSensorProfile("phone-50mp-stacked") }, { lens: { catalogue: { kind: "pv-77-2.8-phone", fast: false } } }),
  "APS-C BSI downsized view, read noise": base({ profile: resolveSensorProfile("aps-c-26mp-bsi-2020s"), pixelPitchMicrometers: 30, readNoise: { lowGainElectrons: 2 } }),
  "professional tier, linked full well at 4 µm": base({ pixelPitchMicrometers: 4, fullWell: { electrons: 70000 } }),
  "consumer tier, unlinked full well, fixed pattern": base({ pixelPitchMicrometers: 12, fullWell: { electrons: 50000, link: "none" }, fixedPatternNoise: true }, { camera: "consumer" })
};

describe("sensor profile captures without the new options (#635–#638)", () => {
  it("are byte-identical to 2.25.0 before #635–#638", async () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, options] of Object.entries(CASES)) {
      const r = await simulateCapture(options);
      out[name] = { image: sha(r.image.samples), raw: sha(r.raw.codes), assumptions: sha(JSON.stringify(r.assumptions)), sensor: sha(JSON.stringify(r.sensor)) };
    }
    expect(out).toEqual(PINS);
  }, scaledTimeout(240_000));
});

// 2.28.0 (#674, the catalogue PSF's exact cell integration): the phone profile's raw and assumptions re-pinned (x64 and arm64).
// 2.28.0 (facade-06 in #730): the assumptions digests re-recorded for the corrected assumption texts; image, RAW and sensor digests unchanged.
const PINS: Record<string, Record<string, string>> = {
  "APS-C BSI downsized view, read noise": { assumptions: "074935b990c754b1", image: "de83810a3d0a4515", raw: "1da6b6c6c314da23", sensor: "a3dc1ff54903f12e" },
  "consumer tier, unlinked full well, fixed pattern": { assumptions: "43d532377a0795b4", image: "1a33a0327f794d39", raw: "956453b3cc103cd7", sensor: "69b84d219a6bb2b5" },
  "full frame BSI at its own pitch, fixed pattern": { assumptions: "7cd5b16f3be3de44", image: "976c7d57f7b67e75", raw: "f4d62a2d4a2b8dfb", sensor: "abb6a7221566586e" },
  "phone profile, PV 77 2.8 Phone (exact)": { assumptions: "ce95a7c0cda962a0", image: "d397edef4cf4719a", raw: "8cb84c7d309241b3", sensor: "1a7e39d2d106344f" },
  "professional tier, linked full well at 4 µm": { assumptions: "a669c211248f2264", image: "7c2444652f117a2b", raw: "8a738e421ef932c9", sensor: "139a6eefca301330" }
};
