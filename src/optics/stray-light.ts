// SPDX-License-Identifier: Apache-2.0

/**
 * Stray light (flare and veiling glare) from bright sources.
 *
 * The profile parser is strict. It checks that the profile stays passive (adds no energy) across the
 * whole range of source angles.
 *
 * The model adds off-path spectral irradiance before the sensor integrates the exposure. It never
 * adds it after tone mapping. Source powers are integrated over profile.referenceEntranceAreaMm2 at
 * one instant and one wavelength. The Gaussian templates are independently parameterized
 * approximations, not ray tracing through a lens prescription.
 * @see docs/DIGITAL_OPTICS_FOUNDATION.md for the equations, units, coordinate conventions, known
 * blockers and support limits.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import {
  choice, finite, list, parseEvidence, parseOpticalProfileState, positive, record,
  requireSameState, textValue, type GenericOpticalEvidence, type OpticalProfileState
} from "./profile-contract.js";
import type { LensFieldPointMm } from "./radial-distortion.js";
import { requireInputKeys } from "../core/record-validation.js";

/** One ghost (reflection path) or veil (broad scatter) response. Its shape is normalized over the infinite image plane. */
export interface ParametricStrayLightResponse {
  id: string;
  kind: "ghost" | "veil";
  /** Centroid response in mm per degree of the two declared source field angles. */
  centroidMmPerDegree: readonly [number, number, number, number];
  offsetMm: LensFieldPointMm;
  sigmaMm: number;
  /** Fraction of source power entering this response at the axis. */
  axisPowerFraction: number;
  /** Power fraction versus angle: F(rho) = F(0) * (1 + slope * rho²), where rho = source angle / maximum angle. */
  angularSlope: number;
}
/** One explicit wavelength and an exact generic camera state. Models clean optics only. */
export interface LensStrayLightProfile {
  schemaVersion: "0.1.0";
  id: string;
  version: string;
  state: OpticalProfileState;
  evidence: GenericOpticalEvidence;
  interaction: "lens-reflections" | "sensor-lens-reflections";
  wavelengthNm: number;
  wavelengthBasis: "air" | "vacuum";
  maximumSourceAngleDegrees: number;
  /** Area over which the caller's incident source power was integrated. */
  referenceEntranceAreaMm2: number;
  responses: readonly ParametricStrayLightResponse[];
}
/** The direction can lie outside the active frame. It is not clipped to the crop. */
export interface StrayLightSource {
  id: string;
  fieldAngleXDegrees: number;
  fieldAngleYDegrees: number;
  incidentSpectralPowerWPerNm: number;
  /** Fraction of this source let in, for example after a flag or hood decision. Not a global hood factor. */
  admittedFraction: number;
}
export interface StrayLightIrradiance {
  profileId: string;
  profileVersion: string;
  interaction: LensStrayLightProfile["interaction"];
  imagePointMm: LensFieldPointMm;
  wavelengthNm: number;
  wavelengthBasis: "air" | "vacuum";
  timeSeconds: number;
  primarySpectralIrradianceWPerM2PerNm: number;
  ghostSpectralIrradianceWPerM2PerNm: number;
  veilSpectralIrradianceWPerM2PerNm: number;
  totalSpectralIrradianceWPerM2PerNm: number;
  /** If primary-only, the meter leaves these additions out. The sensor always receives the total. */
  meterDomain: "primary-only" | "primary-plus-stray";
  meterSpectralIrradianceWPerM2PerNm: number;
  contributions: readonly { sourceId: string; responseId: string; kind: "ghost" | "veil"; spectralIrradianceWPerM2PerNm: number }[];
}
function fraction(value: unknown, name: string): number {
  const n = finite(value, name);
  if (n < 0 || n > 1) throw new InvalidScientificInputError(`${name} must lie in [0,1].`);
  return n;
}
export function point(value: unknown): LensFieldPointMm {
  const p = record(value, ["x", "y"]); return { x: finite(p.x, "x"), y: finite(p.y, "y") };
}
/** Strict generic profile parser. Checks that the profile adds no energy at any source angle in its range. */
export function parseLensStrayLightProfile(value: unknown): LensStrayLightProfile {
  const r = record(value, ["schemaVersion", "id", "version", "state", "evidence", "interaction",
    "wavelengthNm", "wavelengthBasis", "maximumSourceAngleDegrees", "referenceEntranceAreaMm2", "responses"]);
  const responses = list(r.responses, 32).map((value): ParametricStrayLightResponse => {
    const s = record(value, ["id", "kind", "centroidMmPerDegree", "offsetMm", "sigmaMm", "axisPowerFraction", "angularSlope"]);
    const matrix = list(s.centroidMmPerDegree, 4).map((v) => finite(v, "centroid coefficient"));
    if (matrix.length !== 4) throw new InvalidScientificInputError("Centroid matrix requires four entries.");
    const slope = finite(s.angularSlope, "angularSlope");
    if (slope < -1) throw new InvalidScientificInputError("Angular response must be nonnegative.");
    return { id: textValue(s.id), kind: choice(s.kind, ["ghost", "veil"]),
      centroidMmPerDegree: matrix as [number, number, number, number], offsetMm: point(s.offsetMm),
      sigmaMm: positive(s.sigmaMm, "sigmaMm"), axisPowerFraction: fraction(s.axisPowerFraction, "axisPowerFraction"), angularSlope: slope };
  });
  if (new Set(responses.map((s) => s.id)).size !== responses.length ||
      responses.reduce((sum, s) => sum+s.axisPowerFraction, 0) > 1 ||
      responses.reduce((sum, s) => sum+s.axisPowerFraction*(1+s.angularSlope), 0) > 1) {
    throw new InvalidScientificInputError("Duplicate response or nonpassive total response.");
  }
  const maximum = positive(r.maximumSourceAngleDegrees, "maximumSourceAngleDegrees");
  if (maximum >= 90) throw new InvalidScientificInputError("Source angular domain must be below 90 degrees.");
  return { schemaVersion: choice(r.schemaVersion, ["0.1.0"]), id: textValue(r.id), version: textValue(r.version),
    state: parseOpticalProfileState(r.state), evidence: parseEvidence(r.evidence),
    interaction: choice(r.interaction, ["lens-reflections", "sensor-lens-reflections"]),
    wavelengthNm: positive(r.wavelengthNm, "wavelengthNm"), wavelengthBasis: choice(r.wavelengthBasis, ["air", "vacuum"]),
    maximumSourceAngleDegrees: maximum, referenceEntranceAreaMm2: positive(r.referenceEntranceAreaMm2, "referenceEntranceAreaMm2"), responses };
}

