// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculatePrintPlan, InvalidConfigurationError, calculatePrintSizeLimit, parsePrintPlanInput, type PrintPlanInput, type PrintSamplingCriterion, type CaptureOrientation } from "../src/index.js";

function request(): PrintPlanInput {
  return {
    source: { kind: "native-retained", captureId: "public-capture-1", geometry: { imagingArea: { widthMm: 32, heightMm: 18 }, nativeRaster: { pixelWidth: 2560, pixelHeight: 1440 }, orientation: "landscape" } },
    printedImage: { width: 16, height: 9, unit: "inches" }, viewingDistance: { value: 24, unit: "inches" },
    sampling: { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1 },
    fit: { kind: "confirmed-native-aspect", maximumRelativeAspectError: 1e-12 }
  };
}
function manual(ppi: number): PrintPlanInput { return { ...request(), sampling: { kind: "manual-ppi", pixelsPerInch: ppi } }; }

describe("native Print planning", () => {
  it("answers 2560x1440 at 16x9in = 160 native PPI; independent angular reference", () => {
    const result = calculatePrintPlan(request()), p = result.value;
    expect(result.provenance.kind).toBe("calculated");
    expect(p.native?.pixelsPerInch.x).toBe(160); expect(p.native?.pixelsPerInch.y).toBe(160);
    // Independent value 1 / (48 tan(pi / 21600)) = 143.2394477726772984560533776811... (60-digit
    // decimal series); the literal is its correctly rounded double. The engine's float64 tan result
    // differs by about 1.4e-11, inside the 5e-11 tolerance.
    expect(p.guidance?.value.derivedPixelsPerInch).toBeCloseTo(143.2394477726773, 10);
    expect(p.guidance?.provenance.kind).toBe("approximation");
    // ceil(16 * 143.23944777269 / 16) exact-ratio units => 144 * (16,9).
    expect(p.minimumSamplingRaster).toEqual({ pixelWidth: 2304, pixelHeight: 1296 });
    expect(p.status).toBe("ready"); expect(p.resamplingScale).toEqual({ x: 0.9, y: 0.9 });
    expect(p.recommended?.angularPixelPitchArcminutes.x).toBeLessThanOrEqual(1);
    expect(p.capturedDetailAssessment).toBe("unassessed"); expect(p.deliveryAssessment).toBe("unassessed");
  });
  it.each([["mm", 406.4, 228.6, 609.6], ["cm", 40.64, 22.86, 60.96], ["m", 0.4064, 0.2286, 0.6096], ["inches", 16, 9, 24]] as const)("converts %s without changing raster", (unit, width, height, value) => {
    const p = calculatePrintPlan({ ...request(), printedImage: { width, height, unit }, viewingDistance: { value, unit } }).value;
    expect(p.status).toBe("ready"); expect(p.minimumSamplingRaster).toEqual({ pixelWidth: 2304, pixelHeight: 1296 });
    expect(p.printedImageMm?.width).toBeCloseTo(406.4, 12);
    const boundary = calculatePrintPlan({ ...request(), printedImage: { width, height, unit }, viewingDistance: { value, unit }, sampling: { kind: "manual-ppi", pixelsPerInch: 160 } }).value;
    expect(boundary.minimumSamplingRaster).toEqual({ pixelWidth: 2560, pixelHeight: 1440 });
  });
  it.each([159.99, 160, 160.01])("does not forgive one native boundary at %s PPI", ppi => {
    const p = calculatePrintPlan(manual(ppi)).value;
    expect(p.nativePixelSufficiency).toBe(ppi <= 160 ? "sufficient" : "insufficient");
    expect(p.recommended === null).toBe(ppi > 160);
    expect(p.minimumSamplingRaster).toEqual(ppi <= 160 ? { pixelWidth: 2560, pixelHeight: 1440 } : { pixelWidth: 2576, pixelHeight: 1449 });
    expect(p.guidance?.provenance.kind).toBe("calculated"); expect(p.guidance?.value.maximumArcminutesPerPixel).toBeNull();
  });
  it("tests exact single-pixel boundaries without a near-boundary epsilon", () => {
    const r = manual(1);
    if (r.source.kind !== "native-retained") throw Error("fixture");
    r.source.geometry.nativeRaster = { pixelWidth: 10, pixelHeight: 10 }; r.printedImage = { width: 10, height: 10, unit: "inches" };
    for (const width of [9.999, 10, 10.001]) {
      const p = calculatePrintPlan({ ...r, printedImage: { width, height: width, unit: "inches" } }).value;
      expect(p.minimumSamplingRaster?.pixelWidth).toBe(width <= 10 ? 10 : 11);
      expect(p.status).toBe(width <= 10 ? "ready" : "insufficient-native-pixels");
    }
  });
  it.each(["landscape", "portrait-clockwise", "landscape-inverted", "portrait-counter-clockwise"] as CaptureOrientation[])("keeps off-center native capacity in %s", orientation => {
    const r = manual(100), portrait = orientation.startsWith("portrait");
    if (r.source.kind !== "native-retained") throw Error("fixture");
    r.source.geometry = { imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 }, orientation, activeCaptureRect: { x: 100, y: 300, width: 4000, height: 2400 }, outputCropRect: { x: 30, y: 40, width: portrait ? 900 : 1600, height: portrait ? 1600 : 900 }, outputRaster: { pixelWidth: portrait ? 3600 : 6400, pixelHeight: portrait ? 6400 : 3600 } };
    r.printedImage = { width: portrait ? 9 : 16, height: portrait ? 16 : 9, unit: "inches" };
    const p = calculatePrintPlan(r).value;
    expect(p.native?.raster).toEqual({ pixelWidth: portrait ? 900 : 1600, pixelHeight: portrait ? 1600 : 900 });
    expect(p.recommended?.raster).toEqual(p.native?.raster); expect(p.resamplingScale).toEqual({ x: 1, y: 1 });
    r.sampling = { kind: "manual-ppi", pixelsPerInch: 101 };
    expect(calculatePrintPlan(r).value.recommended).toBeNull();
  });
  it("requires confirmation of aspect, reports declared physical tolerance, never changes native crop", () => {
    const r = manual(100); r.printedImage.height = 10;
    expect(calculatePrintPlan(r).value.status).toBe("crop-confirmation-required");
    r.printedImage.height = 9.001; r.fit = { kind: "confirmed-native-aspect", maximumRelativeAspectError: 0.001 };
    const p = calculatePrintPlan(r).value;
    expect(p.relativeAspectError).toBeGreaterThan(0); expect(p.status).toBe("ready");
    expect(p.resamplingScale?.x).toBe(p.resamplingScale?.y);
  });
  it("keeps coprime crops exact instead of independent axis stretching", () => {
    const r = manual(1); if (r.source.kind !== "native-retained") throw Error("fixture");
    r.source.geometry.nativeRaster = { pixelWidth: 101, pixelHeight: 99 };
    r.printedImage = { width: 1.01, height: 0.99, unit: "inches" };
    expect(calculatePrintPlan(r).value.minimumSamplingRaster).toEqual({ pixelWidth: 101, pixelHeight: 99 });
  });
  it("smaller-size and farther-distance alternatives retain the criterion", () => {
    const r = request(); r.viewingDistance.value = 12;
    const p = calculatePrintPlan(r).value; expect(p.status).toBe("insufficient-native-pixels");
    const alt = p.alternatives; if (!alt) throw Error("missing alternative");
    expect(alt.maximumImageMmAtCurrentDistance.width).toBeLessThan(406.4);
    expect(calculatePrintPlan({ ...r, viewingDistance: { value: alt.minimumViewingDistanceMmAtCurrentSize!, unit: "mm" } }).value.status).toBe("ready");
    const resized = calculatePrintPlan({ ...r, printedImage: { ...alt.maximumImageMmAtCurrentDistance, unit: "mm" } }).value;
    expect(resized.status).toBe("ready");
    expect(calculatePrintPlan(manual(200)).value.alternatives?.minimumViewingDistanceMmAtCurrentSize).toBeNull();
  });
  it("proportional size/distance has no finite angular bound; manual density supplies a bound", () => {
    const r = request(), base = calculatePrintPlan(r).value;
    for (const scale of [0.01, 2, 10000]) {
      const p = calculatePrintPlan({ ...r, printedImage: { width: 16 * scale, height: 9 * scale, unit: "inches" }, viewingDistance: { value: 24 * scale, unit: "inches" } }).value;
      expect(p.minimumSamplingRaster).toEqual(base.minimumSamplingRaster);
    }
    expect(calculatePrintSizeLimit({ plan: r, viewingDistancePolicy: "proportional-to-image-size" }).value.status).toBe("unbounded");
    r.viewingDistance.value = 12;
    expect(calculatePrintSizeLimit({ plan: r, viewingDistancePolicy: "proportional-to-image-size" }).value.status).toBe("no-positive-size");
    expect(calculatePrintSizeLimit({ plan: r, viewingDistancePolicy: "fixed" }).value.status).toBe("finite");
    expect(calculatePrintSizeLimit({ plan: manual(200), viewingDistancePolicy: "proportional-to-image-size" }).value.maximumImageMm?.width).toBeCloseTo(325.12, 10);
  });
  it.each([
    { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1 },
    { kind: "angular-stroke", strokeWidthArcminutes: 1, samplesPerStroke: 1 },
    { kind: "angular-line-pair", periodArcminutes: 2, samplesPerPeriod: 2 }
  ] as PrintSamplingCriterion[])("uses explicit factor-of-two convention $kind", sampling => {
    expect(calculatePrintPlan({ ...request(), sampling }).value.minimumSamplingRaster).toEqual({ pixelWidth: 2304, pixelHeight: 1296 });
  });
  it("rejects upscale exact lab requests independently of native angular sufficiency", () => {
    const p = calculatePrintPlan({ ...request(), provider: { exactRaster: { pixelWidth: 3200, pixelHeight: 1800 } } }).value;
    expect(p.nativePixelSufficiency).toBe("sufficient"); expect(p.status).toBe("provider-conflict");
    expect(p.reasons).toContain("provider-requires-native-upscale"); expect(p.recommended).toBeNull();
  });
  it.each([
    [{ minimumRaster: { pixelWidth: 2400, pixelHeight: 1350 } }, "ready"],
    [{ minimumPpi: 150 }, "ready"],
    [{ exactPpi: 150 }, "ready"],
    [{ exactRaster: { pixelWidth: 2400, pixelHeight: 1350 }, exactPpi: 160 }, "provider-conflict"],
    [{ exactPpi: 150.001 }, "provider-conflict"],
    [{ exactRaster: { pixelWidth: 2400, pixelHeight: 1349 } }, "provider-conflict"],
    [{ exactRaster: { pixelWidth: 1600, pixelHeight: 900 } }, "provider-conflict"],
    [{ minimumPpi: 200, exactPpi: 150 }, "provider-conflict"],
    [{ minimumRaster: { pixelWidth: 3200, pixelHeight: 1800 } }, "provider-conflict"]
  ] as const)("reconciles explicit provider %j", (provider, status) => {
    const p = calculatePrintPlan({ ...request(), provider }).value;
    expect(p.status).toBe(status); expect(p.recommended === null).toBe(status !== "ready");
  });
  it("missing native authority is a semantic blocker, not a fabricated count", () => {
    const r: PrintPlanInput = { ...request(), source: { kind: "unavailable", reason: "unverified-native-identity" } };
    const p = calculatePrintPlan(r).value;
    expect(p.status).toBe("cannot-assess"); expect(p.native).toBeNull(); expect(p.guidance).not.toBeNull();
    expect(calculatePrintSizeLimit({ plan: r, viewingDistancePolicy: "fixed" }).value.status).toBe("cannot-assess");
    expect(calculatePrintSizeLimit({ plan: { ...request(), provider: { minimumPpi: 150 } }, viewingDistancePolicy: "fixed" }).value.status).toBe("unsupported");
  });
  it.each([Number.MAX_VALUE, Number.MIN_VALUE, 1e-200, 1e200])("returns finite JSON or explicit unsupported range for %s", size => {
    const p = calculatePrintPlan({ ...request(), printedImage: { width: size, height: size * (9 / 16) || size, unit: "inches" } }).value;
    expect(["unsupported", "ready", "crop-confirmation-required"]).toContain(p.status);
    expect(JSON.stringify(p)).not.toMatch(/NaN|Infinity/);
  });
  it("handles safe-integer raster overflow and density overflow without recommendation", () => {
    const r = manual(1e100);
    expect(calculatePrintPlan(r).value.status).toBe("unsupported");
    r.sampling = { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1e-300 };
    expect(calculatePrintPlan(r).value.status).toBe("unsupported");
    expect(calculatePrintSizeLimit({ plan: r, viewingDistancePolicy: "fixed" }).value.status).toBe("unsupported");
  });
  it("fixed-seed integer reference search proves minimum exact-ratio raster and no upscale", () => {
    let seed = 195;
    for (let i = 0; i < 80; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const density = 1 + seed % 200, r = manual(density), p = calculatePrintPlan(r).value;
      // Independent exhaustive search among exact 16:9 candidates, in inches.
      let count = 1; while (count * 16 < 16 * density || count * 9 < 9 * density) count++;
      expect(p.minimumSamplingRaster).toEqual({ pixelWidth: 16 * count, pixelHeight: 9 * count });
      if (p.recommended) expect(p.recommended.raster.pixelWidth).toBeLessThanOrEqual(2560);
    }
  });
  it("fixed-seed angular cases cover the declared criterion after rounding", () => {
    let seed = 195;
    for (let i = 0; i < 100; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const angle = 0.01 + (seed % 100000) / 10;
      const r = request(); r.sampling = { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: angle };
      const p = calculatePrintPlan(r).value;
      if (p.recommended) {
        expect(p.recommended.angularPixelPitchArcminutes.x).toBeLessThanOrEqual(angle);
        expect(p.recommended.angularPixelPitchArcminutes.y).toBeLessThanOrEqual(angle);
      }
    }
  });
});

