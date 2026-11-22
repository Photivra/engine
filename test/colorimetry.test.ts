// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolveCaptureIlluminant, resolvePortableCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { calculateChromaticityFromCorrelatedColorTemperature as nativeCctChromaticity, calculatePortableChromaticityFromCorrelatedColorTemperature } from "../src/color/illuminants.js";
import { describe, expect, it } from "vitest";
import {
  calculateChromaticAdaptationMatrix,
  calculateChromaticallyAdaptedXyz,
  calculateChromaticityFromCorrelatedColorTemperature,
  calculateCieDaylightComponentWeights,
  calculateCieIlluminantARelativeSpectralPower,
  calculateCielabFromCielch,
  calculateCielabFromXyz,
  calculateCielchFromCielab,
  calculateColorDifference,
  calculateCorrelatedColorTemperature,
  calculatePlanckianChromaticity,
  calculatePlanckianSpectralRadiance,
  calculateXyzFromCielab,
  createCieDaylightSpectrum,
  createCieIlluminantASpectrum,
  createColorimetricMidpointQuadrature,
  createPlanckianSpectrum,
  estimateCie1931ColorMatchingFunctions,
  estimateCorrelatedColorTemperatureMcCamy,
  estimatePlanckianLocusChromaticity,
  integrateSpectrumToXyz,
  parseColorimetricQuadratureNodes,
  prepareColorMatchingFunctions,
  prepareColorimetricSpectrum,
  resolveChromaticAdaptationConeMatrix,
  InvalidConfigurationError,
  InvalidScientificInputError,
  InvalidScientificResultError,
  evaluateSrgbDecoding,
  prepareBt1886Eotf,
  CHROMATIC_ADAPTATION_TRANSFORMS,
  SECOND_RADIATION_CONSTANT_METER_KELVIN,
  ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS,
  PLANCKIAN_LOCUS_RANGE_KELVIN,
  type CielabColor,
  type ColorMatchingFunctionsSource,
  type ColorimetricQuadratureNode,
  type PlanckianLocusModel
} from "../src/index.js";
import * as engine from "../src/index.js";

const ANALYTIC: ColorMatchingFunctionsSource = { kind: "analytic-cie-1931-multi-lobe-fit" };
/** CIE 15 summation convention: 1 nm nodes at 360…830 nm, Δλ = 1 nm. */
const NODES_1NM: ColorimetricQuadratureNode[] = Array.from({ length: 471 }, (_, i) => ({ wavelengthNanometers: 360 + i, wavelengthMeasureNanometers: 1 }));
function uv(p: { x: number; y: number }): [number, number] {
  const d = -2 * p.x + 12 * p.y + 3;
  return [(4 * p.x) / d, (6 * p.y) / d];
}

