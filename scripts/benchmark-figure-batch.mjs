// SPDX-License-Identifier: Apache-2.0

/**
 * Repository-only benchmark of batch figure renders in Node on the CPU (#670). Informational only: host-dependent, no CI
 * threshold, not run by CI. The hash locks of the same requests (`test/figure-batch-hash-locks.test.mjs`) are the CI part.
 *
 * The set is `scripts/lib/figure-batch-cases.mjs` (the plan's 17 cases and the five the owner added on 2026-11-21), public
 * options only. Every case runs with both flags, the full-quality path (`fast: false`, the one batch figure renders use) first,
 * then the default. A figure's time is the CPU time of the process (user + system), so it stays usable on a loaded machine;
 * compare builds with `pair`, which starts both at the same moment, and rely on ratios, counts and hashes, not on seconds.
 *
 *   node scripts/benchmark-figure-batch.mjs --list
 *   node scripts/benchmark-figure-batch.mjs parts [ids | all]              # part tier: one band or region per case, a process each
 *   node scripts/benchmark-figure-batch.mjs pair <distA> <distB> [ids]     # the part tier on two builds, each pair started together
 *   node scripts/benchmark-figure-batch.mjs whole [ids]                    # whole figures: every band of every file, JOBS workers
 *   node scripts/benchmark-figure-batch.mjs check [ids]                    # determinism checks (below); exits 1 when one fails
 *   node scripts/benchmark-figure-batch.mjs locks [ids]                    # the hash-lock digests of this build, as JSON
 *
 * Per case and flag: CPU s of prepare and of render, wall s, peak RSS (`process.resourceUsage().maxRSS`), the render's own counts
 * (`sampleCount`, `siteEvaluations`, `sceneLookups`; `providerEvaluationCount` for a capture) so a time change can be told from a
 * work change, SHA-256 of `image.samples`, and the engine version, Node version, architecture, commit and load average before and
 * after. Whole figures add the total CPU s, the cheapest and dearest band, wall s at JOBS workers and the SHA-256 of each file
 * joined from its bands; the set total is printed per flag.
 *
 * Whole figures use persistent workers (the recipe of the #670 plan): JOBS processes started once per figure and flag, fed bands
 * from a queue in file order, each keeping one prepared view per request. Bands are BAND_ROWS display rows.
 *
 * Determinism checks (`check`): (a) the part joined from bands of three heights (CHECK_HEIGHTS, default 4,8,16 rows) equals the
 * part rendered in one piece; (b) a second render from a new prepared view gives the same bytes; (c) with EXPECT (a JSONL record
 * written by `parts` with OUT), each hash equals the recorded one of the same engine version and architecture; (d) the Node line
 * is covered by running the script under each supported Node (the children use the same `node`).
 *
 * Environment: DIST (a build's `dist` directory or its `index.js`; default this checkout's, which must be fresh), FLAGS (default
 * "exact,default"; "exact" is `fast: false`), REPEATS (runs per case and flag, the fastest is reported; default 1), JOBS (processes
 * at a time; default 3, whole figures 6), BAND_ROWS (default 128), TIMEOUT (seconds per process, default 1800), PROFILE (a
 * directory: each part also writes a `node --cpu-prof` profile there), OUT (append one JSON line per result to this file),
 * EXPECT (see check (c)).
 *
 * Hash locks for the other architecture: `node scripts/benchmark-figure-batch.mjs locks` prints the digests of this build on
 * this machine's architecture in the form `test/figure-batch-hash-locks.test.mjs` records (see that file).
 */
import console from "node:console";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { fork, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { loadavg } from "node:os";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { FIGURE_CASES, figureCase, figureLockDigests, figureRequest } from "./lib/figure-batch-cases.mjs";

const SELF = fileURLToPath(import.meta.url);
const distIndex = (d) => { const p = resolve(d); return existsSync(p) && statSync(p).isDirectory() ? join(p, "index.js") : p; };
const DEFAULT_DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const cpuSeconds = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1e6; };
const sha = (a) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");
const flagsOf = () => (process.env.FLAGS ?? "exact,default").split(",").map((f) => f.trim()).filter(Boolean);
const flagLabel = (f) => (f === "exact" ? "fast: false" : "default");
const workOf = (r) => (r.kind === "display-view" || r.diagnostics?.siteEvaluations !== undefined
  ? { sampleCount: r.diagnostics.sampleCount, siteEvaluations: r.diagnostics.siteEvaluations, sceneLookups: r.diagnostics.sceneLookups }
  : { providerEvaluationCount: r.diagnostics?.providerEvaluationCount ?? null });

