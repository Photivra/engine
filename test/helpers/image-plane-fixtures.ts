// SPDX-License-Identifier: Apache-2.0
/** #581: image-plane fixtures shared by the emulation tests and the WebGPU suite. */
import type { ImagePlaneScene, SimulateCaptureOptions } from "../../src/index.js";
import { SMALL_FRAME } from "./display-view-gpu-fixture.js";

/** A deterministic synthetic photo: a sky-to-ground gradient, saturated discs with hard edges, a seeded fine texture and a black/white bar block. */
export function syntheticPhoto(width: number, height: number, encoding: "srgb-8" | "linear-srgb" = "srgb-8", channels: 3 | 4 = 3): ImagePlaneScene["image"] {
  let seed = 581;
  const random = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 2 ** 32; };
  const pixel = (x: number, y: number): [number, number, number, number] => {
    const t = y / (height - 1);
    let r = 0.35 + 0.4 * t, g = 0.55 + 0.2 * t, b = 0.9 - 0.6 * t;
    const discs: [number, number, number, [number, number, number]][] = [[0.25, 0.3, 0.12, [0.9, 0.1, 0.08]], [0.6, 0.55, 0.15, [0.1, 0.75, 0.2]], [0.8, 0.25, 0.1, [0.15, 0.2, 0.85]]];
    for (const [cx, cy, radius, color] of discs) if (Math.hypot(x / width - cx, y / height - cy) < radius) [r, g, b] = color;
    if (x > width * 0.1 && x < width * 0.4 && y > height * 0.7) { const bar = Math.floor(x / 3) % 2 === 0; r = g = b = bar ? 0.98 : 0.02; }
    const n = 0.06 * (random() - 0.5);
    return [Math.min(1, Math.max(0, r + n)), Math.min(1, Math.max(0, g + n)), Math.min(1, Math.max(0, b - n)), x < width * 0.05 ? 0.5 : 1];
  };
  const count = width * height * channels, data = encoding === "srgb-8" ? new Uint8Array(count) : new Float32Array(count);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = pixel(x, y);
    for (let c = 0; c < channels; c++) data[(y * width + x) * channels + c] = encoding === "srgb-8" ? Math.round(p[c]! * 255) : (c < 3 ? p[c]! ** 2.2 : p[c]!);
  }
  return { width, height, channels, encoding, data } as ImagePlaneScene["image"];
}

const sensor = { pixelPitchMicrometers: 6, pixelAperture: { kind: "box" as const, samplesPerAxis: 2 } };
const output = { ...SMALL_FRAME, format: "srgb-8" as const };
const lens = { prime: 50 as const, fNumber: 8 };
export const photo = (image = syntheticPhoto(160, 120), extra: Partial<ImagePlaneScene> = {}): ImagePlaneScene => ({ kind: "image-plane", sceneId: "photo", image, ...extra });
/** The app's print shape at the small frame: a 42 mm print at 0.63 m (the frame covers about 45 mm). */
const placed = { chartSize: { widthM: 0.042 }, subjectDistanceM: 0.63 };
/** The GPU cases of the image-plane module (the emulation and the device run the same). */
export const IMAGE_PLANE_GPU_CASES: [string, SimulateCaptureOptions][] = [
  ["a 160 × 120 sRGB photo as a 42 mm print at 0.63 m, bilinear", { scene: photo(), lens, sensor, output, ...placed }],
  ["the same photo fitted inside the frame (default placement)", { scene: photo(), lens, sensor, output }],
  ["the same photo, nearest pixel", { scene: photo(undefined, { interpolation: "nearest" }), lens, sensor, output, ...placed }],
  ["a 600 × 400 photo (above the view's resolution), bilinear", { scene: photo(syntheticPhoto(600, 400)), lens, sensor, output, ...placed }],
  ["linear RGBA input with half-transparent pixels, custom paper", { scene: photo(syntheticPhoto(160, 120, "linear-srgb", 4), { paper: { whiteReflectance: 0.85, blackReflectance: 0.02 } }), lens, sensor, output, ...placed }],
  ["Reinhard at the white clip", { scene: photo(), lens, sensor, output: { ...output, toneCurve: "positive-reinhard-per-channel" }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, ...placed }]
];
export const IMAGE_PLANE_GPU_LENS = lens;
