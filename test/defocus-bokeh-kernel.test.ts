// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateDefocusBokehKernel, calculateIdealApertureGeometry, calculateMechanicalVignetting, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions, type ResolvedDefocusBokehOptions } from "../src/optics/defocus-bokeh-kernel.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";

/*
 * #553: the shaped defocus kernel. Each test compares with an independent oracle: a closed-form polygon (point-in-polygon
 * supersampling), the engine's exact two-circle mechanical vignetting, or the analytic encircled energy of the
 * spherical-aberration ray map.
 */

const base = { fNumber: 4, focalLengthMm: 50, pitchMicrometers: 6 };
const kernel = (diameterSites: number, side: 1 | -1, options: ResolvedDefocusBokehOptions, field?: { x: number; y: number }): ReturnType<typeof createDefocusBokehSiteKernel> =>
  createDefocusBokehSiteKernel({ diameterSites, side, ...base, options, ...(field ? { field } : {}) });
const at = (k: { weights: Float64Array; radius: number; width: number }, i: number, j: number): number =>
  Math.abs(i) > k.radius || Math.abs(j) > k.radius ? 0 : k.weights[(j + k.radius) * k.width + i + k.radius]!;
const sum = (w: Float64Array): number => w.reduce((a, b) => a + b, 0);

/** Point-in-convex-polygon (counter-clockwise vertices). */
function inside(vertices: readonly { x: number; y: number }[], x: number, y: number): boolean {
  for (let k = 0; k < vertices.length; k++) {
    const a = vertices[k]!, b = vertices[(k + 1) % vertices.length]!;
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/** Second moments of a kernel about its centroid, in sites² (x right, y down). */
function moments(k: { weights: Float64Array; radius: number; width: number }): { cx: number; cy: number; xx: number; yy: number } {
  let cx = 0, cy = 0;
  for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) { const w = at(k, i, j); cx += w * i; cy += w * j; }
  let xx = 0, yy = 0;
  for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) { const w = at(k, i, j); xx += w * (i - cx) ** 2; yy += w * (j - cy) ** 2; }
  return { cx, cy, xx, yy };
}

describe("shaped defocus kernel: aperture blades (#553)", () => {
  it("has the disc's area (equal-area polygon) and the polygon's exact shape, against a supersampled closed-form polygon", () => {
    for (const count of [5, 6, 9]) {
      const c = 40, options = resolveDefocusBokehOptions({ blades: { count, firstBladeEdgeAngleDegrees: 10 } }, "test");
      const k = kernel(c, 1, options);
      expect(k.method).toBe("exact-polygon-cell-area");
      expect(Math.abs(sum(k.weights) - 1)).toBeLessThan(1e-12);
      // Area: an interior cell holds 1/area of the light; the polygon has the area of the disc of diameter c.
      expect(1 / at(k, 0, 0)).toBeCloseTo(Math.PI * (c / 2) ** 2, 6);
      // Shape: the engine's own polygon geometry, scaled to the equal area, behind focus (upright), +Y up → +Y down.
      const unit = calculateIdealApertureGeometry({ bladeCount: count, firstBladeEdgeAngleDegrees: 10 }).value.normalizedVertices;
      const scale = (c / 2) * Math.sqrt(Math.PI / (count * Math.sin(2 * Math.PI / count) / 2));
      const vertices = unit.map((v) => ({ x: v.x * scale, y: -v.y * scale })).reverse();
      const n = 16, area = Math.PI * (c / 2) ** 2;
      let worst = 0;
      for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) {
        let hits = 0;
        for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) if (inside(vertices, i - 0.5 + (a + 0.5) / n, j - 0.5 + (b + 0.5) / n)) hits++;
        worst = Math.max(worst, Math.abs(at(k, i, j) - hits / (n * n) / area));
      }
      // Supersampling resolves a boundary cell's area to about 1/16 of a cell.
      expect(worst * area).toBeLessThan(1 / 16);
    }
  });

  it("is the circle without blades (within its 1024-gon), and the circle at curvature 1 or with the blades open", () => {
    const disc = createDefocusDiscSiteKernel(30.4)!;
    for (const options of [{}, { blades: { count: 7, curvature: 1 } }, { blades: { count: 7, circularAtOrBelowFNumber: 4 } }]) {
      const k = kernel(30.4, 1, resolveDefocusBokehOptions(options, "test"));
      expect(k.radius).toBe(disc.radius);
      let worst = 0;
      for (let t = 0; t < disc.weights.length; t++) worst = Math.max(worst, Math.abs(k.weights[t]! - disc.weights[t]!));
      // The 1024-gon departs from the circle by at most 5e-6 of the radius: under 1e-4 of an interior cell's weight here.
      expect(worst).toBeLessThan(1e-4 * at(disc, 0, 0));
    }
    // Stopped down past circularAtOrBelowFNumber the polygon returns.
    const stopped = createDefocusBokehSiteKernel({ diameterSites: 30.4, side: 1, fNumber: 5.6, focalLengthMm: 50, pitchMicrometers: 6,
      options: resolveDefocusBokehOptions({ blades: { count: 7, circularAtOrBelowFNumber: 4 } }, "test") });
    expect(Math.abs(stopped.weights[0]! - disc.weights[0]!) + Math.abs(at(stopped, 15, 0) - at(disc, 15, 0))).toBeGreaterThan(1e-6);
  });

  it("rounded blades lie between the polygon and the circle", () => {
    const c = 48, extentAlong = (curvature: number, i: number, j: number): number => {
      const k = kernel(c, 1, resolveDefocusBokehOptions({ blades: { count: 6, curvature } }, "test"));
      let t = 0;
      while (at(k, Math.round(i * t), Math.round(j * t)) > 0) t++;
      return t;
    };
    // Six straight blades, first edge horizontal: flats at ±90° (y) and vertices at 0° (x), so the flat-to-vertex extent ratio grows with roundness.
    const ratios = [0, 0.6, 1].map((κ) => extentAlong(κ, 0, 1) / extentAlong(κ, 1, 0));
    expect(ratios[0]!).toBeLessThan(ratios[1]!);
    expect(ratios[1]!).toBeLessThanOrEqual(ratios[2]!);
    expect(ratios[2]!).toBeCloseTo(1, 1);
  });
});

