// SPDX-License-Identifier: Apache-2.0

/**
 * Generic lens catalogue (#549): two sets of primes, Professional and Consumer, named "PV <focal length> <maximum aperture>"
 * ("Pro" for the professional set, "Macro" or "Fisheye" before it for special lenses). Every lens is Photivra's own generic
 * design, not modelled on any manufacturer's product, and every number in this file is a labelled approximation chosen by
 * Photivra to reproduce the typical behaviour that openly published optics texts describe for each class of lens. No
 * measured, branded or paid lens data is used.
 *
 * The data here are the lens definitions and their character as numbers (a set baseline and per-lens adjustments); the
 * PSF built from them lives in `optics/generic-lens-psf.ts`, so other models (for example bokeh, #553) can read the same
 * data. Each lens's numbers are resolved for a sensor (focal lengths scale by the crop factor as for `lens.prime`), an
 * f-number and a focus distance by {@link resolveGenericLens}.
 *
 * Models (each an approximation):
 * - Primary (Seidel) wave aberrations at the lens's widest aperture and at the frame corner (normalised field H = 1):
 *   spherical W040, coma W131, astigmatism W222 and field curvature W220, in waves at 550 nm (Hopkins 1950; Wyant & Creath
 *   1992, Applied Optics and Optical Engineering XI ch. 1, free author copy). Stopping down from N0 to N scales the pupil
 *   radius by a = N0/N and so each term W_klm·ρ^l by a^l (a⁴, a³, a², a²). Spherical aberration is balanced by defocus
 *   W020 = −W040, the focus of minimum RMS wavefront error (Wyant & Creath 1992, sec. on balanced aberrations).
 * - Close focus: every aberration is multiplied by 1 + c·m/m_max, where m is the thin-lens magnification at the focus
 *   distance and c the lens's close-focus factor (a generic stand-in for the change of aberrations with conjugate).
 * - Axial (longitudinal) colour: an extra defocus W020(λ) = W_ax·a²·D(λ), and lateral colour: a radial image displacement
 *   Δr(λ) = L·R·H·D(λ) (R the frame's half-diagonal), both with the normalised Cauchy dispersion
 *   D(λ) = (1/λ² − 1/λ_d²)/(1/λ_F² − 1/λ_C²) (Fraunhofer d, F and C lines; `calculateCauchyRefractiveIndex`).
 * - Distortion: radial r_d = r·(1 + k1·ρ²), ρ normalised to the frame's half-diagonal, so k1 is the corner distortion.
 * - Vignetting: relative illumination E(ρ) = (1 − b·ρ²)² with E(1) = 2^−s, s the corner fall-off in stops: a natural part,
 *   plus an optical part that fades over the first four stops of stopping down (log2(N/N0) = 2 is four stops, since a
 *   stop is a factor √2 in N).
 * - Bokeh (#567), the options of `lens.defocus` (#553) that `simulateCapture` folds into the PSF with `lens.defocus`: rounded
 *   aperture blades (9 at curvature 0.7 for the professional set, 7 at 0.3 for the consumer set, open to a circle at the widest
 *   aperture), the lens's own W040 as `sphericalAberration`, and, for the fast (f/2 or faster) rectilinear wides and normals
 *   (at most 50 mm equivalent), a cat's eye: one clipping circle of the widest pupil's radius whose shift leaves the open area
 *   2^−s_o of the pupil at the frame corner wide open, s_o the lens's optical vignetting in stops (the light it removes is the
 *   optical part of the relative illumination above; the kernel is a shape only).
 * - Flare, focus breathing and focus consistency are numbers for callers; `simulateCapture` renders none of them.
 * @see docs/LENS_CATALOGUE.md for the tables, the adjustments and why each lens has them.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError } from "../core/validation.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import { calculateEquivalentFocalLength35Mm } from "../camera/equivalent-focal-length.js";
import type { LensProjectionModel } from "../camera/lens-projection.js";
import { FRAUNHOFER_C_LINE_NM, FRAUNHOFER_D_LINE_NM, FRAUNHOFER_F_LINE_NM } from "../optics/longitudinal-chromatic-aberration.js";
import type { RadialDistortionProfile } from "../optics/radial-distortion.js";
import type { IlluminationVignettingProfile } from "../optics/illumination-vignetting.js";
import type { DefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import { portableAsin } from "../core/portable-math.js";
import { GENERIC_PRIME_MINIMUM_FOCUS, GENERIC_PRIME_THIRD_STOP_F_NUMBERS } from "./generic-prime-lenses.js";
import { createDeterministicUniformStream, deriveNativeSiteStreamSeedUint32, sampleDeterministicStandardNormal } from "../sensor/stochastic-seed.js";

export type GenericLensSet = "professional" | "consumer";
export type GenericLensKind = "standard" | "macro" | "fisheye";

/** The character of a set, at each lens's widest aperture. Aberrations are in waves at 550 nm at the frame corner. */
export interface GenericLensCharacterValues {
  /** Spherical aberration W040 (balanced by W020 = −W040): centre sharpness. */
  sphericalWaves: number;
  /** Coma W131 at H = 1: the comet-shaped point images of night photography. */
  comaWaves: number;
  /** Astigmatism W222 at H = 1: edge and corner sharpness. */
  astigmatismWaves: number;
  /** Field curvature W220 at H = 1: edge and corner sharpness. */
  fieldCurvatureWaves: number;
  /** Axial colour: the F-to-C difference of the defocus W020, waves at 550 nm. */
  axialColorWaves: number;
  /** Lateral colour: the F-to-C difference of the image radius at the corner, as a fraction of the half-diagonal. */
  lateralColorFraction: number;
  /** Corner distortion magnitude |k1| (fraction); each lens gives the sign (barrel −, pincushion +). */
  distortionMagnitude: number;
  /** Corner fall-off in stops that stays when stopped down (natural vignetting). */
  naturalVignettingStops: number;
  /** Extra corner fall-off in stops at the widest aperture (optical vignetting); gone four stops down (N = 4·N0). */
  opticalVignettingStops: number;
  /** Veiling glare: the fraction of the image's mean irradiance spread as a uniform veil. */
  veilingGlareFraction: number;
  /** Peak ghost power as a fraction of a bright source's power on the axis. */
  ghostFraction: number;
  /** Field-of-view change between infinity and minimum focus as a fraction (negative: narrower), beyond thin-lens unit focusing. */
  breathingFraction: number;
  /** Standard deviation of the autofocus error as a fraction of the depth of focus 2·N·c. */
  focusScatterDepthOfFocusFraction: number;
  /** c in the close-focus factor 1 + c·m/m_max. */
  closeFocusFactor: number;
}

