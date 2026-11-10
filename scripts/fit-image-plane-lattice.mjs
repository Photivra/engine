// SPDX-License-Identifier: Apache-2.0

/**
 * Fits the print reflectance lattice of the image-plane scene (#581, `src/facade/image-plane.ts`) and writes its data module,
 * `src/facade/image-plane-lattice-data.ts`.
 *
 * The lattice has 5 × 5 × 5 nodes at the sRGB code values 0, 1/4, 1/2, 3/4 and 1 per channel (uniform in encoded sRGB, so
 * denser in the shadows), at the linear sRGB values the IEC 61966-2-1 transfer function gives them. A node on the neutral
 * axis (r = g = b, black and white included) is a flat spectrum equal to its linear value and is not stored. Each of the
 * other 120 nodes holds the reflectance the LHTSS method gives for its color: S. A. Burns, "Generating Reflectance Curves
 * from sRGB Triplets", arXiv:1710.05732 v5 (2020), section "Least Hyperbolic Tangent Slope Squared (LHTSS) Method"
 * (pp. 24–26). Implemented from the paper's equations only; Burns' MATLAB code (CC BY-SA 4.0) is not used:
 *
 *   ρ = (tanh z + 1)/2   (every value strictly inside (0, 1)),
 *   minimize Σᵢ (zᵢ₊₁ − zᵢ)²   subject to   T ρ = rgb,
 *
 * solved by Newton's method on the Lagrangian's stationary conditions D z + diag(ρ′) Tᵀ μ = 0, T ρ = rgb, with D the
 * tridiagonal finite-difference matrix and ρ′ = (1 − tanh² z)/2. T maps a reflectance to linear sRGB under CIE D65. The
 * paper samples 380–730 nm at 10 nm. This fit samples 380–780 nm at 10 nm (41 values, the engine's facade range), and the
 * spectrum is linearly interpolated between samples. T is the CIE 1 nm summation of that interpolated spectrum against CIE D65
 * and the CIE 1931 2° observer over 380–780 nm, normalized so that the flat reflectance 1 has Y = 1. The D65 table's white is
 * scaled to the sRGB white (x, y) = (0.3127, 0.3290) by a diagonal XYZ scaling, the two differing by about 3e-5 in x and y.
 * Then T is converted with the CSS Color 4 `XYZ_to_lin_sRGB` matrix, as scripts/compute-color-patch-reference.mjs does.
 *
 * The open interval cannot reach a node with a channel at 0 or 1, so the target is clamped to [1e-4, 1 − 1e-4]. Two steps of
 * Photivra's own then make each node exact. First, the residual is removed by the least-norm correction over the samples not
 * at a bound, with clamping to [0, 1], repeated. Then the 16-bit rounding of the stored samples is corrected the same way on
 * the integer codes. The script reports the round trip of the stored lattice: the CIEDE2000 between each node's sRGB and the
 * sRGB of its stored spectrum, and the same over a 17³ grid of sRGB code values through the trilinear interpolation of the
 * runtime.
 *
 * Data: the CIE datasets "CIE standard illuminant D65" (DOI 10.25039/CIE.DS.hjfjmt59) and "CIE 1931 color-matching functions,
 * 2 degree observer" (DOI 10.25039/CIE.DS.xvudnb9b), CC BY-SA 4.0. Their licence and attribution are in THIRD_PARTY.md. As
 * scripts/fit-cie-1931-cmf.mjs and scripts/compute-color-patch-reference.mjs do, the script downloads them into a fresh
 * temporary directory outside the repository, checks their SHA-256, uses them and deletes them. It writes no CIE value:
 * its output is the lattice's fitted spectra.
 *
 * Usage (needs `npm run build` first for the CIEDE2000 check, and network access; behind an HTTPS proxy run Node with
 * NODE_USE_ENV_PROXY=1):
 *   node scripts/fit-image-plane-lattice.mjs            # fit, check, and compare with the committed data module (exit 1 on a difference)
 *   node scripts/fit-image-plane-lattice.mjs --write    # fit, check and rewrite the data module
 *   node scripts/fit-image-plane-lattice.mjs --csv-dir /path/outside/repo   # use local copies of both CSV files
 */

import console from "node:console";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_MODULE = path.join(REPOSITORY_ROOT, "src", "facade", "image-plane-lattice-data.ts");
const DATASETS = {
  d65: { file: "CIE_std_illum_D65.csv", url: "https://files.cie.co.at/Publications-datasets/CIE_std_illum_D65.csv", doi: "10.25039/CIE.DS.hjfjmt59",
    /** The same file and digest as scripts/compute-color-patch-reference.mjs. */
    sha256: "e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb", columns: 2 },
  cmf: { file: "CIE_xyz_1931_2deg.csv", url: "https://files.cie.co.at/Publications-datasets/CIE_xyz_1931_2deg.csv", doi: "10.25039/CIE.DS.xvudnb9b",
    /** The same file and digest as scripts/fit-cie-1931-cmf.mjs. */
    sha256: "fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1", columns: 4 }
};
/** CSS Color 4 §19 `XYZ_to_lin_sRGB`, the rational matrix written out as decimals. */
const XYZ_TO_LINEAR_SRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
/** The lattice: nodes per axis, their sRGB code values, the stored wavelengths. */
const NODES = 5, SAMPLES = 41, MINIMUM_NM = 380, STEP_NM = 10, CODE_SCALE = 65535, CLAMP = 1e-4;

