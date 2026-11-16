// SPDX-License-Identifier: Apache-2.0
/** #616: sunny 16, the standard exposure for a light, and the freeze shutter speed. */
import { describe, expect, it } from "vitest";
import { calculateFreezeShutterSpeed, calculateProjectedMotionBlur, calculateStandardExposure, calculateSunnySixteenExposure, GENERIC_THIRD_STOP_SHUTTER_SECONDS,
  NAMED_LIGHT_LEVELS, simulateCapture, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("calculateSunnySixteenExposure (#616)", () => {
  it("gives f/16 at 1/ISO in sun and one stop wider per condition", () => {
    const sunny = calculateSunnySixteenExposure({ condition: "sunny", iso: 100 }).value;
    expect([sunny.aperture, sunny.shutterSeconds, sunny.markedFNumber]).toEqual([16, 1 / 100, 16]);
    expect(sunny.exposureValue).toBeCloseTo(Math.log2(25600), 12);
    expect(sunny.ev100).toBeCloseTo(14.64, 2);
    // L = 10·N²/(0.65·t·S) = 10·256/(0.65·0.01·100).
    expect(sunny.standardLuminanceCdPerSquareMeter).toBeCloseTo(2560 / 0.65, 9);
    const fast = calculateSunnySixteenExposure({ condition: "sunny", iso: 400 }).value;
    expect(fast.shutterSeconds).toBe(1 / 400);
    expect(fast.ev100).toBeCloseTo(sunny.ev100, 12);
    const steps = (["sunny", "slight-overcast", "overcast", "heavy-overcast", "open-shade"] as const).map((condition) => calculateSunnySixteenExposure({ condition, iso: 100 }).value);
    expect(steps.map((s) => s.markedFNumber)).toEqual([16, 11, 8, 5.6, 4]);
    steps.forEach((s, i) => expect(s.ev100).toBeCloseTo(sunny.ev100 - i, 12));
    expect(steps[4]!.aperture).toBe(4);
    expect(calculateSunnySixteenExposure({ condition: "overcast", iso: 200, shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS }).value.dialShutterSeconds).toBe(1 / 200);
    // Nearest in stops, the shorter on a tie: 1/141 s lies halfway between 1/100 and 1/200 on a whole-stop dial.
    expect(calculateSunnySixteenExposure({ condition: "sunny", iso: 100 * Math.SQRT2, shutterDialSeconds: [1 / 200, 1 / 100] }).value.dialShutterSeconds).toBe(1 / 200);
  });

  it("matches the standard exposure of the luminance it exposes", () => {
    const sunny = calculateSunnySixteenExposure({ condition: "sunny", iso: 100 }).value;
    const metered = calculateStandardExposure({ luminanceCdPerSquareMeter: sunny.standardLuminanceCdPerSquareMeter, aperture: 16 }).value;
    expect(metered.shutterSeconds).toBeCloseTo(1 / 100, 15);
    expect(metered.ev100).toBeCloseTo(sunny.ev100, 12);
  });

  it("rejects invalid input", () => {
    expect(() => calculateSunnySixteenExposure({ condition: "snow" as never, iso: 100 })).toThrow(InvalidConfigurationError);
    expect(() => calculateSunnySixteenExposure({ condition: "sunny", iso: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateSunnySixteenExposure({ condition: "sunny", iso: 100, shutterDialSeconds: [] })).toThrow(InvalidConfigurationError);
    expect(() => calculateSunnySixteenExposure({ condition: "sunny", iso: 100, shutterDialSeconds: [0] })).toThrow(InvalidScientificInputError);
    expect(() => calculateSunnySixteenExposure({ condition: "sunny", iso: 100, rule: 16 } as never)).toThrow(InvalidConfigurationError);
  });
});

describe("calculateStandardExposure (#616)", () => {
  it("gives N²/t = 0.065·L·S", () => {
    // f/8 1/125 s at ISO 100 is the standard exposure for L = 10·8000/65 cd/m².
    const r = calculateStandardExposure({ luminanceCdPerSquareMeter: 80000 / 65 }).value;
    expect(r.aperture).toBe(8);
    expect(r.shutterSeconds).toBeCloseTo(1 / 125, 15);
    expect(r.exposureValue).toBeCloseTo(Math.log2(8000), 12);
    expect(r.ev100).toBeCloseTo(Math.log2(8000), 12);
    // At ISO 400 two stops less light are needed: EV two higher at the ISO, the same EV100.
    const iso400 = calculateStandardExposure({ luminanceCdPerSquareMeter: 80000 / 65, iso: 400, shutterSeconds: 1 / 125 }).value;
    expect(iso400.aperture).toBeCloseTo(16, 12);
    expect(iso400.exposureValue).toBeCloseTo(Math.log2(8000) + 2, 12);
    expect(iso400.ev100).toBeCloseTo(r.ev100, 12);
    expect(iso400.illuminanceLux).toBeNull();
  });

  it("meters a named light or an illuminance as an 18 % grey card", () => {
    const overcast = calculateStandardExposure({ light: "overcast-day", aperture: 2.8, shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS }).value;
    expect(overcast.illuminanceLux).toBe(1000);
    expect(overcast.luminanceCdPerSquareMeter).toBeCloseTo(180 / Math.PI, 12);
    expect(overcast.ev100).toBeCloseTo(Math.log2(0.065 * 180 / Math.PI * 100), 12);
    expect(overcast.ev100).toBeCloseTo(8.54, 2);
    expect(overcast.shutterSeconds).toBeCloseTo(2.8 ** 2 / 2 ** overcast.exposureValue, 15);
    expect(overcast.dialShutterSeconds).toBe(1 / 50);
    expect(calculateStandardExposure({ illuminanceLux: 1000, aperture: 2.8 }).value.shutterSeconds).toBe(overcast.shutterSeconds);
    // A range is used at its geometric mean.
    expect(NAMED_LIGHT_LEVELS["full-daylight"].illuminanceLux).toBeCloseTo(Math.sqrt(10000 * 25000), 9);
    expect(NAMED_LIGHT_LEVELS["full-moon"].rangeLux).toEqual([0.267, 0.267]);
    for (const [light, record] of Object.entries(NAMED_LIGHT_LEVELS)) {
      expect(calculateStandardExposure({ light: light as keyof typeof NAMED_LIGHT_LEVELS }).value.illuminanceLux).toBe(record.illuminanceLux);
    }
  });

  it("agrees with simulateCapture's grey-card metering", async () => {
    for (const lux of [50, 1000, 20000]) {
      const capture = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 8 }, illuminanceLux: lux, exposure: { mode: "aperture-priority", iso: 100, metering: "grey-card" } });
      const standard = calculateStandardExposure({ illuminanceLux: lux, aperture: capture.exposure.settings.fNumber }).value;
      expect(standard.shutterSeconds / capture.exposure.settings.shutterSeconds, String(lux)).toBeCloseTo(1, 9);
    }
  }, scaledTimeout(60_000));

  it("rejects invalid input", () => {
    expect(() => calculateStandardExposure({})).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ light: "overcast-day", illuminanceLux: 5 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ light: "dusk" as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateStandardExposure({ illuminanceLux: -1 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ luminanceCdPerSquareMeter: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ illuminanceLux: 5, aperture: 8, shutterSeconds: 1 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ illuminanceLux: 5, shutterSeconds: 1, shutterDialSeconds: [1] })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ illuminanceLux: 5, aperture: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ illuminanceLux: 5, iso: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateStandardExposure({ luminanceCdPerSquareMeter: 1e-300, aperture: 1e200 })).toThrow(InvalidScientificInputError);
  });
});

