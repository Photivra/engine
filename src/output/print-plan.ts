// SPDX-License-Identifier: Apache-2.0

/** Print planning: how many native pixels a print of a given size and viewing distance needs.
 * It uses native capture pixels only. It does not make an image or certify perceived quality.
 * @see docs/PRINT_PLANNING.md for equations, rounding and support limits.
 */
import { calculatedResult, approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { requirePositiveFinite, requirePositiveInteger } from "../core/validation.js";
import { ENGINE_API_VERSION } from "../core/version.js";
import { resolveCaptureGeometry, type ResolveCaptureGeometryInput } from "./capture-geometry.js";
import type { RasterDimensions } from "../sensor/sensor-geometry.js";

/** A physical length. Not to be confused with image pixels or printer dots. */
export interface PrintLength { value: number; unit: "mm" | "cm" | "inches" | "m" }
/** The flat printed image area. It excludes paper margins, borders and canvas wraps.
 * With a `contain` fit it is instead the paper, or the printable area of it, that the image is fitted inside.
 */
export interface PrintedImageSize { width: number; height: number; unit: PrintLength["unit"] }
/** How to choose pixel density: one of three angular criteria at the viewing distance, or a manual PPI (pixels per inch), which gives a different kind of plan. */
export type PrintSamplingCriterion =
  | { kind: "angular-pixel-pitch"; maximumArcminutesPerPixel: number }
  | { kind: "angular-stroke"; strokeWidthArcminutes: number; samplesPerStroke: number }
  | { kind: "angular-line-pair"; periodArcminutes: number; samplesPerPeriod: number }
  | { kind: "manual-ppi"; pixelsPerInch: number };
/** The declared native source geometry. Not a preview or a resampled pixel count. */
export type PrintNativeSource =
  | { kind: "native-retained"; captureId: string; geometry: ResolveCaptureGeometryInput }
  | { kind: "unavailable"; reason: "missing-native-raster" | "unverified-native-identity" };
/** Print lab requirements supplied by the caller. There is no vendor catalogue and no guarantee of what a lab will accept. */
export interface PrintProviderConstraints {
  minimumRaster?: RasterDimensions;
  exactRaster?: RasterDimensions;
  minimumPpi?: number;
  exactPpi?: number;
}
/** How the printed image relates to `printedImage`.
 * - `confirmed-native-aspect`: `printedImage` is the printed image itself and must already have the native aspect ratio,
 *   within the stated relative error.
 * - `contain`: `printedImage` is the paper. The image keeps the native aspect ratio and is scaled to the largest size that
 *   fits inside it, centered; the rest is unprinted border. `match-image` turns the paper a quarter turn when its
 *   orientation (portrait or landscape) differs from the image's; `as-given` keeps it. Layout only: nothing is cropped or resampled.
 */
export type PrintFit =
  | { kind: "confirmed-native-aspect"; maximumRelativeAspectError: number }
  | { kind: "contain"; paperOrientation: "as-given" | "match-image" };
/** The layout of a `contain` fit, in millimetres. The printed image itself is the plan's `printedImageMm`. */
export interface PrintContainLayout {
  /** The paper as placed: after the quarter turn when `paperRotated`. */
  paperMm: { width: number; height: number };
  paperRotated: boolean;
  /** Unprinted border on each side of the centered image; zero when the paper has the image's aspect ratio. */
  bordersMm: { left: number; right: number; top: number; bottom: number };
}
/** Plan input. The output keeps the exact native aspect ratio; the allowed physical aspect error is explicit and reported. */
export interface PrintPlanInput {
  source: PrintNativeSource;
  printedImage: PrintedImageSize;
  viewingDistance: PrintLength;
  sampling: PrintSamplingCriterion;
  fit: PrintFit;
  provider?: PrintProviderConstraints;
}
/** Pixel density and angular pixel pitch for each axis. The angles are pure geometry, not a measure of visual acuity. */
export interface PrintRasterSampling {
  raster: RasterDimensions;
  pixelsPerInch: { x: number; y: number };
  angularPixelPitchArcminutes: { x: number; y: number };
}
/** A plan, valid only under its stated conditions. A null recommendation never means it is fine to upscale. */
export interface PrintPlan {
  engineApiVersion: string;
  input: PrintPlanInput;
  status: "ready" | "insufficient-native-pixels" | "provider-conflict" | "crop-confirmation-required" | "cannot-assess" | "unsupported";
  nativePixelSufficiency: "sufficient" | "insufficient" | "cannot-assess";
  reasons: string[];
  printedImageMm: { width: number; height: number } | null;
  viewingDistanceMm: number | null;
  guidance: CalculationResult<{ derivedPixelsPerInch: number; maximumPixelPitchMm: number; maximumArcminutesPerPixel: number | null }> | null;
  relativeAspectError: number | null;
  native: PrintRasterSampling | null;
  minimumSamplingRaster: RasterDimensions | null;
  recommended: PrintRasterSampling | null;
  resamplingScale: { x: number; y: number } | null;
  alternatives: { maximumImageMmAtCurrentDistance: { width: number; height: number }; minimumViewingDistanceMmAtCurrentSize: number | null } | null;
  capturedDetailAssessment: "unassessed";
  deliveryAssessment: "unassessed";
  /** Present only with a `contain` fit; null when the native raster is unknown. */
  contain?: PrintContainLayout | null;
}

const UNIT_MM = { mm: 1, cm: 10, inches: 25.4, m: 1000 } as const;
const RAD_PER_ARCMIN = Math.PI / 10800;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(value, keys, "Invalid or unknown Print planning fields.");
}
function number(value: unknown, name: string): number {
  if (typeof value !== "number") throw new InvalidConfigurationError(`${name} must be numeric.`);
  requirePositiveFinite(name, value); return value;
}
function unit(value: unknown): PrintLength["unit"] {
  if (typeof value !== "string" || !Object.hasOwn(UNIT_MM, value)) throw new InvalidConfigurationError("Invalid Print length unit.");
  return value as PrintLength["unit"];
}
function length(value: unknown): PrintLength {
  const r = record(value, ["value", "unit"]);
  return { value: number(r.value, "length.value"), unit: unit(r.unit) };
}
function raster(value: unknown): RasterDimensions {
  const r = record(value, ["pixelWidth", "pixelHeight"]);
  const pixelWidth = number(r.pixelWidth, "pixelWidth"), pixelHeight = number(r.pixelHeight, "pixelHeight");
  requirePositiveInteger("pixelWidth", pixelWidth); requirePositiveInteger("pixelHeight", pixelHeight);
  return { pixelWidth, pixelHeight };
}
function geometry(value: unknown): ResolveCaptureGeometryInput {
  const g = record(value, ["imagingArea", "nativeRaster", "orientation", "activeCaptureRect", "outputCropRect", "outputRaster"]);
  record(g.imagingArea, ["widthMm", "heightMm"]); raster(g.nativeRaster);
  for (const key of ["activeCaptureRect", "outputCropRect"] as const) {
    if (g[key] !== undefined) record(g[key], ["x", "y", "width", "height"]);
  }
  if (g.outputRaster !== undefined) raster(g.outputRaster);
  // The capture geometry module defines units, orientations, bounds and the optical axis.
  const parsed = g as unknown as ResolveCaptureGeometryInput;
  resolveCaptureGeometry(parsed);
  return structuredCloneGeometry(parsed);
}
function structuredCloneGeometry(g: ResolveCaptureGeometryInput): ResolveCaptureGeometryInput {
  return { imagingArea: { ...g.imagingArea }, nativeRaster: { ...g.nativeRaster }, orientation: g.orientation,
    ...(g.activeCaptureRect === undefined ? {} : { activeCaptureRect: { ...g.activeCaptureRect } }),
    ...(g.outputCropRect === undefined ? {} : { outputCropRect: { ...g.outputCropRect } }),
    ...(g.outputRaster === undefined ? {} : { outputRaster: { ...g.outputRaster } }) };
}
function sampling(value: unknown): PrintSamplingCriterion {
  const tag = record(value, ["kind", "maximumArcminutesPerPixel", "strokeWidthArcminutes", "samplesPerStroke", "periodArcminutes", "samplesPerPeriod", "pixelsPerInch"]);
  let result: PrintSamplingCriterion;
  switch (tag.kind) {
    case "manual-ppi": {
      const r = record(value, ["kind", "pixelsPerInch"]);
      return { kind: "manual-ppi", pixelsPerInch: number(r.pixelsPerInch, "pixelsPerInch") };
    }
    case "angular-pixel-pitch": {
      const r = record(value, ["kind", "maximumArcminutesPerPixel"]);
      result = { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: number(r.maximumArcminutesPerPixel, "maximumArcminutesPerPixel") }; break;
    }
    case "angular-stroke": {
      const r = record(value, ["kind", "strokeWidthArcminutes", "samplesPerStroke"]);
      const samplesPerStroke = number(r.samplesPerStroke, "samplesPerStroke"); requirePositiveInteger("samplesPerStroke", samplesPerStroke);
      result = { kind: "angular-stroke", strokeWidthArcminutes: number(r.strokeWidthArcminutes, "strokeWidthArcminutes"), samplesPerStroke }; break;
    }
    case "angular-line-pair": {
      const r = record(value, ["kind", "periodArcminutes", "samplesPerPeriod"]);
      const samplesPerPeriod = number(r.samplesPerPeriod, "samplesPerPeriod"); requirePositiveInteger("samplesPerPeriod", samplesPerPeriod);
      if (samplesPerPeriod < 2) throw new InvalidConfigurationError("A line-pair period requires at least two samples.");
      result = { kind: "angular-line-pair", periodArcminutes: number(r.periodArcminutes, "periodArcminutes"), samplesPerPeriod }; break;
    }
    default: throw new InvalidConfigurationError("Invalid Print sampling convention.");
  }
  const angle = angularLimit(result);
  if (angle <= 0 || angle >= 10800) throw new InvalidConfigurationError("Effective angular pixel pitch must lie in (0, 10800) arcminutes.");
  return result;
}
function angularLimit(s: Exclude<PrintSamplingCriterion, { kind: "manual-ppi" }>): number {
  switch (s.kind) {
    case "angular-pixel-pitch": return s.maximumArcminutesPerPixel;
    case "angular-stroke": return s.strokeWidthArcminutes / s.samplesPerStroke;
    case "angular-line-pair": return s.periodArcminutes / s.samplesPerPeriod;
  }
}

