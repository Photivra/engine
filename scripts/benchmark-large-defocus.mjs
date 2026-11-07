// SPDX-License-Identifier: Apache-2.0
/**
 * #564: cost and accuracy of `lens.defocus` above the direct kernel radius (64 sites), where the disc is convolved by runs.
 * Uses the built `dist` (run `npm run build` first). Each timed case runs in its own Node process, so the peak resident set
 * (`process.resourceUsage().maxRSS`) is that case's alone.
 *
 *   node scripts/benchmark-large-defocus.mjs accuracy          # runs vs the direct gather of the same disc, on test charts
 *   node scripts/benchmark-large-defocus.mjs kernel            # reads and time per output of one tile, direct vs runs
 *   node scripts/benchmark-large-defocus.mjs capture           # simulateCapture, Siemens star 1024 × 683 at 6 µm, tabulated path
 *   node scripts/benchmark-large-defocus.mjs view              # the app's display view (24 MP, 2028 × 1352, 96 × 96 parts)
 *
 * Environment: RADII (default 64,65,179,512), REPEATS (default 1), PARTS (view: parts timed, default 8).
 */
import "./require-fresh-dist.mjs";
import { spawnSync } from "node:child_process";
import console from "node:console";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = new URL("..", import.meta.url), dist = (path) => pathToFileURL(fileURLToPath(new URL("dist/" + path, root))).href;
const radii = (process.env.RADII ?? "64,65,179,512").split(",").map(Number), repeats = Number(process.env.REPEATS ?? 1);
const [mode, ...rest] = process.argv.slice(2);

/** Focus distance (m) in front of a plane at d (m) for a disc of 2R + 0.6 sites: s = d·(f² + cNf)/(cNd + f²) (thin lens, calculateDefocusCircle). */
function focusFor(radius, { f, N, d, pitch }) {
  const c = (2 * radius + 0.6) * pitch / 1000, dm = d * 1000;
  return dm * (f * f + c * N * f) / (c * N * dm + f * f) / 1000;
}
const rss = () => Math.round(process.resourceUsage().maxRSS / 1024);

