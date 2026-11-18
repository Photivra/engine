// SPDX-License-Identifier: Apache-2.0

/**
 * Repository-only display-view cost cases of the 2.27.0 plan (#649, #651, #653, #655, #656). Informational only:
 * host-dependent, no CI threshold.
 *
 * Each case runs in its own Node process: `prepareDisplayView(request, { gpu: "off" })`, then one `render(view)`. The
 * figure is the CPU time of the process for that one render (`process.cpuUsage`, user + system), so the result is an upper
 * bound that stays usable on a loaded machine; ratios between cases of one group are the measure. Wall time, the load
 * average before and after, and what the render reported (estimation method, defocus kernel radius) are recorded beside it.
 *
 * Common request, unless a case says otherwise: a 6000 × 4000 sensor of 6 µm sites, the composite chart `APP_CHART` of
 * `scripts/lib/display-view-app-request.mjs`, `subjectDistanceM: 2`, `output.format: "srgb-8"`, the fast defaults.
 *
 *   node scripts/benchmark-display-view-cases.mjs --list            # the cases and groups
 *   node scripts/benchmark-display-view-cases.mjs 656               # one group (649, 651, 653, 655, 656) or one case id
 *   node scripts/benchmark-display-view-cases.mjs 649 656-none      # several
 *   node scripts/benchmark-display-view-cases.mjs all
 *
 * Environment: JOBS (processes at a time, default 3), REPEATS (runs per case, default 1; the table shows the fastest and
 * the range), DIST (another build's `dist/index.js` to time instead of this checkout's), PROFILE (a directory: each case
 * also writes a `node --cpu-prof` profile there).
 */
import console from "node:console";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { APP_CHART } from "./lib/display-view-app-request.mjs";

const PART = { width: 1500, height: 1000, region: { x: 702, y: 452, width: 96, height: 96 } };
const base = (engine) => ({ scene: APP_CHART, subjectDistanceM: 2,
  sensor: { pixelPitchMicrometers: 6 },
  output: { width: 6000, height: 4000, format: "srgb-8", maximumPixels: engine.NATIVE_RAW_LIMITS.ceilingPixels } });
const merge = (request, { lens, sensor, output, ...rest }) => ({ ...request, ...rest,
  ...(lens ? { lens } : {}), sensor: { ...request.sensor, ...sensor }, output: { ...request.output, ...output } });

// #651: the rotation case. Defocus focuses at 0.8 × the subject distance (disc radius 11 sites).
const ROTATION = { subjectDistanceM: 0.63, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 125 } };
const rotation = (shutter) => ({ motion: { angularVelocityRadPerSec: { yaw: 0.0766 }, shutter } });
const prime50 = { prime: 50, fNumber: 8 };
const defocused50 = { ...prime50, focusDistanceM: 0.8 * 0.63, defocus: { model: "geometric-disc" } };
const VIEW_651 = (width, height) => ({ width: 1194, height: 796, region: { x: 501, y: 334, width, height } });

// #653: the Quality options; the shutter keeps the exposure of 1/125 s at f/8.
const quality = (lens) => ({ lens: { ...lens, diffraction: "circular-aperture" }, exposure: { mode: "manual", iso: 100, shutterSeconds: (1 / 125) * (lens.fNumber / 8) ** 2 },
  sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: { kind: "box", samplesPerAxis: 2 } }, output: { demosaic: "ahd" } });
const BAND = (rows) => ({ width: 768, height: 512, region: { x: 0, y: 213, width: 768, height: rows } });

// #655: the catalogue lens against the prime, whole views.
const catalogue = { catalogue: "pv-50-1.2-pro", fNumber: 8 };
const BOX = { pixelAperture: { kind: "box", samplesPerAxis: 2 } };

// #656: develop options (Standard is STANDARD_LOOK, Recover `highlightMode: "reconstruct"`, the push one stop).
const develop = (engine, { standard, recover, push }) => ({ lens: prime50, output: {
  ...(standard ? { toneCurve: engine.STANDARD_LOOK.toneCurve, toneCurveParameters: engine.STANDARD_LOOK.toneCurveParameters } : {}),
  ...(recover ? { highlightMode: "reconstruct" } : {}), ...(push ? { exposureCompensationStops: 1 } : {}) } });

