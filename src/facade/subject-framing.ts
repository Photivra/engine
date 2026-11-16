// SPDX-License-Identifier: Apache-2.0

/**
 * Subject distance for framing a chart (2.3). Thin lens: an object at distance d from a lens of focal length f
 * images at v = f·d/(d − f) with magnification m = v/d = f/(d − f), so the distance for a magnification m is
 * d = f·(1 + 1/m). This is the same framing the capture facade uses (`scene.framing`, `chartSize`), so a chart
 * placed at the returned distance with `chartSize` fills the frame as reported.
 *
 * 2.5: `calculateChartFraming` is the inverse question: at a given subject distance (and focus distance), how much of the
 * frame does the chart cover? It uses the facade's own framing, m = v/d with v = f·s/(s − f) at the focus distance s.
 * @see docs/QUICK_START.md, "Fitting a chart to the frame" and "Chart coverage at any distance (2.5)".
 */

import { thinLensWorkingFNumberFactor } from "../optics/scene-to-sensor-irradiance.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { calculateEquivalentFocalLength35Mm } from "../camera/equivalent-focal-length.js";
import { calculateGenericPrimeMinimumFocusDistanceM, resolveGenericPrimeLens, GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM, type GenericPrimeLens } from "../equipment/generic-prime-lenses.js";
import { resolveGenericLens, type ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";
import type { SensorProfile } from "../equipment/sensor-profile-body.js";
import { resolveProfileFrame } from "../equipment/sensor-profile-frame.js";
import { genericLensBreathingScale, genericLensFramingMapping, genericLensImageRadiusMm, genericLensPlaneRadiusM } from "../equipment/generic-lens-framing.js";
import type { SimulateCaptureAssumption } from "./simulate-capture.js";

/** How the chart fits the frame: `contain` (default; the whole chart is visible and its limiting side touches the frame), `width`, `height` or `cover` (the chart fills the frame and is cropped on its other side). */
export type SubjectFramingFit = "contain" | "width" | "height" | "cover";

export interface CalculateSubjectDistanceForFramingInput {
  /** Active sensor (or simulated frame) size, mm. Give exactly one of this and `sensorProfile`. */
  sensor?: { widthMm: number; heightMm: number };
  /** #636: a capture's sensor profile and output instead of `sensor` (see {@link SubjectFramingSensorProfile}). */
  sensorProfile?: SubjectFramingSensorProfile;
  /** Physical focal length, mm. Give exactly one of this and `equivalentFocalLengthMm`. */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (diagonal crop factor); a generic prime's value also reports that lens. */
  equivalentFocalLengthMm?: number;
  /** Chart size as for `simulateCapture` `chartSize`: heightM defaults to widthM × the sensor aspect (height / width). */
  chart: { widthM: number; heightM?: number };
  fit?: SubjectFramingFit;
  /** #631: a catalogue lens instead of a focal length, as `simulateCapture`'s `lens.catalogue` (see {@link SubjectFramingCatalogueLens}). */
  catalogue?: SubjectFramingCatalogueLens;
}

/**
 * #631: a catalogue lens id (`GENERIC_LENS_IDS`), or `{ kind, breathing? }` as `simulateCapture`'s `lens.catalogue`. The lens is resolved
 * on `sensor`; a fisheye frames through its equisolid projection and distortion, and `breathing: true` (#632) includes its focus
 * breathing, as a capture with `lens.catalogue.breathing` renders it.
 */
export type SubjectFramingCatalogueLens = string | { kind: string; breathing?: boolean };

/**
 * #636: a capture's `sensor.profile`, its output size and `sensor.pixelPitchMicrometers`. The frame is the capture's
 * (`calculateSensorProfileFrame`, the `sensor.profileView` assumption): with `catalogue` the lens is resolved on the profile's whole sensor
 * and the frame is its centred region of the output's aspect, so the phone profile's three lenses frame as they render; otherwise the
 * frame is output × pitch. A phone lens needs a profile whose `fixedLenses` is "phone", and that profile takes only them, as in a capture.
 */
export interface SubjectFramingSensorProfile { profile: SensorProfile; width: number; height: number; pixelPitchMicrometers?: number }

/** #631: how a catalogue lens frames the chart plane (present only with `catalogue`). */
export interface SubjectFramingLens {
  lensId: string;
  projection: "rectilinear" | "fisheye-equisolid-angle";
  /** The breathing scale 1 + Δ of the field of view at the focus distance (1 without `breathing`). */
  breathingScale: number;
  /** The plane width and height the frame sees, metres; null where the frame edge sees no plane (a fisheye's edge at or beyond 90°, or outside its image circle). */
  framedWidthM: number | null;
  framedHeightM: number | null;
  /** The full field of view across the frame width and height, degrees (null as above). */
  fieldOfViewDegrees: { width: number | null; height: number | null };
}

export interface SubjectFraming {
  /** Distance from the lens to the chart plane, metres: f·(1 + 1/m). */
  subjectDistanceM: number;
  /** Image size ÷ object size, f/(d − f). */
  magnification: number;
  /** Thin-lens image distance f·(1 + m), mm. */
  imageDistanceMm: number;
  focalLengthMm: number;
  equivalentFocalLengthMm: number;
  cropFactor35Mm: number;
  chart: { widthM: number; heightM: number };
  fit: SubjectFramingFit;
  /** Plane area the frame covers at that distance, metres. */
  framedWidthM: number;
  framedHeightM: number;
  /** Fraction of the frame width and height the chart covers (1 on the fitted side; above 1 means cropped). */
  coverage: { frameWidthFraction: number; frameHeightFraction: number };
  /**
   * 2.6: the thin-lens close-up light factor at the focus distance, 1/(1 + m)² with m = v/s: the image-plane irradiance
   * relative to the same lens and f-number focused at infinity (working f-number N·(1 + m)). It is the factor
   * `simulateCapture` applies through the scene-to-sensor irradiance (same function, same value).
   */
  closeUpTransmission: number;
  /** 2.6: the same factor in stops, 2·log₂(1 + m): how much darker the image is than at infinity focus. */
  closeUpLossStops: number;
  /** The generic prime of this equivalent focal length, when there is one. */
  prime: GenericPrimeLens | null;
  /** The generic prime rule max(0.10 m, f·(1 + 1/0.15)) at this focal length (the prime's own value when there is one). */
  minimumFocusDistanceM: number;
  /** True when the fit distance is closer than the minimum focus distance: the chart cannot be framed this way. */
  belowMinimumFocus: boolean;
  /** #631: with `catalogue`, how the lens frames the plane (for a fisheye, `framedWidthM` above is the paraxial value, sensor side ÷ magnification). */
  lens?: SubjectFramingLens;
  scientificStatus: "approximation";
  assumptions: readonly SimulateCaptureAssumption[];
}

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e7) throw new InvalidConfigurationError(name + " must be a positive finite number.");
  return value;
}