/** Per-lens multipliers of the set baseline (missing: 1). `distortion` is signed and required: −1 barrel, +1 pincushion at the baseline. */
export type GenericLensAdjustments = { distortion: number } & Partial<Record<"spherical" | "coma" | "astigmatism" | "fieldCurvature" | "axialColor" | "lateralColor" |
  "vignetting" | "strayLight" | "breathing" | "focusScatter" | "closeFocus", number>>;

export interface GenericLensCatalogueEntry {
  /** Catalogue id, for example "pv-50-1.2-pro". */
  lensId: string;
  /** Display name, for example "PV 50 1.2 Pro". */
  name: string;
  set: GenericLensSet;
  kind: GenericLensKind;
  /** Full-frame-equivalent focal length (36 × 24 mm reference). */
  equivalentFocalLengthMm: number;
  widestFNumber: number;
  narrowestFNumber: number;
  /** Largest magnification: 0.15 (the generic rule) or 1 for the professional macro. */
  maximumMagnification: number;
  projection: LensProjectionModel;
  /** Fisheyes only: a circular image inside the frame, or one that fills it. */
  fisheyeImage?: "circular" | "full-frame";
  adjustments: Readonly<GenericLensAdjustments>;
  /** Why this lens departs from its set's baseline. */
  note: string;
  /**
   * A short plain-English summary of the lens's character (at most 40 characters, US spelling), written from its adjustments and
   * `note`, for lists and pickers. It describes the lens's sharpness, color, distortion and falloff, not its bokeh (the same rule for every lens of a set).
   */
  summary: string;
}

/** The set baselines (owner's table, #549), each lens's starting point before its adjustments. */
export const GENERIC_LENS_SET_BASELINES: Readonly<Record<GenericLensSet, Readonly<GenericLensCharacterValues>>> = /* @__PURE__ */ Object.freeze({
  professional: /* @__PURE__ */ Object.freeze({ sphericalWaves: 0.25, comaWaves: 0.35, astigmatismWaves: 0.3, fieldCurvatureWaves: 0.15, axialColorWaves: 0.15,
    lateralColorFraction: 0.00008, distortionMagnitude: 0.01, naturalVignettingStops: 0.4, opticalVignettingStops: 0.6, veilingGlareFraction: 0.005, ghostFraction: 0.002,
    breathingFraction: -0.03, focusScatterDepthOfFocusFraction: 0.1, closeFocusFactor: 0.15 }),
  consumer: /* @__PURE__ */ Object.freeze({ sphericalWaves: 0.5, comaWaves: 1.0, astigmatismWaves: 0.8, fieldCurvatureWaves: 0.45, axialColorWaves: 0.4,
    lateralColorFraction: 0.0003, distortionMagnitude: 0.03, naturalVignettingStops: 0.7, opticalVignettingStops: 1.1, veilingGlareFraction: 0.02, ghostFraction: 0.008,
    breathingFraction: -0.08, focusScatterDepthOfFocusFraction: 0.3, closeFocusFactor: 0.5 })
});

/** The generic smallest aperture of both sets: f/16 up to 16 mm, f/22 up to 135 mm, f/32 beyond (as `lens.prime`). */
function narrowest(equivalent: number): number { return equivalent <= 16 ? 16 : equivalent <= 135 ? 22 : 32; }

