// SPDX-License-Identifier: Apache-2.0

/**
 * The image-plane scene (2.21, #581): a photo as a flat matte print on the scene plane. Loaded on demand (a dynamic import by
 * the facade) only when a request's scene is `{ kind: "image-plane" }`, so a bundle that never prints a photo does not carry
 * it or its lattice data.
 *
 * **From pixel to reflectance** (docs/IMAGE_PLANE.md):
 *
 * 1. Decode to linear sRGB: `srgb-8` and `srgb-16` through the sRGB transfer function (IEC 61966-2-1, the piecewise EOTF)
 *    evaluated with the portable power (`portablePow`, within 1 ulp, the same bits in every JavaScript engine); `linear-srgb`
 *    as given, clipped to [0, 1]. A pixel with alpha a is composited over the paper in linear light: c' = a·c + (1 − a).
 * 2. The print reflectance lattice: 5 × 5 × 5 nodes at the sRGB code values 0, 1/4, 1/2, 3/4, 1 per channel (their linear
 *    values L₀…L₄). The node spectra on the neutral axis are flat (the node's linear value); the other 120 are Photivra's own
 *    LHTSS fits (S. A. Burns, arXiv:1710.05732 v5, "Least Hyperbolic Tangent Slope Squared (LHTSS) Method", pp. 24–26), each
 *    reproducing its node's sRGB under CIE D65 with the CIE 1931 2° observer (scripts/fit-image-plane-lattice.mjs), stored at
 *    10 nm over 380–780 nm in 16 bits and linearly interpolated between samples. A pixel's spectrum is the trilinear
 *    interpolation, in linear sRGB, of the spectra of the eight nodes of its cell: a convex combination of spectra in [0, 1],
 *    so it lies in [0, 1], and, XYZ being linear in the spectrum, it reproduces the pixel's sRGB under D65 to the nodes' own
 *    residual (measured by the fit: CIEDE2000 at most 6.4·10⁻⁴ over a 17³ grid of sRGB codes).
 * 3. The paper: ρ = ρ_black + (ρ_white − ρ_black)·ρ_lattice, affine and so still bounded; defaults 0.90 and 0.01.
 * 4. Between pixel centers (`bilinear`, the default): the pixels' spectra weighted bilinearly, which under D65 is the bilinear
 *    interpolation of the pixels' linear sRGB; `nearest` takes the pixel under the point. The print's edge pixels extend to
 *    its edges (clamp to edge).
 *
 * Print-local coordinates are the chart's (cu = ±1 at the left and right edges, cv up, ±aspect at the top and bottom); the
 * pixel coordinates are X = (cu + 1)·W/2 and Y = (aspect − cv)·H/(2·aspect), with pixel centers at half-integers.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { portablePow } from "../core/portable-math.js";
import { FULL_RESOLUTION_CEILING_PIXELS, FULL_RESOLUTION_DEFAULT_PIXELS, resolveRaisedLimit } from "../core/pixel-limits.js";
import { IMAGE_PLANE_LATTICE_CODES } from "./image-plane-lattice-data.js";
import { CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE, resolveChartSizeOption, type ImagePlaneChannelTables, type ImagePlaneSignalScene, type ResolvedImagePlaneScene } from "./scene-radiance.js";

/** Version of the print reflectance lattice and its data; a change to any node spectrum changes it. */
export const IMAGE_PLANE_LATTICE_VERSION = "1.0.0";
/** Engine defaults of an image-plane scene. */
export const IMAGE_PLANE_DEFAULTS = /* @__PURE__ */ Object.freeze({ paperWhiteReflectance: 0.9, paperBlackReflectance: 0.01, interpolation: "bilinear" as const });

const AXIS = 5, NODES = 125, SAMPLES = 41, MINIMUM_NM = 380, STEP_NM = 10, MAXIMUM_NM = MINIMUM_NM + STEP_NM * (SAMPLES - 1);

/** The sRGB EOTF with the portable power. */
function decodeSrgb(encoded: number): number {
  return encoded <= 0.04045 ? encoded / 12.92 : portablePow((encoded + 0.055) / 1.055, 2.4);
}
/** The lattice's node levels in linear sRGB. */
const LEVELS = /* @__PURE__ */ Float64Array.from({ length: AXIS }, (_, k) => (k === 0 ? 0 : k === AXIS - 1 ? 1 : decodeSrgb(k / (AXIS - 1))));

