// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22 (#550): spatially varying illumination of the scene plane (mixed lighting), loaded on demand by `simulateCapture` and the
 * display view only when a request has `illumination`, so requests without it neither load nor run it.
 *
 * Model: N sources (2 to {@link MIXED_ILLUMINATION_MAX_SOURCES}), source i an illuminant spectral shape S_i(λ) scaled to
 * `illuminanceLux` E_i exactly as the single illuminant is (`calculateIlluminantIrradianceScale`: k_i with 683 ∫ k_i S_i ȳ dλ = E_i).
 * The plane's spectral irradiance at a point p is the declared blend E(p, λ) = Σ_i w_i(p)·k_i·S_i(λ) with weights w_i(p) ≥ 0 that
 * sum to 1, so the illuminance at p is Σ_i w_i(p)·E_i and, where one weight is 1, the light is exactly that source's. A Lambertian
 * reflector then has radiance ρ(λ)·E(p, λ)/π, as under one illuminant. The blend is a declared crossfade of irradiance, not a
 * model of how light falls off from a lamp or a window (no inverse-square law, no cosine falloff, no shadows); it is exact for
 * what it declares.
 *
 * Coordinates are the chart's: a fixed-size chart's chart-local units (±1 at its left and right edges, v up on the same scale,
 * extended linearly over the surround), or, without `chartSize`, frame units (±1 at the frame's left and right edges), which are
 * the chart-local units of a chart that fills the frame. Both put (0, 0) at the frame center.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputObject } from "../core/record-validation.js";
import { calculateIlluminantIrradianceScale, tabulatedSpectrum, type CaptureIlluminant, type ResolvedCaptureIlluminant } from "./scene-radiance.js";

/** Most sources an `illumination` may list. */
export const MIXED_ILLUMINATION_MAX_SOURCES = 8;
/** Most regions a `regions` blend may list. */
export const MIXED_ILLUMINATION_MAX_REGIONS = 64;

/** One light source of a mixed illumination: an illuminant (as `simulateCapture` `illuminant` takes it) at an illuminance. */
export interface MixedIlluminationSource {
  illuminant: CaptureIlluminant;
  /** Illuminance this source alone gives where its weight is 1, lux, (0, 1e7]. */
  illuminanceLux: number;
}
/** A point in chart coordinates (see {@link MixedIllumination}). */
export interface MixedIlluminationPoint { u: number; v: number }
/**
 * How the sources blend across the chart. `linear-gradient` and `radial` map a point to a position t in [0, 1] (its projection
 * onto `from` → `to`, clamped; or its distance from `center` over `radius`, clamped) and crossfade linearly between consecutive
 * sources at their `stops` (one per source, non-decreasing in [0, 1]; default evenly spaced from 0 to 1): source 0 alone up to
 * stops[0], the last source alone from its stop on, and two equal stops a hard edge (the later source from the stop on).
 * `regions` gives each point the source of the first rectangle that contains it (bounds inclusive) and `outsideSource` elsewhere.
 */
export type MixedIlluminationBlend =
  | { kind: "linear-gradient"; from: MixedIlluminationPoint; to: MixedIlluminationPoint; stops?: readonly number[] }
  | { kind: "radial"; center?: MixedIlluminationPoint; radius: number; stops?: readonly number[] }
  | { kind: "regions"; regions: readonly { source: number; uMin: number; uMax: number; vMin: number; vMax: number }[]; outsideSource: number };
/**
 * 2.22 (#550), `simulateCapture` `illumination`: two or more sources blended across the chart (docs/MIXED_ILLUMINATION.md). It
 * replaces `illuminant` and `illuminanceLux`. Coordinates are chart-local with `chartSize` and frame units without it; (0, 0) is
 * the frame center.
 */
export interface MixedIllumination {
  sources: readonly MixedIlluminationSource[];
  blend: MixedIlluminationBlend;
}

