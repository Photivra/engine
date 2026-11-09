// SPDX-License-Identifier: Apache-2.0

/**
 * `simulateCapture()` is the easy starting point. It turns a small input into a complete native
 * environment RAW request: scene radiance → optics → spectral EQE (external quantum efficiency) →
 * charge → readout and ADC. That request then runs through the existing native RAW development task
 * and, optionally, the existing JPEG encoder.
 *
 * It adds no physics of its own. Every number comes from existing public contracts: generic tier
 * presets, exposure metering and mode resolution, colorimetry, native environment RAW, native RAW
 * development and print JPEG.
 *
 * Everything the facade decides for the caller is listed in `result.assumptions`: defaults, derived
 * values and fixed modelling choices. Nothing is hidden. The complete underlying request is returned
 * in `result.request`; get the per-site inputs with `request.siteInput(index)`.
 *
 * The 2.0 options are opt-in and only combine existing public contracts. If none is given, the
 * request, RAW, samples and JPEG are byte-identical to the 1.0 facade:
 * - output formats: `png` (`serializePngImage`; sRGB, or Display P3 / Rec. 2020 through the colorimetry
 *   matrices and transfer functions) and `dng`
 *   (`serializeNativeRawDng` of the packed native RAW; no linear master is declared);
 * - demosaic: `createBuiltInBayerDemosaicProfiles` (bilinear) and mirror borders;
 * - optics: the environment `lensFieldMapping` (projection, radial / Brown–Conrady distortion), radial
 *   illumination vignetting as field throughput and a caller sampled lens PSF;
 * - motion: constant camera angular velocity and the electronic rolling-shutter exposure schedule.
 * The 2.1 options are opt-in in the same way: `lens.diffraction`, `output.demosaic: "ahd"` and
 * `sensor.antiAliasing` (a birefringent point-splitting low-pass filter in the sensor optical stack).
 * The 2.4 `output.metadata` adds the caller's text to JPEG, PNG and DNG files (see `src/output/text-metadata.ts`);
 * without it every encoded file is byte-identical to 2.3.
 * @see docs/QUICK_START.md
 */

import { markInternalNativeTileReader, markInternalSceneRadianceEvaluator, registerInternalRadianceAccess } from "../core/internal-radiance-evaluator.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificResultError } from "../core/validation.js";
import { requireInputObject } from "../core/record-validation.js";
import { ENGINE_API_VERSION } from "../core/version.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { GENERIC_TIER_ASSETS, type GenericEquipmentTier, type GenericEquipmentTierPreset } from "../equipment/generic-tier-assets.js";
import { parseCallerCameraPreset } from "./camera-preset.js";
import { createHostYield } from "./host-yield.js";
import { resolveGenericEquipmentExposureCapabilities, type ResolvedGenericEquipmentExposureCapabilities } from "../equipment/exposure-capabilities.js";
import { resolveGenericIsoSignalChain } from "../sensor/iso-signal-chain.js";
import { meterRelativeExposure } from "../exposure/metering.js";
import { createExposureMeterTargetFromMeteringResult, setExposureCompensationOnMeterTarget } from "../exposure/metering-target.js";
import { resolveManualExposureMode, resolveAperturePriorityExposureMode, resolveAperturePriorityAutoIsoExposureMode, resolveShutterPriorityExposureMode,
  resolveProgramAutoExposureMode, type AutoIsoBaselinePolicy, type AutoIsoLimits, type ExposureResolutionConstraint } from "../exposure/exposure-mode-resolver.js";
import { estimateAutoIsoSlowestShutter, GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC } from "../exposure/auto-iso-slowest-shutter.js";
import { parseExposureProgramLineProfile, type ExposureProgramLineProfile } from "../exposure/program-line.js";
import { resolveCaptureGeometry } from "../output/capture-geometry.js";
import { estimateCie1931ColorMatchingFunctions, type PreparedColorimetricSpectrum } from "../color/color-matching-functions.js";
import { createColorTemperatureWhiteBalanceIntent, resolveColorTemperatureWhiteBalance, resolveCustomWhiteBalance,
  resolveManualWhiteBalance, estimateAutoWhiteBalance, type ResolvedWhiteBalanceState } from "../color/white-balance.js";
import { createCaptureWhiteBalanceIntent, type CaptureWhiteBalanceIntent } from "../capture/simulated-capture.js";
import { SENSOR_RAW_PRODUCER_NOISE_MODEL } from "../capture/sensor-raw-producer.js";
import { calculateNativeRawPlan, nativeRawMaximumProviderEvaluations, NATIVE_RAW_LIMITS, type NativeRawInput, type NativeRawOutput, type NativeRawPlan } from "../capture/native-raw.js";
import { renderTabulatedNativeRaw, TABULATED_RELATIVE_TOLERANCE } from "../capture/native-environment-tabulated.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "./expected-signal.js";
import type { DisplayViewFastReport } from "./display-view-gpu.js";
import type { DisplayViewLensPsf } from "./display-view-lens-signal.js";
import { buildExpectedSignalInput } from "./expected-signal-setup.js";
import { createNativeEnvironmentRawTask, createNativeEnvironmentRawRegionTask, type NativeEnvironmentRawInput,
  type NativeEnvironmentRawTask, type NativeEnvironmentRawTile } from "../capture/native-environment-raw.js";
import { createNativeRawDevelopmentTask, NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS, type NativeRawDevelopmentInput, type RawHighlightDiagnostics } from "../capture/native-raw-development.js";
import type { RawFrameReconstructionPhaseProfile } from "../capture/raw-frame-reconstruction.js";
import type { ExportSensorColorProfile } from "../capture/photographic-export.js";
import { parseSdrRenderingProfile, type SdrRenderingProfile, type SdrToneCurve, type SdrToneCurveParameters, type SdrRenderingResult } from "../output/sdr-rendering.js";
import type { RawHighlightMode } from "../color/sensor-color-development.js";
import { createPrintJpegTask, PRINT_JPEG_LIMITS } from "../output/print-jpeg.js";
import type { SimulateEnvironmentSensorRawFrameInput } from "../capture/environment-raw-producer.js";
import { checkNativeRawIntegrity, prepareNativeRawDevelopment } from "../capture/native-raw-development.js";
import { createRawPixelDeveloper, normalizedRawSite, rawSiteSaturated, type RawDevelopmentSource } from "../capture/raw-development-kernel.js";
import { createAhdDemosaicTask } from "../processing/demosaic.js";
import { PROCESSING_MAX_PIXELS } from "../processing/processing-task.js";
import { renderSdrRunInto, type SdrPixelCounts } from "../output/native-capture-sdr.js";
import { prepareSdrPixelTone } from "../output/sdr-rendering.js";
import { BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION as BUILT_IN_DEMOSAIC_VERSION, createBuiltInBayerDemosaicProfiles } from "../sensor/raw-reconstruction.js";
import { transformOrientedRasterPointToNative } from "../output/capture-geometry.js";
import { resolveCaptureColorModel } from "../color/capture-color.js";
import { evaluateBt709Oetf, evaluateSrgbEncoding, resolveRgbColorSpace } from "../color/rgb-color-spaces.js";
import { serializePngImage, PNG_ENCODER_LIMITS, type PngColourEncoding } from "../output/png-encoder.js";
import { addJpegTextMetadata, addPngTextMetadata, parseOutputTextMetadata, type OutputTextMetadata } from "../output/text-metadata.js";
import { parseLensProjectionModel, type LensProjectionModel } from "../camera/lens-projection.js";
import { prepareEnvironmentLensFieldMapping, type EnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import type { RadialDistortionProfile } from "../optics/radial-distortion.js";
import type { BrownConradyDistortionProfile } from "../optics/brown-conrady-distortion.js";
import type { IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import type { CalculateSensorPsfIrradianceQuadratureInput } from "../optics/sensor-psf-quadrature.js";
import type { CalculateEnvironmentSensorPhotoSignalInput } from "../sensor/environment-photo-signal.js";
import { createRollingShutterCaptureExposureSchedule, resolveElectronicRollingShutterExposureSchedule,
  type ElectronicRollingShutterExposureSchedule } from "../sensor/readout-exposure-linkage.js";
import { calculateCaptureExposureWindows } from "../sensor/exposure-window.js";
import { calculateSensorSpectralQuadrature } from "../sensor/spectral-quadrature.js";
import { createDiffractionLimitedPsfProfile, type DiffractionLimitedPsfProfile } from "../optics/diffraction-psf-profile.js";
import { registerDiffractionPsfKey, siteDiffractionKernel } from "../optics/site-diffraction-kernel.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel, defocusDiscKernelRadius, defocusDiscLimitMessage, requireDefocusDiscKernelRadius, resolveDefocusDisc, type DefocusDiscSiteKernel, type ResolvedDefocusDisc } from "../optics/defocus-disc-kernel.js";
import { calculateDefocusFieldVariation, createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry, type DefocusFieldVariation } from "./defocus-image-space-provider.js";
import { createDiffractedPlanarProvider } from "./diffraction-provider.js";
import type { LargeDefocusKernel } from "./large-defocus-lattice.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES, siteKernelRuns } from "../optics/site-kernel-runs.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions, type DefocusBokehOptions, type DefocusBokehSiteKernel, type ResolvedDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import { planDefocusBokehZones, type DefocusBokehZonePlan } from "./defocus-bokeh-zones.js";
import { resolveGenericPrimeLens, type GenericPrimeLens } from "../equipment/generic-prime-lenses.js";
import { IDEAL_LENS_LIMITS } from "../equipment/ideal-lens.js";
import type { ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";
import { calculateChannelElectronsPerRadiance } from "./channel-response.js";
import { calculateSiteEffectiveSaturationCode } from "../capture/raw-white-level.js";
import { prepareSensorColorDevelopment } from "../color/sensor-color-development.js";
import { resolveAntiAliasingSpatialKernel, type AntiAliasingPointSplitComponent, type SensorOpticalStackProfile } from "../sensor/optical-stack.js";
import { multiplyMatrices, type ColorMatrix3x3, type ColorVector3 } from "../color/colorimetry-math.js";
import { prepareRgbGamutMapping, type PreparedRgbGamutMapping } from "../color/gamut-mapping.js";
import { serializeNativeRawDng, type NativeRawDng } from "../capture/native-raw-dng.js";
import { applyDiffractionCorrection, defaultDiffractionCorrectionRadiusPixels, designDiffractionCorrectionFilter, parseDiffractionCorrectionSettings,
  parseUnsharpMaskSettings, renderSdrWithUnsharpMask, DEVELOPMENT_DETAIL_MODEL_VERSION, type DiffractionCorrectionSettings,
  type UnsharpMaskSettings } from "../processing/development-detail.js";
import { parseSensorReadoutConversionProfile, resolveSensorReadoutRegime } from "../sensor/raw-readout.js";
import { resolveChartScene, chartMaterialInputs, CHART_SCENE_PRESETS, type ChartScene, type ResolvedChartScene } from "./chart-scenes.js";
import { resolveChartMaterialLayers, type ChartMaterialLayerScene, type ResolvedChartMaterialLayers } from "./chart-material-layers.js";
import { resolveCaptureIlluminant, calculateIlluminantIrradianceScale, buildPlanarSceneRadianceProvider, requireCallerScene, FACADE_SPECTRAL_RANGE_NANOMETERS,
  resolveChartSizeOption, type ChartSizeOption,
  PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W, type CaptureIlluminant, type CallerMaterialScene, type CallerRadianceScene, type CallerReflectanceScene, type ResolvedCallerScene,
  planarProviderMaterialOfDirection, type PlanarSceneRadianceProvider, type ResolvedCallerMaterialScene, type ResolvedCaptureIlluminant } from "./scene-radiance.js";

/** Version of how the facade builds requests. It changes whenever the same input would build a different request. */
export const SIMULATE_CAPTURE_FACADE_VERSION = "1.0.0" as const;

export type SimulateCaptureExposureMode = "manual" | "aperture-priority" | "shutter-priority" | "program";
/**
 * 2.14: what the meter reads. `scene-average` (the default): the body's 16 × 16-zone meter reads the scene's luminance.
 * `grey-card`: incident metering; every zone reads the luminance 0.18·E/π of an 18 % Lambertian grey card under the
 * request's illuminance E, so the automatic modes choose settings whose `greyCardDeviationStops` is 0 (up to their steps
 * and limits), whatever the scene's reflectances.
 */
export type SimulateCaptureMetering = "scene-average" | "grey-card";
export const SIMULATE_CAPTURE_METERING_MODES: readonly SimulateCaptureMetering[] = /* @__PURE__ */ Object.freeze(["scene-average", "grey-card"] as const);
/**
 * #516: what aperture priority does with Auto ISO once the ISO reaches the body's Auto ISO maximum and the exposure is
 * still under the meter target: `"allow-slower-shutter"` lengthens the shutter past the slowest preferred shutter to reach
 * the target; `"hold-preferred-shutter"` keeps the preferred shutter and leaves the exposure under target.
 */
export type SimulateCaptureAutoIsoAfterMaximum = "allow-slower-shutter" | "hold-preferred-shutter";
/**
 * #516: how Auto ISO chose the ISO (`exposure.iso: "auto"`), reported in the result's `exposure.autoIso`. The full
 * resolver output stays in the capture's `exposure.resolution`.
 */
export interface SimulateCaptureAutoIsoReport {
  /** The ISO the meter target asked for at the resolved aperture and shutter, before the Auto ISO range and the ISO grid. */
  idealIsoBeforeConstraints: number;
  /**
   * The body's Auto ISO range: its Auto ISO bounds, or its ISO range when it declares none (the tiers: ISO 100 to their
   * maximum). Without `limits` the ISO was chosen in this range.
   */
  autoIsoMinimum: number;
  autoIsoMaximum: number;
  /**
   * #505: present only with `exposure.autoIso.limits`: the photographer's Auto ISO range the ISO was chosen in, inside the
   * body's (`minimum` is the body's Auto ISO minimum when the option omits it).
   */
  limits?: { minimum: number; maximum: number };
  /** Whether the ISO was held at an end of the Auto ISO range. */
  clamped: false | "minimum" | "maximum";
  /**
   * The constraint that limited the resolved exposure: the resolver's `targetResidual.limitingConstraint`, for example
   * `"iso-maximum"` (the exposure stays under target at the body's Auto ISO maximum), `"user-iso-maximum"` (#505: at the
   * photographer's `limits.maximum`, below the body's), `"iso-grid-quantization"` (the nearest selectable ISO) or `"none"`
   * (on target).
   */
  limitingConstraint: ExposureResolutionConstraint;
  /** The resolver's residual, log2(target / achieved exposure), in stops: positive when the exposure is under the meter target, negative when over it. */
  residualStops: number;
  /**
   * Aperture priority, and program with a slowest preferred shutter (#504): the policy and slowest preferred shutter used,
   * and whether the slower-shutter fallback ran.
   */
  afterMaximumIso?: SimulateCaptureAutoIsoAfterMaximum;
  slowestPreferredShutterSeconds?: number;
  afterMaximumIsoFallbackUsed?: boolean;
  /** #504, program only: whether the program line's shutter was longer than the slowest preferred shutter and was held. */
  slowestPreferredShutterApplied?: boolean;
  /** #504: present only with `slowestPreferredShutterSeconds: "auto"`: how the engine derived it (`estimateAutoIsoSlowestShutter`). */
  automaticSlowestShutter?: SimulateCaptureAutomaticSlowestShutterReport;
  /** 2.14: present when `exposure.autoIso.isoSteps` is given: the ISO steps Auto ISO chose from. */
  isoSteps?: "whole-stop" | "third-stop";
}
/**
 * #504: the settings of `exposure.autoIso.slowestPreferredShutterSeconds: "auto"`. Every field is optional; the defaults are
 * labelled generic values, recorded as `default` assumptions.
 */
export interface SimulateCaptureAutomaticSlowestShutterOptions {
  /** The bias in whole stops, as cameras' Auto minimum-shutter settings offer: +1 one stop faster, −1 one stop slower; −2 to +2. Default 0. */
  fasterByStops?: number;
  /** The shake blur allowed, in sensor pixels of `sensor.pixelPitchMicrometers`. Default 1 (a generic pixel-level budget). */
  blurBudgetPixels?: number;
  /**
   * The hand's constant angular velocity, rad/s (signs as in `motion.angularVelocityRadPerSec`; only the magnitude matters).
   * Default `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`: 4.39 °/s on yaw, a cited generic value for a 100 g phone held in
   * two hands (Xiao et al., Proc. SPIE 7250, 2009), not a measurement of you or of this camera.
   */
  angularVelocityRadPerSec?: { yaw: number; pitch: number };
  /** Stabilization in equivalent stops (≥ 0, at most 10), scaling the motion by 2^−stops. Default 0: the tiers declare no stabilization. */
  stabilizationStopsEquivalent?: number;
}
/** #504: the automatic slowest preferred shutter in the Auto ISO report. */
export interface SimulateCaptureAutomaticSlowestShutterReport {
  /** The exposure time whose camera-shake blur equals the budget (`estimateCameraShakeBlur`), before the bias and the grid. */
  derivedShutterSeconds: number;
  fasterByStops: number;
  /** derivedShutterSeconds · 2^−fasterByStops. */
  biasedShutterSeconds: number;
  /** The slowest preferred shutter used: the biased time within the body's shutter range. */
  shutterSeconds: number;
  blurBudgetPixels: number;
  /** The shake blur at `shutterSeconds`, in pixels. */
  blurAtShutterPixels: number;
  angularVelocityRadPerSec: { yaw: number; pitch: number };
  stabilizationStopsEquivalent: number;
}
export type SimulateCaptureOutputFormat = "srgb-8" | "srgb-16" | "jpeg" | "png" | "dng";
export type SimulateCaptureWhiteBalance =
  | "scene-illuminant"
  | "auto"
  | "none"
  | { kelvin: number; tint?: number }
  | { channelGains: { red: number; green: number; blue: number } };
/**
 * PNG colour encoding. `srgb` is the developed sRGB output. The others take the developed linear
 * colour (camera → XYZ → linear sRGB/D65, unclipped) and convert it through CIE XYZ into the target
 * primaries:
 * - `display-p3`: Display P3 primaries (W3C CSS Color 4 `display-p3`; also SMPTE EG 432-1) with the
 *   sRGB transfer function;
 * - `rec2020`: ITU-R BT.2020 primaries and OETF.
 * PQ and HLG (BT.2100) are not part of 2.0; see THIRD_PARTY.md.
 */
export type SimulateCaptureColorEncoding = "srgb" | "display-p3" | "rec2020";
/**
 * Demosaic. `bilinear`: the built-in Bayer kernels (`createBuiltInBayerDemosaicProfiles`). `ahd` (2.1): adaptive
 * homogeneity-directed demosaicing (`createAhdDemosaicTask`, after Hirakawa & Parks 2005), a non-linear
 * edge-directed method that reduces zipper and false colour on sharp edges.
 */
export type SimulateCaptureDemosaic = "bilinear" | "ahd";
/** `output.demosaic` as a record (#395): the demosaic and its `fast` override (see {@link SimulateCaptureOptions.fast}). */
export interface SimulateCaptureDemosaicRecord { kind: SimulateCaptureDemosaic; fast?: boolean }
/**
 * `margin` renders extra native sites around the output, as far as the kernel reaches. `mirror` renders
 * exactly the output and reads mirrored (reflect-101) copies of the missing border sites. Mirroring is
 * checked to keep the CFA (colour filter array) pattern consistent.
 */
export type SimulateCaptureBorderHandling = "margin" | "mirror";
export type SimulateCaptureLensDistortion =
  | { kind: "radial"; profile: RadialDistortionProfile }
  | { kind: "brown-conrady"; profile: BrownConradyDistortionProfile };
/**
 * Diffraction model (2.1): the shorthand or a record with an explicit kernel radius in sites and (#395) a `fast` override
 * (see {@link SimulateCaptureOptions.fast}). The record names the model by `kind`; `aperture`, its name before #395, is still
 * accepted as a deprecated alias until 3.0.0, and giving both is an error.
 */
export type SimulateCaptureLensDiffraction =
  | "circular-aperture"
  | { kind: "circular-aperture"; kernelRadiusSamples?: number; fast?: boolean }
  | {
    /** @deprecated Since #395: use `kind`. Accepted until 3.0.0. */
    aperture: "circular-aperture"; kernelRadiusSamples?: number; fast?: boolean;
  };
/**
 * Optical anti-aliasing (low-pass) filter (2.1), modelled as birefringent point splitting: each image point is
 * split into equally bright copies (the engine's `normalized-point-splitting-kernel` optical-stack response).
 * - `four-spot`: two crossed birefringent plates; copies at (±d/2, ±d/2), weight 1/4 each, MTF |cos(π·f_x·d)·cos(π·f_y·d)|.
 * - `two-spot`: one plate splitting along `axis`; copies at ±d/2, weight 1/2 each, MTF |cos(π·f·d)|.
 * - `point-splitting`: the engine contract itself, offsets in micrometres (+x right, +y down) and positive weights
 *   summing to 1 (at most 16 components, each within 4 sites).
 * d = `separationSites` × pixel pitch, 0 < separationSites ≤ 4, default 1 (first MTF zero at the sensor's Nyquist
 * frequency 1/(2·pitch)).
 */
export type SimulateCaptureSensorAntiAliasing =
  | { kind: "four-spot"; separationSites?: number; fast?: boolean }
  | { kind: "two-spot"; axis: "horizontal" | "vertical"; separationSites?: number; fast?: boolean }
  | { kind: "point-splitting"; components: readonly AntiAliasingPointSplitComponent[]; fast?: boolean };
/** Pixel aperture (2.3): centre sampling, or the square photosite integrated with an N × N midpoint rule; `fast` (#395) overrides the top-level flag. */
export type SimulateCapturePixelAperture = "point" | "box" | { kind: "box"; samplesPerAxis?: number; fast?: boolean };
/** Default midpoint samples per axis of `sensor.pixelAperture: "box"`. */
export const SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES = 4;
/**
 * `output.sharpening` (#552): unsharp mask y = x + amount·(x − G_σ∗x) where |x − G_σ∗x| ≥ threshold (GIMP and ImageMagick
 * unsharp mask), per channel on sRGB-encoded values in [0, 1], then clipped to [0, 1]. Every field is optional.
 */
export interface SimulateCaptureSharpening {
  /** Gaussian standard deviation σ in output pixels, (0, 8]; the kernel reaches ⌈3σ⌉. Default 1. */
  radiusPixels?: number;
  /** Gain on the detail signal, (0, 5]. Default 0.5. */
  amount?: number;
  /** Detail smaller than this (encoded units, [0, 1]) is left unchanged. Default 0 (every difference is sharpened). */
  threshold?: number;
}
/**
 * `output.diffractionCorrection` (#552): the Wiener–Tikhonov gain G(s) = min(maximumGain, H(s)(1 + α)/(H(s)² + α)) on the circular-pupil
 * OTF H at s = f/f_c, f_c = 1/(λ·N_w), as a (2R + 1)² FIR per channel. Every field is optional.
 */
export interface SimulateCaptureDiffractionCorrection {
  /** Design wavelength in nm, 380–780, used for all three channels. Default 550. */
  wavelengthNm?: number;
  /** α, an assumed noise-to-signal power ratio, 1e-4–1. Larger is safer and restores less. Default 0.01. */
  regularization?: number;
  /** Upper bound on the gain at any frequency, 1–10 (it bounds the noise amplification). Default 4. */
  maximumGain?: number;
  /** FIR radius R in pixels, 1–16. Default: the Airy pattern's third dark ring at the design wavelength, within 1–16. */
  kernelRadiusPixels?: number;
}
/** `diagnostics.detail` (#552): what the development detail stages did. Present only when one ran. */
export interface SimulateCaptureDetailDiagnostics {
  diffractionCorrection?: {
    /** Corrected linear samples below 0 (ringing below black; clipped later by gamut handling) and above the RAW white level 1. */
    negativeSampleCount: number;
    aboveWhiteSampleCount: number;
    /** The diffraction cut-off p/(λ·N_w) in cycles per pixel (Nyquist is 0.5); nothing beyond it is recovered. */
    cutoffCyclesPerPixel: number;
    /** Measured largest |response| of the filter, and largest |response| beyond the cut-off (null when the Nyquist square is inside it). */
    responsePeakGain: number;
    responseMaximumBeyondCutoff: number | null;
  };
  sharpening?: {
    /** Half-width ⌈3σ⌉ of the Gaussian in pixels. */
    kernelRadiusPixels: number;
    /** Samples changed by the mask, and samples left alone because their detail was under the threshold. */
    sharpenedSampleCount: number;
    thresholdHeldSampleCount: number;
    /** Sharpened samples clipped at 0 or 1. */
    clippedLowSampleCount: number;
    clippedHighSampleCount: number;
    /** Largest increase and decrease amount·detail before clipping, in encoded units: the halo strength. */
    maximumIncrease: number;
    maximumDecrease: number;
  };
}
export interface SimulateCaptureMotion {
  /** Constant camera angular velocity, rad/s, in the engine's pitch/yaw/roll convention. Missing axes are 0. */
  angularVelocityRadPerSec?: { pitch?: number; yaw?: number; roll?: number };
  /** Default "global". `rolling` derives the exposure schedule from the body's rolling readout declaration. */
  shutter?: "global" | "rolling";
  /** Rolling shutter only: time from the first to the last line over the simulated frame, in s. Default: the body's declared readout skew. */
  rollingShutterSkewSeconds?: number;
}

export interface SimulateCaptureOptions {
  /** Generic tier preset id or a full preset record (for example a modified copy of a catalog entry). Default "professional". */
  camera?: GenericEquipmentTier | GenericEquipmentTierPreset;
  lens?: {
    /** Must lie in the lens capability (the generic primes are 50 mm). Default: the lens's shortest focal length. */
    focalLengthMm?: number;
    /**
     * Opt-in (2.3): a lens of the generic prime family by its full-frame-equivalent focal length
     * (`GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM`). Its physical focal length is the equivalent ÷ the diagonal crop
     * factor of the simulated frame (output width × height × pixel pitch); it replaces the tier lens's focal length and
     * f-number range (the tier lens's transmission is kept). An f-number outside the prime's range, or a subject or
     * focus distance below its minimum focus distance, is rejected. Not combinable with `focalLengthMm`.
     */
    prime?: number;
    /**
     * Opt-in (#576): an ideal lens, an aberration-free thin lens of this physical focal length (1–4000 mm) on whatever sensor the
     * frame is (output width × height × pixel pitch; no crop-factor scaling), at any `fNumber` from f/0.5 to f/128
     * (`IDEAL_LENS_LIMITS`; beyond them the request is refused). It replaces the tier lens's focal length and f-number range (the
     * transmission is kept); shutter priority and program may choose any aperture in that range. Recorded in the `lens.ideal`
     * assumption. Its blur is that of `defocus`, `diffraction` and `vignetting`, the same models as with `prime`. It focuses at any
     * distance beyond the focal length (no minimum focus distance; `subjectDistanceM` must be at least twice the focal length, as for
     * every lens). Works in `simulateCapture` and the display view. Not combinable with `prime`, `catalogue` or `focalLengthMm`.
     * Default off.
     */
    ideal?: { focalLengthMm: number };
    /**
     * Opt-in (#549): a lens of the generic lens catalogue by id (`GENERIC_LENS_IDS`, for example "pv-50-1.2-pro" or "pv-50-1.8";
     * docs/LENS_CATALOGUE.md). Like `prime`, its focal length is the full-frame equivalent ÷ the simulated frame's diagonal crop
     * factor and it replaces the tier lens's focal length and f-number range (the transmission is kept). The capture renders the
     * lens's character, all labelled approximations: its PSF (diffraction with the lens's Seidel aberrations, axial and lateral
     * colour, at the resolved f-number and focus) through the environment PSF quadrature, its radial distortion, its vignetting
     * and, for the fisheyes, the equisolid projection. Flare, focus breathing and bokeh shape are not rendered. Not combinable
     * with `prime`, `focalLengthMm`, `projection`, `distortion`, `vignetting`, `psf`, `diffraction` or `pupilSampling` (the
     * lens sets them); `defocus` convolves the disc into the lens's PSF. Not offered by the display view. Default off.
     */
    catalogue?: string;
    /**
     * Opt-in (#549), with `catalogue` only: a seeded autofocus error (`simulateGenericLensFocusError`). The focus distance becomes
     * the sampled one for (seed, shotIndex), reported in the `lens.focusScatter` assumption; it is visible with `defocus`. Default off.
     */
    focusScatter?: { seed: number; shotIndex?: number };
    /** Aperture for manual and aperture-priority modes. Default 8. */
    fNumber?: number;
    /** Focus distance in metres. Default: the subject distance. */
    focusDistanceM?: number;
    /** Opt-in ideal circular-pupil ray sampling (defocus/depth of field). Default off (central ray only). */
    pupilSampling?: { radialSamples: number; angularSamples: number };
    /** Ideal lens projection (`LENS_PROJECTION_MODELS`). Default "rectilinear". Not combinable with pupilSampling. */
    projection?: LensProjectionModel;
    /** Caller-declared radial or Brown–Conrady distortion profile. Default none. Not combinable with pupilSampling. */
    distortion?: SimulateCaptureLensDistortion;
    /** Caller-declared radial relative-illumination (vignetting) profile, applied as environment field throughput. */
    vignetting?: IlluminationVignettingProfile;
    /**
     * Caller sampled lens PSF, passed unchanged to the environment contract. Its focal length, f-number and
     * focus must equal the resolved capture settings exactly. Not combinable with pupilSampling.
     */
    psf?: Extract<CalculateEnvironmentSensorPhotoSignalInput["psf"], { kind: "sampled-local" }>;
    /**
     * Opt-in (2.1) diffraction blur of an ideal, aberration-free, in-focus lens with a circular pupil at the
     * capture's resolved f-number: the engine builds the Airy kernels (`createDiffractionLimitedPsfProfile`)
     * on the site pitch. `kernelRadiusSamples` (0–32) sets the kernel window; default: the third dark ring at
     * the longest spectral node, capped at 32 sites. Not combinable with `psf` or `pupilSampling`. Default off.
     */
    diffraction?: SimulateCaptureLensDiffraction;
    /**
     * Opt-in (#492): defocus of the flat scene plane when `focusDistanceM` differs from the subject distance, as a
     * geometric disc (`model: "geometric-disc"`): the thin-lens blur circle of an ideal uniform circular pupil
     * (`calculateDefocusCircle`), an approximation. The blur diameter is recorded in the `lens.defocus` assumption.
     * `simulateCapture` renders the blur as an object-space convolution of the scene radiance on the site lattice and
     * `simulateDisplayView` as a site kernel in its expected signal; with `diffraction` each spectral node's diffraction
     * kernel is convolved with the disc (a further approximation). In focus the result is that of the same request
     * without the option, plus the assumption.
     * Not combinable with `pupilSampling` or `psf`. Default off.
     *
     * Bokeh character (#553), each part off by default (without them the disc is unchanged, byte for byte): `blades` (a
     * polygonal or rounded-blade opening), `sphericalAberration` (primary W040: soft-edged blur on one side of the focus
     * plane, bright-rimmed on the other) and `catsEye` (mechanical vignetting clipping the pupil by field position; the
     * capture only, not with `diffraction`). See `calculateDefocusBokehKernel` and docs/QUICK_START.md, "Bokeh character".
     */
    defocus?: { model: "geometric-disc" } & DefocusBokehOptions;
  };
  exposure?: {
    /** Default "manual". */
    mode?: SimulateCaptureExposureMode;
    /**
     * Default 100. #516: `"auto"` lets the body's Auto ISO choose the ISO from the meter target, within its Auto ISO range
     * (the tiers: ISO 100 to their maximum), in every mode: manual keeps the aperture and shutter; aperture priority keeps the
     * aperture and follows `autoIso`; shutter priority picks the aperture at the lowest Auto ISO (no wider than the target
     * needs, so at most the widest) and raises the ISO for the rest; program picks the program line at the lowest Auto ISO and
     * raises the ISO beyond the line's end. The result reports the ISO in `exposure.settings.iso` and how it was chosen in
     * `exposure.autoIso`.
     */
    iso?: number | "auto";
    /**
     * Auto ISO settings, with `iso: "auto"` only.
     *
     * - `slowestPreferredShutterSeconds` and `afterMaximumIso` (#516): aperture priority, where the slowest shutter is
     *   required, and (#504) program, where it is optional. The shutter gets as long as `slowestPreferredShutterSeconds`
     *   (seconds, within the body's shutter range) at the lowest Auto ISO; beyond it the ISO rises; at the Auto ISO maximum
     *   `afterMaximumIso` decides (default `"allow-slower-shutter"`; in program the shutter then never gets longer than the
     *   program line's own). Without it, program follows its line as before.
     * - `slowestPreferredShutterSeconds: "auto"` (#504): the engine derives it from the focal length, the pixel pitch and a
     *   hand-shake profile with `estimateAutoIsoSlowestShutter` (the camera-shake model, not the 1/focal-length rule of
     *   thumb); `automaticSlowestShutter` sets the bias, the blur budget, the shake and the stabilization.
     * - `limits` (#505): every mode. The photographer's Auto ISO range `{ maximum, minimum? }`, a choice kept apart from
     *   the body's Auto ISO capability: both are selectable ISOs inside the body's Auto ISO range, `minimum` at most
     *   `maximum` (default: the body's minimum). Outside the body's range or off its ISO grid the request fails; the
     *   engine never clips a limit. When the ISO stops at a limit strictly inside the body's range, the report's
     *   `limitingConstraint` is `"user-iso-maximum"` or `"user-iso-minimum"`.
     * - `isoSteps` (2.14): `"whole-stop"` (default) lets Auto ISO choose only the whole-stop ISOs of the body's grid
     *   (100, 200, 400 …), as before the generic bodies gained third-stop settings (preset 2.1.0); `"third-stop"` lets it
     *   choose every setting (100, 125, 160 …). Manual ISO always takes any setting of the grid. Limits must lie on the
     *   grid Auto ISO uses.
     */
    autoIso?: { slowestPreferredShutterSeconds?: number | "auto"; afterMaximumIso?: SimulateCaptureAutoIsoAfterMaximum; limits?: AutoIsoLimits;
      automaticSlowestShutter?: SimulateCaptureAutomaticSlowestShutterOptions; isoSteps?: "whole-stop" | "third-stop" };
    /** Shutter for manual and shutter-priority modes. Default 1/125 s. */
    shutterSeconds?: number;
    /** Exposure compensation applied to the meter target, in stops. Default 0. */
    compensationStops?: number;
    /**
     * 2.14: `"scene-average"` (default) or `"grey-card"` (incident metering, see {@link SimulateCaptureMetering}). Manual
     * exposure does not use the meter's reading, so the setting changes only the automatic modes and Auto ISO.
     */
    metering?: SimulateCaptureMetering;
  };
  /**
   * Required: an engine chart (for example `{ preset: "uniform" }`, an 18 % grey card), a declared `material-layers` scene (#491:
   * a chart under shape-mask layers, as `resolveChartMaterialLayers` takes it; the capture is that of its `callerScene`, byte for
   * byte, and the display view can render it on the GPU), or a caller reflectance, radiance or material function.
   */
  scene: ChartScene | ChartMaterialLayerScene | CallerReflectanceScene | CallerRadianceScene | CallerMaterialScene;
  /** Distance from the camera to the scene plane in metres. Default 5. */
  subjectDistanceM?: number;
  /**
   * Opt-in (2.3) fixed-size chart: place the scene at this physical size on the plane at the subject distance,
   * centred on the optical axis, instead of sizing it to fill the frame. Outside it the plane is a neutral surround
   * (default 18 %). Chart presets are resolved in the chart's own frame (aspect heightM / widthM); caller functions
   * are called only on the chart and receive chart-local `chartU`, `chartV`. `result.scene.chart` reports the
   * framed width, the fraction of the frame the chart covers and the thin-lens magnification.
   */
  chartSize?: ChartSizeOption;
  /** Default: Planckian 6500 K (a blackbody stand-in for daylight; CIE D65 is not bundled). */
  illuminant?: CaptureIlluminant;
  /** Illuminance on the scene plane, lux. Default about 21 481 lux (see `SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX` and the assumptions). */
  illuminanceLux?: number;
  output?: {
    /** Output pixels; the native sensor raster adds a one-site demosaic border on each side. Defaults 64 × 64. */
    width?: number;
    height?: number;
    /** Default "srgb-8". */
    format?: SimulateCaptureOutputFormat;
    /** Default "identity". */
    toneCurve?: SdrToneCurve;
    /** Required by the luminance tone curves (see `SdrToneCurveParameters`). The facade does not make one up. */
    toneCurveParameters?: SdrToneCurveParameters;
    /** Default "clip". */
    highlightMode?: RawHighlightMode;
    /**
     * Opt-in (#556) development exposure push in stops, −2 to +5 (`NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS`); default 0.
     * A linear gain 2^stops on the RAW after black subtraction and white normalization, before demosaic, white balance,
     * the highlight mode, colour, the tone curve and encoding, like a raw editor's exposure slider ("brighten in development").
     * A site pushed to or past white clips there and counts as saturated (`highlightMode: "reconstruct"` rolls it off);
     * raised shadows keep their real noise and ADC quantization. The RAW codes, `result.raw` and a DNG are not changed;
     * the developed samples (`image.samples`, also with format "dng"), JPEG, PNG, the ideal reference and the display view
     * honour it. Reported in the assumption `output.exposureCompensationStops`. 0 or omitted: byte-identical to before.
     */
    exposureCompensationStops?: number;
    /** Default "scene-illuminant". */
    whiteBalance?: SimulateCaptureWhiteBalance;
    /** JPEG constant quantization step 1-255 (not a manufacturer 'quality'). Default 2. */
    jpegQuantizationStep?: number;
    /** PNG only. Default "srgb". */
    colorEncoding?: SimulateCaptureColorEncoding;
    /** PNG only: 8 or 16 bits per sample. Default 8. */
    bitDepth?: 8 | 16;
    /**
     * PNG SDR encodings only. Default "clip" (per-component clip to the target gamut). "perceptual" maps
     * through `prepareRgbGamutMapping`: constant CIELAB L* and hue, chroma above 90 % of the boundary compressed.
     */
    gamutMapping?: "clip" | "perceptual";
    /** Default: the 1.0 facade's bilinear RGGB kernels. The record form (#395) adds a `fast` override. */
    demosaic?: SimulateCaptureDemosaic | SimulateCaptureDemosaicRecord;
    /** Default "margin". */
    borderHandling?: SimulateCaptureBorderHandling;
    /** DNG only: optional capture-event time (YYYY-MM-DDTHH:mm:ss.sssZ); without it no date tags are written. */
    dng?: { capturedAtUtc?: string };
    /**
     * Opt-in (2.4) text written into the file for formats "jpeg", "png" and "dng": the caller's description,
     * software, copyright and comment, unchanged (JPEG XMP + COM, PNG tEXt/iTXt, DNG TIFF tags + XMP; see the
     * quick start). Each field is 1–2048 UTF-8 bytes with no control characters except line feed. Default: none.
     */
    metadata?: OutputTextMetadata;
    /**
     * Opt-in large images: the most native sensor sites (the output plus the demosaic margin on each side) the
     * capture may allocate, an integer up to `NATIVE_RAW_LIMITS.ceilingPixels` (2^27). With it, `width` and
     * `height` may each reach 16 384 sites including the margin; without it they stay at most 4094. Time and
     * memory grow with the pixel count (see "Large images" in the quick start); browsers may fail at large sizes.
     */
    maximumPixels?: number;
    /**
     * Opt-in (2.3) region rendering: render only this rectangle, in output-pixel coordinates of the whole frame
     * `width` × `height` (x right, y down from its top-left). The pixels are byte-identical to the same pixels of
     * the whole render: framing, metering, exposure, noise seeds (absolute native site indices), rolling-shutter row
     * timing, diffraction and demosaic all use the whole frame. Use it to tile a large frame across workers or to
     * render a 100 % crop. `result.image` is the region; `result.region` reports it. Not combinable with
     * `whiteBalance: "auto"`, whose statistics would come from the region only. From 2.6 the diffraction convolution
     * covers only the region plus the kernel and filter reach, so a small region of a large frame costs about as much
     * as a capture of the region's size.
     */
    region?: { x: number; y: number; width: number; height: number };
    /**
     * Opt-in (#552) diffraction correction: a bounded, regularized deconvolution of the developed linear colour with the
     * diffraction OTF of the ideal circular pupil at the capture's working f-number (see {@link SimulateCaptureDiffractionCorrection}).
     * It runs after demosaic, colour and white balance and before the tone curve. Frequencies beyond the diffraction cut-off
     * 1/(λ·N_w) never reached the sensor and stay lost: the correction's design gain there is 0. Needs `lens.diffraction`.
     * Not combinable with `region`. The DNG's RAW codes are not changed. Default off.
     */
    diffractionCorrection?: SimulateCaptureDiffractionCorrection;
    /**
     * Opt-in (#552) unsharp mask (see {@link SimulateCaptureSharpening}) on the sRGB-encoded values after the tone curve and gamut
     * handling, before quantization. It raises edge contrast and creates halos; it adds no optical detail. sRGB output only
     * (not the wide-gamut or perceptual PNG paths); not combinable with `region`. The DNG's RAW codes are not changed. Default off.
     */
    sharpening?: SimulateCaptureSharpening;
  };
  /** Camera motion and shutter type. Default: still camera, global electronic shutter. */
  motion?: SimulateCaptureMotion;
  sensor?: {
    /**
     * Pixel pitch in micrometres, 0.5–1000. Default 6. The simulated sensor is output width × pitch wide. 2.5: above 100 µm the
     * capture is a downsized view of a whole frame (for example 36 mm / 48 pixels = 750 µm), recorded in the assumption
     * `sensor.wholeFrameView`: brightness is unchanged and the noise is that of a binned view, not of the real sensor's pixels.
     */
    pixelPitchMicrometers?: number;
    /** Maximum spectral quadrature subinterval in nm. Default 20. */
    spectralStepNanometers?: number;
    /** Temporal midpoint samples across the exposure. Default 1. */
    temporalSampleCount?: number;
    /** Noise seed (uint32). Default 1. */
    noiseSeed?: number;
    /**
     * Opt-in (2.1) optical anti-aliasing filter (birefringent point splitting, `SimulateCaptureSensorAntiAliasing`).
     * Multiplies the scene queries by the number of split points. Default off (the tiers declare no filter).
     */
    antiAliasing?: SimulateCaptureSensorAntiAliasing;
    /**
     * Opt-in (2.3) pixel aperture. `"point"` (default): each site samples the irradiance at its centre.
     * `"box"`: each site integrates the irradiance over its whole square photosite (fill factor 1) with an
     * N × N midpoint rule, N = `samplesPerAxis` (1–16, default 4), so detail finer than a pixel averages out as
     * on a real sensor (pixel MTF |sinc(f·p)|) instead of aliasing. Multiplies the scene queries by N².
     */
    pixelAperture?: SimulateCapturePixelAperture;
  };
  /**
   * Exact or fast (#395). `false` or omitted: every option runs its exact method, the engine reference. `true`: each option
   * listed in {@link SIMULATE_CAPTURE_FAST_OPTIONS} runs its fast method where it has one, a measured, bounded approximation of
   * the exact one; an option without a fast method runs exact. An option's own record `fast` overrides this for that option
   * only. `diagnostics.fast` reports what was requested and what ran. No option has a fast method yet, so every result is exact.
   */
  fast?: boolean;
  /** Aborting cancels the running task; the promise rejects with a domain error and returns no partial image. */
  signal?: AbortSignal;
  /** Called after each committed RAW, development or JPEG tile. Cannot change output. */
  onProgress?: (progress: SimulateCaptureProgress) => void;
}

/**
 * Options reported in `diagnostics.options` (2.1), in this order, when they ran: the ones that change how much work
 * a capture does. `motion.rotation` is a non-zero angular velocity; `sensor.temporalSampleCount` a count above 1.
 */
export const SIMULATE_CAPTURE_COST_OPTIONS = /* @__PURE__ */ Object.freeze(["lens.pupilSampling", "lens.projection", "lens.distortion", "lens.vignetting", "lens.psf",
  "lens.diffraction", "lens.defocus", "lens.catalogue", "sensor.antiAliasing", "sensor.pixelAperture.box", "sensor.temporalSampleCount", "motion.rotation", "motion.shutter.rolling", "output.borderHandling.mirror", "output.region",
  "output.whiteBalance.auto", "output.demosaic.ahd", "output.highlightMode.reconstruct", "output.colorEncoding.wide-gamut", "output.gamutMapping.perceptual",
  "output.diffractionCorrection", "output.sharpening", "output.format.jpeg", "output.format.png", "output.format.dng"] as const);
export type SimulateCaptureCostOption = typeof SIMULATE_CAPTURE_COST_OPTIONS[number];

/**
 * The options that take the exact-or-fast flag (#395), in the path style of {@link SIMULATE_CAPTURE_COST_OPTIONS}: each accepts
 * the record form with `fast` and is reported in `diagnostics.fast.applied` when it runs. Every one of them takes the flag,
 * whether or not it has a fast method yet; one without runs exact and reports `false`.
 */
export const SIMULATE_CAPTURE_FAST_OPTIONS = /* @__PURE__ */ Object.freeze(["lens.diffraction", "sensor.antiAliasing", "sensor.pixelAperture.box", "output.demosaic.ahd"] as const);
export type SimulateCaptureFastOption = typeof SIMULATE_CAPTURE_FAST_OPTIONS[number];

/** `diagnostics.fast` of a capture or display view (#395): what was asked for and what ran. */
export interface SimulateCaptureFastReport {
  /** True when `fast: true` was given at the top level or in any option's record. */
  requested: boolean;
  /** Each fast-capable option that ran, in {@link SIMULATE_CAPTURE_FAST_OPTIONS} order: true where its fast method ran. */
  applied: Readonly<Partial<Record<SimulateCaptureFastOption, boolean>>>;
  /** `engine-reference` when every option ran exact; `approximation-with-a-priori-bound` when any fast method ran (the WebGPU execution record's values). */
  assurance: "engine-reference" | "approximation-with-a-priori-bound";
}

export interface SimulateCaptureProgress {
  stage: "raw" | "white-balance" | "development" | "jpeg";
  completedTileCount: number;
  totalTileCount: number;
}

/** One decision the facade made: a default, a derived value or a fixed modelling choice. */
export interface SimulateCaptureAssumption {
  /** Dotted option path or modelling topic, for example "exposure.shutterSeconds" or "model.lens-psf". */
  id: string;
  kind: "default" | "derived" | "model";
  value: unknown;
  explanation: string;
}

export interface SimulateCaptureResult {
  facadeVersion: typeof SIMULATE_CAPTURE_FACADE_VERSION;
  engineApiVersion: string;
  image: {
    width: number;
    height: number;
    format: SimulateCaptureOutputFormat;
    /** Interleaved RGB, row by row from the top-left. sRGB-encoded (W3C CSS Color 4 sRGB; also IEC 61966-2-1) unless `colorEncoding` says otherwise. */
    samples: Uint8Array | Uint16Array;
    /** Baseline JPEG bytes when format is "jpeg". */
    jpeg?: Uint8Array;
    /** PNG file bytes when format is "png". */
    png?: Uint8Array;
    /** Encoding of `samples` and `png` when format is "png". */
    colorEncoding?: SimulateCaptureColorEncoding;
    /** Lossless uncompressed CFA DNG of the packed RAW when format is "dng" (`serializeNativeRawDng`); `samples` are then sRGB 8-bit. */
    dng?: Uint8Array;
  };
  /**
   * Packed native RAW (codes, black levels, saturation flags) as produced by the native environment RAW task. With
   * `output.region` (2.3): the region's native sites only, with `plan` describing that raster (its active area is the
   * region); `request.environmentRaw` and `request.siteInput` stay those of the whole frame.
   */
  raw: NativeRawOutput;
  plan: NativeRawPlan;
  /**
   * 2.3, present with `output.region`: the rendered rectangle in output pixels of the whole `frameWidth` × `frameHeight`
   * frame, and the native sites rendered for it (`nativeRect`, in the whole frame's native raster: the region, the
   * demosaic reach on each side clipped to the raster, and its origin rounded down to the 2 × 2 CFA repeat).
   */
  region?: { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number; nativeRect: { x: number; y: number; width: number; height: number } };
  /** The complete underlying request. */
  request: {
    environmentRaw: NativeEnvironmentRawInput;
    /** Rebuilds the exact physical site input the provider supplied for a native row-major index. */
    siteInput(nativeIndex: number): SimulateEnvironmentSensorRawFrameInput["sites"][number];
    development: Omit<NativeRawDevelopmentInput, "raw">;
    whiteBalanceState: ResolvedWhiteBalanceState | null;
    /**
     * Present with lens.diffraction (2.1): the engine-built Airy profile, the equivalent environment sampled PSF
     * selection, and how it was applied. With `object-space-convolution` the site inputs declare no PSF and the
     * provider answers with the PSF-convolved radiance; putting `psf` into each site input and using the plain
     * scene provider gives the same expected signal (to float rounding) through the per-tap environment quadrature.
     */
    diffraction?: { profile: DiffractionLimitedPsfProfile; psf: Extract<CalculateEnvironmentSensorPhotoSignalInput["psf"], { kind: "sampled-local" }>;
      execution: "object-space-convolution" | "environment-psf-quadrature" | "image-space-convolution" };
  };
  exposure: {
    mode: SimulateCaptureExposureMode;
    settings: { fNumber: number; shutterSeconds: number; iso: number };
    /** Exposure value at ISO 100 of the settings, log2(N²/t). */
    ev100: number;
    /** #516: `"automatic"` when the request asked for `iso: "auto"`, else `"manual"`. */
    isoControl: "manual" | "automatic";
    /** #516: present with `iso: "auto"`: how Auto ISO chose `settings.iso` and what limited it. */
    autoIso?: SimulateCaptureAutoIsoReport;
    /** 2.14: the metering the exposure used (`exposure.metering`; `"scene-average"` when omitted). */
    metering: SimulateCaptureMetering;
    /** The scene's average luminance on the meter's zones, cd/m², with either metering. */
    meteredSceneLuminanceCdPerSquareMeter: number;
    /**
     * #515: deviation, in stops, of the exposure used from the CIPA DC-004-2020 standard exposure for the metered luminance L:
     * log2(N²/t) − log2(0.65·L·S/10). Positive is darker than the standard exposure (under), negative brighter (over). In an
     * automatic mode it is the compensation with the opposite sign plus any step or limit the resolver hit. Finite, or null when
     * the metered luminance is 0 (a black scene has no standard exposure).
     */
    standardExposureDeviationStops: number | null;
    /**
     * The illuminance, lux, at which the settings used give the standard exposure: E·L_ref(N, t, S)/L = E·2^Δ, with E the
     * request's `illuminanceLux`. Exact for a reflective scene (a chart, a reflectance function or a material scene), whose
     * metered luminance is proportional to E. Null for a black scene (L = 0) and for a radiance-function scene, whose
     * radiance does not depend on the illuminance. It may exceed the 1e7 lux that `illuminanceLux` accepts.
     */
    standardExposureIlluminanceLux: number | null;
    /**
     * 2.14: deviation, in stops, of the exposure used from the CIPA DC-004-2020 standard exposure of an 18 % Lambertian grey
     * card under the request's illuminance E (incident metering: the light falling on the scene, as a grey card or a
     * hand-held incident meter reads it): log2(L_ref(N, t, S) / (0.18·E/π)), with L_ref = 10·N²/(0.65·t·S). Same sign as
     * `standardExposureDeviationStops` (positive is darker, under). It does not depend on the scene's reflectances; with the
     * default settings and illuminance it is exactly 0. The exposure modes still meter the scene (`meteredSceneLuminanceCdPerSquareMeter`);
     * this only reports where the settings used sit against the grey card. Null for a radiance-function scene, whose radiance
     * does not depend on the illuminance.
     */
    greyCardDeviationStops: number | null;
    /** Full output of the existing exposure-mode resolver. */
    resolution: unknown;
  };
  scene: {
    sceneId: string;
    preset: string;
    parameters: Readonly<Record<string, unknown>>;
    illuminant: { id: string; description: string; illuminanceLux: number };
    distanceM: number;
    /** Physical size of the framed scene plane, metres. */
    framedWidthM: number;
    framedHeightM: number;
    /**
     * 2.3, present with `chartSize`: the chart's physical size and surround, the fraction of the frame width and
     * height it covers (above 1 when it is larger than the frame and cropped), the thin-lens magnification
     * v/d (image distance over subject distance, the scale the facade's framing uses) and the chart's size on the
     * sensor in millimetres and output pixels.
     */
    chart?: { widthM: number; heightM: number; surroundReflectance: number; frameWidthFraction: number; frameHeightFraction: number;
      magnification: number; imageWidthMm: number; imageHeightMm: number; imageWidthPixels: number; imageHeightPixels: number };
    /**
     * SHA-256 of the canonical scene description, recorded as the capture source digest. Caller spectra (a
     * `spectrum` or `daylight` illuminant, chart reflectance spectra) are part of the description: tabulated
     * data exactly, function spectra sampled at 1 nm over 380-780 nm, plus the daylight basis datasetId.
     * The body of a caller scene's evaluate function is not hashed.
     */
    sourceSha256: string;
  };
  diagnostics: {
    providerEvaluationCount: number;
    highlight: RawHighlightDiagnostics;
    rendering: SdrRenderingResult["diagnostics"];
    /** Present with output.gamutMapping "perceptual": pixels whose chroma or lightness the mapping changed. */
    gamutMapping?: { method: "cielab-hue-preserving-chroma-compression"; kneeFraction: number; adjustedPixelCount: number; lightnessClippedPixelCount: number };
    /** #552: present with output.diffractionCorrection or output.sharpening. */
    detail?: SimulateCaptureDetailDiagnostics;
    /**
     * Wall-clock milliseconds per stage. `raw`, `whiteBalance` (the second RAW pass of auto white balance), `development`
     * (includes DNG writing), `jpeg` and `total` are whole milliseconds (`Date.now()`). Since 2.1, where a stage ran:
     * `diffraction` (the object-space convolution of `lens.diffraction`; part of `raw` and `whiteBalance`), `demosaic`
     * (the AHD demosaic; part of `development`) and `encode` (PNG, JPEG or DNG serialization), with sub-millisecond
     * resolution where the host has `performance.now()`. Timings vary from run to run and never enter any digest or output byte.
     * #492: `defocus`, the object-space convolution of `lens.defocus` out of focus (with `lens.diffraction` the combined
     * kernel's convolution, reported here instead of under `diffraction`).
     */
    timingsMs: { raw: number; whiteBalance: number; development: number; jpeg: number; total: number; diffraction?: number; defocus?: number; demosaic?: number; encode?: number };
    /**
     * 2.1: the opt-in options that changed the work of this run, in a fixed order (see `SIMULATE_CAPTURE_COST_OPTIONS`).
     * Empty for a capture with every default. With `timingsMs` it lets an application measure each option's cost on
     * the user's device.
     */
    options: readonly SimulateCaptureCostOption[];
    /** #395: exact or fast, as requested and as run (see {@link SimulateCaptureFastReport}). */
    fast: SimulateCaptureFastReport;
  };
  provenance: {
    scientificStatus: "approximation";
    cameraPresetId: string;
    cameraPresetVersion: string;
    evidence: readonly EvidenceProvenance[];
    /** Existing engine contracts the facade composed, in execution order. */
    composedContracts: readonly string[];
    limitations: readonly string[];
  };
  assumptions: readonly SimulateCaptureAssumption[];
}

export const FACADE_EVIDENCE: readonly EvidenceProvenance[] = /* @__PURE__ */ Object.freeze([/* @__PURE__ */ Object.freeze({ sourceOrigin: "photivra" as const,
  sourceReference: "photivra:simulate-capture-facade", reuseStatus: "photivra-owned" as const })]);
const DEFAULTS = /* @__PURE__ */ Object.freeze({ camera: "professional" as const, fNumber: 8, shutterSeconds: 1 / 125, iso: 100, compensationStops: 0,
  subjectDistanceM: 5, width: 64, height: 64, format: "srgb-8" as const, toneCurve: "identity" as const, highlightMode: "clip" as const,
  whiteBalance: "scene-illuminant" as const, jpegQuantizationStep: 2, pixelPitchMicrometers: 6, spectralStepNanometers: 20,
  temporalSampleCount: 1, noiseSeed: 1, illuminantKelvin: 6500 });
/** Standard output sensitivity S = 10 / H (CIPA DC-004-2020 §3.2): the reference exposure in lx·s is 10 / S. */
const SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS = 10;
/** Camera equation H = 0.65·L·t/N² (CIPA DC-004-2020 §5.5 (4); 0.65 = τ·π/4 with τ = 0.828, Explanation 4). */
const CAMERA_EQUATION_CONSTANT = 0.65;
/** Neutral reference reflectance: DC-004 ties the SOS reference level to an 18 % grey (Explanation 1 and 2.2). */
const GREY_CARD_REFLECTANCE = 0.18;
/** Scene luminance (cd/m²) whose focal-plane exposure 0.65·L·t/N² equals the SOS reference exposure 10/S. */
function sosReferenceLuminance(fNumber: number, shutterSeconds: number, iso: number): number {
  return SOS_REFERENCE_EXPOSURE_NUMERATOR_LUX_SECONDS * fNumber ** 2 / (CAMERA_EQUATION_CONSTANT * shutterSeconds * iso);
}
/**
 * #515: deviation, in stops, of the exposure the settings give from the CIPA DC-004-2020 standard exposure for the metered
 * luminance L: Δ = log2(N²/t) − log2(0.65·L·S/10) = log2(L_ref(N, t, S) / L), with L_ref the luminance that the settings
 * expose at H = 10/S (S = 10/H, §3.2; H = 0.65·L·t/N², §5.5 (4)). Positive is darker than the standard exposure (under).
 * A scene with no metered luminance (L = 0, which manual mode still captures) has no standard exposure: null, never ±Infinity.
 */
function standardExposureDeviationStops(fNumber: number, shutterSeconds: number, iso: number, meteredLuminance: number): number | null {
  if (!(meteredLuminance > 0)) return null;
  const deviation = Math.log2(sosReferenceLuminance(fNumber, shutterSeconds, iso) / meteredLuminance);
  if (!Number.isFinite(deviation)) throw new InvalidScientificResultError("exposure.standardExposureDeviationStops is not finite (metered scene luminance " +
    meteredLuminance + " cd/m²).");
  return deviation;
}
/**
 * The illuminance at which the settings give the standard exposure, E·L_ref/L (= E·2^Δ). A reflective scene's radiance is
 * reflectance × k(E)·S(λ)/π with k linear in E (calculateIlluminantIrradianceScale), so the metered L is proportional to E
 * and re-metering at this illuminance gives Δ = 0 up to rounding. A radiance-function scene ignores E, and a black scene
 * has no standard exposure: null.
 */
function standardExposureIlluminanceLux(fNumber: number, shutterSeconds: number, iso: number, meteredLuminance: number, illuminanceLux: number,
  radianceScalesWithIlluminance: boolean): number | null {
  if (!radianceScalesWithIlluminance || !(meteredLuminance > 0)) return null;
  const lux = illuminanceLux * sosReferenceLuminance(fNumber, shutterSeconds, iso) / meteredLuminance;
  if (!Number.isFinite(lux)) throw new InvalidScientificResultError("exposure.standardExposureIlluminanceLux is not finite (metered scene luminance " +
    meteredLuminance + " cd/m²).");
  return lux;
}
/**
 * 2.14: deviation, in stops, of the settings from the standard exposure of an 18 % Lambertian grey card under illuminance E:
 * Δ_grey = log2(L_ref(N, t, S) / (0.18·E/π)), computed as log2((π·L_ref/0.18) / E) so that at the default settings the
 * numerator is SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX in the same operations, and the default request gives exactly 0.
 * The grey card's luminance L = ρ·E/π is that of a Lambertian reflector (luminance = illuminance × reflectance / π).
 */
function greyCardDeviationStops(fNumber: number, shutterSeconds: number, iso: number, illuminanceLux: number): number {
  const deviation = Math.log2(Math.PI * sosReferenceLuminance(fNumber, shutterSeconds, iso) / GREY_CARD_REFLECTANCE / illuminanceLux);
  if (!Number.isFinite(deviation)) throw new InvalidScientificResultError("exposure.greyCardDeviationStops is not finite (illuminance " + illuminanceLux + " lux).");
  return deviation;
}
/**
 * Default illuminance, lux: an 18 % Lambertian grey card (L = 0.18·E/π) then gets exactly the CIPA DC-004 standard
 * output sensitivity reference exposure H = 10/S at f/8, 1/125 s, ISO 100:
 * E = π·10·N²/(0.65·t·S·0.18) = π·80 000/11.7 ≈ 21 480.98 lux.
 */
export const SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX = Math.PI * sosReferenceLuminance(DEFAULTS.fNumber, DEFAULTS.shutterSeconds, DEFAULTS.iso) /
  GREY_CARD_REFLECTANCE;
/**
 * Sensitive-aperture area (µm²) at which the tier's ISO signal chain applies unchanged: the default 6 µm square
 * aperture with fill factor 1. At other areas the facade scales the electron-domain readout values by
 * area / this reference, so the same focal-plane exposure H gives the same output code (see `isoAreaScaledReadout`).
 */
/** 2.5: the largest accepted pixel pitch, µm (44 mm ÷ 48 pixels ≈ 917 µm, a whole full-frame or larger sensor at a small output). */
const SIMULATE_CAPTURE_PIXEL_PITCH_MAXIMUM_MICROMETERS = 1000;
/** Pitches above this, µm, are larger than any camera photosite: the capture is a downsized whole-frame view (assumption sensor.wholeFrameView). */
const SIMULATE_CAPTURE_PHOTOSITE_PITCH_MAXIMUM_MICROMETERS = 100;
const ISO_REFERENCE_APERTURE_AREA_SQUARE_MICROMETERS = DEFAULTS.pixelPitchMicrometers * DEFAULTS.pixelPitchMicrometers;
/** Demosaic border, native sites per side. */
const MARGIN = 1;
/**
 * AHD border, native sites per side: an AHD output pixel depends on sites up to 5 away (directional green ±2,
 * colour differences ±1 of it, the homogeneity's 4-neighbours and its 3 × 3 sum), so a 5-site rendered margin keeps
 * every output pixel off the plane's mirrored edge.
 */
const AHD_MARGIN = 5;
/** Sites whose values enter an AHD output pixel (interpolation reach), for the saturated-pixel count. */
const AHD_VALUE_REACH = 3;

/** Anti-aliasing filter limits: split points, and the largest offset in sites (bounds the scene work and the convolution margin). */
const AA_MAXIMUM_COMPONENTS = 16;
const AA_MAXIMUM_OFFSET_SITES = 4;
/** Channel responses kept across calls (`axisChannelResponse`): one entry per distinct sensor, exposure and optics state. */
const CHANNEL_RESPONSE_CACHE_SIZE = 8;
const channelResponseCache = new Map<string, Record<"red" | "green" | "blue", Map<number, number>>>();
/**
 * #449: diffraction profiles kept across calls, by the JSON of their `createDiffractionLimitedPsfProfile` input (the last
 * DIFFRACTION_PROFILE_CACHE_SIZE, most recently used last). Every region part and detail tile of one request builds the same
 * input. The kept record is private: each call gets its own copy, as mutable as a newly built one, so a caller's change
 * never reaches another call. The copy is made of plain records and arrays (plainDataCopy): the kernel set-up structured-clones
 * the profile (once per spectral node before 2.15.0, once per request since), and in a CPU profile of the 96 × 64 Quality tile
 * that clone took about twice as long (24 instead of 12 ms per call) on a deep-frozen record or on a structuredClone copy as on a newly built record or this copy.
 * 2.15.0: profiles may hold up to 400 wavelengths (a 1 nm spectral step), so the cache also keeps at most
 * DIFFRACTION_PROFILE_CACHE_KERNEL_VALUES kernel values in all (wavelengths × (2R + 1)², summed), the most it could hold before
 * (8 profiles of 64 wavelengths at radius 32); the newest profile is always kept.
 */
const DIFFRACTION_PROFILE_CACHE_SIZE = 8;
const DIFFRACTION_PROFILE_CACHE_KERNEL_VALUES = 8 * 64 * 65 * 65;
const kernelValuesOf = (profile: DiffractionLimitedPsfProfile): number => profile.wavelengths.length * (2 * profile.kernelRadiusSamples + 1) ** 2;
const diffractionProfileCache = new Map<string, DiffractionLimitedPsfProfile>();
/** A copy of plain data (records, arrays, primitives; typed arrays are sliced), built from ordinary literals. */
function plainDataCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plainDataCopy) as T;
  if (ArrayBuffer.isView(value)) return (value as unknown as { slice(): T }).slice();
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) copy[key] = plainDataCopy((value as Record<string, unknown>)[key]);
  return copy as T;
}
/** The profile of `input` (a pure function of the input record): a copy of the kept one when the same input was built before. */
function cachedDiffractionProfile(input: Parameters<typeof createDiffractionLimitedPsfProfile>[0]): DiffractionLimitedPsfProfile {
  const key = JSON.stringify(input);
  let kept = diffractionProfileCache.get(key);
  if (kept) diffractionProfileCache.delete(key);
  else kept = createDiffractionLimitedPsfProfile(input).value;
  diffractionProfileCache.set(key, kept);
  let kernelValues = 0;
  for (const profile of diffractionProfileCache.values()) kernelValues += kernelValuesOf(profile);
  while (diffractionProfileCache.size > 1 && (diffractionProfileCache.size > DIFFRACTION_PROFILE_CACHE_SIZE || kernelValues > DIFFRACTION_PROFILE_CACHE_KERNEL_VALUES)) {
    const oldest = diffractionProfileCache.keys().next().value!;
    kernelValues -= kernelValuesOf(diffractionProfileCache.get(oldest)!);
    diffractionProfileCache.delete(oldest);
  }
  // The same fields in the same order as the built record, frozen at the top level like it; `model` is the frozen constant.
  return Object.freeze({ ...kept, profile: plainDataCopy(kept.profile), wavelengths: plainDataCopy(kept.wavelengths), quadrature: plainDataCopy(kept.quadrature) });
}
/** Default birefringent separation in sites: the two-spot MTF |cos(π·f·d)| then has its first zero at Nyquist, f = 1/(2·pitch). */
const AA_DEFAULT_SEPARATION_SITES = 1;
interface ParsedAntiAliasing { kind: SimulateCaptureSensorAntiAliasing["kind"]; separationSites?: number; axis?: "horizontal" | "vertical";
  components: AntiAliasingPointSplitComponent[] }
/** #395: the `fast` override of an option record (undefined when absent), which must be a Boolean. */
function fastOverride(record: Record<string, unknown>, path: string): boolean | undefined {
  const value = record.fast;
  if (value !== undefined && typeof value !== "boolean") fail(path + ".fast must be true or false.");
  return value as boolean | undefined;
}
/** Parses `sensor.antiAliasing` into engine point-splitting components (offsets in µm, +x right, +y down). */
function parseAntiAliasing(value: unknown, pitch: number): ParsedAntiAliasing {
  requireInputObject(value, "sensor.antiAliasing");
  const kind = (value as { kind?: unknown }).kind;
  const separation = (record: Record<string, unknown>): number => {
    if (record.separationSites === undefined) return AA_DEFAULT_SEPARATION_SITES;
    const d = positive(record.separationSites, "sensor.antiAliasing.separationSites");
    if (d > AA_MAXIMUM_OFFSET_SITES) fail("sensor.antiAliasing.separationSites must be greater than 0 and at most " + AA_MAXIMUM_OFFSET_SITES + ".");
    return d;
  };
  if (kind === "four-spot") {
    const record = allowKeys(value, "sensor.antiAliasing", ["kind", "separationSites", "fast"]), d = separation(record), h = d * pitch / 2;
    return { kind, separationSites: d, components: [[-h, -h], [h, -h], [-h, h], [h, h]].map(([x, y]) => ({ offsetMicrometers: { x: x!, y: y! }, normalizedWeight: 0.25 })) };
  }
  if (kind === "two-spot") {
    const record = allowKeys(value, "sensor.antiAliasing", ["kind", "axis", "separationSites", "fast"]), d = separation(record), h = d * pitch / 2;
    if (record.axis !== "horizontal" && record.axis !== "vertical") fail("sensor.antiAliasing.axis must be horizontal or vertical.");
    const axis = record.axis as "horizontal" | "vertical";
    return { kind, axis, separationSites: d, components: [-h, h].map((o) => ({ offsetMicrometers: axis === "horizontal" ? { x: o, y: 0 } : { x: 0, y: o }, normalizedWeight: 0.5 })) };
  }
  if (kind === "point-splitting") {
    const record = allowKeys(value, "sensor.antiAliasing", ["kind", "components", "fast"]);
    if (!Array.isArray(record.components) || record.components.length === 0 || record.components.length > AA_MAXIMUM_COMPONENTS) {
      fail("sensor.antiAliasing.components must be an array of 1 to " + AA_MAXIMUM_COMPONENTS + " components.");
    }
    // The engine's optical-stack parser checks shape, finiteness, positive weights and the unit sum (1e-12).
    const kernel = resolveAntiAliasingSpatialKernel({ schemaVersion: "0.1.0", profileId: "facade-aa-check", evidence: FACADE_EVIDENCE,
      effectiveAntiAliasingSpatialResponse: { kind: "normalized-point-splitting-kernel", evidence: FACADE_EVIDENCE, coordinateSystem: "native-sensor-physical",
        scope: "field-wavelength-polarization-invariant-approximation", components: record.components as AntiAliasingPointSplitComponent[] } });
    for (const c of kernel.components) if (Math.max(Math.abs(c.offsetMicrometers.x), Math.abs(c.offsetMicrometers.y)) > AA_MAXIMUM_OFFSET_SITES * pitch) {
      fail("sensor.antiAliasing.components offsets must lie within " + AA_MAXIMUM_OFFSET_SITES + " sites (" + AA_MAXIMUM_OFFSET_SITES * pitch + " µm) of the site centre.");
    }
    return { kind, components: kernel.components.map((c) => ({ offsetMicrometers: { ...c.offsetMicrometers }, normalizedWeight: c.normalizedWeight })) };
  }
  return fail("sensor.antiAliasing.kind must be four-spot, two-spot or point-splitting.");
}

/** Midpoint nodes of an N × N rule over a square photosite, as offsets from its centre in sites (+x right, +y down). */
export function apertureNodeOffsets(n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push({ x: (i + 0.5) / n - 0.5, y: (j + 0.5) / n - 0.5 });
  return out;
}
/** Third dark ring of the Airy pattern in units of λ·N_w (j₁,₃/π, j₁,₃ = 10.1734681351): the default diffraction kernel reach. */
const AIRY_THIRD_ZERO_PER_LAMBDA_N = 10.173468135062722 / Math.PI;
/** Default temporal midpoints when the camera rotates (2.0 motion option). */
const ROTATING_TEMPORAL_SAMPLE_COUNT = 8;
const IDS = /* @__PURE__ */ Object.freeze({ frame: "facade-frame", mode: "native-still", cfa: "photivra-generic-bayer", binding: "facade-native-cfa",
  sceneState: "facade-scene-state", scene: "facade-scene", provider: "facade-provider", lights: "facade-lights", materials: "facade-materials",
  capture: "facade-capture", spectral: "facade-colorimetric-eqe", sampling: "facade-sampling", stack: "facade-no-aa", stackAa: "facade-aa",
  stationarity: "facade-stationarity", operatingState: "facade-operating-state", dark: "facade-dark", completeness: "facade-completeness",
  chargeSampling: "facade-charge-sampling", capacity: "facade-capacity" });
export const CHANNELS = ["red", "green", "blue"] as const;
type Channel = typeof CHANNELS[number];
/**
 * Synthetic colorimetric sensor: channel EQE(λ) = a·cmf(λ)·(555 nm/λ), with cmf = x̄, ȳ, z̄. The λ factor turns
 * the energy-weighted CMF (colour-matching function) into a photon-counting response. So channel counts are
 * proportional to CIE XYZ (the Luther–Ives condition holds, up to quadrature error), and the camera→XYZ
 * matrix is diagonal.
 */
const EQE_SCALE: Readonly<Record<Channel, number>> = /* @__PURE__ */ Object.freeze({ red: 0.5, green: 0.5, blue: 0.25 });
const CMF_KEY: Readonly<Record<Channel, "x" | "y" | "z">> = /* @__PURE__ */ Object.freeze({ red: "x", green: "y", blue: "z" });
export const CAMERA_TO_XYZ: readonly (readonly number[])[] = Object.freeze([[EQE_SCALE.green / EQE_SCALE.red, 0, 0], [0, 1, 0], [0, 0, EQE_SCALE.green / EQE_SCALE.blue]].map((r) => Object.freeze(r)));
const XYZ_TO_CAMERA = [[EQE_SCALE.red / EQE_SCALE.green, 0, 0], [0, 1, 0], [0, 0, EQE_SCALE.blue / EQE_SCALE.green]] as const;
/** Synthetic dark current per site at the operating temperature, e⁻/s. */
export const DARK_CURRENT_ELECTRONS_PER_SECOND = 1;
const OPERATING_TEMPERATURE_C = 20;

export function fail(message: string): never { throw new InvalidConfigurationError(message); }
/** Where `output.metadata` goes in each file format (reported in the `output.metadata` assumption). */
const TEXT_METADATA_LAYOUT = /* @__PURE__ */ Object.freeze({
  jpeg: "XMP packet in APP1 (dc:description, xmp:CreatorTool, dc:rights, exif:UserComment), plus a COM segment holding the comment",
  png: "One tEXt (printable Latin-1) or iTXt (UTF-8) chunk per field, keywords Description, Software, Copyright, Comment, before the first IDAT",
  dng: "ImageDescription (statement, then the description) and Copyright when printable ASCII; an XMP packet in tag 700 with every field"
});
type ReadoutProfile = GenericEquipmentTierPreset["body"]["readout"][number]["profile"];
/**
 * The readout profile with every regime's charge-domain transfer scaled by `areaScale`: system conversion gain
 * (e⁻ per code) and pre-ADC saturation (e⁻ equivalent) are multiplied by it, so codes per unit focal-plane exposure
 * stay those of the reference aperture. Read noise stays in electrons per pixel; codes, black level, ADC and digital
 * gain are unchanged. The result is re-checked by the readout parser.
 */
function isoAreaScaledReadout(profile: ReadoutProfile, areaScale: number): ReadoutProfile {
  return parseSensorReadoutConversionProfile({ ...profile, regimes: profile.regimes.map((regime) => ({ ...regime,
    systemConversionGainElectronsPerCode: { ...regime.systemConversionGainElectronsPerCode, value: regime.systemConversionGainElectronsPerCode.value * areaScale },
    preAdcSaturationElectronEquivalent: { ...regime.preAdcSaturationElectronEquivalent, value: regime.preAdcSaturationElectronEquivalent.value * areaScale } })) });
}
/** Diagnostic clock for the 2.1 stage timings: `performance.now()` where the host has it. Never affects output. */
export function clockMs(): number { return globalThis.performance?.now() ?? Date.now(); }
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(name + " must be a positive finite number.");
  return value as number;
}
function integerIn(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(name + " must be an integer from " + minimum + " to " + maximum + ".");
  return value as number;
}
export function allowKeys(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (value === undefined) return {};
  requireInputObject(value, name);
  for (const key of Object.keys(value as object)) if (!keys.includes(key)) fail("Unknown " + name + " field: " + key + ".");
  return value as Record<string, unknown>;
}
function sampled(values: readonly { nm: number; value: number }[]): { wavelengthUnit: "nm"; wavelengthBasis: "vacuum"; interpolation: "piecewise-linear";
  outsideRangeBehavior: "fail-closed"; evidence: readonly EvidenceProvenance[]; samples: { wavelengthNanometers: number; value: number }[] } {
  return { wavelengthUnit: "nm", wavelengthBasis: "vacuum", interpolation: "piecewise-linear", outsideRangeBehavior: "fail-closed", evidence: FACADE_EVIDENCE,
    samples: values.map((s) => ({ wavelengthNanometers: s.nm, value: s.value })) };
}
async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) fail("simulateCapture needs crypto.subtle (a secure browser context or Node 22+) to digest the scene description.");
  const bytes = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
/**
 * The form in which a caller spectrum enters the scene digest. Tabulated data is hashed exactly as its
 * (wavelength, value) pairs. A function spectrum has no data to hash, so it is sampled at the facade's
 * 1 nm integer nodes over 380-780 nm (the grid the facade also uses to normalize illuminance).
 */
function spectrumDigestForm(raw: unknown, prepared: PreparedColorimetricSpectrum): unknown {
  const record = raw as { kind?: unknown; samples?: readonly { wavelengthNanometers: number; value: number }[] };
  if (record.kind === "tabulated" && Array.isArray(record.samples)) {
    return { kind: "tabulated", samples: record.samples.map((sample) => [sample.wavelengthNanometers, sample.value]) };
  }
  const values: number[] = [];
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm++) values.push(prepared.evaluate(nm));
  return { kind: "function-sampled-1nm", rangeNanometers: [FACADE_SPECTRAL_RANGE_NANOMETERS.minimum, FACADE_SPECTRAL_RANGE_NANOMETERS.maximum], values };
}
/**
 * #449: the CIE 1931 ȳ values at luminanceOf's 5 nm nodes, evaluated once (estimateCie1931ColorMatchingFunctions is a pure
 * function of the wavelength, so each entry is the value the loop would compute).
 */
let luminanceCmfY: Float64Array | undefined;
function luminanceNodesY(): Float64Array {
  if (luminanceCmfY) return luminanceCmfY;
  const values: number[] = [];
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm += 5) values.push(estimateCie1931ColorMatchingFunctions(nm).y);
  return (luminanceCmfY = Float64Array.from(values));
}
function luminanceOf(radiance: (nm: number) => number): number {
  const cmfY = luminanceNodesY();
  let sum = 0;
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum, i = 0; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm += 5, i++) {
    const w = nm === FACADE_SPECTRAL_RANGE_NANOMETERS.minimum || nm === FACADE_SPECTRAL_RANGE_NANOMETERS.maximum ? 2.5 : 5;
    sum += w * radiance(nm) * cmfY[i]!;
  }
  return PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W * sum;
}
/**
 * 2.14: the capabilities with the ISO grid cut to its whole stops (ISO 100·2^k, as the 2.0.0 tier bodies list them), for
 * Auto ISO's default `isoSteps: "whole-stop"`. A whole-stop grid is returned unchanged, so 2.0.0 records resolve as before.
 */
function wholeStopIsoCapabilities(capabilities: ResolvedGenericEquipmentExposureCapabilities): ResolvedGenericEquipmentExposureCapabilities {
  const grid = capabilities.iso.settingGrid;
  if (grid.kind !== "discrete-values") return capabilities;
  const whole = grid.values.filter((iso) => Number.isInteger(Math.log2(iso / 100)));
  if (whole.length === grid.values.length || whole.length === 0) return capabilities;
  return { ...capabilities, iso: { ...capabilities.iso, settingGrid: { kind: "discrete-values", values: Object.freeze(whole) } } };
}
/** The white balance measured from a perfect white diffuser under the scene illuminant ("scene-illuminant"). */
export function sceneIlluminantWhiteBalance(illuminant: ResolvedCaptureIlluminant): ResolvedWhiteBalanceState {
  const xyz = illuminantXyz(illuminant), camera = XYZ_TO_CAMERA.map((row) => row[0] * xyz[0] + row[1] * xyz[1] + row[2] * xyz[2]);
  return resolveCustomWhiteBalance({ stateId: "facade-wb-scene-illuminant", sampleSet: { imageStateId: "facade-white-diffuser",
    inputDomain: "relative-pre-wb-camera-linear-rgb", samples: [{ sampleId: "white", red: camera[0]!, green: camera[1]!, blue: camera[2]!, weight: 1, clipped: false }] } });
}
function illuminantXyz(illuminant: ResolvedCaptureIlluminant): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm++) {
    const s = illuminant.shape.evaluate(nm), c = estimateCie1931ColorMatchingFunctions(nm);
    x += s * c.x; y += s * c.y; z += s * c.z;
  }
  return [x / y, 1, z / y];
}
/** Bilinear RGGB demosaic as explicit linear neighbourhood kernels (weights sum to one per output channel). */
export function bilinearPhaseProfiles(): RawFrameReconstructionPhaseProfile[] {
  const cross = [[1, 0], [-1, 0], [0, 1], [0, -1]], diagonal = [[1, 1], [1, -1], [-1, 1], [-1, -1]], horizontal = [[1, 0], [-1, 0]], vertical = [[0, 1], [0, -1]];
  type Contribution = { offsetX: number; offsetY: number; sourceChannelId: Channel; weight: number };
  const average = (offsets: number[][], channel: Channel): Contribution[] => offsets.map(([x, y]) => ({ offsetX: x!, offsetY: y!, sourceChannelId: channel, weight: 1 / offsets.length }));
  const self = (channel: Channel): Contribution[] => [{ offsetX: 0, offsetY: 0, sourceChannelId: channel, weight: 1 }];
  const kernels: Record<string, Record<Channel, ReturnType<typeof self>>> = {
    "0,0": { red: self("red"), green: average(cross, "green"), blue: average(diagonal, "blue") },
    "1,0": { red: average(horizontal, "red"), green: self("green"), blue: average(vertical, "blue") },
    "0,1": { red: average(vertical, "red"), green: self("green"), blue: average(horizontal, "blue") },
    "1,1": { red: average(diagonal, "red"), green: average(cross, "green"), blue: self("blue") }
  };
  return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([px, py], index) => ({ phaseX: px!, phaseY: py!, profile: { schemaVersion: "0.1.0" as const,
    profileId: "facade-bilinear-phase-" + index, profileVersion: "1", captureModeId: IDS.mode, colorSamplingProfileId: IDS.cfa,
    scientificStatus: "approximation" as const, method: "explicit-linear-native-neighborhood" as const,
    normalization: "weights-sum-to-one-per-output-channel" as const, negativeBlackSubtractedValuesAllowed: true,
    kernels: CHANNELS.map((c) => ({ outputChannelId: c, contributions: kernels[px + "," + py]![c] })), evidence: FACADE_EVIDENCE,
    limitations: ["Bilinear interpolation of the RGGB mosaic; no edge-directed demosaic, false-colour suppression or calibration."] } })) as unknown as RawFrameReconstructionPhaseProfile[];
}
/**
 * #516: the result's Auto ISO report, read from a resolved Auto ISO resolution (every mode's resolved Auto ISO branch carries
 * `idealIsoBeforeConstraints`, `isoResolution` and a resolved `targetResidual`; aperture priority adds its fallback flag).
 */
function autoIsoReport(resolution: unknown, iso: ResolvedGenericEquipmentExposureCapabilities["iso"],
  shutterPolicy: { slowestPreferredShutterSeconds: number; afterMaximumIso: SimulateCaptureAutoIsoAfterMaximum } | undefined,
  limits: { minimum: number; maximum: number } | undefined, automatic: SimulateCaptureAutomaticSlowestShutterReport | undefined,
  isoSteps?: "whole-stop" | "third-stop"): SimulateCaptureAutoIsoReport {
  const r = resolution as { idealIsoBeforeConstraints?: unknown; isoResolution?: { clamped?: unknown }; afterMaximumIsoFallbackUsed?: unknown;
    slowestPreferredShutter?: { applied?: unknown; afterMaximumIsoFallbackUsed?: unknown };
    targetResidual?: { status?: unknown; limitingConstraint?: unknown; residualStops?: unknown } };
  // Program reports its hold under slowestPreferredShutter (#504); aperture priority at the top level.
  const program = r.slowestPreferredShutter;
  const ideal = r.idealIsoBeforeConstraints, residual = r.targetResidual?.residualStops, clamped = r.isoResolution?.clamped;
  if (typeof ideal !== "number" || !Number.isFinite(ideal) || typeof residual !== "number" || !Number.isFinite(residual) || r.targetResidual?.status !== "resolved" ||
    (clamped !== false && clamped !== "minimum" && clamped !== "maximum"))
    throw new InvalidScientificResultError("Auto ISO resolution did not report a finite ideal ISO and residual.");
  // The resolvers' Auto ISO range: the body's Auto ISO bounds, else its ISO range.
  return { idealIsoBeforeConstraints: ideal, autoIsoMinimum: iso.autoIsoMinimum ?? iso.minimum, autoIsoMaximum: iso.autoIsoMaximum ?? iso.maximum, clamped,
    ...(limits ? { limits: { ...limits } } : {}), limitingConstraint: r.targetResidual.limitingConstraint as ExposureResolutionConstraint, residualStops: residual,
    ...(shutterPolicy ? { ...shutterPolicy, afterMaximumIsoFallbackUsed: (program ? program.afterMaximumIsoFallbackUsed : r.afterMaximumIsoFallbackUsed) === true } : {}),
    ...(program ? { slowestPreferredShutterApplied: program.applied === true } : {}),
    ...(automatic ? { automaticSlowestShutter: automatic } : {}), ...(isoSteps ? { isoSteps } : {}) };
}
/**
 * #505: `exposure.autoIso.limits`, the photographer's Auto ISO range. Both limits are selectable ISOs inside the body's
 * Auto ISO range, `minimum` at most `maximum`; anything else fails (the resolvers check the same, but an option defect
 * is a configuration error here). `minimum` defaults to the body's Auto ISO minimum.
 */
function parseAutoIsoLimitsOption(value: unknown, iso: ResolvedGenericEquipmentExposureCapabilities["iso"]): { minimum: number; maximum: number } {
  const record = allowKeys(value, "exposure.autoIso.limits", ["maximum", "minimum"]);
  if (record.maximum === undefined) fail("exposure.autoIso.limits.maximum is required: the highest ISO Auto ISO may choose.");
  const bodyMinimum = iso.autoIsoMinimum ?? iso.minimum, bodyMaximum = iso.autoIsoMaximum ?? iso.maximum;
  const limit = (field: "maximum" | "minimum"): number => {
    const v = positive(record[field], "exposure.autoIso.limits." + field);
    if (v < bodyMinimum || v > bodyMaximum)
      fail("exposure.autoIso.limits." + field + " (ISO " + v + ") must be within the body's Auto ISO range, ISO " + bodyMinimum + " to " + bodyMaximum + ".");
    if (iso.settingGrid.kind === "discrete-values" && !iso.settingGrid.values.includes(v))
      fail("exposure.autoIso.limits." + field + " (ISO " + v + ") must be a selectable ISO of the body: " + iso.settingGrid.values.join(", ") + ".");
    return v;
  };
  const maximum = limit("maximum"), minimum = record.minimum === undefined ? bodyMinimum : limit("minimum");
  if (minimum > maximum) fail("exposure.autoIso.limits.minimum (ISO " + minimum + ") must not exceed exposure.autoIso.limits.maximum (ISO " + maximum + ").");
  return { minimum, maximum };
}
/**
 * #504: `exposure.autoIso.slowestPreferredShutterSeconds: "auto"`: the slowest preferred shutter from the camera-shake model
 * (`estimateAutoIsoSlowestShutter`) for this lens, focus and pixel pitch, within the body's shutter range. Option defects are
 * configuration errors; the defaults are recorded as `default` assumptions and the derivation as a `model` assumption.
 */
function resolveAutomaticSlowestShutterOption(value: unknown, context: { focalLengthMm: number; focusDistanceM: number; pitch: number;
  shutter: ResolvedGenericEquipmentExposureCapabilities["shutter"];
  assume: (id: string, kind: SimulateCaptureAssumption["kind"], value: unknown, explanation: string) => void;
  pick: <T>(record: Record<string, unknown>, key: string, path: string, fallback: T, explanation: string) => T }): SimulateCaptureAutomaticSlowestShutterReport {
  const path = "exposure.autoIso.automaticSlowestShutter";
  const record = allowKeys(value, path, ["fasterByStops", "blurBudgetPixels", "angularVelocityRadPerSec", "stabilizationStopsEquivalent"]);
  const fasterByStops = context.pick<unknown>(record, "fasterByStops", path + ".fasterByStops", 0, "No bias: the derived slowest shutter is used as is.");
  if (typeof fasterByStops !== "number" || !Number.isInteger(fasterByStops) || Math.abs(fasterByStops) > 2) fail(path + ".fasterByStops must be a whole number of stops from -2 to +2.");
  const blurBudgetPixels = positive(context.pick<unknown>(record, "blurBudgetPixels", path + ".blurBudgetPixels", 1,
    "A generic pixel-level blur budget: the shake trace during the exposure may be one pixel long. A choice, not a measured threshold."), path + ".blurBudgetPixels");
  const angularOption = context.pick<unknown>(record, "angularVelocityRadPerSec", path + ".angularVelocityRadPerSec", { ...GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC },
    "Generic hand shake: 4.39 °/s (0.0766 rad/s) on yaw, the linear camera-motion rate Xiao, Farrell, Catrysse and Wandell (Proc. SPIE 7250, 2009) use for an average user " +
    "holding a 100 g mobile handset with two hands. A labelled generic default, not a measurement of this photographer or camera.");
  const angular = allowKeys(angularOption, path + ".angularVelocityRadPerSec", ["yaw", "pitch"]);
  for (const axis of ["yaw", "pitch"]) {
    const v = angular[axis];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 100) fail(path + ".angularVelocityRadPerSec." + axis + " must be a finite number within ±100 rad/s.");
  }
  const angularVelocityRadPerSec = { yaw: angular.yaw as number, pitch: angular.pitch as number };
  if (angularVelocityRadPerSec.yaw === 0 && angularVelocityRadPerSec.pitch === 0)
    fail(path + ".angularVelocityRadPerSec must be non-zero on at least one axis: without shake no slowest shutter follows.");
  const stabilizationStopsEquivalent = context.pick<unknown>(record, "stabilizationStopsEquivalent", path + ".stabilizationStopsEquivalent", 0,
    "No stabilization: the generic tiers declare none.");
  if (typeof stabilizationStopsEquivalent !== "number" || !Number.isFinite(stabilizationStopsEquivalent) || stabilizationStopsEquivalent < 0 || stabilizationStopsEquivalent > 10)
    fail(path + ".stabilizationStopsEquivalent must be a number of stops from 0 to 10.");
  let estimate;
  try {
    estimate = estimateAutoIsoSlowestShutter({ focalLengthMm: context.focalLengthMm, focusDistanceM: context.focusDistanceM, angularVelocityRadPerSec,
      stabilizationStopsEquivalent, blurBudget: { kind: "pixels", pixels: blurBudgetPixels, pixelPitchMicrometers: context.pitch }, fasterByStops,
      shutterCapability: context.shutter }).value;
  } catch (error) {
    fail(path + ": " + (error instanceof Error ? error.message : String(error)));
  }
  const report: SimulateCaptureAutomaticSlowestShutterReport = { derivedShutterSeconds: estimate.derivedShutterSeconds, fasterByStops,
    biasedShutterSeconds: estimate.biasedShutterSeconds, shutterSeconds: estimate.shutterSeconds, blurBudgetPixels, blurAtShutterPixels: estimate.blurAtShutterPixels!,
    angularVelocityRadPerSec, stabilizationStopsEquivalent };
  context.assume("exposure.autoIso.automaticSlowestShutter", "model", { ...report, angularVelocityRadPerSec: { ...angularVelocityRadPerSec },
    focalLengthMm: context.focalLengthMm, focusDistanceM: context.focusDistanceM, pixelPitchMicrometers: context.pitch },
    "Automatic slowest shutter (#504): the exposure time at which estimateCameraShakeBlur()'s on-axis blur (constant angular velocity, thin-lens projection at the focus " +
    "distance, stabilization as 2^-stops) equals the blur budget, times 2^-fasterByStops, held within the body's shutter range. An approximation; the 1/focal-length " +
    "reciprocal rule is a rule of thumb and is not used.");
  return report;
}
function defaultProgramLine(): ExposureProgramLineProfile {
  // Generic educational program line written for the engine, relative to the f/8, 1/125 s reference. For less light
  // it first opens the aperture toward f/4, then lengthens the shutter. For more light it first closes toward
  // f/16, then shortens the shutter.
  return parseExposureProgramLineProfile({ schemaVersion: "0.1.0", profileId: "facade-generic-program-line", profileVersion: "1.0.0",
    scientificStatus: "approximation", policyKind: "generic-program-line", interpolation: "log2-aperture-shutter", evidence: FACADE_EVIDENCE,
    limitations: ["Generic educational program line authored for the capture facade; not any manufacturer's program."],
    nodes: [
      { nodeId: "minus-6", opticalExposureStopsFromReference: -6, aperture: 16, shutterSeconds: 1 / 2000 },
      { nodeId: "minus-2", opticalExposureStopsFromReference: -2, aperture: 16, shutterSeconds: 1 / 125 },
      { nodeId: "zero", opticalExposureStopsFromReference: 0, aperture: 8, shutterSeconds: 1 / 125 },
      { nodeId: "plus-2", opticalExposureStopsFromReference: 2, aperture: 4, shutterSeconds: 1 / 125 },
      { nodeId: "plus-9", opticalExposureStopsFromReference: 9, aperture: 4, shutterSeconds: 128 / 125 }
    ] });
}

/** PNG colour signalling: the sRGB chunk for sRGB, ITU-T H.273 code points through cICP otherwise. */
function pngColourEncoding(encoding: SimulateCaptureColorEncoding): PngColourEncoding {
  if (encoding === "srgb") return { kind: "srgb", renderingIntent: "perceptual" };
  if (encoding === "display-p3") return { kind: "cicp", primaries: "display-p3", transfer: "srgb", fullRange: true };
  return { kind: "cicp", primaries: "bt2020", transfer: "bt709", fullRange: true };
}
/**
 * Develops the packed RAW to unclipped linear sRGB/D65, using the exact operator inside
 * `createNativeRawDevelopmentTask`. Validation, demosaic kernels, border handling, per-site white-level
 * clipping, white balance, highlight mode and the camera→XYZ→linear-sRGB matrices are all the same. It
 * stops before tone mapping, gamut clipping and quantization. It reads the RAW without taking ownership.
 */
async function developLinearSrgb(input: NativeRawDevelopmentInput, afterRow: (completed: number, total: number) => Promise<void>,
  ahd?: { yieldControl: () => Promise<void>; checkAbort: () => void; onDemosaicMs?: (milliseconds: number) => void }): Promise<{ rgb: Float64Array; highlight: RawHighlightDiagnostics }> {
  const v = prepareNativeRawDevelopment(input), plan = v.plan, raw = input.raw, layout = plan.frame.colorSamplingProfile.layout;
  if (layout.kind !== "periodic-mosaic") fail("Development requires a periodic CFA.");
  const native = plan.exposure.geometry.nativeRaster, g = plan.exposure.resolvedGeometry, active = g.activeCapture.nativeRect;
  checkNativeRawIntegrity(raw, native.pixelWidth, layout.repeatWidthSites, layout.repeatHeightSites, 0, native.pixelHeight);
  const developer = createRawPixelDeveloper({ nativeWidth: native.pixelWidth, repeatWidth: layout.repeatWidthSites, repeatHeight: layout.repeatHeightSites,
    codes: raw.codes, blackLevels: raw.blackLevels, saturationFlags: raw.saturationFlags, whiteByPhase: raw.effectiveSaturationCodes,
    ...(v.exposureGain === 1 ? {} : { exposureGain: v.exposureGain }) }, v.phases, v.development, v.mirror);
  const width = v.raster.pixelWidth, height = v.raster.pixelHeight, rgb = new Float64Array(width * height * 3), row = new Float64Array(width * 3);
  const at = (x: number, y: number): { x: number; y: number } => {
    const q = transformOrientedRasterPointToNative({ point: { x: v.crop.x + x + 0.5, y: v.crop.y + y + 0.5 }, nativeRaster: g.activeCapture.raster, orientation: plan.exposure.geometry.orientation });
    return { x: Math.floor(q.x) + active.x, y: Math.floor(q.y) + active.y };
  };
  if (ahd) return developAhd(v, raw, layout.repeatWidthSites, layout.repeatHeightSites, width, height, at, afterRow, ahd);
  for (let y = 0; y < height; y++) {
    const first = at(0, y), second = width > 1 ? at(1, y) : first;
    developer.developRun(first.x, first.y, second.x - first.x, second.y - first.y, width, row);
    rgb.set(row, y * width * 3);
    await afterRow(y + 1, height);
  }
  const c = developer.counts;
  return { rgb, highlight: { mode: v.highlightMode, saturatedPixelCount: c.saturatedPixelCount, whiteBalanceClippedSampleCount: c.whiteBalanceClippedSampleCount,
    reconstructedPixelCount: c.reconstructedPixelCount } };
}
/**
 * AHD development (2.1): the same site normalization as the native development kernel (flagged or white-level sites
 * are 1, others (code − black)/(white − black)) on the whole native raster, demosaiced by `createAhdDemosaicTask`
 * (mirrored plane edges), then the native development's own colour operator (`developInto`: WB, highlight mode,
 * camera → XYZ → linear sRGB) per output pixel. The AHD homogeneity metric sees white-balanced colour: its
 * camera → XYZ matrix is the profile's matrix times the WB gains (the output values are not transformed by it).
 * The mosaic is stored in float32, as the AHD task requires.
 */
async function developAhd(v: ReturnType<typeof prepareNativeRawDevelopment>, raw: NativeRawOutput, repeatWidth: number, repeatHeight: number, width: number, height: number,
  at: (x: number, y: number) => { x: number; y: number }, afterRow: (completed: number, total: number) => Promise<void>,
  host: { yieldControl: () => Promise<void>; checkAbort: () => void; onDemosaicMs?: (milliseconds: number) => void }): Promise<{ rgb: Float64Array; highlight: RawHighlightDiagnostics }> {
  const native = v.plan.exposure.geometry.nativeRaster, W = native.pixelWidth, H = native.pixelHeight;
  const source: RawDevelopmentSource = { nativeWidth: W, repeatWidth, repeatHeight, codes: raw.codes, blackLevels: raw.blackLevels,
    saturationFlags: raw.saturationFlags, whiteByPhase: raw.effectiveSaturationCodes, ...(v.exposureGain === 1 ? {} : { exposureGain: v.exposureGain }) };
  const samples = new Float32Array(W * H), saturated = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    samples[y * W + x] = normalizedRawSite(source, x, y);
    if (rawSiteSaturated(source, x, y)) saturated[y * W + x] = 1;
  }
  const intent = v.plan.exposure.whiteBalanceIntent, gains = intent ? [intent.channelGains.red, intent.channelGains.green, intent.channelGains.blue] : [1, 1, 1];
  const m = v.color.normalizedCameraChannelsToXyz;
  const cameraToXyz = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[r]![c]! * gains[c]!)) as unknown as ColorMatrix3x3;
  // A caller-raised pixel limit already bounds the raster, so its working memory is not capped again at the 1 GiB default.
  const task = createAhdDemosaicTask({ plane: { width: W, height: H, captureModeId: v.plan.frame.modeId, colorSamplingProfile: v.plan.frame.colorSamplingProfile, samples },
    channelRoles: { red: "red", green: "green", blue: "blue" }, cameraToXyz, ...(v.plan.maximumPixels === undefined ? {} : { maximumWorkingBytes: Number.MAX_SAFE_INTEGER }) }, { yieldControl: async () => { await host.yieldControl(); host.checkAbort(); } });
  const demosaicStarted = clockMs();
  await task.run();
  host.onDemosaicMs?.(clockMs() - demosaicStarted);
  const demosaiced = task.takeOutput().data, rgb = new Float64Array(width * height * 3);
  const counts = { saturatedPixelCount: 0, whiteBalanceClippedSampleCount: 0, reconstructedPixelCount: 0 };
  // #420: a pixel is clipped when a saturated site lies within AHD_VALUE_REACH of it, clipped to the raster. The sites within
  // that reach of each column are found once per row (`near`, a horizontal dilation of `saturated`), so a pixel reads one
  // column of 2·reach + 1 rows instead of the whole square; with no saturated site at all no pixel is clipped.
  let anySaturated = false;
  for (let k = 0; k < saturated.length && !anySaturated; k++) anySaturated = saturated[k] !== 0;
  const near = anySaturated ? new Uint8Array(W * H) : undefined;
  if (near) for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) if (saturated[row + x] !== 0) near.fill(1, row + Math.max(0, x - AHD_VALUE_REACH), row + Math.min(W, x + AHD_VALUE_REACH + 1));
  }
  for (let y = 0; y < height; y++) {
    // The oriented-to-native map is affine in x with whole-site steps (as the bilinear path's developRun uses): two points give the row.
    const first = at(0, y), second = width > 1 ? at(1, y) : first, stepX = second.x - first.x, stepY = second.y - first.y;
    for (let x = 0, px = first.x, py = first.y; x < width; x++, px += stepX, py += stepY) {
      const i = py * W + px;
      let clipped = false;
      if (near) for (let sy = Math.max(0, py - AHD_VALUE_REACH), last = Math.min(H - 1, py + AHD_VALUE_REACH); sy <= last; sy++) {
        if (near[sy * W + px] !== 0) { clipped = true; break; }
      }
      if (clipped) counts.saturatedPixelCount++;
      v.development.developInto(demosaiced[3 * i]!, demosaiced[3 * i + 1]!, demosaiced[3 * i + 2]!, rgb, (y * width + x) * 3, counts);
    }
    await afterRow(y + 1, height);
  }
  return { rgb, highlight: { mode: v.highlightMode, saturatedPixelCount: counts.saturatedPixelCount, whiteBalanceClippedSampleCount: counts.whiteBalanceClippedSampleCount,
    reconstructedPixelCount: counts.reconstructedPixelCount } };
}
/** Linear sRGB/D65 → CIE XYZ (inverse of the development's XYZ → sRGB matrix) → linear target RGB/D65. */
function linearSrgbToTarget(target: "srgb" | "display-p3" | "rec2020"): readonly (readonly number[])[] {
  return multiplyMatrices(resolveRgbColorSpace(target).value.xyzToRgb, resolveCaptureColorModel().cameraRgbToXyz as unknown as ColorMatrix3x3);
}
/** Knee of the `perceptual` gamut mapping: chroma below 90 % of the gamut-boundary chroma (at constant L*, h) is untouched. */
const PERCEPTUAL_GAMUT_KNEE_FRACTION = 0.9;
/**
 * SDR encoding from linear sRGB/D65:
 * 1. Convert to the target primaries with a matrix.
 * 2. Either clip each component to [0, 1], or, with `mapping`, compress chroma while keeping CIELAB hue
 *    and lightness (`prepareRgbGamutMapping`).
 * 3. Apply the target transfer function and round to the nearest code (ties round up).
 */
function encodeSdrFromLinear(rgb: Float64Array, encoding: "srgb" | "display-p3" | "rec2020", bitDepth: 8 | 16, mapping?: PreparedRgbGamutMapping):
  { samples: Uint8Array | Uint16Array; diagnostics: SdrRenderingResult["diagnostics"]; adjustedPixelCount: number; lightnessClippedPixelCount: number } {
  const m = linearSrgbToTarget(encoding), toXyz = resolveCaptureColorModel().cameraRgbToXyz, maximum = 2 ** bitDepth - 1;
  const transfer = encoding === "rec2020" ? evaluateBt709Oetf : evaluateSrgbEncoding;
  const samples = bitDepth === 8 ? new Uint8Array(rgb.length) : new Uint16Array(rgb.length);
  let low = 0, high = 0, adjusted = 0, lightnessClipped = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i]!, g = rgb[i + 1]!, b = rgb[i + 2]!;
    if (mapping) {
      const xyz = [0, 1, 2].map((k) => toXyz[k]![0]! * r + toXyz[k]![1]! * g + toXyz[k]![2]! * b) as unknown as ColorVector3;
      const mapped = mapping.map(xyz);
      if (mapped.adjusted) adjusted++;
      if (mapped.lightnessClipped) lightnessClipped++;
      for (let k = 0; k < 3; k++) samples[i + k] = Math.floor(transfer(mapped.linearRgb[k]!) * maximum + 0.5);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const row = m[k]!;
      let value = row[0]! * r + row[1]! * g + row[2]! * b;
      if (value < 0) { value = 0; low++; } else if (value > 1) { value = 1; high++; }
      samples[i + k] = Math.floor(transfer(value) * maximum + 0.5);
    }
  }
  return { samples, adjustedPixelCount: adjusted, lightnessClippedPixelCount: lightnessClipped, diagnostics: { renderingNegativeSampleCount: low,
    renderingAboveReferenceSampleCount: high, toneChangedSampleCount: 0, gamutClippedLowSampleCount: low, gamutClippedHighSampleCount: high, captureSaturation: "consumed-in-raw-development" } };
}

/**
 * Simulates one still capture of a planar scene and returns the developed image, the packed RAW, the full
 * underlying request/plan, provenance and every assumption made. See docs/QUICK_START.md.
 */
export async function simulateCapture(options: SimulateCaptureOptions): Promise<SimulateCaptureResult> {
  return await runCapture(options, "capture") as SimulateCaptureResult;
}

/** One part of a whole-frame DNG (#391): a region render's packed RAW and where its native sites lie (`result.raw`, `result.region`). */
export interface SimulateCaptureDngPart {
  raw: Pick<NativeRawOutput, "codes" | "blackLevels" | "digitalSaturationCodes" | "saturationFlags" | "effectiveSaturationCodes">;
  region: { nativeRect: { x: number; y: number; width: number; height: number } };
}

/**
 * Writes the whole-frame DNG of `options` (`output.format: "dng"`, no `output.region`) from the packed RAW of region renders of
 * the same request (#391), so the RAW can render in parallel. A region render's native sites are the same sites as the whole
 * render's (each site's seeds come from its index in the whole raster), so the joined RAW is the whole render's RAW, and the
 * request is resolved and written exactly as `simulateCapture` writes its DNG: the bytes are the same. The parts must cover
 * every native site of the frame; where they overlap (each region carries the demosaic margin) their sites must agree. Region
 * renders of the request with any format serve (a region's own `output.format` does not change its RAW). A region cannot take
 * `output.whiteBalance: "auto"` or `output.dng`: render the parts with a fixed white balance (the RAW codes do not depend on the
 * white-balance intent) and pass the DNG's own options here, where auto white balance is measured over the joined frame.
 * @returns The DNG (its `bytes` are those of `SimulateCaptureResult.image.dng` for the same options), with its stored levels and identifiers.
 */
export async function serializeSimulatedCaptureDngFromParts(options: SimulateCaptureOptions, parts: readonly SimulateCaptureDngPart[]): Promise<NativeRawDng> {
  return await runCapture(options, "dng-from-parts", parts) as NativeRawDng;
}

/** The whole frame's packed RAW from region parts (see `serializeSimulatedCaptureDngFromParts`). */
function joinNativeRawParts(value: unknown, plan: NativeRawOutput["plan"], width: number, height: number): NativeRawOutput {
  if (!Array.isArray(value) || value.length === 0) throw new InvalidConfigurationError("serializeSimulatedCaptureDngFromParts needs at least one part.");
  const parts = value as readonly SimulateCaptureDngPart[], count = width * height;
  const codes = new Uint16Array(count), blackLevels = new Uint16Array(count), digitalSaturationCodes = new Uint16Array(count), saturationFlags = new Uint8Array(count);
  const covered = new Uint8Array(count), white = new Uint16Array(4);
  const bad = (k: number, what: string): never => { throw new InvalidConfigurationError("DNG part " + k + ": " + what); };
  parts.forEach((part, k) => {
    const rect = part?.region?.nativeRect, raw = part?.raw;
    if (!rect || !raw) bad(k, "needs raw and region.nativeRect (a region render's result).");
    const { x, y, width: w, height: h } = rect!;
    if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) bad(k, "its nativeRect is not inside the frame's native raster.");
    const n = w * h;
    if (!(raw!.codes instanceof Uint16Array) || raw!.codes.length !== n || !(raw!.blackLevels instanceof Uint16Array) || raw!.blackLevels.length !== n ||
      !(raw!.digitalSaturationCodes instanceof Uint16Array) || raw!.digitalSaturationCodes.length !== n || !(raw!.saturationFlags instanceof Uint8Array) || raw!.saturationFlags.length !== n)
      bad(k, "its RAW arrays do not match its nativeRect.");
    const phases = raw!.effectiveSaturationCodes;
    if (!(phases instanceof Uint16Array) || phases.length !== 4) bad(k, "needs four per-phase white levels.");
    // Per-phase white levels are in the whole raster's CFA phases (0 for a phase the part has no site of); all parts agree.
    for (let phase = 0; phase < 4; phase++) {
      const code = phases[phase]!;
      if (code === 0) continue;
      if (white[phase] === 0) white[phase] = code; else if (white[phase] !== code) bad(k, "its white level differs from another part's: not the same request.");
    }
    for (let row = 0; row < h; row++) for (let column = 0; column < w; column++) {
      const from = row * w + column, to = (y + row) * width + x + column;
      if (covered[to]) {
        if (codes[to] !== raw!.codes[from] || blackLevels[to] !== raw!.blackLevels[from] || digitalSaturationCodes[to] !== raw!.digitalSaturationCodes[from] ||
          saturationFlags[to] !== raw!.saturationFlags[from]) bad(k, "a site differs from another part's at the same place: not the same request.");
        continue;
      }
      covered[to] = 1; codes[to] = raw!.codes[from]!; blackLevels[to] = raw!.blackLevels[from]!;
      digitalSaturationCodes[to] = raw!.digitalSaturationCodes[from]!; saturationFlags[to] = raw!.saturationFlags[from]!;
    }
  });
  if (covered.includes(0)) throw new InvalidConfigurationError("The DNG parts do not cover every native site of the frame.");
  if (white.includes(0)) throw new InvalidConfigurationError("The DNG parts lack a white level for a CFA phase.");
  return { plan, codes, blackLevels, digitalSaturationCodes, saturationFlags, effectiveSaturationCodes: white };
}

/**
 * The ideal reference of a capture request (2.3): the same scene, framing, chart size, output size, region and pixel
 * grid as `simulateCapture(options)` would use, rendered with no camera effects (no lens blur, diffraction, defocus,
 * distortion, vignetting, anti-aliasing filter, mosaic or demosaic, noise, dark signal or motion), at the capture's
 * own exposure and developed with its white balance, colour matrices, tone curve and encoding (the
 * `reference.exposure` assumption). Deterministic and cheap: no RAW is simulated. Formats srgb-8, srgb-16 and png.
 * The result is labelled `kind: "ideal-reference"`; it is not a capture.
 * @see docs/QUICK_START.md, "Ideal reference".
 */
export async function simulateIdealReference(options: SimulateCaptureOptions): Promise<IdealReferenceResult> {
  return await runCapture(options, "ideal-reference") as IdealReferenceResult;
}

/** Result of {@link simulateIdealReference}: an ideal reference image, not a capture (no RAW, plan or request). */
export interface IdealReferenceResult {
  kind: "ideal-reference";
  /** Human-readable label for a user interface. */
  label: string;
  facadeVersion: typeof SIMULATE_CAPTURE_FACADE_VERSION;
  engineApiVersion: string;
  image: { width: number; height: number; format: SimulateCaptureOutputFormat; samples: Uint8Array | Uint16Array; png?: Uint8Array; colorEncoding?: SimulateCaptureColorEncoding };
  /** The resolved exposure of the capture this reference matches. */
  exposure: { mode: SimulateCaptureExposureMode; settings: { fNumber: number; shutterSeconds: number; iso: number }; ev100: number;
    /** #516: as in the capture result. */
    isoControl: "manual" | "automatic"; autoIso?: SimulateCaptureAutoIsoReport };
  scene: SimulateCaptureResult["scene"];
  region?: { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number };
  diagnostics: { sampleCount: number; timingsMs: { reference: number; total: number } };
  provenance: { scientificStatus: "approximation"; cameraPresetId: string; cameraPresetVersion: string; evidence: readonly EvidenceProvenance[];
    composedContracts: readonly string[]; limitations: readonly string[] };
  /** The capture request's assumptions, then `reference.kind`, `reference.excludes`, `reference.exposure` and `reference.sampling`. */
  assumptions: readonly SimulateCaptureAssumption[];
}

/** Default stratified samples per axis of a display view (`view.samplesPerAxis`): 16 × 16 sampled real pixels per display pixel with detail, 4 × 4 where it is uniform. */
export const SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS = 16;
/** The display size and sampling of {@link simulateDisplayView}. */
export interface SimulateDisplayViewOptions {
  /** Display pixels, 1 to the capture's output width and height. */
  width: number;
  height: number;
  /** Stratified Monte Carlo samples per axis for each display pixel's expected value (1–32, default 16: 256 real pixels where the display pixel has detail). */
  samplesPerAxis?: number;
  /** "srgb-8" (default) or "srgb-16". */
  format?: "srgb-8" | "srgb-16";
  /** Render only this rectangle of the display view, in display pixels; byte-identical to the same pixels of the whole view. */
  region?: { x: number; y: number; width: number; height: number };
}
/** Result of {@link simulateDisplayView}: the full-resolution capture resized for display, estimated; not a capture. */
export interface DisplayViewResult {
  kind: "display-view";
  /** Human-readable label for a user interface. */
  label: string;
  facadeVersion: typeof SIMULATE_CAPTURE_FACADE_VERSION;
  engineApiVersion: string;
  /** The display view (or its region): interleaved sRGB samples, row by row from the top-left. */
  image: { width: number; height: number; format: "srgb-8" | "srgb-16"; samples: Uint8Array | Uint16Array };
  /**
   * The view: display size, the capture frame it shows (output pixels), real pixels per display pixel along each axis,
   * the samples per axis and, with `view.region`, the rendered rectangle.
   */
  view: { width: number; height: number; frameWidth: number; frameHeight: number; scaleX: number; scaleY: number; samplesPerAxis: number;
    region?: { x: number; y: number; width: number; height: number } };
  /**
   * The resolved exposure of the capture this view shows; `standardExposureDeviationStops`, `standardExposureIlluminanceLux`
   * and `greyCardDeviationStops` as in {@link SimulateCaptureResult}.
   */
  exposure: { mode: SimulateCaptureExposureMode; settings: { fNumber: number; shutterSeconds: number; iso: number }; ev100: number; standardExposureDeviationStops: number | null;
    /** As in the capture result. */
    standardExposureIlluminanceLux: number | null;
    /** 2.14: as in the capture result. */
    greyCardDeviationStops: number | null;
    /** 2.14: as in the capture result. */
    metering: SimulateCaptureMetering;
    /** #516: as in the capture result. */
    isoControl: "manual" | "automatic"; autoIso?: SimulateCaptureAutoIsoReport };
  scene: SimulateCaptureResult["scene"];
  /**
   * Work done: real pixels sampled, real-site expectations evaluated, scene queries, display pixels sampled in full (detail) or with
   * a quarter of the samples per axis (uniform), display pixels whose value includes the AHD low-signal correction, and wall-clock
   * milliseconds (diagnostic only; never affects the samples).
   */
  diagnostics: { sampleCount: number; siteEvaluations: number; sceneLookups: number; detailPixelCount: number; uniformPixelCount: number; ahdCorrectedPixelCount: number;
    timingsMs: { view: number; total: number };
    /** #395: exact or fast, as requested and as run; 2.11 (#481): plus `execution`, where the render ran (see {@link DisplayViewFastReport}). */
    fast: DisplayViewFastReport;
    /** #533: the saturated (clipped highlight) pixels of the real capture in the rendered region, as an expected value (see {@link DisplayViewHighlightDiagnostics}). */
    highlight: DisplayViewHighlightDiagnostics };
  provenance: { scientificStatus: "approximation"; cameraPresetId: string; cameraPresetVersion: string; evidence: readonly EvidenceProvenance[];
    composedContracts: readonly string[]; limitations: readonly string[] };
  /** The capture request's assumptions, then `view.definition`, `view.estimation`, `view.noise`, `view.demosaic` and `view.source`. */
  assumptions: readonly SimulateCaptureAssumption[];
}

/**
 * #533: the display view's highlight count. `simulateCapture` reports `diagnostics.highlight.saturatedPixelCount`, the
 * output pixels with at least one clipped contributing RAW site (a site flagged saturated or at the white level) counted on its
 * one noise sample (`sensor.noiseSeed`). The display view renders no RAW, so it reports that count's expected value over the
 * noise: Σ_j w_j·P_j over the real output pixels j of the rendered region, w_j the part of pixel j inside the region (1 inside,
 * a fraction at a region edge that cuts a real pixel) and P_j the probability, under the view's own site model (each site's
 * normalized value normal with its exact expected electrons, shot, dark, read and ADC noise, as the expected value uses), that at
 * least one site pixel j's demosaic reads is at or above the white level, the sites' noises independent. It is estimated as the
 * view's expected value is (`view.estimation`: exact over every real pixel, or the stratified samples), so it is not an integer.
 *
 * - Where every contributing site is far from white (more than 8.5 noise standard deviations either side) P_j is exactly 0 or 1,
 *   and the expected count equals the capture's count of the same pixels exactly (they then have no noise to differ by).
 * - Regions are additive: the counts of regions that tile the view sum to the whole view's count (up to floating-point summation
 *   order), each display pixel's share being the same in every region that renders it.
 * - With the bilinear demosaic the sites are the capture's own contributing sites. With AHD the capture counts every site within
 *   3 sites of the pixel (its interpolation reach, clipped to the raster); the view counts the 25–29 of those 49 that its AHD
 *   candidates read, so its count can be lower where a clipped area ends in a corner or a speck 2–3 sites away diagonally
 *   (an approximation; along a straight clipped edge the two agree).
 * - It never changes a sample of the view. On the GPU (`prepareDisplayView` with `gpu`) it is the CPU reference's value: the
 *   kernel decides P_j only where it is certainly 0 or 1 and the host computes every other pixel's share with the reference.
 */
export interface DisplayViewHighlightDiagnostics {
  /** Expected number of saturated real output pixels in the rendered region (a non-negative real number; see above). */
  saturatedPixelCount: number;
  /** The statistic: always "expected-value" (the capture's own count is one noise sample of it). */
  statistic: "expected-value";
}

/** Internal: the resolved request state that the display view's renderer (simulate-display-view.ts) reads. */
export interface DisplayViewRunContext {
  ahd: boolean;
  fastReport: SimulateCaptureFastReport;
  antiAliasing: ParsedAntiAliasing | undefined;
  aspect: number;
  assume: (id: string, kind: SimulateCaptureAssumption["kind"], value: unknown, explanation: string) => void;
  assumptions: SimulateCaptureAssumption[];
  axisChannelResponse: (caller: string) => { electronsPerRadiance: Record<Channel, Map<number, number>>; wavelengths: number[]; relativePerElectron: Record<Channel, number>; };
  boxSamples: number;
  buildProvider: (sceneIlluminant: ResolvedCaptureIlluminant, scale: number) => PlanarSceneRadianceProvider;
  callerScene: ResolvedCallerScene | undefined;
  chart: ResolvedChartScene | undefined;
  /** #491: the declared material-layers scene behind `callerScene`, when the request gave one. */
  materialLayers: ResolvedChartMaterialLayers | undefined;
  chartReport: { widthM: number; heightM: number; surroundReflectance: number; frameWidthFraction: number; frameHeightFraction: number; magnification: number; imageWidthMm: number; imageHeightMm: number; imageWidthPixels: number; imageHeightPixels: number; } | undefined;
  chartSize: { widthM: number; heightM: number; surroundReflectance: number; defaulted: ("heightM" | "surroundReflectance")[]; } | undefined;
  diffraction: DiffractionLimitedPsfProfile | undefined;
  /** `lens.defocus` (#492): the resolved geometric disc out of focus; undefined in focus or without the option. #553: with bokeh options, the shaped kernel. */
  defocus: (ResolvedDefocusDisc & { siteKernel?: DefocusDiscSiteKernel }) | undefined;
  /**
   * #563: with `lens.projection`, `lens.distortion`, `lens.vignetting` or camera rotation, the factory of the view's expected signal
   * through the lens (display-view-lens-signal.ts, loaded on demand); undefined without them (the rectilinear expected signal).
   */
  lens?: ((input: DisplayViewExpectedSignalInput, spanColumns?: number) => DisplayViewExpectedSignal) | undefined;
  /** #569: with `lens.catalogue`, the field-dependent PSF the lens signal reads (createDisplayViewLensPsf, display-view-lens-signal.ts); its axis kernels set the expected signal's lattice. */
  lensPsf?: DisplayViewLensPsf | undefined;
  diffractionPsf: { kind: "sampled-local"; configuration: Pick<CalculateSensorPsfIrradianceQuadratureInput, "psf" | "psfWavelengthBasis" | "spatialModel">; } | undefined;
  fNumber: number;
  focalLengthMm: number;
  focusDistanceM: number;
  height: number;
  highlightMode: RawHighlightMode;
  /** #556: the development exposure gain 2^output.exposureCompensationStops (1 without a push). */
  exposureGain: number;
  illuminanceLux: number;
  illuminant: ResolvedCaptureIlluminant;
  illuminantOption: CaptureIlluminant;
  imagingArea: { widthMm: number; heightMm: number; };
  intentOf: (state: ResolvedWhiteBalanceState | null) => CaptureWhiteBalanceIntent | null;
  metresPerFrameUnit: number;
  noiseSeed: number;
  outputOptions: Record<string, unknown>;
  parsedView: ParsedDisplayView | undefined;
  pitch: number;
  preset: GenericEquipmentTierPreset;
  provider: PlanarSceneRadianceProvider;
  regimeByChannel: Record<"red" | "green" | "blue", { readoutProfile: ReadoutProfile; regimeId: string; }>;
  resolvedIso: number;
  /** #516: how the ISO was chosen, reported in the view's `exposure`. */
  isoReport: { isoControl: "manual" | "automatic"; autoIso?: SimulateCaptureAutoIsoReport };
  /** #515: the capture's `exposure.standardExposureDeviationStops`. */
  standardExposureDeviationStops: number | null;
  /** The capture's `exposure.standardExposureIlluminanceLux`. */
  standardExposureIlluminanceLux: number | null;
  /** 2.14: the capture's `exposure.greyCardDeviationStops`. */
  greyCardDeviationStops: number | null;
  /** 2.14: the capture's `exposure.metering`. */
  metering: SimulateCaptureMetering;
  sceneOption: unknown;
  scenePreset: "composite" | "uniform" | "patches" | "slanted-edge" | "siemens-star" | "step-wedge" | "grey-ramp" | "checkerboard" | "point-grid" | "dead-leaves" | "bar-groups" | "hyperbolic-wedge" | "zone-plate" | "slanted-squares" | "line-grid" | "fiducial" | "color-patches" | "reflectance-function" | "radiance-function" | "material-function";
  shutterSeconds: number;
  started: number;
  subjectDistanceM: number;
  toneCurve: SdrToneCurve;
  whiteBalanceOption: SimulateCaptureWhiteBalance;
  whiteBalanceState: ResolvedWhiteBalanceState | null;
  width: number;
  checkAbort: () => void;
  margin: number;
  mode: SimulateCaptureExposureMode;
  nativeHeight: number;
  nativeWidth: number;
  sourceSha256: string;
  yieldControl: () => Promise<void>;
  /** The Kelvin white balance request, which the view resolves with the portable functions. */
  kelvinWhiteBalanceInput: Parameters<typeof resolveColorTemperatureWhiteBalance>[0] | undefined;
}
export interface ParsedDisplayView { width: number; height: number; samplesPerAxis: number; bitDepth: 8 | 16; format: "srgb-8" | "srgb-16"; region?: { x: number; y: number; width: number; height: number } }
/** Internal: validates a display view against the capture's output size and fills its defaults. */
export function parseDisplayViewOption(value: unknown, frameWidth: number, frameHeight: number): ParsedDisplayView {
  if (value === undefined) fail("simulateDisplayView needs a view, for example { width: 384, height: 256 }.");
  const v = allowKeys(value, "view", ["width", "height", "samplesPerAxis", "format", "region"]);
  const width = integerIn(v.width, "view.width", 1, frameWidth), height = integerIn(v.height, "view.height", 1, frameHeight);
  const samplesPerAxis = v.samplesPerAxis === undefined ? SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS : integerIn(v.samplesPerAxis, "view.samplesPerAxis", 1, 32);
  const format = v.format === undefined ? "srgb-8" : v.format;
  if (format !== "srgb-8" && format !== "srgb-16") fail("view.format must be srgb-8 or srgb-16.");
  let region: ParsedDisplayView["region"];
  if (v.region !== undefined) {
    const r = allowKeys(v.region, "view.region", ["x", "y", "width", "height"]);
    const x = integerIn(r.x, "view.region.x", 0, width - 1), y = integerIn(r.y, "view.region.y", 0, height - 1);
    region = { x, y, width: integerIn(r.width, "view.region.width", 1, width - x), height: integerIn(r.height, "view.region.height", 1, height - y) };
  }
  return { width, height, samplesPerAxis, bitDepth: format === "srgb-8" ? 8 : 16, format: format as "srgb-8" | "srgb-16", ...(region ? { region } : {}) };
}

/**
 * `lens.defocus` (#492): resolves the geometric defocus disc at the resolved f-number on the site pitch and records it.
 * In focus (c = 0) no kernel exists and nothing else changes (undefined). The capture (step 2a) applies the disc as an
 * object-space convolution and the display view (step 2b) as a site kernel in its expected-signal tables, and both get it
 * back; the ideal reference, which has no camera effects, only records it.
 */
function resolveDefocusOption(input: { run: "capture" | "ideal-reference" | "display-view" | "dng-from-parts"; assume: DisplayViewRunContext["assume"];
  focalLengthMm: number; fNumber: number; focusDistanceM: number; subjectDistanceM: number; pitch: number; diffraction: boolean;
  imageSpace?: (disc: ResolvedDefocusDisc) => { options: readonly string[]; fieldVariation: DefocusFieldVariation };
  /** #553: the bokeh options as given, and (out of focus, where the kernel is applied) the shaped kernel's record and explanation. */
  bokehOptions?: ResolvedDefocusBokehOptions; bokeh?: (disc: ResolvedDefocusDisc) => { value: Record<string, unknown>; explanation: string } }): ResolvedDefocusDisc | undefined {
  const { run, assume, focalLengthMm, fNumber, focusDistanceM, subjectDistanceM, pitch } = input;
  const disc = resolveDefocusDisc({ focalLengthMm, aperture: fNumber, focusDistanceM, subjectDistanceM, pitchMicrometers: pitch });
  let radius: number;
  try { radius = requireDefocusDiscKernelRadius(disc.diameterSites); } catch { fail("lens.defocus: " + defocusDiscLimitMessage(disc.diameterSites, disc.diameterMicrometers)); }
  let value: Record<string, unknown> = { model: "geometric-disc", scientificStatus: "approximation", diameterMicrometers: disc.diameterMicrometers, diameterSites: disc.diameterSites,
    kernelRadiusSites: disc.diameterSites === 0 ? null : radius, fNumber, focusDistanceM, subjectDistanceM, samplePitchMicrometers: pitch,
    defocusCircleModel: { id: "thin-lens-defocus-circle", version: "1.1.0" } };
  let model = "Geometric defocus of the flat scene plane (an approximation): the thin-lens blur circle of an ideal uniform circular pupil, " +
    "c = f²·|s − d| / (N·d·(s − f)) (calculateDefocusCircle 1.1.0), as a uniform disc sampled on the site lattice (exact disc area in each site's cell). " +
    "No diffraction of the defocused wave, aberrations or pupil vignetting. ";
  // #553: the bokeh options. Out of focus, where a kernel is applied, the shaped kernel replaces the disc and its record joins the value.
  let kernelRadius = radius;
  if (input.bokehOptions) {
    value = { ...value, bokeh: { options: input.bokehOptions } };
    if (disc.diameterSites > 0 && run !== "ideal-reference" && input.bokeh) {
      const shaped = input.bokeh(disc);
      value = { ...value, bokeh: shaped.value };
      model += shaped.explanation;
      kernelRadius = shaped.value.kernelRadiusSites as number;
    }
  }
  // #564: above the direct radius the kernel (the disc, or the shaped kernel of #553) is convolved by runs; the field is absent below it,
  // so those records are unchanged.
  if (kernelRadius > DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES) {
    value = { ...value, convolution: "runs" };
    model += "The kernel radius is above 64 sites, so the kernel is convolved by runs (#564): each kernel row's run of equal weights is a difference of two prefix sums, " +
      "the other cells (the edge) are read one by one, and with lens.diffraction each node's diffraction kernel is applied after the defocus kernel. " +
      "That is the same sum as the direct convolution, regrouped (exact up to rounding, not an approximation). ";
  }
  if (disc.diameterSites === 0) {
    assume("lens.defocus", "model", value, model + "In focus (lens.focusDistanceM equals subjectDistanceM): the disc has zero diameter, so no defocus kernel is applied.");
    return undefined;
  }
  if (run === "ideal-reference") {
    assume("lens.defocus", "model", value, model + "Resolved but not applied: the ideal reference has no camera effects.");
    return undefined;
  }
  // The display view (#492, step 2b): a site kernel in its expected-signal tables (simulate-display-view.ts); with a lens field mapping,
  // vignetting or rotation (#563) applied in image space as in the capture, so it records the capture's assumption below.
  if (run === "display-view" && !input.imageSpace) {
    assume("lens.defocus", "model", { ...value, execution: "expected-signal-site-kernel", combinedWithDiffraction: input.diffraction }, model +
      "Applied in the display view's expected-signal tables as a site kernel on the lattice" + (input.diffraction ? " (with lens.diffraction, each spectral node's " +
      "diffraction kernel convolved with the disc, a further approximation)" : "") + "; see the view.defocus assumption.");
    return disc;
  }
  // #548: with a lens field mapping, vignetting or camera rotation the capture applies the disc in image space, on the sensor's site lattice.
  if (input.imageSpace) {
    const { options, fieldVariation } = input.imageSpace(disc), v = fieldVariation, bounds: string[] = [];
    if (v.rotationMaximumDiameterChangeSites !== null) bounds.push("camera rotation: pitch or yaw tilts the scene plane in the rotated camera, so the disc of a scene point's " +
      "axial depth there differs from the disc used by at most " + formatBound(v.rotationMaximumDiameterChangeSites) + " sites over the rendered instants (0 for roll alone)");
    if (v.distortionMaximumLocalScaleDeviation !== null) bounds.push("distortion: its local scale departs from 1 by at most " + formatBound(v.distortionMaximumLocalScaleDeviation) +
      " (fraction), the relative disc-size difference to a model that blurs the undistorted image and then distorts it");
    if (v.projectionMaximumDiameterChangeSites !== null) bounds.push("non-rectilinear projection: the disc of the distance along each scene point's ray, instead of its axial depth, " +
      "differs by at most " + formatBound(v.projectionMaximumDiameterChangeSites) + " sites (a real lens of that projection may lie anywhere between the two)");
    assume("lens.defocus", "model", { ...value, execution: "image-space-convolution", combinedWithDiffraction: input.diffraction, imageSpaceOptions: [...options],
      fieldVariation: { ...fieldVariation } }, model +
      "Applied as an image-space convolution (#548, with " + options.join(", ") + "): for each spectral node (and, with camera rotation, each temporal midpoint, in that instant's camera frame) " +
      "the sensor-plane irradiance before any PSF, through the lens field mapping and the field throughput, is formed on the site lattice of the sensor and convolved with the disc, " +
      "the disc of the same diameter at every field point, centred on each point's chief ray. This is the environment PSF quadrature with the disc as a sampled PSF, summed in another order " +
      "(a test checks it to 1e-12 per site). Vignetting is applied at each scene point before the disc spreads its light (field throughput, as for any PSF); the disc does not take the " +
      "cat's-eye shape of mechanical vignetting. " + (input.diffraction ? "With lens.diffraction, each spectral node's diffraction kernel is convolved with the disc and applied as one " +
      "image-space kernel, a further approximation (the defocused wave PSF is not exactly the Airy pattern convolved with the disc). " : "") +
      (bounds.length > 0 ? "Field-variation bounds of the constant disc, on a " + v.gridPointsPerSide + " × " + v.gridPointsPerSide + " grid over the frame: " + bounds.join("; ") + ". " : "") +
      "The disc kernel is a sampling of the disc on the site lattice, as on the object-space path.");
    return disc;
  }
  // The capture (#492, step 2a): an object-space convolution of the scene radiance on the site lattice.
  assume("lens.defocus", "model", { ...value, execution: "object-space-convolution", combinedWithDiffraction: input.diffraction }, model +
    "Applied as an object-space convolution: the scene radiance on the site lattice is convolved with the disc, the same kernel at every spectral node, " +
    "and each site query is answered with the result (for a flat scene and a still, distortion-free rectilinear camera every disc point a site sees is the scene point of another site). " +
    (input.diffraction ? "With lens.diffraction, each spectral node's diffraction kernel is convolved with the disc and applied as one kernel. That is a further approximation: " +
      "the defocused wave PSF of a circular pupil is not exactly the in-focus Airy pattern convolved with the geometric disc. " : "") +
    "The disc kernel is a sampling of the disc on the site lattice; lens.pupilSampling (ray-sampled, no diffraction) is the independent reference.");
  return disc;
}

/** A field-variation bound for an explanation: 3 significant digits (the assumption value keeps the full number). */
function formatBound(value: number): string {
  return value === 0 ? "0" : String(Number(value.toPrecision(3)));
}

/** Internal: passed as the view of a "display-view" run to resolve the request without a view (`prepareDisplayView`, #387). */
export const DISPLAY_VIEW_WITHOUT_VIEW: unique symbol = Symbol("display view without view");
/**
 * Internal: the request path shared by {@link simulateCapture}, {@link simulateIdealReference} and the display view, whose renderer is
 * passed in; for a display view the renderer's value is returned (a result, or a prepared view with DISPLAY_VIEW_WITHOUT_VIEW).
 */
export async function runCapture(options: SimulateCaptureOptions, run: "capture" | "ideal-reference" | "display-view" | "dng-from-parts", viewOption?: unknown,
  renderView?: (context: DisplayViewRunContext) => Promise<unknown>):
  Promise<unknown> {
  const started = Date.now(), idealReference = run === "ideal-reference", displayView = run === "display-view";
  requireInputObject(options, "simulateCapture options");
  const top = allowKeys(options, "simulateCapture options", ["camera", "lens", "exposure", "scene", "subjectDistanceM", "chartSize", "illuminant",
    "illuminanceLux", "output", "sensor", "motion", "fast", "signal", "onProgress"]);
  const signal = top.signal as AbortSignal | undefined, onProgress = top.onProgress as SimulateCaptureOptions["onProgress"];
  if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof (signal as AbortSignal).aborted !== "boolean")) fail("signal must be an AbortSignal.");
  if (onProgress !== undefined && typeof onProgress !== "function") fail("onProgress must be a function.");
  const assumptions: SimulateCaptureAssumption[] = [];
  const assume = (id: string, kind: SimulateCaptureAssumption["kind"], value: unknown, explanation: string): void => { assumptions.push({ id, kind, value, explanation }); };
  function pick<T>(record: Record<string, unknown>, key: string, path: string, fallback: T, explanation: string): T {
    if (record[key] !== undefined) return record[key] as T;
    assume(path, "default", fallback, explanation);
    return fallback;
  }
  const checkAbort = (): void => { if (signal?.aborted) fail("simulateCapture aborted."); };
  checkAbort();

  // Camera
  const cameraOption = pick<GenericEquipmentTier | GenericEquipmentTierPreset>(top, "camera", "camera", DEFAULTS.camera,
    "Generic Photivra tier preset 2.0.0 (synthetic educational values, not a real camera).");
  let preset: GenericEquipmentTierPreset;
  if (typeof cameraOption === "string") preset = GENERIC_TIER_ASSETS.find((p) => p.tier === cameraOption) ?? fail("Unknown camera tier.");
  else preset = parseCallerCameraPreset(cameraOption);
  const body = preset.body, lens = preset.lens;

  // Lens
  const lensOptions = allowKeys(top.lens, "lens", ["focalLengthMm", "fNumber", "focusDistanceM", "pupilSampling", "projection", "distortion", "vignetting", "psf", "diffraction", "prime", "defocus",
    "catalogue", "focusScatter", "ideal"]);
  // Generic prime (2.3): resolved on the simulated frame's size, which the output and sensor sections validate again below.
  let prime: GenericPrimeLens | undefined;
  // The simulated frame in mm (output width × height × pixel pitch), validated again below.
  const frameMm = (): { widthMm: number; heightMm: number } => {
    const o = (typeof top.output === "object" && top.output !== null ? top.output : {}) as Record<string, unknown>, sn = (typeof top.sensor === "object" && top.sensor !== null ? top.sensor : {}) as Record<string, unknown>;
    const frameW = positive(o.width ?? DEFAULTS.width, "output.width"), frameH = positive(o.height ?? DEFAULTS.height, "output.height"), framePitch = positive(sn.pixelPitchMicrometers ?? DEFAULTS.pixelPitchMicrometers, "sensor.pixelPitchMicrometers");
    return { widthMm: frameW * framePitch / 1000, heightMm: frameH * framePitch / 1000 };
  };
  if (lensOptions.prime !== undefined) {
    if (lensOptions.focalLengthMm !== undefined) fail("lens.prime and lens.focalLengthMm cannot both be given: the prime sets the focal length.");
    const activeImagingArea = frameMm();
    if (typeof lensOptions.prime !== "number") fail("lens.prime must be a generic prime's full-frame-equivalent focal length in mm.");
    prime = resolveGenericPrimeLens({ equivalentFocalLengthMm: lensOptions.prime as number, activeImagingArea });
    assume("lens.prime", "model", { lensId: prime.lensId, equivalentFocalLengthMm: prime.equivalentFocalLengthMm, focalLengthMm: prime.focalLengthMm, cropFactor35Mm: prime.cropFactor35Mm,
      widestFNumber: prime.widestFNumber, narrowestFNumber: prime.narrowestFNumber, minimumFocusDistanceM: prime.minimumFocusDistanceM },
    "Generic prime (not a real product): focal length = equivalent ÷ the simulated frame's diagonal crop factor, f/" + prime.widestFNumber + "–f/" + prime.narrowestFNumber +
      ", minimum focus max(0.10 m, f·(1 + 1/0.15)) (thin-lens approximation). It replaces the tier lens's focal length and f-number range; the tier lens's transmission is kept.");
  }
  // Ideal lens (#576): a physical focal length on any frame, every f-number within IDEAL_LENS_LIMITS.
  let ideal: { id: string; name: string; focalLengthMm: number; widestFNumber: number; narrowestFNumber: number } | undefined;
  if (lensOptions.ideal !== undefined) {
    for (const key of ["prime", "catalogue", "focalLengthMm"]) if (lensOptions[key] !== undefined) fail("lens.ideal cannot be combined with lens." + key + ".");
    const f = allowKeys(lensOptions.ideal, "lens.ideal", ["focalLengthMm"]).focalLengthMm, { focalLengthMm: b, fNumber: n } = IDEAL_LENS_LIMITS;
    if (!(typeof f === "number" && f >= b.minimum && f <= b.maximum)) fail("lens.ideal.focalLengthMm must be " + b.minimum + "–" + b.maximum + " mm (IDEAL_LENS_LIMITS).");
    const lensId = "ideal-" + f + "mm";
    ideal = { id: lensId, name: lensId, focalLengthMm: f as number, widestFNumber: n.minimum, narrowestFNumber: n.maximum };
    assume("lens.ideal", "model", { lensId, focalLengthMm: f }, "Ideal thin lens without aberrations (not a real product) at this physical focal length; the tier lens's transmission is kept.");
  }
  // Generic lens catalogue (#549): resolved on the simulated frame like the prime; its character is built once the f-number is known.
  let catalogue: ResolvedGenericLens | undefined, catalogueFrame: { widthMm: number; heightMm: number } | undefined;
  let lensKit: typeof import("./generic-lens-capture.js") | undefined;
  if (lensOptions.catalogue !== undefined) {
    for (const key of ["prime", "focalLengthMm", "projection", "distortion", "vignetting", "psf", "diffraction", "pupilSampling"])
      if (lensOptions[key] !== undefined) fail("lens.catalogue cannot be combined with lens." + key + ": the catalogue lens sets its own focal length, projection, distortion, vignetting and PSF (with diffraction).");
    catalogueFrame = frameMm();
    lensKit = await import("./generic-lens-capture.js");
    catalogue = lensKit.resolveGenericLens({ lensId: lensOptions.catalogue as string, activeImagingArea: catalogueFrame });
    assume("lens.catalogue", "model", { lensId: catalogue.lensId, name: catalogue.name, set: catalogue.set, kind: catalogue.kind, equivalentFocalLengthMm: catalogue.equivalentFocalLengthMm,
      focalLengthMm: catalogue.focalLengthMm, cropFactor35Mm: catalogue.cropFactor35Mm, widestFNumber: catalogue.widestFNumber, narrowestFNumber: catalogue.narrowestFNumber,
      minimumFocusDistanceM: catalogue.minimumFocusDistanceM, maximumMagnification: catalogue.maximumMagnification, projection: catalogue.projection, fisheyeImage: catalogue.fisheyeImage },
    "Generic catalogue lens " + catalogue.name + " (#549; Photivra's own design, not a real product): focal length = equivalent ÷ the simulated frame's diagonal crop factor, f/" +
      catalogue.widestFNumber + "–f/" + catalogue.narrowestFNumber + ", minimum focus max(0.10 m, f·(1 + 1/" + catalogue.maximumMagnification + ")) (thin lens). Its character is a labelled " +
      "approximation (the lens.catalogue.character assumption). It replaces the tier lens's focal length and f-number range; the tier lens's transmission is kept.");
  } else if (lensOptions.focusScatter !== undefined) fail("lens.focusScatter needs lens.catalogue: the focus scatter is a catalogue lens's own.");
  const lensRange = prime ? { id: prime.lensId, name: prime.lensId, focalLengthMm: prime.focalLengthMm, widestFNumber: prime.widestFNumber, narrowestFNumber: prime.narrowestFNumber } :
    catalogue ? { id: catalogue.lensId, name: catalogue.name, focalLengthMm: catalogue.focalLengthMm, widestFNumber: catalogue.widestFNumber, narrowestFNumber: catalogue.narrowestFNumber } : ideal;
  const lensExposure = lensRange ? { ...lens.exposure, profileId: "photivra-" + lensRange.id + ":exposure",
    focalLengthMmRange: { ...lens.exposure.focalLengthMmRange, value: { minimum: lensRange.focalLengthMm, maximum: lensRange.focalLengthMm } },
    aperture: { ...lens.exposure.aperture, widestAvailableFNumber: { kind: "constant" as const, fNumber: { value: lensRange.widestFNumber, evidence: FACADE_EVIDENCE } },
      narrowestAvailableFNumber: { value: lensRange.narrowestFNumber, evidence: FACADE_EVIDENCE } } } as typeof lens.exposure : lens.exposure;
  const focalDefault = lensExposure.focalLengthMmRange.value.minimum;
  const focalLengthMm = lensRange ? lensRange.focalLengthMm :
    positive(pick(lensOptions, "focalLengthMm", "lens.focalLengthMm", focalDefault, "The preset lens's focal length (the generic primes are 50 mm)."), "lens.focalLengthMm");
  const capabilities = resolveGenericEquipmentExposureCapabilities({ bodyProfile: body.exposure, lensProfile: lensExposure, selectedFocalLengthMm: focalLengthMm });
  const subjectDistanceM = positive(pick(top, "subjectDistanceM", "subjectDistanceM", DEFAULTS.subjectDistanceM, "Scene plane 5 m in front of the camera (the generic tiers' reference focus distance)."), "subjectDistanceM");
  // #569: twice the focal length itself is admitted (magnification 1, the catalogue Macro's close focus f·(1 + 1/1)).
  if (subjectDistanceM * 1000 < focalLengthMm * 2) fail("subjectDistanceM must be at least twice the focal length.");
  let focusDistanceM = positive(pick(lensOptions, "focusDistanceM", "lens.focusDistanceM", subjectDistanceM, "Focused on the scene plane."), "lens.focusDistanceM");
  if (focusDistanceM * 1000 <= focalLengthMm) fail("lens.focusDistanceM must exceed the focal length.");
  if (prime && (subjectDistanceM < prime.minimumFocusDistanceM || focusDistanceM < prime.minimumFocusDistanceM))
    fail("The " + prime.lensId + " focuses no closer than " + prime.minimumFocusDistanceM + " m (max(0.10 m, f·(1 + 1/0.15))); subjectDistanceM and lens.focusDistanceM must be at least that.");
  if (catalogue && (subjectDistanceM < catalogue.minimumFocusDistanceM || focusDistanceM < catalogue.minimumFocusDistanceM))
    fail("The " + catalogue.name + " focuses no closer than " + catalogue.minimumFocusDistanceM + " m (max(0.10 m, f·(1 + 1/" + catalogue.maximumMagnification +
      "))); subjectDistanceM and lens.focusDistanceM must be at least that.");
  let pupil: { radialSamples: number; angularSamples: number } | undefined;
  if (lensOptions.pupilSampling === undefined) assume("lens.pupilSampling", "default", null, lensOptions.defocus === undefined ?
    "No pupil sampling: each scene query follows the central (chief) ray, so defocus and depth of field are not rendered. Enable lens.pupilSampling for an ideal circular pupil." :
    "No pupil sampling: each scene query follows the central (chief) ray; defocus of the scene plane is the lens.defocus option's (see the lens.defocus assumption).");
  else {
    const p = allowKeys(lensOptions.pupilSampling, "lens.pupilSampling", ["radialSamples", "angularSamples"]);
    // The environment pupil contract admits 4..64 azimuthal midpoints and at most 256 rays.
    pupil = { radialSamples: integerIn(p.radialSamples, "lens.pupilSampling.radialSamples", 1, 16), angularSamples: integerIn(p.angularSamples, "lens.pupilSampling.angularSamples", 4, 64) };
    if (pupil.radialSamples * pupil.angularSamples > 256) fail("lens.pupilSampling needs at most 256 rays (radialSamples × angularSamples).");
  }
  // 2.0 optics hooks: only what the environment site contract accepts.
  const projection: LensProjectionModel | undefined = lensOptions.projection === undefined ? (catalogue && catalogue.projection !== "rectilinear" ? catalogue.projection : undefined) :
    parseLensProjectionModel(lensOptions.projection);
  let distortion: SimulateCaptureLensDistortion | undefined;
  if (lensOptions.distortion !== undefined) {
    const d = allowKeys(lensOptions.distortion, "lens.distortion", ["kind", "profile"]);
    if (d.kind !== "radial" && d.kind !== "brown-conrady") fail("lens.distortion.kind must be radial or brown-conrady.");
    distortion = d as unknown as SimulateCaptureLensDistortion;
  }
  // #549: a catalogue lens's distortion (and the fisheyes' projection) is set once its field reach is known (below); the mapping
  // stands in for it in the combination checks until then.
  if (catalogue) distortion = { kind: "radial", profile: lensKit!.genericLensDistortionProfile(catalogue.character.distortion.corner, catalogue.halfDiagonalMm) };
  let lensFieldMapping: EnvironmentLensFieldMapping | undefined = projection === undefined && distortion === undefined ? undefined :
    { projectionModel: projection ?? "rectilinear", distortion: distortion ?? { kind: "none" }, radiometricAreaCorrection: "inverse-distortion-jacobian" };
  if (lensFieldMapping) {
    if (pupil) fail("lens.projection and lens.distortion cannot be combined with lens.pupilSampling: ideal pupil rays use the rectilinear, distortion-free projection.");
    try { prepareEnvironmentLensFieldMapping(lensFieldMapping); } catch (error) { fail("Invalid lens projection or distortion: " + (error as Error).message); }
  }
  let vignetting: IlluminationVignettingProfile | undefined;
  if (lensOptions.vignetting !== undefined) { requireInputObject(lensOptions.vignetting, "lens.vignetting"); vignetting = lensOptions.vignetting as IlluminationVignettingProfile; }
  let lensPsf: NonNullable<NonNullable<SimulateCaptureOptions["lens"]>["psf"]> | undefined;
  if (lensOptions.psf !== undefined) {
    const p = allowKeys(lensOptions.psf, "lens.psf", ["kind", "configuration"]);
    if (p.kind !== "sampled-local") fail("lens.psf.kind must be sampled-local.");
    requireInputObject(p.configuration, "lens.psf.configuration");
    if (pupil) fail("lens.psf cannot be combined with lens.pupilSampling: geometric defocus would be counted twice.");
    lensPsf = p as unknown as typeof lensPsf;
  }
  // Diffraction (2.1): validated here, built once the f-number is resolved.
  let diffractionRadiusOption: number | null | undefined, diffractionFast: boolean | undefined;
  if (lensOptions.diffraction !== undefined) {
    const d = lensOptions.diffraction;
    if (d === "circular-aperture") diffractionRadiusOption = null;
    else {
      const record = allowKeys(d, "lens.diffraction", ["kind", "aperture", "kernelRadiusSamples", "fast"]);
      // #395: the record names the model by `kind`; `aperture` is its deprecated alias (until 3.0.0).
      if (record.kind !== undefined && record.aperture !== undefined) fail("lens.diffraction takes kind or its deprecated alias aperture, not both.");
      const model = record.kind !== undefined ? record.kind : record.aperture;
      if (model !== "circular-aperture") fail("lens.diffraction must be \"circular-aperture\" or { kind: \"circular-aperture\", kernelRadiusSamples, fast }.");
      diffractionRadiusOption = record.kernelRadiusSamples === undefined ? null : integerIn(record.kernelRadiusSamples, "lens.diffraction.kernelRadiusSamples", 0, 32);
      diffractionFast = fastOverride(record, "lens.diffraction");
    }
    if (lensPsf) fail("lens.diffraction cannot be combined with lens.psf: diffraction would be counted twice.");
    if (pupil) fail("lens.diffraction cannot be combined with lens.pupilSampling: the environment contract does not mix a sampled PSF with pupil rays.");
  }
  // Defocus (#492): validated here, resolved once the f-number is.
  let defocusModel: "geometric-disc" | undefined, defocusBokeh: ResolvedDefocusBokehOptions | undefined;
  if (lensOptions.defocus !== undefined) {
    const record = allowKeys(lensOptions.defocus, "lens.defocus", ["model", "blades", "sphericalAberration", "catsEye"]);
    if (record.model !== "geometric-disc") fail("lens.defocus.model must be \"geometric-disc\".");
    // #553: the bokeh options; none given keeps the disc of #492 (byte-identical requests).
    if (record.blades !== undefined || record.sphericalAberration !== undefined || record.catsEye !== undefined) {
      const bokeh: Record<string, unknown> = { ...record };
      delete bokeh.model;
      try { defocusBokeh = resolveDefocusBokehOptions(bokeh, "lens.defocus"); } catch (error) { fail((error as Error).message); }
      if (defocusBokeh.catsEye && diffractionRadiusOption !== undefined) fail("lens.defocus.catsEye cannot be combined with lens.diffraction: the cat's eye varies over the field, " +
        "so each field zone would need its own diffraction kernel convolved with its clipped pupil at every spectral node. Omit one of the options.");
    }
    if (pupil) fail("lens.defocus cannot be combined with lens.pupilSampling: the pupil rays already render defocus, so it would be counted twice.");
    if (lensPsf) fail("lens.defocus cannot be combined with lens.psf: a caller PSF declares its own defocus, so it could be counted twice.");
    // #549: with a catalogue lens the disc is convolved into the lens's PSF (below), not applied by the lens.defocus paths. The bokeh
    // options (#553) shape the lens.defocus kernel only, so they are refused rather than dropped (a follow-up for a later release).
    if (catalogue && defocusBokeh) fail("lens.defocus.blades, sphericalAberration and catsEye cannot be combined with lens.catalogue: the catalogue lens " +
      "folds a plain disc into its own PSF. Omit the bokeh options, or use lens.focalLengthMm instead of the catalogue lens.");
    if (!catalogue) defocusModel = "geometric-disc";
  }

  // Motion (2.0): constant camera rotation and the shutter type.
  const motionOptions = allowKeys(top.motion, "motion", ["angularVelocityRadPerSec", "shutter", "rollingShutterSkewSeconds"]);
  const angular = { pitch: 0, yaw: 0, roll: 0 };
  if (motionOptions.angularVelocityRadPerSec !== undefined) {
    const a = allowKeys(motionOptions.angularVelocityRadPerSec, "motion.angularVelocityRadPerSec", ["pitch", "yaw", "roll"]);
    for (const axis of ["pitch", "yaw", "roll"] as const) if (a[axis] !== undefined) {
      const value = a[axis];
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100) fail("motion.angularVelocityRadPerSec." + axis + " must be a finite number within ±100 rad/s.");
      angular[axis] = value as number;
    }
  }
  const rotating = angular.pitch !== 0 || angular.yaw !== 0 || angular.roll !== 0;
  const shutterKind = motionOptions.shutter === undefined ? "global" : motionOptions.shutter;
  if (shutterKind !== "global" && shutterKind !== "rolling") fail("motion.shutter must be global or rolling.");
  if (motionOptions.rollingShutterSkewSeconds !== undefined && shutterKind !== "rolling") fail("motion.rollingShutterSkewSeconds needs motion.shutter \"rolling\".");
  const rollingSkewOption = motionOptions.rollingShutterSkewSeconds === undefined ? undefined : positive(motionOptions.rollingShutterSkewSeconds, "motion.rollingShutterSkewSeconds");
  // Diffraction runs as an object-space convolution when every PSF tap's source is another site centre seen
  // through one linear map (still camera, rectilinear, no distortion or field throughput); otherwise per tap.
  const diffractionObjectSpace = diffractionRadiusOption !== undefined && !rotating && !lensFieldMapping && !vignetting;

  // Output and sensor
  const outputOptions = allowKeys(top.output, "output", ["width", "height", "format", "toneCurve", "toneCurveParameters", "highlightMode", "exposureCompensationStops", "whiteBalance", "jpegQuantizationStep",
    "colorEncoding", "bitDepth", "gamutMapping", "demosaic", "borderHandling", "dng", "maximumPixels", "region", "metadata", "diffractionCorrection", "sharpening"]);
  // Opt-in large images: a caller-raised native pixel limit. Without it the 4094-pixel sides are unchanged.
  const raisedPixels = outputOptions.maximumPixels === undefined ? undefined : integerIn(outputOptions.maximumPixels, "output.maximumPixels", 1, NATIVE_RAW_LIMITS.ceilingPixels);
  const maximumSide = raisedPixels === undefined ? 4094 : NATIVE_RAW_LIMITS.maximumDimension;
  const width = integerIn(pick(outputOptions, "width", "output.width", DEFAULTS.width, "64 × 64 output pixels."), "output.width", 1, maximumSide);
  const height = integerIn(pick(outputOptions, "height", "output.height", DEFAULTS.height, "64 × 64 output pixels."), "output.height", 1, maximumSide);
  const format = pick<SimulateCaptureOutputFormat>(outputOptions, "format", "output.format", DEFAULTS.format, "8-bit sRGB samples.");
  if (!["srgb-8", "srgb-16", "jpeg", "png", "dng"].includes(format)) fail("output.format must be srgb-8, srgb-16, jpeg, png or dng.");
  let dngCapturedAtUtc: string | undefined;
  if (format === "dng") {
    const d = allowKeys(outputOptions.dng, "output.dng", ["capturedAtUtc"]);
    dngCapturedAtUtc = d.capturedAtUtc as string | undefined;
    if (dngCapturedAtUtc === undefined) assume("output.dng.capturedAtUtc", "default", null, "No capture time: the DNG carries no DateTimeOriginal (the engine never invents a wall clock).");
  } else if (outputOptions.dng !== undefined) fail("output.dng applies only to output.format \"dng\".");
  if (run === "dng-from-parts" && format !== "dng") fail("serializeSimulatedCaptureDngFromParts needs output.format \"dng\".");
  const textMetadata = parseOutputTextMetadata(outputOptions.metadata, "output.metadata");
  if (textMetadata && format !== "jpeg" && format !== "png" && format !== "dng") fail("output.metadata applies only to output.format \"jpeg\", \"png\" or \"dng\".");
  const assumeTextMetadata = (layout: string): void => {
    if (textMetadata) assume("output.metadata", "model", { fields: Object.keys(textMetadata), layout },
      "The caller's text, written unchanged; the engine adds no text of its own (in the DNG the description follows the existing simulated-RAW statement). Without output.metadata the file is byte-identical to 2.3.");
  };
  let colorEncoding: SimulateCaptureColorEncoding | undefined, pngBitDepth: 8 | 16 | undefined;
  if (format === "png") {
    colorEncoding = pick<SimulateCaptureColorEncoding>(outputOptions, "colorEncoding", "output.colorEncoding", "srgb",
      "sRGB (W3C CSS Color 4 srgb) samples signalled with the PNG sRGB chunk (perceptual intent) and its prescribed gAMA/cHRM values.");
    if (!["srgb", "display-p3", "rec2020"].includes(colorEncoding)) fail("output.colorEncoding must be srgb, display-p3 or rec2020.");
    pngBitDepth = pick<8 | 16>(outputOptions, "bitDepth", "output.bitDepth", 8, "8 bits per sample.");
    if (pngBitDepth !== 8 && pngBitDepth !== 16) fail("output.bitDepth must be 8 or 16.");
  } else if (outputOptions.colorEncoding !== undefined || outputOptions.bitDepth !== undefined) fail("output.colorEncoding and output.bitDepth apply only to output.format \"png\".");
  let perceptual = false;
  if (format === "png") {
    const gamutMapping = pick<"clip" | "perceptual">(outputOptions, "gamutMapping", "output.gamutMapping", "clip", "Out-of-gamut components are clipped to [0, 1] in the target space.");
    if (gamutMapping !== "clip" && gamutMapping !== "perceptual") fail("output.gamutMapping must be clip or perceptual.");
    perceptual = gamutMapping === "perceptual";
  } else if (outputOptions.gamutMapping !== undefined) fail("output.gamutMapping applies only to output.format \"png\".");
  const wideGamut = colorEncoding !== undefined && colorEncoding !== "srgb";
  // The linear development path serves wide-gamut encodings and perceptual gamut mapping.
  const linearPath = wideGamut || perceptual;
  const toneCurve = pick<SdrToneCurve>(outputOptions, "toneCurve", "output.toneCurve", DEFAULTS.toneCurve, "Identity tone curve: scene-linear values are clipped at display white, then sRGB-encoded.");
  if (linearPath && toneCurve !== "identity") fail("output.toneCurve other than identity is available only for sRGB output; wide-gamut encodings are converted from the linear developed colour.");
  const highlightMode = pick<RawHighlightMode>(outputOptions, "highlightMode", "output.highlightMode", DEFAULTS.highlightMode, "Saturated RAW highlights are clipped to neutral.");
  // #556: development exposure push, a gain on the normalized RAW before white balance. Opt-in: no assumption when omitted.
  let exposureCompensationStops = 0;
  if (outputOptions.exposureCompensationStops !== undefined) {
    const stops = outputOptions.exposureCompensationStops, range = NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS;
    if (typeof stops !== "number" || !Number.isFinite(stops) || stops < range.minimum || stops > range.maximum) fail("output.exposureCompensationStops must be a finite number from -2 to +5.");
    exposureCompensationStops = stops;
    assume("output.exposureCompensationStops", "model", { stops, gain: 2 ** stops, appliedTo: "black-subtracted white-normalized RAW, before demosaic and white balance",
      dng: format === "dng" ? "unmodified RAW (the push is a development setting)" : null },
    "Development exposure push: each site's (code − black)/(white − black) is multiplied by 2^stops = " + 2 ** stops + " before demosaic, white balance, the highlight mode, colour, the tone curve and encoding, " +
      "like a raw editor's exposure slider. It is not a capture exposure: no photons are added, so raised shadows show the RAW's real shot, read and dark noise and its ADC quantization steps, scaled by the gain. " +
      "A site pushed to or past white clips at white and counts as saturated (highlightMode \"reconstruct\" rolls it off). The RAW codes are unchanged" + (format === "dng" ? ", and the DNG holds the unmodified RAW." : "."));
  }
  const exposureGain = exposureCompensationStops === 0 ? 1 : 2 ** exposureCompensationStops;
  const whiteBalanceOption = pick<SimulateCaptureWhiteBalance>(outputOptions, "whiteBalance", "output.whiteBalance", DEFAULTS.whiteBalance,
    "White balance measured from a perfect white diffuser under the scene illuminant (a custom/grey-card white balance).");
  const jpegStep = format === "jpeg" ? integerIn(pick(outputOptions, "jpegQuantizationStep", "output.jpegQuantizationStep", DEFAULTS.jpegQuantizationStep,
    "Constant JPEG quantization step 2 (not a manufacturer quality scale)."), "output.jpegQuantizationStep", 1, 255) : undefined;
  if (format !== "jpeg" && outputOptions.jpegQuantizationStep !== undefined) fail("output.jpegQuantizationStep applies only to output.format \"jpeg\".");
  const sensorOptions = allowKeys(top.sensor, "sensor", ["pixelPitchMicrometers", "spectralStepNanometers", "temporalSampleCount", "noiseSeed", "antiAliasing", "pixelAperture"]);
  const pitch = positive(pick(sensorOptions, "pixelPitchMicrometers", "sensor.pixelPitchMicrometers", DEFAULTS.pixelPitchMicrometers,
    "6 µm pixels (about a 24 MP full-frame sensor). The simulated sensor is width × pitch wide, so small images are a central crop of a large sensor, not a downscaled full frame."), "sensor.pixelPitchMicrometers");
  if (pitch < 0.5 || pitch > SIMULATE_CAPTURE_PIXEL_PITCH_MAXIMUM_MICROMETERS) fail("sensor.pixelPitchMicrometers must be 0.5-" + SIMULATE_CAPTURE_PIXEL_PITCH_MAXIMUM_MICROMETERS + ".");
  const spectralStep = positive(pick(sensorOptions, "spectralStepNanometers", "sensor.spectralStepNanometers", DEFAULTS.spectralStepNanometers,
    "Spectral midpoint quadrature over 380-780 nm with subintervals of at most 20 nm."), "sensor.spectralStepNanometers");
  if (spectralStep < 1 || spectralStep > 100) fail("sensor.spectralStepNanometers must be 1-100.");
  const temporalSampleCount = integerIn(rotating ? pick(sensorOptions, "temporalSampleCount", "sensor.temporalSampleCount", ROTATING_TEMPORAL_SAMPLE_COUNT,
    "Eight temporal midpoints across each site's exposure window sample the camera rotation (motion blur); raise it for long exposures or fast rotation.") :
    pick(sensorOptions, "temporalSampleCount", "sensor.temporalSampleCount", DEFAULTS.temporalSampleCount,
      "One temporal sample: the static scene and still camera make more samples unnecessary."), "sensor.temporalSampleCount", 1, 256);
  const noiseSeed = integerIn(pick(sensorOptions, "noiseSeed", "sensor.noiseSeed", DEFAULTS.noiseSeed, "Fixed noise seed 1 (deterministic output)."), "sensor.noiseSeed", 0, 0xffffffff);
  const antiAliasing = sensorOptions.antiAliasing === undefined ? undefined : parseAntiAliasing(sensorOptions.antiAliasing, pitch);
  const antiAliasingFast = antiAliasing ? fastOverride(sensorOptions.antiAliasing as Record<string, unknown>, "sensor.antiAliasing") : undefined;
  // Pixel aperture (2.3): N × N midpoint nodes over the square photosite; 1 = the default centre sample.
  let boxSamples = 1, boxFast: boolean | undefined;
  if (sensorOptions.pixelAperture !== undefined && sensorOptions.pixelAperture !== "point") {
    const a = sensorOptions.pixelAperture;
    if (a === "box") boxSamples = SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES;
    else {
      const record = allowKeys(a, "sensor.pixelAperture", ["kind", "samplesPerAxis", "fast"]);
      if (record.kind !== "box") fail("sensor.pixelAperture must be \"point\", \"box\" or { kind: \"box\", samplesPerAxis, fast }.");
      boxFast = fastOverride(record, "sensor.pixelAperture");
      boxSamples = record.samplesPerAxis === undefined ? SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES : integerIn(record.samplesPerAxis, "sensor.pixelAperture.samplesPerAxis", 1, 16);
    }
  }
  const boxAperture = sensorOptions.pixelAperture !== undefined && sensorOptions.pixelAperture !== "point";
  // The environment queries each site at each aperture node minus each anti-aliasing split offset (sites, +x right, +y down).
  const queryOffsetsSites = apertureNodeOffsets(boxSamples).flatMap((node) =>
    (antiAliasing ? antiAliasing.components : [{ offsetMicrometers: { x: 0, y: 0 } }]).map((c) => ({ x: node.x - c.offsetMicrometers.x / pitch, y: node.y - c.offsetMicrometers.y / pitch })));
  // Display view: its own parameters, and the capture options it reproduces, checked before any scene work.
  const parsedView = displayView && viewOption !== DISPLAY_VIEW_WITHOUT_VIEW ? parseDisplayViewOption(viewOption, width, height) : undefined;
  if (displayView) {
    const unsupported = (option: string, reason: string): never => fail("simulateDisplayView does not support " + option + ": " + reason);
    if (pupil) unsupported("lens.pupilSampling", "pupil rays move each query off the site lattice the expected-signal tables use; lens.defocus renders the defocus of the scene plane on the lattice.");
    if (lensPsf) unsupported("lens.psf", "only the engine-built diffraction kernels (lens.diffraction) are tabulated.");
    // #563: projection, distortion, vignetting and rotation are supported (display-view-lens-signal.ts), except rotation under a rolling shutter.
    if (rotating && shutterKind === "rolling") unsupported("camera rotation with motion.shutter \"rolling\"", "every row has its own instants, so the view's " +
      "scene points of one instant would mix rows exposed at other times; use motion.shutter \"global\" for the view.");
    if (outputOptions.region !== undefined) unsupported("output.region", "pass the rectangle as view.region, in display pixels.");
    if (outputOptions.whiteBalance === "auto") unsupported("output.whiteBalance \"auto\"", "the capture measures it from its noisy full-resolution RAW; use \"scene-illuminant\" or a fixed white balance.");
    if (outputOptions.toneCurve !== undefined && outputOptions.toneCurve !== "identity" && outputOptions.toneCurve !== "positive-reinhard-per-channel")
      unsupported("output.toneCurve " + String(outputOptions.toneCurve), "luminance tone curves couple the channels; the view supports identity and positive-reinhard-per-channel.");
    if (outputOptions.highlightMode === "reconstruct") unsupported("output.highlightMode \"reconstruct\"", "the view supports the per-channel highlight clip.");
    if (outputOptions.diffractionCorrection !== undefined || outputOptions.sharpening !== undefined)
      unsupported("output.diffractionCorrection or output.sharpening", "the development detail stages filter the whole developed capture image.");
    if (defocusBokeh?.catsEye) unsupported("lens.defocus.catsEye", "the expected-signal tables hold one kernel per spectral node, and the cat's eye varies over the field; " +
      "simulateCapture renders it. lens.defocus.blades and lens.defocus.sphericalAberration are supported.");
  }

  const colorSamplingProfile = { schemaVersion: "0.1.0" as const, profileId: IDS.cfa, evidence: FACADE_EVIDENCE, coordinateSystem: "native-sensor-color-sampling-site-index" as const,
    layout: { kind: "periodic-mosaic" as const, repeatWidthSites: 2, repeatHeightSites: 2, siteChannelIds: ["red", "green", "green", "blue"], anchor: "native-sensor-top-left-site" as const } };
  // Demosaic (2.0): built-in Bayer kernels and border handling. Omitted, the 1.0 bilinear kernels and a
  // one-site rendered border are used unchanged.
  // #395: the record form { kind, fast } names the same demosaic.
  let demosaicOption: SimulateCaptureDemosaic | undefined, demosaicFast: boolean | undefined;
  if (outputOptions.demosaic !== undefined && typeof outputOptions.demosaic === "object" && outputOptions.demosaic !== null) {
    const record = allowKeys(outputOptions.demosaic, "output.demosaic", ["kind", "fast"]);
    if (record.kind !== "bilinear" && record.kind !== "ahd") fail("output.demosaic must be bilinear or ahd, or { kind, fast }.");
    demosaicOption = record.kind as SimulateCaptureDemosaic;
    demosaicFast = fastOverride(record, "output.demosaic");
  } else demosaicOption = outputOptions.demosaic as SimulateCaptureDemosaic | undefined;
  const borderOption = outputOptions.borderHandling as SimulateCaptureBorderHandling | undefined;
  if (demosaicOption !== undefined && demosaicOption !== "bilinear" && demosaicOption !== "ahd") fail("output.demosaic must be bilinear or ahd.");
  const ahd = demosaicOption === "ahd";
  // #395: exact or fast per option. No option has a fast method yet, so each runs exact and reports false.
  if (top.fast !== undefined && typeof top.fast !== "boolean") fail("fast must be true or false.");
  const fastTop = top.fast === true;
  const fastInUse: [SimulateCaptureFastOption, boolean, boolean | undefined][] = [["lens.diffraction", diffractionRadiusOption !== undefined, diffractionFast],
    ["sensor.antiAliasing", antiAliasing !== undefined, antiAliasingFast], ["sensor.pixelAperture.box", boxAperture, boxFast], ["output.demosaic.ahd", ahd, demosaicFast]];
  const fastApplied: Partial<Record<SimulateCaptureFastOption, boolean>> = {};
  for (const [option, used] of fastInUse) if (used) fastApplied[option] = false;
  const fastReport: SimulateCaptureFastReport = Object.freeze({
    requested: fastTop || [diffractionFast, antiAliasingFast, boxFast, demosaicFast].some((value) => value === true),
    applied: Object.freeze(fastApplied), assurance: "engine-reference" as const });
  if (borderOption !== undefined && borderOption !== "margin" && borderOption !== "mirror") fail("output.borderHandling must be margin or mirror.");
  const builtInDemosaic = demosaicOption === undefined ? undefined : createBuiltInBayerDemosaicProfiles({ kernel: "bilinear",
    captureModeId: IDS.mode, colorSamplingProfile, channelRoles: { red: "red", green: "green", blue: "blue" } }).value;
  const mirrorBorder = borderOption === "mirror";
  const margin = mirrorBorder ? 0 : ahd ? AHD_MARGIN : builtInDemosaic ? builtInDemosaic.kernelReachSites : MARGIN;
  if (mirrorBorder && (width < 2 || height < 2)) fail("output.borderHandling \"mirror\" needs an output of at least 2 × 2 pixels.");
  if (ahd && mirrorBorder && (width < 3 || height < 3)) fail("output.demosaic \"ahd\" with mirror borders needs an output of at least 3 × 3 pixels.");

  // Geometry: the demosaic border (if any) on each side; output crop is the active area.
  const nativeWidth = width + 2 * margin, nativeHeight = height + 2 * margin;
  // Region (2.3): a rectangle of the whole frame. Its native sites are the region plus the demosaic reach on each side
  // (clipped to the raster, where mirror borders apply exactly as in the whole render), with the origin rounded down to
  // the 2 × 2 CFA repeat so the region raster keeps the frame's CFA phase.
  let region: { x: number; y: number; width: number; height: number } | undefined, regionNative: typeof region;
  if (outputOptions.region !== undefined) {
    const r = allowKeys(outputOptions.region, "output.region", ["x", "y", "width", "height"]);
    const x = integerIn(r.x, "output.region.x", 0, width - 1), y = integerIn(r.y, "output.region.y", 0, height - 1);
    region = { x, y, width: integerIn(r.width, "output.region.width", 1, width - x), height: integerIn(r.height, "output.region.height", 1, height - y) };
    const reach = margin > 0 ? margin : ahd ? AHD_MARGIN : builtInDemosaic ? builtInDemosaic.kernelReachSites : MARGIN;
    let x0 = Math.max(0, region.x + margin - reach), y0 = Math.max(0, region.y + margin - reach);
    x0 -= x0 % 2; y0 -= y0 % 2;
    regionNative = { x: x0, y: y0, width: Math.min(nativeWidth, region.x + region.width + margin + reach) - x0, height: Math.min(nativeHeight, region.y + region.height + margin + reach) - y0 };
  }
  const outputWidth = region ? region.width : width, outputHeight = region ? region.height : height;
  if (region && regionNative) assume("output.region", "model", { ...region, frameWidth: width, frameHeight: height, nativeRect: { ...regionNative } },
    "Only this rectangle of the " + width + " × " + height + " frame is rendered. Framing, metering, exposure, diffraction kernels and every site's physics, noise seeds and exposure window (rolling-shutter row timing) are those of the whole frame (absolute native indices), " +
    "and the native rectangle includes the demosaic reach on each side (" + (margin > 0 ? margin : "mirror-border") + "), so the pixels are byte-identical to the same pixels of the whole render. " +
    // 2.6: with lens.diffraction the convolution is limited to the region; the sentence of 2.3–2.5 is kept verbatim otherwise, so
    // region results without diffraction stay byte-identical to 2.5.0.
    (diffractionRadiusOption !== undefined ? "With lens.diffraction the object-space convolution (when it applies) covers only the lattice the region's native sites query (plus the kernel radius), in bands of at most 32 native rows; its values are the whole render's." :
      "With lens.diffraction the object-space convolution runs over whole-width bands of 32 native rows that the region touches."));
  // Development detail (#552): opt-in sharpening and diffraction correction, validated before any scene work.
  let sharpening: UnsharpMaskSettings | undefined, diffractionCorrectionOption: (Omit<DiffractionCorrectionSettings, "kernelRadiusPixels"> & { kernelRadiusPixels?: number }) | undefined;
  if (outputOptions.diffractionCorrection !== undefined || outputOptions.sharpening !== undefined) {
    if (idealReference) fail("simulateIdealReference does not take output.diffractionCorrection or output.sharpening: a reference has no camera development.");
    if (region) fail("output.diffractionCorrection and output.sharpening are not combinable with output.region: they filter across the whole developed image, so a region's edge pixels would differ from the whole render.");
  }
  if (outputOptions.diffractionCorrection !== undefined) {
    if (diffractionRadiusOption === undefined) fail("output.diffractionCorrection needs lens.diffraction: it inverts the diffraction blur that option simulates.");
    const o = allowKeys(outputOptions.diffractionCorrection, "output.diffractionCorrection", ["wavelengthNm", "regularization", "maximumGain", "kernelRadiusPixels"]);
    const parsed = parseDiffractionCorrectionSettings({
      wavelengthNm: pick(o, "wavelengthNm", "output.diffractionCorrection.wavelengthNm", 550, "Design wavelength 550 nm, near the photopic peak, for all three channels: the real blur is polychromatic, and longer wavelengths have a lower cut-off than the one used here."),
      regularization: pick(o, "regularization", "output.diffractionCorrection.regularization", 0.01, "Regularization α = 0.01: an assumed noise-to-signal power ratio of 1 %, a first-party choice, not a measurement of this capture's noise."),
      maximumGain: pick(o, "maximumGain", "output.diffractionCorrection.maximumGain", 4, "Gain bound 4: no frequency is amplified more than 4×, which bounds the noise gain."),
      kernelRadiusPixels: o.kernelRadiusPixels === undefined ? 1 : o.kernelRadiusPixels as number }, "output.diffractionCorrection");
    diffractionCorrectionOption = { wavelengthNm: parsed.wavelengthNm, regularization: parsed.regularization, maximumGain: parsed.maximumGain,
      ...(o.kernelRadiusPixels === undefined ? {} : { kernelRadiusPixels: parsed.kernelRadiusPixels }) };
  }
  if (outputOptions.sharpening !== undefined) {
    if (linearPath) fail("output.sharpening runs on the sRGB SDR path only, not with a wide-gamut output.colorEncoding or output.gamutMapping \"perceptual\".");
    const o = allowKeys(outputOptions.sharpening, "output.sharpening", ["radiusPixels", "amount", "threshold"]);
    sharpening = parseUnsharpMaskSettings({
      radiusPixels: pick(o, "radiusPixels", "output.sharpening.radiusPixels", 1, "Unsharp-mask Gaussian σ = 1 output pixel (kernel reach 3 pixels)."),
      amount: pick(o, "amount", "output.sharpening.amount", 0.5, "Unsharp-mask amount 0.5: half the detail signal is added back."),
      threshold: pick(o, "threshold", "output.sharpening.threshold", 0, "Unsharp-mask threshold 0: every difference is sharpened, including noise.") }, "output.sharpening");
  }
  if (raisedPixels !== undefined) {
    if (nativeWidth > NATIVE_RAW_LIMITS.maximumDimension || nativeHeight > NATIVE_RAW_LIMITS.maximumDimension || nativeWidth * nativeHeight > raisedPixels) {
      fail("output.maximumPixels (" + raisedPixels + ") must cover the native sensor raster of " + nativeWidth + " × " + nativeHeight +
        " sites (the output plus the demosaic margin), at most " + NATIVE_RAW_LIMITS.maximumDimension + " per side.");
    }
    // The display view allocates no full-resolution raster, so the AHD working limit does not apply to it.
    if (ahd && !displayView && (regionNative ? regionNative.width * regionNative.height : nativeWidth * nativeHeight) > PROCESSING_MAX_PIXELS) fail("output.demosaic \"ahd\" admits at most " + PROCESSING_MAX_PIXELS + " native sites.");
  }
  const imagingArea = { widthMm: nativeWidth * pitch / 1000, heightMm: nativeHeight * pitch / 1000 };
  const geometry = { imagingArea, nativeRaster: { pixelWidth: nativeWidth, pixelHeight: nativeHeight }, orientation: "landscape" as const,
    activeCaptureRect: { x: margin, y: margin, width, height }, outputRaster: { pixelWidth: width, pixelHeight: height } };
  const resolvedGeometry = resolveCaptureGeometry(geometry).value;
  const imageDistanceMm = focalLengthMm * focusDistanceM * 1000 / (focusDistanceM * 1000 - focalLengthMm);
  const metresPerFrameUnit = (width * pitch / 2000) * subjectDistanceM / imageDistanceMm;
  const aspect = height / width;
  // Fixed-size chart (2.3): validated here, before any scene work.
  const chartSize = top.chartSize === undefined ? undefined : resolveChartSizeOption(top.chartSize, aspect);
  assume("scene.framing", "derived", { framedWidthM: 2 * metresPerFrameUnit, framedHeightM: 2 * metresPerFrameUnit * aspect },
    chartSize ? "The scene plane is perpendicular to the optical axis; the frame covers this much of it (thin lens, focused distance), and the chart has the physical size in scene.chartSize." :
      "The scene plane is perpendicular to the optical axis and the chart is sized to fill the active frame exactly.");
  let chartReport: NonNullable<SimulateCaptureResult["scene"]["chart"]> | undefined;
  if (chartSize) {
    for (const key of chartSize.defaulted) assume("chartSize." + key, "default", chartSize[key], key === "heightM" ?
      "The chart has the frame's shape: height = width × output height / output width." : "An 18 % neutral grey plane surrounds the chart.");
    const magnification = imageDistanceMm / (subjectDistanceM * 1000), framedWidthM = 2 * metresPerFrameUnit, framedHeightM = framedWidthM * aspect;
    chartReport = { widthM: chartSize.widthM, heightM: chartSize.heightM, surroundReflectance: chartSize.surroundReflectance,
      frameWidthFraction: chartSize.widthM / framedWidthM, frameHeightFraction: chartSize.heightM / framedHeightM, magnification,
      imageWidthMm: chartSize.widthM * 1000 * magnification, imageHeightMm: chartSize.heightM * 1000 * magnification,
      imageWidthPixels: chartSize.widthM * 1e6 * magnification / pitch, imageHeightPixels: chartSize.heightM * 1e6 * magnification / pitch };
    assume("scene.chartSize", "model", chartReport,
      "Fixed-size chart: the chart is widthM × heightM metres on the scene plane, centred on the optical axis, and the rest of the plane is a neutral Lambertian surround under the same light. " +
      "Its image size follows the facade's thin-lens framing: magnification m = v/d with the image distance v = f·s/(s − f) at the focus distance s and the subject distance d, so the frame spans " +
      "sensor width / m on the plane. frameWidthFraction and frameHeightFraction above 1 mean the chart is larger than the frame and cropped.");
  }
  if (demosaicOption === undefined && borderOption === undefined) {
    assume("output.demosaic", "model", "bilinear-rggb", "Bilinear RGGB demosaic through explicit linear kernels; the native raster has a one-site border on each side so every output pixel has full support.");
  } else {
    if (demosaicOption === undefined) assume("output.demosaic", "default", "bilinear-rggb", "The 1.0 facade's bilinear RGGB kernels (explicit linear neighbourhood weights).");
    else if (ahd) assume("output.demosaic", "model", { method: "ahd-hirakawa-parks-2005", dependenceReachSites: AHD_MARGIN },
      "Adaptive homogeneity-directed demosaicing (createAhdDemosaicTask, after Hirakawa & Parks, IEEE TIP 14(3), 2005): directional green, red/blue from colour differences, and per pixel the more homogeneous of the horizontal and vertical candidates in CIELAB (white-balanced camera colour); the paper's iterative median step is not applied. Non-linear; the mosaic is normalized and white-level clipped as in the native development and stored in float32, and the native development's colour operator follows. request.development keeps the built-in bilinear kernels, which validate the development but are not used for these pixels.");
    else assume("output.demosaic", "model", { kernel: builtInDemosaic!.kernel, modelVersion: BUILT_IN_DEMOSAIC_VERSION, kernelReachSites: builtInDemosaic!.kernelReachSites },
      "Built-in bilinear Bayer kernels (createBuiltInBayerDemosaicProfiles): nearest same-channel averages.");
    if (borderOption === undefined) assume("output.borderHandling", "default", "margin", "The native raster adds the kernel reach (" + margin + " site(s)) on each side, so every output pixel is reconstructed from rendered sites.");
    else assume("output.borderHandling", "model", borderOption, mirrorBorder ?
      "No rendered border: the native raster equals the output and reconstruction reads reflect-101 mirror images of the missing sites (CFA consistency validated), so edge pixels use mirrored rather than rendered neighbours." :
      "The native raster adds the kernel reach (" + margin + " site(s)) on each side, so every output pixel is reconstructed from rendered sites.");
  }

  // Radiance queries per native site: spectral subintervals × temporal midpoints × pupil rays × PSF taps.
  const psfTaps = lensPsf ? Math.max(1, ...((lensPsf.configuration.psf.profile.nodes ?? []) as readonly { kernel?: { widthSamples?: unknown; heightSamples?: unknown } }[])
    .map((node) => Number(node.kernel?.widthSamples) * Number(node.kernel?.heightSamples)).filter((taps) => Number.isSafeInteger(taps) && taps > 0)) : 1;
  const queriesPerSite = temporalSampleCount * (Math.ceil((FACADE_SPECTRAL_RANGE_NANOMETERS.maximum - FACADE_SPECTRAL_RANGE_NANOMETERS.minimum) / spectralStep) + 1) *
    (pupil ? pupil.radialSamples * pupil.angularSamples : 1) * psfTaps * (antiAliasing ? antiAliasing.components.length : 1) * boxSamples * boxSamples;

  // Scene and illuminant
  // The scene is the one required input: the facade never guesses what is being photographed.
  if (top.scene === undefined) fail("simulateCapture needs a scene, for example { preset: \"uniform\" } (an 18 % grey card) or { preset: \"slanted-edge\" }.");
  const sceneOption = top.scene;
  requireInputObject(sceneOption, "scene");
  const illuminantOption = pick<CaptureIlluminant>(top, "illuminant", "illuminant", { kind: "planckian", temperatureKelvin: DEFAULTS.illuminantKelvin },
    "Planckian (blackbody) 6500 K as a stand-in for daylight. CIE D65 is not bundled; pass its S0/S1/S2 basis as a daylight illuminant to use it.");
  const illuminant = resolveCaptureIlluminant(illuminantOption);
  const illuminanceLux = positive(pick(top, "illuminanceLux", "illuminanceLux", SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX,
    "π·10·N²/(0.65·t·S·0.18) lux at f/8, 1/125 s, ISO 100 (CIPA DC-004 standard output sensitivity H = 10/S and camera equation H = 0.65·L·t/N²): an 18 % grey card then gets the reference exposure for the default settings. It does not follow the caller's exposure settings."), "illuminanceLux");
  const irradianceScale = calculateIlluminantIrradianceScale(illuminant.shape, illuminanceLux);
  let chart: ResolvedChartScene | undefined, callerScene: ResolvedCallerScene | undefined, materialLayers: ResolvedChartMaterialLayers | undefined;
  const sceneRecord = sceneOption as Record<string, unknown>;
  if ("kind" in sceneRecord) {
    // #491: a declared material-layers scene is its callerScene (the same validation, materials, digest and bytes as passing that scene);
    // the resolved layers are kept for the display view's GPU renderer.
    if (sceneRecord.kind === "material-layers") materialLayers = resolveChartMaterialLayers({ scene: sceneOption as ChartMaterialLayerScene, aspect: chartSize ? chartSize.heightM / chartSize.widthM : aspect });
    callerScene = requireCallerScene(materialLayers ? materialLayers.callerScene : sceneOption);
  } else {
    chart = resolveChartScene({ scene: sceneOption as ChartScene, aspect: chartSize ? chartSize.heightM / chartSize.widthM : aspect });
    // Composite charts (2.3) report nested defaults by dotted path, for example "elements.2.parameters.cycles".
    const parameterAt = (key: string): unknown => key in chart!.parameters ? chart!.parameters[key] :
      key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], chart!.parameters);
    for (const key of chart.defaultedParameters) assume("scene." + key, "default", parameterAt(key), "Chart default for " + chart.preset + ".");
  }
  const scenePreset = chart ? chart.preset : callerScene!.kind;
  // Caller spectra enter the digest as data (see spectrumDigestForm). Without caller spectra the description is unchanged,
  // so default captures keep their digests.
  const illuminantRecord = typeof illuminantOption === "object" ? illuminantOption as { kind?: unknown; basis?: { datasetId?: unknown } } : undefined;
  const illuminantSpectrum = illuminantRecord?.kind === "spectrum" ? { spectrum: spectrumDigestForm(illuminant.spectrum, illuminant.shape) } :
    illuminantRecord?.kind === "daylight" ? { basisDatasetId: illuminantRecord.basis?.datasetId, spectrum: spectrumDigestForm(illuminant.spectrum, illuminant.shape) } : undefined;
  const materialInputs = chart ? chartMaterialInputs(chart) : [];
  const sceneSpectra = chart ? chart.materials.flatMap((m, index) => m.kind !== "spectrum" ? [] : [{ material: index, spectrum: spectrumDigestForm(materialInputs[index], m.spectrum) }]) : [];
  // 2.7: a material scene's materials enter the digest as data (neutral reflectances, and caller spectra as above).
  const sceneMaterials = callerScene?.kind === "material-function" ? callerScene.materials.map((m, index) => (m.kind === "neutral" ? m.reflectance :
    spectrumDigestForm(callerScene.materialInputs[index], m.spectrum))) : undefined;
  const sceneDescription = { facadeVersion: SIMULATE_CAPTURE_FACADE_VERSION, scene: chart ? { preset: chart.preset, parameters: chart.parameters } :
    { kind: callerScene!.kind, sceneId: callerScene!.sceneId }, illuminant: illuminant.id, illuminanceLux, subjectDistanceM, framedWidthM: 2 * metresPerFrameUnit, aspect,
    ...(chartSize ? { chartSize: { widthM: chartSize.widthM, heightM: chartSize.heightM, surroundReflectance: chartSize.surroundReflectance } } : {}),
    ...(illuminantSpectrum === undefined ? {} : { illuminantSpectrum }), ...(sceneSpectra.length === 0 ? {} : { sceneSpectra }), ...(sceneMaterials ? { sceneMaterials } : {}) };
  if (callerScene?.kind === "material-function") assume("scene.digest", "model", "caller-function-not-hashed", "The source digest covers the caller's sceneId, its materials and the framing, not the body of the caller's materialAt function.");
  else if (callerScene) assume("scene.digest", "model", "caller-function-not-hashed", "The source digest covers the caller's sceneId and the framing, not the body of the caller's evaluate function.");
  const sourceSha256 = await sha256Hex(JSON.stringify(sceneDescription, (_key, value: unknown) => (typeof value === "object" && value !== null && "evaluate" in value ? "caller-spectrum" : value)));
  checkAbort();
  const buildProvider = (sceneIlluminant: ResolvedCaptureIlluminant, scale: number): PlanarSceneRadianceProvider => buildPlanarSceneRadianceProvider({ scene: chart ?? callerScene!,
    sceneId: IDS.scene, providerProfileId: IDS.provider, illuminant: sceneIlluminant, irradianceScale: scale, geometry: { distanceM: subjectDistanceM, metresPerFrameUnit,
      ...(chartSize ? { chart: { widthM: chartSize.widthM, heightM: chartSize.heightM, surroundReflectance: chartSize.surroundReflectance } } : {}) }, evidence: FACADE_EVIDENCE,
    limitations: Object.freeze(["Planar Lambertian scene under uniform illumination; no shadows, inter-reflection, gloss or fluorescence."]),
    ...(catalogue?.kind === "fisheye" ? { zeroBeyondHorizon: true as const } : {}) });
  const provider = buildProvider(illuminant, irradianceScale);
  // 2.6: a chart preset's evaluator is engine-built end to end (its results: the schema's exact keys, constant fields,
  // the request's identifiers, deep-frozen FACADE_EVIDENCE, UNCERTAINTY and limitations, and an engine-computed
  // radiance), so the native task may skip re-parsing the fixed parts. Caller scenes keep the full validation.
  // #394: a caller material scene's evaluator is engine-built in the same way (its radiance comes from the validated materials;
  // only materialAt, validated on every call, is the caller's).
  const materialEvaluator = chart !== undefined || callerScene?.kind === "material-function";
  if (materialEvaluator) markInternalSceneRadianceEvaluator(provider.evaluateRadiance);
  // #394: its results are materialRadiance(material at the queried point, wavelength), so the lean executor may tabulate them.
  const materialOfDirection = planarProviderMaterialOfDirection(provider);
  if (materialEvaluator && materialOfDirection && provider.materialRadiance) registerInternalRadianceAccess(provider.evaluateRadiance,
    { keyOfDirection: materialOfDirection, radianceOfKey: provider.materialRadiance, tabulated: true });
  assume("model.scene-radiometry", "model", "lambertian-plane", "Radiance = reflectance × irradiance / π on one plane; illuminance from K_m = 683 lm/W and the engine's analytic CIE 1931 ȳ fit.");

  // Metering (CIPA DC-004 standard output sensitivity and camera equation) and exposure-mode resolution
  const exposureOptions = allowKeys(top.exposure, "exposure", ["mode", "iso", "shutterSeconds", "compensationStops", "autoIso", "metering"]);
  // 2.14: no default assumption when omitted, so 2.13 requests keep their assumptions; the result reports `exposure.metering`.
  const metering: SimulateCaptureMetering = exposureOptions.metering === undefined ? "scene-average" : exposureOptions.metering as SimulateCaptureMetering;
  if (!(SIMULATE_CAPTURE_METERING_MODES as readonly unknown[]).includes(metering)) fail('exposure.metering must be "scene-average" or "grey-card".');
  const mode = pick<SimulateCaptureExposureMode>(exposureOptions, "mode", "exposure.mode", "manual", "Manual exposure.");
  if (!["manual", "aperture-priority", "shutter-priority", "program"].includes(mode)) fail("Unknown exposure mode.");
  const isoOption = pick<unknown>(exposureOptions, "iso", "exposure.iso", DEFAULTS.iso, "ISO 100, the tiers' base ISO.");
  // #516: "auto" resolves the ISO with the mode's Auto ISO resolver; NaN marks the ISO as not yet known.
  const automaticIso = isoOption === "auto";
  if (typeof isoOption === "string" && !automaticIso) fail('exposure.iso must be a positive finite number or "auto".');
  const iso = automaticIso ? NaN : positive(isoOption, "exposure.iso");
  if (exposureOptions.autoIso !== undefined && !automaticIso) fail('exposure.autoIso applies only with exposure.iso "auto"; omit it.');
  const compensation = exposureOptions.compensationStops === undefined ? DEFAULTS.compensationStops : exposureOptions.compensationStops;
  if (typeof compensation !== "number" || !Number.isFinite(compensation) || Math.abs(compensation) > 10) fail("exposure.compensationStops must be within ±10.");
  if (exposureOptions.compensationStops === undefined) assume("exposure.compensationStops", "default", 0, "No exposure compensation.");
  // #569: a lens whose range excludes f/8 (the catalogue's PV 800 9, f/9–f/32) takes the same reference exposure at its widest aperture,
  // N0 with t = 1/125 s × (N0/8)², which has the same N²/t and so the same reference luminance; every other request keeps f/8, 1/125 s.
  const referenceAperture = lensRange && (DEFAULTS.fNumber < lensRange.widestFNumber || DEFAULTS.fNumber > lensRange.narrowestFNumber) ? lensRange.widestFNumber : DEFAULTS.fNumber;
  const reference = { aperture: referenceAperture, shutterSeconds: referenceAperture === DEFAULTS.fNumber ? DEFAULTS.shutterSeconds :
    DEFAULTS.shutterSeconds * (referenceAperture / DEFAULTS.fNumber) ** 2, iso: DEFAULTS.iso };
  const referenceLuminance = sosReferenceLuminance(reference.aperture, reference.shutterSeconds, reference.iso);
  assume("exposure.referenceExposure", "model", { ...reference, meteredLuminanceCdPerSquareMeter: referenceLuminance },
    "Exposure anchor: f/8, 1/125 s, ISO 100 gives the CIPA DC-004 standard output sensitivity reference exposure H = 10/S = 0.1 lx·s for an average scene luminance of 10·N²/(0.65·t·S) ≈ 1230.77 cd/m² (camera equation H = 0.65·L·t/N²)" +
    (referenceAperture === DEFAULTS.fNumber ? "." : "; the lens excludes f/8: the same N²/t at f/" + referenceAperture + "."));
  const meterProfile = body.metering[0]!.profile, zones = 16, zoneSamples = [];
  let luminanceSum = 0;
  for (let j = 0; j < zones; j++) for (let i = 0; i < zones; i++) {
    const u = -1 + (i + 0.5) * 2 / zones, v = aspect - (j + 0.5) * 2 * aspect / zones;
    const luminance = luminanceOf((nm) => provider.radianceAt(u, v, nm));
    luminanceSum += luminance;
    zoneSamples.push({ sampleId: "zone-" + i + "-" + j, positionOrientedCaptureUv: { u: (i + 0.5) / zones, v: (j + 0.5) / zones },
      relativeLinearSignal: meterProfile.target.targetRelativeSignal * luminance / referenceLuminance, areaWeight: 1 });
  }
  const meteredLuminance = luminanceSum / (zones * zones);
  assume("exposure.metering", "model", { policy: meterProfile.policy.kind, zones: zones * zones },
    "The body's " + meterProfile.policy.kind + " meter reads scene luminance on a 16 × 16 zone grid, before the lens (no lens transmission, vignetting or flare).");
  if (metering === "grey-card") {
    // 2.14: incident metering. Every zone reads the 18 % Lambertian grey card under the request's illuminance, L = 0.18·E/π.
    if (callerScene?.kind === "radiance-function") fail('exposure.metering "grey-card" needs a scene lit by the illuminance; a radiance-function scene ignores illuminanceLux.');
    const cardLuminance = GREY_CARD_REFLECTANCE * illuminanceLux / Math.PI;
    for (const sample of zoneSamples) sample.relativeLinearSignal = meterProfile.target.targetRelativeSignal * cardLuminance / referenceLuminance;
    assume("exposure.meteringSource", "model", { metering, greyCardReflectance: GREY_CARD_REFLECTANCE, luminanceCdPerSquareMeter: cardLuminance },
      "Grey-card (incident) metering: every meter zone reads an 18 % Lambertian grey card under the scene illuminance, L = 0.18·E/π, instead of the scene.");
  }
  const meterResult = meterRelativeExposure({ profile: meterProfile, sampleSet: { measurementId: "facade-meter", sceneStateId: IDS.sceneState,
    inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", captureGeometry: resolvedGeometry,
    processingState: { exposureSettingsApplied: false, whiteBalanceApplied: false, toneMappingApplied: false, displayGammaApplied: false, sharpeningApplied: false },
    samples: zoneSamples } });
  let target = createExposureMeterTargetFromMeteringResult({ targetId: "facade-target", meterResult: meterResult.value });
  if (compensation !== 0) target = setExposureCompensationOnMeterTarget({ targetId: "facade-target-ec", baseTarget: target, exposureCompensationStops: compensation });
  let resolution: { status: string; resolvedSettings?: { aperture?: number; shutterSeconds?: number; iso?: number } };
  let fNumber: number, shutterSeconds: number;
  const checkFNumber = (): void => {
    if (lensRange && (fNumber < lensRange.widestFNumber || fNumber > lensRange.narrowestFNumber))
      fail("lens.fNumber " + fNumber + " is outside the " + lensRange.name + " range f/" + lensRange.widestFNumber + "–f/" + lensRange.narrowestFNumber + ".");
  };
  if (mode === "manual" || mode === "aperture-priority") {
    fNumber = positive(pick(lensOptions, "fNumber", "lens.fNumber", DEFAULTS.fNumber, "f/8."), "lens.fNumber");
    checkFNumber();
  } else {
    if (lensOptions.fNumber !== undefined) fail("lens.fNumber is resolved automatically in " + mode + " mode; omit it.");
    fNumber = NaN;
  }
  if (mode === "manual" || mode === "shutter-priority") {
    shutterSeconds = positive(pick(exposureOptions, "shutterSeconds", "exposure.shutterSeconds", DEFAULTS.shutterSeconds, "1/125 s."), "exposure.shutterSeconds");
  } else {
    if (exposureOptions.shutterSeconds !== undefined) fail("exposure.shutterSeconds is resolved automatically in " + mode + " mode; omit it.");
    shutterSeconds = NaN;
  }
  // #516: the resolvers' Auto ISO policies; their baseline is the lowest selectable ISO in the body's Auto ISO range.
  const autoIsoBaseline: AutoIsoBaselinePolicy = { isoBaseline: "minimum-selectable", isoQuantizationPolicy: "nearest-log2-lower-on-tie" };
  let autoIsoAperturePriority: { slowestPreferredShutterSeconds: number; afterMaximumIso: SimulateCaptureAutoIsoAfterMaximum } | undefined;
  // #505: the photographer's Auto ISO limits, validated against the body's Auto ISO range; absent unless given.
  let autoIsoOptions: Record<string, unknown> = {};
  let autoIsoLimits: { minimum: number; maximum: number } | undefined;
  // #504: the slowest preferred shutter (aperture priority; optional in program) and, with "auto", how it was derived.
  let autoIsoShutterPolicy: { slowestPreferredShutterSeconds: number; afterMaximumIso: SimulateCaptureAutoIsoAfterMaximum } | undefined;
  let automaticSlowestShutter: SimulateCaptureAutomaticSlowestShutterReport | undefined;
  // 2.14: the capabilities the exposure-mode resolvers see; with Auto ISO in whole stops, the ISO grid's whole stops only.
  let resolverCapabilities = capabilities, autoIsoIsoSteps: "whole-stop" | "third-stop" = "whole-stop";
  if (automaticIso) {
    if (capabilities.iso.autoIsoAvailability !== "supported")
      fail('exposure.iso "auto" needs a body with Auto ISO; this camera\'s Auto ISO is ' + capabilities.iso.autoIsoAvailability + ".");
    autoIsoOptions = allowKeys(exposureOptions.autoIso, "exposure.autoIso", ["slowestPreferredShutterSeconds", "afterMaximumIso", "limits", "automaticSlowestShutter", "isoSteps"]);
    // 2.14: Auto ISO steps in whole stops unless asked for thirds, so its choices are those of 2.13 on the third-stop bodies.
    if (autoIsoOptions.isoSteps !== undefined && autoIsoOptions.isoSteps !== "whole-stop" && autoIsoOptions.isoSteps !== "third-stop")
      fail('exposure.autoIso.isoSteps must be "whole-stop" or "third-stop".');
    if (autoIsoOptions.isoSteps === "third-stop") autoIsoIsoSteps = "third-stop";
    if (autoIsoIsoSteps === "whole-stop") resolverCapabilities = wholeStopIsoCapabilities(capabilities);
    if (mode !== "aperture-priority" && mode !== "program") for (const key of ["slowestPreferredShutterSeconds", "afterMaximumIso", "automaticSlowestShutter"])
      if (autoIsoOptions[key] !== undefined) fail("exposure.autoIso." + key + ' applies only to exposure.mode "aperture-priority" or "program"; omit it.');
    if (autoIsoOptions.limits !== undefined) autoIsoLimits = parseAutoIsoLimitsOption(autoIsoOptions.limits, resolverCapabilities.iso);
    assume("exposure.autoIso", "model", { minimum: capabilities.iso.autoIsoMinimum ?? capabilities.iso.minimum, maximum: capabilities.iso.autoIsoMaximum ?? capabilities.iso.maximum,
      ...(autoIsoLimits ? { limits: { ...autoIsoLimits } } : {}), ...autoIsoBaseline },
      "Auto ISO: the engine's exposure-mode resolver chooses the ISO from the meter target, starting from the lowest selectable ISO in the body's Auto ISO range and " +
      "snapping to the nearest selectable ISO in log2 (the lower on a tie), held at the range's ends. A generic policy, not a manufacturer's Auto ISO." +
      (autoIsoLimits ? " The photographer's limits (exposure.autoIso.limits, #505) narrow that range to ISO " + autoIsoLimits.minimum + " to " + autoIsoLimits.maximum + "." : ""));
  }
  if (automaticIso && mode === "program" && autoIsoOptions.slowestPreferredShutterSeconds === undefined) {
    for (const key of ["afterMaximumIso", "automaticSlowestShutter"]) if (autoIsoOptions[key] !== undefined)
      fail("exposure.autoIso." + key + ' in program needs exposure.autoIso.slowestPreferredShutterSeconds; omit it or set the slowest shutter.');
  }
  if (automaticIso && (mode === "aperture-priority" || (mode === "program" && autoIsoOptions.slowestPreferredShutterSeconds !== undefined))) {
    if (autoIsoOptions.slowestPreferredShutterSeconds === undefined)
      fail('exposure.autoIso.slowestPreferredShutterSeconds is required with exposure.mode "aperture-priority" and exposure.iso "auto": the slowest shutter, in seconds, before Auto ISO raises the ISO, or "auto".');
    if (autoIsoOptions.automaticSlowestShutter !== undefined && autoIsoOptions.slowestPreferredShutterSeconds !== "auto")
      fail('exposure.autoIso.automaticSlowestShutter applies only with exposure.autoIso.slowestPreferredShutterSeconds "auto"; omit it.');
    let slowestPreferredShutterSeconds: number;
    if (autoIsoOptions.slowestPreferredShutterSeconds === "auto") {
      automaticSlowestShutter = resolveAutomaticSlowestShutterOption(autoIsoOptions.automaticSlowestShutter, { focalLengthMm, focusDistanceM, pitch,
        shutter: capabilities.shutter, assume, pick });
      slowestPreferredShutterSeconds = automaticSlowestShutter.shutterSeconds;
    } else {
      if (typeof autoIsoOptions.slowestPreferredShutterSeconds === "string")
        fail('exposure.autoIso.slowestPreferredShutterSeconds must be a positive number of seconds or "auto".');
      slowestPreferredShutterSeconds = positive(autoIsoOptions.slowestPreferredShutterSeconds, "exposure.autoIso.slowestPreferredShutterSeconds");
      if (slowestPreferredShutterSeconds < capabilities.shutter.minimumSeconds || slowestPreferredShutterSeconds > capabilities.shutter.maximumSeconds)
        fail("exposure.autoIso.slowestPreferredShutterSeconds must be within the body's shutter range, " + capabilities.shutter.minimumSeconds + " s to " + capabilities.shutter.maximumSeconds + " s.");
    }
    const afterMaximumIso = pick<unknown>(autoIsoOptions, "afterMaximumIso", "exposure.autoIso.afterMaximumIso", "allow-slower-shutter",
      "At the Auto ISO maximum, the shutter may get slower than the slowest preferred shutter to reach the meter target.");
    if (afterMaximumIso !== "allow-slower-shutter" && afterMaximumIso !== "hold-preferred-shutter")
      fail('exposure.autoIso.afterMaximumIso must be "allow-slower-shutter" or "hold-preferred-shutter".');
    autoIsoShutterPolicy = { slowestPreferredShutterSeconds, afterMaximumIso };
    if (mode === "aperture-priority") autoIsoAperturePriority = autoIsoShutterPolicy;
  }
  const limitsPolicy = autoIsoLimits ? { autoIsoLimits: { ...autoIsoLimits } } : {};
  if (mode === "manual") {
    resolution = resolveManualExposureMode({ target, capabilities: resolverCapabilities, referenceExposure: reference, manualAperture: fNumber, manualShutterSeconds: shutterSeconds,
      isoControl: automaticIso ? { kind: "automatic", quantizationPolicy: autoIsoBaseline.isoQuantizationPolicy, ...limitsPolicy } : { kind: "manual", iso } });
  } else if (autoIsoAperturePriority) {
    resolution = resolveAperturePriorityAutoIsoExposureMode({ target, capabilities: resolverCapabilities, referenceExposure: reference, manualAperture: fNumber,
      policy: { kind: "minimum-iso-until-slowest-preferred-shutter", ...autoIsoBaseline, shutterSelectionPolicy: "not-longer-than-target", ...autoIsoAperturePriority, ...limitsPolicy } });
  } else if (mode === "aperture-priority") {
    resolution = resolveAperturePriorityExposureMode({ target, capabilities: resolverCapabilities, referenceExposure: reference, manualAperture: fNumber, manualIso: iso,
      shutterQuantizationPolicy: "nearest-log2-shorter-on-tie" });
  } else if (mode === "shutter-priority") {
    resolution = resolveShutterPriorityExposureMode({ target, capabilities: resolverCapabilities, referenceExposure: reference, manualShutterSeconds: shutterSeconds,
      isoControl: automaticIso ? { kind: "automatic", policy: { kind: "minimum-iso-aperture-first", apertureSelectionPolicy: "not-wider-than-target", ...autoIsoBaseline, ...limitsPolicy } } :
        { kind: "manual", iso, apertureQuantizationPolicy: "nearest-log2-narrower-on-tie" } });
  } else {
    assume("exposure.programLine", "model", "facade-generic-program-line", "Engine-authored generic program line (f/16 1/2000 s … f/8 1/125 s … f/4 1.024 s); not a manufacturer program.");
    resolution = resolveProgramAutoExposureMode({ target, capabilities: resolverCapabilities, referenceExposure: reference, programLine: defaultProgramLine(),
      isoControl: automaticIso ? { kind: "automatic", ...autoIsoBaseline, ...limitsPolicy, ...(autoIsoShutterPolicy ? { slowestPreferredShutter: { ...autoIsoShutterPolicy } } : {}) } :
        { kind: "manual", iso } });
  }
  if (resolution.status !== "resolved" || !resolution.resolvedSettings) fail("Exposure could not be resolved (" + resolution.status + "); the scene may have no signal.");
  fNumber = resolution.resolvedSettings.aperture ?? fNumber;
  shutterSeconds = resolution.resolvedSettings.shutterSeconds ?? shutterSeconds;
  const resolvedIso = resolution.resolvedSettings.iso ?? iso;
  if (!Number.isFinite(resolvedIso) || resolvedIso <= 0) fail("Exposure could not be resolved: the resolved ISO is not a positive finite number.");
  const isoReport = automaticIso ? { isoControl: "automatic" as const, autoIso: autoIsoReport(resolution, resolverCapabilities.iso, autoIsoShutterPolicy, autoIsoLimits, automaticSlowestShutter,
    autoIsoOptions.isoSteps === undefined ? undefined : autoIsoIsoSteps) } : { isoControl: "manual" as const };
  const exposureDeviationStops = standardExposureDeviationStops(fNumber, shutterSeconds, resolvedIso, meteredLuminance);
  const exposureIlluminanceLux = standardExposureIlluminanceLux(fNumber, shutterSeconds, resolvedIso, meteredLuminance, illuminanceLux,
    callerScene?.kind !== "radiance-function");
  const exposureGreyCardDeviationStops = callerScene?.kind === "radiance-function" ? null : greyCardDeviationStops(fNumber, shutterSeconds, resolvedIso, illuminanceLux);
  // #549: the catalogue lens's character at the resolved f-number and focus: focus scatter, the defocus disc folded into its PSF, then
  // its distortion and vignetting profiles over the field the PSF and the queries reach, and its PSF profile.
  let catalogueTaps: number | undefined, catalogueDefocusApplied = false, catalogueKernelRadius = 0;
  if (catalogue && lensKit) {
    const { GENERIC_LENS_EVIDENCE, genericLensDistortionProfile, genericLensVignettingProfile, resolveGenericLens, simulateGenericLensFocusError, createGenericLensPsfProfile,
      genericLensPsfKernelRadius, GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES } = lensKit;
    checkFNumber();
    if (lensOptions.focusScatter !== undefined) {
      const scatterOptions = allowKeys(lensOptions.focusScatter, "lens.focusScatter", ["seed", "shotIndex"]);
      const sample = simulateGenericLensFocusError({ lensId: catalogue.lensId, activeImagingArea: catalogueFrame!, fNumber, focusDistanceM, seed: scatterOptions.seed as number,
        ...(scatterOptions.shotIndex === undefined ? {} : { shotIndex: scatterOptions.shotIndex as number }) });
      assume("lens.focusScatter", "model", { ...sample },
        "Seeded autofocus error (an approximation of focus consistency): image-side error z·σ·2Nc with z a standard normal draw from the seed and shot index, σ = " + sample.depthOfFocusFraction +
        " of the depth of focus 2·N·c (c = the frame diagonal / 1500), read back through the thin lens. The focus distance " + sample.intendedFocusDistanceM + " m becomes " + sample.focusDistanceM + " m" +
        (lensOptions.defocus === undefined ? "; without lens.defocus the capture renders no defocus, so the image does not change." : "."));
      focusDistanceM = sample.focusDistanceM;
    }
    const character = resolveGenericLens({ lensId: catalogue.lensId, activeImagingArea: catalogueFrame!, fNumber, focusDistanceM });
    let extraKernel: { weights: Float64Array; radius: number } | undefined;
    if (lensOptions.defocus !== undefined) {
      const disc = resolveDefocusDisc({ focalLengthMm, aperture: fNumber, focusDistanceM, subjectDistanceM, pitchMicrometers: pitch });
      let discRadius: number;
      try { discRadius = requireDefocusDiscKernelRadius(disc.diameterSites); } catch { fail("lens.defocus: " + defocusDiscLimitMessage(disc.diameterSites, disc.diameterMicrometers)); }
      const kernel = run === "ideal-reference" ? null : createDefocusDiscSiteKernel(disc.diameterSites);
      if (kernel) { extraKernel = { weights: kernel.weights, radius: kernel.radius }; catalogueDefocusApplied = true; }
      assume("lens.defocus", "model", { model: "geometric-disc", scientificStatus: "approximation", diameterMicrometers: disc.diameterMicrometers, diameterSites: disc.diameterSites,
        kernelRadiusSites: disc.diameterSites === 0 ? null : discRadius, fNumber, focusDistanceM, subjectDistanceM, samplePitchMicrometers: pitch,
        defocusCircleModel: { id: "thin-lens-defocus-circle", version: "1.1.0" }, execution: "catalogue-lens-psf" },
      "Geometric defocus of the flat scene plane (an approximation): the thin-lens blur circle c = f²·|s − d| / (N·d·(s − f)) (calculateDefocusCircle 1.1.0) as a uniform disc sampled on the site lattice. " +
        (disc.diameterSites === 0 ? "In focus: no disc is applied." : run === "ideal-reference" ? "Resolved but not applied: the ideal reference has no camera effects." :
          "With the catalogue lens the disc is convolved into every node of the lens's PSF (a further approximation: the defocused aberrated wave PSF is not exactly the in-focus PSF convolved with the disc) and applied through the environment PSF quadrature."));
    }
    // An upper bound of the PSF's radius (the built window may be narrower): the field reach below uses it.
    const kernelRadius = genericLensPsfKernelRadius({ lens: character, focusDistanceM, sitePitchMicrometers: pitch }) + (extraKernel ? extraKernel.radius : 0);
    // The field the PSF taps and the site queries reach: the native raster plus the kernel radius and the query offsets.
    const queryReach = Math.max(0, ...queryOffsetsSites.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
    const reachMm = (kernelRadius + queryReach + 1) * pitch / 1000;
    const frameHalfMm = { x: nativeWidth * pitch / 2000, y: nativeHeight * pitch / 2000 }, extentMm = { x: frameHalfMm.x + reachMm, y: frameHalfMm.y + reachMm };
    const reachRadius = Math.hypot(extentMm.x, extentMm.y) / catalogue.halfDiagonalMm;
    const b = 1 - 2 ** (-character.character.vignetting.cornerStops / 2);
    if (!(b * reachRadius * reachRadius < 0.98))
      fail("lens.catalogue: the " + catalogue.name + "'s vignetting E(ρ) = (1 − bρ²)² is defined inside ρ < " + (1 / Math.sqrt(b)).toFixed(3) + " of the frame's half-diagonal, and this frame's PSF reach goes to ρ = " +
        reachRadius.toFixed(3) + ". Use a larger output (or smaller pixels' fewer sites of reach): the reach is " + (kernelRadius + queryReach + 1) + " sites beyond the frame.");
    vignetting = genericLensVignettingProfile(character.character.vignetting.cornerStops, catalogue.halfDiagonalMm, reachRadius);
    const corner = character.character.distortion.corner;
    distortion = { kind: "radial", profile: genericLensDistortionProfile(corner, catalogue.halfDiagonalMm, corner < 0 ? reachRadius / (1 + corner * reachRadius * reachRadius) * 1.01 : reachRadius) };
    lensFieldMapping = { projectionModel: projection ?? "rectilinear", distortion, radiometricAreaCorrection: "inverse-distortion-jacobian",
      ...(catalogue.kind === "fisheye" ? { outsideImageCircle: "backward-ray" as const } : {}) };
    try { prepareEnvironmentLensFieldMapping(lensFieldMapping); } catch (error) { fail("lens.catalogue: the " + catalogue.name + "'s distortion over this frame's reach: " + (error as Error).message); }
    const c = character.character;
    let psfReport: Record<string, unknown> | null = null;
    if (run !== "ideal-reference") {
      const built = createGenericLensPsfProfile({ lens: character, focusDistanceM, sitePitchMicrometers: pitch, fieldHalfExtentMm: extentMm, frameHalfMm, evidence: GENERIC_LENS_EVIDENCE,
        ...(extraKernel ? { extraKernel } : {}) });
      lensPsf = { kind: "sampled-local", configuration: { psf: { profile: built.profile, focalLengthMm, focus: { kind: "finite", distanceM: focusDistanceM }, apertureFNumber: fNumber,
        signedDefocusImagePlaneMicrometers: 0 }, psfWavelengthBasis: { value: "vacuum", evidence: GENERIC_LENS_EVIDENCE },
      spatialModel: { kind: "destination-local-shift-invariant-approximation", evidence: GENERIC_LENS_EVIDENCE,
        limitation: "Catalogue lens PSF: a 5 × 5 field grid × 5 wavelengths, interpolated with centroid alignment; each site's PSF is that of its own field point." } } } as typeof lensPsf;
      if (built.kernelRadiusSites > GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES)
        fail("lens.catalogue with lens.defocus needs a PSF of radius " + built.kernelRadiusSites + " sites (the lens's " + built.aberrationKernelRadiusSites + " plus the disc's " +
          (built.kernelRadiusSites - built.aberrationKernelRadiusSites) + "), over the limit of " + GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES + " (" + (2 * built.kernelRadiusSites + 1) ** 2 +
          " scene queries per site and spectral node through the environment quadrature). Bring the focus closer to the subject, stop down, or use larger pixels.");
      catalogueTaps = (2 * built.kernelRadiusSites + 1) ** 2; catalogueKernelRadius = built.kernelRadiusSites;
      psfReport = { aberrationKernelRadiusSites: built.aberrationKernelRadiusSites, kernelRadiusSites: built.kernelRadiusSites, maximumTruncatedEnergyFraction: built.maximumTruncatedEnergyFraction,
        fieldNodesMm: { x: built.fieldXmm, y: built.fieldYmm }, wavelengthNodesNm: built.wavelengthsNm, transformSize: built.transformSize, maximumPhaseStepWaves: built.maximumPhaseStepWaves };
    }
    assume("lens.catalogue.character", "model", { lensId: catalogue.lensId, fNumber, focusDistanceM, magnification: c.magnification, closeFocusGain: c.closeFocusGain, pupilScale: c.pupilScale,
      aberrationsWaves550: { ...c.aberrations }, lateralColor: { ...c.lateralColor }, distortionCorner: c.distortion.corner, vignettingCornerStops: c.vignetting.cornerStops,
      notRendered: { strayLight: { ...c.strayLight }, breathing: { ...c.breathing }, focusScatterDepthOfFocusFraction: c.focusScatterDepthOfFocusFraction, bokeh: "disc (#553)" },
      psf: psfReport, profiles: { vignetting, distortion: distortion.profile, maximumNormalizedRadius: reachRadius } },
    "The catalogue lens's character, a labelled approximation of a generic lens (docs/LENS_CATALOGUE.md): Seidel wave aberrations at the frame corner (spherical, balanced by defocus; coma; astigmatism; field curvature), " +
      "scaled from the widest aperture by the pupil ratio a = N0/N (a⁴, a³, a², a²) and by the close-focus factor; axial colour as a defocus and lateral colour as a radial shift, both with the normalised Cauchy dispersion. " +
      (run === "ideal-reference" ? "Not applied: the ideal reference has no camera effects. " :
        "Rendered as a sampled PSF (scalar Fraunhofer diffraction of the aberrated circular pupil, integrated over each site cell, on a 5 × 5 field grid × 5 wavelengths with centroid-aligned interpolation) " +
        "through the environment PSF quadrature (one scene query per kernel tap), with the lens's radial distortion (r_d = r·(1 + k1ρ²)) and relative illumination (E = (1 − bρ²)²) as lens field mapping and field throughput" +
        (catalogue.kind === "fisheye" ? ", and the equisolid projection; directions at or beyond 90° see no scene (zero radiance), so a circular fisheye's image ends at its 180° circle" : "") + ". ") +
      "Flare, focus breathing and bokeh shape are reported, not rendered; ρ is normalised to the frame's half-diagonal, so the lens is scaled to the simulated frame like lens.prime.");
  }
  // #492: the capture applies the disc as an object-space convolution, which needs every disc point a site sees to be another site's scene point.
  // #548: a lens field mapping, vignetting or camera rotation breaks that, so the capture then applies the disc in image space, on the sensor's
  // site lattice (defocus-image-space-provider.ts). #563: the display view reads the same geometry in any focus (display-view-lens-signal.ts).
  const imageSpaceOptions = [...(lensFieldMapping ? [lensOptions.distortion !== undefined ? (lensOptions.projection !== undefined ? "lens.projection, lens.distortion" : "lens.distortion") : "lens.projection"] : []),
    ...(vignetting ? ["lens.vignetting"] : []), ...(rotating ? ["camera rotation"] : [])];
  const lensGeometry = (defocusModel !== undefined || displayView) && imageSpaceOptions.length > 0 ? prepareDefocusImageSpaceGeometry({ focalLengthMm, focusDistanceM,
    angularVelocityRadPerSec: angular, ...(lensFieldMapping ? { lensMapping: prepareEnvironmentLensFieldMapping(lensFieldMapping) } : {}), ...(vignetting ? { vignetting } : {}) }) : undefined;
  const defocusGeometry = defocusModel !== undefined ? lensGeometry : undefined;
  // #553: the shaped kernel (on axis) and, with a cat's eye, its field zones; built when the disc is resolved out of focus.
  let bokehAxisKernel: DefocusBokehSiteKernel | undefined, bokehZones: DefocusBokehZonePlan | undefined;
  const bokehSummary = defocusBokeh === undefined ? undefined : (disc: ResolvedDefocusDisc): { value: Record<string, unknown>; explanation: string } => {
    const options = defocusBokeh!, side = subjectDistanceM > focusDistanceM ? 1 : -1;
    const build = (field?: { x: number; y: number }): DefocusBokehSiteKernel => {
      try {
        return createDefocusBokehSiteKernel({ diameterSites: disc.diameterSites, side, fNumber, focalLengthMm, pitchMicrometers: pitch, options, ...(field ? { field } : {}) });
      } catch (error) { const message = (error as Error).message; fail(message.startsWith("lens.defocus") ? message : "lens.defocus: " + message); }
    };
    const axis = build();
    bokehAxisKernel = axis;
    // The run convolution above 64 sites (#564) takes one kernel for the whole frame; the cat's eye needs one per field zone.
    if (options.catsEye && !displayView && axis.radius > DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES)
      fail("lens.defocus.catsEye: the blur needs a kernel radius of " + axis.radius + " sites; with a cat's eye the limit is " + DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES +
        " sites (129 across). Reduce the defocus or omit catsEye.");
    if (options.catsEye && !displayView) {
      // The field tangent of a native point (sites from the top-left corner), in output-image axes (+Y up): through the lens
      // mapping in image space (#548; at the exposure start, so camera rotation does not move the field), else the planar lattice's.
      const g = 2 / width, mmPerSite = pitch / 1000;
      const fieldOf = defocusGeometry ? (x: number, y: number): { x: number; y: number } => {
        const look = defocusGeometry.lookOf((x - nativeWidth / 2) * mmPerSite, (y - nativeHeight / 2) * mmPerSite, 0);
        return { x: look.x / look.z, y: look.y / look.z };
      } : (x: number, y: number): { x: number; y: number } => ({ x: (x - nativeWidth / 2) * g * metresPerFrameUnit / subjectDistanceM, y: -(y - nativeHeight / 2) * g * metresPerFrameUnit / subjectDistanceM });
      bokehZones = planDefocusBokehZones({ options, nativeWidth, nativeHeight, radius: axis.radius, fNumber, focalLengthMm, fieldOf, kernelAt: build });
      if (!(bokehZones.minimumOpenAreaRatio > 0)) fail("lens.defocus.catsEye: the clipping apertures close the pupil in part of the frame; reduce shiftPerTanFieldMm or enlarge radiusMm.");
    }
    const zones = bokehZones;
    return { value: { options, side: side === 1 ? "behind-focus" : "in-front-of-focus", kernelRadiusSites: axis.radius, method: axis.method, raySamples: axis.raySamples,
      sphericalAberrationSites: axis.sphericalAberrationSites, axisOpenAreaRatio: axis.openAreaRatio,
      ...(zones ? { catsEye: { execution: "piecewise-constant-field-zones", zoneSizeSites: zones.zones.size, columns: zones.zones.columns, rows: zones.zones.rows,
        minimumOpenAreaRatio: zones.minimumOpenAreaRatio, largestAdjacentOpenAreaRatioChange: zones.largestAdjacentOpenAreaRatioChange, lightLossApplied: false } } : {}) },
      explanation: "The kernel is shaped by the lens instead (#553, bokeh character; calculateDefocusBokehKernel): the projected open pupil " +
        (options.blades ? "(" + options.blades.count + " blades" + (options.blades.curvature > 0 ? ", curvature " + options.blades.curvature : "") +
          (options.blades.circularAtOrBelowFNumber !== null ? ", circular at or below f/" + options.blades.circularAtOrBelowFNumber : "") + ", scaled to the disc's area) " : "(a circle) ") +
        "of a point " + (side === 1 ? "behind" : "in front of") + " the focus plane" + (side === 1 ? "" : " (the pupil turned through 180°: the rays have not crossed yet)") +
        (options.sphericalAberration ? ", with primary spherical aberration W040 " + options.sphericalAberration.w040Micrometers + " µm at f/" + options.sphericalAberration.atFNumber +
          " (" + axis.sphericalAberrationSites + " sites at the marginal ray here; ray map (σc/2 + bρ²)·P, rays binned per site cell)" : " (exact polygon area in each site's cell)") +
        (zones ? ". Cat's eye: the pupil is clipped by " + options.catsEye!.apertures.length + " aperture(s) shifted by field position (calculateMechanicalVignetting's model), applied as " +
          zones.zones.columns + " × " + zones.zones.rows + " field zones of " + zones.zones.size + " sites, each with its centre's kernel (a piecewise-constant approximation; " +
          "the open-area ratio falls to " + formatBound(zones.minimumOpenAreaRatio) + " and changes by at most " + formatBound(zones.largestAdjacentOpenAreaRatioChange) +
          " between neighbouring zones). The kernel has unit sum: the light the clip removes is not applied; declare it with lens.vignetting" : "") +
        ". A geometric approximation: no diffraction, onion rings, higher-order or field-dependent aberrations; the same kernel at every wavelength. "
    };
  };
  const defocusDisc = defocusModel === undefined ? undefined :
    resolveDefocusOption({ run, assume, focalLengthMm, fNumber, focusDistanceM, subjectDistanceM, pitch, diffraction: diffractionRadiusOption !== undefined,
      ...(defocusBokeh ? { bokehOptions: defocusBokeh, bokeh: bokehSummary! } : {}),
      ...(defocusGeometry ? { imageSpace: (disc: ResolvedDefocusDisc): { options: readonly string[]; fieldVariation: DefocusFieldVariation } => {
        // Rotation with a rolling shutter: each row's instants differ, so one instant's image on the lattice would mix rows exposed at other times.
        if (rotating && shutterKind === "rolling") fail("simulateCapture does not support lens.defocus out of focus with camera rotation and motion.shutter \"rolling\": the disc is applied " +
          "to each temporal midpoint's image on the sensor lattice, and under a rolling shutter every row has its own instants, so each row would need its own image of the rows the disc " +
          "reaches (about 2R + 1 rows per row, R the kernel radius). Use motion.shutter \"global\", set lens.focusDistanceM equal to subjectDistanceM, or omit one of the options.");
        const temporalMidpointsSeconds = rotating ? Array.from({ length: temporalSampleCount }, (_, i) => (i + 0.5) * (shutterSeconds / temporalSampleCount)) : [];
        return { options: imageSpaceOptions, fieldVariation: calculateDefocusFieldVariation({ geometry: defocusGeometry, ...(lensFieldMapping ? { lensMapping: prepareEnvironmentLensFieldMapping(lensFieldMapping) } : {}),
          focalLengthMm, fNumber, focusDistanceM, subjectDistanceM, pitchMicrometers: pitch, nativeWidth, nativeHeight, angularVelocityRadPerSec: angular, temporalMidpointsSeconds,
          diameterSites: disc.diameterSites, discAt: (distanceM) => resolveDefocusDisc({ focalLengthMm, aperture: fNumber, focusDistanceM, subjectDistanceM: distanceM, pitchMicrometers: pitch }).diameterSites }) };
      } } : {}) });
  const defocusImageSpace = defocusDisc !== undefined && defocusGeometry !== undefined;
  // #492: the disc on the site lattice (radius 0 for a disc inside one cell: the identity, still applied).
  // #553: the shaped kernel replaces the disc (with a cat's eye, the axis kernel; the zones replace it in the gather).
  const defocusKernel = defocusDisc && !displayView ? bokehAxisKernel ?? createDefocusDiscSiteKernel(defocusDisc.diameterSites) ?? undefined : undefined;
  // The display view's disc (#492, step 2b): its expected-signal tables apply it (simulate-display-view.ts); #553: or the shaped kernel.
  const displayViewDefocus = displayView ? (defocusDisc && bokehAxisKernel ? { ...defocusDisc, siteKernel: bokehAxisKernel } : defocusDisc) : undefined;

  // Sensor readout for the ISO setting. Standard output sensitivity S = 10/H (CIPA DC-004 §3.2) is defined at the
  // output, independent of pixel size, while the collected charge is proportional to the sensitive-aperture area
  // (EMVA 1288 Release 4.0, Eq. 3). The tier's signal chain is anchored to the 6 µm aperture; at another area the
  // charge-domain readout scales with the area so the same H gives the same code. At 6 µm nothing is changed.
  const areaScale = pitch * pitch / ISO_REFERENCE_APERTURE_AREA_SQUARE_MICROMETERS;
  const regimeByChannel = {} as Record<Channel, { readoutProfile: ReadoutProfile; regimeId: string }>;
  for (const channel of CHANNELS) {
    const asset = body.readout.find((a) => a.profile.channelId === channel) ?? fail("Camera readout lacks channel " + channel + ".");
    const chain = resolveGenericIsoSignalChain({ profile: body.signalChain, isoCapability: body.iso, requestedIsoSetting: { kind: "standard", exposureIndex: resolvedIso },
      captureModeId: IDS.mode, readoutProfile: asset.profile });
    regimeByChannel[channel] = { readoutProfile: areaScale === 1 ? asset.profile : isoAreaScaledReadout(asset.profile, areaScale), regimeId: chain.readout.regime.regimeId };
  }
  const capacityRegimes = (areaScale === 1 ? body.readout[0]!.profile : isoAreaScaledReadout(body.readout[0]!.profile, areaScale)).regimes;
  const baseRegime = capacityRegimes[0]! as unknown as { preAdcSaturationElectronEquivalent: { value: number } };
  const capacityElectrons = Math.max(...capacityRegimes.map((r) => (r as unknown as { preAdcSaturationElectronEquivalent: { value: number } }).preAdcSaturationElectronEquivalent.value),
    baseRegime.preAdcSaturationElectronEquivalent.value);
  assume("sensor.capacityElectrons", "derived", capacityElectrons, "Physical charge capacity set to the body's largest declared pre-ADC saturation (its base-ISO saturation signal), so storage never clips before the declared readout white.");
  if (areaScale !== 1) {
    assume("sensor.isoAreaNormalization", "model", { referenceApertureAreaSquareMicrometers: ISO_REFERENCE_APERTURE_AREA_SQUARE_MICROMETERS,
      apertureAreaSquareMicrometers: pitch * pitch, areaScale },
    "Approximation. The tier's ISO signal chain is declared for a 6 µm square aperture. Standard output sensitivity S = 10/H (CIPA DC-004-2020 §3.2) is defined at the output, " +
      "independent of pixel size, and the collected charge is proportional to the aperture area (EMVA 1288 Release 4.0, Eq. 3), so the system conversion gain (e⁻ per code) and the " +
      "pre-ADC saturation of every ISO regime are multiplied by area / 36 µm² = " + areaScale + ". The same exposure gives the same output code at any pitch; per-pixel shot-noise SNR " +
      "falls with smaller pixels. Read noise and dark current stay per pixel in electrons. The charge capacity follows the scaled base-ISO saturation, so it is proportional to " +
      "the aperture area: a design consequence of holding the tier's ISO rating and highlight headroom fixed, not a measured full-well model (published sensor data grow less than " +
      "proportionally with area across technologies).");
  }
  // Whole-frame views (2.5): a pitch above 100 µm is larger than any camera photosite, so the capture is a downsized view of a frame width × pitch wide.
  if (pitch > SIMULATE_CAPTURE_PHOTOSITE_PITCH_MAXIMUM_MICROMETERS) {
    assume("sensor.wholeFrameView", "model", { pixelPitchMicrometers: pitch, frameWidthMm: width * pitch / 1000, frameHeightMm: height * pitch / 1000 },
      "A pixel pitch above 100 µm is larger than any camera photosite, so each output pixel stands for a " + pitch + " µm square of a " + width * pitch / 1000 + " × " + height * pitch / 1000 +
      " mm frame: a downsized view of the whole frame, with the framing, crop factor, generic prime and minimum focus of that frame. Its signal is the charge of the whole square " +
      "(sensor.isoAreaNormalization), so its shot noise is that of all the real photosites in the square summed or averaged (Poisson counts add), and the image brightness is the " +
      "same as at any other pitch. Read noise and dark current are applied once per output pixel, not once per real photosite, so in deep shadows the noise is lower than a real " +
      "sensor's binned output. This is the noise of a binned, downsized view, not the real sensor's per-pixel noise. A point pixel aperture samples one point of each square; " +
      "use sensor.pixelAperture box (or sensor.antiAliasing) to average scene detail finer than the pitch.");
  }
  assume("sensor.darkCurrent", "model", { electronsPerSecond: DARK_CURRENT_ELECTRONS_PER_SECOND, temperatureC: OPERATING_TEMPERATURE_C },
    "Synthetic uniform dark current of 1 e⁻/s per site at 20 °C (the tier presets declare none); dark shot noise follows from it.");
  assume("sensor.spectralResponse", "model", { kind: "colorimetric-cmf-eqe", peakScale: EQE_SCALE },
    "Idealized colorimetric sensor: channel EQE = a·{x̄, ȳ, z̄}(λ)·555/λ (the engine's analytic CIE 1931 fit), so RAW channels are proportional to CIE XYZ (Luther–Ives) and the camera matrix is diagonal. Not a real camera's response; CMF air wavelengths are used as vacuum wavelengths (difference about 0.03 %).");
  if (boxAperture) {
    assume("sensor.pixelAperture", "model", { kind: "box", samplesPerAxis: boxSamples, fillFactor: 1 },
      "Each site integrates the irradiance uniformly over its square photosite (fill factor 1; the environment's uniform geometric-aperture response) with a " + boxSamples + " × " + boxSamples +
      " midpoint rule (spatialSampleCountX/Y). The ideal box aperture of width p has the pixel MTF |sinc(f·p)| = |sin(πfp)/(πfp)|; the midpoint rule gives |sin(πfp)/(N·sin(πfp/N))| " +
      "instead, within 3 % of it below the Nyquist frequency 1/(2p) for N ≥ 4, with the same zeros at multiples of 1/p except at multiples of N/p, where scene detail still aliases. " +
      "No microlens, carrier diffusion or crosstalk. The scene queries are multiplied by " + boxSamples * boxSamples + ".");
  }
  if (!antiAliasing) assume("sensor.fillFactor", "model", 1, "Square sensitive aperture equal to the pixel pitch; no microlens or anti-aliasing filter.");
  else {
    assume("sensor.fillFactor", "model", 1, "Square sensitive aperture equal to the pixel pitch; no microlens.");
    assume("sensor.antiAliasing", "model", { kind: antiAliasing.kind, ...(antiAliasing.axis ? { axis: antiAliasing.axis } : {}),
      ...(antiAliasing.separationSites === undefined ? {} : { separationSites: antiAliasing.separationSites, separationMicrometers: antiAliasing.separationSites * pitch }),
      components: antiAliasing.components },
      "Optical low-pass (anti-aliasing) filter as a normalized point-splitting kernel in the sensor optical stack (resolveAntiAliasingSpatialKernel): every site integrates the light that would " +
      "otherwise land at its centre minus each offset, weighted. " + (antiAliasing.kind === "point-splitting" ? "Caller-declared components. " :
        "This is the ideal birefringent " + (antiAliasing.kind === "four-spot" ? "two-plate (crossed) splitter: four equal spots at (±d/2, ±d/2), MTF |cos(π·f_x·d)·cos(π·f_y·d)|" :
          "single-plate splitter: two equal spots at ±d/2 along the " + antiAliasing.axis + " axis, MTF |cos(π·f·d)|") + ", d = " + antiAliasing.separationSites + " site(s); first zero at f = 1/(2d). ") +
      "Approximations: the split is the same at every wavelength, field point and polarization (birefringence dispersion and the thickness-dependent displacement are not modelled), the spots are exact points with equal weights for unpolarized light, " +
      "and the filter's transmission, reflections and focus shift are not modelled. Not a measured filter; the tier presets declare none. The scene queries are multiplied by " + antiAliasing.components.length + ".");
  }
  // Shutter (2.0): the electronic rolling-shutter schedule derived from the body's rolling readout declaration.
  let rollingSchedule: ElectronicRollingShutterExposureSchedule | undefined;
  if (shutterKind === "rolling") {
    const declared = (body as { rollingReadoutTiming?: { profile: unknown } }).rollingReadoutTiming?.profile as Parameters<typeof resolveElectronicRollingShutterExposureSchedule>[0]["readout"] | undefined;
    if (!declared || declared.readoutMode !== "rolling") fail("motion.shutter \"rolling\" needs a camera body with a rolling readout timing declaration.");
    const readout = rollingSkewOption === undefined ? declared : { ...declared, spatialSamplingSkewSeconds: { value: rollingSkewOption, unit: "s" as const, evidence: FACADE_EVIDENCE } };
    rollingSchedule = resolveElectronicRollingShutterExposureSchedule({ readout, linkageEvidence: FACADE_EVIDENCE,
      nominalExposureDurationSeconds: { value: shutterSeconds, unit: "s", evidence: FACADE_EVIDENCE } });
    assume("sensor.shutter", "model", { kind: "electronic-rolling", modelId: rollingSchedule.modelId, modelVersion: rollingSchedule.modelVersion,
      lineScanSkewSeconds: rollingSchedule.lineScanSkewSeconds, scanDirection: readout.scanDirectionNative.value },
      "Electronic rolling shutter (line reset/read linkage): a site at normalized scan position s integrates over [s·τ, s·τ + T]. " +
      (rollingSkewOption === undefined ? "τ is the body's declared full-frame data-readout skew, applied unchanged across the simulated frame (it is not scaled to the cropped sensor), so a small frame shows the skew of a full-sensor readout." :
        "τ is the caller-declared skew across the simulated frame."));
  } else assume("sensor.shutter", "model", "global-electronic", "Global electronic shutter: every site integrates the same exposure window.");
  if (rotating) assume("motion.angularVelocityRadPerSec", "model", { ...angular },
    "Constant camera angular velocity applied to every scene ray at each temporal midpoint of each site's exposure window (engine rotation convention, docs/SENSOR_ENVIRONMENT_QUERY.md); motion blur is the midpoint quadrature over sensor.temporalSampleCount samples.");
  if (catalogue) assume("lens.psf", "model", lensPsf ? { kind: "sampled-local", source: "lens.catalogue" } : "not-applied", lensPsf ?
    "The catalogue lens's engine-built sampled PSF (see lens.catalogue.character) redistributes irradiance through the environment PSF quadrature." : "No lens PSF: the ideal reference has no camera effects.");
  else if (lensPsf) assume("lens.psf", "model", { kind: "sampled-local" }, "Caller-supplied sampled lens PSF redistributes irradiance through the environment PSF quadrature; its evidence and limits are the caller's.");
  // With lens.diffraction the PSF is recorded as lens.diffraction once its kernels are built.
  else if (diffractionRadiusOption === undefined) assume("lens.psf", "model", "not-applied", "No lens PSF or diffraction blur is applied (point optics); the generic tiers' optical data are declared only at f/4.");
  assume("lens.transmission", "model", lens.matchedReference.transmission,
    "The tier lens's spectrally flat transmission is used at every f-number and focus in the lens capability; the tier declares it only at its f/4, 5 m reference state.");
  if (!vignetting && !lensFieldMapping) assume("lens.fieldThroughput", "model", "unity", "No vignetting, distortion, lateral colour or stray light.");
  else {
    if (vignetting) assume("lens.vignetting", "model", { kind: "radial-illumination-vignetting", profile: vignetting },
      (catalogue ? "The catalogue lens's" : "Caller-declared") + " radial relative illumination 1 + r2·ρ² + r4·ρ⁴ + r6·ρ⁶, applied once as environment field throughput at the physical sensor point before any PSF.");
    else assume("lens.fieldThroughput", "model", "unity", "No vignetting, lateral colour or stray light.");
    if (distortion) assume("lens.distortion", "model", distortion,
      (catalogue ? "The catalogue lens's " : "Caller-declared ") + distortion.kind + " distortion: each sensor point is inverse-distorted before the scene-ray query and irradiance is multiplied exactly once by the area factor 1/det(J).");
  }
  if (projection === undefined) assume("lens.projection", "default", "rectilinear", "Ideal rectilinear (pinhole) projection.");
  else assume("lens.projection", "model", projection, "Ideal " + projection + " projection through the environment lens field mapping. At finite focus its scale is the thin-lens image distance (an approximation); the chart is still sized with the rectilinear thin-lens scale, so its edges move with the projection.");

  // White balance
  let whiteBalanceState: ResolvedWhiteBalanceState | null = null, needsAuto = false, kelvinWhiteBalanceInput: Parameters<typeof resolveColorTemperatureWhiteBalance>[0] | undefined;
  if (whiteBalanceOption === "none") whiteBalanceState = null;
  else if (whiteBalanceOption === "auto") {
    if (region) fail("output.region cannot be combined with output.whiteBalance \"auto\": grey-world statistics of a region differ from the whole frame's.");
    needsAuto = true;
  }
  else if (whiteBalanceOption === "scene-illuminant") whiteBalanceState = sceneIlluminantWhiteBalance(illuminant);
  else if (typeof whiteBalanceOption === "object" && whiteBalanceOption !== null && "kelvin" in whiteBalanceOption) {
    const wb = allowKeys(whiteBalanceOption, "output.whiteBalance", ["kelvin", "tint"]);
    const intent = createColorTemperatureWhiteBalanceIntent({ intentId: "facade-wb-cct", colorTemperatureKelvin: positive(wb.kelvin, "output.whiteBalance.kelvin"),
      tint: wb.tint === undefined ? 0 : wb.tint as number });
    const kelvinInput: Parameters<typeof resolveColorTemperatureWhiteBalance>[0] = { stateId: "facade-wb-cct", intent, whiteLocus: "planckian", tintInterpretation: "duv-cie-1960-uv",
      camera: { profileId: IDS.spectral, profileVersion: SIMULATE_CAPTURE_FACADE_VERSION, xyzToCameraRgb: XYZ_TO_CAMERA.map((r) => [...r]) as unknown as Parameters<typeof resolveColorTemperatureWhiteBalance>[0]["camera"]["xyzToCameraRgb"] } };
    whiteBalanceState = resolveColorTemperatureWhiteBalance(kelvinInput);
    kelvinWhiteBalanceInput = kelvinInput;
  } else if (typeof whiteBalanceOption === "object" && whiteBalanceOption !== null && "channelGains" in whiteBalanceOption) {
    allowKeys(whiteBalanceOption, "output.whiteBalance", ["channelGains"]);
    requireInputObject(whiteBalanceOption.channelGains, "output.whiteBalance.channelGains");
    allowKeys(whiteBalanceOption.channelGains, "output.whiteBalance.channelGains", ["red", "green", "blue"]);
    whiteBalanceState = resolveManualWhiteBalance({ stateId: "facade-wb-manual", channelGains: whiteBalanceOption.channelGains });
  } else fail("Unknown output.whiteBalance.");
  const intentOf = (state: ResolvedWhiteBalanceState | null): CaptureWhiteBalanceIntent | null => (state ? createCaptureWhiteBalanceIntent({ state }) : null);

  const rendering: SdrRenderingProfile = { schemaVersion: "0.1.0", profileId: "facade-sdr", profileVersion: "1", renderingExposureEv: 0, toneCurve,
    ...(outputOptions.toneCurveParameters === undefined ? {} : { toneCurveParameters: outputOptions.toneCurveParameters as SdrToneCurveParameters }),
    gamutHandling: "clip-components", outputDynamicRange: "sdr", transferFunction: "srgb", bitDepth: format === "srgb-16" || (format === "png" && !wideGamut && pngBitDepth === 16) ? 16 : 8, rounding: "nearest-ties-up", dither: "none" };
  if (!linearPath) assume("output.rendering", "model", { renderingExposureEv: 0, gamutHandling: "clip-components" },
    exposureGain === 1 ? "Developed linear sRGB/D65 with the RAW white level mapped to display white, no exposure push, out-of-gamut components clipped." :
      "Developed linear sRGB/D65 with the RAW white level mapped to display white, no further exposure push after development (output.exposureCompensationStops acts on the RAW), out-of-gamut components clipped.");
  else assume("output.rendering", "model", { renderingExposureEv: 0, gamutHandling: "clip-components-in-target-gamut", sdrRendererUsed: false },
    "The sRGB SDR renderer is not used: the linear development (RAW white level = relative 1.0, " + (exposureGain === 1 ? "no exposure push" : "after the development exposure push on the RAW") + ") is converted to the target encoding; request.development.rendering is validated but only its exposure and tone curve (identity) apply.");
  // Rendering choices are validated before any radiance work, so a bad tone curve fails fast.
  parseSdrRenderingProfile(rendering);
  if (highlightMode !== "clip" && highlightMode !== "reconstruct") fail("output.highlightMode must be clip or reconstruct.");

  // Frame profiles
  const evidence = FACADE_EVIDENCE;
  const nativeRaster = { pixelWidth: nativeWidth, pixelHeight: nativeHeight };
  const captureModeProfile = { schemaVersion: "0.1.0" as const, modes: [{ modeId: IDS.mode, evidence, acquisition: { kind: "single-frame" as const },
    perFrameSampling: { kind: "native-effective-raster" as const }, reconstructionStages: [], processedImageRaster: { value: nativeRaster, evidence },
    dependencies: ["color-sampling-model"] }] } as unknown as NativeRawInput["captureModeProfile"];
  const bindingProfile = { schemaVersion: "0.1.0" as const, bindingId: IDS.binding, colorSamplingProfileId: IDS.cfa, nativeRaster, evidence,
    relationship: { kind: "regular-native-effective-sample-blocks" as const, sitesPerNativeSampleX: 1, sitesPerNativeSampleY: 1, anchor: "shared-native-top-left" as const } };
  const exposureWindow = rollingSchedule ? createRollingShutterCaptureExposureSchedule(rollingSchedule) as unknown as {
    shutterMechanism: "electronic"; nominalExposureDurationSeconds: { value: number; unit: "s"; evidence: readonly EvidenceProvenance[] };
    opening: { kind: "simultaneous" }; closing: { kind: "simultaneous" } } :
    { shutterMechanism: "electronic" as const, nominalExposureDurationSeconds: { value: shutterSeconds, unit: "s" as const, evidence },
      opening: { kind: "simultaneous" as const }, closing: { kind: "simultaneous" as const } };
  const buildRawInput = (intent: CaptureWhiteBalanceIntent | null): NativeRawInput => buildRawInputFor(intent, geometry, captureModeProfile, bindingProfile, nativeWidth * nativeHeight);
  const buildRawInputFor = (intent: CaptureWhiteBalanceIntent | null, rasterGeometry: typeof geometry, modeProfile: NativeRawInput["captureModeProfile"],
    binding: NativeRawInput["bindingProfile"], sites: number): NativeRawInput => ({
    exposure: { captureId: IDS.capture, sceneStateId: IDS.sceneState, sceneTimeSeconds: 0, geometry: rasterGeometry,
      exposure: { focalLengthMm, aperture: fNumber, shutterSeconds, iso: resolvedIso }, focus: { kind: "finite", distanceM: focusDistanceM },
      noise: { seedUint32: noiseSeed, realizationId: "facade-noise", model: { ...SENSOR_RAW_PRODUCER_NOISE_MODEL } },
      source: { kind: "scene-radiance-source", artifactId: "facade-scene-" + scenePreset, sha256: sourceSha256, dynamicRangeHistory: "no-loss-declared" },
      whiteBalanceIntent: intent, adoptedWhiteXyz: null,
      models: [{ profile: { id: "photivra-simulate-capture", version: SIMULATE_CAPTURE_FACADE_VERSION }, scientificStatus: "approximation", publicEvidenceIds: ["photivra:simulate-capture-facade"] }] },
    frameId: IDS.frame, modeId: IDS.mode, captureModeProfile: modeProfile, colorSamplingProfile, bindingProfile: binding, exposureWindow,
    maximumOutputBytes: sites * 7, tileWidth, ...(raisedPixels === undefined ? {} : { maximumPixels: raisedPixels }) });
  const sceneBinding = { sceneStateId: IDS.sceneState, providerSceneId: IDS.scene, evidence };

  // Shared per-site environment pieces (identical objects for every site keep the native task's shared-state fast path).
  const range = { ...FACADE_SPECTRAL_RANGE_NANOMETERS };
  // EQE breakpoints coincide with the quadrature subintervals, so the quadrature is not split further.
  const eqeSpacing = (range.maximum - range.minimum) / Math.ceil((range.maximum - range.minimum) / spectralStep);
  const eqeSamples = (channel: Channel): { nm: number; value: number }[] => {
    const out: { nm: number; value: number }[] = [];
    for (let nm = range.minimum; nm <= range.maximum + 1e-9; nm += eqeSpacing) out.push({ nm, value: EQE_SCALE[channel] * estimateCie1931ColorMatchingFunctions(nm)[CMF_KEY[channel]] * 555 / nm });
    return out;
  };
  const operatingConditions = { temperatureC: 25, incidenceAngleDegreesFromNormal: 0, polarization: "unpolarized" as const };
  // One single-channel response profile per CFA channel keeps each site's response data small.
  const spectralResponseProfiles = Object.fromEntries(CHANNELS.map((only) => [only, { schemaVersion: "0.1.0" as const, profileId: IDS.spectral, colorSamplingProfileId: IDS.cfa, evidence,
    channels: [only].map((channelId) => ({ channelId, kind: "effective-external-quantum-efficiency" as const, responseScope: "sensor-package-incident-effective-channel-response" as const,
      scientificStatus: "approximation" as const, uncertainty: { kind: "not-quantified" as const, limitation: "Idealized colorimetric response; not a measured sensor." },
      evidence, referenceConditions: operatingConditions, conditionDependence: "not-modeled" as const, externalQuantumEfficiency: sampled(eqeSamples(channelId)) })) }])) as Record<Channel, unknown>;
  const apertureArea = pitch * pitch;
  const samplingApertureProfile = { schemaVersion: "0.1.0" as const, profileId: IDS.sampling, colorSamplingProfileId: IDS.cfa, colorSamplingBindingId: IDS.binding, evidence,
    siteCenterLattice: { kind: "regular-rectangular-site-center-lattice" as const, coordinateSystem: "native-sensor-physical" as const, pitchXMicrometers: pitch, pitchYMicrometers: pitch,
      firstSiteCenterFromImagingAreaTopLeftMicrometers: { x: pitch / 2, y: pitch / 2 }, evidence },
    geometricSensitiveAperture: { kind: "uniform-axis-aligned-rectangle" as const, widthMicrometers: pitch, heightMicrometers: pitch, centerOffsetFromSiteCenterMicrometers: { x: 0, y: 0 }, evidence } };
  const stackId = antiAliasing ? IDS.stackAa : IDS.stack;
  const opticalStackProfile: SensorOpticalStackProfile = antiAliasing ? { schemaVersion: "0.1.0", profileId: stackId, evidence, effectiveAntiAliasingSpatialResponse: {
    kind: "normalized-point-splitting-kernel", evidence, coordinateSystem: "native-sensor-physical", scope: "field-wavelength-polarization-invariant-approximation",
    components: antiAliasing.components } } : { schemaVersion: "0.1.0" as const, profileId: IDS.stack, evidence, effectiveAntiAliasingSpatialResponse: { kind: "absent" as const, evidence } };
  const perChannel = Object.fromEntries(CHANNELS.map((channelId) => [channelId, {
    applicationProfile: { schemaVersion: "0.1.0" as const, profileId: "facade-application-" + channelId, spectralResponseProfileId: IDS.spectral, colorSamplingProfileId: IDS.cfa, channelId,
      samplingApertureProfileId: IDS.sampling, opticalStackProfileId: stackId, evidence, incidentAreaBasis: { kind: "geometric-sensitive-aperture" as const, areaSquareMicrometers: apertureArea },
      spatialResponseModel: { kind: "uniform-over-geometric-sensitive-aperture" as const, scientificStatus: "approximation" as const, evidence, limitation: "Uniform response over the square aperture." },
      referenceConditionPolicy: { kind: "exact-match-required" as const } },
    operatingRangeProfile: { schemaVersion: "0.1.0" as const, profileId: "facade-linearity-" + channelId, responseApplicationProfileId: "facade-application-" + channelId,
      spectralResponseProfileId: IDS.spectral, colorSamplingProfileId: IDS.cfa, channelId, scientificStatus: "approximation" as const,
      uncertainty: { kind: "not-quantified" as const, limitation: "Declared linear photo response for the idealized sensor." }, evidence,
      inputRange: { kind: "wavelength-integrated-geometric-aperture-radiant-power" as const, unit: "W" as const, minimumInclusive: 0, maximumInclusive: 1 },
      wavelengthApplicability: { wavelengthBasis: "vacuum" as const, minimumNanometers: range.minimum, maximumNanometers: range.maximum, containment: "requested-range-must-be-contained" as const },
      linearityCriterion: { maximumAbsoluteRelativeDeviation: 0.01 },
      spatialLinearityModel: { kind: "linear-superposition-over-geometric-aperture" as const, scientificStatus: "approximation" as const, evidence, limitation: "Declared linear superposition." },
      spectralInputModel: { kind: "per-spectral-bin" as const, maximumBinWidthNanometers: Math.max(spectralStep, 20), scientificStatus: "approximation" as const, evidence, limitation: "Declared per-bin linearity." },
      referenceConditions: operatingConditions, referenceConditionPolicy: { kind: "exact-match-required" as const } } }])) as Record<Channel, { applicationProfile: unknown; operatingRangeProfile: unknown }>;
  const sourcePlane = { value: "sensor-package-incident" as const, evidence };
  const localExposure = { bindingProfile, exposureWindowInput: { ...exposureWindow, nativeRaster } };
  const sceneBindings = {
    illuminationProfile: { schemaVersion: "0.1.0" as const, profileId: IDS.lights, sceneId: IDS.scene, evidence, sources: [{ sourceId: "illuminant", family: "environment" as const,
      enabled: true, geometry: { kind: "environment" as const }, magnitude: { kind: "relative-linear-scale" as const, scale: 1, scientificStatus: "approximation" as const,
        limitation: "Absolute level is carried by the provider radiance (" + illuminanceLux + " lux)." },
      spectrum: { kind: "unresolved" as const, limitation: "Spectral radiance is supplied numerically by the provider (" + illuminant.id + ")." },
      temporalBehavior: { kind: "time-invariant" as const }, evidence }] },
    materialResponseProfile: { schemaVersion: "0.1.0" as const, profileId: IDS.materials, sceneId: IDS.scene, evidence, materials: [{ materialResponseId: "facade-surface", evidence,
      representation: { kind: "spectral-wavelength-preserving-data" as const, dataArtifact: { id: "facade-scene-" + scenePreset, checksumSha256: sourceSha256 },
        wavelengthBasis: "vacuum" as const, wavelengthRangeNanometers: range, scatteringModel: "provider-defined-wavelength-preserving" as const, scientificStatus: "approximation" as const,
        uncertainty: { kind: "not-quantified" as const, limitation: "Analytic Lambertian reflectance." }, wavelengthChangingBehaviorModeled: false, emissionModeled: false } }],
      fluorescenceModeled: false, volumetricMaterialTransportModeled: false, polarizationModeled: false },
    providerProfile: { schemaVersion: "0.1.0" as const, profileId: IDS.provider, sceneId: IDS.scene, illuminationProfileId: IDS.lights, materialResponseProfileId: IDS.materials,
      outputQuantity: "outgoing-spectral-radiance" as const, outputUnit: "W/m^2/sr/nm" as const, scientificStatus: "approximation" as const,
      uncertainty: { kind: "not-quantified" as const, limitation: "Analytic planar scene." },
      fidelity: { spectral: "wavelength-resolved" as const, material: "spectral-data" as const, visibility: "resolved" as const, directTransport: "approximation" as const, indirectTransport: "not-modeled" as const },
      wavelengthChangingTransportModeled: false, volumetricTransportModeled: false, polarizationModeled: false, evidence, limitations: ["Engine-authored planar chart or caller scene function.",
        ...(diffractionObjectSpace ? ["Radiance is the scene radiance convolved with the lens diffraction PSF mapped onto the scene plane (object-space convolution, request.diffraction)."] : []),
        ...(defocusKernel ? [defocusImageSpace ? "Radiance is the sensor-plane irradiance before any PSF convolved with the geometric defocus disc on the sensor's site lattice, divided by " +
          "the queried point's field factor (image-space convolution, lens.defocus)." : "Radiance is the scene radiance convolved with the geometric defocus disc mapped onto the scene plane (object-space convolution, lens.defocus)."] : [])] } };
  const lensId = lensExposure.profileId;
  const opticsProfile = { schemaVersion: "0.1.0" as const, profileId: lensId + ":facade-transmission", profileVersion: SIMULATE_CAPTURE_FACADE_VERSION, lensProfileId: lensId,
    scientificStatus: "approximation" as const, applicability: { focalLengthMm: { minimum: capabilities.selectedFocalLengthMm, maximum: capabilities.selectedFocalLengthMm },
      nominalFNumber: { minimum: capabilities.aperture.widestAvailableFNumber, maximum: capabilities.aperture.narrowestAvailableFNumber }, focus: { kind: "any" as const } },
    transmission: { kind: "spectral-transmission" as const, scientificStatus: "approximation" as const, wavelengthBasis: "vacuum" as const,
      samples: { value: [{ wavelengthNanometers: range.minimum, linearTransmissionFactor: lens.matchedReference.transmission },
        { wavelengthNanometers: range.maximum, linearTransmissionFactor: lens.matchedReference.transmission }], evidence: preset.evidence },
      uncertainty: { kind: "not-quantified" as const, limitation: "Synthetic spectrally flat transmission from the tier preset." } },
    distortionAreaMappingOwnership: "not-applied-by-bridge" as const, psfRedistributionOwnership: "downstream-normalized-energy-redistribution" as const,
    sensorOpticalStackIncluded: false, strayLightIncluded: false, polarizationModeled: false, wavelengthChangingBehaviorModeled: false, volumetricScatteringModeled: false,
    evidence: preset.evidence, limitations: [...lens.limitations, "Flat transmission applied across the lens capability by the capture facade."] };
  const optics = { profile: opticsProfile, focalLengthMm, nominalFNumber: fNumber,
    focus: { kind: "ideal-symmetric-thin-lens" as const, objectDistanceM: focusDistanceM, pupilMagnificationAssumption: "unity" as const } };
  const motion = { angularVelocityRadPerSec: angular, timeReference: "first-opening-boundary-phase" as const, environmentDirectionConvention: "outgoing-radiance-toward-camera" as const };
  const fieldThroughput = vignetting ? { kind: "radial-illumination-vignetting" as const, profile: vignetting, evidence,
    limitation: "Caller-declared radial relative illumination applied by the capture facade; not a measured lens." } :
    { kind: "unity" as const, evidence, limitation: "No vignetting or field throughput loss applied by the facade." };
  const spectralSamplingByChannel = Object.fromEntries(CHANNELS.map((channelId) => [channelId, { channelId, wavelengthBasis: "vacuum" as const, wavelengthRangeNanometers: range,
    maximumSubintervalWidthNanometers: spectralStep }])) as Record<Channel, unknown>;
  // Diffraction (2.1): Airy kernels at the resolved f-number on the site pitch, one per spectral node of the sensor quadrature.
  let diffraction: DiffractionLimitedPsfProfile | undefined, diffractionPsf: typeof lensPsf | undefined;
  // The spectral nodes of the sensor quadrature, over all channels, ascending.
  const quadratureWavelengths = (): number[] => [...new Set(CHANNELS.flatMap((channelId) => calculateSensorSpectralQuadrature({ ...(spectralSamplingByChannel[channelId] as { channelId: string;
      wavelengthBasis: "vacuum"; wavelengthRangeNanometers: { minimum: number; maximum: number }; maximumSubintervalWidthNanometers: number }), colorSamplingProfile,
    spectralResponseProfile: spectralResponseProfiles[channelId] as never }).value.nodes.map((node) => node.wavelengthNanometers)))].sort((a, b) => a - b);
  if (diffractionRadiusOption !== undefined) {
    const wavelengths = quadratureWavelengths();
    const lambdaN = wavelengths[wavelengths.length - 1]! / 1000 * fNumber * imageDistanceMm / focalLengthMm;
    // The environment resolves the PSF at each pre-filter source point, up to the largest split offset outside the imaging area.
    const aaReachMm = antiAliasing ? Math.max(...antiAliasing.components.map((c) => Math.max(Math.abs(c.offsetMicrometers.x), Math.abs(c.offsetMicrometers.y)))) / 1000 : 0;
    // The default reach is capped at the 32-site convolution limit; a capped window ends inside the third dark ring, and the
    // larger tail energy outside it is listed per wavelength like any other (2.2.1 states the cap in the explanation).
    const thirdRingSites = Math.max(1, Math.ceil(AIRY_THIRD_ZERO_PER_LAMBDA_N * lambdaN / pitch));
    const kernelRadiusSamples = diffractionRadiusOption ?? Math.min(32, thirdRingSites);
    const profileInput = { aperture: "circular" as const, focalLengthMm, apertureFNumber: fNumber, focus: { kind: "finite" as const, distanceM: focusDistanceM },
      wavelengthsNm: wavelengths, samplePitchMicrometers: pitch, kernelRadiusSamples, fieldHalfExtentMm: aaReachMm === 0 ? { x: imagingArea.widthMm / 2, y: imagingArea.heightMm / 2 } :
        { x: imagingArea.widthMm / 2 + aaReachMm, y: imagingArea.heightMm / 2 + aaReachMm },
      profileId: "facade-diffraction-airy" };
    // #449: a copy of the profile kept for this input; it equals createDiffractionLimitedPsfProfile(profileInput).value field by
    // field, so the registration below (keyed by profileInput) holds for it.
    diffraction = cachedDiffractionProfile(profileInput);
    diffractionPsf = { kind: "sampled-local", configuration: { psf: { profile: diffraction.profile, focalLengthMm, focus: { kind: "finite", distanceM: focusDistanceM },
      apertureFNumber: fNumber, signedDefocusImagePlaneMicrometers: 0 }, psfWavelengthBasis: { value: "vacuum", evidence },
    spatialModel: { kind: "destination-local-shift-invariant-approximation", evidence, limitation: "Diffraction-limited Airy PSF, the same at every field point." } } };
    // Requests with the same profile input and PSF fields share their site diffraction kernels (optics/site-diffraction-kernel.ts).
    registerDiffractionPsfKey(diffractionPsf.configuration.psf, profileInput);
    assume("lens.diffraction", "model", { model: diffraction.model, aperture: "circular-aperture", fNumber, workingFNumber: diffraction.workingFNumber,
      kernelRadiusSamples, samplePitchMicrometers: pitch, maximumTruncatedEnergyFraction: diffraction.maximumTruncatedEnergyFraction,
      truncatedEnergyByWavelength: diffraction.wavelengths.map((w) => ({ wavelengthNm: w.wavelengthNm, truncatedEnergyFraction: w.truncatedEnergyFraction })),
      execution: diffractionObjectSpace ? "object-space-convolution" : defocusImageSpace ? "image-space-convolution" : "environment-psf-quadrature" },
      "Scalar Fraunhofer diffraction of an ideal, aberration-free circular pupil (Airy pattern, createDiffractionLimitedPsfProfile) at the resolved f-number, in focus, with D = f/N and the thin-lens image distance (working f-number N·v/f). " +
      "One kernel per spectral node, binned into site-sized cells over a " + (2 * kernelRadiusSamples + 1) + " × " + (2 * kernelRadiusSamples + 1) + " window" +
      (diffractionRadiusOption !== null ? "" : thirdRingSites > 32 ? " (capped at 32 sites; the third dark ring at the longest node needs " + thirdRingSites + ")" :
        " (reaching the third dark ring at the longest node)") + "; the Airy tail energy outside it (listed per wavelength) is put back by unit-sum renormalization. " +
      (diffractionObjectSpace ? "Applied as an object-space convolution: the scene radiance on the site lattice is convolved once per spectral node (calculateIrradianceConvolution) and the provider answers each site query with it, so the site inputs declare no PSF; this equals the per-tap environment PSF quadrature for this still, distortion-free planar scene (request.diffraction.psf). " :
        defocusImageSpace ? "Applied with lens.defocus as one image-space kernel per spectral node (the diffraction kernel convolved with the disc) on the sensor's site lattice (#548; see the lens.defocus assumption), " +
          "the same sum as the environment PSF quadrature with that kernel. " :
        "Applied through the environment PSF quadrature (one scene query per kernel tap), because camera rotation, a lens field mapping or vignetting moves the taps off the site lattice. ") +
      "No defocus, aberration or pupil clipping; " + (boxAperture ? "the pixel aperture is integrated as declared by sensor.pixelAperture." : "the sensor pixel aperture is still point-sampled at the site centre."));
  }
  // #492: each spectral node's kernel for lens.defocus out of focus: the disc, or with lens.diffraction the node's diffraction kernel convolved
  // with the disc, radius R_diffraction + R_defocus (built on first use, kept for the request). Object space, or image space (#548).
  let defocusSiteKernels: { radius: number; wavelengthsNm: readonly number[]; at(wavelengthNm: number): Float64Array; large?: LargeDefocusKernel } | undefined;
  if (defocusKernel && defocusKernel.radius > DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES) {
    // #564: above the direct radius the disc is convolved by runs (site-kernel-runs.ts) and each node's diffraction kernel applied
    // after it, instead of one combined kernel per node: the same sums regrouped. `at` is never read on this path.
    const runs = siteKernelRuns(defocusKernel.weights, defocusKernel.radius), diffractionRadius = diffraction ? diffraction.kernelRadiusSamples : 0;
    const psfConfiguration = diffraction ? diffractionPsf!.configuration.psf : undefined, profileWavelengths = diffraction ? diffraction.profile.axes.wavelengthNm : quadratureWavelengths();
    const diffractionKernels = new Map<number, Float64Array>();
    defocusSiteKernels = { radius: diffractionRadius + defocusKernel.radius, wavelengthsNm: profileWavelengths, at: (): Float64Array => fail("simulateCapture: the large defocus kernel has no combined kernels."),
      large: { runs, ...(diffraction ? { diffraction: { radius: diffractionRadius, kernelAt(wavelengthNm: number): Float64Array {
        let kernel = diffractionKernels.get(wavelengthNm);
        if (!kernel) {
          if (!profileWavelengths.includes(wavelengthNm)) fail("simulateCapture: a spectral node has no diffraction kernel.");
          kernel = siteDiffractionKernel(psfConfiguration!, wavelengthNm, pitch, diffractionRadius, "simulateCapture: diffraction kernels must sample the site pitch exactly.");
          diffractionKernels.set(wavelengthNm, kernel);
        }
        return kernel;
      } } } : {}) } };
  } else if (defocusKernel) {
    if (diffraction) {
      const diffractionRadius = diffraction.kernelRadiusSamples, combined = new Map<number, Float64Array>(), profileWavelengths = diffraction.profile.axes.wavelengthNm;
      const radius = diffractionRadius + defocusKernel.radius;
      // At most 32 + 64 = 96 sites (the two caps). Neither the expected-signal table nor the provider's own gather (diffraction-provider.ts)
      // uses the public 32-site limit of calculateIrradianceConvolution; the combination costs at most about 0.1 s per spectral node
      // (measured, docs/QUICK_START.md "Optics"), so no tighter limit applies.
      const psfConfiguration = diffractionPsf!.configuration.psf;
      defocusSiteKernels = { radius, wavelengthsNm: profileWavelengths, at(wavelengthNm: number): Float64Array {
        let kernel = combined.get(wavelengthNm);
        if (!kernel) {
          if (!profileWavelengths.includes(wavelengthNm)) fail("simulateCapture: a spectral node has no diffraction kernel.");
          kernel = convolveSiteKernels(siteDiffractionKernel(psfConfiguration, wavelengthNm, pitch, diffractionRadius, "simulateCapture: diffraction kernels must sample the site pitch exactly."),
            diffractionRadius, defocusKernel.weights, defocusKernel.radius);
          combined.set(wavelengthNm, kernel);
        }
        return kernel;
      } };
    } else defocusSiteKernels = { radius: defocusKernel.radius, wavelengthsNm: quadratureWavelengths(), at: (): Float64Array => defocusKernel.weights };
  }
  // #548: in image space the kernel reaches its radius (plus the anti-aliasing and pixel-aperture offsets) beyond the frame, so the lens
  // field mapping and the vignetting profile must cover the frame's corners plus that reach.
  if (defocusSiteKernels && defocusGeometry && defocusImageSpace) {
    const reach = defocusSiteKernels.radius + Math.max(0, ...queryOffsetsSites.map((o) => Math.ceil(Math.max(Math.abs(o.x), Math.abs(o.y)) - 1e-6))) + 0.5;
    const xMm = (nativeWidth / 2 + reach) * pitch / 1000, yMm = (nativeHeight / 2 + reach) * pitch / 1000;
    for (const [x, y] of [[-xMm, -yMm], [xMm, -yMm], [-xMm, yMm], [xMm, yMm]] as const) {
      try { defocusGeometry.lookOf(x, y, 0); } catch (error) {
        fail("lens.defocus out of focus with " + imageSpaceOptions.join(", ") + " reads the scene through the lens up to " + defocusSiteKernels.radius + " sites beyond the frame (the " +
          (diffraction ? "kernel radius of the diffraction kernel convolved with the disc" : "disc's kernel radius") + "), and at the frame's corner plus that reach (" +
          Math.hypot(x, y).toFixed(3) + " mm from the axis) " + (error as Error).message + " Extend the profile's range, or bring the focus closer to the subject.");
      }
    }
  }
  const psf = lensPsf ?? (diffractionObjectSpace ? { kind: "not-applied" as const, evidence,
    limitation: "No environment PSF: lens diffraction is applied upstream by the scene provider as an object-space convolution (request.diffraction)." } : undefined) ??
    (defocusSiteKernels && defocusImageSpace ? { kind: "not-applied" as const, evidence, limitation: "No environment PSF: lens defocus" + (diffraction ? " (with lens.diffraction)" : "") +
      " is applied upstream by the scene provider as an image-space convolution on the sensor's site lattice (lens.defocus)." } : undefined) ??
    diffractionPsf ?? (defocusSiteKernels ? { kind: "not-applied" as const, evidence,
      limitation: "No environment PSF: lens defocus is applied upstream by the scene provider as an object-space convolution (lens.defocus)." } : undefined) ??
    { kind: "not-applied" as const, evidence, limitation: "No lens PSF (point optics)." };
  const pupilRecord = pupil ? { kind: "ideal-uniform-circular-pupil" as const, radialSampleCount: pupil.radialSamples, angularSampleCount: pupil.angularSamples, evidence,
    limitation: "Ideal uniform circular pupil; finite ray sampling, no convergence claim." } : undefined;
  const chargeSamplingProfile = { schemaVersion: "0.1.0" as const, profileId: IDS.chargeSampling, completenessProfileId: IDS.completeness, scientificStatus: "approximation" as const,
    photoShotNoiseModel: "poisson" as const, darkShotNoiseModel: "poisson" as const, additionalComponentPolicies: [], evidence, limitations: ["Poisson photo and dark shot noise."] };
  const channelAt = (x: number, y: number): Channel => (["red", "green", "green", "blue"] as const)[(y % 2) * 2 + (x % 2)]!;
  function siteInput(index: number): SimulateEnvironmentSensorRawFrameInput["sites"][number] {
    if (!Number.isSafeInteger(index) || index < 0 || index >= nativeWidth * nativeHeight) fail("Native site index out of range.");
    const x = index % nativeWidth, y = Math.floor(index / nativeWidth), channel = channelAt(x, y), site = { x, y }, c = perChannel[channel], r = regimeByChannel[channel];
    const environment = { temporalIntegrationId: IDS.frame + ":native:" + index,
      sensor: { spatialSampling: { imagingArea, samplingApertureProfile, opticalStackProfile, site, spatialSampleCountX: boxSamples, spatialSampleCountY: boxSamples },
        spectralSampling: spectralSamplingByChannel[channel], colorSamplingProfile, spectralResponseProfile: spectralResponseProfiles[channel],
        responseApplication: { applicationProfile: c.applicationProfile, sourcePlane, operatingConditions }, operatingRangeProfile: c.operatingRangeProfile, localExposure },
      sceneBindings, optics, motion, temporalSampleCount, fieldThroughput, psf, ...(pupilRecord ? { pupil: pupilRecord } : {}), ...(lensFieldMapping ? { lensFieldMapping } : {}) };
    // The charge completeness profile must cover the site's own exposure window (shifted by s·τ under a rolling shutter).
    const window = rollingSchedule ? calculateCaptureExposureWindows({ ...exposureWindow, nativeRaster, samplePointsNative: [{ x: x + 0.5, y: y + 0.5 }] }).value.samples[0]! :
      { startOffsetSecondsFromOpeningReference: 0, endOffsetSecondsFromOpeningReference: shutterSeconds };
    return { environment, operatingTemperatureC: OPERATING_TEMPERATURE_C,
      darkCurrentProfile: { schemaVersion: "0.1.0", profileId: IDS.dark, colorSamplingProfileId: IDS.cfa, channelId: channel, scientificStatus: "approximation", evidence,
        uncertainty: { kind: "not-quantified", limitation: "Synthetic dark current for the capture facade." }, chargeMeaning: "pre-compensation-thermally-generated-electrons",
        siteApplicability: { kind: "exact-site", site }, temperatureModel: { kind: "fixed-reference-temperature", referenceTemperatureC: OPERATING_TEMPERATURE_C,
          darkCurrentElectronsPerSecond: DARK_CURRENT_ELECTRONS_PER_SECOND }, darkCurrentCompensationIncluded: false, spatialDarkCurrentNonuniformityModeled: false },
      charge: { completenessProfile: { schemaVersion: "0.1.0", profileId: IDS.completeness, colorSamplingProfileId: IDS.cfa, channelId: channel, site, bindingId: IDS.binding,
        timeReference: "first-opening-boundary-phase", startOffsetSecondsFromOpeningReference: window.startOffsetSecondsFromOpeningReference,
        endOffsetSecondsFromOpeningReference: window.endOffsetSecondsFromOpeningReference,
        darkCurrentProfileId: IDS.dark, includedAdditionalComponentIds: [], coverageMeaning: "all-material-stored-electron-contributors-accounted-for",
        scientificStatus: "approximation", evidence, limitation: "Photo and dark charge only." } },
      readout: { samplingProfile: chargeSamplingProfile, capacityProfile: { schemaVersion: "0.1.0", profileId: IDS.capacity, colorSamplingProfileId: IDS.cfa, channelId: channel,
        capacityMeaning: "physical-charge-storage-capacity-electrons", capacityElectrons, scientificStatus: "approximation",
        uncertainty: { kind: "not-quantified", limitation: "Derived from the tier's declared saturation signal." }, evidence, siteApplicability: { kind: "exact-site", site },
        operatingState: { stateId: IDS.operatingState, evidence }, temperatureApplicability: { kind: "exact-reference-temperature", temperatureC: OPERATING_TEMPERATURE_C } },
        operatingStateId: IDS.operatingState, readoutProfile: r.readoutProfile, regimeId: r.regimeId } } as unknown as SimulateEnvironmentSensorRawFrameInput["sites"][number];
  }
  const readTile = async (request: { captureId: string; frameId: string; x: number; y: number; width: number; height: number }): Promise<NativeEnvironmentRawTile> =>
    ({ ...request, sites: Array.from({ length: request.width }, (_, j) => siteInput(request.y * nativeWidth + request.x + j)) });
  const yieldControl = createHostYield().yieldControl;
  const perSite = queriesPerSite * (diffraction && psf === diffractionPsf ? (2 * diffraction.kernelRadiusSamples + 1) ** 2 : catalogueTaps ?? 1);
  let diffractionMs = 0, defocusMs = 0, demosaicMs: number | undefined, encodeMs: number | undefined;
  const diffractedProvider = (window: { x: number; y: number; width: number; height: number } | undefined): PlanarSceneRadianceProvider =>
    // #548: the disc (or diffraction ⊛ disc) in image space, on the sensor's site lattice, through the mapping, field throughput and rotation.
    defocusSiteKernels && defocusGeometry && defocusImageSpace ? createDefocusImageSpaceProvider({ base: provider, geometry: defocusGeometry, siteKernels: defocusSiteKernels.at,
      ...(defocusSiteKernels.large ? { largeKernel: defocusSiteKernels.large } : {}),
      wavelengthsNm: defocusSiteKernels.wavelengthsNm, kernelRadius: defocusSiteKernels.radius, nativeWidth, nativeHeight, sitePitchMicrometers: pitch, distanceM: subjectDistanceM,
      metresPerFrameUnit, queryOffsetsSites, timesPerBand: temporalSampleCount, onConvolution: (ms) => { defocusMs += ms; }, ...(window ? { window } : {}),
      ...(bokehZones ? { fieldZones: bokehZones.zones } : {}) }) :
    defocusSiteKernels ? createDiffractedPlanarProvider({ base: provider, siteKernels: defocusSiteKernels.at, ...(defocusSiteKernels.large ? { largeKernel: defocusSiteKernels.large } : {}),
      wavelengthsNm: defocusSiteKernels.wavelengthsNm, kernelRadius: defocusSiteKernels.radius, nativeWidth, nativeHeight, outputWidth: width,
      sitePitchMicrometers: pitch, distanceM: subjectDistanceM, metresPerFrameUnit, onConvolution: (ms) => { defocusMs += ms; },
      ...(window ? { window } : {}), ...(bokehZones ? { fieldZones: bokehZones.zones } : {}),
      ...(antiAliasing || boxSamples > 1 ? { queryOffsetsSites: apertureNodeOffsets(boxSamples).flatMap((node) =>
        (antiAliasing ? antiAliasing.components : [{ offsetMicrometers: { x: 0, y: 0 } }]).map((c) => ({ x: node.x - c.offsetMicrometers.x / pitch, y: node.y - c.offsetMicrometers.y / pitch }))) } : {}) }) :
    diffraction && diffractionObjectSpace ? createDiffractedPlanarProvider({ base: provider, psf: diffractionPsf!.configuration.psf,
      wavelengthsNm: diffraction.profile.axes.wavelengthNm, kernelRadius: diffraction.kernelRadiusSamples, nativeWidth, nativeHeight, outputWidth: width,
      sitePitchMicrometers: pitch, distanceM: subjectDistanceM, metresPerFrameUnit, onConvolution: (ms) => { diffractionMs += ms; },
      // Region (2.6): convolve only the lattice the region's native sites query; the values are the whole render's.
      ...(window ? { window } : {}),
      // The environment queries each site at each aperture node minus each split offset (sites, +x right, +y down).
      ...(antiAliasing || boxSamples > 1 ? { queryOffsetsSites: apertureNodeOffsets(boxSamples).flatMap((node) =>
        (antiAliasing ? antiAliasing.components : [{ offsetMicrometers: { x: 0, y: 0 } }]).map((c) => ({ x: node.x - c.offsetMicrometers.x / pitch, y: node.y - c.offsetMicrometers.y / pitch }))) } : {}) }) : provider;
  // Built on first use: a capture that takes the tabulated path (#394 step 2) never queries it, and its kernels cost a setup.
  let rawProviderBuilt: PlanarSceneRadianceProvider | undefined;
  const rawProvider = (): PlanarSceneRadianceProvider => (rawProviderBuilt ??= diffractedProvider(regionNative));
  if (antiAliasing && perSite > 100_000) fail("sensor.antiAliasing with these options needs " + perSite + " scene queries per site; the environment admits at most 100000.");
  const evaluations = nativeWidth * nativeHeight * perSite;
  // The native task admits at most 100 000 radiance queries per tile.
  const tileWidth = Math.max(1, Math.min(256, Math.floor(100_000 / perSite)));
  const environmentRaw: NativeEnvironmentRawInput = { raw: buildRawInput(intentOf(whiteBalanceState)), sceneBinding,
    maximumProviderEvaluations: Math.min(nativeRawMaximumProviderEvaluations(raisedPixels === undefined ? {} : { maximumPixels: raisedPixels }),
      Math.max(nativeWidth * nativeHeight, evaluations)) };

  // The facade's environment chain at a site next to the optical axis, shared by the ideal reference (2.3) and the display
  // view: expected electrons per unit spectral radiance per channel and node, and the normalized RAW signal per electron.
  function axisChannelResponse(caller: string): { electronsPerRadiance: Record<Channel, Map<number, number>>; wavelengths: number[]; relativePerElectron: Record<Channel, number> } {
    // 1. Electrons per unit spectral radiance at each spectral node, per channel: the facade's own environment chain at a
    //    site next to the optical axis, with the ideal optics (no PSF, pupil, distortion, vignetting or motion). The signal
    //    is linear in the radiance node values and, for this planar scene, the same at every site (paraxial π/(4N_w²)).
    const cx = Math.floor(nativeWidth / 2) & ~1, cy = Math.floor(nativeHeight / 2) & ~1;
    const channelSites: Record<Channel, number> = { red: cy * nativeWidth + cx, green: cy * nativeWidth + Math.min(cx + 1, nativeWidth - 1), blue: Math.min(cy + 1, nativeHeight - 1) * nativeWidth + Math.min(cx + 1, nativeWidth - 1) };
    const environments = {} as Record<Channel, Record<string, unknown>>;
    for (const channel of CHANNELS) {
      if (channelAt(channelSites[channel] % nativeWidth, Math.floor(channelSites[channel] / nativeWidth)) !== channel) fail(caller + " needs at least a 2 × 2 native raster.");
      const environment = { ...(siteInput(channelSites[channel]).environment as unknown as Record<string, unknown>) };
      environment.psf = { kind: "not-applied", evidence, limitation: "Ideal reference: no lens PSF." };
      environment.fieldThroughput = { kind: "unity", evidence, limitation: "Ideal reference: no vignetting." };
      environment.motion = { ...motion, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 } };
      environment.temporalSampleCount = 1;
      delete environment.pupil;
      delete environment.lensFieldMapping;
      delete environment.evaluateRadiance;
      delete environment.evaluateApertureRadiance;
      environments[channel] = environment;
    }
    // The responses are a function of these records without their scene bindings: the radiance is replaced at every node,
    // and the bindings (provider, illumination and material profiles) are only checked, never enter a number. So a chart,
    // illuminant or illuminance change keeps the entry (#443). A request split into region tiles builds the same records for
    // every tile. The entries are kept across calls (the last CHANNEL_RESPONSE_CACHE_SIZE).
    const key = JSON.stringify(CHANNELS.map((c) => ({ ...environments[c], sceneBindings: undefined })));
    const copy = (responses: Record<Channel, Map<number, number>>): Record<Channel, Map<number, number>> => Object.fromEntries(CHANNELS.map((c) => [c, new Map(responses[c])])) as Record<Channel, Map<number, number>>;
    const cached = channelResponseCache.get(key);
    let electronsPerRadiance: Record<Channel, Map<number, number>>;
    if (cached) {
      channelResponseCache.delete(key);
      channelResponseCache.set(key, cached);
      electronsPerRadiance = copy(cached);
    } else {
      electronsPerRadiance = {} as Record<Channel, Map<number, number>>;
      // One chain execution per channel, each node's electrons read from its own rate term (#443; exact, see channel-response.ts).
      // The records are built above for this call only, so they are planned as engine-owned data.
      for (const channel of CHANNELS) electronsPerRadiance[channel] = calculateChannelElectronsPerRadiance(environments[channel], (request) => provider.evaluateRadiance(request), caller);
      // Callers get their own maps; the cached ones are never handed out.
      channelResponseCache.set(key, copy(electronsPerRadiance));
      if (channelResponseCache.size > CHANNEL_RESPONSE_CACHE_SIZE) channelResponseCache.delete(channelResponseCache.keys().next().value!);
    }
    const wavelengths = [...new Set(CHANNELS.flatMap((c) => [...electronsPerRadiance[c].keys()]))].sort((a, b) => a - b);
    // 2. Electrons → normalized RAW signal: (code − black)/(white − black) = e·d/(G·(W − B)) for the linear readout
    //    (conversion gain G e⁻/DN, digital gain d, black B, effective white W of the capture's readout regime).
    const relativePerElectron = {} as Record<Channel, number>;
    for (const channel of CHANNELS) {
      const { readoutProfile, regimeId } = regimeByChannel[channel];
      const regime = resolveSensorReadoutRegime({ profile: readoutProfile as Parameters<typeof resolveSensorReadoutRegime>[0]["profile"], regimeId }).regime;
      const gain = regime.systemConversionGainElectronsPerCode.value, digitalGain = regime.adc.digitalGain ?? 1, black = regime.adc.blackLevelCode;
      const white = calculateSiteEffectiveSaturationCode({ physicalChargeCapacityElectrons: capacityElectrons, preAdcSaturationElectronEquivalent: regime.preAdcSaturationElectronEquivalent.value,
        systemConversionGainElectronsPerCode: gain, blackLevelCode: black, digitalSaturationCode: regime.adc.digitalSaturationCode, adcMaximumCode: 2 ** regime.adc.bitDepth - 1, digitalGain },
      readoutProfile as Parameters<typeof calculateSiteEffectiveSaturationCode>[1], regimeId);
      relativePerElectron[channel] = digitalGain / (gain * (white - black));
    }
    return { electronsPerRadiance, wavelengths, relativePerElectron };
  }
  // Display view: the renderer that simulate-display-view.ts passes in reads this request's resolved state, so a bundle
  // that only captures does not contain the display view.
  // #563: the view's expected signal through the lens, from the capture's own geometry (#548), checked to cover its farthest source point: the outer
  // site centre plus the kernel radius and the largest query offset.
  // #569: a catalogue lens's field-dependent PSF, read per field zone by the lens signal (display-view-lens-signal.ts, loaded on demand).
  const viewLensKit = displayView && lensGeometry ? await import("./display-view-lens-signal.js") : undefined;
  const displayViewLensPsf = viewLensKit && catalogue && lensPsf ?
    viewLensKit.createDisplayViewLensPsf(lensPsf.configuration.psf as Parameters<typeof viewLensKit.createDisplayViewLensPsf>[0], catalogueKernelRadius, nativeWidth, nativeHeight, pitch) : undefined;
  if (displayViewLensPsf) assume("view.lensPsf", "model", { method: "piecewise-constant-field-zones", zoneSites: displayViewLensPsf.zoneSites, kernelRadiusSites: catalogueKernelRadius, scientificStatus: "approximation" },
  "Each site takes the lens PSF at its field zone's centre, where the capture resolves it at each query point (docs/DISPLAY_VIEW.md, \"Catalogue lenses\").");
  const lensSignal = viewLensKit ? viewLensKit.prepareDisplayViewLensSignal({ geometry: lensGeometry!,
    times: rotating ? Array.from({ length: temporalSampleCount }, (_, i) => (i + 0.5) * (shutterSeconds / temporalSampleCount)) : [0], distanceM: subjectDistanceM, metresPerFrameUnit,
    pitch, imagingArea, boxSamples, spots: antiAliasing ? antiAliasing.components : [{ offsetMicrometers: { x: 0, y: 0 } }], psf: displayViewLensPsf, zeroBeyondHorizon: catalogue?.kind === "fisheye" }, nativeWidth, nativeHeight,
  (diffraction ? diffraction.kernelRadiusSamples : 0) + (displayViewDefocus ? (bokehAxisKernel?.radius ?? defocusDiscKernelRadius(displayViewDefocus.diameterSites)) : 0) + catalogueKernelRadius +
    Math.max(0, ...queryOffsetsSites.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y)))) - 0.5, catalogue ? "lens.catalogue" : imageSpaceOptions.join(", ")) : undefined;
  if (displayView) return await renderView!({ lens: lensSignal, lensPsf: displayViewLensPsf, ahd, fastReport, antiAliasing, aspect, assume, assumptions, axisChannelResponse, boxSamples, buildProvider, callerScene, chart, materialLayers, chartReport, chartSize, diffraction, defocus: displayViewDefocus, diffractionPsf, fNumber, focalLengthMm, focusDistanceM, height, highlightMode, exposureGain, illuminanceLux, illuminant, illuminantOption, imagingArea, intentOf, metresPerFrameUnit, noiseSeed, outputOptions, parsedView, pitch, preset, provider, regimeByChannel, resolvedIso, isoReport, standardExposureDeviationStops: exposureDeviationStops, standardExposureIlluminanceLux: exposureIlluminanceLux, greyCardDeviationStops: exposureGreyCardDeviationStops, metering, sceneOption, scenePreset, shutterSeconds, started, subjectDistanceM, toneCurve, whiteBalanceOption, whiteBalanceState, width, checkAbort, margin, mode, nativeHeight, nativeWidth, sourceSha256, yieldControl, kelvinWhiteBalanceInput });
  // Ideal reference (2.3): the scene without camera effects, at the capture's own exposure, white balance and encoding.
  if (idealReference) {
    const referenceStarted = clockMs();
    if (format !== "srgb-8" && format !== "srgb-16" && format !== "png") fail("simulateIdealReference supports output.format srgb-8, srgb-16 and png: a reference has no RAW (dng) and should not carry JPEG compression artefacts.");
    if (needsAuto) fail("simulateIdealReference cannot reproduce output.whiteBalance \"auto\": the capture measures it from its noisy RAW. Use \"scene-illuminant\" or a fixed white balance.");
    const { electronsPerRadiance, wavelengths, relativePerElectron } = axisChannelResponse("simulateIdealReference");
    // 3. Scene radiance per sample: chart materials once (and the fixed-size chart's surround), caller functions per sample.
    const signalOf = (radiance: (nm: number) => number): [number, number, number] => {
      const values = new Map(wavelengths.map((nm) => [nm, radiance(nm)]));
      return CHANNELS.map((c) => { let e = 0; for (const [nm, a] of electronsPerRadiance[c]) e += a * values.get(nm)!; return e * relativePerElectron[c]; }) as [number, number, number];
    };
    const materialCount = chart ? chart.materials.length : callerScene?.kind === "material-function" ? callerScene.materials.length : 0;
    const materialSignals = provider.chartMaterialAt ? Array.from({ length: materialCount + (chartSize ? 1 : 0) }, (_, m) => signalOf((nm) => provider.materialRadiance!(m, nm))) : undefined;
    // 4. Pixels: the native sites of the output (or region) pixels, each centre-sampled or box-integrated like the capture.
    const x0 = (region ? region.x : 0) + margin, y0 = (region ? region.y : 0) + margin, n = boxSamples, unit = 2 / width;
    const referenceIntent = intentOf(whiteBalanceState), referenceGains = referenceIntent ? [referenceIntent.channelGains.red, referenceIntent.channelGains.green, referenceIntent.channelGains.blue] : null;
    const development = prepareSensorColorDevelopment(CAMERA_TO_XYZ as unknown as Parameters<typeof prepareSensorColorDevelopment>[0],
      referenceGains, highlightMode);
    const rgb = new Float64Array(outputWidth * outputHeight * 3), counts = { whiteBalanceClippedSampleCount: 0, reconstructedPixelCount: 0 }, sum = [0, 0, 0];
    for (let py = 0; py < outputHeight; py++) {
      for (let px = 0; px < outputWidth; px++) {
        sum[0] = 0; sum[1] = 0; sum[2] = 0;
        for (let l = 0; l < n; l++) for (let k = 0; k < n; k++) {
          const u = (x0 + px + (k + 0.5) / n - nativeWidth / 2) * unit, v = -(y0 + py + (l + 0.5) / n - nativeHeight / 2) * unit;
          const s = materialSignals ? materialSignals[provider.chartMaterialAt!(u, v)]! : signalOf((nm) => provider.radianceAt(u, v, nm));
          sum[0] += s[0]; sum[1] += s[1]; sum[2] += s[2];
        }
        // Normalized RAW values saturate at the white level, as in development.
        // #556: the development exposure push multiplies the normalized RAW before the white clip.
        const c = exposureGain === 1 ? sum.map((value) => Math.min(1, Math.max(0, value / (n * n)))) : sum.map((value) => Math.min(1, Math.max(0, value / (n * n) * exposureGain)));
        development.developInto(c[0]!, c[1]!, c[2]!, rgb, (py * outputWidth + px) * 3, counts);
      }
      if ((py & 15) === 15) { await yieldControl(); checkAbort(); }
    }
    let samples: Uint8Array | Uint16Array;
    if (!linearPath) {
      const maximum = 2 ** rendering.bitDepth - 1, tone = prepareSdrPixelTone(rendering), scratch = new Float64Array(3);
      samples = rendering.bitDepth === 8 ? new Uint8Array(rgb.length) : new Uint16Array(rgb.length);
      const sdrCounts: SdrPixelCounts = { negative: 0, above: 0, changed: 0, low: 0, high: 0, outOfGamut: false };
      for (let y = 0; y < outputHeight; y++) renderSdrRunInto(rgb, y * outputWidth * 3, outputWidth, rendering, tone, 2 ** rendering.renderingExposureEv, maximum, samples, y * outputWidth * 3, scratch, sdrCounts);
    } else {
      const mapping = perceptual ? prepareRgbGamutMapping({ colorSpace: colorEncoding!, method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION }) : undefined;
      samples = encodeSdrFromLinear(rgb, colorEncoding!, pngBitDepth!, mapping).samples;
    }
    const encodedPng = format === "png" ? serializePngImage({ width: outputWidth, height: outputHeight, bitDepth: pngBitDepth!, samples, colourEncoding: pngColourEncoding(colorEncoding!),
      ...(raisedPixels === undefined || outputWidth * outputHeight <= PNG_ENCODER_LIMITS.maximumPixels ? {} : { maximumPixels: raisedPixels }) }) : undefined;
    const png = encodedPng && textMetadata ? addPngTextMetadata(encodedPng, textMetadata) : encodedPng;
    if (png) assumeTextMetadata(TEXT_METADATA_LAYOUT.png);
    const referenceMs = clockMs() - referenceStarted;
    assume("reference.kind", "model", "ideal-reference",
      "An ideal reference, not a capture: the same scene, framing, chart size, output size, region and pixel grid as the capture request, with no camera effects.");
    assume("reference.excludes", "model", ["lens PSF, diffraction, defocus and pupil sampling", "projection and distortion (ideal rectilinear mapping)", "vignetting", "anti-aliasing filter",
      "colour filter mosaic and demosaicing (every pixel has all three channels)", "photon, dark and read noise", "dark signal", "ADC rounding and non-linearity", "camera motion and rolling shutter"],
    "None of these is applied; each pixel's channels come from the scene radiance at the pixel alone.");
    assume("reference.exposure", "model", { convention: "exposure-matched", fNumber, shutterSeconds, iso: resolvedIso, illuminanceLux,
      normalizedSignalPerElectron: { ...relativePerElectron } },
    "Exposure-matched: each channel is the expected (noise-free) signal the capture's own sensor would record at the resolved exposure (f-number, shutter, ISO, illuminance and lens transmission; the facade's environment chain at the optical axis), " +
      "normalized like the RAW development ((code − black)/(white − black) = e·d/(G·(W − B)) for a linear readout), clipped at white, then developed with the capture's white balance, camera → XYZ → sRGB matrices, highlight mode, tone curve and encoding. " +
      "So a uniform patch renders at the capture's mean level, and differences from the capture are the camera effects plus noise. Chosen over a fixed reflectance → sRGB mapping because that would differ from the capture by the exposure, which is not a camera artefact.");
    assume("reference.sampling", "model", boxAperture ? { kind: "box", samplesPerAxis: n } : { kind: "point" },
      boxAperture ? "Each pixel averages the scene over its square photosite with the same " + n + " × " + n + " midpoint rule as sensor.pixelAperture \"box\"." :
        "Each pixel samples the scene at its centre, like the capture's default point aperture; use sensor.pixelAperture \"box\" for photosite-averaged pixels.");
    return Object.freeze({ kind: "ideal-reference" as const, label: "Ideal reference (no camera effects); not a capture.", facadeVersion: SIMULATE_CAPTURE_FACADE_VERSION, engineApiVersion: ENGINE_API_VERSION,
      image: { width: outputWidth, height: outputHeight, format, samples, ...(png ? { png, colorEncoding: colorEncoding! } : {}) },
      exposure: { mode, settings: { fNumber, shutterSeconds, iso: resolvedIso }, ev100: Math.log2(fNumber ** 2 / shutterSeconds), ...isoReport },
      scene: { sceneId: chart ? "chart:" + chart.preset : callerScene!.sceneId, preset: scenePreset, parameters: chart ? chart.parameters : {},
        illuminant: { id: illuminant.id, description: illuminant.description, illuminanceLux }, distanceM: subjectDistanceM,
        framedWidthM: 2 * metresPerFrameUnit, framedHeightM: 2 * metresPerFrameUnit * aspect, ...(chartReport ? { chart: chartReport } : {}), sourceSha256 },
      ...(region && regionNative ? { region: { ...region, frameWidth: width, frameHeight: height } } : {}),
      diagnostics: { sampleCount: outputWidth * outputHeight * n * n, timingsMs: { reference: referenceMs, total: Date.now() - started } },
      provenance: { scientificStatus: "approximation" as const, cameraPresetId: preset.presetId, cameraPresetVersion: preset.presetVersion, evidence: [...FACADE_EVIDENCE, ...preset.evidence],
        composedContracts: ["calculateEnvironmentSensorPhotoSignal", "resolveSensorReadoutRegime", "calculateSiteEffectiveSaturationCode", "prepareSensorColorDevelopment",
          ...(linearPath ? ["resolveRgbColorSpace", ...(perceptual ? ["prepareRgbGamutMapping"] : [])] : ["SDR rendering kernel"]), ...(png ? ["serializePngImage"] : [])],
        limitations: ["Ideal reference of the planar scene at the capture's exposure: not a capture and not a measurement; it shows what the camera effects change, not an absolute colour truth."] },
      assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
  }

  async function runTask<T extends { run(): Promise<void>; cancel(): void; dispose(): void; readonly state: string }>(task: T): Promise<void> {
    const onAbort = (): void => task.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try { checkAbort(); await task.run(); checkAbort(); } catch (error) { task.dispose(); if (signal?.aborted) fail("simulateCapture aborted."); throw error; } finally { signal?.removeEventListener("abort", onAbort); }
  }
  const rawStarted = Date.now();
  const plan = calculateNativeRawPlan(environmentRaw.raw);
  const progress = (stage: SimulateCaptureProgress["stage"], total: number) => {
    let completed = 0;
    return (): void => { completed++; onProgress?.({ stage, completedTileCount: completed, totalTileCount: total }); };
  };
  const rawTick = progress("raw", regionNative ? regionNative.height * Math.ceil(regionNative.width / tileWidth) : plan.tileCount);
  // #394: siteInput builds fresh site records per call and never changes them, so the native task plans them without a copy.
  const rawCallbacks = (): Parameters<typeof createNativeEnvironmentRawTask>[1] => ({ readTile: markInternalNativeTileReader(async (request: Parameters<typeof readTile>[0]): Promise<NativeEnvironmentRawTile> => { const tile = await readTile(request); rawTick(); return tile; }),
    evaluateRadiance: rawProvider().evaluateRadiance, ...(pupil ? { evaluateApertureRadiance: provider.evaluateApertureRadiance } : {}), yieldControl });
  // #394 step 2: an engine-built planar scene (chart preset or caller material scene; still, rectilinear, no distortion, vignetting,
  // pupil rays or caller PSF) takes its expected electrons from the tabulated signal, verified per CFA phase against the chain.
  const tabulatedScene = chart !== undefined || callerScene?.kind === "material-function";
  // #391: a DNG from region parts takes the whole frame's RAW from the parts instead of rendering it.
  if (run === "dng-from-parts" && regionNative) fail("serializeSimulatedCaptureDngFromParts writes the whole frame: the options take no output.region.");
  const dngParts = run === "dng-from-parts" ? viewOption : undefined;
  let tabulated: Awaited<ReturnType<typeof renderTabulatedNativeRaw>>;
  // #553: a cat's eye varies the kernel over the field, which the expected-signal tables (one kernel per node) do not take.
  if (dngParts === undefined && tabulatedScene && !pupil && !lensFieldMapping && !vignetting && !lensPsf && !rotating && !bokehZones && (!diffraction || diffractionObjectSpace) && provider.chartMaterialAt && provider.materialRadiance) {
    const { electronsPerRadiance, wavelengths } = axisChannelResponse("simulateCapture");
    const perNode = CHANNELS.map((c) => Float64Array.from(wavelengths, (nm) => electronsPerRadiance[c].get(nm) ?? 0)) as [Float64Array, Float64Array, Float64Array];
    const sceneMaterials = chart ? chart.materials : (callerScene as ResolvedCallerMaterialScene).materials, materialRadiance = provider.materialRadiance;
    const tabulatedMaterials = { materialAt: provider.chartMaterialAt, whiteRadiance: (nm: number): number => irradianceScale * illuminant.shape.evaluate(nm) / Math.PI,
      list: [...sceneMaterials.map((m, index) => (m.kind === "neutral" ? { neutral: m.reflectance } : { radiance: (nm: number): number => materialRadiance(index, nm) })),
        ...(chartSize ? [{ neutral: chartSize.surroundReflectance }] : [])] };
    const { signalInput: builtSignalInput } = buildExpectedSignalInput({ nativeWidth, nativeHeight, width, wavelengths, perNode, apertureNodes: apertureNodeOffsets(boxSamples), boxSamples, antiAliasing, pitch,
      diffraction: diffraction && !defocusSiteKernels ? { radius: diffraction.kernelRadiusSamples, psf: diffractionPsf!.configuration.psf, profileWavelengths: diffraction.profile.axes.wavelengthNm } : undefined,
      materials: tabulatedMaterials, radianceAt: provider.radianceAt, imagingArea, focalLengthMm, focusDistanceM, subjectDistanceM, metresPerFrameUnit, caller: "simulateCapture" });
    // #492: with lens.defocus the table convolves the lattice radiance with each node's defocus (or combined) kernel, on the
    // lattice formula, exactly as the object-space provider does.
    let signalInput = builtSignalInput;
    if (defocusSiteKernels?.large) {
      // #564: the in-focus signal on the lattice formula (diffraction kernels, or a unit tap per node), then the disc by runs.
      signalInput = buildExpectedSignalInput({ nativeWidth, nativeHeight, width, wavelengths, perNode, apertureNodes: apertureNodeOffsets(boxSamples), boxSamples, antiAliasing, pitch,
        diffraction: diffraction ? { radius: diffraction.kernelRadiusSamples, psf: diffractionPsf!.configuration.psf, profileWavelengths: diffraction.profile.axes.wavelengthNm } : undefined,
        largeDefocus: defocusSiteKernels.large.runs, materials: tabulatedMaterials,
        radianceAt: provider.radianceAt, imagingArea, focalLengthMm, focusDistanceM, subjectDistanceM, metresPerFrameUnit, caller: "simulateCapture" }).signalInput;
    } else if (defocusSiteKernels) {
      const lattice = { ...builtSignalInput };
      delete lattice.queryPoint;
      signalInput = { ...lattice, kernels: { radius: defocusSiteKernels.radius, perNode: wavelengths.map((nm) => defocusSiteKernels!.at(nm)) } };
    }
    // The verification reads only the region's top-left 2 × 2 block, so its diffraction convolves only that block's lattice; the
    // window never changes a value (see diffraction-provider.ts), so the chain it runs is the whole render's.
    const verificationProvider = diffractedProvider({ x: regionNative?.x ?? 0, y: regionNative?.y ?? 0, width: 2, height: 2 });
    tabulated = await renderTabulatedNativeRaw({ input: environmentRaw, region: regionNative, siteInput, evaluateRadiance: verificationProvider.evaluateRadiance,
      electrons: createDisplayViewExpectedSignal(signalInput), onTile: rawTick, tileWidth, yieldControl: () => yieldControl(), checkAbort });
  }
  let rawOutput: { raw: NativeRawOutput; providerEvaluationCount: number };
  if (dngParts !== undefined) rawOutput = { raw: joinNativeRawParts(dngParts, plan, nativeWidth, nativeHeight), providerEvaluationCount: 0 };
  else if (tabulated) {
    rawOutput = { raw: tabulated.raw, providerEvaluationCount: tabulated.providerEvaluationCount };
    // The verification's relative difference itself is not reported: it is a last-bits quantity, and captures use the JavaScript
    // engine's own Math functions, so it differs between engines while the results are the same.
    assume("raw.expectedSignal", "model", { method: "tabulated-expected-electrons", verificationSites: 4, tolerance: TABULATED_RELATIVE_TOLERANCE },
    "Each native site's expected photo electrons are the tabulated sum over the pixel-aperture nodes, anti-aliasing spots, diffraction taps and spectral nodes (the display view's expected signal), " +
      "the same quantity the environment chain computes for this still, rectilinear, distortion-free planar scene, formed in another order, so it can differ in the last bits. The sensor stage (dark charge, Poisson draws, " +
      "read noise, ADC) is the native one with each site's own seeds. One site of each CFA phase ran the full chain: its readout was reproduced bit for bit and its electrons agreed within the tolerance. " +
      "diagnostics.providerEvaluationCount counts those sites' evaluator calls and the table's scene lookups.");
  }
  else {
    const rawTask: NativeEnvironmentRawTask = regionNative ? createNativeEnvironmentRawRegionTask(environmentRaw, regionNative, rawCallbacks()) :
      createNativeEnvironmentRawTask(environmentRaw, rawCallbacks());
    await runTask(rawTask);
    rawOutput = rawTask.takeOutput();
  }
  // Region (2.3): the region's sites, re-described by a plan of the region raster (active area = the region), for development.
  let developmentPlan = plan;
  if (region && regionNative) {
    const raster = { pixelWidth: regionNative.width, pixelHeight: regionNative.height };
    const regionGeometry = { imagingArea: { widthMm: raster.pixelWidth * pitch / 1000, heightMm: raster.pixelHeight * pitch / 1000 }, nativeRaster: raster, orientation: "landscape" as const,
      activeCaptureRect: { x: region.x + margin - regionNative.x, y: region.y + margin - regionNative.y, width: region.width, height: region.height },
      outputRaster: { pixelWidth: region.width, pixelHeight: region.height } };
    developmentPlan = calculateNativeRawPlan(buildRawInputFor(intentOf(whiteBalanceState), regionGeometry, { ...captureModeProfile, modes: captureModeProfile.modes.map((m) =>
      ({ ...m, processedImageRaster: { ...m.processedImageRaster, value: raster } })) } as NativeRawInput["captureModeProfile"], { ...bindingProfile, nativeRaster: raster }, raster.pixelWidth * raster.pixelHeight));
    if (Array.from(rawOutput.raw.effectiveSaturationCodes).some((code) => code === 0)) fail("output.region needs every CFA phase in its native rectangle.");
    rawOutput = { ...rawOutput, raw: { ...rawOutput.raw, plan: developmentPlan } };
  }
  const providerEvaluationCount = rawOutput.providerEvaluationCount;
  const rawMs = Date.now() - rawStarted, wbStarted = Date.now();
  let finalRawInput = environmentRaw;
  if (needsAuto) {
    // Grey-world AWB over pre-WB RAW: black-subtracted, white-normalized channel means of each 2×2 CFA block on a coarse grid.
    const raw = rawOutput.raw, step = Math.max(2, 2 * Math.floor(Math.sqrt(width * height / 4096) / 1)), samples = [];
    for (let y = margin - (margin % 2); y + 1 < nativeHeight; y += step) for (let x = margin - (margin % 2); x + 1 < nativeWidth; x += step) {
      const value = (dx: number, dy: number): number => { const i = (y + dy) * nativeWidth + x + dx; return (raw.codes[i]! - raw.blackLevels[i]!) / (raw.effectiveSaturationCodes[dy * 2 + dx]! - raw.blackLevels[i]!); };
      let clipped = false;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (raw.saturationFlags[(y + dy!) * nativeWidth + x + dx!]! !== 0) clipped = true;
      samples.push({ sampleId: "block-" + x + "-" + y, red: Math.max(1e-9, value(0, 0)), green: Math.max(1e-9, (value(1, 0) + value(0, 1)) / 2), blue: Math.max(1e-9, value(1, 1)), weight: 1, clipped });
    }
    const policy = body.whiteBalance.awbPolicies[0]!;
    assume("output.whiteBalance.auto", "model", { policyId: policy.policyId, samples: samples.length },
      "Grey-world AWB of the body's " + policy.policyId + " policy over 2×2 CFA block means of the pre-WB RAW; the RAW is then rendered again with that intent (the same radiance queries are repeated).");
    whiteBalanceState = estimateAutoWhiteBalance({ stateId: "facade-wb-auto", profile: body.whiteBalance, policyId: policy.policyId,
      sampleSet: { imageStateId: "facade-pre-wb-raw", inputDomain: "relative-pre-wb-camera-linear-rgb", samples } });
    finalRawInput = { raw: buildRawInput(intentOf(whiteBalanceState)), sceneBinding, maximumProviderEvaluations: environmentRaw.maximumProviderEvaluations };
    const wbTick = progress("white-balance", plan.tileCount);
    if (tabulated || dngParts !== undefined) {
      // #394: the RAW codes do not depend on the white-balance intent (it is development metadata), so the tabulated RAW is
      // kept with the plan of the measured intent instead of being rendered again.
      rawOutput = { ...rawOutput, raw: { ...rawOutput.raw, plan: calculateNativeRawPlan(finalRawInput.raw) } };
      for (let k = 0; k < plan.tileCount; k++) wbTick();
    } else {
    // A second lean RAW pass with the measured intent. It gives the same RAW as re-running the sensor stage on a
    // retained optical stage, and is faster: retaining the optical stage takes the first pass off the lean executor.
    const wbTask = createNativeEnvironmentRawTask(finalRawInput, {
      readTile: markInternalNativeTileReader(async (request: Parameters<typeof readTile>[0]): Promise<NativeEnvironmentRawTile> => { const tile = await readTile(request); wbTick(); return tile; }),
      evaluateRadiance: rawProvider().evaluateRadiance, ...(pupil ? { evaluateApertureRadiance: provider.evaluateApertureRadiance } : {}), yieldControl });
    await runTask(wbTask);
    rawOutput = wbTask.takeOutput();
    }
  }
  const wbMs = Date.now() - wbStarted, devStarted = Date.now();
  const colorProfile: ExportSensorColorProfile = { schemaVersion: "0.1.0", profileId: IDS.spectral, profileVersion: SIMULATE_CAPTURE_FACADE_VERSION, colorSamplingProfileId: IDS.cfa,
    channelIds: ["red", "green", "blue"], scientificStatus: "approximation", referenceIlluminant: "D65", normalizedCameraChannelsToXyz: CAMERA_TO_XYZ,
    evidence, limitations: ["Diagonal camera→XYZ matrix of the idealized colorimetric (Luther–Ives) sensor; exact up to spectral quadrature."] };
  const phaseProfiles = builtInDemosaic ? builtInDemosaic.phaseProfiles : bilinearPhaseProfiles();
  const developmentWhiteBalance = whiteBalanceState ? "apply-resolved-sensor-gains" as const : "not-required" as const;


  // DNG (2.0): the packed native RAW itself, before development takes ownership of it.
  let dng: NativeRawDng | undefined;
  if (format === "dng") {
    const noise = Object.fromEntries(CHANNELS.map((channel) => {
      const resolved = resolveSensorReadoutRegime({ profile: regimeByChannel[channel].readoutProfile as Parameters<typeof resolveSensorReadoutRegime>[0]["profile"], regimeId: regimeByChannel[channel].regimeId });
      return [channel, { conversionGainElectronsPerCode: resolved.regime.systemConversionGainElectronsPerCode.value / (resolved.regime.adc.digitalGain ?? 1),
        readNoiseRmsElectrons: resolved.combinedReadNoiseRmsElectrons }];
    }));
    const dngStarted = clockMs();
    dng = await serializeNativeRawDng({ raw: rawOutput.raw, colorProfile, noise, ...(dngCapturedAtUtc === undefined ? {} : { capturedAtUtc: dngCapturedAtUtc }),
      ...(textMetadata ? { textMetadata } : {}) });
    encodeMs = clockMs() - dngStarted;
    assumeTextMetadata(TEXT_METADATA_LAYOUT.dng);
    checkAbort();
    assume("output.dng", "model", { writer: "serializeNativeRawDng", schemaVersion: dng.schemaVersion, whiteLevel: dng.whiteLevel, blackLevels: dng.blackLevels,
      noiseProfile: dng.noiseProfile, unrepresentedSaturationFlagCount: dng.unrepresentedSaturationFlagCount },
      "Lossless uncompressed 16-bit CFA DNG of exactly the packed native RAW codes: per-phase BlackLevel, WhiteLevel = smallest per-phase effective white, ActiveArea and DefaultCrop from the capture geometry, ColorMatrix1/ForwardMatrix1 from the facade's diagonal camera→XYZ profile (D65), AsShotNeutral from the white-balance intent, BaselineExposure 0, and NoiseProfile from each channel's readout regime (conversion gain ÷ digital gain, combined read noise; Poisson + Gaussian + quantization only). No linear master or developed image is declared; saturation flags below WhiteLevel are not representable and are counted.");
  }
  if (dngParts !== undefined) return dng;

  // Development
  const development: Omit<NativeRawDevelopmentInput, "raw"> = { phaseProfiles, colorProfile,
    whiteBalance: developmentWhiteBalance, rendering, highlightMode, ...(mirrorBorder ? { borderHandling: "mirror" as const } : {}),
    ...(exposureCompensationStops === 0 ? {} : { exposureCompensationStops }),
    maximumRetainedPayloadBytes: developmentPlan.outputBytes + outputWidth * outputHeight * 3 * (rendering.bitDepth / 8) };
  let developed: { raw: NativeRawOutput; integerSamples: Uint8Array | Uint16Array; highlight: RawHighlightDiagnostics; diagnostics: SdrRenderingResult["diagnostics"] };
  let gamutMappingDiagnostics: { method: "cielab-hue-preserving-chroma-compression"; kneeFraction: number; adjustedPixelCount: number; lightnessClippedPixelCount: number } | undefined;
  // Development detail (#552): diffraction correction on the developed linear colour, then the unsharp mask between the sRGB
  // transfer and quantization. Both need the whole developed image, so a request with either develops through developLinearSrgb
  // (the native development's own operator); without them every path below is unchanged.
  const detailRequested = sharpening !== undefined || diffractionCorrectionOption !== undefined;
  const detailDiagnostics: SimulateCaptureDetailDiagnostics = {};
  let diffractionFilter: ReturnType<typeof designDiffractionCorrectionFilter> | undefined;
  if (diffractionCorrectionOption) {
    const workingFNumber = fNumber * imageDistanceMm / focalLengthMm;
    const settings: DiffractionCorrectionSettings = { ...diffractionCorrectionOption, kernelRadiusPixels: diffractionCorrectionOption.kernelRadiusPixels ??
      defaultDiffractionCorrectionRadiusPixels(workingFNumber, diffractionCorrectionOption.wavelengthNm, pitch) };
    if (diffractionCorrectionOption.kernelRadiusPixels === undefined) assume("output.diffractionCorrection.kernelRadiusPixels", "default", settings.kernelRadiusPixels,
      "FIR radius: the Airy pattern's third dark ring (3.2383·λ·N_w) at the design wavelength, in pixels, rounded up, within 1–16.");
    diffractionFilter = designDiffractionCorrectionFilter({ workingFNumber, pixelPitchMicrometers: pitch, settings });
    assume("output.diffractionCorrection", "model", { model: "development-detail", modelVersion: DEVELOPMENT_DETAIL_MODEL_VERSION, method: "bounded-wiener-tikhonov-fir",
      stage: "linear colour after demosaic, colour and white balance; before the tone curve", fNumber, workingFNumber, ...settings, pixelPitchMicrometers: pitch,
      cutoffCyclesPerPixel: diffractionFilter.cutoffCyclesPerPixel, nyquistCyclesPerPixel: 0.5, nyquistAreaBeyondCutoffFraction: diffractionFilter.nyquistAreaBeyondCutoffFraction,
      designPeakGain: diffractionFilter.designPeakGain, responsePeakGain: diffractionFilter.responsePeakGain, responseMaximumBeyondCutoff: diffractionFilter.responseMaximumBeyondCutoff,
      edgeHandling: "clamp", recoversBeyondCutoff: false },
    "Deconvolution with the known diffraction OTF of an ideal, aberration-free circular pupil at the capture's working f-number N_w = N·v/f, H(s) = (2/π)(acos s − s√(1 − s²)), s = f/f_c, f_c = 1/(λ·N_w) " +
      "(MIT OpenCourseWare 2.71, lectures 21–22). Gain G = min(maximumGain, H(1 + α)/(H² + α)) (Wiener deconvolution with a constant noise-to-signal ratio α, as in scikit-image's Wiener–Hunt filter), " +
      "sampled, inverse transformed and truncated to a raised-cosine (2R + 1)² FIR with unit DC gain, applied to each linear channel with clamped edges. " +
      "The OTF is exactly zero beyond f_c: that detail never reached the sensor, and no correction restores it. The design gain there is 0; responseMaximumBeyondCutoff is the truncated FIR's leakage, which passes only noise and aliasing. " +
      "Below f_c the gain is bounded, so attenuated detail is only partly restored and noise is amplified by up to the measured responsePeakGain. " +
      "Not inverted: the pixel aperture, optical anti-aliasing filter, demosaic blur, defocus and aberrations. One design wavelength for all channels (the simulated blur is polychromatic).");
  }
  const correctLinear = (rgb: Float64Array): Float64Array => {
    if (!diffractionFilter) return rgb;
    const corrected = applyDiffractionCorrection(rgb, outputWidth, outputHeight, diffractionFilter);
    detailDiagnostics.diffractionCorrection = { ...corrected.diagnostics, cutoffCyclesPerPixel: diffractionFilter.cutoffCyclesPerPixel,
      responsePeakGain: diffractionFilter.responsePeakGain, responseMaximumBeyondCutoff: diffractionFilter.responseMaximumBeyondCutoff };
    return corrected.samples;
  };
  if (sharpening) assume("output.sharpening", "model", { model: "development-detail", modelVersion: DEVELOPMENT_DETAIL_MODEL_VERSION, method: "unsharp-mask", ...sharpening,
    kernelRadiusPixels: Math.ceil(3 * sharpening.radiusPixels), domain: "srgb-encoded", stage: "after the tone curve, gamut handling and sRGB transfer; before quantization", edgeHandling: "clamp" },
  "Unsharp mask y = x + amount·(x − G_σ∗x) where |x − G_σ∗x| ≥ threshold (the GIMP and ImageMagick unsharp mask: radius, amount, threshold), per channel on the sRGB-encoded values in [0, 1], " +
    "separable Gaussian truncated at ⌈3σ⌉ with clamped edges, then clipped to [0, 1] and rounded. It raises contrast at edges and creates halos (overshoot and undershoot; see diagnostics.detail.sharpening) " +
    "and sharpens noise above the threshold. It adds no optical detail.");
  if (detailRequested) assume("output.developmentOrder", "model", [...(exposureGain === 1 ? [] : ["development exposure push (RAW)"]), "demosaic", "colour and white balance", ...(diffractionCorrectionOption ? ["diffraction correction (linear)"] : []),
    "rendering exposure and tone curve", "gamut handling", "transfer function", ...(sharpening ? ["unsharp mask"] : []), "quantization"],
  "Development detail order: the deconvolution acts on linear light, where the blur is a convolution; the unsharp mask acts on the encoded values just before quantization." +
    (exposureGain === 1 ? "" : " A development exposure push (output.exposureCompensationStops) scales the black-subtracted, white-normalized RAW first, so pushed sites clip at white before the deconvolution sees them."));
  if (ahd || (detailRequested && !linearPath)) {
    let lastYield = Date.now();
    const linear = await developLinearSrgb({ ...development, raw: rawOutput.raw }, async (completed, total) => {
      onProgress?.({ stage: "development", completedTileCount: completed, totalTileCount: total });
      if (Date.now() - lastYield >= 8) { await yieldControl(); checkAbort(); lastYield = Date.now(); }
    }, ahd ? { yieldControl: (): Promise<void> => yieldControl(), checkAbort, onDemosaicMs: (ms: number): void => { demosaicMs = ms; } } : undefined);
    const rgb = correctLinear(linear.rgb);
    if (!linearPath && sharpening) {
      const rendered = renderSdrWithUnsharpMask(rgb, outputWidth, outputHeight, rendering, sharpening);
      detailDiagnostics.sharpening = rendered.sharpening;
      developed = { raw: rawOutput.raw, integerSamples: rendered.codes, highlight: linear.highlight, diagnostics: { renderingNegativeSampleCount: rendered.counts.negative,
        renderingAboveReferenceSampleCount: rendered.counts.above, toneChangedSampleCount: rendered.counts.changed, gamutClippedLowSampleCount: rendered.counts.low,
        gamutClippedHighSampleCount: rendered.counts.high, captureSaturation: "consumed-in-raw-development" } };
    } else if (!linearPath) {
      // The native development's SDR kernel, row by row, on the AHD-developed linear sRGB.
      const maximum = 2 ** rendering.bitDepth - 1, tone = prepareSdrPixelTone(rendering), scratch = new Float64Array(3);
      const codes = rendering.bitDepth === 8 ? new Uint8Array(outputWidth * outputHeight * 3) : new Uint16Array(outputWidth * outputHeight * 3);
      const counts: SdrPixelCounts = { negative: 0, above: 0, changed: 0, low: 0, high: 0, outOfGamut: false };
      for (let y = 0; y < outputHeight; y++) renderSdrRunInto(rgb, y * outputWidth * 3, outputWidth, rendering, tone, 2 ** rendering.renderingExposureEv, maximum, codes, y * outputWidth * 3, scratch, counts);
      developed = { raw: rawOutput.raw, integerSamples: codes, highlight: linear.highlight, diagnostics: { renderingNegativeSampleCount: counts.negative,
        renderingAboveReferenceSampleCount: counts.above, toneChangedSampleCount: counts.changed, gamutClippedLowSampleCount: counts.low,
        gamutClippedHighSampleCount: counts.high, captureSaturation: "consumed-in-raw-development" } };
    } else {
      const mapping = perceptual ? prepareRgbGamutMapping({ colorSpace: colorEncoding!, method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION }) : undefined;
      const encoded = encodeSdrFromLinear(rgb, colorEncoding!, pngBitDepth!, mapping);
      developed = { raw: rawOutput.raw, integerSamples: encoded.samples, highlight: linear.highlight, diagnostics: encoded.diagnostics };
      if (mapping) gamutMappingDiagnostics = { method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION,
        adjustedPixelCount: encoded.adjustedPixelCount, lightnessClippedPixelCount: encoded.lightnessClippedPixelCount };
    }
  } else if (!linearPath) {
    const devTask = createNativeRawDevelopmentTask({ ...development, raw: rawOutput.raw }, { yieldControl,
      onProgress: (p) => onProgress?.({ stage: "development", completedTileCount: p.completedTileCount, totalTileCount: p.totalTileCount }) });
    await runTask(devTask);
    developed = devTask.takeOutput();
  } else {
    // Wide gamut: the native development operator up to linear sRGB/D65 (unclipped), then XYZ → target primaries.
    let lastYield = Date.now();
    const linear = await developLinearSrgb({ ...development, raw: rawOutput.raw }, async (completed, total) => {
      onProgress?.({ stage: "development", completedTileCount: completed, totalTileCount: total });
      if (Date.now() - lastYield >= 8) { await yieldControl(); checkAbort(); lastYield = Date.now(); }
    });
    {
      const mapping = perceptual ? prepareRgbGamutMapping({ colorSpace: colorEncoding!, method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION }) : undefined;
      const encoded = encodeSdrFromLinear(correctLinear(linear.rgb), colorEncoding!, pngBitDepth!, mapping);
      developed = { raw: rawOutput.raw, integerSamples: encoded.samples, highlight: linear.highlight, diagnostics: encoded.diagnostics };
      if (mapping) {
        gamutMappingDiagnostics = { method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION,
          adjustedPixelCount: encoded.adjustedPixelCount, lightnessClippedPixelCount: encoded.lightnessClippedPixelCount };
        assume("output.gamutMapping", "model", { method: "cielab-hue-preserving-chroma-compression", kneeFraction: PERCEPTUAL_GAMUT_KNEE_FRACTION, colorSpace: colorEncoding },
          "prepareRgbGamutMapping: CIELAB L* and hue held, chroma above 90 % of the boundary chroma C_max(L*, h) compressed with a tanh knee so it never reaches C_max (Morovič 2008, §10). In-gamut colours below the knee are unchanged; saturated in-gamut colours above it are desaturated slightly. L* ≥ 100 (above the RAW white) maps to white. CIELAB hue is not perceptually constant for saturated blues, so they can shift toward purple.");
      }
      assume("output.colorEncoding.conversion", "model", { from: "linear-srgb-d65 (unclipped)", via: "CIE XYZ", to: colorEncoding, gamutHandling: perceptual ? "cielab-hue-preserving-chroma-compression" : "clip-components",
        transfer: colorEncoding === "rec2020" ? "bt2020-oetf (= BT.709 OETF)" : "srgb (W3C CSS Color 4)" },
        "Developed with the native development operator (demosaic, per-site white-level clip, WB, highlight mode, diagonal camera→XYZ, XYZ→linear sRGB) but before any sRGB clipping, so colours outside sRGB are kept; converted to " +
        colorEncoding + " through XYZ (matrices from primaries and D65, as in W3C CSS Color 4), " + (perceptual ? "gamut-mapped perceptually (output.gamutMapping)" : "components clipped to [0, 1] in the target gamut") +
        ", then encoded and rounded to nearest. RAW white maps to display white, as in the sRGB path.");
    }
  }
  const devMs = Date.now() - devStarted, jpegStarted = Date.now();
  let jpeg: Uint8Array | undefined;
  if (format === "jpeg") {
    const samples = developed.integerSamples as Uint8Array;
    const jpegSha = await sha256Hex(Array.from(samples.subarray(0, Math.min(samples.length, 4096))).join(",") + ":" + samples.length + ":" + sourceSha256);
    const source = { captureId: IDS.capture, imageStateId: "facade-developed", artifactId: "facade-developed-srgb8", sha256: jpegSha, width: outputWidth, height: outputHeight, encoding: "encoded-srgb-8-rgb" as const };
    // The encoder reads every pixel once, in source tiles of at most 256 × 32 aligned to the crop origin.
    const reads = Math.ceil(outputHeight / 32) * Math.ceil(outputWidth / 256), jpegTick = progress("jpeg", reads);
    const jpegTask = createPrintJpegTask({ source, crop: { x: 0, y: 0, width: outputWidth, height: outputHeight }, outputWidth, outputHeight, quantizationStep: jpegStep!,
      maximumEncodedBytes: Math.max(65536, outputWidth * outputHeight * 6), maximumProviderReads: reads,
      // The JPEG records its admission plan, so the raised limit is passed (and recorded) only when the image needs it.
      ...(raisedPixels === undefined || outputWidth * outputHeight <= PRINT_JPEG_LIMITS.maximumPixels ? {} : { maximumPixels: raisedPixels }) }, {
      readTile: async (request) => {
        jpegTick();
        const out = new Uint8Array(request.width * request.height * 3);
        for (let row = 0; row < request.height; row++) out.set(samples.subarray(((request.y + row) * outputWidth + request.x) * 3, ((request.y + row) * outputWidth + request.x + request.width) * 3), row * request.width * 3);
        return { ...request, samples: out };
      }, yieldControl });
    const jpegEncodeStarted = clockMs();
    await runTask(jpegTask);
    jpeg = jpegTask.takeOutput().bytes;
    if (textMetadata) jpeg = addJpegTextMetadata(jpeg, textMetadata);
    assumeTextMetadata(TEXT_METADATA_LAYOUT.jpeg);
    encodeMs = clockMs() - jpegEncodeStarted;
    assume("output.jpeg", "model", { encoder: "photivra-print-jpeg", iccProfile: "photivra-srgb" }, "Baseline JPEG from the existing print JPEG encoder with an embedded sRGB ICC profile; the source digest covers a sample prefix, length and scene digest.");
  }
  const jpegMs = Date.now() - jpegStarted;
  let png: Uint8Array | undefined;
  if (format === "png") {
    const pngStarted = clockMs();
    png = serializePngImage({ width: outputWidth, height: outputHeight, bitDepth: pngBitDepth!, samples: developed.integerSamples, colourEncoding: pngColourEncoding(colorEncoding!),
      ...(raisedPixels === undefined || outputWidth * outputHeight <= PNG_ENCODER_LIMITS.maximumPixels ? {} : { maximumPixels: raisedPixels }) });
    if (textMetadata) png = addPngTextMetadata(png, textMetadata);
    assumeTextMetadata(TEXT_METADATA_LAYOUT.png);
    encodeMs = clockMs() - pngStarted;
    assume("output.png", "model", { encoder: "serializePngImage", bitDepth: pngBitDepth, colourEncoding: pngColourEncoding(colorEncoding!) },
      "Deterministic PNG (8/16-bit RGB, in-house zlib) with the colour encoding signalled in the file: the sRGB chunk for sRGB, otherwise a cICP chunk with ITU-T H.273 primaries/transfer code points. No mastering-display (mDCV) or content-light-level (cLLI) metadata is written.");
  }

  const ranOptions = new Set<SimulateCaptureCostOption>([...(pupil ? ["lens.pupilSampling" as const] : []), ...(projection !== undefined ? ["lens.projection" as const] : []),
    ...(distortion ? ["lens.distortion" as const] : []), ...(vignetting ? ["lens.vignetting" as const] : []), ...(lensPsf ? ["lens.psf" as const] : []),
    ...(catalogue ? ["lens.catalogue" as const] : []),
    ...(diffraction ? ["lens.diffraction" as const] : []), ...(defocusSiteKernels || catalogueDefocusApplied ? ["lens.defocus" as const] : []), ...(antiAliasing ? ["sensor.antiAliasing" as const] : []), ...(boxAperture ? ["sensor.pixelAperture.box" as const] : []),
    ...(temporalSampleCount > 1 ? ["sensor.temporalSampleCount" as const] : []), ...(rotating ? ["motion.rotation" as const] : []),
    ...(rollingSchedule ? ["motion.shutter.rolling" as const] : []), ...(mirrorBorder ? ["output.borderHandling.mirror" as const] : []), ...(region ? ["output.region" as const] : []),
    ...(needsAuto ? ["output.whiteBalance.auto" as const] : []), ...(ahd ? ["output.demosaic.ahd" as const] : []),
    ...(highlightMode === "reconstruct" ? ["output.highlightMode.reconstruct" as const] : []), ...(wideGamut ? ["output.colorEncoding.wide-gamut" as const] : []),
    ...(perceptual ? ["output.gamutMapping.perceptual" as const] : []), ...(diffractionFilter ? ["output.diffractionCorrection" as const] : []),
    ...(sharpening ? ["output.sharpening" as const] : []), ...(format === "jpeg" || format === "png" || format === "dng" ? ["output.format." + format as SimulateCaptureCostOption] : [])]);
  // #552: the detail stages' contracts, in execution order inside the development.
  const detailContracts = diffractionFilter ? ["designDiffractionCorrectionFilter", "applyDiffractionCorrection"] : [], sdrContract = sharpening ? "renderSdrWithUnsharpMask" : "SDR rendering kernel";
  return Object.freeze({
    facadeVersion: SIMULATE_CAPTURE_FACADE_VERSION, engineApiVersion: ENGINE_API_VERSION,
    image: { width: outputWidth, height: outputHeight, format, samples: developed.integerSamples, ...(jpeg ? { jpeg } : {}), ...(png ? { png, colorEncoding: colorEncoding! } : {}), ...(dng ? { dng: dng.bytes } : {}) },
    raw: developed.raw, plan: developmentPlan,
    ...(region && regionNative ? { region: { ...region, frameWidth: width, frameHeight: height, nativeRect: { ...regionNative } } } : {}),
    request: { environmentRaw: finalRawInput, siteInput, development, whiteBalanceState,
      ...(diffraction ? { diffraction: { profile: diffraction, psf: diffractionPsf!, execution: diffractionObjectSpace ? "object-space-convolution" as const :
        defocusImageSpace ? "image-space-convolution" as const : "environment-psf-quadrature" as const } } : {}) },
    exposure: { mode, settings: { fNumber, shutterSeconds, iso: resolvedIso }, ev100: Math.log2(fNumber ** 2 / shutterSeconds), ...isoReport,
      metering, meteredSceneLuminanceCdPerSquareMeter: meteredLuminance, standardExposureDeviationStops: exposureDeviationStops,
      standardExposureIlluminanceLux: exposureIlluminanceLux, greyCardDeviationStops: exposureGreyCardDeviationStops, resolution },
    scene: { sceneId: chart ? "chart:" + chart.preset : callerScene!.sceneId, preset: scenePreset, parameters: chart ? chart.parameters : {},
      illuminant: { id: illuminant.id, description: illuminant.description, illuminanceLux }, distanceM: subjectDistanceM,
      framedWidthM: 2 * metresPerFrameUnit, framedHeightM: 2 * metresPerFrameUnit * aspect, ...(chartReport ? { chart: chartReport } : {}), sourceSha256 },
    diagnostics: { providerEvaluationCount, highlight: developed.highlight, rendering: developed.diagnostics, ...(gamutMappingDiagnostics ? { gamutMapping: gamutMappingDiagnostics } : {}),
      ...(detailRequested ? { detail: Object.freeze(detailDiagnostics) } : {}),
      timingsMs: { raw: rawMs, whiteBalance: wbMs, development: devMs, jpeg: jpegMs, total: Date.now() - started,
        ...(diffraction && diffractionObjectSpace && !defocusSiteKernels ? { diffraction: diffractionMs } : {}), ...(defocusSiteKernels ? { defocus: defocusMs } : {}), ...(demosaicMs === undefined ? {} : { demosaic: demosaicMs }),
        ...(encodeMs === undefined ? {} : { encode: encodeMs }) },
      options: Object.freeze(SIMULATE_CAPTURE_COST_OPTIONS.filter((option) => ranOptions.has(option))), fast: fastReport },
    provenance: { scientificStatus: "approximation" as const, cameraPresetId: preset.presetId, cameraPresetVersion: preset.presetVersion,
      evidence: [...FACADE_EVIDENCE, ...preset.evidence],
      composedContracts: ["resolveGenericEquipmentExposureCapabilities", "meterRelativeExposure", "createExposureMeterTargetFromMeteringResult",
        "resolve" + (mode === "manual" ? "Manual" : mode === "aperture-priority" ? "AperturePriority" : mode === "shutter-priority" ? "ShutterPriority" : "ProgramAuto") + "ExposureMode",
        ...(rollingSchedule ? ["resolveElectronicRollingShutterExposureSchedule", "createRollingShutterCaptureExposureSchedule"] : []),
        ...(diffraction ? ["createDiffractionLimitedPsfProfile", ...(diffractionObjectSpace ? ["resolveLensPsfConvolutionKernels", ...(defocusSiteKernels ? [] : ["calculateIrradianceConvolution"])] : [])] : []),
        ...(defocusSiteKernels ? ["calculateDefocusCircle", defocusImageSpace ? "defocus disc site kernel (image-space convolution)" : "defocus disc site kernel (object-space convolution)"] : []),
        ...(antiAliasing ? ["resolveAntiAliasingSpatialKernel"] : []), "resolveGenericIsoSignalChain", "createNativeEnvironmentRawTask", ...(needsAuto ? ["estimateAutoWhiteBalance"] : []),
        ...(builtInDemosaic ? ["createBuiltInBayerDemosaicProfiles"] : []), ...(ahd ? ["createAhdDemosaicTask"] : []),
        ...(ahd ? ["native RAW development operator (colour, after AHD)", ...detailContracts, ...(linearPath ? ["resolveRgbColorSpace", ...(perceptual ? ["prepareRgbGamutMapping"] : [])] : [sdrContract])] :
          linearPath ? ["native RAW development operator (linear, pre-clip)", ...detailContracts, "resolveRgbColorSpace", ...(perceptual ? ["prepareRgbGamutMapping"] : [])] :
          detailRequested ? ["native RAW development operator (linear, pre-clip)", ...detailContracts, sdrContract] : ["createNativeRawDevelopmentTask"]),
        ...(jpeg ? ["createPrintJpegTask"] : []), ...(png ? ["serializePngImage"] : []), ...(dng ? ["resolveSensorReadoutRegime", "serializeNativeRawDng"] : [])],
      limitations: ["Educational approximation: synthetic tier sensor values, idealized colorimetric sensor, planar Lambertian scene and point optics; not a calibrated camera emulation.",
        "Not offered by the facade: atmospheric haze and polarizers (the scene-radiance provider contract declares no volumetric transport or polarization), flash, video, HDR brackets and processing operators; compose those APIs directly."] },
    assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a)))
  });
}

/** Chart preset ids accepted by `simulateCapture({ scene: { preset } })`. */
export const SIMULATE_CAPTURE_CHART_PRESETS = CHART_SCENE_PRESETS;
