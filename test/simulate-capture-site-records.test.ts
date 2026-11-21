// SPDX-License-Identifier: Apache-2.0
/**
 * #722: the nested site records that do not depend on the site are built once per capture and shared, frozen, by every site's
 * input, so the lean executor's strict comparison with its template finds the same objects. The records keep today's values, the
 * environment-chain captures keep their samples and the lean executor's site counts are unchanged.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { nativeEnvironmentLeanStatistics } from "../src/capture/native-environment-lean.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Site = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sha = (a: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
const PAN: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, motion: { angularVelocityRadPerSec: { yaw: 0.05 } }, output: { width: 48, height: 32 } };
const SHAKE: SimulateCaptureOptions = { ...PAN, motion: { handheld: {} } };

describe("site records shared across sites (#722)", () => {
  it("shares the site-independent records between sites, frozen, with today's values", async () => {
    const capture = await simulateCapture(PAN);
    const a = capture.request.siteInput(0) as Site, b = capture.request.siteInput(2) as Site, other = capture.request.siteInput(49) as Site;
    const shared = (s: Site): unknown[] => [s.darkCurrentProfile.uncertainty, s.darkCurrentProfile.temperatureModel, s.readout.capacityProfile.uncertainty,
      s.readout.capacityProfile.operatingState, s.readout.capacityProfile.temperatureApplicability, s.charge.completenessProfile.includedAdditionalComponentIds];
    shared(a).forEach((record, i) => {
      expect(shared(b)[i], "record " + i).toBe(record);
      expect(shared(other)[i], "record " + i + " on another channel").toBe(record);
      expect(Object.isFrozen(record), "record " + i).toBe(true);
    });
    // Sites 0 and 2 are red, site 49 (row 1, column 1) is blue: the response application is per channel.
    expect(b.environment.sensor.responseApplication).toBe(a.environment.sensor.responseApplication);
    expect(other.environment.sensor.responseApplication).not.toBe(a.environment.sensor.responseApplication);
    expect(Object.isFrozen(a.environment.sensor.responseApplication)).toBe(true);
    expect(() => { (a.darkCurrentProfile.uncertainty as Record<string, unknown>).limitation = "changed"; }).toThrow(TypeError);
    // The records' values: recorded at e228-int 8405ae2, before the change (JSON of four sites' inputs).
    expect(createHash("sha256").update(JSON.stringify([0, 2, 49, 1535].map((i) => capture.request.siteInput(i)))).digest("hex"))
      .toBe("7ffc80ad0fdd37ca0117dacac03753ffae56df8fbc25a5212dbe8c3aa5172b58");
  }, scaledTimeout(60_000));

  it("keeps the samples and the lean executor's site counts of a pan and of hand shake", async () => {
    // Recorded at e228-int 8405ae2, before the change.
    const LOCKS = { pan: "ae5474bec78ecbcac179d3de1a2fe793636fabe3d4f585a7b26ffe63b9b04664", shake: "e4e11b629d807f7701a5bd14a8653b75220e231c0d6b26c8fc5ee55858eaff37" };
    for (const [name, options] of [["pan", PAN], ["shake", SHAKE]] as const) {
      const before = { ...nativeEnvironmentLeanStatistics };
      const capture = await simulateCapture(options);
      expect(sha(capture.image.samples), name).toBe(LOCKS[name]);
      expect(nativeEnvironmentLeanStatistics.executedSites - before.executedSites, name).toBe(1696);
      expect(nativeEnvironmentLeanStatistics.sensorSites - before.sensorSites, name).toBe(1600);
    }
  }, scaledTimeout(120_000));
});