/** Validates and copies an untrusted print request. It never assumes the source is native if that is not declared. */
export function parsePrintPlanInput(value: unknown): PrintPlanInput {
  const r = record(value, ["source", "printedImage", "viewingDistance", "sampling", "fit", "provider"]);
  const source = record(r.source, ["kind", "captureId", "geometry", "reason"]);
  let parsedSource: PrintNativeSource;
  if (source.kind === "native-retained") {
    record(r.source, ["kind", "captureId", "geometry"]);
    parsedSource = { kind: "native-retained", captureId: requirePublicOpaqueId(source.captureId, "Invalid public capture ID."), geometry: geometry(source.geometry) };
  } else if (source.kind === "unavailable") {
    record(r.source, ["kind", "reason"]);
    if (source.reason !== "missing-native-raster" && source.reason !== "unverified-native-identity") throw new InvalidConfigurationError("Invalid native-unavailable reason.");
    parsedSource = { kind: "unavailable", reason: source.reason };
  } else throw new InvalidConfigurationError("Invalid native source kind.");
  const image = record(r.printedImage, ["width", "height", "unit"]);
  const parsed: PrintPlanInput = { source: parsedSource, printedImage: { width: number(image.width, "printedImage.width"), height: number(image.height, "printedImage.height"), unit: unit(image.unit) }, viewingDistance: length(r.viewingDistance), sampling: sampling(r.sampling), fit: parseFit(r.fit) };
  if (r.provider !== undefined) {
    const p = record(r.provider, ["minimumRaster", "exactRaster", "minimumPpi", "exactPpi"]);
    parsed.provider = {
      ...(p.minimumRaster === undefined ? {} : { minimumRaster: raster(p.minimumRaster) }),
      ...(p.exactRaster === undefined ? {} : { exactRaster: raster(p.exactRaster) }),
      ...(p.minimumPpi === undefined ? {} : { minimumPpi: number(p.minimumPpi, "minimumPpi") }),
      ...(p.exactPpi === undefined ? {} : { exactPpi: number(p.exactPpi, "exactPpi") })
    };
  }
  return parsed;
}
function parseFit(value: unknown): PrintFit {
  const fit = record(value, ["kind", "maximumRelativeAspectError", "paperOrientation"]);
  if (fit.kind === "contain") {
    record(value, ["kind", "paperOrientation"]);
    if (fit.paperOrientation !== "as-given" && fit.paperOrientation !== "match-image") throw new InvalidConfigurationError("Declare a contain-fit paper orientation: as-given or match-image.");
    return { kind: "contain", paperOrientation: fit.paperOrientation };
  }
  if (fit.kind !== "confirmed-native-aspect" || fit.paperOrientation !== undefined || typeof fit.maximumRelativeAspectError !== "number" || !Number.isFinite(fit.maximumRelativeAspectError) || fit.maximumRelativeAspectError < 0 || fit.maximumRelativeAspectError > 0.01) throw new InvalidConfigurationError("Declare a native-aspect fit tolerance in [0, 0.01].");
  return { kind: "confirmed-native-aspect", maximumRelativeAspectError: fit.maximumRelativeAspectError };
}
/** The largest image at the native aspect ratio inside the paper, in the paper's unit, and its centered layout.
 * The binding axis equals the paper exactly; the other is clamped so rounding never makes a negative border.
 */
