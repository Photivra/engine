// SPDX-License-Identifier: Apache-2.0
/**
 * 2.29.0 group L0: the layered sum split into its modules (`layered-lattice-geometry.ts`, `layered-surface-radiance.ts`,
 * `layered-visibility.ts`, `layered-edge-sum.ts`, assembled by `layered-scene-signal.ts`) without changing a bit of output.
 *
 * - Module level: the spectral lattice values (`spectrumAt` of every lattice group over the raster and a margin), each lattice
 *   point's surface, the chief ray's surface and the pilot, the view signal of every site, and the counters apart, for nine
 *   small lattices (box offsets and diffraction, the fast and full rows, the layered sum's own path, field zones, a radiance
 *   scene, overlapping cards on both sides of the focus plane, the row clamp, a kernel wider than its disc's reach, and a
 *   surface with ρ ≠ 0 and no kernel).
 * - Through the public API: the eight renders of `scripts/benchmark-layered-scenes.mjs` (the tabletop preset at f/2 and f/8,
 *   fast and full, the display view's region and the capture's region), and the same eight on a blurred card's edge, where the
 *   fast and full occlusion rows differ: image samples, the view's expected values and noise standard deviations, and the
 *   capture's RAW codes.
 *
 * - The refusal messages of `layered-scene-setup.ts` for 14 requests, as 783f38f gives them.
 *
 * Recorded at `783f38f` (2.28.0, before the split; the module locks again with their counters apart, and three more cases,
 * for the second L0 commit) on arm64 (Node 26.13.1) and x64 (Node 24.1.0 under Rosetta 2): every lock
 * has the same bytes on both, so there is no arm64 table (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks and platforms").
 * Re-recorded for 2.29.0 group LE (#749, #750): the edge sum by runs regroups the direct sum (rule 3 of the 2.29.0 plan; the
 * sum tiles fill one surface at a time, the surface tiles keep row sums). Measured against c99daa1's direct sum: the module
 * locks' lattice values and site signals within 1.9e-15 relative (every case); the benchmark cases' images and RAW codes keep
 * their bits, the view's expected values within 2.3e-13 relative (card 0; card 2 keeps its bits). The counters of the
 * small-tile case move (the surface tiles' bytes count the row sums).
 * Record with RECORD_LAYERED_SEAM_HASHES=1 (prints them; asserts nothing).
 */
import { createHash, type Hash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareDisplayView, prepareLayeredChartScenes, resolveLayeredChartPreset, simulateCapture, type SimulateCaptureOptions } from "../src/index.js";
import { simulateDisplayViewWithInternals } from "../src/facade/simulate-display-view.js";
import type { DisplayViewScene } from "../src/facade/expected-signal.js";
import { resolveLayeredRequest } from "../src/facade/layered-scene-setup.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneSignalInput } from "../src/facade/layered-scene-signal.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { WAVELENGTHS, fixture, signalInputOf, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const RECORD = process.env.RECORD_LAYERED_SEAM_HASHES === "1";
const { fast: FAST, full: FULL } = LAYERED_OCCLUSION_SAMPLES;

function update(hash: Hash, array: ArrayBufferView): void { hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)); }
const hex = (hash: Hash): string => hash.digest("hex");

// Module level ------------------------------------------------------------------------------------------------------------

const cardA = (u: number, v: number): number => (Math.floor(u * 9) + Math.floor(v * 7)) & 1;
const cardB = (u: number, v: number): number => (u * u + v * v < 0.04 ? 2 : u < 0.3 ? 0 : 1);
/** Two cards and a back plane: a patterned card in front of the focus plane, a second one behind it, partly behind the first. */
const threeSurfaces = (rhoA: number, rhoB: number, rhoBack: number): SurfaceSpec[] => [
  { rect: { u0: -0.7, u1: 0.15, v0: -0.35, v1: 0.3 }, rho: rhoA, reflectances: [0.08, 0.85], materialAt: cardA },
  { rect: { u0: -0.1, u1: 0.8, v0: -0.25, v1: 0.45 }, rho: rhoB, reflectances: [0.2, 0.55, 0.95], materialAt: cardB },
  { rect: null, rho: rhoBack, reflectances: [0.4] }];

/** A radiance scene for the back plane (no transcendental functions, so the bytes are the same on every architecture). */
const radianceBack: DisplayViewScene = { kind: "radiance", radianceAt: (u, v, nm) => 0.35 + 0.1 * u - 0.07 * v + nm / 4000 + 0.02 * u * v };

