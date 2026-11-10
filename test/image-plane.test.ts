// SPDX-License-Identifier: Apache-2.0
/**
 * The image-plane scene (2.21, #581): the print reflectance lattice (its data, bounds and neutral axis), input validation and
 * decoding, the paper and alpha, placement, the capture, ideal reference and display view through it, the digest, and the
 * lazy loading of its module.
 *
 * Independent expectations: the sRGB EOTF and the CSS Color 4 matrix are written out here; the lattice's round trip under CIE
 * D65 is checked by scripts/fit-image-plane-lattice.mjs (the CIE tables are not in the repository), so here the round trip is
 * measured under the engine's own colorimetry (its analytic CIE 1931 fit and a 6504 K Planckian light), with the bound
 * recorded in docs/IMAGE_PLANE.md.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { InvalidConfigurationError, prepareImagePlaneScenes, calculateCielabFromXyz, calculateColorDifference, simulateCapture, simulateDisplayView, simulateIdealReference,
  type ImagePlaneScene, type SimulateCaptureOptions } from "../src/index.js";
import { imagePlaneLatticeSpectra, resolveImagePlaneScene } from "../src/facade/image-plane.js";

const LINEAR_SRGB_TO_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const SRGB_WHITE = { x: 0.3127 / 0.329, y: 1, z: (1 - 0.3127 - 0.329) / 0.329 };
const decode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const labOfLinear = (rgb: readonly number[], whiteY = 1): { lStar: number; aStar: number; bStar: number } => {
  const xyz = LINEAR_SRGB_TO_XYZ.map((row) => row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!);
  return calculateCielabFromXyz({ xyz: { x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, referenceWhiteXyz: { x: SRGB_WHITE.x * whiteY, y: whiteY, z: SRGB_WHITE.z * whiteY } }).value;
};
const de00 = (a: { lStar: number; aStar: number; bStar: number }, b: { lStar: number; aStar: number; bStar: number }): number =>
  calculateColorDifference({ formula: "ciede2000", reference: a, sample: b }).value.deltaE;

/** An image of uniform blocks: `colors` (8-bit sRGB) laid out `columns` per row, each `block` × `block` pixels. */
function blocks(colors: readonly (readonly number[])[], columns: number, block: number): ImagePlaneScene["image"] {
  const rows = Math.ceil(colors.length / columns), width = columns * block, height = rows * block, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[Math.floor(y / block) * columns + Math.floor(x / block)] ?? [128, 128, 128];
    for (let c = 0; c < 3; c++) data[(y * width + x) * 3 + c] = color[c]!;
  }
  return { width, height, channels: 3, encoding: "srgb-8", data };
}
const COLORS = [[255, 255, 255], [128, 128, 128], [20, 20, 20], [200, 40, 30], [40, 160, 60], [40, 70, 190], [230, 200, 40], [180, 60, 150], [60, 170, 180],
  [233, 195, 170], [120, 80, 50], [250, 120, 20]] as const;

describe("before prepareImagePlaneScenes()", () => {
  it("a request with an image-plane scene fails, saying what to call", async () => {
    const data = new Uint8Array(3).fill(128);
    await expect(simulateIdealReference({ scene: { kind: "image-plane", sceneId: "p", image: { width: 1, height: 1, channels: 3, encoding: "srgb-8", data } }, output: { width: 4, height: 4 } }))
      .rejects.toThrow(/prepareImagePlaneScenes/u);
  });
});

describe("print reflectance lattice", () => {
  beforeAll(async () => { await prepareImagePlaneScenes(); await prepareImagePlaneScenes(); });
  it("holds 125 spectra in [0, 1] at 41 wavelengths, flat on the neutral axis", () => {
    const { levels, wavelengthsNm, spectra } = imagePlaneLatticeSpectra();
    expect(wavelengthsNm).toHaveLength(41);
    expect(wavelengthsNm[0]).toBe(380);
    expect(wavelengthsNm[40]).toBe(780);
    expect(spectra).toHaveLength(125);
    expect(levels[0]).toBe(0);
    expect(levels[4]).toBe(1);
    for (let k = 1; k < 4; k++) expect(levels[k]).toBeCloseTo(decode(k / 4), 14);
    for (const [index, s] of spectra.entries()) {
      for (const v of s) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      const r = Math.floor(index / 25), g = Math.floor(index / 5) % 5, b = index % 5;
      if (r === g && g === b) for (const v of s) expect(v).toBe(levels[r]);
    }
  });
});

