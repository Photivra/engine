# capture/exif-capture-fields.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## ExifCaptureFields

The capture settings an Exif block states. Every field is null when the tag is absent or malformed (a malformed one is
reported by the reader, in the result's `assumptions`).

```ts
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
  /**
   * 2.26.0 (#648): SubjectDistance (0x9206, RATIONAL), meters. Exif 2.32 §4.6.5 gives two numerators a meaning of their own, returned
   * as words rather than numbers: 0 is "unknown" (also 0/0) and 0xFFFFFFFF is "infinity" (any denominator).
   */
  subjectDistanceMeters: number | "unknown" | "infinity" | null;
  /** 2.26.0 (#648): SubjectDistanceRange (0xA40C, SHORT): 0 "unknown", 1 "macro", 2 "close-view", 3 "distant-view" (Exif 2.32 §4.6.5). */
  subjectDistanceRange: "unknown" | "macro" | "close-view" | "distant-view" | null;
}
```

## ExifFocalPlaneResolution

2.25.0: FocalPlaneXResolution and FocalPlaneYResolution (0xA20E, 0xA20F) with FocalPlaneResolutionUnit (0xA210): image
pixels per unit length on the focal plane, for the image size the camera recorded (Exif 2.32 §4.6.5). A converted file can
keep the camera's values while storing a different image size, so use them only with the pixel dimensions of the same Exif
block (docs/IMPORT_AND_PNG.md, "35 mm-equivalent focal length and focal-plane resolution").

```ts
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
```

## ExifSubjectArea

Exif SubjectArea (0x9214, Exif 2.32 §4.6.6): a point, a circle (centre and diameter) or a rectangle (centre, width and height), in stored-image pixels.

```ts
export type ExifSubjectArea =
  | { kind: "point"; x: number; y: number }
  | { kind: "circle"; x: number; y: number; diameter: number }
  | { kind: "rectangle"; x: number; y: number; width: number; height: number };
```
