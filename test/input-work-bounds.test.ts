// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  calculateCaptureExtendedObjectTemporalProjection, calculateCaptureRotationTemporalQuadrature, calculateCaptureTranslationParallaxTemporalQuadrature, calculateDetailLimit,
  calculateStabilizedCaptureTemporalSamples, parseGenericBodyExposureCapabilityProfile, parseGenericLensExposureCapabilityProfile, parseGenericReleaseCapabilityProfile,
  parseSensorColorSamplingProfile, parseSensorSpectralResponseProfile, resolveChartScene, resolveGenericEquipmentExposureCapabilities,
  resolveReleaseSequence, InvalidConfigurationError, InvalidScientificInputError, type ChartScene
} from "../src/index.js";
import { calculateAiryCellEnergies, calculateAiryCellEnergiesInFrequencyDomain, createDiffractionLimitedPsfProfile } from "../src/optics/diffraction-psf-profile.js";
import { resolveParsedSensorSpectralResponseAtWavelength } from "../src/sensor/spectral-response.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.28.0: limits on inputs whose size sets the work or memory of one call (release sequences, temporal samples, composite charts,
 * spectral curves, diffraction cells), and domain errors for finite inputs that overflow the detail-limit geometry.
 */

const ev = (ref: string): [{ sourceOrigin: "photivra"; sourceReference: string; reuseStatus: "photivra-owned" }] => [{ sourceOrigin: "photivra", sourceReference: ref, reuseStatus: "photivra-owned" }];
const fact = <T>(value: T, ref = "x"): { value: T; evidence: ReturnType<typeof ev> } => ({ value, evidence: ev(ref) });

describe("release sequences hold at most 10,000 frames", () => {
  const release = (frames: number): unknown => ({ schemaVersion: "0.1.0", profileId: "release", profileVersion: "1.0.0", scientificStatus: "approximation", evidence: ev("r"),
    supportedDriveModes: fact(["single", "burst", "self-timer"]), maximumLogicalFramesPerSequence: fact(frames), maximumCadenceFps: fact(1e6),
    minimumInterFrameGapSeconds: fact(0), overlappingOrdinaryStillExposures: false,
    exposureBracketing: { availability: fact("supported"), supportedAxes: ["shutter", "iso", "aperture"] }, focusBracketing: { availability: fact("supported") } });
  const exposure = (): ReturnType<typeof resolveGenericEquipmentExposureCapabilities> => resolveGenericEquipmentExposureCapabilities({
    bodyProfile: parseGenericBodyExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: "body", profileVersion: "1.0.0", scientificStatus: "approximation", evidence: ev("b"),
      shutter: { durationSecondsRange: fact({ minimum: 1 / 8000, maximum: 30 }), settingGrid: { kind: "continuous-within-range" } },
      iso: { range: fact({ minimum: 50, maximum: 12800 }), settingGrid: { kind: "continuous-within-range" }, autoIso: fact("supported") } }),
    lensProfile: parseGenericLensExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: "lens", profileVersion: "1.0.0", scientificStatus: "approximation", evidence: ev("l"),
      focalLengthMmRange: fact({ minimum: 50, maximum: 50 }),
      aperture: { widestAvailableFNumber: { kind: "constant", fNumber: fact(1.4) }, narrowestAvailableFNumber: fact(22), settingGrid: { kind: "continuous-within-range" } } }),
    selectedFocalLengthMm: 50 });
  const sequence = (frames: number, profileFrames: number, bracket: unknown = { kind: "none" }): ReturnType<typeof resolveReleaseSequence> => resolveReleaseSequence({
    sequenceId: "s", releaseRequestTimeSeconds: 0, sequenceSeedUint32: 1, drive: { kind: "burst", frameCount: frames }, bracket: bracket as never, requestedCadenceFps: 1e6,
    baseState: { exposure: { aperture: 4, shutterSeconds: 1 / 8000, iso: 100 }, focus: { kind: "finite", distanceM: 5 }, automation: { ae: "locked", af: "locked", awb: "locked" } },
    releaseCapabilities: release(profileFrames) as never, exposureCapabilities: exposure() });

  it("refuses a capability profile above the limit and a longer sequence before building it", () => {
    expect(parseGenericReleaseCapabilityProfile(release(10_000) as never).maximumLogicalFramesPerSequence.value).toBe(10_000);
    expect(() => parseGenericReleaseCapabilityProfile(release(10_001) as never)).toThrow(InvalidConfigurationError);
    expect(() => sequence(20_000, 20_000)).toThrow(InvalidConfigurationError);
    expect(() => sequence(10_001, 10_000)).toThrow(InvalidScientificInputError);
    expect(sequence(3, 10_000).frames).toHaveLength(3);
  });

  it("refuses a bracket list above the limit before checking its entries", () => {
    const offsetsStops = new Array(5_000_000).fill(0), start = performance.now();
    expect(() => sequence(3, 10_000, { kind: "exposure", axis: "iso", offsetsStops })).toThrow(/at most 10000 frames/u);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(20));
  }, scaledTimeout(60_000));
});