function containImage(native: RasterDimensions, paperWidth: number, paperHeight: number, orientation: "as-given" | "match-image"): { width: number; height: number; paperWidth: number; paperHeight: number; paperRotated: boolean } {
  const imageLandscape = native.pixelWidth > native.pixelHeight, imagePortrait = native.pixelWidth < native.pixelHeight;
  const paperRotated = orientation === "match-image" && ((imageLandscape && paperWidth < paperHeight) || (imagePortrait && paperWidth > paperHeight));
  const pw = paperRotated ? paperHeight : paperWidth, ph = paperRotated ? paperWidth : paperHeight;
  const widthBinds = native.pixelWidth * ph >= native.pixelHeight * pw;
  const width = widthBinds ? pw : Math.min(pw, ph * native.pixelWidth / native.pixelHeight);
  const height = widthBinds ? Math.min(ph, pw * native.pixelHeight / native.pixelWidth) : ph;
  return { width, height, paperWidth: pw, paperHeight: ph, paperRotated };
}
function gcd(a: number, b: number): number { while (b !== 0) { const next = a % b; a = b; b = next; } return a; }
function positiveSupported(...values: number[]): boolean { return values.every(v => Number.isFinite(v) && v > 0); }
// Stepping to the adjacent double rounds outward. It is not a tolerance on the criterion.
function adjacentPositive(value: number, direction: "up" | "down"): number {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + (direction === "up" ? 1n : -1n));
  return view.getFloat64(0);
}
function exactRatio(a: RasterDimensions, b: RasterDimensions): boolean {
  return BigInt(a.pixelWidth) * BigInt(b.pixelHeight) === BigInt(a.pixelHeight) * BigInt(b.pixelWidth);
}
function minimumRaster(native: RasterDimensions, width: number, height: number): RasterDimensions | null {
  const divisor = gcd(native.pixelWidth, native.pixelHeight);
  const x = native.pixelWidth / divisor, y = native.pixelHeight / divisor;
  const count = Math.max(1, Math.ceil(width / x), Math.ceil(height / y));
  const pixelWidth = count * x, pixelHeight = count * y;
  return Number.isSafeInteger(pixelWidth) && Number.isSafeInteger(pixelHeight) ? { pixelWidth, pixelHeight } : null;
}
function diagnostics(raster: RasterDimensions, width: number, height: number, distance: number): PrintRasterSampling {
  const px = width / raster.pixelWidth, py = height / raster.pixelHeight;
  return { raster, pixelsPerInch: { x: 25.4 / px, y: 25.4 / py }, angularPixelPitchArcminutes: { x: 2 * Math.atan((px / distance) / 2) / RAD_PER_ARCMIN, y: 2 * Math.atan((py / distance) / 2) / RAD_PER_ARCMIN } };
}

