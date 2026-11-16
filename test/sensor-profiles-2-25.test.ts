// SPDX-License-Identifier: Apache-2.0
/**
 * 2.25.0 sensor profile work: each profile's ISO list (#635), framing the phone profile's lenses (#636), the fixed pattern on a
 * site that sums photosites (#637) and the full well's reference and density note with a profile (#638).
 */
import { describe, expect, it } from "vitest";
import { calculateChartFraming, calculateSensorFigures, calculateSensorFixedPatternSite, calculateSensorProfileFrame, calculateSubjectDistanceForFraming, InvalidConfigurationError,
  resolveGenericLens, resolveSensorProfile, resolveSensorProfileIsoSettings, SENSOR_PROFILE_ISO_MARKINGS, SENSOR_PROFILES, simulateCapture, type SensorFixedPatternNoiseProfile,
  type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { sumFixedPatternSites } from "../src/sensor/fixed-pattern-noise.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const assumption = (r: { assumptions: readonly { id: string; value?: unknown; explanation?: string }[] }, id: string): { value: unknown; explanation: string } | undefined =>
  r.assumptions.find((a) => a.id === id) as never;
const uniform = (sensor: NonNullable<SimulateCaptureOptions["sensor"]>, extra: Partial<SimulateCaptureOptions> = {}): Promise<SimulateCaptureResult> =>
  simulateCapture({ scene: { preset: "uniform" }, output: { width: 16, height: 12 }, sensor: { spectralStepNanometers: 100, ...sensor }, fast: true,
    exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 100 }, ...extra });
const phone = resolveSensorProfile("phone-50mp-stacked");
const PHONE_LENSES = ["pv-13-2.2-phone", "pv-24-1.8-phone", "pv-77-2.8-phone"] as const;

describe("each sensor profile's ISO list (#635)", () => {
  it("is the third-stop markings from its base ISO to its maximum, frozen", () => {
    expect(SENSOR_PROFILE_ISO_MARKINGS[0]).toBe(32);
    expect(SENSOR_PROFILE_ISO_MARKINGS.at(-1)).toBe(102400);
    expect(Object.isFrozen(SENSOR_PROFILE_ISO_MARKINGS)).toBe(true);
    for (const p of SENSOR_PROFILES) {
      const list = resolveSensorProfileIsoSettings(p);
      expect(Object.isFrozen(list)).toBe(true);
      expect(list[0], p.id).toBe(p.baseIso);
      expect(list.at(-1), p.id).toBe(p.maximumIso);
      expect(list).toEqual(SENSOR_PROFILE_ISO_MARKINGS.filter((iso) => iso >= p.baseIso && iso <= p.maximumIso));
    }
    expect(resolveSensorProfileIsoSettings(phone)).toEqual([40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400]);
    expect(() => resolveSensorProfileIsoSettings({ ...phone, baseIso: 33 })).toThrow(InvalidConfigurationError);
  });

  it("are the ISO settings a capture takes with the profile", async () => {
    const list = resolveSensorProfileIsoSettings(phone);
    for (const iso of [list[0]!, list[8]!, list.at(-1)!]) expect((await uniform({ profile: phone }, { exposure: { mode: "manual", iso, shutterSeconds: 1 / 100 } })).exposure.settings.iso).toBe(iso);
    await expect(uniform({ profile: phone }, { exposure: { mode: "manual", iso: 32, shutterSeconds: 1 / 100 } })).rejects.toThrow();
    await expect(uniform({ profile: phone }, { exposure: { mode: "manual", iso: 8000, shutterSeconds: 1 / 100 } })).rejects.toThrow();
  }, scaledTimeout(60_000));
});