/** Case id → { group, label, request(engine), view, reference (the case the group's ratio divides by) }. */
export const CASES = [
  { id: "649-plain", group: "649", label: "No corrections", request: () => ({ lens: catalogue }), view: PART },
  { id: "649-corrections", group: "649", label: "`output.lensCorrections` (distortion, lateral color, vignetting)",
    request: () => ({ lens: catalogue, output: { lensCorrections: { distortion: true, lateralColor: true, vignetting: true } } }), view: PART },
  { id: "649-sharpening", group: "649", label: "`output.sharpening: { radiusPixels: 1, amount: 1 }`",
    request: () => ({ lens: catalogue, output: { sharpening: { radiusPixels: 1, amount: 1 } } }), view: PART },
  { id: "649-both", group: "649", label: "Corrections and sharpening",
    request: () => ({ lens: catalogue, output: { lensCorrections: { distortion: true, lateralColor: true, vignetting: true }, sharpening: { radiusPixels: 1, amount: 1 } } }), view: PART },

  { id: "651-still", group: "651", label: "No motion, in focus, 48 × 32", request: () => ({ ...ROTATION, lens: prime50 }), view: VIEW_651(48, 32) },
  { id: "651-rolling", group: "651", label: "Rotation, rolling, in focus, 48 × 32", request: () => ({ ...ROTATION, ...rotation("rolling"), lens: prime50 }), view: VIEW_651(48, 32) },
  { id: "651-rolling-defocus", group: "651", label: "Rotation, rolling, out of focus, 48 × 32", request: () => ({ ...ROTATION, ...rotation("rolling"), lens: defocused50 }), view: VIEW_651(48, 32) },
  { id: "651-rolling-defocus-small", group: "651", label: "Rotation, rolling, out of focus, 24 × 16", request: () => ({ ...ROTATION, ...rotation("rolling"), lens: defocused50 }), view: VIEW_651(24, 16) },
  { id: "651-global-defocus-small", group: "651", label: "Rotation, global, out of focus, 24 × 16", request: () => ({ ...ROTATION, ...rotation("global"), lens: defocused50 }), view: VIEW_651(24, 16) },
  { id: "651-still-defocus-small", group: "651", label: "No motion, out of focus, 24 × 16", request: () => ({ ...ROTATION, lens: defocused50 }), view: VIEW_651(24, 16) },

  { id: "653-near", group: "653", label: "50 mm f/2, focus 0.8 × the subject distance, 768 × 43 band",
    request: () => quality({ prime: 50, fNumber: 2, focusDistanceM: 1.6, defocus: { model: "geometric-disc" } }), view: BAND(43) },
  { id: "653-far", group: "653", label: "50 mm f/2, focus 1.25 × the subject distance, 768 × 43 band",
    request: () => quality({ prime: 50, fNumber: 2, focusDistanceM: 2.5, defocus: { model: "geometric-disc" } }), view: BAND(43) },
  { id: "653-200mm", group: "653", label: "200 mm f/8, in focus, 768 × 43 band", request: () => quality({ prime: 200, fNumber: 8 }), view: BAND(43) },
  { id: "653-near-4", group: "653", label: "50 mm f/2, focus 0.8 ×, 768 × 4 band",
    request: () => quality({ prime: 50, fNumber: 2, focusDistanceM: 1.6, defocus: { model: "geometric-disc" } }), view: BAND(4) },

  { id: "655-prime-192", group: "655", label: "Prime, 192 × 128, point", request: () => ({ lens: prime50 }), view: { width: 192, height: 128 } },
  { id: "655-catalogue-192", group: "655", label: "Catalogue, 192 × 128, point", request: () => ({ lens: catalogue }), view: { width: 192, height: 128 }, reference: "655-prime-192" },
  { id: "655-prime-96", group: "655", label: "Prime, 96 × 64, point", request: () => ({ lens: prime50 }), view: { width: 96, height: 64 } },
  { id: "655-catalogue-96", group: "655", label: "Catalogue, 96 × 64, point", request: () => ({ lens: catalogue }), view: { width: 96, height: 64 }, reference: "655-prime-96" },
  { id: "655-prime-96-box", group: "655", label: "Prime, 96 × 64, 2 × 2 box", request: () => ({ lens: prime50, sensor: BOX }), view: { width: 96, height: 64 } },
  { id: "655-catalogue-96-box", group: "655", label: "Catalogue, 96 × 64, 2 × 2 box", request: () => ({ lens: catalogue, sensor: BOX }), view: { width: 96, height: 64 }, reference: "655-prime-96-box" },

  ...[["none", {}], ["recover", { recover: true }], ["push", { push: true }], ["standard", { standard: true }],
    ["standard-recover", { standard: true, recover: true }], ["standard-push", { standard: true, push: true }],
    ["recover-push", { recover: true, push: true }], ["standard-recover-push", { standard: true, recover: true, push: true }]].map(([name, options]) => ({
    id: `656-${name}`, group: "656", label: name === "none" ? "None" : name.split("-").map((w) => ({ standard: "Standard", recover: "Recover", push: "+1 stop" })[w]).join(", "),
    request: (engine) => develop(engine, options), view: PART }))
];
const GROUP_REFERENCE = { 649: "649-plain", 651: "651-rolling", 653: "653-200mm", 656: "656-none" };

