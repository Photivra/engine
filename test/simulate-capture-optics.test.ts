// SPDX-License-Identifier: Apache-2.0

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ENGINE_API_VERSION, InvalidConfigurationError, calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, simulateCapture,
  type SimulateCaptureOptions } from "../src/index.js";
import { createDiffractedPlanarProvider } from "../src/facade/diffraction-provider.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";

const scene = { preset: "slanted-edge" } as const;

describe("simulateCapture lens.diffraction (2.1)", () => {
  it("builds Airy kernels at the resolved f-number and passes them as a sampled environment PSF", async () => {
    const r = await simulateCapture({ scene, output: { width: 6, height: 6 }, lens: { fNumber: 4, diffraction: "circular-aperture" } });
    const record = r.assumptions.find((a) => a.id === "lens.diffraction")!;
    expect(record.kind).toBe("model");
    const value = record.value as { fNumber: number; kernelRadiusSamples: number; workingFNumber: number; truncatedEnergyByWavelength: { wavelengthNm: number }[] };
    expect(value.fNumber).toBe(4);
    expect(value.workingFNumber).toBeCloseTo(4 * 5000 / 4950, 12);
    // Third dark ring at 770 nm: 3.2383 × 0.77 µm × 4.04 / 6 µm = 1.68 → 2 sites.
    expect(value.kernelRadiusSamples).toBe(2);
    expect(value.truncatedEnergyByWavelength.map((w) => w.wavelengthNm)).toEqual(Array.from({ length: 20 }, (_, k) => 390 + 20 * k));
    expect(r.assumptions.some((a) => a.id === "lens.psf")).toBe(false);
    expect(r.provenance.composedContracts).toContain("createDiffractionLimitedPsfProfile");
    const explicit = await simulateCapture({ scene, output: { width: 6, height: 6 }, lens: { fNumber: 4, diffraction: { aperture: "circular-aperture", kernelRadiusSamples: 1 } } });
    expect((explicit.assumptions.find((a) => a.id === "lens.diffraction")!.value as { kernelRadiusSamples: number }).kernelRadiusSamples).toBe(1);
  });

  it("rejects malformed or double-counting combinations", async () => {
    const psf = { kind: "sampled-local", configuration: {} } as never;
    for (const lens of [{ diffraction: "hexagonal" }, { diffraction: { aperture: "circular-aperture", kernelRadiusSamples: 33 } },
      { diffraction: { aperture: "circular-aperture", extra: 1 } }, { diffraction: "circular-aperture", psf },
      { diffraction: "circular-aperture", pupilSampling: { radialSamples: 1, angularSamples: 4 } }]) {
      await expect(simulateCapture({ scene, output: { width: 4, height: 4 }, lens: lens as never })).rejects.toThrow(InvalidConfigurationError);
    }
  });
});

/*
 * Hash lock: the 2.1 optics and demosaic options are opt-in, so captures that do not use them are byte-identical
 * to 2.0.0. Digests of the RAW codes and every output byte, and of the assumptions, composed contracts and
 * diagnostics (timings zeroed), recorded from the 2.0.0 source (commit 0e4c63e). Since #394 these chart captures take the
 * tabulated RAW path: the byte digests are still 2.0.0's; the second digests were re-recorded for its `raw.expectedSignal`
 * assumption and its `providerEvaluationCount` (verification calls plus scene lookups). 2.22.0: the second digests were re-recorded
 * for the `raw.expectedSignal` method's new name (`per-site-integrated-electrons`) and explanation only; the byte digests are unchanged.
 */
