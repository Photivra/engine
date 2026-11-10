// SPDX-License-Identifier: Apache-2.0

/**
 * Batched radiance queries for the engine's procedural chart scenes (#277): many frame points in one
 * call, each answered with spectral radiance at a declared wavelength, or with the spectral integral of
 * that radiance against declared channel weights. This is the float64 CPU reference for the
 * `webgpu-f32` chart-radiance stage (`ImageKernelAccelerator.evaluateChartRadiance`).
 *
 * Every value comes from the chart provider's own `radianceAt` (createPlanarSceneRadianceProvider): a
 * Lambertian reflectance ρ(λ) under the scaled illuminant, L = ρ·k·S(λ)/π. The spectral integral of a
 * query is Σ_j w_cj·L(u, v, λ_j), summed in wavelength order. Charts are uniform-illuminant Lambertian
 * patterns, so a query's integral depends only on its material: the GPU stage classifies the material and (2.21.0) the host
 * integrates that material's spectrum against the weights per query.
 *
 * The query shape mirrors a batched provider (one call, queries in, results in the same order). Points
 * are frame units (u right, v up; see chart-scenes.ts); `mapEnvironmentDirectionsToChartPoints` converts
 * environment-direction queries exactly as `evaluateRadiance` does.
 * @see docs/WEBGPU.md, "Scene radiance on the GPU".
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { FULL_RESOLUTION_CEILING_PIXELS, resolveRaisedLimit } from "../core/pixel-limits.js";
import { resolveChartScene, type ChartScene, type ResolvedChartScene } from "./chart-scenes.js";
import { resolveChartMaterialLayers, type ChartMaterialLayerScene, type ResolvedChartMaterialLayers } from "./chart-material-layers.js";
import { buildPlanarSceneRadianceProvider, calculateIlluminantIrradianceScale, resolveCaptureIlluminant, tabulatedSpectrum, type CaptureIlluminant,
  type ResolvedCaptureIlluminant } from "./scene-radiance.js";

export const CHART_RADIANCE_BATCH_SCHEMA_VERSION = "0.1.0" as const;
/** `maximumQueries` is the default batch limit; a request may raise it with its own `maximumQueries`, up to `ceilingQueries`. */
export const CHART_RADIANCE_BATCH_LIMITS = /* @__PURE__ */ Object.freeze({ maximumQueries: 24_000_000, ceilingQueries: FULL_RESOLUTION_CEILING_PIXELS, maximumWavelengths: 256,
  maximumChannels: 4 });

export interface ChartRadianceBatchInput {
  schemaVersion: typeof CHART_RADIANCE_BATCH_SCHEMA_VERSION;
  /** An engine chart preset, or (#477) a declared `material-layers` scene: a chart under shape-mask layers. Caller scene functions are not supported here. */
  scene: ChartScene | ChartMaterialLayerScene;
  illuminant: CaptureIlluminant;
  illuminanceLux: number;
  /** Frame height / width. */
  aspect: number;
  /** Frame points, interleaved [u0, v0, u1, v1, …]. Finite. */
  points: Float32Array | Float64Array;
  /** The wavelengths the queries use, in nanometres (1–256). */
  wavelengthsNanometers: readonly number[];
  /** Radiance queries: one wavelength index per point. Exactly one of this and `channelWeights`. */
  wavelengthIndices?: Uint8Array | Uint16Array;
  /** Spectral integration: per channel (1–4), one finite weight per wavelength. */
  channelWeights?: readonly (readonly number[])[];
  /**
   * Optional opt-in batch limit: an integer from 1 to `CHART_RADIANCE_BATCH_LIMITS.ceilingQueries`. Default
   * `CHART_RADIANCE_BATCH_LIMITS.maximumQueries` (24 000 000). It does not change the values.
   */
  maximumQueries?: number;
}

/** Validated plan with the resolved chart, illuminant and irradiance scale. Arrays are borrowed. */
export interface ChartRadianceBatchPlan {
  /** The resolved chart; with a `material-layers` scene, the chart under the layers. */
  chart: ResolvedChartScene;
  /** The resolved layers of a `material-layers` scene, or null for a chart preset. */
  layers: ResolvedChartMaterialLayers | null;
  /** Every material a query can resolve to: the chart's, then each layer's background and ink. */
  materials: ResolvedChartScene["materials"];
  illuminant: ResolvedCaptureIlluminant;
  irradianceScale: number;
  queryCount: number;
  /** Output values per query: 1 for radiance queries, the channel count for spectral integration. */
  columns: number;
  mode: "radiance" | "spectral-integral";
  wavelengthsNanometers: readonly number[];
  channelWeights: readonly (readonly number[])[] | null;
  /** Spectral radiance of one material at a wavelength: the provider's own radianceAt for that material. */
  materialRadiance(material: number, wavelengthNanometers: number): number;
  /** The reference value of one query and output column (radianceAt, and its wavelength-ordered sum). */
  queryValue(points: Float32Array | Float64Array, wavelengthIndices: Uint8Array | Uint16Array | undefined, query: number, column: number): number;
}

