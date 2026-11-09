// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { exposure, differences, sceneEvaluator } from "./helpers/display-view-lens-catalogue.js";

/*
 * #569: the display view with lens.catalogue (src/facade/display-view-lens-signal.ts, createDisplayViewLensPsf). As for #563
 * (test/display-view-lens.test.ts), the reference is the capture's own environment record of each site (its catalogue PSF, resolved at
 * the site's own point by the environment PSF quadrature, its distortion, projection and vignetting), evaluated with the capture's scene.
 *
 * Tolerances. On frames of at most DISPLAY_VIEW_LENS_PSF_ZONES sites per side every zone is one site, so each site reads the PSF the
 * capture resolves at its centre: agreement to 1e-12 relative (rounding) with the point aperture. With the 2 × 2 box and the four-spot
 * filter the capture resolves the PSF at each query's own point, a fraction of a site away (2.5e-3 relative at most in the case below, out of focus). On a whole
 * 6 µm full frame (94-site zones) the zone approximation leaves at most 1 % per site and 3e-4 on average over the sampled sites
 * (measured: 0.66 % and 1.2e-4 at most over the lenses below, at dead-leaves edges, where the PSF's change matters most).
 */

// The one-site-zone cases are split from test/display-view-lens-catalogue.test.ts into two files so the coverage shards can balance them.

describe("display view with lens.catalogue (#569): one-site zones with the box aperture", () => {
  it("one-site zones with the box aperture, the four-spot filter, AHD, lens.defocus and lens.focusScatter: within 5e-3 of the capture", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: { width: 60, height: 40, demosaic: "ahd" }, subjectDistanceM: 3, exposure,
      sensor: { pixelPitchMicrometers: 1.5, spectralStepNanometers: 80, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } },
      lens: { catalogue: "pv-24-1.4-pro", fNumber: 2, focusDistanceM: 2.6, defocus: { model: "geometric-disc" }, focusScatter: { seed: 7 } } };
    const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
    const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
    // The view records the capture's resolved focus scatter and its disc folded into the lens's PSF.
    expect(result.assumptions.find((a) => a.id === "lens.focusScatter")!.value).toEqual(capture.assumptions.find((a) => a.id === "lens.focusScatter")!.value);
    expect((result.assumptions.find((a) => a.id === "lens.defocus")!.value as { execution: string }).execution).toBe("catalogue-lens-psf");
    // The capture resolves the PSF at each of the 16 query points, up to 0.75 sites from the centre the view resolves it at: 2.5e-3 at most here.
    expect(differences(capture, signal, sceneEvaluator(options, capture), 1.5, 300).largest).toBeLessThan(5e-3);
  }, scaledTimeout(600_000));

});