interface ModuleCase { name: string; input: () => LayeredSceneSignalInput }
const moduleCases: ModuleCase[] = [
  { name: "box offsets, diffraction, full", input: () => signalInputOf(fixture(48, 32, { box: true, diffraction: true }), threeSurfaces(-2.6, 1.8, 4.2), FULL) },
  { name: "box offsets, diffraction, fast", input: () => signalInputOf(fixture(48, 32, { box: true, diffraction: true }), threeSurfaces(-2.6, 1.8, 4.2), FAST) },
  { name: "the layered sum's own path (no single-plane input), full", input: () => signalInputOf(fixture(40, 28), threeSurfaces(3.1, -1.2, 5.5), FULL, false) },
  { name: "field zones (cat's eye)", input: (): LayeredSceneSignalInput => {
    const base = signalInputOf(fixture(40, 28), threeSurfaces(-3.4, 2.2, 4.6), FAST, false);
    const clip = (axis: Float64Array, zone: number): Float64Array => {
      const width = Math.sqrt(axis.length), R = (width - 1) / 2, out = new Float64Array(axis.length);
      let sum = 0;
      for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) if (zone === 0 || i <= R + (zone % 3) - 1) { out[j * width + i] = axis[j * width + i]!; sum += axis[j * width + i]!; }
      return out.map((w) => w / sum);
    };
    return { ...base, layers: base.layers.map((l) => (l.kernel ? { ...l, zones: { size: 14, columns: 3, rows: 2, kernelOf: (zone: number): Float64Array => clip(l.kernel!.weights, zone) } } : l)) };
  } },
  { name: "a radiance back plane, box offsets", input: (): LayeredSceneSignalInput => {
    const base = signalInputOf(fixture(40, 28, { box: true }), threeSurfaces(-1.7, 2.4, 3.6), FULL);
    return { ...base, layers: base.layers.map((l, k) => (k === 2 ? { ...l, scene: radianceBack, signalInput: { ...l.signalInput!, scene: radianceBack } } : l)) };
  } },
  { name: "both cards in front of the focus plane, small tiles", input: () => ({ ...signalInputOf(fixture(44, 30, { diffraction: true }), threeSurfaces(-4.4, -2.1, 0), FAST),
    capacityBytes: 4 * 32 * 32 * 3 * 8 }) },
  // An in-focus card behind a card blurred to ρ = −34: the in-focus card's whole-pupil region crosses the near card's edge over
  // 68 sites, so its rows reach the clamp (16 · 68 > 1024).
  { name: "an in-focus card behind rho -34, full (the row clamp)", input: () => signalInputOf(fixture(24, 16), [
    { rect: { u0: -1, u1: 0.05, v0: -1, v1: 1 }, rho: -34, reflectances: [0.15] },
    { rect: { u0: -0.5, u1: 0.6, v0: -0.4, v1: 0.3 }, rho: 0, reflectances: [0.3, 0.9], materialAt: cardA },
    { rect: null, rho: 3, reflectances: [0.6] }], FULL, false) },
  // A kernel two sites wider than its disc (zero rings): the reach is radius + 0.5, above 1.25·|ρ| + 0.5.
  { name: "a kernel two sites wider than its disc", input: (): LayeredSceneSignalInput => {
    const base = signalInputOf(fixture(40, 28), threeSurfaces(-2.6, 1.8, 4.2), FULL, false);
    return { ...base, layers: base.layers.map((l, k) => (k === 1 ? { ...l, kernel: padded(l.kernel!, 2) } : l)) };
  } },
  // A surface with ρ ≠ 0 and no kernel: its taps are one unit tap over the whole pupil.
  { name: "a null kernel with rho -2.6", input: (): LayeredSceneSignalInput => {
    const base = signalInputOf(fixture(40, 28), threeSurfaces(-2.6, 1.8, 4.2), FAST, false);
    return { ...base, layers: base.layers.map((l, k) => (k === 0 ? { ...l, kernel: null } : l)) };
  } }
];

/** A kernel with `extra` rings of zero weights around it. */
function padded(kernel: { radius: number; weights: Float64Array }, extra: number): { radius: number; weights: Float64Array } {
  const R = kernel.radius, width = 2 * R + 1, wide = width + 2 * extra, weights = new Float64Array(wide * wide);
  for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) weights[(j + extra) * wide + i + extra] = kernel.weights[j * width + i]!;
  return { radius: R + extra, weights };
}

