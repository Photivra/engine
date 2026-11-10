// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculatePrintPlan, calculatePrintSizeLimit, parsePrintPlanInput, type PrintPlanInput, type PrintedImageSize } from "../src/index.js";

const IN = 25.4;
function contain(paper: PrintedImageSize, paperOrientation: "as-given" | "match-image" = "match-image", pixelWidth = 6000, pixelHeight = 4000): PrintPlanInput {
  return {
    source: { kind: "native-retained", captureId: "public-capture-1", geometry: { imagingArea: { widthMm: 36, heightMm: 24 * pixelHeight / 4000 * 6000 / pixelWidth }, nativeRaster: { pixelWidth, pixelHeight }, orientation: "landscape" } },
    printedImage: paper, viewingDistance: { value: 24, unit: "inches" },
    sampling: { kind: "angular-pixel-pitch", maximumArcminutesPerPixel: 1 },
    fit: { kind: "contain", paperOrientation }
  };
}

describe("print planning with a contain fit", () => {
  it("fits 6000x4000 on 8x10 in as a 10 x 6.667 in image with 0.667 in borders on the long edges", () => {
    const p = calculatePrintPlan(contain({ width: 8, height: 10, unit: "inches" })).value;
    expect(p.status).toBe("ready");
    expect(p.printedImageMm?.width).toBe(10 * IN);
    expect(p.printedImageMm!.height / IN).toBeCloseTo(20 / 3, 12);
    expect(p.contain?.paperRotated).toBe(true);
    expect(p.contain?.paperMm).toEqual({ width: 10 * IN, height: 8 * IN });
    expect(p.contain?.bordersMm.left).toBe(0); expect(p.contain?.bordersMm.right).toBe(0);
    expect(p.contain!.bordersMm.top / IN).toBeCloseTo(2 / 3, 12); expect(p.contain!.bordersMm.bottom).toBe(p.contain!.bordersMm.top);
    expect(p.relativeAspectError).toBeLessThan(1e-15);
    // The same plan as a confirmed-native-aspect plan of the fitted image.
    const direct = calculatePrintPlan({ ...contain({ width: 10, height: 20 / 3, unit: "inches" }), fit: { kind: "confirmed-native-aspect", maximumRelativeAspectError: 1e-12 } }).value;
    expect(p.native).toEqual(direct.native); expect(p.recommended).toEqual(direct.recommended);
    expect(p.minimumSamplingRaster).toEqual(direct.minimumSamplingRaster); expect(p.alternatives).toEqual(direct.alternatives);
  });
  it("gives no borders on 3:2 paper in either orientation", () => {
    for (const paper of [{ width: 6, height: 4 }, { width: 4, height: 6 }, { width: 150, height: 100 }]) {
      const p = calculatePrintPlan(contain({ ...paper, unit: paper.width > 10 ? "mm" : "inches" })).value;
      expect(p.contain?.bordersMm).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
      expect(p.printedImageMm).toEqual(p.contain?.paperMm);
    }
  });
  it("keeps the paper as given when asked, and fits a portrait or square image", () => {
    const asGiven = calculatePrintPlan(contain({ width: 8, height: 10, unit: "inches" }, "as-given")).value;
    expect(asGiven.contain?.paperRotated).toBe(false);
    expect(asGiven.printedImageMm?.width).toBe(8 * IN); expect(asGiven.printedImageMm!.height / IN).toBeCloseTo(16 / 3, 12);
    expect(asGiven.contain!.bordersMm.top / IN).toBeCloseTo(7 / 3, 12);
    const portrait = calculatePrintPlan(contain({ width: 297, height: 210, unit: "mm" }, "match-image", 4000, 6000)).value;
    expect(portrait.contain?.paperRotated).toBe(true); expect(portrait.contain?.paperMm).toEqual({ width: 210, height: 297 });
    expect(portrait.printedImageMm).toEqual({ width: 198, height: 297 });
    expect(portrait.contain?.bordersMm).toEqual({ left: 6, right: 6, top: 0, bottom: 0 });
    const square = calculatePrintPlan(contain({ width: 8, height: 10, unit: "inches" }, "match-image", 4000, 4000)).value;
    expect(square.contain?.paperRotated).toBe(false); expect(square.printedImageMm).toEqual({ width: 8 * IN, height: 8 * IN });
    expect(square.contain?.bordersMm).toEqual({ left: 0, right: 0, top: IN, bottom: IN });
  });
  it("gives the size limit for the same layout, with the paper that holds it", () => {
    const input = contain({ width: 8, height: 10, unit: "inches" });
    const plan = calculatePrintPlan(input).value;
    const fixed = calculatePrintSizeLimit({ plan: input, viewingDistancePolicy: "fixed" }).value;
    expect(fixed.status).toBe("finite"); expect(fixed.maximumImageMm).toEqual(plan.alternatives?.maximumImageMmAtCurrentDistance);
    const scale = fixed.maximumImageMm!.width / plan.printedImageMm!.width;
    expect(fixed.maximumPaperMm?.width).toBeCloseTo(10 * IN * scale, 9); expect(fixed.maximumPaperMm?.height).toBeCloseTo(8 * IN * scale, 9);
    const proportional = calculatePrintSizeLimit({ plan: input, viewingDistancePolicy: "proportional-to-image-size" }).value;
    expect(proportional.status).toBe("unbounded"); expect(proportional.maximumPaperMm).toBeNull();
  });
  it("cannot place the image without the native raster, and leaves existing plans without layout fields", () => {
    const unknown = calculatePrintPlan({ ...contain({ width: 8, height: 10, unit: "inches" }), source: { kind: "unavailable", reason: "missing-native-raster" } }).value;
    expect(unknown.status).toBe("cannot-assess"); expect(unknown.printedImageMm).toBeNull(); expect(unknown.contain).toBeNull();
    expect(unknown.guidance).not.toBeNull();
    const native = { ...contain({ width: 6, height: 4, unit: "inches" }), fit: { kind: "confirmed-native-aspect", maximumRelativeAspectError: 0 } } as PrintPlanInput;
    expect(Object.hasOwn(calculatePrintPlan(native).value, "contain")).toBe(false);
    expect(Object.hasOwn(calculatePrintSizeLimit({ plan: native, viewingDistancePolicy: "fixed" }).value, "maximumPaperMm")).toBe(false);
  });
  it("rejects incomplete or mixed fits", () => {
    const base = contain({ width: 8, height: 10, unit: "inches" });
    for (const fit of [{ kind: "contain" }, { kind: "contain", paperOrientation: "rotate" }, { kind: "contain", paperOrientation: "as-given", maximumRelativeAspectError: 0 }, { kind: "confirmed-native-aspect", maximumRelativeAspectError: 0, paperOrientation: "as-given" }, { kind: "cover", paperOrientation: "as-given" }]) {
      expect(() => parsePrintPlanInput({ ...base, fit })).toThrow();
    }
    expect(parsePrintPlanInput(base).fit).toEqual({ kind: "contain", paperOrientation: "match-image" });
  });
});