function commitOf(index) {
  const out = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dirname(dirname(index)), encoding: "utf8" });
  return out.status === 0 ? out.stdout.trim() : "unknown";
}
async function loadEngine(index) {
  const engine = await import(pathToFileURL(index).href);
  return { engine, renderWithInternals: (await import(pathToFileURL(join(dirname(index), "facade", "simulate-display-view.js")).href)).renderPreparedDisplayViewWithInternals };
}
function select(names) {
  if (names.length === 0 || names.includes("all")) return FIGURE_CASES;
  return names.map((n) => figureCase(n));
}

// ---------------------------------------------------------------------------------------------------------------------------
// One part in this process (the child of `parts`, `pair` and `check`).

async function renderPart(index, id, flag, region) {
  const { engine } = await loadEngine(index), c = figureCase(id), load0 = loadavg()[0];
  let prepareCpu = 0, renderCpu, wall, result;
  if (c.kind === "view") {
    let t = cpuSeconds();
    const view = await engine.prepareDisplayView(await figureRequest(engine, c, flag), { gpu: "off" });
    prepareCpu = cpuSeconds() - t;
    const options = region ? { ...c.part, region } : c.part, w0 = performance.now();
    t = cpuSeconds(); result = await view.render(options); renderCpu = cpuSeconds() - t; wall = (performance.now() - w0) / 1000;
  } else {
    const request = await figureRequest(engine, c, flag, region ? { region } : {}), w0 = performance.now(), t = cpuSeconds();
    result = await engine.simulateCapture(request); renderCpu = cpuSeconds() - t; wall = (performance.now() - w0) / 1000;
  }
  return { id, flag, engine: engine.ENGINE_API_VERSION, node: process.version, arch: process.arch, prepareCpu: +prepareCpu.toFixed(3), renderCpu: +renderCpu.toFixed(3),
    wall: +wall.toFixed(3), maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024), work: workOf(result), sha256: sha(result.image.samples),
    width: result.image.width, height: result.image.height, fastApplied: result.diagnostics?.fast?.applied ?? null, load: [+load0.toFixed(1), +loadavg()[0].toFixed(1)],
    samples: process.env.FIGURE_RETURN_SAMPLES ? Buffer.from(result.image.samples.buffer, result.image.samples.byteOffset, result.image.samples.byteLength).toString("base64") : undefined };
}

function child(index, id, flag, { region, profileName, returnSamples } = {}) {
  const args = [];
  if (process.env.PROFILE && profileName) args.push("--cpu-prof", "--cpu-prof-dir", resolve(process.env.PROFILE), "--cpu-prof-name", profileName);
  args.push("--max-old-space-size=8000", SELF, "--part", index, id, flag, region ? JSON.stringify(region) : "");
  return new Promise((done) => {
    const p = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...(returnSamples ? { FIGURE_RETURN_SAMPLES: "1" } : {}) } });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), Number(process.env.TIMEOUT ?? 1800) * 1000);
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code, signal) => {
      clearTimeout(timer);
      try { done(JSON.parse(out.trim().split("\n").pop())); } catch { done({ id, flag, error: signal ? `stopped after ${process.env.TIMEOUT ?? 1800} s (${signal})` : err.trim().split("\n").slice(0, 3).join(" ") || `exit ${code}` }); }
    });
  });
}
const pool = async (tasks, jobs, run) => { const queue = [...tasks]; await Promise.all(Array.from({ length: Math.max(1, jobs) }, async () => { while (queue.length) await run(queue.shift()); })); };
const best = (runs) => { const ok = runs.filter((r) => !r.error); return ok.length ? ok.reduce((a, b) => (b.prepareCpu + b.renderCpu < a.prepareCpu + a.renderCpu ? b : a)) : runs[0]; };
const total = (r) => (r && !r.error ? +(r.prepareCpu + r.renderCpu).toFixed(2) : null);
const record = (row) => { if (process.env.OUT) appendFileSync(process.env.OUT, JSON.stringify(row) + "\n"); };
const fmt = (x) => (x === null || x === undefined ? "—" : typeof x === "number" ? x.toFixed(2) : x);

// ---------------------------------------------------------------------------------------------------------------------------

