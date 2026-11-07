// SPDX-License-Identifier: Apache-2.0

/**
 * Builds a `LensSampledPsfProfile` for an ideal, aberration-free, in-focus lens with a uniformly lit
 * circular pupil: the Airy pattern of scalar Fraunhofer diffraction, one unit-sum kernel per declared
 * wavelength on ONE shared sample grid (2.1.0).
 *
 * **Model.** The pupil diameter is D = f/N (entrance pupil = exit pupil, unity pupil magnification) and
 * the pupil-to-image distance z is the thin-lens image distance for the focus (f at infinity), so the
 * image-side (working) f-number is N_w = z/D. The incoherent optical transfer function (OTF) of a
 * uniform circular pupil is the normalized autocorrelation of the pupil,
 *   H(ρ) = (2/π)·(acos ρ − ρ·√(1 − ρ²)),  ρ = |f|/f_c ≤ 1,  f_c = 1/(λ·N_w),
 * and the intensity PSF is its inverse Fourier transform (the Airy pattern, first zero at 1.21967·λ·N_w)
 * (MIT OpenCourseWare 2.71 Optics, Spring 2009, lectures 21–22, free: the intensity PSF as the transform of
 * the pupil autocorrelation and the circular-pupil MTF; also see: Goodman, Introduction to Fourier Optics,
 * 4th ed., 2017, §7.3).
 *
 * **Cell integration (exact, no Bessel functions).** Kernel sample (i, j) is the PSF energy inside the
 * square cell of side p centred on (i·p, j·p). The cell integral is the PSF convolved with the cell's
 * indicator, evaluated at the cell centre, so in the frequency domain
 *   K(i, j) = p² ∫∫ H(|f|/f_c)·sinc(p·f_x)·sinc(p·f_y)·cos(2π·p·i·f_x)·cos(2π·p·j·f_y) d²f,
 * with sinc(x) = sin(πx)/(πx) (the sine terms vanish because H is even). It is evaluated in polar
 * coordinates: a trapezoid rule in angle (exponentially convergent for this smooth periodic integrand) and
 * Gauss–Legendre in t with ρ = 1 − t², which removes the (1 − ρ)^{3/2} edge behaviour of H. The node counts
 * follow from the integrand's bandwidth with a fixed margin; the tests check convergence by doubling them and
 * check the values against an independent real-space integration of `calculateIdealPolygonDiffractionPsf` in
 * its many-blade (circular) limit. The sum of all cells is exactly 1 (Parseval), so the energy captured by
 * the finite kernel is Σ K over its window and the truncated energy is 1 − Σ K.
 *
 * **Cells much larger than the pattern (2.5; threshold lowered to β = 32 after 2.8.1).** The frequency-domain node counts grow with β = p·f_c (the
 * cell side over the cut-off period), so the work grows as β². From β ≥ `AIRY_REAL_SPACE_MINIMUM_BETA` (32) the cells are
 * integrated in real space instead, with the same model and no frequency integral: the Airy encircled energy is
 * EE(r) = 1 − J₀(x)² − J₁(x)², x = π·r·f_c (it follows from J₀′ = −J₁ and J₁′ = J₀ − J₁/x, DLMF §10.6(i), free), so
 * the energy of the rectangle [0, X] × [0, Y] is (1/2π)∫ EE(r_edge(θ)) dθ over its quadrant, a one-dimensional
 * integral in θ. Every cell is a signed sum of such rectangles. J₀² + J₁² comes from the Hankel asymptotic expansion
 * (DLMF §10.17(i), eq. 10.17.3, free) from x = 300, with eight terms in each of P and Q (remainder under 1e-17,
 * DLMF §10.17(iii)), and below it from Miller's backward recurrence normalized by J₀ + 2ΣJ₂ₖ = 1 (DLMF §3.6(iii),
 * 10.12.4, free). The θ integral uses 16-point Gauss–Legendre panels on which the phase 2x changes by at most
 * 2 radians, so the work grows only as β. The tests check the two methods against each other from β = 32 to 400, the
 * real-space cells against the asymptotic leakage 8√2/(π³·β) of the centre cell, and convergence under doubled panel
 * counts. The threshold was 192 in 2.5; it moved to 32 because from there the real-space cells agree with the frequency-domain cells
 * within about 1e-12 and cost a few to a few hundred times less (a 750 µm whole-frame cell at f/8 took 3.4 s for 20
 * wavelengths). Every β a native pitch up to 10 µm reaches (at most 10/(0.38·1.4) ≈ 19) stays in the frequency domain,
 * so captures at sensor pitch are unchanged; larger cells (binned and whole-frame views) change in the last bits only.
 *
 * **Reuse (2.6).** The cells depend only on (β, R) (and the test-only node scale), so `calculateAiryCellEnergies` keeps the
 * 800 most recently used results (256 before 2.15.0; 800 holds two whole 400-node grids) and returns copies: tiles of one frame rendered in the same worker, and captures that
 * change only the exposure, ISO, scene or output, reuse the kernels instead of integrating them again. The frequency-domain
 * loop also takes cos θ and sin θ from a per-call table computed with the same expressions, so the values are unchanged.
 *
 * **Truncation and normalization.** The kernel is the (2R+1)² window of cells. The Airy tails fall only as
 * r⁻³, so a finite window always misses some energy: it is reported per wavelength, and the window is then
 * renormalized to unit sum because the sampled-profile contract requires unit-energy kernels. The missing
 * tail energy is thereby put back inside the window (an approximation that slightly raises low-frequency
 * contrast compared with the untruncated pattern).
 *
 * **Approximations (labelled):** scalar (no polarization), aberration-free, uniform pupil amplitude, exactly in
 * focus (no defocus), thin lens with unity pupil magnification, the on-axis PSF used across the declared field
 * (isoplanatic), PSF energy binned into the sample cells, finite window renormalized. Not a measured lens.
 * @see docs/PSF_FOUNDATION.md, "Diffraction-limited sampled profile (2.1)".
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import type { FocusPlane } from "./focus-state.js";
import { calculateThinLensImageDistance } from "./thin-lens.js";
import { parseLensSampledPsfProfile, type LensSampledPsfProfile } from "./lens-psf-profile.js";

export const DIFFRACTION_LIMITED_PSF_PROFILE_MODEL = /* @__PURE__ */ Object.freeze({
  modelId: "photivra-diffraction-limited-circular-pupil-psf" as const, modelVersion: "1.0.0" as const });
