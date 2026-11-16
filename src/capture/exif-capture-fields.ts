// SPDX-License-Identifier: Apache-2.0

/**
 * The Exif capture settings that the DNG import (`parseDngRawImage`) and the JPEG and HEIF metadata reader
 * (`parsePhotoMetadata`) both return, resolved the same way from whichever directory the caller reads.
 *
 * Tag ids, types and meanings are from Exif 2.32 (CIPA DC-008-2019, freely published by CIPA). Each reader supplies
 * the tag lookup: the DNG import looks in the Exif IFD, then IFD 0, then the raw IFD (TIFF/EP files store the tags
 * there); the photo reader looks in the Exif IFD, then IFD 0. A malformed or out-of-range tag is reported through
 * `note` and returned as `null`; it never fails the read.
 */

/** Exif SubjectArea (0x9214, Exif 2.32 §4.6.6): a point, a circle (centre and diameter) or a rectangle (centre, width and height), in stored-image pixels. */
export type ExifSubjectArea =
  | { kind: "point"; x: number; y: number }
  | { kind: "circle"; x: number; y: number; diameter: number }
  | { kind: "rectangle"; x: number; y: number; width: number; height: number };

/**
 * 2.25.0: FocalPlaneXResolution and FocalPlaneYResolution (0xA20E, 0xA20F) with FocalPlaneResolutionUnit (0xA210): image
 * pixels per unit length on the focal plane, for the image size the camera recorded (Exif 2.32 §4.6.5). A converted file can
 * keep the camera's values while storing a different image size, so use them only with the pixel dimensions of the same Exif
 * block (docs/IMPORT_AND_PNG.md, "35 mm-equivalent focal length and focal-plane resolution").
 */
export interface ExifFocalPlaneResolution {
  /** Pixels per unit along the image width. */
  x: number;
  /** Pixels per unit along the image height. */
  y: number;
  /** "inch" (code 2, the Exif default), "centimeter" (3) or "none" (1, no absolute unit, the TIFF 6.0 ResolutionUnit code). */
  unit: "inch" | "centimeter" | "none";
  /** False when FocalPlaneResolutionUnit is absent and the Exif default (inch) was used. */
  unitStated: boolean;
  /** `x` and `y` converted to pixels per millimeter, or null when the unit is "none". */
  pixelsPerMillimeterX: number | null;
  pixelsPerMillimeterY: number | null;
}

/**
 * The capture settings an Exif block states. Every field is null when the tag is absent or malformed (a malformed one is
 * reported by the reader, in the result's `assumptions`).
 */
