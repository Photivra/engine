# Public API Style

Release context (dated historical note): this page was written for the **package 1.3.0 candidate / root API 1.3.0**. It has not been re-reviewed for later releases; see the [changelog](../CHANGELOG.md) for the current release. Subsystem and model versions, and dated introduction or measurement records below, are independent historical identities. They are not distribution versions. See [developer navigation](DEVELOPERS.md) and the [release contract](RELEASE_1_3_0.md).

The open engine should feel like one coherent library. These rules keep it that way.

## Rules

- Use descriptive `camelCase` function names, normally starting with a verb such as `calculate`, `estimate`, `parse`, `validate` or `simulate`.
- When a calculation has more than one meaningful input, take a single typed config object instead of positional arguments.
- Put the unit in the property name when the quantity has no dedicated unit type: `focalLengthMm`, `distanceM`, `shutterSeconds`.
- Never accept an ambiguous physical quantity without a unit.
- Use the same property name for the same physical concept in every module.
- Core calculations return plain, serializable data.
- Public calculation envelopes must not contain `NaN` or numeric infinities. A non-finite computed result fails with `InvalidScientificResultError`; do not rely on JSON coercion.
- Keep deterministic functions synchronous. Use async only for work that is actually asynchronous.
- Throw typed domain errors for invalid configurations. Do not silently coerce scientifically invalid values.
- Public calculation functions and meaningful public contracts need short JSDoc covering purpose, units, assumptions and what the return value means.
- Do not expose renderer, framework or UI-specific types through calculation APIs.
- Public configuration interfaces that will cross JSON or other untrusted boundaries should have runtime parsers. TypeScript types alone do not validate anything.
- Runtime parsers must reject unknown enum and string values instead of falling through to a default meaning.
- Pick types by their role, and do not reuse a narrower type in the wrong stage. For example, use `RasterDimensions` for generic active/output rasters, and keep `NativeImageRaster` for the native sampling grid.
- When a physical quantity depends on the axis, keep the axes explicit. Collapse it to a scalar only when the model documents and validates that simplification.
- After 1.0, preserve backward compatibility unless a documented major version changes the contract.

## Preferred shape

```ts
calculateFieldOfView({
  focalLengthMm,
  sensorDimensionMm,
  focusDistanceM
});

calculateDepthOfField({
  focalLengthMm,
  aperture,
  focusDistanceM,
  circleOfConfusionMm
});
```

Avoid one-off positional signatures and inconsistent abbreviations.

## Coordinate and staged-geometry contracts

Coordinate systems and image-formation stages are part of the API contract. They are not implementation details.

- Native raster coordinates have a top-left origin, +X right and +Y down.
- Raster rectangles use integer, half-open extents.
- Physical camera rotation does not redefine native sensor coordinates. Transform points, vectors and rectangles explicitly.
- Physical active capture and a later digital/output crop are different concepts and should have different fields or types.
- Off-center physical capture must keep its position relative to the optical axis. Do not silently recenter it.
- To cross between an oriented physical raster region (+Y down) and the pre-orientation optical image plane (+Y up), use the exported coordinate bridge. Do not use ad-hoc axis swaps or sign changes.
- Output resizing or cropping must not imply geometric stretching unless an explicit transform or pixel-aspect contract says so.
- Conventional 35 mm-equivalent focal length comes from the active physical capture geometry. It must not replace the physical focal length, and must not silently include a later digital crop.

## Image-formation ownership contracts

Optical and sensor effects that span several stages must follow the public image-formation contract. A renderer or downstream app must not invent its own stage order.

- Treat `requiredUpstreamStages` as hard scientific dependencies.
- Treat `coupledStages` as shared scientific state. It is not an instruction to run independent filters one after another.
- Coordinate spaces are part of the public meaning of the contract.
- Time-dependent models use seconds from exposure start as the authoritative time coordinate.
- A reserved stage does not mean the capability is implemented.
- Preview and reference implementations may differ in fidelity, within stated bounds, but must use the same engine-owned parameters and meanings.

## Result metadata

Primitive public scientific calculations return `CalculationResult<T>`. It carries model provenance and optional quality metadata.

Not every public API returns a `CalculationResult<T>`:

- Parsers return validated configuration values.
- The composed `simulatePocCamera()` response combines many calculation results, so it exposes component and aggregate provenance directly.

