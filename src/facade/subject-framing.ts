// SPDX-License-Identifier: Apache-2.0

/**
 * Subject distance for framing a chart (2.3) and chart coverage at any distance (2.5), with a catalogue lens (#631) or a sensor
 * profile (#636) as well as a thin lens. #646 (2.26.0): the thin-lens framing is in `subject-framing-thin-lens.ts`, which imports
 * neither the catalogue nor the profiles; this module adds them through {@link FramingExtensions}, so the results are unchanged.
 * @see docs/QUICK_START.md, "Fitting a chart to the frame" and "Chart coverage at any distance (2.5)".
 */

import { resolveGenericLens } from "../equipment/generic-lens-catalogue.js";
import { resolveProfileFrame } from "../equipment/sensor-profile-frame.js";
import { genericLensBreathingScale, genericLensFramingMapping, genericLensImageRadiusMm, genericLensPlaneRadiusM } from "../equipment/generic-lens-framing.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { chartFraming, closeUpLight, subjectDistanceForFraming, type CalculateChartFramingInput, type CalculateSubjectDistanceForFramingInput, type CatalogueChoice, type ChartFraming,
  type FramingExtensions, type SubjectFraming, type SubjectFramingFit, type SubjectFramingLens, type SubjectFramingSensorProfile } from "./subject-framing-thin-lens.js";
import type { SimulateCaptureAssumption } from "./simulate-capture.js";

export type { CalculateChartFramingInput, CalculateSubjectDistanceForFramingInput, ChartFraming, SubjectFraming, SubjectFramingCatalogueLens, SubjectFramingFit, SubjectFramingLens,
  SubjectFramingSensorProfile } from "./subject-framing-thin-lens.js";

/** #631: a catalogue lens's framing at subject distance d (m) and focus distance s (m): coverage, image sizes and the lens block. */
function catalogueFraming(catalogue: CatalogueChoice, sensorW: number, sensorH: number, widthM: number, heightM: number, d: number, s: number):
  { imageDistanceMm: number; magnification: number; framedWidthM: number; framedHeightM: number; coverage: { frameWidthFraction: number; frameHeightFraction: number };
    chartImageMm: { width: number; height: number }; lens: SubjectFramingLens } {
  const lens = catalogue.lens, f = lens.focalLengthMm, v = f * s * 1000 / (s * 1000 - f), k = catalogue.breathing ? genericLensBreathingScale(lens, s) : 1;
  const map = genericLensFramingMapping(lens, v, d, k), magnification = v / (d * 1000 * k);
  const imageW = 2 * genericLensImageRadiusMm(map, widthM / 2), imageH = 2 * genericLensImageRadiusMm(map, heightM / 2);
  const edgeW = genericLensPlaneRadiusM(map, sensorW / 2), edgeH = genericLensPlaneRadiusM(map, sensorH / 2);
  const twice = (x: number | null): number | null => (x === null ? null : 2 * x);
  return { imageDistanceMm: v, magnification, framedWidthM: sensorW / 1000 / magnification, framedHeightM: sensorH / 1000 / magnification,
    coverage: { frameWidthFraction: imageW / sensorW, frameHeightFraction: imageH / sensorH }, chartImageMm: { width: imageW, height: imageH },
    lens: Object.freeze({ lensId: lens.lensId, projection: lens.projection as SubjectFramingLens["projection"], breathingScale: k, framedWidthM: twice(edgeW.radiusM), framedHeightM: twice(edgeH.radiusM),
      fieldOfViewDegrees: Object.freeze({ width: twice(edgeW.fieldAngleDegrees), height: twice(edgeH.fieldAngleDegrees) }) }) };
}

/** #631: the catalogue lens's framing assumptions. */
function catalogueAssumptions(catalogue: CatalogueChoice, value: Record<string, unknown>, assumptions: SimulateCaptureAssumption[]): void {
  const lens = catalogue.lens;
  assumptions.push({ id: "model.catalogue-lens-framing", kind: "model", value: { lensId: lens.lensId, projection: lens.projection, ...value },
    explanation: (lens.projection === "fisheye-equisolid-angle" ? "Fisheye: a plane point at radius R is seen at θ = atan(R/d) and imaged at r = 2v·sin(θ/2), v the thin-lens image distance at the focus " +
      "distance, then displaced by the lens's radial distortion, as simulateCapture renders it; coverage is the chart's image along the frame's axes through the centre. " :
      "Rectilinear: the thin-lens framing (m = v/d), as simulateCapture's; the lens's distortion is not included. ") +
      (catalogue.breathing ? "Focus breathing scales the field of view by the lens's breathing at the focus distance (lens.catalogue.breathing). " : "") +
      "Minimum focus is the lens's own. Distances are from the lens (thin lens)." });
}

