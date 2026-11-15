// SPDX-License-Identifier: Apache-2.0

/**
 * Exposure helpers (#616): the sunny-day ("sunny 16") rule, the standard exposure for a named light level or a luminance, and
 * the slowest shutter speed that freezes a moving subject. They reuse the engine's exposure value
 * (`calculateExposureValue100`), standard exposure (standard-exposure.ts, the arithmetic `simulateCapture` uses) and motion
 * blur (`calculateProjectedMotionBlur`).
 *
 * Sources (free):
 * - Sunny 16: f/16 at 1/ISO in bright sun, one stop wider per step of cloud or shade (f/11 slight overcast, f/8 overcast,
 *   f/5.6 heavy overcast, f/4 open shade); Kodak Alaris, "Kodak Professional Tri-X 320 and 400 Films", publication F-4017
 *   (2021), daylight exposure table; the condition table as summarized in Wikipedia, "Sunny 16 rule".
 * - Standard exposure: S = 10/H (CIPA DC-004-2020 §3.2) and H = 0.65·L·t/N² (§5.5 (4)); grey card L = 0.18·E/π.
 * - Light levels: P. Schlyter, "Radiometry and photometry in astronomy" (illuminance table), and Wikipedia, "Lux"
 *   (example illuminances, citing A. Pears 1998 for a living room and lighting guides for offices).
 * - Freeze shutter: image-plane travel v·t·s′/d of a subject crossing the field at distance d (thin-lens image distance s′,
 *   `calculateProjectedMotionBlur`); the shutter for a blur b is t = b·d/(v·s′).
 * @see docs/USAGE.md, "Exposure helpers (#616)".
 */

