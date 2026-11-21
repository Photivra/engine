// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { clearDisplayViewLensZoneCache, displayViewLensZoneCacheState, prepareDisplayViewLensSignal, type DisplayViewLensPsf } from "../src/facade/display-view-lens-signal.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { exposure } from "./helpers/display-view-lens-catalogue.js";
import { prepare, uniformWindowCheck, uniformWindowLenses } from "./helpers/display-view-lens-uniform-windows.js";

/*
 * #655 (CPU): the catalogue lens's display-view signal (src/facade/display-view-lens-signal.ts, psfSite). Each site is
 * Σ_n A_c(λ_n)·Σ_t K_{z,n}(t)·B(x − t)[n], B the lattice point's spectral radiance pre-integrated over the query offsets with each
 * point's field factor. The reference is 2.26.0's sum, which the signal still forms where it has no field-dependent PSF: the combined
 * kernels of each lattice group and per-material sums (kernelSite), given the zone's kernels as the input's. With one zone the two
 * are the same sum regrouped: every site within 1e-9 relative (the 2.27.0 plan's equivalence tolerance). The zone selection is
 * unchanged and covered by test/display-view-lens-catalogue*.test.ts against the capture.
 * #693 (2.28.0): the uniform-window check over every catalogue lens set this file's shard's run time (815 to 1,004 s of a 20-minute
 * job under coverage), so it is split by lens set into two files of about equal time: the professional lenses here, the others in
 * test/display-view-lens-catalogue-regrouped-2.test.ts. Each part asserts the bound and the uniform share on its own lenses, which
 * implies the single test's assertions over all of them.
 */

/** Every native site of a signal, read through windows of whole rows (as a render reads them). */
function sites(signal: DisplayViewExpectedSignal, W: number, H: number): Float64Array {
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y += 8) {
    signal.window(0, y, W, Math.min(H, y + 8));
    for (let j = y; j < Math.min(H, y + 8); j++) for (let x = 0; x < W; x++) out[j * W + x] = signal.site(x, j);
  }
  return out;
}
function largestRelative(a: Float64Array, b: Float64Array): number {
  let largest = 0;
  for (let i = 0; i < a.length; i++) largest = Math.max(largest, b[i] === 0 ? (a[i] === 0 ? 0 : Infinity) : Math.abs(a[i]! - b[i]!) / b[i]!);
  return largest;
}
/** The view's PSF reduced to one zone (the frame centre's), everywhere. */
function oneZone(psf: DisplayViewLensPsf, W: number, H: number): DisplayViewLensPsf {
  const z = psf.zoneOf(W >> 1, H >> 1);
  return { ...psf, zoneOf: () => z, zoneKernels: (_, wl) => psf.zoneKernels(z, wl) };
}

const base: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, subjectDistanceM: 2, output: { width: 40, height: 26 }, sensor: { pixelPitchMicrometers: 6, spectralStepNanometers: 40 },
  exposure, lens: { catalogue: "pv-24-1.8", fNumber: 2.8 } };
const rings = { kind: "reflectance-function", sceneId: "rings", evaluate: (p: { u: number; v: number }): number => 0.4 + 0.3 * Math.cos(40 * Math.hypot(p.u, p.v)) } as const;
const cases: [string, SimulateCaptureOptions][] = [
  ["the point aperture", base],
  ["the 2 × 2 box aperture", { ...base, sensor: { ...base.sensor, pixelAperture: { kind: "box", samplesPerAxis: 2 } } }],
  ["the box and the four-spot filter", { ...base, sensor: { ...base.sensor, pixelAperture: { kind: "box", samplesPerAxis: 2 }, antiAliasing: { kind: "four-spot" } } }],
  ["a radiance scene", { ...base, scene: rings } as SimulateCaptureOptions],
  ["a fisheye (rays beyond 90° see no scene)", { ...base, lens: { catalogue: "pv-8-3.5-fisheye-pro", fNumber: 5.6 } }],
  ["camera rotation, 3 midpoints", { ...base, motion: { angularVelocityRadPerSec: { pitch: 0.2, yaw: 0.5, roll: 3 } }, sensor: { ...base.sensor, temporalSampleCount: 3 } }],
  ["camera rotation under a rolling shutter", { ...base, motion: { angularVelocityRadPerSec: { yaw: 0.5, roll: 3 }, shutter: "rolling", rollingShutterSkewSeconds: 0.004 },
    sensor: { ...base.sensor, temporalSampleCount: 2 } }]
];