describe("simulateCapture without the 2.1 options is byte-identical to 2.0.0", () => {
  // The DNG Software tag names the engine version ("Photivra <version>"). A version of another length (2.10.0 against
  // 2.0.0) moves every later DNG offset, so writing the 2.0.0 name back into the bytes cannot work. These captures run on
  // a separate copy of the engine whose only change is ENGINE_API_VERSION = "2.0.0"; every other byte stays locked.
  let lockedEngine: { simulateCapture: typeof simulateCapture; ENGINE_API_VERSION: string };
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("../src/core/version.js", () => ({ ENGINE_API_VERSION: "2.0.0" }));
    lockedEngine = await import("../src/index.js");
  });
  afterAll(() => { vi.doUnmock("../src/core/version.js"); vi.resetModules(); });
  it("the real engine's DNG Software tag names the current engine version", async () => {
    const dng = (await simulateCapture({ scene: { preset: "point-grid" }, output: { width: 12, height: 12, format: "dng" }, exposure: { mode: "program" } })).image.dng!;
    expect(Buffer.from(dng).includes(Buffer.from("Photivra " + ENGINE_API_VERSION + "\0"))).toBe(true);
  });
  // 2.20.0: the JPEG default step is 1; the 2.0.0 bytes are kept with the old step 2 given explicitly (its assumption list, and so its
  // metadata digest, then lacks the default-step entry).
  const cases: Record<string, [SimulateCaptureOptions, string, string]> = {
    edge: [{ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 } },
      "0cce9455f8a541eed2ebe6f652556d7ea0d10601f2a35f8529768311e8ec0acf", "091640a48006caac93cbd56114f45631ba14c9fb0670fe1f99b1c0ab7ae87784"],
    star: [{ scene: { preset: "siemens-star" }, output: { width: 20, height: 20, format: "png" }, lens: { fNumber: 4 } },
      "775575f46b684c0eb44196270893632995c8ae7ca9400e878efcf2e29c9a7f1b", "5689e2574124165e5ef30a5e5e0d6c4f22899b1c805b0155777597c71090517c"],
    jpeg: [{ scene: { preset: "checkerboard" }, output: { width: 16, height: 16, format: "jpeg", whiteBalance: "auto", jpegQuantizationStep: 2 } },
      "afeb03932b61751778c2ac285ce8245cd6feec4d0c18ffe7732f0a2d0588b70c", "0bf8d20f3b6872a05a8c8e0eab41d44f4de8c4ea873e2a94e9917062c563d095"],
    mirror: [{ scene: { preset: "grey-ramp" }, output: { width: 16, height: 12, demosaic: "bilinear", borderHandling: "mirror", format: "srgb-16" } },
      "f8f7c5dc63ba0ad1ee0390d03ac08f3ee202bf57a560f9a834942303e3924c39", "f921aaad24c40ec5060982e2ed783e4d40d44495a94cd3b9a065dd7fe131cafa"],
    p3: [{ scene: { preset: "step-wedge" }, output: { width: 16, height: 8, format: "png", colorEncoding: "display-p3" } },
      "ffd78b35089083915e69cccbf16476a79690ce31095c1e428d6edc8672ecca0c", "33c16609602743dd796abc08270090f69ddfecb20bbb9413fa85483cd5a1d98a"],
    dng: [{ scene: { preset: "point-grid" }, output: { width: 12, height: 12, format: "dng" }, exposure: { mode: "program" } },
      "faaf9e2bf9ae86261adb153f4aea04a29476b4e38c3e3acc616d4aee3fe3a106", "28c18a4c36cb3958cdfa6afd29e4b43d6ef914cbc69ca0d229389391a1127bc4"]
  };
  const expectedOptions: Record<string, readonly string[]> = { edge: [], star: ["output.format.png"], jpeg: ["output.whiteBalance.auto", "output.format.jpeg"],
    mirror: ["output.borderHandling.mirror"], p3: ["output.colorEncoding.wide-gamut", "output.format.png"], dng: ["output.format.dng"] };
  const hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
  for (const [name, [options, bytes, meta]] of Object.entries(cases)) {
    it(name, async () => {
      expect(lockedEngine.ENGINE_API_VERSION).toBe("2.0.0");
      const r = await lockedEngine.simulateCapture(options);
      const parts = [r.raw.codes, r.image.samples, r.image.jpeg, r.image.png, r.image.dng].filter((a) => a !== undefined)
        .map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      expect(hex(Buffer.concat(parts))).toBe(bytes);
      // diagnostics.options (2.1) and diagnostics.fast (#395), both additive, are checked below and left out of the 2.0.0 digest, like the timings.
      expect(hex(JSON.stringify({ a: r.assumptions, c: r.provenance.composedContracts, d: { ...r.diagnostics, timingsMs: 0, options: undefined, fast: undefined } }))).toBe(meta);
      expect(r.diagnostics.options).toEqual(expectedOptions[name]);
      // 2.20.0: fast follows the format (fast for sRGB; no option here has a fast method, so the bytes are the same).
      expect(r.diagnostics.fast.defaultedFrom).toBe("format");
      expect(r.diagnostics.fast.assurance).toBe("engine-reference");
    });
  }
});

