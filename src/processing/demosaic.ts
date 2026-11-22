// SPDX-License-Identifier: Apache-2.0

/**
 * Demosaicing: rebuilds full colour from a CFA (colour filter array) mosaic. Works on a linear mosaic
 * plane stored in typed arrays, for example black-subtracted normalized RAW values or a merged HDR
 * mosaic.
 * - `createCfaPlaneReconstructionTask` runs explicit linear kernels, one per CFA phase. It uses the
 *   existing `explicit-linear-native-neighborhood` contract, including the built-in bilinear
 *   factory. Borders either reject or mirror (reflect-101). The summation order is
 *   the same as `calculateRawReconstructionChannel`, so values match the reference resolver exactly
 *   before float32 storage.
 * - `createAhdDemosaicTask` is a separate, non-linear, adaptive method: adaptive
 *   homogeneity-directed (AHD) demosaicing after Hirakawa & Parks (2005). It never claims to be a
 *   linear kernel.
 * @see docs/PROCESSING.md for equations, sources and approximation status.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { parseMatrix3x3, type ColorMatrix3x3 } from "../color/colorimetry-math.js";
import { resolveRgbColorSpace } from "../color/rgb-color-spaces.js";
import { parseSensorColorSamplingProfile, type SensorColorSamplingProfile } from "../sensor/color-sampling.js";
import { rawReconstructionKernelReach, validateMirrorBorderCfaConsistency, type RawReconstructionBorderHandling } from "../sensor/raw-reconstruction.js";
import { parseRawReconstructionPhaseProfiles, type RawFrameReconstructionPhaseProfile } from "../capture/raw-frame-reconstruction.js";
import { reflect } from "./image-ops.js";
import {
  createProcessingTask, finiteRows, maximumWorkingBytes, processingProvenance, requireEnum, requireIntegerIn, requireOptions,
  PROCESSING_MAX_PIXELS, type ProcessingBody, type ProcessingProvenance, type ProcessingProvider, type ProcessingRgbImage, type ProcessingTask
} from "./processing-task.js";

/** A single-channel linear CFA mosaic in absolute native site coordinates (row-major, +Y down). */
export interface CfaMosaicPlane {
  width: number;
  height: number;
  captureModeId: string;
  /** Periodic mosaic anchored at site (0, 0) of this plane. */
  colorSamplingProfile: SensorColorSamplingProfile;
  /** Linear values, e.g. black-subtracted normalized RAW or merged HDR radiance. */
  samples: Float32Array;
}

export interface CfaPlaneReconstructionInput {
  plane: CfaMosaicPlane;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
  /** Default `reject`: every neighbourhood must lie inside the plane. */
  borderHandling?: RawReconstructionBorderHandling;
  /** Output region in plane coordinates; default the whole plane. */
  region?: { x: number; y: number; width: number; height: number };
  maximumWorkingBytes?: number;
}

export interface CfaPlaneReconstructionOutput {
  width: number;
  height: number;
  region: { x: number; y: number; width: number; height: number };
  channelIds: readonly string[];
  /** Interleaved `channelIds.length` channels, row-major over the region. */
  data: Float32Array;
  borderHandling: RawReconstructionBorderHandling;
  provenance: ProcessingProvenance;
}

interface ParsedPlane { width: number; height: number; cfa: SensorColorSamplingProfile; rw: number; rh: number; ids: readonly string[]; samples: Float32Array; modeId: string }

function parsePlane(value: unknown, label: string): ParsedPlane {
  const r = requireOptions(value, ["width", "height", "captureModeId", "colorSamplingProfile", "samples"], label);
  const width = requireIntegerIn(r.width, label + ".width", 1, PROCESSING_MAX_PIXELS), height = requireIntegerIn(r.height, label + ".height", 1, PROCESSING_MAX_PIXELS);
  if (width * height > PROCESSING_MAX_PIXELS) throw new InvalidConfigurationError(label + " exceeds " + PROCESSING_MAX_PIXELS + " sites.");
  if (typeof r.captureModeId !== "string" || r.captureModeId.length === 0) throw new InvalidConfigurationError(label + ".captureModeId must be a non-empty string.");
  const cfa = parseSensorColorSamplingProfile(r.colorSamplingProfile), layout = cfa.layout;
  if (layout.kind !== "periodic-mosaic") throw new InvalidConfigurationError(label + " requires a periodic mosaic colour-sampling profile.");
  if (!(r.samples instanceof Float32Array) || r.samples.length !== width * height) throw new InvalidConfigurationError(label + ".samples must be a Float32Array of width·height values.");
  return { width, height, cfa, rw: layout.repeatWidthSites, rh: layout.repeatHeightSites, ids: layout.siteChannelIds, samples: r.samples, modeId: r.captureModeId };
}

