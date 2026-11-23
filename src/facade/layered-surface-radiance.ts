// SPDX-License-Identifier: Apache-2.0

/**
 * The layered sum's surface radiance (2.29.0 group L0; the model is in `layered-scene-signal.ts`): the spectral radiance
 * L_k(u, v)[n] of surface k at a frame point, at the spectral nodes. The lattice's per-surface tiles hold these values per
 * lattice point (`spectral-lattice-tiles.ts`); the edge sum and the single-surface sum read them from there.
 *
 * Today. A material scene's material at the point gives its spectrum: a neutral material is its reflectance times the scene's
 * white radiance (the one illuminant's irradianceScale·shape(λ)/π at each node), a material with its own spectrum (a point
 * light's cell, `layered-chart-scene.ts`) keeps it. The spectra are copied once per lattice, as the expected signal's tables
 * are. A radiance scene is read at each node. Spectra only: no channel response is summed here (rule 1 of the 2.29.0 plan);
 * every site integrates its spectra against its own channel response when it is read.
 *
 * Interface for the later 2.29.0 groups:
 * - {@link LayeredSurfaceRadiance.radiance}`(k, point, out, at)` writes the N node values of surface k at frame point `point`
 *   (its u and v; the caller applies `point.factor`) into `out[at … at + N)`. Each value depends only on (k, point), so tiles dropped and refilled keep their bits. #745 (group
 *   LR) lights each surface point by the illumination blend at its own frame point (E(u, v, λ) = Σ_j w_j(u, v)·S_j(λ),
 *   L_k = ρ_k(λ)·E/π) here, without changing the single-illuminant values. The field factor of #744 is the geometry's
 *   (`LayeredFramePoint.factor`), applied by the lattice's tile fill, not here.
 * - {@link LayeredSurfaceRadiance.material}`(k, point)`: the material index at the point, or −1 for a radiance scene (the
 *   chief ray's surface, metering and the pilot).
 * - `lookups`: scene lookups so far (one per material lookup, one per node for a radiance scene), for diagnostics.
 *
 * A radiance scene is read through its spectrum form when it has one (`radianceSpectrumAt`, #735: the point resolved once for all
 * nodes, the same values as `radianceAt` per node), else per node.
 *
 * Mixed illumination (#745, 2.29.0 group LR). {@link layeredLitSurfaceScene} gives a surface under an `illumination` as a
 * radiance scene: each frame point (u, v) of the surface is lit by the blend at that frame point, E(u, v, λ) = Σ_j w_j(u, v)·S_j(λ)
 * plus the point sources (`mixed-illumination.ts`), and L_k = ρ_k(λ)·E(u, v, λ)/π, formed at the spectral nodes when a tile is
 * filled; a back plane's light cell adds its lights' own I_e/A to its lit plane. The blend's coordinates are frame units (a
 * layered scene's chart coordinates) and a point source's plane point is (u, v)·metresPerFrameUnit, the plane at the reference
 * (subject) distance. Approximation (labeled): one light field over the frame's angles, the same for every surface whatever
 * its depth, so no shadows between surfaces, no falloff with depth, and no light between surfaces. Each value is the
 * single-plane mixed path's expression (`scene-radiance.ts`, `litRadianceSpectrumAt`: reflectance × irradiance / π, in that
 * order), so a surface filling the frame gives the single-plane values bit for bit. Without an illumination nothing changes:
 * a neutral material keeps `m.neutral * white[n]`. The pilot and the chief ray's material read a radiance scene (−1), as the
 * single-plane mixed path has no material access either.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { DisplayViewScene } from "./expected-signal.js";
import type { LayeredFramePoint } from "./layered-lattice-geometry.js";
import { layeredSurfaceScene, type ResolvedLayeredSurface } from "./layered-chart-scene.js";
import type { ResolvedMixedIllumination } from "./mixed-illumination.js";

/** Surface radiance at the spectral nodes (see the module comment). */
export interface LayeredSurfaceRadiance {
  /** Surface k's spectral radiance at frame point `point`, at each node, into `out[at … at + nodes)`. */
  radiance(k: number, point: LayeredFramePoint, out: Float64Array, at: number): void;
  /** Surface k's material at frame point `point`, or −1 for a radiance scene. */
  material(k: number, point: LayeredFramePoint): number;
  /** Scene lookups so far (material lookups, or radiance lookups per node). */
  readonly lookups: number;
}

export interface LayeredSurfaceRadianceInput {
  wavelengthsNm: readonly number[];
  /** Each surface's scene at the spectral nodes, nearest first (validated by the caller). */
  layers: readonly { readonly scene: DisplayViewScene }[];
}

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };

