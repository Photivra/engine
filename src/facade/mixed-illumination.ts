// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22 (#550): spatially varying illumination of the scene plane (mixed lighting), loaded on demand by `simulateCapture` and the
 * display view only when a request has `illumination`, so requests without it neither load nor run it.
 *
 * Model: N sources (1 to {@link MIXED_ILLUMINATION_MAX_SOURCES}; one lights the whole plane), source i an illuminant spectral shape S_i(λ) scaled to
 * `illuminanceLux` E_i exactly as the single illuminant is (`calculateIlluminantIrradianceScale`: k_i with 683 ∫ k_i S_i ȳ dλ = E_i).
 * The plane's spectral irradiance at a point p is the declared blend E(p, λ) = Σ_i w_i(p)·k_i·S_i(λ) with weights w_i(p) ≥ 0 that
 * sum to 1, so the illuminance at p is Σ_i w_i(p)·E_i and, where one weight is 1, the light is exactly that source's. A Lambertian
 * reflector then has radiance ρ(λ)·E(p, λ)/π, as under one illuminant. The blend is a declared crossfade of irradiance, not a
 * model of how light falls off from a lamp or a window (no inverse-square law, no cosine falloff, no shadows); it is exact for
 * what it declares.
 *
 * Point sources (owner decision 2026-11-10, a step toward flash): source j is a point at height h_j in front of the plane above
 * plane point (x_j, y_j) m, with luminous intensity I_j cd (the same in every direction toward the plane) and spectral shape S_j(λ),
 * scaled so that 683 ∫ c_j S_j ȳ dλ = I_j. A point p of the plane at distance d from it receives E_j(p, λ) = c_j·S_j(λ)·cos θ/d²,
 * with cos θ = h_j/d: the inverse-square law with Lambert's cosine law, which follows from the definitions of luminous intensity
 * (flux per solid angle) and illuminance (flux per area) with the solid angle dΩ = dA·cos θ/d² that a plane element subtends (CIE S
 * 017:2020 ILV, International Lighting Vocabulary, entries "luminous intensity" and "illuminance", free at e-ilv.cie.co.at; BIPM SI
 * Brochure, 9th edition 2019, Table 4, the steradian). Exact for an ideal isotropic point; no occlusion (the camera casts no shadow),
 * no source size and no inter-reflection. The point sources add to the blend: E(p, λ) = Σ_i w_i(p)·k_i·S_i(λ) + Σ_j E_j(p, λ).
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
/**
 * 2.22 (#550): a point light on the scene plane's front side: an illuminant spectrum, a position in metres (`xM`, `yM` on the plane
 * from the optical axis, +x right and +y up as seen from the camera; `heightM` > 0 in front of the plane, toward the camera) and an
 * intensity, either in candela or as the illuminance it gives at normal incidence at a reference distance (I = E·r²).
 */