async function accuracy() {
  const { createPlanarSceneRadianceProvider } = await import(dist("index.js"));
  const { createDiffractedPlanarProvider } = await import(dist("facade/diffraction-provider.js"));
  const { createDefocusDiscSiteKernel } = await import(dist("optics/defocus-disc-kernel.js"));
  const { siteKernelRuns } = await import(dist("optics/site-kernel-runs.js"));
  const rows = [];
  for (const preset of ["siemens-star", "slanted-edge", "dead-leaves"]) for (const radius of radii.filter((r) => r > 64)) {
    // The direct gather costs (2R + 1)² per value: a smaller lattice at the largest radius.
    const W = radius > 300 ? 24 : 96, H = radius > 300 ? 16 : 64, nm = 550;
    const sharp = createPlanarSceneRadianceProvider({ scene: { preset }, illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 1000, distanceM: 2,
      framedWidthM: W * 6e-6 * 2 / 0.05 * 2, aspect: H / W, sceneId: "s", providerProfileId: "p" });
    const disc = createDefocusDiscSiteKernel(2 * radius + 0.6);
    // The providers replace only the radiance of the base result, so a stub result suffices for this comparison.
    const common = { base: { sceneId: "s", providerProfileId: "p", radianceAt: sharp.radianceAt, chartMaterialAt: sharp.chartMaterialAt, materialRadiance: sharp.materialRadiance,
      evaluateRadiance: () => ({}), evaluateApertureRadiance: () => ({}) }, wavelengthsNm: [nm], nativeWidth: W, nativeHeight: H, outputWidth: W, sitePitchMicrometers: 6, distanceM: 2, metresPerFrameUnit: W * 6e-6 * 2 / 0.05,
      siteKernels: () => disc.weights, kernelRadius: disc.radius };
    const direct = createDiffractedPlanarProvider(common), large = createDiffractedPlanarProvider({ ...common, largeKernel: { runs: siteKernelRuns(disc.weights, disc.radius) } });
    const g = 2 / W, s = common.metresPerFrameUnit, at = (provider, i, j) => {
      const x = (i + 0.5 - W / 2) * g * s, y = -(j + 0.5 - H / 2) * g * s, l = Math.hypot(x, y, 2);
      return provider.evaluateRadiance({ target: { outgoingDirectionUnitVector: { x: -x / l, y: -y / l, z: -2 / l } }, wavelengthNanometers: nm, sceneId: "s", providerProfileId: "p" })
        .spectralRadianceWattsPerSquareMeterSteradianNanometer;
    };
    let worst = 0, worstOfPeak = 0, sum2 = 0, peak = 0, n = 0;
    const pairs = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const a = at(large, i, j), b = at(direct, i, j); pairs.push([a, b]); peak = Math.max(peak, b); }
    for (const [a, b] of pairs) { const r = Math.abs(a - b) / b; worst = Math.max(worst, r); worstOfPeak = Math.max(worstOfPeak, Math.abs(a - b) / peak); sum2 += r * r; n++; }
    // A compensated (Neumaier) sum of the same products at a few points: which of the two orders is nearer the exact sum.
    let runsVsCompensated = 0, directVsCompensated = 0;
    for (const [i, j] of [[0, 0], [W >> 1, H >> 1], [W - 1, H - 1], [W >> 2, (3 * H) >> 2]]) {
      let sum = 0, c = 0;
      for (let v = -disc.radius; v <= disc.radius; v++) for (let u = -disc.radius; u <= disc.radius; u++) {
        const w = disc.weights[(v + disc.radius) * disc.width + u + disc.radius];
        if (w === 0) continue;
        const term = w * sharp.radianceAt((i - u + 0.5 - W / 2) * g, -(j - v + 0.5 - H / 2) * g, nm), t = sum + term;
        c += Math.abs(sum) >= Math.abs(term) ? (sum - t) + term : (term - t) + sum;
        sum = t;
      }
      const exact = sum + c;
      runsVsCompensated = Math.max(runsVsCompensated, Math.abs(at(large, i, j) - exact) / exact);
      directVsCompensated = Math.max(directVsCompensated, Math.abs(at(direct, i, j) - exact) / exact);
    }
    rows.push({ preset, radius: disc.radius, lattice: W + " × " + H, maxRelative: worst, rmsRelative: Math.sqrt(sum2 / n), maxRelativeToPeak: worstOfPeak, runsVsCompensated, directVsCompensated });
    console.log(JSON.stringify(rows.at(-1)));
  }
}

async function kernel() {
  const { createDefocusDiscSiteKernel } = await import(dist("optics/defocus-disc-kernel.js"));
  const { siteKernelRuns, convolveSiteKernelRuns } = await import(dist("optics/site-kernel-runs.js"));
  const { kernelTaps, gatherInterior } = await import(dist("facade/diffraction-provider.js"));
  for (const radius of radii) {
    const disc = createDefocusDiscSiteKernel(2 * radius + 0.6), R = disc.radius, T = 64, sw = T + 2 * R;
    const source = Float64Array.from({ length: sw * sw }, (_, k) => ((k * 2654435761) >>> 0) / 4294967296);
    const runs = siteKernelRuns(disc.weights, R), taps = kernelTaps(disc.weights, R, sw);
    const time = (f) => { const ms = []; for (let k = 0; k < 3; k++) { const t = performance.now(); f(); ms.push(performance.now() - t); } return ms.sort((a, b) => a - b)[1]; };
    const runsMs = time(() => convolveSiteKernelRuns(source, T, T, runs));
    const directMs = R <= 200 ? time(() => gatherInterior(source, taps, sw, T, T, R)) : null;
    console.log(JSON.stringify({ radius: R, taps: taps.weights.length, runsReadsPerOutput: runs.readsPerOutput, runs: runs.runV.length, singleTaps: runs.tapW.length,
      runsNsPerOutput: 1e6 * runsMs / (T * T), directNsPerOutput: directMs === null ? null : 1e6 * directMs / (T * T), kernelBytes: disc.weights.byteLength,
      tileSourceBytes: sw * sw * 8 * 2 }));
  }
}

