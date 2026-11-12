# camera/sensor-equivalence.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## BlurShareOfFrame

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BlurShareOfFrame {
  /** Blur-circle diameter on the sensor in millimetres. */
  blurCircleMm: number;
  /** Sensor diagonal in millimetres. */
  frameDiagonalMm: number;
  /** Blur diameter / frame diagonal. Equal shares look the same at the same output size. */
  shareOfDiagonal: number;
  /** Blur diameter / frame width. */
  shareOfWidth: number;
  /** Blur diameter / frame height. */
  shareOfHeight: number;
  /** Blur on the print; present only when a print size was given. */
  print?: BlurShareOfPrint;
}
```

## BlurShareOfPrint

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BlurShareOfPrint {
  /** Linear enlargement from sensor to print: the smaller of the long-side and short-side ratios. */
  enlargement: number;
  /** Blur-circle diameter on the print in millimetres: blurCircleMm × enlargement. */
  blurOnPrintMm: number;
  /** Size of the printed image in millimetres (equal to the print when the aspect ratios match). */
  imageLongSideMm: number;
  imageShortSideMm: number;
}
```

## calculateBlurShareOfFrame

A blur circle on the sensor as a share of the frame (diagonal, width and height) and, when a
print size is given, its diameter on that print.

Equal shares of the diagonal look the same when the images are shown at the same size, which
is how "same framing" comparisons across sensor sizes are stated. Every value is an exact ratio
or scaling; whether a blur is visible depends on viewing distance and acuity, which this
function does not judge.

```ts
export function calculateBlurShareOfFrame(
  input: CalculateBlurShareOfFrameInput
): CalculationResult<BlurShareOfFrame>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateBlurShareOfFrameInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateBlurShareOfFrameInput {
  /** Blur-circle diameter on the sensor in millimetres (for example from calculateDefocusCircle). Zero is allowed. */
  blurCircleMm: number;
  /** Physical active imaging area of the sensor. */
  sensor: SensorImagingArea;
  /**
   * Optional print size. The whole frame is enlarged to fit inside it without cropping, long side
   * to long side.
   */
  print?: { widthMm: number; heightMm: number };
}
```

## calculateSensorEquivalence

Equivalence of a lens (focal length, f-number) on one sensor against a reference format,
36 × 24 mm by default: crop factor, equivalent focal length, equivalent f-number for depth of
field, blur and total light, the unchanged f-number for exposure, sensor area ratio, total-light
difference in stops and the angles of view.

Call it once per sensor for a lens table. Every quantity carries a `basis` entry saying whether it
is exact under its stated conditions or an approximation. The equivalent f-number is an
approximation (exact when the focus distance is much greater than the focal length) and never an
exposure setting: exposure uses `exposureFNumber`, the f-number on the lens.

Example: 50 mm f/2 on a 23.5 × 15.6 mm sensor gives crop factor ≈ 1.53, ≈ 77 mm and ≈ f/3.1.

```ts
export function calculateSensorEquivalence(
  input: CalculateSensorEquivalenceInput
): CalculationResult<SensorEquivalence>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEquivalenceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorEquivalenceInput {
  /** Physical active imaging area of the sensor the lens is used on. */
  sensor: SensorImagingArea;
  /** Physical focal length of the lens in millimetres. */
  focalLengthMm: number;
  /** f-number set on the lens (N = focal length / entrance-pupil diameter). */
  fNumber: number;
  /** Format to compare against. Defaults to the 36 × 24 mm frame. */
  reference?: SensorImagingArea;
}
```

## EquivalenceExactness

Whether a value is exact under its stated conditions or an approximation.

```ts
export type EquivalenceExactness = "exact" | "approximation";
```

## EquivalenceValueBasis

How one equivalence quantity was obtained, and under which conditions it holds.

```ts
export interface EquivalenceValueBasis {
  /** `"exact"` under the stated conditions, or `"approximation"`. */
  kind: EquivalenceExactness;
  /** Plain statement of the definition and its conditions. */
  statement: string;
}
```

## SensorEquivalence

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorEquivalence {
  /** Physical focal length supplied by the caller, in millimetres. */
  focalLengthMm: number;
  /** f-number supplied by the caller. */
  fNumber: number;
  /** Sensor active imaging area used. */
  sensor: SensorImagingArea;
  /** Reference format used (36 × 24 mm unless the caller passed one). */
  reference: SensorImagingArea;
  /** Sensor diagonal in millimetres. */
  sensorDiagonalMm: number;
  /** Reference diagonal in millimetres. */
  referenceDiagonalMm: number;
  /** Diagonal crop factor: reference diagonal / sensor diagonal. Greater than 1 for a smaller sensor. */
  cropFactor: number;
  /** Focal length on the reference format with the same diagonal angle of view: cropFactor × focalLengthMm. */
  equivalentFocalLengthMm: number;
  /**
   * f-number on the reference format that gives the same depth of field, background blur and total
   * light for the same framing and output size: cropFactor × fNumber. Not an exposure setting.
   */
  equivalentFNumber: number;
  /** f-number that sets exposure (image brightness): the f-number on the lens, unchanged by sensor size. */
  exposureFNumber: number;
  /** Entrance-pupil diameter f/N in millimetres; the equivalent lens has the same diameter. */
  entrancePupilDiameterMm: number;
  /** Sensor area / reference area. Less than 1 for a smaller sensor. */
  areaRatio: number;
  /**
   * log2(areaRatio): total light collected by the sensor relative to the reference at the same
   * f-number, shutter time and scene, in stops. Negative for a smaller sensor.
   */
  totalLightDifferenceStops: number;
  /** Angles of view of this lens on the sensor (the equivalent lens gives the same diagonal angle). */
  fieldOfView: SensorEquivalenceFieldOfView;
  /** Exact or approximated, with the conditions, for every quantity above. */
  basis: Readonly<Record<SensorEquivalenceQuantity, EquivalenceValueBasis>>;
}
```

## SensorEquivalenceFieldOfView

Angles of view of an ideal rectilinear lens focused at infinity, in degrees.

```ts
export interface SensorEquivalenceFieldOfView {
  horizontalDegrees: number;
  verticalDegrees: number;
  diagonalDegrees: number;
}
```

## SensorEquivalenceQuantity

Quantities of a sensor equivalence result that carry an exactness statement.

```ts
export type SensorEquivalenceQuantity =
  | "cropFactor"
  | "equivalentFocalLengthMm"
  | "equivalentFNumber"
  | "exposureFNumber"
  | "entrancePupilDiameterMm"
  | "areaRatio"
  | "totalLightDifferenceStops"
  | "fieldOfView";
```