describe("shaped defocus kernel: front against back (#553)", () => {
  it("is the same pupil turned through 180° in front of the focus plane (odd blade count)", () => {
    const options = resolveDefocusBokehOptions({ blades: { count: 5 } }, "test");
    const back = kernel(33, 1, options), front = kernel(33, -1, options);
    let worst = 0, asymmetry = 0;
    for (let j = -back.radius; j <= back.radius; j++) for (let i = -back.radius; i <= back.radius; i++) {
      worst = Math.max(worst, Math.abs(at(front, i, j) - at(back, -i, -j)));
      asymmetry = Math.max(asymmetry, Math.abs(at(back, i, j) - at(back, -i, -j)));
    }
    expect(worst).toBeLessThan(1e-15);
    // A pentagon is not point-symmetric, so the two blurs differ.
    expect(asymmetry).toBeGreaterThan(1e-4);
  });

  it("with no shape options a circular pupil gives the same blur on both sides", () => {
    const back = kernel(21, 1, {}), front = kernel(21, -1, {});
    for (let t = 0; t < back.weights.length; t++) expect(Math.abs(front.weights[t]! - back.weights[t]!)).toBeLessThan(1e-15);
  });
});

describe("shaped defocus kernel: spherical-aberration edge profile (#553)", () => {
  // c = 60 sites (a = 30), b = 0.15·a: a monotonic map on both sides (the caustic needs |b| > a/3).
  const a = 30, c = 2 * a, b = 0.15 * a;
  // W040 at the working f-number that gives b: b = 8·N·W040/pitch.
  const options = resolveDefocusBokehOptions({ sphericalAberration: { w040Micrometers: b * base.pitchMicrometers / (8 * base.fNumber), atFNumber: base.fNumber } }, "test");

  /** Analytic encircled energy of the map r = |σa·ρ + b·ρ³| for a uniform circular pupil: ρ(r)² (the pupil area inside ρ). */
  function encircled(side: 1 | -1, r: number): number {
    // Solve |σa·ρ + bρ³| = r on [0, 1] by bisection (monotonic here).
    let lo = 0, hi = 1;
    const f = (rho: number): number => Math.abs(side * a * rho + b * rho ** 3);
    if (f(1) <= r) return 1;
    for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (f(m) < r) lo = m; else hi = m; }
    return lo * lo;
  }
  /** The kernel's energy in cells whose centre lies within r. */
  function kernelEncircled(k: ReturnType<typeof kernel>, r: number): number {
    let e = 0;
    for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) if (i * i + j * j <= r * r) e += at(k, i, j);
    return e;
  }

  it("follows the ray map's encircled energy on both sides of focus", () => {
    for (const side of [1, -1] as const) {
      const k = kernel(c, side, options);
      expect(k.method).toBe("pupil-ray-binning");
      expect(k.sphericalAberrationSites).toBeCloseTo(b, 12);
      expect(Math.abs(sum(k.weights) - 1)).toBeLessThan(1e-12);
      for (const r of [5, 10, 15, 20, 25, 28]) expect(Math.abs(kernelEncircled(k, r) - encircled(side, r))).toBeLessThan(0.012);
    }
  });

  it("is soft-edged behind the focus plane and bright-rimmed in front of it for undercorrected aberration, and the reverse when overcorrected", () => {
    /** Mean weight per cell in the outer ring (0.8–0.95 of the edge radius) over the mean in the centre (radius < 0.3 of it). */
    const rim = (k: ReturnType<typeof kernel>, edge: number): number => {
      let outer = 0, no = 0, inner = 0, ni = 0;
      for (let j = -k.radius; j <= k.radius; j++) for (let i = -k.radius; i <= k.radius; i++) {
        const r = Math.hypot(i, j) / edge;
        if (r < 0.3) { inner += at(k, i, j); ni++; } else if (r > 0.8 && r < 0.95) { outer += at(k, i, j); no++; }
      }
      return (outer / no) / (inner / ni);
    };
    // The analytic intensity ratio, I(ρ) ∝ 1/(|σa + bρ²|·|σa + 3bρ²|), between ρ at 0.875 of the edge and the centre.
    const predicted = (side: 1 | -1, sign: number): number => {
      const bb = sign * b, edge = Math.abs(side * a + bb);
      let lo = 0, hi = 1;
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Math.abs(side * a * m + bb * m ** 3) < 0.875 * edge) lo = m; else hi = m; }
      return (a * a) / (Math.abs(side * a + bb * lo * lo) * Math.abs(side * a + 3 * bb * lo * lo));
    };
    const over = resolveDefocusBokehOptions({ sphericalAberration: { w040Micrometers: -options.sphericalAberration!.w040Micrometers, atFNumber: base.fNumber } }, "test");
    const cases = [{ o: options, side: 1 as const, sign: 1 }, { o: options, side: -1 as const, sign: 1 }, { o: over, side: 1 as const, sign: -1 }, { o: over, side: -1 as const, sign: -1 }];
    const measured = cases.map(({ o, side, sign }) => {
      const value = rim(kernel(c, side, o), Math.abs(side * a + sign * b));
      expect(value).toBeCloseTo(predicted(side, sign), 1);
      return value;
    });
    expect(measured[0]!).toBeLessThan(0.8); // undercorrected, behind focus: soft edge
    expect(measured[1]!).toBeGreaterThan(1.2); // undercorrected, in front: bright rim
    expect(measured[2]!).toBeGreaterThan(1.2); // overcorrected, behind: bright rim
    expect(measured[3]!).toBeLessThan(0.8); // overcorrected, in front: soft edge
  });

  it("scales W040 with the fourth power of the stop", () => {
    const at2 = resolveDefocusBokehOptions({ sphericalAberration: { w040Micrometers: 1, atFNumber: 2 } }, "test");
    const k = createDefocusBokehSiteKernel({ diameterSites: 20, side: 1, fNumber: 4, focalLengthMm: 50, pitchMicrometers: 4, options: at2 });
    expect(k.sphericalAberrationSites).toBeCloseTo(8 * 4 * (1 / 16) / 4, 14);
  });

  it("refuses a blur that spherical aberration widens past the radius cap with the disc's short message (#564: 512 sites)", () => {
    // W040 = 30·(8/4)⁴ = 480 µm at f/4, b = 8·4·480/6 = 2,560 sites: the rim reaches 60 + 2,560 sites from the centre, 5,240 across (5,241 rounded up: the 1024-gon scaled to the circle's area reaches just past ρ = 1).
    const big = resolveDefocusBokehOptions({ sphericalAberration: { w040Micrometers: 30, atFNumber: 8 } }, "test");
    expect(() => kernel(120, 1, big)).toThrow(/^The blur circle is 31\.4 mm \(5,241 sites\) across; the engine renders at most 1,025 sites \(DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES\)\.$/u);
    // Past 64 sites but within 512 the kernel is built (the renderers then decide how to convolve it).
    expect(kernel(120, 1, resolveDefocusBokehOptions({ sphericalAberration: { w040Micrometers: 20, atFNumber: 4 } }, "test")).radius).toBeGreaterThan(64);
  });
});

