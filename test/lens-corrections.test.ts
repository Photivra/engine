// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  resolveLensCorrectionPlan, calculateLensCorrectedCapture, calculatePeripheralIlluminationCorrection,
  parseGenericLensCorrectionProfile, type GenericLensCorrectionProfile, type ResolvedLensCorrectionPlan
} from "../src/index.js";
import { correctionProfile, gain, raster, resampler, state, transform } from "./optics-group-fixtures.js";
const physical = Array.from({ length: 25 }, (_, i) => 10+i*.01);
const capture = { state, captureId: "physical-capture-1", noiseRealizationId: "noise-42", timeSeconds: .1, raster,
  channels: { red: physical, green: physical, blue: physical } };
function plan(profile = correctionProfile, selections: Record<string, "on" | "off" | "auto"> = {}): ResolvedLensCorrectionPlan {
  return resolveLensCorrectionPlan({ profile, state: profile.state, selections, outputKind: "processed", selectionKind: "camera-selectable" }).value;
}
function render(resolved = plan()): ReturnType<typeof calculateLensCorrectedCapture>["value"] {
  return calculateLensCorrectedCapture({ plan: resolved, capture, destinationRaster: raster, resampler,
    physicalProjectionDistanceMm: 50, clippingLevel: 100 }).value;
}
describe("generic camera lens correction", () => {
  it("honors a shifted output lattice with all corrections Off and preserves missing support", () => {
    const output = calculateLensCorrectedCapture({ plan: plan(correctionProfile, { geometry: "off", gain: "off" }),
      capture, destinationRaster: { ...raster, centerMm: { x: 1, y: 0 } }, resampler,
      physicalProjectionDistanceMm: 50, clippingLevel: 100 }).value;
    expect(output.channels.red[0]).toBe(physical[1]);
    expect(output.channels.red[4]).toBe(null);
    expect(output.validSourceMask.filter(Boolean).length).toBe(20);
    expect(output.jointCrop).toEqual({ x: 0, y: 0, width: 4, height: 5 });
    expect(output.samplingPlans.red!.mapping.transforms).toEqual([]);
    expect(output.captureId).toBe(capture.captureId);
    expect(output.noiseRealizationId).toBe(capture.noiseRealizationId);
  });
  it("returns the requested processed crop size when corrections are Off, leaving RAW-like samples intact", () => {
    const croppedState = { ...state, outputWidth: 3, outputHeight: 3 };
    const profile = { ...correctionProfile, state: croppedState };
    const croppedCapture = { ...capture, state: croppedState };
    const destination = { ...raster, width: 3, height: 3 };
    const resolved = plan(profile, { geometry: "off", gain: "off" });
    const request = { plan: resolved, capture: croppedCapture, destinationRaster: destination,
      resampler, physicalProjectionDistanceMm: 50, clippingLevel: 100 };
    const output = calculateLensCorrectedCapture(request).value;
    expect(output.channels.red).toEqual([6, 7, 8, 11, 12, 13, 16, 17, 18].map((i) => physical[i]));
    expect(output.validSourceMask).toEqual(Array<boolean>(9).fill(true));
    expect(output.jointCrop).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(calculateLensCorrectedCapture({ ...request, plan: { ...resolved, outputKind: "raw-like" } }).value.channels)
      .toEqual(capture.channels);
  });
  it("Off and RAW-like metadata preserve the same physical samples/noise/capture", () => {
    const off = render(plan(correctionProfile, { geometry: "off", gain: "off" }));
    expect(off.channels).toEqual(capture.channels); expect(off.noiseRealizationId).toBe("noise-42");
    const raw = resolveLensCorrectionPlan({ profile: correctionProfile, state, selections: {},
      outputKind: "raw-like", selectionKind: "camera-selectable" }).value;
    expect(raw.application).toBe("metadata-only"); expect(raw.components.every((e) => e.enabled)).toBe(true);
    expect(render(raw).channels).toEqual(capture.channels);
    expect(render(raw).captureId).toBe(capture.captureId);
  });
  it("On deterministically applies declared gain with noise amplification and clipping costs", () => {
    const on = render();
    expect(on.channels.red[0]!).toBeGreaterThan(physical[0]!);
    expect(on.channels.red[12]).toBe(physical[12]);
    expect(on).toEqual(render()); expect(capture.channels.red).toEqual(physical);
    expect(on.captureId).toBe(capture.captureId); expect(on.timeSeconds).toBe(capture.timeSeconds);
    const v = calculatePeripheralIlluminationCorrection({ component: gain, imagePointMm: { x: 4, y: 0 }, signal: 10, noiseVariance: 4, clippingLevel: 15 }).value;
    expect(v.gain).toBe(2); expect(v.signalBeforeClipping).toBe(20); expect(v.signal).toBe(15);
    expect(v.noiseVarianceBeforeClipping).toBe(16); expect(v.clipped).toBe(true);
    const partial = calculatePeripheralIlluminationCorrection({ component: { ...gain, strength: .5 }, imagePointMm: { x: 4, y: 0 }, signal: 10, noiseVariance: 4, clippingLevel: 100 }).value;
    expect(partial.gain).toBeCloseTo(Math.sqrt(2), 12);
    expect(() => calculatePeripheralIlluminationCorrection({ component: gain, imagePointMm: { x: 5, y: 0 }, signal: 1, noiseVariance: 0, clippingLevel: 100 })).toThrow();
    expect(() => calculatePeripheralIlluminationCorrection({ component: gain, imagePointMm: { x: 0, y: 0 }, signal: 1, noiseVariance: -1, clippingLevel: 100 })).toThrow();
  });
  it("mandatory and automatic states differ from labeled reference bypass", () => {
    const geometry = correctionProfile.components[0]!;
    const mandatory: GenericLensCorrectionProfile = { ...correctionProfile, components: [{ ...geometry, availability: "mandatory" }] };
    expect(plan(mandatory).components[0]!.reason).toBe("mandatory");
    expect(() => plan(mandatory, { geometry: "off" })).toThrow();
    const bypass = resolveLensCorrectionPlan({ profile: mandatory, state, selections: {}, outputKind: "processed", selectionKind: "reference-bypass" }).value;
    expect(bypass.components[0]!.reason).toBe("reference-bypass"); expect(render(bypass).channels).toEqual(capture.channels);
    const automatic = { ...mandatory, components: [{ ...geometry, availability: "automatic" as const }] };
    expect(() => plan(automatic, { geometry: "on" })).toThrow();
    expect(plan(automatic).components[0]!.enabled).toBe(true);
  });
  it("reports explicit digital stabilization dependencies and resolves dependency chains", () => {
    const geometry = correctionProfile.components[0]!;
    const profile = { ...correctionProfile, state: { ...state, stabilizationMode: "digital" },
      components: [{ ...geometry, defaultEnabled: false, requiredByStabilizationModes: ["digital"] },
        { ...gain, dependencies: ["geometry"] }] };
    expect(plan(profile, { geometry: "off", gain: "off" }).components[0]!.reason).toBe("stabilization-dependency");
    expect(plan(profile, { geometry: "off", gain: "on" }).components[0]!.reason).toBe("component-dependency");
    expect(() => parseGenericLensCorrectionProfile({ ...profile, components: [{ ...geometry, dependencies: ["gain"] }, gain] })).toThrow();
  });
  it("fuses common geometry and per-channel CA once and intersects source support", () => {
    const profile: GenericLensCorrectionProfile = { ...correctionProfile, components: [correctionProfile.components[0]!,
      { id: "ca", version: "1", kind: "lateral-ca", domain: "reconstructed-linear", availability: "toggle",
        defaultEnabled: true, dependencies: [], requiredByStabilizationModes: [], residualNote: "Generic registration only.", transforms: {
        red: { ...transform, id: "red", purpose: "lateral-ca", offsetMm: { x: .5, y: 0 } },
        green: { ...transform, id: "green", purpose: "lateral-ca" },
        blue: { ...transform, id: "blue", purpose: "lateral-ca", offsetMm: { x: -.5, y: 0 } }
      } }] };
    const output = render(plan(profile));
    expect(output.channels.red[0]).toBe(null); expect(output.channels.blue[4]).toBe(null);
    expect(output.channels.green[0]).toBe(null); expect(output.channels.red[12]!).toBeCloseTo(10.125, 10);
    expect(output.channels.blue[12]!).toBeCloseTo(10.115, 10);
    expect(output.samplingPlans.red!.mapping.transforms.map((t) => t.id)).toEqual(["red", "warp"]);
    expect(output.validSourceMask.filter(Boolean).length).toBe(15);
    expect(output.jointCrop).toEqual({ x: 1, y: 0, width: 3, height: 5 });
  });
  it("keeps soft corners/bokeh physically soft through directional correction stretch", () => {
    const geometry = correctionProfile.components[0]!;
    if (geometry.kind !== "geometry") throw new Error("fixture");
    const profile = { ...correctionProfile, components: [{ ...geometry, transform: { ...transform, matrix: [.5, 0, 0, 1] as const } }] };
    const blurred = Array<number>(25).fill(0); blurred[11] = 1; blurred[12] = 2; blurred[13] = 1;
    const result = calculateLensCorrectedCapture({ plan: plan(profile), capture: { ...capture, channels: { red: blurred, green: blurred, blue: blurred } },
      destinationRaster: raster, resampler, physicalProjectionDistanceMm: 50, clippingLevel: 100 }).value;
    expect(result.channels.red.slice(10, 15)).toEqual([1, 1.5, 2, 1.5, 1]);
    expect(result.samplingPlans.red!.points[12]!.anisotropy).toBe(2);
  });
  it("permits deliberately residual distortion maps without changing capture or lens state", () => {
    const geometry = correctionProfile.components[0]!;
    if (geometry.kind !== "geometry") throw new Error("fixture");
    const make = (k1: number): GenericLensCorrectionProfile => ({ ...correctionProfile, components: [{ ...geometry,
      residualNote: "Declared correction polynomial; no exact physical inverse claim.",
      transform: { id: "residual-distortion", version: "1", kind: "radial", purpose: "distortion", domain: "reconstructed-linear",
        profile: { normalizationRadiusMm: 4, maximumNormalizedRadius: 1, coefficients: { k1, k2: 0, k3: 0 } } } }] });
    const full = render(plan(make(-.1))), partial = render(plan(make(-.05)));
    expect(full.samplingPlans.red!.points[0]!.sourcePointMm.x).toBeCloseTo(-1.9, 12);
    expect(partial.samplingPlans.red!.points[0]!.sourcePointMm.x).toBeCloseTo(-1.95, 12);
    expect(full.channels.red[0]).not.toBe(partial.channels.red[0]);
    expect(full.noiseRealizationId).toBe(partial.noiseRealizationId);
    expect(capture.state).toEqual(state);
  });
  it("fails closed for incompatible domains, geometry across gain, and wrong output geometry", () => {
    const geometry = correctionProfile.components[0]!;
    if (geometry.kind !== "geometry") throw new Error("fixture");
    const rawDomain = { ...correctionProfile, components: [{ ...geometry, domain: "raw-channel" as const,
      transform: { ...transform, domain: "raw-channel" as const } }] };
    expect(() => render(plan(rawDomain))).toThrow();
    const badOrder = { ...correctionProfile, components: [gain, geometry] };
    expect(() => render(plan(badOrder))).toThrow();
    expect(() => calculateLensCorrectedCapture({ plan: plan(), capture, destinationRaster: { ...raster, width: 6 },
      resampler, physicalProjectionDistanceMm: 50, clippingLevel: 100 })).toThrow();
    expect(() => calculateLensCorrectedCapture({ plan: plan(), capture: { ...capture, state: { ...state, aperture: 8 } },
      destinationRaster: raster, resampler, physicalProjectionDistanceMm: 50, clippingLevel: 100 })).toThrow();
  });
  it("rejects unsupported families, hidden tier assumptions, invalid strengths and bindings", () => {
    for (const value of [{ ...correctionProfile, tier: "professional" }, { ...correctionProfile, schemaVersion: "2" },
      { ...correctionProfile, components: [{ ...gain, kind: "color-shading" }] },
      { ...correctionProfile, components: [{ ...gain, strength: 2 }] },
      { ...correctionProfile, components: [{ ...gain, defaultEnabled: "yes" }] },
      { ...correctionProfile, components: [gain, gain] },
      { ...correctionProfile, components: [{ ...gain, profile: { ...gain.profile, coefficients: { r2: 1, r4: 0, r6: 0 } } }] }]) {
      expect(() => parseGenericLensCorrectionProfile(value)).toThrow();
    }
    expect(() => resolveLensCorrectionPlan({ profile: correctionProfile, state: { ...state, lensId: "different" },
      selections: {}, outputKind: "processed", selectionKind: "camera-selectable" })).toThrow();
    expect(() => plan(correctionProfile, { unknown: "on" })).toThrow();
  });
});

