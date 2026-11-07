# Usage Guide

Release context (dated historical note): this guide was written for the **package 1.2.0 candidate / root API 1.2.0** and has not been re-reviewed for later releases; see the [changelog](../CHANGELOG.md) for the current release. Subsystem and model versions, and dated introduction or measurement records below, are independent historical identities. They are not distribution versions. See [developer navigation](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md) and the [release contract](https://github.com/Photivra/photivra/blob/main/docs/RELEASE_1_2_0.md).

New to the engine? Start with [`simulateCapture()`](#simulate-a-capture-with-the-facade). It builds
and runs a complete capture from a few options. The [Quick Start](QUICK_START.md) explains it in full.

This guide shows how to call the capabilities exported by the root `@photivra/engine` package.

Related guides for later pipeline stages:

- **Charge, noise and ADC to native RAW:** see [Sensor RAW producer](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_RAW_PRODUCER.md).
  It generates RAW within stated limits for one capture. The upstream EQE and dark-exposure results stay
  as declared inputs. The returned frame can feed the photographic exporter, which writes DNG and JPEG from the same RAW.
- **Committed capture → correction → SDR output:** see [Capture-bound corrected SDR](https://github.com/Photivra/photivra/blob/main/docs/CAPTURE_CORRECTED_SDR.md).
  It returns a derived output view without changing the physical capture geometry or turning on production stages.
- **Paired DNG/JPEG byte export from the same RAW:** see [Photographic export](https://github.com/Photivra/photivra/blob/main/docs/PHOTOGRAPHIC_EXPORT.md).
  It needs an explicit, approximate sensor-colour profile. Bounded external acceptance, and the limits of that evidence, are recorded in [Export acceptance](https://github.com/Photivra/photivra/blob/main/docs/EXPORT_ACCEPTANCE.md).

Common abbreviations: FOV (field of view), PSF (point-spread function — how a lens spreads one point of light), CFA (colour filter array, such as a Bayer mosaic), QE/EQE (quantum efficiency / external quantum efficiency), ADC (analog-to-digital converter), AE/AF/WB (auto-exposure / autofocus / white balance), SDR (standard dynamic range).

The package is ESM. CommonJS code on Node 22.12 or later can also `require()` it. Primitive scientific calculations usually return a `CalculationResult<T>`:

```ts
const result = calculateSomething(input);

console.log(result.value);
console.log(result.provenance);
console.log(result.quality);
```

`quality` is optional. It is left out when the engine has no defensible, quantified uncertainty or accuracy to report.

From 2.0.0 results are read-only: the envelope, `provenance` and `quality` are frozen, and so is the top level of `value`. Copy a value (`{ ...result.value }`) before changing it. Every calculator that takes an input object rejects unknown fields with `InvalidConfigurationError`. A wrong shape throws `InvalidConfigurationError` and a bad number throws `InvalidScientificInputError`; see [Error classes](https://github.com/Photivra/photivra/blob/main/docs/API_STYLE.md#error-classes) and [Read-only results](https://github.com/Photivra/photivra/blob/main/docs/API_STYLE.md#read-only-results).

## Standalone digital optics

See [Digital optics foundations](https://github.com/Photivra/photivra/blob/main/docs/DIGITAL_OPTICS_FOUNDATION.md) for stray-light and correction profiles tied to an exact lens state, and for their scientific limits. You can prepare a compatible geometric map separately from its sampling filter:

```ts
import {
  prepareGeometricMapping,
  calculateGeometricSamplingPlan,
  calculateGeometricResampling
} from "@photivra/engine";

const mapping = prepareGeometricMapping({
  frameTimeSeconds: 0,
  transforms: [{
    id: "declared-breathing-compensation",
    version: "1",
    kind: "affine",
    domain: "reconstructed-linear",
    purpose: "breathing",
    matrix: [0.9, 0, 0, 0.9],
    offsetMm: { x: 0, y: 0 }
  }]
}).value;
const raster = {
  width: 5, height: 5, pitchMm: 1, centerMm: { x: 0, y: 0 }
};
const plan = calculateGeometricSamplingPlan({
  mapping, sourceRaster: raster, destinationRaster: raster,
  physicalProjectionDistanceMm: 50,
  resampler: { id: "bilinear-no-compression", version: "1",
    filter: "bilinear", antialias: "none" }
}).value;
const warped = calculateGeometricResampling({
  plan, sourceSamples: Array<number>(25).fill(1)
}).value;
// warped.samples contains null wherever source support is unavailable.
// plan.jointCrop and validSourceMask preserve the actual support.
```

This warps samples that were already captured. It does not recalculate the physical lens PSF or regenerate noise.

- Compression (shrinking) needs source data that was explicitly prefiltered.
- Incompatible domains need separate stages.
- Stray light is different: it adds to the incident spectral irradiance before the sensor.
- A correction intended for RAW-like data can stay as metadata only.

## Image-formation ownership

Use the public image-formation contract when coordinating effects that cross optics, motion, sensor, and output domains:

```ts
import { getImageFormationContract } from "@photivra/engine";

const contract = getImageFormationContract();

console.log(contract.domains);
console.log(contract.temporal.authoritativeTimeUnit);
console.log(
  contract.effectPlacements.find(
    (effect) => effect.id === "mechanical-vignetting"
  )
);
```

The contract is descriptive metadata. It does not mean every reserved stage is implemented, and it does not change the composed POC (proof-of-concept) request/response contract.

- `requiredUpstreamStages` lists hard scientific dependencies.
- `coupledStages` lists shared state and interactions. Do not treat coupled stages as independent renderer filters.

See [Image-Formation Contract](https://github.com/Photivra/photivra/blob/main/docs/IMAGE_FORMATION.md) for coordinate, temporal, renderer, and reserved sensor-stage semantics.

## Ideal regular-polygon diffraction

```ts
import { calculateIdealPolygonDiffractionPsf } from "@photivra/engine";

const polygon = calculateIdealPolygonDiffractionPsf({
  bladeCount: 7,
  firstBladeEdgeAngleDegrees: 0,
  equivalentAreaPupilDiameterMm: 10,
  pupilToImageDistanceMm: 50,
  wavelengthNm: 550,
  wavelengthBasis: "air",
  imagePointsMicrometers: [{ x: 0, y: 0 }, { x: 3, y: -2 }]
});
console.log(polygon.value.samples[0]?.intensityDensityPerSquareMicrometer);
```

This is a scalar approximation: uniform amplitude, zero phase, on-axis and in focus.

- The equal-area diameter is not the polygon's circumdiameter.
- Image points are displacements within the PSF (+X right / +Y up), not positions in the source field.
- The density integrates to one over the **infinite** plane. The samples you request do not sum to one.
- Integrating over a finite image area (quadrature) needs explicit area measures, support and convergence checks.
- Nothing is inferred: no air/vacuum conversion, clipping, aberration, throughput or sensor response.
- The circular Airy diagnostic and the real-lens kernels (which already include diffraction) are separate. Do not apply diffraction twice.

## Explicit finite and infinity focus state

Use `FocusPlane` when you must tell a real finite focus plane apart from optical infinity, without using JavaScript `Infinity` or an arbitrary very large distance.

```ts
import {
  calculateFocusPlaneImageDistance,
  parseFocusPlane
} from "@photivra/engine";

const finite = parseFocusPlane({
  kind: "finite",
  distanceM: 5
});

const infinity = parseFocusPlane({
  kind: "infinity"
});

const projection = calculateFocusPlaneImageDistance({
  focalLengthMm: 50,
  focus: infinity
});

console.log(projection.value.imageDistanceMm); // 50
console.log(projection.value.infinityProjectionScale); // 1
```

For finite focus, `distanceM` is the **distance of the object plane along the camera's optical axis, measured from the ideal lens principal plane**. It is not the straight-line ray length. A renderer or raycaster must not pass the raw Euclidean ray length for an off-axis hit. In the current paraxial model, points on the same plane facing the camera (fronto-parallel) resolve to the same finite focus distance.

- The finite branch uses the existing Gaussian thin-lens calculation, so existing finite-focus numbers and provenance are unchanged.
- The infinity branch resolves exactly to the nominal focal length, with zero limiting magnification.
- Missing or unknown focus is never treated as infinity. Supply it explicitly as `{ kind: "finite", distanceM }` or `{ kind: "infinity" }`.

Existing APIs that take `focusDistanceM` are still supported. This tagged contract is additive. It is meant for newer composition and control paths that need an explicit infinity state.

## Focus control: MF, single AF, continuous AF, and lock

The focus-control layer (#104) sits on top of the optical `FocusPlane` contract described above (#103). (MF = manual focus, AF = autofocus.)

It keeps three things separate:

1. **target observation** — which scene surface or environment target was measured, and its distance along the camera axis;
2. **focus-control policy** — manual, single AF, continuous AF, or locked;
3. **resolved optical focus** — the finite or infinity `FocusPlane` passed on to the optics.

Use a generic profile:

Composition fragment: requires previously validated bindings `evidence`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createFocusControlState,
  parseFocusControlProfile,
  resolveFocusTargetObservation
} from "@photivra/engine";

const profile =
  parseFocusControlProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-focus",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    supportedModes: [
      "manual",
      "single-af",
      "continuous-af"
    ],
    actuator: {
      kind: "ideal-instantaneous",
      evidence
    },
    continuousTargetLossPolicy:
      "hold-last-focus-require-explicit-reacquisition",
    supportedReleasePriorities: [
      "focus-priority",
      "release-priority",
      "balanced"
    ],
    evidence,
    limitations: [
      "Generic deterministic focus-control approximation."
    ]
  });

const afc =
  createFocusControlState({
    stateId: "focus-0",
    profile,
    mode: "continuous-af",
    initialFocus: {
      kind: "finite",
      distanceM: 5
    }
  });

const acquired =
  resolveFocusTargetObservation({
    state: afc,
    stateId: "focus-1",
    event: "acquire",
    observation: {
      kind: "finite-surface",
      targetId: "subject-42",
      focusAreaId: "selected-area",
      observedAtSeconds: 0.5,
      longitudinalDistanceM: 3
    }
  });
```

Target observations contain no screen or canvas coordinates. `focusAreaId` is an opaque selection ID that does not depend on the application or renderer. A finite target distance is the `FocusPlane` **distance along the camera axis (the conjugate distance)**, not the Euclidean ray length.

### Manual focus

`setManualFocusState()` changes an explicit finite/infinity focus state only when the active mode is `manual`.

No universal focus-ring scale or lens-specific stepping curve is invented. The caller supplies the next explicit `FocusPlane` state. Future equipment profiles may map real focus-ring or actuator behaviour onto that same contract.

MF does not automatically consume autofocus target observations.

### Single AF

A `single-af` `acquire` event resolves the target once and then holds that focus plane.

Later `update` observations do not follow subject motion. If the subject moves after acquisition, its depth changes while the focus plane stays fixed, so the defocus calculated downstream changes.

An unavailable target during acquisition produces explicit `target-lost` state without moving focus.

### Continuous AF

`continuous-af` requires an explicit initial `acquire` event.

After that, `update` events may move focus only for the same active `targetId`. A different target cannot silently replace the subject.

The first actuator is:

`ideal-instantaneous`

This is a declared approximation that uses the known simulation geometry. It does **not** claim realistic AF motor speed, phase or contrast detection, hunting, subject recognition, low-light failure, or the tracking behaviour of any commercial camera.

When the target becomes unavailable, the first policy is:

`hold-last-focus-require-explicit-reacquisition`

Focus is held, state becomes `target-lost`, and an ordinary update cannot silently reacquire. A new explicit `acquire` event is required.

### Focus lock

`setFocusLock()` freezes the resolved focus plane. It keeps the active mode and the acquisition state, so they can resume later.

Target updates while locked do not change focus. Unlocking restores the previous acquisition state; a later continuous-AF update may then move focus again.

Focus lock does not engage AE lock, move a metering spot, change WB, or change aperture, shutter or ISO.

### Focus vs release priority

Use `assessFocusReleaseGate()` to decide whether the shutter may release, as input to [release sequencing](#logical-release-sequences) (#105).

- `focus-priority` allows release for manual focus, acquired AF or locked focus, and blocks otherwise.
- `release-priority` allows release without changing focus.
- `balanced` is reserved. In schema 0.1.0 it fails closed (blocks) until a specific balanced policy is defined.

The gate never changes the optical focus calculation or the exposure state.

The acquisition-state type also reserves `acquiring` for future actuator models that take time. The current ideal actuator moves an available acquisition straight to `acquired`.

## Field of view

Use `calculateFieldOfView()` for one sensor dimension at a time.

```ts
import { calculateFieldOfView } from "@photivra/engine";

const horizontal = calculateFieldOfView({
  focalLengthMm: 50,
  sensorDimensionMm: 36
});

console.log(horizontal.value.degrees);
```

To use the ideal thin-lens sensor plane at a selected focus distance, provide `focusDistanceM`:

```ts
const focused = calculateFieldOfView({
  focalLengthMm: 200,
  sensorDimensionMm: 36,
  focusDistanceM: 22
});

console.log(focused.value.projectionDistanceMm);
console.log(focused.value.degrees);
```

Without `focusDistanceM`, the nominal focal length is used as the projection distance (infinity focus, like a pinhole). Neither mode models real-lens distortion or focus breathing.

For off-center sensor regions, use `calculateFieldOfViewBounds()` with signed sensor-plane coordinates relative to the optical axis:

```ts
import { calculateFieldOfViewBounds } from "@photivra/engine";

const leftHalf = calculateFieldOfViewBounds({
  focalLengthMm: 50,
  minimumSensorCoordinateMm: -18,
  maximumSensorCoordinateMm: 0
});

console.log(leftHalf.value.minimumDegrees);
console.log(leftHalf.value.maximumDegrees);
console.log(leftHalf.value.degrees);
```

Unlike the centered `2 × atan(size / 2d)` form, the bounds API keeps asymmetric angular limits. Active-capture geometry uses it for off-center crops.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#rectilinear-field-of-view).

## Actual and 35 mm-equivalent focal length

Use `calculateEquivalentFocalLength35Mm()` when you need the conventional 35 mm-equivalent value (based on the diagonal), while keeping the physical optical focal length:

```ts
import { calculateEquivalentFocalLength35Mm } from "@photivra/engine";

const equivalent = calculateEquivalentFocalLength35Mm({
  focalLengthMm: 4.5,
  activeImagingArea: {
    widthMm: 6.17,
    heightMm: 4.55
  }
});

console.log(equivalent.value.actualFocalLengthMm); // 4.5
console.log(equivalent.value.equivalentFocalLength35Mm);
console.log(equivalent.value.basis); // "diagonal"
```

The actual focal length stays the physical optical quantity used by projection and depth-of-field calculations. The equivalent value comes from the diagonal of the active physical capture area, compared with a 36 × 24 mm reference frame.

- If an active sensor crop is in use, pass the physical active area resolved by `resolveCaptureGeometry()`.
- Physical camera orientation does not change the equivalent value, because the active diagonal does not change.
- Focus distance is not part of conventional 35 mm-equivalent focal length. A later digital/output crop and the output resolution are also excluded.
- If a product wants to describe the final digital framing, it should label it as output framing. It should not silently replace the optical focal length or the capture-equivalent focal length.

`calculateImagingAreaMetrics()` provides the same canonical diagonal crop-factor calculation, independent of raster density, so other engine modules do not need to repeat that formula.

## Focus-breathing projection

Focus breathing is the change in framing that some lenses show when focus changes. Use `calculateFocusBreathingProjection()` when you have an explicit projection-scale value for the selected focus state.

```ts
import {
  calculateFocusBreathingFieldOfView,
  calculateFocusBreathingProjection
} from "@photivra/engine";

const projection = calculateFocusBreathingProjection({
  focalLengthMm: 50,
  focusDistanceM: 1.5,
  breathingProjectionScale: 1.04
});

const horizontalFov = calculateFocusBreathingFieldOfView({
  focalLengthMm: 50,
  focusDistanceM: 1.5,
  sensorDimensionMm: 36,
  breathingProjectionScale: 1.04
});

console.log(projection.value.physicalFocalLengthMm); // still 50
console.log(projection.value.effectiveProjectionDistanceMm);
console.log(horizontalFov.value.effectiveDegrees);
```

`breathingProjectionScale` is dimensionless and applies to the ideal thin-lens projection distance for that one focus state:

- `1` means no additional breathing relative to the current thin-lens model;
- values above `1` narrow framing / increase magnification;
- values below `1` widen framing / reduce magnification.

Photivra does **not** infer this scale from focal length, focus distance, lens identity, sensor format or marketing specifications. If you supply the same scale at two focus distances, that is exactly what you get: the same relative projection scale at both states.

The physical focal length stays authoritative. The effective projection distance is not a renamed focal length, and a later digital/output crop does not change the breathing scale.

This generic model is returned as an `approximation`. A future calibrated lens profile would need defensible provenance, reuse rights, and uncertainty and limitation metadata.

## Oriented raster to image-plane coordinates

Use this coordinate bridge before a renderer working in oriented/output coordinates calls
an image-plane lens or camera-mapping API. The two sides use different conventions:

- the capture/output physical region uses a raster-style basis, +Y down;
- lens-field APIs use the optical image plane before orientation, +Y up.

```ts
import {
  mapImagePlanePointToOrientedPhysicalUv,
  mapOrientedPhysicalUvToImagePlanePoint
} from "@photivra/engine";

const bounds = { left: -12, right: 12, top: -18, bottom: 18 };

const destination = mapOrientedPhysicalUvToImagePlanePoint({
  uv: { u: 0.25, v: 0.75 },
  orientedPhysicalBoundsFromOpticalAxisMm: bounds,
  orientation: "portrait-clockwise"
});

const roundTrip = mapImagePlanePointToOrientedPhysicalUv({
  imagePlanePointMm: destination,
  orientedPhysicalBoundsFromOpticalAxisMm: bounds,
  orientation: "portrait-clockwise"
});
```

These functions only change the coordinate basis. They do not apply projection,
distortion, focus breathing, crop or resampling. Asymmetric or off-axis physical
bounds are kept as they are, not recentered. The reverse mapping fails closed
when the image-plane point lies outside the supplied physical region.

## Radial lens-distortion mapping

Two functions cover generic, rotationally symmetric distortion:

- `calculateRadialDistortionMapping()` maps an ideal image-plane point to its distorted position.
- `calculateInverseRadialDistortionMapping()` goes the other way, from destination to source. This is what a renderer needs for inverse sampling.

```ts
import {
  calculateInverseRadialDistortionMapping,
  calculateRadialDistortionMapping
} from "@photivra/engine";

const profile = {
  normalizationRadiusMm: 21.63,
  maximumNormalizedRadius: 1,
  coefficients: {
    k1: -0.08,
    k2: 0.025,
    k3: -0.004
  }
};

const forward = calculateRadialDistortionMapping({
  imagePointMm: { x: 14, y: 8 },
  profile
});

const inverse = calculateInverseRadialDistortionMapping({
  distortedImagePointMm: forward.value.mappedImagePointMm,
  profile
});

console.log(forward.value.radialScale);
console.log(inverse.value.sourceImagePointMm);
```

The model is:

```text
r = image-plane radius / normalizationRadiusMm
scale = 1 + k1 r² + k2 r⁴ + k3 r⁶
p_distorted = p_ideal × scale
```

The coefficients are dimensionless **only together with the declared physical normalization radius**. Reusing the coefficients with a different normalization radius gives a different model.

`maximumNormalizedRadius` is the valid operating range you declare.

- Photivra checks analytically that the radial distance stays strictly monotonic over that range, including cases where higher-order coefficients make it nearly linear.
- Profiles that fold back on themselves are rejected, so the inverse mapping is unique.
- Derived normalized radii must stay finite.
- Malformed point or batch inputs fail closed before they reach the inverse solver.

This first field mapping is radial only and centered on the optical axis. It does not model tangential/decentered distortion, anamorphic mapping, wavelength dependence or a calibrated named lens.

The engine returns an `approximation`, because the polynomial is a generic lens model with caller-chosen parameters. A test-fixture grid or fiducials can provide regression evidence for a renderer, but they do not calibrate real-lens coefficients.

## Lateral chromatic-aberration mapping

Lateral chromatic aberration (CA) is the sideways colour fringing caused by red, green and blue light landing at slightly different image positions. Use `calculateLateralChromaticAberrationMapping()` to map one ideal image-plane point through a shared **base distortion, referenced to green**, plus radial coefficient offsets for red and blue.

Use `calculateInverseLateralChromaticAberrationMapping()` when a renderer needs the ideal source coordinate for each output channel at one distorted destination.

```ts
import {
  calculateInverseLateralChromaticAberrationMapping,
  calculateLateralChromaticAberrationMapping
} from "@photivra/engine";

const profile = {
  normalizationRadiusMm: 21.63,
  maximumNormalizedRadius: 1,
  baseDistortionCoefficients: {
    k1: -0.06,
    k2: 0.018,
    k3: 0
  },
  redCoefficientOffset: {
    k1: 0.02,
    k2: -0.006,
    k3: 0
  },
  blueCoefficientOffset: {
    k1: -0.02,
    k2: 0.006,
    k3: 0
  }
};

const forward = calculateLateralChromaticAberrationMapping({
  imagePointMm: { x: 14, y: 8 },
  profile
});

const inverse = calculateInverseLateralChromaticAberrationMapping({
  distortedImagePointMm: { x: 14, y: 8 },
  profile
});

console.log(forward.value.separation);
console.log(inverse.value.channels.red.sourceImagePointMm);
console.log(inverse.value.channels.green.sourceImagePointMm);
console.log(inverse.value.channels.blue.sourceImagePointMm);
```

This is **field mapping, not a blur kernel**.

The green channel carries the common base geometric distortion. Red and blue offsets are added to that base before mapping. So:

- zero red/blue offsets mean no lateral CA, though base distortion can still exist;
- do not apply the same base distortion again as a second renderer warp;
- all three combined channel profiles share one physical normalization radius and operating range;
- each combined channel profile must be invertible on its own over that range.

The channel labels stand for renderer RGB channels. They are not wavelength samples, a spectral lens model, sensor CFA primaries or a camera colour profile. Longitudinal chromatic aberration and wavelength-dependent PSF behaviour are separate future work.

A renderer should inverse-map each destination channel to the source coordinate the engine returns. It should not add its own RGB offset or blur fringes onto the finished image.

For renderer grids or other multi-point evaluation, use the batch inverse APIs. The profile is
then validated once, with one provenance record, for the whole point set:

Composition fragment: requires previously validated bindings `caProfile`, `points`, `radialProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  calculateInverseLateralChromaticAberrationMappings,
  calculateInverseRadialDistortionMappings
} from "@photivra/engine";

const radialGrid = calculateInverseRadialDistortionMappings({
  distortedImagePointsMm: points,
  profile: radialProfile
});

const caGrid = calculateInverseLateralChromaticAberrationMappings({
  distortedImagePointsMm: points,
  profile: caProfile
});
```

Each value in a batch matches what the single-point inverse API returns. Batching only
avoids repeated validation and allocation. It does not change the lens model, operating
range, coordinate basis or numerical solver.

## Illumination vignetting

Vignetting is the darkening towards the edges of the frame. Use `calculateIlluminationVignetting()` when a generic virtual lens needs a **relative linear throughput** that varies across the field, without changing geometry or the pupil/PSF shape.

```ts
import { calculateIlluminationVignetting } from "@photivra/engine";

const illumination = calculateIlluminationVignetting({
  imagePointMm: { x: 16, y: 0 },
  profile: {
    normalizationRadiusMm: 20,
    maximumNormalizedRadius: 1,
    coefficients: {
      r2: -0.5,
      r4: 0.1,
      r6: 0
    }
  }
});

console.log(illumination.value.linearThroughputFactor);
console.log(illumination.value.attenuationStops);
```

The generic radial model is:

```text
rho = image-plane radius / normalizationRadiusMm
T(rho) = 1 + r2*rho² + r4*rho⁴ + r6*rho⁶
```

`T` is a throughput factor that multiplies **linear** scene light, per channel. Apply it before display transfer or gamma encoding.

The profile declares `maximumNormalizedRadius`. Photivra checks the whole range analytically, including interior minima and maxima, and rejects profiles that:

- reach zero or negative throughput; or
- amplify above the optical-axis normalization of `1`.

The output also reports positive attenuation in stops:

```text
attenuationStops = -log2(T)
```

This model changes throughput only. It does not change:

- image-plane coordinates;
- focus;
- pupil shape;
- PSF shape;
- bokeh;
- channel geometry.

Mechanical/pupil vignetting and cat's-eye bokeh belong to the later pupil/PSF foundation. This generic profile is not calibrated radiometry, and not a measurement of a named lens.

## Production image-formation plan

The production composition API is separate from `simulatePocCamera()`. It works in three steps: prepare static context, commit one capture, then create the plan.

Prepare static context once:

Composition fragment: requires previously validated bindings `equipmentCapabilities`, `opticalBridgeProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  prepareImageFormationContext
} from "@photivra/engine";

const prepared =
  prepareImageFormationContext({
    contextId: "scene-a:camera-a",
    sceneId: "scene-a",
    sceneRadianceProviderProfileId:
      "radiance-provider-a",
    outputGeometryProfileId:
      "output-geometry-a",
    equipmentCapabilities,
    opticalBridgeProfile,
    renderer: {
      schemaVersion: "0.1.0",
      rendererId: "webgpu-preview",
      rendererVersion: "1.0.0",
      consumerKind:
        "interactive-optimized",
      supportedStages: [
        "scene-ray-projection",
        "scene-radiance-evaluation",
        "lens-field-pupil-evaluation"
      ],
      supportedEffects: [
        "illumination-vignetting"
      ],
      spectralCapability:
        "wavelength-resolved",
      temporalSampling: {
        kind: "bounded",
        maximumSamples: 8
      },
      depthCapability: "per-layer",
      inverseFieldMapping: true,
      alphaRepresentation:
        "premultiplied",
      preservesDepthOrderAcrossWarps:
        true,
      sensorDomainProcessing:
        false
    },
    fidelity: {
      schemaVersion: "0.1.0",
      profileId:
        "physical-optics-sample",
      profileVersion: "1.0.0",
      requiredStages: [
        "lens-field-pupil-evaluation"
      ],
      requiredEffects: [
        {
          effectId:
            "illumination-vignetting",
          modelId:
            "generic-vignetting",
          modelVersion: "1.0.0"
        }
      ],
      rendererRequirements: {
        spectral:
          "wavelength-resolved",
        sensorDomainProcessing:
          false,
        depth: "none"
      }
    }
  });
```

Then commit one immutable capture snapshot:

Composition fragment: requires previously validated bindings `sceneRadianceRequest`, `sceneRadianceResult`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createProductionCaptureSnapshot
} from "@photivra/engine";

const capture =
  createProductionCaptureSnapshot({
    captureId: "capture-42",
    releaseFrameId: "frame-42",
    sceneStateId:
      "scene-state-42",
    sceneTimeSecondsFromExposureStart:
      0.01,
    outputStateId:
      "output-geometry-a",
    exposure: {
      aperture: 4,
      shutterSeconds: 1 / 125,
      iso: 100
    },
    stochasticSeedUint32:
      123456,
    physicalSceneSample: {
      sceneRadianceRequest,
      sceneRadianceResult,
      focus: {
        kind: "infinity-focus"
      },
      imagePointMm: {
        x: 0,
        y: 0
      },
      fieldThroughput: {
        kind: "unity"
      }
    }
  });
```

### Capture directly from a resolved release frame

When [release sequencing](#logical-release-sequences) has already resolved a logical frame, use this dedicated handoff instead of copying exposure and seed values by hand:

Composition fragment: requires previously validated bindings `lockedWhiteBalance`, `physicalSceneSample`, `sequence`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createProductionCaptureSnapshotFromReleaseFrame
} from "@photivra/engine";

const capture =
  createProductionCaptureSnapshotFromReleaseFrame({
    captureId: "capture-42",
    sceneStateId: "scene-state-42",
    sceneTimeSecondsFromExposureStart: 0.01,
    outputStateId: "output-geometry-a",
    releaseFrame: sequence.frames[0],
    whiteBalanceState: lockedWhiteBalance,
    physicalSceneSample
  });
```

The helper binds the release frame's exposure, focus, automation policy, timing, release identity and random seed. If the frame names a WB state, the complete committed [white-balance state](#white-balance-and-auto-wb) must match that ID. Both are frozen into the capture fingerprint and later shown in `plan.captureIdentity`.

Finally create the semantic plan:

Composition fragment: requires previously validated bindings `capture`, `prepared`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createProductionImageFormationPlan
} from "@photivra/engine";

const plan =
  createProductionImageFormationPlan({
    preparedContext: prepared,
    captureSnapshot: capture
  });
```

### Dependency expansion

If fidelity requires:

```text
lens-field-pupil-evaluation
```

the planner expands the authoritative graph to include:

```text
scene-ray-projection
  -> scene-radiance-evaluation
  -> lens-field-pupil-evaluation
```

The order comes from `getImageFormationContract()`. The planner keeps no second stage list of its own.

### Explicit stage/effect state

Every stage/effect is visible as one of:

- `active`;
- `modeled-zero`;
- `omitted-by-fidelity`;
- `unsupported`;
- `blocked`.

For example, a unity illumination throughput stays visible as an explicitly modelled zero-loss vignetting effect, instead of disappearing from provenance.

### Structured blockers

A request that is structurally valid but scientifically incomplete returns a blocked plan.

Examples:

- a required stage is not composed yet;
- the renderer lacks a required stage or effect capability;
- the renderer lacks wavelength, depth or sensor-domain fidelity;
- the optical profile for the [scene-radiance-to-sensor bridge](#scene-radiance-to-sensor-irradiance) is missing;
- the physical scene sample is missing;
- that bridge fails a wavelength or applicability check.

Malformed configuration, invalid selected camera settings, identity drift and tampered fingerprints still fail fast (throw).

### Deterministic identity

Prepared contexts, capture snapshots and finished plans carry deterministic fingerprints produced from canonical JSON.

The algorithm is explicitly:

```text
fnv1a-32-non-cryptographic
```

This is a reproducibility key. It is not a security or integrity checksum.

Use:

```ts
serializeProductionImageFormationPlan(
  plan
)
```

when a canonical deterministic serialization is needed.

### Temporal capture input

A production capture snapshot may include authoritative timing and readout state:

```ts
const capture =
  createProductionCaptureSnapshot({
    ...captureInput,
    temporalCapture: {
      exposureWindowInput: {
        nativeRaster,
        shutterMechanism: "electronic",
        nominalExposureDurationSeconds: {
          value: 1 / 125,
          unit: "s",
          evidence
        },
        opening: {
          kind: "simultaneous"
        },
        closing: {
          kind: "simultaneous"
        },
        samplePointsNative
      },
      imagingArea,
      orientation: "landscape",
      readout: {
        readoutMode: "rolling",
        captureReadoutDurationSeconds,
        scanDirectionNative,
        spatialSamplingSkewSeconds
      },
      rotation: {
        angularVelocityRadPerSec: {
          pitch: 0,
          yaw: 0.1,
          roll: 0
        },
        temporalSampleCount: 8
      }
    }
  });
```

The temporal nominal duration must match the committed shutter duration.

The plan may then expose:

- `exposureWindows`;
- optional `sensorReadoutTiming`;
- optional `rotationQuadrature`.

Sensor readout is never silently synchronized to exposure boundaries.

If the requested temporal quadrature (time sampling) has more nodes than the renderer says it can handle, the plan reports `renderer-temporal-sampling-insufficient`. It does not change the committed quadrature.

A zero rotation model and global readout stay visible as explicit `modeled-zero` effects.

### Consumer manifests

After finalizing a plan:

```ts
const optimized =
  createProductionPlanConsumerManifest({
    plan,
    consumerKind:
      "interactive-optimized"
  });

const reference =
  createProductionPlanConsumerManifest({
    plan,
    consumerKind: "reference"
  });
```

Both views keep the same plan fingerprint, stage and effect identities, physical and temporal results, blockers and capture seed.

The consumer role does not let the backend change scientific inputs or reduce the committed temporal samples.

### Renderer/reference split

Renderer declarations contain semantic capabilities only. They do not include WebGPU, Three.js, React, DOM or server objects.

A fast interactive renderer and a slower reference evaluator read the same engine-owned stage/effect plan, and each declares what it can faithfully represent.

### Current first-slice boundary

Plan schema `0.1.0` deliberately composes only the first primary spectral path, through the [scene-radiance-to-sensor bridge](#scene-radiance-to-sensor-irradiance).

Later stages stay explicit blockers until they are deliberately integrated, including:

- PSF;
- temporal exposure/readout composition;
- sensor optical stack;
- CFA/photosite sampling;
- charge/noise;
- ADC;
- reconstruction;
- final output/display processing.

So the production plan never silently turns standalone foundations into active pipeline stages.

See [Production Image-Formation Plan](https://github.com/Photivra/photivra/blob/main/docs/PRODUCTION_COMPOSITION.md).

## Front-of-lens filter transmission

Use `parseFrontOfLensFilterProfile()`, `resolveFrontOfLensFilterTransmission()`, and `composeFrontOfLensFilterTransmission()` for generic passive filters placed **in front of the lens**.

These cover neutral-density (ND) and wavelength-dependent filters. OpenSource V1 supports three generic ways to declare transmission:

- `neutral-linear-transmission` — explicit wavelength-independent transmission over a declared wavelength range;
- `neutral-optical-density` — base-10 optical density with `T = 10^-OD`;
- `spectral-transmission` — wavelength-resolved transmission samples.

All schema 0.1.0 filter profiles are explicitly:

- `photivra-generic-unbranded`;
- passive transmission only;
- unpolarized;
- non-wavelength-changing.

Composition fragment: requires previously validated bindings `evidence`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseFrontOfLensFilterProfile
} from "@photivra/engine";

const nd = parseFrontOfLensFilterProfile({
  schemaVersion: "0.1.0",
  filterId: "generic-nd-1-stop",
  profileVersion: "1.0.0",
  identityScope:
    "photivra-generic-unbranded",
  position: "front-of-lens",
  scientificStatus: "approximation",
  wavelengthBasis: "air",
  wavelengthRangeNanometers: {
    minimum: 400,
    maximum: 700
  },
  transmission: {
    kind:
      "neutral-linear-transmission",
    linearTransmissionFactor: {
      value: 0.5,
      evidence
    }
  },
  uncertainty: {
    kind: "not-quantified",
    limitation:
      "Generic educational filter."
  },
  polarizationModeled: false,
  wavelengthChangingBehaviorModeled:
    false,
  evidence,
  limitations: []
});
```

A transmission factor of 0.5 is exactly one stop of attenuation. Base-10 optical density is reported next to the stop attenuation, for diagnostics.

Multiple filters compose multiplicatively:

```text
T_stack = T_1 * T_2 * ... * T_n
```

The stack keeps each filter's identity and evidence. The combined numeric uncertainty is deliberately reported as **not propagated**, unless it is established whether the filters' errors are correlated or independent. Each filter's own uncertainty stays attached to that filter.

### Spectral boundary

Spectral filter data stays wavelength-resolved all the way through the [scene-radiance-to-sensor bridge](#scene-radiance-to-sensor-irradiance). Photivra does not turn a spectral filter into an undocumented RGB tint.

The requested scene wavelength and the filter profile must use the same resolved air/vacuum basis, and the wavelength must lie inside the declared range.

Embedded numeric spectral curves need `reusable-data` or `photivra-owned` provenance. A curve that was only published as a factual reference may not be copied into the open-source package.

### Optical integration

When you pass `frontOfLensFilters` to `calculateSceneRadianceToSensorIrradiance()`, the bridge applies the filter stack **exactly once**, separately from:

- lens spectral transmission or effective T-stop;
- field/vignetting throughput;
- sensor optical-stack response.

Conceptually:

```text
scene radiance
  * lens acceptance/transmission
  * front-of-lens filter transmission
  * field throughput
  -> pre-sensor-stack spectral irradiance
```

A selected front filter does **not** change:

- nominal or working f-number;
- aperture geometry;
- depth of field;
- geometric defocus;
- diffraction.

The production capture snapshot and plan also carry the filter stack. Changing the selected filter changes the immutable capture/plan identity and the composed physical result of the bridge.

### Polarization boundary

Circular polarizer (CPL) and polarizer behaviour is not modelled in schema 0.1.0. Correct polarization would need polarization to be represented end to end: scene radiance, materials and reflections, atmosphere, optics, and possibly sensor response.

Schema 0.1.0 therefore rejects filter profiles that claim `polarizationModeled: true`. (Filter schema 0.2.0 adds a linear polarizer; see [Polarizer and haze](#polarizer-and-haze).)

## Scene radiance to sensor irradiance

`calculateSceneRadianceToSensorIrradiance()` (#110) is the first physical optics bridge. It takes one validated sample of spectral radiance leaving the scene (from a [scene-radiance provider](#scene-radiance-provider-and-material-response), #85) and returns the **spectral irradiance at the sensor plane, before the sensor's own optical stack**.

(Radiance is light leaving a surface in a given direction; irradiance is light arriving on a surface.)

The bridge works on one explicit wavelength/time/field sample at a time.

Composition fragment: requires previously validated bindings `sceneRadianceRequest`, `sceneRadianceResult`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  calculateSceneRadianceToSensorIrradiance,
  parseSceneToSensorIrradianceProfile
} from "@photivra/engine";

const opticalProfile =
  parseSceneToSensorIrradianceProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-lens-throughput",
    profileVersion: "1.0.0",
    lensProfileId: "lens-prosumer-standard",
    scientificStatus: "approximation",
    applicability: {
      focalLengthMm: {
        minimum: 50,
        maximum: 50
      },
      nominalFNumber: {
        minimum: 1.8,
        maximum: 16
      },
      focus: {
        kind: "any"
      }
    },
    transmission: {
      kind: "spectral-transmission",
      scientificStatus: "approximation",
      wavelengthBasis: "air",
      samples: {
        value: [
          {
            wavelengthNanometers: 450,
            linearTransmissionFactor: 0.78
          },
          {
            wavelengthNanometers: 550,
            linearTransmissionFactor: 0.82
          },
          {
            wavelengthNanometers: 650,
            linearTransmissionFactor: 0.76
          }
        ],
        evidence: [
          {
            sourceOrigin: "photivra",
            sourceReference:
              "generic-lens-throughput:v1",
            reuseStatus:
              "photivra-owned"
          }
        ]
      },
      uncertainty: {
        kind: "not-quantified",
        limitation:
          "Generic optical approximation."
      }
    },
    distortionAreaMappingOwnership:
      "not-applied-by-bridge",
    psfRedistributionOwnership:
      "downstream-normalized-energy-redistribution",
    sensorOpticalStackIncluded: false,
    strayLightIncluded: false,
    polarizationModeled: false,
    wavelengthChangingBehaviorModeled: false,
    volumetricScatteringModeled: false,
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "generic-lens-throughput-profile:v1",
        reuseStatus:
          "photivra-owned"
      }
    ],
    limitations: [
      "Paraxial primary-image approximation."
    ]
  });

const irradiance =
  calculateSceneRadianceToSensorIrradiance({
    sceneRadianceRequest,
    sceneRadianceResult,
    profile: opticalProfile,
    focalLengthMm: 50,
    nominalFNumber: 4,
    focus: {
      kind: "infinity-focus"
    },
    imagePointMm: {
      x: 0,
      y: 0
    },
    fieldThroughput: {
      kind: "unity"
    }
  });
```

### Primary relation

The first bridge uses the paraxial circular-pupil approximation:

```text
geometric acceptance ≈ pi / (4 * N_working^2)

sensor spectral irradiance =
  scene spectral radiance
  * effective optical acceptance
  * front-of-lens filter transmission
  * field throughput
```

where the effective optical acceptance includes exactly one optical-transmission path. (N_working is the working f-number.)

This is a **paraxial approximation**, not a ray-traced pupil solution.

### f-number, working f-number, transmission, and T-stop

These quantities stay separate:

- the nominal f-number describes the geometric aperture;
- the working f-number is the geometric aperture relation at finite focus that the bridge uses;
- spectral transmission is the fraction of light passed, per wavelength;
- an effective working T-stop is an alternative approximation that already includes the transmission loss.

Do not apply a spectral transmission curve and a T-stop together.

For a spectral-transmission profile:

```text
effective acceptance =
  pi / (4 * N_working^2)
  * spectral transmission
```

For an effective-working-T-stop approximation:

```text
effective acceptance =
  pi / (4 * T_working^2)
```

The T-stop approximation must not be smaller than the geometric working f-number in this passive-optics model.

### Close focus

At infinity focus:

```text
N_working = N_nominal
```

The ideal symmetric thin-lens option may use:

```text
N_working = N_nominal * (1 + magnification)
```

but only when unity pupil magnification is explicitly declared.

This is not assumed to be correct for all real lenses.

A generic or real lens profile may instead supply an evidence-backed working f-number:

```ts
focus: {
  kind: "supplied-working-f-number",
  focus: {
    kind: "finite",
    objectDistanceM: 0.4
  },
  workingFNumber: {
    value: 5.2,
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "lens-working-fnumber:0.4m",
        reuseStatus:
          "photivra-owned"
      }
    ]
  },
  basis:
    "Generic lens calibration/profile."
}
```

### Field throughput

The bridge never hard-codes a universal `cos^4(theta)` falloff.

Supply either:

- `{ kind: "unity" }`; or
- one already evaluated `calculateIlluminationVignetting()` result for the exact same image-plane field coordinate.

That factor is applied **exactly once**.

Mechanical pupil clipping and cat's-eye behaviour belong to later pupil/PSF work. Do not stack them as a second, hidden illumination loss.

### Wavelength basis and provenance

Scene radiance and optical transmission must use the same resolved wavelength basis:

- `air`; or
- `vacuum`.

Photivra does not silently convert between them.

Numeric wavelength-transmission curves are reusable data, not just factual metadata. Their evidence must therefore be `reusable-data` or `photivra-owned`. `factual-reference-only` is not enough for copied numeric curves.

### Boundary of the result

The output quantity is:

```text
sensor-plane spectral irradiance
unit: W/m^2/nm
```

It is still **upstream** of:

- sensor cover glass / OLPF;
- microlens angular response;
- CFA/filter response;
- QE or A/W spectral responsivity;
- photon/electron conversion;
- charge accumulation;
- dark current;
- saturation;
- ADC/RAW/reconstruction.

The bridge also does not apply:

- PSF/diffraction redistribution;
- distortion/Jacobian brightness correction;
- flare/ghosts/veiling glare;
- polarization;
- volumetric scattering;
- wavelength-changing transport.

Each of those has its own owner, so transmission or energy loss cannot be counted twice.

### Calibration status

Schema 0.1.0 can carry calibrated optical transmission metadata. But scene-radiance evaluation (#85) is still approximation-only.

Therefore the combined result currently reports:

```text
calibratedSensorPlaneIrradianceClaimAuthorized = false
```

even when the optical profile itself is calibrated.

## Thin-lens image distance and magnification

Use `calculateThinLensImageDistance()` to calculate the ideal Gaussian thin-lens image distance for an object (focus) plane.

```ts
import { calculateThinLensImageDistance } from "@photivra/engine";

const projection = calculateThinLensImageDistance({
  focalLengthMm: 200,
  objectDistanceM: 22
});

console.log(projection.value.imageDistanceMm);
console.log(projection.value.magnification);
console.log(projection.value.infinityProjectionScale);
```

This is a paraxial, ideal-lens model ("paraxial" means it assumes rays close to the optical axis). It does not model real-lens focus breathing, pupil magnification, principal-plane movement or aberrations.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#projection-focus-extension-object-size-and-motion).

## Projected object size and sensor sampling

Use `calculateProjectedObjectSize()` for an object facing the camera squarely (fronto-parallel), with known physical dimensions and distance.

```ts
import { calculateProjectedObjectSize } from "@photivra/engine";

const subject = calculateProjectedObjectSize({
  focalLengthMm: 200,
  objectWidthM: 0.7,
  objectHeightM: 1.8,
  distanceM: 22,
  focusDistanceM: 22,
  pixelPitchMicrometers: 6
});

console.log(subject.value.widthMm);
console.log(subject.value.heightMm);
console.log(subject.value.widthPixels);
console.log(subject.value.heightPixels);
```

Omit `pixelPitchMicrometers` when only physical image-plane dimensions are needed.

The object plane is assumed to be fronto-parallel to the sensor.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#projection-focus-extension-object-size-and-motion).

## Depth of field and defocus

Use `calculateDepthOfField()` for the exact thin-lens near/far limits for a caller-supplied circle of confusion (it must be smaller than the aperture diameter `focalLengthMm / aperture`):

```ts
import { calculateDepthOfField } from "@photivra/engine";

const dof = calculateDepthOfField({
  focalLengthMm: 85,
  aperture: 2.8,
  focusDistanceM: 10,
  circleOfConfusionMm: 0.03
});

console.log(dof.value.nearLimitM);
console.log(dof.value.farLimitM); // null means infinity
console.log(dof.value.totalDepthOfFieldM);
```

Use `calculateDefocusCircle()` when you need the geometric blur-circle diameter for a specific subject plane:

```ts
import { calculateDefocusCircle } from "@photivra/engine";

const blur = calculateDefocusCircle({
  focalLengthMm: 85,
  aperture: 2.8,
  focusDistanceM: 10,
  subjectDistanceM: 20
});

console.log(blur.value.diameterMm);
```

You supply the circle-of-confusion criterion used for depth of field (DOF). These are ideal geometric thin-lens models. They do not include diffraction or real-lens aberrations in the DOF criterion.

`simulateCapture` and the display view render the defocus blur disc with `lens.defocus: { model: "geometric-disc" }`, up to a kernel radius of `DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES` (64 sites, a disc 129 sites across) and refuse a larger one. Use `calculateDefocusDiscKernelRadius()` to check a request before rendering it. It runs the capture's own resolution and limit test, so it agrees with the capture's refusal. Pass the f-number the capture uses (in an automatic exposure mode, the resolved one) and the sensor's pixel pitch:

```ts
import { calculateDefocusDiscKernelRadius } from "@photivra/engine";

const check = calculateDefocusDiscKernelRadius({
  focalLengthMm: 50,
  aperture: 1.4,
  focusDistanceM: 1,
  subjectDistanceM: 2,
  pixelPitchMicrometers: 6
});

console.log(check.value.withinLimit); // false: lens.defocus refuses this request
console.log(check.value.kernelRadiusSites, check.value.excessKernelRadiusSites); // 78, 14
```

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#thin-lens-focus-and-depth-of-field).

## Real-lens PSF profiles and complex-pupil reference

There are two explicit ways to describe the response of a real lens: sampled PSF profiles, and a complex-pupil (wavefront) reference. Both were added in #113. The legacy defocus and Airy diagnostics are kept unchanged.

### Sampled 2D PSF profiles

Use `parseLensSampledPsfProfile()` and `resolveLensSampledPsf()` for PSF kernels that are measured, simulated or owned by Photivra. Each kernel has unit energy, and kernels sit on a bounded regular grid.

The grid axes are:

- physical focal length;
- focus in diopters, where `0` is the explicit infinity state of [`FocusPlane`](#explicit-finite-and-infinity-focus-state);
- f-number;
- image-plane field X/Y in millimetres;
- wavelength in nanometres;
- signed image-plane defocus in micrometres.

Resolution is either `exact-grid-sample` or `interpolated`. Any request outside a declared axis fails closed; there is no extrapolation.

All nodes must use the same physical kernel sampling grid, so multilinear interpolation never silently mixes different PSF coordinate systems. The returned full 2D kernel keeps the +X right / +Y up orientation. No radial or sagittal/tangential averaging is forced.

Every kernel is a **unit-energy PSF shape**. `relativePupilThroughputFactor` is kept separate and belongs to the optical-throughput path. So a mechanically clipped (cat's-eye) pupil can change both the PSF shape and the throughput, without the throughput being multiplied into the normalized PSF and then applied a second time in the [scene-radiance-to-sensor bridge](#scene-radiance-to-sensor-irradiance).

`bestFocusImagePlaneOffsetMicrometers` may vary across the field and with wavelength. This is where a profile describes field curvature and longitudinal (axial) chromatic focus shift. It does not change geometric distortion or shift channels sideways.

Signed defocus is preserved, so foreground and background defocus may use different profiled PSFs.

### Complex pupil / wavefront reference

Use `parseLensComplexPupilProfile()` and `calculateLensComplexPupilPsf()` when the primary optical response is supplied as:

- relative pupil amplitude; plus
- optical-path difference in micrometres.

The reference evaluator runs deterministic scalar Fraunhofer propagation on the explicit pupil grid.

- Each axis is zero-padded to at least 2S − 1 samples, where S is the number of samples in the non-zero support. This makes the intensity PSF meet Goodman's sampling condition Q = λN/pitch > 2 (stated freely in Ban et al., [arXiv:2511.06936](https://arxiv.org/abs/2511.06936), eqs. 8–9). `result.value.sampling` reports the achieved Q and padding.
- A pupil support wider than the declared f/N aperture is rejected.
- Diffraction and aberration phase are evaluated **together** in that pupil calculation. Do not add a separate diffraction blur to the result.

The resulting intensity PSF is normalized to unit energy. The profile's relative pupil throughput is kept separately and is not multiplied into the kernel.

The complex-pupil evaluator is a bounded, scalar reference model. It does not include polarization or vector diffraction, ghosting or flare, the sensor's OLPF (optical low-pass filter), microlenses or CFA, sampling, demosaicing, sharpening or display processing.

### MTF magnitude is not a PSF

The MTF (modulation transfer function) describes how much contrast a lens keeps at each level of detail. `parseLensMtfDiagnosticProfile()` stores sagittal/tangential MTF magnitude diagnostics.

`assessMtfOnlyPsfRenderability()` always reports that a unique PSF cannot be reconstructed, because the MTF magnitude has no phase information. MTF is useful for validation, not as a way to generate a blur kernel.

### Ownership boundaries

- Geometric distortion stays a field mapping.
- Lateral CA stays a wavelength/channel field mapping.
- Field curvature and longitudinal CA belong to focus/PSF.
- Pupil clipping can change PSF shape; throughput is owned separately.
- Regular-polygon and other non-circular diffraction is owned by [ideal polygon diffraction](#ideal-regular-polygon-diffraction) (#1).
- Stray light, ghosting and veiling glare are owned separately (#114; see [Digital optics foundations](https://github.com/Photivra/photivra/blob/main/docs/DIGITAL_OPTICS_FOUNDATION.md)).
- Sensor OLPF, CFA and reconstruction come later in the pipeline.
- There is no scalar `lensSharpness` or `bokehQuality` primitive; such scores are not scientific quantities.

## PSF and pupil foundation

- `getPsfFoundationContract()` shows which PSF contributions exist or are reserved, and who owns them.
- `calculatePsfFoundationComponents()` evaluates the diagnostics implemented today, in one explicit field/depth/spectral/pupil context.

```ts
import {
  calculatePsfFoundationComponents,
  getPsfFoundationContract
} from "@photivra/engine";

const contract = getPsfFoundationContract();

const components = calculatePsfFoundationComponents({
  focalLengthMm: 85,
  aperture: 2.8,
  focusDistanceM: 10,
  subjectDistanceM: 20,
  fieldPointMm: { x: 12, y: 8 },
  fieldNormalizationRadiusMm: 21.6,
  spectralBasis: {
    kind: "monochromatic",
    wavelengthNm: 550
  }
});

console.log(contract.compositionPolicy);
console.log(components.value.contributions.geometricDefocus);
console.log(components.value.contributions.circularDiffraction);
console.log(components.value.composition.status); // "not-composed"
```

The foundation deliberately **does not combine** geometric defocus and circular diffraction into a synthetic PSF, MTF, convolution kernel, combined blur radius or "lens sharpness" score.

This foundation API is separate from the capture facade. With `lens.defocus` and `lens.diffraction` together, `simulateCapture` convolves each spectral node's diffraction kernel with the geometric defocus disc (#492). That is a labelled approximation, and it has its own `lens.defocus` assumption. See [Optics](QUICK_START.md#optics).

It already records field position, even though the current defocus and Airy diagnostics do not vary across the field. Future field-curvature, pupil-clipping, bokeh and aberration contributions can then use the same context without reinterpreting existing outputs.

The spectral basis is explicitly monochromatic (one wavelength) for the Airy diagnostic. This does not create a spectral lens or sensor-colour model.

See [PSF and Pupil Foundation](https://github.com/Photivra/photivra/blob/main/docs/PSF_FOUNDATION.md).

## Circular-aperture diffraction

Use `calculateAiryDisk()` for the diameter of the Airy disk to its first dark ring (first zero), for an ideal circular pupil at one wavelength:

```ts
import { calculateAiryDisk } from "@photivra/engine";

const diffraction = calculateAiryDisk({
  aperture: 8,
  wavelengthNm: 550
});

console.log(diffraction.value.firstZeroDiameterMicrometers);
```

This calculation uses `d = 2.44 λ N` (λ = wavelength, N = f-number). It is not a diffraction PSF for a polygon aperture.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#diffraction).

## Aperture geometry and sunstar directions

Use `calculateIdealApertureGeometry()` for a regular, straight-edged diaphragm:

```ts
import { calculateIdealApertureGeometry } from "@photivra/engine";

const aperture = calculateIdealApertureGeometry({
  bladeCount: 7,
  firstBladeEdgeAngleDegrees: 15
});

console.log(aperture.value.normalizedVertices);
console.log(aperture.value.sunstarRayCount);
console.log(aperture.value.sunstarRayAnglesDegrees);
```

The output describes only the normalized aperture shape and the ideal symmetry of the sunstar ray directions. It does not calculate diffraction intensity, star length, flare, coatings or a full PSF.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#ideal-diaphragm-geometry-and-sunstar-symmetry).

## Pixel pitch

Use `calculatePixelPitch()` with physical sensor width and horizontal active pixel count:

```ts
import { calculatePixelPitch } from "@photivra/engine";

const pitch = calculatePixelPitch({
  sensorWidthMm: 36,
  pixelWidth: 6000
});

console.log(pitch.value.micrometers);
console.log(pitch.value.millimeters);
```

This primitive calculates horizontal pixel pitch. It assumes the sensor width and pixel count you supply describe the same active dimension.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#sensor-geometry-sampling-capture-and-crop).

## White balance and Auto WB

Photivra keeps three things separate: **scene illumination**, **camera white-balance state**, and **render/export colour transforms**.

The white-balance foundation (#108) works on an explicit domain: the linear camera RGB a camera could observe before white balance:

```text
relative-pre-wb-camera-linear-rgb
```

It does not:

- peek at the authoritative scene-illuminant metadata to "cheat" auto white balance (AWB);
- change the scene lighting;
- destructively alter the RAW-like sensor capture;
- change aperture, shutter, ISO or focus.

### Generic presets

Preset labels are resolved through a declared profile, not through universal hard-coded Kelvin values:

Composition fragment: requires previously validated bindings `evidence`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseWhiteBalanceProfile,
  resolvePresetWhiteBalance
} from "@photivra/engine";

const profile =
  parseWhiteBalanceProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-wb",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    inputDomain:
      "relative-pre-wb-camera-linear-rgb",
    presets: [
      {
        presetId: "daylight-like",
        label: "Daylight",
        channelGains: {
          value: {
            red: 1.2,
            green: 1,
            blue: 1.45
          },
          evidence
        },
        nominalColorTemperatureKelvin:
          5200,
        nominalTint: 0.03
      }
    ],
    awbPolicies: [
      {
        policyId: "neutral",
        intent: "neutral-priority",
        correctionStrength: {
          value: 1,
          evidence
        }
      },
      {
        policyId: "ambience",
        intent:
          "ambience-preserving",
        correctionStrength: {
          value: 0.5,
          evidence
        }
      }
    ],
    evidence,
    limitations: [
      "Generic camera-linear approximation."
    ]
  });

const daylight =
  resolvePresetWhiteBalance({
    stateId: "wb-1",
    profile,
    presetId: "daylight-like"
  });
```

The label, the nominal CCT (correlated colour temperature), the tint and the actual channel gains are separate facts in the profile. A camera-specific profile needs defensible evidence. No manufacturer-specific WB behaviour is guessed from a common preset name.

### Manual gains and CCT+tint intent

`resolveManualWhiteBalance()` records explicit camera-linear channel gains.

`createColorTemperatureWhiteBalanceIntent()` records a separate Kelvin and tint control **without fabricating channel gains**:

```ts
const intent =
  createColorTemperatureWhiteBalanceIntent({
    intentId: "wb-kelvin",
    colorTemperatureKelvin: 5000,
    tint: 0.15
  });
```

The intent keeps `channelGainsResolved: false` and `requiresCameraProfileColorimetry: true`. CCT alone is not treated as a complete chromatic adaptation model, and tint stays an independent axis.

`resolveColorTemperatureWhiteBalance()` resolves gains once the intent is paired with an explicit camera colour model:

1. It takes the white point on the Planckian or CIE-daylight locus.
2. It offsets that white by the tint, read as Duv in CIE 1960 uv.
3. It maps the white through the camera's XYZ→camera matrix.
4. It neutralizes the result.

The state it returns has `source: "color-temperature"`. See [Kelvin + tint white balance](#kelvin--tint-white-balance) below and [Colorimetry](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md#kelvin--tint-white-balance).

### Custom measured WB

`resolveCustomWhiteBalance()` takes RGB samples measured before white balance, independent of any renderer, and tied to a stable image-state ID.

You, the caller, declare that the selected region should be neutral. Photivra does **not** claim that the real-world object you chose is spectrally neutral.

Custom measurement:

- rejects clipped samples;
- rejects missing/zero channel signal;
- computes deterministic weighted camera-linear means;
- resolves relative channel gains from the measured neutral target.

### Auto White Balance

`estimateAutoWhiteBalance()` uses only linear camera samples from before white balance, plus an AWB policy owned by the profile.

The first generic model is a deterministic grey-world-style estimate (it assumes the scene averages to grey). A neutralizing gain is derived from the weighted observed channels. Then the policy's `correctionStrength` is applied in logarithmic gain space:

```text
resolved gain = neutralizing gain ^ correctionStrength
```

A strength of `1` is a generic neutral-priority estimate. Lower strengths keep more of the observed colour cast. This supports explicit generic "standard" or "ambience" behaviour, without pretending there is one universal AWB result.

Clipped AWB samples are left out and reported. If no usable samples remain, estimation fails closed.

One AWB result is a **global camera WB state**. Under mixed lighting, different parts of the image can keep different local casts after the same global gains.

### AWB lock

Use `createLockedWhiteBalanceState()` to freeze a resolved WB state under a new stable identity:

```ts
const locked =
  createLockedWhiteBalanceState({
    stateId: "wb-lock-1",
    sourceState: awbState
  });
```

Later scene or image signals may give a different AWB estimate, but the locked state's gains stay unchanged. AWB lock is independent of AE lock and focus lock.

### Image-state/export boundary

Every resolved WB state explicitly reports that it did not:

- modify scene illumination;
- destructively modify RAW capture;
- modify physical exposure;
- modify focus.

How a resolved WB intent is applied or encoded in processed linear images, previews, TIFF, DNG metadata or other outputs is owned by linear capture and colour (#15), not by this foundation.

## Colorimetry

The [colorimetry primitives](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md) cover colour-matching functions (CMFs), illuminants, CCT/Duv, chromatic adaptation, ΔE (colour difference), camera-matrix fitting, wide-gamut/HDR transfers and gamut mapping.

No CIE or ColorChecker tables are bundled; the CIE datasets are licensed CC BY-SA 4.0. Use the labelled analytic CMF approximation, or pass tables you are licensed to use.

### Spectrum to XYZ, CCT and colour difference

```ts
import {
  calculateColorDifference,
  calculateCielabFromXyz,
  calculateCorrelatedColorTemperature,
  createCieIlluminantASpectrum,
  createColorimetricMidpointQuadrature,
  integrateSpectrumToXyz
} from "@photivra/engine";

const quadratureNodes = createColorimetricMidpointQuadrature({
  wavelengthRangeNanometers: { minimum: 360, maximum: 830 },
  maximumSubintervalWidthNanometers: 1
});
const colorMatchingFunctions = { kind: "analytic-cie-1931-multi-lobe-fit" } as const;

const illuminantA = integrateSpectrumToXyz({
  quadratureNodes,
  spectralDistribution: createCieIlluminantASpectrum(),
  colorMatchingFunctions,
  normalization: { kind: "white-luminance-one" }
});
console.log(illuminantA.provenance.kind); // "approximation" (analytic CMF fit)

const cct = calculateCorrelatedColorTemperature({
  chromaticity: illuminantA.value.chromaticity!,
  locus: { kind: "planck-integration", colorMatchingFunctions, quadratureNodes }
});
console.log(cct.value.correlatedColorTemperatureKelvin, cct.value.duv); // ≈ 2855.5 K, ≈ 0

const white = illuminantA.value.whiteXyz;
const reference = calculateCielabFromXyz({ xyz: { x: 0.2, y: 0.18, z: 0.05 }, referenceWhiteXyz: white }).value;
const sample = calculateCielabFromXyz({ xyz: { x: 0.21, y: 0.18, z: 0.05 }, referenceWhiteXyz: white }).value;
console.log(calculateColorDifference({ reference, sample, formula: "ciede2000" }).value.deltaE);
```

### Kelvin + tint white balance

```ts
import {
  createColorTemperatureWhiteBalanceIntent,
  resolveCaptureColorModel,
  resolveColorTemperatureWhiteBalance
} from "@photivra/engine";

const tungsten = resolveColorTemperatureWhiteBalance({
  stateId: "wb-3200k",
  intent: createColorTemperatureWhiteBalanceIntent({ intentId: "k3200", colorTemperatureKelvin: 3200, tint: 0 }),
  whiteLocus: "planckian",
  tintInterpretation: "duv-cie-1960-uv",
  camera: { profileId: "ideal-colorimetric", profileVersion: "0.1.0", xyzToCameraRgb: resolveCaptureColorModel().xyzToCameraRgb }
});
console.log(tungsten.channelGains); // red < 1 < blue for a warm declared white
```

### Chromatic adaptation, transfer functions and gamut mapping

```ts
import {
  calculateChromaticAdaptationMatrix,
  calculateGamutMappedColor,
  evaluateSrgbEncoding,
  resolveRgbColorSpace
} from "@photivra/engine";

const bradford = calculateChromaticAdaptationMatrix({
  transform: "bradford",
  sourceWhiteXyz: { x: 1.0985, y: 1, z: 0.3558 },
  destinationWhiteXyz: resolveRgbColorSpace("srgb").value.whiteXyz // D65 from its chromaticity
}).value.matrix;

const rec2020 = resolveRgbColorSpace("rec2020").value.rgbToXyz;
const srgbCodeForMidGrey = evaluateSrgbEncoding(0.18); // ≈ 0.4614

const mapped = calculateGamutMappedColor({
  colorSpace: "srgb",
  method: "cielab-hue-preserving-chroma-compression",
  kneeFraction: 0.9,
  xyz: { x: rec2020[0][1], y: rec2020[1][1], z: rec2020[2][1] } // Rec.2020 green primary
});
console.log(bradford, srgbCodeForMidGrey, mapped.value.linearRgb);
```

Scene adaptation inside `calculateCaptureColorTransform()` can opt in to a cone-space transform with `whiteBalance: { kind: "adopted-white-xyz-scaling", transform: "bradford" }`. Leaving out `transform` keeps the original diagonal scaling in XYZ.

## Sensor imaging area and native raster

Use `calculateSensorGeometryMetrics()` when physical imaging size and native image resolution need to remain independent:

```ts
import { calculateSensorGeometryMetrics } from "@photivra/engine";

const metrics = calculateSensorGeometryMetrics({
  imagingArea: {
    widthMm: 36,
    heightMm: 24
  },
  nativeRaster: {
    pixelWidth: 6000,
    pixelHeight: 4000
  }
});

console.log(metrics.value.imagingArea.cropFactor35Mm); // 1
console.log(metrics.value.nativeRaster.megapixels); // 24
console.log(metrics.value.sampling.pitchXMicrometers); // 6
console.log(metrics.value.sampling.pitchYMicrometers); // 6
```

- `SensorImagingArea` is the physical light-sensitive area used for image formation. It is not the size of the sensor package or die.
- `NativeImageRaster` is the effective native grid of image samples. It does not claim that each image sample is one physical photodiode (photosite).
- The 35 mm crop factor is based on the diagonal, compared with a 36 × 24 mm reference frame.
- Changing the native raster density does not change the physical crop factor. Changing the physical imaging area does not, by itself, change the native megapixels.

The returned X/Y sampling pitches are the geometric spacing of image samples. They are not photodiode active area, fill factor or a photon-collection model, and must not be used as those quantities.

Passing such a pitch to `simulateCapture()` as `sensor.pixelPitchMicrometers` is a supported use, but the photon model then comes from the facade, not from this pitch: the facade declares its own sensor with sites at that spacing and a square sensitive aperture of the same side (fill factor 1, the `sensor.fillFactor` assumption), and scales its ISO readout with that aperture area (see [Quick start: ISO and pixel size](QUICK_START.md#iso-and-pixel-size)). A real sensor of the same pitch may have a smaller sensitive area, microlenses and a different full-well capacity.

The existing `calculatePixelPitch()` API remains available for callers that only need horizontal pitch from sensor width and horizontal pixel count.

## Sensor architecture metadata

Use `parseSensorArchitectureProfile()` to read descriptive hardware and capability metadata from untrusted JSON.

The current schema is exported as `SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION` and is `0.3.0`:

```ts
import {
  SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION,
  parseSensorArchitectureProfile
} from "@photivra/engine";

const architecture = parseSensorArchitectureProfile({
  schemaVersion: SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION,
  technologyFamily: {
    value: "cmos",
    evidence: [
      {
        sourceOrigin: "manufacturer",
        sourceReference: "manufacturer-spec:example",
        reuseStatus: "factual-reference-only"
      }
    ]
  },
  illumination: {
    value: "bsi",
    evidence: [
      {
        sourceOrigin: "manufacturer",
        sourceReference: "manufacturer-spec:example",
        reuseStatus: "factual-reference-only"
      }
    ]
  },
  integration: {
    value: "stacked",
    evidence: [
      {
        sourceOrigin: "manufacturer",
        sourceReference: "manufacturer-spec:example",
        reuseStatus: "factual-reference-only"
      }
    ]
  },
  readoutCapabilities: [
    {
      value: "rolling",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "manufacturer-spec:example",
          reuseStatus: "factual-reference-only"
        }
      ]
    }
  ],
  colorSamplingFamily: {
    value: "bayer",
    evidence: [
      {
        sourceOrigin: "manufacturer",
        sourceReference: "manufacturer-spec:example",
        reuseStatus: "factual-reference-only"
      }
    ]
  }
});
```

`technologyFamily` is an optional, evidence-backed, coarse detector type:

- `"cmos"`;
- `"ccd"`.

It is independent of illumination architecture (FSI/BSI — front- or back-side illuminated), integration/stacking, readout capability, shutter mechanism, colour sampling, and every performance characteristic. For example:

- CMOS may be FSI or BSI;
- CMOS may expose rolling or global readout;
- CCD may be FSI or BSI;
- CCD may be monochrome or color-filtered;
- the word CMOS or CCD alone says nothing about QE, read noise, dark current, full-well capacity, dynamic range, high-ISO behavior, frame rate, or image quality.

At this coarse level, Photivra treats sCMOS as CMOS and EMCCD as CCD. Those labels are not separate top-level values. Detailed CCD transfer architecture, electron multiplication, CMOS pixel/readout topology and other technology-specific mechanisms would need their own explicit profiles or models, if a future scientific use needs them.

The other architecture axes are also independent. BSI may be stacked or monolithic. Stacking does not imply a global shutter. Global readout capability does not imply any particular stacking or technology family.

Where evidence came from (source origin) and what Photivra may do with it (reuse rights) are independent too:

- Manufacturer or third-party material may be factual-reference-only, or explicitly reusable when a suitable licence exists.
- `photivra-owned` evidence must originate from Photivra.
- Reusable-data evidence needs an explicit licence.

Scalar facts may cite several evidence records. Capabilities with several values, such as rolling/global readout, carry evidence for each value separately, so one source cannot silently support a different capability.

`readoutCapabilities` describes what the hardware can do, not the mode selected for one exposure. The capture-mode profile can declare that a selected mode needs its own readout timing; the actual timing values belong to the separate readout-timing contract.

### Schema 0.2.0 compatibility

Existing schema `0.2.0` profiles are still accepted, and keep their `schemaVersion: "0.2.0"` identity when parsed. They do not gain or infer a technology family.

To declare `technologyFamily`, use schema `0.3.0`. A `0.2.0` document that includes the new field fails closed, instead of silently applying new meaning under an older schema version.

Leave unknown facts out rather than guessing them. Architecture metadata is descriptive only. CMOS/CCD, BSI/FSI, stacking, readout family and CFA family do not directly change FOV, crop factor, pixel pitch, exposure, noise, readout timing or dynamic range. Any such effect needs a separate, documented physical or calibration model first.

## Color-sampling topology

The colour-sampling topology says which colour channel each sensor site measures — for example, the 2×2 tile of a Bayer mosaic. Use `parseSensorColorSamplingProfile()` when the exact topology is known, independently of the descriptive sensor-family metadata:

```ts
import {
  parseSensorColorSamplingProfile,
  resolveColorSamplingSite
} from "@photivra/engine";

const topology = parseSensorColorSamplingProfile({
  schemaVersion: "0.1.0",
  profileId: "example-periodic-layout",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "example:periodic-layout",
      reuseStatus: "photivra-owned"
    }
  ],
  coordinateSystem:
    "native-sensor-color-sampling-site-index",
  layout: {
    kind: "periodic-mosaic",
    repeatWidthSites: 2,
    repeatHeightSites: 2,
    siteChannelIds: [
      "red-like",
      "green-a",
      "green-b",
      "blue-like"
    ],
    anchor: "native-sensor-top-left-site"
  }
});

const site = resolveColorSamplingSite({
  profile: topology,
  site: { x: 5, y: 8 }
});

console.log(site.mapping);
```

The topology coordinate system is a distinct **native sensor color-sampling-site lattice**:

- zero-based integer site indices;
- origin at the native sensor's top-left sampling site;
- +X right and +Y down;
- periodic phase anchored to absolute sensor-site indices.

It is deliberately **not** `NativeImageRaster`. The native image raster is an effective image-sampling grid. It does not guarantee one sample per physical photodiode, or one sample per colour-filter site. Before RAW/CFA sampling can be simulated, a separate explicit binding must say how a selected capture mode's effective raster maps onto this topology.

This separation also protects the crop phase. If an active crop starts part-way through a repeating tile, keep the original absolute native site indices. The crop's local `(0,0)` must not silently become a new CFA origin.

`siteChannelIds` are only names for measurement channels. Names such as `red-like`, `green-a` or `clear` do not establish:

- wavelength response;
- quantum efficiency;
- spectral sensitivity;
- colorimetric primaries;
- white balance behavior;
- calibrated sensor response.

Those belong to later spectral/radiometric contracts.

The periodic layout is generic. It can represent a 2×2 Bayer-like phase, larger repeating mosaics, grouped-colour tiles, RGBW-like layouts or other periodic channel arrangements, without a manufacturer-specific layout enum. The two green positions can share one channel ID, or use separate IDs when a later calibration needs to keep them apart.

The exact topology is also separate from `SensorArchitectureProfile.colorSamplingFamily`. A family such as `bayer`, `quad-bayer`, `custom-rgb-mosaic` or `layered-color` is descriptive metadata. Photivra never invents an exact repeating tile from a family label.

Monochrome is represented separately with one semantic measurement-channel ID and no spatial mosaic.

Layered colour (colours separated by stacked layers rather than a side-by-side mosaic) is deliberately **structural-only** in schema 0.1.0. It uses a separate "spatial relationship not resolved" marker, instead of pretending it shares the periodic site lattice:

```ts
const layered = parseSensorColorSamplingProfile({
  schemaVersion: "0.1.0",
  profileId: "example-layered",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "example:layered",
      reuseStatus: "photivra-owned"
    }
  ],
  coordinateSystem:
    "native-sensor-layered-spatial-relationship-not-resolved",
  layout: {
    kind: "layered",
    layerChannelIds: [
      "layer-a",
      "layer-b",
      "layer-c"
    ],
    spatialSamplingRelationship: "not-resolved"
  }
});
```

The engine does not resolve layered sites one by one yet. Real layered designs can have different spatial density or registration per layer. Assuming an equal-resolution RGB triplet at every site would be scientifically unsafe.

Schema 0.1.0 also does not model sparse exceptions to an otherwise periodic layout, such as phase-detect sites, masked sites, sensor defects or other non-periodic overrides.

Physical orientation is applied later. The native topology is not rotated or re-phased just because the camera is held vertically. Likewise, changing the CFA topology does not change the physical imaging area, crop factor, FOV or output geometry.

## Capture-mode/color-sampling binding

Use `parseNativeEffectiveRasterColorSamplingBindingProfile()` when you have evidence for how one exact canonical `NativeImageRaster` relates to the separate lattice of native colour-sampling sites.

The first binding is deliberately regular and sensor-anchored:

Composition fragment: requires previously validated bindings `topology`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseNativeEffectiveRasterColorSamplingBindingProfile,
  resolveNativeEffectiveRasterColorSamplingBinding
} from "@photivra/engine";

const binding = parseNativeEffectiveRasterColorSamplingBindingProfile({
  schemaVersion: "0.1.0",
  bindingId: "example-native-to-cfa",
  colorSamplingProfileId: "example-periodic-layout",
  nativeRaster: {
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "example:native-to-cfa-binding",
      reuseStatus: "photivra-owned"
    }
  ],
  relationship: {
    kind: "regular-native-effective-sample-blocks",
    sitesPerNativeSampleX: 1,
    sitesPerNativeSampleY: 1,
    anchor: "shared-native-top-left"
  }
});

const resolvedBinding =
  resolveNativeEffectiveRasterColorSamplingBinding({
    nativeRaster: {
      pixelWidth: 6000,
      pixelHeight: 4000
    },
    colorSamplingProfile: topology,
    bindingProfile: binding
  });
```

A `1 × 1` relationship is still a **binding that must be asserted and evidenced**. Matching dimensions, matching aspect ratio, output megapixels or a family label such as Bayer never prove that one `NativeImageRaster` sample corresponds to one colour-sampling site.

The binding applies only to the exact native raster dimensions recorded in the profile. The first schema supports one native effective sample mapping to a regular rectangular block of colour-sampling sites, with a shared native top-left anchor. Irregular relationships would need a later, explicit mapping.

To compose that sensor-level relationship with a capture mode, use `resolveCaptureModeColorSamplingContributors()`:

Composition fragment: requires previously validated bindings `binding`, `modes`, `topology`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  resolveCaptureModeColorSamplingContributors
} from "@photivra/engine";

const sources =
  resolveCaptureModeColorSamplingContributors({
    nativeRaster: {
      pixelWidth: 6000,
      pixelHeight: 4000
    },
    captureModeProfile: modes,
    modeId: "grouped",
    colorSamplingProfile: topology,
    bindingProfile: binding,
    modeSampleIndexFullFrame: {
      x: 10,
      y: 20
    },
    groupedSamplingAnchor: {
      anchor: "native-effective-raster-top-left",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "example:group-phase",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  });

console.log(sources.colorSamplingSiteRect);
console.log(sources.channelSiteCounts);
console.log(sources.channelComposition);
```

`modeSampleIndexFullFrame` is always given in the selected mode's **full-frame, per-frame effective sampling raster**. The API deliberately does not accept crop-local coordinates. If an active crop starts away from the native origin, keep or recover the absolute full-frame mode index before resolving the CFA structure. This stops active crops from silently re-phasing the mosaic.

For `grouped-native-samples` modes, the group width and height alone do not prove where the groups start (the group phase). You must separately provide evidence that the groups are anchored at the top-left of the native effective raster. A future contract can add other explicitly evidenced group phases if needed.

The result is a compact **pre-reconstruction structural source region**:

- `nativeEffectiveSampleRect` identifies the absolute native effective samples structurally associated with the mode sample;
- `colorSamplingSiteRect` identifies the corresponding absolute color-site rectangle;
- `channelSiteCounts` gives exact counts per semantic channel for monochrome/periodic topology;
- `channelComposition` reports whether the structural region contains one channel or multiple channels.

The bridge does **not** list every contributing site. It also does not define sum or average weights, spectral response, photon or electron values, or a complete graph of which reconstructed pixels depend on which sites.

So a mixed-channel region stays mixed. Photivra does not collapse a red/green/blue region into one synthetic CFA channel just because a capture mode groups those native samples. The capture mode's `combinationDomain` stays separate from any weighting or combination equation, none of which is implemented.

`declared-effective-raster` modes fail closed, even when their dimensions happen to match the native raster. Their relationship was deliberately declared as not simple (in the capture-mode work, #13), so they need a mode-specific colour-site mapping, not a guess from dimensions.

Layered-colour topology also stays unbound, because schema 0.1.0 does not yet define per-layer spatial density and registration.

Pixel-shift (sensor-shift) metadata is kept but does not change CFA assignment. The sensor and its filters move together relative to the optical image. The effect of that shift on optical registration belongs to a later image-formation contract.

## Sensor optical stack

The sensor optical stack is the set of layers in front of the photosites: cover glass, infrared-cut filter, anti-aliasing (AA, or optical low-pass) filter and so on. Use `parseSensorOpticalStackProfile()` for evidence-backed physical stack metadata, plus a separately declared **effective anti-aliasing spatial response**:

```ts
import {
  parseSensorOpticalStackProfile,
  resolveAntiAliasingSpatialKernel
} from "@photivra/engine";

const stack = parseSensorOpticalStackProfile({
  schemaVersion: "0.1.0",
  profileId: "example-stack",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "example:stack",
      reuseStatus: "photivra-owned"
    }
  ],
  orderedComponents: [
    {
      componentId: "front-pack",
      roles: [
        "cover-glass",
        "infrared-cut",
        "anti-reflection"
      ],
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "example:front-pack",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  ],
  effectiveAntiAliasingSpatialResponse: {
    kind: "normalized-point-splitting-kernel",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "example:aa-kernel",
        reuseStatus: "photivra-owned"
      }
    ],
    coordinateSystem: "native-sensor-physical",
    scope:
      "field-wavelength-polarization-invariant-approximation",
    components: [
      {
        offsetMicrometers: { x: -1, y: 0 },
        normalizedWeight: 0.5
      },
      {
        offsetMicrometers: { x: 1, y: 0 },
        normalizedWeight: 0.5
      }
    ]
  },
  microlens: {
    presence: "present",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "example:microlens-presence",
        reuseStatus: "photivra-owned"
      }
    ],
    opticalEffectModel: "unresolved"
  }
});