describe("Print input boundary", () => {
  it("copies nested request values", () => {
    const r = request(), parsed = parsePrintPlanInput(r); r.printedImage.width = 100;
    if (r.source.kind === "native-retained") r.source.geometry.nativeRaster.pixelWidth = 999;
    expect(parsed.printedImage.width).toBe(16);
    expect(parsed.source.kind === "native-retained" && parsed.source.geometry.nativeRaster.pixelWidth).toBe(2560);
  });
  it.each([null, [], {}, { ...request(), privatePath: "/secret" }, { ...request(), fit: { kind: "stretch", maximumRelativeAspectError: 0 } }, { ...request(), viewingDistance: { value: 24, unit: "feet" } }, { ...request(), source: { kind: "preview", reason: "missing-native-raster" } }, { ...request(), sampling: { kind: "angular-line-pair", periodArcminutes: 2, samplesPerPeriod: 1 } }, { ...request(), sampling: { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 10800 } }, { ...request(), sampling: { kind: "manual-ppi", pixelsPerInch: 150, maximumArcminutesPerPixel: 1 } }])("rejects malformed/unallowlisted requests", value => {
    expect(() => parsePrintPlanInput(value)).toThrow();
  });
  it.each([0, -1, NaN, Infinity, "24"])("rejects invalid physical length %s", value => {
    expect(() => parsePrintPlanInput({ ...request(), viewingDistance: { value, unit: "inches" } })).toThrow();
  });
  it("rejects nested unknown metadata, invalid identities, enums and fractional rectangles", () => {
    for (const mutate of [
      (r: PrintPlanInput): void => { Object.assign(r.printedImage, { paperWidth: 20 }); },
      (r: PrintPlanInput): void => { if (r.source.kind === "native-retained") r.source.captureId = "https://private/id"; },
      (r: PrintPlanInput): void => { if (r.source.kind === "native-retained") Object.assign(r.source.geometry.imagingArea, { private: true }); },
      (r: PrintPlanInput): void => { if (r.source.kind === "native-retained") Object.assign(r.source.geometry, { orientation: "unknown" }); },
      (r: PrintPlanInput): void => { if (r.source.kind === "native-retained") r.source.geometry.outputCropRect = { x: 0.5, y: 0, width: 10, height: 10 }; }
    ]) { const r = request(); mutate(r); expect(() => parsePrintPlanInput(r)).toThrow(); }
    expect(() => calculatePrintSizeLimit({ plan: request(), viewingDistancePolicy: "unknown" } as never)).toThrow();
  });
});

