// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the `webgpu-f32` sensor stage (#277): domain checks, frame constants, per-site mean
 * packing, banded dispatch and readback. The float64 reference is `simulatePackedSensorRaw`
 * (capture/packed-sensor-raw.ts). Internal; the public entry point is the image-kernel accelerator.
 */
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import { calculatePackedSensorRawPlan, createPackedFixedPattern, packedSensorDiagnostics, packedSensorExtras, simulatePackedSensorRows,
  type PackedSensorRawInput, type PackedSensorRawPlan } from "../capture/packed-sensor-raw.js";
import { adcTransfer, type SensorReadoutConversionRegime } from "../sensor/raw-readout.js";
import { ImageKernelExecutionError, webGpuExecution, type ImageKernelExecution } from "./image-kernel-execution.js";
import type { AcceleratedPackedSensorRawResult } from "./image-kernel-accelerator.js";
import { BUFFER_USAGE, GpuResourceScope, linearDispatch, runComputePass, type WebGpuRuntime, throwIfAborted as checkAbort } from "./webgpu-runtime.js";
import { SENSOR_AUX, SENSOR_EXTRAS, SENSOR_MEAN_CATEGORY, SENSOR_OUTPUT, SENSOR_PIECE_WORDS, SENSOR_RAW_WGSL, SENSOR_ROUNDING, SENSOR_SITE_WORDS,
  SENSOR_WORKGROUP_SIZE } from "./wgsl-sensor-kernel.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

/** Largest physical capacity on the GPU: every realized count up to it is exact in float32. */
export const SENSOR_GPU_MAXIMUM_CAPACITY = 2 ** 24;
/** Poisson means must stay below this on the GPU (30-bit integer part of a mean word). */
export const SENSOR_GPU_MAXIMUM_MEAN = 2 ** 30;
/** Largest |fixed-pattern readout offset| on the GPU, in electrons and in codes. */
export const SENSOR_GPU_MAXIMUM_OFFSET_ELECTRONS = 2 ** 28;
export const SENSOR_GPU_MAXIMUM_OFFSET_CODES = 2 ** 20;
const CPU_RELATIVE = 2 ** -47;
/** One WGSL rounding, either direction (2^-23). */
const E = SENSOR_ROUNDING;
const POISSON_NORMAL_MINIMUM_MEAN = 1e9;

/** CPU reference with host yields and abort, row-chunked; codes equal `simulatePackedSensorRaw`. */
export async function simulateSensorRawOnCpu(input: PackedSensorRawInput, abort: AbortController, yieldControl: YieldControl,
  execution: ImageKernelExecution): Promise<AcceleratedPackedSensorRawResult> {
  const plan = calculatePackedSensorRawPlan(input);
  // Snapshot so a caller mutation during host yields cannot change the reference.
  const photo = input.photoElectrons.slice(), dark = input.darkElectrons.slice(), extras = packedSensorExtras(plan, input, true);
  const codes = new Uint16Array(plan.siteCount), counts = [0, 0, 0, 0];
  const rowsPerChunk = Math.max(1, Math.floor(65_536 / plan.region.width)), gate = createHostYieldGate();
  for (let row = 0; row < plan.region.height; row += rowsPerChunk) {
    checkAbort(abort.signal);
    simulatePackedSensorRows(plan, photo, dark, row, Math.min(plan.region.height, row + rowsPerChunk), codes, counts, extras);
    if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
  }
  checkAbort(abort.signal);
  return { plan, codes, diagnostics: packedSensorDiagnostics(counts), execution, flaggedSiteIndices: new Uint32Array(0) };
}

/**
 * Splits a positive value into four non-negative pieces with at most 12 significant bits each (by
 * truncation), so that the product of any integer below 2^12 and a piece is exact in float32. Returns
 * the pieces and the non-negative remainder (below 2^-44 of the value).
 * @internal
 */
export function twelveBitPieces(value: number): { pieces: number[]; residual: number } {
  const pieces: number[] = [];
  let rest = value;
  for (let j = 0; j < 4; j++) {
    if (!(rest > 0)) { pieces.push(0); continue; }
    let e = Math.floor(Math.log2(rest));
    if (rest / 2 ** e >= 2) e++;
    if (rest / 2 ** e < 1) e--;
    const scale = 2 ** (e - 11), piece = Math.floor(rest / scale) * scale;
    pieces.push(piece);
    rest -= piece;
  }
  return { pieces, residual: rest };
}

