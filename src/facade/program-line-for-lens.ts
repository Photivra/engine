// SPDX-License-Identifier: Apache-2.0

/**
 * #614: the capture facade's program line on its own, without running a capture: the aperture/shutter pairs Program mode
 * follows across a lens's f-number range, and the pair it chooses for a scene brightness and ISO. Built with the capture's own
 * code (program-exposure.ts: the exposure anchor, the lens range and the line) and resolved by the same exposure-mode resolver
 * (`resolveProgramAutoExposureMode`) on the same tier capabilities, so the two cannot disagree.
 * @see docs/USAGE.md, "Program line for a lens range (#614)".
 */

import { calculatedResult, type CalculationResult } from "../core/calculation-result.js";
import { InvalidScientificInputError, requirePositiveFinite } from "../core/validation.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { genericTierExposure, type GenericEquipmentTier } from "../equipment/generic-tier-exposure.js";
import { IDEAL_LENS_LIMITS } from "../equipment/ideal-lens.js";
import { resolveGenericEquipmentExposureCapabilities } from "../equipment/exposure-capabilities.js";
import { createExposureMeterTargetFromMeteringResult } from "../exposure/metering-target.js";
import type { ExposureMeteringResult } from "../exposure/metering.js";
import { resolveProgramAutoExposureMode, type ProgramLineSelectionDiagnostics } from "../exposure/exposure-mode-resolver.js";
import { sosReferenceLuminance, standardExposureLuminance, standardExposureValue100 } from "../exposure/standard-exposure.js";
import { facadeExposureAnchor, facadeLensRangeExposure, facadeProgramLine } from "./program-exposure.js";

/** The facade's evidence record (the same as `simulateCapture`'s). */
const EVIDENCE: readonly EvidenceProvenance[] = /* @__PURE__ */ Object.freeze([/* @__PURE__ */ Object.freeze({ sourceOrigin: "photivra" as const,
  sourceReference: "photivra:simulate-capture-facade", reuseStatus: "photivra-owned" as const })]);

export interface CalculateProgramLineInput {
  /** Generic tier whose body (shutter and ISO grids) and lens apply, as `simulateCapture`'s `camera`. Default "professional". */
  camera?: GenericEquipmentTier;
  /**
   * The lens's f-number range, as `lens.ideal`'s `widestFNumber`/`narrowestFNumber` (within `IDEAL_LENS_LIMITS`, the widest no
   * larger than the narrowest). Omitted: the tier lens, as a capture without a lens range.
   */
  lens?: { widestFNumber: number; narrowestFNumber: number };
  /** ISO setting (fixed ISO). Default 100. Must be one of the tier's ISO settings. */
  iso?: number;
  /**
   * Scene brightness as EV at ISO 100 (EV100) of the standard exposure: log2(N²/t) of the settings that expose luminance L at
   * the standard exposure at ISO 100, L = 10·2^EV100/(0.65·100) cd/m². Give this or `luminanceCdPerSquareMeter` to get `selection`.
   */
  ev100?: number;
  /** Scene (metered) luminance in cd/m², instead of `ev100`. */
  luminanceCdPerSquareMeter?: number;
}

/** One node of the program line: a wanted aperture/shutter pair. */
export interface ProgramLineNode {
  aperture: number;
  shutterSeconds: number;
  /** Exposure value of the pair, log2(N²/t). */
  exposureValue: number;
  /** The scene EV100 for which the pair is the standard exposure at the request's ISO: exposureValue − log2(iso/100). */
  sceneEv100: number;
  /** Optical exposure t/N² relative to the anchor, in stops (the resolver's node coordinate). */
  opticalExposureStopsFromReference: number;
}

/** The pair Program mode chooses for the scene brightness. */
export interface ProgramLineSelection {
  sceneEv100: number;
  luminanceCdPerSquareMeter: number;
  aperture: number;
  shutterSeconds: number;
  iso: number;
  /** Where the scene falls on the line: within it, or beyond an end where the resolver holds the end's settings. */
  position: ProgramLineSelectionDiagnostics["position"];
  /** The line's pair before the aperture and shutter snap to their grids. */
  idealAperture: number;
  idealShutterSeconds: number;
  apertureClamped: ProgramLineSelectionDiagnostics["apertureClamped"];
  shutterClamped: ProgramLineSelectionDiagnostics["shutterClamped"];
  /**
   * Deviation of the chosen settings from the standard exposure for the luminance, in stops (positive is darker: under),
   * as `simulateCapture`'s `exposure.standardExposureDeviationStops`. Beyond the line's ends with a fixed ISO it is not zero.
   */
  standardExposureDeviationStops: number;
}

