// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (not exported from the package): one wavelength's diffraction kernel sampled on the site pitch, as the object-space
 * convolution (facade/diffraction-provider.ts) and the tabulated expected signal (facade/expected-signal-setup.ts) use it.
 *
 * `resolveLensPsfConvolutionKernels` parses and samples the PSF profile on every call (about 10 ms per wavelength), and both users
 * ask for the same kernels. The kernel is a function of its inputs alone; each caller gets its own copy.
 *
 * The facade builds a new PSF record for every request, so kernels are kept by value: `registerDiffractionPsfKey` records, for a
 * record whose profile `createDiffractionLimitedPsfProfile` built, a canonical string of that call's whole input and of the record's
 * own fields (everything the kernel is a function of besides the wavelength, pitch and radius of the query). Records with an equal
 * string share their kernels, in a least-recently-used cache of `SITE_DIFFRACTION_KERNEL_CACHE_SIZE` records. A record that was not
 * registered (a caller's own profile) keeps its kernels while it lives, by identity, as before.
 *
 * 2.15.0: the most recently used entry also keeps one private, engine-owned clone of the profile, taken on its first resolve,
 * and every later wavelength resolves from it (`resolveLensPsfConvolutionKernelsWithOwnedProfile`), so a request's profile is
 * cloned and parsed once rather than once per wavelength; only one clone is held at a time. Before, N wavelengths cost N clones
 * and parses of an N-wavelength profile, O(N²): at radius 32, 124 s for the 400 nodes of a 1 nm spectral step and 5.1 s for 80
 * nodes, against 1.4 s and 0.12 s now (one machine, docs/PSF_FOUNDATION.md "Spectral nodes (2.15.0)"). The kernels are the same
 * numbers (test/diffraction-spectral-grid.test.ts): both paths parse a structured clone of the same profile, and the clone is never changed.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { resolveLensPsfConvolutionKernelsWithOwnedProfile, type resolveLensPsfConvolutionKernels } from "./lens-psf-kernels.js";
import { markEngineOwnedLensSampledPsfProfile } from "./lens-psf-profile.js";

type Psf = Parameters<typeof resolveLensPsfConvolutionKernels>[0]["psf"];

/** PSF records kept by value: at most 20 kernels of (2·32 + 1)² doubles each (676 KB) per record at the default spectral sampling. */
export const SITE_DIFFRACTION_KERNEL_CACHE_SIZE = 4;

/** Canonical value key of each registered PSF record. */
const keys = new WeakMap<object, string>();
/** One entry's kernels per wavelength, pitch and radius, and its private clone of the profile (taken on the first resolve). */
interface Entry { kernels: Map<string, Float64Array>; ownedProfile?: object }
/** Entries per registered value key (least recently used first). */
const byValue = new Map<string, Entry>();
/** Entries per unregistered PSF record (by identity: the record is large, so it is not serialized). */
const byIdentity = new WeakMap<object, Entry>();
/** The one entry that holds its private clone of the profile. */
let lastOwner: Entry | undefined;
/** Kernels resolved so far (test hook). */
let resolves = 0;

/** JSON with every number spelled exactly: shortest round-trip digits, and -0, NaN and ±Infinity kept apart from 0 and null. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "number" && (Object.is(v, -0) || !Number.isFinite(v)) ? "number:" + (Object.is(v, -0) ? "-0" : String(v)) : v));
}

/**
 * Records that `psf.profile` is the profile `createDiffractionLimitedPsfProfile(profileInput)` returned, unmodified, so that the
 * kernels of `psf` are those of any record with the same `profileInput` and the same other fields. Call it right after building the
 * record; neither the record nor `profileInput` may change afterwards.
 */
export function registerDiffractionPsfKey(psf: Psf, profileInput: object): void {
  const fields = Object.entries(psf as object).filter(([name]) => name !== "profile").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  keys.set(psf as object, canonical(["createDiffractionLimitedPsfProfile", profileInput, fields]));
}

/** The entry kept for `psf`, made the most recently used. */
function entryOf(psf: Psf): Entry {
  const key = keys.get(psf as object);
  if (key === undefined) {
    let entry = byIdentity.get(psf as object);
    if (!entry) byIdentity.set(psf as object, (entry = { kernels: new Map() }));
    return entry;
  }
  let entry = byValue.get(key);
  if (entry) byValue.delete(key);
  else entry = { kernels: new Map() };
  byValue.set(key, entry);
  while (byValue.size > SITE_DIFFRACTION_KERNEL_CACHE_SIZE) byValue.delete(byValue.keys().next().value!);
  return entry;
}

/** The (2·radius + 1)² kernel of `psf` at `wavelengthNm` on a square site grid of `pitchMicrometers`; `failure` is the error message when the kernel cannot sample the pitch exactly. */
export function siteDiffractionKernel(psf: Psf, wavelengthNm: number, pitchMicrometers: number, radius: number, failure: string): Float64Array {
  const entry = entryOf(psf), kernels = entry.kernels;
  const key = canonical([wavelengthNm, pitchMicrometers, radius]);
  let kernel = kernels.get(key);
  if (!kernel) {
    if (!entry.ownedProfile) {
      const owned = structuredClone((psf as { profile: unknown }).profile) as object;
      markEngineOwnedLensSampledPsfProfile(owned);
      // Only the most recent entry keeps its clone (a request resolves its wavelengths in one run), so at most one is held.
      if (lastOwner) delete lastOwner.ownedProfile;
      entry.ownedProfile = owned;
      lastOwner = entry;
    }
    const k = resolveLensPsfConvolutionKernelsWithOwnedProfile({ schemaVersion: "0.1.0", psf, spectralWeights: [{ wavelengthNm, weight: 1 }],
      grid: { width: 1, height: 1, sitePitchMicrometers: { x: pitchMicrometers, y: pitchMicrometers }, opticalAxisSite: { x: 0.5, y: 0.5 } }, patchWidth: 1, patchHeight: 1,
      kernelRadius: radius }, entry.ownedProfile).value;
    if (!k.exactSiteSampling || k.kernelRadius !== radius) throw new InvalidConfigurationError(failure);
    kernel = Float64Array.from(k.kernels);
    resolves++;
    kernels.set(key, kernel);
  }
  return Float64Array.from(kernel);
}

/** Test hook: the number of PSF records kept by value, the kernels resolved so far, and whether `psf` is registered. */
export function siteDiffractionKernelCacheState(psf?: Psf): { valueEntries: number; resolves: number; registered: boolean } {
  return { valueEntries: byValue.size, resolves, registered: psf !== undefined && keys.has(psf as object) };
}

/** Test hook: forgets every kernel kept by value. */
export function clearSiteDiffractionKernelCache(): void {
  byValue.clear();
  lastOwner = undefined;
}
