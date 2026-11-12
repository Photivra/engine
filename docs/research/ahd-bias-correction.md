# Research: a per-site AHD bias correction without a lookup table (#604)

Status: research report, November 11, 2026, on `release-2.22.0` (`e3f1ff71`). It changes no engine behavior. The
prototype is repository-only code in `scripts/research/ahd-bias/` and is not in the published package. Outcome: #604
is closed and the view keeps 2.22.0's labeled approximation (see "Recommendation").

## Question

2.22.0 removed the display view's AHD low-signal correction, which was kept as precomputed values on a grid of the three
channel signal levels ([DISPLAY_VIEW.md, "AHD at low signal"](../DISPLAY_VIEW.md#ahd-at-low-signal)). Can the same correction
be computed **per site at use**, with no table indexed by channel signal levels, accurately enough and fast enough to put
back? Cached data may only be non-signal data (CFA roles, the sites AHD reads, random or lattice generators).

## The quantity

For a flat neighborhood whose sites of channel c have normalized mean μ_c, each site drawn as
k_c·Poisson(μ_c / k_c) + σ_c·N(0, 1) and clipped at 1, the correction is

  b(μ) = E[ h(AHD) − ½ h(H) − ½ h(V) ]  at the patch center, averaged over the four Bayer phases,

where H and V are AHD's two candidates, AHD picks one by homogeneity in CIELAB (Hirakawa and Parks 2005), and h is the
view's development (white balance, highlight clip, color matrix, tone curve, clip to [0, 1]). This is the definition 2.21.0
used. The prototype ports 2.21.0's `createAhdCentreSteps` and development unchanged (from `src/facade/display-view.ts`
before `a33fea43`). It reads each case's readout, gains, matrices and channel means from the engine's own display-view
setup (`capture-setups.research.ts`).

**Check against 2.22.0's measurement.** On the 1.4 µm 18 % gray ISO 6400 case, the reference b is −3.98 ± 0.03 codes in red,
and green and blue are within 0.04. That matches the documented shift of the view (red +3.8 to +4.2). The other cases
match too (table below), so the prototype computes the same quantity the removed correction did.

## Cases

All are f/8 flat fields. "Exact" is plain Monte Carlo with 2²⁰ draws, with its standard error. Values are in 8-bit sRGB
codes at the view's base value.

| Case | Electrons per site (R, G, B) | Exact b (R, G, B) | 2.22.0 measured shift |
| --- | --- | --- | --- |
| 1.4 µm, 18 % gray, ISO 6400, 1/8000 s | 6.5, 6.7, 3.7 | −3.98, −0.04, +0.04 (± 0.03) | red +3.8 to +4.2 |
| 1.4 µm, 3 % gray, ISO 6400, 1/8000 s | 1.1, 1.1, 0.6 | −1.36, −1.58, −2.54 (± 0.04) | −0.9, −1.6, −2.2 (sign: the correction raised them) |
| 6 µm, 18 % gray, ISO 6400, 1/8000 s | 119, 123, 68 | −0.21, +0.03, +0.06 (± 0.01) | within 0.26 |
| 6 µm, 3 % gray, ISO 6400, 1/8000 s | 20, 20, 11 | +0.03, −0.09, −0.16 (± 0.01) | within 0.26 |
| 6 µm, 18 % gray, ISO 400, 1/500 s | 1903, 1961, 1092 | −0.01, 0.00, 0.00 | within 0.001 to 0.01 |

## Where the bias comes from (measured decomposition)

Each step's nonlinearity is switched off in turn, with 2¹⁸ draws (standard error 0.03 to 0.07 codes on the phone cases).

| Nonlinearity removed | 1.4 µm 18 % (R, G, B) | 1.4 µm 3 % (R, G, B) | 6 µm 18 % ISO 6400 (R) |
| --- | --- | --- | --- |
| none (exact) | −3.98, −0.04, +0.04 | −1.36, −1.58, −2.54 | −0.21 |
| Poisson skew (Gaussian counts) | −4.21, −0.02, −0.01 | −2.00, −1.46, −2.42 | −0.25 |
| site clip at white | −3.95, −0.06, +0.01 | −1.35, −1.64, −2.58 | −0.20 |
| development (linear h) | −3.17, +0.01, +0.12 | +2.99, −1.45, −3.76 | −0.20 |
| **CIELAB cube root (tangent at μ)** | **0.00, −0.19, −0.20** | −0.78, −0.42, −0.40 | +0.04 |

The cube root in AHD's homogeneity test causes almost all of the bias. Poisson skew and the site clip change it by no more
than their standard errors at 18 % gray. The development's clip at black matters only near black (3 % gray). With Gaussian
noise, a linear CIELAB and a linear development, the bias is exactly zero: the homogeneity test is even in the noise and the
candidate difference is odd. The prototype confirms this, and it is the basis of the control variate below.

The bias also scales with the relative noise variance. The 6 µm sites hold 18.4 times the electrons of the 1.4 µm sites,
and the red bias is 18.8 times smaller (−3.98 vs −0.21). That is the second-order behavior the delta method predicts.

## Candidates surveyed

| Method | Source (open) | Applies to this quantity? |
| --- | --- | --- |
| Delta method / second-order Taylor bias | Owen 2013 (ratio estimates) | Only to the smooth steps (development, CIELAB), which the view already propagates with clipped-normal moments. AHD's choice is a count of threshold tests, a step function of 105 noisy sites: its Taylor terms are surface integrals over the tie set, with no closed form. It explains the σ² scaling but cannot evaluate b. Not prototyped as an estimator. |
| Saddlepoint / Edgeworth expansions | Daniels 1954 | They correct the distribution of sums for skew. The decomposition shows Poisson skew moves b by ≤ 0.23 codes at 18 % gray, so they target a negligible part and leave the cube root–choice interaction alone. Not prototyped. |
| Closed-form moments of clipped variables | engine: DISPLAY_VIEW.md, "Development" | Already used for the development. The site clip contributes ≤ 0.05 codes here. Nothing left to gain. |
| Antithetic variates | Owen 2013, §8.2 | Yes: counts u ↦ 1 − u, read noise z ↦ −z (Box–Muller angle + ½ turn; Box and Muller 1958). Prototyped. |
| Control variates | Owen 2013, §8.9 | Yes. Prototyped two: **cv**, a symmetric surrogate on the same uniforms (Gaussian quantile-coupled counts, tangent CIELAB, linear development) whose mean is exactly 0 (quantile from Abramowitz and Stegun 26.2.23 and 7.1.26, made exactly antisymmetric); **lab-cv**, the same drawn patch through AHD with tangent CIELAB (approximation: it drops that surrogate's own mean, 0.0 to 0.8 codes from the decomposition). |
| Randomized quasi-Monte Carlo | Owen 2023 (Practical QMC): lattices, Cranley–Patterson rotation | Prototyped: a Kronecker (Richtmyer) lattice frac(n·√p_d) in 211 dimensions with a random shift per evaluation, phases stratified. Scrambled Sobol' needs direction-number data, not added for a test that already showed little gain. |
| Importance sampling | Owen 2013, ch. 9 | The bias lives on the near-tie set of a 105-site, 36-test count. No proposal that targets it is known, and a poor one raises the variance. Not prototyped. |

## Results

64 independent repetitions per row. RMS error against the exact value in codes (R, G, B). Cost is measured per evaluation
(one site, single thread; Node 24.19.0, Apple M5 Pro). One draw costs 6.8 µs (1.4 µm) to 9.6 µs (6 µm). The "VR" column is
the variance reduction against plain MC at 1024 draws, on the worst channel. "Draws for 0.5" is the draw count for 0.5 code
RMS on the worst channel, extrapolated as 1/√N from 1024 (all estimators except lab-cv are unbiased). "Frame" is that cost
times 393 216 evaluations: one per display pixel of a 768 × 512 view, which is the floor. The pixel's 16 samples at
K = 4 could split the draws, but the total stays the same.

**1.4 µm, 18 % gray, ISO 6400** (no correction: error 3.98 codes in red):

| Method | RMS at 1024 draws | VR | Draws for 0.5 | ms per site | Frame, CPU, 1 thread |
| --- | --- | --- | --- | --- | --- |
| mc | 0.83, 0.31, 0.47 | 1.0 | 2840 | 21 | 8 350 s |
| antithetic | 0.60, 0.31, 0.43 | 1.9 | 1480 | 10 | 3 930 s |
| rqmc (Kronecker) | 0.73, 0.34, 0.45 | 1.3 | 2170 | 12 | 4 840 s |
| cv (symmetric surrogate) | 0.77, 0.26, 0.37 | 1.2 | 2440 | 32 | 12 600 s |
| lab-cv | 0.76, 0.39, 0.47 | 1.2 | 2390 | 20 | 7 850 s |

**1.4 µm, 3 % gray, ISO 6400** (no correction: error up to 2.54 codes):

| Method | RMS at 1024 draws | VR | Draws for 0.5 | ms per site | Frame |
| --- | --- | --- | --- | --- | --- |
| mc | 1.07, 0.48, 0.73 | 1.0 | 4710 | 33 | 12 800 s |
| antithetic | 0.94, 0.45, 0.73 | 1.3 | 3580 | 22 | 8 820 s |
| rqmc | 1.06, 0.47, 0.57 | 1.0 | 4590 | 24 | 9 490 s |
| cv | 1.03, 0.45, 0.71 | 1.1 | 4360 | 62 | 24 200 s |
| lab-cv | 1.35, 0.56, 0.70 | 0.6 | 7460 | 59 | 23 100 s |

**6 µm** (no correction: error ≤ 0.21 codes at ISO 6400, 0.01 at ISO 400). Antithetic draws reduce the variance 5.1×
(18 %, ISO 6400), 2.8× (3 %, ISO 6400) and 9.7× (ISO 400), and the symmetric control variate 3.7×, 1.9× and 11.8×. There
is little to correct, though: at 64 draws antithetic is 0.41 codes RMS against a bias of 0.21, so the correction adds more
error than it removes. Under 2.21.0's noise gate (pixel noise above 0.01 linear) the ISO 400 case would not be corrected at all.

The variance reduction is largest where the noise is smallest. There the choice almost never flips, so the odd part of the
estimator that antithetic pairs and the zero-mean surrogate cancel is nearly all of its variance. At phone noise levels the
choice flips often: one draw's spread is about 30 codes in red against a 4-code bias. That variance belongs to the flip events,
which no method here cancels: 1.0 to 1.9×, in line with 2.22.0's 1.0 to 2.9× for antithetic draws.

**Per-frame cost on the phone case.** The best candidate (antithetic, 1 480 draws per site) costs about 10 ms per site and
65 minutes per 768 × 512 frame on one CPU thread. Relaxing to 1 code RMS takes about 16 minutes. 2.21.0's grid needed
about 0.2 s for a 32 × 32 block. The app's 6 µm ISO 400 request needs no correction (bias 0.01 code, below the noise gate).

**GPU.** The estimator is embarrassingly parallel: one invocation per site and draw, about 105 sampled sites, 42 CIELAB
conversions (126 cube roots) and 36 threshold tests per draw, with no shared state. It fits WGSL compute. The phone frame
needs about 5.8 × 10⁸ draws (393 216 × 1 480). GPU throughput was **not measured** here, so no frame time is claimed. The
GPU's float32 cube roots and transcendental functions would also need the engine's portable-bits treatment, or a
documented tolerance.

## Recommendation

**None of the candidates is worth building as a CPU correction.** The cube root–choice interaction carries the bias, and no
surveyed method beats plain Monte Carlo variance by more than 1.9× at phone noise levels, so a per-site correction costs
10–20 ms per site. That is 3–4 orders of magnitude over the view's budget. The analytic methods (delta method, saddlepoint,
Edgeworth, clipped moments) address the parts the decomposition shows are negligible or already modeled.

If the owner wants a correction anyway, the only candidate whose cost might fit is a **GPU-only per-site antithetic
estimator**, measured first:

- **Fast variant** (fast-methods registry, default): antithetic, 256 draws per site, applied only where pixel noise exceeds
  0.01 linear (2.21.0's gate). Measured: 1.4 codes RMS in red on the phone case (from 3.98 uncorrected).
- **Full variant** (`fast: false`, always built): antithetic, 2048 draws per site, the same gate. Extrapolated from the
  1024-draw row: about 0.42 codes RMS in red.
- CPU: the full variant as a reference path for tests only, or the current labeled approximation.

Until then, keep 2.22.0's labeled approximation (`lowSignalNoiseChoice: "not-modelled"`).

## How it would be tested

- The flat-neighborhood estimator against a 2²⁰-draw reference (this script's method) on the five cases above, with
  fixed seeds: RMS within the variant's stated limit per channel, no NaN or Infinity.
- The rendered view against box-downsized captures (the existing `display-view.test.ts` low-signal case, whose limit of 5
  codes covers today's 4.25), with the limit tightened to what the variant reaches.
- Antithetic structure: an exact test that the estimator gives 0 with Gaussian counts, tangent CIELAB and linear
  development, the symmetry argument above.
- GPU against CPU on the same draws within a stated float32 tolerance, and a hash lock per backend.
- A guard (test or lint) that no correction state is keyed by channel signal levels or stored across sites.

## Reproduce

```sh
npx vitest run --config scripts/research/ahd-bias/vitest.research.config.ts   # writes setups.json
node scripts/research/ahd-bias/ahd-bias.mjs --reps 64 --budgets 64,256,1024   # about 2 minutes
```

The run behind this report is `scripts/research/ahd-bias/results-2026-11-11.jsonl`.

## Sources

Open access or public domain, except Hirakawa and Parks, which the engine already cites for AHD itself.

- K. Hirakawa and T. W. Parks, "Adaptive homogeneity-directed demosaicing algorithm", IEEE Trans. Image Processing 14(3),
  2005: the AHD steps, as the engine already cites them.
- A. B. Owen, *Monte Carlo theory, methods and examples*, 2013, free online at <https://artowen.su.domains/mc/>:
  antithetic variates (§8.2), control variates (§8.9), importance sampling (ch. 9), the delta method for ratio estimates.
- A. B. Owen, *Practical Quasi-Monte Carlo Integration*, 2023, free online draft at <https://artowen.su.domains/mc/>:
  lattice and Kronecker rules, random shifts (Cranley–Patterson rotation), randomized QMC error estimates.
- H. E. Daniels, "Saddlepoint approximations in statistics", Ann. Math. Statist. 25(4), 1954 (Project Euclid, open).
- G. E. P. Box and M. E. Muller, "A note on the generation of random normal deviates", Ann. Math. Statist. 29(2), 1958
  (Project Euclid, open).
- M. Abramowitz and I. A. Stegun, *Handbook of Mathematical Functions*, NBS 1964 (US government work), 7.1.26 and 26.2.23.
- sfc32 (C. Doty-Humphrey, PractRand, public domain) and the MurmurHash3 finalizer (A. Appleby, public domain): the
  prototype's random streams.
