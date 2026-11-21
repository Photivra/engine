// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  createTtlScaledFlashProfile,
  calculateCaptureExposureWindows,
  calculateFlashGuideNumber,
  calculateFlashPowerForDistance,
  InvalidScientificResultError,
  createHighSpeedSyncIlluminationOverlay,
  createManualFlashIlluminationOverlay,
  integrateSceneIlluminationTemporalMultiplierOverExposureWindow,
  parseExposureMeteringProfile,
  parseFlashSyncCapabilityProfile,
  parseManualFlashProfile,
  parseSceneIlluminationProfile,
  resolveCaptureGeometry,
  resolveCaptureMode,
  resolveCaptureModeTiming,
  resolveHighSpeedFlashSync,
  resolveManualFlashSync,
  resolveTtlFlashExposure,
  type ExposureMeteringProfile,
  type ExposureMeteringSampleSet,
  type FlashSyncCapabilityProfile,
  type TtlFlashExposure,
  type ManualFlashProfile,
  type ResolvedCaptureModeTiming
} from "../src/index.js";
import { probeSubObjects } from "./helpers/sub-object-probe.js";

const evidence = (ref: string): [{ sourceOrigin: "photivra"; sourceReference: string; reuseStatus: "photivra-owned" }] =>
  [{ sourceOrigin: "photivra", sourceReference: "test:" + ref, reuseStatus: "photivra-owned" }];

const PULSE = .001;
const flash = (): ManualFlashProfile => parseManualFlashProfile({ schemaVersion: "0.1.0", profileId: "flash-1", profileVersion: "1.0.0",
  sourceTemplate: { sourceId: "flash-source", family: "point", geometry: { kind: "point-position", positionM: { x: 0, y: 1, z: 0 } },
    magnitude: { kind: "relative-linear-scale", scale: 2, scientificStatus: "approximation", limitation: "Generic relative output." },
    spectrum: { kind: "unresolved", limitation: "test" }, evidence: evidence("source"), limitations: ["Point source."] },
  pulse: { waveformId: "pulse", scientificStatus: "approximation", supportDurationSeconds: PULSE, interpolation: "piecewise-linear",
    samples: [{ timeSecondsFromWaveformReference: 0, relativeMagnitudeMultiplier: 0 },
      { timeSecondsFromWaveformReference: PULSE/2, relativeMagnitudeMultiplier: 1 },
      { timeSecondsFromWaveformReference: PULSE, relativeMagnitudeMultiplier: 0 }],
    normalization: "relative-peak-one", evidence: evidence("pulse"), limitations: ["Triangular pulse."] },
  outputControl: { kind: "relative-linear-source-scale", scale: .5, flashExposureCompensationStops: 0 },
  ttlModeled: false, highSpeedSyncModeled: false, recycleBehaviorModeled: false, redEyePreflashModeled: false,
  modelingLightModeled: false, afAssistModeled: false, evidence: evidence("flash"), limitations: ["Manual flash."] });

const capabilities = (hss: boolean): FlashSyncCapabilityProfile => parseFlashSyncCapabilityProfile({ schemaVersion: "0.2.0", profileId: "sync", profileVersion: "1",
  captureModeId: "still", timingProfileId: "timing", supportedOrdinarySyncModes: ["front-curtain", "rear-curtain"],
  highSpeedSyncSupported: hss, ...(hss ? { highSpeedSync: { burstEnergyFractionOfFullPulse: .8, evidence: evidence("hss") } } : {}),
  ordinarySyncRequiresWholeActiveFrameSimultaneouslyExposed: true, evidence: evidence("sync"), limitations: ["Generic sync."] });