/** Finds the smallest file, at the exact native aspect ratio, that meets the declared sampling and lab constraints.
 * The angular guidance is an approximate rule of thumb; the geometry itself is calculated exactly. A common criterion,
 * one arcminute per pixel, is normal (20/20) visual acuity under optimal conditions: the minimum angle of resolution of an
 * ideal eye is about 1 minute of arc, and 20/20 letters are built from elements that each subtend 1 arcmin (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in Adults", EyeWiki, American Academy of Ophthalmology,
 * https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited June 16, 2026).
 * Some viewers resolve finer detail and many resolve coarser, so it stays a rule of thumb, and the criterion is the caller's.
 * It does not assess source detail, perceived quality, file writing or available resources.
 */
export function calculatePrintPlan(value: PrintPlanInput): CalculationResult<PrintPlan> {
  const input = parsePrintPlanInput(value);
  const plan: PrintPlan = { engineApiVersion: ENGINE_API_VERSION, input, status: "cannot-assess", nativePixelSufficiency: "cannot-assess", reasons: [], printedImageMm: null, viewingDistanceMm: null, guidance: null, relativeAspectError: null, native: null, minimumSamplingRaster: null, recommended: null, resamplingScale: null, alternatives: null, capturedDetailAssessment: "unassessed", deliveryAssessment: "unassessed" };
  const contain = input.fit.kind === "contain" ? input.fit : null;
  if (contain !== null) plan.contain = null;
  const finish = (): CalculationResult<PrintPlan> => calculatedResult(plan, "native-only-print-plan", "0.1.0", ["Declared native authority; flat image, normal viewing at image center.", "Output preserves the exact retained native aspect ratio; no upscale.", "Angular sampling is conditional guidance, not captured-detail or print-quality certification.", ...(contain === null ? [] : ["Contain fit: the image is centered inside the paper; the borders are unprinted and the paper is not a print area."])]);
  const unsupported = (): CalculationResult<PrintPlan> => { plan.status = "unsupported"; plan.nativePixelSufficiency = "cannot-assess"; plan.reasons.push("unsupported-numeric-range"); return finish(); };
  const unitMm = UNIT_MM[input.printedImage.unit], distance = input.viewingDistance.value * UNIT_MM[input.viewingDistance.unit];
  // A contain fit needs the native aspect ratio before the printed image size is known.
  const resolved = input.source.kind === "native-retained" ? resolveCaptureGeometry(input.source.geometry).value : null;
  const native = resolved === null ? null : { pixelWidth: resolved.output.cropRect.width, pixelHeight: resolved.output.cropRect.height };
  const fitted = contain === null || native === null ? null : containImage(native, input.printedImage.width, input.printedImage.height, contain.paperOrientation);
  const imageWidth = fitted?.width ?? input.printedImage.width, imageHeight = fitted?.height ?? input.printedImage.height;
  const width = imageWidth * unitMm, height = imageHeight * unitMm;
  if (!positiveSupported(width, height, distance)) return unsupported();
  if (contain === null || fitted !== null) plan.printedImageMm = { width, height };
  plan.viewingDistanceMm = distance;
  const angle = input.sampling.kind === "manual-ppi" ? null : angularLimit(input.sampling);
  const pitchFactor = angle === null ? null : 2 * Math.tan((angle * RAD_PER_ARCMIN) / 2);
  const pitch = input.sampling.kind === "manual-ppi" ? 25.4 / input.sampling.pixelsPerInch : distance * (pitchFactor ?? 0);
  const ppi = input.sampling.kind === "manual-ppi" ? input.sampling.pixelsPerInch : 25.4 / pitch;
  if (!positiveSupported(pitch, ppi, width / pitch, height / pitch)) return unsupported();
  const guidance = { derivedPixelsPerInch: ppi, maximumPixelPitchMm: pitch, maximumArcminutesPerPixel: angle };
  plan.guidance = angle === null ? calculatedResult(guidance, "manual-print-density", "0.1.0", ["Explicit manual PPI plan; no angular criterion is certified."]) : approximationResult(guidance, "declared-angular-print-sampling", "0.1.0", ["Exact centered pixel angle uses 2 atan(pitch / (2 distance)); no small-angle substitution.", "Declared angular sampling convention is an uncalibrated usage assumption."]);
  if (input.source.kind === "unavailable" || native === null) { if (input.source.kind === "unavailable") plan.reasons.push(input.source.reason); return finish(); }
  if (fitted !== null) {
    const paperWidth = fitted.paperWidth * unitMm, paperHeight = fitted.paperHeight * unitMm;
    // Borders are taken in the paper's unit, then converted, so whole-unit borders stay exact.
    const side = (paper: number, image: number): number => Math.max(0, (paper - image) / 2) * unitMm;
    const x = side(fitted.paperWidth, imageWidth), y = side(fitted.paperHeight, imageHeight);
    if (!positiveSupported(paperWidth, paperHeight) || !Number.isFinite(x) || !Number.isFinite(y)) return unsupported();
    plan.contain = { paperMm: { width: paperWidth, height: paperHeight }, paperRotated: fitted.paperRotated, bordersMm: { left: x, right: x, top: y, bottom: y } };
  }
  const aspectError = Math.abs((width / height) / (native.pixelWidth / native.pixelHeight) - 1);
  if (!Number.isFinite(aspectError)) return unsupported();
  plan.relativeAspectError = aspectError;
  const nativeDiagnostics = diagnostics(native, width, height, distance);
  if (!positiveSupported(nativeDiagnostics.pixelsPerInch.x, nativeDiagnostics.pixelsPerInch.y, nativeDiagnostics.angularPixelPitchArcminutes.x, nativeDiagnostics.angularPixelPitchArcminutes.y)) return unsupported();
  plan.native = nativeDiagnostics;
  // A contain fit has the native aspect ratio by construction; its rounding error is reported, not checked.
  if (input.fit.kind === "confirmed-native-aspect" && aspectError > input.fit.maximumRelativeAspectError) { plan.status = "crop-confirmation-required"; plan.reasons.push("printed-image-and-confirmed-crop-aspect-mismatch"); return finish(); }
  const widthInches = input.printedImage.unit === "inches" ? imageWidth : width / 25.4;
  const heightInches = input.printedImage.unit === "inches" ? imageHeight : height / 25.4;
  const required = input.sampling.kind === "manual-ppi"
    ? minimumRaster(native, widthInches * ppi, heightInches * ppi)
    : minimumRaster(native, width / pitch, height / pitch);
  if (required === null) return unsupported();
  plan.minimumSamplingRaster = required;
  const sufficient = required.pixelWidth <= native.pixelWidth && required.pixelHeight <= native.pixelHeight;
  plan.nativePixelSufficiency = sufficient ? "sufficient" : "insufficient";
  let maxScale = Math.min(native.pixelWidth * pitch / width, native.pixelHeight * pitch / height);
  let minimumDistance = pitchFactor === null ? null : Math.max(width / native.pixelWidth, height / native.pixelHeight) / pitchFactor;
  let maxWidth = width * maxScale, maxHeight = height * maxScale;
  if (!positiveSupported(maxWidth, maxHeight) || (minimumDistance !== null && !positiveSupported(minimumDistance))) return unsupported();
  const fits = (w: number, h: number, p: number): boolean => {
    const candidate = input.sampling.kind === "manual-ppi" ? minimumRaster(native, w / 25.4 * ppi, h / 25.4 * ppi) : minimumRaster(native, w / p, h / p);
    return candidate !== null && candidate.pixelWidth <= native.pixelWidth && candidate.pixelHeight <= native.pixelHeight;
  };
  // Return only alternatives that still pass their own documented integer rule.
  for (let i = 0; i < 8 && !fits(maxWidth, maxHeight, pitch); i++) {
    maxScale = adjacentPositive(maxScale, "down"); maxWidth = width * maxScale; maxHeight = height * maxScale;
  }
  if (!positiveSupported(maxWidth, maxHeight) || !fits(maxWidth, maxHeight, pitch)) return unsupported();
  if (minimumDistance !== null && pitchFactor !== null) {
    for (let i = 0; i < 8 && !fits(width, height, minimumDistance * pitchFactor); i++) minimumDistance = adjacentPositive(minimumDistance, "up");
    if (!positiveSupported(minimumDistance) || !fits(width, height, minimumDistance * pitchFactor)) return unsupported();
  }
  plan.alternatives = { maximumImageMmAtCurrentDistance: { width: maxWidth, height: maxHeight }, minimumViewingDistanceMmAtCurrentSize: minimumDistance };
  if (!sufficient) { plan.status = "insufficient-native-pixels"; plan.reasons.push("sampling-requires-native-upscale"); }
  let file = required;
  const provider = input.provider;
  if (provider) {
    const density = Math.max(provider.minimumPpi ?? 0, provider.exactPpi ?? 0);
    const constrained = minimumRaster(native, Math.max(required.pixelWidth, provider.minimumRaster?.pixelWidth ?? 0, widthInches * density), Math.max(required.pixelHeight, provider.minimumRaster?.pixelHeight ?? 0, heightInches * density));
    if (constrained === null) return unsupported();
    file = provider.exactRaster ?? constrained;
    if (provider.exactPpi !== undefined) {
      const exact = { pixelWidth: widthInches * provider.exactPpi, pixelHeight: heightInches * provider.exactPpi };
      if (!Number.isSafeInteger(exact.pixelWidth) || !Number.isSafeInteger(exact.pixelHeight)) plan.reasons.push("exact-provider-density-has-no-integer-raster");
      else if (provider.exactRaster && (exact.pixelWidth !== file.pixelWidth || exact.pixelHeight !== file.pixelHeight)) plan.reasons.push("provider-exact-raster-density-conflict");
      else file = exact;
    }
    if (!exactRatio(file, native)) plan.reasons.push("provider-raster-aspect-conflict");
    if (file.pixelWidth < constrained.pixelWidth || file.pixelHeight < constrained.pixelHeight) plan.reasons.push("provider-exact-requirement-below-minimum");
    if (file.pixelWidth > native.pixelWidth || file.pixelHeight > native.pixelHeight) plan.reasons.push("provider-requires-native-upscale");
    if (plan.reasons.some(r => r.startsWith("provider-") || r.startsWith("exact-provider-"))) { plan.status = "provider-conflict"; return finish(); }
  }
  if (!sufficient) return finish();
  const achieved = diagnostics(file, width, height, distance);
  if (!positiveSupported(achieved.pixelsPerInch.x, achieved.pixelsPerInch.y, achieved.angularPixelPitchArcminutes.x, achieved.angularPixelPitchArcminutes.y)) return unsupported();
  plan.status = "ready"; plan.recommended = achieved;
  plan.resamplingScale = { x: file.pixelWidth / native.pixelWidth, y: file.pixelHeight / native.pixelHeight };
  return finish();
}

