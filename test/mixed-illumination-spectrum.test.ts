// SPDX-License-Identifier: Apache-2.0
/**
 * #735: under mixed lighting a point's blend, its point sources' fall-off and its material are resolved once per point, not once
 * per spectral node. The spectrum forms (`irradianceSpectrumAt`, the lit provider's spectrum form) give `Object.is` the values of
 * the per-node functions, a caller material scene's `materialAt` runs once per query point, and four requests keep their bytes.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateCapture, type MixedIllumination, type SimulateCaptureOptions } from "../src/index.js";
import { resolveMixedIllumination } from "../src/facade/mixed-illumination.js";
import { buildPlanarSceneRadianceProvider, planarRadianceSpectrumOf, requireCallerScene, resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { resolveChartScene, type ChartScene } from "../src/facade/chart-scenes.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const A = { illuminant: "cie-a" as const, illuminanceLux: 3000 }, B = { illuminant: { kind: "planckian" as const, temperatureKelvin: 6500 }, illuminanceLux: 8000 };
const REGIONS = Array.from({ length: 64 }, (_, i) => ({ source: i % 2, uMin: -1 + (i % 8) * 0.25, uMax: -0.8 + (i % 8) * 0.25,
  vMin: -0.66 + Math.floor(i / 8) * 0.165, vMax: -0.51 + Math.floor(i / 8) * 0.165 }));
const LIGHTS: Record<string, MixedIllumination> = {
  gradient: { sources: [B, A], blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } } },
  radial: { sources: [B, A], blend: { kind: "radial", radius: 0.6 } },
  regions: { sources: [B, A], blend: { kind: "regions", regions: REGIONS, outsideSource: 0 } },
  points: { sources: [B, A], blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } },
    points: [{ illuminant: "cie-a", position: { xM: 0.3, yM: 0.2, heightM: 1 }, intensity: { candela: 900 } }] }
};
const MORE: Record<string, MixedIllumination> = {
  "three sources, a hard edge": { sources: [B, A, { illuminant: { kind: "planckian", temperatureKelvin: 2800 }, illuminanceLux: 2000 }],
    blend: { kind: "linear-gradient", from: { u: -0.8, v: -0.3 }, to: { u: 0.7, v: 0.4 }, stops: [0, 0.5, 0.5] } },
  "points alone": { points: [{ illuminant: "cie-a", position: { xM: 0.1, yM: -0.2, heightM: 0.4 }, intensity: { candela: 300 } },
    { illuminant: { kind: "planckian", temperatureKelvin: 4000 }, position: { xM: -0.4, yM: 0.1, heightM: 0.5 }, intensity: { illuminanceLux: 500, distanceM: 1 } }] },
  flash: { sources: [B, A], blend: { kind: "radial", radius: 0.6 }, flash: { output: { guideNumberM: 20 } } }
};
const NODES = Array.from({ length: 81 }, (_, i) => 380 + 5 * i);
/** Points on a grid that includes the blends' stops, the regions' edges and the frame's edges. */
const POINTS = Array.from({ length: 41 * 33 }, (_, i) => [-1.25 + (i % 41) * 0.0625, -1 + Math.floor(i / 41) * 0.0625] as const);
const sha = (a: ArrayBufferView): string => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

