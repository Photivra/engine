// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { SENSOR_PROFILES, simulateCapture, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// #595 (native-photosite figures, EMVA 1288 R4.0 and the 8 MP convention) and #599 (the tiers' read noise ×√N), 2.22.0.
const capture = (sensor: SimulateCaptureOptions["sensor"] = {}, extra: Partial<SimulateCaptureOptions> = {}): Promise<SimulateCaptureResult> =>
  simulateCapture({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, ...sensor }, output: { width: 16, height: 16 }, fast: false, ...extra });
const manual = (iso: number, shutterSeconds = 1 / 125): Partial<SimulateCaptureOptions> => ({ exposure: { mode: "manual", iso, shutterSeconds } });

describe("native-photosite sensor figures (#595)", () => {
  it("equal the rendered figures at the tier's 6 µm photosite, with the EMVA 1288 R4.0 dynamic range", async () => {
    const r = await capture({}, manual(100)), n = r.sensor.native;
    expect(n).toMatchObject({ pixelPitchMicrometers: 6, photositesPerSite: 1, fullWellElectrons: 60000, readNoiseElectrons: 2 });
    expect(n.dynamicRangeStops).toBe(r.sensor.dynamicRangeStops);
    expect(n.dynamicRangeByIso).toEqual(r.sensor.dynamicRangeByIso);
    expect(n.midGrey).toEqual(r.sensor.midGrey);
    expect(n.dynamicRangeStops).toBeCloseTo(14.67, 2);
    // Eq. (27): μ_e.min = √(σ_d² + σ_q² + 1/4) + 1/2 with σ_d = 2 e⁻; Eq. (28): DR = μ_e.sat / μ_e.min.
    const floor = r.sensor.midGrey!.noiseElectrons, threshold = Math.sqrt(floor.read ** 2 + floor.quantization ** 2 + 0.25) + 0.5;
    expect(n.emva1288.absoluteSensitivityThresholdElectrons).toBeCloseTo(threshold, 12);
    expect(n.emva1288.dynamicRangeStops).toBeCloseTo(14.36, 2);
    expect(n.emva1288.dynamicRangeDecibels).toBeCloseTo(20 * Math.log10(2 ** n.emva1288.dynamicRangeStops), 10);
    expect(n.emva1288.saturationCapacityElectronsPerSquareMicrometer * 36).toBeCloseTo(threshold * 2 ** n.emva1288.dynamicRangeStops, 6);
    // The 8 MP convention: DR + ½·log₂(frame photosites / 8e6); 16 × 16 photosites here.
    expect(n.normalized8Megapixel).toMatchObject({ referencePixels: 8e6, framePhotosites: 256 });
    expect(n.normalized8Megapixel.dynamicRangeStops).toBeCloseTo(n.dynamicRangeStops + 0.5 * Math.log2(256 / 8e6), 12);
    expect(n.normalized8Megapixel.emva1288DynamicRangeStops).toBeCloseTo(n.emva1288.dynamicRangeStops + 0.5 * Math.log2(256 / 8e6), 12);
  }, scaledTimeout(60_000));

  it("keep the photosite's figures at any rendered pitch, and the rendered ones follow the binning rule", async () => {
    for (const iso of [100, 800, 6400]) {
      const six = await capture({}, manual(iso)), big = await capture({ pixelPitchMicrometers: 46.9 }, manual(iso)), n = big.sensor.native;
      const sites = (46.9 / 6) ** 2;
      expect(n.photositesPerSite).toBeCloseTo(sites, 12);
      expect(n.dynamicRangeStops).toBeCloseTo(six.sensor.dynamicRangeStops, 10);
      expect(n.emva1288).toEqual(six.sensor.native.emva1288);
      expect(n.readNoiseElectrons).toBeCloseTo(six.sensor.native.readNoiseElectrons, 12);
      expect(n.midGrey!.snr).toBeCloseTo(six.sensor.midGrey!.snr, 6);
      // Rendered: N·S₀ over √N·σ_read and the ADC step, which grows ×N in e⁻ (the same codes hold N times the charge), so DR₀ + ½·log₂N
      // until the step limits it at log₂((16383 − 1024)·√12) = 15.70 stops for 14 bits.
      const q0 = n.midGrey!.noiseElectrons.quantization, s0 = n.emva1288.saturationCapacityElectronsPerSquareMicrometer * 36;
      expect(big.sensor.dynamicRangeStops).toBeCloseTo(Math.log2(sites * s0 / Math.hypot(Math.sqrt(sites) * n.readNoiseElectrons, sites * q0)), 9);
      expect(big.sensor.dynamicRangeStops).toBeLessThanOrEqual(Math.log2((16383 - 1024) * Math.sqrt(12)) + 1e-9);
      expect(big.sensor.midGrey!.snr / n.midGrey!.snr / Math.sqrt(sites)).toBeCloseTo(1, 1);
    }
  }, scaledTimeout(120_000));

  it("use a sensor profile's own photosite", async () => {
    const profile = SENSOR_PROFILES[0]!, own = await capture({ profile }, manual(profile.baseIso));
    const binned = await capture({ profile, pixelPitchMicrometers: profile.pixelPitchMicrometers * 3 }, manual(profile.baseIso));
    expect(own.sensor.native).toMatchObject({ pixelPitchMicrometers: profile.pixelPitchMicrometers, photositesPerSite: 1, readNoiseElectrons: profile.readNoise.lowGainElectrons });
    expect(binned.sensor.native.photositesPerSite).toBeCloseTo(9, 12);
    expect(binned.sensor.native.readNoiseElectrons).toBeCloseTo(profile.readNoise.lowGainElectrons, 12);
    expect(binned.sensor.native.dynamicRangeStops).toBeCloseTo(own.sensor.dynamicRangeStops, 10);
    expect(binned.sensor.readNoise.lowGainElectrons).toBeCloseTo(3 * profile.readNoise.lowGainElectrons, 12);
  }, scaledTimeout(60_000));

  it("apply the request's characteristics at the native pitch", async () => {
    const linked = await capture({ pixelPitchMicrometers: 12, fullWell: { electrons: 40000 } });
    expect(linked.sensor.native.fullWellElectrons).toBeCloseTo(40000, 6);
    expect(linked.sensor.fullWellElectrons).toBeCloseTo(160000, 6);
    const unlinked = await capture({ pixelPitchMicrometers: 12, fullWell: { electrons: 40000, link: "none" }, readNoise: { lowGainElectrons: 3 } });
    expect(unlinked.sensor.native.fullWellElectrons).toBeCloseTo(40000, 6);
    expect(unlinked.sensor.native.readNoiseElectrons).toBe(3);
    expect(unlinked.sensor.readNoise.lowGainElectrons).toBe(3);
    expect((await capture({}, { fast: true })).sensor.native.midGrey).toBeUndefined();
  }, scaledTimeout(60_000));
});

