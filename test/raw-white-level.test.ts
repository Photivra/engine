// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { createNativeRawTask, simulateSensorRawFrame, createSensorRawFrame, type NativeRawTile } from "../src/index.js";
import { calculateEffectiveSaturationCode, calculateSiteEffectiveSaturationCode, createPhaseWhiteLevelAccumulator, nativeCfaPhaseIndex } from "../src/capture/raw-white-level.js";
import { calculateNativeRawSite } from "../src/capture/sensor-raw-producer.js";
import { nativeRawFixture } from "./helpers/native-raw-fixture.js";
import { loadSensorRawFrameInput } from "./helpers/sensor-raw-frame-fixture.js";

const readout = { physicalChargeCapacityElectrons: 20000, preAdcSaturationElectronEquivalent: 30000, systemConversionGainElectronsPerCode: 1,
  blackLevelCode: 512, digitalSaturationCode: 65535 };
describe("effective RAW white level", () => {
  it("is min(D, round(B + min(C, P)/G)) — the review r4 generic preset clips at 20512, not 65535", () => {
    expect(calculateEffectiveSaturationCode(readout)).toBe(20512);
    expect(calculateEffectiveSaturationCode({ ...readout, preAdcSaturationElectronEquivalent: 12000, systemConversionGainElectronsPerCode: .25 })).toBe(48512);
    expect(calculateEffectiveSaturationCode({ ...readout, systemConversionGainElectronsPerCode: .25 })).toBe(65535);
    expect(calculateEffectiveSaturationCode({ ...readout, physicalChargeCapacityElectrons: 1000.5 })).toBe(1513);
    // Optional ADC fields: INL at the saturating input code, ADC range limit, then digital gain about black.
    const inl = { kind: "piecewise-linear-code-offset" as const, knots: [{ code: 0, offsetCodes: 0 }, { code: 40000, offsetCodes: -20 }] };
    expect(calculateEffectiveSaturationCode({ ...readout, integralNonLinearity: inl })).toBe(20512+Math.round(-20*20512/40000));
    expect(calculateEffectiveSaturationCode({ ...readout, digitalGain: 2 })).toBe(40512);
    expect(calculateEffectiveSaturationCode({ ...readout, adcMaximumCode: 4095, digitalGain: 4 })).toBe(Math.min(65535, (4095-512)*4+512));
    expect(calculateEffectiveSaturationCode({ ...readout, digitalGain: 1, adcMaximumCode: 65535 })).toBe(20512);
    for (const bad of [{ digitalGain: .5 }, { adcMaximumCode: 100 }]) expect(() => calculateEffectiveSaturationCode({ ...readout, ...bad })).toThrow();
    for (const bad of [{ systemConversionGainElectronsPerCode: 0 }, { physicalChargeCapacityElectrons: NaN }, { blackLevelCode: 65535 },
      { digitalSaturationCode: 70000 }, { physicalChargeCapacityElectrons: .1 }]) {
      expect(() => calculateEffectiveSaturationCode({ ...readout, ...bad })).toThrow();
    }
  });
  it("agrees with the readout model: a physically saturated site encodes to the white level within read noise", () => {
    const f = nativeRawFixture(2, 2);
    // Fixture sites 1-3 hold 15, 104 and 824 e⁻; site 0 holds none.
    for (const i of [1, 2, 3]) {
      const site = f.site(i%2, Math.floor(i/2));
      site.capacityProfile = { ...site.capacityProfile, capacityElectrons: 5 };
      const r = calculateNativeRawSite(site, 1, i).readout.value;
      expect(r.physicalScalarSaturationApplied).toBe(true); expect(calculateEffectiveSaturationCode(r)).toBe(69);
      expect(Math.abs(r.rawCode-calculateEffectiveSaturationCode(r))).toBeLessThanOrEqual(Math.ceil(6*r.electronicReadNoiseComponents[0]!.rmsElectrons));
    }
  });
  it("matches a saturated noiseless site exactly through INL and post-ADC digital gain (per-ISO regimes)", () => {
    const f = nativeRawFixture(2, 2);
    for (const i of [1, 2, 3]) {
      const site = f.site(i%2, Math.floor(i/2));
      site.capacityProfile = { ...site.capacityProfile, capacityElectrons: 5 };
      const regimes = site.readoutProfile.regimes.map((r) => ({ ...r, readNoiseComponents: r.readNoiseComponents.map((c) => ({ ...c, rmsElectrons: { ...c.rmsElectrons, value: 0 } })),
        adc: { ...r.adc, digitalGain: 2, integralNonLinearity: { kind: "piecewise-linear-code-offset" as const,
          knots: [{ code: 0, offsetCodes: 0 }, { code: 1023, offsetCodes: 60 }], evidence: r.evidence } } }));
      site.readoutProfile = { ...site.readoutProfile, regimes };
      const r = calculateNativeRawSite(site, 1, i).readout.value;
      expect(r.physicalScalarSaturationApplied).toBe(true);
      const white = calculateSiteEffectiveSaturationCode(r, site.readoutProfile, site.regimeId);
      expect(white).toBe(r.rawCode); expect(white).toBe(Math.round((Math.round(69+60*69/1023)-64)*2+64));
      expect(white).not.toBe(calculateEffectiveSaturationCode(r));
    }
    expect(() => calculateSiteEffectiveSaturationCode(readout, { regimes: [] }, "base")).toThrow("selected readout regime");
  });
  it("is retained once per CFA phase by packed native RAW and per sample by the bounded frame", async () => {
    const f = nativeRawFixture(4, 2), task = createNativeRawTask(f.input, f.provider); await task.run();
    const out = task.takeOutput(); expect(Array.from(out.effectiveSaturationCodes)).toEqual([1023, 1023, 1023, 1023]);
    const frame = simulateSensorRawFrame(f.reference).value.frame;
    expect(frame.samples.map((s) => [s.effectiveSaturationCode, s.systemConversionGainElectronsPerCode, s.readNoiseRmsElectrons]))
      .toEqual(Array(4).fill([1023, 1, 2]));
    // Lowering capacity at one phase lowers that phase's white level only.
    const g = nativeRawFixture(4, 2), provider = { ...g.provider, readTile: async (r: Parameters<typeof g.provider.readTile>[0], signal: AbortSignal): Promise<NativeRawTile> => {
      const tile = await g.provider.readTile(r, signal);
      return { ...tile, sites: tile.sites.map((s, j) => (r.x+j)%2 === 1 && r.y%2 === 0 ? { ...s, capacityProfile: { ...s.capacityProfile, capacityElectrons: 500 } } : s) };
    } };
    const lowered = createNativeRawTask(g.input, provider); await lowered.run();
    expect(Array.from(lowered.takeOutput().effectiveSaturationCodes)).toEqual([1023, 564, 1023, 1023]);
  });
  it("fails closed when sites of one CFA phase disagree", async () => {
    const accumulator = createPhaseWhiteLevelAccumulator(4, 2, 2);
    accumulator.record(0, 900); accumulator.record(2, 900); expect(() => accumulator.record(8, 901)).toThrow("one effective white level per CFA phase");
    expect(() => createPhaseWhiteLevelAccumulator(2, 2, 2).finish()).toThrow();
    expect(nativeCfaPhaseIndex(13, 4, 2, 2)).toBe(3);
    const g = nativeRawFixture(4, 2), provider = { ...g.provider, readTile: async (r: Parameters<typeof g.provider.readTile>[0], signal: AbortSignal): Promise<NativeRawTile> => {
      const tile = await g.provider.readTile(r, signal);
      return { ...tile, sites: tile.sites.map((s, j) => r.x+j === 2 && r.y === 0 ? { ...s, capacityProfile: { ...s.capacityProfile, capacityElectrons: 500 } } : s) };
    } };
    const task = createNativeRawTask(g.input, provider); await expect(task.run()).rejects.toThrow("one effective white level per CFA phase");
    const raw = loadSensorRawFrameInput(), frame = createSensorRawFrame(raw);
    expect(frame.samples[3]!.effectiveSaturationCode).toBe(1023);
  });

  // #721: the render loops record by phase from x and y; the accumulator must not depend on which call they use.
  it("records the same codes by phase as by native index, and still throws for a disagreeing site", () => {
    const W = 5, H = 3, codes = [1001, 1002, 1003, 1004];
    const byIndex = createPhaseWhiteLevelAccumulator(W, 2, 2), byPhase = createPhaseWhiteLevelAccumulator(W, 2, 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const phase = (y % 2) * 2 + x % 2;
      expect(nativeCfaPhaseIndex(y * W + x, W, 2, 2)).toBe(phase);
      byIndex.record(y * W + x, codes[phase]!); byPhase.recordPhase(phase, codes[phase]!);
    }
    expect(Array.from(byPhase.finish())).toEqual(Array.from(byIndex.finish()));
    expect(() => byPhase.recordPhase(3, 1005)).toThrow("one effective white level per CFA phase");
  });
});
