// SPDX-License-Identifier: Apache-2.0
/**
 * #604 research only (not shipped): the AHD low-signal bias of one flat neighborhood and per-site estimators of it, computed at
 * use from that site's channel means and the request's development. Nothing here is precomputed or kept across sites; the only
 * values kept between evaluations are non-signal constants (the Bayer roles of the 11 × 11 patch, the sites AHD reads, the
 * Kronecker generators).
 *
 * The quantity (as 2.21.0's removed correction defined it, docs/DISPLAY_VIEW.md "AHD at low signal"): for a flat neighborhood
 * whose sites of channel c have normalized mean μ_c, sites drawn as k_c·Poisson(μ_c/k_c) + σ_c·N(0, 1) and clipped at 1,
 *
 *   b(μ) = E[ h(AHD) − ½ h(H) − ½ h(V) ]   at the patch center, averaged over the four Bayer phases,
 *
 * where H and V are AHD's two candidates, AHD picks one by homogeneity in CIELAB (Hirakawa & Parks 2005) and h is the
 * view's development (white balance, highlight clip, color matrix, tone curve, clip to [0, 1]).
 * `ahdCentreSteps` is 2.21.0's `createAhdCentreSteps` (src/facade/display-view.ts before a33fea43) with Math.cbrt.
 */

const REACH = 5, SIDE = 2 * REACH + 1, LAB_EPSILON = 216 / 24389, LAB_KAPPA = 24389 / 27;
/** CFA role (0 red, 1 green, 2 blue) of each patch site, per phase (phaseY·2 + phaseX) of the center. Non-signal constant. */
export const ROLES = [0, 1, 2, 3].map((phase) => {
  const roles = new Uint8Array(SIDE * SIDE), px = phase & 1, py = phase >> 1;
  for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) {
    const xx = (px + dx) & 1, yy = (py + dy) & 1;
    roles[(dy + REACH) * SIDE + dx + REACH] = yy === 0 ? (xx === 0 ? 0 : 1) : (xx === 0 ? 1 : 2);
  }
  return roles;
});
/** The 105 patch sites the AHD steps read (|dy| ≤ 3 or |dx| ≤ 3). Non-signal constant. */
export const READ_SITES = Int32Array.from({ length: SIDE * SIDE }, (_, p) => p).filter((p) => {
  const dx = (p % SIDE) - REACH, dy = Math.floor(p / SIDE) - REACH;
  return Math.abs(dx) <= 3 || Math.abs(dy) <= 3;
});
export const SITES = READ_SITES.length;
/** Uniforms per draw: one per site for the photon count, one pair per two sites for Box–Muller read noise. */
export const DIMS = SITES + 2 * Math.ceil(SITES / 2);

const sq = (x) => x * x;

/**
 * AHD's steps at the center of the patch: fills the two candidates and returns 0 (horizontal), 1 (vertical) or 2 (tie).
 * `linearLab` replaces CIELAB's cube root by its tangent at `labAt` (research decomposition and the control variate).
 */
