// SPDX-License-Identifier: Apache-2.0
/**
 * Fixed-pattern noise and additional stored-charge components in the packed sensor stage (#277, 2.0):
 * the float64 reference against the per-site engine functions, and the `webgpu-f32` stage (fake device,
 * float32 emulation) against the reference with the "exact except flagged sites" guarantee.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assessSensorPhysicalChargeCapacity, calculatePackedSensorRawPlan, calculateSensorFixedPatternSite, simulateCapture, createImageKernelAccelerator, parseSensorChargeSamplingProfile,
  parseSensorReadoutConversionProfile, simulatePackedSensorRaw, simulateSensorChargeRealization, simulateSensorRawCode,
  type PackedSensorRawInput, type SensorAccumulatedChargeComposition, type SensorReadoutConversionProfile } from "../src/index.js";
import { createPackedFixedPattern, simulatePackedSensorSite } from "../src/capture/packed-sensor-raw.js";
import { evaluateFixedPatternColumnOffset, evaluateFixedPatternRowOffset, evaluateFixedPatternSiteFactors } from "../src/sensor/fixed-pattern-noise.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { deriveNativeSiteStreamSeedUint32, NATIVE_SITE_CHARGE_STREAM_ID, NATIVE_SITE_READ_NOISE_STREAM_ID } from "../src/sensor/stochastic-seed.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { corpusRandom, fixedPatternCorpus, fixedPatternProfile, readoutProfile } from "./helpers/sensor-stage-fixtures.js";

const evidence = [{ sourceOrigin: "photivra", sourceReference: "test:packed-fixed-pattern", reuseStatus: "photivra-owned" }] as const;
const fact = <T>(value: T): { value: T; evidence: typeof evidence } => ({ value, evidence });
type Model = "poisson" | "deterministic-expected-electron-equivalent";
const COMPONENTS: { id: string; model: Model }[] = [{ id: "leak", model: "poisson" }, { id: "offset", model: "deterministic-expected-electron-equivalent" },
  { id: "glow", model: "poisson" }];

/** A complete expected-charge composition for one colour site with the three additional components. */
function composition(site: { x: number; y: number }, photo: number, dark: number, extra: readonly number[]): SensorAccumulatedChargeComposition {
  const exposure = { stationarity: evidence, exposureBinding: { binding: evidence, colorSamplingProfile: evidence,
    nominalExposureDuration: evidence, openingBoundary: [], closingBoundary: [] } };
  const additional = extra.reduce((s, v) => s + v, 0);
  return {
    completenessProfileId: "complete", colorSamplingProfileId: "color", channelId: "green", site, bindingId: "binding",
    timeReference: "first-opening-boundary-phase", startOffsetSecondsFromOpeningReference: 0, endOffsetSecondsFromOpeningReference: 1,
    localExposureDurationSeconds: 1, photoExpectedElectronCount: photo, darkExpectedElectronCount: dark,
    additionalExpectedElectronCount: additional, totalExpectedStoredElectronCount: photo + dark + additional,
    additionalComponents: COMPONENTS.map((c, k) => ({ componentId: c.id, kind: "leakage", expectedElectronCount: extra[k]!, scientificStatus: "approximation",
      uncertainty: { kind: "not-quantified", limitation: "test" }, evidence })),
    accumulatedChargeCompleteness: "complete-for-physical-storage-capacity-assessment", completenessScientificStatus: "approximation",
    allCountsAreExpectationValues: true, integerChargeSampled: false, photoSignalIncluded: true, darkChargeIncluded: true,
    otherChargeIncluded: true, darkShotNoiseApplied: false, photoShotNoiseApplied: false, readNoiseApplied: false,
    physicalFullWellAssessmentAuthorized: true, cameraSaturationAssessmentAuthorized: false, saturationAssessed: false,
    bloomingModeled: false, adcQuantizationApplied: false, rawCodeValueProduced: false,
    componentEvidence: { completeness: evidence, photoSignal: exposure, darkCurrent: { darkCurrent: evidence, siteApproximation: [], exposure } }
  } as SensorAccumulatedChargeComposition;
}
const sampling = parseSensorChargeSamplingProfile({ schemaVersion: "0.1.0", profileId: "sampling", completenessProfileId: "complete",
  scientificStatus: "approximation", photoShotNoiseModel: "poisson", darkShotNoiseModel: "poisson",
  additionalComponentPolicies: COMPONENTS.map(c => ({ componentId: c.id, model: c.model })), evidence, limitations: ["test"] });
