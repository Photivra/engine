// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { GENERIC_THIRD_STOP_ISO_SETTINGS, InvalidConfigurationError, InvalidScientificInputError, SENSOR_PROFILE_IDS, SENSOR_PROFILES, resolveSensorProfile as sensorProfile, simulateCapture,
  simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { sensorProfileSaturationIso } from "../src/equipment/sensor-profile-body.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// #554: the sensor profile catalogue.
// fast: false, the calculator's full quality: the mid-gray noise figure (result.sensor.midGrey) is computed on exact requests (2.20.0).
const capture = (sensor: SimulateCaptureOptions["sensor"], extra: Partial<SimulateCaptureOptions> = {}): Promise<SimulateCaptureResult & { sensor: { midGrey: NonNullable<SimulateCaptureResult["sensor"]["midGrey"]> } }> =>
  simulateCapture({ scene: { preset: "uniform" }, fast: false, sensor: { spectralStepNanometers: 100, ...sensor }, output: { width: 16, height: 16 }, ...extra }) as never;
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
    const p = sensorProfile(id), r = await capture({ profile: p }, { exposure: { mode: "manual", iso: p.baseIso } });
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
      const high = await capture({ profile: p }, { exposure: { mode: "manual", iso: p.readNoise.highGainFromIso, shutterSeconds: 1 / 1000 } });
      expect(high.sensor.dynamicRangeStops).toBeCloseTo(Math.log2(p.highGainFullWellElectrons! / Math.hypot(p.readNoise.highGainElectrons, high.sensor.midGrey.noiseElectrons.quantization)), 6);
    }
    expect(assumption(r, "sensor.profile")).toMatchObject({ id, baseIso: p.baseIso, fullWellElectrons: p.fullWellElectrons });
    expect(assumption(r, "sensor.isoAreaNormalization")).toBeUndefined();
  }, scaledTimeout(60_000));

  it("keeps the ISO anchor: the same exposure gives the same white-normalized signal on every profile, within the base-ISO rounding", async () => {
    const reference = await capture({}, { exposure: { mode: "manual", iso: 400 } });
    const fraction = (r: SimulateCaptureResult): number => r.sensor.midGrey!.signalElectrons / (r.sensor.fullWellElectrons * (r.sensor.dynamicRangeByIso[0]!.iso / 400));
    for (const p of SENSOR_PROFILES) {
      const r = await capture({ profile: p }, { exposure: { mode: "manual", iso: 400 } });
      const offset = assumption(r, "sensor.profile") as { sensitivityOffsetStops: number };
      expect(Math.log2(fraction(r) / fraction(reference)), p.id).toBeCloseTo(offset.sensitivityOffsetStops, 2);
    }
  }, scaledTimeout(60_000));

  it("lets explicit characteristics override the profile and defaults the ISO into its range", async () => {
    const r = await capture({ profile: sensorProfile("full-frame-24mp-bsi-2020s"), readNoise: { lowGainElectrons: 2 }, adcBitDepth: 16, readoutSeconds: 0.01 });
    expect(r.sensor).toMatchObject({ readNoise: { lowGainElectrons: 2, highGainElectrons: 1.1, highGainFromIso: 500 }, adcBitDepth: 16, readoutSeconds: 0.01, fullWellElectrons: 100000 });
    const sports = await capture({ profile: sensorProfile("full-frame-24mp-stacked-sports-2020s") });
    expect(sports.exposure.settings.iso).toBe(125);
    expect((await capture({ profile: sensorProfile("phone-50mp-stacked") })).exposure.settings.iso).toBe(100);
    // A pitch other than the profile's scales its full well with the area, as the tiers do from 6 µm.
    const scaled = await capture({ profile: sensorProfile("aps-c-26mp-bsi-2020s"), pixelPitchMicrometers: 7.52 });
    expect(scaled.sensor.fullWellElectrons).toBeCloseTo(200000, 6);
    await expect(capture({ profile: sensorProfile("full-frame-24mp-stacked-sports-2020s") }, { exposure: { mode: "manual", iso: 100 } })).rejects.toThrow(InvalidScientificInputError);
    expect(() => sensorProfile("nope")).toThrow("resolveSensorProfile: the id must be one of");
  }, scaledTimeout(60_000));

  it("uses the profile's fixed pattern on request and reaches the display view", async () => {
    const fpn = await capture({ profile: sensorProfile("phone-50mp-stacked"), fixedPatternNoise: true });
    expect(fpn.sensor.fixedPatternNoise).toBe(true);
    expect(fpn.sensor.midGrey.noiseElectrons.fixedPattern).toBeCloseTo(Math.hypot(0.008 * fpn.sensor.midGrey.signalElectrons, 0.3 * fpn.sensor.midGrey.noiseElectrons.darkCurrent ** 2, 0.2, 0.2), 9);
    const view = await simulateDisplayView({ scene: { preset: "uniform" }, sensor: { profile: sensorProfile("medium-format-100mp-bsi-16bit") } }, { width: 8, height: 8 });
    expect(view.sensor).toMatchObject({ adcBitDepth: 16, fullWellElectrons: 50300, pixelPitchMicrometers: 3.76 });
  }, scaledTimeout(60_000));
});

