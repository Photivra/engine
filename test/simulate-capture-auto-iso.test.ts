// SPDX-License-Identifier: Apache-2.0
/*
 * #516: exposure.iso "auto" in simulateCapture, the display view and the ideal reference. The facade hands "auto" to the
 * exposure-mode resolvers' Auto ISO branches; these tests check the ISO each mode resolves, what the result reports, that a
 * capture, its display view and its region parts resolve the same exposure, and the option validation.
 */
import { describe, expect, it } from "vitest";
import { calculateThinLensImageDistance, estimateAutoIsoSlowestShutter, GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC, InvalidConfigurationError,
  SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX as LUX, prepareDisplayView, resolveGenericEquipmentTierCatalog, simulateCapture, simulateDisplayView,
  simulateIdealReference, type SimulateCaptureOptions } from "../src/index.js";

const small = { scene: { preset: "uniform" as const }, output: { width: 8, height: 8 } };
type AperturePriorityAutoIso = { mode: "aperture-priority"; iso: "auto"; autoIso: { slowestPreferredShutterSeconds: number; afterMaximumIso?: "allow-slower-shutter" | "hold-preferred-shutter" } };
type Resolution = { status: string; axisOwnership: { iso: string }; resolvedSettings: { aperture: number; shutterSeconds: number; iso: number };
  targetResidual: { limitingConstraint: string; residualStops: number } };
const aperturePriority = (slowestPreferredShutterSeconds: number, afterMaximumIso?: "allow-slower-shutter" | "hold-preferred-shutter"): AperturePriorityAutoIso =>
  ({ mode: "aperture-priority" as const, iso: "auto" as const, autoIso: { slowestPreferredShutterSeconds, ...(afterMaximumIso ? { afterMaximumIso } : {}) } });
const resolution = (r: { exposure: { resolution: unknown } }): Resolution => r.exposure.resolution as Resolution;

describe("exposure.iso absent or a number (#516)", () => {
  it("reports manual ISO control and no autoIso", async () => {
    for (const exposure of [undefined, { iso: 400 }, { mode: "program" as const, iso: 200 }]) {
      const r = await simulateCapture({ ...small, ...(exposure ? { exposure } : {}) });
      expect(r.exposure.isoControl).toBe("manual");
      expect(r.exposure).not.toHaveProperty("autoIso");
      expect(r.assumptions.some((a) => a.id === "exposure.autoIso")).toBe(false);
    }
  });
});

describe("manual + Auto ISO (#516)", () => {
  it("the default scene at f/8, 1/125 s gives ISO 100", async () => {
    const r = await simulateCapture({ ...small, exposure: { iso: "auto" } });
    expect(r.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 100 });
    expect(r.exposure.isoControl).toBe("automatic");
    expect(r.exposure.autoIso).toMatchObject({ autoIsoMinimum: 100, autoIsoMaximum: 25600 });
    expect(r.exposure.autoIso!.idealIsoBeforeConstraints).toBeCloseTo(100, 2);
    expect(resolution(r).axisOwnership.iso).toBe("automatic");
    expect(r.assumptions.some((a) => a.id === "exposure.autoIso")).toBe(true);
  });
  it("a scene three stops darker raises the ISO three stops, byte-identical to that manual ISO", async () => {
    const options: SimulateCaptureOptions = { ...small, illuminanceLux: LUX / 8, exposure: { iso: "auto" } };
    const auto = await simulateCapture(options), manual = await simulateCapture({ ...options, exposure: { iso: 800 } });
    expect(auto.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 800 });
    expect(resolution(auto).resolvedSettings.iso).toBe(800);
    expect(auto.exposure.autoIso!.idealIsoBeforeConstraints).toBeCloseTo(800, 1);
    expect(auto.exposure.autoIso!.clamped).toBe(false);
    expect(Math.abs(auto.exposure.autoIso!.residualStops)).toBeLessThan(1e-3);
    expect(Array.from(auto.image.samples)).toEqual(Array.from(manual.image.samples));
  });
  it("exposure compensation applies to the meter target", async () => {
    const r = await simulateCapture({ ...small, exposure: { iso: "auto", compensationStops: 1 } });
    expect(r.exposure.settings.iso).toBe(200);
  });
  it("at the body maximum the ISO is held and iso-maximum is reported", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX / 1e4, exposure: { iso: "auto" } });
    expect(r.exposure.settings.iso).toBe(25600);
    expect(r.exposure.autoIso).toMatchObject({ clamped: "maximum", limitingConstraint: "iso-maximum" });
    expect(r.exposure.autoIso!.residualStops).toBeCloseTo(Math.log2(1e4 / 256), 3);
  });
  it("a brighter scene holds the ISO at the Auto ISO minimum", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX * 8, exposure: { iso: "auto" } });
    expect(r.exposure.settings.iso).toBe(100);
    expect(r.exposure.autoIso).toMatchObject({ clamped: "minimum", limitingConstraint: "iso-minimum" });
    expect(r.exposure.autoIso!.residualStops).toBeCloseTo(-3, 3);
  });
});

