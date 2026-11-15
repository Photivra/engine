# exposure/exposure-helpers.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateFreezeShutterSpeed

The slowest shutter speed that freezes a subject (#616): the exposure time at which a subject crossing the field at
`subjectSpeedMps` and `subjectDistanceM` travels the blur limit on the sensor, t = b·d/(v·s′), with s′ the thin-lens image
distance at the focus distance.

The image speed comes from `calculateProjectedMotionBlur` (ideal rectilinear thin-lens projection, constant velocity
perpendicular to the line of sight), which is linear in time for such motion, so the result is exact under that model.
Motion toward the camera, camera shake and the pixel aperture are not included.

Example: 10 m/s at 20 m with a 200 mm lens and a 1-pixel limit at 4 µm: about 1/25,250 s (s′ ≈ 202.0 mm).

```ts
export function calculateFreezeShutterSpeed(input: CalculateFreezeShutterSpeedInput): CalculationResult<FreezeShutterSpeed>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateFreezeShutterSpeedInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateFreezeShutterSpeedInput {
  /** Subject speed across the line of sight, m/s (the component perpendicular to it). */
  subjectSpeedMps: number;
  /** Subject distance, m. */
  subjectDistanceM: number;
  /** Lens focal length, mm. */
  focalLengthMm: number;
  /** Focus distance, m. Default: the subject distance. */
  focusDistanceM?: number;
  /**
   * The largest acceptable blur: in pixels with the pixel pitch, or as a fraction of the frame's diagonal (or width or height)
   * with the sensor's active area.
   */
  blurLimit: { pixels: number; pixelPitchMicrometers: number } | { fractionOfFrame: number; sensor: SensorImagingArea; along?: "diagonal" | "width" | "height" };
  /** Optional shutter dial: the result also gives the slowest dial value that does not exceed the limit. */
  shutterDialSeconds?: readonly number[];
}
```

## calculateStandardExposure

The standard exposure for a chosen light (#616): the metered EV and a settings pair for a named light level, an illuminance
(incident metering of an 18 % grey card, L = 0.18·E/π) or a luminance (reflected metering), at an ISO.

The exposure is the engine's standard exposure, the one `simulateCapture` meters to: H = 10/S at the focal plane (CIPA
DC-004-2020 §3.2) with the camera equation H = 0.65·L·t/N² (§5.5 (4)), so N²/t = 0.065·L·S. The named levels are
representative values from free sources (`NAMED_LIGHT_LEVELS`), not measurements of a particular scene.

Example: "overcast-day" (1,000 lux, L = 180/π ≈ 57.3 cd/m²) at ISO 100 gives EV 8.54 and, at f/2.8, about 1/47.5 s (1/50 s on a
third-stop dial).

```ts
export function calculateStandardExposure(input: CalculateStandardExposureInput): CalculationResult<StandardExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateStandardExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateStandardExposureInput {
  /** ISO setting. Default 100. */
  iso?: number;
  /** A named light level, metered as an 18 % grey card under its illuminance. Give exactly one of light, illuminanceLux and luminanceCdPerSquareMeter. */
  light?: NamedLightLevel;
  /** Illuminance on the subject, lux, metered as an 18 % grey card (incident metering): L = 0.18·E/π. */
  illuminanceLux?: number;
  /** Metered scene luminance, cd/m² (reflected metering). */
  luminanceCdPerSquareMeter?: number;
  /** f-number for the settings pair (default f/8); the shutter follows. Not with `shutterSeconds`. */
  aperture?: number;
  /** Shutter time for the settings pair, seconds; the f-number follows. Not with `aperture`. */
  shutterSeconds?: number;
  /** Optional shutter dial: the result also gives the dial value nearest the pair's shutter (with `aperture`). */
  shutterDialSeconds?: readonly number[];
}
```

## calculateSunnySixteenExposure

The sunny-16 rule (#616): the base exposure for a daylight condition at an ISO, f/16 at 1/ISO in bright sun and one stop
wider for each step of cloud or shade (f/11 slight overcast, f/8 overcast, f/5.6 heavy overcast, f/4 open shade).

A rule of thumb for a front-lit average subject (Kodak publication F-4017's daylight table; Wikipedia, "Sunny 16 rule"),
not a metered exposure: the result also gives its EV and the luminance it exposes at the engine's standard exposure
(CIPA DC-004-2020), for comparison with `calculateStandardExposure`.

Example: sunny at ISO 100 gives f/16 at 1/100 s, EV 14.64.

```ts
export function calculateSunnySixteenExposure(input: CalculateSunnySixteenExposureInput): CalculationResult<SunnySixteenExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSunnySixteenExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSunnySixteenExposureInput {
  condition: SunnySixteenCondition;
  /** ISO setting. */
  iso: number;
  /** Optional shutter dial (for example `GENERIC_THIRD_STOP_SHUTTER_SECONDS`): the result also gives the dial value nearest 1/ISO. */
  shutterDialSeconds?: readonly number[];
}
```

## FreezeShutterSpeed

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface FreezeShutterSpeed {
  /** The slowest shutter time that keeps the blur at the limit, seconds. */
  shutterSeconds: number;
  /** The slowest dial value not longer than `shutterSeconds` (null when the dial has none), when a dial was given. */
  dialShutterSeconds?: number | null;
  /** The blur limit on the sensor, mm. */
  blurLimitMm: number;
  /** Image-plane speed of the subject, mm/s: v·s′/d. */
  imageSpeedMmPerSecond: number;
  /** Thin-lens image distance used for the projection, mm. */
  projectionDistanceMm: number;
}
```

## NAMED_LIGHT_LEVELS

Representative illuminances of common light levels (free sources; real scenes vary widely around them).

```ts
NAMED_LIGHT_LEVELS: Readonly<Record<NamedLightLevel, NamedLightLevelRecord>> = Object.freeze({
  "direct-sun": level(130000, 130000, "Sun overhead", SCHLYTER),
  "full-daylight": level(10000, 25000, "Full daylight, not direct sun", SCHLYTER),
  "overcast-day": level(1000, 1000, "Overcast day", SCHLYTER),
  "very-dark-overcast-day": level(100, 100, "Very dark overcast day", SCHLYTER),
  office: level(320, 500, "Office lighting", LUX_TABLE),
  "living-room": level(50, 50, "Family living room lights", LUX_TABLE),
  twilight: level(10, 10, "Twilight", SCHLYTER),
  "full-moon": level(0.267, 0.267, "Full Moon overhead", SCHLYTER),
  "starlight-and-airglow": level(2e-3, 2e-3, "Total starlight and airglow", SCHLYTER),
  starlight: level(2e-4, 2e-4, "Total starlight only", SCHLYTER),
  "overcast-night": level(1e-4, 1e-4, "Total starlight at an overcast night", SCHLYTER)
})
```

## NamedLightLevel

A named light level (#616).

```ts
export type NamedLightLevel = "direct-sun" | "full-daylight" | "overcast-day" | "very-dark-overcast-day" | "office" | "living-room" | "twilight" | "full-moon" |
  "starlight-and-airglow" | "starlight" | "overcast-night";
```

## NamedLightLevelRecord

A named light level's illuminance on a horizontal surface, the range the source gives and the source.

```ts
export interface NamedLightLevelRecord {
  /** Illuminance used, lux: the source's value, or the geometric mean of its range. */
  illuminanceLux: number;
  /** The source's range, lux (equal ends for one value). */
  rangeLux: readonly [number, number];
  description: string;
  source: string;
}
```

## StandardExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface StandardExposure {
  iso: number;
  /** The metered luminance, cd/m². */
  luminanceCdPerSquareMeter: number;
  /** The illuminance, lux, when the light was given as an illuminance or a named level. */
  illuminanceLux: number | null;
  light: NamedLightLevel | null;
  /** EV at the request's ISO: log2(N²/t) = log2(0.065·L·S). */
  exposureValue: number;
  /** EV at ISO 100. */
  ev100: number;
  /** The settings pair at the standard exposure. */
  aperture: number;
  shutterSeconds: number;
  /** The dial value nearest the shutter, when a dial was given. */
  dialShutterSeconds?: number | null;
}
```

## SUNNY_SIXTEEN_CONDITIONS

The sunny-16 table: each condition's stops wider than f/16, its marked f-number and the shadows it is recognized by.

```ts
SUNNY_SIXTEEN_CONDITIONS: Readonly<Record<SunnySixteenCondition, Readonly<{ stopsFromSunny: number; markedFNumber: number; shadows: string }>>> =
  Object.freeze({
    sunny: Object.freeze({ stopsFromSunny: 0, markedFNumber: 16, shadows: "clearly defined shadows" }),
    "slight-overcast": Object.freeze({ stopsFromSunny: 1, markedFNumber: 11, shadows: "soft shadow edges" }),
    overcast: Object.freeze({ stopsFromSunny: 2, markedFNumber: 8, shadows: "shadows barely visible" }),
    "heavy-overcast": Object.freeze({ stopsFromSunny: 3, markedFNumber: 5.6, shadows: "no shadows" }),
    "open-shade": Object.freeze({ stopsFromSunny: 4, markedFNumber: 4, shadows: "no shadows (subject in the shade of an open sky)" })
  })
```

## SunnySixteenCondition

A sunny-16 lighting condition.

```ts
export type SunnySixteenCondition = "sunny" | "slight-overcast" | "overcast" | "heavy-overcast" | "open-shade";
```

## SunnySixteenExposure

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SunnySixteenExposure {
  condition: SunnySixteenCondition;
  iso: number;
  /** f-number, exactly 16 / √2^stops = 2^(4 − stops/2) (f/11.31 for "slight-overcast"). */
  aperture: number;
  /** The marked f-number the rule names (f/11, f/5.6). */
  markedFNumber: number;
  /** 1 / ISO, seconds. */
  shutterSeconds: number;
  /** The dial value nearest 1/ISO, when a dial was given. */
  dialShutterSeconds?: number | null;
  /** Exposure value of the pair, log2(N²/t). */
  exposureValue: number;
  /** The same normalized to ISO 100: exposureValue − log2(ISO/100) = log2(100·N²) (14.64 for sunny). */
  ev100: number;
  /** Scene luminance that the pair exposes at the engine's standard exposure, 10·N²/(0.65·t·S) cd/m². */
  standardLuminanceCdPerSquareMeter: number;
  shadows: string;
}
```
