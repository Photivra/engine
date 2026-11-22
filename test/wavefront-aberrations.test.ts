// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  FRAUNHOFER_C_LINE_NM,
  FRAUNHOFER_D_LINE_NM,
  FRAUNHOFER_F_LINE_NM,
  calculateCauchyRefractiveIndex,
  calculateDefocusCircle,
  calculateDefocusWavefront,
  calculateLensComplexPupilPsf,
  calculateLongitudinalChromaticFocus,
  calculateThinLensImageDistance,
  createWavefrontPupilGrid,
  estimateMarechalStrehlRatio,
  evaluateZernikePolynomial,
  resolveZernikeNollOrder,
  type LensComplexPupilGrid
} from "../src/index.js";
import { InvalidConfigurationError } from "../src/core/configuration-error.js";
import { complexPupilProfileForGrid } from "./helpers/complex-pupil-profile.js";

const PUPIL_MM = 12.5; // f = 50 mm at f/4
const SAMPLES = 31;

function centreIntensity(grid: LensComplexPupilGrid, wavelengthNm = 550): number {
  const psf = calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid(grid, { wavelengthNm }) }).value.kernel;
  return psf.normalizedIntensity[psf.centerSampleY * psf.widthSamples + psf.centerSampleX]!;
}

describe("Zernike (Noll) wavefront parameterisation", () => {
  it("maps Noll indices to (n, m) per Noll 1976", () => {
    const expected: [number, number, number][] = [
      [1, 0, 0], [2, 1, 1], [3, 1, -1], [4, 2, 0], [5, 2, -2], [6, 2, 2], [7, 3, -1], [8, 3, 1],
      [9, 3, -3], [10, 3, 3], [11, 4, 0], [12, 4, 2], [13, 4, -2], [14, 4, 4], [15, 4, -4], [22, 6, 0], [37, 8, 0]
    ];
    for (const [j, n, m] of expected) {
      const order = resolveZernikeNollOrder(j);
      expect([order.radialOrder, order.azimuthalFrequency]).toEqual([n, m]);
    }
    expect(() => resolveZernikeNollOrder(0)).toThrow(/nollIndex/);
    expect(() => resolveZernikeNollOrder(67)).toThrow(/nollIndex/);
    expect(() => resolveZernikeNollOrder(2.5)).toThrow(/nollIndex/);
  });

  it("matches the closed-form low-order polynomials", () => {
    const rho = 0.73;
    const theta = 0.41;
    expect(evaluateZernikePolynomial(4, rho, theta)).toBeCloseTo(Math.sqrt(3) * (2 * rho * rho - 1), 13);
    expect(evaluateZernikePolynomial(6, rho, theta)).toBeCloseTo(Math.sqrt(6) * rho * rho * Math.cos(2 * theta), 13);
    expect(evaluateZernikePolynomial(7, rho, theta)).toBeCloseTo(Math.sqrt(8) * (3 * rho ** 3 - 2 * rho) * Math.sin(theta), 13);
    expect(evaluateZernikePolynomial(8, rho, theta)).toBeCloseTo(Math.sqrt(8) * (3 * rho ** 3 - 2 * rho) * Math.cos(theta), 13);
    expect(evaluateZernikePolynomial(11, rho, theta)).toBeCloseTo(Math.sqrt(5) * (6 * rho ** 4 - 6 * rho ** 2 + 1), 13);
    expect(() => evaluateZernikePolynomial(4, 1.1, 0)).toThrow(/\[0, 1\]/);
  });

  it("is orthonormal over the unit disk (numerical quadrature, j <= 15)", () => {
    const radial = 200;
    const angular = 48;
    // Tabulate each polynomial once on a midpoint polar grid, then form inner products.
    const tables: number[][] = [];
    for (let j = 1; j <= 15; j += 1) {
      const values: number[] = [];
      for (let a = 0; a < radial; a += 1) {
        const rho = (a + 0.5) / radial;
        for (let b = 0; b < angular; b += 1) {
          values.push(evaluateZernikePolynomial(j, rho, (2 * Math.PI * (b + 0.5)) / angular) * Math.sqrt(rho));
        }
      }
      tables.push(values);
    }
    for (let i = 0; i < 15; i += 1) {
      for (let j = i; j < 15; j += 1) {
        let sum = 0;
        for (let k = 0; k < tables[i]!.length; k += 1) sum += tables[i]![k]! * tables[j]![k]!;
        const inner = (sum * (1 / radial) * ((2 * Math.PI) / angular)) / Math.PI;
        expect(Math.abs(inner - (i === j ? 1 : 0))).toBeLessThan(5e-4);
      }
    }
  });

  it("zero coefficients reproduce the existing aberration-free circular-pupil PSF exactly", () => {
    const generated = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, zernikeCoefficients: [{ nollIndex: 4, coefficientMicrometers: 0 }] }).value;
    expect(generated.grid.opticalPathDifferenceMicrometers.every((v) => v === 0)).toBe(true);
    const pitch = PUPIL_MM / (SAMPLES - 1);
    const c = (SAMPLES - 1) / 2;
    const handAmplitude: number[] = [];
    for (let y = 0; y < SAMPLES; y += 1) {
      for (let x = 0; x < SAMPLES; x += 1) {
        handAmplitude.push(Math.hypot((x - c) * pitch, (y - c) * pitch) <= PUPIL_MM / 2 ? 1 : 0);
      }
    }
    expect(generated.grid.relativeAmplitude).toEqual(handAmplitude);
    const hand: LensComplexPupilGrid = { ...generated.grid, relativeAmplitude: handAmplitude, opticalPathDifferenceMicrometers: new Array<number>(SAMPLES * SAMPLES).fill(0) };
    const a = calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid(generated.grid) }).value.kernel;
    const b = calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid(hand) }).value.kernel;
    expect(a).toEqual(b);
    expect(generated.zernikeRmsMicrometers).toBe(0);
  });

  it("follows the Marechal approximation exp(-(2 pi sigma / lambda)^2) for small RMS error", () => {
    const ideal = centreIntensity(createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES }).value.grid);
    for (const [j, c] of [[11, 0.03], [6, 0.035], [8, 0.025], [4, 0.04]] as const) {
      const aberrated = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, zernikeCoefficients: [{ nollIndex: j, coefficientMicrometers: c }] }).value;
      // Discrete sampling keeps the RMS close to the unit-RMS coefficient.
      expect(aberrated.sampledRmsMicrometers / c).toBeGreaterThan(0.95);
      expect(aberrated.sampledRmsMicrometers / c).toBeLessThan(1.05);
      const strehl = centreIntensity(aberrated.grid) / ideal;
      const marechal = estimateMarechalStrehlRatio({ rmsWavefrontErrorMicrometers: aberrated.sampledRmsMicrometers, wavelengthNm: 550 }).value.strehlRatio;
      expect(Math.abs(strehl - marechal)).toBeLessThan(0.01);
      expect(strehl).toBeLessThan(1);
    }
  });

  it("links Z4 defocus to the engine's thin-lens defocus geometry", () => {
    const f = 50;
    const n = 4;
    const focus = 5;
    const subject = 3;
    const vFocus = calculateThinLensImageDistance({ focalLengthMm: f, objectDistanceM: focus }).value.imageDistanceMm;
    const vSubject = calculateThinLensImageDistance({ focalLengthMm: f, objectDistanceM: subject }).value.imageDistanceMm;
    const pupil = f / n;
    const workingF = vSubject / pupil;
    const wave = calculateDefocusWavefront({ signedDefocusImagePlaneMicrometers: (vFocus - vSubject) * 1000, workingFNumber: workingF }).value;
    expect(wave.zernikeZ4Micrometers).toBeCloseTo(wave.w020Micrometers / (2 * Math.sqrt(3)), 15);
    // Transverse ray aberration of W020 rho^2 at the pupil edge: eps = 4 N W020 equals the geometric blur radius.
    const blurRadiusMm = (4 * workingF * wave.w020Micrometers) / 1000;
    const engine = calculateDefocusCircle({ focalLengthMm: f, aperture: n, focusDistanceM: focus, subjectDistanceM: subject }).value.diameterMm;
    expect(Math.abs(blurRadiusMm)).toBeCloseTo(engine / 2, 12);
    // The same defocus through the longitudinal-CA path at the reference wavelength.
    const lca = calculateLongitudinalChromaticFocus({ focalLengthMm: f, referenceWavelengthNm: 550, wavelengthNm: 550, apertureFNumber: n, focusDistanceM: focus, subjectDistanceM: subject, dispersion: { kind: "thin-singlet-abbe", refractiveIndexD: 1.5, abbeNumberD: 60 } }).value;
    expect(lca.geometricBlurDiameterMm).toBeCloseTo(engine, 12);
    expect(lca.zernikeZ4Micrometers).toBeCloseTo(wave.zernikeZ4Micrometers, 12);
  });

  it("small Z4 defocus gives Strehl 1 - (2 pi c4 / lambda)^2 to leading order and a symmetric PSF in its sign", () => {
    const ideal = centreIntensity(createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES }).value.grid);
    const c4 = 0.02;
    const plus = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, seidelCoefficients: { w020Micrometers: 2 * Math.sqrt(3) * c4 } }).value;
    const minus = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, seidelCoefficients: { w020Micrometers: -2 * Math.sqrt(3) * c4 } }).value;
    const strehl = centreIntensity(plus.grid) / ideal;
    expect(Math.abs(strehl - (1 - (2 * Math.PI * plus.sampledRmsMicrometers / 0.55) ** 2))).toBeLessThan(2e-3);
    expect(centreIntensity(minus.grid)).toBeCloseTo(centreIntensity(plus.grid), 14);
  });

  it("orients field-dependent Seidel terms with the field azimuth (four orientations)", () => {
    const base = { pupilDiameterMm: PUPIL_MM, samplesAcross: 15, seidelCoefficients: { w131Micrometers: 0.3, w222Micrometers: 0.2 } };
    const grids = [0, 90, 180, 270].map((azimuth) => createWavefrontPupilGrid({ ...base, seidelField: { normalizedFieldHeight: 0.8, fieldAzimuthDegrees: azimuth } }).value.grid);
    const n = 15;
    const at = (grid: LensComplexPupilGrid, x: number, y: number): number => grid.opticalPathDifferenceMicrometers[y * n + x]!;
    for (let quarter = 1; quarter < 4; quarter += 1) {
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          // Rotate pupil sample (x, y) about the centre by quarter * 90 degrees counter-clockwise.
          let rx = x - 7;
          let ry = y - 7;
          for (let k = 0; k < quarter; k += 1) [rx, ry] = [-ry, rx];
          expect(at(grids[quarter]!, rx + 7, ry + 7)).toBeCloseTo(at(grids[0]!, x, y), 12);
        }
      }
    }
    // Coma at azimuth 0 is odd in x and even in y.
    expect(at(grids[0]!, 10, 7)).toBeCloseTo(0.3 * 0.8 * (3 / 7) ** 3 + 0.2 * 0.64 * (3 / 7) ** 2, 12);
    expect(() => createWavefrontPupilGrid(base)).toThrow(/seidelField/);
  });

  it("applies an aperture mask and validates inputs", () => {
    const square = [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }];
    const masked = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, apertureMaskVerticesMm: square }).value;
    const full = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES }).value;
    expect(masked.openSampleCount).toBeLessThan(full.openSampleCount);
    expect(() => createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 32 })).toThrow(/odd/);
    expect(() => createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 65 })).toThrow(/odd/);
    expect(() => createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 5, zernikeCoefficients: [{ nollIndex: 4, coefficientMicrometers: 1 }, { nollIndex: 4, coefficientMicrometers: 1 }] })).toThrow(/repeat/);
    expect(() => createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 5, seidelCoefficients: { w999Micrometers: 1 } as never })).toThrow(/not supported/);
    expect(() => createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 5, apertureMaskVerticesMm: [{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 100, y: 101 }] })).toThrow(/no open/);
    expect(() => createWavefrontPupilGrid(null as never)).toThrow(/object/);
    expect(() => estimateMarechalStrehlRatio({ rmsWavefrontErrorMicrometers: -1, wavelengthNm: 500 })).toThrow(/non-negative/);
    expect(() => calculateDefocusWavefront({ signedDefocusImagePlaneMicrometers: Number.NaN, workingFNumber: 2 })).toThrow(/finite/);
  });
});