/**
 * A 12-bit piece as the kernel reads it: an integer mantissa m < 2^12, the exponent s and the exact scale 2^s,
 * with piece = m·2^s exactly. A zero piece is (0, 0, 1).
 * @internal
 */
export function pieceWords(piece: number): [mantissa: number, exponent: number, scale: number] {
  if (piece === 0) return [0, 0, 1];
  let e = Math.floor(Math.log2(piece));
  if (piece / 2 ** e >= 2) e++;
  if (piece / 2 ** e < 1) e--;
  const s = e - 11, m = piece / 2 ** s;
  if (!Number.isInteger(m) || m >= 4096 || s < -126 || s > 60) throw new ImageKernelExecutionError("unsupported-float32-domain", "A gain piece is outside the float32 sensor domain.");
  return [m, s, 2 ** s];
}

/**
 * Writes the four pieces of a positive gain-like value into the auxiliary table.
 * @internal
 */
export function writePieces(aux: Float32Array, at: number, pieces: readonly number[]): void {
  pieces.forEach((piece, j) => aux.set(pieceWords(piece), at + SENSOR_PIECE_WORDS * j));
}

/**
 * `L(k) − S(k)` for k < 256, where L is the reference's log k! (the summed logarithms of
 * `samplePoisson`'s logFactorial) and S(k) = (k + ½) ln k − k + ½ ln 2π.
 * @internal
 */
export function stirlingRemainderTable(): Float64Array {
  const table = new Float64Array(256);
  let sum = 0;
  for (let k = 1; k < 256; k++) {
    if (k >= 2) sum += Math.log(k);
    table[k] = sum - ((k + 0.5) * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI));
  }
  return table;
}

function unsupported(message: string): ImageKernelExecutionError {
  return new ImageKernelExecutionError("unsupported-float32-domain", message);
}

interface SensorConstants { aux: Float32Array<ArrayBuffer>; params: ArrayBuffer; siteWords: number; poissonComponents: number[];
  deterministicComponents: number[]; threshold: number; gain: number }