/** The plan's baseline (November 17, 2026, 2.26.0 at 94f56f3), CPU seconds per case. */
export const PLAN_BASELINE = { "649-plain": 1.26, "649-corrections": 3.26, "649-sharpening": 2.75, "649-both": 7.29,
  "651-still": 0.26, "651-rolling": 0.51, "651-rolling-defocus": 19.96, "651-rolling-defocus-small": 5.75, "651-global-defocus-small": 2.40, "651-still-defocus-small": 0.43,
  "653-near": 36.05, "653-far": 35.91, "653-200mm": 7.86, "653-near-4": 6.26,
  "655-prime-192": 3.87, "655-catalogue-192": 58.74, "655-prime-96": 2.57, "655-catalogue-96": 41.60, "655-prime-96-box": 3.43, "655-catalogue-96-box": 127.61,
  "656-none": 0.40, "656-recover": 0.38, "656-push": 0.28, "656-standard": 0.53, "656-standard-recover": 0.62, "656-standard-push": 0.61, "656-recover-push": 1.76, "656-standard-recover-push": 2.71 };

const referenceOf = (c) => c.reference ?? GROUP_REFERENCE[c.group] ?? c.id;
const defaultDist = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function runCase(id, distPath) {
  const engine = await import(pathToFileURL(distPath).href), c = CASES.find((k) => k.id === id);
  const request = merge(base(engine), c.request(engine)), loadBefore = loadavg()[0];
  const view = await engine.prepareDisplayView(request, { gpu: "off" });
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  const result = await view.render(c.view);
  const wallSeconds = (performance.now() - t0) / 1000, cpu = process.cpuUsage(cpu0);
  const assumption = (key) => result.assumptions.find((a) => a.id === key)?.value;
  return { id, cpuSeconds: (cpu.user + cpu.system) / 1e6, wallSeconds, loadBefore, loadAfter: loadavg()[0],
    estimation: assumption("view.estimation")?.method ?? null, defocusKernelRadiusSites: assumption("view.defocus")?.kernelRadiusSites ?? null,
    backend: result.diagnostics?.backend ?? null, node: process.version };
}

function child(id, distPath) {
  const args = [];
  if (process.env.PROFILE) args.push("--cpu-prof", "--cpu-prof-dir", resolve(process.env.PROFILE), "--cpu-prof-name", `${id}.cpuprofile`);
  args.push("--max-old-space-size=8000", fileURLToPath(import.meta.url), "--case", id, "--dist", distPath);
  return new Promise((done) => {
    const proc = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.stderr.on("data", (d) => { err += d; });
    proc.on("close", (code) => done(code === 0 ? JSON.parse(out.trim().split("\n").pop()) : { id, error: err.trim().split("\n").slice(0, 4).join(" ") }));
  });
}

