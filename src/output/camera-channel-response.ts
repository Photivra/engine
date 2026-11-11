// SPDX-License-Identifier: Apache-2.0

/**
 * #591: a camera's channel response on the capture's own spectral grid, and optionally each channel's effective dispersion under
 * an illuminant, for the calculator's colour-fringe numbers (`calculateLateralColorFringe`'s `channelDispersion`). Pure, and not
 * imported by `simulateCapture` or the capture worker.
 *
 * Every camera of the facade (every tier body and every `SensorProfile`) has the same synthetic colorimetric response shape
 * (simulate-capture.ts, "Synthetic colorimetric sensor"): EQE_c(λ) = a_c·cmf_c(λ)·(555 nm/λ)·q with cmf = x̄, ȳ, z̄ (the engine's CIE
 * 1931 fit), a = 0.5, 0.5, 0.25 for red, green and blue, and q the peak-quantum-efficiency scale (1 for a tier body, the profile's
 * peak QE / 0.5 for a profile, or the explicit `peakQuantumEfficiency` / 0.5). The capture samples EQE at breakpoints 380 + kΔ nm,
 * Δ = 400 / ⌈400 / step⌉, and integrates with the midpoint rule over 380–780 nm, so EQE at a node is the mean of its two
 * breakpoints (linear interpolation). Electrons per joule of incident light at λ are EQE(λ)·λ/(h·c) (photon energy h·c/λ; CODATA
 * exact h and c; vacuum wavelength, where the capture converts air to vacuum with the air's phase index, a factor that is
 * constant to about 1e-6 and cancels in the dispersion).
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { estimateCie1931ColorMatchingFunctions } from "../color/color-matching-functions.js";
import { resolveSensorProfile } from "../equipment/sensor-profiles.js";
import { parseSensorProfile, type SensorProfile } from "../equipment/sensor-profile-body.js";
import { resolveCaptureIlluminant, FACADE_SPECTRAL_RANGE_NANOMETERS, type CaptureIlluminant } from "../facade/scene-radiance.js";
import { channelEffectiveDispersion, type ChannelDispersion } from "./developed-lens-corrections.js";

export interface CalculateCameraChannelResponseInput {
  /** The capture's `sensor.profile` record, or a `SENSOR_PROFILE_IDS` id. Omitted: a tier body (peak QE 0.5). */
  sensorProfile?: SensorProfile | string;
  /** Peak quantum efficiency in (0, 1] (as `sensor.peakQuantumEfficiency`); wins over the profile's. */
  peakQuantumEfficiency?: number;
  /**
   * The capture's `sensor.spectralStepNanometers`, 1–100. Default 5: the calculator runs at full quality, and a spiky light
   * needs the fine grid. Pass the capture's step to reproduce a capture's channels.
   */
  spectralStepNanometers?: number;
  /** A `simulateCapture` illuminant: when given, the result also carries each channel's effective dispersion under it. */
  illuminant?: CaptureIlluminant;
}

export interface CameraChannelResponse {
  /** The capture's midpoint nodes, nm, increasing. */
  wavelengthsNm: number[];
  /** Electrons per joule of incident light at each node, per channel: EQE_c(λ)·λ/(h·c). */
  red: number[];
  green: number[];
  blue: number[];
  /** With `illuminant`: D̄_c, as `calculateChannelEffectiveDispersion` returns for these channels; else null. */
  channelDispersion: ChannelDispersion | null;
}

const EQE_SCALE = [0.5, 0.5, 0.25] as const, CMF_KEY = ["x", "y", "z"] as const;
const PLANCK_JOULE_SECONDS = 6.62607015e-34, LIGHT_METERS_PER_SECOND = 299_792_458;

/**
 * #591: the camera's channel response on its spectral grid and, with `illuminant`, each channel's effective dispersion (pass it
 * as `channelDispersion` to `calculateLateralColorFringe` or `createGenericLensCorrectionProfile`). Strict input. A labelled
 * approximation: the facade's synthetic colorimetric sensor, not a measured one.
 */
export function calculateCameraChannelResponse(input: CalculateCameraChannelResponseInput = {}): CalculationResult<CameraChannelResponse> {
  requireInputObject(input, "calculateCameraChannelResponse input");
  requireInputKeys(input, "calculateCameraChannelResponse", ["sensorProfile", "peakQuantumEfficiency", "spectralStepNanometers", "illuminant"]);
  const step = input.spectralStepNanometers ?? 5;
  if (typeof step !== "number" || !(step >= 1 && step <= 100)) throw new InvalidScientificInputError("spectralStepNanometers must be a number from 1 to 100.");
  const profile = input.sensorProfile;
  let peak = profile === undefined ? 0.5 : (typeof profile === "string" ? resolveSensorProfile(profile) : parseSensorProfile(profile, "sensorProfile")).peakQuantumEfficiency;
  if (input.peakQuantumEfficiency !== undefined) {
    if (typeof input.peakQuantumEfficiency !== "number" || !(input.peakQuantumEfficiency > 0 && input.peakQuantumEfficiency <= 1)) throw new InvalidScientificInputError("peakQuantumEfficiency must be in (0, 1].");
    peak = input.peakQuantumEfficiency;
  }
  const q = peak / 0.5, { minimum, maximum } = FACADE_SPECTRAL_RANGE_NANOMETERS, count = Math.ceil((maximum - minimum) / step), spacing = (maximum - minimum) / count;
  const eqe = (c: number, nm: number): number => EQE_SCALE[c]! * estimateCie1931ColorMatchingFunctions(nm)[CMF_KEY[c]!] * 555 / nm * q;
  const wavelengthsNm: number[] = [], channels: number[][] = [[], [], []];
  for (let k = 0; k < count; k++) {
    const lo = minimum + k * spacing, hi = minimum + (k + 1) * spacing, nm = (lo + hi) / 2;
    wavelengthsNm.push(nm);
    for (let c = 0; c < 3; c++) channels[c]!.push((eqe(c, lo) + eqe(c, hi)) / 2 * nm * 1e-9 / (PLANCK_JOULE_SECONDS * LIGHT_METERS_PER_SECOND));
  }
  let channelDispersion: ChannelDispersion | null = null;
  if (input.illuminant !== undefined) {
    const shape = resolveCaptureIlluminant(input.illuminant).shape;
    const light = wavelengthsNm.map((nm) => shape.evaluate(nm));
    if (channels.some((r) => !(r.reduce((sum, v, n) => sum + v * light[n]!, 0) > 0))) throw new InvalidScientificInputError("Every channel needs a positive response under the illuminant.");
    channelDispersion = channelEffectiveDispersion(wavelengthsNm, channels, light);
  }
  return approximationResult({ wavelengthsNm, red: channels[0]!, green: channels[1]!, blue: channels[2]!, channelDispersion }, "camera-channel-response", "1.0.0", [
    "The facade's synthetic colorimetric sensor: EQE_c(λ) = a_c·cmf_c(λ)·(555 nm/λ)·(peak QE / 0.5), the capture's own channels.",
    "Midpoint nodes over 380–780 nm at the capture's spectral step; EQE at a node is the mean of its two breakpoints.",
    "Vacuum photon energy h·c/λ; the capture's air-to-vacuum factor is constant to about 1e-6 and cancels in the dispersion."]);
}
