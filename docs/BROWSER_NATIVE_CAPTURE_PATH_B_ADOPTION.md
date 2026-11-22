# Browser-Native Capture Path-B Adoption and Version Gate

Status: **frozen numerical-method adoption contract for Photivra engine issue #233**.

**In plain terms.** When someone wants to make the browser-based capture (#224) faster, this page decides whether the change only speeds up the same calculation (Path A, allowed under the existing evidence) or actually changes the numerical method (Path B, which needs its own evidence, versioning and approval). The deciding question is whether the maths changes, not whether the code gets faster.

This document defines the final #233 governance boundary between:

- **Path A** — implementation optimization of the already approved discrete
  scientific calculation; and
- **Path B** — a different numerical method for approximating/evaluating the same
  supported physical quantity.

It complements:

- [Browser-First Dense-Pupil Native Capture Qualification Envelope](BROWSER_NATIVE_CAPTURE_ENVELOPE.md);
- [Browser-Native Capture Numerical Acceptance and Evidence Matrix](BROWSER_NATIVE_CAPTURE_NUMERICAL_ACCEPTANCE.md);
- [Browser-Native Capture Prepared-State, Ownership, and Invalidation Contract](BROWSER_NATIVE_CAPTURE_PREPARED_STATE.md);
- [Browser-Native Capture Robust Geometry and Precision Fallback Contract](BROWSER_NATIVE_CAPTURE_ROBUST_GEOMETRY.md);
- [Browser-Native Capture Whole-Event, Batch, Memory, and Failure Accounting Contract](BROWSER_NATIVE_CAPTURE_RESOURCE_ACCOUNTING.md);
- [Public API Style](API_STYLE.md);
- [Numerical Correctness and Physical Units](NUMERICAL_CORRECTNESS.md);
- [Browser-Native Capture Path-A Reference Executor Handoff](BROWSER_NATIVE_CAPTURE_REFERENCE_EXECUTOR_HANDOFF.md).

This is a **governing method/version contract**. It does not select a Path-B
algorithm, activate #236, change the current scientific calculation, change a
public API, bump a version, or establish that any alternative method is accurate.

## Core rule

A change remains **Path A** only when it preserves the same authoritative
discrete mathematical problem.

A change is **Path B** when it changes the numerical problem, estimator, sampling
measure, coverage/filtering semantics, or reproducibility/exactness contract.

Performance motivation does not decide the lane.

Mathematical and scientific semantics decide the lane.

## Path A identity

The currently approved Path-A calculation is defined by the existing committed:

- native site identities;
- spatial quadrature/sample identities and weights;
- shutter/temporal sample identities and weights;
- pupil sample identities and weights;
- wavelength sample identities and wavelength measures;
- source/camera/stage ordering;
- exact CFA/native-site/shutter/seed identities;
- deterministic sensor/noise/ADC ordering;
- required exact RAW/code behavior;
- numerical acceptance matrix;
- resource/admission contract.

Path-A implementation may change **how** that calculation is executed.

It may not silently change **what** is being calculated.

## Path-A-safe optimization examples

A change may remain Path A when the implementation can prove it evaluates the
same committed discrete calculation and preserves every applicable exact/tolerance
contract.

Examples include:

- validating/copying immutable source state once instead of once per sample;
- compact prepared source representations;
- eliminating repeated canonicalization or cloning;
- replacing object-heavy loops with typed-array/batched execution;
- CPU worker execution;
- WebAssembly `f64` execution that passes the same evidence;
- qualified lower-precision backend execution with the frozen fallback rules;
- deterministic loop reordering that preserves required output semantics;
- precomputing a coefficient that is invariant across every use consuming it;
- exact reuse of one wavelength-independent geometry result for two wavelength
  nodes of the **same exact geometric ray/time request**;
- algebraically factoring a term out of the current finite sum when exact
  applicability/invariance is proven;
- analytically simplifying an expression that is mathematically identical to the
  current committed discrete value and does not replace or remove any committed
  sampling measure.

Note (2.28.0, #659): an engine-side WebAssembly executor is not permitted while WebAssembly stays limited to the caller-loaded JPEG XL decoder; revisiting it needs an owner decision and a change to the allowlist in `scripts/lib/webassembly-boundary.mjs`.

A Path-A optimization may reduce **executed** operations.

It does not remove the logical support recorded by the resource-accounting
contract.

## The exact-factorization boundary

Exact factorization is Path A only when it is a refactoring of the same finite
discrete sum.

For a conceptual committed sum

`S = Σ_i Σ_j w_i v_j f(i,j)`,

a transformation may stay Path A when it is proven that, over the declared
supported domain, the same represented quantity is obtained by an algebraically
equivalent evaluation such as reusing a term that is invariant in `j`.

The following do **not** become Path A merely because they are called
“factorization”:

- replacing sampled values with an analytical integral over a dimension;
- dropping committed nodes because a smoothness assumption suggests they are
  redundant;
- averaging source state before local applicability checks;
- changing sample locations or weights;
- interpolating/extrapolating between committed nodes to avoid evaluating them;
- replacing point-sample visibility with filtered/rasterized coverage;
- estimating the sum from a subset of nodes;
- introducing a stochastic estimator for the same integral.

Those are Path B unless an independent proof shows the transformation is exactly
the same committed finite calculation for the entire supported domain.

## Mandatory Path-B triggers

A proposal enters Path-B review if it changes any of the following.

### Sampling support

- number of committed spatial, temporal, pupil, or wavelength samples;
- sample coordinates;
- sample sequence;
- sample pairing/correlation structure;
- quadrature partition;
- wavelength measure;
- source coverage/support.

### Weights or normalization

- quadrature weights;
- pupil weighting;
- temporal weighting;
- spectral measure;
- normalization;
- filtering/coverage kernel;
- estimator weighting.

### Estimator semantics

- replacing the committed finite sum with analytical integration;
- Monte Carlo or quasi-Monte Carlo estimation;
- randomized low-discrepancy sequences;
- stratified/joint sampling that changes the existing sample set;
- deterministic adaptive quadrature;
- data-dependent sample placement;
- control variates;
- importance sampling;
- surrogate/model-based estimation;
- learned approximation.

### Stopping/adaptation

- convergence-driven stopping;
- error-estimate-driven stopping;
- adaptive refinement;
- early termination based on scene/output values;
- device-dependent sample reduction;
- sample-budget selection that changes authoritative output semantics.

### Visibility/coverage semantics

- rasterized coverage replacing exact aperture-origin ray visibility;
- conservative/filtered visibility that changes the sampled quantity;
- coverage masks that replace the current point/ray sample semantics.

### Reproducibility/exactness

- changing deterministic seed schedules;
- adding numerical-method seeds/scrambles;
- changing the reduction contract so existing required exact RAW/code identities
  no longer hold;
- changing which outputs are exact versus tolerance/statistical classes.

### Physical quantity or stage meaning

Any proposal that changes the physical model, source quantity, optics/sensor stage
meaning, coordinate convention, or applicability domain is **more than a Path-B
numerical-method change** and requires the owning scientific/model governance too.

Path B is not permission to change physics.

## Changes that are not Path-B triggers by themselves

These changes do not automatically enter Path B when every Path-A semantic
contract remains unchanged:

- batch/tile width;
- worker scheduling;
- data layout;
- cache eviction policy;
- CPU versus WebAssembly implementation;
- GPU versus CPU execution;
- acceleration structure choice;
- loop fusion/fission;
- deterministic parallelism;
- equivalent stable arithmetic reformulation;
- exact precomputation/reuse under the prepared-state contract;
- robust-geometry fallback that preserves the exact request and approved result
  semantics.

A backend change can still fail Path-A qualification if it changes numerical or
exact output behavior.

## #236 activation gate

Issue #236 is **conditional**, not mandatory release work.

It activates only when at least one documented trigger exists.

Acceptable triggers include:

1. **resource obstruction** — the approved Path-A calculation cannot satisfy the
   frozen whole-event/refinement resource contract after reasonable exact
   implementation optimization;
2. **accuracy obstruction** — a candidate implementation cannot satisfy the frozen
   numerical acceptance while retaining Path-A semantics;
3. **method proposal** — a candidate intentionally changes sampling, weighting,
   coverage/filtering, estimator, stopping, or reproducibility semantics;
4. **backend semantic mismatch** — a backend's useful execution model cannot be
   represented as the same committed Path-A calculation without changing its
   sample/coverage meaning.

A trigger record must cite reproducible evidence.

“Could be faster,” “looks equivalent,” or “common graphics practice” is not a
trigger by itself.

## When #236 is unnecessary

#236 may be explicitly deferred as unnecessary when Path A:

- preserves the approved science;
- satisfies all required BNCE exact/numerical evidence;
- admits the base event and required refinements within existing resource limits;
- satisfies browser/reference/fallback requirements; and
- is sufficiently useful for the approved customer/release envelope.

Deferring #236 because Path A succeeds is a valid disposition.

It is not an incomplete scientific gate.

## Required Path-B method contract

Before implementing a Path-B method for production evaluation, its decision record
must define the method independently of code.

At minimum it must include:

- method name and method-contract version;
- physical quantity being approximated;
- explicit mathematical integral/sum/estimator;
- units;
- source/camera/stage scope;
- supported source assumptions;
- sample domain;
- node/sequence generation;
- weights/normalization;
- seed/scramble identity where applicable;
- adaptation/stopping rule;
- maximum work;
- nonconvergence behavior;
- expected bias/consistency properties;
- error/uncertainty estimator semantics if any;
- reproducibility guarantees;
- relationship to physical sensor-noise seeds;
- fallback/unsupported behavior.

No production implementation should define these semantics accidentally through
code.

## Deterministic Path-B methods

An analytical or deterministic adaptive method still requires Path-B governance
when it changes the committed Path-A numerical problem.

Its evidence must address:

- deterministic bias/error;
- applicability;
- discontinuities and visibility boundaries;
- refinement/convergence behavior where applicable;
- repeatability;
- full-native resource behavior.

“Analytical” does not automatically mean exact over the supported source domain.

## Stochastic Path-B methods

A stochastic or randomized quasi-Monte-Carlo method requires additional identity.

At minimum freeze:

- numerical integration seed;
- scramble/sequence algorithm;
- sequence version;
- sample index mapping;
- whether samples are shared/correlated across sites, wavelengths, frames, or
  paired captures;
- stopping rule;
- maximum samples;
- nonconvergence outcome.

The numerical-method seed is distinct from the physical sensor-noise seed.

Integration randomness must not become simulated shot/read noise.

Changing scheduling/device/batch order must not silently change the declared
integration sequence unless the method contract explicitly makes that change part
of its versioned semantics.

## Error evidence

Path B does not inherit Path-A exactness merely because it targets the same
physical quantity.

The method proposal must predeclare which outputs are evaluated by:

- exact identity;
- deterministic numerical tolerance;
- convergence/refinement;
- statistical confidence/coverage;
- fail-closed behavior.

For stochastic methods, evidence must include multiple independent
seed/scramble realizations where needed to assess variance/bias.

An estimated standard error is not a rigorous bound unless the method and claim
justify that interpretation.

A visually clean image is never numerical qualification evidence.

## Difficult cases

Path-B qualification must include the difficult cases already frozen by #224,
including where applicable:

- aperture-visible slivers;
- translated/subpixel geometry;
- grazing/near-coincident visibility;
- shifted sample phases;
- focus/aperture changes;
- shutter boundaries;
- spectral structure;
- sensor clipping/full-well/ADC thresholds;
- cancellation/resource limits.

A method that performs well only for smooth scenes is not qualified for a
discontinuous-visibility claim.

## Physical sensor noise separation

Qualify Path-B noise-free expected photons/electrons first.

Only after that passes may the existing sensor-noise/ADC stages be applied.

Do not:

- fold integration variance into shot noise;
- denoise an authoritative result to hide integration error;
- tune a numerical integration seed to match expected RAW noise;
- reuse physical-noise randomness as the numerical estimator seed.

For paired A/B captures, Compare, or regression evidence, document whether
integration randomness is paired, independent, or deterministic and why.

## Exact RAW implications

A Path-B method is not automatically required to reproduce every Path-A
intermediate floating-point value.

However, if the product/public contract claims compatibility with an existing
authoritative deterministic RAW output, then the existing exact RAW/code
requirements remain binding.

If a valid alternative numerical method changes authoritative output bytes/codes
under the same declared request, that is a semantic/versioning change.

Do not retrospectively loosen Path-A RAW acceptance to make Path B appear
compatible.

## Resource contract

Any Path-B method must obey the same no-loophole resource governance:

- complete whole-event admission;
- bounded batches;
- bounded memory;
- attempted-work accounting;
- failure/cancellation accounting;
- no split-event budget reset;
- no weaker-device silent scientific downgrade.

Path B does not inherit the rejected four-billion spectral ceiling.

If Path B needs a new resource ceiling, that policy change requires separate
review and cannot be smuggled into the method adoption.

## Version identity

Every Path-B method considered for adoption must have an explicit independent
method/integrator contract version.

The method version must change when any semantic element changes, including:

- sample/sequence generation;
- weights;
- normalization;
- estimator equation;
- stopping/adaptation;
- seed/scramble semantics;
- convergence/nonconvergence behavior;
- supported domain;
- output exactness/reproducibility promise.

Pure implementation optimizations under an unchanged method contract do not
require a method-version change.

## Package/API/SemVer gate

A method-version change and an npm/package version change are distinct decisions.

Before adoption, classify observable impact.

### Internal-only experimental evaluation

A repository-only experiment may use its own explicit method version without
changing the root package API when:

- it is not reachable from the published root/package;
- no public serialized contract changes;
- no existing public request changes meaning;
- no published output guarantee changes.

This is the preferred first evaluation lane for #236.

### Additive public method

Exposing an explicitly opt-in new public method may be additive if:

- existing request semantics and defaults remain unchanged;
- existing serialized data continues to mean the same thing;
- the new method has explicit identity/version fields;
- fallback/default behavior does not silently select it.

The package still receives the normal release version for the release containing
the feature.

### Existing public behavior changes

If the same existing public request begins using a different numerical method and
that change can alter scientific/output semantics, reproducibility, exact RAW, or
serialized meaning, it is a public semantic change.

It requires:

- explicit compatibility review;
- relevant schema/contract version change;
- changelog/migration documentation;
- package SemVer treatment consistent with [API_STYLE.md](API_STYLE.md).

After package 1.0, a breaking root-public-contract change requires the normal
major-version process.

Do not label a scientifically meaningful behavior change “internal” solely
because TypeScript signatures are unchanged.

## Default-selection gate

A Path-B method may not become the default merely because it passes isolated tests
or benchmarks.

Default adoption requires:

- complete method-specific qualification;
- full supported base/refinement evidence;
- measured resource behavior;
- compatibility/version review;
- downstream/source/device implications understood;
- explicit owner scientific/product approval.

Until then, experimental evaluation remains opt-in/repository-only or absent.

## Migration requirements

When adoption changes observable behavior, document:

- old method identity;
- new method identity;
- old versus new supported domains;
- expected numerical/output differences;
- deterministic/stochastic reproducibility differences;
- seed migration;
- serialized capture/plan compatibility;
- fallback behavior;
- whether old behavior remains selectable;
- downstream requalification required.

Historical evidence remains bound to the method/version that produced it.

Do not reinterpret old evidence as evidence for a new method.

## Scientific approval gate

No Path-B method becomes production-authoritative without explicit
method-specific scientific approval after its evidence is available.

Approval of this governance document is **not** approval of any future method.

Approval must identify:

- method/version;
- supported envelope;
- evidence record;
- known limitations;
- compatibility/version disposition.

Contribution-specific DCO/review remains required for the actual implementation
contribution.

## Stable Path-B evidence IDs

The following stable evidence labels refine BNCE-PATHB-001.

| Evidence ID | Requirement |
| --- | --- |
| **BNCE-PATHB-001-A** | Trigger record identifies why Path B is being evaluated or explicitly records that it is unnecessary. |
| **BNCE-PATHB-001-B** | Method equation/estimator, support, weights, normalization, and method version are frozen before production implementation. |
| **BNCE-PATHB-001-C** | Seed/scramble/stopping/nonconvergence identity is frozen for stochastic/adaptive methods. |
| **BNCE-PATHB-001-D** | Independent analytical/reference and difficult-case evidence is predeclared and executed. |
| **BNCE-PATHB-001-E** | Numerical/integration uncertainty remains separate from source/calibration and physical sensor noise. |
| **BNCE-PATHB-001-F** | Full-native base/refinement work, memory, cancellation and failure behavior satisfies the approved resource contract. |
| **BNCE-PATHB-001-G** | Exact/tolerance/statistical output classes and any RAW compatibility consequences are explicit. |
| **BNCE-PATHB-001-H** | API/schema/method/package version and migration disposition is documented. |
| **BNCE-PATHB-001-I** | Method is explicitly selected, rejected, or deferred as unnecessary; no silent adoption. |
| **BNCE-PATHB-001-J** | Production/default adoption has method-specific scientific approval and contribution-specific review/DCO. |

These evidence IDs are governance labels, not public API identifiers.

## Decision outcomes

A Path-B study must end in one explicit disposition.

### Selected

The method meets its declared evidence and is approved for a named supported
scope/version.

Selection does not automatically make it public or default.

### Rejected

The method does not meet scientific, resource, compatibility, or customer
requirements.

Record why.

Do not weaken acceptance criteria to avoid rejection.

### Deferred as unnecessary

Path A satisfies #224 and no changed numerical method is needed.

Record the evidence supporting that conclusion.

This disposition allows #236 to remain unimplemented.

## Relationship to #234 and #235

The #234 float64 reference is Path A.

#234 must not introduce a changed quadrature/estimator to solve resource pressure.

If implementation profiling uncovers a genuine Path-A obstruction, record it as a
possible #236 trigger rather than silently changing the method.

#235 candidate browser backends are also Path A only when they preserve the same
committed numerical semantics.

A backend that needs different coverage/filtering/sample semantics enters Path B
before adoption.

## Acceptance for this #233 final governing slice

This governing slice is complete when reviewed and merged with:

- [x] exact Path-A versus Path-B boundary;
- [x] explicit mandatory Path-B triggers;
- [x] exact-factorization boundary;
- [x] conditional #236 activation and valid “unnecessary” disposition;
- [x] required method equation/applicability/seed/stopping contract;
- [x] deterministic and stochastic evidence rules;
- [x] sensor-noise separation;
- [x] exact RAW/version implications;
- [x] resource-policy preservation;
- [x] independent method-version identity;
- [x] package/API/SemVer classification gate;
- [x] migration/default-selection gates;
- [x] explicit method-specific scientific approval;
- [x] BNCE-PATHB-001-A…J evidence labels;
- [x] selected/rejected/deferred decision outcomes.

This checklist freezes governance only.

The
[reference-executor handoff](BROWSER_NATIVE_CAPTURE_REFERENCE_EXECUTOR_HANDOFF.md)
is that final reconciliation: it confirms the merged source/camera, numerical,
prepared-state, robust-geometry, resource, and Path-B contracts are internally
consistent and provides #234 an implementation target without inventing scientific
policy in code.