describe("missing sub-objects (capture-32, #698)", () => {
  it("fail with a domain error, never a raw TypeError, in both correction functions", async () => {
    const { probeSubObjects } = await import("./helpers/sub-object-probe.js");
    const { InvalidConfigurationError, InvalidScientificInputError } = await import("../src/index.js");
    const request = { plan: plan(), capture, destinationRaster: raster, resampler, physicalProjectionDistanceMm: 50, clippingLevel: 100 };
    for (const p of [{}, { profile: {} }, { ...plan(), components: undefined }])
      expect(() => calculateLensCorrectedCapture({ ...request, plan: p as never }), JSON.stringify(p).slice(0, 40)).toThrow(InvalidConfigurationError);
    expect(() => calculateLensCorrectedCapture({ ...request, capture: { ...capture, channels: undefined } as never })).toThrow(InvalidConfigurationError);
    expect(() => calculatePeripheralIlluminationCorrection({ component: { kind: "peripheral-illumination", strength: 1 } as never, imagePointMm: { x: 4, y: 0 },
      signal: 10, noiseVariance: 4, clippingLevel: 15 })).toThrow(InvalidConfigurationError);
    const domain = (e: unknown): boolean => e instanceof InvalidConfigurationError || e instanceof InvalidScientificInputError;
    expect(domain).toBeTypeOf("function");
    for (const [fn, input] of [[calculateLensCorrectedCapture, request], [calculatePeripheralIlluminationCorrection,
      { component: gain, imagePointMm: { x: 4, y: 0 }, signal: 10, noiseVariance: 4, clippingLevel: 15 }]] as const) {
      const { probedPaths, escaped } = await probeSubObjects(fn as (v: unknown) => unknown, input);
      expect(probedPaths).toBeGreaterThan(0);
      expect(escaped).toEqual([]);
    }
  });
});