describe("Print planning parser rejections and unsupported numeric ranges", () => {
  it.each([
    ["an unknown sampling convention", { sampling: { kind: "visual-acuity" } }, "Invalid Print sampling convention."],
    ["an unknown native-unavailable reason", { source: { kind: "unavailable", reason: "lost" } }, "Invalid native-unavailable reason."]
  ])("rejects %s", (_name, patch, message) => {
    const input = { ...request(), ...patch } as unknown as PrintPlanInput;
    expect(() => parsePrintPlanInput(input)).toThrow(InvalidConfigurationError);
    expect(() => parsePrintPlanInput(input)).toThrow(message);
  });

  it.each([
    // 25.4 / 1e308 in pitch makes width / pitch overflow to Infinity.
    ["a manual density whose sample count overflows", manual(1e308)],
    // Width / height overflows, so the relative aspect error is not finite.
    ["an aspect ratio that overflows", { ...request(), printedImage: { width: 1e300, height: 1e-300, unit: "inches" } } as PrintPlanInput],
    // The provider minimum raster cannot be expressed as an exact native-ratio safe-integer raster.
    ["a provider minimum raster beyond safe integers", { ...request(), provider: { minimumRaster: { pixelWidth: 2 ** 53 - 1, pixelHeight: 9 } } } as PrintPlanInput]
  ])("reports %s as unsupported without a recommendation", (_name, input) => {
    const plan = calculatePrintPlan(input).value;
    expect(plan.status).toBe("unsupported");
    expect(plan.reasons).toContain("unsupported-numeric-range");
    expect(plan.recommended).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/NaN|Infinity/);
  });

  it("flags an exact provider density that contradicts the provider's exact raster", () => {
    // 16 x 9 in at exactly 160 PPI is 2560 x 1440, but the provider also demands 2304 x 1296.
    const plan = calculatePrintPlan({ ...request(), provider: { exactPpi: 160, exactRaster: { pixelWidth: 2304, pixelHeight: 1296 } } }).value;
    expect(plan.status).toBe("provider-conflict");
    expect(plan.reasons).toContain("provider-exact-raster-density-conflict");
  });
});
