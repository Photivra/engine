// SPDX-License-Identifier: Apache-2.0

/**
 * Layered chart scenes (#652): flat, opaque, fronto-parallel cards at several distances in front of an optional back plane,
 * with optional point lights on the back plane. This module holds the scene's schema and validation, the staircase presets,
 * the depth report (per surface: distance, blur diameter and whether it lies within the depth of field) and each surface's
 * scene at the spectral nodes, the form the layered sum (`layered-scene-signal.ts`) reads. The facade's wiring is
 * `layered-scene-setup.ts`, loaded by `prepareLayeredChartScenes()`.
 *
 * Coordinates. Every card is placed in frame units **as seen from the lens** (u = ±1 at the frame's left and right edges,
 * v up), so a frame unit is the same angle at every depth: a card farther away covers more metres for the same frame
 * units. A card's chart is resolved in the card's own frame (u = ±1 at the card's left and right edges, aspect = height /
 * width), as a composite element is.
 *
 * The far surface. The farthest surface (the back plane, or the farthest card without one) has no edge: its pattern
 * continues beyond its rectangle as a single-plane chart's does. A scene of one card and no back plane is therefore a
 * single-plane chart scene, which the facade renders on its existing path (identical bytes).
 *
 * Point lights. Each light is a point emitter on the back plane of luminous intensity I_v (cd) with the relative spectrum S
 * of `spectrum` (default CIE illuminant A), so its spectral intensity is I_e(λ) = k·S(λ) W·sr⁻¹·nm⁻¹ with
 * k = I_v / (683 ∫ S ȳ dλ) (the photometric definition; the same 1 nm quadrature as `calculateIlluminantIrradianceScale`).
 * On the site lattice a light is the lattice cell that holds it: that cell's radiance is raised by I_e / A, A the cell's area
 * on the back plane (paraxial: (g·m_B)², g the frame units per site and m_B the back plane's metres per frame unit), so the
 * cell emits the light's power into the lens's solid angle. The layered sum then spreads it as it spreads the back plane, so
 * a light renders as the back plane's aperture image (the disc, the blades, the cat's eye) cut by nearer cards. The light's
 * position is quantized to the cell that holds it (at most half a site); two lights may not share a cell (refused when two lie closer
 * than one site on both axes).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { calculateDepthOfField } from "../optics/depth-of-field.js";
import { DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES, resolveDefocusDisc } from "../optics/defocus-disc-kernel.js";
import { defocusBokehKernelRadius, resolveDefocusBokehOptions, type DefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES } from "../optics/site-kernel-runs.js";
import { createDeterministicUniformStream } from "../sensor/stochastic-seed.js";
import { DIGIT_SEGMENTS, NUMERAL_ADVANCE, NUMERAL_WIDTH, SEGMENTS, resolveChartMaterial, resolveChartScene, type ChartReflectance, type ChartScene,
  type ResolvedChartScene } from "./chart-scenes.js";
import { calculateIlluminantIrradianceScale, resolveCaptureIlluminant, type CaptureIlluminant } from "./scene-radiance.js";
import type { DisplayViewScene } from "./expected-signal.js";

/** One opaque card, in frame units as seen from the lens. */
export interface LayeredChartCard {
  /** Distance from the lens plane, metres. */
  distanceM: number;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
  /** The card's print, resolved in the card's own frame (aspect height / width). */
  scene: ChartScene;
  /** Prints the card's distance in millimetres (seven-segment digits) in its top-right corner. Default false. */
  depthLabel?: boolean;
}

/** Point lights on the back plane: a seeded, jittered grid over the frame. */
export interface LayeredChartPointLights {
  /** Seed of the jitter (an unsigned 32-bit integer). */
  seed: number;
  /** Grid columns and rows over the frame, 1 to 256 each. */
  columns: number;
  rows: number;
  /** Jitter of each light within its grid cell, a fraction of the cell in [0, 1). Default 0.5. */
  jitter?: number;
  /** Luminous intensity of each light, candela, (0, 1e7]. */
  luminousIntensityCandela: number;
  /** Relative spectrum of the lights. Default CIE illuminant A. */
  spectrum?: CaptureIlluminant;
}