/** Mechanical focal-plane shutter with both curtains traversing top-to-bottom in `traversal` seconds. */
const timing = (shutter: number, traversal: number): ResolvedCaptureModeTiming => {
  const nativeRaster = { pixelWidth: 10, pixelHeight: 10 };
  const scan = { kind: "uniform-linear-native-scan" as const, directionNative: { value: "top-to-bottom" as const, evidence: evidence("dir") },
    traversalDurationSeconds: { value: traversal, unit: "s" as const, evidence: evidence("traversal") } };
  return resolveCaptureModeTiming({ captureMode: resolveCaptureMode({ nativeRaster, modeId: "still", profile: { schemaVersion: "0.1.0",
    modes: [{ modeId: "still", evidence: evidence("mode"), acquisition: { kind: "single-frame" }, perFrameSampling: { kind: "native-effective-raster" },
      processedImageRaster: { value: nativeRaster, evidence: evidence("raster") }, dependencies: ["mode-specific-readout-timing"] }] } }),
  timingProfile: { schemaVersion: "0.1.0", profileId: "timing", profileVersion: "1", captureModeId: "still", scientificStatus: "approximation",
    scheduleFamily: "global-or-uniform-linear-native-scan", shutterMechanism: "mechanical", opening: scan, closing: scan,
    readout: { readoutMode: "global", captureReadoutDurationSeconds: { value: .01, unit: "s", evidence: evidence("readout") } },
    nonUniformScheduleModeled: false, evidence: evidence("timing"), limitations: ["Uniform curtains."] },
  nominalExposureDurationSeconds: { value: shutter, unit: "s", evidence: evidence("shutter") } });
};

const base = parseSceneIlluminationProfile({ schemaVersion: "0.1.0", profileId: "ambient", sceneId: "room", evidence: evidence("ambient"),
  sources: [{ sourceId: "sky", family: "point", enabled: true, geometry: { kind: "point-position", positionM: { x: 0, y: 3, z: 1 } },
    magnitude: { kind: "relative-linear-scale", scale: 1, scientificStatus: "approximation", limitation: "test" },
    spectrum: { kind: "unresolved", limitation: "test" }, temporalBehavior: { kind: "time-invariant" }, evidence: evidence("sky") }] });

/** Flash energy (source scale × integrated waveform) received by native rows over their own windows. */
function rowFlashEnergy(overlay: ReturnType<typeof createManualFlashIlluminationOverlay>, t: ResolvedCaptureModeTiming, rows: number[]): number[] {
  const windows = calculateCaptureExposureWindows({ nativeRaster: t.nativeRaster, shutterMechanism: "mechanical",
    nominalExposureDurationSeconds: t.exposureWindows.nominalExposureDurationSeconds, opening: t.exposureWindows.opening.schedule.kind === "simultaneous"
      ? { kind: "simultaneous" } : t.exposureWindows.opening.schedule, closing: t.exposureWindows.closing.schedule.kind === "simultaneous"
      ? { kind: "simultaneous" } : t.exposureWindows.closing.schedule, samplePointsNative: rows.map(y => ({ x: 5, y })) }).value;
  const source = overlay.illuminationProfile.sources.find(s => s.sourceId === "flash-source")!;
  if (source.magnitude.kind !== "relative-linear-scale") throw new Error("Expected relative magnitude.");
  const scale = source.magnitude.scale;
  return rows.map((_, sampleIndex) => scale*integrateSceneIlluminationTemporalMultiplierOverExposureWindow({ illuminationProfile: overlay.illuminationProfile,
    temporalProfile: overlay.temporalProfile!, sourceId: "flash-source", exposureWindows: windows, sampleIndex, temporalSampleCount: 2000 })
    .integratedEffectiveRelativeMagnitudeSeconds);
}