describe("lens.diffraction object-space convolution equals the per-tap environment PSF quadrature", () => {
  // The environment path itself is under test (#394: chart captures otherwise take the tabulated RAW path).
  beforeAll(() => setTabulatedNativeRawEnabled(false));
  afterAll(() => setTabulatedNativeRawEnabled(true));
  /*
   * Presets whose material boundaries do not pass exactly through the site lattice. Where a boundary does (the
   * checkerboard's u = ±0.5 column at this frame size, the Siemens star's diagonals, the grey-ramp steps), a tap
   * that sits exactly on the boundary picks its material by the last bit of its coordinate, which the two paths
   * compute in different orders: point-sampling ambiguity of the scene, not a difference of the optics.
   */
  const options = (preset: "slanted-edge" | "point-grid" | "step-wedge"): SimulateCaptureOptions => ({ scene: { preset }, output: { width: 10, height: 8 },
    lens: { fNumber: 16, diffraction: "circular-aperture" }, sensor: { spectralStepNanometers: 80 } });

  it("gives the same expected electrons at every site (relative 1e-12; only the summation order differs)", async () => {
    for (const preset of ["slanted-edge", "point-grid"] as const) {
      const r = await simulateCapture(options(preset)), d = r.request.diffraction!;
      expect(d.execution).toBe("object-space-convolution");
      const native = r.raw.plan.exposure.geometry.nativeRaster, sharp = createPlanarSceneRadianceProvider({ scene: { preset }, illuminant: { kind: "planckian", temperatureKelvin: 6500 },
        illuminanceLux: r.scene.illuminant.illuminanceLux, distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: 0.8,
        sceneId: "facade-scene", providerProfileId: "facade-provider" });
      const diffracted = createDiffractedPlanarProvider({ base: sharp, psf: d.psf.configuration.psf, wavelengthsNm: d.profile.profile.axes.wavelengthNm,
        kernelRadius: d.profile.kernelRadiusSamples, nativeWidth: native.pixelWidth, nativeHeight: native.pixelHeight, outputWidth: 10, sitePitchMicrometers: 6,
        distanceM: r.scene.distanceM, metresPerFrameUnit: r.scene.framedWidthM / 2 });
      const electrons = (environment: unknown, evaluate: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance: evaluate } as never)
        .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i++) {
        const environment = r.request.siteInput(i).environment as unknown as Record<string, unknown>;
        expect((environment.psf as { kind: string }).kind).toBe("not-applied");
        const method = electrons(environment, diffracted.evaluateRadiance.bind(diffracted));
        const reference = electrons({ ...environment, psf: d.psf }, sharp.evaluateRadiance.bind(sharp));
        largest = Math.max(largest, Math.abs(method - reference) / reference);
      }
      expect(largest).toBeLessThan(1e-12);
    }
  }, scaledTimeout(60_000));

  it("gives the same RAW codes as the facade's per-tap path with the same profile", async () => {
    for (const preset of ["slanted-edge", "point-grid"] as const) {
      const fast = await simulateCapture(options(preset));
      const perTap = await simulateCapture({ ...options(preset), lens: { fNumber: 16, psf: fast.request.diffraction!.psf } });
      expect(Array.from(perTap.raw.codes)).toEqual(Array.from(fast.raw.codes));
      expect(fast.diagnostics.providerEvaluationCount * 225).toBe(perTap.diagnostics.providerEvaluationCount);
    }
  }, scaledTimeout(60_000));

  it("falls back to the per-tap quadrature when the taps leave the site lattice (camera rotation)", async () => {
    const r = await simulateCapture({ ...options("slanted-edge"), output: { width: 4, height: 4 }, lens: { fNumber: 4, diffraction: "circular-aperture" },
      motion: { angularVelocityRadPerSec: { yaw: 0.01 } }, sensor: { spectralStepNanometers: 40, temporalSampleCount: 2 } });
    expect(r.request.diffraction!.execution).toBe("environment-psf-quadrature");
    expect((r.request.siteInput(0).environment as unknown as { psf: { kind: string } }).psf.kind).toBe("sampled-local");
  }, scaledTimeout(30_000));
});

