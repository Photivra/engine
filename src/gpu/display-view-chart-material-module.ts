// SPDX-License-Identifier: Apache-2.0

/**
 * A material module for the GPU display view (#478) built from the chart-radiance kernel's classification of the eight
 * 2.0 chart presets (`wgsl-chart-kernel.ts`, a Siemens star only with the bar profile). It is the stand-in at the seam
 * #477 fills with the composite chart and label masks: `material_at(p)` is the chart kernel's `material(p)` with its
 * parameters bound at @group(1), and `material_uncertain` its flag.
 *
 * The chart kernel bounds each classification decision for a point with one float32 rounding (E = 2^-23). The display
 * view's query points carry two (the site coordinate plus the offset is exact, the scale is rounded once, the product
 * once), at most 2E relative, so this module doubles the chart kernel's SAFETY factor from 4 to 8: a decision value within
 * eight times its bound of a boundary is flagged, and the display pixel is recomputed on the host with the reference. The
 * kernel's constants E and SLACK come from the display-view kernel's preamble.
 */
import { ImageKernelExecutionError } from "./image-kernel-execution.js";
import { chartGpuConstants, chartGpuPresetCode } from "./chart-radiance-gpu.js";
import type { ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import type { ResolvedChartScene } from "../facade/chart-scenes.js";
import { CHART_MATERIAL_WGSL } from "./wgsl-chart-kernel.js";
import type { DisplayViewGpuMaterialModule } from "./display-view-speed-gpu.js";

/** The chart kernel's `material` function and its helpers, renamed for the display-view kernel (see the module comment). */
export function chartPresetMaterialWgsl(): string {
  const body = CHART_MATERIAL_WGSL
    .replace(/\bparams\./gu, "chart.").replace(/\baux\[/gu, "chart_aux[").replace(/\bflagged\b/gu, "material_uncertain").replace("fn material(", "fn material_at(");
  return `const SAFETY: f32 = 8.0;
struct ChartParams {
  count: u32, columns: u32, preset: u32, na: u32,
  nb: u32, nc: u32, wavelength_mode: u32, pad0: u32,
  f0: f32, f1: f32, f2: f32, f3: f32,
  f4: f32, f5: f32, f6: f32, f7: f32,
};
@group(1) @binding(0) var<uniform> chart: ChartParams;
@group(1) @binding(1) var<storage, read> chart_aux: array<f32>;
${body}`;
}

/**
 * The module for a resolved chart preset. Its material indices are the chart's own, so the display view's materials table
 * (the chart's materials, in order) is read directly. Rejects the 2.3 elements, composites and the sine star with
 * `unsupported-on-backend`, as the chart kernel does.
 */
export function chartPresetMaterialModule(chart: ResolvedChartScene): DisplayViewGpuMaterialModule {
  // chartGpuPresetCode and chartGpuConstants read the plan's chart only.
  const plan = { chart } as unknown as ChartRadianceBatchPlan;
  const code = chartGpuPresetCode(plan);
  if (code === undefined) {
    throw new ImageKernelExecutionError("unsupported-on-backend", "The GPU display view's chart material module covers the eight 2.0 chart presets (Siemens star with the bar profile); " +
      chart.preset + " needs the composite-chart module (#477) or cpu-reference.");
  }
  const { ints, floats, aux } = chartGpuConstants(plan);
  const params = new ArrayBuffer(64), words = new Uint32Array(params), f = new Float32Array(params);
  words[2] = code; words[3] = ints[0]; words[4] = ints[1]; words[5] = ints[2];
  f.set(floats, 8);
  return { id: "chart-preset:" + chart.preset, wgsl: chartPresetMaterialWgsl(),
    bindings: [{ binding: 0, kind: "uniform", data: new Uint8Array(params) }, { binding: 1, kind: "storage", data: aux }] };
}