/**
 * Runs explicit linear reconstruction kernels, one per CFA phase, over a typed CFA plane.
 * - With `mirror` borders, a site outside the plane is read from its mirrored (reflect-101) position.
 *   This is accepted only if the mirrored site has the same CFA channel, which is always true for a
 *   2×2 Bayer pattern.
 * - With `reject`, out-of-plane reads throw (fail closed), like the reference resolver.
 * Values are linear and signed. No clamping, white balance or colour transform is applied.
 */
export function createCfaPlaneReconstructionTask(input: CfaPlaneReconstructionInput, provider: ProcessingProvider): ProcessingTask<CfaPlaneReconstructionOutput> {
  const r = requireOptions(input, ["plane", "phaseProfiles", "borderHandling", "region", "maximumWorkingBytes"], "createCfaPlaneReconstructionTask input");
  const p = parsePlane(r.plane, "plane"), border = requireEnum(r.borderHandling, ["reject", "mirror"] as const, "borderHandling", "reject");
  const phases = parseRawReconstructionPhaseProfiles(r.phaseProfiles, p.modeId, p.cfa);
  const reg = r.region === undefined ? { x: 0, y: 0, width: p.width, height: p.height } : ((): { x: number; y: number; width: number; height: number } => {
    const g = requireOptions(r.region, ["x", "y", "width", "height"], "region");
    return { x: requireIntegerIn(g.x, "region.x", 0, p.width - 1), y: requireIntegerIn(g.y, "region.y", 0, p.height - 1),
      width: requireIntegerIn(g.width, "region.width", 1, p.width), height: requireIntegerIn(g.height, "region.height", 1, p.height) };
  })();
  if (reg.x + reg.width > p.width || reg.y + reg.height > p.height) throw new InvalidConfigurationError("region must lie inside the plane.");
  const reach = rawReconstructionKernelReach(phases), channels = phases[0]!.profile.kernels.length;
  // Kernel source channels must match the periodic CFA at every (virtual) contribution site.
  for (const phase of phases) for (const k of phase.profile.kernels) for (const c of k.contributions) {
    const x = phase.phaseX + c.offsetX, y = phase.phaseY + c.offsetY;
    if (p.ids[((y % p.rh) + p.rh) % p.rh * p.rw + ((x % p.rw) + p.rw) % p.rw] !== c.sourceChannelId) {
      throw new InvalidConfigurationError("Reconstruction source channel disagrees with absolute CFA phase.");
    }
  }
  if (border === "mirror") validateMirrorBorderCfaConsistency({ repeatWidthSites: p.rw, repeatHeightSites: p.rh, siteChannelIds: p.ids }, p.width, p.height, reach);
  else {
    // Exact check of the pixels within `reach` of a plane edge; only their phases' offsets matter.
    const near = (x: number, y: number): boolean => x < reach || y < reach || x + reach >= p.width || y + reach >= p.height;
    for (let y = reg.y; y < reg.y + reg.height; y++) for (let x = reg.x; x < reg.x + reg.width; x++) {
      if (!near(x, y)) { x = Math.max(x, p.width - reach - 1); continue; }
      for (const k of phases[(y % p.rh) * p.rw + x % p.rw]!.profile.kernels) for (const c of k.contributions) {
        if (x + c.offsetX < 0 || y + c.offsetY < 0 || x + c.offsetX >= p.width || y + c.offsetY >= p.height) {
          throw new InvalidConfigurationError("Reconstruction neighbourhood leaves the plane; use a smaller region or mirror border handling.");
        }
      }
    }
  }
  const flat = phases.map((phase) => phase.profile.kernels.map((k) => ({
    dx: Int32Array.from(k.contributions, (c) => c.offsetX), dy: Int32Array.from(k.contributions, (c) => c.offsetY),
    delta: Int32Array.from(k.contributions, (c) => c.offsetY * p.width + c.offsetX), w: Float64Array.from(k.contributions, (c) => c.weight) })));
  const outBytes = reg.width * reg.height * channels * 4;
  return createProcessingTask({
    provider, totalTileCount: p.height + reg.height, estimatedWorkingBytes: outBytes, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<CfaPlaneReconstructionOutput> {
      yield* finiteRows(p.samples, p.width, p.height, 1, "plane");
      const out = new Float32Array(reg.width * reg.height * channels), s = p.samples, w = p.width;
      for (let y = reg.y, o = 0; y < reg.y + reg.height; y++) {
        for (let x = reg.x; x < reg.x + reg.width; x++) {
          const kernels = flat[(y % p.rh) * p.rw + x % p.rw]!, centre = y * w + x;
          const interior = x >= reach && y >= reach && x + reach < w && y + reach < p.height;
          for (const k of kernels) {
            let v = 0;
            if (interior) for (let j = 0; j < k.w.length; j++) v += s[centre + k.delta[j]!]! * k.w[j]!;
            else for (let j = 0; j < k.w.length; j++) v += s[reflect(y + k.dy[j]!, p.height) * w + reflect(x + k.dx[j]!, w)]! * k.w[j]!;
            out[o++] = v;
          }
        }
        yield;
      }
      return { width: reg.width, height: reg.height, region: reg, channelIds: phases[0]!.profile.kernels.map((k) => k.outputChannelId), data: out,
        borderHandling: border, provenance: processingProvenance("cfa-plane-linear-reconstruction", [
          "Explicit per-phase linear kernels, summed in declared contribution order; values are linear, signed and unclamped.",
          border === "mirror" ? "Sites outside the plane are read at their reflect-101 mirror image, which keeps the CFA channel." :
            "Every neighbourhood lies inside the plane; no padding or renormalization.",
          "No white balance, colour transform, sharpening or denoising."]) };
    }
  });
}