let nodeSpectra: Float64Array | null = null;
/** The 125 node spectra, 41 samples each (node index r·25 + g·5 + b), decoded once from the data module. */
function spectra(): Float64Array {
  if (nodeSpectra) return nodeSpectra;
  const out = new Float64Array(NODES * SAMPLES), rows = IMAGE_PLANE_LATTICE_CODES.split(";");
  if (rows.length !== NODES - AXIS) throw new InvalidConfigurationError("The image-plane lattice data is damaged.");
  let row = 0;
  for (let node = 0; node < NODES; node++) {
    const r = Math.floor(node / 25), g = Math.floor(node / 5) % 5, b = node % 5;
    if (r === g && g === b) { out.fill(LEVELS[r]!, node * SAMPLES, (node + 1) * SAMPLES); continue; }
    const deltas = rows[row++]!.split(",");
    if (deltas.length !== SAMPLES) throw new InvalidConfigurationError("The image-plane lattice data is damaged.");
    let code = 0;
    for (let i = 0; i < SAMPLES; i++) {
      code += parseInt(deltas[i]!, 36);
      if (!(code >= 0 && code <= 65535)) throw new InvalidConfigurationError("The image-plane lattice data is damaged.");
      out[node * SAMPLES + i] = code / 65535;
    }
  }
  return (nodeSpectra = out);
}

/** Internal (for tests and docs): the node spectra as 125 rows of 41 reflectances at 380, 390, …, 780 nm. */
export function imagePlaneLatticeSpectra(): { levels: readonly number[]; wavelengthsNm: readonly number[]; spectra: readonly Float64Array[] } {
  const all = spectra();
  return { levels: Array.from(LEVELS), wavelengthsNm: Array.from({ length: SAMPLES }, (_, i) => MINIMUM_NM + STEP_NM * i),
    spectra: Array.from({ length: NODES }, (_, k) => all.slice(k * SAMPLES, (k + 1) * SAMPLES)) };
}

/** Every node's reflectance at one wavelength (the samples linearly interpolated). */
function nodeReflectancesAt(nm: number): Float64Array {
  if (typeof nm !== "number" || !(nm >= MINIMUM_NM && nm <= MAXIMUM_NM)) throw new InvalidConfigurationError("An image-plane print is defined on " + MINIMUM_NM + "–" + MAXIMUM_NM + " nm.");
  const all = spectra(), p = (nm - MINIMUM_NM) / STEP_NM, i = Math.min(SAMPLES - 2, Math.floor(p)), f = p - i, out = new Float64Array(NODES);
  for (let k = 0; k < NODES; k++) out[k] = all[k * SAMPLES + i]! * (1 - f) + all[k * SAMPLES + i + 1]! * f;
  return out;
}

/** The image's size, validated (the facade needs the aspect before the print's placement). */
export function readImagePlaneSize(value: unknown): { width: number; height: number } {
  if (typeof value !== "object" || value === null) throw new InvalidConfigurationError("scene must be an object.");
  const image = (value as { image?: unknown }).image;
  if (typeof image !== "object" || image === null) throw new InvalidConfigurationError("An image-plane scene needs image { width, height, channels, encoding, data }.");
  const { width, height } = image as Record<string, unknown>;
  for (const [name, v] of [["width", width], ["height", height]] as const)
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 65_536) throw new InvalidConfigurationError("scene.image." + name + " must be an integer from 1 to 65536.");
  return { width: width as number, height: height as number };
}

/**
 * Validates an image-plane scene and prepares it on a print of aspect `aspect` (height / width): the digest of its data, the
 * count of clipped `linear-srgb` samples, and the decoders. The data is borrowed (read on every lookup, never written).
 */
