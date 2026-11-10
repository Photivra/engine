// SPDX-License-Identifier: Apache-2.0

/**
 * The PSF of a generic catalogue lens (#549) on a sensor's site lattice, as a field- and wavelength-dependent sampled PSF
 * profile for the environment PSF quadrature (`simulateCapture` `lens.catalogue`).
 *
 * Model (an approximation): scalar Fraunhofer diffraction of a uniform circular pupil of diameter D = f/N carrying the
 * lens's Seidel wavefront (`resolveGenericLens`; the expansion of `createWavefrontPupilGrid`, Hopkins 1950; Wyant & Creath
 * 1992), propagated to the thin-lens image distance z (working f-number z/D; Goodman, Introduction to Fourier Optics, ch. 4-6).
 * U(x) = Σ_pupil exp(i·2π·W(u)/λ)·exp(−i·2π·x·u/(λ·z)) is evaluated with a zero-padded radix-2 FFT (Cooley & Tukey 1965) on
 * an image grid of pitch δ = min(λ·N_w/2, p/4) (p the site pitch), and |U|² is integrated over each site's square cell (exact
 * overlap of each δ-square with the cell). Lateral colour displaces the PSF radially by Δr(λ). The kernel window is (2R + 1)²
 * sites; the energy outside it is reported and put back by unit-sum renormalisation, as for `lens.diffraction`.
 *
 * Nodes: a 5 × 5 regular grid of field points (0, ±half the frame, ±the frame edge plus the kernel reach) × 5 wavelengths
 * (380, 450, 550, 650, 780 nm), each computed at its own field azimuth (no rotation of a radial node), interpolated by the
 * engine's centroid-aligned multilinear scheme. The quadrant x, y ≥ 0 is computed and mirrored (the Seidel PSF of a mirrored
 * field point is the mirrored PSF).
 *
 * Kernel orientation: a kernel's row index increases with image +Y, the orientation the environment PSF quadrature applies
 * (`sensorPsfSourcePoint`), so coma and lateral colour point away from the optical axis in the rendered image.
 */

import { InvalidScientificInputError } from "../core/validation.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { genericLensDispersion, type ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";
import { markEngineOwnedLensSampledPsfProfile, type LensSampledPsfGridNode, type LensSampledPsfProfile } from "./lens-psf-profile.js";
import { convolveSiteKernels } from "./defocus-disc-kernel.js";
import { createDefocusBokehSiteKernel, type DefocusBokehSiteKernel, type ResolvedDefocusBokehOptions } from "./defocus-bokeh-kernel.js";

/** Wavelength nodes of a catalogue PSF profile, nm (they span the facade's 380–780 nm quadrature). */
export const GENERIC_LENS_PSF_WAVELENGTHS_NM = /* @__PURE__ */ Object.freeze([380, 450, 550, 650, 780] as const);
/** Largest kernel radius of the aberration PSF in sites (before any defocus disc is convolved in). */
export const GENERIC_LENS_PSF_MAXIMUM_KERNEL_RADIUS_SITES = 12;
/** Largest kernel radius in sites of the catalogue PSF with a defocus disc convolved in (`simulateCapture` refuses more: cost). */
export const GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES = 16;
/** Energy fraction a node may leave outside the chosen kernel window (it is put back by renormalisation and reported). */
export const GENERIC_LENS_PSF_WINDOW_TRUNCATION = 0.03;
/** Largest FFT size per axis. */
const MAXIMUM_TRANSFORM = 2048;
/** Largest optical-path step between neighbouring pupil samples, in waves (Nyquist is 0.5). */
const MAXIMUM_PHASE_STEP_WAVES = 0.35;
const DESIGN_WAVELENGTH_UM = 0.55;

export interface GenericLensPsfInput {
  /** The lens resolved at the capture's f-number and focus distance (`resolveGenericLens`). */
  lens: ResolvedGenericLens;
  /** Finite focus distance, m (the thin-lens image distance sets the propagation distance). */
  focusDistanceM: number;
  sitePitchMicrometers: number;
  /** Half extent of the field the profile must cover, mm (the frame's half width and height plus the PSF and query reach). */
  fieldHalfExtentMm: { x: number; y: number };
  /** The frame's half width and height, mm (the inner field nodes sit at half of them). */
  frameHalfMm: { x: number; y: number };
  /** Optional site kernel (2R_d + 1)² to convolve into each node, by its field point (mm, +Y up): the `lens.defocus` bokeh kernel. */
  extraKernel?: { radius: number; clipped?: boolean; at(fieldXmm: number, fieldYmm: number): Float64Array };
  evidence: readonly EvidenceProvenance[];
}