// ------------------------------------------------------------------ AHD

export interface AhdDemosaicInput {
  plane: CfaMosaicPlane;
  /** CFA channel ids of the red, green and blue sites; output order is red, green, blue. */
  channelRoles: { red: string; green: string; blue: string };
  /**
   * Camera-linear RGB → CIE XYZ, used only for the homogeneity metric (in CIELAB). Default: the
   * sRGB/D65 matrix, so the plane is treated as linear sRGB for the metric. Output values are never
   * transformed.
   */
  cameraToXyz?: ColorMatrix3x3;
  maximumWorkingBytes?: number;
}

export interface AhdDemosaicOutput extends ProcessingRgbImage {
  /** Per pixel: 0 horizontal, 1 vertical, 2 equal homogeneity (average of both). */
  direction: Uint8Array;
  provenance: ProcessingProvenance;
}

/**
 * Adaptive homogeneity-directed (AHD) demosaicing after Hirakawa & Parks, IEEE TIP 14(3), 2005:
 * 1. green is interpolated separately along rows and columns with the 5-tap directional filter
 *    [−1/4, 1/2, 1/2, 1/2, −1/4] (bilinear green plus the own-channel second difference);
 * 2. red and blue are filled from bilinearly interpolated colour differences (R−G, B−G) against each
 *    directional green, giving two full-colour candidates;
 * 3. both candidates are converted to CIELAB. At each pixel, the homogeneity is the number of
 *    4-neighbours within adaptive luminance and chrominance tolerances ε_L, ε_C. Each tolerance is the
 *    smaller of the two directions' largest differences along their own direction;
 * 4. homogeneity is summed over 3×3, and the more homogeneous candidate is chosen (a tie averages
 *    both).
 * The paper's optional iterative median step for reducing artifacts is not applied. Mirrored
 * (reflect-101) borders keep each site's Bayer channel. The method is non-linear: the output is not a
 * linear function of the mosaic.
 */
