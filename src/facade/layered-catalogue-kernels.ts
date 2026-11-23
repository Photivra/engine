// SPDX-License-Identifier: Apache-2.0

/**
 * A catalogue lens on layered chart scenes (2.29.0, #741 and #748; group LC, module level): each surface's defocus kernel from
 * the lens's own bokeh, and the focus and frame scale the kernels and the lattice take. The wiring (`layered-scene-setup.ts`,
 * wave 4) passes the kernels as the layers' `kernel` and `zones`, the catalogue PSF per field zone to the sum's `spectrumAt`, and
 * the frame scale to the geometry.
 *
 * Model (an approximation, labelled as one; the single-plane path's, per layer). Surface k's kernel is the lens's bokeh kernel
 * (`resolveGenericLens(...).character.bokeh`: its blades, its spherical aberration W040 and, on the full method, its cat's eye;
 * `createDefocusBokehSiteKernel`) for the signed blur diameter
 *   s_k = σ·c_k − b,   b = 8·N·W040/p,
 * σ·c_k the thin-lens signed blur diameter in sites (+ behind the focus plane) and −b the balancing defocus W020 = −W040 of the
 * lens's PSF (`genericLensBokehKernel`: the defocus is referred to the lens's focus, the balanced one of its PSF). A surface at the
 * focus distance (c = 0) convolves nothing, as on the single-plane path. The lens's PSF (diffraction, its Seidel aberrations,
 * axial and lateral colour; `createGenericLensPsfProfile` without a defocus kernel) follows the sum at each spectral node, per
 * field zone: the diffraction convolved with the geometric kernel per layer, the single-plane path's approximation. The kernel is
 * the same at every node: the axial colour stays in the PSF, so surfaces on either side of the focus plane do not fringe in
 * opposite colours (2.29.0 owner decision 4: a per-wavelength signed blur was measured against the lens's defocused wave PSF
 * and not taken; see test/layered-catalogue-kernels.test.ts).
 *
 * Occlusion uses the nominal ray map: the visibility and the tap-to-pupil scale take each surface's thin-lens radius σ·c/2 (the
 * depth report's `signedBlurRadiusSites`), not the linear part (σ·c − b)/2 of the kernel's ray map (σ·c/2 − b/2 + b·ρ²)·P. With
 * the cubic term the nominal radius is the closer linear map: measured against a brute-force aperture integration of that ray
 * map in test/layered-catalogue-kernels.test.ts (an approximation, labelled as one). The layered visibility maps a shaped
 * kernel's taps to the pupil linearly, so with spherical aberration a uniform scene is not exactly uniform across card edges
 * (measured there: 6 % for PV 85 1.8 wide open; the existing lens.defocus spherical aberration on layered scenes, referred to the
 * paraxial focus, 15 % for the same W040).
 *
 * Focus (#748). `lens.focusScatter`'s sampled focus (`simulateGenericLensFocusError`) is the focus every surface's blur and kernel
 * are computed from; `lens.catalogue.breathing` scales the field of view by 1 + Δ at the requested focus
 * (`genericLensBreathingScale`), so every surface's frame point scales by it: the geometry's `frameScale` (a frame point is the
 * map's point divided by it) is 1 / (1 + Δ) ({@link layeredCatalogueFocus}).
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";
import type { DefocusBokehKernelParameters, DefocusBokehSiteKernel, ResolvedDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import type { LayeredLayerKernel } from "./layered-edge-sum.js";

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };

/** A surface's signed blur diameter for a catalogue lens, sites: σ·c − b (see the module comment), or 0 at the focus distance. */
export function layeredCatalogueSignedBlurSites(lens: ResolvedGenericLens, pitchMicrometers: number, signedBlurDiameterSites: number): number {
  const sa = lens.character.bokeh.sphericalAberration;
  return signedBlurDiameterSites === 0 ? 0 : signedBlurDiameterSites - (sa ? 8 * lens.character.fNumber * sa.w040Micrometers / pitchMicrometers : 0);
}

