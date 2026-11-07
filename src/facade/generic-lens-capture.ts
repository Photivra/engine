// SPDX-License-Identifier: Apache-2.0

/**
 * What `simulateCapture` needs for `lens.catalogue` (#549), loaded on demand: a capture without a catalogue lens (and a bundle
 * that never asks for one) does not load the catalogue's data or its PSF builder.
 */
export { GENERIC_LENS_EVIDENCE, genericLensDistortionProfile, genericLensVignettingProfile, resolveGenericLens, simulateGenericLensFocusError } from "../equipment/generic-lens-catalogue.js";
export { createGenericLensPsfProfile, genericLensPsfKernelRadius, GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES } from "../optics/generic-lens-psf.js";