async function parts(names) {
  const index = distIndex(process.env.DIST ?? DEFAULT_DIST), cases = select(names), flags = flagsOf(), repeats = Number(process.env.REPEATS ?? 1);
  if (!process.env.DIST) await import("./require-fresh-dist.mjs");
  const commit = commitOf(index), results = new Map();
  console.error(`parts: ${cases.length} case(s) × ${flags.length} flag(s) × ${repeats}; build ${index} (${commit}); load ${loadavg().map((x) => x.toFixed(1)).join(" ")}`);
  const tasks = []; for (let r = 0; r < repeats; r++) for (const c of cases) for (const f of flags) tasks.push([c.id, f, r]);
  await pool(tasks, Number(process.env.JOBS ?? 3), async ([id, flag, r]) => {
    const out = { ...(await child(index, id, flag, { profileName: `${id}.${flag}.${r}.cpuprofile` })), tier: "part", commit };
    console.error(JSON.stringify(out)); record(out);
    results.set(`${id}/${flag}`, [...(results.get(`${id}/${flag}`) ?? []), out]);
  });
  console.log(`\nBuild ${index} (${commit}), Node ${process.version}, ${process.arch}. CPU s, prepare + render, fastest of ${repeats}.\n`);
  console.log(`| Case | Topic | ${flags.map((f) => `${flagLabel(f)}, CPU s | ${flagLabel(f)}, peak RSS MB`).join(" | ")} |${flags.length === 2 ? " Ratio | Samples equal |" : ""}`);
  console.log(`| --- | --- | ${flags.map(() => "--- | ---").join(" | ")} |${flags.length === 2 ? " --- | --- |" : ""}`);
  for (const c of cases) {
    const rs = flags.map((f) => best(results.get(`${c.id}/${f}`) ?? []));
    const cells = rs.map((r) => (r?.error ? `failed: ${r.error.slice(0, 60)} | —` : `${fmt(total(r))} | ${r?.maxRssMB ?? "—"}`));
    const extra = flags.length === 2 ? ` ${total(rs[0]) && total(rs[1]) ? (total(rs[0]) / total(rs[1])).toFixed(1) + "×" : "—"} | ${rs[0]?.sha256 && rs[1]?.sha256 ? (rs[0].sha256 === rs[1].sha256 ? "yes" : "no") : "—"} |` : "";
    console.log(`| ${c.id} | ${c.topic} | ${cells.join(" | ")} |${extra}`);
  }
  for (const f of flags) {
    const rows = cases.map((c) => best(results.get(`${c.id}/${f}`) ?? [])), sum = rows.reduce((s, r) => s + (total(r) ?? 0), 0), failed = rows.filter((r) => r?.error).length;
    console.log(`\nSet of parts, ${flagLabel(f)}: ${sum.toFixed(1)} CPU s${failed ? ` (${failed} failed, not counted)` : ""}.`);
  }
}

