# facade/simulate-capture.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## DisplayViewHighlightDiagnostics

#533: the display view's highlight count. `simulateCapture` reports `diagnostics.highlight.saturatedPixelCount`, the
output pixels with at least one clipped contributing RAW site (a site flagged saturated or at the white level) counted on its
one noise sample (`sensor.noiseSeed`). The display view renders no RAW, so it reports that count's expected value over the
noise: Σ_j w_j·P_j over the real output pixels j of the rendered region, w_j the part of pixel j inside the region (1 inside,
a fraction at a region edge that cuts a real pixel) and P_j the probability, under the view's own site model (each site's
normalized value normal with its exact expected electrons, shot, dark, read and ADC noise, as the expected value uses), that at
least one site pixel j's demosaic reads is at or above the white level, the sites' noises independent. It is estimated as the
view's expected value is (`view.estimation`: exact over every real pixel, or the stratified samples), so it is not an integer.

- Where every contributing site is far from white (more than 8.5 noise standard deviations either side) P_j is exactly 0 or 1,
  and the expected count equals the capture's count of the same pixels exactly (they then have no noise to differ by).
- Regions are additive: the counts of regions that tile the view sum to the whole view's count (up to floating-point summation
  order), each display pixel's share being the same in every region that renders it.
- With the bilinear demosaic the sites are the capture's own contributing sites. With AHD the capture counts every site within
  3 sites of the pixel (its interpolation reach, clipped to the raster); the view counts the 25–29 of those 49 that its AHD
  candidates read, so its count can be lower where a clipped area ends in a corner or a speck 2–3 sites away diagonally
  (an approximation; along a straight clipped edge the two agree).
- It never changes a sample of the view. On the GPU (`prepareDisplayView` with `gpu`) it is the CPU reference's value: the
  kernel decides P_j only where it is certainly 0 or 1 and the host computes every other pixel's share with the reference.

```ts
export interface DisplayViewHighlightDiagnostics {
  /** Expected number of saturated real output pixels in the rendered region (a non-negative real number; see above). */
  saturatedPixelCount: number;
  /** The statistic: always "expected-value" (the capture's own count is one noise sample of it). */
  statistic: "expected-value";
}
```

## DisplayViewResult

Result of {@link simulateDisplayView }: the full-resolution capture resized for display, estimated; not a capture.

```ts
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
```

## IdealReferenceResult

Result of {@link simulateIdealReference}: an ideal reference image, not a capture (no RAW, plan or request).

```ts
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
```

## serializeSimulatedCaptureDngFromParts