/** Internal: each surface's radiance (see the module comment). */
export function createLayeredSurfaceRadiance(input: LayeredSurfaceRadianceInput): LayeredSurfaceRadiance {
  const { wavelengthsNm, layers } = input, N = wavelengthsNm.length;
  // Per surface: material spectra at the nodes (copies, as the expected signal's tables).
  const spectra = layers.map((layer): Float64Array[] => {
    const scene = layer.scene;
    if (scene.kind !== "materials") return [];
    const white = scene.whiteRadiance;
    return scene.materials.map((m: { neutral: number } | { radiance: Float64Array }): Float64Array => {
      if (!("neutral" in m)) return Float64Array.from(m.radiance);
      const out = new Float64Array(white.length);
      for (let n = 0; n < white.length; n++) out[n] = m.neutral * white[n]!;
      return out;
    });
  });
  let lookups = 0;
  const scratch = new Float64Array(N);
  return {
    radiance(k, point, out, at): void {
      const scene = layers[k]!.scene, { u, v } = point;
      if (scene.kind === "materials") {
        const L = spectra[k]![scene.materialAt(u, v)];
        if (L === undefined) fail("Unknown chart material.");
        out.set(L!, at); lookups++;
      } else {
        const spectrum = scene.radianceSpectrumAt;
        if (spectrum) { spectrum(u, v, wavelengthsNm, scratch); out.set(scratch, at); } else for (let n = 0; n < N; n++) out[at + n] = scene.radianceAt(u, v, wavelengthsNm[n]!);
        lookups += N;
      }
    },
    material(k, point): number {
      const scene = layers[k]!.scene;
      return scene.kind === "materials" ? scene.materialAt(point.u, point.v) : -1;
    },
    get lookups(): number { return lookups; }
  };
}

/** The lit surface's input (see {@link layeredLitSurfaceScene}); the last three are `layeredSurfaceScene`'s (the light cells). */
export interface LayeredLitSurfaceInput {
  wavelengthsNm: readonly number[];
  /** The resolved `illumination` (`resolveMixedIllumination`): its per-node and spectrum forms. */
  illumination: Pick<ResolvedMixedIllumination, "irradianceAt" | "irradianceSpectrumAt">;
  /** g = 2 / outputWidth, frame units per site. */
  siteFrameUnits: number;
  /** Metres per frame unit at `referenceDistanceM`: a point source's plane point is (u, v) times it. */
  metresPerFrameUnit: number;
  referenceDistanceM: number;
}

/**
 * Internal (#745): surface `surface` lit by a mixed illumination, as a radiance scene for the layered sum and for the
 * single-plane input of the sites that see it alone (see the module comment). Reflectances at the nodes are taken once; a
 * spectral reflectance outside [0, 1] fails as on the single-plane path.
 */
export function layeredLitSurfaceScene(surface: ResolvedLayeredSurface, input: LayeredLitSurfaceInput): Extract<DisplayViewScene, { kind: "radiance" }> {
  const { wavelengthsNm, illumination: light, metresPerFrameUnit: scale } = input;
  if (!(scale > 0 && Number.isFinite(scale))) fail("Layered scene: metresPerFrameUnit must be a positive number.");
  // The material lookup and its light-cell checks are the plain surface's (white 1: the radiances are not used).
  const materialAt = layeredSurfaceScene(surface, { ...input, whiteRadiance: new Float64Array(wavelengthsNm.length).fill(1) }).materialAt;
  const materials = surface.materials, lights = surface.lights;
  const reflectanceOf = (m: number, nm: number): number => {
    // The light cell (index materials.length) is the plane, material 0, plus its lights.
    const material = materials[m < materials.length ? m : 0];
    if (material === undefined) return fail("Unknown chart material.");
    if (material.kind === "neutral") return material.reflectance;
    const value = material.spectrum.evaluate(nm);
    return value >= 0 && value <= 1 ? value : fail("Chart reflectance spectrum left [0, 1].");
  };
  const rows = Array.from({ length: materials.length + (lights ? 1 : 0) }, (_, m) => Float64Array.from(wavelengthsNm, (nm) => reflectanceOf(m, nm)));
  // A light cell's own radiance I_e(λ)/A, A the site's area on the plane (`layeredSurfaceScene`'s expressions).
  const side = lights ? input.siteFrameUnits * scale * surface.distanceM / input.referenceDistanceM : 0, area = side * side;
  const emitted = lights ? Float64Array.from(wavelengthsNm, (nm) => lights.intensityAt(nm) / area) : undefined, cell = materials.length;
  return {
    kind: "radiance",
    radianceAt(u, v, nm): number {
      const m = materialAt(u, v), value = reflectanceOf(m, nm) * light.irradianceAt(u, v, u * scale, v * scale, nm) / Math.PI;
      return m === cell && lights ? value + lights.intensityAt(nm) / area : value;
    },
    radianceSpectrumAt(u, v, wavelengths, out): void {
      const m = materialAt(u, v), own = wavelengths === wavelengthsNm, row = own ? rows[m] : undefined;
      light.irradianceSpectrumAt(u, v, u * scale, v * scale, wavelengths, out);
      for (let n = 0; n < wavelengths.length; n++) out[n] = (row ? row[n]! : reflectanceOf(m, wavelengths[n]!)) * out[n]! / Math.PI;
      if (m === cell && lights) for (let n = 0; n < wavelengths.length; n++) out[n] = out[n]! + (own ? emitted![n]! : lights.intensityAt(wavelengths[n]!) / area);
    }
  };
}
