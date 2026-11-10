// SPDX-License-Identifier: Apache-2.0
/**
 * #557: the representative light sources designed by Photivra (tri-phosphor fluorescent and three white LEDs). The set
 * contract, the formula, each spectrum's CCT checked with the engine's own CCT code, the color-rendering difference of
 * the same-CCT pair on the engine's color patches, rendering through the capture facade, and the unchanged existing
 * illuminants.
 *
 * Independent expectations: the formula is re-evaluated here from the published bands with `Math.exp`; CCT and Duv come
 * from the engine's locus search and McCamy's cubic (no CIE table is used); patch colors are integrated against the
 * engine's analytic CIE 1931 fit, so the ΔE00 values are those documented in docs/LIGHT_SOURCES.md.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COLOR_PATCH_IDS, InvalidConfigurationError, InvalidScientificInputError, REPRESENTATIVE_LIGHT_SOURCE_IDS, REPRESENTATIVE_LIGHT_SOURCE_SET_ID,
  REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION, calculateCielabFromXyz, calculateColorDifference, calculateCorrelatedColorTemperature, createPlanckianSpectrum,
  createRepresentativeLightSourceIlluminant, createRepresentativeLightSourceSpectrum, estimateCorrelatedColorTemperatureMcCamy, evaluateColorPatchReflectance,
  getColorPatchSet, getRepresentativeLightSourceSet, integrateSpectrumToXyz, resolveCaptureIlluminant, simulateIdealReference, type CaptureIlluminant,
  type ColorimetricSpectrum, type CorrelatedColorTemperatureResult, type IntegratedSpectrumXyz, type RepresentativeLightSourceId } from "../src/index.js";
import { resolvePortableCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

type Lab = { lStar: number; aStar: number; bStar: number };
const set = getRepresentativeLightSourceSet();
const patches = getColorPatchSet().patches;
const NODES = Array.from({ length: 471 }, (_, i) => ({ wavelengthNanometers: 360 + i, wavelengthMeasureNanometers: 1 }));
const LOCUS = { kind: "planck-analytic-cmf" } as const;
const integrate = (spectrum: ColorimetricSpectrum, factor?: ColorimetricSpectrum): IntegratedSpectrumXyz => integrateSpectrumToXyz({ quadratureNodes: NODES, spectralDistribution: spectrum,
  ...(factor ? { spectralFactor: factor } : {}), colorMatchingFunctions: { kind: "analytic-cie-1931-multi-lobe-fit" }, normalization: { kind: "white-luminance-one" } }).value;
const reflectance = (patchId: (typeof COLOR_PATCH_IDS)[number]): ColorimetricSpectrum => ({ kind: "function", wavelengthRangeNanometers: { minimum: 360, maximum: 830 },
  evaluate: (nm) => evaluateColorPatchReflectance({ patchId, wavelengthNanometers: nm }).value.reflectance });
const de00 = (a: Lab, b: Lab): number => calculateColorDifference({ formula: "ciede2000", reference: a, sample: b }).value.deltaE;
/** CIELAB of every patch under a spectrum, relative to that spectrum's own perfect diffuser (CIE 1931 analytic fit, 1 nm). */
function patchLabs(spectrum: ColorimetricSpectrum): Map<string, Lab> {
  return new Map(patches.map((p) => {
    const r = integrate(spectrum, reflectance(p.patchId));
    return [p.code, calculateCielabFromXyz({ xyz: r.xyz, referenceWhiteXyz: r.whiteXyz }).value];
  }));
}
const spectrumOf = (sourceId: RepresentativeLightSourceId): ColorimetricSpectrum => createRepresentativeLightSourceSpectrum({ sourceId });
const cctOf = (sourceId: RepresentativeLightSourceId): CorrelatedColorTemperatureResult => calculateCorrelatedColorTemperature({ chromaticity: integrate(spectrumOf(sourceId)).chromaticity!, locus: LOCUS }).value;
const colored = patches.filter((p) => p.group !== "neutral").map((p) => p.code);

