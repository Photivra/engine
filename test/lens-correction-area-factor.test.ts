// SPDX-License-Identifier: Apache-2.0

/**
 * #584: the catalogue profile's vignetting component carries the distortion's area factor (`distortionAreaFactor`), so applying it
 * through the public profile APIs (`calculatePeripheralIlluminationCorrection`, `calculateLensCorrectedCapture`) flattens a
 * flat-field catalogue capture, on a barrel (PV 16 2.8) and a pincushion (PV 300 5.6) lens; profiles without the field keep 1/E.
 */
import { describe, expect, it } from "vitest";
import {
  calculateLensCorrectedCapture, calculatePeripheralIlluminationCorrection, createGenericLensCorrectionProfile, parseGenericLensCorrectionProfile,
  resolveGenericLens, resolveLensCorrectionPlan, simulateCapture, type GenericLensCorrectionProfile, type GeometricRaster, type IlluminationLensCorrection,
  type SimulateCaptureResult
} from "../src/index.js";
import { genericLensDispersion } from "../src/equipment/generic-lens-catalogue.js";
import { applyDevelopedLensCorrection, prepareDevelopedLensCorrection } from "../src/output/developed-lens-corrections.js";
import { resampler } from "./optics-group-fixtures.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const W = 48, H = 32, PITCH_MM = 0.75, AREA = { widthMm: W * PITCH_MM, heightMm: H * PITCH_MM };
const stateOf = (lensId: string, fNumber: number): GenericLensCorrectionProfile["state"] => ({ bodyId: "b", bodyVersion: "1", lensId, lensVersion: "1",
  focalLengthMm: resolveGenericLens({ lensId, activeImagingArea: AREA, fNumber }).focalLengthMm, aperture: fNumber, focusDistanceM: 5,
  captureMode: "still" as const, outputWidth: W, outputHeight: H, frameRateHz: 0, stabilizationMode: "off" });