describe("framing the phone profile's lenses (#636)", () => {
  it("resolves the three phone lenses by id", () => {
    for (const id of PHONE_LENSES) {
      const lens = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: phone.sensorWidthMm, heightMm: phone.sensorHeightMm } });
      expect(lens).toMatchObject({ lensId: id, set: "phone" });
    }
  });

  it("gives the capture's frame (sensor.profileView) before a capture", async () => {
    for (const [width, height] of [[96, 64], [64, 64], [80, 60]] as const) {
      for (const id of PHONE_LENSES) {
        const r = await simulateCapture({ scene: { preset: "uniform" }, output: { width, height }, sensor: { profile: phone, spectralStepNanometers: 100 }, lens: { catalogue: id }, fast: true });
        expect(calculateSensorProfileFrame({ profile: phone, width, height, catalogueLens: true }).value).toEqual(assumption(r, "sensor.profileView")!.value);
      }
    }
    // An explicit pitch, and a profile without a catalogue lens (output × pitch).
    const crop = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 48, height: 32 }, sensor: { profile: phone, pixelPitchMicrometers: 10, spectralStepNanometers: 100 },
      lens: { catalogue: "pv-24-1.8-phone" }, fast: true });
    expect(calculateSensorProfileFrame({ profile: phone, width: 48, height: 32, pixelPitchMicrometers: 10, catalogueLens: true }).value).toEqual(assumption(crop, "sensor.profileView")!.value);
    const plain = await uniform({ profile: phone, pixelPitchMicrometers: 4 });
    expect(calculateSensorProfileFrame({ profile: phone, width: 16, height: 12, pixelPitchMicrometers: 4 }).value).toEqual(assumption(plain, "sensor.profileView")!.value);
    expect(calculateSensorProfileFrame({ profile: phone, width: 16, height: 12 }).value).toMatchObject({ pixelPitchMicrometers: 1.197, photositesPerSite: 1, croppedSensorAxis: null });
    expect(() => calculateSensorProfileFrame({ profile: phone, width: 48, height: 32, pixelPitchMicrometers: 900, catalogueLens: true })).toThrow("larger than the profile's sensor");
    expect(() => calculateSensorProfileFrame({ profile: phone, width: 4.5, height: 32 })).toThrow(InvalidConfigurationError);
    expect(() => calculateSensorProfileFrame({ profile: phone, width: 4, height: 3, catalogueLens: "yes" as never })).toThrow("catalogueLens must be a boolean");
  }, scaledTimeout(120_000));

  it("frames a chart as the capture renders it, with the lens on the whole sensor", async () => {
    const output = { width: 96, height: 64 };
    for (const id of PHONE_LENSES) {
      const fit = calculateSubjectDistanceForFraming({ sensorProfile: { profile: phone, ...output }, catalogue: id, chart: { widthM: 0.5 } });
      const lens = resolveGenericLens({ lensId: id, activeImagingArea: { widthMm: phone.sensorWidthMm, heightMm: phone.sensorHeightMm } });
      expect(fit.focalLengthMm).toBe(lens.focalLengthMm);
      expect(fit.cropFactor35Mm).toBe(lens.cropFactor35Mm);
      expect(fit.equivalentFocalLengthMm).toBe(Number(id.split("-")[1]));
      expect(fit.coverage.frameWidthFraction).toBeCloseTo(1, 9);
      expect(fit.assumptions.find((a) => a.id === "sensor.profileView")?.value).toEqual(calculateSensorProfileFrame({ profile: phone, ...output, catalogueLens: true }).value);
      const r = await simulateCapture({ scene: { preset: "uniform" }, output, sensor: { profile: phone, spectralStepNanometers: 100 }, lens: { catalogue: id }, fast: true,
        subjectDistanceM: fit.subjectDistanceM, chartSize: { widthM: 0.5 } });
      const chart = r.scene.chart!;
      expect(chart.frameWidthFraction).toBeCloseTo(1, 9);
      const at = calculateChartFraming({ sensorProfile: { profile: phone, ...output }, catalogue: id, chart: { widthM: 0.5 }, subjectDistanceM: fit.subjectDistanceM });
      expect(at.coverage.frameWidthFraction).toBeCloseTo(chart.frameWidthFraction, 12);
      expect(at.coverage.frameHeightFraction).toBeCloseTo(chart.frameHeightFraction, 12);
      expect(at.magnification).toBeCloseTo(chart.magnification, 12);
    }
  }, scaledTimeout(120_000));

  it("keeps the phone lenses to the phone profile, and the plain sensor input unchanged", () => {
    const chart = { widthM: 1 };
    expect(() => calculateSubjectDistanceForFraming({ sensorProfile: { profile: resolveSensorProfile("full-frame-24mp-bsi-2020s"), width: 96, height: 64 }, catalogue: "pv-24-1.8-phone", chart }))
      .toThrow("the phone lenses go only with a phone sensorProfile");
    expect(() => calculateSubjectDistanceForFraming({ sensorProfile: { profile: phone, width: 96, height: 64 }, catalogue: "pv-24-1.8", chart })).toThrow("which takes only them");
    expect(() => calculateSubjectDistanceForFraming({ sensor: { widthMm: 36, heightMm: 24 }, sensorProfile: { profile: phone, width: 96, height: 64 }, equivalentFocalLengthMm: 50, chart }))
      .toThrow("Give exactly one of sensor and sensorProfile");
    expect(() => calculateSubjectDistanceForFraming({ sensorProfile: { profile: phone, width: 96, height: 64, extra: 1 } as never, equivalentFocalLengthMm: 50, chart }))
      .toThrow('sensorProfile input has unknown field "extra"');
    // Without a catalogue lens the frame is output × the profile's pitch, as for lens.prime.
    const prime = calculateSubjectDistanceForFraming({ sensorProfile: { profile: phone, width: 96, height: 64 }, equivalentFocalLengthMm: 50, chart });
    const plain = calculateSubjectDistanceForFraming({ sensor: { widthMm: 96 * 1.197 / 1000, heightMm: 64 * 1.197 / 1000 }, equivalentFocalLengthMm: 50, chart });
    expect(prime.subjectDistanceM).toBeCloseTo(plain.subjectDistanceM, 12);
    // The phone lenses also frame on a plain sensor, as before.
    expect(calculateSubjectDistanceForFraming({ sensor: { widthMm: 9.844, heightMm: 7.431 }, catalogue: "pv-24-1.8-phone", chart }).subjectDistanceM).toBeGreaterThan(0);
  });
});

