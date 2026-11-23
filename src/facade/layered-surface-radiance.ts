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
 *   into `out[at … at + N)`. Each value depends only on (k, point), so tiles dropped and refilled keep their bits. #745 (group
 *   LR) lights each surface point by the illumination blend at its own frame point (E(u, v, λ) = Σ_j w_j(u, v)·S_j(λ),
 *   L_k = ρ_k(λ)·E/π) here, without changing the single-illuminant values; #744 (group LG) multiplies by the field factor
 *   where the geometry gives one.
 * - {@link LayeredSurfaceRadiance.material}`(k, point)`: the material index at the point, or −1 for a radiance scene (the
 *   chief ray's surface, metering and the pilot).
 * - `lookups`: scene lookups so far (one per material lookup, one per node for a radiance scene), for diagnostics.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { DisplayViewScene } from "./expected-signal.js";
import type { LayeredFramePoint } from "./layered-lattice-geometry.js";

/** Surface radiance at the spectral nodes (see the module comment). */
export interface LayeredSurfaceRadiance {
  readonly nodes: number;
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
  return {
    nodes: N,
    radiance(k, point, out, at): void {
      const scene = layers[k]!.scene, { u, v } = point;
      if (scene.kind === "materials") {
        const L = spectra[k]![scene.materialAt(u, v)];
        if (L === undefined) fail("Unknown chart material.");
        out.set(L!, at); lookups++;
      } else { for (let n = 0; n < N; n++) out[at + n] = scene.radianceAt(u, v, wavelengthsNm[n]!); lookups += N; }
    },
    material(k, point): number {
      const scene = layers[k]!.scene;
      return scene.kind === "materials" ? scene.materialAt(point.u, point.v) : -1;
    },
    get lookups(): number { return lookups; }
  };
}