describe("CIE 1931 colour-matching functions", () => {
  it("is non-negative, has equal-area components and a unit-peak ȳ near 555 nm (no CIE table values needed)", () => {
    // A colour-matching function cannot be negative anywhere in its domain.
    for (let nm = 360; nm <= 830; nm += 0.1) {
      const c = estimateCie1931ColorMatchingFunctions(nm);
      expect(Math.min(c.x, c.y, c.z), String(nm)).toBeGreaterThanOrEqual(0);
    }
    // The CIE 1931 functions are normalized to equal areas (so the equal-energy white has x = y = 1/3).
    let sx = 0, sy = 0, sz = 0;
    for (const n of NODES_1NM) {
      const v = estimateCie1931ColorMatchingFunctions(n.wavelengthNanometers);
      sx += v.x; sy += v.y; sz += v.z;
    }
    expect(Math.abs(sx / sy - 1)).toBeLessThan(0.005);
    expect(Math.abs(sz / sy - 1)).toBeLessThan(0.005);
    // ȳ is the photopic luminous efficiency V(λ), normalized to 1 at its peak, which lies at 555 nm in
    // standard air (the 540 THz radiation of the SI candela definition, BIPM SI Brochure 2019).
    let peak = 0, peakNm = 0;
    for (let nm = 500; nm <= 600; nm += 0.1) {
      const y = estimateCie1931ColorMatchingFunctions(nm).y;
      if (y > peak) { peak = y; peakNm = nm; }
    }
    expect(Math.abs(peak - 1)).toBeLessThan(0.01);
    expect(Math.abs(peakNm - 555)).toBeLessThan(3);
    expect(ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS).toEqual({ minimum: 360, maximum: 830 });
    expect(prepareColorMatchingFunctions(ANALYTIC).datasetId).toBe("photivra-cie-1931-multi-lobe-fit-2026-10-17");
    expect(() => estimateCie1931ColorMatchingFunctions(359)).toThrow();
    expect(() => estimateCie1931ColorMatchingFunctions(830.0001)).toThrow();
    expect(() => estimateCie1931ColorMatchingFunctions(Number.NaN)).toThrow();
  });

  it("evaluates caller-tabulated CMFs by linear interpolation and fails closed outside the table", () => {
    const table = prepareColorMatchingFunctions({ kind: "tabulated", observer: "cie-1931-2-degree", datasetId: "synthetic",
      samples: [{ wavelengthNanometers: 500, xBar: 0, yBar: 1, zBar: 2 }, { wavelengthNanometers: 510, xBar: 1, yBar: 3, zBar: 2 }] });
    expect(table.evaluate(505)).toEqual({ x: 0.5, y: 2, z: 2 });
    expect(table.evaluate(510)).toEqual({ x: 1, y: 3, z: 2 });
    expect(() => table.evaluate(511)).toThrow();
    expect(() => prepareColorMatchingFunctions({ kind: "tabulated", observer: "cie-1931-2-degree", datasetId: "x",
      samples: [{ wavelengthNanometers: 500, xBar: -1, yBar: 1, zBar: 2 }, { wavelengthNanometers: 510, xBar: 1, yBar: 3, zBar: 2 }] })).toThrow();
    expect(() => prepareColorMatchingFunctions({ kind: "tabulated", observer: "cie-1931-2-degree", datasetId: "x",
      samples: [{ wavelengthNanometers: 510, xBar: 1, yBar: 1, zBar: 2 }, { wavelengthNanometers: 500, xBar: 1, yBar: 3, zBar: 2 }] })).toThrow();
    expect(() => prepareColorMatchingFunctions({ kind: "other" } as unknown as ColorMatchingFunctionsSource)).toThrow();
    const signed = prepareColorMatchingFunctions({ kind: "tabulated", observer: "caller-defined", datasetId: "x",
      samples: [{ wavelengthNanometers: 500, xBar: -1, yBar: 1, zBar: 2 }, { wavelengthNanometers: 510, xBar: 1, yBar: 3, zBar: 2 }] });
    expect(signed.evaluate(500).x).toBe(-1);
  });

  it("integrates spectra with explicit quadrature and white normalization", () => {
    const flat = { kind: "function" as const, wavelengthRangeNanometers: { minimum: 360, maximum: 830 }, evaluate: (): number => 1 };
    const grey = { kind: "tabulated" as const, samples: [{ wavelengthNanometers: 360, value: 0.18 }, { wavelengthNanometers: 830, value: 0.18 }] };
    const r = integrateSpectrumToXyz({ quadratureNodes: NODES_1NM, spectralDistribution: flat, spectralFactor: grey, colorMatchingFunctions: ANALYTIC, normalization: { kind: "white-luminance-one" } });
    expect(r.provenance.kind).toBe("approximation");
    expect(r.value.whiteXyz.y).toBeCloseTo(1, 14);
    expect(r.value.xyz.y).toBeCloseTo(0.18, 14);
    expect(r.value.xyz.x / r.value.whiteXyz.x).toBeCloseTo(0.18, 14);
    // Equal-energy white: x ≈ y ≈ 1/3 (the equal-area normalization) within the fit error.
    expect(Math.abs(r.value.chromaticity!.x - 1 / 3)).toBeLessThan(0.002);
    expect(Math.abs(r.value.chromaticity!.y - 1 / 3)).toBeLessThan(0.002);
    const tab = integrateSpectrumToXyz({ quadratureNodes: [{ wavelengthNanometers: 505, wavelengthMeasureNanometers: 2 }], spectralDistribution: flat,
      colorMatchingFunctions: { kind: "tabulated", observer: "caller-defined", datasetId: "t", samples: [{ wavelengthNanometers: 500, xBar: 1, yBar: 2, zBar: 3 }, { wavelengthNanometers: 510, xBar: 1, yBar: 2, zBar: 3 }] },
      normalization: { kind: "scale", factor: 683 } });
    expect(tab.provenance.kind).toBe("calculated");
    expect(tab.value.xyz).toEqual({ x: 1366, y: 2732, z: 4098 });
    expect(() => integrateSpectrumToXyz({ quadratureNodes: [{ wavelengthNanometers: 900, wavelengthMeasureNanometers: 1 }], spectralDistribution: flat, colorMatchingFunctions: ANALYTIC, normalization: { kind: "white-luminance-one" } })).toThrow();
    expect(() => integrateSpectrumToXyz({ quadratureNodes: NODES_1NM, spectralDistribution: { kind: "function", wavelengthRangeNanometers: { minimum: 360, maximum: 830 }, evaluate: () => 0 }, colorMatchingFunctions: ANALYTIC, normalization: { kind: "white-luminance-one" } })).toThrow();
    expect(() => integrateSpectrumToXyz({ quadratureNodes: NODES_1NM, spectralDistribution: flat, colorMatchingFunctions: ANALYTIC, normalization: { kind: "scale", factor: 0 } })).toThrow();
  });

  it("builds midpoint nodes whose measures sum to the range and validates nodes and spectra", () => {
    const nodes = createColorimetricMidpointQuadrature({ wavelengthRangeNanometers: { minimum: 380, maximum: 781 }, maximumSubintervalWidthNanometers: 5 });
    expect(nodes.length).toBe(81);
    expect(nodes.reduce((s, n) => s + n.wavelengthMeasureNanometers, 0)).toBeCloseTo(401, 10);
    expect(nodes[0]!.wavelengthNanometers).toBeCloseTo(380 + 401 / 81 / 2, 12);
    expect(() => createColorimetricMidpointQuadrature({ wavelengthRangeNanometers: { minimum: 500, maximum: 400 }, maximumSubintervalWidthNanometers: 5 })).toThrow();
    expect(() => createColorimetricMidpointQuadrature({ wavelengthRangeNanometers: { minimum: 1, maximum: 1e6 }, maximumSubintervalWidthNanometers: 1 })).toThrow();
    expect(() => parseColorimetricQuadratureNodes([])).toThrow();
    expect(() => parseColorimetricQuadratureNodes([{ wavelengthNanometers: 500, wavelengthMeasureNanometers: -1 }])).toThrow();
    expect(() => prepareColorimetricSpectrum({ kind: "function", wavelengthRangeNanometers: { minimum: 400, maximum: 500 }, evaluate: () => Number.NaN }).evaluate(450)).toThrow();
    expect(() => prepareColorimetricSpectrum({ kind: "tabulated", samples: [{ wavelengthNanometers: 400, value: 1 }] })).toThrow();
  });
});

