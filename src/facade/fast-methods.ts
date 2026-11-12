// SPDX-License-Identifier: Apache-2.0

/**
 * The registry of every speed-versus-accuracy choice (#395, owner rule of 2.20.0): one entry per choice that has a fast and an
 * exact (full) method, and per option record that accepts `fast` without a fast method yet. Every entry resolves through
 * `resolveFast` and `fastFormatDefault` (fast-resolution.ts): an option record's `fast`, else the top-level `fast`, else the
 * format default (fast for "srgb-8", "srgb-16" and the display view; exact for "dng", "jpeg", "png" and `simulateIdealReference`).
 *
 * Data only (a root export, so developers can read which choices exist), read by `test/fast-methods-registry.test.ts`, which
 * fails when an option accepts `fast` without an entry here, an entry lacks its resolver or its report, or a format's default
 * leaves the rule. Captures and display views do not import this module (tree-shaking leaves it out of their bundles). A new
 * fast method adds its entry here and to docs/API_STYLE.md, "Exact and fast modes".
 * @see docs/API_STYLE.md, "Exact and fast modes".
 */

/** One speed-versus-accuracy choice of {@link SIMULATE_CAPTURE_FAST_METHODS} (2.20.0). */
export interface SimulateCaptureFastMethod {
  /** A short id: the option path and, where one option has several fast methods, the method. */
  id: string;
  /**
   * The request path whose record takes the `fast` override (`allowKeys` path in simulate-capture.ts), or "fast" when only the
   * top-level flag sets it (a choice with no option record of its own).
   */
  override: string;
  /** "fast-and-exact": both methods exist; "exact-only": the record takes `fast`, but there is no fast method yet (reports false). */
  methods: "fast-and-exact" | "exact-only";
  /** Where it applies. */
  runs: readonly ("simulateCapture" | "simulateDisplayView" | "prepareDisplayView" | "developDngStageImage" | "developDngImage")[];
  /** The fast method and the exact one, in words (empty for exact-only). */
  fast: string;
  exact: string;
  /** Always true: no choice keeps its own default (the test checks it). */
  followsFormatDefault: true;
  /**
   * The resolver call in the source (`resolveFast(<record flag>, fastTop)`, or `fastTop` itself for a top-level choice), which the
   * test finds in the named file.
   */
  resolver: { file: string; call: string };
  /**
   * How the result reports it: the `diagnostics.fast.applied` key (true where the fast method ran), an assumption id the fast
   * method adds, or another result field. At least one; the test finds each assumption id in the source.
   */
  report: { applied?: string; assumption?: string; field?: string };
}

const CAPTURE = "src/facade/simulate-capture.ts", VIEW = "src/facade/simulate-display-view.ts";