/** Internal: a validated mixed illumination with its sources resolved and scaled. */
export interface ResolvedMixedIllumination {
  sources: readonly { illuminant: ResolvedCaptureIlluminant; option: CaptureIlluminant; illuminanceLux: number; irradianceScale: number }[];
  /** The blend with its defaults filled (the report's and the digest's form). */
  blend: Readonly<Record<string, unknown>>;
  /** Spectral irradiance at a chart point, W·m⁻²·nm⁻¹ (k_i·S_i(λ) itself where one source has weight 1). */
  irradianceAt(u: number, v: number, wavelengthNanometers: number): number;
  /** At the frame center (0, 0): the illuminance, the source weights and the strongest source (largest w_i·E_i, the first on a tie). */
  center: { illuminanceLux: number; weights: number[]; strongestSource: number };
}

type Fields = Record<string, unknown>;
const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
/** A record with no other fields than these (`name` relative to `illumination`). */
const fields = (value: unknown, name: string, keys: string[]): Fields => {
  requireInputObject(value, "illumination" + name);
  for (const key of Object.keys(value as object)) if (!keys.includes(key)) fail("Unknown illumination" + name + " field: " + key + ".");
  return value as Fields;
};
const finite = (x: unknown, name: string): number => (typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e6 ? x : fail("illumination" + name + " must be a finite number."));
const point = (value: unknown, name: string): MixedIlluminationPoint => {
  const r = fields(value, ".blend." + name, ["u", "v"]);
  return { u: finite(r.u, ".blend." + name + ".u"), v: finite(r.v, ".blend." + name + ".v") };
};

/**
 * Internal: validates `illumination` and resolves its sources with `resolveIlluminant` (the capture's `resolveCaptureIlluminant`, or
 * the display view's portable one).
 */
