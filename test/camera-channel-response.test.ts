// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateCameraChannelResponse, calculateChannelEffectiveDispersion, calculateLateralColorFringe, simulateCapture, InvalidScientificInputError, resolveSensorProfile } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const dispersionOf = (r: { assumptions: readonly { id: string; value: unknown }[] }): { red: number; green: number; blue: number } =>
  (r.assumptions.find((a) => a.id === "output.lensCorrections")!.value as { channelDispersion: { red: number; green: number; blue: number } }).channelDispersion;

describe("calculateCameraChannelResponse (#591)", () => {
  it("reproduces the capture's own channel dispersion for the default body and a sensor profile", async () => {
    for (const [sensor, profile] of [[{ pixelPitchMicrometers: 6 }, undefined], [{ pixelPitchMicrometers: 6, spectralStepNanometers: 10, profile: resolveSensorProfile("full-frame-24mp-bsi-2020s") }, "full-frame-24mp-bsi-2020s"]] as const) {
      const step = "spectralStepNanometers" in sensor ? sensor.spectralStepNanometers : 20;
      const illuminant = { kind: "planckian" as const, temperatureKelvin: 4200 };
      const capture = await simulateCapture({ scene: { preset: "uniform" }, illuminant, output: { width: 16, height: 16, lensCorrections: { lateralColor: true } },
        sensor, lens: { catalogue: "pv-24-1.8" }, exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } } as never);
      const helper = calculateCameraChannelResponse({ ...(profile && "profile" in sensor ? { sensorProfile: sensor.profile } : {}), spectralStepNanometers: step, illuminant }).value;
      const reported = dispersionOf(capture);
      for (const c of ["red", "green", "blue"] as const) expect(helper.channelDispersion![c], c).toBeCloseTo(reported[c], 9);
    }
  }, scaledTimeout(60_000));

  it("returns the response on the midpoint grid and agrees with calculateChannelEffectiveDispersion", () => {
    const r = calculateCameraChannelResponse({ spectralStepNanometers: 20, illuminant: { kind: "planckian", temperatureKelvin: 6500 } });
    expect(r.provenance.kind).toBe("approximation");
    expect(r.value.wavelengthsNm).toHaveLength(20);
    expect(r.value.wavelengthsNm[0]).toBe(390);
    expect(r.value.wavelengthsNm.at(-1)).toBe(770);
    for (const c of ["red", "green", "blue"] as const) for (const v of r.value[c]) expect(Number.isFinite(v) && v >= 0).toBe(true);
    // Peak electrons per joule near 2e17 (EQE about 0.5 at 555 nm: 0.5·555e-9/(h·c) = 1.40e18 per J at QE 1).
    expect(Math.max(...r.value.green)).toBeGreaterThan(1e17);
    expect(calculateCameraChannelResponse({ spectralStepNanometers: 20 }).value.channelDispersion).toBeNull();
    const light = r.value.wavelengthsNm.map(() => 1);
    const flat = calculateCameraChannelResponse({ spectralStepNanometers: 20 }).value;
    const direct = calculateChannelEffectiveDispersion({ wavelengthsNm: flat.wavelengthsNm, channelResponse: { red: flat.red, green: flat.green, blue: flat.blue }, illuminant: light }).value;
    expect(direct.blue).toBeGreaterThan(direct.green);
    // A profile's peak QE only scales the response: the dispersion is unchanged.
    const scaled = calculateCameraChannelResponse({ peakQuantumEfficiency: 0.8, spectralStepNanometers: 20, illuminant: { kind: "planckian", temperatureKelvin: 6500 } }).value;
    expect(scaled.green[5]! / r.value.green[5]!).toBeCloseTo(1.6, 12);
    expect(scaled.channelDispersion!.blue).toBeCloseTo(r.value.channelDispersion!.blue, 12);
    // Feeds the calculator's fringe: the full-quality 5 nm default.
    const fine = calculateCameraChannelResponse({ illuminant: { kind: "planckian", temperatureKelvin: 6500 } }).value;
    expect(fine.wavelengthsNm).toHaveLength(80);
    const fringe = calculateLateralColorFringe({ lensId: "pv-24-1.8", activeImagingArea: { widthMm: 36, heightMm: 24 }, pixelPitchMicrometers: 6, channelDispersion: fine.channelDispersion! }).value;
    expect(Number.isFinite(fringe.blueMinusRedPixels.x)).toBe(true);
  });

  it("refuses bad input", () => {
    for (const bad of [{ spectralStepNanometers: 0 }, { spectralStepNanometers: 101 }, { peakQuantumEfficiency: 0 }, { peakQuantumEfficiency: 1.2 }, { extra: 1 }])
      expect(() => calculateCameraChannelResponse(bad as never)).toThrow();
    expect(() => calculateCameraChannelResponse({ sensorProfile: { peakQuantumEfficiency: 2 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateCameraChannelResponse({ sensorProfile: "nope" as never })).toThrow();
    expect(() => calculateCameraChannelResponse({ spectralStepNanometers: NaN })).toThrow(InvalidScientificInputError);
  });
});
