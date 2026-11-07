// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { defocusDiscKernelRadius } from "../src/optics/defocus-disc-kernel.js";
import { InvalidConfigurationError, calculateDefocusCircle, simulateCapture, simulateDisplayView, simulateIdealReference,
  type SimulateCaptureOptions } from "../src/index.js";

const base: SimulateCaptureOptions = { scene: { preset: "slanted-edge" }, output: { width: 8, height: 8 }, subjectDistanceM: 2 };
const withDefocus = (lens: NonNullable<SimulateCaptureOptions["lens"]>): SimulateCaptureOptions => ({ ...base, lens: { ...lens, defocus: { model: "geometric-disc" } } });

describe("lens.defocus option (#492 step 1: parse and resolve; step 2a: the capture renders it)", () => {
  it("in focus renders the same bytes as without the option and records a zero disc as an approximation", async () => {
    const plain = await simulateCapture({ ...base, lens: { fNumber: 4 } });
    const focused = await simulateCapture(withDefocus({ fNumber: 4 }));
    const explicit = await simulateCapture(withDefocus({ fNumber: 4, focusDistanceM: 2 }));
    for (const r of [focused, explicit]) {
      expect(Array.from(r.image.samples)).toEqual(Array.from(plain.image.samples));
      expect(Array.from(r.raw.codes)).toEqual(Array.from(plain.raw.codes));
      const defocus = r.assumptions.find((a) => a.id === "lens.defocus")!;
      expect(defocus.kind).toBe("model");
      expect(defocus.value).toMatchObject({ model: "geometric-disc", scientificStatus: "approximation", diameterMicrometers: 0, diameterSites: 0, kernelRadiusSites: null,
        fNumber: 4, samplePitchMicrometers: 6, defocusCircleModel: { id: "thin-lens-defocus-circle", version: "1.1.0" } });
      expect(defocus.explanation).toMatch(/approximation/u);
      expect(defocus.explanation).toMatch(/no defocus kernel is applied/u);
      // Every other assumption is the plain request's, except the pupil-sampling note, which now points to lens.defocus.
      const others = r.assumptions.filter((a) => a.id !== "lens.defocus" && a.id !== "lens.pupilSampling" && a.id !== "lens.focusDistanceM");
      expect(others).toEqual(plain.assumptions.filter((a) => a.id !== "lens.pupilSampling" && a.id !== "lens.focusDistanceM"));
      expect(r.assumptions.find((a) => a.id === "lens.pupilSampling")!.explanation).toMatch(/lens\.defocus/u);
    }
    expect(plain.assumptions.find((a) => a.id === "lens.defocus")).toBeUndefined();
    expect(focused.image.png).toEqual(plain.image.png);
    expect(focused.exposure).toEqual(plain.exposure);
  });

  it("renders an out-of-focus capture (step 2a), naming the blur circle in the assumption", async () => {
    const c = calculateDefocusCircle({ focalLengthMm: 50, aperture: 4, focusDistanceM: 1.8, subjectDistanceM: 2 }).value.diameterMm * 1000;
    const request = withDefocus({ fNumber: 4, focusDistanceM: 1.8 });
    const r = await simulateCapture(request);
    expect(r.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ diameterMicrometers: c, diameterSites: c / 6,
      kernelRadiusSites: defocusDiscKernelRadius(c / 6), execution: "object-space-convolution" });
    // The same resolution in the automatic modes (at the resolved f-number) and for a DNG.
    const program = await simulateCapture({ ...withDefocus({ focusDistanceM: 1.8 }), exposure: { mode: "program" } });
    expect((program.assumptions.find((a) => a.id === "lens.defocus")!.value as { fNumber: number }).fNumber).toBe(program.exposure.settings.fNumber);
    const dng = await simulateCapture({ ...request, output: { width: 8, height: 8, format: "dng" } });
    expect(Array.from(dng.raw.codes)).toEqual(Array.from(r.raw.codes));
    // Even a disc smaller than one site is a kernel (radius 0, the identity), and it is applied.
    const subSite = await simulateCapture(withDefocus({ fNumber: 16, focusDistanceM: 1.999 }));
    expect(subSite.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ kernelRadiusSites: 0, execution: "object-space-convolution" });
    expect(subSite.diagnostics.options).toEqual(["lens.defocus"]);
    // Without the option the same focus distance renders as before (no blur, labelled).
    const sharp = await simulateCapture({ ...base, lens: { fNumber: 4, focusDistanceM: 1.8 } });
    expect(sharp.assumptions.find((a) => a.id === "lens.pupilSampling")!.explanation).toMatch(/defocus and depth of field are not rendered/u);
    expect(Array.from(sharp.raw.codes)).not.toEqual(Array.from(r.raw.codes));
  });

  it("fails past the kernel radius cap (512 sites, #564) with a short message", async () => {
    // 50 mm f/4 focused at 0.1 m on a plane at 2 m: c = 2500·1.9/(4·2·0.05) mm = 11.875 mm, 1979.2 sites of 6 µm, radius 990 > 512.
    const c = calculateDefocusCircle({ focalLengthMm: 50, aperture: 4, focusDistanceM: 0.1, subjectDistanceM: 2 }).value.diameterMm * 1000;
    expect(defocusDiscKernelRadius(c / 6)).toBe(990);
    await expect(simulateCapture(withDefocus({ fNumber: 4, focusDistanceM: 0.1 }))).rejects.toThrow(new InvalidConfigurationError(
      "lens.defocus: The blur circle is 11.9 mm (1,980 sites) across; the engine renders at most 1,025 sites (DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES)."));
  });

  it("validates the record and refuses double counting with pupil sampling or a caller PSF", async () => {
    for (const defocus of [{}, { model: "wave" }, { model: "geometric-disc", radius: 3 }, "geometric-disc", null, 1]) {
      await expect(simulateCapture({ ...base, lens: { defocus: defocus as never } })).rejects.toThrow(InvalidConfigurationError);
    }
    await expect(simulateCapture({ ...base, lens: { defocus: { model: "wave" } as never } })).rejects.toThrow(/lens\.defocus\.model must be "geometric-disc"/u);
    await expect(simulateCapture({ ...base, lens: { defocus: { model: "geometric-disc", radius: 3 } as never } })).rejects.toThrow(/Unknown lens\.defocus field: radius/u);
    await expect(simulateCapture(withDefocus({ pupilSampling: { radialSamples: 1, angularSamples: 4 } }))).rejects.toThrow(/lens\.defocus cannot be combined with lens\.pupilSampling/u);
    const psf = { kind: "sampled-local", configuration: {} } as never;
    await expect(simulateCapture(withDefocus({ psf }))).rejects.toThrow(/lens\.defocus cannot be combined with lens\.psf/u);
    // Diffraction is allowed: in focus the result is that of diffraction alone.
    const diffracted = await simulateCapture({ ...base, lens: { fNumber: 8, diffraction: "circular-aperture" } });
    const both = await simulateCapture(withDefocus({ fNumber: 8, diffraction: "circular-aperture" }));
    expect(Array.from(both.image.samples)).toEqual(Array.from(diffracted.image.samples));
  });

  it("takes the same path in the display view and only records the disc in the ideal reference", async () => {
    const options: SimulateCaptureOptions = { ...base, output: { width: 40, height: 30 } };
    const view = { width: 20, height: 15 };
    const plain = await simulateDisplayView(options, view);
    const focused = await simulateDisplayView({ ...options, lens: { defocus: { model: "geometric-disc" } } }, view);
    expect(Array.from(focused.image.samples)).toEqual(Array.from(plain.image.samples));
    expect(focused.assumptions.find((a) => a.id === "lens.defocus")!.value).toMatchObject({ diameterMicrometers: 0, kernelRadiusSites: null });
    // Out of focus the display view renders the disc (#492 step 2b; test/display-view-defocus.test.mjs).
    const blurred = await simulateDisplayView({ ...options, lens: { defocus: { model: "geometric-disc" }, focusDistanceM: 1.8 } }, view);
    expect(blurred.assumptions.find((a) => a.id === "view.defocus")!.value).toMatchObject({ kernel: "disc", scientificStatus: "approximation" });
    await expect(simulateDisplayView({ ...options, lens: { defocus: { model: "geometric-disc" }, pupilSampling: { radialSamples: 1, angularSamples: 4 } } }, view))
      .rejects.toThrow(/lens\.defocus cannot be combined with lens\.pupilSampling/u);
    const reference = await simulateIdealReference({ ...options, lens: { fNumber: 4, defocus: { model: "geometric-disc" }, focusDistanceM: 1.8 } });
    const sharpReference = await simulateIdealReference({ ...options, lens: { fNumber: 4, focusDistanceM: 1.8 } });
    expect(Array.from(reference.image.samples)).toEqual(Array.from(sharpReference.image.samples));
    const recorded = reference.assumptions.find((a) => a.id === "lens.defocus")!;
    expect((recorded.value as { diameterSites: number }).diameterSites).toBeGreaterThan(0);
    expect(recorded.explanation).toMatch(/not applied: the ideal reference has no camera effects/u);
  });
});
