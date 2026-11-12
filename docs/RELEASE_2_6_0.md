# 2.6.0 release candidate

> **Published October 20, 2026.** The owner tagged `v2.6.0` on `26296ef` and published the GitHub release; npm publishing ran from the tag (recorded with the 2.7.0 release preparation, October 24, 2026).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.6.0`, with `ENGINE_API_VERSION = "2.6.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** one new function, `simulateDisplayView`, and two new fields on the framing results; three speed-ups that do not change results. A bundle that imports only `simulateCapture` and `simulateIdealReference` does not contain the display view (#381). Every `simulateCapture` and `simulateIdealReference` request that 2.5.0 accepted gives byte-identical samples, RAW codes and encoded files, apart from the engine version that captures record. The one other difference is the wording of the `output.region` assumption on region renders with `lens.diffraction`. Root exports grow from 1,717 to 1,721 symbols (4 added, none removed).
- **Why now:** applications show a whole sensor frame at a small display size. The 2.5 whole-frame view renders it with giant pixels, so its noise is that of a binned image; `simulateDisplayView` instead gives the image the real full-resolution capture would give after resizing, without rendering it at full resolution. Applications also render Quality previews as regions and whole-frame views, which spent most of their time on work that does not change the image (whole-width convolution bands, rebuilding identical diffraction kernels, re-parsing fixed records of the engine's own chart scenes), and they computed the close-up light loss themselves.
- **Owner decisions (October 19–20, 2026):** "Approve 2.6.0 release prep" (#354, #355, #363, #364); for the display view, "Speed-up first, then release" (#375) and "2.6.0 (Recommended) — … the one release keeps that number and its record is redone to include display view"; "Fix before 2.6.0 (Recommended)": the engine uses its own exactly specified power function so that results are byte-identical on every Node.js version (#376); "Regenerate before 2.6.0 (Recommended)": the 155 display-view validation cases are re-run on the final code (#377). The re-run on the final code missed two limits; the owner chose "Fix it first (Recommended)" on the suspicion that the view's averaging of AHD's two candidates was the cause. Experiments disproved it (#377): one miss came from a single noise realization of the reference, the other from the Quality noise model. The owner then chose "Average 7 seeds (Recommended)" for the validation method (limits unchanged), "Release, fix in 2.7 (Recommended)" for the Quality noise model (#379), and "Add to known limit (Recommended)" for the one remaining miss (case 138).
- **What this release does not claim:** the speed-ups and costs are measured on the hosts named below and are not a promise for every device. The close-up light factor is the ideal thin-lens approximation, not a measured lens. The display view is an estimate of the resized capture, validated against real full-resolution renders within the limits below; it is labelled `kind: "display-view"` and is not a capture. Its bytes are the same on every Node.js version tested, but not yet in every browser (see [Same bytes on every Node.js version](#same-bytes-on-every-nodejs-version-376)). With the Quality options its noise has too much colour where a display pixel covers few sensor pixels: a known limit, with one validation case outside its limit ([Known limit](#known-limit-quality-noise-at-small-footprints-379)).

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| Region renders limit the diffraction convolution to the region (#354) | `simulateCapture` with `output.region` and `lens.diffraction`; `output.region` assumption text | Performance; same values |
| Diffraction kernels reused and built faster (#355) | `createDiffractionLimitedPsfProfile`, and so `lens.diffraction` | Performance; same values |
| Less validation for the engine's own chart scenes (#363) | `simulateCapture` with a chart preset | Performance; same values |
| Close-up light factor (#364) | `closeUpTransmission` and `closeUpLossStops` on `calculateChartFraming` and `calculateSubjectDistanceForFraming` results | Additive fields |
| Display view (#368) | `simulateDisplayView`, `SimulateDisplayViewOptions`, `DisplayViewResult`, `SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS` | Additive (new function) |
| Published sources for the diffraction model (#371, issue #366) | Documentation | Documentation |
| Display view Quality speed-ups (#375) | `simulateDisplayView` | Performance; same values |
| Display view: same bytes on every Node.js version (#376) | `simulateDisplayView` | Last bits of the (unreleased) display view; captures unchanged |
| Docs: a source for the one-arcminute print criterion; Goodman 4th-edition section numbers (#378) | Documentation and comments | Documentation |
| Capture-only bundles leave out the display view (#381, issue #380) | Module layout behind `simulateDisplayView`; shared colour and readout code | Bundle size; same values |
| Display-view validation regenerated on the final code against seven reference seeds (#377) | Documentation, validation script | Evidence |
| Known limit of the display view's Quality noise (issue #379) | `simulateDisplayView` with `output.demosaic: "ahd"` | Documented limit |
| Version 2.6.0 (#367), changelog and this record | — | Release preparation |

Merge commits: #354 `45bcdcb`, #355 `fb66b03`, #363 `3bf431c`, #364 `5c1f1f3`, #367 `e4f495b`, #368 `32f6cf7`, #371 `c92bf9d`, #375 `625a5f9`, #376 `fe04baf`, #378 `ea6dbe7`, #381 `05d24cb`, #377 `6949259`. Nothing else merged after 2.5.0 apart from #353, which recorded the 2.5.0 publication (documentation only). Open engine issues #365 (print planner "contain" fit) and #379 (the Quality noise model, planned for 2.7.0) have no merged code and are not part of this release.

Root exports: the generated `docs/api/exports.json` lists 1,721 names; at `v2.5.0` it listed 1,717. The 4 added names are `simulateDisplayView`, `SimulateDisplayViewOptions`, `DisplayViewResult` and `SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS`; none is removed. The two framing fields are properties of the existing `ChartFraming` and `SubjectFraming` results.

## What changed, with evidence


### Region renders: diffraction limited to the region (#354)

With `output.region` and `lens.diffraction`, the object-space convolution used to cover whole-width bands of 32 native rows, so a small crop of a wide frame paid for the full frame width. The diffracted scene provider now takes the region's native rectangle as a window and convolves only the lattice those sites query: the rectangle plus the anti-aliasing filter and box-aperture offsets, with the kernel radius of real scene radiance around it.

**Why the values cannot change.** The convolution is a direct gather with a fixed tap order and one kernel patch. In the whole render every kept value already has all its taps inside the grid, so a narrower grid that still holds every tap of every kept value gives the same values bit for bit; it only drops values that no query reads. Noise needs no frame-wide state (per-site streams seeded from the capture seed and the absolute native index), and demosaicing, the four-spot filter and the box aperture already read only the region plus its margin.

Tests (`test/simulate-capture-region-diffraction.test.ts`):

- Region against whole-frame crop, byte for byte (samples and native RAW codes), with diffraction, the four-spot filter, AHD and a 2 × 2 box (one 4 × 4 case): centre, two corners, two edges, 1-pixel strips and the full frame; pitches 2, 6, 48 and 250 µm; f/4 to f/16; and a bilinear case without the filter.
- The provider gives bit-identical values inside the window, takes exactly (rows + 2M + 2R) × (columns + 2M + 2R) scene samples, and refuses queries outside the window.

Timings, 192 × 128 centre crop of a 6000 × 4000 frame at 6 µm, Siemens star, f/16, same image hash before and after:

| Options | 2.5.0 (convolution) | 2.6.0 (convolution) |
| --- | --- | --- |
| Local 4-vCPU host, Node 24: diffraction, four-spot, AHD | 60.8 s (50.2 s) | 11.8 s (1.7 s) |
| Local: with a 2 × 2 box as well | 228.7 s (195.8 s) | 39.6 s (6.5 s) |
| GitHub-hosted 4-vCPU runner, Node 24: diffraction, four-spot, AHD | 44.14 s (37.06 s) | 8.32 s (1.37 s) |
| GitHub-hosted runner: with a 2 × 2 box as well | 170.85 s (147.72 s) | 27.66 s (4.93 s) |

Peak memory for the local box case fell from 1,285 MB to 545 MB. The remaining time is per-site work (20 spectral nodes × filter spots × box nodes), which follows the region, not the frame.

### Diffraction kernels reused and built faster (#355)

`createDiffractionLimitedPsfProfile` keeps the 256 most recently used Airy cell tables, keyed by every input of the cells (β = pitch/(λ·N_w), the kernel radius and the scale), and hands out copies, so a caller cannot change a cached table. The frequency-domain quadrature takes cos θ and sin θ from a table computed with the same expressions, which removes two of six transcendental calls per node. The model is the one 2.1 and 2.5 introduced (incoherent OTF of a circular pupil, [MIT OpenCourseWare 2.71, lectures 21–22](https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/), free; real-space encircled energy from [DLMF §10.6(i)](https://dlmf.nist.gov/10.6) and the Hankel expansion [DLMF 10.17.3](https://dlmf.nist.gov/10.17), free); see [PSF foundation](PSF_FOUNDATION.md).

The β ≥ 192 switch to the real-space method stays where it is. The Hankel expansion needs x = π·β/2 ≥ 300 at the innermost cell boundary, so it cannot go below β = 191, and another Bessel method would change today's cells in the last bits.

Tests (`test/diffraction-psf-profile.test.ts`): SHA-256 of the cell bytes at β = 0.4, 12.5, 60, 123.3, 191.9 and 250 are locked against 2.5.0, from the uncached functions and from the cache (first and repeated call); changing a returned copy does not change later results; a repeated profile build takes under a quarter of the first.

Timings (kernel build alone, 20 wavelengths, f/16, radius 1, local 4-vCPU host, Node 24):

| Pitch | 2.5.0 first / repeat | 2.6.0 first / repeat |
| --- | --- | --- |
| 375 µm | 417 / 303 ms | 355 / 2 ms |
| 456.25 µm | 675 / 563 ms | 465 / 2 ms |
| 750 µm | 1,630 / 1,042 ms | 1,370 / 4 ms |
| 912.5 µm | 2,286 / 1,530 ms | 1,648 / 1 ms |

Whole-frame Quality captures (diffraction, four-spot, AHD, f/16) on a GitHub-hosted 4-vCPU runner; "repeat" is a second capture in the same process with a different exposure; same image hashes:

| Case | 2.5.0 first / repeat | 2.6.0 first / repeat |
| --- | --- | --- |
| Full frame 48 × 32 (750 µm) | 2.26 / 1.66 s | 2.13 / 0.76 s |
| Medium format 48 × 32 (912.5 µm) | 2.51 / 1.96 s | 2.17 / 0.67 s |
| Full frame 96 × 64 (375 µm), 2 × 2 box | 6.99 / 6.79 s | 6.90 / 6.47 s |
| Medium format 96 × 64 (456.25 µm), 2 × 2 box | 7.07 / 6.99 s | 6.96 / 6.54 s |

Workers do not share memory, so each worker still builds a frame's kernels once.

### Less validation for the engine's own chart scenes (#363)

For scene results that come from the engine's own chart-scene evaluator, the native environment skips two things: the unknown-key scan of the result record, and re-parsing `uncertainty`, `evidence` and `limitations` when all three are the same objects as an earlier result's that passed the full parse and were found deeply frozen. Every other check still runs with the same helpers, order and messages (shape, schema version, quantity, unit, status, identifiers, wavelength, basis, and a finite, non-negative radiance). Caller scenes and caller providers keep the full validation. The mark is a module-private `WeakSet` on the evaluator function, not exported from the package.

Tests (`test/internal-scene-evaluator.test.ts`):

- An audit wraps the reduced parse and runs the full parse on the same value each time: over 10,000 reduced parses across all 16 chart presets, diffraction with the four-spot filter, 2 × 2 box, AHD and a region, a fixed chart size, a 750 µm pitch and auto white balance, with zero mismatches.
- Caller scenes and caller providers get zero reduced parses; a caller provider with an unknown key on its 500th result is still refused.
- For 18 corrupted inputs the reduced parse throws the full parse's exact message.

Timings on a GitHub-hosted 4-vCPU runner, median of three alternating runs, identical image hashes: the 192 × 128 Quality crop with a 2 × 2 box took 19.41 s instead of 29.28 s, and a 96 × 64 whole-frame Quality capture at 375 µm 4.86 s instead of 7.45 s.

### Close-up light factor (#364)

`calculateChartFraming` and `calculateSubjectDistanceForFraming` results gain:

- `closeUpTransmission` = 1/(1 + m)², with m = v/s the thin-lens magnification at the focus distance: the image-plane irradiance relative to the same lens and f-number at infinity focus;
- `closeUpLossStops` = 2·log₂(1 + m), the same factor in stops.

Science: for an ideal thin lens with unity pupil magnification the image distance is v = f·s/(s − f), so the working f-number is N_w = N·v/f = N·(1 + m), and image-plane irradiance falls as 1/N_w² (the camera equation; [MIT OpenCourseWare 2.71](https://ocw.mit.edu/courses/2-71-optics-spring-2009/), free; the 1/N² dependence of focal-plane exposure, H = 0.65·L·t/N², is in CIPA DC-004-2020 §5.5, free). Both fields come from one internal function, which the scene-to-sensor irradiance also uses for its working f-number with the same arithmetic as before, so the reported factor and the simulated signal cannot drift apart. The docs label it the thin-lens model: real lenses whose pupil magnification is not one differ.

Tests (`test/close-up-light.test.ts`): `closeUpTransmission` equals 1/((1 + m)(1 + m)) from the thin-lens image distance exactly, and `closeUpLossStops` equals −log₂ of it, at 0.4–100 m; with a separate focus distance the factor follows the focus distance; `calculateSubjectDistanceForFraming` agrees with `calculateChartFraming` at its distance; and the mean (code − black) of a uniform 50 % chart from `simulateCapture` at 0.35 m against 50 m matches the ratio of the two transmissions within 0.5 %.

`simulateCapture` results do not gain the field: adding it would change the bytes of every capture result. An application calls `calculateChartFraming` with the capture's sensor, lens and distances, which is the same framing.


### Display view (#368)

`simulateDisplayView(options, view)` takes a `simulateCapture` request (the real sensor's pixel count and pitch) and a display size, and returns the image that capture would give after area (box) resampling in linear light to `view.width` × `view.height`, without rendering it at full resolution. Design, error analysis, validation and sources: [Display view](DISPLAY_VIEW.md).

- **Expected value:** per display pixel, a seeded stratified Monte Carlo average over K × K real pixels (`samplesPerAxis`, default 16), unbiased; for each sampled pixel the expected electrons of the real sites its demosaic reads are exact at the real pitch (spectral response, anti-aliasing offsets, diffraction kernels, with the capture's own query arithmetic). The white-level clip, highlight clip and tone curve act on the pixel's own noise distribution (exact clipped-normal moments plus a first-order Edgeworth skewness term).
- **Noise:** one correlated normal draw per display pixel with the covariance of the area mean of the real pixels' independent site noises (shot, dark, read, ADC), the demosaic's correlation in closed form, each pixel's non-linear residual and the output rounding.
- **AHD:** its two linear candidates with full covariance plus the variance of its per-pixel choice; where a pixel's linear noise exceeds 0.01, a control-variate correction from the engine's AHD steps on drawn flat neighbourhoods, on a shared logarithmic grid of states. Its noise model has a known limit at small footprints ([below](#known-limit-quality-noise-at-small-footprints-379)).
- **Refused** with `InvalidConfigurationError`: `lens.pupilSampling`, `lens.projection`/`distortion`/`vignetting`/`psf`, camera rotation, auto white balance, luminance tone curves, highlight reconstruction and `output.region` (use `view.region`, byte-identical to the same pixels of the whole view).
- **Labelled:** `kind: "display-view"`, a label saying it is not a capture, and `view.*` assumptions stating the definition, the estimator, the noise model, the demosaic treatment and the source capture.

Science: box resampling in linear light (Pharr, Jakob & Humphreys, *Physically Based Rendering*, 3rd ed., §7.8, free; OpenCV `INTER_AREA`, free; Poynton, *Gamma FAQ*, free; W3C CSS Color 4 sRGB, free); stratified sampling and control variates (Owen, *Monte Carlo theory, methods and examples*, §8.4 and §8.9, free); Stein's lemma (Stein 1981, free); propagation of error (NIST/SEMATECH e-Handbook §2.5.5, free); quantization noise Δ²/12 (Bennett 1948, free); the normal distribution function and Gauss–Legendre quadrature (Abramowitz & Stegun 26.2.17 and 25.4.29, free); photon transfer (EMVA 1288 Release 4.0, free); AHD (Hirakawa & Parks 2005); slanted-edge MTF (Burns 2000, free); SSIM (Wang et al. 2004, free).

Tests (`test/display-view.test.ts`): the expected signal of real sites against the engine within 1e-9; the expected value against the box-downsized full-resolution capture (uniform, step wedge, dead leaves, slanted edge, AHD at about six electrons per site, clipped highlights, a tone curve) within stated limits plus three standard errors; region renders byte-identical to the whole view; refusals; and one set of hash locks for six requests (below).

### Display view Quality speed-ups (#375)

Two exact speed-ups, with every display view unchanged at the time (samples, expected values, noise and diagnostics, checked for all 155 validation requests and locked for six): the AHD correction states are kept and shared across display pixels and across calls with the same inputs (at most 65,536 states for each of the 4 most recent input sets, about 50 bytes each), and are about 3× cheaper to compute; the per-site diffraction sums keep their tap order but are shared (lattice materials looked up once per display row, one-material sites from a precomputed sum, site values carried between neighbouring display pixels). On a 4-vCPU Xeon the 12 MP phone at 1.4 µm with the Quality options took 49.7 s instead of 222 s at 96 pixels wide and 106 s instead of 450 s at 384 wide (Siemens star, f/8, ISO 100). Speed was unchanged. Details: [Display view, "Exact speed-ups"](DISPLAY_VIEW.md#exact-speed-ups).

### Same bytes on every Node.js version (#376)

ECMA-262 makes `+ − × ÷` and `Math.sqrt` correctly rounded but leaves `**`/`Math.pow`, `exp`, `log`, `cbrt`, `cos` and the other transcendental functions implementation-approximated (§21.3.2). Node 22 (V8 12) and Node 24 (V8 13) differ in the last bit of about 10 % of `x ** (1/2.4)` and of integer powers such as `λ ** 5`, so the display view as merged in #368 gave different bytes on the two.

The display view now uses only correctly rounded operations and new internal functions in `src/core/portable-math.ts` (not exported from the package): logarithm, exponential, power, cube root, e^x − 1, and cosine and sine of 2πu. Methods: double-double arithmetic (TwoSum, Knuth, *TAOCP* vol. 2, §4.2.2; FastTwoSum and TwoProduct with Veltkamp splitting, Dekker 1971); table-driven logarithm with the atanh series and 2^t by its Taylor series after additive range reduction (J.-M. Muller, *Elementary Functions: Algorithms and Implementation*, 3rd ed., 2016, ch. 11); Halley and Newton steps with an exact residual for the cube root. Error bounds: within 1 ulp (2 for e^x − 1, cos and sin), checked against 60-digit decimal references on 2·10⁵ arguments per function (largest errors 0.50–0.97 ulp, 1.59 for cos and sin, 1.66 for e^x − 1). They replace the display view's sRGB encoding, normal density, Box–Muller and Poisson draws, CIELAB cube root and correction grid; opt-in portable variants (default off) evaluate the engine's illuminant formulas (Planck's law, CIE A, the daylight locus), the scene-illuminant and Kelvin white balance and a step wedge's levels for the view.

Evidence: the six hash-locked display views give one set of hashes on Node 22.13.0, 22.22.0, 24.21.0 and 26.12.0 (V8 12, 13 and 14), and 156 further requests (three sensors, Speed and Quality, six charts, four exposures, other illuminants and white balances, a tone curve, mirror borders, a composite chart, automatic exposure) hash identically on Node 22.13.0, 24.21.0 and 26.12.0. A digest of 49,152 portable-function results is identical on those Node versions, Chromium 141 and 153 and Bun 1.4 (JavaScriptCore). The cost: Speed is unchanged within run-to-run spread; Quality takes up to about a quarter longer on small pixels (phone star at 96 wide 47.5 → 60.2 s, at 384 wide 97.2 → 114.6 s; full frame at 384 wide 27.0 → 28.2 s; one run each).

**Finding, not changed in this release: captures are not engine-portable either.** Capture sRGB codes are rounded from `1.055·x ** (1/2.4) − 0.055`: 57 of the 255 8-bit and 14,968 of the 65,535 16-bit code boundaries sit 1–2 ulps apart on Node 22 and Node 24, so a linear value exactly there gets codes one apart (x = 0.0031883009044305316 gives 8-bit code 10 on Node 22.13.0 and 11 on Node 24.21.0); Planck's `λ ** 5` and other powers also differ in the last bit. No tested capture hits such a boundary: the fingerprint of 15 default-path results and every capture hash lock are identical on Node 22, 24 and 26. In browsers whose `Math` differs, the capture's continuous results already differ in the last bits (diffraction kernels in Chromium 141 and 153 and Bun; the metered luminance in Chromium 153), while the image samples of every tested case were identical. The display view takes the sensor's spectral response, the colour-matching fit, the diffraction kernels and the chart geometry from that capture code, so in those browsers its expected values and noise differ in the last bits too. Making captures portable would change capture bits, which the 2.x guarantee rules out without an owner decision; it is a candidate for a later release.

### Published sources for the diffraction model (#371, issue #366)

Documentation only: the quick start's `lens.diffraction` notes and its "Sources" list cite the scalar Fraunhofer diffraction and Airy pattern model the engine follows (Born & Wolf, *Principles of Optics*, 7th ed., §8.5.2; Goodman, *Introduction to Fourier Optics*, 4th ed., §4.4 and §7.3; Wyant & Creath 1992, §II, free; MIT OpenCourseWare 2.71, lectures 21–22, free; NIST DLMF §10.6(i), 10.17.3, §10.17(iii) and 10.9.2, free; Airy 1835). `docs/PSF_FOUNDATION.md` cites §7.3 of Goodman's 4th edition (it said §6.3, the 3rd edition's numbering); #378 corrected the same reference in a source comment.


### Documentation: a source for the one-arcminute print criterion; Goodman section numbers (#378)

Documentation and comments only. The print planner's documentation (`calculatePrintPlan`, `calculatePrintSizeLimit`, `docs/PRINT_PLANNING.md`, the quick start's "Sources") cites Z. Alomar, K. D. Bojikian, ["Visual Acuity Testing in Adults"](https://eyewiki.aao.org/Visual_Acuity_Testing_in_Adults), EyeWiki, American Academy of Ophthalmology (last edited June 16, 2026; free to read), for the one-arcminute-per-pixel rule of thumb: the minimum angle of resolution of an ideal eye under optimal conditions is about 1 minute of arc, and 20/20 letters are built from elements that each subtend 1 arcmin. The text keeps the approximation label and says that one arcminute is normal (20/20) acuity under optimal conditions, which some viewers exceed and many do not; the planner assumes no acuity value. Citations of Goodman, *Introduction to Fourier Optics*, 4th ed. (2017), were checked against the publisher's table of contents (Macmillan Learning, ISBN 9781319119164): the incoherent transfer function is §7.3 (a comment said §6.3) and incoherent imaging as a linear system is §7.1, "Generalized Treatment of Imaging Systems" (two comments and `docs/WEBGPU.md` said §6.1, which is the thin lens in the 4th edition).

### Capture-only bundles leave out the display view (#381, issue #380)

As merged in #368–#376, `facade/simulate-capture.ts` imported the display view at the top level, and the shared illuminant, white-balance, chart, scene-radiance and readout code chose the display view's portable functions with a boolean, so a bundle of an application that only captures contained the display view (about 63 kB minified) and the portable functions. #381 moves `simulateDisplayView` and its renderer to `facade/simulate-display-view.ts`, which hands the renderer to the shared request path (`runCapture`); the shared code takes the portable functions, or the portable spectrum constructors, as arguments; the portable sampler's constant is computed on first use; and the portable functions' tables are built by expressions marked pure. The capture expressions are unchanged.

Sizes with rolldown 1.2.9 (the bundler Vite uses), minified ESM, from each build's `dist`:

| Consumer imports | 2.5.0 | before #381 (`ea6dbe7`) | 2.6.0 (`05d24cb`) |
| --- | --- | --- | --- |
| `simulateCapture`, `simulateIdealReference` | 774,225 B / 205,841 B gzip | 820,912 / 224,431 | 779,884 / 208,090 |
| `calculateChartFraming` | 12,762 / 4,265 | 15,171 / 5,362 | 13,914 / 4,708 |
| `simulateDisplayView` | — | 820,860 / 224,416 | 822,667 / 225,572 |

The capture-only bundle keeps only `portableHypot` and `equalWithinUlps` of the portable functions, as in 2.5.0; its remaining 2.2 kB gzip over 2.5.0 is this release's capture changes (#354, #355, #363, #364). The framing bundle's 0.44 kB gzip over 2.5.0 is the close-up light factor (#364).

Evidence: the 15-result facade fingerprint and extra captures, ideal references and display views through every changed path (Planckian, CIE A and daylight illuminants, Kelvin and scene-illuminant white balance, step wedges, AHD with diffraction, low light, a composite chart) hash identically before and after; all 155 validation views hash identically (samples, whole result, internals); every hash lock passes. `test/capture-bundle.test.ts` bundles a capture-only consumer with rolldown and checks that the display view and the portable functions are absent (and present when `simulateDisplayView` is imported); it fails on the code before #381. `rolldown` (MIT, already installed with Vitest) is a declared development dependency, recorded in `THIRD_PARTY.md`.

### Display-view validation against seven reference seeds (#377)

All 155 cases of `scripts/validate-display-view.mjs` (three sensors, five charts and uniform patches, f/2.8–f/16, ISO 100–6400, 96–800 pixels wide, Speed and Quality) were re-run on `ea6dbe7`; the display views of `05d24cb` are byte-identical to it in all 155. Record: `docs/validation/display-view-2026-10-19/`; method, limits and results: [Display view](DISPLAY_VIEW.md#validation).

**Method change.** Each reference block is rendered at `sensor.noiseSeed` 1 to 7 and every reference-side metric is the mean of the seven (standard deviations: the root of the mean variance); the view is rendered once, at the request's default seed. One realization of the reference varies too much for the limits: on the 100 MP sensor at 800 pixels wide its slanted-edge MTF50 ranged 0.521–0.554 cycles per display pixel over the seven seeds (standard deviation 2.1 %), so two single realizations differ by about 3 %, the size of the MTF50 limit. The limits are unchanged. The run took 3 h 27 min on 4 vCPUs.

**Results.** Every case passes every limit except case 138, a documented miss of the known limit below:

- mean error per channel: all 465 channel tests within max(0.5 code, 3 standard errors);
- expected value at ISO 100, with the reference's noise taken out: RMS at most 0.81 code on edges, bars, dead leaves and grey steps and 1.9 codes at star centres;
- MTF50 of the slanted edge at ISO 100: −2.7 % to +2.2 % (Speed) and −1.0 % to +1.2 % (Quality), limit 3 %; the 100 MP Quality case at 800 wide is −0.9 % (it was −4.4 % against seed 1 alone, whose reference was the sharpest of the seven);
- SSIM at ISO 100 at least 0.9904 away from star centres (0.987–0.998 there, where the Monte Carlo error is largest);
- false colour at ISO 100 within 0.5 code except star centres; the largest are +0.48 (case 92) and +0.41 (phone, Quality, bar groups at 384 wide);
- noise, predicted ÷ reference: 0.93–1.06 (Speed) and 0.89–1.16 (Quality); the one value outside 0.85–1.15 is case 138.

### Known limit: Quality noise at small footprints (#379)

With the Quality options (`output.demosaic: "ahd"`) the display view's noise has too much colour where a display pixel covers few sensor pixels. The noise model treats each output camera channel as driven only by sensor sites of its own colour, with the bilinear kernels' correlation; AHD forms red and blue from directional green plus interpolated colour differences, so they read green sites as well and share noise with green. Over a large footprint those green weights sum to zero; over a small one they do not, and AHD's noise-driven, 3 × 3-correlated choice between its candidates changes the covariance further. The expected value is not affected, and Speed (bilinear) is exact.

Measured on the 12 MP sensor at 1.4 µm shown 800 pixels wide (5 × 5 real pixels per display pixel):

- uniform 18 % grey, ISO 100: predicted noise 1.08 / 1.08 / 0.95 of the resized capture's (R / G / B); pooled over 12 noise seeds, R − G noise +9 % and B − G +15 %;
- **case 138**, uniform 18 % grey, ISO 6400: predicted ÷ reference R 1.164, G 1.133, B 1.030, outside the 0.85–1.15 limit (the limit is unchanged; a documented known-limit miss by the owner's decision of October 20, 2026);
- **case 92**, slanted edge, ISO 100: R − G +9 %, B − G +18 %; false colour +0.48 code against the 7-seed reference mean (limit 0.5), +0.49 ± 0.05 over seven view and reference seeds; with the reference's own noise added to the view's expected image, +0.04.

On the 6 µm and 3.76 µm sensors, and on the 1.4 µm sensor at 384 pixels wide or less, the predicted noise is within 0.89–1.08. A redesign of the Quality noise model is planned for 2.7.0 (#379), with case 138 and case 92 as its acceptance cases.

## Compatibility

- **Additive:** `simulateDisplayView` with `SimulateDisplayViewOptions`, `DisplayViewResult` and `SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS` (root exports 1,717 → 1,721; none removed), and two fields on the framing results.
- **Byte-identical for every capture and ideal-reference request 2.5.0 accepted:**
  - A fingerprint of 15 default-path results, taken on this candidate, matched `v2.5.0` byte for byte once the engine version is normalized (41 occurrences in each, the only difference), on Node 22.13.0, 24.21.0 and 26.12.0. It covers 12 `simulateCapture` requests and 3 `simulateIdealReference` requests, and each result is compared whole: samples, RAW codes, encoded bytes, assumptions, plan, request, exposure, scene digest, diagnostics (timings zeroed) and provenance.
  - Every existing hash lock passes unchanged, together with the new diffraction cell-byte locks (#355). The DNG locks write the Software tag's engine version back to their locked name, so the version bump needs no test change.
  - The region identity tests (`test/simulate-capture-region.test.ts`, `test/simulate-capture-region-diffraction.test.ts`) pass: regions stay byte-identical to the same pixels of the whole render.
  - The display view's portable variants are opt-in internal paths; with them off (every capture), the illuminant, white balance, chart, Poisson and normal code computes the same expressions as in 2.5.0.
- **Known text change (#354):** on a region render with `lens.diffraction`, the last sentence of the `output.region` assumption now reads "With lens.diffraction the object-space convolution (when it applies) covers only the lattice the region's native sites query (plus the kernel radius), in bands of at most 32 native rows; its values are the whole render's." instead of "With lens.diffraction the object-space convolution runs over whole-width bands of 32 native rows that the region touches." Its samples, RAW codes and files are unchanged. Region renders without diffraction, and all renders without a region, keep the 2.5.0 text.
- **`createDiffractionLimitedPsfProfile`** returns the same values; a repeated call in the same JavaScript realm returns copies from its cache.
- **Engine portability** is unchanged from 2.5.0 for captures (see the finding under #376); the display view is new.
- **Module layout (#381):** `simulateDisplayView` is exported from the package root as before; it is now defined in `facade/simulate-display-view.js` rather than `facade/simulate-capture.js`. Deep imports are not a supported surface (`docs/API_REFERENCE.md`), and the function was never published from the old path. The shared illuminant, white-balance, chart and readout functions keep their exported signatures; only internal parameters changed from a boolean to the portable functions themselves.

## Rights and licensing

The print planner's documentation cites, and paraphrases, a free-to-read reference page (EyeWiki, American Academy of Ophthalmology); no text is copied from it. No third-party code, data or constants are added: the portable functions use textbook methods (Dekker 1971; Knuth; Muller) with constants computed here (ln 2, log₂ e, 1/k!, (2π)^k/k!, 2/(2k + 1) by decimal arithmetic; a least-squares start for the cube root), and the display view's methods are cited above. Dependencies: `rolldown` 1.2.9 (MIT) becomes a declared development dependency for the bundle test (#381); it was already installed with Vitest, so `package-lock.json` gains no package, and it is recorded in `THIRD_PARTY.md`. No runtime dependency; the published package still declares none.

## Privacy and security

No network, persistence or telemetry is added. Two in-memory caches per JavaScript realm hold only values computed from numeric inputs: the diffraction kernel cache (at most 256 tables, about 2.2 MB; it hands out copies) and the display view's AHD correction states (at most 65,536 states for each of the 4 most recent input sets, about 50 bytes per state, 13 MB at most). The reduced scene-result parse applies only to the engine's own evaluator, identified by a module-private mark that callers cannot set; caller scenes and providers keep the full validation.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.6.0 changes merged with their changelog entries (#354, #355, #363, #364, #368, #371, #375, #376, #377, #378, #381).
- [x] Display-view validation regenerated on the final code with seven reference seeds (#377); one documented known-limit miss (case 138, #379).
- [x] Version surfaces aligned at 2.6.0 (`npm run release:prepare -- 2.6.0`, #367); API reference regenerated (1,721 root symbols; 4 added, none removed).
- [x] Owner's review of this record.
- [x] Green CI on this pull request, then on `main` after merge.
- [x] **The owner's explicit approval to tag `v2.6.0`.**
- [x] After publication: npm version, dist-tag and integrity recorded below; GitHub release notes published; publication dates updated in `CHANGELOG.md` and `SECURITY.md` and this record (October 24, 2026). Provenance was not re-verified then. `README.md` already describes the 2.7.0 candidate.

## Publication

Recorded on October 24, 2026, from GitHub and the npm registry. The provenance and the tarball contents were not re-verified at that time.

| Fact | Value |
| --- | --- |
| Tag | `v2.6.0` → `26296efead527a5f6c71058d15a3e49b0bb9aa96` (#382) |
| GitHub release | [@photivra/engine 2.6.0](https://github.com/Photivra/engine/releases/tag/v2.6.0), published 02:31:35 UTC |
| Publish workflow | [Publish npm run 23](https://github.com/Photivra/engine/actions/runs/39359393612), passed (last updated 02:39:59 UTC) |
| npm | `@photivra/engine@2.6.0`, dist-tag `latest`, registry time 02:42:35 UTC |
| Integrity | `sha512-UeD6orBQGVYfIe+JgTDFcHkkszPgPYyqS8ZvEso2fAzcpzq2RzzSFOlGwzsGU5cFLFNGI0zx12ckWqkPGgaT3A==` (shasum `cfb921b2277946332be262095c61e4c55be15e89`, 846 files) |
