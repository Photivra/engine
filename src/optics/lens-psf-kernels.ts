// SPDX-License-Identifier: Apache-2.0

/**
 * Samples the engine's lens PSFs (`LensSampledPsfProfile`, resolved with `resolveLensSampledPsf`) into
 * the per-patch kernels of the isoplanatic convolution (`calculateIrradianceConvolution`, #277).
 *
 * For each patch, the PSF is resolved at the patch centre's field point, in the per-site engine's own
 * coordinates: native sensor millimetres from the optical axis (+Y down), field point (x, −y). Every
 * PSF tap then maps to a site displacement with the per-site quadrature's inverse support
 * (`sensorPsfSourcePoint`): tap (kx, ky) is the source at native offset (−(kx − cx)·pₓ, +(ky − cy)·p_y)
 * from the destination, so its weight lands at displacement u = (kx − cx)·pₓ/sₓ, v = −(ky − cy)·p_y/s_y
 * sites (p: PSF sample pitch, s: site pitch). When p equals s the displacement is taken as the tap offset itself
 * (kx − cx, −(ky − cy)): the rounded quotient (n·p)/p misses the integer n by one unit in the last place for some
 * pitches (for example 3 · 1.6 / 1.6), which split the tap bilinearly or reached one site past the window (2.2.1).
 *
 * - **Exact site sampling.** When every displacement is an integer (equal pitches, integer centre), each
 *   tap's weight goes to one kernel cell. For a destination whose PSF equals its patch's, the
 *   convolution then equals the per-site PSF quadrature at site-centre sources term by term.
 * - **Otherwise (labelled approximation): bilinear splatting.** Each weight is split over the four
 *   surrounding integer displacements with bilinear weights. This is the exact adjoint of bilinear
 *   interpolation, so the convolution equals the per-site quadrature applied to the bilinear interpolant of
 *   the site-centre samples (tested). Weights are conserved.
 *
 * With several wavelengths the kernel is the weight-normalized sum of the per-wavelength kernels. For a
 * spectrally neutral scene that is exactly the per-site engine's spectral sum when the weights are its
 * spectral quadrature weights times the scene spectrum (see docs/WEBGPU.md).
 *
 * The patch approximation (one PSF per patch, indexed by source site) is the caller's choice of patch
 * size; its method error is measured, not bounded (docs/WEBGPU.md, "Per-fixture rollout"). Relative
 * pupil throughput stays a separate factor and is reported, never folded into the unit-energy kernels.
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { IRRADIANCE_CONVOLUTION_LIMITS } from "./irradiance-convolution.js";
import { markEngineOwnedLensSampledPsfProfile, resolveLensSampledPsf, type ResolveLensSampledPsfInput } from "./lens-psf-profile.js";

export const LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION = "0.1.0" as const;
/**
 * At most this many wavelengths per call: 400, the finest spectral sampling of `simulateCapture` (1 nm over 380–780 nm),
 * as `DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS.maximumWavelengths` (64 before 2.15.0). The work is linear in the count.
 */
export const LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS = 400;

export interface LensPsfConvolutionKernelsInput {
  schemaVersion: typeof LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION;
  /** The optical state, as for `resolveLensSampledPsf`, without the field point and wavelength. */
  psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">;
  /** One or more wavelengths with non-negative weights (at least one positive). */
  spectralWeights: readonly { wavelengthNm: number; weight: number }[];
  /** The convolution grid: sites, their pitch, and the optical axis in site units (site centres at i + 0.5). */
  grid: { width: number; height: number; sitePitchMicrometers: { x: number; y: number }; opticalAxisSite: { x: number; y: number } };
  /** Patch size in sites; the last row and column of patches may be partial. */
  patchWidth: number;
  patchHeight: number;
  /** Kernel radius to use; omitted, the smallest radius that holds every tap. A radius too small to hold the PSF is rejected. */
  kernelRadius?: number;
}

export interface LensPsfConvolutionKernels {
  schemaVersion: typeof LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION;
  kernelRadius: number;
  patchWidth: number;
  patchHeight: number;
  patchColumns: number;
  patchRows: number;
  /** `[patchRow][patchColumn][v + r][u + r]`, ready for `IrradianceConvolutionInput.kernels`. */
  kernels: Float64Array;
  /** True when every tap landed on one integer displacement (no bilinear splatting). */
  exactSiteSampling: boolean;
  maximumKernelSum: number;
  /** Per patch, row-major: the field point used and the weight-averaged relative pupil throughput (not applied). */
  patches: readonly { fieldPointMm: { x: number; y: number }; relativePupilThroughputFactor: number; interpolated: boolean }[];
}

function positive(value: unknown, message: string): number {
  if (typeof value !== "number" || !(value > 0 && value <= Number.MAX_VALUE)) throw new InvalidConfigurationError(message);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new InvalidConfigurationError(message);
  return value;
}

/**
 * Builds the per-patch convolution kernels from a sampled lens PSF profile.
 * @param input - See `LensPsfConvolutionKernelsInput`.
 * @returns The kernels and per-patch field points. Success does not imply calibration.
 * @see docs/WEBGPU.md, "Kernels from a lens PSF profile".
 */
