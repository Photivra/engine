# facade/subject-framing-thin-lens.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CalculateChartFramingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateChartFramingInput {
  /** Active sensor (or simulated frame) size, mm: for `simulateCapture`, output width × height × pixel pitch. Give exactly one of this and `sensorProfile`. */
  sensor?: { widthMm: number; heightMm: number };
  /** #636: a capture's sensor profile and output instead of `sensor` (see {@link SubjectFramingSensorProfile}). */
  sensorProfile?: SubjectFramingSensorProfile;
  /** Physical focal length, mm. Give exactly one of this and `equivalentFocalLengthMm`. */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (diagonal crop factor); a generic prime's value also reports that lens (as `lens.prime`). */
  equivalentFocalLengthMm?: number;
  /** Chart size as for `simulateCapture` `chartSize`: heightM defaults to widthM × the sensor aspect (height / width). */
  chart: { widthM: number; heightM?: number };
  /** Distance from the lens to the chart plane, metres; more than the focal length. */
  subjectDistanceM: number;
  /** Focus distance, metres (as `lens.focusDistanceM`); default the subject distance. More than the focal length. */
  focusDistanceM?: number;
  /** #631: a catalogue lens instead of a focal length, as `simulateCapture`'s `lens.catalogue`. */
  catalogue?: SubjectFramingCatalogueLens;
}
```

## CalculateSubjectDistanceForFramingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSubjectDistanceForFramingInput {
  /** Active sensor (or simulated frame) size, mm. Give exactly one of this and `sensorProfile`. */
  sensor?: { widthMm: number; heightMm: number };
  /** #636: a capture's sensor profile and output instead of `sensor` (see {@link SubjectFramingSensorProfile}). */
  sensorProfile?: SubjectFramingSensorProfile;
  /** Physical focal length, mm. Give exactly one of this and `equivalentFocalLengthMm`. */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (diagonal crop factor); a generic prime's value also reports that lens. */
  equivalentFocalLengthMm?: number;
  /** Chart size as for `simulateCapture` `chartSize`: heightM defaults to widthM × the sensor aspect (height / width). */
  chart: { widthM: number; heightM?: number };
  fit?: SubjectFramingFit;
  /** #631: a catalogue lens instead of a focal length, as `simulateCapture`'s `lens.catalogue` (see {@link SubjectFramingCatalogueLens}). */
  catalogue?: SubjectFramingCatalogueLens;
}
```

## calculateThinLensChartFraming

#646 (2.26.0): `calculateChartFraming` for a thin lens on a sensor, with the same code and results, from a module that imports
neither the lens catalogue nor the sensor profiles; a `catalogue` or `sensorProfile` field is refused as unknown.

```ts
export function calculateThinLensChartFraming(input: ThinLensChartFramingInput): ChartFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateThinLensSubjectDistanceForFraming

#646 (2.26.0): `calculateSubjectDistanceForFraming` for a thin lens on a sensor (`focalLengthMm` or `equivalentFocalLengthMm`
and `sensor`), with the same code and results, from a module that imports neither the lens catalogue nor the sensor profiles; a
`catalogue` or `sensorProfile` field is refused as unknown. Use it when a bundle should not contain them.

```ts
export function calculateThinLensSubjectDistanceForFraming(input: ThinLensSubjectDistanceForFramingInput): SubjectFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ChartFraming

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ChartFraming {
  subjectDistanceM: number;
  focusDistanceM: number;
  /** Thin-lens image distance at the focus distance, f·s/(s − f), mm. */
  imageDistanceMm: number;
  /** Image size ÷ object size on the chart plane, v/d: f/(d − f) when focused on the chart. */
  magnification: number;
  focalLengthMm: number;
  equivalentFocalLengthMm: number;
  cropFactor35Mm: number;
  chart: { widthM: number; heightM: number };
  /** Plane area the frame covers at the subject distance, metres: sensor side ÷ magnification. */
  framedWidthM: number;
  framedHeightM: number;
  /** Fraction of the frame width and height the chart covers; above 1 means the chart is larger than the frame and cropped. */
  coverage: { frameWidthFraction: number; frameHeightFraction: number };
  /** The chart's image on the sensor, mm. */
  chartImageMm: { width: number; height: number };
  /**
   * 2.6: the thin-lens close-up light factor at the focus distance, 1/(1 + m)² with m = v/s: the image-plane irradiance
   * relative to the same lens and f-number focused at infinity (working f-number N·(1 + m)). It is the factor
   * `simulateCapture` applies through the scene-to-sensor irradiance (same function, same value).
   */
  closeUpTransmission: number;
  /** 2.6: the same factor in stops, 2·log₂(1 + m): how much darker the image is than at infinity focus. */
  closeUpLossStops: number;
  /** The generic prime of this equivalent focal length, when there is one. */
  prime: GenericPrimeLens | null;
  /** The generic prime rule max(0.10 m, f·(1 + 1/0.15)) at this focal length (the prime's own value when there is one). */
  minimumFocusDistanceM: number;
  /** True when the subject or focus distance is closer than the minimum focus distance (`simulateCapture` with `lens.prime` rejects it). */
  belowMinimumFocus: boolean;
  /** #631: with `catalogue`, how the lens frames the plane (for a fisheye, `framedWidthM` above is the paraxial value, sensor side ÷ magnification). */
  lens?: SubjectFramingLens;
  scientificStatus: "approximation";
  assumptions: readonly SimulateCaptureAssumption[];
}
```

## SubjectFraming

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SubjectFraming {
  /** Distance from the lens to the chart plane, metres: f·(1 + 1/m). */
  subjectDistanceM: number;
  /** Image size ÷ object size, f/(d − f). */
  magnification: number;
  /** Thin-lens image distance f·(1 + m), mm. */
  imageDistanceMm: number;
  focalLengthMm: number;
  equivalentFocalLengthMm: number;
  cropFactor35Mm: number;
  chart: { widthM: number; heightM: number };
  fit: SubjectFramingFit;
  /** Plane area the frame covers at that distance, metres. */
  framedWidthM: number;
  framedHeightM: number;
  /** Fraction of the frame width and height the chart covers (1 on the fitted side; above 1 means cropped). */
  coverage: { frameWidthFraction: number; frameHeightFraction: number };
  /**
   * 2.6: the thin-lens close-up light factor at the focus distance, 1/(1 + m)² with m = v/s: the image-plane irradiance
   * relative to the same lens and f-number focused at infinity (working f-number N·(1 + m)). It is the factor
   * `simulateCapture` applies through the scene-to-sensor irradiance (same function, same value).
   */
  closeUpTransmission: number;
  /** 2.6: the same factor in stops, 2·log₂(1 + m): how much darker the image is than at infinity focus. */
  closeUpLossStops: number;
  /** The generic prime of this equivalent focal length, when there is one. */
  prime: GenericPrimeLens | null;
  /** The generic prime rule max(0.10 m, f·(1 + 1/0.15)) at this focal length (the prime's own value when there is one). */
  minimumFocusDistanceM: number;
  /** True when the fit distance is closer than the minimum focus distance: the chart cannot be framed this way. */
  belowMinimumFocus: boolean;
  /** #631: with `catalogue`, how the lens frames the plane (for a fisheye, `framedWidthM` above is the paraxial value, sensor side ÷ magnification). */
  lens?: SubjectFramingLens;
  scientificStatus: "approximation";
  assumptions: readonly SimulateCaptureAssumption[];
}
```

