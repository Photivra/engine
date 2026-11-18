// SPDX-License-Identifier: Apache-2.0
/**
 * Fixtures of the layered-scene tests (#652): small site lattices with surfaces at given signed blur radii, their
 * single-plane expected-signal inputs, and an independent brute-force aperture integration (plain JavaScript, no engine
 * kernels) of the thin-lens model: the irradiance at a lattice point is the mean over 64 × 64 pupil points (a staggered grid,
 * those inside the unit circle) of the radiance of the first surface each ray meets, the ray through pupil point P meeting
 * surface j at p − ρ_j·P on the lattice.
 */
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../../src/optics/defocus-disc-kernel.js";
import type { DisplayViewExpectedSignalInput, DisplayViewQueryOffset, DisplayViewScene } from "../../src/facade/expected-signal.js";
import { createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneLayer, type LayeredSceneSignalInput } from "../../src/facade/layered-scene-signal.js";

export const WAVELENGTHS = [450, 550, 650] as const;
export const WHITE = Float64Array.of(1, 1.25, 0.85);
/** Per CFA channel (red, green, blue), electrons per unit radiance at each node. */
export const RESPONSE: [Float64Array, Float64Array, Float64Array] = [Float64Array.of(20, 120, 900), Float64Array.of(80, 1000, 150), Float64Array.of(700, 90, 10)];
export const bayer = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
const UNIT = Float64Array.of(1);

export interface SurfaceSpec {
  /** Frame-unit rectangle, null for the far surface. */
  rect: { u0: number; v0: number; u1: number; v1: number } | null;
  /** Signed blur radius in sites. */
  rho: number;
  /** Neutral reflectances of the surface's materials, and its material at a frame point. */
  reflectances: readonly number[];
  materialAt?: (u: number, v: number) => number;
  /** A ready scene instead (for lights). */
  scene?: Extract<DisplayViewScene, { kind: "materials" }>;
}

export interface Fixture { W: number; H: number; g: number; offsets: DisplayViewQueryOffset[]; diffraction?: { radius: number; perNode: Float64Array[] } }

export function fixture(W: number, H: number, options: { box?: boolean; diffraction?: boolean } = {}): Fixture {
  const offsets = options.box ? [-0.25, 0.25].flatMap((y) => [-0.25, 0.25].map((x) => ({ x, y, weight: 0.25 }))) : [{ x: 0, y: 0, weight: 1 }];
  // A small, normalized, node-dependent kernel standing in for diffraction.
  const diffraction = options.diffraction ? { radius: 1, perNode: WAVELENGTHS.map((_, n): Float64Array => {
    const side = 0.05 + 0.03 * n, corner = 0.01 + 0.005 * n, k = Float64Array.of(corner, side, corner, side, 0, side, corner, side, corner);
    k[4] = 1 - (4 * side + 4 * corner);
    return k;
  }) } : undefined;
  return { W, H, g: 2 / W, offsets, ...(diffraction ? { diffraction } : {}) };
}

export function surfaceScene(spec: SurfaceSpec): Extract<DisplayViewScene, { kind: "materials" }> {
  return spec.scene ?? { kind: "materials", materialAt: spec.materialAt ?? ((): number => 0), materials: spec.reflectances.map((r) => ({ neutral: r })), whiteRadiance: WHITE };
}

/** The layer list; `delegates` adds each surface's single-plane input. */
export function layersOf(f: Fixture, specs: readonly SurfaceSpec[], delegates = true): LayeredSceneLayer[] {
  return specs.map((spec) => {
    const disc = spec.rho === 0 ? null : createDefocusDiscSiteKernel(2 * Math.abs(spec.rho));
    const kernel = disc ? { radius: disc.radius, weights: disc.weights } : null, scene = surfaceScene(spec);
    const perNode = WAVELENGTHS.map((_, n) => {
      const d = f.diffraction;
      if (d && kernel) return convolveSiteKernels(d.perNode[n]!, d.radius, kernel.weights, kernel.radius);
      if (d) return d.perNode[n]!;
      return kernel ? kernel.weights : UNIT;
    });
    const radius = (kernel ? kernel.radius : 0) + (f.diffraction ? f.diffraction.radius : 0);
    const signalInput: DisplayViewExpectedSignalInput = { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, electronsPerRadiance: RESPONSE,
      offsets: f.offsets, kernels: { radius, perNode }, scene, channelAt: bayer };
    return { rect: spec.rect, blurRadiusSites: spec.rho, scene, kernel, ...(delegates ? { signalInput } : {}) };
  });
}

export function signalInputOf(f: Fixture, specs: readonly SurfaceSpec[], samples: number, delegates = true): LayeredSceneSignalInput {
  return { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, layers: layersOf(f, specs, delegates), occlusionSamples: samples,
    offsets: f.offsets, electronsPerRadiance: RESPONSE, channelAt: bayer, ...(f.diffraction ? { diffraction: f.diffraction } : {}) };
}

export function layeredSignal(f: Fixture, specs: readonly SurfaceSpec[], samples: number, delegates = true): ReturnType<typeof createLayeredSceneSignal> {
  const input = signalInputOf(f, specs, samples, delegates);
  return createLayeredSceneSignal(input, createLayeredSceneLattice(input));
}

/** A channel's signal of a spectrum at the nodes. */
export const signalOf = (c: number, spectrum: ArrayLike<number>): number => { let s = 0; for (let n = 0; n < WAVELENGTHS.length; n++) s += RESPONSE[c]![n]! * spectrum[n]!; return s; };

/**
 * Brute-force reference at the centre of native site (x, y) (one zero offset, no diffraction): 64 × 64 pupil points on
 * [−1, 1]², those inside the unit circle kept; each ray's first surface (rectangles in frame units, the far surface unbounded)
 * gives its radiance (each surface uniform here: its first material). Independent of the engine's kernels and sub-samples.
 */
export function bruteForceSite(f: Fixture, specs: readonly SurfaceSpec[], x: number, y: number, points = 64): number {
  const c = bayer(x, y);
  let sum = 0, count = 0;
  for (let j = 0; j < points; j++) for (let i = 0; i < points; i++) {
    // A staggered grid: each row and column shifted by an irrational fraction of a step, so no column of points lines up with
    // an axis-aligned card edge (an aligned grid moves a whole column of points across an edge at once, about 1 % of the pupil).
    const px = -1 + (i + ((j * 0.6180339887498949) % 1)) * 2 / points, py = -1 + (j + ((i * 0.7548776662466927) % 1)) * 2 / points;
    if (px * px + py * py > 1) continue;
    count++;
    for (const spec of specs) {
      // The ray's point on this surface, in lattice coordinates, then in frame units.
      const X = x - spec.rho * px, Y = y - spec.rho * py, u = (X + 0.5 - f.W / 2) * f.g, v = -(Y + 0.5 - f.H / 2) * f.g, r = spec.rect;
      if (r === null || (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)) {
        sum += signalOf(c, WHITE.map((w) => w * spec.reflectances[0]!));
        break;
      }
    }
  }
  return sum / count;
}
