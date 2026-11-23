// SPDX-License-Identifier: Apache-2.0

/**
 * Queries of a layered chart scene at a frame point (2.29.0): the surface a frame point sees and its distance (#747, for
 * tap-to-focus), and the in-focus mask of the display view (#752), both analytic. No image is rendered or analyzed.
 *
 * The chief ray. Frame units are angles (`layered-chart-scene.ts`), so the chief ray through frame point (u, v) meets every surface
 * at the same (u, v). The surface it sees is the nearest whose closed rectangle holds (u, v); the far surface (the back plane, or the
 * farthest card without one) has no edge, so every point sees a surface. This is the lookup the layered sum's display-view pilot
 * makes (`chiefSurface` of `layered-scene-signal.ts`), so the answer is the surface the view's metering, white balance and pilot read.
 *
 * The in-focus mask. Per pixel, the chief ray's surface at the pixel centre, its geometric blur-circle diameter c at the sensor
 * (`calculateDefocusCircle`, thin-lens model) and the score max(0, 1 − c / c₀), c₀ the circle of confusion. A score above 0 is
 * "within the depth of field": for a thin lens, c < c₀ exactly between the near and far limits of `calculateDepthOfField` at c₀
 * (both follow from the hyperfocal distance H = f²/(N·c₀) + f). It is a geometric thin-lens guide: no diffraction, no aberrations,
 * no pixel or display resolution, and it does not depend on `fast` or on the route (CPU or GPU).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { calculateDefocusCircle } from "../optics/depth-of-field.js";
import { resolveLayeredChartScene, type LayeredChartScene, type ResolvedLayeredChartScene } from "./layered-chart-scene.js";
import { focusMaskScore, FOCUS_MASK_LABEL, type DisplayViewFocusMask } from "./focus-mask.js";

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };

/** The surface a frame point sees (#747). */
export interface LayeredChartSurfaceAt {
  kind: "card" | "back-plane";
  /** Card index in the scene's `cards`, or −1 for the back plane. */
  index: number;
  /** The surface's distance from the lens plane along the axis, metres: the value focus control's `finite-surface` target takes. */
  distanceM: number;
  /** The frame point asked for. */
  framePoint: { u: number; v: number };
}

/** Index in `scene.surfaces` (nearest first) of the first surface along the chief ray of frame point (u, v). */
export function layeredSurfaceIndexAt(scene: ResolvedLayeredChartScene, u: number, v: number): number {
  const surfaces = scene.surfaces, last = surfaces.length - 1;
  for (let k = 0; k < last; k++) {
    const r = surfaces[k]!.rect!;
    if (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1) return k;
  }
  return last;
}

/**
 * From 2.29.0 (#747): the surface of a layered chart scene that the chief ray through frame point (u, v) sees, and its distance.
 * Frame units as the scene's: u = ±1 at the frame's left and right edges, v up, v = ±aspect at the top and bottom (aspect = height /
 * width of the frame). The nearest card whose closed rectangle holds the point, else the far surface, which has no edge: every
 * point has a surface, the one the display view's pilot reads. Pure; the lens is not involved (frame units are angles), so a caller
 * with a rectilinear lens maps a pixel centre (x, y) of a W × H frame to u = (x + ½ − W/2)·2/W, v = −(y + ½ − H/2)·2/W.
 * The scene is validated as a request's is (`InvalidConfigurationError`); u and v must be finite.
 */
export function calculateLayeredChartSurfaceAt(input: { scene: LayeredChartScene; aspect: number; u: number; v: number }): LayeredChartSurfaceAt {
  if (typeof input !== "object" || input === null || Array.isArray(input)) fail("calculateLayeredChartSurfaceAt input must be an object.");
  for (const key of Object.keys(input)) if (!["scene", "aspect", "u", "v"].includes(key)) fail("calculateLayeredChartSurfaceAt input has unknown field \"" + key + "\".");
  const { u, v } = input;
  if (typeof u !== "number" || !Number.isFinite(u) || typeof v !== "number" || !Number.isFinite(v)) fail("u and v must be finite numbers.");
  const resolved = resolveLayeredChartScene({ scene: input.scene, aspect: input.aspect }), surface = resolved.surfaces[layeredSurfaceIndexAt(resolved, u, v)]!;
  return { kind: surface.kind, index: surface.index, distanceM: surface.distanceM, framePoint: { u, v } };
}

// #752: the mask's record, label and score are in focus-mask.ts, so the display view's single-plane mask carries no layered code.
export { FOCUS_MASK_LABEL, focusMaskScore, type DisplayViewFocusMask } from "./focus-mask.js";

/** Each surface's score, nearest first: max(0, 1 − c / c₀) at its distance, c from `calculateDefocusCircle`. */
export function layeredFocusScores(scene: ResolvedLayeredChartScene, input: { focalLengthMm: number; aperture: number; focusDistanceM: number; circleOfConfusionMm: number }): Float64Array {
  const { focalLengthMm, aperture, focusDistanceM, circleOfConfusionMm } = input;
  if (!(Number.isFinite(circleOfConfusionMm) && circleOfConfusionMm > 0)) fail("focusMask.circleOfConfusionMm must be a positive finite number.");
  return Float64Array.from(scene.surfaces, (s) =>
    focusMaskScore(calculateDefocusCircle({ focalLengthMm, aperture, focusDistanceM, subjectDistanceM: s.distanceM }).value.diameterMm, circleOfConfusionMm));
}

/**
 * The in-focus mask of a layered chart scene for the rectangle (x0, y0, width, height) of display pixels of a frame `outputWidth` ×
 * `outputHeight` (see the module comment). `framePointAt(x, y)` maps the centre of pixel (x, y), absolute in the frame, to its frame
 * point, or to null where the pixel sees no scene (score 0); the default is the rectilinear lens, u = (x + ½ − W/2)·2/W,
 * v = −(y + ½ − H/2)·2/W, the facade's lattice formula. Each pixel depends only on its own position, so a region equals the same
 * pixels of the whole view bit for bit.
 */
export function createLayeredFocusMask(input: { scene: ResolvedLayeredChartScene; outputWidth: number; outputHeight: number;
  rectangle: { x0: number; y0: number; width: number; height: number }; focalLengthMm: number; aperture: number; focusDistanceM: number; circleOfConfusionMm: number;
  framePointAt?: (x: number, y: number) => { u: number; v: number } | null }): DisplayViewFocusMask {
  const { scene, outputWidth: W, outputHeight: H, rectangle: { x0, y0, width, height }, circleOfConfusionMm } = input;
  const integer = (n: number, low: number): boolean => Number.isInteger(n) && n >= low;
  if (!(integer(W, 1) && integer(H, 1) && integer(x0, 0) && integer(y0, 0) && integer(width, 1) && integer(height, 1) && x0 + width <= W && y0 + height <= H))
    fail("focusMask: the rectangle must be whole pixels within the frame.");
  const scores = layeredFocusScores(scene, input), g = 2 / W;
  const framePointAt = input.framePointAt ?? ((x: number, y: number): { u: number; v: number } => ({ u: (x + 0.5 - W / 2) * g, v: -(y + 0.5 - H / 2) * g }));
  const score = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const point = framePointAt(x0 + i, y0 + j);
    score[j * width + i] = point === null ? 0 : scores[layeredSurfaceIndexAt(scene, point.u, point.v)]!;
  }
  return { width, height, circleOfConfusionMm, score, label: FOCUS_MASK_LABEL };
}