describe("the fixed pattern of a site that sums photosites (#637)", () => {
  const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "photivra:sensor-profiles-2-25-test", reuseStatus: "photivra-owned" as const }];
  const fact = (value: number): { value: number; evidence: typeof evidence } => ({ value, evidence });
  const profile = (hotFraction: number): SensorFixedPatternNoiseProfile => ({ schemaVersion: "0.1.0", profileId: "test-fpn", colorSamplingProfileId: "test-cfa", scientificStatus: "approximation",
    sensorInstanceSeedUint32: 12345, photoResponseNonUniformity: { relativeStandardDeviation: fact(0.01) }, darkSignalNonUniformity: { relativeStandardDeviation: fact(0.3) },
    hotPixels: { siteFraction: fact(hotFraction), darkCurrentMultiplier: fact(30) }, rowOffset: { rmsElectrons: fact(0.5) }, columnOffset: { rmsElectrons: fact(0.4) },
    patternDistribution: "normal-factors-truncated-at-zero", evidence, limitations: ["Test values."] });
  const stats = (values: number[]): { mean: number; sd: number } => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { mean, sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)) };
  };

  it("keeps a photosite's own pattern (n = 1) and matches 4 × 4 sums of the native pattern", () => {
    const p = profile(0.01);
    expect(sumFixedPatternSites(p, 1)).toBe(p);
    const k = 4, n = k * k, sites = 96, summed = sumFixedPatternSites(p, n);
    // The native pattern summed over k × k blocks (photo response and dark factor: the block mean; offsets: the block's sum).
    const gain: number[] = [], dark: number[] = [], hot: number[] = [], siteGain: number[] = [], siteDark: number[] = [], siteHot: number[] = [];
    for (let y = 0; y < sites; y++) for (let x = 0; x < sites; x++) {
      let g = 0, d = 0, h = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
        const v = calculateSensorFixedPatternSite({ profile: p, site: { x: x * k + i, y: y * k + j } });
        g += v.photoResponseGainFactor / n; d += v.darkCurrentFactor / n; h = Math.max(h, v.hotPixel ? 1 : 0);
      }
      gain.push(g); dark.push(d); hot.push(h);
      const s = calculateSensorFixedPatternSite({ profile: summed, site: { x, y } });
      siteGain.push(s.photoResponseGainFactor); siteDark.push(s.darkCurrentFactor); siteHot.push(s.hotPixel ? 1 : 0);
    }
    // 9 216 sites: the standard deviations agree within 5 %, the hot-site fractions within 0.02 and the mean dark factors within 1.5 %.
    expect(stats(siteGain).sd / stats(gain).sd).toBeGreaterThan(0.95);
    expect(stats(siteGain).sd / stats(gain).sd).toBeLessThan(1.05);
    expect(stats(siteGain).sd).toBeCloseTo(0.01 / k, 3);
    expect(Math.abs(stats(siteHot).mean - stats(hot).mean)).toBeLessThan(0.02);
    expect(stats(siteHot).mean).toBeCloseTo(1 - 0.99 ** n, 1);
    expect(Math.abs(stats(siteDark).mean / stats(dark).mean - 1)).toBeLessThan(0.015);
    // Row and column offsets: a site row sums k photosites of each of its k rows (σ·k^1.5), and stays shared along the row.
    const rows: number[] = [], siteRows: number[] = [];
    for (let y = 0; y < 2048; y++) {
      let r = 0;
      for (let j = 0; j < k; j++) r += k * calculateSensorFixedPatternSite({ profile: p, site: { x: 0, y: y * k + j } }).rowOffsetElectrons;
      rows.push(r);
      siteRows.push(calculateSensorFixedPatternSite({ profile: summed, site: { x: 0, y } }).rowOffsetElectrons);
    }
    expect(stats(siteRows).sd / stats(rows).sd).toBeGreaterThan(0.93);
    expect(stats(siteRows).sd / stats(rows).sd).toBeLessThan(1.07);
    expect(summed.rowOffset.rmsElectrons.value).toBeCloseTo(0.5 * k ** 1.5, 12);
    expect(summed.columnOffset.rmsElectrons.value).toBeCloseTo(0.4 * k ** 1.5, 12);
    expect(calculateSensorFixedPatternSite({ profile: summed, site: { x: 7, y: 3 } }).rowOffsetElectrons).toBe(calculateSensorFixedPatternSite({ profile: summed, site: { x: 50, y: 3 } }).rowOffsetElectrons);
    // The mean dark factor is kept at any n (one hot state per site carries the expected hot count).
    for (const m of [2.25, 16, 1e4]) {
      const s = sumFixedPatternSites(p, m), f = s.hotPixels.siteFraction.value;
      expect(f * (s.hotPixels.darkCurrentMultiplier.value - 1)).toBeCloseTo(0.01 * 29, 9);
    }
    expect(sumFixedPatternSites(profile(0), 9).hotPixels).toEqual(profile(0).hotPixels);
  });

  it("renders on a profile's downsized view with the summed figures; the native report keeps the photosite's", async () => {
    const ff = resolveSensorProfile("full-frame-24mp-bsi-2020s");
    const exact = (sensor: NonNullable<SimulateCaptureOptions["sensor"]>): Promise<SimulateCaptureResult> => uniform(sensor, { fast: false });
    const native = await exact({ profile: ff, fixedPatternNoise: true }), view = await exact({ profile: ff, fixedPatternNoise: true, pixelPitchMicrometers: 2 * ff.pixelPitchMicrometers });
    const plain = await exact({ profile: ff, pixelPitchMicrometers: 2 * ff.pixelPitchMicrometers });
    const grey = view.sensor.midGrey!, n = 4, f = ff.fixedPattern;
    expect(grey.noiseElectrons.fixedPattern).toBeCloseTo(Math.hypot(f.prnu / 2 * grey.signalElectrons, f.dsnu / 2 * grey.noiseElectrons.darkCurrent ** 2,
      f.rowElectrons * n ** 0.75, f.columnElectrons * n ** 0.75), 9);
    expect(view.sensor.native.midGrey!.noiseElectrons.fixedPattern).toBeCloseTo(native.sensor.midGrey!.noiseElectrons.fixedPattern!, 9);
    expect(Buffer.from(view.raw.codes.buffer).equals(Buffer.from(plain.raw.codes.buffer))).toBe(false);
    // A pitch below one photosite stays refused (the pattern is per photosite).
    await expect(exact({ profile: ff, fixedPatternNoise: true, pixelPitchMicrometers: 3 })).rejects.toThrow("at least the profile's photosite");
    // A phone lens view sums thousands of photosites.
    const phoneView = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 24, height: 18 }, sensor: { profile: phone, fixedPatternNoise: true, spectralStepNanometers: 100 },
      lens: { catalogue: "pv-24-1.8-phone" }, fast: true });
    expect(phoneView.sensor.fixedPatternNoise).toBe(true);
  }, scaledTimeout(120_000));
});

