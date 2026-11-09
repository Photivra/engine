// SPDX-License-Identifier: Apache-2.0

/**
 * #580: `calculateLateralColorFringe`, the catalogue lens's red–blue displacement at a field position, in µm and pixels.
 * Checked against the lens's own model and against the lateral colour measured on the rendered charts
 * (test/simulate-capture-lens-catalogue.test.ts, docs/LENS_CATALOGUE.md "Measured on the charts").
 */
import { describe, expect, it } from "vitest";
import { calculateLateralColorFringe, GENERIC_LENS_CATALOGUE, GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM, resolveGenericLens, InvalidConfigurationError,
  InvalidScientificInputError, type LateralColorFringe } from "../src/index.js";

const FULL_FRAME = { widthMm: 36, heightMm: 24 };
/** D(λ) = (1/λ² − 1/λ_d²)/(1/λ_F² − 1/λ_C²), written out here from the Fraunhofer d, F and C lines (587.5618, 486.1327, 656.2725 nm). */
const D = (nm: number): number => (nm ** -2 - 587.5618 ** -2) / (486.1327 ** -2 - 656.2725 ** -2);

describe("calculateLateralColorFringe (#580)", () => {
  it("is the lens's L·R·H·(D(465) − D(610)) at the corner by default, in µm and pixels", () => {
    const r = calculateLateralColorFringe({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 6 });
    const lens = resolveGenericLens({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME }), R = Math.hypot(18, 12);
    expect(r.provenance.kind).toBe("approximation");
    expect(r.value.imagePointMm).toEqual({ x: 18, y: 12 });
    expect(r.value.fieldHeight).toBeCloseTo(1, 14);
    expect(r.value.channelWavelengthsNm).toEqual({ red: GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM.red, blue: GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM.blue });
    expect(r.value.fToCMicrometers).toBeCloseTo(lens.character.lateralColor.cornerMicrometers, 12);
    // Consumer baseline 0.0003 × the lens's lateralColor 1.1 = 0.00033 of R = 21.63 mm: 7.14 µm F to C, 7.24 µm blue minus red.
    const expected = 0.00033 * R * 1000 * (D(465) - D(610));
    expect(r.value.blueMinusRedMicrometers.radial).toBeCloseTo(expected, 4);
    expect(r.value.blueMinusRedMicrometers.radial).toBeCloseTo(7.24, 2);
    expect(r.value.fringeWidthPixels).toBeCloseTo(expected / 6, 4);
    expect(r.value.blueMinusRedPixels.x).toBeCloseTo(expected / 6 * 18 / R, 4);
    expect(r.value.blueMinusRedPixels.y).toBeCloseTo(expected / 6 * 12 / R, 4);
  });

  it("grows linearly with the field height, points away from the axis in every quadrant and is zero on the axis", () => {
    const at = (x: number, y: number): LateralColorFringe => calculateLateralColorFringe({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 4, fieldPosition: { x, y } }).value;
    const corner = at(1, 1), half = at(0.5, 0.5), centre = at(0, 0);
    expect(half.fringeWidthMicrometers).toBeCloseTo(corner.fringeWidthMicrometers / 2, 12);
    expect(centre).toMatchObject({ fieldHeight: 0, fringeWidthPixels: 0, blueMinusRedPixels: { radial: 0, x: 0, y: 0 } });
    for (const [x, y] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [-0.3, 0]] as const) {
      const v = at(x, y);
      expect(v.blueMinusRedMicrometers.radial).toBeGreaterThan(0);
      expect(Math.sign(v.blueMinusRedMicrometers.x)).toBe(Math.sign(x));
      expect(Math.sign(v.blueMinusRedMicrometers.y)).toBe(Math.sign(y));
    }
    // Pixels scale with 1 / pitch; µm do not.
    const fine = calculateLateralColorFringe({ lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 2 }).value;
    expect(fine.fringeWidthMicrometers).toBe(corner.fringeWidthMicrometers);
    expect(fine.fringeWidthPixels).toBeCloseTo(corner.fringeWidthPixels * 2, 12);
  });

  it("scales the lens to the sensor: on a smaller sensor the same lens's corner fringe is smaller in µm by the crop factor", () => {
    const ff = calculateLateralColorFringe({ lensId: "pv-24-1.8", activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 4 }).value;
    const aps = calculateLateralColorFringe({ lensId: "pv-24-1.8", activeImagingArea: { widthMm: 23.6, heightMm: 15.6 }, pixelPitchMicrometers: 4 }).value;
    expect(aps.fringeWidthMicrometers / ff.fringeWidthMicrometers).toBeCloseTo(Math.hypot(23.6, 15.6) / Math.hypot(36, 24), 12);
  });

  it("gives every catalogue lens a finite, positive corner fringe; the consumer set's is larger at each focal length", () => {
    const width = (id: string): number => calculateLateralColorFringe({ lensId: id, activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 4 }).value.fringeWidthPixels;
    for (const lens of GENERIC_LENS_CATALOGUE) expect(Number.isFinite(width(lens.lensId)) && width(lens.lensId) > 0, lens.lensId).toBe(true);
    expect(width("pv-24-1.8")).toBeGreaterThan(width("pv-24-1.4-pro"));
    expect(width("pv-50-1.8")).toBeGreaterThan(width("pv-50-1.2-pro"));
  });

  it("agrees with the lateral colour measured on the rendered corner edge (PV 24 1.4 Pro 0.31 px, PV 24 1.8 0.71 px at 6 µm)", () => {
    // The measure (test/simulate-capture-lens-catalogue.test.ts, "lateral colour"; measured 2026-11-07): the blue-minus-red 50 %
    // position of a near-vertical slanted edge, so the horizontal part of the displacement, in a 48-pixel region centred
    // 144 pixels in from the right and top edges of a 6000 × 4000 frame at 6 µm, minus the same at the centre.
    const fieldPosition = { x: (6000 - 144 - 3000) / 3000, y: (2000 - 144) / 2000 };
    const predicted = (id: string): number =>
      calculateLateralColorFringe({ lensId: id, activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 6, fieldPosition }).value.blueMinusRedPixels.x;
    const pro = predicted("pv-24-1.4-pro"), consumer = predicted("pv-24-1.8");
    // Model: pro 0.28 px, consumer 0.96 px. The pro lens's render matches within 0.04 px. The consumer's measured 0.71 px is
    // 0.25 px below the model: the rendered edge also carries the consumer lens's larger blur (coma and axial colour wide open),
    // the demosaic and the colour conversion, which this geometric displacement leaves out.
    expect(pro).toBeCloseTo(0.278, 2);
    expect(consumer).toBeCloseTo(0.957, 2);
    expect(Math.abs(pro - 0.31)).toBeLessThan(0.05);
    expect(Math.abs(consumer - 0.71)).toBeLessThan(0.3);
    expect(consumer).toBeGreaterThan(pro * 2);
  });

  it("refuses bad input with domain errors", () => {
    const ok = { lensId: "pv-50-1.8", activeImagingArea: FULL_FRAME, pixelPitchMicrometers: 4 };
    expect(() => calculateLateralColorFringe({ ...ok, lensId: "nope" })).toThrow(InvalidConfigurationError);
    for (const pixelPitchMicrometers of [0, -1, NaN, Infinity]) expect(() => calculateLateralColorFringe({ ...ok, pixelPitchMicrometers })).toThrow(InvalidScientificInputError);
    for (const fieldPosition of [{ x: 1.01, y: 0 }, { x: 0, y: -2 }, { x: NaN, y: 0 }]) expect(() => calculateLateralColorFringe({ ...ok, fieldPosition })).toThrow(InvalidScientificInputError);
    expect(() => calculateLateralColorFringe({ ...ok, fieldPosition: { x: 0, y: 0, z: 1 } as never })).toThrow();
    expect(() => calculateLateralColorFringe({ ...ok, fNumber: 2 } as never)).toThrow();
  });
});
