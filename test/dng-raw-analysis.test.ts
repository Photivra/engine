// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  parseDngRawImage, simulateCapture, calculateDngRawClipping, estimateDngRawNoise, assessDngRawWhatIf, simulateDngRawWhatIf, developDngImage,
  DngRawWhatIfRefusedError, InvalidConfigurationError, InvalidScientificInputError, DNG_IMPORT_SCHEMA_VERSION, type ImportedDngRaw, type SimulateCaptureOptions
} from "../src/index.js";
import { writeTiff, packBits, rationalPairs, type TagSpec } from "./helpers/dng-test-writer.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.24.0 (#607 go items): NoiseProfile and Exif import, RAW clipping and noise measurements, the seeded RAW-to-RAW what-if and the
 * full color development of an imported DNG. Synthetic DNGs are built here; engine captures give the known truth (the method and
 * thresholds of docs/research/photo-feasibility.md). No photo is used.
 */

const SRATIONAL = 10, RATIONAL = 5, DOUBLE = 12;
const ascii = (s: string): number[] => [...new TextEncoder().encode(s), 0];
/** A 16 × 12 RGGB mosaic with the given tags in IFD 0 and an optional Exif IFD. */
function syntheticDng(options: { main?: TagSpec[]; exif?: TagSpec[]; photometric?: number; codes?: Uint16Array; spp?: number } = {}): Uint8Array {
  const width = 16, height = 12, spp = options.spp ?? 1, codes = options.codes ?? Uint16Array.from({ length: width * height * spp }, (_, i) => 1000 + (i * 37) % 500);
  const cfa: TagSpec[] = (options.photometric ?? 32803) === 32803 ? [{ id: 33421, type: 3, values: [2, 2] }, { id: 33422, type: 1, values: [0, 1, 1, 2] }] : [];
  return writeTiff(true, [{
    tags: [{ id: 254, type: 4, values: [0] }, { id: 256, type: 4, values: [width] }, { id: 257, type: 4, values: [height] },
      { id: 258, type: 3, values: Array(spp).fill(16) }, { id: 259, type: 3, values: [1] }, { id: 262, type: 3, values: [options.photometric ?? 32803] },
      { id: 277, type: 3, values: [spp] }, { id: 278, type: 4, values: [height] }, ...cfa, { id: 271, type: 2, values: ascii("Synthetic") },
      { id: 50706, type: 1, values: [1, 6, 0, 0] }, { id: 50714, type: 4, values: Array(spp).fill(512) }, { id: 50717, type: 4, values: Array(spp).fill(16383) },
      { id: 50721, type: SRATIONAL, values: rationalPairs([.8, -.2, -.1, -.3, 1.2, .1, 0, .1, .7]) }, { id: 50728, type: RATIONAL, values: rationalPairs([.5, 1, .6]) },
      { id: 50778, type: 3, values: [21] }, ...(options.main ?? [])],
    chunks: { offsetTag: 273, countTag: 279, data: [packBits(codes, width * spp, 16, true)] },
    ...(options.exif ? { exifIfd: { tags: options.exif } } : {})
  }]);
}

const LUX = 21481 / 31.25, BASE = 1 / 8;
/** An engine capture of a uniform patch (professional tier), as a parsed DNG, and the capture's dual-gain switch. */
async function uniform(reflectance: number, iso: number, shutter: number, seed: number, size = 128): Promise<{ raw: ImportedDngRaw; switchIso: number | null }> {
  const c = await simulateCapture({ scene: { preset: "uniform", reflectance }, illuminanceLux: LUX, exposure: { mode: "manual", iso, shutterSeconds: shutter },
    sensor: { noiseSeed: seed }, output: { width: size, height: size, format: "dng" } });
  return { raw: parseDngRawImage({ bytes: c.image.dng! }), switchIso: c.sensor.readNoise.highGainFromIso };
}
/** Per CFA phase: mean and sample variance of x over the active area less a 2-site border. */
function phaseStats(d: ImportedDngRaw, codes: Uint16Array): { mean: number; variance: number; n: number }[] {
  const a = d.activeArea, black = d.blackLevel.values[0]!, span = d.whiteLevel[0]! - black, out: number[][] = [[], [], [], []];
  for (let y = a.y + 2; y < a.y + a.height - 2; y++) for (let x = a.x + 2; x < a.x + a.width - 2; x++) out[((y - a.y) & 1) * 2 + ((x - a.x) & 1)]!.push((codes[y * d.width + x]! - black) / span);
  return out.map((v) => { const mean = v.reduce((s, q) => s + q, 0) / v.length; return { mean, variance: v.reduce((s, q) => s + (q - mean) ** 2, 0) / (v.length - 1), n: v.length }; });
}

