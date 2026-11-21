// SPDX-License-Identifier: Apache-2.0
/*
 * #505: photographer-set Auto ISO limits (`autoIsoLimits: { maximum, minimum? }`) on every Auto ISO resolver, kept
 * separate from the body's Auto ISO capability. A limit strictly inside the body's range that holds the ISO is reported
 * as `user-iso-maximum` / `user-iso-minimum`; a limit outside the body's range or off its ISO grid fails.
 * The #504 block covers Program + Auto ISO holding the line's shutter at a slowest preferred shutter; the last block, #681: a
 * target met exactly at a range end (within rounding) is not reported as held there.
 *
 * Exposure H ∝ t·S/N² (reciprocity), so at the reference f/4, 1/125 s, ISO 100 a target k times the reference exposure
 * needs ISO 100·k at f/4, 1/125 s; every expected ISO below follows from that.
 */
import { describe, expect, it } from "vitest";

import {
  createExposureMeterTargetFromMeteringResult, InvalidConfigurationError, InvalidScientificInputError, meterRelativeExposure,
  parseExposureMeteringProfile, parseExposureProgramLineProfile, parseGenericBodyExposureCapabilityProfile, parseGenericLensExposureCapabilityProfile,
  resolveAperturePriorityAutoIsoExposureMode, resolveCaptureGeometry, resolveFullAutoExposureMode, resolveGenericEquipmentExposureCapabilities,
  GENERIC_THIRD_STOP_ISO_SETTINGS, resolveAperturePriorityExposureMode, resolveManualExposureMode, resolveProgramAutoExposureMode, resolveShutterPriorityExposureMode, type AutoIsoLimits, type ExposureMeterTarget, type ExposureProgramLineProfile,
  type ResolvedGenericEquipmentExposureCapabilities
} from "../src/index.js";

const evidence = (ref: string) => [{ sourceOrigin: "photivra" as const, sourceReference: ref, reuseStatus: "photivra-owned" as const }] as const;

const capabilities = (options: { isoValues?: readonly number[]; isoGrid?: "continuous"; bodyAuto?: { minimum: number; maximum: number } } = {}):
  ResolvedGenericEquipmentExposureCapabilities => {
  const isoValues = options.isoValues ?? [100, 200, 400, 800, 1600, 3200, 6400, 12800];
  const body = parseGenericBodyExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: "body", profileVersion: "1.0.0", scientificStatus: "approximation",
    evidence: evidence("body"),
    shutter: { durationSecondsRange: { value: { minimum: 1 / 8000, maximum: 30 }, evidence: evidence("shutter") }, settingGrid: { kind: "continuous-within-range" } },
    iso: { range: { value: { minimum: 100, maximum: isoValues[isoValues.length - 1]! }, evidence: evidence("iso") },
      settingGrid: options.isoGrid === "continuous" ? { kind: "continuous-within-range" } : { kind: "discrete-values", values: { value: isoValues, evidence: evidence("iso-grid") } },
      autoIso: { value: "supported", evidence: evidence("auto") } } });
  const lens = parseGenericLensExposureCapabilityProfile({ schemaVersion: "0.1.0", profileId: "lens", profileVersion: "1.0.0", scientificStatus: "approximation",
    evidence: evidence("lens"), focalLengthMmRange: { value: { minimum: 50, maximum: 50 }, evidence: evidence("focal") },
    aperture: { widestAvailableFNumber: { kind: "constant", fNumber: { value: 1.8, evidence: evidence("wide") } }, narrowestAvailableFNumber: { value: 16, evidence: evidence("narrow") },
      settingGrid: { kind: "continuous-within-range" } } });
  const resolved = resolveGenericEquipmentExposureCapabilities({ bodyProfile: body, lensProfile: lens, selectedFocalLengthMm: 50 });
  return options.bodyAuto ? { ...resolved, iso: { ...resolved.iso, autoIsoMinimum: options.bodyAuto.minimum, autoIsoMaximum: options.bodyAuto.maximum } } : resolved;
};