Use the optional `quality` metadata only when there is defensible accuracy or uncertainty information to report. Deterministic analytical results should leave it out rather than invent error bars.

Quality metadata supports:

- absolute uncertainty with an explicit unit;
- relative uncertainty as a fractional magnitude;
- the source of the uncertainty: measurement, model approximation or calibration;
- an optional confidence/coverage level, only when its basis can be stated;
- documented model or calibration valid ranges;
- short quality notes.

Uncertainty entries name the affected result with a JSON-style `quantityPath`, such as `value.distanceM`. Valid ranges name the relevant parameter with a path such as `input.focusDistanceM`.

Do **not** automatically sum, average, add in quadrature, or otherwise collapse several uncertainty components. Combine them only when the model documents the mathematical method and its independence/correlation assumptions. Aggregate simulations should keep the component uncertainties, or state clearly that no combined uncertainty was calculated.

## Versioning

From 1.0.1, Photivra's release version and root API version are the same:

- npm/package version: the distribution (release) version;
- `ENGINE_API_VERSION`: the same full version as the npm package;
- `POC_SIMULATION_API_VERSION`: the request/response contract of the composed `simulatePocCamera()`;
- schema-specific versions, such as the sensor-architecture or radiometry-readiness schemas.

The release checker enforces that the package and root versions are equal. Subsystem, schema and POC versions stay independent:

- A parser or schema change does not necessarily change the POC contract.
- A POC response change does not necessarily mean a new npm package was released.

Before 1.0, public APIs could change with documented notes. A breaking or meaningful contract change must update the relevant version number, tests, changelog, and migration/compatibility docs. After 1.0, a breaking public-contract change needs a major-version step.

For browser-first dense-pupil native capture, a changed numerical method is governed by the [Path-B adoption and version gate](BROWSER_NATIVE_CAPTURE_PATH_B_ADOPTION.md). A scientifically meaningful method change can need version and migration handling even when the TypeScript signatures stay the same. An exact optimization of the same committed Path-A discrete calculation is not a new method just because the execution structure changed.


## Public function verb families

Use the existing verb family that matches what the operation does. Do not invent a new synonym when one of these already fits.