async function loadTable(dataset) {
  const flag = process.argv.indexOf("--csv-dir");
  let text;
  if (flag !== -1) {
    const directory = path.resolve(process.argv[flag + 1] ?? "");
    if (directory === REPOSITORY_ROOT || directory.startsWith(REPOSITORY_ROOT + path.sep)) throw new Error("Keep the CIE tables outside the repository.");
    text = readFileSync(path.join(directory, dataset.file), "utf8");
  } else {
    const directory = mkdtempSync(path.join(tmpdir(), "photivra-cie-"));
    try {
      const response = await globalThis.fetch(dataset.url);
      if (!response.ok) throw new Error("Download of " + dataset.url + " failed with HTTP " + response.status + ".");
      text = await response.text();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  const digest = createHash("sha256").update(text).digest("hex");
  if (digest !== dataset.sha256) throw new Error("Unexpected CIE table " + dataset.file + " (SHA-256 " + digest + "); check the change before refitting.");
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(",").map(Number));
  if (rows.some((r) => r.length !== dataset.columns || r.some((v) => !Number.isFinite(v)))) throw new Error("Unexpected shape of " + dataset.file + ".");
  return new Map(rows.map((r) => [r[0], r.slice(1)]));
}

const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Solves A x = b (small dense systems; partial pivoting). */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (M[i][i] === 0) throw new Error("Singular system.");
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / M[i][i]; if (f !== 0) for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / M[i][i]; }
  return x;
}

const d65 = await loadTable(DATASETS.d65);
const cmf = await loadTable(DATASETS.cmf);
// T in XYZ: the 1 nm sum over 380–780 nm of the linearly interpolated samples (a hat function per sample).
const xyzRows = [[], [], []].map(() => new Array(SAMPLES).fill(0));
let ySum = 0;
for (let nm = MINIMUM_NM; nm <= MINIMUM_NM + STEP_NM * (SAMPLES - 1); nm++) {
  const s = d65.get(nm)?.[0], c = cmf.get(nm);
  if (s === undefined || !c) throw new Error("The CIE tables do not cover " + nm + " nm.");
  const p = (nm - MINIMUM_NM) / STEP_NM, i = Math.min(SAMPLES - 2, Math.floor(p)), f = p - i;
  for (let k = 0; k < 3; k++) { xyzRows[k][i] += s * c[k] * (1 - f); xyzRows[k][i + 1] += s * c[k] * f; }
  ySum += s * c[1];
}
const tableWhite = xyzRows.map((row) => row.reduce((a, b) => a + b, 0) / ySum);
const srgbWhite = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const xyzScaled = xyzRows.map((row, k) => row.map((v) => v / ySum * srgbWhite[k] / tableWhite[k]));
const T = XYZ_TO_LINEAR_SRGB.map((m) => Array.from({ length: SAMPLES }, (_, i) => m[0] * xyzScaled[0][i] + m[1] * xyzScaled[1][i] + m[2] * xyzScaled[2][i]));
const rgbOf = (rho) => T.map((row) => row.reduce((a, t, i) => a + t * rho[i], 0));
const whiteRgb = rgbOf(new Array(SAMPLES).fill(1));
if (whiteRgb.some((v) => Math.abs(v - 1) > 1e-12)) throw new Error("The flat reflectance 1 is not the sRGB white: " + whiteRgb.join(", "));

// D: the tridiagonal finite-difference matrix of Σ (z_{i+1} − z_i)² (its gradient is D z).
const D = Array.from({ length: SAMPLES }, (_, i) => Array.from({ length: SAMPLES }, (_, j) => (i === j ? (i === 0 || i === SAMPLES - 1 ? 1 : 2) : Math.abs(i - j) === 1 ? -1 : 0)));

