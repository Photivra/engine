// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0: queries of a layered chart scene at a frame point (`layered-chart-query.ts`): the surface a frame point sees and its
 * distance (#747), and the in-focus mask's body (#752). The facade's wiring of the mask and the pixel mapping through a lens are
 * tested where they are wired.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { InvalidConfigurationError } from "../src/index.js";
import { calculateDefocusCircle } from "../src/optics/depth-of-field.js";
import { layeredChartDepths, resolveLayeredChartPreset, resolveLayeredChartScene, type LayeredChartScene, type ResolvedLayeredChartScene } from "../src/facade/layered-chart-scene.js";
import { FOCUS_MASK_LABEL, calculateLayeredChartSurfaceAt, createLayeredFocusMask, focusMaskScore, layeredFocusScores } from "../src/facade/layered-chart-query.js";
import { createLayeredSceneLattice } from "../src/facade/layered-scene-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const aspect = 2 / 3;
const uniform = { preset: "uniform", reflectance: 0.4 } as const;
/** Overlapping cards, one touching the frame's edge, one beyond it, and a back plane. */
const scene: LayeredChartScene = { kind: "layered-chart", cards: [
  { distanceM: 0.8, centerU: -0.4, centerV: -0.1, width: 0.6, height: 0.4, scene: uniform },
  { distanceM: 1, centerU: -0.2, centerV: 0.05, width: 0.75, height: 0.5, scene: { preset: "siemens-star" }, depthLabel: true },
  { distanceM: 1.5, centerU: 0.75, centerV: 0.4, width: 0.5, height: 0.6, scene: uniform },
  { distanceM: 2, centerU: 1.3, centerV: 0, width: 0.4, height: 0.4, scene: uniform }],
backPlane: { distanceM: 4 } };

/** The layered sum's chief-ray lookup (`lattice.chiefSurface`) for a resolved scene. */
function chiefSurfaceOf(resolved: ResolvedLayeredChartScene): (u: number, v: number) => number {
  const lattice = createLayeredSceneLattice({ nativeWidth: 8, nativeHeight: 6, outputWidth: 8, wavelengthsNm: [550], occlusionSamples: 4,
    layers: resolved.surfaces.map((s) => ({ rect: s.rect, blurRadiusSites: 0, kernel: null,
      scene: { kind: "materials" as const, materialAt: s.materialAt, materials: s.materials.map(() => ({ neutral: 0.5 })), whiteRadiance: Float64Array.of(1) } })) });
  return (u, v) => lattice.chiefSurface(u, v).surface;
}

describe("the surface at a frame point (#747)", () => {
  it("is the surface the layered sum's pilot reads, at every point of a grid and on every card edge", () => {
    const resolved = resolveLayeredChartScene({ scene, aspect }), chief = chiefSurfaceOf(resolved);
    const points: [number, number][] = [];
    for (let j = 0; j <= 80; j++) for (let i = 0; i <= 120; i++) points.push([-1.2 + 2.4 * i / 120, -0.8 + 1.6 * j / 80]);
    // The corners and edge midpoints of each rectangle, and points just outside them: closed rectangles.
    for (const s of resolved.surfaces) if (s.rect) for (const [u, v] of [[s.rect.u0, s.rect.v0], [s.rect.u1, s.rect.v1], [s.rect.u0, (s.rect.v0 + s.rect.v1) / 2],
      [(s.rect.u0 + s.rect.u1) / 2, s.rect.v1]] as const) for (const e of [-1e-12, 0, 1e-12]) points.push([u + e, v], [u, v + e]);
    const seen = new Set<number>();
    for (const [u, v] of points) {
      const at = calculateLayeredChartSurfaceAt({ scene, aspect, u, v }), k = chief(u, v), surface = resolved.surfaces[k]!;
      expect(at).toEqual({ kind: surface.kind, index: surface.index, distanceM: surface.distanceM, framePoint: { u, v } });
      seen.add(k);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    // Beyond the frame the far surface (here the back plane) is still seen; a scene without one ends at its farthest card.
    expect(calculateLayeredChartSurfaceAt({ scene, aspect, u: 50, v: -50 })).toMatchObject({ kind: "back-plane", index: -1, distanceM: 4 });
    const noPlane: LayeredChartScene = { kind: "layered-chart", cards: scene.cards.slice(0, 2) };
    expect(calculateLayeredChartSurfaceAt({ scene: noPlane, aspect, u: 0.9, v: 0.6 })).toMatchObject({ kind: "card", index: 1, distanceM: 1 });
  });

  it("gives the distance a tap-to-focus caller focuses at: that surface is then in focus", () => {
    const W = 96, H = 64, x = 30, y = 40, g = 2 / W;
    const at = calculateLayeredChartSurfaceAt({ scene, aspect: H / W, u: (x + 0.5 - W / 2) * g, v: -(y + 0.5 - H / 2) * g });
    expect(at).toMatchObject({ kind: "card", index: 0 });
    const depths = layeredChartDepths(resolveLayeredChartScene({ scene, aspect: H / W }), { focalLengthMm: 50, aperture: 2.8, focusDistanceM: at.distanceM,
      circleOfConfusionMm: 0.03, pixelPitchMicrometers: 4 });
    expect(depths[0]).toMatchObject({ defocusDiameterSites: 0, withinDepthOfField: true });
  });

  it("validates its input", () => {
    expect(() => calculateLayeredChartSurfaceAt({ scene, aspect, u: Number.NaN, v: 0 })).toThrow(/finite/);
    expect(() => calculateLayeredChartSurfaceAt({ scene, aspect, u: 0, v: Infinity })).toThrow(/finite/);
    expect(() => calculateLayeredChartSurfaceAt({ scene, aspect, u: 0, v: 0, w: 1 } as never)).toThrow(/unknown field "w"/);
    expect(() => calculateLayeredChartSurfaceAt({ scene: { ...scene, cards: [] }, aspect, u: 0, v: 0 })).toThrow(InvalidConfigurationError);
    expect(() => calculateLayeredChartSurfaceAt({ scene, aspect: 0, u: 0, v: 0 })).toThrow(/aspect/);
    expect(() => calculateLayeredChartSurfaceAt(null as never)).toThrow(InvalidConfigurationError);
  });

  it("bundles alone without the lens catalogue or the layered sum", async () => {
    const dir = mkdtempSync(join(tmpdir(), "photivra-layered-query-"));
    try {
      const entry = join(dir, "entry.mjs");
      writeFileSync(entry, `import { calculateLayeredChartSurfaceAt } from ${JSON.stringify(resolve("src/index.ts"))};\nglobalThis.keep = [calculateLayeredChartSurfaceAt];\n`);
      const build = await rolldown({ input: entry, logLevel: "silent", resolve: { extensionAlias: { ".js": [".ts", ".js"] } } });
      const { output } = await build.generate({ format: "esm", minify: true });
      await build.close();
      const modules = output.flatMap((c) => (c.type === "chunk" ? Object.keys(c.modules) : [])).map((id) => id.replace(/\\/g, "/").replace(/^.*\/src\//, ""));
      expect(modules).toContain("facade/layered-chart-query.ts");
      expect(modules.filter((id) => /catalogue|lens-catalogue|layered-scene-|defocus-bokeh|distortion|projection/u.test(id))).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, scaledTimeout(60_000));
});

describe("the in-focus mask's body (#752)", () => {
  const lens = { focalLengthMm: 50, aperture: 4, focusDistanceM: 1 };
  const W = 60, H = 40, pitch = 4, circleOfConfusionMm = Math.hypot(W, H) * pitch / 1000 / 1500;

  it("gives each surface's pixels the score of its depth-report entry", () => {
    const resolved = resolveLayeredChartScene({ scene, aspect: H / W });
    const scores = layeredFocusScores(resolved, { ...lens, circleOfConfusionMm });
    const depths = layeredChartDepths(resolved, { ...lens, circleOfConfusionMm, pixelPitchMicrometers: pitch });
    depths.forEach((d, k) => expect(Math.abs(scores[k]! - Math.max(0, 1 - d.defocusDiameterSites * pitch / 1000 / circleOfConfusionMm))).toBeLessThanOrEqual(1e-12));
    expect(scores[1]).toBe(1);
    const mask = createLayeredFocusMask({ scene: resolved, outputWidth: W, outputHeight: H, rectangle: { x0: 0, y0: 0, width: W, height: H }, ...lens, circleOfConfusionMm });
    expect(mask).toMatchObject({ width: W, height: H, circleOfConfusionMm, label: FOCUS_MASK_LABEL });
    const g = 2 / W, counts = new Map<number, number>();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = resolved.surfaces.findIndex((s) => s.distanceM === calculateLayeredChartSurfaceAt({ scene, aspect: H / W, u: (x + 0.5 - W / 2) * g, v: -(y + 0.5 - H / 2) * g }).distanceM);
      expect(mask.score[y * W + x]).toBe(Math.fround(scores[k]!));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(4);
  });

  it("gives a region the same values as the whole mask, bit for bit", () => {
    const resolved = resolveLayeredChartScene({ scene, aspect: H / W }), base = { scene: resolved, outputWidth: W, outputHeight: H, ...lens, circleOfConfusionMm };
    const whole = createLayeredFocusMask({ ...base, rectangle: { x0: 0, y0: 0, width: W, height: H } });
    for (const r of [{ x0: 7, y0: 3, width: 21, height: 17 }, { x0: 59, y0: 39, width: 1, height: 1 }, { x0: 0, y0: 20, width: 60, height: 5 }]) {
      const part = createLayeredFocusMask({ ...base, rectangle: r });
      for (let j = 0; j < r.height; j++) for (let i = 0; i < r.width; i++) expect(Object.is(part.score[j * r.width + i], whole.score[(r.y0 + j) * W + r.x0 + i])).toBe(true);
    }
  });

  it("is above 0 exactly for the surfaces within the depth of field, on the presets at three f-numbers", () => {
    // A full-frame circle of confusion (0.03 mm), so that the depth of field holds several cards at f/16.
    let inside = 0, outside = 0;
    for (const scale of ["macro", "tabletop", "large"] as const) for (const aperture of [2, 5.6, 16]) {
      const focusDistanceM = scale === "macro" ? 0.2 : scale === "tabletop" ? 0.6 : 3;
      const preset = resolveLayeredChartPreset({ scale, cards: 7, focusDistanceM, lens: { focalLengthMm: 50 }, aspect: H / W });
      const resolved = resolveLayeredChartScene({ scene: preset, aspect: H / W }), input = { focalLengthMm: 50, aperture, focusDistanceM, circleOfConfusionMm: 0.03 };
      const scores = layeredFocusScores(resolved, input), depths = layeredChartDepths(resolved, { ...input, pixelPitchMicrometers: pitch });
      depths.forEach((d, k) => { expect(scores[k]! > 0).toBe(d.withinDepthOfField); if (d.withinDepthOfField) inside++; else outside++; });
    }
    expect(inside).toBeGreaterThan(9);
    expect(outside).toBeGreaterThan(9);
  });

  it("gives one value over a single plane, reads the caller's frame mapping and validates its input", () => {
    const one = resolveLayeredChartScene({ scene: { kind: "layered-chart", cards: [{ ...scene.cards[2]! }] }, aspect: H / W });
    const base = { scene: one, outputWidth: W, outputHeight: H, rectangle: { x0: 0, y0: 0, width: W, height: H }, ...lens, circleOfConfusionMm };
    const c = calculateDefocusCircle({ ...lens, subjectDistanceM: 1.5 }).value.diameterMm;
    expect(new Set(createLayeredFocusMask(base).score)).toEqual(new Set([Math.fround(focusMaskScore(c, circleOfConfusionMm))]));
    expect(focusMaskScore(0.01, 0.02)).toBe(0.5);
    expect(focusMaskScore(0.03, 0.02)).toBe(0);
    // A mapping that sees no scene outside a circle (a fisheye's image circle): score 0 there.
    const resolved = resolveLayeredChartScene({ scene, aspect: H / W });
    const circle = createLayeredFocusMask({ ...base, scene: resolved, aperture: 22, framePointAt: (x, y) => (Math.hypot(x - W / 2, y - H / 2) > H / 2 ? null : { u: 0, v: 0 }) });
    expect(circle.score[0]).toBe(0);
    expect(circle.score[(H / 2) * W + W / 2]).toBeGreaterThan(0);
    expect(() => createLayeredFocusMask({ ...base, rectangle: { x0: 50, y0: 0, width: 20, height: 10 } })).toThrow(/within the frame/);
    expect(() => createLayeredFocusMask({ ...base, rectangle: { x0: 0.5, y0: 0, width: 2, height: 2 } })).toThrow(/whole pixels/);
    expect(() => createLayeredFocusMask({ ...base, circleOfConfusionMm: 0 })).toThrow(/circleOfConfusionMm/);
  });
});