describe("guide number", () => {
  it("follows GN = d·N with GN ∝ √power·√ISO", () => {
    expect(calculateFlashGuideNumber({ fullPowerGuideNumberMetersIso100: 40, powerFraction: .25, iso: 400 })).toBeCloseTo(40, 14);
    expect(calculateFlashGuideNumber({ fullPowerGuideNumberMetersIso100: 40, powerFraction: 1, iso: 100 })).toBe(40);
    const exact = calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: 5, apertureFNumber: 4, iso: 100,
      minimumPowerFraction: 1/128 });
    expect(exact).toEqual({ requiredPowerFraction: .25, powerFraction: .25, status: "within-range", flashExposureErrorStops: 0, maximumDistanceM: 10 });
    const far = calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: 20, apertureFNumber: 4, iso: 100,
      minimumPowerFraction: 1/128 });
    expect(far).toMatchObject({ status: "clamped-at-full-power", requiredPowerFraction: 4, powerFraction: 1, flashExposureErrorStops: -2 });
    const near = calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: .25, apertureFNumber: 2, iso: 100,
      minimumPowerFraction: 1/128 });
    expect(near.status).toBe("clamped-at-minimum-power");
    expect(near.flashExposureErrorStops).toBeCloseTo(Math.log2((1/128)/((.5/40)**2)), 12);
    expect(() => calculateFlashGuideNumber({ fullPowerGuideNumberMetersIso100: 40, powerFraction: 1.5, iso: 100 })).toThrow("(0, 1]");
  });
});

// foundation-10 (#699): the two scalar helpers refuse a non-finite result.
describe("guide number edge inputs", () => {
  it("refuses an infinite guide number or power fraction", () => {
    expect(() => calculateFlashGuideNumber({ fullPowerGuideNumberMetersIso100: 1e308, powerFraction: 1, iso: 1e308 })).toThrow(InvalidScientificResultError);
    expect(() => calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: 1e308, apertureFNumber: 4, iso: 100, minimumPowerFraction: 1 / 128 }))
      .toThrow(InvalidScientificResultError);
    expect(calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: 5, apertureFNumber: 4, iso: 100, minimumPowerFraction: 1 / 128 }))
      .toMatchObject({ requiredPowerFraction: 0.25, powerFraction: 0.25, flashExposureErrorStops: 0, status: "within-range" });
  });
});