describe("DNG import: NoiseProfile and Exif (2.24.0)", () => {
  it("reads the engine DNG's NoiseProfile and Exif capture settings", async () => {
    const { raw } = await uniform(0.18, 400, BASE / 4, 1, 32);
    expect(raw.schemaVersion).toBe(DNG_IMPORT_SCHEMA_VERSION);
    expect(raw.exif).toMatchObject({ exposureTimeSeconds: 1 / 32, fNumber: 8, focalLengthMillimeters: 50, photographicSensitivity: 400, sensitivityType: 2,
      recommendedExposureIndex: 400, iso: 400, isoSource: "recommended-exposure-index", compositeImage: null, subjectArea: null });
    expect(raw.noiseProfile).toHaveLength(3);
    for (const p of raw.noiseProfile!) { expect(p.scale).toBeGreaterThan(0); expect(p.offset).toBeGreaterThan(0); }
    expect(raw.analogBalance).toEqual([1, 1, 1]);
  }, scaledTimeout(30_000));

  it("reads the Exif IFD tags, a two-value NoiseProfile and the calibration tags of a synthetic DNG", () => {
    const raw = parseDngRawImage({ bytes: syntheticDng({
      main: [{ id: 51041, type: DOUBLE, values: [2e-5, 3e-8] }, { id: 50727, type: RATIONAL, values: rationalPairs([1, 1, 1]) },
        { id: 50723, type: SRATIONAL, values: rationalPairs([1.1, 0, 0, 0, 1, 0, 0, 0, .9]) }, { id: 50931, type: 2, values: ascii("sig") },
        { id: 50932, type: 2, values: ascii("sig") }, { id: 50729, type: RATIONAL, values: rationalPairs([.3457, .3585]) }],
      exif: [{ id: 33434, type: RATIONAL, values: [1, 250] }, { id: 33437, type: RATIONAL, values: [28, 10] }, { id: 37386, type: RATIONAL, values: [24, 1] },
        { id: 34855, type: 3, values: [65535] }, { id: 34864, type: 3, values: [6] }, { id: 34866, type: 4, values: [102400] }, { id: 34867, type: 4, values: [100000] },
        { id: 42080, type: 3, values: [2] }, { id: 42081, type: 3, values: [9, 8] }, { id: 37396, type: 3, values: [800, 600, 200, 100] }]
    }) });
    expect(raw.noiseProfile).toEqual([{ scale: 2e-5, offset: 3e-8 }, { scale: 2e-5, offset: 3e-8 }, { scale: 2e-5, offset: 3e-8 }]);
    expect(raw.exif).toEqual({ exposureTimeSeconds: 1 / 250, fNumber: 2.8, focalLengthMillimeters: 24, photographicSensitivity: 65535, sensitivityType: 6,
      standardOutputSensitivity: null, recommendedExposureIndex: 102400, isoSpeed: 100000, iso: 102400, isoSource: "recommended-exposure-index",
      compositeImage: 2, compositeSourceImages: { total: 9, used: 8 }, subjectArea: { kind: "rectangle", x: 800, y: 600, width: 200, height: 100 } });
    expect(raw.cameraCalibration1).toEqual([1.1, 0, 0, 0, 1, 0, 0, 0, .9]);
    expect(raw.cameraCalibrationSignature).toBe("sig");
    expect(raw.profileCalibrationSignature).toBe("sig");
    expect(raw.asShotWhiteXy).toEqual({ x: .3457, y: .3585 });
  });

  it("reads subject points and circles, a per-plane NoiseProfile, TIFF-EP tags in IFD 0, and reports malformed tags without failing", () => {
    const point = parseDngRawImage({ bytes: syntheticDng({ exif: [{ id: 37396, type: 3, values: [10, 20] }, { id: 34855, type: 3, values: [200] }] }) });
    expect(point.exif.subjectArea).toEqual({ kind: "point", x: 10, y: 20 });
    expect(point.exif).toMatchObject({ iso: 200, isoSource: "photographic-sensitivity" });
    const circle = parseDngRawImage({ bytes: syntheticDng({ exif: [{ id: 37396, type: 3, values: [10, 20, 5] }] }) });
    expect(circle.exif.subjectArea).toEqual({ kind: "circle", x: 10, y: 20, diameter: 5 });
    const planes = parseDngRawImage({ bytes: syntheticDng({ main: [{ id: 51041, type: DOUBLE, values: [1e-5, 1e-8, 2e-5, 2e-8, 3e-5, 3e-8] }, { id: 34855, type: 3, values: [64] },
      { id: 33434, type: RATIONAL, values: [1, 60] }] }) });
    expect(planes.noiseProfile!.map((p) => p.scale)).toEqual([1e-5, 2e-5, 3e-5]);
    expect(planes.exif).toMatchObject({ iso: 64, exposureTimeSeconds: 1 / 60 });
    const bad = parseDngRawImage({ bytes: syntheticDng({ main: [{ id: 51041, type: DOUBLE, values: [-1, 0] }],
      exif: [{ id: 34855, type: 3, values: [65535] }, { id: 33437, type: RATIONAL, values: [1, 0] }, { id: 37396, type: 3, values: [1, 2, 3, 4, 5] }, { id: 42080, type: 3, values: [7] }] }) });
    expect(bad.noiseProfile).toBeNull();
    expect(bad.exif).toMatchObject({ iso: null, fNumber: null, subjectArea: null, compositeImage: null });
    for (const pattern of [/NoiseProfile is malformed/u, /FNumber is malformed/u, /65535 or more/u, /SubjectArea has 5 values/u, /CompositeImage 7/u])
      expect(bad.assumptions.join("\n")).toMatch(pattern);
    const none = parseDngRawImage({ bytes: syntheticDng() });
    expect(none.exif).toMatchObject({ iso: null, exposureTimeSeconds: null, compositeSourceImages: null });
    expect(none.noiseProfile).toBeNull();
  });
});

