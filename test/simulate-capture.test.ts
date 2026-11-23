// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, calculateNativeRawPlan, resolveGenericEquipmentTierCatalog, simulateCapture,
  type SimulateCaptureResult } from "../src/index.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";

/** Mean black-subtracted, white-normalized RAW level of one CFA channel over the active area. */
function rawLevel(r: SimulateCaptureResult, channel: "red" | "green" | "blue"): number {
  const raw = r.raw, w = r.plan.exposure.geometry.nativeRaster.pixelWidth, h = r.plan.exposure.geometry.nativeRaster.pixelHeight;
  let sum = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const c = (["red", "green", "green", "blue"] as const)[(y % 2) * 2 + (x % 2)];
    if (c !== channel) continue;
    const i = y * w + x;
    sum += (raw.codes[i]! - raw.blackLevels[i]!) / (raw.effectiveSaturationCodes[(y % 2) * 2 + (x % 2)]! - raw.blackLevels[i]!); n++;
  }
  return sum / n;
}
function mean(r: SimulateCaptureResult): number[] {
  const s = r.image.samples, out = [0, 0, 0];
  for (let i = 0; i < s.length; i++) out[i % 3]! += s[i]!;
  return out.map((v) => v / (s.length / 3));
}
const small = { output: { width: 4, height: 4 } } as const;