/**
 * Input limits: at most 400 wavelengths, kernel radius 0–32 samples (the irradiance-convolution limit). 400 is the finest spectral
 * sampling of `simulateCapture` and the display view (`sensor.spectralStepNanometers` 1 nm over 380–780 nm), so `lens.diffraction`
 * builds one exact kernel per spectral node at every allowed step; it was 64 before 2.15.0, which refused every step under 6.25 nm.
 * The work and memory are linear in the count (measured in docs/PSF_FOUNDATION.md, "Spectral nodes").
 */
export const DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS = /* @__PURE__ */ Object.freeze({ maximumWavelengths: 400, maximumKernelRadiusSamples: 32 });
/**
 * Internal: β = p·f_c (cell side over the cut-off period) from which `calculateAiryCellEnergies` integrates the cells in
 * real space (2.5). Above every β of a `simulateCapture` pitch up to 100 µm, whose captures keep the frequency-domain values.
 */
export const AIRY_REAL_SPACE_MINIMUM_BETA = 32;
/** Radius of the first dark ring of the Airy pattern in units of λ·N_w: j₁,₁/π, j₁,₁ = 3.8317059702 (first zero of J₁). */
const AIRY_FIRST_ZERO_PER_LAMBDA_N = 3.8317059702075125 / Math.PI;

export interface CreateDiffractionLimitedPsfProfileInput {
  /** Only `circular` in 2.1.0 (polygon pupils: `calculateIdealPolygonDiffractionPsf` gives point densities). */
  aperture: "circular";
  focalLengthMm: number;
  apertureFNumber: number;
  focus: FocusPlane;
  /** Strictly increasing wavelengths, nm, in the medium of propagation (no air/vacuum conversion is applied). 1–400. */
  wavelengthsNm: readonly number[];
  /** Square sample pitch of every kernel, µm. */
  samplePitchMicrometers: number;
  /** Kernel half-width in samples; each kernel is (2R + 1)². 0–32. */
  kernelRadiusSamples: number;
  /** Half-extent of the image field over which the on-axis PSF is declared (profile field axes ±x, ±y), mm. */
  fieldHalfExtentMm: { x: number; y: number };
  profileId: string;
}

