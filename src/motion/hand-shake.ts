// SPDX-License-Identifier: Apache-2.0

/**
 * #641: a bounded, seeded hand-shake trajectory: the camera's angular displacement while it is held in the hand, for
 * `simulateCapture`'s `motion.handheld`. A labelled approximation of a generic photographer, not a measurement of anyone.
 *
 * The model. On pitch and yaw each, the displacement from the exposure start is a sum of sinusoids,
 *   θ(t) = Σ_k a_k·(sin 2π(f_k·t + φ_k) − sin 2πφ_k),   so θ(0) = 0 and |θ(t)| ≤ 2·Σ_k a_k for every t (the bound),
 * with four sway components near 0.7, 1.4, 2.8 and 5.6 Hz (each jittered by up to a quarter octave) and one physiological-tremor
 * component between 8 and 12 Hz. The seed draws the jitters, the tremor frequency and the phases φ_k (a deterministic xorshift32
 * stream, `createDeterministicUniformStream`), so one seed gives one trajectory on every platform (the sines are
 * `portableSinTwoPi`). Roll is zero. The amplitudes give each axis an RMS angular velocity of 4.39/√2 °/s (4.39 °/s in magnitude,
 * averaged over the phases), split over the components as 35 %, 30 %, 20 %, 8 % and 7 % of its variance: a_k = √(2·s_k)·v/(2π·f_k).
 *
 * Over the phases the RMS displacement after τ seconds is √(Σ a_k²·(1 − cos 2πf_k·τ)) per axis: v·τ for short exposures (within
 * about 10 % up to 100 ms), then it levels off near √(Σ a_k²) over both axes (0.94°–1.05° for seeds 0–3 and 42; the largest
 * |θ| over 30 s 1.5°–1.9°), instead of growing without bound as a constant rotation does (132° in 30 s at 4.39 °/s).
 *
 * The evidence (all free to read):
 * - Short exposures: camera motion "can be approximated as a linear motion at 4.39 °/sec when an average user holds a typical 100g
 *   mobile handset with two hands" (F. Xiao, J. Farrell, P. Catrysse, B. Wandell, "Mobile imaging: the big challenge of the small
 *   pixel", Proc. SPIE 7250, 2009, §2, from their gyroscope measurements in Proc. SPIE 6502, 2007, which found the linear
 *   approximation good below about 100 ms). The same rate is the engine's `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`.
 * - Axes: hand shake has six components, but at shooting distances of about 20 focal lengths yaw and pitch dominate and the others
 *   "can be practically negligible"; its frequencies and amplitudes differ with the camera's mass (CIPA DC-X011-2014, the
 *   public translation of CIPA's image-stabilization standard, §3-3-4 and §6-3).
 * - Frequency content: normal physiological tremor has its central component at 8–12 Hz (J. H. McAuley, C. D. Marsden,
 *   "Physiological and pathological tremors and rhythmic central motor control", Brain 123, 1545–1567, 2000); the larger, slower
 *   sway below it is what the sway components stand for.
 * - Boundedness: handheld 1/3 s exposures recorded with a 500 Hz motion-capture system (six people, a compact camera; R. Köhler,
 *   M. Hirsch, B. Mohler, B. Schölkopf, S. Harmeling, "Recording and playback of camera shake", ECCV 2012, §3) show rotations of a
 *   few tenths of a degree (their Fig. 2 example stays within about −0.2° to +0.3°), not the 1.5° a constant 4.39 °/s turns in that
 *   time. The model keeps Xiao's rate (a phone held in two hands) so that it agrees with the engine's generic default, so its 1/3 s
 *   RMS displacement (about 1°) is larger than that compact-camera example.
 * What is not measured: the split of the variance over the components, their frequencies within the bands and the level the
 * displacement settles at are modelling choices that meet the points above; a heavier camera, another grip or another person moves
 * differently. Stabilization scales the trajectory by 2^−stops (the engine's convention, `estimateCameraShakeBlur`); in the linear
 * regime that is CIPA's definition (the same blur at a 2^stops longer exposure, DC-X011-2014 §4-5), beyond it an approximation.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { rejectUnknownFields, requireInputKeys } from "../core/record-validation.js";
import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { portableCosTwoPi, portableExp2, portableSinTwoPi } from "../core/portable-math.js";
import { createDeterministicUniformStream } from "../sensor/stochastic-seed.js";

export const HAND_SHAKE_MODEL_VERSION = "1.0.0" as const;

/** The RMS angular-velocity magnitude of the unstabilized trajectory, rad/s: 4.39 °/s (Xiao et al. 2009). */
export const HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC = (4.39 * Math.PI) / 180;

