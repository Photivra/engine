// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { nativeEnvironmentLeanStatistics, setNativeEnvironmentLeanExecutionEnabled } from "../src/capture/native-environment-lean.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { setTabulatedNativeRawEnabled } from "../src/capture/native-environment-tabulated.js";

/*
 * #394: for engine chart scenes the lean executor reads each tap's radiance by the key the engine-built evaluator would read
 * (a chart material, or a lattice site of the object-space diffraction) instead of calling it, and plans engine-built tiles
 * without a private copy. Both must be invisible: the same samples, RAW, diagnostics counts and assumptions as the full path.
 */
afterEach(() => setNativeEnvironmentLeanExecutionEnabled(true));

const sha = (bytes: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");

async function summary(options: SimulateCaptureOptions, lean: boolean): Promise<Record<string, unknown>> {
  setNativeEnvironmentLeanExecutionEnabled(lean);
  const result = await simulateCapture(options);
  const counts: Record<string, unknown> = { ...result.diagnostics };
  delete counts.timingsMs;
  return { samples: sha(result.image.samples), counts, assumptions: JSON.stringify(result.assumptions) };
}

/** Runs the full and the lean path; asserts identity and returns how many sites took key taps. */
async function same(options: SimulateCaptureOptions): Promise<number> {
  const full = await summary(options, false);
  const before = nativeEnvironmentLeanStatistics.keySites;
  const lean = await summary(options, true);
  expect(lean).toEqual(full);
  return nativeEnvironmentLeanStatistics.keySites - before;
}

const small = { width: 40, height: 28 };
describe("lean key taps for engine chart scenes (#394)", () => {
  // The environment path itself is under test (#394: chart captures otherwise take the tabulated RAW path).
  beforeAll(() => setTabulatedNativeRawEnabled(false));
  afterAll(() => setTabulatedNativeRawEnabled(true));
  it("gives the full path's bytes for chart presets in Speed and Quality, and uses key taps", async () => {
    for (const options of [
      { scene: { preset: "siemens-star" }, output: small },
      { scene: { preset: "dead-leaves" }, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: small },
      { scene: { preset: "zone-plate" }, lens: { fNumber: 11, diffraction: "circular-aperture" }, sensor: { antiAliasing: { kind: "four-spot" } }, output: { ...small, demosaic: "ahd" } },
      { scene: { preset: "slanted-edge" }, chartSize: { widthM: 0.3 }, subjectDistanceM: 2, output: small }
    ] as SimulateCaptureOptions[]) expect(await same(options)).toBeGreaterThan(0);
  }, scaledTimeout(240_000));

  it("covers rotation, temporal samples, rolling shutter, vignetting and regions", async () => {
    for (const options of [
      { scene: { preset: "siemens-star" }, motion: { angularVelocityRadPerSec: { yaw: 0.05, pitch: 0.02 }, shutter: "rolling" }, sensor: { temporalSampleCount: 2 }, output: small },
      { scene: { preset: "dead-leaves" }, lens: { vignetting: { normalizationRadiusMm: 0.2, maximumNormalizedRadius: 1, coefficients: { r2: -0.8, r4: 0, r6: 0 } } }, output: small },
      { scene: { preset: "siemens-star" }, lens: { diffraction: "circular-aperture" }, output: { width: 64, height: 48, region: { x: 20, y: 12, width: 16, height: 12 } } }
    ] as SimulateCaptureOptions[]) expect(await same(options)).toBeGreaterThan(0);
  }, scaledTimeout(240_000));

  it("covers caller material scenes, whose materialAt still validates its indices", async () => {
    const scene = { kind: "material-function", sceneId: "test-key-taps-materials", materials: [0.2, 0.6, 0.85],
      materialAt: ({ u, v }: { u: number; v: number }): number => (u * u + v * v < 0.2 ? 2 : u > 0 ? 1 : 0) };
    expect(await same({ scene, sensor: { pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: small } as SimulateCaptureOptions)).toBeGreaterThan(0);
    expect(await same({ scene, chartSize: { widthM: 0.3 }, subjectDistanceM: 2, lens: { diffraction: "circular-aperture" }, output: small } as SimulateCaptureOptions)).toBeGreaterThan(0);
    const bad = { ...scene, materialAt: ({ u }: { u: number }): number => (u > 0.5 ? 7 : 0) };
    for (const lean of [false, true]) {
      setNativeEnvironmentLeanExecutionEnabled(lean);
      await expect(simulateCapture({ scene: bad, output: small } as SimulateCaptureOptions)).rejects.toThrow("Scene materialAt must return an index into its materials.");
    }
  }, scaledTimeout(240_000));

  it("keeps caller function scenes on request taps; #633: lens field mappings take key taps, with the same bytes", async () => {
    expect(await same({ scene: { preset: "siemens-star" }, lens: { projection: "fisheye-equidistant" }, output: small })).toBeGreaterThan(0);
    expect(await same({ scene: { preset: "dead-leaves" }, lens: { distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.1, maximumNormalizedRadius: 2,
      coefficients: { k1: -0.05, k2: 0, k3: 0 } } } }, output: small } as SimulateCaptureOptions)).toBeGreaterThan(0);
    expect(await same({ scene: { kind: "reflectance-function", sceneId: "test-key-taps", evaluate: ({ u }) => (u > 0 ? 0.6 : 0.2) }, output: small })).toBe(0);
  }, scaledTimeout(240_000));
});
