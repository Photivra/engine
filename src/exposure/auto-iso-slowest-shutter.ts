// SPDX-License-Identifier: Apache-2.0

/**
 * #504: the automatic slowest preferred shutter for Auto ISO ("Auto" minimum shutter speed), derived
 * from the engine's camera-shake model (`estimateCameraShakeBlur()`), not from the 1/focal-length rule
 * of thumb.
 *
 * The camera turns at a constant angular velocity ω (yaw, pitch) during the exposure, reduced by the
 * stabilization factor r = 2^−stops. A still point on the optical axis then moves
 * b(t) = v·hypot(tan(r·ω_yaw·t), tan(r·ω_pitch·t)) on the sensor, where v is the projection distance (the
 * focal length, or the thin-lens image distance with a focus distance). The derived shutter is the
 * exposure time at which b(t) equals the caller's blur budget. b(t) grows strictly with t, so the
 * solution is unique; the whole-stop bias (as in makers' Auto minimum-shutter settings: faster or
 * slower in 1 EV steps) is applied after the derivation, and the optional shutter grid last.
 *
 * This is an approximation: the hand's motion is a constant-velocity profile supplied by the caller,
 * and stabilization stops scale the motion by 2^−stops (the educational model of
 * `estimateCameraShakeBlur()`, not a CIPA DC-011 rating).
 * @see docs/USAGE.md ("Automatic slowest shutter (#504)") for the equations, the cited generic
 * hand-shake default and the support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { rejectUnknownFields, requireInputKeys, requireInputObject, requireInputPositiveFinite as requirePositive } from "../core/record-validation.js";
import { InvalidScientificInputError, InvalidScientificResultError } from "../core/validation.js";
import { portableHypot } from "../core/portable-math.js";
import type { ResolvedGenericEquipmentExposureCapabilities } from "../equipment/exposure-capabilities.js";
import { estimateCameraShakeBlur, type CameraShakeEstimate } from "../stabilization/camera-shake.js";

export const AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION = "1.0.0" as const;

/**
 * A generic handheld angular velocity, labelled as a default and not a measurement of any camera or
 * photographer: 4.39 °/s (≈ 0.0766 rad/s), the linear camera-motion rate Xiao, Farrell, Catrysse and
 * Wandell use for "an average user" holding "a typical 100g mobile handset with two hands", from their
 * earlier gyroscope measurements (F. Xiao, J. Farrell, P. Catrysse, B. Wandell, "Mobile imaging: the
 * big challenge of the small pixel", Proc. SPIE 7250, Digital Photography V, 2009, §2; author copy:
 * https://web.stanford.edu/~wandell/data/papers/2009-CameraShake-Xiao.pdf; they cite F. Xiao et al.,
 * "Camera-motion and mobile imaging", Proc. SPIE 6502, 2007). The value is one rate magnitude; it is
 * placed on the yaw axis (for small angles the blur length does not depend on the direction). A
 * heavier camera, another grip or another photographer moves differently: pass your own profile.
 */
export const GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC: Readonly<{ yaw: number; pitch: number }> =
  /* @__PURE__ */ Object.freeze({ yaw: (4.39 * Math.PI) / 180, pitch: 0 });

/** The largest whole-stop bias accepted, either way (makers offer up to 2 stops faster or slower). */
export const AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS = 2 as const;

/** The blur allowed during the exposure, on the sensor. */
export type AutoIsoSlowestShutterBlurBudget =
  | {
      /** The blur trace length in pixels of the given pitch. */
      kind: "pixels";
      pixels: number;
      pixelPitchMicrometers: number;
    }
  | {
      /** The blur trace length as a fraction of the image diagonal (width × height in millimetres). */
      kind: "image-diagonal-fraction";
      fraction: number;
      imageWidthMm: number;
      imageHeightMm: number;
    };

export interface EstimateAutoIsoSlowestShutterInput {
  focalLengthMm: number;
  /** Optional focus distance in metres: the thin-lens image distance becomes the projection distance, as in `estimateCameraShakeBlur()`. */
  focusDistanceM?: number;
  /**
   * The hand's constant angular velocity in radians per second, the explicit shake profile (signs as in
   * `estimateCameraShakeBlur()`; only the magnitude matters here). At least one axis must be non-zero.
   * `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC` is a cited generic default, not a measurement of you.
   */
  angularVelocityRadPerSec: { yaw: number; pitch: number };
  /** Stabilization in equivalent stops (≥ 0); the motion is scaled by 2^−stops. Default 0. */
  stabilizationStopsEquivalent?: number;
  blurBudget: AutoIsoSlowestShutterBlurBudget;
  /**
   * The bias in whole stops, applied after the derivation: +1 is one stop faster (half the time), −1 one
   * stop slower (twice the time). An integer from −2 to +2. Default 0.
   */
  fasterByStops?: number;
  /** Optional: the body's resolved shutter capability. The biased shutter then snaps to it, never longer than the biased value, and is held at its ends. */
  shutterCapability?: ResolvedGenericEquipmentExposureCapabilities["shutter"];
}

