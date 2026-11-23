// SPDX-License-Identifier: Apache-2.0
/**
 * #760: the Quality kit's batch resolver (`resolveLensSampledPsfKernelsAt`) gives the kernels of `resolveLensSampledPsfKernel`, bit
 * for bit, and its errors at the same wavelength; it computes each node kernel's centroid once (facade-08). The display view's field
 * PSF gives the same zone kernels with it as without it, and its cache keeps its byte bound and least-recently-used order.
 */
import { describe, expect, it, vi } from "vitest";
import { resolveGenericLens } from "../src/index.js";
import { createGenericLensPsfProfile } from "../src/optics/generic-lens-psf.js";
import * as profileModule from "../src/optics/lens-psf-profile.js";
import { markEngineOwnedLensSampledPsfProfile, resolveLensSampledPsfKernel, type LensSampledPsfProfile, type ResolveLensSampledPsfInput } from "../src/optics/lens-psf-profile.js";
import { resolveLensSampledPsfKernelsAt } from "../src/optics/lens-psf-kernels.js";
import { clearDisplayViewLensZoneCache, createDisplayViewLensPsf, DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES, displayViewLensZoneCacheState } from "../src/facade/display-view-lens-signal.js";

vi.mock("../src/optics/lens-psf-profile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/optics/lens-psf-profile.js")>();
  return { ...original, kernelCentroid: vi.fn(original.kernelCentroid) };
});

const EVIDENCE = [{ sourceOrigin: "photivra" as const, sourceReference: "test:lens-psf-kernels-at", reuseStatus: "photivra-owned" as const }];
type State = Omit<ResolveLensSampledPsfInput, "wavelengthNm">;

/** A catalogue lens's PSF state on a W × H raster of `pitch` µm (an engine-owned clone, as the capture passes it), and the frame's half extent. */
function catalogueState(lensId: string, fNumber: number, pitch: number, W = 600, H = 400): { state: Omit<State, "fieldPointMm">; half: { x: number; y: number } } {
  const area = { widthMm: W * pitch / 1000, heightMm: H * pitch / 1000 }, half = { x: area.widthMm / 2, y: area.heightMm / 2 };
  const lens = resolveGenericLens({ lensId, activeImagingArea: area, fNumber, focusDistanceM: 3 });
  const built = createGenericLensPsfProfile({ lens, focusDistanceM: 3, sitePitchMicrometers: pitch, fieldHalfExtentMm: { x: half.x + 0.01, y: half.y + 0.01 }, frameHalfMm: half, evidence: EVIDENCE });
  const profile = structuredClone(built.profile);
  markEngineOwnedLensSampledPsfProfile(profile);
  return { state: { profile, focalLengthMm: lens.focalLengthMm, focus: { kind: "finite", distanceM: 3 }, apertureFNumber: fNumber, signedDefocusImagePlaneMicrometers: 0 }, half };
}

const WAVELENGTHS = Array.from({ length: 21 }, (_, i) => 380 + 20 * i);
/** Field points across the frame: a 9 × 7 grid, the profile's own field nodes (exact corners) and the axis. */
function fieldPoints(profile: LensSampledPsfProfile, half: { x: number; y: number }): { x: number; y: number }[] {
  const out = [{ x: 0, y: 0 }];
  for (let j = 0; j < 7; j++) for (let i = 0; i < 9; i++) out.push({ x: (2 * i / 8 - 1) * half.x * 0.999, y: (2 * j / 6 - 1) * half.y * 0.999 });
  for (const x of profile.axes.fieldXmm) for (const y of profile.axes.fieldYmm) if (Math.abs(x) <= half.x && Math.abs(y) <= half.y) out.push({ x, y });
  return out;
}
/** The per-call kernels, as one array. */
function perCall(state: State, wavelengths: readonly number[]): Float64Array {
  const kernels = wavelengths.map((wavelengthNm) => resolveLensSampledPsfKernel({ ...state, wavelengthNm } as ResolveLensSampledPsfInput).normalizedIntensity);
  return Float64Array.from(kernels.flat());
}
/** The batch resolver's kernels, as one array. */
const batch = (state: State, wavelengths: readonly number[]): Float64Array => Float64Array.from(resolveLensSampledPsfKernelsAt(state, wavelengths).flat());
const radius = (state: Omit<State, "fieldPointMm">): number => (state.profile as LensSampledPsfProfile).nodes[0]!.kernel.centerSampleX;
const same = (a: Float64Array, b: Float64Array): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const errorOf = (f: () => unknown): string => { try { f(); return "no error"; } catch (error) { return (error as Error).constructor.name + ": " + (error as Error).message; } };

