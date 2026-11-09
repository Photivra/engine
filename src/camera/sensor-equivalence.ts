// SPDX-License-Identifier: Apache-2.0

/**
 * Format equivalence for teaching: what a lens of focal length f at f-number N on one sensor
 * corresponds to on a reference format (36 × 24 mm by default), and how large a blur circle is
 * as a share of the frame or of a print.
 *
 * With the diagonal crop factor k = referenceDiagonal / sensorDiagonal:
 * - equivalent focal length k·f (same diagonal angle of view; exact by the diagonal convention);
 * - equivalent f-number k·N for depth of field, background blur and total light (same framing,
 *   same output size). It keeps the entrance-pupil diameter f/N unchanged. It is an
 *   approximation: in the thin-lens defocus-circle equation it is exact only when the focus
 *   distance is much greater than the focal length;
 * - the f-number for exposure stays N: image illuminance depends on N, not on the sensor size;
 * - sensor area ratio and the total-light difference in stops at the same f-number and shutter.
 *
 * Sources (free): thin-lens defocus-circle diameter f²|s − d|/(N d (s − f)) and f-number N = f/D,
 * Greivenkamp, OPTI-502 course notes, sec. 12 (Objectives),
 * https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf;
 * image illuminance proportional to 1/N², sec. 11 (Radiative transfer),
 * https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-11-Radiative-Transfer.pdf.
 * @see docs/PHYSICS_FOUNDATION.md "Sensor equivalence" for the derivation, the exact and
 * approximated quantities, and support limits.
 */

import {
  approximationResult,
  calculatedResult,
  type CalculationResult
} from "../core/calculation-result.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { portableHypot, portableLog2 } from "../core/portable-math.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { calculateImagingAreaMetrics, type SensorImagingArea } from "../sensor/sensor-geometry.js";

/** The default equivalence reference: the 36 × 24 mm frame. */
const REFERENCE_FULL_FRAME: Readonly<SensorImagingArea> = Object.freeze({ widthMm: 36, heightMm: 24 });

/** Whether a value is exact under its stated conditions or an approximation. */
export type EquivalenceExactness = "exact" | "approximation";

/** How one equivalence quantity was obtained, and under which conditions it holds. */
export interface EquivalenceValueBasis {
  /** `"exact"` under the stated conditions, or `"approximation"`. */
  kind: EquivalenceExactness;
  /** Plain statement of the definition and its conditions. */
  statement: string;
}

export interface CalculateSensorEquivalenceInput {
  /** Physical active imaging area of the sensor the lens is used on. */
  sensor: SensorImagingArea;
  /** Physical focal length of the lens in millimetres. */
  focalLengthMm: number;
  /** f-number set on the lens (N = focal length / entrance-pupil diameter). */
  fNumber: number;
  /** Format to compare against. Defaults to the 36 × 24 mm frame. */
  reference?: SensorImagingArea;
}

/** Angles of view of an ideal rectilinear lens focused at infinity, in degrees. */
export interface SensorEquivalenceFieldOfView {
  horizontalDegrees: number;
  verticalDegrees: number;
  diagonalDegrees: number;
}

/** Quantities of a sensor equivalence result that carry an exactness statement. */
export type SensorEquivalenceQuantity =
  | "cropFactor"
  | "equivalentFocalLengthMm"
  | "equivalentFNumber"
  | "exposureFNumber"
  | "entrancePupilDiameterMm"
  | "areaRatio"
  | "totalLightDifferenceStops"
  | "fieldOfView";