interface ModuleLock { lattice: string; signal: string; counters: string }
function moduleDigest(c: ModuleCase): ModuleLock {
  const input = c.input(), lattice = createLayeredSceneLattice(input), signal = createLayeredSceneSignal(input, lattice);
  const W = input.nativeWidth, H = input.nativeHeight, N = WAVELENGTHS.length, margin = 6;
  // The view signal of every site first (it registers the lattice groups), then the lattice values of each group.
  const sites = new Float64Array(W * H);
  signal.window(0, 0, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sites[y * W + x] = signal.site(x, y);
  const s = createHash("sha256");
  update(s, sites);
  const afterSites = { edgeSites: signal.edgeSites, delegatedSites: signal.delegatedSites, lookups: signal.lookups, edgePoints: lattice.edgePoints };
  const l = createHash("sha256"), spectrum = new Float64Array(N), surfaces: number[] = [];
  for (let group = 0; group < lattice.groups.length; group++) for (let q = -margin; q < H + margin; q++) for (let p = -margin; p < W + margin; p++) {
    lattice.spectrumAt(group, p, q, spectrum);
    update(l, spectrum);
    surfaces.push(lattice.surfaceOf(group, p, q));
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) surfaces.push(lattice.siteSurface(x, y, 1), lattice.siteSurface(x, y, 3));
  const chief: number[] = [];
  for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
    const u = -1 + i / 10, v = -0.7 + j * 0.07, at = lattice.chiefSurface(u, v);
    chief.push(at.surface, at.material, signal.pilot(u, v), lattice.latticeU(0, i), lattice.latticeV(0, j));
  }
  l.update(JSON.stringify({ groups: lattice.groups, surfaces, chief }));
  // The counters on their own: a change of work (lookups, edge points, tiles) shows apart from a change of values.
  const tiles = (t: typeof lattice.tiles.sum): number[] => [t.tilesComputed, t.rowsComputed];
  const counters = JSON.stringify({ afterSites, edgePoints: lattice.edgePoints, lookups: lattice.lookups, surfaceTiles: tiles(lattice.tiles.surfaces), sumTiles: tiles(lattice.tiles.sum) });
  return { lattice: hex(l), signal: hex(s), counters };
}

