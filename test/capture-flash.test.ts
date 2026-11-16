// SPDX-License-Identifier: Apache-2.0
/**
 * #639 (2.26.0): `illumination.flash`, an impulse light whose energy does not depend on the shutter time. Checked against
 * hand-computed exposures: the guide number is distance × f-number at ISO 100, twice the distance gives a quarter of the exposure,
 * with the flash alone the shutter time does not change the exposure, and ambient light and flash add. The automatic modes meter
 * the flash, and the display view and the GPU light table take the same light as the capture.
 */
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, InvalidScientificInputError, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, calculateEnvironmentSensorPhotoSignal, simulateCapture,
  simulateDisplayView, simulateIdealReference, type CalculateEnvironmentSensorPhotoSignalInput, type MixedIllumination, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { flashAloneShutter, resolveMixedIllumination } from "../src/facade/mixed-illumination.js";
import { buildPlanarSceneRadianceProvider, resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { resolveChartScene, type ChartScene } from "../src/facade/chart-scenes.js";
import { imagePlaneLightTable } from "../src/gpu/display-view-image-quality.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

const DAY = { kind: "planckian" as const, temperatureKelvin: 6500 };
/** An 18 % grey card filling the frame at 2 m, manual f/8 ISO 100, a fixed white balance and 16-bit output. */
const CARD: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.18 }, subjectDistanceM: 2, lens: { fNumber: 8 },
  exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 }, output: { width: 16, height: 16, format: "srgb-16", whiteBalance: { kelvin: 6500 } } };
