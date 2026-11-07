// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { calculateIdealPolygonDiffractionPsf, createDiffractionLimitedPsfProfile, parseLensSampledPsfProfile, resolveLensSampledPsf,
  InvalidConfigurationError, type CreateDiffractionLimitedPsfProfileInput } from "../src/index.js";
import { AIRY_REAL_SPACE_MINIMUM_BETA, besselSquareSum, calculateAiryCellEnergies, calculateAiryCellEnergiesInFrequencyDomain,
  calculateAiryCellEnergiesInRealSpace } from "../src/optics/diffraction-psf-profile.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.js";

const base: CreateDiffractionLimitedPsfProfileInput = { aperture: "circular", focalLengthMm: 50, apertureFNumber: 8, focus: { kind: "finite", distanceM: 5 },
  wavelengthsNm: [450, 550, 650], samplePitchMicrometers: 6, kernelRadiusSamples: 3, fieldHalfExtentMm: { x: 0.2, y: 0.2 }, profileId: "test-airy" };

// Independent Airy intensity [2J1(z)/z]² from the power series of J1 (z ≤ 20 keeps the series accurate to ~1e-10).
function airyShape(z: number): number {
  let term = 1, sum = 1;
  for (let k = 1; k < 80; k++) { term *= -(z * z / 4) / (k * (k + 1)); sum += term; }
  return sum * sum;
}
// Gauss–Legendre on [-1, 1], 16 points (Newton on P16).
const GL16 = ((): { x: number[]; w: number[] } => {
  const n = 16, x: number[] = [], w: number[] = [];
  for (let k = 0; k < n; k++) {
    let t = Math.cos(Math.PI * (k + 0.75) / (n + 0.5)), d = 0;
    for (let it = 0; it < 50; it++) {
      let p0 = 1, p1 = t;
      for (let m = 2; m <= n; m++) { const p2 = ((2 * m - 1) * t * p1 - (m - 1) * p0) / m; p0 = p1; p1 = p2; }
      d = n * (t * p1 - p0) / (t * t - 1); t -= p1 / d;
    }
    x.push(t); w.push(2 / ((1 - t * t) * d * d));
  }
  return { x, w };
})();
/** Real-space cell integral of a density over the cell [i·p ± p/2] × [j·p ± p/2], split into s × s sub-cells of 16² Gauss points. */
function cellIntegral(density: (x: number, y: number) => number, i: number, j: number, p: number, s: number): number {
  let sum = 0;
  const h = p / s;
  for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) {
    const x0 = (i - 0.5) * p + (a + 0.5) * h, y0 = (j - 0.5) * p + (b + 0.5) * h;
    for (let u = 0; u < 16; u++) for (let v = 0; v < 16; v++) sum += GL16.w[u]! * GL16.w[v]! * density(x0 + GL16.x[u]! * h / 2, y0 + GL16.x[v]! * h / 2);
  }
  return sum * (h / 2) ** 2;
}