export interface GenericLensPsf {
  profile: LensSampledPsfProfile;
  /** Radius of the aberration PSF window, sites, and of the applied kernel (with `extraKernel`). */
  aberrationKernelRadiusSites: number;
  kernelRadiusSites: number;
  /** Largest energy fraction outside the aberration window over the nodes (put back by renormalisation). */
  maximumTruncatedEnergyFraction: number;
  /** FFT sizes used (smallest, largest) and the largest pupil phase step, waves. */
  transformSize: { minimum: number; maximum: number };
  maximumPhaseStepWaves: number;
  /** Field node coordinates, mm, and wavelengths, nm. */
  fieldXmm: readonly number[];
  fieldYmm: readonly number[];
  wavelengthsNm: readonly number[];
}

/** In-place iterative radix-2 FFT, exp(−i·2π·k·m/n). */
function radix2Fft(re: Float64Array, im: Float64Array, n: number, cos: Float64Array, sin: Float64Array): void {
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

/** One axis's overlap of δ-squares centred at positions (s·δ + shift) with site cells [(i − ½)p, (i + ½)p], i ∈ [−R, R]. */
function overlaps(count: number, delta: number, shift: number, pitch: number, radius: number): { cell: Int32Array; weight: Float64Array; cell2: Int32Array; weight2: Float64Array } {
  const cell = new Int32Array(count).fill(-1), weight = new Float64Array(count), cell2 = new Int32Array(count).fill(-1), weight2 = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    const signed = k < count / 2 ? k : k - count, centre = signed * delta + shift, lo = centre - delta / 2, hi = centre + delta / 2;
    const first = Math.floor(lo / pitch + 0.5), last = Math.floor(hi / pitch + 0.5);
    for (let i = first; i <= last && i <= first + 1; i++) {
      if (i < -radius || i > radius) continue;
      const w = (Math.min(hi, (i + 0.5) * pitch) - Math.max(lo, (i - 0.5) * pitch)) / delta;
      if (w <= 0) continue;
      if (cell[k] === -1) { cell[k] = i + radius; weight[k] = w; } else { cell2[k] = i + radius; weight2[k] = w; }
    }
  }
  return { cell, weight, cell2, weight2 };
}

/** A node's energy per site cell over the (2R₀ + 1)² window (not normalised) and the whole period's energy. */
interface NodeResult { kernel: Float64Array; total: number; transform: number; phaseStep: number }

/** Seidel OPD (µm) at normalised pupil (px, py) for a field point at height H and azimuth φ, at wavelength λ (µm). */
function opdMicrometers(lens: ResolvedGenericLens, H: number, cosPhi: number, sinPhi: number, lambdaUm: number, px: number, py: number): number {
  const a = lens.character.aberrations, r2 = px * px + py * py, along = px * cosPhi + py * sinPhi;
  const defocus = a.balancingDefocusWaves + a.axialColorWaves * genericLensDispersion(lambdaUm * 1000);
  // Positive coma W131 sends the comet's flare away from the axis in the image (H ρ³ cos(θ − φ), with the FFT sign above).
  return DESIGN_WAVELENGTH_UM * (defocus * r2 + a.sphericalWaves * r2 * r2 + a.comaWaves * H * r2 * along + a.astigmatismWaves * H * H * along * along + a.fieldCurvatureWaves * H * H * r2);
}

/** Largest transverse ray aberration 2·N_w·|∂W/∂ρ| (µm) over the pupil, from a 33 × 33 grid. */
function geometricRadiusMicrometers(lens: ResolvedGenericLens, H: number, lambdaUm: number, workingF: number): number {
  let largest = 0;
  const n = 33, h = 1e-4;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const px = -1 + 2 * i / (n - 1), py = -1 + 2 * j / (n - 1);
    if (px * px + py * py > 1) continue;
    const gx = (opdMicrometers(lens, H, 1, 0, lambdaUm, px + h, py) - opdMicrometers(lens, H, 1, 0, lambdaUm, px - h, py)) / (2 * h);
    const gy = (opdMicrometers(lens, H, 1, 0, lambdaUm, px, py + h) - opdMicrometers(lens, H, 1, 0, lambdaUm, px, py - h)) / (2 * h);
    largest = Math.max(largest, Math.hypot(gx, gy));
  }
  return 2 * workingF * largest;
}