const aaKernel =
  resolveAntiAliasingSpatialKernel(stack);

console.log(aaKernel.components);
```

The physical component list and the effective AA response are deliberately separate. A stack may contain birefringent or retarder elements while the net intentional low-pass effect is cancelled, or otherwise absent in practice.

`effectiveAntiAliasingSpatialResponse` can be omitted, or take one of three kinds:

- omitted — **unknown/unasserted**;
- `kind: "absent"` — evidence says this model should add no intentional AA spatial-splitting term;
- `kind: "present-unresolved"` — an AA effect exists but its spatial response is not defensibly known;
- `kind: "normalized-point-splitting-kernel"` — the caller explicitly supplies a normalized spatial point-splitting approximation.

Unknown and absent are not interchangeable. And `absent` does **not** mean the whole sensor stack has an identity PSF, nor that aliasing or moiré are impossible. Lens PSF, cover/filter behaviour, microlenses, sampling topology and scene detail still matter.

The point-splitting kernel is deliberately generic:

- component count is arbitrary rather than fixed to four rays;
- offsets are in micrometres in `native-sensor-physical` coordinates (+X right, +Y down);
- physical camera orientation does not rotate/redefine the stored kernel;
- normalized weights must sum to one;
- the weights describe **spatial redistribution only**.

They do not represent total optical throughput, spectral transmission, photon efficiency, QE or fill factor. Those belong to separate radiometric and sensor-response contracts.

The first point-splitting scope is explicitly `field-wavelength-polarization-invariant-approximation`. A real OLPF (optical low-pass filter) may depend on wavelength, angle of incidence/field position, polarization, materials and stack geometry. Do not treat this generic kernel as a calibrated whole-stack PSF.

`orderedComponents` is descriptive metadata, listed in order from incoming light to the sensor. Component roles can include cover glass, IR/UV filtering, anti-reflection (AR) treatment, birefringent low-pass elements, wave plates and other optical filters. Schema 0.1.0 does not derive transmission, refractive focus shift, aberration, thickness effects or a spectral response from those roles.

Microlens presence or absence is also descriptive only. A `present` microlens does not by itself say anything about angular acceptance, light concentration, fill factor, crosstalk, QE improvement or behaviour across the field.

The resolver therefore returns only the **effective AA spatial kernel**. It states explicitly that cover/filter effects, microlens response, throughput, spectral transmission, and field, wavelength and polarization dependence are not included.

## Sensor sampling aperture

Use `parseSensorSamplingApertureProfile()` and `resolveSensorSamplingAperture()` when you know where the colour-site lattice physically sits, and have a geometric approximation of each site's light-sensitive region:

Composition fragment: requires previously validated bindings `binding`, `topology`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseSensorSamplingApertureProfile,
  resolveSensorSamplingAperture
} from "@photivra/engine";

const sampling = parseSensorSamplingApertureProfile({
  schemaVersion: "0.1.0",
  profileId: "example-sampling-aperture",
  colorSamplingProfileId: "example-periodic-layout",
  colorSamplingBindingId: "example-native-to-cfa",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "example:sampling-aperture",
      reuseStatus: "photivra-owned"
    }
  ],
  siteCenterLattice: {
    kind: "regular-rectangular-site-center-lattice",
    coordinateSystem: "native-sensor-physical",
    pitchXMicrometers: 6,
    pitchYMicrometers: 6,
    firstSiteCenterFromImagingAreaTopLeftMicrometers: {
      x: 3,
      y: 3
    },
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "example:site-registration",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  geometricSensitiveAperture: {
    kind: "uniform-axis-aligned-rectangle",
    widthMicrometers: 5,
    heightMicrometers: 5,
    centerOffsetFromSiteCenterMicrometers: {
      x: 0,
      y: 0
    },
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "example:sensitive-region",
        reuseStatus: "photivra-owned"
      }
    ]
  }
});

const siteAperture = resolveSensorSamplingAperture({
  imagingArea: {
    widthMm: 36,
    heightMm: 24
  },
  nativeRaster: {
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  colorSamplingProfile: topology,
  colorSamplingBindingProfile: binding,
  samplingApertureProfile: sampling,
  site: { x: 100, y: 200 }
});

console.log(
  siteAperture.geometricSensitiveAperture
    .boundsFromOpticalAxisMm
);
```

