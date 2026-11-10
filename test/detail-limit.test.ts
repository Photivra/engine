// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { calculateDetailLimit, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
import { detailLimitOpticsMtf, type DetailLimitWavefront } from "../src/optics/detail-limit.js";

const FULL_FRAME_24MP = { widthMm: 36, heightMm: 24, pixelWidth: 6000 };
const NONE: DetailLimitWavefront = { defocus: 0, spherical: 0, coma: 0, astigmatism: 0, fieldCurvature: 0 };

/** Independent brute-force |OTF|: midpoint grid over the square, both pupil discs masked (edge error about 1/grid). */
function bruteForceMtf(w: DetailLimitWavefront, s: number, tangential: boolean, grid: number): number {
  const W = (x: number, y: number): number => {
    const r2 = x * x + y * y;
    return (w.defocus + w.fieldCurvature) * r2 + w.spherical * r2 * r2 + w.coma * r2 * y + w.astigmatism * y * y;
  };
  let re = 0, im = 0;
  const h = 2 / grid;
  for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
    const x = -1 + (i + 0.5) * h, y = -1 + (j + 0.5) * h;
    const [ax, ay, bx, by] = tangential ? [x, y + s, x, y - s] : [x + s, y, x - s, y];
    if (ax * ax + ay * ay > 1 || bx * bx + by * by > 1) continue;
    const phase = 2 * Math.PI * (W(ax, ay) - W(bx, by));
    re += Math.cos(phase) * h * h;
    im += Math.sin(phase) * h * h;
  }
  return Math.hypot(re, im) / Math.PI;
}

