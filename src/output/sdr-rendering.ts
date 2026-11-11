// SPDX-License-Identifier: Apache-2.0

/**
 * The SDR (standard dynamic range) reference renderer: linear sRGB → rendering exposure → tone
 * curve → gamut handling → sRGB transfer → integer codes.
 *
 * It takes linear RGB that already has colour and white balance (WB) applied. Unknown HDR or
 * display modes are rejected.
 * @see docs/SDR_RENDERING.md for equations, coordinate/unit conventions, blockers and support limits.
 */

import { encodeSrgbComponent } from "../color/srgb-transfer.js";
import { resolveCaptureColorModel } from "../color/capture-color.js";
import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificResultError } from "../core/validation.js";

export const SDR_RENDERING_SCHEMA_VERSION = "0.1.0" as const;
/**
 * Version of the `generic-sdr-rendering-reference` model. 0.2.0 added luminance tone curves and fixed
 * round-to-nearest, ties up (`Math.round`; the old `Math.floor(x+.5)` rounded 0.49999999999999994 up).
 */
export const SDR_RENDERING_MODEL_VERSION = "0.2.0" as const;
/**
 * Tone curves. A per-channel curve acts on each exposed component separately. A luminance curve
 * scales all three components of a pixel by f(L)/L, where L is the linear-sRGB/D65 relative
 * luminance, so the colour (chromaticity) is kept before gamut handling.
 * - `identity`: f(x)=x.
 * - `positive-reinhard-per-channel`: f(x)=x/(1+x) for x>0 (Reinhard et al. 2002, eq. 3), per channel.
 * - `extended-reinhard-luminance`: f(L)=L(1+L/Lw²)/(1+L) (Reinhard et al. 2002, eq. 4); L=Lw maps to 1.
 * - `naka-rushton-luminance`: f(L)=g(L)/g(Lw), g(L)=Lⁿ/(Lⁿ+σⁿ) (Naka & Rushton 1966; Reinhard & Devlin
 *   2005): a sigmoid in log luminance with contrast n and mid-response σ, i.e. a film-like S-curve.
 */
export type SdrToneCurve = "identity" | "positive-reinhard-per-channel" | "extended-reinhard-luminance" | "naka-rushton-luminance";
/** Required only by luminance curves; all values are relative linear luminance after rendering exposure. */
export type SdrToneCurveParameters =
  | { whiteLuminance: number }
  | { exponent: number; semiSaturation: number; whiteLuminance: number };
