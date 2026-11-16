// SPDX-License-Identifier: Apache-2.0

/**
 * Framing through a catalogue lens (#631, #632): the radial mapping between a point on the chart plane and the sensor, as the
 * capture renders it (`src/facade/catalogue-lens-signal.ts`, `src/optics/sensor-environment-query.ts`).
 *
 * - Rectilinear lenses: the thin-lens framing r = v·R/d (the facade's framing since 2.3; the lens's distortion, at most a few per
 *   cent at the corner, is not part of it, as before).
 * - Fisheyes (equisolid angle, r = 2f·sin(θ/2), with the scale f the thin-lens image distance v at the focus distance, as the
 *   environment query uses): a plane point at radius R and distance d is seen at θ = atan(R/d), imaged at the ideal radius
 *   r_i = 2v·sin(θ/2) and displaced by the lens's radial distortion r = r_i·(1 + k1·(r_i/ρ_n)²) (its small departure from the
 *   equisolid projection). Directions at or beyond 90° see no plane.
 * - Focus breathing (#632, opt-in): the field of view changes by Δ = (breathing at minimum focus)·min(1, m/m_max), m the thin-lens
 *   magnification at the focus distance (`resolveGenericLens`'s `breathing.fieldOfViewChange`). It is applied as a change of the
 *   image scale: a ray at field angle θ meets the plane where a thin-lens ray at tan θ' = (1 + Δ)·tan θ would, so the frame spans
 *   (1 + Δ) times the plane it spans without breathing. The irradiance is unchanged (the working f-number is the thin lens's).
 *
 * Every value is an approximation of a generic lens, as the catalogue's.
 */

import type { ResolvedGenericLens } from "./generic-lens-catalogue.js";

/** The breathing scale 1 + Δ of a catalogue lens at a focus distance (m); 1 at infinity. Closer than minimum focus it stays at the minimum-focus value. */
export function genericLensBreathingScale(lens: ResolvedGenericLens, focusDistanceM: number): number {
  const f = lens.focalLengthMm / 1000, maximum = f / (lens.minimumFocusDistanceM - f), m = f / (focusDistanceM - f);
  return 1 + lens.character.breathing.atMinimumFocus * Math.min(1, m / maximum);
}

/** The mapping of one lens at one focus: v the projection distance (mm), d the chart-plane distance (m), k the breathing scale. */
export interface GenericLensFramingMapping {
  fisheye: boolean;
  projectionDistanceMm: number;
  planeDistanceM: number;
  breathingScale: number;
  /** k1 and the normalization radius (mm) of the lens's radial distortion (fisheyes only). */
  k1: number;
  normalizationRadiusMm: number;
}

/** The mapping of a resolved catalogue lens at a projection distance v, plane distance d and breathing scale k. */
export function genericLensFramingMapping(lens: ResolvedGenericLens, projectionDistanceMm: number, planeDistanceM: number, breathingScale: number): GenericLensFramingMapping {
  const profile = lens.character.distortion.profile;
  return { fisheye: lens.projection === "fisheye-equisolid-angle", projectionDistanceMm, planeDistanceM, breathingScale,
    k1: profile.coefficients.k1, normalizationRadiusMm: profile.normalizationRadiusMm };
}

/** The sensor radius (mm) of a plane point at radius R (m) from the axis. */
export function genericLensImageRadiusMm(map: GenericLensFramingMapping, planeRadiusM: number): number {
  const v = map.projectionDistanceMm, tan = planeRadiusM / (map.planeDistanceM * map.breathingScale);
  if (!map.fisheye) return v * tan;
  const ideal = 2 * v * Math.sin(Math.atan(tan) / 2), rho = ideal / map.normalizationRadiusMm;
  return ideal * (1 + map.k1 * rho * rho);
}

/**
 * The plane radius (m) a sensor radius r (mm) sees, and its field angle (degrees, after breathing); both null where the ray sees no
 * plane (a fisheye's sensor point outside its image circle, or at or beyond 90°).
 */
export function genericLensPlaneRadiusM(map: GenericLensFramingMapping, sensorRadiusMm: number): { radiusM: number | null; fieldAngleDegrees: number | null } {
  const v = map.projectionDistanceMm, k = map.breathingScale;
  let tan: number;
  if (!map.fisheye) tan = sensorRadiusMm / v;
  else {
    // Newton's method on r_i·(1 + k1·(r_i/ρ_n)²) = r (monotonic for the catalogue's |k1| ≤ 0.045 over the frame).
    const n = map.normalizationRadiusMm, k1 = map.k1;
    let ideal = sensorRadiusMm;
    for (let i = 0; i < 60; i++) {
      const q = ideal / n, step = (ideal * (1 + k1 * q * q) - sensorRadiusMm) / (1 + 3 * k1 * q * q);
      ideal -= step;
      if (Math.abs(step) <= 4 * Number.EPSILON * Math.max(ideal, 1)) break;
    }
    const s = ideal / (2 * v);
    if (!(s < 1)) return { radiusM: null, fieldAngleDegrees: null };
    const theta = 2 * Math.asin(s);
    if (!(theta < Math.PI / 2)) return { radiusM: null, fieldAngleDegrees: null };
    tan = Math.tan(theta);
  }
  return { radiusM: map.planeDistanceM * k * tan, fieldAngleDegrees: Math.atan(k * tan) * 180 / Math.PI };
}

/**
 * #632: the lattice step of the veiling glare's frame mean: every site on an exact request; on a fast one, every n-th site per axis with
 * n = ⌈√(W·H / 65,536)⌉, so the mean reads at most about 65,536 lattice points.
 */
export function genericLensVeilStep(nativeWidth: number, nativeHeight: number, fast: boolean): number {
  return fast ? Math.max(1, Math.ceil(Math.sqrt(nativeWidth * nativeHeight / 65536))) : 1;
}

/** #631: a fisheye's chart image along the frame's axes (mm), as {@link genericLensImageRadiusMm} gives it (simulateCapture's `result.scene.chart`). */
export function fisheyeChartImageMm(lens: ResolvedGenericLens, imageDistanceMm: number, subjectDistanceM: number, breathingScale: number, chartWidthM: number,
  chartHeightM: number): { width: number; height: number } {
  const map = genericLensFramingMapping(lens, imageDistanceMm, subjectDistanceM, breathingScale);
  return { width: 2 * genericLensImageRadiusMm(map, chartWidthM / 2), height: 2 * genericLensImageRadiusMm(map, chartHeightM / 2) };
}