describe("TTL pre-flash exposure", () => {
  const meter = (policy: Record<string, unknown> = { kind: "multi-zone-uniform" }): ExposureMeteringProfile => parseExposureMeteringProfile({ schemaVersion: "0.1.0",
    profileId: "ttl-meter", scientificStatus: "approximation", inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture",
    policy, target: { kind: "relative-signal-reference", targetRelativeSignal: .18, evidence: evidence("target") }, evidence: evidence("meter"),
    limitations: ["Relative TTL meter."] });
  const zones = (signals: number[], id = "m"): ExposureMeteringSampleSet => ({ measurementId: id, sceneStateId: "scene",
    inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture",
    captureGeometry: resolveCaptureGeometry({ imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: { pixelWidth: 60, pixelHeight: 40 },
      orientation: "landscape" }).value,
    processingState: { exposureSettingsApplied: false, whiteBalanceApplied: false, toneMappingApplied: false, displayGammaApplied: false,
      sharpeningApplied: false },
    samples: signals.map((relativeLinearSignal, i) => ({ sampleId: "z" + i, positionOrientedCaptureUv: { u: .25+.5*(i%2), v: .25+.5*Math.floor(i/2) },
      relativeLinearSignal, areaWeight: 1 })) });
  const ambient = zones([.02, .02, .04, .04], "ambient"), preflash = zones([.12, .12, .06, .06], "pre");
  const ttl = (overrides: Record<string, unknown> = {}): TtlFlashExposure => resolveTtlFlashExposure({ meteringProfile: meter(), ambientSampleSet: ambient,
    preFlashSampleSet: preflash, preFlashPowerFraction: 1/32, ambientScaleToMainExposure: .5, flashExposureCompensationStops: 0,
    minimumPowerFraction: 1/128, ...overrides }).value;

  it("solves p = (T·2^FEC − k·A)/(F·s) from the pre-flash response", () => {
    // A = 0.03, flash-only mean 0.06 at 1/32 power → F = 1.92 per full power; k·A = 0.015.
    const result = ttl({ guideNumber: { fullPowerGuideNumberMetersIso100: 40, iso: 100, apertureFNumber: 4 } });
    expect(result.status).toBe("resolved");
    expect(result.ambientMainExposureMeteredSignal).toBeCloseTo(.015, 15);
    expect(result.flashMeteredSignalPerFullPower).toBeCloseTo(1.92, 13);
    expect(result.powerFraction).toBeCloseTo((.18-.015)/1.92, 14);
    expect(result.predictedMeteredSignal).toBeCloseTo(.18, 14);
    expect(result.predictedExposureErrorStops).toBeCloseTo(0, 12);
    expect(result.effectiveGuideNumberMetersAtIso).toBeCloseTo(40*Math.sqrt(result.powerFraction!), 12);
    expect(result.flashRangeAtApertureM).toBeCloseTo(10*Math.sqrt(result.powerFraction!), 12);
    expect(ttl({ flashExposureCompensationStops: 1 }).powerFraction).toBeCloseTo((.36-.015)/1.92, 14);
    // HSS delivers only η·t_e/D of the pulse energy per line, so more power is commanded.
    expect(ttl({ syncEnergyFactor: .25 }).powerFraction).toBeCloseTo(4*(.18-.015)/1.92, 13);
  });

  it("clamps to the power range, reports ambient-only and no-return states, and stays linear-policy only", () => {
    const full = ttl({ flashExposureCompensationStops: 4 });
    expect(full.status).toBe("clamped-at-full-power");
    expect(full.powerFraction).toBe(1);
    expect(full.predictedExposureErrorStops).toBeCloseTo(Math.log2((.015+1.92)/(.18*16)), 12);
    const bright = ttl({ ambientScaleToMainExposure: 10 });
    expect(bright).toMatchObject({ status: "clamped-at-minimum-power", powerFraction: 1/128, ambientAloneReachesTarget: true });
    expect(ttl({ preFlashSampleSet: zones([.02, .02, .04, .04]) })).toMatchObject({ status: "no-flash-return", powerFraction: null,
      requiredPowerFraction: null });
    expect(ttl({ preFlashSampleSet: zones([.02, .02, .04, .04]), ambientScaleToMainExposure: 0 }).predictedExposureErrorStops).toBeNull();
    expect(() => ttl({ meteringProfile: meter({ kind: "highlight-weighted", minimumWeightFraction: .2, exponent: 2 }) }))
      .toThrow("spatially linear metering policy");
    expect(() => ttl({ preFlashSampleSet: zones([.01, .12, .06, .06]) })).toThrow("must not be below the ambient");
    expect(() => ttl({ preFlashSampleSet: zones([.12, .12, .06]) })).toThrow("share scene state");
    expect(() => ttl({ preFlashSampleSet: { ...preflash, samples: preflash.samples.map((s, i) => ({ ...s, sampleId: "x"+i })) } }))
      .toThrow("zones must match");
    expect(() => ttl({ ambientScaleToMainExposure: -1 })).toThrow("ambientScaleToMainExposure");
    expect(() => ttl({ flashExposureCompensationStops: Number.NaN })).toThrow("flashExposureCompensationStops");
  });

  it("feeds the solved power into ordinary front- and rear-curtain sync unchanged", () => {
    const result = ttl(), scaled = createTtlScaledFlashProfile(flash(), result), slow = timing(.02, .005);
    expect(scaled.outputControl.scale).toBeCloseTo(.5*result.powerFraction!, 15);
    for (const syncMode of ["front-curtain", "rear-curtain"] as const) {
      const sync = resolveManualFlashSync({ flashEnabled: true, flashProfile: scaled, syncCapabilities: capabilities(false), timing: slow, syncMode });
      expect(sync.pulseStartSecondsFromCaptureReference).toBeCloseTo(syncMode === "front-curtain" ? .005 : .02-PULSE, 15);
      const overlay = createManualFlashIlluminationOverlay({ baseIlluminationProfile: base, flashProfile: scaled, resolvedSync: sync,
        illuminationProfileId: "with-flash", temporalProfileId: "flash-temporal" });
      // Every row receives the whole pulse: 2 × 0.5p × ∫pulse = p·PULSE/2.
      for (const energy of rowFlashEnergy(overlay, slow, [.5, 5, 9.5])) expect(energy).toBeCloseTo(result.powerFraction!*PULSE/2, 9);
    }
    expect(() => createTtlScaledFlashProfile(flash(), ttl({ preFlashSampleSet: zones([.02, .02, .04, .04]) }))).toThrow("no flash return");
  });
});

