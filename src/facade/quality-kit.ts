// SPDX-License-Identifier: Apache-2.0

/**
 * 2.22.0 (#594): the CPU full-quality code, one module that the capture and the display view load on demand (`loadQualityKit`,
 * src/facade/on-demand-kits.ts) where they parse a request that asks for it, so a bundler that splits dynamic imports puts all of
 * it in one chunk outside the default path. Only re-exports: the code, its results and its bounds are those of the modules named.
 *
 * - Diffraction (2.1): the Airy profile, its site kernels and their convolution.
 * - The capture's AHD demosaic (`output.demosaic: "ahd"`).
 * - `lens.defocus` beyond the geometric disc (owner, 2026-11-10): the bokeh shapes, the cat's eye and their field zones, the
 *   lattice of a disc above the direct radius (#564) and the image-space provider (lens projection and distortion).
 * - The display view's coupled rendering steps (#593, #601: luminance tone curves, reconstruct, desaturation) and the neighbor
 *   highlight reconstruction (#602).
 */

export { createDiffractionLimitedPsfProfile } from "../optics/diffraction-psf-profile.js";
export { registerDiffractionPsfKey, siteDiffractionKernel } from "../optics/site-diffraction-kernel.js";
export { createAhdDemosaicTask } from "../processing/demosaic.js";
export { createDefocusBokehSiteKernel, resolveDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
export { planDefocusBokehZones } from "./defocus-bokeh-zones.js";
export { LARGE_DEFOCUS_CACHE_BYTES, createLargeDefocusNodeLattice } from "./large-defocus-lattice.js";
export { calculateDefocusFieldVariation, createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
export { createDisplayViewCoupledRendering } from "./display-view-rendering.js";
export * as neighborHighlights from "../color/neighbor-highlight-reconstruction.js";