export function ahdCentreSteps(labMatrix, patch, { linearLab = null } = {}) {
  const lab = labMatrix, lw = lab.map((row) => row[0] + row[1] + row[2]);
  const gh = new Float64Array(49), gv = new Float64Array(49), cand = [new Float64Array(75), new Float64Array(75)], labs = [new Float64Array(75), new Float64Array(75)];
  // Tangent of f(t) = cbrt(t) (or the linear branch) at the noise-free value t0 of each XYZ component.
  const f = (t) => (t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116);
  const fd = (t) => (t > LAB_EPSILON ? 1 / (3 * Math.cbrt(t) * Math.cbrt(t)) : LAB_KAPPA / 116);
  let tan = null;
  if (linearLab) tan = [0, 1, 2].map((r) => { const t0 = (lab[r][0] * linearLab[0] + lab[r][1] * linearLab[1] + lab[r][2] * linearLab[2]) / lw[r]; return [f(t0), fd(t0), t0]; });
  function choose(phase) {
    const roles = ROLES[phase];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const i = (dy + 3) * 7 + dx + 3, p = (dy + REACH) * SIDE + dx + REACH, c = patch[p];
      if (roles[p] === 1) { gh[i] = c; gv[i] = c; continue; }
      gh[i] = (patch[p - 1] + patch[p + 1]) / 2 + (2 * c - patch[p - 2] - patch[p + 2]) / 4;
      gv[i] = (patch[p - SIDE] + patch[p + SIDE]) / 2 + (2 * c - patch[p - 2 * SIDE] - patch[p + 2 * SIDE]) / 4;
    }
    for (let d = 0; d < 2; d++) {
      const g = d === 0 ? gh : gv, o = cand[d], ol = labs[d];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if ((dx === -2 || dx === 2) && (dy === -2 || dy === 2)) continue;
        const i = (dy + 2) * 5 + dx + 2, p = (dy + REACH) * SIDE + dx + REACH, q = (dy + 3) * 7 + dx + 3, own = roles[p], gc = g[q];
        o[3 * i + 1] = gc;
        if (own === 1) {
          const hRole = roles[p + 1], vRole = 2 - hRole;
          o[3 * i + hRole] = gc + ((patch[p - 1] - g[q - 1]) + (patch[p + 1] - g[q + 1])) / 2;
          o[3 * i + vRole] = gc + ((patch[p - SIDE] - g[q - 7]) + (patch[p + SIDE] - g[q + 7])) / 2;
        } else {
          o[3 * i + own] = patch[p];
          o[3 * i + 2 - own] = gc + ((patch[p - SIDE - 1] - g[q - 8]) + (patch[p - SIDE + 1] - g[q - 6]) + (patch[p + SIDE - 1] - g[q + 6]) + (patch[p + SIDE + 1] - g[q + 8])) / 4;
        }
        const R = o[3 * i], G = o[3 * i + 1], B = o[3 * i + 2];
        let tx = (lab[0][0] * R + lab[0][1] * G + lab[0][2] * B) / lw[0], ty = (lab[1][0] * R + lab[1][1] * G + lab[1][2] * B) / lw[1], tz = (lab[2][0] * R + lab[2][1] * G + lab[2][2] * B) / lw[2];
        if (tan) { tx = tan[0][0] + tan[0][1] * (tx - tan[0][2]); ty = tan[1][0] + tan[1][1] * (ty - tan[1][2]); tz = tan[2][0] + tan[2][1] * (tz - tan[2][2]); }
        else { tx = f(tx); ty = f(ty); tz = f(tz); }
        ol[3 * i] = 116 * ty - 16; ol[3 * i + 1] = 500 * (tx - ty); ol[3 * i + 2] = 200 * (ty - tz);
      }
    }
    const h = labs[0], v = labs[1];
    let sh = 0, sv = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = 3 * ((dy + 2) * 5 + dx + 2), j0 = i - 3, j1 = i + 3, j2 = i - 15, j3 = i + 15;
      const hL0 = Math.abs(h[i] - h[j0]), hL1 = Math.abs(h[i] - h[j1]), hL2 = Math.abs(h[i] - h[j2]), hL3 = Math.abs(h[i] - h[j3]);
      const vL0 = Math.abs(v[i] - v[j0]), vL1 = Math.abs(v[i] - v[j1]), vL2 = Math.abs(v[i] - v[j2]), vL3 = Math.abs(v[i] - v[j3]);
      const hC0 = sq(h[i + 1] - h[j0 + 1]) + sq(h[i + 2] - h[j0 + 2]), hC1 = sq(h[i + 1] - h[j1 + 1]) + sq(h[i + 2] - h[j1 + 2]);
      const hC2 = sq(h[i + 1] - h[j2 + 1]) + sq(h[i + 2] - h[j2 + 2]), hC3 = sq(h[i + 1] - h[j3 + 1]) + sq(h[i + 2] - h[j3 + 2]);
      const vC0 = sq(v[i + 1] - v[j0 + 1]) + sq(v[i + 2] - v[j0 + 2]), vC1 = sq(v[i + 1] - v[j1 + 1]) + sq(v[i + 2] - v[j1 + 2]);
      const vC2 = sq(v[i + 1] - v[j2 + 1]) + sq(v[i + 2] - v[j2 + 2]), vC3 = sq(v[i + 1] - v[j3 + 1]) + sq(v[i + 2] - v[j3 + 2]);
      const epsL = Math.min(Math.max(hL0, hL1), Math.max(vL2, vL3)), epsC = Math.min(Math.max(hC0, hC1), Math.max(vC2, vC3));
      sh += (hL0 <= epsL && hC0 <= epsC ? 1 : 0) + (hL1 <= epsL && hC1 <= epsC ? 1 : 0) + (hL2 <= epsL && hC2 <= epsC ? 1 : 0) + (hL3 <= epsL && hC3 <= epsC ? 1 : 0);
      sv += (vL0 <= epsL && vC0 <= epsC ? 1 : 0) + (vL1 <= epsL && vC1 <= epsC ? 1 : 0) + (vL2 <= epsL && vC2 <= epsC ? 1 : 0) + (vL3 <= epsL && vC3 <= epsC ? 1 : 0);
    }
    return sh > sv ? 0 : sv > sh ? 1 : 2;
  }
  return { horizontal: cand[0], vertical: cand[1], choose };
}

