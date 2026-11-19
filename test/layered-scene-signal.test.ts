// SPDX-License-Identifier: Apache-2.0
/**
 * #652, layered chart scenes: the layered sum at module level (`layered-scene-signal.ts`), tests 1, 2, 3, 5 and 6 of the 2.27.0
 * plan (test 4, capture and view, is in layered-scene-provider.test.ts).
 *
 * 1. One surface: the layered signal is the single-plane expected signal bit for bit, and its own lattice sum within 1e-9.
 * 2. A vertical edge on each card: the edge spread equals the disc of `calculateDefocusCircle` at the card's depth (on a lattice
 *    cell boundary the sampled disc's column sums are the disc's exact area fractions).
 * 3. Occlusion edges against the brute-force aperture integration (64 × 64 pupil points, plain JavaScript): a sharp-ish front
 *    edge over a blurred far plane, and a far card's edge behind a blurred front card. Full within 0.5 % of the local swing, fast
 *    within 2 %.
 * 5. Energy: white cards at several depths over a white back plane render flat within 0.2 % (full) and 1 % (fast).
 * 6. A point light: its disc diameter is the back plane's defocus circle, its summed electrons equal the in-focus light's within
 *    1e-9 relative, and a card cuts it on the side the brute-force reference gives, behind and in front of the focus plane.
 */
import { describe, expect, it } from "vitest";
import { createDisplayViewExpectedSignal } from "../src/facade/expected-signal.js";
import { resolveDefocusDisc } from "../src/optics/defocus-disc-kernel.js";
import { layeredChartDepths, layeredSurfaceScene, resolveLayeredChartScene } from "../src/facade/layered-chart-scene.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal } from "../src/facade/layered-scene-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { expectSiteElectronsEquivalent } from "./helpers/view-equivalence.js";
import { RESPONSE, WAVELENGTHS, WHITE, bayer, bruteForceSite, fixture, layeredSignal, layersOf, signalOf, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const { fast: FAST, full: FULL } = LAYERED_OCCLUSION_SAMPLES;

describe("layered scenes: one surface (test 1)", () => {
  const f = fixture(48, 32, { box: true, diffraction: true });
  const star = (u: number, v: number): number => (Math.floor((Math.atan2(v, u) + Math.PI) / (Math.PI / 6)) + (Math.hypot(u, v) < 0.2 ? 1 : 0)) % 3;
  const specs: SurfaceSpec[] = [{ rect: null, rho: 3.2, reflectances: [0.1, 0.5, 0.9], materialAt: star }];

  it("equals the single-plane expected signal bit for bit", () => {
    const layered = layeredSignal(f, specs, FULL), single = createDisplayViewExpectedSignal(layersOf(f, specs)[0]!.signalInput!);
    layered.window(0, 0, f.W, f.H); single.window(0, 0, f.W, f.H);
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) expect(layered.site(x, y)).toBe(single.site(x, y));
    expect(layered.edgeSites).toBe(0);
  });

  it("forms the same sum on its own lattice (no single-plane input) within 1e-9 relative", () => {
    const layered = layeredSignal(f, specs, FULL, false), single = createDisplayViewExpectedSignal(layersOf(f, specs)[0]!.signalInput!);
    layered.window(0, 0, f.W, f.H); single.window(0, 0, f.W, f.H);
    expectSiteElectronsEquivalent(layered, single, { x0: 0, y0: 0, x1: f.W, y1: f.H });
    expect(layered.lattice.edgePoints).toBe(0);
  });
});

/** Fraction of a disc of radius r (centred at 0) left of x = a. */
const discFraction = (a: number, r: number): number => {
  if (a <= -r) return 0;
  if (a >= r) return 1;
  const s = a / r;
  return 0.5 + (s * Math.sqrt(1 - s * s) + Math.asin(s)) / Math.PI;
};

