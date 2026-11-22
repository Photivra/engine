// SPDX-License-Identifier: Apache-2.0
/**
 * #655 (G1): what the catalogue-lens passes take and refuse, and how the combined renderer routes a lens view: the support check of
 * the request (`displayViewLensGpuSupports`) and of the render (`displayViewLensGpuUnsupportedReason`, the model check against the
 * reference's geometry), the renderer's lens route and its on-demand self-check case, a failed load of the lens code, and the test
 * fixture's raw geometry against the one the facade prepares (captured here).
 */
import { describe, expect, it, vi } from "vitest";
import type { DefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";

const captured = vi.hoisted(() => ({ geometry: undefined as unknown }));
vi.mock("../src/facade/defocus-image-space-provider.js", async (importOriginal): Promise<typeof import("../src/facade/defocus-image-space-provider.js")> => {
  const actual = await importOriginal<typeof import("../src/facade/defocus-image-space-provider.js")>();
  return { ...actual, prepareDefocusImageSpaceGeometry: (g: DefocusImageSpaceGeometry): ReturnType<typeof actual.prepareDefocusImageSpaceGeometry> => { captured.geometry = g; return actual.prepareDefocusImageSpaceGeometry(g); } };
});

import { createFakeGpu } from "./helpers/fake-webgpu.js";
import { runtimeOf, SMALL_FRAME, SMALL_VIEW } from "./helpers/display-view-gpu-fixture.js";
import { catalogueLensGeometry, displayViewLensGpuFixture, renderLensOnGpu } from "./helpers/display-view-lens-gpu-fixture.js";
import { displayViewLensGpuUnsupportedReason } from "../src/gpu/display-view-lens-gpu.js";
import { createDisplayViewGpuRenderer, displayViewLensGpuSupports, setDisplayViewQualityGpuLoader } from "../src/gpu/display-view-gpu-renderer.js";
import type { DisplayViewGpuRequest } from "../src/facade/display-view-gpu.js";
import { ImageKernelExecutionError } from "../src/gpu/image-kernel-execution.js";
import type { SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const options = { scene: { preset: "siemens-star" }, subjectDistanceM: 2, lens: { catalogue: "pv-50-1.2-pro", fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 },
  output: { ...SMALL_FRAME, format: "srgb-8" } } as SimulateCaptureOptions;
const REGION = { ...SMALL_VIEW, region: { x: 90, y: 60, width: 16, height: 12 } };
const request: DisplayViewGpuRequest = { ahd: false, diffraction: false, antiAliasing: false, boxSamples: 1, toneCurve: "identity", scene: "chart", lens: true,
  lensView: { catalogueZones: true, still: true, rectilinear: true, flare: false } };

describe("catalogue-lens passes: support, refusals and routing", () => {
  it("the fixture's raw geometry is the facade's own (focal length, focus, rotation, distortion and vignetting coefficients)", async () => {
    const fixture = await displayViewLensGpuFixture(options, REGION), facade = captured.geometry as DefocusImageSpaceGeometry, ours = fixture.lens.geometry;
    expect(ours.focalLengthMm).toBe(facade.focalLengthMm);
    expect(ours.focusDistanceM).toBe(facade.focusDistanceM);
    expect(facade.angularVelocityRadPerSec).toEqual({ pitch: 0, yaw: 0, roll: 0 });
    expect(ours.lensMapping!.radial!.coefficients).toEqual(facade.lensMapping!.radial!.coefficients);
    expect(ours.lensMapping!.radial!.normalizationRadiusMm).toBe(facade.lensMapping!.radial!.normalizationRadiusMm);
    expect(ours.vignetting!.coefficients).toEqual(facade.vignetting!.coefficients);
    expect(ours.vignetting!.normalizationRadiusMm).toBe(facade.vignetting!.normalizationRadiusMm);
    // The passes render with the facade's own geometry as well.
    const runtime = await runtimeOf(createFakeGpu().gpu);
    try { expect((await renderLensOnGpu(runtime, { ...fixture, lens: { ...fixture.lens, geometry: facade } })).gpu.execution.backend).toBe("webgpu-f32"); }
    finally { runtime.destroy(); }
  }, scaledTimeout(120_000));

  it("takes a still rectilinear catalogue view in field zones; names everything else", async () => {
    expect(displayViewLensGpuSupports(request)).toBe(true);
    const variants: [Partial<NonNullable<DisplayViewGpuRequest["lensView"]>> | null, RegExp][] = [[null, /#563/u], [{ catalogueZones: false }, /field zones/u], [{ still: false }, /rotation/u],
      [{ rectilinear: false }, /fisheye/u], [{ flare: true }, /flare/u]];
    for (const [change, reason] of variants) {
      const { lensView, ...rest } = request;
      expect(displayViewLensGpuSupports(change === null ? rest : { ...rest, lensView: { ...lensView!, ...change } })).toMatch(reason);
    }
    expect(displayViewLensGpuSupports({ ...request, largeDefocus: true })).toMatch(/64 sites/u);
    expect(displayViewLensGpuSupports({ ...request, scene: "material-function" })).toMatch(/charts/u);
    expect(displayViewLensGpuSupports({ ...request, scene: "material-layers" })).toBe(true);
    expect(displayViewLensGpuSupports({ ...request, toneCurve: "filmic" as DisplayViewGpuRequest["toneCurve"] })).toMatch(/tone curve/u);
    // The combined renderer routes a lens request here (and the #563 rule for a lens request it does not describe).
    const runtime = await runtimeOf(createFakeGpu().gpu), renderer = createDisplayViewGpuRenderer(runtime);
    expect(renderer.supports(request)).toBe(true);
    const undescribed: DisplayViewGpuRequest = { ...request };
    delete undescribed.lensView;
    expect(renderer.supports(undescribed)).toMatch(/#563/u);
    runtime.destroy();
  });

  it("refuses per render what the request does not show: fast: false's PSF per site, rotation, flare, fisheye, a geometry that is not the model", async () => {
    const fixture = await displayViewLensGpuFixture(options, REGION), { setup, lens } = fixture;
    expect(displayViewLensGpuUnsupportedReason(setup, lens)).toBeNull();
    const psf = lens.lens.psf!;
    const cases: [Parameters<typeof displayViewLensGpuUnsupportedReason>[1], RegExp][] = [
      [{ ...lens, lens: { ...lens.lens, psf: undefined } }, /without a catalogue lens's PSF/u],
      [{ ...lens, lens: { ...lens.lens, psf: { ...psf, zoneSites: 1 } } }, /fast: false/u],
      [{ ...lens, lens: { ...lens.lens, psf: { ...psf, radius: psf.radius + 1 } } }, /PSF radius/u],
      [{ ...lens, lens: { ...lens.lens, times: [0, 1e-3] } }, /rotation/u],
      [{ ...lens, geometry: { ...lens.geometry, angularVelocityRadPerSec: { pitch: 0.1, yaw: 0, roll: 0 } } }, /rotation/u],
      [{ ...lens, lens: { ...lens.lens, veil: { fraction: 0.01, step: 8 } } }, /flare/u],
      [{ ...lens, lens: { ...lens.lens, zeroBeyondHorizon: true } }, /fisheye/u],
      [{ ...lens, geometry: { ...lens.geometry, lensMapping: { ...lens.geometry.lensMapping!, mapping: { ...lens.geometry.lensMapping!.mapping, projectionModel: "fisheye-equidistant" } } } }, /rectilinear/u]];
    for (const [input, reason] of cases) expect(displayViewLensGpuUnsupportedReason(setup, input)).toMatch(reason);
    const bare = { ...setup };
    delete bare.gpu;
    expect(displayViewLensGpuUnsupportedReason(bare, lens)).toMatch(/no GPU inputs/u);
    // A raw geometry whose distortion is not the reference's: the model check refuses it by name.
    const radial = lens.geometry.lensMapping!.radial!, wrong = { ...lens, geometry: { ...lens.geometry, lensMapping: { ...lens.geometry.lensMapping!,
      radial: { ...radial, coefficients: { ...radial.coefficients, k1: radial.coefficients.k1 * 1.001 } } } } };
    const runtime = await runtimeOf(createFakeGpu().gpu);
    try {
      await expect(renderLensOnGpu(runtime, { ...fixture, lens: wrong })).rejects.toMatchObject({ reason: "unsupported-on-backend", message: expect.stringMatching(/not the still rectilinear radial model/u) });
      // A vignetting profile that is not the reference's is refused the same way.
      const vignetting = { ...lens.geometry.vignetting!, coefficients: { ...lens.geometry.vignetting!.coefficients, r2: lens.geometry.vignetting!.coefficients.r2 * 1.001 } };
      await expect(renderLensOnGpu(runtime, { ...fixture, lens: { ...lens, geometry: { ...lens.geometry, vignetting } } })).rejects.toMatchObject({ reason: "unsupported-on-backend" });
    } finally { runtime.destroy(); }
    expect(catalogueLensGeometry(options).angularVelocityRadPerSec).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  }, scaledTimeout(120_000));

  it("the combined renderer renders a lens view on its lens passes, with the lens self-check among its on-demand cases", async () => {
    const fixture = await displayViewLensGpuFixture(options, REGION), runtime = await runtimeOf(createFakeGpu().gpu);
    try {
      const renderer = createDisplayViewGpuRenderer(runtime);
      const cases = await renderer.onDemandConformanceCases!(fixture.setup);
      expect(cases!.map((c) => c.id)).toEqual(["display-view:quality:checkerboard-13x9-diffraction-ahd", "display-view:quality:checkerboard-13x9-defocus-blocked", "display-view:lens:checkerboard-13x9-zones"]);
      expect(await cases![2]!.run(runtime, undefined)).toBe(true);
      const out = await renderer.render({ setup: fixture.setup, signal: undefined });
      expect(out.errorBound.kind).toBe("relative-to-reference");
      expect(out.compositeProbe?.productPath).toBe("dekker");
      for (let i = 0; i < out.samples.length; i++) expect(Math.abs(out.samples[i]! - fixture.cpu.samples[i]!)).toBeLessThanOrEqual(1);
      // The lens passes load with the Quality code: a load that fails is `quality-code-unavailable`, and the next render loads it again.
      setDisplayViewQualityGpuLoader(() => Promise.reject(new Error("offline")));
      await expect(renderer.render({ setup: fixture.setup, signal: undefined })).rejects.toMatchObject({ reason: "quality-code-unavailable" });
      setDisplayViewQualityGpuLoader(null);
      expect((await renderer.render({ setup: fixture.setup, signal: undefined })).samples.length).toBe(out.samples.length);
      renderer.dispose?.();
    } finally { runtime.destroy(); setDisplayViewQualityGpuLoader(null); }
  }, scaledTimeout(120_000));

  it("an aborted render throws aborted", async () => {
    const fixture = await displayViewLensGpuFixture(options, REGION), runtime = await runtimeOf(createFakeGpu().gpu), abort = new AbortController();
    abort.abort();
    try { await expect(createDisplayViewGpuRenderer(runtime).render({ setup: fixture.setup, signal: abort.signal })).rejects.toBeInstanceOf(ImageKernelExecutionError); }
    finally { runtime.destroy(); }
  }, scaledTimeout(60_000));
});