describe("RAW measurements (2.24.0)", () => {
  it("counts clipped sites per channel at the white level and near it", async () => {
    const c = await simulateCapture({ scene: { preset: "step-wedge" }, exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 125) * 8 }, output: { width: 96, height: 32, format: "dng" } });
    const raw = parseDngRawImage({ bytes: c.image.dng! }), clip = calculateDngRawClipping(raw);
    // Truth: the stored codes at or above WhiteLevel inside the default crop.
    const a = raw.activeArea, white = raw.whiteLevel[0]!;
    let at = 0;
    for (let y = a.y; y < a.y + a.height; y++) for (let x = a.x; x < a.x + a.width; x++) if (raw.codes[y * raw.width + x]! >= white) at++;
    expect(clip.confidence).toBe("exact");
    expect(clip.fractionAtWhiteLevel).toBeCloseTo(at / (a.width * a.height), 12);
    expect(clip.fractionAtWhiteLevel).toBeGreaterThan(0.2);
    expect(clip.planes.map((p) => p.color)).toEqual(["red", "green", "blue"]);
    expect(clip.planes.reduce((s, p) => s + p.atWhiteLevel, 0)).toBe(at);
    for (const p of clip.planes) expect(p.nearWhiteLevel).toBeGreaterThanOrEqual(p.atWhiteLevel);
    expect(calculateDngRawClipping(raw, { marginFraction: 0.25 }).fractionNearWhiteLevel).toBeGreaterThan(clip.fractionNearWhiteLevel);
    const dark = parseDngRawImage({ bytes: (await simulateCapture({ scene: { preset: "step-wedge" }, output: { width: 32, height: 16, format: "dng" } })).image.dng! });
    expect(calculateDngRawClipping(dark).fractionAtWhiteLevel).toBe(0);
    expect(() => calculateDngRawClipping(raw, { marginFraction: 0.5 })).toThrow(InvalidConfigurationError);
    expect(() => calculateDngRawClipping(raw, { extra: 1 } as never)).toThrow(InvalidConfigurationError);
    expect(() => calculateDngRawClipping({} as never)).toThrow(InvalidConfigurationError);
    const linear = calculateDngRawClipping(parseDngRawImage({ bytes: syntheticDng({ photometric: 34892, spp: 3, codes: new Uint16Array(16 * 12 * 3).fill(16383) }) }));
    expect(linear).toMatchObject({ confidence: "processed", fractionAtWhiteLevel: 1 });
    expect(linear.planes.map((p) => p.color)).toEqual(["sample-0", "sample-1", "sample-2"]);
  }, scaledTimeout(30_000));

  it("estimates RAW noise within the research's chart accuracy, and refuses demosaiced or lossy data", async () => {
    // #607: σ at the median signal −7.6 % … +3.0 % of the NoiseProfile on charts.
    for (const iso of [100, 3200]) for (const scene of [{ preset: "uniform", reflectance: 0.18 }, { preset: "step-wedge" }, { preset: "slanted-edge" }] as const) {
      const c = await simulateCapture({ scene, illuminanceLux: 21481 * 15 / 125, exposure: { mode: "manual", iso, shutterSeconds: (1 / 15) * (100 / iso) },
        sensor: { noiseSeed: 1 }, output: { width: 256, height: 256, format: "dng" } });
      const noise = estimateDngRawNoise(parseDngRawImage({ bytes: c.image.dng! }), { signalLevels: [0.1] });
      for (const p of noise.planes) {
        expect(p.measuredToProfile, iso + " " + scene.preset + " " + p.color).toBeGreaterThan(0.9);
        expect(p.measuredToProfile, iso + " " + scene.preset + " " + p.color).toBeLessThan(1.05);
        expect(p.sigmaAtLevels[0]!.signal).toBe(0.1);
      }
    }
    const linear = parseDngRawImage({ bytes: syntheticDng({ photometric: 34892, spp: 3 }) });
    expect(() => estimateDngRawNoise(linear)).toThrow(InvalidScientificInputError);
    const { raw } = await uniform(0.18, 100, BASE, 2, 32);
    expect(() => estimateDngRawNoise({ ...raw, lossySource: true })).toThrow(/lossy/u);
    expect(() => estimateDngRawNoise(raw, { bins: 1 })).toThrow(InvalidConfigurationError);
    expect(() => estimateDngRawNoise(raw, { signalLevels: [2] })).toThrow(InvalidConfigurationError);
    const tiny = estimateDngRawNoise(raw);
    expect(tiny.planes.every((p) => p.fit === null && p.sigmaAtMedian === null)).toBe(true); // too few blocks for two bins of 200
  }, scaledTimeout(120_000));
});

