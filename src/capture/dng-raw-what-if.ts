// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * #607 go items (2.24.0): a seeded RAW-to-RAW what-if on an imported, unprocessed mosaic DNG, from the file's own NoiseProfile.
 *
 * Model (DNG 1.7.1.0 NoiseProfile; Foi, Trimeche, Katkovnik & Egiazarian 2008, IEEE TIP 17(10), Gaussian approximation of
 * Poisson–Gaussian noise): x = (code − black)/(WhiteLevel − black), var(x) = S·x + O per color plane. A capture with f = 2^stops
 * of the light (stops ≤ 0) at an ISO g times the photo's has the mean x' = f·g·x. Within one conversion-gain mode the input-referred
 * read noise is unchanged, so its profile is S' = g·S, O' = g²·(O − q) + q, with q = 1/12 LSB² the quantization variance (in x
 * units). The noise added per site is Gaussian with variance
 *   v = S'·x' + O' − (f·g)²·(S·x + O) − q = f·g²·S·x·(1 − f) + g²·O·(1 − f²) − g²·q   (≥ 0 for f ≤ 1, g ≥ 1, up to the q term),
 * evaluated at the site's own value x̂ (unbiased, because the variance is linear in the mean), computed per site at use (no table).
 * More light (f > 1) would need negative added variance, that is, noise removal: a brighter version is offered only as
 * "brightened in editing" (a development push, the same noise), never as a cleaner capture. A lower ISO likewise.
 *
 * Validated on engine captures of known truth (#607, docs/research/photo-feasibility.md, section 1): two stops darker, 27 of 28
 * channel × level variances within the 95 % interval of a real two-stop-shorter capture; ISO ×4 and ×8 within one gain mode, the
 * same as with the real target ISO's noise model (97 of 101 within). Across a dual-gain switch the photo's own profile gives up to
 * 2.0× too much shadow variance, so an ISO change that crosses the switch is refused (owner decision, 2026-11-11).
 */

import { InvalidScientificInputError } from "../core/validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { createResettableUniformStream, deriveNativeSiteStreamSeedUint32, samplePortableStandardNormal } from "../sensor/stochastic-seed.js";
import type { ImportedDngNoiseProfilePlane, ImportedDngRaw } from "./dng-import.js";
import { estimateDngRawNoise, prepareDngSiteAccess } from "./dng-raw-measurements.js";
import { DNG_GAIN_SWITCH_CATALOG, findDngGainSwitch, type DngGainSwitchEntry } from "./dng-gain-switch.js";

/** The stream id of the what-if's per-site Gaussian draws ("WHIF"), distinct from the capture's charge and read-noise streams. */
const WHAT_IF_STREAM_ID = 0x57484946;
/**
 * A measured σ below this fraction of the NoiseProfile's means the file's noise was reduced after capture (design threshold, owner
 * decision 2026-11-11; #607 phone RAW: 0.084). 32 engine RAWs of smooth and textured scenes at ISO 100–12800 measure 0.95 or more on
 * the green plane (test/dng-raw-analysis.test.ts), so none is refused.
 */
export const DNG_WHAT_IF_MINIMUM_MEASURED_TO_PROFILE = 0.85;

export interface DngRawWhatIfRequest {
  /**
   * Exposure change, stops (−10 to +10, default 0). Negative: less light reaches the sensor (a shorter shutter or smaller aperture),
   * simulated with consistent shot and read noise. Positive: "brightened in editing" (returned as `developmentPushStops`; the codes
   * keep their noise), never a longer exposure.
   */
  exposureStops?: number;
  /** The ISO setting to simulate, at least the photo's (default the photo's). With the same light the result is brighter. */
  iso?: number;
  /** The photo's ISO when the file does not state it (default `raw.exif.iso`). */
  sourceIso?: number;
  /**
   * The camera's dual-gain switch: the ISO setting from which it uses its high conversion gain, or null when it has one conversion
   * gain at every ISO. Needed for an ISO change (the file does not state it): when omitted, the camera's entry in
   * `DNG_GAIN_SWITCH_CATALOG` (by Make and Model) is used; without one the ISO change is refused (`gain-mode-unknown`). An ISO change
   * that crosses the switch is refused.
   */
  highGainFromIso?: number | null;
  /** uint32 seed of the added noise (deterministic: the same seed gives the same codes on every engine). */
  seed: number;
  /** Check the NoiseProfile against the measured noise and refuse a file whose noise was reduced (default true). */
  verifyNoiseProfile?: boolean;
}

/** Why a what-if is refused. */
export type DngRawWhatIfRefusalReason =
  | "not-a-mosaic" | "lossy-raw-data" | "no-noise-profile" | "half-size-preview" | "linearization-table"
  | "noise-profile-mismatch" | "iso-unknown" | "iso-below-photo" | "gain-mode-unknown" | "crosses-gain-switch";
export interface DngRawWhatIfRefusal { reason: DngRawWhatIfRefusalReason; message: string }
export interface DngRawWhatIfAssessment { allowed: boolean; refusals: DngRawWhatIfRefusal[] }

/** A refused what-if: `refusals` lists every reason. */
export class DngRawWhatIfRefusedError extends InvalidScientificInputError {
  readonly refusals: readonly DngRawWhatIfRefusal[];
  constructor(refusals: readonly DngRawWhatIfRefusal[]) {
    super("simulateDngRawWhatIf: " + refusals.map((r) => r.message).join(" "));
    this.name = "DngRawWhatIfRefusedError";
    this.refusals = refusals;
  }
}

export interface DngRawWhatIfResult {
  /** The simulated RAW: the same metadata with new codes and the target NoiseProfile (Exif still describes the original capture). */
  raw: ImportedDngRaw;
  /** "simulated-capture" (less light and/or a higher ISO), "brightened-in-editing" (only a push), both, or "unchanged". */
  kind: "simulated-capture" | "brightened-in-editing" | "simulated-capture-brightened-in-editing" | "unchanged";
  /** The label a preview must carry. */
  label: string;
  /** Light reaching the sensor relative to the photo (2^min(stops, 0)). */
  lightFactor: number;
  /** ISO relative to the photo (target ÷ photo ISO). */
  isoFactor: number;
  /** The push a development applies for a positive `exposureStops` (0 otherwise): brightened in editing, the same noise. */
  developmentPushStops: number;
  sourceIso: number | null;
  targetIso: number | null;
  /** Sites that reached the white level in the simulation and were below it in the photo. */
  newlyClippedSites: number;
  /** The gain switch the ISO check used and where it came from ("not-needed" without an ISO change). */
  gainSwitch: { highGainFromIso: number | null; from: "request" | "catalog" | "not-needed"; entry: DngGainSwitchEntry | null };
  /** The measured ÷ stated σ of the check (green plane where there is one), or null when the check was off. */
  measuredToProfile: number | null;
  assumptions: string[];
}

function fail(message: string, name = "simulateDngRawWhatIf"): never { throw new InvalidConfigurationError(name + ": " + message); }

interface Parsed { stops: number; iso: number | undefined; sourceIso: number | undefined; switchIso: number | null | undefined; seed: number; verify: boolean }
function parseRequest(request: DngRawWhatIfRequest, name: string): Parsed {
  if (request === null || typeof request !== "object") fail("request must be an object.", name);
  for (const key of Object.keys(request)) if (!["exposureStops", "iso", "sourceIso", "highGainFromIso", "seed", "verifyNoiseProfile"].includes(key)) fail("unknown field " + JSON.stringify(key) + ".", name);
  const stops = request.exposureStops ?? 0;
  if (typeof stops !== "number" || !(stops >= -10 && stops <= 10)) fail("exposureStops must be a number from −10 to 10.", name);
  const iso = (v: unknown, label: string): number | undefined => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !(v >= 1 && v <= 10_000_000)) fail(label + " must be a number from 1 to 10 000 000.", name);
    return v;
  };
  const switchIso = request.highGainFromIso;
  if (switchIso !== undefined && switchIso !== null) iso(switchIso, "highGainFromIso");
  if (!Number.isInteger(request.seed) || request.seed < 0 || request.seed > 0xffffffff) fail("seed must be a uint32 integer.", name);
  if (request.verifyNoiseProfile !== undefined && typeof request.verifyNoiseProfile !== "boolean") fail("verifyNoiseProfile must be a boolean.", name);
  return { stops, iso: iso(request.iso, "iso"), sourceIso: iso(request.sourceIso, "sourceIso"), switchIso, seed: request.seed, verify: request.verifyNoiseProfile ?? true };
}

