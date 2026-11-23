// SPDX-License-Identifier: Apache-2.0
/**
 * #741's go/no-go reference: a catalogue lens's defocused wave PSF computed directly, on the site cells. Scalar Fraunhofer
 * diffraction of the uniform circular pupil D = f/N carrying the lens's Seidel wavefront (the expansion of
 * `optics/generic-lens-psf.ts`: balanced spherical aberration, coma, astigmatism, field curvature and the axial colour
 * W020 = W_ax·D(λ)) plus a surface's own defocus W020 in µm, propagated to the thin-lens image distance z (Goodman, Introduction
 * to Fourier Optics, ch. 4–6; Wyant and Creath 1992). The lateral colour displaces the PSF radially by L·R·H·D(λ), as in the
 * builder. The image is sampled at δ = λ·N_w/4 (twice the intensity's Nyquist rate) with a zero-padded radix-2 FFT large
 * enough for the defocused PSF and the window, and each sample's δ-interval is split between the site cells it overlaps.
 * Independent of the builder's code (its own FFT and cell sums), so it can check the builder's kernels too.
 */
import { genericLensDispersion } from "../../src/equipment/generic-lens-dispersion.js";
import type { ResolvedGenericLens } from "../../src/equipment/generic-lens-catalogue.js";

const DESIGN_WAVELENGTH_UM = 0.55;
const MAXIMUM_PHASE_STEP_WAVES = 0.35;
const MAXIMUM_TRANSFORM = 2048;

function fft(re: Float64Array, im: Float64Array, n: number, cos: Float64Array, sin: Float64Array): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < half; k++) {
      const c = cos[k * step]!, s = sin[k * step]!, a = start + k, b = a + half;
      const tr = re[b]! * c + im[b]! * s, ti = im[b]! * c - re[b]! * s;
      re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
    }
  }
}

export interface WaveCellPsfInput {
  lens: ResolvedGenericLens;
  focusDistanceM: number;
  pitchMicrometers: number;
  /** Field point, mm, +Y up. */
  fieldMm: { x: number; y: number };
  wavelengthNm: number;
  /** The surface's own defocus W020, µm (positive: the sign of the lens's W040, a surface behind the focus plane). */
  defocusMicrometers: number;
  /** Kernel window radius, sites. */
  radius: number;
  /** Default true: the lens's axial colour in the wavefront. */
  axialColor?: boolean;
}

