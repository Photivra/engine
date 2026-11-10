// SPDX-License-Identifier: Apache-2.0

/**
 * The public entry point of the display view (`simulateDisplayView`) and its renderer. `simulate-capture.ts` resolves the
 * request (`runCapture`) and calls the renderer it is given, so a bundle that imports only `simulateCapture` or
 * `simulateIdealReference` does not contain the display view (`display-view.ts`) or the portable evaluations it uses.
 * The design and its error analysis are in docs/DISPLAY_VIEW.md.
 */

import { ENGINE_API_VERSION } from "../core/version.js";
import { resolvePortableColorTemperatureWhiteBalance } from "../color/white-balance.js";
import { resolveCaptureColorModel } from "../color/capture-color.js";
import { prepareSensorColorDevelopment } from "../color/sensor-color-development.js";
import { buildExpectedSignalInput } from "./expected-signal-setup.js";
import type { DisplayViewExpectedSignalInput } from "./expected-signal.js";
import { resolveSensorReadoutRegime } from "../sensor/raw-readout.js";
import { resolvePortableChartScene, type ChartScene } from "./chart-scenes.js";
import { resolvePortableCaptureIlluminant, calculateIlluminantIrradianceScale } from "./scene-radiance.js";
import { ahdCandidateKernels, computeDisplayViewCorrectionStates, createDisplayViewExpectedSignal, displayViewCorrectionKey, renderDisplayView, type DisplayViewChannelReadout,
  type DisplayViewCorrectionSetup, type DisplayViewCorrectionStateKeys, type DisplayViewCorrectionStateSet, type DisplayViewExpectedSignal, type DisplayViewRenderResult, type DisplayViewSetup,
  EXACT_AREA_MEAN_MAX_PIXELS } from "./display-view.js";
