# exposure/auto-iso-slowest-shutter.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS

The largest whole-stop bias accepted, either way (makers offer up to 2 stops faster or slower).

```ts
AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS = 2 as const
```

## AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION = "1.0.0" as const
```

## AutoIsoSlowestShutterBlurBudget

The blur allowed during the exposure, on the sensor.

```ts
export type AutoIsoSlowestShutterBlurBudget =
  | {
      /** The blur trace length in pixels of the given pitch. */
      kind: "pixels";
      pixels: number;
      pixelPitchMicrometers: number;
    }
  | {
      /** The blur trace length as a fraction of the image diagonal (width × height in millimetres). */
      kind: "image-diagonal-fraction";
      fraction: number;
      imageWidthMm: number;
      imageHeightMm: number;
    };
```

## AutoIsoSlowestShutterEstimate

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AutoIsoSlowestShutterEstimate {
  /** The exposure time whose shake blur equals the budget, before the bias and the grid. */
  derivedShutterSeconds: number;
  fasterByStops: number;
  /** derivedShutterSeconds · 2^−fasterByStops. */
  biasedShutterSeconds: number;
  /** The slowest preferred shutter: the biased value, snapped to `shutterCapability` when given. */
  shutterSeconds: number;
  shutterResolution: {
    kind: "unconstrained" | "continuous" | "discrete";
    selectionPolicy: "not-longer-than-target";
    quantized: boolean;
    clamped: false | "minimum" | "maximum";
  };
  blurBudgetMm: number;
  /** `estimateCameraShakeBlur()`'s stabilized blur at the derived shutter (equal to the budget within rounding). */
  blurAtDerivedShutterMm: number;
  /** `estimateCameraShakeBlur()`'s stabilized blur at `shutterSeconds`. */
  blurAtShutterMm: number;
  /** The same blur lengths in pixels, for a pixel budget. */
  blurBudgetPixels?: number;
  blurAtShutterPixels?: number;
  projectionDistanceMm: number;
  residualMotionFactor: number;
  angularVelocityRadPerSec: { yaw: number; pitch: number };
  stabilizationStopsEquivalent: number;
}
```

## estimateAutoIsoSlowestShutter

Estimates the slowest preferred shutter for Auto ISO from the lens, the sensor and the hand's
shake: the exposure time at which `estimateCameraShakeBlur()`'s stabilized blur equals the blur
budget, then shifted by a whole-stop bias and optionally snapped to the body's shutter grid (never
longer than the biased value). Longer focal lengths give faster shutters; each stabilization stop
doubles the time; each bias stop halves (+1) or doubles (−1) it.

An approximation: constant angular velocity (a caller profile, or the labelled generic default
`GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC`), stabilization as 2^−stops, blur on the optical axis
only. The 1/focal-length "reciprocal rule" is a rule of thumb and is not used.

```ts
export function estimateAutoIsoSlowestShutter(
  input: EstimateAutoIsoSlowestShutterInput
): CalculationResult<AutoIsoSlowestShutterEstimate>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateAutoIsoSlowestShutterInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateAutoIsoSlowestShutterInput {
  focalLengthMm: number;
  /** Optional focus distance in metres: the thin-lens image distance becomes the projection distance, as in `estimateCameraShakeBlur()`. */
  focusDistanceM?: number;
  /**
   * The hand's constant angular velocity in radians per second, the explicit shake profile (signs as in
   * `estimateCameraShakeBlur()`; only the magnitude matters here). At least one axis must be non-zero.
   * `GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC` is a cited generic default, not a measurement of you.
   */
  angularVelocityRadPerSec: { yaw: number; pitch: number };
  /** Stabilization in equivalent stops (≥ 0); the motion is scaled by 2^−stops. Default 0. */
  stabilizationStopsEquivalent?: number;
  blurBudget: AutoIsoSlowestShutterBlurBudget;
  /**
   * The bias in whole stops, applied after the derivation: +1 is one stop faster (half the time), −1 one
   * stop slower (twice the time). An integer from −2 to +2. Default 0.
   */
  fasterByStops?: number;
  /** Optional: the body's resolved shutter capability. The biased shutter then snaps to it, never longer than the biased value, and is held at its ends. */
  shutterCapability?: ResolvedGenericEquipmentExposureCapabilities["shutter"];
}
```

## GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC

A generic handheld angular velocity, labelled as a default and not a measurement of any camera or
photographer: 4.39 °/s (≈ 0.0766 rad/s), the linear camera-motion rate Xiao, Farrell, Catrysse and
Wandell use for "an average user" holding "a typical 100g mobile handset with two hands", from their
earlier gyroscope measurements (F. Xiao, J. Farrell, P. Catrysse, B. Wandell, "Mobile imaging: the
big challenge of the small pixel", Proc. SPIE 7250, Digital Photography V, 2009, §2; author copy:
https://web.stanford.edu/~wandell/data/papers/2009-CameraShake-Xiao.pdf; they cite F. Xiao et al.,
"Camera-motion and mobile imaging", Proc. SPIE 6502, 2007). The value is one rate magnitude; it is
placed on the yaw axis (for small angles the blur length does not depend on the direction). A
heavier camera, another grip or another photographer moves differently: pass your own profile.

```ts
GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC: Readonly<{ yaw: number; pitch: number }> =
  Object.freeze({ yaw: (4.39 * Math.PI) / 180, pitch: 0 })
```
