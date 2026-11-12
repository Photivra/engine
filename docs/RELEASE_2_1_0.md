# 2.1.0 release candidate

> **Published October 17, 2026.** The owner tagged `v2.1.0` on `8b17468` and published the GitHub release; npm publishing ran from the tag. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.1.0`, with `ENGINE_API_VERSION = "2.1.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** every change is additive and opt-in, or a fix. Captures that use none of the new options are byte-identical to 2.0.0. No root export is removed, and no input that 2.0.0 accepted is rejected.
- **Why now:** the owner asked for these fixes before more app work. They came from building the Photivra app's Image Quality screen: diffraction blur, cleaner colour on sharp edges, and prompt cancellation in a browser worker. The owner's rule of October 17, 2026 applies: slow but physically meaningful features become opt-in settings with a measured cost, never omissions.
- **What this release does not claim:** calibrated accuracy for any real camera, lens or sensor. The diffraction model is ideal, scalar and aberration-free, and the anti-aliasing filter is an idealised point splitter; both are labelled approximations.

## Scope

| PR | Change | Kind |
| --- | --- | --- |
| [#331](https://github.com/Photivra/engine/pull/331) | Captures see a cancel promptly in Web Workers (the host yield no longer uses `scheduler.yield()`) | Fix (scheduling only; output byte-identical) |
| [#332](https://github.com/Photivra/engine/pull/332) | `createDiffractionLimitedPsfProfile`, `lens.diffraction` with a fast object-space convolution, `output.demosaic: "ahd"` | Additive, opt-in |
| [#333](https://github.com/Photivra/engine/pull/333) | `sensor.antiAliasing`, per-run cost diagnostics, cost table | Additive, opt-in |
| This update | Version 2.1.0, changelog and this record | Release preparation |

Root exports grow from 1,668 to 1,677 symbols. Comparing the generated `docs/api/exports.json` with `v2.0.0` shows none removed.


## Fixed: `simulateCapture` cancellation in Web Workers

**Problem.** 2.0.0 (#328) made the capture facade yield to the host with `scheduler.yield()` first, to avoid the browser's ≥ 4 ms clamp on nested `setTimeout(…, 0)`. In a module Web Worker that cancels a capture by posting a message that aborts its `AbortSignal`, the message was not handled until the capture finished.

**Cause, from the specification.** WICG, *Prioritized Task Scheduling* (Community Group draft, https://wicg.github.io/scheduling-apis/; source checked at WICG/scheduling-apis commit `0e7fece`, W3C Software and Document License):

- `scheduler.yield()`: "The priority of the continuation … [is] inherited from the originating task. … If the originating task did not have a priority, then "user-visible" is used." (§ The `Scheduler` Interface).
- "Continuations have a higher effective priority than tasks with the same TaskPriority." A user-visible continuation has effective priority 3, above a user-visible task (2) (§ Task and Continuation Priorities; effective priority table).
- The event-loop patch leaves the choice between scheduler and other task queues implementation-defined, but states the intent that "user-visible" continuations "are typically considered to be more important" than most other event loop tasks, and suggests running effective priority 3 and above "higher than most other task sources" (§ Event loop: processing model, note).
- The explainer (`explainers/yield-and-continuation.md`, "Preventing Task Starvation by Continuations") names the starvation risk and proposes only a duration bound, "e.g. schedule the next continuation as a normal task after one second of recursive continuations"; its "denylist" sketch lists self-directed `postMessage()` and `MessageChannel` among sources continuations may run ahead of.

A capture yields every ~8 ms, so the continuations keep the worker's `message` task from running.

**Fix.** `src/facade/host-yield.ts` yields with a `MessageChannel` message first, else `setImmediate`, else `setTimeout`; `scheduler.yield()` is no longer used. A `MessageChannel` message is a new task on the HTML posted message task source, the same source as worker and port `message` events (WHATWG HTML, § Web messaging / § Task sources, https://html.spec.whatwg.org/multipage/), and tasks of one source run in queue order, so a cancel queued before the next yield runs first. Timers are not involved, so the 4 ms nesting clamp (WHATWG HTML, § Timers) does not apply. This is the only place in `src/` that picks a host yield mechanism; the other tasks await the caller's `yieldControl`.

**Evidence.**

- Output unchanged: yields change scheduling only. The five hash locks and the `simulateCapture` digest baseline (`test/simulate-capture-integration.test.ts`) pass unchanged. Built `dist` digests (SHA-256 of image samples, RAW codes and JPEG bytes; 24 × 16 sRGB and 16 × 16 JPEG captures) are identical for 2.0.0 taking its `scheduler.yield` path (a `scheduler.yield` shim in Node) and this change: `a4788e54b93e4d69…`, `b2177454c2e5b9ea…`.
- Regression tests (fail on 2.0.0, pass now): `test/host-yield.test.ts` ("does not starve queued tasks when the host's scheduler.yield runs continuations first": a fake `scheduler.yield` that resolves on microtasks only; a queued `MessageChannel` message must run within 2 yields) and `test/simulate-capture.test.ts` ("sees an abort queued as a separate task even when the host has a continuation-priority scheduler.yield": an abort queued with `setTimeout` after the first RAW tile must stop the capture within 4 tiles; on 2.0.0 the capture completes).
- Chromium 141.0.7390.37 (headless, Playwright), module worker, 4-vCPU Intel Xeon 2.80 GHz, built `dist` of origin/main vs this change. A 128 × 128 capture starts; after 100 ms the page posts a cancel and a 16 × 16 request. Three rounds:

| Build | 128 px run | 16 px result after cancel |
| --- | --- | --- |
| 2.0.0, `scheduler.yield` present | completed, 258 tiles, 2.12–2.34 s | 2.13–2.35 s |
| 2.0.0, `scheduler` hidden (MessageChannel path) | aborted after 1 tile | 0.17–0.21 s |
| this change | aborted after 1 tile | 0.15–0.20 s |

  Uncancelled 128 × 128 capture, six alternating rounds: median 2.17 s (2.0.0) vs 2.16 s (this change), within run-to-run spread (1.97–2.50 s); no throughput change.

## Added: diffraction and AHD demosaicing in `simulateCapture`

**Problem.** By default `simulateCapture()` applies no lens PSF, so the aperture changed only exposure, never sharpness; and with no optical blur the bilinear demosaic showed strong zipper and false colour on sharp chart edges. The only way to add blur was a caller `lens.psf`, and no engine function built a sampled profile for a diffraction-limited lens. The per-tap PSF path was also slow: 13.1 s for a 48 × 48 capture at f/8 with 9 × 9 kernels.

**Change.** `createDiffractionLimitedPsfProfile` (new root export), `lens.diffraction` and `output.demosaic: "ahd"` in the facade (opt-in), and an object-space convolution execution of the diffraction (`src/facade/diffraction-provider.ts`). The anti-aliasing (optical low-pass) filter, first investigated here and left out, is added below as `sensor.antiAliasing`.

### Science evidence: diffraction-limited PSF

- **Model.** Scalar Fraunhofer diffraction of an ideal, uniformly lit circular pupil: the incoherent OTF is the normalized pupil autocorrelation H(ρ) = (2/π)(acos ρ − ρ√(1 − ρ²)), ρ = f/f_c, f_c = 1/(λN_w), and the intensity PSF (the Airy pattern, first dark ring at 1.21967·λN_w) is its Fourier transform. Source: [MIT OpenCourseWare 2.71 Optics, Spring 2009, lectures 21–22](https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/) (free). Also see: Goodman, *Introduction to Fourier Optics*, 4th ed., 2017, §6.3. The pupil diameter is D = f/N and the pupil-to-image distance the thin-lens image distance, so N_w = N·v/f (1.0101·N at 5 m with 50 mm), the same convention `docs/PSF_FOUNDATION.md` gives for the complex-pupil evaluator.
- **Cell integration.** Each kernel sample is the PSF energy in a square cell of side p (the site pitch in the facade): K(i, j) = p²∫∫ H·sinc(p f_x)·sinc(p f_y)·cos(2πp i f_x)·cos(2πp j f_y) d²f, evaluated in polar coordinates (trapezoid in angle, Gauss–Legendre in t with ρ = 1 − t²). All cells together hold exactly 1 (Parseval), so the energy outside the window is 1 − ΣK. Gauss–Legendre nodes from Newton's method on the Legendre polynomials ([DLMF §3.5(v)](https://dlmf.nist.gov/3.5#v), free).
- **Labelled approximations.** Scalar (no polarization); aberration-free; uniform pupil; exactly in focus; thin lens with unity pupil magnification; the on-axis PSF used across the field (isoplanatic); PSF energy binned into cells; the Airy tail outside the (2R+1)² window (2–5 % of the energy with the facade's default window to the third dark ring) is reported per wavelength and put back by unit-sum renormalization, which slightly raises low-frequency contrast. The pixel aperture is not modelled (sites are sampled at their centres, as before). Not a measured lens.
- **Verification** (`test/diffraction-psf-profile.test.ts`). Node counts doubled change no cell by more than 1e-13 (measured 9e-17 to 6e-15 at β = p·f_c = 0.2, 1.35, 3.9). Cell energies match an independent real-space integration of the Airy pattern ([2J₁(z)/z]² from the J₁ power series, 6 × 6 sub-cells of 16² Gauss points) within 2e-10, and the engine's own `calculateIdealPolygonDiffractionPsf` in its 1024-blade circular limit within 1e-6. Kernels are unit-sum, symmetric and positive; the captured energy grows with the window; profiles parse and resolve at any field point.

### Equivalence and speed of the object-space convolution

- **Argument.** The environment PSF quadrature computes E(q, λ) = Σ_k K_λ(k)·T·L(s_k(q), λ). In the facade the radiance-to-irradiance factor T is the same at every sensor point (paraxial π/(4N_w²), no cos⁴ term), and with kernels sampled on the site pitch every tap source s_k(q) is another site centre, seen through one linear map when the camera is still and there is no projection, distortion or field throughput. The sum is then T·(K_λ ⊛ L) on the site lattice: the same terms in a different order. `calculateIrradianceConvolution` (kernels from `resolveLensPsfConvolutionKernels`, exact site sampling) computes it once per spectral node over the native raster plus the kernel radius, in 32-row bands; the provider answers each site query from it and the site inputs declare no PSF. A query off the lattice is refused, and the facade keeps the per-tap path when rotation, a lens field mapping or vignetting is present.
- **Tests** (`test/simulate-capture-optics.test.ts`). Expected generated electrons at every site of 10 × 8 captures at f/16 (15 × 15 kernels) agree with the per-site engine using `request.diffraction.psf` and the plain scene provider to a relative 1e-12 (measured ≤ 1.2e-15) for the slanted edge and point grid; RAW codes equal those of the facade's per-tap path. Where a chart boundary passes exactly through the site lattice (the checkerboard's u = ±0.5 column at that frame size, the Siemens star's diagonals, the grey-ramp steps) a tap on the boundary picks its material by the last bit of its coordinate, which the two paths compute in different orders; measured differences there reach 1.4 % (checkerboard) and 55 % (star centre). This is point-sampling ambiguity of the scene, which neither path resolves, not a difference in the optics.
- **Timing** (4-vCPU Intel Xeon 2.80 GHz, Node 24, built `dist`, median of 3): 48 × 48 slanted edge at f/8 with diffraction: per-tap 13.1 s, object-space 0.56 s.

| Chart | Output | f | default (s) | diffraction | AHD | both |
| --- | --- | --- | --- | --- | --- | --- |
| slanted edge | 48 × 48 | f/4 | 0.45 | 0.49 | 0.62 | 0.68 |
| slanted edge | 48 × 48 | f/8 | 0.41 | 0.53 | 0.48 | 0.69 |
| slanted edge | 48 × 48 | f/16 | 0.40 | 0.71 | 0.48 | 0.84 |
| slanted edge | 128 × 128 | f/4 | 2.28 | 2.59 | 2.40 | 2.85 |
| slanted edge | 128 × 128 | f/8 | 2.18 | 2.79 | 2.44 | 3.12 |
| slanted edge | 128 × 128 | f/16 | 2.20 | 3.43 | 2.52 | 4.00 |
| Siemens star | 48 × 48 | f/4 | 0.38 | 0.62 | 0.63 | 0.60 |
| Siemens star | 48 × 48 | f/8 | 0.38 | 0.50 | 0.51 | 0.66 |
| Siemens star | 48 × 48 | f/16 | 0.38 | 0.66 | 0.51 | 0.87 |
| Siemens star | 128 × 128 | f/4 | 2.14 | 2.49 | 2.43 | 2.76 |
| Siemens star | 128 × 128 | f/8 | 2.18 | 3.10 | 2.54 | 3.17 |
| Siemens star | 128 × 128 | f/16 | 2.20 | 3.35 | 2.40 | 3.78 |

  The convolution of a band runs inside one provider call (no host yield inside it); at 128 × 128, f/16 a band takes roughly 0.3 s.

### Sharpness now falls with f-number

128 × 128 captures, exposure held constant (shutter (N/8)²/125 s), bilinear demosaic, linear luminance of the decoded sRGB output. Edge width: median 10–90 % rise per row of the 5° slanted edge. Star modulation: (p95 − p5)/(p95 + p5) of the luminance on a circle of the 36-cycle star. Last column: the Airy OTF at 550 nm at the star's frequency at that radius, for comparison only (the measurement also includes demosaicing, point sampling, the window renormalization and the 380–780 nm spread).

| f-number | diffraction | edge 10–90 % (px) | star modulation, r = 48 px (8.4 px period) | r = 24 px (4.2 px period) | Airy OTF at 550 nm (r = 48 / 24) |
| --- | --- | --- | --- | --- | --- |
| f/4 | off | 1.49 | 0.882 | 0.625 | — |
| f/4 | on | 1.56 | 0.867 | 0.597 | 0.944 / 0.888 |
| f/8 | off | 1.49 | 0.882 | 0.625 | — |
| f/8 | on | 1.69 | 0.828 | 0.550 | 0.888 / 0.776 |
| f/16 | off | 1.49 | 0.882 | 0.625 | — |
| f/16 | on | 2.73 | 0.743 | 0.389 | 0.776 / 0.559 |

Without diffraction the sharpness does not depend on the aperture; with it, the edge widens and the star loses contrast monotonically with f-number, in the direction and rough proportion the Airy OTF predicts. These are measurements of the synthetic model, not of a real lens.

### AHD demosaic

`output.demosaic: "ahd"` normalizes the RAW sites exactly as the native development kernel (flagged or white-level sites are 1), demosaics them with the existing `createAhdDemosaicTask` (Hirakawa & Parks, *IEEE Trans. Image Processing* 14(3), 2005; method as documented in `docs/PROCESSING.md`) with the homogeneity measured on white-balanced colour, then applies the native development's colour operator (`developInto`) and SDR kernel. A 5-site rendered margin keeps every output pixel off the mirrored plane edge. Mean false colour |R − G| + |B − G| (8-bit codes) on neutral charts at f/8:

| Chart | Output | bilinear | AHD | bilinear + diffraction | AHD + diffraction |
| --- | --- | --- | --- | --- | --- |
| Siemens star | 32 × 32 | 209.4 | 138.5 | 173.7 | 111.9 |
| Siemens star | 128 × 128 | 100.8 | 68.7 | 88.0 | 53.6 |
| slanted edge | 32 × 32 | 11.4 | 5.3 | 9.4 | 4.3 |
| slanted edge | 128 × 128 | 4.9 | 2.9 | 4.4 | 2.6 |

## Added: optical anti-aliasing filter in `simulateCapture`

**Problem.** The 2.1 diffraction work found that the tier presets declare no optical low-pass (anti-aliasing, AA) filter (the facade's optical stack declared `effectiveAntiAliasingSpatialResponse: absent`), so there was no way to render one, although most Bayer cameras carry one and it is the main physical defence against false colour. It was first left out because it is slow (one scene query per split point). The owner's principle (2026-10-17) is to offer slow but physically meaningful options as opt-ins that the consuming application turns on or off, with their measured cost documented.

**Change.** `sensor.antiAliasing` (opt-in, default off): `{ kind: "four-spot", separationSites? }`, `{ kind: "two-spot", axis, separationSites? }` or `{ kind: "point-splitting", components }`. The facade puts the resulting point-splitting kernel into the sensor optical stack as the engine's existing `normalized-point-splitting-kernel` response (`resolveAntiAliasingSpatialKernel`, applied by the per-site spatial quadrature); it adds no new physics. Caller components are validated by the engine's optical-stack parser (positive weights summing to 1 within 1e-12), plus facade limits of 16 components and 4 sites per offset. New type export `SimulateCaptureSensorAntiAliasing`.

### Science evidence

- **Model.** A birefringent plate (crystal quartz, optic axis tilted about 45°) splits an unpolarized ray into an ordinary and an extraordinary ray of equal power displaced by d; two crossed plates with a retarder between them give four equal spots. This is "the most common quartz filter", and "the four spot filter only has to be one pixel wide in each direction to cut off at the Nyquist frequency"; its MTF is "the modulus of a cosine that goes back to one at the sampling frequency" (R. Palum, Eastman Kodak, "Anti-Aliasing Filter Analysis for Digital Cameras", Proc. IS&T ICIS '06, 2006, free at https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2006/ICIS-0-736/33683.pdf). Two equal impulses at ±d/2 have the Fourier transform cos(π·f·d) (Fourier shift theorem; [MIT OpenCourseWare 2.71 Optics, Spring 2009](https://ocw.mit.edu/courses/2-71-optics-spring-2009/), free), so the four-spot MTF is |cos(π·f_x·d)·cos(π·f_y·d)|, first zero at f = 1/(2d). The default d = 1 pixel pitch puts it at Nyquist.
- **Labelled approximations** (in the `sensor.antiAliasing` assumption): the split is the same at every wavelength, field point and polarization (the engine scope `field-wavelength-polarization-invariant-approximation`; birefringence dispersion and the thickness-dependent displacement are not modelled); spots are exact points with equal weights for unpolarized light; the filter's transmission, reflections and focus shift are not modelled; not a measured filter.
- **Measurements** (f/8, neutral charts, linear luminance of the decoded sRGB output; false colour = mean |R − G| + |B − G| in 8-bit codes; star modulation (p95 − p5)/(p95 + p5) on a circle of the 36-cycle star; edge = median 10–90 % rise per row of the 5° slanted edge). For comparison, the ideal four-spot MTF along an axis at the star's frequency is |cos(π/period)|: 0.93 (8.38 px), 0.73 (4.19 px), 0.07 (2.09 px), 0.62 (1.40 px, above Nyquist, where it rises again).

| Chart | Size | Demosaic | Diffraction | AA | False colour | Star mod. r = 8 (1.40 px) | r = 12 (2.09 px) | r = 24 (4.19 px) | r = 48 (8.38 px) | Edge 10–90 % (px) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Siemens star | 128 | bilinear | off | off | 100.8 | 0.497 | 0.514 | 0.625 | 0.882 | — |
| Siemens star | 128 | bilinear | off | four-spot | 52.2 | 0.407 | 0.359 | 0.535 | 0.866 | — |
| Siemens star | 128 | bilinear | on | off | 88.0 | 0.462 | 0.457 | 0.550 | 0.828 | — |
| Siemens star | 128 | bilinear | on | four-spot | 43.2 | 0.381 | 0.302 | 0.458 | 0.806 | — |
| Siemens star | 128 | AHD | off | off | 68.7 | 0.746 | 0.679 | 0.862 | 0.885 | — |
| Siemens star | 128 | AHD | off | four-spot | 25.1 | 0.480 | 0.391 | 0.726 | 0.888 | — |
| Siemens star | 128 | AHD | on | off | 53.5 | 0.673 | 0.552 | 0.732 | 0.842 | — |
| Siemens star | 128 | AHD | on | four-spot | 21.1 | 0.442 | 0.328 | 0.601 | 0.839 | — |
| slanted edge | 128 | bilinear | off | off | 4.9 | — | — | — | — | 1.49 |
| slanted edge | 128 | bilinear | off | four-spot | 3.8 | — | — | — | — | 2.34 |
| slanted edge | 128 | bilinear | on | off | 4.4 | — | — | — | — | 1.68 |
| slanted edge | 128 | bilinear | on | four-spot | 3.5 | — | — | — | — | 2.69 |
| slanted edge | 128 | AHD | off | off | 2.9 | — | — | — | — | 0.80 |
| slanted edge | 128 | AHD | off | four-spot | 2.4 | — | — | — | — | 1.60 |
| slanted edge | 128 | AHD | on | off | 2.6 | — | — | — | — | 0.98 |
| slanted edge | 128 | AHD | on | four-spot | 2.3 | — | — | — | — | 1.80 |

  At 32 × 32 the false colour falls to 20–30 % (star: 209.4 → 63.6 bilinear, 138.5 → 37.4 AHD, 111.9 → 22.4 AHD + diffraction) and 62–74 % (edge) of its value without the filter. The filter removes most of the near-Nyquist modulation (r = 12 px) that the sampling would otherwise turn into aliasing and false colour, costs some contrast below Nyquist and widens the edge by about 0.85 px, as the cosine MTF predicts; above Nyquist it suppresses less, since its MTF rises again (Palum: the lens must attenuate there). These are measurements of the synthetic model, not of a real camera. Test: `test/simulate-capture-antialiasing.test.ts` (false colour and r = 12 modulation fall in every combination with diffraction and AHD at 32 × 32).

### Diffraction with the filter: convolution per shifted lattice

The environment PSF quadrature takes its taps around each pre-filter source point q − a (a = split offset). With kernels on the site pitch those taps lie on the site lattice shifted by a, so the 2.1 object-space argument holds on each shifted lattice. `createDiffractedPlanarProvider` now convolves once per distinct fractional shift (offsets that differ by whole sites share a lattice) over the native raster widened by the largest offset, and the environment's spatial quadrature forms the weighted split sum as before. The default four-spot filter (offsets ±½ site) needs one half-site lattice; arbitrary offsets work, at one extra convolution set per distinct shift. Without a filter the provider computes exactly what it did before (same sample positions and order).

- **Tests** (`test/simulate-capture-antialiasing.test.ts`): expected generated electrons at every site of 9 × 7 captures at f/8 agree with the per-site engine using `request.diffraction.psf` and the plain scene provider to a relative 1e-12, for the four-spot filter at d = 1 (one shifted lattice) and d = 0.8 (four lattices) and a horizontal two-spot at d = 1.5 (two lattices), on the slanted edge and point grid; RAW codes equal those of the facade's per-tap path. An odd frame keeps the lattices off the frame centre, where both charts have a material boundary; with an even native size the half-site lattice hits it and taps exactly on the boundary pick their material by the last bit of the coordinate (measured up to 1.6e-4 at 3 of 120 sites), the same point-sampling ambiguity documented for diffraction above.
- **Fix found by the test:** the per-tap path resolves the PSF at the pre-filter point, which for an edge site can lie up to the largest offset outside the imaging area; the facade's Airy profile field grid is widened by that offset when a filter is present (unchanged otherwise).

## Added: per-run cost diagnostics in `simulateCapture`

`result.diagnostics.timingsMs` already had `raw`, `whiteBalance`, `development`, `jpeg` and `total`. It now also has, where the stage ran, `diffraction` (object-space convolution time; part of `raw`/`whiteBalance`), `demosaic` (AHD; part of `development`) and `encode` (PNG, JPEG or DNG serialization), measured with `performance.now()` where present. `diagnostics.options` lists the opt-ins that changed the run's work, in the fixed order of the new constant `SIMULATE_CAPTURE_COST_OPTIONS` (empty with every default). Both are additive.

Timings stay out of everything digested: the scene digest is computed from the scene description before any work, the JPEG source digest from samples and the scene digest, and no timing reaches the RAW, samples or encoded bytes. Evidence: the 2.0.0 hash lock (`test/simulate-capture-optics.test.ts`) passes with its digests unchanged; as before it zeroes `timingsMs`, and it now also leaves the new `options` field out of the digest and checks it by name per case; a new test runs the same capture twice and finds every byte, digest and the whole result except `timingsMs` identical. The five engine hash locks pass.

## Added: cost of each option (docs/QUICK_START.md)

Owner principle (2026-10-17): slow but physically meaningful features ship as opt-ins with their measured cost, so the consuming application decides; computer capability changes over time. `docs/QUICK_START.md` § Cost of each option lists each opt-in that affects run time.

**Method.** Slanted edge, all other options default (f/8, 1/125 s, ISO 100, sRGB 8-bit, bilinear). One fresh Node process per option and size, one 16 × 16 warm-up capture, then three timed captures (`performance.now()` around `simulateCapture`), median reported. Built `dist` of this branch, Node 24.21.0, 4-vCPU Intel Xeon 2.80 GHz, Linux, idle. The measuring script is kept outside the repository; `lens.psf` is the 3 × 3 Airy profile that `lens.diffraction` builds at f/8 for the same frame (run per tap).

| Option | 48 × 48 (s) | 128 × 128 (s) | 128 × 128 runs (ms) | Scene queries at 128 × 128 |
| --- | --- | --- | --- | --- |
| default | 0.50 | 2.49 | 2228 / 2486 / 2501 | 338 000 |
| `lens.diffraction` | 0.65 | 2.84 | 2760 / 2838 / 2940 | 338 000 |
| `output.demosaic: "ahd"` | 0.65 | 2.60 | 2548 / 2597 / 2750 | 380 880 |
| `sensor.antiAliasing` four-spot | 0.94 | 4.96 | 4755 / 4959 / 5088 | 1 352 000 |
| anti-aliasing + diffraction | 1.16 | 6.02 | 5893 / 6017 / 6082 | 1 352 000 |
| anti-aliasing + diffraction + AHD | 1.42 | 6.99 | 6655 / 6986 / 6994 | 1 523 520 |
| `lens.pupilSampling` 1 × 4 | 1.79 | 11.46 | 10966 / 11460 / 11578 | 1 352 000 |
| `lens.pupilSampling` 2 × 8 | 5.20 | 33.09 | 32707 / 33088 / 34327 | 5 408 000 |
| `lens.psf` 3 × 3 (per tap) | 2.11 | 12.43 | 11549 / 12433 / 12687 | 3 042 000 |
| yaw 0.01 rad/s, 8 temporal samples | 1.70 | 8.74 | 8584 / 8742 / 9049 | 2 704 000 |
| rotation + rolling shutter | 1.79 | 9.24 | 9233 / 9237 / 9711 | 2 704 000 |
| rolling shutter, still | 0.47 | 2.51 | 2466 / 2510 / 2660 | 338 000 |
| `png` | 0.50 | 2.63 | 2384 / 2630 / 2743 | 338 000 |
| `jpeg` | 0.52 | 2.59 | 2295 / 2589 / 2607 | 338 000 |
| `dng` | 0.50 | 2.27 | 2135 / 2267 / 2425 | 338 000 |
| `highlightMode: "reconstruct"` | 0.50 | 2.20 | 2087 / 2203 / 2388 | 338 000 |
| `whiteBalance: "auto"` | 0.77 | 4.76 | 4560 / 4757 / 4767 | 338 000 (counted once; the RAW is rendered twice) |

Run time follows the scene queries per site; differences below about 10 % are within the run-to-run spread. With anti-aliasing the run time grows 2.0× for 4× the queries, because each query of the lean executor costs less than the per-site fixed work. The new per-stage diagnostics reported, at 128 × 128: diffraction convolution 377–443 ms, AHD demosaic 42–52 ms, encode 4 ms (DNG), 16 ms (PNG), 45 ms (JPEG), auto white balance second pass 2241 ms.

### Compatibility

The 2.1 options (`lens.diffraction`, `output.demosaic: "ahd"`, `sensor.antiAliasing`) are opt-in. Captures that do not use them are byte-identical to 2.0.0: a hash lock in `test/simulate-capture-optics.test.ts` checks the RAW codes, every output byte, the assumptions, composed contracts and diagnostics of six captures (sRGB, PNG, JPEG with auto white balance, mirror borders with 16-bit output, Display P3, DNG in program mode) against digests recorded from the 2.0.0 source. The integration test's unknown-demosaic case now uses `"lmmse"`, because `"ahd"` is accepted.

## Rights and licensing

- **No third-party code, data or constants added.** The diffraction profile is computed by the engine from the circular-pupil OTF. The anti-aliasing filter uses the engine's existing point-splitting contract. AHD was already in the engine; the 2.0 patent review in `THIRD_PARTY.md` found no patent for it.
- **Free sources cited:** MIT OCW 2.71 (lectures 21–22), DLMF §3.5(v), R. Palum, "Anti-Aliasing Filter Analysis for Digital Cameras" (IS&T ICIS '06), and the WICG Prioritized Task Scheduling draft. Goodman, *Introduction to Fourier Optics*, is "also see" only.
- **No new runtime dependency.** The licence-scan CI job passed on every PR.

## Privacy and security

No network, persistence or telemetry is added. The new diagnostics report wall-clock times and option names to the caller only; they never enter a digest or a stored identity. Input validation is unchanged in strictness, and the new options reject unknown fields and out-of-range values.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record update. Tag it only when its CI is green.

- #331, #332 and #333 each passed every CI job on their pull requests: `verify` on Node 22.13.0, lts/-1, lts/* and current; coverage; the licence scan; and the macOS hash locks.
- Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] All 2.1 work merged (#331–#333) with changelog entries.
- [x] Version surfaces aligned at 2.1.0 (`npm run release:prepare -- 2.1.0`); API reference regenerated.
- [x] Owner's review of this record.
- [x] Green CI on this update's pull request (#334), then on `main` after merge ([CI run 846](https://github.com/Photivra/engine/actions/runs/39059182877) on `8b17468`).
- [x] **The owner's explicit approval to tag `v2.1.0`.** The owner tagged `v2.1.0` on `8b17468`; `v2.0.0` is unchanged.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.1.0` → `8b17468f4ecf42a9abde695561289da6c72bfca3` (#334) |
| Publish workflow | [Publish npm run 16](https://github.com/Photivra/engine/actions/runs/39061340880), passed; npm accepted the package at 19:17 UTC and the registry served it a few minutes later |
| npm | `@photivra/engine@2.1.0`, dist-tag `latest` |
| Integrity | `sha512-mETfBZntvmsiTNtoPDEznLChyzie8dg7S2dveiUdO9qT5c2LKMbrOG4IJ8XpRrAh7PZbdIt6xHzu/L7T0sgiPQ==` |
| Provenance | Signed SLSA provenance, published to the Sigstore transparency log (log index 3299565447) |
| Tarball contents | Identical, file for file, to `npm pack` of a clean local build of `v2.1.0` (checked October 17, 2026) |
| GitHub release | [@photivra/engine 2.1.0](https://github.com/Photivra/engine/releases/tag/v2.1.0) |
