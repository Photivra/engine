// SPDX-License-Identifier: Apache-2.0
/**
 * #632: a catalogue lens's veiling glare (`lens.catalogue.flare`): E′ = (1 − g)·E + g·Ē on every site, integrated per site with the
 * site's own channel response, on the fast and exact capture paths and in the display view. Ghosts are reported, not rendered.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveGenericLens, simulateCapture, simulateDisplayView, simulateIdealReference, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
import { createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";
import { genericLensVeilStep } from "../src/equipment/generic-lens-framing.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

afterEach(() => setCatalogueLensSignalTestHook(undefined));

const LENS = "pv-16-2.8";
const g = resolveGenericLens({ lensId: LENS, activeImagingArea: { widthMm: 36, heightMm: 24 } }).character.strayLight.veilingGlareFraction;
const board = (flare: boolean, fast: boolean, width = 96): SimulateCaptureOptions => ({ scene: { preset: "checkerboard", squaresAcross: 6, darkReflectance: 0.01, lightReflectance: 0.9 },
  subjectDistanceM: 3, output: { width, height: width * 2 / 3, format: "srgb-16" }, sensor: { pixelPitchMicrometers: 36000 / width, spectralStepNanometers: 50 },
  lens: { catalogue: { kind: LENS, fast, flare }, fNumber: 8 }, exposure: { mode: "manual", shutterSeconds: 1 / 100, iso: 100 } });

/** Black-subtracted RAW of the green sites (even rows, odd columns of the RGGB mosaic and the converse). */
function greens(r: SimulateCaptureResult): Float64Array {
  const W = r.raw.plan.exposure.geometry.nativeRaster.pixelWidth, out: number[] = [];
  for (let i = 0; i < r.raw.codes.length; i++) { const x = i % W, y = Math.floor(i / W); if (((x + y) & 1) === 1) out.push(r.raw.codes[i]! - r.raw.blackLevels[i]!); }
  return Float64Array.from(out);
}
const mean = (a: ArrayLike<number>, pick: (i: number) => boolean = () => true): number => { let s = 0, n = 0; for (let i = 0; i < a.length; i++) if (pick(i)) { s += a[i]!; n++; } return s / n; };