describe("the tiers' read noise of a site that sums photosites (#599)", () => {
  it("is the photosite's ×√N above 6 µm, as for a sensor profile, and the dark frame shows it", async () => {
    const pitch = 60, scale = pitch / 6;
    const r = await capture({ pixelPitchMicrometers: pitch, noiseSeed: 7 }, { illuminanceLux: 1e-9, ...manual(6400, 1 / 1000), output: { width: 48, height: 48 } });
    expect(r.sensor.readNoise).toEqual({ lowGainElectrons: 2 * scale, highGainElectrons: 1.1 * scale, highGainFromIso: 800 });
    const s = r.sensor.midGrey!.noiseElectrons;
    expect(s.read).toBeCloseTo(1.1 * scale, 12);
    expect(r.assumptions.find((a) => a.id === "sensor.isoAreaNormalization")!.explanation).toContain("= " + scale + " (#599");
    // Photon transfer: the green dark variance in e⁻² is read² + dark shot² + quantization² (sample variance within 5 standard errors).
    const regime = r.request.siteInput(1).readout as unknown as { readoutProfile: { regimes: { regimeId: string; systemConversionGainElectronsPerCode: { value: number }; adc: { digitalGain?: number } }[] }; regimeId: string };
    const found = regime.readoutProfile.regimes.find((g) => g.regimeId === regime.regimeId)!, perCode = found.systemConversionGainElectronsPerCode.value / (found.adc.digitalGain ?? 1);
    const width = Math.round(Math.sqrt(r.raw.codes.length)), values: number[] = [];
    for (let i = 0; i < r.raw.codes.length; i++) if ((i % width + Math.floor(i / width)) % 2 === 1) values.push(r.raw.codes[i]! - r.raw.blackLevels[i]!);
    const mean = values.reduce((a, b) => a + b, 0) / values.length, variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
    expect(Math.abs(variance * perCode * perCode / (s.read ** 2 + s.darkCurrent ** 2 + s.quantization ** 2) - 1)).toBeLessThan(5 * Math.sqrt(2 / (values.length - 1)));
    // Below 6 µm the read noise stays per pixel.
    expect((await capture({ pixelPitchMicrometers: 3 })).sensor.readNoise.lowGainElectrons).toBe(2);
  }, scaledTimeout(60_000));
});