describe("RAW-to-RAW what-if (2.24.0)", () => {
  const REFLECTANCES = [0.01, 0.03, 0.08, 0.18, 0.35, 0.6, 0.9];
  /** #607's statistic: per phase and level, the simulated ÷ real variance against the 95 % interval ×/÷ exp(1.96·√(4/(n − 1))). */
  async function validate(isoA: number, isoB: number, stops: number): Promise<{ inside: number; total: number; worst: [number, number]; meanError: number }> {
    let inside = 0, total = 0, lo = Infinity, hi = 0, meanError = 0;
    for (const [li, reflectance] of REFLECTANCES.entries()) {
      const A = await uniform(reflectance, isoA, BASE, 11 + li), B = await uniform(reflectance, isoB, BASE * 2 ** stops, 101 + li);
      const sim = simulateDngRawWhatIf(A.raw, { exposureStops: stops, ...(isoB !== isoA ? { iso: isoB, highGainFromIso: A.switchIso } : {}), seed: 7 + li });
      const s = phaseStats(A.raw, sim.raw.codes), t = phaseStats(B.raw, B.raw.codes);
      for (let p = 0; p < 4; p++) {
        if (t[p]!.mean > 0.97) continue; // clipped levels are excluded, as in the research
        const ratio = s[p]!.variance / t[p]!.variance, limit = Math.exp(1.96 * Math.sqrt(4 / (s[p]!.n - 1)));
        total++; if (ratio < limit && ratio > 1 / limit) inside++;
        lo = Math.min(lo, ratio); hi = Math.max(hi, ratio);
        // Mean difference in standard errors of the difference of two sample means.
        meanError = Math.max(meanError, Math.abs(s[p]!.mean - t[p]!.mean) / Math.sqrt((s[p]!.variance + t[p]!.variance) / s[p]!.n));
      }
    }
    return { inside, total, worst: [lo, hi], meanError };
  }

  it("matches real darker and higher-ISO captures within one gain mode (the research's statistic)", async () => {
    const darker = await validate(100, 100, -2), iso4 = await validate(100, 400, -2), iso8 = await validate(800, 6400, -3);
    // Measured on this tree: 25/28, 26/28, 18/18 (about 95 % expected by chance); variance ratios 0.93–1.07; means within 4 standard errors.
    expect(darker.inside).toBeGreaterThanOrEqual(25); expect(darker.total).toBe(28);
    expect(iso4.inside).toBeGreaterThanOrEqual(25); expect(iso4.total).toBe(28);
    expect(iso8.inside).toBeGreaterThanOrEqual(17); expect(iso8.total).toBe(18);
    for (const r of [darker, iso4, iso8]) { expect(r.worst[0]).toBeGreaterThan(0.9); expect(r.worst[1]).toBeLessThan(1.1); expect(r.meanError).toBeLessThan(4); }
  }, scaledTimeout(240_000));

  it("refuses an ISO change across the dual-gain switch, and explains every refusal", async () => {
    const { raw, switchIso } = await uniform(0.18, 100, BASE, 3);
    expect(switchIso).toBe(800);
    const cross = assessDngRawWhatIf(raw, { iso: 1600, highGainFromIso: 800, seed: 1 });
    expect(cross).toMatchObject({ allowed: false, refusals: [{ reason: "crosses-gain-switch" }] });
    expect(() => simulateDngRawWhatIf(raw, { iso: 1600, highGainFromIso: 800, seed: 1 })).toThrow(DngRawWhatIfRefusedError);
    try { simulateDngRawWhatIf(raw, { iso: 1600, highGainFromIso: 800, seed: 1 }); } catch (e) {
      expect(e).toBeInstanceOf(InvalidScientificInputError);
      expect((e as DngRawWhatIfRefusedError).refusals.map((r) => r.reason)).toEqual(["crosses-gain-switch"]);
    }
    expect(assessDngRawWhatIf(raw, { iso: 400, highGainFromIso: 800, seed: 1 }).allowed).toBe(true);
    expect(assessDngRawWhatIf(raw, { iso: 400, highGainFromIso: null, seed: 1 }).allowed).toBe(true);
    const reasons = (r: ImportedDngRaw, request: Parameters<typeof assessDngRawWhatIf>[1]): string[] => assessDngRawWhatIf(r, request).refusals.map((x) => x.reason);
    expect(reasons(raw, { iso: 400, seed: 1 })).toEqual(["gain-mode-unknown"]);
    expect(reasons(raw, { iso: 50, seed: 1 })).toEqual(["iso-below-photo"]);
    expect(reasons({ ...raw, exif: { ...raw.exif, iso: null } }, { iso: 400, highGainFromIso: 800, seed: 1 })).toEqual(["iso-unknown"]);
    expect(reasons({ ...raw, exif: { ...raw.exif, iso: null } }, { iso: 400, sourceIso: 100, highGainFromIso: 800, seed: 1 })).toEqual([]);
    expect(reasons({ ...raw, noiseProfile: null }, { exposureStops: -1, seed: 1 })).toEqual(["no-noise-profile"]);
    expect(reasons({ ...raw, lossySource: true }, { exposureStops: -1, seed: 1 })).toEqual(["lossy-raw-data"]);
    expect(reasons({ ...raw, scale: 0.5 }, { exposureStops: -1, seed: 1 })).toEqual(["half-size-preview"]);
    expect(reasons({ ...raw, linearizationTable: new Uint16Array([0, 1]) }, { exposureStops: -1, seed: 1, verifyNoiseProfile: false })).toEqual(["linearization-table"]);
    // A NoiseProfile far above the measured noise: the data was denoised after capture (the research's phone RAW measured 8 %).
    const denoised = { ...raw, noiseProfile: raw.noiseProfile!.map((p) => ({ scale: p.scale * 20, offset: p.offset * 20 })) };
    expect(reasons(denoised, { exposureStops: -1, seed: 1 })).toEqual(["noise-profile-mismatch"]);
    expect(reasons(denoised, { exposureStops: -1, seed: 1, verifyNoiseProfile: false })).toEqual([]);
    const linear = parseDngRawImage({ bytes: syntheticDng({ photometric: 34892, spp: 3 }) });
    expect(reasons(linear, { exposureStops: -1, seed: 1 })).toEqual(["not-a-mosaic", "no-noise-profile"]);
    for (const bad of [{ seed: -1 }, { seed: 1, exposureStops: 20 }, { seed: 1, iso: 0 }, { seed: 1, extra: 1 }, { seed: 1, verifyNoiseProfile: 1 }]) {
      expect(() => assessDngRawWhatIf(raw, bad as never)).toThrow(InvalidConfigurationError);
    }
  }, scaledTimeout(60_000));

  it("is deterministic, keeps clipped sites clipped and offers a brighter version only as brightened in editing", async () => {
    const { raw } = await uniform(0.6, 100, BASE, 4, 64);
    const a = simulateDngRawWhatIf(raw, { exposureStops: -1, seed: 9 }), b = simulateDngRawWhatIf(raw, { exposureStops: -1, seed: 9 }), c = simulateDngRawWhatIf(raw, { exposureStops: -1, seed: 10 });
    expect(Array.from(a.raw.codes)).toEqual(Array.from(b.raw.codes));
    expect(Array.from(a.raw.codes)).not.toEqual(Array.from(c.raw.codes));
    expect(a).toMatchObject({ kind: "simulated-capture", lightFactor: 0.5, isoFactor: 1, developmentPushStops: 0 });
    expect(a.label).toBe("Simulation: this RAW with 1 stops less light, using the sensor's noise model.");
    const brighter = simulateDngRawWhatIf(raw, { exposureStops: 1.5, seed: 9 });
    expect(Array.from(brighter.raw.codes)).toEqual(Array.from(raw.codes));
    expect(brighter).toMatchObject({ kind: "brightened-in-editing", developmentPushStops: 1.5, lightFactor: 1 });
    expect(brighter.label).toBe("This RAW brightened in editing by 1.5 stops (same noise, not a longer exposure).");
    const both = simulateDngRawWhatIf(raw, { iso: 400, highGainFromIso: 800, exposureStops: 1, seed: 9 });
    expect(both.kind).toBe("simulated-capture-brightened-in-editing");
    expect(both.label).toBe("Simulation: this RAW with ISO 400, using the sensor's noise model; then brightened in editing by 1 stops (same noise, not a longer exposure).");
    expect(both.raw.noiseProfile![1]!.scale).toBeCloseTo(4 * raw.noiseProfile![1]!.scale, 15);
    // ISO ×4 at the same light: a 90 % patch (x ≈ 0.33) clips; sites at white in the photo stay there.
    const bright = await uniform(0.9, 100, BASE, 4, 32);
    expect(simulateDngRawWhatIf(bright.raw, { iso: 400, highGainFromIso: 800, seed: 9 }).newlyClippedSites).toBeGreaterThan(0);
    const white = raw.whiteLevel[0]!;
    const clippedRaw = { ...raw, codes: Uint16Array.from(raw.codes, (v, i) => i % 7 === 0 ? white : v) };
    const darkened = simulateDngRawWhatIf(clippedRaw, { exposureStops: -2, seed: 1 });
    for (let i = 0; i < clippedRaw.codes.length; i += 7) expect(darkened.raw.codes[i]).toBe(white);
    expect(simulateDngRawWhatIf(raw, { seed: 1 }).kind).toBe("unchanged");
  }, scaledTimeout(60_000));
});

