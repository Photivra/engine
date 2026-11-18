// SPDX-License-Identifier: Apache-2.0
/**
 * #655 (G1): fixtures of the display view's catalogue-lens passes on the GPU: a catalogue-lens request rendered by the CPU reference
 * with its setup, expected-signal input and lens signal setup exposed, the lens input the GPU takes (`DisplayViewLensGpuInput`: the
 * lens signal's setup and the raw geometry, rebuilt from the catalogue's resolved profiles as the facade builds them; the lens passes
 * check it against the reference's own geometry), and the GPU render through the Quality host.
 */
import { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
import { lastDisplayViewLensSetup } from "../../src/facade/display-view-lens-signal.js";
import type { DisplayViewLensGpuInput } from "../../src/facade/display-view-gpu.js";
import type { DisplayViewRenderResult, DisplayViewSetup } from "../../src/facade/display-view.js";
import type { DisplayViewExpectedSignalInput } from "../../src/facade/expected-signal.js";
import { resolveGenericLens, type SimulateCaptureOptions, type SimulateDisplayViewOptions } from "../../src/index.js";
import { prepareEnvironmentLensFieldMapping } from "../../src/optics/sensor-environment-query.js";
import { createDisplayViewLensPasses, type DisplayViewLensPassesRecord } from "../../src/gpu/display-view-lens-gpu.js";
import { renderDisplayViewQualityOnGpu, type DisplayViewQualityGpuResult } from "../../src/gpu/display-view-quality-gpu.js";
import { createComputePipeline, type WebGpuRuntime } from "../../src/gpu/webgpu-runtime.js";
// @ts-expect-error -- the repository's script library (scripts/lib) is plain JavaScript without declarations.
import { APP_CHART as APP_CHART_SCRIPT } from "../../scripts/lib/display-view-app-request.mjs";

/** The app-request rows' composite chart (scripts/lib/display-view-app-request.mjs), the benchmark's scene. */
export const APP_CHART = APP_CHART_SCRIPT as SimulateCaptureOptions["scene"];

/** A catalogue-lens view: the CPU result, its setup (with `gpu.lens`), its expected-signal input and its lens input. */
export interface DisplayViewLensGpuFixture { cpu: DisplayViewRenderResult; setup: DisplayViewSetup; signalInput: DisplayViewExpectedSignalInput; lens: DisplayViewLensGpuInput }

/**
 * The raw geometry of a still catalogue-lens request (`prepareDefocusImageSpaceGeometry`'s input): the catalogue's resolved distortion
 * and vignetting profiles for the request's frame, its focal length, and the focus distance (the subject's unless the request names one).
 */
export function catalogueLensGeometry(options: SimulateCaptureOptions): DisplayViewLensGpuInput["geometry"] {
  const lens = options.lens as { catalogue: string; fNumber: number; focusDistanceM?: number }, output = options.output as { width: number; height: number };
  const pitch = (options.sensor as { pixelPitchMicrometers: number }).pixelPitchMicrometers, focusDistanceM = lens.focusDistanceM ?? (options.subjectDistanceM as number);
  const resolved = resolveGenericLens({ lensId: lens.catalogue, activeImagingArea: { widthMm: output.width * pitch / 1000, heightMm: output.height * pitch / 1000 }, fNumber: lens.fNumber, focusDistanceM });
  const character = resolved.character as unknown as { distortion: { profile: unknown }; vignetting: { profile: NonNullable<DisplayViewLensGpuInput["geometry"]["vignetting"]> } };
  return { focalLengthMm: resolved.focalLengthMm, focusDistanceM, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
    lensMapping: prepareEnvironmentLensFieldMapping({ projectionModel: "rectilinear", distortion: { kind: "radial", profile: character.distortion.profile }, radiometricAreaCorrection: "inverse-distortion-jacobian" }),
    vignetting: character.vignetting.profile! };
}

/** Renders the CPU reference of a catalogue-lens request at `view` and keeps the GPU inputs (the lens input in `setup.gpu.lens`). */
export async function displayViewLensGpuFixture(options: SimulateCaptureOptions, view: SimulateDisplayViewOptions): Promise<DisplayViewLensGpuFixture> {
  const { internals, setup, signalInput } = await simulateDisplayViewWithInternals(options, view);
  const lens: DisplayViewLensGpuInput = { lens: lastDisplayViewLensSetup()!.lens, geometry: catalogueLensGeometry(options) };
  (setup.gpu as { lens?: DisplayViewLensGpuInput }).lens = lens;
  return { cpu: internals, setup, signalInput, lens };
}

/** Renders a lens fixture on the runtime through the Quality host with the lens passes (their record alongside). */
export async function renderLensOnGpu(runtime: WebGpuRuntime, fixture: DisplayViewLensGpuFixture, maximumBandBytes = 64 * 1024 * 1024, recomputeFlagged = true,
  extra: { maximumSiteTapsPerDispatch?: number; lens?: Partial<DisplayViewLensGpuInput["lens"]> } = {}): Promise<{ gpu: DisplayViewQualityGpuResult; passes: DisplayViewLensPassesRecord }> {
  const pipelines = (label: string, code: string): Promise<GPUComputePipeline> => createComputePipeline(runtime, label, code, undefined), abort = new AbortController();
  const lens = extra.lens ? { ...fixture.lens, lens: { ...fixture.lens.lens, ...extra.lens } } : fixture.lens;
  const passes = await createDisplayViewLensPasses(runtime, fixture.setup, lens, pipelines, abort.signal);
  const gpu = await renderDisplayViewQualityOnGpu(runtime, maximumBandBytes, { setup: fixture.setup, signalInput: fixture.signalInput, material: { id: "catalogue-lens", wgsl: "", bindings: [] },
    lens: passes, recomputeFlagged, ...(extra.maximumSiteTapsPerDispatch ? { maximumSiteTapsPerDispatch: extra.maximumSiteTapsPerDispatch } : {}) }, abort, undefined, pipelines);
  return { gpu, passes };
}