describe("resolveLensSampledPsfKernelsAt (#760)", () => {
  it("gives resolveLensSampledPsfKernel's kernels bit for bit: two catalogue lenses, 70 field points, 21 wavelengths", () => {
    for (const [lensId, fNumber, pitch] of [["pv-50-1.2-pro", 1.4, 6], ["pv-16-2.8", 4, 3]] as const) {
      const { state, half } = catalogueState(lensId, fNumber, pitch);
      for (const fieldPointMm of fieldPoints(state.profile as LensSampledPsfProfile, half)) {
        const at = { ...state, fieldPointMm };
        expect(same(batch(at, WAVELENGTHS), perCall(at, WAVELENGTHS)), `${lensId} (${fieldPointMm.x}, ${fieldPointMm.y})`).toBe(true);
      }
    }
  });

  it("computes each node kernel's centroid once per engine-owned profile (facade-08)", () => {
    const { state, half } = catalogueState("pv-50-1.2-pro", 2, 6), centroid = vi.mocked(profileModule.kernelCentroid);
    centroid.mockClear();
    const points = fieldPoints(state.profile as LensSampledPsfProfile, half);
    for (const fieldPointMm of points) resolveLensSampledPsfKernelsAt({ ...state, fieldPointMm }, WAVELENGTHS);
    const first = centroid.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual((state.profile as LensSampledPsfProfile).nodes.length);
    for (const fieldPointMm of points) resolveLensSampledPsfKernelsAt({ ...state, fieldPointMm }, WAVELENGTHS);
    expect(centroid.mock.calls.length).toBe(first);
  });

  it("gives the same kernels for a profile that is not engine-owned, a multilinear one and shifts beyond the padded copy", () => {
    const { state, half } = catalogueState("pv-50-1.2-pro", 1.4, 2, 300, 200), profile = state.profile as LensSampledPsfProfile;
    // Node kernels as single taps in opposite corners: centroids 2R samples apart, past the kept copy's padding.
    const shifted = structuredClone(profile) as unknown as { nodes: { coordinate: { fieldXmm: number }; kernel: { normalizedIntensity: number[] } }[] }, last = profile.axes.fieldXmm.length - 1;
    for (const node of shifted.nodes) {
      const n = node.kernel.normalizedIntensity.length, at = node.coordinate.fieldXmm === profile.axes.fieldXmm[last] ? 0 : n - 1;
      node.kernel.normalizedIntensity = Array.from({ length: n }, (_, i) => (i === at ? 1 : 0));
    }
    markEngineOwnedLensSampledPsfProfile(shifted);
    const multilinear = { ...structuredClone(profile), interpolation: "bounded-regular-grid-multilinear" };
    for (const variant of [structuredClone(profile), multilinear, shifted]) {
      for (const fieldPointMm of fieldPoints(profile, half).slice(0, 30)) {
        const at = { ...state, profile: variant, fieldPointMm } as State;
        expect(same(batch(at, WAVELENGTHS), perCall(at, WAVELENGTHS))).toBe(true);
      }
    }
  });

  it("throws the per-call error at the same wavelength", () => {
    const { state } = catalogueState("pv-16-2.8", 4, 3), at = { ...state, fieldPointMm: { x: 0.2, y: -0.1 } };
    for (const wavelengths of [[450, 500, 800], [450, Number.NaN], [450, -1], [379, 450], []]) {
      const want = wavelengths.length === 0 ? "no error" : errorOf(() => perCall(at, wavelengths));
      expect(errorOf(() => resolveLensSampledPsfKernelsAt(at, wavelengths)), String(wavelengths)).toBe(want);
    }
    expect(errorOf(() => resolveLensSampledPsfKernelsAt({ ...at, fieldPointMm: { x: 1e3, y: 0 } }, [450, 500]))).toBe(errorOf(() => perCall({ ...at, fieldPointMm: { x: 1e3, y: 0 } }, [450])));
  });
});

describe("the display view's field PSF with the batch resolver (#760)", () => {
  it("gives the same zone kernels and moments, at zones of one site and of many", () => {
    const { state } = catalogueState("pv-50-1.2-pro", 1.4, 6), W = 600, H = 400, R = radius(state);
    for (const zones of [W, 16]) {
      const plain = createDisplayViewLensPsf(state, R, W, H, 6, zones), batch = createDisplayViewLensPsf(state, R, W, H, 6, zones, resolveLensSampledPsfKernelsAt);
      for (const zone of [0, 7, 123, plain.zonesX * plain.zonesY - 1]) {
        clearDisplayViewLensZoneCache();
        const a = plain.zoneKernels(zone, WAVELENGTHS);
        clearDisplayViewLensZoneCache();
        const b = batch.zoneKernels(zone, WAVELENGTHS);
        a.perNode.forEach((k, n) => expect(same(k, b.perNode[n]!)).toBe(true));
        for (const key of ["sums", "momentX", "momentY", "momentXX", "momentYY", "momentXY"] as const) expect(same(a[key], b[key]), key).toBe(true);
        // The moments are those of the kernels, made when first read.
        const k = a.perNode[3]!;
        let s = 0, mxy = 0;
        for (let v = -R, t = 0; v <= R; v++) for (let u = -R; u <= R; u++, t++) { s += k[t]!; mxy += k[t]! * u * v; }
        expect(a.sums[3]).toBe(s);
        expect(a.momentXY[3]).toBe(mxy);
      }
    }
    clearDisplayViewLensZoneCache();
  });

  it("evicts least recently used first and keeps the byte bound", () => {
    clearDisplayViewLensZoneCache();
    const { state } = catalogueState("pv-16-2.8", 4, 3), W = 600, H = 400, nodes = Array.from({ length: 40 }, (_, i) => 380 + 10 * i);
    const R = radius(state), psf = createDisplayViewLensPsf(state, R, W, H, 3, W, resolveLensSampledPsfKernelsAt), bytesPerZone = nodes.length * ((2 * R + 1) ** 2 + 6) * 8;
    const capacity = Math.floor(DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES / bytesPerZone);
    psf.zoneKernels(0, nodes);
    for (let zone = 1; zone < capacity + 50; zone++) {
      psf.zoneKernels(zone, nodes);
      if (zone % 64 === 0) psf.zoneKernels(0, nodes); // zone 0 stays recent
    }
    const state0 = displayViewLensZoneCacheState();
    expect(state0.bytes).toBeLessThanOrEqual(DISPLAY_VIEW_LENS_ZONE_CACHE_BYTES);
    psf.zoneKernels(0, nodes);
    expect(displayViewLensZoneCacheState().hits).toBe(state0.hits + 1);
    psf.zoneKernels(1, nodes);
    expect(displayViewLensZoneCacheState().resolves).toBe(state0.resolves + 1);
    clearDisplayViewLensZoneCache();
  }, 120_000);
});
