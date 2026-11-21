// SPDX-License-Identifier: Apache-2.0

/**
 * Panorama stitching from known camera rotations. There is no feature matching.
 *
 * The reference frame is the camera frame at zero rotation (+X right, +Y up, +Z forward: the engine's
 * camera axes). Each frame's rotation uses the engine's physical pitch/yaw/roll right-hand convention
 * (`applyPhysicalCameraRotation`, one axis-angle vector, camera → reference).
 *
 * Projection: a canvas pixel's direction is
 *   equirectangular: d = (cos φ sin θ, sin φ, cos φ cos θ),
 *   cylindrical:     d ∝ (sin θ, h, cos θ) with h = tan φ linear in rows,
 * with θ (longitude) increasing to the right and φ upward (Szeliski 2006, §2–3). The direction is
 * projected into each frame rectilinearly, x = c_x + f·c_x'/c_z', y = c_y − f·c_y'/c_z' (raster +Y
 * down, pixel centres at i + 0.5), and sampled bilinearly. Frames are assumed to be pure rotations (no
 * parallax) with no distortion.
 *
 * Exposure compensation uses Brown & Lowe (IJCV 2007) gain compensation: minimize
 *   Σ_{i<j} N_ij [(g_i Ī_ij − g_j Ī_ji)²/σ_N² + ((1 − g_i)² + (1 − g_j)²)/(2σ_g²)]
 *   (the paper's ½ΣΣ over ordered pairs)
 * over the gains g (a linear system). Ī_ij is the mean intensity of frame i where it overlaps frame j,
 * normalized by the mean of all overlap means.
 *
 * Blending is one of:
 * - feathered: weights fall linearly from the frame centre to its edges (Brown & Lowe 2007);
 * - multi-band (Burt & Adelson 1983b): Laplacian pyramids of each warped frame are blended with
 *   Gaussian pyramids of its binary max-weight mask. Each frame's Gaussian levels are divided by those
 *   of its coverage mask (normalized convolution, Knutsson & Westin 1993), so the zero fill outside a
 *   frame does not darken the blend.
 * @see docs/PROCESSING.md for equations, sources and limits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { applyPhysicalCameraRotation } from "../motion/camera-rotation.js";
import {
  autoLevels, collapse, collapseRows, expand, gaussianPyramid, gaussianPyramidRows, pyramidBytes
} from "./image-ops.js";
import {
  createProcessingTask, finiteRows, maximumWorkingBytes, optionalFiniteIn, optionalIntegerIn, processingProvenance, requireEnum, requireFiniteIn,
  requireImage, requireIntegerIn, requireOptions, PROCESSING_MAX_FRAMES, PROCESSING_MAX_PIXELS,
  type ProcessingBody, type ProcessingProvenance, type ProcessingProvider, type ProcessingRgbImage, type ProcessingTask
} from "./processing-task.js";

export interface PanoramaFrame {
  image: ProcessingRgbImage;
  /** Rectilinear focal length in pixels (same pixel pitch on both axes). */
  focalLengthPixels: number;
  /** Principal point in pixel coordinates (pixel centres at i + 0.5); default the image centre. */
  principalPointPixels?: { x: number; y: number };
  /** Camera rotation relative to the reference camera: pitch/yaw/roll radians, engine sign convention. */
  rotationRad: { pitch: number; yaw: number; roll: number };
}

export interface PanoramaCanvas {
  projection: "equirectangular" | "cylindrical";
  width: number;
  height: number;
  /** [min, max] longitude θ in radians across the canvas columns (left → right). */
  longitudeRangeRad: readonly [number, number];
  /** [min, max] latitude φ in radians (bottom → top); cylindrical rows are linear in tan φ. */
  latitudeRangeRad: readonly [number, number];
}

export interface PanoramaInput {
  frames: readonly PanoramaFrame[];
  canvas: PanoramaCanvas;
  /** Default `feather`. */
  blending?: "feather" | "multi-band";
  /** Default `gain` (Brown & Lowe 2007); `none` keeps frame intensities. */
  exposureCompensation?: "none" | "gain";
  /** Normalized intensity noise σ_N; default 0.04 (≈ 10/255, the published 8-bit value). */
  gainNoiseSigma?: number;
  /** Gain prior σ_g; default 0.1. */
  gainPriorSigma?: number;
  /** Multi-band pyramid levels; default min(4, auto). Coarse bands wider than the frame overlap mix
   * low frequencies that were normalized differently, so keep 2^(levels−1) well below the overlap width. */
  pyramidLevels?: number;
  maximumWorkingBytes?: number;
}

