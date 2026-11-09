// SPDX-License-Identifier: Apache-2.0

/**
 * Repository-only display-view cost measurements (docs/DISPLAY_VIEW.md, "Cost"). Informational only: host-dependent,
 * no CI threshold.
 *
 * Whole-view rows (the 2.6.0 table): `simulateDisplayView` of a whole view against the 2.5 whole-frame view, a
 * `simulateCapture` at pitch = sensor width ÷ view width, which no caller renders any more and is kept as a historical
 * baseline. One fresh Node process per row, a 16 × 16 warm-up capture, then REPEATS timed runs of each (median).
 * Environment: REPEATS (default 1), ROWS (comma-separated subset of row ids).
 *
 *   node scripts/benchmark-display-view.mjs
 *
 * App-request rows (`--app`, #454): the request shape of an interactive viewer that renders a device-pixel view of a
 * 24 MP frame in parts. A 6 µm 6000 × 4000 sensor with the 2 × 2 box pixel aperture, a caller material scene (a composite
 * chart with a stand-in printed label), a 2028 × 1352 view prepared once with `prepareDisplayView` and rendered in
 * 96 × 96 parts, centre first; every k-th part of that order is timed (PARTS of them). At 2028 wide a display pixel covers
 * about 2.96 × 2.96 real pixels, so every part takes the exact area mean. One fresh Node process per row, build and
 * repeat; with a second build (DIST_B) the two run interleaved, the order alternating per repeat (A B, B A, ...).
 * Environment: REPEATS (default 2), PARTS (default 30), ROWS (subset of app row ids; rows 4 and 5, f/2.8, run only when
 * named), DIST_B (path to another build's
 * `dist/index.js`; default: this checkout's `dist`), DEFOCUS_RADII (#492: comma-separated defocus kernel radii in sites,
 * default "0"; 0 is the request without `lens.defocus`, R > 0 adds `lens.defocus` with the focus distance that gives a
 * disc of 2R + 0.6 sites, so its kernel radius is R; the radii of one repeat run interleaved, their order alternating).
 *
 *   node scripts/benchmark-display-view.mjs --app
 *   DIST_B=/path/to/other/dist/index.js node scripts/benchmark-display-view.mjs --app
 * LENS (#563: comma-separated lens variants, default "none"): "vignetting" (a radial relative-illumination profile, about −1 stop at
 * the frame's corner), "distortion" (barrel distortion plus that vignetting), "fisheye" (an equisolid-angle projection) and
 * "rotation" (camera shake at 0.05 rad/s yaw and 0.03 pitch, the default eight temporal midpoints); they run interleaved like the radii.
 * #569: "catalogue:<lens id>" replaces the prime with that catalogue lens at the row's f-number (clamped to the lens's range), and
 * "catalogue:<lens id>:open" at its widest, "catalogue:<lens id>:<f-number>" at that f-number; `lens.diffraction` is dropped (the lens's PSF includes it) and the shutter keeps the row's exposure (at most 1/8000 s faster).
 *
 *   node scripts/benchmark-display-view.mjs --app
 *   DIST_B=/path/to/other/dist/index.js node scripts/benchmark-display-view.mjs --app
 *   DEFOCUS_RADII=0,4,8,16,32 node scripts/benchmark-display-view.mjs --app
 *   LENS=none,vignetting,distortion,fisheye,rotation node scripts/benchmark-display-view.mjs --app
 */
import "./require-fresh-dist.mjs";
import console from "node:console";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { NATIVE_RAW_LIMITS, simulateCapture, simulateDisplayView } from "../dist/index.js";
// The app request shape, chart, stand-in label and parts are shared with the preview acceptance harness (#480).
import { APP_VIEW, APP_PART_SIDE, appRequestOptions, appParts, sampledParts } from "./lib/display-view-app-request.mjs";
export { APP_VIEW, APP_PART_SIDE, APP_CHART, labelInk, appRequestOptions, appParts, sampledParts } from "./lib/display-view-app-request.mjs";

