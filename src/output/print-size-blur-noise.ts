// SPDX-License-Identifier: Apache-2.0

/** Print size limit that counts the capture's blur and noise as well as its pixels (#574).
 * A pure function: it makes no image and is not used by the capture path.
 * @see docs/PRINT_PLANNING.md, "Print size limit with blur and noise", for the equations, sources and limits.
 */
import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord, requireInputKeys, requireInputNonNegativeFinite, requireInputPositiveFinite } from "../core/record-validation.js";
import { requirePositiveInteger } from "../core/validation.js";
import { ENGINE_API_VERSION } from "../core/version.js";
import { calculateSignalToNoise } from "../sensor/signal-noise.js";
import type { RasterDimensions } from "../sensor/sensor-geometry.js";
import type { PrintLength } from "./print-plan.js";
import type { SimulateCaptureSensorReport } from "../sensor/sensor-characteristics.js";

/** The capture's blur at the sensor plane, as blur-spot diameters in millimetres.
 * `components` combines the parts by root-sum-square (an approximation, see the docs); `measured-total` is one measured diameter.
 * A zero component is allowed and means that part is left out. Engine helpers give the parts: `calculateDefocusCircle` (defocus),
 * `calculateAiryDisk` (diffraction, micrometres), `calculateProjectedMotionBlur` (motion length).
 */
export type PrintBlurInput =
  | { kind: "components"; lensMm?: number; defocusMm?: number; diffractionMm?: number; motionMm?: number }
  | { kind: "measured-total"; diameterMm: number };
/** The noise of one pixel of the printed raster, for the tone the caller cares about (for example mid-gray).
 * `shot-and-read-noise` uses the engine's noise model (`calculateSignalToNoise`: Poisson shot noise plus RMS read noise);
 * `pixel-snr` is a per-pixel signal-to-noise ratio the caller already has. `capture-noise-figure` (2.20.0) takes a capture's own
 * mid-gray noise figure (#535: `result.sensor.midGrey` of a `simulateCapture` with `fast: false`), whose SNR S/σ_total counts photon
 * shot, read, dark-current, quantization and any fixed-pattern noise; it is one sensor site's, so it applies as the pixel SNR when one
 * printed pixel is one capture pixel. A clipped figure (the patch at white) is refused.
 */
export type PrintNoiseInput =
  | { kind: "shot-and-read-noise"; signalElectrons: number; readNoiseElectrons: number }
  | { kind: "pixel-snr"; snrLinear: number }
  | { kind: "capture-noise-figure"; midGrey: NonNullable<SimulateCaptureSensorReport["midGrey"]> };
/** What "looks sharp and clean" means: the smallest angle the viewer resolves, and the lowest signal-to-noise ratio the viewer
 * accepts after the eye averages over that angle. Both are the caller's choice; one arcminute is normal (20/20) acuity.
 */
export interface PrintSharpCleanCriterion {
  kind: "visual-resolution";
  arcminutes: number;
  minimumVisibleSnr: number;
}
/** Input. The raster is the retained image that is printed (after any crop), with square pixels; `pixelPitchMm` is the
 * sensor length one of those pixels covers. The print keeps the raster's aspect ratio. The viewing distance is fixed.
 */
export interface PrintSizeLimitWithBlurAndNoiseInput {
  raster: RasterDimensions;
  pixelPitchMm: number;
  viewingDistance: PrintLength;
  criterion: PrintSharpCleanCriterion;
  blur: PrintBlurInput;
  noise: PrintNoiseInput;
}
/** A print size in millimetres at the raster's aspect ratio. */
export interface PrintImageMm { width: number; height: number }
/** Result. Each factor's own limit is the largest print it allows on its own; null means that factor never limits.
 * `limitingFactor` names the smallest; on a tie the order is pixels, blur, noise.
 */
export interface PrintSizeLimitWithBlurAndNoise {
  engineApiVersion: string;
  status: "finite" | "no-positive-size";
  limitingFactor: "pixels" | "blur" | "noise";
  maximumImageMm: PrintImageMm;
  limits: { pixels: PrintImageMm; blur: PrintImageMm | null; noise: PrintImageMm | null };
  viewingDistanceMm: number;
  /** The criterion angle as a length on the print at the viewing distance: 2 d tan(θ/2). */
  resolvedSpotMm: number;
  blur: { diameterMm: number; diameterPixels: number; largestComponent: "lens" | "defocus" | "diffraction" | "motion" | "measured-total" | null };
  noise: { pixelSnr: number; visibleSnrAtMaximum: number };
}