describe("high-speed sync", () => {
  const fast = timing(.001, .004); // 1/1000 s slit, 4 ms curtain travel: no whole-frame-open interval

  it("cannot use an ordinary pulse when the slit never uncovers the whole frame", () => {
    expect(() => resolveManualFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast,
      syncMode: "front-curtain" })).toThrow("no whole-frame-open interval");
    expect(() => resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(false), timing: fast,
      powerFraction: 1 })).toThrow("does not declare high-speed sync");
  });

  it("spreads η·p·E_pulse over D so every line gets η·t_e/D of the pulse (GN × √(η·t_e/D))", () => {
    const p = .5, eta = .8, D = .005, te = .001;
    const sync = resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast, powerFraction: p });
    expect(sync).toMatchObject({ syncStatus: "high-speed-sync-resolved", burstStartSecondsFromCaptureReference: 0, uniformAcrossActiveFrame: true,
      burstEnergyFractionOfFullPulse: eta, hssModeled: true });
    expect(sync.burstDurationSeconds).toBeCloseTo(D, 15);
    expect(sync.singlePulseIntegratedRelativeSeconds).toBeCloseTo(PULSE/2, 15);
    expect(sync.energyFractionOfSinglePulseRange.minimum).toBeCloseTo(eta*te/D, 13);
    expect(sync.guideNumberFactorRange.maximum).toBeCloseTo(Math.sqrt(eta*te/D), 13);
    const overlay = createHighSpeedSyncIlluminationOverlay({ baseIlluminationProfile: base, flashProfile: flash(), resolvedSync: sync,
      illuminationProfileId: "with-hss", temporalProfileId: "hss-temporal" });
    // Top, middle and bottom lines all integrate the same burst energy: 2 × 0.5 × p × η × E_pulse × t_e/D.
    for (const energy of rowFlashEnergy(overlay, fast, [.5, 5, 9.5])) expect(energy).toBeCloseTo(p*eta*(PULSE/2)*te/D, 9);
    // Halving the slit time (same curtain travel) lowers the per-line energy by t_e/(t_e+τ) scaling.
    const faster = resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true),
      timing: timing(.0005, .004), powerFraction: p });
    expect(faster.guideNumberFactorRange.minimum).toBeCloseTo(Math.sqrt(eta*.0005/.0045), 13);
    const bound = resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast,
      powerFraction: p, releaseFrame: { sequenceId: "s", frameIndex: 0, releaseFrameId: "s:0", exposureStartTimeSeconds: 1,
        exposureEndTimeSeconds: 1.001, sceneTimeSecondsFromSequenceStart: .5, startIntervalFromPreviousSeconds: null,
        timingConstraints: ["exposure-duration"], stochasticSeedUint32: 1, exposure: { aperture: 4, shutterSeconds: .001, iso: 100 },
        focus: { kind: "infinity" }, automation: { ae: "manual", af: "manual", awb: "manual" } } });
    expect(bound.releaseFrameBinding?.sceneTimeSecondsFromSequenceStartAtBurstStart).toBe(.5);
    expect(bound.releaseFrameBinding?.sceneTimeSecondsFromSequenceStartAtBurstEnd).toBeCloseTo(.5+D, 15);
    const off = resolveHighSpeedFlashSync({ flashEnabled: false, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast, powerFraction: p });
    expect(off).toMatchObject({ syncStatus: "disabled", burstFlashProfile: null, waveformTimeZeroSecondsFromCaptureReference: null, releaseFrameBinding: null });
    expect(createHighSpeedSyncIlluminationOverlay({ baseIlluminationProfile: base, flashProfile: flash(), resolvedSync: off,
      illuminationProfileId: "x", temporalProfileId: "y" }).flashApplied).toBe(false);
  });

  it("validates the HSS capability declaration and power", () => {
    expect(() => parseFlashSyncCapabilityProfile({ ...capabilities(true), highSpeedSync: { burstEnergyFractionOfFullPulse: 1.2, evidence: evidence("x") } }))
      .toThrow("at most 1");
    expect(() => parseFlashSyncCapabilityProfile({ ...capabilities(false), highSpeedSync: { burstEnergyFractionOfFullPulse: .5, evidence: evidence("x") } }))
      .toThrow("must be omitted");
    expect(() => parseFlashSyncCapabilityProfile({ ...capabilities(true), schemaVersion: "0.1.0" })).toThrow("must not claim HSS");
    expect(() => parseFlashSyncCapabilityProfile({ ...capabilities(true), schemaVersion: "9" })).toThrow("schemaVersion");
    expect(() => resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast,
      powerFraction: 0 })).toThrow("(0, 1]");
    expect(() => resolveHighSpeedFlashSync({ flashEnabled: true, flashProfile: flash(),
      syncCapabilities: { ...capabilities(true), timingProfileId: "other" }, timing: fast, powerFraction: 1 })).toThrow("must exactly match");
  });
});

