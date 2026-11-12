# OpenSource V1 composition and consumer map

Release context (dated historical note): written for the **package 1.2.0 candidate / root API 1.2.0** and not re-reviewed for later releases; see the [changelog](../CHANGELOG.md) for the current release. Subsystem/model versions and dated introduction or measurement records below are independent historical identities; they are not distribution versions. See [developer navigation](DEVELOPERS.md) and [release contract](RELEASE_1_2_0.md).

Current candidate: package/root API 1.0.1, production plan 0.7.0. The following V1 audit records the original 1.0.0 preparation. Feature/science main is `34c6d9aca1c2e365b253c1562734d11bc8e0235f` (#206). [V1 #129](https://github.com/Photivra/engine/issues/129) is **32/32**; #178 and #131 are closed. This audit reconciles current consumer boundaries below; #180 is the release-preparation contribution and publication remains owner-only.

A closed foundation ticket establishes its primitive scope, not automatic
availability of every optional model in every production route. Direct consumers,
bounded executed composition and unsupported combinations are distinguished
below; no unsupported combination is an approved V1 deferral.

## All 32 scoped items

Source paths identify the main primitive/boundary, not every helper in that
feature. The consumer column distinguishes direct foundations, production-plan
results and bounded capture/output adapters. The last column records coupling rules and supported-route limits; older ticket references identify merged owners, not outstanding feature tickets. No competing RAW writer or second scientific graph is needed.

| Ticket / feature | Tracker | Primitive or boundary | Current entry point / consumer | Representative evidence | Coupling / supported boundary |
| --- | --- | --- | --- | --- | --- |
| [#1](https://github.com/Photivra/engine/issues/1) Non-circular diffraction | closed | [polygon-diffraction.ts](https://github.com/Photivra/engine/blob/main/src/optics/polygon-diffraction.ts) | Direct polygon PSF; production PSF execution absent | [polygon-diffraction.test.ts](https://github.com/Photivra/engine/blob/main/test/polygon-diffraction.test.ts) | #16/#178: compose declared pupil support without double diffraction |
| [#3](https://github.com/Photivra/engine/issues/3) Extended-object motion | closed | [extended-object-projection.ts](https://github.com/Photivra/engine/blob/main/src/motion/extended-object-projection.ts) | Direct temporal projection; production radiance accumulation absent | [extended-object-projection.test.ts](https://github.com/Photivra/engine/blob/main/test/extended-object-projection.test.ts) | #16/#178: retain depth/visibility/time at requested nodes |
| [#7](https://github.com/Photivra/engine/issues/7) ISO and signal chain | closed | [iso-signal-chain.ts](https://github.com/Photivra/engine/blob/main/src/sensor/iso-signal-chain.ts) | Explicit regime bindings; RAW producer consumes readout profiles | [generic-tier-output-acceptance.test.ts](https://github.com/Photivra/engine/blob/main/test/generic-tier-output-acceptance.test.ts) | #16: bind committed ISO to explicit regime; preserve physical charge |
| [#12](https://github.com/Photivra/engine/issues/12) Readout and shutter | closed | [exposure-window.ts](https://github.com/Photivra/engine/blob/main/src/sensor/exposure-window.ts) | Production temporal diagnostics; RAW local-window handoff | [sensor-raw-local-exposure.test.ts](https://github.com/Photivra/engine/blob/main/test/sensor-raw-local-exposure.test.ts) | #16: integrate scene signal over those windows; no inferred synchronization |
| [#14](https://github.com/Photivra/engine/issues/14) Sensor pipeline | closed | [eqe-electron-rate.ts](https://github.com/Photivra/engine/blob/main/src/sensor/eqe-electron-rate.ts) | Bounded irradiance→EQE local exposure composition; charge-to-RAW adapter | [sensor-raw-pipeline.test.ts](https://github.com/Photivra/engine/blob/main/test/sensor-raw-pipeline.test.ts) | #16/#178: bind committed scene/optics/PSF origin to physical irradiance nodes |
| [#15](https://github.com/Photivra/engine/issues/15) Linear capture and color | closed | [simulated-capture.ts](https://github.com/Photivra/engine/blob/main/src/capture/simulated-capture.ts) | Immutable capture; ideal XYZ color and linear encoding; sensor adapter distinct | [capture-color.test.ts](https://github.com/Photivra/engine/blob/main/test/capture-color.test.ts) | #112/#16: bind physical capture origin; preserve color-channel basis |
| [#16](https://github.com/Photivra/engine/issues/16) Paired RAW DNG/JPEG | closed | [photographic-export.ts](https://github.com/Photivra/engine/blob/main/src/capture/photographic-export.ts) | Exact attached-RAW reconstruction → development → correction/SDR → files | [raw-output-conformance.test.ts](https://github.com/Photivra/engine/blob/main/test/raw-output-conformance.test.ts) | Producer-derived independent/Adobe/editor evidence merged in #201; 4,096-site bound remains explicit |
| [#43](https://github.com/Photivra/engine/issues/43) Prepared/batch performance | closed | [geometric-transforms.ts](https://github.com/Photivra/engine/blob/main/src/output/geometric-transforms.ts) | Call-owned prepared geometric mapping reused by sampling execution | [geometric-preparation-reuse.test.ts](https://github.com/Photivra/engine/blob/main/test/geometric-preparation-reuse.test.ts) | [Merged final remeasurement](V1_PERFORMANCE_DISPOSITION.md); retain merged call-owned reuse; no further abstraction |
| [#45](https://github.com/Photivra/engine/issues/45) POC projection reuse | closed | [poc-simulation.ts](https://github.com/Photivra/engine/blob/main/src/simulation/poc-simulation.ts) | Private prepared projection in legacy POC defocus sweeps | [poc-projection-reuse.test.ts](https://github.com/Photivra/engine/blob/main/test/poc-projection-reuse.test.ts) | [Merged final remeasurement](V1_PERFORMANCE_DISPOSITION.md); retain request-local reuse; POC remains separate |
| [#95](https://github.com/Photivra/engine/issues/95) Stable support | closed | [camera-shake.ts](https://github.com/Photivra/engine/blob/main/src/stabilization/camera-shake.ts) | Direct ideal stable-support boundary, independent of correction | [camera-shake.test.ts](https://github.com/Photivra/engine/blob/main/test/camera-shake.test.ts) | #16/#178: requested shake/stabilization must preserve physical ownership |
| [#97](https://github.com/Photivra/engine/issues/97) IBIS/OIS | closed | [system.ts](https://github.com/Photivra/engine/blob/main/src/stabilization/system.ts) | Explicit disturbance/trajectory temporal sampling | [stabilization-system.test.ts](https://github.com/Photivra/engine/blob/main/test/stabilization-system.test.ts) | #16/#178: consume selected trajectory in physical sampling, not a blur-quality scalar |
| [#98](https://github.com/Photivra/engine/issues/98) Sensor architecture | closed | [architecture.ts](https://github.com/Photivra/engine/blob/main/src/sensor/architecture.ts) | Declared technology metadata and related standalone profile boundaries | [sensor-architecture.test.ts](https://github.com/Photivra/engine/blob/main/test/sensor-architecture.test.ts) | #16: preserve selected architecture/bindings; metadata alone is not signal execution |
| [#100](https://github.com/Photivra/engine/issues/100) Metering | closed | [metering.ts](https://github.com/Photivra/engine/blob/main/src/exposure/metering.ts) | Relative pre-exposure meter → exposure target/equipment resolver | [metering-equipment-integration.test.ts](https://github.com/Photivra/engine/blob/main/test/metering-equipment-integration.test.ts) | #16/#112: retain pre-display signal and do not infer calibrated spectral weighting |
| [#103](https://github.com/Photivra/engine/issues/103) Finite/infinity focus | closed | [focus-state.ts](https://github.com/Photivra/engine/blob/main/src/optics/focus-state.ts) | Explicit focus state consumed by optics and committed capture | [focus-state.test.ts](https://github.com/Photivra/engine/blob/main/test/focus-state.test.ts) | #16/#178: preserve focus in field/depth/PSF evaluations |
| [#104](https://github.com/Photivra/engine/issues/104) Focus control | closed | [focus-control.ts](https://github.com/Photivra/engine/blob/main/src/capture/focus-control.ts) | MF/AF state and release gate; tier body acceptance | [generic-tier-body-acceptance.test.ts](https://github.com/Photivra/engine/blob/main/test/generic-tier-body-acceptance.test.ts) | #16: carry committed focus; no undocumented tracking renderer |
| [#105](https://github.com/Photivra/engine/issues/105) Release sequencing | closed | [release-sequence.ts](https://github.com/Photivra/engine/blob/main/src/capture/release-sequence.ts) | Release frame → production snapshot binding; deterministic ownership | [production-capture-release-binding.test.ts](https://github.com/Photivra/engine/blob/main/test/production-capture-release-binding.test.ts) | #16: carry frame timing/settings/seed to physical execution |
| [#106](https://github.com/Photivra/engine/issues/106) Manual flash/sync | closed | [flash.ts](https://github.com/Photivra/engine/blob/main/src/exposure/flash.ts) | Declared sync and illumination overlay; no full production radiance integration | [flash.test.ts](https://github.com/Photivra/engine/blob/main/test/flash.test.ts) | #16/#178: apply physical-time light transport when selected; no exposure-duration shortcut |
| [#108](https://github.com/Photivra/engine/issues/108) WB/custom/AWB | closed | [white-balance.ts](https://github.com/Photivra/engine/blob/main/src/color/white-balance.ts) | Resolved WB → release/production binding; RAW intent and one-time sensor development | [photographic-export.test.ts](https://github.com/Photivra/engine/blob/main/test/photographic-export.test.ts) | #112/#16: preserve matching basis; never re-estimate from rendered output |
| [#111](https://github.com/Photivra/engine/issues/111) Production plan | closed | [image-formation-plan.ts](https://github.com/Photivra/engine/blob/main/src/composition/image-formation-plan.ts) | Authoritative graph expansion; physical sample/temporal results and blockers | [production-image-formation-plan.test.ts](https://github.com/Photivra/engine/blob/main/test/production-image-formation-plan.test.ts) | #178/#16/#112: intentionally add downstream stages with contract/version review |
| [#112](https://github.com/Photivra/engine/issues/112) Processed camera output | closed | [capture-corrected-sdr.ts](https://github.com/Photivra/engine/blob/main/src/output/capture-corrected-sdr.ts) | Capture-bound color/correction → oriented view/SDR; paired RAW consumer | [photographic-export-correction.test.ts](https://github.com/Photivra/engine/blob/main/test/photographic-export-correction.test.ts) | Shared processed RAW/preview/JPEG merged in #200; executed upstream route in plan 0.7.0; final tier/conformance acceptance is merged |
| [#113](https://github.com/Photivra/engine/issues/113) Lens PSF/bokeh | closed | [lens-psf-profile.ts](https://github.com/Photivra/engine/blob/main/src/optics/lens-psf-profile.ts) | Declared sampled PSF/MTF; separate complex-pupil model | [lens-psf-framework.test.ts](https://github.com/Photivra/engine/blob/main/test/lens-psf-framework.test.ts) | #16/#178: wavelength/field/depth sampling and finite support; MTF-only is not renderable PSF |
| [#114](https://github.com/Photivra/engine/issues/114) Stray light | closed | [stray-light.ts](https://github.com/Photivra/engine/blob/main/src/optics/stray-light.ts) | Separate declared ghost/veiling irradiance foundation | [stray-light.test.ts](https://github.com/Photivra/engine/blob/main/test/stray-light.test.ts) | #16/#178: add only explicitly selected incremental light; never fold into primary PSF |
| [#116](https://github.com/Photivra/engine/issues/116) Generic tiers | closed | [generic-tier-presets.ts](https://github.com/Photivra/engine/blob/main/src/equipment/generic-tier-presets.ts) | Exact-version selection; body and lens profile resolution | [generic-tier-presets.test.ts](https://github.com/Photivra/engine/blob/main/test/generic-tier-presets.test.ts) | [Merged catalog acceptance disposition](TIER_PRESET_ACCEPTANCE.md); nine-pair production/output and 27 exact pupil scenes; #119 broader validation is merged; no calibrated ranking |
| [#117](https://github.com/Photivra/engine/issues/117) Lens corrections | closed | [lens-corrections.ts](https://github.com/Photivra/engine/blob/main/src/output/lens-corrections.ts) | Capture-bound selected correction; RAW informational intent/JPEG processing | [generic-tier-correction-acceptance.test.ts](https://github.com/Photivra/engine/blob/main/test/generic-tier-correction-acceptance.test.ts) | #112/#16: connect authoritative upstream capture while preserving residual/crop/noise costs |
| [#118](https://github.com/Photivra/engine/issues/118) Composed geometry/resampling | closed | [geometric-transforms.ts](https://github.com/Photivra/engine/blob/main/src/output/geometric-transforms.ts) | Domain-compatible joint mapping/sampling → bounded correction executor | [geometric-transforms.test.ts](https://github.com/Photivra/engine/blob/main/test/geometric-transforms.test.ts) | #112/#16: preserve full Jacobian/filter/support and existing domain order |
| [#119](https://github.com/Photivra/engine/issues/119) Tier acceptance | closed | [generic-tier-assets.ts](https://github.com/Photivra/engine/blob/main/src/equipment/generic-tier-assets.ts) | Matched synthetic body/correction/readout-to-file fixture consumers | [generic-tier-output-acceptance.test.ts](https://github.com/Photivra/engine/blob/main/test/generic-tier-output-acceptance.test.ts) | [Merged final tier acceptance](TIER_ACCEPTANCE.md): versioned physical/cost/corrected report, multidimensional finite pupils and matched body execution; existing paired-output evidence reused |
| [#130](https://github.com/Photivra/engine/issues/130) Canonical fixture | closed | [basic-reference-fixture.ts](https://github.com/Photivra/engine/blob/main/test/helpers/basic-reference-fixture.ts) | Shared deterministic laboratory and minimal declared variants | [basic-reference-scene.test.ts](https://github.com/Photivra/engine/blob/main/test/basic-reference-scene.test.ts) | #131: reuse without treating tiny/synthetic raster as performance or calibration evidence |
| [#131](https://github.com/Photivra/engine/issues/131) Final conformance | closed | [raw-output-conformance.test.ts](https://github.com/Photivra/engine/blob/main/test/raw-output-conformance.test.ts) | Final meter/capture/production/output path plus incremental geometry/signal suites | [cross-stage-conformance.test.ts](https://github.com/Photivra/engine/blob/main/test/cross-stage-conformance.test.ts) | [Reviewed/merged final conformance](SCIENTIFIC_CONFORMANCE.md), PR #206; 32/32 feature/science complete |
| [#132](https://github.com/Photivra/engine/issues/132) Numerics/units | closed | [validation.ts](https://github.com/Photivra/engine/blob/main/src/core/validation.ts) | Typed input/result guards plus shared units/finite conventions | [numerical-correctness-contract.test.ts](https://github.com/Photivra/engine/blob/main/test/numerical-correctness-contract.test.ts) | Apply throughout new composition; existing guards do not establish physical validity |
| [#133](https://github.com/Photivra/engine/issues/133) API conventions | closed | [API_STYLE.md](../docs/API_STYLE.md) | Root public naming/compatibility/version policy | [api-style-compatibility.test.ts](https://github.com/Photivra/engine/blob/main/test/api-style-compatibility.test.ts) | Review new public handoffs and relevant independent versions before activation |
| [#134](https://github.com/Photivra/engine/issues/134) Evidence/uncertainty | closed | [scientific-assurance.ts](https://github.com/Photivra/engine/blob/main/src/core/scientific-assurance.ts) | Production assurance composition retains weakest required status and unpropagated uncertainty | [scientific-assurance.test.ts](https://github.com/Photivra/engine/blob/main/test/scientific-assurance.test.ts) | #16/#112: preserve child evidence/status; no invented combined uncertainty |
| [#135](https://github.com/Photivra/engine/issues/135) Front filters | closed | [front-of-lens-filter.ts](https://github.com/Photivra/engine/blob/main/src/optics/front-of-lens-filter.ts) | Capture snapshot → #110 throughput exactly once | [front-of-lens-filter.test.ts](https://github.com/Photivra/engine/blob/main/test/front-of-lens-filter.test.ts) | #16/#178: distinguish lens/filter/sensor response scope to avoid double transmission |

## Authoritative production execution

[`getImageFormationContract()`](https://github.com/Photivra/engine/blob/main/src/core/image-formation.ts) owns the stage
dependencies. Plan 0.7.0 expands that graph and can invoke the existing
[`simulateEnvironmentSensorRawFrame()`](https://github.com/Photivra/engine/blob/main/src/capture/environment-raw-producer.ts)
through `environmentCapture`. It binds exact context/event/scene/provider/optics,
geometry/shutter/rotation/seed/WB identities before provider code executes.
Optional processing consumes only its realized native RAW frame. No second
writer, scientific graph or seed schedule is introduced.

| Stage family | Executed consumer | Independent acceptance |
| --- | --- | --- |
| Source projection, provider, optical throughput and temporal sampling | Generated inverse environment rays, exact local shutter midpoints and supplied synchronous provider through existing optical bridge | `environment-raw-integration.test.ts`, `sensor-environment-query.test.ts`, `scene-eqe-temporal-exposure.test.ts` |
| Wavelength/field PSF | Existing sampled local PSF support per wavelength/destination; omitted PSF is an explicit point-optics model with evidence/limitation | `sensor-psf-quadrature.test.ts`, sampled/omitted PSF plan acceptance |
| Optical stack, CFA/spatial/spectral response | Existing AA/aperture plans, exact destination channel, package-plane response compatibility/range and instantaneous EQE | `spatial-sampling-quadrature.test.ts`, `eqe-local-exposure.test.ts`, `eqe-temporal-exposure.test.ts` |
| Charge, noise, signed readout and ADC | Existing temporal photo/dark, completeness/capacity and native seeded RAW producer | `temporal-photo-raw.test.ts`, `sensor-raw-producer.test.ts`, plan replay acceptance |
| Reconstruction, color/WB, selected correction, orientation/crop and display | Shared processed-RAW executor consumes the exact executed frame; output changes retain native codes and upstream noise | `processed-sensor-raw.test.ts`, `photographic-export-correction.test.ts`, all-orientation/WB/correction plan acceptance |
| Files | Existing paired exporter consumes that same frame; no file IO in the plan | `environment-raw-integration.test.ts`, committed #201 independent LibRaw/XML/TIFF/JPEG records and owner application evidence |
| Renderer/reference consumers | Consumer manifest 0.2.0 exposes the same immutable execution/output results and plan identity | `production-image-formation-plan.test.ts` |

See [production environment capture](PRODUCTION_ENVIRONMENT_CAPTURE.md) for the
complete binding and migration contract. Successful bounded execution can reach
all fourteen requested stages. Missing execution inputs, unsupported required
effects and insufficient renderer capabilities retain explicit blockers. The
sample-only and independently attached-RAW routes keep their conservative
limitations; standalone child flags are not rewritten by the parent composer.

## Scientific boundaries and ownership

The implemented execution envelope remains the existing bounded ideal
continuous-spectrum environment route: opening-reference scene time zero,
complete one-to-one native CFA registration, explicit unity field throughput,
constant-axis motion, optional destination-local sampled PSF and valid response
scope/area/range. The native/reference budget is 4,096 sites and aggregate
provider evaluations are limited to 100,000. Shared output-envelope checks reject
unsupported resampling/coverage before provider calls; pixel-dependent kernel
and correction support remain execution checks.

Executed source queries establish invocation and numerical lineage, not measured
transport, visibility, calibration, convergence, arbitrary world pose or global
field-energy conservation. Renderer implementation remains external under the
existing provider contract. A closed direct foundation does not license the
composer to mark an unsupported optional model active. The table above retains
feature-specific direct consumers and remaining integration ownership. No
broader capability or unsupported scientific combination has been approved for
deferral by this change.

## Defect disposition and final gates

- #178 finding 1: the 32-item primitive/consumer/evidence/ownership map is present;
  the executed bounded environment route now composes the previously blocked
  sensor stages through the authoritative graph. Unsupported requested effects
  remain explicit; stale version diagnostics were fixed in #183.
- Finding 2: the plan invokes the engine-owned environment/optics/PSF/response/
  temporal path into the existing RAW producer, rather than accepting a caller
  exposure result as evidence that source execution ran. Provider truth remains
  separate from executed origin.
- Finding 3: equivalent freeze/canonical JSON/allowlist/public-ID mechanics were
  consolidated in #184/#185/#193. Current production capture bindings and output
  envelope checks reuse the existing owners. Meaningful domain differences are
  documented in [helper reuse review](V1_HELPER_REUSE_REVIEW.md).
- Finding 4: reusable sensor-color development is owned by the internal color
  adapter from #186; WB basis/application and export/container ownership remain
  distinct.
- Finding 5: shared producer/reconstruction bounds and early output compatibility
  are documented/tested in #187 and this executed plan preflight; #201 records
  the supported-size decision without claiming megapixel measurements. See
  [RAW frame envelope](RAW_FRAME_ENVELOPE.md).
- Finding 6: `distribute*` was documented in #183; the compatibility guard remains.

#131 final conformance is reviewed and merged. #180 is this final human/agent/source documentation and 1.0 preparation contribution; final review/DCO, signed merge and final-main CI precede owner-only tag/publication. #165 remains post-V1. The linked source and tests define each supported boundary; a closed issue does not authorize every optional model combination.