type Row = [focal: number, widest: number, kind: GenericLensKind, adjustments: GenericLensAdjustments, note: string, summary: string, fisheye?: "circular" | "full-frame"];
const PRO: readonly Row[] = [
  [8, 3.5, "fisheye", { distortion: 0.5, astigmatism: 1.5, fieldCurvature: 1.5, lateralColor: 2, vignetting: 0.8, strayLight: 1.5, breathing: 0.3, closeFocus: 0.5 },
    "Circular fisheye: astigmatism, field curvature and lateral colour grow towards the image circle; the exposed front element flares more; little breathing at 8 mm. Its distortion is the small departure from the equisolid projection.", "Circular fisheye; softer toward the rim", "circular"],
  [10, 3.2, "standard", { distortion: -2.5, astigmatism: 1.4, fieldCurvature: 1.3, lateralColor: 1.8, vignetting: 1.4, strayLight: 1.3 },
    "Rectilinear ultra-wide: strong barrel distortion, softer corners, lateral colour and corner fall-off.", "Strong barrel distortion; softer corners"],
  [15, 2.8, "fisheye", { distortion: 0.5, astigmatism: 1.4, fieldCurvature: 1.3, lateralColor: 1.8, vignetting: 0.9, strayLight: 1.5, breathing: 0.3, closeFocus: 0.5 },
    "Full-frame fisheye: as the circular fisheye, with its image filling the frame.", "Full-frame fisheye; softer edges", "full-frame"],
  [16, 1.8, "standard", { distortion: -1.8, coma: 1.4, astigmatism: 1.3, lateralColor: 1.5, vignetting: 1.5, strayLight: 1.2 },
    "Fast ultra-wide: coma and corner fall-off wide open, barrel distortion.", "Fast ultra-wide; coma wide open"],
  [20, 1.4, "standard", { distortion: -1.3, coma: 1.4, astigmatism: 1.2, lateralColor: 1.3, vignetting: 1.4 }, "Fast wide angle: coma wide open, barrel distortion.", "Fast wide angle; coma wide open"],
  [24, 1.4, "standard", { distortion: -1, coma: 1.3, astigmatism: 1.1, lateralColor: 1.2, vignetting: 1.3 }, "Fast wide angle: some coma wide open.", "Fast wide angle; some coma wide open"],
  [35, 1.2, "standard", { distortion: -0.6, spherical: 1.3, coma: 1.2, axialColor: 1.3, vignetting: 1.3 }, "Very fast: spherical aberration and axial colour wide open.", "Very fast; axial color wide open"],
  [50, 1.2, "standard", { distortion: -0.3, spherical: 1.3, axialColor: 1.3, vignetting: 1.2 }, "Very fast normal lens: spherical aberration and axial colour wide open; nearly no distortion.", "Very fast; nearly no distortion"],
  [85, 1.2, "standard", { distortion: 0.3, spherical: 1.2, axialColor: 1.4, coma: 0.8, astigmatism: 0.7, vignetting: 1.1 },
    "Very fast short telephoto: axial colour wide open, a small field angle so less coma and astigmatism; slight pincushion.", "Even across the frame; axial color"],
  [100, 2.8, "macro", { distortion: 0.1, spherical: 0.8, coma: 0.7, astigmatism: 0.7, fieldCurvature: 0.5, axialColor: 0.8, vignetting: 0.6, breathing: 1.5, closeFocus: 0.2 },
    "Macro: a flat field and corrections optimised for close focus (to 1:1), but strong breathing.", "Flat field to 1:1; strong breathing"],
  [200, 2, "standard", { distortion: 0.4, axialColor: 1.5, lateralColor: 0.8, coma: 0.6, astigmatism: 0.6, vignetting: 0.9 }, "Fast long telephoto: axial colour; a small field angle.", "Fast telephoto; axial color wide open"],
  [300, 2.8, "standard", { distortion: 0.4, axialColor: 1.4, coma: 0.5, astigmatism: 0.5, vignetting: 0.8 }, "Long telephoto: axial colour; a small field angle.", "Long telephoto; axial color"],
  [400, 2.8, "standard", { distortion: 0.4, axialColor: 1.5, coma: 0.5, astigmatism: 0.5, vignetting: 0.9 }, "Fast super telephoto: axial colour.", "Fast super telephoto; axial color"],
  [500, 4, "standard", { distortion: 0.3, axialColor: 1.2, coma: 0.5, astigmatism: 0.5, vignetting: 0.7 }, "Super telephoto.", "Super telephoto; low coma"],
  [600, 4, "standard", { distortion: 0.3, axialColor: 1.3, coma: 0.5, astigmatism: 0.5, vignetting: 0.8 }, "Super telephoto.", "Super telephoto; low coma, axial color"],
  [800, 5.6, "standard", { distortion: 0.3, axialColor: 1.2, coma: 0.5, astigmatism: 0.5, vignetting: 0.7 }, "Super telephoto.", "Slow super telephoto; low coma"],
  [1200, 8, "standard", { distortion: 0.2, axialColor: 1.1, coma: 0.5, astigmatism: 0.5, vignetting: 0.6 }, "Slow extreme telephoto: little vignetting.", "Slow extreme telephoto; little falloff"]
];
const CONSUMER: readonly Row[] = [
  [16, 2.8, "standard", { distortion: -1.5, coma: 1.1, astigmatism: 1.2, fieldCurvature: 1.2, lateralColor: 1.3, vignetting: 1.2, strayLight: 1.2 },
    "Ultra-wide: strong barrel distortion and soft corners, left to the correction profile.", "Strong barrel distortion; soft corners"],
  [20, 2, "standard", { distortion: -1.2, coma: 1.15, astigmatism: 1.1, lateralColor: 1.2, vignetting: 1.15 }, "Wide angle: barrel distortion, coma wide open.", "Barrel distortion; coma wide open"],
  [24, 1.8, "standard", { distortion: -1, coma: 1.1, lateralColor: 1.1, vignetting: 1.1 }, "Wide angle: barrel distortion.", "Barrel distortion; mild corner falloff"],
  [35, 1.8, "standard", { distortion: -0.6 }, "The consumer baseline.", "The consumer baseline; mild barrel"],
  [50, 1.8, "standard", { distortion: -0.3, spherical: 0.7, coma: 0.7, astigmatism: 0.7, fieldCurvature: 0.7, axialColor: 0.8, lateralColor: 0.6, vignetting: 0.8 },
    "A simple, well-corrected normal design: quite good for its set (owner's example).", "Simple, well-corrected normal lens"],
  [85, 1.8, "standard", { distortion: 0.3, spherical: 0.9, axialColor: 1.1, coma: 0.8, astigmatism: 0.8 }, "Short telephoto: axial colour wide open.", "Short telephoto; axial color wide open"],
  [100, 2, "standard", { distortion: 0.4, axialColor: 1.2, coma: 0.85 }, "Short telephoto: axial colour wide open.", "Short telephoto; axial color, pincushion"],
  [200, 5.6, "standard", { distortion: 0.6, axialColor: 0.9, lateralColor: 1.2, coma: 0.8, astigmatism: 0.9, vignetting: 0.8 }, "Slow telephoto: lateral colour, pincushion.", "Lateral color and pincushion"],
  [300, 5.6, "standard", { distortion: 0.6, lateralColor: 1.3 }, "Slow telephoto: lateral colour, pincushion.", "Lateral color and pincushion"],
  [400, 5.6, "standard", { distortion: 0.6, lateralColor: 1.3, axialColor: 1.1 }, "Slow super telephoto: lateral and axial colour.", "Slow super telephoto; lateral color"],
  [500, 5.6, "standard", { distortion: 0.6, lateralColor: 1.4, axialColor: 1.15, astigmatism: 1.1, fieldCurvature: 1.1 }, "Slow super telephoto: softer edges.", "Slow super telephoto; softer edges"],
  [600, 6.3, "standard", { distortion: 0.6, spherical: 1.2, coma: 1.2, astigmatism: 1.25, fieldCurvature: 1.25, lateralColor: 1.4, axialColor: 1.2, vignetting: 1.2 },
    "Soft at the edges and wide open (owner's example).", "Soft at the edges and wide open"],
  [800, 9, "standard", { distortion: 0.5, astigmatism: 1.15, fieldCurvature: 1.15, lateralColor: 1.4, axialColor: 1.1 }, "Slow extreme telephoto: softer edges, lateral colour.", "Slow extreme telephoto; softer edges"]
];

