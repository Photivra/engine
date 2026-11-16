// SPDX-License-Identifier: Apache-2.0

/**
 * The frame a capture renders on a sensor profile (#554, #636): with a catalogue lens the lens is resolved on the profile's whole
 * sensor and the capture is its centred frame of the output's aspect (default pitch min(W/w, H/h); an explicit pitch gives a centred
 * crop); otherwise the frame is output × pitch (the profile's pitch or an explicit one). A site of the frame sums
 * N = (pitch / photosite pitch)² photosites, whose read noise adds in quadrature (×√N; below one photosite it is kept).
 * `simulateCapture` reports this record as the `sensor.profileView` assumption, and the framing helpers take the same frame.
 * @see docs/SENSOR_PROFILES.md, "Catalogue lenses on a profile's sensor".
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireConfigPositiveSafeInteger, requireInputKeys, requireInputObject, requireInputPositiveFinite } from "../core/record-validation.js";
import { parseSensorProfile, type SensorProfile } from "./sensor-profile-record.js";

/** The frame of an output on a sensor profile (`sensor.profileView`). */
export interface SensorProfileFrame {
  sensorWidthMm: number; sensorHeightMm: number;
  /** The rendered frame, output × pitch, mm. */
  frameWidthMm: number; frameHeightMm: number;
  pixelPitchMicrometers: number;
  /** With the lens framed on the sensor: the sensor axis the output's aspect crops ("none" when it fills both); null otherwise. */
  croppedSensorAxis: "width" | "height" | "none" | null;
  /** N = (pitch / photosite pitch)²: the photosites one rendered site sums. */
  photositesPerSite: number;
  /** √max(1, N), the read noise's factor. */
  readNoiseScale: number;
  /** True with a catalogue lens: the lens is resolved on the whole sensor. */
  lensFramedOnSensor: boolean;
}

/** @internal The frame of a width × height output (validated by the caller) on a profile; `explicitPitch` a number or undefined. */
export function sensorProfileFrame(profile: Pick<SensorProfile, "sensorWidthMm" | "sensorHeightMm" | "pixelPitchMicrometers">, width: number, height: number,
  explicitPitch: unknown, lensFramedOnSensor: boolean): SensorProfileFrame {
  const W = profile.sensorWidthMm, H = profile.sensorHeightMm, given = typeof explicitPitch === "number";
  const pitch = given ? explicitPitch as number : lensFramedOnSensor ? Math.min(W / width, H / height) * 1000 : profile.pixelPitchMicrometers;
  if (lensFramedOnSensor && (width * pitch > W * 1000 * (1 + 1e-9) || height * pitch > H * 1000 * (1 + 1e-9)))
    throw new InvalidConfigurationError("sensor.pixelPitchMicrometers makes the frame larger than the profile's sensor.");
  const sites = (pitch / profile.pixelPitchMicrometers) ** 2;
  return { sensorWidthMm: W, sensorHeightMm: H, frameWidthMm: width * pitch / 1000, frameHeightMm: height * pitch / 1000, pixelPitchMicrometers: pitch,
    croppedSensorAxis: lensFramedOnSensor ? (width * pitch < W * 1000 * (1 - 1e-9) ? "width" : height * pitch < H * 1000 * (1 - 1e-9) ? "height" : "none") : null,
    photositesPerSite: sites, readNoiseScale: Math.sqrt(Math.max(1, sites)), lensFramedOnSensor };
}

/** #636: the input of {@link calculateSensorProfileFrame}: a capture's `sensor.profile`, output size, `sensor.pixelPitchMicrometers` and lens kind. */
export interface CalculateSensorProfileFrameInput {
  /** A sensor profile record (`SENSOR_PROFILES`, `resolveSensorProfile(id)` or a caller's copy), checked as a capture checks it. */
  profile: SensorProfile;
  /** The output's width and height, pixels (`output.width`, `output.height`). */
  width: number; height: number;
  /** `sensor.pixelPitchMicrometers`, µm; default as in a capture (see {@link SensorProfileFrame}). */
  pixelPitchMicrometers?: number;
  /** True for a catalogue lens (`lens.catalogue`), which is framed on the profile's whole sensor. Default false. */
  catalogueLens?: boolean;
}

/**
 * #636: the frame `simulateCapture` renders for a sensor profile, an output size and a lens kind, the same record as its
 * `sensor.profileView` assumption: before a capture, for example to show a phone lens's frame and pitch or to pass the frame to the
 * framing helpers (which also take the profile directly, `sensorProfile`).
 */
export function calculateSensorProfileFrame(input: CalculateSensorProfileFrameInput): CalculationResult<SensorProfileFrame> {
  requireInputObject(input, "calculateSensorProfileFrame input");
  requireInputKeys(input, "calculateSensorProfileFrame", ["profile", "width", "height", "pixelPitchMicrometers", "catalogueLens"]);
  if (input.catalogueLens !== undefined && typeof input.catalogueLens !== "boolean") throw new InvalidConfigurationError("catalogueLens must be a boolean.");
  return calculatedResult(resolveProfileFrame(input, input.catalogueLens === true), "sensor-profile-frame", "1.0.0", [
    "The frame simulateCapture renders on the profile (sensor.profileView): with a catalogue lens, the centred region of the output's aspect on the whole sensor; otherwise output × pitch.",
    "A site of N = (pitch / photosite pitch)² photosites sums their charge and their read noise in quadrature (×√N): a downsized view, not the sensor's own pixels."]);
}

/** @internal The checked profile input of the frame calculators (`profile`, `width`, `height`, `pixelPitchMicrometers`). */
export function resolveProfileFrame(input: { profile: unknown; width: unknown; height: unknown; pixelPitchMicrometers?: unknown }, catalogueLens: boolean): SensorProfileFrame {
  const profile = parseSensorProfile(input.profile, "profile");
  const width = requireConfigPositiveSafeInteger(input.width, "width"), height = requireConfigPositiveSafeInteger(input.height, "height");
  const pitch = input.pixelPitchMicrometers === undefined ? undefined : requireInputPositiveFinite(input.pixelPitchMicrometers, "pixelPitchMicrometers");
  return sensorProfileFrame(profile, width, height, pitch, catalogueLens);
}
