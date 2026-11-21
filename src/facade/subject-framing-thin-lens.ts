// SPDX-License-Identifier: Apache-2.0

/**
 * Subject distance for framing a chart (2.3). Thin lens: an object at distance d from a lens of focal length f
 * images at v = f·d/(d − f) with magnification m = v/d = f/(d − f), so the distance for a magnification m is
 * d = f·(1 + 1/m). This is the same framing the capture facade uses (`scene.framing`, `chartSize`), so a chart
 * placed at the returned distance with `chartSize` fills the frame as reported.
 *
 * 2.5: `calculateChartFraming` is the inverse question: at a given subject distance (and focus distance), how much of the
 * frame does the chart cover? It uses the facade's own framing, m = v/d with v = f·s/(s − f) at the focus distance s.
 * #646 (2.26.0): the thin-lens framing lives here and imports nothing from the lens catalogue or the sensor profiles, so a bundle
 * that uses only `calculateThinLensSubjectDistanceForFraming` and `calculateThinLensChartFraming` leaves them out.
 * `subject-framing.ts` adds the catalogue (#631) and sensor-profile (#636) paths through {@link FramingExtensions}, with the same
 * code and results.
 * @see docs/QUICK_START.md, "Fitting a chart to the frame" and "Chart coverage at any distance (2.5)".
 */

import { thinLensWorkingFNumberFactor } from "../optics/scene-to-sensor-irradiance.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { calculateEquivalentFocalLength35Mm } from "../camera/equivalent-focal-length.js";
import { calculateGenericPrimeMinimumFocusDistanceM, resolveGenericPrimeLens, GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM, type GenericPrimeLens } from "../equipment/generic-prime-lenses.js";
import type { ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";
import type { SensorProfile } from "../equipment/sensor-profile-record.js";
import type { SensorProfileFrame } from "../equipment/sensor-profile-frame.js";
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

/**
 * @internal #646: what `subject-framing.ts` adds to the thin-lens framing: the sensor profile's frame, the catalogue lens and the
 * catalogue lens's fit and coverage.
 */
export interface FramingExtensions {
  profileFrame(sensorProfile: unknown, catalogue: boolean): SensorProfileFrame;
  resolveLens(lensId: string, sensor: { widthMm: number; heightMm: number }): ResolvedGenericLens;
  fit(catalogue: CatalogueChoice, sensorW: number, sensorH: number, crop: number, widthM: number, heightM: number, fit: SubjectFramingFit, assumptions: SimulateCaptureAssumption[]): SubjectFraming;
  frame(catalogue: CatalogueChoice, sensorW: number, sensorH: number, widthM: number, heightM: number, d: number, s: number):
    { imageDistanceMm: number; magnification: number; framedWidthM: number; framedHeightM: number; coverage: { frameWidthFraction: number; frameHeightFraction: number };
      chartImageMm: { width: number; height: number }; lens: SubjectFramingLens };
  assumptions(catalogue: CatalogueChoice, value: Record<string, unknown>, assumptions: SimulateCaptureAssumption[]): void;
}
/** @internal A resolved catalogue lens and whether its breathing is included. */
export interface CatalogueChoice { lens: ResolvedGenericLens; breathing: boolean }

/** @internal */
export function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1e7) throw new InvalidConfigurationError(name + " must be a positive finite number, at most 1e7.");
  return value;
}