describe("image-plane scene", () => {
  const base = (scene: Partial<ImagePlaneScene> = {}): ImagePlaneScene => ({ kind: "image-plane", sceneId: "photo", image: blocks(COLORS, 4, 2), ...scene });

  it("validates its input", async () => {
    const bad = async (scene: unknown): Promise<void> => { await expect(simulateIdealReference({ scene: scene as ImagePlaneScene, output: { width: 8, height: 6 } })).rejects.toThrow(InvalidConfigurationError); };
    await bad({ ...base(), sceneId: "" });
    await bad({ ...base(), image: { ...base().image, data: new Uint8Array(3) } });
    await bad({ ...base(), image: { ...base().image, encoding: "srgb-16" } });
    await bad({ ...base(), image: { ...base().image, channels: 2 } });
    await bad({ ...base(), image: { ...base().image, width: 0 } });
    await bad({ ...base(), paper: { whiteReflectance: 0.5, blackReflectance: 0.5 } });
    await bad({ ...base(), interpolation: "cubic" });
    await bad({ ...base(), maximumPixels: 10 });
    await bad({ ...base(), extra: 1 });
    await bad({ kind: "image-plane", sceneId: "x", image: { width: 1, height: 1, channels: 3, encoding: "linear-srgb", data: Float32Array.of(0, Number.NaN, 0) } });
  });

  it("decodes, applies the paper and composites alpha over it", async () => {
    const data = Uint8Array.of(255, 255, 255, 255, 0, 0, 0, 255, 10, 200, 30, 0);
    const scene = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image: { width: 3, height: 1, channels: 4, encoding: "srgb-8", data } }, 1 / 3);
    const ones = new Float64Array(125).fill(1);
    for (const nm of [400, 555, 700]) {
      // Pixel centers: X = (cu + 1)·W/2 = 0.5, 1.5, 2.5.
      expect(scene.reflectanceAt(-2 / 3, 0, nm)).toBeCloseTo(0.9, 12);
      expect(scene.reflectanceAt(0, 0, nm)).toBeCloseTo(0.01, 12);
      // Alpha 0: the paper itself.
      expect(scene.reflectanceAt(2 / 3, 0, nm)).toBeCloseTo(0.9, 12);
    }
    expect(scene.pixelValue(0, ones, 2)).toBeCloseTo(0.01 * 2 + 0.89, 12);
    const custom = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image: { width: 3, height: 1, channels: 4, encoding: "srgb-8", data }, paper: { whiteReflectance: 1, blackReflectance: 0 } }, 1 / 3);
    expect(custom.reflectanceAt(0, 0, 500)).toBe(0);
    expect(custom.reflectanceAt(-2 / 3, 0, 500)).toBe(1);
  });

  it("integrates each pixel's signals from its reconstructed spectrum at the time of use, with no per-channel values of the lattice nodes", async () => {
    const width = 40, height = 30, data = new Uint8Array(width * height * 3);
    for (let i = 0; i < data.length; i++) data[i] = (i * 97 + Math.floor(i / 7) * 31) % 256;
    const scene = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image: { width, height, channels: 3, encoding: "srgb-8", data } }, height / width);
    const wavelengths = [420, 480, 530, 590, 650], white = Float64Array.of(0.8, 1.1, 1.0, 0.95, 0.7);
    const A = [Float64Array.of(0, 0.02, 0.1, 0.9, 0.6), Float64Array.of(0.05, 0.4, 1, 0.3, 0.02), Float64Array.of(0.9, 0.6, 0.1, 0.01, 0)];
    const radianceAt = (u: number, v: number, nm: number): number => scene.reflectanceAt(u, v, nm) * white[wavelengths.indexOf(nm)]!;
    const signal = scene.signalScene(wavelengths, A, white, radianceAt, 1, 1, 0.18);
    // What the GPU module and the direct path read: the lattice's spectra at the nodes, the white and the responses, apart.
    expect(signal.image.nodes.nodeSpectra.length).toBe(125 * wavelengths.length);
    expect(signal.image.nodes.response).toBe(A);
    expect(Object.keys(signal.image).sort()).toEqual(["nodes", "scene", "surround", "surroundReflectance", "whiteRadiance"]);
    const out = new Float64Array(3);
    for (const index of [0, 17, 433, width * height - 1]) {
      scene.pixelSignals(index, signal.image.nodes, out, 0);
      for (let c = 0; c < 3; c++) {
        // The pixel's spectrum at each node (pixelValue on that node's reflectances), times the white, against the channel's response.
        let expected = 0;
        for (let n = 0; n < wavelengths.length; n++) expected += A[c]![n]! * (scene.pixelValue(index, scene.nodeReflectances(wavelengths[n]!), 1) * white[n]!);
        expect(Math.abs(out[c]! - expected)).toBeLessThanOrEqual(1e-14 * expected);
      }
    }
    // Between pixel centers: the same as integrating the interpolated radiance, to rounding; outside the print the surround.
    for (const [u, v] of [[-0.93, 0.6], [0.013, -0.2], [0.51, 0.71], [0.99, -0.74]] as const) for (let c = 0; c < 3; c++) {
      let integrated = 0;
      for (let n = 0; n < wavelengths.length; n++) integrated += A[c]![n]! * radianceAt(u, v, wavelengths[n]!);
      expect(Math.abs(signal.signalAt(u, v, c) - integrated)).toBeLessThanOrEqual(1e-13 * integrated);
      expect(signal.signalAt(u, v, c)).toBe(signal.signalAt(u, v, c));
    }
    // The surround's signal is integrated from its spectrum 0.18·W_n too (no white-integral shortcut, 2.21.0).
    let surround = 0;
    for (let n = 0; n < wavelengths.length; n++) surround += A[1]![n]! * (0.18 * white[n]!);
    expect(signal.signalAt(1.2, 0, 1)).toBe(surround);
    expect(signal.image.surround[1]).toBe(surround);
  });

  it("clips and counts linear samples outside [0, 1]", async () => {
    const data = Float32Array.of(1.5, 0.5, -0.25, 0.2, 0.2, 0.2);
    const scene = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image: { width: 2, height: 1, channels: 3, encoding: "linear-srgb", data } }, 0.5);
    expect(scene.clippedSampleCount).toBe(2);
    const result = await simulateIdealReference({ scene: { kind: "image-plane", sceneId: "p", image: { width: 2, height: 1, channels: 3, encoding: "linear-srgb", data } }, output: { width: 8, height: 4 } });
    expect(result.scene.parameters.clippedSampleCount).toBe(2);
    expect(result.assumptions.find((a) => a.id === "scene.image.clippedSamples")?.value).toBe(2);
  });

  it("interpolates bilinearly between pixel centers, or takes the nearest pixel", async () => {
    const data = Uint8Array.of(255, 255, 255, 0, 0, 0);
    const image = { width: 2, height: 1, channels: 3 as const, encoding: "srgb-8" as const, data }, paper = { whiteReflectance: 1, blackReflectance: 0 };
    const bilinear = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image, paper }, 0.5);
    const nearest = await resolveImagePlaneScene({ kind: "image-plane", sceneId: "p", image, paper, interpolation: "nearest" }, 0.5);
    // X = (cu + 1)·1: cu = 0 is X = 1, halfway between the pixel centers 0.5 and 1.5; edge pixels extend to the edges.
    expect(bilinear.reflectanceAt(0, 0, 550)).toBeCloseTo(0.5, 14);
    expect(bilinear.reflectanceAt(-0.75, 0, 550)).toBe(1);
    expect(bilinear.reflectanceAt(0.25, 0, 550)).toBeCloseTo(0.25, 14);
    expect(nearest.reflectanceAt(-0.01, 0, 550)).toBe(1);
    expect(nearest.reflectanceAt(0.01, 0, 550)).toBe(0);
  });

  it("round-trips sRGB through the ideal reference under the engine's colorimetry", async () => {
    const block = 6, image = blocks(COLORS, 4, block);
    const result = await simulateIdealReference({ scene: { kind: "image-plane", sceneId: "photo", image, paper: { whiteReflectance: 1, blackReflectance: 0 } },
      illuminant: { kind: "planckian", temperatureKelvin: 6504 }, sensor: { spectralStepNanometers: 5 }, output: { width: image.width, height: image.height, format: "srgb-16" } });
    expect(result.assumptions.find((a) => a.id === "chartSize")).toBeDefined();
    const samples = result.image.samples as Uint16Array, worst = { deltaE: 0 };
    const white = [0, 1, 2].map((c) => decode(samples[(2 * image.width + 2) * 3 + c]! / 65535));
    for (const [index, color] of COLORS.entries()) {
      const x = (index % 4) * block + block / 2, y = Math.floor(index / 4) * block + block / 2;
      const rendered = [0, 1, 2].map((c) => decode(samples[(y * image.width + x) * 3 + c]! / 65535) / white[c]!);
      const deltaE = de00(labOfLinear(color.map((v) => decode(v / 255))), labOfLinear(rendered));
      worst.deltaE = Math.max(worst.deltaE, deltaE);
    }
    console.log("[image-plane] round trip, Planck 6504 K, analytic CIE 1931 fit, 5 nm: max ΔE00 " + worst.deltaE.toFixed(3));
    expect(worst.deltaE).toBeLessThan(1.5); // measured 1.18: a 6504 K Planckian is not D65 (the lattice is exact under D65), and the engine's CMFs are its analytic fit
  });

  it("captures through the tabulated path and the display view, with a digest of the image", async () => {
    const options: SimulateCaptureOptions = { scene: base(), chartSize: { widthM: 0.5 }, output: { width: 24, height: 16 } };
    const capture = await simulateCapture(options);
    expect(capture.scene.preset).toBe("image-plane");
    expect(capture.scene.parameters.width).toBe(8);
    expect(capture.assumptions.find((a) => a.id === "raw.expectedSignal")).toBeDefined();
    const changed = base(); (changed.image.data as Uint8Array)[0] = 1;
    const other = await simulateCapture({ ...options, scene: changed });
    expect(other.scene.sourceSha256).not.toBe(capture.scene.sourceSha256);
    const view = await simulateDisplayView(options, { width: 12, height: 8 });
    expect(view.scene.preset).toBe("image-plane");
    expect(view.image.samples.length).toBe(12 * 8 * 3);
  });

  it("renders through the camera effects: the display view matches the box-downsized capture with diffraction, defocus of the plane, distortion and vignetting", async () => {
    const decode16 = (code: number): number => decode(code / 65535);
    const encode8 = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.min(1, l) ** (1 / 2.4) - 0.055);
    const image = blocks(COLORS, 4, 4);
    for (const lensOptions of [{ diffraction: "circular-aperture" as const }, { focusDistanceM: 1.6, defocus: { model: "geometric-disc" as const },
      distortion: { kind: "radial" as const, profile: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { k1: -0.15, k2: 0, k3: 0 } } },
      vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.5, r4: 0, r6: 0 } } }]) {
      const options: SimulateCaptureOptions = { scene: { kind: "image-plane", sceneId: "photo", image }, subjectDistanceM: 2, lens: { focalLengthMm: 50, fNumber: 4, ...lensOptions },
        sensor: { pixelPitchMicrometers: 3 }, output: { width: 96, height: 64 } };
      const capture = await simulateCapture({ ...options, output: { ...options.output, format: "srgb-16" } });
      const view = await simulateDisplayView(options, { width: 12, height: 8, samplesPerAxis: 16 });
      expect(view.image.samples.length).toBe(12 * 8 * 3);
      let sq = 0, max = 0;
      const samples = capture.image.samples as Uint16Array;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 12; i++) for (let k = 0; k < 3; k++) {
        let reference = 0;
        for (let y = 8 * j; y < 8 * j + 8; y++) for (let x = 8 * i; x < 8 * i + 8; x++) reference += decode16(samples[(y * 96 + x) * 3 + k]!) / 64;
        const difference = view.image.samples[(j * 12 + i) * 3 + k]! - encode8(reference);
        sq += difference * difference; max = Math.max(max, Math.abs(difference));
      }
      // The display view's own noise draw and the capture's noise: the thresholds of the chart tests (test/display-view-lens.test.ts) plus one code of the view's rounding and noise.
      expect(Math.sqrt(sq / (8 * 12 * 3))).toBeLessThan(2);
      expect(max).toBeLessThan(6);
    }
  }, 120_000);

  it("loads its module only through prepareImagePlaneScenes(): no static import from the facade, the GPU code or the package entry", () => {
    for (const file of ["src/index.ts", "src/facade/simulate-capture.ts", "src/facade/scene-radiance.ts", "src/facade/simulate-display-view.ts", "src/facade/expected-signal-setup.ts",
      "src/facade/image-plane-support.ts", "src/gpu/display-view-composite-material-module.ts", "src/gpu/display-view-speed-gpu.ts", "src/gpu/display-view-quality-gpu.ts"]) {
      const text = readFileSync(new URL("../" + file, import.meta.url), "utf8");
      expect(text).not.toMatch(/^import [^;]*from "(\.\.?\/)+(facade\/)?image-plane(-lattice-data)?\.js";/mu);
      expect(text).not.toMatch(/^import [^t][^;]*from "\.\/display-view-image-material-module\.js";/mu);
    }
  });
});
