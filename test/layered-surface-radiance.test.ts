// SPDX-License-Identifier: Apache-2.0
/**
 * #745 at module level (2.29.0 group LR): mixed illumination on layered chart scenes, `layered-surface-radiance.ts`.
 *
 * - A radiance scene's spectrum form (`radianceSpectrumAt`, #735) gives the per-node values and the same lookup count.
 * - Without an illumination a neutral material keeps `m.neutral * white[n]` bit for bit.
 * - A lit card filling the frame gives the single-plane mixed-light provider's values bit for bit (spectral and neutral charts,
 *   four lights), and its lattice (the layered sum, no single-plane delegation) gives the single-plane expected signal of every
 *   site within 1e-9.
 * - Two sources: sites on each surface away from edges equal the hand-computed blend × reflectance integrated against the
 *   channel response within 1e-9 (blurred surfaces, a linear gradient, so a symmetric kernel's mean is the centre value).
 * - A back plane's light cell keeps its lights' own radiance on top of its lit plane.
 */
import { describe, expect, it } from "vitest";
import { createLayeredSurfaceRadiance, layeredLitSurfaceScene, type LayeredLitSurfaceInput } from "../src/facade/layered-surface-radiance.js";
import { layeredSurfaceScene, resolveLayeredChartScene, type ResolvedLayeredSurface } from "../src/facade/layered-chart-scene.js";
import { createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneSignalInput } from "../src/facade/layered-scene-signal.js";
import { createDisplayViewExpectedSignal, type DisplayViewScene } from "../src/facade/expected-signal.js";
import { resolveMixedIllumination } from "../src/facade/mixed-illumination.js";
import { buildPlanarSceneRadianceProvider, planarRadianceSpectrumOf, resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { resolveChartScene, type ChartScene } from "../src/facade/chart-scenes.js";
import { convolveSiteKernels, createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import type { MixedIllumination } from "../src/index.js";
import { RESPONSE, WAVELENGTHS, WHITE, bayer, fixture } from "./helpers/layered-scene-fixtures.js";

const A = { illuminant: "cie-a" as const, illuminanceLux: 3000 }, B = { illuminant: { kind: "planckian" as const, temperatureKelvin: 6500 }, illuminanceLux: 8000 };
const GRADIENT: MixedIllumination = { sources: [B, A], blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } } };
const LIGHTS: Record<string, MixedIllumination> = {
  gradient: GRADIENT,
  radial: { sources: [B, A], blend: { kind: "radial", radius: 0.6 } },
  regions: { sources: [B, A], blend: { kind: "regions", regions: [{ source: 1, uMin: -0.4, uMax: 0.3, vMin: -0.2, vMax: 0.25 }], outsideSource: 0 } },
  points: { ...GRADIENT, points: [{ illuminant: "cie-a", position: { xM: 0.3, yM: 0.2, heightM: 1 }, intensity: { candela: 900 } }] }
};
const NODES = Array.from({ length: 31 }, (_, i) => 400 + 10 * i);
const POINTS = Array.from({ length: 41 * 33 }, (_, i) => [-1.25 + (i % 41) * 0.0625, -1 + Math.floor(i / 41) * 0.0625] as const);
const SCALE = 0.4, ASPECT = 2 / 3;
const resolve = (illumination: MixedIllumination): ReturnType<typeof resolveMixedIllumination> => resolveMixedIllumination(illumination, resolveCaptureIlluminant);
const evidence = [{ sourceOrigin: "photivra" as const, sourceReference: "photivra:test", reuseStatus: "photivra-owned" as const }];

