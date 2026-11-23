// SPDX-License-Identifier: Apache-2.0
/**
 * #767: the requests of test/display-view-motion-diffraction-lattice-1 to -3.test.ts (split from one file
 * for the per-file coverage budget; the cases and bounds are unchanged).
 */
import type { SimulateCaptureOptions } from "../../src/index.js";

export const filter = { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } } as const;
export type Request = { fNumber?: number; pitch?: number; shutterSeconds?: number; motion?: SimulateCaptureOptions["motion"]; lens?: object; sensor?: object; output?: object; scene?: string;
  width?: number; height?: number; fast?: boolean };
export const request = (o: Request): SimulateCaptureOptions => ({
  scene: { preset: o.scene ?? "slanted-edge" }, subjectDistanceM: 2, lens: { prime: 50, fNumber: o.fNumber ?? 8, diffraction: "circular-aperture", ...o.lens },
  sensor: { pixelPitchMicrometers: o.pitch ?? 6, ...filter, ...o.sensor }, exposure: { mode: "manual", iso: 100, shutterSeconds: o.shutterSeconds ?? 1 / 15 },
  output: { width: o.width ?? 20, height: o.height ?? 14, ...o.output }, ...(o.motion ? { motion: o.motion } : {}), ...(o.fast === false ? { fast: false } : {}) } as SimulateCaptureOptions);
export const yaw = { angularVelocityRadPerSec: { yaw: 0.02 } }, subject = { subject: { velocityMPerSec: { x: 0.5 } } }, handheld = { handheld: { seed: 7 } };
export const defocus = { focusDistanceM: 1.8, defocus: { model: "geometric-disc" } };
type Assumed = { assumptions: readonly { id: string; value: unknown }[] };
export const execution = (r: Assumed): string => (r.assumptions.find((a) => a.id === "lens.diffraction")!.value as { execution: string }).execution;
