// SPDX-License-Identifier: Apache-2.0

/**
 * Shared input checks used by the domain parsers: plain-record and allowed-key checks, the
 * public identifier grammar, and guards for the top-level argument of a public function.
 * Each domain keeps its own schema and error messages.
 * @see docs/API_STYLE.md for equations, coordinate/unit conventions, blockers and support limits.
 */

import { InvalidConfigurationError } from "./configuration-error.js";
import { InvalidScientificInputError } from "./validation.js";

/**
 * Checks that a value is a plain record whose keys are all on an allowlist. The caller
 * supplies the domain's schema and error messages.
 *
 * Returns the original record. It does not copy, freeze or strip fields, require missing
 * fields, or check child values. Like the domain parsers, it checks own enumerable string keys.
 * From 2.0.0 an unknown key also names the field: `<message> Unknown field "<field>".`
 */
export function requireAllowlistedRecord(
  value: unknown, allowedKeys: readonly string[], message: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConfigurationError(message);
  }
  for (const key in value) {
    if (Object.hasOwn(value, key) && !allowedKeys.includes(key)) {
      throw new InvalidConfigurationError(`${message} Unknown field ${JSON.stringify(key)}.`);
    }
  }
  return value as Record<string, unknown>;
}

/**
 * Shared grammar for public identifiers: 1–128 ASCII characters. The first is a letter or
 * digit. The rest are letters, digits, dot, underscore, colon or hyphen.
 *
 * The identifier is opaque: no trimming, case conversion or path/URL interpretation. Each
 * domain decides what the identifier means and keeps its exact error message.
 */
export function requirePublicOpaqueId(value: unknown, message: string): string {
  if (!isPublicOpaqueId(value)) {
    throw new InvalidConfigurationError(message);
  }
  return value;
}

/** Same grammar for domains that combine ID rejection with other field checks. */
export function isPublicOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

/**
 * Guard for a public function's input object. If it receives null, a primitive or an array,
 * it throws the domain's InvalidConfigurationError, never a raw TypeError from reading a
 * property. It does not check fields.
 */
export function requireInputObject(value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidConfigurationError(`${label} must be an object.`);
  }
}

/** Root-function input guard for a required array argument; see requireInputObject. */
export function requireInputArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new InvalidConfigurationError(`${label} must be an array.`);
  }
}

/**
 * Input object guard for simple scalar calculators that also rejects unknown keys. A misspelled
 * or wrong-unit field (for example focusDistanceMm instead of focusDistanceM) is never silently ignored.
 */
export function requireInputKeys(value: unknown, functionName: string, allowedKeys: readonly string[]): void {
  requireInputObject(value, `${functionName} input`);
  // for-in over own keys avoids allocating a key array on hot scalar paths.
  for (const key in value as object) {
    if (Object.hasOwn(value as object, key) && !allowedKeys.includes(key)) {
      throw new InvalidConfigurationError(`${functionName} input has unknown field ${JSON.stringify(key)}.`);
    }
  }
}

/**
 * Rejects any own enumerable key of a versioned or engine record that is not on its allowlist, with
 * the message `<path> has unknown field "<field>".` The caller has already checked that `record` is
 * a plain object. Used at every object level of the `parse*()` record parsers, so a misspelled or
 * stale field in a stored profile fails instead of being silently dropped.
 */
export function rejectUnknownFields(record: object, allowedKeys: readonly string[], path: string): void {
  for (const key in record) {
    if (Object.hasOwn(record, key) && !allowedKeys.includes(key)) {
      throw new InvalidConfigurationError(`${path} has unknown field ${JSON.stringify(key)}.`);
    }
  }
}

/**
 * Checks the fixed-value flags that a parser writes into its own output (for example
 * `sceneRadianceCalculated: false`). They may be passed back in, so a parsed record parses again,
 * but only with exactly the fixed value; any other value is rejected rather than ignored.
 */
export function requireFixedFieldsWhenPresent(
  record: Readonly<Record<string, unknown>>, fixed: Readonly<Record<string, boolean | string>>, path: string
): void {
  for (const key of Object.keys(fixed)) {
    if (record[key] !== undefined && record[key] !== fixed[key]) {
      throw new InvalidConfigurationError(`${path}.${key} must be ${JSON.stringify(fixed[key])} when supplied.`);
    }
  }
}