The site-center lattice is a distinct physical registration contract:

- coordinates are `native-sensor-physical`: optical-axis origin, +X right, +Y down;
- `pitchXMicrometers` and `pitchYMicrometers` are explicit evidence-backed site-center spacings;
- the first site's center is explicitly registered relative to the physical imaging area's top-left edge;
- the full declared lattice, and the sensitive aperture of every site, must fit inside the supplied physical imaging area. The test allows 8 ε (about 1.8 × 10⁻¹⁵) of the imaging extent for floating-point rounding: an imaging width given as `n · pitch / 1000` mm and a far aperture edge computed as `pitch/2 + (n − 1)·pitch + pitch/2` µm reach the same exact value by different rounded operations and can differ in the last bit. Any larger excess is rejected.

Photivra does **not** derive this site pitch or origin from `NativeImageRaster`. The native effective raster and the colour-site lattice already have a structural binding, but physical placement is a separate fact.

The geometric sensitive aperture is separate from site pitch. A single fill fraction cannot recover shape or centering, so schema 0.1.0 stores explicit rectangle dimensions and a center offset.

The first resolved footprint is deliberately narrow:

- uniform axis-aligned rectangle;
- contained within one regular lattice cell;
- no neighboring geometric-aperture overlap in this model;
- normalized spatial weighting is a unit-area average;
- physical aperture area is reported separately.

The engine also derives `geometricSensitiveAreaFractionOfLatticeCell`:

```text
geometric sensitive rectangle area
----------------------------------
nominal site lattice cell area
```

This is a **geometry diagnostic**, not a calibrated sensitivity result. It does not establish QE, effective radiometric collection area, photon conversion, optical throughput or the true photodiode geometry.

Use `kind: "unresolved"` when the geometric footprint is needed but its shape and dimensions are not defensibly known. Resolution then fails closed, instead of making up a rectangle from site pitch, megapixels or a fill-factor percentage.

The first sampling-aperture model explicitly excludes:

- effective AA point splitting;
- microlens spatial redirection;
- charge diffusion;
- electrical/optical crosstalk;
- wavelength/spectral response;
- quantum efficiency;
- optical transmission/throughput;
- calibrated radiometric collection area.

Those effects may change the **effective** spatial response or sensitivity even when the geometric sensitive region is unchanged. For example, microlenses can redirect incident light toward the photosensitive portion of a front-illuminated pixel, and their effectiveness can vary with incidence angle. The geometric aperture must therefore not absorb microlens behavior silently.

Physical camera orientation remains downstream. The site lattice and aperture stay in invariant native sensor physical coordinates.

## Sensor spatial-sampling quadrature

Use `calculateSensorSpatialSamplingQuadrature()` to build deterministic spatial integration nodes (sample points with weights) for one resolved colour-sampling site. The nodes do not depend on any renderer. They combine:

1. the geometric sensitive aperture from `SensorSamplingApertureProfile`; and
2. the effective anti-aliasing point-splitting response from `SensorOpticalStackProfile`.

Composition fragment: requires previously validated bindings `binding`, `sampling`, `stack`, `topology`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  calculateSensorSpatialSamplingQuadrature
} from "@photivra/engine";

const quadrature =
  calculateSensorSpatialSamplingQuadrature({
    imagingArea: { widthMm: 36, heightMm: 24 },
    nativeRaster: {
      pixelWidth: 6000,
      pixelHeight: 4000
    },
    colorSamplingProfile: topology,
    colorSamplingBindingProfile: binding,
    samplingApertureProfile: sampling,
    opticalStackProfile: stack,
    site: { x: 100, y: 200 },
    spatialSampleCountX: 4,
    spatialSampleCountY: 4
  });

console.log(quadrature.value.nodes);
```

The first scheme is a uniform midpoint rule on a grid (tensor product) over the geometric aperture. Each AA split component multiplies that aperture quadrature.

AA composition uses **inverse source sampling**. If the optical stack says a component shifts optical energy by `+delta` on the sensor plane, a destination aperture point reads the optical field before the AA filter (pre-AA) at:

```text
pre-AA source = destination aperture point - AA displacement
```

The destination sensor site's CFA colour channel applies to every node. A shifted pre-AA source coordinate is a location in the optical field, not another CFA site, so it never changes the destination CFA channel.

Two measures are returned separately:

- `combinedNormalizedSpatialWeight` — dimensionless weight for approximating a spatial average;
- `combinedAreaMeasureSquareMicrometers` — geometric area measure for approximating a spatial area integral.

The area measure is **not** effective radiometric collection area, throughput, QE or photon count.

Near the sensor edges, AA inverse-source coordinates may fall outside the active physical imaging area. Those nodes stay valid and are kept. Photivra does not clamp them, drop them or renormalize the remaining weights. The renderer or optical-field provider decides what to do about source coverage.

The API deliberately returns only geometry and measures. It does not evaluate optical-field values, radiance, spectral response, photons/electrons, temporal exposure, RAW values or reconstruction. Spatial and temporal quadrature stay separate until a later, explicit composition evaluates a common field.

How large the integration error is depends on the detail (spatial frequencies) in the optical field being integrated. So Photivra does not report a convergence or error estimate from geometry alone. Reference rendering can compare increasing spatial sample counts on the quantity actually being integrated.

A per-site safety limit on the number of nodes stops malformed or untrusted counts from creating an oversized array in one call.

## Sensor spatial-sample reduction

Use `reduceSensorSpatialSamplingQuadrature()` after a renderer or optical model has evaluated one scalar value at the `preAntiAliasingSourcePointMm` of every spatial quadrature node.

Node values are matched by the node's identity — AA component index plus aperture X/Y sample indices — not by array position.

Two input domains are supported:

- `relative-linear`: a nonnegative dimensionless irradiance-like proxy for deterministic regression/testing;
- `radiometric-irradiance`: physical sensor-plane irradiance in W/m².

The physical domain uses the standard radiometric meaning. Irradiance is incident radiant flux per unit area, so integrating W/m² over the geometric aperture area gives the incident radiant flux in watts. This is still before CFA spectral response, microlens response, QE, exposure-time integration and sensor conversion.

The reducer returns both a normalized spatial average and an area-weighted integral. For relative values the area integral is relative value × µm². For physical irradiance it is converted to watts.

The CFA `channelId` is descriptive metadata only. No wavelength-dependent filter or sensor response is applied. The output is therefore **not** a physically colour-filtered mosaic value, and must not be called RAW.

Every quadrature node needs an explicit, non-negative, finite input, including nodes whose pre-AA source coordinate lies outside the active imaging area. The reducer never clamps, zero-fills, extrapolates, drops or renormalizes missing edge support.

Outside this contract: signed colour-transform intermediates, RGB display values, gamma-encoded values, radiance, spectral irradiance, temporal exposure, photons/electrons, noise, saturation, black level, ADC quantization, RAW codes and demosaicing/reconstruction.

## Sensor spectral response

The spectral response says how strongly each sensor channel responds at each wavelength.

- `parseSensorSpectralResponseProfile()` declares the wavelength-dependent response for exact channel IDs from a linked `SensorColorSamplingProfile`.
- `resolveSensorSpectralResponseAtWavelength()` evaluates one channel at one wavelength.

The first contract supports three kinds of evidence:

- **direct effective external QE** — a dimensionless response (generated charge per incident photon) for the declared response scope;
- **direct effective spectral responsivity** — in A/W (amperes per watt), a different physical representation;
- **separable channel-filter transmittance × detector external QE** — only when both parts are independently established and explicitly declared separable.

Do not split a real measured effective response into filter and detector parts when the source does not support that split. And do not apply upstream optical or filter terms again to a response whose scope already includes them.

Curve rules are intentionally strict:

- wavelength unit is nanometres;
- wavelength basis is explicitly `air`, `vacuum`, or `unspecified`;
- calibrated response may not use an unspecified wavelength basis;
- sample wavelengths are strictly increasing;
- fraction curves are constrained to [0, 1];
- A/W responsivity is nonnegative;
- interpolation is piecewise-linear;
- requests outside the declared wavelength range fail closed;
- Photivra never assumes response becomes zero outside the measured range.

Embedded numeric curves with several points need at least one `reusable-data` or `photivra-owned` evidence record. Publicly viewable or manufacturer curves that are only factual reference material may guide research, but cannot be copied into the public engine without reuse rights.

Channel IDs stay exact. If two mosaic positions need different green response curves, the colour topology must use distinct IDs such as `green-a` and `green-b`. One shared `green` ID means one shared channel in this contract.

The resolver validates the whole spectral profile against the linked topology. Unknown channels fail closed. Layered-colour topology still fails closed, because its per-layer spatial relationship is unresolved.

Optional reference temperature, incidence angle and polarization metadata may record the conditions under which a curve applies. Schema 0.1.0 does not model how the response changes with those conditions.

This foundation performs **spectral lookup only**. It does not:

- integrate spectral irradiance over wavelength;
- convert A/W responsivity to QE or vice versa;
- calculate photons or electrons;
- apply temporal exposure integration;
- generate RAW values;
- demosaic/remosaic or reconstruct pixels.

Those remain explicit downstream steps.

## Sensor spectral quadrature

Use `calculateSensorSpectralQuadrature()` to build a deterministic plan of wavelength samples for one exact sensor-response channel. The plan comes before any source spectrum or sensor response is integrated.

Composition fragment: requires previously validated bindings `colorSamplingProfile`, `spectralResponseProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import { calculateSensorSpectralQuadrature } from "@photivra/engine";

const plan = calculateSensorSpectralQuadrature({
  colorSamplingProfile,
  spectralResponseProfile,
  channelId: "red",
  wavelengthBasis: "air",
  wavelengthRangeNanometers: {
    minimum: 400,
    maximum: 700
  },
  maximumSubintervalWidthNanometers: 5,
  additionalBreakpointsNanometers: [500, 600]
});

console.log(plan.value.nodes[0]?.wavelengthNanometers);
console.log(plan.value.nodes[0]?.wavelengthMeasureNanometers);
```

How the plan is built:

1. The segment boundaries are the edges of the requested range, every applicable knot of the sensor-response curve, and any breakpoints you supply.
2. Each segment is split until every midpoint subinterval is no wider than `maximumSubintervalWidthNanometers`.

`wavelengthMeasureNanometers` is **dλ in nanometres**. `normalizedWavelengthWeight` is just that wavelength measure divided by the total requested span. Neither value includes QE, A/W responsivity, channel-filter transmission, lens transmission, source power, photon flux or any other physical response factor.

The requested wavelength range must lie entirely inside the selected channel's usable declared range. Photivra does not clip, extrapolate or silently zero-fill the response outside that range. This check proves only that **the sensor response covers the range**. It does not prove that scene spectral data, optical transmission or any other wavelength-dependent input covers it too.

`additionalBreakpointsNanometers` is for known interpolation knots or discontinuities from other **continuous spectral-density** factors. The values must be strictly increasing, with no duplicates, and strictly inside the requested range. This API does not read those external spectra, and makes no claim about their provenance or validity.

The plan keeps the selected response kind, response scope, scientific status, uncertainty declaration and response-data evidence. But it deliberately **does not apply response values at the nodes**. That matters because:

- external QE is a dimensionless efficiency (generated charge per photon);
- spectral responsivity in A/W maps incident radiant power to electrical current;
- those two representations need different, compatible source and signal meanings downstream, and must not be collapsed into one integration formula;
- the response scope must be matched to the source plane and collection area, so upstream transmission is neither left out nor counted twice.

The first quadrature contract is for continuous spectral densities. Discrete, delta-like emission lines need a separate explicit representation; they must not be hidden inside a midpoint grid.

A bounded wavelength step, aligned to the known response knots, makes sampling deterministic, but does not prove convergence for an arbitrary integrand. The planner therefore reports no numerical error estimate that ignores the source.

This foundation still does **not**:

- evaluate scene spectral irradiance or spectral photon irradiance;
- apply sensor response;
- validate a common spectral interval across scene, optics, and sensor data;
- combine spectral nodes with spatial or temporal quadrature;
- calculate radiant energy, photons, electrons, current, noise, ADC values, or RAW codes;
- perform demosaic/remosaic or reconstruction.

Those remain later explicit, versioned composition steps.

## Sensor spatio-spectral irradiance reduction

Use `reduceSensorSpatioSpectralIrradiance()` after a renderer or optical model has evaluated spectral irradiance at every Cartesian product of:

- one spatial quadrature node's `preAntiAliasingSourcePointMm`; and
- one spectral quadrature wavelength.

The required source value is E_λ(x,y), spectral irradiance, in **W/m²/nm**.

Composition fragment: requires previously validated bindings `sampleValues`, `spatialPlan`, `spectralPlan`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  reduceSensorSpatioSpectralIrradiance
} from "@photivra/engine";

const reduced =
  reduceSensorSpatioSpectralIrradiance({
    spatialQuadrature:
      spatialPlan.value,
    spectralQuadrature:
      spectralPlan.value,
    sampleValues
  });

console.log(
  reduced.value
    .wavelengthIntegratedSpatialAverageIrradianceWattsPerSquareMeter
);
console.log(
  reduced.value
    .wavelengthIntegratedGeometricApertureIncidentFluxWatts
);
```

The reducer validates both plans again at runtime, and requires `colorSamplingProfileId` and `channelId` to match exactly. A shared label such as `"red"` is not enough to show that two independently created plans belong to the same colour topology.

Each supplied sample identity contains the full spatial-node identity, `spectralSampleIndex` and the exact wavelength. Array order does not matter. Every spatial × spectral pair must be present exactly once.

The Cartesian product has its own **safety limit of 100,000 values**. The spatial and spectral plans may each be within their own limits while their product is still too large to build safely.

For each wavelength node, Photivra computes:

- a normalized spatial-average spectral irradiance in W/m²/nm;
- geometric-aperture incident spectral flux density in W/nm.

It then multiplies those densities by that node's `wavelengthMeasureNanometers` and sums across the requested wavelength interval, yielding:

- wavelength-integrated spatial-average irradiance in W/m²;
- wavelength-integrated geometric-aperture incident flux in W.

Because the source density is **per nanometre**, `dλ` stays in nanometres in this multiplication. Do not multiply by 10⁻⁹ unless the spectral density has also been converted from per-nanometre to per-metre.

The geometric-aperture flux stays a **geometric incident-flux** result. The current aperture model does not establish effective collection area, microlens collection efficiency or any other radiometric area correction.

This reducer deliberately stops **before the sensor response**. The wavelength plan is derived from the response, but no QE, A/W responsivity or channel-filter transmission is applied. The response scope is carried along but not yet matched to a declared source plane. That avoids two invalid shortcuts:

- treating QE as though it were an energy weighting on W/m²/nm;
- treating A/W responsivity as though it were a photon-to-electron efficiency.

Temporal exposure integration, photons/electrons, electrical current, noise, ADC/RAW conversion, and reconstruction also remain downstream.

The current AA point-splitting kernel is a normalized spatial redistribution approximation that does not vary with wavelength. Spectral variation in the supplied E_λ(x,y) can still represent wavelength-dependent optics or scene structure upstream, but this reducer does not invent wavelength dependence in the AA kernel itself.

As with the spatial and spectral planners, no convergence or error estimate is reported independently of the source. Reference work should test convergence on the actual integrand by increasing spatial and/or wavelength sampling.

## Sensor response application compatibility

Use `assessSensorResponseApplicationCompatibility()` before the typed sensor-response conversions. The assessment is deliberately a **structural gate** (a check that it is valid to apply the response). It does not apply the response.

It needs an evidence-backed `SensorResponseApplicationProfile`. That profile binds one exact spectral-response profile and channel to the sampling-aperture and optical-stack identities used by the spatial plan. It also declares:

- the response's incident-area normalization;
- whether a single wavelength-only response can be treated as uniform/separable over the geometric sensitive aperture;
- how response reference conditions are handled.

The caller separately declares whether the supplied radiometric field is at the `sensor-package-incident` or the `site-incident` response reference plane. That declaration carries provenance.

The response scope and the source plane must match exactly:

- `sensor-package-incident-effective-channel-response` requires a sensor-package-incident source;
- site-incident effective response and separable channel-filter × detector-EQE require a site-incident source.

The current spatio-spectral reducer integrates flux over the **geometric sensitive aperture** only. So the first compatibility gate accepts a response only when its incident-area basis is that same geometric sensitive aperture, and its declared area matches. A response normalized to the full site cell, or to an effective collection area, is reported as blocked instead of being silently reused.

This matters for common image-sensor QE conventions. A total-pixel QE can be defined against photons landing on the whole pixel area, so it may already include fill-factor and microlens effects. Such a response cannot be swapped for a curve normalized to photons landing only on the geometric sensitive aperture.

Spatial response is a separate gate. Reducing the field spatially before applying one scalar response R(λ) assumes the response is effectively uniform (separable) across the integrated aperture. If that is not established, the gate blocks applying the response after spatial reduction, because the physically correct model may need R(λ,x,y) at the original spatial nodes.

Reference conditions also fail closed. With `exact-match-required`, the response must declare reference conditions, and the caller must supply a matching operating temperature, incidence angle and/or polarization for every condition in that reference. `assume-compatible` is allowed only as an explicit, evidence-backed approximation with a stated limitation.

An unresolved wavelength basis blocks the gate.

A successful assessment reports the authorized signal path:

- EQE and filter×EQE → `photon-rate-to-electrons`;
- A/W responsivity → `radiant-power-to-current`.

Even a successful assessment keeps `signalConversionAuthorized: false`. Whether the response is linear over the signal level (dynamic range) is checked by the next gate. No response, photon/electron, current, temporal, noise, ADC, RAW or reconstruction calculation is done here.

## Sensor response operating range

Use `assessSensorResponseOperatingRange()` after structural response compatibility has passed. This second gate asks a narrower question: is the **instantaneous optical input** inside a range where the detector's linearity has been explicitly measured?

The operating-range profile is evidence-backed, and keeps the quantity that was actually calibrated:

- wavelength-integrated geometric-aperture radiant power in W; or
- wavelength-integrated spatial-average irradiance in W/m².

Photivra does not substitute one for the other.

The profile also declares:

- the applicable air/vacuum wavelength basis;
- a wavelength interval that must contain the reduction's requested interval;
- the inclusive optical-input range;
- the maximum absolute relative response deviation accepted as "linear" for that range;
- scientific status and uncertainty;
- reference temperature/incidence-angle/polarization conditions and their matching policy.

The assessment first requires the earlier structural compatibility result to be unblocked, and to refer to the same response application, spectral response, colour topology and channel. It then checks the wavelength basis and range, the optical input level, and the conditions of the linearity calibration.

The profile also tells **broadband-only** validation apart from **per-spectral-bin** validation. Broadband-only evidence can show that the total optical input is inside a measured range, but it cannot authorize wavelength-dependent EQE or A/W conversion.

For `per-spectral-bin` applicability, the profile declares a maximum supported bin width. Each wavelength node's own integrated power or irradiance contribution must stay inside the calibrated range, and no quadrature bin may be wider than that width. This stops one over-range wavelength band from hiding inside an acceptable broadband total. It also stops a wide numerical bin from passing as a narrowband calibration point.

Only an unblocked per-bin assessment can set `responseRateConversionAuthorized: true`. That authorization is deliberately limited to an **instantaneous conversion of rates**.

It does **not** establish:

- exposure-domain characteristic-curve linearity;
- accumulated-charge/full-well saturation;
- conversion-gain linearity;
- readout/amplifier linearity;
- ADC linearity or clipping;
- RAW-code validity.

Those depend on integration over time and on downstream electronics, and have their own gates. In particular, a detector can be linear over a given range of incident power while a camera exposure still saturates after a long enough integration time.

The first operating-range model also does not infer a valid wavelength interval from one or a few isolated linearity measurements. If a source shows linearity only at specific wavelengths, do not make up a continuous wavelength range from them.

## Photon energy wavelength basis

Use `calculatePhotonEnergyFromWavelength()` when a later photon-domain calculation needs the photon energy hν.

For a wavelength measured in vacuum, Photivra uses the exact SI defining constants:

- h = 6.62607015 × 10⁻³⁴ J·s (Planck constant);
- c = 299792458 m/s (speed of light).

The calculation is ν = c / λ_vac and E_photon = hν.

A wavelength measured in **air** cannot be put directly into hc/λ, because light is slightly slower in air. The caller must supply a sourced phase refractive index at that **exact wavelength**, using the explicit definition:

`n = λ_vacuum / λ_air`.

Photivra then computes `λ_vacuum = n × λ_air` before deriving frequency and photon energy.

The air refractive-index sample carries a scientific status, uncertainty, evidence and an optional reference atmosphere. Calibrated samples need a quantified relative uncertainty, plus reference temperature and pressure.

The refractive index of air also depends on atmospheric conditions. So a photon-energy calculation from an air wavelength needs one of two policies:

- `exact-match-required`: the caller supplies operating atmosphere conditions that match the refractive-index reference temperature/pressure and any declared humidity/CO₂ fields;
- `assume-compatible`: an explicit evidence-backed approximation with a limitation.

Photivra never silently sets n = 1.

The foundation keeps the refractive-index uncertainty, but does **not** carry it through into the derived photon energy. It also does not apply QE, calculate a photon rate, generate electrons, integrate over exposure time, or model saturation or noise.

## EQE electron-rate conversion

This converts light into an expected rate of generated electrons. Use `calculateSensorEqeElectronRate()` only after both gates above have passed: the structural response-application assessment, and the instantaneous operating-range assessment.

Besides those assessments, the converter takes the original colour-sampling and spectral-response profiles.

- Spectral planning carries an exact, canonical binding to the response-channel data through the reduction.
- The converter re-parses the supplied response once and requires that binding to match exactly.
- So matching IDs, or even matching evidence references, are not enough if the numeric calibration samples differ.

The canonical binding is a deterministic identity of the exact data, used to detect stale or swapped calibration data. It is not a cryptographic checksum or a security boundary.

The calculation stays inside the wavelength quadrature. For every spectral node it computes:

1. radiant-power contribution = geometric-aperture spectral flux density × `dλ`;
2. photon energy (hν), using the photon-energy wavelength-basis foundation;
3. incident photon rate = radiant power / photon energy;
4. effective external QE at that exact wavelength through the existing spectral-response resolver;
5. expected generated-electron rate = photon rate × effective QE.

Direct effective EQE stays direct. When the response profile explicitly declares channel-filter transmittance × detector EQE as separable, the existing resolver is the only place those terms are multiplied. The converter does not invent or repeat filter composition.

The response is applied **at each wavelength node**. Photivra never multiplies total broadband radiant power by one average QE.

Applying the response after spatial reduction also needs the operating-range profile to establish **linear superposition over the geometric sensitive aperture**. If that declaration is missing, it stays `not-established` and rate conversion is blocked. This stops spatial averaging from silently hiding a nonlinear response inside the aperture.

The EQE converter also requires the operating-range assessment's per-bin identities and calibrated-domain values to match the exact wavelength nodes in the reduction. A stale assessment cannot be reused after the spectral power, node width, wavelength or identity changes.

For air-wavelength spectral nodes, the caller supplies exactly one sourced phase-refractive-index record per spectral sample identity, plus the atmosphere compatibility policy used for photon energy. Vacuum-wavelength conversion accepts no air-index context.

The output reports:

- incident photon rate in photons/s;
- expected generated-electron rate in electrons/s;
- per-wavelength power, photon energy, QE and rate contributions;
- whether channel-filter transmission was part of an explicitly separable response.

Kahan compensated summation (which limits rounding error) is used across wavelength nodes.

This is still **rates only**. The converter does not:

- multiply by exposure time;
- output photon or electron counts;
- assess full-well/saturation;
- apply photon shot noise or read noise;
- calculate current from A/W responsivity;
- perform ADC/RAW conversion or reconstruction.

This API rejects A/W spectral responsivity; that is a separate radiant-power → current path (below).

Response, refractive-index and quadrature uncertainties stay visible upstream, but are not yet combined into an electron-rate uncertainty.

## A/W responsivity photocurrent conversion

Use `calculateSensorResponsivityPhotocurrent()` for the sibling path, which works in electrical current, when the spectral response is explicitly calibrated in **A/W**.

The same structural and operating-range gates used by EQE still apply:

- exact linkage between response and profiles;
- matching response reference plane and area basis;
- spatial response uniformity/separability;
- linear superposition over the geometric aperture;
- explicit per-spectral-bin operating-range applicability.

The exact canonical response-channel binding must also match the curve data used upstream. The same IDs and evidence with altered A/W samples are rejected.

For every spectral node Photivra computes:

1. radiant-power contribution = geometric-aperture spectral flux density × `dλ`;
2. spectral responsivity in A/W at that exact wavelength using the authoritative response resolver;
3. photocurrent-magnitude contribution = radiant power × responsivity.

The wavelength contributions are summed with Kahan compensated summation.

A/W also has an extra **electrical calibration applicability** contract. `SensorResponsivityElectricalApplicabilityProfile` binds the response pipeline to the electrical conditions of the detector under which the A/W calibration is meant to apply:

- zero-bias photovoltaic operation or reverse bias with an explicit magnitude;
- virtual-ground current readout or a finite declared input impedance;
- exact-match or explicit evidence-backed compatibility-approximation policy.

These fields say when the calibration applies; they are not a circuit simulator. In particular, Photivra does not use a declared input impedance to claim that a transimpedance circuit is adequate. It only checks that the operating condition matches the calibration contract.

The electrical categories do not overlap. `reverse-biased` needs a strictly positive reverse-bias magnitude; true zero-bias operation uses `zero-bias-photovoltaic`. A finite input impedance must also be strictly greater than zero.

The spectral A/W curve is treated only as a **quasi-static, steady-state** power → current relation. This first path does not model detector impulse response, modulation bandwidth, settling time or frequency-dependent responsivity. A future integrator for time-varying current must add a separate temporal-response contract before it can handle rapidly changing optical power.

The result is a **non-negative photocurrent magnitude at the detector terminal, in amperes**. Photivra deliberately does not assign a circuit direction (polarity) from the optical response curve.

The A/W path does **not**:

- use photon energy or calculate photon/electron rate;
- convert current to accumulated charge;
- apply exposure duration;
- apply transimpedance gain or offset;
- calculate detector/readout voltage;
- establish amplifier or ADC linearity;
- assess full-well/saturation;
- add shot/read noise;
- produce RAW values or reconstructed pixels.

Those remain later explicit stages.

## Local sensor-rate/exposure binding

Each sensor site can have its own exposure window (for example with a rolling shutter). Use `bindSensorRateToLocalExposure()` to find that window before any response-rate result is integrated over time.

EQE electron-rate and A/W photocurrent results produced by the engine keep the exact abstract colour-sampling site that generated them. The binding resolves that site against the exact colour topology and the existing native-effective-raster / colour-site binding, then selects the local shutter window.

The first timing registration is deliberately narrow: `sitesPerNativeSampleX` and `sitesPerNativeSampleY` must both equal 1. Under that evidenced shared-top-left relationship, colour site `(x, y)` maps to the native effective sample center `(x + 0.5, y + 0.5)`.

A binding of multi-site blocks is **not** enough to infer timing coordinates inside one sample. When one native effective sample spans several colour sites, Photivra fails closed, rather than inventing where each site lies inside that sample for a shutter scan that varies across the sensor.

The binding then calls the authoritative capture exposure-window calculation at that exact native point. It checks that:

- the rate carries a valid site;
- the bound color site exists and resolves to the same channel as the rate;
- the binding belongs to the same color topology and exact native raster used by the exposure schedule;
- the bound point lies inside the active capture;
- the local window has positive finite duration.