Writes the whole-frame DNG of `options` (`output.format: "dng"`, no `output.region`) from the packed RAW of region renders of
the same request (#391), so the RAW can render in parallel. A region render's native sites are the same sites as the whole
render's (each site's seeds come from its index in the whole raster), so the joined RAW is the whole render's RAW, and the
request is resolved and written exactly as `simulateCapture` writes its DNG: the bytes are the same. The parts must cover
every native site of the frame; where they overlap (each region carries the demosaic margin) their sites must agree. Region
renders of the request with any format serve (a region's own `output.format` does not change its RAW). A region cannot take
`output.whiteBalance: "auto"` or `output.dng`: render the parts with a fixed white balance (the RAW codes do not depend on the
white-balance intent) and pass the DNG's own options here, where auto white balance is measured over the joined frame.

```ts
export async function serializeSimulatedCaptureDngFromParts(options: SimulateCaptureOptions, parts: readonly SimulateCaptureDngPart[]): Promise<NativeRawDng>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES

Default midpoint samples per axis of `sensor.pixelAperture: "box"`.

```ts
SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES = 4
```

## SIMULATE_CAPTURE_COST_OPTIONS

Options reported in `diagnostics.options` (2.1), in this order, when they ran: the ones that change how much work
a capture does. `motion.rotation` is a non-zero angular velocity; `sensor.temporalSampleCount` a count above 1.

```ts
SIMULATE_CAPTURE_COST_OPTIONS = Object.freeze(["lens.pupilSampling", "lens.projection", "lens.distortion", "lens.vignetting", "lens.psf",
  "lens.diffraction", "lens.defocus", "lens.catalogue", "sensor.antiAliasing", "sensor.pixelAperture.box", "sensor.temporalSampleCount", "motion.rotation", "motion.shutter.rolling", "output.borderHandling.mirror", "output.region",
  "output.whiteBalance.auto", "output.demosaic.ahd", "output.highlightMode.reconstruct", "output.colorEncoding.wide-gamut", "output.gamutMapping.perceptual",
  "output.diffractionCorrection", "output.sharpening", "output.format.jpeg", "output.format.png", "output.format.dng"] as const)
```

## SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX

Default illuminance, lux: an 18 % Lambertian grey card (L = 0.18·E/π) then gets exactly the CIPA DC-004 standard
output sensitivity reference exposure H = 10/S at f/8, 1/125 s, ISO 100:
E = π·10·N²/(0.65·t·S·0.18) = π·80 000/11.7 ≈ 21 480.98 lux.

```ts
SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX = Math.PI * sosReferenceLuminance(DEFAULTS.fNumber, DEFAULTS.shutterSeconds, DEFAULTS.iso) /
  GREY_CARD_REFLECTANCE
```

## SIMULATE_CAPTURE_FACADE_VERSION

Version of how the facade builds requests. It changes whenever the same input would build a different request.

```ts
SIMULATE_CAPTURE_FACADE_VERSION = "1.0.0" as const
```

## SIMULATE_CAPTURE_FAST_OPTIONS

The options that take the exact-or-fast flag (#395), in the path style of {@link SIMULATE_CAPTURE_COST_OPTIONS}: each accepts
the record form with `fast` and is reported in `diagnostics.fast.applied` when it runs. Every one of them takes the flag,
whether or not it has a fast method yet; one without runs exact and reports `false`.

```ts
SIMULATE_CAPTURE_FAST_OPTIONS = Object.freeze(["lens.diffraction", "lens.catalogue", "sensor.antiAliasing", "sensor.pixelAperture.box", "output.demosaic.ahd"] as const)
```

## SIMULATE_CAPTURE_METERING_MODES

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SIMULATE_CAPTURE_METERING_MODES: readonly SimulateCaptureMetering[] = Object.freeze(["scene-average", "grey-card"] as const)
```

## SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS

Default stratified samples per axis of a display view (`view.samplesPerAxis`): 16 × 16 sampled real pixels per display pixel with detail, 4 × 4 where it is uniform.

```ts
SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS = 16
```

## simulateCapture

Simulates one still capture of a planar scene and returns the developed image, the packed RAW, the full
underlying request/plan, provenance and every assumption made. See docs/QUICK_START.md.

```ts
export async function simulateCapture(options: SimulateCaptureOptions): Promise<SimulateCaptureResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## SimulateCaptureAssumption

One decision the facade made: a default, a derived value or a fixed modelling choice.

```ts
export interface SimulateCaptureAssumption {
  /** Dotted option path or modelling topic, for example "exposure.shutterSeconds" or "model.lens-psf". */
  id: string;
  kind: "default" | "derived" | "model";
  value: unknown;
  explanation: string;
}
```

## SimulateCaptureAutoIsoAfterMaximum

#516: what aperture priority does with Auto ISO once the ISO reaches the body's Auto ISO maximum and the exposure is
still under the meter target: `"allow-slower-shutter"` lengthens the shutter past the slowest preferred shutter to reach
the target; `"hold-preferred-shutter"` keeps the preferred shutter and leaves the exposure under target.

```ts
export type SimulateCaptureAutoIsoAfterMaximum = "allow-slower-shutter" | "hold-preferred-shutter";
```

## SimulateCaptureAutoIsoReport

#516: how Auto ISO chose the ISO (`exposure.iso: "auto"`), reported in the result's `exposure.autoIso`. The full
resolver output stays in the capture's `exposure.resolution`.

```ts
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
```

## SimulateCaptureAutomaticSlowestShutterOptions

#504: the settings of `exposure.autoIso.slowestPreferredShutterSeconds: "auto"`. Every field is optional; the defaults are
labelled generic values, recorded as `default` assumptions.

```ts
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
```

## SimulateCaptureAutomaticSlowestShutterReport

#504: the automatic slowest preferred shutter in the Auto ISO report.

```ts
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
```

## SimulateCaptureBorderHandling

`margin` renders extra native sites around the output, as far as the kernel reaches. `mirror` renders
exactly the output and reads mirrored (reflect-101) copies of the missing border sites. Mirroring is
checked to keep the CFA (colour filter array) pattern consistent.

```ts
export type SimulateCaptureBorderHandling = "margin" | "mirror";
```

## SimulateCaptureColorEncoding

PNG colour encoding. `srgb` is the developed sRGB output. The others take the developed linear
colour (camera → XYZ → linear sRGB/D65, unclipped) and convert it through CIE XYZ into the target
primaries:
- `display-p3`: Display P3 primaries (W3C CSS Color 4 `display-p3`; also SMPTE EG 432-1) with the
  sRGB transfer function;
- `rec2020`: ITU-R BT.2020 primaries and OETF.
PQ and HLG (BT.2100) are not part of 2.0; see THIRD_PARTY.md.

```ts
export type SimulateCaptureColorEncoding = "srgb" | "display-p3" | "rec2020";
```

## SimulateCaptureCostOption

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureCostOption = typeof SIMULATE_CAPTURE_COST_OPTIONS[number];
```

## SimulateCaptureDemosaic

Demosaic. `bilinear`: the built-in Bayer kernels (`createBuiltInBayerDemosaicProfiles`). `ahd` (2.1): adaptive
homogeneity-directed demosaicing (`createAhdDemosaicTask`, after Hirakawa & Parks 2005), a non-linear
edge-directed method that reduces zipper and false colour on sharp edges.

```ts
export type SimulateCaptureDemosaic = "bilinear" | "ahd";
```

## SimulateCaptureDemosaicRecord

`output.demosaic` as a record (#395): the demosaic and its `fast` override (see {@link SimulateCaptureOptions.fast}).

```ts
export interface SimulateCaptureDemosaicRecord { kind: SimulateCaptureDemosaic; fast?: boolean }
```

## SimulateCaptureDetailDiagnostics

`diagnostics.detail` (#552): what the development detail stages did. Present only when one ran.

```ts
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
```

## SimulateCaptureDiffractionCorrection

`output.diffractionCorrection` (#552): the Wiener–Tikhonov gain G(s) = min(maximumGain, H(s)(1 + α)/(H(s)² + α)) on the circular-pupil
OTF H at s = f/f_c, f_c = 1/(λ·N_w), as a (2R + 1)² FIR per channel. Every field is optional.

```ts
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
```

## SimulateCaptureDngPart

One part of a whole-frame DNG (#391): a region render's packed RAW and where its native sites lie (`result.raw`, `result.region`).

```ts
export interface SimulateCaptureDngPart {
  raw: Pick<NativeRawOutput, "codes" | "blackLevels" | "digitalSaturationCodes" | "saturationFlags" | "effectiveSaturationCodes">;
  region: { nativeRect: { x: number; y: number; width: number; height: number } };
}
```

## SimulateCaptureExposureMode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureExposureMode = "manual" | "aperture-priority" | "shutter-priority" | "program";
```

## SimulateCaptureFastOption

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureFastOption = typeof SIMULATE_CAPTURE_FAST_OPTIONS[number];
```

## SimulateCaptureFastReport

`diagnostics.fast` of a capture or display view (#395): what was asked for and what ran.

```ts
export interface SimulateCaptureFastReport {
  /** True when `fast: true` was given at the top level or in any option's record. */
  requested: boolean;
  /** Each fast-capable option that ran, in {@link SIMULATE_CAPTURE_FAST_OPTIONS} order: true where its fast method ran. */
  applied: Readonly<Partial<Record<SimulateCaptureFastOption, boolean>>>;
  /** `engine-reference` when every option ran exact; `approximation-with-a-priori-bound` when any fast method ran (the WebGPU execution record's values). */
  assurance: "engine-reference" | "approximation-with-a-priori-bound";
}
```

## SimulateCaptureLensCatalogueRecord

`lens.catalogue` as a record (#568): the lens id as `kind` and the `fast` override (see {@link SimulateCaptureOptions.fast}).

```ts
export interface SimulateCaptureLensCatalogueRecord { kind: string; fast?: boolean }
```

## SimulateCaptureLensDistortion

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureLensDistortion =
  | { kind: "radial"; profile: RadialDistortionProfile }
  | { kind: "brown-conrady"; profile: BrownConradyDistortionProfile };
```

## SimulateCaptureMetering

2.14: what the meter reads. `scene-average` (the default): the body's 16 × 16-zone meter reads the scene's luminance.
`grey-card`: incident metering; every zone reads the luminance 0.18·E/π of an 18 % Lambertian grey card under the
request's illuminance E, so the automatic modes choose settings whose `greyCardDeviationStops` is 0 (up to their steps
and limits), whatever the scene's reflectances.

```ts
export type SimulateCaptureMetering = "scene-average" | "grey-card";
```

## SimulateCaptureMotion

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SimulateCaptureMotion {
  /** Constant camera angular velocity, rad/s, in the engine's pitch/yaw/roll convention. Missing axes are 0. */
  angularVelocityRadPerSec?: { pitch?: number; yaw?: number; roll?: number };
  /** Default "global". `rolling` derives the exposure schedule from the body's rolling readout declaration. */
  shutter?: "global" | "rolling";
  /** Rolling shutter only: time from the first to the last line over the simulated frame, in s. Default: the body's declared readout skew. */
  rollingShutterSkewSeconds?: number;
}
```

## SimulateCaptureOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
     * Optional `widestFNumber` and `narrowestFNumber` (within `IDEAL_LENS_LIMITS`, widest ≤ narrowest; each defaults to its bound)
     * narrow the range: `fNumber` must lie in it, and shutter priority and program choose apertures only in it (program limits its
     * line to a range that does not hold f/4–f/16, #583). Default off.
     */
    ideal?: { focalLengthMm: number; widestFNumber?: number; narrowestFNumber?: number };
    /**
     * Opt-in (#549): a lens of the generic lens catalogue by id (`GENERIC_LENS_IDS`, for example "pv-50-1.2-pro" or "pv-50-1.8";
     * docs/LENS_CATALOGUE.md). Like `prime`, its focal length is the full-frame equivalent ÷ the simulated frame's diagonal crop
     * factor and it replaces the tier lens's focal length and f-number range (the transmission is kept). The capture renders the
     * lens's character, all labelled approximations: its PSF (diffraction with the lens's Seidel aberrations, axial and lateral
     * colour, at the resolved f-number and focus) through the environment PSF quadrature, its radial distortion, its vignetting
     * and, for the fisheyes, the equisolid projection. Flare, focus breathing and bokeh shape are not rendered. Not combinable
     * with `prime`, `focalLengthMm`, `projection`, `distortion`, `vignetting`, `psf`, `diffraction` or `pupilSampling` (the
     * lens sets them); `defocus` convolves the disc into the lens's PSF. The display view renders it with the PSF taken per field zone (#569; docs/DISPLAY_VIEW.md). Default off.
     * #568: the record form `{ kind: <lens id>, fast }` overrides the top-level `fast` flag for this option; the fast method
     * blends the PSF between exactly resolved kernels on a field grid and tabulates each site's expected signal
     * (docs/LENS_CATALOGUE.md, "Fast method").
     */
    catalogue?: string | SimulateCaptureLensCatalogueRecord;
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
   * only. `diagnostics.fast` reports what was requested and what ran. `lens.catalogue` has a fast method (#568); the other options run exact.
   */
  fast?: boolean;
  /** Aborting cancels the running task; the promise rejects with a domain error and returns no partial image. */
  signal?: AbortSignal;
  /** Called after each committed RAW, development or JPEG tile. Cannot change output. */
  onProgress?: (progress: SimulateCaptureProgress) => void;
}
```

## SimulateCaptureOutputFormat

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureOutputFormat = "srgb-8" | "srgb-16" | "jpeg" | "png" | "dng";
```

## SimulateCapturePixelAperture

Pixel aperture (2.3): centre sampling, or the square photosite integrated with an N × N midpoint rule; `fast` (#395) overrides the top-level flag.

```ts
export type SimulateCapturePixelAperture = "point" | "box" | { kind: "box"; samplesPerAxis?: number; fast?: boolean };
```

## SimulateCaptureProgress

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SimulateCaptureProgress {
  stage: "raw" | "white-balance" | "development" | "jpeg";
  completedTileCount: number;
  totalTileCount: number;
}
```

## SimulateCaptureResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
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
```

## SimulateCaptureSensorAntiAliasing

Optical anti-aliasing (low-pass) filter (2.1), modelled as birefringent point splitting: each image point is
split into equally bright copies (the engine's `normalized-point-splitting-kernel` optical-stack response).
- `four-spot`: two crossed birefringent plates; copies at (±d/2, ±d/2), weight 1/4 each, MTF |cos(π·f_x·d)·cos(π·f_y·d)|.
- `two-spot`: one plate splitting along `axis`; copies at ±d/2, weight 1/2 each, MTF |cos(π·f·d)|.
- `point-splitting`: the engine contract itself, offsets in micrometres (+x right, +y down) and positive weights
  summing to 1 (at most 16 components, each within 4 sites).
d = `separationSites` × pixel pitch, 0 < separationSites ≤ 4, default 1 (first MTF zero at the sensor's Nyquist
frequency 1/(2·pitch)).

```ts
export type SimulateCaptureSensorAntiAliasing =
  | { kind: "four-spot"; separationSites?: number; fast?: boolean }
  | { kind: "two-spot"; axis: "horizontal" | "vertical"; separationSites?: number; fast?: boolean }
  | { kind: "point-splitting"; components: readonly AntiAliasingPointSplitComponent[]; fast?: boolean };
```

## SimulateCaptureSharpening

`output.sharpening` (#552): unsharp mask y = x + amount·(x − G_σ∗x) where |x − G_σ∗x| ≥ threshold (GIMP and ImageMagick
unsharp mask), per channel on sRGB-encoded values in [0, 1], then clipped to [0, 1]. Every field is optional.

```ts
export interface SimulateCaptureSharpening {
  /** Gaussian standard deviation σ in output pixels, (0, 8]; the kernel reaches ⌈3σ⌉. Default 1. */
  radiusPixels?: number;
  /** Gain on the detail signal, (0, 5]. Default 0.5. */
  amount?: number;
  /** Detail smaller than this (encoded units, [0, 1]) is left unchanged. Default 0 (every difference is sharpened). */
  threshold?: number;
}
```

## SimulateCaptureWhiteBalance

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SimulateCaptureWhiteBalance =
  | "scene-illuminant"
  | "auto"
  | "none"
  | { kelvin: number; tint?: number }
  | { channelGains: { red: number; green: number; blue: number } };
```

## SimulateDisplayViewOptions

The display size and sampling of {@link simulateDisplayView }.

```ts
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
```

## simulateIdealReference

The ideal reference of a capture request (2.3): the same scene, framing, chart size, output size, region and pixel
grid as `simulateCapture(options)` would use, rendered with no camera effects (no lens blur, diffraction, defocus,
distortion, vignetting, anti-aliasing filter, mosaic or demosaic, noise, dark signal or motion), at the capture's
own exposure and developed with its white balance, colour matrices, tone curve and encoding (the
`reference.exposure` assumption). Deterministic and cheap: no RAW is simulated. Formats srgb-8, srgb-16 and png.
The result is labelled `kind: "ideal-reference"`; it is not a capture.

```ts
export async function simulateIdealReference(options: SimulateCaptureOptions): Promise<IdealReferenceResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