describe("longitudinal chromatic aberration", () => {
  // Synthetic glass (n_d = 1.5, V_d = 60), not catalogue data.
  const glass = { kind: "thin-singlet-abbe" as const, refractiveIndexD: 1.5, abbeNumberD: 60 };

  it("fits the two-term Cauchy dispersion exactly to n_d and V_d", () => {
    const n = (wavelengthNm: number): number => calculateCauchyRefractiveIndex({ refractiveIndexD: 1.5, abbeNumberD: 60, wavelengthNm }).value.refractiveIndex;
    expect(n(FRAUNHOFER_D_LINE_NM)).toBeCloseTo(1.5, 14);
    expect((n(FRAUNHOFER_D_LINE_NM) - 1) / (n(FRAUNHOFER_F_LINE_NM) - n(FRAUNHOFER_C_LINE_NM))).toBeCloseTo(60, 10);
    expect(n(450)).toBeGreaterThan(n(650));
    expect(() => n(300)).toThrow(/360-830/);
  });

  it("gives the classical singlet secondary focal difference f_C - f_F ~ f / V", () => {
    const at = (wavelengthNm: number): number => calculateLongitudinalChromaticFocus({ focalLengthMm: 100, referenceWavelengthNm: FRAUNHOFER_D_LINE_NM, wavelengthNm, apertureFNumber: 4, focusDistanceM: 1e6, dispersion: glass }).value.focalLengthAtWavelengthMm;
    const difference = at(FRAUNHOFER_C_LINE_NM) - at(FRAUNHOFER_F_LINE_NM);
    expect(difference / (100 / 60)).toBeGreaterThan(0.98);
    expect(difference / (100 / 60)).toBeLessThan(1.02);
  });

  it("has zero defocus at the reference wavelength in the focus plane and grows away from it", () => {
    const at = (wavelengthNm: number): ReturnType<typeof calculateLongitudinalChromaticFocus>["value"] => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm, apertureFNumber: 2, focusDistanceM: 3, dispersion: glass }).value;
    expect(at(550).signedDefocusImagePlaneMicrometers).toBe(0);
    expect(at(550).geometricBlurDiameterMm).toBe(0);
    // Blue focuses shorter: the image lies in front of the sensor (positive defocus); red behind.
    expect(at(450).signedDefocusImagePlaneMicrometers).toBeGreaterThan(0);
    expect(at(650).signedDefocusImagePlaneMicrometers).toBeLessThan(0);
    expect(at(450).geometricBlurDiameterMm).toBeGreaterThan(at(500).geometricBlurDiameterMm);
  });

  it("feeds per-wavelength defocus into the complex-pupil PSF (Strehl drops away from the reference)", () => {
    const strehlAt = (wavelengthNm: number): number => {
      // Achromat-like secondary spectrum (a singlet defocuses far beyond the small-aberration regime).
      const dispersion = { kind: "declared-focal-shift" as const, samples: [{ wavelengthNm: 450, focalLengthShiftMicrometers: 20 }, { wavelengthNm: 550, focalLengthShiftMicrometers: 0 }, { wavelengthNm: 650, focalLengthShiftMicrometers: 15 }] };
      const focus = calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm, apertureFNumber: 4, focusDistanceM: 1e5, dispersion }).value;
      const ideal = centreIntensity(createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES }).value.grid, wavelengthNm);
      const aberrated = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: SAMPLES, zernikeCoefficients: [{ nollIndex: 4, coefficientMicrometers: focus.zernikeZ4Micrometers }] }).value;
      return centreIntensity(aberrated.grid, wavelengthNm) / ideal;
    };
    expect(strehlAt(550)).toBeCloseTo(1, 14);
    expect(strehlAt(450)).toBeLessThan(strehlAt(500));
    expect(strehlAt(500)).toBeLessThan(1);
    expect(strehlAt(650)).toBeLessThan(1);
  });

  it("re-references a declared focal-shift table and refuses extrapolation", () => {
    const dispersion = { kind: "declared-focal-shift" as const, samples: [{ wavelengthNm: 450, focalLengthShiftMicrometers: 30 }, { wavelengthNm: 550, focalLengthShiftMicrometers: 10 }, { wavelengthNm: 650, focalLengthShiftMicrometers: 20 }] };
    const result = calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500, apertureFNumber: 2, focusDistanceM: 3, dispersion }).value;
    expect(result.focalShiftMicrometers).toBeCloseTo(10, 9);
    expect(() => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 700, apertureFNumber: 2, focusDistanceM: 3, dispersion })).toThrow(/extrapolation/);
    expect(() => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500, apertureFNumber: 2, focusDistanceM: 3, dispersion: { kind: "declared-focal-shift", samples: [{ wavelengthNm: 600, focalLengthShiftMicrometers: 0 }, { wavelengthNm: 500, focalLengthShiftMicrometers: 0 }] } })).toThrow(/increasing/);
    expect(() => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500, apertureFNumber: 2, focusDistanceM: 3, dispersion: { kind: "prism" } as never })).toThrow(/kind/);
    expect(() => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500, apertureFNumber: 2, focusDistanceM: 3, dispersion: { kind: "thin-singlet-abbe", refractiveIndexD: 0.9, abbeNumberD: 50 } })).toThrow(/refractiveIndexD/);
    expect(() => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500, apertureFNumber: 2, focusDistanceM: 0.01, dispersion: glass })).toThrow(/beyond/);
    expect(() => calculateLongitudinalChromaticFocus(null as never)).toThrow(/object/);
  });
});

describe("complex-pupil PSF grid centre (optics-14, #700)", () => {
  const grid = createWavefrontPupilGrid({ pupilDiameterMm: PUPIL_MM, samplesAcross: 15 }).value.grid;
  const kernelFor = (centerSampleX: number): ReturnType<typeof calculateLensComplexPupilPsf>["value"]["kernel"] =>
    calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid({ ...grid, centerSampleX }) }).value.kernel;

  it("keeps a grid centred within one sample of its middle unchanged and symmetric", () => {
    const k = kernelFor(7);
    expect(k.centerSampleX).toBe(14);
    for (const c of [6, 8]) expect(() => kernelFor(c)).not.toThrow();
  });

  it("rejects a pupil grid centre more than one sample from the middle of the grid", () => {
    for (const c of [0, 3, 5, 9, 14]) expect(() => kernelFor(c)).toThrow(InvalidConfigurationError);
  });
});
