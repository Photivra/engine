// SPDX-License-Identifier: Apache-2.0
/** Shared by the #569 display-view catalogue tests (test/display-view-lens-catalogue*.test.ts): the capture's own site records as the reference. */
import { calculateEnvironmentSensorPhotoSignal, createPlanarSceneRadianceProvider, type SimulateCaptureOptions, type SimulateCaptureResult } from "../../src/index.js";
import type { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
export const exposure = { mode: "manual", shutterSeconds: 1 / 125, iso: 100 } as const;

/** Expected photo electrons of one site's environment record with an evaluator (the environment chain, noise-free). */
export function electrons(environment: unknown, evaluateRadiance: unknown): number {
  return (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never).value as unknown as
    { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;
}
/** The capture's scene as a provider; like the capture's for a catalogue fisheye, a ray at or beyond 90° sees zero radiance. */
export function sceneEvaluator(options: SimulateCaptureOptions, r: SimulateCaptureResult): (request: { target: { outgoingDirectionUnitVector: { x: number; y: number; z: number } } }) => unknown {
  const provider = createPlanarSceneRadianceProvider({ scene: options.scene as never, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: r.scene.illuminant.illuminanceLux,
    distanceM: r.scene.distanceM, framedWidthM: r.scene.framedWidthM, aspect: r.scene.framedHeightM / r.scene.framedWidthM, sceneId: "facade-scene", providerProfileId: "facade-provider" });
  return (request) => {
    if (-request.target.outgoingDirectionUnitVector.z > 0) return provider.evaluateRadiance(request as never);
    const result = provider.evaluateRadiance({ ...request, target: { ...request.target, outgoingDirectionUnitVector: { x: 0, y: 0, z: -1 } } } as never);
    return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: 0 };
  };
}
export type Signal = Awaited<ReturnType<typeof simulateDisplayViewWithInternals>>["signal"];
/**
 * Relative differences between the view's site values and the reference at `count` sites spread over the native raster (its corners and
 * centre included), or every site (count undefined). The capture may be a region capture: its site records are the whole frame's.
 */
export function differences(capture: SimulateCaptureResult, signal: Signal, evaluate: unknown, pitch: number, count?: number): { largest: number; mean: number } {
  const area = (capture.request.siteInput(0).environment as unknown as { sensor: { spatialSampling: { imagingArea: { widthMm: number; heightMm: number } } } }).sensor.spatialSampling.imagingArea;
  const W = Math.round(area.widthMm * 1000 / pitch), H = Math.round(area.heightMm * 1000 / pitch), sites: [number, number][] = [];
  if (count === undefined) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sites.push([x, y]);
  else {
    sites.push([0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [W >> 1, H >> 1]);
    for (let k = 0; sites.length < count; k++) sites.push([(k * 7919 + 13) % W, (k * 3571 + 7) % H]);
  }
  let largest = 0, sum = 0;
  for (const [x, y] of sites) {
    const reference = electrons(capture.request.siteInput(y * W + x).environment, evaluate), value = signal.site(x, y);
    const d = reference === 0 ? (value === 0 ? 0 : Infinity) : Math.abs(value - reference) / reference;
    largest = Math.max(largest, d); sum += d;
  }
  return { largest, mean: sum / sites.length };
}
/** A full frame (36 × 24 mm) of `pitch` µm and its capture of a 2 × 2 region (whose site records cover the whole frame). */
export const fullFrame = (pitch: number): NonNullable<SimulateCaptureOptions["output"]> => ({ width: Math.round(36000 / pitch), height: Math.round(24000 / pitch), maximumPixels: 2 ** 27 });