export interface ProgramLine {
  camera: GenericEquipmentTier;
  iso: number;
  /** The lens range used, or null for the tier lens. */
  lens: { widestFNumber: number; narrowestFNumber: number } | null;
  /** "facade-generic-program-line", or "facade-generic-program-line-lens-range" when the range limits the line (#583). */
  profileId: string;
  limitedToLensRange: boolean;
  /** The exposure anchor the line's stops are measured from (#569, #585). */
  reference: { aperture: number; shutterSeconds: number; iso: number };
  /** The line's nodes, from the most light (shortest exposure) to the least; the line is log2-interpolated between them. */
  nodes: readonly ProgramLineNode[];
  /** The chosen pair; present when `ev100` or `luminanceCdPerSquareMeter` was given. */
  selection?: ProgramLineSelection;
}

/**
 * The capture facade's generic program line for a lens's f-number range (#614), and the pair it chooses for a scene
 * brightness (EV100 or luminance) at a fixed ISO, without running a capture.
 *
 * The line is the one `simulateCapture` uses in `exposure.mode: "program"` (f/16 1/2000 s … f/8 1/125 s … f/4 1.024 s,
 * limited to a range that does not hold f/4–f/16 by clamping its f/4 and f/16 to the range, #583), built by the same code, and
 * the pair is resolved by the same `resolveProgramAutoExposureMode` on the tier's capabilities with the lens range, so a
 * capture of a uniform scene metered at the same luminance chooses the same settings (tested). It is a generic educational
 * line (an approximation), not a manufacturer's program. Auto ISO is not offered here.
 *
 * EV100 and luminance are related by the engine's standard exposure: L = 10·N²/(0.65·t·S) (CIPA DC-004-2020 §3.2 and §5.5).
 *
 * Example: f/8–f/32 at ISO 100 gives the nodes f/16 1/2000 s, f/16 1/125 s, f/8 1/125 s, f/8 1.024 s.
 *
 * @param input Tier, optional lens range, ISO and optional scene brightness.
 * @returns The line's nodes and, with a scene brightness, the chosen pair.
 */
