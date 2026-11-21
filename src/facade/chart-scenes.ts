// SPDX-License-Identifier: Apache-2.0

/**
 * Procedural test charts for the capture facade, written for this engine. Every chart is a flat,
 * Lambertian (matte) reflectance pattern, defined by formulas in normalized frame coordinates. No
 * third-party chart data (for example ColorChecker reflectances) is bundled. Colored patches use
 * spectra that the caller supplies or, from 2.14, Photivra's own analytic color patches
 * (`color-patches.ts`, docs/COLOR_PATCHES.md).
 *
 * Frame coordinates: `u` runs from -1 (left edge of the framed chart) to +1 (right edge); `v` points up
 * and has the same scale, so it runs from -aspect to +aspect where aspect = height/width of the frame.
 * The facade places the chart perpendicular to the optical axis at the subject distance and sizes it so
 * that this rectangle exactly fills the active capture (see `SimulateCaptureResult.assumptions`), or, with
 * `simulateCapture({ chartSize })` (2.3), at its physical size.
 *
 * The slanted edge follows the geometry described by P. D. Burns, "Slanted-Edge MTF for Digital Camera
 * and Scanner Analysis", IS&T PICS 2000 (free from imaging.org; also ISO 12233). It is a near-vertical
 * edge rotated by a few degrees (5 degrees by default), with a 4:1 light/dark reflectance ratio by
 * default. This is only a geometric description. No measured chart or ISO test procedure is copied.
 *
 * Chart elements (2.3) are generic, unbranded test-pattern primitives; each element's definition and
 * source is given at its preset below. A `composite` chart lays out any of them in placement rectangles
 * over a background, so an application can build its own layout from engine parts. Continuous patterns
 * (sine star, zone plate, dead-leaves greys) are quantized to {@link CHART_CONTINUOUS_LEVELS} equal neutral
 * levels, like the grey ramp: the step (below 0.1 % of the range) is far below sensor noise.
 * @see docs/QUICK_START.md for the chart catalogue and their analytic definitions.
 */

import { portableExp, portablePow } from "../core/portable-math.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { prepareColorimetricSpectrum, type ColorimetricSpectrum, type PreparedColorimetricSpectrum } from "../color/color-matching-functions.js";
import { requireInputObject, requireInputKeys } from "../core/record-validation.js";
import { createDeterministicUniformStream } from "../sensor/stochastic-seed.js";
import { COLOR_PATCH_IDS, COLOR_PATCH_SET_ID, COLOR_PATCH_SET_VERSION, findColorPatch, prepareColorPatchSpectrum, type ColorPatchId } from "./color-patches.js";

/**
 * 2.14: one of the engine's built-in color patches (see `getColorPatchSet()`): its reflectance spectrum, Photivra's own
 * analytic design, rendered through the same spectral path as a caller spectrum.
 */
export interface ColorPatchReflectance { kind: "color-patch"; patchId: ColorPatchId }
/**
 * A neutral (spectrally flat) reflectance in [0, 1], a caller reflectance spectrum (values in [0, 1]) or, from 2.14, a
 * built-in color patch `{ kind: "color-patch", patchId }`.
 */
export type ChartReflectance = number | ColorimetricSpectrum | ColorPatchReflectance;

export interface UniformChartScene { preset: "uniform"; reflectance?: ChartReflectance }
export interface SlantedEdgeChartScene {
  preset: "slanted-edge";
  /** Clockwise tilt of the edge from vertical, degrees, in (-45, 45). Default 5. */
  angleDegrees?: number;
  /** Left (dark) side reflectance. Default 0.15. */
  darkReflectance?: number;
  /** Right (light) side reflectance. Default 0.6 (4:1 with the default dark side). */
  lightReflectance?: number;
}
export interface SiemensStarChartScene {
  preset: "siemens-star";
  /** Light/dark sector pairs around the star, 2..360. Default 36. */
  cycles?: number;
  /** Star radius as a fraction of the frame half-height, (0, 1]. Default 0.9. */
  radiusFraction?: number;
  darkReflectance?: number;
  lightReflectance?: number;
  /** Reflectance outside the star. Default 0.18. */
  backgroundReflectance?: number;
  /**
   * 2.3: angular reflectance profile. `bar` (default): square-wave sectors. `sine`: a sinusoidal star,
   * R(θ) = mid + amp·sin(2π·cycles·(θ/2π + ½)) between the dark and light reflectances, zero crossings at
   * the bar star's sector edges, quantized to {@link CHART_CONTINUOUS_LEVELS} levels. Reported in the
   * parameters only when given, so 2.2 scene digests are unchanged.
   */
  profile?: "bar" | "sine";
}
export interface StepWedgeChartScene {
  preset: "step-wedge";
  /** Number of equal-width vertical steps from left (minimum) to right (maximum), 2..64. Default 11. */
  steps?: number;
  minimumReflectance?: number;
  maximumReflectance?: number;
  /** `equal-density` (geometric, default) or `linear` reflectance spacing. */
  spacing?: "equal-density" | "linear";
}
export interface GreyRampChartScene {
  preset: "grey-ramp";
  /** Continuous ramp, linear in reflectance from left (minimum) to right (maximum). */
  minimumReflectance?: number;
  maximumReflectance?: number;
}
export interface CheckerboardChartScene {
  preset: "checkerboard";
  /** Squares across the frame width, 2..256. Default 8. */
  squaresAcross?: number;
  darkReflectance?: number;
  lightReflectance?: number;
}
export interface PointGridChartScene {
  preset: "point-grid";
  /** Grid columns and rows of small disks centred in equal cells. Defaults 5 × 3. */
  columns?: number;
  rows?: number;
  /** Disk radius in frame units (fraction of the frame half-width). Default 0.01. */
  radius?: number;
  pointReflectance?: number;
  backgroundReflectance?: number;
}
export interface PatchChartScene {
  preset: "patches";
  /** Caller reflectance per patch, row-major; the facade bundles no color-chart data. 1..1024 patches. */
  patches: readonly { patchId: string; reflectance: ChartReflectance }[];
  /** Patches per row. Default ceil(sqrt(patch count)). */
  columns?: number;
  /** Gap between patches as a fraction of the cell size, [0, 0.5). Default 0.1. */
  gapFraction?: number;
  backgroundReflectance?: number;
}
/**
 * 2.14: the built-in Photivra color patches (`getColorPatchSet()`) in a grid, drawn like `patches`: row-major, each
 * patch centred in an equal cell with a neutral gap around it. The spectra are the engine's own analytic designs; no
 * third-party chart data, names, order or layout are used.
 */
export interface ColorPatchesChartScene {
  preset: "color-patches";
  /** Patches to draw, row-major, distinct. Default: the whole set in `COLOR_PATCH_IDS` order (30 patches, six per row). */
  patchIds?: readonly ColorPatchId[];
  /** Patches per row, 1 to the patch count. Default min(6, patch count). */
  columns?: number;
  /** Gap between patches as a fraction of the cell size, [0, 0.5). Default 0.1. */
  gapFraction?: number;
  /** Neutral reflectance of the gaps and empty cells. Default 0.18. */
  backgroundReflectance?: number;
}
/**
 * 2.3: seeded dead-leaves texture (Matheron's random closed set model, in the scale-invariant form used for
 * camera texture measurement by Cao, Guichard and Hornung): opaque disks with Poisson-distributed centres,
 * radius density ∝ r⁻³ on [radiusMinimum, radiusMaximum] and a grey drawn uniformly in [minimum, maximum]
 * reflectance. Disks are drawn in order with earlier disks on top until every point of the chart (plus 0.1
 * frame units around it) is covered, which samples the stationary dead-leaves image exactly (Kendall and
 * Thönnes' backward "perfect simulation"). Radii are in frame units (fraction of the frame half-width).
 */
export interface DeadLeavesChartScene {
  preset: "dead-leaves";
  /** Smallest disk radius, frame units, [0.002, radiusMaximum). Default 0.01. */
  radiusMinimum?: number;
  /** Largest disk radius, frame units, (radiusMinimum, 2]. Default 0.5. */
  radiusMaximum?: number;
  /** Grey range (neutral reflectances). Defaults 0.2 and 0.6. */
  minimumReflectance?: number;
  maximumReflectance?: number;
  /** Random seed (uint32); the same seed gives the same disks on every platform. Default 1. */
  seed?: number;
}
/**
 * 2.3: groups of three dark bars on a light plate (the three-bar concept of the US Air Force 1951 target,
 * a US-government publication, in the engine's own arrangement): one group per frequency, vertical bars (horizontal resolution)
 * in the upper row and horizontal bars (vertical resolution) below, optionally labelled with engine-drawn
 * seven-segment numerals. Frequencies are line widths per picture height (LW/PH, as in ISO 12233), where
 * the picture height is the chart's height: one bar is PH/LW wide.
 */