async function pair(distA, distB, names) {
  const a = distIndex(distA), b = distIndex(distB), cases = select(names), flags = flagsOf(), repeats = Number(process.env.REPEATS ?? 1);
  const ca = commitOf(a), cb = commitOf(b), rows = [];
  console.error(`pair: A ${a} (${ca}), B ${b} (${cb}); load ${loadavg().map((x) => x.toFixed(1)).join(" ")}`);
  const tasks = cases.flatMap((c) => flags.map((f) => [c.id, f]));
  await pool(tasks, Number(process.env.JOBS ?? 2), async ([id, flag]) => {
    const ra = [], rb = [];
    for (let r = 0; r < repeats; r++) {
      const [x, y] = await Promise.all([child(a, id, flag), child(b, id, flag)]);
      ra.push(x); rb.push(y);
    }
    const A = best(ra), B = best(rb), row = { tier: "pair", id, flag, a: { ...A, commit: ca }, b: { ...B, commit: cb },
      ratio: total(A) && total(B) ? +(total(B) / total(A)).toFixed(3) : null, samplesEqual: A.sha256 && B.sha256 ? A.sha256 === B.sha256 : null };
    console.error(JSON.stringify({ id, flag, a: total(A), b: total(B), ratio: row.ratio, samplesEqual: row.samplesEqual, error: A.error ?? B.error })); record(row); rows.push(row);
  });
  console.log(`\nA: ${a} (${ca}, ${rows[0]?.a.engine ?? "?"}); B: ${b} (${cb}, ${rows[0]?.b.engine ?? "?"}). CPU s, prepare + render, fastest of ${repeats}; each pair started together.\n`);
  console.log("| Case | Flag | A, CPU s | B, CPU s | B ÷ A | Peak RSS MB, A / B | Samples equal |\n| --- | --- | --- | --- | --- | --- | --- |");
  for (const c of cases) for (const f of flags) {
    const r = rows.find((x) => x.id === c.id && x.flag === f);
    console.log(`| ${c.id} | ${flagLabel(f)} | ${r.a.error ? "failed" : fmt(total(r.a))} | ${r.b.error ? "failed" : fmt(total(r.b))} | ${r.ratio ? r.ratio.toFixed(2) + "×" : "—"} | ${r.a.maxRssMB ?? "—"} / ${r.b.maxRssMB ?? "—"} | ${r.samplesEqual === null ? "—" : r.samplesEqual ? "yes" : "no"} |`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Whole figures with persistent workers.

async function worker() {
  const index = process.argv[3], { engine } = await loadEngine(index), views = new Map();
  process.on("message", async (task) => {
    if (task === "exit") { process.send({ rss: Math.round(process.resourceUsage().maxRSS / 1024) }); process.exit(0); }
    const c = figureCase(task.id), key = `${task.id}/${task.flag}`;
    let prepareCpu = 0;
    if (!views.has(key)) {
      views.clear();
      const t = cpuSeconds(); views.set(key, await engine.prepareDisplayView(await figureRequest(engine, c, task.flag), { gpu: "off" })); prepareCpu = cpuSeconds() - t;
    }
    const t = cpuSeconds(), file = task.file;
    const result = await views.get(key).render({ ...file, region: { x: 0, y: task.y, width: file.width, height: task.rows } });
    const s = result.image.samples;
    process.send({ seq: task.seq, prepareCpu, renderCpu: cpuSeconds() - t, work: workOf(result), bytes: Buffer.from(s.buffer, s.byteOffset, s.byteLength).toString("base64") });
  });
  process.send({ ready: true });
}

async function whole(names) {
  const index = distIndex(process.env.DIST ?? DEFAULT_DIST), flags = flagsOf(), jobs = Number(process.env.JOBS ?? 6), bandRows = Number(process.env.BAND_ROWS ?? 128);
  if (!process.env.DIST) await import("./require-fresh-dist.mjs");
  const cases = select(names).filter((c) => c.kind === "view" && c.files), commit = commitOf(index), version = (await loadEngine(index)).engine.ENGINE_API_VERSION, totals = Object.fromEntries(flags.map((f) => [f, 0]));
  console.error(`whole: ${cases.map((c) => c.id).join(", ")}; ${jobs} workers; bands of ${bandRows} rows; build ${index} (${commit}); load ${loadavg().map((x) => x.toFixed(1)).join(" ")}`);
  console.log("| Figure | Flag | File | Bands | CPU s (cheapest to dearest band) | Figure CPU s | Wall s | Peak RSS MB | SHA-256 of the file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of cases) for (const flag of flags) {
    const tasks = c.files.flatMap((file, f) => Array.from({ length: Math.ceil(file.height / bandRows) }, (_, i) => ({ id: c.id, flag, f, file, y: i * bandRows, rows: Math.min(bandRows, file.height - i * bandRows) })));
    tasks.forEach((t, seq) => { t.seq = seq; });
    const queue = [...tasks], w0 = performance.now(), load0 = loadavg()[0];
    const peaks = await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, () => new Promise((done, fail) => {
      const w = fork(SELF, ["--worker", index], { execArgv: ["--max-old-space-size=8000"], serialization: "advanced" });
      const next = () => { const t = queue.shift(); if (t) w.send(t); else w.send("exit"); };
      w.on("message", (m) => {
        if (m.ready) return next();
        if (m.rss !== undefined) return done(m.rss);
        Object.assign(tasks[m.seq], m); next();
      });
      w.on("exit", (code) => { if (code !== 0) fail(new Error(`worker exit ${code}`)); });
    })));
    const wall = (performance.now() - w0) / 1000, cpu = tasks.reduce((s, t) => s + t.prepareCpu + t.renderCpu, 0);
    totals[flag] += cpu;
    c.files.forEach((file, f) => {
      const mine = tasks.filter((t) => t.f === f), hash = createHash("sha256");
      for (const t of mine) hash.update(Buffer.from(t.bytes, "base64"));
      const band = mine.map((t) => t.renderCpu), fileCpu = mine.reduce((s, t) => s + t.prepareCpu + t.renderCpu, 0), sha256 = hash.digest("hex");
      const row = { tier: "whole", id: c.id, flag, file: `${file.width}x${file.height}`, samplesPerAxis: file.samplesPerAxis, bands: mine.length, bandRows, cpu: +fileCpu.toFixed(2),
        cheapestBand: +Math.min(...band).toFixed(2), dearestBand: +Math.max(...band).toFixed(2), sha256, engine: version, node: process.version, arch: process.arch, commit };
      record(row);
      console.log(`| ${c.id} | ${flagLabel(flag)} | ${row.file}, K = ${file.samplesPerAxis} | ${row.bands} | ${row.cpu.toFixed(1)} (${row.cheapestBand.toFixed(1)} to ${row.dearestBand.toFixed(1)}) | | | | ${sha256.slice(0, 16)}… |`);
    });
    const row = { tier: "whole-figure", id: c.id, flag, engine: version, jobs, cpu: +cpu.toFixed(2), wall: +wall.toFixed(2), peakRssMB: Math.max(...peaks), load: [+load0.toFixed(1), +loadavg()[0].toFixed(1)], node: process.version, arch: process.arch, commit };
    record(row);
    console.log(`| ${c.id} | ${flagLabel(flag)} | figure | ${tasks.length} | | **${cpu.toFixed(1)}** | ${wall.toFixed(1)} (${jobs} workers) | ${row.peakRssMB} | |`);
  }
  for (const f of flags) console.log(`\nSet of whole figures, ${flagLabel(f)}: ${totals[f].toFixed(1)} CPU s.`);
}

// ---------------------------------------------------------------------------------------------------------------------------

async function check(names) {
  const index = distIndex(process.env.DIST ?? DEFAULT_DIST), cases = select(names), flags = flagsOf();
  const heights = (process.env.CHECK_HEIGHTS ?? "4,8,16").split(",").map(Number);
  const expected = process.env.EXPECT ? readFileSync(process.env.EXPECT, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.tier === "part" && !r.error) : [];
  let failures = 0;
  const report = (ok, what) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };
  for (const c of cases) for (const flag of flags) {
    const one = await child(index, c.id, flag, { returnSamples: true });
    if (one.error) { report(false, `${c.id} ${flagLabel(flag)}: ${one.error}`); continue; }
    const again = await child(index, c.id, flag);
    report(again.sha256 === one.sha256, `${c.id} ${flagLabel(flag)}: two runs give the same bytes`);
    const prior = expected.find((r) => r.id === c.id && r.flag === flag && r.engine === one.engine && r.arch === one.arch);
    if (process.env.EXPECT) report(prior ? prior.sha256 === one.sha256 : false, `${c.id} ${flagLabel(flag)}: the hash ${prior ? "equals" : "has no entry in"} ${process.env.EXPECT}`);
    if (c.kind !== "view") continue;
    const part = c.part.region, whole = Buffer.from(one.samples, "base64");
    for (const h of heights.filter((x) => x < part.height)) {
      const pieces = [];
      for (let y = part.y; y < part.y + part.height; y += h) pieces.push(child(index, c.id, flag, { region: { ...part, y, height: Math.min(h, part.y + part.height - y) }, returnSamples: true }));
      const done = await Promise.all(pieces), joined = Buffer.concat(done.map((p) => (p.error ? Buffer.alloc(0) : Buffer.from(p.samples, "base64"))));
      report(joined.equals(whole), `${c.id} ${flagLabel(flag)}: bands of ${h} rows join to the one-piece part`);
    }
  }
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  if (failures) process.exitCode = 1;
}