describe("createDiffractionLimitedPsfProfile", () => {
  it("builds a parseable profile: one unit-sum symmetric kernel per wavelength on one grid, with the truncated energy reported", () => {
    const result = createDiffractionLimitedPsfProfile(base), v = result.value;
    expect(result.provenance.kind).toBe("approximation");
    expect(parseLensSampledPsfProfile(v.profile)).toBeTruthy();
    expect(v.profile.responseIncludes).toEqual({ diffraction: true, aberration: false, defocus: false, pupilClippingShape: false });
    expect(v.pupilDiameterMm).toBe(50 / 8);
    expect(v.pupilToImageDistanceMm).toBeCloseTo(50 * 5000 / 4950, 12);
    expect(v.workingFNumber).toBeCloseTo(8 * 5000 / 4950, 12);
    expect(v.profile.nodes).toHaveLength(12);
    for (const node of v.profile.nodes) {
      const k = node.kernel;
      expect([k.widthSamples, k.heightSamples, k.centerSampleX, k.centerSampleY, k.samplePitchMicrometersX]).toEqual([7, 7, 3, 3, 6]);
      expect(Math.abs(k.normalizedIntensity.reduce((s, x) => s + x, 0) - 1)).toBeLessThan(1e-14);
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const value = k.normalizedIntensity[y * 7 + x]!;
        expect(value).toBeGreaterThan(0);
        expect(Math.abs(value - k.normalizedIntensity[x * 7 + y]!)).toBeLessThan(1e-15);
        expect(Math.abs(value - k.normalizedIntensity[y * 7 + 6 - x]!)).toBeLessThan(1e-15);
      }
    }
    // Longer wavelengths spread more: less energy in the centre and more outside the window.
    const w = v.wavelengths;
    expect(w[0]!.centreSampleFraction).toBeGreaterThan(w[1]!.centreSampleFraction);
    expect(w[1]!.centreSampleFraction).toBeGreaterThan(w[2]!.centreSampleFraction);
    expect(w[0]!.truncatedEnergyFraction).toBeLessThan(w[2]!.truncatedEnergyFraction);
    for (const r of w) {
      expect(r.capturedEnergyFraction + r.truncatedEnergyFraction).toBeCloseTo(1, 14);
      expect(r.firstZeroRadiusMicrometers).toBeCloseTo(1.2196698912665045 * r.wavelengthNm / 1000 * v.workingFNumber, 12);
    }
    expect(v.maximumTruncatedEnergyFraction).toBe(w[2]!.truncatedEnergyFraction);
  });

  it("gives cell energies that converge (node counts doubled) and match an independent real-space Airy integration", () => {
    for (const beta of [0.2, 1.35, 3.9]) {
      const a = calculateAiryCellEnergies(beta, 6, 1).cells, b = calculateAiryCellEnergies(beta, 6, 2).cells;
      for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(1e-13);
    }
    // f/8 at 550 nm, 6 µm cells: β = p/(λ·N_w). Density (π/4)/(λN)² · [2J1(z)/z]², z = π r/(λN), integrates to 1.
    const lambdaN = 0.55 * 8, beta = 6 / lambdaN, cells = calculateAiryCellEnergies(beta, 2).cells;
    const density = (x: number, y: number): number => Math.PI / 4 / lambdaN ** 2 * airyShape(Math.PI * Math.hypot(x, y) / lambdaN);
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1]] as const) {
      const reference = cellIntegral(density, i, j, 6, 6);
      expect(Math.abs(cells[j * 3 + i]! - reference)).toBeLessThan(2e-10);
    }
    // The engine's own polygon diffraction in its many-blade limit (equal-area circle, tolerance 1e-7 of the peak).
    const points: { x: number; y: number }[] = [];
    const h = 6 / 2;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let u = 0; u < 16; u++) for (let v = 0; v < 16; v++) {
      points.push({ x: 6 + (a - 0.5) * h + GL16.x[u]! * h / 2, y: (b - 0.5) * h + GL16.x[v]! * h / 2 });
    }
    const polygon = calculateIdealPolygonDiffractionPsf({ bladeCount: 1024, firstBladeEdgeAngleDegrees: 0, equivalentAreaPupilDiameterMm: 1,
      pupilToImageDistanceMm: lambdaN, wavelengthNm: 1000, wavelengthBasis: "vacuum", imagePointsMicrometers: points }).value.samples;
    let k = 0, sum = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let u = 0; u < 16; u++) for (let v = 0; v < 16; v++) {
      sum += GL16.w[u]! * GL16.w[v]! * polygon[k++]!.intensityDensityPerSquareMicrometer * (h / 2) ** 2;
    }
    expect(Math.abs(cells[1]! - sum)).toBeLessThan(1e-6);
  });

  it("integrates cells far larger than the pattern in real space (2.5), in agreement with the frequency domain", () => {
    // J0² + J1² from the Hankel expansion against Bessel's integral J_n(x) = (1/π)∫₀^π cos(nτ − x sin τ) dτ (DLMF 10.9.2; the periodic
    // trapezoid rule converges exponentially once the step resolves the oscillation).
    const bessel = (n: number, x: number): number => {
      const steps = 4 * Math.ceil(x) + 400;
      let sum = 0;
      for (let k = 0; k <= steps; k++) sum += (k === 0 || k === steps ? 0.5 : 1) * Math.cos(n * Math.PI * k / steps - x * Math.sin(Math.PI * k / steps));
      return sum / steps;
    };
    // From x = 300 the Hankel expansion, below it Miller's recurrence (where J0² + J1² ≥ 2/(πx)·(1 − O(1/x)) keeps the relative check meaningful).
    for (const x of [0.5, 1, 3.7, 10, 50.3, 100, 250.5, 299.9, 300, 301.7, 777.7, 2500, 12345.6]) {
      const reference = bessel(0, x) ** 2 + bessel(1, x) ** 2;
      expect(Math.abs(besselSquareSum(x) - reference) / reference, `x ${x}`).toBeLessThan(1e-11);
    }
    for (const x of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => besselSquareSum(x)).toThrow(InvalidConfigurationError);
    // Both methods where both are practical; the real-space cells converge to 1e-17 when the panel counts double.
    for (const [beta, radius] of [[32, 8], [64, 4], [96, 2], [128, 1], [160, 4], [191, 2], [192, 3], [250, 1], [300, 2], [400, 1]] as const) {
      const frequency = calculateAiryCellEnergiesInFrequencyDomain(beta, radius).cells, real = calculateAiryCellEnergiesInRealSpace(beta, radius).cells;
      const doubled = calculateAiryCellEnergiesInRealSpace(beta, radius, 2).cells;
      for (let i = 0; i < real.length; i++) {
        expect(Math.abs(real[i]! - frequency[i]!), `β ${beta} cell ${i}`).toBeLessThan(2e-12);
        expect(Math.abs(real[i]! - doubled[i]!)).toBeLessThan(1e-17);
        expect(real[i]!).toBeGreaterThan(0);
      }
    }
    // The centre cell's leakage approaches 8√2/(π³β): the Airy encircled-energy tail 1 − EE(r) ≈ 2λN/(π²r), averaged over the square's edge.
    for (const beta of [500, 2000, 8000]) {
      const centre = calculateAiryCellEnergiesInRealSpace(beta, 1).cells[0]!, leak = 8 * Math.SQRT2 / Math.PI ** 3 / beta;
      expect(Math.abs((1 - centre) / leak - 1)).toBeLessThan(50 / beta);
    }
    // The dispatcher switches at β = 32, above every β of a native pitch up to 10 µm (the shortest wavelength at f/1.4).
    expect(AIRY_REAL_SPACE_MINIMUM_BETA).toBe(32);
    expect(10 / (0.38 * 1.4)).toBeLessThan(AIRY_REAL_SPACE_MINIMUM_BETA);
    expect(calculateAiryCellEnergies(31.9, 1).realSpace).toBe(false);
    expect(calculateAiryCellEnergies(32, 1)).toMatchObject({ realSpace: true, radialNodes: 0 });
    // A 917 µm cell at f/1.4: 21 wavelengths in well under a second, all in real space.
    const profile = createDiffractionLimitedPsfProfile({ ...base, apertureFNumber: 1.4, samplePitchMicrometers: 917, kernelRadiusSamples: 1,
      wavelengthsNm: Array.from({ length: 21 }, (_, i) => 380 + 20 * i) }).value;
    expect(profile.quadrature.method).toBe("real-space-encircled-energy-gauss-legendre");
    expect(profile.quadrature.realSpaceWavelengthsNm).toHaveLength(21);
    expect(profile.quadrature.maximumRadialNodes).toBe(0);
    for (const w of profile.wavelengths) expect(w.centreSampleFraction).toBeGreaterThan(0.999);
    // Every 2.1 profile keeps its record unchanged (no realSpaceWavelengthsNm).
    expect(createDiffractionLimitedPsfProfile(base).value.quadrature).not.toHaveProperty("realSpaceWavelengthsNm");
  }, scaledTimeout(60_000));

  it("captures more energy with a larger window and sums to one over a wide window", () => {
    const captured = [0, 2, 6, 16].map((kernelRadiusSamples) => createDiffractionLimitedPsfProfile({ ...base, wavelengthsNm: [550], kernelRadiusSamples })
      .value.wavelengths[0]!.capturedEnergyFraction);
    for (let i = 1; i < captured.length; i++) expect(captured[i]!).toBeGreaterThan(captured[i - 1]!);
    expect(captured[3]!).toBeLessThan(1);
    expect(1 - captured[3]!).toBeLessThan(0.01);
  });

  it("resolves at any field point inside the declared extent with the same kernel", () => {
    const profile = createDiffractionLimitedPsfProfile(base).value.profile;
    const at = (x: number, y: number): readonly number[] => resolveLensSampledPsf({ profile, focalLengthMm: 50, focus: { kind: "finite", distanceM: 5 }, apertureFNumber: 8,
      fieldPointMm: { x, y }, wavelengthNm: 550, signedDefocusImagePlaneMicrometers: 0 }).value.kernel.normalizedIntensity;
    const node = profile.nodes.find((n) => n.coordinate.wavelengthNm === 550)!.kernel.normalizedIntensity;
    for (const [x, y] of [[0, 0], [0.13, -0.07], [-0.2, 0.2]] as const) {
      const kernel = at(x, y);
      for (let i = 0; i < node.length; i++) expect(Math.abs(kernel[i]! - node[i]!)).toBeLessThan(1e-15);
    }
  });

  it("supports infinity focus and validates its input", () => {
    const infinity = createDiffractionLimitedPsfProfile({ ...base, focus: { kind: "infinity" } }).value;
    expect(infinity.workingFNumber).toBe(8);
    expect(infinity.profile.axes.focusDiopters).toEqual([0]);
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ aperture: "hexagon" }, /aperture/], [{ apertureFNumber: 0 }, /apertureFNumber/], [{ kernelRadiusSamples: 33 }, /kernelRadiusSamples/],
      [{ kernelRadiusSamples: 1.5 }, /kernelRadiusSamples/], [{ wavelengthsNm: [550, 550] }, /increasing/], [{ wavelengthsNm: [] }, /1 to 400/],
      [{ focus: { kind: "finite" } }, /distanceM/], [{ focus: { kind: "infinity", distanceM: 2 } }, /infinity/], [{ fieldHalfExtentMm: { x: 0, y: 1 } }, /fieldHalfExtentMm/],
      [{ profileId: "bad id" }, /profileId/], [{ extra: 1 }, /Invalid diffraction/]
    ];
    for (const [patch, message] of bad) {
      expect(() => createDiffractionLimitedPsfProfile({ ...base, ...patch } as never)).toThrow(InvalidConfigurationError);
      expect(() => createDiffractionLimitedPsfProfile({ ...base, ...patch } as never)).toThrow(message);
    }
  });
});