describe("illuminants and correlated colour temperature", () => {
  it("implements Planck's law (Wien displacement and Stefan–Boltzmann checks)", () => {
    expect(SECOND_RADIATION_CONSTANT_METER_KELVIN).toBeCloseTo(1.438776877e-2, 10);
    const t = 5000;
    let peak = 0, peakNm = 0;
    for (let nm = 500; nm <= 660; nm += 0.01) {
      const l = calculatePlanckianSpectralRadiance({ temperatureKelvin: t, wavelengthNanometers: nm });
      if (l > peak) { peak = l; peakNm = nm; }
    }
    expect(Math.abs(peakNm - 2.897771955e6 / t)).toBeLessThan(0.02); // Wien b = 2.897771955e-3 m·K (CODATA)
    const nodes = createColorimetricMidpointQuadrature({ wavelengthRangeNanometers: { minimum: 20, maximum: 200000 }, maximumSubintervalWidthNanometers: 2 });
    const radiance = nodes.reduce((s, n) => s + calculatePlanckianSpectralRadiance({ temperatureKelvin: t, wavelengthNanometers: n.wavelengthNanometers }) * n.wavelengthMeasureNanometers, 0);
    expect(radiance / ((5.670374419e-8 * t ** 4) / Math.PI)).toBeCloseTo(1, 4); // σ (CODATA)
    expect(calculatePlanckianSpectralRadiance({ temperatureKelvin: 10, wavelengthNanometers: 300 })).toBe(0);
    expect(() => calculatePlanckianSpectralRadiance({ temperatureKelvin: 0, wavelengthNanometers: 500 })).toThrow();
  });

  it("evaluates CIE illuminant A as a Planckian radiator and recovers its temperature", () => {
    expect(calculateCieIlluminantARelativeSpectralPower(560)).toBeCloseTo(100, 12);
    expect(() => calculateCieIlluminantARelativeSpectralPower(299)).toThrow();
    // Illuminant A is Planck's law with c2 = 1.435e-2 m·K at 2848 K, i.e. the same spectral shape as
    // a Planckian radiator at 2848 K × c2/1.435e-2 under the exact c2. Computed on the fly here.
    const tA = 2848 * (SECOND_RADIATION_CONSTANT_METER_KELVIN / 1.435e-2);
    const scale = calculateCieIlluminantARelativeSpectralPower(560) / calculatePlanckianSpectralRadiance({ temperatureKelvin: tA, wavelengthNanometers: 560 });
    for (const nm of [300, 360, 450, 555, 700, 830]) {
      const ratio = calculateCieIlluminantARelativeSpectralPower(nm) / calculatePlanckianSpectralRadiance({ temperatureKelvin: tA, wavelengthNanometers: nm });
      expect(ratio / scale, String(nm)).toBeCloseTo(1, 12);
    }
    const a = integrateSpectrumToXyz({ quadratureNodes: NODES_1NM, spectralDistribution: createCieIlluminantASpectrum(), colorMatchingFunctions: ANALYTIC, normalization: { kind: "white-luminance-one" } });
    // Its chromaticity is the locus point at that temperature (same CMFs and nodes as the default locus).
    const onLocus = estimatePlanckianLocusChromaticity({ temperatureKelvin: tA }).value;
    expect(a.value.chromaticity!.x).toBeCloseTo(onLocus.x, 12);
    expect(a.value.chromaticity!.y).toBeCloseTo(onLocus.y, 12);
    for (const locus of [{ kind: "planck-integration" as const, colorMatchingFunctions: ANALYTIC, quadratureNodes: NODES_1NM }, { kind: "planck-analytic-cmf" as const }]) {
      const cct = calculateCorrelatedColorTemperature({ chromaticity: a.value.chromaticity!, locus });
      expect(cct.value.correlatedColorTemperatureKelvin).toBeCloseTo(tA, 0);
      expect(Math.abs(cct.value.duv)).toBeLessThan(1e-9);
    }
  });

  it("evaluates the engine's illuminants portably for the display view, within a few ulps of the capture's", () => {
    // The portable forms (portablePow for λ⁵ and the daylight-locus powers, portableExpm1) are the same formulas; they only
    // replace operations whose last bit differs between JavaScript engines.
    const flat = (value: number): { wavelengthNanometers: number; value: number }[] => [{ wavelengthNanometers: 300, value }, { wavelengthNanometers: 830, value }];
    const basis = { datasetId: "synthetic-test-basis", s0: flat(100), s1: flat(10), s2: flat(5) };
    for (const option of [{ kind: "planckian" as const, temperatureKelvin: 6500 }, { kind: "planckian" as const, temperatureKelvin: 1000 }, { kind: "planckian" as const, temperatureKelvin: 25000 },
      { kind: "cie-a" as const }, { kind: "daylight" as const, correlatedColorTemperatureKelvin: 5003, basis }]) {
      const native = resolveCaptureIlluminant(option), portable = resolvePortableCaptureIlluminant(option);
      expect(portable.id).toBe(native.id);
      expect(portable.description).toBe(native.description);
      for (let nm = 380; nm <= 780; nm += 0.5) {
        const a = native.shape.evaluate(nm), b = portable.shape.evaluate(nm);
        expect(Math.abs(b - a), option.kind + " " + String(nm)).toBeLessThanOrEqual(8 * Number.EPSILON * Math.abs(a));
      }
    }
    // The Kelvin white point (Planckian locus and its normal for the tint; daylight locus) likewise.
    for (const [t, duv, whiteLocus] of [[2700, 0, "planckian"], [5000, 0.01, "planckian"], [9000, -0.02, "planckian"], [6504, 0.003, "cie-daylight"]] as const) {
      const input = { correlatedColorTemperatureKelvin: t, duv, whiteLocus, locus: { kind: "planck-analytic-cmf" as const } };
      const a = nativeCctChromaticity(input).value, b = calculatePortableChromaticityFromCorrelatedColorTemperature(input).value;
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1e-14);
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1e-14);
    }
  });

  it("computes the CIE daylight locus and builds D-series spectra from a caller basis", () => {
    const d65 = calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "none" }).value;
    // The daylight locus: y = −3x² + 2.87x − 0.275, with x falling as T rises (formula self-consistency).
    let previousX = Infinity;
    for (let t = 4000; t <= 25000; t += 500) {
      const xy = calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: t, coefficientRounding: "none" }).value.chromaticity;
      expect(xy.y).toBeCloseTo(-3 * xy.x * xy.x + 2.87 * xy.x - 0.275, 14);
      expect(xy.x).toBeLessThan(previousX);
      previousX = xy.x;
      // Daylight lies slightly above (greenward of) the Planckian locus.
      const duv = calculateCorrelatedColorTemperature({ chromaticity: xy, locus: { kind: "planck-analytic-cmf" } }).value.duv;
      expect(duv, String(t)).toBeGreaterThan(0);
      expect(duv, String(t)).toBeLessThan(0.01);
    }
    const rounded = calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "cie-three-decimals" }).value;
    expect(rounded.m1).toBe(Math.round(d65.m1 * 1000) / 1000);
    expect(Number.isInteger(Math.round(rounded.m2 * 1000)) && Math.abs(rounded.m2 * 1000 - Math.round(rounded.m2 * 1000)) < 1e-9).toBe(true);
    // Branch continuity at 7000 K within the published polynomial precision.
    const below = calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 7000, coefficientRounding: "none" }).value.chromaticity;
    const above = calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 7000.001, coefficientRounding: "none" }).value.chromaticity;
    expect(Math.abs(below.x - above.x)).toBeLessThan(1e-4);
    expect(() => calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 3999, coefficientRounding: "none" })).toThrow();
    expect(() => calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "x" as "none" })).toThrow();
    // Synthetic (owned) basis to check S = S0 + M1 S1 + M2 S2 assembly; not CIE data.
    const basis = {
      datasetId: "synthetic-test-basis",
      s0: [{ wavelengthNanometers: 400, value: 100 }, { wavelengthNanometers: 500, value: 110 }],
      s1: [{ wavelengthNanometers: 400, value: 10 }, { wavelengthNanometers: 500, value: 0 }],
      s2: [{ wavelengthNanometers: 400, value: 0 }, { wavelengthNanometers: 450, value: 4 }, { wavelengthNanometers: 500, value: 2 }]
    };
    const spd = createCieDaylightSpectrum({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "none", basis });
    if (spd.kind !== "tabulated") throw new Error("expected tabulated");
    expect(spd.samples[0]!.value).toBeCloseTo(100 + 10 * d65.m1, 12);
    expect(spd.samples[1]!.value).toBeCloseTo(110 + 2 * d65.m2, 12);
    expect(() => createCieDaylightSpectrum({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "none", basis: { ...basis, datasetId: "" } })).toThrow();
  });

  it("computes the Planckian locus from Planck's law: monotonic, consistent and range-checked", () => {
    const explicit = { kind: "planck-integration" as const, colorMatchingFunctions: ANALYTIC, quadratureNodes: NODES_1NM };
    expect(PLANCKIAN_LOCUS_RANGE_KELVIN).toEqual({ minimum: 1000, maximum: 100000 });
    let previous: [number, number] | undefined;
    for (let mired = 1000; mired >= 10; mired -= 10) {
      const t = 1e6 / mired;
      const p = estimatePlanckianLocusChromaticity({ temperatureKelvin: t });
      expect(p.provenance.kind).toBe("approximation");
      // The default locus is exactly the Planck integral with the analytic CMFs on 1 nm nodes.
      const q = calculatePlanckianChromaticity({ temperatureKelvin: t, locus: explicit }).value;
      expect(p.value.x).toBeCloseTo(q.x, 14);
      expect(p.value.y).toBeCloseTo(q.y, 14);
      const [u, v] = uv(p.value);
      // Monotonic: u falls as T rises, and successive points move a positive, bounded uv step.
      if (previous !== undefined) {
        expect(u, String(t)).toBeLessThan(previous[0]);
        expect(Math.hypot(u - previous[0], v - previous[1])).toBeLessThan(0.01);
      }
      previous = [u, v];
    }
    const planck = integrateSpectrumToXyz({ quadratureNodes: NODES_1NM, spectralDistribution: createPlanckianSpectrum({ temperatureKelvin: 4000, wavelengthRangeNanometers: { minimum: 360, maximum: 830 } }), colorMatchingFunctions: ANALYTIC, normalization: { kind: "white-luminance-one" } });
    expect(estimatePlanckianLocusChromaticity({ temperatureKelvin: 4000 }).value.x).toBeCloseTo(planck.value.chromaticity!.x, 14);
    expect(calculatePlanckianChromaticity({ temperatureKelvin: 4000, locus: { kind: "planck-analytic-cmf" } }).provenance.assumptions).toContain("Planckian locus model: planck-analytic-cmf");
    expect(() => estimatePlanckianLocusChromaticity({ temperatureKelvin: 999 })).toThrow();
    expect(() => estimatePlanckianLocusChromaticity({ temperatureKelvin: 100001 })).toThrow();
    expect(() => calculatePlanckianChromaticity({ temperatureKelvin: 4000, locus: { kind: "kim-2002-cubic-spline" } as unknown as PlanckianLocusModel })).toThrow();
    expect(() => calculateCorrelatedColorTemperature({ chromaticity: { x: 0.2, y: 0.6 }, locus: { kind: "planck-analytic-cmf" } })).toThrow();
    expect(() => calculateCorrelatedColorTemperature({ chromaticity: { x: 0.65, y: 0.33 }, locus: { kind: "planck-analytic-cmf" } })).toThrow();
  });

  it("agrees with the McCamy (1992) cubic on the computed locus within McCamy's accuracy plus the CMF-fit shift", () => {
    // McCamy's cubic deviates from an exact, table-based Planckian locus by up to about 10 K over
    // 2856–6504 K (measured; docs/COLORIMETRY.md), and the analytic CMF fit moves the locus by at most
    // 2.83e-4 in uv over that range (also measured). 20 K covers both.
    for (let t = 2856; t <= 6504; t += 50) {
      const xy = estimatePlanckianLocusChromaticity({ temperatureKelvin: t }).value;
      const mccamy = estimateCorrelatedColorTemperatureMcCamy({ chromaticity: xy }).value.correlatedColorTemperatureKelvin;
      expect(Math.abs(mccamy - t), String(t)).toBeLessThan(20);
      expect(calculateCorrelatedColorTemperature({ chromaticity: xy, locus: { kind: "planck-analytic-cmf" } }).value.correlatedColorTemperatureKelvin / t).toBeCloseTo(1, 7);
    }
  });

  it("gives a greenish light a positive Duv and a magenta light a negative one (the engine's sign convention)", () => {
    const locus = { kind: "planck-analytic-cmf" as const };
    for (const t of [2700, 4000, 6500]) {
      const onLocus = estimatePlanckianLocusChromaticity({ temperatureKelvin: t }).value;
      // Move toward the BT.709 green primary (0.30, 0.60) and away from it (toward magenta) by a small step in xy.
      const step = 0.02, g = { x: 0.30 - onLocus.x, y: 0.60 - onLocus.y }, len = Math.hypot(g.x, g.y);
      const greenish = { x: onLocus.x + step * g.x / len, y: onLocus.y + step * g.y / len };
      const magenta = { x: onLocus.x - step * g.x / len, y: onLocus.y - step * g.y / len };
      const green = calculateCorrelatedColorTemperature({ chromaticity: greenish, locus });
      expect(green.value.duv, String(t)).toBeGreaterThan(0.002);
      expect(calculateCorrelatedColorTemperature({ chromaticity: magenta, locus }).value.duv, String(t)).toBeLessThan(-0.002);
      expect(green.provenance.assumptions).toContain("Duv sign: positive above the locus (toward green), negative below (engine convention)");
    }
  });

  it("round-trips CCT + Duv through chromaticity with the documented sign convention", () => {
    const explicit = { kind: "planck-integration" as const, colorMatchingFunctions: ANALYTIC, quadratureNodes: NODES_1NM };
    for (const locus of [{ kind: "planck-analytic-cmf" as const }, explicit]) {
      for (const t of [2000, 3200, 5000, 6500, 12000, 40000]) {
        for (const duv of [-0.02, 0, 0.01]) {
          const xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }).value;
          const back = calculateCorrelatedColorTemperature({ chromaticity: xy, locus }).value;
          expect(back.correlatedColorTemperatureKelvin / t).toBeCloseTo(1, 4);
          expect(back.duv).toBeCloseTo(duv, 6);
          if (duv > 0) {
            const base = estimatePlanckianLocusChromaticity({ temperatureKelvin: t }).value;
            expect(xy.y).toBeGreaterThan(base.y); // positive Duv: above the locus, toward green
          }
        }
      }
    }
    const locus = { kind: "planck-analytic-cmf" as const };
    const daylight = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: 6504, duv: 0, whiteLocus: "cie-daylight", locus });
    expect(daylight.provenance.kind).toBe("calculated");
    expect(daylight.value.x).toBeCloseTo(calculateCieDaylightComponentWeights({ correlatedColorTemperatureKelvin: 6504, coefficientRounding: "none" }).value.chromaticity.x, 12);
    expect(() => calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: 3000, duv: 0, whiteLocus: "cie-daylight", locus })).toThrow();
    expect(() => calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: 3000, duv: 0.06, whiteLocus: "planckian", locus })).toThrow();
    // A low temperature with a large positive Duv leaves the x + y <= 1 triangle (2000 K, +0.02 gave x + y = 1.0595), so it
    // is rejected rather than returned as a chromaticity the engine itself refuses as input.
    for (const [t, duv] of [[2000, 0.02], [1000, 0.02], [1000, 0.05], [1500, 0.05]] as const) {
      expect(() => calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }), t + " K " + duv)
        .toThrow(InvalidScientificInputError);
    }
    // Every accepted result is a valid chromaticity that parses again as input.
    for (const t of [1000, 1500, 2000, 4000, 10000, 100000]) for (const duv of [-0.05, -0.02, 0, 0.01]) {
      let xy: { x: number; y: number };
      try { xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }).value; } catch { continue; }
      expect(xy.x).toBeGreaterThanOrEqual(0); expect(xy.y).toBeGreaterThan(0); expect(xy.x + xy.y).toBeLessThanOrEqual(1);
    }
    expect(() => calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: 999, duv: 0, whiteLocus: "planckian", locus })).toThrow();
  });

  it("round-trips CCT + Duv tightly over the whole range, including both range limits", () => {
    const locus = { kind: "planck-analytic-cmf" as const };
    const temperatures = [1000, 1000.5, 1500, 2856, 4000, 6504, 10000, 25000, 50000, 99000, 100000];
    for (const t of temperatures) {
      // Positive Duv at low T leaves the xy triangle (x + y > 1), so it is only checked from 4000 K.
      for (const duv of t >= 4000 ? [-0.0499, -0.01, -0.001, 0, 0.001, 0.01, 0.0499] : [-0.0499, -0.01, -0.001, 0]) {
        const xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }).value;
        const back = calculateCorrelatedColorTemperature({ chromaticity: xy, locus }).value;
        expect(Math.abs(back.correlatedColorTemperatureKelvin - t) / t, t + " K, Duv " + duv).toBeLessThan(1e-9);
        expect(Math.abs(back.duv - duv), t + " K, Duv " + duv).toBeLessThan(1e-12);
      }
    }
  });

  it("agrees with the exact root of the distance derivative (50-digit reference of the same locus)", () => {
    // reference.json: generate_reference.py evaluates the engine's discrete locus in 50-digit decimal
    // arithmetic, brackets the minimum densely and solves d(uv distance²)/dT = 0 exactly.
    const reference = JSON.parse(readFileSync(new URL("./fixtures/planckian-cct/reference.json", import.meta.url), "utf8")) as {
      cases: { chromaticity: { x: number; y: number }; correlatedColorTemperatureKelvin: string; duv: string }[];
    };
    expect(reference.cases.length).toBeGreaterThanOrEqual(19);
    for (const c of reference.cases) {
      const r = calculateCorrelatedColorTemperature({ chromaticity: c.chromaticity, locus: { kind: "planck-analytic-cmf" } }).value;
      const t = Number(c.correlatedColorTemperatureKelvin);
      // The convergence tolerance is 1e-10 of T; measured agreement is about 1e-13.
      expect(Math.abs(r.correlatedColorTemperatureKelvin - t) / t, c.correlatedColorTemperatureKelvin).toBeLessThan(1e-10);
      expect(Math.abs(r.duv - Number(c.duv)), c.duv).toBeLessThan(1e-13);
    }
  });

  it("orders CCT monotonically along the locus and fails closed beyond its range limits", () => {
    const locus = { kind: "planck-analytic-cmf" as const };
    for (const duv of [-0.02, 0, 0.004]) {
      let previous = 0;
      for (let i = 0; i <= 120; i++) {
        const t = 4000 * 25 ** (i / 120); // 4000 … 100000 K
        const xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }).value;
        const cct = calculateCorrelatedColorTemperature({ chromaticity: xy, locus }).value.correlatedColorTemperatureKelvin;
        expect(cct, String(t)).toBeGreaterThan(previous);
        previous = cct;
      }
    }
    // Points extrapolated beyond each limit along the locus: their nearest point is outside the model.
    for (const [edge, inner] of [[1000, 1010], [100000, 99000]] as const) {
      const a = uv(estimatePlanckianLocusChromaticity({ temperatureKelvin: edge }).value);
      const b = uv(estimatePlanckianLocusChromaticity({ temperatureKelvin: inner }).value);
      const u = a[0] + (a[0] - b[0]), v = a[1] + (a[1] - b[1]);
      const d = 2 * u - 8 * v + 4;
      expect(() => calculateCorrelatedColorTemperature({ chromaticity: { x: (3 * u) / d, y: (2 * v) / d }, locus }), String(edge)).toThrow(/outside the locus model range/);
    }
    // Just inside a limit still resolves (the old scan-only search refused anything nearest the end sample).
    const nearMax = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: 99500, duv: 0, whiteLocus: "planckian", locus }).value;
    expect(calculateCorrelatedColorTemperature({ chromaticity: nearMax, locus }).value.correlatedColorTemperatureKelvin / 99500).toBeCloseTo(1, 9);
  });
});

