# Browser-Native Capture Path-A Reference Executor Handoff

Status: **final reconciled #233 implementation handoff to #234**.

**In plain terms.** Six contracts (listed below) set the rules for the browser-based, full-resolution capture work (#224). This page checks that those rules agree with each other, and turns them into one concrete target for the first implementation: a compact, float64 reference executor (issue #234) that follows the approved calculation exactly ("Path A", defined in the [qualification envelope](BROWSER_NATIVE_CAPTURE_ENVELOPE.md)).

This document is the canonical implementation handoff produced after the merged
#233 governing work for the browser-first dense-pupil native-capture qualification
tracked by #224.

It reconciles, without changing, the following merged contracts:

- [Qualification envelope](BROWSER_NATIVE_CAPTURE_ENVELOPE.md);
- [Numerical acceptance and evidence matrix](BROWSER_NATIVE_CAPTURE_NUMERICAL_ACCEPTANCE.md);
- [Prepared-state, ownership, and invalidation contract](BROWSER_NATIVE_CAPTURE_PREPARED_STATE.md);
- [Robust geometry and precision fallback contract](BROWSER_NATIVE_CAPTURE_ROBUST_GEOMETRY.md);
- [Whole-event, batch, memory, and failure accounting contract](BROWSER_NATIVE_CAPTURE_RESOURCE_ACCOUNTING.md);
- [Path-B adoption and version gate](BROWSER_NATIVE_CAPTURE_PATH_B_ADOPTION.md).

This handoff does **not** implement #234, qualify #224, select a GPU backend,
activate #236, change a public API, or raise a resource ceiling.

## Reconciliation result

The six governing contracts are mutually consistent for one Path-A
implementation target.

No unresolved policy contradiction remains between:

- source/camera/stage scope;
- exact versus tolerance-governed evidence;
- prepared-state ownership/reuse;
- robust visible-surface identity and fallback;
- whole-event work/memory/failure accounting;
- Path-A versus Path-B method classification.

Accordingly, #234 may implement the compact float64 reference without inventing
new scientific policy in code.

Any future implementation decision that falls outside this handoff must stop and
return to the owning governing contract instead of silently choosing a new rule.

## #234 implementation objective

Build one compact, browser-worker-usable **Path-A float64 reference executor and
fallback** for the frozen #224 source/camera envelope.

The executor must:

1. preserve the committed Path-A discrete scientific calculation;
2. validate and own reusable inputs once at the correct semantic scope;
3. execute bounded batches without materializing the full Cartesian product;
4. use the existing sensor/readout/RAW stages rather than duplicate them;
5. expose truthful work/resource/failure evidence;
6. produce complete authoritative native RAW only after successful whole-event
   execution;
7. remain usable as the numerical/reference fallback for later #235 browser
   backend comparison.

The first implementation may remain repository-internal.

No new root public prepared-state, geometry, or executor API is required for #234.

## Frozen Path-A scientific identity

The #234 reference must preserve the existing committed identities and measures.

### Native and spatial identity

Preserve:

- absolute native raster/site identity;
- native CFA/color-site phase and binding;
- current spatial quadrature identities and weights;
- pre-AA spatial/source coordinate semantics;
- no crop-local or output-local reinterpretation.

### Temporal identity

Preserve:

- existing global/native-scan shutter semantics;
- exact local opening/closing/event identity;
- committed temporal node identities and weights;
- opening-reference/source timing rules.

### Pupil identity

Preserve:

- the committed ideal circular-pupil sample identities;
- pupil sample counts and normalized weights;
- actual aperture-origin rays;
- focus-aware ray geometry;
- no pinhole-depth plus post-process blur substitute.

### Spectral identity

Preserve:

- committed wavelength nodes and measures;
- wavelength basis/support;
- per-node source spectrum, optics, response, applicability, and photon-energy
  semantics;
- no hidden spectral clipping/extrapolation/zero-fill.

### Sensor/RAW identity

Preserve:

- existing response/operating-range gates;
- photon/electron stage ordering;
- dark current, physical stochastic noise, readout, capacity, ADC, clipping and
  rounding behavior;
- absolute seed schedule;
- exact required RAW/code outputs;
- no numerical-method randomness mixed into physical sensor noise.

## Frozen source/camera envelope

The first #234 reference supports the source/camera scope frozen by the envelope.

### Supported source

Initially:

- finite explicit metric opaque analytic primitives;
- bounded planar rectangles;
- boxes;
- deterministic stable primitive IDs;
- static geometry during one capture event;
- wavelength-independent visibility;
- explicit outgoing spectral radiance;
- local deterministic side-effect-free source evaluation.

### Unsupported source behavior

Do not add or approximate:

- transparency/transmission;
- scene refraction;
- participating media;
- fluorescence/wavelength conversion;
- wavelength-dependent geometry/visibility;
- indirect/global illumination;
- arbitrary shaders;
- moving source geometry;
- network/file/persistence source evaluation.

Unsupported source state fails closed.

### Supported camera/optics

Use the existing:

- ideal rectilinear focus-aware mapping;
- focal length/f-number/focus contracts;
- circular pupil;
- native sensor raster;
- shutter/readout semantics;
- sensor response/noise/ADC contracts.

The initial Focus/Depth qualification remains zero camera translation and zero
camera rotation.

Do not silently introduce lens distortion, focus breathing, arbitrary PSF,
diffraction/aberration, dispersive ray directions, or commercial calibration.

## Prepared-state implementation target

#234 should implement the smallest internal structure that preserves the merged
prepared-state semantics.

Conceptually it must own the equivalent of:

- source representation;
- optical/sample basis;
- spectral/response basis;
- sensor/native-frame basis;
- exposure schedule;
- event plan;
- bounded batch scratch.

These do not have to be seven runtime objects.

### Validate and own before execution

Copy/parse/validate the full scientific dependency set before it becomes reusable
prepared state.

Do not use `freezeOwnedData()` as a substitute for parsing or copying.

Prepared state must not hold caller-mutable references.

### Required dependency identity

Reuse/invalidation must cover the dependencies frozen in the prepared-state
contract, including:

- source representation/version/state/primitive definitions;
- camera/focus/aperture/focal length/pupil;
- sensor/native raster/CFA/response;
- wavelength basis/support;
- shutter/event/sample identities;
- integrator/method identity;
- precision policy;
- applicable evidence/profile identity.

### Reuse boundaries

The first implementation may reuse only terms proven invariant.

In particular:

- wavelength-independent visibility may be reused across wavelength nodes only
  for the same exact geometric ray/time request;
- wavelength-dependent source/optics/sensor work still executes;
- site/ray/time-dependent visibility is not globally cached;
- local operating-range/applicability checks remain local;
- stochastic sensor realization and RAW are never cross-event cache entries.

Correctness must not depend on a persistent cross-event cache.

## Geometry implementation target

The float64 CPU reference owns Path-A computational geometry for #234.

It must implement/qualify the analytic rectangle/box semantics frozen by the
robust-geometry contract.

### Exact geometry semantics

Exact semantic outcomes include:

- hit versus miss;
- visible primitive ID;
- source/request identity;
- supported/ambiguous/unsupported disposition.

A different visible primitive is not a tolerance-acceptable result.

### Numerical geometry quantities

Hit distance, point, and local coordinates are tolerance-governed only under the
BNCE geometry rules.

Do not invent one global epsilon.

### Degenerate/ambiguous source state

Reject or fail closed for:

- invalid/degenerate primitive geometry;
- singular transforms;
- non-finite geometry;
- missing boundary semantics;
- exact coincident first surfaces of distinct primitives when no source-level
  priority exists.

### Lower-precision fallback interface

#234 itself is the float64 reference, but its geometry interface/evidence must be
usable later by #235.

The later candidate/fallback contract is:

- candidate unambiguous result may be used only when justified;
- candidate ambiguity recomputes the exact request on the float64 reference;
- candidate “confident” disagreement with the reference is a backend defect;
- source-semantic ambiguity remains unsupported even in float64.

## Whole-event admission and work accounting

#234 must implement the merged resource-accounting semantics directly.

### Preserve existing limits

Do not raise or reinterpret:

- 24,000,000 native-site raster maximum;
- 16,384 maximum native dimension;
- 1–256 native-site execution tile width;
- current packed RAW payload accounting;
- the existing **2,000,000,000 whole-event provider-evaluation ceiling**, together
  with the resource contract's rule that decomposing/renaming that scientific
  work does not authorize a larger replacement ceiling;
- the existing **100,000 per-source-tile logical provider-evaluation bound**.

The repository-only proposed four-billion spectral-composition ceiling remains
**rejected** for #224.

### Logical support remains visible

Record the committed logical support even when exact preparation/factorization
reduces actual executed work.

The frozen full-native base has:

- 2048 × 1366 = **2,797,568 native sites**;
- 4 spatial nodes;
- 1 temporal node;
- 128 pupil nodes;
- 2 spectral nodes;
- **2,864,709,632 logical committed source samples**.

Historical separable-prototype arithmetic recorded:

- **1,432,354,816** factorized geometry evaluations;
- **2,864,709,632** spectral compositions.

Those numbers are evidence of the obstruction, not an authorization to adopt the
experimental four-billion ceiling.

### Planned and attempted work

Before authoritative source execution, create or conservatively bound the event
plan.

Record at minimum the equivalent of:

- planned unique geometry work;
- planned spectral/optical work;
- planned sensor-site work;
- bounded batch work;
- applicable fallback allowance;
- memory capacities.

During execution, monotonically count actual attempts.

A failing callback/operation counts once it has begun.

Candidate geometry plus float64 fallback are two attempted operations.

### No budget loopholes

Do not:

- split one capture into pseudo-events to reset budgets;
- rename work to avoid a ceiling;
- hide dynamic work as preparation;
- use smaller tiles to erase aggregate work;
- discard failed attempts from evidence.

## Memory implementation target

#234 must bound explicitly sized engine-owned memory.

Account separately for:

- packed output;
- immutable prepared numeric buffers;
- event plan;
- batch scratch;
- cache capacity;
- in-flight provider/source buffers;
- fallback scratch;
- diagnostics/evidence buffers.

Do not claim an exact JavaScript object/heap size from field counts.

Report deterministic contract-accounted bytes separately from empirical
heap/RSS/runtime measurements.

The full spatial × temporal × pupil × spectral Cartesian product must not be
materialized.

## Failure, cancellation, and output atomicity

#234 must preserve existing atomic task semantics.

For failure/cancellation/disposal:

- count work already attempted;
- do not count work never started;
- signal pending provider/observer/backend work where supported;
- reject late results after terminal transition;
- withhold all authoritative partial RAW;
- release owned output/scratch according to task lifecycle;
- do not reset event budgets on retry/fallback.

A completed authoritative result is exposed only after the whole event succeeds.

## Path-A-only implementation rule

#234 is strictly Path A.

The following implementation work may remain Path A if it preserves the same
committed finite calculation:

- prepared-state reuse;
- exact algebraic factorization;
- data-layout changes;
- worker execution;
- WebAssembly f64;
- bounded batching;
- deterministic loop reordering;
- exact invariant coefficient precomputation;
- wavelength-independent geometry reuse under the frozen conditions.

Note (2.28.0, #659): an engine-side WebAssembly executor is not permitted while WebAssembly stays limited to the caller-loaded JPEG XL decoder; revisiting it needs an owner decision and a change to the allowlist in `scripts/lib/webassembly-boundary.mjs`.

The following may **not** be introduced in #234 without entering the Path-B gate:

- changed sample coordinates/counts/weights;
- analytical replacement of a sampled dimension;
- Monte Carlo/quasi-Monte-Carlo estimation;
- adaptive quadrature/stopping;
- filtered/rasterized visibility replacing committed ray samples;
- device-dependent scientific sample reduction;
- changed reproducibility/exactness semantics.

If such a change appears necessary, record the obstruction for possible #236
activation.

Do not silently solve it inside #234.

## #236 disposition during #234

#236 remains conditional.

#234 does not need to implement or complete #236 before starting.

During #234:

- if Path A fits and satisfies the evidence/resource envelope, #236 remains
  unnecessary;
- if profiling or qualification exposes a documented Path-A resource/accuracy
  obstruction, record the trigger;
- if a proposed optimization changes numerical-method semantics, route it to
  Path-B/#236 before adoption.

A failed Path-A case is evidence, not permission to weaken accuracy or raise
ceilings.

## Required #234 evidence

#234 implementation should bind tests/evidence to the existing BNCE identifiers.

At minimum:

### Exact/reproducibility

- BNCE-ID-001;
- BNCE-CFA-001;
- BNCE-SEED-001;
- BNCE-SAMPLE-001;
- BNCE-WORK-001;
- BNCE-RAW-001;
- BNCE-CHUNK-001;
- BNCE-MUTATE-001;
- BNCE-SERIAL-001.

### Physical numerical reference

- BNCE-PHOTON-001;
- BNCE-ELECTRON-001;
- BNCE-TIME-001;
- BNCE-PUPIL-001.

### Geometry

- BNCE-GEO-001 plus A–E subcases;
- BNCE-GEO-002 plus A–H subcases;
- BNCE-FALLBACK-001 where lower-precision fallback is exercised later.

### Whole-event/resource

- BNCE-RES-001 through BNCE-RES-010;
- BNCE-CANCEL-001;
- BNCE-FAIL-001.

### Complete scientific cases

- BNCE-BASE-001;
- BNCE-REF-PUPIL-001;
- BNCE-REF-TIME-001;
- BNCE-FOCUS-001;
- BNCE-APERTURE-001.

The required complete cases remain evidence targets.

This handoff does not claim they already pass.

## First bounded #234 work sequence

The implementation should proceed in this order unless measured evidence justifies
a smaller equivalent decomposition.

### 1. Profile the owned reference path

Measure and separately attribute:

- parsing/validation/ownership;
- canonicalization/fingerprinting;
- source geometry;
- source spectrum;
- optical/spectral arithmetic;
- allocation/GC;
- sensor processing;
- output;
- yielding/batching.

Use existing owned small cases first.

Do not extrapolate tiny-case time as full-native qualification.

### 2. Build the compact prepared plan

Create repository-internal immutable prepared state with complete invalidation
identity.

Avoid new root public exports.

### 3. Implement float64 analytic source geometry

Implement/anchor rectangle and box geometry with independent analytical fixtures,
degenerate/ambiguous fail-closed handling, and exact primitive identity.

### 4. Implement exact Path-A reuse/factorization

Apply only invariants already frozen by the contracts.

Start with the approved wavelength-independent visibility reuse boundary and other
measured duplicated preparation/coefficient work.

Do not remove committed logical sample support.

### 5. Stream bounded execution batches

Use compact buffers and bounded work/memory.

Preserve legal chunk invariance and output atomicity.

### 6. Reuse existing sensor/RAW stages

Do not duplicate the sensor-noise/readout/ADC model.

Feed qualified expected signal into the existing authoritative downstream stages.

### 7. Add evidence/accounting output internally

Produce enough repository-internal evidence to evaluate the BNCE work/resource
requirements and hand #235 a stable reference revision.

### 8. Run complete base/refinement evidence

Only complete events establish the parent qualification evidence.

Explicit rejection/unsupported is a valid measured outcome but not a passing
qualification.

## Stop conditions during #234

Stop and update governance rather than guessing when:

- a required numerical tolerance is still undefined;
- a source/geometry boundary is outside the frozen envelope;
- a needed reuse invariant is unproven;
- a requested optimization changes Path-A method semantics;
- the existing resource policy cannot admit the event;
- public API/schema/version changes become necessary;
- a new scientific effect is required.

The implementation must not make those policy decisions implicitly.

## #234 completion handoff to #235

When #234 is ready to hand off to #235, provide:

- exact reference executor revision/commit;
- prepared-state/version identity;
- complete owned source fixtures;
- reference expected values;
- BNCE evidence mapping and results;
- exact geometry oracle evidence;
- work/resource accounting;
- complete base/refinement dispositions;
- known unsupported cases;
- measured cold/warm reference execution characteristics;
- deterministic compatibility/RAW/seed/chunk results.

#235 compares candidate browser backends against that reference.

#235 does not redefine the reference science.

## Public/package boundary

The reconciled #233 contracts do not require any new root public API for #234.

If implementation later demonstrates a need for public prepared/source/executor
types, that is a separate reviewed API/schema/version decision.

Repository-internal implementation is preferred until scientific and resource
evidence establishes a stable contract worth exposing.

## #233 reconciliation acceptance

The #233 governance package is reconciled when this handoff and the companion
documents agree that:

- [x] the source/camera/stage envelope is fixed;
- [x] exact/tolerance/convergence/failure evidence classes are fixed;
- [x] prepared-state ownership/reuse/invalidation is fixed;
- [x] robust geometry/fallback is fixed;
- [x] whole-event/batch/memory/failure accounting is fixed;
- [x] Path-A versus Path-B adoption/version rules are fixed;
- [x] existing resource ceilings remain unchanged;
- [x] the proposed four-billion spectral ceiling remains rejected;
- [x] #236 remains conditional;
- [x] #234 has one explicit Path-A implementation/evidence target;
- [x] #235 has a defined later reference handoff;
- [x] no runtime/public API/release claim is made by completing #233.

After review and merge of this reconciliation, #233 may close as **governance
complete** and #234 may begin implementation.

#224 remains open until the required implementation, full-native/refinement
evidence, backend disposition, compatibility, and parent acceptance are complete.