const targetForScale = (scale: number): ExposureMeterTarget => {
  const profile = parseExposureMeteringProfile({ schemaVersion: "0.1.0", profileId: "meter", scientificStatus: "approximation",
    inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", policy: { kind: "multi-zone-uniform" },
    target: { kind: "relative-signal-reference", targetRelativeSignal: 1, evidence: evidence("target") }, evidence: evidence("meter"), limitations: ["test"] });
  const meter = meterRelativeExposure({ profile, sampleSet: { measurementId: "m", sceneStateId: "s", inputDomain: "relative-pre-exposure-linear-signal",
    captureRegion: "oriented-active-capture",
    captureGeometry: resolveCaptureGeometry({ imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 }, orientation: "landscape" }).value,
    processingState: { exposureSettingsApplied: false, whiteBalanceApplied: false, toneMappingApplied: false, displayGammaApplied: false, sharpeningApplied: false },
    samples: [{ sampleId: "z", positionOrientedCaptureUv: { u: 0.5, v: 0.5 }, relativeLinearSignal: 1 / scale, areaWeight: 1 }] } }).value;
  return createExposureMeterTargetFromMeteringResult({ targetId: "target", meterResult: meter });
};

// The program line ends at f/4, 4/125 s: 2 stops more light than the reference; Auto ISO makes up the rest.
const programLine = (): ExposureProgramLineProfile => parseExposureProgramLineProfile({ schemaVersion: "0.1.0", profileId: "line", profileVersion: "1.0.0", scientificStatus: "approximation",
  policyKind: "generic-program-line", interpolation: "log2-aperture-shutter", evidence: evidence("line"), limitations: ["Generic test line."],
  nodes: [{ nodeId: "a", opticalExposureStopsFromReference: -2, aperture: 8, shutterSeconds: 1 / 125 },
    { nodeId: "b", opticalExposureStopsFromReference: 0, aperture: 4, shutterSeconds: 1 / 125 },
    { nodeId: "c", opticalExposureStopsFromReference: 2, aperture: 4, shutterSeconds: 4 / 125 }] });

const referenceExposure = { aperture: 4, shutterSeconds: 1 / 125, iso: 100 };
const baseline = { isoBaseline: "minimum-selectable" as const, isoQuantizationPolicy: "nearest-log2-lower-on-tie" as const };
const limitsField = (autoIsoLimits?: AutoIsoLimits): { autoIsoLimits?: AutoIsoLimits } => (autoIsoLimits === undefined ? {} : { autoIsoLimits });

type Resolved = { status: string; baselineIso?: number; resolvedSettings: { aperture: number; shutterSeconds: number; iso: number };
  isoResolution: { clamped: false | "minimum" | "maximum" }; afterMaximumIsoFallbackUsed?: boolean;
  targetResidual: { state: string; residualStops: number; limitingConstraint: string } };
const resolved = (r: unknown): Resolved => {
  expect((r as Resolved).status).toBe("resolved");
  return r as Resolved;
};

// The five Auto ISO entry points, each with optional limits.
type Caps = ResolvedGenericEquipmentExposureCapabilities;
const resolvers: Record<string, (target: ExposureMeterTarget, caps: Caps, limits?: AutoIsoLimits) => unknown> = {
  manual: (target, caps, limits) => resolveManualExposureMode({ target, capabilities: caps, referenceExposure, manualAperture: 4, manualShutterSeconds: 1 / 125,
    isoControl: { kind: "automatic", quantizationPolicy: "nearest-log2-lower-on-tie", ...limitsField(limits) } }),
  "aperture priority": (target, caps, limits) => resolveAperturePriorityAutoIsoExposureMode({ target, capabilities: caps, referenceExposure, manualAperture: 4,
    policy: { kind: "minimum-iso-until-slowest-preferred-shutter", slowestPreferredShutterSeconds: 1 / 125, shutterSelectionPolicy: "not-longer-than-target",
      afterMaximumIso: "hold-preferred-shutter", ...baseline, ...limitsField(limits) } }),
  "shutter priority": (target, caps, limits) => resolveShutterPriorityExposureMode({ target, capabilities: caps, referenceExposure, manualShutterSeconds: 1 / 125,
    isoControl: { kind: "automatic", policy: { kind: "minimum-iso-aperture-first", apertureSelectionPolicy: "not-wider-than-target", ...baseline, ...limitsField(limits) } } }),
  program: (target, caps, limits) => resolveProgramAutoExposureMode({ target, capabilities: caps, referenceExposure, programLine: programLine(),
    isoControl: { kind: "automatic", ...baseline, ...limitsField(limits) } }),
  "full auto": (target, caps, limits) => resolveFullAutoExposureMode({ target, capabilities: caps, referenceExposure,
    policy: { kind: "generic-program-line-minimum-iso", programLine: programLine(), ...baseline, ...limitsField(limits) } })
};