/** Shared input checks and lens resolution of the two framing functions. */
function resolveFramingInput(input: unknown, name: string, extraKeys: readonly string[]): { record: Record<string, unknown>; sensorW: number; sensorH: number; crop: number;
  equivalent: number; focalLengthMm: number; prime: GenericPrimeLens | null; widthM: number; heightM: number; assumptions: SimulateCaptureAssumption[];
  catalogue: { lens: ResolvedGenericLens; breathing: boolean } | null } {
  requireInputObject(input, name + " input");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["sensor", "sensorProfile", "focalLengthMm", "equivalentFocalLengthMm", "chart", "catalogue", ...extraKeys].includes(key))
    throw new InvalidConfigurationError(name + " input has unknown field \"" + key + "\".");
  if (record.sensor !== undefined && record.sensorProfile !== undefined) throw new InvalidConfigurationError("Give exactly one of sensor and sensorProfile.");
  // #636: a sensor profile frames as the capture does (sensor.profileView): the lens on the whole sensor with a catalogue lens.
  let sensorW: number, sensorH: number, lensSensor: { widthMm: number; heightMm: number } | undefined, profile: SensorProfile | undefined;
  const assumptions: SimulateCaptureAssumption[] = [];
  if (record.sensorProfile !== undefined) {
    requireInputObject(record.sensorProfile, "sensorProfile");
    requireInputKeys(record.sensorProfile, "sensorProfile", ["profile", "width", "height", "pixelPitchMicrometers"]);
    const view = resolveProfileFrame(record.sensorProfile as SubjectFramingSensorProfile, record.catalogue !== undefined);
    profile = (record.sensorProfile as SubjectFramingSensorProfile).profile;
    sensorW = view.frameWidthMm; sensorH = view.frameHeightMm;
    if (view.lensFramedOnSensor) lensSensor = { widthMm: view.sensorWidthMm, heightMm: view.sensorHeightMm };
    assumptions.push({ id: "sensor.profileView", kind: "model", value: view, explanation: "The capture's frame on the sensor profile (calculateSensorProfileFrame, simulateCapture's sensor.profileView): " +
      (lensSensor ? "the catalogue lens is resolved on the whole sensor and the frame is its centred region of the output's aspect." : "output × pixel pitch.") });
  } else {
    requireInputObject(record.sensor, "sensor");
    const sensor = record.sensor as Record<string, unknown>;
    for (const key of Object.keys(sensor)) if (key !== "widthMm" && key !== "heightMm") throw new InvalidConfigurationError("Unknown sensor field: " + key + ".");
    sensorW = positive(sensor.widthMm, "sensor.widthMm"); sensorH = positive(sensor.heightMm, "sensor.heightMm");
  }
  requireInputObject(record.chart, "chart");
  const chart = record.chart as Record<string, unknown>;
  for (const key of Object.keys(chart)) if (key !== "widthM" && key !== "heightM") throw new InvalidConfigurationError("Unknown chart field: " + key + ".");
  const lenses = [record.focalLengthMm, record.equivalentFocalLengthMm, record.catalogue].filter((v) => v !== undefined).length;
  if (lenses !== 1) throw new InvalidConfigurationError("Give exactly one of focalLengthMm, equivalentFocalLengthMm and catalogue.");
  let crop = calculateEquivalentFocalLength35Mm({ focalLengthMm: 1, activeImagingArea: { widthMm: sensorW, heightMm: sensorH } }).value.cropFactor35Mm;
  let catalogue: { lens: ResolvedGenericLens; breathing: boolean } | null = null;
  if (record.catalogue !== undefined) {
    const given = record.catalogue, entry = typeof given === "object" && given !== null ? given as Record<string, unknown> : { kind: given };
    for (const key of Object.keys(entry)) if (key !== "kind" && key !== "breathing") throw new InvalidConfigurationError("Unknown catalogue field: " + key + ".");
    if (entry.breathing !== undefined && typeof entry.breathing !== "boolean") throw new InvalidConfigurationError("catalogue.breathing must be a boolean.");
    catalogue = { lens: resolveGenericLens({ lensId: entry.kind as string, activeImagingArea: lensSensor ?? { widthMm: sensorW, heightMm: sensorH } }), breathing: entry.breathing === true };
    // #554: as in a capture, the phone lenses go only with a phone profile, which takes only them (checked when a profile is given).
    if (profile && (catalogue.lens.set === "phone") !== (profile.fixedLenses === "phone"))
      throw new InvalidConfigurationError("catalogue: the phone lenses go only with a phone sensorProfile (fixedLenses \"phone\"), which takes only them.");
    // The lens's crop factor is the whole sensor's when it is resolved there (equivalent = focal length × crop factor).
    if (lensSensor) crop = catalogue.lens.cropFactor35Mm;
  }
  const equivalent = catalogue ? catalogue.lens.equivalentFocalLengthMm : record.equivalentFocalLengthMm === undefined ? positive(record.focalLengthMm, "focalLengthMm") * crop :
    positive(record.equivalentFocalLengthMm, "equivalentFocalLengthMm");
  const focalLengthMm = catalogue ? catalogue.lens.focalLengthMm : record.focalLengthMm === undefined ? equivalent / crop : record.focalLengthMm as number;
  const prime = (GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM as readonly number[]).includes(equivalent) && record.equivalentFocalLengthMm !== undefined ?
    resolveGenericPrimeLens({ equivalentFocalLengthMm: equivalent, activeImagingArea: { widthMm: sensorW, heightMm: sensorH } }) : null;
  const widthM = positive(chart.widthM, "chart.widthM");
  const heightM = chart.heightM === undefined ? widthM * sensorH / sensorW : positive(chart.heightM, "chart.heightM");
  if (chart.heightM === undefined) assumptions.push({ id: "chart.heightM", kind: "default", value: heightM, explanation: "The chart has the sensor's shape: height = width × sensor height / sensor width." });
  return { record, sensorW, sensorH, crop, equivalent, focalLengthMm, prime, widthM, heightM, assumptions, catalogue };
}

