// SPDX-License-Identifier: Apache-2.0
/**
 * The layered edge sum by runs (#749, #750) through a lens map (#744), the check of LE and LG together.
 * Where a point's rows do not hold (curved card edges, \`rowsHold\` false) the run sum takes \`share\` per tap and so equals the
 * direct sum bit for bit; where they hold, runs over the half-planes' rows equal the direct sum within 1e-9 relative.
 */
import { expect, it } from "vitest";
import { prepareDefocusImageSpaceGeometry, type PreparedDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { createLayeredLensMap, type LayeredFramePoint, type LayeredLensMap } from "../src/facade/layered-lattice-geometry.js";
import { createLayeredEdgeSum, type LayeredSurfaceTileReader } from "../src/facade/layered-edge-sum.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, type LayeredSceneLattice, type LayeredSceneSignalInput } from "../src/facade/layered-scene-signal.js";
import { undistortedImagePointNewton } from "../src/optics/radial-distortion-newton.js";
import { prepareEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import type { LensProjectionModel } from "../src/camera/lens-projection.js";
import { WAVELENGTHS, fixture, signalInputOf, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const { fast: FAST, full: FULL } = LAYERED_OCCLUSION_SAMPLES;
const W = 96, H = 64, PITCH = 375, HALF_DIAGONAL = 21.633307652783937, DISTANCE = 1, N = WAVELENGTHS.length;
const VIGNETTING = { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.5, coefficients: { r2: -0.3065093752749457, r4: 0.023486999282859373, r6: 0 } };
interface Lens { geometry: PreparedDefocusImageSpaceGeometry; scale: number; map: LayeredLensMap; zeroBeyondHorizon: boolean }
/** A still lens: focal length, projection, radial k1 (null: none), vignetting; frame units scaled so the centre matches the planar map. */
function lens(focalLengthMm: number, model: LensProjectionModel, k1: number | null, vignetting: boolean, undistort = true): Lens {
  const fisheye = model !== "rectilinear";
  const lensMapping = k1 === null && !fisheye ? undefined : prepareEnvironmentLensFieldMapping({ projectionModel: model, radiometricAreaCorrection: "inverse-distortion-jacobian",
    ...(fisheye ? { outsideImageCircle: "backward-ray" } : {}),
    distortion: k1 === null ? { kind: "none" } : { kind: "radial", profile: { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.6, coefficients: { k1, k2: k1 / 10, k3: 0 } } } });
  const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm, focusDistanceM: 2, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
    ...(lensMapping ? { lensMapping } : {}), ...(vignetting ? { vignetting: VIGNETTING } : {}), ...(undistort ? { undistort: undistortedImagePointNewton } : {}) });
  // The projection distance from the axis's ray: u = (x / pd)·(DISTANCE / scale) equals x_sites·g at the centre.
  const near = geometry.lookOf(1e-3, 0, 0), pd = 1e-3 * near.z / near.x, g = 2 / W;
  const scale = DISTANCE * (PITCH / 1000) / (pd * g);
  const map = createLayeredLensMap({ geometry, pitchMicrometers: PITCH, distanceM: DISTANCE, metresPerFrameUnit: scale, zeroBeyondHorizon: fisheye });
  return { geometry, scale, map, zeroBeyondHorizon: fisheye };
}
/**
 * A card from sensor point (ex, ey0) to (ex2, ey1), sites from the centre: its rectangle in frame units spans the frame points of
 * the four corners (so its edges are curves through the lens).
 */
function cardRight(l: Lens, ex: number, ey0: number, ey1: number, ex2 = 50): { u0: number; v0: number; u1: number; v1: number } {
  const corners = [[ex, ey0], [ex, ey1], [ex2, ey0], [ex2, ey1], [ex, (ey0 + ey1) / 2]].map(([x, y]) => {
    const p: LayeredFramePoint = { u: 0, v: 0, factor: 0 };
    l.map.framePointOf(x!, y!, p);
    if (!(p.factor > 0)) throw new Error("card corner beyond the horizon");
    return p;
  });
  return { u0: corners[4]!.u, u1: Math.max(...corners.map((p) => p.u)), v0: Math.min(...corners.map((p) => p.v)), v1: Math.max(...corners.map((p) => p.v)) };
}

function readerOf(lattice: LayeredSceneLattice, runs: boolean): LayeredSurfaceTileReader {
  const tiles = lattice.tiles.surfaces, T = tiles.tile;
  const reader: { tile: Float64Array; at: LayeredSurfaceTileReader["at"]; rowSum?: NonNullable<LayeredSurfaceTileReader["rowSum"]> } = { tile: new Float64Array(0), at(k, group, p, q) {
    const tx = Math.floor(p / T), ty = Math.floor(q / T);
    reader.tile = tiles.rows(k * 4096 + group, tx, ty, 0, T);
    return ((q - ty * T) * T + p - tx * T) * N;
  } };
  if (runs) reader.rowSum = (k, group, p0, p1, q, out, from, to): void => tiles.rowSum(k * 4096 + group, p0, p1, q, out, from, to);
  return reader;
}

const cases: { name: string; lens: () => Lens; specs: (l: Lens) => SurfaceSpec[]; samples: number }[] = [
  { name: "a strong barrel distortion with vignetting", lens: () => lens(20, "rectilinear", -0.08, true), samples: FULL,
    specs: (l) => [{ rect: cardRight(l, 26, -40, 40), rho: -2.5, reflectances: [0.15] }, { rect: null, rho: 4, reflectances: [0.9] }] },
  { name: "an equisolid fisheye", lens: () => lens(12, "fisheye-equisolid-angle", -0.02, false), samples: FULL,
    specs: (l) => [{ rect: cardRight(l, 24, -28, 28, 34), rho: -3, reflectances: [0.1] }, { rect: null, rho: 2.5, reflectances: [0.85] }] },
  { name: "an equisolid fisheye, a large blur behind a far card's edge", lens: () => lens(12, "fisheye-equisolid-angle", -0.02, false), samples: FAST,
    specs: (l) => [{ rect: cardRight(l, 16, -24, 24, 30), rho: -9, reflectances: [0.1] }, { rect: cardRight(l, 24, -20, 20, 32), rho: 0.8, reflectances: [0.95] },
      { rect: null, rho: 4, reflectances: [0.4] }] }];

for (const c of cases) it(c.name + ": runs equal the direct sum (share per tap where rows do not hold)", () => {
  const l = c.lens(), input: LayeredSceneSignalInput = { ...signalInputOf(fixture(W, H), c.specs(l), c.samples, false), lensMap: l.map, marginSites: 1 };
  const lattice = createLayeredSceneLattice(input), { geometry, visibility } = lattice.parts;
  const kernelGroups = input.layers.map((layer) => [{ nodes: { from: 0, to: N }, kernel: { radius: layer.kernel ? layer.kernel.radius : 0, weightsAt: (): Float64Array | null => (layer.kernel ? layer.kernel.weights : null) } }]);
  const runs = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, true), kernelGroups, capacityBytes: 1 << 26 });
  const direct = createLayeredEdgeSum({ geometry, visibility, surfaces: readerOf(lattice, false), kernelGroups, capacityBytes: 1 << 26, method: "direct" });
  const group = lattice.groupOf(0, 0), a = new Float64Array(N), b = new Float64Array(N);
  let notHolding = 0, holdingEdge = 0, worstHolding = 0, differingNotHolding = 0;
  for (let q = 0; q < H; q += c.samples === FAST ? 6 : 2) for (let p = 0; p < W; p++) {
    if (geometry.surfaceOf(group, p, q) >= 0) continue;
    a.fill(0); b.fill(0);
    runs.sumAt(group, p, q, a, 0); direct.sumAt(group, p, q, b, 0);
    if (!visibility.rowsHold(group, p, q)) {
      notHolding++;
      for (let n = 0; n < N; n++) if (a[n] !== b[n]) differingNotHolding++;
    } else {
      holdingEdge++;
      for (let n = 0; n < N; n++) if (a[n] !== b[n]) worstHolding = Math.max(worstHolding, Math.abs(a[n]! - b[n]!) / Math.max(Math.abs(a[n]!), Math.abs(b[n]!)));
    }
  }
  console.log(`${c.name}: edge points ${notHolding + holdingEdge}, rows do not hold at ${notHolding} (differing values ${differingNotHolding}), hold at ${holdingEdge} (worst relative ${worstHolding.toExponential(2)})`);
  expect(differingNotHolding).toBe(0);
  expect(worstHolding).toBeLessThan(1e-9);
  // The barrel distortion's edges are straight within tolerance at almost every point (runs); the fisheyes' are not (share per tap).
  if (l.zeroBeyondHorizon) expect(notHolding).toBeGreaterThan(0); else expect(holdingEdge).toBeGreaterThan(notHolding);
}, 300_000);