describe("the representative light-source set (#557)", () => {
  it("lists four sources with stable ids, Photivra names, reasons and the representative label, deeply frozen", () => {
    expect(REPRESENTATIVE_LIGHT_SOURCE_SET_ID).toBe("photivra-representative-light-sources");
    expect(REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION).toBe("1.0.0");
    expect(set.sources.map((s) => s.sourceId)).toEqual([...REPRESENTATIVE_LIGHT_SOURCE_IDS]);
    expect(set.sources.map((s) => [s.family, s.nominalCorrelatedColorTemperatureKelvin])).toEqual([["fluorescent", 4000], ["led", 4000], ["led", 4000], ["led", 2700]]);
    expect(Object.isFrozen(set) && Object.isFrozen(set.sources) && Object.isFrozen(REPRESENTATIVE_LIGHT_SOURCE_IDS)).toBe(true);
    for (const s of set.sources) {
      expect(s.label).toBe("representative, not a named product");
      expect(s.name).toMatch(/^[A-Z][A-Za-z -]+, (?:[a-z ]+, )?\d{4} K$/u);
      expect(s.reason).toMatch(/^[A-Z][^.]*\.$/u);
      expect(Object.isFrozen(s) && Object.isFrozen(s.bands) && s.bands.every((b) => Object.isFrozen(b))).toBe(true);
    }
  });

  it("evaluates the documented formula, positive on 360–830 nm, the same for every call", () => {
    for (const s of set.sources) {
      const spectrum = spectrumOf(s.sourceId) as Extract<ColorimetricSpectrum, { kind: "function" }>;
      expect(spectrum.wavelengthRangeNanometers).toEqual({ minimum: 360, maximum: 830 });
      for (let nm = 360; nm <= 830; nm += 0.5) {
        const expected = s.bands.reduce((sum, b) => sum + b.amplitude * Math.exp(-0.5 * ((nm - b.centerNanometers) / b.standardDeviationNanometers) ** 2), s.base);
        const value = spectrum.evaluate(nm);
        expect(Math.abs(value - expected)).toBeLessThanOrEqual(4e-16 * Math.max(1, expected));
        expect(value).toBeGreaterThan(0);
        expect(spectrum.evaluate(nm)).toBe(value);
      }
    }
  });

  it("rejects unknown sources, unknown fields and wavelengths outside the domain", () => {
    expect(() => createRepresentativeLightSourceSpectrum({ sourceId: "cie-f11" as RepresentativeLightSourceId })).toThrow(InvalidConfigurationError);
    expect(() => createRepresentativeLightSourceSpectrum({ sourceId: "warm-white-led-2700k", extra: 1 } as never)).toThrow();
    expect(() => createRepresentativeLightSourceIlluminant(undefined as never)).toThrow();
    const spectrum = spectrumOf("warm-white-led-2700k") as Extract<ColorimetricSpectrum, { kind: "function" }>;
    for (const nm of [359.9, 830.1, Number.NaN]) expect(() => spectrum.evaluate(nm)).toThrow(InvalidScientificInputError);
  });

  it("puts every spectrum at its stated CCT on the Planckian locus: within 1 K and |Duv| ≤ 0.0001 (locus search), 10 K (McCamy)", () => {
    for (const s of set.sources) {
      const white = integrate(spectrumOf(s.sourceId));
      const { correlatedColorTemperatureKelvin: cct, duv } = calculateCorrelatedColorTemperature({ chromaticity: white.chromaticity!, locus: LOCUS }).value;
      expect(Math.abs(cct - s.nominalCorrelatedColorTemperatureKelvin)).toBeLessThanOrEqual(1);
      expect(Math.abs(duv)).toBeLessThanOrEqual(1e-4);
      const mccamy = estimateCorrelatedColorTemperatureMcCamy({ chromaticity: white.chromaticity! }).value.correlatedColorTemperatureKelvin;
      expect(Math.abs(mccamy - s.nominalCorrelatedColorTemperatureKelvin)).toBeLessThanOrEqual(10);
    }
    // The documented values (docs/LIGHT_SOURCES.md, "Checked color temperature").
    expect(REPRESENTATIVE_LIGHT_SOURCE_IDS.map((id) => Math.round(cctOf(id).correlatedColorTemperatureKelvin * 10) / 10)).toEqual([4000.8, 3999.6, 4000, 2699.9]);
  });

  it("renders the same-CCT pair visibly differently: ΔE00 5.05 on PV-S1, 4.67 on PV-P2 and 5.86 on PV-G1 (low vs high color rendering)", () => {
    const low = patchLabs(spectrumOf("white-led-low-rendering-4000k")), high = patchLabs(spectrumOf("white-led-high-rendering-4000k"));
    const pair = (code: string): number => de00(low.get(code)!, high.get(code)!);
    expect(pair("PV-S1")).toBeCloseTo(5.05, 2);
    expect(pair("PV-P2")).toBeCloseTo(4.67, 2);
    expect(pair("PV-G1")).toBeCloseTo(5.86, 2);
    expect(colored.reduce((sum, code) => sum + pair(code), 0) / colored.length).toBeCloseTo(3.68, 2);
    // Neutral patches stay neutral under each light (CIELAB relative to the light's own white).
    for (const code of ["PV-N1", "PV-N4", "PV-N6"]) for (const lab of [low.get(code)!, high.get(code)!]) expect(Math.hypot(lab.aStar, lab.bStar)).toBeLessThan(1e-9);
  });

  it("gives the documented patch color shift against a Planckian reference at each source's own CCT", () => {
    const shifts = REPRESENTATIVE_LIGHT_SOURCE_IDS.map((id) => {
      const test = patchLabs(spectrumOf(id));
      const reference = patchLabs(createPlanckianSpectrum({ temperatureKelvin: cctOf(id).correlatedColorTemperatureKelvin, wavelengthRangeNanometers: { minimum: 360, maximum: 830 } }));
      const values = colored.map((code) => de00(reference.get(code)!, test.get(code)!));
      return [Math.round(100 * values.reduce((a, b) => a + b, 0) / values.length) / 100, Math.round(100 * Math.max(...values)) / 100];
    });
    expect(shifts).toEqual([[2.87, 6.49], [4, 5.49], [0.67, 2.15], [1.18, 2.2]]);
  });
});

