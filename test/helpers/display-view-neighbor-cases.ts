// SPDX-License-Identifier: Apache-2.0
/**
 * #605: the display-view fixtures with `highlightMode: "reconstruct-neighbors"` for the GPU kernels (emulation and real devices):
 * colored patches over the white clip (clipped regions with a colored ring), Speed and Quality, fast and full.
 */
import type { SimulateCaptureOptions } from "../../src/index.js";
import { SMALL_FRAME } from "./display-view-gpu-fixture.js";

const patches = { preset: "patches" as const, columns: 4, patches: Array.from({ length: 8 }, (_, i) => ({ patchId: `p${i}`, reflectance: i % 2 === 0 ?
  { kind: "tabulated" as const, samples: [380, 480, 580, 680, 780].map((w, j) => ({ wavelengthNanometers: w, value: 0.1 + 0.08 * i + 0.1 * j })) } : 0.05 + 0.1 * i })) };
// 1/30 s: six clipped regions, none above the search cap (at 1/15 s the clipped area joins into regions above it).
const exposure = { mode: "manual" as const, iso: 100, shutterSeconds: 1 / 30 };
const speedSensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const qualitySensor = { ...speedSensor, antiAliasing: { kind: "four-spot" as const } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const, highlightMode: "reconstruct-neighbors" as const };
const speedLens = { prime: 50 as const, fNumber: 8 }, qualityLens = { ...speedLens, diffraction: "circular-aperture" as const };

/** [name, options, Quality kernels]. */
export const NEIGHBOR_GPU_CASES: [string, SimulateCaptureOptions, boolean][] = [
  ["Speed, patches over the white clip, fast (ring average)", { scene: patches, lens: speedLens, exposure, sensor: speedSensor, output }, false],
  ["Speed, patches over the white clip, full (harmonic fill)", { scene: patches, lens: speedLens, exposure, sensor: speedSensor, fast: false, output }, false],
  ["Quality, patches over the white clip, fast (ring average)", { scene: patches, lens: qualityLens, exposure, sensor: qualitySensor, output: { ...output, demosaic: "ahd" } }, true],
  ["Quality, patches over the white clip, full (harmonic fill)", { scene: patches, lens: qualityLens, exposure, sensor: qualitySensor, fast: false, output: { ...output, demosaic: "ahd" } }, true]
];
