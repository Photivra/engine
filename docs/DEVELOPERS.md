# Developer guide

This is the entry point for **@photivra/engine 2.23.0**, root API contract **2.23.0**. 2.23.0 was prepared on November 12, 2026; npm publishing runs only from the owner's `v2.23.0` tag, and the [2.23.0 release record](RELEASE_2_23_0.md) states whether that has happened. The latest published release is 2.22.0 (November 12, 2026, [record](RELEASE_2_22_0.md)).

Repository `main` may later describe newer development. For the stable contract, use a published release's packaged docs or its exact tag. [Release notes and migration](RELEASE_1_3_0.md) explain why the package version and the root API version are now the same number.

Photivra is a TypeScript calculation library, published as ESM under Apache-2.0, with no runtime npm dependencies. Its results carry explicit units, deterministic data, provenance (where a result came from and how it was made) and clearly bounded scientific approximations.

The package does **not** supply a hosted API, a renderer, a UI, commercial camera calibration, or an automatic agent service. [Photivra's public site](https://photivra.com) is separate from the engine's licence. You do not need an application account to read the engine documentation here.

## Install and calculate

Install with `npm install @photivra/engine@2.23.0`. The [2.23.0 release record](RELEASE_2_23_0.md) and the [changelog](../CHANGELOG.md) describe the current release.

```ts
import { calculateFieldOfView, ENGINE_API_VERSION } from "@photivra/engine";

const horizontal = calculateFieldOfView({ focalLengthMm: 50, sensorDimensionMm: 36 });
console.log(ENGINE_API_VERSION); // 2.23.0: matches the package version
console.log(horizontal.value.degrees); // approximately 39.60, ideal infinity-focus geometry
console.log(horizontal.provenance); // read assumptions/status with the value
```

### Runtimes

- The root export is browser-safe.
- Supported Node versions for running and tooling: Node 22.13+ on the maintained 22 line, the maintained 24 line, and Node 26 Current. Patched Node 24 is preferred.
- The broad minimum in the manifest does not mean untested or end-of-life lines are supported.
- A browser must provide the documented ES APIs, including `structuredClone`, typed arrays and Web Crypto where used. A browser-safe import graph is not a promise about every browser version, or about rendering speed.

See the [runtime policy](../NODE_SUPPORT.md).

### What calls return

| Kind of call | Returns |
| --- | --- |
| Primitive calculation | Usually `CalculationResult<T>`: `value`, `provenance` and optional `quality`. |
| Parser | A validated value. |
| Plan or snapshot | Its own independently versioned record. |
| Assessment | Explicit blockers (reasons it cannot proceed). |
| Paired export | A Promise, because hashing is asynchronous. |

None of these proves calibrated accuracy. Do not infer it from successful parsing, a complete stage graph, a generic tier name, or a deterministic replay.

## Find the operation by scientific task

These rows were last reviewed for package/root API 1.3.0. The later 1.4.0 and 1.5.0 minor releases and the 2.0.0 major release are summarized in the [changelog](../CHANGELOG.md) and in their own guides.

- Direct calculations are synchronous and browser-safe unless the row says otherwise.
- A listed primitive is not automatically an app feature, and is not supported in every production combination.
- The [API reference](API_REFERENCE.md) lists every root export with its exact signature. The linked guides own the equations, inputs, defaults, errors and limits.

| Task | Start here / executable evidence | What is supported |
| --- | --- | --- |
| FOV (field of view), focus, depth of field, subject size | [Usage: field of view](USAGE.md#field-of-view), [physics](PHYSICS_FOUNDATION.md), [quick start](examples/quick-start.mjs) | Ideal paraxial / thin-lens geometry. Explicit mm, metres and axes. |
| Aperture, diffraction, sampled PSF (point-spread function) | [PSF foundation](PSF_FOUNDATION.md), [usage](USAGE.md#real-lens-psf-profiles-and-complex-pupil-reference) | PSF shape and light throughput are kept separate. Support is explicit. No inferred commercial calibration. |
| Metering and exposure modes | [Usage: relative metering](USAGE.md#relative-pre-exposure-metering), [API conventions](API_STYLE.md) | Relative linear signal before exposure. Compensation is applied to the target before exposure control. ISO does not create photons. |
| Rigid or depth-dependent motion, and stabilization | [Motion](MOTION_AND_SIGNAL.md), [stabilization](STABILIZATION.md) | Declared constant-motion and generic control models. Visibility (what hides what) stays the caller's job. |
| Continuous or discrete spectral measures | [Scene/illumination](SCENE_RADIANCE_AND_ILLUMINATION.md) | Continuous per-nanometre quantities (dλ in nm) versus wavelength-integrated line fractions. `distribute*` keeps the quantity's domain. |
| Sampling, response validity, photon/electron expectations | [Usage](USAGE.md#sensor-spectral-response), [temporal EQE](SENSOR_EQE_TEMPORAL_EXPOSURE.md) | Exact bindings to source plane, area, profile, wavelength and time. No implicit QE (quantum efficiency) or collection area. |
| Run a declared environment through production RAW to output | [Production envelope](PRODUCTION_ENVIRONMENT_CAPTURE.md), [complete packed example](examples/production-capture.mjs) | The Node example loads its own data. The engine callback is synchronous. Limits: 4,096 native sites / 100,000 provider evaluations. |
| Browser-first dense-pupil Focus/Depth native capture | [Reference-executor handoff (#234)](BROWSER_NATIVE_CAPTURE_REFERENCE_EXECUTOR_HANDOFF.md), [support envelope (#224)](BROWSER_NATIVE_CAPTURE_ENVELOPE.md), [numerical evidence matrix](BROWSER_NATIVE_CAPTURE_NUMERICAL_ACCEPTANCE.md), [prepared-state contract](BROWSER_NATIVE_CAPTURE_PREPARED_STATE.md), [robust-geometry contract](BROWSER_NATIVE_CAPTURE_ROBUST_GEOMETRY.md), [resource-accounting contract](BROWSER_NATIVE_CAPTURE_RESOURCE_ACCOUNTING.md), [Path-B adoption/version gate](BROWSER_NATIVE_CAPTURE_PATH_B_ADOPTION.md), [dense-pupil evidence](DENSE_PUPIL_QUALIFICATION.md) | The agreed plan (#233) defines one Path-A float64 reference executor as the implementation and evidence target for #234. Building it, and qualifying the #224 envelope, are separate work. |
| Keep or reconstruct RAW, and develop a preview | [RAW envelope](RAW_FRAME_ENVELOPE.md), [processed output](PROCESSED_OUTPUT.md) | Signed shadow values, absolute CFA (colour filter array) phase, explicit sensor-channel colour and white balance. Rendering does not redraw noise. |
| Pair a native CFA DNG with a processed JPEG | [Photographic export](PHOTOGRAPHIC_EXPORT.md), [acceptance](EXPORT_ACCEPTANCE.md) | Async Web Crypto. Registered Bayer reference. 1:1 output crop. The caller saves the bytes. |
| Read DNG/TIFF-EP raw files; write wide-gamut/HDR PNG | [DNG import and PNG output](IMPORT_AND_PNG.md) | Reads stored codes and metadata only. Untrusted input is bounded. PNG code values are encoded by the caller, with sRGB/ICC/cICP signalling. No AVIF/HEIC. |
| Embed or find Content Credentials (C2PA) in a JPEG, PNG or DNG export | [Content Credentials](CONTENT_CREDENTIALS.md) | Caller builds, signs and validates the manifest; the engine embeds the placeholder, returns the hash exclusions and SHA-256, writes the signed store at the same length, and finds an existing store. No keys, no network. |
| Commit a capture; ideal virtual-camera colour; linear encoding | [Capture](SIMULATED_CAPTURE.md), [ideal color](CAPTURE_COLOR.md), [encoding](LINEAR_CAPTURE_ENCODING.md) | Ideal XYZ encoding is different from approximate sensor-channel development. |
| Generic tiers and correction cost | [Presets](GENERIC_TIER_PRESETS.md), [tier acceptance](TIER_ACCEPTANCE.md), [correction](DIGITAL_OPTICS_FOUNDATION.md) | Versioned synthetic assets owned by the project. No universal quality ranking. |
| Optional WebGPU acceleration of PSF convolution, native SDR and RAW development | [WebGPU backend](WEBGPU.md), [hardware record](WEBGPU_DEVICES.md), [usage](USAGE.md#optional-webgpu-image-kernels) | Labelled float32 approximation, with error bounds stated in advance and tested on a real GPU adapter. CPU float64 stays the reference and the only bit-exact path. The hardware record lists the devices each run was confirmed on; a release record links the rows for its version. |
| Reproduce conformance and performance results | [Scientific suite](SCIENTIFIC_CONFORMANCE.md), [performance disposition](V1_PERFORMANCE_DISPOSITION.md) | Science gates run in CI. Node measurements do not establish browser or megapixel performance. |
| Optional local HTTP development transport | [Repository POC](POC_API.md) | Node-only tooling in the checkout, excluded from the root export and the package. Unauthenticated, loopback only. |

## Complete packed examples

The package includes `docs/examples/quick-start.mjs` and `production-capture.mjs`. To run them:

1. Install the package in a Node ESM project directory.
2. Copy both files and `production-request.json` from `node_modules/@photivra/engine/docs/examples/` into that directory.
3. Run them with Node.

The quick start checks independent geometry and exposure invariants.

The production example runs the same small synthetic fixture used in final conformance (2×2 sites, narrow band). It goes through all fourteen production stages and the paired byte export, and keeps the exact RAW codes and deterministic replay. It writes no files and installs no renderer.

The JSON data is deliberately synthetic:

- uniform angular radiance `1e-9 * (1 + 200t)` W/m²/sr/nm;
- a 540–560 nm band;
- an independently declared 800×600 µm sensitive aperture and a package-incident EQE (external quantum efficiency) of 0.4;
- a registered opening-reference time;
- a fixed seed and generic consumer profiles.

This is a controlled regression laboratory. It is not a real scene, a real native camera pixel pitch, calibrated colour or visibility, proof of PSF transport, or a convergence bound. Production supports only the envelope linked above. The tiny DNG demonstrates byte serialization and lineage; acceptance by external readers uses separate, larger fixtures.

The [Usage Guide](USAGE.md) has two kinds of snippet:

- **complete snippets**, which run on their own; and
- **composition fragments**, clearly marked, which need bindings validated earlier.

The release checker typechecks and runs every complete importing snippet against the packed package. For fragments it lists the bindings they depend on, without pretending that missing calibration data exists.

## Contracts and support

- Use only `import ... from "@photivra/engine"`. Deep paths, and the repository's transport, scripts and test helpers, are unsupported.
- TypeScript declarations describe shape only. Parse untrusted JSON before running any scientific calculation on it.
- Keep coordinate conventions explicit: native +Y down, optical +Y up, and half-open raster rectangles.
- Keep physical domains apart: radiance, irradiance, rates, expected counts, realized charge, RAW codes and processed SDR are different things.

How errors are reported:

- Malformed configurations and non-finite values throw the established domain errors.
- Well-formed but scientifically incomplete assessments and plans return structured blockers.
- Exceptions thrown by trusted provider callbacks propagate. No silent fallback renderer runs.

The reference and the declarations show each exact return contract and the independent model versions.

See [provenance](PROVENANCE.md), [license](../LICENSE), [NOTICE](../NOTICE), [third-party inventory](../THIRD_PARTY.md), [contributing](../CONTRIBUTING.md) and [security reporting](../SECURITY.md). The engine's code and docs do not license the commercial application or its private assets. Report reproducible engine defects through [public issues](https://github.com/Photivra/photivra/issues).

Website navigation and documentation hosting live outside this repository. For the website: link the public engine repository, this developer guide, the verified npm release package and the capability examples from the public site. No unpublished destination is linked here. A website launch is not a prerequisite for an engine release.

## Print planning

The published 1.2.0 release added [registered linear statistics](PRINT_REGION_STATISTICS.md) and a separate [static contrast model reference](PRINT_CONTRAST_REFERENCE.md). The [combined #195/#196 review](PRINT_195_196_REVIEW.md) and the [candidate ledger](validation/print-196-candidate-capabilities.json) list the experiments run on public backends and the full release gates still outstanding. None of these diagnostics gives a universal quality score.

Use [native-only Print planning](PRINT_PLANNING.md) when you have an independently specified image size and viewing distance, explicit angular conventions, a confirmed native crop and the lab's constraints. It never recommends upscaling, does not certify perceived quality, and does not turn on an exporter.

The [regional Print detail diagnostic](PRINT_DETAIL_ASSESSMENT.md) measures one declared, coherent sinusoidal fundamental in a selected linear-luminance ROI (region of interest), and records the exact pipeline stage it was measured at. Its [validation protocol](PRINT_DETAIL_VALIDATION.md) and [capability ledger](validation/print-detail-capabilities.json) separate mathematical conformance from the still-blocked qualification of acquired images, renderers and perceived quality.

## Licence and copyright scan

This section is for contributors to this repository. The `licence scan` job in [CI](../.github/workflows/ci.yml) scans every file in the repository with [ScanCode Toolkit](https://github.com/aboutcode-org/scancode-toolkit) (Apache-2.0, free). It then runs [`scripts/check-scancode-policy.mjs`](../scripts/check-scancode-policy.mjs) on the JSON report. The check fails when:

- a file has a detected licence, or a low-confidence licence clue, other than Apache-2.0;
- a file has a copyright holder other than Shackelford Creative, LLC or Photivra contributors;
- ScanCode reports a scan error for a file;
- an allowlist entry's file is in the scan but no longer has that finding (remove stale entries). An entry for a file missing from the scan only prints a warning.

Known findings are on two allowlists in the script: one for licences and one for copyright holders. Each entry names one file and one exact finding (a licence expression or a holder), with its reason. There are no directory-wide exclusions, so a new licence or holder in an allowlisted file still fails. Today's entries cover the castleCSF model material and its notice, the DCO text, licence names mentioned in documentation and comments, licence labels used as test data, ScanCode false positives, the lockfile's dependency metadata and the Adobe DNG licence record.

The job installs ScanCode Toolkit 32.5.0 (`scancode-toolkit-mini`) on Python 3.13 from [`.github/scancode-requirements.txt`](../.github/scancode-requirements.txt). That file pins the complete tested package set by version and hash. It uses `--no-deps`, because this ScanCode version needs pluggy 0.13.1 and setuptools below 81, outside its declared ranges. Nothing from it ships in the package.

Run the same check locally (Linux x86_64 with libmagic; the first scan builds ScanCode's licence index and takes a few minutes):

```sh
python3.13 -m venv /tmp/scancode-venv
/tmp/scancode-venv/bin/python -m pip install --no-deps --require-hashes -r .github/scancode-requirements.txt
/tmp/scancode-venv/bin/scancode --license --copyright -n "$(nproc)" --strip-root --timeout 300 \
  --ignore ".git" --ignore "node_modules" --ignore "dist" --ignore "coverage" \
  --json /tmp/scancode.json .
node scripts/check-scancode-policy.mjs /tmp/scancode.json
```

The scan and the other required checks run on pull requests and on merge-queue entries; a push to `main` runs only the `main smoke` job (build, hash-lock tests and the packed-consumer acceptance). Each Node.js line's `verify (<line>)` check passes when its `test (<line>, 1/2)`, `test (<line>, 2/2)` and `test (<line>, package)` parts pass. The coverage gate runs as eight parallel `coverage shard (k/8)` jobs (six in 2.21.0, four before); the required `verify (lts/*)` job merges their reports (`vitest --merge-reports --coverage`) and enforces the thresholds in `vitest.config.ts` on the whole suite. Locally, `npm run coverage` runs the whole suite and enforces them directly.

CI tests a tree once per runtime ([#510](https://github.com/photivra/photivra/issues/510)). A job that passes uploads a proof artifact named by the tree, the job and the Node.js release (`.github/ci-proof.mjs`). A merge-queue entry, a push to `main` or the publish workflow's coverage gate skips a job's work when that proof exists for its exact tree and runtime from a run of this repository; a pull request never skips on a proof. A change that touches only Markdown no test reads (`.github/ci-scope.mjs`) skips the test suite and coverage and keeps the static, documentation, packed-consumer, package and licence gates. `--shard=k/n` splits files by the measured times in `test/shard-weights.json`; re-record them from the `coverage-timings-k` artifacts of a CI run with `node scripts/record-shard-weights.mjs <reports> --source "<run>"`.

The `change scope` job checks the Node.js matrix against the support policy (`.github/node-ci-roles.mjs`, [#231](https://github.com/photivra/photivra/issues/231)): the `test` and required `verify` lines, the primary jobs (Node 24), `publish.yml`, the alias table in [NODE_SUPPORT.md](../NODE_SUPPORT.md) and `engines.node` must agree with the roles of `.github/node-lts-policy.mjs`, or the check fails. It takes under a second in a job that already runs. Findings that need an owner decision print as notices. Since 2.20.0 (owner decision, #231) the primary leg (the coverage shards and the required `verify (lts/*)` check, whose name is kept because it is a required status check of the `main` ruleset and a rename would mean changing the ruleset) is pinned to Node 24, the tooling major, and Node 26 is tested by the `node` leg; a `test` leg that resolves to the primary leg's release (`lts/-1`, Node 24 since Node 26 entered LTS) skips its test work, and its required `verify` check still runs.

Runner time, measured from the job start and end times of GitHub Actions runs (25 pull-request runs of `ci.yml` that ran the tests, 2026-10-31 to 2026-11-09, runs 41239798152 to 42673865424; one docs-only run left out). Minutes are job wall time summed per leg; "billed" rounds each job up to a whole minute, as GitHub does. Standard runners are free for this public repository, so these are runner minutes, not costs.

| Leg (jobs) | Median min | Range | Billed median | Last 3 runs (2.17.0–2.19.0) median |
| --- | --- | --- | --- | --- |
| `22.13.0` (3 test parts + verify) | 13.4 | 11.1–24.6 | 16 | 21.2 |
| `lts/-1` (3 + verify) | 13.7 | 10.6–23.8 | 17 | 23.2 |
| `node` (3 + verify) | 13.6 | 10.3–23.6 | 15 | 15.9 |
| `lts/*` (4 coverage shards + `verify (lts/*)`) | 43.5 | 37.8–58.0 | 45 | 56.7 |
| `licence scan` | 6.5 | 3.8–6.8 | 7 | 6.5 |
| `change scope` | 0.1 | 0.1–0.3 | 1 | 0.2 |
| Linux total per run | 90.1 | 78.8–136.7 | 101 | 121.2 |
| `hash locks (macos-latest)` | 1.5 | 1.0–2.1 | 2 | 1.7 |

A push to `main` runs only `main smoke` (0.4–2.2 min, 3 runs). Re-measure after a CI change from `gh run list --workflow ci.yml` and the run's jobs (`gh api repos/Photivra/photivra/actions/runs/<id>/jobs`), without starting runs for the purpose.

Write the report outside the repository, or the next scan will include it. `-n "$(nproc)"` runs one scan process per CPU, as CI does.

To add an allowlist entry, add one object with `path`, the exact `license` (or `holder`) string from the failure message, and a `reason` that says why the material is allowed. Record any third-party material in [THIRD_PARTY.md](../THIRD_PARTY.md). A new or widened entry needs the owner's review in the pull request before merge. Never add a directory-wide or wildcard entry.
