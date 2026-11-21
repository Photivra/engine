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

import { createDiffractionLimitedPsfProfile } from "../optics/diffraction-psf-profile.js";
import { registerDiffractionPsfKey, siteDiffractionKernel } from "../optics/site-diffraction-kernel.js";
import { createAhdDemosaicTask } from "../processing/demosaic.js";
import { createDefocusBokehSiteKernel, resolveDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";
import { planDefocusBokehZones } from "./defocus-bokeh-zones.js";
import { LARGE_DEFOCUS_CACHE_BYTES, createLargeDefocusNodeLattice } from "./large-defocus-lattice.js";
import { calculateDefocusFieldVariation, createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import { createDisplayViewCoupledRendering } from "./display-view-rendering.js";
import { NEIGHBOR_HIGHLIGHT_RING, NEIGHBOR_HIGHLIGHT_THRESHOLD, reconstructHighlightsFromNeighbors } from "../color/neighbor-highlight-reconstruction.js";

/**
 * #658: the kit is one exported tuple, read by position (the `QK_*` constants of src/facade/on-demand-kits.ts, which a bundler
 * inlines), so neither this chunk's export list nor the code that calls it carries the long export names.
 */
export const QUALITY_KIT = [
  createDiffractionLimitedPsfProfile,
  registerDiffractionPsfKey,
  siteDiffractionKernel,
  createAhdDemosaicTask,
  createDefocusBokehSiteKernel,
  resolveDefocusBokehOptions,
  planDefocusBokehZones,
  LARGE_DEFOCUS_CACHE_BYTES,
  createLargeDefocusNodeLattice,
  calculateDefocusFieldVariation,
  createDefocusImageSpaceProvider,
  prepareDefocusImageSpaceGeometry,
  createDisplayViewCoupledRendering,
  NEIGHBOR_HIGHLIGHT_RING,
  NEIGHBOR_HIGHLIGHT_THRESHOLD,
  reconstructHighlightsFromNeighbors
] as const;