export function resolveLensPsfConvolutionKernels(input: LensPsfConvolutionKernelsInput): CalculationResult<LensPsfConvolutionKernels> {
  return resolveKernels(input, undefined);
}

/**
 * Internal (not exported from the package): `resolveLensPsfConvolutionKernels` with `ownedProfile` used in place of a fresh
 * private clone of `input.psf.profile`. `ownedProfile` must be a structured clone of that profile that no caller code can
 * reach, already passed to `markEngineOwnedLensSampledPsfProfile`; repeated calls then share one parse (the clone is frozen
 * and its parse cached on the first resolve), so N one-wavelength calls cost O(N) instead of O(N²) (2.15.0).
 * The values are the same: the public function parses its own clone the same way.
 */
export function resolveLensPsfConvolutionKernelsWithOwnedProfile(input: LensPsfConvolutionKernelsInput, ownedProfile: object): CalculationResult<LensPsfConvolutionKernels> {
  return resolveKernels(input, ownedProfile);
}

function resolveKernels(input: LensPsfConvolutionKernelsInput, ownedProfile: object | undefined): CalculationResult<LensPsfConvolutionKernels> {
  const r = requireAllowlistedRecord(input, ["schemaVersion", "psf", "spectralWeights", "grid", "patchWidth", "patchHeight", "kernelRadius"],
    "Invalid lens PSF convolution kernel input.");
  if (r.schemaVersion !== LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION) throw new InvalidConfigurationError("Unsupported lens PSF convolution kernel schema.");
  const L = IRRADIANCE_CONVOLUTION_LIMITS;
  const g = requireAllowlistedRecord(r.grid, ["width", "height", "sitePitchMicrometers", "opticalAxisSite"], "Invalid convolution grid.");
  const width = integer(g.width, 1, L.maximumDimension, "Invalid convolution grid size."), height = integer(g.height, 1, L.maximumDimension, "Invalid convolution grid size.");
  const pitch = requireAllowlistedRecord(g.sitePitchMicrometers, ["x", "y"], "Invalid site pitch.");
  const sx = positive(pitch.x, "Site pitch must be positive."), sy = positive(pitch.y, "Site pitch must be positive.");
  const axis = requireAllowlistedRecord(g.opticalAxisSite, ["x", "y"], "Invalid optical axis.");
  if (typeof axis.x !== "number" || typeof axis.y !== "number" || !Number.isFinite(axis.x) || !Number.isFinite(axis.y)) {
    throw new InvalidConfigurationError("The optical axis must be finite site coordinates.");
  }
  const patchWidth = integer(r.patchWidth, 1, width, "Invalid patch size."), patchHeight = integer(r.patchHeight, 1, height, "Invalid patch size.");
  const columns = Math.ceil(width / patchWidth), rows = Math.ceil(height / patchHeight);
  if (columns * rows > L.maximumPatchCount) throw new InvalidConfigurationError("Too many patches.");
  const list = r.spectralWeights;
  if (!Array.isArray(list) || list.length < 1 || list.length > LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS) {
    throw new InvalidConfigurationError("spectralWeights must list 1 to " + LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS + " wavelengths.");
  }
  const spectral = list.map((entry: unknown) => {
    const e = requireAllowlistedRecord(entry, ["wavelengthNm", "weight"], "Invalid spectral weight.");
    if (typeof e.weight !== "number" || !(e.weight >= 0 && e.weight <= Number.MAX_VALUE)) throw new InvalidConfigurationError("Spectral weights must be finite and non-negative.");
    return { wavelengthNm: positive(e.wavelengthNm, "Wavelengths must be positive."), weight: e.weight };
  });
  const totalWeight = spectral.reduce((s, e) => s + e.weight, 0);
  if (!(totalWeight > 0 && totalWeight <= Number.MAX_VALUE)) throw new InvalidConfigurationError("At least one spectral weight must be positive.");
  const psf = requireAllowlistedRecord(r.psf, ["profile", "focalLengthMm", "focus", "apertureFNumber", "signedDefocusImagePlaneMicrometers"], "Invalid PSF state.");
  // One private parse of the profile for every patch and wavelength (and, with an owned profile, for every call).
  const profile = ownedProfile ?? structuredClone(psf.profile);
  if (!ownedProfile) markEngineOwnedLensSampledPsfProfile(profile);
  const state = { ...(psf as unknown as Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">), profile } as Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">;

  // Resolve every patch and wavelength, splatting straight into one scratch displacement map sized for the largest
  // allowed radius; each patch keeps a copy cropped to its own reach. The common radius is known only at the end.
  // Every cell receives its weights in the same order as a direct sum (taps in kernel order, then the four
  // bilinear corners), so the kernels do not depend on the scratch layout.
  const M = L.maximumKernelRadius, scratchSize = 2 * M + 1, scratch = new Float64Array(scratchSize * scratchSize);
  const cropped: { reach: number; values: Float64Array }[] = [], patches: LensPsfConvolutionKernels["patches"][number][] = [];
  let reach = 0, exact = true, overflow = false;
  for (let pr = 0; pr < rows; pr++) for (let pc = 0; pc < columns; pc++) {
    const x0 = pc * patchWidth, y0 = pr * patchHeight, x1 = Math.min(width, x0 + patchWidth), y1 = Math.min(height, y0 + patchHeight);
    const nativeX = ((x0 + x1) / 2 - axis.x) * sx / 1000, nativeY = ((y0 + y1) / 2 - axis.y) * sy / 1000;
    const fieldPointMm = { x: nativeX, y: -nativeY };
    let throughput = 0, interpolated = false, patchReach = 0;
    for (const { wavelengthNm, weight } of spectral) {
      if (weight === 0) continue;
      const resolved = resolveLensSampledPsf({ ...state, fieldPointMm, wavelengthNm }).value, k = resolved.kernel, share = weight / totalWeight;
      throughput += share * resolved.relativePupilThroughputFactor;
      if (resolved.resolutionStatus !== "exact-grid-sample") interpolated = true;
      const equalX = k.samplePitchMicrometersX === sx, equalY = k.samplePitchMicrometersY === sy;
      for (let ky = 0; ky < k.heightSamples; ky++) for (let kx = 0; kx < k.widthSamples; kx++) {
        const intensity = k.normalizedIntensity[ky * k.widthSamples + kx]!;
        if (intensity === 0) continue;
        // With equal pitches the displacement is the tap offset itself: (n·p)/p can miss n by one unit in the last place.
        const u = equalX ? kx - k.centerSampleX : (kx - k.centerSampleX) * k.samplePitchMicrometersX / sx;
        const v = equalY ? -(ky - k.centerSampleY) : -(ky - k.centerSampleY) * k.samplePitchMicrometersY / sy;
        const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0, w = share * intensity;
        if (fu !== 0 || fv !== 0) exact = false;
        for (let corner = 0; corner < 4; corner++) {
          const du = corner & 1, dv = corner >> 1;
          const b = du === 0 ? (dv === 0 ? (1 - fu) * (1 - fv) : (1 - fu) * fv) : (dv === 0 ? fu * (1 - fv) : fu * fv);
          if (b === 0) continue;
          const cu = u0 + du, cv = v0 + dv;
          patchReach = Math.max(patchReach, Math.abs(cu), Math.abs(cv));
          // Past the largest radius the call is rejected below; resolving continues so errors keep their order.
          if (patchReach > M) { overflow = true; continue; }
          if (!overflow) scratch[(cv + M) * scratchSize + cu + M]! += w * b;
        }
      }
    }
    reach = Math.max(reach, patchReach);
    if (!overflow) {
      const n = 2 * patchReach + 1, values = new Float64Array(n * n);
      for (let v = -patchReach; v <= patchReach; v++) {
        const row = (v + M) * scratchSize + M;
        values.set(scratch.subarray(row - patchReach, row + patchReach + 1), (v + patchReach) * n);
        scratch.fill(0, row - patchReach, row + patchReach + 1);
      }
      cropped.push({ reach: patchReach, values });
    }
    patches.push(Object.freeze({ fieldPointMm: Object.freeze(fieldPointMm), relativePupilThroughputFactor: throughput, interpolated }));
  }
  const radius = r.kernelRadius === undefined ? reach : integer(r.kernelRadius, 0, L.maximumKernelRadius, "Invalid kernel radius.");
  if (reach > radius) throw new InvalidConfigurationError("The kernel radius is too small for the PSF support; no tap is dropped.");
  if (radius > L.maximumKernelRadius) throw new InvalidConfigurationError("The PSF support needs a kernel radius above 32 sites.");
  const size = 2 * radius + 1, taps = size * size;
  if (columns * rows * taps > L.maximumKernelWeights) throw new InvalidConfigurationError("Too many kernel weights.");
  const kernels = new Float64Array(columns * rows * taps);
  let maximumKernelSum = 0;
  cropped.forEach(({ reach: q, values }, p) => {
    const n = 2 * q + 1;
    let sum = 0;
    for (let v = 0; v < n; v++) kernels.set(values.subarray(v * n, (v + 1) * n), p * taps + (v - q + radius) * size + radius - q);
    for (let t = 0; t < taps; t++) sum += kernels[p * taps + t]!;
    maximumKernelSum = Math.max(maximumKernelSum, sum);
  });
  if (maximumKernelSum > L.maximumKernelSum) throw new InvalidConfigurationError("Sampled kernels exceed unit energy.");
  return approximationResult({ schemaVersion: LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION, kernelRadius: radius, patchWidth, patchHeight,
    patchColumns: columns, patchRows: rows, kernels, exactSiteSampling: exact, maximumKernelSum, patches: Object.freeze(patches) },
  "lens-psf-convolution-kernels", LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION, [
    "One PSF per patch, resolved at the patch centre with resolveLensSampledPsf; indexed by source site in the convolution (isoplanatic patches).",
    exact ? "Every PSF tap maps to one integer site displacement (exact site sampling)." :
      "PSF taps between sites are split bilinearly (the adjoint of bilinear interpolation of site-centre samples); a labelled approximation.",
    "Relative pupil throughput is reported per patch and not applied to the unit-energy kernels."
  ]);
}
