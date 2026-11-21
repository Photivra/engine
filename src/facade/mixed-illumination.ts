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
 * Flash (2.26.0, #639): an impulse of time-integrated luminous intensity Q cd·s (luminous energy per solid angle, lm·s/sr) from a point,
 * set as Q, as the luminous exposure H = Q/r² lx·s at normal incidence at a distance r, or as the guide number G at ISO 100. Its energy
 * does not depend on the shutter time T: it fires while every site integrates (a global shutter, or a rolling one held open at least
 * its skew), so each site collects Q·cos θ/d² of it, and the capture, whose signal is irradiance × T, takes it as a point of
 * intensity Q/T over the window (exact for a static scene; motion is refused, because the pulse would freeze it at one instant).
 * Guide number (docs/SCENE_SENSOR_TEMPORAL_EXPOSURE.md, "Guide number"): G = d·N is the distance × f-number at which an 18 % grey card
 * on the axis gets the CIPA DC-004-2020 standard exposure H = 10/S at S = 100 through the camera equation H = 0.65·L·t/N², so
 * 0.65·0.18·Q/(π·d²·N²) = 10/100 and Q = 10π·G²/(0.65·0.18·100) cd·s; the facade's grey-card standard exposure uses the same constants.
 * `powerFraction` p scales Q (G by √p).
 *
 * Coordinates are the chart's: a fixed-size chart's chart-local units (±1 at its left and right edges, v up on the same scale,
 * extended linearly over the surround), or, without `chartSize`, frame units (±1 at the frame's left and right edges), which are
 * the chart-local units of a chart that fills the frame. Both put (0, 0) at the frame center.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
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
/**
 * 2.26.0 (#639): an electronic flash, an impulse light with inverse-square falloff that adds to the sources and points: its spectrum
 * (default a Planckian 5500 K stand-in, not a measured flash tube), its position (default at the camera: on the optical axis, `heightM`
 * the subject distance) and its output at full power, as a guide number at ISO 100 in metres, a time-integrated intensity in cd·s, or a
 * luminous exposure in lx·s at normal incidence at a distance; `powerFraction` in (0, 1] (default 1) is the manual power setting.
 */
export interface MixedIlluminationFlash {
  illuminant?: CaptureIlluminant;
  position?: { xM: number; yM: number; heightM: number };
  output: { guideNumberM: number } | { candelaSeconds: number } | { luxSeconds: number; distanceM: number };
  powerFraction?: number;
}
/** Q per G² at ISO 100, cd·s/m²: 10π/(0.65·0.18·100) (CIPA DC-004-2020 H = 10/S and H = 0.65·L·t/N², an 18 % grey card). */
export const FLASH_CANDELA_SECONDS_PER_SQUARE_GUIDE_METER = 10 * Math.PI / 11.7;
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
  /** 2.26.0 (#639): an electronic flash ({@link MixedIlluminationFlash}); alone, or with sources or points (the ambient light). */
  flash?: MixedIlluminationFlash;
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
   * #735: `irradianceAt` at each of `wavelengths` into `out`: the point's blend segment and fraction and each point source's
   * cos θ/d² resolved once, then each node from the same expressions in the same order, so `out[n]` is `irradianceAt(…, wavelengths[n])`.
   */
  irradianceSpectrumAt(u: number, v: number, xM: number, yM: number, wavelengths: readonly number[], out: Float64Array): void;
  /**
   * At the frame center: the illuminance, the blend's source weights, each light's illuminance there (w_i·E_i; a point's
   * I·cos θ/d²) and the strongest light (the largest, the first on a tie; an index into `sources`).
   */
  center: { illuminanceLux: number; weights: number[]; illuminancesLux: number[]; strongestSource: number };
  /** #639: true with a flash (the last light, its intensity Q/T over the exposure window T). */
  flash: boolean;
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
const place = (value: unknown, at: string): { xM: number; yM: number; heightM: number } => {
  const q = fields(value, at, ["xM", "yM", "heightM"]);
  return { xM: finite(q.xM, at + ".xM"), yM: finite(q.yM, at + ".yM"), heightM: positive(q.heightM, at + ".heightM", 1e4) };
};
const point = (value: unknown, name: string): MixedIlluminationPoint => {
  const r = fields(value, ".blend." + name, ["u", "v"]);
  return { u: finite(r.u, ".blend." + name + ".u"), v: finite(r.v, ".blend." + name + ".v") };
};

/**
 * Internal: validates `illumination` and resolves its sources with `resolveIlluminant` (the capture's `resolveCaptureIlluminant`, or
 * the display view's portable one). A flash is resolved for the exposure window `windowSeconds` (its intensity Q/T) and, by default, at
 * `cameraDistanceM` on the axis.
 */
export function resolveMixedIllumination(value: unknown, resolveIlluminant: (value: CaptureIlluminant) => ResolvedCaptureIlluminant, windowSeconds = 1, cameraDistanceM = 1,
  moving = false): ResolvedMixedIllumination {
  const record = fields(value, "", ["sources", "blend", "points", "flash"]), given = list(record.sources, "sources", "sources"), pointList = list(record.points, "points", "point sources");
  if (pointList.length === 0 && given.length < 2 && !record.flash) fail("illumination needs two or more sources, a point source or a flash; one source alone is illuminant and illuminanceLux.");
  const sources = given.map((entry, i) => {
    const s = fields(entry, ".sources[" + i + "]", ["illuminant", "illuminanceLux"]), option = s.illuminant as CaptureIlluminant, illuminant = resolveIlluminant(option);
    return Object.freeze({ illuminant, option, illuminanceLux: s.illuminanceLux as number, irradianceScale: calculateIlluminantIrradianceScale(illuminant.shape, s.illuminanceLux as number),
      report: Object.freeze({ illuminant: illuminant.id, illuminanceLux: s.illuminanceLux }) });
  });
  // Point sources: c_j with 683 ∫ c_j S_j ȳ dλ = I_j (the irradiance scale of 1 lux, times I_j), and E_j = c_j S_j(λ)·h/d³.
  const points = pointList.map((entry, j) => {
    const at = ".points[" + j + "]", p = fields(entry, at, ["illuminant", "position", "intensity"]), option = p.illuminant as CaptureIlluminant, illuminant = resolveIlluminant(option);
    const i = fields(p.intensity, at + ".intensity", ["candela", "illuminanceLux", "distanceM"]);
    const candela = i.candela !== undefined ? (i.illuminanceLux === undefined && i.distanceM === undefined ? positive(i.candela, at + ".intensity.candela", 1e9) :
      fail("illumination" + at + ".intensity takes candela or illuminanceLux and distanceM, not both.")) :
      positive(i.illuminanceLux, at + ".intensity.illuminanceLux", 1e7) * positive(i.distanceM, at + ".intensity.distanceM", 1e4) ** 2;
    return { illuminant, option, position: place(p.position, at + ".position"), candela, scale: calculateIlluminantIrradianceScale(illuminant.shape, 1) * candela,
      shape: tabulatedSpectrum(illuminant.shape), flash: undefined as Readonly<Record<string, number>> | undefined };
  });
  // #639: the flash, the last point: Q = p·Q_full cd·s, the intensity Q/T over the window T.
  if (record.flash !== undefined) {
    if (moving) fail("illumination.flash does not support motion (the temporal quadrature does not place the pulse).");
    const f = fields(record.flash, ".flash", ["illuminant", "position", "output", "powerFraction"]), o = fields(f.output, ".flash.output", ["guideNumberM", "candelaSeconds", "luxSeconds", "distanceM"]);
    const option = (f.illuminant ?? { kind: "planckian", temperatureKelvin: 5500 }) as CaptureIlluminant, illuminant = resolveIlluminant(option);
    const power = f.powerFraction === undefined ? 1 : positive(f.powerFraction, ".flash.powerFraction", 1), forms = Object.keys(o).sort().join();
    const full = forms === "guideNumberM" ? positive(o.guideNumberM, ".flash.output.guideNumberM", 1e4) ** 2 * FLASH_CANDELA_SECONDS_PER_SQUARE_GUIDE_METER :
      forms === "candelaSeconds" ? positive(o.candelaSeconds, ".flash.output.candelaSeconds", 1e9) :
        forms === "distanceM,luxSeconds" ? positive(o.luxSeconds, ".flash.output.luxSeconds", 1e7) * positive(o.distanceM, ".flash.output.distanceM", 1e4) ** 2 :
          fail("illumination.flash.output takes guideNumberM, candelaSeconds, or luxSeconds and distanceM.");
    const q = full * power, candela = q / windowSeconds;
    points.push({ illuminant, option, position: f.position === undefined ? { xM: 0, yM: 0, heightM: cameraDistanceM } : place(f.position, ".flash.position"), candela,
      scale: calculateIlluminantIrradianceScale(illuminant.shape, 1) * candela, shape: tabulatedSpectrum(illuminant.shape),
      flash: Object.freeze({ candelaSeconds: q, powerFraction: power, guideNumberM: Math.sqrt(q / FLASH_CANDELA_SECONDS_PER_SQUARE_GUIDE_METER), exposureWindowSeconds: windowSeconds }) });
  }
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
   * #735: resolves the blend at a point, once for all its spectral nodes: the lower source `low` and the fraction `frac` of source
   * low + 1 (0: source low alone), and each point source's cos θ/d² at plane point (x, y) m. On a gradient, the segment
   * [stops[i], stops[i + 1]) that holds t; equal stops are passed over, so the later source takes the stop.
   */
  let low = 0, frac = 0;
  const falloffs = new Float64Array(points.length);
  // Each shape at the nodes of one wavelength list (the same doubles the shape gives), for irradianceSpectrumAt.
  let nodesOf: readonly number[] | undefined, sourceNodes: Float64Array[] = [], pointNodes: Float64Array[] = [];
  const resolvePoint = (u: number, v: number, x: number, y: number): void => {
    low = 0; frac = 0;
    if (n > 0) {
      const t = position(u, v);
      if (!stops) low = t;
      else {
        while (low < n - 1 && t >= stops[low + 1]!) low++;
        if (!(low === n - 1 || t <= stops[low]!)) frac = (t - stops[low]!) / (stops[low + 1]! - stops[low]!);
      }
    }
    for (let j = 0; j < points.length; j++) falloffs[j] = falloff(points[j]!, x, y);
  };
  /**
   * The irradiance at the resolved point from the shapes' values at one node: `lower` and `upper` the blend's two sources' (k·S(λ)
   * itself where one source has weight 1), then each point source's c_j·S_j(λ)·cos θ/d² in order, S_j at `nm` or, with k ≥ 0, from
   * the node table.
   */
  const combine = (lower: number, upper: number, k: number, nm: number): number => {
    let e: number;
    if (n === 0) e = 0;
    else { const a = sources[low]!.irradianceScale * lower; e = frac === 0 ? a : (1 - frac) * a + frac * (sources[low + 1]!.irradianceScale * upper); }
    for (let j = 0; j < points.length; j++) e += points[j]!.scale * (k < 0 ? points[j]!.shape(nm) : pointNodes[j]![k]!) * falloffs[j]!;
    return e;
  };
  resolvePoint(0, 0, 0, 0);
  const i0 = low, f0 = frac, weights = sources.map((_, i) => (i === i0 ? 1 - f0 : i === i0 + 1 ? f0 : 0));
  // Every light at the frame center, the blend's sources first: a point source's irradiance scale there is c_j·cos θ/d².
  const lights = [...sources, ...points.map((p) => {
    const atCenter = falloff(p, 0, 0);
    return Object.freeze({ illuminant: p.illuminant, option: p.option, illuminanceLux: p.candela * atCenter, irradianceScale: p.scale * atCenter,
      report: Object.freeze({ illuminant: p.illuminant.id, position: p.position, intensityCandela: p.candela, ...(p.flash ? { flash: p.flash } : {}) }) });
  })];
  const illuminancesLux = lights.map((l, i) => (i < n ? weights[i]! * l.illuminanceLux : l.illuminanceLux));
  let strongest = 0, illuminanceLux = 0;
  illuminancesLux.forEach((e, i) => { illuminanceLux += e; if (e > illuminancesLux[strongest]!) strongest = i; });
  return Object.freeze({ sources: Object.freeze(lights), blend: blend && Object.freeze(blend),
    irradianceAt: (u: number, v: number, x: number, y: number, nm: number): number => {
      resolvePoint(u, v, x, y);
      return combine(n > 0 ? shapes[low]!(nm) : 0, frac === 0 ? 0 : shapes[low + 1]!(nm), -1, nm);
    },
    irradianceSpectrumAt(u: number, v: number, x: number, y: number, wavelengths: readonly number[], out: Float64Array): void {
      resolvePoint(u, v, x, y);
      if (nodesOf !== wavelengths) {
        nodesOf = wavelengths;
        sourceNodes = shapes.map((shape) => Float64Array.from(wavelengths, shape));
        pointNodes = points.map((p) => Float64Array.from(wavelengths, p.shape));
      }
      for (let k = 0; k < wavelengths.length; k++) out[k] = combine(n > 0 ? sourceNodes[low]![k]! : 0, frac === 0 ? 0 : sourceNodes[low + 1]![k]!, k, 0);
    },
    center: Object.freeze({ illuminanceLux, weights, illuminancesLux, strongestSource: strongest }), flash: record.flash !== undefined });
}

/**
 * Internal (#639): sets the meter's zone signals for a shutter t, scale·(A_z + F_z/t) with F_z = total_z − A_z the flash's luminance
 * at a 1 s window (the zones' luminances through lens.filter), or with `card` [ambient E, total E at 1 s, factor] the grey card's
 * scale·factor·(E_a + (E − E_a)/t).
 */
export function meterFlash(samples: { relativeLinearSignal: number }[], total: readonly number[], ambient: readonly number[], scale: number,
  card: readonly [number, number, number] | undefined): ((t: number) => void) & { alone: boolean } {
  return Object.assign((t: number) => samples.forEach((sample, z) => {
    sample.relativeLinearSignal = scale * (card ? card[2] * (card[0] + (card[1] - card[0]) / t) : ambient[z]! + (total[z]! - ambient[z]!) / t);
  }), { alone: card ? card[0] === 0 : ambient.every((a) => a === 0) });
}

/**
 * Internal (#639, owner decision 2026-11-16): the shutter of an automatic mode when the flash alone lights the scene (the meter's
 * ambient reading is zero in every zone, or on the grey card), so that every shutter gives the same exposure: 1/125 s, held within the
 * body's shutter range. Records the assumption `exposure.flashShutter`.
 */
export function flashAloneShutter(minimumSeconds: number, maximumSeconds: number, assume: (id: string, kind: "model", value: unknown, explanation: string) => void): number {
  const t = Math.min(maximumSeconds, Math.max(minimumSeconds, 1 / 125));
  assume("exposure.flashShutter", "model", t, "Flash alone (no ambient reading): every shutter gives the same exposure, so the automatic mode takes 1/125 s within the body's range.");
  return t;
}

/**
 * Internal (#639): in an automatic mode the shutter t is unknown, and the settings are those whose shutter R(t), resolved from the
 * reading at t, is t. f(x) = ln R(eˣ) − x is ≥ 0 at the shortest shutter and ≤ 0 at the longest (R stays within them), so a root is
 * bracketed. At the longest shutter when f is 0 there, else bisection in x to 1e-12 keeping f ≥ 0 at the lower end; a few direct
 * steps t ← R(t) then settle a body whose shutters are discrete. `resolveAt` leaves its last resolution in place.
 */
export function solveFlashShutter(resolveAt: (t: number) => number, minimumSeconds: number, maximumSeconds: number): void {
  const f = (x: number): number => Math.log(resolveAt(Math.exp(x))) - x;
  let a = Math.log(minimumSeconds), b = Math.log(maximumSeconds);
  if (f(b) >= 0) a = b;
  else while (b - a > 1e-12) { const m = (a + b) / 2; if (f(m) >= 0) a = m; else b = m; }
  for (let k = 0, t = Math.exp(a), next; k < 8 && (next = resolveAt(t)) !== t; k++) t = next;
}

/** Internal (#639): the assumptions recorded before the shutter was known, with the light at the resolved shutter. */
export function rebindFlashAssumptions(assumptions: { id: string; value: unknown }[], light: ResolvedMixedIllumination): void {
  const lux = light.center.illuminanceLux;
  for (const a of assumptions) {
    const value = a.value as Record<string, unknown>;
    if (a.id === "scene.illumination") a.value = { ...value, lights: light.sources.map((l) => l.report), center: light.center };
    if (a.id === "exposure.meteringCard") a.value = { ...value, illuminanceLux: lux };
    if (a.id === "exposure.meteringSource") a.value = { ...value, luminanceCdPerSquareMeter: 0.18 * lux / Math.PI };
  }
}

/** Internal (#639): under a rolling shutter the flash needs one instant at which every row is open, t ≥ the readout skew τ. */
export function requireFlashRows(shutterSeconds: number, skewSeconds: number): void {
  if (shutterSeconds < skewSeconds) throw new InvalidScientificInputError("illumination.flash with a rolling shutter needs a shutter time ≥ the readout skew, " + skewSeconds + " s.");
}
