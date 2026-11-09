// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { DISPLAY_VIEW_LENS_PSF_ZONES } from "../src/facade/display-view-lens-signal.js";
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

describe("display view with lens.catalogue (#569): one-site zones", () => {
  it("one-site zones: every site's expected electrons are the capture's PSF quadrature's (coma, lateral colour, fisheyes, radiance scenes)", async () => {
    expect(DISPLAY_VIEW_LENS_PSF_ZONES).toBe(64);
    // 60 × 40 sites of 1.5 µm: the catalogue lens scaled to that frame, kernels of radius 3–10 sites (the profile's orientation matters).
    const small = { output: { width: 60, height: 40 }, sensor: { pixelPitchMicrometers: 1.5, spectralStepNanometers: 80 }, subjectDistanceM: 3, exposure };
    const rings = { kind: "reflectance-function", sceneId: "rings", evaluate: (p: { u: number; v: number }): number => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) } as const;
    const cases: [string, SimulateCaptureOptions][] = [
      ["PV 50 1.2 Pro wide open", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-50-1.2-pro", fNumber: 1.2 } }],
      ["PV 8 3.5 Fisheye Pro (black outside its 180° circle)", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-8-3.5-fisheye-pro", fNumber: 3.5 } }],
      ["PV 15 2.8 Fisheye Pro", { ...small, scene: { preset: "dead-leaves" }, lens: { catalogue: "pv-15-2.8-fisheye-pro", fNumber: 2.8 } }],
      ["PV 50 1.8 on a radiance scene", { ...small, scene: rings, lens: { catalogue: "pv-50-1.8", fNumber: 1.8 } } as SimulateCaptureOptions]
    ];
    for (const [name, options] of cases) {
      // A 2 × 2 region's capture: its site records cover the whole frame (as in the tests below), at a fraction of the whole capture's cost.
      const capture = await simulateCapture({ ...options, output: { ...options.output, region: { x: 0, y: 0, width: 2, height: 2 } } });
      const { signal, result } = await simulateDisplayViewWithInternals(options, { width: 6, height: 4, samplesPerAxis: 1 });
      const lensPsf = result.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number; kernelRadiusSites: number };
      expect(lensPsf.zoneSites, name).toBe(1);
      expect(differences(capture, signal, sceneEvaluator(options, capture), 1.5, 400).largest, name).toBeLessThan(1e-12);
      expect(result.diagnostics.fast.execution.backend).toBe("cpu-reference");
    }
  }, scaledTimeout(360_000));

});