/** A card filling the frame (width 2, height 2·aspect, centred) in front of a back plane: the card's surface. */
function fillingCard(preset: string): ResolvedLayeredSurface {
  return resolveLayeredChartScene({ scene: { kind: "layered-chart", cards: [{ distanceM: 2, centerU: 0, centerV: 0, width: 2, height: 2 * ASPECT, scene: { preset } as ChartScene }],
    backPlane: { distanceM: 5 } }, aspect: ASPECT }).surfaces[0]!;
}
/** The single-plane mixed-light scene of the same chart, as the display view takes it (`expected-signal-setup.ts`). */
function singlePlane(preset: string, light: ReturnType<typeof resolveMixedIllumination>): Extract<DisplayViewScene, { kind: "radiance" }> {
  const provider = buildPlanarSceneRadianceProvider({ scene: resolveChartScene({ scene: { preset } as ChartScene, aspect: ASPECT }), sceneId: "s", providerProfileId: "p",
    illuminant: light.sources[0]!.illuminant, irradianceScale: 1, geometry: { distanceM: 2, metresPerFrameUnit: SCALE }, evidence, limitations: [],
    irradianceAt: light.irradianceAt, illumination: light });
  return { kind: "radiance", radianceAt: provider.radianceAt, radianceSpectrumAt: planarRadianceSpectrumOf(provider.radianceAt) };
}
const litInput = (light: ReturnType<typeof resolveMixedIllumination>, wavelengthsNm: readonly number[], g = 2 / 96): LayeredLitSurfaceInput =>
  ({ wavelengthsNm, illumination: light, siteFrameUnits: g, metresPerFrameUnit: SCALE, referenceDistanceM: 2 });