/** LHTSS: the smoothest tanh-bounded reflectance with linear sRGB `target` (Newton's method on the Lagrangian). */
function lhtss(target) {
  let z = new Array(SAMPLES).fill(0), mu = [0, 0, 0];
  const residual = (zz, mm) => {
    const th = zz.map(Math.tanh), rho = th.map((t) => (t + 1) / 2), d1 = th.map((t) => (1 - t * t) / 2);
    const tmu = Array.from({ length: SAMPLES }, (_, i) => T[0][i] * mm[0] + T[1][i] * mm[1] + T[2][i] * mm[2]);
    const F = Array.from({ length: SAMPLES }, (_, i) => D[i].reduce((s, v, j) => s + v * zz[j], 0) + d1[i] * tmu[i]).concat(rgbOf(rho).map((v, k) => v - target[k]));
    return { F, th, d1, tmu };
  };
  let state = residual(z, mu), norm = Math.hypot(...state.F);
  for (let iteration = 0; iteration < 200 && norm > 1e-13; iteration++) {
    const { th, d1, tmu, F } = state, n = SAMPLES + 3;
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < SAMPLES; i++) {
      for (let j = 0; j < SAMPLES; j++) J[i][j] = D[i][j];
      J[i][i] += -(1 - th[i] * th[i]) * th[i] * tmu[i];
      for (let k = 0; k < 3; k++) { J[i][SAMPLES + k] = d1[i] * T[k][i]; J[SAMPLES + k][i] = T[k][i] * d1[i]; }
    }
    const step = solve(J, F.map((v) => -v));
    // Damped: halve the step until the residual decreases.
    let scale = 1, next, nextNorm;
    for (;;) {
      const zz = z.map((v, i) => v + scale * step[i]), mm = mu.map((v, k) => v + scale * step[SAMPLES + k]);
      next = { z: zz, mu: mm, state: residual(zz, mm) }; nextNorm = Math.hypot(...next.state.F);
      if (nextNorm < norm || scale < 1e-6) break;
      scale /= 2;
    }
    z = next.z; mu = next.mu; state = next.state; norm = nextNorm;
  }
  const rho = z.map((v) => (Math.tanh(v) + 1) / 2);
  if (!rho.every(Number.isFinite)) throw new Error("LHTSS did not converge for " + target.join(", "));
  return { rho, norm };
}

/** The least-norm correction of `rho` toward `target` over the samples strictly inside (lo, hi), clamped, repeated. */
function correct(rho, target, lo, hi) {
  let x = rho.slice();
  for (let iteration = 0; iteration < 50; iteration++) {
    const r = rgbOf(x).map((v, k) => target[k] - v);
    if (Math.hypot(...r) < 1e-15) break;
    const free = x.map((v) => v > lo && v < hi);
    const G = [0, 1, 2].map((a) => [0, 1, 2].map((b) => T[a].reduce((s, t, i) => s + (free[i] ? t * T[b][i] : 0), 0)));
    const y = solve(G, r);
    x = x.map((v, i) => (free[i] ? Math.min(hi, Math.max(lo, v + T[0][i] * y[0] + T[1][i] * y[1] + T[2][i] * y[2])) : v));
  }
  return x;
}

/** The 16-bit codes of an exact spectrum, then integer steps that reduce the color residual (greedy, a few passes). */
function quantize(rho, target) {
  const codes = rho.map((v) => Math.round(v * CODE_SCALE));
  const residualOf = (c) => { const rgb = rgbOf(c.map((v) => v / CODE_SCALE)); return Math.hypot(...rgb.map((v, k) => v - target[k])); };
  let best = residualOf(codes);
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < SAMPLES; i++) for (const delta of [-1, 1]) {
      const v = codes[i] + delta;
      if (v < 0 || v > CODE_SCALE) continue;
      codes[i] = v;
      const r = residualOf(codes);
      if (r < best) { best = r; improved = true; } else codes[i] -= delta;
    }
    if (!improved) break;
  }
  return codes;
}

const levels = Array.from({ length: NODES }, (_, k) => decode(k / (NODES - 1)));
const stored = [], worst = { node: "", residual: 0 };
let maximumNewtonResidual = 0;
for (let a = 0; a < NODES; a++) for (let b = 0; b < NODES; b++) for (let c = 0; c < NODES; c++) {
  if (a === b && b === c) continue;
  const target = [levels[a], levels[b], levels[c]];
  const { rho, norm } = lhtss(target.map((v) => Math.min(1 - CLAMP, Math.max(CLAMP, v))));
  maximumNewtonResidual = Math.max(maximumNewtonResidual, norm);
  const exact = correct(rho, target, 0, 1);
  const codes = quantize(exact, target);
  const residual = Math.hypot(...rgbOf(codes.map((v) => v / CODE_SCALE)).map((v, k) => v - target[k]));
  if (residual > worst.residual) { worst.residual = residual; worst.node = [a, b, c].join(","); }
  stored.push(codes);
}