export interface DiffractionLimitedPsfWavelength {
  wavelengthNm: number;
  /** f_c = 1/(λ·N_w), cycles per µm. */
  cutoffFrequencyCyclesPerMicrometer: number;
  /** 1.21967·λ·N_w, µm. */
  firstZeroRadiusMicrometers: number;
  /** Σ of the cell energies inside the window before renormalization (of a total of 1). */
  capturedEnergyFraction: number;
  /** 1 − capturedEnergyFraction: the Airy tail energy outside the window, put back by renormalization. */
  truncatedEnergyFraction: number;
  /** Fraction of the renormalized kernel in the centre sample. */
  centreSampleFraction: number;
}

export interface DiffractionLimitedPsfProfile {
  profile: LensSampledPsfProfile;
  model: typeof DIFFRACTION_LIMITED_PSF_PROFILE_MODEL;
  pupilDiameterMm: number;
  pupilToImageDistanceMm: number;
  workingFNumber: number;
  kernelRadiusSamples: number;
  samplePitchMicrometers: number;
  wavelengths: readonly DiffractionLimitedPsfWavelength[];
  /** Largest truncated energy over the wavelengths. */
  maximumTruncatedEnergyFraction: number;
  /**
   * How the cells were integrated. 2.5: wavelengths with β = p·f_c ≥ `AIRY_REAL_SPACE_MINIMUM_BETA` (192 in 2.5–2.8.1, then 32) use the real-space
   * encircled-energy method; `realSpaceWavelengthsNm` lists them, and `method` is `"frequency-domain-and-real-space"` when both ran.
   * `maximumRadialNodes` counts frequency-domain radial nodes (0 when only the real-space method ran); `maximumAngularNodes` the
   * angular nodes of either method (for the real-space method, all θ nodes of one wavelength).
   */
  quadrature: { method: "polar-frequency-domain-trapezoid-gauss-legendre" | "real-space-encircled-energy-gauss-legendre" | "frequency-domain-and-real-space";
    maximumRadialNodes: number; maximumAngularNodes: number; realSpaceWavelengthsNm?: readonly number[] };
}

const EVIDENCE: readonly EvidenceProvenance[] = /* @__PURE__ */ Object.freeze([/* @__PURE__ */ Object.freeze({ sourceOrigin: "photivra" as const,
  sourceReference: "photivra:diffraction-limited-psf-profile", reuseStatus: "photivra-owned" as const })]);
const LIMITATIONS = /* @__PURE__ */ Object.freeze([
  "Scalar Fraunhofer diffraction of an ideal, uniformly lit circular pupil (Airy pattern); no aberration, apodization, polarization or stray light.",
  "Exactly in focus: no defocus or depth of field. Thin lens with unity pupil magnification; the pupil-to-image distance is the thin-lens image distance.",
  "The on-axis PSF is declared unchanged across the field (isoplanatic); no field-dependent aberration or pupil clipping.",
  "PSF energy is binned into square sample cells; the finite window misses the Airy tail energy listed per wavelength and is renormalized to unit sum.",
  "Wavelengths are used as given, in the declared basis, without air/vacuum conversion."
]);

function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidConfigurationError(name + " must be a positive finite number.");
  return value;
}

/** Gauss–Legendre nodes and weights on [0, 1] (Newton iteration on Pₙ; DLMF §3.5(v)). Cached per n. */
const GAUSS_LEGENDRE = new Map<number, { nodes: Float64Array; weights: Float64Array }>();
function gaussLegendre(n: number): { nodes: Float64Array; weights: Float64Array } {
  const cached = GAUSS_LEGENDRE.get(n);
  if (cached) return cached;
  const nodes = new Float64Array(n), weights = new Float64Array(n);
  for (let k = 0; k < Math.ceil(n / 2); k++) {
    let x = Math.cos(Math.PI * (k + 0.75) / (n + 0.5));
    for (let iteration = 0; iteration < 100; iteration++) {
      let p0 = 1, p1 = x;
      for (let m = 2; m <= n; m++) { const p2 = ((2 * m - 1) * x * p1 - (m - 1) * p0) / m; p0 = p1; p1 = p2; }
      const step = p1 / (n * (x * p1 - p0) / (x * x - 1));
      x -= step;
      if (Math.abs(step) < 1e-16) break;
    }
    let p0 = 1, p1 = x;
    for (let m = 2; m <= n; m++) { const p2 = ((2 * m - 1) * x * p1 - (m - 1) * p0) / m; p0 = p1; p1 = p2; }
    const derivative = n * (x * p1 - p0) / (x * x - 1);
    const w = 1 / ((1 - x * x) * derivative * derivative);
    // Map [-1, 1] to [0, 1]: t = (1 ± x)/2, weight w (2/(1-x²)P'² halved).
    nodes[k] = (1 - x) / 2; weights[k] = w;
    nodes[n - 1 - k] = (1 + x) / 2; weights[n - 1 - k] = w;
  }
  const result = { nodes, weights };
  if (GAUSS_LEGENDRE.size < 64) GAUSS_LEGENDRE.set(n, result);
  return result;
}
function sinc(x: number): number {
  if (x === 0) return 1;
  const a = Math.PI * x;
  return Math.sin(a) / a;
}

