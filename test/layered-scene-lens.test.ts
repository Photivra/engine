// SPDX-License-Identifier: Apache-2.0
/**
 * #744 (2.29.0 group LG) at module level: the layered sum on the sensor's site lattice through a lens map (distortion, a
 * projection, vignetting): `layered-lattice-geometry.ts` (frame points, field factors, card edges as tangent half-planes),
 * `layered-visibility.ts` (rows of half-planes) and `layered-scene-provider.ts` (queries keyed through the lens).
 *
 * 1. A lens map equal to the planar map (the planar formula through the lens branch, and a distortion-free rectilinear lens)
 *    gives the planar lattice values within 1e-9 relative; without a lens map the geometry is planar and gives box edges.
 * 2. Vignetting: an in-focus white surface's lattice values fall off as the profile's throughput times the distortion area
 *    factor, within 1e-9.
 * 3. One surface filling the frame equals the single-plane image-space path (`createDefocusImageSpaceProvider`, the same disc,
 *    the same lens) within 1e-9 relative.
 * 4. Curved card edges: occlusion edges against a brute-force aperture integration through the same mapping (64 × 64 staggered
 *    pupil points; each ray's surface point mapped through the lens): within 0.5 % (full) and 2 % (fast) of the local swing, for
 *    a strong barrel distortion with vignetting and an equisolid fisheye; and with a large blur on the fisheye, where the rows
 *    of some points do not hold and each tap takes its own tangents. Sites with a ray within 15° of a fisheye's horizon (where the
 *    frame coordinate, tan θ, blows up) or beyond it are measured apart: a looser bound that only guards against regressions.
 * 5. The rows: at most the published capacities, interval ends linear in Py between breaks with a fixed count, and
 *    `layeredBoxRelation`'s 0 and 1 certain for the curved cards (dense samples through the true map).
 * 6. The capture's provider keyed through the lens: capture and view per site within 1e-9 relative (four lattice groups), the
 *    lean lookup, refusals off the lattice, and the base provider's zero beyond a fisheye's horizon.
 * 7. `edges` keeps the last point's arrays (memoized per point).
 */
import { describe, expect, it } from "vitest";
import { createDefocusImageSpaceProvider, prepareDefocusImageSpaceGeometry, type PreparedDefocusImageSpaceGeometry } from "../src/facade/defocus-image-space-provider.js";
import { createLayeredLensMap, createLayeredLatticeGeometry, layeredBoxRelation, type LayeredFramePoint, type LayeredLensMap } from "../src/facade/layered-lattice-geometry.js";
import { createLayeredSceneProvider } from "../src/facade/layered-scene-provider.js";
import { LAYERED_OCCLUSION_SAMPLES, createLayeredSceneLattice, createLayeredSceneSignal, type LayeredSceneSignalInput } from "../src/facade/layered-scene-signal.js";
import { internalRadianceAccess, markInternalSceneRadianceEvaluator } from "../src/core/internal-radiance-evaluator.js";
import type { PlanarSceneRadianceProvider } from "../src/facade/scene-radiance.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../src/schema/scene-radiance.js";
import { createDefocusDiscSiteKernel } from "../src/optics/defocus-disc-kernel.js";
import { prepareIlluminationVignettingThroughput } from "../src/optics/illumination-vignetting.js";
import { undistortedImagePointNewton } from "../src/optics/radial-distortion-newton.js";
import { prepareEnvironmentLensFieldMapping } from "../src/optics/sensor-environment-query.js";
import type { LensProjectionModel } from "../src/camera/lens-projection.js";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { expectSiteElectronsEquivalent } from "./helpers/view-equivalence.js";
import { RESPONSE, WAVELENGTHS, WHITE, bayer, fixture, signalInputOf, signalOf, type Fixture, type SurfaceSpec } from "./helpers/layered-scene-fixtures.js";

const { fast: FAST, full: FULL } = LAYERED_OCCLUSION_SAMPLES;
// A 96 × 64 raster of 375 µm sites: a 36 × 24 mm frame, so a small lattice spans a wide field.
const W = 96, H = 64, PITCH = 375, HALF_DIAGONAL = 21.633307652783937, DISTANCE = 1;
const VIGNETTING = { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.5, coefficients: { r2: -0.3065093752749457, r4: 0.023486999282859373, r6: 0 } };