## SubjectFramingCatalogueLens

#631: a catalogue lens id (`GENERIC_LENS_IDS`), or `{ kind, breathing? }` as `simulateCapture`'s `lens.catalogue`. The lens is resolved
on `sensor`; a fisheye frames through its equisolid projection and distortion, and `breathing: true` (#632) includes its focus
breathing, as a capture with `lens.catalogue.breathing` renders it.

```ts
export type SubjectFramingCatalogueLens = string | { kind: string; breathing?: boolean };
```

## SubjectFramingFit

How the chart fits the frame: `contain` (default; the whole chart is visible and its limiting side touches the frame), `width`, `height` or `cover` (the chart fills the frame and is cropped on its other side).

```ts
export type SubjectFramingFit = "contain" | "width" | "height" | "cover";
```

## SubjectFramingLens

#631: how a catalogue lens frames the chart plane (present only with `catalogue`).

```ts
export interface SubjectFramingLens {
  lensId: string;
  projection: "rectilinear" | "fisheye-equisolid-angle";
  /** The breathing scale 1 + Δ of the field of view at the focus distance (1 without `breathing`). */
  breathingScale: number;
  /** The plane width and height the frame sees, metres; null where the frame edge sees no plane (a fisheye's edge at or beyond 90°, or outside its image circle). */
  framedWidthM: number | null;
  framedHeightM: number | null;
  /** The full field of view across the frame width and height, degrees (null as above). */
  fieldOfViewDegrees: { width: number | null; height: number | null };
}
```

## SubjectFramingSensorProfile

#636: a capture's `sensor.profile`, its output size and `sensor.pixelPitchMicrometers`. The frame is the capture's
(`calculateSensorProfileFrame`, the `sensor.profileView` assumption): with `catalogue` the lens is resolved on the profile's whole sensor
and the frame is its centred region of the output's aspect, so the phone profile's three lenses frame as they render; otherwise the
frame is output × pitch. A phone lens needs a profile whose `fixedLenses` is "phone", and that profile takes only them, as in a capture.

```ts
export interface SubjectFramingSensorProfile { profile: SensorProfile; width: number; height: number; pixelPitchMicrometers?: number }
```

## ThinLensChartFramingInput

#646: the input of {@link calculateThinLensChartFraming}: `CalculateChartFramingInput` without `catalogue` and `sensorProfile`.

```ts
export type ThinLensChartFramingInput = Omit<CalculateChartFramingInput, "catalogue" | "sensorProfile">;
```

## ThinLensSubjectDistanceForFramingInput

#646: the input of {@link calculateThinLensSubjectDistanceForFraming}: `CalculateSubjectDistanceForFramingInput` without `catalogue` and `sensorProfile`.

```ts
export type ThinLensSubjectDistanceForFramingInput = Omit<CalculateSubjectDistanceForFramingInput, "catalogue" | "sensorProfile">;
```
