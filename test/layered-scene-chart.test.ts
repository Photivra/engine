// SPDX-License-Identifier: Apache-2.0
/**
 * #652, layered chart scenes: the scene module (`layered-chart-scene.ts`): validation, the surfaces' frame-unit prints and depth
 * labels, the seeded point lights and their lattice cells, the depth report and the staircase presets (geometric steps of ratio
 * 1.5 from the focus plane, symmetric in defocus, first steps 1 mm, 1 cm and 0.25 m).
 */
import { describe, expect, it } from "vitest";
import { calculateDefocusCircle, calculateDepthOfField } from "../src/optics/depth-of-field.js";
import { calculateIlluminantIrradianceScale, resolveCaptureIlluminant } from "../src/facade/scene-radiance.js";
import { LAYERED_CHART_PRESET_SCALES, calculateLayeredChartDepths, layeredSurfaceScene, resolveLayeredChartPreset, resolveLayeredChartScene,
  type LayeredChartScene } from "../src/facade/layered-chart-scene.js";

const aspect = 2 / 3;
const card = (distanceM: number, extra: Record<string, unknown> = {}): LayeredChartScene["cards"][number] =>
  ({ distanceM, centerU: 0, centerV: 0, width: 0.5, height: 0.4, scene: { preset: "uniform", reflectance: 0.4 }, ...extra });

describe("layered chart scenes: validation", () => {
  it("refuses unknown fields, unordered cards, a back plane in front of a card and out-of-range values", () => {
    const resolve = (scene: unknown): unknown => resolveLayeredChartScene({ scene: scene as LayeredChartScene, aspect });
    expect(() => resolve({ kind: "layered-chart", cards: [card(1)], extra: 1 })).toThrow(/unknown field "extra"/);
    expect(() => resolve({ kind: "chart", cards: [card(1)] })).toThrow(/layered-chart/);
    expect(() => resolve({ kind: "layered-chart", cards: [] })).toThrow(/1 to 16 cards/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(2), card(1)] })).toThrow(/nearest first/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1), card(1)] })).toThrow(/nearest first/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1)], backPlane: { distanceM: 1 } })).toThrow(/beyond the farthest card/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1, { width: 0 })] })).toThrow(/width/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1, { depthLabel: "yes" })] })).toThrow(/depthLabel/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1, { opacity: 0.5 })] })).toThrow(/unknown field "opacity"/);
    const lights = { seed: 1, columns: 4, rows: 3, luminousIntensityCandela: 1 };
    expect(() => resolve({ kind: "layered-chart", cards: [card(1)], backPlane: { distanceM: 2, pointLights: { ...lights, jitter: 1 } } })).toThrow(/jitter/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1)], backPlane: { distanceM: 2, pointLights: { ...lights, columns: 0 } } })).toThrow(/columns/);
    expect(() => resolve({ kind: "layered-chart", cards: [card(1)], backPlane: { distanceM: 2, pointLights: { ...lights, luminousIntensityCandela: 0 } } })).toThrow(/Candela/i);
  });

  it("makes the farthest surface unbounded; one card and no back plane is a single plane", () => {
    const one = resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [card(1)] } });
    expect(one.singlePlane).toBe(true);
    expect(one.surfaces[0]!.rect).toBeNull();
    const two = resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [card(1), card(2)], backPlane: { distanceM: 3 } } });
    expect(two.singlePlane).toBe(false);
    expect(two.surfaces.map((s) => [s.kind, s.index, s.rect === null])).toEqual([["card", 0, false], ["card", 1, false], ["back-plane", -1, true]]);
    expect(two.surfaces[0]!.rect).toEqual({ u0: -0.25, v0: -0.2, u1: 0.25, v1: 0.2 });
    expect(two.surfaces[2]!.materials).toEqual([{ kind: "neutral", reflectance: 0.18 }]);
  });
});