// Each capture executes the full native environment RAW pipeline (about 3 ms of CPU per native site), so allow for loaded hosts.
describe("simulateCapture facade", { timeout: 60_000 }, () => {
  it("captures an 18 % grey card with physically consistent defaults and reports every assumption", async () => {
    const r = await simulateCapture({ scene: { preset: "uniform" }, ...small });
    expect(r.image.width).toBe(4);
    expect(r.image.samples).toBeInstanceOf(Uint8Array);
    expect(r.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 125, iso: 100 });
    // CIPA DC-004: the 18 % grey card gets H = 10/S, so its luminance is L = 10·N²/(0.65·t·S) = 80 000/65 cd/m².
    expect(r.exposure.meteredSceneLuminanceCdPerSquareMeter).toBeCloseTo(80_000 / 65, 1);
    // E = π·L/0.18 = π·10·N²/(0.65·t·S·0.18) = π·80 000/11.7 ≈ 21 480.98 lux (was π·12.5·64·125/18 ≈ 17 453.29 lux).
    expect(SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX).toBeCloseTo(Math.PI * 10 * 64 * 125 / (0.65 * 100 * 0.18), 9);
    expect(SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX).toBeCloseTo(21_480.97540916098, 9);
    // Mid grey lands near 13 % of RAW white, so a 100 % reflector sits about half a stop below clipping (0.18·2^-0.5 ≈ 12.7 %); the tier values are not tuned for it.
    for (const c of ["red", "green"] as const) expect(rawLevel(r, c)).toBeGreaterThan(0.08);
    // Blue EQE is scaled by 0.25 instead of 0.5, so its RAW level is about half.
    expect(rawLevel(r, "blue") * 2).toBeGreaterThan(0.08);
    expect(rawLevel(r, "green")).toBeLessThan(0.14);
    const [red, green, blue] = mean(r);
    expect(Math.abs(red! - green!)).toBeLessThan(3);
    expect(Math.abs(blue! - green!)).toBeLessThan(3);
    const ids = r.assumptions.map((a) => a.id);
    for (const id of ["camera", "lens.focalLengthMm", "lens.fNumber", "lens.focusDistanceM", "subjectDistanceM", "exposure.mode", "exposure.iso",
      "exposure.shutterSeconds", "exposure.compensationStops", "illuminant", "illuminanceLux", "output.whiteBalance", "output.toneCurve", "output.highlightMode",
      "output.format", "sensor.pixelPitchMicrometers", "sensor.spectralStepNanometers", "sensor.temporalSampleCount", "sensor.noiseSeed", "scene.reflectance",
      "lens.psf", "lens.transmission", "sensor.spectralResponse", "sensor.darkCurrent", "sensor.capacityElectrons", "output.demosaic", "exposure.referenceExposure"])
      expect(ids, id).toContain(id);
    expect(r.assumptions.find((a) => a.id === "lens.focalLengthMm")!.value).toBe(50);
    expect(r.provenance.scientificStatus).toBe("approximation");
    expect(r.scene.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    // The returned request is the exact one executed.
    expect(calculateNativeRawPlan(r.request.environmentRaw.raw)).toEqual(r.plan);
    expect(r.request.siteInput(7).environment.temporalIntegrationId).toBe("facade-frame:native:7");
    // #394: the tabulated RAW path ran 4 verification sites through the chain (20 spectral subintervals each); the rest of the
    // count is its table's scene lookups, far fewer than the chain's 6 × 6 native sites × 20 subintervals.
    expect(r.assumptions.find((a) => a.id === "raw.expectedSignal")!.value).toMatchObject({ method: "per-site-integrated-electrons", verificationSites: 4 });
    expect(r.diagnostics.providerEvaluationCount).toBeGreaterThan(4 * 20);
    expect(r.diagnostics.providerEvaluationCount).toBeLessThan(36 * 20);
  });

  it("is deterministic and only the explicit options change the result", async () => {
    const a = await simulateCapture({ scene: { preset: "uniform" }, ...small }), b = await simulateCapture({ scene: { preset: "uniform" }, ...small });
    expect(Array.from(a.raw.codes)).toEqual(Array.from(b.raw.codes));
    expect(Array.from(a.image.samples)).toEqual(Array.from(b.image.samples));
    const seeded = await simulateCapture({ scene: { preset: "uniform" }, ...small, sensor: { noiseSeed: 2 } });
    expect(Array.from(seeded.raw.codes)).not.toEqual(Array.from(a.raw.codes));
    expect(seeded.assumptions.map((x) => x.id)).not.toContain("sensor.noiseSeed");
  });

  it("resolves every exposure mode through the exposure-mode resolver to the same metered exposure", async () => {
    const levels: number[] = [];
    for (const options of [{}, { exposure: { mode: "aperture-priority" as const }, lens: { fNumber: 4 }, illuminanceLux: 4000 },
      { exposure: { mode: "shutter-priority" as const, shutterSeconds: 1 / 500 }, illuminanceLux: 40_000 }, { exposure: { mode: "program" as const }, illuminanceLux: 300 }]) {
      const r = await simulateCapture({ scene: { preset: "uniform" }, ...small, ...options });
      levels.push(rawLevel(r, "green"));
      const { fNumber, shutterSeconds } = r.exposure.settings, lux = options.illuminanceLux ?? SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX;
      // CIPA DC-004: 10/S = 0.65·L·t/N², so N²/t = 0.65·L·S/10, with L = 0.18·E/π.
      expect(Math.log2(fNumber ** 2 / shutterSeconds)).toBeCloseTo(Math.log2(0.65 * (0.18 * lux / Math.PI) * 100 / 10), 3);
    }
    for (const level of levels) expect(level / levels[0]!).toBeCloseTo(1, 1);
    await expect(simulateCapture({ scene: { preset: "uniform" }, ...small, exposure: { mode: "program" }, lens: { fNumber: 8 } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ scene: { preset: "uniform" }, ...small, lens: { fNumber: 2 } })).rejects.toThrow();
  });

  it("links ISO to RAW gain: ISO 800 at the same exposure is three stops brighter in RAW", async () => {
    const base = await simulateCapture({ scene: { preset: "uniform" }, ...small, illuminanceLux: 2000 });
    const iso800 = await simulateCapture({ scene: { preset: "uniform" }, ...small, illuminanceLux: 2000, exposure: { iso: 800 } });
    expect(rawLevel(iso800, "green") / rawLevel(base, "green")).toBeCloseTo(8, 0);
  });

  it("applies white balance choices through the engine's WB states", async () => {
    const run = (whiteBalance: NonNullable<NonNullable<Parameters<typeof simulateCapture>[0]["output"]>["whiteBalance"]>): Promise<SimulateCaptureResult> =>
      simulateCapture({ scene: { preset: "uniform" }, illuminant: "cie-a", output: { width: 4, height: 4, whiteBalance } });
    const none = mean(await run("none"));
    expect(none[0]!).toBeGreaterThan(none[1]! + 20);
    expect(none[1]!).toBeGreaterThan(none[2]! + 20);
    for (const wb of ["scene-illuminant", "auto", { kelvin: 2856 }] as const) {
      const r = await run(wb), [red, green, blue] = mean(r);
      expect(Math.abs(red! - green!), JSON.stringify(wb)).toBeLessThan(4);
      expect(Math.abs(blue! - green!), JSON.stringify(wb)).toBeLessThan(4);
      expect(r.request.whiteBalanceState).not.toBeNull();
    }
    const manual = await run({ channelGains: { red: 1, green: 1, blue: 1 } });
    expect(manual.request.whiteBalanceState!.source).toBe("manual-gains");
  });

  it("keeps scene orientation: the top-left of the scene is the top-left of the image", async () => {
    const r = await simulateCapture({ scene: { kind: "reflectance-function", sceneId: "quadrant", evaluate: (p) => (p.u < 0 && p.v > 0 ? 0.9 : 0.05) },
      output: { width: 8, height: 8 } });
    const g = (x: number, y: number): number => r.image.samples[(y * 8 + x) * 3 + 1]!;
    expect(g(1, 1)).toBeGreaterThan(150);
    expect(g(6, 1)).toBeLessThan(80);
    expect(g(1, 6)).toBeLessThan(80);
  });

  it("images the slanted edge at its analytic position", async () => {
    const width = 24, height = 16, r = await simulateCapture({ scene: { preset: "slanted-edge", angleDegrees: 10 }, output: { width, height } });
    const t = Math.tan(10 * Math.PI / 180);
    for (const y of [2, 8, 13]) {
      const v = (height / width) * (1 - 2 * (y + 0.5) / height), expectedX = (v * t + 1) / 2 * width - 0.5;
      // First column whose green clearly exceeds the dark/light midpoint.
      let crossing = -1;
      for (let x = 0; x < width; x++) if (r.image.samples[(y * width + x) * 3 + 1]! > 125 && r.image.samples[(y * width + x + 1) * 3 + 1]! > 125) { crossing = x; break; }
      expect(Math.abs(crossing - expectedX), "row " + y).toBeLessThanOrEqual(1.5);
    }
  });

  it("encodes JPEG and 16-bit sRGB output and renders defocus with pupil sampling", async () => {
    const jpeg = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "jpeg" } });
    expect(Array.from(jpeg.image.jpeg!.subarray(0, 2))).toEqual([0xff, 0xd8]);
    const deep = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "srgb-16" } });
    expect(deep.image.samples).toBeInstanceOf(Uint16Array);
    const contrast = (r: SimulateCaptureResult): number => { const row = Array.from({ length: 16 }, (_, x) => r.image.samples[(16 + x) * 3 + 1]!); return Math.max(...row) - Math.min(...row); };
    const scene = { preset: "checkerboard" as const, squaresAcross: 4 };
    const sharp = await simulateCapture({ scene, output: { width: 16, height: 4 }, lens: { pupilSampling: { radialSamples: 2, angularSamples: 8 } } });
    const blurred = await simulateCapture({ scene, output: { width: 16, height: 4 }, lens: { pupilSampling: { radialSamples: 2, angularSamples: 8 }, focusDistanceM: 2 } });
    expect(contrast(blurred)).toBeLessThan(contrast(sharp) / 2);
    expect(blurred.diagnostics.providerEvaluationCount).toBe(16 * sharp.diagnostics.providerEvaluationCount / 16);
  });

  it("accepts caller radiance functions without using the illuminant", async () => {
    const r = await simulateCapture({ scene: { kind: "radiance-function", sceneId: "flat-emitter", evaluate: () => 0.01 }, ...small });
    expect(r.assumptions.map((a) => a.id)).toContain("scene.digest");
    expect(rawLevel(r, "green")).toBeGreaterThan(0.01);
  });

  it("sees an abort queued as a separate task even when the host has a continuation-priority scheduler.yield", async () => {
    // Engine 2.0.0 yielded through scheduler.yield(), whose continuations run ahead of queued tasks, so a Web Worker's
    // cancel message was not handled until the capture finished. This fake scheduler.yield resolves on microtasks only.
    const g = globalThis as { scheduler?: unknown }, had = "scheduler" in g, previous = g.scheduler;
    g.scheduler = { yield: (): Promise<void> => Promise.resolve() };
    // The environment task's tile loop is under test (#394: the tabulated RAW path has its own abort test).
    setTabulatedNativeRawEnabled(false);
    try {
      const controller = new AbortController();
      let tiles = 0, tilesAtQueue = -1, tilesAtAbort = -1;
      const capture = simulateCapture({ scene: { preset: "uniform" }, output: { width: 16, height: 16 }, signal: controller.signal,
        onProgress: () => {
          // Once the RAW tile loop is running, the cancel arrives as its own macrotask, like a worker message event.
          if (++tiles === 1) { tilesAtQueue = tiles; setTimeout(() => { tilesAtAbort = tiles; controller.abort(); }, 0); }
        } });
      await expect(capture).rejects.toThrow("aborted");
      // The queued cancel task ran at the next host yield (a few tiles at most), and the capture stopped right after it.
      expect(tilesAtAbort).toBeGreaterThanOrEqual(tilesAtQueue);
      expect(tilesAtAbort - tilesAtQueue).toBeLessThanOrEqual(4);
      expect(tiles - tilesAtAbort).toBeLessThanOrEqual(4);
    } finally {
      setTabulatedNativeRawEnabled(true);
      if (had) g.scheduler = previous; else delete g.scheduler;
    }
  });

  it("cancels through AbortSignal and reports progress", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(simulateCapture({ scene: { preset: "uniform" }, ...small, signal: aborted.signal })).rejects.toThrow("aborted");
    const controller = new AbortController(), seen: string[] = [];
    await expect(simulateCapture({ scene: { preset: "uniform" }, output: { width: 16, height: 16 }, signal: controller.signal,
      onProgress: (p) => { seen.push(p.stage); if (p.completedTileCount === 2) controller.abort(); } })).rejects.toThrow("aborted");
    expect(seen).toContain("raw");
    const stages = new Set<string>();
    await simulateCapture({ scene: { preset: "uniform" }, ...small, output: { width: 4, height: 4, format: "jpeg", whiteBalance: "auto" }, onProgress: (p) => { stages.add(p.stage); } });
    expect([...stages]).toEqual(["raw", "white-balance", "development", "jpeg"]);
  });

  it("accepts a full camera record, exposure compensation, tone parameters and caller illuminants", async () => {
    const preset = resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" }).find((p) => p.tier === "consumer")!;
    const flat = (value: number): { wavelengthNanometers: number; value: number }[] => [380, 580, 780].map((w) => ({ wavelengthNanometers: w, value }));
    const r = await simulateCapture({ camera: preset, scene: { preset: "uniform" }, ...small, exposure: { mode: "aperture-priority", compensationStops: 1 },
      illuminant: { kind: "daylight", correlatedColorTemperatureKelvin: 6500, basis: { s0: flat(100), s1: flat(0), s2: flat(0), datasetId: "test-flat-basis" } },
      output: { width: 4, height: 4, toneCurve: "extended-reinhard-luminance", toneCurveParameters: { whiteLuminance: 4 }, highlightMode: "reconstruct" } });
    expect(r.provenance.cameraPresetId).toBe("photivra-consumer");
    expect(r.scene.illuminant.id).toBe("cie-daylight-6500K");
    // +1 stop of compensation doubles the aperture-priority shutter.
    const base = await simulateCapture({ camera: preset, scene: { preset: "uniform" }, ...small, exposure: { mode: "aperture-priority" } });
    expect(r.exposure.settings.shutterSeconds / base.exposure.settings.shutterSeconds).toBeCloseTo(2, 4); // illuminants differ; metering quadrature agrees to ~1e-6
    const spectrum = await simulateCapture({ scene: { preset: "uniform" }, ...small, illuminant: { kind: "spectrum", spectrum: { kind: "tabulated", samples: flat(1) }, label: "equal energy" } });
    expect(spectrum.scene.illuminant.description).toContain("equal energy");
    await expect(simulateCapture({ scene: { preset: "uniform" }, ...small, output: { toneCurve: "naka-rushton-luminance" } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ scene: { preset: "uniform" }, ...small, lens: { pupilSampling: { radialSamples: 0, angularSamples: 8 } } })).rejects.toThrow(InvalidConfigurationError);
  });

  it("rejects malformed input with domain errors", async () => {
    for (const bad of [undefined, null, {}, { scene: { preset: "uniform" }, colour: 1 }, { scene: { preset: "uniform" }, output: { format: "tiff" } },
      { scene: { preset: "uniform" }, output: { width: 0 } }, { scene: { preset: "uniform" }, camera: "flagship" }, { scene: { preset: "uniform" }, exposure: { mode: "bulb" } },
      { scene: { preset: "uniform" }, lens: { focalLengthMm: 35 } }, { scene: { preset: "uniform" }, output: { whiteBalance: "daylight" } },
      { scene: { kind: "radiance-function", sceneId: "x" } }, { scene: { preset: "uniform" }, subjectDistanceM: 0.05 }])
      await expect(simulateCapture(bad as never), JSON.stringify(bad)).rejects.toSatisfy((e: unknown) => e instanceof Error && e.constructor.name.startsWith("Invalid"));
  });
});