describe("chromatic adaptation", () => {
  // D65 from its chromaticity (0.3127, 0.3290), ITU-R BT.709-6 (free), with Y = 1. D50 is the ICC PCS
  // illuminant nCIEXYZ (0.9642, 1.0, 0.8249), ICC.1:2010 §7.2.16 (free, permissive ICC copyright licence).
  const d65 = { x: 0.3127 / 0.3290, y: 1, z: (1 - 0.3127 - 0.3290) / 0.3290 }, d50 = { x: 0.9642, y: 1, z: 0.8249 };
  it("builds the linear Bradford matrix exactly as ICC.1:2010 Annex E specifies", () => {
    // ICC.1:2010 Annex E, Eq. (E.1): the Bradford cone matrix M_BFD.
    const mBfd = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]] as const;
    expect(resolveChromaticAdaptationConeMatrix("bradford")).toEqual(mBfd);
    // Eq. (E.2)-(E.4): M_adapt = M_BFD⁻¹ · diag(ρ_PCS/ρ_SRC, γ_PCS/γ_SRC, β_PCS/β_SRC) · M_BFD, evaluated here independently
    // with Cramer's rule for the inverse.
    const mul = (a: readonly (readonly number[])[], v: readonly number[]): number[] => a.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
    const det = (a: readonly (readonly number[])[]): number => a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
    const inv = (a: readonly (readonly number[])[]): number[][] => [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
      const r = [0, 1, 2].filter((k) => k !== j), c = [0, 1, 2].filter((k) => k !== i);
      return ((i + j) % 2 === 0 ? 1 : -1) * (a[r[0]!]![c[0]!]! * a[r[1]!]![c[1]!]! - a[r[0]!]![c[1]!]! * a[r[1]!]![c[0]!]!) / det(a);
    }));
    const src = mul(mBfd, [d65.x, d65.y, d65.z]), pcs = mul(mBfd, [d50.x, d50.y, d50.z]), mi = inv(mBfd);
    const expected = [0, 1, 2].map((i) => [0, 1, 2].map((j) => [0, 1, 2].reduce((s, k) => s + mi[i]![k]! * (pcs[k]! / src[k]!) * mBfd[k]![j]!, 0)));
    const m = calculateChromaticAdaptationMatrix({ transform: "bradford", sourceWhiteXyz: d65, destinationWhiteXyz: d50 }).value.matrix;
    m.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(expected[i]![j]!, 12)));
  });
  it("maps the source white to the destination white, honours D and inverts", () => {
    for (const transform of CHROMATIC_ADAPTATION_TRANSFORMS) {
      const r = calculateChromaticallyAdaptedXyz({ transform, sourceWhiteXyz: d65, destinationWhiteXyz: d50, xyz: d65 }).value.xyz;
      expect(r.x).toBeCloseTo(d50.x, 12); expect(r.y).toBeCloseTo(1, 12); expect(r.z).toBeCloseTo(d50.z, 12);
      const none = calculateChromaticAdaptationMatrix({ transform, sourceWhiteXyz: d65, destinationWhiteXyz: d50, degreeOfAdaptation: 0 }).value.matrix;
      none.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 12)));
      const forward = calculateChromaticAdaptationMatrix({ transform, sourceWhiteXyz: d65, destinationWhiteXyz: d50 }).value.matrix;
      const back = calculateChromaticAdaptationMatrix({ transform, sourceWhiteXyz: d50, destinationWhiteXyz: d65 }).value.matrix;
      const p = [0.3, 0.5, 0.2] as const;
      const fp = forward.map((row) => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);
      const bp = back.map((row) => row[0] * fp[0]! + row[1] * fp[1]! + row[2] * fp[2]!);
      bp.forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 12));
    }
    // Different white luminance: D = 1 preserves the source-white luminance.
    const d65Of100 = { x: 100 * d65.x, y: 100, z: 100 * d65.z };
    const scaled = calculateChromaticallyAdaptedXyz({ transform: "cat16", sourceWhiteXyz: d65Of100, destinationWhiteXyz: d50, xyz: d65Of100 }).value.xyz;
    expect(scaled.x).toBeCloseTo(100 * d50.x, 10); expect(scaled.y).toBeCloseTo(100, 10);
    expect(resolveChromaticAdaptationConeMatrix("cat16")[0][0]).toBe(0.401288);
    expect(() => calculateChromaticAdaptationMatrix({ transform: "bogus" as "cat16", sourceWhiteXyz: d65, destinationWhiteXyz: d50 })).toThrow();
    expect(() => calculateChromaticAdaptationMatrix({ transform: "cat16", sourceWhiteXyz: d65, destinationWhiteXyz: d50, degreeOfAdaptation: 1.1 })).toThrow();
    // CAT02 is not part of 2.0 (no free source prints its matrix): every public route rejects it.
    expect(CHROMATIC_ADAPTATION_TRANSFORMS).not.toContain("cat02");
    expect(() => calculateChromaticAdaptationMatrix({ transform: "cat02" as "cat16", sourceWhiteXyz: d65, destinationWhiteXyz: d50 })).toThrow(/transform must be one of/);
    expect(() => calculateChromaticallyAdaptedXyz({ transform: "cat02" as "cat16", sourceWhiteXyz: d65, destinationWhiteXyz: d50, xyz: d65 })).toThrow(/transform must be one of/);
    expect(() => resolveChromaticAdaptationConeMatrix("cat02" as "cat16")).toThrow(/transform must be one of/);
    expect(() => calculateChromaticAdaptationMatrix({ transform: "bradford", sourceWhiteXyz: { x: 0, y: 1, z: 0 }, destinationWhiteXyz: d50 })).toThrow();
  });
  it("rejects the von Kries-HPE transform and has no CIECAM02 degree-of-adaptation helper (not part of 2.0)", () => {
    // No free source we could confirm prints the HPE matrix or the CIECAM02 D formula (owner decision, 2026-10-17).
    expect(CHROMATIC_ADAPTATION_TRANSFORMS).toEqual(["bradford", "cat16", "xyz-scaling"]);
    expect(() => calculateChromaticAdaptationMatrix({ transform: "von-kries-hpe" as "cat16", sourceWhiteXyz: d65, destinationWhiteXyz: d50 }))
      .toThrow(/transform must be one of/);
    expect(() => resolveChromaticAdaptationConeMatrix("von-kries-hpe" as "cat16")).toThrow(/transform must be one of/);
    expect("calculateDegreeOfAdaptation" in engine).toBe(false);
  });
});