describe("aperture priority + Auto ISO (#516)", () => {
  it("the default scene at f/8 gives 1/125 s at ISO 100", async () => {
    const r = await simulateCapture({ ...small, exposure: aperturePriority(1 / 125) });
    expect(r.exposure.settings.fNumber).toBe(8);
    expect(r.exposure.settings.shutterSeconds).toBeCloseTo(1 / 125, 6);
    expect(r.exposure.settings.iso).toBe(100);
    expect(r.exposure.autoIso).toMatchObject({ afterMaximumIso: "allow-slower-shutter", slowestPreferredShutterSeconds: 1 / 125, afterMaximumIsoFallbackUsed: false });
    expect(r.assumptions.find((a) => a.id === "exposure.autoIso.afterMaximumIso")?.kind).toBe("default");
  });
  it("a darker scene keeps the slowest preferred shutter and raises the ISO, byte-identical to that manual exposure", async () => {
    const options: SimulateCaptureOptions = { ...small, illuminanceLux: LUX / 8, exposure: aperturePriority(1 / 125) };
    const auto = await simulateCapture(options), manual = await simulateCapture({ ...options, exposure: { iso: 800, shutterSeconds: 1 / 125 } });
    expect(auto.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 800 });
    expect(Array.from(auto.image.samples)).toEqual(Array.from(manual.image.samples));
  });
  it("a slower preferred shutter takes some of the exposure before the ISO rises", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX / 8, exposure: aperturePriority(1 / 30) });
    expect(r.exposure.settings.shutterSeconds).toBe(1 / 30);
    // Ideal ISO 100 · (8/125) / (1/30) = 192, the nearest selectable ISO in log2 is 200.
    expect(r.exposure.autoIso!.idealIsoBeforeConstraints).toBeCloseTo(192, 1);
    expect(r.exposure.settings.iso).toBe(200);
    expect(r.exposure.autoIso!.limitingConstraint).toBe("iso-grid-quantization");
  });
  it("at the maximum ISO, allow-slower-shutter lengthens the shutter to the target", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX / 1e4, exposure: aperturePriority(1 / 125, "allow-slower-shutter") });
    expect(r.exposure.settings.iso).toBe(25600);
    expect(r.exposure.settings.shutterSeconds).toBeCloseTo(1e4 / 125 / 256, 4);
    expect(r.exposure.autoIso).toMatchObject({ clamped: "maximum", afterMaximumIsoFallbackUsed: true, limitingConstraint: "none" });
    expect(Math.abs(r.exposure.autoIso!.residualStops)).toBeLessThan(1e-3);
  });
  it("at the maximum ISO, hold-preferred-shutter keeps the shutter and reports iso-maximum", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX / 1e4, exposure: aperturePriority(1 / 125, "hold-preferred-shutter") });
    expect(r.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 25600 });
    expect(r.exposure.autoIso).toMatchObject({ clamped: "maximum", afterMaximumIsoFallbackUsed: false, limitingConstraint: "iso-maximum",
      afterMaximumIso: "hold-preferred-shutter" });
    expect(r.exposure.autoIso!.residualStops).toBeGreaterThan(5);
  });
});

