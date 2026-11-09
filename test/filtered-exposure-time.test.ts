// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  GENERIC_ND_FILTER_PROFILES,
  GENERIC_ND_FILTER_STOPS,
  GENERIC_THIRD_STOP_SHUTTER_SECONDS,
  InvalidConfigurationError,
  InvalidScientificInputError,
  calculateFilteredExposureTime,
  composeFrontOfLensFilterTransmission,
  parseFrontOfLensFilterProfile,
  type FrontOfLensFilterProfile,
  type FrontOfLensFilterTransmissionModel
} from "../src/index.js";

const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "test:nd", reuseStatus: "photivra-owned" as const }];

function filterProfile(
  transmission: FrontOfLensFilterTransmissionModel,
  options: { scientificStatus?: "calibrated" | "approximation"; range?: { minimum: number; maximum: number }; schemaVersion?: "0.1.0" | "0.2.0" } = {}
): FrontOfLensFilterProfile {
  const polarizer = transmission.kind === "linear-polarizer";
  return parseFrontOfLensFilterProfile({
    schemaVersion: options.schemaVersion ?? (polarizer ? "0.2.0" : "0.1.0"),
    filterId: "generic-" + transmission.kind,
    profileVersion: "1.0.0",
    identityScope: "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: options.scientificStatus ?? "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: options.range ?? { minimum: 400, maximum: 700 },
    transmission,
    uncertainty: options.scientificStatus === "calibrated"
      ? { kind: "relative", fraction: 0.05, basis: "Synthetic calibration." }
      : { kind: "not-quantified", limitation: "Generic nominal filter." },
    polarizationModeled: polarizer,
    wavelengthChangingBehaviorModeled: false,
    evidence,
    limitations: ["Synthetic filter."]
  });
}

const stopsFilter = (stops: number, scientificStatus?: "calibrated" | "approximation"): FrontOfLensFilterProfile =>
  filterProfile({ kind: "neutral-linear-transmission", linearTransmissionFactor: { value: 2 ** -stops, evidence } },
    scientificStatus === undefined ? {} : { scientificStatus });
const densityFilter = (od: number): FrontOfLensFilterProfile =>
  filterProfile({ kind: "neutral-optical-density", opticalDensityBase10: { value: od, evidence } });

