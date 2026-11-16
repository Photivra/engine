// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { resolveGenericLens, simulateCapture, InvalidConfigurationError, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #630: output.diffractionCorrection with lens.catalogue. The catalogue lens's PSF is the Fraunhofer diffraction of its uniform circular
 * pupil D = f/N (with its aberrations), so the correction inverts the diffraction OTF of that pupil at its own working f-number z/D.
 */
const linear = (code: number): number => { const v = code / 65535; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const width = 48, height = 32, pitch = 2, subjectDistanceM = 5;
const options = (output: SimulateCaptureOptions["output"] = {}, fNumber = 16): SimulateCaptureOptions => ({
  scene: { preset: "slanted-edge", angleDegrees: 0 }, subjectDistanceM, lens: { catalogue: "pv-50-1.8", fNumber },
  sensor: { pixelPitchMicrometers: pitch, spectralStepNanometers: 40 }, exposure: { mode: "manual", iso: 100, shutterSeconds: (fNumber / 8) ** 2 / 125 },
  output: { width, height, format: "srgb-16", ...output } });
/** The green channel's 10–90 % rise across the vertical edge, in pixels (mean over the rows, linear light). */
function rise(r: SimulateCaptureResult): number {
  const profile = Array.from({ length: width }, (_, x) => {
    let s = 0;
    for (let y = 4; y < height - 4; y++) s += linear(r.image.samples[(y * width + x) * 3 + 1]!);
    return s / (height - 8);
  });
  const low = Math.min(...profile.slice(2, -2)), high = Math.max(...profile.slice(2, -2)), at = (level: number): number => {
    const t = low + level * (high - low);
    for (let x = 2; x < width - 3; x++) if ((profile[x]! - t) * (profile[x + 1]! - t) <= 0 && profile[x] !== profile[x + 1]) return x + (t - profile[x]!) / (profile[x + 1]! - profile[x]!);
    return NaN;
  };
  return Math.abs(at(0.9) - at(0.1));
}

describe("output.diffractionCorrection with a catalogue lens (#630)", () => {
  it("inverts the diffraction of the lens's own pupil at its working f-number; the RAW is unchanged and the edge rises faster", async () => {
    const plain = await simulateCapture(options()), corrected = await simulateCapture(options({ diffractionCorrection: {} }));
    expect(Array.from(corrected.raw.codes)).toEqual(Array.from(plain.raw.codes));
    // The lens resolved on the simulated frame; its pupil D = f/N and the thin-lens image distance z at the focus.
    const f = (corrected.assumptions.find((a) => a.id === "lens.catalogue")!.value as { focalLengthMm: number }).focalLengthMm;
    expect(resolveGenericLens({ lensId: "pv-50-1.8", activeImagingArea: { widthMm: 36, heightMm: 24 } }).focalLengthMm).toBeCloseTo(50, 6);
    const z = 1 / (1 / f - 1 / (subjectDistanceM * 1000)), workingF = z / (f / 16);
    const record = corrected.assumptions.find((a) => a.id === "output.diffractionCorrection")!;
    const value = record.value as { workingFNumber: number; pupil: string; kernelRadiusPixels: number; fNumber: number; recoversBeyondCutoff: boolean };
    expect(value.pupil).toBe("lens.catalogue");
    expect(value.fNumber).toBe(16);
    expect(value.recoversBeyondCutoff).toBe(false);
    expect(Math.abs(value.workingFNumber - workingF) / workingF).toBeLessThan(1e-12);
    // The default radius: the Airy third dark ring 3.2383·λ·N_w at 550 nm, in pixels.
    expect(value.kernelRadiusPixels).toBe(Math.min(16, Math.ceil(10.173468135062722 / Math.PI * 0.55 * value.workingFNumber / pitch)));
    expect(record.explanation).toMatch(/lens's aberrations, which its PSF also carries, are not inverted/u);
    expect(corrected.diagnostics.detail!.diffractionCorrection).toBeDefined();
    const before = rise(plain), after = rise(corrected);
    expect(after).toBeLessThan(0.85 * before);
  }, scaledTimeout(240_000));

  it("still needs a diffraction source: without lens.diffraction or lens.catalogue it is refused", async () => {
    const ideal: SimulateCaptureOptions = { ...options({ diffractionCorrection: {} }), lens: { fNumber: 16 } };
    await expect(simulateCapture(ideal)).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture(ideal)).rejects.toThrow(/needs lens.diffraction or lens.catalogue/u);
  });
});
