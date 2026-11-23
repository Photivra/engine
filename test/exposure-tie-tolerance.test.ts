// SPDX-License-Identifier: Apache-2.0
/**
 * #753 `foundation-05` (2.29.0): Auto ISO snaps to the nearest selectable ISO in stops, the lower on a tie (docs/QUICK_START.md,
 * "Auto ISO"). The ties a request reaches (half-stop compensation, or an illuminance half a stop from the default, with grey-card
 * metering) arrive 6 to 29 ulp above the exact tie 100·√2 from rounding upstream, which the former 1e-15-stop window missed, so
 * they took the higher ISO. With one tolerance of 1e-9 stops (TIE_TOLERANCE_STOPS) they take the lower ISO. Before the change
 * the four whole-stop rows chose ISO 200, 400, 200 and 400, and the third-stop row ISO 160.
 */
import { describe, expect, it } from "vitest";
import { SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, simulateCapture, type SimulateCaptureOptions } from "../src/index.js";

const iso = async (exposure: NonNullable<SimulateCaptureOptions["exposure"]>, illuminanceLux?: number): Promise<number> =>
  (await simulateCapture({ scene: { preset: "uniform" }, output: { width: 4, height: 4 }, exposure: { iso: "auto", metering: "grey-card", ...exposure },
    ...(illuminanceLux === undefined ? {} : { illuminanceLux }) } as SimulateCaptureOptions)).exposure.settings.iso;

describe("Auto ISO on a tie takes the lower ISO (#753 foundation-05)", { timeout: 60_000 }, () => {
  it("half-stop compensation, whole-stop ISO", async () => {
    expect(await iso({ compensationStops: 0.5 })).toBe(100);
    expect(await iso({ compensationStops: 1.5 })).toBe(200);
  });

  it("an illuminance half a stop from the default", async () => {
    expect(await iso({}, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX / 2 ** 0.5)).toBe(100);
    expect(await iso({}, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX / 2 ** 1.5)).toBe(200);
  });

  it("third-stop ISO: 125 · 160 = (100·√2)², so half-stop compensation is a tie too", async () => {
    expect(await iso({ compensationStops: 0.5, autoIso: { isoSteps: "third-stop" } })).toBe(125);
  });

  it("away from a tie the nearest ISO is unchanged", async () => {
    expect(await iso({ compensationStops: 0.4 })).toBe(100);
    expect(await iso({ compensationStops: 0.6 })).toBe(200);
  });
});
