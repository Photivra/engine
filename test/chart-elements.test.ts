// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CHART_CONTINUOUS_LEVELS, CHART_SCENE_DEFAULTS, InvalidConfigurationError, calculateBarGroupTargets,
  calculateChartRadianceBatch, calculateSlantedSquareEdges, createImageKernelAccelerator, resolveChartScene, simulateCapture,
  type ChartScene, type CompositeChartScene } from "../src/index.js";
import { createFakeGpu } from "./helpers/fake-webgpu.js";

const levels = (chart: ReturnType<typeof resolveChartScene>, points: [number, number][]): number[] => points.map(([u, v]) => chart.reflectanceAt(u, v, 550));

describe("chart elements (2.3)", () => {
  it("reports every new preset's defaults", () => {
    for (const preset of ["dead-leaves", "bar-groups", "hyperbolic-wedge", "zone-plate", "slanted-squares", "line-grid", "fiducial"] as const) {
      const chart = resolveChartScene({ scene: { preset }, aspect: 0.75 });
      expect(chart.defaultedParameters).toEqual(Object.keys(CHART_SCENE_DEFAULTS[preset]));
      for (const key of chart.defaultedParameters) expect(chart.parameters[key]).toEqual(CHART_SCENE_DEFAULTS[preset][key as keyof typeof CHART_SCENE_DEFAULTS[typeof preset]]);
    }
  });

  it("keeps the bar star unchanged and adds a sine profile whose sign follows the bars", () => {
    const bar = resolveChartScene({ scene: { preset: "siemens-star", cycles: 12 }, aspect: 0.5 });
    expect(bar.parameters).not.toHaveProperty("profile");
    expect(resolveChartScene({ scene: { preset: "siemens-star", cycles: 12, profile: "bar" }, aspect: 0.5 }).parameters.profile).toBe("bar");
    const sine = resolveChartScene({ scene: { preset: "siemens-star", cycles: 12, profile: "sine" }, aspect: 0.5 });
    expect(sine.materials).toHaveLength(CHART_CONTINUOUS_LEVELS + 1);
    for (let i = 0; i < 720; i++) {
      const a = (i + 0.37) / 720 * 2 * Math.PI, u = 0.3 * Math.cos(a), v = 0.3 * Math.sin(a);
      const expected = 0.425 + 0.375 * Math.sin(2 * Math.PI * 12 * (Math.atan2(v, u) / (2 * Math.PI) + 0.5));
      expect(Math.abs(sine.reflectanceAt(u, v, 550) - expected)).toBeLessThanOrEqual(0.75 / CHART_CONTINUOUS_LEVELS);
      if (Math.abs(expected - 0.425) > 0.01) expect(sine.reflectanceAt(u, v, 550) > 0.425).toBe(bar.reflectanceAt(u, v, 550) === 0.8);
    }
    expect(sine.reflectanceAt(0.9, 0, 550)).toBe(0.18);
    expect(() => resolveChartScene({ scene: { preset: "siemens-star", profile: "triangle" } as never, aspect: 1 })).toThrow(InvalidConfigurationError);
  });

  it("draws a deterministic, fully covered dead-leaves texture with the declared radius law", () => {
    const scene = { preset: "dead-leaves" as const, radiusMinimum: 0.02, radiusMaximum: 0.3, seed: 7 };
    const a = resolveChartScene({ scene, aspect: 0.75 }), b = resolveChartScene({ scene, aspect: 0.75 });
    const grid: [number, number][] = [];
    for (let j = 0; j < 60; j++) for (let i = 0; i < 80; i++) grid.push([-1 + (i + 0.5) / 40, 0.75 - (j + 0.5) / 40]);
    const va = levels(a, grid);
    expect(levels(b, grid)).toEqual(va);
    // Locked on the engine's own xorshift32 stream and correctly rounded arithmetic: identical on every platform.
    expect(createHash("sha256").update(va.join(",")).digest("hex")).toBe("b8984418fb3445061c4de209aa129418c22a0612be060deb7831c8f1dc8a38d9");
    expect(a.parameters.diskCount).toBe(11728);;
    expect(a.parameters.diskCount).toBe(b.parameters.diskCount);
    expect(levels(resolveChartScene({ scene: { ...scene, seed: 8 }, aspect: 0.75 }), grid)).not.toEqual(va);
    for (const value of va) { expect(value).toBeGreaterThanOrEqual(0.2); expect(value).toBeLessThanOrEqual(0.6); }
    // Greys are uniform in [0.2, 0.6]: the sample mean is near 0.4, with many distinct levels.
    expect(va.reduce((s, x) => s + x, 0) / va.length).toBeCloseTo(0.4, 1);
    expect(new Set(va).size).toBeGreaterThan(100);
    // Beyond the covered margin the texture is its mean grey.
    expect(a.reflectanceAt(5, 0, 550)).toBe((a.materials[CHART_CONTINUOUS_LEVELS / 2] as { reflectance: number }).reflectance);
    expect(() => resolveChartScene({ scene: { preset: "dead-leaves", radiusMinimum: 0.001 }, aspect: 1 })).toThrow(InvalidConfigurationError);
    expect(() => resolveChartScene({ scene: { preset: "dead-leaves", radiusMinimum: 0.5, radiusMaximum: 0.4 }, aspect: 1 })).toThrow(InvalidConfigurationError);
  });

  it("lays out bar groups at PH/LW line widths with numerals, and reports them", () => {
    const aspect = 0.5, scene = { preset: "bar-groups" as const, lineWidthsPerPictureHeight: [20, 40] };
    const chart = resolveChartScene({ scene, aspect }), targets = calculateBarGroupTargets({ scene, aspect });
    expect(targets.map((t) => [t.lineWidthsPerPictureHeight, t.cyclesPerPictureHeight, t.lineWidth])).toEqual([[20, 10, 1 / 20], [40, 20, 1 / 40]]);
    for (const t of targets) {
      const b = t.verticalBars, v = (b.v0 + b.v1) / 2;
      expect(b.u1 - b.u0).toBeCloseTo(5 * t.lineWidth, 12);
      expect([0.5, 1.5, 2.5, 3.5, 4.5].map((k) => chart.reflectanceAt(b.u0 + k * t.lineWidth, v, 550))).toEqual([0.05, 0.8, 0.05, 0.8, 0.05]);
      const h = t.horizontalBars, u = (h.u0 + h.u1) / 2;
      expect([0.5, 1.5, 2.5, 3.5, 4.5].map((k) => chart.reflectanceAt(u, h.v1 - k * t.lineWidth, 550))).toEqual([0.05, 0.8, 0.05, 0.8, 0.05]);
    }
    // Numerals: some ink in the label row under each group, none without numerals.
    const ink = (c: ReturnType<typeof resolveChartScene>): number => { let n = 0; for (let i = 0; i < 400; i++) for (let j = 0; j < 20; j++) if (c.reflectanceAt(-1 + i / 200, -0.5 + 0.2 * 0.05 + j * 0.08 / 20, 550) === 0.05) n++; return n; };
    expect(ink(chart)).toBeGreaterThan(50);
    expect(ink(resolveChartScene({ scene: { ...scene, numerals: false }, aspect }))).toBe(0);
    expect(() => resolveChartScene({ scene: { preset: "bar-groups", lineWidthsPerPictureHeight: [3] }, aspect })).toThrow("does not fit");
    expect(() => resolveChartScene({ scene: { preset: "bar-groups", lineWidthsPerPictureHeight: [10.5] }, aspect })).toThrow(InvalidConfigurationError);
  });

  it("raises the hyperbolic wedge frequency linearly along its axis", () => {
    const aspect = 0.5, chart = resolveChartScene({ scene: { preset: "hyperbolic-wedge", lineCount: 3, minimumLineWidthsPerPictureHeight: 20, maximumLineWidthsPerPictureHeight: 60 }, aspect });
    for (const s of [0, 0.25, 0.5, 1]) {
      const u = -1 + 2 * s, w = 1 / (20 + 40 * s);
      expect([-2, -1, 0, 1, 2].map((k) => chart.reflectanceAt(u, (k + 0.5) * w - 0.5 * w, 550))).toEqual([0.05, 0.8, 0.05, 0.8, 0.05]);
      expect(chart.reflectanceAt(u, 2.6 * w, 550)).toBe(0.8);
    }
    const vertical = resolveChartScene({ scene: { preset: "hyperbolic-wedge", orientation: "vertical", lineCount: 1, minimumLineWidthsPerPictureHeight: 10, maximumLineWidthsPerPictureHeight: 20 }, aspect });
    expect(vertical.reflectanceAt(0.04, -0.5, 550)).toBe(0.05);
    expect(vertical.reflectanceAt(0.03, 0.5, 550)).toBe(0.8);
    expect(vertical.reflectanceAt(0.02, 0.5, 550)).toBe(0.05);
    expect(() => resolveChartScene({ scene: { preset: "hyperbolic-wedge", minimumLineWidthsPerPictureHeight: 5 }, aspect })).toThrow("do not fit");
  });

  it("gives the zone plate a local frequency k·r reaching its maximum at the rim", () => {
    const aspect = 1, chart = resolveChartScene({ scene: { preset: "zone-plate", radiusFraction: 1, maximumCyclesPerPictureHeight: 20 }, aspect });
    const k = 10 / 1; // 20 cycles per 2 units at r = 1
    for (const r of [0, 0.2, 0.5, 0.99]) expect(Math.abs(chart.reflectanceAt(r, 0, 550) - (0.4 + 0.3 * Math.cos(Math.PI * k * r * r)))).toBeLessThanOrEqual(0.6 / CHART_CONTINUOUS_LEVELS);
    expect(chart.reflectanceAt(0.8, 0.8, 550)).toBe(0.18);
  });

  it("places slanted squares and reports their edges", () => {
    const scene = { preset: "slanted-squares" as const, columns: 2, rows: 1, angleDegrees: 8 }, aspect = 0.5;
    const chart = resolveChartScene({ scene, aspect }), squares = calculateSlantedSquareEdges({ scene, aspect });
    expect(squares).toHaveLength(2);
    for (const square of squares) for (const edge of square.edges) {
      const normal = { u: edge.direction.v, v: -edge.direction.u }, out = Math.sign((edge.midpoint.u - square.center.u) * normal.u + (edge.midpoint.v - square.center.v) * normal.v);
      expect(chart.reflectanceAt(edge.midpoint.u - out * 1e-6 * normal.u, edge.midpoint.v - out * 1e-6 * normal.v, 550)).toBe(0.15);
      expect(chart.reflectanceAt(edge.midpoint.u + out * 1e-6 * normal.u, edge.midpoint.v + out * 1e-6 * normal.v, 550)).toBe(0.6);
      expect(Math.hypot(edge.direction.u, edge.direction.v)).toBeCloseTo(1, 14);
    }
    expect(squares[0]!.side).toBeCloseTo(0.5, 14);
    expect(() => resolveChartScene({ scene: { preset: "slanted-squares", sizeFraction: 0.9, angleDegrees: 30 }, aspect })).toThrow("inside their cells");
  });

  it("draws line grids and fiducials", () => {
    const grid = resolveChartScene({ scene: { preset: "line-grid", spacing: 0.5, lineWidth: 0.02 }, aspect: 0.5 });
    expect(levels(grid, [[0, 0.2], [0.509, 0.3], [0.25, 0.25], [0.3, -0.495]])).toEqual([0.42, 0.42, 0.6, 0.42]);
    const fid = resolveChartScene({ scene: { preset: "fiducial" }, aspect: 1 });
    expect(levels(fid, [[0.3, 0.3], [-0.3, 0.3], [-0.3, -0.3], [0.75, 0], [0.9, 0.5]])).toEqual([0.05, 0.8, 0.05, 0.05, 0.18]);
    expect(levels(resolveChartScene({ scene: { preset: "fiducial", inverted: true }, aspect: 1 }), [[0.3, 0.3], [-0.3, 0.3]])).toEqual([0.8, 0.05]);
  });
});