/** The back plane: an unbounded, lit, neutral or spectral surface behind every card. */
export interface LayeredChartBackPlane {
  distanceM: number;
  /** Default 0.18. */
  reflectance?: ChartReflectance;
  pointLights?: LayeredChartPointLights;
}

/** A layered chart scene (`scene.kind: "layered-chart"`). */
export interface LayeredChartScene {
  kind: "layered-chart";
  /** 1 to {@link LAYERED_CHART_LIMITS}.maximumCards cards, nearest first, at strictly increasing distances. */
  cards: readonly LayeredChartCard[];
  backPlane?: LayeredChartBackPlane;
}

/**
 * Limits of layered chart scenes. `maximumEdgeKernelRadiusSites` (from 2.29.0, #764): the largest defocus kernel radius, in sites,
 * the layered sum takes at card edges, for the uniform disc (`disc`, 512: `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`, as a single
 * plane) and for a kernel shaped by `lens.defocus` bokeh options (`shaped`, 128; #749); a scene of more than one surface whose
 * kernel is larger is refused. {@link calculateLayeredChartKernelRadii} checks
 * a request against them before rendering.
 */
export const LAYERED_CHART_LIMITS = /* @__PURE__ */ Object.freeze({ maximumCards: 16, maximumLightsAcross: 256, maximumCandela: 1e7,
  maximumEdgeKernelRadiusSites: /* @__PURE__ */ Object.freeze({ disc: DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES, shaped: 128 }) });
/** Default reflectance of the back plane. */
export const LAYERED_CHART_DEFAULT_BACK_PLANE_REFLECTANCE = 0.18;

/** A frame-unit rectangle, u0 ≤ u ≤ u1, v0 ≤ v ≤ v1. */
export interface LayeredFrameRectangle { u0: number; v0: number; u1: number; v1: number }

/** One resolved surface, nearest first. */
export interface ResolvedLayeredSurface {
  kind: "card" | "back-plane";
  /** Card index in the scene's `cards`, or −1 for the back plane. */
  index: number;
  distanceM: number;
  /** The surface's rectangle in frame units; null for the far surface, which has no edge. */
  rect: LayeredFrameRectangle | null;
  /** Reflectance materials of the surface's print. */
  materials: ResolvedChartScene["materials"];
  /** The material at a frame point (u, v as seen from the lens), defined everywhere (prints continue beyond their card). */
  materialAt(u: number, v: number): number;
  /** Back plane with lights: the lights' frame positions and spectral intensity, W·sr⁻¹·nm⁻¹. */
  lights?: { u: Float64Array; v: Float64Array; pitchU: number; pitchV: number; columns: number; rows: number; intensityAt(nm: number): number };
}

export interface ResolvedLayeredChartScene {
  kind: "layered-chart";
  /** Cards nearest first, then the back plane when there is one. The last surface is the far surface (rect null). */
  surfaces: readonly ResolvedLayeredSurface[];
  /** True for one card and no back plane: a single-plane chart scene (the facade's existing path). */
  singlePlane: boolean;
  /** Frame aspect (height / width) the scene was resolved for. */
  aspect: number;
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
function finite(value: unknown, name: string, low: number, high: number, openLow = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high || (openLow && value === low))
    fail(name + " must be a finite number " + (openLow ? "above " : "from ") + low + " to " + high + ".");
  return value as number;
}
function allow(record: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof record !== "object" || record === null || Array.isArray(record)) fail(name + " must be an object.");
  for (const key of Object.keys(record as object)) if (!keys.includes(key)) fail(name + " has unknown field \"" + key + "\".");
  return record as Record<string, unknown>;
}