/** Checks the float32 execution domain and builds the frame constants (see docs/WEBGPU.md). @internal */
export function sensorGpuConstants(plan: PackedSensorRawPlan): SensorConstants {
  const regime = plan.readout.regime, adc = regime.adc, capacity = plan.physicalChargeCapacityElectrons;
  const gain = regime.systemConversionGainElectronsPerCode.value, inverse = 1 / gain;
  const threshold = regime.preAdcSaturationElectronEquivalent.value;
  const sigmas = regime.readNoiseComponents.map(c => c.rmsElectrons.value);
  const sigmaSum = sigmas.reduce((s, v) => s + v, 0);
  if (capacity > SENSOR_GPU_MAXIMUM_CAPACITY) throw unsupported("Physical capacity above 2^24 electrons is outside the float32 sensor domain.");
  // Fixed-pattern factors scale the means; those are checked per site while packing.
  if (!(plan.maximumPhotoElectrons < SENSOR_GPU_MAXIMUM_MEAN && plan.maximumDarkElectrons < SENSOR_GPU_MAXIMUM_MEAN) ||
      plan.additionalChargeComponents.some(c => !(c.maximumExpectedElectrons < SENSOR_GPU_MAXIMUM_MEAN))) {
    throw unsupported("Expected electrons of 2^30 and above are outside the float32 sensor domain.");
  }
  if (adc.digitalGain !== undefined && !(adc.digitalGain >= 2 ** -60 && adc.digitalGain <= 2 ** 60)) {
    throw unsupported("Digital gain is outside the float32 sensor domain.");
  }
  if (!(inverse >= 2 ** -60 && inverse <= 2 ** 60) || capacity * inverse > 2 ** 30 ||
      sigmas.some(s => s !== 0 && !(s >= 2 ** -100 && s <= 2 ** 100)) || 7 * sigmaSum > 2 ** 28 || 7 * sigmaSum * inverse > 2 ** 20) {
    throw unsupported("Conversion gain or read noise is outside the float32 sensor domain.");
  }
  const knots = adc.integralNonLinearity?.knots ?? [];
  // Segment slopes in float64 on the host, so the kernel's INL offset needs no division. Codes, offsets, slopes.
  const slopes = knots.slice(1).map((k, i) => (k.offsetCodes - knots[i]!.offsetCodes) / (k.code - knots[i]!.code));
  const slope = slopes.reduce((m, v) => Math.max(m, Math.abs(v)), 0), offset = knots.reduce((m, k) => Math.max(m, Math.abs(k.offsetCodes)), 0);
  const knotMagnitude = knots.reduce((m, k) => Math.max(m, Math.abs(k.code)), 0);
  const aux = new Float32Array(SENSOR_AUX.knots + 3 * knots.length);
  aux.set(stirlingRemainderTable(), SENSOR_AUX.stirlingRemainder);
  aux.set(sigmas, SENSOR_AUX.sigma);
  const inversePieces = twelveBitPieces(inverse), digital = adc.digitalGain === undefined ? null : twelveBitPieces(adc.digitalGain);
  writePieces(aux, SENSOR_AUX.inversePieces, inversePieces.pieces);
  if (digital) writePieces(aux, SENSOR_AUX.digitalPieces, digital.pieces);
  knots.forEach((k, i) => { aux[SENSOR_AUX.knots + i] = k.code; aux[SENSOR_AUX.knots + knots.length + i] = k.offsetCodes; });
  slopes.forEach((v, i) => { aux[SENSOR_AUX.knots + 2 * knots.length + i] = v; });
  // Pre-ADC-saturated sites all have the same rounded ADC input; computed once with the reference, before digital gain.
  const { digitalGain: _omitted, ...withoutDigital } = adc;
  void _omitted;
  const saturated = adcTransfer({ ...regime, adc: withoutDigital } as SensorReadoutConversionRegime, plan.readout.adcMaximumCode, threshold).quantized;
  const params = new ArrayBuffer(128), words = new Uint32Array(params), ints = new Int32Array(params), floats = new Float32Array(params);
  const capacityFloor = Math.floor(capacity), thresholdFloor = Math.min(Math.floor(threshold), 2 ** 30);
  words[2] = plan.region.width; words[3] = plan.nativeWidth; words[4] = plan.region.x; words[5] = plan.region.y;
  // Mode bits: 1 digital gain; 2 the digital-gain product is exact on both sides (gain has ≤ 12 significant
  // bits); 4 the ADC input is exact on both sides (no read noise, power-of-two gain, integer capacity, no INL).
  // In an exact mode both evaluations give the same dyadic value, so a tie is decided identically and needs no flag.
  const digitalExact = digital !== null && digital.residual === 0 && digital.pieces.slice(1).every(p => p === 0);
  const poissonComponents: number[] = [], deterministicComponents: number[] = [];
  plan.additionalChargeComponents.forEach((c, k) => (c.model === "poisson" ? poissonComponents : deterministicComponents).push(k));
  const deterministic = deterministicComponents.length > 0, pattern = plan.fixedPatternNoise !== null;
  const idealExact = sigmas.every(s => s === 0) && Number.isInteger(Math.log2(gain)) && Number.isInteger(capacity) && knots.length === 0 &&
    !deterministic && !pattern;
  words[6] = plan.captureSeedUint32; words[7] = sigmas.length; words[8] = knots.length;
  words[9] = (digital ? 1 : 0) | (digitalExact ? 2 : 0) | (idealExact ? 4 : 0);
  words[10] = adc.digitalSaturationCode; words[11] = plan.readout.adcMaximumCode; words[12] = capacityFloor; words[13] = thresholdFloor;
  words[14] = adc.blackLevelCode; ints[15] = Math.max(-(2 ** 30), Math.min(2 ** 30, saturated));
  floats[16] = capacity - capacityFloor; floats[17] = threshold < 2 ** 30 ? threshold - thresholdFloor : 0;
  floats[18] = inverse; floats[19] = inversePieces.residual * (1 + 2 ** -20);
  floats[20] = adc.digitalGain ?? 1; floats[21] = digital ? digital.residual * (1 + 2 ** -20) : 0;
  floats[22] = slope * (1 + 2 ** -20); floats[23] = offset; floats[30] = knotMagnitude;
  const siteWords = SENSOR_SITE_WORDS + 2 * poissonComponents.length + (deterministic ? 2 : 0) + (pattern ? 4 : 0);
  words[24] = siteWords; words[25] = poissonComponents.length;
  words[26] = (deterministic ? SENSOR_EXTRAS.deterministic : 0) | (pattern ? SENSOR_EXTRAS.fixedPattern : 0);
  return { aux, params, siteWords, poissonComponents, deterministicComponents, threshold, gain };
}