/**
 * Cell energies K(i, j), 0 ≤ i, j ≤ R, of the Airy pattern for β = p·f_c (cell side in units of the cut-off
 * period): in the frequency domain below `AIRY_REAL_SPACE_MINIMUM_BETA`, in real space from it (2.5). `scale`
 * multiplies the node or panel counts (1 in production; the tests use 2 to check convergence).
 */
export function calculateAiryCellEnergies(beta: number, radius: number, scale = 1): { cells: Float64Array; radialNodes: number; angularNodes: number; realSpace: boolean } {
  // 2.6: a pure function of (β, R, scale), so results are memoized (most recently used first) and handed out as copies.
  // Tiles of one frame, and captures that change only the exposure or the scene, rebuild the same kernels.
  const key = beta + "|" + radius + "|" + scale, cached = AIRY_CELL_CACHE.get(key);
  if (cached) {
    AIRY_CELL_CACHE.delete(key); AIRY_CELL_CACHE.set(key, cached);
    return { ...cached, cells: cached.cells.slice() };
  }
  const result = beta >= AIRY_REAL_SPACE_MINIMUM_BETA ? { ...calculateAiryCellEnergiesInRealSpace(beta, radius, scale), radialNodes: 0, realSpace: true } :
    { ...calculateAiryCellEnergiesInFrequencyDomain(beta, radius, scale), realSpace: false };
  AIRY_CELL_CACHE.set(key, { ...result, cells: result.cells.slice() });
  if (AIRY_CELL_CACHE.size > AIRY_CELL_CACHE_ENTRIES) AIRY_CELL_CACHE.delete(AIRY_CELL_CACHE.keys().next().value!);
  return result;
}
/**
 * Memoized cell energies (2.6): 800 entries of (R + 1)² values, at most 800 × 33² × 8 bytes ≈ 7.0 MB. 2.15.0: 800 (was 256), so the
 * least-recently-used order still reuses a whole grid of the finest spectral sampling (400 nodes), which 256 entries never did.
 */
const AIRY_CELL_CACHE_ENTRIES = 800;
const AIRY_CELL_CACHE = new Map<string, { cells: Float64Array; radialNodes: number; angularNodes: number; realSpace: boolean }>();

/** Hankel asymptotic coefficients a_k(ν) of DLMF 10.17.1 for ν = 0 and 1, k = 0..15. */
const HANKEL = ((): { a0: Float64Array; a1: Float64Array } => {
  const a0 = new Float64Array(16), a1 = new Float64Array(16);
  a0[0] = 1; a1[0] = 1;
  for (let k = 1; k < 16; k++) {
    const odd = (2 * k - 1) * (2 * k - 1);
    a0[k] = a0[k - 1]! * (0 - odd) / (8 * k);
    a1[k] = a1[k - 1]! * (4 - odd) / (8 * k);
  }
  return { a0, a1 };
})();
/** Smallest argument of `besselSquareSum`: there the 16-term expansion's remainder is below 1e-17. */
const HANKEL_MINIMUM_ARGUMENT = 300;