/**
 * Fields of the shared relative / not-quantified uncertainty union used by many evidence-backed
 * profiles: `{ kind: "relative", fraction, basis }` or `{ kind: "not-quantified", limitation }`.
 */
export const UNCERTAINTY_VARIANT_FIELDS: Readonly<Record<string, readonly string[]>> = /* @__PURE__ */ Object.freeze({
  relative: /* @__PURE__ */ Object.freeze(["kind", "fraction", "basis"]),
  "not-quantified": /* @__PURE__ */ Object.freeze(["kind", "limitation"])
});

/**
 * For a record whose allowed fields depend on a discriminator (for example `kind` or
 * `schemaVersion`), rejects fields that the selected variant does not define. An unrecognized
 * discriminator is left to the caller, which reports it with its own message.
 */
export function rejectUnknownVariantFields(
  record: Readonly<Record<string, unknown>>, discriminator: string,
  allowedByVariant: Readonly<Record<string, readonly string[]>>, path: string
): void {
  const variant = record[discriminator];
  if (typeof variant === "string" && Object.hasOwn(allowedByVariant, variant)) {
    rejectUnknownFields(record, allowedByVariant[variant]!, path);
  }
}

// Field checks shared by the domain parsers, each with the one message every parser used for it (2.19.0: these were private
// copies in up to 44 modules; one shared copy keeps the bundles smaller and the messages unchanged).