import { runCapture, apertureNodeOffsets, bilinearPhaseProfiles, clockMs, fail, sceneIlluminantWhiteBalance, CAMERA_TO_XYZ, CHANNELS, DARK_CURRENT_ELECTRONS_PER_SECOND, FACADE_EVIDENCE,
  SIMULATE_CAPTURE_FACADE_VERSION, DISPLAY_VIEW_WITHOUT_VIEW, allowKeys, parseDisplayViewOption, type DisplayViewResult, type DisplayViewRunContext, type ParsedDisplayView,
  type SimulateCaptureAssumption, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "./simulate-capture.js";
import { createHostYield } from "./host-yield.js";
import { createDefocusDiscSiteKernel } from "../optics/defocus-disc-kernel.js";
import { cpuDisplayViewExecution, parsePrepareDisplayViewOptions, type DisplayViewExecution, type DisplayViewGpuRequest, type PrepareDisplayViewOptions } from "./display-view-gpu.js";
import type { DisplayViewGpuSession } from "./display-view-gpu-session.js";

export { serializeDisplayViewCorrectionStates, bindDisplayViewCorrectionStates, type DisplayViewCorrectionStateKeys, type DisplayViewCorrectionStateSet } from "./display-view.js";

/**
 * The display view of a capture request: the image the real full-resolution capture (`simulateCapture(options)`) would
 * give after it is resized to `view.width` × `view.height` by area averaging in linear light, estimated at a cost that
 * follows the display pixels, not the capture's. Optics (lens diffraction, the anti-aliasing filter, the pixel aperture)
 * act at the real pixel pitch; the colour mosaic, demosaic and development are those of the real pixels; the noise is
 * that of the average of the real pixels, demosaic correlation included; exposure, white balance and tone are the
 * capture's. The result is labelled `kind: "display-view"`; it is not a capture.
 * @see docs/DISPLAY_VIEW.md and docs/QUICK_START.md, "Display view".
 */
export async function simulateDisplayView(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<DisplayViewResult> {
  return await runCapture(options, "display-view", view, (context) => renderDisplayViewResult(context)) as DisplayViewResult;
}
/** Options of one {@link PreparedDisplayView} render. */
export interface PreparedDisplayViewRenderOptions {
  /** Aborting cancels this render only; the promise rejects with a domain error. The request's own `signal` applies to preparing only. */
  signal?: AbortSignal;
}
/**
 * 2.7: a display-view request resolved once (`prepareDisplayView`). `render(view)` gives the same result as
 * `simulateDisplayView(options, view)` for the prepared options, byte for byte (samples, view, exposure, scene, diagnostics
 * and assumptions; only `diagnostics.timingsMs` differ, and they cover the render only), without repeating the request's
 * setup: use it to render one view in many regions, for example on each worker of a progressive display.
 */
export interface PreparedDisplayView {
  /**
   * Renders a view of the prepared request. Renders may run concurrently; they share no state except read-only setup and the
   * realm's AHD correction states, which never change a byte (docs/DISPLAY_VIEW.md, "AHD at low signal"). With `gpu: "auto"`
   * or `"require"` (#481) GPU renders of one prepared view run one at a time on its device, and `diagnostics.fast.execution`
   * says whether the GPU or the CPU reference rendered the view, and why.
   */
  render(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewResult>;
  /**
   * 2.11 (#481): releases the WebGPU device the view acquired (none with `gpu: "off"`, or when `gpuDevice` gave an accelerator,
   * whose device its owner keeps). Later renders run the CPU reference labelled `fallbackReason: "disposed"` (`"auto"`) or fail
   * with that reason (`"require"`). Idempotent.
   */
  dispose(): void;
  /**
   * 2.10 (#447): the key of this request's AHD low-signal correction states, or null when the request has no AHD
   * (`output.demosaic` other than "ahd"). Every input of the key is fixed when the request is prepared; two prepared views
   * with the same key read the same states.
   */
  correctionKey(): string | null;
  /**
   * 2.10 (#447): the grid keys of every correction state a render of `view` reads (ascending, whether or not this realm holds
   * them), found by a render of the view's region that records the states instead of computing them. No image is returned;
   * it costs about one render whose states are all held. Fails with an InvalidConfigurationError when the request has no AHD.
   */
  collectCorrectionStates(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateKeys>;
  /**
   * 2.10 (#447): computes the correction states of `gridKeys` (from `collectCorrectionStates`, or a share of them) as a render
   * would, stores them in this realm's cache and returns their values, for {@link bindDisplayViewCorrectionStates} in
   * another realm. States this realm holds are read, not computed. Yields and honours `signal` like `render`. Fails with an
   * InvalidConfigurationError when the request has no AHD or a grid key is out of range.
   */
  computeCorrectionStates(gridKeys: Int32Array, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateSet>;
}
/**
 * 2.7 (#387): resolves a {@link simulateDisplayView} request once, without a view, and returns a handle whose `render(view)`
 * renders its views. The setup it does once (request validation, the camera, lens, scene, chart and illuminant, the channel
 * responses through the environment chain, the diffraction kernels, readout moments, demosaic tables and colour matrix) costs
 * about 0.3–1.3 s per call on a 24 MP request; a region costs only its own pixels. Errors in the request are raised here;
 * errors in the view by `render`.
 *
 * 2.11 (#481): `prepareOptions.gpu` chooses the renderer: `"off"` is the CPU reference, today's bytes; `"auto"` renders
 * on WebGPU when a conforming device is available and the request is supported, else on the CPU, labelled; `"require"` fails
 * instead of falling back (`ImageKernelExecutionError`, acquisition failures here, later ones from `render`). 2.20.0: the default is
 * `"auto"` when the request resolves to fast (the view's default) and `"off"` with `fast: false`. `gpuDevice` is a
 * WebGPU entry point or an `ImageKernelAccelerator` whose device the view shares; without it the engine acquires one device
 * for the prepared view (the request's `signal` aborts the acquisition) and `dispose()` releases it. The realm's
 * `setWebGpuEnabled(false)` vetoes both GPU modes (`webgpu-disabled`). See docs/DISPLAY_VIEW.md, "Rendering on the GPU".
 * @see docs/QUICK_START.md, "Display view".
 */
export async function prepareDisplayView(options: SimulateCaptureOptions, prepareOptions?: PrepareDisplayViewOptions): Promise<PreparedDisplayView> {
  // 2.20.0: the GPU follows the request's fast (the display view's default is fast): "auto" when fast, "off" when exact.
  const gpuOptions = parsePrepareDisplayViewOptions(prepareOptions, (options as { fast?: unknown } | null | undefined)?.fast !== false);
  let frameWidth = 0, frameHeight = 0;
  const prepared = await runCapture(options, "display-view", DISPLAY_VIEW_WITHOUT_VIEW, (context) => {
    frameWidth = context.width; frameHeight = context.height;
    return Promise.resolve(prepareView(context));
  }) as PreparedViewParts;
  // The GPU code is loaded only when a GPU mode asks for it, so bundles on the default stay without it.
  const session: DisplayViewGpuSession | null = gpuOptions.gpu === "off" ? null :
    await (await import("./display-view-gpu-session.js")).openDisplayViewGpuSession(gpuOptions, prepared.gpuRequest, (options as { signal?: AbortSignal }).signal);
  /** One call's start times, cancellation (its own signal) and yielding. */
  const runOf = (renderOptions: PreparedDisplayViewRenderOptions | undefined): ViewRun => {
    const started = Date.now(), viewStarted = clockMs();
    const signal = renderOptions === undefined ? undefined : allowKeys(renderOptions, "render options", ["signal"]).signal as AbortSignal | undefined;
    if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof signal.aborted !== "boolean")) fail("signal must be an AbortSignal.");
    const checkAbort = (): void => { if (signal?.aborted) fail("simulateCapture aborted."); };
    checkAbort();
    return { started, viewStarted, checkAbort, yieldControl: createHostYield().yieldControl, signal };
  };
  const correctionOf = (caller: string): DisplayViewCorrectionSetup => prepared.correction ??
    fail(caller + ": the prepared request has no AHD low-signal correction (it applies with output.demosaic \"ahd\").");
  const handle: PreparedDisplayView = Object.freeze({
    async render(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewResult> {
      const run = runOf(renderOptions);
      const parsed = parseDisplayViewOption(view, frameWidth, frameHeight);
      return await prepared.render(parsed, run, undefined, session);
    },
    dispose(): void { session?.dispose(); },
    correctionKey(): string | null { return prepared.correction ? displayViewCorrectionKey(prepared.correction) : null; },
    async collectCorrectionStates(view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateKeys> {
      const run = runOf(renderOptions), correction = correctionOf("collectCorrectionStates");
      const parsed = parseDisplayViewOption(view, frameWidth, frameHeight);
      return { key: displayViewCorrectionKey(correction)!, gridKeys: await prepared.collect(parsed, run) };
    },
    async computeCorrectionStates(gridKeys: Int32Array, renderOptions?: PreparedDisplayViewRenderOptions): Promise<DisplayViewCorrectionStateSet> {
      const run = runOf(renderOptions), correction = correctionOf("computeCorrectionStates");
      return await computeDisplayViewCorrectionStates({ ...correction, yieldControl: run.yieldControl, checkAbort: run.checkAbort }, gridKeys);
    }
  });
  PREPARED_INTERNALS.set(handle, async (view, renderOptions) => {
    const internals: ViewInternals = {};
    const result = await prepared.render(parseDisplayViewOption(view, frameWidth, frameHeight), runOf(renderOptions), internals, session);
    return { result, internals: internals.value! };
  });
  return handle;
}
/** The internal render of each prepared view (the same render as `render`, keeping its renderer's result). */
const PREPARED_INTERNALS = new WeakMap<PreparedDisplayView, (view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions) =>
  Promise<{ result: DisplayViewResult; internals: DisplayViewRenderResult }>>();
/**
 * Internal (not exported from the package): renders a view of a prepared view as `render` does (the same GPU session and labels)
 * and also returns the renderer's noise-free expected linear values and noise standard deviations, whichever renderer ran (#480's
 * GPU producer, `scripts/lib/display-view-gpu-page.mjs`).
 */
export async function renderPreparedDisplayViewWithInternals(prepared: PreparedDisplayView, view: SimulateDisplayViewOptions, renderOptions?: PreparedDisplayViewRenderOptions):
  Promise<{ result: DisplayViewResult; internals: DisplayViewRenderResult }> {
  const render = PREPARED_INTERNALS.get(prepared);
  if (!render) fail("renderPreparedDisplayViewWithInternals needs a view returned by prepareDisplayView.");
  return await render(view, renderOptions);
}
/**
 * Internal (not exported from the package): the display view plus its noise-free expected linear values and noise standard
 * deviations, for the validation scripts and tests.
 */
export async function simulateDisplayViewWithInternals(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions):
  Promise<{ result: DisplayViewResult; internals: DisplayViewRenderResult; signal: DisplayViewExpectedSignal; setup: DisplayViewSetup; signalInput: DisplayViewExpectedSignalInput }> {
  const internals: ViewInternals = {};
  const result = await runCapture(options, "display-view", view, (context) => renderDisplayViewResult(context, internals)) as DisplayViewResult;
  return { result, internals: internals.value!, signal: internals.signal!, setup: internals.setup!, signalInput: internals.signalInput! };
}

/**
 * AHD low-signal correction (display view): draws per flat-neighbourhood state, and the pixel noise (linear light) above which it
 * applies. 2.20.0: these are its fast method (`output.demosaic.ahd`, the view's default); exact takes 4× the draws (half the
 * states' common offset) and corrects every noisy pixel (threshold 0).
 */
const DISPLAY_VIEW_AHD_CORRECTION_DRAWS = [8192, 2048], DISPLAY_VIEW_AHD_CORRECTION_THRESHOLD = [0, 0.01];

type ViewInternals = { value?: DisplayViewRenderResult; signal?: DisplayViewExpectedSignal;
  /** #478: the render's setup and the expected signal's input, for the GPU display view's tests. */
  setup?: DisplayViewSetup; signalInput?: DisplayViewExpectedSignalInput };
/** What one render of a prepared view needs from its call: its start times, cancellation and yielding. */
interface ViewRun { started: number; viewStarted: number; checkAbort: () => void; yieldControl: () => Promise<void>; signal?: AbortSignal | undefined }
type RenderPreparedView = (view: ParsedDisplayView, run: ViewRun, viewInternals?: ViewInternals, gpu?: DisplayViewGpuSession | null) => Promise<DisplayViewResult>;
/**
 * A prepared request: its render, its collect pass (#447: the grid keys of the correction states a view's region reads) and
 * the inputs of its correction states (undefined without AHD).
 */
interface PreparedViewParts {
  render: RenderPreparedView;
  collect(view: ParsedDisplayView, run: ViewRun): Promise<Int32Array>;
  correction: DisplayViewCorrectionSetup | undefined;
  /** #481: what a GPU renderer is asked to support. */
  gpuRequest: DisplayViewGpuRequest;
}

/** Renders the display view of a resolved request (the last step of `runCapture` for "display-view"). */
async function renderDisplayViewResult(context: DisplayViewRunContext, viewInternals?: ViewInternals): Promise<DisplayViewResult> {
  const viewStarted = clockMs();
  return await prepareView(context).render(context.parsedView!, { started: context.started, viewStarted, checkAbort: context.checkAbort, yieldControl: context.yieldControl }, viewInternals);
}

/**
 * Internal (#387): the part of a display view that depends only on the request, done once (the portable illuminant, chart and
 * white balance, the channel responses, query offsets, diffraction kernels, readout moments, demosaic tables and colour
 * matrix). The returned function renders one view from it; it keeps no state between renders (each has its own expected-
 * signal caches, lookup count and assumptions), so its results are those of separate calls.
 */
function prepareView(context: DisplayViewRunContext): PreparedViewParts {
  const { ahd, antiAliasing, aspect, axisChannelResponse, boxSamples, buildProvider, callerScene, chart, materialLayers, chartReport, chartSize, diffraction, diffractionPsf, fNumber, focalLengthMm, focusDistanceM, height, highlightMode, exposureGain, illuminanceLux, illuminant, illuminantOption, imagingArea, intentOf, metresPerFrameUnit, noiseSeed, outputOptions, pitch, preset, provider, regimeByChannel, resolvedIso, isoReport, standardExposureDeviationStops, standardExposureIlluminanceLux, greyCardDeviationStops, metering, sceneOption, scenePreset, shutterSeconds, subjectDistanceM, toneCurve, whiteBalanceOption, whiteBalanceState, width, margin, mode, nativeHeight, nativeWidth, sourceSha256 } = context;
  const kelvinInput = context.kelvinWhiteBalanceInput;
  // The engine's illuminant formulas (Planckian, CIE A, daylight locus) evaluated with the portable power and e^x − 1, so
  // the view's radiances, irradiance scale and scene-illuminant white balance have the same bits in every JavaScript
  // engine; they differ from the capture's own by at most a few ulps (docs/DISPLAY_VIEW.md, "Same bytes in every engine").
  const viewIlluminant = resolvePortableCaptureIlluminant(illuminantOption), viewIrradianceScale = calculateIlluminantIrradianceScale(viewIlluminant.shape, illuminanceLux);
  const viewProvider = buildProvider(viewIlluminant, viewIrradianceScale);
  const viewWhiteBalanceState = whiteBalanceOption === "scene-illuminant" ? sceneIlluminantWhiteBalance(viewIlluminant) : kelvinInput ? resolvePortableColorTemperatureWhiteBalance(kelvinInput) : whiteBalanceState;
  // The chart's materials likewise (a step wedge's geometric levels use the portable power); same geometry and order.
  const viewChart = chart ? resolvePortableChartScene({ scene: sceneOption as ChartScene, aspect: chartSize ? chartSize.heightM / chartSize.widthM : aspect }) : undefined;
  if (chart && viewChart!.materials.length !== chart.materials.length) fail("simulateDisplayView: the chart's materials could not be resolved portably.");
  const { electronsPerRadiance, wavelengths, relativePerElectron } = axisChannelResponse("simulateDisplayView");
  const perNode = CHANNELS.map((c) => Float64Array.from(wavelengths, (nm) => electronsPerRadiance[c].get(nm) ?? 0)) as [Float64Array, Float64Array, Float64Array];
  // The tabulated expected signal's input (#394: shared with the capture's tabulated RAW path).
  const sceneMaterials = viewChart ? viewChart.materials : callerScene?.kind === "material-function" ? callerScene.materials : undefined;
  // Defocus (#492): the geometric disc on the site lattice, combined with the diffraction kernels in the tables (expected-signal-setup.ts).
  // #553: with bokeh options (blades, spherical aberration) the capture built the shaped kernel; it replaces the disc.
  const defocusDisc = context.defocus, defocusKernel = defocusDisc && defocusDisc.diameterSites > 0 ? defocusDisc.siteKernel ?? createDefocusDiscSiteKernel(defocusDisc.diameterSites) : null;
  const shaped = defocusDisc?.siteKernel !== undefined;
  // The combined radius is at most 32 + 512 sites (the diffraction and disc caps), as in the capture. #564: above 64 sites the kernel is
  // convolved by runs after the in-focus signal (expected-signal.ts), the same sums regrouped.
  const diffractionRadius = diffraction ? diffraction.kernelRadiusSamples : 0, combinedRadius = defocusKernel ? diffractionRadius + defocusKernel.radius : diffractionRadius;
  const { offsets, signalInput } = buildExpectedSignalInput({ nativeWidth, nativeHeight, width, wavelengths, perNode, apertureNodes: apertureNodeOffsets(boxSamples), boxSamples,
    antiAliasing, pitch, defocus: defocusKernel, ...(context.lensPsf ? { lensKernels: context.lensPsf.axisKernels(wavelengths) } : {}), diffraction: diffraction ? { radius: diffraction.kernelRadiusSamples, psf: diffractionPsf!.configuration.psf, profileWavelengths: diffraction.profile.axes.wavelengthNm } : undefined,
    materials: sceneMaterials && provider.chartMaterialAt ? { materialAt: provider.chartMaterialAt,
      list: [...sceneMaterials.map((m, index) => (m.kind === "neutral" ? { neutral: m.reflectance } : { radiance: (nm: number): number => viewProvider.materialRadiance!(index, nm) })),
        ...(chartSize ? [{ neutral: chartSize.surroundReflectance }] : [])],
      whiteRadiance: (nm: number): number => viewIrradianceScale * viewIlluminant.shape.evaluate(nm) / Math.PI } : undefined,
    radianceAt: viewProvider.radianceAt, imagingArea, focalLengthMm, focusDistanceM, subjectDistanceM, metresPerFrameUnit, caller: "simulateDisplayView" });
  const kernels = signalInput.kernels, largeDefocus = signalInput.largeKernel;
  // Readout moments per channel: normalized value k·e with variance k²·(e + σ_read²) plus the ADC quantization (1/12 code², times d² before a digital gain d).
  // #556: a development exposure push G multiplies the normalized value before the per-site clip at white: k → G·k and the constant variance → G²·(…).
  // Without a push G = 1, and x·1 = x exactly in IEEE 754 arithmetic, so the moments are bit-identical to those without the push.
  const readout = CHANNELS.map((channel): DisplayViewChannelReadout => {
    const { readoutProfile, regimeId } = regimeByChannel[channel];
    const resolved = resolveSensorReadoutRegime({ profile: readoutProfile as Parameters<typeof resolveSensorReadoutRegime>[0]["profile"], regimeId });
    const k = relativePerElectron[channel], digitalGain = resolved.regime.adc.digitalGain ?? 1, gain = resolved.regime.systemConversionGainElectronsPerCode.value;
    const codeSpan = digitalGain / (gain * k), read = resolved.combinedReadNoiseRmsElectrons;
    const quantizationCodes = digitalGain * digitalGain / 12 + (digitalGain === 1 ? 0 : 1 / 12);
    return { perElectron: exposureGain * k, darkElectrons: DARK_CURRENT_ELECTRONS_PER_SECOND * shutterSeconds,
      constantVariance: exposureGain * exposureGain * (k * k * read * read + quantizationCodes / (codeSpan * codeSpan)) };
  }) as [DisplayViewChannelReadout, DisplayViewChannelReadout, DisplayViewChannelReadout];
  const phases = bilinearPhaseProfiles(), demosaicTable: { dx: number; dy: number; weight: number }[][][] = [];
  for (const phase of phases) demosaicTable[phase.phaseY * 2 + phase.phaseX] = CHANNELS.map((c) => phase.profile.kernels.find((k) => k.outputChannelId === c)!.contributions
    .map((t) => ({ dx: t.offsetX, dy: t.offsetY, weight: t.weight })));
  const viewIntent = intentOf(viewWhiteBalanceState), viewGains = viewIntent ? [viewIntent.channelGains.red, viewIntent.channelGains.green, viewIntent.channelGains.blue] : null;
  const colour = prepareSensorColorDevelopment(CAMERA_TO_XYZ as unknown as Parameters<typeof prepareSensorColorDevelopment>[0], viewGains, highlightMode);
  const toSrgb = resolveCaptureColorModel().xyzToCameraRgb, m = colour.cameraToXyz;
  const matrix = [0, 1, 2].map((r) => [0, 1, 2].map((c) => toSrgb[r]![0]! * m[0]![c]! + toSrgb[r]![1]! * m[1]![c]! + toSrgb[r]![2]! * m[2]![c]!));
  // Reach of a footprint's pixels into the scene, in sites: the demosaic (1), the largest query offset and the kernel radius.
  const reachSites = (ahd ? 3 : 1) + Math.ceil(Math.max(0, ...offsets.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y))))) + (kernels ? kernels.radius : 0) + (largeDefocus ? largeDefocus.radius : 0);
  // The inputs of the AHD correction states (fixed here, so the correction key is too; #447).
  const gains = colour.appliedGains as [number, number, number], clipLevel = Math.min(...colour.appliedGains), viewToneCurve = toneCurve as "identity" | "positive-reinhard-per-channel";
  const ahdFast = +context.viewFast.ahd, correctionDraws = DISPLAY_VIEW_AHD_CORRECTION_DRAWS[ahdFast]!, correctionThreshold = DISPLAY_VIEW_AHD_CORRECTION_THRESHOLD[ahdFast]!;
  const ahdCorrection = ahd ? { labMatrix: CAMERA_TO_XYZ.map((row) => row.map((value, c) => value * (viewGains ? viewGains[c]! : 1))), drawsPerState: correctionDraws,
    thresholdVariance: correctionThreshold * correctionThreshold } : undefined;
  // 2.20.0: a quarter of the samples per axis where the pilot finds no detail is the view's fast sampling; exact samples every pixel fully.
  const uniformSamplesOf = (k: number): number => context.viewFast.uniformSampling ? Math.max(1, Math.round(k / 4)) : k;
  const ahdCandidates = ahd ? [0, 1, 2, 3].map((p) => ahdCandidateKernels(p % 2, Math.floor(p / 2))) : undefined;
  // #491: a fixed-size chart's placement for the GPU material lookup (the provider's chart-local units cu = u·m/h and the surround beyond the chart).
  const placement = chartSize ? { chartUnitsPerFrameUnit: metresPerFrameUnit / (chartSize.widthM / 2), aspect: chartSize.heightM / chartSize.widthM } : null;
  /** The renderer's setup of one view (with `ahdCollect`, a collect pass), and its expected signal. */
  const setupOf = (v: ParsedDisplayView, { checkAbort, yieldControl }: ViewRun, ahdCollect?: Set<number>): { setup: DisplayViewSetup; signal: DisplayViewExpectedSignal } => {
    const viewRegion = v.region ?? { x: 0, y: 0, width: v.width, height: v.height };
    // The native columns the region's windows span, beyond one window's width: a filled band need not be wider (a speed hint).
    // #563: through the lens (projection, distortion, vignetting, rotation) when the request has them.
    const signal = (context.lens ?? createDisplayViewExpectedSignal)(signalInput, Math.ceil((viewRegion.width + 2) * nativeWidth / v.width));
    return { signal, setup: { frameWidth: width, frameHeight: height, margin, nativeWidth, nativeHeight, viewWidth: v.width, viewHeight: v.height,
      region: viewRegion, samplesPerAxis: v.samplesPerAxis, uniformSamplesPerAxis: uniformSamplesOf(v.samplesPerAxis), reachSites, bitDepth: v.bitDepth, seed: noiseSeed, signal, readout, demosaic: demosaicTable,
      ...(ahdCandidates && ahdCorrection ? { candidates: ahdCandidates, ahdCorrection } : {}), ...(ahdCollect ? { ahdCollect } : {}),
      gains, clipLevel, matrix, toneCurve: viewToneCurve, yieldControl, checkAbort, gpu: { signalInput, chart: viewChart ?? null, layers: materialLayers ?? null, placement, ...(defocusKernel && !largeDefocus ? { defocusRadius: defocusKernel.radius } : {}) } } };
  };
  const correction: DisplayViewCorrectionSetup | undefined = ahdCorrection ? { seed: noiseSeed, readout, gains, clipLevel, matrix, toneCurve: viewToneCurve, ahdCorrection } : undefined;
  const collect = async (v: ParsedDisplayView, run: ViewRun): Promise<Int32Array> => {
    const keys = new Set<number>();
    await renderDisplayView(setupOf(v, run, keys).setup);
    return Int32Array.from(keys).sort();
  };
  // #492: out of focus the view reads the defocus disc (its kernel in signalInput.kernels); the GPU Quality site pass gathers it (step 2c).
  const gpuRequest: DisplayViewGpuRequest = { ahd, lens: !!context.lens, defocus: defocusKernel !== null, ...(largeDefocus ? { largeDefocus: true } : {}), diffraction: diffraction !== undefined, antiAliasing: antiAliasing !== undefined, boxSamples, toneCurve: viewToneCurve,
    scene: chart ? "chart" : materialLayers ? "material-layers" : callerScene!.kind };
  const render: RenderPreparedView = async (v, run, viewInternals, gpu) => {
    const { started, viewStarted } = run;
    const assumptions: SimulateCaptureAssumption[] = [...context.assumptions];
    const assume = (id: string, kind: SimulateCaptureAssumption["kind"], value: unknown, explanation: string): void => { assumptions.push({ id, kind, value, explanation }); };
    const { setup, signal } = setupOf(v, run), viewRegion = setup.region;
    // #481: the GPU session renders on the device when it can, else through the CPU reference, and labels which ran.
    const cpu = (): Promise<DisplayViewRenderResult> => renderDisplayView(setup);
    const { rendered, execution }: { rendered: DisplayViewRenderResult; execution: DisplayViewExecution } = gpu ? await gpu.render(setup, run.signal, cpu)
      : { rendered: await cpu(), execution: cpuDisplayViewExecution("off", null, null, null) };
    if (viewInternals) { viewInternals.value = rendered; viewInternals.signal = signal; viewInternals.setup = setup; viewInternals.signalInput = signalInput; }
    const viewMs = clockMs() - viewStarted, scaleX = width / v.width, scaleY = height / v.height;
    assume("view.definition", "model", { resampling: "area-average-linear-light", width: v.width, height: v.height, frameWidth: width, frameHeight: height, scaleX, scaleY },
      "The image the full-resolution capture of this request would give after resizing to " + v.width + " × " + v.height + ": each display pixel is the area-weighted mean, in linear light (sRGB samples decoded with the sRGB EOTF), " +
      "of the real output pixels its rectangle covers (" + scaleX + " × " + scaleY + " real pixels), then sRGB-encoded and rounded. The real capture's own samples are rounded to the view's bit depth before averaging.");
    const uniformSamplesPerAxis = uniformSamplesOf(v.samplesPerAxis);
    const siteSentence = "the expected electrons of the real sites its demosaic reads are exact at the real pitch (the scene sampled at those sites through the pixel aperture, " +
      "anti-aliasing filter and diffraction kernels, with the capture's own query arithmetic, so the colour mosaic and its aliasing are the real sensor's), and the per-site clip at white, the highlight clip, the tone curve " +
      "and the clip to [0, 1] act on the pixel's own noise distribution, approximated as normal.";
    // 2.8 (#393): where a footprint holds at most 25 real pixels (and at most K²), every real pixel of it is evaluated once with its exact weight.
    if (rendered.estimation === "exact-area-mean") {
      assume("view.estimation", "model", { method: "exact-area-mean-over-real-pixels", samplesPerAxis: v.samplesPerAxis, realPixelsPerDisplayPixel: scaleX * scaleY,
        evaluatedRealPixels: rendered.sampleCount },
        "Each display pixel's expected value is the exact area mean of the real pixels its rectangle covers: every real pixel it touches is evaluated once and weighted by its overlap with the rectangle " +
        "(w_j / A, summing to 1), so there is no sampling error. This applies because each rectangle holds " + scaleX * scaleY + " real pixels (" + scaleX + " × " + scaleY + "), at most " + EXACT_AREA_MEAN_MAX_PIXELS + " and at most K² = " + v.samplesPerAxis * v.samplesPerAxis + "; coarser views use a stratified estimate, which costs less there. " +
        "For each real pixel " + siteSentence);
    } else {
      assume("view.estimation", "model", { method: "stratified-monte-carlo-over-real-pixels", samplesPerAxis: v.samplesPerAxis, uniformSamplesPerAxis,
        detailPixels: rendered.detailPixelCount, uniformPixels: rendered.uniformPixelCount },
        "Each display pixel's expected value is the mean over K × K strata of its rectangle, one seeded uniformly jittered real pixel in each, so it is unbiased; the error is zero where the rectangle is uniform " +
        "and falls as K^-3/2 at an edge. K = " + v.samplesPerAxis + " where a fixed pilot grid over the rectangle (widened by the demosaic, filter and kernel reach) or a neighbouring pixel's grid finds more than one scene value, " +
        "K = " + uniformSamplesPerAxis + " elsewhere. For each sampled pixel " + siteSentence);
    }
    assume("view.noise", "model", { method: "variance-of-the-area-mean", distribution: "normal" },
      "Noise of the mean of the real pixels: the covariance of the weighted sum of independent site noises (shot, dark, read and ADC), with the demosaic correlation (B_c = Σ β², in closed form from the rectangle) and the " +
      "expected slopes of the clips and the tone curve (Stein's lemma); the variance the linearization misses and the real pixels' output rounding are added per pixel. One correlated normal draw per display pixel, seeded " +
      "by sensor.noiseSeed: the same statistics as the resized capture, not the same realization.");
    assume("view.demosaic", "model", ahd ? { capture: "ahd", view: "ahd-candidates-with-low-signal-correction", correctedPixels: rendered.ahdCorrectedPixelCount,
      correctionDrawsPerState: correctionDraws, correctionThresholdLinearStd: correctionThreshold } : { capture: "bilinear", view: "bilinear" },
      ahd ? "AHD is non-linear only in its choice between two linear candidates (green along the rows or the columns, red and blue from colour differences). The view propagates both candidates' exact linear statistics " +
        "and averages them. Where a sampled pixel's noise exceeds " + correctionThreshold + " (linear light), the choice reacts to the noise and shifts the colour, so the pixel adds the mean " +
        "difference between the engine's AHD steps and the two candidates on " + correctionDraws + " drawn noisy flat neighbourhoods (Poisson electrons plus read and ADC noise) with its channel means, " +
        "computed once per state of a logarithmic grid (8 steps per octave of the channel means) and interpolated trilinearly, a control variate with no per-pixel sampling noise; " +
        "the flat-neighbourhood state is an approximation at edges (docs/DISPLAY_VIEW.md, validation)." :
        "The bilinear demosaic's linear kernels, exactly.");
    if (defocusKernel) {
      assume("view.defocus", "model", { kernel: shaped ? (diffraction ? "diffraction-convolved-with-shaped-kernel" : "shaped-kernel") : diffraction ? "diffraction-convolved-with-disc" : "disc", defocusKernelRadiusSites: defocusKernel.radius,
        diffractionKernelRadiusSites: diffraction ? diffractionRadius : null, kernelRadiusSites: combinedRadius, scientificStatus: "approximation", ...(largeDefocus ? { convolution: "runs" } : {}) },
        // #564: the lens.defocus assumption explains the run convolution above 64 sites (convolution: "runs").
        "The expected electrons of each real site read the scene on the site lattice through the defocus " + (shaped ? "kernel shaped by the lens (#553; see the lens.defocus assumption; " : "disc (") +
        defocusKernel.diameterSites + " sites across, a " + defocusKernel.width + " × " +
        defocusKernel.width + " window), as the capture's convolution does; the estimators then run unchanged on the blurred signal. " + (diffraction ?
          "With lens.diffraction each spectral node's kernel is its diffraction kernel convolved with the disc (" + (2 * combinedRadius + 1) + " × " + (2 * combinedRadius + 1) + " taps): " +
          "an approximation, because the PSF of a defocused wave is not the in-focus Airy pattern convolved with a geometric disc." :
          "The disc is the same at every spectral node (geometric optics)."));
    }
    if (execution.backend === "webgpu-f32") {
      assume("view.execution", "model", { backend: execution.backend, arithmetic: execution.arithmetic, errorBound: execution.errorBound, adapter: execution.adapter },
        "Estimated on the GPU: this view was rendered by the WebGPU float32 display-view renderer, a labelled approximation of the float64 CPU reference within the a-priori " +
        "error bound reported in diagnostics.fast.execution.errorBound; it is not bit-identical to the reference. The device passed the engine's run-time conformance check first.");
    }
    assume("view.source", "model", { rendering: "srgb", format: v.format, ignoredCaptureOutput: ["format", "colorEncoding", "bitDepth", "gamutMapping", "jpegQuantizationStep", "dng", "metadata", "maximumPixels"].filter((k) => outputOptions[k] !== undefined) },
      "The view shows the capture's sRGB rendering (its tone curve, white balance and highlight mode); the capture's file-format options do not apply to it.");
    return Object.freeze({ kind: "display-view" as const, label: "Display view: the full-resolution capture resized to " + v.width + " × " + v.height + " (estimated); not a capture.",
      facadeVersion: SIMULATE_CAPTURE_FACADE_VERSION, engineApiVersion: ENGINE_API_VERSION,
      image: { width: viewRegion.width, height: viewRegion.height, format: v.format, samples: rendered.samples },
      view: { width: v.width, height: v.height, frameWidth: width, frameHeight: height, scaleX, scaleY, samplesPerAxis: v.samplesPerAxis, ...(v.region ? { region: { ...v.region } } : {}) },
      exposure: { mode, settings: { fNumber, shutterSeconds, iso: resolvedIso }, ev100: Math.log2(fNumber ** 2 / shutterSeconds), ...isoReport, standardExposureDeviationStops, standardExposureIlluminanceLux, greyCardDeviationStops, metering },
      sensor: context.sensor,
      scene: { sceneId: chart ? "chart:" + chart.preset : callerScene!.sceneId, preset: scenePreset, parameters: chart ? chart.parameters : {},
        illuminant: { id: illuminant.id, description: illuminant.description, illuminanceLux }, distanceM: subjectDistanceM,
        framedWidthM: 2 * metresPerFrameUnit, framedHeightM: 2 * metresPerFrameUnit * aspect, ...(chartReport ? { chart: chartReport } : {}), sourceSha256 },
      diagnostics: { sampleCount: rendered.sampleCount, siteEvaluations: rendered.siteCount, sceneLookups: signal.lookups, detailPixelCount: rendered.detailPixelCount,
        uniformPixelCount: rendered.uniformPixelCount, ahdCorrectedPixelCount: rendered.ahdCorrectedPixelCount, timingsMs: { view: viewMs, total: Date.now() - started },
        fast: Object.freeze({ ...context.fastReport, assurance: execution.backend === "webgpu-f32" ? "approximation-with-a-priori-bound" as const : context.fastReport.assurance, execution }),
        highlight: Object.freeze({ saturatedPixelCount: rendered.saturatedPixelCount, statistic: "expected-value" as const }) },
      provenance: { scientificStatus: "approximation" as const, cameraPresetId: preset.presetId, cameraPresetVersion: preset.presetVersion, evidence: [...FACADE_EVIDENCE, ...preset.evidence],
        composedContracts: ["calculateEnvironmentSensorPhotoSignal", "resolveSensorReadoutRegime", "calculateSiteEffectiveSaturationCode", ...(diffraction ? ["createDiffractionLimitedPsfProfile", "resolveLensPsfConvolutionKernels"] : []),
          ...(antiAliasing ? ["resolveAntiAliasingSpatialKernel"] : []), "prepareSensorColorDevelopment", "display view estimator"],
        limitations: ["Estimated display view of the full-resolution capture: its expected value is a stratified Monte Carlo estimate and its noise is drawn from the variance of the area mean, so it has the resized capture's statistics, not its exact pixels; not a capture and not a measurement."] },
      assumptions: Object.freeze(assumptions.map((a) => Object.freeze(a))) });
  };
  return { render, collect, correction, gpuRequest };
}
