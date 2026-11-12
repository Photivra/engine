// SPDX-License-Identifier: Apache-2.0

/**
 * Preview acceptance harness (#480; the gate of the GPU preview kernels #478 and #479, part of #473): renders the app's
 * display-view request with a "reference" producer and a "candidate" producer and compares their noise-free expected
 * images per pixel, in ΔE2000 and in units of the reference's noise σ, against the thresholds of #473. The reference is the
 * CPU display view (`scripts/lib/display-view-cpu-producer.mjs`). The candidate is:
 *
 * - with `--gpu`, the GPU (`scripts/lib/display-view-gpu-producer.mjs`): the request rendered in headless Chromium through
 *   `prepareDisplayView(request, { gpu: "require", gpuDevice })` on the built engine, SwiftShader by default, a hardware
 *   adapter with `--hardware` (which sets PHOTIVRA_WEBGPU_ADAPTER=hardware and PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1, as
 *   `npm run test:webgpu:hardware` does). Every candidate render must carry `backend: "webgpu-f32"`, no fallback reason, a passed
 *   conformance self-check and an error bound (and with `--hardware` a hardware adapter), or the case fails: the run never
 *   compares the CPU with itself by accident;
 * - otherwise the CPU display view again (the self-check, which must show exact equality), or `--candidate` another producer
 *   module (its contract is documented in the CPU producer).
 *
 *   node scripts/accept-display-view-gpu.mjs [--gpu [--hardware] [--repeat 1]] [--candidate path/to/producer.mjs]
 *       [--sizes 2028x1352,2800x1867] [--charts app,slanted-edge,siemens-star,bar-groups,dead-leaves,step-wedge]
 *       [--options speed,quality] [--scene material-layers|material-function] [--region x,y,width,height] [--reference browser|node] [--f 8]
 *       [--workers 1] [--out display-view-acceptance] [--gain 16] [--within-de 1] [--within-fraction 0.99] [--max-de 2.3]
 *       [--max-sigma 1] [--timing] [--parts 30] [--record <name>] [--record-images]
 *
 * Cases: the app's composite chart (`app`, `APP_CHART` of `scripts/lib/display-view-app-request.mjs`) and the five fixture
 * charts of `scripts/validate-display-view.mjs` (slanted edge, Siemens star, bar groups, dead leaves, step wedge) at the app's
 * two view sizes (2028 × 1352 and 2800 × 1867) in Speed and Quality, in the app's request shape
 * (`scripts/benchmark-display-view.mjs --app`, #454: 24 MP 6 µm, the 2 × 2 box pixel aperture, the chart 0.42 m wide at
 * 0.63 m with a stand-in printed label). `--scene` gives the scene's form: `material-layers` (the default; the form an
 * application gives the GPU, #491: the chart under the engine-authored stand-in label layer `standInLabelLayer`) or
 * `material-function` (#480's first form, a caller function the GPU refuses; CPU-only runs). `--region` renders and compares
 * one region of every view (both producers render the same region of the same view). One fresh Node process per case,
 * `--workers` of them at a time; with `--gpu` each case launches its own browser.
 *
 * `--reference`: with `--gpu` the candidate is judged against the CPU display view rendered in the same browser page (`browser`,
 * the default), as the WebGPU suite judges the kernels: ECMAScript does not fix the last bit of `Math.atan2`, and Chromium and
 * Node differ there (#471), which moves lattice points exactly on a Siemens star's sector boundary to the other sector (on the
 * 2028 × 1352 star, a few dozen display pixels near the diagonals by up to ΔE2000 23). Node's CPU reference is rendered too and
 * its difference from the browser's is printed and recorded (`realm`), as information. `--reference node` judges against Node's.
 *
 * Per case it prints and records: the fraction of pixels within ΔE2000 1 (`--within-de`), the maximum and mean ΔE2000, the
 * maximum |Δ| / σ (the expected-value difference of a component over the reference's noise σ of that component), the
 * maximum difference in 8-bit codes, the fraction of pixels that are identical, whether the drawn samples and the noise σ
 * are identical, and the render times; it writes a difference image per case (PNG, 8-bit, |Δ| in codes × `--gain`, text
 * metadata "Difference image, not a capture") and prints pass or fail per threshold. The "no structured difference at
 * 1:1" check is the owner's visual review of the difference images: the script lists the files and does not judge it.
 *
 * `--timing`: also times the reference as `scripts/benchmark-display-view.mjs --app` does (prepare once, render `--parts`
 * sampled 96 × 96 parts, extrapolate the whole view's CPU time) next to the candidate's whole-view time. The CPU pool's
 * wall time to fully sharp (4 and 12 workers) is measured in the app, not here: Node has no such pool.
 *
 * `--record <name>` writes `docs/validation/<name>/README.md` and `results.jsonl` in the format of
 * `docs/validation/display-view-2026-10-26/` (and copies the difference images into it with `--record-images`).
 *
 * Colour science: the engine's own CIEDE2000 and CIELAB (`dist/color/color-difference.js`, the formula of
 * `calculateColorDifference` after Sharma, Wu and Dalal 2005) and the sRGB space of `resolveRgbColorSpace("srgb")`; the
 * reduction is `scripts/lib/display-view-acceptance.mjs`. Informational only: no CI gate.
 */