describe("temporal-sample calculators take at most 256 samples and 65,536 nodes", () => {
  const point = { x: 3000, y: 2000 }, raster = { pixelWidth: 6000, pixelHeight: 4000 }, seconds = (value: number): unknown => ({ value, unit: "s", evidence: ev("t") });
  const timing = (points: { x: number; y: number }[]): never => ({ timingProfileId: "p", timingProfileVersion: "1", captureModeId: "m", nativeRaster: raster,
    exposureWindows: { samples: points.map((p) => ({ pointNative: p, startOffsetSecondsFromOpeningReference: 0, endOffsetSecondsFromOpeningReference: 0.01, localExposureDurationSeconds: 0.01 })) } }) as never;
  const points = (n: number): { x: number; y: number }[] => Array.from({ length: n }, (_, i) => ({ x: 100 + (i % 500) * 10, y: 100 + Math.floor(i / 500) * 10 }));
  const rotation = (count: number, n = 1, list?: unknown[]): unknown => calculateCaptureRotationTemporalQuadrature({ imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: raster, shutterMechanism: "electronic",
    nominalExposureDurationSeconds: seconds(0.01), opening: { kind: "simultaneous" }, closing: { kind: "simultaneous" }, focalLengthMm: 50, angularVelocityRadPerSec: { pitch: 0, yaw: 0.1, roll: 0 },
    orientation: "landscape", temporalSampleCount: count, samplePointsNative: list ?? (n === 1 ? [point] : points(n)) } as never);
  const parallax = (count: number, n = 1, list?: unknown[]): unknown => calculateCaptureTranslationParallaxTemporalQuadrature({ timing: timing(points(n)), imagingArea: { widthMm: 36, heightMm: 24 }, focalLengthMm: 50,
    orientation: "landscape", cameraTranslationVelocityMps: { x: 0.1, y: 0, z: 0 }, temporalSampleCount: count,
    sceneSamples: list ?? points(n).map((p, i) => ({ sampleId: "s" + i, destinationPointNative: p, positionCameraM: { x: 0, y: 0, z: 2 } })) } as never);
  const extended = (count: number, n = 1, list?: unknown[]): unknown => calculateCaptureExtendedObjectTemporalProjection({ objectId: "o", timing: timing(points(n)), focalLengthMm: 50,
    objectTranslationVelocityMps: { x: 0.1, y: 0, z: 0 }, cameraTranslationVelocityMps: { x: 0, y: 0, z: 0 }, temporalSampleCount: count,
    points: list ?? points(n).map((p, i) => ({ pointId: "p" + i, destinationPointNative: p, positionCameraM: { x: 0, y: 0, z: 2 } })) } as never);
  const stabilized = (count: number, n = 1, list?: unknown[]): unknown => calculateStabilizedCaptureTemporalSamples({ captureKind: "still", timing: timing(points(n)), samplePointsNative: list ?? points(n), temporalSampleCount: count,
    disturbance: { version: "0.1.0", trajectoryId: "d", timeReference: "first-opening-boundary-phase", initialAngularDisplacementIsZero: true, cameraTranslationIncluded: false, subjectMotionIncluded: false,
      supportStateEncoded: false, evidence: ev("d"), limitations: ["x"], samples: [{ timeSecondsFromCaptureReference: 0, angularDisplacementRad: { pitch: 0, yaw: 0, roll: 0 } },
        { timeSecondsFromCaptureReference: 1, angularDisplacementRad: { pitch: 0.1, yaw: 0.1, roll: 0 } }] },
    profile: { schemaVersion: "0.1.0", profileId: "p", profileVersion: "1", profileKind: "generic-synthetic", scientificStatus: "approximation", architecture: "sensor-shift", captureKind: "still",
      panningPolicy: { kind: "none" }, axisResponses: [{ axis: "yaw", correctionGain: fact(0.9), latencySeconds: fact(0.001), maximumCorrectionAngleRad: fact(0.01) }],
      controlTransientModeled: false, spontaneousDriftModeled: false, cameraTranslationCorrectionModeled: false, digitalStabilizationIncluded: false, supportPolicyIncluded: false,
      stopRatingUsedAsDynamicResponse: false, evidence: ev("p"), limitations: ["x"] } } as never);

  it.each([["rotation", rotation], ["parallax", parallax], ["extended object", extended], ["stabilized samples", stabilized]] as const)("%s", (_, run) => {
    expect(() => run(256)).not.toThrow();
    expect(() => run(257)).toThrow(InvalidScientificInputError);
    expect(() => run(2 ** 32)).toThrow(InvalidScientificInputError);
    expect(() => run(256, 257)).toThrow(/at most 65536/u);
    // The budget is checked before the list is walked: a sparse list of 2²⁶ entries is refused at once.
    const start = performance.now();
    expect(() => run(256, 1, new Array(2 ** 26))).toThrow(/at most 65536/u);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(100));
  }, scaledTimeout(60_000));
});