import { approximationResult, calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { portableHypot } from "../core/portable-math.js";
import { calculateExposureValue100 } from "./exposure.js";
import { GREY_CARD_REFLECTANCE, sosReferenceLuminance, standardExposureValue100 } from "./standard-exposure.js";
import { calculateProjectedMotionBlur } from "../motion/projected-motion.js";
import type { SensorImagingArea } from "../sensor/sensor-geometry.js";

/** A sunny-16 lighting condition. */
export type SunnySixteenCondition = "sunny" | "slight-overcast" | "overcast" | "heavy-overcast" | "open-shade";

/** The sunny-16 table: each condition's stops wider than f/16, its marked f-number and the shadows it is recognized by. */
export const SUNNY_SIXTEEN_CONDITIONS: Readonly<Record<SunnySixteenCondition, Readonly<{ stopsFromSunny: number; markedFNumber: number; shadows: string }>>> =
  /* @__PURE__ */ Object.freeze({
    sunny: Object.freeze({ stopsFromSunny: 0, markedFNumber: 16, shadows: "clearly defined shadows" }),
    "slight-overcast": Object.freeze({ stopsFromSunny: 1, markedFNumber: 11, shadows: "soft shadow edges" }),
    overcast: Object.freeze({ stopsFromSunny: 2, markedFNumber: 8, shadows: "shadows barely visible" }),
    "heavy-overcast": Object.freeze({ stopsFromSunny: 3, markedFNumber: 5.6, shadows: "no shadows" }),
    "open-shade": Object.freeze({ stopsFromSunny: 4, markedFNumber: 4, shadows: "no shadows (subject in the shade of an open sky)" })
  });

/** Nearest value of a shutter dial to `seconds` in stops, the shorter on a tie; or the slowest not longer, with `notLonger`. */
function dialValue(dial: readonly number[] | undefined, seconds: number, notLonger: boolean): number | null | undefined {
  if (dial === undefined) return undefined;
  if (!Array.isArray(dial) || dial.length === 0) throw new InvalidConfigurationError("shutterDialSeconds must be a non-empty array of shutter times.");
  for (const value of dial) requirePositiveFinite("shutterDialSeconds[]", value);
  let best: number | null = null;
  for (const value of dial) {
    if (notLonger) {
      if (value <= seconds * (1 + 1e-12) && (best === null || value > best)) best = value;
    } else {
      const d = Math.abs(Math.log2(value / seconds)), b = best === null ? Infinity : Math.abs(Math.log2(best / seconds));
      if (d < b - 1e-12 || (Math.abs(d - b) <= 1e-12 && best !== null && value < best)) best = value;
    }
  }
  return best;
}

export interface CalculateSunnySixteenExposureInput {
  condition: SunnySixteenCondition;
  /** ISO setting. */
  iso: number;
  /** Optional shutter dial (for example `GENERIC_THIRD_STOP_SHUTTER_SECONDS`): the result also gives the dial value nearest 1/ISO. */
  shutterDialSeconds?: readonly number[];
}

export interface SunnySixteenExposure {
  condition: SunnySixteenCondition;
  iso: number;
  /** f-number, exactly 16 / √2^stops = 2^(4 − stops/2) (f/11.31 for "slight-overcast"). */
  aperture: number;
  /** The marked f-number the rule names (f/11, f/5.6). */
  markedFNumber: number;
  /** 1 / ISO, seconds. */
  shutterSeconds: number;
  /** The dial value nearest 1/ISO, when a dial was given. */
  dialShutterSeconds?: number | null;
  /** Exposure value of the pair, log2(N²/t). */
  exposureValue: number;
  /** The same normalized to ISO 100: exposureValue − log2(ISO/100) = log2(100·N²) (14.64 for sunny). */
  ev100: number;
  /** Scene luminance that the pair exposes at the engine's standard exposure, 10·N²/(0.65·t·S) cd/m². */
  standardLuminanceCdPerSquareMeter: number;
  shadows: string;
}

/**
 * The sunny-16 rule (#616): the base exposure for a daylight condition at an ISO, f/16 at 1/ISO in bright sun and one stop
 * wider for each step of cloud or shade (f/11 slight overcast, f/8 overcast, f/5.6 heavy overcast, f/4 open shade).
 *
 * A rule of thumb for a front-lit average subject (Kodak publication F-4017's daylight table; Wikipedia, "Sunny 16 rule"),
 * not a metered exposure: the result also gives its EV and the luminance it exposes at the engine's standard exposure
 * (CIPA DC-004-2020), for comparison with `calculateStandardExposure`.
 *
 * Example: sunny at ISO 100 gives f/16 at 1/100 s, EV 14.64.
 *
 * @param input Condition, ISO and an optional shutter dial.
 * @returns The f-number and shutter time, their EV and the luminance they expose.
 */
export function calculateSunnySixteenExposure(input: CalculateSunnySixteenExposureInput): CalculationResult<SunnySixteenExposure> {
  requireInputKeys(input, "calculateSunnySixteenExposure", ["condition", "iso", "shutterDialSeconds"]);
  const row = Object.prototype.hasOwnProperty.call(SUNNY_SIXTEEN_CONDITIONS, input.condition) ? SUNNY_SIXTEEN_CONDITIONS[input.condition] : undefined;
  if (!row) throw new InvalidConfigurationError("condition must be one of " + Object.keys(SUNNY_SIXTEEN_CONDITIONS).join(", ") + ".");
  requirePositiveFinite("iso", input.iso);
  const aperture = 2 ** (4 - row.stopsFromSunny / 2), shutterSeconds = 1 / input.iso;
  const exposureValue = calculateExposureValue100({ aperture, shutterSeconds }).value;
  const dial = dialValue(input.shutterDialSeconds, shutterSeconds, false);
  return approximationResult(
    { condition: input.condition, iso: input.iso, aperture, markedFNumber: row.markedFNumber, shutterSeconds, ...(dial === undefined ? {} : { dialShutterSeconds: dial }),
      exposureValue, ev100: exposureValue - Math.log2(input.iso / 100), standardLuminanceCdPerSquareMeter: sosReferenceLuminance(aperture, shutterSeconds, input.iso),
      shadows: row.shadows },
    "sunny-sixteen-rule",
    "1.0.0",
    [
      "Rule of thumb for a front-lit average subject in daylight; not a metered exposure.",
      "One stop per condition step from f/16 at 1/ISO; the f-number is the exact stop (16/√2^n), with the marked value alongside."
    ]
  );
}

/** A named light level (#616). */
export type NamedLightLevel = "direct-sun" | "full-daylight" | "overcast-day" | "very-dark-overcast-day" | "office" | "living-room" | "twilight" | "full-moon" |
  "starlight-and-airglow" | "starlight" | "overcast-night";

/** A named light level's illuminance on a horizontal surface, the range the source gives and the source. */
export interface NamedLightLevelRecord {
  /** Illuminance used, lux: the source's value, or the geometric mean of its range. */
  illuminanceLux: number;
  /** The source's range, lux (equal ends for one value). */
  rangeLux: readonly [number, number];
  description: string;
  source: string;
}

const SCHLYTER = "P. Schlyter, \"Radiometry and photometry in astronomy\", illuminance table";
const LUX_TABLE = "Wikipedia, \"Lux\", example illuminances";
const level = (low: number, high: number, description: string, source: string): NamedLightLevelRecord =>
  Object.freeze({ illuminanceLux: low === high ? low : Math.sqrt(low * high), rangeLux: Object.freeze([low, high] as const), description, source });

/** Representative illuminances of common light levels (free sources; real scenes vary widely around them). */
export const NAMED_LIGHT_LEVELS: Readonly<Record<NamedLightLevel, NamedLightLevelRecord>> = /* @__PURE__ */ Object.freeze({
  "direct-sun": level(130000, 130000, "Sun overhead", SCHLYTER),
  "full-daylight": level(10000, 25000, "Full daylight, not direct sun", SCHLYTER),
  "overcast-day": level(1000, 1000, "Overcast day", SCHLYTER),
  "very-dark-overcast-day": level(100, 100, "Very dark overcast day", SCHLYTER),
  office: level(320, 500, "Office lighting", LUX_TABLE),
  "living-room": level(50, 50, "Family living room lights", LUX_TABLE),
  twilight: level(10, 10, "Twilight", SCHLYTER),
  "full-moon": level(0.267, 0.267, "Full Moon overhead", SCHLYTER),
  "starlight-and-airglow": level(2e-3, 2e-3, "Total starlight and airglow", SCHLYTER),
  starlight: level(2e-4, 2e-4, "Total starlight only", SCHLYTER),
  "overcast-night": level(1e-4, 1e-4, "Total starlight at an overcast night", SCHLYTER)
});

export interface CalculateStandardExposureInput {
  /** ISO setting. Default 100. */
  iso?: number;
  /** A named light level, metered as an 18 % grey card under its illuminance. Give exactly one of light, illuminanceLux and luminanceCdPerSquareMeter. */
  light?: NamedLightLevel;
  /** Illuminance on the subject, lux, metered as an 18 % grey card (incident metering): L = 0.18·E/π. */
  illuminanceLux?: number;
  /** Metered scene luminance, cd/m² (reflected metering). */
  luminanceCdPerSquareMeter?: number;
  /** f-number for the settings pair (default f/8); the shutter follows. Not with `shutterSeconds`. */
  aperture?: number;
  /** Shutter time for the settings pair, seconds; the f-number follows. Not with `aperture`. */
  shutterSeconds?: number;
  /** Optional shutter dial: the result also gives the dial value nearest the pair's shutter (with `aperture`). */
  shutterDialSeconds?: readonly number[];
}

export interface StandardExposure {
  iso: number;
  /** The metered luminance, cd/m². */
  luminanceCdPerSquareMeter: number;
  /** The illuminance, lux, when the light was given as an illuminance or a named level. */
  illuminanceLux: number | null;
  light: NamedLightLevel | null;
  /** EV at the request's ISO: log2(N²/t) = log2(0.065·L·S). */
  exposureValue: number;
  /** EV at ISO 100. */
  ev100: number;
  /** The settings pair at the standard exposure. */
  aperture: number;
  shutterSeconds: number;
  /** The dial value nearest the shutter, when a dial was given. */
  dialShutterSeconds?: number | null;
}

/**
 * The standard exposure for a chosen light (#616): the metered EV and a settings pair for a named light level, an illuminance
 * (incident metering of an 18 % grey card, L = 0.18·E/π) or a luminance (reflected metering), at an ISO.
 *
 * The exposure is the engine's standard exposure, the one `simulateCapture` meters to: H = 10/S at the focal plane (CIPA
 * DC-004-2020 §3.2) with the camera equation H = 0.65·L·t/N² (§5.5 (4)), so N²/t = 0.065·L·S. The named levels are
 * representative values from free sources (`NAMED_LIGHT_LEVELS`), not measurements of a particular scene.
 *
 * Example: "overcast-day" (1,000 lux, L = 180/π ≈ 57.3 cd/m²) at ISO 100 gives EV 8.54 and, at f/2.8, about 1/47.5 s (1/50 s on a
 * third-stop dial).
 *
 * @param input The light, ISO and the aperture or shutter of the pair.
 * @returns EV at the ISO and at ISO 100, and the pair.
 */
export function calculateStandardExposure(input: CalculateStandardExposureInput): CalculationResult<StandardExposure> {
  requireInputKeys(input, "calculateStandardExposure", ["iso", "light", "illuminanceLux", "luminanceCdPerSquareMeter", "aperture", "shutterSeconds", "shutterDialSeconds"]);
  const iso = input.iso ?? 100;
  requirePositiveFinite("iso", iso);
  const given = [input.light, input.illuminanceLux, input.luminanceCdPerSquareMeter].filter((v) => v !== undefined).length;
  if (given !== 1) throw new InvalidScientificInputError("Give exactly one of light, illuminanceLux and luminanceCdPerSquareMeter.");
  let illuminanceLux: number | null = null, luminance: number;
  if (input.light !== undefined) {
    const record = Object.prototype.hasOwnProperty.call(NAMED_LIGHT_LEVELS, input.light) ? NAMED_LIGHT_LEVELS[input.light] : undefined;
    if (!record) throw new InvalidConfigurationError("light must be one of " + Object.keys(NAMED_LIGHT_LEVELS).join(", ") + ".");
    illuminanceLux = record.illuminanceLux;
  } else if (input.illuminanceLux !== undefined) {
    requirePositiveFinite("illuminanceLux", input.illuminanceLux);
    illuminanceLux = input.illuminanceLux;
  }
  if (illuminanceLux !== null) luminance = GREY_CARD_REFLECTANCE * illuminanceLux / Math.PI;
  else {
    requirePositiveFinite("luminanceCdPerSquareMeter", input.luminanceCdPerSquareMeter!);
    luminance = input.luminanceCdPerSquareMeter!;
  }
  if (input.aperture !== undefined && input.shutterSeconds !== undefined) throw new InvalidScientificInputError("Give aperture or shutterSeconds, not both.");
  // N²/t = 0.065·L·S: the inverse of sosReferenceLuminance (L at unit N²/t).
  const ratio = 1 / sosReferenceLuminance(1, 1, iso) * luminance;
  let aperture: number, shutterSeconds: number;
  if (input.shutterSeconds !== undefined) {
    requirePositiveFinite("shutterSeconds", input.shutterSeconds);
    shutterSeconds = input.shutterSeconds;
    aperture = Math.sqrt(ratio * shutterSeconds);
  } else {
    aperture = input.aperture ?? 8;
    requirePositiveFinite("aperture", aperture);
    shutterSeconds = aperture * aperture / ratio;
  }
  if (!(aperture > 0 && shutterSeconds > 0) || !Number.isFinite(aperture) || !Number.isFinite(shutterSeconds)) {
    throw new InvalidScientificInputError("The standard exposure's settings are not finite for this light.");
  }
  if (input.shutterDialSeconds !== undefined && input.shutterSeconds !== undefined) throw new InvalidScientificInputError("shutterDialSeconds applies only when the shutter follows from the aperture.");
  const dial = dialValue(input.shutterDialSeconds, shutterSeconds, false);
  const exposureValue = calculateExposureValue100({ aperture, shutterSeconds }).value;
  return calculatedResult(
    { iso, luminanceCdPerSquareMeter: luminance, illuminanceLux, light: input.light ?? null, exposureValue, ev100: standardExposureValue100(luminance), aperture, shutterSeconds,
      ...(dial === undefined ? {} : { dialShutterSeconds: dial }) },
    "standard-exposure",
    "1.0.0",
    [
      "Standard exposure H = 10/S (CIPA DC-004-2020 §3.2) with the camera equation H = 0.65·L·t/N² (§5.5 (4)).",
      "Incident metering: an 18 % Lambertian grey card, L = 0.18·E/π.",
      "Named light levels are representative values; real scenes vary."
    ]
  );
}

export interface CalculateFreezeShutterSpeedInput {
  /** Subject speed across the line of sight, m/s (the component perpendicular to it). */
  subjectSpeedMps: number;
  /** Subject distance, m. */
  subjectDistanceM: number;
  /** Lens focal length, mm. */
  focalLengthMm: number;
  /** Focus distance, m. Default: the subject distance. */
  focusDistanceM?: number;
  /**
   * The largest acceptable blur: in pixels with the pixel pitch, or as a fraction of the frame's diagonal (or width or height)
   * with the sensor's active area.
   */
  blurLimit: { pixels: number; pixelPitchMicrometers: number } | { fractionOfFrame: number; sensor: SensorImagingArea; along?: "diagonal" | "width" | "height" };
  /** Optional shutter dial: the result also gives the slowest dial value that does not exceed the limit. */
  shutterDialSeconds?: readonly number[];
}

export interface FreezeShutterSpeed {
  /** The slowest shutter time that keeps the blur at the limit, seconds. */
  shutterSeconds: number;
  /** The slowest dial value not longer than `shutterSeconds` (null when the dial has none), when a dial was given. */
  dialShutterSeconds?: number | null;
  /** The blur limit on the sensor, mm. */
  blurLimitMm: number;
  /** Image-plane speed of the subject, mm/s: v·s′/d. */
  imageSpeedMmPerSecond: number;
  /** Thin-lens image distance used for the projection, mm. */
  projectionDistanceMm: number;
}

/**
 * The slowest shutter speed that freezes a subject (#616): the exposure time at which a subject crossing the field at
 * `subjectSpeedMps` and `subjectDistanceM` travels the blur limit on the sensor, t = b·d/(v·s′), with s′ the thin-lens image
 * distance at the focus distance.
 *
 * The image speed comes from `calculateProjectedMotionBlur` (ideal rectilinear thin-lens projection, constant velocity
 * perpendicular to the line of sight), which is linear in time for such motion, so the result is exact under that model.
 * Motion toward the camera, camera shake and the pixel aperture are not included.
 *
 * Example: 10 m/s at 20 m with a 200 mm lens and a 1-pixel limit at 4 µm: about 1/25,250 s (s′ ≈ 202.0 mm).
 *
 * @param input Subject speed and distance, focal length, blur limit and an optional shutter dial.
 * @returns The slowest shutter time and the image speed.
 */
export function calculateFreezeShutterSpeed(input: CalculateFreezeShutterSpeedInput): CalculationResult<FreezeShutterSpeed> {
  requireInputKeys(input, "calculateFreezeShutterSpeed", ["subjectSpeedMps", "subjectDistanceM", "focalLengthMm", "focusDistanceM", "blurLimit", "shutterDialSeconds"]);
  requirePositiveFinite("subjectSpeedMps", input.subjectSpeedMps);
  requirePositiveFinite("subjectDistanceM", input.subjectDistanceM);
  requireInputObject(input.blurLimit, "blurLimit");
  const limit = input.blurLimit as Record<string, unknown>;
  let blurLimitMm: number, pixelPitchMicrometers: number | undefined;
  if ("pixels" in limit) {
    requireInputKeys(limit, "blurLimit", ["pixels", "pixelPitchMicrometers"]);
    requirePositiveFinite("blurLimit.pixels", limit.pixels as number);
    requirePositiveFinite("blurLimit.pixelPitchMicrometers", limit.pixelPitchMicrometers as number);
    pixelPitchMicrometers = limit.pixelPitchMicrometers as number;
    blurLimitMm = (limit.pixels as number) * pixelPitchMicrometers / 1000;
  } else {
    requireInputKeys(limit, "blurLimit", ["fractionOfFrame", "sensor", "along"]);
    const fraction = limit.fractionOfFrame as number, sensor = limit.sensor as SensorImagingArea, along = limit.along ?? "diagonal";
    if (typeof fraction !== "number" || !(fraction > 0 && fraction <= 1)) throw new InvalidScientificInputError("blurLimit.fractionOfFrame must be greater than 0 and at most 1.");
    requireInputObject(sensor, "blurLimit.sensor");
    requireInputKeys(sensor, "blurLimit.sensor", ["widthMm", "heightMm"]);
    requirePositiveFinite("blurLimit.sensor.widthMm", sensor.widthMm);
    requirePositiveFinite("blurLimit.sensor.heightMm", sensor.heightMm);
    if (along !== "diagonal" && along !== "width" && along !== "height") throw new InvalidConfigurationError('blurLimit.along must be "diagonal", "width" or "height".');
    blurLimitMm = fraction * (along === "width" ? sensor.widthMm : along === "height" ? sensor.heightMm : portableHypot(sensor.widthMm, sensor.heightMm));
  }
  // One second of motion across the line of sight: the blur grows linearly with time (z is constant).
  const perSecond = calculateProjectedMotionBlur({ focalLengthMm: input.focalLengthMm, shutterSeconds: 1, positionM: { x: 0, y: 0, z: input.subjectDistanceM },
    velocityMps: { x: input.subjectSpeedMps, y: 0, z: 0 }, focusDistanceM: input.focusDistanceM ?? input.subjectDistanceM }).value;
  const shutterSeconds = blurLimitMm / perSecond.distanceMm;
  if (!(shutterSeconds > 0) || !Number.isFinite(shutterSeconds)) throw new InvalidScientificInputError("The freeze shutter time is not a finite positive number.");
  const dial = dialValue(input.shutterDialSeconds, shutterSeconds, true);
  return calculatedResult(
    { shutterSeconds, ...(dial === undefined ? {} : { dialShutterSeconds: dial }), blurLimitMm, imageSpeedMmPerSecond: perSecond.distanceMm,
      projectionDistanceMm: perSecond.projectionDistanceMm },
    "freeze-shutter-speed",
    "1.0.0",
    [
      "Ideal rectilinear paraxial thin-lens projection; constant subject velocity perpendicular to the line of sight.",
      "Camera motion, motion toward the camera and the pixel aperture are not included.",
      ...(pixelPitchMicrometers === undefined ? [] : ["The pixel limit is converted to millimetres at the given pixel pitch."])
    ]
  );
}
