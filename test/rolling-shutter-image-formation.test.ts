// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import {
  assessReadoutExposureTimingLinkage,
  calculateCaptureExposureWindows,
  resolveElectronicRollingShutterExposureSchedule,
  integrateSceneIlluminationTemporalMultiplierOverExposureWindow,
  parseSceneIlluminationProfile,
  parseSceneIlluminationTemporalProfile,
  simulateEnvironmentSensorRawFrame,
  createRollingShutterCaptureExposureSchedule,
  type ElectronicRollingShutterExposureSchedule,
  type NativeSensorReadoutScanDirection,
  type RollingSensorReadoutTimingDeclaration,
  type SceneRadianceEvaluationRequest
} from "../src/index.js";
import { isElectronicRollingShutterExposureSchedule } from "../src/sensor/readout-exposure-linkage.js";
import { evaluator, frameInput, type FrameScheduleOverride } from "./helpers/environment-raw-fixture.js";
import { evidence } from "./helpers/eqe-response-fixture.js";

const readout = (direction: NativeSensorReadoutScanDirection, skew: number): RollingSensorReadoutTimingDeclaration => ({
  readoutMode: "rolling", captureReadoutDurationSeconds: { value: skew, unit: "s", evidence: evidence("test:readout") },
  scanDirectionNative: { value: direction, evidence: evidence("test:direction") },
  spatialSamplingSkewSeconds: { value: skew, unit: "s", evidence: evidence("test:skew") } });

const rollingSchedule = (direction: NativeSensorReadoutScanDirection, skew: number, exposure: number): ElectronicRollingShutterExposureSchedule =>
  resolveElectronicRollingShutterExposureSchedule({ readout: readout(direction, skew),
    nominalExposureDurationSeconds: { value: exposure, unit: "s", evidence: evidence("test:exposure") },
    linkageEvidence: evidence("test:electronic-rolling-shutter") });

describe("electronic rolling-shutter exposure schedule", () => {
  it("derives line-reset and line-read scans from the rolling readout and windows [s·τ, s·τ+T]", () => {
    const schedule = rollingSchedule("top-to-bottom", .02, .008);
    expect(schedule).toMatchObject({ modelId: "electronic-rolling-shutter-line-reset-read", shutterMechanism: "electronic",
      lineScanSkewSeconds: .02, localExposureDurationSeconds: .008 });
    expect(isElectronicRollingShutterExposureSchedule(schedule, readout("top-to-bottom", .02))).toBe(true);
    expect(isElectronicRollingShutterExposureSchedule(schedule, readout("bottom-to-top", .02))).toBe(false);
    expect(isElectronicRollingShutterExposureSchedule({ ...schedule, shutterMechanism: "mechanical" }, readout("top-to-bottom", .02))).toBe(false);
    const H = 8, windows = calculateCaptureExposureWindows({ ...createRollingShutterCaptureExposureSchedule(schedule),
      nativeRaster: { pixelWidth: 4, pixelHeight: H }, samplePointsNative: Array.from({ length: H }, (_, y) => ({ x: 1.5, y: y+.5 })) }).value;
    windows.samples.forEach((w, y) => {
      expect(w.startOffsetSecondsFromOpeningReference).toBeCloseTo(.02*(y+.5)/H, 15);
      expect(w.localExposureDurationSeconds).toBeCloseTo(.008, 15);
    });
    // The derived linkage passes the existing readout/exposure linkage assessment.
    const assessment = assessReadoutExposureTimingLinkage({ nativeRaster: { pixelWidth: 4, pixelHeight: H }, shutterMechanism: "electronic",
      readout: readout("top-to-bottom", .02), nominalExposureDurationSeconds: schedule.nominalExposureDurationSeconds,
      opening: schedule.opening, closing: schedule.closing, linkage: schedule.linkage }).value;
    expect(assessment.links.map(l => l.boundaryTraversalToReadoutSpatialSkewRatio)).toEqual([1, 1]);
  });

  it("fails closed for global readout and invalid declarations", () => {
    expect(() => resolveElectronicRollingShutterExposureSchedule({
      readout: { readoutMode: "global", captureReadoutDurationSeconds: { value: .01, unit: "s", evidence: evidence("g") } } as never,
      nominalExposureDurationSeconds: { value: .01, unit: "s", evidence: evidence("e") }, linkageEvidence: evidence("l") }))
      .toThrow("requires a rolling sensor readout");
    expect(() => rollingSchedule("top-to-bottom", -1, .01)).toThrow();
    expect(() => rollingSchedule("top-to-bottom", .01, 0)).toThrow();
    expect(() => resolveElectronicRollingShutterExposureSchedule({ readout: readout("top-to-bottom", .01),
      nominalExposureDurationSeconds: { value: .01, unit: "s", evidence: evidence("e") }, linkageEvidence: [] })).toThrow();
  });
});

/** Horizontal tangent coordinate of an environment query (positive to the right in native columns). */
const horizontal = (q: Readonly<SceneRadianceEvaluationRequest>): number => {
  if (q.target.kind !== "environment-direction") throw new Error("Expected an environment query.");
  return q.target.outgoingDirectionUnitVector.x/q.target.outgoingDirectionUnitVector.z;
};

