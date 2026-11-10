// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#534): the sensor-stage hook of one fraction of an exposure build-up (`simulateExposureBuildUp`). A fraction
 * renders the whole exposure's request, so every site draws its ordinary photo and dark counts with its ordinary seeds; the
 * hook then splits each count down to the fraction (`thin`) and names the fraction's own read-noise stream (`read`). The
 * binomial splitting lives in facade/exposure-build-up.ts, so captures without a build-up carry only this registry.
 */

export interface ExposureBuildUpStage {
  /** The fraction's count from the whole exposure's realized `count` at the absolute native site `index`: photo (`which` 0) or dark (1). */
  thin(count: number, index: number, which: 0 | 1): number;
  /** The read-noise stream ID of the fraction's readout (`deriveNativeSiteStreamSeedUint32`). */
  read: number;
}

/** The running build-up fractions, by the noise realization ID of their capture (`plan.exposure.noise.realizationId`). */
export const EXPOSURE_BUILD_UP_STAGES = new Map<string, ExposureBuildUpStage>();