export function calculateChartRadianceBatchPlan(input: ChartRadianceBatchInput): ChartRadianceBatchPlan {
  const r = requireAllowlistedRecord(input, ["schemaVersion", "scene", "illuminant", "illuminanceLux", "aspect", "points", "wavelengthsNanometers",
    "wavelengthIndices", "channelWeights", "maximumQueries"], "Invalid chart radiance batch input.");
  if (r.schemaVersion !== CHART_RADIANCE_BATCH_SCHEMA_VERSION) throw new InvalidConfigurationError("Unsupported chart radiance batch schema.");
  if (typeof r.aspect !== "number" || !(r.aspect > 0 && r.aspect <= Number.MAX_VALUE)) throw new InvalidConfigurationError("aspect must be positive.");
  const sceneRecord = r.scene as Record<string, unknown> | null;
  const layers = sceneRecord !== null && typeof sceneRecord === "object" && sceneRecord.kind === "material-layers"
    ? resolveChartMaterialLayers({ scene: r.scene as ChartMaterialLayerScene, aspect: r.aspect }) : null;
  const chart = layers ? layers.chart : resolveChartScene({ scene: r.scene as ChartScene, aspect: r.aspect });
  const materials = layers ? layers.materials : chart.materials;
  const illuminant = resolveCaptureIlluminant(r.illuminant as CaptureIlluminant);
  const irradianceScale = calculateIlluminantIrradianceScale(illuminant.shape, r.illuminanceLux as number);
  const L = CHART_RADIANCE_BATCH_LIMITS, points = r.points;
  const maximumQueries = resolveRaisedLimit(r.maximumQueries, L.maximumQueries, L.ceilingQueries,
    "Chart radiance batch maximumQueries must be an integer from 1 to " + L.ceilingQueries + ".");
  if (!(points instanceof Float32Array || points instanceof Float64Array) || points.length % 2 !== 0 || points.length / 2 > maximumQueries) {
    throw new InvalidConfigurationError("points must be an interleaved Float32Array or Float64Array of (u, v) pairs.");
  }
  for (let i = 0; i < points.length; i++) if (!Number.isFinite(points[i]!)) throw new InvalidConfigurationError("Chart points must be finite.");
  const queryCount = points.length / 2, wavelengths = r.wavelengthsNanometers;
  if (!Array.isArray(wavelengths) || wavelengths.length < 1 || wavelengths.length > L.maximumWavelengths ||
      wavelengths.some(nm => typeof nm !== "number" || !Number.isFinite(nm) || nm <= 0)) {
    throw new InvalidConfigurationError("wavelengthsNanometers must list 1 to 256 positive wavelengths.");
  }
  const indices = r.wavelengthIndices, weights = r.channelWeights;
  if ((indices === undefined) === (weights === undefined)) throw new InvalidConfigurationError("Give exactly one of wavelengthIndices and channelWeights.");
  if (indices !== undefined) {
    if (!(indices instanceof Uint8Array || indices instanceof Uint16Array) || indices.length !== queryCount) {
      throw new InvalidConfigurationError("wavelengthIndices must hold one index per point.");
    }
    for (let i = 0; i < queryCount; i++) if (indices[i]! >= wavelengths.length) throw new InvalidConfigurationError("A wavelength index is out of range.");
  } else if (!Array.isArray(weights) || weights.length < 1 || weights.length > L.maximumChannels ||
      weights.some(row => !Array.isArray(row) || row.length !== wavelengths.length || row.some(w => typeof w !== "number" || !Number.isFinite(w)))) {
    throw new InvalidConfigurationError("channelWeights must hold 1 to 4 rows of one finite weight per wavelength.");
  }
  // The provider's own radiance function: chart reflectance × scaled illuminant / π, in its float64 order.
  const providerScene = layers ? { kind: "material-function" as const, sceneId: layers.sceneId, materials: layers.materials, materialInputs: layers.materialInputs,
    materialAt: (point: { u: number; v: number }): number => layers.materialAt(point.u, point.v) } : chart;
  const provider = buildPlanarSceneRadianceProvider({ scene: providerScene, sceneId: "chart-radiance-batch", providerProfileId: "chart-radiance-batch", illuminant,
    irradianceScale, geometry: { distanceM: 1, metresPerFrameUnit: 1 }, evidence: [], limitations: [] });
  const channelWeights = weights === undefined ? null : (weights as number[][]).map(row => Object.freeze([...row]));
  const nm = Object.freeze([...(wavelengths as number[])]);
  const shapeAt = tabulatedSpectrum(illuminant.shape);
  const materialRadiance = (material: number, wavelength: number): number => {
    const m = materials[material]!;
    const reflectance = m.kind === "neutral" ? m.reflectance : m.spectrum.evaluate(wavelength);
    if (m.kind === "spectrum" && !(reflectance >= 0 && reflectance <= 1)) throw new InvalidConfigurationError("Chart reflectance spectrum left [0, 1].");
    return reflectance * irradianceScale * shapeAt(wavelength) / Math.PI;
  };
  return Object.freeze({ chart, layers, materials, illuminant, irradianceScale, queryCount, columns: channelWeights === null ? 1 : channelWeights.length,
    mode: channelWeights === null ? "radiance" as const : "spectral-integral" as const, wavelengthsNanometers: nm, channelWeights, materialRadiance,
    queryValue(p: Float32Array | Float64Array, w: Uint8Array | Uint16Array | undefined, query: number, column: number): number {
      const u = p[2 * query]!, v = p[2 * query + 1]!;
      if (channelWeights === null) return provider.radianceAt(u, v, nm[w![query]!]!);
      let sum = 0;
      const row = channelWeights[column]!;
      for (let j = 0; j < nm.length; j++) sum += row[j]! * provider.radianceAt(u, v, nm[j]!);
      return sum;
    } });
}

