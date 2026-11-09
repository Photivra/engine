// SPDX-License-Identifier: Apache-2.0

/**
 * Small helpers shared by several modules (2.19.0: these were private copies in each; one shared copy keeps the bundles
 * smaller). Behaviour is unchanged.
 */

/** Freezes a value and every object it holds, depth first; already frozen objects are left as they are. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
/** A deep copy of JSON data. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
/** A running sum with Kahan compensation. */
export interface CompensatedSum { sum: number; correction: number }
/** Adds `value` to a Kahan-compensated sum (Kahan 1965). */
export function addCompensated(state: CompensatedSum, value: number): void {
  const adjusted = value - state.correction;
  const next = state.sum + adjusted;
  state.correction = (next - state.sum) - adjusted;
  state.sum = next;
}
/** Whether two points (or sites) have the same x and y. */
export function sameSite(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}
/** The whole raster as a rectangle at the origin. */
export function fullRect(raster: { pixelWidth: number; pixelHeight: number }): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: raster.pixelWidth, height: raster.pixelHeight };
}