async function captureCase(radius) {
  const engine = await import(dist("index.js"));
  const base = { scene: { preset: "siemens-star" }, subjectDistanceM: 2, sensor: { pixelPitchMicrometers: 6 }, output: { width: 1024, height: 683 } };
  await engine.simulateCapture({ ...base, output: { width: 16, height: 16 } });
  const focusDistanceM = radius === 0 ? 2 : focusFor(radius, { f: 50, N: 4, d: 2, pitch: 6 });
  const t = performance.now();
  const r = await engine.simulateCapture({ ...base, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM, defocus: { model: "geometric-disc" } } });
  const seconds = (performance.now() - t) / 1000, value = r.assumptions.find((a) => a.id === "lens.defocus").value;
  return { case: "capture siemens-star 1024x683", radius: value.kernelRadiusSites ?? 0, convolution: value.convolution ?? "direct", seconds, maxRssMiB: rss(),
    tabulated: r.assumptions.some((a) => a.id === "raw.expectedSignal"), node: process.version, load: loadavg()[0] };
}

async function viewCase(radius, count) {
  const engine = await import(dist("index.js"));
  const { appRequestOptions, appParts, sampledParts, APP_VIEW, APP_PART_SIDE } = await import(pathToFileURL(fileURLToPath(new URL("scripts/lib/display-view-app-request.mjs", root))).href);
  // The app's Speed request with an 85 mm-equivalent f/1.4 prime (the widest generic primes; 50 mm f/1.4 at the app's 0.63 m cannot
  // reach radius 512), the subject at 3 m, focused in front of it for a disc of 2R + 0.6 sites.
  const options = appRequestOptions(engine, { options: "speed", fNumber: 1.4 });
  const lens = engine.resolveGenericPrimeLens({ equivalentFocalLengthMm: 85, activeImagingArea: { widthMm: 36, heightMm: 24 } });
  const focusDistanceM = focusFor(radius, { f: lens.focalLengthMm, N: 1.4, d: 3, pitch: 6 });
  if (focusDistanceM < lens.minimumFocusDistanceM) throw new Error("radius " + radius + " out of reach");
  const request = { ...options, subjectDistanceM: 3, lens: { prime: 85, fNumber: 1.4, focusDistanceM, defocus: { model: "geometric-disc" } } };
  let t = performance.now();
  const view = await engine.prepareDisplayView(request);
  const prepareMs = performance.now() - t, parts = sampledParts(appParts(APP_VIEW.width, APP_VIEW.height, APP_PART_SIDE), count), ms = [];
  let kernelRadius = 0;
  for (const region of parts) {
    t = performance.now();
    const result = await view.render({ ...APP_VIEW, region: { x: region.x, y: region.y, width: region.width, height: region.height } });
    ms.push(performance.now() - t);
    kernelRadius = result.assumptions.find((a) => a.id === "view.defocus")?.value?.defocusKernelRadiusSites ?? 0;
  }
  const sorted = [...ms].sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length, all = appParts(APP_VIEW.width, APP_VIEW.height, APP_PART_SIDE).length;
  return { case: "display view, app Speed, 85 mm f/1.4", radius: kernelRadius, prepareMs, parts: ms.length, firstMs: ms[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1),
    wholeViewSecondsExtrapolated: mean * all / 1000, maxRssMiB: rss(), node: process.version, load: loadavg()[0] };
}

if (mode === "--capture-case") console.log(JSON.stringify(await captureCase(Number(rest[0]))));
else if (mode === "--view-case") console.log(JSON.stringify(await viewCase(Number(rest[0]), Number(process.env.PARTS ?? 8))));
else if (mode === "accuracy") await accuracy();
else if (mode === "kernel") await kernel();
else if (mode === "capture" || mode === "view") {
  for (let k = 0; k < repeats; k++) for (const radius of radii) {
    const run = spawnSync(process.execPath, ["--max-old-space-size=6000", fileURLToPath(import.meta.url), mode === "capture" ? "--capture-case" : "--view-case", String(radius)],
      { encoding: "utf8", env: process.env });
    process.stdout.write(run.status === 0 ? run.stdout : JSON.stringify({ radius, error: run.stderr.trim().split("\n").slice(-3).join(" ") }) + "\n");
  }
} else {
  console.error("Usage: node scripts/benchmark-large-defocus.mjs accuracy|kernel|capture|view");
  process.exit(2);
}