const MODULE_LOCKS: readonly ModuleLock[] = [
  // box offsets, diffraction, full
  { lattice: "f411b00d30358596a956b747216d8c24da371cfc2073b8b979fd47a3d38e51d0",
    signal: "fc7b1bd4d50a8f4d2f3e71e919eae1ca9dd930841f0357619983e4d0d50bcdf0",
    counters: '{"afterSites":{"edgeSites":1385,"delegatedSites":151,"lookups":78812,"edgePoints":3176},"edgePoints":3176,"lookups":73728,"surfaceTiles":[72,2304],"sumTiles":[36,552]}' },
  // box offsets, diffraction, fast
  { lattice: "06c556c7bee740d42432d8d8418af33ee002505c9e6785f11c06aead480e6d6e",
    signal: "c162c10aad5e825c30d4403e6dd513237d5015f168d0e98c2130156ed25b4cb8",
    counters: '{"afterSites":{"edgeSites":1385,"delegatedSites":151,"lookups":78812,"edgePoints":3176},"edgePoints":3176,"lookups":73728,"surfaceTiles":[72,2304],"sumTiles":[36,552]}' },
  // the layered sum's own path (no single-plane input), full
  { lattice: "e3dbf08546cfd9ca6496ff9dcb9894949624fb486cae431efe05e521ca1b88c5",
    signal: "73b4f2e2b39d5f0b95537ad8abb2b7a6e6c91e3473689caaba221656d16359df",
    counters: '{"afterSites":{"edgeSites":1120,"delegatedSites":0,"lookups":15360,"edgePoints":619},"edgePoints":619,"lookups":18432,"surfaceTiles":[18,576],"sumTiles":[9,120]}' },
  // field zones (cat's eye)
  { lattice: "c4c1079cfa207f98dbd380046d6b08aee111404abc8f800d86c98cca1db48faf",
    signal: "41753a8c33bbb044f2c241bebab1d343b89bdd47f94f58561ea49d4289d26f77",
    counters: '{"afterSites":{"edgeSites":1120,"delegatedSites":0,"lookups":14336,"edgePoints":793},"edgePoints":793,"lookups":17408,"surfaceTiles":[17,544],"sumTiles":[9,120]}' },
  // a radiance back plane, box offsets
  { lattice: "e4709be48bbaa74fa4f0484cab88028ac331eb3c721a5efb6d10f203e50400d3",
    signal: "a8c654efcbfd2bfbf97e4c6343b6c002db1fa96b32eb5eb5ffe3135e5600215a",
    counters: '{"afterSites":{"edgeSites":936,"delegatedSites":184,"lookups":121384,"edgePoints":2356},"edgePoints":2356,"lookups":196608,"surfaceTiles":[72,2304],"sumTiles":[36,480]}' },
  // both cards in front of the focus plane, small tiles
  { lattice: "3b041bace3e577187f39c772aed776c79533b072f295982277e8014978216639",
    signal: "010865cd6a8107b0069ccb1621f15bcec519cb5af570a73e7b5b9242b0772cd8",
    counters: '{"afterSites":{"edgeSites":1271,"delegatedSites":49,"lookups":1332379,"edgePoints":11514},"edgePoints":25443,"lookups":2867200,"surfaceTiles":[2800,89600],"sumTiles":[2211,2799]}' },
  // an in-focus card behind rho -34, full (the row clamp)
  { lattice: "f89c1f42f66e5bfc4aa37e73b135d3b5a8144212baa1492f65aa00015079a2a6",
    signal: "65f9af8de380e5da94ab64fe7972e31f0db7e5ab559c2bb34e1d8167bde4db38",
    counters: '{"afterSites":{"edgeSites":384,"delegatedSites":0,"lookups":9216,"edgePoints":512},"edgePoints":1792,"lookups":11264,"surfaceTiles":[11,352],"sumTiles":[4,56]}' },
  // a kernel two sites wider than its disc
  { lattice: "8f31f1ea2711fed3309e2fb3bb4dad36b040799605ce9616c3441ea87f833872",
    signal: "30895f8b282a2210f335c0b05f1849c0d2f7fbcdd9cf38dc24d19217abe4cc5f",
    counters: '{"afterSites":{"edgeSites":1120,"delegatedSites":0,"lookups":11264,"edgePoints":842},"edgePoints":842,"lookups":18432,"surfaceTiles":[18,576],"sumTiles":[9,120]}' },
  // a null kernel with rho -2.6
  { lattice: "afd2384888c671b232a4547caf70ca5d46cfdd991112a4cf461b38e0e0b73d94",
    signal: "a6113343b2ec68323e316b57b20f1acc1ab39d9cc3bf01ec6f35ae608ef0560d",
    counters: '{"afterSites":{"edgeSites":1120,"delegatedSites":0,"lookups":11264,"edgePoints":696},"edgePoints":696,"lookups":18432,"surfaceTiles":[18,576],"sumTiles":[9,120]}' }
];

describe("layered sum seams (L0): module-level values keep their bits", () => {
  it("pins the spectral lattice values, surfaces, site signals and counters of nine lattices", () => {
    const recorded = moduleCases.map((c) => [c.name, moduleDigest(c)] as const);
    if (RECORD) { console.log(JSON.stringify({ arch: process.arch, node: process.version, module: recorded })); return; }
    expect(recorded).toHaveLength(MODULE_LOCKS.length);
    for (const [k, [name, got]] of recorded.entries()) for (const key of ["lattice", "signal", "counters"] as const)
      expect(got[key], name + " " + key).toBe(MODULE_LOCKS[k]![key]);
  }, scaledTimeout(120_000));
});

// The benchmark's cases --------------------------------------------------------------------------------------------------

