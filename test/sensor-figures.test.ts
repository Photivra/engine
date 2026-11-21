// SPDX-License-Identifier: Apache-2.0
/**
 * #615: calculateSensorFigures gives a sensor's dynamic range, per-pixel noise and mid-grey SNR at an ISO, and they agree with what
 * simulateCapture reports for the same profile and ISO.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateSensorFigures, resolveSensorProfile, simulateCapture, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("calculateSensorFigures (#615)", () => {
  it("agrees with a capture of the same profile and ISO", async () => {
    const profile = resolveSensorProfile("full-frame-24mp-bsi-2020s");
    for (const iso of [100, 800, 6400]) {
      const figures = (await calculateSensorFigures({ profile, iso })).value;
      // A different scene, size, f-number and shutter, at the grey card's standard exposure for the default illuminance:
      // 0.65·(0.18·E/π)·t/N² = 10/S gives t = 1/125 s × (11/8)² × 100/S.
      const capture = await simulateCapture({ scene: { preset: "siemens-star" }, output: { width: 8, height: 8 }, fast: false, sensor: { profile },
        exposure: { mode: "manual", iso, shutterSeconds: (1 / 125) * (11 / 8) ** 2 * 100 / iso }, lens: { fNumber: 11 } });
      const native = capture.sensor.native;
      expect(figures.dynamicRangeStops).toBe(native.dynamicRangeStops);
      expect(figures.dynamicRangeByIso).toEqual(native.dynamicRangeByIso);
      expect(figures.emva1288).toEqual(native.emva1288);
      expect(figures.readNoiseElectrons).toBe(native.readNoiseElectrons);
      expect(figures.fullWellElectrons).toBe(native.fullWellElectrons);
      expect(figures.pixelPitchMicrometers).toBe(profile.pixelPitchMicrometers);
      expect(figures.readNoise).toEqual(capture.sensor.readNoise);
      // Both at the standard exposure: the same mid-grey charge and noise components; the dark-current noise √(D·t) follows the
      // exposure time (1/125 s here, longer in the capture), so the SNR is compared with the capture's own dark term.
      const a = figures.midGrey, b = native.midGrey!;
      expect(a.signalElectrons / b.signalElectrons, String(iso)).toBeCloseTo(1, 12);
      for (const key of ["photonShot", "read", "quantization"] as const) expect(a.noiseElectrons[key] / b.noiseElectrons[key], key).toBeCloseTo(1, 12);
      expect(a.noiseElectrons.darkCurrent ** 2 / b.noiseElectrons.darkCurrent ** 2).toBeCloseTo((1 / 125) / capture.exposure.settings.shutterSeconds, 12);
      const total = Math.hypot(a.noiseElectrons.photonShot, a.noiseElectrons.read, b.noiseElectrons.darkCurrent, a.noiseElectrons.quantization);
      expect(a.signalElectrons / total / b.snr).toBeCloseTo(1, 12);
      expect(figures.normalized8Megapixel!.framePhotosites).toBe(profile.pixelsWide * profile.pixelsHigh);
      expect(figures.normalized8Megapixel!.dynamicRangeStops).toBeCloseTo(native.dynamicRangeStops + 0.5 * Math.log2(profile.pixelsWide * profile.pixelsHigh / 8e6), 12);
    }
  }, scaledTimeout(120_000));

  it("follows the model's definitions on a tier", async () => {
    const at100 = (await calculateSensorFigures({ iso: 100 })).value, at400 = (await calculateSensorFigures({ iso: 400 })).value;
    expect(at100.normalized8Megapixel).toBeNull();
    expect(at100.pixelPitchMicrometers).toBe(6);
    // The mid-grey charge at the standard exposure H = 10/S falls in proportion to 1/S.
    expect(at400.midGrey.signalElectrons * 4 / at100.midGrey.signalElectrons).toBeCloseTo(1, 12);
    // SNR = S / σ_total, σ_total = the components in quadrature, √S the shot noise.
    const m = at100.midGrey, n = m.noiseElectrons;
    expect(n.photonShot).toBeCloseTo(Math.sqrt(m.signalElectrons), 9);
    expect(n.total).toBeCloseTo(Math.hypot(n.photonShot, n.read, n.darkCurrent, n.quantization), 9);
    expect(m.snr).toBeCloseTo(m.signalElectrons / n.total, 9);
    expect(m.snrDecibels).toBeCloseTo(20 * Math.log10(m.snr), 9);
    expect(at100.exposure).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, illuminanceLux: expect.closeTo(21480.98, 1), illuminantKelvin: 6500 });
    expect(at400.dynamicRangeStops).toBeLessThan(at100.dynamicRangeStops);
    // A sensor characteristic overrides one value: halving the read noise lowers the floor.
    const quiet = (await calculateSensorFigures({ iso: 3200, characteristics: { readNoise: { lowGainElectrons: 1, highGainElectrons: 1 } } })).value;
    expect(quiet.readNoiseElectrons).toBe(1);
  }, scaledTimeout(60_000));

  it("rejects invalid input with domain errors", async () => {
    await expect(calculateSensorFigures({ iso: 0 })).rejects.toThrow(InvalidScientificInputError);
    await expect(calculateSensorFigures({ iso: 100, camera: "pocket" as never })).rejects.toThrow(InvalidConfigurationError);
    await expect(calculateSensorFigures({ iso: 100, characteristics: { readoutSeconds: 1 } as never })).rejects.toThrow(InvalidConfigurationError);
    await expect(calculateSensorFigures({ iso: 100, characteristics: 3 as never })).rejects.toThrow(InvalidConfigurationError);
    // An ISO the sensor does not have is refused by the capture's own check.
    await expect(calculateSensorFigures({ iso: 123 })).rejects.toThrow();
  });
});

describe("docs/SENSOR_PROFILES.md \"Calculated\" column (sensor-05, #701)", () => {
  const page = readFileSync("docs/SENSOR_PROFILES.md", "utf8");
  const figures = async (id?: string): Promise<string> => {
    const f = (await calculateSensorFigures(id === undefined ? { iso: 3200 } : { profile: resolveSensorProfile(id), iso: 3200 })).value;
    const base = f.dynamicRangeByIso.reduce((a, b) => (b.iso < a.iso ? b : a));
    return [base.stops, f.dynamicRangeStops, f.midGrey.snr].map((v) => v.toFixed(1)).join(" ");
  };
  it("prints what calculateSensorFigures gives at ISO 3200, to the printed precision", async () => {
    const rows = [...page.matchAll(/^\| `([a-z0-9-]+)` \|.*\| ([\d.]+) \/ ([\d.]+)(?: stops)?, SNR ([\d.]+) \|$/gm)];
    expect(rows).toHaveLength(8);
    for (const [, id, low, high, snr] of rows) expect(await figures(id), id).toBe([low, high, snr].join(" "));
    const tier = /the Professional tier gives ([\d.]+) and\s+([\d.]+) stops and an SNR of ([\d.]+)\)/.exec(page)!;
    expect(await figures()).toBe(tier.slice(1).join(" "));
  }, scaledTimeout(60_000));
});
