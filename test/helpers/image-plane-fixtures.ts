// SPDX-License-Identifier: Apache-2.0
/** #581: image-plane fixtures shared by the emulation tests and the WebGPU suite. */
import type { ImagePlaneScene, SimulateCaptureOptions, SimulateDisplayViewOptions } from "../../src/index.js";
import { SMALL_FRAME, SMALL_VIEW } from "./display-view-gpu-fixture.js";
import { defocusGpuCase } from "./display-view-defocus-gpu-fixtures.js";

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
const region = { x: 70, y: 40, width: 48, height: 36 }, quality = { ...sensor, antiAliasing: { kind: "four-spot" as const } };
const view = { ...SMALL_VIEW, region };
const defocused = (name: string, fNumber: number, focus: number, quality: boolean, extra: Partial<ImagePlaneScene> = {}): [string, SimulateCaptureOptions, SimulateDisplayViewOptions] => {
  const c = defocusGpuCase(name, "6", fNumber, focus, quality, 0, { scene: photo(syntheticPhoto(300, 200), extra) });
  return [name, c.options, c.view];
};
/** #581: the Quality cases of the image-plane passes (48 × 36 regions; the defocused ones as the defocus fixtures frame them). */
export const IMAGE_PLANE_GPU_QUALITY_CASES: [string, SimulateCaptureOptions, SimulateDisplayViewOptions][] = [
  ["diffraction, four-spot filter and AHD, bilinear", { ...IMAGE_PLANE_GPU_CASES[0]![1], lens: { ...lens, diffraction: "circular-aperture" }, sensor: quality, output: { ...IMAGE_PLANE_GPU_CASES[0]![1].output, demosaic: "ahd" } }, view],
  ["AHD without diffraction (query points; one-tap groups)", { ...IMAGE_PLANE_GPU_CASES[0]![1], output: { ...IMAGE_PLANE_GPU_CASES[0]![1].output, demosaic: "ahd" } }, view],
  ["diffraction, linear RGBA, fitted in the frame", { scene: IMAGE_PLANE_GPU_CASES[4]![1].scene, sensor, output: IMAGE_PLANE_GPU_CASES[4]![1].output!, lens: { ...lens, diffraction: "circular-aperture" } }, view],
  defocused("defocus of the plane, 24 MP 6 µm f/2.8 focus 0.8×, Speed route (bilinear)", 2.8, 0.8, false),
  defocused("defocus with diffraction, four-spot filter and AHD, 24 MP 6 µm f/8 focus 0.8×, nearest pixel", 8, 0.8, true, { interpolation: "nearest" })
];

const DAY = { kind: "planckian" as const, temperatureKelvin: 6500 }, LAMP = { kind: "cie-a" as const };
/** #597: mixed lighting over the print: Speed requests (no site kernels) and diffraction (kernels), each against the CPU reference. */
const LIGHTS: [string, NonNullable<SimulateCaptureOptions["illumination"]>][] = [
  ["a daylight-to-lamp gradient", { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 3000 }], blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0.2 } } }],
  ["a radial blend of three sources with a hard edge", { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 3000 }, { illuminant: DAY, illuminanceLux: 500 }],
    blend: { kind: "radial", radius: 0.7, stops: [0, 0.5, 0.5] } }],
  ["regions and a point source 10 mm above the print", { sources: [{ illuminant: DAY, illuminanceLux: 8000 }, { illuminant: LAMP, illuminanceLux: 3000 }],
    blend: { kind: "regions", regions: [{ source: 1, uMin: -0.3, uMax: 0.4, vMin: -0.2, vMax: 0.3 }], outsideSource: 0 },
    points: [{ illuminant: LAMP, position: { xM: 0.005, yM: -0.003, heightM: 0.01 }, intensity: { illuminanceLux: 20000, distanceM: 0.01 } }] }]
];
export const IMAGE_PLANE_GPU_LIT_CASES: [string, SimulateCaptureOptions, SimulateDisplayViewOptions][] = LIGHTS.flatMap(([name, illumination]) => [
  [name + ", Speed request", { ...IMAGE_PLANE_GPU_CASES[0]![1], illumination }, view] as [string, SimulateCaptureOptions, SimulateDisplayViewOptions],
  [name + ", diffraction", { ...IMAGE_PLANE_GPU_CASES[0]![1], lens: { ...lens, diffraction: "circular-aperture" }, illumination }, view] as [string, SimulateCaptureOptions, SimulateDisplayViewOptions]]);