export interface AutoIsoSlowestShutterEstimate {
  /** The exposure time whose shake blur equals the budget, before the bias and the grid. */
  derivedShutterSeconds: number;
  fasterByStops: number;
  /** derivedShutterSeconds · 2^−fasterByStops. */
  biasedShutterSeconds: number;
  /** The slowest preferred shutter: the biased value, snapped to `shutterCapability` when given. */
  shutterSeconds: number;
  shutterResolution: {
    kind: "unconstrained" | "continuous" | "discrete";
    selectionPolicy: "not-longer-than-target";
    quantized: boolean;
    clamped: false | "minimum" | "maximum";
  };
  blurBudgetMm: number;
  /** `estimateCameraShakeBlur()`'s stabilized blur at the derived shutter (equal to the budget within rounding). */
  blurAtDerivedShutterMm: number;
  /** `estimateCameraShakeBlur()`'s stabilized blur at `shutterSeconds`. */
  blurAtShutterMm: number;
  /** The same blur lengths in pixels, for a pixel budget. */
  blurBudgetPixels?: number;
  blurAtShutterPixels?: number;
  projectionDistanceMm: number;
  residualMotionFactor: number;
  angularVelocityRadPerSec: { yaw: number; pitch: number };
  stabilizationStopsEquivalent: number;
}

function parseBudget(value: unknown): { budgetMm: number; budgetPixels?: number; pixelPitchMicrometers?: number } {
  requireInputObject(value, "blurBudget");
  const record = value as Record<string, unknown>;
  if (record.kind === "pixels") {
    rejectUnknownFields(record, ["kind", "pixels", "pixelPitchMicrometers"], "blurBudget");
    const pixels = requirePositive(record.pixels, "blurBudget.pixels");
    const pitch = requirePositive(record.pixelPitchMicrometers, "blurBudget.pixelPitchMicrometers");
    return { budgetMm: (pixels * pitch) / 1000, budgetPixels: pixels, pixelPitchMicrometers: pitch };
  }
  if (record.kind === "image-diagonal-fraction") {
    rejectUnknownFields(record, ["kind", "fraction", "imageWidthMm", "imageHeightMm"], "blurBudget");
    const fraction = requirePositive(record.fraction, "blurBudget.fraction");
    if (fraction >= 1) throw new InvalidScientificInputError("blurBudget.fraction must be less than 1.");
    const width = requirePositive(record.imageWidthMm, "blurBudget.imageWidthMm");
    const height = requirePositive(record.imageHeightMm, "blurBudget.imageHeightMm");
    return { budgetMm: fraction * portableHypot(width, height) };
  }
  throw new InvalidConfigurationError('blurBudget.kind must be "pixels" or "image-diagonal-fraction".');
}

/**
 * Solves v·hypot(tan(a·t), tan(b·t)) = budget for t, with a, b ≥ 0 the stabilized angular speeds. One
 * axis: t = atan(budget/v)/a exactly. Two axes: bisection on the strictly increasing blur over
 * (0, π/(2·max(a, b))), a fixed number of halvings (deterministic, to the last bit of the bracket).
 */
function solveShutterForBudget(projectionMm: number, a: number, b: number, budgetMm: number): number {
  const ratio = budgetMm / projectionMm;
  if (a === 0 || b === 0) return Math.atan(ratio) / Math.max(a, b);
  let low = 0, high = Math.PI / 2 / Math.max(a, b);
  for (let i = 0; i < 200 && high - low > 0; i++) {
    const mid = low + (high - low) / 2;
    if (mid <= low || mid >= high) break;
    if (portableHypot(Math.tan(a * mid), Math.tan(b * mid)) < ratio) low = mid;
    else high = mid;
  }
  return low + (high - low) / 2;
}