describe("the photographer's maximum stops Auto ISO and reports user-iso-maximum (#505)", () => {
  // Ideal ISO with no limit: manual and aperture priority (f/4, 1/125 s) 100·64 = 6400; shutter priority opens to f/1.8,
  // 100·64·(1.8/4)² = 1296 → 1600 on the grid; program and full auto use the line's +2 stops, 100·64/4 = 1600.
  const unlimitedIso: Record<string, number> = { manual: 6400, "aperture priority": 6400, "shutter priority": 1600, program: 1600, "full auto": 1600 };
  for (const [name, resolve] of Object.entries(resolvers)) it(name, () => {
    const free = resolved(resolve(targetForScale(64), capabilities()));
    expect(free.resolvedSettings.iso).toBe(unlimitedIso[name]);
    const capped = resolved(resolve(targetForScale(64), capabilities(), { maximum: 800 }));
    expect(capped.resolvedSettings.iso).toBe(800);
    expect(capped.isoResolution.clamped).toBe("maximum");
    expect(capped.targetResidual).toMatchObject({ state: "under-target", limitingConstraint: "user-iso-maximum" });
    // The same aperture and shutter, so the residual is the ISO ratio exactly (shutter priority: its 1296 → 800).
    const ideal = name === "shutter priority" ? 1296 : unlimitedIso[name]!;
    expect(capped.targetResidual.residualStops).toBeCloseTo(Math.log2(ideal / 800), 9);
    expect(capped.resolvedSettings.aperture).toBe(free.resolvedSettings.aperture);
    expect(capped.resolvedSettings.shutterSeconds).toBe(free.resolvedSettings.shutterSeconds);
  });
  it("a maximum equal to the body's reports the body's iso-maximum and changes nothing", () => {
    for (const resolve of Object.values(resolvers)) {
      const atBody = resolved(resolve(targetForScale(1e4), capabilities(), { maximum: 12800 }));
      const free = resolved(resolve(targetForScale(1e4), capabilities()));
      expect(atBody.targetResidual.limitingConstraint).toBe("iso-maximum");
      expect(atBody.resolvedSettings).toEqual(free.resolvedSettings);
      expect(atBody.targetResidual).toEqual(free.targetResidual);
    }
  });
  it("below the cap the ISO is unchanged", () => {
    for (const resolve of Object.values(resolvers)) {
      const free = resolved(resolve(targetForScale(4), capabilities())), capped = resolved(resolve(targetForScale(4), capabilities(), { maximum: 3200 }));
      expect(capped.resolvedSettings).toEqual(free.resolvedSettings);
      expect(capped.targetResidual).toEqual(free.targetResidual);
    }
  });
  it("a continuous ISO grid stops at any maximum inside the body's range", () => {
    const r = resolved(resolvers.manual!(targetForScale(64), capabilities({ isoGrid: "continuous" }), { maximum: 1000 }));
    expect(r.resolvedSettings.iso).toBe(1000);
    expect(r.targetResidual.limitingConstraint).toBe("user-iso-maximum");
    expect(r.targetResidual.residualStops).toBeCloseTo(Math.log2(6.4), 12);
  });
});

