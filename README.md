# Photivra

Photivra is an open TypeScript engine for the science and mathematics of photography and digital imaging.

**Pronunciation (IPA):** /foʊˈtɪvɹə/

Photivra gives you a reusable, tested API for:

- camera geometry and optics;
- focus and depth of field;
- exposure;
- subject and camera motion;
- sensor sampling;
- diffraction;
- cropping and framing;
- stabilization approximations;
- signal and noise.

Every calculation uses explicit units, documented assumptions, validation and provenance (a record of how the result was produced). Approximations are clearly labelled. Results are reproducible, and their limits are written down.

The source is licensed under Apache-2.0.

### Related foundations

- [Digital optics foundations](https://github.com/Photivra/photivra/blob/main/docs/DIGITAL_OPTICS_FOUNDATION.md) document the standalone stray-light irradiance, composed digital geometry and generic lens-correction APIs. They keep the optical/sensor capture model in charge, and make sampling and noise costs explicit. Production composition is separate.
- The standalone [SimulatedCapture contract](https://github.com/Photivra/photivra/blob/main/docs/SIMULATED_CAPTURE.md) stores format-neutral linear floating-point master data plus public metadata.
  - Its [virtual-camera colour model](https://github.com/Photivra/photivra/blob/main/docs/CAPTURE_COLOR.md) provides explicit linear colour conversion and applies a resolved white balance (WB).
  - [Linear encoding](https://github.com/Photivra/photivra/blob/main/docs/LINEAR_CAPTURE_ENCODING.md) defines deterministic 16-bit quantization.
  - Writing files is a later stage.
- The standalone [SDR rendering foundation](https://github.com/Photivra/photivra/blob/main/docs/SDR_RENDERING.md) keeps three steps apart: rendering after capture, output encoding, and adaptation to an external display. (SDR = standard dynamic range.) The [processed output contract](https://github.com/Photivra/photivra/blob/main/docs/PROCESSED_OUTPUT.md) connects capture, WB and correction, with explicit input domains and bounded support.
- The standalone [Print planner](https://github.com/Photivra/photivra/blob/main/docs/PRINT_PLANNING.md) works out printer-file geometry from native pixels only. It uses the physical image size, an independent viewing distance and explicit sampling conventions. It does not assess captured detail or print quality.

## Quick start

Install the published ESM package below. The [2.24.0 release record](https://github.com/Photivra/photivra/blob/main/docs/RELEASE_2_24_0.md) and [changelog](https://github.com/Photivra/photivra/blob/main/CHANGELOG.md) describe the current release:

```sh
npm install @photivra/engine@2.24.0
```

Simulate a photograph of a test chart with a generic camera, then read the developed sRGB pixels:

```ts
import { simulateCapture } from "@photivra/engine";

const capture = await simulateCapture({
  camera: "professional",
  lens: { fNumber: 8 },
  exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 },
  scene: { preset: "slanted-edge" },
  output: { width: 16, height: 16 }
});

console.log(capture.image.samples.length, capture.exposure.settings);
console.log(capture.assumptions.map((a) => `${a.id}: ${a.explanation}`));
```

`simulateCapture()` runs the full physical pipeline through the engine's existing contracts: scene radiance, lens, spectral sensor, noise, RAW readout, RAW development and optional JPEG. It lists every default and modelling choice it made in `assumptions`.

The [Quick Start](https://github.com/Photivra/photivra/blob/main/docs/QUICK_START.md) covers the inputs, the chart presets (slanted edge, Siemens star, step wedge, grey ramp, checkerboard, point grid, caller patches and, from 2.14, Photivra's own [color patches](https://github.com/Photivra/photivra/blob/main/docs/COLOR_PATCHES.md)), illuminants, white balance and limits.

The individual calculations are still available as small functions. For example, the horizontal field of view for a 36 mm sensor dimension and a 50 mm focal length:

```ts
import { calculateFieldOfView } from "@photivra/engine";

const horizontal = calculateFieldOfView({
  focalLengthMm: 50,
  sensorDimensionMm: 36
});

console.log(horizontal.value.degrees);
console.log(horizontal.provenance);
```

Start with the [Developer Guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Then use the [Usage Guide](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md) and the [API reference](https://github.com/Photivra/photivra/blob/main/docs/API_REFERENCE.md), which is generated from the package exports.

Repository `main` may describe newer, unreleased work. For the stable contract, use the docs bundled in the published package, or the exact `v2.24.0` tag.

## Documentation

- [Quick Start: simulate a capture](https://github.com/Photivra/photivra/blob/main/docs/QUICK_START.md)
- [Using Photivra from an agent](https://github.com/Photivra/photivra/blob/main/docs/AGENT_GUIDE.md)
- [Usage Guide](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md)
- [Architecture](https://github.com/Photivra/photivra/blob/main/docs/ARCHITECTURE.md)
- [Contributor Guide](https://github.com/Photivra/photivra/blob/main/CONTRIBUTING.md)
- [Agent Instructions](https://github.com/Photivra/photivra/blob/main/AGENTS.md)
- [Changelog](https://github.com/Photivra/photivra/blob/main/CHANGELOG.md)
- [Public API Style](https://github.com/Photivra/photivra/blob/main/docs/API_STYLE.md)
- [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md)
- [Image-Formation Contract](https://github.com/Photivra/photivra/blob/main/docs/IMAGE_FORMATION.md)
- [Production Image-Formation Plan](https://github.com/Photivra/photivra/blob/main/docs/PRODUCTION_COMPOSITION.md)
- [Scene Radiance and Illumination](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md)
- [PSF and Pupil Foundation](https://github.com/Photivra/photivra/blob/main/docs/PSF_FOUNDATION.md)
- [Motion and Signal Foundation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md)
- [Camera Shake and Stabilization](https://github.com/Photivra/photivra/blob/main/docs/STABILIZATION.md)
- [Scientific and Source Provenance](https://github.com/Photivra/photivra/blob/main/docs/PROVENANCE.md)
- [Scientific Assurance and Uncertainty Composition](https://github.com/Photivra/photivra/blob/main/docs/SCIENTIFIC_ASSURANCE.md)
- [Local POC HTTP API](https://github.com/Photivra/photivra/blob/main/docs/POC_API.md)

## Getting help

Use [GitHub Issues](https://github.com/photivra/photivra/issues) for reproducible bugs, documentation problems and feature discussions. For security vulnerabilities, follow [SECURITY.md](https://github.com/Photivra/photivra/blob/main/SECURITY.md).

## What is implemented

The root package exports models in four areas. Each model is either deterministic or explicitly labelled as an approximation.

A few abbreviations used below: FOV (field of view), PSF (point-spread function: how a lens spreads one point of light), MTF (modulation transfer function), CA (chromatic aberration), AA (anti-aliasing filter), CFA (colour filter array, such as a Bayer mosaic), QE / EQE (quantum efficiency / external quantum efficiency), A/W (amperes per watt, a detector's responsivity), ADC (analog-to-digital converter), AE / AF / WB (auto-exposure / autofocus / white balance).

### Optics and geometry

- [Generic focus control: MF, single AF and continuous AF](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#focus-control-mf-single-af-continuous-af-and-lock). Explicit acquisition, loss and lock state; a renderer-neutral target distance along the lens axis; strict rules for losing and reacquiring a target; and a separate gate for focus-priority versus release-priority.
- [Explicit finite and infinity focus-plane state](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#explicit-finite-and-infinity-focus-state), with no non-finite or made-up focus distances.
- [Field of view](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#field-of-view) for centered and asymmetric rectilinear framing, with optional focus-aware thin-lens projection.
- [Physical versus diagonal-based 35 mm-equivalent focal length](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#actual-and-35-mm-equivalent-focal-length).
- [Focus-breathing approximation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#focus-breathing-projection) of projection and FOV, using a scale the caller declares.
- [Generic invertible radial distortion mapping](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#radial-lens-distortion-mapping), including batch inverse sampling of many points.
- [Generic lateral CA field mapping](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#lateral-chromatic-aberration-mapping) per RGB channel.
- [Generic illumination-vignetting approximation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#illumination-vignetting) in linear light.
- [Front-of-lens filter transmission](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#front-of-lens-filter-transmission) for generic passive filters: neutral (linear), neutral optical density, and wavelength-resolved. No polarization claims.
- [Scene radiance to sensor irradiance](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#scene-radiance-to-sensor-irradiance): an optical bridge from the light leaving the scene to the light arriving at the sensor. It combines explicit pupil acceptance, lens transmission or a working-T-stop approximation, optional front-filter transmission, and exactly one field-throughput term. It stops before the sensor's own optical stack.
- [Gaussian thin-lens image distance and magnification](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#thin-lens-image-distance-and-magnification).
- [Geometric depth of field and defocus-circle diameter](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#depth-of-field-and-defocus).
- [First-zero Airy diameter](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#circular-aperture-diffraction) for an ideal circular aperture.
- [Real-lens sampled PSF and complex-pupil framework](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#real-lens-psf-profiles-and-complex-pupil-reference):
  - full 2D directional kernels;
  - bounded interpolation over field, focus, aperture, wavelength and defocus;
  - explicit field-curvature and longitudinal-focus offsets;
  - PSF shape normalized to unit energy, with pupil throughput kept separate;
  - MTF-only data fails closed: it lacks phase and spatial information, so it returns blockers instead of a guessed PSF.
- [Separated PSF/pupil contribution foundation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#psf-and-pupil-foundation).
- [Ideal regular-polygon aperture geometry and sunstar direction symmetry](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#aperture-geometry-and-sunstar-directions).

### Exposure and motion

- [Scene-to-sensor irradiance quadrature](https://github.com/Photivra/photivra/blob/main/docs/SCENE_SENSOR_QUADRATURE.md). Binds declared spectral scene samples to exact pre-AA coordinates, wavelengths and times through the existing optical bridge. ("Quadrature" means numerical integration over chosen sample points.)
- [Temporal scene-to-sensor EQE composition](https://github.com/Photivra/photivra/blob/main/docs/SCENE_SENSOR_TEMPORAL_EXPOSURE.md). Applies optics and response validity independently at every local shutter midpoint.
- [Local sampled-PSF sensor quadrature](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_PSF_QUADRATURE.md). Applies a wavelength-resolved, normalized PSF shape with explicit native and image axes and complete source support.
- [Sensor-to-environment projection queries](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_ENVIRONMENT_QUERY.md). Derives the scene directions to request from physical optical support and analytic camera rotation.
- [Executed environment capture to native RAW](https://github.com/Photivra/photivra/blob/main/docs/ENVIRONMENT_RAW_CAPTURE.md). Joins provider calls, an optional local PSF, temporal EQE and the existing seeded RAW generation, then hands off to paired export.
- [Temporal EQE photo signal to RAW](https://github.com/Photivra/photivra/blob/main/docs/TEMPORAL_PHOTO_RAW.md). Carries validated midpoint counts under changing light through exact-event dark and accumulated charge, to native RAW and paired files.
- [Irradiance-to-EQE local exposure composition](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_EQE_LOCAL_EXPOSURE.md). Validates explicit physical node samples through response applicability and range, and stationary local integration, before the existing RAW producer.
- [Generic equipment exposure capabilities](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#generic-equipment-exposure-capabilities). Keeps generic body and lens capability facts separate from the selected camera state. Resolves the aperture range at a given focal length, plus shutter and ISO envelopes, for exposure-control policy (#99).
- [Detailed ISO/exposure-index capabilities](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#isoexposure-index-capabilities-and-generic-high-iso-signal-chain). Represents standard and expanded settings, Auto ISO bounds and optional capture-mode restrictions, without inferring physical gain or noise behaviour.
- [Generic ISO/high-ISO signal-chain profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#isoexposure-index-capabilities-and-generic-high-iso-signal-chain). Maps explicit ISO/capture-mode states to sensor readout regimes (#14), while keeping the upstream photons and shot noise unchanged. Good/Better/Best are convenience profile selectors, not rankings of real cameras.
- [Manual and Manual + Auto ISO exposure resolution](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#manual-and-auto-iso-exposure-resolution). Uses the typed meter target and the resolved equipment envelope. Aperture and shutter stay under manual control. ISO quantization and limit residuals are reported explicitly.
- [Aperture Priority with manual ISO](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#aperture-priority-with-manual-iso). Keeps the caller's aperture and ISO, and resolves only the shutter, using the same typed target, reference and capability contracts.
- [Priority modes with Auto ISO](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#priority-modes-with-auto-iso). Adds explicit minimum-shutter and aperture-first policies for modes with two automatic axes, plus Shutter Priority with manual or automatic ISO. No new exposure equations.
- [Program Auto and Full Auto exposure](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#program-auto-and-full-auto-exposure). Versioned generic program lines choose aperture and shutter. ISO policy stays explicit. Full Auto covers the exposure axes only.
- [Bulb, Time and long-exposure control](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#bulb-time-and-long-exposure-control). Turns control events into a concrete number of elapsed seconds before the existing exposure-window and charge pipeline. There is no special long-exposure physics path.
- [EV100, relative optical exposure, relative rendered exposure, and equivalent ISO compensation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#exposure-and-iso-relations).
- [Relative pre-exposure metering](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#relative-pre-exposure-metering). Explicit generic multi-zone, center-weighted, spot and highlight-weighted policies over the oriented active capture frame. Also: generic body metering capability/profile compatibility, and a frozen target handed to automatic exposure.
- [Scene-radiance-derived and explicit temporal metering](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#scene-radiance-derived-and-temporal-metering). Binds relative meter samples to the scene-radiance provider, material and illumination context (#85). Time-varying illumination needs a declared time-averaging policy. No spectral-to-luminance conversion is invented.
- [Manual ordinary flash with front/rear sync](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#manual-flash-and-ordinary-sync).
  - Registers a spatial scene-light source (#85) and an explicit pulse waveform against the exposure-window timing (#12).
  - Keeps ambient temporal illumination.
  - Fails closed when an ordinary pulse cannot fit inside a real interval where the whole frame is open.
  - HSS (high-speed sync) and TTL (through-the-lens) flash are not faked.
- [Stable meter targets and exposure compensation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#meter-target-and-exposure-compensation). Freezes the metering identity for AE lock, and shifts the automatic-exposure target downstream without changing the underlying meter result.
- [Deterministic logical release sequencing](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#logical-release-sequences) for single shots, bursts, the self-timer, and exposure/focus bracket timing.
- [Extended-object time-varying projection](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#extended-object-time-varying-projection). Projects explicit metric object points under a shared rigid translation. Optionally validates fronto-parallel magnification. Binds the same geometry to the local exposure windows (#12). Does not claim visibility or a finished blur kernel.
- [Constant-velocity projected point motion](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#projected-subject-motion).
- [Spatial camera-rotation mapping over time](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#spatial-camera-rotation-mapping) for yaw, pitch and roll.
- [Capture-local pure-rotation exposure trajectories](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-rotation-exposure-trajectories), evaluated at each native point's local exposure start and end. Not a finished rolling-shutter warp.
- [Capture-mode-bound shutter/readout timing](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-mode-bound-shutterreadout-timing). Binds timing evidence to one exact capture-mode/profile identity. Keeps sensor readout separate from exposure boundaries. Fails closed on unsupported non-uniform schedules.
- [Depth-aware translation/parallax temporal geometry](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#depth-aware-translationparallax-temporal-geometry). Requires metric scene depth. Keeps camera translation and subject translation independent. Explicitly forbids using one global homography for a translating 3D scene.
- [Temporal scene-radiance sampling](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#temporal-scene-radiance-sampling). Generates deterministic provider-evaluation nodes on each point's own local exposure clock, and reduces only radiance results whose identity and time match.
- [Capture-local pure-rotation temporal quadrature](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-rotation-temporal-quadrature). Deterministic midpoint nodes, with separate normalized-average and seconds-valued time measures. Does not calculate radiance or blur.
- [Instantaneous inverse capture-scan mapping under pure rotation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#instantaneous-capture-rotation-inverse-mapping), with an explicit phase within the local exposure and analytic destination-to-reference ray inversion.
- [Time-domain physical stabilization system](https://github.com/Photivra/photivra/blob/main/docs/STABILIZATION.md#time-domain-physical-stabilization-system).
  - Generic synthetic sensor-shift, OIS (optical image stabilization) and coordinated rotational correction.
  - Explicit latency, gain and limits, and a declared panning-axis bypass.
  - Samples the local exposure windows (#12).
  - Does not use tripod/support state or "stops of stabilization" ratings.
- [The existing controlled yaw/pitch camera-shake and stabilization-equivalent approximation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#camera-shake-and-stabilization-equivalent-approximation).

### Color controls

- [White-balance control and Auto WB](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#white-balance-and-auto-wb). Generic presets owned by the profile, manual gains, independent CCT (correlated colour temperature) plus tint, custom measurement, deterministic AWB priorities and AWB lock. Scene illumination and the RAW-like capture are never changed.
- [Image processing](https://github.com/Photivra/photivra/blob/main/docs/PROCESSING.md). All of these are cancellable approximations:
  - built-in bilinear Bayer demosaic kernels with mirrored borders, and AHD demosaic;
  - noise-optimal linear merge of a RAW HDR (high dynamic range) bracket;
  - conversion of merged radiance to linear BT.2020 (PQ and HLG are not part of 2.0; see `THIRD_PARTY.md`);
  - Reinhard and Durand–Dorsey tone mapping;
  - Mertens exposure fusion;
  - focus stacking;
  - panorama from known rotations;
  - bilateral and non-local-means denoise;
  - unsharp mask;
  - clearly synthetic film grain.
- [Colorimetry](https://github.com/Photivra/photivra/blob/main/docs/COLORIMETRY.md):
  - a labelled analytic approximation of the CIE 1931 colour-matching functions (CMFs), or CMF tables you supply;
  - spectral integration;
  - Planckian, illuminant A and CIE daylight illuminants;
  - CCT and Duv;
  - Bradford and CAT16 chromatic adaptation;
  - Kelvin + tint WB gains;
  - CIELAB and ΔE76/94/2000;
  - camera-matrix fitting;
  - Display P3 and Rec.2020 matrices;
  - sRGB, BT.709 and BT.1886 transfer functions;
  - hue-preserving gamut mapping.

  CIE and ColorChecker tables are not bundled.

### Sensor and output

- [Projected fronto-parallel object size and sensor-pixel sampling](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#projected-object-size-and-sensor-sampling).
- [Pixel pitch](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#pixel-pitch).
- [Sensor imaging area, native raster, crop factor, megapixels, and 2D sampling metrics](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-imaging-area-and-native-raster).
- [Sensor architecture and capability metadata, with provenance](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-architecture-metadata), including an independent, optional CMOS/CCD technology-family identity.
- [Exact colour-sampling topology profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#color-sampling-topology). Supports monochrome and any periodic mosaic on an abstract lattice of sampling sites anchored to the sensor. Spectral response, and binding to the raster or photodiodes, are kept separate.
- [Capture-mode / colour-sampling structural bindings](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-modecolor-sampling-binding). Explicitly relates one exact native effective raster to the colour-site lattice, and resolves compact source regions before reconstruction, without inventing signal weights.
- [Sensor optical-stack profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-optical-stack). Keeps physical stack-component metadata separate from the effective AA spatial response. Absent, unknown and unresolved are distinct states. Supports any normalized point-splitting kernel.
- [Sensor sampling-aperture profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-sampling-aperture). Explicitly registers colour-site centers in native sensor physical space, and resolves geometric sensitive rectangles. Pitch, fill area, QE, microlenses and radiometry are not mixed together.
- [Sensor spatial-sampling quadrature](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-spatial-sampling-quadrature). Combines AA point splitting with geometric aperture integration into deterministic native-physical source nodes and weights.
- [Sensor spatial-sample reduction](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-spatial-sample-reduction). Reduces explicitly identified non-negative linear node values in relative or physical irradiance domains. Does not claim CFA spectral filtering or RAW conversion.
- [Sensor spectral-response profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-spectral-response). Binds reusable, wavelength-dependent channel response data to exact colour-sampling IDs. Spectra are never guessed from CFA labels.
- [Sensor spectral quadrature](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-spectral-quadrature). Builds wavelength plans that respect response knots, using bounded midpoints with an explicit dλ. Applying the response and integrating the source spectrum stay separate steps.
- [Sensor spatio-spectral irradiance reduction](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-spatio-spectral-irradiance-reduction). Combines explicit W/m^2/nm source samples over spatial and wavelength quadrature into irradiance and incident-flux integrals, before any response is applied.
- [Sensor-response application compatibility](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-response-application-compatibility). Fail-closed matching of response plane, area normalization, spatial separability, profile identity and reference conditions, before any QE or A/W conversion.
- [Sensor-response operating-range assessment](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-response-operating-range). Keeps the calibrated power/irradiance domain, wavelength applicability, reference conditions and nonlinearity criterion, before any instantaneous response-rate conversion.
- [Photon-energy wavelength basis](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#photon-energy-wavelength-basis). Derives photon energy from the vacuum wavelength with exact SI constants. Air wavelengths need explicit refractive-index and atmosphere handling.
- [EQE electron-rate conversion](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#eqe-electron-rate-conversion). Applies authorized effective QE at each wavelength node, converting spectral power on the geometric aperture into incident-photon and expected-electron rates. No exposure integration.
- [A/W responsivity photocurrent conversion](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#aw-responsivity-photocurrent-conversion). Applies calibrated spectral responsivity at each wavelength node to give the photocurrent magnitude at the detector terminal, under explicit electrical operating conditions. No transimpedance or time integration.
- [Dark-current charge accumulation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#dark-current-charge). Integrates an evidence-backed thermal electron rate (before compensation) over the exact local EQE exposure. No universal temperature law and no full-well assessment are invented.
- [Accumulated-charge completeness](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#accumulated-charge-completeness). Binds photo, dark and explicitly incremental other stored-electron contributions to one exact exposure, before a physical full-well assessment can be allowed.
- [Physical charge-capacity assessment](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#physical-charge-capacity). Compares the complete expected stored electrons with an evidence-backed physical storage capacity. Not confused with camera/digital saturation. No invented blooming or clamping.
- [Stochastic sensor charge and RAW-code readout](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#stochastic-charge-conversion-adc-and-raw-code):
  - deterministic, seeded photo and dark shot noise;
  - explicit sampling policies for additional charge;
  - separate electronic read-noise components;
  - explicit conversion-gain regimes;
  - black offset, saturation before the ADC, ADC quantization, and digital saturation;
  - nothing inferred from ISO.
- [Capture-mode/CFA-bound RAW samples and reconstruction](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#raw-capture-samples-and-reconstruction). Keeps the absolute native CFA phase. Fails closed for grouped or remosaic modes without explicit combination maths. Uses evidence-backed linear reconstruction kernels specific to the capture mode and CFA. Does not claim to model aliasing or moiré.
- [Camera saturation-capacity assessment](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#camera-saturation-capacity). Compares the expected dark-corrected photo signal (in electron equivalents) with an evidence-backed saturation capacity of the camera's response chain. Does not reuse total stored charge or guess which stage clips.
- [Local sensor-rate/exposure binding](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#local-sensor-rateexposure-binding). Maps one exact response-rate colour site, through an evidenced one-to-one relationship with the native effective raster, to its local shutter window. Does not yet allow rate × duration integration.
- [Constant-rate local-exposure integration](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#constant-rate-local-exposure-integration). Requires evidence that the rate is stationary over the exact local window before producing EQE expected counts or A/W photocurrent charge. Saturation stays unauthorized.
- [Processed camera output](https://github.com/Photivra/photivra/blob/main/docs/PROCESSED_OUTPUT.md). One explicit RAW-derived SDR development shared by preview, paired JPEG and committed production-plan output.
- [Orthogonal capture-mode profiles](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-mode-profiles). Keeps apart: acquisition sequence, per-frame sampling, sensor-shift sequence, reconstruction stages, processed raster and final output geometry.
- [Capture-specific native sensor readout scan timing](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#sensor-readout-timing), with total data-readout duration and rolling spatial timing skew evidenced separately.
- [Readout/exposure spatial linkage assessment](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#readoutexposure-spatial-linkage), for evidence-backed same or reversed normalized phase relationships between rolling readout and electronic exposure boundaries. Does not assert absolute synchronization.
- [Capture exposure-window timing](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-exposure-window-timing), with independent opening and closing boundary schedules and validation of local duration.
- [Capture orientation, active sensor area, and output geometry](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#capture-orientation-active-area-and-output-geometry).
- Explicit metric coordinate transforms between the oriented physical raster and the image plane before orientation, for renderer and lens-field integration.
- [Centered crop and subject-height framing crop](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#centered-crop-and-subject-framing-crop).
- [Radiometry prerequisite/readiness assessment](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#radiometry-readiness).
- [Mean photoelectron conversion, and basic shot-noise / read-noise SNR primitives](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#photoelectron-and-snr-primitives). (SNR = signal-to-noise ratio.)

### Data, validation, and composition

- [Shared spectral wavelength primitives and scene illumination-source profiles](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md). Light-source metadata is kept separate from the light leaving the scene (outgoing scene radiance). Source-specific units, approximation/calibration status, provenance and renderer-independent source identities are preserved.
- [Scene material-response and radiance-provider contracts](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#scene-radiance-provider-and-material-response-boundary). Validates renderer/provider fidelity; exact scene, profile and sample binding; wavelength, time and direction identity; and output in W/m²/sr/nm. Provider output is not treated as calibrated sensor input.
- [Shared continuous spectral coverage and discrete-line composition](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#shared-spectral-composition). Intersects the explicit scene, optics and sensor wavelength ranges. Keeps delta-like integrated line measures separate from continuous per-nanometre quadrature.
- [Temporal illumination waveforms and capture-time registration](https://github.com/Photivra/photivra/blob/main/docs/SCENE_RADIANCE_AND_ILLUMINATION.md#temporal-illumination). Evaluates flash and flicker as relative multipliers, in seconds, against the authoritative local exposure windows. Sensor readout, metering and automatic exposure policy are not mixed in.
- [Image-formation ownership and order contract](https://github.com/Photivra/photivra/blob/main/docs/IMAGE_FORMATION.md), including coordinate, time, renderer and reserved sensor-stage meanings.
- [Production image-formation plan](https://github.com/Photivra/photivra/blob/main/docs/PRODUCTION_COMPOSITION.md):
  - separates prepared static context from immutable per-capture snapshots;
  - binds the committed release-frame state (#105) and WB state (#108);
  - expands stage dependencies from the authoritative graph;
  - composes the physical optics path (#110) plus the mature timing and rotation foundations;
  - preserves scientific assurance, evidence and uncertainty across engines;
  - surfaces renderer and engine fidelity blockers;
  - provides shared manifests for optimized and reference consumers, without changing the POC.
- [Camera and scene schemas, with runtime validation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#camera-and-scene-schema-validation).
- [Provenance plus optional uncertainty/quality metadata](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#provenance-uncertainty-and-quality-metadata).
- [The composed `simulatePocCamera()` proof-of-concept calculation](https://github.com/Photivra/photivra/blob/main/docs/USAGE.md#composed-poc-simulation).

The package has no runtime npm dependencies.

## Sensor/capture integration status

The sensor and capture foundations are deliberately **additive**: they add new APIs without changing existing ones.

The root engine exposes standalone APIs for:

- physical sensor imaging area and native raster metrics;
- independent X and Y geometric sampling pitch;
- active-capture rectangles and physical camera orientation;
- native ↔ oriented transforms for points, vectors and rectangles;
- FOV for off-center and asymmetric active capture;
- diagonal-based 35 mm-equivalent focal length;
- evidence-backed sensor architecture metadata;
- evidence-backed colour-sampling topology profiles: monochrome, any periodic mosaic, and structural-only layered colour declarations;
- evidence-backed bindings between the native effective raster and the colour-site grid, plus capture-mode resolution of structural sources with an explicit grouped-mode phase and channel-site counts;
- evidence-backed sensor optical-stack profiles: ordered physical components, microlens presence, and a separately declared effective anti-aliasing spatial response;
- evidence-backed registration of sensor site centers, plus geometric sampling-aperture profiles (unresolved or resolved footprint) and the derived geometric sensitive-area fraction;
- evidence-backed sensor spectral-response profiles, plus deterministic bounded spectral-quadrature plans that keep the wavelength measure separate from applying the response and from integrating the source spectrum;
- evidence-backed capture-mode profiles: single, fixed or variable multi-frame acquisition; native, grouped or declared per-frame sampling; optional sensor-shift offsets; reconstruction stages; and a separate processed-image raster;
- capture-specific native readout scan timing, with explicit provenance and no inference from output resolution;
- capture exposure-window timing with independent opening and closing boundary schedules;
- capture-local rotation trajectories for a stationary ray, driven by exposure windows (sensor readout deliberately excluded);
- instantaneous inverse capture-scan rotation mapping at a caller-selected phase within the local exposure, still independent of sensor data-readout timing;
- radiometry prerequisite/readiness assessment.

These contracts are **not all composed into `simulatePocCamera()` yet**.

- POC API 0.20 composes staged capture geometry through final output and viewing: orientation, active-capture rectangles, output crop/raster, active/output FOV, 35 mm-equivalent focal length of the active capture, viewing-based CoC (circle of confusion) against the final retained physical area, orientation-aware subject framing, and explicit output pixel scaling.
- Still not composed into the legacy POC: sensor-architecture metadata, colour-sampling topology profiles, native-effective-raster/colour-site bindings, sensor optical-stack profiles, sensor sampling-aperture profiles, capture-mode profiles, sensor readout scan timing, capture exposure-window timing, and radiometry-readiness profiles.
- The separate production plan 0.7.0 runs its bounded, declared environment → sensor → RAW → output route.
- Readout timing stays in invariant native sensor coordinates. Physical orientation is an explicit later transform.

The POC reports X/Y sampling diagnostics, but still uses one representative horizontal pitch internally for several pixel-domain calculations. It therefore rejects geometry whose X and Y pitch differ by more than 1%, instead of silently producing a directional error.

Likewise, radiometry readiness does not turn on photon/noise output in the POC. Integrating these foundations is separate future work, and should happen explicitly, not by silently changing what existing requests mean.

## Sample use case

A developer wants to model how a change in camera settings affects an image.

The application gives Photivra camera and scene parameters — sensor dimensions, focal length, aperture, shutter speed, focus distance, subject distance and motion. It gets back structured scientific results describing effects such as:

- field of view;
- projected subject size;
- depth of field and defocus;
- diffraction;
- subject-motion blur;
- camera-shake blur;
- pixel sampling;
- crop and framing;
- exposure relationships;
- basic signal and noise behaviour.

Each result carries explicit units and model provenance. Approximations are clearly identified, not presented as exact physical measurements.

```ts
import {
  calculateFieldOfView,
  calculateDepthOfField,
  calculateProjectedMotionBlur
} from "@photivra/engine";

const fieldOfView = calculateFieldOfView({
  focalLengthMm: 200,
  sensorDimensionMm: 36,
  focusDistanceM: 22
});

const depthOfField = calculateDepthOfField({
  focalLengthMm: 200,
  aperture: 5.6,
  focusDistanceM: 22,
  circleOfConfusionMm: 0.03
});

const motion = calculateProjectedMotionBlur({
  focalLengthMm: 200,
  shutterSeconds: 1 / 1000,
  positionM: { x: 0, y: 1, z: 22 },
  velocityMps: { x: 10, y: 0, z: 0 },
  focusDistanceM: 22,
  pixelPitchMicrometers: 6
});

console.log(fieldOfView.value);
console.log(depthOfField.value);
console.log(motion.value);
```

The application can then use those results, while the photography calculations themselves stay in one central, tested, reproducible place.

## Status

- Repository package version: `2.24.0` (release candidate prepared November 12, 2026; publication is separate)
- Engine API contract: `2.24.0`
- Versioned generic tier reference assets: [GENERIC_TIER_PRESETS.md](https://github.com/Photivra/photivra/blob/main/docs/GENERIC_TIER_PRESETS.md).
- Sensor profiles from published specifications (#554, unnamed): [SENSOR_PROFILES.md](https://github.com/Photivra/photivra/blob/main/docs/SENSOR_PROFILES.md).
- Composed POC simulation API contract: `1.0.0`
- Stability: 1.0 root-package compatibility policy; bounded scientific models and independent POC contract

From 1.0.1, the package version and `ENGINE_API_VERSION` are equal. New captures/plans record 2.24.0; existing archives keep their original creator identities. Schema, model and POC contract versions stay independent.

A breaking change to the root contracts now needs a new package major version. Additive and corrective changes follow [compatibility and migration](https://github.com/Photivra/photivra/blob/main/docs/RELEASE_1_3_0.md). A 1.0 package is not a claim of calibrated physical accuracy.

Creating a GitHub release/tag and publishing `@photivra/engine` are separate release actions. The publish workflow, triggered by the tag, checks that the `vX.Y.Z` tag matches the package version before publishing.

## Image-formation integration boundary

The root engine exports `getImageFormationContract()`. It is a descriptive public contract covering: which scientific domain owns what, coordinate spaces, stage dependencies and couplings, the time basis, renderer warp/compositing rules, and the reserved order of sensor stages.

The contract does **not** claim that every listed stage is implemented. Reserved stages are future work, and `simulatePocCamera()` is unchanged at API 0.20. See [Image-Formation Contract](https://github.com/Photivra/photivra/blob/main/docs/IMAGE_FORMATION.md).

## Important scientific limits

Photivra deliberately avoids claiming more than its current models support.

- **Focus-aware projection** is ideal paraxial thin-lens geometry by default. A separate focus-breathing approximation, with a declared scale, can change projection and framing for one focus state. Photivra does not infer a breathing curve or claim calibration for any named lens.
- **Generic radial distortion** is a field mapping parameterized by the caller, with an explicit physical normalization radius and an operating range in which it can be inverted. Decentering/tangential distortion and named-lens calibration are not modelled yet.
- **Generic illumination vignetting** is only a field-dependent attenuation, linear in scene light and per channel. It does not model pupil clipping, cat's-eye bokeh, PSF changes or calibrated lens radiometry.
- **Generic lateral CA** is an independent radial field mapping for abstract RGB renderer channels. It is not a spectral lens model, a sensor-CFA calibration, a longitudinal-CA model or a named-lens profile.
- **The legacy projected-motion primitive** follows one representative point. Separate extended-object and depth-direction temporal projection supports declared rigid reference geometry and constant linear motion. Visibility, deformation and radiance accumulation remain the caller's responsibility.
- **The legacy stabilization-equivalent camera-shake API** is still one global yaw/pitch image-plane vector. Separately:
  - a low-level rotation-only mapping models yaw/pitch/roll image motion that depends on field position;
  - depth-aware translation/parallax quadrature is available;
  - generic stabilization models with response, latency and limits are available.

  Neither models calibrated commercial IBIS/OIS (in-body / optical image stabilization). The bounded production environment route uses only its declared constant-axis rotation.
- **Native sensor readout timing** uses a caller-declared, uniform, linear, single-axis spatial phase approximation. Capture data-readout duration and rolling spatial skew are separate evidence-backed facts. The model does not treat one effective raster row or column as one physical hardware readout line, and does not yet model non-uniform or segmented readout or rolling-shutter image distortion.
- **Readout/exposure linkage** can assert only a normalized native spatial-phase/order relationship to an electronic exposure boundary. It does not establish absolute readout-versus-exposure timing. Equal directions or equal timing spans are never treated as proof of synchronization.
- **Capture exposure-window timing** models opening and closing boundaries independently, as simultaneous or uniform-linear native scans. It checks that the local duration is positive across the whole active rectangle. It does not itself model curtain acceleration, segmented or nonlinear electronic timing, shutter shock, EFCS-specific (electronic first-curtain shutter) pupil/bokeh behaviour, or automatically equate exposure boundaries with sensor readout. The separate manual-flash foundation registers a pulse against this timing without redefining the exposure-window contract (#12).
- **Capture rotation trajectories** evaluate a stationary reference ray at local exposure start and end under pure, constant camera rotation. The chord between the endpoints is not an integrated blur kernel, and the API is not an inverse destination-to-source rolling-shutter warp. Separate instantaneous inverse mapping and midpoint temporal quadrature provide those geometric pieces. Executed environment capture integrates declared radiance at its supported local shutter nodes.
- **Capture rotation temporal quadrature** supplies deterministic midpoint geometry samples across each local exposure. It does not sample scene radiance, output an averaged coordinate or blur radius, model shutter-transmission ramps, or claim a geometry-only error bound. Radiance integration happens later and separately.
- **Instantaneous capture-rotation inverse mapping** gives destination-to-reference geometry at an explicit phase within each local exposure window. Pure rotation is inverted analytically, not iteratively. The result is still not a finite-exposure image or a blur model. Reference rays may legitimately fall outside the active source frame and are not clamped.
- **The Airy diagnostic** stays a separately named size diagnostic for an ideal circular pupil.
  - `calculateIdealPolygonDiffractionPsf()` adds a continuous, unit-energy density for ideal on-axis regular-polygon pupils, with explicit equal-area physical scaling. Blade geometry alone does not give a physical PSF.
  - The real-lens framework owns explicitly profiled, combined primary-optics PSFs and complex-pupil/wavefront propagation.
  - Do not stack polygon diffraction on top of a kernel that already includes diffraction.
- **Capture-mode profiles** describe acquisition, sampling and reconstruction structure only. Grouped sampling does not imply charge-domain binning unless that is separately evidenced. Processed-image resolution does not change FOV or the physical sensor identity, and does not establish the physical photosite count. Pixel-shift offsets are in units of the native effective sampling pitch and do not claim a photodiode pitch.
- **Colour-sampling topology** is independent from `NativeImageRaster`. Periodic mosaic phase is anchored to absolute native sensor sampling-site indices, not to crop-local coordinates. Channel IDs are labels, not spectral response curves. Layered colour uses a separate unresolved spatial reference and stays structural-only until per-layer sampling density and registration are explicit. Sparse, non-periodic exceptions such as PDAF (phase-detection autofocus), masked or defective sites are not represented by schema 0.1.0.
- **Native-effective-raster / colour-site binding** needs its own evidence and is tied to one exact native raster. Matching dimensions alone never prove a 1:1 CFA correspondence. Grouped capture modes also need an evidenced full-frame top-left grouping phase. The bridge reports only compact pre-reconstruction source rectangles and channel-site counts — no sum/average weights, spectral response, downstream reconstructed-pixel dependency or photodiode count. Pixel-shift offsets do not change CFA channel assignment, because the sensor and CFA move together.
- **Sensor optical-stack schema 0.1.0** separates physical component presence from the effective anti-aliasing response. An omitted AA response means unknown. An explicit `absent` means there is no intentional AA spatial-splitting term in this contract; it does not mean an identity whole-stack PSF or zero aliasing risk. Point-splitting kernels are normalized spatial redistribution only. They exclude throughput, spectral transmission, field/wavelength/polarization dependence, cover-glass refraction and microlens behaviour.
- **Sensor sampling-aperture schema 0.1.0** keeps the physical registration of colour sites separate from both `NativeImageRaster` and radiometry. Site pitch and origin must be explicitly evidenced; aperture geometry is not inferred from pitch or fill fraction. The first resolved aperture is a uniform, axis-aligned geometric sensitive rectangle inside one lattice cell. Its derived sensitive-area fraction is a geometry diagnostic only — not QE, effective collection area, microlens behaviour, charge diffusion/crosstalk, spectral response or optical throughput.
- **Sensor spatial quadrature** inverse-samples the pre-AA optical field through the declared AA split and geometric aperture. The destination CFA channel stays authoritative for all nodes; pre-AA source coordinates never reassign CFA colour. Source support that falls off the imaging area is exposed, not clamped or dropped. Normalized weights stay unchanged, and square-micrometre measures stay geometric — they are not radiometric collection area.
- **Sensor spectral-response schema 0.1.0** treats channel IDs as labels until explicit wavelength-dependent data is supplied.
  - Direct effective EQE, direct A/W responsivity, and explicitly separable filter × detector-QE are different representations.
  - Response curves need reusable-data or Photivra-owned provenance.
  - They never extrapolate outside their wavelength range, and never convert between air and vacuum wavelength coordinates implicitly.
  - They do not model field-angle, temperature or polarization dependence, and do not integrate over wavelength, photons or electrons.
- **Signal/noise primitives** need photon or electron quantities supplied by the caller. The radiometry-readiness API can assess declared prerequisites, but it does not derive photons or turn on photon/noise output in the composed POC.
- **The composed POC** still uses one representative pixel-pitch path internally, so it rejects sensor geometry whose X/Y sample pitch differs by more than 1%. The lower-level geometry APIs already keep X and Y pitch independent.
- **No named commercial camera or lens performance** is claimed.

See [Physics Foundation](https://github.com/Photivra/photivra/blob/main/docs/PHYSICS_FOUNDATION.md), [Motion and Signal Foundation](https://github.com/Photivra/photivra/blob/main/docs/MOTION_AND_SIGNAL.md), and [Camera Shake and Stabilization](https://github.com/Photivra/photivra/blob/main/docs/STABILIZATION.md) for details.

## Principles

- Implement established photography, optics, sensor, motion and imaging mathematics independently.
- Do not copy code, datasets, calibration tables, model weights or protected technical expression unless the reuse rights are explicit and compatible with Apache-2.0 distribution.
- Treat publicly viewable material as reference material only. Being public is not permission to copy. Independent implementation does not, by itself, resolve third-party patent rights.
- Keep calculations deterministic and testable wherever the model itself is deterministic.
- Prefer explicit units, versioned schemas, consistent public APIs and reproducible results.
- Label results by provenance: calculated, calibrated, estimated or approximation.
- Report uncertainty or accuracy metadata only when it can be defended. Never invent an aggregate confidence or error bars.
- Keep the repository focused on reusable scientific/business logic, validation, schemas, tests, documentation and contributor tooling.

## Runtime surfaces

The package is ESM.

- From 2.0.0, its export map also has a `default` condition. CommonJS code on Node 22.12 or later can therefore `require("@photivra/engine")` through Node's `require(esm)` support.
- `@photivra/engine/package.json` is exported.
- The published JavaScript source maps embed their TypeScript sources.
- The declarations type-check with `lib: ["es2022"]` alone. DOM and `@types/node` are not required; the package declares the one minimal `AbortSignal` member it uses.

The root export is the runtime-neutral scientific surface:

```ts
import {
  calculateFieldOfView,
  simulatePocCamera
} from "@photivra/engine";
```

CI checks the root dependency graph, so Node-only modules and the repository-local HTTP POC server cannot become reachable from this browser-facing surface.

The open repository still contains a minimal Node HTTP POC server under `src/api`, for contributor integration testing. It is deliberately **not** exported by `@photivra/engine` and is left out of the published npm package. It has no authentication and is **not** a production hosting recommendation.

From 2.0.0, the published manifest declares no `prepare` or other install lifecycle scripts. Install the npm package. A Git checkout must be built explicitly with `npm ci && npm run build` before use.

## Development

Development and Node-only tooling support maintained Node.js 22 (minimum 22.13), maintained 24, and 26 Current. Patched Node 24 is preferred for builds.

CI checks the 22.13 minimum, plus the newest maintained LTS lines and the newest Current release (today: patched 22 and 24 LTS, and 26 Current), under [the runtime policy](NODE_SUPPORT.md).

The reproducible npm workflow uses the committed lockfile:

```sh
npm ci
npm run check
npm run coverage
npm run build
npm run pack:check
```

Coverage gates are currently:

- 90% lines;
- 90% statements;
- 90% functions;
- 80% branches.

The deterministic fuzz/property tests use fixed seeds, so failures can be reproduced.

You may use Yarn or pnpm for development. Release and CI dependency resolution is defined by `package-lock.json` and `npm ci`.

## Validation boundaries

TypeScript types are not validation for untrusted data.

- Use `parseCameraConfiguration()`, `parseSceneDefinition()`, `parseSensorArchitectureProfile()` and `parseRadiometryReadinessProfile()` at their external JSON/configuration boundaries.
- The repository-local Node POC HTTP layer has its own structural request parser, which runs before `simulatePocCamera()`.
- Scientific range and domain validation stays in the calculation modules.
- Public `CalculationResult<T>` envelopes reject non-finite numeric output.

## Citation

GitHub can generate citation text from [CITATION.cff](https://github.com/Photivra/photivra/blob/main/CITATION.cff). Use that metadata when citing Photivra in research, technical documentation or reproducible analyses.

## Licensing

Source code in this repository is licensed under Apache-2.0 unless a file clearly states otherwise. See [LICENSE](https://github.com/Photivra/photivra/blob/main/LICENSE), [NOTICE](https://github.com/Photivra/photivra/blob/main/NOTICE), and [THIRD_PARTY.md](https://github.com/Photivra/photivra/blob/main/THIRD_PARTY.md).

This product includes DNG technology under license by Adobe.

The Photivra name, logos and branding are owned by Shackelford Creative, LLC. The Apache license does not grant trademark rights to them, except as allowed by applicable law and the license itself.

**Trademarks.** ColorChecker, RAL and the other product, company and brand names mentioned are trademarks of their respective owners. They are used only to identify the color sets and products compared against or cited; Photivra is not affiliated with or endorsed by them.

Outside contributions are merged only under the project's contributor licence agreement; see [Licensing of contributions](https://github.com/Photivra/photivra/blob/main/CONTRIBUTING.md#licensing-of-contributions).