import "./require-fresh-dist.mjs";
import console from "node:console";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import { cpus, loadavg } from "node:os";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { appRequestOptions, appParts, sampledParts, APP_CHART, APP_PART_SIDE } from "./lib/display-view-app-request.mjs";
import { DEFAULT_THRESHOLDS, createAcceptanceMetrics, differenceImage8, gpuRenderProblem, judge, summarize } from "./lib/display-view-acceptance.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)), DIST_URL = new URL("../dist/", import.meta.url);
const CPU_PRODUCER = fileURLToPath(new URL("./lib/display-view-cpu-producer.mjs", import.meta.url)), GPU_PRODUCER = fileURLToPath(new URL("./lib/display-view-gpu-producer.mjs", import.meta.url));
/**
 * `app` is the app's composite chart; `app-defocus` the same request focused at 0.8 × the subject distance with `lens.defocus`
 * (#492; Speed only); the others are the five fixture charts.
 */
const FIXTURE_CHARTS = ["app", "app-defocus", "slanted-edge", "siemens-star", "bar-groups", "dead-leaves", "step-wedge"];
/**
 * Cases the GPU is expected not to cover yet: with `--gpu` a refusal with `unsupported-on-backend` is recorded as an expected
 * fallback (its reason printed), not a failure; once the GPU renders the case it is compared like every other. Defocus on the GPU
 * is #492 step 2c.
 */
const EXPECTED_GPU_FALLBACK = new Set(["app-defocus"]);
/** The focus distance of `app-defocus`, as a fraction of the subject distance. */
const DEFOCUS_FOCUS_FRACTION = 0.8;
const APP_SIZES = [{ width: 2028, height: 1352 }, { width: 2800, height: 1867 }];

const argv = process.argv.slice(2), has = (name) => argv.includes(name), arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const num = (name, fallback) => { const v = Number(arg(name, fallback)); if (!Number.isFinite(v)) throw new Error(`${name} needs a number.`); return v; };
const thresholds = { withinDeltaE: num("--within-de", DEFAULT_THRESHOLDS.withinDeltaE), withinFraction: num("--within-fraction", DEFAULT_THRESHOLDS.withinFraction),
  maximumDeltaE: num("--max-de", DEFAULT_THRESHOLDS.maximumDeltaE), maximumSigma: num("--max-sigma", DEFAULT_THRESHOLDS.maximumSigma) };
