// SPDX-License-Identifier: Apache-2.0

/**
 * Shared cancellable task wrapper and typed-image contracts for the standalone image-processing
 * operators: demosaic, HDR merge and encode, tone mapping, exposure fusion, focus stacking, panorama,
 * denoise, sharpening and synthetic grain.
 *
 * Each operator is a synchronous row generator. This wrapper steps through it and reports one
 * progress tile for each processed row of every pass. It awaits the host's `yieldControl` on the same
 * time budget as the native RAW tasks. How often it yields never changes the output.
 *
 * Inputs are read during `run()` and never written. Callers must not change them until `run()`
 * settles. Working memory is estimated in advance and capped by `maximumWorkingBytes`.
 * @see docs/PROCESSING.md for algorithms, sources, approximation status and limits.
 */

import type { CalculationProvenance } from "../core/calculation-result.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { InvalidScientificInputError, InvalidScientificResultError } from "../core/validation.js";
import { requireAllowlistedRecord } from "../core/record-validation.js";
import { DEFAULT_HOST_YIELD_CADENCE, createHostYieldGate, type HostYieldCadence } from "../capture/host-yield-cadence.js";
import type { NativeTaskProgress } from "../output/native-capture-sdr.js";

/** Largest image (pixels per frame) any processing operator accepts. */
export const PROCESSING_MAX_PIXELS = 1 << 26;
/** Largest number of input frames (brackets, focus slices, panorama frames). */
export const PROCESSING_MAX_FRAMES = 32;
/** Default working-memory bound when `maximumWorkingBytes` is omitted (1 GiB). */
export const PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES = 1 << 30;
export const PROCESSING_MODEL_VERSION = "1.0.0" as const;

/** Host hooks, the same shape as the native task providers. */
export interface ProcessingProvider {
  /** Must yield to the host event loop, allowing cancellation/input events between rows. */
  yieldControl(signal: AbortSignal): Promise<void>;
  /** Optional observer called after each processed row of each pass; cannot change output. */
  onProgress?(progress: NativeTaskProgress): void;
}

export type ProcessingTaskState = "ready" | "running" | "completed" | "cancelled" | "failed" | "disposed" | "transferred";

/** Single-use cancellable processing task. */
export interface ProcessingTask<T> {
  readonly state: ProcessingTaskState;
  /** Rows processed so far across every pass. */
  readonly completedTileCount: number;
  /** Total rows of every pass; known before `run()`. */
  readonly totalTileCount: number;
  /** Upper estimate of typed-array bytes allocated by the task, including its output. */
  readonly estimatedWorkingBytes: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  takeOutput(): T;
}

/** Interleaved RGB image: `data[(y·width + x)·3 + c]`, row-major, +Y down. */
export interface ProcessingRgbImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** Linear RGB encodings the colour-aware operators accept (all D65). */
export type ProcessingLinearColorSpace = "linear-srgb-d65" | "linear-display-p3-d65" | "linear-rec2020-d65";

/** Result provenance of a processing operator; processing outputs are never calibrated. */
export interface ProcessingProvenance extends CalculationProvenance {
  kind: "approximation";
  assumptions: readonly string[];
}

export function processingProvenance(model: string, assumptions: readonly string[]): ProcessingProvenance {
  return { kind: "approximation", model, modelVersion: PROCESSING_MODEL_VERSION, assumptions: [...assumptions] };
}

/** Internal: a processing body yields once per processed row of every pass. */
export type ProcessingBody<T> = Generator<void, T, void>;

interface TaskSpec<T> {
  provider: unknown;
  totalTileCount: number;
  estimatedWorkingBytes: number;
  maximumWorkingBytes: number;
  body: () => ProcessingBody<T>;
  cadence?: HostYieldCadence;
}

/** Internal: wraps a row generator in the shared cancellable task contract. */
export function createProcessingTask<T>(spec: TaskSpec<T>): ProcessingTask<T> {
  const hooks = requireProvider(spec.provider);
  if (spec.estimatedWorkingBytes > spec.maximumWorkingBytes) {
    throw new InvalidConfigurationError("Processing working memory estimate (" + spec.estimatedWorkingBytes + " bytes) exceeds maximumWorkingBytes.");
  }
  const yieldControl = hooks.yieldControl.bind(hooks), onProgress = hooks.onProgress?.bind(hooks);
  const abort = new AbortController(), total = spec.totalTileCount;
  let state: ProcessingTaskState = "ready", completed = 0, output: T | null = null;
  const check = (): void => { if (abort.signal.aborted) throw new InvalidConfigurationError("Processing task aborted."); };
  return {
    get state(): ProcessingTaskState { return state; },
    get completedTileCount(): number { return completed; },
    totalTileCount: total,
    estimatedWorkingBytes: spec.estimatedWorkingBytes,
    async run(): Promise<void> {
      if (state !== "ready") throw new InvalidConfigurationError("Processing task is single-use.");
      state = "running";
      try {
        const gate = createHostYieldGate(spec.cadence ?? DEFAULT_HOST_YIELD_CADENCE), body = spec.body();
        for (;;) {
          check();
          const step = body.next();
          if (step.done === true) { output = step.value; break; }
          completed++;
          onProgress?.({ completedTileCount: completed, totalTileCount: total });
          if (gate.due()) { await yieldControl(abort.signal); check(); gate.restart(); }
        }
        if (completed !== total) throw new InvalidScientificResultError("Processing progress accounting disagrees with its plan.");
        await yieldControl(abort.signal); check();
        state = "completed";
      } catch (error) {
        output = null;
        if (!abort.signal.aborted) { state = "failed"; abort.abort(); }
        throw error;
      }
    },
    cancel(): void { if (state === "ready" || state === "running" || state === "completed") { state = "cancelled"; abort.abort(); output = null; } },
    dispose(): void { if (state !== "transferred") { state = "disposed"; abort.abort(); output = null; } },
    takeOutput(): T {
      if (state !== "completed" || output === null) throw new InvalidConfigurationError("Processing output unavailable.");
      const value = output; output = null; state = "transferred";
      return value;
    }
  };
}