/** Writes the float64 slack terms of the fixed-pattern bounds, from the region's largest offsets. */
function setFixedPatternSlack(params: ArrayBuffer, threshold: number, maximumOffset: number, maximumOffsetCodes: number): void {
  const floats = new Float32Array(params);
  // The reference adds the offset in float64 and the host forms threshold − offset and offset/gain in float64.
  floats[28] = CPU_RELATIVE * (maximumOffset + Math.min(threshold, 2 ** 30)) * (1 + 2 ** -20);
  // The offset fraction's float32 rounding (its place in the fraction sum is counted by the kernel) and offset/gain's float64 rounding.
  floats[29] = (E + CPU_RELATIVE * maximumOffsetCodes) * (1 + 2 ** -20);
}

/** Splits a value into a floor and its float32 fraction. */
function packSplit(value: number, words: Int32Array, floats: Float32Array, at: number): void {
  const whole = Math.floor(value);
  words[at] = whole; floats[at + 1] = value - whole;
}

/** Packs one mean: category in bits 30–31 with the integer part, and the float32 fraction. */
function packMean(mean: number, words: Uint32Array, floats: Float32Array, at: number): void {
  if (mean === 0) { words[at] = 0; floats[at + 1] = 0; return; }
  if (!(mean < SENSOR_GPU_MAXIMUM_MEAN)) throw unsupported("Expected electrons of 2^30 and above are outside the float32 sensor domain.");
  const whole = Math.floor(mean);
  const category = mean < 30 ? SENSOR_MEAN_CATEGORY.multiplication : mean < POISSON_NORMAL_MINIMUM_MEAN ? SENSOR_MEAN_CATEGORY.transformedRejection
    : SENSOR_MEAN_CATEGORY.normal;
  words[at] = ((category << 30) | whole) >>> 0;
  floats[at + 1] = mean - whole;
}