export async function resolveImagePlaneScene(value: unknown, aspect: number,
  assume?: (id: string, kind: "default" | "model" | "derived", value: unknown, explanation: string) => void): Promise<ResolvedImagePlaneScene> {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["kind", "sceneId", "image", "paper", "interpolation", "maximumPixels"].includes(key)) throw new InvalidConfigurationError("Unknown scene field: " + key + ".");
  if (typeof record.sceneId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(record.sceneId)) throw new InvalidConfigurationError("An image-plane scene needs a public sceneId.");
  const { width, height } = readImagePlaneSize(record);
  const image = record.image as Record<string, unknown>;
  for (const key of Object.keys(image)) if (!["width", "height", "channels", "encoding", "data"].includes(key)) throw new InvalidConfigurationError("Unknown scene.image field: " + key + ".");
  const maximumPixels = resolveRaisedLimit(record.maximumPixels, FULL_RESOLUTION_DEFAULT_PIXELS, FULL_RESOLUTION_CEILING_PIXELS,
    "scene.maximumPixels must be an integer from 1 to " + FULL_RESOLUTION_CEILING_PIXELS + ".");
  if (width * height > maximumPixels) throw new InvalidConfigurationError("The image has " + width * height + " pixels, above scene.maximumPixels (" + maximumPixels + ").");
  const channelsValue = image.channels, encoding = image.encoding, data = image.data;
  if (channelsValue !== 3 && channelsValue !== 4) throw new InvalidConfigurationError("scene.image.channels must be 3 (RGB) or 4 (RGBA).");
  const typeOk = encoding === "srgb-8" ? data instanceof Uint8Array || data instanceof Uint8ClampedArray : encoding === "srgb-16" ? data instanceof Uint16Array :
    encoding === "linear-srgb" ? data instanceof Float32Array : undefined;
  if (typeOk === undefined) throw new InvalidConfigurationError("scene.image.encoding must be \"srgb-8\", \"srgb-16\" or \"linear-srgb\".");
  if (!typeOk) throw new InvalidConfigurationError("scene.image.data must be a " + (encoding === "srgb-8" ? "Uint8Array or Uint8ClampedArray" : encoding === "srgb-16" ? "Uint16Array" : "Float32Array") + " for " + encoding + ".");
  const channels: 3 | 4 = channelsValue;
  const samples = data as Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array;
  if (samples.length !== width * height * channels) throw new InvalidConfigurationError("scene.image.data must hold width × height × channels = " + width * height * channels + " samples.");
  const paperRecord = record.paper;
  if (paperRecord !== undefined && (typeof paperRecord !== "object" || paperRecord === null)) throw new InvalidConfigurationError("scene.paper must be an object.");
  const paper = (paperRecord ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(paper)) if (key !== "whiteReflectance" && key !== "blackReflectance") throw new InvalidConfigurationError("Unknown scene.paper field: " + key + ".");
  const whiteValue = paper.whiteReflectance ?? IMAGE_PLANE_DEFAULTS.paperWhiteReflectance, blackValue = paper.blackReflectance ?? IMAGE_PLANE_DEFAULTS.paperBlackReflectance;
  if (typeof whiteValue !== "number" || typeof blackValue !== "number" || !(blackValue >= 0 && blackValue < whiteValue && whiteValue <= 1))
    throw new InvalidConfigurationError("scene.paper needs reflectances 0 ≤ blackReflectance < whiteReflectance ≤ 1.");
  const white: number = whiteValue, black: number = blackValue;
  const interpolation = record.interpolation ?? IMAGE_PLANE_DEFAULTS.interpolation;
  if (interpolation !== "bilinear" && interpolation !== "nearest") throw new InvalidConfigurationError("scene.interpolation must be \"bilinear\" or \"nearest\".");
  if (typeof aspect !== "number" || !(aspect > 0) || !Number.isFinite(aspect)) throw new InvalidConfigurationError("The print's aspect must be positive.");
  // Linear input: every sample finite; those outside [0, 1] are clipped and counted.
  let clipped = 0;
  if (encoding === "linear-srgb") for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    if (!Number.isFinite(v)) throw new InvalidConfigurationError("scene.image.data must be finite (sample " + i + ").");
    if (v < 0 || v > 1) clipped++;
  }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new InvalidConfigurationError("An image-plane scene needs crypto.subtle (a secure browser context or Node 22+) to digest the image.");
  const view = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const digest = new Uint8Array(await subtle.digest("SHA-256", (samples.buffer instanceof ArrayBuffer ? view : view.slice()) as Uint8Array<ArrayBuffer>));
  const dataSha256 = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");

  // Decoders: a table per integer encoding (the transfer function once per code), the clip for linear samples.
  const scale = encoding === "srgb-8" ? 255 : encoding === "srgb-16" ? 65535 : 1;
  const table = encoding === "linear-srgb" ? null : Float64Array.from({ length: scale + 1 }, (_, code) => decodeSrgb(code / scale));
  const color = table ? (i: number): number => table[samples[i]!]! : (i: number): number => { const v = samples[i]!; return v <= 0 ? 0 : v >= 1 ? 1 : v; };
  const alpha = channels === 3 ? null : encoding === "linear-srgb" ? color : (i: number): number => samples[i]! / scale;
  const rgb = new Float64Array(3), span = white - black;
  const cellOf = (v: number): number => (v > LEVELS[3]! ? 3 : v > LEVELS[2]! ? 2 : v > LEVELS[1]! ? 1 : 0);
  const fractions = new Float64Array(3);
  /** One pixel's lattice cell (its base node, returned) and its fractions in the cell (into `out`). */
  function pixelLattice(index: number, out: Float64Array): number {
    const base = index * channels;
    if (alpha) {
      const a = alpha(base + 3);
      for (let c = 0; c < 3; c++) rgb[c] = a * color(base + c) + (1 - a);
    } else for (let c = 0; c < 3; c++) rgb[c] = color(base + c);
    const kr = cellOf(rgb[0]!), kg = cellOf(rgb[1]!), kb = cellOf(rgb[2]!);
    out[0] = (rgb[0]! - LEVELS[kr]!) / (LEVELS[kr + 1]! - LEVELS[kr]!); out[1] = (rgb[1]! - LEVELS[kg]!) / (LEVELS[kg + 1]! - LEVELS[kg]!); out[2] = (rgb[2]! - LEVELS[kb]!) / (LEVELS[kb + 1]! - LEVELS[kb]!);
    return kr * 25 + kg * 5 + kb;
  }
  /** One pixel in node values: the trilinear weights of its linear sRGB in the lattice cell, then the paper. */
  function pixelValue(index: number, nodeValues: Float64Array, neutral: number): number {
    const n = pixelLattice(index, fractions), fr = fractions[0]!, fg = fractions[1]!, fb = fractions[2]!;
    const lattice = (1 - fr) * ((1 - fg) * ((1 - fb) * nodeValues[n]! + fb * nodeValues[n + 1]!) + fg * ((1 - fb) * nodeValues[n + 5]! + fb * nodeValues[n + 6]!)) +
      fr * ((1 - fg) * ((1 - fb) * nodeValues[n + 25]! + fb * nodeValues[n + 26]!) + fg * ((1 - fb) * nodeValues[n + 30]! + fb * nodeValues[n + 31]!));
    return black * neutral + span * lattice;
  }
  const halfW = width / 2, halfH = height / (2 * aspect);
  function sampleAt(cu: number, cv: number, nodeValues: Float64Array, neutral: number): number {
    const X = (cu + 1) * halfW, Y = (aspect - cv) * halfH;
    if (interpolation === "nearest") {
      const i = Math.min(width - 1, Math.max(0, Math.floor(X))), j = Math.min(height - 1, Math.max(0, Math.floor(Y)));
      return pixelValue(j * width + i, nodeValues, neutral);
    }
    const sx = X - 0.5, sy = Y - 0.5, i0 = Math.floor(sx), j0 = Math.floor(sy), fx = sx - i0, fy = sy - j0;
    const ia = Math.min(width - 1, Math.max(0, i0)), ib = Math.min(width - 1, Math.max(0, i0 + 1));
    const ja = Math.min(height - 1, Math.max(0, j0)) * width, jb = Math.min(height - 1, Math.max(0, j0 + 1)) * width;
    return (1 - fy) * ((1 - fx) * pixelValue(ja + ia, nodeValues, neutral) + fx * pixelValue(ja + ib, nodeValues, neutral)) +
      fy * ((1 - fx) * pixelValue(jb + ia, nodeValues, neutral) + fx * pixelValue(jb + ib, nodeValues, neutral));
  }
  // Per wavelength the node reflectances (the facade asks for a few spectral nodes many times).
  const atWavelength = new Map<number, Float64Array>();
  function reflectanceAt(cu: number, cv: number, nm: number): number {
    let nodes = atWavelength.get(nm);
    if (!nodes) { nodes = nodeReflectancesAt(nm); if (atWavelength.size < 4096) atWavelength.set(nm, nodes); }
    return sampleAt(cu, cv, nodes, 1);
  }
  function channelTables(wavelengths: readonly number[], perNode: readonly Float64Array[], whiteRadiance: Float64Array): ImagePlaneChannelTables {
    const reflectances = wavelengths.map((nm) => nodeReflectancesAt(nm));
    const nodes = [0, 1, 2].map((c) => {
      const out = new Float64Array(NODES);
      for (let k = 0; k < NODES; k++) { let s = 0; for (let n = 0; n < wavelengths.length; n++) s += perNode[c]![n]! * reflectances[n]![k]! * whiteRadiance[n]!; out[k] = s; }
      return out;
    }) as [Float64Array, Float64Array, Float64Array];
    const neutral = [0, 1, 2].map((c) => { let s = 0; for (let n = 0; n < wavelengths.length; n++) s += perNode[c]![n]! * whiteRadiance[n]!; return s; }) as [number, number, number];
    return { nodes, neutral };
  }
  function signalScene(wavelengths: readonly number[], perNode: readonly Float64Array[], whiteRadiance: Float64Array, radianceAt: (u: number, v: number, nm: number) => number,
    scale: number, half: number, surroundReflectance: number): ImagePlaneSignalScene {
    const tables = channelTables(wavelengths, perNode, whiteRadiance), { nodes, neutral } = tables;
    return { kind: "radiance", radianceAt, signalAt(u: number, v: number, c: number): number {
      const cu = u * scale / half, cv = v * scale / half;
      return Math.abs(cu) <= 1 && Math.abs(cv) <= aspect ? sampleAt(cu, cv, nodes[c as 0], neutral[c as 0]) : surroundReflectance * neutral[c as 0];
    }, image: { scene: resolved, tables, surround: [surroundReflectance * neutral[0], surroundReflectance * neutral[1], surroundReflectance * neutral[2]], whiteRadiance, surroundReflectance } };
  }
  const resolved: ResolvedImagePlaneScene = Object.freeze({ kind: "image-plane" as const, sceneId: record.sceneId, width, height, aspect, channels, encoding: encoding as ResolvedImagePlaneScene["encoding"],
    interpolation, paperWhiteReflectance: white, paperBlackReflectance: black, maximumPixels, clippedSampleCount: clipped, dataSha256,
    reflectanceAt, channelTables, sampleAt, pixelValue, pixelLattice, nodeReflectances: nodeReflectancesAt, signalScene, get digestForm() { return imagePlaneDigestForm(resolved); }, parameters: Object.freeze({ width, height, channels, encoding, interpolation, paperWhiteReflectance: white, paperBlackReflectance: black,
      clippedSampleCount: clipped, imageSha256: dataSha256 }) });
  if (assume) for (const [id, kind, v, explanation] of imagePlaneAssumptions(resolved, record)) assume(id, kind, v, explanation);
  return resolved;
}