async function locks(names) {
  const index = distIndex(process.env.DIST ?? DEFAULT_DIST), deps = { ...(await loadEngine(index)), createHash }, out = {};
  if (!process.env.DIST) await import("./require-fresh-dist.mjs");
  for (const c of select(names)) {
    out[c.id] = {};
    for (const flag of ["exact", "default"]) out[c.id][flag] = await figureLockDigests(deps, c, flag);
  }
  console.log(JSON.stringify({ engine: deps.engine.ENGINE_API_VERSION, commit: commitOf(index), node: process.version, arch: process.arch, locks: out }, null, 1));
}

const argv = process.argv.slice(2);
if (argv[0] === "--part") {
  try { console.log(JSON.stringify(await renderPart(argv[1], argv[2], argv[3], argv[4] ? JSON.parse(argv[4]) : undefined))); }
  catch (e) { console.log(JSON.stringify({ id: argv[2], flag: argv[3], error: String(e?.message ?? e).slice(0, 300) })); }
} else if (argv[0] === "--worker") await worker();
else if (argv[0] === "--list" || argv.length === 0) {
  for (const c of FIGURE_CASES) console.log(`${c.id.padEnd(24)} ${c.kind.padEnd(8)} ${c.added ? "(added) " : ""}${c.topic}`);
  console.log("\nCommands: parts, pair <distA> <distB>, whole, check, locks; ids or all.");
} else if (argv[0] === "parts") await parts(argv.slice(1));
else if (argv[0] === "pair") await pair(argv[1], argv[2], argv.slice(3));
else if (argv[0] === "whole") await whole(argv.slice(1));
else if (argv[0] === "check") await check(argv.slice(1));
else if (argv[0] === "locks") await locks(argv.slice(1));
else throw new Error(`Unknown command ${argv[0]}; --list shows the commands.`);
