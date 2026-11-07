// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { InvalidScientificInputError, calculateDefocusCircle } from "../src/index.js";
import { DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES, createDefocusDiscSiteKernel, defocusDiscKernelRadius, requireDefocusDiscKernelRadius,
  resolveDefocusDisc, type DefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";

const DIAMETERS = [0.3, 1, 1.0001, 2.5, 3.7, 7.3, 19.03, 40.2, 82.6, 128.9] as const;

function kernel(diameterSites: number): DefocusDiscSiteKernel {
  const k = createDefocusDiscSiteKernel(diameterSites);
  if (!k) throw new Error("expected a kernel");
  return k;
}
const at = (k: DefocusDiscSiteKernel, i: number, j: number): number => k.weights[(j + k.radius) * k.width + i + k.radius]!;

/** The exact sum minus 1, accumulated as a double-double (TwoSum). */
function exactSumMinusOne(weights: Float64Array): number {
  let hi = 0, lo = 0;
  for (const w of weights) { const s = hi + w, b = s - hi; lo += (hi - (s - b)) + (w - b); hi = s; }
  return (hi - 1) + lo;
}

/**
 * Edge-spread function of a uniform disc of radius r: the fraction of the disc's area on the side X < t of a straight
 * line at signed distance t from its centre (the circular-segment area, elementary geometry):
 * ½ + (t·√(r² − t²) + r²·arcsin(t/r)) / (π·r²) for |t| ≤ r. `Math.asin` is fine here: this is the reference, not the engine.
 */
function discEdgeSpread(t: number, r: number): number {
  if (t <= -r) return 0;
  if (t >= r) return 1;
  return 0.5 + (t * Math.sqrt(r * r - t * t) + r * r * Math.asin(t / r)) / (Math.PI * r * r);
}

describe("geometric defocus disc on the site lattice (#492)", () => {
  /*
   * A straight edge (scene 1 where n·(x, y) > e, 0 elsewhere, sampled at the site centres) convolved with the kernel,
   * against the disc's analytic edge-spread function at each site. The only difference allowed is the site sampling:
   * a kernel cell that the edge line crosses is counted wholly on the side of its centre, so at each site the error is
   * at most the summed weight of the kernel cells the line crosses (0 when the line runs along cell boundaries), plus
   * 10^-12 of rounding.
   */
  it("blurs a sampled straight edge into the disc's edge-spread function within the site-sampling bound", () => {
    let boundaryWorst = 0;
    const worstByDiameter: Record<string, { error: number; bound: number }> = {};
    for (const diameter of DIAMETERS) {
      let worstError = 0, worstBound = 0;
      const k = kernel(diameter), r = diameter / 2, R = k.radius;
      for (const degrees of [0, 7, 30, 45]) {
        const c = Math.cos(degrees * Math.PI / 180), s = Math.sin(degrees * Math.PI / 180);
        for (const e of [0.5, 0.25, 0.1, 0.73]) {
          for (let i = -R - 2; i <= R + 2; i++) {
            let blurred = 0, crossed = 0;
            for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
              const w = at(k, u, v);
              if (w === 0) continue;
              // Scene sample at site (i − u, 0 − v).
              const x = i - u, y = -v;
              if (c * x + s * y > e) blurred += w;
              // Does the edge line cross the cell of that scene sample (its corners on both sides)?
              const h = 0.5 * (Math.abs(c) + Math.abs(s)), d = c * x + s * y - e;
              if (Math.abs(d) < h) crossed += w;
            }
            const expected = discEdgeSpread(c * i - e, r), error = Math.abs(blurred - expected), bound = crossed + 1e-12;
            expect(error).toBeLessThanOrEqual(bound);
            worstError = Math.max(worstError, error);
            worstBound = Math.max(worstBound, crossed);
            if (degrees === 0 && e === 0.5) boundaryWorst = Math.max(boundaryWorst, error);
          }
        }
      }
      worstByDiameter[String(diameter)] = { error: worstError, bound: worstBound };
    }
    // Measured at #492 step 1: the axis-aligned edge on a cell boundary (no crossed cell) matched to 2.2e-13; elsewhere the
    // worst error per diameter was 0.47 (d ≤ 1 site: the identity kernel), 0.197 (2.5 sites), 0.0695 (7.3), 0.0267 (19.03)
    // and 0.0040 (128.9), 28–33 % of the largest crossed-cell weight, falling as 1/d like the bound.
    expect(boundaryWorst).toBeLessThan(1e-12);
    for (const diameter of DIAMETERS) if (diameter >= 2.5) {
      const { error, bound } = worstByDiameter[String(diameter)]!;
      expect(error).toBeLessThan(0.34 * bound);
    }
  });

  it("sums to 1 exactly within half an ulp of the centre weight, with no negative weight", () => {
    let worstNaive = 0;
    for (let diameter = 0.05; diameter < 129; diameter += 0.37) {
      const k = kernel(diameter), centre = k.weights[(k.weights.length - 1) / 2]!;
      expect(Math.abs(exactSumMinusOne(k.weights))).toBeLessThanOrEqual(Number.EPSILON * 2 ** Math.floor(Math.log2(centre)) / 2);
      let sum = 0, smallest = Infinity;
      for (const w of k.weights) { sum += w; smallest = Math.min(smallest, w); }
      expect(smallest).toBeGreaterThanOrEqual(0);
      worstNaive = Math.max(worstNaive, Math.abs(sum - 1));
    }
    // A plain row-major float64 sum differs from 1 only by its own rounding (at most n·2^-53 for n terms).
    expect(worstNaive).toBeLessThan(129 * 129 * 2 ** -53);
  });

  it("weights each cell by the disc area inside it (a cell inside the disc weighs 1/(π r²), the window reaches the disc)", () => {
    const k = kernel(40.2), r = 20.1;
    expect(at(k, 3, 2) / (1 / (Math.PI * r * r))).toBeCloseTo(1, 12);
    expect(k.radius).toBe(20);
    expect(at(k, 20, 0)).toBeGreaterThan(0);
    expect(at(k, 20, 20)).toBe(0);
    // Column sums are the disc's strip fractions between consecutive cell boundaries.
    for (let u = -k.radius; u <= k.radius; u++) {
      let column = 0;
      for (let v = -k.radius; v <= k.radius; v++) column += at(k, u, v);
      expect(column).toBeCloseTo(discEdgeSpread(u + 0.5, r) - discEdgeSpread(u - 0.5, r), 13);
    }
  });

  it("has the 8-fold symmetry of the disc on the square lattice, bit for bit", () => {
    for (const diameter of DIAMETERS) {
      const k = kernel(diameter);
      for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) {
        const w = at(k, i, j);
        for (const [a, b] of [[-i, j], [i, -j], [-i, -j], [j, i], [-j, i], [j, -i], [-j, -i]] as const) expect(at(k, a, b)).toBe(w);
      }
    }
  });

  it("gives the identity for a disc inside one site and a near-identity just above it", () => {
    for (const diameter of [1e-9, 0.3, 1]) expect(Array.from(kernel(diameter).weights)).toEqual([1]);
    const k = kernel(1.0001);
    expect(k.radius).toBe(1);
    expect(at(k, 0, 0)).toBeGreaterThan(0.99999);
    expect(at(k, 1, 0)).toBeGreaterThan(0);
    expect(at(k, 1, 1)).toBe(0);
    expect(createDefocusDiscSiteKernel(0)).toBeNull();
    expect(defocusDiscKernelRadius(0)).toBe(0);
  });

  it("refuses a radius above the cap (512 sites since #564) with a short message, and malformed diameters", () => {
    const largest = 2 * DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES + 1;
    expect(kernel(largest).radius).toBe(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES);
    expect(requireDefocusDiscKernelRadius(largest)).toBe(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES);
    expect(() => createDefocusDiscSiteKernel(largest + 0.01)).toThrow(InvalidScientificInputError);
    expect(() => createDefocusDiscSiteKernel(2400)).toThrow("The blur circle is 2,400 sites across; the engine renders at most 1,025 sites (DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES).");
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, "3" as unknown as number])
      expect(() => createDefocusDiscSiteKernel(bad)).toThrow(InvalidScientificInputError);
  });

  it("is deterministic: identical bits on repeated calls, locked by digest", () => {
    const digest = (k: DefocusDiscSiteKernel): string => createHash("sha256").update(new Uint8Array(k.weights.buffer)).digest("hex");
    for (const diameter of DIAMETERS) expect(digest(kernel(diameter))).toBe(digest(kernel(diameter)));
    // Recorded at #492 step 1. A change here changes every defocused result: it needs a reason in the changelog.
    expect(digest(kernel(3.7))).toBe("f3d5bde4b78ac2be8d9305def509a9dfbaf6627de3d0039e5e4514cbbdfee12d");
    expect(digest(kernel(19.03))).toBe("48dd1cf2618018580f82af9052460becb3992c70535b136d4fa2e4f4c7849710");
  });

  it("resolves the blur circle from calculateDefocusCircle in micrometres and sites, zero in focus", () => {
    const optics = { focalLengthMm: 50, aperture: 2.8, focusDistanceM: 1.6, subjectDistanceM: 2 };
    const c = calculateDefocusCircle(optics).value.diameterMm * 1000;
    expect(c).toBeCloseTo(115.2, 1);
    for (const pitch of [6, 1.4]) {
      const disc = resolveDefocusDisc({ ...optics, pitchMicrometers: pitch });
      expect(disc.diameterMicrometers).toBe(c);
      expect(disc.diameterSites).toBe(c / pitch);
      expect(disc.kernelRadiusSites).toBe(defocusDiscKernelRadius(c / pitch));
    }
    expect(resolveDefocusDisc({ ...optics, pitchMicrometers: 1.4 }).kernelRadiusSites).toBe(41);
    expect(resolveDefocusDisc({ ...optics, focusDistanceM: 2, pitchMicrometers: 6 })).toEqual({ diameterMicrometers: 0, diameterSites: 0, kernelRadiusSites: 0 });
    expect(() => resolveDefocusDisc({ ...optics, pitchMicrometers: 0 })).toThrow(InvalidScientificInputError);
  });
});