/**
 * Runs the full environment image-formation path (provider radiance → optics → EQE → RAW) on the 2×2
 * fixture with the given schedule and radiance function L(h, t). Returns per-site expected photon counts.
 */
function image(schedule: FrameScheduleOverride | undefined, radiance: (h: number, t: number) => number,
  yawRadPerSec = 0, record?: Map<number, number[]>): number[] {
  const input = frameInput(false, false, schedule);
  input.sites.forEach(site => {
    site.environment.motion.angularVelocityRadPerSec = { pitch: 0, yaw: yawRadPerSec, roll: 0 };
    site.environment.temporalSampleCount = 2;
  });
  input.evaluateRadiance = (q): ReturnType<typeof evaluator> => {
    const site = Number(/environment-site-(\d+)-/.exec(q.sampleId)![1]);
    if (record) record.set(site, [...(record.get(site) ?? []), Math.atan(horizontal(q)), q.timeSecondsFromExposureStart]);
    return evaluator({ ...q, timeSecondsFromExposureStart: 0 }, 1e-9*radiance(horizontal(q), q.timeSecondsFromExposureStart));
  };
  return simulateEnvironmentSensorRawFrame(input).value.sites.map(s => s.value.photo.value.photoSignal.expectedIncidentPhotonCount);
}

describe("rolling-shutter image formation through the environment RAW path", () => {
  const T = .008, tau = .02, H = 2, pitchMm = 18, focalMm = 50;
  // A vertical bar with a linear (triangular) flank moving right at v native px/s: L = 1 - (h_c(t) - h)/W.
  const vPx = 1/(tau/H), omega = vPx*pitchMm/focalMm, W = 2, center = (t: number): number => .5+omega*t;
  const bar = (h: number, t: number): number => 1-(center(t)-h)/W;

  it("shears a horizontally moving vertical bar by v·τ·(row/height); bottom-to-top reverses; global is unsheared", () => {
    // Linear radiance makes each site's signal an exact affine function of the bar position, so the bar
    // centre each site saw is recovered exactly from three runs (L=1, L=1+h, L=bar).
    const constant = image(undefined, () => 1), withH = image(undefined, h => 1+h);
    const centreSeen = (signals: number[]): number[] => signals.map((s, i) => {
      const c = constant[i]!, hBar = (withH[i]!-c)/c;
      return W*(1-s/c)+hBar;
    });
    const rowShiftPx = (signals: number[]): number[] => {
      const seen = centreSeen(signals);
      // Same column (sites 0/2 and 1/3): bar is vertical within a row, so both columns agree.
      expect(seen[0]!).toBeCloseTo(seen[1]!, 12);
      expect(seen[2]!).toBeCloseTo(seen[3]!, 12);
      return [0, 1].map(col => (seen[2+col]!-seen[col]!)*focalMm/pitchMm);
    };
    const global = rowShiftPx(image(undefined, bar));
    expect(global.every(d => Math.abs(d) < 1e-12)).toBe(true);
    for (const [direction, sign] of [["top-to-bottom", 1], ["bottom-to-top", -1]] as const) {
      const schedule = rollingSchedule(direction, tau, T);
      const shift = rowShiftPx(image({ opening: schedule.opening, closing: schedule.closing }, bar));
      // Rows 0 and 1 are one row apart: Δx = v·τ·(Δrow/H) = 1 px, sign set by scan direction.
      for (const d of shift) expect(d).toBeCloseTo(sign*vPx*tau*(1/H), 10);
    }
  });

  it("keeps the global (simultaneous) path bit-identical whether or not a schedule override is given", () => {
    const simultaneous = { opening: { kind: "simultaneous" as const }, closing: { kind: "simultaneous" as const } };
    expect(image(simultaneous, bar)).toEqual(image(undefined, bar));
    expect(simulateEnvironmentSensorRawFrame(frameInput(false, false, simultaneous))).toEqual(simulateEnvironmentSensorRawFrame(frameInput()));
  });

  it("samples camera rotation at each line's own exposure time (rolling-shutter skew under yaw)", () => {
    const yaw = 3, global = new Map<number, number[]>(), rolling = new Map<number, number[]>();
    image(undefined, () => 1, yaw, global);
    const schedule = rollingSchedule("top-to-bottom", tau, T);
    image({ opening: schedule.opening, closing: schedule.closing }, () => 1, yaw, rolling);
    const meanAngle = (values: number[]): number => values.filter((_, i) => i%2 === 0).reduce((a, b) => a+b, 0)/(values.length/2);
    const meanTime = (values: number[]): number => values.filter((_, i) => i%2 === 1).reduce((a, b) => a+b, 0)/(values.length/2);
    for (const col of [0, 1]) {
      expect(meanTime(global.get(2+col)!)).toBe(meanTime(global.get(col)!));
      const dt = meanTime(rolling.get(2+col)!)-meanTime(rolling.get(col)!);
      expect(dt).toBeCloseTo(tau/H, 15);
      // Pure yaw rotates every environment direction about +Y by the same angle: the row offset adds yaw·Δt.
      const rowAngle = meanAngle(rolling.get(2+col)!)-meanAngle(rolling.get(col)!);
      const globalAngle = meanAngle(global.get(2+col)!)-meanAngle(global.get(col)!);
      expect(Math.abs(rowAngle-globalAngle)).toBeCloseTo(yaw*dt, 6);
    }
  });
});