export interface LayeredCatalogueKernelsInput {
  /** The lens resolved at the request's f-number and the focus the kernels take (the sampled one with `lens.focusScatter`). */
  lens: ResolvedGenericLens;
  pitchMicrometers: number;
  /** Per surface, nearest first, its signed thin-lens blur radius at that focus (`layeredChartDepths`' `signedBlurRadiusSites`). */
  depths: readonly { readonly signedBlurRadiusSites: number }[];
  /** The lens's bokeh options, resolved (`lens.character.bokeh`): blades and spherical aberration, and the cat's eye on the full method only. */
  bokeh: ResolvedDefocusBokehOptions;
  /** The shaped kernel builder (the quality kit's `createDefocusBokehSiteKernel`). */
  createKernel(parameters: DefocusBokehKernelParameters): DefocusBokehSiteKernel;
  /**
   * With a cat's eye in `bokeh`: the zone plan of one surface's kernel (the quality kit's `planDefocusBokehZones` with the
   * request's field mapping), for that kernel's radius and the kernel built at a zone's field tangent.
   */
  planZones?(radius: number, kernelAt: (field: { x: number; y: number }) => DefocusBokehSiteKernel): { zones: SiteKernelFieldZones; minimumOpenAreaRatio: number };
}

/** One surface's kernel: the bokeh kernel (null at the focus distance) and, with a cat's eye, its field zones; the signed blur it was built for. */
export interface LayeredCatalogueSurfaceKernel {
  kernel: LayeredLayerKernel | null;
  zones?: SiteKernelFieldZones;
  signedBlurSites: number;
}

/**
 * Internal: each surface's kernel for a catalogue lens (see the module comment). Fails when the cat's eye closes the pupil in part
 * of the frame or a kernel passes the shaped kernel's radius cap (the layered sum's edge bound is checked by the lattice).
 */
export function createLayeredCatalogueKernels(input: LayeredCatalogueKernelsInput): LayeredCatalogueSurfaceKernel[] {
  const { lens, pitchMicrometers: pitch, bokeh } = input, { fNumber } = lens.character, focalLengthMm = lens.focalLengthMm;
  if (bokeh.catsEye && !input.planZones) fail("Layered scene: the cat's eye needs its zone plan.");
  return input.depths.map((depth): LayeredCatalogueSurfaceKernel => {
    const s = layeredCatalogueSignedBlurSites(lens, pitch, 2 * depth.signedBlurRadiusSites);
    if (s === 0) return { kernel: null, signedBlurSites: 0 };
    const build = (field?: { x: number; y: number }): DefocusBokehSiteKernel =>
      input.createKernel({ diameterSites: Math.abs(s), side: s < 0 ? -1 : 1, fNumber, focalLengthMm, pitchMicrometers: pitch, options: bokeh, ...(field ? { field } : {}) });
    const axis = build(), kernel = { radius: axis.radius, weights: axis.weights, shaped: true };
    if (!bokeh.catsEye) return { kernel, signedBlurSites: s };
    const plan = input.planZones!(axis.radius, build);
    if (!(plan.minimumOpenAreaRatio > 0)) fail("lens.defocus.catsEye: the clipping apertures close the pupil in part of the frame; reduce shiftPerTanFieldMm or enlarge radiusMm.");
    return { kernel, zones: plan.zones, signedBlurSites: s };
  });
}

/** The focus a layered catalogue request renders at (#748): the kernels' focus and the geometry's frame scale. */
export interface LayeredCatalogueFocus {
  /** The focus every surface's blur is computed from: the sampled one with `lens.focusScatter`, else the requested one. */
  focusDistanceM: number;
  /** 1 + Δ with `lens.catalogue.breathing` (at the requested focus), else 1: `scene.layers`' `breathingScale`. */
  breathingScale: number;
  /** The geometry's `frameScale`: 1 / breathingScale (a frame point is the lens map's point divided by it). */
  frameScale: number;
}

/**
 * The focus of a layered catalogue request (#748, see the module comment): `sampledFocusDistanceM` from
 * `simulateGenericLensFocusError` with `lens.focusScatter`, `breathingScale` from `genericLensBreathingScale` at the requested focus
 * with `lens.catalogue.breathing`.
 */
export function layeredCatalogueFocus(input: { focusDistanceM: number; sampledFocusDistanceM?: number; breathingScale?: number }): LayeredCatalogueFocus {
  const focusDistanceM = input.sampledFocusDistanceM ?? input.focusDistanceM, breathingScale = input.breathingScale ?? 1;
  if (!(focusDistanceM > 0 && Number.isFinite(focusDistanceM) && breathingScale > 0 && Number.isFinite(breathingScale))) fail("Layered scene: invalid focus or breathing scale.");
  return { focusDistanceM, breathingScale, frameScale: 1 / breathingScale };
}