// Round trip of the stored lattice through the runtime's interpolation, in CIEDE2000 (D65 white), over a 17³ grid of sRGB codes.
const node = (a, b, c) => {
  if (a === b && b === c) return new Array(SAMPLES).fill(levels[a]);
  let index = a * 25 + b * 5 + c;
  index -= [0, 1, 2, 3, 4].filter((k) => k * 31 < index).length; // the gray nodes before it (k·31 = k·(25 + 5 + 1))
  return stored[index].map((v) => v / CODE_SCALE);
};
const cell = (v) => { let k = 0; while (k < NODES - 2 && v > levels[k + 1]) k++; return [k, (v - levels[k]) / (levels[k + 1] - levels[k])]; };
const lattice = (rgb) => {
  const [[a, fa], [b, fb], [c, fc]] = rgb.map(cell), out = new Array(SAMPLES).fill(0);
  for (let da = 0; da < 2; da++) for (let db = 0; db < 2; db++) for (let dc = 0; dc < 2; dc++) {
    const w = (da ? fa : 1 - fa) * (db ? fb : 1 - fb) * (dc ? fc : 1 - fc);
    if (w === 0) continue;
    const s = node(a + da, b + db, c + dc);
    for (let i = 0; i < SAMPLES; i++) out[i] += w * s[i];
  }
  return out;
};
const { calculateColorDifference, calculateCielabFromXyz } = await import(path.join(REPOSITORY_ROOT, "dist", "index.js"));
const LINEAR_SRGB_TO_XYZ = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
const labOf = (rgb) => {
  const xyz = LINEAR_SRGB_TO_XYZ.map((m) => m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2]);
  return calculateCielabFromXyz({ xyz: { x: xyz[0], y: xyz[1], z: xyz[2] }, referenceWhiteXyz: { x: srgbWhite[0], y: 1, z: srgbWhite[2] } }).value;
};
let maximumDeltaE = 0, sumDeltaE = 0, count = 0, outOfRange = 0;
for (let r = 0; r <= 16; r++) for (let g = 0; g <= 16; g++) for (let b = 0; b <= 16; b++) {
  const rgb = [r, g, b].map((v) => decode(v / 16)), rho = lattice(rgb);
  if (rho.some((v) => v < 0 || v > 1)) outOfRange++;
  const deltaE = calculateColorDifference({ formula: "ciede2000", reference: labOf(rgb), sample: labOf(rgbOf(rho)) }).value.deltaE;
  maximumDeltaE = Math.max(maximumDeltaE, deltaE); sumDeltaE += deltaE; count++;
}
const minimum = Math.min(...stored.flat()) / CODE_SCALE, maximum = Math.max(...stored.flat()) / CODE_SCALE;
console.log("LHTSS: largest Newton residual " + maximumNewtonResidual.toExponential(2) + " (clamped targets). Stored nodes: 120 × " + SAMPLES + " samples, values " + minimum + " to " + maximum + ".");
console.log("Largest node residual after 16-bit storage: " + worst.residual.toExponential(2) + " linear sRGB (node " + worst.node + ").");
console.log("Round trip over 17³ sRGB codes through the lattice: CIEDE2000 max " + maximumDeltaE.toExponential(2) + ", mean " + (sumDeltaE / count).toExponential(2) + "; spectra outside [0, 1]: " + outOfRange + ".");

// The data module: per stored node its 41 codes, delta-coded along wavelength (first code, then differences), as one string of
// base-36 integers (the smallest gzip of the encodings tried; a test checks the decoded values against their bounds).
const deltas = stored.map((codes) => codes.map((v, i) => (i === 0 ? v : v - codes[i - 1])));
const text = deltas.map((row) => row.map((v) => v.toString(36)).join(",")).join(";");
const module = `// SPDX-License-Identifier: Apache-2.0
// Generated by scripts/fit-image-plane-lattice.mjs; do not edit. Photivra's own fitted spectra (LHTSS, arXiv:1710.05732 v5),
// fitted against CIE D65 and the CIE 1931 2° observer at fit time only; no CIE value is stored (THIRD_PARTY.md).

/**
 * The 120 stored nodes of the print reflectance lattice (r, g, b indices in order, the neutral axis skipped), each 41 16-bit
 * reflectance codes at 380, 390, …, 780 nm (value / 65535), delta-coded along wavelength in base 36: nodes separated by ";",
 * codes by ",".
 */
export const IMAGE_PLANE_LATTICE_CODES = ${JSON.stringify(text)};
`;
const committed = (() => { try { return readFileSync(DATA_MODULE, "utf8"); } catch { return ""; } })();
if (process.argv.includes("--write")) { writeFileSync(DATA_MODULE, module); console.log("Wrote " + path.relative(REPOSITORY_ROOT, DATA_MODULE) + "."); }
else if (committed !== module) { console.error("The committed data module differs from this fit."); process.exitCode = 1; }
else console.log("The committed data module matches this fit.");
if (maximumDeltaE > 0.01 || outOfRange > 0) { console.error("The round trip exceeds ΔE00 0.01 or a spectrum leaves [0, 1]."); process.exitCode = 1; }