describe("rolling-shutter flicker banding", () => {
  const ev = (r: string): ReturnType<typeof evidence> => evidence("test:"+r);
  const illumination = parseSceneIlluminationProfile({ schemaVersion: "0.1.0", profileId: "lights", sceneId: "room", evidence: ev("lights"),
    sources: [{ sourceId: "lamp", family: "point", enabled: true, geometry: { kind: "point-position", positionM: { x: 0, y: 1, z: 2 } },
      magnitude: { kind: "relative-linear-scale", scale: 1, scientificStatus: "approximation", limitation: "test" },
      spectrum: { kind: "unresolved", limitation: "test" }, temporalBehavior: { kind: "time-invariant" }, evidence: ev("lamp") }] });
  const P = .01; // 100 Hz flicker (50 Hz mains, full-wave)
  const temporal = parseSceneIlluminationTemporalProfile({ schemaVersion: "0.1.0", profileId: "flicker", sceneId: "room",
    illuminationProfileId: "lights", evidence: ev("flicker"), waveforms: [{ waveformId: "mains", kind: "periodic-relative-multiplier",
      timeUnit: "s", scientificStatus: "approximation", uncertainty: { kind: "not-quantified", limitation: "test" }, evidence: ev("mains"),
      interpolation: "piecewise-linear", periodSeconds: P, endpointContinuityRequired: true, samples: [
        { timeSecondsFromWaveformReference: 0, relativeMagnitudeMultiplier: 0 },
        { timeSecondsFromWaveformReference: P/2, relativeMagnitudeMultiplier: 2 },
        { timeSecondsFromWaveformReference: P, relativeMagnitudeMultiplier: 0 }] }],
    sourceBindings: [{ bindingId: "lamp-mains", sourceId: "lamp", waveformId: "mains", captureTimeReference: "first-opening-boundary-phase",
      waveformTimeZeroSecondsFromCaptureReference: 0, scientificStatus: "approximation",
      timingUncertainty: { kind: "not-quantified", limitation: "test" }, evidence: ev("binding") }],
    baseIlluminationProfileRemainsAuthoritative: true, sensorReadoutTimingUsedAsExposureTiming: false, automaticExposurePolicyIncluded: false });
  const H = 32, tau = 4*P;
  const rows = (schedule: FrameScheduleOverride & { exposure: number }): number[] => {
    const windows = calculateCaptureExposureWindows({ shutterMechanism: "electronic", nativeRaster: { pixelWidth: 1, pixelHeight: H },
      nominalExposureDurationSeconds: { value: schedule.exposure, unit: "s", evidence: ev("t") }, opening: schedule.opening, closing: schedule.closing,
      samplePointsNative: Array.from({ length: H }, (_, y) => ({ x: .5, y: y+.5 })) }).value;
    return windows.samples.map((_, sampleIndex) => integrateSceneIlluminationTemporalMultiplierOverExposureWindow({ illuminationProfile: illumination,
      temporalProfile: temporal, sourceId: "lamp", exposureWindows: windows, sampleIndex, temporalSampleCount: 400 }).averageRelativeMagnitudeMultiplier);
  };

  it("bands rows with the flicker period mapped through the line skew, and vanishes for T = n·P", () => {
    const short = P/4, rolling = rollingSchedule("top-to-bottom", tau, short);
    const global = rows({ exposure: short, opening: { kind: "simultaneous" }, closing: { kind: "simultaneous" } });
    expect(new Set(global).size).toBe(1);
    const banded = rows({ exposure: short, opening: rolling.opening, closing: rolling.closing });
    expect(Math.max(...banded)-Math.min(...banded)).toBeGreaterThan(1);
    // One flicker period spans H·P/τ = 8 rows, so the band pattern repeats every 8 rows.
    for (let y = 0; y+8 < H; y++) expect(banded[y+8]!).toBeCloseTo(banded[y]!, 9);
    const fullPeriod = rollingSchedule("top-to-bottom", tau, P);
    const flat = rows({ exposure: P, opening: fullPeriod.opening, closing: fullPeriod.closing });
    for (const value of flat) expect(value).toBeCloseTo(1, 4);
  });
});

describe("schedule constructor (sensor-21, #701)", () => {
  it("refuses an unknown shutter mechanism", () => {
    const schedule = rollingSchedule("top-to-bottom", .02, .008);
    expect(() => createRollingShutterCaptureExposureSchedule({ ...schedule, shutterMechanism: "bogus" as never })).toThrow("shutterMechanism is invalid.");
  });
});