describe("composite charts (2.3)", () => {
  const composite: CompositeChartScene = { preset: "composite", background: { preset: "line-grid" }, elements: [
    { scene: { preset: "uniform", reflectance: 0.3 }, centerU: 0, centerV: 0, width: 1, height: 0.6 },
    { scene: { preset: "fiducial" }, centerU: 0.25, centerV: 0, width: 0.4, height: 0.4, mask: "ellipse" },
    { scene: { preset: "bar-groups", lineWidthsPerPictureHeight: [100] }, centerU: -0.6, centerV: 0.4, width: 0.4, height: 0.3 }] };

  it("draws later elements over earlier ones inside their masks, over the background", () => {
    const chart = resolveChartScene({ scene: composite, aspect: 0.75 });
    expect(chart.reflectanceAt(-0.3, 0, 550)).toBe(0.3);
    expect(chart.reflectanceAt(0.25 + 0.06, 0.06, 550)).toBe(0.05); // fiducial checker
    expect(chart.reflectanceAt(0.25 + 0.19, 0.19, 550)).toBe(0.3); // outside the ellipse: the earlier element shows
    expect(chart.reflectanceAt(0.9, -0.7, 550)).toBe(0.6); // background
    expect(chart.defaultedParameters).toEqual(expect.arrayContaining(["elements.0.placement.mask", "elements.1.parameters.inverted", "background.parameters.spacing"]));
    expect((chart.parameters.elements as { placement: { mask: string } }[])[1]!.placement.mask).toBe("ellipse");
  });

  it("keeps LW/PH frequencies on the composite's picture height and maps targets to its frame", () => {
    const aspect = 0.75, [target] = calculateBarGroupTargets({ scene: composite, aspect });
    expect(target!.elementIndex).toBe(2);
    expect(target!.lineWidth).toBeCloseTo(2 * aspect / 100, 14);
    const chart = resolveChartScene({ scene: composite, aspect }), b = target!.verticalBars, v = (b.v0 + b.v1) / 2;
    expect([0.5, 1.5, 2.5].map((k) => chart.reflectanceAt(b.u0 + k * target!.lineWidth, v, 550))).toEqual([0.05, 0.8, 0.05]);
    const squares = calculateSlantedSquareEdges({ scene: { preset: "composite", elements: [{ scene: { preset: "slanted-squares", columns: 1, rows: 1 }, centerU: 0.5, centerV: 0.1, width: 0.2, height: 0.2 }] }, aspect });
    expect(squares[0]!.center.u).toBeCloseTo(0.5, 14);
    expect(squares[0]!.center.v).toBeCloseTo(0.1, 14);
    expect(squares[0]!.side).toBeCloseTo(0.1, 14);
  });

  it("validates elements and rejects nested composites", () => {
    const bad: unknown[] = [[], [{ scene: { preset: "uniform" }, centerU: 0, centerV: 0, width: 0, height: 1 }],
      [{ scene: { preset: "uniform" }, centerU: 0, centerV: 0, width: 1, height: 1, mask: "circle" }],
      [{ scene: { preset: "uniform" }, centerU: 0, centerV: 0, width: 1, height: 1, z: 1 }],
      [{ scene: { preset: "composite", elements: [] }, centerU: 0, centerV: 0, width: 1, height: 1 }]];
    for (const elements of bad) expect(() => resolveChartScene({ scene: { preset: "composite", elements } as never, aspect: 1 })).toThrow(InvalidConfigurationError);
    expect(() => resolveChartScene({ scene: { preset: "composite", background: { preset: "composite", elements: [] }, elements: [] } as never, aspect: 1 })).toThrow(InvalidConfigurationError);
    // #730 facade-15 (d): a subnormal width gave an infinite scale and a TypeError in reflectanceAt; it is refused.
    for (const [width, height] of [[1e-320, 0.5], [0.5, 1e-320]])
      expect(() => resolveChartScene({ scene: { preset: "composite", elements: [{ scene: { preset: "uniform" }, centerU: 0, centerV: 0, width, height }] } as never, aspect: 0.75 }))
        .toThrow("is outside its supported range.");
  });

  it("states the bounds it applies and fits the dead-leaves lookup grid at any aspect (#730 facade-15)", () => {
    // (a) The upper bounds are open, as the JSDoc now says: 2 itself is refused.
    expect(() => resolveChartScene({ scene: { preset: "line-grid", spacing: 2 }, aspect: 0.75 })).toThrow("spacing is outside its supported range.");
    expect(() => resolveChartScene({ scene: { preset: "dead-leaves", radiusMaximum: 2 }, aspect: 0.75 })).toThrow("radiusMaximum is outside its supported range.");
    // (b) At aspect 4 the coarse grid's two round-ups passed the cell limit ("the chart aspect is too extreme"); the cell is enlarged until it fits,
    // and the texture is still fully covered. Aspect 3 used the same cell before and after.
    const tall = resolveChartScene({ scene: { preset: "dead-leaves", radiusMinimum: 0.002 }, aspect: 4 });
    expect(tall.parameters.diskCount).toBeGreaterThan(0);
    for (const [u, v] of [[0, 0], [0.9, 3.9], [-0.9, -3.9]] as const) expect(Number.isFinite(tall.reflectanceAt(u, v, 550))).toBe(true);
    // The default radii at aspect 96 now meet the disk limit, which names what to change.
    expect(() => resolveChartScene({ scene: { preset: "dead-leaves" }, aspect: 96 })).toThrow("raise radiusMinimum");
    // (c) A composite's background is not listed by the target functions (documented); the background alone lists its targets.
    const bars = { preset: "bar-groups", lineWidthsPerPictureHeight: [40] } as const;
    expect(calculateBarGroupTargets({ scene: bars, aspect: 0.75 })).toHaveLength(1);
    expect(calculateBarGroupTargets({ scene: { preset: "composite", background: bars, elements: [{ scene: { preset: "uniform" }, centerU: 0.8, centerV: 0.5, width: 0.1, height: 0.1 }] } as CompositeChartScene, aspect: 0.75 })).toHaveLength(0);
  }, 120_000);

  it("runs through the capture facade and hashes caller spectra of elements", async () => {
    const red = { kind: "tabulated" as const, samples: [{ wavelengthNanometers: 380, value: 0.05 }, { wavelengthNanometers: 600, value: 0.05 }, { wavelengthNanometers: 620, value: 0.7 }, { wavelengthNanometers: 780, value: 0.7 }] };
    const scene = (reflectance: number | typeof red): ChartScene => ({ preset: "composite", elements: [{ scene: { preset: "uniform", reflectance }, centerU: 0, centerV: 0, width: 1, height: 1 }] });
    const a = await simulateCapture({ scene: scene(red), output: { width: 8, height: 6 } }), b = await simulateCapture({ scene: scene(0.3), output: { width: 8, height: 6 } });
    expect(a.scene.sourceSha256).not.toBe(b.scene.sourceSha256);
    expect(a.assumptions.find((x) => x.id === "scene.elements.0.placement.mask")?.value).toBe("rectangle");
    expect(a.assumptions.find((x) => x.id === "scene.background")?.value).toEqual({ preset: "uniform", parameters: { reflectance: 0.18 } });
  });

  it("evaluates on cpu-reference and on webgpu-f32 (the composite kernel, #477) for the 2.3 presets, the sine star and composites", async () => {
    const points = new Float64Array([0, 0, 0.5, 0.2, -0.3, -0.1]);
    const input = (scene: ChartScene): Parameters<typeof calculateChartRadianceBatch>[0] => ({ schemaVersion: "0.1.0" as const, scene, illuminant: "cie-a" as const, illuminanceLux: 1000, aspect: 0.75, points,
      wavelengthsNanometers: [550], wavelengthIndices: new Uint8Array(3) });
    const cpu = await createImageKernelAccelerator({ backend: "cpu-reference" });
    const reference = calculateChartRadianceBatch(input(composite));
    expect((await cpu.evaluateChartRadiance(input(composite))).values).toEqual(reference.values);
    const { gpu } = createFakeGpu({});
    const accelerator = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu });
    for (const scene of [composite, { preset: "zone-plate" }, { preset: "siemens-star", profile: "sine" }] as ChartScene[]) {
      const result = await accelerator.evaluateChartRadiance(input(scene));
      expect(result.execution.backend).toBe("webgpu-f32");
      expect(Array.from(result.values)).toEqual(Array.from(calculateChartRadianceBatch(input(scene)).values, Math.fround));
    }
    accelerator.dispose();
  });
});