function snapNotLonger(
  target: number,
  shutter: ResolvedGenericEquipmentExposureCapabilities["shutter"]
): { shutterSeconds: number; kind: "continuous" | "discrete"; quantized: boolean; clamped: false | "minimum" | "maximum" } {
  const grid = shutter.settingGrid;
  if (grid.kind === "continuous-within-range") {
    if (target < shutter.minimumSeconds) return { shutterSeconds: shutter.minimumSeconds, kind: "continuous", quantized: false, clamped: "minimum" };
    if (target > shutter.maximumSeconds) return { shutterSeconds: shutter.maximumSeconds, kind: "continuous", quantized: false, clamped: "maximum" };
    return { shutterSeconds: target, kind: "continuous", quantized: false, clamped: false };
  }
  const values = grid.values;
  const tolerance = (x: number): number => Number.EPSILON * 32 * Math.max(Math.abs(x), 1);
  const exact = values.find((v) => Math.abs(v - target) <= tolerance(Math.max(v, target)));
  if (exact !== undefined) return { shutterSeconds: exact, kind: "discrete", quantized: false, clamped: false };
  if (target < values[0]!) return { shutterSeconds: values[0]!, kind: "discrete", quantized: true, clamped: "minimum" };
  const last = values[values.length - 1]!;
  if (target > last) return { shutterSeconds: last, kind: "discrete", quantized: true, clamped: "maximum" };
  let selected = values[0]!;
  for (const v of values) if (v <= target) selected = v;
  return { shutterSeconds: selected, kind: "discrete", quantized: true, clamped: false };
}

/**
 * Estimates the slowest preferred shutter for Auto ISO from the lens, the sensor and the hand's
 * shake: the exposure time at which `estimateCameraShakeBlur()`'s stabilized blur equals the blur
 * budget, then shifted by a whole-stop bias and optionally snapped to the body's shutter grid (never
 * longer than the biased value). Longer focal lengths give faster shutters; each stabilization stop
 * doubles the time; each bias stop halves (+1) or doubles (−1) it.
 *
 * An approximation: constant angular velocity (a caller profile, or the labelled generic default
 * `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`), stabilization as 2^−stops, blur on the optical axis
 * only. The 1/focal-length "reciprocal rule" is a rule of thumb and is not used.
 * @param input - EstimateAutoIsoSlowestShutterInput.
 * @returns The derived, biased and snapped shutter with the blur at each, as an approximation result.
 */
