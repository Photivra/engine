// SPDX-License-Identifier: Apache-2.0

/**
 * #740 (2.29.0): the merge of a burst of identical exposures, the first stage of `simulateTypicalProcessing`: the mean of the frames'
 * linearized stage images (the CFA mosaic, or LinearRaw, normalized 0..1 by the black and white levels), sample by sample, before the
 * demosaic. With N frames of independent noise the mean keeps the signal and divides each sample's noise variance by N. The frames
 * are taken as registered: no alignment and no robust (outlier-rejecting) weighting, unlike the tile alignment and Wiener-filter
 * merge of Hasinoff et al., "Burst photography for high dynamic range and low-light imaging on mobile cameras" (SIGGRAPH Asia 2016,
 * free copy from the authors) and the survey of Delbracio et al., "Mobile computational photography: a tour" (2021, arXiv:2102.09000).
 * @see docs/PROCESSING.md, "Typical processing stages".
 */

import { InvalidScientificInputError } from "../core/validation.js";
import type { ImportedDngRaw } from "../capture/dng-import.js";

/** The fields of an imported DNG that must agree across the frames of a merge: size, CFA, levels, crop, opcodes and color metadata. */
const MERGE_FIELDS = ["width", "height", "samplesPerPixel", "bitsPerSample", "scale", "photometricInterpretation", "orientation", "cfa", "linearizationTable",
  "blackLevel", "whiteLevel", "activeArea", "defaultCrop", "colorMatrix1", "colorMatrix2", "calibrationIlluminant1", "calibrationIlluminant2", "asShotNeutral",
  "asShotWhiteXy", "forwardMatrix1", "forwardMatrix2", "cameraCalibration1", "cameraCalibration2", "cameraCalibrationSignature", "profileCalibrationSignature",
  "analogBalance", "baselineExposure", "opcodeList1", "opcodeList2", "opcodeList3", "profileGainTableMap", "rgbTables"] as const;

const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) => ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v);

/** Refuses frames that disagree in a field of {@link MERGE_FIELDS}, naming the first such field and frame. */
export function requireMergeableFrames(frames: readonly ImportedDngRaw[], label: string): void {
  const first = frames[0]!;
  for (const field of MERGE_FIELDS) {
    const reference = canonical((first as unknown as Record<string, unknown>)[field]);
    for (let k = 1; k < frames.length; k++) {
      if (canonical((frames[k] as unknown as Record<string, unknown>)[field]) !== reference) {
        throw new InvalidScientificInputError(label + ": frames[" + k + "] differs from frames[0] in " + field + "; a merge needs identical exposures of one camera (same size, CFA, levels and color metadata).");
      }
    }
  }
}

/**
 * Adds one frame's stage samples into the float64 sum. After the last frame {@link finishFrameMean} divides by the count, so a merge
 * holds one frame's stage image and the sum, not every frame.
 */
export function addFrameSamples(sum: Float64Array, samples: Float32Array): void {
  if (samples.length !== sum.length) throw new InvalidScientificInputError("frame merge: the frames' stage images differ in size.");
  for (let i = 0; i < sum.length; i++) sum[i] = sum[i]! + samples[i]!;
}

/** The mean, sample by sample, of `count` frames whose samples {@link addFrameSamples} added into `sum`, as float32. One frame gives its samples exactly. */
export function finishFrameMean(sum: Float64Array, count: number): Float32Array {
  const out = new Float32Array(sum.length);
  for (let i = 0; i < sum.length; i++) out[i] = sum[i]! / count;
  return out;
}

/** The mean of same-size sample arrays (the stage images of a burst), sample by sample. */
export function meanOfFrames(frames: readonly Float32Array[]): Float32Array {
  const sum = new Float64Array(frames[0]!.length);
  for (const f of frames) addFrameSamples(sum, f);
  return finishFrameMean(sum, frames.length);
}