const gpu = has("--gpu"), hardware = has("--hardware");
if (hardware && !gpu) throw new Error("--hardware needs --gpu.");
if (gpu && argv.includes("--candidate")) throw new Error("Give --gpu or --candidate, not both.");
if (hardware) {
  // The WebGPU suite's switches (test/webgpu/chromium.ts, scripts/run-webgpu-hardware.mjs): hardware flags unless PHOTIVRA_WEBGPU_FLAGS is
  // given, and a software adapter is a failure. Set here, they reach every case's process.
  process.env.PHOTIVRA_WEBGPU_ADAPTER ??= "hardware";
  process.env.PHOTIVRA_WEBGPU_REQUIRE_HARDWARE ??= "1";
}
const sceneForm = arg("--scene", "material-layers");
if (!["material-layers", "material-function"].includes(sceneForm)) throw new Error("--scene is material-layers or material-function.");
if (gpu && sceneForm !== "material-layers") throw new Error("--gpu needs --scene material-layers: the GPU renderer refuses a caller scene function (unsupported-on-backend).");
const region = arg("--region") === undefined ? null : (() => { const [x, y, width, height] = arg("--region").split(",").map(Number); if (![x, y, width, height].every(Number.isInteger)) throw new Error("--region is x,y,width,height in display pixels."); return { x, y, width, height }; })();
const gain = num("--gain", 16), outDir = resolve(arg("--out", "display-view-acceptance")), candidatePath = gpu ? GPU_PRODUCER : resolve(arg("--candidate", CPU_PRODUCER)), timing = has("--timing"), partCount = num("--parts", 30);
const requireHardware = process.env.PHOTIVRA_WEBGPU_REQUIRE_HARDWARE === "1";
// Which realm's CPU reference the candidate is judged against: with --gpu the browser page's own (default), as the WebGPU suite does,
// because the engines' Math.atan2 can differ in the last bit (#471) and move lattice points exactly on a Siemens star's sector boundary.
const referenceRealm = arg("--reference", gpu ? "browser" : "node");
if (!["browser", "node"].includes(referenceRealm)) throw new Error("--reference is browser or node.");
if (referenceRealm === "browser" && !gpu) throw new Error("--reference browser needs --gpu (the browser page is the GPU producer's).");
if (timing && region) throw new Error("--timing times whole views; leave out --region.");
const commit = () => { const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: ROOT }); return r.status === 0 ? r.stdout.trim() : "unknown"; };
const f3 = (x, d = 3) => (x === undefined || x === null || Number.isNaN(x) ? "—" : x === Infinity ? "∞" : x.toFixed(d));
const pct = (x) => f3(100 * x, 2) + " %";

/** The request of a case: the app's shape with the case's chart (the app's composite, or a fixture chart in its place). */
function caseRequest(engine, c) {
  const app = c.chart === "app" || c.chart === "app-defocus";
  const request = appRequestOptions(engine, { options: c.options, fNumber: c.fNumber }, { chart: app ? APP_CHART : { preset: c.chart }, view: { width: c.width, height: c.height },
    sceneId: `acceptance:${c.chart}`, scene: c.scene ?? "material-function" });
  if (c.chart === "app-defocus") request.lens = { ...request.lens, focusDistanceM: DEFOCUS_FOCUS_FRACTION * request.subjectDistanceM, defocus: { model: "geometric-disc" } };
  return request;
}
/** The display view of a case: the whole view, or `region` of it. */
const caseView = (c) => ({ width: c.width, height: c.height, ...(c.region ? { region: c.region } : {}) });
const identicalArrays = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const fileOf = (c) => `${String(c.id).padStart(2, "0")}-${c.chart}-${c.options}-${c.width}x${c.height}${c.region ? `-region-${c.region.x}-${c.region.y}-${c.region.width}x${c.region.height}` : ""}-difference.png`;
/** The execution label of a candidate render, as recorded (the adapter, the conformance check and the bound; no limitations text). */
const executionRecord = (r) => r.execution ? { backend: r.execution.backend, fallbackReason: r.execution.fallbackReason, arithmetic: r.execution.arithmetic, adapter: r.execution.adapter,
  softwareAdapter: r.softwareAdapter, conformance: r.execution.conformance ? { passed: r.execution.conformance.passed, cases: r.execution.conformance.cases.length, failedCase: r.execution.conformance.failedCase } : null,
  errorBound: r.execution.errorBound, diagnosticUncertaintySampleCount: r.execution.diagnosticUncertaintySampleCount, compositeProbe: r.execution.compositeProbe ?? null, browser: r.browser } : null;
/** 2.11.0: the composite chart probe's record in one phrase (its class and the product path the composite kernel ran with), or null. */
const probeLine = (probe) => probe ? `composite probe class ${probe.deviceClass}, product path ${probe.productPath ?? "none"}, fma ${probe.fmaFused ? "fused" : "not fused"}` +
  `${Object.entries(probe.mismatchCounts ?? {}).some(([, n]) => n > 0) ? ` (differing: ${Object.entries(probe.mismatchCounts).filter(([, n]) => n > 0).map(([k, n]) => `${k} ×${n} [${(probe.mismatchedInputs?.[k] ?? []).join(",")}]`).join(", ")})` : ""}` : null;