describe("layered chart scenes: prints", () => {
  it("places each card's chart in its own frame and draws its depth label", () => {
    const scene = resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [
      { distanceM: 1.25, centerU: 0.2, centerV: -0.1, width: 0.6, height: 0.6, scene: { preset: "slanted-edge", angleDegrees: 0 }, depthLabel: true }, card(2)] } });
    const s = scene.surfaces[0]!;
    // Card frame: u = ±1 at its left and right edges. The slanted edge (angle 0) splits it at its centre: dark left, light right.
    expect(s.materials.slice(0, 2)).toEqual([{ kind: "neutral", reflectance: 0.15 }, { kind: "neutral", reflectance: 0.6 }]);
    expect(s.materialAt(0.2 - 0.1, -0.2)).toBe(0);
    expect(s.materialAt(0.2 + 0.1, -0.2)).toBe(1);
    // The label "1250" in the top-right corner: plate and ink materials appended after the chart's.
    expect(s.materials.slice(2)).toEqual([{ kind: "neutral", reflectance: 0.8 }, { kind: "neutral", reflectance: 0.05 }]);
    const found = new Set<number>();
    for (let i = 0; i < 200; i++) for (let j = 0; j < 40; j++) found.add(s.materialAt(0.2 + 0.3 * (i / 200), -0.1 + 0.3 - 0.06 * (j / 40)));
    expect(found.has(2) && found.has(3)).toBe(true);
    // Nothing of the label at the bottom left.
    expect(s.materialAt(0.2 - 0.25, -0.1 - 0.25)).toBe(0);
  });

  it("seeds the point lights and gives each its lattice cell, with the light's power over the cell's area", () => {
    const scene = (seed: number): ReturnType<typeof resolveLayeredChartScene> => resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [card(1)],
      backPlane: { distanceM: 4, reflectance: 0.2, pointLights: { seed, columns: 6, rows: 4, luminousIntensityCandela: 2, spectrum: { kind: "planckian", temperatureKelvin: 3000 } } } } });
    const a = scene(7).surfaces[1]!.lights!, b = scene(7).surfaces[1]!.lights!, c = scene(8).surfaces[1]!.lights!;
    expect([...a.u]).toEqual([...b.u]);
    expect([...a.u]).not.toEqual([...c.u]);
    // Within a quarter of a grid cell of each nominal centre (jitter 0.5).
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
      expect(Math.abs(a.u[j * 6 + i]! - (-1 + (i + 0.5) / 3))).toBeLessThanOrEqual(0.25 / 3);
      expect(Math.abs(a.v[j * 6 + i]! - (aspect - (j + 0.5) * aspect / 2))).toBeLessThanOrEqual(0.25 * aspect / 2);
    }
    const W = 120, g = 2 / W, white = Float64Array.of(1, 2), wavelengths = [500, 600];
    const plane = layeredSurfaceScene(scene(7).surfaces[1]!, { wavelengthsNm: wavelengths, whiteRadiance: white, siteFrameUnits: g, metresPerFrameUnit: 0.5, referenceDistanceM: 1 });
    expect(plane.materials.length).toBe(2);
    // Every light is found in exactly one lattice cell of the frame (lattice points at (p + ½ − W/2)·g).
    let lit = 0;
    for (let q = -10; q < 90; q++) for (let p = -10; p < 130; p++) lit += plane.materialAt((p + 0.5 - W / 2) * g, -(q + 0.5 - 40) * g) === 1 ? 1 : 0;
    expect(lit).toBe(24);
    // The lit cell's radiance: the plane's plus I_e / A, with A = (g · 0.5 m · 4 m / 1 m)².
    const shape = resolveCaptureIlluminant({ kind: "planckian", temperatureKelvin: 3000 }).shape, k = calculateIlluminantIrradianceScale(shape, 2), area = (g * 0.5 * 4) ** 2;
    const radiance = (plane.materials[1] as { radiance: Float64Array }).radiance;
    wavelengths.forEach((nm, n) => expect(radiance[n]).toBeCloseTo(0.2 * white[n]! + k * shape.evaluate(nm) / area, 12));
    expect(() => layeredSurfaceScene(scene(7).surfaces[1]!, { wavelengthsNm: wavelengths, whiteRadiance: white, siteFrameUnits: 0.5, metresPerFrameUnit: 0.5, referenceDistanceM: 1 }))
      .toThrow(/two lights/);
    // A card's lattice scene is its print: neutral materials and spectra at the nodes.
    const cardScene = layeredSurfaceScene(scene(7).surfaces[0]!, { wavelengthsNm: wavelengths, whiteRadiance: white, siteFrameUnits: g, metresPerFrameUnit: 0.5, referenceDistanceM: 1 });
    expect(cardScene.materials).toEqual([{ neutral: 0.4 }]);
  });
});