The result preserves local start/end offsets and duration in the exposure schedule's `first-opening-boundary-phase` time basis.

This is a **timing binding only**. It explicitly reports:

- no physical-photodiode timing registration;
- no multi-frame sequence binding;
- no time-stationarity guarantee;
- `constantRateTemporalIntegrationAuthorized: false`.

So a response rate may **not** yet be multiplied by this duration. Motion, flicker, flash, time-varying illumination or vignetting, shutter modulation and detector transients all need a time-dependent signal model. The constant-rate approximation needs a separate stationarity contract (next section).

## Constant-rate local-exposure integration

Use `integrateStationarySensorRateOverLocalExposure()` only when an evidence-backed `SensorRateTemporalStationarityProfile` explicitly states that the **reported rate itself** stays constant through the exact local exposure window.

The stationarity declaration is bound to:

- EQE-vs-A/W rate domain;
- color topology/channel/site;
- local-exposure binding ID;
- exact local start/end offsets in the `first-opening-boundary-phase` time basis.

It therefore cannot be silently reused for a different site or shutter window.

Under that explicit model, temporal integration is exactly:

`accumulated quantity = reported rate × local exposure duration`.

For the EQE path:

- incident photon rate becomes **expected incident photon count**;
- expected generated-electron rate becomes **expected generated-electron count**;
- expectation values remain floating point and are not rounded or stochastically sampled.

For the A/W path:

- detector-terminal photocurrent magnitude becomes **photocharge magnitude in coulombs**;
- circuit polarity is still not inferred;
- carrier/electron count is deliberately **not** inferred from A/W current.

The A/W constant-current approximation also inherits the quasi-static detector-response limit from upstream. The stationarity evidence must justify treating the reported steady-state photocurrent as valid throughout the window. Photivra still does not model detector impulse response or bandwidth.

The result accumulates **photo signal only**. It does not include dark current, hot-pixel/defect current, leakage, charge injection or other sources of accumulated charge. So:

- physical full-well assessment is not authorized;
- camera/digital saturation assessment is not authorized;
- no clamp is applied;
- shot/read noise, conversion gain, ADC/RAW and reconstruction remain downstream.

Physical full-well capacity and camera saturation capacity are separate, implemented assessment contracts. They are not interchangeable thresholds.

## Dark-current charge

