// SPDX-License-Identifier: Apache-2.0

/**
 * 2.24.0 (#607, owner decision 2026-11-11): the curated, cited list of cameras' dual-gain switch points that
 * `simulateDngRawWhatIf` uses when the caller does not pass `highGainFromIso`. A DNG does not state its camera's conversion-gain
 * switch, and an ISO what-if is offered only within the photo's own gain mode, so a model not on this list (and without a
 * caller-supplied value) refuses the higher-ISO what-if with `gain-mode-unknown`; a darker exposure needs no entry.
 *
 * Rules for an entry (docs/IMPORT_AND_PNG.md, "Adding a gain-switch entry"):
 * - `make` and `model` exactly as the file's Make (271) and Model (272) tags state them (compared after trimming; the make
 *   ignores case).
 * - `highGainFromIso`: the ISO setting from which the camera uses its high conversion gain for photos, as the source states it
 *   (null: the source states the camera has one conversion gain). A value derived from overlapping menu ranges, or measured but
 *   not stated, is not an entry.
 * - `source`: a free-to-use source that clearly states that switch point (manufacturer documentation, or openly published
 *   measurements whose terms allow reuse of the facts), with its terms, recorded in THIRD_PARTY.md as well.
 *
 * The list is empty in 2.24.0: no source reviewed for it states a photo-mode switch point clearly (THIRD_PARTY.md, "Dual-gain switch
 * points"). Data only; nothing here is indexed by signal level.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";

/** One camera's dual-gain switch point with its source. */
export interface DngGainSwitchEntry {
  /** The file's Make tag (271). */
  make: string;
  /** The file's Model tag (272). */
  model: string;
  /** The ISO setting from which the high conversion gain is used for photos, or null for one conversion gain. */
  highGainFromIso: number | null;
  /** Where the value is stated, and on what terms it is reused. */
  source: { title: string; url: string; terms: string; accessed: string };
}

/** The curated list (empty in 2.24.0; see the module comment for how to add an entry). */
export const DNG_GAIN_SWITCH_CATALOG: readonly DngGainSwitchEntry[] = /* @__PURE__ */ Object.freeze([]);

/** Internal: the entry for a file's Make and Model in `entries`, or null. */
export function findDngGainSwitch(make: string | null, model: string | null, entries: readonly DngGainSwitchEntry[]): DngGainSwitchEntry | null {
  if (make === null || model === null) return null;
  const mk = make.trim().toLowerCase(), md = model.trim();
  return entries.find((e) => e.make.trim().toLowerCase() === mk && e.model.trim() === md) ?? null;
}

/** The catalog's entry for an imported file's camera (its Make and Model), or null when the camera is not on the list. */
export function resolveDngGainSwitch(raw: { make: string | null; model: string | null }): DngGainSwitchEntry | null {
  const ok = (v: unknown): boolean => v === null || typeof v === "string";
  if (raw === null || typeof raw !== "object" || !ok(raw.make) || !ok(raw.model)) throw new InvalidConfigurationError("resolveDngGainSwitch: raw must be an ImportedDngRaw (or { make, model }).");
  return findDngGainSwitch(raw.make, raw.model, DNG_GAIN_SWITCH_CATALOG);
}