/** #631: a catalogue lens's framing at subject distance d (m) and focus distance s (m): coverage, image sizes and the lens block. */
function catalogueFraming(catalogue: { lens: ResolvedGenericLens; breathing: boolean }, sensorW: number, sensorH: number, widthM: number, heightM: number, d: number, s: number):
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
function catalogueAssumptions(catalogue: { lens: ResolvedGenericLens; breathing: boolean }, value: Record<string, unknown>, assumptions: SimulateCaptureAssumption[]): void {
  const lens = catalogue.lens;
  assumptions.push({ id: "model.catalogue-lens-framing", kind: "model", value: { lensId: lens.lensId, projection: lens.projection, ...value },
    explanation: (lens.projection === "fisheye-equisolid-angle" ? "Fisheye: a plane point at radius R is seen at θ = atan(R/d) and imaged at r = 2v·sin(θ/2), v the thin-lens image distance at the focus " +
      "distance, then displaced by the lens's radial distortion, as simulateCapture renders it; coverage is the chart's image along the frame's axes through the centre. " :
      "Rectilinear: the thin-lens framing (m = v/d), as simulateCapture's; the lens's distortion is not included. ") +
      (catalogue.breathing ? "Focus breathing scales the field of view by the lens's breathing at the focus distance (lens.catalogue.breathing). " : "") +
      "Minimum focus is the lens's own. Distances are from the lens (thin lens)." });
}