describe("simulateCapture output.demosaic \"ahd\" (2.1)", () => {
  /** Mean false colour of a neutral chart: |R − G| + |B − G| per pixel, in 8-bit codes. */
  const falseColour = (samples: ArrayLike<number>): number => {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 3) sum += Math.abs(samples[i]! - samples[i + 1]!) + Math.abs(samples[i + 2]! - samples[i + 1]!);
    return sum / (samples.length / 3);
  };

  it("reduces false colour on sharp neutral edges and keeps flat fields", async () => {
    for (const preset of ["siemens-star", "slanted-edge"] as const) {
      const options: SimulateCaptureOptions = { scene: { preset }, output: { width: 32, height: 32 } };
      const bilinear = await simulateCapture(options), ahd = await simulateCapture({ ...options, output: { ...options.output, demosaic: "ahd" } });
      expect(falseColour(ahd.image.samples)).toBeLessThan(0.75 * falseColour(bilinear.image.samples));
      expect(ahd.provenance.composedContracts).toContain("createAhdDemosaicTask");
      expect(ahd.raw.plan.exposure.geometry.nativeRaster.pixelWidth).toBe(42);
    }
    const flat: SimulateCaptureOptions = { scene: { preset: "uniform" }, output: { width: 12, height: 12 } };
    const a = await simulateCapture({ ...flat, output: { ...flat.output, demosaic: "ahd" } }), b = await simulateCapture({ ...flat, output: { ...flat.output, demosaic: "bilinear" } });
    const mean = (s: ArrayLike<number>, c: number): number => { let t = 0; for (let i = c; i < s.length; i += 3) t += s[i]!; return t / (s.length / 3); };
    for (const c of [0, 1, 2]) expect(Math.abs(mean(a.image.samples, c) - mean(b.image.samples, c))).toBeLessThan(1.5);
  });

  it("works with mirror borders, wide-gamut PNG, JPEG and highlight diagnostics", async () => {
    const mirror = await simulateCapture({ scene: { preset: "checkerboard" }, output: { width: 8, height: 8, demosaic: "ahd", borderHandling: "mirror" } });
    expect(mirror.raw.plan.exposure.geometry.nativeRaster.pixelWidth).toBe(8);
    const wide = await simulateCapture({ scene: { preset: "checkerboard" }, output: { width: 8, height: 8, demosaic: "ahd", format: "png", colorEncoding: "display-p3",
      gamutMapping: "perceptual" } });
    expect(wide.diagnostics.gamutMapping).toBeDefined();
    expect(wide.image.png!.length).toBeGreaterThan(0);
    const jpeg = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 16, height: 16, demosaic: "ahd", format: "jpeg" } });
    expect(jpeg.image.jpeg!.length).toBeGreaterThan(0);
    const bright = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 12, height: 12, demosaic: "ahd" }, exposure: { shutterSeconds: 1 / 15 } });
    expect(bright.diagnostics.highlight.saturatedPixelCount).toBeGreaterThan(0);
    await expect(simulateCapture({ scene: { preset: "uniform" }, output: { width: 2, height: 2, demosaic: "ahd", borderHandling: "mirror" } })).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, demosaic: "lmmse" as never } })).rejects.toThrow(InvalidConfigurationError);
  });
});

describe("simulateCapture per-run cost diagnostics (2.1)", () => {
  it("lists the opt-ins that ran and times their stages, without changing any output", async () => {
    const plain = await simulateCapture({ scene, output: { width: 8, height: 8 } });
    expect(plain.diagnostics.options).toEqual([]);
    expect(Object.keys(plain.diagnostics.timingsMs).sort()).toEqual(["development", "jpeg", "raw", "total", "whiteBalance"]);
    const options: SimulateCaptureOptions = { scene, output: { width: 8, height: 8, demosaic: "ahd", format: "png" }, lens: { diffraction: "circular-aperture" },
      sensor: { antiAliasing: { kind: "four-spot" } } };
    const a = await simulateCapture(options), b = await simulateCapture(options);
    expect(a.diagnostics.options).toEqual(["lens.diffraction", "sensor.antiAliasing", "output.demosaic.ahd", "output.format.png"]);
    for (const key of ["diffraction", "demosaic", "encode"] as const) {
      expect(a.diagnostics.timingsMs[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(a.diagnostics.timingsMs[key])).toBe(true);
    }
    // Two runs differ only in their timings: every byte, digest, request and other diagnostic is the same.
    expect(Buffer.from(a.image.png!).equals(Buffer.from(b.image.png!))).toBe(true);
    expect(Array.from(a.raw.codes)).toEqual(Array.from(b.raw.codes));
    expect(a.scene.sourceSha256).toBe(b.scene.sourceSha256);
    const strip = (r: typeof a): string => JSON.stringify({ ...r, image: undefined, raw: undefined, diagnostics: { ...r.diagnostics, timingsMs: undefined } });
    expect(strip(a)).toBe(strip(b));
    const jpeg = await simulateCapture({ scene, output: { width: 8, height: 8, format: "jpeg" } });
    expect(jpeg.diagnostics.timingsMs.encode).toBeGreaterThanOrEqual(0);
    const moving = await simulateCapture({ scene, output: { width: 4, height: 4, highlightMode: "reconstruct", whiteBalance: "auto" }, motion: { angularVelocityRadPerSec: { yaw: 0.01 }, shutter: "rolling" } });
    expect(moving.diagnostics.options).toEqual(["sensor.temporalSampleCount", "motion.rotation", "motion.shutter.rolling", "output.whiteBalance.auto", "output.highlightMode.reconstruct"]);
  });
});
