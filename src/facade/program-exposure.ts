// SPDX-License-Identifier: Apache-2.0

/**
 * The capture facade's exposure anchor, lens range and generic program line (#569, #583, #585), in a module of their own so
 * that `simulateCapture` and the standalone `calculateProgramLine` (#614) build them with the same code and cannot disagree.
 * @see docs/USAGE.md, "The capture facade's program line and the lens's f-number range".
 */

import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import type { GenericTierLensAssets } from "../equipment/generic-tier-assets.js";
import { parseExposureProgramLineProfile, type ExposureProgramLineProfile } from "../exposure/program-line.js";

/** The facade's exposure anchor: f/8, 1/125 s, ISO 100 (its defaults). */
export const FACADE_EXPOSURE_ANCHOR = /* @__PURE__ */ Object.freeze({ fNumber: 8, shutterSeconds: 1 / 125, iso: 100 });

/** A lens's f-number range as the facade uses it (the prime, catalogue or ideal lens). */
export interface FacadeLensRange { id: string; focalLengthMm: number; widestFNumber: number; narrowestFNumber: number }

/**
 * #569, #585, #554: the exposure anchor and the f-number clamp to the lens's range. A lens whose range excludes f/8 takes the
 * anchor at the aperture of its range nearest f/8, N0, with t = 1/125 s × (N0/8)² (the same N²/t); when that t is shorter than
 * the body's shortest shutter, the shortest shutter. A profile whose range starts above ISO 100 takes the same N²/(t·S) at its
 * base ISO (a shorter t).
 */
export function facadeExposureAnchor(lensRange: Pick<FacadeLensRange, "widestFNumber" | "narrowestFNumber"> | undefined, shutterMinimumSeconds: number,
  baseIso: number | undefined): { clamp: (n: number) => number; sameShutter: number; reference: { aperture: number; shutterSeconds: number; iso: number } } {
  const anchor = FACADE_EXPOSURE_ANCHOR;
  const clamp = (n: number): number => lensRange ? Math.min(lensRange.narrowestFNumber, Math.max(lensRange.widestFNumber, n)) : n, referenceAperture = clamp(anchor.fNumber);
  // (N0/8)² is exactly 1 at f/8, so f/8 keeps 1/125 s exactly.
  const sameShutter = anchor.shutterSeconds * (referenceAperture / anchor.fNumber) ** 2;
  const referenceIso = baseIso !== undefined && baseIso > anchor.iso ? baseIso : anchor.iso;
  return { clamp, sameShutter, reference: { aperture: referenceAperture, shutterSeconds: Math.max(sameShutter * anchor.iso / referenceIso, shutterMinimumSeconds), iso: referenceIso } };
}

/** The lens's exposure profile with the range's focal length and f-numbers (the body's lens otherwise). */
export function facadeLensRangeExposure(exposure: GenericTierLensAssets["exposure"], lensRange: FacadeLensRange | undefined,
  evidence: readonly EvidenceProvenance[]): GenericTierLensAssets["exposure"] {
  return lensRange ? { ...exposure, profileId: "photivra-" + lensRange.id + ":exposure",
    focalLengthMmRange: { ...exposure.focalLengthMmRange, value: { minimum: lensRange.focalLengthMm, maximum: lensRange.focalLengthMm } },
    aperture: { ...exposure.aperture, widestAvailableFNumber: { kind: "constant" as const, fNumber: { value: lensRange.widestFNumber, evidence } },
      narrowestAvailableFNumber: { value: lensRange.narrowestFNumber, evidence } } } as GenericTierLensAssets["exposure"] : exposure;
}

/**
 * The facade's generic program line. Written for the engine, relative to the f/8, 1/125 s reference: for less light it first
 * opens the aperture toward f/4, then lengthens the shutter; for more light it first closes toward f/16, then shortens the
 * shutter. #583: a lens range without f/4–f/16 moves those ends to the range (wide/narrow, the line's f/4 and f/16 clamped to
 * it): the same shape, the aperture held at the range's end and the shutter taking up the stops (stops = log2 of t/N² over the
 * anchor's t/N²; #585 may move the anchor), still from 1/2000 s to 1.024 s. #673: an anchor other than f/8, 1/125 s (a sensor profile
 * whose base ISO is above 100) takes the same computed nodes for f/4–f/16, the f/8 node left out (it lies on the line between them),
 * under the profile id "facade-generic-program-line-base-iso".
 */
export function facadeProgramLine(wide: number, narrow: number, anchor: { aperture: number; shutterSeconds: number }, evidence: readonly EvidenceProvenance[]): ExposureProgramLineProfile {
  // #673: the fixed nodes' stops are from f/8, 1/125 s; any other anchor (a profile's base ISO above 100) takes the computed nodes.
  const own = wide === 4 && narrow === 16 && anchor.aperture === 8 && anchor.shutterSeconds === 1 / 125;
  return parseExposureProgramLineProfile({ schemaVersion: "0.1.0", profileId: "facade-generic-program-line" + (own ? "" : wide === 4 && narrow === 16 ? "-base-iso" : "-lens-range"), profileVersion: "1.0.0",
    scientificStatus: "approximation", policyKind: "generic-program-line", interpolation: "log2-aperture-shutter", evidence,
    limitations: ["Generic educational program line authored for the capture facade; not any manufacturer's program."],
    nodes: (own ? [["minus-6", -6, 16, 1 / 2000], ["minus-2", -2, 16, 1 / 125], ["zero", 0, 8, 1 / 125], ["plus-2", 2, 4, 1 / 125], ["plus-9", 9, 4, 128 / 125]] as const :
      [[narrow, 1 / 2000], [narrow, 1 / 125], [wide, 1 / 125], [wide, 128 / 125]].filter((_, i) => i !== 2 || wide < narrow)
        .map(([aperture, shutterSeconds], i) => ["n" + i, Math.log2(shutterSeconds! * anchor.aperture ** 2 / anchor.shutterSeconds / aperture! ** 2), aperture!, shutterSeconds!] as const))
      .map(([nodeId, opticalExposureStopsFromReference, aperture, shutterSeconds]) => ({ nodeId, opticalExposureStopsFromReference, aperture, shutterSeconds })) });
}