describe("calculateDetailLimit refuses finite inputs that overflow its geometry", () => {
  const sensor = { widthMm: 36, heightMm: 24, pixelWidth: 6000 };
  it.each([
    ["a focus distance near the float range", { sensor, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 8, focus: { focusDistanceM: 4e303 } }],
    ["an f-number near 0", { sensor, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 1e-170 }],
    ["a catalogue lens focused near the float range", { sensor, lens: { kind: "catalogue", lensId: "pv-50-1.8" }, fNumber: 4, focus: { focusDistanceM: 1e305 } }]
  ] as const)("%s", (_, input) => {
    expect(() => calculateDetailLimit(input as never)).toThrow(InvalidScientificInputError);
  });
  it("still answers ordinary inputs", () => {
    expect(calculateDetailLimit({ sensor, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 8, focus: { focusDistanceM: 1e6 } }).value.limitedBy).toMatch(/sensor|lens/u);
  });
});

describe("diffraction cells: method by estimated work", () => {
  it("integrates a costly frequency-domain case in real space with the same cells", () => {
    const start = performance.now();
    expect(calculateAiryCellEnergies(31.9, 32).realSpace).toBe(true);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(5_000));
    const real = calculateAiryCellEnergies(6, 24);
    expect(real.realSpace).toBe(true);
    const frequency = calculateAiryCellEnergiesInFrequencyDomain(6, 24).cells;
    for (let i = 0; i < frequency.length; i++) expect(Math.abs(real.cells[i]! - frequency[i]!)).toBeLessThan(1e-12);
    // Cheap cases keep the frequency-domain method (and its values).
    expect(calculateAiryCellEnergies(6, 4).realSpace).toBe(false);
    expect(calculateAiryCellEnergies(31.9, 1).realSpace).toBe(false);
  }, scaledTimeout(60_000));
});

