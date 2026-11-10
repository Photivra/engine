// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, parseDngRawImage, simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// #555 (sensor characteristics) and #535 (noise figure).
const uniform = (sensor: SimulateCaptureOptions["sensor"] = {}, extra: Partial<SimulateCaptureOptions> = {}): Promise<SimulateCaptureResult> =>
  simulateCapture({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, ...sensor }, output: { width: 16, height: 16 }, ...extra });
/** Mean and variance of the black-subtracted green-site codes (sites (1, 0) and (0, 1) of each 2 × 2 repeat) inside the output area. */
function greenStats(r: SimulateCaptureResult): { mean: number; variance: number; n: number } {
  const width = Math.round(Math.sqrt(r.raw.codes.length)), values: number[] = [];
  for (let i = 0; i < r.raw.codes.length; i++) {
    const x = i % width, y = Math.floor(i / width);
    if ((x + y) % 2 === 1) values.push(r.raw.codes[i]! - r.raw.blackLevels[i]!);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { mean, variance: values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1), n: values.length };
}
const assumption = (r: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => r.assumptions.find((a) => a.id === id)?.value;

describe("sensor characteristics (#555)", () => {
  it("leave a request without them unchanged and report the body's values", async () => {
    const r = await uniform();
    expect(assumption(r, "sensor.characteristics")).toBeUndefined();
    expect(r.sensor).toMatchObject({ pixelPitchMicrometers: 6, peakQuantumEfficiency: 0.5, fullWellElectrons: 60000, adcBitDepth: 14, fixedPatternNoise: false, readoutSeconds: 0.008,
      readNoise: { lowGainElectrons: 2, highGainElectrons: 1.1, highGainFromIso: 800 } });
    const consumer = await uniform({}, { camera: "consumer" });
    expect(consumer.sensor).toMatchObject({ fullWellElectrons: 20000, adcBitDepth: 12, readoutSeconds: 0.03, readNoise: { lowGainElectrons: 6, highGainElectrons: 2.5, highGainFromIso: 800 } });
  }, scaledTimeout(60_000));

  it("scale the collected charge with the peak QE", async () => {
    const base = await uniform(), doubled = await uniform({ peakQuantumEfficiency: 0.8 });
    expect(doubled.sensor.midGrey.signalElectrons / base.sensor.midGrey.signalElectrons).toBeCloseTo(1.6, 12);
    // The RAW signal follows (same readout): mean codes within the noise of 128 sites.
    expect(greenStats(doubled).mean / greenStats(base).mean).toBeCloseTo(1.6, 1);
    expect(assumption(doubled, "sensor.characteristics")).toMatchObject({ peakQuantumEfficiency: 0.8, chargeScale: 1, sensitivityOffsetStops: Math.log2(1.6) });
  }, scaledTimeout(60_000));

  it("link the full well to the pixel area by default and unlink it on request", async () => {
    expect((await uniform({ pixelPitchMicrometers: 3 })).sensor.fullWellElectrons).toBe(15000);
    expect((await uniform({ pixelPitchMicrometers: 3, fullWell: { electrons: 40000 } })).sensor.fullWellElectrons).toBe(10000);
    expect((await uniform({ pixelPitchMicrometers: 3, fullWell: { electrons: 40000, referencePixelPitchMicrometers: 4 } })).sensor.fullWellElectrons).toBeCloseTo(22500, 9);
    const unlinked = await uniform({ pixelPitchMicrometers: 3, fullWell: { electrons: 40000, link: "none" } });
    expect(unlinked.sensor.fullWellElectrons).toBeCloseTo(40000, 9);
    expect(assumption(unlinked, "sensor.isoAreaNormalization")).toBeUndefined();
    // Still the white level: the base-ISO white code holds that charge.
    expect(unlinked.sensor.dynamicRangeStops).toBeCloseTo(Math.log2(40000 / Math.hypot(2, unlinked.sensor.midGrey.noiseElectrons.quantization)), 2);
    const tiny = (await uniform({ pixelPitchMicrometers: 1, fullWell: { electrons: 60000, link: "none" } })).assumptions.find((a) => a.id === "sensor.characteristics")!;
    expect(tiny.explanation).toContain("Unusual for the pitch");
    await expect(uniform({ fullWell: { electrons: 40000, link: "none", referencePixelPitchMicrometers: 4 } })).rejects.toThrow(InvalidConfigurationError);
    await expect(uniform({ fullWell: { electrons: 50 } })).rejects.toThrow("sensor.fullWell.electrons must be a number from 100 to 10000000000.");
  }, scaledTimeout(60_000));

  it("set both read noises and the dual-gain switch ISO (photon transfer: dark variance)", async () => {
    // A black frame (no light) at a fixed short exposure: the dark variance is read noise² + dark shot + quantization, in codes.
    const dark = (sensor: SimulateCaptureOptions["sensor"], iso: number): Promise<SimulateCaptureResult> =>
      uniform({ ...sensor, noiseSeed: 7 }, { illuminanceLux: 1e-9, exposure: { mode: "manual", shutterSeconds: 1 / 1000, iso }, output: { width: 48, height: 48 } });
    const options = { readNoise: { lowGainElectrons: 8, highGainElectrons: 3, highGainFromIso: 400 } };
    for (const [iso, expected] of [[200, 8], [400, 3], [1600, 3]] as const) {
      const r = await dark(options, iso), s = r.sensor.midGrey.noiseElectrons;
      expect(s.read).toBe(expected);
      const regime = r.request.siteInput(1).readout as unknown as { readoutProfile: { regimes: { regimeId: string; systemConversionGainElectronsPerCode: { value: number }; adc: { digitalGain?: number } }[] }; regimeId: string };
      const found = regime.readoutProfile.regimes.find((g) => g.regimeId === regime.regimeId)!, perCode = found.systemConversionGainElectronsPerCode.value / (found.adc.digitalGain ?? 1);
      const measured = greenStats(r).variance * perCode * perCode, model = s.read ** 2 + s.darkCurrent ** 2 + s.quantization ** 2;
      // Sample variance of n normal values: relative standard error √(2/(n − 1)); allow 5 of them.
      expect(Math.abs(measured / model - 1)).toBeLessThan(5 * Math.sqrt(2 / (greenStats(r).n - 1)));
    }
    expect((await dark({ readNoise: { highGainFromIso: 1e6 } }, 1600)).sensor.readNoise).toEqual({ lowGainElectrons: 2, highGainElectrons: 2, highGainFromIso: null });
    await expect(uniform({ readNoise: { lowGainElectrons: -1 } })).rejects.toThrow(InvalidConfigurationError);
  }, scaledTimeout(60_000));

  it("set the readout time as the rolling-shutter skew", async () => {
    const r = await uniform({ readoutSeconds: 0.05 }, { motion: { shutter: "rolling" } });
    expect(assumption(r, "sensor.shutter")).toMatchObject({ kind: "electronic-rolling", lineScanSkewSeconds: 0.05 });
    expect(r.sensor.readoutSeconds).toBe(0.05);
    await expect(uniform({ readoutSeconds: 0 })).rejects.toThrow(InvalidConfigurationError);
  }, scaledTimeout(60_000));

  it("record 16-bit RAW and round-trip it through the DNG", async () => {
    const r = await uniform({ adcBitDepth: 16 }, { output: { width: 16, height: 16, format: "dng" } });
    expect(r.sensor.adcBitDepth).toBe(16);
    expect(r.raw.blackLevels[0]).toBe(4096);
    expect(Math.max(...r.raw.effectiveSaturationCodes)).toBe(65535);
    const imported = parseDngRawImage({ bytes: r.image.dng! });
    expect(imported.bitsPerSample).toBe(16);
    expect(imported.whiteLevel[0]).toBe(Math.min(...r.raw.effectiveSaturationCodes));
    expect(Array.from(imported.codes)).toEqual(Array.from(r.raw.codes));
    // The same charge reaches the same fraction of the code range as at 14 bits (to rounding and noise).
    const at14 = await uniform();
    expect(greenStats(r).mean / (65535 - 4096)).toBeCloseTo(greenStats(at14).mean / (16383 - 1024), 2);
    const at12 = await uniform({ adcBitDepth: 12 });
    expect(at12.raw.blackLevels[0]).toBe(256);
  }, scaledTimeout(60_000));

  it("apply the body's fixed-pattern noise on request, but not in the display view", async () => {
    const off = await uniform(), on = await uniform({ fixedPatternNoise: true });
    expect(Array.from(on.raw.codes)).not.toEqual(Array.from(off.raw.codes));
    expect(on.sensor.fixedPatternNoise).toBe(true);
    expect(on.sensor.midGrey.noiseElectrons.fixedPattern).toBeGreaterThan(0);
    await expect(simulateDisplayView({ scene: { preset: "uniform" }, sensor: { fixedPatternNoise: true } }, { width: 8, height: 8 })).rejects.toThrow("sensor.fixedPatternNoise");
  }, scaledTimeout(60_000));

  it("calculate the dynamic range from the full well, read noise and ADC (EMVA 1288 temporal dark noise)", async () => {
    const r = await uniform();
    const base = r.sensor.dynamicRangeByIso[0]!;
    expect(base.iso).toBe(100);
    // ISO 100: 60 000 e⁻ over 2 e⁻ and the quantization of a 60 000 / 15 359 e⁻ code.
    expect(base.stops).toBeCloseTo(Math.log2(60000 / Math.hypot(2, 60000 / 15359 / Math.sqrt(12))), 2);
    expect(r.sensor.dynamicRangeStops).toBe(base.stops);
    // A noiseless readout is ADC-limited: log2((white − black)·√12).
    const ideal = await uniform({ readNoise: { lowGainElectrons: 0 } });
    expect(ideal.sensor.dynamicRangeByIso[0]!.stops).toBeCloseTo(Math.log2(15359 * Math.sqrt(12)), 6);
    // The dual gain: ISO 800 switches to the high conversion gain (1.1 e⁻), which gains range over ISO 640 (2 e⁻).
    const at = (iso: number): number => r.sensor.dynamicRangeByIso.find((e) => e.iso === iso)!.stops;
    expect(at(800)).toBeGreaterThan(at(640));
    expect(at(1600)).toBeLessThan(at(800));
  }, scaledTimeout(60_000));

  it("run the docs/QUICK_START.md example", async () => {
    const r = await simulateCapture({ scene: { preset: "uniform" }, sensor: { pixelPitchMicrometers: 4, peakQuantumEfficiency: 0.8, fullWell: { electrons: 50_000, link: "none" },
      readNoise: { lowGainElectrons: 3, highGainElectrons: 1.2, highGainFromIso: 640 }, readoutSeconds: 0.012, adcBitDepth: 16, fixedPatternNoise: true }, output: { width: 16, height: 16 } });
    expect(r.sensor).toMatchObject({ pixelPitchMicrometers: 4, peakQuantumEfficiency: 0.8, adcBitDepth: 16, readoutSeconds: 0.012, fixedPatternNoise: true,
      readNoise: { lowGainElectrons: 3, highGainElectrons: 1.2, highGainFromIso: 640 } });
    expect(r.sensor.fullWellElectrons).toBeCloseTo(50_000, 6);
    expect(Number.isFinite(r.sensor.dynamicRangeStops) && Number.isFinite(r.sensor.midGrey.snrDecibels)).toBe(true);
  }, scaledTimeout(60_000));
});

describe("mid-grey noise figure (#535)", () => {
  it("agrees with the variance of a uniform 18 % grey patch", async () => {
    // The default request exposes the uniform 18 % chart exactly like the figure's grey patch.
    const r = await uniform({ noiseSeed: 3 }, { output: { width: 48, height: 48 } }), g = r.sensor.midGrey;
    expect(g.clipped).toBe(false);
    const regime = r.request.siteInput(1).readout as unknown as { readoutProfile: { regimes: { regimeId: string; systemConversionGainElectronsPerCode: { value: number } }[] }; regimeId: string };
    const perCode = regime.readoutProfile.regimes.find((x) => x.regimeId === regime.regimeId)!.systemConversionGainElectronsPerCode.value;
    const stats = greenStats(r);
    expect(Math.abs(stats.mean * perCode / (g.signalElectrons + g.noiseElectrons.darkCurrent ** 2) - 1)).toBeLessThan(5 * g.noiseElectrons.total / g.signalElectrons / Math.sqrt(stats.n));
    expect(Math.abs(stats.variance * perCode * perCode / g.noiseElectrons.total ** 2 - 1)).toBeLessThan(5 * Math.sqrt(2 / (stats.n - 1)));
    expect(g.snr).toBeCloseTo(g.signalElectrons / g.noiseElectrons.total, 12);
    expect(g.snrDecibels).toBeCloseTo(20 * Math.log10(g.snr), 12);
  }, scaledTimeout(60_000));

  it("changes as expected with exposure and ISO", async () => {
    const base = await uniform(), lower = await uniform({}, { illuminanceLux: 21480.98 / 4 });
    expect(base.sensor.midGrey.signalElectrons / lower.sensor.midGrey.signalElectrons).toBeCloseTo(4, 3);
    expect(base.sensor.midGrey.noiseElectrons.photonShot / lower.sensor.midGrey.noiseElectrons.photonShot).toBeCloseTo(2, 3);
    // Higher ISO at a lower light keeps the image level but lowers the SNR.
    const highIso = await uniform({}, { illuminanceLux: 21480.98 / 64, exposure: { iso: 6400 } });
    expect(highIso.sensor.midGrey.snr).toBeLessThan(base.sensor.midGrey.snr / 7);
    expect(highIso.sensor.midGrey.noiseElectrons.read).toBe(1.1);
  }, scaledTimeout(60_000));

  it("is reported by the display view too", async () => {
    const view = await simulateDisplayView({ scene: { preset: "uniform" } }, { width: 8, height: 8 }), capture = await simulateCapture({ scene: { preset: "uniform" } });
    expect(view.sensor).toEqual(capture.sensor);
  }, scaledTimeout(60_000));
});