describe("shutter priority and program + Auto ISO (#516)", () => {
  it("shutter priority: the default scene gives f/8 at ISO 100", async () => {
    const r = await simulateCapture({ ...small, exposure: { mode: "shutter-priority", iso: "auto" } });
    expect(r.exposure.settings.fNumber).toBeCloseTo(8, 3);
    expect(r.exposure.settings.iso).toBe(100);
  });
  it("shutter priority: past the widest aperture the ISO rises, then holds at the maximum", async () => {
    const dark = await simulateCapture({ ...small, illuminanceLux: LUX / 64, exposure: { mode: "shutter-priority", iso: "auto" } });
    expect(dark.exposure.settings).toEqual({ fNumber: 4, shutterSeconds: 1 / 125, iso: 1600 });
    const darker = await simulateCapture({ ...small, illuminanceLux: LUX / 1e5, exposure: { mode: "shutter-priority", iso: "auto" } });
    expect(darker.exposure.settings.iso).toBe(25600);
    expect(darker.exposure.autoIso!.limitingConstraint).toBe("iso-maximum");
  });
  it("program: the program line at the lowest ISO, then the ISO beyond the line's end", async () => {
    const day = await simulateCapture({ ...small, exposure: { mode: "program", iso: "auto" } });
    expect(day.exposure.settings.iso).toBe(100);
    // The generic line ends at f/4, 1.024 s, 9 stops below f/8, 1/125 s; 12 stops darker needs 3 more stops of ISO.
    const night = await simulateCapture({ ...small, illuminanceLux: LUX / 4096, exposure: { mode: "program", iso: "auto" } });
    expect(night.exposure.settings).toEqual({ fNumber: 4, shutterSeconds: 1.024, iso: 800 });
    const darker = await simulateCapture({ ...small, illuminanceLux: LUX / 1e7, exposure: { mode: "program", iso: "auto" } });
    expect(darker.exposure.settings.iso).toBe(25600);
    expect(darker.exposure.autoIso).toMatchObject({ clamped: "maximum", limitingConstraint: "iso-maximum" });
  });
  it("every report number is finite", async () => {
    for (const exposure of [{ iso: "auto" as const }, aperturePriority(1 / 60), { mode: "shutter-priority" as const, iso: "auto" as const },
      { mode: "program" as const, iso: "auto" as const }]) {
      const r = await simulateCapture({ ...small, illuminanceLux: LUX / 300, exposure });
      for (const value of [...Object.values(r.exposure.settings), ...Object.values(r.exposure.autoIso!)]) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      expect(resolution(r).resolvedSettings.iso).toBe(r.exposure.settings.iso);
    }
  });
});

