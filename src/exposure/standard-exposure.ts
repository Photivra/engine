// SPDX-License-Identifier: Apache-2.0

/**
 * The engine's standard exposure, shared by `simulateCapture` (its exposure anchor, meter and deviation reports) and the
 * standalone exposure helpers (#614, #616), so that both use the same arithmetic.
 *
 * - Standard output sensitivity S = 10 / H (CIPA DC-004-2020 §3.2): the standard focal-plane exposure is H = 10/S lx·s.
 * - Camera equation H = 0.65·L·t/N² (CIPA DC-004-2020 §5.5 (4); 0.65 = τ·π/4 with τ = 0.828, Explanation 4).
 * - Together: the scene luminance that settings (N, t, S) expose at the standard exposure is L = 10·N²/(0.65·t·S), and
 *   the exposure value of the settings at ISO S is EV = log2(N²/t) = log2(0.065·L·S).
 * - An 18 % Lambertian grey card under illuminance E has luminance L = 0.18·E/π (DC-004 ties the SOS reference level to
 *   an 18 % grey, Explanation 1 and 2.2).
 *
 * CIPA DC-004-2020 is freely downloadable from the CIPA web site.
 * @see docs/USAGE.md, "Exposure helpers (#616)".
 */

/** Standard output sensitivity S = 10 / H (CIPA DC-004-2020 §3.2): the reference exposure in lx·s is 10 / S. */
export const SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS = 10;
/** Camera equation H = 0.65·L·t/N² (CIPA DC-004-2020 §5.5 (4); 0.65 = τ·π/4 with τ = 0.828, Explanation 4). */
export const CAMERA_EQUATION_CONSTANT = 0.65;
/** Neutral reference reflectance: DC-004 ties the SOS reference level to an 18 % grey (Explanation 1 and 2.2). */
export const GREY_CARD_REFLECTANCE = 0.18;

/** Scene luminance (cd/m²) whose focal-plane exposure 0.65·L·t/N² equals the SOS reference exposure 10/S. */
export function sosReferenceLuminance(fNumber: number, shutterSeconds: number, iso: number): number {
  return SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS * fNumber ** 2 / (CAMERA_EQUATION_CONSTANT * shutterSeconds * iso);
}

/** EV at ISO 100 of the standard exposure for luminance L: log2(N²/t) with N²/t = 0.065·L·100 (the inverse of {@link sosReferenceLuminance}). */
export function standardExposureValue100(luminanceCdPerSquareMeter: number): number {
  return Math.log2(CAMERA_EQUATION_CONSTANT * luminanceCdPerSquareMeter * 100 / SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS);
}

/** Luminance (cd/m²) whose standard exposure at ISO 100 is `ev100`: L = 10·2^EV100/(0.65·100). */
export function standardExposureLuminance(ev100: number): number {
  return SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS * 2 ** ev100 / (CAMERA_EQUATION_CONSTANT * 100);
}
