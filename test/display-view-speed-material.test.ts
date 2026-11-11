// SPDX-License-Identifier: Apache-2.0
/**
 * #444: without diffraction (the Speed path) the expected signal reports the chart material every query point of a site read,
 * so the display view's one-material memo replays samples whose sites all read one material, as it already did with
 * diffraction. The output keeps its bytes: hash locks recorded on the build before the change (75dda59) for caller material
 * scenes with one-material patches, mixed edges and mirror borders, a chart preset with AHD at a high ISO, the stratified
 * estimator, and a radiance scene (which is not tracked).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SimulateCaptureOptions, SimulateDisplayViewOptions } from "../src/index.js";
import { createDisplayViewExpectedSignal, type DisplayViewExpectedSignalInput } from "../src/facade/expected-signal.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

describe("expected signal without diffraction: material tracking (#444)", () => {
  // A 24 × 18 raster of a two-material checker chart (one neutral, one spectral) with cells 3.5 sites wide, read through a
  // 2 × 2 box (four query points per site), so sites inside a cell read one material and sites on a cell edge read two.
  const W = 24, H = 18, nodes = [500, 600];
  const box = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]] as const;
  const materialAt = (u: number, v: number): number => ((Math.floor((u + 1) * 12 / 3.5) + Math.floor((9 - 12 * v) / 3.5)) & 1);
  const queryPoint = (x: number, y: number, o: number, out: Float64Array): void => {
    out[0] = (x + 0.5 + box[o]![0] - W / 2) * 2 / W; out[1] = -(y + 0.5 + box[o]![1] - H / 2) * 2 / W;
  };
  const input: DisplayViewExpectedSignalInput = {
    nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: nodes,
    electronsPerRadiance: [Float64Array.of(1, 2), Float64Array.of(3, 1), Float64Array.of(0.5, 4)],
    offsets: box.map(([x, y]) => ({ x, y, weight: 0.25 })),
    scene: { kind: "materials", materialAt, materials: [{ neutral: 0.4 }, { radiance: Float64Array.of(0.2, 0.7) }], whiteRadiance: Float64Array.of(1, 1.2) },
    channelAt: (x, y) => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2)),
    queryPoint
  };
  /** The material all four query points of site (x, y) read, or −1 when they read two. */
  const expectedMaterial = (x: number, y: number): number => {
    const point = new Float64Array(2), seen = new Set<number>();
    for (let o = 0; o < 4; o++) { queryPoint(x, y, o, point); seen.add(materialAt(point[0]!, point[1]!)); }
    return seen.size === 1 ? [...seen][0]! : -1;
  };
  // Overlapping windows, so later windows read sites from the ring and every window reads some sites twice (its site cache).
  const windows: [number, number, number, number][] = [[0, 0, 8, 6], [4, 2, 12, 8], [10, 6, 18, 12], [16, 12, 24, 18], [0, 10, 9, 18]];

  it("reports each site's material (or −1 for mixed sites) on a miss, a ring hit and a site-cache hit", () => {
    const signal = createDisplayViewExpectedSignal(input), fresh = (x: number, y: number): number => { const s = createDisplayViewExpectedSignal(input); s.window(x, y, x + 1, y + 1); return s.site(x, y); };
    const byMaterial = new Map<string, number>();
    let uniform = 0, mixed = 0;
    for (const [x0, y0, x1, y1] of windows) {
      signal.window(x0, y0, x1, y1);
      expect(signal.tracksMaterial).toBe(true);
      for (let pass = 0; pass < 2; pass++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = signal.site(x, y), m = signal.uniformMaterial;
        expect(m).toBe(expectedMaterial(x, y));
        expect(v).toBe(fresh(x, y));
        if (m < 0) { mixed++; continue; }
        uniform++;
        // A one-material site's value depends only on its material and channel, as the memo requires.
        const key = `${m}:${input.channelAt(x, y)}`, seen = byMaterial.get(key);
        if (seen === undefined) byMaterial.set(key, v); else expect(v).toBe(seen);
      }
      // A site outside the window, read twice (no site-cache entry: the ring, then a ring hit).
      for (let pass = 0; pass < 2; pass++) { const x = (x1 + 2) % W, y = y0; signal.site(x, y); expect(signal.uniformMaterial).toBe(expectedMaterial(x, y)); }
    }
    expect(uniform).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(0);
    expect(byMaterial.size).toBe(6);
  });

  it("is not tracked for a radiance scene or a window without a site cache", () => {
    const radiance = createDisplayViewExpectedSignal({ ...input, scene: { kind: "radiance", radianceAt: (u, v, nm) => 0.01 * (1.5 + Math.sin(9 * u + nm / 100) * Math.cos(7 * v)) } });
    radiance.window(0, 0, 8, 6);
    expect(radiance.tracksMaterial).toBe(false);
    radiance.site(3, 3);
    expect(radiance.uniformMaterial).toBe(-1);
    const empty = createDisplayViewExpectedSignal(input);
    empty.window(4, 4, 4, 4);
    expect(empty.tracksMaterial).toBe(false);
  });
});