describe("the photographer's minimum raises the Auto ISO baseline and reports user-iso-minimum (#505)", () => {
  it("manual: a bright scene holds at the user's minimum", () => {
    const free = resolved(resolvers.manual!(targetForScale(1 / 4), capabilities()));
    expect(free.targetResidual.limitingConstraint).toBe("iso-minimum");
    const floored = resolved(resolvers.manual!(targetForScale(1 / 4), capabilities(), { maximum: 6400, minimum: 400 }));
    expect(floored.resolvedSettings.iso).toBe(400);
    expect(floored.isoResolution.clamped).toBe("minimum");
    expect(floored.targetResidual).toMatchObject({ state: "over-target", limitingConstraint: "user-iso-minimum" });
    expect(floored.targetResidual.residualStops).toBeCloseTo(Math.log2(25 / 400), 9);
  });
  it("every priority and program resolver starts from the user's minimum", () => {
    for (const [name, resolve] of Object.entries(resolvers)) {
      if (name === "manual") continue;
      const r = resolved(resolve(targetForScale(1), capabilities(), { maximum: 6400, minimum: 400 }));
      expect(r.baselineIso).toBe(400);
      expect(r.resolvedSettings.iso).toBeGreaterThanOrEqual(400);
    }
  });
  it("a minimum equal to the body's reports the body's iso-minimum", () => {
    const r = resolved(resolvers.manual!(targetForScale(1 / 4), capabilities({ bodyAuto: { minimum: 200, maximum: 6400 } }), { maximum: 3200, minimum: 200 }));
    expect(r.resolvedSettings.iso).toBe(200);
    expect(r.targetResidual.limitingConstraint).toBe("iso-minimum");
  });
});

describe("aperture priority treats the user's cap like the body's cap (#505)", () => {
  // Body capped at 800 by capability versus a 12800 body capped at 800 by the photographer.
  const bodyCap = capabilities({ isoValues: [100, 200, 400, 800] }), wideBody = capabilities();
  const ap = (caps: Caps, afterMaximumIso: "allow-slower-shutter" | "hold-preferred-shutter", autoIsoLimits?: AutoIsoLimits): Resolved =>
    resolved(resolveAperturePriorityAutoIsoExposureMode({ target: targetForScale(100), capabilities: caps, referenceExposure, manualAperture: 4,
      policy: { kind: "minimum-iso-until-slowest-preferred-shutter", slowestPreferredShutterSeconds: 1 / 60, shutterSelectionPolicy: "not-longer-than-target",
        afterMaximumIso, ...baseline, ...limitsField(autoIsoLimits) } }));
  it("allow-slower-shutter lengthens the shutter past the preferred one in the same way", () => {
    const byBody = ap(bodyCap, "allow-slower-shutter"), byUser = ap(wideBody, "allow-slower-shutter", { maximum: 800 });
    expect(byUser.resolvedSettings).toEqual(byBody.resolvedSettings);
    expect(byUser.resolvedSettings.iso).toBe(800);
    expect(byUser.resolvedSettings.shutterSeconds).toBeCloseTo(1 / 1.25 / 8, 12);
    expect(byUser.afterMaximumIsoFallbackUsed).toBe(true);
    expect(byBody.afterMaximumIsoFallbackUsed).toBe(true);
    expect(byUser.targetResidual).toEqual(byBody.targetResidual);
  });
  it("hold-preferred-shutter keeps the preferred shutter and leaves the same residual", () => {
    const byBody = ap(bodyCap, "hold-preferred-shutter"), byUser = ap(wideBody, "hold-preferred-shutter", { maximum: 800 });
    expect(byUser.resolvedSettings).toEqual(byBody.resolvedSettings);
    expect(byUser.resolvedSettings.shutterSeconds).toBeCloseTo(1 / 60, 12);
    expect(byUser.afterMaximumIsoFallbackUsed).toBe(false);
    expect(byUser.targetResidual.residualStops).toBeCloseTo(byBody.targetResidual.residualStops, 12);
    expect(byBody.targetResidual.limitingConstraint).toBe("iso-maximum");
    expect(byUser.targetResidual.limitingConstraint).toBe("user-iso-maximum");
  });
});

describe("absent limits change nothing (#505)", () => {
  it("each resolver's result equals that with limits equal to the body's range, apart from the echoed policy", () => {
    for (const scale of [1 / 8, 1, 64, 1e5]) for (const resolve of Object.values(resolvers)) {
      const free = resolve(targetForScale(scale), capabilities()) as Record<string, unknown>;
      const same = resolve(targetForScale(scale), capabilities(), { maximum: 12800, minimum: 100 }) as Record<string, unknown>;
      const withoutPolicy = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).filter(([key]) => key !== "policy"));
      expect(withoutPolicy(same)).toEqual(withoutPolicy(free));
    }
  });
});

