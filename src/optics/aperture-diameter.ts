// SPDX-License-Identifier: Apache-2.0

/**
 * Entrance-pupil (aperture) diameter of a lens from its focal length and f-number.
 *
 * The f-number is defined as N = f/D, with f the focal length and D the entrance-pupil diameter,
 * for an object at infinity (Greivenkamp, OPTI-502 course notes, sec. 12 (Objectives), free:
 * https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf).
 * So D = f/N is exact by that definition. It is the diameter of the entrance pupil, the image of
 * the aperture stop seen from the front of the lens, not of the physical diaphragm opening.
 *
 * At close focus the f-number that sets exposure and diffraction is the working f-number
 * N_w = N·(1 + m/P), with m the magnification and P the pupil magnification (exit-pupil over
 * entrance-pupil diameter); a lens that focuses by changing its focal length changes f, and with
 * it D at the same marked N. Neither is modeled here; the
 * engine's own close-focus light factor, N·(1 + m) with unit pupil magnification, is in
 * `calculateSceneRadianceToSensorIrradiance`.
 * @see docs/PHYSICS_FOUNDATION.md "Aperture (entrance-pupil) diameter".
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { requireInputKeys } from "../core/record-validation.js";
import { InvalidScientificResultError, requirePositiveFinite } from "../core/validation.js";

export interface CalculateApertureDiameterInput {
  /** Focal length of the lens in millimetres (the physical focal length, not a 35 mm equivalent). */
  focalLengthMm: number;
  /** f-number set on the lens (N = focal length / entrance-pupil diameter). */
  fNumber: number;
}

export interface ApertureDiameter {
  /** Focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** f-number supplied by the caller. */
  fNumber: number;
  /** Entrance-pupil diameter D = focalLengthMm / fNumber, in millimetres. */
  entrancePupilDiameterMm: number;
}

/**
 * Entrance-pupil (aperture) diameter in millimetres: focal length ÷ f-number.
 *
 * Exact by the definition of the f-number for an ideal lens focused at infinity. It is the
 * entrance pupil (the aperture stop as seen from the front), not the diaphragm's physical
 * opening. Close focus (working f-number N·(1 + m/P) with pupil magnification P) and focal-length
 * changes while focusing are not modelled.
 *
 * Example: 50 mm at f/2 gives 25 mm; at f/4, 12.5 mm (half the diameter, a quarter of the area:
 * two stops).
 *
 * @param input Focal length in millimetres and f-number.
 * @returns The entrance-pupil diameter with the inputs.
 */
export function calculateApertureDiameter(
  input: CalculateApertureDiameterInput
): CalculationResult<ApertureDiameter> {
  requireInputKeys(input, "calculateApertureDiameter", ["focalLengthMm", "fNumber"]);
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("fNumber", input.fNumber);
  const entrancePupilDiameterMm = input.focalLengthMm / input.fNumber;
  if (!(entrancePupilDiameterMm > 0) || !Number.isFinite(entrancePupilDiameterMm)) {
    throw new InvalidScientificResultError("entrancePupilDiameterMm must be a finite number greater than zero.");
  }
  return calculatedResult(
    { focalLengthMm: input.focalLengthMm, fNumber: input.fNumber, entrancePupilDiameterMm },
    "aperture-diameter",
    "1.0.0",
    [
      "Entrance-pupil diameter D = f/N, exact by the definition of the f-number for an object at infinity.",
      "Ideal lens focused at infinity: close-focus working f-number N·(1 + m/P), pupil magnification P and focus breathing are not modelled.",
      "D is the entrance pupil (the aperture stop seen from the front of the lens), not the physical diaphragm opening."
    ]
  );
}