/**
 * J₀(x)² + J₁(x)² for x > 0. From x ≥ 300 by the Hankel expansion J_ν(x) = √(2/(πx))·(P_ν cos ω_ν − Q_ν sin ω_ν), ω_ν = x − νπ/2 − π/4,
 * P_ν = Σ(−1)^k a_2k(ν)/x^2k, Q_ν = Σ(−1)^k a_2k+1(ν)/x^2k+1 (DLMF 10.17.3), eight terms each. With ω₁ = ω₀ − π/2,
 * J₁ = √(2/(πx))·(P₁ sin ω₀ + Q₁ cos ω₀). Below 300 by Miller's backward recurrence J_{n−1} = (2n/x)·J_n − J_{n+1} (DLMF 10.6.1;
 * the algorithm, DLMF §3.6(iii)), started at an order above x where J_n is negligible, normalized by J₀ + 2·Σ J_2k = 1
 * (DLMF 10.12.4). Internal.
 */
export function besselSquareSum(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) throw new InvalidConfigurationError("J0 and J1 need a positive finite argument.");
  if (x < HANKEL_MINIMUM_ARGUMENT) return besselSquareSumByRecurrence(x);
  const { a0, a1 } = HANKEL, inverse = 1 / x;
  let p0 = 0, q0 = 0, p1 = 0, q1 = 0, power = 1;
  for (let k = 0; k < 16; k++) {
    const sign = (k >> 1) % 2 === 0 ? 1 : -1;
    if (k % 2 === 0) { p0 += sign * a0[k]! * power; p1 += sign * a1[k]! * power; } else { q0 += sign * a0[k]! * power; q1 += sign * a1[k]! * power; }
    power *= inverse;
  }
  const omega = x - Math.PI / 4, c = Math.cos(omega), s = Math.sin(omega);
  const j0 = p0 * c - q0 * s, j1 = p1 * s + q1 * c;
  return 2 / (Math.PI * x) * (j0 * j0 + j1 * j1);
}
/**
 * Miller's backward recurrence for 0 < x < 300 (see `besselSquareSum`). The start order x + 10·∛x + 40 (even) lies far enough in the
 * region where J_n(x) falls faster than exponentially that the start values' error is below double precision at J₀ and J₁; the
 * values are rescaled when they grow large, and normalized before squaring.
 */
function besselSquareSumByRecurrence(x: number): number {
  const start = 2 * Math.ceil((x + 10 * Math.cbrt(x) + 40) / 2);
  let next = 0, current = 1e-100, sum = 0, j1 = 0;
  for (let n = start; n >= 1; n--) {
    const previous = (2 * n / x) * current - next;
    next = current; current = previous;
    if (n - 1 === 1) j1 = current;
    if (n - 1 > 0 && (n - 1) % 2 === 0) sum += 2 * current;
    if (Math.abs(current) > 1e100) { current *= 1e-100; next *= 1e-100; sum *= 1e-100; j1 *= 1e-100; }
  }
  sum += current;
  const j0 = current / sum, j1n = j1 / sum;
  return j0 * j0 + j1n * j1n;
}

/**
 * Real-space cell energies (2.5): see the module comment. G(Z, φ) = ∫₀^φ [J₀² + J₁²](π·β·Z/cos θ) dθ for cell boundaries at
 * half-integer distances Z (in cells), accumulated along θ for each Z with every needed φ = atan(W/Z) as a panel boundary.
 * The rectangle [0, X] × [0, Y] holds 1/4 − (G(X, atan(Y/X)) + G(Y, atan(X/Y)))/(2π) of the energy. Internal.
 */
export function calculateAiryCellEnergiesInRealSpace(beta: number, radius: number, scale = 1): { cells: Float64Array; angularNodes: number } {
  const size = radius + 1, table = new Float64Array(size * size), { nodes, weights } = gaussLegendre(16);
  let angularNodes = 0;
  for (let z = 0; z < size; z++) {
    const Z = z + 0.5, k = Math.PI * beta * Z;
    let sum = 0, t0 = 1, theta0 = 0;
    for (let w = 0; w < size; w++) {
      // Panels equal in t = 1/cos θ, so the phase 2x = 2kt changes by at most 2 radians on each.
      const t1 = Math.hypot(Z, w + 0.5) / Z, theta1 = Math.atan2(w + 0.5, Z), panels = Math.max(1, Math.ceil(scale * k * (t1 - t0)));
      let a = theta0;
      for (let n = 1; n <= panels; n++) {
        const b = n === panels ? theta1 : Math.acos(1 / (t0 + (t1 - t0) * n / panels)), h = b - a;
        let panel = 0;
        for (let g = 0; g < 16; g++) panel += weights[g]! * besselSquareSum(k / Math.cos(a + h * nodes[g]!));
        sum += panel * h;
        a = b;
      }
      angularNodes += 16 * panels;
      table[z * size + w] = sum;
      t0 = t1; theta0 = theta1;
    }
  }
  // Boundaries of cell i along one axis as (half-integer index, weight): the centre cell is twice [0, 1/2].
  const bounds = (i: number): [number, number][] => i === 0 ? [[0, 2]] : [[i, 1], [i - 1, -1]];
  const cells = new Float64Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let constant = 0, leak = 0;
    for (const [a, wa] of bounds(i)) for (const [b, wb] of bounds(j)) {
      constant += wa * wb;
      leak += wa * wb * (table[a * size + b]! + table[b * size + a]!);
    }
    cells[j * size + i] = constant / 4 - leak / (2 * Math.PI);
  }
  return { cells, angularNodes };
}