describe("layered chart scenes: depth report", () => {
  it("reports each surface's blur and whether it is within the depth of field", () => {
    const scene = resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [card(0.9), card(1), card(1.04)], backPlane: { distanceM: 3 } } });
    const lens = { focalLengthMm: 50, aperture: 4, focusDistanceM: 1 }, coc = 0.03;
    const depths = calculateLayeredChartDepths({ scene, ...lens, circleOfConfusionMm: coc, pixelPitchMicrometers: 5 });
    const dof = calculateDepthOfField({ ...lens, circleOfConfusionMm: coc }).value;
    expect(depths.map((d) => d.withinDepthOfField)).toEqual([0.9, 1, 1.04, 3].map((d) => d >= dof.nearLimitM && d <= dof.farLimitM!));
    expect(depths.map((d) => d.withinDepthOfField)).toEqual([false, true, true, false]);
    for (const d of depths) {
      const c = d.distanceM === 1 ? 0 : calculateDefocusCircle({ ...lens, subjectDistanceM: d.distanceM }).value.diameterMm * 1000 / 5;
      expect(d.defocusDiameterSites).toBeCloseTo(c, 12);
      expect(d.signedBlurRadiusSites).toBe(Math.sign(d.distanceM - 1) * d.defocusDiameterSites / 2);
    }
  });
});

describe("layered chart scenes: staircase presets", () => {
  for (const scale of ["macro", "tabletop", "large"] as const) it(scale + ": geometric steps of 1.5 behind the focus plane, symmetric in defocus in front", () => {
    const s = { macro: 0.1, tabletop: 1, large: 5 }[scale], first = LAYERED_CHART_PRESET_SCALES[scale];
    const preset = resolveLayeredChartPreset({ scale, cards: 7, focusDistanceM: s, lens: { focalLengthMm: 50 } });
    const d = preset.cards.map((c) => c.distanceM);
    expect(d.length).toBe(7);
    expect(d[3]).toBe(s);
    // Behind: steps first, 1.5·first, 2.25·first.
    expect(d[4]! - s).toBeCloseTo(first, 12);
    expect((d[5]! - d[4]!) / (d[4]! - s)).toBeCloseTo(1.5, 9);
    expect((d[6]! - d[5]!) / (d[5]! - d[4]!)).toBeCloseTo(1.5, 9);
    // In front: the same blur as the card the same number of steps behind (c ∝ |s − d|/d).
    for (let i = 1; i <= 3; i++) expect((s - d[3 - i]!) / d[3 - i]!).toBeCloseTo((d[3 + i]! - s) / d[3 + i]!, 12);
    // A staircase: each card farther up and to the right than the one in front, overlapping it.
    for (let k = 1; k < 7; k++) {
      const a = preset.cards[k - 1]!, b = preset.cards[k]!;
      expect(b.centerU > a.centerU && b.centerV > a.centerV).toBe(true);
      expect(Math.abs(b.centerU - a.centerU) < a.width && Math.abs(b.centerV - a.centerV) < a.height).toBe(true);
    }
    expect(preset.backPlane!.distanceM).toBeGreaterThan(d[6]!);
    expect(preset.backPlane!.pointLights).toBeDefined();
    // The preset is a valid scene.
    expect(resolveLayeredChartScene({ scene: preset, aspect }).surfaces.length).toBe(8);
  });

  it("defaults to five cards, can leave out the lights and refuses a card inside the focal length", () => {
    const preset = resolveLayeredChartPreset({ scale: "tabletop", focusDistanceM: 1, lens: { focalLengthMm: 50 }, pointLights: false });
    expect(preset.cards.length).toBe(5);
    expect(preset.backPlane!.pointLights).toBeUndefined();
    expect(resolveLayeredChartPreset({ scale: "large", cards: 1, focusDistanceM: 5, lens: { focalLengthMm: 50 } }).cards.map((c) => c.distanceM)).toEqual([5]);
    expect(() => resolveLayeredChartPreset({ scale: "large", cards: 9, focusDistanceM: 0.1, lens: { focalLengthMm: 60 } })).toThrow(/focal length/);
    expect(() => resolveLayeredChartPreset({ scale: "huge" as "large", focusDistanceM: 1, lens: { focalLengthMm: 50 } })).toThrow(/scale/);
    expect(() => resolveLayeredChartPreset({ scale: "macro", cards: 10, focusDistanceM: 1, lens: { focalLengthMm: 50 } })).toThrow(/cards/);
  });
});