/** Refusals of the request, not of the file: the file's own noise can still be checked. */
const REQUEST_REASONS: ReadonlySet<DngRawWhatIfRefusalReason> = new Set(["iso-unknown", "iso-below-photo", "gain-mode-unknown", "crosses-gain-switch"]);
/** Internal: the check, with the measured ratio. */
function check(raw: ImportedDngRaw, p: Parsed, name: string): { refusals: DngRawWhatIfRefusal[]; measured: number | null; gainSwitch: DngRawWhatIfResult["gainSwitch"] } {
  const refusals: DngRawWhatIfRefusal[] = [], refuse = (reason: DngRawWhatIfRefusalReason, message: string): void => { refusals.push({ reason, message }); };
  prepareDngSiteAccess(raw, name);
  if (raw.photometricInterpretation !== "cfa" || !raw.cfa)
    refuse("not-a-mosaic", "The file is LinearRaw (already demosaiced, often denoised): its noise is correlated across pixels, so noise added per pixel would look wrong.");
  if (raw.lossySource) refuse("lossy-raw-data", "The raw data is lossy; its coding error is not in the NoiseProfile.");
  if (!raw.noiseProfile) refuse("no-noise-profile", "The file has no NoiseProfile (tag 51041), so its sensor noise is unknown.");
  if (raw.scale !== 1) refuse("half-size-preview", "A half-size preview has averaged codes; import the full image.");
  if (raw.linearizationTable) refuse("linearization-table", "The file stores codes through a LinearizationTable; this what-if needs linear codes (not supported in 2.24.0).");
  const changesIso = p.iso !== undefined, source = p.sourceIso ?? raw.exif?.iso ?? undefined;
  const entry = p.switchIso === undefined && changesIso ? findDngGainSwitch(raw.make, raw.model, DNG_GAIN_SWITCH_CATALOG) : null;
  const switchIso = p.switchIso !== undefined ? p.switchIso : entry ? entry.highGainFromIso : undefined;
  const gainSwitch: DngRawWhatIfResult["gainSwitch"] = !changesIso ? { highGainFromIso: null, from: "not-needed", entry: null }
    : { highGainFromIso: switchIso ?? null, from: p.switchIso !== undefined ? "request" : "catalog", entry };
  if (changesIso) {
    if (source === undefined) refuse("iso-unknown", "The photo's ISO is not stated in the file; pass sourceIso.");
    else if (p.iso! < source) refuse("iso-below-photo", "A lower ISO than the photo's would need less noise than the photo has (noise removal).");
    else if (p.iso! > source) {
      if (switchIso === undefined) refuse("gain-mode-unknown", "The file does not state the camera's dual-gain switch and the camera (" + (raw.make ?? "unknown make") + " " + (raw.model ?? "unknown model") + ") is not in DNG_GAIN_SWITCH_CATALOG; pass highGainFromIso (or null for a single conversion gain) so the ISO change stays within the photo's gain mode.");
      else if (switchIso !== null && source < switchIso && p.iso! >= switchIso)
        refuse("crosses-gain-switch", "ISO " + p.iso + " uses the camera's high conversion gain (from ISO " + switchIso + ") and the photo (ISO " + source + ") the low one; its read noise is not in this file, so it cannot be shown accurately.");
    }
  }
  let measured: number | null = null;
  if (p.verify && refusals.every((r) => REQUEST_REASONS.has(r.reason))) {
    const noise = estimateDngRawNoise(raw), green = noise.planes.find((q) => q.color === "green") ?? noise.planes[0]!;
    measured = green.measuredToProfile;
    if (measured !== null && measured < DNG_WHAT_IF_MINIMUM_MEASURED_TO_PROFILE)
      refuse("noise-profile-mismatch", "The measured noise is " + Math.round(measured * 100) + " % of the NoiseProfile's: the data was denoised or merged after capture, so the profile does not describe these pixels.");
  }
  return { refusals, measured, gainSwitch };
}