describe("mixed lighting resolved per point (#735)", () => {
  it("irradianceSpectrumAt gives irradianceAt's values at every node", () => {
    const out = new Float64Array(NODES.length);
    for (const [name, illumination] of Object.entries({ ...LIGHTS, ...MORE })) {
      const light = resolveMixedIllumination(illumination, resolveCaptureIlluminant, 1 / 125, 2);
      let differ = 0;
      for (const [u, v] of POINTS) {
        light.irradianceSpectrumAt(u, v, u * 0.7, v * 0.7, NODES, out);
        NODES.forEach((nm, n) => { if (!Object.is(out[n], light.irradianceAt(u, v, u * 0.7, v * 0.7, nm))) differ++; });
      }
      expect(differ, name).toBe(0);
    }
  });

  it("the lit provider's spectrum form gives radianceAt's values for charts, the surround and caller scenes", () => {
    const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "photivra:test", reuseStatus: "photivra-owned" as const }];
    const scenes: [string, Parameters<typeof buildPlanarSceneRadianceProvider>[0]["scene"], boolean][] = [
      ["color patches (spectral materials)", resolveChartScene({ scene: { preset: "color-patches" } as ChartScene, aspect: 2 / 3 }), false],
      ["dead leaves (neutral materials)", resolveChartScene({ scene: { preset: "dead-leaves" } as ChartScene, aspect: 2 / 3 }), false],
      ["a fixed-size chart and its surround", resolveChartScene({ scene: { preset: "color-patches" } as ChartScene, aspect: 2 / 3 }), true],
      ["a caller material scene", requireCallerScene({ kind: "material-function", sceneId: "t735", materials: [0.2, 0.7, 0.45],
        materialAt: (p: { u: number; v: number }) => (p.u * 7 + p.v * 3 > 0 ? 1 : p.v > 0.2 ? 2 : 0) }), true],
      ["a caller reflectance function", requireCallerScene({ kind: "reflectance-function", sceneId: "t735r",
        evaluate: (p: { u: number; wavelengthNanometers: number }) => 0.3 + 0.2 * Math.sin(p.u * 9 + p.wavelengthNanometers / 50) }), false]
    ];
    const out = new Float64Array(NODES.length);
    for (const [name, illumination] of Object.entries(LIGHTS)) {
      const light = resolveMixedIllumination(illumination, resolveCaptureIlluminant);
      for (const [sceneName, scene, sized] of scenes) {
        const provider = buildPlanarSceneRadianceProvider({ scene, sceneId: "s", providerProfileId: "p", illuminant: light.sources[0]!.illuminant, irradianceScale: 1,
          geometry: { distanceM: 2, metresPerFrameUnit: 0.4, ...(sized ? { chart: { widthM: 0.5, heightM: 0.33, surroundReflectance: 0.18 } } : {}) },
          evidence, limitations: [], irradianceAt: light.irradianceAt, illumination: light });
        const spectrum = planarRadianceSpectrumOf(provider.radianceAt)!;
        expect(spectrum, sceneName).toBeTypeOf("function");
        let differ = 0;
        for (const [u, v] of POINTS) {
          spectrum(u, v, NODES, out);
          NODES.forEach((nm, n) => { if (!Object.is(out[n], provider.radianceAt(u, v, nm))) differ++; });
        }
        expect(differ, name + ", " + sceneName).toBe(0);
      }
    }
    // Only the provider's own function has a spectrum form.
    expect(planarRadianceSpectrumOf((u: number) => u)).toBeUndefined();
  });

  it("resolves a caller material scene's material once per query point, not once per spectral node", async () => {
    const calls = async (step: number): Promise<number> => {
      let count = 0;
      await simulateCapture({ scene: { kind: "material-function", sceneId: "t735-count", materials: [0.2, 0.7], materialAt: (p: { u: number }) => (count++, p.u > 0 ? 1 : 0) },
        illumination: LIGHTS.gradient!, sensor: { spectralStepNanometers: step }, output: { width: 64, height: 48 }, fast: false });
      return count;
    };
    const coarse = await calls(20), fine = await calls(5);
    // 81 nodes against 21: per node, materialAt ran about 81 / 21 = 3.9 times as often at 5 nm (3.3 times in 2.27.0 at this
    // size). Per point the counts differ only by the few sites the tabulated path checks through the environment, once per node.
    expect(fine / coarse).toBeLessThan(1.25);
  }, scaledTimeout(60_000));

  it("keeps the samples of the four requests of #735 (96 × 64, 5 nm, full quality)", async () => {
    // Recorded at e228-int 8405ae2, before the change (the same on x64 and arm64: image samples).
    const LOCKS: Record<string, string> = {
      gradient: "c52eb398e33a422f74ecab75664611a353967210a6a7e2be357f1a735a775be3",
      radial: "867a0eb540f5a00072eb2d8085c3046870debcb87f648b42e7a5e75e8c99bf7c",
      regions: "8eea295c358e8917e02982725b748e495cdd4190704dd01e6b03e791b171200f",
      points: "f915f24db31377f8233c26db37b5033c5652cca83dc5f4dfc6e2b9d29fa6f22a"
    };
    for (const [name, illumination] of Object.entries(LIGHTS)) {
      const options: SimulateCaptureOptions = { scene: { preset: "color-patches" }, illumination, sensor: { spectralStepNanometers: 5 }, output: { width: 96, height: 64 }, fast: false };
      const result = await simulateCapture(options);
      expect(sha(result.image.samples), name).toBe(LOCKS[name]);
      expect(result.diagnostics.providerEvaluationCount, name).toBe(518_080);
    }
  }, scaledTimeout(120_000));
});