export function resolveMixedIllumination(value: unknown, resolveIlluminant: (value: CaptureIlluminant) => ResolvedCaptureIlluminant): ResolvedMixedIllumination {
  const record = fields(value, "", ["sources", "blend"]), list = record.sources as unknown[];
  if (!Array.isArray(list) || list.length < 2 || list.length > MIXED_ILLUMINATION_MAX_SOURCES) fail("illumination.sources must list 2 to " + MIXED_ILLUMINATION_MAX_SOURCES + " sources.");
  const sources = list.map((entry, i) => {
    const s = fields(entry, ".sources[" + i + "]", ["illuminant", "illuminanceLux"]), option = s.illuminant as CaptureIlluminant, illuminant = resolveIlluminant(option);
    return Object.freeze({ illuminant, option, illuminanceLux: s.illuminanceLux as number, irradianceScale: calculateIlluminantIrradianceScale(illuminant.shape, s.illuminanceLux as number) });
  });
  const n = sources.length, shapes = sources.map((s) => tabulatedSpectrum(s.illuminant.shape)), b = fields(record.blend, ".blend", ["kind", "from", "to", "center", "radius", "stops", "regions", "outsideSource"]);
  const index = (x: unknown, name: string): number => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < n ? x as number : fail("illumination.blend." + name + " must be a source index from 0 to " + (n - 1) + "."));
  const unused = (keys: string[]): void => { for (const key of keys) if (b[key] !== undefined) fail("illumination.blend." + key + " does not apply to a " + String(b.kind) + " blend."); };
  // A point's position t on a gradient or radial blend, or its source on a regions blend.
  let position: (u: number, v: number) => number, blend: Fields, stops: number[] | undefined;
  if (b.kind === "regions") {
    unused(["from", "to", "center", "radius", "stops"]);
    const list = b.regions as unknown[];
    if (!Array.isArray(list) || list.length < 1 || list.length > MIXED_ILLUMINATION_MAX_REGIONS) fail("illumination.blend.regions must list 1 to " + MIXED_ILLUMINATION_MAX_REGIONS + " rectangles.");
    const regions = list.map((entry, i) => {
      const at = ".blend.regions[" + i + "]", r = fields(entry, at, ["source", "uMin", "uMax", "vMin", "vMax"]);
      const region = { source: index(r.source, "regions[" + i + "].source"), uMin: finite(r.uMin, at + ".uMin"), uMax: finite(r.uMax, at + ".uMax"), vMin: finite(r.vMin, at + ".vMin"), vMax: finite(r.vMax, at + ".vMax") };
      if (!(region.uMin <= region.uMax && region.vMin <= region.vMax)) fail("illumination" + at + " uMin and vMin must not exceed uMax and vMax.");
      return region;
    });
    const outside = index(b.outsideSource, "outsideSource");
    position = (u: number, v: number): number => regions.find((r) => u >= r.uMin && u <= r.uMax && v >= r.vMin && v <= r.vMax)?.source ?? outside;
    blend = { kind: "regions", regions, outsideSource: outside };
  } else {
    if (b.kind === "linear-gradient") {
      unused(["center", "radius", "regions", "outsideSource"]);
      const from = point(b.from, "from"), to = point(b.to, "to"), du = to.u - from.u, dv = to.v - from.v, length2 = du * du + dv * dv;
      if (!(length2 > 0)) fail("illumination.blend from and to must differ.");
      position = (u: number, v: number): number => Math.min(1, Math.max(0, ((u - from.u) * du + (v - from.v) * dv) / length2));
      blend = { kind: b.kind, from, to };
    } else if (b.kind === "radial") {
      unused(["from", "to", "regions", "outsideSource"]);
      const center = b.center === undefined ? { u: 0, v: 0 } : point(b.center, "center"), radius = finite(b.radius, ".blend.radius");
      if (!(radius > 0)) fail("illumination.blend.radius must be positive.");
      position = (u: number, v: number): number => Math.min(1, Math.hypot(u - center.u, v - center.v) / radius);
      blend = { kind: b.kind, center, radius };
    } else return fail('illumination.blend.kind must be "linear-gradient", "radial" or "regions".');
    const given = b.stops as unknown[] | undefined;
    if (given !== undefined && (!Array.isArray(given) || given.length !== n)) fail("illumination.blend.stops must list one stop per source.");
    blend.stops = stops = given ? given.map((x, i) => {
      const stop = finite(x, ".blend.stops[" + i + "]");
      return stop >= 0 && stop <= 1 && (i === 0 || stop >= (given[i - 1] as number)) ? stop : fail("illumination.blend.stops must be non-decreasing in [0, 1].");
    }) : sources.map((_, i) => i / (n - 1));
  }
  /**
   * The blend at a point: the lower source i and the fraction f of source i + 1 (f = 0: source i alone). On a gradient, the segment
   * [stops[i], stops[i + 1]) that holds t; equal stops are passed over, so the later source takes the stop.
   */
  const at = (u: number, v: number): [number, number] => {
    const t = position(u, v);
    if (!stops) return [t, 0];
    let i = 0;
    while (i < n - 1 && t >= stops[i + 1]!) i++;
    return i === n - 1 || t <= stops[i]! ? [i, 0] : [i, (t - stops[i]!) / (stops[i + 1]! - stops[i]!)];
  };
  const [i0, f0] = at(0, 0), weights = sources.map((_, i) => (i === i0 ? 1 - f0 : i === i0 + 1 ? f0 : 0));
  let strongest = 0, illuminanceLux = 0;
  weights.forEach((w, i) => {
    illuminanceLux += w * sources[i]!.illuminanceLux;
    if (w * sources[i]!.illuminanceLux > weights[strongest]! * sources[strongest]!.illuminanceLux) strongest = i;
  });
  return Object.freeze({ sources: Object.freeze(sources), blend: Object.freeze(blend),
    irradianceAt(u: number, v: number, nm: number): number {
      const [i, f] = at(u, v), a = sources[i]!.irradianceScale * shapes[i]!(nm);
      return f === 0 ? a : (1 - f) * a + f * (sources[i + 1]!.irradianceScale * shapes[i + 1]!(nm));
    },
    center: Object.freeze({ illuminanceLux, weights, strongestSource: strongest }) });
}
