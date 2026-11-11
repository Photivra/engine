// SPDX-License-Identifier: Apache-2.0
/**
 * #449: fixed set-up kept across simulateCapture calls and per-site bookkeeping hoisted out of the tabulated RAW loop, all
 * byte-identical. The diffraction profile is cached by the content of its input (LRU of 8), each call getting its own copy; the
 * metering's CIE ȳ values are tabulated once; with simultaneous opening and closing boundaries the exposure-window sampler is
 * read once per region instead of once per site.
 */
import { describe, expect, it, vi } from "vitest";
import type { SimulateCaptureOptions, SimulateCaptureResult } from "../src/index.js";
import { simultaneousExposureDuration } from "../src/capture/native-environment-tabulated.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const audit = vi.hoisted(() => ({ profiles: 0, samplerCalls: 0 }));
vi.mock("../src/optics/diffraction-psf-profile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/optics/diffraction-psf-profile.js")>();
  return { ...actual, createDiffractionLimitedPsfProfile: (input: Parameters<typeof actual.createDiffractionLimitedPsfProfile>[0]): ReturnType<typeof actual.createDiffractionLimitedPsfProfile> => {
    audit.profiles++;
    return actual.createDiffractionLimitedPsfProfile(input);
  } };
});
vi.mock("../src/sensor/exposure-window.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/sensor/exposure-window.js")>();
  return { ...actual, prepareCaptureExposureWindowSampler: (input: Parameters<typeof actual.prepareCaptureExposureWindowSampler>[0]): ReturnType<typeof actual.prepareCaptureExposureWindowSampler> => {
    const sampler = actual.prepareCaptureExposureWindowSampler(input);
    return (point) => { audit.samplerCalls++; return sampler(point); };
  } };
});

type Engine = typeof import("../src/index.js");
/** A fresh copy of the engine (empty module-level caches). */
async function freshEngine(): Promise<Engine> {
  vi.resetModules();
  return await import("../src/index.js");
}
const method = (r: SimulateCaptureResult): unknown => (r.assumptions.find((a) => a.id === "raw.expectedSignal")?.value as { method?: string } | undefined)?.method;
function expectSameCapture(actual: SimulateCaptureResult, expected: SimulateCaptureResult): void {
  for (const key of ["codes", "saturationFlags", "blackLevels", "digitalSaturationCodes", "effectiveSaturationCodes"] as const) {
    expect(Array.from(actual.raw[key])).toEqual(Array.from(expected.raw[key]));
  }
  expect(Array.from(actual.image.samples)).toEqual(Array.from(expected.image.samples));
  const withoutTimings = (diagnostics: SimulateCaptureResult["diagnostics"]): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...diagnostics };
    delete copy.timingsMs;
    return copy;
  };
  expect(withoutTimings(actual.diagnostics)).toEqual(withoutTimings(expected.diagnostics));
  expect(actual.assumptions).toEqual(expected.assumptions);
  expect(JSON.stringify(actual.request.diffraction?.profile)).toBe(JSON.stringify(expected.request.diffraction?.profile));
}
const quality = { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { antiAliasing: { kind: "four-spot" } },
  output: { width: 64, height: 48, region: { x: 8, y: 4, width: 16, height: 12 } } } as SimulateCaptureOptions;
const withRegion = (options: SimulateCaptureOptions, region: { x: number; y: number; width: number; height: number }): SimulateCaptureOptions =>
  ({ ...options, output: { ...options.output, region } });