/** Float64 CPU reference: every query's value(s), row-major (query, column). */
export function calculateChartRadianceBatch(input: ChartRadianceBatchInput): { plan: ChartRadianceBatchPlan; values: Float64Array } {
  const plan = calculateChartRadianceBatchPlan(input), values = new Float64Array(plan.queryCount * plan.columns);
  for (let q = 0; q < plan.queryCount; q++) for (let c = 0; c < plan.columns; c++) values[q * plan.columns + c] = plan.queryValue(input.points, input.wavelengthIndices, q, c);
  return { plan, values };
}

/**
 * Frame points of environment-direction queries on the chart plane, exactly as the planar provider's
 * `evaluateRadiance` computes them: look direction l = −o, plane point l·distance/l.z, in frame units.
 * @param directions - Outgoing unit vectors (scene toward camera), interleaved [x, y, z, …].
 */
export function mapEnvironmentDirectionsToChartPoints(input: { directions: Float32Array | Float64Array; distanceM: number; metresPerFrameUnit: number }): Float64Array {
  const r = requireAllowlistedRecord(input, ["directions", "distanceM", "metresPerFrameUnit"], "Invalid planar direction input.");
  const d = r.directions, distance = r.distanceM, scale = r.metresPerFrameUnit;
  if (!(d instanceof Float32Array || d instanceof Float64Array) || d.length % 3 !== 0 || typeof distance !== "number" || !(distance > 0 && distance <= Number.MAX_VALUE) ||
      typeof scale !== "number" || !(scale > 0 && scale <= Number.MAX_VALUE)) {
    throw new InvalidConfigurationError("Planar directions need interleaved unit vectors, a positive distance and a positive frame scale.");
  }
  const points = new Float64Array(d.length / 3 * 2);
  for (let i = 0; i < d.length / 3; i++) {
    const lz = -d[3 * i + 2]!;
    if (!(lz > 0)) throw new InvalidConfigurationError("Planar scene query does not point toward the scene plane.");
    const t = distance / lz;
    const x = -d[3 * i]! * t / scale, y = -d[3 * i + 1]! * t / scale;
    // A grazing direction (lz near 0, e.g. 1e-320) or a non-finite component would give ±Infinity or NaN.
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new InvalidConfigurationError("Planar scene query maps to a non-finite chart point (grazing or non-finite direction).");
    points[2 * i] = x;
    points[2 * i + 1] = y;
  }
  return points;
}
