# Native RAW and Print candidate contracts

These native RAW and Print contracts are part of version 1.4.0. The optional execution chunk control described below is an unreleased additive change; it is not in the published 1.4.0 package. Using these contracts in production needs separate downstream qualification.

This page uses a few terms throughout:

- **Native site:** one photosite position on the full native sensor grid.
- **CFA (colour filter array):** the repeating colour mosaic over the sensor, such as a 2×2 Bayer pattern. A **CFA phase** is one position within that repeating tile.
- **Tile:** a block of native sites processed together.
- **Host yield:** a pause where the task awaits the caller's `yieldControl` so a browser can stay responsive.

## Native RAW task

`createNativeRawTask` accepts metadata without an inline image plane. It produces, as owned data:

- exact native codes;
- black levels and digital saturation codes;
- separate physical, pre-ADC and digital saturation flags;
- (2.0) `effectiveSaturationCodes`: the effective white level for each absolute CFA phase, from `calculateEffectiveSaturationCode`. It is indexed by `phaseY*repeatWidthSites+phaseX`, so it is a few bytes, not a per-pixel plane. All sites of one phase must agree; otherwise the task fails.

Limits:

- at most 24 million sites by default. From 2.2 a caller can raise this with `maximumPixels`, up to
  `NATIVE_RAW_LIMITS.ceilingPixels` (2^27 = 134,217,728) for sensors up to about 100 MP; the plan then records
  `maximumPixels`, and the native environment tasks' whole-event query budget ceiling grows in proportion
  (2,000,000,000 per 24,000,000 pixels). Memory and time per megapixel are in the quick start's
  [Large images](QUICK_START.md#large-images) table;
- at most 16,384 pixels per dimension;
- at most 256 sites per tile;
- an explicitly admitted payload of seven bytes per site.

The reference 4,096-site RAW path is unchanged. Absolute CFA coordinates, and charge and read-noise seeds indexed by absolute position, keep the reference arithmetic identical across tile boundaries.

## Native environment RAW task

`createNativeEnvironmentRawTask` calls the actual source radiance callbacks. It runs them through the shared projection, shutter, optical throughput, pupil/PSF and EQE (external quantum efficiency) calculations.

- At most 100,000 source evaluations per tile.
- A whole-event budget of no more than two billion.
- Source visibility, measured radiometry, convergence and physical transport are the provider's responsibility.
- An optional immutable photo-tile observer exposes bounded expectation values before noise or clipping is applied.
- Observers receive the event's `AbortSignal` for pending resource work. Source callbacks stop immediately when the event is aborted. If an observer fails or is cancelled, no output is produced.
- `productionPlanActivated` and transport verification stay false.

## Native RAW development

`createNativeRawDevelopmentTask(input, { yieldControl, onProgress? })` takes ownership of one exact packed RAW and develops it. It applies, in order:

- the shared reconstruction kernels;
- normalisation to each phase's effective white level;
- saturation handling and highlight handling (`highlightMode`);
- the declared camera RGB-to-XYZ approximation, with white balance applied exactly once;
- shared SDR rendering.

The equations are in [photographic export](PHOTOGRAPHIC_EXPORT.md#development-model-20-sensor-color-development-200-processed-sensor-raw-sdr-020).

**Borders.**

- By default (`borderHandling: "reject"`), every phase and kernel halo used must lie inside real native support. There is no padding and no weight renormalisation.
- With `borderHandling: "mirror"`, sites outside the frame are read at their reflect-101 mirror position, when that provably keeps the same CFA channel (always true for 2×2 Bayer). Interior pixels are byte-identical to `reject`.

Built-in bilinear kernels come from `createBuiltInBayerDemosaicProfiles` ([image processing](PROCESSING.md#demosaicing)).

**Other rules.**

- Output crop and orientation are bound to the capture geometry. This stage supports 1:1 output sampling.
- The retained payload limit counts the retained RAW and the integer output. It does not count caller buffers, the JavaScript heap or GPU storage.
- `highlight` diagnostics count saturated pixels, samples clipped by white balance, and reconstructed pixels. `diagnostics.captureSaturation` is `consumed-in-raw-development`.

**RAW ownership (2.0, breaking).** Creating the task validates only metadata, phases and halos. This is O(metadata): about 3 ms at 24 MP, instead of 227 ms.

- The task then detaches the input `raw` arrays with `ArrayBuffer.prototype.transfer` (zero-copy). The caller's `codes`, `blackLevels`, `digitalSaturationCodes` and `saturationFlags` become length 0, and `output.raw` returns the same RAW.
- Runtimes without `transfer` copy instead.
- If you still need the RAW, keep a copy before development.
- Numeric integrity is checked at the start of `run()`, in chunks of 2¹⁸ sites with budgeted host yields: black < white ≤ digital saturation, code ≤ digital saturation, and flags ≤ 7. A violation fails `run()` and releases the RAW.
- Measured at 6000×4000 (Node 24, synthetic codes): array-buffer memory after setup fell from 321 to 160 MiB, and after run from 389 to 229 MiB.

**Typed kernel.** Development uses typed arrays for per-phase index offsets, weights and source-site white levels, a precomputed per-row orientation step, and the shared typed SDR renderer. It allocates no per-pixel objects.

- `developNativeRawReference` (internal, tests only) keeps the per-object reference path: per-pixel `transformOrientedRasterPointToNative`, `calculateRawReconstructionChannel` and `calculateSdrRendering` rows.
- `test/native-raw-development.test.ts` proves byte-identical codes, diagnostics and highlight counts against it, on seeded random RAW. It covers all orientations, four tone curves, both highlight modes, white-normalised and non-normalised matrices, three white-balance states and active-area offsets.
- 8-bit sRGB quantisation compares against 256 exact thresholds, instead of calling `pow` for each sample. The thresholds are found by bisection on the engine's own transfer function and checked at construction. `test/native-sdr-quantizer.test.ts` compares 1.5 million values.

Measured on a shared, noisy Linux host with Node 24 (synthetic codes, sRGB identity profile, byte-identical output):

| Case | Before | After |
| --- | --- | --- |
| 1000×1000, minimum of 5–7 runs per session | 1680–1874 ms | 124–169 ms (10–15×) |
| 6000×4000, single runs | 33.3–42.1 s | 3.8–4.6 s |
| Native capture SDR, 2000×2000, per-channel Reinhard (same exact quantiser) | 363 ms | 249 ms (identical output) |

**Provider API.** `createNativeRawDevelopmentTask` still accepts a bare `yieldControl` function in 2.x, but this is deprecated. The `createNativeCaptureSdrTask` providers and the development provider accept an optional synchronous `onProgress({ completedTileCount, totalTileCount })`. It is called after each committed tile. It cannot change the output, and an exception thrown from it fails the task.

## Shared task rules

All tasks:

- require host yields;
- publish only complete, successful outputs;
- report failure, cancellation and disposal as distinct outcomes;
- transfer ownership of the output once.

Typed storage must be backed by an exact, owned `ArrayBuffer`. Shared buffers, and views into a hidden larger parent allocation, are rejected. Metadata provenance and declared hashes do not prove who produced the data.

**Yield cadence.** RAW acquisition and development await the host `yieldControl` at a tile boundary once about 8 ms of work has passed since the previous yield, and always after the final tile.

- Every tile is still read, validated and committed separately.
- Cancellation is checked before each tile, after each read and after each yield. A host event can therefore cancel within about one time budget plus one tile.
- Yield cadence never changes tile requests, absolute CFA or seed indexing, or any output value.
- Earlier releases yielded after every tile: about 96,000 yields for a 6000×4000 raster. Under a browser's clamped `setTimeout(0)`, that cost minutes of idle time.

**Yields inside a tile (environment capture).** Native environment acquisition also applies the time budget between sites inside a tile, during both planning and radiance execution. It shares one budget with the tile loop.

- Cancellation is checked after each of these yields, so `cancel()` takes effect after at most about one site's work. One site with a large sampled PSF can still take hundreds of milliseconds.
- The engine keeps a private copy of each environment tile, so code that runs during these yields cannot change the data being processed.
- Native RAW without an environment still yields only at tile boundaries. Its sites belong to the supplier until they are parsed, so a 256-site tile is read, parsed, validated and computed in one step. That takes a median of about 10 ms in Node on the repository fixture (host-dependent). Callers who need shorter blocks can pass a smaller explicit `tileWidth`.

**Shared state across sites.** Within one native environment event, every site must declare the same shared source, optics, motion, PSF, pupil and field-throughput state.

- If a site's copied shared state is strictly equal to the first admitted site's (same plain records and arrays, keys in the same order, `Object.is` primitives), it reuses that site's engine-owned copy. A sampled PSF is therefore parsed and frozen once per event, not once per site.
- Any other site is compared by canonical serialisation, as before. That comparison decides acceptance and the error message.
- This changes no value, callback or error.

**Lean site plans.** Native environment execution reads only each planned query's frozen provider request and image-plane point. So once a query is computed and validated at plan time, the per-site plan keeps just those two parts, not the whole query envelope. With a 375-node 31×31 sampled PSF (15,376 queries per site), this lowers a site plan from about 25 MB to about 8 MB of JavaScript heap (Node; host-dependent). `simulateEnvironmentSensorRawFrame` and the other full-record paths keep the complete envelopes.

### Lean per-site execution (2.0 performance)

`createNativeEnvironmentRawTask`, and therefore `simulateCapture()`, runs most sites through a lean executor (`src/capture/native-environment-lean.ts`).

It produces byte-identical results to the full path: RAW codes, black levels, saturation codes and flags, white levels, photo expectations, provider callbacks (the same frozen requests and aperture rays, in the same order) and errors. It only skips per-site re-validation and result-envelope construction that is provably redundant.

- **Templates.** The first site of each CFA phase with a not-yet-seen environment runs the full planner and executor, and becomes a template. A later site runs lean only if:
  - its copied environment is strictly equal to the template's (plain data, same keys in the same order, `Object.is` leaves), except for the two index-bound fields `temporalIntegrationId` and `sensor.spatialSampling.site`; and
  - it has the same CFA phase.

  Every check that does not depend on the site therefore passes exactly as it did for the template. The sensor stage has its own templates. Its dark-current, charge-completeness and readout inputs must be strictly equal, except for `site` fields equal to the site's own coordinates and completeness offsets equal to its local exposure window.
- **Site-dependent work is recomputed** with the full chain's arithmetic, in the same floating-point order:
  - aperture centre and bounds, spatial quadrature points, the local exposure window, field throughput, aperture rays, and the focus-aware rotated query and its request;
  - with a sampled PSF, each node's kernel (resolved by the same code as `resolveLensSampledPsf`, without its result envelope), its tap points (`sensorPsfSourcePoint`) and each node's kernel-weighted tap sum, in kernel order;
  - with a `lensFieldMapping`, each tap's query, built by the full planner's own mapped-query function, and its distortion area factor, applied once after the tap's pupil sum;
  - with ideal pupil rays, each tap's rays, by `calculateSensorApertureRays`' own code after one pupil, f-number and focus validation per template; each ray handed to the provider is a frozen key-by-key copy, equal to the `structuredClone` copy used before;
  - then scene-to-sensor acceptance, spatio-spectral reduction, operating range, EQE electron rate (Kahan sums), temporal midpoint sums, dark and total charge, Poisson charge draws, read noise, fixed-pattern values and the ADC transfer.

  Every provider result is validated by the same parser (engine-built key taps, below, call no provider).
- **Every data-dependent check is kept.** When one fails (for example an out-of-range operating input, a non-finite irradiance or a provider identity mismatch), the lean path calls the full engine function with exactly the same inputs. It therefore throws the same error after the same callbacks. Planning falls back before any callback. Checks that the full path runs while composing or parsing a site are evaluated at that same point.
  With a sampled PSF, the PSF quadrature's per-instant checks (finite, non-negative tap irradiances, finite weighted sums and reduction) run after that instant's callbacks, as in the full path. If one fails, the full quadrature runs on the site's full plan (built without callbacks) and throws its own error or returns its own values.
- **Self-verification.** Each template's own site is planned and executed by both paths. Every lean value must match bit for bit (`Object.is`) before any other site uses the template, including each resolved PSF kernel and each node's PSF irradiance. A mismatch disables the template, and its sites run the full path.
- **Always full path (not lean-eligible):** colour-site bindings that are not one-to-one, additional stored-charge components, and anything outside these rules. Examples: reordered keys, `-0` coordinates, a PSF kernel whose tap count differs from the template's, or a site whose inputs differ from every template. There are at most 64 templates per event. Sampled-PSF and lens-mapped sites have been lean-eligible since the #275 follow-up.

Measured in Node 24 on one host (CPU time, so host-dependent):

| Case | Before | After |
| --- | --- | --- |
| Facade's default 64×64 capture, total | about 6.0 s | 0.87 s (6.9×) |
| 128×128 slanted-edge capture | 20.6 s (1.22 ms per native site) | 2.2 s (0.13 ms per site; 9.4×) |
| RAW stage alone at 64×64, per site | about 950 µs | 120 µs (8×) |
| Same, with four temporal samples, per site | about 2.6 ms | 0.21 ms |

Sampled-PSF and lens-mapped coverage (#275 follow-up), `simulateCapture()` 48 × 48 (50 × 50 native sites) slanted edge, wall time, median of 3 runs after one warm-up, Node 24 on a shared 4-vCPU Linux host, measured with `scripts/benchmark-native-environment.mjs`; RAW and developed-image SHA-256 identical before and after:

| Case | Before | After |
| --- | --- | --- |
| 3 × 3 sampled PSF (`lens.psf`) | 11.9 s | 1.96 s (6.1×) |
| Radial distortion (`lens.distortion`) | 2.63 s | 0.59 s (4.4×) |
| Ideal pupil, 1 × 4 rays (`lens.pupilSampling`), after the change above | 2.19 s | 1.26 s (1.7×) |

All #275 follow-ups together (main before, branch head after, same method): sampled PSF 11.2 → 1.60 s, radial distortion 2.66 → 0.46 s, 1 × 4 pupil rays 2.32 → 1.15 s; default optics unchanged within noise (0.33 vs 0.34 s).

The remaining time is mostly the private copy of each supplied tile, parsing provider results, comparing templates, and the provider callbacks themselves.

### Tabulated RAW for engine-built planar scenes (2.8, #394 step 2)

A `simulateCapture()` of a chart preset or a caller material scene with a still, rectilinear, distortion-free camera (no rotation, lens projection or distortion, vignetting, pupil sampling or caller PSF; diffraction only as the object-space convolution) does not run the environment task.

- **Electrons:** each native site's expected photo electrons come from the display view's expected signal (`src/facade/expected-signal.ts`), integrated per site from the materials' spectra when the site is read (2.21.0); the `raw.expectedSignal` assumption names the method `per-site-integrated-electrons` (`tabulated-expected-electrons` before 2.22.0). It is the same sum over pixel-aperture nodes, anti-aliasing spots, diffraction taps and spectral nodes that the chain forms for this scene, in another order, with the channel responses taken from the facade's own chain at the optical axis.
- **Sensor stage:** the native one (`createVerifiedNativeSiteReadout`): dark charge from the site's local exposure window, both Poisson draws and read noise with the site's own seeds, and the ADC. The output arrays, white levels and region handling are those of the environment task (`src/capture/native-environment-tabulated.ts`).
- **Verification:** the top-left 2 × 2 sites of the frame or region (one per CFA phase) run the full chain: planning, the evaluator's callbacks, composition, parsing and `calculateNativeRawSite`.
  - The readout template must reproduce each of those sites bit for bit.
  - Its tabulated electrons must agree with the chain's within 1e-9 relative.
  - A site whose sensor checks would fail also hands the capture back.
  - #453: the chain's photo signal comes from an internal engine-owned execution (`executeEngineOwnedEnvironmentPhotoSignal` in `src/sensor/environment-photo-signal.ts`). It makes the same evaluator calls with the same requests and forms the photo signal with the same code from the same values as `executeEnvironmentSensorPhotoSignal`. The first query runs every check; later queries keep every per-query check and skip only the re-validation of records the engine built and already validated (the profile-to-profile scene bindings, the optical bridge's unchanged profile and optics, the re-parse of request and result, the result envelopes). With diffraction, the verification's object-space convolution fills each lattice point of a chart or material scene from one material lookup (`chartMaterialAt`, then `materialRadiance` per spectral node), the same numbers as `radianceAt`. `test/tabulated-verification-chain.test.ts` checks both bit for bit and checks that a wrong tabulated signal is rejected.

  If any check fails, the facade runs the environment task.
- **Exactness:** electrons that differ from the chain's in the last bits could, rarely, take a different branch of a Poisson draw. On the frames tested (above 1.3 million sites, Speed and Quality) no RAW code differed. `test/native-environment-tabulated.test.ts` compares both paths. Tests of the environment path itself turn the tabulated path off (`setTabulatedNativeRawEnabled`, internal).

### Engine-built tiles and key taps (2.8, #394)

Two further changes apply only to inputs that `simulateCapture` builds itself; they change no byte of any result.

- **No private copy of engine-built tiles.** The facade's tile reader is marked internal (`markInternalNativeTileReader`). Its site records are fresh per call, never shown to supplied code and never changed afterwards, so the task plans them as engine-owned data without the `structuredClone` it makes of a caller's tiles. Shared nested records keep their identity, which shortens the template comparisons.
- **Key taps.** The evaluator of a chart preset or a caller material scene is engine-built: its result for an environment-direction query is `materialRadiance(material, wavelength)` for the material at the queried plane point. With object-space diffraction, it is the convolved value at one lattice site (shift, column, row) for the wavelength. The facade registers this lookup (`registerInternalRadianceAccess`: the key of a direction, with the evaluator's own plane-point arithmetic, and the radiance of a key). A verified template whose environment has no pupil and no lens field mapping then plans its sites' taps as keys instead of frozen requests. Without a PSF, a tap's point, direction, field throughput and key are the same at every spectral node, so they are computed once per spatial node. Execution takes each tap's radiance from the key (chart materials from a table filled once per material and spectral node) and applies `tapIrradiance`'s arithmetic, in the same order. It adds the evaluations the full path would count and runs its abort check, then the PSF checks of each instant.
  - **Verification:** a template takes key taps only after its own site's key radiances equal every evaluation of its full execution, tap by tap (`Object.is`).
  - **Fallbacks:** a tap whose irradiance needs the full function (not finite, negative, or a field throughput outside the fast path) returns the site to the full path before anything is counted. A direction the evaluator would reject, or a caller `materialAt` that throws, makes key planning fall back, and the full path then throws its own error.
  - **Not applied:** caller reflectance and radiance functions, batched providers, pupil rays and lens field mappings keep request taps and real callbacks.

`test/native-environment-key-taps.test.ts` compares lean and full captures for these cases. Speed-ups are in the 2.8.0 CHANGELOG entry.

### Optional smaller execution chunks (unreleased)

`NativeRawInput.tileWidth` can explicitly choose an integer from 1 to 256 native sites.

- If omitted, the original 256-site execution and plan shape are kept.
- An explicit width is copied into the immutable plan. It changes only the tile count and the width of provider requests. Host yields still follow the time budget above.
- Absolute native CFA coordinates, noise seeds, rolling exposure windows and all output codes and flags are unchanged.
- This control does not change physical sampling or quadrature.

**Why use it.** Smaller chunks let an optical event with many queries per site fit under the existing 100,000-query tile cap, without changing the event. For example, 64 sites at 1,024 source queries per site need 65,536 queries in a tile, while 256 sites would exceed the cap.

The two-billion whole-event cap and the 24-million-site and output-byte limits are unchanged. A smaller tile never proves convergence, validated source transport or production activation. The caller must still meet the full-event budget, and must validate the source and result independently.

### Reusing the optical stage for post-optics edits (unreleased)

Native environment capture spends almost all its time in the scene radiance → optics → EQE stage. If the optical event has not changed, you can keep that stage's per-site result and re-run only the sensor stage:

- `createNativeEnvironmentRawTask` can retain the optical stage's per-site result.
- `createNativeEnvironmentSensorStageTask` re-runs only the sensor stage from it, without calling any radiance callback.

Both are opt-in. If you omit `NativeEnvironmentRawInput.opticalStage`, behaviour and output shape are unchanged.

```ts
const prepared = createNativeEnvironmentRawTask({ ...input, opticalStage: { maximumRetainedBytes } }, provider);
await prepared.run();
const { raw, opticalStage } = prepared.takeOutput();
// Later: new seed, ISO/readout gain, dark profile or WB intent; same optical inputs.
const edit = createNativeEnvironmentSensorStageTask({ raw: editedRawInput, sceneBinding: input.sceneBinding }, opticalStage!,
  { readTile: provider.readTile, yieldControl: provider.yieldControl });
await edit.run();
const edited = edit.takeOutput(); // develop with createNativeRawDevelopmentTask as usual
opticalStage!.dispose();
```

**What is retained.** The optical stage ends at each site's photo-signal expectation:

- the midpoint times;
- the incident-photon and generated-electron rates, and their exact midpoint sums;
- the local exposure window.

These are kept as float64 values and passed back to the unchanged sensor code (dark charge, accumulated charge, capacity, Poisson/read-noise realisation, ADC). They are exactly the numbers the optical stage produced. RAW codes, black levels, saturation codes and flags, and therefore developed output, are bit-identical to a full `createNativeEnvironmentRawTask` with the same final inputs.

This relies on one assumption that the full path also makes: the radiance provider is a deterministic function of its request, given the bound provider scene and profile identities. The engine cannot inspect supplied code.

**Settings you can change and still reuse.** The optical stage never reads:

- the capture's noise seed or realisation;
- ISO metadata, white-balance intent or adopted white;
- capture identity, source-artifact metadata or declared models;
- the per-site readout profile or regime (conversion gain, read noise, ADC);
- charge sampling, capacity, completeness, or the dark-current profile and temperature.

Changing only these reuses the stage. White balance and rendering exposure act in `createNativeRawDevelopmentTask`, which reads only the RAW.

**Settings that refuse reuse.** Everything else is part of the binding. It is compared by strict structural equality: `Object.is` on every number (so `0` and `-0` differ) and identical key sets. This includes:

- scene state and time;
- geometry, including orientation and imaging area;
- focal length, aperture, shutter time and the exposure window (global or rolling scan), and focus;
- frame, mode, CFA and binding profiles;
- the scene binding and its provider scene;
- every field of every site's environment: provider, illumination, temporal-illumination and material profiles, optical profile, motion, PSF selection and profile, field throughput and vignetting, pupil sampling, spectral and spatial sampling, spectral response (EQE) and temporal sample count.

A capture-level difference is refused when the reuse task is created, before any tile is read. A site-environment difference is refused when that tile is read, before it is executed. Either way, no output is produced. There is no automatic recompute: the caller runs `createNativeEnvironmentRawTask` again.

**Why shutter time is not reusable.** Shutter time sets the local exposure window, and so the midpoint query times. Those times go into every radiance request, the motion rotation and the temporal-illumination waveforms, and the midpoint weight is `duration / temporalSampleCount`. A static scene would give irradiance that does not depend on time. But the engine cannot prove that a supplied provider ignores request time, and scaling the stored counts by a ratio of durations would not reproduce the full path's arithmetic. So a shutter change needs a full recompute.

**Memory.** For every native site, retention stores `NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS.fixedBytesPerSite` (58 bytes) plus `bytesPerTemporalSamplePerSite` (24 bytes) per temporal midpoint. That is 106 bytes per site with two midpoints, or about 2.5 GB for 24 million sites.

- `maximumRetainedBytes` must allow `pixelCount × (58 + 24 × temporalSampleCount)`. The check runs after the first tile is planned and before any radiance callback.
- An event must use one temporal sample count.
- Distinct site environments (ignoring the absolute site and integration ID), and distinct photo identity and evidence records, are interned (stored once and shared). Each is capped at 256.
- `retainedBytes` reports the total typed-array size.
- `dispose()` zeroes and releases the storage. A disposed or forged stage is refused. Disposing during a running reuse stops it at the next tile.
- Cancelling, disposing or failing the producing task before `takeOutput()` releases the stage. After transfer, the caller owns it.
- A stage can be reused any number of times.

`createNativeEnvironmentSensorStageTask` reports `providerEvaluationCount: 0`; `opticalStage.providerEvaluationCount` records the producing task's count.

`test/native-environment-optical-stage.test.ts` checks reuse against full recomputes. It covers a PSF with radial field, a flat emitter, pupil rays and eight temporal midpoints, across edits to seed, ISO with readout gain, white balance, rendering exposure and dark current. It also checks refusal for every optical input listed above, the memory limit and disposal.

### Batched light sampling (`evaluateRadianceBatch`, 2.0)

`NativeEnvironmentRawProvider.evaluateRadianceBatch` is an optional, additive alternative to one callback per query. When a provider defines it, the native environment task makes one call per tile instead of calling `evaluateRadiance` and `evaluateApertureRadiance` per query:

- `queries` lists every radiance query of the tile's sites, in exactly the order the per-query callbacks would be made: per site, per time instant, per spectral × spatial node, per PSF tap, then per pupil ray. Each entry holds the same frozen request, and for a pupil ray the same frozen ray copy, that the per-query callback would receive (`NativeEnvironmentRadianceQuery`).
- Return one `SceneRadianceEvaluationResult` per query, in the same order, or a promise of them (for example after a GPU readback). Anything else (a non-array, a wrong length, holes) is rejected with `InvalidConfigurationError`.
- Each result then goes through the same parser and binding checks, and the same arithmetic, as a per-query result. With the same results, RAW, photo expectations, the evaluation count and errors are identical to the per-query provider.
- A tile holds at most 100,000 queries, so a batch is bounded.

Differences from per-query callbacks: all of a tile's queries are evaluated before any of its sites is executed, so a defective result is reported after the whole tile's callbacks rather than right after its own. The per-query evaluators stay required as the reference contract, and pupil sampling still requires `evaluateApertureRadiance` to be declared, but neither is called while a batch function is present. Row-band partitions use the batch function the same way.

`test/native-environment-batch.test.ts` checks equality with the per-query provider (RAW, photo expectations, evaluation counts and the exact request sequence, including frozen flags) for the four hash-locked workloads and lean facade captures with pupil rays and a lens field mapping, with synchronous and promise results, inside partitions, and for defective results.

**Measured** (Node 24, shared 4-vCPU Linux host, 48 × 48, one thread, analytic JavaScript radiance, median of 5, alternated with per-query runs, `scripts/benchmark-native-environment-workers.mjs`): default optics 0.29 s per-query vs 0.27 s batched; 4 pupil rays 2.11 s vs 2.43 s. A batch call itself saves little on the CPU; its purpose is to let a provider evaluate a tile at once (GPU, WebAssembly or another thread). No GPU provider is part of this change.

### Opt-in parallel execution (row-band partitions, 2.0)

`createNativeEnvironmentRawTask` runs on one thread. A capture can instead be split into bands of whole native rows and run in parallel:

1. `calculateNativeRawRowBands(plan, count)` returns at most `count` contiguous bands of nearly equal height, in row order. It depends only on the raster height and `count`.
2. `createNativeEnvironmentRawPartitionTask(input, band, provider)` runs one band. It takes the same input as the single task, and its provider is built where it runs (functions cannot be posted between workers). Its `takeOutput()` returns a `NativeEnvironmentRawPartition`: plain data plus four typed arrays for the band's rows, which can be posted with their buffers transferred.
3. `composeNativeEnvironmentRawPartitions(input, partitions)` joins the partitions, in row order, into the `NativeEnvironmentRawOutput` the single task returns.

The package bundles no worker code, so the root package stays browser-safe and the package surface is unchanged. The caller creates the workers (Web Workers, Node worker threads, or none: partitions can also run one after another).

**Byte identity.** The merged RAW codes, black levels, saturation codes, flags and per-phase white levels are byte-identical to the single task's for the same input and a deterministic provider, and `providerEvaluationCount` is the sum. Noise seeds use absolute native indices, and each band reads the same tiles, plans the same sites and computes the same per-site values (lean or full) as the single task. `test/native-environment-partitions.test.ts` checks this for the four hash-locked workloads and a facade capture with 1, 2, 3 and one-row bands, with each partition passed through `structuredClone` as `postMessage` would.

**Checks.** Each partition validates the same inputs and limits as the single task before its callbacks. Checks that span sites run inside each band and again across bands in the merge:

- one shared source, optical and motion state (the merge compares each band's canonical state);
- one readout identity and fixed-pattern identity (each band's first site);
- one effective white level per CFA phase, and a white level for every phase.

The merge also rejects a partition from a different input (compared by canonical JSON), a gap, overlap or wrong order, wrong array types or lengths, and a total evaluation count above `maximumProviderEvaluations`. It validates shape and consistency only: posted partitions are the caller's own data, and the merge cannot recompute them.

**Limits.**

- `maximumProviderEvaluations` bounds each partition's own work before it starts; the whole-capture total is checked only at the merge, after the work.
- Callbacks are split across partitions and run concurrently. When several partitions fail, which error the caller sees first depends on its scheduling. Successful output does not depend on it.
- Optical-stage retention (`opticalStage`) is not supported in a partition.
- Each band builds its own lean templates (the first sites of each CFA phase in the band run the full path).

**Measured** with `scripts/benchmark-native-environment-workers.mjs` (Node worker threads, Node 24, shared 4-vCPU Linux host, 48 × 48 output, 2,500 native sites, median of 3 after one warm-up; merged RAW SHA-256 equal to the single task's in every run). Worker start-up (about 0.1–0.2 s, sending the site inputs) is excluded from the run time.

| Case | Single task | 2 workers | 4 workers |
| --- | --- | --- | --- |
| 3 × 3 sampled PSF | 1.53 s | 1.00 s (1.5×) | 0.66 s (2.3×) |
| Default optics | 0.27 s | 0.17 s (1.6×) | 0.23 s (1.2×) |

Speed-up depends on the work per site and the host. Cheap sites gain little: at 96 × 96 with default optics, 2 workers ran 0.86 → 0.72 s and 4 workers were not faster. These are single measurements on one shared host, not a performance claim.

## Native RAW DNG

`serializeNativeRawDng({ raw, colorProfile, noise?, baselineExposureEv?, capturedAtUtc?, textMetadata?, opcodeList3? })` writes a packed `NativeRawOutput` as a lossless, uncompressed 16-bit CFA DNG (DNG 1.4 tags, Adobe DNG Specification 1.7.1.0). It uses the TIFF/DNG tag writers of the paired photographic export.

Unlike `createPhotographicExportPair`, it needs no bounded `SensorRawFrame` or `SimulatedCapture` linear-master record, and it declares none. The ImageDescription states that the file holds a simulated packed RAW without a linear master or rendering. The result reports `source: "packed-native-raw"` and `linearMasterDeclared: false`.

- **Validation.** The packed RAW is revalidated (`validatePackedNativeRaw`, the same check native development runs), and its code spans are checked. Only 2 × 2 RGB Bayer CFAs are supported. The colour profile must be bound to the RAW's CFA.
- **Levels.** BlackLevel (BlackLevelRepeatDim 2 × 2) and CFAPattern are phases relative to the ActiveArea origin, because DNG applies them to the image after cropping to ActiveArea. The per-site black levels must repeat with the CFA tile. WhiteLevel is the smallest per-phase effective white code. Sites flagged as saturated below WhiteLevel cannot be represented; they are counted in `unrepresentedSaturationFlagCount`.
- **Geometry.** ActiveArea is the capture's active native rectangle. DefaultCropOrigin/Size is the oriented output crop mapped back to stored coordinates (relative to ActiveArea). Orientation is 1, 6, 3 or 8.
- **Colour.**
  - ColorMatrix1 = (camera→XYZ)⁻¹, with CalibrationIlluminant1 21 (D65).
  - ForwardMatrix1 = Bradford(D65→D50)·M·diag(w).
  - AnalogBalance 1.
  - AsShotNeutral comes from the capture's white-balance intent, through the native development operator.
  - BaselineExposure as declared (default 0).
- **Noise.** NoiseProfile per CFA plane, var(x) = S·x + O, with S = 1/(G·span) and O = (σ²/G² + 1/12)/span². It is written only when `noise` gives each channel's output-referred gain G (electrons per code) and read noise σ (electrons). It includes Poisson shot noise, Gaussian read noise and quantisation. It does not include PRNU, DSNU or other fixed-pattern noise.
- **Exif.** ExposureTime, FNumber, ISO (as the recommended exposure index), FocalLength, ColorSpace uncalibrated, and PixelX/YDimension. Date tags are written only when `capturedAtUtc` is given.
- **Text (2.4).** Only with `textMetadata` (`OutputTextMetadata`: `description`, `software`, `copyright`, `comment`). A printable-ASCII description is appended to ImageDescription after the statement, and a printable-ASCII `copyright` field is written to tag 33432; TIFF ASCII fields hold 7-bit codes (TIFF 6.0 §2). An XMP packet in tag 700 (BYTE, XMP Specification Part 3 §1.1.6) carries every field in UTF-8: `dc:description` (the full ImageDescription text), `dc:rights`, `xmp:CreatorTool` and `exif:UserComment`. Software keeps naming the writer. Without `textMetadata` the bytes are unchanged. See "Text metadata (2.4)" in the [quick start](QUICK_START.md).
- **Identity.** RawDataUniqueID is the first 128 bits of SHA-256 over a fixed header and the little-endian codes.
- **Opcodes (#587).** Only with `opcodeList3`: the bytes are written unchanged as OpcodeList3 (tag 51022, UNDEFINED). Only the list's framing is checked (a big-endian opcode count, then 16-byte opcode headers whose parameter sizes fill the bytes exactly). Without it the bytes are unchanged.

The input arrays are copied before the first await and never modified.

`test/native-raw-dng.test.ts` round-trips codes and every written tag through `parseDngRawImage`, for odd, even and zero ActiveArea origins. LibRaw 0.22.1 decodes identical codes. Pillow 12 parses every tag, but cannot decode CFA (photometric 32803) images at all.

### Lens-correction opcodes (#587)

`simulateCapture` with `lens.catalogue` and `output.format: "dng"` can carry the catalogue lens's corrections in the DNG as metadata a RAW editor applies, non-destructively: `output.dng.lensCorrectionOpcodes: { distortion?, lateralColor?, vignetting? }`, each off unless `true`. The RAW codes are never changed; only OpcodeList3 is added. With every switch off, or the option omitted, the DNG bytes are identical to a DNG without it. The corrections are those of `output.lensCorrections` (#570) and of `createGenericLensCorrectionProfile` (#549, #584), so an editor that applies the opcodes gets the corrected JPEG's geometry, framing and corner brightness (its own tone and colour rendering stay its own). Whole frame only (not with `output.region`); `serializeSimulatedCaptureDngFromParts` writes the same bytes from parts. The assumption `output.dng.lensCorrectionOpcodes` records the opcodes written, their coefficients, the zoom-to-fill magnification and the vignetting fit error.

The opcodes follow the Adobe DNG Specification (opcode lists from version 1.3.0.0; the writer follows 1.7.1.0), "Opcode List Processing":

- **OpcodeList3** (tag 51022) is applied by a reader to the linear, demosaiced stage-3 image, which is the ActiveArea, here exactly the output frame. The list is big-endian whatever the file's byte order: a LONG count, then per opcode its LONG id, the DNG version that introduced it (1.3.0.0), LONG flags and the LONG byte count of its parameters. Every opcode has flag bit 0 (optional) set, so a reader that does not support it can skip it; the file's DNGBackwardVersion stays 1.1.0.0.
- **FixVignetteRadial** (id 3), first: each pixel is multiplied by g = 1 + k0r² + k1r⁴ + k2r⁶ + k3r⁸ + k4r¹⁰, r the distance from the optical centre (cx = cy = 0.5, the image centre) normalized to 1 at the farthest corner. It acts before the warp, at the captured position, where the capture applied the falloff. The target is the profile's gain G = det J(ρ_i)/E(ρ) (#584): the lens's relative illumination at the capture's f-number and its distortion's area factor (whether or not the distortion is corrected). G is not a polynomial in r², so k0…k4 are a near-minimax fit of g/G − 1 (Lawson's iteratively reweighted least squares) on 2 048 radii; a fit worse than 0.1 % is refused (GainMap, id 9, would be needed). Measured over the whole catalogue, wide open to fully stopped down: 0.062 % at most (PV 600 6.3 wide open). An approximation of the profile, itself a labelled approximation.
- **WarpRectilinear** (id 1), second, when distortion or lateral colour is on: one plane (no lateral colour) or three (red, green, blue, CFAPlaneColor 0 1 2), each kr0…kr3, kt0, kt1, then cx, cy. For a destination pixel at normalized offset (dx, dy) from the centre, the source is the centre plus (dx, dy)·(kr0 + kr1r² + kr2r⁴ + kr3r⁶) (kt0 = kt1 = 0). `output.lensCorrections` reads channel c at s = q(1 + k1|q|²/R²), q = m·a_c·p, so kr0 = m·a_c and kr1 = k1·(m·a_c)³ represent it exactly (R the half-diagonal; a_c the channel's lateral-colour scale; m the zoom-to-fill factor of #570 folded in, so the editor's result has the corrected JPEG's framing). The catalogue fisheyes keep their projection; only their small radial departure is corrected, as in the JPEG (WarpFisheye is not used).

Limits. Some editors apply DNG opcodes automatically, with no control in the editor: the switch that is guaranteed is the one in Photivra, leaving a correction out of the DNG. An editor's resampling filter and its stage-3 clipping are its own; a gain above 1 in a bright corner can clip there as it clips in the JPEG. `test/dng-lens-correction-opcodes.test.ts` reads the opcodes back with an independent parser written from the specification's layout and equations: on PV 16 2.8 (barrel) and PV 300 5.6 (pincushion) the mapping matches `output.lensCorrections`' to 1e-9 pixels in every channel and the gain matches `calculatePeripheralIlluminationCorrection` within 0.1 %; the RAW codes and every parsed tag are unchanged, and the file passes `parseDngRawImage`.

## Print stage

`createPrintJpegTask` makes a print-ready JPEG from an already rendered image. Its input is explicitly encoded sRGB 8-bit RGB, in an output raster that is already oriented.

**Crop and resampling.**

- It crops only within real source support. It rejects enlargement, stretching and unsupported aspect ratios.
- Area filtering decodes this post-SDR image to linear values, integrates the exact pixel overlap, then encodes and quantises back to sRGB.
- This does not recover sensor headroom and does not reprocess RAW.

**Reading the source.** Source reads are limited to 256 × 32 pixels.

- Since 2.0.0, the task reads each crop pixel exactly once, in tiles aligned to the crop origin (32-row bands of 256-column tiles). It keeps at most 63 crop-width rows in a rolling cache.
- It therefore needs exactly ⌈crop height / 32⌉ × ⌈crop width / 256⌉ provider reads. `maximumProviderReads` caps that number; a smaller budget fails before the first read.
- Earlier versions issued one or more reads per output 8 × 8 block: 375 000 reads for a 24 MP 1:1 print, now 3 000.
- The 8-bit sRGB decode uses a 256-entry table built from the same `decodeSrgbComponent` function. Per-output-pixel accumulation keeps the old band/chunk/row/column order. The samples passed to the encoder are therefore bit-identical to the old per-block reader (`test/print-jpeg-strip-identity.test.ts`).
- Encoded values are rounded to the nearest code, with ties rounded up (`Math.round`). The former `Math.floor(x + 0.5)` rounded 0.49999999999999994 up.
- JPEG coding uses 8 × 8 blocks. Edges are replicated only to fill the final JPEG coding blocks, never for reconstruction or crop support.

**File contents.** The baseline JPEG encoder (written for this project) embeds:

- an ICC v4.3 sRGB matrix/TRC profile, also written for this project;
- an Exif APP1 segment with every tag that Exif 2.32 marks mandatory (CIPA DC-008-2019, §4.6.8 Tables 17–18, "Compressed" column):
  - IFD0: XResolution, YResolution, ResolutionUnit, YCbCrPositioning (1, centred) and the Exif IFD pointer;
  - Exif IFD: ExifVersion `0232`, FlashpixVersion `0100`, ComponentsConfiguration Y Cb Cr, ColorSpace sRGB and PixelX/YDimension;
  - Orientation 1 and Software are also written.

**Print resolution.**

- An optional `pixelsPerInch` (1–65535) from the caller's print plan is written as IFD0 XResolution/YResolution RATIONALs with ResolutionUnit 2 (inches). Integers are exact; other values use the nearest decimal rational.
- It is also written as JFIF 1.02 APP0 units 1 (dots per inch). JFIF density is a 16-bit integer, so APP0 carries the nearest integer while Exif keeps the fractional value.
- Without `pixelsPerInch`, the file claims no physical size: APP0 keeps units 0 with a 1:1 aspect ratio. Exif makes the IFD0 resolution tags mandatory and says that "when the image resolution is unknown, 72 [dpi] shall be designated". So IFD0 records 72/1 with ResolutionUnit 2. That is the standard's marker for unknown resolution, not a planned print size. (Before 2.0.0 these tags were omitted.)

**Other metadata and limits.**

- The XMP records the immutable Print plan and declares the source bytes unverified.
- The output carries `schemaVersion` `0.2.0` (for the Exif and read-pattern changes above) and `encoderId` (`EXPORT_JPEG_ENCODER_ID`; see [Photographic export](PHOTOGRAPHIC_EXPORT.md)).
- Encoded output is limited to at most 256 MB, and provider reads to one million.
- The caller owns the final file. Browser save/share, file-size requirements and printer/paper appearance must be validated separately.

**ICC profile.** The ICC serialiser uses the engine's existing sRGB primaries and transfer function, standard numerical Bradford adaptation to the D50 PCS (profile connection space), and ICC tag serialisation written for this project. This profile adaptation does not add a shooting white-balance model. Numerical facts and format references: [ICC sRGB interpretation](https://registry.color.org/rgb-registry/files/sRGB.pdf), [ICC profile specification](https://www.color.org/icc34.pdf). No third-party ICC profile bytes or implementation are redistributed.

## Reproducible validation

These tests cover small-reference parity, odd-width absolute phase and seed boundaries, orientation, signed noise below black, whole-output budgets, corrupt providers, support halos, and cancellation and ownership:

- `test/native-raw.test.ts`
- `test/native-environment-raw.test.ts`
- `test/native-environment-optical-stage.test.ts`
- `test/native-raw-development.test.ts`
- `test/print-jpeg.test.ts`
- `test/print-jpeg-strip-identity.test.ts`

**Megapixel test (optional).** Run `PHOTIVRA_VALIDATE_MEGAPIXEL_RAW=1 PHOTIVRA_RAW_REPORT=/tmp/native-raw-report.json npx vitest run test/native-raw-megapixel.test.ts`. It executes every one of a million native sites, develops that exact RAW, and downsamples it to a 500 × 500 JPEG with ICC profile. The constructed count inputs are not a validated megapixel scene-radiance capture.

**Independent check of the megapixel output.** `scripts/verify-native-raw-megapixel.py` decodes the megapixel test's actual JPEG outside the engine. Run it on the report the test wrote:

```sh
python3 scripts/verify-native-raw-megapixel.py /tmp/native-raw-report.json /tmp/native-raw-validation.json
```

- **Inputs.** The first argument is the report JSON. The script also reads the two files the test writes beside it: `<report>.rgb.gz`, the gzipped 1000 × 1000 8-bit RGB SDR samples, and `<report>.jpg`, the encoded JPEG. The second argument is where the result JSON is written.
- **What it checks.** The SHA-256 of the samples and of the JPEG must equal `sdrSamplesSha256` and `jpegSha256` in the report. It decodes the sRGB samples to linear light, averages each 2 × 2 block, re-encodes to sRGB and rounds to 8 bits. This is its own oracle for the 500 × 500 area filter. It then decodes the JPEG with Pillow and checks the size (500 × 500), the EXIF Orientation (1) and ColorSpace (1, sRGB) tags, and the embedded ICC profile description (`Photivra sRGB matrix/TRC v4`). Every decoded code must be within 4 of the oracle.
- **Output.** On success it writes and prints `pass`, `maximumJpegCodeError`, the two input hashes and the script's own SHA-256. Any failed check stops it with an `AssertionError` and writes nothing.
- **Requirements.** Python 3 with NumPy and Pillow built with LittleCMS (`PIL.ImageCms`). It needs no network and no Node build. The size and tolerance are fixed in the script, so it only accepts the 1000 × 1000 megapixel test output.
- **Scope.** It checks the JPEG, EXIF, ICC and area filtering of the retained SDR samples only. RAW generation and reconstruction are qualified separately.
- **Recorded run.** `docs/validation/native-raw-print-2026-10-04/` holds the inputs of the recorded run (`photivra-native-full-megapixel.json` and its `.rgb.gz` and `.jpg`) and the script's result (`photivra-native-full-megapixel-validation.json`, maximum error 3 codes). Running the script on that report reproduces the recorded result exactly, including its `validatorSha256`.

**Print JPEG controls.** Generate the separate colour, checker, asymmetric fractional crop, grey ramp and one-megapixel JPEG controls with `node scripts/generate-native-print-jpeg.mjs /tmp/native-print`. Check the actual bytes with `python scripts/verify-native-print-jpeg.py /tmp/native-print /tmp/native-print/validation.json`, in an environment with NumPy and Pillow/LittleCMS.

- The independent area oracle expects 188 when a half-black, half-white sRGB checker is reduced, rather than an average of encoded values.
- JPEG tolerance is four encoded codes.
- The ICC profile is compared against LittleCMS sRGB over a 17³ colour cube, with a one-code budget.

These controls do not validate all product fixtures, calibrated sensor or lens behaviour, diffraction, full production depth composition, real phone or tablet resources, printer appearance, platform save/share, or substantive human review.

## Standalone bounded Print example

This runnable control declares a constant encoded RGB source. The all-zero digest is a placeholder; the engine does not authenticate it. A product should bind its real retained artifact, and enforce its own validation before offering export.

```ts
import { createPrintJpegTask, createSrgbIccProfile } from '@photivra/engine';
const source = { captureId: 'owned-control', imageStateId: 'encoded-control', artifactId: 'constant-gray',
  sha256: '0'.repeat(64), width: 16, height: 16, encoding: 'encoded-srgb-8-rgb' as const };
const task = createPrintJpegTask({ source, crop: { x: 0, y: 0, width: 16, height: 16 },
  outputWidth: 8, outputHeight: 8, quantizationStep: 1, maximumEncodedBytes: 16000, maximumProviderReads: 100 }, {
  readTile: async request => ({ ...request, samples: new Uint8Array(request.width * request.height * 3).fill(128) }),
  yieldControl: async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); }
});
await task.run();
const jpeg = task.takeOutput();
if (jpeg.bytes.length === 0 || jpeg.width !== 8 || createSrgbIccProfile().length === 0) throw new Error('Control failed');
```