function nodeKernel(lens: ResolvedGenericLens, xMm: number, yMm: number, lambdaNm: number, workingF: number, pupilDiameterMm: number, zMm: number,
  pitch: number, radius: number): NodeResult {
  const lambdaUm = lambdaNm / 1000, r = Math.hypot(xMm, yMm), H = Math.min(1, r / lens.halfDiagonalMm);
  const cosPhi = r > 0 ? xMm / r : 1, sinPhi = r > 0 ? yMm / r : 0;
  // Lateral colour: radial displacement L·R·H·D(λ), µm.
  const shift = lens.character.lateralColor.fraction * lens.halfDiagonalMm * 1000 * H * genericLensDispersion(lambdaNm);
  const delta = Math.min(lambdaUm * workingF / 2, pitch / 4);
  let size = 64;
  // The FFT period must hold the window, or (when the PSF is much smaller than the window, for large pixels) the PSF itself:
  // the geometric blur plus 16·λ·N_w of Airy rings (the energy beyond, about 1 %, folds back into the period).
  const psfExtentUm = 2 * (geometricRadiusMicrometers(lens, H, lambdaUm, workingF) + 16 * lambdaUm * workingF);
  while (size * delta < Math.min(2.5 * (radius + 0.5) * pitch, psfExtentUm) + 2 * Math.abs(shift)) size *= 2;
  for (;;) {
    if (size > MAXIMUM_TRANSFORM) throw new InvalidScientificInputError("The catalogue lens PSF needs an FFT larger than " + MAXIMUM_TRANSFORM + " per axis.");
    // Pupil pitch: δ · p_pupil = λ·z / size (mm).
    const pupilPitchMm = lambdaUm / 1000 * zMm / (size * delta / 1000), half = pupilDiameterMm / 2, reach = Math.floor(half / pupilPitchMm);
    const re = new Float64Array(size * size), im = new Float64Array(size * size), rowUsed = new Uint8Array(size);
    let open = 0, phaseStep = 0;
    const opd = new Float64Array((2 * reach + 1) * (2 * reach + 1)).fill(NaN);
    for (let v = -reach; v <= reach; v++) for (let u = -reach; u <= reach; u++) {
      const px = u * pupilPitchMm / half, py = v * pupilPitchMm / half;
      if (px * px + py * py > 1 + 1e-12) continue;
      const w = opdMicrometers(lens, H, cosPhi, sinPhi, lambdaUm, px, py), phase = 2 * Math.PI * w / lambdaUm;
      opd[(v + reach) * (2 * reach + 1) + u + reach] = w;
      const index = ((v + size) % size) * size + (u + size) % size;
      re[index] = Math.cos(phase); im[index] = Math.sin(phase); rowUsed[(v + size) % size] = 1; open++;
    }
    const width = 2 * reach + 1;
    for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) {
      const w = opd[j * width + i]!;
      if (Number.isNaN(w)) continue;
      if (i + 1 < width && !Number.isNaN(opd[j * width + i + 1]!)) phaseStep = Math.max(phaseStep, Math.abs(opd[j * width + i + 1]! - w) / lambdaUm);
      if (j + 1 < width && !Number.isNaN(opd[(j + 1) * width + i]!)) phaseStep = Math.max(phaseStep, Math.abs(opd[(j + 1) * width + i]! - w) / lambdaUm);
    }
    if (open < 9) throw new InvalidScientificInputError("The catalogue lens PSF pupil has fewer than 9 samples.");
    if (phaseStep > MAXIMUM_PHASE_STEP_WAVES) { size *= 2; continue; }
    const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / size); sin[k] = Math.sin(2 * Math.PI * k / size); }
    const rowRe = new Float64Array(size), rowIm = new Float64Array(size);
    for (let y = 0; y < size; y++) {
      if (!rowUsed[y]) continue;
      rowRe.set(re.subarray(y * size, (y + 1) * size)); rowIm.set(im.subarray(y * size, (y + 1) * size));
      radix2Fft(rowRe, rowIm, size, cos, sin);
      re.set(rowRe, y * size); im.set(rowIm, y * size);
    }
    const colRe = new Float64Array(size), colIm = new Float64Array(size);
    const ox = overlaps(size, delta, shift * cosPhi, pitch, radius), oy = overlaps(size, delta, shift * sinPhi, pitch, radius);
    const w2 = 2 * radius + 1, kernel = new Float64Array(w2 * w2);
    let total = 0, inside = 0;
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) { colRe[y] = re[y * size + x]!; colIm[y] = im[y * size + x]!; }
      radix2Fft(colRe, colIm, size, cos, sin);
      const cx = ox.cell[x]!, cx2 = ox.cell2[x]!, wx = ox.weight[x]!, wx2 = ox.weight2[x]!;
      for (let y = 0; y < size; y++) {
        const intensity = colRe[y]! * colRe[y]! + colIm[y]! * colIm[y]!;
        total += intensity;
        if (cx < 0) continue;
        const cy = oy.cell[y]!;
        if (cy < 0) continue;
        const cy2 = oy.cell2[y]!, wy = oy.weight[y]!, wy2 = oy.weight2[y]!;
        // Row index increases with image +Y (the quadrature's orientation).
        kernel[cy * w2 + cx]! += intensity * wx * wy; inside += intensity * wx * wy;
        if (cx2 >= 0) { kernel[cy * w2 + cx2]! += intensity * wx2 * wy; inside += intensity * wx2 * wy; }
        if (cy2 >= 0) {
          kernel[cy2 * w2 + cx]! += intensity * wx * wy2; inside += intensity * wx * wy2;
          if (cx2 >= 0) { kernel[cy2 * w2 + cx2]! += intensity * wx2 * wy2; inside += intensity * wx2 * wy2; }
        }
      }
    }
    if (!(total > 0) || !(inside > 0)) throw new InvalidScientificInputError("The catalogue lens PSF has no energy in its window.");
    return { kernel, total, transform: size, phaseStep };
  }
}