/** 2.20.0: every speed-versus-accuracy choice of the capture facade and the display view (see the module comment). */
export const SIMULATE_CAPTURE_FAST_METHODS: readonly SimulateCaptureFastMethod[] = /* @__PURE__ */ Object.freeze([
  { id: "lens.catalogue/field-grid", override: "lens.catalogue", methods: "fast-and-exact", runs: ["simulateCapture"],
    fast: "#568: the PSF blended over a field grid, with each site's expected electrons integrated from its taps' material spectra at use, verified per CFA phase against the exact chain",
    exact: "the environment PSF quadrature with the PSF resolved at each query point", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(catalogueFast, fastTop)" }, report: { applied: "lens.catalogue", assumption: "fast.lens.catalogue" } },
  { id: "lens.catalogue/field-grid-cells", override: "fast", methods: "fast-and-exact", runs: ["simulateCapture"],
    fast: "#603: when the field-grid method runs on a fast request, at least 4 grid cells per field interval (2.20.0's grid), except for the measured lenses of CATALOGUE_FAST_GRID_FULL_ON_SCREEN, whose fallbacks made 4 cells slower",
    exact: "at least 10 cells per field interval when the field-grid method runs on an exact request (lens.catalogue fast: true with an export or fast: false)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "catalogueFastGridSubdivisions(catalogue!.lensId, fastTop)" }, report: { assumption: "fast.lens.catalogue" } },
  { id: "lens.catalogue/cats-eye", override: "lens.catalogue", methods: "fast-and-exact", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "#567: with lens.defocus, the lens's bokeh without its cat's eye (the axis kernel everywhere)",
    exact: "the cat's eye shaped at each field point (fast wides and normals)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(catalogueFast, fastTop)" }, report: { applied: "lens.catalogue", assumption: "fast.lens.catalogue.catsEye" } },
  { id: "lens.catalogue/view-psf-zones", override: "lens.catalogue", methods: "fast-and-exact", runs: ["simulateDisplayView", "prepareDisplayView"],
    fast: "#569 (H1): 64 field zones along the longer side, each with the PSF at its centre",
    exact: "one zone per site: the PSF at each site centre", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(catalogueFast, fastTop)" }, report: { applied: "lens.catalogue", assumption: "view.lensPsf" } },
  { id: "lens.diffraction/rolling-shutter-taps", override: "lens.diffraction", methods: "fast-and-exact", runs: ["simulateCapture"],
    fast: "#565: under rolling-shutter rotation (#551: or subject motion), each PSF tap reads the scene at its own source point",
    exact: "each tap reads the scene at its site-lattice point (ties on chart boundaries resolve as on the lattice)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(diffractionFast, fastTop)" }, report: { applied: "lens.diffraction", assumption: "fast.lens.diffraction" } },
  { id: "lens.catalogue/rolling-shutter-taps", override: "lens.catalogue", methods: "fast-and-exact", runs: ["simulateCapture"],
    fast: "#588: under rolling-shutter rotation, each catalogue PSF tap reads the scene at its own source point",
    exact: "each tap reads the scene at its site-lattice point (ties on chart boundaries resolve as on the lattice)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(catalogueFast, fastTop)" }, report: { applied: "lens.catalogue", assumption: "fast.lens.catalogue" } },
  { id: "view.uniform-pixel-sampling", override: "fast", methods: "fast-and-exact", runs: ["simulateDisplayView", "prepareDisplayView"],
    fast: "(H2) a quarter of the samples per axis in display pixels whose pilot finds no detail",
    exact: "the full samples per axis in every display pixel", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "uniformSampling: fastTop" }, report: { assumption: "view.estimation" } },
  { id: "prepareDisplayView.gpu", override: "fast", methods: "fast-and-exact", runs: ["prepareDisplayView"],
    fast: "gpu \"auto\": WebGPU float32 where a conforming device supports the request (a bounded approximation), else the CPU reference",
    exact: "gpu \"off\": the CPU reference; an explicit gpu wins", followsFormatDefault: true,
    resolver: { file: VIEW, call: "parsePrepareDisplayViewOptions(prepareOptions, (options as { fast?: unknown } | null | undefined)?.fast !== false)" },
    report: { field: "diagnostics.fast.execution" } },
  { id: "illumination/image-plane-gpu", override: "fast", methods: "fast-and-exact", runs: ["prepareDisplayView"],
    fast: "#597: gpu \"auto\": an image-plane print under mixed lighting on WebGPU (float32, a bounded approximation): the print's Quality passes light each lattice " +
      "point per spectral node from the light's spectra and parts (Speed requests too, without site kernels); flagged points resolved on the host",
    exact: "gpu \"off\": the CPU reference integrates each site from the lit radiance per spectral node in float64; an explicit gpu wins", followsFormatDefault: true,
    resolver: { file: VIEW, call: "parsePrepareDisplayViewOptions(prepareOptions, (options as { fast?: unknown } | null | undefined)?.fast !== false)" },
    report: { field: "diagnostics.fast.execution" } },
  { id: "sensor.spectralStepNanometers", override: "fast", methods: "fast-and-exact", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "#590: the default spectral step is 20 nm under any light; under a spiky one (R(20) > 0.01) sensor.spectralSpikiness notes the possible cast",
    exact: "5 nm under a spiky light, else 20 nm (an explicit sensor.spectralStepNanometers always wins)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "fastTop || !spiky" }, report: { applied: "sensor.spectralStepNanometers", assumption: "sensor.spectralSpikiness" } },
  { id: "sensor.midGrey", override: "fast", methods: "fast-and-exact", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "#535: the mid-gray noise figure is not computed (about 0.3 ms)", exact: "result.sensor.midGrey is computed", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "fastTop ? undefined : 0" }, report: { field: "sensor.midGrey" } },
  { id: "motion.subject/temporal-midpoints", override: "motion.subject", methods: "fast-and-exact", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "#551: with the default count and a still camera, one temporal midpoint per site of the subject's streak plus one, when that is fewer than 8",
    exact: "the default 8 temporal midpoints (an explicit sensor.temporalSampleCount always wins)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(subjectFast, fastTop)" }, report: { applied: "motion.subject", assumption: "fast.motion.subject" } },
  { id: "dngImport.warpRectilinear", override: "fast", methods: "fast-and-exact", runs: ["developDngStageImage"],
    fast: "#600: an imported DNG's WarpRectilinear opcode resampled bilinearly", exact: "cubic convolution (Keys, a = −0.75, the DNG SDK's kernel); default fast unless format names an export", followsFormatDefault: true,
    resolver: { file: "src/capture/dng-stage-image.ts", call: "resolveFast(options.fast, fastFormatDefault(format, \"capture\"))" }, report: { field: "fast" } },
  { id: "developDngImage/demosaic", override: "fast", methods: "fast-and-exact", runs: ["developDngImage"],
    fast: "#607 (2.24.0): an imported DNG's mosaic demosaiced with the built-in bilinear kernels, and WarpRectilinear resampled bilinearly",
    exact: "adaptive homogeneity-directed demosaicing (AHD, Hirakawa & Parks 2005) and cubic-convolution WarpRectilinear; default fast for srgb-8 and srgb-16", followsFormatDefault: true,
    resolver: { file: "src/capture/dng-development.ts", call: "resolveFast(options.fast, fastFormatDefault(format, \"capture\"))" }, report: { field: "fast" } },
  { id: "output.toneCurve/view-luminance-moments", override: "fast", methods: "fast-and-exact", runs: ["simulateDisplayView", "prepareDisplayView"],
    fast: "#593: a luminance tone curve's moments by an 8-point Gauss–Hermite rule in luminance where its range stays clear of L = 0 (else the full rule)",
    exact: "a composite 4 × 16-point Gauss–Legendre rule over the luminance's ±8.5σ, split at L = 0", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "rendering: fastTop" }, report: { assumption: "view.rendering" } },
  { id: "output.highlightMode.reconstruct/view-moments", override: "fast", methods: "fast-and-exact", runs: ["simulateDisplayView", "prepareDisplayView"],
    fast: "#593, #601: where the reconstruct blend or the desaturation is within reach, the development chain integrated with 6 Gauss–Hermite points per axis (216 nodes)",
    exact: "16 points per axis (4,096 nodes)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "rendering: fastTop" }, report: { assumption: "view.rendering" } },
  { id: "prepareDisplayView.gpu/view-coupled-moments", override: "fast", methods: "fast-and-exact", runs: ["prepareDisplayView"],
    fast: "#593, #601: the WebGPU Speed and Quality kernels' coupled steps with the fast rules (8-point Gauss–Hermite in luminance; 6 points per axis for the chain), float32 within the a-priori bound",
    exact: "the same kernels with the full rules (4 × 16 Gauss–Legendre; 16 points per axis), fast: false with an explicit gpu", followsFormatDefault: true,
    resolver: { file: "src/gpu/wgsl-display-view-coupled.ts", call: "out[C.fast] = r.fast ? 1 : 0" }, report: { assumption: "view.rendering" } },
  { id: "output.highlightMode.reconstruct-neighbors/region-ratios", override: "fast", methods: "fast-and-exact", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "#602: each clipped region takes the mean color ratios of the unclipped pixels within 2 pixels of it; #605: on the WebGPU display view too (the host's ratios, the rebuild in float32 within the a-priori bound)",
    exact: "the ratios' harmonic (Laplace) interpolation inward from the region's unclipped neighbors (successive over-relaxation), on the CPU and the WebGPU display view alike", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "const neighborFast = fastTop" }, report: { assumption: "output.highlightMode.reconstructNeighbors" } },
  { id: "lens.diffraction", override: "lens.diffraction", methods: "exact-only", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "", exact: "the diffraction kernels (a fast method only under rolling-shutter rotation, above)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "resolveFast(diffractionFast, fastTop)" }, report: { applied: "lens.diffraction" } },
  { id: "sensor.antiAliasing", override: "sensor.antiAliasing", methods: "exact-only", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "", exact: "the point-splitting filter", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "fastInUse" }, report: { applied: "sensor.antiAliasing" } },
  { id: "sensor.pixelAperture.box", override: "sensor.pixelAperture", methods: "exact-only", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "", exact: "the N × N midpoint rule", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "fastInUse" }, report: { applied: "sensor.pixelAperture.box" } },
  { id: "output.demosaic.ahd", override: "output.demosaic", methods: "exact-only", runs: ["simulateCapture", "simulateDisplayView", "prepareDisplayView"],
    fast: "", exact: "the AHD demosaic of the capture; in the display view, AHD's two linear candidates and its choice on the noise-free mosaic (2.22.0: no low-signal correction, so no fast method)", followsFormatDefault: true,
    resolver: { file: CAPTURE, call: "[\"output.demosaic.ahd\", ahd, demosaicFast]" }, report: { applied: "output.demosaic.ahd" } }
] as const satisfies readonly SimulateCaptureFastMethod[]);