/** The scene's form in the facade's source digest: the image's SHA-256 and shape, the paper, the interpolation and the lattice version. */
export function imagePlaneDigestForm(scene: ResolvedImagePlaneScene): Record<string, unknown> {
  return { kind: scene.kind, sceneId: scene.sceneId, image: { width: scene.width, height: scene.height, channels: scene.channels, encoding: scene.encoding, sha256: scene.dataSha256 },
    paper: { whiteReflectance: scene.paperWhiteReflectance, blackReflectance: scene.paperBlackReflectance }, interpolation: scene.interpolation, latticeVersion: IMAGE_PLANE_LATTICE_VERSION };
}

/** The assumptions an image-plane capture records: the model, the defaults taken, and the clipped linear samples. */
export function imagePlaneAssumptions(scene: ResolvedImagePlaneScene, record: Record<string, unknown>): [string, "default" | "model" | "derived", unknown, string][] {
  const out: [string, "default" | "model" | "derived", unknown, string][] = [];
  const paper = (record.paper ?? {}) as Record<string, unknown>;
  if (paper.whiteReflectance === undefined) out.push(["scene.paper.whiteReflectance", "default", scene.paperWhiteReflectance,
    "Photivra's assumption, not a measurement: the paper reflects 90 % (the white of the engine's Studio Gray 1 patch), so sRGB white prints as a 0.90 flat reflectance."]);
  if (paper.blackReflectance === undefined) out.push(["scene.paper.blackReflectance", "default", scene.paperBlackReflectance,
    "Photivra's assumption, not a measurement: the deepest ink reflects 1 % (an optical density of 2.0), so sRGB black prints as a 0.01 flat reflectance."]);
  if (record.interpolation === undefined) out.push(["scene.interpolation", "default", scene.interpolation,
    "Bilinear between pixel centers: the four nearest pixels' reflectance spectra, bilinearly weighted (under CIE D65, the bilinear interpolation of their linear sRGB); the edge pixels extend to the print's edges."]);
  out.push(["scene.imagePlane", "model", { latticeVersion: IMAGE_PLANE_LATTICE_VERSION, nodesPerAxis: AXIS, method: "lhtss-burns-2020", wavelengthStepNanometers: STEP_NM,
    width: scene.width, height: scene.height, encoding: scene.encoding, channels: scene.channels },
    "An approximation: a print of the image, which was already processed, clipped and blurred by the camera that took it. Each pixel is decoded to linear sRGB " +
    (scene.encoding === "linear-srgb" ? "(given linear, clipped to [0, 1])" : "with the sRGB transfer function (IEC 61966-2-1)") + (scene.channels === 4 ? ", composited over the paper by its alpha," : "") +
    " and becomes a reflectance spectrum by trilinear interpolation in a 5 × 5 × 5 lattice of smooth spectra (Burns' LHTSS method, arXiv:1710.05732 v5, fitted by Photivra against CIE D65 and the " +
    "CIE 1931 2° observer), which reproduces the pixel's sRGB under D65 within CIEDE2000 6.4e-4 and stays in [0, 1]; then ρ = black + (white − black)·ρ. Under other lights its colors are one plausible " +
    "metamer of many (docs/IMAGE_PLANE.md, measured spread). A flat matte Lambertian print: no gloss, paper texture, halftone, curl or fluorescence."]);
  out.push(["scene.digest", "model", "image-data-hashed", "The source digest covers the image's SHA-256, size, channels and encoding, the paper, the interpolation, the lattice version and the framing."]);
  if (scene.clippedSampleCount > 0) out.push(["scene.image.clippedSamples", "derived", scene.clippedSampleCount,
    "Linear samples outside [0, 1] clipped to the print's range (a print cannot be brighter than its paper or darker than its deepest ink)."]);
  return out;
}