/** Rendering choices made by the engine user. They are independent of physical exposure and display calibration. */
export interface SdrRenderingProfile {
  schemaVersion: typeof SDR_RENDERING_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  renderingExposureEv: number;
  toneCurve: SdrToneCurve;
  /** Present exactly for `extended-reinhard-luminance` ({whiteLuminance}) and `naka-rushton-luminance`. */
  toneCurveParameters?: SdrToneCurveParameters;
  /**
   * After the tone curve: clip each component to [0, 1], reject an out-of-range pixel, or (#601, 2.22.0) desaturate a pixel whose
   * largest component exceeds 1 toward the gray of its own luminance until that component is 1 (`desaturateToLuminance`), then
   * clip what remains below 0.
   */
  gamutHandling: "clip-components" | "reject-out-of-range" | "desaturate-to-luminance";
  outputDynamicRange: "sdr";
  transferFunction: "srgb";
  bitDepth: 8 | 16;
  rounding: "nearest-ties-up";
  dither: "none";
}
/** Only linear-sRGB/D65 data that has been explicitly colour-transformed, with all three channels at each pixel, is accepted. */
export interface SdrRenderingInput {
  sourceImageStateId: string;
  inputImageState: "color-transformed-linear-rgb";
  inputColorSpace: "linear-srgb-d65";
  whiteBalanceHandling: "already-applied-upstream" | "not-required";
  pixelWidth: number;
  pixelHeight: number;
  referenceWhiteValue: number;
  /** Relative linear RGB, row-major tightly interleaved red/green/blue. */
  samples: readonly number[];
  profile: SdrRenderingProfile;
}
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
  return requireAllowlistedRecord(v, keys, "Invalid SDR fields.");
}
function publicId(v: unknown): string {
  return requirePublicOpaqueId(v, "Invalid public SDR identity.");
}
function bounded(value: unknown, minimumExclusive: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= minimumExclusive || value > maximum) {
    throw new InvalidConfigurationError("Unsupported SDR tone-curve parameters.");
  }
  return value;
}
function parseToneCurveParameters(curve: unknown, value: unknown): SdrToneCurveParameters | undefined {
  if (curve === "identity" || curve === "positive-reinhard-per-channel") {
    if (value !== undefined) throw new InvalidConfigurationError("Per-channel tone curves take no parameters.");
    return undefined;
  }
  if (curve === "extended-reinhard-luminance") {
    const p = requireAllowlistedRecord(value, ["whiteLuminance"], "Invalid SDR tone-curve parameters.");
    return { whiteLuminance: bounded(p.whiteLuminance, 0, 65536) };
  }
  if (curve === "naka-rushton-luminance") {
    const p = requireAllowlistedRecord(value, ["exponent", "semiSaturation", "whiteLuminance"], "Invalid SDR tone-curve parameters.");
    const exponent = bounded(p.exponent, 0, 4);
    if (exponent < .25) throw new InvalidConfigurationError("Unsupported SDR tone-curve parameters.");
    return { exponent, semiSaturation: bounded(p.semiSaturation, 0, 64), whiteLuminance: bounded(p.whiteLuminance, 0, 65536) };
  }
  throw new InvalidConfigurationError("Unsupported SDR rendering profile.");
}
/** Linear-sRGB/D65 relative-luminance weights: the Y row of the engine's sRGB to XYZ matrix (W3C CSS Color 4 sRGB; also IEC 61966-2-1). */
const LUMINANCE = resolveCaptureColorModel().cameraRgbToXyz[1]! as readonly number[];
/** Internal: the linear-sRGB/D65 relative-luminance weights the luminance curves and the desaturation use. */
export const SDR_LUMINANCE_WEIGHTS: readonly number[] = LUMINANCE;
/**
 * Internal (#601): the `desaturate-to-luminance` gamut handling of one tone-mapped pixel, in place. Where its largest component t
 * exceeds 1, the pixel is moved toward the gray of its own luminance Y = wᵀp, p' = Y + a·(p − Y) with a = (1 − Y)/(t − Y), so
 * the largest component becomes 1. Y is linear in the components and the weights sum to 1, so p' keeps the luminance, and as an
 * additive mixture with that gray it stays on the line from the white point through p's chromaticity (its dominant wavelength,
 * the colorimetric hue) instead of the per-component clip's shift toward the secondaries. Where Y ≥ 1 the pixel is white. The
 * same principle as W3C CSS Color 4 §13 (reduce chroma at constant lightness and hue) and as darktable's sigmoid "RGB ratio"
 * mode (desaturate bright saturated colors to stay in gamut); this linear form is the engine's own. Other pixels are unchanged.
 */
export function desaturateToLuminance(out: Float64Array | number[]): void {
  const r = out[0]!, g = out[1]!, b = out[2]!, top = r > g ? (r > b ? r : b) : (g > b ? g : b);
  if (!(top > 1)) return;
  const l = LUMINANCE[0]!*r+LUMINANCE[1]!*g+LUMINANCE[2]!*b;
  if (l >= 1) { out[0] = 1; out[1] = 1; out[2] = 1; return; }
  const a = (1-l)/(top-l);
  out[0] = l+a*(r-l); out[1] = l+a*(g-l); out[2] = l+a*(b-l);
}
/** Writes the three tone-mapped samples of one exposed pixel. Exposed values are finite. */
export type SdrPixelTone = (red: number, green: number, blue: number, out: Float64Array | number[]) => void;
/**
 * Internal shared tone operator. The reference renderer, the native SDR kernel and RAW development all
 * call this one function, so every path uses the same per-pixel operation order. Not exported from the package.
 */