interface Lens { geometry: PreparedDefocusImageSpaceGeometry; scale: number; map: LayeredLensMap; zeroBeyondHorizon: boolean }
/** A still lens: focal length, projection, radial k1 (null: none), vignetting; frame units scaled so the centre matches the planar map. */
function lens(focalLengthMm: number, model: LensProjectionModel, k1: number | null, vignetting: boolean, undistort = true): Lens {
  const fisheye = model !== "rectilinear";
  const lensMapping = k1 === null && !fisheye ? undefined : prepareEnvironmentLensFieldMapping({ projectionModel: model, radiometricAreaCorrection: "inverse-distortion-jacobian",
    ...(fisheye ? { outsideImageCircle: "backward-ray" } : {}),
    distortion: k1 === null ? { kind: "none" } : { kind: "radial", profile: { normalizationRadiusMm: HALF_DIAGONAL, maximumNormalizedRadius: 1.6, coefficients: { k1, k2: k1 / 10, k3: 0 } } } });
  const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm, focusDistanceM: 2, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 },
    ...(lensMapping ? { lensMapping } : {}), ...(vignetting ? { vignetting: VIGNETTING } : {}), ...(undistort ? { undistort: undistortedImagePointNewton } : {}) });
  // The projection distance from the axis's ray: u = (x / pd)·(DISTANCE / scale) equals x_sites·g at the centre.
  const near = geometry.lookOf(1e-3, 0, 0), pd = 1e-3 * near.z / near.x, g = 2 / W;
  const scale = DISTANCE * (PITCH / 1000) / (pd * g);
  const map = createLayeredLensMap({ geometry, pitchMicrometers: PITCH, distanceM: DISTANCE, metresPerFrameUnit: scale, zeroBeyondHorizon: fisheye });
  return { geometry, scale, map, zeroBeyondHorizon: fisheye };
}
/** The planar formula as a lens map (through the lens branch). */
const planarMap = (f: Fixture): LayeredLensMap => ({ zeroBeyondHorizon: false, sensorPointOf: () => undefined,
  framePointOf(x, y, out): LayeredFramePoint { out.u = x * f.g; out.v = -y * f.g; out.factor = 1; return out; } });

/** The input with a lens map; the margin is the signal's reach (query offsets and diffraction), as the wiring passes it. */
const withLens = (input: LayeredSceneSignalInput, map: LayeredLensMap | undefined, marginSites = 3): LayeredSceneSignalInput => ({ ...input, ...(map ? { lensMap: map, marginSites } : {}) });
const relative = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);

/**
 * Brute-force reference at the centre of native site (x, y) through a lens map (one zero offset, no diffraction): 64 × 64
 * staggered pupil points inside the unit circle; each ray meets surface j's image at lattice point (x − ρ_j·Px, y − ρ_j·Py),
 * whose frame point comes from the map; the first surface whose card holds that frame point gives F·L, with F the field factor
 * at the lattice point of the kernel tap the ray falls in (x − round(ρ_j·P)), as the disc kernel samples it (the factor's own
 * sampling is test 3's; here the occlusion is under test). A ray whose point sees no scene gives 0. `bruteDark` counts the rays
 * that see no scene or are steeper than `steepRadius`.
 * Independent of the engine's rows and tangents.
 */
let bruteDark = 0;
/** Frame radius beyond which a ray is steeper than `steepDegrees` off the axis (the frame point is tan θ times the centre's scale). */
let steepRadius = Infinity;
function bruteForceLensSite(specs: readonly SurfaceSpec[], map: LayeredLensMap, x: number, y: number, points = 64): number {
  const c = bayer(x, y), out: LayeredFramePoint = { u: 0, v: 0, factor: 0 }, tap: LayeredFramePoint = { u: 0, v: 0, factor: 0 };
  let sum = 0, count = 0;
  bruteDark = 0;
  for (let j = 0; j < points; j++) for (let i = 0; i < points; i++) {
    const px = -1 + (i + ((j * 0.6180339887498949) % 1)) * 2 / points, py = -1 + (j + ((i * 0.7548776662466927) % 1)) * 2 / points;
    if (px * px + py * py > 1) continue;
    count++;
    for (const spec of specs) {
      map.framePointOf(x - spec.rho * px + 0.5 - W / 2, y - spec.rho * py + 0.5 - H / 2, out);
      if (out.factor === 0 || Math.hypot(out.u, out.v) > steepRadius) bruteDark++;
      if (out.factor === 0) break;
      const r = spec.rect;
      if (r === null || (out.u >= r.u0 && out.u <= r.u1 && out.v >= r.v0 && out.v <= r.v1)) {
        const factor = map.framePointOf(x - Math.round(spec.rho * px) + 0.5 - W / 2, y - Math.round(spec.rho * py) + 0.5 - H / 2, tap).factor;
        sum += factor * signalOf(c, WHITE.map((w) => w * spec.reflectances[0]!));
        break;
      }
    }
  }
  return sum / count;
}

