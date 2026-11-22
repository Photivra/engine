// SPDX-License-Identifier: Apache-2.0
/**
 * #674: the catalogue lens PSF's cell integration. Without aberrations a node must equal the Airy pattern integrated over the same site cells (the engine's exact Airy cells, `createDiffractionLimitedPsfProfile`).
 * Before 2.28.0 the builder's image grid of pitch min(λ·N_w/2, p/4) counted each δ-square as constant (the centre tap 2–20 % low at
 * f/4–f/22) and its FFT period could fold the rings back; small pixels at large f-numbers were refused ("fewer than 9 samples").
 */
import { describe, expect, it } from "vitest";
import { createDiffractionLimitedPsfProfile, resolveGenericLens, simulateCapture } from "../src/index.js";
import { createGenericLensPsfProfile, type GenericLensPsf } from "../src/optics/generic-lens-psf.js";
import type { ResolvedGenericLens } from "../src/equipment/generic-lens-catalogue.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const EVIDENCE = [{ sourceOrigin: "photivra" as const, sourceReference: "test:generic-lens-psf-cells", reuseStatus: "photivra-owned" as const }];
const build = (pitch: number, fNumber: number, W = 6000, H = 4000): { lens: ResolvedGenericLens; area: { widthMm: number; heightMm: number }; psf: GenericLensPsf } => {
  const area = { widthMm: W * pitch / 1000, heightMm: H * pitch / 1000 }, frameHalfMm = { x: area.widthMm / 2, y: area.heightMm / 2 };
  const resolved = resolveGenericLens({ lensId: "pv-50-1.2-pro", activeImagingArea: area, fNumber, focusDistanceM: 50 });
  // Without aberrations and lateral colour (the axial colour alone is 1 % of the 380 nm centre tap at f/4), so the node is the Airy pattern.
  const lens = { ...resolved, character: { ...resolved.character, aberrations: { ...resolved.character.aberrations, sphericalWaves: 0, balancingDefocusWaves: 0, comaWaves: 0, astigmatismWaves: 0,
    fieldCurvatureWaves: 0, axialColorWaves: 0 }, lateralColor: { ...resolved.character.lateralColor, fraction: 0 } } };
  return { lens, area, psf: createGenericLensPsfProfile({ lens, focusDistanceM: 50, sitePitchMicrometers: pitch, fieldHalfExtentMm: { x: frameHalfMm.x + 0.1, y: frameHalfMm.y + 0.1 }, frameHalfMm, evidence: EVIDENCE }) };
};

describe("the catalogue PSF's site cells (#674)", () => {
  it("equals the exact Airy cells without aberrations: centre tap within 0.5 % and L1 within 0.01 (pitch 1–12 µm, f/4–f/22, 380–780 nm)", () => {
    for (const pitch of [1, 2, 3, 6, 12]) for (const fNumber of [4, 8, 22]) {
      const { lens, area, psf } = build(pitch, fNumber, pitch <= 3 ? 8000 : 6000, pitch <= 3 ? 6000 : 4000), R = psf.aberrationKernelRadiusSites, w = 2 * R + 1;
      expect(psf.maximumTruncatedEnergyFraction).toBeGreaterThanOrEqual(0);
      const airy = createDiffractionLimitedPsfProfile({ aperture: "circular", focalLengthMm: lens.focalLengthMm, apertureFNumber: fNumber, focus: { kind: "finite", distanceM: 50 }, wavelengthsNm: [380, 550, 780],
        samplePitchMicrometers: pitch, kernelRadiusSamples: R, fieldHalfExtentMm: { x: area.widthMm / 2, y: area.heightMm / 2 }, profileId: "test-airy" }).value.profile;
      for (const nm of [380, 550, 780]) {
        const got = psf.profile.nodes.find((n) => n.coordinate.fieldXmm === 0 && n.coordinate.fieldYmm === 0 && n.coordinate.wavelengthNm === nm)!.kernel.normalizedIntensity;
        const want = airy.nodes.find((n) => n.coordinate.wavelengthNm === nm && n.coordinate.fieldXmm === airy.axes.fieldXmm[0] && n.coordinate.fieldYmm === airy.axes.fieldYmm[0])!.kernel.normalizedIntensity;
        let l1 = 0;
        for (let i = 0; i < got.length; i++) l1 += Math.abs(got[i]! - want[i]!);
        const name = `${pitch} µm f/${fNumber} ${nm} nm`, c = R * w + R;
        expect(Math.abs(got[c]! / want[c]! - 1), name).toBeLessThan(0.005);
        expect(l1, name).toBeLessThan(0.01);
      }
    }
  }, scaledTimeout(300_000));

  it("builds the small-pixel, large-f-number lenses that were refused, through the facade", async () => {
    for (const [lensId, pitch, fNumber] of [["pv-50-1.2-pro", 1.5, 22], ["pv-50-1.2-pro", 1, 16], ["pv-200-2-pro", 2, 32]] as const) {
      const r = await simulateCapture({ scene: { preset: "slanted-edge" }, lens: { catalogue: lensId, fNumber }, sensor: { pixelPitchMicrometers: pitch }, output: { width: 96, height: 64 } });
      expect(r.image.samples.length, `${lensId} ${pitch} µm f/${fNumber}`).toBe(96 * 64 * 3);
    }
  }, scaledTimeout(300_000));
});