const SENSORS = { ff: { width: 6000, height: 4000, pitch: 6 }, phone: { width: 4000, height: 3000, pitch: 1.4 }, mf: { width: 11648, height: 8736, pitch: 3.76 } };
const rows = [];
for (const preset of ["siemens-star", "dead-leaves"]) for (const sensor of ["ff", "phone", "mf"]) for (const options of ["speed", "quality"]) for (const width of [96, 192, 384, 800]) {
  if (preset === "dead-leaves" && width !== 384) continue;
  rows.push({ id: rows.length, preset, sensor, options, width });
}
const repeats = Number(process.env.REPEATS ?? 1);
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function measure(row) {
  const s = SENSORS[row.sensor], quality = row.options === "quality", height = Math.round(row.width * s.height / s.width);
  const lens = { prime: 50, fNumber: 8, ...(quality ? { diffraction: "circular-aperture" } : {}) }, aa = quality ? { antiAliasing: { kind: "four-spot" } } : {};
  const demosaic = quality ? { demosaic: "ahd" } : {}, scene = { preset: row.preset };
  await simulateCapture({ scene, output: { width: 16, height: 16 } });
  const viewTimes = [], wholeTimes = [];
  let samples = 0;
  for (let r = 0; r < repeats; r++) {
    let t = performance.now();
    const view = await simulateDisplayView({ scene, lens, sensor: { pixelPitchMicrometers: s.pitch, ...aa }, output: { width: s.width, height: s.height, maximumPixels: NATIVE_RAW_LIMITS.ceilingPixels, ...demosaic } },
      { width: row.width, height });
    viewTimes.push(performance.now() - t); samples = view.diagnostics.sampleCount;
    t = performance.now();
    await simulateCapture({ scene, lens, sensor: { pixelPitchMicrometers: s.width * s.pitch / row.width, ...aa }, output: { width: row.width, height, ...demosaic } });
    wholeTimes.push(performance.now() - t);
  }
  return { ...row, height, viewSeconds: median(viewTimes) / 1000, wholeFrameSeconds: median(wholeTimes) / 1000, samples };
}

// ---- App-request rows (#454) ----

export const APP_ROWS = [];
for (const options of ["speed", "quality"]) for (const fNumber of [8, 11]) APP_ROWS.push({ id: APP_ROWS.length, options, fNumber });
// #492: f/2.8 rows (4 Speed, 5 Quality), run only when ROWS names them, reach defocus radii up to 64 sites in this geometry.
for (const options of ["speed", "quality"]) APP_ROWS.push({ id: APP_ROWS.length, options, fNumber: 2.8, optIn: true });

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const commit = () => { const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) }); return r.status === 0 ? r.stdout.trim() : "unknown"; };

/**
 * The app request with `lens.defocus` at a disc of 2R + 0.6 sites (kernel radius R): the thin-lens focus distance s with
 * c = f²·|s − d| / (N·d·(s − f)) (`calculateDefocusCircle`) solved for s, in front of the subject when the generic prime
 * focuses that close (s = d·(f² + cNf)/(cNd + f²)), else behind it (s = d·(cNf − f²)/(cNd − f²)). R = 0: the request as is.
 */
function withDefocusRadius(engine, options, radius) {
  if (radius === 0) return options;
  const output = options.output, pitch = options.sensor.pixelPitchMicrometers;
  const lens = engine.resolveGenericPrimeLens({ equivalentFocalLengthMm: options.lens.prime, activeImagingArea: { widthMm: output.width * pitch / 1000, heightMm: output.height * pitch / 1000 } });
  const f = lens.focalLengthMm, N = options.lens.fNumber, d = options.subjectDistanceM * 1000, c = (2 * radius + 0.6) * pitch / 1000;
  let s = d * (f * f + c * N * f) / (c * N * d + f * f);
  if (s / 1000 < lens.minimumFocusDistanceM) {
    if (c * N * d <= f * f) throw new Error(`a defocus radius of ${radius} sites is out of reach at f/${N}`);
    s = d * (c * N * f - f * f) / (c * N * d - f * f);
  }
  return { ...options, lens: { ...options.lens, focusDistanceM: s / 1000, defocus: { model: "geometric-disc" } } };
}