describe("simulateCapture pre-release fixes (2.0.0)", { timeout: 120_000 }, () => {
  const tabulated = (values: readonly [number, number][]): { kind: "tabulated"; samples: { wavelengthNanometers: number; value: number }[] } =>
    ({ kind: "tabulated", samples: values.map(([wavelengthNanometers, value]) => ({ wavelengthNanometers, value })) });
  const digestOf = async (options: Record<string, unknown>): Promise<string> =>
    (await simulateCapture({ ...options, output: { width: 2, height: 2, whiteBalance: "none" } } as never)).scene.sourceSha256;

  it("the scene digest covers caller illuminant and reflectance spectra and the daylight basis identity", async () => {
    const warm = tabulated([[380, 0.2], [580, 1], [780, 1.8]]), cool = tabulated([[380, 1.8], [580, 1], [780, 0.2]]);
    const uniform = { scene: { preset: "uniform" } };
    const warmDigest = await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: warm } });
    expect(await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: cool } })).not.toBe(warmDigest);
    expect(await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: structuredClone(warm) } })).toBe(warmDigest);
    // Function spectra are sampled at the facade's 1 nm nodes.
    const fn = (slope: number): Record<string, unknown> => ({ kind: "function", wavelengthRangeNanometers: { minimum: 380, maximum: 780 }, evaluate: (nm: number): number => 1 + slope * (nm - 580) });
    const fnDigest = await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: fn(0.001) } });
    expect(await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: fn(-0.001) } })).not.toBe(fnDigest);
    expect(await digestOf({ ...uniform, illuminant: { kind: "spectrum", spectrum: fn(0.001) } })).toBe(fnDigest);
    // Chart reflectance spectra (uniform and patches).
    const grey = tabulated([[380, 0.2], [780, 0.2]]), red = tabulated([[380, 0.05], [600, 0.1], [780, 0.6]]);
    const greyDigest = await digestOf({ scene: { preset: "uniform", reflectance: grey } });
    expect(await digestOf({ scene: { preset: "uniform", reflectance: red } })).not.toBe(greyDigest);
    expect(await digestOf({ scene: { preset: "uniform", reflectance: structuredClone(grey) } })).toBe(greyDigest);
    const patches = (spectrum: unknown): Record<string, unknown> => ({ scene: { preset: "patches", patches: [{ patchId: "a", reflectance: 0.5 }, { patchId: "b", reflectance: spectrum }] } });
    expect(await digestOf(patches(red))).not.toBe(await digestOf(patches(grey)));
    // Daylight: same CCT, different basis values or a different basis dataset identity.
    const basis = (s1: number, datasetId: string): Record<string, unknown> => ({ datasetId, s0: tabulated([[380, 100], [780, 100]]).samples,
      s1: tabulated([[380, s1], [780, -s1]]).samples, s2: tabulated([[380, 0], [780, 0]]).samples });
    const daylight = (b: unknown): Record<string, unknown> => ({ ...uniform, illuminant: { kind: "daylight", correlatedColorTemperatureKelvin: 6500, basis: b } });
    const d0 = await digestOf(daylight(basis(0, "basis-a")));
    expect(await digestOf(daylight(basis(10, "basis-a")))).not.toBe(d0);
    expect(await digestOf(daylight(basis(0, "basis-b")))).not.toBe(d0);
    expect(await digestOf(daylight(basis(0, "basis-a")))).toBe(d0);
  });

  it("JPEG progress ends with completedTileCount === totalTileCount (one event per 256 × 32 source read)", async () => {
    for (const [width, height] of [[64, 64], [300, 70], [8, 8]] as const) {
      const events: { completedTileCount: number; totalTileCount: number }[] = [];
      await simulateCapture({ scene: { preset: "uniform" }, output: { width, height, format: "jpeg" },
        onProgress: (p) => { if (p.stage === "jpeg") events.push({ completedTileCount: p.completedTileCount, totalTileCount: p.totalTileCount }); } });
      const total = Math.ceil(height / 32) * Math.ceil(width / 256);
      expect(events.length, `${width}x${height}`).toBe(total);
      expect(events.at(-1), `${width}x${height}`).toEqual({ completedTileCount: total, totalTileCount: total });
    }
  });

  it("a caller copy of a catalog preset gives the same capture as the tier id", async () => {
    const preset = resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" }).find((p) => p.tier === "prosumer")!;
    const byId = await simulateCapture({ camera: "prosumer", scene: { preset: "uniform" }, ...small });
    const byRecord = await simulateCapture({ camera: structuredClone(preset), scene: { preset: "uniform" }, ...small });
    expect(byRecord.image.samples).toEqual(byId.image.samples);
    expect(byRecord.raw.codes).toEqual(byId.raw.codes);
  });
});