describe("sensor profile records (#554)", () => {
  const phone = sensorProfile("phone-50mp-stacked");
  it("are checked strictly: unknown and missing fields, ranges, ISO markings and the dual-gain fields", async () => {
    const bad = async (profile: unknown, message: string | RegExp): Promise<void> => {
      await expect(capture({ profile: profile as never })).rejects.toThrow(message);
      await expect(capture({ profile: profile as never })).rejects.toThrow(InvalidConfigurationError);
    };
    await bad("phone-50mp-stacked", "sensor.profile must be an object.");
    await bad({ ...phone, maker: "x" }, "Unknown sensor.profile field: maker.");
    const missing: Record<string, unknown> = { ...phone };
    delete missing.readoutSeconds;
    await bad(missing, "sensor.profile.readoutSeconds is required.");
    await bad({ ...phone, fullWellElectrons: 50 }, "sensor.profile.fullWellElectrons must be a number from 100 to 10000000000.");
    await bad({ ...phone, peakQuantumEfficiency: Number.NaN }, "sensor.profile.peakQuantumEfficiency");
    await bad({ ...phone, baseIso: 42 }, "sensor.profile.baseIso");
    await bad({ ...phone, baseIso: 12800 }, "baseIso must not exceed maximumIso");
    await bad({ ...phone, pixelsWide: 8192.5 }, "whole numbers");
    await bad({ ...phone, adcBitDepth: 10 }, "sensor.profile.adcBitDepth");
    await bad({ ...phone, readNoise: { ...phone.readNoise, extra: 1 } }, "Unknown sensor.profile.readNoise field: extra.");
    await bad({ ...phone, highGainFullWellElectrons: null }, "dual-gain switch");
    await bad({ ...phone, readNoise: { ...phone.readNoise, highGainFromIso: 40 } }, "dual-gain switch");
    await bad({ ...phone, fixedPattern: { ...phone.fixedPattern, prnu: 2 } }, "sensor.profile.fixedPattern.prnu");
    await bad({ ...phone, goodFor: [42] }, "sensor.profile.goodFor is invalid.");
    await bad({ ...phone, provenance: { fullWellElectrons: 1 } }, "sensor.profile.provenance");
    await bad({ ...phone, fixedLenses: "tele" }, "sensor.profile.fixedLenses must be null or phone.");
  }, scaledTimeout(60_000));

  it("accept a caller's modified copy, re-rated by the same rule", async () => {
    const custom = { ...phone, id: "my-phone", fullWellElectrons: 6000, highGainFullWellElectrons: 1500 };
    const r = await capture({ profile: custom }, { exposure: { mode: "manual", iso: 40 } });
    expect(r.sensor.fullWellElectrons).toBe(6000);
    expect((assumption(r, "sensor.profile") as { sensitivityOffsetStops: number }).sensitivityOffsetStops).toBeCloseTo(Math.log2(sensorProfileSaturationIso(custom) / 40), 12);
  }, scaledTimeout(60_000));
});

describe("the phone profile's fixed lenses (#554)", () => {
  const phone = sensorProfile("phone-50mp-stacked");
  const lensed = (lens: NonNullable<SimulateCaptureOptions["lens"]>, profile?: typeof phone): Promise<SimulateCaptureResult> =>
    simulateCapture({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, ...(profile ? { profile } : {}) }, output: { width: 96, height: 96 }, lens, fast: true });
  it("render on the phone profile at their fixed apertures, and only there", async () => {
    for (const [id, n] of [["pv-13-2.2-phone", 2.2], ["pv-24-1.8-phone", 1.8], ["pv-77-2.8-phone", 2.8]] as const) {
      const r = await lensed({ catalogue: id, fNumber: n }, phone);
      expect(assumption(r, "lens.catalogue")).toMatchObject({ lensId: id, set: "phone", widestFNumber: n, narrowestFNumber: n });
      expect(r.exposure.settings.fNumber).toBe(n);
    }
    // Without an f-number the fixed aperture is used, and program mode keeps it.
    expect((await lensed({ catalogue: "pv-24-1.8-phone" }, phone)).exposure.settings.fNumber).toBe(1.8);
    expect((await simulateCapture({ scene: { preset: "uniform" }, sensor: { spectralStepNanometers: 100, profile: phone }, output: { width: 96, height: 96 }, fast: true,
      lens: { catalogue: "pv-77-2.8-phone" }, exposure: { mode: "program" } })).exposure.settings.fNumber).toBe(2.8);
    await expect(lensed({ catalogue: "pv-24-1.8-phone", fNumber: 1.8 })).rejects.toThrow("the phone lenses go only with a phone sensor.profile");
    await expect(lensed({ catalogue: "pv-24-1.8", fNumber: 1.8 }, phone)).rejects.toThrow("which takes only them");
    await expect(lensed({ catalogue: "pv-24-1.8-phone", fNumber: 2.8 }, phone)).rejects.toThrow(InvalidConfigurationError);
    await expect(lensed({ catalogue: "pv-24-1.8-phone", fNumber: 1.8 }, sensorProfile("full-frame-24mp-bsi-2020s"))).rejects.toThrow("the phone lenses go only");
  }, scaledTimeout(60_000));
});