describe("limits outside the body's Auto ISO range or off its grid fail (#505)", () => {
  const body = capabilities({ bodyAuto: { minimum: 200, maximum: 6400 } });
  const scientific: [string, AutoIsoLimits][] = [
    ["a maximum above the body's Auto ISO maximum", { maximum: 12800 }],
    ["a maximum below the body's Auto ISO minimum", { maximum: 100 }],
    ["a minimum below the body's Auto ISO minimum", { maximum: 3200, minimum: 100 }],
    ["a minimum above the maximum", { maximum: 800, minimum: 1600 }],
    ["a maximum off the discrete ISO grid", { maximum: 1000 }],
    ["a NaN maximum", { maximum: NaN }],
    ["an infinite maximum", { maximum: Infinity }],
    ["a zero minimum", { maximum: 800, minimum: 0 }],
    ["a missing maximum", {} as AutoIsoLimits]
  ];
  const configuration: [string, unknown][] = [["a non-object", 800], ["null", null], ["an array", [800]], ["an unknown field", { maximum: 800, flashMaximum: 400 }]];
  for (const [name, resolve] of Object.entries(resolvers)) {
    it(name + ": out-of-range or off-grid numbers fail with InvalidScientificInputError", () => {
      for (const [, limits] of scientific) expect(() => resolve(targetForScale(1), body, limits)).toThrow(InvalidScientificInputError);
    });
    it(name + ": a malformed record fails with InvalidConfigurationError", () => {
      for (const [, limits] of configuration) expect(() => resolve(targetForScale(1), body, limits as AutoIsoLimits)).toThrow(InvalidConfigurationError);
    });
  }
  it("the message names the field and the body's range", () => {
    expect(() => resolvers.manual!(targetForScale(1), body, { maximum: 12800 })).toThrow(
      "isoControl.autoIsoLimits.maximum (ISO 12800) lies outside the body's Auto ISO range, ISO 200 to 6400.");
  });
});