describe("diffraction profile cache (#449)", () => {
  it("builds the profile once for the parts of one request and gives every part the bytes of a cold run", async () => {
    const parts = [{ x: 8, y: 4, width: 16, height: 12 }, { x: 24, y: 4, width: 16, height: 12 }, { x: 40, y: 30, width: 24, height: 18 }];
    const cold: SimulateCaptureResult[] = [];
    for (const part of parts) cold.push(await (await freshEngine()).simulateCapture(withRegion(quality, part)));
    const engine = await freshEngine();
    audit.profiles = 0;
    const kernels = await import("../src/optics/site-diffraction-kernel.js");
    const warm: SimulateCaptureResult[] = [];
    let resolvedFirst = 0, resolvedAfterFirst = 0;
    for (const part of parts) {
      const before = kernels.siteDiffractionKernelCacheState().resolves;
      warm.push(await engine.simulateCapture(withRegion(quality, part)));
      const resolved = kernels.siteDiffractionKernelCacheState().resolves - before;
      if (warm.length === 1) resolvedFirst = resolved; else resolvedAfterFirst += resolved;
    }
    expect(audit.profiles).toBe(1);
    // The per-call copy of the kept profile keeps the kernel cache's registration (#446): later parts resolve no kernel.
    expect(resolvedFirst).toBeGreaterThan(0);
    expect(resolvedAfterFirst).toBe(0);
    for (let i = 0; i < parts.length; i++) {
      expect(method(warm[i]!)).toBe("per-site-integrated-electrons");
      expectSameCapture(warm[i]!, cold[i]!);
    }
    // Each part has its own copy of the kept record.
    expect(warm[1]!.request.diffraction!.profile).not.toBe(warm[0]!.request.diffraction!.profile);
    expect(warm[1]!.request.diffraction!.profile.profile).not.toBe(warm[0]!.request.diffraction!.profile.profile);
  }, scaledTimeout(300_000));

  it("misses on any changed input of the profile and then matches an uncached run bit for bit", async () => {
    const changes: SimulateCaptureOptions[] = [
      { ...quality, lens: { fNumber: 8, diffraction: "circular-aperture" } },
      { ...quality, lens: { fNumber: 11, diffraction: { kind: "circular-aperture", kernelRadiusSamples: 3 } } },
      { ...quality, sensor: { ...quality.sensor, pixelPitchMicrometers: 2.4 } },
      { ...quality, sensor: { ...quality.sensor, spectralStepNanometers: 10 } },
      { ...quality, lens: { ...quality.lens, focusDistanceM: 1.5 }, subjectDistanceM: 1.5 },
      { ...quality, sensor: { antiAliasing: { kind: "four-spot", separationSites: 2 } } }
    ];
    const engine = await freshEngine();
    await engine.simulateCapture(quality);
    for (const options of changes) {
      audit.profiles = 0;
      const warm = await engine.simulateCapture(options);
      expect(audit.profiles, JSON.stringify(options)).toBe(1);
      expectSameCapture(warm, await (await freshEngine()).simulateCapture(options));
    }
    // A change that leaves the profile's input as it was (here the scene and the exposure) hits.
    audit.profiles = 0;
    const scene = { ...quality, scene: { preset: "siemens-star" }, exposure: { mode: "manual", iso: 400, shutterSeconds: 1 / 500 } } as SimulateCaptureOptions;
    const hit = await engine.simulateCapture(scene);
    expect(audit.profiles).toBe(0);
    expectSameCapture(hit, await (await freshEngine()).simulateCapture(scene));
  }, scaledTimeout(600_000));

  it("keeps the last 8 profiles", async () => {
    const engine = await freshEngine();
    const at = (fNumber: number): SimulateCaptureOptions => ({ ...quality, lens: { fNumber, diffraction: "circular-aperture" }, output: { width: 16, height: 12 } });
    const fNumbers = [4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9];
    for (const n of fNumbers) await engine.simulateCapture(at(n));
    audit.profiles = 0;
    await engine.simulateCapture(at(4)); // the oldest, now the most recently used
    expect(audit.profiles).toBe(0);
    await engine.simulateCapture(at(10)); // evicts 4.5
    expect(audit.profiles).toBe(1);
    await engine.simulateCapture(at(4));
    expect(audit.profiles).toBe(1);
    await engine.simulateCapture(at(4.5));
    expect(audit.profiles).toBe(2);
  }, scaledTimeout(300_000));

  it("hands each call its own record, as mutable as before, so a caller's change never reaches another call", async () => {
    const engine = await freshEngine();
    const first = await engine.simulateCapture(quality), profile = first.request.diffraction!.profile;
    const before = JSON.stringify(profile);
    // As before the cache: the record is frozen at its top level only.
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.wavelengths)).toBe(false);
    expect(Object.isFrozen(profile.profile.nodes)).toBe(false);
    (profile.profile.nodes[0]!.kernel.normalizedIntensity as number[])[0] = 1;
    (profile.wavelengths[0] as { truncatedEnergyFraction: number }).truncatedEnergyFraction = 0.5;
    (profile.profile.axes.wavelengthNm as number[]).push(1000);
    (profile.quadrature as { maximumAngularNodes: number }).maximumAngularNodes = -1;
    const second = await engine.simulateCapture(quality);
    expect(JSON.stringify(second.request.diffraction!.profile)).toBe(before);
    expectSameCapture(second, await (await freshEngine()).simulateCapture(quality));
  }, scaledTimeout(300_000));

  it("gives two captures awaited together the bytes of sequential runs", async () => {
    const a = withRegion(quality, { x: 8, y: 4, width: 16, height: 12 }), b = withRegion({ ...quality, lens: { fNumber: 8, diffraction: "circular-aperture" } }, { x: 30, y: 20, width: 20, height: 14 });
    const sequential = await freshEngine(), sa = await sequential.simulateCapture(a), sb = await sequential.simulateCapture(b);
    const engine = await freshEngine();
    const [ca, cb] = await Promise.all([engine.simulateCapture(a), engine.simulateCapture(b)]);
    expectSameCapture(ca, sa);
    expectSameCapture(cb, sb);
    const [da, db] = await Promise.all([engine.simulateCapture(a), engine.simulateCapture(a)]);
    expectSameCapture(da, sa);
    expectSameCapture(db, sa);
  }, scaledTimeout(300_000));
});