/** Frequency-domain cell energies (2.1; see the module comment). Internal. */
export function calculateAiryCellEnergiesInFrequencyDomain(beta: number, radius: number, scale = 1): { cells: Float64Array; radialNodes: number; angularNodes: number } {
  // Bandwidth of the angular and radial integrands: c = π·β·(2R + 1)·√2 (the sinc factors and the highest cosine).
  const c = Math.PI * beta * (2 * radius + 1) * Math.SQRT2, margin = 10 * Math.cbrt(c) + 24;
  const quarter = Math.ceil(scale * (c + margin) / 4), radialNodes = Math.ceil(scale * (c + margin));
  const { nodes, weights } = gaussLegendre(radialNodes), size = radius + 1, cells = new Float64Array(size * size);
  const ca = new Float64Array(size), cb = new Float64Array(size), angularStep = (Math.PI / 2) / quarter;
  // cos θ and sin θ of every angular node, computed once with the same expressions as inside the loop (same values).
  const cosines = new Float64Array(quarter + 1), sines = new Float64Array(quarter + 1);
  for (let k = 0; k <= quarter; k++) { const theta = k * angularStep; cosines[k] = Math.cos(theta); sines[k] = Math.sin(theta); }
  for (let r = 0; r < radialNodes; r++) {
    const t = nodes[r]!, rho = 1 - t * t;
    // H(1 − t²) without cancellation: acos(1 − t²) = 2·asin(t/√2), ρ·√(1 − ρ²) = ρ·t·√(2 − t²).
    const otf = (2 / Math.PI) * (2 * Math.asin(t / Math.SQRT2) - rho * t * Math.sqrt(2 - t * t));
    // ∫₀¹ g(ρ) dρ = ∫₀¹ g(1 − t²)·2t dt; the 4 is the four symmetric quadrants of the angular trapezoid.
    const radialWeight = weights[r]! * 2 * t * rho * otf * 4 * angularStep;
    for (let k = 0; k <= quarter; k++) {
      const x = beta * rho * cosines[k]!, y = beta * rho * sines[k]!;
      const w = radialWeight * (k === 0 || k === quarter ? 0.5 : 1) * sinc(x) * sinc(y);
      // cos(2π·i·x) and cos(2π·j·y) by the Chebyshev recurrence.
      const cx = Math.cos(2 * Math.PI * x), cy = Math.cos(2 * Math.PI * y);
      ca[0] = 1; cb[0] = 1;
      if (size > 1) { ca[1] = cx; cb[1] = cy; }
      for (let i = 2; i < size; i++) { ca[i] = 2 * cx * ca[i - 1]! - ca[i - 2]!; cb[i] = 2 * cy * cb[i - 1]! - cb[i - 2]!; }
      for (let j = 0; j < size; j++) {
        const wj = w * cb[j]!;
        for (let i = 0; i < size; i++) { const o = j * size + i; cells[o] = cells[o]! + wj * ca[i]!; }
      }
    }
  }
  const area = beta * beta;
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i]! * area;
  return { cells, radialNodes, angularNodes: 4 * quarter };
}

/**
 * Creates a sampled lens PSF profile for an ideal diffraction-limited lens with a circular pupil: one
 * unit-sum Airy kernel per wavelength on one shared (2R+1)² grid, with the truncated energy reported per
 * wavelength. The profile declares the given focal length, f-number and focus exactly, and the field axes
 * ±`fieldHalfExtentMm` with the same kernel at every field node.
 * @param input - See `CreateDiffractionLimitedPsfProfileInput`.
 * @returns The profile and its diffraction record. An approximation; not a measured lens.
 * @see docs/PSF_FOUNDATION.md, "Diffraction-limited sampled profile (2.1)".
 */