function entry(set: GenericLensSet, [focal, widest, kind, adjustments, note, summary, fisheye]: Row): GenericLensCatalogueEntry {
  const special = kind === "macro" ? " Macro" : kind === "fisheye" ? " Fisheye" : "";
  const suffix = set === "professional" ? " Pro" : "";
  return Object.freeze({ lensId: ("pv-" + focal + "-" + widest + special + suffix).toLowerCase().replace(/ /g, "-"), name: "PV " + focal + " " + widest + special + suffix,
    set, kind, equivalentFocalLengthMm: focal, widestFNumber: widest, narrowestFNumber: narrowest(focal),
    maximumMagnification: kind === "macro" ? 1 : GENERIC_PRIME_MINIMUM_FOCUS.magnification, projection: kind === "fisheye" ? "fisheye-equisolid-angle" as const : "rectilinear" as const,
    ...(fisheye ? { fisheyeImage: fisheye } : {}), adjustments: Object.freeze({ ...adjustments }), note, summary });
}

/** The 30 lenses: 17 professional, then 13 consumer, each set by focal length. */
export const GENERIC_LENS_CATALOGUE: readonly GenericLensCatalogueEntry[] = /* @__PURE__ */ Object.freeze([...PRO.map((row) => entry("professional", row)),
  ...CONSUMER.map((row) => entry("consumer", row))]);
/** The catalogue ids, in catalogue order. */
export const GENERIC_LENS_IDS: readonly string[] = /* @__PURE__ */ Object.freeze(GENERIC_LENS_CATALOGUE.map((lens) => lens.lensId));

/** Where the catalogue's numbers come from: Photivra's own choices, guided by openly published descriptions of lens behaviour. */
export const GENERIC_LENS_EVIDENCE: readonly EvidenceProvenance[] = /* @__PURE__ */ Object.freeze([
  /* @__PURE__ */ Object.freeze({ sourceOrigin: "photivra" as const, sourceReference: "photivra:generic-lens-catalogue:549", reuseStatus: "photivra-owned" as const,
    note: "Coefficients chosen by Photivra (#549); not measured, not modelled on any product." }),
  /* @__PURE__ */ Object.freeze({ sourceOrigin: "third-party" as const, sourceReference: "Wyant & Creath 1992, Basic Wavefront Aberration Theory for Optical Metrology, Applied Optics and Optical Engineering XI ch. 1 (free author copy)",
    reuseStatus: "factual-reference-only" as const, note: "Seidel wave-aberration expansion, pupil scaling and balanced spherical aberration; no data reproduced." }),
  /* @__PURE__ */ Object.freeze({ sourceOrigin: "third-party" as const, sourceReference: "Wikipedia: Vignetting; Distortion (optics); Chromatic aberration; Coma (optics); Lens flare; Focus breathing",
    reuseStatus: "factual-reference-only" as const, note: "Qualitative descriptions of how these effects vary with lens class and aperture; no data reproduced." })
]);