export interface PanoramaOutput extends ProcessingRgbImage {
  /** Number of frames covering each canvas pixel; 0 = uncovered (value 0). */
  coverage: Uint8Array;
  /** Gain applied to each frame (1 when compensation is off). */
  gains: readonly number[];
  provenance: ProcessingProvenance;
}

type M3 = [number, number, number, number, number, number, number, number, number];
interface Frame { image: ProcessingRgbImage; f: number; cx: number; cy: number; m: M3 }

/** Projects canvas pixel (u, v) of frame `fr`; returns image coords or null when outside its support. */
function project(fr: Frame, d: readonly [number, number, number]): [number, number, number] | null {
  const m = fr.m, x = m[0] * d[0] + m[1] * d[1] + m[2] * d[2], y = m[3] * d[0] + m[4] * d[1] + m[5] * d[2], z = m[6] * d[0] + m[7] * d[1] + m[8] * d[2];
  if (!(z > 0)) return null;
  const px = fr.cx + fr.f * x / z - 0.5, py = fr.cy - fr.f * y / z - 0.5, W = fr.image.width, H = fr.image.height;
  if (px < 0 || py < 0 || px > W - 1 || py > H - 1) return null;
  // Feather weight: linear in each axis from 1 at the centre to 0 at the outer pixel-centre ring.
  const wx = W > 1 ? 1 - Math.abs(2 * px / (W - 1) - 1) : 1, wy = H > 1 ? 1 - Math.abs(2 * py / (H - 1) - 1) : 1;
  return [px, py, Math.max(wx * wy, 1e-6)];
}

function bilinear(im: ProcessingRgbImage, px: number, py: number, out: Float64Array): void {
  const W = im.width, H = im.height, x0 = Math.min(Math.floor(px), W - 1), y0 = Math.min(Math.floor(py), H - 1);
  const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1), ax = px - x0, ay = py - y0, d = im.data;
  for (let c = 0; c < 3; c++) {
    out[c] = (1 - ay) * ((1 - ax) * d[3 * (y0 * W + x0) + c]! + ax * d[3 * (y0 * W + x1) + c]!) +
      ay * ((1 - ax) * d[3 * (y1 * W + x0) + c]! + ax * d[3 * (y1 * W + x1) + c]!);
  }
}

