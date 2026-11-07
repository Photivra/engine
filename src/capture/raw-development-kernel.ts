// SPDX-License-Identifier: Apache-2.0

/**
 * Internal fast RAW development kernel on typed arrays, shared by packed native development and the
 * bounded paired export.
 *
 * For native site i with CFA (colour filter array) phase p: if any saturation flag is set, or code ≥ W_p,
 * the normalized value is 1 (clipped at the sensor's effective white level; this uses up the flags).
 * Otherwise it is the signed (code − black)/(W_p − black). With a development exposure gain G ≠ 1 (#556) the value is
 * multiplied by G, and a site whose pushed value reaches 1 is clipped at 1 and counted as saturated, like a site at
 * its white level. Reconstruction sums value·weight in the declared
 * contribution order (the same order as `calculateRawReconstructionChannel`). Then
 * `SensorColorDevelopment.developInto` applies white balance (WB), highlight handling and colour.
 *
 * Kernels are flattened per absolute CFA phase into typed arrays of index offsets, weights and source-site
 * white levels, so no per-pixel objects are allocated. Not exported from the package.
 */
import type { RawFrameReconstructionPhaseProfile } from "./raw-frame-reconstruction.js";
import type { SensorColorDevelopment, SensorColorDevelopmentCounts } from "../color/sensor-color-development.js";
import { reflectRawSiteIndex } from "../sensor/raw-reconstruction.js";

/** Read-only RAW site storage. Arrays are row-major over the full native frame. */
export interface RawDevelopmentSource {
  nativeWidth: number;
  repeatWidth: number;
  repeatHeight: number;
  codes: ArrayLike<number>;
  blackLevels: ArrayLike<number>;
  /** Non-zero means the site saturated: physically, before the ADC, or digitally. */
  saturationFlags: ArrayLike<number>;
  /** Effective white code per CFA phase, `phaseY*repeatWidth+phaseX`. */
  whiteByPhase: ArrayLike<number>;
  /**
   * Development exposure gain 2^stops on the black-subtracted, white-normalized value (#556). Omitted or 1: no push, and
   * every value is unchanged bit for bit.
   */
  exposureGain?: number;
}
/** Development counters; `saturatedPixelCount` counts pixels with at least one clipped contributing site. */
export interface RawDevelopmentCounts extends SensorColorDevelopmentCounts { saturatedPixelCount: number }
export function createRawDevelopmentCounts(): RawDevelopmentCounts {
  return { saturatedPixelCount: 0, whiteBalanceClippedSampleCount: 0, reconstructedPixelCount: 0 };
}
/** Normalized (and pushed) value of one site, or 1 when it is saturated. Shared by the reference read callback. */
export function normalizedRawSite(source: RawDevelopmentSource, x: number, y: number): number {
  const i = y*source.nativeWidth+x, code = source.codes[i]!, black = source.blackLevels[i]!,
    white = source.whiteByPhase[(y % source.repeatHeight)*source.repeatWidth + x % source.repeatWidth]!;
  if (source.saturationFlags[i]! !== 0 || code >= white) return 1;
  const value = (code-black)/(white-black), gain = source.exposureGain;
  if (gain === undefined || gain === 1) return value;
  const pushed = value*gain;
  return pushed >= 1 ? 1 : pushed;
}
/** True when the site is clipped at the white level or flagged, or its pushed value reaches 1. */
export function rawSiteSaturated(source: RawDevelopmentSource, x: number, y: number): boolean {
  const i = y*source.nativeWidth+x, code = source.codes[i]!,
    white = source.whiteByPhase[(y % source.repeatHeight)*source.repeatWidth + x % source.repeatWidth]!;
  if (source.saturationFlags[i]! !== 0 || code >= white) return true;
  const gain = source.exposureGain;
  if (gain === undefined || gain === 1) return false;
  const black = source.blackLevels[i]!;
  return (code-black)/(white-black)*gain >= 1;
}

