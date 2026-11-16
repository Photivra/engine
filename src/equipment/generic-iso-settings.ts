// SPDX-License-Identifier: Apache-2.0

/**
 * #646: the generic bodies' ISO setting lists in a module with no imports, so the sensor-profile record (and the framing helpers
 * through it) can use them without the generic tier assets. `generic-tier-assets.ts` re-exports them unchanged.
 */

/** Whole-stop ISO settings of the 2.0.0 bodies (each body's list stops at its maximum). */
export const GENERIC_WHOLE_STOP_ISO_SETTINGS = /* @__PURE__ */ Object.freeze([100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600] as const);
/**
 * Third-stop ISO settings of the 2.1.0 bodies: the conventional rounded markings of S = 100·2^(k/3), k = 0 … 24 (125 for
 * 126.0, 160 for 158.7 …; each within 2 % of the exact value). The engine takes the setting as the exact ISO speed.
 */
export const GENERIC_THIRD_STOP_ISO_SETTINGS = /* @__PURE__ */ Object.freeze([100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
  2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600] as const);