function readout(o: { gain: number; preAdc: number; sigmas: number[]; bitDepth?: number; black?: number; digitalGain?: number;
  inl?: { code: number; offsetCodes: number }[] }): SensorReadoutConversionProfile {
  const bitDepth = o.bitDepth ?? 14;
  return parseSensorReadoutConversionProfile({ schemaVersion: "0.1.0", profileId: "readout", colorSamplingProfileId: "color", channelId: "green",
    regimeSelectionOwnedBy: "explicit-upstream-camera-state-not-inferred-from-iso", evidence,
    regimes: [{ regimeId: "r", scientificStatus: "approximation", systemConversionGainElectronsPerCode: fact(o.gain),
      preAdcSaturationElectronEquivalent: fact(o.preAdc), readNoiseComponents: o.sigmas.map((s, i) => ({ componentId: `read-${i}`, rmsElectrons: fact(s), evidence })),
      adc: { bitDepth, blackLevelCode: o.black ?? 256, digitalSaturationCode: 2 ** bitDepth - 1, transfer: "uniform-round-half-up",
        ...(o.digitalGain === undefined ? {} : { digitalGain: o.digitalGain }),
        ...(o.inl === undefined ? {} : { integralNonLinearity: { kind: "piecewise-linear-code-offset", knots: o.inl, evidence } }) },
      evidence, limitations: ["test"] }] });
}
/** The per-site engine (the functions calculateNativeRawSite composes) at one native site. */
function engineSite(input: PackedSensorRawInput, column: number, row: number): { code: number; flags: number } {
  const i = row * input.region.width + column, nativeX = input.region.x + column, nativeY = input.region.y + row;
  const origin = input.fixedPatternNoise!.siteOrigin, site = { x: nativeX + origin.x, y: nativeY + origin.y };
  const index = nativeY * input.nativeWidth + nativeX, extra = input.additionalChargeComponents!.map(c => c.expectedElectrons[i]!);
  const charge = composition(site, input.photoElectrons[i]!, input.darkElectrons[i]!, extra);
  const capacity = assessSensorPhysicalChargeCapacity({ accumulatedCharge: charge, operatingStateId: "state", operatingTemperatureC: 20,
    capacityProfile: { schemaVersion: "0.1.0", profileId: "capacity", colorSamplingProfileId: "color", channelId: "green",
      capacityMeaning: "physical-charge-storage-capacity-electrons", capacityElectrons: input.physicalChargeCapacityElectrons, scientificStatus: "approximation",
      uncertainty: { kind: "not-quantified", limitation: "test" }, evidence, siteApplicability: { kind: "exact-site", site },
      operatingState: { stateId: "state", evidence }, temperatureApplicability: { kind: "exact-reference-temperature", temperatureC: 20 } } }).value;
  const fpn = input.fixedPatternNoise!.profile;
  const realization = simulateSensorChargeRealization({ accumulatedCharge: charge, samplingProfile: sampling, fixedPatternNoise: fpn,
    seedUint32: deriveNativeSiteStreamSeedUint32(input.captureSeedUint32, index, NATIVE_SITE_CHARGE_STREAM_ID) }).value;
  const r = simulateSensorRawCode({ chargeRealization: realization, physicalCapacityAssessment: capacity, readoutProfile: input.readoutProfile,
    regimeId: input.regimeId, fixedPatternNoise: fpn, readNoiseSeedUint32: deriveNativeSiteStreamSeedUint32(input.captureSeedUint32, index, NATIVE_SITE_READ_NOISE_STREAM_ID) }).value;
  return { code: r.rawCode, flags: Number(r.physicalScalarSaturationApplied) | Number(r.preAdcSaturationApplied) << 1 |
    Number(r.digitalSaturationApplied) << 2 | Number(r.lowerCodeClampApplied) << 3 };
}
function corpus(readoutProfileValue: SensorReadoutConversionProfile, capacity: number, seed: number, width = 24, height = 16,
  fpn = fixedPatternProfile({ hotFraction: 0.05 })): PackedSensorRawInput {
  const random = corpusRandom(seed), count = width * height;
  const levels = [0, 0.4, 7, 29.99, 30, 31.5, 400, 999.5, 1001, 30_000, 2e5];
  const photo = new Float64Array(count), dark = new Float64Array(count), extra = COMPONENTS.map(() => new Float64Array(count));
  for (let i = 0; i < count; i++) {
    photo[i] = levels[i % levels.length]! * (0.8 + 0.4 * random());
    dark[i] = random() < 0.4 ? 4 * random() : 0;
    extra[0]![i] = random() < 0.5 ? 0 : 20 * random();
    extra[1]![i] = random() < 0.3 ? 0 : 2.7 * random() + (random() < 0.05 ? capacity * random() : 0);
    extra[2]![i] = random() < 0.7 ? 0 : 500 * random();
  }
  return { schemaVersion: "0.1.0", nativeWidth: 64, nativeHeight: 40, region: { x: 5, y: 3, width, height }, captureSeedUint32: 0x1234abcd + seed,
    photoElectrons: photo, darkElectrons: dark, physicalChargeCapacityElectrons: capacity, readoutProfile: readoutProfileValue, regimeId: "r",
    fixedPatternNoise: { profile: fpn, colorSamplingProfileId: "color", siteOrigin: { x: 2, y: 7 } },
    additionalChargeComponents: COMPONENTS.map((c, k) => ({ componentId: c.id, model: c.model, expectedElectrons: extra[k]! })) };
}