/** Normalised Cauchy dispersion D(λ) = (1/λ² − 1/λ_d²)/(1/λ_F² − 1/λ_C²): 0 at the d line, F minus C = 1. */
export function genericLensDispersion(wavelengthNm: number): number {
  const inv = (nm: number): number => 1 / (nm * nm);
  return (inv(wavelengthNm) - inv(FRAUNHOFER_D_LINE_NM)) / (inv(FRAUNHOFER_F_LINE_NM) - inv(FRAUNHOFER_C_LINE_NM));
}

/** A catalogue lens's character resolved for a sensor, an f-number and a focus distance. Aberrations in waves at 550 nm. */
export interface GenericLensCharacter {
  fNumber: number;
  focusDistanceM: number | null;
  /** Thin-lens magnification at the focus distance (0 at infinity). */
  magnification: number;
  /** 1 + c·m/m_max. */
  closeFocusGain: number;
  /** Pupil-radius ratio N0/N. */
  pupilScale: number;
  /** Resolved Seidel coefficients at the frame corner (H = 1), waves at 550 nm; `balancingDefocusWaves` = −spherical. */
  aberrations: { sphericalWaves: number; balancingDefocusWaves: number; comaWaves: number; astigmatismWaves: number; fieldCurvatureWaves: number; axialColorWaves: number };
  /** Lateral colour: F-to-C image-radius difference at the corner, fraction of the half-diagonal and micrometres on this sensor. */
  lateralColor: { fraction: number; cornerMicrometers: number };
  /** Radial distortion profile (normalised to the half-diagonal, valid to 1.25 of it, beyond the corner) and its corner value (fraction; negative = barrel). */
  distortion: { profile: RadialDistortionProfile; corner: number };
  /** Relative illumination profile (normalised to the half-diagonal, valid to 1.25 of it) and the corner fall-off in stops. */
  vignetting: { profile: IlluminationVignettingProfile; cornerStops: number };
  strayLight: { veilingGlareFraction: number; ghostFraction: number };
  /** Field-of-view change at this focus and at minimum focus, beyond thin-lens unit focusing (fraction, negative = narrower). */
  breathing: { fieldOfViewChange: number; atMinimumFocus: number };
  /** Standard deviation of the autofocus error as a fraction of the depth of focus 2·N·c. */
  focusScatterDepthOfFocusFraction: number;
  /**
   * Bokeh character (#567) at this f-number, focus and sensor, as the options of `lens.defocus` and `calculateDefocusBokehKernel`
   * (#553): blades, the resolved W040 as `sphericalAberration` (µm at this f-number) and, for fast wides and normals, `catsEye`.
   */
  bokeh: DefocusBokehOptions;
}

export interface ResolvedGenericLens {
  lensId: string;
  name: string;
  set: GenericLensSet;
  kind: GenericLensKind;
  equivalentFocalLengthMm: number;
  /** Physical focal length on this sensor: equivalent ÷ crop factor. */
  focalLengthMm: number;
  cropFactor35Mm: number;
  /** Half-diagonal of the sensor, mm: field height H = 1 and ρ = 1 of the profiles. */
  halfDiagonalMm: number;
  widestFNumber: number;
  narrowestFNumber: number;
  /** Marked third-stop f-numbers within the range. */
  fNumbers: readonly number[];
  /** max(0.10 m, f·(1 + 1/m_max)), metres from the lens (thin lens). */
  minimumFocusDistanceM: number;
  maximumMagnification: number;
  projection: LensProjectionModel;
  fisheyeImage: "circular" | "full-frame" | null;
  /** Fisheyes: the radius of the 180° image circle on this sensor, 2·f·sin 45° (equisolid), mm. Null otherwise. */
  imageCircleRadiusMm: number | null;
  character: GenericLensCharacter;
  note: string;
  /** The catalogue entry's `summary`: a short plain-English description of the lens's character (at most 40 characters). */
  summary: string;
  evidence: readonly EvidenceProvenance[];
  scientificStatus: "approximation";
  limitations: readonly string[];
}

export interface ResolveGenericLensInput {
  /** A catalogue id (`GENERIC_LENS_IDS`). */
  lensId: string;
  /** The sensor's active capture area, mm. */
  activeImagingArea: { widthMm: number; heightMm: number };
  /** Default: the widest aperture. Must lie in the lens's range. */
  fNumber?: number;
  /** Default: infinity. At least the minimum focus distance. */
  focusDistanceM?: number;
}

/** @internal The catalogue entry of an id, or a domain error naming the ids. */
export function genericLensEntry(lensId: unknown): GenericLensCatalogueEntry {
  const found = typeof lensId === "string" ? GENERIC_LENS_CATALOGUE.find((lens) => lens.lensId === lensId) : undefined;
  if (!found) throw new InvalidConfigurationError("lensId must be a generic lens catalogue id (GENERIC_LENS_IDS), for example \"pv-50-1.2-pro\" or \"pv-50-1.8\".");
  return found;
}