describe("lens.catalogue.flare: veiling glare (#632)", () => {
  it("lifts the dark squares by g·(Ē − E) and keeps the frame's mean, on the fast and the exact path", async () => {
    expect(g).toBeCloseTo(0.024, 12);
    for (const fast of [true, false]) {
      const off = greens(await simulateCapture(board(false, fast))), onResult = await simulateCapture(board(true, fast)), on = greens(onResult);
      const peak = Math.max(...off), dark = (i: number): boolean => off[i]! < 0.1 * peak;
      const frame = mean(off), darkOff = mean(off, dark), darkOn = mean(on, dark);
      // The frame's mean is kept (the veil is the image's own light, spread uniformly); Poisson noise of the same seeds differs by well under 0.3 %.
      expect(Math.abs(mean(on) / frame - 1)).toBeLessThan(0.003);
      expect(Math.abs((darkOn - darkOff) / (g * (frame - darkOff)) - 1)).toBeLessThan(0.1);
      const method = (onResult.assumptions.find((a) => a.id === "raw.expectedSignal")!.value as { method: string }).method;
      expect(method).toBe(fast ? "per-site-integrated-electrons-catalogue-psf-field-grid" : "per-site-integrated-electrons-catalogue-psf-exact-kernels");
      const flare = onResult.assumptions.find((a) => a.id === "lens.catalogue.flare")!.value as Record<string, unknown>;
      expect(flare).toMatchObject({ veilingGlareFraction: g, ghostsRendered: false, rendered: true, latticeStep: 1 });
    }
  }, scaledTimeout(600_000));

  it("integrates each site's veil from the frame's mean spectrum with the site's own channel response", async () => {
    let input: CatalogueLensSignalInput | undefined;
    setCatalogueLensSignalTestHook({ onInput: (given) => { input = given; } });
    await simulateCapture(board(false, true));
    setCatalogueLensSignalTestHook(undefined);
    const plain = createCatalogueLensSignal(input!), veiled = createCatalogueLensSignal({ ...input!, veil: { fraction: 0.1, step: 1 } });
    const mean = veiled.veilMean!.radiance;
    expect(veiled.veilMean!.samples).toBe(input!.nativeWidth * input!.nativeHeight);
    for (const [x, y] of [[10, 10], [11, 10], [11, 11], [40, 30]] as const) {
      plain.window(x, y, x + 1, y + 1);
      const c = input!.channelAt(x, y), a = input!.electronsPerRadiance[c]!;
      let v = 0;
      for (let n = 0; n < mean.length; n++) v += a[n]! * mean[n]!;
      const e = plain.site(x, y);
      expect(veiled.veiled!(e, x, y)).toBeCloseTo(0.9 * e + 0.1 * v, 9);
    }
    // The fast request's mean reads every n-th site; on a 96-wide frame that is every site, and a coarser lattice stays within 1 % here.
    const coarse = createCatalogueLensSignal({ ...input!, veil: { fraction: 0.1, step: 3 } }).veilMean!.radiance;
    for (let n = 0; n < mean.length; n++) expect(Math.abs(coarse[n]! / mean[n]! - 1)).toBeLessThan(0.01);
    expect(genericLensVeilStep(96, 64, true)).toBe(1);
    expect(genericLensVeilStep(6000, 4000, true)).toBe(20);
    expect(genericLensVeilStep(6000, 4000, false)).toBe(1);
  }, scaledTimeout(240_000));

  it("renders in the display view as in the capture: the dark squares' lift agrees within 15 %", async () => {
    const view = { width: 48, height: 32 };
    const options = (flare: boolean): SimulateCaptureOptions => board(flare, true);
    const [viewOff, viewOn] = [await simulateDisplayView(options(false), view), await simulateDisplayView(options(true), view)];
    const full = viewOff.image.samples instanceof Uint8Array ? 255 : 65535;
    const linear = (v: number): number => { const e = v / full; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
    const green = (samples: ArrayLike<number>): Float64Array => Float64Array.from({ length: samples.length / 3 }, (_, i) => linear(samples[i * 3 + 1]!));
    const off = green(viewOff.image.samples), on = green(viewOn.image.samples), peak = Math.max(...off), dark = (i: number): boolean => off[i]! < 0.1 * peak;
    const viewLift = (mean(on, dark) - mean(off, dark)) / (mean(off) - mean(off, dark));
    expect(Math.abs(viewLift / g - 1)).toBeLessThan(0.15);
    expect(viewOn.assumptions.some((a) => a.id === "lens.catalogue.flare")).toBe(true);
  }, scaledTimeout(240_000));

  it("is refused with camera rotation and motion.subject, takes a boolean, and is not part of the ideal reference", async () => {
    await expect(simulateCapture({ ...board(true, true), motion: { angularVelocityRadPerSec: { yaw: 0.01 } } })).rejects.toThrow(/flare needs a still camera/);
    await expect(simulateCapture({ ...board(true, true), motion: { subject: { velocityMPerSec: { x: 0.01, y: 0 } } } })).rejects.toThrow(/flare needs a still camera/);
    await expect(simulateCapture({ ...board(true, true), lens: { catalogue: { kind: LENS, flare: "yes" as never } } })).rejects.toThrow(/must be a boolean/);
    const reference = await simulateIdealReference(board(true, true));
    expect((reference.assumptions.find((a) => a.id === "lens.catalogue.flare")!.value as { rendered: boolean }).rendered).toBe(false);
    const plain = await simulateIdealReference(board(false, true));
    expect(reference.image.samples).toEqual(plain.image.samples);
  }, scaledTimeout(240_000));
});