describe("shaped defocus kernel: cat's eye against field position (#553)", () => {
  // 50 mm f/4: entrance pupil 12.5 mm. One clipping aperture of radius 7 mm shifted 20 mm per tan θ toward the field point.
  const apertures = [{ radiusMm: 7, shiftPerTanFieldMm: 20 }];
  const options = resolveDefocusBokehOptions({ catsEye: { apertures } }, "test");

  it("clips the pupil by the open area of calculateMechanicalVignetting's exact two-circle intersection", () => {
    for (const degrees of [0, 5, 10, 15, 20, 25]) {
      const t = Math.tan(degrees * Math.PI / 180);
      for (const azimuth of [0, 40, 135]) {
        const field = { x: t * Math.cos(azimuth * Math.PI / 180), y: t * Math.sin(azimuth * Math.PI / 180) };
        const k = kernel(30, 1, options, field);
        const exact = calculateMechanicalVignetting({ entrancePupilDiameterMm: 12.5, fieldAngleDegrees: degrees, fieldAzimuthDegrees: azimuth, apertures }).value.openAreaRatio;
        expect(Math.abs(k.openAreaRatio - exact)).toBeLessThan(1e-4);
      }
    }
  });

  it("narrows the blur along the field azimuth more as the field point moves out, leaving it whole on axis", () => {
    const axis = kernel(30, 1, options), disc = createDefocusDiscSiteKernel(30)!;
    expect(axis.openAreaRatio).toBe(1);
    for (let t = 0; t < disc.weights.length; t++) expect(Math.abs(axis.weights[t]! - disc.weights[t]!)).toBeLessThan(1e-4 * at(disc, 0, 0));
    let previous = Infinity;
    for (const degrees of [5, 10, 15, 20]) {
      const k = kernel(30, 1, options, { x: Math.tan(degrees * Math.PI / 180), y: 0 }), m = moments(k);
      // Field toward +X: the clip cuts across X, so the radial spread falls below the tangential one, and keeps falling.
      expect(m.xx).toBeLessThan(m.yy);
      expect(m.xx / m.yy).toBeLessThan(previous);
      previous = m.xx / m.yy;
      // Behind focus the blur is the open pupil upright: the clip circle is shifted toward the field point, so the light that
      // remains is on the field point's side (centroid toward +X) and the image keeps that side.
      expect(m.cx).toBeGreaterThan(0);
      expect(Math.abs(m.cy)).toBeLessThan(1e-9);
      // In front of focus it is the same shape turned through 180°.
      const front = moments(kernel(30, -1, options, { x: Math.tan(degrees * Math.PI / 180), y: 0 }));
      expect(front.cx).toBeCloseTo(-m.cx, 9);
    }
  });

  it("refuses a field point where the apertures close the pupil", () => {
    expect(() => kernel(30, 1, options, { x: 2, y: 0 })).toThrow(/close the pupil/u);
  });
});