/** Depth label geometry in the card's frame: digits of height 0.12 × the card's height, 4 % inset from the top-right corner. */
function depthLabel(distanceM: number, cardAspect: number): { text: string; u0: number; v0: number; height: number; plate: LayeredFrameRectangle } {
  const text = String(Math.round(distanceM * 1000));
  const height = 0.24 * cardAspect, units = text.length * NUMERAL_ADVANCE - (NUMERAL_ADVANCE - NUMERAL_WIDTH), inset = 0.04 * 2 * cardAspect;
  const width = units * height, u1 = 1 - inset, v1 = cardAspect - inset, pad = 0.15 * height;
  return { text, u0: u1 - width, v0: v1 - height, height, plate: { u0: u1 - width - pad, v0: v1 - height - pad, u1: u1 + pad, v1: v1 + pad } };
}
function numeralInk(label: { text: string; u0: number; v0: number; height: number }, u: number, v: number): boolean {
  const x = (u - label.u0) / label.height, y = (v - label.v0) / label.height;
  if (y < 0 || y > 1 || x < 0) return false;
  const k = Math.floor(x / NUMERAL_ADVANCE);
  if (k >= label.text.length) return false;
  const cx = x - k * NUMERAL_ADVANCE;
  for (const s of DIGIT_SEGMENTS[label.text.charCodeAt(k) - 48]!) {
    const [x0, y0, x1, y1] = SEGMENTS[s]!;
    if (cx >= x0 && cx <= x1 && y >= y0 && y <= y1) return true;
  }
  return false;
}
/** Label plate and ink reflectances. */
const LABEL_PLATE = 0.8, LABEL_INK = 0.05;

/**
 * Validates a layered chart scene for a frame of `aspect` (height / width) and resolves its surfaces. Unknown fields and
 * values out of range fail with `InvalidConfigurationError`.
 */
export function resolveLayeredChartScene(input: { scene: LayeredChartScene; aspect: number }): ResolvedLayeredChartScene {
  const aspect = finite(input.aspect, "aspect", 0, 100, true);
  const scene = allow(input.scene, "scene", ["kind", "cards", "backPlane"]);
  if (scene.kind !== "layered-chart") fail("scene.kind must be \"layered-chart\".");
  const cards = scene.cards;
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > LAYERED_CHART_LIMITS.maximumCards)
    fail("scene.cards must list 1 to " + LAYERED_CHART_LIMITS.maximumCards + " cards.");
  const surfaces: ResolvedLayeredSurface[] = [];
  let last = 0;
  (cards as unknown[]).forEach((raw, index) => {
    const name = "scene.cards[" + index + "]";
    const card = allow(raw, name, ["distanceM", "centerU", "centerV", "width", "height", "scene", "depthLabel"]);
    const distanceM = finite(card.distanceM, name + ".distanceM", 0, 1e6, true);
    if (!(distanceM > last)) fail("scene.cards must be listed nearest first at strictly increasing distances (" + name + ").");
    last = distanceM;
    const centerU = finite(card.centerU, name + ".centerU", -4, 4), centerV = finite(card.centerV, name + ".centerV", -4, 4);
    const width = finite(card.width, name + ".width", 0, 8, true), height = finite(card.height, name + ".height", 0, 8, true);
    if (card.depthLabel !== undefined && typeof card.depthLabel !== "boolean") fail(name + ".depthLabel must be a boolean.");
    const cardAspect = height / width, chart = resolveChartScene({ scene: card.scene as ChartScene, aspect: cardAspect }), half = width / 2;
    const label = card.depthLabel === true ? depthLabel(distanceM, cardAspect) : undefined, base = chart.materials.length;
    const materials = label ? [...chart.materials, { kind: "neutral" as const, reflectance: LABEL_PLATE }, { kind: "neutral" as const, reflectance: LABEL_INK }] : chart.materials;
    const materialAt = (u: number, v: number): number => {
      const cu = (u - centerU) / half, cv = (v - centerV) / half;
      if (label && cu >= label.plate.u0 && cu <= label.plate.u1 && cv >= label.plate.v0 && cv <= label.plate.v1) return numeralInk(label, cu, cv) ? base + 1 : base;
      return chart.materialAt(cu, cv);
    };
    surfaces.push({ kind: "card", index, distanceM, rect: { u0: centerU - half, v0: centerV - height / 2, u1: centerU + half, v1: centerV + height / 2 },
      materials: Object.freeze(materials), materialAt });
  });
  if (scene.backPlane !== undefined) {
    const plane = allow(scene.backPlane, "scene.backPlane", ["distanceM", "reflectance", "pointLights"]);
    const distanceM = finite(plane.distanceM, "scene.backPlane.distanceM", 0, 1e6, true);
    if (!(distanceM > last)) fail("scene.backPlane.distanceM must be beyond the farthest card.");
    const material = resolveChartMaterial(plane.reflectance ?? LAYERED_CHART_DEFAULT_BACK_PLANE_REFLECTANCE, "scene.backPlane.reflectance");
    const surface: ResolvedLayeredSurface = { kind: "back-plane", index: -1, distanceM, rect: null, materials: Object.freeze([material]), materialAt: () => 0 };
    if (plane.pointLights !== undefined) surface.lights = resolvePointLights(plane.pointLights, aspect);
    surfaces.push(surface);
  }
  // The far surface has no edge.
  surfaces[surfaces.length - 1]!.rect = null;
  return Object.freeze({ kind: "layered-chart" as const, surfaces: Object.freeze(surfaces), singlePlane: surfaces.length === 1, aspect });
}