/** One case, in its own process: both renders, the comparison, the difference image and (with --timing) the reference parts. */
async function runCase(c) {
  const engine = await import(new URL("index.js", DIST_URL).href), context = { engine, distUrl: DIST_URL.href };
  const { createProducer: createReference } = await import(pathToFileURL(CPU_PRODUCER).href), { createProducer: createCandidate } = await import(pathToFileURL(candidatePath).href);
  const reference = await createReference(context), view = caseView(c), w = view.region?.width ?? c.width, h = view.region?.height ?? c.height;
  const request = caseRequest(engine, c), load = loadavg()[0];
  // The candidate first: a GPU that cannot render fails the case before the CPU reference spends its time.
  const candidate = await createCandidate(context, { repeat: num("--repeat", 1), reference: referenceRealm === "browser" });
  let cand;
  try { cand = await candidate.render(caseRequest(engine, c), view); }
  catch (error) {
    if (gpu && c.expectFallback && error?.reason === "unsupported-on-backend")
      return { ...c, candidate: candidate.name, expectedFallback: true, fallbackReason: error.reason, detail: error.message, probe: error.probe ?? null, node: process.version, commit: commit() };
    throw error;
  } finally { await candidate.close?.(); }
  if (gpu) { const problem = gpuRenderProblem(cand, { requireHardware }); if (problem) throw new Error(`The GPU did not render this view: ${problem}`); }
  // Node's CPU reference is always rendered: the reference itself (--reference node) or the realm check of the browser's.
  const nodeRef = await reference.render(request, view), ref = referenceRealm === "browser" ? cand.reference : nodeRef;
  if (!ref) throw new Error("The candidate returned no same-realm reference.");
  for (const [name, r] of [["reference", ref], ["candidate", cand], ["Node reference", nodeRef]]) if (r.width !== w || r.height !== h) throw new Error(`${name} rendered ${r.width} × ${r.height}, not ${w} × ${h}.`);
  const { deltaE2000, cielabOfXyz } = await import(new URL("color/color-difference.js", DIST_URL).href);
  const { compareExpectedImages } = createAcceptanceMetrics({ deltaE2000, cielabOfXyz, srgb: engine.resolveRgbColorSpace("srgb").value });
  const t0 = performance.now();
  const metrics = compareExpectedImages({ width: w, height: h, reference: ref.expected, candidate: cand.expected, referenceNoiseStd: ref.noiseStd, candidateNoiseStd: cand.noiseStd, withinDeltaE: thresholds.withinDeltaE });
  const compareMs = performance.now() - t0;
  // The two realms' CPU references against each other (information, not a threshold): a difference here is the reference's, not the GPU's.
  let realm = null;
  if (ref !== nodeRef) {
    const { deltaE: _d, sigma: _s, ...m } = compareExpectedImages({ width: w, height: h, reference: nodeRef.expected, candidate: ref.expected, referenceNoiseStd: nodeRef.noiseStd, withinDeltaE: thresholds.withinDeltaE });
    void _d; void _s;
    realm = { differingPixels: m.pixels - m.identicalPixels, maxDeltaE: m.maxDeltaE, maxDeltaEAt: m.maxDeltaEAt, maxSigma: m.maxSigma, samplesIdentical: identicalArrays(nodeRef.samples, ref.samples), nodeReferenceMs: nodeRef.elapsedMs };
  }
  const { deltaE, sigma, ...reduced } = metrics;
  void deltaE; void sigma;
  // The difference image: |candidate − reference| in codes × gain; a diagnostic picture, labelled so in its text chunks.
  const { addPngTextMetadata } = await import(new URL("output/text-metadata.js", DIST_URL).href);
  const image = differenceImage8(ref.expected, cand.expected, gain), file = join(outDir, fileOf(c));
  const png = addPngTextMetadata(engine.serializePngImage({ width: w, height: h, bitDepth: 8, samples: image, colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } }),
    { description: `Difference image, not a capture: |${candidate.name} - ${reference.name}| of the noise-free expected display values of a display view, in 8-bit sRGB codes times ${gain}, clamped. Chart ${c.chart}, ${c.options}, f/${c.fNumber}, view ${c.width} x ${c.height}${c.region ? `, region ${c.region.x},${c.region.y} ${w} x ${h}` : ""}. Black is no difference.`,
      software: "Photivra engine, scripts/accept-display-view-gpu.mjs", comment: "Diagnostic image for visual review (Photivra/engine#480). Not a capture, not a display view, not a RAW file." });
  mkdirSync(outDir, { recursive: true }); writeFileSync(file, png);
  const out = { ...c, reference: ref.name ?? reference.name, referenceRealm, realm, candidate: candidate.name, candidateModule: relative(ROOT, candidatePath), gain, thresholds, metrics: reduced,
    samplesIdentical: identicalArrays(ref.samples, cand.samples), noiseStdIdentical: identicalArrays(ref.noiseStd, cand.noiseStd), expectedIdentical: metrics.identicalPixels === metrics.pixels,
    estimation: { reference: ref.estimation, candidate: cand.estimation }, referenceMs: ref.elapsedMs, candidateMs: cand.elapsedMs, candidateTimings: cand.timings, candidateExecution: executionRecord(cand), compareMs, differenceImage: file,
    loadAverage: load, node: process.version, commit: commit() };
  if (timing) {
    // The reference as the app runs it (scripts/benchmark-display-view.mjs --app): prepare once, time sampled parts, extrapolate.
    const parts = appParts(c.width, c.height, APP_PART_SIDE), timed = sampledParts(parts, partCount);
    let t = performance.now();
    const prepared = await engine.prepareDisplayView(request);
    const prepareMs = performance.now() - t, ms = [];
    for (const region of timed) { t = performance.now(); await prepared.render({ ...view, region: { x: region.x, y: region.y, width: region.width, height: region.height } }); ms.push(performance.now() - t); }
    const sorted = [...ms].sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    out.timing = { prepareMs, parts: ms.length, of: parts.length, partMedianMs: sorted[Math.floor(sorted.length / 2)], partMaxMs: sorted.at(-1), referenceWholeViewCpuSecondsExtrapolated: mean * parts.length / 1000,
      referenceWholeViewSeconds: ref.elapsedMs / 1000, candidateWholeViewSeconds: cand.elapsedMs / 1000 };
  }
  return out;
}