/** A plain object (not null, not an array) whose keys are on `allowedKeys` (null: any keys): `<path> must be an object.` */
export function requireConfigRecord(value: unknown, path: string, allowedKeys: readonly string[] | null): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new InvalidConfigurationError(path + " must be an object.");
  if (allowedKeys !== null) rejectUnknownFields(value, allowedKeys, path);
  return value as Record<string, unknown>;
}
/** `record[key]`, a string that is not blank: `<path>.<key> must be a non-empty string.` */
export function requireConfigRecordString(record: Readonly<Record<string, unknown>>, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidConfigurationError(path + "." + key + " must be a non-empty string.");
  return value;
}
/** A string that is not blank, returned as given: `<path> must be a non-empty string.` */
export function requireConfigString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new InvalidConfigurationError(path + " must be a non-empty string.");
  return value;
}
/** A string that is not blank, returned trimmed: `<path> must be a non-empty string.` */
export function requireTrimmedConfigString(value: unknown, path: string): string {
  return requireConfigString(value, path).trim();
}
/** A finite number: `<path> must be finite.` */
export function requireConfigFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidConfigurationError(path + " must be finite.");
  return value;
}
/** A finite number: `<path> must be a finite number.` */
export function requireConfigFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidConfigurationError(path + " must be a finite number.");
  return value;
}
/** A finite number above zero: `<path> must be finite and greater than zero.` */
export function requireConfigPositiveFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidConfigurationError(path + " must be finite and greater than zero.");
  return value;
}
/** A finite number at least zero: `<path> must be finite and greater than or equal to zero.` */
export function requireConfigNonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new InvalidConfigurationError(path + " must be finite and greater than or equal to zero.");
  return value;
}
/** A safe integer above zero: `<path> must be a positive safe integer.` */
export function requireConfigPositiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new InvalidConfigurationError(path + " must be a positive safe integer.");
  return value;
}
/** A safe integer at least zero: `<path> must be a non-negative safe integer.` */
export function requireConfigNonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidConfigurationError(path + " must be a non-negative safe integer.");
  return value;
}
/** `"calibrated"` or `"approximation"`: `<path> is invalid.` */
export function parseConfigScientificStatus(value: unknown, path: string): "calibrated" | "approximation" {
  if (value !== "calibrated" && value !== "approximation") throw new InvalidConfigurationError(path + " is invalid.");
  return value;
}
/** `"supported"`, `"unsupported"` or `"unknown"`: `<path> is invalid.` */
export function parseConfigAvailability(value: unknown, path: string): "supported" | "unsupported" | "unknown" {
  if (value !== "supported" && value !== "unsupported" && value !== "unknown") throw new InvalidConfigurationError(path + " is invalid.");
  return value;
}
/** A finite number (scientific input): `<path> must be finite.` */
export function requireInputFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidScientificInputError(path + " must be finite.");
  return value;
}
/** A finite number above zero (scientific input): `<path> must be finite and greater than zero.` */
export function requireInputPositiveFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidScientificInputError(path + " must be finite and greater than zero.");
  return value;
}
/** A finite number at least zero (scientific input): `<path> must be finite and greater than or equal to zero.` */
export function requireInputNonNegativeFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new InvalidScientificInputError(path + " must be finite and greater than or equal to zero.");
  return value;
}
/** A safe integer at least zero (scientific input): `<path> must be a non-negative safe integer.` */
export function requireInputNonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new InvalidScientificInputError(path + " must be a non-negative safe integer.");
  return value;
}
/** A finite number, name first (scientific input): `<name> must be finite.` */
export function requireNamedFinite(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidScientificInputError(name + " must be finite.");
  return value;
}
/** Throws unless `value` is finite (scientific input): `<name> must be finite.` */
export function assertNamedFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new InvalidScientificInputError(name + " must be finite.");
}
/** An array of distinct non-blank strings, each trimmed: `<path> must be an array.`, `<path> must not contain duplicates.` */
export function parseConfigLimitations(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new InvalidConfigurationError(path + " must be an array.");
  const parsed = value.map((entry, index) => requireTrimmedConfigString(entry, path + "[" + index + "]"));
  if (new Set(parsed).size !== parsed.length) throw new InvalidConfigurationError(path + " must not contain duplicates.");
  return parsed;
}
/** A finite number above zero: `<path> must be finite.`, then `<path> must be greater than zero.` */
export function requireConfigFiniteAboveZero(value: unknown, path: string): number {
  const parsed = requireConfigFinite(value, path);
  if (parsed <= 0) throw new InvalidConfigurationError(path + " must be greater than zero.");
  return parsed;
}
/** A finite number at least zero: `<path> must be finite.`, then `<path> must be greater than or equal to zero.` */
export function requireConfigFiniteAtLeastZero(value: unknown, path: string): number {
  const parsed = requireConfigFinite(value, path);
  if (parsed < 0) throw new InvalidConfigurationError(path + " must be greater than or equal to zero.");
  return parsed;
}
/** A finite number above zero: `<path> must be a finite number.`, then `<path> must be greater than zero.` */
export function requireConfigNumberAboveZero(value: unknown, path: string): number {
  const parsed = requireConfigFiniteNumber(value, path);
  if (parsed <= 0) throw new InvalidConfigurationError(path + " must be greater than zero.");
  return parsed;
}
/** A finite number at least zero: `<path> must be a finite number.`, then `<path> must be greater than or equal to zero.` */
export function requireConfigNumberAtLeastZero(value: unknown, path: string): number {
  const parsed = requireConfigFiniteNumber(value, path);
  if (parsed < 0) throw new InvalidConfigurationError(path + " must be greater than or equal to zero.");
  return parsed;
}
/** A number from 0 through 1: `<path> must be a finite number.`, then `<path> must be a finite fraction from 0 through 1.` */
export function requireConfigFraction(value: unknown, path: string): number {
  const parsed = requireConfigFiniteNumber(value, path);
  if (parsed < 0 || parsed > 1) throw new InvalidConfigurationError(path + " must be a finite fraction from 0 through 1.");
  return parsed;
}
/** A number from 0 through 1: `<path> must be finite.`, then `<path> must lie from zero through one.` */
export function requireConfigUnitInterval(value: unknown, path: string): number {
  const parsed = requireConfigFinite(value, path);
  if (parsed < 0 || parsed > 1) throw new InvalidConfigurationError(path + " must lie from zero through one.");
  return parsed;
}
/** A finite number above zero (scientific input): `<path> must be finite.`, then `<path> must be greater than zero.` */
export function requireInputFiniteAboveZero(value: unknown, path: string): number {
  const parsed = requireInputFinite(value, path);
  if (parsed <= 0) throw new InvalidScientificInputError(path + " must be greater than zero.");
  return parsed;
}
/** A finite number at least zero (scientific input): `<path> must be finite.`, then `<path> must be greater than or equal to zero.` */
export function requireInputFiniteAtLeastZero(value: unknown, path: string): number {
  const parsed = requireInputFinite(value, path);
  if (parsed < 0) throw new InvalidScientificInputError(path + " must be greater than or equal to zero.");
  return parsed;
}
