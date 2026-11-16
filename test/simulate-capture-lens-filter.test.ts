// SPDX-License-Identifier: Apache-2.0
/**
 * #624: `lens.filter`, a front-of-lens filter in simulateCapture, the ideal reference and the display view.
 *
 * Independent expectations:
 * - Exposure. The meter reads through the filter, so an automatic mode must resolve t / T at the same f-number and ISO, which is
 *   `calculateFilteredExposureTime` (a separate module). At the default illuminance, grey-card metering, f/8 and ISO 100 give
 *   1/125 s without a filter (the default illuminance is defined that way); the generic tiers' shutter is continuous, so the
 *   filtered shutter must be that function's t / T for the unfiltered shutter.
 * - Rendering. Light through a flat filter of transmittance 2^-k is light 2^-k as bright: every product and sum in the chain is
 *   scaled by an exact power of two, so a filtered capture at illuminance E must equal, bit for bit, the unfiltered capture at
 *   E·2^-k with the same settings (manual), and an automatic mode must resolve the same settings for both.
 */
import { describe, expect, it } from "vitest";
import { GENERIC_ND_FILTER_PROFILES, InvalidConfigurationError, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, calculateFilteredExposureTime,
  simulateCapture, simulateDisplayView, simulateIdealReference, type FrontOfLensFilterProfile, type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const output = { width: 16, height: 12 } as const;
const E = SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX;
/** The resolver divides the meter target by the through-filter signal; the quotient may round differently from t / T in the last bits. */
const RELATIVE = 1e-12;
const nd = (stops: 3 | 6 | 10): FrontOfLensFilterProfile => GENERIC_ND_FILTER_PROFILES[stops];
const withFilter = (o: SimulateCaptureOptions, filter: FrontOfLensFilterProfile | FrontOfLensFilterProfile[]): SimulateCaptureOptions =>
  ({ ...o, lens: { ...(o.lens ?? {}), filter } } as SimulateCaptureOptions);

/** A vacuum-basis filter that passes long wavelengths (a warming filter): 0.05 at 380 nm rising linearly to 0.95 at 780 nm. */
const warming: FrontOfLensFilterProfile = {
  schemaVersion: "0.1.0", filterId: "test-warming", profileVersion: "1.0.0", identityScope: "photivra-generic-unbranded", position: "front-of-lens",
  scientificStatus: "approximation", wavelengthBasis: "vacuum", wavelengthRangeNanometers: { minimum: 380, maximum: 780 },
  transmission: { kind: "spectral-transmission", samples: { value: [{ wavelengthNanometers: 380, linearTransmissionFactor: 0.05 }, { wavelengthNanometers: 580, linearTransmissionFactor: 0.5 },
    { wavelengthNanometers: 780, linearTransmissionFactor: 0.95 }], evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:test:624", reuseStatus: "photivra-owned" }] } },
  uncertainty: { kind: "not-quantified", limitation: "Test filter." }, polarizationModeled: false, wavelengthChangingBehaviorModeled: false,
  evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:test:624", reuseStatus: "photivra-owned" }], limitations: ["Synthetic test filter."]
};

describe("lens.filter (#624)", { timeout: scaledTimeout(600_000) }, () => {
  it("resolves the shutter calculateFilteredExposureTime gives, for each ND preset", async () => {
    // The generic tiers' shutter is continuous within its range, so the resolver returns t / T itself.
    const base: SimulateCaptureOptions = { scene: { preset: "uniform" }, output, lens: { fNumber: 8 }, exposure: { mode: "aperture-priority", iso: 100, metering: "grey-card" } };
    const plain = await simulateCapture(base);
    const t0 = plain.exposure.settings.shutterSeconds;
    expect(t0).toBeCloseTo(1 / 125, 15);
    expect(plain.exposure.filter).toBeUndefined();
    for (const stops of [3, 6, 10] as const) {
      const r = await simulateCapture(withFilter(base, nd(stops)));
      const expected = calculateFilteredExposureTime({ shutterSeconds: t0, filter: nd(stops) }).value;
      expect(Math.abs(r.exposure.settings.shutterSeconds / expected.filteredShutterSeconds - 1)).toBeLessThan(RELATIVE);
      expect(r.exposure.settings.fNumber).toBe(8);
      expect(r.exposure.settings.iso).toBe(100);
      expect(r.exposure.filter).toEqual({ filterIds: ["generic-nd-" + stops + "-stop"], linearTransmissionFactor: expected.linearTransmissionFactor,
        attenuationStops: expected.attenuationStops, spectrallyFlat: true });
      // The deviation is that of the light through the filter, so it stays the unfiltered one.
      expect(r.exposure.greyCardDeviationStops!).toBeCloseTo(plain.exposure.greyCardDeviationStops!, 9);
      expect(r.assumptions.some((a) => a.id === "lens.filter")).toBe(true);
    }
  });

  it("meters through the filter in every automatic mode, as the unfiltered request at E·T", async () => {
    const modes: SimulateCaptureOptions["exposure"][] = [
      { mode: "aperture-priority", iso: 200 }, { mode: "shutter-priority", shutterSeconds: 1 / 30, iso: 100 }, { mode: "program", iso: 100 },
      { mode: "shutter-priority", shutterSeconds: 1 / 500, iso: "auto" },
      { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } }, { mode: "program", iso: "auto" }];
    for (const exposure of modes) for (const stops of [3, 6] as const) {
      const base = { scene: { preset: "siemens-star" }, output, illuminanceLux: 20_000, exposure } as SimulateCaptureOptions;
      const lens = exposure!.mode === "aperture-priority" ? { fNumber: 5.6 } : {};
      const [filtered, darker] = await Promise.all([simulateCapture(withFilter({ ...base, lens }, nd(stops))), simulateCapture({ ...base, lens, illuminanceLux: 20_000 * 2 ** -stops })]);
      expect(filtered.exposure.settings, JSON.stringify(exposure) + " " + stops).toEqual(darker.exposure.settings);
      expect(filtered.image.samples).toEqual(darker.image.samples);
      expect(filtered.exposure.standardExposureDeviationStops).toBe(darker.exposure.standardExposureDeviationStops);
    }
  });

  it("renders the light through the filter on every path, bit for bit as the darker scene (manual)", async () => {
    const exposure = { mode: "manual", shutterSeconds: 1 / 15, iso: 100 } as const;
    const requests: SimulateCaptureOptions[] = [
      { scene: { preset: "color-patches" }, output: { ...output, format: "srgb-16" }, exposure },
      { scene: { preset: "siemens-star" }, output: { ...output, format: "dng" }, exposure },
      { scene: { preset: "siemens-star" }, output: { ...output, format: "png" }, exposure, sensor: { pixelAperture: { kind: "box" } } },
      { scene: { preset: "slanted-edge" }, output: { ...output, format: "jpeg" }, exposure, lens: { diffraction: "circular-aperture" } },
      { scene: { preset: "dead-leaves" }, output, exposure, lens: { focusDistanceM: 4, defocus: { model: "geometric-disc" } }, subjectDistanceM: 2 }
    ];
    for (const request of requests) {
      const [filtered, darker] = await Promise.all([simulateCapture(withFilter(request, nd(3))), simulateCapture({ ...request, illuminanceLux: E / 8 })]);
      expect(filtered.image.samples, JSON.stringify(request.output)).toEqual(darker.image.samples);
      expect(filtered.exposure.settings).toEqual({ fNumber: 8, shutterSeconds: 1 / 15, iso: 100 });
      // Manual mode only darkens: three stops under the light through the filter.
      const open = await simulateCapture(request);
      expect(filtered.exposure.standardExposureDeviationStops! - open.exposure.standardExposureDeviationStops!).toBeCloseTo(3, 9);
    }
    const base = { scene: { preset: "color-patches" }, output, exposure } as SimulateCaptureOptions;
    const [view, darkView] = await Promise.all([simulateDisplayView(withFilter(base, nd(3)), { width: 8, height: 6 }), simulateDisplayView({ ...base, illuminanceLux: E / 8 }, { width: 8, height: 6 })]);
    expect(view.image.samples).toEqual(darkView.image.samples);
    expect(view.exposure.filter?.attenuationStops).toBe(3);
    const [ideal, darkIdeal] = await Promise.all([simulateIdealReference(withFilter(base, nd(3))), simulateIdealReference({ ...base, illuminanceLux: E / 8 })]);
    expect(ideal.image.samples).toEqual(darkIdeal.image.samples);
    expect(ideal.exposure.filter?.filterIds).toEqual(["generic-nd-3-stop"]);
  });

  it("stacks filters in light-path order", async () => {
    const base: SimulateCaptureOptions = { scene: { preset: "uniform" }, output, lens: { fNumber: 8 }, exposure: { mode: "aperture-priority", iso: 100, metering: "grey-card" } };
    const [plain, r] = await Promise.all([simulateCapture(base), simulateCapture(withFilter(base, [nd(3), nd(6)]))]);
    const expected = calculateFilteredExposureTime({ shutterSeconds: plain.exposure.settings.shutterSeconds, filter: [nd(3), nd(6)] }).value;
    expect(Math.abs(r.exposure.settings.shutterSeconds / expected.filteredShutterSeconds - 1)).toBeLessThan(RELATIVE);
    expect(r.exposure.filter!.attenuationStops).toBe(9);
    expect(r.exposure.filter!.filterIds).toEqual(["generic-nd-3-stop", "generic-nd-6-stop"]);
  });

  it("applies a spectral filter per wavelength and meters its photopic transmission", async () => {
    const base = { scene: { preset: "uniform", reflectance: 0.5 }, output, exposure: { mode: "manual", shutterSeconds: 1 / 30, iso: 100 } } as SimulateCaptureOptions;
    const [open, warm] = await Promise.all([simulateCapture(base), simulateCapture(withFilter(base, warming))]);
    expect(warm.exposure.filter!.spectrallyFlat).toBe(false);
    // Unfiltered and filtered mean red/blue ratios: the warming filter passes red far more than blue.
    const ratio = (s: ArrayLike<number>): number => { let r = 0, b = 0; for (let i = 0; i < s.length; i += 3) { r += s[i]!; b += s[i + 2]!; } return r / b; };
    expect(ratio(warm.image.samples)).toBeGreaterThan(ratio(open.image.samples) * 1.2);
    // The meter's through-filter luminance: the deviation grows by −log2 of the photopic-weighted transmission, which lies
    // between the filter's ends and near its 555 nm value (0.4438 by linear interpolation).
    const added = warm.exposure.standardExposureDeviationStops! - open.exposure.standardExposureDeviationStops!;
    expect(added).toBeGreaterThan(-Math.log2(0.6));
    expect(added).toBeLessThan(-Math.log2(0.3));
  });

  it("refuses filters it cannot apply", async () => {
    const base: SimulateCaptureOptions = { scene: { preset: "uniform" }, output };
    await expect(simulateCapture(withFilter(base, { ...warming, wavelengthBasis: "air" }))).rejects.toThrow(/vacuum/);
    await expect(simulateCapture(withFilter(base, { ...nd(3), wavelengthRangeNanometers: { minimum: 400, maximum: 700 } }))).rejects.toThrow(/380–780/);
    await expect(simulateCapture(withFilter(base, []))).rejects.toThrow(InvalidConfigurationError);
    await expect(simulateCapture(withFilter(base, { ...nd(3), transmission: { kind: "neutral-linear-transmission", linearTransmissionFactor: { value: 2, evidence: nd(3).evidence } } })))
      .rejects.toThrow(InvalidConfigurationError);
  });
});