describe("calculateDefocusBokehKernel (#553)", () => {
  const input = { focalLengthMm: 50, aperture: 2.8, focusDistanceM: 1.6, subjectDistanceM: 2, pixelPitchMicrometers: 6 };
  it("returns the capture's kernel, side and size, null in focus", () => {
    const r = calculateDefocusBokehKernel({ ...input, bokeh: { blades: { count: 9 } } }).value;
    expect(r.side).toBe("behind-focus");
    expect(r.method).toBe("exact-polygon-cell-area");
    expect(r.weights!.length).toBe(r.width * r.width);
    expect(r.diameterSites).toBeCloseTo(r.diameterMicrometers / 6, 12);
    expect(calculateDefocusBokehKernel({ ...input, focusDistanceM: 2.5, bokeh: {} }).value.side).toBe("in-front-of-focus");
    const focused = calculateDefocusBokehKernel({ ...input, focusDistanceM: 2, bokeh: { blades: { count: 9 } } }).value;
    expect(focused).toMatchObject({ side: "in-focus", weights: null, kernelRadiusSites: 0, method: "none" });
  });
  it("validates its options", () => {
    expect(() => calculateDefocusBokehKernel({ ...input, bokeh: { blades: { count: 2 } } })).toThrow(InvalidScientificInputError);
    expect(() => calculateDefocusBokehKernel({ ...input, bokeh: { blades: { count: 6, curvature: 1.5 } } })).toThrow(InvalidScientificInputError);
    expect(() => calculateDefocusBokehKernel({ ...input, bokeh: { onionRings: true } as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateDefocusBokehKernel({ ...input, bokeh: { catsEye: { apertures: [] } } })).toThrow(InvalidScientificInputError);
    expect(() => calculateDefocusBokehKernel({ ...input, bokeh: { sphericalAberration: { w040Micrometers: 1 } } as never })).toThrow(InvalidScientificInputError);
  });
});