/** #563: the app request with a lens variant (see LENS above); the profiles reach 10 % beyond the 36 × 24 mm frame's half diagonal. */
function withLens(engine, options, variant) {
  const vignetting = { normalizationRadiusMm: 21.7, maximumNormalizedRadius: 1.1, coefficients: { r2: -0.5, r4: 0, r6: 0 } };
  if (variant === "none") return options;
  if (variant === "vignetting") return { ...options, lens: { ...options.lens, vignetting } };
  if (variant === "distortion") return { ...options, lens: { ...options.lens, vignetting,
    distortion: { kind: "radial", profile: { normalizationRadiusMm: 21.7, maximumNormalizedRadius: 1.1, coefficients: { k1: -0.05, k2: 0.005, k3: 0 } } } } };
  if (variant === "fisheye") return { ...options, lens: { ...options.lens, projection: "fisheye-equisolid-angle" } };
  if (variant === "rotation") return { ...options, motion: { angularVelocityRadPerSec: { yaw: 0.05, pitch: 0.03 } } };
  if (variant.startsWith("catalogue:")) {
    const [, lensId, open] = variant.split(":"), entry = engine.GENERIC_LENS_CATALOGUE.find((l) => l.lensId === lensId);
    if (!entry) throw new Error(`unknown catalogue lens ${lensId}`);
    const narrowest = engine.resolveGenericLens({ lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } }).narrowestFNumber;
    const fNumber = open === "open" ? entry.widestFNumber : Math.min(narrowest, Math.max(entry.widestFNumber, open === undefined ? options.lens.fNumber : Number(open)));
    return { ...options, lens: { catalogue: lensId, fNumber }, exposure: { ...options.exposure, shutterSeconds: Math.max(1 / 8000, options.exposure.shutterSeconds * (fNumber / options.lens.fNumber) ** 2) } };
  }
  throw new Error(`unknown lens variant ${variant}`);
}

async function appRow(id, distPath, count, radius = 0, lensVariant = "none") {
  const engine = await import(pathToFileURL(distPath).href), row = APP_ROWS[id], load = loadavg()[0];
  const options = withLens(engine, withDefocusRadius(engine, appRequestOptions(engine, row), radius), lensVariant), parts = appParts(APP_VIEW.width, APP_VIEW.height, APP_PART_SIDE), timed = sampledParts(parts, count);
  let t = performance.now();
  const view = await engine.prepareDisplayView(options);
  const prepareMs = performance.now() - t, ms = [], usPerPixel = [], estimation = new Set();
  let defocusKernelRadius = 0;
  let ahdCorrected = 0;
  for (const region of timed) {
    t = performance.now();
    const result = await view.render({ ...APP_VIEW, region: { x: region.x, y: region.y, width: region.width, height: region.height } });
    const elapsed = performance.now() - t;
    ms.push(elapsed); usPerPixel.push(1000 * elapsed / (region.width * region.height));
    ahdCorrected = Math.max(ahdCorrected, result.diagnostics.ahdCorrectedPixelCount);
    estimation.add(result.assumptions.find((a) => a.id === "view.estimation")?.value?.method ?? "unknown");
    defocusKernelRadius = result.assumptions.find((a) => a.id === "view.defocus")?.value?.kernelRadiusSites ?? 0;
  }
  const sortedMs = [...ms].sort((a, b) => a - b), sortedUs = [...usPerPixel].sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return { ...row, lens: lensVariant, defocusRadius: radius, kernelRadius: defocusKernelRadius, focusDistanceM: options.lens.focusDistanceM ?? null, dist: distPath, prepareMs, parts: ms.length, of: parts.length, firstMs: ms[0], medianMs: quantile(sortedMs, 0.5), maxMs: sortedMs.at(-1),
    usPerPixel: { min: sortedUs[0], median: quantile(sortedUs, 0.5), max: sortedUs.at(-1) }, wholeViewCpuSecondsExtrapolated: mean * parts.length / 1000,
    estimation: [...estimation], ahdCorrectedPixelCount: ahdCorrected, loadAverage: load, node: process.version, commit: commit() };
}