describe("CIELAB and colour difference", () => {
  const lab = (l: number, a: number, b: number): CielabColor => ({ lStar: l, aStar: a, bStar: b });
  const de00 = (r: CielabColor, t: CielabColor): number => calculateColorDifference({ reference: r, sample: t, formula: "ciede2000" }).value.deltaE;
  const rad = Math.PI / 180;
  /** CIEDE2000 lightness weight S_L at mean lightness L̄. */
  const sL = (lBar: number): number => 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  /** CIEDE2000 hue-dependent factor T at mean hue h̄ (degrees). */
  const tHue = (h: number): number => 1 - 0.17 * Math.cos((h - 30) * rad) + 0.24 * Math.cos(2 * h * rad) + 0.32 * Math.cos((3 * h + 6) * rad) - 0.20 * Math.cos((4 * h - 63) * rad);
  /** a* scale (1 + G) of the CIEDE2000 a′ for two colours of chroma C1, C2. */
  const onePlusG = (c1: number, c2: number): number => { const c = ((c1 + c2) / 2) ** 7; return 1 + 0.5 * (1 - Math.sqrt(c / (c + 25 ** 7))); };
  it("reduces to its closed forms for pure lightness, chroma and hue differences, symmetrically (computed, no published pairs)", () => {
    // Neutral pairs (a* = b* = 0): ΔE00 = |ΔL*| / S_L.
    for (const [l1, l2] of [[50, 52], [20, 35], [90, 88.5], [2, 1]] as const) {
      expect(de00(lab(l1, 0, 0), lab(l2, 0, 0))).toBeCloseTo(Math.abs(l2 - l1) / sL((l1 + l2) / 2), 12);
    }
    // Same lightness and hue on the +a* axis (h′ = 0, ΔH′ = 0, so the rotation term vanishes):
    // ΔE00 = ΔC′ / S_C with C′ = a*(1 + G) and S_C = 1 + 0.045 C̄′.
    for (const [a1, a2] of [[10, 12], [2.5, 25], [40, 60]] as const) {
      const k = onePlusG(a1, a2), c1 = a1 * k, c2 = a2 * k;
      expect(de00(lab(50, a1, 0), lab(50, a2, 0))).toBeCloseTo((c2 - c1) / (1 + 0.045 * (c1 + c2) / 2), 12);
    }
    // Same lightness and C*ab, different hue: the full chroma/hue expression with ΔL′ = 0, written out
    // here from the formula's definitions (a′ = (1 + G)a*, ΔH′ = 2√(C′₁C′₂) sin(Δh′/2), S_C, S_H, T, R_T).
    // Includes a pair whose hues straddle 0°/360°, where the mean hue wraps around.
    for (const [c, h1, h2] of [[30, 80, 100], [30, 350, 10], [12, 250, 280]] as const) {
      const p1 = lab(60, c * Math.cos(h1 * rad), c * Math.sin(h1 * rad)), p2 = lab(60, c * Math.cos(h2 * rad), c * Math.sin(h2 * rad));
      // Chroma C′ after the a′ scaling of the CIEDE2000 definition.
      const k = onePlusG(c, c);
      const cp = (p: CielabColor): number => Math.hypot(p.aStar * k, p.bStar);
      const hp = (p: CielabColor): number => (Math.atan2(p.bStar, p.aStar * k) / rad + 360) % 360;
      const c1 = cp(p1), c2 = cp(p2), g1 = hp(p1), g2 = hp(p2);
      let dh = g2 - g1; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      let hBar = (g1 + g2) / 2; if (Math.abs(g1 - g2) > 180) hBar += hBar < 180 ? 180 : -180;
      const cBar = (c1 + c2) / 2;
      const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
      const dC = c2 - c1;
      // Rotation term R_T = −2√(C̄′⁷/(C̄′⁷+25⁷)) sin(60° exp(−((h̄′−275°)/25°)²)).
      const rT = -2 * Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad);
      const sC = 1 + 0.045 * cBar, sH = 1 + 0.015 * cBar * tHue(hBar);
      const expected = Math.sqrt((dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
      expect(de00(p1, p2), h1 + "→" + h2).toBeCloseTo(expected, 12);
    }
    // Symmetry, identity and non-negativity on deterministic pseudo-random pairs.
    let seed = 12345;
    const next = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 200; i++) {
      const p = lab(100 * next(), 160 * next() - 80, 160 * next() - 80), q = lab(100 * next(), 160 * next() - 80, 160 * next() - 80);
      const forward = de00(p, q);
      expect(forward).toBeGreaterThan(0);
      expect(de00(q, p)).toBeCloseTo(forward, 12);
      expect(de00(p, p)).toBe(0);
    }
    const k = calculateColorDifference({ reference: lab(50, 0, 0), sample: lab(52, 0, 0), formula: "ciede2000", parametricFactors: { lightness: 2, chroma: 1, hue: 1 } }).value.deltaE;
    expect(k).toBeCloseTo(calculateColorDifference({ reference: lab(50, 0, 0), sample: lab(52, 0, 0), formula: "ciede2000" }).value.deltaE / 2, 12);
    expect(() => calculateColorDifference({ reference: lab(50, 0, 0), sample: lab(52, 0, 0), formula: "cie76", parametricFactors: { lightness: 1, chroma: 1, hue: 1 } })).toThrow();
    expect(() => calculateColorDifference({ reference: lab(50, 0, 0), sample: lab(52, 0, 0), formula: "x" as "cie76" })).toThrow();
  });
  it("computes ΔE*ab and the asymmetric CIE94 formulas (closed forms computed in the test)", () => {
    expect(calculateColorDifference({ reference: lab(50, 0, 0), sample: lab(53, 4, 0), formula: "cie76" }).value.deltaE).toBe(5);
    // Default: the reference conditions k_L = k_C = k_H = 1, K1 = 0.045, K2 = 0.015. Caller-supplied
    // factors use arbitrary test values (not a published preset) so every factor is exercised.
    const custom = { lightness: 2, chroma: 1.5, hue: 0.8, k1: 0.03, k2: 0.02 };
    const cases = [
      { factors: undefined, kL: 1, kC: 1, kH: 1, k1: 0.045, k2: 0.015 },
      { factors: custom, kL: 2, kC: 1.5, kH: 0.8, k1: 0.03, k2: 0.02 }
    ] as const;
    for (const { factors, kL, kC, kH, k1, k2 } of cases) {
      const de94 = (r: CielabColor, t: CielabColor): number =>
        calculateColorDifference(factors === undefined ? { reference: r, sample: t, formula: "cie94" } : { reference: r, sample: t, formula: "cie94", cie94Factors: factors }).value.deltaE;
      // Pure ΔL (any chroma, same a*, b*): ΔE94 = |ΔL| / k_L.
      for (const [l1, l2, a, b] of [[40, 44, 0, 0], [60, 52.5, 12, -7], [20, 21, -30, 40]] as const) {
        expect(de94(lab(l1, a, b), lab(l2, a, b))).toBeCloseTo(Math.abs(l2 - l1) / kL, 13);
      }
      // Pure chroma on the +a* axis (same L*, hue 0): ΔE94 = |ΔC| / (k_C (1 + K1·C1)), C1 the reference chroma.
      for (const [c1, c2] of [[10, 12], [30, 22], [2, 50]] as const) {
        expect(de94(lab(50, c1, 0), lab(50, c2, 0))).toBeCloseTo(Math.abs(c2 - c1) / (kC * (1 + k1 * c1)), 13);
      }
      // Equal chroma, hue only: ΔE94 = |ΔH| / (k_H (1 + K2·C1)) with ΔH = 2C sin(Δh/2).
      for (const [c, h1, h2] of [[10, 0, 0.1], [35, 1, 2.2], [60, -2, 2.5]] as const) {
        const r = lab(55, c * Math.cos(h1), c * Math.sin(h1)), t = lab(55, c * Math.cos(h2), c * Math.sin(h2));
        expect(de94(r, t)).toBeCloseTo(Math.abs(2 * c * Math.sin((h2 - h1) / 2)) / (kH * (1 + k2 * c)), 12);
      }
      // Asymmetry: S_C and S_H use the reference chroma, so swapping reference and sample changes ΔE94 when C1 ≠ C2.
      const r = lab(50, 10, 0), t = lab(50, 20, 0);
      expect(de94(r, t)).toBeCloseTo(10 / (kC * (1 + k1 * 10)), 13);
      expect(de94(t, r)).toBeCloseTo(10 / (kC * (1 + k1 * 20)), 13);
    }
    // Passing the reference conditions explicitly equals the default; zero K1, K2 are allowed (S_C = S_H = 1).
    const p = lab(50, 10, 5), q = lab(53, 14, -2);
    expect(calculateColorDifference({ reference: p, sample: q, formula: "cie94", cie94Factors: { lightness: 1, chroma: 1, hue: 1, k1: 0.045, k2: 0.015 } }).value.deltaE)
      .toBe(calculateColorDifference({ reference: p, sample: q, formula: "cie94" }).value.deltaE);
    expect(calculateColorDifference({ reference: p, sample: q, formula: "cie94", cie94Factors: { lightness: 1, chroma: 1, hue: 1, k1: 0, k2: 0 } }).value.deltaE)
      .toBeCloseTo(calculateColorDifference({ reference: p, sample: q, formula: "cie76" }).value.deltaE, 13);
    // Rejection of bad factors.
    const de94With = (cie94Factors: unknown): unknown => calculateColorDifference({ reference: p, sample: q, formula: "cie94", cie94Factors: cie94Factors as never });
    for (const bad of [
      { ...custom, lightness: 0 }, { ...custom, chroma: -1 }, { ...custom, hue: Number.NaN }, { ...custom, k1: -0.01 },
      { ...custom, k2: Number.POSITIVE_INFINITY }, { lightness: 1, chroma: 1, hue: 1, k1: 0.045 }, { ...custom, k2: "0.015" }
    ]) {
      expect(() => de94With(bad), JSON.stringify(bad)).toThrow(InvalidScientificInputError);
    }
    for (const bad of [null, [], 1, { ...custom, kL: 1 }]) {
      expect(() => de94With(bad), JSON.stringify(bad)).toThrow(InvalidConfigurationError);
    }
    expect(() => calculateColorDifference({ reference: p, sample: q, formula: "ciede2000", cie94Factors: custom })).toThrow(InvalidScientificInputError);
    expect(() => calculateColorDifference({ reference: p, sample: q, formula: "cie94", parametricFactors: { lightness: 1, chroma: 1, hue: 1 } })).toThrow(InvalidScientificInputError);
    // The removed presets are rejected.
    for (const formula of ["cie94-graphic-arts", "cie94-textiles"]) {
      expect(() => calculateColorDifference({ reference: p, sample: q, formula: formula as never })).toThrow(InvalidConfigurationError);
    }
  });
  it("converts XYZ ↔ CIELAB ↔ LCh exactly and continuously at the linear segment", () => {
    const white = { x: 0.3127 / 0.3290, y: 1, z: (1 - 0.3127 - 0.3290) / 0.3290 }; // D65 from ITU-R BT.709-6 xy
    expect(calculateCielabFromXyz({ xyz: white, referenceWhiteXyz: white }).value).toEqual({ lStar: 100, aStar: 0, bStar: 0 });
    const eps = (6 / 29) ** 3;
    const lo = calculateCielabFromXyz({ xyz: { x: 0, y: eps * (1 - 1e-12), z: 0 }, referenceWhiteXyz: white }).value.lStar;
    const hi = calculateCielabFromXyz({ xyz: { x: 0, y: eps * (1 + 1e-12), z: 0 }, referenceWhiteXyz: white }).value.lStar;
    expect(Math.abs(hi - lo)).toBeLessThan(1e-9);
    expect(lo).toBeCloseTo(8, 9);
    for (const xyz of [{ x: 0.2, y: 0.3, z: 0.4 }, { x: 0.001, y: 0.002, z: 0.0005 }, { x: 1.2, y: 1.1, z: 0.3 }]) {
      const l = calculateCielabFromXyz({ xyz, referenceWhiteXyz: white }).value;
      const back = calculateXyzFromCielab({ lab: l, referenceWhiteXyz: white }).value;
      expect(back.x).toBeCloseTo(xyz.x, 13); expect(back.y).toBeCloseTo(xyz.y, 13); expect(back.z).toBeCloseTo(xyz.z, 13);
      const lch = calculateCielchFromCielab({ lab: l }).value;
      expect(lch.hueDegrees).toBeGreaterThanOrEqual(0); expect(lch.hueDegrees).toBeLessThan(360);
      const l2 = calculateCielabFromCielch({ lch }).value;
      expect(l2.aStar).toBeCloseTo(l.aStar, 12); expect(l2.bStar).toBeCloseTo(l.bStar, 12);
    }
    expect(() => calculateCielabFromXyz({ xyz: { x: 0.2, y: 0.3, z: 0.4 }, referenceWhiteXyz: { x: 0, y: 1, z: 1 } })).toThrow();
    expect(() => calculateCielabFromCielch({ lch: { lStar: 50, chromaStar: -1, hueDegrees: 0 } })).toThrow();
  });
});

