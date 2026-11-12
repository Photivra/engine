# facade/subject-framing.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateChartFraming

How much of the frame a chart of a given physical size covers at any subject distance (2.5): magnification, framed plane size,
coverage fractions (above 1 when cropped), the chart's image size and the minimum-focus check. The same thin-lens framing as
`simulateCapture` (`scene.framing`, `result.scene.chart`) and `calculateSubjectDistanceForFraming`.

```ts
export function calculateChartFraming(input: CalculateChartFramingInput): ChartFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateChartFramingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateChartFramingInput {
  /** Active sensor (or simulated frame) size, mm: for `simulateCapture`, output width × height × pixel pitch. */
  sensor: { widthMm: number; heightMm: number };
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
}
```

## calculateSubjectDistanceForFraming

The subject distance that fits a chart of a given physical size to the frame, with magnification, coverage and the minimum-focus check (2.3).

```ts
export function calculateSubjectDistanceForFraming(input: CalculateSubjectDistanceForFramingInput): SubjectFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSubjectDistanceForFramingInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSubjectDistanceForFramingInput {
  /** Active sensor (or simulated frame) size, mm. */
  sensor: { widthMm: number; heightMm: number };
  /** Physical focal length, mm. Give exactly one of this and `equivalentFocalLengthMm`. */
  focalLengthMm?: number;
  /** Full-frame-equivalent focal length (diagonal crop factor); a generic prime's value also reports that lens. */
  equivalentFocalLengthMm?: number;
  /** Chart size as for `simulateCapture` `chartSize`: heightM defaults to widthM × the sensor aspect (height / width). */
  chart: { widthM: number; heightM?: number };
  fit?: SubjectFramingFit;
}
```

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
  scientificStatus: "approximation";
  assumptions: readonly SimulateCaptureAssumption[];
}
```

## SubjectFramingFit

How the chart fits the frame: `contain` (default; the whole chart is visible and its limiting side touches the frame), `width`, `height` or `cover` (the chart fills the frame and is cropped on its other side).

```ts
export type SubjectFramingFit = "contain" | "width" | "height" | "cover";
```
