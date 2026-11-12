// SPDX-License-Identifier: Apache-2.0
/**
 * #604 research only (not shipped): measures per-site estimators of the AHD low-signal bias against a high-draw reference, on
 * the cases recorded by capture-setups.research.ts (setups.json). Prints JSON lines and a summary; see
 * docs/research/ahd-bias-correction.md.
 *
 *   node scripts/research/ahd-bias/ahd-bias.mjs [--exact-draws 1048576] [--reps 64] [--cases id,id] [--budgets 64,256,1024] [--methods mc,antithetic,rqmc,cv,lab-cv]
 */
import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { performance } from "node:perf_hooks";
import { code8, createDevelopment, createEstimator } from "./ahd-bias-core.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i < 0 ? fallback : process.argv[i + 1]; };
const EXACT = Number(arg("exact-draws", 1 << 20)), REPS = Number(arg("reps", 64)), DECOMP = Number(arg("decomp-draws", 1 << 18));
const BUDGETS = arg("budgets", "64,256,1024").split(",").map(Number), METHODS = arg("methods", "mc,antithetic,rqmc,cv,lab-cv").split(",");
const setups = JSON.parse(readFileSync(new URL("./setups.json", import.meta.url), "utf8"));
const only = arg("cases", null)?.split(",");

/** The reference: plain Monte Carlo in batches, with its standard error per channel (linear output). */
function reference(estimate, draws, seed) {
  const batches = 64, per = draws / batches, values = [];
  for (let i = 0; i < batches; i++) values.push(estimate("mc", per, seed + i));
  const mean = [0, 1, 2].map((c) => values.reduce((s, v) => s + v[c], 0) / batches);
  const se = [0, 1, 2].map((c) => Math.sqrt(values.reduce((s, v) => s + (v[c] - mean[c]) ** 2, 0) / (batches - 1) / batches));
  return { mean, se };
}

for (const state of setups) {
  if (only && !only.includes(state.id)) continue;
  const base = new Float64Array(3);
  createDevelopment(state)(state.mean[0], state.mean[1], state.mean[2], base);
  /** A linear shift at the base value, in 8-bit sRGB codes. */
  const codes = (b) => [0, 1, 2].map((c) => code8(base[c] + b[c]) - code8(base[c]));
  const slope = [0, 1, 2].map((c) => (code8(base[c] + 1e-4) - code8(base[c] - 1e-4)) / 2e-4);
  const estimate = createEstimator(state);
  let t = performance.now();
  const ref = reference(estimate, EXACT, 0x6040000);
  const usPerDraw = 1000 * (performance.now() - t) / EXACT;
  const refCodes = codes(ref.mean), refSeCodes = ref.se.map((s, c) => s * slope[c]);
  console.log(JSON.stringify({ case: state.id, label: state.label, electrons: state.mean.map((m, c) => m / state.readout[c].perElectron), base: Array.from(base), exactCodes: refCodes, exactSeCodes: refSeCodes, usPerDraw }));
  // Decomposition: which nonlinearity carries the bias.
  for (const [name, variant] of [["gaussian-counts", { gaussian: true }], ["linear-lab", { linearLab: true }], ["no-site-clip", { noClip: true }],
    ["linear-development", { linearDevelopment: true }], ["gaussian+linear-lab", { gaussian: true, linearLab: true }]]) {
    const r = reference(createEstimator(state, variant), DECOMP, 0x6041000);
    console.log(JSON.stringify({ case: state.id, decomposition: name, codes: codes(r.mean), seCodes: r.se.map((s, c) => s * slope[c]) }));
  }
  for (const method of METHODS) for (const n of BUDGETS) {
    const errs = [[], [], []];
    t = performance.now();
    for (let rep = 0; rep < REPS; rep++) {
      const e = codes(estimate(method, n, 0x6042000 + rep * 7919 + n));
      for (let c = 0; c < 3; c++) errs[c].push(e[c] - refCodes[c]);
    }
    const msPerEval = (performance.now() - t) / REPS;
    const rms = errs.map((e) => Math.sqrt(e.reduce((s, x) => s + x * x, 0) / e.length));
    const meanErr = errs.map((e) => e.reduce((s, x) => s + x, 0) / e.length);
    const maxErr = errs.map((e) => Math.max(...e.map(Math.abs)));
    console.log(JSON.stringify({ case: state.id, method, draws: n, rmsCodes: rms, meanErrCodes: meanErr, maxErrCodes: maxErr, msPerEval }));
  }
}