/** Whether a what-if is possible on this file, and every reason it is not (the same checks {@link simulateDngRawWhatIf} makes). */
export function assessDngRawWhatIf(raw: ImportedDngRaw, request: DngRawWhatIfRequest): DngRawWhatIfAssessment {
  const refusals = check(raw, parseRequest(request, "assessDngRawWhatIf"), "assessDngRawWhatIf").refusals;
  return { allowed: refusals.length === 0, refusals };
}

/**
 * The RAW of the same scene with less light and/or a higher ISO, seeded (see the module comment); a positive `exposureStops` is
 * returned as a development push, labeled "brightened in editing". Throws {@link DngRawWhatIfRefusedError} with every reason when the
 * file or the request cannot be shown accurately.
 */
export function simulateDngRawWhatIf(raw: ImportedDngRaw, request: DngRawWhatIfRequest): DngRawWhatIfResult {
  const p = parseRequest(request, "simulateDngRawWhatIf"), { refusals, measured, gainSwitch } = check(raw, p, "simulateDngRawWhatIf");
  if (refusals.length) throw new DngRawWhatIfRefusedError(refusals);
  const source = p.sourceIso ?? raw.exif.iso, target = p.iso ?? source;
  const f = 2 ** Math.min(p.stops, 0), g = p.iso !== undefined && source !== null ? p.iso / source : 1, push = Math.max(p.stops, 0);
  const site = prepareDngSiteAccess(raw, "simulateDngRawWhatIf"), profile = raw.noiseProfile!;
  const { width, activeArea: a, whiteLevel } = raw, ax = Math.floor(a.x), ay = Math.floor(a.y), aw = Math.floor(a.width), ah = Math.floor(a.height);
  const white = whiteLevel[0]!, codes = Uint16Array.from(raw.codes), stream = createResettableUniformStream(), gain = f * g;
  const target2: ImportedDngNoiseProfilePlane[] = profile.map((q) => ({ scale: q.scale, offset: q.offset }));
  let newlyClipped = 0;
  const captured = f !== 1 || g !== 1;
  if (captured) {
    for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) {
      const i = y * width + x, code = raw.codes[i]!;
      if (code >= white) continue; // clipped sites stay clipped
      const rx = x - ax, ry = y - ay, black = site.black(rx, ry, 0), span = white - black;
      if (!(span > 0)) continue;
      const q = 1 / 12 / (span * span), np = profile[site.planeOf(rx, ry, 0)]!, xs = (code - black) / span, mu = Math.max(0, xs);
      const added = Math.max(0, f * g * g * np.scale * mu * (1 - f) + g * g * np.offset * (1 - f * f) - g * g * q);
      stream.reset(deriveNativeSiteStreamSeedUint32(p.seed, i >>> 0, WHAT_IF_STREAM_ID));
      const value = gain * xs + Math.sqrt(added) * samplePortableStandardNormal(stream);
      const out = Math.min(white, Math.max(0, Math.round(black + value * span)));
      if (out >= white) newlyClipped++;
      codes[i] = out;
    }
    // The target profile: S' = g·S, O' = g²·(O − q) + q (q at the plane's mean black; the input-referred read noise is unchanged).
    const blackMean = raw.blackLevel.values.reduce((s, v) => s + v, 0) / raw.blackLevel.values.length, q = 1 / 12 / (white - blackMean) ** 2;
    for (let k = 0; k < target2.length; k++) target2[k] = { scale: g * profile[k]!.scale, offset: g * g * Math.max(0, profile[k]!.offset - q) + q };
  }
  const kind = captured ? (push > 0 ? "simulated-capture-brightened-in-editing" : "simulated-capture") : push > 0 ? "brightened-in-editing" : "unchanged";
  const parts: string[] = [];
  if (f < 1) parts.push(fmt(-Math.log2(f)) + " stops less light");
  if (g > 1) parts.push("ISO " + fmt(target!));
  const label = (captured ? "Simulation: this RAW with " + parts.join(" at ") + ", using the sensor's noise model" : "This RAW") +
    (push > 0 ? (captured ? "; then " : " ") + "brightened in editing by " + fmt(push) + " stops (same noise, not a longer exposure)" : "") + ".";
  const assumptions = [
    "Gaussian approximation of Poisson–Gaussian noise from the file's NoiseProfile, var(x) = S·x + O (Foi et al. 2008), evaluated at each site's own value.",
    "NoiseProfile leaves out fixed-pattern noise (PRNU, DSNU, row and column noise); the simulation keeps the photo's own pattern and does not scale it."];
  if (g > 1) assumptions.push("ISO " + fmt(target!) + " in the photo's conversion-gain mode: the input-referred read noise is the photo's; analog and digital gain are treated alike.");
  if (gainSwitch.entry) assumptions.push("Dual-gain switch from DNG_GAIN_SWITCH_CATALOG (" + gainSwitch.entry.make + " " + gainSwitch.entry.model + ": " + gainSwitch.entry.source.title + ").");
  if (raw.opcodeList1?.length) assumptions.push("OpcodeList1 acts on the stored codes and is kept as it is.");
  return { raw: { ...raw, codes, noiseProfile: target2, assumptions: [...raw.assumptions, "whatIf: " + label] }, kind, label, lightFactor: f, isoFactor: g,
    developmentPushStops: push, sourceIso: source ?? null, targetIso: target ?? null, newlyClippedSites: newlyClipped, gainSwitch, measuredToProfile: measured, assumptions };
}

function fmt(v: number): string { return String(Math.round(v * 100) / 100); }