describe("layered scenes: the blur of each card (test 2)", () => {
  // f = 50 mm at f/8 focused at 1 m on 20 µm sites: cards at 0.8 m and 1.3 m, a back plane at 3 m.
  const lens = { focalLengthMm: 50, aperture: 8, focusDistanceM: 1 }, pitch = 20;
  const rhoOf = (d: number): number => Math.sign(d - 1) * resolveDefocusDisc({ ...lens, subjectDistanceM: d, pitchMicrometers: pitch }).diameterSites / 2;
  const f = fixture(160, 64);
  // Each card's edge lies on a lattice cell boundary, 20 sites into the card: column P0 starts the light side.
  const edgeAt = (P0: number): number => (P0 - f.W / 2) * f.g;
  const cards = [{ d: 0.8, x0: 8, x1: 72, P0: 40 }, { d: 1.3, x0: 88, x1: 152, P0: 120 }];
  const specs: SurfaceSpec[] = [
    ...cards.map((c): SurfaceSpec => ({ rect: { u0: (c.x0 - f.W / 2) * f.g, u1: (c.x1 - f.W / 2) * f.g, v0: -0.3, v1: 0.3 }, rho: rhoOf(c.d), reflectances: [0.15, 0.6],
      materialAt: (u) => (u < edgeAt(c.P0) ? 0 : 1) })),
    { rect: null, rho: rhoOf(3), reflectances: [0.3] }];

  for (const delegates of [true, false]) it("matches calculateDefocusCircle at each depth" + (delegates ? "" : " (the layered sum's own path)"), () => {
    const signal = layeredSignal(f, specs, FULL, delegates);
    signal.window(0, 0, f.W, f.H);
    for (const [k, card] of cards.entries()) {
      const r = Math.abs(specs[k]!.rho);
      expect(r).toBeGreaterThan(1.5);
      for (const y of [30, 31]) for (let x = card.P0 - 8; x < card.P0 + 8; x++) {
        const c = bayer(x, y), dark = signalOf(c, WHITE.map((w) => 0.15 * w)), light = signalOf(c, WHITE.map((w) => 0.6 * w));
        const measured = (signal.site(x, y) - dark) / (light - dark);
        // Site x reads the light side for taps t ≤ x − P0: the disc's area left of x − P0 + ½.
        expect(Math.abs(measured - discFraction(x - card.P0 + 0.5, r))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("layered scenes: occlusion edges against the brute-force reference (test 3)", () => {
  const f = fixture(96, 24);
  const half = (x: number): number => (x - f.W / 2) * f.g;
  const cases: { name: string; specs: SurfaceSpec[] }[] = [
    // A slightly blurred front card (in front of the focus plane) over a strongly blurred back plane behind it.
    { name: "front edge over a far plane", specs: [{ rect: { u0: -2, u1: half(48), v0: -2, v1: 2 }, rho: -1.5, reflectances: [0.2] }, { rect: null, rho: 6, reflectances: [0.9] }] },
    // A strongly blurred front card over a far card's edge (nearly sharp), over a back plane.
    { name: "far edge behind a blurred front card", specs: [{ rect: { u0: -2, u1: half(44), v0: -2, v1: 2 }, rho: -5.5, reflectances: [0.1] },
      { rect: { u0: half(50), u1: 2, v0: -2, v1: 2 }, rho: 0.8, reflectances: [0.95] }, { rect: null, rho: 4, reflectances: [0.4] }] }];
  for (const { name, specs } of cases) it(name + ": full within 0.5 % and fast within 2 % of the local swing", () => {
    const full = layeredSignal(f, specs, FULL), fast = layeredSignal(f, specs, FAST);
    full.window(0, 0, f.W, f.H); fast.window(0, 0, f.W, f.H);
    for (const y of [10, 11]) {
      const reference: number[] = [], xs: number[] = [];
      for (let x = 30; x < 66; x++) { xs.push(x); reference.push(bruteForceSite(f, specs, x, y)); }
      // Each channel's swing along the row (the sites of one row share two channels).
      const swing = (c: number): number => { const v = xs.flatMap((x, i) => (bayer(x, y) === c ? [reference[i]!] : [])); return Math.max(...v) - Math.min(...v); };
      let worstFull = 0, worstFast = 0;
      xs.forEach((x, i) => {
        const s = swing(bayer(x, y));
        expect(s).toBeGreaterThan(0);
        worstFull = Math.max(worstFull, Math.abs(full.site(x, y) - reference[i]!) / s);
        worstFast = Math.max(worstFast, Math.abs(fast.site(x, y) - reference[i]!) / s);
      });
      expect(worstFull).toBeLessThan(0.005);
      expect(worstFast).toBeLessThan(0.02);
    }
    expect(full.edgeSites).toBeGreaterThan(0);
  });

  it("the fast and full methods differ beyond the equivalence tolerance (both are kept)", () => {
    const specs = cases[1]!.specs, full = layeredSignal(f, specs, FULL), fast = layeredSignal(f, specs, FAST);
    let worst = 0;
    for (let x = 30; x < 66; x++) worst = Math.max(worst, Math.abs(full.site(x, 10) - fast.site(x, 10)) / full.site(x, 10));
    expect(worst).toBeGreaterThan(1e-9);
  });
});

describe("layered scenes: energy (test 5)", () => {
  const f = fixture(80, 48, { box: true });
  const white: SurfaceSpec[] = [
    { rect: { u0: -0.9, u1: -0.1, v0: -0.5, v1: 0.2 }, rho: -4.5, reflectances: [1] },
    { rect: { u0: -0.4, u1: 0.4, v0: -0.3, v1: 0.45 }, rho: 0, reflectances: [1] },
    { rect: { u0: 0.05, u1: 0.85, v0: -0.55, v1: 0.1 }, rho: 2.5, reflectances: [1] },
    { rect: null, rho: 6, reflectances: [1] }];
  for (const [label, samples, bound] of [["full", FULL, 0.002], ["fast", FAST, 0.01]] as const) it(label + ": flat within " + bound * 100 + " %", () => {
    const signal = layeredSignal(f, white, samples);
    signal.window(0, 0, f.W, f.H);
    let worst = 0;
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const flat = signalOf(bayer(x, y), WHITE);
      worst = Math.max(worst, Math.abs(signal.site(x, y) / flat - 1));
    }
    expect(signal.edgeSites).toBeGreaterThan(f.W * f.H / 4);
    expect(worst).toBeLessThan(bound);
  }, scaledTimeout(60_000));
});

describe("layered scenes: a point light (test 6)", () => {
  const W = 64, H = 48, g = 2 / W, aspect = H / W;
  // One light at the frame centre (no jitter) on the back plane; the back plane's lattice scene carries it as one cell.
  const scene = resolveLayeredChartScene({ aspect, scene: { kind: "layered-chart", cards: [{ distanceM: 1, centerU: -0.5, centerV: 0, width: 0.2, height: 0.2, scene: { preset: "uniform" } }],
    backPlane: { distanceM: 2, reflectance: 0.2, pointLights: { seed: 1, columns: 1, rows: 1, jitter: 0, luminousIntensityCandela: 1 } } } });
  const plane = scene.surfaces[1]!;
  const planeScene = layeredSurfaceScene(plane, { wavelengthsNm: WAVELENGTHS, whiteRadiance: WHITE, siteFrameUnits: g, metresPerFrameUnit: 0.5, referenceDistanceM: 1 });
  const lit = (planeScene.materials[1] as { radiance: Float64Array }).radiance, background = WHITE.map((w) => 0.2 * w), excess = lit.map((v, n) => v - background[n]!);
  // The light lies at frame (0, 0): the corner of four lattice cells; it belongs to the cell [u − g/2, u + g/2) × (v − g/2, v + g/2] holding it.
  const L = { x: W / 2, y: H / 2 };
  const f = fixture(W, H);
  /** Each site's share of the light (its excess over the plane, divided by the light's own signal at its channel), and their sum. */
  function shares(specs: SurfaceSpec[], samples = FULL): { total: number; weights: Float64Array } {
    // The same scene without the light gives each site's signal apart from it.
    const dark = specs.map((s) => (s.scene ? { ...s, scene: { ...s.scene, materialAt: (): number => 0 } } : s));
    const signal = layeredSignal(f, specs, samples), without = layeredSignal(f, dark, samples), weights = new Float64Array(W * H);
    signal.window(0, 0, W, H); without.window(0, 0, W, H);
    let total = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = bayer(x, y), w = (signal.site(x, y) - without.site(x, y)) / signalOf(c, excess);
      weights[y * W + x] = w; total += w;
    }
    return { total, weights };
  }
  const planeSpec = (rho: number): SurfaceSpec => ({ rect: null, rho, reflectances: [0.2], scene: planeScene });

  it("finds the light's lattice cell", () => {
    expect(planeScene.materialAt((L.x + 0.5 - W / 2) * g, -(L.y + 0.5 - H / 2) * g)).toBe(1);
    expect(planeScene.materialAt((L.x - 0.5 - W / 2) * g, -(L.y + 0.5 - H / 2) * g)).toBe(0);
  });

  it("spreads over the back plane's defocus circle and keeps the in-focus light's electrons", () => {
    const sharp = shares([planeSpec(0)]), rho = 6.5, blurred = shares([planeSpec(rho)]);
    expect(Math.abs(sharp.total - 1)).toBeLessThan(1e-9);
    expect(sharp.weights[L.y * W + L.x]).toBeCloseTo(1, 12);
    expect(Math.abs(blurred.total - sharp.total) / sharp.total).toBeLessThan(1e-9);
    // Radius from the second moment: a uniform disc has E[r²] = r²/2, plus 1/6 for the cell-area sampling.
    let m2 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m2 += blurred.weights[y * W + x]! * ((x - L.x) ** 2 + (y - L.y) ** 2);
    expect(Math.abs(Math.sqrt(2 * (m2 - 1 / 6)) / rho - 1)).toBeLessThan(0.01);
    // The diameter the depth report gives for that back plane is the same c = 2ρ (calculateDefocusCircle).
    const depths = layeredChartDepths(scene, { focalLengthMm: 50, aperture: 4, focusDistanceM: 1, circleOfConfusionMm: 0.03, pixelPitchMicrometers: 6 });
    const disc = resolveDefocusDisc({ focalLengthMm: 50, aperture: 4, focusDistanceM: 1, subjectDistanceM: 2, pitchMicrometers: 6 });
    expect(depths[1]!.defocusDiameterSites).toBe(disc.diameterSites);
    expect(depths[1]!.signedBlurRadiusSites).toBe(disc.diameterSites / 2);
  });

  /** The brute-force share of each site: the light reaches p through P* = (p − L)/ρ_B when |P*| ≤ 1 and the ray passes the card. */
  function referenceShares(card: SurfaceSpec, rhoB: number): Float64Array {
    const out = new Float64Array(W * H), r = card.rect!, sub = 16;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let open = 0;
      for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
        const X = x - 0.5 + (i + 0.5) / sub, Y = y - 0.5 + (j + 0.5) / sub, px = (X - L.x) / rhoB, py = (Y - L.y) / rhoB;
        if (px * px + py * py > 1) continue;
        const cx = X - card.rho * px, cy = Y - card.rho * py, u = (cx + 0.5 - W / 2) * g, v = -(cy + 0.5 - H / 2) * g;
        if (!(u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1)) open++;
      }
      out[y * W + x] = open / (sub * sub) / (Math.PI * rhoB * rhoB);
    }
    return out;
  }
  const centroidX = (w: Float64Array): { total: number; x: number } => {
    let total = 0, mx = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { total += w[y * W + x]!; mx += w[y * W + x]! * (x - L.x); }
    return { total, x: mx / total };
  };
  // A card whose edge runs through the light's column, covering everything left of it.
  const cutter = (rho: number): SurfaceSpec => ({ rect: { u0: -2, u1: (L.x + 0.5 - W / 2) * g, v0: -2, v1: 2 }, rho, reflectances: [0.05] });
  for (const [label, rhoCard, rhoB] of [["behind the focus plane", -3, 6.5], ["in front of the focus plane", -9.5, -6.5]] as const) it("a card cuts it on the reference's side, back plane " + label, () => {
    const card = cutter(rhoCard), engine = shares([card, planeSpec(rhoB)]), reference = referenceShares(card, rhoB);
    const e = centroidX(engine.weights), ref = centroidX(reference);
    expect(Math.abs(e.total - ref.total)).toBeLessThan(0.02);
    expect(Math.sign(e.x)).toBe(Math.sign(ref.x));
    expect(Math.abs(e.x - ref.x)).toBeLessThan(0.5);
    // The two configurations cut opposite halves of the disc (the pupil's image turns over between them).
    expect(Math.sign(ref.x)).toBe(label === "behind the focus plane" ? 1 : -1);
  }, scaledTimeout(60_000));
});

describe("layered scenes: lattice validation", () => {
  const f = fixture(16, 16);
  it("refuses a far surface that is not last, a kernel above 64 sites with edges, and bad sub-sample counts", () => {
    const base = layersOf(f, [{ rect: { u0: 0, u1: 1, v0: 0, v1: 1 }, rho: 1, reflectances: [0.5] }, { rect: null, rho: 2, reflectances: [0.5] }]);
    const input = { nativeWidth: 16, nativeHeight: 16, outputWidth: 16, wavelengthsNm: WAVELENGTHS, occlusionSamples: 4 };
    expect(() => createLayeredSceneLattice({ ...input, layers: [base[1]!, base[0]!] })).toThrow(/far surface/);
    const big = { ...base[1]!, kernel: { radius: 65, weights: new Float64Array(131 * 131) } };
    expect(() => createLayeredSceneLattice({ ...input, layers: [base[0]!, big] })).toThrow(/at most 64/);
    expect(() => createLayeredSceneLattice({ ...input, layers: base, occlusionSamples: 0 })).toThrow(/occlusionSamples/);
    const withoutKernels = { ...base[0]!.signalInput! };
    delete (withoutKernels as { kernels?: unknown }).kernels;
    expect(() => createLayeredSceneSignal({ ...input, layers: [{ ...base[0]!, rect: null, signalInput: withoutKernels }],
      offsets: f.offsets, electronsPerRadiance: RESPONSE, channelAt: bayer })).toThrow(/kernels/);
  });
  it("reports one surface or an edge per lattice point, and the chief ray's surface", () => {
    const signal = layeredSignal(f, [{ rect: { u0: -1, u1: 0, v0: -1, v1: 1 }, rho: 1, reflectances: [0.5] }, { rect: null, rho: 2, reflectances: [0.5] }], FAST);
    const lattice = signal.lattice, group = lattice.groupOf(0, 0);
    expect(lattice.surfaceOf(group, 2, 8)).toBe(0);
    expect(lattice.surfaceOf(group, 14, 8)).toBe(1);
    expect(lattice.surfaceOf(group, 8, 8)).toBe(-1);
    expect(lattice.chiefSurface(-0.5, 0)).toEqual({ surface: 0, material: 0 });
    expect(lattice.chiefSurface(0.5, 0).surface).toBe(1);
    expect(signal.pilot(-0.5, 0)).toBe(0);
    expect(signal.pilot(0.5, 0)).toBe(65536);
    expect(signal.uniformMaterial).toBe(-1);
    expect(signal.tracksMaterial).toBe(false);
    expect(() => signal.markReads(new Int32Array(0), new Int32Array(0), new Float64Array(0), new Int32Array(0), 0)).toThrow(/markReads/);
    signal.window(0, 0, 16, 16);
    expect(signal.cachesSites).toBe(true);
    const a = signal.site(8, 8);
    expect(signal.site(8, 8)).toBe(a);
    expect(signal.lookups).toBeGreaterThan(0);
  });
});

describe("layered scenes: the cat's eye by field zones", () => {
  const f = fixture(48, 32);
  const specs: SurfaceSpec[] = [{ rect: { u0: -1, u1: 0.1, v0: -1, v1: 1 }, rho: -2.5, reflectances: [0.2, 0.7], materialAt: (u, v) => (u + v < 0 ? 0 : 1) },
    { rect: null, rho: 3.5, reflectances: [0.9] }];
  const withZones = (kernelOf: (zone: number, axis: Float64Array) => Float64Array): ReturnType<typeof createLayeredSceneSignal> => {
    const layers = layersOf(f, specs, false).map((l) => ({ ...l, zones: { size: 16, columns: 3, rows: 2, kernelOf: (zone: number): Float64Array => kernelOf(zone, l.kernel!.weights) } }));
    const input = { nativeWidth: f.W, nativeHeight: f.H, outputWidth: f.W, wavelengthsNm: WAVELENGTHS, layers, occlusionSamples: FAST, offsets: f.offsets,
      electronsPerRadiance: RESPONSE, channelAt: bayer };
    return createLayeredSceneSignal(input, createLayeredSceneLattice(input));
  };
  it("with one kernel in every zone, equals the sum without zones bit for bit", () => {
    const zoned = withZones((_, axis) => axis), plain = layeredSignal(f, specs, FAST, false);
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) expect(zoned.site(x, y)).toBe(plain.site(x, y));
  });
  it("gives each lattice point its zone's kernel (here: the right half of the pupil closed in zones 1 to 5)", () => {
    const clipped = (axis: Float64Array): Float64Array => {
      const width = Math.sqrt(axis.length), R = (width - 1) / 2, out = new Float64Array(axis.length);
      let sum = 0;
      for (let j = 0; j < width; j++) for (let i = 0; i <= R; i++) { out[j * width + i] = axis[j * width + i]!; sum += axis[j * width + i]!; }
      return out.map((w) => w / sum);
    };
    const zoned = withZones((zone, axis) => (zone === 0 ? axis : clipped(axis))), plain = layeredSignal(f, specs, FAST, false);
    // Zone 0 holds sites [0, 16) × [0, 16); the rest take the clipped kernel.
    expect(zoned.site(8, 8)).toBe(plain.site(8, 8));
    expect(zoned.site(20, 8)).not.toBe(plain.site(20, 8));
    expect(zoned.delegatedSites).toBe(0);
  });
});