/** Input for the largest-print-size query. It keeps the reference plan's aspect ratio and criterion.
 * With proportional viewing, the reference viewing distance scales with the image size.
 */
export interface PrintSizeLimitInput {
  plan: PrintPlanInput;
  viewingDistancePolicy: "fixed" | "proportional-to-image-size";
}
/** Result of the size query. A status says "unbounded" rather than using Infinity. "no-positive-size" is a valid answer, not an input error. */
export interface PrintSizeLimit {
  engineApiVersion: string;
  status: "finite" | "unbounded" | "no-positive-size" | "cannot-assess" | "unsupported";
  maximumImageMm: { width: number; height: number } | null;
  reasons: string[];
  referencePlan: PrintPlan;
  /** Present only with a `contain` fit: the paper that holds `maximumImageMm` with the same layout (borders scale with it). */
  maximumPaperMm?: { width: number; height: number } | null;
}
/** Calculates the largest print size under the stated conditions. Lab constraints need individual plans,
 * so this size query reports them as unsupported rather than ignoring them.
 * As in `calculatePrintPlan`, an angular criterion is an approximate rule of thumb: one arcminute per pixel is normal
 * (20/20) acuity under optimal conditions, which some viewers exceed and many do not (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in Adults", EyeWiki, American Academy of Ophthalmology,
 * https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited June 16, 2026).
 */