Dark current is signal the sensor generates by heat alone, even without light. Use `calculateSensorDarkCurrentCharge()` with either a stationary EQE expected-count exposure result, or the validated compact [temporal photo signal](https://github.com/Photivra/photivra/blob/main/docs/TEMPORAL_PHOTO_RAW.md).

- Temporal dark charge keeps the exact temporal event identity, without a stationarity ID.
- The model is **thermally generated electrons before any compensation**, in e⁻/s. It integrates that rate over the exact local exposure duration already set by the temporal pipeline.

Photivra deliberately does not impose one universal law for how dark current changes with temperature. A dark-current profile may provide either:

- one exact reference temperature and one dark-current rate; or
- a strictly increasing measured temperature table with piecewise-linear interpolation and fail-closed behavior outside the measured range.

A population-mean dark-current profile (one average for all sites) is allowed only as an explicit approximation. It must not claim that site-to-site dark-current variation is modelled. Exact-site profiles stay bound to the exact colour-sampling site.

Dark-current compensation, black-level offset, hot-pixel/defect excess, leakage, charge injection and other charge sources are separate. The result is only an **expected dark-electron count**. No Poisson sampling, and no dark-current shot noise, is applied.

This stage still does not allow a physical full-well assessment, because the accumulated sensor charge is not complete yet. It also does not apply to the A/W current path: integrated charge at the detector terminal must not be reinterpreted as stored sensor electrons without a separate carrier/storage mapping.

## Accumulated-charge completeness

This step adds up everything stored in a pixel during one exposure. Use `composeSensorAccumulatedCharge()` once you have an EQE photo-signal exposure and its matching dark-current result for the **same exact local exposure event**.

The photo and dark terms must share:

- color topology/channel/site;
- local-exposure binding ID;
- stationarity profile ID where applicable;
- exact start/end offsets in the `first-opening-boundary-phase` time basis;
- the same local exposure duration.

An equal duration alone is not enough.

Extra stored-electron components may represent explicitly modelled defect/hot-pixel excess, leakage, charge injection, clock-induced charge or another identified source. Every component must declare the accounting meaning `incremental-stored-electrons-beyond-photo-and-modeled-dark-current`. This stops an extra defect or leakage model from silently counting electrons that the dark-current term already includes.

A separate, evidence-backed `SensorAccumulatedChargeCompletenessProfile` lists the exact extra-component IDs, and states that every material contributor of stored electrons, relevant to physical charge-storage capacity, is accounted for. An empty list of extra components is therefore **not, by itself, evidence of completeness**.

When all bindings and the completeness declaration pass, the result reports:

- expected photo electrons;
- expected dark electrons;
- expected additional stored electrons;
- total expected stored electrons.

All of these are expected values. No photo or dark shot noise is sampled, and no whole-number carrier counts are drawn.

Only this complete stored-electron result sets `physicalFullWellAssessmentAuthorized: true`. Camera/digital saturation stays unauthorized here, because camera saturation capacity is not the same physical quantity as full-well charge storage.

A/W photocharge stays outside this composition, because coulombs at the detector terminal are not automatically the number of electrons stored in the pixel's charge well.

## Physical charge-capacity

Full-well capacity is the most charge a pixel can physically store. Use `assessSensorPhysicalChargeCapacity()` only after accumulated-charge completeness has explicitly authorized a physical capacity assessment.

A `SensorPhysicalChargeCapacityProfile` describes a sourced physical charge-storage limit in **electrons**. The profile is bound to:

- exact color topology/channel;
- exact site, or an explicit uniform-site approximation;
- an evidence-backed operating-state identifier;
- exact reference temperature, or an explicit approximation stating temperature dependence is not modeled.

The operating-state identifier is deliberately opaque. Photivra does not guess the physical storage capacity from ISO, gain labels, capture-mode names, pixel pitch or any other nearby specification.

The assessment compares **total expected stored electrons** with the physical capacity and reports:

- charge/capacity ratio;
- expected headroom in electrons;
- `below-capacity`, `at-capacity`, or `above-capacity`;
- whether the unsaturated expected charge exceeds the declared capacity.

This compares expected values; it does not simulate random saturation. Expected charge below capacity does not prove that every noisy realization stays below capacity. Expected charge above capacity means the linear expectation, before any saturation, exceeds the physical storage limit.

Photivra does **not** clamp the charge at capacity. It does not calculate stored charge after saturation, overflow charge, recombination, anti-blooming drain behaviour or blooming into neighbours. Those need a separate nonlinear charge-transfer model.

Physical charge capacity is also **not camera saturation capacity**. Clipping in the camera's analog or digital chain can happen at a lower signal level, so camera saturation is a separate contract (next section).

## Camera saturation capacity

Use `assessSensorCameraSaturationCapacity()` for a **saturation capacity of the camera's response chain**, taken from a specific source and expressed as dark-corrected photo signal in electron equivalents.

This contract intentionally uses a different signal domain from physical charge storage:

- the comparison input is `photoExpectedElectronCount`;
- total photo + dark + other stored charge is retained only as a diagnostic;
- total stored charge is **not** added to the camera-signal capacity comparison.

That separation follows camera-characterization practice. There, saturation capacity is derived from the camera's saturated photo response, and can be lower than physical full well because a later stage may clip first.

A camera saturation profile is bound to the exact colour/channel, site applicability, operating-state identifier, temperature applicability, measurement method, uncertainty and evidence. A mean over a channel's population used for one site stays an approximation.

The assessment reports the photo-signal/capacity ratio, the headroom, and a below/at/above-capacity status. It does not:

- identify which analog or digital stage limits the response;
- infer an ADC maximum code or bit-depth clipping threshold;
- reuse physical full-well capacity;
- modify physical stored charge;
- clamp the output signal;
- calculate a post-saturation transfer curve;
- establish stochastic saturation probability.

Analog clipping at a specific stage, ADC/digital code limits and RAW-code behaviour need separate, evidence-backed response-chain contracts.

## Stochastic charge, conversion, ADC, and RAW code

This is where random noise enters, and where charge becomes a RAW number. Use `simulateSensorChargeRealization()` only after the accumulated-charge completeness contract has produced the complete expected stored charge for one exact sensor site and exposure.

The first random (stochastic) layer keeps expected values separate from realizations (random draws):

- photo-generated electrons use an explicit Poisson model;
- dark-generated electrons use an explicit Poisson model;
- each additional stored-charge component must declare its own Poisson or deterministic electron-equivalent policy;
- the realization uses an explicit deterministic 32-bit seed, scrambled by the MurmurHash3 `fmix32` finalizer so nearby seeds give unrelated streams;
- electronic read noise is still downstream.

The stochastic realization does not change the upstream expected charge or its provenance.

Use `parseSensorReadoutConversionProfile()` and `resolveSensorReadoutRegime()` for the electronic chain that follows. A regime declares:

- system conversion gain in electrons per code;
- explicit input-referred electronic read-noise components in RMS electrons;
- a pre-ADC electron-equivalent saturation threshold;
- ADC bit depth;
- black-level code;
- digital saturation code;
- deterministic uniform round-half-up quantization.

Regime selection is explicitly:

`explicit-upstream-camera-state-not-inferred-from-iso`

So ISO never silently chooses conversion gain, read noise or ADC behaviour. The separate [generic ISO signal-chain contract](#generic-high-iso-signal-chain-profiles) (#7) maps an explicit camera ISO/capture-mode state to a documented readout regime (#14). The sensor readout contract itself still does not infer that mapping from the ISO number.

`calculateExpectedSensorReadout()` stays an expected-value path. It reports zero-mean read noise and does not quantize. If the upstream expected stored charge is already above physical storage capacity, it fails closed, because the physical-capacity assessment does not define a linear charge value after saturation.

Both readout paths require the physical-capacity assessment to have been computed for the same charge. Besides a matching identity, its total expected stored electrons must equal the charge's total exactly (the assessment copies that total verbatim). A stale assessment therefore fails closed. On both the expected and the stochastic path, digital saturation is reported when the code reaches (`>=`) the digital saturation code, so a sample quantized exactly to the white level is flagged.

`simulateSensorRawCode()` consumes a stochastic charge realization plus the matching physical-capacity assessment. Its stage order is explicit:

```text
realized stored charge
  → scalar physical storage-capacity clamp
  → electronic read-noise realization
  → pre-ADC electron-equivalent saturation
  → system conversion gain
  → black-level code offset
  → ADC quantization
  → digital saturation clamp
  → RAW code
```

The physical storage clamp is only a bounded scalar approximation. Overflow is reported as a diagnostic. `bloomingModeled` stays false, because neighbour topology, charge transport and anti-blooming behaviour are not modelled.

Physical storage capacity, pre-ADC saturation and digital/ADC saturation are independent thresholds, and may disagree.

Quantization rounds to the nearest code, with exact ties going towards +∞. A regime may also declare:

- `adc.digitalGain` (≥ 1), applied around black after quantization and then re-quantized;
- `adc.integralNonLinearity`, a piecewise-linear INL (integral non-linearity) in codes.

### ISO-dependent gain regimes

`createIsoGainReadoutRegimes()` derives one explicit regime per ISO setting from declared sensor parameters. ISO then
changes RAW brightness the way analog/digital gain does (exposure index of CIPA DC-004; EMVA 1288 linear model):

```ts
import { createIsoGainReadoutRegimes, parseSensorReadoutConversionProfile } from "@photivra/engine";

const evidence = [{ sourceOrigin: "photivra", sourceReference: "my-sensor-design", reuseStatus: "photivra-owned" }] as const;
const { regimes, standardRegimeBands } = createIsoGainReadoutRegimes({
  regimeIdPrefix: "", scientificStatus: "approximation", baseExposureIndex: 100,
  exposureIndices: [100, 200, 400, 800, 1600, 3200],
  baseSaturationElectronEquivalent: { value: 30000, evidence }, // electrons at ADC white, ISO 100
  maximumAnalogGain: { value: 16, evidence },                      // ISO 3200 adds 2x digital gain
  adc: { bitDepth: 14, blackLevelCode: 1024, digitalSaturationCode: 16383 },
  conversionGainModes: [
    { mode: "low-conversion-gain", minimumExposureIndex: 100, readNoiseRmsElectrons: { value: 3, evidence } },
    { mode: "high-conversion-gain", minimumExposureIndex: 800, readNoiseRmsElectrons: { value: 1.2, evidence } }
  ],
  evidence, limitations: ["Illustrative design values, not a measured camera."]
});
const readoutProfile = parseSensorReadoutConversionProfile({ schemaVersion: "0.1.0", profileId: "my-readout",
  colorSamplingProfileId: "my-cfa", channelId: "green",
  regimeSelectionOwnedBy: "explicit-upstream-camera-state-not-inferred-from-iso", regimes, evidence });
// standardRegimeBands binds each ISO to its regime in a GenericIsoSignalChainProfile.
```

### Fixed-pattern noise

Fixed-pattern noise is the part of sensor noise that is the same in every frame from one sensor.
`parseSensorFixedPatternNoiseProfile()` declares an opt-in pattern for one sensor instance: PRNU and DSNU (pixel-to-pixel
variation in light response and in dark signal), hot pixels, and row and column offsets.

- The pattern is seeded by `sensorInstanceSeedUint32`, independent of the capture noise seed.
- Pass the same profile as `fixedPatternNoise` to `simulateSensorChargeRealization()` and `simulateSensorRawCode()`, or on every producer site.
- `calculateSensorFixedPatternSite()` returns the deterministic values for one colour-sampling site.
- The generic tier presets carry a synthetic profile in `body.fixedPatternNoise`.

## RAW capture samples and reconstruction

Use `createSensorRawCaptureSample()` to bind one generated RAW code to the existing capture-mode / colour-sampling structure.

Schema 0.1.0 deliberately allows only an ungrouped native-effective capture-mode sample that maps to exactly one colour-sampling site. Grouped, binning and remosaic modes fail closed, because knowing how many sites contribute does not define the weights or the analog/digital maths for combining them.

The RAW sample preserves:

- absolute native full-frame sample coordinate;
- absolute sensor/CFA site coordinate;
- exact channel identity;
- raw/black/digital-saturation code values;
- readout regime identity;
- charge/read-noise seeds;
- physical/digital saturation diagnostics.

Physical orientation and output rotation come later, so CFA phase is never reset by portrait orientation or an active crop.

Use `parseSensorRawReconstructionProfile()` and `resolveSensorRawReconstruction()` for the first reconstruction contract (turning mosaic samples into full-colour pixels). The profile is tied to one exact capture-mode ID and colour-sampling profile ID. It declares explicit linear weights over the native neighbourhood, per output channel.

Every input RAW sample is re-checked against the declared colour-sampling topology. A stored channel label that disagrees with the CFA at that native site fails closed.

The first reconstruction contract:

- preserves negative black-subtracted linear values;
- leaves RAW samples unchanged;
- applies no sharpening or denoising;
- does not infer branded Bayer/X-Trans/remosaic behavior from a topology label;
- reports `aliasingModeled: false` and `moireModeled: false`.

Claims about aliasing or moiré need an adequate model of the spatial frequencies in the scene and optics before sampling. Reconstruction artefacts alone are not treated as proof that such a physical aliasing model exists.

## RAW development, white level, highlights and tone curves

RAW samples also carry:

- `effectiveSaturationCode` — the code at which the site is fully saturated (see `calculateEffectiveSaturationCode`);
- `systemConversionGainElectronsPerCode`;
- `readNoiseRmsElectrons`.

Packed native RAW carries `effectiveSaturationCodes` once per CFA phase.

Development ("developing" a RAW into a viewable image):

- normalizes to that white level;
- clips saturated or flagged sites before white balance;
- applies white balance once, for any invertible camera matrix;
- keeps clipped highlights neutral.

See [photographic export](https://github.com/Photivra/photivra/blob/main/docs/PHOTOGRAPHIC_EXPORT.md) for the equations.

```ts
import { calculateEffectiveSaturationCode, createNativeRawDevelopmentTask, type NativeRawDevelopmentInput,
  type SdrRenderingProfile } from "@photivra/engine";

// A 20,000 e⁻ well at 1 e⁻/DN over a 512 pedestal saturates at code 20512, not at 65535.
const white = calculateEffectiveSaturationCode({ physicalChargeCapacityElectrons: 20000,
  preAdcSaturationElectronEquivalent: 30000, systemConversionGainElectronsPerCode: 1,
  blackLevelCode: 512, digitalSaturationCode: 65535 });
if (white !== 20512) throw new Error("unexpected white level");

// Luminance tone curves preserve chromaticity; existing curve ids are unchanged.
const filmic: SdrRenderingProfile = { schemaVersion: "0.1.0", profileId: "filmic", profileVersion: "1",
  renderingExposureEv: 0, toneCurve: "naka-rushton-luminance",
  toneCurveParameters: { exponent: 1.2, semiSaturation: 0.5, whiteLuminance: 4 },
  gamutHandling: "clip-components", outputDynamicRange: "sdr", transferFunction: "srgb",
  bitDepth: 8, rounding: "nearest-ties-up", dither: "none" };

async function develop(input: NativeRawDevelopmentInput) {
  // The task takes ownership of input.raw (its arrays are detached); output.raw returns it.
  const task = createNativeRawDevelopmentTask({ ...input, rendering: filmic, highlightMode: "clip" }, {
    yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    onProgress: ({ completedTileCount, totalTileCount }) => void (completedTileCount / totalTileCount)
  });
  await task.run();
  const output = task.takeOutput();
  return { pixels: output.integerSamples, raw: output.raw, saturatedPixels: output.highlight.saturatedPixelCount };
}
void develop;
```

- `highlightMode: "reconstruct"` blends pixels above 0.8 of white towards neutral, instead of clipping
  each WB-scaled channel. It is an approximation, not a recovery of the clipped signal.
- `extended-reinhard-luminance` takes `{ whiteLuminance }`, the luminance mapped to output white.
- `createPhotographicExportPair(input, { signal })` accepts an optional `AbortSignal`.

## Capture-mode profiles

One physical sensor can offer several capture modes, such as pixel shift or binning. Use `parseCaptureModeProfile()` and `resolveCaptureMode()` to describe its acquisition, sampling and reconstruction modes, without changing the sensor's identity:

```ts
import {
  parseCaptureModeProfile,
  resolveCaptureMode
} from "@photivra/engine";

const modes = parseCaptureModeProfile({
  schemaVersion: "0.1.0",
  modes: [
    {
      modeId: "pixel-shift-4",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "example:pixel-shift-mode",
          reuseStatus: "factual-reference-only"
        }
      ],
      acquisition: {
        kind: "fixed-multi-frame",
        frameCount: {
          value: 4,
          evidence: [
            {
              sourceOrigin: "manufacturer",
              sourceReference: "example:pixel-shift-frame-count",
              reuseStatus: "factual-reference-only"
            }
          ]
        }
      },
      perFrameSampling: {
        kind: "native-effective-raster"
      },
      interFrameSensorOffsetsNativeSamples: {
        value: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0, y: 0.5 },
          { x: 0.5, y: 0.5 }
        ],
        evidence: [
          {
            sourceOrigin: "manufacturer",
            sourceReference: "example:pixel-shift-offset-sequence",
            reuseStatus: "factual-reference-only"
          }
        ]
      },
      reconstructionStages: [
        {
          value: "pixel-shift-combination",
          evidence: [
            {
              sourceOrigin: "manufacturer",
              sourceReference: "example:pixel-shift-combination",
              reuseStatus: "factual-reference-only"
            }
          ]
        }
      ],
      processedImageRaster: {
        value: {
          pixelWidth: 12000,
          pixelHeight: 8000
        },
        evidence: [
          {
            sourceOrigin: "manufacturer",
            sourceReference: "example:processed-raster",
            reuseStatus: "factual-reference-only"
          }
        ]
      },
      dependencies: [
        "color-sampling-model",
        "inter-frame-registration"
      ]
    }
  ]
});

const selected = resolveCaptureMode({
  nativeRaster: {
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  profile: modes,
  modeId: "pixel-shift-4"
});

console.log(selected.processedImageMegapixels);
```

The model is deliberately **orthogonal**: it is not one list of mutually exclusive, marketing-style modes. A mode describes each of these independently:

- acquisition as single-frame, fixed multi-frame, or variable multi-frame;
- per-frame sampling as the native effective raster, exact integer grouping of native effective samples, or another explicitly evidenced effective raster;
- an optional ordered inter-frame sensor-offset sequence for fixed multi-frame modes;
- zero or more reconstruction stages such as remosaic, pixel-shift combination, and generic multi-frame computational combination;
- the processed-image raster before final output crop/resampling;
- explicit downstream model dependencies.

So a computational multi-frame mode can also use grouped per-frame sampling, instead of being forced into one exclusive category.

`NativeImageRaster` keeps its canonical meaning: an **effective native image-sampling grid**, not a raster of physical photosites. Neither native megapixels nor processed/final-output megapixels may be used to infer the physical photodiode count.

For grouped sampling, Photivra derives the per-frame sampling raster only when the native dimensions divide exactly by the evidenced grouping factors. The optional `combinationDomain` distinguishes `charge-domain`, `pre-conversion-analog` and `post-conversion-digital`. If that fact is not known, leave it out. The word "binning", or a 2×2 resolution ratio, does not show where the combination happened.

Inter-frame sensor offsets are in units of the **native effective sampling pitch**. They are not evidence of the physical photodiode pitch. When supplied, the offset sequence length must match the fixed multi-frame count.

`processedImageRaster` belongs to the capture-mode/reconstruction pipeline. It does not change the physical imaging area, crop factor, field of view or native effective raster. It may be larger than the native raster for a multi-frame reconstruction, without implying a higher-resolution physical sensor.

The final output crop/resampling is still owned by the existing staged capture/output geometry contract. A processed raster therefore does not, by itself, define final display/export dimensions or the viewing FOV.

The capture-mode schema records dependencies such as `color-sampling-model`, `mode-specific-readout-timing`, `radiometric-calibration` and `inter-frame-registration`, without pretending those models are already implemented.

## Sensor readout timing

Use `calculateSensorReadoutTiming()` for the native sensor scan schedule of one capture. This is when data is read off the sensor, which is not the same as when the shutter curtains open and close:

```ts
import {
  calculateSensorReadoutTiming,
  transformNativeRasterVectorToOriented
} from "@photivra/engine";

const timing = calculateSensorReadoutTiming({
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  activeCaptureRect: { x: 0, y: 0, width: 6000, height: 4000 },
  shutterMechanism: "electronic",
  readout: {
    readoutMode: "rolling",
    captureReadoutDurationSeconds: {
      value: 0.024,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "manufacturer-spec:example",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    scanDirectionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "manufacturer-spec:direction-example",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    spatialSamplingSkewSeconds: {
      value: 0.020,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "third-party",
          sourceReference: "measurement:spatial-skew-example",
          reuseStatus: "factual-reference-only"
        }
      ]
    }
  },
  samplePointsNative: [
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 4000 }
  ]
});

console.log(timing.value.samples);
console.log(timing.value.scan?.unitVectorNative);

const orientedDirection = transformNativeRasterVectorToOriented({
  vector: timing.value.scan?.unitVectorNative ?? { x: 0, y: 0 },
  orientation: "portrait-clockwise"
});
```

The two timing facts are deliberately separate, and Photivra does not assume they are equal:

- `captureReadoutDurationSeconds` is the declared time to read the data of the selected capture.
- `spatialSamplingSkewSeconds` only sets how much the readout time shifts from one side of the frame to the other, in the current rolling approximation.

Global readout declares only the capture's data-readout duration. Its spatial phase offset is zero everywhere, even when that duration is not zero.

The rolling schedule is a `uniform-linear-single-axis` approximation in the native sensor coordinates, which never change. `NativeImageRaster` is still an effective image-sampling grid, so this API does not claim that each raster row or column is one physical photodiode row or hardware readout line. This first model does not represent non-uniform, segmented, center-out, interleaved or multi-tap readout patterns.

- Physical camera orientation is deliberately left out of the timing input. If a renderer needs the scan direction in oriented capture coordinates, use the existing native ↔ oriented vector transform.
- Output crop and resolution are also left out, so they cannot silently change native readout timing.
- Timing for an active crop or capture mode must be supplied explicitly. The engine never scales full-frame timing from crop dimensions.
- The shutter mechanism is recorded separately and does not change the schedule.

The separate exposure-window, inverse-rotation/temporal, flash and illumination contracts provide bounded timing and integration. This readout primitive does not run them, and does not infer curtain acceleration, segmented timing or synchronization.

## Readout/exposure spatial linkage

Use `assessReadoutExposureTimingLinkage()` when a source for a specific capture mode supports a relationship between the spatial order of rolling sensor readout and an **electronic** exposure boundary:

```ts
import { assessReadoutExposureTimingLinkage } from "@photivra/engine";

const relationship = assessReadoutExposureTimingLinkage({
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  shutterMechanism: "electronic",
  readout: {
    readoutMode: "rolling",
    captureReadoutDurationSeconds: {
      value: 0.031,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "example:data-readout-duration",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    scanDirectionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "example:readout-direction",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    spatialSamplingSkewSeconds: {
      value: 0.02,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "example:measured-spatial-skew",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  nominalExposureDurationSeconds: {
    value: 1 / 1000,
    unit: "s",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "example:capture-config",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  opening: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "example:electronic-opening-direction",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.01,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "example:opening-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  closing: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "manufacturer",
          sourceReference: "example:electronic-closing-direction",
          reuseStatus: "factual-reference-only"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.01,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "example:closing-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  linkage: {
    kind: "spatial-phase-linked",
    links: [
      {
        boundary: "opening",
        phaseOrientation: "same",
        evidence: [
          {
            sourceOrigin: "manufacturer",
            sourceReference: "example:documented-spatial-relationship",
            reuseStatus: "factual-reference-only"
          }
        ]
      }
    ]
  }
});

console.log(relationship.value.links[0]);
```

A positive link means only that the selected electronic exposure boundary moves across the sensor in the same **normalized native spatial order (phase)** as the rolling readout:

- `same` means boundary phase equals readout phase;
- `reversed` means boundary phase equals `1 - readout phase`.

It does **not** mean the two events occur at the same absolute time.

So the function reports `absoluteTemporalAlignment: "not-established"`, even when the directions and the first-to-last timing spans happen to match.

The readout spatial skew and the exposure boundary's traversal time may differ. Their ratio is reported as `boundaryTraversalToReadoutSpatialSkewRatio`, for information only.

The total `captureReadoutDurationSeconds` is a separate evidence-backed fact, and plays no part in checking the linkage.

Only electronic boundaries can be linked to sensor readout in this way. A mechanical opening or closing boundary is rejected. Global readout has no rolling spatial phase, so it cannot take part in this first linkage type.

Use `linkage: { kind: "unlinked" }` when Photivra should assert no relationship. This means **no relationship is asserted**. It does not show that the underlying hardware processes are physically independent.

## Capture exposure-window timing

With a focal-plane shutter, different parts of the sensor start and stop collecting light at slightly different times. Use `calculateCaptureExposureWindows()` to describe when each native-sensor location begins and ends its local exposure. Shutter movement and sensor readout are kept separate:

```ts
import { calculateCaptureExposureWindows } from "@photivra/engine";

const windows = calculateCaptureExposureWindows({
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  shutterMechanism: "electronic-first-curtain",
  nominalExposureDurationSeconds: {
    value: 1 / 1000,
    unit: "s",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "capture-config:example",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  opening: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.004,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  closing: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.004,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  samplePointsNative: [
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 4000 }
  ]
});

console.log(windows.value.samples);
console.log(windows.value.localExposureDurationRangeSeconds);
```

The time basis is `first-opening-boundary-phase`: time zero is when the declared opening boundary first starts to cross the sensor. This avoids pretending that a capture scanned across the sensor has one universal exposure-start moment.

Opening and closing schedules are independent. Each may currently be either:

- `simultaneous`; or
- `uniform-linear-native-scan` with its own evidence-backed native direction and traversal duration.

The nominal exposure duration is a separate evidence-backed quantity. For a native point:

```text
local start = opening phase
local end   = nominal exposure duration + closing phase
local duration = local end - local start
```

Matched opening and closing scans with equal traversal times give the same local exposure duration everywhere. Different directions or traversal times can deliberately make the local duration vary across the sensor.

Photivra checks the **whole active rectangle**, not only the diagnostic points you supply. Because the first schedules are affine (linear plus offset) over the native rectangle, checking the corners is enough to reject any declaration that would give zero or negative local exposure duration anywhere in the capture.

`shutterMechanism` only says what conceptually opens and closes the exposure:

- `mechanical` → mechanical opening + mechanical closing;
- `electronic-first-curtain` → electronic opening + mechanical closing;
- `electronic` → electronic opening + electronic closing.

The mechanism does not supply traversal direction or timing.

This exposure-window model stays separate from `calculateSensorReadoutTiming()`. A later integration layer must explicitly bind exposure boundaries, sensor readout and time-parameterized motion. Photivra does not assume that a sensor readout phase is an exposure-start or exposure-end boundary.

Physical orientation and digital output geometry come later. The schedule stays in native sensor coordinates. Use the existing native ↔ oriented vector transforms when you need the direction as displayed.

The first model does not cover curtain acceleration, curved or nonlinear curtain travel, segmented/center-out/interleaved electronic schedules, flash/flicker interaction, shutter shock, pupil/bokeh effects specific to EFCS (electronic first-curtain shutter), or rolling-shutter image distortion.

## Capture-mode-bound shutter/readout timing

Use `parseCaptureModeTimingProfile()` and `resolveCaptureModeTiming()` when your exposure/readout timing evidence applies to one exact resolved capture mode.

The profile binds:

- stable timing profile ID/version;
- exact `captureModeId`;
- shutter mechanism;
- opening and closing exposure-boundary schedules;
- sensor readout timing;
- provenance and limitations.

Schema `0.1.0` supports only the timing families already modeled by Photivra:

- simultaneous/global timing; and
- uniform-linear native-sensor scans.

Segmented, center-out, interleaved or other non-uniform schedules fail closed, rather than being silently approximated.

The resolved result carries both the authoritative local exposure windows and the sensor data-readout timing, but still reports:

`readoutExposureSynchronization: "not-assumed"`

Sharing a mode/profile identity does not make the readout phase an exposure-start or exposure-end clock.

Changing only a processed/output raster does not change this timing. Timing changes only when the exact capture mode/profile, or the explicit timing facts, change.

## Depth-aware translation/parallax temporal geometry

When the camera moves sideways (translates) during an exposure, near objects shift more in the image than far ones — this is parallax. Use `calculateCaptureTranslationParallaxTemporalQuadrature()` for camera translation and parallax over the exact local exposure windows resolved above.

Unlike pure camera rotation, translation **depends on depth**. Every scene sample therefore gives a metric camera-space position with positive `z`.

The model evaluates each scene point on its own, at deterministic midpoint times:

```text
relative scene position(t)
  = reference scene position
  + (subject velocity - camera translation velocity) * t
```

This keeps camera motion and subject motion separate, while letting both happen at once.

Important limits:

- Metric scene depth is required.
- One global homography (a single 2D warp) is not allowed for arbitrary 3D translation.
- Orientation changes the reported native/oriented sample vector, not the underlying physical projection.
- Camera rotation is still a separate model.
- Visibility, occlusion and disocclusion, deformation and acceleration are left to later stages or future work.
- Sensor data-readout timing is not used as exposure timing.

So two scene points at different depths, under the same sideways camera translation, move by different amounts in the image.

## Temporal scene-radiance sampling

Use `createSceneRadianceTemporalSamplingPlan()` to generate deterministic times at which a provider or renderer should evaluate the scene, over one committed local exposure window.

The sampling plan uses the same authoritative time basis as the [exposure-window contract](#capture-exposure-window-timing) (#12):

`first-opening-boundary-phase`

Each node carries:

- deterministic node/result identity;
- local exposure phase;
- capture time in seconds;
- normalized averaging weight;
- seconds-valued integration measure.

A scene-radiance provider evaluates the scene and source state at those times. Then `reduceSceneRadianceTemporalSamples()` checks that every returned result matches the exact node, provider, scene, wavelength and time identity, before integrating.

The reducer reports both:

- average outgoing spectral radiance; and
- time-integrated spectral radiance.

Per-node evidence and uncertainty are kept. The combined numeric uncertainty is explicitly `not-propagated`, because the engine does not invent assumptions about whether samples at different times are independent or correlated.

This is the bridge needed for physically timed flicker, flash and other changes in light sources. It does not use sensor readout phase as a stand-in for exposure time, and it does not itself implement visibility, material transport or a renderer.

## Manual flash and ordinary sync

The manual-flash foundation (#106) models a flash as **scene illumination that changes over time**, not as a brightness control applied after rendering.

The flow is:

```text
manual flash source geometry + spectrum + relative output
  + explicit pulse waveform
  + #12 exposure-window timing
  -> #85 temporal illumination source
  -> scene radiance / material / visibility transport
  -> optics and sensor integration
```

(In the flow above, #12 is the [exposure-window timing](#capture-exposure-window-timing) and #85 is the [scene-radiance provider](#scene-radiance-provider-and-material-response) with its [temporal illumination](#temporal-illumination).)

Use `parseManualFlashProfile()` for one generic manual flash source, and `parseFlashSyncCapabilityProfile()` for the exact capture-mode/timing profile that allows ordinary synchronization.

A manual flash profile declares:

- a stable source identity;
- source geometry (point, spot, area and so on), as in [scene illumination source profiles](#scene-illumination-source-profiles);
- the source spectrum;
- a relative, linear output scale;
- explicit piecewise-linear pulse support and shape;
- provenance and limitations.

Schema 0.1.0 uses relative source magnitude only. It does not claim a calibrated guide number, joule value, branded flash range or manufacturer-specific pulse curve.

### Front- and rear-curtain timing

Call `resolveManualFlashSync()` with the resolved capture-mode timing.

For an ordinary single-pulse flash, Photivra works out the interval during which **the whole active frame is exposed at the same time**:

```text
whole-frame-open start = latest opening-boundary phase
whole-frame-open end   = earliest closing-boundary phase
```

For a uniform focal-plane opening scan, the latest opening is the opening traversal time. The earliest closing stays at the nominal closing reference. If the interval is zero or negative, an ordinary flash cannot light the whole active frame evenly.

Front-curtain sync puts the pulse at the start of this interval. Rear-curtain sync puts it at the end:

```text
front pulse start = whole-frame-open start
rear pulse start  = whole-frame-open end - pulse support duration
```

The whole pulse must fit inside the interval. A shutter/capture timing without a long enough whole-frame-open interval fails closed.

Sensor **data readout timing is never used as flash exposure timing**.

### HSS boundary

`resolveManualFlashSync()` still rejects `high-speed-sync`. Photivra does not fake HSS (high-speed sync) by allowing an ordinary short pulse at shutter speeds faster than normal sync. Real HSS needs a long or repeated light waveform, coordinated with the moving exposure slit, and it behaves differently in energy and range. That is handled by the separate `resolveHighSpeedFlashSync()` burst model, for schema 0.2.0 sync profiles that declare HSS (see [Rolling shutter, video, flash TTL/HSS and highlight-priority metering](#rolling-shutter-video-flash-ttlhss-and-highlight-priority-metering-200)).

### Illumination overlay

`createManualFlashIlluminationOverlay()` adds the flash as a real scene illumination source, and builds the matching temporal waveform and source binding.

If an ambient `SceneIlluminationTemporalProfile` already exists, its waveforms and source bindings are kept and rebound to the new combined illumination-profile identity. So the flash does not erase ambient flicker or other source timing.

When the flash is disabled, the base illumination and temporal profiles are returned with unchanged meaning, and no flash source is added.

The flash source keeps its position, direction and coverage geometry. Distance falloff, surface orientation, shadows, visibility and indirect light remain the job of the scene-radiance provider or renderer. Photivra does not fake those effects with one number for the whole frame.

### Manual flash controls remain separate

The manual-flash layer does not change:

- aperture;
- shutter duration;
- ISO;
- ambient exposure compensation;
- WB;
- focus;
- drive mode;
- stable-support state.

The flash output control is independent of the camera's ISO, aperture and shutter. Those camera settings affect the captured flash contribution only through the normal image-formation chain.

The flash spectrum is physical scene illumination. A Flash WB preset chosen later, if any, must not change the source spectrum.

### #105 release binding

You may supply an optional committed `ResolvedReleaseFrame` from [release sequencing](#logical-release-sequences). Its shutter duration must match the exposure-window timing. The resolved flash event then reports pulse start and end in scene time relative to the sequence, without changing the release frame.

Generic pre-flash TTL (through-the-lens) power, with flash exposure compensation, is solved separately by `resolveTtlFlashExposure()`, and applied to the manual profile with `createTtlScaledFlashProfile()`. Outside the manual-flash contract: FE/FV lock, recycle/burst/thermal limits, red-eye pre-flashes, modelling lamps, AF-assist and simulation of wireless protocols.

## Capture orientation, active area, and output geometry

Use `resolveCaptureGeometry()` to keep four things separate: the physical sensor, the active capture area, how the camera is physically held (orientation), and the final digital output geometry:

```ts
import { resolveCaptureGeometry } from "@photivra/engine";

const geometry = resolveCaptureGeometry({
  imagingArea: { widthMm: 36, heightMm: 24 },
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  orientation: "portrait-clockwise",
  activeCaptureRect: {
    x: 1000,
    y: 800,
    width: 4000,
    height: 2400
  },
  outputCropRect: {
    x: 0,
    y: 875,
    width: 2400,
    height: 2250
  },
  outputRaster: {
    pixelWidth: 2160,
    pixelHeight: 2025
  }
});

console.log(geometry.value.activeCapture.centerOffsetFromOpticalAxisMm);
console.log(geometry.value.orientedCapture.raster);
console.log(geometry.value.output.raster);
```

Native sensor raster coordinates are invariant under physical camera rotation:

- origin: top-left;
- +X: right;
- +Y: down;
- rectangles: integer, half-open extents `[x, x + width) × [y, y + height)`.

The engine exports exact native↔oriented point, vector, and rectangle transforms for all four physical rotations:

```ts
import {
  transformNativeRasterPointToOriented,
  transformOrientedRasterPointToNative
} from "@photivra/engine";
```

- Point transforms use continuous coordinates on pixel edges; pixel centers are at +0.5 offsets.
- Vector transforms rotate direction only.
- Rectangle transforms keep integer, half-open semantics.
- Clockwise and counter-clockwise portrait transforms are distinct, and both round-trip back to native coordinates.

`activeCaptureRect` is given in native coordinates. The generic model works out the physical bounds of the active area by assuming native image samples are spread evenly across the declared physical imaging area. The result gives the physical bounds and the center offset from the optical axis, so off-center crops stay optically asymmetric.

`outputCropRect` is given in oriented active-capture coordinates. `outputRaster` may resample that crop, but must keep its aspect ratio within integer-rounding tolerance. Hidden geometric stretching is rejected.

Display and file transforms, such as EXIF mirroring, stay separate from the physical `CaptureOrientation`.

Use `calculateActiveCaptureFieldOfView()` for the FOV of the active physical capture. It keeps signed horizontal/vertical bounds for off-center crops, and reports both corner-to-corner diagonal spans. `diagonalDegrees` is the larger of the two; centered crops give equal spans.

The final digital/output crop is deliberately not part of active-capture FOV.

## Centered crop and subject framing crop

Use `calculateCenteredCrop()` for a same-aspect centered digital crop:

```ts
import { calculateCenteredCrop } from "@photivra/engine";

const crop = calculateCenteredCrop({
  pixelWidth: 6000,
  pixelHeight: 4000,
  cropFactor: 1.5
});

console.log(crop.value.pixelWidth);
console.log(crop.value.pixelHeight);
console.log(crop.value.megapixels);
console.log(crop.value.retainedAreaFraction);
```

Use `calculateSubjectFramingCrop()` to work out the extra crop needed for a projected subject to fill a target fraction of the frame height:

```ts
import { calculateSubjectFramingCrop } from "@photivra/engine";

const framing = calculateSubjectFramingCrop({
  pixelWidth: 6000,
  pixelHeight: 4000,
  subjectHeightPixels: 1200,
  targetSubjectHeightFraction: 0.5
});

console.log(framing.value.cropFactor);
console.log(framing.value.subjectHeightFraction);
console.log(framing.value.subjectClipped);
```

Subject framing assumes the crop can be placed around the subject. It does not check the subject's actual position against the image edges.

Integer rounding:

- `calculateCenteredCrop()` floors the shorter axis (`floor(dimension / cropFactor)`). It derives the longer axis as the integer nearest to the source aspect ratio, capped at `floor(dimension / cropFactor)`. For example, 6000×4000 at 1.7× gives 3528×2352 (exactly 3:2).
- `calculateSubjectFramingCrop()` uses the largest whole-pixel height within the requested crop height (`subjectHeightPixels / targetSubjectHeightFraction`), never fewer than `ceil(subjectHeightPixels)`, and the nearest-integer width for the source ratio.
- So `subjectHeightFraction` is at least the target (within one pixel of crop height), and `subjectClipped` is never `true` when the subject fits the source frame.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#sensor-geometry-sampling-capture-and-crop).

## Projected subject motion

Use `calculateProjectedMotionBlur()` for how far one representative point moves on the image plane during an exposure:

```ts
import { calculateProjectedMotionBlur } from "@photivra/engine";

const motion = calculateProjectedMotionBlur({
  focalLengthMm: 200,
  shutterSeconds: 1 / 500,
  positionM: { x: 0.5, y: 1.2, z: 22 },
  velocityMps: { x: 8, y: 0, z: 0 },
  focusDistanceM: 22,
  pixelPitchMicrometers: 6
});

console.log(motion.value.deltaXMm);
console.log(motion.value.deltaYMm);
console.log(motion.value.distanceMm);
console.log(motion.value.distancePixels);
```

The model assumes constant linear velocity in world space. It follows one representative point. It does not model blur from changing object size, rotation, deformation or acceleration.

See [Motion and Signal Foundation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#projected-subject-motion).

## Extended-object time-varying projection

`calculateProjectedMotionBlur()` stays the compact API for one representative point. Use `calculateExtendedObjectProjectionTrajectory()` when the object's size and shape matter.

The extended-object foundation takes:

- multiple explicit metric camera-space points belonging to one object/region;
- one shared constant rigid object-translation velocity;
- a separate constant camera-translation velocity;
- deterministic physical sample times;
- the same focal-length / optional focus-aware projection semantics used by the existing motion primitives.

Each point is projected independently:

```text
relative point(t)
  = reference point
  + (object translation - camera translation) * t

image x(t) = projection distance * x(t) / z(t)
image y(t) = projection distance * y(t) / z(t)
```

This matters for motion towards or away from the camera. An object centered on the optical axis can have almost no movement at its center, while its off-axis corners move outwards or inwards because the magnification changes.

### Front-to-back motion and scale

Do not read every result for motion in depth as one global scale.

If you have a known flat patch facing the camera squarely (fronto-parallel), you may provide it explicitly:

```ts
frontoparallelPlane: {
  kind: "fronto-parallel-planar-patch",
  referenceDepthM: 10
}
```

Photivra verifies that every supplied reference point lies on that depth plane before returning a planar magnification diagnostic.

Under the first shared rigid-translation model:

```text
scale(t) = reference depth / current depth(t)
```

The scale diagnostic is valid for that declared patch only. It does **not** authorize one scale or one homography for arbitrary non-coplanar 3D geometry.

### Mixed lateral + depth motion

Sideways and depth translation are evaluated together. Because projection depends on each point's depth, different points on the object can follow quite different paths on the image plane.

The result therefore exposes per-point, per-time:

- metric relative position;
- absolute mapped image-plane position;
- displacement from the reference projection;
- depth;
- optional validated planar scale.

Camera and object translation stay separate inputs, even though the relative projection uses `object - camera` translation.

### #12 local-exposure integration

Use `calculateCaptureExtendedObjectTemporalProjection()` when the geometry must follow capture timing (the [exposure windows](#capture-exposure-window-timing), #12).

Each object point names the native destination point whose committed exposure window applies. The engine creates deterministic midpoint times inside each point's local exposure interval, and evaluates the same extended-object projection there.

With rolling or other local exposure timing, two image locations can therefore record different parts of the same object's path.

Sensor **data readout timing is not substituted for exposure timing**.

### Scientific boundary

This foundation returns **time-varying geometry**, not rendered motion blur.

It does not calculate:

- visibility or occlusion/disocclusion;
- frame-boundary coverage;
- a blur kernel;
- radiance/time averaging;
- articulated or deforming motion;
- acceleration;
- camera rotation;
- a universal projective warp.

If the relative depth changes, the object's distance from the focus plane also changes over time. A high-fidelity renderer may therefore need to evaluate defocus/PSF at the same physical times, instead of convolving one motion result with one fixed defocus kernel.

A renderer using a [scene-radiance provider](#scene-radiance-provider-and-material-response) should evaluate scene radiance and visibility at each of these geometry states, rather than guessing a complete blur from the endpoints alone.

## Relative pre-exposure metering

Metering measures how bright the scene is, so exposure can be set. Use `parseExposureMeteringProfile()` and `meterRelativeExposure()` for the first metering path. It does not depend on any renderer.

Schema `0.1.0` deliberately accepts only a **relative, linear signal measured before exposure**. It does not claim calibrated luminance, scene spectral radiance, sensor-plane irradiance or the meter calibration of any commercial camera.

```ts
import {
  meterRelativeExposure,
  parseExposureMeteringProfile,
  resolveCaptureGeometry
} from "@photivra/engine";

const captureGeometry =
  resolveCaptureGeometry({
    imagingArea: {
      widthMm: 36,
      heightMm: 24
    },
    nativeRaster: {
      pixelWidth: 6000,
      pixelHeight: 4000
    },
    orientation: "landscape"
  }).value;

const profile =
  parseExposureMeteringProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-relative-meter",
    scientificStatus: "approximation",
    inputDomain:
      "relative-pre-exposure-linear-signal",
    captureRegion:
      "oriented-active-capture",
    policy: {
      kind: "multi-zone-uniform"
    },
    target: {
      kind:
        "relative-signal-reference",
      targetRelativeSignal: 1,
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference:
            "meter-target:example",
          reuseStatus:
            "photivra-owned"
        }
      ]
    },
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "meter-profile:example",
        reuseStatus:
          "photivra-owned"
      }
    ],
    limitations: [
      "Generic educational relative meter."
    ]
  });

const metered =
  meterRelativeExposure({
    profile,
    sampleSet: {
      measurementId: "frame-42-meter",
      sceneStateId:
        "scene-state-after-light-change",
      inputDomain:
        "relative-pre-exposure-linear-signal",
      captureRegion:
        "oriented-active-capture",
      captureGeometry,
      processingState: {
        exposureSettingsApplied: false,
        whiteBalanceApplied: false,
        toneMappingApplied: false,
        displayGammaApplied: false,
        sharpeningApplied: false
      },
      samples: [
        {
          sampleId: "zone-0",
          positionOrientedCaptureUv: {
            u: 0.25,
            v: 0.5
          },
          relativeLinearSignal: 0.5,
          areaWeight: 1
        },
        {
          sampleId: "zone-1",
          positionOrientedCaptureUv: {
            u: 0.75,
            v: 0.5
          },
          relativeLinearSignal: 0.5,
          areaWeight: 1
        }
      ]
    }
  });

if (metered.value.status === "resolved") {
  console.log(
    metered.value
      .exposureOffsetStopsToTarget
  ); // 1
}
```

For a controlled uniform test scene, halving every relative-linear sample from `1.0` to `0.5` gives a **+1 stop** shift to reach the same declared target. The Manual + Auto ISO tests rely on this deliberate, educational rule.

### Metering policies

The first generic policies are spelled out explicitly, not named after brands:

- `multi-zone-uniform` — area-weighted average over all supplied zones.
- `center-weighted-radial` — multiplies each area weight by a radial weighting over the physical frame, with an explicit edge weight and exponent.
- `spot` — uses only samples inside an explicit spot (center and radius) in the oriented active capture frame.
- `highlight-weighted` — gives brighter samples more weight, through an explicit exponent and a minimum weight fraction, then places that weighted mean at the target. It emphasizes highlights; it does not protect them. In a mostly mid-grey frame with a small bright area, it darkens the mid-tones (about 0.5–0.8 EV compared with uniform metering, for a frame that is 95 % at 0.18 and 5 % at 0.9), without placing the highlights relative to saturation.
- `highlight-priority` — places the area-weighted `highlightPercentile` quantile of the samples `headroomStops` below a declared `saturationRelativeSignal`. The profile target must equal `saturationRelativeSignal · 2^−headroomStops` (`calculateHighlightPriorityPlacementSignal()`). It is a quantile over space, so the time-averaged scene-radiance meter and TTL flash reject it.

The sample producer supplies `areaWeight`, so sampling one part of the frame more densely does not automatically give it more influence.

Center and spot distances use the **physical dimensions of the oriented active capture frame**, not CSS or display pixels. Schema 0.1.0 does not use a final output crop.

### Target and downstream control

`targetRelativeSignal` is a reference defined by the profile. It is not a universal claim about 18% grey, or about any manufacturer's meter calibration.

The meter reports the base scene measurement separately from exposure compensation. It does not choose aperture, shutter duration or ISO.

The intended flow is:

```text
pre-exposure relative scene signal
  -> meterRelativeExposure()
  -> base meter result / stop offset
  -> immutable exposure target / compensation
  -> #99 exposure-mode resolver
  -> aperture / shutter / ISO
```

(#99 is [exposure control](#manual-and-auto-iso-exposure-resolution): the resolvers that choose aperture, shutter and ISO.)

A sample set with zero signal returns `status: "no-signal"`, not infinity or NaN.

`measurementId` and `sceneStateId` stay in the result, so an application can freeze a meter result for AE lock, or reject stale results after the scene lighting changes.

The input must state explicitly that exposure settings, white balance, tone mapping, display gamma and sharpening have not already been applied. This prevents a feedback loop where auto-exposure meters its own final preview.

This path covers ambient, relative metering only. Flash/TTL metering, and calibrated camera-specific photometric or radiometric metering, are separate. Exposure compensation and automatic exposure use the frozen meter target through their own contracts; they never change the meter measurement.

### Equipment metering capability binding

Use `parseGenericBodyMeteringCapabilityProfile()` with `assessExposureMeteringProfileCompatibility()` to declare which engine-owned metering profiles and modes a generic camera body may select.

The equipment profile does **not** repeat the meter target or calibration values. Those stay authoritative in the selected `ExposureMeteringProfile`.

Composition fragment: requires previously validated bindings `evidence`, `profile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  assessExposureMeteringProfileCompatibility,
  parseGenericBodyMeteringCapabilityProfile
} from "@photivra/engine";

const bodyMetering =
  parseGenericBodyMeteringCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-body-metering",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence,
    supportedMeteringProfiles: [
      {
        meteringProfileId:
          "generic-relative-meter",
        policyKind:
          "multi-zone-uniform",
        evidence
      }
    ],
    spotFocusPointLinkage: {
      availability: "unknown",
      evidence
    }
  });

const compatibility =
  assessExposureMeteringProfileCompatibility({
    bodyCapabilities: bodyMetering,
    meteringProfile: profile
  });
```

The compatibility result keeps `targetPolicyOwnership: "metering-profile"`, so equipment metadata never becomes a second source of calibration truth.

Linking the metering spot to the focus point is capability metadata only. A future AF/spot-link control must use it explicitly. The meter does not silently move a spot just because a focus point exists.

### Meter target and automatic exposure integration

- `createExposureMeterTargetFromMeteringResult()` freezes a spatial or temporal meter result into the target used by exposure-mode resolution.
- `setExposureCompensationOnMeterTarget()` applies compensation afterwards, without changing the source measurement.

For the controlled relative path:

```text
uniform scene signal 1.0 -> meter target scale 1 -> ISO 100
uniform scene signal 0.5 -> meter target scale 2 -> ISO 200
```

when aperture and shutter are fixed in Manual + Auto ISO and the ISO capability range permits it.

The frozen target keeps the original meter measurement, scene and profile identity; this is how AE lock works. Reusing that target after the scene changes deliberately keeps the locked target. Creating a new meter result follows the new scene state.

Automatic resolvers read the typed target directly, and do not apply exposure compensation again.

## Scene-radiance-derived and temporal metering

Use `createSceneRadianceDerivedExposureMeteringSampleSet()` when a renderer or reference evaluator supplies relative pre-exposure meter zones derived from a [scene-radiance provider](#scene-radiance-provider-and-material-response) (#85).

The bridge checks:

- scene/provider/illumination/material profile identity;
- provider material fidelity against the supplied material profile;
- the declared scalar-reduction derivation profile;
- optional temporal-illumination profile identity;
- explicit capture time when the provider is time-varying.

The reduction to one number per zone is still supplied by the renderer or provider. Photivra does **not** automatically turn spectral-radiance samples into luminance or a camera meter signal.

Composition fragment: requires previously validated bindings `captureGeometry`, `illuminationProfile`, `materialResponseProfile`, `profile`, `providerProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createSceneRadianceDerivedExposureMeteringSampleSet,
  meterRelativeExposure,
  parseSceneRadianceMeteringDerivationProfile
} from "@photivra/engine";

const derivation =
  parseSceneRadianceMeteringDerivationProfile({
    schemaVersion: "0.1.0",
    derivationId: "preview-relative-meter",
    scientificStatus: "approximation",
    method:
      "renderer-provided-pre-exposure-relative-reduction",
    spectralWeighting:
      "not-calibrated",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "meter-derivation:preview",
        reuseStatus:
          "photivra-owned"
      }
    ],
    limitation:
      "Relative scalar reduction; no calibrated meter spectral response."
  });

const sampleSet =
  createSceneRadianceDerivedExposureMeteringSampleSet({
    measurementId: "meter-frame-1",
    sceneStateId: "scene-state-42",
    providerProfile,
    illuminationProfile,
    materialResponseProfile,
    captureGeometry,
    derivationProfile: derivation,
    samples: [
      {
        sampleId: "zone-0",
        positionOrientedCaptureUv: {
          u: 0.5,
          v: 0.5
        },
        relativeLinearSignal: 0.5,
        areaWeight: 1
      }
    ]
  });

const meter = meterRelativeExposure({
  profile,
  sampleSet
});
```

The source context reports `spectralReductionCalibrated: false`. Claims of calibrated luminance or scene radiance are not allowed.

### Time-varying illumination

If the scene-radiance provider declares `illuminationTemporalProfileId`, the bridge needs the matching temporal profile, plus a finite `captureTimeSecondsFromReference` on the shared `first-opening-boundary-phase` reference.

One such sample set is an explicit meter snapshot at that instant.

To average several snapshots, use `meterSceneRadianceTemporalExposure()` with an explicit `weighted-time-average` policy:

Composition fragment: requires previously validated bindings `profile`, `sampleAtTime0`, `sampleAtTime1`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  meterSceneRadianceTemporalExposure
} from "@photivra/engine";

const temporalMeter =
  meterSceneRadianceTemporalExposure({
    temporalMeasurementId:
      "meter-window-1",
    profile,
    policy: {
      kind: "weighted-time-average",
      timeReference:
        "first-opening-boundary-phase"
    },
    temporalSamples: [
      {
        normalizedTimeWeight: 0.5,
        sampleSet: sampleAtTime0
      },
      {
        normalizedTimeWeight: 0.5,
        sampleSet: sampleAtTime1
      }
    ]
  });
```

The time weights must be positive and sum to one. Capture times must be strictly increasing. Every sample must share the same committed `sceneStateId`, provider/material/derivation context, temporal profile and active-capture geometry.

The meter averages the **linear relative signals first**, then computes the stop offset to the target. It never averages EV or stop offsets.

This policy is explicit ambient metering over time. It does not guess time weights from the flicker frequency, the source waveform shape, the shutter or readout duration, the renderer's frame rate, or the final display brightness. Flash/TTL metering is separate.

## Logical release sequences

A "release" is one press of the shutter button and the frames it produces. Use `parseGenericReleaseCapabilityProfile()` and `resolveReleaseSequence()` for deterministic logical camera releases: single frames, bursts, self-timer sequences, exposure bracketing and focus bracketing.

This is deliberately separate from sensor capture modes. A burst of several photographs is several logical captures, not one multi-frame sensor reconstruction.

Composition fragment: requires previously validated bindings `evidence`, `exposureCapabilities`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseGenericReleaseCapabilityProfile,
  resolveReleaseSequence
} from "@photivra/engine";

const releaseCapabilities =
  parseGenericReleaseCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "generic-release",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence,
    supportedDriveModes: {
      value: [
        "single",
        "burst",
        "self-timer"
      ],
      evidence
    },
    maximumLogicalFramesPerSequence: {
      value: 20,
      evidence
    },
    maximumCadenceFps: {
      value: 10,
      evidence
    },
    minimumInterFrameGapSeconds: {
      value: 0.01,
      evidence
    },
    overlappingOrdinaryStillExposures:
      false,
    exposureBracketing: {
      availability: {
        value: "supported",
        evidence
      },
      supportedAxes: [
        "shutter",
        "iso"
      ]
    },
    focusBracketing: {
      availability: {
        value: "supported",
        evidence
      }
    }
  });

const burst =
  resolveReleaseSequence({
    sequenceId: "burst-42",
    releaseRequestTimeSeconds: 10,
    sequenceSeedUint32: 12345,
    drive: {
      kind: "burst",
      frameCount: 5
    },
    bracket: {
      kind: "none"
    },
    requestedCadenceFps: 8,
    baseState: {
      exposure: {
        aperture: 4,
        shutterSeconds: 1 / 125,
        iso: 400
      },
      focus: {
        kind: "finite",
        distanceM: 5
      },
      automation: {
        ae: "locked",
        af: "continuous",
        awb: "locked"
      }
    },
    releaseCapabilities,
    exposureCapabilities
  });
```

Each frame carries:

- stable sequence/frame identity;
- explicit exposure start/end time;
- scene-time identity;
- actual aperture/shutter/ISO;
- explicit focus state;
- deterministic per-frame seed;
- explicit automation/lock policy.

Neighbouring frames derive different random seeds from the same stable sequence seed. Replaying identical sequence inputs reproduces the same sequence.

### Cadence feasibility

The requested frames per second (FPS) never override physics or the camera's capabilities.

For ordinary still exposures, which do not overlap, the actual start-to-start interval is limited by:

- requested cadence;
- body maximum cadence;
- previous frame exposure duration;
- minimum inter-frame gap.

The resolver reports which timing limit applied, instead of silently scheduling overlapping exposures.

Schema 0.1.0 does not model slowdown from buffers, media or heat, pre-release capture, or special modes with overlapping acquisition.

### Bracketing

Exposure bracketing changes an explicit physical exposure setting for each frame. It does not add a brightness offset after rendering.

Focus bracketing uses explicit `FocusPlane` states. It does not claim to produce a focus-stacked image, and does not give an abstract focus-step index a universal physical meaning.

White-balance bracketing is not forced to mean several physical exposures. Varying WB in rendering or development is work for the colour pipeline later on.

### Cancellation

Use `createCancelledReleaseSequence()` to record explicitly which frames were completed and which were left out, without changing the scheduled source sequence.

## Generic equipment exposure capabilities

Use the equipment-capability API (#109) to describe **what a generic Photivra body and lens allow**, before [exposure control](#manual-and-auto-iso-exposure-resolution) (#99) chooses any setting.

```ts
import {
  parseGenericBodyExposureCapabilityProfile,
  parseGenericLensExposureCapabilityProfile,
  resolveGenericEquipmentExposureCapabilities
} from "@photivra/engine";

const body =
  parseGenericBodyExposureCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "body-prosumer",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "generic-body:prosumer",
        reuseStatus: "photivra-owned"
      }
    ],
    shutter: {
      durationSecondsRange: {
        value: {
          minimum: 1 / 8000,
          maximum: 30
        },
        evidence: [
          {
            sourceOrigin: "photivra",
            sourceReference:
              "generic-body:prosumer:shutter",
            reuseStatus:
              "photivra-owned"
          }
        ]
      },
      settingGrid: {
        kind: "continuous-within-range"
      }
    },
    iso: {
      range: {
        value: {
          minimum: 100,
          maximum: 12800
        },
        evidence: [
          {
            sourceOrigin: "photivra",
            sourceReference:
              "generic-body:prosumer:iso",
            reuseStatus:
              "photivra-owned"
          }
        ]
      },
      settingGrid: {
        kind: "discrete-values",
        values: {
          value: [
            100,
            200,
            400,
            800,
            1600,
            3200,
            6400,
            12800
          ],
          evidence: [
            {
              sourceOrigin: "photivra",
              sourceReference:
                "generic-body:prosumer:iso-grid",
              reuseStatus:
                "photivra-owned"
            }
          ]
        }
      },
      autoIso: {
        value: "supported",
        evidence: [
          {
            sourceOrigin: "photivra",
            sourceReference:
              "generic-body:prosumer:auto-iso",
            reuseStatus:
              "photivra-owned"
          }
        ]
      }
    }
  });

const lens =
  parseGenericLensExposureCapabilityProfile({
    schemaVersion: "0.1.0",
    profileId: "lens-standard-variable-zoom",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "generic-lens:standard-variable-zoom",
        reuseStatus: "photivra-owned"
      }
    ],
    focalLengthMmRange: {
      value: {
        minimum: 24,
        maximum: 70
      },
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference:
            "generic-lens:focal-range",
          reuseStatus:
            "photivra-owned"
        }
      ]
    },
    aperture: {
      widestAvailableFNumber: {
        kind:
          "piecewise-linear-by-focal-length",
        samples: {
          value: [
            {
              focalLengthMm: 24,
              fNumber: 2.8
            },
            {
              focalLengthMm: 50,
              fNumber: 3.5
            },
            {
              focalLengthMm: 70,
              fNumber: 4
            }
          ],
          evidence: [
            {
              sourceOrigin: "photivra",
              sourceReference:
                "generic-lens:wide-open-curve",
              reuseStatus:
                "photivra-owned"
            }
          ]
        }
      },
      narrowestAvailableFNumber: {
        value: 22,
        evidence: [
          {
            sourceOrigin: "photivra",
            sourceReference:
              "generic-lens:narrowest-aperture",
            reuseStatus:
              "photivra-owned"
          }
        ]
      },
      settingGrid: {
        kind: "continuous-within-range"
      }
    }
  });

const capabilities =
  resolveGenericEquipmentExposureCapabilities({
    bodyProfile: body,
    lensProfile: lens,
    selectedFocalLengthMm: 60
  });
```

The resolved result contains the exposure envelope that #99 may later consume:

- focal-length-specific widest available f-number;
- narrowest available f-number;
- aperture setting grid;
- shortest/longest shutter duration and setting grid;
- ISO range and setting grid;
- Auto ISO availability.

### Continuous versus discrete setting grids

A setting grid is either:

- `continuous-within-range` — a downstream resolver may choose any finite value inside the range; or
- `discrete-values` — only the declared values are valid.

For a lens whose widest aperture changes with zoom, the discrete aperture list is filtered after the wide-open f-number is resolved at the selected focal length.

### Capability versus selected state

These profiles do **not** describe the current camera settings. They are immutable inputs that say what is possible.

The resolver also does not choose aperture, shutter or ISO. Exposure control owns:

- which settings are manual and which are automatic;
- validating and quantizing requested settings;
- clamping to capability limits;
- residual exposure diagnostics.

The legacy `CameraConfiguration` keeps its meaning unchanged, alongside this newer, versioned capability/state design.

Auto ISO capability preserves three states:

- `supported`;
- `unsupported`;
- `unknown`.

An unknown capability must not be treated as supported.

ISO capability is control metadata only. It says nothing about sensor noise, analog gain topology, photon count, conversion gain or high-ISO quality.

Likewise, shutter-duration capability says nothing about the shutter mechanism, rolling/global readout, exposure-boundary timing or flash sync.

## Meter target and exposure compensation

Use `createExposureMeterTargetFromMeteringResult()` to freeze a spatial or temporal metering result into the stable target that exposure control reads.

Composition fragment: requires previously validated bindings `meterResult`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  createExposureMeterTargetFromMeteringResult,
  setExposureCompensationOnMeterTarget
} from "@photivra/engine";

const baseTarget =
  createExposureMeterTargetFromMeteringResult({
    targetId: "meter-target:frame-42",
    meterResult
  });

const compensated =
  setExposureCompensationOnMeterTarget({
    targetId: "meter-target:frame-42:+1ev",
    baseTarget,
    exposureCompensationStops: 1
  });
```

The frozen target copies the authoritative meter identity by value:

- source kind (spatial or temporal metering);
- measurement ID;
- scene-state ID;
- metering-profile ID.

This is how AE lock works. Holding on to the target object deliberately keeps the earlier meter snapshot, even if the live scene later changes.

### Compensation semantics

Exposure compensation is an **absolute offset applied to the target**, after metering.

For a resolved target:

```text
compensated stops =
  uncompensated meter stops
  + exposure compensation

compensated exposure scale =
  uncompensated meter scale
  * 2^(exposure compensation stops)
```

Therefore +1 EV compensation requests twice the exposure of the uncompensated target; -1 EV requests half.

`setExposureCompensationOnMeterTarget()` always works from the stored, uncompensated base values. If you pass a target that is already compensated, with a new compensation value, the old compensation is not added on top. This stops drift when a slider or dial is moved repeatedly.

A changed compensation state needs a new `targetId`. The identity of the source meter snapshot stays the same.

The meter measurement itself is never changed, and the target still reports `automaticExposureResolved: false`. Exposure control makes the later aperture/shutter/ISO decision.

A `no-signal` meter target stays `no-signal` after compensation. The engine does not turn darkness into infinity, or make up an automatic exposure that could be reached.

## ISO/exposure-index capabilities and generic high-ISO signal chain

Photivra keeps the **reported ISO / exposure-index setting** separate from the captured photons, and from the [electronic readout model](#stochastic-charge-conversion-adc-and-raw-code) (#14).

Use `parseIsoCapabilityProfile()` for detailed ISO capability metadata for a camera body, beyond the older generic numeric range.

The profile can declare:

- a standard ISO/EI range;
- either continuous or explicit discrete standard settings;
- expanded low/high states such as generic `L`, `H1`, or `H2` identifiers with reported exposure-index equivalents;
- whether each expanded state is Auto-ISO eligible;
- a global Auto ISO range;
- evidenced per-capture-mode standard ranges, expanded-setting availability, and Auto ISO ranges.

The contract describes **which exposure-index settings a camera reports**, not physical sensor gain. Resolving a setting therefore states explicitly that it did not change or infer:

- captured-photon expectation;
- photon shot-noise statistics;
- physical/analog gain;
- conversion gain;
- read noise;
- saturation;
- exact commercial-camera behavior.

Expanded settings are deliberately separate from the ordinary standard numeric setting grid. A reported `H1` equivalent does not mean Photivra knows how a real camera implements that setting internally.

### Binding detailed ISO capability into automatic exposure

Use `bindIsoCapabilityToExposureCapabilities()` to combine this detailed ISO profile (#7) with the resolved body/lens exposure envelope that exposure control reads.

The global standard ISO range and grid must agree exactly between the two contracts. Conflicting duplicate facts fail closed.

An evidenced capture-mode policy may narrow the standard ISO range for that mode. Auto ISO can then be narrower still.

For example, a mode may allow manual standard ISO 100–12800 while limiting Auto ISO to 200–3200. Exposure control checks manual ISO against the mode's standard range and grid, but uses the separate Auto ISO bounds for every automatic-ISO path.

Expanded settings stay outside the ordinary numeric Auto ISO resolver. They are selected explicitly through the detailed ISO capability contract.

### Generic high-ISO signal-chain profiles

`parseGenericIsoSignalChainProfile()` and `resolveGenericIsoSignalChain()` provide the generic "Stage-B" model, which links an ISO setting to the sensor's electronics.

The profile does **not** define an ISO → noise equation. Instead, for one exact capture mode, it maps:

- standard ISO/EI bands; and
- explicitly named expanded ISO states

to existing `SensorReadoutConversionRegime` IDs (the [readout regimes](#stochastic-charge-conversion-adc-and-raw-code), #14).

Those regimes own the actual declared conversion gain, electronic read-noise components, pre-ADC saturation, black level, ADC and RAW-code behaviour.

So changing ISO, or a generic profile, cannot change the expected photoelectrons or photon shot-noise statistics upstream. Any change in read noise or conversion/saturation behaviour comes from the explicitly selected regime.

Signal-chain bands may have gaps where only discrete ISO values are supported. Overlapping bands fail closed, rather than letting their order pick a regime.

The first generic profile deliberately does not add:

- fixed-pattern/row/column noise;
- low-signal color degradation;
- denoising/sharpening;
- processed-image/JPEG behavior;
- manufacturer-specific response curves.

Those effects need their own explicit models and evidence, and must not be hidden inside a quality label.

### Good / Better / Best convenience mapping

`parseGenericIsoSignalChainPresetCatalog()` can map the user-facing convenience labels `good`, `better`, and `best` to explicit signal-chain profile IDs.

The labels are not the scientific input; the selected profile's parameters are.

The catalog explicitly carries:

- `performanceOrderingClaimed: false`;
- `realCameraRankingClaimed: false`.

This stops the convenience labels from turning into a claim that one class of real camera is always better, or that a tier name by itself changes sensor physics.

## Manual and Auto ISO exposure resolution

Exposure control (#99) chooses the camera settings from a meter target. Use `resolveManualExposureMode()` for Manual mode, the first part of it.

This resolver takes:

- a frozen `ExposureMeterTarget` (from [metering](#meter-target-and-exposure-compensation), #100);
- the resolved generic body + lens exposure capabilities (from [equipment capabilities](#generic-equipment-exposure-capabilities), #109);
- an explicit relative reference exposure anchor;
- aperture and shutter settings chosen by the caller;
- either manual ISO or Auto ISO.

The resolver does **not** meter the scene, apply exposure compensation, change aperture or shutter, or infer sensor noise or gain behaviour.

### Reference exposure anchor

The relative meter target tells the resolver how much the exposure must change. On its own, it does not define an absolute ISO.

Therefore this API requires:

```ts
const referenceExposure = {
  aperture: 4,
  shutterSeconds: 1 / 125,
  iso: 100
};
```

The anchor means: when the target scale is `1`, this aperture/shutter/ISO combination is the declared relative exposure baseline.

It is an explicit input, not a universal ISO-100 or grey-card rule. All three anchor values must be valid in the same resolved equipment capability envelope.

### Manual + Auto ISO

Composition fragment: requires previously validated bindings `capabilities`, `target`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  resolveManualExposureMode
} from "@photivra/engine";

const resolved =
  resolveManualExposureMode({
    target,
    capabilities,
    referenceExposure: {
      aperture: 4,
      shutterSeconds: 1 / 125,
      iso: 100
    },
    manualAperture: 4,
    manualShutterSeconds: 1 / 125,
    isoControl: {
      kind: "automatic",
      quantizationPolicy:
        "nearest-log2-lower-on-tie"
    }
  });
```

With aperture/shutter fixed at the reference values:

- target scale `1` resolves ISO 100;
- target scale `2` resolves ideal ISO 200;
- target scale `4` resolves ideal ISO 400.

This is the controlled rule for responding to live changes in scene light: if the scene gets 1 stop darker everywhere, the ideal ISO goes up 1 stop, when the limits and grid allow it.

If the manual optical settings differ from the reference, the resolver compensates only through ISO:

```text
manual optical factor =
  (manual shutter / manual aperture^2)
  /
  (reference shutter / reference aperture^2)

ideal Auto ISO =
  reference ISO
  * target exposure scale
  / manual optical factor
```

### Discrete ISO quantization

For a discrete ISO grid from the equipment capabilities, the first policy picks the nearest valid ISO in log2 exposure space (that is, nearest in stops).

On an exact midpoint tie, the lower ISO is selected.

The result keeps these concepts separate:

- `idealIsoBeforeConstraints`;
- final resolved ISO;
- whether quantization occurred;
- whether ISO was clamped at minimum/maximum;
- signed residual exposure error.

Residual sign:

- positive residual = still **under target** / needs more exposure;
- negative residual = **over target** / needs less exposure;
- zero = matched.

The limiting constraint is reported as one of:

- `none`;
- `iso-minimum`;
- `iso-maximum`;
- `user-iso-minimum` and `user-iso-maximum` (#505, [photographer-set limits](#photographer-set-auto-iso-limits-505));
- `iso-grid-quantization`.

If Auto ISO capability is `unsupported` or `unknown`, the resolver returns a blocked result. Unknown is not treated as supported.

### Photographer-set Auto ISO limits (#505)

Cameras let the photographer cap Auto ISO, and some also raise its floor: the Nikon D850 has a maximum sensitivity
([Auto ISO control](https://imaging.nikon.com/support/digitutor/d850/functions/autoisocontrol.html)), Fujifilm a default and a
maximum sensitivity per preset ([ISO Auto setting](https://fujifilm-dsc.com/en/manual/x-pro2/menu_shooting/iso_auto_setting/index.html)),
and Panasonic separate upper and lower Auto ISO limits
([GH5 II manual](https://eww.pavc.panasonic.co.jp/dscoi/DC-GH5M2/html/DC-GH5M2_DVQP2464_eng/0062.html)). That is the
photographer's choice, so the engine keeps it apart from what the body allows (`capabilities.iso.autoIsoMinimum` and
`autoIsoMaximum`, or the ISO range when the body declares none).

Every Auto ISO entry point takes an optional `autoIsoLimits: { maximum, minimum? }` (`AutoIsoLimits`):

| Resolver | Where |
| --- | --- |
| `resolveManualExposureMode` | `isoControl.autoIsoLimits` (automatic ISO) |
| `resolveAperturePriorityAutoIsoExposureMode` | `policy.autoIsoLimits` |
| `resolveShutterPriorityExposureMode` | `isoControl.policy.autoIsoLimits` (automatic ISO) |
| `resolveProgramAutoExposureMode` | `isoControl.autoIsoLimits` (automatic ISO) |
| `resolveFullAutoExposureMode` | `policy.autoIsoLimits` |

Composition fragment: requires previously validated bindings `capabilities`, `target`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  resolveManualExposureMode
} from "@photivra/engine";

const capped =
  resolveManualExposureMode({
    target,
    capabilities,
    referenceExposure: {
      aperture: 4,
      shutterSeconds: 1 / 125,
      iso: 100
    },
    manualAperture: 4,
    manualShutterSeconds: 1 / 125,
    isoControl: {
      kind: "automatic",
      quantizationPolicy:
        "nearest-log2-lower-on-tie",
      autoIsoLimits: { maximum: 6400 }
    }
  });
```

The rules:

- Both limits are ISO settings: inside the body's Auto ISO range and, on a discrete ISO grid, one of its values, with
  `minimum` at most `maximum`. `minimum` defaults to the body's Auto ISO minimum. A limit outside the body's range or off
  the grid fails with `InvalidScientificInputError`, and a malformed record (not an object, an unknown field) with
  `InvalidConfigurationError`. The engine never clips a limit silently.
- The ISO is chosen in the narrowed range, and the baseline of the priority, program and Full Auto policies (the lowest
  selectable ISO) is the first selectable ISO at or above `minimum`.
- When the ISO is held at a limit strictly inside the body's range, the limiting constraint is `user-iso-maximum` or
  `user-iso-minimum`, with the residual to the target as usual. A limit equal to the body's bound adds nothing; the body's
  `iso-maximum` or `iso-minimum` is reported.
- Without `autoIsoLimits` every result is unchanged.
- A separate, lower cap for flash is not part of this: it belongs with flash-aware exposure.

A `no-signal` meter target also blocks Auto ISO, instead of selecting maximum ISO or infinity.

### Manual ISO

Use:

```ts
const resolved =
  resolveManualExposureMode({
    target,
    capabilities,
    referenceExposure,
    manualAperture: 4,
    manualShutterSeconds: 1 / 125,
    isoControl: {
      kind: "manual",
      iso: 400
    }
  });
```

Manual aperture, shutter and ISO are kept exactly, after they are checked against the capabilities.

A changed meter target or exposure compensation changes only the target-residual diagnostic. It never changes a manual setting.

This is deliberately different from Manual + Auto ISO.

### Boundaries

Exposure control now covers Manual, the priority modes, Program, Full Auto exposure, and Bulb/Time control.

These stay deliberately separate, rather than being hidden inside shooting-mode resolution:

- safety shift;
- flash-aware exposure;
- sensor noise or conversion-gain behavior;
- named-camera/manufacturer-specific mode emulation.

## Aperture Priority with manual ISO

Use `resolveAperturePriorityExposureMode()` when you choose aperture and ISO, and shutter is the only automatic setting.

Composition fragment: requires previously validated bindings `capabilities`, `target`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  resolveAperturePriorityExposureMode
} from "@photivra/engine";

const resolved =
  resolveAperturePriorityExposureMode({
    target,
    capabilities,
    referenceExposure: {
      aperture: 4,
      shutterSeconds: 1 / 125,
      iso: 100
    },
    manualAperture: 5.6,
    manualIso: 200,
    shutterQuantizationPolicy:
      "nearest-log2-shorter-on-tie"
  });
```

This mode uses the same relative target/reference model as Manual + Auto ISO. It adds no exposure equation of its own.

The ideal shutter is:

```text
fixed-axis factor at reference shutter =
  (reference aperture^2 / manual aperture^2)
  * (manual ISO / reference ISO)

ideal shutter =
  reference shutter
  * target exposure scale
  / fixed-axis factor
```

Aperture and ISO are checked against the same resolved capability envelope, then kept exactly.

### Shutter capability and quantization

For a continuous shutter grid, an ideal duration inside the range is used as is.

For a discrete shutter grid, the first policy picks the nearest duration in log2 exposure-time space (nearest in stops). On an exact tie, the **shorter duration** wins.

The result reports:

- `idealShutterSecondsBeforeConstraints`;
- resolved shutter duration;
- continuous/discrete grid kind;
- whether quantization occurred;
- whether the result was clamped at the shortest/longest duration;
- signed residual exposure error.

Limiting constraints are:

- `none`;
- `shutter-minimum`;
- `shutter-maximum`;
- `shutter-grid-quantization`.

Residual sign is shared with the Manual resolver:

- positive residual = still under target / needs more exposure;
- negative residual = over target / needs less exposure;
- zero = matched.

### Exposure compensation and no-signal

Exposure compensation is already included in the meter target. Aperture Priority uses that target and does not apply compensation again.

A no-signal target blocks automatic shutter resolution. The engine does not pick the longest shutter or an infinite duration.

### Boundaries

This resolver deliberately keeps ISO manual.

Aperture Priority + Auto ISO is a separate resolver ([next section](#priority-modes-with-auto-iso)), because two automatic settings need an explicit selection policy, such as a minimum-shutter rule. The engine must not assume that ISO always moves before, or after, the shutter.

Flash-aware shutter limits, safety shift and manufacturer-specific program behaviour are also separate.

## Priority modes with Auto ISO

These resolvers add the remaining Aperture (A) and Shutter (S) Priority combinations.

### Aperture Priority + Auto ISO

Use `resolveAperturePriorityAutoIsoExposureMode()` with an explicit two-auto-axis policy:

```ts
const resolved =
  resolveAperturePriorityAutoIsoExposureMode({
    target,
    capabilities,
    referenceExposure,
    manualAperture: 4,
    policy: {
      kind:
        "minimum-iso-until-slowest-preferred-shutter",
      isoBaseline:
        "minimum-selectable",
      isoQuantizationPolicy:
        "nearest-log2-lower-on-tie",
      slowestPreferredShutterSeconds:
        1 / 60,
      shutterSelectionPolicy:
        "not-longer-than-target",
      afterMaximumIso:
        "allow-slower-shutter"
    }
  });
```

The policy is explicit:

1. Start at the lowest selectable ISO.
2. Resolve shutter, but do not go slower than the declared preferred threshold.
3. If more exposure is required, hold that shutter region and raise ISO.
4. If ISO reaches its maximum while the target is still underexposed, the policy explicitly chooses either:
   - `allow-slower-shutter`; or
   - `hold-preferred-shutter` and return residual underexposure.

With `policy.autoIsoLimits` ([photographer-set limits](#photographer-set-auto-iso-limits-505), #505) the maximum in step 4
is the photographer's `maximum`, and both choices behave there exactly as at the body's maximum: the same settings and
residual, with `user-iso-maximum` in place of `iso-maximum` when the policy holds the shutter. Shutter Priority
(`isoControl.policy.autoIsoLimits`), Program Auto (`isoControl.autoIsoLimits`) and Full Auto (`policy.autoIsoLimits`) take
the same limits.

For discrete shutter grids, the shutter chosen before ISO is raised is never longer than the requested or preferred duration. Otherwise rounding to the grid could overexpose, and undoing that would need an ISO below the supported minimum.

### Shutter Priority + manual ISO

Use `resolveShutterPriorityExposureMode()` with manual ISO:

```ts
const resolved =
  resolveShutterPriorityExposureMode({
    target,
    capabilities,
    referenceExposure,
    manualShutterSeconds: 1 / 500,
    isoControl: {
      kind: "manual",
      iso: 400,
      apertureQuantizationPolicy:
        "nearest-log2-narrower-on-tie"
    }
  });
```

Shutter and ISO stay fixed; only the aperture is resolved.

With continuous aperture capability, the ideal f-number is used as is. Discrete aperture grids pick the nearest f-number in log2 space, with the narrower aperture winning an exact tie.

### Shutter Priority + Auto ISO

Use an aperture-first Auto ISO policy:

```ts
const resolved =
  resolveShutterPriorityExposureMode({
    target,
    capabilities,
    referenceExposure,
    manualShutterSeconds: 1 / 500,
    isoControl: {
      kind: "automatic",
      policy: {
        kind:
          "minimum-iso-aperture-first",
        isoBaseline:
          "minimum-selectable",
        isoQuantizationPolicy:
          "nearest-log2-lower-on-tie",
        apertureSelectionPolicy:
          "not-wider-than-target"
      }
    }
  });
```

This policy:

1. starts at the lowest selectable ISO;
2. resolves aperture first;
3. for a discrete aperture grid, chooses an aperture no wider than the ideal;
4. uses Auto ISO to fill the remaining exposure.

That direction is deliberate. Choosing an aperture wider than the ideal at minimum ISO could overexpose, with no lower ISO left to compensate.

### Automatic slowest shutter (#504)

Cameras let the photographer set the slowest shutter before Auto ISO raises the ISO to "Auto", chosen from the focal
length, with a bias in 1-stop steps (Sony's ISO AUTO Min. SS: Faster, Fast, Standard, Slow and Slower, 1 EV apart:
[help guide](https://helpguide.sony.net/ilc/2020/v1/en/contents/TP1000139958.html); Nikon and Fujifilm: see the manuals
cited above). Those cameras base it on the old reciprocal rule, about 1/focal length. That is a rule of thumb, not physics,
and the engine does not use it. `estimateAutoIsoSlowestShutter()` derives the threshold from the engine's own camera-shake
model, `estimateCameraShakeBlur()` ([camera shake](https://github.com/Photivra/photivra/blob/main/docs/STABILIZATION.md#controlled-camera-shake)), the same physics the preview
shows.

The camera turns at a constant angular velocity ω = (ω_yaw, ω_pitch), reduced by stabilization to r·ω with r = 2^−stops. A
still point on the optical axis then moves

```text
b(t) = v · hypot(tan(r·ω_yaw·t), tan(r·ω_pitch·t))
```

on the sensor, where v is the focal length (or, with `focusDistanceM`, the thin-lens image distance). The derived shutter is
the time t at which b(t) equals the blur budget. On one axis that is `t = atan(budget / v) / (r·|ω|)` exactly; on two axes
the engine bisects, which works because b grows strictly with t. Then:

1. the bias: `biased = derived · 2^−fasterByStops`, with `fasterByStops` a whole number from −2 to +2 (+1 is one stop faster);
2. the grid, optional: with `shutterCapability`, the biased time snaps to the body's shutter grid, never longer, held at its
   ends.

Composition fragment: requires previously validated bindings `capabilities`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  estimateAutoIsoSlowestShutter,
  GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC
} from "@photivra/engine";

const slowest =
  estimateAutoIsoSlowestShutter({
    focalLengthMm: 50,
    angularVelocityRadPerSec:
      GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC,
    stabilizationStopsEquivalent: 0,
    blurBudget: {
      kind: "pixels",
      pixels: 1,
      pixelPitchMicrometers: 6
    },
    fasterByStops: 0,
    shutterCapability:
      capabilities.shutter
  });
// slowest.value.shutterSeconds: about 1/640 s for 50 mm, 6 µm pixels and the generic hand.
```

The result reports `derivedShutterSeconds`, `biasedShutterSeconds`, `shutterSeconds` (after the grid), the blur budget and
the shake model's blur at the derived and the final shutter, the projection distance and the residual-motion factor, as an
`approximation` with its assumptions. The blur budget is `{ kind: "pixels", pixels, pixelPitchMicrometers }` or
`{ kind: "image-diagonal-fraction", fraction, imageWidthMm, imageHeightMm }`.

What the tests check: longer focal lengths give faster thresholds; each stabilization stop doubles the time exactly; the
bias moves it by exact whole stops; the shake model's blur at the derived time equals the budget; nothing is NaN or
infinite; invalid input fails with a domain error (no shake, a fractional or out-of-range bias, a non-positive budget, a
quarter turn of motion).

**The hand-shake profile is an input.** No free source gives one angular velocity for every photographer and camera.
`GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC` is a **labelled generic default**: 4.39 °/s (≈ 0.0766 rad/s), on yaw. It is the
linear camera-motion rate F. Xiao, J. Farrell, P. Catrysse and B. Wandell use for an average user holding a typical 100 g
mobile handset with two hands ("Mobile imaging: the big challenge of the small pixel", Proc. SPIE 7250, Digital
Photography V, 2009, §2; [author copy](https://web.stanford.edu/~wandell/data/papers/2009-CameraShake-Xiao.pdf)). They
take it from their earlier gyroscope measurements, F. Xiao et al., "Camera-motion and mobile imaging", Proc. SPIE 6502
(2007), which report that the motion is close to linear for exposures under about 100 ms. It is one magnitude, so the
engine puts it on yaw; for small angles the blur length does not depend on the direction. A heavier camera, another grip
or another photographer moves differently, so pass your own profile when you have one.

**Approximations.** Constant angular velocity, blur on the optical axis only, stabilization as 2^−stops (the educational
model of `estimateCameraShakeBlur()`, not a CIPA DC-011 rating), no roll, translation or subject motion. The blur budget is
your choice of sharpness, not a measured threshold.

#### Through `simulateCapture`

`exposure.autoIso.slowestPreferredShutterSeconds: "auto"` (aperture priority; optional in program) calls
`estimateAutoIsoSlowestShutter()` with the request's focal length, focus distance, pixel pitch and the body's shutter range.
`exposure.autoIso.automaticSlowestShutter` sets `fasterByStops` (default 0), `blurBudgetPixels` (default 1, a generic
pixel-level budget), `angularVelocityRadPerSec` (default the generic hand above) and `stabilizationStopsEquivalent` (default 0:
the tiers declare none). Each default is recorded as a `default` assumption. The report's `exposure.autoIso.automaticSlowestShutter`
gives the derived, biased and used times and the blur at the used time in pixels.

### Program Auto with Auto ISO: a slowest preferred shutter (#504)

`resolveProgramAutoExposureMode()` optionally takes
`isoControl.slowestPreferredShutter: { slowestPreferredShutterSeconds, afterMaximumIso }`
(`ProgramSlowestPreferredShutterPolicy`), the same two-axis policy as Aperture Priority + Auto ISO:

1. Follow the program line at the lowest selectable ISO.
2. If the line's shutter is longer than `slowestPreferredShutterSeconds`, hold the shutter there (snapped, never longer),
   keep the line's aperture, and raise the ISO.
3. At the Auto ISO maximum (the body's or the photographer's `autoIsoLimits`), `"allow-slower-shutter"` lengthens the shutter
   toward the target, but never past the line's own shutter. `"hold-preferred-shutter"` keeps the shutter there and reports
   the residual.

The result adds `slowestPreferredShutter: { ..., applied, afterMaximumIsoFallbackUsed }`; `programLineSelection` stays the
line's own selection. Without the option the resolver behaves as before and reports no such field. Full Auto exposure does
not take the option.

### Shared boundaries

These are control policies over the same relative exposure equation. They create no new optics or sensor physics.

All modes:

- use the meter target, with compensation already applied;
- use the resolved capability envelope;
- use the explicit reference exposure anchor;
- keep the same sign convention for residual stops;
- do not infer ISO noise or gain topology;
- do not apply flash policy or safety shift.

Flash-aware behaviour, safety shift and the program behaviour of named cameras are separate work.

## Program Auto and Full Auto exposure

Program Auto and Full Auto exposure both need a declared, versioned **program line**: a curve that says which aperture and shutter to use at each brightness level. The engine does not invent one "correct" aperture/shutter pair.

### Generic program line

Use `parseExposureProgramLineProfile()`:

```ts
import {
  parseExposureProgramLineProfile
} from "@photivra/engine";

const programLine =
  parseExposureProgramLineProfile({
    schemaVersion: "0.1.0",
    profileId: "balanced-line",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    policyKind:
      "generic-program-line",
    interpolation:
      "log2-aperture-shutter",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "program-line:balanced",
        reuseStatus:
          "photivra-owned"
      }
    ],
    limitations: [
      "Generic educational policy."
    ],
    nodes: [
      {
        nodeId: "minus-two",
        opticalExposureStopsFromReference:
          -2,
        aperture: 8,
        shutterSeconds: 1 / 125
      },
      {
        nodeId: "zero",
        opticalExposureStopsFromReference:
          0,
        aperture: 4,
        shutterSeconds: 1 / 125
      },
      {
        nodeId: "plus-two",
        opticalExposureStopsFromReference:
          2,
        aperture: 4,
        shutterSeconds: 4 / 125
      }
    ]
  });
```

Each node's declared stop value must match its aperture/shutter optical exposure, relative to the same `referenceExposure` given to the exposure resolver. Nodes outside the resolved aperture/shutter capability envelope fail closed.

Between nodes, aperture and shutter interpolate in log2 space. That keeps the optical exposure, in stops, linear along each segment, before rounding to the equipment's settings.

### Program Auto with manual ISO

```ts
const resolved =
  resolveProgramAutoExposureMode({
    target,
    capabilities,
    referenceExposure,
    programLine,
    isoControl: {
      kind: "manual",
      iso: 100
    }
  });
```

Aperture and shutter are automatic. ISO is kept exactly, after it is checked against the capabilities.

If the target falls beyond the first or last program-line node, the line stops at that endpoint, and the result reports the remaining under- or over-exposure.

### Program Auto with Auto ISO

```ts
const resolved =
  resolveProgramAutoExposureMode({
    target,
    capabilities,
    referenceExposure,
    programLine,
    isoControl: {
      kind: "automatic",
      isoBaseline:
        "minimum-selectable",
      isoQuantizationPolicy:
        "nearest-log2-lower-on-tie"
    }
  });
```

The program line is first evaluated at the minimum selectable ISO. Auto ISO then fills any remaining exposure caused by:

- a target beyond the line endpoint;
- aperture/shutter quantization;
- capability clamping.

If the program line gives too much exposure even at minimum ISO, ISO stays at the minimum and the residual is reported.

### Full Auto exposure

```ts
const resolved =
  resolveFullAutoExposureMode({
    target,
    capabilities,
    referenceExposure,
    policy: {
      kind:
        "generic-program-line-minimum-iso",
      programLine,
      isoBaseline:
        "minimum-selectable",
      isoQuantizationPolicy:
        "nearest-log2-lower-on-tie"
    }
  });
```

Full Auto **exposure** resolves aperture, shutter, and ISO only.

It explicitly does **not** resolve:

- autofocus;
- white balance;
- flash;
- drive mode;
- scene recognition;
- stabilization policy.

Those fields stay false in the result, so an application cannot accidentally treat this mode as automation of the whole camera.

### Program/Full Auto consistency

Given the same:

- exposure target;
- equipment capabilities;
- reference exposure;
- program line;
- Auto ISO policy;

Program Auto + Auto ISO and Full Auto exposure should give identical aperture, shutter and ISO values.

Only the name of the control mode differs.

### Boundaries

Program lines are approximations of product policy, not physical laws. Do not describe a generic line as reproducing a specific manufacturer unless exact evidence supports that claim.

Flash-aware program changes, safety shift and wider Full Auto camera decisions are separate work.

## Bulb, Time, and long-exposure control

Bulb and Time are **ways of controlling duration**, not different exposure equations. (Bulb: the shutter stays open while the button is held. Time: one press opens it, a second press closes it.)

Use `resolveExposureDurationControl()` to turn user or control events into the concrete, positive number of seconds that image formation needs.

### Fixed duration

```ts
const fixed =
  resolveExposureDurationControl({
    kind: "fixed-duration",
    durationSeconds: 8
  });
```

### Bulb

Bulb remains active while the release/control is held:

```ts
const activeBulb =
  resolveExposureDurationControl({
    kind: "bulb",
    timeReference:
      "control-monotonic-seconds",
    pressSeconds: 10
  });

// activeBulb.status === "active"
// physicalExposureIntegrationAuthorized === false
```

Once release occurs:

```ts
const bulb =
  resolveExposureDurationControl({
    kind: "bulb",
    timeReference:
      "control-monotonic-seconds",
    pressSeconds: 10,
    releaseSeconds: 18
  });

// resolved duration = 8 seconds
```

### Time

Time starts on one action and stops on a later action:

```ts
const time =
  resolveExposureDurationControl({
    kind: "time",
    timeReference:
      "control-monotonic-seconds",
    startSeconds: 50,
    stopSeconds: 58
  });
```

Bulb and Time need finite timestamps, in order, from the same explicit monotonic-seconds control clock.

An unfinished Bulb or Time control cannot enter the physical exposure pipeline.

### Bind into authoritative exposure timing

After resolution, use `bindResolvedExposureDurationToCaptureExposureInput()`:

```ts
const exposureWindowInput =
  bindResolvedExposureDurationToCaptureExposureInput({
    resolution: bulb,
    durationEvidence: [
      {
        sourceOrigin: "photivra",
        sourceReference:
          "runtime-control:bulb",
        reuseStatus:
          "photivra-owned"
      }
    ],
    exposureWindowInput: {
      nativeRaster,
      shutterMechanism:
        "electronic",
      opening,
      closing,
      samplePointsNative
    }
  });

const windows =
  calculateCaptureExposureWindows(
    exposureWindowInput
  );
```

The adapter supplies only `nominalExposureDurationSeconds`.

It does **not** change or infer:

- shutter mechanism;
- opening/closing boundary topology;
- sensor readout;
- tripod/support state;
- stabilization state;
- long-exposure noise reduction;
- sensor temperature/heating;
- flash behavior.

There is no universal 30-second cap for Bulb or Time. A completed 300-second Bulb exposure resolves to 300 seconds.

Once resolved, that duration follows the same physical path, now and in future, as any fixed duration:

```text
resolved elapsed seconds
  -> #12 local exposure windows
  -> temporal scene/motion integration
  -> photon/electron accumulation
  -> dark current
  -> charge/saturation assessment
  -> downstream signal pipeline
```

There is no Bulb-specific physics shortcut.

### Mode-invariant downstream physics

Shooting-mode names are only control policy.

If Manual, Program and Full Auto exposure resolve the same:

- aperture;
- shutter duration;
- ISO;

then `calculateRelativeRenderedExposure()` and all later physical models receive identical physical inputs and must produce identical results.

Likewise, equal elapsed durations from fixed, Bulb or Time control, with the same shutter and timing inputs, give identical authoritative exposure windows.

## Exposure and ISO relations

Use `calculateExposureValue100()` for EV100:

```ts
import { calculateExposureValue100 } from "@photivra/engine";

const ev = calculateExposureValue100({
  aperture: 8,
  shutterSeconds: 1 / 125
});

console.log(ev.value);
```

Use `calculateRelativeOpticalExposure()` to compare aperture/shutter combinations:

```ts
import { calculateRelativeOpticalExposure } from "@photivra/engine";

const exposure = calculateRelativeOpticalExposure({
  aperture: 4,
  shutterSeconds: 1 / 250,
  referenceAperture: 5.6,
  referenceShutterSeconds: 1 / 125
});

console.log(exposure.value.factor);
console.log(exposure.value.stops);
```

Use `calculateRelativeRenderedExposure()` when a renderer needs a nominal linear brightness multiplier. It combines the change in optical exposure (aperture and shutter) with ISO gain, relative to declared reference settings:

```ts
import { calculateRelativeRenderedExposure } from "@photivra/engine";

const rendered = calculateRelativeRenderedExposure({
  aperture: 5.6,
  shutterSeconds: 1 / 2000,
  iso: 1600,
  referenceAperture: 5.6,
  referenceShutterSeconds: 1 / 1000,
  referenceIso: 800
});

console.log(rendered.value.factor); // 1
console.log(rendered.value.stops); // 0
console.log(rendered.value.opticalFactor); // 0.5
console.log(rendered.value.isoGainFactor); // 2
```

This is a relative rendering relation, not a radiometric sensor model. ISO is treated as nominal rendering gain; it does not create photons. The function does not model clipping, tone mapping, lens transmission or sensor-specific noise.

Use `calculateEquivalentIso()` to calculate the nominal ISO (gain) change needed to keep the rendered exposure the same:

```ts
import { calculateEquivalentIso } from "@photivra/engine";

const iso = calculateEquivalentIso({
  baseIso: 400,
  baseAperture: 4,
  baseShutterSeconds: 1 / 500,
  aperture: 5.6,
  shutterSeconds: 1 / 500
});

console.log(iso.value);
```

These relations do not model scene radiance, lens T-stop/transmission, vignetting, or sensor-specific gain/noise behavior.

See [Motion and Signal Foundation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#exposure-relations).

## Capture rotation exposure trajectories

Use `calculateCaptureRotationTrajectories()` to evaluate **pure camera rotation over each native point's own local exposure interval**. Shutter/exposure timing and sensor readout stay separate:

```ts
import { calculateCaptureRotationTrajectories } from "@photivra/engine";

const trajectories = calculateCaptureRotationTrajectories({
  imagingArea: { widthMm: 36, heightMm: 24 },
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  shutterMechanism: "electronic",
  nominalExposureDurationSeconds: {
    value: 1 / 1000,
    unit: "s",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "capture-config:example",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  opening: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.015,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  closing: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.015,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  focalLengthMm: 50,
  angularVelocityRadPerSec: {
    pitch: 0,
    yaw: 0.1,
    roll: 0
  },
  samplePointsNative: [
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 4000 }
  ]
});

console.log(trajectories.value.samples);
```

The function maps each native point to the image plane (before orientation) at the capture reference time. It then evaluates the existing `calculateCameraRotationImageMapping()` primitive at that point's local exposure start and end.

The explicit time reference is the **first opening-boundary phase**. For this composition only, that reference is tied to `t = 0` of the low-level rotation model. This does not change the standalone rotation API for other callers.

The returned trajectory is the **forward path over time of one stationary ray from the world**:

- `referenceImagePointMm` is the ray's image-plane position at the capture reference;
- `atLocalExposureStart` and `atLocalExposureEnd` are its mapped positions at the local window endpoints;
- `localExposureTrajectoryEndpointDeltaMm` is the chord between those endpoints.

The chord is not an integrated blur kernel. Nor is it a rolling-shutter warp ready for a renderer.

When the capture scans across the sensor, the image mapping depends on location, because capture time varies across the image. For the current pure-rotation model, going back from destination to reference is analytic once the destination location has picked its local capture time. More general motion models may need extra solving and checks that the mapping is valid everywhere. Rendering a finite exposure still needs integration over the whole local interval, not one endpoint or midpoint displacement.

`calculateSensorReadoutTiming()` is deliberately not an input. If a specific capture mode has a defensible relationship between electronic exposure timing and sensor readout timing, a future explicit mode/link contract should represent it. This API does not assume it.

The trajectory model is pure rotation only. It leaves out camera translation/parallax, subject motion, rotating or deforming subjects, occlusion changes, panning intent, exposure integration, flash/flicker, shutter shock and the final inverse rolling-shutter warp.

## Capture rotation temporal quadrature

Use `calculateCaptureRotationTemporalQuadrature()` when a renderer or reference evaluator needs deterministic geometry samples for pure rotation, spread over each destination point's whole local exposure interval:

```ts
import { calculateCaptureRotationTemporalQuadrature } from "@photivra/engine";

const quadrature = calculateCaptureRotationTemporalQuadrature({
  imagingArea: { widthMm: 36, heightMm: 24 },
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  shutterMechanism: "electronic",
  nominalExposureDurationSeconds: {
    value: 1 / 1000,
    unit: "s",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "capture-config:example",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  opening: {
    kind: "simultaneous"
  },
  closing: {
    kind: "simultaneous"
  },
  focalLengthMm: 50,
  angularVelocityRadPerSec: {
    pitch: 0,
    yaw: 0.1,
    roll: 0
  },
  orientation: "landscape",
  temporalSampleCount: 8,
  samplePointsNative: [{ x: 3000, y: 2000 }]
});

console.log(quadrature.value.points[0]?.nodes);
```

The first model uses deterministic uniform midpoint quadrature. With `N` samples, node phases are:

```text
phase_i = (i + 0.5) / N
```

Each phase is passed through `calculateCaptureRotationInverseMappings()`, so the instantaneous destination-to-reference geometry is defined by one existing public model.

Every node has two different time weights:

- `normalizedTimeWeight = 1 / N`, for a time average under the declared uniform temporal-response approximation;
- `timeMeasureSeconds = localExposureDuration / N`, for a time integral.

Do not swap them. The first is dimensionless; the second is in seconds. Neither includes shutter transmission, scene radiance, sensor response, photon conversion, vignetting or any other radiometric throughput.

Different sensor locations may have different local exposure start and end times. If the opening and closing scans give different local durations, `timeMeasureSeconds` differs between destination points, while the normalized weights still sum to about one for each point.

This API returns **only time-sampled geometry and its weights**. It does not:

- fetch or sample scene radiance;
- average the reference coordinates;
- calculate a blur radius/kernel or PSF;
- resolve visibility/occlusion changes;
- apply sensor readout timing;
- apply flash/flicker or shutter-shock behavior;
- write or resample output pixels.

Averaging geometric coordinates is not the same as integrating radiance along moving rays.

Photivra also does not report an integration-error estimate from geometry alone. The error in the image depends on radiance, visibility, how fine the texture and edges are, reconstruction and the motion path. When convergence evidence is needed, a reference renderer can compare increasing `temporalSampleCount` values on the radiance or output.

## Instantaneous capture rotation inverse mapping

Use `calculateCaptureRotationInverseMappings()` to map captured destination locations back to the **reference image at the first opening boundary**, under pure camera rotation:

```ts
import {
  calculateCaptureRotationInverseMappings
} from "@photivra/engine";

const mapping = calculateCaptureRotationInverseMappings({
  imagingArea: { widthMm: 36, heightMm: 24 },
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  shutterMechanism: "electronic",
  nominalExposureDurationSeconds: {
    value: 1 / 1000,
    unit: "s",
    evidence: [
      {
        sourceOrigin: "photivra",
        sourceReference: "capture-config:example",
        reuseStatus: "photivra-owned"
      }
    ]
  },
  opening: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.015,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:opening-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  closing: {
    kind: "uniform-linear-native-scan",
    directionNative: {
      value: "top-to-bottom",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-direction",
          reuseStatus: "photivra-owned"
        }
      ]
    },
    traversalDurationSeconds: {
      value: 0.015,
      unit: "s",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "timing-profile:closing-traversal",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  },
  focalLengthMm: 50,
  angularVelocityRadPerSec: {
    pitch: 0,
    yaw: 0.1,
    roll: 0
  },
  localExposurePhase: 0.5,
  orientation: "landscape",
  samplePointsNative: [
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 4000 }
  ]
});

console.log(mapping.value.samples);
```

`localExposurePhase` is mandatory:

- `0` evaluates local exposure start;
- `0.5` evaluates the local temporal midpoint;
- `1` evaluates local exposure end.

Photivra does not choose a default phase, because a finite exposure has no single correct sharp geometry.

Each destination native point first picks its local exposure time. Under the current model (pure rotation about a constant axis), the captured ray can then be rotated **analytically** back to the exposure-start reference frame with `calculateInverseCameraRotationImageMapping()`. No iterative solver or convergence tolerance is needed.

The result reports:

- destination native and ideal image-plane coordinates;
- the local exposure window and selected capture time;
- the corresponding reference image-plane ray;
- reference-minus-destination displacement in image-plane millimetres;
- equivalent continuous native effective-sample displacement;
- that displacement rotated into the requested physical capture orientation.

The mapping deliberately stays in the ideal geometry stage, before the lens. It does not apply radial distortion, lateral CA, PSF, output crop or output resampling.

Reference rays are **not clamped** to the active source region. Camera motion can mean that a valid captured destination needs reference-image data from outside that region. A renderer must decide how to handle missing source coverage, rather than silently clamping or stretching an edge.

This is an **instantaneous** mapping only. It is not a complete image of a finite rolling (scanned) exposure. Motion blur needs several time samples, or another defensible way of integrating over each local exposure window, including an explicit exposure-weighting model if the weighting is not uniform.

Sensor data-readout timing is deliberately not part of this calculation. The capture exposure boundaries stay the authoritative timing input, until a separate capture-mode/link contract says otherwise.

The model is pure rotation only. Outside it: translation/parallax, subject motion, deformation, occlusion changes, checks that the mapping never folds over on itself, flash/flicker, shutter shock and finite-exposure integration.

## Spatial camera-rotation mapping

Use `calculateCameraRotationImageMapping()` when you need to know where a stationary ray from the world lands on the image plane after **pure camera rotation**, at any physical time after exposure start.

```ts
import { calculateCameraRotationImageMapping } from "@photivra/engine";

const mapped = calculateCameraRotationImageMapping({
  focalLengthMm: 50,
  imagePointMm: { x: 18, y: 12 },
  timeSecondsFromExposureStart: 1 / 60,
  angularVelocityRadPerSec: {
    pitch: 0.01,
    yaw: 0.02,
    roll: 0.005
  },
  samplingPitchMicrometers: {
    x: 6,
    y: 6
  }
});

console.log(mapped.value.mappedImagePointMm);
console.log(mapped.value.deltaMm);
console.log(mapped.value.deltaImagePlaneSamples);
```

Coordinate/sign convention:

- camera axes at exposure start are +X right, +Y up, +Z forward (a left-handed basis);
- positive pitch/yaw/roll follow the physical right-hand rule about +X/+Y/+Z: positive yaw turns the camera left and moves stationary content toward +X; positive pitch tilts it up and moves content toward −Y; positive roll is clockwise as seen from behind the camera and rotates content counter-clockwise;
- the returned image-plane basis is +X right, +Y up;
- a stationary world ray is transformed by the **inverse** camera rotation, so image content moves opposite to the camera's own turn;
- `estimateCameraShakeBlur()` uses the same yaw/pitch signs (from 2.0.0); see [Motion and signal](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#spatial-camera-rotation);
- optional `deltaImagePlaneSamples` retains image-plane +Y-up semantics and is **not** a native-raster (+Y-down) vector.

The angular-velocity vector is assumed constant, and is integrated as one axis-angle rotation. This avoids picking an arbitrary Euler-angle order when pitch, yaw and roll happen at the same time.

The function is deliberately rotation-only. Camera translation is left out, because image motion from translation depends on scene depth (parallax).

It is also separate from stabilization. `estimateCameraShakeBlur()` is still the older, educational stabilization-equivalent approximation with one global vector. From 2.0.0, its yaw/pitch signs match this mapping at the optical axis.

## Camera shake and stabilization-equivalent approximation

Use `estimateCameraShakeBlur()` with a controlled yaw/pitch angular-velocity profile:

```ts
import { estimateCameraShakeBlur } from "@photivra/engine";

const shake = estimateCameraShakeBlur({
  focalLengthMm: 200,
  shutterSeconds: 1 / 60,
  angularVelocityRadPerSec: {
    yaw: 0.002,
    pitch: 0.001
  },
  stabilizationStopsEquivalent: 3,
  focusDistanceM: 22,
  pixelPitchMicrometers: 6
});

console.log(shake.value.unstabilized.distancePixels);
console.log(shake.value.stabilized.distancePixels);
console.log(shake.value.residualMotionFactor);
console.log(shake.provenance.kind); // "approximation"
```

`deltaXmm`/`deltaYmm` are the image displacement (+X right, +Y up) of a stationary point on the optical axis.

- Positive yaw (camera turns left) gives positive `deltaXmm`.
- Positive pitch (camera tilts up) gives negative `deltaYmm`.
- These signs match `calculateCameraRotationImageMapping()` at the optical axis. For a single axis, the displacements are equal within floating-point rounding.
- A per-axis rotation of π/2 rad or more over the exposure is rejected.

The `2^-stops` attenuation is an educational approximation, not a real IBIS/OIS (in-body / optical image stabilization) or CIPA rating. The output is one global image-plane vector, not image motion that varies across the frame.

See [Camera Shake and Stabilization](https://github.com/Photivra/photivra/blob/main/docs/STABILIZATION.md).

## Radiometry readiness

Use `parseRadiometryReadinessProfile()` and `assessRadiometryReadiness()` to check whether a declared radiometric calibration package has the prerequisites a future photon estimate would need.

The gate covers six independently declared requirements:

1. scene spectral radiance or a documented spectral approximation;
2. optical transmission, either spectral data or an explicit T-stop approximation;
3. pupil/vignetting behavior;
4. photosite collection-area semantics;
5. exposure integration;
6. sensor spectral response / quantum efficiency.

Example:

```ts
import {
  assessRadiometryReadiness,
  parseRadiometryReadinessProfile
} from "@photivra/engine";

const profile = parseRadiometryReadinessProfile({
  schemaVersion: "0.1.0",
  components: [
    {
      requirement: "photosite-collection-area",
      scientificStatus: "approximation",
      modelId: "example-collection-area",
      modelVersion: "1.0.0",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "photivra:example",
          reuseStatus: "photivra-owned"
        }
      ],
      uncertainty: {
        kind: "not-quantified",
        limitation: "Example only."
      },
      areaModel: "geometric-area-times-fill-factor",
      geometricCellAreaSquareMicrometers: 36,
      fillFactor: 0.8
    }
  ]
});

const readiness = assessRadiometryReadiness(profile);

console.log(readiness.status); // "not-ready"
console.log(readiness.missingRequirements);
console.log(readiness.composedPhotonOutputEnabled); // always false
```

Readiness states are:

- `not-ready`: one or more required categories are missing;
- `approximate-only`: every category is present, but at least one component is approximate or has no quantified uncertainty;
- `calibrated-ready`: every category is declared calibrated and carries quantified uncertainty.

A readiness assessment checks the declared structure and provenance metadata. It does not check that a source or calibration is scientifically correct.

Geometric sample pitch alone is **not** accepted as photon-collection area. The profile must declare either an effective collection area, or a geometric cell area plus an explicit fill factor.

Spectral and spatial calibration inputs that carry data are referenced by an artifact ID plus a SHA-256 checksum. Photivra does not assume reuse rights because something is publicly available. Reusable calibration data needs an explicit licence or Photivra ownership.

The readiness API does not calculate photons, does not change the existing `calculatePhotoelectrons()` primitive, and does not add photon/noise output to `simulatePocCamera()`. The bounded [executed environment route](https://github.com/Photivra/photivra/blob/main/docs/PRODUCTION_ENVIRONMENT_CAPTURE.md) does explicitly declared EQE photon/electron integration. This readiness gate alone neither turns it on nor checks calibration.

## Photoelectron and SNR primitives

Use `calculatePhotoelectrons()` only when you already have a defensible mean count of incident photons and a quantum efficiency (the fraction of photons that produce an electron):

```ts
import { calculatePhotoelectrons } from "@photivra/engine";

const electrons = calculatePhotoelectrons({
  incidentPhotons: 10_000,
  quantumEfficiency: 0.7
});

console.log(electrons.value);
```

Use `calculateSignalToNoise()` for the basic signal-to-noise ratio (SNR) model: Poisson shot noise plus independent RMS read noise:

```ts
import { calculateSignalToNoise } from "@photivra/engine";

const snr = calculateSignalToNoise({
  signalElectrons: 7000,
  readNoiseElectrons: 3
});

console.log(snr.value.shotNoiseStdElectrons);
console.log(snr.value.combinedNoiseStdElectrons);
console.log(snr.value.snrLinear);
console.log(snr.value.snrDb);
```

These primitives do not derive photons from scene imagery and do not model a complete commercial sensor pipeline.

See [Motion and Signal Foundation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#signalnoise-primitives).

## Scene illumination source profiles

Use `parseSceneIlluminationProfile()` to read light-source metadata that comes from a renderer or another integration:

```ts
import { parseSceneIlluminationProfile } from "@photivra/engine";

const illumination = parseSceneIlluminationProfile({
  schemaVersion: "0.1.0",
  profileId: "studio-reference",
  sceneId: "studio",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "scene:studio-reference",
      reuseStatus: "photivra-owned"
    }
  ],
  sources: [
    {
      sourceId: "key",
      family: "area",
      enabled: true,
      geometry: {
        kind: "scene-object-binding",
        sceneObjectId: "key-panel"
      },
      magnitude: {
        kind: "relative-linear-scale",
        scale: 1,
        scientificStatus: "approximation",
        limitation: "Reference-render brightness only."
      },
      spectrum: {
        kind: "blackbody-temperature-approximation",
        temperatureKelvin: 3200,
        limitation: "Declared blackbody approximation."
      },
      temporalBehavior: {
        kind: "time-invariant"
      },
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "scene:key-panel",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  ]
});

console.log(illumination.sources[0]?.sourceId);
console.log(illumination.sceneRadianceCalculated); // false
```

The schema deliberately has no generic `intensity` field. How brightness is stated depends on the kind of source:

- point sources may declare radiant intensity in W/sr;
- area sources may declare surface radiance in W/(m²·sr);
- directional sources may declare irradiance in W/m² at an explicit reference plane;
- spot and environment sources are relative-only in schema 0.1.0, until their angular and radiance-field meaning is modelled.

Every kind of source may use an explicitly approximate, relative linear scale. To turn a source off, use `enabled: false`. A zero magnitude is never used as a hidden "off" state.

Spectra are explicit too:

- Linear sRGB is for previews only.
- A blackbody temperature is a declared blackbody approximation, not a universal CCT control.
- Continuous relative spectra need reusable-data provenance. They do not become absolute spectral power or radiance just because a physical broadband magnitude also exists.

Sources with discrete spectral lines may use `discrete-relative-lines` instead.

- Each line has an explicit wavelength and a normalized, **wavelength-integrated** line weight.
- Line weights must sum to one and use a resolved air/vacuum wavelength basis.
- These values are not per-nanometre densities, and a line is never given an arbitrary width.
- `resolveSceneIlluminationDiscreteLineMeasure()` can distribute a source's integrated magnitude across those line fractions, keeping the source's unit.

The parser only sets up light-source metadata. It does not calculate material response, visibility, indirect light, outgoing scene spectral radiance, sensor-plane irradiance, photons/electrons, fluorescence, volumetric spectral transport or polarization.

See [Scene Radiance and Illumination](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md).

## Scene-radiance provider and material response

A scene-radiance provider is the renderer (or reference evaluator) that works out how much light leaves a point in the scene. Use this provider boundary when it needs to hand back one sample of outgoing spectral radiance, without moving its rendering algorithm into the engine.

First define material-response metadata:

```ts
import {
  parseSceneMaterialResponseProfile
} from "@photivra/engine";

const materials = parseSceneMaterialResponseProfile({
  schemaVersion: "0.1.0",
  profileId: "room-materials",
  sceneId: "room",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "materials:room",
      reuseStatus: "photivra-owned"
    }
  ],
  materials: [
    {
      materialResponseId: "wall-preview",
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "material:wall-preview",
          reuseStatus: "photivra-owned"
        }
      ],
      representation: {
        kind: "rgb-pbr-approximation",
        colorSpace: "linear-srgb",
        baseColor: {
          red: 0.2,
          green: 0.3,
          blue: 0.6
        },
        metallic: 0,
        roughness: 0.7,
        limitation:
          "RGB/PBR preview data is not measured spectral response."
      }
    }
  ],
  fluorescenceModeled: false,
  volumetricMaterialTransportModeled: false,
  polarizationModeled: false
});
```

Then declare the provider's fidelity and bindings:

```ts
import {
  parseSceneRadianceProviderProfile
} from "@photivra/engine";

const provider = parseSceneRadianceProviderProfile({
  schemaVersion: "0.1.0",
  profileId: "reference-renderer",
  sceneId: "room",
  illuminationProfileId: "room-lights",
  materialResponseProfileId: "room-materials",
  outputQuantity: "outgoing-spectral-radiance",
  outputUnit: "W/m^2/sr/nm",
  scientificStatus: "approximation",
  uncertainty: {
    kind: "not-quantified",
    limitation:
      "Renderer transport has not been calibrated as a complete radiance model."
  },
  fidelity: {
    spectral: "rgb-derived-approximation",
    material: "rgb-pbr-approximation",
    visibility: "resolved",
    directTransport: "resolved",
    indirectTransport: "approximation"
  },
  wavelengthChangingTransportModeled: false,
  volumetricTransportModeled: false,
  polarizationModeled: false,
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "provider:reference-renderer",
      reuseStatus: "photivra-owned"
    }
  ],
  limitations: [
    "Fluorescence and polarization are not modeled."
  ]
});
```

How an evaluation works:

1. A request names one exact surface or environment direction, a physical time and a wavelength.
2. The renderer/provider computes the radiance outside the engine, and returns a result in `W/m^2/sr/nm`.
3. Parse both with `parseSceneRadianceEvaluationRequest()` and `parseSceneRadianceEvaluationResult()`.
4. Call `validateSceneRadianceEvaluationBindings()` with the provider, illumination profile, material profile, request and result.

The binding validator checks the exact scene, profile, material, sample and wavelength identity, and that the provider's material fidelity is consistent. It **does not** recompute the renderer's number, apply optics, calculate sensor-plane irradiance or allow photon output.

Provider/result schema 0.1.0 is approximation-only. Calibrated material or illumination inputs cannot silently turn provider output into calibrated scene radiance.

See [Scene Radiance and Illumination](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#scene-radiance-provider-and-material-response-boundary).

## Shared spectral composition

Use `composeSpectralCoverage()` when several **continuous** wavelength-dependent factors (scene, lens, sensor) need one shared plan of wavelength coverage and breakpoints.

Composition fragment: requires previously validated bindings `spectralResponseProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  composeSpectralCoverage,
  createSensorSpectralCoverageParticipant
} from "@photivra/engine";

const sensorCoverage =
  createSensorSpectralCoverageParticipant({
    spectralResponseProfile,
    channelId: "green"
  });

const composition =
  composeSpectralCoverage({
    participants: [
      {
        participantId: "scene-radiance",
        role: "scene-radiance",
        wavelengthBasis: "vacuum",
        wavelengthRangeNanometers: {
          minimum: 420,
          maximum: 680
        },
        breakpointsNanometers: [
          500,
          600
        ]
      },
      {
        participantId: "lens-transmission",
        role: "optical-transmission",
        wavelengthBasis: "vacuum",
        wavelengthRangeNanometers: {
          minimum: 400,
          maximum: 700
        },
        breakpointsNanometers: [
          450,
          550,
          650
        ]
      },
      sensorCoverage
    ]
  });

console.log(
  composition
    .commonWavelengthRangeNanometers
);
console.log(
  composition
    .segmentBoundariesNanometers
);
```

The composition:

- requires all participants to use the same resolved air/vacuum wavelength basis;
- intersects their wavelength ranges;
- unions internal interpolation breakpoints inside that overlap;
- does not apply scene values, optical transmission, QE, or A/W responsivity;
- does not perform spectral integration or claim convergence.

Continuous illumination spectra can be converted to the same participant shape with `createSceneIlluminationSpectralCoverageParticipant()`. That adapter rejects RGB, blackbody approximations, unresolved spectra and discrete line spectra.

### Discrete line measures

Discrete spectral lines (as from a laser or some lamps) are integrated a different way.

Composition fragment: requires previously validated bindings `illumination`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  integrateDiscreteSpectralLineMeasure,
  resolveSceneIlluminationDiscreteLineMeasure
} from "@photivra/engine";

const lineSource =
  illumination.sources.find(
    (source) =>
      source.sourceId === "line-source"
  );

if (
  lineSource?.spectrum.kind ===
  "discrete-relative-lines"
) {
  const measure =
    resolveSceneIlluminationDiscreteLineMeasure(
      lineSource
    );

  const integrated =
    integrateDiscreteSpectralLineMeasure(
      measure.measure
    );

  console.log(
    integrated.integratedQuantity
  );
  console.log(
    integrated.quantityUnit
  );
}
```

A discrete line entry already is a wavelength-integrated contribution. So integrating lines is just:

```text
total = sum(line integrated quantities)
```

There is **no** multiplication by `dλ`. Giving a laser or line emitter an arbitrary width, just to reuse continuous quadrature, is invalid.

The source-level helper may distribute point radiant intensity (W/sr), area radiance (W/m²/sr), directional reference-plane irradiance (W/m²) or an explicitly relative magnitude across normalized line fractions. It does not apply material transport, optics, sensor response, photon conversion or combined uncertainty, and it does not allow a claim of calibrated outgoing radiance.

See [Scene Radiance and Illumination](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#shared-spectral-composition).

## Temporal illumination

Use `parseSceneIlluminationTemporalProfile()` to add explicit changes over time — such as a flash pulse or flicker — to light sources, without changing the base illumination schema.

Composition fragment: requires previously validated bindings `illuminationProfile`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  evaluateSceneIlluminationTemporalMultiplier,
  parseSceneIlluminationTemporalProfile
} from "@photivra/engine";

const temporal = parseSceneIlluminationTemporalProfile({
  schemaVersion: "0.1.0",
  profileId: "room-light-timing",
  sceneId: "room",
  illuminationProfileId: "room-lights",
  evidence: [
    {
      sourceOrigin: "photivra",
      sourceReference: "timing:room-lights",
      reuseStatus: "photivra-owned"
    }
  ],
  waveforms: [
    {
      waveformId: "flash-pulse",
      kind: "aperiodic-relative-multiplier",
      timeUnit: "s",
      scientificStatus: "approximation",
      uncertainty: {
        kind: "not-quantified",
        limitation: "Example waveform."
      },
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "waveform:flash-pulse",
          reuseStatus: "photivra-owned"
        }
      ],
      interpolation: "piecewise-linear",
      outsideSupportBehavior: "zero",
      samples: [
        {
          timeSecondsFromWaveformReference: 0,
          relativeMagnitudeMultiplier: 0
        },
        {
          timeSecondsFromWaveformReference: 0.002,
          relativeMagnitudeMultiplier: 1
        },
        {
          timeSecondsFromWaveformReference: 0.006,
          relativeMagnitudeMultiplier: 0
        }
      ]
    }
  ],
  sourceBindings: [
    {
      bindingId: "key-flash-registration",
      sourceId: "key-flash",
      waveformId: "flash-pulse",
      captureTimeReference: "first-opening-boundary-phase",
      waveformTimeZeroSecondsFromCaptureReference: 0.001,
      scientificStatus: "approximation",
      timingUncertainty: {
        kind: "not-quantified",
        limitation: "Example registration."
      },
      evidence: [
        {
          sourceOrigin: "photivra",
          sourceReference: "registration:key-flash",
          reuseStatus: "photivra-owned"
        }
      ]
    }
  ]
});

const temporalSample =
  evaluateSceneIlluminationTemporalMultiplier({
    illuminationProfile,
    temporalProfile: temporal,
    sourceId: "key-flash",
    captureTimeSecondsFromReference: 0.003
  });

console.log(
  temporalSample
    .effectiveRelativeMagnitudeMultiplier
);
```

Waveform time is explicitly tied to seconds from the first opening-boundary phase. Sensor readout duration is not used in place of exposure timing.

For a finite exposure, use `integrateSceneIlluminationTemporalMultiplierOverExposureWindow()` with the authoritative `CaptureExposureWindows` result and one sample index. It uses deterministic midpoint quadrature over that local exposure window, and returns the average and the seconds-integrated relative multipliers.

This layer does not apply the source's physical magnitude, evaluate material or visibility transport, calculate scene radiance, apply sensor response or choose camera exposure settings.

A scene-radiance provider may optionally bind the temporal profile with `illuminationTemporalProfileId`. When declared, `validateSceneRadianceEvaluationBindings()` requires the matching temporal profile.

See [Scene Radiance and Illumination](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#temporal-illumination).

## Camera and scene schema validation

Use the runtime parsers whenever camera or scene data comes from untrusted JSON.

Composition fragment: requires previously validated bindings `cameraJson`, `sceneJson`. This is an integration sketch, not a standalone runnable program.

```ts
import {
  parseCameraConfiguration,
  parseSceneDefinition
} from "@photivra/engine";

const camera = parseCameraConfiguration(JSON.parse(cameraJson));
const scene = parseSceneDefinition(JSON.parse(sceneJson));
```

The parsers throw `InvalidConfigurationError` when the structure, or one of the values, is invalid or unsupported.

Example camera shape:

```ts
const camera = parseCameraConfiguration({
  sensor: {
    widthMm: 36,
    heightMm: 24,
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  lens: {
    focalLengthMm: 50,
    aperture: 2.8
  },
  exposure: {
    shutterSeconds: 1 / 250,
    iso: 400
  },
  focus: {
    focusDistanceM: 10
  },
  stabilization: {
    bodyEnabled: true,
    lensEnabled: false,
    support: "handheld"
  }
});
```

See [Validation boundaries in the README](../README.md#validation-boundaries) and [Architecture](https://github.com/Photivra/photivra/blob/main/docs/ARCHITECTURE.md).

## Provenance, uncertainty, and quality metadata

Primitive scientific calculations return model provenance alongside the value:

```ts
import { calculateFieldOfView } from "@photivra/engine";

const result = calculateFieldOfView({
  focalLengthMm: 50,
  sensorDimensionMm: 36
});

console.log(result.provenance.kind);
console.log(result.provenance.model);
console.log(result.provenance.modelVersion);
console.log(result.provenance.assumptions);
```

If your code defines a new scientific result, the package exports helpers such as `calculatedResult()`, `approximationResult()`, `estimatedResult()` and `calibratedResult()`.

```ts
import { calculatedResult } from "@photivra/engine";

const result = calculatedResult(
  { distanceM: 10 },
  "example-model",
  "1.0.0",
  ["Example assumption"],
  {
    uncertainty: [
      {
        kind: "absolute",
        quantityPath: "value.distanceM",
        source: "measurement",
        plusMinus: 0.1,
        unit: "m"
      }
    ]
  }
);
```

Do not invent uncertainty values. Supply quality metadata only when the uncertainty, calibration, valid range or quality note has a defensible basis.

See [Scientific and Source Provenance](https://github.com/Photivra/photivra/blob/main/docs/PROVENANCE.md) and [Public API Style](https://github.com/Photivra/photivra/blob/main/docs/API_STYLE.md#result-metadata).

## Composed POC simulation

Use `simulatePocCamera()` when you want one combined response with the current POC (proof-of-concept) calculations.

The root engine and the composed POC are versioned independently. `ENGINE_API_VERSION` describes the root library; `POC_SIMULATION_API_VERSION` describes this composed request/response contract.

The composed POC reports X/Y geometric sample pitch, but internally it still uses one representative horizontal pitch for blur and sampling calculations, for backwards compatibility. It therefore rejects sensor geometry whose X and Y pitch differ by more than 1%. The lower-level geometry APIs handle each axis separately, for more general sensor layouts.

POC API 0.20 composes the capture-geometry foundation all the way to final output and viewing. Existing requests remain valid. New callers may supply an optional `capture` object with the physical orientation, an optional native active-capture rectangle, an optional oriented output crop and an optional final output raster.

- The staged `capture` request deliberately keeps the legacy `crop.factor` separate: it must stay `1` when `capture` is present.
- This geometry request is separate from the sensor/capture-mode profile contract.
- Staged capture can use the existing `subjectCrop` request, but the result appears under `capture.subjectFraming`, because it is a framing stage after output, not a legacy total-crop factor.

In capture mode, the equivalent-viewing CoC (circle of confusion) uses the final retained physical image region, including subject framing when present. Changing only the output pixel resolution does not change it. An explicit `circleOfConfusionMm` stays unchanged.

The optional `capture` block in the response gives:

- the resolved geometry;
- active and output FOV;
- the 35 mm-equivalent focal length of the active capture, based on the diagonal;
- the output sampling scale;
- optional subject framing;
- explicit motion diagnostics in native-raster, oriented and output coordinates.

Legacy motion Y uses the image plane, +Y up; capture raster Y is +Y down. The conversion is therefore reported, not hidden. The physical focal length stays authoritative. Sensor-architecture metadata and radiometry-readiness profiles are still standalone.


```ts
import { simulatePocCamera } from "@photivra/engine";

const simulation = simulatePocCamera({
  sensor: {
    widthMm: 36,
    heightMm: 24,
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  lens: {
    focalLengthMm: 200,
    aperture: 5.6
  },
  exposure: {
    shutterSeconds: 1 / 1000,
    iso: 800
  },
  focus: {
    focusDistanceM: 22,
    circleOfConfusionMm: 0.03
  },
  crop: {
    factor: 1
  },
  diffraction: {
    wavelengthNm: 550
  },
  motion: {
    positionM: { x: 0.2, y: 1.2, z: 21.8 },
    velocityMps: { x: 35, y: 0, z: 0 }
  },
  subject: {
    widthM: 0.7,
    heightM: 1.8,
    distanceM: 22
  },
  subjectCrop: {
    targetSubjectHeightFraction: 0.5
  },
  cameraShake: {
    angularVelocityRadPerSec: {
      yaw: 0.002,
      pitch: 0.001
    },
    stabilizationStopsEquivalent: 2
  },
  apertureShape: {
    bladeCount: 7,
    firstBladeEdgeAngleDegrees: 0
  }
});

console.log(simulation.apiVersion);
console.log(simulation.fieldOfView);
console.log(simulation.depthOfField);
console.log(simulation.motion);
console.log(simulation.provenance);
```

To opt into staged capture geometry:

```ts
const portraitCrop = simulatePocCamera({
  sensor: {
    widthMm: 36,
    heightMm: 24,
    pixelWidth: 6000,
    pixelHeight: 4000
  },
  lens: {
    focalLengthMm: 50,
    aperture: 4
  },
  exposure: {
    shutterSeconds: 1 / 250,
    iso: 100
  },
  focus: {
    focusDistanceM: 10,
    circleOfConfusionMm: 0.03
  },
  crop: {
    factor: 1
  },
  capture: {
    orientation: "portrait-clockwise",
    activeCaptureRect: {
      x: 1500,
      y: 1000,
      width: 3000,
      height: 2000
    },
    outputCropRect: {
      x: 500,
      y: 750,
      width: 1000,
      height: 1500
    },
    outputRaster: {
      pixelWidth: 2000,
      pixelHeight: 3000
    }
  },
  diffraction: {
    wavelengthNm: 550
  },
  motion: {
    positionM: { x: 0, y: 0, z: 10 },
    velocityMps: { x: 1, y: 0, z: 0 }
  }
});

console.log(portraitCrop.capture?.geometry);
console.log(portraitCrop.capture?.activeFieldOfView);
console.log(portraitCrop.capture?.focalLength);
console.log(portraitCrop.capture?.motion.outputDeltaPixels);
```

The focus request must supply exactly one circle-of-confusion criterion: either `circleOfConfusionMm` or `equivalentViewingCircleOfConfusion`. In staged capture mode, the equivalent-viewing approximation uses the final retained physical image region. An explicit `circleOfConfusionMm` is not changed by crop or output geometry.

You can supply extra named defocus, sampling and motion samples when a renderer or analysis tool needs results per object.

See [Local POC Simulation API](https://github.com/Photivra/photivra/blob/main/docs/POC_API.md#simulate) for the full request/response meaning. That HTTP transport is repository-only contributor tooling, and is not shipped as a package subpath. `simulatePocCamera()` itself is part of the browser-safe root package.

## DNG import and PNG output

- `parseDngRawImage` reads a DNG or TIFF-EP CFA/LinearRaw file (uncompressed or lossless JPEG, 8–16 bits). It returns the stored raw codes plus the CFA, black/white levels, active area, default crop, colour matrices, as-shot neutral and orientation. Nothing is applied to the codes.
- `serializePngImage` writes an 8- or 16-bit RGB PNG with an sRGB, ICC or cICP (Display P3, BT.2020; sRGB, BT.709 or linear transfer) colour description, and optional mDCV/cLLI display metadata. PQ and HLG are not part of 2.0 (see the patent review in `THIRD_PARTY.md`).

See [DNG import and PNG output](https://github.com/Photivra/photivra/blob/main/docs/IMPORT_AND_PNG.md) for supported subsets, limits and sources.

```ts
import { serializePngImage, parseDngRawImage } from '@photivra/engine';

// Encode a 1 x 1 Display P3 pixel (sRGB transfer), then show that a PNG is not a DNG.
const png = serializePngImage({ width: 1, height: 1, bitDepth: 8, samples: Uint8Array.of(255, 128, 0),
  colourEncoding: { kind: 'cicp', primaries: 'display-p3', transfer: 'srgb', fullRange: true } });
let rejected = false;
try { parseDngRawImage({ bytes: png }); } catch { rejected = true; }
if (!rejected) throw new Error('A PNG must not parse as a DNG');
```

## Text metadata on a file you encoded

`addJpegTextMetadata(jpeg, metadata)` and `addPngTextMetadata(png, metadata)` (#388) add the caller's text to a JPEG
or PNG that was encoded without `output.metadata`: for example a full-size file joined from `output.region` parts
and encoded with `composePrintJpegStrips` or `serializePngImage`. They are the functions that `output.metadata`
calls, so for the same file and text the bytes are the same as a whole-frame `simulateCapture` with
`output.metadata`. The text is checked as `output.metadata` is (see
[Text metadata](https://github.com/Photivra/photivra/blob/main/docs/QUICK_START.md#text-metadata-24)); invalid text or a
malformed file fails with `InvalidConfigurationError`. The input array is not changed.

```ts
import { addJpegTextMetadata, addPngTextMetadata, serializePngImage, simulateCapture } from '@photivra/engine';

const text = { description: 'Siemens star at f/8', software: 'My Viewer 1.0', comment: 'Test run 3' };
// A PNG the caller encoded (here one sRGB pixel) gets the PNG text chunks.
const png = addPngTextMetadata(serializePngImage({ width: 1, height: 1, bitDepth: 8, samples: Uint8Array.of(255, 128, 0),
  colourEncoding: { kind: 'srgb', renderingIntent: 'perceptual' } }), text);
// A JPEG written without output.metadata and tagged afterwards has the bytes of one written with it.
const plain = await simulateCapture({ scene: { preset: 'siemens-star' }, output: { width: 8, height: 8, format: 'jpeg' } });
const direct = await simulateCapture({ scene: { preset: 'siemens-star' }, output: { width: 8, height: 8, format: 'jpeg', metadata: text } });
const tagged = addJpegTextMetadata(plain.image.jpeg!, text);
const same = tagged.length === direct.image.jpeg!.length && tagged.every((byte, i) => byte === direct.image.jpeg![i]);
console.log(png.length, same);
```

## Native-only Print planning

- [Registered linear statistics](https://github.com/Photivra/photivra/blob/main/docs/PRINT_REGION_STATISTICS.md) tell apart changes caused by processing the same capture from variation between repeated captures at each site.
- The [static neutral Gabor contrast reference](https://github.com/Photivra/photivra/blob/main/docs/PRINT_CONTRAST_REFERENCE.md) needs explicit stimulus, luminance and observer conditions. It does not accept an arbitrary photographic ROI (region of interest) as a valid stimulus.
- Read the [#195/#196 candidate evidence review](https://github.com/Photivra/photivra/blob/main/docs/PRINT_195_196_REVIEW.md) before integrating either diagnostic.

See [Print planning](https://github.com/Photivra/photivra/blob/main/docs/PRINT_PLANNING.md) for a complete, strict packed example and the exact-ratio integer policy.

- `calculatePrintPlan()` says whether the native sampling is enough, and gives a compatible minimum file raster.
- `calculatePrintSizeLimit()` distinguishes finite, unbounded and unavailable sampling limits.
- Print quality and delivery are not assessed.

The [regional Print detail diagnostic](https://github.com/Photivra/photivra/blob/main/docs/PRINT_DETAIL_ASSESSMENT.md) measures one declared, coherent sinusoidal fundamental in a selected linear-luminance ROI, and records the exact pipeline stage it measured. Its [validation protocol](https://github.com/Photivra/photivra/blob/main/docs/PRINT_DETAIL_VALIDATION.md) and [capability ledger](https://github.com/Photivra/photivra/blob/main/docs/validation/print-detail-capabilities.json) separate mathematical conformance from the still-blocked qualification of acquired images, renderers and perceived quality.

## Rolling shutter, video, flash TTL/HSS and highlight-priority metering (2.0.0)

These additions are approximations. The equations, derivations and sources are in
[Electronic rolling-shutter image formation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#electronic-rolling-shutter-image-formation),
[Video frame sequences](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md#video-frame-sequences) and
[Flash: guide number, TTL and high-speed sync](https://github.com/Photivra/photivra/blob/main/docs/SCENE_SENSOR_TEMPORAL_EXPOSURE.md#flash-guide-number-ttl-and-high-speed-sync).

With an electronic rolling shutter, each sensor line starts its exposure slightly later than the one before.
The model turns the rolling readout declaration into an exposure schedule with one offset per line.

- Pass the schedule wherever an exposure window is accepted: native RAW and environment `exposureWindow`, and
  production `temporalCapture.exposureWindowInput` with `readoutExposureLinkage`.
- Skew, wobble, partial exposure and flicker banding then appear naturally from sampling each site at its own time.
- A video clip is a deterministic sequence of ordinary release frames.

```ts
import {
  assessShutterAngleRule,
  calculateCaptureExposureWindows,
  resolveElectronicRollingShutterExposureSchedule,
  resolveVideoFrameSequence,
  createRollingShutterCaptureExposureSchedule
} from "@photivra/engine";

const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "example:rolling-video", reuseStatus: "photivra-owned" as const }];
const readout = {
  readoutMode: "rolling" as const,
  captureReadoutDurationSeconds: { value: 0.016, unit: "s" as const, evidence },
  scanDirectionNative: { value: "top-to-bottom" as const, evidence },
  spatialSamplingSkewSeconds: { value: 0.016, unit: "s" as const, evidence }
};
const schedule = resolveElectronicRollingShutterExposureSchedule({
  readout,
  nominalExposureDurationSeconds: { value: 1 / 250, unit: "s", evidence },
  linkageEvidence: evidence
});
const windows = calculateCaptureExposureWindows({
  ...createRollingShutterCaptureExposureSchedule(schedule),
  nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 },
  samplePointsNative: [{ x: 3000, y: 0.5 }, { x: 3000, y: 3999.5 }]
}).value;
// Top and bottom lines open about 16 ms apart: a subject moving 2000 px/s is sheared by ~32 px.
console.log(windows.samples.map((window) => window.startOffsetSecondsFromOpeningReference));

const clip = resolveVideoFrameSequence({
  sequenceId: "clip-1",
  opticalState: { bodyId: "generic-body", bodyVersion: "1", lensId: "generic-50", lensVersion: "1", focalLengthMm: 50,
    aperture: 4, focusDistanceM: 5, captureMode: "video", outputWidth: 1920, outputHeight: 1080, frameRateHz: 24,
    stabilizationMode: "off" },
  shutterAngleDegrees: 180,
  frameCount: 3,
  sequenceSeedUint32: 7,
  iso: 400,
  automation: { ae: "locked", af: "manual", awb: "locked" },
  timingEvidence: evidence,
  rollingShutter: { readout, linkageEvidence: evidence }
});
console.log(clip.exposureSeconds, clip.frames.map((frame) => [frame.exposureStartTimeSeconds, frame.stochasticSeedUint32]));
console.log(assessShutterAngleRule(24, 172.8).classification);
```

Highlight-priority metering places a highlight percentile below saturation. TTL (through-the-lens) flash metering
works out the main-flash power from a pre-flash, measured with the same linear meter. The result feeds the ordinary
front/rear-curtain sync:

```ts
import {
  calculateFlashPowerForDistance,
  calculateHighlightPriorityPlacementSignal,
  meterRelativeExposure,
  parseExposureMeteringProfile,
  resolveCaptureGeometry,
  resolveTtlFlashExposure,
  type ExposureMeteringSampleSet
} from "@photivra/engine";

const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "example:flash-meter", reuseStatus: "photivra-owned" as const }];
const zones = (signals: readonly number[]): ExposureMeteringSampleSet => ({
  measurementId: "meter", sceneStateId: "scene", inputDomain: "relative-pre-exposure-linear-signal",
  captureRegion: "oriented-active-capture",
  captureGeometry: resolveCaptureGeometry({ imagingArea: { widthMm: 36, heightMm: 24 },
    nativeRaster: { pixelWidth: 6000, pixelHeight: 4000 }, orientation: "landscape" }).value,
  processingState: { exposureSettingsApplied: false, whiteBalanceApplied: false, toneMappingApplied: false,
    displayGammaApplied: false, sharpeningApplied: false },
  samples: signals.map((relativeLinearSignal, index) => ({ sampleId: "zone-" + index,
    positionOrientedCaptureUv: { u: (index % 5 + 0.5) / 5, v: (Math.floor(index / 5) + 0.5) / 4 },
    relativeLinearSignal, areaWeight: 1 }))
});
const meter = (policy: Parameters<typeof parseExposureMeteringProfile>[0], target: number) => parseExposureMeteringProfile({
  schemaVersion: "0.1.0", profileId: "meter", scientificStatus: "approximation",
  inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", policy,
  target: { kind: "relative-signal-reference", targetRelativeSignal: target, evidence }, evidence,
  limitations: ["Generic relative meter."]
});

// 95 % mid-grey, 5 % bright: place the 99th percentile half a stop below saturation.
const scene = zones([...Array.from({ length: 19 }, () => 0.18), 0.9]);
const placement = calculateHighlightPriorityPlacementSignal(1, 0.5);
const highlight = meterRelativeExposure({
  profile: meter({ kind: "highlight-priority", highlightPercentile: 0.99, saturationRelativeSignal: 1, headroomStops: 0.5 }, placement),
  sampleSet: scene
}).value;
console.log(highlight.highlightPriority?.percentileRelativeSignal, highlight.status === "resolved" && highlight.requiredExposureScaleToTarget);

// Manual guide-number exposure: GN 40 m at ISO 100, subject 5 m at f/4 → quarter power.
console.log(calculateFlashPowerForDistance({ fullPowerGuideNumberMetersIso100: 40, subjectDistanceM: 5,
  apertureFNumber: 4, iso: 100, minimumPowerFraction: 1 / 128 }).powerFraction);

// TTL: ambient and 1/32-power pre-flash readings of the same zones.
const ttl = resolveTtlFlashExposure({
  meteringProfile: meter({ kind: "multi-zone-uniform" }, 0.18),
  ambientSampleSet: zones([0.02, 0.02, 0.04, 0.04]),
  preFlashSampleSet: zones([0.12, 0.12, 0.06, 0.06]),
  preFlashPowerFraction: 1 / 32,
  ambientScaleToMainExposure: 0.5,
  flashExposureCompensationStops: 0,
  minimumPowerFraction: 1 / 128,
  guideNumber: { fullPowerGuideNumberMetersIso100: 40, iso: 100, apertureFNumber: 4 }
}).value;
console.log(ttl.status, ttl.powerFraction, ttl.flashRangeAtApertureM);
// Apply with createTtlScaledFlashProfile(flashProfile, ttl) and place it with resolveManualFlashSync() as before.
```

High-speed sync (HSS) needs a schema 0.2.0 sync-capability profile that declares HSS and its burst energy fraction.

- `resolveHighSpeedFlashSync()` returns the burst support, the energy fraction per line `η·t_e/D`, and the
  guide-number factor `√(η·t_e/D)`.
- `createHighSpeedSyncIlluminationOverlay()` registers the burst as a temporal illumination source. Every line
  integrates it over its own window.
- To solve TTL power for HSS, pass `syncEnergyFactor = energyFractionOfSinglePulseRange.minimum` to
  `resolveTtlFlashExposure()`.

## Lens projections, aberrations, polarizer and haze (2.0)

The models below are standalone primitives. See [Physics foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md#non-rectilinear-lens-projections-20) and [PSF foundation](https://github.com/Photivra/photivra/blob/main/docs/PSF_FOUNDATION.md#zernike-and-seidel-wavefronts-20) for equations, sources and limits.

### Fisheye and equirectangular projections

```ts
import {
  calculateFieldOfView,
  calculateLensProjectionDirection,
  calculateLensProjectionImagePoint
} from "@photivra/engine";

// 8 mm equidistant fisheye across a 24 mm sensor: 2 * (12 / 8) rad = 171.9 degrees.
const fisheye = calculateFieldOfView({
  focalLengthMm: 8,
  sensorDimensionMm: 24,
  projectionModel: "fisheye-equidistant"
});
console.log(fisheye.value.degrees, fisheye.provenance.model);

// Omitting projectionModel keeps the rectilinear result unchanged.
console.log(calculateFieldOfView({ focalLengthMm: 50, sensorDimensionMm: 36 }).value.degrees);

const point = calculateLensProjectionImagePoint({
  projectionModel: "fisheye-stereographic",
  focalLengthMm: 8,
  direction: { x: 1, y: 0.2, z: -0.1 } // slightly behind the lens: still mapped
});
const back = calculateLensProjectionDirection({
  projectionModel: "fisheye-stereographic",
  focalLengthMm: 8,
  imagePointMm: point.value.imagePointMm
});
console.log(point.value.imagePointMm, back.value.direction);
```

### Brown–Conrady distortion

```ts
import {
  calculateBrownConradyDistortionMapping,
  calculateInverseBrownConradyDistortionMapping,
  type BrownConradyDistortionProfile
} from "@photivra/engine";

const profile: BrownConradyDistortionProfile = {
  normalizationRadiusMm: 21.6,
  maximumNormalizedRadius: 1,
  coefficients: { k1: -0.08, k2: 0.01, k3: 0, p1: 0.002, p2: -0.0015 }
};
const distorted = calculateBrownConradyDistortionMapping({ imagePointMm: { x: 10, y: -6 }, profile });
const ideal = calculateInverseBrownConradyDistortionMapping({
  distortedImagePointMm: distorted.value.mappedImagePointMm,
  profile
});
console.log(distorted.value.mappedImagePointMm, ideal.value.sourceImagePointMm);
```

### Zernike wavefront PSF, longitudinal CA and cat's-eye vignetting

```ts
import {
  calculateLensComplexPupilPsf,
  calculateLongitudinalChromaticFocus,
  calculateMechanicalVignetting,
  calculateNaturalVignetting,
  calculatePolygonPupilFraunhoferPsf,
  createWavefrontPupilGrid,
  estimateMarechalStrehlRatio,
  parseLensComplexPupilProfile
} from "@photivra/engine";

// Per-wavelength defocus of an achromat-like secondary spectrum at f/4.
const blue = calculateLongitudinalChromaticFocus({
  focalLengthMm: 50,
  referenceWavelengthNm: 550,
  wavelengthNm: 460,
  apertureFNumber: 4,
  focusDistanceM: 3,
  dispersion: {
    kind: "declared-focal-shift",
    samples: [
      { wavelengthNm: 450, focalLengthShiftMicrometers: 20 },
      { wavelengthNm: 550, focalLengthShiftMicrometers: 0 },
      { wavelengthNm: 650, focalLengthShiftMicrometers: 15 }
    ]
  }
}).value;

// Defocus (Z4) plus a little spherical aberration (Z11) on a 12.5 mm pupil.
const wavefront = createWavefrontPupilGrid({
  pupilDiameterMm: 12.5,
  samplesAcross: 31,
  zernikeCoefficients: [
    { nollIndex: 4, coefficientMicrometers: blue.zernikeZ4Micrometers },
    { nollIndex: 11, coefficientMicrometers: 0.02 }
  ]
}).value;
console.log(estimateMarechalStrehlRatio({
  rmsWavefrontErrorMicrometers: wavefront.sampledRmsMicrometers,
  wavelengthNm: 460
}).value.strehlRatio);

const psf = calculateLensComplexPupilPsf({
  profile: parseLensComplexPupilProfile({
    schemaVersion: "0.1.0",
    profileId: "example-wavefront",
    profileVersion: "1.0.0",
    scientificStatus: "approximation",
    opticalDomain: "lens-primary-optical-path-only",
    representation: "complex-pupil-amplitude-plus-opd",
    pupilCoordinateSystem: "pupil-plane-metric-aligned-to-image-plane",
    imageFieldAxes: "+X right, +Y up",
    amplitudeMeaning: "relative-complex-pupil-amplitude-shape",
    wavefrontMeaning: "optical-path-difference-micrometers",
    throughputOwnership: "separate-relative-pupil-throughput-factor",
    kernelEnergyNormalization: "unit-energy-shape",
    propagationModel: "scalar-fraunhofer-discrete-reference",
    context: {
      focalLengthMm: 50,
      focus: { kind: "finite", distanceM: 3 },
      apertureFNumber: 4,
      fieldPointMm: { x: 0, y: 0 },
      wavelengthNm: 460,
      signedDefocusImagePlaneMicrometers: blue.signedDefocusImagePlaneMicrometers
    },
    responseIncludes: { diffraction: true, aberration: true, defocus: true, pupilClippingShape: false },
    relativePupilThroughputFactor: 1,
    grid: wavefront.grid,
    sensorOpticalStackIncluded: false,
    sensorSamplingIncluded: false,
    reconstructionIncluded: false,
    strayLightIncluded: false,
    evidence: [{ sourceOrigin: "photivra", sourceReference: "usage-example", reuseStatus: "photivra-owned" }],
    uncertainty: { kind: "not-quantified", limitation: "Synthetic example wavefront." },
    limitations: ["Synthetic example."]
  })
});
console.log(psf.value.kernel.widthSamples);

// Natural cos^4 falloff and a cat's-eye pupil 20 degrees off axis.
console.log(calculateNaturalVignetting({
  model: "cosine-fourth",
  imagePointMm: { x: 15, y: 10 },
  exitPupilDistanceMm: 60
}).value.relativeIllumination);
const catsEye = calculateMechanicalVignetting({
  entrancePupilDiameterMm: 12.5,
  fieldAngleDegrees: 20,
  fieldAzimuthDegrees: 30,
  apertures: [{ radiusMm: 7, shiftPerTanFieldMm: 30 }]
}).value;
const bokehPsf = calculatePolygonPupilFraunhoferPsf({
  pupilVerticesMm: catsEye.openPupilPolygonMm,
  pupilToImageDistanceMm: 50,
  wavelengthNm: 550,
  wavelengthBasis: "air",
  imagePointsMicrometers: [{ x: 0, y: 0 }, { x: 2, y: 0 }]
});
console.log(catsEye.openAreaRatio, bokehPsf.value.samples[1]?.peakNormalizedIntensity);
```

### Polarizer and haze

```ts
import {
  calculateAtmosphericHaze,
  calculateExtinctionFromVisibility,
  calculateGeometricFocusBreathing,
  composeFrontOfLensFilterTransmission,
  parseFrontOfLensFilterProfile
} from "@photivra/engine";

const polarizer = parseFrontOfLensFilterProfile({
  schemaVersion: "0.2.0",
  filterId: "generic-linear-polarizer",
  profileVersion: "1.0.0",
  identityScope: "photivra-generic-unbranded",
  position: "front-of-lens",
  scientificStatus: "approximation",
  wavelengthBasis: "air",
  wavelengthRangeNanometers: { minimum: 400, maximum: 700 },
  transmission: {
    kind: "linear-polarizer",
    principalTransmittance: { value: 0.8, evidence: [{ sourceOrigin: "photivra", sourceReference: "usage-polarizer", reuseStatus: "photivra-owned" }] },
    extinctionRatio: { value: 1000, evidence: [{ sourceOrigin: "photivra", sourceReference: "usage-polarizer", reuseStatus: "photivra-owned" }] },
    transmissionAxisDegrees: 90
  },
  uncertainty: { kind: "not-quantified", limitation: "Generic educational polarizer." },
  polarizationModeled: true,
  wavelengthChangingBehaviorModeled: false,
  evidence: [{ sourceOrigin: "photivra", sourceReference: "usage-polarizer", reuseStatus: "photivra-owned" }],
  limitations: ["Generic example."]
});
// Glare partially polarized horizontally (P = 0.6) is suppressed by a vertical axis.
const filtered = composeFrontOfLensFilterTransmission({
  filters: [polarizer],
  wavelengthNanometers: 550,
  wavelengthBasis: "air",
  incidentPolarization: { degreeOfLinearPolarization: 0.6, angleDegrees: 0 }
});
console.log(filtered.combinedLinearTransmissionFactor, filtered.transmittedPolarization);

const beta = calculateExtinctionFromVisibility({ visibilityM: 15_000 }).value.extinctionPerMeter;
const hazy = calculateAtmosphericHaze({
  pathLengthM: 4000,
  wavelengthNm: 450,
  sceneRadiance: 0.02,
  airlightRadiance: 0.08,
  extinction: {
    referenceWavelengthNm: 550,
    rayleighExtinctionPerMeter: 0,
    aerosolExtinctionPerMeter: beta,
    angstromExponent: 1.3
  }
});
console.log(hazy.value.hazedRadiance, hazy.value.transmittance);

// Unit-focus breathing of a 100 mm lens focused at 0.6 m (subject to sensor).
console.log(calculateGeometricFocusBreathing({
  focalLengthMm: 100,
  subjectToSensorDistanceM: 0.6,
  sensorDimensionMm: 36,
  focusingMethod: "unit-focus"
}).value.deltaDegrees);
```

## Parallel native environment RAW (row-band partitions, 2.0)

`createNativeEnvironmentRawTask` runs on one thread. For several cores, split the capture into row bands with
`calculateNativeRawRowBands`, run each band with `createNativeEnvironmentRawPartitionTask` (one per Web Worker or Node
worker thread, each with its own provider), post the partitions back, and join them with
`composeNativeEnvironmentRawPartitions`. The merged output is byte-identical to the single task's for the same input
and a deterministic provider. The package ships no worker code; the caller owns the workers. See
[parallel execution](https://github.com/Photivra/photivra/blob/main/docs/NATIVE_RAW_AND_PRINT.md#opt-in-parallel-execution-row-band-partitions-20) for the checks and limits.

A provider can also add `evaluateRadianceBatch(queries, signal)`: one call per tile with every query in per-query
order, returning the results in the same order (or a promise of them). The output is identical to per-query
callbacks with the same results; see
[batched light sampling](https://github.com/Photivra/photivra/blob/main/docs/NATIVE_RAW_AND_PRINT.md#batched-light-sampling-evaluateradiancebatch-20).

```ts
import { createNativeEnvironmentRawPartitionTask, composeNativeEnvironmentRawPartitions, calculateNativeRawRowBands, simulateCapture,
  type NativeEnvironmentRawProvider } from "@photivra/engine";

const capture = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 8 } });
const input = capture.request.environmentRaw, width = capture.plan.exposure.geometry.nativeRaster.pixelWidth;
// Each worker builds its own provider (functions cannot be posted). Here: a constant radiance.
const provider: NativeEnvironmentRawProvider = {
  readTile: async (r) => ({ ...r, sites: Array.from({ length: r.width }, (_, j) => capture.request.siteInput(r.y * width + r.x + j)) }),
  evaluateRadiance: (q) => ({ schemaVersion: "0.1.0", sampleId: q.sampleId, sceneId: q.sceneId, providerProfileId: q.providerProfileId,
    wavelengthNanometers: q.wavelengthNanometers, wavelengthBasis: q.wavelengthBasis, quantity: "outgoing-spectral-radiance", unit: "W/m^2/sr/nm",
    spectralRadianceWattsPerSquareMeterSteradianNanometer: 0.01, scientificStatus: "approximation",
    uncertainty: { kind: "not-quantified", limitation: "Example field." },
    evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:usage-example", reuseStatus: "photivra-owned" }], limitations: ["Example field."] }),
  yieldControl: async () => {}
};
const partitions = await Promise.all(calculateNativeRawRowBands(capture.plan, 2).map(async (band) => {
  const task = createNativeEnvironmentRawPartitionTask(input, band, provider); // inside a worker
  await task.run();
  return task.takeOutput(); // postMessage(partition, [partition.codes.buffer, ...])
}));
const merged = composeNativeEnvironmentRawPartitions(input, partitions);
console.log(merged.raw.codes.length, merged.providerEvaluationCount);
```

## Optional WebGPU image kernels

`createImageKernelAccelerator()` runs six heavy image operations: isoplanatic PSF convolution (one PSF per image patch), the temporal exposure sum, the sensor stage, native capture SDR, packed RAW development, and chart radiance.

- By default they run on the float64 CPU reference.
- If you opt in, they run on the `webgpu-f32` backend (WebGPU, 32-bit floats).
- Every result's `execution` label names the backend that actually ran, any reason for falling back, and the error bound against the reference, stated in advance.
- One boolean chooses: `{ webgpu: true }` asks for the GPU and runs the reference if it is missing; `{ webgpu: false }` is the reference. `setWebGpuEnabled(false)` turns the GPU off for the whole realm, whatever callers ask, and labels those results `webgpu-disabled`.

See [WebGPU backend](https://github.com/Photivra/photivra/blob/main/docs/WEBGPU.md) for the bounds, the supported domain and the browser test.

```ts
import { createImageKernelAccelerator, calculateIrradianceConvolution, getWebGpuEnabled, setWebGpuEnabled } from "@photivra/engine";

const width = 16, height = 8, kernelRadius = 1;
const input = { schemaVersion: "0.1.0" as const, width, height, kernelRadius, patchWidth: width, patchHeight: height,
  boundary: "zero-outside-grid" as const, samples: new Float64Array(width * height).fill(2),
  kernels: Float64Array.from([0, .1, 0, .1, .6, .1, 0, .1, 0]) };

const accelerator = await createImageKernelAccelerator({ webgpu: true }); // the same as { backend: "webgpu-f32", fallback: "cpu-reference" }
const result = await accelerator.convolveIrradiance(input);
// Without WebGPU (e.g. Node) this ran the reference and says so.
console.log(result.execution.backend, result.execution.fallbackReason, result.execution.bitIdenticalToReference);
// Bit-exact identities and fixtures must come from the CPU reference.
const reference = calculateIrradianceConvolution(input).values;
console.log(result.execution.backend === "cpu-reference" ? result.values.every((v, i) => v === reference[i]) : result.execution.errorBound);
accelerator.dispose();

// The realm's switch: off, every request for the GPU runs the reference and says why.
setWebGpuEnabled(false);
const cpuOnly = await createImageKernelAccelerator({ webgpu: true });
console.log(cpuOnly.backend, cpuOnly.fallbackReason, getWebGpuEnabled()); // "cpu-reference" "webgpu-disabled" false
cpuOnly.dispose();
setWebGpuEnabled(true);
```

Two image-formation stages use the same accelerator:

- `sumTemporalExposure()` is exposure and motion as a weighted sum of shifted frames, with per-row weights for rolling or global readout.
- `simulateSensorRaw()` is the sensor stage: seeded Poisson charge, read noise and ADC to RAW codes. It uses the same noise model and per-site seeds as the per-site producer.

On `webgpu-f32`, every sensor site not listed in `flaggedSiteIndices` equals the reference exactly. Recompute the listed sites with the reference if you need bit identity.

```ts
import { createImageKernelAccelerator, simulatePackedSensorRaw, type PackedSensorRawInput, type TemporalExposureSumInput } from "@photivra/engine";

const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "example", reuseStatus: "photivra-owned" as const }];
const width = 8, height = 4;
// Static scene, global shutter: three temporal nodes of 1/3000 s each, the image moving 0.5 site to the right per node.
const motion: TemporalExposureSumInput = { schemaVersion: "0.1.0", width, height, boundary: "zero-outside-grid",
  samples: new Float64Array(width * height).fill(9e6), // electrons per second
  displacements: Float64Array.from([0, 0, 0.5, 0, 1, 0]), rowWeights: new Float64Array(3 * height).fill(1 / 3000) };
const sensor = (photoElectrons: Float64Array): PackedSensorRawInput => ({ schemaVersion: "0.1.0", nativeWidth: width, nativeHeight: height,
  region: { x: 0, y: 0, width, height }, captureSeedUint32: 42, photoElectrons, darkElectrons: new Float64Array(width * height),
  physicalChargeCapacityElectrons: 30_000, regimeId: "base", readoutProfile: { schemaVersion: "0.1.0", profileId: "readout", colorSamplingProfileId: "cfa",
    channelId: "green", regimeSelectionOwnedBy: "explicit-upstream-camera-state-not-inferred-from-iso", evidence, regimes: [{ regimeId: "base",
      scientificStatus: "approximation", systemConversionGainElectronsPerCode: { value: 2, evidence },
      preAdcSaturationElectronEquivalent: { value: 32_000, evidence }, readNoiseComponents: [{ componentId: "read", rmsElectrons: { value: 2.5, evidence }, evidence }],
      adc: { bitDepth: 14, blackLevelCode: 512, digitalSaturationCode: 16_383, transfer: "uniform-round-half-up" }, evidence, limitations: ["Example regime."] }] } });

const accelerator = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "cpu-reference" });
const exposure = await accelerator.sumTemporalExposure(motion);
const raw = await accelerator.simulateSensorRaw(sensor(Float64Array.from(exposure.values)));
console.log(exposure.execution.errorBound, raw.execution.errorBound, raw.flaggedSiteIndices.length);
// The CPU reference gives the same codes at every unflagged site.
const reference = simulatePackedSensorRaw(sensor(Float64Array.from(exposure.values))).codes;
console.log(raw.execution.backend === "cpu-reference" ? raw.codes.every((c, i) => c === reference[i]) : raw.diagnostics);
accelerator.dispose();
```
## Image processing operators

These are standalone operators that can be cancelled: demosaicing, HDR merge and encoding, tone mapping, exposure fusion, focus stacking, panorama stitching from known rotations, denoising, sharpening and synthetic grain.

- All results are labelled approximations. See [Image processing operators](https://github.com/Photivra/photivra/blob/main/docs/PROCESSING.md) for equations, sources, measured PSNR and limits.
- Every factory takes `(input, { yieldControl, onProgress? })` and returns a task that can run once.

```ts
import {
  createBuiltInBayerDemosaicProfiles,
  createCfaPlaneReconstructionTask,
  createAhdDemosaicTask,
  type SensorColorSamplingProfile
} from "@photivra/engine";

const provider = { yieldControl: async () => {} };
const cfa: SensorColorSamplingProfile = {
  schemaVersion: "0.1.0", profileId: "rggb", coordinateSystem: "native-sensor-color-sampling-site-index",
  evidence: [{ sourceOrigin: "photivra", sourceReference: "example", reuseStatus: "photivra-owned" }],
  layout: { kind: "periodic-mosaic", repeatWidthSites: 2, repeatHeightSites: 2,
    siteChannelIds: ["red", "green", "green", "blue"], anchor: "native-sensor-top-left-site" }
};
const plane = { width: 64, height: 48, captureModeId: "native", colorSamplingProfile: cfa,
  samples: new Float32Array(64 * 48).fill(0.25) };
const channelRoles = { red: "red", green: "green", blue: "blue" };

// Bilinear linear kernels with mirror borders (also accepted by createNativeRawDevelopmentTask).
const bilinear = createBuiltInBayerDemosaicProfiles({ kernel: "bilinear", captureModeId: "native",
  colorSamplingProfile: cfa, channelRoles }).value;
const linearTask = createCfaPlaneReconstructionTask({ plane, phaseProfiles: bilinear.phaseProfiles, borderHandling: "mirror" }, provider);
await linearTask.run();
console.log(linearTask.takeOutput().channelIds);

// Adaptive homogeneity-directed (non-linear) demosaic.
const ahd = createAhdDemosaicTask({ plane, channelRoles }, provider);
await ahd.run();
console.log(ahd.takeOutput().direction.length);
```

Merge linear RAW brackets with noise-optimal weights, convert to linear BT.2020 and tone map:

```ts
import {
  createHdrBracketMergeTask,
  createHdrImageEncodingTask,
  createReinhardGlobalToneMappingTask
} from "@photivra/engine";

const provider = { yieldControl: async () => {} };
const n = 32 * 32 * 3;
const frame = (seconds: number) => ({ exposureTimeSeconds: seconds, codes: new Uint16Array(n).fill(64 + Math.round(2000 * seconds)),
  blackLevelCode: 64, whiteLevelCode: 4000, conversionGainElectronsPerCode: 1.5, readNoiseElectrons: 3 });
const merge = createHdrBracketMergeTask({ sampleCount: n, frames: [frame(1), frame(1 / 8), frame(1 / 64)] }, provider);
await merge.run();
const merged = merge.takeOutput();
const radiance = { width: 32, height: 32, data: merged.radianceElectronsPerSecond.map((v) => v / 3000) };

const rec2020 = createHdrImageEncodingTask({ image: radiance, inputColorSpace: "linear-srgb-d65", transfer: "linear-float32" }, provider);
await rec2020.run();
console.log(rec2020.takeOutput().linear.slice(0, 3));

const sdr = createReinhardGlobalToneMappingTask({ image: radiance, inputColorSpace: "linear-srgb-d65", key: 0.18 }, provider);
await sdr.run();
console.log(sdr.takeOutput().logAverageLuminance);
```

`createDurandDorseyToneMappingTask`, `createExposureFusionTask`, `createFocusStackTask`, `createBilateralFilterTask`, `createNonLocalMeansTask`, `createUnsharpMaskTask` and `createSyntheticFilmGrainTask` work the same way. Panorama stitching uses each frame's known rotation, in the engine's pitch/yaw/roll convention:

```ts
import { createPanoramaTask } from "@photivra/engine";

const image = { width: 48, height: 36, data: new Float32Array(48 * 36 * 3).fill(0.5) };
const panorama = createPanoramaTask({
  frames: [-0.5, 0, 0.5].map((yaw) => ({ image, focalLengthPixels: 40, rotationRad: { pitch: 0, yaw, roll: 0 } })),
  canvas: { projection: "equirectangular", width: 160, height: 48, longitudeRangeRad: [-1.1, 1.1], latitudeRangeRad: [-0.4, 0.4] },
  blending: "multi-band", exposureCompensation: "gain"
}, { yieldControl: async () => {} });
await panorama.run();
console.log(panorama.takeOutput().gains);
```
### Fisheye-to-rectilinear and Brown–Conrady geometric mappings

```ts
import {
  calculateComposedGeometricMapping,
  calculateForwardGeometricMapping,
  prepareGeometricMapping
} from "@photivra/engine";

// Destination-to-source: a rectilinear 10 mm view sampled from an 8 mm equidistant fisheye capture,
// after a Brown–Conrady correction of the fisheye's residual distortion.
const mapping = prepareGeometricMapping({
  frameTimeSeconds: 0,
  transforms: [
    {
      id: "fisheye-to-rectilinear", version: "1", domain: "reconstructed-linear", purpose: "projection",
      kind: "projection-remap",
      destinationProjection: { projectionModel: "rectilinear", focalLengthMm: 10 },
      sourceProjection: { projectionModel: "fisheye-equidistant", focalLengthMm: 8 }
    },
    {
      id: "residual-distortion", version: "1", domain: "reconstructed-linear", purpose: "distortion",
      kind: "brown-conrady",
      profile: { normalizationRadiusMm: 12, maximumNormalizedRadius: 1,
        coefficients: { k1: -0.02, k2: 0, k3: 0, p1: 0.001, p2: 0 } }
    }
  ]
}).value;
const point = calculateComposedGeometricMapping({ mapping, destinationPointMm: { x: 4, y: -2 } }).value;
console.log(mapping.schemaVersion, point.sourcePointMm, point.determinant);
console.log(calculateForwardGeometricMapping({ mapping, sourcePointMm: point.sourcePointMm }).value);
```
## Simulate a capture with the facade

`simulateCapture()` is a facade: one simple call that combines the generic tier presets, scene metering,
the exposure-mode resolver, the native environment RAW task, native RAW development and, optionally, the
print JPEG encoder. It returns the image, the packed RAW, the complete request and plan it ran, provenance,
and an `assumptions` list naming every default and modelling choice. See the [Quick Start](QUICK_START.md)
for every option, the chart catalogue and the limits.

```ts
import { simulateCapture } from "@photivra/engine";

const star = await simulateCapture({
  camera: "prosumer",
  exposure: { mode: "aperture-priority", iso: 200 },
  lens: { fNumber: 5.6 },
  scene: { preset: "siemens-star", cycles: 24 },
  illuminant: { kind: "planckian", temperatureKelvin: 5000 },
  illuminanceLux: 8000,
  output: { width: 12, height: 8, toneCurve: "positive-reinhard-per-channel", whiteBalance: { kelvin: 5000 } }
});

console.log(star.exposure.settings.shutterSeconds, star.exposure.ev100, star.exposure.standardExposureDeviationStops);
console.log(star.assumptions.filter((a) => a.kind === "default").map((a) => a.id));
console.log(star.request.siteInput(0).environment.optics.nominalFNumber);
```

### Color charts (2.14)

The engine's own [color patches](https://github.com/Photivra/photivra/blob/main/docs/COLOR_PATCHES.md) are reflectance spectra lit by the capture's illuminant. Draw the
whole set with the `color-patches` preset, or use one patch wherever a chart takes a reflectance spectrum, as
`{ kind: "color-patch", patchId }`. `getColorPatchSet()` gives each patch's code, name, reason for being on the chart and reference CIELAB and sRGB
under D65.

```ts
import { getColorPatchSet, simulateCapture } from "@photivra/engine";

const tungsten = await simulateCapture({
  scene: { preset: "color-patches", patchIds: ["neutral-4", "red", "skin-medium", "sky-blue"], columns: 4 },
  illuminant: "cie-a",
  sensor: { spectralStepNanometers: 5 },
  output: { width: 64, height: 16 }
});
const sky = getColorPatchSet().patches.find((p) => p.patchId === "sky-blue");
console.log(tungsten.scene.parameters.patchSet, sky?.code, sky?.name, sky?.reference.cielabD65); // "PV-M1", "Midday Sky"
```

In `aperture-priority` mode, the shutter comes from the meter (CIPA DC-004 relations S = 10/H and H = 0.65·L·t/N²) through
`resolveAperturePriorityExposureMode()`.
`exposure.standardExposureDeviationStops` is the exposure used minus the standard exposure for the metered luminance L, in stops,
log₂(N²/t) − log₂(0.65·L·S/10) from the same relations: positive is darker (under), negative brighter (over). In an automatic
mode it is minus the compensation plus any limit the resolver hit; it is `null` only for a scene with no metered luminance.
`exposure.standardExposureIlluminanceLux` is the illuminance at which those settings give the standard exposure, E·2^Δ for the
request's illuminance E (a reflective scene's metered luminance is proportional to E); `null` for a black scene or a
`radiance-function` scene. `exposure.greyCardDeviationStops` (2.14) is the deviation from the standard exposure of an 18 % grey
card under that illuminance, log₂(L_ref/(0.18·E/π)): incident metering, independent of the scene's reflectances, exactly 0 at
the defaults. The automatic modes meter the scene by default; `exposure.metering: "grey-card"` makes them (and Auto ISO) meter
that grey card instead, so they land on a grey-card deviation of 0. The display view's `exposure` carries the same values.

```ts
import { simulateCapture } from "@photivra/engine";

const chart = await simulateCapture({
  scene: { preset: "uniform", reflectance: 0.9 },
  exposure: { mode: "aperture-priority", metering: "grey-card" },
  output: { width: 8, height: 8 }
});
console.log(chart.exposure.metering, chart.exposure.settings.shutterSeconds, chart.exposure.greyCardDeviationStops);
```

With `exposure.iso: "auto"` (#516) the ISO is chosen too, in every mode, by the resolvers' Auto ISO branches
([Priority modes with Auto ISO](#priority-modes-with-auto-iso)). Aperture priority then needs the slowest shutter
before the ISO rises, and takes the policy at the maximum ISO; the result reports the ISO, that it was automatic and
what limited it. `exposure.autoIso.limits: { maximum, minimum? }` (#505) sets the photographer's Auto ISO range in any
mode ([photographer-set limits](#photographer-set-auto-iso-limits-505)). `slowestPreferredShutterSeconds: "auto"` (#504)
derives the slowest shutter from the camera-shake model, in aperture priority and, optionally, program
([automatic slowest shutter](#automatic-slowest-shutter-504)). See [Auto ISO](QUICK_START.md#auto-iso-516).

```ts
import { prepareDisplayView, simulateCapture, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = {
  exposure: { mode: "aperture-priority", iso: "auto", autoIso: { slowestPreferredShutterSeconds: 1 / 125 } },
  lens: { fNumber: 4 },
  scene: { preset: "siemens-star" },
  illuminanceLux: 50,
  output: { width: 16, height: 12 }
};
const capture = await simulateCapture(request);
const { settings, isoControl, autoIso } = capture.exposure;
// For example "ISO 3200 · Auto", and why: "iso-grid-quantization", or "iso-maximum" with the shutter held.
console.log(`ISO ${settings.iso} · ${isoControl === "automatic" ? "Auto" : ""}`, autoIso?.limitingConstraint, autoIso?.afterMaximumIsoFallbackUsed);
// The display view of the same request resolves the same exposure.
const view = await (await prepareDisplayView(request)).render({ width: 8, height: 6 });
console.log(view.exposure.settings.iso === settings.iso);
```

The chart presets are also available on their own:

- `resolveChartScene()` gives the analytic reflectance at any point in the frame.
- `createPlanarSceneRadianceProvider()` turns a chart into an `evaluateRadiance` callback for the native
  environment RAW contract.

### Display view of a capture

`simulateDisplayView(options, view)` takes a capture request and a display size and returns the real
full-resolution capture resized to that size (area average in linear light), estimated at a cost that follows the
display pixels. It is a preview (`kind: "display-view"`), never a capture; see [Display view](QUICK_START.md#display-view)
and the design and validation in [DISPLAY_VIEW.md](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md).

```ts
import { simulateDisplayView } from "@photivra/engine";

const view = await simulateDisplayView({ scene: { preset: "slanted-edge" }, sensor: { pixelPitchMicrometers: 3 }, output: { width: 600, height: 400 } },
  { width: 60, height: 40 });
console.log(view.kind, view.view.scaleX, view.assumptions.find((a) => a.id === "view.definition")?.value);
// #533: the real capture's clipped-highlight pixels in the rendered region, as the expected value of simulateCapture's count.
console.log(view.diagnostics.highlight.saturatedPixelCount, view.diagnostics.highlight.statistic); // a real number, "expected-value"
```

`diagnostics.highlight.saturatedPixelCount` is the expected number of the real capture's output pixels in the rendered
region that have a clipped contributing site. `simulateCapture` counts the same pixels on its one noise sample, so the two
are equal where every site is far from white. Counts of regions that tile a view add up to the whole view's count. See
[Highlight count](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#highlight-count-533).

#### Rendering a prepared view on the GPU (2.11, #481)

`prepareDisplayView(request, { gpu })` chooses the renderer: `"off"` (the default) is the CPU reference, `"auto"` the GPU
when a conforming device is available and the request is supported (else the CPU, labelled), `"require"` fails instead of
falling back. `gpuDevice` hands the view a worker's `navigator.gpu` or an `ImageKernelAccelerator` whose device it shares.
Every render says which path ran in `diagnostics.fast.execution`, in the accelerator's words. The engine's renderer runs the
Speed (#478) and Quality (#479) kernels on a conforming device for the requests it covers. Elsewhere `"auto"` runs the CPU
reference and gives the reason (in Node without a WebGPU entry point, for example); see
[Rendering on the GPU](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#rendering-on-the-gpu).

```ts
import { prepareDisplayView, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, sensor: { pixelPitchMicrometers: 4 }, output: { width: 600, height: 400 } };
const prepared = await prepareDisplayView(request, { gpu: "auto" }); // acquisition failures fall back; with "require" they throw here
const tile = await prepared.render({ width: 300, height: 200, region: { x: 120, y: 80, width: 32, height: 32 } });
const ran = tile.diagnostics.fast.execution;
// "cpu-reference" when the reference ran (and why), "webgpu-f32" with its bound and adapter when the GPU did.
console.log(ran.backend, ran.fallbackReason, ran.assurance, ran.errorBound, ran.adapter, tile.diagnostics.fast.assurance);
prepared.dispose(); // releases a device the view acquired; a shared accelerator's device stays its owner's
```

The GPU code (the session, the renderers and their WGSL, about 52 kB gzip) is imported only when `gpu` is `"auto"` or
`"require"`, so a bundler that splits dynamic imports leaves it out of a page's first load. A build that cannot split inlines
it: Vite builds workers as `iife` by default, so a worker that calls `prepareDisplayView` carries it; build workers as ES
modules (`worker: { format: "es" }`, with `new Worker(url, { type: "module" })`) to keep it out. Measured sizes:
[Bundle size](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#bundle-size).

#### Sharing AHD correction states between workers

With `output.demosaic: "ahd"`, low-signal display pixels read correction states that each realm (a page, a Web Worker)
computes and keeps for itself. Two workers can split a part's states and exchange them instead of both computing all
of them; the renders have the same bytes either way (see "AHD at low signal" in
[DISPLAY_VIEW.md](https://github.com/Photivra/photivra/blob/main/docs/DISPLAY_VIEW.md#ahd-at-low-signal)). Import only
states whose key a prepared view reported. The two handles below run in one script for the example; in an app each
runs in its own worker, and the arrays travel with `postMessage(set, [set.gridKeys.buffer, set.values.buffer])`.

```ts
import { serializeDisplayViewCorrectionStates, bindDisplayViewCorrectionStates, prepareDisplayView, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "uniform", reflectance: 0.18 }, exposure: { iso: 1600, shutterSeconds: 1 / 2000 },
  sensor: { pixelPitchMicrometers: 1.4 }, output: { width: 200, height: 150, demosaic: "ahd" } };
const part = { width: 20, height: 15, region: { x: 0, y: 0, width: 10, height: 8 } };
// Each worker prepares the same request; the key says which states it reads.
const workerA = await prepareDisplayView(request), workerB = await prepareDisplayView(request);
console.log(workerA.correctionKey() === workerB.correctionKey());
// Worker A finds the states the part needs (no image, no state computed) and gives half to each worker.
const { gridKeys } = await workerA.collectCorrectionStates(part);
const half = Math.ceil(gridKeys.length / 2);
const fromA = await workerA.computeCorrectionStates(gridKeys.slice(0, half));
const fromB = await workerB.computeCorrectionStates(gridKeys.slice(half));
// Each worker imports the other's share (in one realm, as here, the second import adds nothing new).
console.log(bindDisplayViewCorrectionStates([fromB]), bindDisplayViewCorrectionStates([fromA]));
// Either worker now renders the part without computing a state; a new worker can start from an export.
const view = await workerA.render(part);
console.log(view.diagnostics.ahdCorrectedPixelCount, serializeDisplayViewCorrectionStates().map((set) => set.gridKeys.length));
```

### Facade 2.0 options: output, demosaic, optics and motion

Each 2.0 option is opt-in and uses an existing public contract. Without them, the facade's output is
byte-identical to 1.0.

- `output.format: "png"` writes `serializePngImage` output. That is either the developed sRGB samples, or,
  with `colorEncoding`, the unclipped linear development converted through CIE XYZ to Display P3 or Rec. 2020,
  signalled with cICP.
- `output.gamutMapping: "perceptual"` replaces the component clip with `prepareRgbGamutMapping`.
- `format: "dng"` writes the packed native RAW with `serializeNativeRawDng`.

See [Output formats](QUICK_START.md#output-formats).

```ts
import { simulateCapture } from "@photivra/engine";

const p3 = await simulateCapture({ scene: { preset: "checkerboard" }, output: { width: 8, height: 8, format: "png", colorEncoding: "display-p3", bitDepth: 16 } });
console.log(p3.image.png?.length, p3.image.colorEncoding, p3.provenance.composedContracts.includes("serializePngImage"));
```

`output.demosaic` selects kernels from `createBuiltInBayerDemosaicProfiles`. `output.borderHandling:
"mirror"` renders no border sites; it reads reflect-101 mirror images at the frame edge instead.

```ts
import { simulateCapture } from "@photivra/engine";

const mirrored = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 6, height: 4, demosaic: "bilinear", borderHandling: "mirror" } });
console.log(mirrored.plan.exposure.geometry.nativeRaster, mirrored.assumptions.find((a) => a.id === "output.demosaic")?.value);
```

`lens.projection` and `lens.distortion` become the environment `lensFieldMapping`. `lens.vignetting`
becomes radial field throughput, and `lens.psf` is a sampled PSF you supply. Haze and polarizers are not
offered, because the scene-radiance provider contract declares neither volumetric transport nor
polarization. See [Optics](QUICK_START.md#optics).

```ts
import { simulateCapture } from "@photivra/engine";

