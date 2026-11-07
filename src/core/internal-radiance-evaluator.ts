// SPDX-License-Identifier: Apache-2.0

/**
 * Internal (not exported from the package): marks the scene-radiance evaluators that the engine itself builds for
 * `simulateCapture` chart scenes (2.6). Their results are object literals with the schema's exact keys, constant
 * schema/quantity/unit/status fields, the request's identifiers and deep-frozen engine-owned uncertainty, evidence
 * and limitations; the native environment then skips re-parsing those fixed parts (see
 * `parseSceneRadianceEvaluationResultWithValidatedRecords`). Evaluators from callers are never marked and keep the
 * full validation. The mark is on the function object, which only the engine holds.
 */
const INTERNAL_EVALUATORS = new WeakSet<object>();

/** Marks an engine-built evaluator and returns it. */
export function markInternalSceneRadianceEvaluator<T extends object>(evaluator: T): T {
  INTERNAL_EVALUATORS.add(evaluator);
  return evaluator;
}

/** True only for an evaluator marked by the engine. */
export function isInternalSceneRadianceEvaluator(evaluator: unknown): boolean {
  return typeof evaluator === "function" && INTERNAL_EVALUATORS.has(evaluator);
}

/**
 * Internal (#394): the lookup behind an engine-built evaluator whose result for an environment-direction query is a pure
 * function of a location key (a chart material, a convolved lattice site) and the wavelength.
 */
export interface InternalRadianceAccess {
  /**
   * The key the evaluator reads for a query with this outgoing direction at this request time (`timeSecondsFromExposureStart`);
   * undefined where it would throw. Most evaluators ignore the time; the image-space defocus with camera rotation (#548) does not.
   */
  keyOfDirection(direction: Readonly<{ x: number; y: number; z: number }>, timeSeconds: number): number | undefined;
  /** The radiance the evaluator returns for a query of that key at that wavelength. */
  radianceOfKey(key: number, wavelengthNanometers: number): number;
  /** True when keys are few (chart materials), so the native environment may keep a table of their radiances. */
  tabulated: boolean;
}
const RADIANCE_ACCESS = new WeakMap<object, InternalRadianceAccess>();

/**
 * Registers the lookup of an engine-built evaluator (#394), so the native environment may take its radiances from the key
 * instead of calling it (its lean templates verify this against their own evaluations). Only for an evaluator already marked
 * internal; caller scenes never register.
 */
export function registerInternalRadianceAccess(evaluator: object, access: InternalRadianceAccess): void {
  if (INTERNAL_EVALUATORS.has(evaluator)) RADIANCE_ACCESS.set(evaluator, access);
}

/** The registered lookup of an engine-built evaluator, if any. */
export function internalRadianceAccess(evaluator: unknown): InternalRadianceAccess | undefined {
  return typeof evaluator === "function" ? RADIANCE_ACCESS.get(evaluator) : undefined;
}

/**
 * Internal (#394): marks the native tile readers that `simulateCapture` builds. Each call returns fresh site records built by
 * the engine (new top-level objects per site, shared nested records the engine never changes afterwards), never shown to
 * supplied code, so the native environment may plan them as engine-owned data without the private structured clone it makes
 * of a caller's tiles. Readers from callers are never marked. The mark is on the function object, which only the engine holds.
 */
const INTERNAL_TILE_READERS = new WeakSet<object>();

/** Marks an engine-built native tile reader and returns it. */
export function markInternalNativeTileReader<T extends object>(reader: T): T {
  INTERNAL_TILE_READERS.add(reader);
  return reader;
}

/** True only for a tile reader marked by the engine. */
export function isInternalNativeTileReader(reader: unknown): boolean {
  return typeof reader === "function" && INTERNAL_TILE_READERS.has(reader);
}

/** True when the value and everything reachable from it are frozen (primitives count as frozen). */
export function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return typeof value !== "function";
  if (!Object.isFrozen(value)) return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (descriptor.get !== undefined || descriptor.set !== undefined || !isDeeplyFrozen(descriptor.value)) return false;
  }
  return true;
}
