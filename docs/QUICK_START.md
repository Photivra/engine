# Quick start: simulate a capture

`simulateCapture()` takes a small description of a camera, a lens setting, an exposure and a
scene, and returns a developed image. Behind it runs the engine's full physical pipeline: scene
radiance → lens → spectral sensor response → charge and noise → RAW readout → RAW development →
optional JPEG.

`simulateCapture()` is a *facade*: one simple entry point in front of those existing contracts. It
adds no physics of its own. It only builds the request for the existing contracts, runs them, and
tells you every choice it made for you.

This page covers the inputs, the defaults, the chart presets and the limits. The detailed contracts
it composes are in [ENVIRONMENT_RAW_CAPTURE.md](https://github.com/Photivra/photivra/blob/main/docs/ENVIRONMENT_RAW_CAPTURE.md),
[NATIVE_RAW_AND_PRINT.md](https://github.com/Photivra/photivra/blob/main/docs/NATIVE_RAW_AND_PRINT.md), [GENERIC_TIER_PRESETS.md](https://github.com/Photivra/photivra/blob/main/docs/GENERIC_TIER_PRESETS.md),
[COLORIMETRY.md](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md) and the [Usage Guide](USAGE.md).

Calling the engine from an AI agent? [Using Photivra from an agent](AGENT_GUIDE.md) says which
function fits each task, which units to pass and how to report results honestly.

## The ten-line capture

```ts
import { simulateCapture } from "@photivra/engine";

const capture = await simulateCapture({
  camera: "professional",
  lens: { fNumber: 8 },
  exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
  scene: { preset: "slanted-edge" },
  output: { width: 16, height: 16, format: "srgb-8" }
});
console.log(capture.image.width, capture.image.samples.length, capture.exposure.settings);
```

`capture.image.samples` holds interleaved 8-bit sRGB values, row by row from the top-left. The scene
is the only required input; every other field above is the default and could be left out.

Without the facade, the same kind of result needs the 34-line
[production-capture.mjs](examples/production-capture.mjs) plus its 4,613-line
[production-request.json](examples/production-request.json) for a 2 × 2 capture. A runnable version of
the example above is [simulate-capture.mjs](examples/simulate-capture.mjs).

## What comes back

| Field | Contents |
| --- | --- |
| `image` | `width`, `height`, `format`, `samples` (`Uint8Array` or `Uint16Array` RGB), `jpeg` bytes for the `jpeg` format, `png` bytes plus `colorEncoding` for the `png` format, and `dng` bytes for the `dng` format |
| `raw` | The packed native RAW: codes, black levels, saturation flags and per-phase white levels |
| `plan` | The native RAW plan the engine executed |
| `request` | The complete underlying request: `environmentRaw` (the native environment RAW input), `siteInput(index)` (rebuilds the physical input of any sensor site), `development` (the RAW development input) and `whiteBalanceState` |
| `exposure` | Mode, resolved settings, EV100, `isoControl` (`"manual"` or `"automatic"`) and, with `iso: "auto"`, `autoIso` (how the ISO was chosen and what limited it), metered scene luminance, the deviation from the standard exposure in stops (`standardExposureDeviationStops`), the illuminance at which the settings give the standard exposure (`standardExposureIlluminanceLux`), from 2.14 the deviation from the standard exposure of an 18 % grey card under the scene's illuminance (`greyCardDeviationStops`, incident metering) and the exposure-mode resolver's full output |
| `scene` | Chart parameters, illuminant, distance, framed size and the scene's SHA-256 digest (it covers caller illuminant and reflectance spectra; see `sourceSha256`) |
| `diagnostics` | Radiance query count, highlight and rendering counters, per-stage timings (`timingsMs`) and, from 2.1, the opt-ins that ran (`options`); see [Cost of each option](#cost-of-each-option) |
| `provenance` | Status (`approximation`), camera preset identity, evidence, the composed contracts in order, and limitations |
| `assumptions` | Every default, derived value and fixed modelling choice, each with an explanation |

Nothing is hidden: when you omit a field, an entry with `kind: "default"` names it and its value.
Values the facade calculates (such as the framed chart size) appear as `kind: "derived"`, and fixed
modelling choices (such as "no lens PSF") as `kind: "model"`.

## Inputs and defaults

| Option | Default | Notes |
| --- | --- | --- |
| `camera` | `"professional"` | A generic tier id (`"consumer"`, `"prosumer"`, `"professional"`) or a full `GenericEquipmentTierPreset` record. A record must have exactly the preset shape (unknown fields at the top level, in `body`, `lens` or `lens.matchedReference` are rejected) and each profile is re-checked by its own parser. Tier values are synthetic educational designs, not real cameras. |
| `lens.focalLengthMm` | 50 | Must lie in the lens capability; the generic primes are 50 mm. |
| `lens.prime` | off | 2.3: a generic prime by full-frame-equivalent focal length (see [Generic prime lenses](#generic-prime-lenses-23)). |
| `lens.fNumber` | 8 | Used in `manual` and `aperture-priority`; resolved automatically otherwise. Must lie in f/4–f/16. |
| `lens.focusDistanceM` | the subject distance | |
| `lens.pupilSampling` | off | `{ radialSamples, angularSamples }` traces an ideal circular pupil, which renders defocus. Off means one chief ray per sample. Angular samples 4–64, at most 256 rays. |
| `lens.projection` | `"rectilinear"` | Any `LENS_PROJECTION_MODELS` value, for example `"fisheye-equisolid-angle"` (see [Optics](#optics)). |
| `lens.distortion` | none | `{ kind: "radial", profile }` or `{ kind: "brown-conrady", profile }`. |
| `lens.vignetting` | none | An `IlluminationVignettingProfile` (radial relative illumination). |
| `lens.psf` | none | A `{ kind: "sampled-local", configuration }` sampled lens PSF, passed to the environment contract unchanged. |
| `lens.defocus` | off | `{ model: "geometric-disc" }`: defocus of the scene plane as the geometric blur disc (see [Optics](#optics)). `simulateCapture` and `simulateDisplayView` render it. |
| `lens.diffraction` | off | 2.1: `"circular-aperture"` or `{ kind: "circular-aperture", kernelRadiusSamples, fast }`: diffraction blur of an ideal lens at the resolved f-number (see [Optics](#optics)). `aperture` is accepted as a deprecated alias of `kind` until 3.0.0. |
| `exposure.mode` | `"manual"` | Also `"aperture-priority"`, `"shutter-priority"`, `"program"`. |
| `exposure.iso` | 100 | Selects the body's ISO readout regime (gain and read noise). From 2.14 the tier bodies (preset 2.1.0) take the third-stop settings `GENERIC_THIRD_STOP_ISO_SETTINGS` (100, 125, 160, 200 … up to the body's maximum: 6400, 12 800 or 25 600). `"auto"` lets Auto ISO choose it from the meter in any mode (see [Auto ISO](#auto-iso-516)); it steps in whole stops unless `exposure.autoIso.isoSteps: "third-stop"`. |
| `exposure.autoIso` | none | With `iso: "auto"` only. `aperture-priority` requires `{ slowestPreferredShutterSeconds, afterMaximumIso? }`, and `program` takes them optionally; the slowest shutter may be `"auto"`, set by `automaticSlowestShutter`. Every mode takes `limits: { maximum, minimum? }`, the photographer's Auto ISO range (see [Auto ISO](#auto-iso-516)). |
| `exposure.shutterSeconds` | 1/125 | Used in `manual` and `shutter-priority`. |
| `exposure.compensationStops` | 0 | Applied to the meter target. |
| `exposure.metering` | `"scene-average"` | 2.14: or `"grey-card"`, incident metering: the meter reads an 18 % grey card under the scene's illuminance instead of the scene, so the automatic modes and Auto ISO land on `greyCardDeviationStops` = 0 (see [Exposure](#exposure)). Reported as `exposure.metering`. |
| `scene` | required | A chart preset or a caller function (below). |
| `subjectDistanceM` | 5 | Distance of the scene plane. |
| `chartSize` | fill the frame | 2.3: `{ widthM, heightM?, surroundReflectance? }` places the chart at its physical size (see [Fixed-size chart](#fixed-size-chart-23)). |
| `illuminant` | Planckian 6500 K | Also `"cie-a"`, `{ kind: "planckian", temperatureKelvin }`, `{ kind: "daylight", correlatedColorTemperatureKelvin, basis }` or `{ kind: "spectrum", spectrum }`. |
| `illuminanceLux` | 21 481 (π·80 000/11.7) | See [Exposure](#exposure). |
| `output.width`, `output.height` | 64 × 64 | Output pixels, 1–4094 each. The sensor has one extra site on each side for demosaicing (see `output.borderHandling`). |
| `output.maximumPixels` | off | Opt-in large images (2.2): the most native sensor sites the capture may allocate, up to `NATIVE_RAW_LIMITS.ceilingPixels` (2^27). Sides may then reach 16 384 sites including the margin (see [Large images](#large-images)). |
| `output.region` | whole frame | 2.3: `{ x, y, width, height }` renders that rectangle of the frame, byte-identical to the whole render (see [Region rendering](#region-rendering-23)). |
| `output.format` | `"srgb-8"` | Also `"srgb-16"`, `"jpeg"`, `"png"` and `"dng"` (see [Output formats](#output-formats)). |
| `output.colorEncoding` | `"srgb"` | PNG only: also `"display-p3"` and `"rec2020"`. |
| `output.bitDepth` | 8 | PNG only: 8 or 16. |
| `output.gamutMapping` | `"clip"` | PNG only: or `"perceptual"`. |
| `output.dng.capturedAtUtc` | none | DNG only: capture time for the date tags. |
| `output.metadata` | none | 2.4: `{ description?, software?, copyright?, comment? }` written into JPEG, PNG and DNG files unchanged (see [Text metadata](#text-metadata-24)). |
| `output.demosaic` | the 1.0 bilinear kernels | `"bilinear"` or, from 2.1, `"ahd"` (see [Demosaic](#demosaic)); or the record `{ kind, fast }`. |
| `output.borderHandling` | `"margin"` | Or `"mirror"`. |
| `output.toneCurve` | `"identity"` | Any `SdrToneCurve`, for example `"positive-reinhard-per-channel"`. |
| `output.toneCurveParameters` | none | Required by the luminance curves (`extended-reinhard-luminance`, `naka-rushton-luminance`); the facade invents no curve parameters. |
| `output.highlightMode` | `"clip"` | Or `"reconstruct"`. |
| `output.whiteBalance` | `"scene-illuminant"` | Also `"auto"`, `"none"`, `{ kelvin, tint? }` and `{ channelGains }`. |
| `output.jpegQuantizationStep` | 2 | JPEG only: constant step 1–255, not a manufacturer quality scale. |
| `sensor.pixelPitchMicrometers` | 6 | 0.5–1000 (2.5; 0.5–100 before). The sensor is `width × pitch` wide (see [Geometry](#geometry)); the ISO readout scales with the pixel area (see [ISO and pixel size](#iso-and-pixel-size)). Above 100 µm the capture is a downsized view of a whole frame (see [Whole-frame views](#whole-frame-views-25)). |
| `sensor.spectralStepNanometers` | 20 | Spectral quadrature over 380–780 nm. |
| `sensor.temporalSampleCount` | 1, or 8 when the camera rotates | Midpoints across each site's exposure window. |
| `sensor.noiseSeed` | 1 | Output is deterministic for a given seed. |
| `sensor.antiAliasing` | off | 2.1: an optical low-pass (anti-aliasing) filter: `{ kind: "four-spot", separationSites? }`, `{ kind: "two-spot", axis, separationSites? }` or `{ kind: "point-splitting", components }` (see [Anti-aliasing filter](#anti-aliasing-filter)). Each record also takes `fast`. |
| `sensor.pixelAperture` | `"point"` | 2.3: `"box"` or `{ kind: "box", samplesPerAxis, fast }` integrates each square photosite (see [Pixel aperture](#pixel-aperture-23)). |
| `fast` | `false` | Exact or fast for every option in `SIMULATE_CAPTURE_FAST_OPTIONS`; an option's record `fast` overrides it. No option has a fast method yet, so results are exact; `diagnostics.fast` reports what was requested and what ran (see [Exact and fast modes](https://github.com/Photivra/photivra/blob/main/docs/API_STYLE.md#exact-and-fast-modes)). |
| `motion.angularVelocityRadPerSec` | still | `{ pitch?, yaw?, roll? }` in rad/s (see [Motion](#motion)). |
| `motion.shutter` | `"global"` | Or `"rolling"`. |
| `motion.rollingShutterSkewSeconds` | the body's readout skew | Rolling only. |
| `signal`, `onProgress` | none | An `AbortSignal` cancels the running task; `onProgress` reports `raw`, `white-balance`, `development` and `jpeg` tiles. The last event of each stage has `completedTileCount === totalTileCount`. The capture yields to the host about every 8 ms with a `MessageChannel` message (else `setImmediate`, else `setTimeout`), so other queued tasks run in between: an abort sent from another task, such as a Web Worker `message` event, takes effect at the next yield. |

Unknown fields are rejected, so a typo never silently falls back to a default.

Every option added in 2.0 (PNG, demosaic, optics and motion) and in 2.1 (`lens.diffraction`,
`output.demosaic: "ahd"`, `sensor.antiAliasing`) is opt-in. With none of them given, the
request, RAW, samples and JPEG are byte-identical to the 1.0 facade at the same illuminance, and a
test checks that. (The default illuminance changed before release; see [Exposure](#exposure).)

## Geometry

The scene is a plane perpendicular to the optical axis at `subjectDistanceM`. The facade sizes the
chart so that it exactly fills the active frame. Chart coordinates use frame units: `u` runs from −1
at the left edge to +1 at the right edge, and `v` points up on the same scale (±height/width).

### Fixed-size chart (2.3)

With `chartSize: { widthM, heightM?, surroundReflectance? }` the chart keeps its physical size instead
of filling the frame. It is centred on the optical axis on the plane at `subjectDistanceM`; the rest of
the plane is a neutral Lambertian surround (default 18 %) under the same light, and the meter sees it.
`heightM` defaults to `widthM` × the frame aspect. A chart preset is resolved in the chart's own frame
(u = ±1 at the chart's edges, aspect heightM/widthM), so composite layouts and LW/PH frequencies refer
to the chart, not the camera frame. A reflectance or radiance function is called only for points on the
chart, with chart-local `chartU` and `chartV` (same convention) next to the frame `u`, `v` and plane
`xM`, `yM`.

The frame covers `scene.framedWidthM` of the plane, from the facade's thin-lens framing: magnification
m = v/d with the image distance v = f·s/(s − f) at the focus distance s, and the frame spans sensor width/m.
`result.scene.chart` (and the assumption `scene.chartSize`) reports `frameWidthFraction` and
`frameHeightFraction` (the chart's share of the frame; above 1 when it is larger than the frame and
cropped), the `magnification` and the chart's image size in millimetres and output pixels. To fill the
frame width with a W-metre chart, put it at d = f·(1 + W/sensor width): with the facade's 50 mm prime,
0.384 mm of sensor (64 pixels of 6 µm) and an A3 chart (0.42 m), d = 0.05·(1 + 420/0.384) ≈ 54.7 m.

```ts
import { simulateCapture } from "@photivra/engine";

const a3 = await simulateCapture({ scene: { preset: "siemens-star" }, chartSize: { widthM: 0.42 }, subjectDistanceM: 80, output: { width: 64, height: 48 } });
console.log(a3.scene.chart?.frameWidthFraction, a3.scene.chart?.magnification, a3.scene.framedWidthM);
```

The simulated sensor has real pixels of `sensor.pixelPitchMicrometers`. A 64 × 64 capture with 6 µm
pixels is therefore a 0.38 mm crop of a large sensor, not a downscaled full frame. This keeps the
signal per pixel, and so the noise and the ISO behaviour, physically consistent with the tier's
sensor values. To see a whole frame at a small output size instead, raise the pitch (see
[Whole-frame views](#whole-frame-views-25)).

### Generic prime lenses (2.3)

`lens.prime` picks a lens of the engine's generic prime family by its full-frame-equivalent focal
length: 10, 12, 14, 16, 20, 24, 28, 35, 40, 50, 85, 105, 135, 200, 300, 400, 500, 600, 800 or 1200 mm
(`GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM`). They are educational lenses defined by three rules, not
real products, and carry no brand:

- **Focal length** = equivalent ÷ the diagonal crop factor of the sensor (`calculateEquivalentFocalLength35Mm`,
  36 × 24 mm reference). In `simulateCapture` the sensor is the simulated frame, output width × height ×
  pixel pitch: to simulate a whole full-frame sensor at 768 × 512, set the pitch to 36 mm / 768 = 46.875 µm (or 750 µm at
  48 × 32, see [Whole-frame views](#whole-frame-views-25)).
- **Aperture range:** widest f/2.8 (10–16 mm), f/1.8 (20–28 mm), f/1.4 (35–85 mm), f/2 (105–135 mm),
  f/2.8 (200–300 mm), f/4 (400–600 mm), f/5.6 (800 mm), f/8 (1200 mm); narrowest f/16 up to 16 mm, f/22 up
  to 135 mm, f/32 beyond. Any f-number inside the range is accepted; `fNumbers` lists the marked
  third-stop values within it (`GENERIC_PRIME_THIRD_STOP_F_NUMBERS`: 1, 1.1, 1.2, 1.4, …, 22, 25, 29, 32,
  the conventional rounded values of 2^(k/6)). An f-number outside the range is rejected.
- **Third-stop dials (2.14):** `GENERIC_THIRD_STOP_ISO_SETTINGS` lists the bodies' ISO settings (the rounded values of
  100·2^(k/3)), and `GENERIC_THIRD_STOP_SHUTTER_SECONDS` the standard third-stop shutter times from 1/8000 s to 30 s
  (the rounded values of 2^(k/3) s: 1/8000, 1/6400, 1/5000, … 1/13, 1/10, 1/8, 1/6, 1/5, 1/4, 0.3, 0.4 … 25, 30). The
  bodies' shutters are continuous over 1/8000–30 s and take each value as the exact time.
- **Minimum focus** = max(0.10 m, f·(1 + 1/0.15)): the thin-lens object distance at 0.15× magnification,
  never closer than 10 cm (`GENERIC_PRIME_MINIMUM_FOCUS`). A subject or focus distance below it is
  rejected. This is a generic thin-lens approximation, measured from the lens, not a real lens's
  specification.

The prime replaces the tier lens's focal length and f-number range; the tier lens's transmission is
kept, and the assumption `lens.prime` records the resolved lens. `resolveGenericPrimeLens` gives the
same lens for any sensor size. `lens.focalLengthMm` keeps working as before and cannot be combined with
`lens.prime`.

### Fitting a chart to the frame (2.3)

`calculateSubjectDistanceForFraming({ sensor, focalLengthMm | equivalentFocalLengthMm, chart, fit? })`
returns the distance at which a chart of physical size `chart` (`{ widthM, heightM? }`, as for
`chartSize`; `heightM` defaults to the sensor's shape) fills the frame. Thin lens: magnification
m = f/(d − f), so d = f·(1 + 1/m) with m = sensor side ÷ chart side. `fit` chooses the side:
`contain` (default: the whole chart is visible and its limiting side fills the frame; for a 3:2 chart on
a 3:2 sensor this is the width fit), `width`, `height` or `cover` (the chart fills the frame and is
cropped on its other side). The result reports the magnification, image distance, framed plane size,
`coverage` (the fraction of the frame width and height the chart covers), the generic prime of that
equivalent focal length if there is one, the prime family's minimum focus distance at that focal length
and `belowMinimumFocus`, plus assumptions in the same form as `simulateCapture`. It is the same framing
`simulateCapture` uses, so `chartSize` at the returned distance gives `frameWidthFraction` 1 (tested). For the coverage at any other distance, see
[Chart coverage at any distance](#chart-coverage-at-any-distance-25).

An A3 chart (0.42 × 0.28 m) on a full-frame sensor: 0.127 m at 10 mm, 0.633 m at 50 mm, 2.53 m at
200 mm and 15.2 m at 1200 mm (magnification 0.0857, minimum focus 0.10, 0.38, 1.53 and 9.2 m). On a
small 4.8 × 3.6 mm phone sensor (crop 7.2) the equivalent primes are 1.39–166 mm and the contain fit is
limited by the width: 0.123, 0.614, 2.45 and 14.7 m, covering 89 % of the frame height. An A4 chart
(0.297 m) would need 0.093 m at 10 mm, below the 0.10 m minimum focus (`belowMinimumFocus: true`).

```ts
import { calculateSubjectDistanceForFraming, simulateCapture } from "@photivra/engine";

const fit = calculateSubjectDistanceForFraming({ sensor: { widthMm: 36, heightMm: 24 }, equivalentFocalLengthMm: 50, chart: { widthM: 0.42, heightM: 0.28 } });
console.log(fit.subjectDistanceM, fit.magnification, fit.belowMinimumFocus, fit.prime?.fNumbers);
const capture = await simulateCapture({ scene: { preset: "siemens-star" }, lens: { prime: 50, fNumber: 5.6 }, chartSize: { widthM: 0.42, heightM: 0.28 },
  subjectDistanceM: fit.subjectDistanceM, sensor: { pixelPitchMicrometers: 36000 / 768 }, output: { width: 768, height: 512, region: { x: 368, y: 240, width: 32, height: 32 } } });
console.log(capture.scene.chart?.frameWidthFraction);
```

### Chart coverage at any distance (2.5)

`calculateChartFraming({ sensor, focalLengthMm | equivalentFocalLengthMm, chart, subjectDistanceM, focusDistanceM? })`
answers the inverse question: how much of the frame does a chart of physical size `chart` (`{ widthM, heightM? }`, as
for `chartSize`) cover at a given distance? It uses the facade's own thin-lens framing: image distance
v = f·s/(s − f) at the focus distance s (default: the subject distance), magnification m = v/d on the chart plane at
d, and a frame that spans sensor side ÷ m. The result reports the magnification, image distance, framed plane size,
`coverage` (`frameWidthFraction` and `frameHeightFraction`; above 1 when the chart is larger than the frame and
cropped), the chart's image size in millimetres, the generic prime of that equivalent focal length if there is one,
the prime family's minimum focus distance and `belowMinimumFocus` (the subject or focus distance is closer than it,
which `simulateCapture` with `lens.prime` refuses), plus assumptions.

An A3 chart (0.42 × 0.28 m) with the 50 mm full-frame prime covers 130 % of the frame width at 0.5 m (cropped),
61.4 % at 1 m, 29.9 % at 2 m and 11.8 % at 5 m (magnification 0.111, 0.0526, 0.0256 and 0.0101).

```ts
import { calculateChartFraming } from "@photivra/engine";

const coverage = calculateChartFraming({ sensor: { widthMm: 36, heightMm: 24 }, equivalentFocalLengthMm: 50, chart: { widthM: 0.42, heightM: 0.28 }, subjectDistanceM: 2 });
console.log(coverage.coverage.frameWidthFraction, coverage.magnification, coverage.belowMinimumFocus);
```

**Close-up light (2.6).** Focused close, the lens delivers less light: the working f-number is N·(1 + m) with m = v/s at
the focus distance (ideal symmetric thin lens, unity pupil magnification), so the image-plane irradiance falls by
1/(1 + m)² compared with the same f-number at infinity focus. `calculateChartFraming` and
`calculateSubjectDistanceForFraming` report it as `closeUpTransmission` (1/(1 + m)²) and `closeUpLossStops` (2·log₂(1 + m),
how many stops darker). Both come from the same function as the factor `simulateCapture` applies in the scene-to-sensor
irradiance, so they cannot drift apart; a test checks the RAW signal ratio of a uniform chart at 0.35 m and 50 m against
them within 0.5 %. With the 50 mm prime: 0.81 (0.30 stop darker) at 0.5 m, 0.90 (0.15 stop) at 1 m, 0.95 (0.07 stop) at
2 m and 0.98 (0.03 stop) at 5 m. Show it to users as "about N stops darker at this distance"; it is the thin-lens
model, not a measured lens (real lenses with non-unity pupil magnification differ).

Tests check that at `calculateSubjectDistanceForFraming`'s distance the coverage is 1 on the fitted side (every fit,
three sensor shapes, four primes), and that at any distance it equals `result.scene.chart` from `simulateCapture` with
`chartSize` (magnification, both coverage fractions, the chart's image size and the framed size, within 1e-12
relative), including a separate `lens.focusDistanceM`.

### Whole-frame views (2.5)

To render the whole sensor frame at a small output size, set the pitch to sensor width ÷ output width:
36 mm at 48 pixels is 750 µm, 44 mm at 48 pixels 917 µm. From 2.5 the pitch may be up to 1000 µm. The
frame is then the real sensor's size, so `lens.prime` (its crop factor and minimum focus),
`calculateSubjectDistanceForFraming` and `chartSize` all match that sensor, and the image is a shrunk view of
the whole frame. No new option is needed: the facade has always simulated a sensor `width × pitch` wide.

```ts
import { simulateCapture } from "@photivra/engine";

const view = await simulateCapture({ scene: { preset: "dead-leaves" }, lens: { prime: 35, fNumber: 2.8 }, subjectDistanceM: 3,
  sensor: { pixelPitchMicrometers: 36000 / 48, pixelAperture: "box" }, output: { width: 48, height: 32 } });
console.log(view.assumptions.find((a) => a.id === "sensor.wholeFrameView")?.value); // { pixelPitchMicrometers: 750, frameWidthMm: 36, frameHeightMm: 24 }
```

Above 100 µm (larger than any camera photosite) the assumption `sensor.wholeFrameView` records the frame size.
What changes and what does not:

- **Brightness is the same as at any pitch.** The ISO area normalization (below) multiplies the conversion gain
  and saturation by the area ratio, up to 27 778 at 1000 µm, so the RAW codes and the image are those of a small
  pitch. Tested at 150–1000 µm against 6 µm: every CFA channel's mean RAW code within half a code (plus the 6 µm
  reference's own noise), the 8-bit sRGB mean within one code, and a 64× overexposure clipping at the same white
  code. Charge counts reach 1.7 × 10⁹ e⁻; the Poisson sampler's normal branch above 10⁹ keeps variance/mean at 1.
- **Noise is that of a binned, downsized view, not the real sensor's per-pixel noise.** Each output pixel
  collects the charge of its whole square, so its shot noise equals that of all the real photosites in the
  square summed (Poisson counts add) or averaged, and its SNR √N_e grows in proportion to the pitch. On an 18 %
  card at f/8, 1/125 s, ISO 100 a 917 µm pixel collects about 1.6 × 10⁸ e⁻ (SNR about 12 700): under a fifth of a
  RAW code, so the image looks noise-free, as a downsized photograph does. Read noise and dark current are applied
  once per output pixel, not once per real photosite, so in deep shadows the noise is lower than a real sensor's
  binned sum (√n times the read noise for n photosites). Tested by photon transfer at 150, 458 and 917 µm, ISO
  12 800: the code variance matches N_e/K² + σ_read²/K² + 1/12 within 12 % (EMVA 1288 Release 4.0, §2, free).
- **Sampling.** The default point aperture samples one point of each square, so detail finer than the pitch
  aliases at full contrast. Use `sensor.pixelAperture: "box"` (or `{ kind: "box", samplesPerAxis }` up to 16) to
  average over the square, or the four-spot filter, whose separation scales with the pitch.
- **Diffraction.** The Airy pattern (a few µm) is far smaller than a pixel. The default kernel is 3 × 3 sites and
  the centre site keeps 1 − 8√2/(π³β) of the energy, β = pitch/(λ·N_w): 99.96 % at 780 nm, f/1.4 and 917 µm.
  Cells larger than 192 cut-off periods are integrated in real space (see [PSF foundation](https://github.com/Photivra/photivra/blob/main/docs/PSF_FOUNDATION.md#diffraction-limited-sampled-profile-21)),
  so a 48 × 32 view of a 44 mm frame with `lens.diffraction` at f/1.4 took 1.0 s (the frequency-domain cells took
  296 s there; both measured on the same machine in Node).
- **Motion, rolling shutter, anti-aliasing filter, AHD and the box aperture** follow the same angles at any pitch:
  a yaw of ω moves the image ω·f/pitch pixels per second. A test renders each of them at 917 µm and at 9.17 µm with
  the same 50 mm-equivalent prime (so f scales with the frame) and finds the same image within the small pitch's
  own noise (mean difference under 1 code; AHD under 2.5).
- **Region tiles** stay byte-identical to the whole render (tested with diffraction, the four-spot filter, the box
  aperture, AHD, rotation and a rolling shutter at 640 and 917 µm).
- **WebGPU.** `simulateCapture` runs on the CPU. The optional `webgpu-f32` sensor stage of
  `createImageKernelAccelerator` handles capacities up to 2^24 e⁻, which the tier's 60 000 e⁻ reach at 100 µm; above
  that it fails closed with `unsupported-float32-domain` (see [WebGPU backend](https://github.com/Photivra/photivra/blob/main/docs/WEBGPU.md)). The `cpu-reference`
  backend runs it. The convolution, temporal-sum and chart stages work in sites and frame units, so the pitch does
  not enter them.

Requests at 0.5–100 µm are byte-identical to 2.4.1.

A whole-frame view simulates a camera with giant pixels. For a preview that looks like the real camera's photo
shrunk to the frame size (the real pixel pitch for the optics, the real mosaic and the noise of the averaged real
pixels), use [Display view](#display-view) instead.

### ISO and pixel size

The tier's ISO signal chain (conversion gain, saturation signal and read noise per ISO setting) is
declared for the default 6 µm pixel. At other pitches the facade keeps the ISO calibration
independent of pixel size, so the same exposure gives the same image brightness at any pitch:

- Standard output sensitivity S = 10/H (CIPA DC-004-2020 §3.2) is defined by the camera's output
  for a focal-plane exposure H; it does not depend on pixel size.
- The charge a pixel collects is proportional to its area: the photon count is μp = A·E·t/(hν)
  (EMVA Standard 1288 Release 4.0 Linear, §2.1, Eq. 3, free).
- So the facade multiplies the system conversion gain (e⁻ per code) and the pre-ADC saturation
  signal of every ISO regime by the area ratio pitch²/36 µm². Codes, black level, ADC and digital gain
  are unchanged. At 6 µm the ratio is exactly 1 and nothing is changed (byte-identical to 2.1.0).
- Read noise (in e⁻) and the synthetic dark current (1 e⁻/s) stay per pixel.

What you see: brightness stays the same, and per-pixel noise rises as pixels shrink, because a
smaller pixel collects fewer electrons for the same exposure (shot-noise SNR = √N_e). At f/8, 1/125 s,
ISO 100 on an 18 % grey card, the 8-bit sRGB mean is 101.2 at 30, 6 and 3 µm, and the green standard
deviation is 0.18, 0.93 and 1.83 codes. At whole-frame pitches (above 100 µm) the per-pixel noise falls below one
code; see [Whole-frame views](#whole-frame-views-25). Below about 1 µm the 8-bit sRGB mean falls slightly (about 1 code at 0.55 µm)
although the linear RAW mean is unchanged (within 0.3 %): strong noise passed through the concave
sRGB curve lowers the mean of the encoded values.

The charge capacity follows the scaled base-ISO saturation signal (see `sensor.capacityElectrons`),
so it is proportional to pixel area: 60 000 e⁻ at 6 µm, 15 000 e⁻ at 3 µm, 1 500 000 e⁻ at 30 µm.
This is a consequence of holding the tier's ISO rating and its half stop of highlight headroom fixed,
**not a measured full-well model**. Published sensor data show full-well capacity growing with pixel
size but less than in proportion to area across process generations (for example about 16 000 e⁻ at
2 µm and 37 500 e⁻ at 5.2 µm in Farrell, Xiao & Kavusi, *Proc. SPIE* 6069, 2006, Table 1; Chen et al.,
*Proc. SPIE* 3965, 2000, model the photodiode capacitance as roughly linear in pixel side). A real
large-pixel sensor may therefore saturate earlier, and a real small-pixel sensor would usually be
given a higher base ISO. When the pitch is not 6 µm, the assumption `sensor.isoAreaNormalization`
records the area ratio and this approximation.

## Exposure

The facade meters the scene like a reflected-light meter:

- It averages the scene luminance on a 16 × 16 grid with the body's metering profile.
- It uses two relations from CIPA DC-004-2020 (free):
  - standard output sensitivity S = 10/H (§3.2): the correct focal-plane exposure for ISO S is
    H = 10/S lx·s;
  - the camera equation H = 0.65·L·t/N² (§5.5 (4)), where 0.65 = τ·π/4 with lens transmittance
    τ = 0.828 (Explanation 4).

  N is the f-number, t the shutter time in seconds, L the scene luminance in cd/m² and S the ISO
  setting. Together they give N²/t = 0.65·L·S/10.
- The anchor is f/8, 1/125 s, ISO 100. It is correct for L = 10·N²/(0.65·t·S) =
  10·64·125/(0.65·100) = 80 000/65 ≈ 1230.77 cd/m².
- The meter target then goes through the engine's existing exposure-mode resolver.
- In `program` mode, a generic program line written by the engine chooses the aperture and shutter.
- `exposure.standardExposureDeviationStops` (#515) says how far the exposure used is from the standard exposure for
  the metered luminance L, in stops, from the same two relations:
  Δ = log₂(N²/t) − log₂(0.65·L·S/10) = `ev100` − log₂(0.65·L·S/10). Positive is darker than the standard exposure
  (under), negative brighter (over). With the defaults it is 0; the marked f/11 gives log₂(11²/8²) ≈ +0.92, the marked
  1/60 s gives log₂(60/125) ≈ −1.06 and ISO 200 gives −1. In an automatic mode it is that of the exposure the engine
  used: minus the compensation (−⅔ for +⅔ stop), plus any step or limit the resolver hit (the slowest shutter, the ISO
  range). It is `null` only when the metered luminance is 0, which has no standard exposure. The display view reports
  the same value.
- `exposure.standardExposureIlluminanceLux` is the illuminance at which the settings used give that standard exposure:
  E·L_ref/L = E·2^Δ, with E the request's `illuminanceLux` and L_ref = 10·N²/(0.65·t·S). A chart, reflectance function
  or material scene has radiance reflectance × E-scaled illuminant / π, so its metered luminance is proportional to E,
  and the same request at this illuminance meters at Δ = 0 (to rounding: the metering quadrature is the same at both
  illuminances). With the defaults it is the default illuminance; the marked f/11 gives 2^0.919 times it, about
  40 612 lux. It is `null` for a black scene and for a `radiance-function` scene, whose radiance does not depend on the
  illuminance. It can exceed the 1e7 lux `illuminanceLux` accepts. The display view reports the same value.
- `exposure.greyCardDeviationStops` (2.14) is the same deviation for incident metering: the light falling on the scene,
  as an 18 % grey card or a hand-held incident meter reads it, instead of the scene's own luminance. It uses the grey
  card's luminance L = 0.18·E/π (a Lambertian reflector; E the request's `illuminanceLux`) in place of the metered L:
  Δ_grey = log₂(L_ref/(0.18·E/π)), L_ref = 10·N²/(0.65·t·S). Same sign: positive is darker (under). It depends only on
  the settings used and the illuminance, never on the scene's reflectances, so a chart's white paper cannot fool it.
  With the default settings and illuminance it is exactly 0 (the default illuminance is defined from this grey card,
  below); each stop of shutter, aperture or ISO, and each halving of the illuminance, moves it by one stop. It is `null`
  for a `radiance-function` scene, whose radiance ignores the illuminance. The display view reports the same value.
  - **By default the automatic modes meter the scene** (`exposure.metering: "scene-average"`: the body's
    16 × 16-zone meter, `meteredSceneLuminanceCdPerSquareMeter`), exactly as before 2.14, and `greyCardDeviationStops`
    reports where their exposure sits against the grey card. On a scene brighter than 18 % grey they expose darker
    than the grey card: a uniform 90 % white gives log₂(0.9/0.18) ≈ +2.32, and the app's round 4 All-in-one chart on
    90 % white paper about +1.78 (its metered luminance is 3.4 times the grey card's).
  - **`exposure.metering: "grey-card"` (2.14) meters by the grey card**: every meter zone reads L = 0.18·E/π, so
    aperture priority, shutter priority and program, with a fixed ISO or Auto ISO, choose settings with
    `greyCardDeviationStops` = 0 whatever the scene's reflectances, as a manual exposure at the default settings and
    illuminance has. What is left is the mode's own steps and limits: the resolvers set a continuous shutter or
    aperture, so only rounding remains unless the lens or shutter range stops them (shutter priority at 1/125 s and
    5000 lx would need f/3.9 and stops at f/4, 0.10 stop under); Auto ISO chooses whole-stop ISOs, so up to half a
    stop remains, and that remainder is the Auto ISO report's `residualStops`, with `limitingConstraint` naming
    `iso-grid-quantization` or the ISO limit. Compensation still applies (+⅔ gives −⅔). Manual exposure ignores the
    meter, so the option changes nothing there except Auto ISO. `meteredSceneLuminanceCdPerSquareMeter`,
    `standardExposureDeviationStops` and `standardExposureIlluminanceLux` still describe the scene's own luminance.
    A `radiance-function` scene is refused, since its radiance ignores the illuminance. The capture reports
    `exposure.metering`, and the assumption `exposure.meteringSource` gives the card's luminance. When the option is
    omitted, nothing is added to the assumptions, so 2.13 requests give the same assumptions and bytes.

DC-004 ties the reference level to an 18 % grey (Explanation 1 and 2.2). The default illuminance
puts an 18 % Lambertian grey card, whose luminance is L = 0.18·E/π, exactly at that luminance:

```text
E = π·L/0.18 = π·10·N²/(0.65·t·S·0.18)
  = π·10·64·125/(0.65·100·0.18) = π·80 000/11.7 ≈ 21 480.98 lux
```

Before 2.0.0 was released, the default was π·K·N²/(t·S·0.18) ≈ 17 453.29 lux, with the
reflected-light meter constant K = 12.5 cd·s/m² of a paid standard. The DC-004 relations are
equivalent to K = 10/0.65 ≈ 15.38 cd·s/m², so the new default has 10/(0.65·12.5) ≈ 1.231 times
(about 0.30 EV) more light.

The light does not follow your settings. Changing the shutter in manual mode changes the image
brightness, as on a real camera.

With these defaults, the green RAW level of an 18 % grey card is about 13.1 % of RAW white. A 100 %
reflector would then sit at about 73 % of white, roughly half a stop below clipping. DC-004 defines
only the mid-grey reference level, not highlight headroom: this half stop is a property of the
engine's generic tier presets, documented here, and the tier values were not tuned to get it.

### Auto ISO (#516)

`exposure.iso: "auto"` hands the ISO to the exposure-mode resolver's Auto ISO branch for the mode. The ISO starts
at the lowest selectable ISO of the body's Auto ISO range (the tiers: ISO 100 to their maximum, 6400, 12 800 or
25 600), snaps to the nearest selectable ISO in stops (the lower on a tie) and is held at the ends of the range.
Exposure compensation applies to the meter target first, as with a numeric ISO.

| Mode | With `iso: "auto"` |
| --- | --- |
| `manual` | Your aperture and shutter; the ISO makes up the exposure (`resolveManualExposureMode`, automatic ISO). |
| `aperture-priority` | Your aperture. The shutter follows the meter at the lowest ISO, but no slower than `exposure.autoIso.slowestPreferredShutterSeconds` (required; seconds within the body's shutter range, or `"auto"`, see below); the ISO makes up the rest. At the Auto ISO maximum, `afterMaximumIso` decides: `"allow-slower-shutter"` (the default) lengthens the shutter to reach the target, `"hold-preferred-shutter"` keeps it and leaves the exposure under target (`resolveAperturePriorityAutoIsoExposureMode`). |
| `shutter-priority` | Your shutter. The aperture is chosen at the lowest ISO, no wider than the target needs, so it stops at the widest aperture; the ISO makes up the rest (`resolveShutterPriorityExposureMode`, policy `minimum-iso-aperture-first`). |
| `program` | The generic program line at the lowest ISO; beyond the line's end (f/4, 1.024 s) the ISO rises (`resolveProgramAutoExposureMode`, automatic ISO). With `exposure.autoIso.slowestPreferredShutterSeconds` (optional, a number or `"auto"`, #504) the line's shutter is held at it before the ISO rises, and `afterMaximumIso` applies as in aperture priority, never past the line's own shutter. |

The result says what happened. `exposure.settings.iso` is the ISO used and `exposure.isoControl` is `"automatic"`.
`exposure.autoIso` reports `idealIsoBeforeConstraints`, the Auto ISO range (`autoIsoMinimum`, `autoIsoMaximum`),
`clamped`, `limitingConstraint` and `residualStops`. The last two are the resolver's: for example `"iso-maximum"` when
the exposure stays under target at the maximum ISO, `"iso-grid-quantization"` for the nearest selectable ISO, or
`"none"`. A positive residual is under target. In aperture priority the report also repeats `afterMaximumIso` and
`slowestPreferredShutterSeconds`, and says whether the slower-shutter fallback ran (`afterMaximumIsoFallbackUsed`).
A display view, an ideal reference and every `output.region` part of the same request meter the whole frame, so
they resolve the same exposure and report the same values. Requests without `"auto"` are unchanged: their
`isoControl` is `"manual"` and they have no `autoIso`.

**Your own limits (#505).** `exposure.autoIso.limits: { maximum, minimum? }` caps Auto ISO, and optionally raises its
floor, in any mode, as cameras' "maximum sensitivity" settings do. It is your choice, kept apart from the body's Auto
ISO range: both limits must be selectable ISOs of the body inside that range (`minimum` at most `maximum`, default the
body's minimum), or the request fails with `InvalidConfigurationError`; nothing is clipped. When the ISO stops at your
limit, `limitingConstraint` is `"user-iso-maximum"` (or `"user-iso-minimum"`), distinct from the body's `"iso-maximum"`,
and `exposure.autoIso.limits` repeats the range used. In aperture priority, `afterMaximumIso` applies at your maximum
just as at the body's. Without `limits` nothing changes. A separate cap for flash is not part of this.

```ts
import { simulateCapture } from "@photivra/engine";

const dusk = await simulateCapture({
  exposure: { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 60, afterMaximumIso: "hold-preferred-shutter" } },
  lens: { fNumber: 8 },
  scene: { preset: "uniform" },
  illuminanceLux: 200,
  output: { width: 8, height: 8 }
});
console.log(dusk.exposure.settings, dusk.exposure.isoControl, dusk.exposure.autoIso?.limitingConstraint);
```

```ts
import { simulateCapture } from "@photivra/engine";

const night = await simulateCapture({
  exposure: { mode: "program", iso: "auto", autoIso: { limits: { maximum: 6400 } } },
  scene: { preset: "uniform" },
  illuminanceLux: 0.5,
  output: { width: 8, height: 8 }
});
// ISO 6400, "user-iso-maximum", { minimum: 100, maximum: 6400 }
console.log(night.exposure.settings.iso, night.exposure.autoIso?.limitingConstraint, night.exposure.autoIso?.limits);
```

**An automatic slowest shutter (#504).** `slowestPreferredShutterSeconds: "auto"` lets the engine choose it from the lens,
the pixel pitch and the hand's shake, through its camera-shake model (`estimateAutoIsoSlowestShutter`, see
[USAGE](USAGE.md#automatic-slowest-shutter-504)). It does not use the 1/focal-length rule of thumb: the shutter is the time
at which the shake blur equals the budget. `exposure.autoIso.automaticSlowestShutter` sets `fasterByStops` (−2 to +2, as
cameras' faster/slower bias; default 0), `blurBudgetPixels` (default 1), `angularVelocityRadPerSec` and
`stabilizationStopsEquivalent` (default 0). The default hand, 4.39 °/s, is a cited generic value for a phone held in two
hands, not a measurement of you, so pass your own when you know it. `exposure.autoIso.automaticSlowestShutter` in the result
reports the derived, biased and used times.

```ts
import { simulateCapture } from "@photivra/engine";

const handheld = await simulateCapture({
  exposure: { mode: "aperture-priority", iso: "auto",
    autoIso: { slowestPreferredShutterSeconds: "auto", automaticSlowestShutter: { fasterByStops: -1, stabilizationStopsEquivalent: 3 } } },
  lens: { fNumber: 4 },
  scene: { preset: "uniform" },
  illuminanceLux: 20,
  output: { width: 8, height: 8 }
});
console.log(handheld.exposure.autoIso?.automaticSlowestShutter, handheld.exposure.settings);
```

## Scene presets

All charts are analytic patterns written by the engine; no third-party chart data is bundled. Each
is a flat Lambertian reflector (it looks equally bright from every direction). Neutral reflectances
are spectrally flat. Where a preset takes a reflectance spectrum (`uniform`, `patches`), it accepts a
neutral number, a caller spectrum (`{ kind: "tabulated" }` or `{ kind: "function" }`, 380–780 nm at
least) or, from 2.14, a built-in color patch `{ kind: "color-patch", patchId }` (see
[Color patches](https://github.com/Photivra/photivra/blob/main/docs/COLOR_PATCHES.md)).

| Preset | Parameters (defaults) | Definition |
| --- | --- | --- |
| `uniform` | `reflectance` (0.18) | One reflectance, caller spectrum or built-in colour patch everywhere. |
| `slanted-edge` | `angleDegrees` (5), `darkReflectance` (0.15), `lightReflectance` (0.6) | An edge through the centre, tilted clockwise from vertical: light where u·cos θ − v·sin θ ≥ 0. The geometry follows the slanted-edge method described by Burns (2000), also used by ISO 12233 (a few degrees of slant, 4:1 contrast by default). |
| `siemens-star` | `cycles` (36), `radiusFraction` (0.9), `darkReflectance` (0.05), `lightReflectance` (0.8), `backgroundReflectance` (0.18) | Alternating sectors of angular width π/cycles inside radius `radiusFraction` × frame half-height. |
| `step-wedge` | `steps` (11), `minimumReflectance` (0.03), `maximumReflectance` (0.9), `spacing` (`equal-density`) | Equal-width vertical steps from left to right. Equal density spaces D = −log₁₀ R evenly; `linear` spaces R evenly. |
| `grey-ramp` | `minimumReflectance` (0.03), `maximumReflectance` (0.9) | Reflectance linear in u, represented by 1024 equal levels. |
| `checkerboard` | `squaresAcross` (8), `darkReflectance` (0.05), `lightReflectance` (0.8) | Square cells, light at the top-left. |
| `point-grid` | `columns` (5), `rows` (3), `radius` (0.01), `pointReflectance` (0.9), `backgroundReflectance` (0.02) | Small disks centred in equal cells, for PSF and defocus inspection. |
| `patches` | `patches` (required), `columns`, `gapFraction` (0.1), `backgroundReflectance` (0.18) | Caller reflectance per patch, row-major. Use it for a chart with reflectance data you are entitled to use; the engine does not ship third-party chart data because its licence is unclear. |
| `color-patches` | `patchIds` (all 30), `columns` (min(6, count)), `gapFraction` (0.1), `backgroundReflectance` (0.18) | 2.14: Photivra's own 30 color patches (neutral ramp, strong and soft primaries and secondaries, skin tones, memory colors, two near the sRGB gamut edge) drawn like `patches`. Each is an analytic reflectance spectrum; see [Color patches](https://github.com/Photivra/photivra/blob/main/docs/COLOR_PATCHES.md) for the formula, the parameters and the code, name, CIELAB (D65) and sRGB of every patch. |

### Chart elements and composite charts (2.3)

2.3 adds generic, unbranded test-pattern elements and a `composite` preset that lays them out, so an
application can build its own chart from engine parts. Frequencies in LW/PH (line widths per picture
height, as in ISO 12233) refer to the height of the chart: the preset's own frame, or the composite's
frame for its elements. One line width is PH/LW. Continuous patterns are stored as
`CHART_CONTINUOUS_LEVELS` (1024) equal neutral levels, like the grey ramp; the step is below 0.1 % of
the range, far below sensor noise.

| Preset | Parameters (defaults) | Definition and source |
| --- | --- | --- |
| `siemens-star` `profile` | `"bar"` (default) or `"sine"` | `sine`: R(θ) = mid + amp·sin(2π·cycles·(θ/2π + ½)) between the dark and light reflectances, with zero crossings at the bar star's sector edges. `profile` appears in the parameters only when given, so 2.2 scene digests are unchanged. |
| `dead-leaves` | `radiusMinimum` (0.01), `radiusMaximum` (0.5), `minimumReflectance` (0.2), `maximumReflectance` (0.6), `seed` (1) | Matheron's dead-leaves model in the scale-invariant form used for texture measurement by Cao, Guichard and Hornung (2010): opaque disks with uniform (Poisson) centres, radius density ∝ r⁻³ on [rMin, rMax] (frame units, rMin ≥ 0.002), grey uniform in the reflectance range. Disks are drawn front to back until the chart and 0.1 frame units around it are completely covered (backward "perfect simulation", Kendall and Thönnes 1999), so the texture is an exact sample of the stationary model there; farther out it is the mean grey. Seeded with the engine's xorshift32 stream and only correctly rounded arithmetic: the same seed gives the same disks on every platform. `diskCount` is reported. |
| `bar-groups` | `lineWidthsPerPictureHeight` ([100, 200, 400, 800]), `numerals` (true), `darkReflectance` (0.05), `lightReflectance` (0.8) | One group of three dark bars and two gaps (five line widths) per frequency, left to right: vertical bars in the upper row (horizontal resolution), horizontal bars below (vertical resolution) and, with `numerals`, the LW/PH value in engine-drawn seven-segment digits. The three-bar group is the concept of the USAF-1951 target (a US-government publication); the arrangement is the engine's own. A group that does not fit its cell is rejected. |
| `hyperbolic-wedge` | `orientation` (`horizontal`), `lineCount` (5), `minimumLineWidthsPerPictureHeight` (100), `maximumLineWidthsPerPictureHeight` (1000), dark/light (0.05/0.8) | `lineCount` dark lines and the gaps between them, all one line width wide, whose width shrinks along the axis so the frequency rises linearly from the minimum to the maximum LW/PH; the line edges are hyperbolas. `horizontal`: axis left to right, nearly horizontal lines (vertical resolution). |
| `zone-plate` | `radiusFraction` (0.9), `maximumCyclesPerPictureHeight` (200), `darkReflectance` (0.1), `lightReflectance` (0.7), `backgroundReflectance` (0.18) | R(r) = mid + amp·cos(π·k·r²): the quadratic-phase chirp of a Fresnel zone plate, whose local frequency k·r rises linearly from 0 at the centre to the maximum at the rim. |
| `slanted-squares` | `columns` (3), `rows` (2), `sizeFraction` (0.5), `angleDegrees` (5), `darkReflectance` (0.15), `lightReflectance` (0.6) | A dark square rotated clockwise by the angle, centred in each cell: two near-vertical and two near-horizontal slanted edges each, 4:1 contrast by default (Burns 2000). |
| `line-grid` | `spacing` (1/3), `lineWidth` (0.01), `lineReflectance` (0.42), `backgroundReflectance` (0.6) | Lines at every multiple of `spacing` from the centre in u and v: a distortion and registration grid. |
| `fiducial` | `radiusFraction` (0.8), `ringFraction` (0.18), `inverted` (false), `darkReflectance` (0.05), `lightReflectance` (0.8), `backgroundReflectance` (0.18) | A 2 × 2 checker disk in a dark ring, for registration; `inverted` swaps the checker phase (an orientation cue). |
| `composite` | `background` (`{ preset: "uniform", reflectance: 0.18 }`), `elements` (required, 1–256) | Each element is `{ scene, centerU, centerV, width, height, mask? }`: any preset except `composite`, drawn inside its placement rectangle (frame units of the composite), clipped to the rectangle or, with `mask: "ellipse"`, to the inscribed ellipse. Later elements cover earlier ones. An element sees its own frame (u = ±1 across its width, aspect = height/width) but LW/PH frequencies keep the composite's picture height. Nested defaults are reported by path, for example `scene.elements.3.parameters.cycles`. |

The engine provides only these generic parts. A product's own layout, label or brand belongs in the
application: build it as a `composite`.

```ts
import { calculateBarGroupTargets, simulateCapture, type ChartScene } from "@photivra/engine";

const chart: ChartScene = { preset: "composite", background: { preset: "line-grid", spacing: 1 / 6, lineWidth: 0.004 }, elements: [
  { scene: { preset: "siemens-star", profile: "sine", cycles: 64 }, centerU: 0, centerV: 0, width: 0.6, height: 0.6, mask: "ellipse" },
  { scene: { preset: "bar-groups", lineWidthsPerPictureHeight: [100, 200, 400] }, centerU: -0.7, centerV: 0.45, width: 0.5, height: 0.3 },
  { scene: { preset: "slanted-squares", columns: 1, rows: 1 }, centerU: 0.7, centerV: 0.4, width: 0.3, height: 0.3 }] };
const capture = await simulateCapture({ scene: chart, output: { width: 96, height: 64 } });
console.log(capture.scene.parameters, calculateBarGroupTargets({ scene: chart, aspect: 64 / 96 })[0]?.verticalBars);
```

`resolveChartScene()`, `calculateStepWedgeReflectances()`, `calculatePointGridCenters()` and, from 2.3,
`calculateBarGroupTargets()` (each group's LW/PH, line width and bar rectangles) and
`calculateSlantedSquareEdges()` (each square's centre and its four edges' midpoints and directions, for
slanted-edge regions of interest) expose the same definitions for analysis code, in the chart's frame
units (composite elements mapped into the composite's frame). `createPlanarSceneRadianceProvider()` turns any of these
scenes into a provider for the native environment RAW contract.

Instead of a chart you can pass a function. `{ kind: "reflectance-function", sceneId, evaluate }`
receives a plane point (`xM`, `yM` in metres, `u`, `v` and `wavelengthNanometers`) and returns a
reflectance in [0, 1], lit by the facade illuminant. `{ kind: "radiance-function", sceneId, evaluate }`
returns absolute spectral radiance in W·m⁻²·sr⁻¹·nm⁻¹ and ignores the illuminant.

```ts
import { simulateCapture } from "@photivra/engine";

const vignette = await simulateCapture({
  scene: { kind: "reflectance-function", sceneId: "radial-falloff", evaluate: (p) => 0.8 / (1 + p.u * p.u + p.v * p.v) },
  illuminant: "cie-a",
  output: { width: 8, height: 8, whiteBalance: "auto" }
});
console.log(vignette.request.whiteBalanceState?.source);
```

**Piecewise-constant scenes (2.7).** A scene made of a few uniform reflectances, such as a chart with a printed label,
can be passed as `{ kind: "material-function", sceneId, materials, materialAt }`. `materials` lists reflectances as a
chart's patches take them: a neutral number in [0, 1], or a reflectance spectrum covering 380–780 nm. `materialAt`
receives the plane point without a wavelength and returns the index of its material.

The radiance at each point is the same as a reflectance function returning that material's reflectance. Captures and
ideal references are therefore byte-identical to the reflectance-function form. The display view, though, tabulates
each material once and takes the chart presets' path.

```ts
import { resolveChartScene, simulateDisplayView } from "@photivra/engine";

const chart = resolveChartScene({ scene: { preset: "siemens-star" }, aspect: 2 / 3 });
const label = chart.materials.length;   // one extra material: a printed label in the lower left
const view = await simulateDisplayView({
  scene: { kind: "material-function", sceneId: "star-with-label",
    materials: [...chart.materials.map((m) => (m.kind === "neutral" ? m.reflectance : 0.5)), 0.05],
    materialAt: (p) => (p.u < -0.6 && p.v < -0.5 ? label : chart.materialAt(p.u, p.v)) },
  output: { width: 600, height: 400 }
}, { width: 300, height: 200 });
console.log(view.diagnostics.sceneLookups);
```

The same scene can be declared as data instead of a function: `{ kind: "material-layers", sceneId, chart, layers }`, an
engine chart under shape-mask layers (polygons and annuli in the mask's own units; `resolveChartMaterialLayers`). Every
CPU result is that of its `callerScene`, byte for byte, and `prepareDisplayView(request, { gpu: "auto" })` can render it
on the GPU, which a caller function cannot (docs/DISPLAY_VIEW.md, "Rendering on the GPU").

The display view's expected values match the reflectance-function form to rounding, because they are the same
quantities summed in another order. Measured on the app's chart with a maker label (a 24 MP frame, the 2028 × 1352 view's
centre strip, one thread), the material form took 1.15 s instead of 3.2 s with the defaults, and 3.0 s instead of 111 s
with diffraction, the four-spot filter and AHD.

## White balance

| Value | Meaning |
| --- | --- |
| `"scene-illuminant"` | A custom white balance measured from a perfect white diffuser under the scene illuminant, like a grey-card setting. |
| `"auto"` | Grey-world auto white balance (AWB) with the body's `neutral-priority` policy, over 2 × 2 block means of the RAW before white balance. The RAW is then rendered again with that setting, which repeats the radiance queries (`diagnostics.providerEvaluationCount` counts one pass); a capture on the tabulated RAW path (2.8, chart and material scenes) keeps its RAW, whose codes do not depend on the setting. |
| `"none"` | No white balance; development assumes a D65 adopted white. Scenes under other light keep their colour cast. |
| `{ kelvin, tint? }` | A colour-temperature setting on the Planckian locus (tint as Duv). |
| `{ channelGains }` | Manual channel gains. |

## Modelling choices

These choices appear in `assumptions` as `kind: "model"` entries:

- **Sensor colour.** The facade uses an idealized colorimetric sensor. Channel quantum efficiency is
  a·{x̄, ȳ, z̄}(λ)·555 nm/λ from the engine's own analytic fit of the CIE 1931 colour-matching
  functions (an approximation; see Colorimetry). The λ factor converts the energy-based functions into a
  photon-counting response. RAW channels are then proportional to CIE XYZ (the Luther–Ives
  condition), and the camera matrix is diagonal. No real camera has this response.
- **Lens.** The tier lens's spectrally flat transmission is used at every f-number and focus in the
  lens capability. By default no PSF (point-spread function) or diffraction, vignetting, distortion,
  lateral colour or stray light is applied. The tier's optical data exist only at f/4 and 5 m, and
  the facade does not extrapolate them. Vignetting, distortion and PSF are applied only from profiles
  you supply; diffraction of an ideal lens only with `lens.diffraction` (2.1).
- **Sensor.** Square pixels with a fill factor of 1 and no anti-aliasing filter. A global
  electronic shutter unless `motion.shutter` is `"rolling"`. A synthetic uniform dark current of
  1 e⁻/s at 20 °C (the tiers declare none). The charge capacity equals the body's base-ISO saturation signal,
  scaled with pixel area away from 6 µm (see [ISO and pixel size](#iso-and-pixel-size)).
- **Demosaic.** Bilinear RGGB interpolation through the existing linear-kernel contract, unless
  `output.demosaic` selects a built-in kernel or AHD. (Demosaicing fills in the two missing colours at each
  pixel of a colour-filter mosaic.) Sharp edges without lens blur therefore show the usual zipper and
  false-colour artefacts; `"ahd"` and `lens.diffraction` reduce them.
- **Scene.** A planar Lambertian surface: radiance = reflectance × irradiance / π, with illuminance
  from K_m = 683 lm/W and the analytic ȳ. No shadows, inter-reflection, gloss or fluorescence.
- **Rendering.** Linear sRGB with RAW white at display white, no exposure push, out-of-gamut
  components clipped, then the sRGB transfer function.

## Output formats

`output.format: "png"` writes a PNG with `serializePngImage`: 8- or 16-bit RGB, deterministic
in-house zlib, and the colour encoding signalled in the file.

| `colorEncoding` | Samples | PNG signalling |
| --- | --- | --- |
| `"srgb"` | Exactly the developed sRGB samples (the `srgb-8` / `srgb-16` output). | sRGB chunk (perceptual intent) with its prescribed gAMA/cHRM values |
| `"display-p3"` | Linear colour converted to Display P3 primaries (W3C CSS Color 4 `display-p3`, D65), sRGB transfer. | cICP 12/13/0/1 |
| `"rec2020"` | Linear colour converted to ITU-R BT.2020 primaries, BT.2020 OETF (the BT.709 curve). | cICP 9/1/0/1 |

The BT.2100 PQ and HLG encodings are not part of 2.0: their patent holders offer only
licence-on-request declarations (see the patent review in `THIRD_PARTY.md`).

What is converted, and where:

- The sRGB output path develops each pixel to linear sRGB/D65. That covers demosaic, a per-site clip
  at the RAW white level, white balance, highlight mode, the camera→XYZ matrix and the XYZ→sRGB
  matrix. It then clips each component to [0, 1].
- The wide-gamut encodings use the same development operator but stop before that clip. So
  colours outside sRGB survive, as negative or above-one sRGB components.
- They convert that linear colour back to CIE XYZ and on to the target primaries (matrices from the
  primaries and the D65 white, as in W3C CSS Color 4; see [Colorimetry](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md)).
- Gamut mapping then happens only once, in the target space. Components are clipped to [0, 1] for
  Display P3 and Rec. 2020.
- No perceptual gamut compression is applied by default (see `output.gamutMapping` below).
- Tone curves other than `identity` are sRGB-only, and are refused with a wide-gamut encoding.

- RAW white maps to display white. For extended range, merge a bracket with
  `createHdrBracketMergeTask` (see [PROCESSING.md](https://github.com/Photivra/photivra/blob/main/docs/PROCESSING.md)).
- No mDCV or cLLI metadata is written.
- With the facade's colorimetric sensor, the wide-gamut colours are exact up to the spectral
  quadrature (numerical integration over wavelength). With 5 nm spectral steps, a test reproduces an
  out-of-sRGB green emitter's CIE 1931 xy chromaticity to within 0.004.

```ts
import { simulateCapture } from "@photivra/engine";

const wide = await simulateCapture({
  scene: { preset: "checkerboard" },
  output: { width: 8, height: 8, format: "png", colorEncoding: "display-p3", bitDepth: 16 }
});
console.log(wide.image.colorEncoding, wide.image.png?.length, wide.diagnostics.rendering.gamutClippedLowSampleCount);

const rec2020 = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4, format: "png", colorEncoding: "rec2020", bitDepth: 16 } });
console.log(rec2020.image.samples instanceof Uint16Array, rec2020.assumptions.find((a) => a.id === "output.colorEncoding.conversion")?.value);
```

`output.gamutMapping: "perceptual"` replaces the component clip for the PNG encodings (`srgb`,
`display-p3`, `rec2020`) with `prepareRgbGamutMapping`:

- CIELAB L* and hue are held.
- Chroma above 90 % of the gamut-boundary chroma is compressed with a smooth knee that never reaches
  the boundary (constant-lightness, constant-hue chroma reduction as in W3C CSS Color 4 §14, free; also
  see Morovič 2008).
- Hue is kept, whereas a component clip shifts it. The cost: saturated in-gamut colours above the knee
  lose a little chroma, and CIELAB hue drifts for saturated blues.
- `"clip"` (the default) leaves the output exactly as before.
- `diagnostics.gamutMapping` counts the pixels the mapping changed.
- It cannot be combined with tone curves.

`output.format: "dng"` writes the packed native RAW itself with `serializeNativeRawDng`: a lossless,
uncompressed 16-bit CFA DNG. `samples` are the developed 8-bit sRGB image and `image.dng` holds the file.
The DNG states only what the capture has:

| Tags | Source |
| --- | --- |
| Codes, CFAPattern, BlackLevel (2 × 2), WhiteLevel | The packed RAW codes, per-site black levels (they must repeat with the CFA tile) and the smallest per-phase effective white code |
| ActiveArea, DefaultCropOrigin/Size, Orientation | The capture geometry (the demosaic border lies outside the active area) |
| ColorMatrix1 (D65), ForwardMatrix1, AnalogBalance, AsShotNeutral | The facade's diagonal camera→XYZ profile and the capture's white-balance intent |
| BaselineExposure | 0: the RAW white level maps to display white, as in the facade's development |
| NoiseProfile | Each channel's readout regime: conversion gain ÷ digital gain and the combined read noise (Poisson, Gaussian and quantization only) |
| ImageDescription | States that it is a simulated packed RAW with no linear master or rendering stored; with `output.metadata` (2.4) the caller's description follows when it is printable ASCII |
| Copyright, XMP (tag 700) | Only with `output.metadata` (2.4); see [Text metadata](#text-metadata-24) |

- Saturation flags of sites whose code is below WhiteLevel have no DNG field. They are counted in the
  assumptions.
- `output.dng.capturedAtUtc` adds date tags. Without it, none are written.
- The file round-trips through `parseDngRawImage` to identical codes and tags.
- LibRaw 0.22.1 decodes identical codes. (It trims an odd ActiveArea origin to keep its Bayer
  alignment.)
- Pillow 12 reads every tag but has no CFA (colour filter array) decoder — for these files, as for any
  CFA DNG.

```ts
import { parseDngRawImage, simulateCapture } from "@photivra/engine";

const shot = await simulateCapture({ scene: { preset: "siemens-star" }, output: { width: 8, height: 8, format: "dng" } });
const dng = parseDngRawImage({ bytes: shot.image.dng! });
console.log(dng.width, dng.activeArea, dng.whiteLevel, dng.codes.length === shot.raw.codes.length);
```

### Text metadata (2.4)

`output.metadata` writes the caller's own text into the file. The engine writes the text exactly as
given and adds no text of its own (in a DNG the description follows the existing simulated-RAW statement). It applies to formats `"jpeg"`, `"png"` and `"dng"` (and to a PNG
`simulateIdealReference`); other formats reject it. Without it, every file is byte-identical to 2.3.0
(hash locks in `test/output-text-metadata.test.ts`).

```ts
import { simulateCapture } from "@photivra/engine";

const shot = await simulateCapture({
  scene: { preset: "siemens-star" },
  output: { width: 8, height: 8, format: "png",
    metadata: { description: "Siemens star at f/8", software: "My Viewer 1.0", copyright: "Rights held by the photographer", comment: "Test run 3" } }
});
console.log(shot.image.png?.length, shot.assumptions.find((a) => a.id === "output.metadata")?.value);
```

| Field | JPEG | PNG | DNG |
| --- | --- | --- | --- |
| `description` | XMP `dc:description` | `Description` | ImageDescription after the simulated-RAW statement (ASCII only); XMP `dc:description` (statement, then the text) |
| `software` | XMP `xmp:CreatorTool` | `Software` | XMP `xmp:CreatorTool` |
| `copyright` | XMP `dc:rights` | `Copyright` | Copyright tag (ASCII only); XMP `dc:rights` |
| `comment` | COM segment and XMP `exif:UserComment` | `Comment` | XMP `exif:UserComment` |

To add the same text to a JPEG or PNG you encoded yourself (for example a full-size file joined from
`output.region` parts), call `addJpegTextMetadata(jpeg, metadata)` or `addPngTextMetadata(png, metadata)` (#388).
They are the functions `output.metadata` uses, so the bytes are the same, and they check the text by the same rules.

Each field is optional, but at least one must be set. A field is a non-empty string of at most
2048 UTF-8 bytes. Lone UTF-16 surrogates (which have no UTF-8 form), NUL, U+FFFE, U+FFFF and control
characters other than line feed (`\n`) are rejected with an `InvalidConfigurationError` that names the
field. Use `\n` for line breaks.

Why these containers:

- **JPEG: XMP plus COM.** The JPEG already carries one XMP packet in APP1 (the print plan). XMP allows only
  one main packet per JPEG, of at most 65 502 bytes (XMP Part 3 §1.1.3, §1.1.3.1), so the fields go into
  that packet as a second `rdf:Description` of the same resource, which XMP allows (Part 1 §7.4). XMP is the
  smallest standard JPEG container with labelled, UTF-8 fields (Part 1 §8.3–8.4). A COM segment (ITU-T T.81
  §B.2.4.5) has no field names or declared character set, so it carries only the comment, in UTF-8. Exif tags are not used: Exif ASCII fields are 7-bit, and
  rewriting the Exif block would move every offset in it. The existing Exif Software tag keeps naming the
  engine's JPEG writer.
- **PNG: tEXt or iTXt.** One chunk per field with the predefined keywords (PNG Third Edition §11.3.3.1).
  `tEXt` holds printable Latin-1 and line feed (§11.3.3.2). Text outside that range goes into an
  uncompressed `iTXt` (§11.3.3.4; UTF-8, no language tag). The specification prefers iTXt for new text
  (§12.9); `tEXt` is kept for Latin-1 text because every PNG reader supports it. The chunks go before the
  first IDAT, as §12.9 recommends for short text.
- **DNG: TIFF tags plus XMP.** TIFF ASCII fields hold only 7-bit codes (TIFF 6.0 §2), so the
  description and copyright reach ImageDescription and Copyright only when they are printable ASCII.
  An XMP packet in tag 700 (XMP Part 3 §1.1.6, Table 13) always carries every field in UTF-8. Its
  `dc:description` repeats the full ImageDescription, statement first, because XMP maps tag 270 to
  `dc:description` (Part 3 §3.2.3). The Software tag keeps naming the engine's DNG writer.

Pillow 12.3 and ImageMagick 6.9 read the PNG text chunks and the JPEG comment, and Python's XML parser
reads both XMP packets.

## Demosaic

`output.demosaic` selects:

- `"bilinear"`: the built-in Bayer kernels of `createBuiltInBayerDemosaicProfiles` (nearest same-channel
  averages; pixel-identical to the default).
- `"ahd"` (2.1): adaptive homogeneity-directed demosaicing, `createAhdDemosaicTask` (after Hirakawa &
  Parks, *IEEE Trans. Image Processing* 14(3), 2005). Green is interpolated along rows and along columns,
  red and blue follow from colour differences, and each pixel takes the more homogeneous of the two
  candidates in CIELAB. It is non-linear and edge-directed, so it shows much less zipper and false colour
  on sharp edges than bilinear (mean false colour of a neutral 32 × 32 Siemens star: 138 instead of 209
  8-bit codes; slanted edge: 5.3 instead of 11.4). The RAW sites are normalized and white-level clipped
  exactly as in the native development, the homogeneity is measured on white-balanced colour, and the
  native development's colour operator and SDR kernel follow. The paper's iterative median step is not
  applied. With `"margin"` borders the sensor gets 5 extra sites per side (an AHD pixel depends on sites
  up to 5 away); `request.development` keeps the bilinear kernels, which validate the development but do
  not produce the pixels.

The Malvar–He–Cutler kernels are not offered (a patent is still in force; see
[PROCESSING.md](https://github.com/Photivra/photivra/blob/main/docs/PROCESSING.md)).

`output.borderHandling` decides how edge pixels get their neighbours:

- `"margin"` (the default) renders the kernel's reach as extra sensor sites around the output: one site
  for bilinear.
- `"mirror"` renders exactly the output, and reads reflect-101 mirror images of the missing sites. The
  engine first checks that every reflected site keeps its CFA colour. Mirror saves the radiance work for
  the border, so small captures need no extra sites. Its edge pixels use mirrored neighbours rather than
  rendered ones.

```ts
import { simulateCapture } from "@photivra/engine";

const mirrored = await simulateCapture({
  scene: { preset: "slanted-edge" },
  output: { width: 8, height: 8, demosaic: "bilinear", borderHandling: "mirror" }
});
console.log(mirrored.plan.exposure.geometry.nativeRaster, mirrored.request.development.borderHandling);
```

## Optics

The optics options feed only what the environment site contract accepts:

- `lens.projection` and `lens.distortion` become the site's `lensFieldMapping`.
  - Each sensor point is inverse-distorted, unprojected with the chosen ideal projection, and only then
    turned into a scene ray.
  - Irradiance is multiplied exactly once by the distortion area factor 1/det(J), where J is the
    Jacobian of the mapping.
  - At finite focus, a non-rectilinear projection is scaled by the thin-lens image distance (an
    approximation).
  - The chart is still sized with the rectilinear scale, so its edges move with the projection.
  - Neither option can be combined with `lens.pupilSampling`, because ideal pupil rays assume the
    rectilinear, distortion-free projection.
- `lens.vignetting` becomes radial-illumination-vignetting field throughput,
  1 + r2·ρ² + r4·ρ⁴ + r6·ρ⁶, applied once at the physical sensor point before any PSF.
- `lens.psf` is a caller sampled PSF passed through unchanged. Its focal length, f-number and focus
  must equal the resolved capture settings exactly, and it cannot be combined with pupil sampling.
- `lens.diffraction` (2.1) adds the diffraction blur of an ideal lens at the capture's resolved
  f-number, so stopping down now softens the image as well as darkening it.
  - The engine builds the kernels (`createDiffractionLimitedPsfProfile`): the Airy pattern of a uniformly
    lit circular pupil (scalar Fraunhofer diffraction), aberration-free and in focus, with pupil diameter
    f/N and the thin-lens image distance (working f-number N·v/f). Each kernel holds the PSF energy of
    site-sized cells, one kernel per spectral node.
  - Sources: the Airy pattern is the textbook Fraunhofer diffraction pattern of a circular aperture
    (Born & Wolf, *Principles of Optics*, 7th ed., §8.5.2; Goodman, *Introduction to Fourier Optics*,
    4th ed., §4.4). The kernels come from the pupil's incoherent optical transfer function (Goodman,
    4th ed., §7.3; MIT OpenCourseWare 2.71, lectures 21–22, free). The first dark ring is at
    1.22·λ·N_w (j₁,₁/π with j₁,₁ = 3.8317, the first zero of J₁), so the Airy disk diameter is
    2.44·λ·N_w, and the energy inside radius r is 1 − J₀(x)² − J₁(x)², x = π·r/(λ·N_w) (Wyant &
    Creath 1992, §II, eqs. 1–4, free). The Bessel-function relations and expansions come from the
    NIST DLMF (free). Full references are under [Sources](#sources).
  - The kernel window reaches the third dark ring at the longest node by default (2, 4 and 7 sites at
    f/4, f/8 and f/16 with 6 µm pixels); set `kernelRadiusSamples` (0–32) to change it. The Airy tail
    outside the window (2–6 % of the energy with the default) is listed per wavelength in the
    `lens.diffraction` assumption and put back by renormalizing each kernel to unit sum.
  - The default window is capped at 32 sites, the convolution limit. Small pixels at large f-numbers
    reach the cap before the third dark ring, so more of the tail is renormalized: 7 % at 1 µm and
    f/16, 15 % at 0.5 µm and f/16. The assumption's explanation then says the window is capped and
    how many sites the third ring would need.
  - It runs as an object-space convolution: the scene radiance on the site lattice is convolved once per
    spectral node and the provider answers each site query with it. That is the same sum as the
    environment PSF quadrature (one scene query per kernel tap) for this still, distortion-free planar
    scene; a test checks it to 1e-12 per site. With camera rotation, a projection or distortion, or
    vignetting, the per-tap quadrature runs instead (much slower). `request.diffraction` holds the profile,
    the equivalent `sampled-local` PSF and which execution ran.
  - The convolution runs in 32-row bands and computes only each band's own values, not the 2R rows and
    columns of padding around it (#419; the values are bit-identical to the full-grid convolution's). On a
    function scene with the Quality options at 1 µm and f/16 (R 32), 96 × 72, `diagnostics.timingsMs.diffraction`
    went from 6.3 s to 0.62 s (medians of 5, one thread, a shared Mac); the tabulated capture's four
    verification sites went from medians of 0.41–0.54 s to 4–5 ms at R 29–32.
  - Not modelled: defocus, aberrations, pupil clipping, a polygonal (bladed) aperture (the tiers declare
    no blade count) and, unless `sensor.pixelAperture` is `"box"` (2.3), the pixel aperture (each site
    is sampled at its centre). It cannot be
    combined with `lens.psf` or `lens.pupilSampling`.

- `lens.defocus: { model: "geometric-disc" }` (#492; the capture renders it, the display view does not yet) models defocus of the flat scene plane when
  `lens.focusDistanceM` differs from `subjectDistanceM`.
  - The model is a geometric approximation for an ideal uniform circular pupil. Each in-focus image point spreads
    into a uniform disc of diameter c = f²·|s − d| / (N·d·(s − f)) on the sensor (`calculateDefocusCircle`, thin-lens
    model 1.1.0), at the resolved f-number. There is no diffraction of the defocused wave, no aberrations and no
    pupil vignetting. The disc is the same at every wavelength, so defocus of a plane is one convolution.
  - The engine samples the disc on the site lattice. Each site's weight is the exact area of the disc inside that
    site's square cell, a closed-form circle–rectangle area, divided by the disc's area.
    - The weights are computed with the engine's portable arithmetic, so they are bit-identical in every
      JavaScript engine.
    - Their exact sum is 1, to the last bit of the centre weight.
    - A disc smaller than one site gives the identity.
    - A test blurs a sampled straight edge with the kernel and compares it with the disc's closed-form
      edge-spread function, the circular-segment area. They agree to rounding (2e-13) when the edge lies on cell
      boundaries. Elsewhere they agree within the site sampling of the edge.
  - The kernel radius is capped at 64 sites, a 129 × 129 window (`DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`). A larger
    blur is refused with an error that names the cap and the radius needed; the disc is never clipped.
    - **Check before rendering (#532):** `calculateDefocusDiscKernelRadius({ focalLengthMm, aperture, focusDistanceM,
      subjectDistanceM, pixelPitchMicrometers })` returns the disc's diameter in µm and in sites, the kernel radius it
      needs, `withinLimit` and `excessKernelRadiusSites`, without rendering. It runs the capture's own resolution and limit
      test, so it agrees with the refusal of `simulateCapture`, `simulateDisplayView` and `prepareDisplayView` at the
      boundary (`test/defocus-disc-limit.test.ts`, at two adjacent focus distances). Pass the f-number the capture uses
      (in an automatic mode, `exposure.settings.fNumber`). The limit is on the disc alone: with `lens.diffraction` the
      combined radius has no further limit. The other refusals below are not checked.
  - **The capture renders it** (#492, step 2a). The scene radiance on the site lattice is convolved with the disc,
    the same kernel at every spectral node, and each site query is answered with the result. This is the object-space
    convolution that `lens.diffraction` uses.
    - The capture keeps its tabulated fast path. Regions, strips and DNG parts stay byte-identical to the whole frame.
    - The `lens.defocus` assumption records `execution: "object-space-convolution"`.
    - `diagnostics.options` lists `lens.defocus`, and `diagnostics.timingsMs.defocus` times the provider's convolution.
    - The site inputs declare no PSF, because the defocus is applied upstream.
  - **With `lens.diffraction`**, each spectral node's diffraction kernel is convolved with the disc and applied as
    one kernel. The combined radius is the diffraction radius plus the defocus radius, at most 32 + 64 = 96 sites.
    - This is a further approximation, and the assumption says so. The defocused wave PSF of a circular pupil is not
      exactly the in-focus Airy pattern convolved with the geometric disc. Where the two differ is measured in a
      later step of #492.
    - Building the combined kernels cost 0.5 ms per spectral node at diffraction radius 2 with defocus radius 41. It
      cost 90 ms per node at 32 with 64, the largest pair (Node, one thread).
  - **The display view renders it** (#492, step 2b) with the same per-node kernels: its expected-signal tables read
    the scene on the site lattice through the disc (with `lens.diffraction`, through each node's diffraction kernel
    convolved with the disc), so the view's estimators run unchanged on the blurred signal. The `view.defocus`
    assumption records the kernel and its radii. The GPU display-view renderer does not take the kernel yet:
    `gpu: "auto"` renders such a view on the CPU, labelled `unsupported-on-backend`. Validation and cost per radius:
    [Display view, Defocus](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#defocus).
  - In focus (c = 0) no kernel is applied, and the image is byte-identical to the same request without the option.
    `simulateIdealReference`, which has no camera effects, only records the disc.
  - **Refused out of focus** with camera rotation, `lens.projection` or `lens.distortion`, and `lens.vignetting`. Each
    of these moves the scene points that a site sees off the site lattice, so the convolution does not apply. In
    focus they render as without `lens.defocus`.
  - **Sampling.** The scene enters at the lattice points the sites query: site centres, or the pixel-aperture nodes
    and anti-aliasing spots. So near an edge the result can differ from the continuous disc integral by the lattice's
    point sampling of the edge. Measured on a 16 × 12 slanted edge, as the relative difference in expected electrons
    per site (max / RMS):

    | Disc | Pixel aperture | Convolution vs continuous integral | 4 × 8 rays | 8 × 16 rays | 16 × 16 rays |
    | --- | --- | --- | --- | --- | --- |
    | 5.95 sites (R 3) | point | 0.112 / 0.026 | 0.089 / 0.021 | 0.023 / 0.0049 | 0.018 / 0.0035 |
    | 5.95 sites (R 3) | 4 × 4 box | 0.035 / 0.0065 | 0.048 / 0.010 | 0.0067 / 0.0014 | 0.0044 / 0.0007 |
    | 13.4 sites (R 7) | point | 0.030 / 0.0056 | 0.094 / 0.032 | 0.029 / 0.0077 | 0.023 / 0.0053 |
    | 13.4 sites (R 7) | 4 × 4 box | 0.0051 / 0.0013 | 0.070 / 0.026 | 0.012 / 0.0034 | 0.0090 / 0.0021 |

    The ray columns are `lens.pupilSampling` (the independent reference, without diffraction) against the same
    continuous integral. They converge toward it as the rays increase. Against the convolution, the 13.4-site disc
    with the box aperture gives 0.070, 0.012 and 0.0093 (max). In the test (the 5.95-site disc, point aperture), the rays
    and the convolution agree to 1e-9 at every site more than one site beyond the disc's reach of the edge.
  - **Validation** (`test/simulate-capture-defocus-render.test.ts`):
    - A vertical edge halfway between two lattice columns gives the exact circular-segment fraction at every site,
      to 1e-12.
    - A 48 × 480 slanted-edge capture's averaged edge profile is compared with the disc's closed-form edge-spread
      function. It uses RAW codes, green sites and quarter-site bins. The largest difference was 0.0093 of the
      step (noise seed 1).
    - The tabulated and environment paths give the same RAW.
    - Regions and DNG parts equal the whole frame: chart, Quality options with diffraction, a `material-layers`
      scene and a caller function.
  - **Cost and the 64-site cap.** Direct convolution costs (2R + 1)² multiply-adds per site and node wherever the disc
    sees more than one material. Uniform areas cost almost nothing on the tabulated path. Measured on the tabulated
    capture path (Node 24, one thread, rounds interleaved over the radii, median [range] of 3 rounds; 2 at 2048 × 1366;
    a shared 4-vCPU host):

    | Scene, size | in focus | R 2 | R 8 | R 16 | R 32 | R 41 | R 64 |
    | --- | --- | --- | --- | --- | --- | --- | --- |
    | Siemens star, 1024 × 683 | 0.37 s | 0.37 s | 0.51 s | 0.98 s | 2.9 s | 4.7 s | 11.6 s [11.4–11.8] |
    | Dead leaves, 1024 × 683 | 0.37 s | 0.38 s | 0.66 s | 1.6 s | 5.0 s | 7.9 s | 17.7 s [17.6–18.0] |
    | Slanted edge, 1024 × 683 | 0.32 s | 0.33 s | 0.35 s | 0.40 s | 0.70 s | 1.05 s | 2.7 s |
    | Siemens star, 1024 × 683, Quality (diffraction, four-spot, 2 × 2 box, AHD) | 0.81 s | 0.87 s | 1.7 s | 4.1 s | 12.5 s | 20.0 s | 52.9 s [52.0–53.2] |
    | Siemens star, 2048 × 1366 | 1.39 s | | 1.8 s | | 10.4 s | | 38.3 s [37.5–38.3] |

    - The cap stays at 64 sites, set from these numbers. It covers the 1.4 µm example of #492 (50 mm f/2.8, subject
      2 m, focus 1.6 m: R = 41) with room for larger blurs.
    - The time grows with R² per edge site, and the caller chooses it through the focus distance. Past the cap the
      request fails and names the radius it needed.
    - A 24 MP frame costs proportionally more. Render it in parts across workers, as for diffraction.
    - Off the tabulated path (caller reflectance or radiance functions), the provider gathers only each 32-row band's
      own values, not the 2R extra rows a full-grid convolution would return (#419). On a 256 × 171
      function scene the convolution took 0.3 s at R 8, 3.5 s at R 32 and 12.9 s at R 64.
  - It cannot be combined with `lens.pupilSampling` (the rays already render defocus) or `lens.psf` (a caller PSF
    declares its own defocus). It can be combined with `lens.diffraction`.

### Pixel aperture (2.3)

By default each site samples the irradiance at its centre (`sensor.pixelAperture: "point"`). Scene
detail finer than a pixel then aliases at full contrast: a whole-frame render of a chart whose finest
features are below the effective pitch shows false patterns that a real sensor would average away.
`sensor.pixelAperture: "box"` integrates the irradiance over the whole square photosite (fill factor 1,
the environment's uniform geometric-aperture response) with an N × N midpoint rule, N =
`samplesPerAxis` (1–16, default 4; `{ kind: "box", samplesPerAxis }`).

- An ideal square aperture of width p has the pixel MTF |sinc(f·p)| = |sin(πfp)/(πfp)| (the detector
  footprint MTF; G. D. Boreman, *Modulation Transfer Function in Optical and Electro-Optical Systems*,
  SPIE Press 2001, chapter 2): 0.64 at the Nyquist frequency 1/(2p), zero at
  1/p.
- The N-point midpoint rule has the response |sin(πfp)/(N·sin(πfp/N))| instead: within 2.6 % of the
  sinc below Nyquist for N = 4 (0.4 % at 3/16 cycles per pixel), with the same zeros at multiples of 1/p
  except at multiples of N/p, where it returns to 1 and scene detail still aliases. A test measures the
  RAW modulation of a sinusoid at 3/16 cycles per pixel for N = 2, 4 and 8 and finds this response to two
  decimals.
- No microlens, carrier diffusion or crosstalk is modelled. It multiplies the scene queries by N² (see
  [Cost of each option](#cost-of-each-option)). With `lens.diffraction` the object-space convolution
  still applies: one convolution per distinct sub-site node offset, and a test checks that it gives the
  same RAW codes as the per-tap PSF quadrature. `diagnostics.options` lists `sensor.pixelAperture.box`.

The default frame is a 0.38 mm crop behind a 50 mm lens, a field of well under a degree. Projection
and distortion effects therefore only become visible with larger pixels (or a custom lens). The
profiles are yours to supply: the tiers declare no vignetting, distortion or PSF away from their f/4
reference.

Atmospheric haze and polarizers are not offered, for two reasons:

- The scene-radiance provider contract fixes `volumetricTransportModeled` and `polarizationModeled` to
  false. Haze airlight added inside the provider would therefore be misdeclared.
- With unpolarized scene light, a polarizer reduces to a uniform attenuation, with none of its glare or
  sky effects.

Use `calculateAtmosphericHaze` and the front-of-lens filter contracts directly (see
[PHYSICS_FOUNDATION.md](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md)).

```ts
import { simulateCapture } from "@photivra/engine";

const lensy = await simulateCapture({
  scene: { preset: "point-grid" },
  sensor: { pixelPitchMicrometers: 50 },
  lens: {
    projection: "fisheye-equisolid-angle",
    distortion: { kind: "radial", profile: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { k1: -0.1, k2: 0, k3: 0 } } },
    vignetting: { normalizationRadiusMm: 0.5, maximumNormalizedRadius: 1, coefficients: { r2: -0.3, r4: 0, r6: 0 } }
  },
  output: { width: 8, height: 8 }
});
console.log(lensy.request.siteInput(0).environment.lensFieldMapping, lensy.assumptions.find((a) => a.id === "lens.vignetting")?.kind);
```

```ts
import { simulateCapture } from "@photivra/engine";

const stoppedDown = await simulateCapture({
  scene: { preset: "siemens-star" },
  lens: { fNumber: 16, diffraction: "circular-aperture" },
  exposure: { shutterSeconds: 1 / 30 },
  output: { width: 48, height: 48, demosaic: "ahd" }
});
console.log(stoppedDown.request.diffraction?.execution, stoppedDown.request.diffraction?.profile.maximumTruncatedEnergyFraction);
```

### Anti-aliasing filter

`sensor.antiAliasing` (2.1) puts an optical low-pass filter in front of the sensor. Most real cameras
with a Bayer sensor carry one; the generic tiers declare none, so it is off by default. It is modelled
the way a birefringent quartz filter works: every image point is split into equally bright copies, and
each site collects the light that would otherwise have landed at its centre minus each offset (the
engine's `normalized-point-splitting-kernel` optical-stack response, resolved by
`resolveAntiAliasingSpatialKernel`).

- `{ kind: "four-spot", separationSites }`: two crossed plates, four spots at (±d/2, ±d/2) with weight
  1/4 each. Its MTF is |cos(π·f_x·d)·cos(π·f_y·d)|. The most common filter in digital cameras.
- `{ kind: "two-spot", axis: "horizontal" | "vertical", separationSites }`: one plate, two spots at
  ±d/2 along the axis, MTF |cos(π·f·d)|.
- `{ kind: "point-splitting", components }`: your own kernel, offsets in micrometres (+x right, +y
  down) and positive weights that sum to 1; at most 16 components, each within 4 sites.
- d = `separationSites` × pixel pitch, 0 < `separationSites` ≤ 4. The default 1 puts the first MTF
  zero at the sensor's Nyquist frequency 1/(2·pitch): a four-spot filter one pixel wide cuts off at
  Nyquist (Palum 2006). Above Nyquist the cosine rises again, so a lens (for example
  `lens.diffraction`) is still needed to suppress the highest frequencies.

Measured at f/8 on 128 × 128 neutral charts (mean false colour |R − G| + |B − G| in 8-bit codes):
Siemens star 100.8 → 52.2 with bilinear and 68.7 → 25.1 with AHD; slanted edge 4.9 → 3.8 (bilinear).
The price is sharpness: the slanted-edge 10–90 % width grows from 1.49 to 2.34 px (bilinear).

Each site queries the scene once per spot, so the radiance work grows by the number of spots (4 for
`four-spot`). With `lens.diffraction` the object-space convolution still applies: the taps around
each split point lie on the site lattice shifted by its offset, so the engine convolves once per
distinct sub-site shift (one half-site lattice for the default four-spot filter). A test checks it
against the per-tap environment quadrature to 1e-12 per site.

Approximations, listed in the `sensor.antiAliasing` assumption: the split is the same at every
wavelength, field point and polarization (birefringence dispersion is ignored), the spots are exact
points of equal weight for unpolarized light, and the filter's transmission, reflections and focus
shift are not modelled. It is not a measured filter.

```ts
import { simulateCapture } from "@photivra/engine";

const filtered = await simulateCapture({
  scene: { preset: "siemens-star" },
  sensor: { antiAliasing: { kind: "four-spot" } },
  lens: { diffraction: "circular-aperture" },
  output: { width: 48, height: 48, demosaic: "ahd" }
});
console.log(filtered.assumptions.find((a) => a.id === "sensor.antiAliasing")?.value);
```

## Motion

`motion.angularVelocityRadPerSec` rotates the camera at a constant rate during the exposure, in the
engine's pitch/yaw/roll convention ([SENSOR_ENVIRONMENT_QUERY.md](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_ENVIRONMENT_QUERY.md)).

- Every scene ray is rotated at each temporal midpoint of the site's exposure window. Motion blur is
  therefore a midpoint quadrature (an average over sample times).
- `sensor.temporalSampleCount` defaults to 8 when the camera rotates.
- A yaw of ω rad/s moves the image by ω·f/pitch pixels per second (f = focal length).

`motion.shutter: "rolling"` derives the exposure schedule from the body's rolling readout declaration,
with `resolveElectronicRollingShutterExposureSchedule` (line reset/read linkage). A site at normalized
scan position s integrates over [s·τ, s·τ + T], where τ is the skew and T the exposure time.

- The default skew τ is the tier's full-frame data-readout time, applied unchanged across the simulated
  frame. It is not scaled to the cropped sensor, because the engine never rescales a declared skew. A
  small frame therefore shows the skew of a full-sensor readout.
- Pass `rollingShutterSkewSeconds` to declare τ for the simulated frame yourself.
- Each site's charge window follows its own exposure window.
- Combined with rotation, a vertical edge shears by ω·f/pitch·τ pixels from the first row to the last.
  A test checks this.

```ts
import { simulateCapture } from "@photivra/engine";

const pan = await simulateCapture({
  scene: { preset: "slanted-edge", angleDegrees: 0 },
  motion: { angularVelocityRadPerSec: { yaw: 0.06 }, shutter: "rolling", rollingShutterSkewSeconds: 0.01 },
  output: { width: 8, height: 8 }
});
console.log(pan.assumptions.find((a) => a.id === "sensor.shutter")?.value, pan.exposure.settings.shutterSeconds);
```

## Performance

Almost all of the cost is engine time per sensor site; the facade itself adds little. Since 2.0, the
native environment task runs most sites through a lean executor. It skips per-site re-validation that
is provably redundant, and produces byte-identical output (described in the repository's
`docs/NATIVE_RAW_AND_PRINT.md`).

Measured on a 4-core Linux host running Node 24 (slanted edge, default settings and sRGB 8-bit output):

| Output | Native sites | Wall time | CPU time | CPU per site |
| --- | --- | --- | --- | --- |
| 64 × 64 | 4 356 | 0.6 s | 0.87 s | 0.20 ms |
| 128 × 128 | 16 900 | 1.6 s | 2.2 s | 0.13 ms |
| 256 × 256 | 66 564 | 5.7 s | 6.9 s | 0.10 ms |
| 1000 × 1000 | 1 004 004 | — | about 2 min (extrapolated) | — |

The 1000 × 1000 row is not a measurement. It multiplies the 256 × 256 CPU cost per site by the site
count. Before the lean executor, the same 64 × 64 capture took about 6.0 s of CPU on this host, and
128 × 128 about 20.6 s. Development and encoding are a small part of the total.

The 2.1 options, measured on the same kind of host (4-vCPU Intel Xeon 2.80 GHz, Node 24, median of three
runs, slanted edge and Siemens star): at 48 × 48, default 0.38–0.45 s, `lens.diffraction` 0.49–0.71 s
(f/4–f/16), `"ahd"` 0.48–0.63 s, both 0.60–0.87 s; at 128 × 128, default 2.1–2.3 s, diffraction
2.5–3.4 s, AHD 2.4–2.5 s, both 2.8–4.0 s. The same diffraction through the per-tap environment quadrature
took 13.1 s at 48 × 48, f/8. [Cost of each option](#cost-of-each-option) covers every opt-in.

These numbers come from one run on one machine. They are not a performance claim. Small captures
(up to about 128 × 128) take a few seconds. Use them while you explore, and render large images only
when you need them.

## Cost of each option

Slow options are opt-in, so an application can decide which ones it can afford: a feature that is
too slow for a phone today may be cheap on the next generation of hardware. The table gives the
measured wall time of each opt-in that affects run time, relative to the default capture of the same
size.

**Method.** Slanted-edge chart, every other option at its default (f/8, 1/125 s, ISO 100, sRGB 8-bit,
bilinear demosaic). One fresh Node process per row and size; one 16 × 16 warm-up capture, then three
timed captures (`performance.now()` around `simulateCapture`), median reported. Built `dist`, Node
24.21.0, 4-vCPU Intel Xeon 2.80 GHz, Linux, nothing else running. One run on one machine: not a
performance claim, but the ratios carry over roughly.

| Option | 48 × 48 | 128 × 128 | What it buys |
| --- | --- | --- | --- |
| default | 0.50 s (1×) | 2.49 s (1×) | Point optics, bilinear demosaic, sRGB samples |
| `lens.diffraction: "circular-aperture"` | 0.65 s (1.3×) | 2.84 s (1.1×) | Aperture-dependent sharpness (Airy blur); convolution 0.38 s at 128 |
| `output.demosaic: "ahd"` | 0.65 s (1.3×) | 2.60 s (1.0×) | About half the false colour on sharp edges; 5-site margin, demosaic 0.05 s at 128 |
| `sensor.antiAliasing: { kind: "four-spot" }` | 0.94 s (1.9×) | 4.96 s (2.0×) | Optical low-pass filter: false colour halved again, at a cost in sharpness |
| anti-aliasing + diffraction | 1.16 s (2.3×) | 6.02 s (2.4×) | Both, still on the fast convolution path |
| anti-aliasing + diffraction + AHD | 1.42 s (2.8×) | 6.99 s (2.8×) | The most faithful still image of a planar chart |
| `lens.pupilSampling` 1 × 4 rays | 1.79 s (3.6×) | 11.5 s (4.6×) | Defocus and depth of field, coarse |
| `lens.pupilSampling` 2 × 8 rays | 5.20 s (10×) | 33.1 s (13×) | Defocus and depth of field, smoother bokeh |
| `lens.psf` (caller 3 × 3 kernel) | 2.11 s (4.2×) | 12.4 s (5.0×) | Any sampled lens PSF; runs per tap, so cost grows with the kernel size (a 9 × 9 diffraction kernel took 13.1 s at 48 × 48) |
| `motion` yaw 0.01 rad/s (8 temporal samples) | 1.70 s (3.4×) | 8.74 s (3.5×) | Motion blur; cost grows with `sensor.temporalSampleCount` |
| rotation + `shutter: "rolling"` | 1.79 s (3.6×) | 9.24 s (3.7×) | Rolling-shutter skew of moving content |
| `motion.shutter: "rolling"` (still camera) | 0.47 s (0.9×) | 2.51 s (1.0×) | Per-row exposure windows; no cost alone |
| `output.format: "png"` | 0.50 s (1.0×) | 2.63 s (1.1×) | PNG file bytes; encode 16 ms at 128 |
| `output.format: "jpeg"` | 0.52 s (1.0×) | 2.59 s (1.0×) | Baseline JPEG; encode 45 ms at 128 |
| `output.format: "dng"` | 0.50 s (1.0×) | 2.27 s (0.9×) | Lossless CFA DNG of the RAW; encode 4 ms at 128 |
| `output.highlightMode: "reconstruct"` | 0.50 s (1.0×) | 2.20 s (0.9×) | Near-clipped highlights blend smoothly toward neutral instead of clipping per channel; no measurable cost |
| `output.whiteBalance: "auto"` | 0.77 s (1.6×) | 4.76 s (1.9×) | Grey-world white balance; renders the RAW a second time (2.24 s at 128) |
| `sensor.pixelAperture` box 2 × 2 (2.3) | 0.76 s (1.6×) | 4.65 s (1.8×) | Photosite integration, coarse (response within 11 % of the box MTF below Nyquist) |
| `sensor.pixelAperture: "box"` (4 × 4, 2.3) | 2.54 s (5.2×) | 20.0 s (7.8×) | Photosite integration: fine detail averages out instead of aliasing (within 2.6 % of the box MTF below Nyquist) |
| `sensor.pixelAperture` box 8 × 8 (2.3) | 11.4 s (23×) | 56.2 s (22×) | Within 0.7 % of the box MTF below Nyquist |
| box 4 × 4 + `lens.diffraction` (2.3) | 4.38 s (8.9×) | 26.4 s (10×) | Both; 16 convolution lattices (6.4 s of convolution at 128) |

The 2.3 rows were measured later on the same kind of host, against a default of 0.49 s and 2.57 s in
the same session. The box aperture multiplies the scene queries by N² but the run time by less (5–8×
for 16 queries), because part of each site's work does not grow with the queries.

Ratios below about 1.1× are within the run-to-run spread (the three default runs at 128 × 128 took
2.23–2.50 s). The radiance work dominates: options that multiply the scene queries per site
(anti-aliasing spots, pupil rays, PSF taps, temporal samples) multiply the run time by about the same
factor, and output-side options cost almost nothing.

The cost of `simulateDisplayView` is in [Display view](#display-view).

### Measuring cost on the user's device

From 2.1 every result says what ran and how long each stage took, so an application can decide on the
user's own device which options to offer:

- `diagnostics.options` lists the opt-ins that changed the work of the run, in the fixed order of
  `SIMULATE_CAPTURE_COST_OPTIONS` (for example `["lens.diffraction", "sensor.antiAliasing",
  "output.demosaic.ahd", "output.format.png"]`). It is empty when every default is used.
- `diagnostics.timingsMs` has `raw`, `whiteBalance` (the second RAW pass of `whiteBalance: "auto"`),
  `development` (includes DNG writing), `jpeg` and `total` in whole milliseconds, and, where the stage
  ran, `diffraction` (the object-space convolution, part of `raw`), `demosaic` (the AHD demosaic, part
  of `development`) and `encode` (PNG, JPEG or DNG serialization), with sub-millisecond resolution where
  the host has `performance.now()`.

Timings change from run to run, but nothing else does: they never enter the scene digest, the RAW,
the samples or the encoded files, and a test checks that two runs differ only in `timingsMs`.

```ts
import { simulateCapture } from "@photivra/engine";

const probe = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 32, height: 32, demosaic: "ahd" } });
console.log(probe.diagnostics.options, probe.diagnostics.timingsMs.total, probe.diagnostics.timingsMs.demosaic);
```

## Large images

By default a capture is at most 4094 × 4094 output pixels and every full-resolution stage admits at most
24 000 000 pixels (PNG: 100 000 000). Large images are slow and memory-hungry, so from 2.2 they are an
opt-in that the application decides on, for example after checking the device:

- `simulateCapture`: `output.maximumPixels`, the most native sensor sites (output plus the demosaic margin
  on each side) the capture may allocate. A 12 252 × 8 168 output with the default margin needs
  12 254 × 8 170 = 100 115 180; passing `NATIVE_RAW_LIMITS.ceilingPixels` is simplest. Each side may then
  reach 16 384 sites including the margin. `output.demosaic: "ahd"` still admits at most 2^26 = 67 108 864
  native sites, checked before any work.
- The stages directly: `maximumPixels` on `calculateNativeRawPlan` / `createNativeRawTask` (and so on every
  native environment and development task built from that input), `createNativeCaptureSdrTask`,
  `calculateIrradianceConvolution`, `calculateTemporalExposureSum`, `createPrintJpegTask` and
  `serializePngImage`; `maximumRegionSites` on `simulatePackedSensorRaw`; `maximumQueries` on
  `calculateChartRadianceBatch`.

Each value must be an integer from 1 to the stage's ceiling (`ceilingPixels`, `ceilingRegionSites`,
`ceilingQueries`), all 2^27 = 134 217 728 = 16 384 × 8 192. That covers 12 252 × 8 168 (100.07 MP) and
11 552 × 8 664 (100.09 MP) sensors plus their margin with about a third to spare. It is also the size at
which the pipeline's largest single array, the interleaved float64 RGB of the development (24 bytes per
pixel), reaches 3 GiB: JavaScript engines cap an `ArrayBuffer` at about 4 GiB or less, so a higher ceiling
could not be honoured anyway. The per-side limit (16 384) and every byte budget (`maximumOutputBytes` and
similar) still apply. A raised native RAW limit raises the native environment whole-event query budget
ceiling in proportion (2 000 000 000 per 24 000 000 pixels), and a raised Print JPEG limit raises its
`maximumEncodedBytes` ceiling the same way (256 000 000 bytes per 24 000 000 pixels). Leaving the inputs out
changes nothing: requests, plans and output bytes stay as they were.

```ts
import { NATIVE_RAW_LIMITS, simulateCapture } from "@photivra/engine";

// The same capture with large images allowed; at 16 × 16 the output is identical to the default.
const large = await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 16, height: 16, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels } });
console.log(large.plan.maximumPixels, large.plan.pixelCount);
```

**Measured cost.** One fresh Node process per stage and size (Node 24.21.0, 4-vCPU Intel Xeon 2.80 GHz,
Linux, one run each, single thread). Synthetic inputs: a gradient with pseudo-random noise for the
encoders, repeating patterns elsewhere; the PNG and JPEG times depend on the image content. *Peak
memory* is the process's peak resident memory minus the idle runtime (about 125 MB), per pixel; it
includes the stage's input and output arrays. Not a performance claim, but it shows how the cost grows.

| Stage (as measured) | 1 MP | 24 MP | 100.07 MP | Per MP | Peak memory per pixel |
| --- | --- | --- | --- | --- | --- |
| Irradiance convolution, radius 2 (25 taps), float32 in | 0.32 s | 6.5 s | 27.7 s | 0.28 s | 12 B (4 in, 8 out) |
| Temporal exposure sum, 8 nodes | 0.56 s | 9.7 s | 42.0 s | 0.42 s | 12 B (4 in, 8 out) |
| Packed sensor RAW (`simulatePackedSensorRaw`) | 0.60 s | 11.9 s | 48.2 s | 0.48 s | 11 B measured; the all-zero dark plane was never touched, so count 16 B of input plus the output |
| Chart radiance batch, one wavelength | 0.13 s | 2.6 s | 13.0 s | 0.13 s | 17 B (9 in, 8 out) |
| PNG, 8-bit sRGB | 0.31 s | 2.7 s | 22.7 s | 0.23 s | 8 B (3 in) |
| PNG, 16-bit sRGB | 0.57 s | 5.1 s | 40.7 s | 0.41 s | 15 B (6 in) |
| Print JPEG, 1:1, quantization step 2 | 0.84 s | 19.5 s | 69.7 s | 0.70 s | 10 B (3 in; 2.6–2.9 B out) |
| Native capture SDR, 8-bit (tiles from the caller) | 0.07 s | 1.6 s | 5.8 s | 0.06 s | 4 B (3 out) |
| Native RAW DNG writer | 0.07 s | 1.7 s | 6.4 s | 0.06 s | 17 B (7 in, 2 out) |
| Native RAW development to 8-bit sRGB | 0.34 s | 5.2 s | 20.5 s | 0.21 s | 10 B (7 in, 3 out) |
| `simulateCapture`, default options, slanted edge, sRGB 8-bit | 129 s | — (16 MP: 1 973 s) | about 3.4 h (extrapolated) | 123–129 s | 34 B at 16 MP (fixed part about 360 MB) |

**What this means for a 100 MP capture.** The full capture was measured at 0.26, 1, 4 and 16 MP: 133, 129, 125 and 123 s per MP, almost all of it
the per-site RAW simulation. At that rate a 100 MP capture with default options takes about 12 300 s
(3.4 h) on one core of this host; the options in [Cost of each option](#cost-of-each-option) multiply
that. The 100 MP time is extrapolated, not measured. Memory: about 360 MB of fixed working state, then a
peak during development of about 34 bytes per pixel (7 B packed RAW, 24 B float64 linear RGB, 3 B 8-bit
samples), measured 541 MB above the idle runtime at 16 MP, so about 3.4 GB at 100 MP. JPEG and PNG
encoding add their own rows above; `whiteBalance: "auto"` renders the RAW twice.

Browsers are tighter than Node: a tab may have a few GB at most, a single `ArrayBuffer` may be limited
to 2–4 GB, and mobile browsers kill tabs earlier. A 100 MP capture can therefore fail in a browser with a
`RangeError` or an out-of-memory crash even where it runs in Node. Run large captures in a Web Worker,
pass `signal` so they can be cancelled, and offer them only on devices that can afford them.

## Region rendering (2.3)

`output.region: { x, y, width, height }` renders only that rectangle of the whole `output.width` ×
`output.height` frame (output pixels, x right and y down from the top-left). The result is
byte-identical to the same pixels of the whole render, so an application can split a large frame into
tiles, render them in separate Web Workers and stitch them, or render a 100 % crop of a frame it never
renders in full. Tests stitch irregular tile grids (odd and even offsets) and compare them byte for byte
with the whole render for the bilinear and AHD demosaics, mirror borders, diffraction with
anti-aliasing and the box aperture, camera rotation with a rolling shutter, a fixed-size composite chart
and a Display P3 PNG.

How it stays identical:

- **Everything frame-wide uses the whole frame:** framing, the meter (it reads the scene, not the RAW),
  exposure, white balance, the diffraction kernels, the scene digest and `request.environmentRaw` (the
  whole frame's request; `request.siteInput` takes whole-frame native indices).
- **Noise and timing:** every site keeps its absolute native index in the whole frame's native raster,
  so its noise seeds, CFA phase and exposure window are the whole render's. Under a rolling shutter a
  row's timing comes from its global row, never from its row within the tile.
- **Demosaic margin:** the native sites rendered are the region plus the demosaic reach on each side
  (1 site for bilinear, 5 for AHD), clipped to the frame's native raster, with the origin rounded down
  to the 2 × 2 CFA repeat. Inside the frame those border sites are real rendered sites; at the frame's
  own edges the region raster ends exactly where the whole frame's does, so `borderHandling: "mirror"`
  mirrors at the same place. AHD reads at most 5 sites away, so its edge-directed choices see the same
  neighbourhood.
- **Diffraction (2.6: region-limited):** the object-space convolution covers only the scene lattice the
  region's native sites query: the native rectangle plus the anti-aliasing and box-aperture offsets on
  each side, in bands of at most 32 native rows, with the kernel radius of real scene radiance around it.
  Each kept value is the same gather as in the whole render (the same kernel, the same taps in the same
  order, and every tap inside the grid), so the values are bit-identical while the work follows the
  region plus its halo instead of the frame width. In 2.3–2.5 the bands spanned the whole frame width, so
  a small crop of a wide frame paid for the full width and k tile columns repeated it k times. The noise
  needs no frame-wide state: each site's stream is seeded by a hash of the capture seed and its absolute
  native index (`seedSchedule: "murmur3-capture-seed-native-index-stream-v2"`), so it is counter-based,
  not a position in one frame-wide stream; the demosaic and the filters read only the margin above.

Measured on one core (Node 24, 4-vCPU Intel Xeon 2.80 GHz, built `dist`, one run each): a 256 × 256
slanted edge took 8.45 s whole, 9.03 s as four 256 × 64 strips and 8.44 s as four 128 × 128 tiles run
one after another; with `lens.diffraction` 10.2 s whole and 12.9 s as four tiles (the repeated
convolution bands). A 64 × 64 crop of a 4000 × 3000 frame took 0.63 s, the same as a plain 64 × 64
capture. Tiles in parallel workers divide the wall time by the number of cores.

**A 100 % crop with the slow options (2.6).** A 192 × 128 region at the centre of a 6000 × 4000 frame at 6 µm,
Siemens star, f/16, `output.maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels` (one fresh Node 24.21.0 process per
row, 4-vCPU Intel Xeon 2.80 GHz, built `dist`, one run each; `diagnostics.timingsMs`):

| Options | 2.5.0 total (convolution) | 2.6 total (convolution) | Peak resident memory, 2.5.0 → 2.6 |
| --- | --- | --- | --- |
| defaults | 3.6 s (—) | 3.6 s (—) | 320 → 304 MB |
| diffraction, four-spot filter, AHD | 60.8 s (50.2 s) | 11.8 s (1.7 s) | 556 → 379 MB |
| diffraction, four-spot filter, AHD, box 2 × 2 | 228.7 s (195.8 s) | 39.6 s (6.5 s) | 1 285 → 545 MB |

On a GitHub-hosted `ubuntu-latest` runner (4 vCPU AMD EPYC 7763, Node 24, one run each) the same rows took 2.7 → 2.6 s,
44.1 → 8.3 s and 170.9 → 27.7 s; from 2.6 the box row takes 19.4 s, because the engine no longer re-parses the fixed parts of its own chart scenes' results (caller scenes keep the full validation). The samples are byte-identical between the two versions. What remains is the per-site work, which grows with the
scene queries per site (20 spectral nodes × the filter spots × the box nodes: 80 per site with the filter, 320
with the filter and the 2 × 2 box) and with the region's sites, not with the frame.

`output.maximumPixels` is still needed for a region of a frame wider or taller than 4094 pixels: the request,
plan and noise seeds are those of the whole frame, and the whole frame's native raster is checked against the
limit. The allocations follow the region, so the opt-in costs no memory for the rest of the frame.

`result.image` holds the region, `result.raw` and `result.plan` describe the region's native sites (the
plan's active area is the region; `result.region.nativeRect` gives them in the whole frame), and
`result.region` reports the rectangle and the frame. `diagnostics.options` lists `output.region`.
`output.whiteBalance: "auto"` is refused with a region, because grey-world statistics of a tile differ
from the whole frame's; measure white balance once (or use `"scene-illuminant"` or a fixed setting) and
pass it to every tile. A DNG of a region is a DNG of the region's sites.

```ts
import { simulateCapture, type SimulateCaptureOptions } from "@photivra/engine";

const frame: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 96, height: 64 } };
// Two horizontal strips; in an application each would run in its own Web Worker.
const strips = await Promise.all([0, 32].map((y) => simulateCapture({ ...frame, output: { ...frame.output, region: { x: 0, y, width: 96, height: 32 } } })));
const stitched = new Uint8Array(96 * 64 * 3);
strips.forEach((strip, i) => stitched.set(strip.image.samples as Uint8Array, i * 96 * 32 * 3));
console.log(strips[0]!.region, stitched.length);
```

### A whole-frame DNG from parts

`serializeSimulatedCaptureDngFromParts(options, parts)` writes the whole-frame DNG of `options` (`output.format: "dng"`,
no `output.region`) from region renders of the same request, so a large DNG's RAW can render in parallel like a JPEG or PNG.
Each part is a region result's `raw` and `region` (any region format; `result.raw` holds the region's native sites,
`result.region.nativeRect` where they lie). A region's sites are the whole render's sites, so the joined RAW is the whole
render's RAW; the function then resolves the request and writes the DNG exactly as `simulateCapture` does, and the bytes
are the same. The parts must cover the frame's native raster; where they overlap (the demosaic margin) their sites must
agree, and a part from another request is refused. Render the parts with a fixed white balance and without `output.dng`
(a region takes neither; the RAW codes do not depend on the white-balance intent): auto white balance and the capture time
apply to the DNG options passed here, and auto white balance is measured over the joined frame.

Tests compare the joined DNG byte for byte with the whole-frame DNG for bilinear and AHD, diffraction with the four-spot
filter and the 2 × 2 box, auto white balance with a capture time, a reflectance-function scene and the environment path.
On the Photivra app's 24 MP request (6000 × 4000 at 6 µm, 24 parts of about 1024 pixels; Node, one thread) the DNG was
the same bytes both ways; the parts took 58.1 s of CPU against 50.6 s for one whole render (Quality options: 119.3 s against
113.6 s) and the join 2.6 s, so on four workers the wall time is roughly a quarter of the whole render's.

```ts
import { serializeSimulatedCaptureDngFromParts, simulateCapture, type SimulateCaptureDngPart, type SimulateCaptureOptions } from "@photivra/engine";

const dngFrame: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 96, height: 64, format: "dng" } };
// Two strips rendered as sRGB regions (in an application, in separate Web Workers), then one DNG of the whole frame.
const parts: SimulateCaptureDngPart[] = await Promise.all([0, 32].map(async (y) => {
  const part = await simulateCapture({ ...dngFrame, output: { width: 96, height: 64, region: { x: 0, y, width: 96, height: 32 } } });
  return { raw: part.raw, region: part.region! };
}));
const dng = await serializeSimulatedCaptureDngFromParts(dngFrame, parts);
console.log(dng.bytes.length);
```

### A Print JPEG written in strips

At 1:1 (output size equal to the crop), a Print JPEG's rows can be coded on separate workers.
`createPrintJpegStrip(input, { y, height, samples })` codes crop rows `y` to `y + height` (8-bit sRGB RGB, crop-wide;
`y` a multiple of 8, and `height` too unless the strip ends at the image's bottom) apart from the rows before them.
`composePrintJpegStrips(input, strips)` joins strips that cover the image, top to bottom, into the file
`createPrintJpegTask` writes for the same plan and source pixels: the same bytes. Only the first block of each strip
depends on the strip before it (its DC differences), so the join codes that block and copies the rest of the strip's
bits. The output's `providerReads` is 0, because no source is read.

Tests compare the joined file with the task's file byte for byte, for several splits, crops, quantization steps and a
density. For a 24 MP file (Node, one thread), the whole task took 8.1 s; four strips took 1.9 s each, and the join took
1.1 s (a 64 MB file). In the Photivra app (Chromium, four workers), writing a 24 MP JPEG takes about 3 s instead of 9–12 s.

```ts
import { composePrintJpegStrips, createPrintJpegStrip, type PrintJpegInput } from "@photivra/engine";

const width = 64, height = 40, pixels = new Uint8Array(width * height * 3).fill(120);
const jpegPlan: PrintJpegInput = {
  source: { captureId: "capture", imageStateId: "sdr", artifactId: "pixels", sha256: "0".repeat(64), width, height, encoding: "encoded-srgb-8-rgb" },
  crop: { x: 0, y: 0, width, height }, outputWidth: width, outputHeight: height, quantizationStep: 2, maximumEncodedBytes: 1_000_000, maximumProviderReads: 16
};
// Two strips (in an application, coded in separate Web Workers), then the file.
const strips = [[0, 24], [24, 16]].map(([y, rows]) => createPrintJpegStrip(jpegPlan, { y: y!, height: rows!, samples: pixels.slice(y! * width * 3, (y! + rows!) * width * 3) }));
const jpeg = composePrintJpegStrips(jpegPlan, strips);
console.log(jpeg.bytes.length);
```

## Ideal reference (2.3)

`simulateIdealReference(options)` takes the same options as `simulateCapture` and returns what the camera
would have recorded **without any camera effects**: the same scene, framing, chart size, output size,
region and pixel grid, but no lens blur, diffraction, defocus, projection or distortion, vignetting,
anti-aliasing filter, colour mosaic or demosaicing (every pixel has all three channels), photon, dark or
read noise, dark signal, ADC rounding, or camera motion and rolling shutter. A comparison view can show
it next to a capture as "the chart without the effects applied". The result is labelled
`kind: "ideal-reference"` with a `label` for the user interface; it has no RAW, plan or request.

**Exposure convention: exposure-matched.** Each pixel's channels are the expected (noise-free) signal the
capture's own sensor would record at the capture's resolved exposure (f-number, shutter, ISO,
illuminance and lens transmission), from the facade's environment chain evaluated once per channel at the
optical axis with ideal optics. They are normalized like the RAW development, (code − black)/(white −
black) = e·d/(G·(W − B)) for a linear readout, clipped at white, and developed with the capture's own
white balance, camera → XYZ → sRGB matrices, highlight mode, tone curve and encoding. So a uniform patch
renders at the capture's mean level at any exposure (tests check within one 8-bit code across shutter,
ISO, f-number, pixel size, tone curve and a tungsten illuminant), and what differs between the two images
is the camera effects plus noise. A fixed mapping such as "reflectance → sRGB, 18 % → 118" was not
chosen: it would differ from the capture by the exposure itself, which is not a camera artefact, and an
over- or under-exposed capture would look wrong only because of the convention. The assumption
`reference.exposure` records the convention and the per-channel scale, `reference.excludes` the effects
left out and `reference.sampling` the pixel sampling.

**Pixel sampling** follows the request: each pixel samples the scene at its centre, like the default
point aperture, or with `sensor.pixelAperture: "box"` averages it over the photosite with the same N × N
midpoint rule. Formats: `srgb-8`, `srgb-16` and `png` (any colour encoding and gamut mapping); `dng`
(no RAW) and `jpeg` (compression artefacts) are refused, and so is `whiteBalance: "auto"` (the capture
measures it from its own noisy RAW; use `"scene-illuminant"` or a fixed setting for both).

It is deterministic and cheap: no RAW is simulated, a chart's materials are evaluated once, and each
pixel costs one material lookup per sample. Measured for a 768 × 512 composite chart with 18 elements
(Node 24, one core, one run): 0.44 s with point sampling and 1.61 s with the 4 × 4 box, against 49.3 s
for the default capture of the same request.

```ts
import { simulateIdealReference, simulateCapture, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 64, height: 48 }, lens: { diffraction: "circular-aperture" } };
const [capture, reference] = await Promise.all([simulateCapture(request), simulateIdealReference(request)]);
console.log(reference.kind, reference.label, capture.image.samples.length === reference.image.samples.length);
```

## Display view

`simulateDisplayView(options, view)` returns what the real full-resolution capture of `options` would look like
resized to `view.width` × `view.height`, at a cost that follows the display pixels. Pass the same request you use
for the export, with the real sensor's pixel count and pitch:

```ts
import { NATIVE_RAW_LIMITS, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, lens: { prime: 35, fNumber: 2.8 }, subjectDistanceM: 3,
  sensor: { pixelPitchMicrometers: 6 }, output: { width: 6000, height: 4000, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels } };
const preview = await simulateDisplayView(request, { width: 384, height: 256 });   // on screen
console.log(preview.kind, preview.label, preview.diagnostics.timingsMs.view);
// The export stays a real capture: simulateCapture(request), or tiles of it with output.region.
const crop = await simulateCapture({ ...request, output: { ...request.output, region: { x: 2968, y: 1968, width: 64, height: 64 } } });
console.log(crop.image.width);
```

**What each display pixel is.** The area-weighted mean, in linear light, of the real output pixels its rectangle covers
(6000 ÷ 384 = 15.625 real pixels per axis here), sRGB-encoded and rounded: area (box) resampling, the standard
reduction filter. Lens diffraction, the anti-aliasing filter and the pixel aperture act at the real 6 µm pitch; the
colour mosaic, demosaic and development are those of the real pixels; the noise is that of the average of the real
pixels, demosaic correlation included; exposure, white balance, tone curve and framing are the capture's (the same code
resolves them).

**How it is computed** (details and error analysis in [DISPLAY_VIEW.md](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md)):

- The expected value of each display pixel is a stratified Monte Carlo average over K × K real pixels of its rectangle
  (`view.samplesPerAxis`, default 16), seeded and unbiased. For each sampled pixel the expected electrons of the real
  sites its demosaic reads are exact, and the clips and tone curve act on the pixel's own noise distribution. A pilot
  grid gives uniform areas K/4 samples per axis; their error is zero anyway.
- The noise is one correlated normal draw per display pixel with the covariance of the area mean of the real pixels'
  independent site noises (shot, dark, read, ADC), including the demosaic's correlation.
- AHD is represented by its two linear candidates; where the noise is large enough for its homogeneity choice to shift
  the colour, a control-variate correction runs the engine's AHD steps on drawn noisy neighbourhoods.

Validated against real full-resolution captures resized in linear light: three sensors (12 MP phone, 24 MP full frame,
100 MP medium format), five charts, f/2.8–f/16, ISO 100–6400, 96–800 display pixels wide, Speed and Quality options (see
[Validation results](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#validation-results)).

**Cost.** Where a display pixel covers more than 25 real pixels, the cost follows the detailed display pixels ×
`samplesPerAxis`², not the real pixel count; at 25 or fewer (the exact area mean) it follows the real pixels the region
touches. A device-pixel view of a 24 MP frame, 2028 × 1352 in 96 × 96 parts from one prepared view, takes about 0.09 s
per part with the engine defaults and about 0.18 s with the Quality options (2.9.0, Node 24.21.0, one thread on a
4-vCPU 2.80 GHz Xeon; [the table](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#a-device-pixel-view-rendered-in-parts),
`node scripts/benchmark-display-view.mjs --app`). The table below is the 2.6.0 record of whole views against the
whole-frame view of the same request (Siemens star, f/8, ISO 100, one run, same host; every row, and the times before
the exact speed-ups, in [DISPLAY_VIEW.md](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#cost)):

| Sensor | Options | 96 wide | 384 wide | 800 wide |
| --- | --- | --- | --- | --- |
| 24 MP full frame, 6 µm | Speed (defaults) | 2.4 s (2.3×) | 10.6 s (0.92×) | 26.6 s (0.65×) |
| 12 MP phone, 1.4 µm | Speed | 2.2 s (2.4×) | 11.7 s (0.92×) | 32.1 s (0.59×) |
| 100 MP medium format, 3.76 µm | Speed | 2.7 s (2.3×) | 15.8 s (1.2×) | 32.6 s (0.66×) |
| 24 MP full frame | Quality (diffraction, four-spot filter, AHD) | 5.2 s (1.6×) | 30.9 s (1.3×) | 84.3 s (0.76×) |
| 12 MP phone | Quality | 49.7 s (20×) | 106 s (3.8×) | 272 s (2.2×) |
| 100 MP medium format | Quality | 18.2 s (3.7×) | 49.7 s (1.8×) | 126 s (1.0×) |

Quality costs more on small pixels. The diffraction kernel spans several real sites, and at 1.4 µm even ISO 100 is
noisy enough for the AHD correction to run on every sampled pixel; its correction states are kept for later views of
the same sensor, exposure and development in the same JavaScript realm (a second 384-wide phone view of the same
request took 73 s instead of 103 s). The results are byte-identical to those of the display view as first merged,
which took 222 s, 450 s and 837 s on the phone.

**Options.** `view.width` and `view.height` (1 to the capture's output size), `view.samplesPerAxis` (1–32),
`view.format` (`"srgb-8"` default or `"srgb-16"`) and `view.region` (a rectangle in display pixels, byte-identical to
the same pixels of the whole view, for tiling across workers). The capture's file-format options (`format`,
`colorEncoding`, `bitDepth`, `gamutMapping`, `jpegQuantizationStep`, `dng`, `metadata`) do not apply. The request must
be one `simulateCapture` accepts (a frame wider or taller than 4094 pixels needs `output.maximumPixels`, although the
view allocates nothing at full resolution).

**Many regions of one view (2.7).** Each `simulateDisplayView` call repeats the request's setup: the camera, lens,
scene and illuminant, the channel responses, the diffraction kernels and the colour tables. That is about 0.25 s with
the engine defaults and 0.7 s with the Quality options on a 24 MP request (measured before #443). The channel responses
do not depend on the scene and are kept across calls, so a call after a chart, illuminant or illuminance change costs
less than one after an aperture or shutter change: with the Quality options, about 30–50 ms after a chart, illuminant or
illuminance change and about 55–70 ms after an aperture or shutter change, against about 0.4 s for each before #443
(Node 24.21.0, one thread, prepares in one process after a warm-up). To render one view in many regions, prepare
the request once and render each region from it; each region then costs only its own pixels:

```ts
import { prepareDisplayView, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 600, height: 400 } };
const prepared = await prepareDisplayView(request);   // request errors are raised here
const tile = await prepared.render({ width: 300, height: 200, region: { x: 120, y: 80, width: 32, height: 32 } },
  { signal: AbortSignal.timeout(60_000) });            // cancels this render only
console.log(tile.image.width, tile.diagnostics.timingsMs.view);
```

`render(view)` returns what `simulateDisplayView(request, view)` returns, byte for byte (only `diagnostics.timingsMs`
differ, and they cover the render only). A second argument `{ gpu: "auto" | "require", gpuDevice }` (2.11, #481) asks for
the WebGPU renderer, with the CPU reference as the labelled fallback or as a failure; `diagnostics.fast.execution` names
what ran (see [Rendering on the GPU](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#rendering-on-the-gpu)). Renders may run concurrently and share only read-only setup. The request's own
`signal` applies to preparing; give each render its own. Keep one prepared view per request in each worker: measured on
a 24 MP request, an 8 × 8 region took 6–40 ms through a prepared view instead of 0.24–0.41 s as its own call (Speed).

**Not supported** (refused with an `InvalidConfigurationError`): `lens.pupilSampling`, `lens.projection`,
`lens.distortion`, `lens.vignetting`, `lens.psf`, camera rotation, `output.whiteBalance: "auto"`, the luminance tone
curves, `output.highlightMode: "reconstruct"` and `output.region` (use `view.region`). `lens.defocus` is rendered as a
site kernel in the expected signal (#492; see [Optics](#optics)). `onProgress` is not called; `signal` cancels.

The result is labelled `kind: "display-view"` with a `label` for the user interface; it has no RAW, plan or file, and
the `view.*` assumptions state the definition, the estimator, the noise model, the demosaic treatment and which capture
options were ignored. The whole-frame views of [Whole-frame views](#whole-frame-views-25) are unchanged.

## Not available

The facade offers no atmospheric haze or polarizer (see [Optics](#optics)), flash, video, HDR brackets
or processing operators. Those APIs are available directly. Real camera and lens presets are not
provided, for rights reasons.

## Sources

- Diffraction (`lens.diffraction`, `createDiffractionLimitedPsfProfile`): M. Born, E. Wolf,
  *Principles of Optics*, 7th (expanded) ed., Cambridge University Press, 1999,
  doi:10.1017/CBO9781139644181, §8.5.2 "The circular aperture" (Fraunhofer diffraction at a circular
  aperture: the Airy pattern and its dark rings); J. W. Goodman, *Introduction to Fourier Optics*,
  4th ed., W. H. Freeman, 2017, §4.4 (examples of Fraunhofer diffraction patterns, including the
  circular aperture) and §7.3 (frequency response for diffraction-limited incoherent imaging: the
  optical transfer function as the normalized pupil autocorrelation); J. C. Wyant, K. Creath, "Basic
  Wavefront Aberration Theory for Optical Metrology", *Applied Optics and Optical Engineering* XI,
  ch. 1, Academic Press, 1992, §II "Aberration-Free Image", eqs. 1–4, free author copy at
  <https://wp.optics.arizona.edu/jcwyant/wp-content/uploads/sites/13/2016/08/03-BasicAberrations_and_Optical_Testing.pdf>
  (the Airy irradiance at the effective f-number, the 2.44·λ·N Airy disk diameter and the encircled
  energy 1 − J₀² − J₁²); MIT OpenCourseWare 2.71 Optics (Spring 2009), lectures 21–22, free at
  <https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/> (the intensity PSF as the transform of the
  pupil autocorrelation and the circular-pupil MTF); F. W. J. Olver et al. (eds.), *NIST Digital
  Library of Mathematical Functions*, release 1.2.8 (2026-09-15), free at <https://dlmf.nist.gov/>,
  §10.6(i) (eqs. 10.6.2 and 10.6.3: J₀′ = −J₁ and J₁′ = J₀ − J₁/x, from which the encircled energy
  follows), eq. 10.17.3 and §10.17(iii) (Hankel's large-argument expansion of J₀ and J₁ and its error
  bound, used for cells much larger than the pattern) and eq. 10.9.2 (Bessel's integral, used as an
  independent test). The original analysis is G. B. Airy, "On the Diffraction of an Object-glass with
  Circular Aperture", *Transactions of the Cambridge Philosophical Society* 5, 1835, pp. 283–291. The
  engine's implementation and its tests are its own (see [PSF foundation](https://github.com/Photivra/photivra/blob/main/docs/PSF_FOUNDATION.md#diffraction-limited-sampled-profile-21)).
- Print planning (`calculatePrintPlan`, `calculatePrintSizeLimit`): Z. Alomar, K. D. Bojikian, "Visual Acuity
  Testing in Adults", EyeWiki, American Academy of Ophthalmology, last edited June 16, 2026, free to read at
  <https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults> (the minimum angle of resolution of an ideal eye under optimal
  conditions is about 1 minute of arc; 20/20 letters are built from 1-arcmin elements). One arcminute per pixel is normal
  (20/20) acuity under optimal conditions and an approximate rule of thumb: some viewers resolve finer detail and many
  coarser. The planner uses the criterion the caller declares.
- R. Palum, "Anti-Aliasing Filter Analysis for Digital Cameras", Proc. IS&T International Congress of
  Imaging Science (ICIS '06), 2006, free at
  <https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2006/ICIS-0-736/33683.pdf>
  (birefringent quartz four-spot filter; one pixel wide in each direction cuts off at Nyquist; its MTF
  is the modulus of a cosine that returns to one at the sampling frequency).
- CIPA DC-004-Translation-2020, *Sensitivity of Digital Cameras*, free at
  <https://www.cipa.jp/e/std/std-sec.html> (standard output sensitivity S = 10/H, §3.2; reference
  level tied to 18 % grey, §5.2 and Explanation 1, 2.2; focal-plane exposure H = 0.65·L·t/N², §5.5
  and Explanation 4).
- F. Cao, F. Guichard, H. Hornung, "Dead leaves model for measuring texture quality on a digital
  camera", Proc. SPIE 7537, Digital Photography VI, 2010; A. B. Lee, D. Mumford, J. Huang, "Occlusion
  models for natural images", *International Journal of Computer Vision* 41, 2001 (the dead-leaves
  model and its r⁻³ radius law); W. S. Kendall, E. Thönnes, "Perfect simulation in stochastic geometry",
  *Pattern Recognition* 32(9), 1999 (drawing the leaves front to back until covered). The engine's
  implementation and parameters are its own.
- USAF-1951 resolution target (MIL-STD-150A, a US-government publication) for the
  three-bar group concept; the engine's arrangement, frequencies and numerals are its own. J. W. Goodman,
  *Introduction to Fourier Optics*, 4th ed., 2017 (Fresnel zone plate, a quadratic-phase chirp).
- P. D. Burns, "Slanted-Edge MTF for Digital Camera and Scanner Analysis", Proc. IS&T PICS 2000,
  free at <https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2000/PICS-0-81/1621.pdf>
  (slanted-edge geometry; also ISO 12233:2017).
- BIPM, *The International System of Units*, 9th ed. (2019), free at
  <https://www.bipm.org/en/publications/si-brochure> (K_cd = 683 lm/W, the definition of the candela).
- BIPM, *Mise en pratique for the definition of the kelvin*, Absolute Primary Radiometry (2018),
  Eq. (1), free at <https://www.bipm.org/utils/en/pdf/si-mep/MeP-K-2018_Absolute_Primary_Radiometry.pdf>
  (Planck's law, used for the Planckian and illuminant A spectra). Illuminant A's defining constants
  and the daylight polynomial come from CIE 015:2018 (paid); computed values are checked against the
  free CIE datasets at <https://cie.co.at/data-tables> (see [Colorimetry](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md)).
- C. Wyman, P.-P. Sloan, P. Shirley, "Simple analytic approximations to the CIE XYZ color matching
  functions", *Journal of Computer Graphics Techniques* 2(2), 2013 (the piecewise-Gaussian model form;
  the engine fits its own coefficients to the CIE 1931 data, see Colorimetry).
- R. Luther, "Aus dem Gebiet der Farbreizmetrik", *Zeitschrift für technische Physik* 8, 1927
  (the Luther condition for colorimetric cameras).
- W3C CSS Color Module Level 4 (`srgb` and `display-p3`; RGB↔XYZ matrices from primaries and white),
  free at <https://www.w3.org/TR/css-color-4/>; ITU-R BT.709-6 and BT.2020-2 (primaries and luminance
  coefficients), free at <https://www.itu.int/rec/R-REC-BT>; ITU-T H.273 (cICP code points); W3C PNG Specification, Third
  Edition (2025).
- Text metadata (2.4), all free: ITU-T T.81 (1992) | ISO/IEC 10918-1, §B.2.4.5 comment segment, at
  <https://www.w3.org/Graphics/JPEG/itu-t81.pdf>; Adobe XMP Specification Part 1 (2012, the text of
  ISO 16684-1:2011) §7.4, §8.3, §8.4, Part 2 (2022) §3.4 and Part 3 (2020) §1.1.3, §1.1.6, §3.2.3, at
  <https://github.com/adobe/XMP-Toolkit-SDK/tree/main/docs>; W3C PNG Specification, Third Edition (2025)
  §11.3.3 and §12.9, at <https://www.w3.org/TR/png-3/>; TIFF Revision 6.0 (1992) §2.
- Adobe DNG Specification 1.7.1.0 (2023); W3C CSS Color Module Level 4 §14 (free). Also see: J. Morovič,
  *Color Gamut Mapping*, Wiley 2008, §10.
- K. Miyamoto, "Fish eye lens", *JOSA* 54, 1964; J. Kannala, S. Brandt, *IEEE TPAMI* 28, 2006
  (projections); A. E. Conrady, *MNRAS* 79, 1919; D. C. Brown, *Photogrammetric Engineering* 32, 1966
  (distortion).
- A. El Gamal, H. Eltoukhy, "CMOS image sensors", *IEEE Circuits and Devices Magazine* 21(3), 2005;
  C.-K. Liang, L.-W. Chang, H. H. Chen, "Analysis and compensation of rolling shutter effect",
  *IEEE TIP* 17(8), 2008 (rolling-shutter line timing).