/** sRGB EOTF (W3C CSS Color 4) of a 16-bit code: the identity tone curve's developed linear value. */
const linear = (code: number): number => { const v = code / 65535; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** An uncorrected flat-field capture through the catalogue lens, as linear RGB channels. */
async function flatField(lensId: string, fNumber: number, seed: number): Promise<{ red: number[]; green: number[]; blue: number[] }> {
  const r: SimulateCaptureResult = await simulateCapture({ scene: { preset: "uniform", reflectance: 0.5 }, subjectDistanceM: 5, fast: true, lens: { catalogue: lensId, fNumber },
    exposure: { mode: "manual", shutterSeconds: 1 / 4000, iso: 100 }, sensor: { pixelPitchMicrometers: PITCH_MM * 1000, spectralStepNanometers: 50, noiseSeed: seed },
    output: { width: W, height: H, format: "srgb-16" } });
  const channels = { red: [] as number[], green: [] as number[], blue: [] as number[] };
  for (let i = 0; i < W * H; i++) (["red", "green", "blue"] as const).forEach((c, k) => channels[c].push(linear(r.image.samples[i * 3 + k]!)));
  return channels;
}
const raster: GeometricRaster = { width: W, height: H, centerMm: { x: 0, y: 0 }, pitchMm: PITCH_MM };
function correct(profile: GenericLensCorrectionProfile, channels: { red: number[]; green: number[]; blue: number[] }, selections: Record<string, "on" | "off">): (number | null)[] {
  const plan = resolveLensCorrectionPlan({ profile, state: profile.state, selections, outputKind: "processed", selectionKind: "camera-selectable" }).value;
  return [...calculateLensCorrectedCapture({ plan, capture: { state: profile.state, captureId: "c", noiseRealizationId: "n", timeSeconds: 0, raster, channels },
    destinationRaster: raster, resampler, physicalProjectionDistanceMm: profile.state.focalLengthMm, clippingLevel: 10 }).value.channels.green];
}
/** Mean of a square patch of the corrected green channel (pixels that have support). */
function patchMean(v: readonly (number | null)[], x0: number, y0: number, n: number): number {
  const values: number[] = [];
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) { const s = v[y * W + x]; if (s !== null && s !== undefined) values.push(s); }
  expect(values.length).toBeGreaterThan(n * n / 2);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

describe("the catalogue profile's vignetting gain includes the distortion's area factor (#584)", { timeout: scaledTimeout(60_000) }, () => {
  it.each([["pv-16-2.8", 2.8], ["pv-300-5.6", 5.6]] as const)("flattens a flat-field %s capture at f/%s (barrel, pincushion) through the profile APIs", async (lensId, fNumber) => {
    const profile = createGenericLensCorrectionProfile({ lensId, activeImagingArea: AREA, state: stateOf(lensId, fNumber) });
    const vignetting = profile.components.find((c) => c.kind === "peripheral-illumination") as IlluminationLensCorrection;
    expect(profile.version).toBe("1.1.0");
    expect(vignetting.version).toBe("1.1.0");
    expect(vignetting.distortionAreaFactor!.coefficients.k1).toBe(resolveGenericLens({ lensId, activeImagingArea: AREA }).character.distortion.corner);
    const [a, b] = await Promise.all([flatField(lensId, fNumber, 1), flatField(lensId, fNumber, 2)]);
    // Measured 2026-11-09 (48 × 32 frame, 750 µm sites): corner/centre within 0.06 % (PV 16 2.8) and 0.16 % (PV 300 5.6) of flat, with
    // and without the geometric corrections, against a seed-to-seed noise of 0.01–0.05 % per patch mean; without the area factor the
    // same corners are off by several per cent. The PV 300 5.6 residual is the capture's (its vignetting-only run shows it too).
    const n = 6, corners = [[1, 1], [W - 1 - n, 1], [1, H - 1 - n], [W - 1 - n, H - 1 - n]] as const, center = [(W - n) / 2, (H - n) / 2] as const;
    const legacyVignetting: IlluminationLensCorrection = { ...vignetting };
    delete legacyVignetting.distortionAreaFactor;
    const legacy = parseGenericLensCorrectionProfile({ ...profile, components: [profile.components[0], profile.components[1], legacyVignetting] });
    for (const selections of [{ vignetting: "on" as const, distortion: "off" as const, "lateral-ca": "off" as const }, { vignetting: "on" as const, distortion: "on" as const, "lateral-ca": "on" as const }]) {
      for (const [p, worst] of [[profile, 0.0025], [legacy, -0.02]] as const) {
        const ca = correct(p, a, selections), cb = correct(p, b, selections);
        const middle = (patchMean(ca, center[0], center[1], n) + patchMean(cb, center[0], center[1], n)) / 2;
        const errors = corners.map(([x, y]) => Math.abs((patchMean(ca, x, y, n) + patchMean(cb, x, y, n)) / 2 / middle - 1));
        if (worst > 0) expect(Math.max(...errors), lensId + " " + JSON.stringify(selections)).toBeLessThan(worst);
        else expect(Math.max(...errors), lensId + " without the area factor").toBeGreaterThan(-worst);
      }
    }
  });

  it("quantifies the error it removes: without the area factor the sensor corner's gain is off by 1/det J (PV 16 2.8 +23.8 %, PV 300 5.6 −6.6 %)", () => {
    for (const [lensId, fNumber, expected] of [["pv-16-2.8", 2.8, 1.2375], ["pv-300-5.6", 5.6, 0.9342]] as const) {
      const profile = createGenericLensCorrectionProfile({ lensId, activeImagingArea: AREA, state: stateOf(lensId, fNumber) });
      const withArea = profile.components.find((c) => c.kind === "peripheral-illumination") as IlluminationLensCorrection;
      const legacy: IlluminationLensCorrection = { ...withArea }, d = withArea.distortionAreaFactor;
      delete legacy.distortionAreaFactor;
      const corner = { x: AREA.widthMm / 2, y: AREA.heightMm / 2 }, at = (component: IlluminationLensCorrection): number =>
        calculatePeripheralIlluminationCorrection({ component, imagePointMm: corner, signal: 1, noiseVariance: 0, clippingLevel: 100 }).value.gain;
      // Independently: the ideal radius ρ_i with ρ_i(1 + k1ρ_i²) = 1 (Newton), then 1/det J = 1/((1 + k1ρ_i²)(1 + 3k1ρ_i²)).
      const k1 = d!.coefficients.k1;
      let ri = 1;
      for (let i = 0; i < 30; i++) ri -= (ri * (1 + k1 * ri * ri) - 1) / (1 + 3 * k1 * ri * ri);
      const ratio = at(legacy) / at(withArea);
      expect(ratio).toBeCloseTo(1 / ((1 + k1 * ri * ri) * (1 + 3 * k1 * ri * ri)), 9);
      expect(ratio).toBeCloseTo(expected, 4);
    }
  });

  it("keeps a profile without the field on 1/E at the output point, and parses the field strictly", () => {
    const profile = createGenericLensCorrectionProfile({ lensId: "pv-16-2.8", activeImagingArea: AREA, state: stateOf("pv-16-2.8", 2.8) });
    const [d, ca, v] = profile.components as [unknown, unknown, IlluminationLensCorrection];
    const { distortionAreaFactor, ...legacy } = v;
    const parsed = parseGenericLensCorrectionProfile({ ...profile, components: [d, ca, legacy] });
    expect("distortionAreaFactor" in parsed.components[2]!).toBe(false);
    const gain = calculatePeripheralIlluminationCorrection({ component: legacy, imagePointMm: { x: 10, y: 5 }, signal: 1, noiseVariance: 0, clippingLevel: 100 }).value.gain;
    const rho2 = (10 * 10 + 5 * 5) / legacy.profile.normalizationRadiusMm ** 2, { r2, r4, r6 } = legacy.profile.coefficients;
    expect(gain).toBeCloseTo(1 / (1 + r2 * rho2 + r4 * rho2 ** 2 + r6 * rho2 ** 3), 12);
    expect(() => parseGenericLensCorrectionProfile({ ...profile, components: [d, ca, { ...v, distortionAreaFactor: { ...distortionAreaFactor, extra: 1 } }] })).toThrow();
    expect(() => parseGenericLensCorrectionProfile({ ...profile, components: [d, ca, { ...v, distortionAreaFactor: { ...distortionAreaFactor, coefficients: { k1: -2, k2: 0, k3: 0 } } }] })).toThrow();
    expect(() => parseGenericLensCorrectionProfile({ ...profile, components: [{ ...(d as object), distortionAreaFactor }, ca, v] })).toThrow();
  });

  it("gives output.lensCorrections' kernel gain exactly (the #570 kernel keeps its own arithmetic)", () => {
    for (const [lensId, fNumber] of [["pv-16-2.8", 2.8], ["pv-300-5.6", 5.6]] as const) {
      const lens = resolveGenericLens({ lensId, activeImagingArea: AREA, fNumber }), profile = createGenericLensCorrectionProfile({ lensId, activeImagingArea: AREA, state: stateOf(lensId, fNumber) });
      const c = prepareDevelopedLensCorrection(lens, { distortion: false, lateralColor: false, vignetting: true }, W, H, PITCH_MM, genericLensDispersion), frameRect = { x: 0, y: 0, width: W, height: H };
      const ones = applyDevelopedLensCorrection(c, new Float64Array(W * H * 3).fill(1), frameRect, frameRect, lens.character.vignetting.cornerStops);
      for (const [x, y] of [[0, 0], [47, 31], [10, 20], [24, 16]] as const) {
        const gain = calculatePeripheralIlluminationCorrection({ component: profile.components[2] as IlluminationLensCorrection,
          imagePointMm: { x: (x + 0.5 - W / 2) * PITCH_MM, y: (H / 2 - y - 0.5) * PITCH_MM }, signal: 1, noiseVariance: 0, clippingLevel: 100 }).value.gain;
        expect(ones[(y * W + x) * 3 + 1]! / gain).toBeCloseTo(1, 9);
      }
    }
  });
});