describe("display view without diffraction keeps its bytes (#444)", () => {
  // A caller material scene: checker patches of three materials (large one-material areas, mixed edges).
  const checker = { kind: "material-function" as const, sceneId: "speed-material-lock", materials: [0.18, 0.7, 0.05],
    materialAt: (p: { u: number; v: number }): number => ((Math.floor(p.u * 3) + Math.floor(p.v * 2)) % 3 + 3) % 3 };
  const speed = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
  // SHA-256 of the samples, the expected values, the noise standard deviations and the diagnostics without timings and the
  // additive `fast` block (sceneLookups and siteEvaluations included), recorded on 75dda59, before the change. The AHD case was
  // re-recorded for #457 (AHD's choice on the noise-free mosaic, which reads 5 sites around each real pixel: sceneLookups
  // 26400 → 28252): 60 of its 360 expected components, at the patch edge, moved by up to 40 8-bit codes, toward the capture
  // (7.56 → 3.88 codes RMS, 55.1 → 17.7 at most, against 16 reference captures). The four chart cases were re-recorded for 2.21.0
  // (signals integrated from the material spectrum per site; the same on x64 and arm64): samples unchanged, expected values within
  // 1.5·10⁻¹⁴ relative; in the AHD case 30 of the 360 expected components at the patch edge move by at most 0.025 8-bit codes, where
  // the two AHD candidates' channel means, equal to the last bit before, now differ by rounding and AHD's choice is taken
  // (sceneLookups 28252 → 29148). The AHD case was re-recorded for 2.22.0 (the AHD low-signal correction removed; the same on x64
  // and arm64): all 120 display pixels had it; red rises by 2.47 8-bit codes and green and blue fall by 0.36 and 0.59 on average
  // (6.10 at most), 240 of 360 samples change, and view.demosaic reports the approximation.
  const cases: [string, SimulateCaptureOptions, SimulateDisplayViewOptions, string][] = [
    ["caller material scene, mirror borders, exact area mean", { scene: checker, sensor: speed, output: { width: 240, height: 160, borderHandling: "mirror" } },
      { width: 80, height: 54 }, "88614416ef0fcbbff7d695eeaeec793b0951c64eeda0695c77cb7122f5b3a900"],
    ["caller material scene, part at a corner, 16-bit", { scene: checker, sensor: speed, output: { width: 240, height: 160, borderHandling: "mirror" } },
      { width: 80, height: 54, region: { x: 60, y: 40, width: 20, height: 14 }, format: "srgb-16" }, "8f03a919449620648cfb27dbfc2994dd961b9d0cd323c4b86865ae4832869ae4"],
    ["caller material scene, stratified estimator", { scene: checker, sensor: speed, output: { width: 240, height: 160 } }, { width: 24, height: 16 }, "6ead9437c338654c9b4fa0df6ba8f07f965d53665e346aa1032cec7bf624aaad"],
    ["chart preset, AHD at ISO 3200, 1.4 µm", { scene: { preset: "patches", patches: [{ patchId: "a", reflectance: 0.18 }, { patchId: "b", reflectance: 0.6 }], columns: 2 }, exposure: { mode: "manual", iso: 3200, shutterSeconds: 1 / 4000 },
      sensor: { pixelPitchMicrometers: 1.4, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: 120, height: 90, demosaic: "ahd" } },
      { width: 40, height: 30, region: { x: 14, y: 10, width: 12, height: 10 } }, "81b81365e7a96f62b3e08e989d8a8060aef4c3d9f32a15f949f4c334b2690ce7"],
    // 2.22.0 (#599): re-recorded for the sensor.isoAreaNormalization explanation's new text only (samples, expected values and noise unchanged at 1.4 µm).
    ["radiance scene (not tracked)", { scene: { kind: "radiance-function", sceneId: "speed-radiance-lock", evaluate: (p: { u: number; v: number }) => 0.02 * (1.25 + 0.5 * Math.floor(4 * p.u) / 4 - 0.25 * Math.floor(3 * p.v) / 3) },
      sensor: speed, output: { width: 120, height: 80 } }, { width: 40, height: 27 }, "724e9bcb5028c54d6d6c29ea085a9a6c790edc92711dead5085132b8cb47321f"]
  ];
  it.each(cases)("%s", async (name, options, view, expected) => {
    const { result, internals } = await simulateDisplayViewWithInternals(options, view);
    const method = (result.assumptions.find((a) => a.id === "view.estimation")?.value as { method?: string } | undefined)?.method;
    expect(method === "exact-area-mean-over-real-pixels").toBe(!name.includes("stratified"));
    const diagnostics: Partial<typeof result.diagnostics> = { ...result.diagnostics }, hash = createHash("sha256");
    delete diagnostics.timingsMs; delete diagnostics.fast;
    // #533: diagnostics.highlight is additive (it changes no sample); it is checked on its own and left out of the digests.
    expect(diagnostics.highlight).toEqual({ saturatedPixelCount: internals.saturatedPixelCount, statistic: "expected-value" });
    delete diagnostics.highlight;
    for (const a of [result.image.samples, internals.expected, internals.noiseStd]) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    hash.update(JSON.stringify(diagnostics));
    hash.update(JSON.stringify(result.assumptions));
    expect(hash.digest("hex")).toBe(expected);
  }, testTimeout(60_000));
});
