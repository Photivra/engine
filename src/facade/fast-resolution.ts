// SPDX-License-Identifier: Apache-2.0

/**
 * The one exact-or-fast resolver (#395, 2.20.0) that every speed-versus-accuracy choice of the capture facade and the display
 * view goes through: an option record's `fast`, else the request's top-level `fast`, else the format default. The registry of
 * the choices that use it is `fast-methods.ts` (not loaded by captures); docs/API_STYLE.md, "Exact and fast modes".
 */

/**
 * The format default of the top-level `fast` (owner rule, 2.20.0): fast for the sRGB sample formats (`output.format` "srgb-8"
 * and "srgb-16") and the display view; exact (full quality) for the exports ("dng", "jpeg", "png") and the ideal reference.
 */
export function fastFormatDefault(format: string, run: "capture" | "display-view" | "ideal-reference"): boolean {
  return run === "display-view" || run !== "ideal-reference" && format.startsWith("srgb");
}

/** Record `fast` > top-level `fast` (already resolved against {@link fastFormatDefault}). */
export function resolveFast(record: boolean | undefined, top: boolean): boolean {
  return record ?? top;
}