export interface SensorEquivalence {
  /** Physical focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** f-number supplied by the caller. */
  fNumber: number;
  /** Sensor active imaging area used. */
  sensor: SensorImagingArea;
  /** Reference format used (36 × 24 mm unless the caller passed one). */
  reference: SensorImagingArea;
  /** Sensor diagonal in millimetres. */
  sensorDiagonalMm: number;
  /** Reference diagonal in millimetres. */
  referenceDiagonalMm: number;
  /** Diagonal crop factor: reference diagonal / sensor diagonal. Greater than 1 for a smaller sensor. */
  cropFactor: number;
  /** Focal length on the reference format with the same diagonal angle of view: cropFactor × focalLengthMm. */
  equivalentFocalLengthMm: number;
  /**
   * f-number on the reference format that gives the same depth of field, background blur and total
   * light for the same framing and output size: cropFactor × fNumber. Not an exposure setting.
   */
  equivalentFNumber: number;
  /** f-number that sets exposure (image brightness): the f-number on the lens, unchanged by sensor size. */
  exposureFNumber: number;
  /** Entrance-pupil diameter f/N in millimetres; the equivalent lens has the same diameter. */
  entrancePupilDiameterMm: number;
  /** Sensor area / reference area. Less than 1 for a smaller sensor. */
  areaRatio: number;
  /**
   * log2(areaRatio): total light collected by the sensor relative to the reference at the same
   * f-number, shutter time and scene, in stops. Negative for a smaller sensor.
   */
  totalLightDifferenceStops: number;
  /** Angles of view of this lens on the sensor (the equivalent lens gives the same diagonal angle). */
  fieldOfView: SensorEquivalenceFieldOfView;
  /** Exact or approximated, with the conditions, for every quantity above. */
  basis: Readonly<Record<SensorEquivalenceQuantity, EquivalenceValueBasis>>;
}

const SENSOR_EQUIVALENCE_BASIS: Readonly<Record<SensorEquivalenceQuantity, EquivalenceValueBasis>> = Object.freeze({
  cropFactor: Object.freeze({
    kind: "exact",
    statement: "Ratio of the reference diagonal to the sensor diagonal (diagonal convention)."
  }),
  equivalentFocalLengthMm: Object.freeze({
    kind: "exact",
    statement: "Same diagonal angle of view on the reference format, for an ideal rectilinear lens focused at infinity. " +
      "Horizontal and vertical angles match too only when the aspect ratios match."
  }),
  equivalentFNumber: Object.freeze({
    kind: "approximation",
    statement: "Same depth of field and background blur as a share of the frame, at the same subject distance, framing and output size, " +
      "and the same entrance-pupil diameter (so the same total light at the same shutter time). In the thin-lens defocus equation it is exact " +
      "only when the focus distance s is much greater than the focal length f; with focal lengths in the ratio cropFactor, the blur shares match " +
      "at cropFactor·N·(s − f)/(s − cropFactor·f). " +
      "Total light matches exactly only when the aspect ratios match. It does not set exposure."
  }),
  exposureFNumber: Object.freeze({
    kind: "exact",
    statement: "Image illuminance is proportional to 1/N², independent of sensor size (ideal lens; transmission, vignetting and " +
      "close-focus bellows factor excluded). Equivalence never changes the exposure setting."
  }),
  entrancePupilDiameterMm: Object.freeze({
    kind: "exact",
    statement: "Entrance-pupil diameter D = f/N by the definition of the f-number. The equivalent lens (cropFactor·f at cropFactor·N) has the same D."
  }),
  areaRatio: Object.freeze({
    kind: "exact",
    statement: "Product of width and height of the sensor divided by that of the reference."
  }),
  totalLightDifferenceStops: Object.freeze({
    kind: "exact",
    statement: "log2 of the area ratio: at the same f-number, shutter time and scene the image illuminance is the same, so total light scales " +
      "with area (uniform illuminance; vignetting excluded)."
  }),
  fieldOfView: Object.freeze({
    kind: "exact",
    statement: "2·atan(dimension / 2f) for an ideal rectilinear lens focused at infinity; distortion and focus breathing excluded."
  })
});

function requireImagingArea(area: unknown, label: string): asserts area is SensorImagingArea {
  requireInputObject(area, label);
  requireInputKeys(area, label, ["widthMm", "heightMm"]);
  const record = area as SensorImagingArea;
  requirePositiveFinite(`${label}.widthMm`, record.widthMm);
  requirePositiveFinite(`${label}.heightMm`, record.heightMm);
}

/** √((rw² + rh²)/(w² + h²)), with only correctly rounded operations when nothing overflows (portable). */
function diagonalRatio(reference: SensorImagingArea, sensor: SensorImagingArea): number {
  const referenceSquared = reference.widthMm * reference.widthMm + reference.heightMm * reference.heightMm;
  const sensorSquared = sensor.widthMm * sensor.widthMm + sensor.heightMm * sensor.heightMm;
  const ratio = referenceSquared / sensorSquared;
  return Number.isFinite(referenceSquared) && Number.isFinite(sensorSquared) && sensorSquared > 0 && ratio > 0 && Number.isFinite(ratio)
    ? Math.sqrt(ratio)
    : portableHypot(reference.widthMm, reference.heightMm) / portableHypot(sensor.widthMm, sensor.heightMm);
}