export function calculatePrintSizeLimit(value: PrintSizeLimitInput): CalculationResult<PrintSizeLimit> {
  const r = record(value, ["plan", "viewingDistancePolicy"]);
  if (r.viewingDistancePolicy !== "fixed" && r.viewingDistancePolicy !== "proportional-to-image-size") throw new InvalidConfigurationError("Invalid viewing-distance scaling policy.");
  const referencePlan = calculatePrintPlan(parsePrintPlanInput(r.plan)).value;
  const result: PrintSizeLimit = { engineApiVersion: ENGINE_API_VERSION, status: "cannot-assess", maximumImageMm: null, reasons: [...referencePlan.reasons], referencePlan };
  if (referencePlan.input.provider !== undefined && Object.keys(referencePlan.input.provider).length > 0) {
    result.status = "unsupported"; result.reasons.push("size-query-with-provider-constraints-unsupported");
  } else if (referencePlan.status === "unsupported") result.status = "unsupported";
  else if (referencePlan.alternatives !== null) {
    if (r.viewingDistancePolicy === "proportional-to-image-size" && referencePlan.input.sampling.kind !== "manual-ppi") {
      result.status = referencePlan.nativePixelSufficiency === "sufficient" ? "unbounded" : "no-positive-size";
    } else { result.status = "finite"; result.maximumImageMm = referencePlan.alternatives.maximumImageMmAtCurrentDistance; }
  }
  if (referencePlan.input.fit.kind === "contain") {
    const layout = referencePlan.contain, image = referencePlan.printedImageMm, maximum = result.maximumImageMm;
    const scale = layout && image && maximum ? maximum.width / image.width : null;
    result.maximumPaperMm = layout && scale !== null && positiveSupported(layout.paperMm.width * scale, layout.paperMm.height * scale) ? { width: layout.paperMm.width * scale, height: layout.paperMm.height * scale } : null;
  }
  return calculatedResult(result, "conditional-native-print-size-limit", "0.1.0", ["Native sampling capacity only; no perceived-quality or physical-printer bound.", "Proportional distance and image scaling preserve angular pixel pitch."]);
}