/** The view's development of one camera pixel (2.21.0's renderPixel): WB, highlight clip, matrix, tone curve, clip to [0, 1]. */
export function createDevelopment(setup, { linear = false } = {}) {
  const [g0, g1, g2] = setup.gains, L = setup.clipLevel, M = setup.matrix, reinhard = setup.toneCurve === "positive-reinhard-per-channel";
  return function develop(r, g, b, out) {
    const u0 = linear ? g0 * r : Math.min(L, g0 * r), u1 = linear ? g1 * g : Math.min(L, g1 * g), u2 = linear ? g2 * b : Math.min(L, g2 * b);
    for (let c = 0; c < 3; c++) {
      let v = M[c][0] * u0 + M[c][1] * u1 + M[c][2] * u2;
      if (linear) { out[c] = v; continue; }
      if (reinhard) v = v > 0 ? v / (1 + v) : v;
      out[c] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  };
}

/** Inverse CDF of Poisson(λ) for one evaluation (the site's own λ; built at use, never kept): returns u ↦ n. */
export function poissonQuantile(lambda) {
  if (lambda <= 0) return () => 0;
  const lo = Math.max(0, Math.floor(lambda - 12 * Math.sqrt(lambda) - 2)), hi = Math.ceil(lambda + 12 * Math.sqrt(lambda) + 10);
  const cdf = new Float64Array(hi - lo + 1);
  // log p(n) = n log λ − λ − log n!, accumulated from lo.
  let logp = lo * Math.log(lambda) - lambda - logFactorial(lo), acc = 0;
  for (let n = lo; n <= hi; n++) { if (n > lo) logp += Math.log(lambda / n); acc += Math.exp(logp); cdf[n - lo] = acc; }
  for (let i = 0; i < cdf.length; i++) cdf[i] /= acc;
  return (u) => {
    let a = 0, b = cdf.length - 1;
    while (a < b) { const m = (a + b) >> 1; if (cdf[m] < u) a = m + 1; else b = m; }
    return lo + a;
  };
}
function logFactorial(n) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }

/**
 * Antisymmetric standard normal quantile, q(1 − u) = −q(u) exactly: Abramowitz & Stegun 26.2.23 (|error| < 4.5e-4), refined by
 * two Newton steps on A&S 7.1.26 erf. Only the control variate's surrogate uses it, whose zero mean needs only the antisymmetry.
 */
export function normalQuantile(u) {
  const lower = u < 0.5, p = lower ? u : 1 - u, t = Math.sqrt(-2 * Math.log(Math.max(p, 1e-300)));
  let x = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
  // x is the upper-tail quantile of p; Newton on Φ(−x) = p.
  for (let k = 0; k < 2; k++) { const e = normalCdf(-x) - p; x += e / (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)); }
  return lower ? -x : x;
}
function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** sfc32 (Doty-Humphrey, public domain) pseudo-random uniforms in (0, 1). */
export function sfc32(seed) {
  // Each state word from the MurmurHash3 finalizer of the seed and its index (independent streams for nearby seeds).
  let a = fmix32(seed ^ 0x9e3779b9), b = fmix32(a ^ 0x243f6a88), c = fmix32(b ^ 0xb7e15162), d = fmix32(c ^ seed);
  const next = () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return ((t >>> 0) + 0.5) / 4294967296; };
  for (let i = 0; i < 12; i++) next();
  return next;
}

