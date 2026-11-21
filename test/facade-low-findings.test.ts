// SPDX-License-Identifier: Apache-2.0
/**
 * #730: the facade's low-severity review findings (2.28.0 step 8). Each block names its item; valid requests keep their results,
 * and the items that refuse input or correct a text are pinned here.
 */
import { describe, expect, it } from "vitest";
import { GENERIC_ND_FILTER_PROFILES, calculateChartFraming, resolveSensorProfile, serializeSimulatedCaptureDngFromParts, simulateCapture, simulateCaptureFromParts,
  type SimulateCaptureOptions } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const SMALL: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 16, height: 12 } };
const DNG: SimulateCaptureOptions = { ...SMALL, output: { ...SMALL.output, format: "dng" } };

describe("facade-03: the parts entry points refuse a missing parts list", () => {
  it("rejects undefined parts as it rejects an empty list, and a region with them", async () => {
    const missing = undefined as unknown as [];
    await expect(serializeSimulatedCaptureDngFromParts(DNG, missing)).rejects.toThrow(/needs at least one part/);
    await expect(simulateCaptureFromParts(SMALL, missing)).rejects.toThrow(/needs at least one part/);
    await expect(serializeSimulatedCaptureDngFromParts(DNG, [])).rejects.toThrow(/needs at least one part/);
    const region = (o: SimulateCaptureOptions): SimulateCaptureOptions => ({ ...o, output: { ...o.output, region: { x: 0, y: 0, width: 8, height: 6 } } });
    await expect(serializeSimulatedCaptureDngFromParts(region(DNG), missing)).rejects.toThrow(/takes the whole frame: the options take no output.region/);
    await expect(simulateCaptureFromParts(region(SMALL), missing)).rejects.toThrow(/takes the whole frame: the options take no output.region/);
  }, scaledTimeout(30_000));
});

describe("facade-05: out-of-range settings name the option and the range", () => {
  it("refuses with the caller's option path and the camera's range or settings", async () => {
    const cases: [Partial<SimulateCaptureOptions>, string][] = [
      [{ lens: { fNumber: 2.8 } }, "lens.fNumber 2.8 is outside the camera's range, f/4 to f/16."],
      [{ exposure: { iso: 50 } }, "exposure.iso 50 is outside the camera's range, ISO 100 to 25600."],
      [{ exposure: { iso: 123 } }, "exposure.iso 123 is not one of the camera's settings: 100, 125, 160,"],
      [{ exposure: { shutterSeconds: 60 } }, "exposure.shutterSeconds 60 is outside the camera's range, 0.000125 s to 30 s."],
      [{ exposure: { mode: "aperture-priority", iso: 50 } }, "exposure.iso 50 is outside the camera's range"],
      [{ lens: { focalLengthMm: 85 } }, "lens.focalLengthMm 85 is outside the lens's range, 50 mm to 50 mm."],
      [{ lens: { projection: "equisolid" as never } }, "lens.projection must be one of rectilinear, fisheye-equidistant"]
    ];
    for (const [options, message] of cases) await expect(simulateCapture({ ...SMALL, ...options }), message).rejects.toThrow(message);
    expect(() => calculateChartFraming({ sensor: { widthMm: 36, heightMm: 24 }, focalLengthMm: 50, chart: { widthM: 0.42, heightM: 0.297 },
      subjectDistanceM: 1e11 } as never)).toThrow("subjectDistanceM must be a positive finite number, at most 1e7.");
  }, scaledTimeout(30_000));
});

describe("facade-06: the assumption and provenance texts match what ran", () => {
  it("names the preset version, the meter's input, the Auto ISO resolver and the base-ISO anchor", async () => {
    const plain = await simulateCapture(SMALL), text = (r: typeof plain, id: string): string => r.assumptions.find((a) => a.id === id)!.explanation;
    expect(text(plain, "camera")).toContain("Generic Photivra tier preset " + plain.provenance.cameraPresetVersion + " ");
    expect(text(plain, "exposure.metering")).toMatch(/reads scene luminance on a 16 × 16 zone grid, before the lens \(no lens transmission, vignetting or flare\)\.$/);
    const filtered = await simulateCapture({ ...SMALL, lens: { filter: GENERIC_ND_FILTER_PROFILES[3]! } });
    expect(text(filtered, "exposure.metering")).toMatch(/but through lens.filter \(TTL\)\.$/);
    const card = await simulateCapture({ ...SMALL, exposure: { metering: "grey-card" } });
    expect(text(card, "exposure.metering")).toContain("reads an 18 % grey card in every zone");
    const auto = await simulateCapture({ ...SMALL, exposure: { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60 } } });
    expect(auto.provenance.composedContracts).toContain("resolveAperturePriorityAutoIsoExposureMode");
    expect(auto.provenance.composedContracts).not.toContain("resolveAperturePriorityExposureMode");
    const sports = await simulateCapture({ ...SMALL, sensor: { profile: resolveSensorProfile("full-frame-24mp-stacked-sports-2020s") } });
    const anchor = sports.assumptions.find((a) => a.id === "exposure.referenceExposure")!;
    expect((anchor.value as { iso: number }).iso).toBe(125);
    expect(anchor.explanation).toMatch(/at the profile's base ISO 125, the same N²\/\(t·S\) at 0\.0064 s\.$/);
  }, scaledTimeout(60_000));
});