describe("metering luminance (#449)", () => {
  it("keeps the metered scene luminance of 2.x to the last bit", async () => {
    // Values of origin/main before the CIE ȳ table (luminanceOf called estimateCie1931ColorMatchingFunctions per zone and node).
    const engine = await freshEngine();
    const cases: [SimulateCaptureOptions, number][] = [
      [{ scene: { preset: "siemens-star" }, output: { width: 48, height: 32 } }, 1963.6915619336478],
      [{ scene: { preset: "dead-leaves" }, illuminant: { kind: "planckian", temperatureKelvin: 2856 }, output: { width: 48, height: 32 } }, 2713.8504890409536],
      [{ scene: { kind: "radiance-function", sceneId: "test-lum", evaluate: ({ u, v, wavelengthNanometers: nm }: { u: number; v: number; wavelengthNanometers: number }): number =>
        (u > 0 ? 0.02 : 0.005) * (1 + Math.sin(nm / 37) * 0.3 + v * 0.1) }, output: { width: 48, height: 32 } } as SimulateCaptureOptions, 991.8200312362467]
    ];
    for (const [options, luminance] of cases) expect((await engine.simulateCapture(options)).exposure.meteredSceneLuminanceCdPerSquareMeter).toBe(luminance);
  }, scaledTimeout(120_000));
});

describe("constant exposure duration for simultaneous boundaries (#449)", () => {
  const region = { x: 10, y: 6, width: 8, height: 4 };
  it("reads the sampler once at each end of the region for simultaneous boundaries", () => {
    const points: { x: number; y: number }[] = [];
    const sampler = (point: { x: number; y: number }): { localExposureDurationSeconds: number } => { points.push({ ...point }); return { localExposureDurationSeconds: 0.008 }; };
    expect(simultaneousExposureDuration({ opening: { kind: "simultaneous" }, closing: { kind: "simultaneous" } }, sampler, region)).toBe(0.008);
    expect(points).toEqual([{ x: 10.5, y: 6.5 }, { x: 17.5, y: 9.5 }]);
  });
  it("leaves every other schedule to the per-site path", () => {
    let calls = 0;
    const sampler = (): { localExposureDurationSeconds: number } => { calls++; return { localExposureDurationSeconds: 0.008 }; };
    const rolling = { kind: "line-scan", directionNative: "top-to-bottom", traversalDurationSeconds: 0.01 };
    for (const schedule of [{ opening: rolling, closing: rolling }, { opening: { kind: "simultaneous" }, closing: rolling }, { opening: rolling, closing: { kind: "simultaneous" } }]) {
      expect(simultaneousExposureDuration(schedule, sampler, region)).toBeUndefined();
    }
    expect(calls).toBe(0);
    // A point outside the active capture rectangle (the sampler throws) or two different ends: per site, where it throws as before.
    const simultaneous = { opening: { kind: "simultaneous" }, closing: { kind: "simultaneous" } };
    expect(simultaneousExposureDuration(simultaneous, (p) => { if (p.x > 15) throw new Error("outside"); return { localExposureDurationSeconds: 0.008 }; }, region)).toBeUndefined();
    expect(simultaneousExposureDuration(simultaneous, (p) => ({ localExposureDurationSeconds: p.y }), region)).toBeUndefined();
  });

  it("runs the sampler per site for a rolling shutter and gives the global shutter's bytes where both must agree", async () => {
    const engine = await freshEngine();
    const base = { scene: { preset: "siemens-star" }, output: { width: 48, height: 32 } } as SimulateCaptureOptions;
    audit.samplerCalls = 0;
    const global = await engine.simulateCapture(base);
    const globalCalls = audit.samplerCalls;
    audit.samplerCalls = 0;
    const rolling = await engine.simulateCapture({ ...base, motion: { shutter: "rolling" } });
    const rollingCalls = audit.samplerCalls, sites = rolling.raw.codes.length;
    expect(method(global)).toBe("per-site-integrated-electrons");
    expect(method(rolling)).toBe("per-site-integrated-electrons");
    expect((rolling.assumptions.find((a) => a.id === "sensor.shutter")?.value as { kind?: string }).kind).toBe("electronic-rolling");
    expect(globalCalls).toBe(2);
    expect(rollingCalls).toBeGreaterThanOrEqual(sites);
    // A still scene: a rolling site integrates over [s·τ, s·τ + T], so its duration, dark charge and every code equal the global shutter's.
    for (const key of ["codes", "saturationFlags", "blackLevels", "digitalSaturationCodes", "effectiveSaturationCodes"] as const) {
      expect(Array.from(rolling.raw[key])).toEqual(Array.from(global.raw[key]));
    }
    expect(Array.from(rolling.image.samples)).toEqual(Array.from(global.image.samples));
  }, scaledTimeout(120_000));
});