export interface BarGroupsChartScene {
  preset: "bar-groups";
  /** One group per entry, left to right: integers 1..100000. Default [100, 200, 400, 800]. 1..32 entries. */
  lineWidthsPerPictureHeight?: readonly number[];
  /** Draw each group's LW/PH value below it. Default true. */
  numerals?: boolean;
  darkReflectance?: number;
  lightReflectance?: number;
}
/**
 * 2.3: hyperbolic wedge: `lineCount` dark lines separated by light gaps of the same width, whose width
 * shrinks along the wedge axis so that the frequency rises linearly from the minimum to the maximum LW/PH.
 * The line edges are hyperbolas. `horizontal`: the axis runs left to right and the lines are nearly
 * horizontal (vertical resolution); `vertical`: the axis runs bottom to top (horizontal resolution).
 */
export interface HyperbolicWedgeChartScene {
  preset: "hyperbolic-wedge";
  orientation?: "horizontal" | "vertical";
  /** Dark lines, 1..50. Default 5. */
  lineCount?: number;
  /** LW/PH at the start and end of the axis. Defaults 100 and 1000. */
  minimumLineWidthsPerPictureHeight?: number;
  maximumLineWidthsPerPictureHeight?: number;
  darkReflectance?: number;
  lightReflectance?: number;
}
/**
 * 2.3: circular zone plate R(r) = mid + amp·cos(π·k·r²): the local frequency k·r rises linearly from 0 at
 * the centre to `maximumCyclesPerPictureHeight` at the rim (the quadratic-phase chirp of a Fresnel zone
 * plate). Quantized to {@link CHART_CONTINUOUS_LEVELS} levels.
 */
export interface ZonePlateChartScene {
  preset: "zone-plate";
  /** Plate radius as a fraction of the frame half-height, (0, 1]. Default 0.9. */
  radiusFraction?: number;
  /** Frequency at the rim, cycles per picture height. Default 200. */
  maximumCyclesPerPictureHeight?: number;
  darkReflectance?: number;
  lightReflectance?: number;
  backgroundReflectance?: number;
}
/**
 * 2.3: a field of dark squares rotated clockwise by `angleDegrees` on a light background, one centred in
 * each of columns × rows equal cells: every square gives two near-vertical and two near-horizontal slanted
 * edges (Burns, PICS 2000). See {@link calculateSlantedSquareEdges}.
 */
export interface SlantedSquaresChartScene {
  preset: "slanted-squares";
  columns?: number;
  rows?: number;
  /** Square side as a fraction of the smaller cell side, (0, 1); the rotated square must stay in its cell. Default 0.5. */
  sizeFraction?: number;
  /** Clockwise rotation, degrees, in (-45, 45). Default 5. */
  angleDegrees?: number;
  /** Square (dark) and background (light) reflectances. Defaults 0.15 and 0.6 (4:1). */
  darkReflectance?: number;
  lightReflectance?: number;
}
/** 2.3: straight lines at every multiple of `spacing` from the centre in u and v (a distortion and registration grid). */
export interface LineGridChartScene {
  preset: "line-grid";
  /** Distance between lines, frame units, (0, 2]. Default 1/3 (six cells across). */
  spacing?: number;
  /** Line width, frame units, (0, spacing). Default 0.01. */
  lineWidth?: number;
  lineReflectance?: number;
  backgroundReflectance?: number;
}
/** 2.3: registration fiducial: a 2 × 2 checker disk inside a dark ring; `inverted` swaps the checker phase (an orientation cue). */
export interface FiducialChartScene {
  preset: "fiducial";
  /** Disk radius as a fraction of the frame half-height, (0, 1]. Default 0.8. */
  radiusFraction?: number;
  /** Ring width as a fraction of the radius, (0, 1). Default 0.18. */
  ringFraction?: number;
  /** Default false: the upper-right and lower-left quadrants are dark. */
  inverted?: boolean;
  darkReflectance?: number;
  lightReflectance?: number;
  backgroundReflectance?: number;
}
/** Any chart preset except `composite`: a composite's background or element. */
export type ChartElementScene = UniformChartScene | SlantedEdgeChartScene | SiemensStarChartScene | StepWedgeChartScene | GreyRampChartScene |
  CheckerboardChartScene | PointGridChartScene | PatchChartScene | ColorPatchesChartScene | DeadLeavesChartScene | BarGroupsChartScene | HyperbolicWedgeChartScene |
  ZonePlateChartScene | SlantedSquaresChartScene | LineGridChartScene | FiducialChartScene;
/**
 * One element of a composite chart: a preset drawn inside its placement rectangle (frame units of the
 * composite). The element sees its own frame: u = ±1 at the rectangle's left and right edges, aspect =
 * height / width, and LW/PH frequencies still refer to the composite's picture height.
 */
export interface CompositeChartElement {
  scene: ChartElementScene;
  centerU: number;
  centerV: number;
  width: number;
  height: number;
  /** `rectangle` (default) or `ellipse` inscribed in the rectangle; outside it, earlier elements or the background show. */
  mask?: "rectangle" | "ellipse";
}
/**
 * 2.3: an ordered list of elements over a background. Later elements cover earlier ones. The engine
 * provides only the generic parts; a branded or product-specific layout stays in the application.
 */
export interface CompositeChartScene {
  preset: "composite";
  /** Fills the whole composite frame. Default `{ preset: "uniform", reflectance: 0.18 }`. */
  background?: ChartElementScene;
  /** 1..256 elements, drawn in order. */
  elements: readonly CompositeChartElement[];
}
export type ChartScene = ChartElementScene | CompositeChartScene;
export type ChartScenePresetId = ChartScene["preset"];
export const CHART_SCENE_PRESETS: readonly ChartScenePresetId[] = /* @__PURE__ */ Object.freeze(["uniform", "slanted-edge", "siemens-star",
  "step-wedge", "grey-ramp", "checkerboard", "point-grid", "patches", "dead-leaves", "bar-groups", "hyperbolic-wedge", "zone-plate",
  "slanted-squares", "line-grid", "fiducial", "color-patches", "composite"] as const);
/** Neutral levels that represent a continuous pattern (grey ramp; 2.3 sine star, zone plate and dead-leaves greys). */
export const CHART_CONTINUOUS_LEVELS = 1024;