/** The PSF's energy per site cell (rows with image +Y, (2R + 1)² taps), normalized by the whole period's energy, and the energy outside the window. */
export function waveCellPsf(input: WaveCellPsfInput): { kernel: Float64Array; outside: number; transform: number } {
  const { lens, pitchMicrometers: pitch, radius } = input, a = lens.character.aberrations;
  const f = lens.focalLengthMm, z = 1 / (1 / f - 1 / (input.focusDistanceM * 1000)), D = f / lens.character.fNumber, workingF = z / D;
  const lambdaUm = input.wavelengthNm / 1000, dispersion = genericLensDispersion(input.wavelengthNm);
  const r = Math.hypot(input.fieldMm.x, input.fieldMm.y), H = Math.min(1, r / lens.halfDiagonalMm), cosPhi = r > 0 ? input.fieldMm.x / r : 1, sinPhi = r > 0 ? input.fieldMm.y / r : 0;
  const defocusWaves = a.balancingDefocusWaves + (input.axialColor === false ? 0 : a.axialColorWaves * dispersion);
  const opd = (px: number, py: number): number => {
    const r2 = px * px + py * py, along = px * cosPhi + py * sinPhi;
    return DESIGN_WAVELENGTH_UM * (defocusWaves * r2 + a.sphericalWaves * r2 * r2 + a.comaWaves * H * r2 * along + a.astigmatismWaves * H * H * along * along + a.fieldCurvatureWaves * H * H * r2) +
      input.defocusMicrometers * r2;
  };
  // Largest transverse ray aberration 2·N_w·|∇W| over the pupil (µm).
  let slope = 0;
  for (let j = 0; j <= 64; j++) for (let i = 0; i <= 64; i++) {
    const px = -1 + i / 32, py = -1 + j / 32, h = 1e-5;
    if (px * px + py * py > 1) continue;
    slope = Math.max(slope, Math.hypot((opd(px + h, py) - opd(px - h, py)) / (2 * h), (opd(px, py + h) - opd(px, py - h)) / (2 * h)));
  }
  const shift = lens.character.lateralColor.fraction * lens.halfDiagonalMm * 1000 * H * dispersion, sx = shift * cosPhi, sy = shift * sinPhi;
  const delta = lambdaUm * workingF / 4, extent = 2 * (2 * workingF * slope + 16 * lambdaUm * workingF) + 2 * Math.abs(shift);
  const windowExtent = 2 * (radius + 1) * pitch + 2 * Math.abs(shift);
  let n = 256;
  while (n * delta < Math.max(extent, windowExtent)) n *= 2;
  for (;;) {
    if (n > MAXIMUM_TRANSFORM) throw new Error("wave PSF reference: FFT above " + MAXIMUM_TRANSFORM);
    const pupilPitchMm = lambdaUm / 1000 * z / (n * delta / 1000), half = D / 2, reach = Math.floor(half / pupilPitchMm);
    // Phase step between neighbouring pupil samples (waves).
    if (slope * (pupilPitchMm / half) / lambdaUm > MAXIMUM_PHASE_STEP_WAVES) { n *= 2; continue; }
    const re = new Float64Array(n * n), im = new Float64Array(n * n), used = new Uint8Array(n);
    for (let v = -reach; v <= reach; v++) for (let u = -reach; u <= reach; u++) {
      const px = u * pupilPitchMm / half, py = v * pupilPitchMm / half;
      if (px * px + py * py > 1 + 1e-12) continue;
      const phase = 2 * Math.PI * opd(px, py) / lambdaUm, index = ((v + n) % n) * n + (u + n) % n;
      re[index] = Math.cos(phase); im[index] = Math.sin(phase); used[(v + n) % n] = 1;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
    for (let y = 0; y < n; y++) if (used[y]) fft(re.subarray(y * n, (y + 1) * n), im.subarray(y * n, (y + 1) * n), n, cos, sin);
    const cr = new Float64Array(n), ci = new Float64Array(n), intensity = new Float64Array(n * n);
    let total = 0;
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { cr[y] = re[y * n + x]!; ci[y] = im[y * n + x]!; }
      fft(cr, ci, n, cos, sin);
      for (let y = 0; y < n; y++) { const value = cr[y]! * cr[y]! + ci[y]! * ci[y]!; intensity[y * n + x] = value; total += value; }
    }
    // Overlap weights of each sample's δ-interval with each cell along one axis (sample k at k·δ, k signed; the PSF moved by the shift).
    const w2 = 2 * radius + 1;
    const weights = (s: number): { first: number; values: Float64Array }[] => {
      const rows: { first: number; values: Float64Array }[] = [];
      for (let i = -radius; i <= radius; i++) {
        const lo = i * pitch - s - pitch / 2, hi = lo + pitch, k0 = Math.floor(lo / delta - 0.5), k1 = Math.ceil(hi / delta + 0.5), values = new Float64Array(k1 - k0 + 1);
        for (let k = k0; k <= k1; k++) values[k - k0] = Math.max(0, Math.min(hi, (k + 0.5) * delta) - Math.max(lo, (k - 0.5) * delta)) / delta;
        rows.push({ first: k0, values });
      }
      return rows;
    };
    const wx = weights(sx), wy = weights(sy), kernel = new Float64Array(w2 * w2);
    const at = (k: number): number => ((k % n) + n) % n;
    for (let j = 0; j < w2; j++) {
      const ry = wy[j]!;
      for (let i = 0; i < w2; i++) {
        const rx = wx[i]!;
        let sum = 0;
        for (let b = 0; b < ry.values.length; b++) {
          const wyb = ry.values[b]!;
          if (wyb === 0) continue;
          const row = at(ry.first + b) * n;
          for (let c = 0; c < rx.values.length; c++) { const wxc = rx.values[c]!; if (wxc !== 0) sum += wyb * wxc * intensity[row + at(rx.first + c)]!; }
        }
        kernel[j * w2 + i] = sum / total;
      }
    }
    let inside = 0;
    for (const v of kernel) inside += v;
    return { kernel, outside: 1 - inside, transform: n };
  }
}

/** Along one axis (0: x, the columns; 1: y, the rows): a kernel's edge spread position (where it crosses ½), its centroid and its 10–90 % width, sites. */
export function edgeSpread(kernel: Float64Array, radius: number, axis: 0 | 1): { position: number; centroid: number; width: number } {
  const w = 2 * radius + 1, lsf = new Float64Array(w);
  let total = 0;
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) { const v = kernel[j * w + i]!; lsf[axis ? j : i]! += v; total += v; }
  let centroid = 0;
  for (let t = 0; t < w; t++) centroid += (t - radius) * lsf[t]! / total;
  // The ESF at the cell boundary t + ½ is the sum of cells up to t; crossing levels found by linear interpolation between boundaries.
  const crossing = (level: number): number => {
    let below = 0;
    for (let t = 0; t < w; t++) {
      const above = below + lsf[t]! / total;
      if (above >= level) return t - radius - 0.5 + (above > below ? (level - below) / (above - below) : 0.5);
      below = above;
    }
    return radius + 0.5;
  };
  return { position: crossing(0.5), centroid, width: crossing(0.9) - crossing(0.1) };
}

/** A kernel of radius ra placed into a window of radius rb ≥ ra (zero-padded). */
export function padKernel(kernel: Float64Array, ra: number, rb: number): Float64Array {
  const wa = 2 * ra + 1, wb = 2 * rb + 1, out = new Float64Array(wb * wb), o = rb - ra;
  for (let j = 0; j < wa; j++) for (let i = 0; i < wa; i++) out[(j + o) * wb + i + o] = kernel[j * wa + i]!;
  return out;
}