describe("packed sensor reference with fixed-pattern noise and additional charge", () => {
  const regimes: [string, SensorReadoutConversionProfile, number][] = [
    ["unit gain", readout({ gain: 1, bitDepth: 10, black: 64, preAdc: 1000, sigmas: [2] }), 1000],
    ["fractional gain, fractional capacity, two noise sources", readout({ gain: 3.7, preAdc: 50_000, sigmas: [1.5, 0, 4.25] }), 1000.5],
    ["INL and digital gain", readout({ gain: 0.37, bitDepth: 12, preAdc: 1400, sigmas: [3], digitalGain: 1.75,
      inl: [{ code: 0, offsetCodes: 0 }, { code: 1000, offsetCodes: 1.5 }, { code: 3000, offsetCodes: -2.25 }, { code: 4095, offsetCodes: 0.5 }] }), 1000]
  ];
  it.each(regimes)("is bit-identical to the per-site engine functions: %s", (_, profile, capacity) => {
    const input = corpus(profile, capacity, Math.round(capacity)), packed = simulatePackedSensorRaw(input);
    const counts = [0, 0, 0, 0];
    for (let row = 0; row < input.region.height; row++) for (let column = 0; column < input.region.width; column++) {
      const reference = engineSite(input, column, row), i = row * input.region.width + column;
      expect(packed.codes[i], `site ${column},${row}`).toBe(reference.code);
      for (let b = 0; b < 4; b++) if (reference.flags & (1 << b)) counts[b]!++;
    }
    const d = packed.diagnostics;
    expect([d.physicalSaturationSiteCount, d.preAdcSaturationSiteCount, d.digitalSaturationSiteCount, d.lowerClampSiteCount]).toEqual(counts);
    // The corpus reaches the physical saturation path.
    expect(counts[0]).toBeGreaterThan(0);
  });
  it("uses the model's fixed-pattern values at the colour-site coordinates", () => {
    const input = corpus(regimes[0]![1], 1000, 3), plan = calculatePackedSensorRawPlan(input), pattern = createPackedFixedPattern(plan)!;
    const values = pattern(4, 2);
    expect(values.photoResponseGainFactor).not.toBe(1);
    // Without the pattern the means and offsets differ, so codes change at some sites.
    const plain = simulatePackedSensorRaw({ ...input, fixedPatternNoise: undefined } as unknown as PackedSensorRawInput);
    expect(plain.codes).not.toEqual(simulatePackedSensorRaw(input).codes);
  });
  it("validates the fixed-pattern block and the components", () => {
    const bad: ((v: PackedSensorRawInput) => void)[] = [
      (v): void => { v.fixedPatternNoise!.colorSamplingProfileId = "other"; },
      (v): void => { v.fixedPatternNoise!.siteOrigin = { x: -1, y: 0 }; },
      (v): void => { (v.fixedPatternNoise as unknown as Record<string, unknown>).extra = 1; },
      (v): void => { v.additionalChargeComponents![1]!.componentId = "leak"; },
      (v): void => { (v.additionalChargeComponents![0] as { model: string }).model = "gaussian"; },
      (v): void => { v.additionalChargeComponents![2]!.expectedElectrons = new Float64Array(3); },
      (v): void => { v.additionalChargeComponents![2]!.expectedElectrons[0] = -1; },
      (v): void => { v.additionalChargeComponents = Array.from({ length: 9 }, (_, k) => ({ componentId: `c${k}`, model: "poisson" as const,
        expectedElectrons: new Float64Array(v.region.width * v.region.height) })); }
    ];
    for (const mutate of bad) { const v = corpus(regimes[0]![1], 1000, 5); mutate(v); expect(() => calculatePackedSensorRawPlan(v)).toThrow(); }
    const plan = calculatePackedSensorRawPlan(corpus(regimes[0]![1], 1000, 5));
    expect(() => simulatePackedSensorSite(plan, 1, 0, 0)).toThrow(/extras/u);
  });
});