/** Engine-chosen chart parameters, each reported when the caller omitted it. */
export const CHART_SCENE_DEFAULTS = /* @__PURE__ */ Object.freeze({
  uniform: /* @__PURE__ */ Object.freeze({ reflectance: 0.18 }),
  "slanted-edge": /* @__PURE__ */ Object.freeze({ angleDegrees: 5, darkReflectance: 0.15, lightReflectance: 0.6 }),
  "siemens-star": /* @__PURE__ */ Object.freeze({ cycles: 36, radiusFraction: 0.9, darkReflectance: 0.05, lightReflectance: 0.8, backgroundReflectance: 0.18 }),
  "step-wedge": /* @__PURE__ */ Object.freeze({ steps: 11, minimumReflectance: 0.03, maximumReflectance: 0.9, spacing: "equal-density" as const }),
  "grey-ramp": /* @__PURE__ */ Object.freeze({ minimumReflectance: 0.03, maximumReflectance: 0.9 }),
  checkerboard: /* @__PURE__ */ Object.freeze({ squaresAcross: 8, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "point-grid": /* @__PURE__ */ Object.freeze({ columns: 5, rows: 3, radius: 0.01, pointReflectance: 0.9, backgroundReflectance: 0.02 }),
  patches: /* @__PURE__ */ Object.freeze({ gapFraction: 0.1, backgroundReflectance: 0.18 }),
  "dead-leaves": /* @__PURE__ */ Object.freeze({ radiusMinimum: 0.01, radiusMaximum: 0.5, minimumReflectance: 0.2, maximumReflectance: 0.6, seed: 1 }),
  "bar-groups": /* @__PURE__ */ Object.freeze({ lineWidthsPerPictureHeight: /* @__PURE__ */ Object.freeze([100, 200, 400, 800]), numerals: true, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "hyperbolic-wedge": /* @__PURE__ */ Object.freeze({ orientation: "horizontal" as const, lineCount: 5, minimumLineWidthsPerPictureHeight: 100,
    maximumLineWidthsPerPictureHeight: 1000, darkReflectance: 0.05, lightReflectance: 0.8 }),
  "zone-plate": /* @__PURE__ */ Object.freeze({ radiusFraction: 0.9, maximumCyclesPerPictureHeight: 200, darkReflectance: 0.1, lightReflectance: 0.7, backgroundReflectance: 0.18 }),
  "slanted-squares": /* @__PURE__ */ Object.freeze({ columns: 3, rows: 2, sizeFraction: 0.5, angleDegrees: 5, darkReflectance: 0.15, lightReflectance: 0.6 }),
  "line-grid": /* @__PURE__ */ Object.freeze({ spacing: 1 / 3, lineWidth: 0.01, lineReflectance: 0.42, backgroundReflectance: 0.6 }),
  fiducial: /* @__PURE__ */ Object.freeze({ radiusFraction: 0.8, ringFraction: 0.18, inverted: false, darkReflectance: 0.05, lightReflectance: 0.8, backgroundReflectance: 0.18 }),
  "color-patches": /* @__PURE__ */ Object.freeze({ patchIds: COLOR_PATCH_IDS, gapFraction: 0.1, backgroundReflectance: 0.18 }),
  composite: /* @__PURE__ */ Object.freeze({ background: /* @__PURE__ */ Object.freeze({ preset: "uniform" as const, reflectance: 0.18 }) })
});

/** A validated chart: every parameter resolved, plus which ones came from {@link CHART_SCENE_DEFAULTS}. */
export interface ResolvedChartScene {
  preset: ChartScenePresetId;
  /** Fully resolved parameters (spectra are reported as `"caller-spectrum"`). */
  parameters: Readonly<Record<string, unknown>>;
  /** Names of parameters filled from defaults. */
  defaultedParameters: readonly string[];
  /** Frame aspect (height / width) the chart was resolved for. */
  aspect: number;
  /**
   * Material index at a frame point (u right, v up). The index points into `materials`, starting at 0.
   * Points outside the framed rectangle still evaluate (the pattern continues as defined), so blur and
   * small framing differences stay well defined.
   */
  materialAt(u: number, v: number): number;
  /** Reflectance materials: a neutral number or a prepared caller spectrum. */
  materials: readonly ({ kind: "neutral"; reflectance: number } | { kind: "spectrum"; spectrum: PreparedColorimetricSpectrum })[];
  /** Reflectance in [0, 1] at a frame point and wavelength (nm). */
  reflectanceAt(u: number, v: number, wavelengthNanometers: number): number;
}

function reflectance(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new InvalidConfigurationError(name + " must be a reflectance in [0, 1].");
  return value;
}
function integerIn(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new InvalidConfigurationError(name + " must be an integer from " + minimum + " to " + maximum + ".");
  return value;
}
function finiteIn(value: unknown, name: string, minimum: number, maximum: number, open = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (open && (value === minimum || value === maximum)))
    throw new InvalidConfigurationError(name + " is outside its supported range.");
  return value;
}
/** Wavelength range every chart spectrum must cover (the facade's sensor quadrature range). */
export const CHART_SPECTRAL_RANGE_NANOMETERS = /* @__PURE__ */ Object.freeze({ minimum: 380, maximum: 780 });
/**
 * Internal: validates a chart reflectance input (a neutral number, a reflectance spectrum covering 380–780 nm or a
 * built-in color patch) as a material.
 */
export function resolveChartMaterial(value: unknown, name: string, exp?: (x: number) => number): ResolvedChartScene["materials"][number] {
  if (typeof value === "number") return { kind: "neutral", reflectance: reflectance(value, name) };
  if (typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "color-patch") {
    for (const key of Object.keys(value)) if (key !== "kind" && key !== "patchId") throw new InvalidConfigurationError(name + " has unknown field \"" + key + "\".");
    const patch = findColorPatch((value as { patchId?: unknown }).patchId);
    if (!patch) throw new InvalidConfigurationError(name + ".patchId must be one of the built-in color patches (COLOR_PATCH_IDS).");
    return { kind: "spectrum", spectrum: prepareColorPatchSpectrum(patch, exp) };
  }
  let spectrum: PreparedColorimetricSpectrum;
  try { spectrum = prepareColorimetricSpectrum(value as ColorimetricSpectrum, name); } catch (error) {
    throw new InvalidConfigurationError(name + " must be a neutral reflectance or a valid reflectance spectrum: " + (error instanceof Error ? error.message : "invalid"));
  }
  const range = spectrum.wavelengthRangeNanometers;
  if (range.minimum > CHART_SPECTRAL_RANGE_NANOMETERS.minimum || range.maximum < CHART_SPECTRAL_RANGE_NANOMETERS.maximum)
    throw new InvalidConfigurationError(name + " must cover 380-780 nm.");
  for (let nm = CHART_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= CHART_SPECTRAL_RANGE_NANOMETERS.maximum; nm += 5) reflectance(spectrum.evaluate(nm), name + " values");
  return { kind: "spectrum", spectrum };
}

/** How a uniform chart reports its reflectance: the number, the color-patch record, or `"caller-spectrum"`. */
function reflectanceReport(raw: unknown): unknown {
  if (typeof raw === "number") return raw;
  const record = raw as { kind?: unknown; patchId?: unknown };
  return record.kind === "color-patch" ? { kind: "color-patch", patchId: record.patchId } : "caller-spectrum";
}
/** Material at a point of a row-major patch grid (`patches`, 2.14 `color-patches`): a patch index or `backgroundIndex`. */
function patchGridMaterialAt(columns: number, rows: number, count: number, gap: number, aspect: number, backgroundIndex: number): (u: number, v: number) => number {
  const cellW = 2 / columns, cellH = 2 * aspect / rows;
  return (u, v) => {
    const fx = (u + 1) / cellW, fy = (aspect - v) / cellH, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= columns || j >= rows) return backgroundIndex;
    const index = j * columns + i, x = fx - i, y = fy - j;
    if (index >= count || x < gap / 2 || x > 1 - gap / 2 || y < gap / 2 || y > 1 - gap / 2) return backgroundIndex;
    return index;
  };
}

/** Raw caller spectrum inputs per material (undefined for neutral materials), for the facade's scene digest. */
const MATERIAL_INPUTS = new WeakMap<ResolvedChartScene, readonly unknown[]>();
/**
 * Internal (not exported from the package): the caller input behind each material of a resolved chart, in
 * material order (`undefined` for an engine neutral). The facade hashes caller spectra from these inputs.
 */
export function chartMaterialInputs(chart: ResolvedChartScene): readonly unknown[] {
  return MATERIAL_INPUTS.get(chart) ?? chart.materials.map(() => undefined);
}

/** One group of a `bar-groups` chart in its own frame units (internal). */
export interface ChartBarGroupGeometry { lineWidthsPerPictureHeight: number; lineWidth: number; cell: { u0: number; u1: number }; verticalBars: ChartRectangle;
  horizontalBars: ChartRectangle; label?: { text: string; u0: number; v0: number; height: number } }
/**
 * Internal (not exported from the package): the float64 constants and tables a resolved chart's `materialAt` decides
 * with, so another evaluator (the `webgpu-f32` chart stage, #477) can classify points with the same geometry. Every
 * value is the one the closure holds; nothing is recomputed. `composite` lists its resolved background and elements.
 */
export type ChartGeometry =
  | { kind: "uniform" }
  | { kind: "slanted-edge"; c: number; s: number }
  | { kind: "siemens-star"; profile: "bar" | "sine"; cycles: number; r: number; dark: number; light: number; background: number }
  | { kind: "step-wedge"; steps: number }
  | { kind: "checkerboard"; size: number }
  | { kind: "point-grid"; columns: number; rows: number; cellW: number; cellH: number; radius: number; centers: readonly { u: number; v: number }[] }
  | { kind: "patches"; columns: number; rows: number; count: number; gap: number; cellW: number; cellH: number; backgroundIndex: number }
  | { kind: "dead-leaves"; u0: number; v0: number; cell: number; nx: number; ny: number; head: Int32Array; next: Int32Array; entryDisk: Int32Array; entries: number;
      X: Float64Array; Y: Float64Array; R2: Float64Array; level: Uint16Array; diskCount: number; mean: number }
  | { kind: "bar-groups"; groups: readonly ChartBarGroupGeometry[] }
  | { kind: "hyperbolic-wedge"; orientation: "horizontal" | "vertical"; lines: number; ph: number; lw0: number; lw1: number }
  | { kind: "zone-plate"; r: number; k: number; dark: number; light: number }
  | { kind: "slanted-squares"; columns: number; rows: number; cellW: number; cellH: number; c: number; s: number; half: number }
  | { kind: "line-grid"; spacing: number; half: number }
  | { kind: "fiducial"; r: number; inner: number; inverted: boolean }
  | { kind: "composite"; background: ResolvedChartScene;
      elements: readonly { chart: ResolvedChartScene; offset: number; cu: number; cv: number; hw: number; hh: number; scale: number; ellipse: boolean }[] };
const GEOMETRY = new WeakMap<ResolvedChartScene, ChartGeometry>();
/** Internal: the geometry of a chart resolved by {@link resolveChartScene} (see {@link ChartGeometry}). */
export function chartGeometry(chart: ResolvedChartScene): ChartGeometry {
  const geometry = GEOMETRY.get(chart);
  if (!geometry) throw new InvalidConfigurationError("Not a chart resolved by resolveChartScene.");
  return geometry;
}
/** Frame context of a chart being resolved: the picture height (in its own frame units) its LW/PH frequencies refer to. */
/**
 * `pow`: the portable power for the display view's step-wedge levels, and (2.14) `exp`: the portable exponential for its
 * built-in color patches (passed in, so captures' bundles do not contain them).
 */
interface ChartContext { pictureHeight: number; nested: boolean; pow?: (x: number, y: number) => number; exp?: (x: number) => number }
type Materials = ResolvedChartScene["materials"][number][];
const neutralMaterials = (values: readonly number[]): Materials => values.map((reflectanceValue) => ({ kind: "neutral" as const, reflectance: reflectanceValue }));
/** CHART_CONTINUOUS_LEVELS equal neutral levels between `from` and `to` (level i at from + (to − from)(i + ½)/levels). */
function continuousMaterials(from: number, to: number): Materials {
  return Array.from({ length: CHART_CONTINUOUS_LEVELS }, (_, i) => ({ kind: "neutral" as const, reflectance: from + (to - from) * (i + 0.5) / CHART_CONTINUOUS_LEVELS }));
}
/** The level index of a continuous value between `from` and `to`. */
function continuousLevel(value: number, from: number, to: number): number {
  return Math.min(CHART_CONTINUOUS_LEVELS - 1, Math.max(0, Math.floor((value - from) / (to - from) * CHART_CONTINUOUS_LEVELS)));
}
function booleanParameter(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new InvalidConfigurationError(name + " must be true or false.");
  return value;
}

/**
 * Validates a chart description and resolves every default. `aspect` is the frame height/width. Unknown
 * fields are rejected so that a mistyped parameter never silently falls back to a default.
 */
export function resolveChartScene(input: { scene: ChartScene; aspect: number }): ResolvedChartScene {
  requireInputObject(input, "resolveChartScene input");
  for (const key of Object.keys(input)) if (key !== "scene" && key !== "aspect") throw new InvalidConfigurationError("resolveChartScene input has unknown field \"" + key + "\".");
  const { scene, aspect } = input;
  requireInputObject(scene, "chart scene");
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect <= 0) throw new InvalidConfigurationError("Chart aspect must be positive.");
  return resolveScene(scene, aspect, { pictureHeight: 2 * aspect, nested: false });
}
/**
 * Internal (not exported from the package): {@link resolveChartScene} with the step wedge's geometric levels computed
 * with the portable power (`portablePow`, within 1 ulp) instead of `**`, and (2.14) the built-in color patches with the
 * portable exponential (`portableExp`) instead of `Math.exp`, whose last bits differ between JavaScript engines. Every
 * other value, the geometry and the material order are the same. The display view uses its materials.
 */
export function resolvePortableChartScene(input: { scene: ChartScene; aspect: number }): ResolvedChartScene {
  requireInputObject(input, "resolveChartScene input");
  return resolveScene(input.scene, input.aspect, { pictureHeight: 2 * input.aspect, nested: false, pow: portablePow, exp: portableExp });
}

function resolveScene(scene: unknown, aspect: number, context: ChartContext): ResolvedChartScene {
  requireInputObject(scene, "chart scene");
  const preset = (scene as { preset?: unknown }).preset;
  if (typeof preset !== "string" || !(CHART_SCENE_PRESETS as readonly string[]).includes(preset)) throw new InvalidConfigurationError("Unknown chart preset.");
  if (preset === "composite" && context.nested) throw new InvalidConfigurationError("A composite chart cannot contain another composite.");
  const record = scene as Record<string, unknown>;
  const defaults = CHART_SCENE_DEFAULTS[preset as ChartScenePresetId] as Record<string, unknown>;
  const extra = preset === "patches" ? ["patches", "columns"] : preset === "color-patches" ? ["columns"] : preset === "composite" ? ["elements"] : preset === "siemens-star" ? ["profile"] : [];
  const allowed = ["preset", ...Object.keys(defaults), ...extra];
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new InvalidConfigurationError("Unknown chart parameter: " + key + ".");
  const defaulted: string[] = [];
  const get = (key: string): unknown => { if (record[key] === undefined) { if (key in defaults) defaulted.push(key); return defaults[key]; } return record[key]; };
  const neutral = (key: string): number => reflectance(get(key), key);
  const done = (parameters: Record<string, unknown>, materials: ResolvedChartScene["materials"], materialAt: (u: number, v: number) => number,
    inputs: readonly unknown[] | undefined, geometry: ChartGeometry): ResolvedChartScene => {
    const chart: ResolvedChartScene = Object.freeze({ preset: preset as ChartScenePresetId, parameters: Object.freeze(parameters), defaultedParameters: Object.freeze(defaulted), aspect,
      materials: Object.freeze(materials), materialAt,
      reflectanceAt(u: number, v: number, nm: number): number {
        const m = materials[materialAt(u, v)]!;
        if (m.kind === "neutral") return m.reflectance;
        const value = m.spectrum.evaluate(nm);
        if (!(value >= 0 && value <= 1)) throw new InvalidConfigurationError("Chart reflectance spectrum left [0, 1].");
        return value;
      } });
    if (inputs) MATERIAL_INPUTS.set(chart, Object.freeze([...inputs]));
    GEOMETRY.set(chart, geometry);
    return chart;
  };
  switch (preset as ChartScenePresetId) {
    case "uniform": {
      const raw = get("reflectance"), m = resolveChartMaterial(raw, "reflectance", context.exp);
      return done({ reflectance: reflectanceReport(raw) }, [m], () => 0, [typeof raw === "number" ? undefined : raw], { kind: "uniform" });
    }
    case "slanted-edge": {
      const angle = finiteIn(get("angleDegrees"), "angleDegrees", -45, 45, true), dark = neutral("darkReflectance"), light = neutral("lightReflectance");
      const t = angle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      // Edge through the frame centre along (sin t, cos t); the light side is to the right.
      return done({ angleDegrees: angle, darkReflectance: dark, lightReflectance: light },
        [{ kind: "neutral", reflectance: dark }, { kind: "neutral", reflectance: light }], (u, v) => (u * c - v * s >= 0 ? 1 : 0), undefined, { kind: "slanted-edge", c, s });
    }
    case "siemens-star": {
      const cycles = integerIn(get("cycles"), "cycles", 2, 360), radius = finiteIn(get("radiusFraction"), "radiusFraction", 0, 1, false);
      if (radius === 0) throw new InvalidConfigurationError("radiusFraction must be positive.");
      const dark = neutral("darkReflectance"), light = neutral("lightReflectance"), background = neutral("backgroundReflectance"), r = radius * aspect;
      const profile = record.profile;
      if (profile !== undefined && profile !== "bar" && profile !== "sine") throw new InvalidConfigurationError("profile must be bar or sine.");
      const parameters: Record<string, unknown> = { cycles, radiusFraction: radius, darkReflectance: dark, lightReflectance: light, backgroundReflectance: background };
      if (profile === "sine") {
        // Sinusoidal star (2.3): zero crossings at the bar star's sector edges, light where the bar star is light.
        if (dark === light) throw new InvalidConfigurationError("A sine star needs different dark and light reflectances.");
        const mid = (dark + light) / 2, amp = (light - dark) / 2, materials = continuousMaterials(dark, light);
        materials.push({ kind: "neutral", reflectance: background });
        return done({ ...parameters, profile, representation: CHART_CONTINUOUS_LEVELS + " equal neutral levels" }, materials, (u, v) => {
          if (u * u + v * v > r * r) return CHART_CONTINUOUS_LEVELS;
          const phase = Math.atan2(v, u) / (2 * Math.PI) + 0.5;
          return continuousLevel(mid + amp * Math.sin(2 * Math.PI * cycles * phase), dark, light);
        }, undefined, { kind: "siemens-star", profile: "sine", cycles, r, dark, light, background });
      }
      if (profile === "bar") parameters.profile = profile;
      return done(parameters,
        [{ kind: "neutral", reflectance: dark }, { kind: "neutral", reflectance: light }, { kind: "neutral", reflectance: background }], (u, v) => {
          if (u * u + v * v > r * r) return 2;
          const phase = Math.atan2(v, u) / (2 * Math.PI) + 0.5; // [0, 1]
          return Math.floor(phase * 2 * cycles) % 2 === 0 ? 1 : 0;
        }, undefined, { kind: "siemens-star", profile: "bar", cycles, r, dark, light, background });
    }
    case "step-wedge": {
      const steps = integerIn(get("steps"), "steps", 2, 64), lo = neutral("minimumReflectance"), hi = neutral("maximumReflectance"), spacing = get("spacing");
      if (spacing !== "equal-density" && spacing !== "linear") throw new InvalidConfigurationError("spacing must be equal-density or linear.");
      if (!(hi > lo) || (spacing === "equal-density" && lo <= 0)) throw new InvalidConfigurationError("Step wedge needs 0 < minimum < maximum reflectance.");
      const values = stepWedgeReflectances(steps, lo, hi, spacing, context.pow);
      return done({ steps, minimumReflectance: lo, maximumReflectance: hi, spacing, stepReflectances: values },
        values.map((reflectanceValue) => ({ kind: "neutral" as const, reflectance: reflectanceValue })),
        (u) => Math.min(steps - 1, Math.max(0, Math.floor((u + 1) / 2 * steps))), undefined, { kind: "step-wedge", steps });
    }
    case "grey-ramp": {
      const lo = neutral("minimumReflectance"), hi = neutral("maximumReflectance");
      if (!(hi > lo)) throw new InvalidConfigurationError("Grey ramp needs minimum < maximum reflectance.");
      // A continuous ramp is stored as 1024 neutral levels. The step size (< 0.1 % of the range) is far below sensor noise.
      const levels = 1024, materials = Array.from({ length: levels }, (_, i) => ({ kind: "neutral" as const, reflectance: lo + (hi - lo) * (i + 0.5) / levels }));
      return done({ minimumReflectance: lo, maximumReflectance: hi, representation: "1024 equal neutral levels" }, materials,
        (u) => Math.min(levels - 1, Math.max(0, Math.floor((u + 1) / 2 * levels))), undefined, { kind: "step-wedge", steps: levels });
    }
    case "checkerboard": {
      const across = integerIn(get("squaresAcross"), "squaresAcross", 2, 256), dark = neutral("darkReflectance"), light = neutral("lightReflectance"), size = 2 / across;
      return done({ squaresAcross: across, darkReflectance: dark, lightReflectance: light },
        [{ kind: "neutral", reflectance: dark }, { kind: "neutral", reflectance: light }],
        (u, v) => ((Math.floor((u + 1) / size) + Math.floor((aspect - v) / size)) % 2 === 0 ? 1 : 0), undefined, { kind: "checkerboard", size });
    }
    case "point-grid": {
      const columns = integerIn(get("columns"), "columns", 1, 256), rows = integerIn(get("rows"), "rows", 1, 256);
      const radius = finiteIn(get("radius"), "radius", 0, 1, true), point = neutral("pointReflectance"), background = neutral("backgroundReflectance");
      const centers = calculatePointGridCenters({ columns, rows, aspect });
      const cellW = 2 / columns, cellH = 2 * aspect / rows;
      return done({ columns, rows, radius, pointReflectance: point, backgroundReflectance: background },
        [{ kind: "neutral", reflectance: background }, { kind: "neutral", reflectance: point }], (u, v) => {
          const i = Math.min(columns - 1, Math.max(0, Math.floor((u + 1) / cellW))), j = Math.min(rows - 1, Math.max(0, Math.floor((aspect - v) / cellH)));
          const c = centers[j * columns + i]!;
          return (u - c.u) ** 2 + (v - c.v) ** 2 <= radius * radius ? 1 : 0;
        }, undefined, { kind: "point-grid", columns, rows, cellW, cellH, radius, centers });
    }
    case "patches": {
      const list = record.patches;
      if (!Array.isArray(list) || list.length < 1 || list.length > 1024) throw new InvalidConfigurationError("patches must list 1 to 1024 caller reflectances.");
      const ids = new Set<string>();
      const materials: ResolvedChartScene["materials"][number][] = [], inputs: unknown[] = [];
      for (const [index, patch] of list.entries()) {
        requireInputObject(patch, "patches[" + index + "]");
        const p = patch as Record<string, unknown>;
        for (const key of Object.keys(p)) if (key !== "patchId" && key !== "reflectance") throw new InvalidConfigurationError("Unknown patch field: " + key + ".");
        if (typeof p.patchId !== "string" || p.patchId.trim() === "" || ids.has(p.patchId)) throw new InvalidConfigurationError("Each patch needs a unique non-empty patchId.");
        ids.add(p.patchId);
        materials.push(resolveChartMaterial(p.reflectance, "patches[" + index + "].reflectance", context.exp));
        inputs.push(typeof p.reflectance === "number" ? undefined : p.reflectance);
      }
      const columnsRaw = record.columns === undefined ? Math.ceil(Math.sqrt(list.length)) : record.columns;
      if (record.columns === undefined) defaulted.push("columns");
      const columns = integerIn(columnsRaw, "columns", 1, list.length), rows = Math.ceil(list.length / columns);
      const gap = finiteIn(get("gapFraction"), "gapFraction", 0, 0.5), background = neutral("backgroundReflectance");
      if (gap >= 0.5) throw new InvalidConfigurationError("gapFraction must be below 0.5.");
      const backgroundIndex = materials.length;
      materials.push({ kind: "neutral", reflectance: background });
      inputs.push(undefined);
      const cellW = 2 / columns, cellH = 2 * aspect / rows;
      return done({ patchIds: list.map((p: { patchId: string }) => p.patchId), columns, rows, gapFraction: gap, backgroundReflectance: background }, materials,
        patchGridMaterialAt(columns, rows, list.length, gap, aspect, backgroundIndex), inputs, { kind: "patches", columns, rows, count: list.length, gap, cellW, cellH, backgroundIndex });
    }
    case "color-patches": {
      const ids = get("patchIds");
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > COLOR_PATCH_IDS.length) throw new InvalidConfigurationError("patchIds must list 1 to " + COLOR_PATCH_IDS.length + " built-in color patch ids.");
      const seen = new Set<string>(), materials: Materials = [], inputs: unknown[] = [];
      for (const [index, id] of ids.entries()) {
        if (!findColorPatch(id)) throw new InvalidConfigurationError("patchIds[" + index + "] must be one of the built-in color patches (COLOR_PATCH_IDS).");
        if (seen.has(id as string)) throw new InvalidConfigurationError("patchIds[" + index + "] repeats " + JSON.stringify(id) + ".");
        seen.add(id as string);
        const input = Object.freeze({ kind: "color-patch" as const, patchId: id as ColorPatchId });
        materials.push(resolveChartMaterial(input, "patchIds[" + index + "]", context.exp));
        inputs.push(input);
      }
      const columnsRaw = record.columns === undefined ? Math.min(6, ids.length) : record.columns;
      if (record.columns === undefined) defaulted.push("columns");
      const columns = integerIn(columnsRaw, "columns", 1, ids.length), rows = Math.ceil(ids.length / columns);
      const gap = finiteIn(get("gapFraction"), "gapFraction", 0, 0.5), background = neutral("backgroundReflectance");
      if (gap >= 0.5) throw new InvalidConfigurationError("gapFraction must be below 0.5.");
      const backgroundIndex = materials.length;
      materials.push({ kind: "neutral", reflectance: background });
      inputs.push(undefined);
      const cellW = 2 / columns, cellH = 2 * aspect / rows;
      return done({ patchSet: COLOR_PATCH_SET_ID, patchSetVersion: COLOR_PATCH_SET_VERSION, patchIds: [...ids], columns, rows, gapFraction: gap, backgroundReflectance: background },
        materials, patchGridMaterialAt(columns, rows, ids.length, gap, aspect, backgroundIndex), inputs,
        { kind: "patches", columns, rows, count: ids.length, gap, cellW, cellH, backgroundIndex });
    }
    case "dead-leaves": {
      const rMin = finiteIn(get("radiusMinimum"), "radiusMinimum", DEAD_LEAVES_MINIMUM_RADIUS, 2), rMax = finiteIn(get("radiusMaximum"), "radiusMaximum", 0, 2, true);
      if (!(rMax > rMin)) throw new InvalidConfigurationError("radiusMaximum must exceed radiusMinimum.");
      const lo = neutral("minimumReflectance"), hi = neutral("maximumReflectance"), seed = integerIn(get("seed"), "seed", 0, 0xffffffff);
      if (hi < lo) throw new InvalidConfigurationError("Dead leaves need minimum ≤ maximum reflectance.");
      const leaves = generateDeadLeaves(rMin, rMax, seed, aspect);
      return done({ radiusMinimum: rMin, radiusMaximum: rMax, minimumReflectance: lo, maximumReflectance: hi, seed, diskCount: leaves.diskCount,
        radiusDensity: "proportional-to-r^-3", representation: CHART_CONTINUOUS_LEVELS + " equal neutral levels" }, continuousMaterials(lo, hi), leaves.levelAt, undefined,
        { kind: "dead-leaves", ...leaves.tables });
    }
    case "bar-groups": {
      const lws = get("lineWidthsPerPictureHeight");
      if (!Array.isArray(lws) || lws.length < 1 || lws.length > 32) throw new InvalidConfigurationError("lineWidthsPerPictureHeight must list 1 to 32 frequencies.");
      const list = lws.map((lw, i) => integerIn(lw, "lineWidthsPerPictureHeight[" + i + "]", 1, 100_000));
      const numerals = booleanParameter(get("numerals"), "numerals"), dark = neutral("darkReflectance"), light = neutral("lightReflectance");
      const layout = barGroupLayout(list, numerals, aspect, context.pictureHeight);
      return done({ lineWidthsPerPictureHeight: list, numerals, darkReflectance: dark, lightReflectance: light }, neutralMaterials([dark, light]), (u, v) => {
        for (const g of layout) {
          if (u < g.cell.u0 || u > g.cell.u1) continue;
          const b = g.verticalBars, h = g.horizontalBars;
          if (u >= b.u0 && u < b.u1 && v >= b.v0 && v <= b.v1) return Math.floor((u - b.u0) / g.lineWidth) % 2 === 0 ? 0 : 1;
          if (u >= h.u0 && u <= h.u1 && v > h.v0 && v <= h.v1) return Math.floor((h.v1 - v) / g.lineWidth) % 2 === 0 ? 0 : 1;
          if (g.label && numeralInk(g.label, u, v)) return 0;
          return 1;
        }
        return 1;
      }, undefined, { kind: "bar-groups", groups: layout });
    }
    case "hyperbolic-wedge": {
      const orientation = get("orientation");
      if (orientation !== "horizontal" && orientation !== "vertical") throw new InvalidConfigurationError("orientation must be horizontal or vertical.");
      const lines = integerIn(get("lineCount"), "lineCount", 1, 50);
      const lw0 = finiteIn(get("minimumLineWidthsPerPictureHeight"), "minimumLineWidthsPerPictureHeight", 0, 1e6, true);
      const lw1 = finiteIn(get("maximumLineWidthsPerPictureHeight"), "maximumLineWidthsPerPictureHeight", 0, 1e6, true);
      if (!(lw1 > lw0)) throw new InvalidConfigurationError("maximumLineWidthsPerPictureHeight must exceed minimumLineWidthsPerPictureHeight.");
      const dark = neutral("darkReflectance"), light = neutral("lightReflectance"), ph = context.pictureHeight;
      const across = orientation === "horizontal" ? 2 * aspect : 2;
      if ((2 * lines - 1) * ph / lw0 > across) throw new InvalidConfigurationError("The wedge's " + (2 * lines - 1) + " line widths at " + lw0 + " LW/PH do not fit across the chart.");
      return done({ orientation, lineCount: lines, minimumLineWidthsPerPictureHeight: lw0, maximumLineWidthsPerPictureHeight: lw1, darkReflectance: dark, lightReflectance: light },
        neutralMaterials([dark, light]), (u, v) => {
          const s = orientation === "horizontal" ? (u + 1) / 2 : (v + aspect) / (2 * aspect), y = orientation === "horizontal" ? v : u;
          if (s < 0 || s > 1) return 1;
          const w = ph / (lw0 + (lw1 - lw0) * s), half = (2 * lines - 1) * w / 2;
          if (y < -half || y >= half) return 1;
          return Math.floor((y + half) / w) % 2 === 0 ? 0 : 1;
        }, undefined, { kind: "hyperbolic-wedge", orientation, lines, ph, lw0, lw1 });
    }
    case "zone-plate": {
      const radius = finiteIn(get("radiusFraction"), "radiusFraction", 0, 1, false);
      if (radius === 0) throw new InvalidConfigurationError("radiusFraction must be positive.");
      const fMax = finiteIn(get("maximumCyclesPerPictureHeight"), "maximumCyclesPerPictureHeight", 0, 1e6, true);
      const dark = neutral("darkReflectance"), light = neutral("lightReflectance"), background = neutral("backgroundReflectance");
      if (dark === light) throw new InvalidConfigurationError("A zone plate needs different dark and light reflectances.");
      // Local frequency of cos(π·k·r²) is k·r cycles per frame unit: k·R = fMax / PH at the rim.
      const r = radius * aspect, k = fMax / context.pictureHeight / r, mid = (dark + light) / 2, amp = (light - dark) / 2;
      const materials = continuousMaterials(dark, light);
      materials.push({ kind: "neutral", reflectance: background });
      return done({ radiusFraction: radius, maximumCyclesPerPictureHeight: fMax, darkReflectance: dark, lightReflectance: light, backgroundReflectance: background,
        representation: CHART_CONTINUOUS_LEVELS + " equal neutral levels" }, materials, (u, v) => {
        const r2 = u * u + v * v;
        if (r2 > r * r) return CHART_CONTINUOUS_LEVELS;
        return continuousLevel(mid + amp * Math.cos(Math.PI * k * r2), dark, light);
      }, undefined, { kind: "zone-plate", r, k, dark, light });
    }
    case "slanted-squares": {
      const columns = integerIn(get("columns"), "columns", 1, 64), rows = integerIn(get("rows"), "rows", 1, 64);
      const size = finiteIn(get("sizeFraction"), "sizeFraction", 0, 1, true), angle = finiteIn(get("angleDegrees"), "angleDegrees", -45, 45, true);
      const dark = neutral("darkReflectance"), light = neutral("lightReflectance");
      const t = angle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      if (size * (Math.abs(c) + Math.abs(s)) > 1) throw new InvalidConfigurationError("The rotated squares must stay inside their cells: sizeFraction·(|cos θ| + |sin θ|) ≤ 1.");
      const cellW = 2 / columns, cellH = 2 * aspect / rows, half = size * Math.min(cellW, cellH) / 2;
      return done({ columns, rows, sizeFraction: size, angleDegrees: angle, darkReflectance: dark, lightReflectance: light }, neutralMaterials([dark, light]), (u, v) => {
        const i = Math.min(columns - 1, Math.max(0, Math.floor((u + 1) / cellW))), j = Math.min(rows - 1, Math.max(0, Math.floor((aspect - v) / cellH)));
        const du = u - (-1 + (i + 0.5) * cellW), dv = v - (aspect - (j + 0.5) * cellH);
        const x = du * c - dv * s, y = du * s + dv * c;
        return Math.abs(x) <= half && Math.abs(y) <= half ? 0 : 1;
      }, undefined, { kind: "slanted-squares", columns, rows, cellW, cellH, c, s, half });
    }
    case "line-grid": {
      const spacing = finiteIn(get("spacing"), "spacing", 0, 2, true), width = finiteIn(get("lineWidth"), "lineWidth", 0, spacing, true);
      const line = neutral("lineReflectance"), background = neutral("backgroundReflectance"), half = width / 2;
      return done({ spacing, lineWidth: width, lineReflectance: line, backgroundReflectance: background }, neutralMaterials([background, line]),
        (u, v) => (Math.abs(u - spacing * Math.round(u / spacing)) <= half || Math.abs(v - spacing * Math.round(v / spacing)) <= half ? 1 : 0), undefined,
        { kind: "line-grid", spacing, half });
    }
    case "fiducial": {
      const radius = finiteIn(get("radiusFraction"), "radiusFraction", 0, 1, false), ring = finiteIn(get("ringFraction"), "ringFraction", 0, 1, true);
      if (radius === 0) throw new InvalidConfigurationError("radiusFraction must be positive.");
      const inverted = booleanParameter(get("inverted"), "inverted"), dark = neutral("darkReflectance"), light = neutral("lightReflectance"), background = neutral("backgroundReflectance");
      const r = radius * aspect, inner = r * (1 - ring);
      return done({ radiusFraction: radius, ringFraction: ring, inverted, darkReflectance: dark, lightReflectance: light, backgroundReflectance: background },
        neutralMaterials([dark, light, background]), (u, v) => {
          const r2 = u * u + v * v;
          if (r2 > r * r) return 2;
          if (r2 > inner * inner) return 0;
          return ((u >= 0) === (v >= 0)) !== inverted ? 0 : 1;
        }, undefined, { kind: "fiducial", r, inner, inverted });
    }
    case "composite": {
      const list = record.elements;
      if (!Array.isArray(list) || list.length < 1 || list.length > 256) throw new InvalidConfigurationError("elements must list 1 to 256 chart elements.");
      const portable = { ...(context.pow ? { pow: context.pow } : {}), ...(context.exp ? { exp: context.exp } : {}) };
      const nested: ChartContext = { pictureHeight: context.pictureHeight, nested: true, ...portable };
      const background = resolveScene(get("background"), aspect, nested);
      const materials: Materials = [...background.materials], inputs: unknown[] = [...chartMaterialInputs(background)];
      for (const key of background.defaultedParameters) defaulted.push("background.parameters." + key);
      const elements = list.map((value: unknown, index: number) => {
        const name = "elements[" + index + "]";
        requireInputObject(value, name);
        const e = value as Record<string, unknown>;
        for (const key of Object.keys(e)) if (!["scene", "centerU", "centerV", "width", "height", "mask"].includes(key)) throw new InvalidConfigurationError("Unknown " + name + " field: " + key + ".");
        const cu = finiteIn(e.centerU, name + ".centerU", -1e6, 1e6), cv = finiteIn(e.centerV, name + ".centerV", -1e6, 1e6);
        const width = finiteIn(e.width, name + ".width", 0, 1e6, true), height = finiteIn(e.height, name + ".height", 0, 1e6, true);
        const mask = e.mask === undefined ? "rectangle" : e.mask;
        if (mask !== "rectangle" && mask !== "ellipse") throw new InvalidConfigurationError(name + ".mask must be rectangle or ellipse.");
        if (e.mask === undefined) defaulted.push("elements." + index + ".placement.mask");
        // The element's own frame: u = ±1 across its width; frequencies keep the composite's picture height.
        const chart = resolveScene(e.scene, height / width, { pictureHeight: context.pictureHeight * 2 / width, nested: true, ...portable });
        for (const key of chart.defaultedParameters) defaulted.push("elements." + index + ".parameters." + key);
        const offset = materials.length;
        materials.push(...chart.materials);
        inputs.push(...chartMaterialInputs(chart));
        return { chart, offset, cu, cv, hw: width / 2, hh: height / 2, scale: 2 / width, ellipse: mask === "ellipse",
          report: { preset: chart.preset, placement: { centerU: cu, centerV: cv, width, height, mask }, parameters: chart.parameters } };
      });
      return done({ background: { preset: background.preset, parameters: background.parameters }, elements: elements.map((e) => e.report) }, materials, (u, v) => {
        for (let i = elements.length - 1; i >= 0; i--) {
          const e = elements[i]!, du = u - e.cu, dv = v - e.cv;
          if (du < -e.hw || du > e.hw || dv < -e.hh || dv > e.hh) continue;
          if (e.ellipse && (du / e.hw) ** 2 + (dv / e.hh) ** 2 > 1) continue;
          return e.offset + e.chart.materialAt(du * e.scale, dv * e.scale);
        }
        return background.materialAt(u, v);
      }, inputs, { kind: "composite", background, elements: elements.map((e) => ({ chart: e.chart, offset: e.offset, cu: e.cu, cv: e.cv, hw: e.hw, hh: e.hh, scale: e.scale, ellipse: e.ellipse })) });
    }
  }
}