function mirror(kernel: Float64Array, radius: number, flipX: boolean, flipY: boolean): Float64Array {
  const w = 2 * radius + 1, out = new Float64Array(kernel.length);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) out[(flipY ? w - 1 - j : j) * w + (flipX ? w - 1 - i : i)] = kernel[j * w + i]!;
  return out;
}

/** Thin-lens image distance z (mm), pupil diameter D = f/N (mm) and working f-number z/D at a finite focus. */
function pupilGeometry(lens: ResolvedGenericLens, focusDistanceM: number): { z: number; D: number; workingF: number } {
  const f = lens.focalLengthMm, d = focusDistanceM * 1000;
  if (!(d > f)) throw new InvalidScientificInputError("The focus distance must exceed the focal length.");
  const z = 1 / (1 / f - 1 / d), D = f / lens.character.fNumber;
  return { z, D, workingF: z / D };
}

/**
 * An upper bound of the aberration PSF's kernel radius in sites (the window is then narrowed to keep at most
 * {@link GENERIC_LENS_PSF_WINDOW_TRUNCATION} of every node's energy outside): the largest transverse ray aberration 2·N_w·|∂W/∂ρ| over the pupil at the frame
 * corner and every wavelength node, plus the lateral-colour shift, plus the Airy third dark ring 3.24·λ·N_w at 780 nm, rounded up
 * to whole sites (at least 1, at most {@link GENERIC_LENS_PSF_MAXIMUM_KERNEL_RADIUS_SITES}).
 */
export function genericLensPsfKernelRadius(input: { lens: ResolvedGenericLens; focusDistanceM: number; sitePitchMicrometers: number }): number {
  const { lens, sitePitchMicrometers: pitch } = input, { workingF } = pupilGeometry(lens, input.focusDistanceM);
  const longest = GENERIC_LENS_PSF_WAVELENGTHS_NM[GENERIC_LENS_PSF_WAVELENGTHS_NM.length - 1]! / 1000;
  let reachUm = 0;
  for (const nm of GENERIC_LENS_PSF_WAVELENGTHS_NM) {
    const shift = Math.abs(lens.character.lateralColor.fraction * lens.halfDiagonalMm * 1000 * genericLensDispersion(nm));
    reachUm = Math.max(reachUm, geometricRadiusMicrometers(lens, 1, nm / 1000, workingF) + shift);
  }
  reachUm += 3.24 * longest * workingF;
  return Math.min(GENERIC_LENS_PSF_MAXIMUM_KERNEL_RADIUS_SITES, Math.max(1, Math.ceil(reachUm / pitch - 0.5)));
}