/** The subject distance that fits a chart of a given physical size to the frame, with magnification, coverage and the minimum-focus check (2.3). */
export function calculateSubjectDistanceForFraming(input: CalculateSubjectDistanceForFramingInput): SubjectFraming {
  const { sensorW, sensorH, crop, equivalent, focalLengthMm, prime, widthM, heightM, assumptions, catalogue } = resolveFramingInput(input, "calculateSubjectDistanceForFraming", ["fit"]);
  const fit = input.fit ?? "contain";
  if (!["contain", "width", "height", "cover"].includes(fit)) throw new InvalidConfigurationError("fit must be contain, width, height or cover.");
  if (input.fit === undefined) assumptions.push({ id: "fit", kind: "default", value: "contain", explanation: "The whole chart is visible: the side whose chart-to-sensor ratio is larger (the limiting side) fills the frame." });
  if (catalogue) return catalogueFit(catalogue, sensorW, sensorH, crop, widthM, heightM, fit, assumptions);
  // Magnification that makes each chart side exactly fill the matching sensor side.
  const mWidth = sensorW / (widthM * 1000), mHeight = sensorH / (heightM * 1000);
  const m = fit === "width" ? mWidth : fit === "height" ? mHeight : fit === "contain" ? Math.min(mWidth, mHeight) : Math.max(mWidth, mHeight);
  const f = focalLengthMm / 1000, subjectDistanceM = f * (1 + 1 / m), minimumFocusDistanceM = prime ? prime.minimumFocusDistanceM : calculateGenericPrimeMinimumFocusDistanceM(focalLengthMm);
  assumptions.push({ id: "model.thin-lens-framing", kind: "model", value: { magnification: m, subjectDistanceM },
    explanation: "Thin lens focused on the chart plane: d = f·(1 + 1/m), image distance v = f·(1 + m), the same framing simulateCapture uses. Distances are from the lens; pupil positions, focus breathing and distortion are not modelled." });
  assumptions.push({ id: "minimumFocus", kind: "model", value: { minimumFocusDistanceM, rule: "max(0.10 m, f·(1 + 1/0.15))" },
    explanation: "The generic prime family's minimum focus rule (a thin-lens approximation, not a real lens)" + (prime ? " for " + prime.lensId : " applied to this focal length") + "." });
  if (input.equivalentFocalLengthMm !== undefined) assumptions.push({ id: "focalLengthMm", kind: "derived", value: focalLengthMm,
    explanation: "Equivalent focal length ÷ diagonal crop factor " + crop + " (calculateEquivalentFocalLength35Mm, 36 × 24 mm reference)." });
  return Object.freeze({ subjectDistanceM, magnification: m, imageDistanceMm: focalLengthMm * (1 + m), focalLengthMm, equivalentFocalLengthMm: equivalent, cropFactor35Mm: crop,
    chart: { widthM, heightM }, fit, framedWidthM: sensorW / 1000 / m, framedHeightM: sensorH / 1000 / m,
    coverage: { frameWidthFraction: widthM * 1000 * m / sensorW, frameHeightFraction: heightM * 1000 * m / sensorH }, ...closeUpLight(focalLengthMm, subjectDistanceM), prime, minimumFocusDistanceM,
    belowMinimumFocus: subjectDistanceM < minimumFocusDistanceM, scientificStatus: "approximation" as const, assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
}

/**
 * #631: the fit distance through a catalogue lens, focused on the chart: the coverage of the fitted side falls monotonically with the
 * distance (the image distance and the chart's field angle both shrink, and breathing only widens the field farther away), so the
 * distance where it is 1 is found by bisection on log d.
 */
function catalogueFit(catalogue: { lens: ResolvedGenericLens; breathing: boolean }, sensorW: number, sensorH: number, crop: number, widthM: number, heightM: number,
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

/** 2.6: the close-up light factor at a focus distance, from the irradiance bridge's own working f-number factor. */
function closeUpLight(focalLengthMm: number, focusDistanceM: number): { closeUpTransmission: number; closeUpLossStops: number } {
  const factor = thinLensWorkingFNumberFactor(focalLengthMm, focusDistanceM);
  return { closeUpTransmission: 1 / (factor * factor), closeUpLossStops: 2 * Math.log2(factor) };
}

export interface CalculateChartFramingInput {
  /** Active sensor (or simulated frame) size, mm: for `simulateCapture`, output width × height × pixel pitch. Give exactly one of this and `sensorProfile`. */
  sensor?: { widthMm: number; heightMm: number };
  /** #636: a capture's sensor profile and output instead of `sensor` (see {@link SubjectFramingSensorProfile}). */
  sensorProfile?: SubjectFramingSensorProfile;
  /** Physical focal length, mm. Give exactly one of this and `equivalentFocalLengthMm`. */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (diagonal crop factor); a generic prime's value also reports that lens (as `lens.prime`). */
  equivalentFocalLengthMm?: number;
  /** Chart size as for `simulateCapture` `chartSize`: heightM defaults to widthM × the sensor aspect (height / width). */
  chart: { widthM: number; heightM?: number };
  /** Distance from the lens to the chart plane, metres; more than the focal length. */
  subjectDistanceM: number;
  /** Focus distance, metres (as `lens.focusDistanceM`); default the subject distance. More than the focal length. */
  focusDistanceM?: number;
  /** #631: a catalogue lens instead of a focal length, as `simulateCapture`'s `lens.catalogue`. */
  catalogue?: SubjectFramingCatalogueLens;
}

export interface ChartFraming {
  subjectDistanceM: number;
  focusDistanceM: number;
  /** Thin-lens image distance at the focus distance, f·s/(s − f), mm. */
  imageDistanceMm: number;
  /** Image size ÷ object size on the chart plane, v/d: f/(d − f) when focused on the chart. */
  magnification: number;
  focalLengthMm: number;
  equivalentFocalLengthMm: number;
  cropFactor35Mm: number;
  chart: { widthM: number; heightM: number };
  /** Plane area the frame covers at the subject distance, metres: sensor side ÷ magnification. */
  framedWidthM: number;
  framedHeightM: number;
  /** Fraction of the frame width and height the chart covers; above 1 means the chart is larger than the frame and cropped. */
  coverage: { frameWidthFraction: number; frameHeightFraction: number };
  /** The chart's image on the sensor, mm. */
  chartImageMm: { width: number; height: number };
  /**
   * 2.6: the thin-lens close-up light factor at the focus distance, 1/(1 + m)² with m = v/s: the image-plane irradiance
   * relative to the same lens and f-number focused at infinity (working f-number N·(1 + m)). It is the factor
   * `simulateCapture` applies through the scene-to-sensor irradiance (same function, same value).
   */
  closeUpTransmission: number;
  /** 2.6: the same factor in stops, 2·log₂(1 + m): how much darker the image is than at infinity focus. */
  closeUpLossStops: number;
  /** The generic prime of this equivalent focal length, when there is one. */
  prime: GenericPrimeLens | null;
  /** The generic prime rule max(0.10 m, f·(1 + 1/0.15)) at this focal length (the prime's own value when there is one). */
  minimumFocusDistanceM: number;
  /** True when the subject or focus distance is closer than the minimum focus distance (`simulateCapture` with `lens.prime` rejects it). */
  belowMinimumFocus: boolean;
  /** #631: with `catalogue`, how the lens frames the plane (for a fisheye, `framedWidthM` above is the paraxial value, sensor side ÷ magnification). */
  lens?: SubjectFramingLens;
  scientificStatus: "approximation";
  assumptions: readonly SimulateCaptureAssumption[];
}

/**
 * How much of the frame a chart of a given physical size covers at any subject distance (2.5): magnification, framed plane size,
 * coverage fractions (above 1 when cropped), the chart's image size and the minimum-focus check. The same thin-lens framing as
 * `simulateCapture` (`scene.framing`, `result.scene.chart`) and `calculateSubjectDistanceForFraming`.
 */
export function calculateChartFraming(input: CalculateChartFramingInput): ChartFraming {
  const { record, sensorW, sensorH, crop, equivalent, focalLengthMm, prime, widthM, heightM, assumptions, catalogue } = resolveFramingInput(input, "calculateChartFraming",
    ["subjectDistanceM", "focusDistanceM"]);
  const subjectDistanceM = positive(record.subjectDistanceM, "subjectDistanceM");
  const focusDistanceM = record.focusDistanceM === undefined ? subjectDistanceM : positive(record.focusDistanceM, "focusDistanceM");
  if (record.focusDistanceM === undefined) assumptions.push({ id: "focusDistanceM", kind: "default", value: subjectDistanceM, explanation: "The lens is focused on the chart plane." });
  const f = focalLengthMm / 1000;
  if (!(subjectDistanceM > f) || !(focusDistanceM > f)) throw new InvalidConfigurationError("subjectDistanceM and focusDistanceM must be more than the focal length (" + f + " m).");
  if (catalogue) {
    const framing = catalogueFraming(catalogue, sensorW, sensorH, widthM, heightM, subjectDistanceM, focusDistanceM), minimumFocusDistanceM = catalogue.lens.minimumFocusDistanceM;
    catalogueAssumptions(catalogue, { magnification: framing.magnification, imageDistanceMm: framing.imageDistanceMm, breathingScale: framing.lens.breathingScale }, assumptions);
    return Object.freeze({ subjectDistanceM, focusDistanceM, imageDistanceMm: framing.imageDistanceMm, magnification: framing.magnification, focalLengthMm, equivalentFocalLengthMm: equivalent,
      cropFactor35Mm: crop, chart: { widthM, heightM }, framedWidthM: framing.framedWidthM, framedHeightM: framing.framedHeightM, coverage: framing.coverage, chartImageMm: framing.chartImageMm,
      ...closeUpLight(focalLengthMm, focusDistanceM), prime: null, minimumFocusDistanceM, belowMinimumFocus: subjectDistanceM < minimumFocusDistanceM || focusDistanceM < minimumFocusDistanceM,
      lens: framing.lens, scientificStatus: "approximation" as const, assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
  }
  // Written exactly as simulateCapture forms it, so the two agree to the last bit.
  const imageDistanceMm = focalLengthMm * focusDistanceM * 1000 / (focusDistanceM * 1000 - focalLengthMm);
  const magnification = imageDistanceMm / (subjectDistanceM * 1000);
  const framedWidthM = sensorW * subjectDistanceM / imageDistanceMm, framedHeightM = sensorH * subjectDistanceM / imageDistanceMm;
  const minimumFocusDistanceM = prime ? prime.minimumFocusDistanceM : calculateGenericPrimeMinimumFocusDistanceM(focalLengthMm);
  assumptions.push({ id: "model.thin-lens-framing", kind: "model", value: { magnification, imageDistanceMm },
    explanation: "Thin lens: image distance v = f·s/(s − f) at the focus distance s, magnification m = v/d on the chart plane at d, and the frame spans sensor side / m, " +
      "the same framing simulateCapture uses. Distances are from the lens; pupil positions, focus breathing and distortion are not modelled." });
  assumptions.push({ id: "minimumFocus", kind: "model", value: { minimumFocusDistanceM, rule: "max(0.10 m, f·(1 + 1/0.15))" },
    explanation: "The generic prime family's minimum focus rule (a thin-lens approximation, not a real lens)" + (prime ? " for " + prime.lensId : " applied to this focal length") + "." });
  if (record.equivalentFocalLengthMm !== undefined) assumptions.push({ id: "focalLengthMm", kind: "derived", value: focalLengthMm,
    explanation: "Equivalent focal length ÷ diagonal crop factor " + crop + " (calculateEquivalentFocalLength35Mm, 36 × 24 mm reference)." });
  return Object.freeze({ subjectDistanceM, focusDistanceM, imageDistanceMm, magnification, focalLengthMm, equivalentFocalLengthMm: equivalent, cropFactor35Mm: crop,
    chart: { widthM, heightM }, framedWidthM, framedHeightM, coverage: { frameWidthFraction: widthM / framedWidthM, frameHeightFraction: heightM / framedHeightM },
    chartImageMm: { width: widthM * 1000 * magnification, height: heightM * 1000 * magnification }, ...closeUpLight(focalLengthMm, focusDistanceM), prime, minimumFocusDistanceM,
    belowMinimumFocus: subjectDistanceM < minimumFocusDistanceM || focusDistanceM < minimumFocusDistanceM, scientificStatus: "approximation" as const,
    assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
}