/** The largest `stabilizationStops` accepted. */
export const HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS = 10;

/** The sway bands' nominal frequencies (Hz) and each component's share of an axis's velocity variance; the last share is the tremor's. */
const SWAY_HZ = [0.7, 1.4, 2.8, 5.6], SHARES = [0.35, 0.3, 0.2, 0.08, 0.07];

export interface HandShakeOptions {
  /** The trajectory's seed, an integer 0 … 2³² − 1. Default 0. */
  seed?: number;
  /** Stabilization in stops, 0 … 10: the trajectory is scaled by 2^−stops. Default 0 (none). */
  stabilizationStops?: number;
}

/** One sinusoid of the trajectory: a·(sin 2π(f·t + φ) − sin 2πφ) on its axis. */
export interface HandShakeComponent {
  axis: "pitch" | "yaw";
  amplitudeRad: number;
  frequencyHz: number;
  phaseTurns: number;
}

export interface HandShakeTrajectory {
  modelVersion: typeof HAND_SHAKE_MODEL_VERSION;
  seed: number;
  stabilizationStops: number;
  /** 2^−stops, applied to every amplitude. */
  scale: number;
  components: readonly HandShakeComponent[];
  /** |θ(t)| on each axis never exceeds this, at any t: 2·Σ a_k over the axis's components (rad). */
  boundRad: { pitch: number; yaw: number };
}

/** Builds the trajectory of a seed and a stabilization (see the module comment). */
export function createHandShakeTrajectory(options: HandShakeOptions = {}): HandShakeTrajectory {
  requireInputKeys(options, "createHandShakeTrajectory", ["seed", "stabilizationStops"]);
  return handShakeTrajectoryOf(options);
}

function handShakeTrajectoryOf(options: HandShakeOptions): HandShakeTrajectory {
  // #786: null is refused, not read as omitted.
  const seed = options.seed === undefined ? 0 : options.seed, stops = options.stabilizationStops === undefined ? 0 : options.stabilizationStops;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new InvalidConfigurationError("motion.handheld.seed must be an integer from 0 to 4294967295.");
  if (typeof stops !== "number" || !(stops >= 0 && stops <= HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS))
    throw new InvalidConfigurationError("motion.handheld.stabilizationStops must be a number from 0 to " + HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS + ".");
  const random = createDeterministicUniformStream(seed), scale = portableExp2(-stops), v = HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC / Math.SQRT2;
  const components: HandShakeComponent[] = [], boundRad = { pitch: 0, yaw: 0 };
  for (const axis of ["pitch", "yaw"] as const) SHARES.forEach((share, k) => {
    const u = random.next(), frequencyHz = k < 4 ? SWAY_HZ[k]! * portableExp2((u - 0.5) / 2) : 8 + 4 * u;
    const amplitudeRad = scale * Math.sqrt(2 * share) * v / (2 * Math.PI * frequencyHz);
    components.push({ axis, amplitudeRad, frequencyHz, phaseTurns: random.next() });
    boundRad[axis] += 2 * amplitudeRad;
  });
  return { modelVersion: HAND_SHAKE_MODEL_VERSION, seed, stabilizationStops: stops, scale, components, boundRad };
}

/** Input of {@link calculateHandShakeAngularDisplacement} and {@link calculateHandShakeRmsDisplacement}. */
export interface CalculateHandShakeInput {
  /** A trajectory from {@link createHandShakeTrajectory}. */
  trajectory: HandShakeTrajectory;
  /** Seconds from the exposure start (≥ 0). */
  timeSeconds: number;
}

/** Checks a caller's trajectory record and time (the components' axes, finite amplitudes, frequencies and phases). */
function checkedInput(input: CalculateHandShakeInput, name: string): CalculateHandShakeInput {
  requireInputKeys(input, name, ["trajectory", "timeSeconds"]);
  const components = (input.trajectory as Partial<HandShakeTrajectory> | null)?.components;
  if (!Array.isArray(components) || !components.every((c: HandShakeComponent | null) => c !== null && typeof c === "object" && (c.axis === "pitch" || c.axis === "yaw") &&
    [c.amplitudeRad, c.frequencyHz, c.phaseTurns].every((v) => typeof v === "number" && Number.isFinite(v))))
    throw new InvalidConfigurationError(name + ": trajectory must be a hand-shake trajectory (createHandShakeTrajectory).");
  if (typeof input.timeSeconds !== "number" || !(input.timeSeconds >= 0 && input.timeSeconds < Infinity)) throw new InvalidConfigurationError(name + ": timeSeconds must be a finite number ≥ 0.");
  return input;
}