function resolvePointLights(value: unknown, aspect: number): NonNullable<ResolvedLayeredSurface["lights"]> {
  const name = "scene.backPlane.pointLights";
  const record = allow(value, name, ["seed", "columns", "rows", "jitter", "luminousIntensityCandela", "spectrum"]);
  const integer = (x: unknown, field: string, low: number, high: number): number => {
    if (typeof x !== "number" || !Number.isInteger(x) || x < low || x > high) fail(name + "." + field + " must be an integer from " + low + " to " + high + ".");
    return x as number;
  };
  const seed = integer(record.seed, "seed", 0, 0xffffffff), columns = integer(record.columns, "columns", 1, LAYERED_CHART_LIMITS.maximumLightsAcross);
  const rows = integer(record.rows, "rows", 1, LAYERED_CHART_LIMITS.maximumLightsAcross);
  const jitter = record.jitter === undefined ? 0.5 : finite(record.jitter, name + ".jitter", 0, 1);
  if (jitter === 1) fail(name + ".jitter must be below 1.");
  const candela = finite(record.luminousIntensityCandela, name + ".luminousIntensityCandela", 0, LAYERED_CHART_LIMITS.maximumCandela, true);
  const illuminant = resolveCaptureIlluminant((record.spectrum ?? { kind: "cie-a" }) as CaptureIlluminant);
  // Watts per steradian per unit of the relative spectrum: the photometric scale of calculateIlluminantIrradianceScale (lm → W).
  const scale = calculateIlluminantIrradianceScale(illuminant.shape, candela);
  const pitchU = 2 / columns, pitchV = 2 * aspect / rows, random = createDeterministicUniformStream(seed);
  const u = new Float64Array(columns * rows), v = new Float64Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const k = j * columns + i;
    u[k] = -1 + (i + 0.5 + jitter * (random.next() - 0.5)) * pitchU;
    v[k] = aspect - (j + 0.5 + jitter * (random.next() - 0.5)) * pitchV;
  }
  return { u, v, pitchU, pitchV, columns, rows, intensityAt: (nm) => scale * illuminant.shape.evaluate(nm) };
}