interface FlatKernel { delta: Int32Array; weight: Float64Array; white: Float64Array }
/** Develops native pixels; output is linear sRGB/D65. */
export interface RawPixelDeveloper {
  /** Develops the pixel centred on native site (x, y) into out[offset..offset+2]. Halo is validated by the caller. */
  developAt(x: number, y: number, out: Float64Array | number[], offset: number): void;
  /** Develops `count` pixels from native (x, y) stepping (dx, dy) into out[0..3·count). */
  developRun(x: number, y: number, dx: number, dy: number, count: number, out: Float64Array): void;
  readonly counts: RawDevelopmentCounts;
}
/**
 * `mirror` (optional) turns on mirrored reads (reflect-101) for pixels within `reach` sites of the frame
 * edge. Interior pixels, and every pixel when it is omitted, use the normal flattened-kernel path.
 */
export function createRawPixelDeveloper(source: RawDevelopmentSource, phases: readonly RawFrameReconstructionPhaseProfile[],
  development: SensorColorDevelopment, mirror?: { nativeHeight: number; reach: number }): RawPixelDeveloper {
  const rw = source.repeatWidth, rh = source.repeatHeight, w = source.nativeWidth;
  const table: FlatKernel[][] = [];
  for (const phase of phases) {
    table[phase.phaseY*rw+phase.phaseX] = phase.profile.kernels.map((kernel) => ({
      delta: Int32Array.from(kernel.contributions, (c) => c.offsetY*w+c.offsetX),
      weight: Float64Array.from(kernel.contributions, (c) => c.weight),
      white: Float64Array.from(kernel.contributions, (c) => source.whiteByPhase[
        (((phase.phaseY+c.offsetY) % rh + rh) % rh)*rw + ((phase.phaseX+c.offsetX) % rw + rw) % rw]!)
    }));
  }
  const codes = source.codes, blacks = source.blackLevels, flags = source.saturationFlags, counts = createRawDevelopmentCounts();
  const gain = source.exposureGain ?? 1, pushed = gain !== 1;
  const channel = new Float64Array(3);
  const mirrorTable = mirror === undefined ? null : phases.map((phase) => phase.profile.kernels);
  function developMirroredAt(x: number, y: number, out: Float64Array | number[], offset: number): void {
    const kernels = mirrorTable![(y % rh)*rw + x % rw]!, h = mirror!.nativeHeight;
    let saturated = false;
    for (let k = 0; k < 3; k++) {
      let value = 0;
      for (const c of kernels[k]!.contributions) {
        const sx = reflectRawSiteIndex(x+c.offsetX, w), sy = reflectRawSiteIndex(y+c.offsetY, h);
        if (rawSiteSaturated(source, sx, sy)) saturated = true;
        value += normalizedRawSite(source, sx, sy)*c.weight;
      }
      channel[k] = value;
    }
    if (saturated) counts.saturatedPixelCount++;
    development.developInto(channel[0]!, channel[1]!, channel[2]!, out, offset, counts);
  }
  function developAt(x: number, y: number, out: Float64Array | number[], offset: number): void {
      if (mirror !== undefined && (x < mirror.reach || y < mirror.reach || x+mirror.reach >= w || y+mirror.reach >= mirror.nativeHeight)) {
        developMirroredAt(x, y, out, offset); return;
      }
      const kernels = table[(y % rh)*rw + x % rw]!, center = y*w+x;
      let saturated = false;
      for (let k = 0; k < 3; k++) {
        const kernel = kernels[k]!, delta = kernel.delta, weight = kernel.weight, white = kernel.white;
        let value = 0;
        for (let j = 0; j < delta.length; j++) {
          const i = center+delta[j]!, code = codes[i]!, top = white[j]!;
          let normalized: number;
          if (flags[i]! !== 0 || code >= top) { normalized = 1; saturated = true; } else {
            const black = blacks[i]!; normalized = (code-black)/(top-black);
            if (pushed) { normalized *= gain; if (normalized >= 1) { normalized = 1; saturated = true; } }
          }
          value += normalized*weight[j]!;
        }
        channel[k] = value;
      }
      if (saturated) counts.saturatedPixelCount++;
      development.developInto(channel[0]!, channel[1]!, channel[2]!, out, offset, counts);
  }
  return {
    counts, developAt,
    developRun(x: number, y: number, dx: number, dy: number, count: number, out: Float64Array): void {
      for (let j = 0, o = 0; j < count; j++, x += dx, y += dy, o += 3) developAt(x, y, out, o);
    }
  };
}
