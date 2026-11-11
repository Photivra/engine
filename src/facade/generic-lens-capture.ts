// SPDX-License-Identifier: Apache-2.0

/**
 * What `simulateCapture` needs for `lens.catalogue` (#549), loaded on demand: a capture without a catalogue lens (and a bundle
 * that never asks for one) does not load the catalogue's data or its PSF builder. It also holds the developed-image lens
 * corrections (`output.lensCorrections`, #570) and their DNG opcodes (`output.dng.lensCorrectionOpcodes`, #587), which need a catalogue lens.
 */
export { GENERIC_LENS_EVIDENCE, genericLensDistortionProfile, genericLensVignettingProfile, resolveGenericLens, simulateGenericLensFocusError } from "../equipment/generic-lens-catalogue.js";
export { createGenericLensPsfProfile, genericLensBokehKernel, genericLensPsfKernelRadius, GENERIC_LENS_PSF_MAXIMUM_COMBINED_RADIUS_SITES } from "../optics/generic-lens-psf.js";
export { CATALOGUE_FAST_GRID_MINIMUM_SUBDIVISIONS, CATALOGUE_FAST_GRID_SPEED_SUBDIVISIONS, CATALOGUE_FAST_VERIFICATION_TOLERANCE, catalogueFastAssumptions, createCatalogueLensSignal } from "./catalogue-lens-signal.js";
export { applyDevelopedLensCorrection, channelEffectiveDispersion, developedLensCorrectionSourceRect, prepareDevelopedLensCorrection } from "../output/developed-lens-corrections.js";
export { createDngLensCorrectionOpcodes } from "../capture/dng-lens-correction-opcodes.js";