export function prepareSdrPixelTone(profile: Pick<SdrRenderingProfile, "toneCurve" | "toneCurveParameters">): SdrPixelTone {
  const curve = profile.toneCurve, p = profile.toneCurveParameters;
  if (curve === "identity") return (r, g, b, out) => { out[0] = r; out[1] = g; out[2] = b; };
  if (curve === "positive-reinhard-per-channel") return (r, g, b, out) => {
    out[0] = r > 0 ? r/(1+r) : r; out[1] = g > 0 ? g/(1+g) : g; out[2] = b > 0 ? b/(1+b) : b;
  };
  let map: (l: number) => number;
  if (curve === "extended-reinhard-luminance" && p && !("exponent" in p)) {
    const white2 = p.whiteLuminance*p.whiteLuminance;
    // Written as L/(1+L)·(1+L/Lw²) so a very large finite L cannot overflow an intermediate product.
    map = (l: number): number => l/(1+l)*(1+l/white2);
  } else if (curve === "naka-rushton-luminance" && p && "exponent" in p) {
    // g(L) = Lⁿ/(Lⁿ+σⁿ) = 1/(1+(σ/L)ⁿ): no overflow for large L.
    const q = p as Extract<SdrToneCurveParameters, { exponent: number }>;
    const n = q.exponent, sigma = q.semiSaturation, g = (l: number): number => 1/(1+(sigma/l)**n), white = g(q.whiteLuminance);
    map = (l: number): number => g(l)/white;
  } else throw new InvalidConfigurationError("Unsupported SDR rendering profile.");
  const kr = LUMINANCE[0]!, kg = LUMINANCE[1]!, kb = LUMINANCE[2]!;
  return (r, g, b, out) => {
    const l = kr*r+kg*g+kb*b;
    if (!(l > 0)) { out[0] = r; out[1] = g; out[2] = b; return; }
    const ratio = map(l)/l, mr = r*ratio, mg = g*ratio, mb = b*ratio;
    if (!Number.isFinite(mr) || !Number.isFinite(mg) || !Number.isFinite(mb)) throw new InvalidScientificResultError("Tone mapping produced a non-finite sample.");
    out[0] = mr; out[1] = mg; out[2] = mb;
  };
}
/** Validates a rendering and encoding profile. Unknown HDR or display modes are rejected. */
export function parseSdrRenderingProfile(value: unknown): SdrRenderingProfile {
  const r = object(value, ["schemaVersion", "profileId", "profileVersion", "renderingExposureEv", "toneCurve", "toneCurveParameters", "gamutHandling",
    "outputDynamicRange", "transferFunction", "bitDepth", "rounding", "dither"]);
  const toneCurveParameters = parseToneCurveParameters(r.toneCurve, r.toneCurveParameters);
  if (r.schemaVersion !== SDR_RENDERING_SCHEMA_VERSION || typeof r.renderingExposureEv !== "number" ||
      !Number.isFinite(r.renderingExposureEv) || Math.abs(r.renderingExposureEv) > 32 ||
      (r.gamutHandling !== "clip-components" && r.gamutHandling !== "reject-out-of-range" && r.gamutHandling !== "desaturate-to-luminance") ||
      r.outputDynamicRange !== "sdr" || r.transferFunction !== "srgb" || (r.bitDepth !== 8 && r.bitDepth !== 16) ||
      r.rounding !== "nearest-ties-up" || r.dither !== "none") throw new InvalidConfigurationError("Unsupported SDR rendering profile.");
  return { schemaVersion: SDR_RENDERING_SCHEMA_VERSION, profileId: publicId(r.profileId), profileVersion: publicId(r.profileVersion),
    renderingExposureEv: Object.is(r.renderingExposureEv, -0) ? 0 : r.renderingExposureEv, toneCurve: r.toneCurve as SdrToneCurve,
    ...(toneCurveParameters === undefined ? {} : { toneCurveParameters }), gamutHandling: r.gamutHandling, outputDynamicRange: r.outputDynamicRange, transferFunction: r.transferFunction,
    bitDepth: r.bitDepth, rounding: r.rounding, dither: r.dither };
}
/** Validates the declared image state and a bounded, finite, inline image. It never applies white balance or colour conversion. */
export function parseSdrRenderingInput(value: unknown): SdrRenderingInput {
  const r = object(value, ["sourceImageStateId", "inputImageState", "inputColorSpace", "whiteBalanceHandling",
    "pixelWidth", "pixelHeight", "referenceWhiteValue", "samples", "profile"]);
  const samples = r.samples;
  if (r.inputImageState !== "color-transformed-linear-rgb" || r.inputColorSpace !== "linear-srgb-d65" ||
      (r.whiteBalanceHandling !== "already-applied-upstream" && r.whiteBalanceHandling !== "not-required") ||
      typeof r.pixelWidth !== "number" || !Number.isSafeInteger(r.pixelWidth) || r.pixelWidth <= 0 ||
      typeof r.pixelHeight !== "number" || !Number.isSafeInteger(r.pixelHeight) || r.pixelHeight <= 0 ||
      typeof r.referenceWhiteValue !== "number" || !Number.isFinite(r.referenceWhiteValue) || r.referenceWhiteValue <= 0 ||
      !Array.isArray(samples) || samples.length !== r.pixelWidth*r.pixelHeight*3 || samples.length > 262144 ||
      Array.from({ length: samples.length }, (_, i) => i in samples).includes(false) ||
      samples.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new InvalidConfigurationError("Unsupported SDR input domain/raster.");
  return { sourceImageStateId: publicId(r.sourceImageStateId), inputImageState: r.inputImageState, inputColorSpace: r.inputColorSpace,
    whiteBalanceHandling: r.whiteBalanceHandling, pixelWidth: r.pixelWidth, pixelHeight: r.pixelHeight,
    referenceWhiteValue: r.referenceWhiteValue, samples: samples.map((v: number) => Object.is(v, -0) ? 0 : v),
    profile: parseSdrRenderingProfile(r.profile) };
}
export interface SdrRenderingResult {
  schemaVersion: typeof SDR_RENDERING_SCHEMA_VERSION;
  sourceImageStateId: string;
  profile: SdrRenderingProfile;
  pixelWidth: number;
  pixelHeight: number;
  channelOrder: readonly ["red", "green", "blue"];
  whiteBalanceHandling: SdrRenderingInput["whiteBalanceHandling"];
  /** Relative normalized linear samples after exposure/tone, before gamut handling. */
  toneMappedLinearSamples: readonly number[];
  outputLinearSamples: readonly number[];
  outputEncodedSamples: readonly number[];
  integerSamples: readonly number[];
  outputEncoding: {
    imageState: "output-referred-sdr";
    colorSpace: "srgb";
    primariesXy: { red: readonly [number, number]; green: readonly [number, number]; blue: readonly [number, number] };
    whitePointXy: readonly [number, number];
    referenceWhiteLuminanceCdM2: 80;
    codeMinimum: 0;
    codeMaximum: number;
  };
  diagnostics: {
    renderingNegativeSampleCount: number;
    renderingAboveReferenceSampleCount: number;
    toneChangedSampleCount: number;
    gamutClippedLowSampleCount: number;
    gamutClippedHighSampleCount: number;
    /**
     * `not-consumed`: no upstream saturation data (full well, ADC or RAW) is available, and it is never
     * guessed from the output.
     * `consumed-in-raw-development`: RAW development already clipped or reconstructed flagged and
     * white-level samples before white balance (see its highlight diagnostics).
     */
    captureSaturation: "not-consumed" | "consumed-in-raw-development";
  };
  /** Describes the encoded output for the platform's colour management. No real display is assessed. */
  displayAdaptation: { kind: "external-platform"; applied: false; displayCapabilities: "unknown" };
}
/**
 * Standalone SDR rendering: rendering exposure → tone → gamut → sRGB transfer → quantization.
 * No physical capture, metering, white balance, colour conversion, lens correction or display
 * adaptation runs.
 */
export function calculateSdrRendering(input: SdrRenderingInput): CalculationResult<SdrRenderingResult> {
  const value = parseSdrRenderingInput(input), p = value.profile;
  const scale = 2**p.renderingExposureEv/value.referenceWhiteValue;
  if (!Number.isFinite(scale) || scale <= 0) throw new InvalidScientificResultError("Rendering scale is non-finite/unrepresentable.");
  let negative = 0, above = 0, changed = 0, low = 0, high = 0;
  const toneOf = prepareSdrPixelTone(p), exposed = [0, 0, 0], mapped = [0, 0, 0], tone: number[] = [];
  for (let i = 0; i < value.samples.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const e = value.samples[i+c]!*scale;
      if (!Number.isFinite(e)) throw new InvalidScientificResultError("Rendering exposure produced a non-finite sample.");
      if (e < 0) negative++;
      if (e > 1) above++;
      exposed[c] = e;
    }
    toneOf(exposed[0]!, exposed[1]!, exposed[2]!, mapped);
    for (let c = 0; c < 3; c++) {
      const m = mapped[c]!;
      if (m !== exposed[c]) changed++;
      tone.push(m === 0 ? 0 : m);
    }
  }
  // #601: the desaturation acts on whole pixels before the remaining components are clipped (tone samples are kept as mapped).
  const gamut = p.gamutHandling === "desaturate-to-luminance" ? tone.slice() : tone;
  if (gamut !== tone) for (let i = 0; i < gamut.length; i += 3) { const px = gamut.slice(i, i+3); desaturateToLuminance(px); gamut[i] = px[0]!; gamut[i+1] = px[1]!; gamut[i+2] = px[2]!; }
  const linear = gamut.map((sample) => {
    if (sample < 0 || sample > 1) {
      if (p.gamutHandling === "reject-out-of-range") throw new InvalidConfigurationError("Tone output exceeds the declared SDR gamut range.");
      if (sample < 0) { low++; return 0; }
      high++; return 1;
    }
    return sample;
  });
  const encoded = linear.map(encodeSrgbComponent);
  const maximum = 2**p.bitDepth-1;
  // Nearest, ties up: encoded samples are in [0,1], where Math.round is exact ties-up rounding.
  const codes = encoded.map((sample) => Math.round(sample*maximum));
  return calculatedResult({ schemaVersion: SDR_RENDERING_SCHEMA_VERSION, sourceImageStateId: value.sourceImageStateId,
    profile: p, pixelWidth: value.pixelWidth, pixelHeight: value.pixelHeight, channelOrder: ["red", "green", "blue"],
    whiteBalanceHandling: value.whiteBalanceHandling, toneMappedLinearSamples: tone, outputLinearSamples: linear,
    outputEncodedSamples: encoded, integerSamples: codes,
    outputEncoding: { imageState: "output-referred-sdr", colorSpace: "srgb", primariesXy: { red: [.64, .33], green: [.30, .60], blue: [.15, .06] },
      whitePointXy: [.3127, .3290], referenceWhiteLuminanceCdM2: 80, codeMinimum: 0, codeMaximum: maximum },
    diagnostics: { renderingNegativeSampleCount: negative, renderingAboveReferenceSampleCount: above,
      toneChangedSampleCount: changed, gamutClippedLowSampleCount: low, gamutClippedHighSampleCount: high, captureSaturation: "not-consumed" },
    displayAdaptation: { kind: "external-platform", applied: false, displayCapabilities: "unknown" } },
  "generic-sdr-rendering-reference", SDR_RENDERING_MODEL_VERSION,
  ["Deterministic first-party rendering choice, not a calibrated camera look or scene-light model",
    "Per-channel positive Reinhard can change chromaticity; luminance curves preserve chromaticity until component clipping, which is not perceptual gamut mapping",
    "Input WB/color completion is a producer declaration; capture/correction adapter and production activation remain pending",
    "sRGB reference encoding assumptions do not establish actual display luminance, saturation or viewing conditions"]);
}
