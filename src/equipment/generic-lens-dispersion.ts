// SPDX-License-Identifier: Apache-2.0
/** The generic catalogue lenses' normalized glass dispersion (#765, 2.29.0: its own module, without the catalogue). */
import { FRAUNHOFER_C_LINE_NM, FRAUNHOFER_D_LINE_NM, FRAUNHOFER_F_LINE_NM } from "../optics/longitudinal-chromatic-aberration.js";

/** Normalised Cauchy dispersion D(λ) = (1/λ² − 1/λ_d²)/(1/λ_F² − 1/λ_C²): 0 at the d line, F minus C = 1. */
export function genericLensDispersion(wavelengthNm: number): number {
  const inv = (nm: number): number => 1 / (nm * nm);
  return (inv(wavelengthNm) - inv(FRAUNHOFER_D_LINE_NM)) / (inv(FRAUNHOFER_F_LINE_NM) - inv(FRAUNHOFER_C_LINE_NM));
}
