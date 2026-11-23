// SPDX-License-Identifier: Apache-2.0
/**
 * #767: the display view with camera motion or a moving subject, `lens.diffraction`, the four-spot filter and a 2 × 2 box. The view's
 * lens signal (display-view-lens-signal.ts) already sums each site's kernel taps on the site lattice; it was refused by the capture's
 * per-tap count. Since #767 the capture's lattice flag (#761) also holds for a view, so the view counts its queries as the capture does,
 * without the taps, and reports `execution: "image-space-convolution"` where the taps pass 100000.
 *
 * Part 1 of 3 (the per-site check against the capture). One file in 2.29.0's group V, split at integration for the per-file coverage budget; the
 * requests are in test/helpers/display-view-motion-diffraction-cases.ts, and the cases and bounds are unchanged.
 */
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ calls: [] as { input: unknown; provider: unknown }[] }));
vi.mock("../src/facade/defocus-image-space-provider.js", async (importOriginal): Promise<typeof import("../src/facade/defocus-image-space-provider.js")> => {
  const actual = await importOriginal<typeof import("../src/facade/defocus-image-space-provider.js")>();
  return { ...actual, createDefocusImageSpaceProvider: (input): ReturnType<typeof actual.createDefocusImageSpaceProvider> => { const provider = actual.createDefocusImageSpaceProvider(input); captured.calls.push({ input, provider }); return provider; } };
});

import { calculateEnvironmentSensorPhotoSignal, simulateCapture, type PlanarSceneRadianceProvider } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { defocus, handheld, request, subject, yaw, type Request } from "./helpers/display-view-motion-diffraction-cases.js";

const electrons = (environment: unknown, evaluateRadiance: unknown): number => (calculateEnvironmentSensorPhotoSignal({ ...(environment as object), evaluateRadiance } as never)
  .value as unknown as { photo: { value: { photoSignal: { expectedGeneratedElectronCount: number } } } }).photo.value.photoSignal.expectedGeneratedElectronCount;

describe("the display view with motion, lens.diffraction and the anti-aliasing filter (#767)", () => {
  it("gives the capture's expected electrons per site within 1e-9 (every fifth site, fast: false)", async () => {
    const cases: [string, Request][] = [
      ["yaw 1/15 s", { motion: yaw }],
      ["hand shake", { motion: handheld }],
      ["subject f/8, 4 µm", { motion: subject, pitch: 4 }],
      ["subject f/16, 4 µm", { motion: subject, pitch: 4, fNumber: 16 }],
      ["yaw, dead leaves", { motion: yaw, scene: "dead-leaves" }],
      ["rolling yaw 1/60 s", { motion: { ...yaw, shutter: "rolling" }, shutterSeconds: 1 / 60 }],
      ["yaw, lens.defocus", { motion: yaw, lens: defocus }]];
    for (const [name, o] of cases) {
      const options = request({ ...o, fast: false });
      captured.calls.length = 0;
      const capture = await simulateCapture(options);
      // The capture's image-space provider: diffraction on the site lattice (#761), or diffraction ⊛ the disc with lens.defocus (#548).
      const { provider } = captured.calls.at(-1) as { provider: PlanarSceneRadianceProvider }, evaluate = provider.evaluateRadiance.bind(provider);
      const { signal } = await simulateDisplayViewWithInternals(options, { width: 10, height: 7, samplesPerAxis: 1 });
      const native = capture.plan.exposure.geometry.nativeRaster;
      let largest = 0;
      for (let i = 0; i < native.pixelWidth * native.pixelHeight; i += 5) {
        const reference = electrons(capture.request.siteInput(i).environment, evaluate);
        largest = Math.max(largest, Math.abs(signal.site(i % native.pixelWidth, Math.floor(i / native.pixelWidth)) - reference) / reference);
      }
      expect(largest, name).toBeLessThan(1e-9);
    }
  }, scaledTimeout(240_000));
});
