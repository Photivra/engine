# Display view

`simulateDisplayView(options, view)` returns the image that the real full-resolution capture of a
`simulateCapture` request would give after it is resized to a small display size, without rendering
the full-resolution capture. Use it for on-screen previews of a whole frame; use `simulateCapture`
for the files people keep (exports stay real captures).

```ts
import { NATIVE_RAW_LIMITS, simulateDisplayView } from "@photivra/engine";

// A 24 MP full-frame capture (6000 × 4000 sites of 6 µm) shown at 384 × 256.
const request = { scene: { preset: "siemens-star" as const }, lens: { prime: 50, fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 },
  output: { width: 6000, height: 4000, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels } };
const view = await simulateDisplayView(request, { width: 384, height: 256 });
console.log(view.kind, view.view.scaleX, view.image.samples.length, view.diagnostics.timingsMs.view);
```

The request is the one you would pass to `simulateCapture` for the export, so exposure, white
balance, tone curve and framing are the capture's by construction (the same code resolves them).
The result is labelled `kind: "display-view"` and has no RAW, plan or file: it is not a capture.

## The problem with giant pixels

Before the display view, a small whole-frame view was rendered by simulating a camera whose pixel
pitch is sensor width ÷ output width (2.5 whole-frame views, assumption `sensor.wholeFrameView`):
36 mm at 384 pixels is a 93.75 µm pixel. Everything that happens at the pixel scale then belongs to
that giant-pixel camera, not to the real one:

- the colour mosaic samples the scene every 93.75 µm instead of every 6 µm, so mosaic aliasing and
  demosaic false colour appear at the display scale, where a real 24 MP capture has averaged them away;
- diffraction, the anti-aliasing filter and the pixel aperture act relative to the giant pixel (an
  Airy disc of a few µm inside a 94 µm pixel does nothing), not relative to the real 6 µm pixel;
- the noise is that of one giant photosite (binned charge, one read noise), not the average of the
  roughly 244 real pixels that form each display pixel, each with its own shot and read noise, after a
  demosaic that correlates neighbours.

The whole-frame views stay available unchanged; the display view is a separate function.

## What the display view computes