/** The camera's angular displacement at t seconds from the exposure start (rad; pitch, yaw, roll as `motion.angularVelocityRadPerSec`). */
export function calculateHandShakeAngularDisplacement(input: CalculateHandShakeInput): CalculationResult<{ pitch: number; yaw: number; roll: number }> {
  const { trajectory, timeSeconds } = checkedInput(input, "calculateHandShakeAngularDisplacement");
  return approximationResult(handShakeDisplacement(trajectory, timeSeconds), "hand-shake-trajectory", HAND_SHAKE_MODEL_VERSION, HAND_SHAKE_LIMITATIONS);
}

/**
 * The RMS displacement magnitude (rad) after `timeSeconds`, over the phases: √(Σ a_k²·(1 − cos 2πf_k·τ)) summed over both axes, the
 * trajectory's frequencies and amplitudes kept. It grows as the RMS velocity times τ at first and levels off.
 */
export function calculateHandShakeRmsDisplacement(input: CalculateHandShakeInput): CalculationResult<{ rmsDisplacementRad: number }> {
  const { trajectory, timeSeconds } = checkedInput(input, "calculateHandShakeRmsDisplacement");
  return approximationResult({ rmsDisplacementRad: handShakeRms(trajectory, timeSeconds) }, "hand-shake-trajectory", HAND_SHAKE_MODEL_VERSION, HAND_SHAKE_LIMITATIONS);
}

const HAND_SHAKE_LIMITATIONS = ["A generic hand-shake model (sway and tremor sinusoids, 4.39 °/s RMS), not a measurement of a person or a camera; see src/motion/hand-shake.ts."];

/** @internal θ(t) without input checks. */
export function handShakeDisplacement(trajectory: HandShakeTrajectory, timeSeconds: number): { pitch: number; yaw: number; roll: number } {
  const d = { pitch: 0, yaw: 0, roll: 0 };
  for (const c of trajectory.components) d[c.axis] += c.amplitudeRad * (portableSinTwoPi(c.frequencyHz * timeSeconds + c.phaseTurns) - portableSinTwoPi(c.phaseTurns));
  return d;
}

/** @internal The phase-averaged RMS displacement without input checks. */
export function handShakeRms(trajectory: HandShakeTrajectory, seconds: number): number {
  let sum = 0;
  for (const c of trajectory.components) sum += c.amplitudeRad * c.amplitudeRad * (1 - portableCosTwoPi(c.frequencyHz * seconds));
  return Math.sqrt(sum);
}

/** @internal The components as the flat quadruples `shakenAngularVelocity` reads (axis 0 pitch, 1 yaw). */
export function handShakeQuadruples(trajectory: HandShakeTrajectory): number[] {
  return trajectory.components.flatMap((c) => [c.axis === "pitch" ? 0 : 1, c.amplitudeRad, c.frequencyHz, c.phaseTurns]);
}

/** @internal `simulateCapture`'s `motion.handheld` record (opt-in kit): its keys checked, then the trajectory. */
export function resolveHandShake(value: unknown): HandShakeTrajectory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidConfigurationError("motion.handheld must be a record.");
  rejectUnknownFields(value, ["seed", "stabilizationStops"], "motion.handheld");
  return handShakeTrajectoryOf(value as HandShakeOptions);
}

/** @internal The `motion.handheld` assumption of a capture of `shutterSeconds` (opt-in kit). */
export function handShakeAssumption(assume: (id: string, kind: "model", value: unknown, explanation: string) => void, trajectory: HandShakeTrajectory, shutterSeconds: number): void {
  const degrees = (rad: number): number => rad * 180 / Math.PI;
  assume("motion.handheld", "model", { modelVersion: trajectory.modelVersion, seed: trajectory.seed, stabilizationStops: trajectory.stabilizationStops,
    boundDegrees: { pitch: degrees(trajectory.boundRad.pitch), yaw: degrees(trajectory.boundRad.yaw) },
    rmsDisplacementDegreesOverExposure: degrees(handShakeRms(trajectory, shutterSeconds)),
    components: trajectory.components.map((c) => ({ ...c })) },
  "Hand shake (#641): a bounded, seeded pitch and yaw trajectory in the camera rotation; sway 0.7–5.6 Hz, tremor 8–12 Hz, 4.39 °/s RMS " +
    "(Xiao et al. 2009) × 2^−stabilizationStops. A generic approximation.");
}
