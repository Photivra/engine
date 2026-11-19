// SPDX-License-Identifier: Apache-2.0
/**
 * #652: layered chart scenes load their code only through prepareLayeredChartScenes() (src/facade/layered-scene-enable.ts), as image-plane
 * scenes do through prepareImagePlaneScenes(). In a realm that has not called it, a layered request fails with a message saying so
 * (this file runs in its own module realm, so nothing else has called it).
 */
import { describe, expect, it } from "vitest";
import { prepareLayeredChartScenes, simulateCapture } from "../src/index.js";

describe("prepareLayeredChartScenes (#652)", () => {
  it("is needed before the first layered request", async () => {
    const options = { scene: { kind: "layered-chart", cards: [{ distanceM: 2, centerU: 0, centerV: 0, width: 1, height: 1, scene: { preset: "uniform" } }] },
      output: { width: 8, height: 8 } } as const;
    await expect(simulateCapture(options)).rejects.toThrow(/Call prepareLayeredChartScenes\(\) first/);
    await prepareLayeredChartScenes();
    expect((await simulateCapture(options)).scene.layers).toHaveLength(1);
  });
});