describe("Full color development of an imported DNG (2.24.0)", () => {
  const options = (whiteBalance?: { kelvin: number }): SimulateCaptureOptions => ({ scene: { preset: "color-patches" }, sensor: { noiseSeed: 3 },
    output: { width: 96, height: 64, ...(whiteBalance ? { whiteBalance } : {}) } });
  async function pair(whiteBalance?: { kelvin: number }): Promise<{ raw: ImportedDngRaw; srgb: Uint8Array }> {
    const base = options(whiteBalance);
    const dng = await simulateCapture({ ...base, output: { ...base.output, format: "dng" } }), srgb = await simulateCapture({ ...base, output: { ...base.output, format: "srgb-8" } });
    return { raw: parseDngRawImage({ bytes: dng.image.dng! }), srgb: srgb.image.samples as Uint8Array };
  }
  /** Mean and largest absolute code difference away from a 2-pixel border (where the engine reads sites outside the ActiveArea). */
  function interior(a: ArrayLike<number>, b: ArrayLike<number>, width = 96, height = 64): { mean: number; max: number } {
    let sum = 0, n = 0, max = 0;
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) for (let c = 0; c < 3; c++) { const i = 3 * (y * width + x) + c, d = Math.abs(a[i]! - b[i]!); sum += d; n++; max = Math.max(max, d); }
    return { mean: sum / n, max };
  }

  it("reproduces the engine's own development of the same RAW (as-shot white balance, bilinear)", async () => {
    const { raw, srgb } = await pair();
    const dev = await developDngImage(raw);
    expect(dev).toMatchObject({ width: 96, height: 64, format: "srgb-8", demosaic: "bilinear", fast: { requested: true, defaultedFrom: "format" } });
    expect(dev.whiteBalance.source).toBe("as-shot-neutral");
    expect(dev.whiteBalance.correlatedColorTemperatureKelvin).toBeCloseTo(6500, -2);
    expect(interior(srgb, dev.samples)).toEqual({ mean: 0, max: 0 });
  }, scaledTimeout(60_000));

  it("re-develops with another white balance: the same as the engine's capture at that setting, and as the file shot at it", async () => {
    const d65 = await pair(), tungsten = await pair({ kelvin: 3200 });
    expect(Array.from(d65.raw.codes)).toEqual(Array.from(tungsten.raw.codes)); // white balance is a development setting (#607)
    const redeveloped = await developDngImage(d65.raw, { whiteBalance: { kelvin: 3200 } }), asShot = await developDngImage(tungsten.raw);
    expect(redeveloped.whiteBalance.correlatedColorTemperatureKelvin).toBeCloseTo(3200, 3);
    expect(interior(redeveloped.samples, asShot.samples).max).toBeLessThanOrEqual(1);
    // The DNG convention normalizes the camera neutral to its largest component (here red); the engine's sRGB development keeps green
    // at 1. Compensating that factor gives the engine's pixels exactly.
    const n = tungsten.raw.asShotNeutral!, factor = n[1]! / Math.max(...n);
    const matched = await developDngImage(tungsten.raw, { exposurePushStops: Math.log2(factor) });
    expect(interior(tungsten.srgb, matched.samples)).toEqual({ mean: 0, max: 0 });
  }, scaledTimeout(60_000));

  it("takes a push (brightened in editing), AHD at full quality, 16-bit output, crop and orientation", async () => {
    const c = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.09 }, sensor: { noiseSeed: 5 }, output: { width: 32, height: 24, format: "dng" } });
    const raw = parseDngRawImage({ bytes: c.image.dng! });
    const mean = (img: { samples: ArrayLike<number> }, max: number): number => { let s = 0; for (let i = 0; i < img.samples.length; i++) s += decode(img.samples[i]! / max); return s / img.samples.length; };
    const decode = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const plain = await developDngImage(raw, { format: "srgb-16" }), pushed = await developDngImage(raw, { format: "srgb-16", exposurePushStops: 1 });
    expect(mean(pushed, 65535) / mean(plain, 65535)).toBeCloseTo(2, 2);
    expect(pushed.exposure.label).toBe("Brightened in editing by 1 stops (same noise, not a longer exposure).");
    const ahd = await developDngImage(raw, { format: "srgb-16", fast: false });
    expect(ahd).toMatchObject({ demosaic: "ahd", fast: { requested: false, defaultedFrom: "request" } });
    expect(mean(ahd, 65535) / mean(plain, 65535)).toBeCloseTo(1, 2);
    const active = await developDngImage(raw, { crop: "active-area" });
    expect([active.width, active.height]).toEqual([raw.activeArea.width, raw.activeArea.height]);
    const rotated = await developDngImage({ ...raw, orientation: 6 }), flat = await developDngImage({ ...raw, orientation: 6 }, { orientation: false });
    expect([rotated.width, rotated.height]).toEqual([flat.height, flat.width]);
    // Orientation 6: stored (x, y) shows at (H − 1 − y, x).
    for (const [x, y] of [[0, 0], [5, 3], [31, 23]] as const) for (let k = 0; k < 3; k++)
      expect(rotated.samples[3 * (x * rotated.width + (flat.height - 1 - y)) + k]).toBe(flat.samples[3 * (y * flat.width + x) + k]);
    const neutral = await developDngImage(raw, { whiteBalance: { cameraNeutral: [raw.asShotNeutral![0]!, raw.asShotNeutral![1]!, raw.asShotNeutral![2]!] } });
    expect(Array.from(neutral.samples)).toEqual(Array.from((await developDngImage(raw)).samples));
    const xy = await developDngImage(raw, { whiteBalance: { chromaticity: plain.whiteBalance.chromaticity } });
    expect(interior(xy.samples, (await developDngImage(raw)).samples, 32, 24).max).toBeLessThanOrEqual(1);
    const toned = await developDngImage(raw, { toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } });
    expect(Array.from(toned.samples)).not.toEqual(Array.from(neutral.samples));
    for (const bad of [{ format: "png" }, { exposurePushStops: 11 }, { crop: "none" }, { whiteBalance: { kelvin: 10 } }, { whiteBalance: { cameraNeutral: [1, 0, 1] } }, { extra: 1 }, { fast: 1 }]) {
      await expect(developDngImage(raw, bad as never)).rejects.toThrow(InvalidConfigurationError);
    }
    await expect(developDngImage({ ...raw, colorMatrix1: null })).rejects.toThrow(InvalidScientificInputError);
    await expect(developDngImage({ ...raw, cfa: { ...raw.cfa!, pattern: [0, 0, 1, 2] } })).rejects.toThrow(/Bayer/u);
  }, scaledTimeout(60_000));

  it("applies the profile gain table map and RGBTables, the as-shot white chromaticity, D65 by default and two calibration illuminants", async () => {
    const c = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.09 }, sensor: { noiseSeed: 6 }, output: { width: 16, height: 16, format: "dng" } });
    const raw = parseDngRawImage({ bytes: c.image.dng! }), linearMean = (img: { samples: ArrayLike<number> }): number => {
      let s = 0; for (let i = 0; i < img.samples.length; i++) { const v = img.samples[i]! / 65535; s += v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; } return s / img.samples.length;
    };
    const plain = await developDngImage(raw, { format: "srgb-16" });
    // A one-point map with the constant gain 2 doubles every pixel (DNG 1.6 ProfileGainTableMap).
    const pgtm = { version: 2 as const, pointsV: 1, pointsH: 1, spacingV: 1, spacingH: 1, originV: 0, originH: 0, tablePoints: 2,
      inputWeights: [0, 0, 0, 0, 1] as [number, number, number, number, number], gamma: 1, gains: Float32Array.of(2, 2) };
    const gained = await developDngImage({ ...raw, profileGainTableMap: pgtm }, { format: "srgb-16" });
    expect(linearMean(gained) / linearMean(plain)).toBeCloseTo(2, 2);
    expect(gained.assumptions.join("\n")).toMatch(/profileGainTableMap: applied/u);
    // An identity RGB table (linear ProPhoto, 2 divisions) changes nothing beyond rounding.
    const identity = new Uint16Array(24);
    for (let r = 0; r < 2; r++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) identity.set([r * 65535, g * 65535, b * 65535], ((r * 2 + g) * 2 + b) * 3);
    const tabled = await developDngImage({ ...raw, rgbTables: { compositeMethod: "weighted-sum", tables: [{ semanticName: "", divisions: 2, gamma: "linear", primaries: "prophoto", gamut: "clip", samples: identity }] } }, { format: "srgb-16" });
    for (let i = 0; i < plain.samples.length; i++) expect(Math.abs(tabled.samples[i]! - plain.samples[i]!)).toBeLessThanOrEqual(2);
    expect(tabled.assumptions.join("\n")).toMatch(/rgbTables: applied/u);
    // AsShotWhiteXY when there is no AsShotNeutral; D65 when the file states neither.
    const xy = await developDngImage({ ...raw, asShotNeutral: null, asShotWhiteXy: plain.whiteBalance.chromaticity }, { format: "srgb-16" });
    expect(xy.whiteBalance.source).toBe("as-shot-white-xy");
    for (let i = 0; i < plain.samples.length; i++) expect(Math.abs(xy.samples[i]! - plain.samples[i]!)).toBeLessThanOrEqual(2);
    const fallback = await developDngImage({ ...raw, asShotNeutral: null }, { baselineExposure: false });
    expect(fallback.whiteBalance.source).toBe("default-d65");
    expect(fallback.assumptions.join("\n")).toMatch(/D65 is used/u);
    // Two calibration illuminants (A and D65) with the same matrices interpolate to the same development; an undefined one uses ColorMatrix1.
    const two = await developDngImage({ ...raw, colorMatrix2: raw.colorMatrix1, forwardMatrix2: raw.forwardMatrix1, calibrationIlluminant2: 17 }, { format: "srgb-16" });
    expect(Array.from(two.samples)).toEqual(Array.from(plain.samples));
    const unknown = await developDngImage({ ...raw, colorMatrix2: raw.colorMatrix1, calibrationIlluminant2: 255 });
    expect(unknown.assumptions.join("\n")).toMatch(/ColorMatrix1 alone/u);
    // CameraCalibration is skipped when its signature does not match the profile's.
    const mismatch = await developDngImage({ ...raw, cameraCalibration1: [2, 0, 0, 0, 2, 0, 0, 0, 2], cameraCalibrationSignature: "a", profileCalibrationSignature: "b" }, { format: "srgb-16" });
    expect(Array.from(mismatch.samples)).toEqual(Array.from(plain.samples));
    expect(mismatch.assumptions.join("\n")).toMatch(/CameraCalibration is not applied/u);
    await expect(developDngImage(raw, { gamutHandling: "reject-out-of-range", exposurePushStops: 6 })).rejects.toThrow(InvalidScientificInputError);
    await expect(developDngImage(raw, { whiteBalance: { chromaticity: { x: 0.9, y: 0.2 } } })).rejects.toThrow(InvalidConfigurationError);
  }, scaledTimeout(60_000));

  it("develops a LinearRaw file without a demosaic and uses ColorMatrix1 with Bradford when there is no ForwardMatrix", async () => {
    const codes = new Uint16Array(16 * 12 * 3);
    for (let i = 0; i < codes.length; i++) codes[i] = 512 + [4000, 8000, 5000][i % 3]!;
    const raw = parseDngRawImage({ bytes: syntheticDng({ photometric: 34892, spp: 3, codes }) });
    const dev = await developDngImage(raw);
    expect(dev).toMatchObject({ width: 16, height: 12, demosaic: "none" });
    expect(dev.assumptions.join("\n")).toMatch(/no ForwardMatrix/u);
    for (let i = 3; i < dev.samples.length; i++) expect(dev.samples[i]).toBe(dev.samples[i % 3]);
    // A camera value equal to the neutral is white: AsShotNeutral (0.5, 1, 0.6) times a common scale develops to gray.
    const gray = Uint16Array.from({ length: codes.length }, (_, i) => 512 + Math.round([0.5, 1, 0.6][i % 3]! * 0.2 * (16383 - 512)));
    const g = await developDngImage(parseDngRawImage({ bytes: syntheticDng({ photometric: 34892, spp: 3, codes: gray }) }));
    expect(Math.abs(g.samples[0]! - g.samples[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(g.samples[2]! - g.samples[1]!)).toBeLessThanOrEqual(1);
  });
});