describe("full well and sensitivity offset with a sensor profile (#638)", () => {
  const mf = resolveSensorProfile("medium-format-100mp-bsi-16bit");
  const characteristics = (r: SimulateCaptureResult): { value: { sensitivityOffsetStops: number }; explanation: string } => assumption(r, "sensor.characteristics") as never;

  it("takes a linked full well at the profile's photosite: its own full well changes nothing", async () => {
    for (const p of [mf, phone]) {
      for (const pitch of [undefined, 3 * p.pixelPitchMicrometers]) {
        const sensor = { profile: p, ...(pitch ? { pixelPitchMicrometers: pitch } : {}) };
        const plain = await uniform(sensor), own = await uniform({ ...sensor, fullWell: { electrons: p.fullWellElectrons } });
        expect(characteristics(own).value.sensitivityOffsetStops, p.id).toBeCloseTo(0, 12);
        expect(Buffer.from(own.raw.codes.buffer).equals(Buffer.from(plain.raw.codes.buffer)), p.id).toBe(true);
        expect(own.sensor.native.fullWellElectrons).toBeCloseTo(p.fullWellElectrons, 6);
      }
    }
    // Twice the full well halves the output per unit exposure: -1 stop, and the RAW signal halves.
    const plain = await uniform({ profile: mf }), twice = await uniform({ profile: mf, fullWell: { electrons: 2 * mf.fullWellElectrons } });
    expect(characteristics(twice).value.sensitivityOffsetStops).toBeCloseTo(-1, 12);
    const signal = (r: SimulateCaptureResult): number => r.raw.codes.reduce((a, c, i) => a + c - r.raw.blackLevels[i]!, 0);
    expect(signal(twice) / signal(plain)).toBeCloseTo(0.5, 2);
    // The 6 µm reference is still available explicitly.
    const at6 = await uniform({ profile: mf, fullWell: { electrons: mf.fullWellElectrons, referencePixelPitchMicrometers: 6 } });
    expect(characteristics(at6).value.sensitivityOffsetStops).toBeCloseTo(Math.log2(36 / 3.76 ** 2), 12);
  }, scaledTimeout(120_000));

  it("notes an unusual full well per µm² of the photosite, not of the rendered site", async () => {
    const view = { profile: mf, pixelPitchMicrometers: 360 };
    // 50 300 e⁻ unlinked at 3.76 µm: 3 558 e⁻/µm², not unusual (the rendered site's 0.39 e⁻/µm² was noted before).
    expect(characteristics(await uniform({ ...view, fullWell: { electrons: 50300, link: "none" } })).explanation).not.toMatch(/Unusual/u);
    // 900 000 e⁻ at 3.76 µm: 63 660 e⁻/µm² (6.9 e⁻/µm² over the rendered 360 µm site before).
    const high = characteristics(await uniform({ ...view, fullWell: { electrons: 900000, link: "none" } })).explanation;
    expect(Number(/Unusual for the pitch: ([\d.e+]+)/u.exec(high)![1])).toBeCloseTo(900000 / 3.76 ** 2, 6);
    // A tier keeps the rendered pitch's density.
    const tier = characteristics(await uniform({ pixelPitchMicrometers: 4, fullWell: { electrons: 900000, link: "none" } })).explanation;
    expect(Number(/Unusual for the pitch: ([\d.e+]+)/u.exec(tier)![1])).toBeCloseTo(900000 / 16, 6);
  }, scaledTimeout(120_000));

  it("agrees with calculateSensorFigures", async () => {
    const figures = await calculateSensorFigures({ profile: phone, characteristics: { fullWell: { electrons: phone.fullWellElectrons } }, iso: 400 });
    const plain = await calculateSensorFigures({ profile: phone, iso: 400 });
    expect(figures.value.fullWellElectrons).toBeCloseTo(plain.value.fullWellElectrons, 6);
    expect(figures.value.dynamicRangeStops).toBeCloseTo(plain.value.dynamicRangeStops, 9);
  }, scaledTimeout(60_000));
});