async function gpuAccelerator(maximumBandBytes?: number): Promise<Awaited<ReturnType<typeof createImageKernelAccelerator>>> {
  return createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu: createFakeGpu().gpu, ...(maximumBandBytes ? { maximumBandBytes } : {}) });
}
function repairedEqualsReference(input: PackedSensorRawInput, out: { codes: Uint16Array; flaggedSiteIndices: Uint32Array }, reference: Uint16Array): void {
  const plan = calculatePackedSensorRawPlan(input), pattern = createPackedFixedPattern(plan), flagged = new Set(out.flaggedSiteIndices);
  for (let i = 0; i < reference.length; i++) if (!flagged.has(i)) expect(out.codes[i], `unflagged site ${i}`).toBe(reference[i]);
  const repaired = out.codes.slice();
  for (const i of out.flaggedSiteIndices) {
    const row = Math.floor(i / input.region.width), column = i % input.region.width;
    repaired[i] = simulatePackedSensorSite(plan, input.photoElectrons[i]!, input.darkElectrons[i]!,
      (input.region.y + row) * input.nativeWidth + input.region.x + column, pattern === null ? null : pattern(column, row),
      (input.additionalChargeComponents ?? []).map(c => c.expectedElectrons[i]!)).code;
  }
  expect(repaired).toEqual(reference);
}