function rectilinearAngleDegrees(dimensionMm: number, focalLengthMm: number): number {
  return (2 * Math.atan(dimensionMm / (2 * focalLengthMm)) * 180) / Math.PI;
}

/**
 * Equivalence of a lens (focal length, f-number) on one sensor against a reference format,
 * 36 × 24 mm by default: crop factor, equivalent focal length, equivalent f-number for depth of
 * field, blur and total light, the unchanged f-number for exposure, sensor area ratio, total-light
 * difference in stops and the angles of view.
 *
 * Call it once per sensor for a lens table. Every quantity carries a `basis` entry saying whether it
 * is exact under its stated conditions or an approximation. The equivalent f-number is an
 * approximation (exact when the focus distance is much greater than the focal length) and never an
 * exposure setting: exposure uses `exposureFNumber`, the f-number on the lens.
 *
 * Example: 50 mm f/2 on a 23.5 × 15.6 mm sensor gives crop factor ≈ 1.53, ≈ 77 mm and ≈ f/3.1.
 *
 * @param input Sensor active area, focal length, f-number and optional reference format.
 * @returns The equivalence numbers with a per-quantity exactness statement.
 */
export function calculateSensorEquivalence(
  input: CalculateSensorEquivalenceInput
): CalculationResult<SensorEquivalence> {
  requireInputKeys(input, "calculateSensorEquivalence", ["sensor", "focalLengthMm", "fNumber", "reference"]);
  requireImagingArea(input.sensor, "sensor");
  requirePositiveFinite("focalLengthMm", input.focalLengthMm);
  requirePositiveFinite("fNumber", input.fNumber);
  if (input.reference !== undefined) requireImagingArea(input.reference, "reference");

  const sensor: SensorImagingArea = { widthMm: input.sensor.widthMm, heightMm: input.sensor.heightMm };
  const reference: SensorImagingArea = input.reference === undefined
    ? { ...REFERENCE_FULL_FRAME }
    : { widthMm: input.reference.widthMm, heightMm: input.reference.heightMm };
  // The default reference reuses the canonical 35 mm crop factor, so it is bit-identical to
  // calculateEquivalentFocalLength35Mm and calculateImagingAreaMetrics.
  const cropFactor = input.reference === undefined
    ? calculateImagingAreaMetrics(sensor).value.cropFactor35Mm
    : diagonalRatio(reference, sensor);
  const areaRatio = (sensor.widthMm / reference.widthMm) * (sensor.heightMm / reference.heightMm);
  const sensorDiagonalMm = portableHypot(sensor.widthMm, sensor.heightMm);
  if (!(areaRatio > 0) || !Number.isFinite(areaRatio)) {
    throw new InvalidScientificInputError("sensor and reference areas must differ by a ratio that is a finite number greater than zero.");
  }

  return approximationResult(
    {
      focalLengthMm: input.focalLengthMm,
      fNumber: input.fNumber,
      sensor,
      reference,
      sensorDiagonalMm,
      referenceDiagonalMm: portableHypot(reference.widthMm, reference.heightMm),
      cropFactor,
      equivalentFocalLengthMm: input.focalLengthMm * cropFactor,
      equivalentFNumber: input.fNumber * cropFactor,
      exposureFNumber: input.fNumber,
      entrancePupilDiameterMm: input.focalLengthMm / input.fNumber,
      areaRatio,
      totalLightDifferenceStops: portableLog2(areaRatio),
      fieldOfView: {
        horizontalDegrees: rectilinearAngleDegrees(sensor.widthMm, input.focalLengthMm),
        verticalDegrees: rectilinearAngleDegrees(sensor.heightMm, input.focalLengthMm),
        diagonalDegrees: rectilinearAngleDegrees(sensorDiagonalMm, input.focalLengthMm)
      },
      basis: SENSOR_EQUIVALENCE_BASIS
    },
    "sensor-equivalence",
    "1.0.0",
    [
      "Crop factor and equivalence are diagonal-based against the reference format (36 × 24 mm unless given).",
      "Equivalent f-number concerns depth of field, background blur and total light for the same framing and output size; it is not an exposure setting.",
      "Equivalent f-number is a thin-lens approximation, exact when the focus distance is much greater than the focal length.",
      "Exposure f-number is the f-number on the lens: image illuminance does not depend on sensor size.",
      "Ideal rectilinear lens focused at infinity; distortion, vignetting, transmission and focus breathing excluded.",
      "Physical focal length and f-number are not changed; see basis for each quantity."
    ]
  );
}