describe("calculateFilteredExposureTime (#578)", () => {
  it("1/125 s with a 10-stop filter gives about 8 s, and 8 s on a third-stop dial", () => {
    const result = calculateFilteredExposureTime({
      shutterSeconds: 1 / 125, filter: stopsFilter(10), shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS
    });
    expect(result.value.filteredShutterSeconds).toBeCloseTo(1024 / 125, 12);
    expect(result.value.filteredShutterSeconds).toBeGreaterThan(7.5);
    expect(result.value.filteredShutterSeconds).toBeLessThan(8.5);
    expect(result.value.attenuationStops).toBeCloseTo(10, 12);
    expect(result.value.exposureFactor).toBeCloseTo(1024, 9);
    expect(result.value.linearTransmissionFactor).toBe(2 ** -10);
    expect(result.value.dial).toEqual({
      shutterSeconds: 8,
      exposureErrorStops: expect.closeTo(Math.log2(8 / (1024 / 125)), 12) as number,
      clamped: false,
      quantizationPolicy: "nearest-log2-shorter-on-tie"
    });
    expect(result.provenance.kind).toBe("approximation");
    expect(result.provenance.model).toBe("filtered-exposure-time");
    expect(result.provenance.assumptions?.join(" ")).toMatch(/Reciprocity failure is not modelled/);
    expect(result.provenance.assumptions?.join(" ")).toMatch(/nominal filters vary/);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("an ND1000 (OD 3.0) filter gives exactly 1000 × the time: 1/125 s → 8 s", () => {
    const result = calculateFilteredExposureTime({ shutterSeconds: 1 / 125, filter: densityFilter(3) });
    expect(result.value.filteredShutterSeconds).toBeCloseTo(8, 12);
    expect(result.value.attenuationStops).toBeCloseTo(3 / Math.log10(2), 12);
    expect(result.value.dial).toBeUndefined();
    expect("dial" in result.value).toBe(false);
  });

  it("multiplies stacked filters and keeps each filter's identity", () => {
    const result = calculateFilteredExposureTime({ shutterSeconds: 1 / 60, filter: [stopsFilter(3), stopsFilter(6)] });
    expect(result.value.attenuationStops).toBeCloseTo(9, 12);
    expect(result.value.filteredShutterSeconds).toBeCloseTo(512 / 60, 12);
    expect(result.value.filterTransmission.appliedFilterCount).toBe(2);
  });

  it("is a calculated result when every profile is calibrated", () => {
    const result = calculateFilteredExposureTime({ shutterSeconds: 1, filter: stopsFilter(1, "calibrated") });
    expect(result.provenance.kind).toBe("calculated");
    expect(result.value.filteredShutterSeconds).toBe(2);
  });

  it("uses 550 nm by default and the requested wavelength for a spectral filter", () => {
    const spectral = filterProfile({
      kind: "spectral-transmission",
      samples: { value: [{ wavelengthNanometers: 400, linearTransmissionFactor: 0.5 }, { wavelengthNanometers: 700, linearTransmissionFactor: 0.125 }], evidence }
    });
    expect(calculateFilteredExposureTime({ shutterSeconds: 1, filter: spectral }).value.wavelengthNanometers).toBe(550);
    const at400 = calculateFilteredExposureTime({ shutterSeconds: 1, filter: spectral, wavelengthNanometers: 400, wavelengthBasis: "air" });
    expect(at400.value.filteredShutterSeconds).toBeCloseTo(2, 12);
    const at700 = calculateFilteredExposureTime({ shutterSeconds: 1, filter: spectral, wavelengthNanometers: 700 });
    expect(at700.value.attenuationStops).toBeCloseTo(3, 12);
  });

  it("passes the incident polarization to a polarizer in the stack", () => {
    const polarizer = filterProfile({
      kind: "linear-polarizer", principalTransmittance: { value: 0.5, evidence }, extinctionRatio: { value: 1e6, evidence }, transmissionAxisDegrees: 0
    });
    const unpolarized = calculateFilteredExposureTime({ shutterSeconds: 1, filter: polarizer });
    expect(unpolarized.value.attenuationStops).toBeCloseTo(2, 5);
    const aligned = calculateFilteredExposureTime({
      shutterSeconds: 1, filter: polarizer, incidentPolarization: { degreeOfLinearPolarization: 1, angleDegrees: 0 }
    });
    expect(aligned.value.filteredShutterSeconds).toBeCloseTo(2, 5);
  });

  it("chooses the nearest dial value in stops, the shorter on a tie, and clamps outside the dial", () => {
    const filter = stopsFilter(1);
    // 0.75 s × 2 = 1.5 s lies between 1 and 2 s; log2(1.5) = 0.585 > 0.5, so 2 s is nearer.
    expect(calculateFilteredExposureTime({ shutterSeconds: 0.75, filter, shutterDialSeconds: [2, 1] }).value.dial?.shutterSeconds).toBe(2);
    // Exact √2 s is a tie between 1 s and 2 s: the shorter wins.
    expect(calculateFilteredExposureTime({ shutterSeconds: Math.SQRT2 / 2, filter, shutterDialSeconds: [1, 2] }).value.dial?.shutterSeconds).toBe(1);
    const long = calculateFilteredExposureTime({ shutterSeconds: 1, filter: stopsFilter(10), shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS });
    expect(long.value.dial).toMatchObject({ shutterSeconds: 30, clamped: "maximum" });
    expect(long.value.dial?.exposureErrorStops).toBeCloseTo(Math.log2(30 / 1024), 12);
    const short = calculateFilteredExposureTime({ shutterSeconds: 1e-5, filter, shutterDialSeconds: [1 / 8000, 1] });
    expect(short.value.dial).toMatchObject({ shutterSeconds: 1 / 8000, clamped: "minimum" });
  });

  it("rejects malformed input with domain errors", () => {
    const filter = stopsFilter(10);
    expect(() => calculateFilteredExposureTime(null as never)).toThrow(InvalidConfigurationError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter, shutterMs: 1 } as never))
      .toThrow(new InvalidConfigurationError('calculateFilteredExposureTime input has unknown field "shutterMs".'));
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 0, filter })).toThrow(InvalidScientificInputError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: Number.NaN, filter })).toThrow(InvalidScientificInputError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter: [] })).toThrow(InvalidConfigurationError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1 } as never)).toThrow(InvalidConfigurationError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter, shutterDialSeconds: [] })).toThrow(InvalidConfigurationError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter, shutterDialSeconds: [1, -2] })).toThrow(/shutterDialSeconds\[1\]/);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter, wavelengthNanometers: 900 })).toThrow(InvalidScientificInputError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: 1, filter, wavelengthBasis: "vacuum" })).toThrow(InvalidScientificInputError);
    expect(() => calculateFilteredExposureTime({ shutterSeconds: Number.MAX_VALUE, filter })).toThrow(RangeError);
  });
});