- `calculate*` — deterministic scientific or numeric calculation.
- `estimate*` — explicit approximation or estimate.
- `parse*` — validate and normalize a versioned or untrusted configuration boundary.
- `validate*` — check validity without changing the value's meaning or identity.
- `resolve*` — derive one deterministic state from inputs and profiles that are already defined.
- `assess*` — produce a compatibility, readiness or applicability assessment, including structured blockers.
- `create*` — build a new record, snapshot or manifest whose identity is part of the contract.
- `prepare*` — validate and canonicalize fairly static context for repeated later use. Prepared state must own its immutable validated dependencies and define when it can be reused and when it becomes invalid. Preparing is not permission to cache results that depend on the request. See the [browser-native prepared-state contract](BROWSER_NATIVE_CAPTURE_PREPARED_STATE.md) (issues #224/#233).
- `serialize*` — convert an authoritative value to its documented, deterministic serialized form.
- `add*` — return a copy of an already-encoded file with caller-supplied data inserted into its container. Every other byte is kept, and nothing is decoded or encoded again (#388: `addJpegTextMetadata`, `addPngTextMetadata`). It differs from `serialize*`, which encodes a value, and from `compose*` and `bind*`, which build or attach engine state rather than edit a file.
- `compose*` — combine several independently meaningful inputs or stages into a higher-level result.
- `integrate*` / `reduce*` — mathematically aggregate explicit measures or samples under a documented model.
- `distribute*` — split an integrated quantity across explicitly normalized fractions, keeping its quantity domain. This does not create a continuous density from discrete spectral lines.
- `evaluate*` / `meter*` — evaluate a declared model or policy against current scene or capture data.
- `map*` / `transform*` — coordinate or domain transformation with explicit source and destination meanings.
- `bind*` — attach a result or state that is already defined to another authoritative context, without solving it again.
- `set*` — return an updated immutable value for a narrowly defined state-setting operation.
- `get*` — return a descriptive or static contract owned by the engine.
- `simulate*` — deliberately composed simulation or orchestration API.

The existing result factories `calculatedResult`, `estimatedResult`, `approximationResult` and `calibratedResult` are documented core helpers, not new verb families.

A new verb family needs a concrete difference in meaning from the existing set, and a documentation review.

## Input and return-shape consistency

Choose an API's shape from its role, not from the module's history.

- Public scientific calculations with several inputs take one typed input object.
- Parsers take one value or configuration and return the validated value, or throw the right typed domain error.
- Compatibility and readiness assessments should return structured blockers for requests that are well-formed but scientifically incomplete. Do not turn every blocker into an exception.
- Malformed schema or numeric input should fail fast with the established typed domain error.
- Calculations normally return `CalculationResult<T>`. Do not wrap parsers just to make every function look the same.
- Immutable snapshots, plans and manifests may use their own versioned record contracts when provenance, identity or serialization requires it.
- Do not create module-specific aliases for shared concepts such as evidence, uncertainty, coordinate spaces, ranges or scientific status, unless the domain meaning really differs.

Consistency must never erase a meaningful scientific difference.

From package 2.0.0, input errors are reported consistently:

- Every root function that needs an input object rejects a `null`, primitive or array argument, and a missing required sub-object, with the domain `InvalidConfigurationError`. It no longer throws a raw `TypeError` from a property read. The shared guards are in `src/core/record-validation.ts`. `test/root-export-input-errors.test.ts` calls every root function with `null`, `undefined`, `{}`, `42`, `"x"` and `[]`.
- Every root calculator that takes an input object rejects unknown top-level input fields with `InvalidConfigurationError`. A wrong-unit or misspelled field, such as `focusDistanceMm` next to `focusDistanceM`, fails instead of being ignored. Most use the shared message `<name> input has unknown field "<field>".` (the `requireInputKeys` guard); some reject through their own allowlist parser with a domain message. Nested records are checked by their own parsers.
- Every versioned-record parser (`parse*()`) and every function that takes a whole engine or versioned record (for example `assessRadiometryReadiness(profile)`, `calculateEffectiveSaturationCode(sample)` and `serializeProductionImageFormationPlan(plan)`) rejects an unknown field at every object level with `InvalidConfigurationError`. The message names the path and the field: `<path> has unknown field "<field>".` (`rejectUnknownFields` in `src/core/record-validation.ts`), or an existing domain message followed by `Unknown field "<field>".` Each accepted schema version and each `kind` of a record has its own allowed fields (`rejectUnknownVariantFields`), so a field of another version or kind is unknown too. Fixed flags a parser writes into its output (for example `sceneRadianceCalculated: false`) are accepted back only with that value (`requireFixedFieldsWhenPresent`), so everything the engine writes parses again. Derived blocks that a parser recomputes (a capture's `resolvedGeometry`, a plan's content under its fingerprint) are compared as a whole. `calculateEffectiveSaturationCode` accepts the fields of `EffectiveSaturationReadout` and of a whole `SensorRawCodeSample`. `test/root-export-input-errors.test.ts` classifies every root function, so a new export must be strict or listed with its reason; `test/strict-record-fields.test.ts` checks every level of representative records and their round-trips.
- `prepareImageFormationContext()` and `createProductionCaptureSnapshot()` also accept the `version` and `fingerprint` fields of a record they produced, so a record can be passed back with changes. Both fields are recomputed.
- `serializeProductionImageFormationPlan()` checks the plan version and the recomputed fingerprint before serializing.

### Error classes

From package 2.0.0 the two input error classes follow one rule. `test/error-class-consistency.test.ts` scans the source for violations.

- `InvalidConfigurationError` (`TypeError`, `code: "INVALID_CONFIGURATION"`): the input has the wrong shape. An argument or nested field that must be an object, array, string, boolean or function is something else; a required sub-object is missing; a field is unknown; a kind, mode, policy, version or other enumerated string is not one of the allowed values; or an identifier is malformed. Any defect found while parsing a versioned configuration record (a profile, schema record or `simulateCapture()` options) is also a configuration error, including an out-of-range number inside it.
- `InvalidScientificInputError` (`RangeError`, `code: "INVALID_SCIENTIFIC_INPUT"`): a numeric input of a calculation is missing, not finite, or outside its physical or mathematical domain, including cross-field constraints such as a focus distance inside the focal length. A well-formed request that the selected capability profile cannot serve (an unsupported drive mode, bracket axis, ISO setting or flash sync mode) also stays a scientific-input error.
- `InvalidScientificResultError` (`RangeError`, `code: "INVALID_SCIENTIFIC_RESULT"`): a computed result would not be finite.
- The published source throws no plain `Error`, `TypeError` or `RangeError`. The one internal exception is the lean native executor's "outside lean scope" signal, which is caught at once and falls back to the full path.

### Read-only results

From package 2.0.0 every envelope built by `calculatedResult`, `approximationResult`, `estimatedResult` or `calibratedResult` is read-only. The engine builds every `CalculationResult` through these factories.

- The envelope, `provenance` (with its `assumptions`) and `quality` are frozen all the way down. The `value` object or array is frozen at its top level. Writing to any of them throws a `TypeError` in strict-mode code. The TypeScript type marks `value`, `provenance` and `quality` as `readonly`.
- Nested objects inside `value` are not frozen by the envelope. Domains that own their data still freeze it deeply: captures, RAW attachments and reconstructions, export metadata and equipment presets use the internal child-first freeze helper described below.
- Typed arrays, `DataView`s and `ArrayBuffer`s inside a value stay mutable, because JavaScript cannot freeze a typed array that has elements. Class instances, Maps and Sets are not frozen.
- Cost: a few `Object.freeze` calls per result. Measured A/B against 28f8b61 (shared 4-vCPU host, Node 24.21): per-point mapping calls 1.2–1.9× slower, batch mapping calls within noise, `simulatePocCamera()` 1.62–1.69× slower, native environment RAW within noise. See the CHANGELOG 2.0.0 entry for the figures.
- Why not a deep freeze of `value`: it costs too much on hot paths. On the 33×33 grid of `npm run bench:image-formation` (Node 24, shared 4-vCPU Linux host), a direct micro-measurement of `calculateCameraRotationImageMapping()` (two envelopes per call) took about 0.74 µs per call without freezing, about 1.05–1.12 µs with the chosen freeze, and about 2.2–2.6 µs with a generic deep walk of `value`. A deep freeze would also freeze any caller-owned object that a value holds by reference.
- Copy a value (`{ ...result.value }` or `structuredClone(result.value)`) before you change it.

### Naming conventions

Existing field names are stable contracts and are not renamed for uniformity. New fields follow these suffix rules, which describe current usage:

- A unit suffix names the public unit: `Mm` (millimetres), `M` (metres), `Micrometers`, `Seconds`, `Degrees`, `Rad` (radians), `RadPerSec`, `Mps` (metres per second), `Hz`, `Pixels`.
- Wavelengths use `Nanometers` in spectral profiles, curves and samples (`wavelengthNanometers`), and the short `Nm` in scalar calculator inputs (`wavelengthNm`). Both mean nanometres. Prefer `Nanometers` for new data records; use `Nm` only next to existing scalar inputs.
- Raster sizes use `pixelWidth`/`pixelHeight` on raster records, and `widthPixels`/`heightPixels` for derived projected sizes measured in pixels. Use bare `width`/`height` only inside integer raster rectangles (`{ x, y, width, height }`) whose coordinate space is named by the enclosing field.
- Dimensionless factors, fractions, counts and codes have no unit suffix. Their meaning and range are documented on the field.

Internal helpers for immutable data live in `src/core/owned-data.ts`. This module is not a root export.

- Capture, RAW attachment and reconstruction, export metadata and equipment presets use its child-first freeze helper, and only on plain-data trees they own.
- Each domain keeps its own validation and copy boundary. Freezing is not parsing, and it is not cloning.
- In this helper, a parent that is already frozen still has its descendants walked.
- The production planner, focus and release helpers keep their own behaviour: they return early for objects that are already frozen.

`src/core/canonical-json.ts` holds the shared code for sorted-key, finite-only JSON. Each caller keeps its own policy for omitted values and errors:

- Production-plan records omit undefined object properties. Capture comparison and export hashing reject them.
- Array order, and the JSON representation of numbers and strings, are preserved.
- Planner FNV-1a fingerprints and export SHA-256 hashes stay separate identity contracts. The helper does not pick a hash and does not change either contract.
- Capture's public serialization keeps its existing validated `JSON.stringify` representation.

## Exact and fast modes

Owner direction of October 24, 2026 (#395): every slow option keeps its exact method, the engine reference, and may also
have a fast method, a measured and bounded approximation of it. One flag style serves every such option; a test
(`test/fast-flag-convention.test.ts`) walks `SIMULATE_CAPTURE_FAST_OPTIONS` and enforces it.

- **One Boolean, one name.** The choice is always `fast?: boolean`: `false` or omitted is exact, `true` is fast. No option
  uses "quality", "fidelity", "accuracy", "precise", "approximate" or "mode" for this choice (`fidelity` and `mode` already
  name other things).
- **One top-level default, one resolver** (2.20.0, owner rule). `fast` on the `simulateCapture` request sets every listed
  option. `simulateDisplayView` and `prepareDisplayView` take the same request, so the flag is set there once. Every choice
  resolves the same way, in `resolveFast` and `fastFormatDefault` (`src/facade/fast-resolution.ts`): the option record's
  `fast`, else the top-level `fast`, else the format default. The format default is fast for `output.format` `"srgb-8"` and
  `"srgb-16"` and for the display view, and exact (full quality) for the exports `"dng"`, `"jpeg"` and `"png"` and for
  `simulateIdealReference`. No option keeps a default of its own. The app's calculator always passes `fast: false`, so every
  engine function it uses must offer its exact mode and say so in its docs.
- **The override sits inside the option.** Each listed option has a shorthand string (its model with defaults) and a record
  `{ kind: <model>; fast?: boolean; …parameters }`. The record's `fast` overrides the top-level flag for that option only.
  There is no separate overrides map.
- **Every listed option takes the flag**, whether or not it has a fast method. Without one it runs exact and reports `false`,
  so callers never need to know which options have a fast method.
- **One list:** `SIMULATE_CAPTURE_FAST_OPTIONS`, in the path style of `SIMULATE_CAPTURE_COST_OPTIONS`:
  `lens.diffraction`, `lens.catalogue`, `sensor.antiAliasing`, `sensor.pixelAperture.box` and `output.demosaic.ahd`.
- **The first fast method** (#568, 2.18.0): `lens.catalogue` (shorthand: the lens id; record `{ kind: <lens id>, fast }`) blends
  the lens's PSF over a field grid and tabulates each site's expected signal (docs/LENS_CATALOGUE.md, "Fast method"). It runs for
  a still camera with site-center queries and a chart or material scene; otherwise the exact method runs and `applied` says
  `false`. The registry below lists the fast methods added since.
- **One report** on every capture and display view: `diagnostics.fast = { requested, defaultedFrom, applied, assurance }`.
  `requested` is the resolved top-level value (or true when a record sets `fast: true`); `defaultedFrom` is `"request"` when the
  request gave `fast` and `"format"` when the format default chose it; `applied` names each listed option that ran, `true` where its fast method ran;
  `assurance` is `engine-reference` when everything ran exact and `approximation-with-a-priori-bound` otherwise. A fast method
  that runs also adds an assumption `fast.<path>` naming its method and its bound.
- **One registry, enforced** (2.20.0). `SIMULATE_CAPTURE_FAST_METHODS` in `src/facade/fast-methods.ts` lists every speed-versus-accuracy
  choice: its id, the record path that takes the override (or the top-level flag only), whether a fast method exists
  (`fast-and-exact`) or the record takes `fast` with none yet (`exact-only`), where it runs, its resolver call and how it is
  reported (a `diagnostics.fast.applied` key, a `fast.<path>` or other assumption, or a result field). In 2.20.0: `lens.catalogue`'s
  field grid (#568), its cat's eye (#567: fast leaves it out) and the display view's PSF zones (H1); `lens.diffraction`'s per-tap
  points under rolling-shutter rotation (#565), and in 2.21.0 `lens.catalogue`'s the same way (#588; the lattice reading is its exact method); the display view's AHD low-signal correction (H3: 2048 draws and a 0.01 threshold
  fast, 8192 draws at the same threshold exact) and its quarter sampling of uniform pixels (H2); `prepareDisplayView`'s `gpu`
  (`"auto"` fast, `"off"` exact; an explicit value wins); and `result.sensor.midGrey` (#535, computed only on exact requests). In 2.22.0: `motion.subject`'s temporal midpoints (#551: with the default count and a still camera, fast takes one
  midpoint per site of the subject's streak plus one when that is fewer than 8; exact keeps the 8; an explicit
  `sensor.temporalSampleCount` always wins). The
  records of `lens.diffraction`, `sensor.antiAliasing`, `sensor.pixelAperture` and `output.demosaic` (in captures) take `fast`
  with no fast method yet. `test/fast-methods-registry.test.ts` fails when a record accepts `fast` without an entry, an entry
  lacks its resolver or report, or a format default leaves the rule. **Every new fast method adds its entry.**
- **The same words on WebGPU.** The image-kernel execution record carries `fast` (`false` for `cpu-reference`, `true` for
  `webgpu-f32`) beside `assurance`; `backend` still names where the work runs.
- **When a fast method needs no flag.** A faster method that is byte-identical to the exact one, or differs only by rounding
  (the same quantities summed in another order, with a measured bound), replaces the exact code: no flag and no second
  implementation. A faster method that is more accurate than the reference replaces it too, and the reference moves. Only a
  less accurate method becomes the fast method behind the flag.
- **Parameters are not the flag.** Sample counts and windows (`samplesPerAxis`, `kernelRadiusSamples`, `separationSites`) are
  model parameters and keep their names.
- **Names:** `lens.diffraction` names its model by `kind` like the other records; `aperture`, its name before #395, stays a
  deprecated alias until 3.0.0, and giving both is an error.

## Compatibility and deprecation policy

The package and the root API share a release version. Update independent schema, model or POC versions only when their observable contracts change.

### Package version

The npm package version identifies a published distribution. It does not stand in for every internal or public contract version.

### `ENGINE_API_VERSION`

Set to the npm package version for every release, including patches. New records use this as their creator identity. Parsers keep the identities of historical archives.

### Subsystem/schema versions

Versioned schemas, production-plan contracts, POC contracts and similar surfaces own their own versions. A change to one does not automatically bump unrelated contracts.

### Before package 1.0

The project could make breaking public changes when the scientific or architectural benefit justified them. Such a change had to:

- be intentional, not incidental;
- update the relevant API, schema or contract version;
- update tests and public documentation;
- describe the migration and compatibility impact;
- avoid silently reinterpreting serialized data that was previously valid.

### After package 1.0

Breaking changes to the root package's public contract follow the normal SemVer major-version process. Independently versioned schemas and contracts still follow their own documented compatibility rules.

### Deprecation

When practical, prefer an additive migration period:

1. introduce the replacement contract;
2. document the migration;
3. keep the old behaviour stable long enough for downstream users to migrate deliberately;
4. remove it only through the appropriate breaking, versioned change.

Do not keep an unsafe or scientifically false API just to avoid a breaking change. Correctness comes first, but the break must be explicit.

## Compatibility guard tests

The repository keeps a representative set of compatibility sentinel tests, instead of freezing every pre-1.0 export forever.

Sentinels should cover:

- the root engine and composed POC version numbers;
- representative `calculate`, `parse`, composition and simulation APIs;
- public function naming conventions;
- typed error and result behaviour where relevant.

Adding a legitimate new API may mean extending the naming test. Removing or renaming a sentinel needs an explicit compatibility and version review.

## OpenSource V1 API consistency audit

The OpenSource V1 audit takes the existing engine conventions as the baseline. It does not redesign stable APIs.

The root runtime surface uses the verb families listed above. The four result-factory helpers are the explicit exceptions. Future OpenSource V1 work should follow these conventions when it is implemented.

Audit rule:

- keep existing differences that are scientifically meaningful;
- fix accidental naming or shape drift when the risk is low;
- do not do broad cosmetic refactors just for symmetry;
- record and document any intentional exception;
- do not let private-app conventions become public-engine contracts by accident.

## Stable 1.0 distribution transition

Historically, package 1.0.0 kept `ENGINE_API_VERSION = "0.116.0"`. That independent root contract identity was already embedded in serialized captures, and on its own it did not signal a published distribution. The package 1.0 policy governs breaking changes despite that historical root ID. No schema, model, POC or plan version was reset. See [migration and release procedure](RELEASE_1_0.md).

## Aligned 1.0.1 release transition

Starting with 1.0.1, `ENGINE_API_VERSION` equals the full npm package version. The package and the root API follow one SemVer release sequence. Schema, model, POC and plan versions stay independent. Archived capture identities and measured artifacts are preserved. Newly created capture and plan bytes, and their identity hashes, can change, because their creator-API field now records 1.0.1. See [migration and release procedure](RELEASE_1_0_1.md).