/**
 * Builds the catalogue lens's sampled PSF profile for the environment PSF quadrature: 5 × 5 field nodes × 5 wavelengths, each
 * kernel on the site lattice. Engine-owned (parsed once). Deterministic: the same input gives the same profile.
 */
export function createGenericLensPsfProfile(input: GenericLensPsfInput): GenericLensPsf {
  const { lens, sitePitchMicrometers: pitch } = input;
  const f = lens.focalLengthMm, N = lens.character.fNumber, { z, D, workingF } = pupilGeometry(lens, input.focusDistanceM);
  const ex = input.fieldHalfExtentMm, fh = input.frameHalfMm;
  if (!(ex.x > fh.x / 2 && ex.y > fh.y / 2 && fh.x > 0 && fh.y > 0)) throw new InvalidScientificInputError("The PSF field extent must exceed half the frame.");
  const xs = [0, fh.x / 2, ex.x], ys = [0, fh.y / 2, ex.y];
  const bound = genericLensPsfKernelRadius({ lens, focusDistanceM: input.focusDistanceM, sitePitchMicrometers: pitch });
  const quadrant = new Map<string, NodeResult>();
  let minimumTransform = Infinity, maximumTransform = 0, phaseStep = 0;
  for (const x of xs) for (const y of ys) for (const nm of GENERIC_LENS_PSF_WAVELENGTHS_NM) {
    const node = nodeKernel(lens, x, y, nm, workingF, D, z, pitch, bound);
    minimumTransform = Math.min(minimumTransform, node.transform);
    maximumTransform = Math.max(maximumTransform, node.transform); phaseStep = Math.max(phaseStep, node.phaseStep);
    quadrant.set(x + ":" + y + ":" + nm, node);
  }
  // The window: the smallest radius that keeps at most 1 % of every node's energy outside it (at most the bound).
  const outside = (r: number): number => {
    let worst = 0;
    for (const node of quadrant.values()) {
      let inside = 0;
      for (let j = bound - r; j <= bound + r; j++) for (let i = bound - r; i <= bound + r; i++) inside += node.kernel[j * (2 * bound + 1) + i]!;
      worst = Math.max(worst, 1 - inside / node.total);
    }
    return worst;
  };
  let radius = 1;
  while (radius < bound && outside(radius) > GENERIC_LENS_PSF_WINDOW_TRUNCATION) radius++;
  const truncated = Math.max(0, outside(radius));
  const crop = (node: NodeResult): Float64Array => {
    const w0 = 2 * bound + 1, w1 = 2 * radius + 1, out = new Float64Array(w1 * w1);
    let sum = 0;
    for (let j = 0; j < w1; j++) for (let i = 0; i < w1; i++) { const v = node.kernel[(j + bound - radius) * w0 + i + bound - radius]!; out[j * w1 + i] = v; sum += v; }
    for (let k = 0; k < out.length; k++) out[k] = out[k]! / sum;
    return out;
  };
  const extra = input.extraKernel, kernelRadius = radius + (extra ? extra.radius : 0), w = 2 * kernelRadius + 1;
  const fieldX = [-ex.x, -fh.x / 2, 0, fh.x / 2, ex.x], fieldY = [-ex.y, -fh.y / 2, 0, fh.y / 2, ex.y];
  const uncertainty = { kind: "not-quantified" as const, limitation: "Generic catalogue lens PSF: Photivra's own Seidel coefficients, not a measured lens." };
  const nodes: LensSampledPsfGridNode[] = [];
  const focusDiopters = 1 / input.focusDistanceM;
  for (const x of fieldX) for (const y of fieldY) for (const nm of GENERIC_LENS_PSF_WAVELENGTHS_NM) {
    const base = quadrant.get(Math.abs(x) + ":" + Math.abs(y) + ":" + nm)!;
    let kernel = mirror(crop(base), radius, x < 0, y < 0);
    if (extra) kernel = convolveSiteKernels(kernel, radius, extra.at(x, y), extra.radius);
    nodes.push({ nodeId: "pv-" + x.toFixed(6) + "-" + y.toFixed(6) + "-" + nm,
      coordinate: { focalLengthMm: f, focusDiopters, apertureFNumber: N, fieldXmm: x, fieldYmm: y, wavelengthNm: nm, signedDefocusImagePlaneMicrometers: 0 },
      kernel: { widthSamples: w, heightSamples: w, samplePitchMicrometersX: pitch, samplePitchMicrometersY: pitch, centerSampleX: kernelRadius, centerSampleY: kernelRadius,
        normalizedIntensity: Array.from(kernel) },
      bestFocusImagePlaneOffsetMicrometers: 0, relativePupilThroughputFactor: 1, evidence: input.evidence, uncertainty });
  }
  const profile: LensSampledPsfProfile = { schemaVersion: "0.1.0", profileId: "photivra-" + lens.lensId + ":psf", profileVersion: "1.0.0", scientificStatus: "approximation",
    opticalDomain: "lens-primary-optical-path-only", coordinateSystem: "image-plane-metric", fieldAxes: "+X right, +Y up", kernelEnergyNormalization: "unit-energy-shape",
    interpolation: "bounded-regular-grid-centroid-aligned", throughputOwnership: "separate-relative-pupil-throughput-factor",
    responseIncludes: { diffraction: true, aberration: true, defocus: extra !== undefined, pupilClippingShape: extra?.clipped === true },
    sensorOpticalStackIncluded: false, sensorSamplingIncluded: false, reconstructionIncluded: false, strayLightIncluded: false,
    axes: { focalLengthMm: [f], focusDiopters: [focusDiopters], apertureFNumber: [N], fieldXmm: fieldX, fieldYmm: fieldY, wavelengthNm: [...GENERIC_LENS_PSF_WAVELENGTHS_NM],
      signedDefocusImagePlaneMicrometers: [0] }, nodes, evidence: input.evidence,
    limitations: ["Generic catalogue lens (#549): scalar Fraunhofer PSF of Photivra's own Seidel wavefront with lateral colour, integrated over site cells; not a measured lens.",
      "Field and wavelength nodes are interpolated with centroid alignment; between nodes the PSF is a blend, not a recomputed PSF."] };
  markEngineOwnedLensSampledPsfProfile(profile);
  return { profile, aberrationKernelRadiusSites: radius, kernelRadiusSites: kernelRadius, maximumTruncatedEnergyFraction: truncated,
    transformSize: { minimum: minimumTransform, maximum: maximumTransform }, maximumPhaseStepWaves: phaseStep, fieldXmm: fieldX, fieldYmm: fieldY,
    wavelengthsNm: [...GENERIC_LENS_PSF_WAVELENGTHS_NM] };
}

