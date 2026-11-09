// SPDX-License-Identifier: Apache-2.0

/**
 * Generic, unbranded neutral-density (ND) filter presets: idealized 3-, 6- and 10-stop filters.
 *
 * "N-stop" means a transmittance of exactly 2^-N (owner decision 2026-11-09, #578): 3 stops is
 * 1/8, 6 stops 1/64 and 10 stops 1/1024, each exact in binary floating point. The presets are
 * spectrally flat (`neutral-linear-transmission`) over 380–780 nm. They are idealizations, not
 * measurements: `scientificStatus` is `"approximation"` and the uncertainty is not quantified,
 * because real ND filters deviate from their nominal rating and are not perfectly flat. Pass one to
 * `calculateFilteredExposureTime` or to any function that takes a front-of-lens filter profile.
 * @see docs/PHYSICS_FOUNDATION.md "Exposure time with an ND filter".
 */

import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { freezeOwnedData } from "../core/owned-data.js";
import type { FrontOfLensFilterProfile } from "./front-of-lens-filter.js";

/** Attenuations, in stops, of the generic ND presets. */
export const GENERIC_ND_FILTER_STOPS = /* @__PURE__ */ Object.freeze([3, 6, 10] as const);

/** One of the generic ND preset attenuations: 3, 6 or 10 stops. */
export type GenericNdFilterStops = (typeof GENERIC_ND_FILTER_STOPS)[number];

function idealNdProfile(stops: GenericNdFilterStops): FrontOfLensFilterProfile {
  const evidence: readonly EvidenceProvenance[] = [{
    sourceOrigin: "photivra",
    sourceReference: "photivra:generic-nd-filter-presets:578",
    reuseStatus: "photivra-owned",
    note: `Idealized: transmittance exactly 2^-${stops} by the definition of a ${stops}-stop filter (owner decision 2026-11-09); not measured, not modelled on any product.`
  }];
  return {
    schemaVersion: "0.1.0",
    filterId: `generic-nd-${stops}-stop`,
    profileVersion: "1.0.0",
    identityScope: "photivra-generic-unbranded",
    position: "front-of-lens",
    scientificStatus: "approximation",
    wavelengthBasis: "air",
    wavelengthRangeNanometers: { minimum: 380, maximum: 780 },
    transmission: {
      kind: "neutral-linear-transmission",
      linearTransmissionFactor: { value: 2 ** -stops, evidence }
    },
    uncertainty: {
      kind: "not-quantified",
      limitation: "Idealized nominal filter: real ND filters deviate from their rating and are not perfectly flat across wavelengths."
    },
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled: false,
    evidence,
    limitations: [
      `Idealized spectrally flat ${stops}-stop filter (transmittance exactly 2^-${stops}); not a measured filter.`
    ]
  };
}

/**
 * Frozen generic ND filter profiles keyed by stops: `GENERIC_ND_FILTER_PROFILES[10]` transmits
 * exactly 1/1024. Spectrally flat over 380–780 nm (air), idealized (`scientificStatus:
 * "approximation"`), unbranded. 1/125 s with the 10-stop preset gives 1024/125 ≈ 8.19 s in
 * `calculateFilteredExposureTime`.
 */
export const GENERIC_ND_FILTER_PROFILES: Readonly<Record<GenericNdFilterStops, FrontOfLensFilterProfile>> = /* @__PURE__ */ freezeOwnedData({
  3: idealNdProfile(3),
  6: idealNdProfile(6),
  10: idealNdProfile(10)
});