function tableLines(records) {
  const lines = ["| Chart | Options | View | Within ΔE " + thresholds.withinDeltaE + " | Max ΔE2000 | Mean ΔE2000 | Max \\|Δ\\| / σ | Max codes | Identical pixels | Samples identical | σ identical | Reference s | Candidate s | Verdict |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of records) {
    const m = r.metrics, v = judge(m, thresholds);
    lines.push(`| ${r.chart} | ${r.options} | ${r.width} × ${r.height} | ${pct(m.withinFraction)} | ${f3(m.maxDeltaE, 4)} | ${f3(m.meanDeltaE, 4)} | ${f3(m.maxSigma, 3)} | ${f3(m.maxCode8, 2)} | ${pct(m.identicalFraction)} | ${r.samplesIdentical ? "yes" : "no"} | ${r.noiseStdIdentical ? "yes" : "no"} | ${f3(r.referenceMs / 1000, 1)} | ${f3(r.candidateMs / 1000, 1)} | ${v.pass ? "pass" : "FAIL: " + v.checks.filter((k) => !k.pass).map((k) => k.id).join(", ")} |`);
  }
  return lines;
}
function timingLines(records) {
  const rs = records.filter((r) => r.timing);
  if (!rs.length) return [];
  const lines = ["| Chart | Options | View | Prepare | Part median | Part max | Reference whole view, CPU extrapolated | Reference whole view, one process | Candidate whole view |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of rs) { const t = r.timing; lines.push(`| ${r.chart} | ${r.options} | ${r.width} × ${r.height} | ${f3(t.prepareMs, 0)} ms | ${f3(t.partMedianMs, 0)} ms | ${f3(t.partMaxMs, 0)} ms | ${f3(t.referenceWholeViewCpuSecondsExtrapolated, 1)} s from ${t.parts} of ${t.of} parts | ${f3(t.referenceWholeViewSeconds, 1)} s | ${f3(t.candidateWholeViewSeconds, 1)} s |`); }
  return lines;
}

/** The results record: docs/validation/<name>/README.md and results.jsonl in the format of display-view-2026-10-26. */
function writeRecord(name, records, summary, environment, images, errors = [], fallbacks = []) {
  const dir = join(ROOT, "docs", "validation", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.jsonl"), [...records, ...fallbacks].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const cand = records[0].candidate, selfCheck = records.every((r) => r.candidateModule === relative(ROOT, CPU_PRODUCER));
  const date = new Date(environment.date), title = `${date.toLocaleString("en-US", { month: "long" })} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  const lines = [`# Preview acceptance${selfCheck ? " self-check" : ""}, ${title} (${cand} against ${records[0].reference})`, "",
    `\`node scripts/accept-display-view-gpu.mjs${environment.args ? " " + environment.args : ""}\` (#480; ${records.length} cases; raw lines in [results.jsonl](results.jsonl)), on commit`,
    `\`${environment.commit}\`. ${selfCheck ? "The self-check: the candidate is the CPU display view itself (`scripts/lib/display-view-cpu-producer.mjs`), so every difference must be exactly zero and every pixel identical." : `The candidate is \`${records[0].candidateModule}\`, the reference the CPU display view${records[0].referenceRealm === "browser" ? " rendered in the same browser page (the GPU's realm; its difference from Node's reference is listed per case in results.jsonl as `realm`)" : " in Node"}.`}`,
    "Each case renders the " + (records[0].region ? "region " + JSON.stringify(records[0].region) + " of the view" : "whole view") + " with both producers in the app's request shape (24 MP 6 µm, 2 × 2 box, the chart 0.42 m wide at 0.63 m with the stand-in label as " +
      (records[0].scene === "material-layers" ? "a declared `material-layers` layer" : "a caller material function") + ", f/" + records[0].fNumber + ", ISO 100) and compares",
    "the noise-free expected images per pixel: ΔE2000 (Sharma, Wu and Dalal 2005) between the sRGB display colours, and the expected-value difference of each component in units of the",
    "reference's noise σ. Method and thresholds: [Display view](../../DISPLAY_VIEW.md#preview-acceptance) and [WebGPU](../../WEBGPU.md#preview-acceptance).", "",
    `${environment.node}, ${environment.cpu}, ${environment.platform}, one process per case, ${environment.workers} at a time, load average ${environment.loadAverage} at the start; the run took about ${environment.minutes} minutes.`, "",
    `**Status: ${summary.pass && !errors.length ? "every case passes every threshold" : "FAIL in " + (summary.failing.length + errors.length) + " of " + (records.length + errors.length) + " cases (" + [...summary.failing, ...errors.map((e) => e.id + ", errored")].join("; ") + ")"}** (thresholds: at least ${pct(thresholds.withinFraction)} within ΔE2000 ${thresholds.withinDeltaE}, none above ${thresholds.maximumDeltaE}, no pixel beyond ${thresholds.maximumSigma} σ).`,
    ...errors.map((e) => `- Case ${e.id} errored: ${e.error.split("\n")[0]}`),
    ...fallbacks.map((f) => `- Case ${f.id} (${f.chart}, ${f.options}, ${f.width} × ${f.height}): expected fallback, not compared; the GPU refused it with \`${f.fallbackReason}\`: ${f.detail.split("\n")[0]}`),
    records[0].candidateExecution ? "Where the candidate ran (`diagnostics.fast.execution`): " + [...new Set(records.map((r) => { const e = r.candidateExecution; return `${e.backend} on ${JSON.stringify(e.adapter)}${e.softwareAdapter ? " (a software adapter: SwiftShader's times are not GPU performance)" : ""}, conformance self-check ${e.conformance?.passed ? "passed" : "not passed"}, ${e.browser}`; }))].join("; ") + "." : "",
    selfCheck ? `${records.every((r) => r.expectedIdentical && r.samplesIdentical && r.noiseStdIdentical) ? "Every expected value, noise σ and drawn sample is identical between the two renders of every case (exact equality, as the self-check requires)." : "NOT every value is identical: the self-check failed."}` : "",
    "", "**Visual review.** The \"no structured difference at 1:1\" check is the owner's review of the difference images (|Δ| in 8-bit codes × " + gain + ", black is no difference; each PNG carries \"Difference image, not a capture\" in its text metadata):", ""];
  for (const r of records) lines.push(`- \`${basename(r.differenceImage)}\`: ${r.chart}, ${r.options}, ${r.width} × ${r.height}${r.expectedIdentical ? " (all black: identical expected images)" : ""}`);
  if (!images) lines.push("", "The images were written to the run's `--out` directory, not into this folder (`--record-images` copies them; an all-black PNG of a whole view is several megabytes).");
  lines.push("", "## Every case", "", ...tableLines(records));
  const tl = timingLines(records);
  if (tl.length) lines.push("", "## Timing", "", "Reference parts as `scripts/benchmark-display-view.mjs --app` times them (prepare once, sampled 96 × 96 parts, centre first; the whole view's CPU time is extrapolated from the sampled parts, not measured). The CPU pool's wall time to fully sharp with 4 and 12 workers is measured in the app, not here.", "", ...tl);
  lines.push("");
  writeFileSync(join(dir, "README.md"), lines.join("\n"));
  if (images) for (const r of records) copyFileSync(r.differenceImage, join(dir, basename(r.differenceImage)));
  return dir;
}