describe("layered surface radiance under mixed illumination (#745)", () => {
  it("reads a radiance scene through its spectrum form, with the per-node values and lookups", () => {
    let spectra = 0;
    const radianceAt = (u: number, v: number, nm: number): number => 0.35 + 0.1 * u - 0.07 * v + nm / 4000;
    const plain: DisplayViewScene = { kind: "radiance", radianceAt };
    const spectral: DisplayViewScene = { kind: "radiance", radianceAt, radianceSpectrumAt: (u, v, wl, out) => { spectra++; wl.forEach((nm, n) => { out[n] = radianceAt(u, v, nm); }); } };
    const a = createLayeredSurfaceRadiance({ wavelengthsNm: NODES, layers: [{ scene: plain }] }), b = createLayeredSurfaceRadiance({ wavelengthsNm: NODES, layers: [{ scene: spectral }] });
    const outA = new Float64Array(NODES.length + 5), outB = new Float64Array(NODES.length + 5);
    for (const [u, v] of POINTS.slice(0, 50)) {
      a.radiance(0, { u, v, factor: 1 }, outA, 5); b.radiance(0, { u, v, factor: 1 }, outB, 5);
      expect(Array.from(outB)).toEqual(Array.from(outA));
    }
    expect(spectra).toBe(50);
    expect(b.lookups).toBe(a.lookups);
    expect(b.material(0, { u: 0, v: 0, factor: 1 })).toBe(-1);
  });

  it("keeps m.neutral * white[n] without an illumination", () => {
    const radiance = createLayeredSurfaceRadiance({ wavelengthsNm: WAVELENGTHS, layers: [{ scene: { kind: "materials", materialAt: (u): number => (u > 0 ? 1 : 0),
      materials: [{ neutral: 0.18 }, { neutral: 0.73 }], whiteRadiance: WHITE } }] });
    const out = new Float64Array(3);
    radiance.radiance(0, { u: 0.4, v: 0, factor: 1 }, out, 0);
    out.forEach((x, n) => expect(Object.is(x, 0.73 * WHITE[n]!)).toBe(true));
  });

  it("gives the single-plane mixed-light values bit for bit for a card filling the frame", () => {
    const out = new Float64Array(NODES.length), ref = new Float64Array(NODES.length);
    for (const [name, illumination] of Object.entries(LIGHTS)) for (const preset of ["color-patches", "dead-leaves"]) {
      const light = resolve(illumination), scene = layeredLitSurfaceScene(fillingCard(preset), litInput(light, NODES)), plane = singlePlane(preset, light);
      let differ = 0;
      for (const [u, v] of POINTS) {
        scene.radianceSpectrumAt!(u, v, NODES, out); plane.radianceSpectrumAt!(u, v, NODES, ref);
        NODES.forEach((nm, n) => { if (!Object.is(out[n], ref[n]) || !Object.is(scene.radianceAt(u, v, nm), plane.radianceAt(u, v, nm)) || !Object.is(out[n], scene.radianceAt(u, v, nm))) differ++; });
      }
      expect(differ, name + ", " + preset).toBe(0);
    }
  });

  it("one lit surface filling the frame: the layered sum equals the single-plane expected signal within 1e-9", () => {
    const f = fixture(40, 28, { box: true, diffraction: true }), disc = createDefocusDiscSiteKernel(5)!, light = resolve(LIGHTS.points!);
    const kernel = { radius: disc.radius, weights: disc.weights };
    const scene = layeredLitSurfaceScene(fillingCard("color-patches"), litInput(light, WAVELENGTHS, f.g)), plane = singlePlane("color-patches", light);
    const input: LayeredSceneSignalInput = { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, occlusionSamples: 8, offsets: f.offsets,
      electronsPerRadiance: RESPONSE, channelAt: bayer, diffraction: f.diffraction!, layers: [{ rect: null, blurRadiusSites: 2.5, scene, kernel }] };
    const layered = createLayeredSceneSignal(input, createLayeredSceneLattice(input));
    const single = createDisplayViewExpectedSignal({ nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, electronsPerRadiance: RESPONSE,
      offsets: f.offsets, scene: plane, channelAt: bayer,
      kernels: { radius: kernel.radius + 1, perNode: f.diffraction!.perNode.map((d) => convolveSiteKernels(d, 1, kernel.weights, kernel.radius)) } });
    layered.window(0, 0, f.W, f.H); single.window(0, 0, f.W, f.H);
    let worst = 0;
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const a = layered.site(x, y), b = single.site(x, y);
      worst = Math.max(worst, Math.abs(a - b) / Math.abs(b));
    }
    expect(layered.edgeSites).toBe(f.W * f.H);
    expect(worst).toBeLessThan(1e-9);
  });

  it("two sources: sites away from edges equal the hand-computed blend × reflectance within 1e-9", () => {
    const f = fixture(96, 64), light = resolve(GRADIENT);
    const spectral = (nm: number): number => 0.15 + (nm - 400) / 600;
    // Two cards side by side and a back plane, all blurred (ρ = −2.2, 1.6, 3.1); neutral and spectral reflectances.
    const surfaces: ResolvedLayeredSurface[] = [
      { kind: "card", index: 0, distanceM: 1, rect: { u0: -0.75, u1: -0.05, v0: -0.4, v1: 0.4 }, materials: [{ kind: "neutral", reflectance: 0.3 }], materialAt: () => 0 },
      { kind: "card", index: 1, distanceM: 2, rect: { u0: 0.05, u1: 0.8, v0: -0.45, v1: 0.35 }, materials: [{ kind: "spectrum", spectrum: { evaluate: spectral } as never }], materialAt: () => 0 },
      { kind: "back-plane", index: -1, distanceM: 4, rect: null, materials: [{ kind: "neutral", reflectance: 0.6 }], materialAt: () => 0 }];
    const rhos = [-2.2, 1.6, 3.1];
    const input: LayeredSceneSignalInput = { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, occlusionSamples: 8, offsets: f.offsets,
      electronsPerRadiance: RESPONSE, channelAt: bayer, layers: surfaces.map((s, k) => {
        const disc = createDefocusDiscSiteKernel(2 * Math.abs(rhos[k]!))!;
        return { rect: s.rect, blurRadiusSites: rhos[k]!, scene: layeredLitSurfaceScene(s, litInput(light, WAVELENGTHS, f.g)), kernel: { radius: disc.radius, weights: disc.weights } };
      }) };
    const signal = createLayeredSceneSignal(input, createLayeredSceneLattice(input));
    // The blend by hand: t along u from −0.5 to 0.5, (1 − t)·k_B·S_B(λ) + t·k_A·S_A(λ).
    const [sb, sa] = light.sources;
    const irradiance = (u: number, nm: number): number => { const t = u + 0.5; return (1 - t) * sb!.irradianceScale * sb!.illuminant.shape.evaluate(nm) + t * sa!.irradianceScale * sa!.illuminant.shape.evaluate(nm); };
    const reflectance = [(): number => 0.3, spectral, (): number => 0.6];
    const margin = (4 + 1) * f.g, counts = [0, 0, 0];
    signal.window(0, 0, f.W, f.H);
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const u = (x + 0.5 - f.W / 2) * f.g, v = -(y + 0.5 - f.H / 2) * f.g;
      // Away from every card edge by more than the widest footprint, and inside the gradient's linear part.
      if (surfaces.some((s) => s.rect && Math.min(Math.abs(u - s.rect.u0), Math.abs(u - s.rect.u1), Math.abs(v - s.rect.v0), Math.abs(v - s.rect.v1)) < margin)) continue;
      if (!(u - margin > -0.5 && u + margin < 0.5)) continue;
      const k = surfaces.findIndex((s) => s.rect === null || (u >= s.rect.u0 && u <= s.rect.u1 && v >= s.rect.v0 && v <= s.rect.v1)), c = bayer(x, y);
      let expected = 0;
      WAVELENGTHS.forEach((nm, n) => { expected += RESPONSE[c]![n]! * reflectance[k]!(nm) * irradiance(u, nm) / Math.PI; });
      expect(Math.abs(signal.site(x, y) - expected) / expected, x + ", " + y).toBeLessThan(1e-9);
      counts[k]!++;
    }
    expect(counts.every((n) => n >= 50), String(counts)).toBe(true);
  });

  it("a back plane's light cell keeps its lights' radiance on top of its lit plane", () => {
    const g = 2 / 96, light = resolve(GRADIENT);
    const plane = resolveLayeredChartScene({ scene: { kind: "layered-chart", cards: [{ distanceM: 1, centerU: 0, centerV: 0, width: 0.5, height: 0.5, scene: { preset: "dead-leaves" } as ChartScene }],
      backPlane: { distanceM: 3, reflectance: 0.25, pointLights: { seed: 7, columns: 6, rows: 4, luminousIntensityCandela: 2 } } }, aspect: ASPECT }).surfaces[1]!;
    const input = litInput(light, WAVELENGTHS, g), scene = layeredLitSurfaceScene(plane, input);
    const plain = layeredSurfaceScene(plane, { ...input, whiteRadiance: WHITE }), side = g * SCALE * 3 / 2, out = new Float64Array(3);
    const lights = plane.lights!;
    for (let k = 0; k < 24; k++) {
      const u = lights.u[k]!, v = lights.v[k]!;
      expect(plain.materialAt(u, v)).toBe(1);
      scene.radianceSpectrumAt!(u, v, WAVELENGTHS, out);
      WAVELENGTHS.forEach((nm, n) => {
        const lit = 0.25 * light.irradianceAt(u, v, u * SCALE, v * SCALE, nm) / Math.PI;
        expect(out[n]).toBe(lit + lights.intensityAt(nm) / (side * side));
        expect(scene.radianceAt(u, v, nm)).toBe(out[n]);
      });
      // Between lights: the lit plane alone.
      scene.radianceSpectrumAt!(u + 0.5 * lights.pitchU, v, WAVELENGTHS, out);
      if (plain.materialAt(u + 0.5 * lights.pitchU, v) === 0) WAVELENGTHS.forEach((nm, n) => expect(out[n]).toBe(0.25 * light.irradianceAt(u + 0.5 * lights.pitchU, v, (u + 0.5 * lights.pitchU) * SCALE, v * SCALE, nm) / Math.PI));
    }
  });

  it("refuses a spectral reflectance outside [0, 1] and an invalid scale", () => {
    const light = resolve(GRADIENT), bad: ResolvedLayeredSurface = { kind: "back-plane", index: -1, distanceM: 2, rect: null,
      materials: [{ kind: "spectrum", spectrum: { evaluate: () => 1.2 } as never }], materialAt: () => 0 };
    expect(() => layeredLitSurfaceScene(bad, litInput(light, WAVELENGTHS))).toThrow("Chart reflectance spectrum left [0, 1].");
    expect(() => layeredLitSurfaceScene({ ...bad, materials: [{ kind: "neutral", reflectance: 0.5 }] }, { ...litInput(light, WAVELENGTHS), metresPerFrameUnit: 0 }))
      .toThrow("metresPerFrameUnit");
  });
});