async function appRequest() {
  const argv = process.argv, count = Number(process.env.PARTS ?? 30);
  const child = argv.indexOf("--app-row");
  if (child >= 0) { console.log(JSON.stringify(await appRow(Number(argv[child + 1]), argv[argv.indexOf("--dist") + 1], count, Number(argv[argv.indexOf("--defocus-radius") + 1] ?? 0),
    argv[argv.indexOf("--lens") + 1] ?? "none"))); return; }
  const a = fileURLToPath(new URL("../dist/index.js", import.meta.url)), b = process.env.DIST_B, builds = b ? [["A", a], ["B", b]] : [["A", a]];
  const repeats = Number(process.env.REPEATS ?? 2), selected = process.env.ROWS ? process.env.ROWS.split(",").map(Number) : APP_ROWS.filter((r) => !r.optIn).map((r) => r.id), results = [];
  const radii = (process.env.DEFOCUS_RADII ?? "0").split(",").map(Number), lenses = (process.env.LENS ?? "none").split(",");
  const variants = radii.flatMap((radius) => lenses.map((lens) => ({ radius, lens })));
  console.error(`app-request rows: ${selected.length} × ${radii.length} defocus radii × ${lenses.length} lens variant(s) × ${builds.length} build(s) × ${repeats} repeat(s), ${count} parts each; A = ${a}${b ? `, B = ${b}` : ""}`);
  for (const id of selected) for (let r = 0; r < repeats; r++) for (const { radius, lens } of r % 2 === 0 ? variants : [...variants].reverse()) for (const [label, dist] of r % 2 === 0 ? builds : [...builds].reverse()) {
    const run = spawnSync(process.execPath, ["--max-old-space-size=6000", argv[1], "--app-row", String(id), "--dist", dist, "--defocus-radius", String(radius), "--lens", lens],
      { encoding: "utf8", env: { ...process.env, PARTS: String(count) } });
    if (run.status !== 0) { console.error(`app row ${id} (${label}, defocus radius ${radius}, lens ${lens}) failed:\n${run.stderr}`); continue; }
    const result = { build: label, repeat: r, ...JSON.parse(run.stdout.trim().split("\n").pop()) };
    results.push(result); console.log(JSON.stringify(result));
  }
  if (!results.length) { process.exitCode = 1; return; }
  const range = (values, digits = 0) => { const lo = Math.min(...values), hi = Math.max(...values); return lo.toFixed(digits) === hi.toFixed(digits) ? lo.toFixed(digits) : `${lo.toFixed(digits)}–${hi.toFixed(digits)}`; };
  console.log("");
  console.log("| Options | f | Lens | Defocus radius (view kernel radius) | Build | Prepare | Part median | Part max | µs per display pixel, median (min–max) | Whole view CPU, extrapolated | Estimation | AHD-corrected pixels |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const id of selected) for (const { radius, lens } of variants) for (const [label] of builds) {
    const rs = results.filter((r) => r.id === id && r.build === label && r.defocusRadius === radius && r.lens === lens);
    if (!rs.length) continue;
    const row = APP_ROWS[id];
    console.log(`| ${row.options === "speed" ? "Speed" : "Quality"} | f/${row.fNumber} | ${lens} | ${radius === 0 ? "none" : `${radius} (${rs[0].kernelRadius}) sites`} | ${label} | ${range(rs.map((r) => r.prepareMs))} ms | ${range(rs.map((r) => r.medianMs))} ms | ${range(rs.map((r) => r.maxMs))} ms | ` +
      `${range(rs.map((r) => r.usPerPixel.median), 1)} (${Math.min(...rs.map((r) => r.usPerPixel.min)).toFixed(1)}–${Math.max(...rs.map((r) => r.usPerPixel.max)).toFixed(1)}) | ${range(rs.map((r) => r.wholeViewCpuSecondsExtrapolated), 1)} s from ${rs[0].parts} of ${rs[0].of} parts | ` +
      `${[...new Set(rs.flatMap((r) => r.estimation))].join(", ")} | ${Math.max(...rs.map((r) => r.ahdCorrectedPixelCount))} |`);
  }
  console.log("");
  console.log(`Node ${process.version}, commit ${results[0]?.commit ?? "unknown"}, load average ${range(results.map((r) => r.loadAverage), 1)}, ${repeats} repeat(s) per build; whole-view CPU is extrapolated from the sampled parts, not measured.`);
}

const one = process.argv.indexOf("--row");
if (process.argv.includes("--app") || process.argv.includes("--app-row")) await appRequest();
else if (one >= 0) console.log(JSON.stringify(await measure(rows[Number(process.argv[one + 1])])));
else {
  const selected = process.env.ROWS ? process.env.ROWS.split(",").map(Number) : rows.map((r) => r.id);
  console.log("| Chart | Sensor | Options | View | Display view | Whole-frame view (2.5, historical baseline) | Ratio |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");
  for (const id of selected) {
    const run = spawnSync(process.execPath, ["--max-old-space-size=6000", process.argv[1], "--row", String(id)], { encoding: "utf8" });
    if (run.status !== 0) { console.log(`| row ${id} failed: ${run.stderr.split("\n")[0]} |`); continue; }
    const r = JSON.parse(run.stdout.trim().split("\n").pop());
    console.log(`| ${r.preset} | ${r.sensor} | ${r.options} | ${r.width} × ${r.height} | ${r.viewSeconds.toFixed(1)} s | ${r.wholeFrameSeconds.toFixed(1)} s | ${(r.viewSeconds / r.wholeFrameSeconds).toFixed(2)}× |`);
  }
}