/** The GPU display view's image-plane module, loaded on demand by the GPU renderer (its own chunk). */
export function loadGpuModule(): Promise<typeof import("../gpu/display-view-image-material-module.js")> {
  return import("../gpu/display-view-image-material-module.js");
}

/**
 * The print's placement: `chartSize` with its height defaulting to the image's aspect, or, without it, the print fitted inside
 * the frame (centered, filling its width or height) on the default surround; records the defaults it takes.
 */
export function imagePlanePrint(scene: unknown, chartSize: unknown, framedWidthM: number, frameAspect: number,
  assume: (id: string, kind: "default", value: unknown, explanation: string) => void): ReturnType<typeof resolveChartSizeOption> {
  const size = readImagePlaneSize(scene), imageAspect = size.height / size.width;
  if (chartSize !== undefined) {
    const resolved = resolveChartSizeOption(chartSize, imageAspect);
    if (resolved.defaulted.includes("heightM")) assume("chartSize.heightM", "default", resolved.heightM, "The print has the image's shape: height = width × image height / image width.");
    return { ...resolved, defaulted: resolved.defaulted.filter((key) => key !== "heightM") };
  }
  const widthM = imageAspect > frameAspect ? framedWidthM * frameAspect / imageAspect : framedWidthM;
  const fitted = { widthM, heightM: widthM * imageAspect, surroundReflectance: CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE, defaulted: [] as ("heightM" | "surroundReflectance")[] };
  assume("chartSize", "default", { widthM: fitted.widthM, heightM: fitted.heightM, surroundReflectance: fitted.surroundReflectance },
    "The print has the image's shape and is fitted inside the frame, centered (it fills the frame's width or height), on an 18 % neutral gray surround.");
  return fitted;
}