function requireProvider(provider: unknown): ProcessingProvider {
  const hooks = provider as ProcessingProvider | null | undefined;
  if (hooks === null || typeof hooks !== "object" || typeof hooks.yieldControl !== "function" ||
      (hooks.onProgress !== undefined && typeof hooks.onProgress !== "function")) {
    throw new InvalidConfigurationError("Processing requires a provider { yieldControl, onProgress? }.");
  }
  return hooks;
}

// ------------------------------------------------------------------ validation helpers (internal)

export function requireOptions(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  return requireAllowlistedRecord(value, keys, label + " must be an object with only the documented fields.");
}

export function requireFiniteIn(value: unknown, label: string, min: number, max: number, exclusiveMin = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    throw new InvalidScientificInputError(label + " must be a finite number in " + (exclusiveMin ? "(" : "[") + min + ", " + max + "].");
  }
  return value;
}

export function optionalFiniteIn(value: unknown, fallback: number, label: string, min: number, max: number, exclusiveMin = false): number {
  return value === undefined ? fallback : requireFiniteIn(value, label, min, max, exclusiveMin);
}

export function requireIntegerIn(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidConfigurationError(label + " must be an integer in [" + min + ", " + max + "].");
  }
  return value;
}

export function optionalIntegerIn(value: unknown, fallback: number, label: string, min: number, max: number): number {
  return value === undefined ? fallback : requireIntegerIn(value, label, min, max);
}

export function requireEnum<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new InvalidConfigurationError(label + " must be one of " + allowed.join(", ") + ".");
  }
  return value as T;
}

export function maximumWorkingBytes(value: unknown): number {
  return optionalIntegerIn(value, PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES, "maximumWorkingBytes", 1, Number.MAX_SAFE_INTEGER);
}

/** Validates the shape (not the values) of an interleaved image; values are checked by `finiteRows`. */
export function requireImage(value: unknown, label: string, channels = 3): ProcessingRgbImage {
  const r = requireOptions(value, ["width", "height", "data"], label);
  const width = requireIntegerIn(r.width, label + ".width", 1, PROCESSING_MAX_PIXELS);
  const height = requireIntegerIn(r.height, label + ".height", 1, PROCESSING_MAX_PIXELS);
  if (width * height > PROCESSING_MAX_PIXELS) throw new InvalidConfigurationError(label + " exceeds " + PROCESSING_MAX_PIXELS + " pixels.");
  if (!(r.data instanceof Float32Array) || r.data.length !== width * height * channels) {
    throw new InvalidConfigurationError(label + ".data must be a Float32Array of width·height·" + channels + " samples.");
  }
  return { width, height, data: r.data };
}

/** Validates 1..PROCESSING_MAX_FRAMES same-size images. */
export function requireImageList(value: unknown, label: string, minimum: number): ProcessingRgbImage[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > PROCESSING_MAX_FRAMES) {
    throw new InvalidConfigurationError(label + " must contain " + minimum + " to " + PROCESSING_MAX_FRAMES + " images.");
  }
  const images = value.map((v, i) => requireImage(v, label + "[" + i + "]"));
  if (images.some((im) => im.width !== images[0]!.width || im.height !== images[0]!.height)) {
    throw new InvalidConfigurationError(label + " images must share one size.");
  }
  return images;
}

/** Fails closed when a stored output sample in [from, to) is not finite (NaN or Infinity never leaves an operator). */
export function requireFiniteOutput(data: Float32Array, from: number, to: number, operator: string): void {
  for (let i = from; i < to; i++) if (!Number.isFinite(data[i]!)) throw new InvalidScientificResultError(operator + " gives a non-finite value; check its parameters against the image values.");
}

/** Row generator rejecting non-finite samples (one tile per row). */
export function* finiteRows(data: Float32Array, width: number, height: number, channels: number, label: string,
  minimum = -Infinity): ProcessingBody<void> {
  const stride = width * channels;
  for (let y = 0; y < height; y++) {
    for (let i = y * stride, end = i + stride; i < end; i++) {
      const v = data[i]!;
      if (!Number.isFinite(v) || v < minimum) throw new InvalidScientificInputError(label + " samples must be finite" + (minimum > -Infinity ? " and ≥ " + minimum : "") + ".");
    }
    yield;
  }
}
