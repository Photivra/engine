// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  composeFrontOfLensFilterTransmission,
  parseFrontOfLensFilterProfile,
  resolveFrontOfLensFilterTransmission,
  type FrontOfLensFilterProfile
} from "../src/index.js";

const evidence = [{ sourceOrigin: "photivra", sourceReference: "synthetic-polarizer", reuseStatus: "photivra-owned" }] as const;

function polarizer(axisDegrees: number, k1 = 0.8, extinctionRatio = 1e6, id = "generic-polarizer"): FrontOfLensFilterProfile {
  return parseFrontOfLensFilterProfile({
    schemaVersion: "0.2.0",
    filterId: id,
    profileVersion: "1.0.0",
    identityScope: "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: { minimum: 400, maximum: 700 },
    transmission: {
      kind: "linear-polarizer",
      principalTransmittance: { value: k1, evidence },
      extinctionRatio: { value: extinctionRatio, evidence },
      transmissionAxisDegrees: axisDegrees
    },
    uncertainty: { kind: "not-quantified", limitation: "Generic educational polarizer." },
    polarizationModeled: true,
    wavelengthChangingBehaviorModeled: false,
    evidence,
    limitations: ["Synthetic polarizer."]
  });
}

function neutral(factor: number): FrontOfLensFilterProfile {
  return parseFrontOfLensFilterProfile({
    schemaVersion: "0.1.0",
    filterId: "generic-nd",
    profileVersion: "1.0.0",
    identityScope: "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: { minimum: 400, maximum: 700 },
    transmission: { kind: "neutral-linear-transmission", linearTransmissionFactor: { value: factor, evidence } },
    uncertainty: { kind: "not-quantified", limitation: "Generic." },
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled: false,
    evidence,
    limitations: ["Synthetic ND."]
  });
}

const at = { wavelengthNanometers: 550, wavelengthBasis: "air" as const };