describe("the sources through the capture facade (#557)", () => {
  /** CIELAB of the patches of a 5 nm ideal-reference render, relative to the sRGB white scaled to the white neutral's reflectance. */
  const LINEAR_SRGB_TO_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545],
    [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
  const decode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  async function rendered(illuminant: CaptureIlluminant): Promise<Lab[]> {
    const cell = 10, width = 60;
    const image = (await simulateIdealReference({ scene: { preset: "color-patches" }, illuminant, sensor: { spectralStepNanometers: 5 },
      output: { width, height: 50, format: "srgb-16" } })).image;
    const xyz = COLOR_PATCH_IDS.map((_, index) => {
      const x0 = (index % 6) * cell + 3, y0 = Math.floor(index / 6) * cell + 3, sum = [0, 0, 0];
      for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) for (let c = 0; c < 3; c++) sum[c]! += decode(image.samples[(y * width + x) * 3 + c]! / 65535) / 16;
      return LINEAR_SRGB_TO_XYZ.map((row) => row[0]! * sum[0]! + row[1]! * sum[1]! + row[2]! * sum[2]!);
    });
    const whiteY = xyz[0]![1]! / patches[0]!.base;
    return xyz.map((v) => calculateCielabFromXyz({ xyz: { x: v[0]!, y: v[1]!, z: v[2]! },
      referenceWhiteXyz: { x: (0.3127 / 0.329) * whiteY, y: whiteY, z: ((1 - 0.3127 - 0.329) / 0.329) * whiteY } }).value);
  }

  it("is accepted as a spectrum illuminant with its representative label, and the pair renders visibly differently", async () => {
    const illuminant = createRepresentativeLightSourceIlluminant({ sourceId: "white-led-low-rendering-4000k" });
    expect(illuminant.label).toBe("White LED, low color rendering, 4000 K (representative, not a named product)");
    expect(resolveCaptureIlluminant(illuminant).description).toBe("Caller illuminant spectrum (" + illuminant.label + ").");
    const low = await rendered(illuminant);
    const high = await rendered(createRepresentativeLightSourceIlluminant({ sourceId: "white-led-high-rendering-4000k" }));
    const index = (code: string): number => patches.findIndex((p) => p.code === code);
    // Measured 5.07 (PV-S1) and 4.70 (PV-P2) at 5 nm; the colorimetric values are 5.05 and 4.67.
    expect(de00(low[index("PV-S1")]!, high[index("PV-S1")]!)).toBeGreaterThan(4.8);
    expect(de00(low[index("PV-P2")]!, high[index("PV-P2")]!)).toBeGreaterThan(4.4);
    for (const lab of [low[index("PV-N4")]!, high[index("PV-N4")]!]) expect(Math.hypot(lab.aStar, lab.bStar)).toBeLessThan(0.2);
  }, scaledTimeout(20_000));

  it("keeps the fluorescent source's neutrals neutral at the recommended 5 nm sensor step", async () => {
    const lab = await rendered(createRepresentativeLightSourceIlluminant({ sourceId: "tri-phosphor-fluorescent-4000k" }));
    for (let i = 0; i < 6; i++) expect(Math.hypot(lab[i]!.aStar, lab[i]!.bStar)).toBeLessThan(0.2);
  }, scaledTimeout(20_000));
});

/**
 * The existing illuminants are unchanged: SHA-256 of their 1 nm values on 380–780 nm (float64, little-endian), from the
 * portable resolution the display view uses, whose bits are the same in every JavaScript engine. Recorded on main 9c81348
 * (2.19.0) before the representative sources were added; #557 does not touch `illuminants.ts` or `scene-radiance.ts`.
 */
describe("existing illuminants (#557)", () => {
  const cases: [string, CaptureIlluminant, string][] = [
    ["cie-a", "cie-a", "13955117a3af3b93a2f7e52498a1eac76b78f750693a9e4362e72a42596777a0"],
    ["planckian 2700 K", { kind: "planckian", temperatureKelvin: 2700 }, "ed50cc73d7c6959512fb92b866e20b90bca22c00e7c5494151ab2cefaf0f1215"],
    ["planckian 6500 K", { kind: "planckian", temperatureKelvin: 6500 }, "b980b9b74adae866f0f321b501692c618f73f3e2da6b57b6337566031cd7a521"]
  ];
  for (const [label, illuminant, hash] of cases) {
    it("resolves " + label + " byte-identically to 2.19.0", () => {
      const shape = resolvePortableCaptureIlluminant(illuminant).shape;
      const values = Float64Array.from({ length: 401 }, (_, i) => shape.evaluate(380 + i));
      const actual = createHash("sha256").update(new Uint8Array(values.buffer)).digest("hex");
      if (process.env.PHOTIVRA_PRINT_ILLUMINANT_BASELINE) console.log(label, actual);
      expect(actual).toBe(hash);
    });
  }
});