if (has("--case")) {
  const c = JSON.parse(arg("--case"));
  try { console.log(JSON.stringify(await runCase(c))); } catch (error) { console.log(JSON.stringify({ id: c.id, error: String(error?.stack ?? error), probe: error?.probe ?? null })); process.exitCode = 1; }
} else {
  const started = performance.now(), startedAt = new Date().toISOString(), workers = num("--workers", 1), charts = (arg("--charts") ?? FIXTURE_CHARTS.join(",")).split(","), options = (arg("--options") ?? "speed,quality").split(",");
  const sizes = (arg("--sizes") ?? APP_SIZES.map((s) => `${s.width}x${s.height}`).join(",")).split(",").map((s) => { const [w, h] = s.split("x").map(Number); return { width: w, height: h }; }), fNumber = num("--f", 8);
  for (const c of charts) if (!FIXTURE_CHARTS.includes(c)) throw new Error(`Unknown fixture chart ${c}; one of ${FIXTURE_CHARTS.join(", ")}.`);
  const queue = [];
  for (const chart of charts) for (const size of sizes) for (const o of options) {
    if (chart === "app-defocus" && o !== "speed") continue;
    queue.push({ id: queue.length, chart, options: o, fNumber, ...size, scene: sceneForm, ...(region ? { region } : {}), ...(EXPECTED_GPU_FALLBACK.has(chart) ? { expectFallback: true } : {}) });
  }
  mkdirSync(outDir, { recursive: true });
  const jsonl = join(outDir, "results.jsonl"), records = [], errors = [], fallbacks = [];
  if (existsSync(jsonl)) writeFileSync(jsonl, "");
  console.error(`${queue.length} cases (${charts.length} charts × ${sizes.length} sizes × ${options.length} options, app-defocus in Speed only; scene ${sceneForm}${region ? `, region ${JSON.stringify(region)}` : ""}), ${workers} at a time; reference cpu-reference, candidate ${relative(ROOT, candidatePath)}${gpu ? ` (adapter ${process.env.PHOTIVRA_WEBGPU_FLAGS ? `flags "${process.env.PHOTIVRA_WEBGPU_FLAGS}"` : process.env.PHOTIVRA_WEBGPU_ADAPTER === "hardware" ? "hardware" : "SwiftShader (software: not GPU performance)"}${requireHardware ? ", hardware required" : ""})` : ""}; images in ${outDir}`);
  await new Promise((done) => {
    let running = 0;
    const next = () => {
      const c = queue.shift();
      if (!c) { if (running === 0) done(); return; }
      running++;
      const child = spawn(process.execPath, ["--max-old-space-size=6000", process.argv[1], "--case", JSON.stringify(c), ...argv.filter((a, i) => !["--case"].includes(a) && argv[i - 1] !== "--case")], { stdio: ["ignore", "pipe", "inherit"] });
      let text = "";
      child.stdout.on("data", (d) => { text += d; });
      child.on("close", () => {
        const line = text.trim().split("\n").pop() ?? "";
        let r; try { r = JSON.parse(line); } catch { r = { id: c.id, error: `no result: ${line}` }; }
        if (r.error) { errors.push(r); console.error(`case ${c.id} failed: ${r.error}`); }
        else if (r.expectedFallback) { fallbacks.push(r); appendFileSync(jsonl, JSON.stringify(r) + "\n"); console.error(`case ${c.id} ${c.chart}: expected fallback, the GPU does not cover it yet (${r.fallbackReason}): ${r.detail}`); }
        else { records.push(r); appendFileSync(jsonl, JSON.stringify(r) + "\n"); }
        // 2.11.0: the composite chart probe of every case that ran it, on a GPU render and on a refusal alike.
        const probe = r.probe ?? r.candidateExecution?.compositeProbe ?? null;
        if (probe) console.error(`case ${c.id} ${c.chart} ${c.options}: ${probeLine(probe)}`);
        const ran = r.candidateExecution;
        console.error(`done ${c.id} ${c.chart} ${c.options} ${c.width}x${c.height}${r.metrics ? ` max ΔE ${f3(r.metrics.maxDeltaE, 4)} max |Δ|/σ ${f3(r.metrics.maxSigma)} identical ${pct(r.metrics.identicalFraction)}` : ""}` +
          `${r.realm ? `; browser vs Node CPU reference: ${r.realm.differingPixels} pixels differ, max ΔE ${f3(r.realm.maxDeltaE, 4)}` : ""}` +
          `${ran ? `; candidate ran ${ran.backend} on ${JSON.stringify(ran.adapter)}${ran.softwareAdapter ? " (software adapter)" : ""}, conformance ${ran.conformance?.passed ? "passed" : "NOT passed"}` : ""}, left ${queue.length}`);
        running--; next();
      });
    };
    for (let i = 0; i < workers; i++) next();
  });
  records.sort((a, b) => a.id - b.id);
  if (!records.length && fallbacks.length && !errors.length) { console.log(`No case was compared: ${fallbacks.length} expected fallback.`); process.exit(0); }
  if (!records.length) {
    console.error(`FAIL: no case completed. ${errors.map((e) => `case ${e.id}: ${e.error.split("\n")[0]}`).join(" ")}`);
    process.exit(1);
  }
  const summary = summarize(records, thresholds), minutes = ((performance.now() - started) / 60000).toFixed(1);
  console.log(tableLines(records).join("\n"));
  const tl = timingLines(records);
  if (tl.length) console.log("\n" + tl.join("\n"));
  console.log("");
  for (const r of summary.cases) for (const k of r.verdict.checks) console.log(`${k.pass ? "pass" : "FAIL"}  case ${r.id} ${r.chart} ${r.options} ${r.width}x${r.height}: ${k.label} (${f3(k.value, 4)})`);
  if (gpu) {
    console.log("\nWhere each candidate render ran (diagnostics.fast.execution):");
    for (const r of records) { const e = r.candidateExecution; console.log(`  case ${r.id} ${r.chart} ${r.options}: ${e.backend}, fallback ${e.fallbackReason ?? "none"}, adapter ${JSON.stringify(e.adapter)}${e.softwareAdapter ? " (SOFTWARE adapter: not GPU performance)" : ""}, conformance ${e.conformance?.passed ? `passed (${e.conformance.cases} cases)` : "not passed"}${e.compositeProbe ? `, ${probeLine(e.compositeProbe)}` : ""}, ${e.browser}`); }
  }
  if (records.some((r) => r.realm)) {
    console.log("\nThe reference is the CPU display view in the GPU's own browser page. Its difference from Node's CPU reference (the engines' Math.atan2, #471; information, not a threshold):");
    for (const r of records) if (r.realm) console.log(`  case ${r.id} ${r.chart} ${r.options}: ${r.realm.differingPixels} pixels differ, max ΔE2000 ${f3(r.realm.maxDeltaE, 4)}, max |Δ|/σ ${f3(r.realm.maxSigma, 3)}, samples ${r.realm.samplesIdentical ? "identical" : "differ"}`);
  }
  for (const f of fallbacks) console.log(`EXPECTED FALLBACK case ${f.id} ${f.chart} ${f.options} ${f.width}x${f.height}: not compared; the GPU refused it with ${f.fallbackReason} (${f.detail.split("\n")[0]})`);
  for (const e of errors) console.log(`ERROR case ${e.id}: ${e.error.split("\n")[0]}${e.probe ? ` [${probeLine(e.probe)}]` : ""}`);
  console.log(`\n${summary.pass && !errors.length ? "PASS" : "FAIL"}: ${records.length + errors.length} cases, ${summary.failing.length} failing${errors.length ? `, ${errors.length} errored (an errored case is a failure)` : ""}${fallbacks.length ? `, ${fallbacks.length} expected fallback (not compared)` : ""}; thresholds ${JSON.stringify(thresholds)}; harness wall time ${minutes} min.`);
  console.log(`\nVisual review (not judged by this script): the "no structured difference at 1:1" check is the owner's review of these difference images (|Δ| in 8-bit codes × ${gain}; black is no difference):`);
  for (const r of records) console.log(`  ${r.differenceImage}${r.expectedIdentical ? "  (all black: identical)" : ""}`);
  if (timing) console.log("\nThe CPU pool's wall time to fully sharp (4 and 12 workers) is measured in the app, not here.");
  const record = arg("--record");
  if (record) {
    const environment = { date: startedAt, commit: commit(), node: `Node ${process.version}`, cpu: `${cpus().length}-vCPU ${cpus()[0]?.model?.trim() ?? "unknown CPU"}`, platform: process.platform, workers, loadAverage: f3(records[0].loadAverage, 1), minutes,
      args: argv.filter((a, i) => !["--record", "--out"].includes(a) && !["--record", "--out"].includes(argv[i - 1]) && a !== "--record-images").join(" ") };
    console.log(`\nRecord written: ${writeRecord(record, records, summary, environment, has("--record-images"), errors, fallbacks)}`);
  }
  if (errors.length || !summary.pass) process.exitCode = 1;
}