export interface MixedIlluminationPointSource {
  illuminant: CaptureIlluminant;
  position: { xM: number; yM: number; heightM: number };
  intensity: { candela: number } | { illuminanceLux: number; distanceM: number };
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
 * 2.22 (#550), `simulateCapture` `illumination`: sources blended across the chart and point sources with inverse-square falloff
 * (docs/MIXED_ILLUMINATION.md). It replaces `illuminant` and `illuminanceLux`. `sources` lists 1 to 8 sources (with two or more, a
 * `blend` is required; one lights the whole plane); `points` lists 1 to 8 point sources; a request needs two or more sources or at least one point. Blend
 * coordinates are chart-local with `chartSize` and frame units without it; (0, 0) is the frame center.
 */
export interface MixedIllumination {
  sources?: readonly MixedIlluminationSource[];
  blend?: MixedIlluminationBlend;
  points?: readonly MixedIlluminationPointSource[];
}

/** Internal: a validated mixed illumination with its lights resolved and scaled. */
export interface ResolvedMixedIllumination {
  /**
   * The lights, the blend's sources first and then the point sources: each with the illuminance it gives at the frame center when
   * it lights it alone (a point source's I·cos θ/d²) and the scale k with k·S(λ) that light's irradiance there; `report` is its
   * public form (the assumption's and the digest's).
   */
  sources: readonly { illuminant: ResolvedCaptureIlluminant; option: CaptureIlluminant; illuminanceLux: number; irradianceScale: number; report: Readonly<Record<string, unknown>> }[];
  /** The blend with its defaults filled, or null (one source or none). */
  blend: Readonly<Record<string, unknown>> | null;
  /** Spectral irradiance at a plane point, W·m⁻²·nm⁻¹: (u, v) chart coordinates for the blend, (xM, yM) metres for the point sources. */
  irradianceAt(u: number, v: number, xM: number, yM: number, wavelengthNanometers: number): number;
  /**
   * At the frame center: the illuminance, the blend's source weights, each light's illuminance there (w_i·E_i; a point's
   * I·cos θ/d²) and the strongest light (the largest, the first on a tie; an index into `sources`).
   */
  center: { illuminanceLux: number; weights: number[]; illuminancesLux: number[]; strongestSource: number };
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
const positive = (x: unknown, name: string, maximum: number): number => (typeof x === "number" && x > 0 && x <= maximum ? x : fail("illumination" + name + " must be positive, up to " + maximum + "."));
const list = (value: unknown, name: string, what: string): unknown[] => (value === undefined ? [] : Array.isArray(value) && value.length >= 1 && value.length <= MIXED_ILLUMINATION_MAX_SOURCES ? value :
  fail("illumination." + name + " must list 1 to " + MIXED_ILLUMINATION_MAX_SOURCES + " " + what + "."));
const point = (value: unknown, name: string): MixedIlluminationPoint => {
  const r = fields(value, ".blend." + name, ["u", "v"]);
  return { u: finite(r.u, ".blend." + name + ".u"), v: finite(r.v, ".blend." + name + ".v") };
};

/**
 * Internal: validates `illumination` and resolves its sources with `resolveIlluminant` (the capture's `resolveCaptureIlluminant`, or
 * the display view's portable one).
 */
export function resolveMixedIllumination(value: unknown, resolveIlluminant: (value: CaptureIlluminant) => ResolvedCaptureIlluminant): ResolvedMixedIllumination {
  const record = fields(value, "", ["sources", "blend", "points"]), given = list(record.sources, "sources", "sources"), pointList = list(record.points, "points", "point sources");
  if (pointList.length === 0 && given.length < 2) fail("illumination needs two or more sources, or a point source; one source alone is illuminant and illuminanceLux.");
  const sources = given.map((entry, i) => {
    const s = fields(entry, ".sources[" + i + "]", ["illuminant", "illuminanceLux"]), option = s.illuminant as CaptureIlluminant, illuminant = resolveIlluminant(option);
    return Object.freeze({ illuminant, option, illuminanceLux: s.illuminanceLux as number, irradianceScale: calculateIlluminantIrradianceScale(illuminant.shape, s.illuminanceLux as number),
      report: Object.freeze({ illuminant: illuminant.id, illuminanceLux: s.illuminanceLux }) });
  });
  // Point sources: c_j with 683 ∫ c_j S_j ȳ dλ = I_j (the irradiance scale of 1 lux, times I_j), and E_j = c_j S_j(λ)·h/d³.
  const points = pointList.map((entry, j) => {
    const at = ".points[" + j + "]", p = fields(entry, at, ["illuminant", "position", "intensity"]), option = p.illuminant as CaptureIlluminant, illuminant = resolveIlluminant(option);
    const q = fields(p.position, at + ".position", ["xM", "yM", "heightM"]), i = fields(p.intensity, at + ".intensity", ["candela", "illuminanceLux", "distanceM"]);
    const position = { xM: finite(q.xM, at + ".position.xM"), yM: finite(q.yM, at + ".position.yM"), heightM: positive(q.heightM, at + ".position.heightM", 1e4) };
    const candela = i.candela !== undefined ? (i.illuminanceLux === undefined && i.distanceM === undefined ? positive(i.candela, at + ".intensity.candela", 1e9) :
      fail("illumination" + at + ".intensity takes candela or illuminanceLux and distanceM, not both.")) :
      positive(i.illuminanceLux, at + ".intensity.illuminanceLux", 1e7) * positive(i.distanceM, at + ".intensity.distanceM", 1e4) ** 2;
    return { illuminant, option, position, candela, scale: calculateIlluminantIrradianceScale(illuminant.shape, 1) * candela, shape: tabulatedSpectrum(illuminant.shape) };
  });
  /** cos θ/d² of point source j at plane point (x, y) m. */
  const falloff = (p: typeof points[number], x: number, y: number): number => {
    const dx = x - p.position.xM, dy = y - p.position.yM, h = p.position.heightM, d2 = dx * dx + dy * dy + h * h;
    return h / (d2 * Math.sqrt(d2));
  };
  const n = sources.length, shapes = sources.map((s) => tabulatedSpectrum(s.illuminant.shape));
  if (n < 2 && record.blend !== undefined) fail("illumination.blend needs two or more sources.");
  const b = n < 2 ? { kind: "none" } : fields(record.blend, ".blend", ["kind", "from", "to", "center", "radius", "stops", "regions", "outsideSource"]);
  const index = (x: unknown, name: string): number => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < n ? x as number : fail("illumination.blend." + name + " must be a source index from 0 to " + (n - 1) + "."));
  const unused = (keys: string[]): void => { for (const key of keys) if (b[key] !== undefined) fail("illumination.blend." + key + " does not apply to a " + String(b.kind) + " blend."); };
  // A point's position t on a gradient or radial blend, or its source on a regions blend.
  let position: (u: number, v: number) => number, blend: Fields | null = null, stops: number[] | undefined;
  if (b.kind === "none") position = (): number => 0;
  else if (b.kind === "regions") {
    unused(["from", "to", "center", "radius", "stops"]);
    const rects = b.regions as unknown[];
    if (!Array.isArray(rects) || rects.length < 1 || rects.length > MIXED_ILLUMINATION_MAX_REGIONS) fail("illumination.blend.regions must list 1 to " + MIXED_ILLUMINATION_MAX_REGIONS + " rectangles.");
    const regions = rects.map((entry, i) => {
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
    const declared = b.stops as unknown[] | undefined;
    if (declared !== undefined && (!Array.isArray(declared) || declared.length !== n)) fail("illumination.blend.stops must list one stop per source.");
    blend!.stops = stops = declared ? declared.map((x, i) => {
      const stop = finite(x, ".blend.stops[" + i + "]");
      return stop >= 0 && stop <= 1 && (i === 0 || stop >= (declared[i - 1] as number)) ? stop : fail("illumination.blend.stops must be non-decreasing in [0, 1].");
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
  // Every light at the frame center, the blend's sources first: a point source's irradiance scale there is c_j·cos θ/d².
  const lights = [...sources, ...points.map((p) => {
    const atCenter = falloff(p, 0, 0);
    return Object.freeze({ illuminant: p.illuminant, option: p.option, illuminanceLux: p.candela * atCenter, irradianceScale: p.scale * atCenter,
      report: Object.freeze({ illuminant: p.illuminant.id, position: p.position, intensityCandela: p.candela }) });
  })];
  const illuminancesLux = lights.map((l, i) => (i < n ? weights[i]! * l.illuminanceLux : l.illuminanceLux));
  let strongest = 0, illuminanceLux = 0;
  illuminancesLux.forEach((e, i) => { illuminanceLux += e; if (e > illuminancesLux[strongest]!) strongest = i; });
  /** The blend's irradiance (k·S(λ) itself where one source has weight 1). */
  const ambient = (u: number, v: number, nm: number): number => {
    if (n === 0) return 0;
    const [i, f] = at(u, v), a = sources[i]!.irradianceScale * shapes[i]!(nm);
    return f === 0 ? a : (1 - f) * a + f * (sources[i + 1]!.irradianceScale * shapes[i + 1]!(nm));
  };
  return Object.freeze({ sources: Object.freeze(lights), blend: blend && Object.freeze(blend),
    irradianceAt: points.length === 0 ? (u: number, v: number, _x: number, _y: number, nm: number): number => ambient(u, v, nm) : (u: number, v: number, x: number, y: number, nm: number): number => {
      let e = ambient(u, v, nm);
      for (const p of points) e += p.scale * p.shape(nm) * falloff(p, x, y);
      return e;
    },
    center: Object.freeze({ illuminanceLux, weights, illuminancesLux, strongestSource: strongest }) });
}