/** @internal The baseline with the lens's adjustments applied (at its widest aperture, infinity focus). */
export function genericLensAdjustedValues(lens: GenericLensCatalogueEntry): GenericLensCharacterValues {
  const b = GENERIC_LENS_SET_BASELINES[lens.set], a = lens.adjustments, k = (key: keyof GenericLensAdjustments): number => a[key] ?? 1;
  return { sphericalWaves: b.sphericalWaves * k("spherical"), comaWaves: b.comaWaves * k("coma"), astigmatismWaves: b.astigmatismWaves * k("astigmatism"),
    fieldCurvatureWaves: b.fieldCurvatureWaves * k("fieldCurvature"), axialColorWaves: b.axialColorWaves * k("axialColor"),
    lateralColorFraction: b.lateralColorFraction * k("lateralColor"), distortionMagnitude: b.distortionMagnitude * a.distortion,
    naturalVignettingStops: b.naturalVignettingStops * k("vignetting"), opticalVignettingStops: b.opticalVignettingStops * k("vignetting"),
    veilingGlareFraction: b.veilingGlareFraction * k("strayLight"), ghostFraction: b.ghostFraction * k("strayLight"), breathingFraction: b.breathingFraction * k("breathing"),
    focusScatterDepthOfFocusFraction: b.focusScatterDepthOfFocusFraction * k("focusScatter"), closeFocusFactor: b.closeFocusFactor * k("closeFocus") };
}

/** @internal E(ρ) = (1 − bρ²)² with E(1) = 2^−stops, valid to `maximumNormalizedRadius` (which must stay inside the first zero). */
export function genericLensVignettingProfile(cornerStops: number, halfDiagonalMm: number, maximumNormalizedRadius = 1): IlluminationVignettingProfile {
  const b = 1 - 2 ** (-cornerStops / 2);
  return { normalizationRadiusMm: halfDiagonalMm, maximumNormalizedRadius, coefficients: { r2: -2 * b, r4: b * b, r6: 0 } };
}
/** @internal r_d = r(1 + k1 ρ²) normalised to the half-diagonal. */
export function genericLensDistortionProfile(corner: number, halfDiagonalMm: number, maximumNormalizedRadius = 1): RadialDistortionProfile {
  return { normalizationRadiusMm: halfDiagonalMm, maximumNormalizedRadius, coefficients: { k1: corner, k2: 0, k3: 0 } };
}

/**
 * @internal How far the profiles `resolveGenericLens` returns reach, in units of the half-diagonal. A request that reads the scene
 * through them (`simulateCapture`, `simulateDisplayView`) needs them beyond the frame's corner: the outer site centres plus the
 * kernel radius and the query offsets. 1.25 covers a kernel reaching a quarter of the half-diagonal past the corner (on full
 * frame 5.4 mm, beyond the 512-site disc at 6 µm). Every catalogue lens stays valid there: its vignetting E = (1 − bρ²)² keeps
 * bρ² ≤ 0.83 (b ≤ 0.53, the 2.16-stop corner of PV 16 2.8), and its distortion stays monotonic (1 + 3k1ρ² ≥ 0.75 at k1 = −0.045).
 * Only the operating range grows; the coefficients, and so every value inside the frame, are unchanged.
 */
export const GENERIC_LENS_RESOLVED_PROFILE_REACH = 1.25;
/** The distortion profile's range for that reach: with barrel distortion an image point at ρ_d comes from ρ_d/(1 + k1ρ²), farther out. */
function resolvedDistortionReach(k1: number): number {
  const r = GENERIC_LENS_RESOLVED_PROFILE_REACH;
  return k1 < 0 ? r / (1 + k1 * r * r) * 1.01 : r;
}

/**
 * The centre shift d (pupil radii) of a clipping circle of the pupil's radius that leaves the open fraction `open` of the pupil:
 * the lens of two unit circles, (2/π)(acos(d/2) − (d/2)·√(1 − d²/4)) = open, by bisection (acos u = π/2 − asin u, portable).
 */
function catsEyeShift(open: number): number {
  let low = 0, high = 2;
  for (let k = 0; k < 52; k++) {
    const d = (low + high) / 2, u = d / 2;
    if ((Math.PI / 2 - portableAsin(u) - u * Math.sqrt(1 - u * u)) * 2 / Math.PI > open) low = d; else high = d;
  }
  return (low + high) / 2;
}

function positiveFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidScientificInputError(name + " must be a positive finite number.");
  return value;
}

/**
 * Resolves a catalogue lens for a sensor: its focal length (equivalent ÷ the diagonal crop factor), f-number range, close focus
 * and projection, and its character (aberrations, colour, distortion, vignetting, flare, breathing and focus scatter) at the
 * given f-number and focus distance. Every value is a labelled approximation of a generic lens, not a measured product.
 */