export interface ExifCaptureFields {
  /** ExposureTime (0x829A), seconds. */
  exposureTimeSeconds: number | null;
  /** FNumber (0x829D). */
  fNumber: number | null;
  /** FocalLength (0x920A), mm (the lens's actual focal length, not the 35 mm equivalent). */
  focalLengthMillimeters: number | null;
  /**
   * 2.25.0: FocalLengthIn35mmFilm (0xA405), mm: the equivalent focal length on 35 mm film, an integer (Exif 2.32). 0, which
   * Exif defines as "unknown", is returned as null. `calculateSensorEquivalenceFromFocalLength35Mm` turns it into an imaging area.
   */
  focalLengthIn35mmFilmMillimeters: number | null;
  /**
   * 2.25.0: DigitalZoomRatio (0xA404). A stated numerator of 0, which Exif defines as "digital zoom was not used", is returned
   * as 1; a value between 0 and 1 is reported and returned as null.
   */
  digitalZoomRatio: number | null;
  /** 2.25.0: the focal-plane resolution, or null when FocalPlaneXResolution or FocalPlaneYResolution is absent or malformed. */
  focalPlaneResolution: ExifFocalPlaneResolution | null;
  /**
   * 2.25.0: PixelXDimension and PixelYDimension (0xA002, 0xA003): the valid image size the Exif block describes, or null when
   * either is absent.
   */
  pixelDimensions: { width: number; height: number } | null;
  /** PhotographicSensitivity (0x8827, formerly ISOSpeedRatings): the first value; 65535 means "65535 or more" (Exif 2.32). */
  photographicSensitivity: number | null;
  /** SensitivityType (0x8830): which sensitivity PhotographicSensitivity holds (0 unknown, 1 SOS, 2 REI, 3 ISO speed, 4–7 combinations). */
  sensitivityType: number | null;
  /** StandardOutputSensitivity (0x8831). */
  standardOutputSensitivity: number | null;
  /** RecommendedExposureIndex (0x8832). */
  recommendedExposureIndex: number | null;
  /** ISOSpeed (0x8833). */
  isoSpeed: number | null;
  /**
   * The ISO setting: RecommendedExposureIndex, else ISOSpeed, else StandardOutputSensitivity, else PhotographicSensitivity below
   * 65535 (CIPA DC-004 names the REI as the camera's exposure-index setting); null when none is stated.
   */
  iso: number | null;
  isoSource: "recommended-exposure-index" | "iso-speed" | "standard-output-sensitivity" | "photographic-sensitivity" | null;
  /** CompositeImage (0xA460): 0 unknown, 1 not a composite, 2 a general composite, 3 a composite captured while shooting. */
  compositeImage: 0 | 1 | 2 | 3 | null;
  /** SourceImageNumberOfCompositeImage (0xA461): the source images in all and those used. */
  compositeSourceImages: { total: number; used: number } | null;
  subjectArea: ExifSubjectArea | null;
}

/** How a reader gives the resolver its tags. */
export interface ExifTagLookup {
  /**
   * The tag's values when present, else null. `types` are the TIFF field types accepted; `count` is the most values read.
   * The lookup reports a malformed tag (wrong type, too many values, a zero denominator) or a negative value itself and
   * returns null.
   */
  numbers(id: number, name: string, types: readonly number[], count?: number): number[] | null;
  /** Reports a tag that was read but ignored, with the reason: "<name> ... and was ignored.". */
  ignored(message: string): void;
  /** Reports a statement about the values that is not an error. */
  note(message: string): void;
}

const SHORT = 3, LONG = 4, RATIONAL = 5;
/** Millimeters per FocalPlaneResolutionUnit (2 inch, 3 centimeter). */
const UNIT_MILLIMETERS: Readonly<Record<number, number>> = { 2: 25.4, 3: 10 };