describe("Program + Auto ISO: holding the line's shutter at a slowest preferred shutter (#504)", () => {
  // The line reaches f/4, 4/125 s at +2 stops; beyond it Auto ISO rises.
  type ProgramHold = Resolved & { slowestPreferredShutter?: { applied: boolean; afterMaximumIsoFallbackUsed: boolean } };
  const program = (scale: number, hold?: { slowestPreferredShutterSeconds: number; afterMaximumIso: "allow-slower-shutter" | "hold-preferred-shutter" },
    autoIsoLimits?: AutoIsoLimits): ProgramHold => resolved(resolveProgramAutoExposureMode({ target: targetForScale(scale), capabilities: capabilities(), referenceExposure,
    programLine: programLine(), isoControl: { kind: "automatic", ...baseline, ...limitsField(autoIsoLimits), ...(hold ? { slowestPreferredShutter: hold } : {}) } })) as ProgramHold;
  const allow = { slowestPreferredShutterSeconds: 1 / 125, afterMaximumIso: "allow-slower-shutter" as const };
  const hold = { slowestPreferredShutterSeconds: 1 / 125, afterMaximumIso: "hold-preferred-shutter" as const };
  it("absent, nothing changes and nothing is reported", () => {
    const r = program(4);
    expect(r.resolvedSettings).toEqual({ aperture: 4, shutterSeconds: 4 / 125, iso: 100 });
    expect(r).not.toHaveProperty("slowestPreferredShutter");
  });
  it("a line shutter slower than the threshold is held there and the ISO rises", () => {
    const r = program(4, allow);
    expect(r.resolvedSettings.aperture).toBe(4);
    expect(r.resolvedSettings.shutterSeconds).toBeCloseTo(1 / 125, 15);
    expect(r.resolvedSettings.iso).toBe(400);
    expect(r.targetResidual.state).toBe("matched");
    expect(r.slowestPreferredShutter).toEqual({ ...allow, applied: true, afterMaximumIsoFallbackUsed: false });
  });
  it("a line shutter at or faster than the threshold is untouched", () => {
    const free = program(1 / 4), held = program(1 / 4, allow);
    expect(held.resolvedSettings).toEqual(free.resolvedSettings);
    expect(held.targetResidual).toEqual(free.targetResidual);
    expect(held.slowestPreferredShutter!.applied).toBe(false);
  });
  it("at the Auto ISO maximum, allow-slower-shutter lengthens the shutter to the target", () => {
    // Target ×16 needs ISO 1600 at f/4, 1/125 s; capped at 800, the shutter doubles to 2/125 s (shorter than the line's 4/125 s).
    const r = program(16, allow, { maximum: 800 });
    expect(r.resolvedSettings.iso).toBe(800);
    expect(r.resolvedSettings.shutterSeconds).toBeCloseTo(2 / 125, 12);
    expect(r.targetResidual.state).toBe("matched");
    expect(r.slowestPreferredShutter!.afterMaximumIsoFallbackUsed).toBe(true);
  });
  it("allow-slower-shutter never goes past the line's own shutter: then it equals the line without the hold", () => {
    const free = program(64, undefined, { maximum: 800 }), held = program(64, allow, { maximum: 800 });
    expect(held.resolvedSettings).toEqual(free.resolvedSettings);
    expect(held.targetResidual.residualStops).toBeCloseTo(free.targetResidual.residualStops, 12);
    expect(held.targetResidual.limitingConstraint).toBe("user-iso-maximum");
  });
  it("hold-preferred-shutter keeps the threshold and reports the residual", () => {
    const r = program(16, hold, { maximum: 800 });
    expect(r.resolvedSettings.iso).toBe(800);
    expect(r.resolvedSettings.shutterSeconds).toBeCloseTo(1 / 125, 15);
    expect(r.targetResidual).toMatchObject({ state: "under-target", limitingConstraint: "user-iso-maximum" });
    expect(r.targetResidual.residualStops).toBeCloseTo(1, 12);
    expect(r.slowestPreferredShutter!.afterMaximumIsoFallbackUsed).toBe(false);
  });
  it("invalid holds fail with a domain error", () => {
    expect(() => program(4, { slowestPreferredShutterSeconds: 60, afterMaximumIso: "allow-slower-shutter" })).toThrow(InvalidScientificInputError);
    expect(() => program(4, { slowestPreferredShutterSeconds: NaN, afterMaximumIso: "allow-slower-shutter" })).toThrow(InvalidScientificInputError);
    expect(() => program(4, { slowestPreferredShutterSeconds: 1 / 60, afterMaximumIso: "allow" as never })).toThrow(InvalidConfigurationError);
    expect(() => program(4, { slowestPreferredShutterSeconds: 1 / 60, afterMaximumIso: "allow-slower-shutter", extra: 1 } as never)).toThrow(InvalidConfigurationError);
  });
});