export function resolveGenericLens(input: ResolveGenericLensInput): ResolvedGenericLens {
  requireInputObject(input, "resolveGenericLens input");
  requireInputKeys(input, "resolveGenericLens", ["lensId", "activeImagingArea", "fNumber", "focusDistanceM"]);
  const lens = genericLensEntry(input.lensId);
  requireInputObject(input.activeImagingArea, "activeImagingArea");
  const widthMm = positiveFinite(input.activeImagingArea.widthMm, "activeImagingArea.widthMm"), heightMm = positiveFinite(input.activeImagingArea.heightMm, "activeImagingArea.heightMm");
  const crop = calculateEquivalentFocalLength35Mm({ focalLengthMm: 1, activeImagingArea: { widthMm, heightMm } }).value.cropFactor35Mm;
  const focalLengthMm = lens.equivalentFocalLengthMm / crop, f = focalLengthMm / 1000, halfDiagonalMm = Math.hypot(widthMm, heightMm) / 2;
  const minimumFocusDistanceM = Math.max(GENERIC_PRIME_MINIMUM_FOCUS.minimumDistanceM, f * (1 + 1 / lens.maximumMagnification));
  const fNumber = input.fNumber === undefined ? lens.widestFNumber : positiveFinite(input.fNumber, "fNumber");
  if (fNumber < lens.widestFNumber || fNumber > lens.narrowestFNumber)
    throw new InvalidScientificInputError("fNumber " + fNumber + " is outside the " + lens.name + " range f/" + lens.widestFNumber + "–f/" + lens.narrowestFNumber + ".");
  const focusDistanceM = input.focusDistanceM === undefined ? null : positiveFinite(input.focusDistanceM, "focusDistanceM");
  if (focusDistanceM !== null && focusDistanceM < minimumFocusDistanceM)
    throw new InvalidScientificInputError("focusDistanceM " + focusDistanceM + " m is closer than the " + lens.name + " minimum focus distance " + minimumFocusDistanceM + " m.");
  const values = genericLensAdjustedValues(lens), maximumMagnification = f / (minimumFocusDistanceM - f);
  const magnification = focusDistanceM === null ? 0 : f / (focusDistanceM - f), closeness = Math.min(1, magnification / maximumMagnification);
  const closeFocusGain = 1 + values.closeFocusFactor * closeness, a = lens.widestFNumber / fNumber;
  const cornerStops = values.naturalVignettingStops + values.opticalVignettingStops * Math.min(1, Math.max(0, 1 - Math.log2(fNumber / lens.widestFNumber) / 2));
  // #567: the cat's eye of the fast (≤ f/2) rectilinear wides and normals (≤ 50 mm), resolved on this sensor (see the module comment).
  const pro = lens.set === "professional", pupilMm = focalLengthMm / lens.widestFNumber / 2;
  const bokeh: DefocusBokehOptions = { blades: { count: pro ? 9 : 7, firstBladeEdgeAngleDegrees: 0, curvature: pro ? 0.7 : 0.3, circularAtOrBelowFNumber: lens.widestFNumber },
    sphericalAberration: { w040Micrometers: values.sphericalWaves * a ** 4 * closeFocusGain * 0.55, atFNumber: fNumber },
    ...(lens.kind === "standard" && lens.equivalentFocalLengthMm <= 50 && lens.widestFNumber <= 2 ? { catsEye: { apertures: [{ radiusMm: pupilMm,
      shiftPerTanFieldMm: catsEyeShift(2 ** -values.opticalVignettingStops) * pupilMm * focalLengthMm / halfDiagonalMm }] } } : {}) };
  const character: GenericLensCharacter = { fNumber, focusDistanceM, magnification, closeFocusGain, pupilScale: a,
    aberrations: { sphericalWaves: values.sphericalWaves * a ** 4 * closeFocusGain, balancingDefocusWaves: -values.sphericalWaves * a ** 4 * closeFocusGain,
      comaWaves: values.comaWaves * a ** 3 * closeFocusGain, astigmatismWaves: values.astigmatismWaves * a * a * closeFocusGain,
      fieldCurvatureWaves: values.fieldCurvatureWaves * a * a * closeFocusGain, axialColorWaves: values.axialColorWaves * a * a * closeFocusGain },
    lateralColor: { fraction: values.lateralColorFraction, cornerMicrometers: values.lateralColorFraction * halfDiagonalMm * 1000 },
    distortion: { profile: genericLensDistortionProfile(values.distortionMagnitude, halfDiagonalMm, resolvedDistortionReach(values.distortionMagnitude)), corner: values.distortionMagnitude },
    vignetting: { profile: genericLensVignettingProfile(cornerStops, halfDiagonalMm, GENERIC_LENS_RESOLVED_PROFILE_REACH), cornerStops },
    strayLight: { veilingGlareFraction: values.veilingGlareFraction, ghostFraction: values.ghostFraction },
    breathing: { fieldOfViewChange: values.breathingFraction * closeness, atMinimumFocus: values.breathingFraction },
    focusScatterDepthOfFocusFraction: values.focusScatterDepthOfFocusFraction, bokeh };
  const fisheye = lens.kind === "fisheye";
  return Object.freeze({ lensId: lens.lensId, name: lens.name, set: lens.set, kind: lens.kind, equivalentFocalLengthMm: lens.equivalentFocalLengthMm, focalLengthMm,
    cropFactor35Mm: crop, halfDiagonalMm, widestFNumber: lens.widestFNumber, narrowestFNumber: lens.narrowestFNumber,
    fNumbers: Object.freeze(GENERIC_PRIME_THIRD_STOP_F_NUMBERS.filter((n) => n >= lens.widestFNumber && n <= lens.narrowestFNumber)),
    minimumFocusDistanceM, maximumMagnification, projection: lens.projection, fisheyeImage: lens.fisheyeImage ?? null,
    imageCircleRadiusMm: fisheye ? 2 * focalLengthMm * Math.SQRT1_2 : null, character, note: lens.note, summary: lens.summary, evidence: GENERIC_LENS_EVIDENCE,
    scientificStatus: "approximation" as const, limitations: Object.freeze([
      "A generic Photivra lens, not a real product: every coefficient is a Photivra choice that reproduces typical behaviour of its class, not a measurement.",
      "Primary (Seidel) aberrations only, scaled with the pupil radius and a generic close-focus factor; no higher-order terms, no zoom or focus-group design.",
      "Focal length, close focus and magnification are thin-lens values; the lens design is scaled to the sensor by the crop factor with its wavefront error in waves kept.",
      "Flare, focus breathing and focus scatter are reported numbers; simulateCapture renders none of them."]) });
}