/** Smallest dead-leaves disk radius, frame units: bounds the lookup grid and the disk count. */
const DEAD_LEAVES_MINIMUM_RADIUS = 0.002;
/** Dead-leaves work limits: lookup cells and disks. */
const DEAD_LEAVES_MAXIMUM_CELLS = 4_194_304, DEAD_LEAVES_MAXIMUM_DISKS = 4_000_000;
/** The covered margin around the chart, frame units; beyond it the texture is its mean grey. */
const DEAD_LEAVES_MARGIN = 0.1;
/**
 * Dead-leaves disks, drawn front to back: disk n lies under disks 0..n−1. Each disk is listed in the lookup
 * cells it overlaps that are not yet covered; a cell is closed as soon as one disk covers it entirely, so no
 * later disk can show in it. Drawing stops when every cell is closed (the domain is fully covered), which is
 * the backward perfect simulation of the stationary model (Kendall and Thönnes 1999). Deterministic: the
 * engine's xorshift32 stream, and only correctly rounded operations (+ − × ÷ and √) on the drawn values.
 */
function generateDeadLeaves(rMin: number, rMax: number, seed: number, aspect: number): { diskCount: number; levelAt(u: number, v: number): number;
  tables: Omit<Extract<ChartGeometry, { kind: "dead-leaves" }>, "kind"> } {
  const u0 = -1 - DEAD_LEAVES_MARGIN, v0 = -aspect - DEAD_LEAVES_MARGIN, width = 2 + 2 * DEAD_LEAVES_MARGIN, height = 2 * aspect + 2 * DEAD_LEAVES_MARGIN;
  const cell = Math.max(rMin, Math.sqrt(width * height / DEAD_LEAVES_MAXIMUM_CELLS));
  const nx = Math.ceil(width / cell), ny = Math.ceil(height / cell), cells = nx * ny;
  if (!(cells <= DEAD_LEAVES_MAXIMUM_CELLS)) throw new InvalidConfigurationError("Dead leaves: the chart aspect is too extreme for the lookup grid.");
  const closed = new Uint8Array(cells), head = new Int32Array(cells).fill(-1), tail = new Int32Array(cells).fill(-1);
  let next = new Int32Array(1 << 16), entryDisk = new Int32Array(1 << 16), entries = 0;
  let X = new Float64Array(1 << 14), Y = new Float64Array(1 << 14), R2 = new Float64Array(1 << 14), level = new Uint16Array(1 << 14);
  const a = 1 / (rMin * rMin), b = 1 / (rMax * rMax), random = createDeterministicUniformStream(seed);
  let open = cells, n = 0;
  while (open > 0) {
    if (n >= DEAD_LEAVES_MAXIMUM_DISKS) throw new InvalidConfigurationError("Dead leaves need more than " + DEAD_LEAVES_MAXIMUM_DISKS + " disks; raise radiusMinimum.");
    // Inverse CDF of the density ∝ r⁻³ on [rMin, rMax]: r = (rMin⁻² − U·(rMin⁻² − rMax⁻²))^(−1/2).
    const r = 1 / Math.sqrt(a - random.next() * (a - b));
    const x = u0 - rMax + random.next() * (width + 2 * rMax), y = v0 - rMax + random.next() * (height + 2 * rMax);
    const grey = Math.min(CHART_CONTINUOUS_LEVELS - 1, Math.floor(random.next() * CHART_CONTINUOUS_LEVELS));
    if (n === X.length) {
      const grow = <T extends Float64Array | Uint16Array>(old: T, make: (length: number) => T): T => { const out = make(old.length * 2); out.set(old); return out; };
      X = grow(X, (l) => new Float64Array(l)); Y = grow(Y, (l) => new Float64Array(l)); R2 = grow(R2, (l) => new Float64Array(l)); level = grow(level, (l) => new Uint16Array(l));
    }
    X[n] = x; Y[n] = y; R2[n] = r * r; level[n] = grey;
    const i0 = Math.max(0, Math.floor((x - r - u0) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r - u0) / cell));
    const j0 = Math.max(0, Math.floor((y - r - v0) / cell)), j1 = Math.min(ny - 1, Math.floor((y + r - v0) / cell));
    for (let j = j0; j <= j1; j++) {
      const cy0 = v0 + j * cell, cy1 = cy0 + cell, ny0 = Math.max(cy0, Math.min(y, cy1)) - y;
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        if (closed[c]) continue;
        const cx0 = u0 + i * cell, cx1 = cx0 + cell, nx0 = Math.max(cx0, Math.min(x, cx1)) - x;
        if (nx0 * nx0 + ny0 * ny0 > r * r) continue;
        if (entries === next.length) {
          const grownNext = new Int32Array(entries * 2), grownDisk = new Int32Array(entries * 2);
          grownNext.set(next); grownDisk.set(entryDisk); next = grownNext; entryDisk = grownDisk;
        }
        entryDisk[entries] = n; next[entries] = -1;
        if (tail[c]! < 0) head[c] = entries; else next[tail[c]!] = entries;
        tail[c] = entries++;
        const fx = Math.max(Math.abs(cx0 - x), Math.abs(cx1 - x)), fy = Math.max(Math.abs(cy0 - y), Math.abs(cy1 - y));
        if (fx * fx + fy * fy <= r * r) { closed[c] = 1; open--; }
      }
    }
    n++;
  }
  const mean = CHART_CONTINUOUS_LEVELS / 2;
  return { diskCount: n, tables: { u0, v0, cell, nx, ny, head, next, entryDisk, entries, X, Y, R2, level, diskCount: n, mean }, levelAt(u: number, v: number): number {
    const i = Math.floor((u - u0) / cell), j = Math.floor((v - v0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return mean;
    for (let e = head[j * nx + i]!; e >= 0; e = next[e]!) {
      const d = entryDisk[e]!, dx = u - X[d]!, dy = v - Y[d]!;
      if (dx * dx + dy * dy <= R2[d]!) return level[d]!;
    }
    return mean;
  } };
}

/** An axis-aligned rectangle in chart frame units: u0 ≤ u ≤ u1, v0 ≤ v ≤ v1. */
export interface ChartRectangle { u0: number; v0: number; u1: number; v1: number }
interface NumeralLabel { text: string; u0: number; v0: number; height: number }
type BarGroup = ChartBarGroupGeometry;
/**
 * Bar-group layout in the chart's own frame: G equal columns (80 % group, 20 % gap), rows from the top
 * 40 % vertical bars, 40 % horizontal bars, 20 % numerals (50 %/50 % without numerals), each row inset by
 * 5 % of its height. A group is five line widths (three dark bars, two light gaps) centred in its cell.
 */
function barGroupLayout(list: readonly number[], numerals: boolean, aspect: number, pictureHeight: number): BarGroup[] {
  const H = 2 * aspect, weights = numerals ? [0.4, 0.4, 0.2] : [0.5, 0.5], column = 2 / list.length;
  const rows: { v0: number; v1: number }[] = [];
  let top = aspect;
  for (const w of weights) { const h = H * w; rows.push({ v0: top - h + 0.05 * h, v1: top - 0.05 * h }); top -= h; }
  return list.map((lw, i) => {
    const w = pictureHeight / lw, u0 = -1 + i * column + 0.1 * column, u1 = u0 + 0.8 * column, uc = (u0 + u1) / 2;
    const r0 = rows[0]!, r1 = rows[1]!, vc = (r1.v0 + r1.v1) / 2;
    if (5 * w > u1 - u0 || 5 * w > r1.v1 - r1.v0) throw new InvalidConfigurationError("The bar group at " + lw + " LW/PH (five line widths) does not fit its cell; use fewer groups or higher frequencies.");
    const group: BarGroup = { lineWidthsPerPictureHeight: lw, lineWidth: w, cell: { u0, u1 },
      verticalBars: { u0: uc - 2.5 * w, v0: r0.v0, u1: uc + 2.5 * w, v1: r0.v1 }, horizontalBars: { u0, v0: vc - 2.5 * w, u1, v1: vc + 2.5 * w } };
    if (numerals) {
      const r2 = rows[2]!, text = String(lw), units = text.length * NUMERAL_ADVANCE - (NUMERAL_ADVANCE - NUMERAL_WIDTH);
      const height = Math.min(r2.v1 - r2.v0, (u1 - u0) / units);
      group.label = { text, u0: uc - units * height / 2, v0: (r2.v0 + r2.v1) / 2 - height / 2, height };
    }
    return group;
  });
}
/** Engine-drawn seven-segment numerals: a 0.6 × 1 cell per digit (baseline at 0, y up), stroke 0.16, advance 0.82. */
export const NUMERAL_WIDTH = 0.6, NUMERAL_ADVANCE = 0.82;
/** Internal: segment rectangles [x0, y0, x1, y1] of the seven-segment numerals and the segments each digit lights. */
export const SEGMENTS: Readonly<Record<string, readonly [number, number, number, number]>> = /* @__PURE__ */ Object.freeze({
  a: [0.08, 0.84, 0.52, 1], b: [0.44, 0.5, 0.6, 1], c: [0.44, 0, 0.6, 0.5], d: [0.08, 0, 0.52, 0.16], e: [0, 0, 0.16, 0.5], f: [0, 0.5, 0.16, 1], g: [0.08, 0.42, 0.52, 0.58] });
export const DIGIT_SEGMENTS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];
function numeralInk(label: NumeralLabel, u: number, v: number): boolean {
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

/** Element placements of a resolved chart with a frame map to the chart's frame units (one identity entry for a plain preset). */
function chartElements(chart: ResolvedChartScene): { index: number | null; preset: string; parameters: Record<string, unknown>; aspect: number; pictureHeight: number;
  toFrame(u: number, v: number): { u: number; v: number }; scale: number }[] {
  if (chart.preset !== "composite") return [{ index: null, preset: chart.preset, parameters: chart.parameters as Record<string, unknown>, aspect: chart.aspect,
    pictureHeight: 2 * chart.aspect, toFrame: (u, v) => ({ u, v }), scale: 1 }];
  const elements = (chart.parameters.elements as readonly { preset: string; placement: { centerU: number; centerV: number; width: number; height: number }; parameters: Record<string, unknown> }[]);
  return elements.map((e, index) => {
    const p = e.placement, s = p.width / 2;
    return { index, preset: e.preset, parameters: e.parameters, aspect: p.height / p.width, pictureHeight: 2 * chart.aspect / s,
      toFrame: (u: number, v: number) => ({ u: p.centerU + u * s, v: p.centerV + v * s }), scale: s };
  });
}
const mapRectangle = (r: ChartRectangle, toFrame: (u: number, v: number) => { u: number; v: number }): ChartRectangle => {
  const a = toFrame(r.u0, r.v0), b = toFrame(r.u1, r.v1);
  return { u0: a.u, v0: a.v, u1: b.u, v1: b.v };
};

/** One bar group of a `bar-groups` chart or composite element, in the chart's frame units. */
export interface ChartBarGroupTarget {
  /** Composite element index, or null for a plain `bar-groups` chart. */
  elementIndex: number | null;
  lineWidthsPerPictureHeight: number;
  /** Line pairs (cycles) per picture height: LW/PH ÷ 2. */
  cyclesPerPictureHeight: number;
  /** Width of one bar, frame units. */
  lineWidth: number;
  /** The three vertical bars (horizontal resolution) and the three horizontal bars (vertical resolution). */
  verticalBars: ChartRectangle;
  horizontalBars: ChartRectangle;
}
/**
 * The bar groups of a `bar-groups` chart, or of every `bar-groups` element of a composite, in the chart's
 * frame units (2.3). `aspect` is the chart's height / width, as for {@link resolveChartScene}.
 */
export function calculateBarGroupTargets(input: { scene: ChartScene; aspect: number }): ChartBarGroupTarget[] {
  requireInputKeys(input, "calculateBarGroupTargets", ["scene", "aspect"]);
  const chart = resolveChartScene({ scene: input.scene, aspect: input.aspect });
  return chartElements(chart).filter((e) => e.preset === "bar-groups").flatMap((e) =>
    barGroupLayout(e.parameters.lineWidthsPerPictureHeight as number[], e.parameters.numerals as boolean, e.aspect, e.pictureHeight).map((g) => ({
      elementIndex: e.index, lineWidthsPerPictureHeight: g.lineWidthsPerPictureHeight, cyclesPerPictureHeight: g.lineWidthsPerPictureHeight / 2,
      lineWidth: g.lineWidth * e.scale, verticalBars: mapRectangle(g.verticalBars, e.toFrame), horizontalBars: mapRectangle(g.horizontalBars, e.toFrame) })));
}

/** One square of a `slanted-squares` chart and its four edges, in the chart's frame units. */
export interface ChartSlantedSquare {
  elementIndex: number | null;
  center: { u: number; v: number };
  /** Side length, frame units. */
  side: number;
  /** Clockwise rotation, degrees. */
  angleDegrees: number;
  darkReflectance: number;
  lightReflectance: number;
  /** `left`/`right` edges are near-vertical (horizontal MTF), `top`/`bottom` near-horizontal (vertical MTF). */
  edges: { side: "left" | "right" | "top" | "bottom"; midpoint: { u: number; v: number }; direction: { u: number; v: number }; length: number }[];
}
/**
 * Squares and edges of a `slanted-squares` chart, or of every `slanted-squares` element of a composite, in
 * the chart's frame units (2.3), for slanted-edge regions of interest (Burns, PICS 2000). Directions are unit
 * vectors along each edge (u right, v up).
 */
export function calculateSlantedSquareEdges(input: { scene: ChartScene; aspect: number }): ChartSlantedSquare[] {
  requireInputKeys(input, "calculateSlantedSquareEdges", ["scene", "aspect"]);
  const chart = resolveChartScene({ scene: input.scene, aspect: input.aspect });
  return chartElements(chart).filter((e) => e.preset === "slanted-squares").flatMap((e) => {
    const p = e.parameters as { columns: number; rows: number; sizeFraction: number; angleDegrees: number; darkReflectance: number; lightReflectance: number };
    const t = p.angleDegrees * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), cellW = 2 / p.columns, cellH = 2 * e.aspect / p.rows;
    const half = p.sizeFraction * Math.min(cellW, cellH) / 2, out: ChartSlantedSquare[] = [];
    // Local square axes rotated clockwise by t: x̂ = (cos t, −sin t), ŷ = (sin t, cos t) in (u, v).
    const xAxis = { u: c, v: -s }, yAxis = { u: s, v: c };
    for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.columns; i++) {
      const cu = -1 + (i + 0.5) * cellW, cv = e.aspect - (j + 0.5) * cellH, at = (x: number, y: number): { u: number; v: number } => e.toFrame(cu + x * xAxis.u + y * yAxis.u, cv + x * xAxis.v + y * yAxis.v);
      const length = 2 * half * e.scale;
      out.push({ elementIndex: e.index, center: e.toFrame(cu, cv), side: length, angleDegrees: p.angleDegrees, darkReflectance: p.darkReflectance, lightReflectance: p.lightReflectance,
        edges: [{ side: "left", midpoint: at(-half, 0), direction: yAxis, length }, { side: "right", midpoint: at(half, 0), direction: yAxis, length },
          { side: "top", midpoint: at(0, half), direction: xAxis, length }, { side: "bottom", midpoint: at(0, -half), direction: xAxis, length }] });
    }
    return out;
  });
}