describe("a capture, its display view, its ideal reference and its region parts resolve the same ISO (#516)", () => {
  const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 8 }, output: { width: 16, height: 12 }, illuminanceLux: LUX / 50,
    exposure: aperturePriority(1 / 250, "hold-preferred-shutter") };
  it("same settings and report", async () => {
    const capture = await simulateCapture(options);
    const { mode, settings, ev100, isoControl, autoIso } = capture.exposure, shared = { mode, settings, ev100, isoControl, autoIso };
    expect(shared.isoControl).toBe("automatic");
    const view = { width: 8, height: 6, samplesPerAxis: 1 };
    const direct = await simulateDisplayView(options, view), prepared = await (await prepareDisplayView(options)).render(view);
    const reference = await simulateIdealReference(options);
    // The display view also reports the capture's deviations from the standard exposure (#515; 2.14 grey card); the ideal reference does not.
    const viewExposure = { ...shared, standardExposureDeviationStops: capture.exposure.standardExposureDeviationStops,
      standardExposureIlluminanceLux: capture.exposure.standardExposureIlluminanceLux, greyCardDeviationStops: capture.exposure.greyCardDeviationStops, metering: capture.exposure.metering };
    expect(direct.exposure).toEqual(viewExposure);
    expect(prepared.exposure).toEqual(viewExposure);
    expect(reference.exposure).toEqual(shared);
    const width = 16, height = 12, samples = new Array<number>(width * height * 3).fill(-1);
    for (const region of [{ x: 0, y: 0, width: 7, height: 5 }, { x: 7, y: 0, width: 9, height: 5 }, { x: 0, y: 5, width: 16, height: 7 }]) {
      const part = await simulateCapture({ ...options, output: { ...options.output, region } });
      expect(part.exposure.settings).toEqual(capture.exposure.settings);
      expect(part.exposure.autoIso).toEqual(capture.exposure.autoIso);
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width * 3; x++) samples[((region.y + y) * width + region.x) * 3 + x] = part.image.samples[y * region.width * 3 + x]!;
    }
    expect(samples).toEqual(Array.from(capture.image.samples));
  });
});

