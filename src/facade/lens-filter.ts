// SPDX-License-Identifier: Apache-2.0

/**
 * 2.25.0 (#624): `lens.filter` of `simulateCapture`, `simulateDisplayView` and `prepareDisplayView`: one front-of-lens filter
 * profile (for example `GENERIC_ND_FILTER_PROFILES[10]`) or several in light-path order (scene side first), as
 * `parseFrontOfLensFilterProfile` and `composeFrontOfLensFilterTransmission` accept them. Loaded on demand with the opt-in kit.
 *
 * The filter multiplies the light reaching the lens, so the facade multiplies the lens transmission by the stack's transmission
 * T(λ) at every wavelength of the transmission samples. Every render path takes the lens transmission per spectral node of each
 * site's own quadrature, so each site integrates through the filter (no per-channel factor). The TTL meter reads through the
 * filter too: each zone's luminance is the photopic integral of L(λ)·T(λ), which for a spectrally flat stack is exactly T times
 * the scene luminance, so the automatic modes resolve the exposure that `calculateFilteredExposureTime` gives (t / T at the same
 * f-number and ISO, before the resolvers' steps and limits).
 *
 * A spectrally flat stack (ND, optical density, linear polarizers, which the bridge treats as neutral for unpolarized scene
 * light) is one factor, resolved at 550 nm as `calculateFilteredExposureTime` resolves it; the air/vacuum wavelength difference
 * (under 0.3 nm in the visible) does not matter for it. A stack with a `spectral-transmission` filter must state its wavelengths
 * in vacuum (the facade's basis) and is sampled at its filters' sample wavelengths and interpolated linearly between them, which
 * is exact for one spectral filter and an approximation for two or more. Every filter must cover the facade's 380–780 nm range.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { composeFrontOfLensFilterTransmission, parseFrontOfLensFilterProfile, type FrontOfLensFilterProfile } from "../optics/front-of-lens-filter.js";

/** The resolved `lens.filter` of a request. */
export interface ResolvedLensFilter {
  profiles: readonly FrontOfLensFilterProfile[];
  filterIds: readonly string[];
  /** True when no filter is `spectral-transmission`: the stack is one factor at every wavelength. */
  spectrallyFlat: boolean;
  /** The stack's transmittance at 550 nm (the `calculateFilteredExposureTime` default wavelength). */
  linearTransmissionFactor: number;
  /** −log2 of `linearTransmissionFactor`. */
  attenuationStops: number;
  scientificStatus: "approximation" | "calibrated";
  /** The stack's transmittance at the given wavelengths (vacuum, nm), each within the facade range. */
  sampleWavelengths: readonly number[];
  transmissionAt(wavelengthNanometers: number): number;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}

const FLAT_WAVELENGTH = 550;

/** Parses and resolves `lens.filter` over `range` (the facade's vacuum wavelength range). */
export function resolveLensFilter(value: unknown, range: { minimum: number; maximum: number }): ResolvedLensFilter {
  const list: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.length > 8) throw new InvalidConfigurationError("lens.filter must be a front-of-lens filter profile or an array of 1 to 8 of them.");
  const profiles = list.map((p, i) => {
    let parsed: FrontOfLensFilterProfile;
    try { parsed = parseFrontOfLensFilterProfile(p); } catch (error) {
      throw new InvalidConfigurationError("lens.filter" + (Array.isArray(value) ? "[" + i + "]" : "") + ": " + (error instanceof Error ? error.message : String(error)));
    }
    const r = parsed.wavelengthRangeNanometers;
    if (r.minimum > range.minimum || r.maximum < range.maximum)
      throw new InvalidConfigurationError("lens.filter " + parsed.filterId + " covers " + r.minimum + "–" + r.maximum + " nm; the capture needs " + range.minimum + "–" + range.maximum + " nm.");
    return parsed;
  });
  const basis = profiles[0]!.wavelengthBasis;
  if (profiles.some((p) => p.wavelengthBasis !== basis)) throw new InvalidConfigurationError("lens.filter: every filter must state its wavelengths in the same basis (air or vacuum).");
  const spectral = profiles.filter((p) => p.transmission.kind === "spectral-transmission");
  if (spectral.length > 0 && basis !== "vacuum")
    throw new InvalidConfigurationError("lens.filter: a spectral-transmission filter must state its wavelengths in vacuum, the capture's basis.");
  const at = (nm: number): number => composeFrontOfLensFilterTransmission({ filters: profiles, wavelengthNanometers: nm, wavelengthBasis: basis }).combinedLinearTransmissionFactor;
  const flat = spectral.length === 0, composed = composeFrontOfLensFilterTransmission({ filters: profiles, wavelengthNanometers: FLAT_WAVELENGTH, wavelengthBasis: basis });
  const t = composed.combinedLinearTransmissionFactor;
  const wavelengths = flat ? [range.minimum, range.maximum] : [...new Set([range.minimum, range.maximum, ...spectral.flatMap((p) =>
    (p.transmission as Extract<FrontOfLensFilterProfile["transmission"], { kind: "spectral-transmission" }>).samples.value.map((s) => s.wavelengthNanometers))
    .filter((nm) => nm > range.minimum && nm < range.maximum)])].sort((a, b) => a - b);
  const table = new Map(wavelengths.map((nm) => [nm, flat ? t : at(nm)]));
  const transmissionAt = (nm: number): number => {
    if (flat) return t;
    const exact = table.get(nm);
    if (exact !== undefined) return exact;
    let i = 1;
    while (i < wavelengths.length - 1 && wavelengths[i]! < nm) i++;
    const a = wavelengths[i - 1]!, b = wavelengths[i]!, ta = table.get(a)!, tb = table.get(b)!;
    return ta + (nm - a) / (b - a) * (tb - ta);
  };
  return {
    profiles, filterIds: profiles.map((p) => p.filterId), spectrallyFlat: flat, linearTransmissionFactor: t, attenuationStops: composed.combinedAttenuationStops,
    scientificStatus: composed.scientificStatus, sampleWavelengths: wavelengths, transmissionAt,
    evidence: profiles.flatMap((p) => p.evidence), limitations: [...profiles.flatMap((p) => p.limitations),
      ...(spectral.length > 1 ? ["The stack's transmission is interpolated linearly between its filters' sample wavelengths (an approximation)."] : [])]
  };
}