describe("Airy cell construction (2.6): memoized, with the recorded values", () => {
  // SHA-256 of the cell bytes recorded on 2.5.0 (frequency domain below β = 192, real space from it). From β = 32 the dispatcher takes the
  // real-space cells (the fourth entry, recorded when the threshold moved; within 2e-13 of the frequency-domain cells); the
  // frequency-domain function itself still gives the 2.5.0 bytes.
  const locks: [number, number, string, string?][] = [
    [0.4, 3, "ba7fd98a848277ffa2157fad114101f3f0db92ab8d62fb0373eb30dd92e8b73f"],
    [12.5, 5, "958bf878d5802650bf06e3b4775040f4e92bfba30b7bce6d5109d46db06005ea"],
    [60, 1, "f43d3b640a66a1800a1ccd2f340e3641f07322253b373ccdadb69630050a6e0b", "22cd570511fb71f806667dd14500424af767fbf912f3864c637990bd52c5fb53"],
    [123.3, 1, "29e0dde5430f94c7914e8160d2738b499e68427d5d97a55160b6ad9e4157c16e", "0dbd2bd91626948d20d8924c6e01705c3e8dd38539d2adb92b268a2ead6e44c9"],
    [191.9, 2, "e45e23b47e8be573a39d4f484bf6cc6836118fc2e6362ff721cf521866436bdb", "13b1378c84ac2dcec94c40bcc0e7ed4aa70468c8ec5a8e54075f6c1b438cc590"],
    [250, 1, "5553c2cd9c85cd0ae2cbf7c843c15f7f916c25949de83cfe913403a24baf82d8"]];
  // #508: these were recorded on x64 and hold there. The cells use Math.cos, Math.sin and Math.asin, whose results differ by one
  // ulp between V8 on arm64 and on x64 (first at the 184th call, a Math.cos in the β = 12.5 frequency-domain cells), so on arm64
  // (Apple silicon, Linux arm64) the locks whose bytes differ are checked against their own arm64 hashes, keyed by the x64 lock
  // (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks and platforms"). β = 0.4 and the β = 60 real-space cells are the same on both.
  const arm64Locks: Readonly<Record<string, string>> = {
    "958bf878d5802650bf06e3b4775040f4e92bfba30b7bce6d5109d46db06005ea": "cd75bca6d868149b6bc0e60cdb02fec0ee7ba339c754fa61607b8d8ee4850875",
    "f43d3b640a66a1800a1ccd2f340e3641f07322253b373ccdadb69630050a6e0b": "58b554d8c64dd54b7c5a3ccd1d63956e803dcdb406d56833b84a821f224b4c56",
    "29e0dde5430f94c7914e8160d2738b499e68427d5d97a55160b6ad9e4157c16e": "17330664c435ce3655419f212cbdfae3ad66371aed9b4f25e58887ec38bcbfd7",
    "0dbd2bd91626948d20d8924c6e01705c3e8dd38539d2adb92b268a2ead6e44c9": "5e3eaca8f0d5caa4f7b1ad97a22d5a2fdfb09febcb21744cd2401820cf4a2f3f",
    "e45e23b47e8be573a39d4f484bf6cc6836118fc2e6362ff721cf521866436bdb": "164a067652403d5a1bfe3b6e5fa4d6d8fb92c32bea3d891a295f17496f95db36",
    "13b1378c84ac2dcec94c40bcc0e7ed4aa70468c8ec5a8e54075f6c1b438cc590": "d41e7fe1702d8e7509e322939362519f5f853b96dac438bdd1acdd97436a1472",
    "5553c2cd9c85cd0ae2cbf7c843c15f7f916c25949de83cfe913403a24baf82d8": "20533b85ba222932461efac21f9aba24d384fce2424b25ac43a6e75047414715"};
  const sha = (cells: Float64Array): string => createHash("sha256").update(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength)).digest("hex");

  it("gives the recorded cell bytes, first built and then from the cache", () => {
    for (const [beta, radius, x64Recorded, x64Dispatched] of locks) {
      const recorded = hashLockOnThisArchitecture(x64Recorded, arm64Locks), dispatched = x64Dispatched && hashLockOnThisArchitecture(x64Dispatched, arm64Locks);
      if (dispatched) expect(sha(calculateAiryCellEnergiesInFrequencyDomain(beta, radius).cells)).toBe(recorded);
      const lock = dispatched ?? recorded;
      const direct = beta >= AIRY_REAL_SPACE_MINIMUM_BETA ? calculateAiryCellEnergiesInRealSpace(beta, radius).cells : calculateAiryCellEnergiesInFrequencyDomain(beta, radius).cells;
      expect(sha(direct)).toBe(lock);
      const first = calculateAiryCellEnergies(beta, radius), second = calculateAiryCellEnergies(beta, radius);
      expect([sha(first.cells), sha(second.cells)]).toEqual([lock, lock]);
      expect(second).toEqual(first);
    }
  }, scaledTimeout(60_000));

  it("hands out copies, so a caller cannot change later results", () => {
    const first = calculateAiryCellEnergies(33.3, 2), kept = first.cells.slice();
    first.cells.fill(7);
    expect(Array.from(calculateAiryCellEnergies(33.3, 2).cells)).toEqual(Array.from(kept));
  });

  it("builds a repeated profile from the cache in a fraction of the first build's time", () => {
    const input = { aperture: "circular" as const, focalLengthMm: 50, apertureFNumber: 16, focus: { kind: "finite" as const, distanceM: 4.2 },
      wavelengthsNm: Array.from({ length: 20 }, (_, k) => 390 + 20 * k), samplePitchMicrometers: 517, kernelRadiusSamples: 1, fieldHalfExtentMm: { x: 1, y: 1 }, profileId: "cache-test" };
    let started = performance.now();
    const first = createDiffractionLimitedPsfProfile(input);
    const firstMs = performance.now() - started;
    started = performance.now();
    const second = createDiffractionLimitedPsfProfile(input);
    const secondMs = performance.now() - started;
    expect(second).toEqual(first);
    expect(secondMs).toBeLessThan(firstMs / 4);
  }, scaledTimeout(60_000));
});