/**
 * #631: the fit distance through a catalogue lens, focused on the chart: the coverage of the fitted side falls monotonically with the
 * distance (the image distance and the chart's field angle both shrink, and breathing only widens the field farther away), so the
 * distance where it is 1 is found by bisection on log d.
 */
function catalogueFit(catalogue: CatalogueChoice, sensorW: number, sensorH: number, crop: number, widthM: number, heightM: number,
  fit: SubjectFramingFit, assumptions: SimulateCaptureAssumption[]): SubjectFraming {
  const lens = catalogue.lens, f = lens.focalLengthMm / 1000;
  const fitted = (d: number): number => {
    const c = catalogueFraming(catalogue, sensorW, sensorH, widthM, heightM, d, d).coverage, w = c.frameWidthFraction, h = c.frameHeightFraction;
    return fit === "width" ? w : fit === "height" ? h : fit === "contain" ? Math.max(w, h) : Math.min(w, h);
  };
  let lo = f * (1 + 1e-9), hi = 2 * f;
  while (fitted(hi) > 1) { lo = hi; hi *= 2; if (hi > 1e7) throw new InvalidConfigurationError("No distance fits this chart to the frame through the " + lens.name + "."); }
  for (let i = 0; i < 200 && hi / lo - 1 > 1e-15; i++) { const mid = Math.sqrt(lo * hi); if (fitted(mid) > 1) lo = mid; else hi = mid; }
  const subjectDistanceM = hi, framing = catalogueFraming(catalogue, sensorW, sensorH, widthM, heightM, subjectDistanceM, subjectDistanceM);
  catalogueAssumptions(catalogue, { magnification: framing.magnification, subjectDistanceM, breathingScale: framing.lens.breathingScale }, assumptions);
  return Object.freeze({ subjectDistanceM, magnification: framing.magnification, imageDistanceMm: framing.imageDistanceMm, focalLengthMm: lens.focalLengthMm,
    equivalentFocalLengthMm: lens.equivalentFocalLengthMm, cropFactor35Mm: crop, chart: { widthM, heightM }, fit, framedWidthM: framing.framedWidthM, framedHeightM: framing.framedHeightM,
    coverage: framing.coverage, ...closeUpLight(lens.focalLengthMm, subjectDistanceM), prime: null, minimumFocusDistanceM: lens.minimumFocusDistanceM,
    belowMinimumFocus: subjectDistanceM < lens.minimumFocusDistanceM, lens: framing.lens, scientificStatus: "approximation" as const,
    assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
}

const EXTENSIONS: FramingExtensions = {
  profileFrame: (sensorProfile, catalogue) => resolveProfileFrame(sensorProfile as SubjectFramingSensorProfile, catalogue),
  resolveLens: (lensId, sensor) => resolveGenericLens({ lensId, activeImagingArea: sensor }),
  fit: catalogueFit, frame: catalogueFraming, assumptions: catalogueAssumptions
};

/** The subject distance that fits a chart of a given physical size to the frame, with magnification, coverage and the minimum-focus check (2.3). */
export function calculateSubjectDistanceForFraming(input: CalculateSubjectDistanceForFramingInput): SubjectFraming {
  return subjectDistanceForFraming(input, "calculateSubjectDistanceForFraming", EXTENSIONS);
}

/**
 * How much of the frame a chart of a given physical size covers at any subject distance (2.5): magnification, framed plane size,
 * coverage fractions (above 1 when cropped), the chart's image size and the minimum-focus check. The same thin-lens framing as
 * `simulateCapture` (`scene.framing`, `result.scene.chart`) and `calculateSubjectDistanceForFraming`.
 */
export function calculateChartFraming(input: CalculateChartFramingInput): ChartFraming {
  return chartFraming(input, "calculateChartFraming", EXTENSIONS);
}
