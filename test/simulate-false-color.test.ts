// SPDX-License-Identifier: Apache-2.0
// #739: simulateFalseColor, the demosaic's color error against a full-color sensor reading of the same capture (expected values).
import { describe, expect, it } from "vitest";
import { encodeSrgbComponentPortable } from "../src/color/srgb-transfer.js";
import { createDisplayViewExpectedSignal } from "../src/facade/display-view.js";
import { prepareDisplayView, preparedDisplayViewParts, renderPreparedDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { SIMULATE_FALSE_COLOR_LIMITS, simulateFalseColor, type SimulateCaptureOptions } from "../src/index.js";

type Scene = SimulateCaptureOptions["scene"];
/** A neutral sine grating along u at `f` cycles per output pixel of a 64-pixel-wide frame (u spans 2 frame units). */
const grating = (f: number, angle = 0): Scene => ({ kind: "reflectance-function", sceneId: "grating-" + f + "-" + angle,
  evaluate: (p: { u: number; v: number }) => 0.4 + 0.3 * Math.sin(2 * Math.PI * f * 32 * (Math.cos(angle) * p.u + Math.sin(angle) * p.v)) }) as Scene;
const request = (scene: Scene, extra: Partial<SimulateCaptureOptions> = {}, demosaic: "bilinear" | "ahd" = "bilinear"): SimulateCaptureOptions =>
  ({ scene, ...extra, output: { width: 64, height: 64, demosaic, ...(extra.output ?? {}) } }) as SimulateCaptureOptions;
const mean = async (scene: Scene, demosaic: "bilinear" | "ahd", extra: Partial<SimulateCaptureOptions> = {}): Promise<number> =>
  (await simulateFalseColor(request(scene, extra, demosaic))).chromaDifference.mean;

describe("simulateFalseColor (#739)", () => {
  it("gives 0 on a flat field, neutral and colored, with both demosaics", async () => {
    const colored = { kind: "reflectance-function", sceneId: "flat-colored", evaluate: (p: { wavelengthNanometers: number }) => 0.3 + 0.2 * Math.sin(p.wavelengthNanometers / 50) } as Scene;
    for (const scene of [{ preset: "uniform" } as Scene, colored]) for (const demosaic of ["bilinear", "ahd"] as const) {
      const r = await simulateFalseColor(request(scene, {}, demosaic));
      const d = r.chromaDifference;
      for (const v of [d.mean, d.rootMeanSquare, d.median, d.percentile95, d.percentile99, d.maximum, r.colorDifference.meanDeltaE76]) expect(v).toBeLessThanOrEqual(1e-9);
      expect(d.fractionAbove.map((f) => f.fraction)).toEqual([0, 0, 0]);
      expect(d.pixelCount).toBe(64 * 64);
    }
  }, 60_000);

  it("rises with the grating's frequency and is clear near Nyquist (bilinear)", async () => {
    const at = await Promise.all([0.05, 0.25, 0.45].map((f) => simulateFalseColor(request(grating(f)))));
    expect(at[0]!.chromaDifference.mean).toBeLessThan(at[1]!.chromaDifference.mean);
    expect(at[1]!.chromaDifference.mean).toBeLessThan(at[2]!.chromaDifference.mean);
    expect(at[2]!.chromaDifference.mean).toBeGreaterThan(20);
    expect(at[2]!.chromaDifference.fractionAbove[2]!.fraction).toBeGreaterThan(0.5);
    for (const r of at) expect(r.meanChroma.reference).toBeLessThan(1);
  }, 60_000);

  it("is lower with AHD than with bilinear on gratings, the Siemens star and the zone plate", async () => {
    for (const scene of [grating(0.25), grating(0.45), grating(0.45, Math.PI / 4), { preset: "siemens-star" } as Scene, { preset: "zone-plate" } as Scene])
      expect(await mean(scene, "ahd")).toBeLessThan(await mean(scene, "bilinear"));
  }, 120_000);

  it("falls by more than half with the four-spot filter and with diffraction at f/16", async () => {
    const plain = await mean(grating(0.45), "bilinear");
    expect(await mean(grating(0.45), "bilinear", { sensor: { antiAliasing: { kind: "four-spot" } } } as Partial<SimulateCaptureOptions>)).toBeLessThan(plain / 2);
    expect(await mean(grating(0.45), "bilinear", { lens: { prime: 50, fNumber: 16, diffraction: "circular-aperture" } } as Partial<SimulateCaptureOptions>)).toBeLessThan(plain / 2);
  }, 120_000);

  it("reads the capture's mosaic: each site's own-channel plane equals the view's expected signal bit for bit", async () => {
    const cases: Partial<SimulateCaptureOptions>[] = [{}, { sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } } as Partial<SimulateCaptureOptions>,
      { lens: { prime: 50, fNumber: 11, diffraction: "circular-aperture" } } as Partial<SimulateCaptureOptions>, { lens: { catalogue: "pv-50-1.8", fNumber: 2.8 } } as Partial<SimulateCaptureOptions>];
    for (const scene of [{ preset: "siemens-star" } as Scene, grating(0.3)]) for (const extra of cases) {
      const prepared = await prepareDisplayView({ ...request(scene, extra), fast: false }, { gpu: "off" });
      const [parts] = preparedDisplayViewParts(prepared, "test"), W = parts.context.width, H = parts.context.height;
      const run = { started: 0, viewStarted: 0, checkAbort: (): void => {}, yieldControl: (): Promise<void> => Promise.resolve() };
      const { setup, signal } = parts.setupOf({ width: W, height: H, samplesPerAxis: 1, bitDepth: 8, format: "srgb-8" }, run);
      const factory = parts.context.lens ?? createDisplayViewExpectedSignal, input = setup.gpu!.reference!;
      const planes = [0, 1, 2].map((c) => factory({ ...input, channelAt: () => c }, W + 8));
      let differing = 0;
      for (let y = 0; y < setup.nativeHeight; y++) for (let x = 0; x < setup.nativeWidth; x++) if (planes[input.channelAt(x, y)]!.site(x, y) !== signal.site(x, y)) differing++;
      expect(differing).toBe(0);
    }
  }, 240_000);

  it("develops the capture side as the view does: equal to a 1:1 view's expected values on a mid-tone scene", async () => {
    const scene = { kind: "reflectance-function", sceneId: "mid", evaluate: (p: { u: number; v: number }) => 0.25 + 0.1 * Math.sin(9 * p.u) * Math.cos(7 * p.v) } as Scene;
    for (const demosaic of ["bilinear", "ahd"] as const) {
      const options = { ...request(scene, {}, demosaic), fast: false } as SimulateCaptureOptions;
      const r = await simulateFalseColor(options, { images: true });
      const { internals } = await renderPreparedDisplayViewWithInternals(await prepareDisplayView(options, { gpu: "off" }), { width: 64, height: 64, samplesPerAxis: 1 });
      let worst = 0;
      for (let i = 0; i < 64 * 64; i++) for (let c = 0; c < 3; c++)
        worst = Math.max(worst, Math.abs(r.images!.capture[4 * i + c]! - Math.round(encodeSrgbComponentPortable(Math.min(1, Math.max(0, internals.expected[3 * i + c]!))) * 255)));
      // Measured: 0 codes apart on arm64 (the view takes the mean of a value far from every clip as it is); one code allows rounding elsewhere.
      expect(worst).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it("integrates each site from its spectrum: a material scene and its reflectance function agree", async () => {
    const at = (p: { u: number; v: number }): number => (p.u + 0.2 * p.v > 0.05 ? 1 : 0);
    const materials = { kind: "material-function", sceneId: "two", materials: [0.2, 0.6], materialAt: at } as unknown as Scene;
    const reflectance = { kind: "reflectance-function", sceneId: "two-r", evaluate: (p: { u: number; v: number }) => [0.2, 0.6][at(p)]! } as Scene;
    for (const demosaic of ["bilinear", "ahd"] as const) {
      const a = await simulateFalseColor(request(materials, {}, demosaic), { map: true }), b = await simulateFalseColor(request(reflectance, {}, demosaic), { map: true });
      expect(a.chromaDifference.mean).toBeGreaterThan(0);
      let worst = 0;
      for (let i = 0; i < a.map!.values.length; i++) worst = Math.max(worst, Math.abs(a.map!.values[i]! - b.map!.values[i]!));
      // Measured: equal (0 apart) on arm64.
      expect(worst).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(a.chromaDifference.mean - b.chromaDifference.mean)).toBeLessThanOrEqual(1e-12);
    }
  }, 120_000);

  it("goes through the lens signal: 0 inside one color patch, more across the patch edges", async () => {
    const options = { scene: { preset: "color-patches" }, lens: { catalogue: "pv-50-1.8", fNumber: 4 }, output: { width: 128, height: 96, demosaic: "ahd" } } as SimulateCaptureOptions;
    expect((await simulateFalseColor(options)).chromaDifference.maximum).toBeGreaterThan(1);
    // Inside the first patch (measured: below 0.05 there, at f/4 and f/8 and without the catalogue lens).
    expect((await simulateFalseColor(options, { region: { x: 8, y: 8, width: 4, height: 4 } })).chromaDifference.maximum).toBeLessThan(0.05);
  }, 120_000);

  it("gives a region the same values as the same pixels of the whole frame, bit for bit", async () => {
    for (const demosaic of ["bilinear", "ahd"] as const) {
      const options = request({ preset: "siemens-star" } as Scene, { lens: { prime: 50, fNumber: 11, diffraction: "circular-aperture" } } as Partial<SimulateCaptureOptions>, demosaic);
      const whole = await simulateFalseColor(options, { map: true, images: true });
      const region = { x: 13, y: 21, width: 30, height: 17 };
      const part = await simulateFalseColor(options, { region, map: { maximum: 10 }, images: true });
      expect(part.region).toEqual({ ...region, frameWidth: 64, frameHeight: 64 });
      for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
        const i = y * region.width + x, j = (y + region.y) * 64 + x + region.x;
        expect(part.map!.values[i]).toBe(whole.map!.values[j]);
        for (let c = 0; c < 4; c++) { expect(part.images!.capture[4 * i + c]).toBe(whole.images!.capture[4 * j + c]); expect(part.images!.reference[4 * i + c]).toBe(whole.images!.reference[4 * j + c]); }
      }
      expect(part.map!.maximum).toBe(10);
    }
  }, 120_000);

  it("reports its statistics consistently and its map as a gray image", async () => {
    const r = await simulateFalseColor(request({ preset: "zone-plate" } as Scene), { thresholds: [0.5, 10, 50, 200], map: { maximum: 40 } });
    const v = r.map!.values, d = r.chromaDifference, sorted = Float64Array.from(v).sort();
    expect(d.fractionAbove.map((f) => f.threshold)).toEqual([0.5, 10, 50, 200]);
    for (const f of d.fractionAbove) expect(f.fraction).toBe(v.filter((x) => x > f.threshold).length / v.length);
    expect(Math.fround(d.maximum)).toBe(Math.max(...v));
    expect(Math.fround(d.maximum)).toBe(v[d.maximumAt.y * 64 + d.maximumAt.x]);
    // Percentiles: the upper edge of the 0.01 bin of the quantile, so at most 0.01 above the sorted value.
    expect(d.median - sorted[Math.ceil(0.5 * v.length) - 1]!).toBeGreaterThanOrEqual(-1e-6);
    expect(d.median - sorted[Math.ceil(0.5 * v.length) - 1]!).toBeLessThanOrEqual(0.0101);
    expect(d.percentile99).toBeLessThanOrEqual(d.maximum);
    for (let i = 0; i < v.length; i++) {
      const g = Math.round(encodeSrgbComponentPortable(Math.min(1, v[i]! / 40)) * 255);
      expect([r.map!.rgba[4 * i], r.map!.rgba[4 * i + 1], r.map!.rgba[4 * i + 2], r.map!.rgba[4 * i + 3]]).toEqual([g, g, g, 255]);
    }
    expect(r.assumptions.slice(-3).map((a) => a.id)).toEqual(["falseColor.reference", "falseColor.capture", "falseColor.metric"]);
    expect(r.kind).toBe("false-color");
    expect(r.images).toBeUndefined();
  }, 60_000);

  it("refuses what it does not measure, with its own name", async () => {
    const star = { preset: "siemens-star" } as Scene;
    const refused: [Record<string, unknown>, RegExp][] = [
      [{ fast: true }, /does not support fast: true/], [{ lens: { prime: 50, fNumber: 8, diffraction: { kind: "circular-aperture", fast: true } } }, /does not support lens\.diffraction\.fast: true/],
      [{ output: { width: 64, height: 64, demosaic: { kind: "ahd", fast: true } } }, /output\.demosaic\.fast: true/], [{ sensor: { pixelAperture: { kind: "box", fast: true } } }, /sensor\.pixelAperture\.fast: true/],
      [{ motion: { subject: { velocityMPerSec: { x: 0.1, y: 0 }, fast: true } } }, /motion\.subject\.fast: true/], [{ lens: { catalogue: { kind: "pv-50-1.8", fast: true } } }, /lens\.catalogue\.fast: true/],
      [{ sensor: { antiAliasing: { kind: "four-spot", fast: true } } }, /sensor\.antiAliasing\.fast: true/], [{ output: { width: 64, height: 64, toneCurve: "extended-reinhard-luminance" } }, /luminance tone curve/],
      [{ output: { width: 64, height: 64, highlightMode: "reconstruct" } }, /highlightMode/], [{ output: { width: 64, height: 64, gamutHandling: "desaturate-to-luminance" } }, /desaturate/],
      [{ output: { width: 64, height: 64, sharpening: { radiusPixels: 1, amount: 1 } } }, /output\.sharpening/], [{ output: { width: 64, height: 64, region: { x: 0, y: 0, width: 8, height: 8 } } }, /second argument/],
      [{ output: { width: 64, height: 64, format: "png" } }, /output\.format/], [{ output: { width: 64, height: 64, whiteBalance: "auto" } }, /whiteBalance/],
      [{ lens: { prime: 50, fNumber: 8, pupilSampling: { rings: 2 } } }, /pupilSampling/]];
    for (const [extra, message] of refused) await expect(simulateFalseColor({ scene: star, output: { width: 64, height: 64 }, ...extra } as SimulateCaptureOptions)).rejects.toThrow(message);
    const base = { scene: star, output: { width: 64, height: 64 } } as SimulateCaptureOptions;
    for (const [measure, message] of [[{ bogus: 1 }, /bogus|unknown/i], [{ thresholds: [2, 1] }, /increasing/], [{ thresholds: [0] }, /\(0, 200\]/], [{ thresholds: new Array(9).fill(1) }, /1 to 8/],
      [{ map: { maximum: 201 } }, /\(0, 200\]/], [{ region: { x: 60, y: 0, width: 8, height: 8 } }, /measure\.region\.width/], [{ images: "yes" }, /boolean/]] as const)
      await expect(simulateFalseColor(base, measure as never)).rejects.toThrow(message);
    const controller = new AbortController();
    controller.abort();
    await expect(simulateFalseColor({ ...base, signal: controller.signal } as SimulateCaptureOptions)).rejects.toThrow(/abort/i);
    expect(SIMULATE_FALSE_COLOR_LIMITS).toEqual({ maximumThresholds: 8, maximumDifference: 200 });
  }, 60_000);

  it("gives identical results on two calls", async () => {
    const options = request(grating(0.3), {}, "ahd");
    const a = await simulateFalseColor(options, { map: true, images: true }), b = await simulateFalseColor(options, { map: true, images: true });
    expect(b.chromaDifference).toEqual(a.chromaDifference);
    expect(b.map!.values).toEqual(a.map!.values);
    expect(b.images).toEqual(a.images);
  }, 60_000);
});
