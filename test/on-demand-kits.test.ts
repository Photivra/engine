// SPDX-License-Identifier: Apache-2.0
/**
 * #594 (2.22.0): the CPU full-quality code and the opt-in features load on demand, where a request that asks for them is parsed.
 * A default request loads neither kit; a request with an opt-in feature loads only the opt-in kit; a full-quality option loads the
 * Quality kit. Results are unchanged by the split: the hash locks of every path (diffraction, AHD, defocus, profiles, mixed light,
 * moving subjects, coupled rendering) run through these loads. The bundle shape is checked in test/capture-bundle.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ImageKernelExecutionError, simulateCapture, simulateDisplayView } from "../src/index.js";
import { loadedKit, optInKit, qualityKit } from "../src/facade/on-demand-kits.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("on-demand CPU kits (#594)", () => {
  it("load only for the requests that need them", async () => {
    expect(() => loadedKit(qualityKit)).toThrow(ImageKernelExecutionError);
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 } });
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16, format: "png" }, fast: false });
    await simulateDisplayView({ scene: { preset: "slanted-edge" }, output: { width: 240, height: 160 } }, { width: 24, height: 16 });
    // The app's focus control (the geometric disc) stays on the fast path.
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, lens: { defocus: { model: "geometric-disc" }, focusDistanceM: 1 } });
    expect(qualityKit.loaded).toBeUndefined();
    expect(optInKit.loaded).toBeUndefined();
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, motion: { subject: { velocityMPerSec: { x: 0.1 } } } });
    expect(optInKit.loaded).toBeDefined();
    expect(qualityKit.loaded).toBeUndefined();
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, lens: { diffraction: "circular-aperture" } });
    expect(qualityKit.loaded).toBeDefined();
    expect(loadedKit(qualityKit)).toBe(await qualityKit.load());
  }, scaledTimeout(120_000));
});