describe("calculateFreezeShutterSpeed (#616)", () => {
  it("gives t = b·d/(v·s′) for a blur limit in pixels", () => {
    const r = calculateFreezeShutterSpeed({ subjectSpeedMps: 10, subjectDistanceM: 20, focalLengthMm: 200, blurLimit: { pixels: 1, pixelPitchMicrometers: 4 },
      shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS }).value;
    const imageDistance = 1 / (1 / 200 - 1 / 20000);
    expect(r.projectionDistanceMm).toBeCloseTo(imageDistance, 10);
    expect(r.imageSpeedMmPerSecond).toBeCloseTo(10 * imageDistance / 20, 10);
    expect(r.shutterSeconds).toBeCloseTo(0.004 * 20 / (10 * imageDistance), 15);
    expect(1 / r.shutterSeconds).toBeCloseTo(25252.5, 0);
    // No dial value is that short.
    expect(r.dialShutterSeconds).toBeNull();
    // At that time the projected blur is exactly the limit.
    const blur = calculateProjectedMotionBlur({ focalLengthMm: 200, shutterSeconds: r.shutterSeconds, positionM: { x: 0, y: 0, z: 20 }, velocityMps: { x: 10, y: 0, z: 0 },
      focusDistanceM: 20, pixelPitchMicrometers: 4 }).value;
    expect(blur.distancePixels).toBeCloseTo(1, 12);
  });

  it("takes a fraction of the frame and returns the slowest dial value within it", () => {
    const sensor = { widthMm: 36, heightMm: 24 }, diagonal = Math.hypot(36, 24);
    const r = calculateFreezeShutterSpeed({ subjectSpeedMps: 1, subjectDistanceM: 5, focalLengthMm: 50, blurLimit: { fractionOfFrame: 1 / 1500, sensor },
      shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS }).value;
    expect(r.blurLimitMm).toBeCloseTo(diagonal / 1500, 14);
    expect(r.shutterSeconds).toBeCloseTo((diagonal / 1500) * 5 / (1 * (1 / (1 / 50 - 1 / 5000))), 14);
    expect(r.dialShutterSeconds).toBe(1 / 400);
    expect(calculateFreezeShutterSpeed({ subjectSpeedMps: 1, subjectDistanceM: 5, focalLengthMm: 50, blurLimit: { fractionOfFrame: 0.001, sensor, along: "width" } }).value.blurLimitMm).toBeCloseTo(0.036, 15);
    expect(calculateFreezeShutterSpeed({ subjectSpeedMps: 1, subjectDistanceM: 5, focalLengthMm: 50, blurLimit: { fractionOfFrame: 0.001, sensor, along: "height" } }).value.blurLimitMm).toBeCloseTo(0.024, 15);
    // Focused elsewhere, the projection uses the focus distance's image distance.
    const off = calculateFreezeShutterSpeed({ subjectSpeedMps: 1, subjectDistanceM: 5, focalLengthMm: 50, focusDistanceM: 2, blurLimit: { fractionOfFrame: 0.001, sensor } }).value;
    expect(off.projectionDistanceMm).toBeCloseTo(1 / (1 / 50 - 1 / 2000), 10);
  });

  it("rejects invalid input", () => {
    const base = { subjectSpeedMps: 1, subjectDistanceM: 5, focalLengthMm: 50 };
    expect(() => calculateFreezeShutterSpeed({ ...base, subjectSpeedMps: 0, blurLimit: { pixels: 1, pixelPitchMicrometers: 4 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: { pixels: 0, pixelPitchMicrometers: 4 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: { fractionOfFrame: 2, sensor: { widthMm: 36, heightMm: 24 } } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: { fractionOfFrame: 0.1, sensor: { widthMm: 36, heightMm: 24 }, along: "area" as never } })).toThrow(InvalidConfigurationError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: { fractionOfFrame: 0.1, sensor: { widthMm: -1, heightMm: 24 } } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: { pixels: 1, pixelPitchMicrometers: 4, size: 1 } as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateFreezeShutterSpeed({ ...base, blurLimit: 5 as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateFreezeShutterSpeed({ ...base, subjectDistanceM: 0.01, blurLimit: { pixels: 1, pixelPitchMicrometers: 4 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateFreezeShutterSpeed({ ...base, focalLengthMm: 1e-300, subjectSpeedMps: 1e-300, blurLimit: { pixels: 1e300, pixelPitchMicrometers: 1e300 } })).toThrow(InvalidScientificInputError);
  });
});