describe("front-of-lens linear polarizer", () => {
  it("transmits (k1 + k2) / 2 of unpolarized light and polarizes it along the axis", () => {
    const result = resolveFrontOfLensFilterTransmission({ profile: polarizer(30, 0.8, 100), ...at });
    expect(result.polarizationModeled).toBe(true);
    expect(result.linearTransmissionFactor).toBeCloseTo((0.8 + 0.008) / 2, 14);
    expect(result.incidentPolarization.degreeOfLinearPolarization).toBe(0);
    expect(result.transmittedPolarization.angleDegrees).toBeCloseTo(30, 10);
    expect(result.transmittedPolarization.degreeOfLinearPolarization).toBeCloseTo((0.8 - 0.008) / (0.8 + 0.008), 12);
  });

  it("follows Malus's law for fully polarized input at all four orientations", () => {
    for (const axis of [0, 90, 180, 270]) {
      for (const delta of [0, 20, 45, 70, 90]) {
        const t = resolveFrontOfLensFilterTransmission({
          profile: polarizer(axis, 0.8, 1e6),
          ...at,
          incidentPolarization: { degreeOfLinearPolarization: 1, angleDegrees: axis + delta }
        }).linearTransmissionFactor;
        const k2 = 0.8 / 1e6;
        const c = Math.cos((delta * Math.PI) / 180) ** 2;
        expect(t).toBeCloseTo(0.8 * c + k2 * (1 - c), 12);
      }
    }
  });

  it("handles partially polarized scene light: T = (k1+k2)/2 + (k1-k2)/2 P cos 2(psi - theta)", () => {
    const k1 = 0.9;
    const k2 = 0.9 / 50;
    for (const [p, psi] of [[0.3, 10], [0.7, 80], [1, 45]] as const) {
      const t = resolveFrontOfLensFilterTransmission({ profile: polarizer(25, k1, 50), ...at, incidentPolarization: { degreeOfLinearPolarization: p, angleDegrees: psi } }).linearTransmissionFactor;
      expect(t).toBeCloseTo((k1 + k2) / 2 + ((k1 - k2) / 2) * p * Math.cos((2 * (psi - 25) * Math.PI) / 180), 13);
    }
  });

  it("composes polarizers in order with Mueller matrices (crossed polarizers extinguish, a 45-degree middle polarizer transmits 1/8)", () => {
    const crossed = composeFrontOfLensFilterTransmission({ filters: [polarizer(0, 1, 1e9), polarizer(90, 1, 1e9)], ...at });
    expect(crossed.combinedLinearTransmissionFactor).toBeLessThan(1e-8);
    expect(crossed.compositionModel).toBe("ordered-linear-stokes-mueller-no-inter-filter-reflections");
    expect(crossed.polarizationModeled).toBe(true);
    expect(crossed.schemaVersion).toBe("0.2.0");
    const three = composeFrontOfLensFilterTransmission({ filters: [polarizer(0, 1, 1e9), polarizer(45, 1, 1e9), polarizer(90, 1, 1e9)], ...at });
    // Finite extinction (k2 = 1e-9) perturbs the ideal 1/8 through the sqrt(k1 k2) Mueller terms (~1e-5).
    expect(three.combinedLinearTransmissionFactor).toBeCloseTo(1 / 8, 4);
    expect(three.transmittedPolarization.angleDegrees).toBeCloseTo(90, 2);
    // Per-component factors depend on the incoming state; the product matches the combined value.
    expect(three.components.map((c) => c.linearTransmissionFactor).reduce((a, b) => a * b, 1)).toBeCloseTo(three.combinedLinearTransmissionFactor, 14);
  });

  it("keeps non-polarizing composition identical to the unpolarized product and indifferent to input polarization", () => {
    const plain = composeFrontOfLensFilterTransmission({ filters: [neutral(0.5), neutral(0.25)], ...at });
    expect(plain.combinedLinearTransmissionFactor).toBe(0.5 * 0.25);
    expect(plain.compositionModel).toBe("independent-multiplicative-unpolarized-transmission-no-inter-filter-reflections");
    expect(plain.polarizationModeled).toBe(false);
    expect(plain.schemaVersion).toBe("0.1.0");
    const polarizedInput = composeFrontOfLensFilterTransmission({ filters: [neutral(0.5), neutral(0.25)], ...at, incidentPolarization: { degreeOfLinearPolarization: 0.6, angleDegrees: 12 } });
    expect(polarizedInput.combinedLinearTransmissionFactor).toBe(0.5 * 0.25);
    expect(polarizedInput.transmittedPolarization.degreeOfLinearPolarization).toBeCloseTo(0.6, 14);
    const ndThenPol = composeFrontOfLensFilterTransmission({ filters: [neutral(0.5), polarizer(0, 0.8, 1e6)], ...at });
    expect(ndThenPol.combinedLinearTransmissionFactor).toBeCloseTo(0.5 * 0.4, 6);
  });

  it("enforces schema/kind consistency and validates polarization inputs", () => {
    const raw = {
      schemaVersion: "0.1.0",
      filterId: "x",
      profileVersion: "1",
      identityScope: "photivra-generic-unbranded",
      position: "front-of-lens",
      scientificStatus: "approximation",
      wavelengthBasis: "air",
      wavelengthRangeNanometers: { minimum: 400, maximum: 700 },
      transmission: { kind: "linear-polarizer", principalTransmittance: { value: 0.8, evidence }, extinctionRatio: { value: 100, evidence }, transmissionAxisDegrees: 0 },
      uncertainty: { kind: "not-quantified", limitation: "x" },
      polarizationModeled: true,
      wavelengthChangingBehaviorModeled: false,
      evidence,
      limitations: ["x"]
    };
    expect(() => parseFrontOfLensFilterProfile(raw)).toThrow(/0.1.0/);
    expect(() => parseFrontOfLensFilterProfile({ ...raw, schemaVersion: "0.2.0", polarizationModeled: false })).toThrow(/polarizationModeled/);
    expect(() => parseFrontOfLensFilterProfile({ ...raw, schemaVersion: "0.2.0", transmission: { ...raw.transmission, extinctionRatio: { value: 0.5, evidence } } })).toThrow(/at least one/);
    expect(() => parseFrontOfLensFilterProfile({ ...raw, schemaVersion: "0.3.0" })).toThrow(/schemaVersion/);
    expect(() => resolveFrontOfLensFilterTransmission({ profile: polarizer(0), ...at, incidentPolarization: { degreeOfLinearPolarization: 1.5, angleDegrees: 0 } })).toThrow(/\[0, 1\]/);
    expect(() => resolveFrontOfLensFilterTransmission({ profile: polarizer(0), ...at, incidentPolarization: { degreeOfLinearPolarization: 1, angleDegrees: Number.NaN } })).toThrow(/finite/);
    expect(() => resolveFrontOfLensFilterTransmission(null as never)).toThrow(/object/);
    expect(() => composeFrontOfLensFilterTransmission(null as never)).toThrow(/object/);
  });
});

describe("polarization angles near the top of the double range (optics-23, #700)", () => {
  it("give a finite state for an incident angle or a polarizer axis of 1e308 degrees", () => {
    for (const filters of [[neutral(0.9)], [polarizer(1e308)], [polarizer(30), neutral(0.5)]]) {
      const r = composeFrontOfLensFilterTransmission({ filters, ...at, incidentPolarization: { degreeOfLinearPolarization: 0.5, angleDegrees: 1e308 } });
      for (const s of [r.incidentPolarization, r.transmittedPolarization]) {
        expect(Number.isFinite(s.degreeOfLinearPolarization)).toBe(true);
        expect(Number.isFinite(s.angleDegrees)).toBe(true);
      }
    }
    const one = resolveFrontOfLensFilterTransmission({ profile: neutral(0.9), ...at, incidentPolarization: { degreeOfLinearPolarization: 0.5, angleDegrees: 1e308 } });
    expect(Number.isFinite(one.transmittedPolarization.angleDegrees)).toBe(true);
  });

  it("treats 180 + a as a", () => {
    const at30 = resolveFrontOfLensFilterTransmission({ profile: polarizer(25), ...at, incidentPolarization: { degreeOfLinearPolarization: 0.7, angleDegrees: 30 } });
    const at210 = resolveFrontOfLensFilterTransmission({ profile: polarizer(25), ...at, incidentPolarization: { degreeOfLinearPolarization: 0.7, angleDegrees: 210 } });
    expect(at210.linearTransmissionFactor).toBeCloseTo(at30.linearTransmissionFactor, 14);
  });
});