describe("dual-gain switch catalog and the denoised-file check (2.24.0)", () => {
  it("ships only cited entries and finds none for an unknown camera", async () => {
    const { DNG_GAIN_SWITCH_CATALOG, resolveDngGainSwitch } = await import("../src/index.js");
    for (const e of DNG_GAIN_SWITCH_CATALOG) {
      expect(e.make.trim().length * e.model.trim().length).toBeGreaterThan(0);
      expect(e.highGainFromIso === null || (Number.isFinite(e.highGainFromIso) && e.highGainFromIso >= 50)).toBe(true);
      expect(e.source.url).toMatch(/^https:\/\//u);
      expect(e.source.terms.length * e.source.title.length).toBeGreaterThan(0);
    }
    expect(new Set(DNG_GAIN_SWITCH_CATALOG.map((e) => e.make.toLowerCase() + "\u0000" + e.model)).size).toBe(DNG_GAIN_SWITCH_CATALOG.length);
    expect(resolveDngGainSwitch({ make: "Photivra", model: "Photivra Virtual Camera" })).toBeNull();
    expect(resolveDngGainSwitch({ make: null, model: null })).toBeNull();
    expect(() => resolveDngGainSwitch({} as never)).toThrow(InvalidConfigurationError);
  });

  it("passes engine RAWs of smooth and textured scenes at every ISO (no false denoised-file refusal at 0.85)", async () => {
    const scenes = [{ preset: "uniform", reflectance: 0.18 }, { preset: "uniform", reflectance: 0.02 }, { preset: "step-wedge" }, { preset: "slanted-edge" },
      { preset: "siemens-star" }, { preset: "dead-leaves", seed: 1 }, { preset: "color-patches" }, { preset: "zone-plate" }] as const;
    let lowest = Infinity, refused = 0, checked = 0;
    for (const iso of [100, 800, 3200, 12800]) for (const scene of scenes) {
      const c = await simulateCapture({ scene, illuminanceLux: 21481 * 15 / 125, exposure: { mode: "manual", iso, shutterSeconds: (1 / 15) * (100 / iso) },
        sensor: { noiseSeed: 2 }, output: { width: 192, height: 192, format: "dng" } });
      const raw = parseDngRawImage({ bytes: c.image.dng! }), result = assessDngRawWhatIf(raw, { exposureStops: -1, seed: 1 });
      const ratio = estimateDngRawNoise(raw).planes.find((p) => p.color === "green")!.measuredToProfile;
      if (ratio !== null) { checked++; lowest = Math.min(lowest, ratio); }
      if (!result.allowed) refused++;
    }
    // Measured on this tree: 32 of 32 cases checked, none refused; the lowest green ratio 0.95 (dark uniform patches read lowest).
    expect(refused).toBe(0);
    expect(checked).toBe(32);
    expect(lowest).toBeGreaterThan(0.9);
  }, scaledTimeout(240_000));
});
