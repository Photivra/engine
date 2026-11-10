// SPDX-License-Identifier: Apache-2.0

/**
 * The generic correction profile of a catalogue lens (#549), for the post-capture lens corrections
 * (`resolveLensCorrectionPlan`, `calculateLensCorrectedCapture`): a distortion map, a lateral-colour map per channel and a
 * peripheral-illumination gain, each from the lens's own character (`resolveGenericLens`). Consumer lenses rely on it more:
 * their uncorrected distortion and vignetting are larger, so the same profile corrects more. Like every catalogue number it is
 * a labelled approximation, bound to one exact camera state (`OpticalProfileState`).
 */

import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import { parseOpticalProfileState, type OpticalProfileState } from "../optics/profile-contract.js";
import { GENERIC_LENS_EVIDENCE, resolveGenericLens } from "../equipment/generic-lens-catalogue.js";
import { parseGenericLensCorrectionProfile, type GenericLensCorrectionProfile, type LensCorrectionChannel } from "./lens-corrections.js";
import type { AffineGeometricTransform } from "./geometric-transforms.js";
import { channelEffectiveDispersion, genericLensChannelScale, type ChannelDispersion } from "./developed-lens-corrections.js";

export { GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM, type ChannelDispersion } from "./developed-lens-corrections.js";

export interface CalculateChannelEffectiveDispersionInput {
  /** Spectral nodes, nm, strictly increasing, within 300–1100 nm. */
  wavelengthsNm: readonly number[];
  /** Each channel's response at the nodes (any common linear unit, ≥ 0; for example electrons per unit spectral radiance). */
  channelResponse: { red: readonly number[]; green: readonly number[]; blue: readonly number[] };
  /** The illuminant's relative spectral power at the nodes (≥ 0; the scale cancels). */
  illuminant: readonly number[];
}

/**
 * #589: each channel's effective dispersion for the catalogue lenses' lateral colour, D̄_c = Σ w·D(λ) / Σ w with
 * w = response_c(λ)·illuminant(λ) at the nodes and D the normalised Cauchy dispersion (`genericLensDispersion`: 0 at the
 * Fraunhofer d line, F minus C = 1). Under lateral colour L·r·D(λ) a neutral surface's image in channel c moves by L·r·D̄_c, so
 * blue minus red is L·r·(D̄_blue − D̄_red). Pass the result as `channelDispersion` to `createGenericLensCorrectionProfile`.
 * `simulateCapture`'s `output.lensCorrections` computes it from the capture's own channels and reports it in its assumption.
 * An approximation: a weighted mean over a neutral surface; a colored surface weights the band differently.
 */
export function calculateChannelEffectiveDispersion(input: CalculateChannelEffectiveDispersionInput): CalculationResult<ChannelDispersion> {
  requireInputObject(input, "calculateChannelEffectiveDispersion input");
  requireInputKeys(input, "calculateChannelEffectiveDispersion", ["wavelengthsNm", "channelResponse", "illuminant"]);
  const nodes = input.wavelengthsNm, response = input.channelResponse;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.some((nm, n) => typeof nm !== "number" || !(nm >= 300 && nm <= 1100) || (n > 0 && !(nm > nodes[n - 1]!))))
    throw new InvalidScientificInputError("wavelengthsNm must be strictly increasing numbers within 300–1100 nm.");
  requireInputObject(response, "channelResponse");
  requireInputKeys(response, "channelResponse", ["red", "green", "blue"]);
  const series = (values: unknown, name: string): readonly number[] => {
    if (!Array.isArray(values) || values.length !== nodes.length || values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0))
      throw new InvalidScientificInputError(name + " must hold one finite value ≥ 0 per wavelength node.");
    return values as number[];
  };
  const illuminant = series(input.illuminant, "illuminant"), channels = (["red", "green", "blue"] as const).map((c) => series(response[c], "channelResponse." + c));
  if (channels.some((r) => !(r.reduce((sum, v, n) => sum + v * illuminant[n]!, 0) > 0))) throw new InvalidScientificInputError("Every channel needs a positive response under the illuminant.");
  const value = channelEffectiveDispersion(nodes, channels, illuminant);
  return approximationResult(value, "generic-lens-channel-effective-dispersion", "1.0.0", [
    "D̄_c = Σ response_c·illuminant·D(λ) / Σ response_c·illuminant over the given nodes, for a neutral (spectrally flat) surface.",
    "D(λ) is the catalogue lenses' normalised Cauchy dispersion (Fraunhofer d, F and C lines)."]);
}

export interface CreateGenericLensCorrectionProfileInput {
  /** A catalogue id (`GENERIC_LENS_IDS`); `state.lensId` must be the same id. */
  lensId: string;
  /** The sensor's active capture area, mm (the lens is scaled to it as in `resolveGenericLens`). */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** The exact camera state the profile applies to: its focal length must be the lens's on this sensor, its aperture in range. */
  state: OpticalProfileState;
  /**
   * #589: each channel's effective dispersion (`calculateChannelEffectiveDispersion` for the camera's channels and the light).
   * Default: D at {@link GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM} (610, 540 and 465 nm), a generic approximation.
   */
  channelDispersion?: ChannelDispersion;
}

/**
 * Builds the catalogue lens's generic correction profile for one camera state: a radial distortion map (the lens's own
 * r_d = r(1 + k1ρ²), read at each ideal destination point), per-channel lateral-colour scales 1 + L·D̄_channel (`channelDispersion`,
 * by default D at the generic channel wavelengths), and the
 * relative-illumination gain at the state's aperture (strength 1). The result passes `parseGenericLensCorrectionProfile`.
 */
export function createGenericLensCorrectionProfile(input: CreateGenericLensCorrectionProfileInput): GenericLensCorrectionProfile {
  requireInputObject(input, "createGenericLensCorrectionProfile input");
  requireInputKeys(input, "createGenericLensCorrectionProfile", ["lensId", "activeImagingArea", "state", "channelDispersion"]);
  let channels: ChannelDispersion | undefined;
  if (input.channelDispersion !== undefined) {
    requireInputObject(input.channelDispersion, "channelDispersion");
    requireInputKeys(input.channelDispersion, "channelDispersion", ["red", "green", "blue"]);
    for (const c of ["red", "green", "blue"] as const) {
      const v = input.channelDispersion[c];
      // D spans −1.08 (1100 nm) to 4.30 (300 nm).
      if (typeof v !== "number" || !(v >= -1.1 && v <= 4.4)) throw new InvalidScientificInputError("channelDispersion." + c + " must be a number in [−1.1, 4.4], D between 1100 and 300 nm.");
    }
    channels = input.channelDispersion;
  }
  const state = parseOpticalProfileState(input.state);
  const lens = resolveGenericLens({ lensId: input.lensId, activeImagingArea: input.activeImagingArea, fNumber: state.aperture });
  if (state.lensId !== lens.lensId) throw new InvalidScientificInputError("state.lensId must be the catalogue id " + lens.lensId + ".");
  if (Math.abs(state.focalLengthMm - lens.focalLengthMm) > 1e-9 * lens.focalLengthMm)
    throw new InvalidScientificInputError("state.focalLengthMm must be the " + lens.name + "'s focal length on this sensor, " + lens.focalLengthMm + " mm.");
  const c = lens.character, domain = "reconstructed-linear" as const;
  const identity = { version: "1.0.0", domain, availability: "toggle" as const, defaultEnabled: true, dependencies: [] as string[], requiredByStabilizationModes: [] as string[] };
  const scale = (channel: LensCorrectionChannel): number => genericLensChannelScale(c.lateralColor.fraction, channel, channels);
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