export function calculateProgramLine(input: CalculateProgramLineInput): CalculationResult<ProgramLine> {
  requireInputKeys(input, "calculateProgramLine", ["camera", "lens", "iso", "ev100", "luminanceCdPerSquareMeter"]);
  const camera = input.camera ?? "professional";
  // #765: the tier's exposure side only (equal to GENERIC_TIER_ASSETS', built by the same code), so this bundles without the rest of the tier assets.
  const preset = genericTierExposure("2.1.0").find((p) => p.tier === camera);
  if (!preset) throw new InvalidConfigurationError('camera must be "consumer", "prosumer" or "professional".');
  const iso = input.iso ?? 100;
  requirePositiveFinite("iso", iso);
  let range: { widestFNumber: number; narrowestFNumber: number } | undefined;
  if (input.lens !== undefined) {
    requireInputObject(input.lens, "lens");
    requireInputKeys(input.lens, "lens", ["widestFNumber", "narrowestFNumber"]);
    const { widestFNumber: lo, narrowestFNumber: hi } = input.lens, n = IDEAL_LENS_LIMITS.fNumber;
    if (!(typeof lo === "number" && typeof hi === "number" && lo >= n.minimum && hi <= n.maximum && lo <= hi)) {
      throw new InvalidScientificInputError("lens.widestFNumber and narrowestFNumber must be f-numbers in f/" + n.minimum + "–f/" + n.maximum +
        " (IDEAL_LENS_LIMITS), the widest no larger than the narrowest.");
    }
    range = { widestFNumber: lo, narrowestFNumber: hi };
  }
  if (input.ev100 !== undefined && input.luminanceCdPerSquareMeter !== undefined) {
    throw new InvalidScientificInputError("Give ev100 or luminanceCdPerSquareMeter, not both.");
  }
  let luminance: number | undefined;
  if (input.ev100 !== undefined) {
    if (typeof input.ev100 !== "number" || !Number.isFinite(input.ev100) || Math.abs(input.ev100) > 40) throw new InvalidScientificInputError("ev100 must be a finite number within ±40.");
    luminance = standardExposureLuminance(input.ev100);
  } else if (input.luminanceCdPerSquareMeter !== undefined) {
    requirePositiveFinite("luminanceCdPerSquareMeter", input.luminanceCdPerSquareMeter);
    luminance = input.luminanceCdPerSquareMeter;
  }

  // The capture's capabilities: the tier body with the tier lens, or its exposure profile with the range (an ideal lens at the
  // tier lens's shortest focal length; the aperture range is constant over focal length, so the focal length does not matter).
  const tierLens = preset.lens.exposure, focalLengthMm = tierLens.focalLengthMmRange.value.minimum;
  const lensExposure = facadeLensRangeExposure(tierLens, range && { id: "ideal-" + focalLengthMm + "mm", focalLengthMm, ...range }, EVIDENCE);
  const capabilities = resolveGenericEquipmentExposureCapabilities({ bodyProfile: preset.body.exposure, lensProfile: lensExposure, selectedFocalLengthMm: focalLengthMm });
  const { clamp, reference } = facadeExposureAnchor(range, capabilities.shutter.minimumSeconds, undefined);
  const line = facadeProgramLine(clamp(4), clamp(16), reference, EVIDENCE);
  const evOffset = Math.log2(iso / 100);
  const nodes = line.nodes.map((node): ProgramLineNode => {
    const exposureValue = Math.log2(node.aperture * node.aperture / node.shutterSeconds);
    return { aperture: node.aperture, shutterSeconds: node.shutterSeconds, exposureValue, sceneEv100: exposureValue - evOffset,
      opticalExposureStopsFromReference: node.opticalExposureStopsFromReference };
  });

  let selection: ProgramLineSelection | undefined;
  if (luminance !== undefined) {
    // The capture's meter target for a scene of uniform luminance L: each of its 16 × 16 zones reads targetRelativeSignal × L / L_ref,
    // and the body's uniform multi-zone meter (its first metering profile) takes their mean, summed in the same order.
    const meterProfile = preset.body.metering[0]!.profile, targetSignal = meterProfile.target.targetRelativeSignal;
    const zone = targetSignal * luminance / sosReferenceLuminance(reference.aperture, reference.shutterSeconds, reference.iso);
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += zone;
    const meteredRelativeSignal = sum / 256;
    if (!(meteredRelativeSignal > 0) || !Number.isFinite(meteredRelativeSignal)) throw new InvalidScientificInputError("The scene brightness is outside the meter's range.");
    const meterResult = { measurementId: "program-line-meter", sceneStateId: "program-line-scene", profileId: meterProfile.profileId, scientificStatus: "approximation",
      inputDomain: "relative-pre-exposure-linear-signal", exposureCompensationApplied: false, automaticExposureResolved: false, resultReusableForAeLock: true,
      status: "resolved", targetRelativeSignal: targetSignal, meteredRelativeSignal } as unknown as ExposureMeteringResult;
    const target = createExposureMeterTargetFromMeteringResult({ targetId: "program-line-target", meterResult });
    const resolution = resolveProgramAutoExposureMode({ target, capabilities, referenceExposure: reference, programLine: line, isoControl: { kind: "manual", iso } });
    if (resolution.status !== "resolved") throw new InvalidScientificInputError("The program line could not be resolved (" + resolution.status + ").");
    const { aperture, shutterSeconds } = resolution.resolvedSettings, d = resolution.programLineSelection;
    selection = { sceneEv100: standardExposureValue100(luminance), luminanceCdPerSquareMeter: luminance, aperture, shutterSeconds, iso: resolution.resolvedSettings.iso,
      position: d.position, idealAperture: d.idealAperture, idealShutterSeconds: d.idealShutterSeconds, apertureClamped: d.apertureClamped, shutterClamped: d.shutterClamped,
      standardExposureDeviationStops: Math.log2(sosReferenceLuminance(aperture, shutterSeconds, resolution.resolvedSettings.iso) / luminance) };
  }
  return calculatedResult(
    { camera, iso, lens: range ?? null, profileId: line.profileId, limitedToLensRange: line.profileId.endsWith("-lens-range"), reference: { ...reference }, nodes,
      ...(selection ? { selection } : {}) },
    "facade-program-line",
    "1.0.0",
    [
      "Generic educational program line authored for the capture facade; not any manufacturer's program.",
      "The same line, anchor and resolver as simulateCapture's program mode; aperture and shutter snap to the tier's grids.",
      "Fixed ISO; beyond the line's ends the end's settings are held and the exposure deviates from the standard exposure.",
      "Standard exposure L = 10·N²/(0.65·t·S) (CIPA DC-004-2020 §3.2, §5.5)."
    ]
  );
}
