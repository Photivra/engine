// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): loads the CPU on-demand code, once per realm: the Quality kit (src/facade/quality-kit.ts) and the opt-in kit
 * (src/facade/opt-in-kit.ts), and (2.26.0) the export kit (src/facade/export-kit.ts). A request loads a kit where it is parsed, before it uses any of its code, and then calls it
 * synchronously, so results are those of a static import. Concurrent loads share one import; a failed load is not remembered,
 * so the next request (or `prepareQualityPaths()`) tries again. A failed load rejects with `ImageKernelExecutionError` reason
 * `quality-code-unavailable`, as the GPU Quality code's does; the CPU has no other path, so the request fails with it.
 */

import { ImageKernelExecutionError } from "../core/execution-error.js";

/*
 * #658: positions in the Quality kit's tuple (QUALITY_KIT, src/facade/quality-kit.ts) and the opt-in kit's (OPT_IN_KIT,
 * src/facade/opt-in-kit.ts). Callers read `loadedKit(qualityKit)[QK_…]`; test/on-demand-kits.test.ts checks every position.
 */
export const QK_CREATE_DIFFRACTION_LIMITED_PSF_PROFILE = 0;
export const QK_REGISTER_DIFFRACTION_PSF_KEY = 1;
export const QK_SITE_DIFFRACTION_KERNEL = 2;
export const QK_CREATE_AHD_DEMOSAIC_TASK = 3;
export const QK_CREATE_DEFOCUS_BOKEH_SITE_KERNEL = 4;
export const QK_RESOLVE_DEFOCUS_BOKEH_OPTIONS = 5;
export const QK_PLAN_DEFOCUS_BOKEH_ZONES = 6;
export const QK_LARGE_DEFOCUS_CACHE_BYTES = 7;
export const QK_CREATE_LARGE_DEFOCUS_NODE_LATTICE = 8;
export const QK_CALCULATE_DEFOCUS_FIELD_VARIATION = 9;
export const QK_CREATE_DEFOCUS_IMAGE_SPACE_PROVIDER = 10;
export const QK_PREPARE_DEFOCUS_IMAGE_SPACE_GEOMETRY = 11;
export const QK_CREATE_DISPLAY_VIEW_COUPLED_RENDERING = 12;
export const QK_NEIGHBOR_HIGHLIGHT_RING = 13;
export const QK_NEIGHBOR_HIGHLIGHT_THRESHOLD = 14;
export const QK_RECONSTRUCT_HIGHLIGHTS_FROM_NEIGHBORS = 15;
export const QK_CREATE_OFFSET_EXPANSION = 16;
export const OK_PARSE_SENSOR_PROFILE = 0;
export const OK_SENSOR_PROFILE_BODY = 1;
export const OK_SENSOR_PROFILE_SATURATION_ISO = 2;
export const OK_FLASH_ALONE_SHUTTER = 3;
export const OK_METER_FLASH = 4;
export const OK_REBIND_FLASH_ASSUMPTIONS = 5;
export const OK_REQUIRE_FLASH_ROWS = 6;
export const OK_RESOLVE_MIXED_ILLUMINATION = 7;
export const OK_SOLVE_FLASH_SHUTTER = 8;
export const OK_CREATE_SUBJECT_MOTION_PROVIDER = 9;
export const OK_SUBJECT_TRAVEL_M = 10;
export const OK_RESOLVE_LENS_FILTER = 11;
export const OK_CATALOGUE_OPTICS_ASSUMPTIONS = 12;
export const OK_RENDER_DISPLAY_VIEW_DETAIL = 13;
export const OK_HAND_SHAKE_ASSUMPTION = 14;
export const OK_HAND_SHAKE_QUADRUPLES = 15;
export const OK_RESOLVE_HAND_SHAKE = 16;

export type QualityKit = typeof import("./quality-kit.js").QUALITY_KIT;
export type OptInKit = typeof import("./opt-in-kit.js").OPT_IN_KIT;
export type ExportKit = typeof import("./export-kit.js");

/** One kit's loader: `load()` imports it once (single flight, retried after a failure); `loaded` is the module once imported. */
interface KitLoader<T> { loaded: T | undefined; load(): Promise<T> }
function kitLoader<T>(name: string, importer: () => Promise<T>): KitLoader<T> {
  let pending: Promise<T> | null = null;
  const kit: KitLoader<T> = {
    loaded: undefined,
    load(): Promise<T> {
      if (kit.loaded) return Promise.resolve(kit.loaded);
      pending ??= importer().then((module) => (kit.loaded = module), (error: unknown) => {
        pending = null;
        throw new ImageKernelExecutionError("quality-code-unavailable", "the engine's " + name + " code could not be loaded: " + (error instanceof Error ? error.message : String(error)));
      });
      return pending;
    }
  };
  return kit;
}

/** The CPU full-quality code (#594). */
export const qualityKit: KitLoader<QualityKit> = kitLoader("full-quality", () => import("./quality-kit.js").then((kit) => kit.QUALITY_KIT));
/** The opt-in features' code (#594). */
export const optInKit: KitLoader<OptInKit> = kitLoader("opt-in feature", () => import("./opt-in-kit.js").then((kit) => kit.OPT_IN_KIT));
/** 2.26.0 (owner decision 2026-11-16): the JPEG and PNG writers (src/facade/export-kit.ts). */
export const exportKit: KitLoader<ExportKit> = kitLoader("JPEG and PNG export", () => import("./export-kit.js"));

/** A kit the request loaded where it was parsed (an engine error if a code path uses it without loading it first). */
export function loadedKit<T>(kit: KitLoader<T>): T {
  if (!kit.loaded) throw new ImageKernelExecutionError("quality-code-unavailable", "on-demand code was used before it was loaded (an engine defect; #594).");
  return kit.loaded;
}
