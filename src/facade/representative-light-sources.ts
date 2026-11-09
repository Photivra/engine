// SPDX-License-Identifier: Apache-2.0

/**
 * Representative light sources (#557): four relative spectral power distributions designed by Photivra for indoor
 * light presets, so that two lights at the same correlated color temperature (CCT) can render colors differently.
 *
 * Every spectrum is an engine-defined analytic function of wavelength, not measured or copied data: a constant plus a
 * sum of Gaussian bands,
 *
 *   S(λ) = b + Σₖ aₖ·exp(−½·((λ − μₖ)/σₖ)²),
 *
 * with λ in nanometers on 360–830 nm (the CIE 1931 observer's domain), in relative units (the capture facade scales an
 * illuminant to its lux). Each source's band shapes were chosen by Photivra to represent a kind of lamp; two amplitudes
 * (or one amplitude and one band center) were then solved so the chromaticity lies on the Planckian locus at the stated
 * CCT, and rounded (amplitudes to 0.001, wavelengths to 0.1 nm). Those rounded values are the definition. The CCT and
 * Duv of every rounded spectrum are checked with the engine's own `calculateCorrelatedColorTemperature` and
 * `estimateCorrelatedColorTemperatureMcCamy` (docs/LIGHT_SOURCES.md, test/representative-light-sources.test.ts).
 *
 * These are representative constructions, not named products: no CIE, IES or manufacturer spectral data, names or
 * tables are used. The bands are wider than the emission lines of real fluorescent phosphors so that the 5 nm sensor
 * quadrature recommended for color work integrates them; real lamps of each kind vary widely.
 *
 * The exponentials use the portable `portableExp`, so a spectrum's values have the same bits in every JavaScript
 * engine, in captures and in the display view alike.
 *
 * The module is not reached by `simulateCapture` itself: an application passes a spectrum as
 * `illuminant: { kind: "spectrum", spectrum }` (or {@link createRepresentativeLightSourceIlluminant}), so bundles that
 * do not use the sources do not contain them.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys } from "../core/record-validation.js";
import { portableExp } from "../core/portable-math.js";
import type { ColorimetricSpectrum } from "../color/color-matching-functions.js";
import type { CaptureIlluminant } from "./scene-radiance.js";

/** Identity of the built-in light-source set. */
export const REPRESENTATIVE_LIGHT_SOURCE_SET_ID = "photivra-representative-light-sources";
/** Version of the set's spectra; a change to any spectrum changes it. */
export const REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION = "1.0.0";
/** Domain of every spectrum, nm (the CIE 1931 observer's domain; the capture facade uses 380–780 nm of it). */
export const REPRESENTATIVE_LIGHT_SOURCE_WAVELENGTH_RANGE_NANOMETERS = /* @__PURE__ */ Object.freeze({ minimum: 360, maximum: 830 });

/** The source ids, in set order. */
export const REPRESENTATIVE_LIGHT_SOURCE_IDS = /* @__PURE__ */ Object.freeze([
  "tri-phosphor-fluorescent-4000k", "white-led-low-rendering-4000k", "white-led-high-rendering-4000k", "warm-white-led-2700k"
] as const);
export type RepresentativeLightSourceId = (typeof REPRESENTATIVE_LIGHT_SOURCE_IDS)[number];

/** One Gaussian band a·exp(−½((λ − μ)/σ)²) of a source spectrum. */
export interface RepresentativeLightSourceBand {
  kind: "gaussian";
  /** What the band represents, for example "blue pump" or "green phosphor line". */
  role: string;
  amplitude: number;
  centerNanometers: number;
  standardDeviationNanometers: number;
}

/** One built-in source: its id, name, design reason and spectrum definition. */
export interface RepresentativeLightSource {
  sourceId: RepresentativeLightSourceId;
  /** Photivra's descriptive name, for example "White LED, high color rendering, 4000 K". */
  name: string;
  family: "fluorescent" | "led";
  /** The CCT the spectrum was designed for, K (its computed CCT is within 1 K of it, Duv within 0.0001; docs/LIGHT_SOURCES.md). */
  nominalCorrelatedColorTemperatureKelvin: number;
  /** Always "representative, not a named product". */
  label: "representative, not a named product";
  /** One sentence: what the source represents and why it is built this way. */
  reason: string;
  /** The constant b (a low continuum), relative units. */
  base: number;
  bands: readonly RepresentativeLightSourceBand[];
}

export interface RepresentativeLightSourceSet {
  setId: typeof REPRESENTATIVE_LIGHT_SOURCE_SET_ID;
  setVersion: typeof REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION;
  wavelengthRangeNanometers: { readonly minimum: number; readonly maximum: number };
  sources: readonly RepresentativeLightSource[];
}