/** Resolves the Exif capture fields from a reader's tag lookup. */
export function resolveExifCaptureFields(tags: ExifTagLookup): ExifCaptureFields {
  const positive = (id: number, name: string, types: readonly number[]): number | null => {
    const v = tags.numbers(id, name, types)?.[0];
    if (v === undefined) return null;
    if (!(v > 0)) { tags.ignored(name + " is " + v + " (not positive) and was ignored."); return null; }
    return v;
  };
  const photographicSensitivity = positive(34855, "PhotographicSensitivity", [SHORT, LONG]), recommendedExposureIndex = positive(34866, "RecommendedExposureIndex", [LONG]);
  const isoSpeed = positive(34867, "ISOSpeed", [LONG]), standardOutputSensitivity = positive(34865, "StandardOutputSensitivity", [LONG]);
  const isoChoice: [number | null, ExifCaptureFields["isoSource"]][] = [[recommendedExposureIndex, "recommended-exposure-index"], [isoSpeed, "iso-speed"],
    [standardOutputSensitivity, "standard-output-sensitivity"], [photographicSensitivity !== null && photographicSensitivity < 65535 ? photographicSensitivity : null, "photographic-sensitivity"]];
  const isoPick = isoChoice.find(([v]) => v !== null);
  if (!isoPick && photographicSensitivity === 65535) tags.note("PhotographicSensitivity is 65535 (65535 or more) and no other sensitivity tag is present; iso is null.");
  const composite = tags.numbers(42080, "CompositeImage", [SHORT])?.[0] ?? null, sources = tags.numbers(42081, "SourceImageNumberOfCompositeImage", [SHORT], 2);
  const subject = tags.numbers(37396, "SubjectArea", [SHORT], 4);
  const subjectArea: ExifSubjectArea | null = !subject ? null : subject.length === 2 ? { kind: "point", x: subject[0]!, y: subject[1]! }
    : subject.length === 3 ? { kind: "circle", x: subject[0]!, y: subject[1]!, diameter: subject[2]! }
      : subject.length === 4 ? { kind: "rectangle", x: subject[0]!, y: subject[1]!, width: subject[2]!, height: subject[3]! } : null;
  if (subject && !subjectArea) tags.ignored("SubjectArea has " + subject.length + " values (2, 3 or 4 expected) and was ignored.");
  if (composite !== null && composite > 3) tags.ignored("CompositeImage " + composite + " is not defined by Exif 2.32 and was ignored.");

  const focal35 = tags.numbers(41989, "FocalLengthIn35mmFilm", [SHORT])?.[0] ?? null;
  const zoom = tags.numbers(41988, "DigitalZoomRatio", [RATIONAL])?.[0] ?? null;
  let digitalZoomRatio: number | null = zoom === 0 ? 1 : zoom;
  if (zoom !== null && zoom > 0 && zoom < 1) { tags.ignored("DigitalZoomRatio is " + zoom + " (below 1) and was ignored."); digitalZoomRatio = null; }

  const planeX = positive(41486, "FocalPlaneXResolution", [RATIONAL]), planeY = positive(41487, "FocalPlaneYResolution", [RATIONAL]);
  const unitCode = tags.numbers(41488, "FocalPlaneResolutionUnit", [SHORT])?.[0];
  let focalPlaneResolution: ExifFocalPlaneResolution | null = null;
  if (planeX !== null && planeY !== null) {
    const code = unitCode ?? 2;
    if (code === 1 || code === 2 || code === 3) {
      const mm = UNIT_MILLIMETERS[code];
      focalPlaneResolution = { x: planeX, y: planeY, unit: code === 1 ? "none" : code === 2 ? "inch" : "centimeter", unitStated: unitCode !== undefined,
        pixelsPerMillimeterX: mm === undefined ? null : planeX / mm, pixelsPerMillimeterY: mm === undefined ? null : planeY / mm };
    } else tags.ignored("FocalPlaneResolutionUnit " + code + " is not defined by Exif 2.32; the focal-plane resolution was ignored.");
  }
  const pixelX = positive(40962, "PixelXDimension", [SHORT, LONG]), pixelY = positive(40963, "PixelYDimension", [SHORT, LONG]);

  return {
    exposureTimeSeconds: positive(33434, "ExposureTime", [RATIONAL]), fNumber: positive(33437, "FNumber", [RATIONAL]), focalLengthMillimeters: positive(37386, "FocalLength", [RATIONAL]),
    focalLengthIn35mmFilmMillimeters: focal35 === 0 ? null : focal35, digitalZoomRatio, focalPlaneResolution,
    pixelDimensions: pixelX !== null && pixelY !== null ? { width: pixelX, height: pixelY } : null,
    photographicSensitivity, sensitivityType: tags.numbers(34864, "SensitivityType", [SHORT])?.[0] ?? null, standardOutputSensitivity, recommendedExposureIndex, isoSpeed,
    iso: isoPick ? isoPick[0] : null, isoSource: isoPick ? isoPick[1] : null,
    compositeImage: composite !== null && composite <= 3 ? composite as 0 | 1 | 2 | 3 : null,
    compositeSourceImages: sources && sources.length === 2 ? { total: sources[0]!, used: sources[1]! } : null, subjectArea
  };
}
