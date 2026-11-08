// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#394, not exported from the package): the input of the tabulated expected signal (`createDisplayViewExpectedSignal`)
 * for a resolved `simulateCapture` request, shared by the display view and the capture's tabulated RAW path so both build it
 * the same way: query offsets of each site, the environment's query points, the diffraction kernels and the scene tables.
 *
 * Defocus (#492, `lens.defocus`): the geometric disc D on the site lattice (`createDefocusDiscSiteKernel`) enters as a site
 * kernel, so every query stays on the lattice. Without diffraction every spectral node takes D itself (a wavelength-independent
 * kernel). With diffraction node λ takes K_λ ∗ D, the full 2-D convolution of the diffraction kernel with the disc (radius
 * R_diff + R_defocus): a labelled approximation, since the defocused wave's PSF is not the in-focus Airy pattern convolved
 * with a geometric disc. The convolution is linear, so Σ_t (K_λ ∗ D)(t)·L(p − t) is the diffracted radiance blurred by D, the
 * order the capture's object-space convolutions apply them in. The kernels are built as the capture builds them
 * (`siteDiffractionKernel`, then `convolveSiteKernels`), so the two have the same bits.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { resolveLensPsfConvolutionKernels } from "../optics/lens-psf-kernels.js";
import { siteDiffractionKernel } from "../optics/site-diffraction-kernel.js";
import { convolveSiteKernels } from "../optics/defocus-disc-kernel.js";
import { DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES, siteKernelRuns, type SiteKernelRuns } from "../optics/site-kernel-runs.js";
import { resolveProjectionDistanceMm } from "../motion/camera-rotation.js";
import { hypot3 } from "../core/portable-math.js";
import type { DisplayViewExpectedSignalInput, DisplayViewScene } from "./display-view.js";

/** A unit site kernel of radius 0 (shared: the tables only read it). */
const UNIT_TAP = Float64Array.of(1);

type Psf = Parameters<typeof resolveLensPsfConvolutionKernels>[0]["psf"];

export interface ExpectedSignalSetupInput {
  nativeWidth: number;
  nativeHeight: number;
  /** Frame output width (plane coordinates are 2 / width frame units per site). */
  width: number;
  wavelengths: readonly number[];
  /** Per CFA channel (red, green, blue): expected electrons per unit spectral radiance at each node. */
  perNode: readonly [Float64Array, Float64Array, Float64Array];
  /** Pixel-aperture nodes in sites from the site centre (`apertureNodeOffsets(boxSamples)`) and the box sample count. */
  apertureNodes: readonly { x: number; y: number }[];
  boxSamples: number;
  antiAliasing?: { components: readonly { offsetMicrometers: { x: number; y: number }; normalizedWeight: number }[] } | undefined;
  pitch: number;
  /** Object-space diffraction: the kernel radius, the PSF and its profile wavelengths. */
  diffraction?: { radius: number; psf: Psf; profileWavelengths: readonly number[] } | undefined;
  /** Defocus (#492): the geometric disc on the site lattice, (2R + 1)² row-major weights; absent or null in focus. */
  defocus?: { radius: number; weights: Float64Array } | null | undefined;
  /**
   * #564: a defocus kernel above the direct radius, as runs, used instead of `defocus`: the tables keep the in-focus kernels
   * (diffraction, or a unit tap per node for the lattice formula) and the expected signal convolves the result with it. A
   * `defocus` disc of radius above 64 sites takes this path too.
   */
  largeDefocus?: SiteKernelRuns | undefined;
  /** Material scenes: the materials (neutral reflectances, or radiance per wavelength), the material lookup and the white radiance. */
  materials?: { list: readonly ({ neutral: number } | { radiance: (nm: number) => number })[]; materialAt(u: number, v: number): number; whiteRadiance(nm: number): number } | undefined;
  radianceAt(u: number, v: number, nm: number): number;
  imagingArea: { widthMm: number; heightMm: number };
  focalLengthMm: number;
  focusDistanceM: number;
  subjectDistanceM: number;
  metresPerFrameUnit: number;
  /** Prefix of the error messages ("simulateDisplayView", "simulateCapture"). */
  caller: string;
}

/** The query offsets of each site and the expected-signal input (see the module comment). */
export function buildExpectedSignalInput(input: ExpectedSignalSetupInput): { offsets: { x: number; y: number; weight: number }[]; signalInput: DisplayViewExpectedSignalInput } {
  const { boxSamples, pitch, wavelengths, imagingArea, subjectDistanceM, metresPerFrameUnit } = input;
  // Query offsets of each site: pixel-aperture nodes minus anti-aliasing split offsets (sites, +x right, +y down), as the environment forms them.
  const spots = input.antiAliasing ? input.antiAliasing.components : [{ offsetMicrometers: { x: 0, y: 0 }, normalizedWeight: 1 }];
  const offsets = input.apertureNodes.flatMap((node) => spots.map((c) => ({ x: node.x - c.offsetMicrometers.x / pitch, y: node.y - c.offsetMicrometers.y / pitch,
    weight: c.normalizedWeight / (boxSamples * boxSamples) })));
  // Diffraction: the same per-node site kernels as the object-space convolution (createDiffractedPlanarProvider).
  let kernels: { radius: number; perNode: Float64Array[] } | undefined;
  const diffraction = input.diffraction;
  if (diffraction) {
    const radius = diffraction.radius;
    kernels = { radius, perNode: wavelengths.map((wavelengthNm) => {
      if (!diffraction.profileWavelengths.includes(wavelengthNm)) throw new InvalidConfigurationError(input.caller + ": a spectral node has no diffraction kernel.");
      return siteDiffractionKernel(diffraction.psf, wavelengthNm, pitch, radius, input.caller + ": diffraction kernels must sample the site pitch exactly.");
    }) };
  }
  // #564: a disc above the direct radius (64 sites) is convolved by runs after the in-focus signal instead (below).
  const largeDefocus = input.largeDefocus ?? (input.defocus && input.defocus.radius > DEFOCUS_DIRECT_KERNEL_MAXIMUM_RADIUS_SITES ?
    siteKernelRuns(input.defocus.weights, input.defocus.radius) : undefined);
  // Defocus (#492): the disc alone at every node (one shared array), or each node's diffraction kernel convolved with it.
  const defocus = largeDefocus ? undefined : input.defocus;
  if (defocus) {
    const diffracted = kernels;
    kernels = diffracted ? { radius: diffracted.radius + defocus.radius, perNode: diffracted.perNode.map((k) => convolveSiteKernels(k, diffracted.radius, defocus.weights, defocus.radius)) } :
      { radius: defocus.radius, perNode: wavelengths.map(() => defocus.weights) };
  }
  // #564: a large defocus kernel is applied after the in-focus signal (expected-signal.ts); without diffraction the in-focus
  // kernels are a unit tap per node, so the tables read the scene on the lattice formula as the defocus path does.
  if (largeDefocus && !kernels) kernels = { radius: 0, perNode: wavelengths.map(() => UNIT_TAP) };
  // Chart presets and (2.7) caller material scenes take the material path: each material tabulated once per node.
  const materials = input.materials;
  const scene: DisplayViewScene = materials ? { kind: "materials", materialAt: materials.materialAt,
    materials: materials.list.map((m) => ("neutral" in m ? { neutral: m.neutral } : { radiance: Float64Array.from(wavelengths, (nm) => m.radiance(nm)) })),
    whiteRadiance: Float64Array.from(wavelengths, (nm) => materials.whiteRadiance(nm)) } :
    { kind: "radiance", radianceAt: input.radianceAt };
  const channelIndex = (x: number, y: number): number => ((y & 1) === 0 ? ((x & 1) === 0 ? 0 : 1) : ((x & 1) === 0 ? 1 : 2));
  // Without diffraction the environment's own query arithmetic (native-environment-lean.ts `geometry`, then the rectilinear
  // still-camera ray and the planar provider's plane point), so boundary points resolve as in the capture.
  const projectionDistance = resolveProjectionDistanceMm(input.focalLengthMm, input.focusDistanceM).projectionDistanceMm, siteWidthMm = pitch / 1000;
  const nodePhases = input.apertureNodes.flatMap((_, index) => spots.map((c) => ({ xPhase: (index % boxSamples + 0.5) / boxSamples, yPhase: (Math.floor(index / boxSamples) + 0.5) / boxSamples,
    aaX: c.offsetMicrometers.x / 1000, aaY: c.offsetMicrometers.y / 1000 })));
  const queryPoint = (x: number, y: number, o: number, out: Float64Array): void => {
    const node = nodePhases[o]!;
    const centerX = -imagingArea.widthMm / 2 + (pitch / 2 + x * pitch + 0) / 1000, centerY = -imagingArea.heightMm / 2 + (pitch / 2 + y * pitch + 0) / 1000;
    const sourceX = (centerX - siteWidthMm / 2 + node.xPhase * siteWidthMm) - node.aaX, sourceY = (centerY - siteWidthMm / 2 + node.yPhase * siteWidthMm) - node.aaY;
    const rx = projectionDistance * (sourceX / projectionDistance), ry = projectionDistance * (-sourceY / projectionDistance);
    const length = hypot3(rx, ry, projectionDistance), t = subjectDistanceM / (projectionDistance / length);
    out[0] = rx / length * t / metresPerFrameUnit; out[1] = ry / length * t / metresPerFrameUnit;
  };
  return { offsets, signalInput: { nativeWidth: input.nativeWidth, nativeHeight: input.nativeHeight, outputWidth: input.width, wavelengthsNm: wavelengths,
    electronsPerRadiance: input.perNode, offsets, ...(kernels ? { kernels } : { queryPoint }), ...(largeDefocus ? { largeKernel: largeDefocus } : {}), scene, channelAt: channelIndex } };
}