export interface CalculateBlurShareOfFrameInput {
  /** Blur-circle diameter on the sensor in millimetres (for example from calculateDefocusCircle). Zero is allowed. */
  blurCircleMm: number;
  /** Physical active imaging area of the sensor. */
  sensor: SensorImagingArea;
  /**
   * Optional print size. The whole frame is enlarged to fit inside it without cropping, long side
   * to long side.
   */
  print?: { widthMm: number; heightMm: number };
}

export interface BlurShareOfPrint {
  /** Linear enlargement from sensor to print: the smaller of the long-side and short-side ratios. */
  enlargement: number;
  /** Blur-circle diameter on the print in millimetres: blurCircleMm × enlargement. */
  blurOnPrintMm: number;
  /** Size of the printed image in millimetres (equal to the print when the aspect ratios match). */
  imageLongSideMm: number;
  imageShortSideMm: number;
}

export interface BlurShareOfFrame {
  /** Blur-circle diameter on the sensor in millimetres. */
  blurCircleMm: number;
  /** Sensor diagonal in millimetres. */
  frameDiagonalMm: number;
  /** Blur diameter / frame diagonal. Equal shares look the same at the same output size. */
  shareOfDiagonal: number;
  /** Blur diameter / frame width. */
  shareOfWidth: number;
  /** Blur diameter / frame height. */
  shareOfHeight: number;
  /** Blur on the print; present only when a print size was given. */
  print?: BlurShareOfPrint;
}

/**
 * A blur circle on the sensor as a share of the frame (diagonal, width and height) and, when a
 * print size is given, its diameter on that print.
 *
 * Equal shares of the diagonal look the same when the images are shown at the same size, which
 * is how "same framing" comparisons across sensor sizes are stated. Every value is an exact ratio
 * or scaling; whether a blur is visible depends on viewing distance and acuity, which this
 * function does not judge.
 *
 * @param input Blur diameter in millimetres, sensor active area and optional print size.
 * @returns Shares of the frame, and the blur on the print when a print is given.
 */
export function calculateBlurShareOfFrame(
  input: CalculateBlurShareOfFrameInput
): CalculationResult<BlurShareOfFrame> {
  requireInputKeys(input, "calculateBlurShareOfFrame", ["blurCircleMm", "sensor", "print"]);
  if (typeof input.blurCircleMm !== "number" || !Number.isFinite(input.blurCircleMm) || input.blurCircleMm < 0) {
    throw new InvalidScientificInputError("blurCircleMm must be a finite number greater than or equal to zero.");
  }
  requireImagingArea(input.sensor, "sensor");
  if (input.print !== undefined) requireImagingArea(input.print, "print");

  const { widthMm, heightMm } = input.sensor;
  const blurCircleMm = input.blurCircleMm;
  const frameDiagonalMm = portableHypot(widthMm, heightMm);
  let print: BlurShareOfPrint | undefined;
  if (input.print !== undefined) {
    const sensorLong = Math.max(widthMm, heightMm), sensorShort = Math.min(widthMm, heightMm);
    const printLong = Math.max(input.print.widthMm, input.print.heightMm), printShort = Math.min(input.print.widthMm, input.print.heightMm);
    const enlargement = Math.min(printLong / sensorLong, printShort / sensorShort);
    if (!(enlargement > 0) || !Number.isFinite(enlargement)) {
      throw new InvalidScientificInputError("print enlargement must be a finite number greater than zero.");
    }
    print = {
      enlargement,
      blurOnPrintMm: blurCircleMm * enlargement,
      imageLongSideMm: sensorLong * enlargement,
      imageShortSideMm: sensorShort * enlargement
    };
  }

  return calculatedResult(
    {
      blurCircleMm,
      frameDiagonalMm,
      shareOfDiagonal: blurCircleMm / frameDiagonalMm,
      shareOfWidth: blurCircleMm / widthMm,
      shareOfHeight: blurCircleMm / heightMm,
      ...(print === undefined ? {} : { print })
    },
    "blur-share-of-frame",
    "1.0.0",
    [
      "Shares are exact ratios of the blur diameter to the active frame's diagonal, width and height.",
      "A print shows the whole frame enlarged to fit inside it without cropping, long side to long side.",
      "Visibility of the blur depends on viewing distance and acuity; no acceptability criterion is applied."
    ]
  );
}