describe("a target met within rounding at a range end is not held there (#681)", () => {
  // Rounding in the target's scale (a few ulp, either side) must not decide whether a range end "held" the exposure: within
  // settingEquals' 32 ulp the ideal setting is the end itself, so the report is clamped: false and "none"; a target clearly past
  // the end still clamps. The resolved settings are the same either way: the end itself from outside the range, the continuous
  // ideal from inside it (within rounding of the end).
  const ulps = [-8, -4, -2, -1, 0, 1, 2, 4, 8];
  const professional = (isoGrid?: "continuous"): Caps => capabilities({ isoValues: GENERIC_THIRD_STOP_ISO_SETTINGS.filter((v) => v <= 25600), ...(isoGrid ? { isoGrid } : {}) });
  const reference = { aperture: 8, shutterSeconds: 1 / 125, iso: 100 };
  const manualAutoIso = (scale: number, caps: Caps): Resolved => resolved(resolveManualExposureMode({ target: targetForScale(scale), capabilities: caps,
    referenceExposure: reference, manualAperture: 8, manualShutterSeconds: 1 / 125, isoControl: { kind: "automatic", quantizationPolicy: "nearest-log2-lower-on-tie" } }));
  for (const grid of ["discrete", "continuous"] as const) it(`Auto ISO at ISO 100 and 25 600 (${grid} grid)`, () => {
    const caps = professional(grid === "continuous" ? "continuous" : undefined);
    for (const [scale, iso] of [[1, 100], [256, 25600]] as const) for (const k of ulps) {
      const r = manualAutoIso(scale * (1 + k * 2 ** -52), caps);
      if (grid === "discrete") expect(r.resolvedSettings.iso, `${scale}, ${k} ulp`).toBe(iso);
      else expect(r.resolvedSettings.iso, `${scale}, ${k} ulp`).toBeCloseTo(iso, 8);
      expect(r.isoResolution.clamped, `${scale}, ${k} ulp`).toBe(false);
      expect(r.targetResidual, `${scale}, ${k} ulp`).toMatchObject({ state: "matched", limitingConstraint: "none" });
    }
    expect(manualAutoIso(1 - 2 ** -30, caps).isoResolution.clamped).toBe("minimum");
    expect(manualAutoIso(256 * (1 + 2 ** -30), caps).isoResolution.clamped).toBe("maximum");
  });
  it("the automatic shutter at 1/8000 s and 30 s", () => {
    // Aperture priority, f/4 and ISO 100 at the f/4, 1/125 s reference: the ideal shutter is the target's scale / 125 s.
    type WithShutter = Resolved & { shutterResolution: { clamped: unknown } };
    const shutterFor = (scale: number): WithShutter => resolveAperturePriorityExposureMode({ target: targetForScale(scale), capabilities: capabilities(), referenceExposure,
      manualAperture: 4, manualIso: 100, shutterQuantizationPolicy: "nearest-log2-shorter-on-tie" }) as unknown as WithShutter;
    for (const [scale, seconds] of [[125 / 8000, 1 / 8000], [30 * 125, 30]] as const) for (const k of ulps) {
      const r = shutterFor(scale * (1 + k * 2 ** -52));
      expect(r.resolvedSettings.shutterSeconds / seconds, `${seconds}, ${k} ulp`).toBeCloseTo(1, 12);
      expect(r.shutterResolution.clamped, `${seconds}, ${k} ulp`).toBe(false);
      expect(r.targetResidual.limitingConstraint, `${seconds}, ${k} ulp`).toBe("none");
    }
    expect(shutterFor(125 / 8000 * (1 - 2 ** -30)).targetResidual.limitingConstraint).toBe("shutter-minimum");
    expect(shutterFor(30 * 125 * (1 + 2 ** -30)).targetResidual.limitingConstraint).toBe("shutter-maximum");
  });
  it("the automatic aperture at f/1.8 and f/16", () => {
    // Shutter priority, 1/125 s and ISO 100: the ideal f-number is 4 / sqrt(scale).
    type WithAperture = Resolved & { apertureResolution: { clamped: unknown } };
    const apertureFor = (scale: number): WithAperture => resolveShutterPriorityExposureMode({ target: targetForScale(scale), capabilities: capabilities(), referenceExposure,
      manualShutterSeconds: 1 / 125, isoControl: { kind: "manual", iso: 100, apertureQuantizationPolicy: "nearest-log2-narrower-on-tie" } }) as unknown as WithAperture;
    for (const [scale, fNumber] of [[(4 / 1.8) ** 2, 1.8], [(4 / 16) ** 2, 16]] as const) for (const k of ulps) {
      const r = apertureFor(scale * (1 + k * 2 ** -52));
      expect(r.resolvedSettings.aperture, `f/${fNumber}, ${k} ulp`).toBeCloseTo(fNumber, 12);
      expect(r.apertureResolution.clamped, `f/${fNumber}, ${k} ulp`).toBe(false);
      expect(r.targetResidual.limitingConstraint, `f/${fNumber}, ${k} ulp`).toBe("none");
    }
    expect(apertureFor((4 / 1.8) ** 2 * (1 + 2 ** -30)).targetResidual.limitingConstraint).toBe("aperture-widest");
    expect(apertureFor((4 / 16) ** 2 * (1 - 2 ** -30)).targetResidual.limitingConstraint).toBe("aperture-narrowest");
  });
});