describe("#744: a lens map equal to the planar map (test 1)", () => {
  const f = fixture(48, 32, { box: true, diffraction: true });
  const specs: SurfaceSpec[] = [
    { rect: { u0: -0.7, u1: 0.15, v0: -0.35, v1: 0.3 }, rho: -2.6, reflectances: [0.08, 0.85], materialAt: (u, v) => (Math.floor(u * 9) + Math.floor(v * 7)) & 1 },
    { rect: { u0: -0.1, u1: 0.8, v0: -0.25, v1: 0.45 }, rho: 1.8, reflectances: [0.2, 0.55] , materialAt: (u) => (u < 0.3 ? 0 : 1) },
    { rect: null, rho: 4.2, reflectances: [0.4] }];

  it("without a lens map the geometry is planar and its edges are the boxes, the same at every point", () => {
    const lattice = createLayeredSceneLattice(signalInputOf(f, specs, FULL, false)), geometry = lattice.parts.geometry;
    expect(geometry.planar).toBe(true);
    const group = geometry.groupOf(0, 0), box = geometry.edges(group, 3, 4)[0]!;
    expect(box.length).toBe(4);
    expect(geometry.edges(group, 30, 20)[0]).toBe(box);
    expect(lattice.parts.visibility.rowBreaksCapacity).toBe(2 * specs.length + 2);
    expect(lattice.parts.visibility.rowIntervalsCapacity).toBe(2 * specs.length);
  });

  for (const [name, mapOf] of [["the planar formula through the lens branch", (): LayeredLensMap => planarMap(f)],
    ["a distortion-free rectilinear lens", (): LayeredLensMap => {
      const l = lens(50, "rectilinear", null, false), scale = DISTANCE * (PITCH / 1000) / ((1e-3 * l.geometry.lookOf(1e-3, 0, 0).z / l.geometry.lookOf(1e-3, 0, 0).x) * f.g);
      return createLayeredLensMap({ geometry: l.geometry, pitchMicrometers: PITCH, distanceM: DISTANCE, metresPerFrameUnit: scale });
    }]] as const) it(name + ": the planar lattice values within 1e-9 relative", () => {
    const input = signalInputOf(f, specs, FULL, false), planar = createLayeredSceneLattice(input), mapped = createLayeredSceneLattice(withLens(input, mapOf()));
    expect(mapped.parts.geometry.planar).toBe(false);
    const a = new Float64Array(3), b = new Float64Array(3);
    let worst = 0;
    for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.75]] as const) {
      const ga = planar.groupOf(fx, fy), gb = mapped.groupOf(fx, fy);
      for (let q = -2; q < f.H + 2; q++) for (let p = -2; p < f.W + 2; p++) {
        planar.spectrumAt(ga, p, q, a); mapped.spectrumAt(gb, p, q, b);
        for (let n = 0; n < 3; n++) worst = Math.max(worst, relative(a[n]!, b[n]!));
        expect(mapped.surfaceOf(gb, p, q) === -1 || mapped.surfaceOf(gb, p, q) === planar.surfaceOf(ga, p, q)).toBe(true);
      }
    }
    expect(worst).toBeLessThan(1e-9);
    expect(mapped.edgePoints).toBeGreaterThan(100);
  }, scaledTimeout(60_000));
});

