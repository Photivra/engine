// SPDX-License-Identifier: Apache-2.0

/**
 * The capture's and ideal reference's scene provider for layered chart scenes (#652): each environment query of a site
 * lattice point gets the spectral radiance of the layered sum at that point (`layered-scene-signal.ts`), so the capture forms
 * the same per-site sum as the display view and the two agree per site within rounding (the 2.27.0 plan's equivalence
 * tolerance, 1e-9 relative).
 *
 * As with the object-space convolutions (`createDiffractedPlanarProvider`), this holds for the still, rectilinear,
 * distortion-free camera without field throughput, where every site sees one regular lattice of plane points and the
 * radiance-to-irradiance factor is the same everywhere: a query direction is mapped to its frame point with the base
 * provider's own plane arithmetic (frame units are angles, so any one reference plane gives the same frame point), located on
 * the lattice of its fractional query offset within 1e-6 site, and answered with that lattice point's value at the node. A
 * query off the lattices is refused, not approximated, and so are pupil rays. The environment then declares no PSF: the
 * defocus, occlusion and (when given) diffraction are all in the lattice values.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { isInternalSceneRadianceEvaluator, markInternalSceneRadianceEvaluator, registerInternalRadianceAccess } from "../core/internal-radiance-evaluator.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import type { PlanarSceneRadianceProvider } from "./scene-radiance.js";
import type { LayeredSceneLattice } from "./layered-scene-signal.js";

const LATTICE_TOLERANCE_SITES = 1e-6;

export interface LayeredSceneProviderInput {
  /**
   * A provider of the scene's plane geometry (the far surface's, say) whose result records the answers reuse; only its radiance
   * is replaced. Its `evaluateRadiance` must answer environment-direction queries.
   */
  base: PlanarSceneRadianceProvider;
  lattice: LayeredSceneLattice;
  wavelengthsNm: readonly number[];
  nativeWidth: number;
  nativeHeight: number;
  /** Output width in sites: g = 2 / outputWidth frame units per site. */
  outputWidth: number;
  /** The base provider's plane distance and metres per frame unit, to map a query direction to its frame point as it does. */
  distanceM: number;
  metresPerFrameUnit: number;
  /** Offsets of the query points from the site centres in sites (+x right, +y down). Default: one zero offset. */
  queryOffsetsSites?: readonly { x: number; y: number }[];
}

/** Internal: the layered sum as a planar scene provider (see the module comment). */
export function createLayeredSceneProvider(input: LayeredSceneProviderInput): PlanarSceneRadianceProvider & { readonly queries: number } {
  const { base, lattice, wavelengthsNm, nativeWidth: W, nativeHeight: H } = input, g = 2 / input.outputWidth;
  const index = new Map(wavelengthsNm.map((nm, i) => [nm, i]));
  if (lattice.nodes !== wavelengthsNm.length) throw new InvalidConfigurationError("Layered scene provider: the lattice must have the query's spectral nodes.");
  const offsets = input.queryOffsetsSites ?? [{ x: 0, y: 0 }];
  const fraction = (value: number): number => { const f = value - Math.floor(value); return f > 1 - LATTICE_TOLERANCE_SITES ? 0 : f < LATTICE_TOLERANCE_SITES ? 0 : f; };
  const shifts: { x: number; y: number; group: number }[] = [];
  for (const o of offsets) {
    const fx = fraction(o.x), fy = fraction(o.y);
    if (!shifts.some((s) => Math.abs(s.x - fx) <= LATTICE_TOLERANCE_SITES && Math.abs(s.y - fy) <= LATTICE_TOLERANCE_SITES)) shifts.push({ x: fx, y: fy, group: lattice.groupOf(fx, fy) });
  }
  const M = Math.max(0, ...offsets.map((o) => Math.ceil(Math.max(Math.abs(o.x), Math.abs(o.y)) - LATTICE_TOLERANCE_SITES))) + 1;
  const LW = W + 2 * M, LH = H + 2 * M;
  const scale = input.metresPerFrameUnit, distance = input.distanceM, baseEvaluate = base.evaluateRadiance;
  const spectrum = new Float64Array(wavelengthsNm.length);
  let lastKey = -1, queries = 0;
  /** The lattice key ((shift·LH + q + M)·LW + p + M) of frame point (u, v), or undefined off the lattices and the raster's margin. */
  function keyOf(u: number, v: number): number | undefined {
    const fi = u / g - 0.5 + W / 2, fj = -v / g - 0.5 + H / 2;
    for (let s = 0; s < shifts.length; s++) {
      const shift = shifts[s]!, i = Math.round(fi - shift.x), j = Math.round(fj - shift.y);
      if (Math.abs(fi - shift.x - i) > LATTICE_TOLERANCE_SITES || Math.abs(fj - shift.y - j) > LATTICE_TOLERANCE_SITES) continue;
      const li = i + M, lj = j + M;
      if (li < 0 || lj < 0 || li >= LW || lj >= LH) return undefined;
      return (s * LH + lj) * LW + li;
    }
    return undefined;
  }
  function valueOfKey(key: number | undefined, nm: number): number {
    const w = index.get(nm);
    if (w === undefined || key === undefined) throw new InvalidConfigurationError("Layered scene query is off the site lattice; the layered sum does not apply.");
    if (key !== lastKey) {
      const li = key % LW, rest = (key - li) / LW, lj = rest % LH, s = (rest - lj) / LH;
      lattice.spectrumAt(shifts[s]!.group, li - M, lj - M, spectrum);
      lastKey = key; queries++;
    }
    return spectrum[w]!;
  }
  const frameOf = (o: Readonly<{ x: number; y: number; z: number }>): { u: number; v: number } | undefined => {
    if (!(-o.z > 0)) return undefined;
    const t = distance / -o.z;
    return { u: -o.x * t / scale, v: -o.y * t / scale };
  };
  const evaluateRadiance = (request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => {
    const result = baseEvaluate.call(base, request), o = (request.target as { outgoingDirectionUnitVector: { x: number; y: number; z: number } }).outgoingDirectionUnitVector;
    const point = frameOf(o);
    return { ...result, spectralRadianceWattsPerSquareMeterSteradianNanometer: valueOfKey(point && keyOf(point.u, point.v), request.wavelengthNanometers) };
  };
  if (isInternalSceneRadianceEvaluator(baseEvaluate)) {
    markInternalSceneRadianceEvaluator(evaluateRadiance);
    registerInternalRadianceAccess(evaluateRadiance, {
      tabulated: false,
      keyOfDirection(o): number | undefined { const point = frameOf(o); return point && keyOf(point.u, point.v); },
      radianceOfKey: valueOfKey
    });
  }
  return {
    sceneId: base.sceneId, providerProfileId: base.providerProfileId,
    /** The layered value at a lattice point's frame point (the defocused, occluded radiance the sites receive there). */
    radianceAt: (u, v, nm) => valueOfKey(keyOf(u, v), nm),
    evaluateRadiance,
    evaluateApertureRadiance(): SceneRadianceEvaluationResult {
      throw new InvalidConfigurationError("The layered scene provider does not take pupil rays: its defocus is in the lattice values.");
    },
    get queries(): number { return queries; }
  };
}
