# Stray light and digital lens correction foundations

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

This page covers three groups of standalone, browser-safe primitives (from issues #114, #118 and #117):

- **stray light**: ghosts and veiling glare added to the image-plane irradiance;
- **geometric mapping**: one shared description of digital warps (distortion correction, crop, rotation, stabilisation) and how to resample through it honestly;
- **camera correction profiles**: generic in-camera lens corrections and how they are applied.

None of these turns on a production-plan stage, changes the POC (proof-of-concept simulation API) or supplies a calibrated camera or lens preset.

Versions: these primitives moved the public root API from 0.94.0 to 0.95.0. Each new profile and prepared-map schema is 0.1.0. The package, POC, production-plan and PSF versions did not change.

## Applicability and evidence

**Exact binding.** Each stray-light or correction profile is bound to one exact combination of:

- generic body and lens identity and version;
- focal length, aperture and a finite focus distance;
- still or video mode;
- output dimensions, frame rate and stabilisation mode.

Any mismatch fails. No interpolation or extrapolation is inferred. For stills, `frameRateHz` is zero; for video it is positive. Infinity focus, interpolated zoom or focus states, and crop paths that change over time need future schemas.

**Evidence.** Only generic-parametric evidence is accepted.

- Source records go through the existing `EvidenceProvenance` parser.
- `basis` and `residualNote` must be explicit.
- Parameters can be synthetic approximations written independently. Source metadata does not prove measured accuracy.
- These first parsers do not accept calibrated profiles or invented quantified uncertainty.
- No tier or manufacturer identity determines the coefficients.

## Additive stray-light irradiance

`calculateLensStrayLightIrradiance()` evaluates one instant, one image-plane point and one exact wavelength slice (air or vacuum).

**Coordinates.**

- Source field angles are in degrees, +X right and +Y up. The declared domain is the Euclidean norm of these two angles, not a great-circle angle on a sphere.
- The image plane is in millimetres, measured from the optical axis.
- Sources outside the frame are still inputs, even when their primary images fall outside the active crop.

**Source power.** Each source gives its incident spectral power in W/nm, integrated over the profile's declared reference entrance area. The caller must derive this from the source's illumination and that area. It is not pixel brightness, and it is not W/m².

**Admitted fraction.** `admittedFraction` is an explicit per-source, per-path result saying how much light gets in. A future physical solver for lens hoods and flags may provide it; the engine never infers a global "hood" slider.

**Ghost and veil responses.** Ghosts (reflection images) and veil (veiling glare) have separate identities and outputs.

- Both use Gaussian templates, parameterised independently and normalised over the infinite plane.
- Their centroids are explicit affine functions of the source field angles. Sigma is in mm.
- A response's power fraction is F(0) × (1 + angularSlope × rho²), where rho is the source-angle norm divided by the declared maximum.
- The parser checks that fractions are nonnegative, and checks the total response fraction at both angular ends. Because the sum is affine in rho², checking the ends bounds the whole range.

This bounds the stray paths only. To claim whole-system energy conservation, the caller must budget primary transmission and stray power together.

**Units.** The normalised template density is exp(−distance²/(2 sigma²))/(2π sigma²), in 1/mm². Multiply by 10⁶ to get 1/m². Then:

source power × admitted fraction × response fraction × density = W/m²/nm.

A finite frame never renormalises it. The model does not trace lens surfaces, and does not infer any brand's ghost signature.

**Output.** `totalSpectralIrradianceWPerM2PerNm` is primary + ghost + veil. It is ready for the same downstream spectral, spatial and exposure integration as any other incident light.

- Saturation and sensor noise happen after the addition.
- The integration test uses the existing photon-energy, photoelectron and Poisson/read-noise primitives with declared exposure, area and QE (quantum efficiency). It does not show radiometry readiness for a real device.
- `meterDomain` explicitly chooses primary-only or primary-plus-stray metering.

**Other rules.**

- When disabled, the primary irradiance is returned exactly. Profiles are still validated when disabled.
- Diffraction, primary PSFs and lens contamination are excluded.
- A `sensor-lens-reflections` declaration binds the combined body-and-lens state explicitly.
- One static instant is not an exposure average. Callers must integrate over time and wavelength separately.
- There is no display or cosmetic flare mode.

## One mapping and honest sampling

The idea: every digital warp is described once, in one validated mapping. Every consumer uses that same mapping, and resampling never claims more detail or coverage than the source supports.

**Preparing a mapping.** `prepareGeometricMapping()` stores canonical transforms, a deterministic semantic key and contiguous groups by image domain. It copies the parsed transform data. The returned record can be serialised. It is revalidated and re-prepared when used, so callers cannot get around validation by editing a cached record.

**Transform order and kinds.** Transforms are listed from destination to source.

- **Affine** maps represent breathing, rotation, crop and digital stabilisation with a full matrix and offset.
- **Radial** maps reuse the existing monotonic radial-distortion evaluator. For correction, the ideal destination coordinate maps to the physical, distorted source data.

A declared correction polynomial is independent of the physical optical polynomial. It can deliberately leave some distortion uncorrected. No implicit correction strength or ideal-lens inversion is assumed.

Mapping schema 0.2.0 (2.0) adds two transform kinds; see the [contract review](PHYSICS_FOUNDATION.md#lens-geometry-wiring-contract-review-20):

- `brown-conrady` (purpose `distortion`): like `radial`, the ideal destination coordinate maps to physical distorted source data, here through the validated Brown–Conrady forward map. Its analytic Jacobian enters the composed derivative, and the forward bridge uses the Newton inverse.
- `projection-remap` (purpose `projection`, used by no other kind): the destination point is unprojected with `destinationProjection` and reprojected with `sourceProjection`. Each is an ideal projection model plus a mapping scale. An example is a rectilinear or equirectangular view resampled from a fisheye capture. Its Jacobian is the analytic chain d(source)/d(direction) · d(direction)/d(destination).

A mapping that uses only `affine` and `radial` keeps `schemaVersion` and model version 0.1.0, and gives identical output, semantic key and Jacobians. Lens-correction profiles parse transforms through the same parser, so they can carry the new kinds too.

`calculateGeometricSamplingPlan()` accepts an optional `sourceProjectionModel`. With it, the captured-FOV and retained-ray angles of a fisheye source use that source's mapping function. Omitting it, or passing `"rectilinear"`, keeps `atan(mm / distance)` exactly.

**Domain barriers.** Raw-channel, reconstructed-linear and processed-output data are separate domains, and a pass cannot cross between them. Compatible contiguous transforms can share one resampling pass. Incompatible groups are kept in the prepared mapping, but a fused pixel pass rejects them. Prepared maps are specific to one frame and time, in seconds from the start of exposure. They imply no averaging over a trajectory and no crop guarantee for a whole video.

**Jacobians and reverse mapping.**

- `calculateComposedGeometricMapping()` returns each component's local Jacobian, and the full product d(source mm)/d(destination mm) with its determinant, singular values and anisotropy.
- `calculateForwardGeometricMapping()` reverses the same mapping for focus, meter and overlay coordinates.

No app should reverse-engineer the warp on its own.

**Rasters.** `GeometricRaster` describes pixel centres with square pitch on an optical plane: +X right, +Y up, rows ordered downward. Raster orientation and crop are explicit affine transforms, not an implicit axis swap. The maximum raster is 65,536 samples and the maximum number of composed transforms is 32. This is a bounded foundation, not a megapixel production renderer.

**Sampling plan.** `calculateGeometricSamplingPlan()` computes exact support at every destination pixel centre for the declared nearest or bilinear filter.

- It keeps a validity mask, and finds the largest axis-aligned rectangle of all-valid pixels using one composed map. Ties are broken deterministically by row and stack order.
- Because it uses one composed map, transforms that pull in opposite directions do not use up the crop margin twice.
- These claims apply to this pixel lattice and filter. The mask does not certify continuous support between pixels.
- Each component's intermediate source point and derivative stay available, so you can inspect margins for a specific feature. Intermediate points are not cropped separately.

The plan reports the physical captured edge FOV from the declared physical projection distance and source bounds. Separately, it reports the angular range of the retained, mapped pixel-centre rays. That range is deliberately not a continuous retained edge FOV. Off-centre capture is preserved.

**Prefiltering.** Singular values multiplied by the destination/source pixel pitch show local sampling compression. Any value above one means the source data must be declared as prefiltered. With `antialias=none`, the plan can still be inspected, but it cannot run a compressing resample. The caller owns the prefilter and must supply data suited to the largest footprint. This module does not implement or certify that prefilter. The filter or profile ID stays separate from the mapping identity.

**Resampling.** `calculateGeometricResampling()` performs one nearest or bilinear pass on a scalar image.

- It returns null where support is invalid. It never extends, copies or mirrors edges.
- Pixel centres exactly on the boundary do not need bilinear neighbours that do not exist.
- It warps blur, bokeh and noise that are already in the image. Stretching cannot create optical detail or recompute a better PSF. The full Jacobian explains how blur and sampling density change locally.

## Generic camera correction profiles

**Resolving a plan.** `resolveLensCorrectionPlan()` resolves each component separately, in the profile's application order. For each, it records why it is on or off: toggled or default, mandatory, required by stabilisation, or required by another component.

- Dependencies can refer only to earlier components, so there are no cycles.
- A required component can override a dependent component's requested Off, with an explicit `component-dependency` reason.
- Mandatory camera corrections cannot be turned off through a camera setting. `reference-bypass` is a separately labelled educational comparison.

**Components.** Each component declares its image domain, identity and version, residual limits, availability and dependencies.

- Supported families: geometry, lateral channel registration and scalar peripheral illumination.
- Separate, unsupported families: colour shading, longitudinal chromatic aberration (CA), and diffraction or deconvolution restoration. (Diffraction correction is not a profile component: `simulateCapture` offers it as a development stage, `output.diffractionCorrection`; see [Sharpening, diffraction correction and their trade-offs](#sharpening-diffraction-correction-and-their-trade-offs-552).)
- RAW-like output keeps the metadata and intent without applying ("baking") the correction. Processed output bakes in the supported downstream operations.

**Peripheral illumination.** `calculatePeripheralIlluminationCorrection()` uses the existing positive, bounded illumination profile, with gain = throughput^(−strength) and strength in [0,1].

- Signal gain is g and variance gain is g². The variance is explicitly before clipping.
- This does not restore photons, and does not restore the capture's true SNR.
- Clipping is reported.
- The residual gain strength does not change the physical lens throughput.

**Applying corrections.** `calculateLensCorrectedCapture()` is a bounded executor for reconstructed linear RGB.

- The capture carries its camera, lens and acquisition state, which must match the profile binding.
- Capture ID, time and noise-realisation ID are kept. The physical source arrays are not modified.
- Common geometry and per-channel lateral CA are composed in reverse application order, and each channel is sampled once.
- All channel masks are intersected before output, so a missing channel never fakes a valid colour.
- A joint crop is resolved over that intersection. Per-channel sampling and crop diagnostics can also be inspected.

**Order rules.** The executor supports geometry/CA followed by gain.

- It rejects geometry placed after an intervening gain, and rejects raw or processed domains, instead of silently reordering stages. Other consumers must follow the resolved profile order through the production pipeline.
- In this executor, gain is defined on the corrected output coordinates. It does not silently reuse an upstream physical field position.
- RAW-like, metadata-only output keeps the original capture geometry and samples.
- For processed output, Off and reference-bypass disable correction transforms and gains. An explicit destination crop or sampling lattice still applies, through the neutral geometric map. If the source and destination lattices are identical, samples are kept without resampling. If the lattice changes, the usual filter, support, crop and prefilter diagnostics are shown.
- Output dimensions must match the exact profile binding.

This replaced an earlier unmerged draft's unconditional Off passthrough; no released API changed.

## Sharpening, diffraction correction and their trade-offs (#552)

Every correction has a cost, and the engine states it. Two development stages joined the three post-capture corrections in #552. Both are opt-in options of `simulateCapture` and off by default: a request without them takes exactly the code path it took before, with the same bytes. The code is in `src/processing/development-detail.ts`; the facade wiring is in `src/facade/simulate-capture.ts`.

### Development order

With these stages the development runs:

1. the development exposure push (#556, `output.exposureCompensationStops`), on the black-subtracted, white-normalized RAW; pushed sites clip at white here
2. demosaic
3. colour and white balance
4. **diffraction correction**, on linear colour
5. rendering exposure and tone curve
6. gamut handling and the sRGB transfer function
7. **unsharp mask**, on the encoded values
8. quantization to integer codes (encode)

The deconvolution acts on linear light, where the optical blur is a convolution. The unsharp mask acts on the encoded values just before quantization, which is where image editors apply it. A linear gain (step 1) commutes with the linear deconvolution except where clipping differs: because the push clips at white before the deconvolution, a pushed highlight is deconvolved as the clipped plateau the push made, exactly as an unpushed capture at the brighter exposure would be. The order is reported in the `output.developmentOrder` assumption, which lists the push first when one is given. The push applies identically on both development paths, `createNativeRawDevelopmentTask` (no detail stage) and `developLinearSrgb` (either detail stage): `test/development-detail-integration.test.ts` checks that a push with an unsharp mask that changes nothing is byte-identical to the push alone, and that a 2-stop push of a quarter exposure with both stages matches the full exposure within noise, with the same clipped highlight.

Both stages filter the whole developed image, so a request with either develops through the native development's own linear operator (`developLinearSrgb`, the same operator as `createNativeRawDevelopmentTask`) and holds the full image in memory, as AHD already does. Image edges are clamped (edge pixels repeated). Neither stage combines with `output.region`, because a region's edge pixels would differ from the whole render; neither is offered by `simulateDisplayView` or `simulateIdealReference`. The DNG holds the native RAW codes and is never modified: a DNG request with both stages writes byte-identical DNG bytes and changes only `image.samples`.

### Diffraction correction (`output.diffractionCorrection`)

It needs `lens.diffraction`: it inverts the blur that option simulates, with the same known PSF.

- **OTF.** An ideal, aberration-free circular pupil at the capture's working f-number N_w = N·v/f (thin-lens image distance v, as `lens.diffraction` uses) has the incoherent OTF H(s) = (2/π)(acos s − s√(1 − s²)) for s = f/f_c < 1 and **H = 0 for s ≥ 1**, with cut-off f_c = 1/(λ·N_w). In output pixels f_c·p = p/(λ·N_w), against the sampling Nyquist frequency 0.5 cycles per pixel.
- **Gain.** G(s) = min(maximumGain, H(s)·(1 + α)/(H(s)² + α)): the Wiener deconvolution filter H*/(|H|² + K) with a constant noise-to-signal power ratio K = α, scaled so that G(0) = 1, and bounded. G(s) = 0 wherever H(s) = 0.
- **Filter.** G is sampled on an M × M grid (M ≥ 64, a power of two, at least 4(2R + 1)), inverse transformed, tapered with a radial raised cosine 0.5(1 + cos(πr/(R + 1))), truncated to (2R + 1)² taps and renormalized to unit DC gain. Each linear channel is convolved with it. The achieved response is then measured over the Nyquist square on a 1/64-cycle grid, never assumed.
- **Options** (all optional): `wavelengthNm` (380–780, default 550, one design wavelength for all channels), `regularization` α (1e-4–1, default 0.01), `maximumGain` (1–10, default 4) and `kernelRadiusPixels` R (1–16, default the Airy third dark ring 3.2383·λ·N_w in pixels).
- **Reported.** The `output.diffractionCorrection` assumption gives the f-number, N_w, the settings, `cutoffCyclesPerPixel`, `nyquistAreaBeyondCutoffFraction`, `designPeakGain`, the measured `responsePeakGain` and `responseMaximumBeyondCutoff`, and `recoversBeyondCutoff: false`. `diagnostics.detail.diffractionCorrection` counts corrected samples below 0 (ringing below black) and above the RAW white level.

**What it cannot do.** Detail beyond f_c never reached the sensor: the OTF there is exactly zero, so no deconvolution can restore it, and the engine never says otherwise. The design gain beyond f_c is 0. The truncated filter leaks a little response there (`responseMaximumBeyondCutoff`, below 1 in every tested case), which passes noise and aliasing only, because the optics delivered no signal at those frequencies. Below f_c the gain is bounded, so attenuated detail is only partly restored and the noise is amplified by up to `responsePeakGain` at the frequencies where the gain is largest. One design wavelength stands in for a polychromatic blur, and longer wavelengths have a lower cut-off than the one used. The pixel aperture, the optical anti-aliasing filter, demosaic blur, defocus and aberrations are not inverted.

### Sharpening (`output.sharpening`)

An unsharp mask with the three controls image editors give it (GIMP, ImageMagick): d = x − G_σ∗x; y = x + amount·d where |d| ≥ threshold, else y = x; then y is clipped to [0, 1] and quantized. It runs per channel on the sRGB-encoded values. G_σ is a separable Gaussian with σ = `radiusPixels` (0–8, default 1), truncated at ⌈3σ⌉ and normalized. `amount` is in (0, 5] (default 0.5); `threshold` is in [0, 1] encoded units (default 0). It runs on the sRGB SDR path only, not with a wide-gamut `output.colorEncoding` or `output.gamutMapping: "perceptual"`.

**What it costs.** It raises contrast at edges by adding a halo on both sides: an overshoot on the bright side and an undershoot on the dark side, each amount·h·Σ(weights across the edge) for a step of height h, about amount·h·(1 − Φ(0.5/σ)) (0.367·amount·h at σ = 1.5). It sharpens noise above the threshold, it can create colour fringes because the channels are sharpened separately, and halos that leave [0, 1] are clipped. It adds no optical detail. `diagnostics.detail.sharpening` gives the kernel reach, the sharpened and threshold-held sample counts, the clipped samples and the largest increase and decrease (the halo strength).

### The trade-offs, measured

Each row is a deterministic test. The numbers are those tests' values, in the stated synthetic setups, not claims about a real lens.

| Correction | Trade-off | Measured | Test |
| --- | --- | --- | --- |
| Distortion (barrel correction, k1 = −0.15, 96 × 64 raster) | Stretching the corners lowers corner resolution | A 0.25 cycle/pixel source grating appears at 0.2495 cycles per output pixel at the centre (local d(source)/d(destination) 0.997) and 0.1855 at the corner (0.752): the corner's finest detail is J·0.5 cycles per output pixel, not 0.5. Bilinear resampling also lowers the modulation of the 0.40 grating to 0.321 at the corner, against 0.398 at the centre | `test/lens-correction-tradeoffs.test.ts` |
| Vignetting (gain 1/(1 − 0.5ρ²), up to 1.66 at the corner) | The gain raises corner noise | Corner noise ×1.285 and corner signal ×1.290 over a 16 × 16 corner patch; centre noise ×1.009. The SNR is unchanged, not improved: the gain adds no photons | same |
| Lateral CA (per-channel registration) | It cannot remove longitudinal CA | Edges registered to within 0.005 px (from 0.61 and 0.40 px apart), but red and blue edges stay wider than green (10–90 %: 2.64 and 3.02 px against 0.80 px; 2.28 and 3.01 px before), because longitudinal CA is a difference in blur, not position. No longitudinal-CA correction component exists | same |
| Sharpening (σ = 1.5, amount 1, step 0.3 → 0.7) | Halos and artificial-looking detail | Overshoot and undershoot of 0.1468 each (0.367·h), as predicted from the Gaussian, spread over the 5-pixel kernel reach; overshoot past 1 clipped and counted | `test/development-detail.test.ts` |
| Diffraction correction (f/16 working, 2 µm pixels, 550 nm; f_c = 0.227 cycles per pixel) | It cannot recover detail lost to diffraction | A grating at 1.375·f_c, amplitude 0.2 in the scene, is 0 after diffraction and still 0 after correction (below 10⁻¹⁵). A grating at 0.55·f_c is restored from 0.337 to 0.820 of its scene contrast, not to 1. In-band noise at 0.15 cycles per pixel is amplified 3.15×; the measured peak response is 3.12 against the bound 4, and the largest response beyond f_c is 0.87 | same |

In the facade, `output.diffractionCorrection` at f/16 on 2 µm pixels narrows the slanted edge's 10–90 % rise from 13.2 to 8.4 pixels, and reports the cut-off it cannot pass.

**Sources.** The circular-pupil OTF and its cut-off: MIT OpenCourseWare 2.71 *Optics* (Spring 2009), lectures 21–22, free at <https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/> (also see Goodman, *Introduction to Fourier Optics*, 4th ed., 2017, §7.3). Wiener deconvolution with a constant noise-to-signal ratio, as a regularized inverse filter: scikit-image `skimage.restoration.wiener` (its licence is recorded in THIRD_PARTY.md), documentation free at <https://scikit-image.org/docs/stable/api/skimage.restoration.html#skimage.restoration.wiener>, after F. Orieux, J.-F. Giovannelli, T. Rodet, "Bayesian estimation of regularization and point spread function parameters for Wiener–Hunt deconvolution", *JOSA A* 27(7), 2010. The unsharp mask's definition and its radius, amount and threshold controls: the GIMP 2.10 manual, "Unsharp Mask", free at <https://docs.gimp.org/2.10/en/gimp-filter-unsharp-mask.html>, and ImageMagick's `-unsharp` option, free at <https://imagemagick.org/script/command-line-options.php#unsharp>. No code was taken from any of them; the engine's implementation, its filter design and its tests are its own.

## Lens corrections in the development (#570)

`output.lensCorrections: { distortion?, lateralColor?, vignetting? }` applies a catalogue lens's generic correction profile (`createGenericLensCorrectionProfile`, #549) to the developed image of `simulateCapture`: the JPEG, the PNG and `image.samples`. Each correction is off unless set to `true`; with all three off (or the option omitted) the development takes exactly the path it took before, with the same bytes. It needs `lens.catalogue` (the profile is the lens's own). The RAW and the DNG are never corrected: a DNG request with every correction on writes byte-identical DNG bytes and changes only `image.samples`. Code: `src/output/developed-lens-corrections.ts` (loaded with the catalogue, on demand); facade wiring in `src/facade/simulate-capture.ts`.

**Order.** It runs on the developed linear colour, after demosaic, colour, white balance and `output.diffractionCorrection` (which inverts a blur on the sensor's own lattice), and before the rendering exposure, the tone curve and `output.sharpening`. The `output.developmentOrder` assumption lists it as "lens corrections (linear)".

**Mapping (inverse, as the profile composes it).** For an output pixel at p (pixels from the frame centre) and channel c, the source point is s = q(1 + k1|q|²/R²) with q = m·a_c·p: k1 the lens's corner distortion (the capture's own r_d = r(1 + k1ρ²)), R the half-diagonal, a_c = 1 + L·D̄_c the lateral-colour scale, D̄_c the channel's effective dispersion: D weighted by the capture's own channel response × its illuminant at the spectral nodes (#589, `calculateChannelEffectiveDispersion`; reported as `channelDispersion` in the assumption; before 2.21.0, D at 610, 540 and 465 nm). Each channel is sampled bilinearly at s, once. A correction that is off uses k1 = 0 or a_c = 1.

**Fill.** Correcting pincushion distortion (and the channel scales above 1) reads beyond the frame near the edges. To keep the output size with no missing pixels, m ≤ 1 is the largest factor that keeps the source of every output pixel centre inside the frame for all three channels (found by bisection over the border pixels; the radial map is monotonic over the frame, so the border bounds every source). The image is magnified by 1/m, reported as `magnification` in the `output.lensCorrections` assumption: 1 for the barrel-distortion wide angles, about 1.017 for *PV 300 5.6*. This is what cameras do with their in-camera corrections; `calculateLensCorrectedCapture` instead leaves the missing pixels empty and reports a crop.

**Vignetting, to a flat field.** The sample is multiplied by det J(ρ_i)/E(ρ_s), the inverse of the relative illumination the capture delivered at the source point: the lens's E(ρ) = (1 − bρ²)² at the sensor point, where the capture applies it as field throughput, and the distortion's area factor 1/det J, det J = (1 + k1ρ_i²)(1 + 3k1ρ_i²) at the ideal point ρ_i that the lens images to ρ_s (Newton's method; [PHYSICS_FOUNDATION.md](PHYSICS_FOUNDATION.md), "Radiometry": the environment applies 1/det(d distorted/d ideal) exactly once, and no cos⁴ term). The lens's own k1 is used whether or not distortion is corrected, because the capture's irradiance carries the area factor either way. This departs from `calculateLensCorrectedCapture` in two stated ways: the gain is evaluated at the source point rather than the corrected output point, and it includes the area factor, which the profile's peripheral-illumination component (E only) does not hold. With E alone at the output point, a *PV 16 2.8* corner would come out about 18 % too bright; with both, a flat field is flat to 0.03 % (measured below).

**Regions and parts.** Every position is computed in whole-frame pixel coordinates. A region render develops the frame pixels its corrected pixels read (the bounding box of the region border's sources over the three channels, with the bilinear neighbours and one pixel of margin, recorded as `developedRect`; `region.nativeRect`, `raw` and `plan` describe it) and then corrects into the region, so its pixels are byte-identical to the same pixels of the whole render. A read outside that rectangle is an engine error, never a silent edge value. `simulateDisplayView` and `simulateIdealReference` do not take the option.

**Cost.** About 1.3 s per 24-megapixel frame on one thread (Apple M5 Pro, Node 24; 0.75 s without vignetting), in addition to the development.

**What it cannot do**, the #552 trade-offs, now measured through the option (`test/simulate-capture-lens-corrections.test.ts`, *PV 16 2.8* at f/2.8, 36 × 24 mm):

| Correction | Trade-off | Measured |
| --- | --- | --- |
| Distortion (k1 = −0.045, 144 × 96 pixels, 48-square checkerboard) | Stretched corners lose resolution | Mean neighbour difference (detail per output pixel) × 0.706 in a 16 × 16 corner patch, × 0.998 at the centre |
| Vignetting (2.16 stops at the corner) | The gain raises corner noise | Uniform field, 96 × 64: corner/centre 0.410 uncorrected, 0.9997 corrected; over an 8 × 8 corner patch the signal rises × 2.44 and the noise (from two noise seeds) × 2.50, so the SNR is unchanged, not improved; centre noise × 0.99 |
| Lateral colour | Registers the channels at one wavelength each; axial colour and colour within a channel's band stay | The kernel matches `calculateLensCorrectedCapture` for distortion and lateral colour to 1e-12 wherever that executor has full support |

The profile's numbers are the lens's own: the test checks k1, the three channel scales and the vignetting coefficients against `createGenericLensCorrectionProfile`. Like the profile, these corrections are labelled approximations of a generic lens, not a measured one. Bilinear interpolation is a low-pass filter, part of the corner loss above.

## Verification and provenance

Tests independently check:

- Gaussian power integration;
- source linearity and admitted fraction;
- response to off-frame sources;
- use of the sensor and noise primitives;
- exact applicability;
- Jacobians against centred differences;
- inverse/forward round trips;
- all quarter-turn orientations and off-centre capture;
- anisotropy;
- linear-ramp interpolation;
- missing support;
- joint crop;
- prefilter gating;
- channel registration;
- RAW intent;
- mandatory, bypass and dependency resolution;
- residual gain, noise and clipping;
- stretching of an already blurred image.

The implementation, test parameters and equations were written independently. No third-party source code, calibration data, numerical tables or protected prose is included. Factual research:

- [ZEISS, Taking care of the unwanted light](https://lenspire.zeiss.com/cine/en/article/taking-care-of-the-unwanted-light): reflection ghosts and unwanted light motivate treating stray paths separately.
- [Canon EOS R5 Mark II manual, Lens Aberration Correction](https://cam.start.canon/en/C017/manual/html/UG-03_Shooting-1_0220.html): noise from peripheral correction, and crop and resolution limits from distortion correction, motivate reporting downstream costs.
- [Sony ILCE-1M2 guide, Lens Compensation](https://helpguide.sony.net/ilc/2440/v1/en/contents/0414M_lens_comp.html): per-component controls, forced distortion correction, and the angle and quality limits of breathing compensation motivate resolved states and explicit costs.

These references justify the scope and distinctions, not the synthetic coefficients. AI-assisted drafts still need substantive human review of science and provenance, and contributor DCO certification under CONTRIBUTING.md and PROVENANCE.md, before inclusion.