const barrel = await simulateCapture({
  scene: { preset: "uniform" },
  lens: { distortion: { kind: "brown-conrady", profile: { normalizationRadiusMm: 0.05, maximumNormalizedRadius: 1, coefficients: { k1: -0.2, k2: 0, k3: 0, p1: 0.01, p2: 0 } } } },
  output: { width: 8, height: 8 }
});
console.log(barrel.request.siteInput(0).environment.lensFieldMapping?.distortion.kind);
```

`lens.defocus: { model: "geometric-disc" }` (#492) renders defocus of the flat scene plane when
`lens.focusDistanceM` differs from `subjectDistanceM`. The thin-lens blur circle becomes a uniform disc on the site
lattice, and the capture convolves the scene radiance with it, which is a geometric approximation. With
`lens.diffraction`, each spectral node's diffraction kernel is convolved with the disc, which is a further
approximation. The `lens.defocus` assumption records the diameter in µm and in sites, the kernel radius and the
execution. `simulateDisplayView` does not render it yet. See [Optics](QUICK_START.md#optics).

```ts
import { simulateCapture } from "@photivra/engine";

const blurred = await simulateCapture({
  scene: { preset: "slanted-edge" },
  subjectDistanceM: 2,
  lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1.8, defocus: { model: "geometric-disc" } },
  output: { width: 16, height: 12 }
});
console.log(blurred.assumptions.find((a) => a.id === "lens.defocus")?.value); // diameterSites ≈ 5.95, kernelRadiusSites 3
```

`motion.angularVelocityRadPerSec` rotates the camera during the exposure (8 time midpoints by
default). `motion.shutter: "rolling"` derives each site's exposure window from the body's rolling
readout, with `resolveElectronicRollingShutterExposureSchedule`. See [Motion](QUICK_START.md#motion).

```ts
import { simulateCapture } from "@photivra/engine";

const rolling = await simulateCapture({ scene: { preset: "checkerboard" }, motion: { angularVelocityRadPerSec: { pitch: 0.02 }, shutter: "rolling" }, output: { width: 6, height: 6 } });
console.log(rolling.request.siteInput(7 * 8).charge.completenessProfile.startOffsetSecondsFromOpeningReference);
```