**Definition.** Let L_j be the linear-light value of output pixel j of the real capture: its sRGB
samples (rounded to the view's bit depth) decoded with the sRGB EOTF. Display pixel P covers the
rectangle F_P = [P_x·s_x, (P_x + 1)·s_x) × [P_y·s_y, (P_y + 1)·s_y) of real output pixels, with
s = frame size ÷ view size per axis, and

  D_P = Σ_j (w_j / A) · L_j,

where w_j is the area of pixel j inside F_P and A = s_x·s_y. D_P is then sRGB-encoded and rounded.
This is area (box) resampling, the standard reduction filter that averages exactly the source area
each output pixel covers (PBRT, §7.8 "Image reconstruction", box filter; OpenCV's `INTER_AREA`),
carried out in linear light so that the average is the average of light, as a shrunk photograph is,
rather than the darker average of gamma-encoded values (Poynton, *Gamma FAQ*). Non-integer scales are
handled exactly by the fractional weights w_j.

That definition is the validation reference: a region of the real capture, rendered with
`output.region` (byte-identical to the whole render), decoded, area-averaged and compared.

## Options studied

| Approach | Exact? | Cost per display pixel | Used for |
| --- | --- | --- | --- |
| (a) Render every real pixel and average | yes | s² real pixels (244 at 6000 → 384; 3 900 at 6000 → 96) | the validation reference |
| (b) Average a random subset of real pixels | unbiased for the mean only | K² pixels | the scene integral (expected value) |
| (c) Linear kernels at display resolution | for the linear chain | O(1) after the scene integral | demosaic, colour and noise |

(a) costs what a 24 MP capture costs (about 3 000 s for a whole frame at the measured 0.12 ms per
site), so it can only be the reference. (b) alone is wrong for the noise: the mean of K² sampled
noisy pixels has the noise of K² pixels, not of the s² pixels the real average contains, and it is
biased wherever a non-linear step meets the noise. (c) alone cannot work for an arbitrary scene: the
expected signal of a display pixel is an integral of the scene over its footprint, through the
optics, at the real sites, and only a quadrature can evaluate that.

The display view therefore combines them:

1. **Expected value by stratified Monte Carlo over real pixels ((b) for the scene integral only).**
   Each sample is a real pixel; for it the expected (noise-free) electrons of the real sites its
   demosaic reads are computed exactly, at the real pitch.
2. **Everything after that analytically ((c)).** Each sampled pixel's noise distribution is
   propagated through the readout, the demosaic kernels, white balance, the highlight clip, the colour
   matrix, the tone curve and the clip to [0, 1]. The noise of the display pixel is the exact variance
   of the area mean of independent site noises, demosaic correlation included.
3. **AHD's non-linear choice by a control-variate correction** where the noise is large enough for it
   to matter (below).

## Expected signal at the real sites

For a still camera, an ideal rectilinear distortion-free lens and the facade's planar Lambertian scene (for projection,
distortion, vignetting and rotation see [below](#lens-projection-distortion-vignetting-and-rotation)),
the environment chain's radiance-to-irradiance factor is the same at every site (paraxial π/(4N_w²),
no cos⁴ term). The expected photo-electrons of site (i, j) with CFA channel c are therefore a linear
functional of the scene radiance,

  μ_c(i, j) = Σ_o w_o Σ_λ A_c(λ) Σ_t K_λ(t) · L(p_o(i, j) − t, λ),

with A_c(λ) the electrons per unit spectral radiance at spectral node λ (the facade's own environment
chain evaluated once on the axis, as in the ideal reference: one run per channel with unit radiance at every node, each
node's value its own rate term times the exposure time; it does not depend on the scene, so it is kept across chart,
illuminant and illuminance changes, #443), o the pixel-aperture nodes times the
anti-aliasing split spots with weights w_o, and K_λ the diffraction kernel on the site lattice (one
unit tap without `lens.diffraction`). Dark electrons (1 e⁻/s × exposure) are added.

- Signals are integrated from the material spectrum per site (2.21.0). Each chart material is kept as its spectral
  radiance at the nodes (a neutral one: its reflectance times the white radiance), and a site's signal is formed from the
  spectra of the materials its taps read, against its own channel's response, when the site is read. No per-material
  channel value is precomputed. Each lattice point still costs one material lookup.
- With diffraction, offsets that share a fractional shift (the centred four-spot filter has one
  half-site-shifted lattice) are combined with the kernels in advance, as the capture's object-space
  convolution does, and lattice points are evaluated with the same formula as
  `createDiffractedPlanarProvider`.
- Without diffraction, query points use the environment's own arithmetic (site centre, aperture node,
  split offset, rectilinear ray, planar intersection), so a point that falls exactly on a chart
  boundary (a Siemens star's diagonal) resolves to the same material as in the capture.
- A test evaluates μ for 24 sites in each of seven configurations (point, box plus four-spot,
  diffraction plus four-spot at f/16 with AHD margins, diffraction with mirror borders, a caller
  function, spectral patches on a fixed-size chart) against `calculateEnvironmentSensorPhotoSignal`
  with the capture's own provider: equal within 1e-9 relative.

Because each sample is a real site of the real lattice, the colour mosaic and its aliasing are
represented as they are: the red sites of a 6 µm sensor sample the scene every 12 µm, and content near
that frequency aliases into the display pixel exactly as it does in the real average (the expected
value of the box-averaged mosaic contains Σ_k Ŝ(f − k/(2p)), and the box passes the aliases that land
near zero frequency). Sampling theory: MIT OpenCourseWare 6.003, lectures on sampling and aliasing.

**Development exposure push (#556).** With `output.exposureCompensationStops` the capture multiplies each site's
normalized value by G = 2^stops before the per-site clip at white. The view does the same to its readout moments:
the normalized value per electron k becomes G·k and the constant (read and ADC) variance G²·σ², so the per-site clip,
white balance, demosaic and tone curve act on the pushed distribution, as in the capture. Nothing else in the view
changes, and without the option the moments are unchanged.

### Defocus

**Bokeh character (#553).** With `lens.defocus.blades` or `lens.defocus.sphericalAberration` the view's tables carry the
shaped kernel (`calculateDefocusBokehKernel`) instead of the disc, on the CPU and through the GPU's blocked site sum
unchanged; `view.defocus` records `kernel: "shaped-kernel"`. `lens.defocus.catsEye` varies the kernel over the field and is
refused (`simulateCapture` renders it). Above a kernel radius of 64 sites the shaped kernel takes #564's run path below,
on the CPU, like the disc; spherical aberration's binned kernel is refused there when it needs more than 16,641 reads per
site. See [Bokeh character](QUICK_START.md#bokeh-character-553).

`lens.defocus: { model: "geometric-disc" }` with `lens.focusDistanceM` different from `subjectDistanceM` (#492, step
2b) blurs the view by the defocus of the flat scene plane. The model, an approximation recorded in the `lens.defocus`
assumption, is the thin-lens blur circle of an ideal uniform circular pupil, c = f²·|s − d| / (N·d·(s − f))
(`calculateDefocusCircle`), as a uniform disc D sampled on the site lattice: each site's weight is the exact area of the
disc inside its cell over the disc's area ([Quick start, Optics](QUICK_START.md#optics)). For a plane, defocus is one
convolution of the radiance with D, the same at every wavelength. So the disc enters the expected signal as a site
kernel, and every query stays on the lattice:

  μ_c(i, j) = Σ_o w_o Σ_λ A_c(λ) Σ_t (K_λ ∗ D)(t) · L(p_o(i, j) − t, λ),

with K_λ the diffraction kernel (a unit tap without `lens.diffraction`).

- **Without diffraction** every spectral node takes D itself. The view then reads the scene on the lattice, with the
  formula the diffraction path uses, instead of the environment's query points. The tables hold each lattice
  group's kernel per spectral node, so a chart or material scene costs one material lookup per lattice point and one
  multiply-add per tap and node, as with diffraction.
- **With diffraction** node λ takes K_λ ∗ D, the full 2-D convolution of its diffraction kernel with the disc, of
  radius R_diff + R_defocus (`convolveSiteKernels`, `expected-signal-setup.ts`). This is a further approximation: the
  PSF of a defocused wave is not the in-focus Airy pattern convolved with a geometric disc. Where it departs from the
  wave-optics answer is measured in a later step of #492. The convolution is linear, so the result equals the
  diffracted radiance blurred by D.
- The `view.defocus` assumption records the kernel (`"disc"` or `"diffraction-convolved-with-disc"`), the defocus and
  diffraction radii and the combined radius.
- **Unchanged:** both estimators (the exact area mean and the stratified estimate), the noise, the demosaic and the
  development run on the blurred lattice signal as they do on the sharp one. The pilot grid that classifies display
  pixels is widened by the combined radius, so a pixel that the blur reaches from an edge outside it is sampled as detail.
- **Prepared views** build the combined kernels and the tables once per prepared request, as they do the diffraction
  kernels, so regions of one prepared view are byte-identical to the whole view.
- **The same kernels as the capture.** The capture's object-space convolution (#492, step 2a) builds each node's kernel
  the same way (`siteDiffractionKernel`, then `convolveSiteKernels` of `src/optics/defocus-disc-kernel.ts`), so view
  and capture use the same bits.
- **Limits:** the disc's radius is capped at 512 sites since 2.17.0 (`DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES`; 64
  before, #564), the diffraction kernel's at 32, as in the capture. A larger disc fails with a short
  `InvalidConfigurationError` (the blur's size and the largest disc, 1,025 sites); the kernel is never clipped. Up to a
  disc radius of 64 sites the combined kernels above apply, unchanged (combined radius at most 96 sites).
- **Above 64 sites (#564)** the tables keep only the in-focus kernels (each node's diffraction kernel, or a unit tap on the
  lattice formula), and the expected signal applies the disc afterwards, once per channel on the native site lattice:
  μ_c(x) = Σ_s D(s)·E_c(x − s), with E_c the channel's in-focus expected electrons at each site position. Defocus of a plane
  is space-invariant and wavelength-independent, so it commutes with the spectral, offset and diffraction sums: the same
  quantity, regrouped. D ⊛ E is computed by runs of equal kernel weights (prefix-sum differences, exact up to rounding) in
  fixed 128-site tiles, kept per prepared view, so parts and regions stay bit-identical to the whole view. The estimators,
  noise, demosaic and development are unchanged; the pilot grid is widened by the disc's radius. The `view.defocus`
  assumption records `convolution: "runs"`. Method, accuracy and cost:
  [Quick start, Large defocus discs](QUICK_START.md#large-defocus-discs-564). The GPU does not take these discs:
  `gpu: "auto"` renders them on the CPU, labelled. Lattice points
  more than 64 columns beyond the raster edges, which a combined radius above 64 reaches, are looked up directly
  instead of from the lattice rings: the same values, at a higher cost. The cost grows with the square of the radius
  ([Cost, defocus](#defocus-1)).
- **In focus** (c = 0), or without the option, nothing changes: the view is byte-identical to the request without it,
  and every display-view hash lock holds.
- **The GPU** renders defocus too (#492 step 2c; `docs/WEBGPU.md`, "Defocus on the GPU"). The engine's renderer gathers
  these same kernels (the disc, or each node's diffraction kernel convolved with it, rounded once to float32) in its
  Quality site pass, for Speed and Quality requests alike, up to the same caps; a defocused Speed request runs the Quality
  passes with its own bilinear demosaic. The result is labelled `webgpu-f32` with its a-priori bound, as every GPU
  display view. A device whose storage binding limit cannot hold a render's kernel table refuses it with
  `insufficient-limits`, and `gpu: "auto"` then renders that part on this CPU path, labelled. The Speed-only renderer
  (`registerDisplayViewSpeedGpuRenderer`) still refuses a view with site kernels at render time.

**Validation** (`test/display-view-defocus.test.mjs`; `scripts/accept-display-view-defocus.mjs` for the whole matrix):

- *Analytic.* A straight edge blurred by a uniform disc has a closed-form edge-spread function, the circular-segment
  area fraction. The defocused view of a sharp edge is compared with the in-focus view of a reflectance-function scene
  whose reflectance is that closed form. Setup: 6 µm full frame, 50 mm, subject at 2 m, focus at 1.6 m, f/2.8 and
  f/16, at 1, 3 and 8 real pixels per display pixel (exact area mean and stratified).
  - An axis-aligned edge on a cell boundary, where the lattice blur equals the closed form at every site centre: they
    agree within 7.3e-15 in linear light.
  - An edge slanted by 5°: the lattice counts each kernel cell the edge crosses on the side of its centre. The
    difference stays within the summed weight of the crossed cells times the display swing: 14 % of that bound at
    f/2.8 (disc radius 9.6 sites) and 57 % at f/16 (1.68 sites), at 1:1.
- *Against the capture.* The capture's defocus (#492, step 2a) is a convolution of the radiance on the site
  lattice. So the reference is the in-focus view (validated against the capture above and by the #480 harness) of the
  same scene blurred beforehand by D on the lattice, in plain JavaScript, at the same focus distance (the same framing,
  exposure and diffraction kernels). The cases are focus at 0.8× and 1.25× the 2 m subject distance; f/2.8, f/8 and
  f/16; 6 µm (50 mm-equivalent prime) and 1.4 µm (300 mm-equivalent, about 48 mm) pitch; Speed (2 × 2 box) and
  Quality (diffraction, four-spot filter, AHD); 1, 4 and 8 real pixels per display pixel. Thresholds of #480.
  - `node scripts/accept-display-view-defocus.mjs --block 96x64 --capture` (October 27, 2026; Node 24.21.0, built
    from this change): all 24 cases at all three scales (72 renders) pass. Every pixel is within ΔE2000 1. The largest
    ΔE2000 is 6.6e-11 on the exact area mean and 1.6e-7 on the stratified estimate, where the two scenes' pilot grids
    can classify a pixel differently. That changes its sample count, not its expectation. The largest |Δ|/σ is 1.3e-7,
    and the largest difference is 2.5e-7 of an 8-bit code. No difference image can show structure at 1:1.
  - Disc diameters run from 2.7 sites (6 µm, f/16, 1.25×) to 77.5 sites (1.4 µm, f/2.8, 0.8×). Combined Quality
    radii run up to 45 sites.
  - The test runs six of the cases.
  The test and the script's `--capture` also compare the capture with the option against the capture of the
  pre-blurred scene at the same noise seed: in 8 cases (both pitches, f/2.8 to f/16, Speed and Quality; 96 × 64
  blocks) every RAW code was identical. A rerun of those 8 cases after merging step 2a gave the same view numbers as the
  table run. This closes the chain: the view with the option equals
  the view of the pre-blurred scene, which matches its capture (#480), which equals the capture with the option.

### Lens projection, distortion, vignetting and rotation

(2.22.0, #551: `motion.subject` takes this path too. Its sideways motion, under a global shutter, is read at each temporal
midpoint t of the sum below, L(D_t(s), λ) then being the moving scene at t. The view refuses a rotating subject and a
rolling shutter; `simulateCapture` renders both.)

From #563 the view accepts `lens.projection`, `lens.distortion`, `lens.vignetting` and camera rotation
(`motion.angularVelocityRadPerSec`, global shutter), in focus and with `lens.defocus` out of focus, the combinations
`simulateCapture` renders (#548). Each of them moves the scene points a site sees off the plane lattice, or (vignetting,
the distortion's area factor) gives each point its own radiance-to-irradiance factor, so the tables above no longer
describe the capture. The view then forms the sum the capture's environment chain forms:

  μ_c(i, j) = Σ_o w_o · (1/T) Σ_t Σ_λ A_c(λ) Σ_k K_λ(k) · F(s) · L(D_t(s), λ),   s = q_o(i, j) − k·p,

with q_o the query point of offset o, K_λ the site kernel (diffraction, the defocus disc or both; one unit tap
without them), D_t the scene ray of sensor point s at temporal midpoint t (the inverse distortion, the declared
projection and the camera rotation at t), F = T·A its field factor (vignetting throughput × distortion area factor
1/det J) and A_c(λ) the channel response on the axis, as before. The field factor applies at the source point, before
the kernel spreads its light, as for any environment PSF.

- **Scene points.** Without a kernel each query point is formed with the environment's own arithmetic (site centre,
  aperture node, split offset), then the scene ray and field factor of #548's geometry (`prepareDefocusImageSpaceGeometry`,
  the environment's mapping, rotation and vignetting) and the planar provider's own plane-point arithmetic. With a
  kernel the sources run over the site lattice of each fractional offset, with #548's lattice formula. The combined
  kernels and per-material sums are the view's own tables, unchanged.
- **What it equals.** In focus without a kernel: the environment's per-query sum. In focus with `lens.diffraction`: the
  environment PSF quadrature (one scene query per tap). Out of focus: #548's image-space disc, and the view records the
  capture's `lens.defocus` assumption (`execution: "image-space-convolution"`, `imageSpaceOptions`, `fieldVariation`).
  The disc's own approximations, and its field-variation bounds, are #548's ([Quick start, Optics](QUICK_START.md#optics)).
- **Unchanged:** both estimators, the noise, AHD and its correction, the development and the highlight count run on
  these site values as on the rectilinear ones. The pilot maps its points through the lens at every temporal midpoint
  and counts a point whose scene value changes between the midpoints as detail.
- **Large discs (2.17.0 integration of #563 with #564).** Above a disc radius of 64 sites the lens signal applies the disc
  as the rectilinear view does: E_c, each channel's in-focus sum above (through the diffraction kernels or a unit tap,
  with each source point's field factor), in fixed 64-site tiles, then D ⊛ E_c by runs in fixed 128-site tiles, each site
  taking its own channel. Because the disc is the same at every lattice group, node and midpoint, this equals the sum above
  with K_λ ⊛ D. The tiles never map points more than the disc's radius beyond the raster, so the profiles only need to
  reach what the error message names. Tested at R = 179 with radial distortion, vignetting and the box aperture: every
  site matches the capture's image-space provider within 1e-9 relative, and regions equal the whole view
  (`test/defocus-integration-2-17.test.ts`). The cost grows with R, as in [Large defocus discs](QUICK_START.md#large-defocus-discs-564),
  on top of the lens mapping's own cost (below).
- **Rectilinear requests keep their bytes.** The code is a separate module (`src/facade/display-view-lens-signal.ts`)
  that `runCapture` loads on demand only for these options; every hash lock holds.
- **Refused:** camera rotation with `motion.shutter: "rolling"` (each row has its own instants, so the scene points
  of one instant would mix rows exposed at other times; the capture refuses it out of focus for the same reason), and
  a mapping or vignetting profile that does not reach the farthest source point the view reads: the outer site centres
  plus the kernel radius and the largest query offset (the message names the reach and the point). `lens.pupilSampling`
  and `lens.psf` stay refused. The capture's own request limits apply first: rotation with the four-spot filter and
  `lens.diffraction` in focus (the PSF quadrature) can exceed the environment's 100 000 scene queries per site, and
  both the capture and the view then refuse it (the app's Quality options at f/8 with the default eight midpoints need
  217 728).
- **GPU:** these requests stay on the CPU reference. With `gpu: "auto"` the prepared view runs the CPU path labelled
  `unsupported-on-backend` (the limitation names #563), and no device is requested; `"require"` fails with that reason.
  An app can show "estimated on the CPU" from `diagnostics.fast.execution`. No `src/gpu` code changed.
- **Caches** change memory only: site values in a ring of native rows, and with a kernel each lattice point's material
  (or radiance per node) and field factor per lattice group and temporal midpoint, in a ring tagged with the point, at
  most 2²² entries.

**Validation** (`test/display-view-lens.test.ts`):

- *Against the capture, per site.* As for the rectilinear view, every native site's expected electrons are compared
  with `calculateEnvironmentSensorPhotoSignal` on the capture's own site record and provider: in focus with vignetting,
  an equisolid fisheye, radial distortion with the box aperture and four-spot filter, Brown–Conrady distortion with
  vignetting, rotation (3 midpoints), distortion and vignetting with diffraction (the PSF quadrature), a radiance scene
  through an equidistant fisheye with vignetting, and all of them together; out of focus against #548's image-space
  provider with vignetting and distortion (box and filter), and with all four options, diffraction and AHD. Every case
  agrees within 1e-9 relative, the rectilinear view's tolerance.
- *Ties on chart boundaries.* With a kernel the view rounds as the lattice does (as the rectilinear view and the
  out-of-focus capture do): an identity vignetting profile gives the rectilinear view's bytes. Since 2.20.0 the in-focus
  capture with `lens.diffraction` does too: its PSF quadrature reads each tap's source at the lattice point's own plane
  point (#548's lattice formula), so a source point exactly on a chart boundary (a Siemens star's diagonals through a
  symmetric frame's centre, its vertical spokes through an odd frame's centre column) resolves to the same material on
  every path. Before, on a 20 × 14 star at f/11 next to the centre, the capture gave 12 663 against 3 560 electrons with
  and without an identity vignetting profile; now the two agree within 1e-9 relative at every site and give the same RAW
  (`test/simulate-capture-boundary-ties.test.ts`, [#565](https://github.com/Photivra/photivra/issues/565)). With camera
  rotation under `motion.shutter: "rolling"` the lattice reading is `lens.diffraction`'s exact method and each tap's own point its fast
  one (2.20.0: the format default decides, fast for sRGB samples and exact for DNG, JPEG and PNG; [Quick start, Optics](QUICK_START.md#optics)).
- *Against the box-downsized capture.* A slanted edge through radial distortion and vignetting, in focus and out of
  focus (3 µm, 192 × 128 shown at 24 × 16): expected-value RMS below 0.6 code and maximum below 3 codes, the thresholds of
  the rectilinear slanted-edge test.
- Regions are byte-identical to the whole view, and prepared renders to `simulateDisplayView`.

*Against real captures, at the app's scale.* Blocks of a 6000 × 4000, 6 µm request near the bottom-right corner (display
pixels (1330, 870) onward, about 0.85 of the half diagonal, where distortion and vignetting are strongest) shown at
1500 × 1000 (4 × 4 real pixels per display pixel), on a 74-square caller material checkerboard (block standard deviation
36–44 codes), ISO 100, 50 mm-equivalent prime at f/8, subject 2 m. Reference: the capture of the block (`output.region`,
16-bit) at three noise seeds, area-averaged in linear light; candidate: the view's noise-free expected value. Lens variants
as in the cost table below; defocus is focus 1.6 m with distortion and vignetting. Speed is the 2 × 2 box (24 × 24 display
pixels); Quality adds diffraction, the four-spot filter and AHD at a 40 nm spectral step (12 × 12 pixels out of focus, 6 × 6
in focus, where the capture's PSF quadrature costs about 35 s per seed for 24 × 24 real pixels). Errors in 8-bit codes;
the reference's own noise is the standard error of its three-seed mean (scratch script, November 7, 2026):

| Options | Lens | RMS | Largest | Reference noise (RMS) | Mean error per channel |
| --- | --- | --- | --- | --- | --- |
| Speed | distortion + vignetting | 0.291 | 1.34 | 0.303 | −0.003, −0.010, −0.001 |
| Speed | equisolid fisheye | 0.286 | 1.36 | 0.300 | 0.008, −0.009, −0.001 |
| Speed | rotation | 0.285 | 1.20 | 0.301 | −0.001, −0.007, −0.002 |
| Speed | defocus + distortion + vignetting | 0.292 | 1.33 | 0.303 | −0.003, −0.010, −0.001 |
| Quality | equisolid fisheye | 0.271 | 0.97 | 0.337 | −0.039, 0.013, 0.009 |
| Quality | distortion + vignetting | 0.248 | 0.82 | 0.315 | −0.013, −0.011, −0.038 |
| Quality | defocus + distortion + vignetting | 0.282 | 1.22 | 0.307 | −0.032, −0.010, 0.034 |

In every case the RMS difference is no larger than the reference's own noise, so the view's error is below what these
blocks resolve; every mean error is within 0.04 code (the validation's limit is 0.5). The Quality distortion block (6 × 6)
fell on a flat square. Quality with rotation is refused (below).

**Cost** (the app request of [A device-pixel view rendered in parts](#a-device-pixel-view-rendered-in-parts), f/8, 2028 × 1352
in 96 × 96 parts, 30 of 294 parts timed, two repeats interleaved:
`ROWS=0,2 LENS=none,vignetting,distortion,fisheye,rotation node scripts/benchmark-display-view.mjs --app`, November 7, 2026,
built from this change, Node 24.19.0, Apple M5 Pro, one thread per process, load average 9.6–32.9 from other work, so
absolute times are upper bounds and the ratios are the measure). Lens variants: `vignetting` r2 −0.5 at 21.7 mm (−1 stop
at the corner); `distortion` that profile plus radial distortion k1 −0.05, k2 0.005 at 21.7 mm; `fisheye` the equisolid
projection; `rotation` yaw 0.05 and pitch 0.03 rad/s at 1/125 s, the default eight midpoints.

| Options | Lens | Part median | µs per display pixel, median | Against no lens | Whole view, one thread (extrapolated) |
| --- | --- | --- | --- | --- | --- |
| Speed | none | 43–48 ms | 4.6–5.2 | 1 | 16–18 s |
| Speed | vignetting | 53–59 ms | 5.7–6.3 | 1.2× | 19–20 s |
| Speed | fisheye | 66–73 ms | 7.2–7.8 | 1.5× | 22–24 s |
| Speed | distortion + vignetting | 169–179 ms | 18.2–19.3 | 3.8× | 51–55 s |
| Speed | rotation (8 midpoints) | 284–307 ms | 30.4–32.7 | 6.5× | 87–93 s |
| Quality | none | 75–79 ms | 8.1–8.4 | 1 | 30–33 s |
| Quality | vignetting | 389–415 ms | 41.8–44.1 | 5.2× | 117–123 s |
| Quality | fisheye | 350 ms | 37.5 | 4.5× | 104 s |
| Quality | distortion + vignetting | 510–526 ms | 54.8–56.5 | 6.7× | 151–156 s |
| Quality | rotation | refused | | | |

- Prepare times do not change (28–55 ms over every row).
- **Speed** reads one scene point per query offset per midpoint, through the lens. Its cost is the mapping: radial
  distortion is inverted by the capture's own bisection per point (about 40 % of the profile), rotation multiplies the
  points by the midpoints.
- **Quality** sums every kernel tap with its own field factor, so the rectilinear view's shortcut (a site whose kernel
  reads one material takes a precomputed value) does not apply; most of the time is that sum (about 400 taps per site
  here), the lattice points themselves are cached.
- **Quality with rotation** is refused by the capture's own request limit (217 728 scene queries per site against the
  environment's 100 000; see the refusals above).
- The capture's own cost with these options (#548's table in [Quick start, Optics](QUICK_START.md#optics)) is far higher;
  the view's follows the display pixels as before.

### Catalogue lenses (#569)

From #569 the view accepts `lens.catalogue` (the 30 generic lenses of [the lens catalogue](LENS_CATALOGUE.md)), at every
f-number of each lens's range and down to its close focus, with `lens.defocus` and `lens.focusScatter`, the combinations
`simulateCapture` renders. The lens's distortion, vignetting and (for the fisheyes) projection go through the
[lens signal](#lens-projection-distortion-vignetting-and-rotation) as above; its PSF is the new part.

- **What the capture does.** The catalogue lens's sampled PSF (5 × 5 field nodes × 5 wavelengths, centroid-aligned
  interpolation, diffraction and the lens's aberrations included) is resolved by the environment PSF quadrature at each
  query point's own field position and spectral node, and each of its (2R + 1)² taps reads the scene through the lens with its
  own field factor.
- **What the view does (an approximation, the `view.lensPsf` assumption).** The native raster is cut into square field
  zones of Z = ⌈max(W, H) / 64⌉ sites (94 on a 6000 × 4000 frame: 64 × 43 zones; one site on frames of at most 64 sites a
  side). Every site of a zone takes the PSF the capture's own resolver (`resolveLensSampledPsfKernel`) gives at the zone's
  centre, at each spectral node. Everything else is the capture's sum: every tap reads the lattice source point through the
  distortion and projection, with its own vignetting and distortion area factor. The error is the PSF's change across half a
  zone, plus, with the box aperture or the four-spot filter, the capture's per-query PSF positions (a fraction of a site
  from the site centre). `createDisplayViewLensPsf` in `src/facade/display-view-lens-signal.ts`, loaded on demand.
- **Fisheyes.** A ray at or beyond 90° from the axis sees no scene (zero radiance), and a sensor point outside the
  equisolid image circle looks straight back, as in the capture, so the 8 mm's view is black outside its 180° circle. The
  lens signal reads such a ray as zero instead of refusing it; the profiles' reach check skips it.
- **Tables.** Each zone's combined kernels (per lattice group, channel and spectral node; no material folded in) are the
  expected signal's own tables built with the zone's kernels, when a site of the zone is first read, and kept per prepared
  request in a least-recently-used cache of at most 64 MB (at least four zones). They change time and memory only. A zone
  costs about 0.7 ms at R = 4 with 20 spectral nodes (a 64 × 43 view of a 6 µm full frame, which reads every one of the
  2,752 zones once, took 1.9 s against 0.04–0.09 s with `lens.prime` and vignetting, for dead leaves and a radiance scene
  alike; Apple M5 Pro, Node 24.19.0); a 96 × 96 part of the app's view (about 284 native sites a side, plus the kernel's reach) reads at most 5 × 5 zones.
- **GPU:** these requests stay on the CPU reference, labelled `unsupported-on-backend` with `gpu: "auto"`, as for #563.
  No `src/gpu` code changed.
- **Limits:** the capture's own. `lens.diffraction`, `lens.psf` and the bokeh options are refused with the lens (it sets its own
  bokeh, #567, which the view reads in the PSF), a catalogue PSF with a defocus kernel above a combined radius of 16 sites is refused, and with the four-spot filter a large PSF can pass
  the environment's 100 000 scene queries per site (*PV 100 2.8 Macro Pro* at f/22 on 6 µm: 210 000), refused by both.

**Two capture fixes this needed** (each changes only requests that failed before):

- `subjectDistanceM` may now equal twice the focal length (it had to exceed it), so *PV 100 2.8 Macro Pro* renders at its
  1:1 close focus f·(1 + 1/1) = 2f, in the capture and the view.
- A lens whose range excludes f/8 (*PV 800 9*, f/9–f/32) failed every request: the exposure anchor f/8, 1/125 s, ISO 100 lay
  outside its range. Such a lens now takes the same reference exposure at the aperture of its range nearest f/8, here its widest
  (t = 1/125 s × (N₀/8)², the same N²/t and so the same reference luminance); every other lens keeps f/8. (An ideal lens with a
  narrowed range, 2.18.0, takes the same rule.)

**Validation** (`test/display-view-lens-catalogue.test.ts`; reference: `calculateEnvironmentSensorPhotoSignal` on the
capture's own site record, its catalogue PSF quadrature, evaluated with the capture's scene):

| Case | Zones | Largest per-site difference | Mean |
| --- | --- | --- | --- |
| 60 × 40 sites of 1.5 µm, dead leaves or a radiance scene: PV 50 1.2 Pro, PV 8 and PV 15 fisheyes, PV 50 1.8 (kernel radius 3–10) | 1 site | ≤ 2e-15 (test: 1e-12) | |
| The same frame, PV 24 1.4 Pro at f/2 with the 2 × 2 box, four-spot filter, AHD, `lens.defocus` and `lens.focusScatter` | 1 site | 2.5e-3 (test: 5e-3) | |
| Whole 6 µm full frame (6000 × 4000), 300 sites, dead leaves: PV 24 1.8 and PV 16 2.8 wide open, PV 100 Macro at 1:1 f/22, PV 8 fisheye | 94 sites | 0.66 % (test: 1 %) | ≤ 1.2e-4 (test: 3e-4) |
| All 30 lenses at their widest and narrowest f-number at their close focus, 12 µm full frame, 12 sites each | 47 sites | below 1 % (test) | |

- *Ties on chart boundaries.* Lattice source points that fall exactly on a chart boundary (a Siemens star's spokes through the
  frame centre) round as the lattice does in the view and, since 2.21.0, in the capture's quadrature too, which reads each tap at
  its lattice point ([#588](https://github.com/Photivra/photivra/issues/588), as [#565](https://github.com/Photivra/photivra/issues/565)
  does for `lens.diffraction`; [Generic lens catalogue](LENS_CATALOGUE.md)), so both resolve a tie to the same material. The table
  uses dead leaves and radiance scenes, which have no such ties.
- *Against the box-downsized capture:* a slanted edge through *PV 24 1.8* wide open (6 µm, 192 × 128 shown at 24 × 16)
  within the rectilinear test's 0.6-code RMS and 3-code maximum.
- Regions are byte-identical to the whole view, and prepared renders (also with `gpu: "auto"`) to `simulateDisplayView`.

**Cost** (the app request of [A device-pixel view rendered in parts](#a-device-pixel-view-rendered-in-parts): 6000 × 4000 at
6 µm, 2028 × 1352 in 96 × 96 parts, the app's composite chart at 0.63 m, 30 of 294 parts timed, two repeats interleaved;
`ROWS=0,2 PARTS=30 REPEATS=2 LENS=none,catalogue:pv-50-1.2-pro,catalogue:pv-50-1.2-pro:open,catalogue:pv-24-1.8:open,catalogue:pv-16-2.8:open,catalogue:pv-100-2.8-macro-pro:22 node scripts/benchmark-display-view.mjs --app`,
November 9, 2026, built from this change, Node 24.19.0, Apple M5 Pro, one thread per process, load average 7.7–40.4 from
other work, so absolute times are upper bounds and the ratios are the measure). The catalogue rows replace the prime with the
lens (no `lens.diffraction`: the lens's PSF includes it) and keep the row's exposure; R is the PSF's kernel radius.

| Options | Lens | Prepare | Part median | µs per display pixel, median | Against no lens | Whole view, one thread (extrapolated) |
| --- | --- | --- | --- | --- | --- | --- |
| Speed | none (`lens.prime` 50, f/8) | 32–45 ms | 47–77 ms | 5.0–8.3 | 1 | 18–26 s |
| Speed | PV 50 1.2 Pro, f/1.2 | 71–91 ms | 211–321 ms | 22.6–34.3 | 4.2–4.5× | 63–96 s |
| Speed | PV 24 1.8, f/1.8 | 81–93 ms | 372–420 ms | 40.0–44.8 | 5.4–8.0× | 119–124 s |
| Speed | PV 50 1.2 Pro, f/8 | 52–65 ms | 436–720 ms | 46.8–77.1 | 9.3–9.4× | 129–212 s |
| Speed | PV 16 2.8, f/2.8 | 84–86 ms | 590–655 ms | 62.8–69.9 | 8.4–12.6× | 174–193 s |
| Speed | PV 100 2.8 Macro Pro, f/22 | 65–71 ms | 1.80–1.91 s | 193–204 | 25–39× | 531–559 s |
| Quality | none (`lens.prime` 50, f/8, diffraction) | 49–81 ms | 74–165 ms | 8.0–17.6 | 1 | 30–63 s |
| Quality | PV 50 1.2 Pro, f/1.2 | 75–82 ms | 299–318 ms | 32.1–33.9 | 1.9–4.0× | 90–94 s |
| Quality | PV 24 1.8, f/1.8 | 90–98 ms | 514–533 ms | 55.0–57.2 | 3.2–6.9× | 152–157 s |
| Quality | PV 50 1.2 Pro, f/8 | 51–84 ms | 522–637 ms | 55.7–68.4 | 3.9–7.0× | 154–248 s |
| Quality | PV 16 2.8, f/2.8 | 91–95 ms | 766–789 ms | 82.4–84.4 | 4.8–10.3× | 228–232 s |
| Quality | PV 100 2.8 Macro Pro, f/22 | refused (210 000 scene queries per site) | | | | |

- The cost is the tap sum, as for Quality with a lens (#563): every tap of every lattice group with its own field factor,
  about (2R + 2)² × 4 taps per site with the 2 × 2 box. It grows with R², so it is lowest wide open for the sharp lenses and
  highest stopped down (diffraction) and for the softer wide lenses. The ratios pair the extremes of the two rows' medians.
  Prepare grows from 32–81 ms to 51–98 ms (the lens's PSF profile); the zone tables are built during the renders and are
  inside the part times.
- **For interactive use:** a 96 × 96 part takes about 0.2–0.8 s on one thread for most lenses and settings (1.9 s at the
  Macro's f/22), against 50–80 ms without a lens, so a whole 2028 × 1352 view takes about 1–3 minutes of CPU (9 minutes for the
  Macro stopped down), divided by the workers rendering parts. A progressive viewer should render the visible parts first, or a
  coarser view (cost follows the display pixels), until the GPU renders these requests.
- The capture's own cost with a catalogue lens is far higher ([Lens catalogue, Cost](LENS_CATALOGUE.md)); the view's follows
  the display pixels as before.

### Monte Carlo estimator and its error

A point drawn uniformly in F_P lands in real pixel j with probability w_j/A, so the mean of
E[L_j] over such points is unbiased for E[D_P]. The rectangle is split into K × K strata with one
seeded, uniformly jittered point in each (stratified sampling; Owen, *Monte Carlo theory, methods and
examples*, §8.4; PBRT §13.8):

- where E[L] is constant over the footprint the estimate is exact for any K;
- at a straight edge of contrast C, about K strata are cut and each contributes a variance of at most
  C²·f(1 − f)/K⁴, so σ ≈ C/(√6·K^{3/2}): 0.6 % of the contrast at K = 16;
- n edges in a pixel add their variances: σ ≈ C·√(n/(6K³)).

Measured at the centre of a 36-cycle Siemens star (every display pixel crossed by many edges), the
RMS error of the expected value fell from 10.1 to 3.8, 1.4 and 0.49 8-bit codes for K = 4, 8, 16 and
32: a factor 2.6–2.8 per doubling of K, as K^{-3/2} predicts.

**Pilot.** A fixed grid (one point per about two sites, 4 to 16 per axis) over the footprint widened by
the demosaic, filter and kernel reach classifies each display pixel. Pixels whose grid returns one
scene value, and whose eight neighbours' grids do too, use K/4 samples per axis (at least 1); the
others use K. The grid is deterministic, so the sample count does not depend on the random draws and
the estimate stays unbiased either way; the neighbour rule catches edges that only clip a corner.

The samples and the noise of each display pixel are seeded by `sensor.noiseSeed` and the display
pixel's index (`view.region` renders are byte-identical to the same pixels of the whole view).

## Readout, demosaic and development of a sampled pixel

**Sites.** Each site's normalized RAW value (code − black)/(white − black) is approximately normal with
mean k_c·e and variance k_c²·(e + σ_read²) + Δ²/12/(W − B)², where e is the expected electrons
(photo plus dark, Poisson, so variance e), k_c = digital gain/(conversion gain·(W − B)), σ_read the
regime's combined read noise and Δ²/12 the ADC rounding (times the digital gain squared, plus a
second rounding when a digital gain applies; EMVA 1288 Release 4.0, §2; Bennett 1948). It is then
clipped at the white level 1, exactly as the development clips sites; for Y ~ N(m, s²) and
z = (1 − m)/s:

  E[min(Y, 1)] = m − s·(φ(z) − z·(1 − Φ(z))),   E[min(Y, 1)²] = m²Φ − 2msφ + s²(Φ − zφ) + (1 − Φ),

with Φ from Abramowitz & Stegun 26.2.17 (error below 7.5e-8).

**Demosaic.** The bilinear demosaic is linear: each camera channel of the pixel is Σ_k w_k·n_k, with
mean Σ w_k E[n_k] and, the sites being independent, variance Σ w_k² Var(n_k); the three channels use
disjoint sites, so they are uncorrelated.

**AHD** (Hirakawa & Parks 2005, `createAhdDemosaicTask`) builds two candidates, green along the rows
or the columns with the 5-tap filter, red and blue from colour differences. Each candidate is linear in
the mosaic (`ahdCandidateKernels` derives its kernels as responses to unit sites, reach 3); AHD's only
non-linear step is choosing one per pixel by CIELAB homogeneity. The view propagates both candidates
with their full channel covariance (the colour differences correlate the channels). Their expected value
then follows AHD's choice on the noise-free mosaic ([below](#ahds-choice-where-the-scene-decides-it-457)):
the chosen candidate's where the scene decides the choice, the average of the two on a tie, which is every
flat neighbourhood, where the noise decides it.

### AHD's choice where the scene decides it (#457)

Until this change the view averaged the two candidates' rendered results everywhere. That is right where the
noise decides AHD's choice, but at structure finer than a few sites (a Siemens star's centre, a sharp edge
without the anti-aliasing filter) the scene decides it: on the noise-free mosaic one candidate is
markedly more homogeneous, and with ISO 100 noise the capture takes that candidate in nearly every
realization. The average then differs from the capture's colour by up to half the candidates' difference.
Validation set F found it: on the 24 MP full frame at 2028 wide (2.96 real pixels per display pixel) the
expected value at the star's centre was 5.1 codes RMS and up to 34 codes from the capture, against the
2-code limit; with AHD alone 19.3 codes RMS against the seven-reference mean, where one reference is 3.08
from that mean. Diffraction and the four-spot filter alone matched within 0.2 code, and the miss shrank
as the footprint grew (7.7 codes at 800 wide).

**Model.** For each real pixel whose two candidates' camera-channel means differ, the view runs AHD's own
steps on the expected normalized site values, clipped at white (`createAhdDirectionPlane`: the directional
greens, the candidates, their CIELAB with the white-balanced homogeneity matrix, the homogeneity counts
with their adaptive tolerances and the 3 × 3 sums, reading neighbours at their reflect-101 positions as
`createAhdDemosaicTask` does). A decided direction takes that candidate's rendered mean; a tie keeps the
average. Each position's greens, candidates, CIELAB and homogeneity are computed once per render and
kept in rings of native rows (the exact path keeps the region's columns, the stratified estimator one
display pixel's footprint at a time). One-material samples, whose candidates are equal up to rounding,
skip it. This is a first-order model of the expectation: it takes the noise-free choice as the capture's
choice. Where the noise can flip the choice (a near-tie at a structure, or low signal) the capture's mean
lies between the chosen candidate and the average; the low-signal correction below stays the bias of a
flat neighbourhood, added as before. **The noise terms are unchanged** (the candidates' averaged
covariance and the independent choice variance; see the [known limit](#known-limit-quality-noise-at-small-footprints)).

**Evidence.**

- *The direction is the task's.* On a 64 × 48 random mosaic and a 64 × 48 star mosaic the view's direction
  equals `createAhdDemosaicTask`'s direction map at all 3 072 pixels of each, borders included (the task
  keeps its planes in float32, the view in binary64; no decision differed), and equals the centre steps of
  the low-signal correction at every interior pixel (`test/display-view-ahd-choice.test.ts`).
- *Against the capture* (`node scripts/validate-display-view.mjs --options quality` and `--set F`, seven
  reference seeds, limits unchanged; October 31, 2026, Node 24.19.0, macOS arm64; `main` at `50dfe3e`
  against this change):
  - Set F, star centre, 24 MP at 2028 wide: 5.13 → 0.78 codes RMS (limit 2), at most 34.4 → 9.5; false
    colour 16.72 → 13.32 codes against the reference's 13.32; mean error 0.27 → 0.01 code.
    100 MP at 4000 wide: 3.60 → 1.02 codes RMS, at most 21.7 → 7.5; false colour difference +3.03 → +0.12.
    Against the seven-reference mean the full frame's error is 0.41 codes RMS, below one reference's
    0.67 from that mean. AHD alone: 19.3 → 2.84 codes RMS against the mean (one reference: 3.08).
  - The default 155-case matrix: 50 of its 75 Quality cases change, no Speed case and no uniform patch
    changes, and no metric moves outside its limit. Star centres at ISO 100: expected-value RMS 1.02 →
    0.77 (24 MP, 384 wide), 1.64 → 0.82 (24 MP, 800 wide), 0.88 → 0.73 (100 MP, 800 wide), 2.00 → 1.95
    (1.4 µm, 800 wide); their false-colour differences go from −0.06…+0.77 to −0.24…+0.13 codes. Case 17
    (bar groups, 1.4 µm, 384 wide): false colour +0.41 → +0.01; case 92 (slanted edge, 1.4 µm, 800 wide):
    +0.48 → +0.41 (#379), MTF50 +1.1 % → −0.1 %. The largest mean error of a Quality chart at ISO 100 falls
    from 0.30 to 0.25 code. At ISO 1600 and 6400 the mean errors and expected-value RMS change by at most
    0.01 code.
  - The three re-recorded hash-lock cases against 16 reference captures each: AHD dead leaves with the
    Reinhard curve 0.37 → 0.16 codes RMS; the AHD star of the per-real-pixel memo 1.51 → 0.61; the AHD
    patch edge at ISO 3200 without diffraction 7.56 → 3.88 (at most 55.1 → 17.7), and at ISO 100
    7.50 → 0.68 (at most 40.2 → 2.35).
- *Cost* (`node scripts/benchmark-display-view.mjs`, Node 24.19.0, Apple M5 Pro, three interleaved repeats,
  load average 1.3–6): the app's Quality request (`--app`, 2028 × 1352 in 96 × 96 parts) 23.4–24.4 s →
  26.9–28.0 s for the whole view extrapolated (+12–15 %), part median 60–64 → 66–69 ms; whole Quality
  views on the stratified estimator +12 % to +21 % (24 MP star at 192, 384 and 800 wide, dead leaves at
  384). Speed is unchanged.

**Development.** White balance multiplies each channel; the highlight clip at the smallest gain uses
the same clipped-normal moments; the colour matrix (camera → XYZ → linear sRGB) combines the channels
with their covariance; the tone curve and the clip to [0, 1] act per component (identity in closed form;
positive Reinhard by 16-point Gauss–Legendre quadrature on four panels). The mean of these moments is
the sample's E[L_j], so a clipped noise floor lifts dark tones and a clipped highlight stays white, as
in the real image.

**Skewness at low signal.** Shot noise is Poisson, so with a few electrons per site a pixel's linear
sRGB component is skewed, and the colour matrix amplifies the skew (red takes 3.24 × X, so the X sites'
third cumulant enters 3.24³ times). A normal model then over-states how much the clip at 0 lifts the
mean. Each component is a linear combination Σ_k a_k·n_k of independent sites, so its third cumulant
is exact, κ₃ = Σ_k a_k³·k_c³·e_k (Poisson electrons have κ₃ = e; read and rounding noise add none), and
the mean of the clip carries the first-order Edgeworth term: with γ = κ₃/s³,
E[(Y − t)₊] gains s·γ·z·φ(z)/6 at z = (t − m)/s, so

  E[clip(Y, 0, 1)] = (normal value) + (s·γ/6)·(a·φ(a) − b·φ(b)),   a = −m/s, b = (1 − m)/s,

with |γ| limited to 1. On a 1.4 µm sensor at ISO 6400 (about six electrons per site on an 18 % grey)
this took the red mean error of the bilinear view from +0.8 to +0.0 codes.

## Noise of the display pixel

Linearize the non-linear steps around each sample with their **expected** slopes Γ (Stein's lemma: for
normal X, Cov(g(X), X) = E[g′(X)]·Var(X), so E[g′] is the best linear predictor's slope; Stein 1981). Then

  D_P − E[D_P] ≈ Σ_k (J·M·Γ)_c(k) · β_k · ε_k,

a weighted sum of the independent site noises ε_k, with β_k = Σ_j (w_j/A)·W_jk the total weight of
site k in the display pixel after demosaicing and averaging. Its covariance is

  Cov(D_P) = Σ_c B_c·σ_c²·a_c·a_cᵀ,   a_c = J·M·Γ·e_c,   B_c = Σ_{k ∈ c} β_k²,

with σ_c² the site variance of channel c (variance of the mean of correlated pixels: NIST/SEMATECH
e-Handbook, §2.5.5, propagation of error). B_c holds the demosaic correlation exactly. For the bilinear
kernels it is separable: with w(k) the overlap of real column k,
b(k) = w(k) + ½(w(k − 1) + w(k + 1)) spreads red and blue, so B_red = Σ_even b(k)²·Σ_even b(l)²/A²
(blue on the odd sites), and green's quincunx sums nine separable terms of p(k) = w(k) and
q(k) = ¼(w(k − 1) + w(k + 1)). A test checks the closed form against a brute-force spread of every
pixel's weight through its phase's kernels to 1e-12. For a demosaic whose kernels preserve the mean,
the block mean of a channel is the mean of that channel's sites plus terms that cancel except at the
block edge, so the bilinear B_c also serves AHD.

Two terms are added as independent per-pixel variances, weighted by Σ_j (w_j/A)²:

- what the linearization misses: Var(g(X_j)) − (linear prediction), non-zero only where a clip or the
  tone curve bends within the noise;
- the real pixels' output rounding, Δ²/12 in the encoded domain mapped to linear light;
- with AHD, the variance of its per-pixel choice: where the choice is driven by noise, each pixel
  deviates from the candidates' average by ±½(H − V), variance ¼·Var(H − V), linear in the sites.
  AHD sums homogeneity over 3 × 3 pixels, so neighbouring choices are correlated and this
  independent-pixel term under-states the block variance somewhat (see the Quality noise rows).

D_P is the mean of hundreds of independent site noises, so one correlated normal draw (Cholesky
factor of the 3 × 3 covariance) gives its noise (central limit theorem). It has the statistics of the
resized capture, not the same realization.

## AHD at low signal

AHD's choice between its candidates depends on the noise: with a few electrons per site it prefers
neighbourhoods that look homogeneous, and that shifts the colour. On a phone-size 1.4 µm sensor at
ISO 6400 (about six electrons per site on an 18 % grey) the resized AHD capture's red was 5–7 codes
below what the averaged candidates predict; on a 6 µm sensor at ISO 6400 the effect stayed under
0.3 code.

Where a sampled pixel's noise exceeds 0.01 in linear light, the pixel adds AHD's bias for a flat
neighbourhood with its own channel means, measured as a control variate (Owen, §8.9): noisy flat
neighbourhoods are drawn (Poisson electrons plus read and ADC noise, clipped at white, all four CFA
phases), the engine's AHD steps and the two linear candidates run on the same draw, and the mean of
h(AHD) − ½(h(H) + h(V)) is the bias. Both terms see the same noise, so the difference has far less
variance than AHD's own output.

The bias is a smooth function of the channel means, so it is computed on a logarithmic grid of
states (8 steps per octave over 12 octaves below white), 2048 draws per state (8192 with `fast: false`, 2.20.0: the
view's exact method, which halves the common offset below) seeded by the state
alone, and interpolated trilinearly between the 8 states around the pixel's means. A state depends
only on its grid indices, the noise seed, the draws and the readout and development inputs (the
normalized value per electron and the read and ADC variance of each channel, the homogeneity matrix,
the white-balance gains, the highlight clip, the colour matrix and the tone curve), so each one is
computed once per view and kept for later calls with the same inputs (see "Cost"). A first version
drew 64 neighbourhoods per display pixel instead: unbiased, but its sampling noise exceeded the display
pixel's own noise wherever many real pixels are averaged (up to 4× the reference's noise at 96 pixels
wide), because the display noise falls with the number of averaged pixels and the correction's did not.
The shared grid has no per-pixel sampling noise; its remaining error is a common offset of about
1/√(8 × 2048) of the difference's spread, and the flat-neighbourhood state, which is an approximation
at edges. On the 1.4 µm sensor at ISO 6400 it took the red error from +6.6 to within ±0.4 code.

**The states live in one JavaScript realm** (a page, a Web Worker, a Node process): each realm keeps
its own cache, so N workers rendering parts of one view compute the same states N times, and each
worker's first part waits for all of its states. On the app's Quality request at 6 µm ISO 400, one
48 × 48 part at the centre needs 897 states at 27–30 ms each (#447, Node, one thread). 2.10 adds four
operations that move states between realms without changing a byte:

- `prepared.correctionKey()` is the key of the request's states (the exact decimal text of the inputs
  listed above), or null without AHD. Every input of the key is fixed when the request is prepared.
- `prepared.collectCorrectionStates(view)` returns `{ key, gridKeys }`: the grid key of every state a
  render of `view` reads (the eight corners around each corrected sample's channel means, ascending,
  whether or not this realm holds them). It is a render of the region that records the keys instead of
  computing or reading the states. It returns no image and leaves the cache untouched. It runs the
  whole expected-signal and statistics path, so it should cost about one render whose states are all
  held. Measured on the app's Quality request (one 48 × 48 centre part, Node 24.21.0, one thread): 209–217, 126–132 and 76–77 ms in three successive calls, against 129–139, 100–105 and 94–98 ms for a warm render of the same part.
- `prepared.computeCorrectionStates(gridKeys, { signal })` computes the states of the given keys exactly
  as a render does (the same seeding and draws), stores them in this realm's cache and returns
  `{ key, gridKeys, values }`, three values per state. It reads states the realm already holds instead of
  computing them, and it yields and honours `signal` like `render`.
- `serializeDisplayViewCorrectionStates()` (the export) returns one `{ key, gridKeys, values }` entry per cached setup,
  least recently used first. `bindDisplayViewCorrectionStates(entries)` (the import) adds the states a setup does
  not hold yet, leaves known ones as they are and returns the count added. A state takes 28 bytes
  (an `Int32Array` key and three doubles in a `Float64Array`); both arrays can be transferred with
  `postMessage`.

The import checks every entry before it touches the cache. `key` must be a non-empty string,
`gridKeys` an `Int32Array` of grid keys in [0, 97³), and `values` a `Float64Array` of 3 ×
`gridKeys.length` finite numbers. Otherwise the import fails with an `InvalidConfigurationError` and
leaves the cache unchanged. The cache's bounds apply as in a render. A key the realm does not hold
creates a setup, which can evict the least recently used of the four kept. A setup that reaches 65 536
states is cleared before the next state is added. **Import only keys a prepared view reported**
(`correctionKey()`), so the states are ones a render in this realm will read.

Same bytes: a state's three values follow from its grid indices and its key alone. Its stream is
seeded by the noise seed and its indices, and the draws use only the portable functions and correctly
rounded operations (see [Same bytes in every engine](#same-bytes-in-every-engine)), so every realm
computes the same bits. A render reads a state only through its own grid key, so neither the order of
the states, a state computed twice in two realms, nor an imported state in place of a computed one can
change a byte. A last-bit difference in an input between two realms changes the key, so it causes a
cache miss, never a wrong state. The tests in `test/display-view.test.ts` (#447) render a region after
importing a neighbouring region's states in reversed order, and after merging two realms' sets, and
compare SHA-256 hashes of the samples, expected values, noise and diagnostics with a cold render. They
also check that a collect pass returns exactly the states a cold render computes and that two realms
hold the same bits for common states.

The operations make nothing faster by themselves: a pool of workers gains only if it splits the
states of a round between its workers and exchanges them before rendering (Photivra/apps#113, which
measures it in the browser). They do not reduce the number of states a view needs, and every exchange
copies 28 bytes per state. `structuredClone` of an exported set of 764 states (21,392 bytes) took 10–11 µs at the median (Node 24.21.0).

## Coupled rendering (#593, #601)

The luminance tone curves (`extended-reinhard-luminance`, `naka-rushton-luminance`), `highlightMode: "reconstruct"` and the
hue-preserving `gamutHandling: "desaturate-to-luminance"` (#601) act on all three components of a pixel together, so the
per-component moments above do not apply. `src/facade/display-view-rendering.ts` gives the view their moments; requests without
them run the per-component arithmetic unchanged (the hash locks are unchanged).

- **Tone curves, by conditioning on luminance.** The developed linear sRGB is normal, y ~ N(μ, Σ) (Σ from the clipped channel
  variances and the slopes, as for the per-component path). With L = wᵀy (w the sRGB Y row), y_k given L is normal with mean
  μ_k + β_k(L − μ_L), β = Σw/(wᵀΣw), and variance Σ_kk − β_k(Σw)_k (standard Gaussian conditioning). For each L the rendered
  component clip(y_k·r(L), 0, 1), r = f(L)/L (r = 1 for L ≤ 0, as `prepareSdrPixelTone`), has the closed-form clipped-normal
  moments, so the mean and variance are 1-D integrals over L. **Full:** a composite 16-point Gauss–Legendre rule over
  μ_L ± 8.5σ_L in 4 panels, split at L = 0, in standardized units. **Fast:** an 8-point Gauss–Hermite rule where μ_L > 17σ_L
  (the ratio is smooth over the range), else the full rule. Expected slopes for the noise split (Stein's lemma):
  E[∂out_k/∂y_j] = E[1_in·(δ_kj·r + y_k·r′(L)·w_j)], plus, where the ratio jumps at L = 0 (Naka–Rushton with n ≠ 1), the
  jump's term p_L(0)·E[out(0+) − out(0−) | L = 0]·w_j.
- **Reconstruct and desaturation, by a 3-D rule.** Where a pixel's camera channels reach the reconstruct blend (any channel
  within 8.5σ of 0.8 of white or above) or, with the desaturation, a rendered component reaches 1 within reach, the whole chain
  (white balance, highlight, matrix, tone curve, desaturation, clip) is integrated over the pixel's normal camera channels with a
  tensor Gauss–Hermite rule in Cholesky coordinates, with the chain's slopes (a.e.) at each node. **Full:** 16 points per axis
  (4,096 nodes). **Fast:** 6 per axis (216). Elsewhere `reconstruct` is the unclipped white balance (exactly linear) and the
  desaturation changes nothing. The Gauss–Hermite nodes are the eigenvalues of the Jacobi matrix (Golub & Welsch 1969), found by
  Sturm-sequence bisection with correctly rounded operations only (the same bits in every engine).

**Accuracy (measured, `test/display-view-coupled-rendering.test.ts`).** Against seeded Monte Carlo of the same chain (400,000
draws): tone-curve means within four standard errors and variances within 2 %; the chain's means within 1·10⁻³ plus four
standard errors (the 16-point rule's own error at kinks, measured ≤ 5.3·10⁻⁴ against a 48-point rule at channel σ up to 0.1)
and variances within 10 %. Fast against full over a seeded sweep (300 means and covariances, channel σ up to 0.076): tone
6.7·10⁻⁶; chain 1.5·10⁻² (2.4·10⁻⁴ for σ ≤ 0.01, base-ISO noise), in linear light. Against the downsized capture
(24 × 16 views of a 192 × 128 frame): the Standard and Flat looks, extended Reinhard, reconstruct and the desaturation agree in
every channel's mean within 0.5–0.6 codes plus three standard errors, fast and full.

**Scientific status.** Full: exact in the limit of the view's normal model. Fast: an approximation within the bounds above.
On the GPU (Speed kernel) the luminance tone curves run in float32 within the kernel's running bound
([WEBGPU.md](WEBGPU.md#display-view-speed-on-the-gpu)); `reconstruct` and the desaturation run on the CPU reference
(`unsupported-on-backend`), as do all coupled steps in the Quality kernels.

## Drawing the noise near a bound

The drawn display value is clipped to [0, 1] like any light level. Where its noise reaches 0 or 1
(within 4σ), a normal centred on the expected value would have a clipped mean above (or below) it,
while the real average of pixels in [0, 1] is unbiased. The centre of the normal is therefore moved,
by bisection on the clipped-normal mean, so that the clipped draw keeps the expected value. This
matters only where each display pixel averages few, very noisy real pixels (a 1.4 µm sensor at
ISO 6400 shown 800 pixels wide: the red error was +3.5 codes before, within ±0.4 after).

## Highlight count (#533)

`diagnostics.highlight` reports how many of the real capture's output pixels in the rendered region are saturated
(clipped highlights), the count `simulateCapture` reports as `diagnostics.highlight.saturatedPixelCount`.

**The capture's count is one noise sample.** The capture counts an output pixel when at least one RAW site its demosaic
reads is clipped (flagged saturated, or at the white level). That count depends on the drawn noise
(`sensor.noiseSeed`): a pixel whose sites sit near white is counted on some seeds and not on others.

**The view reports its expected value.** The view renders no RAW, so it reports the count's expected value over the noise:

  saturatedPixelCount = Σ_j w_j·P_j,  P_j = 1 − Π_k (1 − p_k),  p_k = P(value_k ≥ 1)

- j runs over the real output pixels of the region, and w_j is the part of pixel j inside it: 1 inside, a fraction
  where a region edge cuts a real pixel.
- k runs over the distinct sites pixel j's demosaic reads. A site read twice through a mirrored border counts once.
- p_k comes from the site model the expected value already uses (["Readout"](#readout-demosaic-and-development-of-a-sampled-pixel)):
  the site's normalized value is normal with mean k·e and variance k²·e + c₀ (shot, dark, read and ADC noise). So
  p_k = 1 − Φ((1 − k·e)/σ) is the clip's own slope, `upperClip`'s third moment.
- p_k is exactly 0 or 1 beyond 8.5 σ from white, where the clip itself is out of reach.
- The sites' noises are independent, so P_j is the probability that pixel j is counted.
- The count is estimated the way the expected value is (`view.estimation`):
  - exactly over every real pixel of the footprint (the exact area mean);
  - or as A times the mean of P over the stratified samples (A real pixels per display pixel), which is unbiased.

So the count is a real number, not an integer. The per-real-pixel memos, the one-material replay and the site ring carry
P_j with the other recorded terms. The count reads no extra site and draws nothing, so no sample, expected value, noise
σ or other diagnostic changes: the hash locks of `test/display-view.test.ts`, `display-view-pixel-memo.test.ts` and
`display-view-speed-material.test.ts` leave `diagnostics.highlight` out and keep their hashes.

**Agreement with the capture** (`test/display-view-highlight.test.ts`):

- **Every site far from white.** Every P_j is then exactly 0 or 1, and the view's count equals the capture's count of
  the same pixels exactly. A checkerboard 3 stops over white with point sites gives 1 632 pixels (bilinear) and 2 208
  pixels (AHD) of 2 400, at 1:1, at 2 × 2 and at 3 × 4 real pixels per display pixel. A 6 × 5 footprint (stratified)
  is within 1 %.
- **Near white.** A uniform grey with its green sites at the white level, 40 × 30. Over noise seeds 1–3 the capture
  counts 709, 702 and 696 pixels; the view's expected count is 697.4. The test checks the view against the mean of 8
  seeds at three view sizes.
- **Regions are additive.** A display pixel's share is the same in every region that renders it, so the counts of
  regions that tile the view sum to the whole view's count, up to floating-point summation order (tested per pixel
  and summed).

**AHD is an approximation here.** With AHD the capture counts every site within 3 sites of the pixel, clipped to the
raster (`AHD_VALUE_REACH`, its interpolation reach). That is 49 sites. The view counts only the 25–29 of them that its
AHD candidates read. Reading the other sites would change `sceneLookups` and cost site evaluations the image does not
need. The two counts agree along a straight clipped edge: each candidate reads a site 3 away in every row and column
direction. The view's count can be lower where a clipped area ends in a corner, or at a clipped speck 2–3 sites away
diagonally. On the checkerboard above they agree exactly.

**The capture's other saturation flag.** The capture also flags a site whose electrons reach the full well before the
ADC. The view assumes that this happens only at or above the white level. That holds because the white level is the
code of the smaller of the full well and the pre-ADC saturation, capped by the ADC's and the digital top codes
(`calculateSiteEffectiveSaturationCode`). A site at its full well is therefore at the white level or above.

**Cost.** Each sample now forms one product over its read sites, and the clip's slope that it uses is already computed.
On the app request ([the 2.15.0 table](#a-device-pixel-view-rendered-in-parts)), this build against 2.15.0 in the same run
gave part medians of 38–41 ms against 39 ms (Speed) and 74–79 ms against 74–78 ms (Quality). The extrapolated whole view
was 0–4 % slower; the two repeats of one build differed by up to 3 %.

**On the GPU** ([Rendering on the GPU](#rendering-on-the-gpu)) the count is the CPU reference's, bit for bit:

1. The kernels mark each site as certainly below white, certainly at or above it, or undecided. A site is certain
   only beyond twice the reference's 8.5 σ, after moving its mean by twice its error bound and raising its variance
   by twice its bound. There the reference's p_k is exactly 0 or 1.
2. A real pixel is certainly saturated (P_j = 1) when it reads a certainly clipped site. It is certainly not saturated
   when every site it reads is certainly below white.
3. The host forms the share of a display pixel whose real pixels are all certain from the kernel's mask, with the
   reference's own arithmetic.
4. For a display pixel with an undecided real pixel, the host takes only the count from the reference's render of that
   pixel. Its samples stay the kernel's.

`diagnosticsExact` therefore stays true. The run-time self-checks compare the count, and so do the float32 emulation
tests: the checkerboard's light squares are decided by the mask, and the near-white grey is undecided and recomputed.

## Validation

See [Validation results](#validation-results) below for the tables; this section defines what was
measured.

**Reference.** For each case the real capture of the request is rendered at full resolution over a
block of display pixels (`output.region`, byte-identical to the whole render), as 16-bit sRGB, decoded,
and area-averaged in linear light with the exact fractional weights: approach (a) on the block. The
display view renders the same block with `view.region` (16-bit). One process per case, built `dist`.

**Seven reference seeds.** The reference block is rendered at seven noise seeds (`sensor.noiseSeed` 1 to 7) and every
reference-side metric below is the mean of its seven values (standard deviations: the root of the mean variance); the
view is rendered once, at the request's default seed (1). One realization of the reference varies too much for the
limits: on the 100 MP sensor at 800 pixels wide its slanted-edge MTF50 ranged 0.521–0.554 cycles per display pixel over
the seven seeds (standard deviation 2.1 % of the mean), so the difference between two single realizations varies by
about 3 %, the size of the MTF50 limit. A single seed decided case 102 of the October 19 record (−4.4 %), whose seed-1
reference was the sharpest of the seven; against the seven-seed mean it is −0.9 %. The limits did not change. The
standard error of a mean difference is then that of the view plus that of the seven-seed mean, √((1 + 1/7)·σ²/n).

**Matrix.** Five charts (slanted edge, 36-cycle Siemens star, bar groups at 100–800 LW/PH, dead leaves,
an 11-step grey wedge) and uniform grey patches; three sensors (full frame 6000 × 4000 at 6 µm,
24 MP; phone 4000 × 3000 at 1.4 µm, 12 MP; medium format 11 648 × 8 736 at 3.76 µm, 100 MP); the
50 mm-equivalent generic prime at f/2.8, f/8 and f/16; ISO 100, 1600 and 6400 (the shutter scaled to the
same exposure); display widths 96, 192, 384 and 800; Speed (the engine defaults) and Quality
(diffraction, four-spot anti-aliasing filter, AHD). Blocks are 16 × 16 or 32 × 32 display pixels
(8 × 8 at width 96) at the chart's busiest place.

**Metrics.**

- *Mean error per channel* (8-bit codes): code(mean of the view's linear values) − code(mean of the
  reference's), with its standard error from both blocks' spreads. In the encoded domain a mean of
  noisy values also depends on the noise's shape through the concave sRGB curve, so the mean is taken
  in linear light and only then expressed in codes.
- *Expected-value RMS and maximum* (8-bit): the view's noise-free estimate against the reference, per
  display pixel; at ISO 100 the reference's own noise is a fraction of a code, so this is the estimator
  error (Monte Carlo plus model), at high ISO it is dominated by the reference's noise.
- *Noise ratio*: the standard deviation of the view's display pixels over a uniform patch divided by
  the reference's (and the view's predicted standard deviation divided by the reference's, which has no
  sampling error on the view side).
- *MTF50* of the slanted edge in cycles per display pixel (Burns 2000; ISO 12233 method: edge
  centroids, a fitted line, 4× oversampled ESF, Hamming window).
- *SSIM* of the two blocks' encoded luma (Wang et al. 2004; 7 × 7 uniform window).
- *False colour*: mean |R − G| + |B − G| in 8-bit codes for the neutral charts.

**Acceptance limits.**

| Metric | Limit | Why |
| --- | --- | --- |
| Mean error per channel | ≤ 0.5 code, or ≤ 3 standard errors when noise dominates | Half a code is below the 8-bit rounding of the output itself; a block of n display pixels cannot resolve a difference below a few σ/√n. The matrix makes 465 channel tests: at 2 standard errors about 4.6 % of unbiased tests (up to 21) would fail by chance, at 3 about 0.27 % (about 1). Both counts are reported. |
| Noise ratio (predicted ÷ reference) | 0.85–1.15 on 16 × 16 blocks, 0.75–1.25 on 8 × 8 | The reference's standard deviation from n pixels has a relative sampling error of 1/√(2(n − 1)): 4.4 % at n = 256, 8.9 % at n = 64; the limits are about 3 such errors. |
| Expected-value RMS at ISO 100 | ≤ 1 code on edges, ≤ 2 codes in the busiest pixels (star centre) | The Monte Carlo error at K = 16 (σ ≈ 0.006·C per edge); it averages out over any feature larger than a display pixel. |
| MTF50 difference at ISO 100 | ≤ 3 % | Slanted-edge MTF50 repeatability between noise realizations is about 1–2 %. |
| SSIM at ISO 100 | ≥ 0.99 | At high ISO SSIM measures two independent noise realizations, so it is reported, not limited. |
| False-colour difference | ≤ 0.5 code, except where the Monte Carlo error itself adds colour (star centre) | The metric is biased upward by any per-channel error. |

## Validation results

**Set F, device-pixel views (October 26, 2026, `65decd1`; [record](validation/display-view-2026-10-26/README.md)).**
`node scripts/validate-display-view.mjs --set F` validates the view where an interactive viewer renders it: 2028 pixels
wide on the 24 MP full frame and 4000 on the 100 MP medium format, about 3 × 3 real pixels per display pixel, on the
[exact area mean](#exact-area-mean) (12 cases, 32 × 32 blocks at the star's centre and on uniform grey at ISO 100 and
6400). Speed passes every limit. Quality misses two: the predicted noise is 1.13–1.20 of the reference's on the uniform
patches (the [known limit](#known-limit-quality-noise-at-small-footprints), #379), and at the star's centre the expected
value is 5.1 codes RMS, at most 34 codes, from the capture (full frame; 3.6 / 22 on the medium format) against the 2-code
limit, because the view's AHD result differs from the capture's where the pattern is finer than the sensor resolves.
Diffraction and the four-spot filter match the capture there within 0.2 code; the AHD miss shrinks with the footprint
(19.3 codes RMS with AHD alone at 2028 wide, 7.7 at 800). Set F is outside the default run. **Since #457** the view takes
[AHD's choice on the noise-free mosaic](#ahds-choice-where-the-scene-decides-it-457) and the star centre is within the
limit: 0.78 codes RMS, at most 9.5 (full frame), and 1.02 / 7.5 (medium format), with seven reference seeds (October 31,
2026); the uniform patches are unchanged, so the noise miss (#379) remains.

**2.8.0 re-run (October 25, 2026, `de77074`; [record](validation/display-view-2026-10-25/README.md)).** 145 cases are
identical to the October 19 results below. The 10 cases on the [exact area mean](#exact-area-mean), the phone at 800
pixels wide, are the same or better against every limit (Siemens star: expected-value RMS 1.78 → 1.35 codes, SSIM
0.9931 → 0.9966). The known noise miss of case 138 (#379) remains at 1.165. The run took about 9 minutes instead of
3 h 27 min, because the reference captures take the tabulated RAW path.

155 cases on `main` at `ea6dbe7` (`node scripts/validate-display-view.mjs`, seven reference seeds; the display views of
`05d24cb` are byte-identical; every row, and the raw lines, in
[the validation record](validation/display-view-2026-10-19/README.md)). Summary by options, ISO and block type:

| Options | ISO | Blocks | Cases | Largest mean error (codes) | Noise, predicted ÷ reference | MTF50 change | Lowest SSIM (blocks ≥ 16) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Speed | ISO 100 | charts | 41 | 0.24 | — | −2.7 to +2.2 % | 0.9873 |
| Speed | ISO 100 | uniform patches | 9 | 0.10 | 0.94–1.03 | — | — |
| Speed | ISO 1600 | charts | 2 | 0.16 | — | −1.4 to −1.4 % | 0.9668 |
| Speed | ISO 1600 | uniform patches | 1 | 0.51 | 0.99–1.01 | — | — |
| Speed | ISO 6400 | charts | 9 | 0.75 | — | −2.9 to +3.4 % | 0.8703 |
| Speed | ISO 6400 | uniform patches | 18 | 1.03 | 0.93–1.06 | — | — |
| Quality | ISO 100 | charts | 39 | 0.30 | — | −1.0 to +1.2 % | 0.9904 |
| Quality | ISO 100 | uniform patches | 8 | 0.22 | 0.89–1.08 | — | — |
| Quality | ISO 1600 | charts | 2 | 0.27 | — | −0.2 to −0.2 % | 0.9631 |
| Quality | ISO 1600 | uniform patches | 1 | 0.37 | 0.97–1.05 | — | — |
| Quality | ISO 6400 | charts | 9 | 0.65 | — | −1.7 to +10.6 % | 0.8598 |
| Quality | ISO 6400 | uniform patches | 16 | 1.30 | 0.90–1.16 | — | — |

Against the limits:

- **Mean error per channel: every channel of every case passes** (|error| ≤ max(0.5 code, 3 standard errors of the
  noise)). At ISO 100 the largest is 0.30 code (Monte Carlo error at a Siemens star's centre). One of the 465 channel
  tests is above 0.5 code and 2 standard errors, fewer than chance alone would give.
- **Expected value at ISO 100:** with the reference's own noise taken out (estimated from each block's standard error,
  √(RMS² − n·SE²/(1 + 1/7)) averaged over the channels, which is crude on high-contrast blocks), the estimator's RMS
  error is at most 0.81 code on edges, bars, dead leaves and grey steps and 1.9 codes in the busiest pixels (star
  centres, many edges per pixel).
- **Noise: one Quality case misses the limit, a documented miss of the known limit below.** The predicted standard
  deviation is 0.93–1.06 of the reference's for Speed and 0.89–1.16 for Quality (8 × 8 blocks at 96 pixels wide have a
  ±25 % limit). The miss is case 138: the 1.4 µm sensor with the Quality options at 800 pixels wide on an 18 % grey
  patch at ISO 6400, predicted ÷ reference R 1.164, G 1.133, B 1.030 against the 0.85–1.15 limit. The limit is
  unchanged; the miss is recorded under #379 with case 92 and is accepted for 2.6.0 by the owner's decision of
  October 20, 2026.
- **Sharpness:** MTF50 of the slanted edge at ISO 100 changes by −2.7 % to +2.2 % for Speed and −1.0 % to +1.2 % for
  Quality (limit 3 %), over three sensors, f/2.8–f/16 and 192–800 pixels wide. The reference's own MTF50 varies by up to
  2.2 % (one standard deviation) between noise seeds. At ISO 6400 MTF50 measured on a noisy block is dominated by the
  noise and is not a fidelity measure.
- **SSIM** of structured blocks at ISO 100 is 0.9873 or higher. It misses the 0.99 limit only at star centres
  (0.987–0.998), where the Monte Carlo error is largest; a larger `view.samplesPerAxis` reduces it (with stratified
  samples the variance falls at least as 1/K²) at a detail-pixel cost proportional to K² (not measured in this matrix).
  At high ISO SSIM compares independent noise realizations.
- **False colour** of neutral charts at ISO 100 agrees within 0.15 code except on the 1.4 µm sensor with the Quality
  options, within the 0.5-code limit: the slanted edge at 800 pixels wide, +0.48 (case 92, 4.20 → 4.68; the known limit
  below), and bar groups at 384 wide, +0.41 (case 17, 2.90 → 3.31); and star centres, where per-channel Monte Carlo
  error adds up to 1.4 codes of apparent false colour.
- **Aperture:** with the engine defaults (no diffraction) the f-number changes only the exposure, which the matrix
  compensates with the shutter, so Speed results are the same at f/2.8, f/8 and f/16; with diffraction (Quality) the
  slanted-edge MTF50 falls from 0.528 to 0.518 cycles per display pixel between f/2.8 and f/16 on the 24 MP sensor,
  and the view follows within 0.2 %.

### Known limit: Quality noise at small footprints

With the Quality options (AHD) the view's noise has too much colour where a display pixel covers few sensor pixels.
The noise term Σ_c B_c·σ_c²·a_c·a_cᵀ treats output camera channel c as driven only by CFA sites of channel c, with
B_c from the bilinear kernels. AHD forms red and blue from directional green plus interpolated colour differences, so
they read green sites as well, and the output channels share noise. Over a large footprint those green weights sum to
zero and the error vanishes; over a small one they do not. AHD's noise-driven choice between its candidates, which is
correlated over 3 × 3 pixels, changes the covariance as well, so no closed form over the two linear candidates matches
the capture (with one candidate everywhere, 0.89 / 0.89 / 1.07 of the reference's standard deviation; with an
independent choice per pixel, 0.45 / 0.83 / 0.89).

Measured on the 1.4 µm sensor at 800 pixels wide (5 × 5 real pixels per display pixel): on a uniform 18 % grey patch
at ISO 100 the predicted noise is 1.08 / 1.08 / 0.95 of the reference's (pooled over 12 noise seeds: R − G +9 %,
B − G +15 %, and a green–blue correlation of −0.06 where the capture has +0.16), and at ISO 6400 (case 138) R 1.164,
G 1.133, B 1.030, outside the 0.85–1.15 noise limit. On the slanted edge (case 92) R − G is +9 % and B − G +18 %, and the false colour
exceeds the reference's by +0.48 code (+0.49 ± 0.05 over seven view and reference seeds; with the reference's own noise
added to the view's expected image instead of the view's draw, +0.04): the expected value is right and the drawn
noise is not. Since AHD's choice on the noise-free mosaic (#457) case 92's false-colour difference is +0.41 code. Speed (bilinear) is exact. On the 6 µm and 3.76 µm sensors at 800 pixels wide or less, and on the 1.4 µm sensor at
384 pixels wide or less, the predicted noise is within 0.89–1.08. At device-pixel widths, about 3 × 3 real pixels per
display pixel, the 6 µm and 3.76 µm sensors reach 1.13–1.20 as well (set F, October 26, 2026). A redesign of the Quality noise model, from the autocovariance of
the real AHD output, was planned for 2.7.0 and moved to 2.8.0 and then 2.9.0; it is not built, and no release is
scheduled for it. #379 was closed on October 31, 2026 when #527 merged, although #527 fixed
#457 and states that it does not fix #379: the uniform-patch ratios above are unchanged. #379 holds the measured diagnosis
(October 31, 2026): a Monte Carlo through the engine's own AHD on flat mosaics reproduces the capture's noise within
0.97–1.02 in every failing uniform-patch case; the in-engine estimator and its cost are open.

Known-limit misses in the validation, recorded under #379 and accepted for 2.6.0 by the owner (October 20, 2026), with
the limits unchanged: case 138 (noise ratio, above) and case 92 (false colour +0.48 code, within its 0.5-code limit with
seven reference seeds but at the limit across seeds).

What changed during validation (each found by this matrix and checked again on it):

1. Lattice points that fall exactly on a chart boundary resolved to different materials than in the capture, giving
   errors up to 15 codes along a star's diagonals; the view now uses the capture's own query arithmetic.
2. AHD at low signal shifted the colour by up to 6.6 codes; the control-variate correction removed it, first with
   per-pixel draws (whose own noise exceeded the display noise at large scales) and then with the shared grid.
3. The normal approximation over-stated the clipped noise floor at a few electrons per site; the skewness term fixed it.
4. Thin edge slivers in a footprint's corner were missed by the pilot (one pixel 10.8 codes off); neighbouring pilots
   now count.
5. The clipped noise draw biased very noisy display pixels upward (+3.5 codes); its centre is now adjusted.
6. At structure finer than a few sites the candidates' average missed the capture's colour by up to 34 codes at device-pixel
   widths (set F); the expected value now follows AHD's choice on the noise-free mosaic (#457).

## Preview acceptance

`scripts/accept-display-view-gpu.mjs` (#480) is the release gate of the GPU display view: it renders the app's request with
the CPU display view (the reference) and a candidate, compares the two noise-free expected images per pixel in ΔE2000 (Sharma,
Wu and Dalal 2005) and in units of the reference's noise σ, writes a difference image per case, and prints pass or fail against
the thresholds of #473 (99 % within ΔE2000 1, none above 2.3, no pixel beyond 1 σ; parameters). With `--gpu` the candidate is
the GPU: the request rendered in headless Chromium through `prepareDisplayView(request, { gpu: "require", gpuDevice })` on the
built engine, so it covers both kernels (Speed, #478, and Quality, #479). Without it the candidate is this CPU display view
again, a self-check that must show exact equality ([record](validation/display-view-acceptance-self-check-2026-10-27/README.md)).
Options, metrics, the GPU producer and the record format: [WebGPU, Preview acceptance](WEBGPU.md#preview-acceptance).

**The owner's run on a Mac** (Chrome installed; Node 22.18 or later), from the repository:

```sh
npm ci && npm run build && npm run accept:gpu:hardware -- --record display-view-acceptance-m5-pro-$(date +%Y-%m-%d)
```

- **What it runs:** 26 cases, one after the other, each in its own Node process with its own browser: the app's composite
  chart, the same chart out of focus (`app-defocus`, Speed only) and the five fixture charts, at 2028 × 1352 and 2800 × 1867
  from the 24 MP 6 µm frame, Speed and Quality. Each case renders the whole view on the GPU, then with the CPU reference in the same browser page (the
  reference it is judged against) and in Node (17–46 s per CPU render on the 4-vCPU development host, #486). `--sizes 2028x1352`, `--charts app` or `--options speed` run a subset.
- **What it prints:** the case list and the adapter mode first; per case a `done` line with the largest ΔE2000 and |Δ|/σ and
  where the candidate ran (`webgpu-f32` on the adapter `GPUAdapter.info` reports, conformance self-check passed); then the
  table of every case (fraction within ΔE2000 1, largest and mean ΔE2000, largest |Δ|/σ, largest difference in 8-bit codes,
  identical pixels and samples, the two render times), one `pass` or `FAIL` line per threshold and case, the execution label
  of every case, and the verdict line `PASS: …` or `FAIL: …`; the exit code is non-zero on a failure.
- **Where the files go:** the difference PNGs (|Δ| in 8-bit codes × 16, black is no difference; "Difference image, not a
  capture" in their text metadata) and `results.jsonl` in `./display-view-acceptance/` (`--out` changes it); with `--record`,
  `docs/validation/<name>/README.md` and `results.jsonl` (`--record-images` copies the PNGs there too).
- **How to read it:** the run passes when the verdict line says `PASS` and every case ran on the GPU. A case the GPU could
  not render (no adapter, a software adapter when the hardware is required, a failed self-check, `unsupported-on-backend`, a
  lost device) is an error and fails the run, with the engine's reason: the harness never compares the CPU with itself by
  accident. The one exception is `app-defocus`: until the GPU renders `lens.defocus` (#492, step 2c) it is reported as an
  **expected fallback** with the engine's reason and is not compared; once the GPU covers it, it is compared like the rest.
  The "no structured difference at 1:1" check is the owner's look at the listed difference images; the script does not judge it.
- **If the adapter is wrong:** `--hardware` sets `PHOTIVRA_WEBGPU_ADAPTER=hardware` and `PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1`, as
  `npm run test:webgpu:hardware` does; a software adapter (SwiftShader) then fails every case. The suite's switches apply:
  `PHOTIVRA_WEBGPU_HEADLESS=0` (a visible window), `PHOTIVRA_WEBGPU_BROWSER=/path/to/chrome`, `PHOTIVRA_WEBGPU_FLAGS="…"`
  ([WebGPU, Running on hardware](WEBGPU.md#running-on-hardware)).

## Cost

Two regimes. Where a display pixel covers more than 25 real pixels (narrower than about a fifth of the frame's width), the
stratified estimator applies and the cost follows the detailed display pixels × K². At or below 25, the
[exact area mean](#exact-area-mean) applies and the cost follows the real pixels the region touches.

### A device-pixel view rendered in parts

The request shape of an interactive viewer (#454): a 24 MP, 6 µm, 6000 × 4000 sensor with the 2 × 2 box pixel aperture, a
caller material scene (an engine-authored composite chart plus a stand-in printed label), and a 2028 × 1352 view (a
1440 × 900 window at twice the CSS pixel size), prepared once with `prepareDisplayView` and rendered in 96 × 96 parts,
centre first. Every display pixel covers about 2.96 × 2.96 real pixels, so every part takes the exact area mean. Speed is
the engine defaults plus the box; Quality adds `lens.diffraction: "circular-aperture"`, the four-spot filter and AHD. ISO
100, so no part needs the AHD low-signal correction.

`node scripts/benchmark-display-view.mjs --app`, on `main` at `65decd1` (2.9.0 plus #434): one fresh Node process per row
and repeat, 30 of the 294 parts timed (every ninth in the centre-first order), two repeats; built `dist`, Node 24.21.0,
4-vCPU Intel Xeon 2.80 GHz, Linux, load average 0.3–1.1. To show the noise floor the same build ran a second time as
build B, interleaved with A: the per-part medians of the two builds and two repeats agree within 10 %, the prepare
times within 20 %. Ranges are over both builds and both repeats.

| Options | f | Prepare | Part median | Slowest part | µs per display pixel, median (min–max) | Whole view, one thread |
| --- | --- | --- | --- | --- | --- | --- |
| Speed | f/8 | 195–226 ms | 88–89 ms | 227–291 ms | 9.4–9.5 (8.4–31.3) | 31–33 s |
| Speed | f/11 | 176–197 ms | 86–95 ms | 199–215 ms | 9.2–10.2 (8.5–23.1) | 29–33 s |
| Quality | f/8 | 452–548 ms | 169–181 ms | 510–526 ms | 18.2–19.3 (16.5–57.1) | 63–65 s |
| Quality | f/11 | 461–559 ms | 175–186 ms | 496–535 ms | 18.7–19.9 (16.9–57.5) | 65–67 s |

The whole-view column is an extrapolation from the timed parts (their mean × 294), not a measurement. Quality costs about
twice Speed per part.

**Re-measured on 2.15.0** (#400). The same command, `REPEATS=2 node scripts/benchmark-display-view.mjs --app`, was run on the
`v2.15.0` commit `0e2232f` (build B), interleaved with the #533 build (build A):

- 30 of the 294 parts timed per row, two repeats per build;
- built `dist`, Node 24.19.0, Apple M5 Pro (18 cores), macOS, one thread per process;
- load average 5.7–6.1 from other work, so the times are upper bounds.

Ranges are over the two repeats of build B.

| Options | f | Prepare | Part median | Slowest part | µs per display pixel, median (min–max) | Whole view, one thread (extrapolated) |
| --- | --- | --- | --- | --- | --- | --- |
| Speed | f/8 | 25–26 ms | 39 ms | 150–152 ms | 4.2 (3.6–16.3) | 14.3–14.4 s |
| Speed | f/11 | 26–27 ms | 39 ms | 145 ms | 4.2 (3.7–15.6) | 14.2–14.3 s |
| Quality | f/8 | 49–50 ms | 74 ms | 295–298 ms | 7.9–8.0 (6.8–32.0) | 29.1–29.2 s |
| Quality | f/11 | 50–52 ms | 77–78 ms | 289–307 ms | 8.3–8.4 (7.1–32.9) | 30.1–30.6 s |

The host differs from the 2.9.0 table's, so the two tables do not measure the speed-ups between them. The prepare column
already includes #443 and #446 (above). The slowest parts are the first one (its own warm-up) and those over the chart's busiest areas. The
stand-in label costs a few comparisons per lookup; a caller's label tested by polygon winding costs more (about 3 % of the
self time in one caller's profile). Comparing two builds: `DIST_B=<other dist/index.js> node
scripts/benchmark-display-view.mjs --app` runs them interleaved, alternating which goes first.

The prepare column above predates #443, which runs the channel response's sensor chain once per channel instead of once
per spectral node and keeps it across chart, illuminant and illuminance changes, with the same bytes. Prepares in one process after a
warm-up, the app-request shape, five rounds alternating the builds (Node 24.21.0, load average 1.3): after an aperture
change 378–430 ms → 54–67 ms (Quality) and 110–142 ms → 15–19 ms (Speed); after a chart change 379–435 ms → 34–39 ms
and 108–115 ms → 6–7 ms; after an illuminant change 370–385 ms → 35–47 ms and 108–120 ms → 6–7 ms.

With diffraction on, a prepare also needs one site diffraction kernel per spectral node, which depends only on the
optics (f-number, focal length, focus), the pitch, the kernel radius, the spectral nodes and the field extent. Since #446
the kernels are kept by value for the last four such optics settings, so a prepare after an ISO, white-balance or shutter
change, or a repeat of the same request, reuses them with the same bytes; an aperture, focal-length, focus or pitch change
resolves them again. Prepares in one process, the app-request shape, five rounds alternating the builds: after an ISO
change 37–45 → 9–16 ms at 6 µm f/11, 76–84 → 10–12 ms at 6 µm f/22 and 241–276 → 15–19 ms at
1.4 µm f/11 (Node 24.21.0, one thread, five rounds alternating the builds).

### Defocus

The app-request shape above with `lens.defocus` at kernel radii of 4–60 sites (#492, step 2b). The focus distance is
solved for a disc of 2R + 0.6 sites, in front of the 0.63 m subject or, where the prime cannot focus that close, behind
it. Run as `DEFOCUS_RADII=0,4,8,16,28 ROWS=0,2 PARTS=12 node scripts/benchmark-display-view.mjs --app` at f/8, where the
geometry reaches at most about 30 sites, and `DEFOCUS_RADII=0,32,48,60 ROWS=4,5 PARTS=8` at f/2.8 (opt-in rows).
Conditions: two repeats with the radii interleaved and their order alternating, one fresh Node process per run, one
thread, built from this change on `ef47d7e`, Node 24.21.0, a 4-vCPU Xeon shared with other work (load average 3.9–6.7,
so absolute times run above the table above). Ranges are over the repeats; "view radius" is the combined kernel radius.

| Options | f | Defocus radius (view radius) | Part median | Slowest part | µs per display pixel, median | Whole view, one thread (extrapolated) |
| --- | --- | --- | --- | --- | --- | --- |
| Speed | f/8 | none | 109–119 ms | 292–474 ms | 11.8–12.9 | 36–44 s |
| Speed | f/8 | 4 (4) | 115–141 ms | 305–354 ms | 12.5–15.2 | 41–50 s |
| Speed | f/8 | 8 (8) | 146–198 ms | 431–503 ms | 15.5–21.2 | 52–64 s |
| Speed | f/8 | 16 (16) | 357–359 ms | 872–883 ms | 38.8–39.0 | 121 s |
| Speed | f/8 | 28 (28) | 944–977 ms | 1.82–1.93 s | 102–106 | 292–293 s |
| Speed | f/2.8 | none | 142–199 ms | 461–552 ms | 15.1–21.2 | 61–62 s |
| Speed | f/2.8 | 32 (32) | 1.56 s | 2.76–2.90 s | 165–166 | 448–468 s |
| Speed | f/2.8 | 48 (48) | 3.42–3.45 s | 5.31–5.86 s | 364–367 | 966–979 s |
| Speed | f/2.8 | 60 (60) | 6.39–6.43 s | 8.52–8.62 s | 679–683 | 1672–1679 s |
| Quality | f/8 | none | 150–171 ms | 496–888 ms | 16.0–18.3 | 62–84 s |
| Quality | f/8 | 4 (8) | 250–252 ms | 598–842 ms | 26.8–27.0 | 84–104 s |
| Quality | f/8 | 8 (12) | 355–393 ms | 884–900 ms | 38.5–42.0 | 117–118 s |
| Quality | f/8 | 16 (20) | 579–690 ms | 1.33–1.48 s | 62.2–73.3 | 202–205 s |
| Quality | f/8 | 28 (32) | 1.47–1.49 s | 2.77–2.91 s | 160–162 | 463–479 s |
| Quality | f/2.8 | none | 150–276 ms | 564–831 ms | 16.0–29.6 | 66–99 s |
| Quality | f/2.8 | 32 (34) | 1.68–1.87 s | 3.01–3.41 s | 179–199 | 516–554 s |
| Quality | f/2.8 | 48 (50) | 4.28–4.30 s | 6.32–6.83 s | 455–457 | 1168–1205 s |
| Quality | f/2.8 | 60 (62) | 7.91–8.05 s | 11.6 s | 840–856 | 2126–2129 s |

The prepare time does not grow with the radius here (76–320 ms over every row). Building the combined kernels was timed
apart, in one process, five repeats: one node's diffraction kernel of radius 32 convolved with a disc of radius 32 takes
about 31 ms, so about 0.6 s per prepare at 20 spectral nodes. Smaller combinations take 0.5–6 ms per node.

Without the disc a site reads one point per query offset. With it, a site's expected electrons sum (2R + 1)² taps per
lattice group (four groups for the 2 × 2 box). Sites whose whole window reads one material take the precomputed value,
so the cost is in the parts with edges. It grows about as R². Speed's median per-pixel cost is 1.0–1.3× that of the sharp
view at R = 4 (f/8) and 32–45× at R = 60 (f/2.8), with medians and ranges as in the table.

Up to a disc radius of 64 sites the direct gather above applies. At radii of 30 sites and above, a 96 × 96 part takes
seconds on one thread. The GPU gather of #492 (step 2c, `docs/WEBGPU.md`) is the route for interactive use; its hardware
timing is TBD-TIMING (#475; runs are recorded per device in [the hardware record](WEBGPU_DEVICES.md)).

Above 64 sites (#564) the disc is applied by runs after the in-focus signal, whose cost grows with R rather than R². On the
app's request with an 85 mm-equivalent f/1.4 prime (Speed, subject 3 m; Apple M5 Pro, Node 24.19.0, 8 parts timed, one
round, load average about 5): part medians of 274 ms at R = 64 (direct), 327 ms at R = 179 and 1.10 s at R = 512, and
extrapolated whole views of 431 s, 98 s and 296 s
([Quick start, Large defocus discs](QUICK_START.md#large-defocus-discs-564)).

### Whole views against the 2.5 whole-frame view (2.6.0)

The table below is the 2.6.0 record: whole views of 96–800 pixels wide, mostly on the stratified estimator, against the
2.5 whole-frame view, which no caller renders any more. Both columns have changed since: re-run on `main` at `65decd1`
(Node 24.21.0, same host, load average 4.4), the full-frame star at 384 wide takes 5.7–6.0 s (Speed) and 13.1–13.8 s
(Quality) as a display view, and 0.16–0.20 s and 0.54–0.56 s as a whole-frame view, now that captures take the tabulated
RAW path (2.8.0).

**Method.** `node scripts/benchmark-display-view.mjs`: one fresh Node process per row, a 16 × 16 warm-up capture,
then one timed `simulateDisplayView` of the whole view and one timed 2.5 whole-frame view (a `simulateCapture` at
pitch = sensor width ÷ view width) of the same scene, lens, exposure and options. f/8, ISO 100, default
`samplesPerAxis` (16). Speed is the engine defaults; Quality is `lens.diffraction: "circular-aperture"`, the four-spot
anti-aliasing filter and AHD. "Before" is the display view as first merged (#368), "after" the
[exact speed-ups](#exact-speed-ups). The script times one build per run (its `DIST_B` A/B option is for `--app`
only), so the two columns are two builds run by hand, interleaved row by row, on the same host (built `dist`,
Node 24.21.0, 4-vCPU Intel Xeon 2.80 GHz, Linux, nothing else running). The whole-frame column is the after build's.
One run per cell on one machine: not a performance claim. Rows within about ±10 % are within this host's run-to-run
spread (Speed did not change: six alternating runs of the phone at 384 wide took a median 12.7 s before and 12.8 s
after).

| Chart | Sensor | Options | View | Display view before | Display view after | Speed-up | Whole-frame view (2.5) | Ratio after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Siemens star | 24 MP full frame, 6 µm | Speed | 96 × 64 | 1.9 s | 2.4 s | 0.8× | 1.0 s | 2.3× |
| Siemens star | 24 MP full frame, 6 µm | Speed | 192 × 128 | 4.9 s | 5.1 s | 1.0× | 3.3 s | 1.5× |
| Siemens star | 24 MP full frame, 6 µm | Speed | 384 × 256 | 10.3 s | 10.6 s | 1.0× | 11.5 s | 0.92× |
| Siemens star | 24 MP full frame, 6 µm | Speed | 800 × 533 | 25.0 s | 26.6 s | 0.9× | 40.9 s | 0.65× |
| Siemens star | 24 MP full frame, 6 µm | Quality | 96 × 64 | 15.5 s | 5.2 s | 3.0× | 3.3 s | 1.6× |
| Siemens star | 24 MP full frame, 6 µm | Quality | 192 × 128 | 28.3 s | 10.8 s | 2.6× | 7.0 s | 1.5× |
| Siemens star | 24 MP full frame, 6 µm | Quality | 384 × 256 | 65.0 s | 30.9 s | 2.1× | 24.6 s | 1.3× |
| Siemens star | 24 MP full frame, 6 µm | Quality | 800 × 533 | 162.4 s | 84.3 s | 1.9× | 110.4 s | 0.76× |
| Siemens star | 12 MP phone, 1.4 µm | Speed | 96 × 72 | 2.0 s | 2.2 s | 0.9× | 0.9 s | 2.4× |
| Siemens star | 12 MP phone, 1.4 µm | Speed | 192 × 144 | 5.5 s | 6.3 s | 0.9× | 3.5 s | 1.8× |
| Siemens star | 12 MP phone, 1.4 µm | Speed | 384 × 288 | 12.4 s | 11.7 s | 1.1× | 12.7 s | 0.92× |
| Siemens star | 12 MP phone, 1.4 µm | Speed | 800 × 600 | 32.9 s | 32.1 s | 1.0× | 54.1 s | 0.59× |
| Siemens star | 12 MP phone, 1.4 µm | Quality | 96 × 72 | 221.8 s | 49.7 s | 4.5× | 2.5 s | 20× |
| Siemens star | 12 MP phone, 1.4 µm | Quality | 192 × 144 | 300.9 s | 63.0 s | 4.8× | 7.8 s | 8.1× |
| Siemens star | 12 MP phone, 1.4 µm | Quality | 384 × 288 | 450.3 s | 106.1 s | 4.2× | 27.7 s | 3.8× |
| Siemens star | 12 MP phone, 1.4 µm | Quality | 800 × 600 | 836.6 s | 272.4 s | 3.1× | 126.1 s | 2.2× |
| Siemens star | 100 MP medium format, 3.76 µm | Speed | 96 × 72 | 2.5 s | 2.7 s | 0.9× | 1.2 s | 2.3× |
| Siemens star | 100 MP medium format, 3.76 µm | Speed | 192 × 144 | 7.7 s | 8.0 s | 1.0× | 3.4 s | 2.4× |
| Siemens star | 100 MP medium format, 3.76 µm | Speed | 384 × 288 | 15.7 s | 15.8 s | 1.0× | 13.3 s | 1.2× |
| Siemens star | 100 MP medium format, 3.76 µm | Speed | 800 × 600 | 35.4 s | 32.6 s | 1.1× | 49.7 s | 0.66× |
| Siemens star | 100 MP medium format, 3.76 µm | Quality | 96 × 72 | 64.9 s | 18.2 s | 3.6× | 4.9 s | 3.7× |
| Siemens star | 100 MP medium format, 3.76 µm | Quality | 192 × 144 | 145.3 s | 29.3 s | 5.0× | 8.1 s | 3.6× |
| Siemens star | 100 MP medium format, 3.76 µm | Quality | 384 × 288 | 207.6 s | 49.7 s | 4.2× | 27.5 s | 1.8× |
| Siemens star | 100 MP medium format, 3.76 µm | Quality | 800 × 600 | 423.8 s | 125.8 s | 3.4× | 119.9 s | 1.0× |
| Dead leaves | 24 MP full frame | Speed | 384 × 256 | 19.2 s | 19.1 s | 1.0× | 11.3 s | 1.7× |
| Dead leaves | 24 MP full frame | Quality | 384 × 256 | 95.9 s | 54.3 s | 1.8× | 28.1 s | 1.9× |
| Dead leaves | 12 MP phone | Speed | 384 × 288 | 19.8 s | 18.7 s | 1.1× | 11.5 s | 1.6× |
| Dead leaves | 12 MP phone | Quality | 384 × 288 | 407.8 s | 124.3 s | 3.3× | 29.8 s | 4.2× |
| Dead leaves | 100 MP medium format | Speed | 384 × 288 | 27.7 s | 28.9 s | 1.0× | 12.3 s | 2.3× |
| Dead leaves | 100 MP medium format | Quality | 384 × 288 | 282.3 s | 68.2 s | 4.1× | 26.7 s | 2.6× |

**Speed** costs 0.6–2.4× the whole-frame view at every size and sensor: 0.9–1.2× for the star and 1.6–2.3× for dead
leaves at 384 pixels wide (2.6.0). In 2.6.0 every row was on the stratified estimator, whose cost follows the detailed
display pixels × K², not the 12–100 million real pixels. Since 2.8.0 a display pixel that covers 25 real pixels or
fewer takes the [exact area mean](#exact-area-mean) instead (in this table, the phone's 800-wide rows at 5 × 5 real
pixels), whose cost follows the real pixels it touches: the two regimes at the start of [Cost](#cost).

**Quality** costs more on small pixels, for two reasons that the accuracy requirements impose (12 MP phone star at
96 × 72, one option at a time, before → after: diffraction 55.6 → 8.2 s, AHD 312.5 → 100.1 s):

- *Diffraction at the real pitch.* The Airy pattern's first dark ring at f/8 and 550 nm has a radius of
  1.22·λ·N ≈ 5.4 µm: under one site at 6 µm but almost four at 1.4 µm, so a site's expectation sums 32 × 32 kernel
  taps at 1.4 µm (10 × 10 at 6 µm). At the whole-frame view's giant pitch the kernel is far below one pixel.
- *AHD at low signal.* At ISO 100 a 1.4 µm pixel already has a linear noise of 0.014–0.018, above the 0.01 threshold,
  so every sampled pixel takes the correction. Each grid state the image touches costs 2048 drawn neighbourhoods
  through the AHD steps: about 0.11 s before, about 0.035 s after. The star touches 2 779 states at 96 × 72 without
  diffraction and 1 155 with the Quality options at 384 × 288 (the eight corners around every pixel's channel means
  on the logarithmic grid). With the correction off, a uniform 18 % grey at ISO 100 on that sensor moves by
  −0.11 code in red (+0.05 in blue); at ISO 1600 by −1.07 code. Those are the biases the correction removes.

**Where the phone's 106 s at 384 × 288 went in 2.6.0** (the 2.6.0 profile: a CPU profile of the after build, 108 s under
the profiler; not re-profiled since): the AHD
correction states 40 s (1 155 states × about 35 ms: the 248 000 Poisson and normal draws of each state and its 2048 AHD
evaluations), the per-sample statistics 42 s (14.3 million samples: the site reads, the clips, the two candidates'
moments and the noise terms), the diffraction sums 13 s, the per-sample correction interpolation 2.4 s and the rest
about 10 s. The 60 s aimed for was not reached: the draws of a state, the order of each kernel sum and the
per-sample arithmetic are what the exact result is made of, and the remaining ways to go below them are approximations
(fewer draws per state, a reassociated or transformed convolution) or parallel work in workers, which were not part of
this change. A second view in the same JavaScript realm with the same sensor, exposure and development reuses the
correction states: the same 384 × 288 view again took 72.8 s instead of 102.7 s, a 192 × 144 view after it 29.6 s
instead of 63.0 s; a different scene needs mostly different states (dead leaves after the star: 123.9 s, as cold).

The whole-frame view has neither cost because its giant pixels make one tap and almost no noise per pixel.

**Cost of the portable functions** ([Same bytes in every engine](#same-bytes-in-every-engine)). They take more
operations than the engines' native `Math` (on this host about 39 ns per logarithm against 12 ns, 38 ns per cube
root against 10 ns), which matters where the display view calls them most: the AHD correction states (a normal draw,
some Poisson rejection tests and 126 CIELAB cube roots per drawn neighbourhood). Two changes made with the move recover
part of it: the states use both values of each Box–Muller pair and no longer draw for the 16 sites AHD never reads.
Same benchmark, main before the change and this build, one run each on the same host (the unchanged whole-frame view
varied by up to 26 % between the two runs of a row): Speed, Siemens star at 384 wide, 9.5 → 10.6 s (full frame) and
12.3 → 13.2 s (phone); Quality, full frame star 27.0 → 28.2 s, phone star 47.5 → 60.2 s at 96 wide and 97.2 →
114.6 s at 384 wide, phone dead leaves 117.0 → 122.0 s at 384 wide. The table above is from before the change.

### Exact speed-ups

Quality was made cheaper without changing a byte of any display view: the samples, the expected values, the noise and
every diagnostic, including `sceneLookups`, are the same as before for every request and seed. Each change computes the
same values with the same operations in the same order; none reassociates a floating-point sum.

- **AHD correction states are shared.** A grid state depends only on its indices and the inputs listed in
  [AHD at low signal](#ahd-at-low-signal), so it is computed once and kept, for the rest of the view and for later
  calls with the same inputs (another view size, region or scene of the same sensor, exposure and development): up to
  65 536 states for each of the 4 most recently used input sets, about 50 bytes per state (13 MB at most). A state is also cheaper to
  compute: ln n! for the Poisson sampler comes from a table of the same partial sums, the sampler's per-mean constants
  are computed once per state, the xorshift stream keeps its state in a `Uint32Array` (a uint32 in a closure variable
  was boxed on every step; this speeds every seeded draw in the engine), the AHD steps run on flat arrays without
  temporary objects and skip the four corner candidates their homogeneity step never reads, and the 16 patch sites the
  steps never read skip the normal transform (their uniforms were still drawn, so the stream was where it was; since the
  move to the portable functions below, those sites are not drawn at all and the normals come in Box–Muller pairs).
  The cache belongs to one JavaScript realm (a page, a Web Worker, a Node process); since 2.10 a realm can export its
  states, another can import them, and a prepared view can collect the keys a region needs and compute an assigned
  share, with the same bytes ([AHD at low signal](#ahd-at-low-signal), #447).
- **Diffraction sums are shared, not rearranged.** A site's expected electrons are a sum of kernel taps in a fixed
  order; a separable, summed-area or transform evaluation would reassociate it and change the last bits, so the sum
  itself is kept. With chart materials (every preset): each lattice point is looked up once per display row (a band
  that grows to the right with the windows) instead of once per display pixel; a site whose whole kernel support reads
  one material, found from summed-area tables of material changes, takes that material's value, precomputed once with
  the same sum; other sites run the sum from the band; and site values are kept across the windows of neighbouring
  display pixels (a ring of site rows). The scene lookup count is still the count of the per-pixel lazy cache,
  reconstructed from the sites each display pixel reads. Radiance scenes (caller functions) keep the per-pixel path.
- **One-material samples are replayed.** A sampled pixel whose demosaic sites all read one material has the statistics
  of every other such sample of that material and CFA phase, so the terms it adds to the display pixel's sums are
  recorded once and added again in the same order (with the display pixel's own footprint weights).
- **Zero terms are skipped.** The covariance and third-cumulant sums of each AHD candidate skip the sites where its
  weights are zero (adding ±0 to a sum that starts at +0 changes nothing).
- **Site values and moments are kept per render (#441).** On the exact area mean with diffraction on chart materials
  (filled windows), a real pixel's demosaic reads 27 (AHD) or 7 (bilinear) native sites, and neighbouring real pixels
  read mostly the same ones. A ring of native rows over the
  part's columns keeps each site's expected electrons, chart material and readout moments (mean, variance and third
  cumulant after the white-level clip) after its first read; later reads copy them. The expected signal's window is told
  which of its sites were read this way (`markReads`), which does for each site what a first `site` call does for the
  window's lookup count, so `sceneLookups` is unchanged. Every real pixel still receives the same values in the same
  order. Coarse (stratified) views, views without diffraction (whose sites the signal's direct ring already serves; the
  ring measured 2–4 % slower there) and radiance scenes with diffraction (lazy window caches) keep the per-read path.
  Measured on the app-request shape (Node 24.21.0, one thread, two runs of three repeats, builds alternated): Quality
  part medians 169–194 → 148–164 ms at f/8 and 177–187 → 154–164 ms at f/11; Speed, which does not use the ring, within ±3 %.
- **The lookup count is computed once per group shape (#445).** `sceneLookups` counts, for each filled window, the
  lattice points the per-pixel lazy caches would have looked up (a box dilation of the sites the window computed, per
  lattice group). The count depends only on those sites and the group's rectangle and cache sizes, so groups of one shape
  (the four lattice groups of four-spot anti-aliasing with the 2 × 2 box) share one count; the OR of a cache row's site
  rows comes from prefix and suffix ORs; and a window whose every site was computed counts its whole caches. The count
  is the same integer as before (a test compares it with the previous algorithm and with the definition on random
  windows); no image value is involved.
- **The render loop's tables have one element kind each (#442).** The readout tables (gain, dark electrons, read
  variance and its square root) and the homogeneity white are `Float64Array`s instead of plain arrays, the per-phase
  candidate tables are flat arrays of typed arrays (index phase·2 + candidate, and ·3 + channel) instead of nested
  arrays, and a site's window offset comes from two per-render integer tables instead of a modulo and a division per
  read. They hold the same numbers and the loop does the same arithmetic on them in the same order; the change only
  stops V8 from discarding the render loop's optimized code when its loads met another array shape. Measured on the
  app-request shape (Node 24.21.0, one thread, three repeats, builds alternated, against #441): Quality part medians
  148–156 → 143–151 ms, Speed 83–91 → 79–84 ms.
- **One-material samples are replayed without diffraction too (#444).** Without diffraction a site's expected
  electrons are the weighted sum of the scene at its query points (four with the 2 × 2 box); the expected signal now
  reports the chart material when every point read the same one, and its direct ring and window cache keep that material
  beside the value, so the one-material memo applies on the Speed path as it does with diffraction. A one-material site
  sums the same operands in the same order as every other such site of its channel, so it holds the same value. A sample
  whose sites read two materials is not replayed; it takes its site statistics as it reads its sites from the first site
  of a second material on, rather than in a second pass. Radiance scenes are not tracked. Measured on the app-request
  shape (Node 24.21.0, one thread, four repeats, builds alternated, against #445): Speed whole-view CPU, extrapolated
  from 30 parts, 31.0–32.1 → 28.8–32.0 s (part medians 82–89 → 73–89 ms); the Siemens-star centre part, whose samples
  read two materials, is slower, 202–342 → 234–341 ms (one part per process, six repeats). Quality is unchanged.
- **Chart tables are shared by requests of equal numbers (#449).** The expected signal's tables (materials, lattice
  groups, combined diffraction kernels, whole-kernel material sums) are a function of the spectral nodes, channel
  responses, query offsets, kernel taps and material values alone, so for chart materials they are kept by those numbers
  (compared bit for bit, the 4 most recently used) as well as per prepared view: single `simulateDisplayView` calls and
  captures of one request build them once. Each render keeps its own window state, and the lattice material rings stay
  per prepared view. Radiance scenes are not shared. Measured on the app-request shape (Node 24.21.0, one
  thread, builds alternated, against #444): a prepared view's parts are unchanged (medians 68–73 ms in Speed and
  124–135 ms in Quality with both builds); the capture of the Quality 96 × 64 detail tile, median 116 → 95 ms per call.

**Proof of byte identity.** The display views of all 155 validation cases at their seeds (the requests of
`validate-display-view.mjs`, Speed and Quality, three sensors) were hashed before and after (SHA-256 of the samples, of
the expected values and noise, and of the whole result with the timings removed): all identical, with the later cases
reusing the earlier cases' correction states in the same process. A test locks six more requests that exercise each
path (uniform and mixed diffraction sites, the AHD correction, spectral materials with mirror borders, a radiance
scene, AHD with a tone curve, Speed) to hashes recorded before the change, and another checks that shared states give
the same bytes as fresh ones (at that time the display view still used `Math.pow`, whose last bit differs between
Node 22 and Node 24, so the test held each runtime to its own recording; byte identity before and after was checked on
both). The capture hash locks and the facade fingerprints of 15 default-path results are unchanged. The display view
has since moved to the engine's portable functions (next section), which changed its last bits once; the six requests
are now locked to one set of hashes for every runtime.

### Exact area mean

From 2.8.0 (#393), a display pixel whose rectangle holds at most 25 real pixels (and at most `view.samplesPerAxis`²,
so views at least 1/5 of the frame's width) is not sampled: every real pixel it touches is evaluated once and
weighted by its exact overlap, w_j / A, so its expected value is the definition D_P = Σ_j (w_j/A)·E[L_j] with no
sampling error. The linear noise keeps the closed-form term and the independent residual becomes Σ_j (w_j/A)²·r_j. A
real pixel's terms are recorded once and shared by the display pixels that touch it (a ring of native rows), so at
device-pixel sizes the view does about one real pixel's work per real pixel. Coarser views keep the stratified estimator
and their bytes; the `view.estimation` assumption names the method used. This is a deliberate reference change, not a
byte-identical speed-up: the views that take the exact path have new hashes, and a test checks that a half-size and a
2/3-size view equal the overlap-weighted means of the frame-size view's per-pixel expected values. On the app's 8-row
strips of a 24 MP frame at 2028 × 1352 (one thread, one run) Speed went from 0.97–1.04 s to 0.77–0.85 s against 2.7.0.
The limit of 25 real pixels is where the exact path stops paying: on 8-row strips of a 24 MP view (Siemens star and dead
leaves, f/2.8, one thread, one run each) it took the stratified estimator's time within run-to-run spread up to 25 real
pixels per display pixel and longer above (1.1–1.2× at 36, 1.4–1.5× at 64, 1.5–2.4× at 144), because it evaluates every
real pixel while the estimator takes a quarter of its samples per axis where the pilot finds no detail. The validation
cases are re-run on this reference before the release.

## Bundle size

Measured October 31, 2026 (#383) on 2.11.1 with rolldown 1.2.9, the bundler Vite 8 uses: consumers that import only the named
root exports of the built package, minified, gzip level 9; `test/capture-bundle.test.ts` measures the same bundles from `src/`.

| Consumer imports | Split ESM (a page): first load | One file, no splitting (Vite's default `iife` worker) |
| --- | --- | --- |
| `simulateCapture`, `simulateIdealReference` | 846,928 B / 229,007 B gzip | 851,205 B / 230,679 B gzip |
| the same and `simulateDisplayView` | 889,156 B / 245,895 B gzip | 893,562 B / 247,758 B gzip |
| `simulateCapture`, `simulateDisplayView`, `prepareDisplayView` | 892,566 B / 247,193 B gzip | 1,055,900 B / 302,217 B gzip |

- **The display view adds 42,228 B minified and 16,888 B gzip (16.5 KiB) to a capture bundle** (42,239 B and 16,888 B in
  the test's build from `src/`), the "about 16.9 KiB" of #383. By rendered (unminified) size the addition is the renderer `facade/display-view.ts` (55 %), its setup and result in
  `facade/simulate-display-view.ts` (21 %, much of it the assumptions' explanations, which are part of the result), the
  portable functions of [Same bytes in every engine](#same-bytes-in-every-engine) (13 %), and shared readout, chart and
  illuminant code and the GPU option parsing (11 %). #383's target, 40 % of the gzip addition (6.8 kB), is about three
  quarters of the renderer if its gzip share follows its rendered share; the renderer's repeated site loops are written out
  for speed (#441, #442, #444), so the target is not met here: no smaller form was found that keeps every result's bytes and
  the measured render times. #457's AHD choice (#527) then added 3,307 B minified and 1,294 B gzip, all in the renderer
  (rendered 55,908 → 64,855 B): the test's build measures 45,546 B and 18,186 B gzip. The test keeps the addition within
  46,500 B minified and 18,550 B gzip (about 2 % above the measured size; 43,100 B and 17,250 B before #527); a change that
  adds to the display view raises the budget there and records its delta.
- **Lens character is loaded on demand (#563).** The expected signal through a lens mapping, vignetting or rotation
  (`facade/display-view-lens-signal.ts`) is imported dynamically by `runCapture`, only for a display view with those
  options: a 4,380 B (2,173 B gzip) chunk. The display view's addition is then 46,341 B minified and 18,527 B gzip
  (rolldown 1.2.9; 46,380 B and 18,540 B before: a simpler Kelvin white-balance branch and one view-region expression
  more than pay for the lens hook), within the unchanged budget; the capture-only entry grows by 642 B (212 B gzip) for
  the request setup in `runCapture`, and a splitting bundler emits the chunk for capture-only consumers too, never loaded.
- **The GPU display view is loaded on demand.** `prepareDisplayView` imports `facade/display-view-gpu-session.ts` (the GPU
  session, the Speed and Quality renderers and their WGSL) dynamically, and only when `gpu` is `"auto"` or `"require"`, so a
  bundler that splits dynamic imports puts it in a chunk the default `gpu: "off"` never loads (52 kB gzip, 15 `src/gpu`
  modules). The package is `"sideEffects": false` and the root barrel's GPU exports drop out when they are not imported. A
  build that cannot split inlines every dynamic import: Vite builds workers as `iife` by default, which adds the GPU code to a
  worker that calls `prepareDisplayView` (55 kB gzip above). Build such workers as ES modules (Vite: `worker: { format: "es" }`;
  the worker must then be created with `{ type: "module" }`) to keep it out. Measured on the Photivra app's production build
  (Vite 8.3.2, engine 2.11.1): its capture worker went from 1,093,459 B / 317,120 B gzip to 921,285 B / 258,618 B gzip, with
  the GPU session in a separate chunk, and its page entry was unchanged.
- **Shipped shaders are minified (2.14, #536).** `npm run build` strips comments and indentation from the WGSL source
  (`scripts/minify-wgsl-dist.mjs`, see [WebGPU, Shipped shader text](WEBGPU.md#shipped-shader-text)). Measured on the app's
  production build (Vite 8, app 0.50.0 at `a82a5eb`, engine `main` at `42ec9d8` packed before and after): the GPU session
  chunk went from 159,675 B / 52,917 B gzip to 142,399 B / 46,430 B gzip (−6,487 B gzip), and the app's total JavaScript from
  500.7 KiB to 494.1 KiB gzip.
- **Module-level frozen tables are `/* @__PURE__ */` (2.14, #536).** 110 `Object.freeze(<literal>)` calls that build
  module-level constants carry the annotation, so a bundler drops a table nothing imports. A consumer that imports only
  `SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX` went from 2,542 B / 1,175 B gzip to 729 B / 457 B gzip (rolldown, minified).
  Freezes inside functions and initializers that call other code are unchanged.

## Same bytes in every engine

ECMAScript defines `+`, `−`, `×`, `÷` and `Math.sqrt` as correctly rounded binary64 operations, but leaves `Math.pow`
(and `**`), `Math.exp`, `Math.log`, `Math.cbrt`, `Math.cos` and the other transcendental functions
"implementation-approximated" (ECMA-262, `Number::exponentiate` and §21.3.2, "Function Properties of the Math Object"). They do differ: measured on
200 000 arguments each, Node 22 (V8 12) and Node 24 (V8 13) differ in the last bit of `x ** (1/2.4)`, `x ** 2.4`,
`x ** 1.4` and integer powers such as `λ ** 5` (V8 13 rounds `x ** 5` correctly in 99.9 % of cases, V8 12 in 90 %), but
agree on `exp`, `log`, `cbrt`, `sin` and `cos`; Chromium 141 also differs from Node in `sin` and `cos`, and Chromium 153
and Bun 1.4 (JavaScriptCore) in nearly all of them.

So the display view's own arithmetic uses only correctly rounded operations and the engine's portable functions
(`src/core/portable-math.ts`): logarithm, exponential, power, cube root, e^x − 1 and cos/sin of 2πu, each a fixed
sequence of `+ − × ÷`, exact power-of-two scaling and integer operations, within 1 ulp (2 ulps for e^x − 1, cos and
sin) of the exact function. Methods: double-double arithmetic (Dekker 1971; Knuth, TAOCP vol. 2, §4.2.2), log via
2·atanh((m − 1)/(m + 1)) and 2^r by its Taylor series after additive range reduction (J.-M. Muller, *Elementary
Functions*, 3rd ed., 2016, ch. 11); the bounds were checked against 60-digit decimal references. They replace:

- the sRGB encoding of the drawn value and the slope of its quantization variance (x^(1/2.4), x^1.4);
- the normal density in the clip moments (exp), the Gauss–Legendre starting points (cos), CIELAB's cube root in the AHD
  correction, the correction grid (2^x, log2) and squares (`**2` becomes a product);
- the Box–Muller normal draws (log, cos and sin; the correction states use both values of each pair and no longer draw
  for the 16 sites AHD never reads) and the Poisson draws of the AHD correction states (exp, log, ln n!);
- the scene illuminant: the engine's own formulas (Planck's law, CIE illuminant A, the daylight-locus polynomial) are
  evaluated with the portable power and e^x − 1, and the view's irradiance scale, radiances and scene-illuminant white
  balance are computed from that evaluation; a Kelvin white balance takes its white point from the Planckian locus
  evaluated the same way; a step wedge's equal-density levels use the portable power. These differ from the
  capture's own values by at most a few ulps.

Captures keep `Math` and `**`: their bytes are a 2.x guarantee. The display view therefore still takes some inputs
from the capture's code: the sensor's spectral response, the CIE 1931 colour-matching fit (`Math.exp`), the diffraction
kernels (`Math.sin`, `Math.cos` and others), the chart geometry (`Math.atan2` and others) and an automatic exposure.
The capture's query arithmetic and the view's copy of it no longer use `Math.hypot`: both take `hypot3`, V8's
three-argument `Math.hypot` sequence written as correctly rounded operations, so the query points have V8's bits in
every engine (#452; on V8 nothing changed). Their bits are the same on every Node.js version tested, so the
display view is byte-identical across them: the six hash-locked requests give one set of hashes on Node 22.13.0,
22.22.0, 24.21.0 and 26.12.0, and so did 156 other requests on Node 22.13.0, 24.21.0 and 26.12.0 (three sensors, Speed
and Quality, six charts, four f-number and ISO pairs; plus CIE A, a 3200 K blackbody, a daylight basis, Kelvin, fixed
and no white balance, the tone curve, mirror borders, a 21-step equal-density wedge, a composite chart, and
aperture-priority and program exposure). In browsers whose `Math` differs (Chromium 141 with diffraction, Chromium 153,
Bun/JavaScriptCore) those inputs, and with them the expected values and noise, differ in the last bits; the samples of
the six requests were identical there too. The capture's own floating-point results differ in the same browsers (for
example its diffraction kernels), while its samples were identical in every case tested.

Those Node.js measurements were on x64. V8's `Math` also differs by one ulp between arm64 and x64 for some arguments
(#508: `sin`, `cos`, `asin`, `atan2` and `log`; first `Math.log(14)` in the first hash-locked request), so on arm64 (Apple
silicon, Linux arm64) five of the six hash-locked requests give other bytes, the same on macOS and Linux. The tests lock
them to their own arm64 hashes ([numerical correctness](NUMERICAL_CORRECTNESS.md), "Test hash locks and platforms").

## Rendering on the GPU

2.11 (#481) adds the engine API through which a prepared display view chooses between a WebGPU renderer and the CPU
reference and labels which ran. The engine's renderer (registered when the GPU session module loads) runs the Speed kernel of
#478 for requests without diffraction and AHD (the exact area mean, bilinear; `docs/WEBGPU.md`, "Display view (Speed) on the
GPU") and the Quality kernels of #479 for the rest of what it covers: diffraction kernels, the anti-aliasing filter's spots, the
AHD candidates and the low-signal correction, whose states are still computed on the CPU and uploaded as a table
(`docs/WEBGPU.md`, "Display view (Quality) on the GPU": the three passes, the running bounds, the measured agreement and the
AHD placement decision). Both render every engine chart (the 2.0 presets, composite charts, the 2.3 elements, fixed-size charts)
and, since #491, declared `material-layers` scenes: a chart under shape-mask layers, the form in which an application gives a
printed label (`resolveChartMaterialLayers`; `scene: { kind: "material-layers", sceneId, chart, layers }` is accepted by
`prepareDisplayView`, `simulateDisplayView` and `simulateCapture` directly and evaluated exactly as its `callerScene`, so a CPU
render is byte-identical to the caller-scene form). Since #581 both paths also render `image-plane` prints (a photo as a
print; [Image-plane scene, On the GPU](IMAGE_PLANE.md#on-the-gpu)). A request it does not cover (a caller scene function, a coarser view than the
exact area mean, a footprint above 6 real pixels per axis) runs the CPU reference labelled `unsupported-on-backend` (or fails with
it). A GPU render of the Quality options inherits the estimate's [known limit](#known-limit-quality-noise-at-small-footprints)
(#379): it agrees with the CPU reference within its bound, not with the real AHD capture any better than the reference does.
The Quality kernel does not compute [AHD's choice on the noise-free mosaic](#ahds-choice-where-the-scene-decides-it-457) (#457):
it renders the candidates' average and flags a display pixel for recomputation with the CPU reference where the choice could
move it by more than 2⁻¹⁰ of its noise σ (`docs/WEBGPU.md`, "Flags and host recomputation"), so a GPU render keeps the
reference's values at structure at the cost of recomputing those pixels on the CPU. The [highlight count](#highlight-count-533)
(#533) is the reference's too: the kernels decide each real pixel's saturation where it is certainly 0 or 1, and the host
computes the count of any other display pixel with the reference, without changing its samples. The speed-up over the CPU is
not measured yet (#475).

```ts
import { prepareDisplayView, type SimulateCaptureOptions } from "@photivra/engine";

const request: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, sensor: { pixelPitchMicrometers: 4 }, output: { width: 600, height: 400 } };
// "off" (the default) is the CPU reference, today's bytes. "auto": the GPU when a conforming device is available and
// the request is supported, else the CPU, labelled. "require": fail instead of falling back.
const prepared = await prepareDisplayView(request, { gpu: "auto" });
const part = await prepared.render({ width: 200, height: 133, region: { x: 90, y: 60, width: 24, height: 24 } });
const ran = part.diagnostics.fast.execution;
console.log(ran.backend, ran.fallbackReason, ran.errorBound, ran.adapter?.description); // in Node: "cpu-reference" "unsupported-on-backend" null undefined
prepared.dispose(); // releases a device the view acquired
```

**The option.** `prepareDisplayView(request, { gpu, gpuDevice })`:

- `gpu: "off" | "auto" | "require"`, default `"off"`. The words are the accelerator's (`docs/WEBGPU.md`): `"auto"` is
  `backend: "webgpu-f32"` with `fallback: "cpu-reference"`, `"require"` is `fallback: "fail"`, `"off"` is `backend: "cpu-reference"`.
  With `"off"` every byte is as before; the hash locks of `test/display-view.test.ts` leave `diagnostics.fast` out and are unchanged.
- `gpuDevice`: where the device comes from. A worker's `navigator.gpu` (the engine acquires a device from it), or an
  `ImageKernelAccelerator` whose device the view shares and leaves to its owner (the app's design has one dedicated GPU
  worker own one device for the page, Photivra/apps#126). Without it, and only with `"auto"` or `"require"`, the engine
  acquires one device from `globalThis.navigator.gpu` for the prepared view. It is refused with `"off"`.
- `simulateDisplayView` has no GPU option; it is the CPU reference.

**Order of decisions** when the view is prepared, each a fallback reason for `"auto"` and an `ImageKernelExecutionError`
with that reason for `"require"`:

1. The realm's switch: `setWebGpuEnabled(false)` gives `webgpu-disabled`, and no adapter is requested.
2. No GPU display-view renderer registered (this version): `unsupported-on-backend`, no adapter requested.
3. The device: the handle's, or acquired with the accelerator's rules and reasons (`webgpu-unavailable`,
   `adapter-unavailable`, `device-request-failed`, `insufficient-limits`, `unsupported-platform-endianness`). The request's
   own `signal` aborts the acquisition. A disposed accelerator handle is a configuration error; one on the CPU reference
   gives its own fallback reason (`webgpu-unavailable` when it has none).
4. A request with `lens.projection`, `lens.distortion`, `lens.vignetting` or camera rotation (#563) gives
   `unsupported-on-backend` before the device step, with no adapter requested: the CPU reference renders it.
5. The renderer must support the request (AHD, diffraction, the anti-aliasing filter, the pixel aperture, the tone curve
   and the scene kind: a chart or `material-layers`, not a caller function): `unsupported-on-backend` otherwise, and a device
   the view acquired is released.

**At render time**, one device per prepared view, shared by its parts:

- *Conformance self-check.* Before the device's first display-view render, once per prepared view and single-flight (concurrent
  first renders wait for the one check), a handful of conformance cases run on the device: the built-in cases run the existing
  `webgpu-f32` convolution kernel on two small seeded images (16 × 12, radius 1; 32 × 24, radius 3 with 2 × 2 patches) and
  compare every output with the float64 reference within the kernel's a-priori bound; the renderer's own cases follow (the hook
  for #478's preview-kernel cases). A failed case, or a device error during a case, keeps the whole view on the CPU, labelled
  `conformance-failed`, with the adapter, the case ids and the failing case recorded in `diagnostics.fast.execution.conformance`.
- *Single flight.* GPU renders of one view run one at a time on its device; concurrent `render` calls queue rather than
  reject with `busy`. CPU renders are unaffected.
- *Refused at render time.* What only a render can tell (a view coarser than the exact area mean, a footprint above 6 real
  pixels per axis, a device on which neither product path of the composite chart kernel's arithmetic probe holds, #491 and
  2.11.0) makes the renderer throw
  `unsupported-on-backend`; that render runs the CPU reference with that label, or fails under `"require"`, and the next
  render asks the renderer again.
- *Device loss.* A render during which the device is lost falls back to the CPU for that render, and every later render of the
  view runs on the CPU, labelled `device-lost`. With `"require"` that event is an error.
- *Abort.* A render's `signal` aborts its GPU dispatch; the render rejects with the engine's abort error, as a CPU render does.
- `dispose()` releases a device the view acquired (not one an accelerator handle shares) and the scene records the renderer
  uploaded for it. Later renders run on the CPU
  labelled `disposed`, or fail with it.

**The label.** `diagnostics.fast` (#395's report) gains `execution`, a `DisplayViewExecution`: `ImageKernelExecution`'s
fields (`backend`, `requestedBackend`, `fallbackReason`, `arithmetic`, `assurance`, `fast`, `bitIdenticalToReference`,
`errorBound`, `diagnosticsExact`, `diagnosticUncertaintySampleCount`, `limitations`) plus `gpu` (the mode), `adapter`
(the device's `GPUAdapter.info`, recorded whenever a device was involved, also when the view then fell back) and
`conformance` (the self-check once it has run), and since 2.11.0 `compositeProbe`: the composite chart kernel's device probe
when the render needed it (composite charts, the 2.3 elements, `material-layers` scenes), with the device class (`exact`,
`contracted`, `reassociated`, `other`), the product path the kernel ran with (`dekker`, `fma`, or null on a refusal), whether
`fma` is fused, and the differing components with their probe inputs and float32 bits; on a refusal it is on the CPU
fallback's label (`"auto"`) and on the error `"require"` throws (`probe`), so the fallback says why; null otherwise
([WebGPU, the device probe](WEBGPU.md#composite-charts-chart-elements-and-mask-layers-477)). A CPU render, with or without a GPU request, keeps `backend: "cpu-reference"`,
`assurance: "engine-reference"`, `fast: false` and `errorBound: null`; a fallback names its reason and, in `limitations`, a
sentence saying why. A GPU render reports `backend: "webgpu-f32"`, `arithmetic: "float32"`, `fast: true`,
`assurance: "approximation-with-a-priori-bound"`, its `errorBound`, the adapter, and `diagnostics.fast.assurance` follows it;
it also adds the assumption `view.execution`, so the comparison rule (everything that differs between two results is
listed) holds and an app can show "estimated on the GPU". `simulateDisplayView` and `gpu: "off"` report `gpu: "off"`,
`requestedBackend: "cpu-reference"` and no fallback reason.

**The renderer contract** (internal, `src/facade/display-view-gpu.ts`), which #478 implements: a factory
`(runtime: DisplayViewGpuRuntimeHandle) => DisplayViewGpuRenderer` registered with `setDisplayViewGpuRendererFactory` (the handle
is the engine's `WebGpuRuntime` seen through its WebGPU-free members, so no WebGPU type reaches the published declarations;
a renderer in the engine casts it), where a renderer has an `id`,
`supports(request)` (true, or a sentence saying why not), `render({ setup, signal })` returning the CPU renderer's result
shape (samples, expected values, noise, counts, estimation) plus the a-priori `errorBound` of its values, and optional
`conformanceCases`. A render must throw `ImageKernelExecutionError` with reason `device-lost` or `aborted` for those two
events, as the accelerator's operations do. The only implementation today is the test fake of
`test/display-view-gpu-option.test.ts`, which returns the CPU result (or one perturbed sample) with a declared bound.

**Evidence.** `test/display-view-gpu-option.test.ts`, with the accelerator tests' fake WebGPU device (a float32 emulation
of the kernels) and the fake renderer: the option's validation; `"off"` and the default equal `simulateDisplayView` byte
for byte and carry the CPU label; without a renderer `"auto"` falls back and `"require"` fails with
`unsupported-on-backend` and no adapter is requested; the switch's veto; a GPU render's label, bound, adapter and passed
self-check, the self-check running once (two dispatches, one per built-in case) and `dispose()` releasing the device;
single flight under concurrent renders; a failed renderer case and a device that rejects the convolution kernel
(`conformance-failed`, adapter recorded, not repeated; `"require"` throws); loss during a render and between renders;
an unsupported request releasing the device; a missing adapter; the accelerator handle sharing its device without
destroying it, a disposed one refused, a CPU one falling back; `globalThis.navigator.gpu` absent in Node; and a render's
signal aborting a GPU render. The host of this work has no GPU. On hardware, the #480 harness renders through this API
(`gpu: "require"`); the owner's Apple M5 Pro passed it, 26 of 26 cases, at the 2.11.0 release gate (October 28, 2026,
`main` at 78f2731; [hardware record](WEBGPU_DEVICES.md)). Other devices are #475.

## Limits and refusals

`simulateDisplayView` refuses, with an `InvalidConfigurationError` that names the option, the capture
options whose expected signal it cannot tabulate on the site lattice or whose statistics it does not
model:

- `lens.pupilSampling` and `lens.psf`: pupil rays and caller PSFs are not tabulated (for defocus use `lens.defocus`:
  [Defocus](#defocus));
- camera rotation with `motion.shutter: "rolling"`, and a lens mapping or vignetting profile that does not reach the
  view's farthest source point ([Lens projection, distortion, vignetting and rotation](#lens-projection-distortion-vignetting-and-rotation));
  projection, distortion, vignetting and rotation themselves render since #563, and `lens.catalogue` since #569
  ([Catalogue lenses](#catalogue-lenses-569));
- `lens.defocus` with a disc radius above 512 sites (as the capture refuses it; 64 before 2.17.0);
- `output.whiteBalance: "auto"`: the capture measures it from its noisy full-resolution RAW (use
  `"scene-illuminant"` or a fixed white balance, as for region tiles);
- luminance tone curves (`extended-reinhard-luminance`, `naka-rushton-luminance`) and
  `output.highlightMode: "reconstruct"`, which couple the channels non-linearly;
- `output.region` (pass `view.region` in display pixels instead).

A still camera with a rolling shutter is accepted (each site's window has the same length, so the
expected signal is unchanged). The capture's file-format options (`format`, `colorEncoding`,
`bitDepth`, `gamutMapping`, `jpegQuantizationStep`, `dng`, `metadata`) do not apply: the view shows the
capture's sRGB rendering, as `srgb-8` (default) or `srgb-16`. `onProgress` is not called; `signal`
cancels the view.

Approximations, recorded in the `view.*` assumptions:

- each sampled pixel's noise is treated as normal for the non-linear steps, with the first-order
  Edgeworth (skewness) term on the clip at 0; higher cumulants are not modelled;
- the noise of the display pixel is drawn as one correlated normal value;
- the residual variance of the clips is treated as independent between neighbouring pixels;
- AHD's candidates are averaged, and its choice is corrected only where a pixel's noise exceeds 0.01,
  with the bias of a flat neighbourhood of the pixel's channel means (an approximation at edges);
- JPEG compression of a JPEG export is not part of the view.

## Sources

- M. Pharr, W. Jakob, G. Humphreys, *Physically Based Rendering: From Theory to Implementation*, 3rd ed.,
  free at <https://pbr-book.org/3ed-2018/> (§7.8 image reconstruction and the box filter; §13.8
  stratified sampling).
- OpenCV documentation, `cv::resize` interpolation flags (`INTER_AREA`: resampling using pixel area
  relation), free at <https://docs.opencv.org/4.x/da/d54/group__imgproc__transform.html>.
- C. Poynton, *Frequently Asked Questions about Gamma* (1998), free at
  <https://poynton.ca/GammaFAQ.html> (linear-light versus gamma-encoded arithmetic); W3C CSS Color
  Module Level 4 (sRGB transfer functions), free at <https://www.w3.org/TR/css-color-4/>.
- MIT OpenCourseWare 6.003 *Signals and Systems* (Fall 2011), lectures on sampling and aliasing, free at
  <https://ocw.mit.edu/courses/6-003-signals-and-systems-fall-2011/>.
- A. B. Owen, *Monte Carlo theory, methods and examples* (2013), free at
  <https://artowen.su.domains/mc/> (§8.4 stratification, §8.9 control variates).
- C. M. Stein, "Estimation of the mean of a multivariate normal distribution", *Annals of Statistics*
  9(6), 1981, free at <https://projecteuclid.org/journals/annals-of-statistics/volume-9/issue-6/>
  (Stein's lemma: Cov(g(X), X) = E[g′(X)]·Var(X) for normal X).
- NIST/SEMATECH *e-Handbook of Statistical Methods*, §2.5.5 propagation of error, free at
  <https://www.itl.nist.gov/div898/handbook/>.
- W. R. Bennett, "Spectra of quantized signals", *Bell System Technical Journal* 27(3), 1948, free at
  <https://archive.org/details/bstj27-3-446> (quantization noise Δ²/12).
- G. H. Golub, J. H. Welsch, "Calculation of Gauss quadrature rules", *Mathematics of Computation* 23(106), 1969, free at
  <https://www.ams.org/journals/mcom/1969-23-106/> (nodes as the Jacobi matrix's eigenvalues); NIST *Digital Library of
  Mathematical Functions* §3.5(v), Gauss quadrature, free at <https://dlmf.nist.gov/3.5#v>.
- E. Reinhard, M. Stark, P. Shirley, J. Ferwerda, "Photographic tone reproduction for digital images", *ACM SIGGRAPH* 2002
  (eq. 4, extended Reinhard), and K. I. Naka, W. A. H. Rushton (1966), via E. Reinhard, K. Devlin, "Dynamic range reduction
  inspired by photoreceptor physiology", *IEEE TVCG* 11(1), 2005: the tone curves' forms, as cited in src/output/sdr-rendering.ts.
- M. Abramowitz, I. A. Stegun, *Handbook of Mathematical Functions*, NBS AMS 55 (1964), free US government
  work (26.2.17 normal distribution function; 25.4.29 Gauss–Legendre quadrature).
- EMVA Standard 1288 Release 4.0 Linear, free at <https://www.emva.org/standards-technology/emva-1288/>
  (photon transfer: shot, read and quantization noise of a pixel).
- K. Hirakawa, T. W. Parks, "Adaptive homogeneity-directed demosaicing algorithm", *IEEE Transactions on
  Image Processing* 14(3), 2005 (the AHD candidates and homogeneity choice, as in `createAhdDemosaicTask`).
- P. D. Burns, "Slanted-Edge MTF for Digital Camera and Scanner Analysis", Proc. IS&T PICS 2000, free at
  <https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2000/PICS-0-81/1621.pdf>.
- Z. Wang, A. C. Bovik, H. R. Sheikh, E. P. Simoncelli, "Image quality assessment: from error visibility
  to structural similarity", *IEEE Transactions on Image Processing* 13(4), 2004, free at
  <https://www.cns.nyu.edu/pub/eero/wang03-reprint.pdf>.