describe("diffraction profiles: one cell-work bound per profile", () => {
  // β = pitch / (λ·N): at 500 nm and f/1 (infinity focus) β is twice the pitch in µm.
  const profile = (samplePitchMicrometers: number, kernelRadiusSamples: number, wavelengthsNm: number[] = [500]): unknown => createDiffractionLimitedPsfProfile({
    aperture: "circular", focalLengthMm: 50, apertureFNumber: 1, focus: { kind: "infinity" }, wavelengthsNm, samplePitchMicrometers, kernelRadiusSamples,
    fieldHalfExtentMm: { x: 1, y: 1 }, profileId: "bound" });

  it("refuses a profile whose largest β × (R + 1)² × wavelength count is above 400 × 32 × 33², before integrating a cell", () => {
    const start = performance.now();
    // One wavelength, β 13,000, R 32 (about 12 s of real-space cells before): 1.416 × 10⁷.
    expect(() => profile(6_500, 32)).toThrow(/cell work/u);
    // 400 wavelengths from 500 nm with β about 33 at the shortest, R 32.
    expect(() => profile(16.5, 32, Array.from({ length: 400 }, (_, i) => 500 + i * 0.01))).toThrow(InvalidConfigurationError);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(200));
  }, scaledTimeout(60_000));

  it("keeps large cells with a small window", () => {
    // β 50,000 at R 2: 4.5 × 10⁵.
    expect(profile(25_000, 2)).toMatchObject({ value: { kernelRadiusSamples: 2 } });
  }, scaledTimeout(60_000));
});