describe("webgpu-f32 sensor stage with fixed-pattern noise and additional charge (fake device)", () => {
  const cases: [string, SensorReadoutConversionProfile, number][] = [
    ["12-bit unit gain", readoutProfile(), 60_000],
    ["14-bit fractional gain, three noise sources", readoutProfile({ gain: 3.7, bitDepth: 14, black: 512, preAdc: 70_000, sigmas: [1.5, 0, 4.25] }), 60_000.5],
    ["INL and digital gain", readoutProfile({ gain: 18, bitDepth: 12, black: 256, saturation: 4000, preAdc: 66_000, sigmas: [3], digitalGain: 1.75,
      inl: [{ code: 0, offsetCodes: 0 }, { code: 1000, offsetCodes: 1.5 }, { code: 3000, offsetCodes: -2.25 }, { code: 4095, offsetCodes: 0.5 }] }), 60_000],
    ["noise-free power-of-two gain", readoutProfile({ gain: 2, bitDepth: 16, black: 0, preAdc: 70_000, sigmas: [0] }), 60_000]
  ];
  it.each(cases)("equals the reference at every unflagged site: %s", async (_, profile, capacity) => {
    const input = fixedPatternCorpus(97, 41, 13, profile, capacity), reference = simulatePackedSensorRaw(input);
    const a = await gpuAccelerator(), out = await a.simulateSensorRaw(input);
    expect(out.execution.errorBound).toMatchObject({ kind: "exact-except-flagged-sites", flaggedSiteCount: out.flaggedSiteIndices.length });
    repairedEqualsReference(input, out, reference.codes);
    expect(out.flaggedSiteIndices.length).toBeLessThan(reference.codes.length * 0.02);
    for (const key of Object.keys(reference.diagnostics) as (keyof typeof reference.diagnostics)[]) {
      expect(Math.abs(out.diagnostics[key] - reference.diagnostics[key])).toBeLessThanOrEqual(out.flaggedSiteIndices.length);
    }
    a.dispose();
  });
  it("CPU backend returns the reference", async () => {
    const input = fixedPatternCorpus(31, 9, 4), a = await createImageKernelAccelerator({ backend: "cpu-reference" });
    expect((await a.simulateSensorRaw(input)).codes).toEqual(simulatePackedSensorRaw(input).codes);
  });
  it("banding changes memory only, never codes", async () => {
    const input = fixedPatternCorpus(64, 37, 5);
    const whole = await (await gpuAccelerator()).simulateSensorRaw(input), banded = await (await gpuAccelerator(4096)).simulateSensorRaw(input);
    expect(banded.codes).toEqual(whole.codes);
    expect(Array.from(banded.flaggedSiteIndices)).toEqual(Array.from(whole.flaggedSiteIndices));
  });
  it("components alone, fixed pattern alone and neither all keep the guarantee", async () => {
    const full = fixedPatternCorpus(48, 20, 9);
    const variants = [{ ...full, fixedPatternNoise: undefined }, { ...full, additionalChargeComponents: undefined },
      { ...full, additionalChargeComponents: [full.additionalChargeComponents![1]!] }];
    for (const v of variants) {
      const input = JSON.parse(JSON.stringify({ ...v, photoElectrons: [], darkElectrons: [], additionalChargeComponents: [] })) as PackedSensorRawInput;
      Object.assign(input, { photoElectrons: v.photoElectrons, darkElectrons: v.darkElectrons });
      if (v.additionalChargeComponents) input.additionalChargeComponents = v.additionalChargeComponents; else delete (input as Partial<PackedSensorRawInput>).additionalChargeComponents;
      if (!v.fixedPatternNoise) delete (input as Partial<PackedSensorRawInput>).fixedPatternNoise;
      const out = await (await gpuAccelerator()).simulateSensorRaw(input);
      repairedEqualsReference(input, out, simulatePackedSensorRaw(input).codes);
    }
  });
  it("fails closed outside the float32 domain", async () => {
    const a = await gpuAccelerator();
    const hot = fixedPatternCorpus(8, 4, 1, readoutProfile(), 60_000, fixedPatternProfile({ hotFraction: 1, hotMultiplier: 1e6 }));
    hot.darkElectrons.fill(2000);
    await expect(a.simulateSensorRaw(hot)).rejects.toMatchObject({ reason: "unsupported-float32-domain" });
    const offsets = fixedPatternCorpus(8, 4, 1, readoutProfile(), 60_000, fixedPatternProfile({ row: 1e6, column: 1e6 }));
    await expect(a.simulateSensorRaw(offsets)).rejects.toMatchObject({ reason: "unsupported-float32-domain" });
    const big = fixedPatternCorpus(8, 4, 1);
    big.additionalChargeComponents![1]!.expectedElectrons.fill(2 ** 30);
    await expect(a.simulateSensorRaw(big)).rejects.toMatchObject({ reason: "unsupported-float32-domain" });
    a.dispose();
  });
});