/**
 * Step reflectances of a step wedge. `equal-density` spaces optical density D = -log10(R) evenly, which
 * gives geometric reflectance steps, as on a photographic step tablet. `linear` spaces reflectance evenly.
 */
export function calculateStepWedgeReflectances(input: { steps: number; minimumReflectance: number; maximumReflectance: number;
  spacing: "equal-density" | "linear" }): number[] {
  requireInputKeys(input, "calculateStepWedgeReflectances", ["steps", "minimumReflectance", "maximumReflectance", "spacing"]);
  const steps = integerIn(input.steps, "steps", 2, 64), lo = reflectance(input.minimumReflectance, "minimumReflectance"), hi = reflectance(input.maximumReflectance, "maximumReflectance");
  if (input.spacing !== "equal-density" && input.spacing !== "linear") throw new InvalidConfigurationError("spacing must be equal-density or linear.");
  if (!(hi > lo) || (input.spacing === "equal-density" && lo <= 0)) throw new InvalidConfigurationError("Step wedge needs 0 < minimum < maximum reflectance.");
  return stepWedgeReflectances(steps, lo, hi, input.spacing, undefined);
}
function stepWedgeReflectances(steps: number, lo: number, hi: number, spacing: "equal-density" | "linear", pow: ((x: number, y: number) => number) | undefined): number[] {
  return Array.from({ length: steps }, (_, k) => {
    if (k === steps - 1) return hi;
    const t = k / (steps - 1);
    return spacing === "linear" ? lo + (hi - lo) * t : lo * (pow ? pow(hi / lo, t) : (hi / lo) ** t);
  });
}

/** Centres (frame units) of a point grid: one disk centred in each of columns × rows equal cells, row-major from the top-left. */
export function calculatePointGridCenters(input: { columns: number; rows: number; aspect: number }): { u: number; v: number }[] {
  requireInputKeys(input, "calculatePointGridCenters", ["columns", "rows", "aspect"]);
  const columns = integerIn(input.columns, "columns", 1, 256), rows = integerIn(input.rows, "rows", 1, 256);
  if (typeof input.aspect !== "number" || !Number.isFinite(input.aspect) || input.aspect <= 0) throw new InvalidConfigurationError("aspect must be positive.");
  const out: { u: number; v: number }[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) out.push({ u: -1 + (i + 0.5) * 2 / columns, v: input.aspect - (j + 0.5) * 2 * input.aspect / rows });
  return out;
}
