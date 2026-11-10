// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (#534): the sensor-stage hook of one render of an exposure build-up (`simulateExposureBuildUp`). After a site's
 * ordinary photo and dark draws, `split` gets the render's expected means and those draws, and sets the counts the readout
 * uses (`photo`, `dark`); `read` names the readout's read-noise stream. The build-up's own logic (binomial splitting, the
 * per-site chain) lives in facade/exposure-build-up.ts, so captures without a build-up carry only this registry.
 */

export interface ExposureBuildUpStage {
  /** Sets `photo` and `dark` for the absolute native site `index` from this render's expected means and ordinary draws. */
  split(index: number, photoMean: number, darkMean: number, photo: number, dark: number): void;
  photo: number;
  dark: number;
  /** The read-noise stream ID of the readout (`deriveNativeSiteStreamSeedUint32`). */
  read: number;
}

/** The running build-up renders' stages, by their native RAW input (`NativeRawInput`, the object the capture facade builds). */
export const EXPOSURE_BUILD_UP_STAGES = new WeakMap<object, ExposureBuildUpStage>();