// #689: the native capture computes the row and column offsets once per row and column and reuses one random stream.
describe("fixed-pattern noise per row and column (#689)", () => {
  it("gives every field of calculateSensorFixedPatternSite from the site factors and the row and column offsets", () => {
    for (const profile of [fixedPatternProfile(), fixedPatternProfile({ hotFraction: 0.3, seed: 7 }), fixedPatternProfile({ prnu: 0, dsnu: 0, hotFraction: 0, row: 0, column: 0 })]) {
      const rows = new Map<number, number>(), columns = new Map<number, number>();
      for (const y of [0, 1, 2, 17, 4095]) for (const x of [0, 1, 3, 64, 0xffff_ffff]) {
        const site = calculateSensorFixedPatternSite({ profile, site: { x, y } }), factors = evaluateFixedPatternSiteFactors(profile, x, y);
        if (!rows.has(y)) rows.set(y, evaluateFixedPatternRowOffset(profile, y));
        if (!columns.has(x)) columns.set(x, evaluateFixedPatternColumnOffset(profile, x));
        expect(Object.is(factors.photoResponseGainFactor, site.photoResponseGainFactor)).toBe(true);
        expect(Object.is(factors.darkCurrentFactor, site.darkCurrentFactor)).toBe(true);
        expect(factors.hotPixel).toBe(site.hotPixel);
        expect(Object.is(rows.get(y)! + columns.get(x)!, site.readoutOffsetElectrons)).toBe(true);
      }
    }
  });

  // Recorded on the code before the change (2.27.0 arithmetic): the RAW codes keep every bit.
  it("keeps the RAW codes of captures with fixed-pattern noise", async () => {
    const sha = (a: Uint16Array): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
    const cases: [Parameters<typeof simulateCapture>[0], string][] = [
      [{ scene: { preset: "slanted-edge" }, sensor: { fixedPatternNoise: true }, output: { width: 48, height: 32 } },
        "f45b189708314c5cc3a81f2eac97c58f6c14fec5c7e75eab2e48a0d10e55ca07"],
      [{ scene: { preset: "slanted-edge" }, sensor: { fixedPatternNoise: true }, output: { width: 48, height: 32, region: { x: 7, y: 5, width: 20, height: 13 } } },
        "cec144dd725d518ac640ff9d15f772147c85992eb62d15cf98bbd022139c21cd"],
      [{ scene: { preset: "siemens-star" }, sensor: { fixedPatternNoise: true }, fast: false, motion: { shutter: "rolling" }, output: { width: 40, height: 30 } },
        "63f66609899b50766376e9f4fd9a5137cd4822ba53200bb1cc3ff0f1d76bd33a"],
      [{ scene: { preset: "uniform" }, sensor: { fixedPatternNoise: true }, output: { width: 1, height: 1 } },
        "508c21562bbba61e895ca3ca039e1b85200219462e1349a1c19421236a6dd81b"]
    ];
    for (const [request, digest] of cases) expect(sha((await simulateCapture(request)).raw.codes)).toBe(digest);
  }, scaledTimeout(60_000));
});