describe("catalogue lenses framed on a profile's sensor (#554)", () => {
  const view = (r: { assumptions: readonly { id: string; value: unknown }[] }): Record<string, unknown> => assumption(r, "sensor.profileView") as Record<string, unknown>;
  const lensOf = (r: { assumptions: readonly { id: string; value: unknown }[] }): { focalLengthMm: number; cropFactor35Mm: number } => assumption(r, "lens.catalogue") as never;
  it("resolve the lens on the whole sensor and capture its largest centred region of the output's aspect", async () => {
    const phone = sensorProfile("phone-50mp-stacked");
    const r = await simulateCapture({ scene: { preset: "uniform" }, sensor: { profile: phone, spectralStepNanometers: 100 }, output: { width: 64, height: 48 }, lens: { catalogue: "pv-24-1.8-phone" }, fast: true });
    const crop = Math.hypot(36, 24) / Math.hypot(phone.sensorWidthMm, phone.sensorHeightMm);
    expect(lensOf(r).cropFactor35Mm).toBeCloseTo(crop, 9);
    expect(lensOf(r).focalLengthMm).toBeCloseTo(24 / crop, 9);
    // 64:48 is wider than the sensor's 9.844:7.431, so the width fills it and the height is cropped.
    const pitch = phone.sensorWidthMm / 64 * 1000;
    expect(view(r)).toMatchObject({ croppedSensorAxis: "height", lensFramedOnSensor: true, frameWidthMm: phone.sensorWidthMm, photositesPerSite: (pitch / phone.pixelPitchMicrometers) ** 2 });
    expect(view(r).pixelPitchMicrometers).toBeCloseTo(pitch, 9);
    expect(view(r).frameHeightMm as number).toBeLessThan(phone.sensorHeightMm);
    // A site sums its photosites: the full well by the area, the read noise in quadrature.
    const scale = pitch / phone.pixelPitchMicrometers;
    expect(r.sensor.fullWellElectrons).toBeCloseTo(phone.fullWellElectrons * scale * scale, 3);
    expect(r.sensor.readNoise.lowGainElectrons).toBeCloseTo(phone.readNoise.lowGainElectrons * scale, 9);
  }, scaledTimeout(60_000));

  it("crop the width for a narrower output, keep the focal length, and agree between the exact, fast and display-view paths", async () => {
    const ff = sensorProfile("full-frame-24mp-bsi-2020s");
    const options: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, sensor: { profile: ff, spectralStepNanometers: 80 }, output: { width: 48, height: 48 }, lens: { catalogue: "pv-50-1.8", fNumber: 4 } };
    const exact = await simulateCapture(options), fast = await simulateCapture({ ...options, fast: true });
    expect(view(exact)).toMatchObject({ croppedSensorAxis: "width", frameHeightMm: ff.sensorHeightMm });
    expect(lensOf(exact).focalLengthMm).toBeCloseTo(50 / (Math.hypot(36, 24) / Math.hypot(ff.sensorWidthMm, ff.sensorHeightMm)), 9);
    expect(view(fast)).toEqual(view(exact));
    const mean = (r: SimulateCaptureResult): number => r.raw.codes.reduce((a, c, i) => a + c - r.raw.blackLevels[i]!, 0) / r.raw.codes.length;
    expect(mean(fast) / mean(exact)).toBeCloseTo(1, 2);
    const display = await simulateDisplayView(options, { width: 12, height: 12 });
    expect(view(display)).toEqual(view(exact));
    expect(display.sensor).toEqual(exact.sensor);
  }, scaledTimeout(60_000));

  it("take an explicit pitch as a centred crop, refuse a frame beyond the sensor and the fixed pattern on a downsized view", async () => {
    const ff = sensorProfile("full-frame-24mp-bsi-2020s");
    const crop = await simulateCapture({ scene: { preset: "uniform" }, sensor: { profile: ff, pixelPitchMicrometers: 5.94, spectralStepNanometers: 100 }, output: { width: 48, height: 32 }, lens: { catalogue: "pv-50-1.8", fNumber: 4 }, fast: true });
    expect(view(crop)).toMatchObject({ croppedSensorAxis: "width", photositesPerSite: 1, readNoiseScale: 1 });
    expect(lensOf(crop).focalLengthMm).toBeCloseTo(50 / (Math.hypot(36, 24) / Math.hypot(ff.sensorWidthMm, ff.sensorHeightMm)), 9);
    await expect(simulateCapture({ scene: { preset: "uniform" }, sensor: { profile: ff, pixelPitchMicrometers: 900 }, output: { width: 48, height: 32 }, lens: { catalogue: "pv-50-1.8" } }))
      .rejects.toThrow("makes the frame larger than the profile's");
    await expect(capture({ profile: ff, fixedPatternNoise: true, pixelPitchMicrometers: 12 })).rejects.toThrow("sensor.fixedPatternNoise needs the profile's own pixel pitch");
  }, scaledTimeout(60_000));
});