export function estimateAutoIsoSlowestShutter(
  input: EstimateAutoIsoSlowestShutterInput
): CalculationResult<AutoIsoSlowestShutterEstimate> {
  requireInputKeys(input, "estimateAutoIsoSlowestShutter", ["focalLengthMm", "focusDistanceM", "angularVelocityRadPerSec", "stabilizationStopsEquivalent",
    "blurBudget", "fasterByStops", "shutterCapability"]);
  const focalLengthMm = requirePositive(input.focalLengthMm, "focalLengthMm");
  requireInputObject(input.angularVelocityRadPerSec, "angularVelocityRadPerSec");
  rejectUnknownFields(input.angularVelocityRadPerSec, ["yaw", "pitch"], "angularVelocityRadPerSec");
  const { yaw, pitch } = input.angularVelocityRadPerSec;
  for (const [name, v] of [["yaw", yaw], ["pitch", pitch]] as const) {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new InvalidScientificInputError("angularVelocityRadPerSec." + name + " must be finite.");
  }
  if (yaw === 0 && pitch === 0) {
    throw new InvalidScientificInputError("angularVelocityRadPerSec must be non-zero on at least one axis: without shake no shutter limit follows.");
  }
  const stops = input.stabilizationStopsEquivalent ?? 0;
  if (typeof stops !== "number" || !Number.isFinite(stops) || stops < 0) {
    throw new InvalidScientificInputError("stabilizationStopsEquivalent must be finite and greater than or equal to zero.");
  }
  const bias = input.fasterByStops ?? 0;
  if (typeof bias !== "number" || !Number.isInteger(bias) || Math.abs(bias) > AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS) {
    throw new InvalidScientificInputError("fasterByStops must be a whole number of stops from -2 to +2.");
  }
  const budget = parseBudget(input.blurBudget);
  if (input.focusDistanceM !== undefined) requirePositive(input.focusDistanceM, "focusDistanceM");
  if (input.shutterCapability !== undefined) {
    requireInputObject(input.shutterCapability, "shutterCapability");
    const s = input.shutterCapability;
    requirePositive(s.minimumSeconds, "shutterCapability.minimumSeconds");
    requirePositive(s.maximumSeconds, "shutterCapability.maximumSeconds");
    if (s.minimumSeconds > s.maximumSeconds) throw new InvalidScientificInputError("shutterCapability.minimumSeconds must not exceed shutterCapability.maximumSeconds.");
    requireInputObject(s.settingGrid, "shutterCapability.settingGrid");
    if (s.settingGrid.kind === "discrete-values") {
      const values = s.settingGrid.values;
      if (!Array.isArray(values) || values.length === 0 || values.some((v, i) => typeof v !== "number" || !Number.isFinite(v) || v <= 0 || (i > 0 && v <= values[i - 1]!))) {
        throw new InvalidScientificInputError("shutterCapability.settingGrid.values must be strictly increasing positive finite seconds.");
      }
    } else if (s.settingGrid.kind !== "continuous-within-range") {
      throw new InvalidConfigurationError("shutterCapability.settingGrid.kind is invalid.");
    }
  }

  // The projection distance and the residual factor come from the shake model itself (a probe at a tiny time).
  const shake = (shutterSeconds: number): CameraShakeEstimate => estimateCameraShakeBlur({ focalLengthMm, shutterSeconds, angularVelocityRadPerSec: { yaw, pitch },
    stabilizationStopsEquivalent: stops, ...(input.focusDistanceM === undefined ? {} : { focusDistanceM: input.focusDistanceM }),
    ...(budget.pixelPitchMicrometers === undefined ? {} : { pixelPitchMicrometers: budget.pixelPitchMicrometers }) }).value;
  const probe = shake(Number.MIN_VALUE);
  const r = probe.residualMotionFactor, v = probe.projectionDistanceMm;
  const derived = solveShutterForBudget(v, Math.abs(yaw) * r, Math.abs(pitch) * r, budget.budgetMm);
  const biased = derived * 2 ** -bias;
  if (!Number.isFinite(derived) || derived <= 0 || !Number.isFinite(biased) || biased <= 0) {
    throw new InvalidScientificResultError("The derived slowest shutter is not a positive finite time.");
  }
  const snapped = input.shutterCapability === undefined ? undefined : snapNotLonger(biased, input.shutterCapability);
  const shutterSeconds = snapped?.shutterSeconds ?? biased;
  // estimateCameraShakeBlur rejects a quarter turn or more on an axis of the *unstabilized* motion, which
  // a long biased or clamped time with stabilization can reach; the blur there is not reported.
  const quarterTurnSafe = (t: number): boolean => Math.max(Math.abs(yaw), Math.abs(pitch)) * t < Math.PI / 2;
  if (!quarterTurnSafe(derived) || !quarterTurnSafe(shutterSeconds)) {
    throw new InvalidScientificInputError(
      "The shake over the slowest shutter would reach a quarter turn (|angular velocity × shutter| ≥ π/2 rad) before stabilization; the constant-velocity model does not apply.");
  }
  const atDerived = shake(derived).stabilized, atShutter = shake(shutterSeconds).stabilized;

  return approximationResult<AutoIsoSlowestShutterEstimate>({
    derivedShutterSeconds: derived,
    fasterByStops: bias,
    biasedShutterSeconds: biased,
    shutterSeconds,
    shutterResolution: snapped === undefined
      ? { kind: "unconstrained", selectionPolicy: "not-longer-than-target", quantized: false, clamped: false }
      : { kind: snapped.kind, selectionPolicy: "not-longer-than-target", quantized: snapped.quantized, clamped: snapped.clamped },
    blurBudgetMm: budget.budgetMm,
    blurAtDerivedShutterMm: atDerived.distanceMm,
    blurAtShutterMm: atShutter.distanceMm,
    ...(budget.budgetPixels === undefined ? {} : { blurBudgetPixels: budget.budgetPixels, blurAtShutterPixels: atShutter.distancePixels! }),
    projectionDistanceMm: v,
    residualMotionFactor: r,
    angularVelocityRadPerSec: { yaw, pitch },
    stabilizationStopsEquivalent: stops
  }, "camera-shake-blur-budget-slowest-shutter", AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION, [
    "The slowest shutter is the exposure time at which estimateCameraShakeBlur()'s stabilized on-axis blur equals the blur budget",
    "The hand turns the camera at a constant angular velocity during the exposure (a caller-supplied profile)",
    "Stabilization attenuates the angular motion by 2^-stops (educational model, not a CIPA DC-011 rating)",
    "The whole-stop bias multiplies the derived time by 2^-fasterByStops, after the derivation",
    "Snapping to the shutter grid never lengthens the time, so the blur stays within the budget unless held at the body's fastest shutter",
    "The 1/focal-length reciprocal rule is a rule of thumb and is not used",
    "Roll, translation, off-axis field dependence and subject motion are not modelled"
  ]);
}
