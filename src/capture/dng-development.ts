// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #607 go item (2.24.0): a full color development of an imported DNG with a chosen white balance and exposure push, the glue that
 * joins the engine's existing stages (none of which developed an imported file to sRGB before):
 * 1. `developDngStageImage`: OpcodeList1, linearization, black and white levels, OpcodeList2 (and OpcodeList3 for LinearRaw);
 * 2. demosaic of a 2 × 2 RGB Bayer mosaic: the built-in bilinear kernels (`createBuiltInBayerDemosaicProfiles`,
 *    `createCfaPlaneReconstructionTask`; fast) or AHD (`createAhdDemosaicTask`, Hirakawa & Parks 2005; full quality), then OpcodeList3;
 * 3. camera → CIE XYZ (D50) as the DNG 1.7.1.0 specification maps it (chapter 6, "Mapping Camera Color Space to CIE XYZ Space"):
 *    ColorMatrix1/2 and ForwardMatrix1/2 interpolated linearly in inverse correlated color temperature between the calibration
 *    illuminants, CameraCalibration and AnalogBalance, the white's chromaticity found from the camera neutral by iteration; white
 *    balance in the reference camera space, each white-balanced channel clipped at 1;
 * 4. ProfileGainTableMap (linear ProPhoto D50) and BaselineExposure where the file has them, the caller's push, the engine's SDR
 *    tone curve in linear sRGB (D65, Bradford from D50), RGBTables (ProPhoto, after the tone curve), gamut handling and the sRGB
 *    encoding (the capture's own `renderSdrRunInto`);
 * 5. the default crop and the Orientation.
 * A push is "brightened in editing": it scales the developed signal and its noise alike (#607).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { fastFormatDefault, resolveFast } from "../facade/fast-resolution.js";
import { invertMatrix3x3, multiplyMatrices, multiplyMatrixVector, diagonalMatrix, xyzOfChromaticity, chromaticityOfXyz, type ColorMatrix3x3, type ColorVector3, type CieXyChromaticity } from "../color/colorimetry-math.js";
import { chromaticAdaptationMatrix } from "../color/chromatic-adaptation.js";
import { calculateChromaticityFromCorrelatedColorTemperature, calculateCorrelatedColorTemperature, estimateCorrelatedColorTemperatureMcCamy, type WhiteLocus } from "../color/illuminants.js";
import { rgbToXyzMatrices } from "../color/rgb-color-spaces.js";
import { resolveCaptureColorModel } from "../color/capture-color.js";
import { bradfordD65ToD50Matrix, ICC_D50_WHITE_XYZ } from "../color/srgb-icc.js";
import { prepareSdrPixelTone, type SdrRenderingProfile, type SdrToneCurve, type SdrToneCurveParameters } from "../output/sdr-rendering.js";
import { renderSdrRunInto, type SdrPixelCounts } from "../output/native-capture-sdr.js";
import { createAhdDemosaicTask, createCfaPlaneReconstructionTask } from "../processing/demosaic.js";
import { createBuiltInBayerDemosaicProfiles } from "../sensor/raw-reconstruction.js";
import type { SensorColorSamplingProfile } from "../sensor/color-sampling.js";
import { applyDngOpcodes, type DngStageImage } from "./dng-opcodes.js";
import { applyDngProfileGainTableMap, applyDngRgbTables } from "./dng-profile-maps.js";
import { developDngStageImage } from "./dng-stage-image.js";
import type { ImportedDngRaw } from "./dng-import.js";

/** The white balance of a development: the file's as-shot white, a correlated color temperature, a chromaticity or a camera neutral. */
export type DevelopDngImageWhiteBalance =
  | "as-shot"
  | { kelvin: number; duv?: number; whiteLocus?: WhiteLocus }
  | { chromaticity: CieXyChromaticity }
  | { cameraNeutral: readonly [number, number, number] };

export interface DevelopDngImageOptions {
  /** Default "as-shot" (AsShotNeutral, else AsShotWhiteXY, else D65 with an assumption). */
  whiteBalance?: DevelopDngImageWhiteBalance;
  /** Brightened (positive) or darkened in editing, stops (−10 to +10, default 0): the signal and its noise scale alike. */
  exposurePushStops?: number;
  /** Apply BaselineExposure (default true), as the DNG specification asks a renderer to. */
  baselineExposure?: boolean;
  /** The SDR tone curve (default "identity", as `simulateCapture`), with its parameters for the luminance curves. */
  toneCurve?: SdrToneCurve;
  toneCurveParameters?: SdrToneCurveParameters;
  /** Default "clip-components". */
  gamutHandling?: SdrRenderingProfile["gamutHandling"];
  /** "srgb-8" (default) or "srgb-16". */
  format?: "srgb-8" | "srgb-16";
  /**
   * Speed versus accuracy (registry entry `developDngImage/demosaic`): true uses the bilinear demosaic and bilinear WarpRectilinear,
   * false AHD and cubic convolution. Default from `format` (fast for the on-screen sRGB formats, as everywhere in the engine).
   */
  fast?: boolean;
  /** Apply the opcode lists (default true). */
  opcodes?: boolean;
  /** "default" (DefaultCrop, default) or "active-area". */
  crop?: "default" | "active-area";
  /** Apply the Orientation tag (default true). */
  orientation?: boolean;
}

export interface DevelopedDngImage {
  width: number;
  height: number;
  format: "srgb-8" | "srgb-16";
  /** Interleaved sRGB-encoded RGB, row-major. */
  samples: Uint8Array | Uint16Array;
  whiteBalance: {
    source: "as-shot-neutral" | "as-shot-white-xy" | "default-d65" | "kelvin" | "chromaticity" | "camera-neutral";
    /** The camera neutral (max component 1) and the white's chromaticity, with its CCT where one is defined. */
    cameraNeutral: [number, number, number];
    chromaticity: CieXyChromaticity;
    correlatedColorTemperatureKelvin: number | null;
  };
  /** White-balanced reference-camera RGB → XYZ D50 (row-major 3 × 3); the white maps to Y = 1. */
  cameraToXyzD50: number[];
  exposure: { baselineExposureStops: number; pushStops: number; label: string | null };
  demosaic: "bilinear" | "ahd" | "none";
  fast: { requested: boolean; defaultedFrom: "request" | "format" };
  /** Pixels with a white-balanced channel clipped at 1, and output components clipped by the gamut handling. */
  clippedPixelCount: number;
  assumptions: string[];
}

function fail(message: string): never { throw new InvalidConfigurationError("developDngImage: " + message); }
const KEYS = ["whiteBalance", "exposurePushStops", "baselineExposure", "toneCurve", "toneCurveParameters", "gamutHandling", "format", "fast", "opcodes", "crop", "orientation"];

/**
 * CCT of the CIE standard illuminants among the Exif LightSource codes a DNG names (CIE 15:2018 Table 3 nominal values with the
 * current c₂; ISO studio tungsten 3200 K, ISO 7589). Other codes have no defined chromaticity and are not interpolated.
 */
const ILLUMINANT_KELVIN: Readonly<Record<number, number>> = { 17: 2856, 18: 4874, 19: 6774, 20: 5503, 21: 6504, 22: 7504, 23: 5003, 24: 3200 };
const D50_XY: CieXyChromaticity = chromaticityOfXyz({ x: ICC_D50_WHITE_XYZ[0], y: ICC_D50_WHITE_XYZ[1], z: ICC_D50_WHITE_XYZ[2] });
const LOCUS = { kind: "planck-analytic-cmf" } as const;

const m3 = (v: readonly number[]): ColorMatrix3x3 => [[v[0]!, v[1]!, v[2]!], [v[3]!, v[4]!, v[5]!], [v[6]!, v[7]!, v[8]!]];
const lerp = (a: ColorMatrix3x3, b: ColorMatrix3x3, w: number): ColorMatrix3x3 => a.map((row, i) => row.map((x, j) => w * x + (1 - w) * b[i]![j]!)) as unknown as ColorMatrix3x3;
const flat = (m: ColorMatrix3x3): number[] => m.flat();

function cctOf(xy: CieXyChromaticity): number | null {
  try { return calculateCorrelatedColorTemperature({ chromaticity: xy, locus: LOCUS }).value.correlatedColorTemperatureKelvin; } catch {
    try { return estimateCorrelatedColorTemperatureMcCamy({ chromaticity: xy }).value.correlatedColorTemperatureKelvin; } catch { return null; }
  }
}

/** Internal: the file's color model, interpolated at a white chromaticity (DNG 1.7.1.0, chapter 6). */
function prepareColor(raw: ImportedDngRaw, notes: string[]): { xyzToCamera(xy: CieXyChromaticity): ColorMatrix3x3; forward(xy: CieXyChromaticity): ColorMatrix3x3 | null; abcc(xy: CieXyChromaticity): ColorMatrix3x3 } {
  if (!raw.colorMatrix1) throw new InvalidScientificInputError("developDngImage: the file has no ColorMatrix1, so its camera colors cannot be mapped to XYZ.");
  const t1 = raw.calibrationIlluminant1 === null ? null : ILLUMINANT_KELVIN[raw.calibrationIlluminant1] ?? null;
  const t2 = raw.calibrationIlluminant2 === null ? null : ILLUMINANT_KELVIN[raw.calibrationIlluminant2] ?? null;
  const two = raw.colorMatrix2 !== null && t1 !== null && t2 !== null && t1 !== t2;
  if (raw.colorMatrix2 && !two) notes.push("developDngImage.color: ColorMatrix2 is present but the calibration illuminants have no defined temperature; ColorMatrix1 alone is used.");
  const weight = (xy: CieXyChromaticity): number => {
    if (!two) return 1;
    const t = cctOf(xy) ?? 5000, lo = Math.min(t1, t2), hi = Math.max(t1, t2), w1 = t1 < t2 ? 1 : 0;
    if (t <= lo) return w1;
    if (t >= hi) return 1 - w1;
    const g = (1 / t - 1 / hi) / (1 / lo - 1 / hi); // weight of the lower-temperature matrix
    return t1 < t2 ? g : 1 - g;
  };
  const pickAt = (a: number[] | null, b: number[] | null, w: number): ColorMatrix3x3 | null => a ? (two && b ? lerp(m3(a), m3(b), w) : m3(a)) : null;
  const signatureOk = raw.cameraCalibrationSignature === null || raw.cameraCalibrationSignature === raw.profileCalibrationSignature;
  if (!signatureOk && (raw.cameraCalibration1 || raw.cameraCalibration2)) notes.push("developDngImage.color: CameraCalibrationSignature differs from ProfileCalibrationSignature; CameraCalibration is not applied (DNG 1.7.1.0).");
  const ab = diagonalMatrix((raw.analogBalance ?? [1, 1, 1]) as unknown as ColorVector3);
  const identity: ColorMatrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const abcc = (xy: CieXyChromaticity): ColorMatrix3x3 => multiplyMatrices(ab, signatureOk ? pickAt(raw.cameraCalibration1, raw.cameraCalibration2, weight(xy)) ?? identity : identity);
  return {
    abcc,
    xyzToCamera: (xy) => multiplyMatrices(abcc(xy), pickAt(raw.colorMatrix1, raw.colorMatrix2, weight(xy))!),
    forward: (xy) => pickAt(raw.forwardMatrix1, raw.forwardMatrix2, weight(xy))
  };
}

/** The white's chromaticity of a camera neutral, by the DNG specification's iteration from D50. */
function neutralToXy(neutral: ColorVector3, xyzToCamera: (xy: CieXyChromaticity) => ColorMatrix3x3): CieXyChromaticity {
  let xy = D50_XY;
  for (let k = 0; k < 50; k++) {
    const xyz = multiplyMatrixVector(invertMatrix3x3(xyzToCamera(xy), "XYZ to camera"), neutral);
    if (!(xyz[1] > 0) || xyz.some((v) => !Number.isFinite(v))) throw new InvalidScientificInputError("developDngImage: the camera neutral maps to no physical white.");
    const next = chromaticityOfXyz({ x: xyz[0], y: xyz[1], z: xyz[2] });
    const done = Math.abs(next.x - xy.x) + Math.abs(next.y - xy.y) < 1e-10;
    xy = next;
    if (done) break;
  }
  return xy;
}
function xyToNeutral(xy: CieXyChromaticity, xyzToCamera: (xy: CieXyChromaticity) => ColorMatrix3x3): ColorVector3 {
  const w = xyzOfChromaticity(xy), n = multiplyMatrixVector(xyzToCamera(xy), [w.x, w.y, w.z]), max = Math.max(...n);
  if (!(max > 0) || n.some((v) => !(v > 0))) throw new InvalidScientificInputError("developDngImage: the white balance has no positive camera neutral.");
  return n.map((v) => v / max) as unknown as ColorVector3;
}

/** Display position of stored (x, y) for TIFF Orientation 1–8 on a W × H image. */
function orient(o: number, x: number, y: number, w: number, h: number): [number, number] {
  switch (o) {
    case 2: return [w - 1 - x, y];
    case 3: return [w - 1 - x, h - 1 - y];
    case 4: return [x, h - 1 - y];
    case 5: return [y, x];
    case 6: return [h - 1 - y, x];
    case 7: return [h - 1 - y, w - 1 - x];
    case 8: return [y, w - 1 - x];
    default: return [x, y];
  }
}

/** Full color development of an imported DNG (see the module comment). */
export async function developDngImage(raw: ImportedDngRaw, options: DevelopDngImageOptions = {}): Promise<DevelopedDngImage> {
  if (raw === null || typeof raw !== "object" || !(raw.codes instanceof Uint16Array)) fail("raw must be an ImportedDngRaw.");
  if (options === null || typeof options !== "object") fail("options must be an object.");
  for (const key of Object.keys(options)) if (!KEYS.includes(key)) fail("unknown option " + JSON.stringify(key) + ".");
  const format = options.format ?? "srgb-8";
  if (format !== "srgb-8" && format !== "srgb-16") fail('format must be "srgb-8" or "srgb-16".');
  if (options.fast !== undefined && typeof options.fast !== "boolean") fail("fast must be a boolean.");
  const fast = resolveFast(options.fast, fastFormatDefault(format, "capture"));
  const push = options.exposurePushStops ?? 0;
  if (typeof push !== "number" || !(push >= -10 && push <= 10)) fail("exposurePushStops must be a number from −10 to 10.");
  for (const key of ["baselineExposure", "opcodes", "orientation"] as const) if (options[key] !== undefined && typeof options[key] !== "boolean") fail(key + " must be a boolean.");
  const crop = options.crop ?? "default";
  if (crop !== "default" && crop !== "active-area") fail('crop must be "default" or "active-area".');
  const gamutHandling = options.gamutHandling ?? "clip-components";
  if (!["clip-components", "reject-out-of-range", "desaturate-to-luminance"].includes(gamutHandling)) fail("gamutHandling is not supported.");
  const toneCurve = options.toneCurve ?? "identity";
  const tone = prepareSdrPixelTone({ toneCurve, ...(options.toneCurveParameters === undefined ? {} : { toneCurveParameters: options.toneCurveParameters }) });
  if (raw.samplesPerPixel !== 1 && raw.samplesPerPixel !== 3) throw new InvalidScientificInputError("developDngImage: only CFA mosaics and three-sample LinearRaw images are developed.");
  const colorPlanes = raw.cfa ? raw.cfa.planeColors.length : raw.samplesPerPixel;
  if (colorPlanes !== 3 || (raw.cfa && raw.cfa.planeColors.join() !== "0,1,2")) throw new InvalidScientificInputError("developDngImage: only red, green and blue color planes are developed.");
  const notes: string[] = [];

  // 1. Stage image.
  const stage = developDngStageImage(raw, { format, fast, ...(options.opcodes === undefined ? {} : { opcodes: options.opcodes }) });
  notes.push(...stage.assumptions);
  const W = stage.width, H = stage.height;
  // 3. White balance and camera → XYZ D50.
  const color = prepareColor(raw, notes), wb = options.whiteBalance ?? "as-shot";
  let neutral: ColorVector3, xy: CieXyChromaticity, source: DevelopedDngImage["whiteBalance"]["source"];
  if (wb === "as-shot") {
    if (raw.asShotNeutral) { neutral = raw.asShotNeutral as unknown as ColorVector3; xy = neutralToXy(neutral, color.xyzToCamera); source = "as-shot-neutral"; }
    else if (raw.asShotWhiteXy) { xy = raw.asShotWhiteXy; neutral = xyToNeutral(xy, color.xyzToCamera); source = "as-shot-white-xy"; }
    else { xy = { x: 0.3127, y: 0.3290 }; neutral = xyToNeutral(xy, color.xyzToCamera); source = "default-d65"; notes.push("developDngImage.whiteBalance: the file states no as-shot white; D65 is used."); }
  } else if (wb !== null && typeof wb === "object" && "kelvin" in wb) {
    if (typeof wb.kelvin !== "number" || !(wb.kelvin >= 1000 && wb.kelvin <= 100_000)) fail("whiteBalance.kelvin must be a number from 1000 to 100000.");
    xy = calculateChromaticityFromCorrelatedColorTemperature({ correlatedColorTemperatureKelvin: wb.kelvin, duv: wb.duv ?? 0, whiteLocus: wb.whiteLocus ?? "planckian", locus: LOCUS }).value;
    neutral = xyToNeutral(xy, color.xyzToCamera); source = "kelvin";
  } else if (wb !== null && typeof wb === "object" && "chromaticity" in wb) {
    const c = wb.chromaticity;
    if (!c || !(c.x > 0) || !(c.y > 0) || !(c.x + c.y < 1)) fail("whiteBalance.chromaticity must be a chromaticity (x > 0, y > 0, x + y < 1).");
    xy = { x: c.x, y: c.y }; neutral = xyToNeutral(xy, color.xyzToCamera); source = "chromaticity";
  } else if (wb !== null && typeof wb === "object" && "cameraNeutral" in wb) {
    const n = wb.cameraNeutral;
    if (!Array.isArray(n) || n.length !== 3 || n.some((v) => typeof v !== "number" || !(v > 0) || !Number.isFinite(v))) fail("whiteBalance.cameraNeutral must be three positive numbers.");
    neutral = n as unknown as ColorVector3; xy = neutralToXy(neutral, color.xyzToCamera); source = "camera-neutral";
  } else fail('whiteBalance must be "as-shot", { kelvin }, { chromaticity } or { cameraNeutral }.');
  const maxN = Math.max(...neutral);
  neutral = neutral.map((v) => v / maxN) as unknown as ColorVector3;
  const abcc = color.abcc(xy), reference = multiplyMatrixVector(invertMatrix3x3(abcc, "AnalogBalance · CameraCalibration"), neutral);
  if (reference.some((v) => !(v > 0))) throw new InvalidScientificInputError("developDngImage: the white balance has no positive reference neutral.");
  // Pre-transform P = diag(1/reference)·(AB·CC)⁻¹ (white balance in the reference camera space), then XYZ = M·clip(P·camera).
  const P = multiplyMatrices(diagonalMatrix(reference.map((v) => 1 / v) as unknown as ColorVector3), invertMatrix3x3(abcc, "AnalogBalance · CameraCalibration"));
  let M = color.forward(xy);
  if (M) {
    const w = multiplyMatrixVector(M, [1, 1, 1]);
    M = M.map((row) => row.map((v) => v / w[1])) as unknown as ColorMatrix3x3;
  } else {
    const ca = chromaticAdaptationMatrix({ transform: "bradford", sourceWhiteXyz: xyzOfChromaticity(xy), destinationWhiteXyz: { x: ICC_D50_WHITE_XYZ[0], y: 1, z: ICC_D50_WHITE_XYZ[2] } }).matrix;
    const m = multiplyMatrices(multiplyMatrices(ca, invertMatrix3x3(color.xyzToCamera(xy), "XYZ to camera")), invertMatrix3x3(P, "white balance"));
    const w = multiplyMatrixVector(m, [1, 1, 1]);
    M = m.map((row) => row.map((v) => v / w[1])) as unknown as ColorMatrix3x3;
    notes.push("developDngImage.color: no ForwardMatrix; camera → XYZ is the inverse ColorMatrix, adapted to D50 with the Bradford transform.");
  }
  // 2. Demosaic.
  let rgb: Float32Array, demosaic: DevelopedDngImage["demosaic"] = "none";
  if (raw.cfa) {
    const { repeatRows, repeatColumns, pattern } = raw.cfa, names = ["red", "green", "blue"];
    const bayer = repeatRows === 2 && repeatColumns === 2 && pattern.filter((c) => c === 1).length === 2 && pattern.includes(0) && pattern.includes(2) &&
      ((pattern[0] === 1 && pattern[3] === 1) || (pattern[1] === 1 && pattern[2] === 1));
    if (!bayer) throw new InvalidScientificInputError("developDngImage: only 2 × 2 Bayer mosaics (one red, one blue, two diagonal greens) are demosaiced.");
    const profile: SensorColorSamplingProfile = { schemaVersion: "0.1.0", profileId: "imported-dng-cfa", coordinateSystem: "native-sensor-color-sampling-site-index",
      evidence: [{ sourceOrigin: "photivra", sourceReference: "imported-dng-cfa-pattern", reuseStatus: "photivra-owned" }],
      layout: { kind: "periodic-mosaic", repeatWidthSites: 2, repeatHeightSites: 2, siteChannelIds: pattern.map((c) => names[c]!), anchor: "native-sensor-top-left-site" } };
    const plane = { width: W, height: H, captureModeId: "imported-dng", colorSamplingProfile: profile, samples: stage.data };
    const provider = { yieldControl: async (): Promise<void> => {} }, roles = { red: "red", green: "green", blue: "blue" };
    if (fast) {
      const phases = createBuiltInBayerDemosaicProfiles({ kernel: "bilinear", captureModeId: "imported-dng", colorSamplingProfile: profile, channelRoles: roles }).value.phaseProfiles;
      const task = createCfaPlaneReconstructionTask({ plane, phaseProfiles: phases, borderHandling: "mirror", maximumWorkingBytes: Number.MAX_SAFE_INTEGER }, provider);
      await task.run();
      const out = task.takeOutput(), order = out.channelIds.map((id) => names.indexOf(id));
      rgb = new Float32Array(W * H * 3);
      for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) rgb[3 * i + order[c]!] = out.data[3 * i + c]!;
      demosaic = "bilinear";
    } else {
      // The homogeneity metric sees white-balanced color (camera → XYZ = M·P, as the capture's AHD path does); the values are not transformed.
      const task = createAhdDemosaicTask({ plane, channelRoles: roles, cameraToXyz: multiplyMatrices(multiplyMatrices(invertMatrix3x3(bradfordD65ToD50Matrix() as unknown as ColorMatrix3x3, "Bradford"), M), P), maximumWorkingBytes: Number.MAX_SAFE_INTEGER }, provider);
      await task.run();
      rgb = task.takeOutput().data;
      demosaic = "ahd";
    }
    if ((options.opcodes ?? true) && raw.opcodeList3?.length) {
      const image: DngStageImage = { width: W, height: H, planes: 3, data: rgb };
      notes.push(...applyDngOpcodes(image, raw.opcodeList3, { stage: 3, fast, scale: raw.scale }));
      rgb = image.data;
    }
    for (let k = notes.length - 1; k >= 0; k--) if (notes[k]!.startsWith("OpcodeList3 not applied")) notes.splice(k, 1);
  } else rgb = stage.data;

  // 4. To linear sRGB (D65): Bradford D50 → D65, the engine's sRGB matrix (W3C CSS Color 4).
  const model = resolveCaptureColorModel(), xyzToSrgb = model.xyzToCameraRgb as unknown as ColorMatrix3x3;
  const d50ToD65 = invertMatrix3x3(bradfordD65ToD50Matrix() as unknown as ColorMatrix3x3, "Bradford");
  const toSrgb = multiplyMatrices(multiplyMatrices(xyzToSrgb, d50ToD65), M);
  const prophoto = rgbToXyzMatrices({ red: { x: 0.7347, y: 0.2653 }, green: { x: 0.1596, y: 0.8404 }, blue: { x: 0.0366, y: 0.0001 } }, { x: 0.3457, y: 0.3585 });
  const toProphoto = multiplyMatrices(prophoto.xyzToRgb, M), prophotoToSrgb = multiplyMatrices(multiplyMatrices(xyzToSrgb, d50ToD65), prophoto.rgbToXyz);
  const srgbToProphoto = invertMatrix3x3(prophotoToSrgb, "ProPhoto to sRGB");
  const baseline = options.baselineExposure === false ? 0 : raw.baselineExposure ?? 0, scale = 2 ** (baseline + push);

  // Output region (stage coordinates) and orientation.
  const dc = raw.defaultCrop, rx0 = crop === "default" ? Math.max(0, Math.round(dc.x)) : 0, ry0 = crop === "default" ? Math.max(0, Math.round(dc.y)) : 0;
  const rw = crop === "default" ? Math.min(W - rx0, Math.round(dc.width)) : W, rh = crop === "default" ? Math.min(H - ry0, Math.round(dc.height)) : H;
  if (!(rw > 0 && rh > 0)) throw new InvalidScientificInputError("developDngImage: the default crop lies outside the image.");
  const linear = new Float32Array(rw * rh * 3);
  let clipped = 0;
  const usePgtm = raw.profileGainTableMap !== null && (options.opcodes ?? true), useTables = raw.rgbTables !== null && (options.opcodes ?? true);
  const work = usePgtm ? toProphoto : toSrgb;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = 3 * ((ry0 + y) * W + rx0 + x), c: ColorVector3 = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
    let any = false;
    const b = [0, 1, 2].map((k) => { const v = P[k]![0] * c[0] + P[k]![1] * c[1] + P[k]![2] * c[2]; if (v > 1) { any = true; return 1; } return v; });
    if (any) clipped++;
    const o = 3 * (y * rw + x);
    for (let k = 0; k < 3; k++) linear[o + k] = work[k]![0] * b[0]! + work[k]![1] * b[1]! + work[k]![2] * b[2]!;
  }
  if (usePgtm) {
    applyDngProfileGainTableMap({ image: { width: rw, height: rh, data: linear }, map: raw.profileGainTableMap!, baselineExposureStops: baseline,
      region: { x: rx0, y: ry0, stageWidth: W, stageHeight: H }, overrange: true });
    for (let p = 0; p < rw * rh; p++) {
      const r = linear[3 * p]!, g = linear[3 * p + 1]!, bl = linear[3 * p + 2]!;
      for (let k = 0; k < 3; k++) linear[3 * p + k] = prophotoToSrgb[k]![0] * r + prophotoToSrgb[k]![1] * g + prophotoToSrgb[k]![2] * bl;
    }
    notes.push("developDngImage.profileGainTableMap: applied in linear ProPhoto (D50) before BaselineExposure.");
  }
  const profile = { gamutHandling } as SdrRenderingProfile, maximum = format === "srgb-8" ? 255 : 65535;
  const codes = format === "srgb-8" ? new Uint8Array(rw * rh * 3) : new Uint16Array(rw * rh * 3), scratch = new Float64Array(3);
  const counts: SdrPixelCounts = { negative: 0, above: 0, changed: 0, low: 0, high: 0, outOfGamut: false };
  if (useTables) {
    // RGBTables act on ProPhoto RGB after the tone curve (DNG SDK order): tone here, then the tables, then the encoding alone.
    for (let p = 0; p < rw * rh; p++) {
      tone(linear[3 * p]! * scale, linear[3 * p + 1]! * scale, linear[3 * p + 2]! * scale, scratch);
      for (let k = 0; k < 3; k++) linear[3 * p + k] = Math.min(1, Math.max(0, srgbToProphoto[k]![0] * scratch[0]! + srgbToProphoto[k]![1] * scratch[1]! + srgbToProphoto[k]![2] * scratch[2]!));
    }
    notes.push(...applyDngRgbTables({ image: { width: rw, height: rh, data: linear }, tables: raw.rgbTables!, masks: raw.semanticMasks }));
    for (let p = 0; p < rw * rh; p++) {
      const r = linear[3 * p]!, g = linear[3 * p + 1]!, bl = linear[3 * p + 2]!;
      for (let k = 0; k < 3; k++) linear[3 * p + k] = prophotoToSrgb[k]![0] * r + prophotoToSrgb[k]![1] * g + prophotoToSrgb[k]![2] * bl;
    }
    renderSdrRunInto(linear, 0, rw * rh, profile, prepareSdrPixelTone({ toneCurve: "identity" }), 1, maximum, codes, 0, scratch, counts);
    notes.push("developDngImage.rgbTables: applied in ProPhoto after the tone curve.");
  } else renderSdrRunInto(linear, 0, rw * rh, profile, tone, scale, maximum, codes, 0, scratch, counts);
  if (counts.outOfGamut) throw new InvalidScientificInputError("developDngImage: a pixel is out of range and gamutHandling is \"reject-out-of-range\".");

  // 5. Orientation.
  const o = options.orientation === false ? 1 : raw.orientation, swap = o >= 5;
  const ow = swap ? rh : rw, oh = swap ? rw : rh;
  let samples = codes;
  if (o !== 1) {
    samples = format === "srgb-8" ? new Uint8Array(codes.length) : new Uint16Array(codes.length);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const [u, v] = orient(o, x, y, rw, rh), from = 3 * (y * rw + x), to = 3 * (v * ow + u);
      samples[to] = codes[from]!; samples[to + 1] = codes[from + 1]!; samples[to + 2] = codes[from + 2]!;
    }
  }
  if (raw.lossySource) notes.push("developDngImage.source: the raw data is lossy.");
  if (raw.assumptions.some((a) => a.startsWith("dngImport.notApplied: ProfileToneCurve") || a.startsWith("dngImport.notApplied: ProfileHueSatMap") || a.startsWith("dngImport.notApplied: ProfileLookTable")))
    notes.push("developDngImage.profile: the file's profile tone curve and hue/saturation or look tables are not applied; the engine's tone curve is used.");
  return {
    width: ow, height: oh, format, samples,
    whiteBalance: { source, cameraNeutral: [neutral[0], neutral[1], neutral[2]], chromaticity: { x: xy.x, y: xy.y }, correlatedColorTemperatureKelvin: cctOf(xy) },
    cameraToXyzD50: flat(M), exposure: { baselineExposureStops: baseline, pushStops: push, label: push > 0 ? "Brightened in editing by " + push + " stops (same noise, not a longer exposure)." : push < 0 ? "Darkened in editing by " + -push + " stops." : null },
    demosaic, fast: { requested: fast, defaultedFrom: options.fast === undefined ? "format" : "request" }, clippedPixelCount: clipped, assumptions: notes
  };
}