// foundation-10, foundation-11, foundation-12 (#699).
describe("colour edge inputs", () => {
  it("refuses a non-finite scalar result instead of returning Infinity or NaN (foundation-10)", () => {
    expect(() => calculatePlanckianSpectralRadiance({ temperatureKelvin: 1e300, wavelengthNanometers: 500 })).toThrow(InvalidScientificResultError);
    // λ⁵ underflows and the exponential overflows: the radiance is 0, not NaN.
    expect(calculatePlanckianSpectralRadiance({ temperatureKelvin: 5000, wavelengthNanometers: 1e-70 })).toBe(0);
    expect(calculatePlanckianSpectralRadiance({ temperatureKelvin: 5000, wavelengthNanometers: 500 })).toBe(
      (createPlanckianSpectrum({ temperatureKelvin: 5000, wavelengthRangeNanometers: { minimum: 400, maximum: 600 } }) as { evaluate(nm: number): number }).evaluate(500));
    expect(() => evaluateSrgbDecoding(1e200)).toThrow(InvalidScientificResultError);
    expect(evaluateSrgbDecoding(0.5)).toBeCloseTo(0.21404114048223255, 15);
    const eotf = prepareBt1886Eotf({ whiteLuminanceCdPerSquareMeter: 100, blackLuminanceCdPerSquareMeter: 0.1 });
    expect(() => eotf.decode(1e200)).toThrow(InvalidScientificResultError);
    expect(Number.isFinite(eotf.decode(1))).toBe(true);
  });

  it("reads back a chromaticity made at |Duv| = 0.05 (foundation-11)", () => {
    const locus = { kind: "planck-analytic-cmf" as const };
    let physical = 0;
    for (const t of [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 6500, 7000, 8000, 10000, 12000, 15000, 20000, 30000, 50000, 70000, 100000]) {
      for (const duv of [-0.05, 0.05]) {
        let xy;
        try { xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: t, duv, whiteLocus: "planckian", locus }).value; } catch { continue; }
        physical++;
        const back = calculateCorrelatedColorTemperature({ chromaticity: xy, locus }).value;
        expect(Math.abs(back.correlatedColorTemperatureKelvin / t - 1), t + " " + duv).toBeLessThan(1e-9);
        expect(Math.abs(back.duv)).toBeLessThanOrEqual(0.05);
        expect(back.duv).toBeCloseTo(duv, 12);
      }
    }
    expect(physical).toBeGreaterThan(30);
  });

  it("returns one node when the maximum subinterval is far wider than the range (foundation-12)", () => {
    for (const width of [470, 1e9, 1e12, 1e300]) {
      expect(createColorimetricMidpointQuadrature({ wavelengthRangeNanometers: { minimum: 360, maximum: 830 }, maximumSubintervalWidthNanometers: width }), String(width))
        .toEqual([{ wavelengthNanometers: 595, wavelengthMeasureNanometers: 470 }]);
    }
  });
});