/** Hand-computed: Q = 10π·G²/(0.65·0.18·100) cd·s for a guide number G at ISO 100 (CIPA DC-004 H = 10/S, H = 0.65·L·t/N², 18 % card). */
const candelaSeconds = (guideNumberM: number): number => 10 * Math.PI * guideNumberM ** 2 / (0.65 * 0.18 * 100);
const decode = (code: number): number => { const e = code / 65535; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
/** Linear green of the pixel nearest the frame center (the flash sits on the axis). */
const centerGreen = (samples: ArrayLike<number>): number => decode(samples[(8 * 16 + 8) * 3 + 1]!);
const flashCard = (flash: NonNullable<MixedIllumination["flash"]>, extra: Partial<SimulateCaptureOptions> = {}): SimulateCaptureOptions =>
  ({ ...CARD, ...extra, illumination: { flash: { illuminant: DAY, ...flash }, ...extra.illumination } });
const deviation = async (options: SimulateCaptureOptions): Promise<number> => (await simulateCapture(options)).exposure.greyCardDeviationStops!;

describe("flash (#639)", () => {
  it("validates the option and refuses what it cannot model", async () => {
    const cases: [MixedIllumination["flash"], RegExp][] = [
      [{ output: { guideNumberM: 16, candelaSeconds: 10 } } as never, /takes guideNumberM, candelaSeconds, or luxSeconds and distanceM/],
      [{ output: { luxSeconds: 10 } } as never, /takes guideNumberM/],
      [{ output: { guideNumberM: -1 } }, /guideNumberM must be positive/],
      [{ output: { guideNumberM: 16 }, powerFraction: 1.5 }, /powerFraction must be positive, up to 1/],
      [{ output: { guideNumberM: 16 }, position: { xM: 0, yM: 0, heightM: 0 } }, /flash.position.heightM must be positive/],
      [{ output: { guideNumberM: 16 }, zoom: 24 } as never, /Unknown illumination.flash field: zoom/]
    ];
    for (const [flash, message] of cases) {
      const attempt = simulateCapture({ ...CARD, illumination: { flash: flash! } });
      await expect(attempt).rejects.toThrow(InvalidConfigurationError);
      await expect(simulateCapture({ ...CARD, illumination: { flash: flash! } })).rejects.toThrow(message);
    }
    // The pulse freezes motion at one instant: camera rotation, a moving subject and (#641) hand shake are refused, in the capture and the view.
    for (const motion of [{ angularVelocityRadPerSec: { yaw: 0.1 } }, { subject: { velocityMPerSec: { x: 0.1 } } }, { handheld: { seed: 1 } },
      { handheld: { stabilizationStops: 5 }, shutter: "rolling" as const, rollingShutterSkewSeconds: 1 / 120 }]) {
      await expect(simulateCapture(flashCard({ output: { guideNumberM: 16 } }, { motion }))).rejects.toThrow(/does not support motion/);
      await expect(simulateDisplayView(flashCard({ output: { guideNumberM: 16 } }, { motion }), { width: 4, height: 4 })).rejects.toThrow(/does not support motion/);
    }
    // A rolling shutter must be open on every row at once: refused below the readout skew, accepted above it.
    const rolling = flashCard({ output: { guideNumberM: 16 } }, { motion: { shutter: "rolling", rollingShutterSkewSeconds: 1 / 60 } });
    await expect(simulateCapture(rolling)).rejects.toThrow(InvalidScientificInputError);
    await expect(simulateCapture({ ...rolling, exposure: { ...CARD.exposure, shutterSeconds: 1 / 30 } })).resolves.toBeDefined();
  }, testTimeout(60_000));

  it("the guide number is distance × f-number at ISO 100", async () => {
    // G = 16 m at 2 m and f/8: the grey card gets the standard exposure (deviation 0), at any shutter.
    for (const shutterSeconds of [1 / 250, 1 / 60, 1]) {
      expect(Math.abs(await deviation(flashCard({ output: { guideNumberM: 16 } }, { exposure: { ...CARD.exposure, shutterSeconds } })))).toBeLessThan(1e-12);
    }
    // f/5.6 lets in (8/5.6)² as much: the deviation is log2(5.6²/8²) (negative is brighter).
    expect(await deviation(flashCard({ output: { guideNumberM: 16 } }, { lens: { fNumber: 5.6 } }))).toBeCloseTo(Math.log2(5.6 ** 2 / 64), 12);
    // The guide number grows with √(ISO/100) and √p: G·√4 = 32 at ISO 400 reaches 4 m at f/8, and G·√(1/4) = 8 at quarter power 1 m.
    expect(Math.abs(await deviation(flashCard({ output: { guideNumberM: 16 } }, { subjectDistanceM: 4, exposure: { ...CARD.exposure, iso: 400 } })))).toBeLessThan(1e-12);
    expect(Math.abs(await deviation(flashCard({ output: { guideNumberM: 16 }, powerFraction: 0.25 }, { subjectDistanceM: 1 })))).toBeLessThan(1e-12);
    // The three forms of the output are one light: Q cd·s, and Q/r² lx·s at r.
    const q = candelaSeconds(16), forms = [{ guideNumberM: 16 }, { candelaSeconds: q }, { luxSeconds: q / 9, distanceM: 3 }].map((output) =>
      resolveMixedIllumination({ flash: { output } }, resolveCaptureIlluminant, 1 / 125, 2));
    for (const form of forms) expect(form.irradianceAt(0, 0, 0.1, -0.2, 555) / forms[0]!.irradianceAt(0, 0, 0.1, -0.2, 555)).toBeCloseTo(1, 14);
    expect(forms[0]!.sources[0]!.report).toMatchObject({ intensityCandela: q * 125, flash: { candelaSeconds: q, powerFraction: 1, guideNumberM: 16, exposureWindowSeconds: 1 / 125 } });
    // The image: the flash at G = d·N renders the card as the standard ambient exposure does (the same spectrum and settings).
    const [flash, ambient] = await Promise.all([simulateIdealReference(flashCard({ output: { guideNumberM: 16 } })),
      simulateIdealReference({ ...CARD, illuminant: DAY, illuminanceLux: SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX })]);
    expect(centerGreen(flash.image.samples) / centerGreen(ambient.image.samples)).toBeCloseTo(1, 3);
  }, testTimeout(60_000));

  it("twice the distance gives a quarter of the exposure", async () => {
    const near = flashCard({ output: { guideNumberM: 16 } }), far = { ...near, subjectDistanceM: 4 };
    // The deviation grows by exactly log2(4) = 2 stops (darker).
    expect(await deviation(far) - await deviation(near)).toBeCloseTo(2, 12);
    // The image: the flash moved from the camera (2 m) to 4 m behind the same card, so the optics stay the same (moving the card
    // would also change the lens's magnification and so its working f-number); the center pixel gets exactly a quarter.
    const behind = flashCard({ output: { guideNumberM: 16 }, position: { xM: 0, yM: 0, heightM: 4 } });
    const [a, b] = await Promise.all([simulateIdealReference(near), simulateIdealReference(behind)]);
    expect(centerGreen(b.image.samples) / centerGreen(a.image.samples)).toBeCloseTo(0.25, 3);
    // The light itself: E = Q·cos θ/(d²·t), so on the axis at 4 m a quarter of that at 2 m.
    const at = (heightM: number): number => resolveMixedIllumination({ flash: { output: { guideNumberM: 16 }, position: { xM: 0, yM: 0, heightM } } },
      resolveCaptureIlluminant, 1 / 125).irradianceAt(0, 0, 0, 0, 550);
    expect(at(4) / at(2)).toBeCloseTo(0.25, 15);
  }, testTimeout(60_000));

  it("with the flash alone the shutter time does not change the exposure", async () => {
    const shutters = [1 / 1000, 1 / 125, 1 / 15, 2], images = await Promise.all(shutters.map((shutterSeconds) =>
      simulateIdealReference(flashCard({ output: { guideNumberM: 11 } }, { exposure: { ...CARD.exposure, shutterSeconds } }))));
    for (const image of images) for (let i = 0; i < image.image.samples.length; i++) expect(Math.abs(image.image.samples[i]! - images[0]!.image.samples[i]!)).toBeLessThanOrEqual(1);
    // The capture too: the same expected electrons, so the same seeded noise draws (but for rounding ties).
    const raws = await Promise.all([1 / 1000, 1 / 15].map((shutterSeconds) => simulateCapture(flashCard({ output: { guideNumberM: 11 } },
      { exposure: { ...CARD.exposure, shutterSeconds }, output: { ...CARD.output, format: "dng" } }))));
    let differing = 0;
    for (let i = 0; i < raws[0]!.raw.codes.length; i++) if (raws[0]!.raw.codes[i] !== raws[1]!.raw.codes[i]) differing++;
    expect(differing).toBeLessThanOrEqual(0.01 * raws[0]!.raw.codes.length);
    // And the deviation: log2((16/11)²) at every shutter.
    for (const shutterSeconds of shutters) expect(await deviation(flashCard({ output: { guideNumberM: 11 } }, { exposure: { ...CARD.exposure, shutterSeconds } })))
      .toBeCloseTo(Math.log2(256 / 121), 12);
  }, testTimeout(90_000));

  it("ambient light and flash add, and a longer shutter (slow sync) adds only ambient light", async () => {
    const half = SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX / 2, ambient: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: half }] };
    // Half the standard exposure from each at 1/125 s: G = 16/√2 gives Q/(d²N²) half of what G = 16 gives.
    const mixed = flashCard({ output: { guideNumberM: 16 / Math.SQRT2 } }, { illumination: ambient });
    expect(Math.abs(await deviation(mixed))).toBeLessThan(1e-12);
    // Four times the shutter: the ambient part 4 × 1/2, the flash part 1/2, 2.5 × the standard exposure.
    const slow = { ...mixed, exposure: { ...CARD.exposure, shutterSeconds: 4 / 125 } };
    expect(await deviation(slow)).toBeCloseTo(-Math.log2(2.5), 12);
    const [both, slowBoth, flashOnly, ambientOnly] = await Promise.all([simulateIdealReference(mixed), simulateIdealReference(slow),
      simulateIdealReference(flashCard({ output: { guideNumberM: 16 / Math.SQRT2 } })), simulateIdealReference({ ...CARD, illuminant: DAY, illuminanceLux: half })]);
    expect(centerGreen(both.image.samples) / (centerGreen(flashOnly.image.samples) + centerGreen(ambientOnly.image.samples))).toBeCloseTo(1, 3);
    expect(centerGreen(slowBoth.image.samples) / centerGreen(both.image.samples)).toBeCloseTo(2.5, 2);
    // The report: the flash's intensity over the window and the frame center's illuminance, ambient + Q/(d²·t).
    const capture = await simulateCapture(slow), lit = capture.assumptions.find((a) => a.id === "scene.illumination")!.value as { center: { illuminanceLux: number } };
    expect(lit.center.illuminanceLux / (half + candelaSeconds(16 / Math.SQRT2) / 4 / (4 / 125))).toBeCloseTo(1, 12);
  }, testTimeout(60_000));

  it("the automatic modes meter the flash", async () => {
    // Ambient a quarter of the standard at 1/125 s, the flash half the standard: aperture priority at f/8 needs ambient·t/(1/125) = 1/2,
    // t = 2/125 s by hand. Shutter priority at 1/125 s: 1/4 + 1/2 = 3/4 of the standard, so N = 8·√(3/4). Program lands on its line.
    const ambient: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX / 4 }] };
    const options = (exposure: NonNullable<SimulateCaptureOptions["exposure"]>, lens: NonNullable<SimulateCaptureOptions["lens"]> = {}): SimulateCaptureOptions =>
      ({ ...flashCard({ output: { guideNumberM: 16 / Math.SQRT2 } }, { illumination: ambient }), exposure, lens });
    const aperture = await simulateCapture(options({ mode: "aperture-priority", iso: 100, metering: "grey-card" }, { fNumber: 8 }));
    expect(aperture.exposure.settings.shutterSeconds / (2 / 125)).toBeCloseTo(1, 9);
    expect(Math.abs(aperture.exposure.greyCardDeviationStops!)).toBeLessThan(1e-9);
    const shutter = await simulateCapture(options({ mode: "shutter-priority", iso: 100, shutterSeconds: 1 / 125, metering: "grey-card" }));
    expect(shutter.exposure.settings.fNumber / (8 * Math.sqrt(0.75))).toBeCloseTo(1, 9);
    const program = await simulateCapture(options({ mode: "program", iso: 100, metering: "grey-card" }));
    expect(Math.abs(program.exposure.greyCardDeviationStops!)).toBeLessThan(1e-9);
    // Scene-average metering reads the flash's falloff over the frame as well: the scene average lands on the standard exposure.
    const average = await simulateCapture(options({ mode: "aperture-priority", iso: 100 }, { fNumber: 8 }));
    expect(Math.abs(average.exposure.standardExposureDeviationStops!)).toBeLessThan(1e-9);
    // A flash that alone overexposes at f/8 holds the shortest shutter; ambient alone would have needed 4/125 s.
    const strong = await simulateCapture({ ...options({ mode: "aperture-priority", iso: 100, metering: "grey-card" }, { fNumber: 8 }),
      illumination: { ...ambient, flash: { illuminant: DAY, output: { guideNumberM: 32 } } } });
    expect(strong.exposure.settings.shutterSeconds).toBeLessThan(1 / 1000);
  }, testTimeout(90_000));

  it("with the flash alone the automatic modes take 1/125 s (owner decision 2026-11-16)", async () => {
    const alone = flashCard({ output: { guideNumberM: 11 } });
    const run = (exposure: NonNullable<SimulateCaptureOptions["exposure"]>, lens: NonNullable<SimulateCaptureOptions["lens"]> = {}): Promise<Awaited<ReturnType<typeof simulateCapture>>> =>
      simulateCapture({ ...alone, exposure, lens });
    const cases = await Promise.all([
      run({ mode: "aperture-priority", iso: 100, metering: "grey-card" }, { fNumber: 8 }),
      run({ mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 30 }, metering: "grey-card" }, { fNumber: 8 }),
      run({ mode: "program", iso: 100, metering: "grey-card" }),
      run({ mode: "program", iso: "auto", metering: "grey-card" })]);
    for (const capture of cases) {
      expect(capture.exposure.settings.shutterSeconds).toBe(1 / 125);
      expect(capture.assumptions.find((a) => a.id === "exposure.flashShutter")?.value).toBe(1 / 125);
    }
    // Aperture priority at a fixed ISO keeps the flash's own exposure, log2((16/11)²) under; Auto ISO and program resolve the rest at
    // 1/125 s: program picks f/5.5 (11 = 2 × 5.5) at ISO 100, Auto ISO the whole-stop ISO nearest the target.
    expect(cases[0]!.exposure.greyCardDeviationStops).toBeCloseTo(Math.log2(256 / 121), 12);
    expect(Math.abs(cases[1]!.exposure.greyCardDeviationStops!)).toBeLessThanOrEqual(0.5);
    expect(cases[2]!.exposure.settings.fNumber).toBeCloseTo(5.5, 9);
    expect(Math.abs(cases[2]!.exposure.greyCardDeviationStops!)).toBeLessThan(1e-9);
    expect(Math.abs(cases[3]!.exposure.greyCardDeviationStops!)).toBeLessThan(1e-9);
    // Scene-average metering reads no ambient light either.
    expect((await run({ mode: "aperture-priority", iso: 100 }, { fNumber: 8 })).exposure.settings.shutterSeconds).toBe(1 / 125);
    // With any ambient light the reading depends on the shutter, and the solved shutter is used instead.
    const dim = await simulateCapture({ ...alone, illumination: { sources: [{ illuminant: DAY, illuminanceLux: 1 }], flash: alone.illumination!.flash! },
      exposure: { mode: "aperture-priority", iso: 100, metering: "grey-card" } });
    expect(dim.exposure.settings.shutterSeconds).not.toBe(1 / 125);
    // Every built-in body's range is 1/8000–30 s; a range without 1/125 s holds the nearest end.
    const none = (): void => undefined;
    expect(flashAloneShutter(1 / 60, 30, none)).toBe(1 / 60);
    expect(flashAloneShutter(1 / 8000, 1 / 250, none)).toBe(1 / 250);
    expect(flashAloneShutter(1 / 8000, 30, none)).toBe(1 / 125);
  }, testTimeout(90_000));

  it("the display view takes each site's light as the capture does, fast and exact", async () => {
    const illumination: MixedIllumination = { sources: [{ illuminant: DAY, illuminanceLux: 2000 }],
      flash: { output: { candelaSeconds: 40 }, position: { xM: 0.3, yM: -0.1, heightM: 0.8 } } };
    for (const fast of [true, false]) {
      const options: SimulateCaptureOptions = { scene: { preset: "siemens-star", cycles: 12 }, chartSize: { widthM: 1, surroundReflectance: 0.2 }, subjectDistanceM: 2, illumination, fast,
        exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, output: { width: 20, height: 14 } };
      const capture = await simulateCapture(options), { result, signal } = await simulateDisplayViewWithInternals(options, { width: 4, height: 4, samplesPerAxis: 1 });
      expect(result.assumptions.find((a) => a.id === "view.illumination")).toBeDefined();
      const env = capture.request.environmentRaw.raw.exposure.geometry, nativeWidth = env.nativeRaster.pixelWidth, nativeHeight = env.nativeRaster.pixelHeight;
      // The capture's light at its window (1/30 s) and the scene under it, built independently of the facade.
      const light = resolveMixedIllumination(illumination, resolveCaptureIlluminant, 1 / 30, 2), framedWidthM = capture.scene.framedWidthM;
      const heightM = framedWidthM * capture.scene.framedHeightM / framedWidthM;
      const provider = buildPlanarSceneRadianceProvider({ scene: resolveChartScene({ scene: options.scene as ChartScene, aspect: capture.scene.framedHeightM / framedWidthM }),
        sceneId: "facade-scene", providerProfileId: "facade-provider", illuminant: light.sources[0]!.illuminant, irradianceScale: 1,
        geometry: { distanceM: capture.scene.distanceM, metresPerFrameUnit: framedWidthM / 2, chart: { widthM: 1, heightM: heightM * 1 / framedWidthM, surroundReflectance: 0.2 } },
        evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:test", reuseStatus: "photivra-owned" }], limitations: [], irradianceAt: light.irradianceAt });
      for (let k = 0; k < 16; k++) {
        const index = (k * 7919 + 13) % (nativeWidth * nativeHeight), x = index % nativeWidth, y = Math.floor(index / nativeWidth);
        const environment = capture.request.siteInput(index).environment as unknown as Record<string, unknown>;
        const engine = (calculateEnvironmentSensorPhotoSignal({ ...environment, evaluateRadiance: provider.evaluateRadiance } as unknown as CalculateEnvironmentSensorPhotoSignalInput).value as unknown as
          { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
        expect(Math.abs(signal.site(x, y) - engine)).toBeLessThanOrEqual(1e-9 * engine + 1e-12);
      }
    }
  }, testTimeout(120_000));

  it("hands the GPU's print light table the flash as a point of intensity Q/t", () => {
    const t = 1 / 60, q = 25, flash = resolveMixedIllumination({ flash: { illuminant: DAY, output: { candelaSeconds: q }, position: { xM: 0.01, yM: 0, heightM: 0.05 } } }, resolveCaptureIlluminant, t);
    const point = resolveMixedIllumination({ points: [{ illuminant: DAY, position: { xM: 0.01, yM: 0, heightM: 0.05 }, intensity: { candela: q / t } }] }, resolveCaptureIlluminant);
    const table = (layout: typeof flash): Float32Array => imagePlaneLightTable({ layout, halfWidthM: 0.02 }, [450, 550, 650], 0.18, 1e-9).table;
    expect([...table(flash)]).toEqual([...table(point)]);
  });
});