const UNIT_MM = { mm: 1, cm: 10, inches: 25.4, m: 1000 } as const;
const RAD_PER_ARCMIN = Math.PI / 10800;
const BLUR_PARTS = ["lens", "defocus", "diffraction", "motion"] as const;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(value, keys, "Invalid or unknown print size limit fields.");
}
function parseBlur(value: unknown): { diameterMm: number; largestComponent: PrintSizeLimitWithBlurAndNoise["blur"]["largestComponent"] } {
  const r = record(value, ["kind", "lensMm", "defocusMm", "diffractionMm", "motionMm", "diameterMm"]);
  if (r.kind === "measured-total") {
    record(value, ["kind", "diameterMm"]);
    const diameterMm = requireInputNonNegativeFinite(r.diameterMm, "blur.diameterMm");
    return { diameterMm, largestComponent: diameterMm > 0 ? "measured-total" : null };
  }
  if (r.kind !== "components") throw new InvalidConfigurationError("Invalid print blur kind.");
  let sumSquares = 0, largest = 0, largestComponent: PrintSizeLimitWithBlurAndNoise["blur"]["largestComponent"] = null;
  for (const part of BLUR_PARTS) {
    const raw = r[`${part}Mm`];
    if (raw === undefined) continue;
    const d = requireInputNonNegativeFinite(raw, `blur.${part}Mm`);
    sumSquares += d * d;
    if (d > largest) { largest = d; largestComponent = part; }
  }
  return { diameterMm: Math.sqrt(sumSquares), largestComponent };
}
/** The one place the noise input becomes a per-pixel SNR, including a capture's own noise figure (#535). */
function resolvePixelSnr(value: unknown): number {
  const r = record(value, ["kind", "signalElectrons", "readNoiseElectrons", "snrLinear", "midGrey"]);
  switch (r.kind) {
    case "shot-and-read-noise": {
      record(value, ["kind", "signalElectrons", "readNoiseElectrons"]);
      return calculateSignalToNoise({ signalElectrons: r.signalElectrons as number, readNoiseElectrons: r.readNoiseElectrons as number }).value.snrLinear;
    }
    case "pixel-snr":
      record(value, ["kind", "snrLinear"]);
      return requireInputNonNegativeFinite(r.snrLinear, "noise.snrLinear");
    case "capture-noise-figure": {
      record(value, ["kind", "midGrey"]);
      const figure = r.midGrey as { signalElectrons?: unknown; noiseElectrons?: { total?: unknown }; clipped?: unknown } | null;
      if (typeof figure !== "object" || figure === null || typeof figure.noiseElectrons !== "object" || figure.noiseElectrons === null)
        throw new InvalidConfigurationError("noise.midGrey must be a capture's result.sensor.midGrey (simulateCapture with fast: false).");
      if (figure.clipped !== false) throw new InvalidConfigurationError("noise.midGrey is clipped (or not a capture's figure): the patch reaches white, where the figure no longer describes the image.");
      return requireInputNonNegativeFinite(figure.signalElectrons, "noise.midGrey.signalElectrons") / requireInputPositiveFinite(figure.noiseElectrons.total, "noise.midGrey.noiseElectrons.total");
    }
    default: throw new InvalidConfigurationError("Invalid print noise kind.");
  }
}

/** Calculates the largest print, at a fixed viewing distance, at which the capture still looks sharp and clean, and names
 * the factor that limits it: pixels, blur or noise. An approximation throughout; the equations are exact under its model.
 *
 * With θ the criterion angle, d the viewing distance, s = 2 d tan(θ/2) the length θ covers on the print, N_w the raster
 * width in pixels, b the blur diameter in pixels and SNR_px the per-pixel SNR (print width W, height in proportion):
 * - pixels: a print pixel (W / N_w) may cover at most s, so W ≤ N_w·s (as `calculatePrintPlan` with
 *   `angular-pixel-pitch`, before its whole-pixel rounding);
 * - blur: the blur on the print (b·W / N_w) may cover at most s, so W ≤ N_w·s / b: the criterion of an acceptable circle
 *   of confusion with the eye's resolution as the limit;
 * - noise: the eye averages the (W / N_w) wide pixels inside s, so the visible SNR is SNR_px·(N_w·s / W) while a pixel is
 *   smaller than s (the mean of n independent values has 1/√n of their standard deviation); W ≤ N_w·s·SNR_px / SNR_min,
 *   and noise never limits when SNR_px ≥ SNR_min.
 * One arcminute is normal (20/20) acuity under optimal conditions (Z. Alomar, K. D. Bojikian, "Visual Acuity Testing in
 * Adults", EyeWiki, American Academy of Ophthalmology, https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults, last edited
 * June 16, 2026); the SNR threshold has no default and is the caller's. Blur parts add in root-sum-square, which is exact
 * for Gaussian spots (variances of independent displacements add: C. M. Grinstead, J. L. Snell, "Introduction to
 * Probability", 2nd rev. ed., AMS 1997, sec. 6.2, free under the GNU FDL) and an approximation for discs and Airy patterns.
 */