describe("#744: vignetting and the distortion area factor (test 2)", () => {
  it("an in-focus white surface falls off as the throughput times the area factor within 1e-9", () => {
    const f = fixture(W, H), l = lens(20, "rectilinear", -0.08, true), throughput = prepareIlluminationVignettingThroughput(VIGNETTING);
    const input = withLens(signalInputOf(f, [{ rect: null, rho: 0, reflectances: [1] }], FULL, false), l.map), lattice = createLayeredSceneLattice(input);
    const group = lattice.groupOf(0, 0), out = new Float64Array(3), point: LayeredFramePoint = { u: 0, v: 0, factor: 0 };
    let lowest = 1;
    for (let q = 0; q < H; q += 3) for (let p = 0; p < W; p += 3) {
      lattice.spectrumAt(group, p, q, out);
      const xMm = (p + 0.5 - W / 2) * PITCH / 1000, yMm = (q + 0.5 - H / 2) * PITCH / 1000;
      const area = l.geometry.lookOf(xMm, yMm, 0).factor / throughput({ x: xMm, y: -yMm });
      const factor = throughput({ x: xMm, y: -yMm }) * area;
      expect(lattice.parts.geometry.framePoint(group, p, q, point).factor).toBe(l.geometry.lookOf(xMm, yMm, 0).factor);
      for (let n = 0; n < 3; n++) expect(relative(out[n]!, WHITE[n]! * factor)).toBeLessThan(1e-9);
      lowest = Math.min(lowest, throughput({ x: xMm, y: -yMm }));
    }
    expect(lowest).toBeLessThan(0.8);
  });
});