export function createDiffractionLimitedPsfProfile(input: CreateDiffractionLimitedPsfProfileInput): CalculationResult<DiffractionLimitedPsfProfile> {
  const r = requireAllowlistedRecord(input, ["aperture", "focalLengthMm", "apertureFNumber", "focus", "wavelengthsNm", "samplePitchMicrometers",
    "kernelRadiusSamples", "fieldHalfExtentMm", "profileId"], "Invalid diffraction-limited PSF profile input.");
  if (r.aperture !== "circular") throw new InvalidConfigurationError("aperture must be \"circular\".");
  const focalLengthMm = positive(r.focalLengthMm, "focalLengthMm"), fNumber = positive(r.apertureFNumber, "apertureFNumber");
  const pitch = positive(r.samplePitchMicrometers, "samplePitchMicrometers");
  const L = DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS;
  const radius = r.kernelRadiusSamples;
  if (typeof radius !== "number" || !Number.isSafeInteger(radius) || radius < 0 || radius > L.maximumKernelRadiusSamples) {
    throw new InvalidConfigurationError("kernelRadiusSamples must be an integer from 0 to " + L.maximumKernelRadiusSamples + ".");
  }
  const focus = requireAllowlistedRecord(r.focus, ["kind", "distanceM"], "Invalid focus.");
  let focusDiopters: number, distanceMm: number;
  if (focus.kind === "infinity") {
    if (focus.distanceM !== undefined) throw new InvalidConfigurationError("An infinity focus has no distanceM.");
    focusDiopters = 0; distanceMm = focalLengthMm;
  } else if (focus.kind === "finite") {
    const distanceM = positive(focus.distanceM, "focus.distanceM");
    focusDiopters = 1 / distanceM;
    distanceMm = calculateThinLensImageDistance({ focalLengthMm, objectDistanceM: distanceM }).value.imageDistanceMm;
  } else throw new InvalidConfigurationError("focus.kind must be finite or infinity.");
  const field = requireAllowlistedRecord(r.fieldHalfExtentMm, ["x", "y"], "Invalid fieldHalfExtentMm.");
  const fieldX = positive(field.x, "fieldHalfExtentMm.x"), fieldY = positive(field.y, "fieldHalfExtentMm.y");
  const list = r.wavelengthsNm;
  if (!Array.isArray(list) || list.length < 1 || list.length > L.maximumWavelengths) throw new InvalidConfigurationError("wavelengthsNm must list 1 to " + L.maximumWavelengths + " wavelengths.");
  const wavelengths = (list as unknown[]).map((value, index) => positive(value, "wavelengthsNm[" + index + "]"));
  for (let i = 1; i < wavelengths.length; i++) if (!(wavelengths[i]! > wavelengths[i - 1]!)) throw new InvalidConfigurationError("wavelengthsNm must be strictly increasing.");
  if (typeof r.profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.profileId)) throw new InvalidConfigurationError("profileId must be a public opaque ID.");

  const pupilDiameterMm = focalLengthMm / fNumber, workingFNumber = distanceMm / pupilDiameterMm, size = 2 * radius + 1;
  let maximumRadialNodes = 0, maximumAngularNodes = 0, maximumTruncated = 0;
  const records: DiffractionLimitedPsfWavelength[] = [], kernels: number[][] = [], realSpaceWavelengthsNm: number[] = [];
  for (const nm of wavelengths) {
    const lambdaN = nm / 1000 * workingFNumber, cutoff = 1 / lambdaN;
    const airy = calculateAiryCellEnergies(pitch * cutoff, radius);
    if (airy.realSpace) realSpaceWavelengthsNm.push(nm);
    maximumRadialNodes = Math.max(maximumRadialNodes, airy.radialNodes); maximumAngularNodes = Math.max(maximumAngularNodes, airy.angularNodes);
    const values: number[] = new Array(size * size);
    let captured = 0;
    for (let ky = 0; ky < size; ky++) for (let kx = 0; kx < size; kx++) {
      const value = airy.cells[Math.abs(ky - radius) * (radius + 1) + Math.abs(kx - radius)]!;
      // Every cell energy of a non-negative PSF is positive; a negative value would be a quadrature failure.
      if (!(value > -1e-13)) throw new InvalidConfigurationError("Diffraction cell integration failed to converge.");
      values[ky * size + kx] = Math.max(0, value);
      captured += values[ky * size + kx]!;
    }
    if (!(captured > 0 && captured <= 1 + 1e-9)) throw new InvalidConfigurationError("Diffraction cell integration failed to converge.");
    const truncated = Math.max(0, 1 - captured);
    maximumTruncated = Math.max(maximumTruncated, truncated);
    const kernel = values.map((v) => v / captured);
    kernels.push(kernel);
    records.push({ wavelengthNm: nm, cutoffFrequencyCyclesPerMicrometer: cutoff, firstZeroRadiusMicrometers: AIRY_FIRST_ZERO_PER_LAMBDA_N * lambdaN,
      capturedEnergyFraction: captured, truncatedEnergyFraction: truncated, centreSampleFraction: kernel[radius * size + radius]! });
  }
  const uncertainty = { kind: "not-quantified" as const, limitation: "Ideal diffraction-limited model; no measured lens or quadrature error bound." };
  const nodes = [-fieldX, fieldX].flatMap((fx) => [-fieldY, fieldY].flatMap((fy) => wavelengths.map((nm, index) => ({
    nodeId: "airy-" + (fx < 0 ? "xm" : "xp") + "-" + (fy < 0 ? "ym" : "yp") + "-" + index,
    coordinate: { focalLengthMm, focusDiopters, apertureFNumber: fNumber, fieldXmm: fx, fieldYmm: fy, wavelengthNm: nm, signedDefocusImagePlaneMicrometers: 0 },
    kernel: { widthSamples: size, heightSamples: size, samplePitchMicrometersX: pitch, samplePitchMicrometersY: pitch, centerSampleX: radius, centerSampleY: radius,
      normalizedIntensity: kernels[index]! },
    bestFocusImagePlaneOffsetMicrometers: 0, relativePupilThroughputFactor: 1, evidence: EVIDENCE, uncertainty }))));
  const profile = parseLensSampledPsfProfile({ schemaVersion: "0.1.0", profileId: r.profileId, profileVersion: DIFFRACTION_LIMITED_PSF_PROFILE_MODEL.modelVersion,
    scientificStatus: "approximation", opticalDomain: "lens-primary-optical-path-only", coordinateSystem: "image-plane-metric", fieldAxes: "+X right, +Y up",
    kernelEnergyNormalization: "unit-energy-shape", interpolation: "bounded-regular-grid-multilinear", throughputOwnership: "separate-relative-pupil-throughput-factor",
    responseIncludes: { diffraction: true, aberration: false, defocus: false, pupilClippingShape: false },
    sensorOpticalStackIncluded: false, sensorSamplingIncluded: false, reconstructionIncluded: false, strayLightIncluded: false,
    axes: { focalLengthMm: [focalLengthMm], focusDiopters: [focusDiopters], apertureFNumber: [fNumber], fieldXmm: [-fieldX, fieldX], fieldYmm: [-fieldY, fieldY],
      wavelengthNm: wavelengths, signedDefocusImagePlaneMicrometers: [0] },
    nodes, evidence: EVIDENCE, limitations: [...LIMITATIONS] });
  return approximationResult({ profile, model: DIFFRACTION_LIMITED_PSF_PROFILE_MODEL, pupilDiameterMm, pupilToImageDistanceMm: distanceMm, workingFNumber,
    kernelRadiusSamples: radius, samplePitchMicrometers: pitch, wavelengths: records, maximumTruncatedEnergyFraction: maximumTruncated,
    quadrature: realSpaceWavelengthsNm.length === 0 ? { method: "polar-frequency-domain-trapezoid-gauss-legendre" as const, maximumRadialNodes, maximumAngularNodes } :
      { method: realSpaceWavelengthsNm.length === wavelengths.length ? "real-space-encircled-energy-gauss-legendre" as const : "frequency-domain-and-real-space" as const,
        maximumRadialNodes, maximumAngularNodes, realSpaceWavelengthsNm } },
  DIFFRACTION_LIMITED_PSF_PROFILE_MODEL.modelId, DIFFRACTION_LIMITED_PSF_PROFILE_MODEL.modelVersion, [...LIMITATIONS]);
}
