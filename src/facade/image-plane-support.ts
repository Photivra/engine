// SPDX-License-Identifier: Apache-2.0

/**
 * The opt-in seam of the image-plane scene (2.21, #581). Its module and its lattice data (about 10 KB gzip) are not reachable
 * from `simulateCapture` or the display view by themselves: an application that prints photos calls `prepareImagePlaneScenes()`
 * (image-plane-enable.ts, a module of its own) once, which loads them with a dynamic import, so a bundle that never prints a photo
 * (and never imports that function) carries none of their bytes, not even as a lazy chunk (docs/IMAGE_PLANE.md, "Lazy loading and size").
 */

import type { ResolvedImagePlaneScene } from "./scene-radiance.js";
import type { DisplayViewGpuSetup } from "./display-view.js";

/** Internal: what the facade and the GPU display view take from the image-plane module once it is enabled. */
export interface ImagePlaneSupport {
  IMAGE_PLANE_LATTICE_VERSION: string;
  imagePlanePrint(scene: unknown, chartSize: unknown, framedWidthM: number, frameAspect: number, assume: (id: string, kind: "default", value: unknown, explanation: string) => void):
    { widthM: number; heightM: number; surroundReflectance: number; defaulted: ("heightM" | "surroundReflectance")[] };
  resolveImagePlaneScene(value: unknown, aspect: number, assume?: (id: string, kind: "default" | "model" | "derived", value: unknown, explanation: string) => void): Promise<ResolvedImagePlaneScene>;
  /** The GPU display view's image-plane module (loaded on demand by the GPU renderer). */
  loadGpuModule(): Promise<ImagePlaneGpuSupport>;
}
/** Internal: the GPU side (src/gpu/display-view-image-material-module.ts), typed loosely so that this module imports no GPU code. */
export interface ImagePlaneGpuSupport {
  createDisplayViewImageModules(runtime: unknown, probe: (signal: AbortSignal) => Promise<unknown>): { moduleFor(gpu: DisplayViewGpuSetup, signal: AbortSignal): Promise<unknown>; release(): void };
  runImagePlaneConformance(runtime: unknown, signal: AbortSignal | undefined): Promise<true | string>;
}

let support: ImagePlaneSupport | undefined;

/** Internal: the enabled image-plane module, or undefined. */
export function imagePlaneSupport(): ImagePlaneSupport | undefined {
  return support;
}
/** Internal: records the loaded module (`prepareImagePlaneScenes`, image-plane-enable.ts). */
export function setImagePlaneSupport(value: ImagePlaneSupport): void {
  support = value;
}