export function createAhdDemosaicTask(input: AhdDemosaicInput, provider: ProcessingProvider): ProcessingTask<AhdDemosaicOutput> {
  const r = requireOptions(input, ["plane", "channelRoles", "cameraToXyz", "maximumWorkingBytes"], "createAhdDemosaicTask input");
  const p = parsePlane(r.plane, "plane");
  const roles = requireOptions(r.channelRoles, ["red", "green", "blue"], "channelRoles");
  const ids = [roles.red, roles.green, roles.blue];
  if (ids.some((id) => typeof id !== "string") || new Set(ids).size !== 3) throw new InvalidConfigurationError("channelRoles must name three distinct channels.");
  if (p.rw !== 2 || p.rh !== 2) throw new InvalidScientificInputError("AHD requires a 2×2 Bayer mosaic.");
  const tile = p.ids.map((id) => ids.indexOf(id));
  const bayer = (g: readonly number[], c: readonly number[]): boolean => tile[g[0]!] === 1 && tile[g[1]!] === 1 && tile[c[0]!]! + tile[c[1]!]! === 2 && tile[c[0]!] !== 1;
  if (!bayer([0, 3], [1, 2]) && !bayer([1, 2], [0, 3])) {
    throw new InvalidScientificInputError("AHD requires one red, one blue and two diagonal green sites.");
  }
  if (p.width < 3 || p.height < 3) throw new InvalidScientificInputError("AHD requires at least a 3×3 mosaic.");
  const m = r.cameraToXyz === undefined ? resolveRgbColorSpace("srgb").value.rgbToXyz : parseMatrix3x3(r.cameraToXyz, "cameraToXyz");
  const white = [0, 1, 2].map((i) => m[i]![0] + m[i]![1] + m[i]![2]);
  if (white.some((v) => !(v > 0))) throw new InvalidScientificInputError("cameraToXyz must map camera white (1,1,1) to positive XYZ.");
  const n = p.width * p.height;
  const bytes = n * (4 * 2 + 4 * 3 * 2 + 4 * 3 * 2 + 2 + 3 * 4 + 1);
  return createProcessingTask({
    provider, totalTileCount: 6 * p.height, estimatedWorkingBytes: bytes, maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<AhdDemosaicOutput> {
      yield* finiteRows(p.samples, p.width, p.height, 1, "plane");
      const W = p.width, H = p.height, s = p.samples;
      const roleAt = (x: number, y: number): number => tile[(y & 1) * 2 + (x & 1)]!;
      const at = (x: number, y: number): number => s[reflect(y, H) * W + reflect(x, W)]!;
      // Sites whose neighbourhood lies inside the plane (two sites from the edge for stage 1, one for stages 2, 4
      // and 5) read their neighbours by direct index offsets; reflect() returns its argument there, so they address
      // the same samples as the border path. Every floating-point expression keeps the operands, order and grouping
      // of the border path, so both paths give bit-identical results (test/processing-ahd-exactness.test.ts).
      // 1. Directional greens.
      const gh = new Float32Array(n), gv = new Float32Array(n);
      for (let y = 0; y < H; y++) {
        const interiorRow = y >= 2 && y + 2 < H;
        for (let x = 0; x < W; x++) {
          const i = y * W + x, c = s[i]!;
          if (roleAt(x, y) === 1) { gh[i] = c; gv[i] = c; continue; }
          if (interiorRow && x >= 2 && x + 2 < W) {
            gh[i] = (s[i - 1]! + s[i + 1]!) / 2 + (2 * c - s[i - 2]! - s[i + 2]!) / 4;
            gv[i] = (s[i - W]! + s[i + W]!) / 2 + (2 * c - s[i - 2 * W]! - s[i + 2 * W]!) / 4;
          } else {
            gh[i] = (at(x - 1, y) + at(x + 1, y)) / 2 + (2 * c - at(x - 2, y) - at(x + 2, y)) / 4;
            gv[i] = (at(x, y - 1) + at(x, y + 1)) / 2 + (2 * c - at(x, y - 2) - at(x, y + 2)) / 4;
          }
        }
        yield;
      }
      // 2. Two full-colour candidates from colour differences.
      const rgb = [new Float32Array(3 * n), new Float32Array(3 * n)], greens = [gh, gv];
      for (let y = 0; y < H; y++) {
        const interiorRow = y >= 1 && y + 1 < H;
        for (let x = 0; x < W; x++) {
          const i = y * W + x, own = roleAt(x, y), interior = interiorRow && x >= 1 && x + 1 < W;
          for (let d = 0; d < 2; d++) {
            const g = greens[d]!, out = rgb[d]!, gi = g[i]!;
            out[3 * i + 1] = gi;
            if (own === 1) {
              const hRole = roleAt(x + 1, y), vRole = 2 - hRole;
              if (interior) {
                out[3 * i + hRole] = gi + ((s[i - 1]! - g[i - 1]!) + (s[i + 1]! - g[i + 1]!)) / 2;
                out[3 * i + vRole] = gi + ((s[i - W]! - g[i - W]!) + (s[i + W]! - g[i + W]!)) / 2;
              } else {
                let j = reflect(y, H) * W + reflect(x - 1, W); const a = s[j]! - g[j]!;
                j = reflect(y, H) * W + reflect(x + 1, W); const b = s[j]! - g[j]!;
                out[3 * i + hRole] = gi + (a + b) / 2;
                j = reflect(y - 1, H) * W + reflect(x, W); const cc = s[j]! - g[j]!;
                j = reflect(y + 1, H) * W + reflect(x, W); const dd = s[j]! - g[j]!;
                out[3 * i + vRole] = gi + (cc + dd) / 2;
              }
            } else {
              out[3 * i + own] = s[i]!;
              if (interior) {
                out[3 * i + 2 - own] = gi + ((s[i - W - 1]! - g[i - W - 1]!) + (s[i - W + 1]! - g[i - W + 1]!) + (s[i + W - 1]! - g[i + W - 1]!) + (s[i + W + 1]! - g[i + W + 1]!)) / 4;
              } else {
                const ym = reflect(y - 1, H) * W, yp = reflect(y + 1, H) * W, xm = reflect(x - 1, W), xp = reflect(x + 1, W);
                out[3 * i + 2 - own] = gi + ((s[ym + xm]! - g[ym + xm]!) + (s[ym + xp]! - g[ym + xp]!) + (s[yp + xm]! - g[yp + xm]!) + (s[yp + xp]! - g[yp + xp]!)) / 4;
              }
            }
          }
        }
        yield;
      }
      // 3. CIELAB (W3C CSS Color 4 Lab definition; also CIE 15) of both candidates.
      const lab = [new Float32Array(3 * n), new Float32Array(3 * n)];
      const f = (t: number): number => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
      const m00 = m[0][0], m01 = m[0][1], m02 = m[0][2], m10 = m[1][0], m11 = m[1][1], m12 = m[1][2], m20 = m[2][0], m21 = m[2][1], m22 = m[2][2];
      const w0 = white[0]!, w1 = white[1]!, w2 = white[2]!;
      for (let y = 0; y < H; y++) {
        for (let i = y * W; i < (y + 1) * W; i++) for (let d = 0; d < 2; d++) {
          const c = rgb[d]!, R = c[3 * i]!, G = c[3 * i + 1]!, B = c[3 * i + 2]!;
          const fx = f((m00 * R + m01 * G + m02 * B) / w0), fy = f((m10 * R + m11 * G + m12 * B) / w1);
          const fz = f((m20 * R + m21 * G + m22 * B) / w2), o = lab[d]!;
          o[3 * i] = 116 * fy - 16; o[3 * i + 1] = 500 * (fx - fy); o[3 * i + 2] = 200 * (fy - fz);
        }
        yield;
      }
      // 4. Homogeneity maps with adaptive tolerances.
      const homo = [new Uint8Array(n), new Uint8Array(n)], lab0 = lab[0]!, lab1 = lab[1]!;
      for (let y = 0; y < H; y++) {
        const interiorRow = y >= 1 && y + 1 < H;
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          let jl: number, jr: number, ju: number, jd: number;
          if (interiorRow && x >= 1 && x + 1 < W) { jl = i - 1; jr = i + 1; ju = i - W; jd = i + W; }
          else { const row = reflect(y, H) * W, col = reflect(x, W); jl = row + reflect(x - 1, W); jr = row + reflect(x + 1, W); ju = reflect(y - 1, H) * W + col; jd = reflect(y + 1, H) * W + col; }
          // Direction 0 (lab0), neighbours left, right, up, down (the N4 order).
          const L0 = lab0[3 * i]!, a0 = lab0[3 * i + 1]!, b0 = lab0[3 * i + 2]!;
          const dL00 = Math.abs(L0 - lab0[3 * jl]!), dC00 = (a0 - lab0[3 * jl + 1]!) ** 2 + (b0 - lab0[3 * jl + 2]!) ** 2;
          const dL01 = Math.abs(L0 - lab0[3 * jr]!), dC01 = (a0 - lab0[3 * jr + 1]!) ** 2 + (b0 - lab0[3 * jr + 2]!) ** 2;
          const dL02 = Math.abs(L0 - lab0[3 * ju]!), dC02 = (a0 - lab0[3 * ju + 1]!) ** 2 + (b0 - lab0[3 * ju + 2]!) ** 2;
          const dL03 = Math.abs(L0 - lab0[3 * jd]!), dC03 = (a0 - lab0[3 * jd + 1]!) ** 2 + (b0 - lab0[3 * jd + 2]!) ** 2;
          const L1 = lab1[3 * i]!, a1 = lab1[3 * i + 1]!, b1 = lab1[3 * i + 2]!;
          const dL10 = Math.abs(L1 - lab1[3 * jl]!), dC10 = (a1 - lab1[3 * jl + 1]!) ** 2 + (b1 - lab1[3 * jl + 2]!) ** 2;
          const dL11 = Math.abs(L1 - lab1[3 * jr]!), dC11 = (a1 - lab1[3 * jr + 1]!) ** 2 + (b1 - lab1[3 * jr + 2]!) ** 2;
          const dL12 = Math.abs(L1 - lab1[3 * ju]!), dC12 = (a1 - lab1[3 * ju + 1]!) ** 2 + (b1 - lab1[3 * ju + 2]!) ** 2;
          const dL13 = Math.abs(L1 - lab1[3 * jd]!), dC13 = (a1 - lab1[3 * jd + 1]!) ** 2 + (b1 - lab1[3 * jd + 2]!) ** 2;
          const epsL = Math.min(Math.max(dL00, dL01), Math.max(dL12, dL13));
          const epsC = Math.min(Math.max(dC00, dC01), Math.max(dC12, dC13));
          let count = 0;
          if (dL00 <= epsL && dC00 <= epsC) count++; if (dL01 <= epsL && dC01 <= epsC) count++; if (dL02 <= epsL && dC02 <= epsC) count++; if (dL03 <= epsL && dC03 <= epsC) count++;
          homo[0]![i] = count;
          count = 0;
          if (dL10 <= epsL && dC10 <= epsC) count++; if (dL11 <= epsL && dC11 <= epsC) count++; if (dL12 <= epsL && dC12 <= epsC) count++; if (dL13 <= epsL && dC13 <= epsC) count++;
          homo[1]![i] = count;
        }
        yield;
      }
      // 5. 3×3 summed homogeneity selects the candidate.
      const out = new Float32Array(3 * n), direction = new Uint8Array(n), h0 = homo[0]!, h1 = homo[1]!, rgb0 = rgb[0]!, rgb1 = rgb[1]!;
      for (let y = 0; y < H; y++) {
        const interiorRow = y >= 1 && y + 1 < H;
        for (let x = 0; x < W; x++) {
          let sh = 0, sv = 0;
          const i = y * W + x;
          if (interiorRow && x >= 1 && x + 1 < W) {
            for (let dy = -1; dy <= 1; dy++) { const row = i + dy * W; for (let dx = -1; dx <= 1; dx++) { const j = row + dx; sh += h0[j]!; sv += h1[j]!; } }
          } else {
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const j = reflect(y + dy, H) * W + reflect(x + dx, W);
              sh += h0[j]!; sv += h1[j]!;
            }
          }
          const dir = sh > sv ? 0 : sv > sh ? 1 : 2;
          direction[i] = dir;
          for (let c = 0; c < 3; c++) {
            const a = rgb0[3 * i + c]!, b = rgb1[3 * i + c]!;
            out[3 * i + c] = dir === 0 ? a : dir === 1 ? b : (a + b) / 2;
          }
        }
        yield;
      }
      return { width: W, height: H, data: out, direction, provenance: processingProvenance("ahd-demosaic-hirakawa-parks-2005", [
        "Directional green, 5-tap filter [-1/4, 1/2, 1/2, 1/2, -1/4]; red/blue from bilinear colour differences.",
        "CIELAB homogeneity (declared camera-to-XYZ matrix), 4-neighbourhood summed over 3x3; ties average.",
        "No iterative median artifact reduction.",
        "Not a calibrated or manufacturer demosaic."]) };
    }
  });
}
