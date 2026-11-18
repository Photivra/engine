// SPDX-License-Identifier: Apache-2.0
/**
 * #652, layered chart scenes, test 4 of the 2.27.0 plan at module level: the capture's provider (`layered-scene-provider.ts`)
 * and the display view's signal (`layered-scene-signal.ts`) agree per site within 1e-9 relative, with a pixel aperture (four
 * lattice groups) and a diffraction kernel, on edge sites and on sites that take a surface's single-plane path. The capture side
 * is formed as the environment forms it: each query point's radiance from the provider, integrated against the site's channel
 * response and weighted by the query offsets. Also: region renders equal the whole view (rule 5), and the provider's refusals.
 */
import { describe, expect, it } from "vitest";
import { internalRadianceAccess, markInternalSceneRadianceEvaluator } from "../src/core/internal-radiance-evaluator.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../src/schema/scene-radiance.js";
import type { PlanarSceneRadianceProvider } from "../src/facade/scene-radiance.js";
import { createLayeredSceneProvider } from "../src/facade/layered-scene-provider.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal } from "../src/facade/layered-scene-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { expectSiteElectronsEquivalent } from "./helpers/view-equivalence.js";
import { RESPONSE, WAVELENGTHS, bayer, fixture, signalInputOf, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const f = fixture(56, 40, { box: true, diffraction: true });
const checker = (u: number, v: number): number => ((Math.floor(u / 0.17) + Math.floor(v / 0.13)) & 1);
const specs: SurfaceSpec[] = [
  { rect: { u0: -0.8, u1: 0.05, v0: -0.6, v1: 0.1 }, rho: -3.5, reflectances: [0.1, 0.7], materialAt: checker },
  { rect: { u0: -0.2, u1: 0.7, v0: -0.25, v1: 0.6 }, rho: 0.75, reflectances: [0.3, 0.9], materialAt: (u) => (u < 0.3 ? 0 : 1) },
  { rect: null, rho: 4.5, reflectances: [0.5, 0.05], materialAt: (u, v) => (Math.hypot(u - 0.4, v + 0.3) < 0.15 ? 1 : 0) }];
const DISTANCE = 2, SCALE = 0.75;

/** A base provider standing in for the far surface's: its records only (the layered provider replaces the radiance). */
function baseProvider(internal: boolean): PlanarSceneRadianceProvider {
  const evaluateRadiance = (request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => ({ schemaVersion: "0.1.0", sampleId: request.sampleId,
    sceneId: "layered", providerProfileId: "layered-test", wavelengthNanometers: request.wavelengthNanometers, wavelengthBasis: request.wavelengthBasis,
    quantity: "outgoing-spectral-radiance", unit: "W/m^2/sr/nm", spectralRadianceWattsPerSquareMeterSteradianNanometer: 0, scientificStatus: "approximation",
    uncertainty: { kind: "not-quantified", limitation: "test" }, evidence: [], limitations: [] }) as unknown as SceneRadianceEvaluationResult;
  if (internal) markInternalSceneRadianceEvaluator(evaluateRadiance);
  return { sceneId: "layered", providerProfileId: "layered-test", radianceAt: () => 0, evaluateRadiance, evaluateApertureRadiance: (): never => { throw new Error("unused"); } };
}
/** The environment's outgoing direction (scene toward camera) of a query point (x, y in native sites, +y down). */
function directionOf(x: number, y: number): { x: number; y: number; z: number } {
  const u = (x - f.W / 2) * f.g, v = -(y - f.H / 2) * f.g, X = u * SCALE, Y = v * SCALE, length = Math.hypot(X, Y, DISTANCE);
  return { x: -X / length, y: -Y / length, z: -DISTANCE / length };
}
const request = (o: { x: number; y: number; z: number }, nm: number): SceneRadianceEvaluationRequest => ({ schemaVersion: "0.1.0", sampleId: "q", sceneId: "layered",
  providerProfileId: "layered-test", wavelengthNanometers: nm, wavelengthBasis: "vacuum", target: { kind: "environment-direction", outgoingDirectionUnitVector: o } } as unknown as SceneRadianceEvaluationRequest);

function captureSites(samples: number, internal = false): { site(x: number, y: number): number; provider: ReturnType<typeof createLayeredSceneProvider> } {
  const input = signalInputOf(f, specs, samples);
  const provider = createLayeredSceneProvider({ base: baseProvider(internal), lattice: createLayeredSceneLattice(input), wavelengthsNm: WAVELENGTHS, nativeWidth: f.W,
    nativeHeight: f.H, outputWidth: f.W, distanceM: DISTANCE, metresPerFrameUnit: SCALE, queryOffsetsSites: f.offsets });
  return { provider, site(x, y): number {
    const a = RESPONSE[bayer(x, y)]!;
    let sum = 0;
    for (const o of f.offsets) {
      const direction = directionOf(x + 0.5 + o.x, y + 0.5 + o.y);
      let v = 0;
      WAVELENGTHS.forEach((nm, n) => { v += a[n]! * provider.evaluateRadiance(request(direction, nm)).spectralRadianceWattsPerSquareMeterSteradianNanometer; });
      sum += o.weight * v;
    }
    return sum;
  } };
}

describe("layered scenes: capture and view (test 4)", () => {
  for (const [label, samples] of [["full", LAYERED_OCCLUSION_SAMPLES.full], ["fast", LAYERED_OCCLUSION_SAMPLES.fast]] as const) it(label + ": every site within 1e-9 relative", () => {
    const input = signalInputOf(f, specs, samples), view = createLayeredSceneSignal(input, createLayeredSceneLattice(input)), capture = captureSites(samples);
    view.window(0, 0, f.W, f.H);
    expectSiteElectronsEquivalent(view, capture, { x0: 0, y0: 0, x1: f.W, y1: f.H });
    // Both kinds of site were compared.
    expect(view.edgeSites).toBeGreaterThan(100);
    expect(view.delegatedSites).toBeGreaterThan(100);
    expect(capture.provider.queries).toBeGreaterThan(0);
  }, scaledTimeout(60_000));

  it("registers the lean lookup when the base evaluator is the engine's, with the same values", () => {
    const capture = captureSites(LAYERED_OCCLUSION_SAMPLES.fast, true), access = internalRadianceAccess(capture.provider.evaluateRadiance)!;
    expect(access).toBeDefined();
    const o = directionOf(20.25, 15.75), key = access.keyOfDirection(o, 0)!;
    expect(key).toBeDefined();
    for (const nm of WAVELENGTHS) expect(access.radianceOfKey(key, nm)).toBe(capture.provider.evaluateRadiance(request(o, nm)).spectralRadianceWattsPerSquareMeterSteradianNanometer);
    expect(access.keyOfDirection({ x: 0, y: 0, z: 1 }, 0)).toBeUndefined();
    expect(internalRadianceAccess(captureSites(4).provider.evaluateRadiance)).toBeUndefined();
  });

  it("refuses queries off the lattice, at other wavelengths and pupil rays", () => {
    const { provider } = captureSites(4);
    expect(() => provider.evaluateRadiance(request(directionOf(10.4, 10.1), 550))).toThrow(/off the site lattice/);
    expect(() => provider.evaluateRadiance(request(directionOf(10.25, 10.25), 551))).toThrow(/off the site lattice/);
    expect(() => provider.evaluateApertureRadiance(request(directionOf(10.25, 10.25), 550), { originM: { x: 0, y: 0, z: 0 }, directionUnitVector: { x: 0, y: 0, z: 1 } } as never)).toThrow(/pupil rays/);
    expect(provider.radianceAt((10.25 - f.W / 2) * f.g, -(10.25 - f.H / 2) * f.g, 550)).toBe(provider.evaluateRadiance(request(directionOf(10.25, 10.25), 550)).spectralRadianceWattsPerSquareMeterSteradianNanometer);
  });
});

describe("layered scenes: regions equal the whole view (rule 5)", () => {
  it("a region read first, with a fresh lattice and small tiles, has the whole view's bits", () => {
    const input = { ...signalInputOf(f, specs, 4), capacityBytes: 200_000 };
    const whole = createLayeredSceneSignal(input, createLayeredSceneLattice(input)), part = createLayeredSceneSignal(input, createLayeredSceneLattice(input));
    whole.window(0, 0, f.W, f.H);
    const values = new Float64Array(f.W * f.H);
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) values[y * f.W + x] = whole.site(x, y);
    part.window(17, 9, 41, 30);
    for (let y = 29; y >= 9; y--) for (let x = 40; x >= 17; x--) expect(part.site(x, y)).toBe(values[y * f.W + x]);
    expect(part.lattice.tiles.sum.tilesComputed).toBeGreaterThan(1);
  }, scaledTimeout(120_000));
});