interface BenchmarkLock { view: string; viewInternals: string; capture: string }
const BENCHMARK_LOCKS: Readonly<Record<string, BenchmarkLock>> = {
  "card 2 f/2 fast": { view: "0015dad8320a1cbfae5e3f9cf44278ad8fde0361335d80627dfbc9fa30abb4e1", viewInternals: "6eb3f0b20525fad90d2303bae86aede350356711ccd40a4889a64913499ce49f", capture: "6fc2c5f0a4614b5a4fe3dc02a6dec08c25db28918e111656e2eda764caae9005" },
  "card 2 f/2 full": { view: "0015dad8320a1cbfae5e3f9cf44278ad8fde0361335d80627dfbc9fa30abb4e1", viewInternals: "6eb3f0b20525fad90d2303bae86aede350356711ccd40a4889a64913499ce49f", capture: "6fc2c5f0a4614b5a4fe3dc02a6dec08c25db28918e111656e2eda764caae9005" },
  "card 2 f/8 fast": { view: "8936ba6bf935254a6fd7abd043a557d04378b9d972a3c29d244da99970820638", viewInternals: "be76878c02b46ee3e1dcade2792e0e3cc095406f93b18eda3413f33039fd6be0", capture: "444552e9cb487a4b80131084f8aa018a3a4cd7df442886cabb50b427f4634c1c" },
  "card 2 f/8 full": { view: "8936ba6bf935254a6fd7abd043a557d04378b9d972a3c29d244da99970820638", viewInternals: "be76878c02b46ee3e1dcade2792e0e3cc095406f93b18eda3413f33039fd6be0", capture: "444552e9cb487a4b80131084f8aa018a3a4cd7df442886cabb50b427f4634c1c" },
  "card 0 f/2 fast": { view: "902c2da82e8690eb33283b70131e6cfea3948b7501d79b534ceac85114a3e30b", viewInternals: "d0360866536335e4c25f79fe90542c80a2c48a71e813f40ce612a7af918e7cc7", capture: "612fa2d3ec0c0dc918cc9e399d45ee8c50615fa4e1a16a230d6ad600df5a87c4" },
  "card 0 f/2 full": { view: "d296fa790c04f0a3aede1cb2c53060aa0040f0f4178412072fd684d7bf2ec0a1", viewInternals: "56868718653ef05cae7a6cdcf1e727a112ec00992cd4dada6061582651fca489", capture: "21826e46b502c1ba79c5ba7c8ee5d0cf7e63d737864546de8c3630efb411839b" },
  "card 0 f/8 fast": { view: "d2a71972fc14380e7a579eba85ef4187b92951f066a44ba1ecc0136cc0058267", viewInternals: "d30f5c5995026321e56e657f5c354b1beffb7f280c1998ad8c51083b8c352a48", capture: "d8e70ebf8b64de350ca496e459da220e47505e338cdc90590382dfb13b3b56d9" },
  "card 0 f/8 full": { view: "3ebfb87dd8d93abfdc8127483b9e55facf48e7c1de8313824996330c489bdaa6", viewInternals: "feb3258fc66466f97bc21f06c7cf37ab7a2d29bda846facedd55b1d3fe34dc83", capture: "dcf7cb075aa6e6aab42d89002bdd2121f58b829d9288941a7662485c5792a331" }
};