describe("#744: one surface filling the frame equals the single-plane image-space path (test 3)", () => {
  it("lattice values within 1e-9 relative of the image-space provider's G = answer × F", () => {
    const l = lens(20, "rectilinear", -0.08, true);
    const radianceAt = (u: number, v: number, nm: number): number => 0.3 + 0.2 * Math.sin(7 * u) * Math.cos(5 * v) + nm / 5000;
    const rho = 3.4, disc = createDefocusDiscSiteKernel(2 * rho)!;
    const layers = [{ rect: null, blurRadiusSites: rho, scene: { kind: "radiance" as const, radianceAt }, kernel: { radius: disc.radius, weights: disc.weights } }];
    const lattice = createLayeredSceneLattice({ nativeWidth: W, nativeHeight: H, outputWidth: W, wavelengthsNm: WAVELENGTHS, layers, occlusionSamples: FULL, lensMap: l.map });
    const base: PlanarSceneRadianceProvider = { sceneId: "s", providerProfileId: "p", radianceAt: (u, v, nm) => radianceAt(u, v, nm),
      evaluateRadiance: (r: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => ({ spectralRadianceWattsPerSquareMeterSteradianNanometer: 0, wavelengthNanometers: r.wavelengthNanometers }) as never,
      evaluateApertureRadiance: (): never => { throw new Error("unused"); } };
    const provider = createDefocusImageSpaceProvider({ base, geometry: l.geometry, siteKernels: () => disc.weights, wavelengthsNm: WAVELENGTHS, kernelRadius: disc.radius,
      nativeWidth: W, nativeHeight: H, sitePitchMicrometers: PITCH, distanceM: DISTANCE, metresPerFrameUnit: l.scale });
    const group = lattice.groupOf(0, 0), out = new Float64Array(3);
    let worst = 0;
    for (let q = 0; q < H; q += 2) for (let p = 0; p < W; p += 2) {
      lattice.spectrumAt(group, p, q, out);
      const xMm = (p + 0.5 - W / 2) * PITCH / 1000, yMm = (q + 0.5 - H / 2) * PITCH / 1000, look = l.geometry.lookOf(xMm, yMm, 0);
      const request = { schemaVersion: "0.1.0", sampleId: "q", sceneId: "s", providerProfileId: "p", wavelengthBasis: "vacuum", timeSecondsFromExposureStart: 0,
        target: { kind: "environment-direction", outgoingDirectionUnitVector: { x: -look.x, y: -look.y, z: -look.z } } };
      WAVELENGTHS.forEach((nm, n) => {
        let answer: number;
        try { answer = provider.evaluateRadiance({ ...request, wavelengthNanometers: nm } as never).spectralRadianceWattsPerSquareMeterSteradianNanometer; } catch { answer = NaN; }
        worst = Math.max(worst, relative(out[n]!, answer * look.factor));
      });
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

/**
 * A card from sensor point (ex, ey0) to (ex2, ey1), sites from the centre: its rectangle in frame units spans the frame points of
 * the four corners (so its edges are curves through the lens).
 */
function cardRight(l: Lens, ex: number, ey0: number, ey1: number, ex2 = 50): { u0: number; v0: number; u1: number; v1: number } {
  const corners = [[ex, ey0], [ex, ey1], [ex2, ey0], [ex2, ey1], [ex, (ey0 + ey1) / 2]].map(([x, y]) => {
    const p: LayeredFramePoint = { u: 0, v: 0, factor: 0 };
    l.map.framePointOf(x!, y!, p);
    if (!(p.factor > 0)) throw new Error("card corner beyond the horizon");
    return p;
  });
  return { u0: corners[4]!.u, u1: Math.max(...corners.map((p) => p.u)), v0: Math.min(...corners.map((p) => p.v)), v1: Math.max(...corners.map((p) => p.v)) };
}
interface CurvedCase { name: string; lens: () => Lens; specs: (l: Lens) => SurfaceSpec[]; rows: number[]; columns: [number, number] }
/** 75° off the axis on the 12 mm fisheye: the frame scale at the centre (pd·g / pitch) times tan 75°. */
const FISHEYE_75 = 12 * (2 / W) / (PITCH / 1000) * Math.tan(75 * Math.PI / 180);
const curvedCases: CurvedCase[] = [
  { name: "a strong barrel distortion with vignetting", lens: () => lens(20, "rectilinear", -0.08, true), rows: [8, 9, 30, 31],
    specs: (l) => [{ rect: cardRight(l, 26, -40, 40), rho: -2.5, reflectances: [0.15] }, { rect: null, rho: 4, reflectances: [0.9] }], columns: [64, 88] },
  { name: "an equisolid fisheye", lens: () => lens(12, "fisheye-equisolid-angle", -0.02, false), rows: [6, 7, 20, 21],
    specs: (l) => [{ rect: cardRight(l, 24, -28, 28, 34), rho: -3, reflectances: [0.1] }, { rect: null, rho: 2.5, reflectances: [0.85] }], columns: [62, 90] },
  { name: "an equisolid fisheye, a large blur behind a far card's edge", lens: () => lens(12, "fisheye-equisolid-angle", -0.02, false), rows: [6, 7, 22, 23],
    specs: (l) => [{ rect: cardRight(l, 16, -24, 24, 30), rho: -9, reflectances: [0.1] }, { rect: cardRight(l, 24, -20, 20, 32), rho: 0.8, reflectances: [0.95] },
      { rect: null, rho: 4, reflectances: [0.4] }], columns: [52, 86] }];

describe("#744: curved card edges against the brute-force aperture integration through the lens (test 4)", () => {
  for (const c of curvedCases) it(c.name + ": full within 0.5 % and fast within 2 % of the local swing", () => {
    const l = c.lens(), specs = c.specs(l), f = fixture(W, H);
    steepRadius = l.zeroBeyondHorizon ? FISHEYE_75 : Infinity;
    const full = createLayeredSceneSignal(withLens(signalInputOf(f, specs, FULL, false), l.map, 1)), fast = createLayeredSceneSignal(withLens(signalInputOf(f, specs, FAST, false), l.map, 1));
    full.window(0, 0, W, H); fast.window(0, 0, W, H);
    let worstFull = 0, worstFast = 0, worstHorizon = 0, compared = 0;
    for (const y of c.rows) {
      const xs: number[] = [], reference: number[] = [], dark: boolean[] = [];
      for (let x = c.columns[0]; x < c.columns[1]; x++) { xs.push(x); reference.push(bruteForceLensSite(specs, l.map, x, y)); dark.push(bruteDark > 0); }
      const swing = (ch: number): number => { const v = xs.flatMap((x, i) => (bayer(x, y) === ch ? [reference[i]!] : [])); return Math.max(...v) - Math.min(...v); };
      xs.forEach((x, i) => {
        const s = swing(bayer(x, y)), e = Math.abs(full.site(x, y) - reference[i]!) / s;
        expect(s).toBeGreaterThan(0);
        // Sites with a ray beyond the horizon or (fisheyes) steeper than 75°, where the frame coordinate (tan θ) blows up: the horizon
        // band, an approximation of its own, measured apart.
        if (dark[i]) { worstHorizon = Math.max(worstHorizon, e); return; }
        compared++;
        worstFull = Math.max(worstFull, e);
        worstFast = Math.max(worstFast, Math.abs(fast.site(x, y) - reference[i]!) / s);
      });
    }
    expect(compared).toBeGreaterThan(40);
    expect(worstFull).toBeLessThan(0.005);
    expect(worstFast).toBeLessThan(0.02);
    expect(full.edgeSites).toBeGreaterThan(0);
    // The fisheye's band within 15° of the horizon is outside the bound (measured: 31 % and 20 % of the local swing at most); this
    // only keeps it from growing.
    expect(worstHorizon).toBeLessThan(0.4);
    // Points whose rows do not hold take each tap's own tangents (the per-tap pieces) on the fisheyes.
    const g = full.lattice.groupOf(0, 0);
    let pieces = 0;
    for (const y of c.rows) for (let x = c.columns[0]; x < c.columns[1]; x++) if (!full.lattice.parts.visibility.rowsHold(g, x, y)) pieces++;
    if (l.zeroBeyondHorizon) expect(pieces).toBeGreaterThan(0);
  }, scaledTimeout(120_000));
});

describe("#744: rows of half-planes and the box relation (test 5)", () => {
  const l = lens(20, "rectilinear", -0.08, true), f = fixture(W, H);
  const specs: SurfaceSpec[] = [{ rect: cardRight(l, 10, -20, 18), rho: -4.5, reflectances: [0.2] }, { rect: cardRight(l, 18, -26, 10), rho: 2.2, reflectances: [0.6] },
    { rect: null, rho: 5, reflectances: [0.4] }];
  const lattice = createLayeredSceneLattice(withLens(signalInputOf(f, specs, FULL, false), l.map, 1)), geometry = lattice.parts.geometry, visibility = lattice.parts.visibility;
  const group = lattice.groupOf(0.25, 0.75);

  it("stays within the published capacities, and between breaks the interval count is fixed and the ends linear in Py", () => {
    expect(visibility.rowIntervalsCapacity).toBe(6);
    expect(visibility.rowBreaksCapacity).toBe(2 + 12 + 66);
    const breaks = new Float64Array(visibility.rowBreaksCapacity), a = new Float64Array(6), b = new Float64Array(6), c = new Float64Array(6);
    let checked = 0;
    for (let q = 10; q < 50; q += 3) for (let p = 50; p < 80; p += 2) for (let k = 0; k < 3; k++) {
      const count = visibility.rowBreaks(group, k, p, q, -1, 1, breaks);
      expect(count).toBeLessThanOrEqual(visibility.rowBreaksCapacity);
      for (let i = 1; i < count; i++) expect(breaks[i]!).toBeGreaterThanOrEqual(breaks[i - 1]!);
      for (let s = 0; s + 1 < count; s++) {
        const y0 = breaks[s]!, y1 = breaks[s + 1]!;
        if (!(y1 - y0 > 1e-6)) continue;
        const e = 1e-7 * (y1 - y0), n0 = visibility.rowIntervals(group, k, p, q, y0 + e, -Infinity, Infinity, a);
        const n1 = visibility.rowIntervals(group, k, p, q, (y0 + y1) / 2, -Infinity, Infinity, b), n2 = visibility.rowIntervals(group, k, p, q, y1 - e, -Infinity, Infinity, c);
        expect(Math.max(n0, n1, n2)).toBeLessThanOrEqual(3);
        expect(n1).toBe(n0); expect(n2).toBe(n0);
        for (let i = 0; i < 2 * n0; i++) if (Number.isFinite(a[i]!) && Number.isFinite(c[i]!)) expect(Math.abs(b[i]! - (a[i]! + c[i]!) / 2)).toBeLessThan(1e-6 * (1 + Math.abs(b[i]!)));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("layeredBoxRelation's 0 and 1 hold for the curved cards (dense samples through the map)", () => {
    const point: LayeredFramePoint = { u: 0, v: 0, factor: 0 };
    let certain = 0;
    for (let q = 4; q < 60; q += 5) for (let p = 40; p < 92; p += 3) {
      const edges = geometry.edges(group, p, q);
      // Boxes up to each card's reach (the deviation is measured over the box its rays and kernel taps reach).
      for (let j = 0; j < 2; j++) for (const h of [1, 3, geometry.reachSites[j]!]) {
        const rel = layeredBoxRelation(edges[j]!, p - h, q - h, p + h, q + h), r = specs[j]!.rect!;
        if (rel === 2) continue;
        certain++;
        for (let sy = 0; sy <= 8; sy++) for (let sx = 0; sx <= 8; sx++) {
          const X = p - h + sx * h / 4, Y = q - h + sy * h / 4;
          l.map.framePointOf(X + 0.5 + 0.25 - W / 2, Y + 0.5 + 0.75 - H / 2, point);
          const inside = point.u >= r.u0 && point.u <= r.u1 && point.v >= r.v0 && point.v <= r.v1;
          expect(inside).toBe(rel === 1);
        }
      }
    }
    expect(certain).toBeGreaterThan(300);
  });
});

describe("#744: the capture's provider keyed through the lens (test 6)", () => {
  const l = lens(20, "rectilinear", -0.08, true), f = fixture(56, 40, { box: true, diffraction: true });
  const LW = 56, LH = 40;
  const checker = (u: number, v: number): number => ((Math.floor(u / 0.17) + Math.floor(v / 0.13)) & 1);
  const specs: SurfaceSpec[] = [
    { rect: { u0: -0.8, u1: 0.05, v0: -0.6, v1: 0.1 }, rho: -3.5, reflectances: [0.1, 0.7], materialAt: checker },
    { rect: { u0: -0.2, u1: 0.7, v0: -0.25, v1: 0.6 }, rho: 0.75, reflectances: [0.3, 0.9], materialAt: (u) => (u < 0.3 ? 0 : 1) },
    { rect: null, rho: 4.5, reflectances: [0.5, 0.05] }];
  // The lens on this 56 × 40 raster: frame units scaled to its own output width.
  const map = createLayeredLensMap({ geometry: l.geometry, pitchMicrometers: PITCH, distanceM: DISTANCE, metresPerFrameUnit: l.scale * W / LW });
  const input = withLens(signalInputOf(f, specs, FAST, false), map, 3);
  function baseProvider(internal: boolean): PlanarSceneRadianceProvider {
    const evaluateRadiance = (r: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult => ({ sampleId: r.sampleId, wavelengthNanometers: r.wavelengthNanometers,
      spectralRadianceWattsPerSquareMeterSteradianNanometer: 0 }) as unknown as SceneRadianceEvaluationResult;
    if (internal) markInternalSceneRadianceEvaluator(evaluateRadiance);
    return { sceneId: "layered", providerProfileId: "layered-test", radianceAt: () => 0, evaluateRadiance, evaluateApertureRadiance: (): never => { throw new Error("unused"); } };
  }
  const request = (o: { x: number; y: number; z: number }, nm: number): SceneRadianceEvaluationRequest => ({ schemaVersion: "0.1.0", sampleId: "q", sceneId: "layered",
    providerProfileId: "layered-test", wavelengthNanometers: nm, wavelengthBasis: "vacuum", target: { kind: "environment-direction", outgoingDirectionUnitVector: o } } as unknown as SceneRadianceEvaluationRequest);
  /** The environment's query of a native point (sites from the top-left, +y down): its outgoing direction and field factor through the lens. */
  const queryOf = (x: number, y: number): { o: { x: number; y: number; z: number }; factor: number } => {
    const look = l.geometry.lookOf((x - LW / 2) * PITCH / 1000, (y - LH / 2) * PITCH / 1000, 0);
    return { o: { x: -look.x, y: -look.y, z: -look.z }, factor: look.factor };
  };
  const providerOf = (internal: boolean): ReturnType<typeof createLayeredSceneProvider> => createLayeredSceneProvider({ base: baseProvider(internal),
    lattice: createLayeredSceneLattice(input), wavelengthsNm: WAVELENGTHS, nativeWidth: LW, nativeHeight: LH, outputWidth: LW, distanceM: DISTANCE,
    metresPerFrameUnit: l.scale * W / LW, queryOffsetsSites: f.offsets });

  it("capture and view agree per site within 1e-9 relative (four lattice groups, diffraction)", () => {
    const view = createLayeredSceneSignal(input), provider = providerOf(false);
    view.window(0, 0, LW, LH);
    const capture = { site(x: number, y: number): number {
      const a = RESPONSE[bayer(x, y)]!;
      let sum = 0;
      for (const o of f.offsets) {
        const query = queryOf(x + 0.5 + o.x, y + 0.5 + o.y);
        let v = 0;
        WAVELENGTHS.forEach((nm, n) => { v += a[n]! * query.factor * provider.evaluateRadiance(request(query.o, nm)).spectralRadianceWattsPerSquareMeterSteradianNanometer; });
        sum += o.weight * v;
      }
      return sum;
    } };
    expectSiteElectronsEquivalent(view, capture, { x0: 0, y0: 0, x1: LW, y1: LH });
    expect(view.edgeSites).toBeGreaterThan(100);
    expect(provider.queries).toBeGreaterThan(0);
  }, scaledTimeout(120_000));

  it("registers the lean lookup with the same values, and refuses queries off the lattice", () => {
    const provider = providerOf(true), access = internalRadianceAccess(provider.evaluateRadiance)!;
    const q = queryOf(20.25, 15.75), key = access.keyOfDirection(q.o, 0)!;
    expect(key).toBeDefined();
    for (const nm of WAVELENGTHS) expect(access.radianceOfKey(key, nm)).toBe(provider.evaluateRadiance(request(q.o, nm)).spectralRadianceWattsPerSquareMeterSteradianNanometer);
    expect(access.keyOfDirection({ x: 0, y: 0, z: 1 }, 0)).toBeUndefined();
    expect(() => provider.evaluateRadiance(request(queryOf(10.4, 10.1).o, 550))).toThrow(/off the site lattice/);
    expect(() => provider.evaluateRadiance(request(q.o, 551))).toThrow(/off the site lattice/);
  });

  it("beyond a fisheye's horizon gives the base provider's zero; the lattice there is dark", () => {
    const fish = lens(12, "fisheye-equisolid-angle", -0.02, false), lattice = createLayeredSceneLattice(withLens(signalInputOf(fixture(W, H), [{ rect: null, rho: 2, reflectances: [0.5] }], FAST, false), fish.map, 1));
    const provider = createLayeredSceneProvider({ base: baseProvider(true), lattice, wavelengthsNm: WAVELENGTHS, nativeWidth: W, nativeHeight: H, outputWidth: W,
      distanceM: DISTANCE, metresPerFrameUnit: fish.scale });
    expect(provider.evaluateRadiance(request({ x: 0.3, y: 0, z: 0.2 }, 550)).spectralRadianceWattsPerSquareMeterSteradianNanometer).toBe(0);
    expect(internalRadianceAccess(provider.evaluateRadiance)!.keyOfDirection({ x: 0.3, y: 0, z: 0.2 }, 0)).toBeUndefined();
    const out = new Float64Array(3);
    lattice.spectrumAt(lattice.groupOf(0, 0), 0, 0, out);
    expect(Array.from(out)).toEqual([0, 0, 0]);
    lattice.spectrumAt(lattice.groupOf(0, 0), W / 2, H / 2, out);
    expect(out[1]!).toBeGreaterThan(0);
  });
});

describe("#744: edges are memoized per point (test 7)", () => {
  it("returns the same arrays for the same point and recomputes them for another", () => {
    const l = lens(20, "rectilinear", -0.08, false);
    const geometry = createLayeredLatticeGeometry({ nativeWidth: W, nativeHeight: H, outputWidth: W, lensMap: l.map,
      layers: [{ rect: cardRight(l, 10, -20, 18), blurRadiusSites: -3, kernel: { radius: 3 } }, { rect: null, blurRadiusSites: 2, kernel: { radius: 2 } }] });
    const group = geometry.groupOf(0, 0), first = geometry.edges(group, 60, 30), copy = Float64Array.from(first[0]!);
    expect(geometry.edges(group, 60, 30)).toBe(first);
    expect(Array.from(geometry.edges(group, 61, 30)[0]!)).not.toEqual(Array.from(copy));
    expect(Array.from(geometry.edges(group, 60, 30)[0]!)).toEqual(Array.from(copy));
    expect(geometry.planar).toBe(false);
    expect(geometry.lensReachSites).toBeGreaterThan(0);
  });
});