async function main() {
  const argv = process.argv.slice(2), caseFlag = argv.indexOf("--case");
  if (caseFlag >= 0) { console.log(JSON.stringify(await runCase(argv[caseFlag + 1], argv[argv.indexOf("--dist") + 1]))); return; }
  if (argv.includes("--list") || argv.length === 0) {
    for (const c of CASES) console.log(`${c.id.padEnd(28)} ${c.label}`);
    console.log("\nGroups: 649, 651, 653, 655, 656, all.");
    return;
  }
  const dist = resolve(process.env.DIST ?? defaultDist);
  if (!process.env.DIST) await import("./require-fresh-dist.mjs");
  const wanted = new Set();
  for (const name of argv) {
    const matched = name === "all" ? CASES : CASES.filter((c) => c.group === name || c.id === name);
    if (!matched.length) throw new Error(`Unknown case or group ${name}; --list shows them.`);
    for (const c of matched) { wanted.add(c.id); wanted.add(referenceOf(c)); }
  }
  const ids = CASES.map((c) => c.id).filter((id) => wanted.has(id)), repeats = Number(process.env.REPEATS ?? 1), jobs = Math.max(1, Number(process.env.JOBS ?? 3));
  const queue = []; for (let r = 0; r < repeats; r++) queue.push(...(r % 2 === 0 ? ids : [...ids].reverse()));
  const results = new Map(ids.map((id) => [id, []]));
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) }).stdout?.trim() || "unknown";
  console.error(`${ids.length} case(s) × ${repeats} repeat(s), ${jobs} at a time; build ${dist}`);
  const worker = async () => { while (queue.length) { const id = queue.shift(), r = await child(id, dist); console.error(JSON.stringify(r)); results.get(id).push(r); } };
  await Promise.all(Array.from({ length: jobs }, worker));

  const best = (id) => { const ok = results.get(id).filter((r) => !r.error); return ok.length ? Math.min(...ok.map((r) => r.cpuSeconds)) : NaN; };
  const range = (id) => { const ok = results.get(id).filter((r) => !r.error).map((r) => r.cpuSeconds); return ok.length > 1 ? ` (${Math.min(...ok).toFixed(2)}–${Math.max(...ok).toFixed(2)})` : ""; };
  const loads = [...results.values()].flat().filter((r) => !r.error).flatMap((r) => [r.loadBefore, r.loadAfter]);
  console.log("| Case | Request | CPU time, s | Ratio | Plan: CPU time, s | Plan: ratio | Ratio against the plan's | Estimation | Defocus kernel radius |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const id of ids) {
    const c = CASES.find((k) => k.id === id), ref = referenceOf(c), failed = results.get(id).find((r) => r.error);
    if (failed && !results.get(id).some((r) => !r.error)) { console.log(`| ${id} | ${c.label} | failed: ${failed.error} | | | | | | |`); continue; }
    const ratio = best(id) / best(ref), planRatio = PLAN_BASELINE[id] / PLAN_BASELINE[ref], r = results.get(id).find((k) => !k.error);
    console.log(`| ${id} | ${c.label} | ${best(id).toFixed(2)}${range(id)} | ${ratio.toFixed(2)}× | ${PLAN_BASELINE[id].toFixed(2)} | ${planRatio.toFixed(2)}× | ` +
      `${(ratio / planRatio).toFixed(2)} | ${r.estimation ?? ""} | ${r.defocusKernelRadiusSites ?? ""} |`);
  }
  console.log(`\nCPU time of the process for one render (user + system), the fastest of ${repeats} run(s). Ratio: against ${[...new Set(ids.map((id) => referenceOf(CASES.find((c) => c.id === id))))].join(", ")} of the same group ` +
    `(the catalogue rows of 655 against their prime). Node ${process.version}, commit ${commit}, ${jobs} process(es) at a time, load average ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)}.`);
}

await main();