export async function simulateSensorRawOnGpu(runtime: WebGpuRuntime, bandBytes: number, input: PackedSensorRawInput, abort: AbortController,
  yieldControl: YieldControl, pipelines: PipelineSource): Promise<AcceleratedPackedSensorRawResult> {
  const plan = calculatePackedSensorRawPlan(input);
  const constants = sensorGpuConstants(plan), { aux, params, siteWords, poissonComponents, deterministicComponents, threshold, gain } = constants;
  const photo = input.photoElectrons.slice(), dark = input.darkElectrons.slice();
  const additional = (input.additionalChargeComponents ?? []).map(c => c.expectedElectrons.slice());
  const width = plan.region.width, height = plan.region.height, siteBytes = siteWords * 4;
  const pattern = createPackedFixedPattern(plan);
  // Fixed-pattern values are evaluated once, in float64 (exactly the reference's values), before any dispatch.
  const patterns = pattern === null ? null : new Float64Array(plan.siteCount * 3);
  if (patterns !== null) {
    let maximumOffset = 0, maximumOffsetCodes = 0;
    for (let row = 0, i = 0; row < height; row++) for (let column = 0; column < width; column++, i++) {
      const p = pattern!(column, row), offsetCodes = p.readoutOffsetElectrons / gain;
      patterns[i * 3] = p.photoResponseGainFactor; patterns[i * 3 + 1] = p.darkCurrentFactor; patterns[i * 3 + 2] = p.readoutOffsetElectrons;
      maximumOffset = Math.max(maximumOffset, Math.abs(p.readoutOffsetElectrons)); maximumOffsetCodes = Math.max(maximumOffsetCodes, Math.abs(offsetCodes));
    }
    if (!(maximumOffset <= SENSOR_GPU_MAXIMUM_OFFSET_ELECTRONS && maximumOffsetCodes <= SENSOR_GPU_MAXIMUM_OFFSET_CODES)) {
      throw unsupported("Fixed-pattern readout offsets are outside the float32 sensor domain.");
    }
    setFixedPatternSlack(params, threshold, maximumOffset, maximumOffsetCodes);
  }
  const rows = Math.max(1, Math.min(height, Math.floor(bandBytes / (width * siteBytes))));
  if (rows * width * siteBytes > runtime.maximumStorageBindingBytes) {
    throw new ImageKernelExecutionError("insufficient-limits", "One sensor band exceeds the device's storage binding limit.");
  }
  const pipeline = await pipelines("photivra-sensor-raw", SENSOR_RAW_WGSL);
  const codes = new Uint16Array(plan.siteCount), counts = [0, 0, 0, 0];
  const packed = new ArrayBuffer(rows * width * siteBytes), packedWords = new Uint32Array(packed), packedFloats = new Float32Array(packed);
  const packedInts = new Int32Array(packed);
  const words = new Uint32Array(params);
  let flagged = 0;
  const flaggedIndices: number[] = [];
  const scope = new GpuResourceScope(runtime);
  try {
    const auxBuffer = scope.upload("photivra-sensor-aux", aux, BUFFER_USAGE.STORAGE);
    const gate = createHostYieldGate();
    for (let row0 = 0; row0 < height; row0 += rows) {
      checkAbort(abort.signal);
      const row1 = Math.min(height, row0 + rows), count = (row1 - row0) * width, first = row0 * width;
      for (let i = 0; i < count; i++) {
        const site = first + i, at = i * siteWords;
        // The reference's own float64 products of the means and the fixed-pattern factors.
        packMean(patterns === null ? photo[site]! : photo[site]! * patterns[site * 3]!, packedWords, packedFloats, at);
        packMean(patterns === null ? dark[site]! : dark[site]! * patterns[site * 3 + 1]!, packedWords, packedFloats, at + 2);
        let cursor = at + 4;
        for (const k of poissonComponents) { packMean(additional[k]![site]!, packedWords, packedFloats, cursor); cursor += 2; }
        if (deterministicComponents.length > 0) {
          let sum = 0;
          for (const k of deterministicComponents) sum += additional[k]![site]!;
          if (!(sum < SENSOR_GPU_MAXIMUM_MEAN)) throw unsupported("Deterministic charge of 2^30 electrons and above is outside the float32 sensor domain.");
          packSplit(sum, packedInts, packedFloats, cursor);
          cursor += 2;
        }
        if (patterns !== null) {
          const offset = patterns[site * 3 + 2]!, limit = threshold - offset;
          if (limit >= 2 ** 30) { packedInts[cursor] = 2 ** 30; packedFloats[cursor + 1] = 0; } else packSplit(limit, packedInts, packedFloats, cursor);
          packSplit(offset / gain, packedInts, packedFloats, cursor + 2);
        }
      }
      words[0] = count; words[1] = row0;
      const band = new GpuResourceScope(runtime);
      try {
        const means = band.upload("photivra-sensor-means", new Uint32Array(packed, 0, count * siteWords), BUFFER_USAGE.STORAGE);
        const out = band.buffer("photivra-sensor-codes", count * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = band.upload("photivra-sensor-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: means } },
          { binding: 2, resource: { buffer: auxBuffer } }, { binding: 3, resource: { buffer: out } }] });
        const [data] = await runComputePass(runtime, band, pipeline, bindGroup, linearDispatch(count, SENSOR_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
          [{ buffer: out, bytes: count * 4 }], abort.signal);
        const result = new Uint32Array(data!, 0, count);
        for (let i = 0; i < count; i++) {
          const word = result[i]!, flags = word >>> SENSOR_OUTPUT.flagShift;
          codes[first + i] = word & SENSOR_OUTPUT.codeMask;
          if (flags & 1) counts[0]!++;
          if (flags & 2) counts[1]!++;
          if (flags & 4) counts[2]!++;
          if (flags & 8) counts[3]!++;
          if (word & SENSOR_OUTPUT.uncertainBit) { flagged++; flaggedIndices.push(first + i); }
        }
      } finally {
        band.release();
      }
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  } catch (error) {
    codes.fill(0);
    throw error;
  } finally {
    scope.release();
  }
  checkAbort(abort.signal);
  const execution = webGpuExecution({ kind: "exact-except-flagged-sites", flaggedSiteCount: flagged, noiseModel: { ...plan.noiseModel },
    seedSchedule: plan.seedSchedule }, flagged);
  return { plan, codes, diagnostics: packedSensorDiagnostics(counts), execution, flaggedSiteIndices: Uint32Array.from(flaggedIndices) };
}