describe("catalogue-lens display view: the pre-integrated kernel pass (#655)", () => {
  for (const [name, options] of cases) {
    it("with " + name + ": every site within 1e-9 of the combined kernels' per-material sums (2.26.0's sum)", async () => {
      const { lens, W, H, input } = await prepare(options), psf = oneZone(lens.psf!, W, H);
      const kernels = psf.zoneKernels(0, input.wavelengthsNm);
      // A fresh input object with the zone's kernels: its tables (lattice groups, combined kernels) are built from them.
      const zoneInput: DisplayViewExpectedSignalInput = { ...input, kernels: { radius: lens.psf!.radius, perNode: [...kernels.perNode] }, perTapSum: false };
      const regrouped = sites(prepareDisplayViewLensSignal({ ...lens, psf, uniformWindows: false }, W, H, 0, "test")(zoneInput), W, H);
      const reference = sites(prepareDisplayViewLensSignal({ ...lens, psf: undefined }, W, H, 0, "test")(zoneInput), W, H);
      expect(largestRelative(regrouped, reference)).toBeLessThan(1e-9);
      // #655 step 2 off the catalogue path: the per-tap sum with field factors (#643's on the lens path) is the same sum too.
      if (input.scene.kind === "materials") {
        const perTap = sites(prepareDisplayViewLensSignal({ ...lens, psf: undefined }, W, H, 0, "test")({ ...zoneInput, perTapSum: true }), W, H);
        expect(largestRelative(perTap, reference)).toBeLessThan(1e-9);
      }
    }, scaledTimeout(120_000));
  }

  it("keeps zone kernels across prepared views by content: a second view resolves none and renders the same bits", async () => {
    clearDisplayViewLensZoneCache();
    const view = { width: 10, height: 6 };
    const first = await simulateDisplayViewWithInternals(base, view), after = displayViewLensZoneCacheState();
    expect(after.resolves).toBeGreaterThan(0);
    const second = await simulateDisplayViewWithInternals(base, view), again = displayViewLensZoneCacheState();
    expect(again.resolves).toBe(after.resolves);
    expect(again.hits).toBeGreaterThan(after.hits);
    expect(Array.from(second.result.image.samples)).toEqual(Array.from(first.result.image.samples));
    // Another f-number is another content: its zones are resolved.
    await simulateDisplayViewWithInternals({ ...base, lens: { catalogue: "pv-24-1.8", fNumber: 4 } }, view);
    expect(displayViewLensZoneCacheState().resolves).toBeGreaterThan(again.resolves);
    expect(displayViewLensZoneCacheState().bytes).toBeLessThanOrEqual(32 * 1048576);
  }, scaledTimeout(120_000));

  /*
   * #655 step 6, go/no-go: the uniform-window method (a site whose taps all read one material takes the field factor to second order)
   * against the full method, per site, on every catalogue lens at its widest and narrowest aperture: at most 1e-6 relative. The plan's first-order
   * form measured 5.4e-6 at most here (no-go); the second-order form 2.7e-8. Part 1 of 2: the professional lenses.
   */
  it("uniform windows: every site within 1e-6 of the full method on every catalogue lens, widest and narrowest aperture (part 1 of 2: professional)", async () => {
    const lenses = uniformWindowLenses(1);
    expect(lenses.length).toBeGreaterThan(0);
    const { largest, uniformSites, total } = await uniformWindowCheck(lenses);
    expect(uniformSites).toBeGreaterThan(0.2 * total);
    expect(largest).toBeLessThan(1e-6);
  }, scaledTimeout(900_000));
});