/** MurmurHash3's 32-bit finalizer (Appleby, public domain). */
function fmix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
/** The first `n` primes. */
function primes(n) { const out = []; for (let k = 2; out.length < n; k++) if (out.every((p) => k % p !== 0)) out.push(k); return out; }
/** Kronecker (Richtmyer) generators frac(√p_d): a non-signal constant of the dimension count. */
export const KRONECKER = Float64Array.from(primes(DIMS), (p) => Math.sqrt(p) % 1);

/**
 * One evaluation of the bias estimator at a site: `state` = { mean[3], readout, gains, ... } (the site's channel means and the
 * request's development), `n` draws (a multiple of 8), `method` one of
 *   "mc"          plain Monte Carlo,
 *   "antithetic"  pairs (u, 1 − u) for counts and z ↦ −z for read noise,
 *   "rqmc"        randomly shifted Kronecker lattice (Cranley–Patterson rotation), phases stratified,
 *   "cv"          plain draws with the zero-mean symmetric surrogate as control variate (β fitted per channel),
 *   "rqmc-cv"     the lattice with the control variate,
 *   "lab-cv", "lab-cv-anti"  the same patch through AHD with linearized CIELAB as control variate (see labCv).
 * `variant` switches a nonlinearity off for the decomposition: { gaussian, linearLab, noClip, linearDevelopment }.
 * Returns the three components of b in the development's linear output.
 */
