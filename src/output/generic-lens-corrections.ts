// SPDX-License-Identifier: Apache-2.0

/**
 * The generic correction profile of a catalogue lens (#549), for the post-capture lens corrections
 * (`resolveLensCorrectionPlan`, `calculateLensCorrectedCapture`): a distortion map, a lateral-colour map per channel and a
 * peripheral-illumination gain, each from the lens's own character (`resolveGenericLens`). Consumer lenses rely on it more:
 * their uncorrected distortion and vignetting are larger, so the same profile corrects more. Like every catalogue number it is
 * a labelled approximation, bound to one exact camera state (`OpticalProfileState`).
 */

import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { parseOpticalProfileState, type OpticalProfileState } from "../optics/profile-contract.js";
import { GENERIC_LENS_EVIDENCE, genericLensDispersion, resolveGenericLens } from "../equipment/generic-lens-catalogue.js";
import { parseGenericLensCorrectionProfile, type GenericLensCorrectionProfile, type LensCorrectionChannel } from "./lens-corrections.js";
import type { AffineGeometricTransform } from "./geometric-transforms.js";
import { genericLensChannelScale } from "./developed-lens-corrections.js";

export { GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM } from "./developed-lens-corrections.js";

export interface CreateGenericLensCorrectionProfileInput {
  /** A catalogue id (`GENERIC_LENS_IDS`); `state.lensId` must be the same id. */
  lensId: string;
  /** The sensor's active capture area, mm (the lens is scaled to it as in `resolveGenericLens`). */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** The exact camera state the profile applies to: its focal length must be the lens's on this sensor, its aperture in range. */
  state: OpticalProfileState;
}

/**
 * Builds the catalogue lens's generic correction profile for one camera state: a radial distortion map (the lens's own
 * r_d = r(1 + k1ρ²), read at each ideal destination point), per-channel lateral-colour scales 1 + L·D(λ_channel), and the
 * relative-illumination gain at the state's aperture (strength 1). The result passes `parseGenericLensCorrectionProfile`.
 */
export function createGenericLensCorrectionProfile(input: CreateGenericLensCorrectionProfileInput): GenericLensCorrectionProfile {
  requireInputObject(input, "createGenericLensCorrectionProfile input");
  requireInputKeys(input, "createGenericLensCorrectionProfile", ["lensId", "activeImagingArea", "state"]);
  const state = parseOpticalProfileState(input.state);
  const lens = resolveGenericLens({ lensId: input.lensId, activeImagingArea: input.activeImagingArea, fNumber: state.aperture });
  if (state.lensId !== lens.lensId) throw new InvalidScientificInputError("state.lensId must be the catalogue id " + lens.lensId + ".");
  if (Math.abs(state.focalLengthMm - lens.focalLengthMm) > 1e-9 * lens.focalLengthMm)
    throw new InvalidScientificInputError("state.focalLengthMm must be the " + lens.name + "'s focal length on this sensor, " + lens.focalLengthMm + " mm.");
  const c = lens.character, domain = "reconstructed-linear" as const;
  const identity = { version: "1.0.0", domain, availability: "toggle" as const, defaultEnabled: true, dependencies: [] as string[], requiredByStabilizationModes: [] as string[] };
  const scale = (channel: LensCorrectionChannel): number => genericLensChannelScale(c.lateralColor.fraction, genericLensDispersion, channel);
  const affine = (channel: LensCorrectionChannel): AffineGeometricTransform => ({ id: lens.lensId + ":lateral-ca:" + channel, version: "1.0.0", domain, purpose: "lateral-ca" as const, kind: "affine" as const,
    matrix: [scale(channel), 0, 0, scale(channel)] as [number, number, number, number], offsetMm: { x: 0, y: 0 } });
  return parseGenericLensCorrectionProfile({ schemaVersion: "0.1.0", id: "photivra-" + lens.lensId + ":corrections", version: "1.0.0", state,
    evidence: { kind: "generic-parametric", basis: "Generic catalogue lens " + lens.name + " (#549): the inverse of its own distortion, lateral colour and vignetting.",
      residualNote: "Generic approximation, not a measured lens; axial colour, coma and the other aberrations stay.", sources: [...GENERIC_LENS_EVIDENCE] },
    components: [
      { ...identity, id: "distortion", kind: "geometry", residualNote: "Corrects the lens's radial distortion r_d = r(1 + k1ρ²); the stretched corners lose resolution.",
        transform: { id: lens.lensId + ":distortion", version: "1.0.0", domain, purpose: "distortion", kind: "radial",
          profile: { normalizationRadiusMm: lens.halfDiagonalMm, maximumNormalizedRadius: 1.05, coefficients: { k1: c.distortion.corner, k2: 0, k3: 0 } } } },
      { ...identity, id: "lateral-ca", kind: "lateral-ca", residualNote: "Registers the channels at one effective wavelength each; colour inside a channel's band and axial colour stay.",
        transforms: { red: affine("red"), green: affine("green"), blue: affine("blue") } },
      { ...identity, id: "vignetting", kind: "peripheral-illumination", residualNote: "Gain 1/E at the profile's aperture; it raises corner noise with the signal.",
        profile: { ...c.vignetting.profile, maximumNormalizedRadius: 1.05 }, strength: 1 }
    ] });
}