const LABEL = "representative, not a named product" as const;
type BandRow = readonly [role: string, amplitude: number, centerNanometers: number, standardDeviationNanometers: number];
/* Photivra's design (docs/LIGHT_SOURCES.md, "The spectra"); the solved values were rounded and are the definition. */
const ROWS: readonly (readonly [RepresentativeLightSourceId, string, "fluorescent" | "led", number, string, number, readonly BandRow[]])[] = [
  ["tri-phosphor-fluorescent-4000k", "Tri-phosphor fluorescent, 4000 K", "fluorescent", 4000,
    "Three narrow emission bands in the blue, green and red on a low continuum, the construction of a tri-phosphor fluorescent tube, which leaves gaps between the bands.",
    0.02, [["blue phosphor band", 0.285, 450, 6], ["green phosphor line", 1, 544, 3.5], ["red phosphor line", 1.02, 611, 3.5]]],
  ["white-led-low-rendering-4000k", "White LED, low color rendering, 4000 K", "led", 4000,
    "A blue pump peak and one broad yellow phosphor band, the simplest white LED, which is weak in the cyan and the deep red.",
    0, [["blue pump", 1.123, 450, 9], ["yellow phosphor", 1, 579.1, 50]]],
  ["white-led-high-rendering-4000k", "White LED, high color rendering, 4000 K", "led", 4000,
    "A blue pump with a green and a red phosphor band that fill the cyan and the red, a white LED built for high color rendering at the same CCT as the low-rendering one.",
    0, [["blue pump", 1.306, 450, 9], ["green phosphor", 1, 530, 35], ["red phosphor", 1.264, 630, 40]]],
  ["warm-white-led-2700k", "Warm white LED, 2700 K", "led", 2700,
    "The same pump and two-phosphor construction with more red phosphor and less pump, a warm white LED for home lighting.",
    0, [["blue pump", 0.795, 450, 9], ["green phosphor", 1, 540, 38], ["red phosphor", 2.133, 630, 40]]]
];

const SET: RepresentativeLightSourceSet = /* @__PURE__ */ ((): RepresentativeLightSourceSet => Object.freeze({
  setId: REPRESENTATIVE_LIGHT_SOURCE_SET_ID,
  setVersion: REPRESENTATIVE_LIGHT_SOURCE_SET_VERSION,
  wavelengthRangeNanometers: REPRESENTATIVE_LIGHT_SOURCE_WAVELENGTH_RANGE_NANOMETERS,
  sources: Object.freeze(ROWS.map(([sourceId, name, family, cct, reason, base, bands]) => Object.freeze({
    sourceId, name, family, nominalCorrelatedColorTemperatureKelvin: cct, label: LABEL, reason, base,
    bands: Object.freeze(bands.map(([role, amplitude, centerNanometers, standardDeviationNanometers]) =>
      Object.freeze({ kind: "gaussian" as const, role, amplitude, centerNanometers, standardDeviationNanometers })))
  })))
}))();

/**
 * The built-in representative light sources: Photivra's own parametric spectra of a tri-phosphor fluorescent tube and
 * three white LEDs (low and high color rendering at 4000 K, warm at 2700 K). A static, deeply frozen engine contract.
 * Each is "representative, not a named product"; docs/LIGHT_SOURCES.md gives every formula and the reasons for it.
 */
export function getRepresentativeLightSourceSet(): RepresentativeLightSourceSet {
  return SET;
}

function findSource(input: unknown, functionName: string): RepresentativeLightSource {
  requireInputKeys(input, functionName, ["sourceId"]);
  const id = (input as { sourceId?: unknown }).sourceId;
  const source = typeof id === "string" ? SET.sources.find((s) => s.sourceId === id) : undefined;
  if (!source) throw new InvalidConfigurationError("sourceId must be one of the built-in representative light sources (REPRESENTATIVE_LIGHT_SOURCE_IDS).");
  return source;
}

/** Most wavelengths whose values one spectrum keeps (a capture uses a few hundred). */
const CACHE_LIMIT = 4096;

/**
 * A source's relative spectral power distribution S(λ) = b + Σ aₖ·exp(−½((λ − μₖ)/σₖ)²) as a function spectrum on
 * 360–830 nm (relative units; values memoized per wavelength). Pass it to a capture as
 * `illuminant: { kind: "spectrum", spectrum }`; for color work use `sensor.spectralStepNanometers: 5` or finer
 * (docs/LIGHT_SOURCES.md, "Quadrature"). Throws `InvalidScientificInputError` outside 360–830 nm.
 */
export function createRepresentativeLightSourceSpectrum(input: { sourceId: RepresentativeLightSourceId }): ColorimetricSpectrum {
  const source = findSource(input, "createRepresentativeLightSourceSpectrum");
  const range = REPRESENTATIVE_LIGHT_SOURCE_WAVELENGTH_RANGE_NANOMETERS, cache = new Map<number, number>();
  return {
    kind: "function",
    wavelengthRangeNanometers: { minimum: range.minimum, maximum: range.maximum },
    evaluate(nm: number): number {
      const hit = cache.get(nm);
      if (hit !== undefined) return hit;
      if (typeof nm !== "number" || !(nm >= range.minimum && nm <= range.maximum)) {
        throw new InvalidScientificInputError("Representative light source " + source.sourceId + " is defined on 360–830 nm.");
      }
      let value = source.base;
      for (const band of source.bands) {
        const z = (nm - band.centerNanometers) / band.standardDeviationNanometers;
        value += band.amplitude * portableExp(-0.5 * z * z);
      }
      if (cache.size < CACHE_LIMIT) cache.set(nm, value);
      return value;
    }
  };
}

/**
 * A capture illuminant for a source: `{ kind: "spectrum", spectrum, label }` with the spectrum of
 * {@link createRepresentativeLightSourceSpectrum} and the label "<name> (representative, not a named product)".
 */
export function createRepresentativeLightSourceIlluminant(input: { sourceId: RepresentativeLightSourceId }): Extract<CaptureIlluminant, { kind: "spectrum" }> {
  const source = findSource(input, "createRepresentativeLightSourceIlluminant");
  return { kind: "spectrum", spectrum: createRepresentativeLightSourceSpectrum({ sourceId: source.sourceId }), label: source.name + " (" + LABEL + ")" };
}