export interface SimulateGenericLensFocusErrorInput {
  lensId: string;
  activeImagingArea: { widthMm: number; heightMm: number };
  fNumber: number;
  /** The intended focus distance, m. */
  focusDistanceM: number;
  /** uint32 seed of the shooting session. */
  seed: number;
  /** uint32 index of the shot in the session. Default 0. */
  shotIndex?: number;
  /** Circle of confusion for the depth of focus, mm. Default: the sensor diagonal / 1500. */
  circleOfConfusionMm?: number;
}

export interface GenericLensFocusError {
  lensId: string;
  /** The intended and the sampled focus distance, m (the sampled one held within minimum focus and a far limit). */
  intendedFocusDistanceM: number;
  focusDistanceM: number;
  /** The standard normal draw z and the image-side focus error z·σ·2Nc, µm (positive: a longer image distance, so focused nearer). */
  standardNormal: number;
  imageSideErrorMicrometers: number;
  /** σ (fraction of the depth of focus) and the depth of focus 2·N·c, µm. */
  depthOfFocusFraction: number;
  depthOfFocusMicrometers: number;
  /** True when the sampled image distance was held at the minimum-focus or the far (1000 m) limit. */
  held: "minimum-focus" | "far-limit" | null;
  scientificStatus: "approximation";
}

/** Stream id of the focus-scatter draw ("FOCS"), kept apart from the sensor noise streams 0 and 1. */
const FOCUS_SCATTER_STREAM_ID = 0x464f4353;
/** The far limit of a sampled focus distance, m. */
const FOCUS_SCATTER_FAR_LIMIT_M = 1000;

function uint32(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new InvalidScientificInputError(name + " must be a uint32 integer.");
  return value;
}

/**
 * Focus consistency (#549): a seeded, reproducible autofocus error for one shot. The image-side error is z·σ·2Nc, with z a
 * standard normal draw from (seed, shotIndex) (MurmurHash3 stream seed, xorshift32 and Box–Muller, the generators of the
 * capture's sensor noise), σ the lens's focus scatter as a fraction of the depth of focus 2·N·c, and
 * c the circle of confusion. The thin-lens image distance of the intended focus moves by that error and the focus distance is
 * read back from it. An approximation of autofocus variation; off unless called (or `simulateCapture`'s `lens.focusScatter`).
 */
export function simulateGenericLensFocusError(input: SimulateGenericLensFocusErrorInput): GenericLensFocusError {
  requireInputObject(input, "simulateGenericLensFocusError input");
  requireInputKeys(input, "simulateGenericLensFocusError", ["lensId", "activeImagingArea", "fNumber", "focusDistanceM", "seed", "shotIndex", "circleOfConfusionMm"]);
  const lens = resolveGenericLens({ lensId: input.lensId, activeImagingArea: input.activeImagingArea, fNumber: input.fNumber, focusDistanceM: input.focusDistanceM });
  const seed = uint32(input.seed, "seed"), shot = input.shotIndex === undefined ? 0 : uint32(input.shotIndex, "shotIndex");
  const c = input.circleOfConfusionMm === undefined ? 2 * lens.halfDiagonalMm / 1500 : positiveFinite(input.circleOfConfusionMm, "circleOfConfusionMm");
  const z = sampleDeterministicStandardNormal(createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, shot, FOCUS_SCATTER_STREAM_ID)));
  const sigma = lens.character.focusScatterDepthOfFocusFraction, depthOfFocusMm = 2 * lens.character.fNumber * c, errorMm = z * sigma * depthOfFocusMm;
  const f = lens.focalLengthMm, imageDistance = (d: number): number => 1 / (1 / f - 1 / (d * 1000));
  const nearest = imageDistance(lens.minimumFocusDistanceM), farthest = imageDistance(FOCUS_SCATTER_FAR_LIMIT_M);
  const v = imageDistance(input.focusDistanceM) + errorMm, held = v > nearest ? "minimum-focus" as const : v < farthest ? "far-limit" as const : null;
  const vHeld = Math.min(nearest, Math.max(farthest, v));
  const focusDistanceM = held === "minimum-focus" ? lens.minimumFocusDistanceM : held === "far-limit" ? FOCUS_SCATTER_FAR_LIMIT_M : 1 / (1 / f - 1 / vHeld) / 1000;
  return Object.freeze({ lensId: lens.lensId, intendedFocusDistanceM: input.focusDistanceM, focusDistanceM, standardNormal: z, imageSideErrorMicrometers: errorMm * 1000,
    depthOfFocusFraction: sigma, depthOfFocusMicrometers: depthOfFocusMm * 1000, held, scientificStatus: "approximation" as const });
}