describe("flash functions reject a missing, null or non-object sub-object with a domain error (2.0.0 pre-release review)", () => {
  const release = { sequenceId: "s", frameIndex: 0, releaseFrameId: "s:0", exposureStartTimeSeconds: 1, exposureEndTimeSeconds: 1.02,
    sceneTimeSecondsFromSequenceStart: .5, startIntervalFromPreviousSeconds: null, timingConstraints: ["exposure-duration"], stochasticSeedUint32: 1,
    exposure: { aperture: 4, shutterSeconds: .02, iso: 100 }, focus: { kind: "infinity" }, automation: { ae: "manual", af: "manual", awb: "manual" } };

  it("ordinary sync, HSS, both overlays and the flash profile parser", async () => {
    const slow = timing(.02, .005), fast = timing(.001, .004);
    const manual = { flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(false), timing: slow, syncMode: "front-curtain", releaseFrame: release };
    const hss = { flashEnabled: true, flashProfile: flash(), syncCapabilities: capabilities(true), timing: fast, powerFraction: .5 };
    const sync = resolveManualFlashSync(manual as never), burst = resolveHighSpeedFlashSync(hss as never);
    const cases: [string, (input: unknown) => unknown, object][] = [
      ["resolveManualFlashSync", (input): unknown => resolveManualFlashSync(input as never), manual],
      ["resolveHighSpeedFlashSync", (input): unknown => resolveHighSpeedFlashSync(input as never), hss],
      ["createManualFlashIlluminationOverlay", (input): unknown => createManualFlashIlluminationOverlay(input as never),
        { baseIlluminationProfile: base, flashProfile: flash(), resolvedSync: sync, illuminationProfileId: "with-flash", temporalProfileId: "flash-temporal" }],
      ["createHighSpeedSyncIlluminationOverlay", (input): unknown => createHighSpeedSyncIlluminationOverlay(input as never),
        { baseIlluminationProfile: base, flashProfile: flash(), resolvedSync: burst, illuminationProfileId: "with-hss", temporalProfileId: "hss-temporal" }],
      ["parseManualFlashProfile", (input): unknown => parseManualFlashProfile(input), flash()]
    ];
    for (const [name, call, input] of cases) {
      expect(() => call(input), name).not.toThrow();
      const { probedPaths, escaped } = await probeSubObjects(call, input, { maximumDepth: 4 });
      expect(probedPaths, name).toBeGreaterThan(0);
      expect(escaped, name).toEqual([]);
    }
  });
});