describe("layered sum seams (L0): the cases of scripts/benchmark-layered-scenes.mjs keep their bits", () => {
  beforeAll(async () => { await prepareLayeredChartScenes(); });
  it("pins the view and capture regions at f/2 and f/8, fast and full, on the edges of cards 2 and 0", async () => {
    // The benchmark's request (see the script): the tabletop preset on a 6000 × 4000 sensor of 6 µm sites, a 192 × 128 region
    // on the right edge of the card at the focus distance.
    const W = 6000, H = 4000, aspect = H / W;
    const scene = resolveLayeredChartPreset({ scale: "tabletop", focusDistanceM: 1, lens: { focalLengthMm: 50 }, aspect });
    const recorded: Record<string, BenchmarkLock> = {};
    // The benchmark's region (card 2, at the focus distance: there the fast and full rows give the same bits), and the same
    // region on the right edge of card 0 (blurred in front of the focus plane: there they differ).
    for (const index of [2, 0]) for (const fNumber of [2, 8]) for (const fast of [true, false]) {
      const card = scene.cards[index]!, u = card.centerU + card.width / 2, v = card.centerV + card.height / 2;
      const px = Math.round((u + 1) / 2 * W), py = Math.round((aspect - v) / (2 * aspect) * W);
      const region = { x: px - 96, y: py - 64, width: 192, height: 128 };
      const options: SimulateCaptureOptions = { scene, subjectDistanceM: 1, lens: { ideal: { focalLengthMm: 50 }, fNumber, focusDistanceM: 1 },
        sensor: { pixelPitchMicrometers: 6, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { width: W, height: H, maximumPixels: (W + 2) * (H + 2) },
        exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, fast };
      const prepared = await prepareDisplayView(options, { gpu: "off" });
      const view = await prepared.render({ width: W, height: H, region });
      const { internals } = await simulateDisplayViewWithInternals(options, { width: W, height: H, region });
      const capture = await simulateCapture({ ...options, output: { ...options.output, region } });
      const a = createHash("sha256"), b = createHash("sha256"), c = createHash("sha256");
      update(a, view.image.samples);
      update(b, internals.expected); update(b, internals.noiseStd);
      update(c, capture.image.samples); update(c, capture.raw.codes);
      recorded[`card ${index} f/${fNumber} ${fast ? "fast" : "full"}`] = { view: hex(a), viewInternals: hex(b), capture: hex(c) };
    }
    if (RECORD) { console.log(JSON.stringify({ arch: process.arch, node: process.version, benchmark: recorded })); return; }
    expect(Object.keys(recorded)).toEqual(Object.keys(BENCHMARK_LOCKS));
    for (const [name, got] of Object.entries(recorded)) for (const key of ["view", "viewInternals", "capture"] as const)
      expect(got[key], name + " " + key).toBe(BENCHMARK_LOCKS[name]![key]);
  }, scaledTimeout(180_000));
});

// The interfaces the later layered groups build on ---------------------------------------------------------------------------

describe("layered sum seams (L0): the module interfaces", () => {
  const f = fixture(40, 28), specs = threeSurfaces(-2.6, 1.8, 4.2), input = signalInputOf(f, specs, FULL, false);
  const lattice = createLayeredSceneLattice(input), { geometry, visibility } = lattice.parts;
  const g0 = lattice.groupOf(0, 0), g1 = lattice.groupOf(0.25, 0.75);

  it("framePoint is the lattice formula with factor 1; edges are each card's rectangle in lattice coordinates", () => {
    const point = { u: 0, v: 0, factor: 0 };
    for (const group of [g0, g1]) for (let q = -3; q < f.H + 3; q += 2) for (let p = -3; p < f.W + 3; p += 3) {
      expect(geometry.framePoint(group, p, q, point)).toBe(point);
      expect(point).toEqual({ u: geometry.latticeU(group, p), v: geometry.latticeV(group, q), factor: 1 });
      const edges = geometry.edges(group, p, q), { fx, fy } = geometry.groups[group]!;
      expect(edges).toHaveLength(3);
      expect(edges[2]).toBeNull();
      for (const k of [0, 1]) {
        const r = specs[k]!.rect!, e = edges[k]!;
        // The rectangle's frame-unit corners map to its box: X = u/g − ½ + W/2 − fx, Y = −v/g − ½ + H/2 − fy.
        expect(Array.from(e)).toEqual([r.u0 / f.g - 0.5 + f.W / 2 - fx, -r.v1 / f.g - 0.5 + f.H / 2 - fy, r.u1 / f.g - 0.5 + f.W / 2 - fx, -r.v0 / f.g - 0.5 + f.H / 2 - fy]);
      }
    }
    expect(lattice.chiefSurface(-0.5, 0)).toEqual({ surface: 0, material: lattice.parts.radiance.material(0, { u: -0.5, v: 0, factor: 1 }) });
    expect(geometry.chiefSurface(0.5, 0)).toBe(1);
    expect(geometry.chiefSurface(0.95, 0)).toBe(2);
  });

  // The three surfaces above, and a strip in front of a blurred back plane (the strip cuts the middle of the back plane's rows).
  const strip: SurfaceSpec[] = [{ rect: { u0: 0.005, u1: 0.045, v0: -0.4, v1: 0.4 }, rho: 0.6, reflectances: [0.1] }, { rect: null, rho: 6, reflectances: [0.7] }];
  for (const [name, set] of [["three surfaces", specs], ["a strip", strip]] as const) it("rowIntervals gives the open part of a pupil row exactly, and rowBreaks the rows' edges: " + name, () => {
    const lat = set === specs ? lattice : createLayeredSceneLattice(signalInputOf(f, set, FULL, false)), geo = lat.parts.geometry, vis = lat.parts.visibility, g = lat.groupOf(0, 0);
    // Brute force along each row: a ray at Px reaches surface k when its point is inside k's rectangle (if any) and outside
    // every nearer one (frame units, as the fixture's reference integration).
    const reaches = (k: number, x: number, y: number, px: number, py: number): boolean => {
      for (let j = 0; j <= k; j++) {
        const s = set[j]!, X = x - s.rho * px, Y = y - s.rho * py, u = (X + 0.5 - f.W / 2) * f.g, v = -(Y + 0.5 - f.H / 2) * f.g, r = s.rect;
        const inside = r === null || (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1);
        if (j === k ? !inside : inside) return false;
      }
      return true;
    };
    const out = new Float64Array(6), breaks = new Float64Array(8);
    let checked = 0, rowsWithGaps = 0;
    const wrong: string[] = [];
    for (let q = 2; q < f.H - 2; q += 3) for (let p = 2; p < f.W - 2; p += 2) {
      if (geo.surfaceOf(g, p, q) >= 0) continue;
      for (let k = 0; k < set.length; k++) for (let row = 0; row < 9; row++) {
        const py = -0.95 + row * 0.2375, w = Math.sqrt(1 - py * py), count = vis.rowIntervals(g, k, p, q, py, -w, w, out);
        if (count > 1) rowsWithGaps++;
        for (let c = 0; c < count; c++) {
          expect(out[2 * c]!).toBeGreaterThanOrEqual(-w);
          expect(out[2 * c + 1]!).toBeGreaterThan(out[2 * c]!);
          expect(out[2 * c + 1]!).toBeLessThanOrEqual(w);
          if (c > 0) expect(out[2 * c]!).toBeGreaterThan(out[2 * c - 1]!);
        }
        for (let i = 0; i < 400; i++) {
          const px = -w + (i + 0.5) * 2 * w / 400;
          let inside = false, near = false;
          for (let c = 0; c < count; c++) {
            if (px >= out[2 * c]! && px <= out[2 * c + 1]!) inside = true;
            if (Math.abs(px - out[2 * c]!) < 1e-9 || Math.abs(px - out[2 * c + 1]!) < 1e-9) near = true;
          }
          if (near) continue;
          if (inside !== reaches(k, p, q, px, py)) wrong.push(`k ${k} at (${p}, ${q}) row ${py} Px ${px}`);
          checked++;
        }
        // Row breaks: b0, b1 and every card edge's Py between them, sorted.
        const n = vis.rowBreaks(g, k, p, q, -1, 1, breaks), list = Array.from(breaks.subarray(0, n));
        expect(list).toEqual([...list].sort((a, b) => a - b));
        expect(list[0]).toBe(-1);
        expect(list[n - 1]).toBe(1);
        for (let j = 0; j <= k; j++) {
          const r = geo.edges(g, p, q)[j], s = set[j]!.rho;
          if (r) for (const e of [(q - r[1]!) / s, (q - r[3]!) / s]) if (e > -1 && e < 1) expect(list).toContain(e);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(10_000);
    if (set === strip) expect(rowsWithGaps).toBeGreaterThan(0);
  });

  it("share is 0 or 1 away from edges and the share of the open rows across them", () => {
    // A point on surface 0 alone: the whole pupil reaches it and none reaches the surfaces behind.
    let alone = -1, ax = 0, ay = 0;
    for (let q = 0; q < f.H && alone < 0; q++) for (let p = 0; p < f.W; p++) if (geometry.surfaceOf(g0, p, q) === 0) { alone = 0; ax = p; ay = q; break; }
    expect(alone).toBe(0);
    expect(visibility.share(g0, 0, ax, ay, -1, 1, -1, 1)).toBe(1);
    expect(visibility.share(g0, 1, ax, ay, -1, 1, -1, 1)).toBe(0);
    // At an edge point the shares of the surfaces add up to the whole pupil, within the full method's energy bound (0.2 %).
    let edgePoints = 0;
    for (let q = 2; q < f.H - 2; q += 4) for (let p = 2; p < f.W - 2; p += 4) {
      if (geometry.surfaceOf(g0, p, q) >= 0) continue;
      let total = 0;
      edgePoints++;
      for (let k = 0; k < 3; k++) total += visibility.share(g0, k, p, q, -1, 1, -1, 1);
      expect(Math.abs(total - 1)).toBeLessThan(0.002);
    }
    expect(edgePoints).toBeGreaterThan(5);
  });

  it("kernel groups: the sum split into node groups has the bits of one group; invalid groups are refused", () => {
    const N = WAVELENGTHS.length, one = createLayeredSceneSignal(input, lattice);
    const kernelOf = (l: typeof input.layers[number]): { radius: number; weightsAt(): Float64Array | null } => ({ radius: l.kernel ? l.kernel.radius : 0, weightsAt: () => (l.kernel ? l.kernel.weights : null) });
    const split = { ...input, kernelGroups: input.layers.map((l) => [{ nodes: { from: 0, to: 1 }, kernel: kernelOf(l) }, { nodes: { from: 1, to: N }, kernel: kernelOf(l) }]) };
    const two = createLayeredSceneSignal(split, createLayeredSceneLattice(split));
    one.window(0, 0, f.W, f.H); two.window(0, 0, f.W, f.H);
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) expect(two.site(x, y)).toBe(one.site(x, y));
    expect(two.edgeSites).toBeGreaterThan(50);
    const gap = { ...input, kernelGroups: input.layers.map((l) => [{ nodes: { from: 0, to: 1 }, kernel: kernelOf(l) }, { nodes: { from: 2, to: N }, kernel: kernelOf(l) }]) };
    expect(() => createLayeredSceneLattice(gap)).toThrow(/kernel groups/);
    const wide = { ...input, kernelGroups: input.layers.map((l) => [{ nodes: { from: 0, to: N }, kernel: { ...kernelOf(l), radius: kernelOf(l).radius + 1 } }]) };
    expect(() => createLayeredSceneLattice(wide)).toThrow(/kernel groups/);
  });
});

// The refusals ---------------------------------------------------------------------------------------------------------------

describe("layered sum seams (L0): the refusal table keeps every message", () => {
  it("gives the messages of 783f38f, the first present row first", () => {
    const scene = { kind: "layered-chart", cards: [{ distanceM: 1.6, centerU: 0.2, centerV: 0, width: 1, height: 0.8, scene: { preset: "slanted-edge" } }], backPlane: { distanceM: 3, reflectance: 0.5 } };
    // [request top level, lens, the message recorded at 783f38f (null: accepted)].
    const cases: [Record<string, unknown>, Record<string, unknown>, string | null][] = [
      [{ motion: { angularVelocityRadPerSec: {} } }, {}, "scene.kind \"layered-chart\" does not support motion.angularVelocityRadPerSec in 2.27.0: each surface's defocus and occlusion are rendered for a still camera and scene. Omit it, or use a single-plane scene."],
      [{ motion: {} }, {}, null],
      [{ motion: { subject: {}, x: 1 } }, {}, "scene.kind \"layered-chart\" does not support motion.subject in 2.27.0: each surface's defocus and occlusion are rendered for a still camera and scene. Omit it, or use a single-plane scene."],
      [{}, { projection: "rectilinear" }, null],
      [{}, { projection: "fisheye-equidistant" }, "scene.kind \"layered-chart\" does not support lens.projection other than \"rectilinear\" in 2.27.0: the layered sum maps every surface through the rectilinear lens. Omit it, or use a single-plane scene."],
      [{}, { distortion: {} }, "scene.kind \"layered-chart\" does not support lens.distortion in 2.27.0: the layered sum maps every surface through the distortion-free lens. Omit it, or use a single-plane scene."],
      [{}, { vignetting: {} }, "scene.kind \"layered-chart\" does not support lens.vignetting in 2.27.0: the layered sum takes one radiance-to-irradiance factor over the field. Omit it, or use a single-plane scene."],
      [{}, { catalogue: "x" }, "scene.kind \"layered-chart\" does not support lens.catalogue in 2.27.0: a catalogue lens has its own distortion, vignetting and PSF. Omit it, or use a single-plane scene."],
      [{}, { pupilSampling: {} }, "scene.kind \"layered-chart\" does not support lens.pupilSampling in 2.27.0: the layered sum renders the defocus and occlusion of each surface itself. Omit it, or use a single-plane scene."],
      [{}, { psf: {} }, "scene.kind \"layered-chart\" does not support lens.psf in 2.27.0: a caller PSF declares its own defocus. Omit it, or use a single-plane scene."],
      [{ chartSize: {} }, {}, "scene.kind \"layered-chart\" does not support chartSize in 2.27.0: cards are placed in frame units, each at its own size. Omit it, or use a single-plane scene."],
      [{ illumination: {} }, {}, "scene.kind \"layered-chart\" does not support illumination (mixed lighting) in 2.27.0: every surface is lit by the one illuminant. Omit it, or use a single-plane scene."],
      [{ chartSize: {}, illumination: {} }, { psf: {}, distortion: {} }, "scene.kind \"layered-chart\" does not support lens.distortion in 2.27.0: the layered sum maps every surface through the distortion-free lens. Omit it, or use a single-plane scene."],
      [{}, {}, null]];
    for (const [top, lens, message] of cases) {
      const run = (): unknown => resolveLayeredRequest({ top: { scene, ...top }, lens, aspect: 0.75, displayView: false });
      if (message === null) expect(run).not.toThrow();
      else expect(run).toThrow(message);
    }
  });
});