/** Adds off-path spectral irradiance before the sensor integrates the exposure, never after tone mapping.
 * Source powers are integrated over profile.referenceEntranceAreaMm2 at this instant and wavelength.
 * The Gaussian templates are independently parameterized approximations, not ray tracing through a
 * lens prescription.
 */
export function calculateLensStrayLightIrradiance(input: {
  profile: LensStrayLightProfile; state: OpticalProfileState; enabled: boolean;
  imagePointMm: LensFieldPointMm; wavelengthNm: number; wavelengthBasis: "air" | "vacuum";
  timeSeconds: number; primarySpectralIrradianceWPerM2PerNm: number;
  sources: readonly StrayLightSource[]; meterDomain: "primary-only" | "primary-plus-stray";
}): CalculationResult<StrayLightIrradiance> {
  requireInputKeys(input, "calculateLensStrayLightIrradiance", ["profile", "state", "enabled", "imagePointMm", "wavelengthNm", "wavelengthBasis", "timeSeconds", "primarySpectralIrradianceWPerM2PerNm", "sources", "meterDomain"]);
  const profile = parseLensStrayLightProfile(input.profile);
  requireSameState(profile.state, input.state);
  const p = point(input.imagePointMm), time = finite(input.timeSeconds, "timeSeconds");
  const primary = finite(input.primarySpectralIrradianceWPerM2PerNm, "primary irradiance");
  if (time < 0 || primary < 0 || typeof input.enabled !== "boolean") throw new InvalidScientificInputError("Invalid time, primary irradiance or enabled state.");
  if (input.wavelengthNm !== profile.wavelengthNm || input.wavelengthBasis !== profile.wavelengthBasis) {
    throw new InvalidScientificInputError("Wavelength/basis mismatch; select an explicit profile slice.");
  }
  const meter = choice(input.meterDomain, ["primary-only", "primary-plus-stray"]);
  const sources = list(input.sources, 128).map((value): StrayLightSource => {
    const s = record(value, ["id", "fieldAngleXDegrees", "fieldAngleYDegrees", "incidentSpectralPowerWPerNm", "admittedFraction"]);
    const x = finite(s.fieldAngleXDegrees, "source angle X"), y = finite(s.fieldAngleYDegrees, "source angle Y");
    const power = finite(s.incidentSpectralPowerWPerNm, "source power");
    if (Math.hypot(x, y) > profile.maximumSourceAngleDegrees || power < 0) throw new InvalidScientificInputError("Source outside profile domain or negative power.");
    return { id: textValue(s.id), fieldAngleXDegrees: x, fieldAngleYDegrees: y,
      incidentSpectralPowerWPerNm: power, admittedFraction: fraction(s.admittedFraction, "admittedFraction") };
  });
  if (new Set(sources.map((s) => s.id)).size !== sources.length) throw new InvalidScientificInputError("Duplicate source IDs.");
  const contributions: StrayLightIrradiance["contributions"][number][] = [];
  let ghost = 0, veil = 0;
  if (input.enabled) for (const s of sources) for (const r of profile.responses) {
    const m = r.centroidMmPerDegree;
    const center = { x: m[0]*s.fieldAngleXDegrees+m[1]*s.fieldAngleYDegrees+r.offsetMm.x,
      y: m[2]*s.fieldAngleXDegrees+m[3]*s.fieldAngleYDegrees+r.offsetMm.y };
    const rho = Math.hypot(s.fieldAngleXDegrees, s.fieldAngleYDegrees)/profile.maximumSourceAngleDegrees;
    const response = r.axisPowerFraction*(1+r.angularSlope*rho*rho);
    // Infinite-plane unit-integral density in 1/mm², converted to 1/m².
    const densityPerM2 = Math.exp(-((p.x-center.x)**2+(p.y-center.y)**2)/(2*r.sigmaMm**2))/(2*Math.PI*r.sigmaMm**2)*1e6;
    const irradiance = s.incidentSpectralPowerWPerNm*s.admittedFraction*response*densityPerM2;
    contributions.push({ sourceId: s.id, responseId: r.id, kind: r.kind, spectralIrradianceWPerM2PerNm: irradiance });
    if (r.kind === "ghost") ghost += irradiance; else veil += irradiance;
  }
  const total = primary+ghost+veil;
  return approximationResult({ profileId: profile.id, profileVersion: profile.version, interaction: profile.interaction,
    imagePointMm: p, wavelengthNm: profile.wavelengthNm, wavelengthBasis: profile.wavelengthBasis,
    timeSeconds: time, primarySpectralIrradianceWPerM2PerNm: primary, ghostSpectralIrradianceWPerM2PerNm: ghost,
    veilSpectralIrradianceWPerM2PerNm: veil, totalSpectralIrradianceWPerM2PerNm: total,
    meterDomain: meter, meterSpectralIrradianceWPerM2PerNm: meter === "primary-only" ? primary : total, contributions },
  "parametric-clean-lens-stray-light", "0.1.0", [profile.evidence.basis, profile.evidence.residualNote,
    "Additive pre-sensor irradiance; exposure, saturation and noise remain downstream",
    "No diffraction, primary PSF, contamination, cosmetic sprites or calibrated branded signature",
    "One instant and one wavelength slice; no implicit temporal or spectral averaging"]);
}