describe("Auto ISO option validation (#516)", () => {
  const bad: [string, NonNullable<SimulateCaptureOptions["exposure"]>][] = [
    ["a string other than auto", { iso: "AUTO" as never }],
    ["NaN ISO", { iso: NaN }],
    ["autoIso with a numeric ISO", { mode: "aperture-priority", iso: 400, autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }],
    ["autoIso in manual mode", { iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }],
    ["autoIso in shutter priority", { mode: "shutter-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }],
    ["aperture priority without a slowest preferred shutter", { mode: "aperture-priority", iso: "auto" }],
    ["aperture priority with an empty autoIso", { mode: "aperture-priority", iso: "auto", autoIso: {} as never }],
    ["NaN slowest preferred shutter", aperturePriority(NaN)],
    ["infinite slowest preferred shutter", aperturePriority(Infinity)],
    ["zero slowest preferred shutter", aperturePriority(0)],
    ["slowest preferred shutter beyond the body's 30 s", aperturePriority(60)],
    ["slowest preferred shutter below the body's 1/8000 s", aperturePriority(1 / 16000)],
    ["unknown afterMaximumIso", aperturePriority(1 / 60, "allow" as never)],
    ["unknown autoIso key", { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60, maximumIso: 3200 } as never }]
  ];
  it("a body without Auto ISO fails with a domain error; its numeric ISO still works", async () => {
    const preset = resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" }).find((p) => p.tier === "professional")!;
    const iso = preset.body.exposure.iso;
    const camera = { ...preset, body: { ...preset.body, exposure: { ...preset.body.exposure, iso: { ...iso, autoIso: { ...iso.autoIso, value: "unsupported" as const } } } } };
    await expect(simulateCapture({ ...small, camera, exposure: { iso: "auto" } })).rejects.toThrow(/Auto ISO is unsupported/);
    expect((await simulateCapture({ ...small, camera, exposure: { iso: 200 } })).exposure.settings.iso).toBe(200);
  });
  for (const [name, exposure] of bad) it(name + " fails with a domain error", async () => {
    await expect(simulateCapture({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
    await expect(prepareDisplayView({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
  });
});

describe("the deviation from the standard exposure under Auto ISO (#515 with #516)", () => {
  it("equals the Auto ISO report's residual on an 18 % grey scene, in each mode", async () => {
    const cases: readonly NonNullable<SimulateCaptureOptions["exposure"]>[] = [
      { mode: "manual", iso: "auto" },
      { mode: "program", iso: "auto" },
      { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 250, afterMaximumIso: "hold-preferred-shutter" } }
    ];
    for (const [i, exposure] of cases.entries()) {
      const result = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 6 }, illuminanceLux: [LUX / 8, LUX / 50, LUX / 50][i]!, exposure });
      // Two independent computations: the meter's log₂ ratio (#515) and the resolver's residual to its target (#516).
      expect(result.exposure.standardExposureDeviationStops).toBeCloseTo(result.exposure.autoIso!.residualStops, 9);
    }
  });
});

describe("photographer-set Auto ISO limits: exposure.autoIso.limits (#505)", () => {
  // The professional tier: Auto ISO 100 to 25600 on a full-stop grid.
  const dark = { ...small, illuminanceLux: LUX / 1e4 };
  it("manual: the ISO stops at the photographer's maximum, reported as user-iso-maximum", async () => {
    const r = await simulateCapture({ ...dark, exposure: { iso: "auto", autoIso: { limits: { maximum: 6400 } } } });
    expect(r.exposure.settings.iso).toBe(6400);
    expect(r.exposure.autoIso).toMatchObject({ autoIsoMinimum: 100, autoIsoMaximum: 25600, limits: { minimum: 100, maximum: 6400 }, clamped: "maximum",
      limitingConstraint: "user-iso-maximum" });
    expect(r.exposure.autoIso!.residualStops).toBeCloseTo(Math.log2(1e4 / 64), 3);
    expect(r.assumptions.find((a) => a.id === "exposure.autoIso")?.value).toMatchObject({ limits: { minimum: 100, maximum: 6400 } });
  });
  it("manual: a capped capture is byte-identical to that manual ISO", async () => {
    const auto = await simulateCapture({ ...dark, exposure: { iso: "auto", autoIso: { limits: { maximum: 6400 } } } });
    const manual = await simulateCapture({ ...dark, exposure: { iso: 6400 } });
    expect(Array.from(auto.image.samples)).toEqual(Array.from(manual.image.samples));
  });
  it("manual: a bright scene holds at the photographer's minimum, reported as user-iso-minimum", async () => {
    const r = await simulateCapture({ ...small, illuminanceLux: LUX * 8, exposure: { iso: "auto", autoIso: { limits: { maximum: 3200, minimum: 400 } } } });
    expect(r.exposure.settings.iso).toBe(400);
    expect(r.exposure.autoIso).toMatchObject({ clamped: "minimum", limitingConstraint: "user-iso-minimum", limits: { minimum: 400, maximum: 3200 } });
    expect(r.exposure.autoIso!.residualStops).toBeCloseTo(-5, 3);
  });
  it("limits equal to the body's range report the body's constraints and give the same image", async () => {
    const free = await simulateCapture({ ...dark, exposure: { iso: "auto" } });
    const same = await simulateCapture({ ...dark, exposure: { iso: "auto", autoIso: { limits: { maximum: 25600, minimum: 100 } } } });
    expect(same.exposure.autoIso!.limitingConstraint).toBe("iso-maximum");
    expect(same.exposure.settings).toEqual(free.exposure.settings);
    expect(Array.from(same.image.samples)).toEqual(Array.from(free.image.samples));
    expect(free.exposure.autoIso).not.toHaveProperty("limits");
  });
  it("aperture priority: both afterMaximumIso policies treat the photographer's cap like the body's", async () => {
    const allow = await simulateCapture({ ...dark, exposure: { mode: "aperture-priority", iso: "auto",
      autoIso: { slowestPreferredShutterSeconds: 1 / 125, afterMaximumIso: "allow-slower-shutter", limits: { maximum: 3200 } } } });
    expect(allow.exposure.settings.iso).toBe(3200);
    expect(allow.exposure.settings.shutterSeconds).toBeCloseTo(1e4 / 125 / 32, 4);
    expect(allow.exposure.autoIso).toMatchObject({ clamped: "maximum", afterMaximumIsoFallbackUsed: true, limitingConstraint: "none" });
    const hold = await simulateCapture({ ...dark, exposure: { mode: "aperture-priority", iso: "auto",
      autoIso: { slowestPreferredShutterSeconds: 1 / 125, afterMaximumIso: "hold-preferred-shutter", limits: { maximum: 3200 } } } });
    expect(hold.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 3200 });
    expect(hold.exposure.autoIso).toMatchObject({ afterMaximumIsoFallbackUsed: false, limitingConstraint: "user-iso-maximum" });
    expect(hold.exposure.autoIso!.residualStops).toBeCloseTo(Math.log2(1e4 / 32), 3);
  });
  it("shutter priority and program stop at the photographer's maximum", async () => {
    for (const mode of ["shutter-priority", "program"] as const) {
      const r = await simulateCapture({ ...small, illuminanceLux: LUX / 1e7, exposure: { mode, iso: "auto", autoIso: { limits: { maximum: 1600 } } } });
      expect(r.exposure.settings.iso).toBe(1600);
      expect(r.exposure.autoIso).toMatchObject({ clamped: "maximum", limitingConstraint: "user-iso-maximum" });
    }
  });
  it("the display view and the ideal reference report the same limits", async () => {
    const options: SimulateCaptureOptions = { ...dark, exposure: { mode: "program", iso: "auto", autoIso: { limits: { maximum: 3200, minimum: 200 } } } };
    const capture = await simulateCapture(options);
    const view = await simulateDisplayView(options, { width: 4, height: 4, samplesPerAxis: 1 });
    expect(view.exposure.autoIso).toEqual(capture.exposure.autoIso);
    expect((await simulateIdealReference(options)).exposure.autoIso).toEqual(capture.exposure.autoIso);
  });
  const bad: [string, NonNullable<SimulateCaptureOptions["exposure"]>][] = [
    ["limits with a numeric ISO", { iso: 400, autoIso: { limits: { maximum: 3200 } } }],
    ["a maximum above the body's Auto ISO maximum", { iso: "auto", autoIso: { limits: { maximum: 51200 } } }],
    ["a maximum below the body's Auto ISO minimum", { iso: "auto", autoIso: { limits: { maximum: 50 } } }],
    ["a maximum off the ISO grid", { iso: "auto", autoIso: { limits: { maximum: 5000 } } }],
    ["a minimum above the maximum", { iso: "auto", autoIso: { limits: { maximum: 800, minimum: 1600 } } }],
    ["a missing maximum", { iso: "auto", autoIso: { limits: { minimum: 200 } as never } }],
    ["a NaN maximum", { iso: "auto", autoIso: { limits: { maximum: NaN } } }],
    ["an unknown limits key", { iso: "auto", autoIso: { limits: { maximum: 800, flash: 400 } as never } }],
    ["limits that are not an object", { iso: "auto", autoIso: { limits: 800 as never } }],
    ["afterMaximumIso outside aperture priority", { mode: "program", iso: "auto", autoIso: { afterMaximumIso: "hold-preferred-shutter", limits: { maximum: 800 } } }]
  ];
  for (const [name, exposure] of bad) it(name + " fails with a domain error", async () => {
    await expect(simulateCapture({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
    await expect(prepareDisplayView({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
  });
});

describe("the automatic slowest shutter: slowestPreferredShutterSeconds \"auto\" (#504)", () => {
  // The defaults: the tier's 50 mm lens focused at 5 m, 6 µm pixels, a 1-pixel budget and the generic 4.39 °/s hand.
  const v = calculateThinLensImageDistance({ focalLengthMm: 50, objectDistanceM: 5 }).value.imageDistanceMm;
  const derived = Math.atan(0.006 / v) / GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC.yaw;
  const auto = (extra: Record<string, unknown> = {}, mode: "aperture-priority" | "program" = "aperture-priority"): NonNullable<SimulateCaptureOptions["exposure"]> =>
    ({ mode, iso: "auto", autoIso: { slowestPreferredShutterSeconds: "auto", ...extra } });
  it("aperture priority: the shutter is held at the derived threshold and the report says how it was derived", async () => {
    const r = await simulateCapture({ ...small, exposure: auto() });
    const a = r.exposure.autoIso!.automaticSlowestShutter!;
    expect(a.derivedShutterSeconds).toBeCloseTo(derived, 15);
    expect(a).toMatchObject({ fasterByStops: 0, blurBudgetPixels: 1, stabilizationStopsEquivalent: 0, angularVelocityRadPerSec: { ...GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC } });
    expect(a.blurAtShutterPixels).toBeCloseTo(1, 9);
    expect(r.exposure.autoIso!.slowestPreferredShutterSeconds).toBe(a.shutterSeconds);
    // 1/125 s would meet the default scene at ISO 100; the threshold (about 1/648 s) is faster, so the ISO rises.
    expect(r.exposure.settings.shutterSeconds).toBeCloseTo(a.shutterSeconds, 15);
    expect(r.exposure.settings.iso).toBeGreaterThan(100);
    const ids = r.assumptions.map((x) => x.id);
    for (const id of ["exposure.autoIso.automaticSlowestShutter", "exposure.autoIso.automaticSlowestShutter.angularVelocityRadPerSec",
      "exposure.autoIso.automaticSlowestShutter.blurBudgetPixels", "exposure.autoIso.automaticSlowestShutter.fasterByStops"]) expect(ids).toContain(id);
  });
  it("equals estimateAutoIsoSlowestShutter for the request's lens and sensor", async () => {
    const options = { fasterByStops: -1, blurBudgetPixels: 2, stabilizationStopsEquivalent: 3, angularVelocityRadPerSec: { yaw: 0.05, pitch: 0.03 } };
    const r = await simulateCapture({ ...small, lens: { prime: 85 }, sensor: { pixelPitchMicrometers: 4 }, exposure: auto({ automaticSlowestShutter: options }) });
    const focalLengthMm = (r.assumptions.find((x) => x.id === "lens.prime")!.value as { focalLengthMm: number }).focalLengthMm;
    const direct = estimateAutoIsoSlowestShutter({ focalLengthMm, focusDistanceM: 5, angularVelocityRadPerSec: options.angularVelocityRadPerSec,
      stabilizationStopsEquivalent: 3, blurBudget: { kind: "pixels", pixels: 2, pixelPitchMicrometers: 4 }, fasterByStops: -1 }).value;
    const a = r.exposure.autoIso!.automaticSlowestShutter!;
    expect(a.derivedShutterSeconds).toBe(direct.derivedShutterSeconds);
    expect(a.biasedShutterSeconds).toBe(direct.biasedShutterSeconds);
    expect(a.shutterSeconds).toBe(direct.biasedShutterSeconds);
    // One stop slower doubles the time: about twice the 2-pixel budget (tan is not linear at this short physical focal length on the 8 × 8 frame).
    expect(a.blurAtShutterPixels).toBeGreaterThan(4);
    expect(a.blurAtShutterPixels).toBeCloseTo(4, 1);
  });
  it("a longer lens gives a faster threshold; the bias moves it by whole stops", async () => {
    const at = async (prime: number, fasterByStops = 0): Promise<number> =>
      (await simulateCapture({ ...small, lens: { prime }, exposure: auto({ automaticSlowestShutter: { fasterByStops } }) })).exposure.autoIso!.slowestPreferredShutterSeconds!;
    expect(await at(200)).toBeLessThan(await at(50));
    expect(await at(50, -2) / await at(50)).toBeCloseTo(4, 12);
    expect(await at(50) / await at(50, 1)).toBeCloseTo(2, 12);
  });
  it("program: a number or \"auto\" holds the program line's shutter before the ISO rises", async () => {
    // At 1/64 of the default light the generic line lengthens the shutter past 1/250 s; a 1/250 s floor holds it there and raises the ISO.
    const dark = { ...small, illuminanceLux: LUX / 64 };
    const free = await simulateCapture({ ...dark, exposure: { mode: "program", iso: "auto" } });
    const held = await simulateCapture({ ...dark, exposure: { mode: "program", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 250 } } });
    expect(free.exposure.settings.shutterSeconds).toBeGreaterThan(1 / 250);
    expect(held.exposure.settings.shutterSeconds).toBeCloseTo(1 / 250, 12);
    expect(held.exposure.settings.fNumber).toBe(free.exposure.settings.fNumber);
    expect(held.exposure.settings.iso).toBeGreaterThan(free.exposure.settings.iso);
    expect(held.exposure.autoIso).toMatchObject({ slowestPreferredShutterApplied: true, afterMaximumIso: "allow-slower-shutter", afterMaximumIsoFallbackUsed: false });
    expect(free.exposure.autoIso).not.toHaveProperty("slowestPreferredShutterApplied");
    const automatic = await simulateCapture({ ...dark, exposure: auto({}, "program") });
    expect(automatic.exposure.settings.shutterSeconds).toBeCloseTo(automatic.exposure.autoIso!.automaticSlowestShutter!.shutterSeconds, 12);
  });
  it("the display view reports the same derivation", async () => {
    const options: SimulateCaptureOptions = { ...small, exposure: auto({ automaticSlowestShutter: { fasterByStops: -2 } }) };
    const capture = await simulateCapture(options), view = await simulateDisplayView(options, { width: 4, height: 4, samplesPerAxis: 1 });
    expect(view.exposure.autoIso).toEqual(capture.exposure.autoIso);
  });
  const bad: [string, NonNullable<SimulateCaptureOptions["exposure"]>][] = [
    ["a string other than auto", auto({ slowestPreferredShutterSeconds: "AUTO" })],
    ["automaticSlowestShutter with a numeric slowest shutter", { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60, automaticSlowestShutter: {} } }],
    ["a fractional bias", auto({ automaticSlowestShutter: { fasterByStops: 0.5 } })],
    ["a bias of three stops", auto({ automaticSlowestShutter: { fasterByStops: 3 } })],
    ["a zero blur budget", auto({ automaticSlowestShutter: { blurBudgetPixels: 0 } })],
    ["no shake", auto({ automaticSlowestShutter: { angularVelocityRadPerSec: { yaw: 0, pitch: 0 } } })],
    ["a NaN shake", auto({ automaticSlowestShutter: { angularVelocityRadPerSec: { yaw: NaN, pitch: 0 } } })],
    ["negative stabilization", auto({ automaticSlowestShutter: { stabilizationStopsEquivalent: -1 } })],
    ["an unknown automaticSlowestShutter key", auto({ automaticSlowestShutter: { budgetMm: 0.01 } })],
    ["auto in shutter priority", { mode: "shutter-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: "auto" } }],
    ["afterMaximumIso in program without a slowest shutter", { mode: "program", iso: "auto", autoIso: { afterMaximumIso: "hold-preferred-shutter" } }]
  ];
  for (const [name, exposure] of bad) it(name + " fails with a domain error", async () => {
    await expect(simulateCapture({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
    await expect(prepareDisplayView({ ...small, exposure })).rejects.toThrow(InvalidConfigurationError);
  });
});

describe("an exposure met at the ISO range end is not reported as held there (#681)", () => {
  it("program-mode daylight at ISO 100 and manual + Auto ISO at ISO 25 600", async () => {
    // Both program captures end at ISO 100 on target; before #681 the first (ideal ISO 99.99999999999997) reported
    // clamped "minimum" and "iso-minimum", the second not. The manual capture's ideal ISO was 25600.000000000033.
    for (const [illuminanceLux, exposure, iso] of [[1000, { mode: "program", iso: "auto" }, 100], [130_220.023, { mode: "program", iso: "auto" }, 100],
      [LUX / 256, { iso: "auto", metering: "grey-card" }, 25600]] as const) {
      const r = await simulateCapture({ ...small, illuminanceLux, exposure } as SimulateCaptureOptions);
      expect(r.exposure.settings.iso).toBe(iso);
      expect(Math.abs(r.exposure.autoIso!.residualStops)).toBeLessThan(1e-12);
      expect(r.exposure.autoIso).toMatchObject({ clamped: false, limitingConstraint: "none" });
    }
  });
});
