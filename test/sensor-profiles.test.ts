// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { GENERIC_THIRD_STOP_ISO_SETTINGS, InvalidConfigurationError, InvalidScientificInputError, SENSOR_PROFILE_IDS, SENSOR_PROFILES, resolveSensorProfile as sensorProfile, simulateCapture,
  simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { sensorProfileSaturationIso } from "../src/equipment/sensor-profiles.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// #554: the sensor profile catalogue.
const capture = (sensor: SimulateCaptureOptions["sensor"], extra: Partial<SimulateCaptureOptions> = {}): Promise<SimulateCaptureResult> =>
  simulateCapture({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, ...sensor }, output: { width: 16, height: 16 }, ...extra });
const assumption = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => r.assumptions.find((a) => a.id === id)?.value;
const markings = [32, 40, 50, 64, 80, ...GENERIC_THIRD_STOP_ISO_SETTINGS, 32000, 40000, 51200, 64000, 80000, 102400];
const NAMES = /\b(sony|canon|nikon|fuji|fujifilm|panasonic|olympus|leica|hasselblad|samsung|omnivision|apple|google|zwo|qhy|imx\d+|ov\d+)\b/i;

describe("sensor profile catalogue (#554)", () => {
  it("has the issue's eight unnamed profiles with consistent declared values", () => {
    expect(SENSOR_PROFILE_IDS).toHaveLength(8);
    expect(new Set(SENSOR_PROFILE_IDS).size).toBe(8);
    for (const p of SENSOR_PROFILES) {
      expect(JSON.stringify(p)).not.toMatch(NAMES);
      // Dimensions agree with pixels × pitch within 1.1 % (the phone's published image area is 1.0 % taller than its active pixels).
      expect(Math.abs(p.pixelsWide * p.pixelPitchMicrometers / 1000 / p.sensorWidthMm - 1)).toBeLessThan(0.011);
      expect(Math.abs(p.pixelsHigh * p.pixelPitchMicrometers / 1000 / p.sensorHeightMm - 1)).toBeLessThan(0.011);
      // The re-rated base ISO is the third-stop marking nearest S0 = 100·(η/0.5)·(A/36 µm²)·(60 000 e⁻/FW).
      const s0 = sensorProfileSaturationIso(p), nearest = markings.reduce((a, b) => Math.abs(Math.log2(b / s0)) < Math.abs(Math.log2(a / s0)) ? b : a);
      expect(p.baseIso, p.id).toBe(nearest);
      expect(Math.abs(Math.log2(s0 / p.baseIso))).toBeLessThanOrEqual(1 / 6 + 1e-9);
      // The high-gain storage holds exactly the white charge at the switch ISO.
      if (p.readNoise.highGainFromIso === null) expect(p.highGainFullWellElectrons).toBeNull();
      else expect(p.highGainFullWellElectrons).toBeCloseTo(p.fullWellElectrons * p.baseIso / p.readNoise.highGainFromIso, 6);
    }
    expect(sensorProfile("phone-50mp-stacked").adcBitDepth).toBe(12);
    expect(() => sensorProfile("full-frame")).toThrow(InvalidConfigurationError);
  });

  it.each(SENSOR_PROFILE_IDS)("%s: pitch, saturation, read noise, readout and dynamic range as declared", async (id) => {
    const p = sensorProfile(id), r = await capture({ profile: id }, { exposure: { mode: "manual", iso: p.baseIso } });
    expect(r.sensor).toMatchObject({ pixelPitchMicrometers: p.pixelPitchMicrometers, peakQuantumEfficiency: p.peakQuantumEfficiency, fullWellElectrons: p.fullWellElectrons,
      adcBitDepth: p.adcBitDepth, readoutSeconds: p.readoutSeconds, readNoise: p.readNoise.highGainFromIso === null ?
        { lowGainElectrons: p.readNoise.lowGainElectrons, highGainElectrons: p.readNoise.lowGainElectrons, highGainFromIso: null } : p.readNoise });
    // #555: the dynamic range at base ISO is full well ÷ (read noise ⊕ quantization).
    const q = r.sensor.midGrey.noiseElectrons.quantization;
    expect(r.sensor.dynamicRangeStops).toBeCloseTo(Math.log2(p.fullWellElectrons / Math.hypot(p.readNoise.lowGainElectrons, q)), 6);
    expect(q).toBeCloseTo(p.fullWellElectrons / (2 ** p.adcBitDepth - 1 - { 12: 256, 14: 1024, 16: 4096 }[p.adcBitDepth]) / Math.sqrt(12), 6);
    expect(r.sensor.dynamicRangeByIso[0]!.iso).toBe(p.baseIso);
    expect(r.sensor.dynamicRangeByIso.at(-1)!.iso).toBe(p.maximumIso);
    // The high gain's white never exceeds its storage.
    if (p.readNoise.highGainFromIso !== null) {
      const high = await capture({ profile: id }, { exposure: { mode: "manual", iso: p.readNoise.highGainFromIso, shutterSeconds: 1 / 1000 } });
      expect(high.sensor.dynamicRangeStops).toBeCloseTo(Math.log2(p.highGainFullWellElectrons! / Math.hypot(p.readNoise.highGainElectrons, high.sensor.midGrey.noiseElectrons.quantization)), 6);
    }
    expect(assumption(r, "sensor.profile")).toMatchObject({ id, baseIso: p.baseIso, fullWellElectrons: p.fullWellElectrons });
    expect(assumption(r, "sensor.isoAreaNormalization")).toBeUndefined();
  }, scaledTimeout(60_000));

  it("keeps the ISO anchor: the same exposure gives the same white-normalized signal on every profile, within the base-ISO rounding", async () => {
    const reference = await capture({}, { exposure: { mode: "manual", iso: 400 } });
    const fraction = (r: SimulateCaptureResult): number => r.sensor.midGrey.signalElectrons / (r.sensor.fullWellElectrons * (r.sensor.dynamicRangeByIso[0]!.iso / 400));
    for (const p of SENSOR_PROFILES) {
      const r = await capture({ profile: p.id }, { exposure: { mode: "manual", iso: 400 } });
      const offset = assumption(r, "sensor.profile") as { sensitivityOffsetStops: number };
      expect(Math.log2(fraction(r) / fraction(reference)), p.id).toBeCloseTo(offset.sensitivityOffsetStops, 2);
    }
  }, scaledTimeout(60_000));

  it("lets explicit characteristics override the profile and defaults the ISO into its range", async () => {
    const r = await capture({ profile: "full-frame-24mp-bsi-2020s", readNoise: { lowGainElectrons: 2 }, adcBitDepth: 16, readoutSeconds: 0.01 });
    expect(r.sensor).toMatchObject({ readNoise: { lowGainElectrons: 2, highGainElectrons: 1.1, highGainFromIso: 500 }, adcBitDepth: 16, readoutSeconds: 0.01, fullWellElectrons: 100000 });
    const sports = await capture({ profile: "full-frame-24mp-stacked-sports-2020s" });
    expect(sports.exposure.settings.iso).toBe(125);
    expect((await capture({ profile: "phone-50mp-stacked" })).exposure.settings.iso).toBe(100);
    // A pitch other than the profile's scales its full well with the area, as the tiers do from 6 µm.
    const scaled = await capture({ profile: "aps-c-26mp-bsi-2020s", pixelPitchMicrometers: 7.52 });
    expect(scaled.sensor.fullWellElectrons).toBeCloseTo(200000, 6);
    await expect(capture({ profile: "full-frame-24mp-stacked-sports-2020s" }, { exposure: { mode: "manual", iso: 100 } })).rejects.toThrow(InvalidScientificInputError);
    await expect(capture({ profile: "nope" })).rejects.toThrow("sensor.profile must be one of");
  }, scaledTimeout(60_000));

  it("uses the profile's fixed pattern on request and reaches the display view", async () => {
    const fpn = await capture({ profile: "phone-50mp-stacked", fixedPatternNoise: true });
    expect(fpn.sensor.fixedPatternNoise).toBe(true);
    expect(fpn.sensor.midGrey.noiseElectrons.fixedPattern).toBeCloseTo(Math.hypot(0.008 * fpn.sensor.midGrey.signalElectrons, 0.3 * fpn.sensor.midGrey.noiseElectrons.darkCurrent ** 2, 0.2, 0.2), 9);
    const view = await simulateDisplayView({ scene: { preset: "uniform" }, sensor: { profile: "medium-format-100mp-bsi-16bit" } }, { width: 8, height: 8 });
    expect(view.sensor).toMatchObject({ adcBitDepth: 16, fullWellElectrons: 50300, pixelPitchMicrometers: 3.76 });
  }, scaledTimeout(60_000));
});