/** Shared input checks and lens resolution of the two framing functions. */
function resolveFramingInput(input: unknown, name: string, extraKeys: readonly string[], ext: FramingExtensions | undefined): { record: Record<string, unknown>; sensorW: number;
  sensorH: number; crop: number; equivalent: number; focalLengthMm: number; prime: GenericPrimeLens | null; widthM: number; heightM: number; assumptions: SimulateCaptureAssumption[];
  catalogue: CatalogueChoice | null } {
  requireInputObject(input, name + " input");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["sensor", ...(ext ? ["sensorProfile"] : []), "focalLengthMm", "equivalentFocalLengthMm", "chart", ...(ext ? ["catalogue"] : []), ...extraKeys].includes(key))
    throw new InvalidConfigurationError(name + " input has unknown field \"" + key + "\".");
  if (record.sensor !== undefined && record.sensorProfile !== undefined) throw new InvalidConfigurationError("Give exactly one of sensor and sensorProfile.");
  // #636: a sensor profile frames as the capture does (sensor.profileView): the lens on the whole sensor with a catalogue lens.
  let sensorW: number, sensorH: number, lensSensor: { widthMm: number; heightMm: number } | undefined, profile: SensorProfile | undefined;
  const assumptions: SimulateCaptureAssumption[] = [];
  if (record.sensorProfile !== undefined) {
    requireInputObject(record.sensorProfile, "sensorProfile");
    requireInputKeys(record.sensorProfile, "sensorProfile", ["profile", "width", "height", "pixelPitchMicrometers"]);
    const view = ext!.profileFrame(record.sensorProfile, record.catalogue !== undefined);
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
  if (lenses !== 1) throw new InvalidConfigurationError(ext ? "Give exactly one of focalLengthMm, equivalentFocalLengthMm and catalogue." : "Give exactly one of focalLengthMm and equivalentFocalLengthMm.");
  let crop = calculateEquivalentFocalLength35Mm({ focalLengthMm: 1, activeImagingArea: { widthMm: sensorW, heightMm: sensorH } }).value.cropFactor35Mm;
  let catalogue: CatalogueChoice | null = null;
  if (record.catalogue !== undefined) {
    const given = record.catalogue, entry = typeof given === "object" && given !== null ? given as Record<string, unknown> : { kind: given };
    for (const key of Object.keys(entry)) if (key !== "kind" && key !== "breathing") throw new InvalidConfigurationError("Unknown catalogue field: " + key + ".");
    if (entry.breathing !== undefined && typeof entry.breathing !== "boolean") throw new InvalidConfigurationError("catalogue.breathing must be a boolean.");
    catalogue = { lens: ext!.resolveLens(entry.kind as string, lensSensor ?? { widthMm: sensorW, heightMm: sensorH }), breathing: entry.breathing === true };
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

/** @internal The subject-distance fit of both framing modules (`ext` adds the catalogue and the sensor profiles). */
export function subjectDistanceForFraming(input: CalculateSubjectDistanceForFramingInput, name: string, ext?: FramingExtensions): SubjectFraming {
  const { sensorW, sensorH, crop, equivalent, focalLengthMm, prime, widthM, heightM, assumptions, catalogue } = resolveFramingInput(input, name, ["fit"], ext);
  const fit = input.fit ?? "contain";
  if (!["contain", "width", "height", "cover"].includes(fit)) throw new InvalidConfigurationError("fit must be contain, width, height or cover.");
  if (input.fit === undefined) assumptions.push({ id: "fit", kind: "default", value: "contain", explanation: "The whole chart is visible: the side whose chart-to-sensor ratio is larger (the limiting side) fills the frame." });
  if (catalogue) return ext!.fit(catalogue, sensorW, sensorH, crop, widthM, heightM, fit, assumptions);
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

/** 2.6: the close-up light factor at a focus distance, from the irradiance bridge's own working f-number factor. */
/** @internal */
export function closeUpLight(focalLengthMm: number, focusDistanceM: number): { closeUpTransmission: number; closeUpLossStops: number } {
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

/** @internal The chart coverage of both framing modules (`ext` adds the catalogue and the sensor profiles). */
export function chartFraming(input: CalculateChartFramingInput, name: string, ext?: FramingExtensions): ChartFraming {
  const { record, sensorW, sensorH, crop, equivalent, focalLengthMm, prime, widthM, heightM, assumptions, catalogue } = resolveFramingInput(input, name,
    ["subjectDistanceM", "focusDistanceM"], ext);
  const subjectDistanceM = positive(record.subjectDistanceM, "subjectDistanceM");
  const focusDistanceM = record.focusDistanceM === undefined ? subjectDistanceM : positive(record.focusDistanceM, "focusDistanceM");
  if (record.focusDistanceM === undefined) assumptions.push({ id: "focusDistanceM", kind: "default", value: subjectDistanceM, explanation: "The lens is focused on the chart plane." });
  const f = focalLengthMm / 1000;
  if (!(subjectDistanceM > f) || !(focusDistanceM > f)) throw new InvalidConfigurationError("subjectDistanceM and focusDistanceM must be more than the focal length (" + f + " m).");
  if (catalogue) {
    const framing = ext!.frame(catalogue, sensorW, sensorH, widthM, heightM, subjectDistanceM, focusDistanceM), minimumFocusDistanceM = catalogue.lens.minimumFocusDistanceM;
    ext!.assumptions(catalogue, { magnification: framing.magnification, imageDistanceMm: framing.imageDistanceMm, breathingScale: framing.lens.breathingScale }, assumptions);
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

/** #646: the input of {@link calculateThinLensSubjectDistanceForFraming}: `CalculateSubjectDistanceForFramingInput` without `catalogue` and `sensorProfile`. */
export type ThinLensSubjectDistanceForFramingInput = Omit<CalculateSubjectDistanceForFramingInput, "catalogue" | "sensorProfile">;
/** #646: the input of {@link calculateThinLensChartFraming}: `CalculateChartFramingInput` without `catalogue` and `sensorProfile`. */
export type ThinLensChartFramingInput = Omit<CalculateChartFramingInput, "catalogue" | "sensorProfile">;

/**
 * #646 (2.26.0): `calculateSubjectDistanceForFraming` for a thin lens on a sensor (`focalLengthMm` or `equivalentFocalLengthMm`
 * and `sensor`), with the same code and results, from a module that imports neither the lens catalogue nor the sensor profiles; a
 * `catalogue` or `sensorProfile` field is refused as unknown. Use it when a bundle should not contain them.
 */
export function calculateThinLensSubjectDistanceForFraming(input: ThinLensSubjectDistanceForFramingInput): SubjectFraming {
  return subjectDistanceForFraming(input, "calculateThinLensSubjectDistanceForFraming");
}

/**
 * #646 (2.26.0): `calculateChartFraming` for a thin lens on a sensor, with the same code and results, from a module that imports
 * neither the lens catalogue nor the sensor profiles; a `catalogue` or `sensorProfile` field is refused as unknown.
 */
export function calculateThinLensChartFraming(input: ThinLensChartFramingInput): ChartFraming {
  return chartFraming(input, "calculateThinLensChartFraming");
}