export function calculatePrintSizeLimitWithBlurAndNoise(value: PrintSizeLimitWithBlurAndNoiseInput): CalculationResult<PrintSizeLimitWithBlurAndNoise> {
  const keys = ["raster", "pixelPitchMm", "viewingDistance", "criterion", "blur", "noise"];
  requireInputKeys(value, "calculatePrintSizeLimitWithBlurAndNoise", keys);
  const r = record(value, keys);
  const raster = record(r.raster, ["pixelWidth", "pixelHeight"]);
  const pixelWidth = requireInputPositiveFinite(raster.pixelWidth, "raster.pixelWidth"), pixelHeight = requireInputPositiveFinite(raster.pixelHeight, "raster.pixelHeight");
  requirePositiveInteger("raster.pixelWidth", pixelWidth); requirePositiveInteger("raster.pixelHeight", pixelHeight);
  const pixelPitchMm = requireInputPositiveFinite(r.pixelPitchMm, "pixelPitchMm");
  const distance = record(r.viewingDistance, ["value", "unit"]);
  if (typeof distance.unit !== "string" || !Object.hasOwn(UNIT_MM, distance.unit)) throw new InvalidConfigurationError("Invalid Print length unit.");
  const viewingDistanceMm = requireInputPositiveFinite(distance.value, "viewingDistance.value") * UNIT_MM[distance.unit as PrintLength["unit"]];
  const criterion = record(r.criterion, ["kind", "arcminutes", "minimumVisibleSnr"]);
  if (criterion.kind !== "visual-resolution") throw new InvalidConfigurationError("Invalid print criterion kind.");
  const arcminutes = requireInputPositiveFinite(criterion.arcminutes, "criterion.arcminutes");
  if (arcminutes >= 10800) throw new InvalidConfigurationError("criterion.arcminutes must lie in (0, 10800).");
  const minimumVisibleSnr = requireInputPositiveFinite(criterion.minimumVisibleSnr, "criterion.minimumVisibleSnr");
  const blur = parseBlur(r.blur);
  const pixelSnr = resolvePixelSnr(r.noise);

  const resolvedSpotMm = 2 * viewingDistanceMm * Math.tan((arcminutes * RAD_PER_ARCMIN) / 2);
  const pixelLimitWidth = pixelWidth * resolvedSpotMm;
  const blurPixels = blur.diameterMm / pixelPitchMm;
  const blurLimitWidth = blurPixels > 0 ? pixelLimitWidth / blurPixels : null;
  const noiseLimitWidth = pixelSnr < minimumVisibleSnr ? pixelLimitWidth * (pixelSnr / minimumVisibleSnr) : null;
  let limitingFactor: PrintSizeLimitWithBlurAndNoise["limitingFactor"] = "pixels", width = pixelLimitWidth;
  if (blurLimitWidth !== null && blurLimitWidth < width) { limitingFactor = "blur"; width = blurLimitWidth; }
  if (noiseLimitWidth !== null && noiseLimitWidth < width) { limitingFactor = "noise"; width = noiseLimitWidth; }
  const size = (w: number): PrintImageMm => ({ width: w, height: w * (pixelHeight / pixelWidth) });
  const visibleSnrAtMaximum = width > 0 ? pixelSnr * Math.max(1, pixelLimitWidth / width) : 0;
  const result: PrintSizeLimitWithBlurAndNoise = {
    engineApiVersion: ENGINE_API_VERSION, status: width > 0 ? "finite" : "no-positive-size", limitingFactor,
    maximumImageMm: size(width),
    limits: { pixels: size(pixelLimitWidth), blur: blurLimitWidth === null ? null : size(blurLimitWidth), noise: noiseLimitWidth === null ? null : size(noiseLimitWidth) },
    viewingDistanceMm, resolvedSpotMm,
    blur: { diameterMm: blur.diameterMm, diameterPixels: blurPixels, largestComponent: blur.largestComponent },
    noise: { pixelSnr, visibleSnrAtMaximum }
  };
  const numbers = [viewingDistanceMm, resolvedSpotMm, pixelLimitWidth, size(pixelLimitWidth).height, blurPixels, blurLimitWidth ?? 0, width, visibleSnrAtMaximum];
  if (!numbers.every(Number.isFinite) || !(pixelLimitWidth > 0)) throw new InvalidConfigurationError("Print size limit lies outside the supported numeric range.");
  return approximationResult(result, "print-size-limit-blur-noise", "1.0.0", [
    "Flat print viewed at a fixed distance, at its center; one visual-resolution angle for pixels, blur and noise.",
    "Blur parts combine in root-sum-square: exact for Gaussian spots, an approximation for discs and Airy patterns.",
    "Pixel noise is white (independent pixels); demosaic, denoise and sharpening correlations are not modeled.",
    "The eye averages noise over a square of the criterion angle; contrast sensitivity and print medium are not modeled."
  ]);
}
