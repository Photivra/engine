# Using Photivra from an agent

This page is for AI agents and the people who build them. It says which function to call, which
units to pass, how to read a result and how to report it honestly. For the full option list of the
one-call capture, see the [Quick Start](QUICK_START.md). For every export, see the
[API reference](API_REFERENCE.md).

## Runtime

- The package is `@photivra/engine`, an ESM library. It runs in the browser and in Node.
- Node 22.13 or later is required (`engines` in `package.json`). The repository tests Node 22, 24
  and 26; see [NODE_SUPPORT.md](../NODE_SUPPORT.md).
- It makes no network calls and needs no API key or account. Everything runs locally.
- `simulateCapture()` hashes the scene description with Web Crypto (`crypto.subtle`). That is
  available in Node 22+ and in secure browser contexts (HTTPS or localhost).
- Results are deterministic. Random sensor noise uses a fixed seed (`sensor.noiseSeed`, default 1).

## Choosing a function

| Task | Call | Notes |
| --- | --- | --- |
| Simulate a full photo | [`simulateCapture`](api/facade-simulate-capture.md#simulatecapture) | Async. Returns an image, the RAW data, `assumptions` and `provenance`. |
| Preview a whole frame as the real capture resized for display | [`simulateDisplayView`](api/facade-simulate-display-view.md#simulatedisplayview) | Async. Takes the capture's request plus a display size; costs follow the display pixels. Labelled `kind: "display-view"`: a preview, never a capture. |
| Exposure value (EV) of a setting | [`calculateExposureValue100`](api/exposure-exposure.md#calculateexposurevalue100) | EV at ISO 100 = log2(N²/t). |
| Keep brightness after changing aperture or shutter | [`calculateEquivalentIso`](api/exposure-exposure.md#calculateequivalentiso) | Returns the compensating ISO. Not a noise model. |
| Compare two exposures in stops | [`calculateRelativeRenderedExposure`](api/exposure-exposure.md#calculaterelativerenderedexposure) | Includes ISO as gain. |
| Depth of field and hyperfocal distance | [`calculateDepthOfField`](api/optics-depth-of-field.md#calculatedepthoffield) | Thin-lens model. `farLimitM` is `null` when it is infinite. |
| Blur of an out-of-focus subject | [`calculateDefocusCircle`](api/optics-depth-of-field.md#calculatedefocuscircle) | Geometric blur-circle diameter at the sensor. |
| Check a defocus blur before rendering it | [`calculateDefocusDiscKernelRadius`](api/optics-defocus-disc-kernel.md#calculatedefocusdisckernelradius) | Whether `lens.defocus` renders the disc or refuses it (kernel radius at most `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`, 64 sites), and by how much it is over. |
| Field (angle) of view | [`calculateFieldOfView`](api/camera-field-of-view.md#calculatefieldofview) | Pass the sensor width, height or diagonal for that angle. |
| Crop factor and 35 mm-equivalent focal length | [`calculateEquivalentFocalLength35Mm`](api/camera-equivalent-focal-length.md#calculateequivalentfocallength35mm) | Diagonal-based, against a 36 × 24 mm frame. |
| Pixels left after a centred crop | [`calculateCenteredCrop`](api/output-crop.md#calculatecenteredcrop) | Keeps the aspect ratio to whole pixels. |
| Motion blur for a shutter speed | [`calculateProjectedMotionBlur`](api/motion-projected-motion.md#calculateprojectedmotionblur) | Subject position and velocity in metres; blur in mm, and in pixels if you give a pixel pitch. |
| Video shutter angle to exposure time | [`calculateShutterAngleExposureSeconds`](api/motion-video-sequence.md#calculateshutterangleexposureseconds) | Positional arguments: frame rate (Hz), angle (degrees). |
| Diffraction spot size | [`calculateAiryDisk`](api/optics-diffraction.md#calculateairydisk) | Ideal circular aperture; you choose the wavelength. |
| Photons to electrons | [`calculatePhotoelectrons`](api/sensor-signal-noise.md#calculatephotoelectrons) | Mean value; you supply the quantum efficiency. |
| Sensor noise and signal-to-noise ratio (SNR) | [`calculateSignalToNoise`](api/sensor-signal-noise.md#calculatesignaltonoise) | Shot noise plus read noise, in electrons. |
| Colour temperature to a white point | [`calculateChromaticityFromCorrelatedColorTemperature`](api/color-illuminants.md#calculatechromaticityfromcorrelatedcolortemperature) | Kelvin and Duv (tint) to CIE 1931 xy. |
| White point to colour temperature | [`calculateCorrelatedColorTemperature`](api/color-illuminants.md#calculatecorrelatedcolortemperature) | CIE 1931 xy to kelvin and Duv. |
| White balance from Kelvin and tint | [`createColorTemperatureWhiteBalanceIntent`](api/color-white-balance.md#createcolortemperaturewhitebalanceintent), then [`resolveColorTemperatureWhiteBalance`](api/color-white-balance.md#resolvecolortemperaturewhitebalance) | Needs an explicit camera colour matrix. In `simulateCapture()`, use `output.whiteBalance: { kelvin, tint }` instead. |

If a task is not in this table, search the [API reference](API_REFERENCE.md) or the
[Usage Guide](USAGE.md). Do not reimplement a formula the engine already has.

## Units and conventions

The unit is part of the field name. Read it there; do not guess.

| Quantity | Unit | Example fields |
| --- | --- | --- |
| Focal length, sensor size, circle of confusion | millimetres | `focalLengthMm`, `sensorDimensionMm`, `circleOfConfusionMm` |
| Distances in the scene | metres | `focusDistanceM`, `subjectDistanceM`, `hyperfocalDistanceM` |
| Subject position and velocity | metres, metres per second | `positionM`, `velocityMps` (+z points away from the camera) |
| Pixel pitch, Airy disk size | micrometres | `pixelPitchMicrometers`, `firstZeroDiameterMicrometers` |
| Wavelength | nanometres | `wavelengthNm`, `wavelengthNanometers` |
| Shutter time | seconds | `shutterSeconds` (1/125 s is `1 / 125`) |
| Aperture | f-number N (no unit) | `aperture` in the single calculations, `lens.fNumber` in `simulateCapture()` |
| Exposure changes | stops (factors of 2) | `compensationStops`, `stops` |
| Colour temperature | kelvin | `correlatedColorTemperatureKelvin`, `colorTemperatureKelvin`, `{ kelvin }` |
| Illuminance on the scene | lux | `illuminanceLux` |
| Scene luminance | candela per square metre | `meteredSceneLuminanceCdPerSquareMeter` |
| Signal and noise | electrons | `signalElectrons`, `readNoiseElectrons` |
| Angles | degrees or radians, as named | `degrees`, `radians`, `shutterAngleDegrees`, `angularVelocityRadPerSec` |

Other conventions:

- Most calls take one input object. Every calculator that takes an input object, including
  `simulateCapture()`, `calculateDepthOfField()` and `calculateSignalToNoise()`, rejects unknown
  fields, so a typo or a wrong unit suffix fails loudly with `InvalidConfigurationError`. Check field
  names against the reference. The versioned-record parsers (`parse*()`) and the functions that take
  a whole record are strict too: an unknown field at any level fails, and the error names it.
- `null` stands for an infinite or undefined value that JSON cannot store, for example
  `farLimitM` beyond the hyperfocal distance.
- The 35 mm reference frame is 36 × 24 mm.

## Reading results

Most single calculations return a `CalculationResult`: `{ value, provenance, quality? }`.

- `value` holds the numbers.
- `provenance.kind` is `calculated`, `calibrated`, `estimated` or `approximation`.
  - `calculated`: an exact result of the stated model, such as the thin-lens equations.
  - `approximation`: a simplified model, such as the fitted analytic colour-matching functions.
- `provenance.model` and `provenance.modelVersion` name the equation set. `provenance.assumptions`
  lists what the model leaves out, for example "Lens transmission (T-stop) is not modeled".
- `quality` appears only when the engine can defend an uncertainty or valid range. Its absence does
  not mean the result is exact.
- Results are read-only. The envelope, `provenance` and `quality` are frozen, and so is the top
  level of `value`. Assigning to them throws a `TypeError`. Copy a value (`{ ...result.value }` or
  `structuredClone(result.value)`) before you change it. Nested objects inside `value` are not
  frozen by the envelope, and typed arrays can never be frozen.

`simulateCapture()` returns a richer object:

- `assumptions` lists every choice made for you. Each entry has an `id`, a `kind`, a `value` and an
  `explanation`.
  - `default`: you left the option out, so the default was used.
  - `derived`: the facade calculated the value from your inputs, such as the framed scene size.
  - `model`: a fixed modelling choice, such as "no lens PSF".
- `provenance.scientificStatus` is always `approximation`. `provenance.limitations` says why in
  plain words.

How to report a result to a user:

- Give the number with its unit.
- Say when `provenance.kind` or `scientificStatus` is `approximation`.
- Mention the assumptions that matter for the question, for example a thin lens or no lens
  transmission.
- For `simulateCapture()`, say which inputs were defaults. Never present a simulated image as what a
  real camera would produce.

```ts
import { simulateCapture } from "@photivra/engine";

const capture = await simulateCapture({
  scene: { preset: "uniform" },
  exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 250 },
  output: { width: 8, height: 8 }
});

console.log(capture.exposure.ev100, capture.provenance.scientificStatus);
for (const assumption of capture.assumptions) {
  if (assumption.kind === "default") console.log(`${assumption.id} = ${JSON.stringify(assumption.value)}`);
}
```

## Errors

Invalid input throws. Nothing returns NaN or Infinity.

| Error | Base class | `code` | Thrown when |
| --- | --- | --- | --- |
| `InvalidScientificInputError` | `RangeError` | `INVALID_SCIENTIFIC_INPUT` | A number is missing, not finite or out of its valid range: a zero or negative f-number, a focus distance inside the focal length, an f-number or ISO outside the camera tier's capability. |
| `InvalidConfigurationError` | `TypeError` | `INVALID_CONFIGURATION` | The input has the wrong shape: not an object or array, an unknown field, an unknown kind, mode or version string, or a malformed identifier. Also any defect inside a versioned record or options object, such as a profile or a negative `exposure.iso` in `simulateCapture()`. |
| `InvalidScientificResultError` | `RangeError` | `INVALID_SCIENTIFIC_RESULT` | A result would not be finite. |

All three are root exports, so you can test them with `instanceof`. `simulateCapture()` is async, so
its errors arrive as a rejected promise.

How to recover:

- Read `message`. It names the field and the rule, for example
  "aperture must be a finite number greater than zero."
- For `InvalidScientificInputError`, change the value, not the units. Check you passed metres where
  the field ends in `M` and millimetres where it ends in `Mm`.
- For `InvalidConfigurationError`, fix the field name or shape against the
  [API reference](API_REFERENCE.md).
- Do not retry the same input. The engine is deterministic and will fail the same way.

Some lower-level planners return structured `blockers` for a well-formed request they cannot serve,
instead of throwing. Report those to the user as unsupported, not as errors in their input.

```ts
import { calculateDepthOfField, InvalidConfigurationError, InvalidScientificInputError } from "@photivra/engine";

try {
  calculateDepthOfField({ focalLengthMm: 50, aperture: 8, focusDistanceM: 0.01, circleOfConfusionMm: 0.03 });
} catch (error) {
  if (error instanceof InvalidScientificInputError) console.log("Fix the value:", error.code, error.message);
  else if (error instanceof InvalidConfigurationError) console.log("Fix the shape:", error.code, error.message);
  else throw error;
}
```

Here 0.01 m (10 mm) is closer than the 50 mm focal length, so the call throws
`InvalidScientificInputError`.

## Limits to state

- **The camera tiers are synthetic.** `"consumer"`, `"prosumer"` and `"professional"` are educational
  designs owned by Photivra. They are not measured from, calibrated to or named after any real camera
  or lens. All three tier lenses are 50 mm primes with an f/4–f/16 range.
- **No real camera or lens is modelled.** The engine claims no named commercial camera or lens
  performance.
- **`simulateCapture()` is an approximation.** It uses an idealized colorimetric sensor, a flat
  Lambertian scene and, by default, no lens PSF, diffraction, vignetting or distortion. See
  [Modelling choices](QUICK_START.md#modelling-choices).
- **The single calculations are ideal models.** Depth of field and field of view use a thin lens.
  The Airy disk assumes an ideal circular aperture. SNR leaves out dark current and fixed-pattern
  noise. Each result's `provenance.assumptions` says what it leaves out.
- **Not modelled yet** (from the README): decentering distortion and named-lens calibration,
  calibrated commercial in-body or optical stabilization, non-uniform or segmented sensor readout,
  rolling-shutter image distortion in the low-level readout-timing model, and photon or noise output
  in the composed POC (`simulatePocCamera()`). See
  [Important scientific limits](../README.md#important-scientific-limits) for the full list.
