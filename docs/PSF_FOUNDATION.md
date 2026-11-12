# PSF and Pupil Foundation

> **Release context.** This page was written for package 1.2.0 (root API 1.2.0) and has not been re-reviewed for later releases. The [changelog](../CHANGELOG.md) describes the current release. Model and subsystem version numbers on this page, and any dated records, are separate from the package version. See also the [developer guide](DEVELOPERS.md) and the [1.2.0 release contract](RELEASE_1_2_0.md).

A PSF (point-spread function) is the image a lens makes of a single point of light. Photivra has two PSF layers that work together:

- **Legacy diagnostics.** These keep two ideal measures separate, named and independently testable: the **geometric defocus circle** and the **circular Airy first-zero diameter**.
- **Real-lens framework** (introduced in issue #113). This adds **combined PSFs of the main optics**, either from an explicit profile or derived from the pupil. It never turns the older diagnostics into a synthetic blur score.

## Legacy diagnostics

Use `getPsfFoundationContract()` and `calculatePsfFoundationComponents()` for the established diagnostics. They share one context for field position, depth, wavelength and pupil.

The foundation contract is version `0.3.0`.

Diagnostic contributions:

- geometric defocus circle;
- circular diffraction first-zero diameter.

Framework contributions:

- ideal regular-polygon diffraction density (on-axis, in focus);
- mechanical pupil clipping / cat's-eye PSF shape;
- field curvature;
- aberration that varies across the field;
- bokeh and signed-defocus response that vary across the field.

The ideal polygon API does not infer diffraction for curved blades, off-axis positions or clipped pupils.

The legacy component calculator still returns no combined PSF. This is deliberate. A combined PSF is available only when an explicit real-lens profile or complex pupil supplies enough information to justify it.

## Ideal polygon diffraction

`calculateIdealPolygonDiffractionPsf()` computes the diffraction pattern of an ideal regular-polygon aperture. It reuses the regular-polygon geometry and image-plane conventions. It evaluates the continuous Fourier transform analytically, rather than drawing the pupil onto the real-lens framework's bounded DFT (discrete Fourier transform) grid. That avoids a second sampled approximation of the same ideal aperture. Arbitrary sampled complex pupils and aberration phase still belong to the real-lens framework.

**Inputs** are all explicit:

- equal-area physical pupil diameter;
- pupil-to-image propagation distance;
- wavelength, with its air or vacuum basis resolved;
- blade count and orientation;
- image-plane displacements in micrometres (+X right, +Y up).

A nonzero displacement is a position within the **on-axis PSF**. It is not an off-axis source position in the field. There is no implicit wavelength conversion, and no implicit conversion from focus to propagation distance.

**Pupil size.** For a polygon with unit circumradius, the area is `A_unit = n sin(2π/n)/2`. The physical radius is `sqrt(A/A_unit)`, with `A = π(D_equal_area/2)²`. This fixes the polygon's area, not its circumradius or inradius. Under a declared nominal-area convention, a caller may use `D_equal_area = f/N`. That convention is not a calibrated pupil for a real lens.

**Method.** In dimensionless pupil coordinates `u`, the boundary integral comes from the divergence theorem:

`F(q) = i/|q|² Σ_edges (qx Δy − qy Δx) exp(−i q·midpoint) sinc(q·edge/2)`.

The phase coordinate is `q = 2π R x/(λ L)`. At the centre, the exact area limit is used. Near the origin, three steps keep the evaluation numerically stable:

- each edge's constant term is subtracted (these sum to zero around a closed contour);
- a sinc-minus-one series avoids cancellation error;
- `cos(t)−1 = −2 sin²(t/2)` is used.

There is no FFT, no pupil rasterisation and no hidden grid-convergence parameter.

**Output.**

- `|F/A_unit|²`, which equals 1 at the centre.
- Continuous intensity density `A |F/A_unit|²/(λ L)²`, converted from 1/mm² to **1/µm²**. By Parseval's identity it integrates to 1 over the infinite image plane.

Neither value is a discrete probability weight. A finite list of points is **not** renormalised to sum to one. A renderer that integrates numerically must multiply density by image-plane area, measure how much support is cut off and whether it converges, and handle any finite-kernel normalisation itself. Throughput stays separate.

**Limits.**

- 3–1024 blades.
- 1–4096 image points per request.
- Finite positive scales, and a dimensionless phase radius of at most `1e6`. This is a computational limit, not a calibrated accuracy claim.
- Unsupported fields, including aberration, clipping and field inputs, are rejected (fail closed).
- Uniform unit amplitude and zero phase are fixed assumptions of the ideal model. There is no claim about defocus, curved blades, field position, polarisation, sensor, stray light or multiple wavelengths. No quantified physical uncertainty is asserted.

**Validation.** Tests independently check:

- the square aperture's sinc-squared response (absolute tolerance `5e-13`);
- rotated odd and even apertures;
- direct numerical integration over a triangular pupil, with refinement;
- the circular limit for many blades at equal area (absolute intensity tolerance `1e-7` at the tested points);
- energy integration and refinement over finite support.

These tolerances describe test evidence. They are not general accuracy bounds for real lenses.

**Reference.** [Sillitto, Fraunhofer diffraction at straight-edged apertures (1979)](https://doi.org/10.1364/JOSA.69.000765); its abstract establishes analytical Fourier methods for polygons. The implementation and tests were written independently from Fourier integration, the divergence theorem and Parseval's identity. No third-party implementation, tabulated data or protected text is included. AI-assisted draft work still needs substantive human review of provenance and science under `PROVENANCE.md`, and DCO certification, before inclusion.

The circular Airy diagnostic is separate and unchanged. Do not convolve this diffraction PSF with a real-lens kernel that already includes diffraction. This standalone API does not turn on a production-plan stage, and does not change the POC (proof-of-concept simulation API).

## Sampled real-lens PSFs

`LensSampledPsfProfile` stores full 2D intensity PSFs on an explicit regular grid, from calibration or simulation.

Profile axes:

- focal length;
- focus in diopters (`0` = optical infinity, as in `FocusPlane`);
- f-number;
- image-plane field X/Y;
- wavelength;
- signed image-plane defocus.

Every node declares a PSF kernel with unit energy and a physical X/Y sample pitch. All nodes in one interpolated profile must share the same kernel grid.

`resolveLensSampledPsf()` reports one of:

- `exact-grid-sample`; or
- `interpolated`.

Extrapolation is not allowed.

The full 2D kernel keeps the image-plane orientation (+X right, +Y up). That lets it represent off-axis sagittal, tangential and asymmetric structure, instead of forcing radial symmetry.

### Field interpolation methods (2.0)

The profile's `interpolation` field chooses how node kernels are blended:

- `bounded-regular-grid-multilinear` (unchanged; model `lens-sampled-psf-bounded-interpolation`): a weighted sum of kernel values. Blending kernels whose peaks are in different places gives several peaks.
- `bounded-regular-grid-centroid-aligned` (model `lens-sampled-psf-centroid-aligned-interpolation`): each node kernel is first shifted so its intensity centroid lands on the weighted centroid; then the same weights are applied. Shifted or asymmetric PSFs blend into one peak at the interpolated position.
- `rotationally-symmetric-radial-field-centroid-aligned` (model `lens-sampled-psf-rotational-centroid-aligned-interpolation`): for a rotationally symmetric lens. Nodes are declared only along +X (`fieldYmm = [0]`, `fieldXmm ≥ 0`, square sample pitch). A query at `(x, y)` is interpolated at radius `hypot(x, y)`, and the kernel is rotated by `atan2(y, x)` (counter-clockwise from image +X towards +Y). The rotation reads the kernel row index as image +Y, the convention the environment PSF quadrature applies (`sensorPsfSourcePoint`), so an asymmetric kernel renders with the same orientation as a 2-D grid node declared at `(x, y)`. Before 2.19.0 it read rows as −Y, which mirrored such kernels in y ([#566](https://github.com/Photivra/engine/issues/566)).

Shifts and rotations use bilinear resampling. This smooths the kernel by up to about one sample. Samples outside the kernel are treated as zero, and the result is renormalised to unit energy. An exact grid node is returned unchanged.

Existing profiles keep the multilinear method and give identical output. The new methods are opt-in. Schema `0.1.0` is unchanged apart from the larger enum.

## Field curvature and longitudinal chromatic focus

Each sampled node carries `bestFocusImagePlaneOffsetMicrometers`. It can vary with:

- field position (field curvature);
- wavelength (longitudinal, or axial, chromatic focus);
- focal length, aperture and focus setting.

It is a focus/PSF quantity. It does not change geometric distortion, lateral chromatic aberration (CA) or the camera's focus-control state.

For lenses without a sampled profile, `calculateLongitudinalChromaticFocus()` (2.0) derives the defocus for each wavelength. It uses a thin-singlet Abbe model or a declared focal-shift table, and returns the matching Z4 coefficient for `createWavefrontPupilGrid()`. See [Physics foundation](PHYSICS_FOUNDATION.md#longitudinal-chromatic-aberration-20).

## Complex pupil / wavefront reference

`LensComplexPupilProfile` describes one explicit state of the main optics as:

- relative pupil amplitude; and
- optical path difference (OPD) in micrometres.

`calculateLensComplexPupilPsf()` propagates that complex pupil with deterministic scalar Fraunhofer diffraction.

**Image sample pitch.** The optional `propagationDistanceMm` sets the physical image sample pitch on each axis:

`wavelengthMm * propagationDistanceMm / (transformSampleCount * pupilPitchMm)`

The result returns the distance used and whether it was explicit.

- If you omit it, the existing nominal focal-plane reference (`focalLengthMm`) is kept. Finite-focus metadata in the profile does not replace that scale on its own.
- For an ideal thin-lens fixture referenced to the principal plane, compute the finite image distance with `calculateThinLensImageDistance()` and pass it explicitly.
- A real exit-pupil geometry needs its own justified distance and evidence that it applies.

Model 1.1.0 added this input and result field. The pupil schema is still 0.1.0.

### Sampling guard (model 2.0.0)

**Why padding is needed.** The intensity PSF is the Fourier transform of the pupil's autocorrelation, which is twice as wide as the pupil diameter D. To sample it without aliasing, Goodman's sampling factor must satisfy `Q = λN / Δu ≥ 2`. Here `N = z/D`, and `Δu = λz / (M·Δp)` is the image pitch of an M-point transform over pupil pitch Δp. Equivalently, `M·Δp ≥ 2D` (Ban et al., [arXiv:2511.06936](https://arxiv.org/abs/2511.06936), eqs. 6–9, free: `N·d_p = λf/d_c` and `Q = λF/d_c ≥ 2`; the intensity PSF as the transform of the pupil autocorrelation: [MIT OpenCourseWare 2.71, lecture 22](https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/), free. Also see: Goodman, *Introduction to Fourier Optics*, 4th ed., 2017, discrete Fourier-transform sampling of Fraunhofer propagation).

**What the evaluator does.** Suppose the pupil's non-zero amplitude spans S samples on an axis. Then `D = (S − 1)·Δp` (centre to centre), and the discrete autocorrelation has `2S − 1` lags. So the evaluator zero-pads each axis to `M = max(grid, 2S − 1)`. This is exactly the condition for the discrete intensity not to wrap around, and it gives `Q = M/(S − 1) > 2`. The kernel grows to M samples with a finer pitch. Its physical window, `λz/Δp`, does not change.

The result's `sampling` record reports S, D, the declared f/N diameter, M, whether padding was applied, and the achieved Q (null on an axis whose support is a single sample).

**Aperture consistency check.** The evaluator also rejects a pupil whose non-zero support is wider than `propagationDistanceMm / apertureFNumber` on either axis. Such a pupil's image-side cone `D/z` would be wider than the declared `1/N`, contradicting the declared aperture. With the nominal focal-plane reference (`z = f`), the limit is the `focalLengthMm / apertureFNumber` diameter. An exit pupil declared at its own distance is limited by its own cone; for example `D = 30 mm` at `z = 60 mm`, `f = 50 mm`, f/2. In that case `sampling.declaredPupilDiameterMm` reports `z/N`.

**Breaking change in 2.0.0.** A grid that used to fill its own transform now returns a larger, alias-free kernel, with different `widthSamples`, `heightSamples`, centre index and pitch. Examples are the 5×5 generic tier pupils, and a 3×3 uniform pupil whose unpadded 3-point DFT put all its energy in one sample. Grids already padded to at least 2S − 1 return the same kernel values, up to floating-point summation order.

This guard does not check how finely the wavefront (phase) is sampled across the pupil. That remains the profile author's job.

This path evaluates diffraction and aberration in one pupil calculation. Do not add another independent Airy or diffraction blur on top of its output.

### Zernike and Seidel wavefronts (2.0)

`createWavefrontPupilGrid()` builds the `LensComplexPupilGrid` that this evaluator consumes; the propagation code is unchanged. The grid samples a circular pupil of the declared diameter on an odd `N × N` grid (3–63), optionally masked by a polygon. Its OPD, in micrometres, comes from either:

- **Zernike polynomials** in Noll's single index (Noll 1976, *JOSA* 66:207), normalised to unit RMS: `Z_j = √(n+1) R_n^0` for `m = 0`, and `√(2(n+1)) R_n^|m| cos(mθ)` (even `j`) or `sin(mθ)` (odd `j`), for `j ≤ 66`. The RMS of `Σ c_j Z_j` (excluding piston) is `√Σ c_j²`.
- **Primary (Seidel) wave-aberration coefficients** `W020, W111, W040, W131, W222, W220, W311`, in normalised field height `H` and pupil coordinates `(ρ, φ)`, with `φ` measured from the field azimuth (Hopkins, *Wave Theory of Aberrations*, 1950; Wyant & Creath 1992, *Applied Optics and Optical Engineering* XI ch. 1).

Two helpers:

- `calculateDefocusWavefront()` converts an image-plane defocus `dz` at working f-number `N` into `W020 = dz/(8N²)` and Z4 = `W020/(2√3)` (Wyant & Creath 1992, *Applied Optics and Optical Engineering* XI ch. 1, eq. 18, [free author copy](https://wp.optics.arizona.edu/jcwyant/wp-content/uploads/sites/13/2016/08/03-BasicAberrations_and_Optical_Testing.pdf). Also see: Goodman, *Introduction to Fourier Optics*; Mahajan, *Optical Imaging and Aberrations* Part I).
- `estimateMarechalStrehlRatio()` gives the Maréchal/Mahajan approximation `exp(−(2πσ/λ)²)` (Mahajan 1982, *JOSA* 72:1258; free: Wyant & Creath 1992, ch. 1, eq. 67). It is roughly valid for Strehl ratios above 0.3.

Tests check:

- Noll indexing and the closed forms of the low orders;
- numerical orthonormality over the disk;
- that zero coefficients reproduce the aberration-free circular-pupil PSF bit for bit;
- that the centre intensity ratio follows Maréchal within 0.01 for σ ≈ 0.05λ;
- that the Z4/W020 transverse ray aberration `4N·W020` equals the engine's geometric defocus radius;
- that field-dependent Seidel terms transform correctly under all four orientations.

The grid's sampled RMS differs slightly from the continuous RMS, because the disk is discrete.

### Cat's-eye pupil and arbitrary polygon diffraction (2.0)

`calculatePolygonPupilFraunhoferPsf()` extends the ideal regular-polygon model to any simple polygon pupil, in pupil-plane millimetres. It uses the same analytic divergence-theorem boundary integral, so there is no pupil-grid aliasing, and it integrates to 1 over the infinite plane. For regular vertices it reproduces the regular-polygon result.

Its intended input is the cat's-eye pupil polygon from `calculateMechanicalVignetting()` (see [Physics foundation](PHYSICS_FOUNDATION.md#physical-natural-and-mechanical-vignetting-20)). The same polygon can also mask `createWavefrontPupilGrid()`, combining clipping with aberrations.

The PSF is centred on the geometric image point. The clipped pupil's throughput is reported separately (`openAreaRatio`) and is never folded into the normalised PSF.

The output intensity PSF is normalised to unit energy.

## Diffraction-limited sampled profile (2.1)

`createDiffractionLimitedPsfProfile()` builds a `LensSampledPsfProfile` for an ideal, aberration-free, in-focus lens with a uniformly lit circular pupil: one unit-sum kernel per wavelength, all on one (2R+1)² grid of the given sample pitch, the same kernel at the four field corners ±`fieldHalfExtentMm`.

- **Optics.** Pupil diameter D = f/N; pupil-to-image distance the thin-lens image distance for the focus (f at infinity); working f-number N_w = z/D. The incoherent OTF of the pupil is H(ρ) = (2/π)(acos ρ − ρ√(1 − ρ²)), ρ = f/f_c, f_c = 1/(λN_w) ([MIT OpenCourseWare 2.71, lectures 21–22](https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/), free. Also see: Goodman, *Introduction to Fourier Optics*, 4th ed., 2017, §7.3, frequency response for diffraction-limited incoherent imaging, and §4.4, the Fraunhofer pattern of a circular aperture; Born & Wolf, *Principles of Optics*, 7th ed., 1999, §8.5.2). The intensity PSF is the Airy pattern, with its first dark ring at 1.22·λ·N_w (j₁,₁/π, j₁,₁ = 3.8317).
- **Cells.** Sample (i, j) is the PSF energy in the square cell of side p centred on (ip, jp): K = p²∫∫ H·sinc(p f_x)·sinc(p f_y)·cos(2πp i f_x)·cos(2πp j f_y) d²f, in polar coordinates (trapezoid in angle; Gauss–Legendre in t, ρ = 1 − t²). No Bessel functions are needed, and all cells sum to exactly 1.
- **Cells far larger than the pattern (2.5).** The frequency-domain node counts grow with β = p·f_c, so the work grows as β² (296 s for 21 wavelengths at f/1.4 on a 917 µm cell). From β ≥ 32 (192 in 2.5–2.8.1) the same cell energies are integrated in real space: the Airy encircled energy is EE(r) = 1 − J₀(x)² − J₁(x)², x = π·r·f_c (from J₀′ = −J₁ and J₁′ = J₀ − J₁/x, [DLMF §10.6(i)](https://dlmf.nist.gov/10.6), eqs. 10.6.2–10.6.3, free; the same formula is eq. 4 of [Wyant & Creath 1992, §II](https://wp.optics.arizona.edu/jcwyant/wp-content/uploads/sites/13/2016/08/03-BasicAberrations_and_Optical_Testing.pdf), free), so the energy of a rectangle [0, X] × [0, Y] is (1/2π)∫ EE(r_edge(θ)) dθ over its quadrant, and each cell is a signed sum of such rectangles. J₀² + J₁² comes from the Hankel asymptotic expansion ([DLMF 10.17.3](https://dlmf.nist.gov/10.17), free) from x = 300, with eight terms in each of P and Q (remainder below the first neglected term, under 1e-17, DLMF §10.17(iii)), and below it from Miller's backward recurrence J_{n−1} = (2n/x)·J_n − J_{n+1} ([DLMF §3.6(iii)](https://dlmf.nist.gov/3.6), free) normalized by J₀ + 2ΣJ₂ₖ = 1 ([DLMF 10.12.4](https://dlmf.nist.gov/10.12), free). The θ integral uses 16-point Gauss–Legendre panels on which the phase 2x changes by at most 2 radians, so the work grows as β (about 20 ms per wavelength at β = 2000). `quadrature.method` says which method ran and `quadrature.realSpaceWavelengthsNm` lists the real-space wavelengths. The threshold is above every β that a native pitch up to 10 µm reaches (at most 10/(0.38·1.4) ≈ 19), so captures at sensor pitch are unchanged. It moved from 192 to 32 because from there the two methods agree within about 1e-12 and the real-space cells cost a few to a few hundred times less: a 48-pixel whole-frame Quality view of a full-frame sensor at f/8 took 3.4 s of a 4.0 s first render in the frequency domain and now takes 0.6 s in all; larger cells (binned and whole-frame views) change in the last bits only.
- **Reuse (2.6).** The cell table depends only on β and the kernel radius, so the 800 most recently used tables (256 before 2.15.0) are kept per JavaScript realm (a page or a worker) and handed out as copies: another tile of the same frame in the same worker, or a capture that changes only the exposure, ISO, scene or output, reuses its kernels (a repeated 20-wavelength build at 750 µm, f/16 took 4 ms instead of about 1 s). The threshold cannot move much lower: the innermost boundary needs x = π·β/2 ≥ 300 for the Hankel expansion (β ≥ 191), and another Bessel method below it would change today's cells in the last bits.
- **Window.** The energy outside the window, 1 − ΣK, is returned per wavelength (`truncatedEnergyFraction`) and the window is renormalized to unit sum, as the profile contract requires. The Airy tail falls as r⁻³, so it is never zero.
- **Approximations.** Scalar, aberration-free, uniform pupil, in focus, isoplanatic, cell-binned, renormalized window. `responseIncludes.diffraction` is true, so do not add another diffraction blur on top.
- **Validation** (`test/diffraction-psf-profile.test.ts`): convergence under doubled node counts (≤ 1e-13), an independent real-space Airy integration (≤ 2e-10) and `calculateIdealPolygonDiffractionPsf` in its 1024-blade circular limit (≤ 1e-6). 2.5: the real-space and frequency-domain cells agree within 2e-12 at β = 192–400 (radius 1–3), and, since the threshold moved, at β = 32–191 (radius 1–8); the real-space cells change by under 1e-17 when the panel counts double; J₀² + J₁² matches Bessel's integral (DLMF 10.9.2) within 1e-11 relative at x = 0.5–12 346 (the recurrence below 300, the expansion from it); and the centre cell's leakage approaches the asymptote 8√2/(π³β), which follows from the encircled-energy tail 1 − EE(r) ≈ 2/(π²·r·f_c) averaged over the square's edge.

`simulateCapture`'s `lens.diffraction` uses it at the resolved f-number on the site pitch; see [Quick start](QUICK_START.md#optics).

### Spectral nodes (2.15.0)

`lens.diffraction` builds one kernel per spectral node of the sensor quadrature: the midpoints of ⌈400/s⌉ equal subintervals of 380–780 nm for `sensor.spectralStepNanometers` s. The allowed steps, 1–100 nm, give 4–400 nodes. `createDiffractionLimitedPsfProfile` and `resolveLensPsfConvolutionKernels` took at most 64 wavelengths before 2.15.0, so every step under 6.25 nm failed with diffraction ("wavelengthsNm must list 1 to 64 wavelengths."), in `simulateCapture`, the display view and the ideal reference, on every scene. The app's color chart, at the 5 nm step this guide recommends for color work, has 80 nodes.

- **Fix: no approximation.** Both limits are now 400 (`DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS.maximumWavelengths`, `LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS`), the node count of the finest step, and every node keeps its own kernel at its own wavelength. Each kernel equals a one-wavelength profile's bit for bit, so no kernel is shared between nodes or interpolated in wavelength. Captures at 6.25 nm and coarser steps are unchanged.
- **Cost made linear.** Each node's site kernel used to structured-clone and parse the whole profile (`resolveLensPsfConvolutionKernels`), so N nodes cost O(N²). Now one private clone, parsed once, serves every node of a request (`site-diffraction-kernel.ts`), with bit-identical kernels. At radius 32 (6 µm, f/8) that took 80 nodes from 5.1 s to 0.12 s and 400 nodes from 124 s to 1.4 s. The cell-table cache holds 800 tables, enough for a whole 400-node grid; 256 tables never reused one. The capture's profile cache is now also limited by size, to at most the kernel values it could hold before (8 profiles × 64 wavelengths × 65²).
- **Measured** on an Apple M5 Pro with Node.js 24.19.0, single runs, built package. "Heap" is the peak of heap plus array buffers above the start.

  | Case | 20 nm (20 nodes) | 5 nm (80 nodes) | 1 nm (400 nodes) |
  | --- | --- | --- | --- |
  | Profile build alone, default-size radius 4 | — | 31 ms, 1.0 MiB kept | 116 ms, 4.2 MiB kept |
  | Profile build alone, radius 32 | — | 6.1 s, 31 MiB kept | 24 s, 156 MiB kept |
  | Color chart capture, 4000 × 2666, 6 µm, f/16, no diffraction | 3.9 s, 127 MiB | 3.9 s, 128 MiB | 4.0 s, 129 MiB |
  | The same with `lens.diffraction` (default radius, 7 sites) | 4.4 s, 124 MiB | 4.3 s, 146 MiB | 4.5 s, 218 MiB |
  | The same as a display view (1000 × 667 view) | 4.0 s, 84 MiB | 4.1 s, 105 MiB | 4.4 s, 160 MiB |
  | Worst case: color chart capture, 1200 × 800, `kernelRadiusSamples: 32` | 7.8 s, 114 MiB | 11.6 s, 205 MiB | 35.9 s, 675 MiB |

  At the default radius, diffraction adds about 0.4 s at every step. The Airy cell integration grows steeply with the radius (400 nodes: 0.1 s at radius 4, 0.55 s at radius 8, 37 s at radius 32), so the worst case needs both an explicit or capped radius of 32 and a 1 nm step.
- **Tests** (`test/diffraction-spectral-grid.test.ts`): the color chart at 5 nm with diffraction through `simulateCapture`, `simulateDisplayView`, `prepareDisplayView` and `simulateIdealReference` (80 nodes). Node counts of ⌈400/s⌉ from 1 nm (400, the limit) to 100 nm. Kernels equal to one-wavelength profiles bit for bit. Every chart preset, a caller radiance function and a caller material scene at 1 nm and 5 nm, on the tabulated and the per-site environment paths. The color chart at 5 nm with the anti-aliasing filter, box aperture and AHD, a region, an explicit radius, fast kernels, `lens.defocus` and camera rotation (per-tap quadrature). The display view's GPU Quality kernels (float32 emulation) inside their a-priori bounds at 80 nodes. 400 wavelengths accepted, 401 refused with the limit in the message. Shared-clone site kernels equal to the public per-call kernels bit for bit.

## Pupil clipping and throughput

Normalising a PSF's energy and computing optical throughput are separate steps.

A clipped pupil can change two things:

1. the shape of the pupil and PSF; and
2. how much light gets through.

Real-lens profiles therefore keep `relativePupilThroughputFactor` separate from the normalised PSF kernel. The throughput factor belongs in the optical-throughput path (including field-throughput integration), and must be applied exactly once.

**Interpolated throughput.** An interpolated throughput factor uses the same weighted blend as the kernel. A convex blend cannot mathematically exceed its largest node value. However, its floating-point weights can sum to a few ulps (units in the last place) above 1, so nodes that all declare exactly 1 could interpolate to 1 + 2⁻⁵². The engine treats this as rounding: a blended value above 1 that lies within 8·ε·(node count)·max(1, largest node) of the largest contributing node resolves to the largest node value (at most 1). Values already in [0, 1] are returned unchanged. Node values above 1 are still rejected when the profile is parsed.

The existing illumination-vignetting primitive stays a separate, throughput-only approximation; it does not automatically become pupil clipping. The 2.0 mechanical-vignetting model computes the clipped pupil shape and its area ratio explicitly. Apply its throughput once, instead of (not as well as) another field-throughput model.

## MTF boundary

MTF (modulation transfer function) magnitude is useful validation evidence, including sagittal and tangential trends.

Without phase, it does **not** determine a unique PSF.

So `assessMtfOnlyPsfRenderability()` always blocks unique PSF reconstruction from magnitude-only MTF data. It still allows diagnostic use.

## Sensor and stray-light boundaries

V1 lens PSF profiles are `lens-primary-optical-path-only`. They exclude:

- the sensor's optical low-pass filter (OLPF);
- microlens response;
- CFA (colour filter array) and spectral sensor response;
- sensor crosstalk;
- sensor sampling;
- RAW reconstruction / demosaic;
- sharpening and denoising;
- ghosting, flare and veiling glare.

A future combined camera-system response must be labelled as such, not quietly stored as a lens PSF.

Stray light is modelled separately (issue #114); see [Stray light and digital lens correction foundations](DIGITAL_OPTICS_FOUNDATION.md).

## Preview and reference use

Both preview and reference paths can use the sampled-profile contract.

The complex-pupil scalar Fraunhofer evaluator is a deterministic reference calculation. A preview implementation may use a validated approximation. It must keep the same profile meaning, field orientation, throughput ownership and limitations.

## Independent pupil sampling pilot

The candidate Print checks include `test/print-depth-pupil-convergence.test.ts`. It compares the actual public backend against two independently written calculations: a factored finite DFT, and a continuous overlap integral of shifted complex pupils. The test conditions are 25 cycles/mm, 500 nm, focus at 5 m, subject distances of 2, 5 and 10 m, and f/8, f/16 and f/32. When focused, the continuous integral also agrees with the analytic transfer of an ideal circular pupil. Independent Simpson evaluations at 4,096 and 16,384 intervals differ by less than `1e-11` in this domain.

**Padding matters.** An unpadded pupil grid can sample intensity too coarsely, even when the amplitude propagation is numerically correct. Raising pupil resolution without enlarging the zero-padded grid does not necessarily converge to the continuous intensity transfer. Before 2.0.0, the historical 9×9 finite reference had absolute transfer errors above 0.14 in the f/32 cases. Since the 2.0.0 sampling guard, the evaluator pads that declaration to 17×17, so it now matches the explicit 17×17 pilot. The regenerated references record this; they are still not evidence of physical convergence.

The pilot varies pupil resolution and padding separately: padded grids of 9, 17, 33 and 61, with 2, 4, 8 and 15 samples across the pupil radius. Errors do not have to fall steadily at each finite raster of the circular boundary. The final 61×61 grid has an absolute transfer error below 0.01 at the tested frequency, for all nine combinations.

This is a candidate computational criterion based on the pilot. It is not:

- a physical calibration tolerance declared in advance;
- a quality threshold;
- a guarantee for all frequencies;
- a guarantee about support truncation for other stimuli;
- real-lens validation.

The declared finite pupil contract and its limits are unchanged. New frequencies, source support, fields, profiles or imaging domains need their own independent evidence.

## No scalar lens quality

Photivra does not produce a universal lens sharpness or bokeh-quality score.

Real optical response depends on field position, focus, aperture, wavelength, pupil and defocus. Generic equipment tiers may later choose different versioned profiles, but a tier label is not an optical algorithm.