describe("generic ND filter presets (#578, owner decision 2026-11-09)", () => {
  it("are exactly 2^-N for 3, 6 and 10 stops, spectrally flat, idealized and unbranded", () => {
    expect(GENERIC_ND_FILTER_STOPS).toEqual([3, 6, 10]);
    const expected = { 3: 1 / 8, 6: 1 / 64, 10: 1 / 1024 } as const;
    for (const stops of GENERIC_ND_FILTER_STOPS) {
      const profile = GENERIC_ND_FILTER_PROFILES[stops];
      expect(profile.filterId).toBe(`generic-nd-${stops}-stop`);
      expect(profile.identityScope).toBe("photivra-generic-unbranded");
      expect(profile.scientificStatus).toBe("approximation");
      expect(profile.uncertainty.kind).toBe("not-quantified");
      expect(profile.transmission).toMatchObject({ kind: "neutral-linear-transmission", linearTransmissionFactor: { value: expected[stops] } });
      expect(profile.evidence[0]?.note).toMatch(/Idealized/);
      // The parser accepts the preset unchanged.
      expect(parseFrontOfLensFilterProfile(profile)).toEqual(profile);
      // Flat: the same transmittance at both ends of the range and in the middle.
      for (const wavelengthNanometers of [380, 550, 780]) {
        const composed = composeFrontOfLensFilterTransmission({ filters: [profile], wavelengthNanometers, wavelengthBasis: "air" });
        expect(composed.combinedLinearTransmissionFactor).toBe(expected[stops]);
        expect(composed.combinedAttenuationStops).toBe(stops);
      }
    }
  });

  it("are frozen all the way down", () => {
    expect(Object.isFrozen(GENERIC_ND_FILTER_STOPS)).toBe(true);
    expect(Object.isFrozen(GENERIC_ND_FILTER_PROFILES)).toBe(true);
    const profile = GENERIC_ND_FILTER_PROFILES[10];
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.transmission)).toBe(true);
    expect(Object.isFrozen(profile.evidence[0])).toBe(true);
    expect(Object.isFrozen(profile.limitations)).toBe(true);
  });

  it("give exact filtered times: 1/125 s → 1024/125 s with 10 stops (8 s on the third-stop dial), ×8 and ×64 with 3 and 6", () => {
    const ten = calculateFilteredExposureTime({
      shutterSeconds: 1 / 125, filter: GENERIC_ND_FILTER_PROFILES[10], shutterDialSeconds: GENERIC_THIRD_STOP_SHUTTER_SECONDS
    });
    expect(ten.value.filteredShutterSeconds).toBe(8.192);
    expect(ten.value.filteredShutterSeconds.toFixed(2)).toBe("8.19");
    expect(ten.value.attenuationStops).toBe(10);
    expect(ten.value.exposureFactor).toBe(1024);
    expect(ten.value.dial?.shutterSeconds).toBe(8);
    expect(ten.provenance.kind).toBe("approximation");
    expect(calculateFilteredExposureTime({ shutterSeconds: 1, filter: GENERIC_ND_FILTER_PROFILES[3] }).value.filteredShutterSeconds).toBe(8);
    expect(calculateFilteredExposureTime({ shutterSeconds: 1, filter: GENERIC_ND_FILTER_PROFILES[6] }).value.filteredShutterSeconds).toBe(64);
    const stacked = calculateFilteredExposureTime({ shutterSeconds: 1 / 8, filter: [GENERIC_ND_FILTER_PROFILES[3], GENERIC_ND_FILTER_PROFILES[6]] });
    expect(stacked.value.attenuationStops).toBe(9);
    expect(stacked.value.filteredShutterSeconds).toBe(64);
  });
});