/** Stitches frames with known rotations onto a cylindrical or equirectangular canvas. */
export function createPanoramaTask(input: PanoramaInput, provider: ProcessingProvider): ProcessingTask<PanoramaOutput> {
  const r = requireOptions(input, ["frames", "canvas", "blending", "exposureCompensation", "gainNoiseSigma", "gainPriorSigma", "pyramidLevels",
    "maximumWorkingBytes"], "createPanoramaTask input");
  if (!Array.isArray(r.frames) || r.frames.length < 1 || r.frames.length > PROCESSING_MAX_FRAMES) {
    throw new InvalidConfigurationError("frames must contain 1 to " + PROCESSING_MAX_FRAMES + " frames.");
  }
  const frames: Frame[] = r.frames.map((value: unknown, i: number) => {
    const f = requireOptions(value, ["image", "focalLengthPixels", "principalPointPixels", "rotationRad"], "frames[" + i + "]");
    const image = requireImage(f.image, "frames[" + i + "].image");
    const pp = f.principalPointPixels === undefined ? { x: image.width / 2, y: image.height / 2 } : requireOptions(f.principalPointPixels, ["x", "y"], "principalPointPixels");
    const rot = requireOptions(f.rotationRad, ["pitch", "yaw", "roll"], "frames[" + i + "].rotationRad");
    const angles = { pitch: requireFiniteIn(rot.pitch, "pitch", -10, 10), yaw: requireFiniteIn(rot.yaw, "yaw", -10, 10), roll: requireFiniteIn(rot.roll, "roll", -10, 10) };
    // Reference → camera matrix from the engine rotation of the basis vectors.
    const cols = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const).map(([x, y, z]) => applyPhysicalCameraRotation({ x, y, z }, angles, "reference-to-camera"));
    const m: M3 = [cols[0]!.x, cols[1]!.x, cols[2]!.x, cols[0]!.y, cols[1]!.y, cols[2]!.y, cols[0]!.z, cols[1]!.z, cols[2]!.z];
    return { image, f: requireFiniteIn(f.focalLengthPixels, "focalLengthPixels", 0, 1e7, true), m,
      cx: requireFiniteIn(pp.x, "principalPointPixels.x", -1e7, 1e7), cy: requireFiniteIn(pp.y, "principalPointPixels.y", -1e7, 1e7) };
  });
  const c = requireOptions(r.canvas, ["projection", "width", "height", "longitudeRangeRad", "latitudeRangeRad"], "canvas");
  const projection = requireEnum(c.projection, ["equirectangular", "cylindrical"] as const, "canvas.projection");
  const W = requireIntegerIn(c.width, "canvas.width", 1, PROCESSING_MAX_PIXELS), H = requireIntegerIn(c.height, "canvas.height", 1, PROCESSING_MAX_PIXELS);
  if (W * H > PROCESSING_MAX_PIXELS) throw new InvalidConfigurationError("canvas exceeds " + PROCESSING_MAX_PIXELS + " pixels.");
  const range = (v: unknown, label: string, limit: number): [number, number] => {
    if (!Array.isArray(v) || v.length !== 2) throw new InvalidConfigurationError(label + " must be [min, max].");
    const a = requireFiniteIn(v[0], label + "[0]", -limit, limit), b = requireFiniteIn(v[1], label + "[1]", -limit, limit);
    if (!(b > a)) throw new InvalidScientificInputError(label + " must have max > min.");
    return [a, b];
  };
  const lon = range(c.longitudeRangeRad, "canvas.longitudeRangeRad", Math.PI), lat = range(c.latitudeRangeRad, "canvas.latitudeRangeRad", Math.PI / 2);
  if (projection === "cylindrical" && (lat[0] <= -Math.PI / 2 || lat[1] >= Math.PI / 2)) throw new InvalidScientificInputError("Cylindrical latitude must lie strictly inside (−π/2, π/2).");
  const blending = requireEnum(r.blending, ["feather", "multi-band"] as const, "blending", "feather");
  const compensation = requireEnum(r.exposureCompensation, ["none", "gain"] as const, "exposureCompensation", "gain");
  const sigmaN = optionalFiniteIn(r.gainNoiseSigma, 0.04, "gainNoiseSigma", 0, 1e6, true), sigmaG = optionalFiniteIn(r.gainPriorSigma, 0.1, "gainPriorSigma", 0, 1e6, true);
  const levels = optionalIntegerIn(r.pyramidLevels, autoLevels(W, H, 4), "pyramidLevels", 1, autoLevels(W, H, 32));
  const K = frames.length, n = W * H;
  const direction = (u: number, v: number): [number, number, number] => {
    const theta = lon[0] + (u + 0.5) / W * (lon[1] - lon[0]);
    if (projection === "equirectangular") {
      const phi = lat[1] - (v + 0.5) / H * (lat[1] - lat[0]);
      return [Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)];
    }
    const h = Math.tan(lat[1]) - (v + 0.5) / H * (Math.tan(lat[1]) - Math.tan(lat[0]));
    return [Math.sin(theta), h, Math.cos(theta)];
  };
  const frameRows = frames.reduce((s, f) => s + f.image.height, 0);
  const blendRows = blending === "feather" ? H : H + K * (H + 3 * gaussianPyramidRows(W, H, levels) + collapseRows(W, H, levels)) + collapseRows(W, H, levels);
  const bytes = n * (12 + 1) + (blending === "multi-band" ? n * (12 + 8 + 1) + 2 * pyramidBytes(W, H, 3, levels) + pyramidBytes(W, H, 1, levels) * 2 : 4 * n);
  return createProcessingTask({
    provider, totalTileCount: frameRows + (compensation === "gain" && K > 1 ? H : 0) + blendRows, estimatedWorkingBytes: bytes,
    maximumWorkingBytes: maximumWorkingBytes(r.maximumWorkingBytes),
    body: function* (): ProcessingBody<PanoramaOutput> {
      for (const [k, f] of frames.entries()) yield* finiteRows(f.image.data, f.image.width, f.image.height, 3, "frames[" + k + "].image");
      const sample = new Float64Array(3), gains = new Array<number>(K).fill(1);
      if (compensation === "gain" && K > 1) {
        const count = new Float64Array(K * K), sum = new Float64Array(K * K), hit: number[] = [], mean: number[] = [];
        for (let v = 0; v < H; v++) {
          for (let u = 0; u < W; u++) {
            const d = direction(u, v);
            hit.length = 0; mean.length = 0;
            for (let k = 0; k < K; k++) {
              const p = project(frames[k]!, d);
              if (p === null) continue;
              bilinear(frames[k]!.image, p[0], p[1], sample);
              hit.push(k); mean.push((sample[0]! + sample[1]! + sample[2]!) / 3);
            }
            for (let a = 0; a < hit.length; a++) for (let b = 0; b < hit.length; b++) if (a !== b) {
              count[hit[a]! * K + hit[b]!]! += 1; sum[hit[a]! * K + hit[b]!]! += mean[a]!;
            }
          }
          yield;
        }
        let norm = 0, pairs = 0;
        for (let i = 0; i < K * K; i++) if (count[i]! > 0) { norm += sum[i]! / count[i]!; pairs++; }
        norm = pairs > 0 && norm > 0 ? norm / pairs : 1;
        // Normal equations of the Brown–Lowe objective (each unordered pair counted once).
        const A = Array.from({ length: K }, () => new Float64Array(K)), rhs = new Float64Array(K);
        for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
          if (i === j || count[i * K + j]! === 0) continue;
          const N = count[i * K + j]!, Iij = sum[i * K + j]! / N / norm, Iji = sum[j * K + i]! / N / norm;
          A[i]![i]! += N * (Iij * Iij / (sigmaN * sigmaN) + 1 / (2 * sigmaG * sigmaG));
          A[i]![j]! -= N * Iij * Iji / (sigmaN * sigmaN);
          rhs[i]! += N / (2 * sigmaG * sigmaG);
        }
        for (let i = 0; i < K; i++) if (A[i]![i] === 0) { A[i]![i] = 1; rhs[i] = 1; }
        const g = solveLinear(A, rhs);
        for (let k = 0; k < K; k++) gains[k] = g[k]!;
      }
      const out = new Float32Array(3 * n), coverage = new Uint8Array(n);
      if (blending === "feather") {
        for (let v = 0; v < H; v++) {
          for (let u = 0; u < W; u++) {
            const d = direction(u, v), i = v * W + u;
            let wsum = 0, r0 = 0, g0 = 0, b0 = 0, covered = 0;
            for (let k = 0; k < K; k++) {
              const p = project(frames[k]!, d);
              if (p === null) continue;
              bilinear(frames[k]!.image, p[0], p[1], sample);
              const w = p[2] * gains[k]!;
              r0 += w * sample[0]!; g0 += w * sample[1]!; b0 += w * sample[2]!; wsum += p[2]; covered++;
            }
            coverage[i] = covered;
            if (wsum > 0) { out[3 * i] = r0 / wsum; out[3 * i + 1] = g0 / wsum; out[3 * i + 2] = b0 / wsum; }
          }
          yield;
        }
      } else {
        const best = new Float32Array(n), owner = new Uint8Array(n).fill(255), warped = new Float32Array(3 * n), mask = new Float32Array(n), valid = new Float32Array(n);
        for (let v = 0; v < H; v++) {
          for (let u = 0; u < W; u++) {
            const d = direction(u, v), i = v * W + u;
            for (let k = 0; k < K; k++) {
              const p = project(frames[k]!, d);
              if (p === null) continue;
              coverage[i]!++;
              if (p[2] > best[i]!) { best[i] = p[2]; owner[i] = k; }
            }
          }
          yield;
        }
        let acc: Float32Array[] | null = null, wacc: Float32Array[] | null = null, sizes: { width: number; height: number }[] = [];
        for (let k = 0; k < K; k++) {
          for (let v = 0; v < H; v++) {
            for (let u = 0; u < W; u++) {
              const i = v * W + u, p = owner[i] === 255 ? null : project(frames[k]!, direction(u, v));
              mask[i] = owner[i] === k ? 1 : 0; valid[i] = p === null ? 0 : 1;
              if (p === null) { warped[3 * i] = 0; warped[3 * i + 1] = 0; warped[3 * i + 2] = 0; continue; }
              bilinear(frames[k]!.image, p[0], p[1], sample);
              for (let c = 0; c < 3; c++) warped[3 * i + c] = gains[k]! * sample[c]!;
            }
            yield;
          }
          // Normalized convolution: Gaussian levels of the zero-filled frame divided by those of its coverage, so the
          // frame's own coverage edge never enters the blend as a dark halo; Laplacian levels follow from them.
          const lap = yield* gaussianPyramid(warped, W, H, 3, levels), cov = yield* gaussianPyramid(valid, W, H, 1, levels);
          for (let l = 0; l < levels; l++) {
            const g = lap.levels[l]!, c = cov.levels[l]!;
            for (let i = 0; i < c.length; i++) for (let ch = 0; ch < 3; ch++) g[3 * i + ch] = c[i]! > 1e-6 ? g[3 * i + ch]! / c[i]! : 0;
          }
          for (let l = 0; l < levels - 1; l++) {
            const a = lap.sizes[l]!, b = lap.sizes[l + 1]!;
            yield* expand(lap.levels[l + 1]!, b.width, b.height, a.width, a.height, 3, lap.levels[l]!, "subtract-from");
          }
          const gw = yield* gaussianPyramid(mask, W, H, 1, levels);
          sizes = lap.sizes;
          acc ??= sizes.map((s) => new Float32Array(s.width * s.height * 3));
          wacc ??= sizes.map((s) => new Float32Array(s.width * s.height));
          for (let l = 0; l < levels; l++) {
            const a = acc[l]!, wa = wacc[l]!, L = lap.levels[l]!, G = gw.levels[l]!;
            for (let i = 0; i < G.length; i++) { wa[i] = wa[i]! + G[i]!; for (let c = 0; c < 3; c++) a[3 * i + c] = a[3 * i + c]! + G[i]! * L[3 * i + c]!; }
          }
        }
        for (let l = 0; l < levels; l++) {
          const a = acc![l]!, wa = wacc![l]!;
          for (let i = 0; i < wa.length; i++) for (let c = 0; c < 3; c++) a[3 * i + c] = wa[i]! > 1e-9 ? a[3 * i + c]! / wa[i]! : 0;
        }
        const blended = yield* collapse({ levels: acc!, sizes, channels: 3 });
        for (let i = 0; i < n; i++) if (coverage[i] !== 0) for (let c = 0; c < 3; c++) out[3 * i + c] = blended[3 * i + c]!;
      }
      return { width: W, height: H, data: out, coverage, gains, provenance: processingProvenance("panorama-known-rotation-" + projection + "-" + blending, [
        "Canvas rays reprojected into each frame through the engine camera-rotation convention; rectilinear, distortion-free, pure rotation (no parallax).",
        "Bilinear resampling without prefiltering; downsampling canvases can alias.",
        compensation === "gain" ? "Brown & Lowe (2007) gain compensation with sigma_N=" + sigmaN + " (normalized intensity), sigma_g=" + sigmaG + "." : "No exposure compensation.",
        blending === "feather" ? "Feathered blending with centre-to-edge linear weights." : "Multi-band blending of binary max-weight masks (Burt & Adelson 1983)."]) };
    }
  });
}

/** Gaussian elimination with partial pivoting (small dense systems). */
function solveLinear(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length, M = A.map((row, i) => { const r = new Float64Array(n + 1); r.set(row); r[n] = b[i]!; return r; });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(M[i]![col]!) > Math.abs(M[pivot]![col]!)) pivot = i;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const p = M[col]![col]!;
    if (Math.abs(p) < 1e-300) throw new InvalidScientificInputError("Gain compensation system is singular.");
    for (let i = col + 1; i < n; i++) {
      const f = M[i]![col]! / p;
      for (let j = col; j <= n; j++) M[i]![j] = M[i]![j]! - f * M[col]![j]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x;
}