export function createEstimator(state, variant = {}) {
  const k = state.readout.map((r) => r.perElectron), sd = state.readout.map((r) => Math.sqrt(r.constantVariance));
  const lambda = state.mean.map((m, c) => m / k[c]);
  const quant = lambda.map((l) => poissonQuantile(l));
  const patch = new Float64Array(SIDE * SIDE), patchSym = new Float64Array(SIDE * SIDE);
  const steps = ahdCentreSteps(state.labMatrix, patch, variant.linearLab ? { linearLab: state.mean } : {});
  const symSteps = ahdCentreSteps(state.labMatrix, patchSym, { linearLab: state.mean });
  // The same drawn patch with CIELAB's cube root replaced by its tangent (the "lab" control variate).
  const labSteps = ahdCentreSteps(state.labMatrix, patch, { linearLab: state.mean });
  const develop = createDevelopment(state, { linear: !!variant.linearDevelopment }), developLinear = createDevelopment(state, { linear: true });
  const a = new Float64Array(3), b = new Float64Array(3), c3 = new Float64Array(3), y = new Float64Array(3), cv = new Float64Array(3);
  const sqrtLambda = lambda.map(Math.sqrt);
  const u = new Float64Array(DIMS);

  /** h(AHD) − ½h(H) − ½h(V) of the patch, into out. */
  function difference(st, phase, dev, out) {
    const dir = st.choose(phase), H = st.horizontal, V = st.vertical, ctr = 36;
    dev(H[ctr], H[ctr + 1], H[ctr + 2], a); dev(V[ctr], V[ctr + 1], V[ctr + 2], b);
    if (dir === 2) dev((H[ctr] + V[ctr]) / 2, (H[ctr + 1] + V[ctr + 1]) / 2, (H[ctr + 2] + V[ctr + 2]) / 2, c3);
    for (let ch = 0; ch < 3; ch++) out[ch] = (dir === 0 ? a[ch] : dir === 1 ? b[ch] : c3[ch]) - a[ch] / 2 - b[ch] / 2;
  }
  /** Fills the patch (and the symmetric surrogate's) from the uniforms u, for one phase. */
  function fill(phase, withSym) {
    const roles = ROLES[phase];
    for (let s = 0; s < SITES; s++) {
      const p = READ_SITES[s], ch = roles[p];
      const pair = SITES + 2 * (s >> 1), r = Math.sqrt(-2 * Math.log(u[pair])), ang = 2 * Math.PI * u[pair + 1];
      const z = (s & 1) === 0 ? r * Math.cos(ang) : r * Math.sin(ang);
      const counts = variant.gaussian ? lambda[ch] + sqrtLambda[ch] * normalQuantile(u[s]) : quant[ch](u[s]);
      const value = k[ch] * counts + sd[ch] * z;
      patch[p] = variant.noClip ? value : value < 1 ? value : 1;
      if (withSym) patchSym[p] = state.mean[ch] + k[ch] * sqrtLambda[ch] * normalQuantile(u[s]) + sd[ch] * z;
    }
  }
  /** One draw at uniforms u: y (the target) and, with withSym, cv (the surrogate, zero mean). */
  function draw(phase, withSym) {
    fill(phase, withSym);
    difference(steps, phase, develop, y);
    if (withSym) difference(symSteps, phase, developLinear, cv);
  }

  /**
   * "lab-cv": mean of Y − C over n plain draws, C the same patch through AHD with linearized CIELAB (approximation: drops E[C]).
   * "lab-cv-anti": adds E[C] estimated on n further draws in antithetic pairs (unbiased).
   */
  function labCv(method, n, random) {
    const out = new Float64Array(3), lc = new Float64Array(3);
    for (let i = 0; i < n; i++) {
      const phase = i % 4;
      for (let d = 0; d < DIMS; d++) u[d] = random();
      fill(phase, false);
      difference(steps, phase, develop, y);
      difference(labSteps, phase, develop, lc);
      for (let ch = 0; ch < 3; ch++) out[ch] += (y[ch] - lc[ch]) / n;
    }
    if (method === "lab-cv") return out;
    for (let i = 0; i < n; i++) {
      const phase = i % 4, j = Math.floor(i / 4);
      if ((j & 1) === 0) { for (let d = 0; d < DIMS; d++) u[d] = random(); saved[phase].set(u); }
      else {
        const prev = saved[phase];
        for (let s = 0; s < SITES; s++) u[s] = 1 - prev[s];
        for (let q = SITES; q < DIMS; q += 2) { u[q] = prev[q]; let t = prev[q + 1] + 0.5; if (t >= 1) t -= 1; u[q + 1] = t; }
      }
      fill(phase, false);
      difference(labSteps, phase, develop, lc);
      for (let ch = 0; ch < 3; ch++) out[ch] += lc[ch] / n;
    }
    return out;
  }

  return function estimate(method, n, seed) {
    const random = sfc32(seed), sum = new Float64Array(3);
    if (method === "lab-cv" || method === "lab-cv-anti") return labCv(method, n, random);
    const withCv = method === "cv" || method === "rqmc-cv";
    const sy = new Float64Array(3), sc = new Float64Array(3), syc = new Float64Array(3), scc = new Float64Array(3);
    const shift = new Float64Array(DIMS);
    for (let d = 0; d < DIMS; d++) shift[d] = random();
    for (let i = 0; i < n; i++) {
      const phase = i % 4, j = Math.floor(i / 4);
      if (method === "rqmc" || method === "rqmc-cv") {
        for (let d = 0; d < DIMS; d++) { let x = (j + 1) * KRONECKER[d] + shift[d]; x -= Math.floor(x); u[d] = x === 0 ? 0.5 / 4294967296 : x; }
      } else if (method === "antithetic" && (j & 1) === 1) {
        // The partner of the previous draw of this phase: u_s → 1 − u_s for counts, angle + ½ turn (z ↦ −z) for read noise.
        const prev = saved[phase];
        for (let s = 0; s < SITES; s++) u[s] = 1 - prev[s];
        for (let q = SITES; q < DIMS; q += 2) { u[q] = prev[q]; let t = prev[q + 1] + 0.5; if (t >= 1) t -= 1; u[q + 1] = t; }
      } else {
        for (let d = 0; d < DIMS; d++) u[d] = random();
        if (method === "antithetic") saved[phase].set(u);
      }
      draw(phase, withCv);
      for (let ch = 0; ch < 3; ch++) {
        sy[ch] += y[ch];
        if (withCv) { sc[ch] += cv[ch]; syc[ch] += y[ch] * cv[ch]; scc[ch] += cv[ch] * cv[ch]; }
      }
    }
    for (let ch = 0; ch < 3; ch++) {
      if (!withCv) { sum[ch] = sy[ch] / n; continue; }
      const my = sy[ch] / n, mc = sc[ch] / n, cov = syc[ch] / n - my * mc, varc = scc[ch] / n - mc * mc;
      const beta = varc > 0 ? cov / varc : 0;
      sum[ch] = my - beta * mc;
    }
    return sum;
  };
}
const saved = [0, 1, 2, 3].map(() => new Float64Array(DIMS));

/** sRGB encoding of a linear value, in 8-bit codes (IEC 61966-2-1). */
export function code8(linear) {
  const x = Math.min(1, Math.max(0, linear));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}
