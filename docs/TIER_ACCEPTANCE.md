# Generic tier acceptance suite

Release context (dated historical note): written for the **package 1.2.0 candidate / root API 1.2.0** and not re-reviewed for later releases; see the [changelog](../CHANGELOG.md) for the current release. Subsystem/model versions and dated introduction or measurement records below are independent historical identities; they are not distribution versions. See [developer navigation](DEVELOPERS.md) and [release contract](RELEASE_1_2_0.md).

Fixture/report version **1.0.0** records the reviewed/merged #119 acceptance disposition
for the exact Consumer, Prosumer and Professional preset assets **1.0.0**. This is
Photivra-owned synthetic regression evidence with unquantified physical uncertainty,
not measured equipment calibration, a perceptual bokeh score or a universal ranking.
PR #204 merged after substantive owner review/DCO; final science conformance merged in PR #206.

## Reproduce and review

Run `node scripts/generate-tier-acceptance-report.mjs` after `npm ci` to regenerate
[the committed report](validation/tier-acceptance-report-v1.json). An optional
output path writes a separate comparison report. The generator uses a temporary
TypeScript build, removes it afterwards, and has no published package surface.
It does not change runtime profiles or dependency/version contracts.

Run `npx vitest run test/generic-tier-report-acceptance.test.ts` for the report gates.
The normative [versioned envelopes](https://github.com/Photivra/engine/blob/main/test/fixtures/tier-acceptance-envelopes-v1.json)
are finite regression limits, not physical error bars. Report JSON rounds displayed
numbers to twelve significant digits; CI uses full-precision calculations and
numeric tolerances. The report is a review artifact rather than a brittle exact
image golden. Stable scene ID `photivra:tier-matched-reference-v1`, #130 optical
state/exposure/seed, exact selected profile versions and complete catalog SHA-256
bind the evidence. Saved selections retain their existing strict drift guard.

## Three distinct report domains

**Physical** records the nine exact 550 nm field/defocus pupil responses per lens,
corner representative-channel CA, illumination falloff, breathing scale, in-frame
and off-frame ghost/veil, and sampled physical edge values. Pupil diagnostics retain
unit shape energy, separate relative throughput, peak/outer-sample fractions,
centroid, full 2D covariance and horizontal/vertical/diagonal sampled texture response.
The outer fraction is the boundary of the finite kernel, not a measured optical
ring. Since engine 2.0.0 the 5×5 declared pupils are zero padded to 2S−1 samples
per axis for an S-sample support (9×9 for the full disk), so the kernel is
alias-free and peak/outer fractions are per finer sample; the envelopes were
re-baselined for that change. The 100 cycles/mm texture response is discrete OTF magnitude of those taps,
not calibrated or continuous MTF. Existing #203 direct phase-sum tests independently
validate every tap and execute controlled textured/highlight scenes for all 27 slices.

**Correction costs** records full-Jacobian determinant, principal stretches and
output magnification (reciprocal of the smallest destination-to-source stretch),
corner gain and gain-only variance ratio, missing-source joint crop, retained ray
bounds and separately captured pixel-edge FOV. Variance ratio is gain squared
before clipping; it does not include covariance created by interpolation or imply
that photons/SNR were restored. The shifted crop retains 7×9 of 9×9 requested
samples, exposing the cost of unavailable support instead of padding it.

**Corrected** records residual displacement/representative-channel CA, center and
corner edge rows, clipping events and the unchanged capture/noise identities. The
physical sampled target uses the existing inverse combined radial/CA map and
illumination model at each source site, then adds one fixed alternating noise
array tied to #130's seed. Correction Off/On forks that same frozen capture.
Independent bilinear weights and polynomial gain predict all corrected green
samples; existing #179 tests independently check every channel, Jacobian and
residual using a scalar inverse oracle. The 9×9, 3 mm-pitch correction canvas is
an explicitly specialized executor target; it does not redefine #130's sensor
geometry or establish camera pixel resolution/optical MTF.

Pupil clipping, normalized PSF redistribution, illumination attenuation, stray
light and digital gain keep distinct ownership. These reports do not assert a
new simultaneous radiometric composition of every lens effect. The supported
narrow-band environment-to-RAW/output route and all nine pairings remain tested
by #203; its explicit PSF omission and unity field throughput remain visible.

## Intended relationships and honest unsupported metrics

The versioned limits enforce all three tiers' finite multidimensional responses,
sub-0.03 mm residual displacement, sub-0.06 mm residual CA, positive determinant,
bounded magnification and retained crop. These are sampled regression envelopes,
not a global continuous-field accuracy guarantee.

Professional retains less corner clipping/stray light and smaller radial/CA
coefficients, while its f/4 corner illumination and gain-only variance are worse
than Prosumer. Its near/far pupil responses differ, and its near-defocus sampled
texture response is lower than Prosumer's in this particular reference. Higher
tier therefore does not require more digital correction or superiority in every
metric. No aggregate sharpness/bokeh/quality score is computed.

LoCA/spectral fringing, onion-ring structure, measured MTF, arbitrary field/focus/
defocus interpolation and real-camera calibration are not represented by the
initial assets. The suite names these unsupported metrics explicitly rather than
fabricating numerical envelopes. Field and defocus comparisons use only their
exact declared slices. No third-party calibration or branded behavior is added.

## Body execution and ordinary flash

New signed pitch/yaw/roll tests independently predict each tier's delayed linear
response, pre-latency behavior, correction clamp and residual for ordinary and
large disturbances of both signs. The supplied 1 ms latency, gain and angle limits
own the differences. Panning bypass, translation, digital stabilization and
support policy are not enabled by these exact assets; no substitute stop rating
or device performance is inferred.

An owned 2 ms mechanical opening/closing scan is explicitly registered under the
exact mode/timing IDs required by each tier's flash capability. The tier's global
DATA readout declarations remain independent. Front/rear placement follows the
whole-frame exposure interval, never 30/15/8 ms data-readout duration. A declared
2 ms triangular pulse integrates to 1 ms of relative-modulation time through the
ordinary temporal source overlay and each local exposure window. No source power,
material/visibility, TTL, HSS, recycle, or sensor signal is inferred from that integral.
Too-short exposure, oversized pulse, HSS and stale timing identity reject.

Existing #181 tests retain matched AF availability/hold/loss/release gates,
drive cadence/timer limits, independent meter/AWB arithmetic and readout semantics.
Existing #182/#203 evidence covers exact ISO/readout, all orientations, rendering
exposure with unchanged native RAW and deterministic paired export. It is reused,
not replaced by a second production path.

## Browser/reference and acceptance disposition

These tier assets have no separate browser approximation or private-app calibration
backend. The browser-safe public functions are the ordinary reference path; #203
checks that interactive/reference manifests share the same immutable executed
results and fingerprints. No unimplemented preview is assigned an invented error
bound. Any future approximation must add its own same-input fidelity comparisons.

| #119 criterion | Evidence |
| --- | --- |
| All three tiers, deterministic versioned fixtures | Scene/envelope/report 1.0.0; exact selection references, catalog hash, replay |
| Matched optical specifications | Stable #130 50 mm/f/4/5 m state; explicit 550 nm pupil slices and specialized targets |
| Multidimensional bokeh | All 27 energy/throughput/centroid/covariance/outer/texture diagnostics plus #203 phase-sum and sampled scenes |
| Physical/correction/final outputs separate | Three report domains, same frozen edge/noise state; #179 residual/Jacobian/support oracle |
| Correction not monotonic by tier | Magnification/gain costs and explicit Prosumer/Professional tradeoff assertions |
| Testable tradeoffs | Near/far asymmetry, axis/field response and contrary Professional/Prosumer metrics |
| Profile drift visible | Complete catalog SHA-256, exact references, versioned envelopes and strict saved-selection parser |
| Identical correction A/B state | Frozen source and fixed noise; independently predicted interpolation/gain; no remetering/re-noising |
| Applicable browser fidelity | Same root implementation; shared immutable consumer results; no distinct approximation exists |

This historical acceptance contribution changed no runtime/API/schema/asset/package/POC versions. Final performance #43/#45 and conformance #131 are now merged; #180 prepares the distribution without changing independent model IDs. No new V1 deferral is approved.