/**
 * #567: the catalogue lens's own bokeh kernel for `lens.defocus` (#553's shaped kernel with `lens.character.bokeh`), as the
 * PSF's field-dependent extra kernel. The defocus is referred to the lens's focus, the balanced one of its PSF (W020 = −W040):
 * the ray map (σc/2 + bρ²)·P of the paraxial focus gains −(b/2)·P, so the kernel is #553's for the signed blur σc − b. Rows are
 * flipped from #553's (+Y down) to the profile's (+Y up). With a cat's eye each field point (tangent x/f, y/f: the rectilinear
 * chief ray, distortion neglected) has its own kernel, padded to the axis kernel's radius (clipping only narrows the blur). Each
 * call builds its kernel (the profile calls it once per field and wavelength node: 125 small kernels). `catsEye` false leaves it out.
 */
export function genericLensBokehKernel(lens: ResolvedGenericLens, diameterSites: number, side: 1 | -1, pitch: number, catsEye: boolean):
  { axis: DefocusBokehSiteKernel; radius: number; clipped: boolean; at(fieldXmm: number, fieldYmm: number): Float64Array } {
  const b = lens.character.bokeh, options = (catsEye ? b : { blades: b.blades, sphericalAberration: b.sphericalAberration }) as ResolvedDefocusBokehOptions, N = lens.character.fNumber, f = lens.focalLengthMm;
  const s = side * diameterSites - 8 * N * options.sphericalAberration!.w040Micrometers / pitch;
  const build = (x: number, y: number): DefocusBokehSiteKernel => createDefocusBokehSiteKernel({ diameterSites: Math.abs(s), side: s < 0 ? -1 : 1, fNumber: N,
    focalLengthMm: f, pitchMicrometers: pitch, options, field: { x: x / f, y: y / f } });
  const axis = build(0, 0), R = axis.radius, w = 2 * R + 1;
  return { axis, radius: R, clipped: !!options.catsEye, at(x, y): Float64Array {
    const k = options.catsEye ? build(x, y) : axis, r = k.radius, out = new Float64Array(w * w);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) out[(R - j) * w + i + R] = k.weights[(j + r) * k.width + i + r]!;
    return out;
  } };
}