describe("composite charts: one dead-leaves budget, identical elements shared", () => {
  const leaves = (seed: number): ChartScene => ({ preset: "dead-leaves", radiusMinimum: 0.002, seed } as ChartScene);
  const composite = (scenes: ChartScene[]): ChartScene => ({ preset: "composite", elements: scenes.map((scene, i) => ({ scene, centerU: -0.75 + (i % 4) * 0.5, centerV: -0.75 + Math.floor(i / 4 % 4) * 0.5, width: 0.5, height: 0.5 })) } as ChartScene);

  it("refuses 256 distinct fine dead-leaves elements once the budget is spent", () => {
    expect(() => resolveChartScene({ scene: composite(Array.from({ length: 256 }, (_, i) => leaves(i + 1))), aspect: 1 })).toThrow(/composite's elements need more than/u);
  }, scaledTimeout(60_000));

  it("resolves 256 identical elements once", () => {
    const one = resolveChartScene({ scene: composite([leaves(7)]), aspect: 1 });
    const many = resolveChartScene({ scene: composite(Array.from({ length: 256 }, () => leaves(7))), aspect: 1 });
    const params = (r: typeof one): unknown[] => (r.parameters as { elements: { parameters: unknown }[] }).elements.map((e) => e.parameters);
    expect(params(many)).toEqual(Array.from({ length: 256 }, () => params(one)[0]));
  }, scaledTimeout(60_000));

  it("shares dead leaves only between elements with the same radii, seed and aspect", () => {
    // Same JSON, different seeds (inherited): each element keeps its own seed and disks.
    const inherited = (seed: number): ChartScene => Object.assign(Object.create({ seed }) as object, { preset: "dead-leaves", radiusMinimum: 0.01 }) as ChartScene;
    const r = resolveChartScene({ scene: composite([inherited(9), inherited(10)]), aspect: 1 });
    const params = (r.parameters as { elements: { parameters: { seed: number; diskCount: number } }[] }).elements.map((e) => e.parameters);
    const alone = (seed: number): unknown => (resolveChartScene({ scene: composite([inherited(seed)]), aspect: 1 }).parameters as { elements: { parameters: unknown }[] }).elements[0]!.parameters;
    expect(params).toEqual([alone(9), alone(10)]);
    expect(params[0]!.seed).not.toBe(params[1]!.seed);
  }, scaledTimeout(60_000));

  it("keeps a composite of a few distinct elements", () => {
    const r = resolveChartScene({ scene: composite([leaves(1), leaves(2), { preset: "dead-leaves", seed: 3 } as ChartScene]), aspect: 1 });
    expect((r.parameters as { elements: unknown[] }).elements).toHaveLength(3);
  }, scaledTimeout(60_000));
});

describe("spectral curves and channel lists", () => {
  const color = (ids: unknown[], w = 2, h = 2): unknown => ({ schemaVersion: "0.1.0", profileId: "color", evidence: ev("c"), coordinateSystem: "native-sensor-color-sampling-site-index",
    layout: { kind: "periodic-mosaic", repeatWidthSites: w, repeatHeightSites: h, siteChannelIds: ids, anchor: "native-sensor-top-left-site" } });

  it("refuses a channel list with holes at once", () => {
    expect(() => parseSensorColorSamplingProfile(color(new Array(4)) as never)).toThrow(InvalidConfigurationError);
    expect(() => parseSensorColorSamplingProfile(color(["red", , "green", "blue"]) as never)).toThrow(InvalidConfigurationError); // eslint-disable-line no-sparse-arrays
    const start = performance.now();
    expect(() => parseSensorColorSamplingProfile(color(new Array(100_000_000), 10_000, 10_000) as never)).toThrow(InvalidConfigurationError);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(500));
    expect(parseSensorColorSamplingProfile(color(["red", "green", "green", "blue"]) as never).layout).toMatchObject({ siteChannelIds: ["red", "green", "green", "blue"] });
  });

  it("refuses an evidence list with holes at its first hole", () => {
    const profile = (evidence: unknown[]): unknown => ({ ...(color(["red", "green", "green", "blue"]) as object), evidence });
    const start = performance.now();
    expect(() => parseSensorColorSamplingProfile(profile(new Array(2 ** 26)) as never)).toThrow(/evidence\[0\]/u);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(100));
    expect(() => parseSensorColorSamplingProfile(profile([...ev("a"), , ...ev("b")]) as never)).toThrow(/evidence\[1\]/u); // eslint-disable-line no-sparse-arrays
    expect(parseSensorColorSamplingProfile(profile([...ev("a"), ...ev("b")]) as never).evidence).toHaveLength(2);
  });

  it("interpolates a long curve by binary search with the piecewise-linear values", () => {
    const n = 100_001, samples = Array.from({ length: n }, (_, i) => ({ wavelengthNanometers: 380 + 400 * i / (n - 1), value: 0.2 + 0.4 * ((i * 7919) % n) / n }));
    const colorProfile = parseSensorColorSamplingProfile(color(["red", "green", "green", "blue"]) as never);
    const spectralResponseProfile = parseSensorSpectralResponseProfile({ schemaVersion: "0.1.0", profileId: "spectral", colorSamplingProfileId: "color", evidence: ev("s"),
      channels: [{ channelId: "red", kind: "effective-external-quantum-efficiency", responseScope: "site-incident-effective-channel-response", scientificStatus: "approximation",
        uncertainty: { kind: "not-quantified", limitation: "test" }, evidence: ev("red"), conditionDependence: "not-modeled",
        referenceConditions: { temperatureC: 25, incidenceAngleDegreesFromNormal: 0, polarization: "unpolarized" },
        externalQuantumEfficiency: { wavelengthUnit: "nm", wavelengthBasis: "air", interpolation: "piecewise-linear", outsideRangeBehavior: "fail-closed", evidence: ev("curve"), samples } }] } as never);
    const at = (wavelengthNanometers: number): { value: number; interpolated: boolean } => {
      const r = resolveParsedSensorSpectralResponseAtWavelength({ colorSamplingProfile: colorProfile, spectralResponseProfile, channelId: "red", wavelengthNanometers, wavelengthBasis: "air" }).value;
      return { value: (r.response as { externalQuantumEfficiency: number }).externalQuantumEfficiency, interpolated: r.interpolationUsed };
    };
    // The former linear scan, as the reference.
    const reference = (w: number): number => {
      for (let i = 0; i < n; i++) {
        const s = samples[i]!;
        if (w === s.wavelengthNanometers) return s.value;
        if (w < s.wavelengthNanometers) { const p = samples[i - 1]!, t = (w - p.wavelengthNanometers) / (s.wavelengthNanometers - p.wavelengthNanometers); return p.value + t * (s.value - p.value); }
      }
      return samples[n - 1]!.value;
    };
    for (const w of [380, 380.0001, 500, 512.3456789, 779.99999, 780, samples[54_321]!.wavelengthNanometers]) expect(at(w).value).toBe(reference(w));
    expect([at(380).interpolated, at(samples[54_321]!.wavelengthNanometers).interpolated, at(512.3456789).interpolated]).toEqual([false, false, true]);
    const start = performance.now();
    // 100,000 lookups on a 100,001-sample curve: about 8 s with a linear scan.
    for (let k = 0; k < 100_000; k++) at(380 + 400 * (k + 0.5) / 100_000);
    expect(performance.now() - start).toBeLessThan(scaledTimeout(3_000));
  }, scaledTimeout(60_000));
});