describe("calculateDetailLimit (#575)", () => {
  it("a small aperture is diffraction-limited", () => {
    const r = calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 22 });
    expect(r.value.limitedBy).toBe("lens");
    expect(r.value.limitingFactor).toBe("diffraction");
    // MTF50 of the diffraction-limited OTF: 0.40397 · 1/(λN) = 0.40397 / (0.00055 mm · 22) ≈ 33.39 cycles/mm.
    expect(r.value.optics.mtf50CyclesPerMm).toBeCloseTo(0.403973 / (0.00055 * 22), 3);
    expect(r.value.optics.diffractionMtf50CyclesPerMm).toBeCloseTo(r.value.optics.mtf50CyclesPerMm, 9);
    expect(r.value.sampling.nyquistCyclesPerMm).toBeCloseTo(1000 / 12, 9);
    expect(r.value.opticsToNyquistRatio).toBeLessThan(1);
    expect(r.value.optics.mtfAtNyquist).toBe(0); // the Nyquist frequency lies beyond the cut-off 82.6 cycles/mm
    expect(r.provenance.kind).toBe("approximation");
    // A catalogue lens stopped down to f/22 is diffraction-limited too: its aberrations scale with the pupil.
    const pro = calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "catalogue", lensId: "pv-50-1.2-pro" }, fNumber: 22, fieldPosition: 1 });
    expect(pro.value.limitingFactor).toBe("diffraction");
    expect(pro.value.optics.withinMarechalCriterion).toBe(true);
  });

  it("a high-resolution sensor with a soft lens is lens-limited (aberrations)", () => {
    const r = calculateDetailLimit({ sensor: { widthMm: 36, heightMm: 24, pixelWidth: 9504 }, lens: { kind: "catalogue", lensId: "pv-600-6.3" },
      fNumber: 6.3, fieldPosition: 1 });
    expect(r.value.limitedBy).toBe("lens");
    expect(r.value.limitingFactor).toBe("aberrations");
    expect(r.value.optics.rmsWavefrontErrorWaves.aberrations).toBeGreaterThan(1 / 14);
    expect(r.value.optics.mtf50CyclesPerMm).toBeLessThan(0.5 * r.value.optics.diffractionMtf50CyclesPerMm);
    expect(r.value.optics.mtf50CyclesPerMm).toBeLessThan(r.value.sampling.nyquistCyclesPerMm / 4);
    // Off axis the two directions differ (coma and astigmatism).
    expect(r.value.optics.tangentialMtf50CyclesPerMm).not.toBeCloseTo(r.value.optics.sagittalMtf50CyclesPerMm, 3);
  });

  it("a low-resolution sensor with a sharp lens is pixel-limited", () => {
    const r = calculateDetailLimit({ sensor: { widthMm: 36, heightMm: 24, pixelWidth: 3000 }, lens: { kind: "catalogue", lensId: "pv-50-1.2-pro" }, fNumber: 5.6 });
    expect(r.value.limitedBy).toBe("sensor");
    expect(r.value.limitingFactor).toBe("pixel-pitch");
    expect(r.value.opticsToNyquistRatio).toBeGreaterThan(3);
    expect(r.value.sampling.pixelPitchMicrometers).toBeCloseTo(12, 12);
    expect(r.value.sampling.redBlueNyquistCyclesPerMm).toBeCloseTo(r.value.sampling.nyquistCyclesPerMm / 2, 12);
    expect(r.value.sampling.pixelApertureMtfAtNyquist).toBeCloseTo(2 / Math.PI, 15);
    expect(r.value.system.mtfAtNyquist).toBeCloseTo(r.value.optics.mtfAtNyquist * 2 / Math.PI, 15);
    expect(r.value.system.mtf50LinePairsPerPictureHeight).toBeCloseTo(r.value.system.mtf50CyclesPerMm * 24, 9);
    const mono = calculateDetailLimit({ sensor: { widthMm: 36, heightMm: 24, pixelWidth: 3000, colorFilterArray: "none" }, lens: { kind: "catalogue", lensId: "pv-50-1.2-pro" }, fNumber: 5.6 });
    expect(mono.value.sampling.redBlueNyquistCyclesPerMm).toBeNull();
    // docs/USAGE.md: the professional 50 mm at f/4 on 6 µm pixels.
    expect(calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "catalogue", lensId: "pv-50-1.2-pro" }, fNumber: 4 }).value.limitingFactor).toBe("pixel-pitch");
  });

  it("a subject off the focus distance is defocus-limited", () => {
    const r = calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 2, focus: { focusDistanceM: 3, subjectDistanceM: 2.5 } });
    expect(r.value.limitingFactor).toBe("defocus");
    // Thin-lens blur circle f²|s − d|/(N d (s − f)) of calculateDefocusCircle.
    expect(r.value.optics.defocusBlurDiameterMm).toBeCloseTo((50 * 50 * 500) / (2 * 2500 * 2950), 12);
    expect(r.value.optics.rmsWavefrontErrorWaves.aberrations).toBe(0);
    // In focus the same setting is pixel-limited.
    expect(calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 2, focus: { focusDistanceM: 3 } }).value.limitingFactor)
      .toBe("pixel-pitch");
  });

  it("switches from the pixel pitch to diffraction at the diffraction-limited f-number", () => {
    const base = { sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 } as const };
    const nDl = calculateDetailLimit({ ...base, fNumber: 8 }).value.diffractionLimitedFNumber;
    expect(nDl).toBeCloseTo(2 * 0.006 * 0.403973 / 0.00055, 3); // ≈ f/8.81 on 6 µm pixels at 550 nm
    expect(calculateDetailLimit({ ...base, fNumber: nDl * 0.999 }).value.limitedBy).toBe("sensor");
    expect(calculateDetailLimit({ ...base, fNumber: nDl * 1.001 }).value.limitingFactor).toBe("diffraction");
  });

  it("matches an independent brute-force OTF and converges under doubled nodes", () => {
    const cases: [DetailLimitWavefront, number, boolean][] = [
      [NONE, 0.3, true],
      [{ ...NONE, defocus: 0.5 }, 0.2, true],
      [{ ...NONE, spherical: 0.4, defocus: -0.4 }, 0.25, false],
      [{ ...NONE, coma: 0.6 }, 0.15, true],
      [{ ...NONE, coma: 0.6 }, 0.15, false],
      [{ ...NONE, astigmatism: 0.5, fieldCurvature: 0.2 }, 0.2, true],
      [{ ...NONE, defocus: 20 }, 0.4, true]
    ];
    for (const [w, s, t] of cases) {
      const value = detailLimitOpticsMtf(w, s, t);
      expect(Math.abs(value - detailLimitOpticsMtf(w, s, t, 2))).toBeLessThan(1e-9);
      expect(Math.abs(value - bruteForceMtf(w, s, t, 500))).toBeLessThan(3e-3);
    }
    // With no wavefront the quadrature path (a negligible wavefront) reproduces the closed form.
    const s = 0.37, closed = (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s));
    expect(Math.abs(detailLimitOpticsMtf({ ...NONE, defocus: 1e-12 }, s, true) - closed)).toBeLessThan(1e-12);
  });

  it("aberrations never raise the MTF above the diffraction limit", () => {
    for (const lensId of ["pv-16-1.8-pro", "pv-35-1.8", "pv-85-1.2-pro"]) for (const fieldPosition of [0, 0.5, 1]) {
      const r = calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "catalogue", lensId }, fNumber: 2.8, fieldPosition }).value;
      expect(r.optics.mtf50CyclesPerMm).toBeLessThanOrEqual(r.optics.diffractionMtf50CyclesPerMm * (1 + 1e-9));
      for (const value of [r.optics.mtf50CyclesPerMm, r.optics.mtfAtNyquist, r.system.mtf50CyclesPerMm, r.opticsToNyquistRatio]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("stays fast at the largest wavefront", () => {
    const start = performance.now();
    // About 60 waves of defocus (W020 = 2√3 × the defocus RMS), near the 64-wave limit.
    const r = calculateDetailLimit({ sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 2, focus: { focusDistanceM: 3, subjectDistanceM: 1.35 } });
    expect(r.value.limitingFactor).toBe("defocus");
    expect(r.value.optics.rmsWavefrontErrorWaves.defocus * 2 * Math.sqrt(3)).toBeGreaterThan(55);
    // The quadrature still converges at the highest phase variation it accepts: 64 waves near the cut-off.
    const w = { ...NONE, defocus: 64 };
    expect(Math.abs(detailLimitOpticsMtf(w, 0.9, true) - detailLimitOpticsMtf(w, 0.9, true, 1.5))).toBeLessThan(1e-9);
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it("refuses invalid input with domain errors", () => {
    const ok = { sensor: FULL_FRAME_24MP, lens: { kind: "ideal", focalLengthMm: 50 } as const, fNumber: 8 };
    expect(() => calculateDetailLimit({ ...ok, lens: { kind: "zoom" } as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateDetailLimit({ ...ok, sensor: { ...FULL_FRAME_24MP, colorFilterArray: "xtrans" as never } })).toThrow(InvalidConfigurationError);
    expect(() => calculateDetailLimit({ ...ok, sensor: { ...FULL_FRAME_24MP, pitch: 1 } as never })).toThrow(InvalidConfigurationError);
    expect(() => calculateDetailLimit({ ...ok, fNumber: 0 })).toThrow(InvalidScientificInputError);
    expect(() => calculateDetailLimit({ ...ok, fieldPosition: 1.5 })).toThrow(InvalidScientificInputError);
    expect(() => calculateDetailLimit({ ...ok, wavelengthNm: 1000 })).toThrow(InvalidScientificInputError);
    expect(() => calculateDetailLimit({ ...ok, focus: { focusDistanceM: 0.04 } })).toThrow(InvalidScientificInputError);
    expect(() => calculateDetailLimit({ ...ok, lens: { kind: "catalogue", lensId: "pv-50-1.8" }, fNumber: 1.4 })).toThrow(InvalidScientificInputError);
    expect(() => calculateDetailLimit({ ...ok, fNumber: 1.4, focus: { focusDistanceM: 3, subjectDistanceM: 1 } })).toThrow(/geometric/u);
  });
});