/**
 * The lattice of one surface at the spectral nodes (`DisplayViewScene`, chart materials), for the layered sum and for the
 * existing single-plane path of the sites that see this surface only.
 *
 * - `whiteRadiance`: the illuminant radiance of a perfect white diffuser at each node, irradianceScale·S(λ)/π.
 * - `siteFrameUnits`: g = 2 / outputWidth, frame units per site.
 * - `metresPerFrameUnit` at `referenceDistanceM` (frame units are angles, so at distance d it is metresPerFrameUnit·d/referenceDistanceM).
 *
 * Lights (back plane only) become one extra radiance material: the plane's radiance plus I_e / A at each node, read where a
 * lattice cell [u − g/2, u + g/2) × (v − g/2, v + g/2] holds a light. Fails when two lights can share a cell: the grid pitch is at most
 * one site, or two lights (grid neighbours after the jitter) lie closer than one site on both axes.
 */
export function layeredSurfaceScene(surface: ResolvedLayeredSurface, input: { wavelengthsNm: readonly number[]; whiteRadiance: Float64Array;
  siteFrameUnits: number; metresPerFrameUnit: number; referenceDistanceM: number }): Extract<DisplayViewScene, { kind: "materials" }> {
  const { wavelengthsNm, whiteRadiance } = input;
  const materials: ({ neutral: number } | { radiance: Float64Array })[] = surface.materials.map((m) => m.kind === "neutral" ? { neutral: m.reflectance } :
    { radiance: Float64Array.from(wavelengthsNm, (nm, n) => m.spectrum.evaluate(nm) * whiteRadiance[n]!) });
  const lights = surface.lights;
  if (!lights) return { kind: "materials", materialAt: surface.materialAt, materials, whiteRadiance };
  const g = input.siteFrameUnits, half = g / 2;
  const crowded = "scene.backPlane.pointLights: two lights can fall in one site (closer than one site on both axes), so one would be lost; use fewer columns or rows, or less jitter.";
  if (!(lights.pitchU > g && lights.pitchV > g)) fail(crowded);
  // A light lies within half a grid cell of its cell's centre, so only grid neighbours can come within a site of each other: two
  // lights closer than g on both axes share the cell of some lattice point (whatever the lattice group's shift), so they are refused.
  for (let j = 0; j < lights.rows; j++) for (let i = 0; i < lights.columns; i++) for (const [di, dj] of [[1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
    const i2 = i + di, j2 = j + dj, k = j * lights.columns + i, k2 = j2 * lights.columns + i2;
    if (i2 >= 0 && i2 < lights.columns && j2 < lights.rows && Math.abs(lights.u[k]! - lights.u[k2]!) < g && Math.abs(lights.v[k]! - lights.v[k2]!) < g) fail(crowded);
  }
  const side = g * input.metresPerFrameUnit * surface.distanceM / input.referenceDistanceM, area = side * side;
  const plane = surface.materials[0]!;
  const planeRadiance = Float64Array.from(wavelengthsNm, (nm, n) => (plane.kind === "neutral" ? plane.reflectance : plane.spectrum.evaluate(nm)) * whiteRadiance[n]!);
  const lit = Float64Array.from(wavelengthsNm, (nm, n) => planeRadiance[n]! + lights.intensityAt(nm) / area);
  materials.push({ radiance: lit });
  const index = materials.length - 1, { columns, rows } = lights;
  // A light lies within half a grid cell of its nominal centre, so the cell at (u, v) can only hold the lights of the grid cells around it.
  const materialAt = (u: number, v: number): number => {
    const i0 = Math.floor((u + 1) / lights.pitchU), j0 = Math.floor((lights.rows * lights.pitchV / 2 - v) / lights.pitchV);
    for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      if (i < 0 || j < 0 || i >= columns || j >= rows) continue;
      const k = j * columns + i, lu = lights.u[k]!, lv = lights.v[k]!;
      if (lu >= u - half && lu < u + half && lv > v - half && lv <= v + half) return index;
    }
    return 0;
  };
  return { kind: "materials", materialAt, materials, whiteRadiance };
}

/** Per surface: its distance, blur diameter and whether it lies within the depth of field. */
export interface LayeredChartDepth {
  kind: "card" | "back-plane";
  index: number;
  distanceM: number;
  /** Geometric blur-circle diameter in sites (`calculateDefocusCircle` / pitch); 0 at the focus distance. */
  defocusDiameterSites: number;
  /**
   * Signed blur radius in sites, +c/2 behind the focus plane and −c/2 in front of it: the layered sum's ray map (the image of
   * pupil point P at this surface is offset by this radius times P).
   */
  signedBlurRadiusSites: number;
  /** Between the near and far limits of `calculateDepthOfField` at the circle of confusion. */
  withinDepthOfField: boolean;
}

/**
 * The depth report of a layered chart scene as a request writes it (`result.scene.layers` reports the same records): per surface,
 * nearest first, its distance, blur diameter, signed blur radius and whether it lies within the depth of field. The scene is
 * validated as a request's is (unknown fields and values out of range fail with `InvalidConfigurationError`); the depths do not
 * depend on the frame's aspect.
 */
export function calculateLayeredChartDepths(input: { scene: LayeredChartScene; focalLengthMm: number; aperture: number; focusDistanceM: number; circleOfConfusionMm: number;
  pixelPitchMicrometers: number }): LayeredChartDepth[] {
  const record = allow(input, "calculateLayeredChartDepths input", ["scene", "focalLengthMm", "aperture", "focusDistanceM", "circleOfConfusionMm", "pixelPitchMicrometers"]);
  return layeredChartDepths(resolveLayeredChartScene({ scene: record.scene as LayeredChartScene, aspect: 2 / 3 }), input);
}

/** The depth report of a resolved scene (the facade's `result.scene.layers`). */
export function layeredChartDepths(scene: ResolvedLayeredChartScene, input: Omit<Parameters<typeof calculateLayeredChartDepths>[0], "scene">): LayeredChartDepth[] {
  const { focalLengthMm, aperture, focusDistanceM } = input;
  const dof = calculateDepthOfField({ focalLengthMm, aperture, focusDistanceM, circleOfConfusionMm: input.circleOfConfusionMm }).value;
  return scene.surfaces.map((s) => {
    const disc = resolveDefocusDisc({ focalLengthMm, aperture, focusDistanceM, subjectDistanceM: s.distanceM, pitchMicrometers: input.pixelPitchMicrometers });
    const side = s.distanceM > focusDistanceM ? 1 : s.distanceM < focusDistanceM ? -1 : 0;
    return { kind: s.kind, index: s.index, distanceM: s.distanceM, defocusDiameterSites: disc.diameterSites, signedBlurRadiusSites: side * disc.diameterSites / 2,
      withinDepthOfField: s.distanceM >= dof.nearLimitM && (dof.farLimitM === null || s.distanceM <= dof.farLimitM) };
  });
}

/** Per surface: the defocus kernel radius a request needs and whether the renderer takes it (#764). */
export interface LayeredChartKernelRadius {
  kind: "card" | "back-plane";
  /** Card index in the scene's `cards`, or −1 for the back plane. */
  index: number;
  /** Radius R of the surface's defocus kernel, sites (0 in focus): the kernel the request renders, (2R + 1)² taps. */
  kernelRadiusSites: number;
  /** True when R is within the bound the request's route applies (see {@link calculateLayeredChartKernelRadii}): the request renders this surface's blur. */
  withinBound: boolean;
}

/**
 * From 2.29.0 (#764): the defocus kernel radius of each surface of a layered chart scene, nearest first, and whether it is within
 * the bound the renderer applies, without building a kernel or rendering. The radius is the one the facade builds: the disc of
 * `createDefocusDiscSiteKernel` (⌈c/2 − ½⌉ for the blur diameter c in sites, `calculateDefocusCircle`), or with `defocus` bokeh
 * options (`blades`, `sphericalAberration`, `catsEye`, as `lens.defocus` takes them) the shaped kernel's reach on the surface's
 * side of the focus plane, on axis (a cat's eye's field zones keep the axis kernel's radius), from the same function the kernel
 * builder uses.
 *
 * The bound: a scene of more than one surface takes the layered sum, which refuses a kernel radius above
 * `LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites` (`disc` without bokeh options, `shaped` with them). A scene of one card and no
 * back plane renders on the single-plane path: there the bound is `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES` (512), and with a cat's eye
 * the capture's 64 sites. Only the kernel size is checked: other refusals (options layered scenes do not support, a cat's eye with
 * `lens.diffraction`) are not. The scene and the bokeh options are validated as a request's are; the lens values follow
 * `calculateDefocusCircle` (positive and finite, distances beyond the focal length), failing with `InvalidScientificInputError`.
 * Geometric thin-lens blur (no diffraction), an approximation.
 */
export function calculateLayeredChartKernelRadii(input: { scene: LayeredChartScene; focalLengthMm: number; aperture: number; focusDistanceM: number;
  pixelPitchMicrometers: number; defocus?: { model: "geometric-disc" } & DefocusBokehOptions }): LayeredChartKernelRadius[] {
  const record = allow(input, "calculateLayeredChartKernelRadii input", ["scene", "focalLengthMm", "aperture", "focusDistanceM", "pixelPitchMicrometers", "defocus"]);
  const resolved = resolveLayeredChartScene({ scene: record.scene as LayeredChartScene, aspect: 2 / 3 });
  const { focalLengthMm, aperture, focusDistanceM, pixelPitchMicrometers } = input;
  let options: ReturnType<typeof resolveDefocusBokehOptions> | undefined;
  if (record.defocus !== undefined) {
    const { model, ...bokeh } = allow(record.defocus, "defocus", ["model", "blades", "sphericalAberration", "catsEye"]);
    if (model !== "geometric-disc") fail("defocus.model must be \"geometric-disc\".");
    if (Object.keys(bokeh).length > 0) options = resolveDefocusBokehOptions(bokeh, "defocus");
  }
  const limits = LAYERED_CHART_LIMITS.maximumEdgeKernelRadiusSites;
  const bound = !resolved.singlePlane ? (options ? limits.shaped : limits.disc) : options?.catsEye ? DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES : DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES;
  return resolved.surfaces.map((s) => {
    const disc = resolveDefocusDisc({ focalLengthMm, aperture, focusDistanceM, subjectDistanceM: s.distanceM, pitchMicrometers: pixelPitchMicrometers }), c = disc.diameterSites;
    const radius = !(c > 0) ? 0 : !options ? disc.kernelRadiusSites :
      defocusBokehKernelRadius({ diameterSites: c, side: s.distanceM > focusDistanceM ? 1 : -1, fNumber: aperture, focalLengthMm, pitchMicrometers: pixelPitchMicrometers, options });
    return { kind: s.kind, index: s.index, kernelRadiusSites: radius, withinBound: radius <= bound };
  });
}

/** Preset scales: the first depth step from the focus plane. */
export const LAYERED_CHART_PRESET_SCALES = /* @__PURE__ */ Object.freeze({ macro: 0.001, tabletop: 0.01, large: 0.25 });
/** Growth of successive depth steps away from the focus plane (owner decision 5 of the 2.27.0 plan). */
export const LAYERED_CHART_PRESET_STEP_RATIO = 1.5;

/**
 * The staircase preset: `cards` cards (default 5, 1 to 9) with one at the focus distance, the rest stepping back and to the right,
 * each overlapping the one behind it, and a back plane with a grid of point lights two steps beyond the farthest card (the next two
 * steps of the series behind the focus plane).
 *
 * Spacing. Behind the focus plane the steps grow geometrically from the scale's first step (`macro` 1 mm, `tabletop` 1 cm,
 * `large` 0.25 m) by {@link LAYERED_CHART_PRESET_STEP_RATIO}: d_i = s + first·(1 + 1.5 + … + 1.5^(i−1)). In front of it the cards
 * are placed symmetric in defocus: the blur diameter c = f²·|s − d|/(N·d·(s − f)) is proportional to |s − d|/d, so the front
 * card matching d_i is at s·d_i/(2·d_i − s), whatever the lens. More cards then sit where sharpness changes fastest.
 * Each card shows a Siemens star and its depth label. The lights' intensity, 0.05 cd per square metre of distance, gives every
 * scale the same illuminance at the lens (a starting value, to be revisited once the presets can be looked at).
 */
export function resolveLayeredChartPreset(input: { scale: keyof typeof LAYERED_CHART_PRESET_SCALES; cards?: number; focusDistanceM: number;
  lens: { focalLengthMm: number }; aspect?: number; pointLights?: boolean }): LayeredChartScene {
  const record = allow(input, "resolveLayeredChartPreset input", ["scale", "cards", "focusDistanceM", "lens", "aspect", "pointLights"]);
  const first = LAYERED_CHART_PRESET_SCALES[record.scale as keyof typeof LAYERED_CHART_PRESET_SCALES];
  if (typeof record.scale !== "string" || !Object.hasOwn(LAYERED_CHART_PRESET_SCALES, record.scale) || first === undefined)
    fail("scale must be \"macro\", \"tabletop\" or \"large\".");
  const count = record.cards === undefined ? 5 : record.cards;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 9) fail("cards must be an integer from 1 to 9.");
  const s = finite(record.focusDistanceM, "focusDistanceM", 0, 1e6, true);
  const lens = allow(record.lens, "lens", ["focalLengthMm"]), f = finite(lens.focalLengthMm, "lens.focalLengthMm", 0, 1e5, true) / 1000;
  const aspect = record.aspect === undefined ? 2 / 3 : finite(record.aspect, "aspect", 0.1, 10);
  if (record.pointLights !== undefined && typeof record.pointLights !== "boolean") fail("pointLights must be a boolean.");
  const n = count as number, front = Math.floor((n - 1) / 2), behind = n - 1 - front;
  const behindDistances: number[] = [];
  let d = s, step = first!;
  for (let i = 0; i < Math.max(behind, front) + 1; i++) { d += step; behindDistances.push(d); step *= LAYERED_CHART_PRESET_STEP_RATIO; }
  const distances = [...behindDistances.slice(0, front).map((b) => s * b / (2 * b - s)).reverse(), s, ...behindDistances.slice(0, behind)];
  if (distances[0]! <= 1.01 * f) fail("The nearest card (" + distances[0]!.toPrecision(3) + " m) is within the lens's focal length; focus farther or use a smaller scale.");
  // Staircase: nearest card at the bottom left, each farther card up and to the right, overlapping it.
  const width = Math.min(0.9, 3 / (n + 2)), height = Math.min(1.2 * width, 2 * aspect * 0.6), margin = 0.05;
  const spanU = 2 - width - 2 * margin, spanV = 2 * aspect - height - 2 * margin;
  const cards: LayeredChartCard[] = distances.map((distanceM, k) => {
    const t = n === 1 ? 0.5 : k / (n - 1), cardAspect = height / width;
    return { distanceM, centerU: -1 + margin + width / 2 + t * spanU, centerV: -aspect + margin + height / 2 + t * spanV, width, height, depthLabel: true,
      scene: { preset: "composite", background: { preset: "uniform", reflectance: 0.6 },
        elements: [{ scene: { preset: "siemens-star" }, centerU: 0.35, centerV: 0.1 * cardAspect, width: 1.1, height: 1.1, mask: "ellipse" }] } };
  });
  const backPlaneDistance = behindDistances[behindDistances.length - 1]! + step;
  return { kind: "layered-chart", cards,
    backPlane: { distanceM: backPlaneDistance, reflectance: 0.05, ...(record.pointLights === false ? {} :
      { pointLights: { seed: 652, columns: 12, rows: Math.max(1, Math.round(12 * aspect)), jitter: 0.5, luminousIntensityCandela: 0.05 * backPlaneDistance * backPlaneDistance } }) } };
}
