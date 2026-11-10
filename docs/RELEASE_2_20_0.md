# 2.20.0 release

> **Prepared November 9, 2026; not published.** npm publishing runs only from the owner's `v2.20.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.20.0`, with `ENGINE_API_VERSION = "2.20.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - 30 new root exports (1,860 → 1,890; runtime exports 631 → 637), including the registry `SIMULATE_CAPTURE_FAST_METHODS` and its type.
  - New options (`sensor` characteristics, `output.dng.lensCorrectionOpcodes`), new report fields (`result.sensor`, `diagnostics.fast.defaultedFrom`) and `SimulateCaptureDngPart.fast`.
  - Several defaults change, each with a one-option way back ([Default changes](#default-changes)): `fast` follows the output format, `prepareDisplayView`'s `gpu` follows `fast`, JPEG is saved at quantization step 1, and catalogue lenses with `lens.defocus` render their own bokeh. Nothing is removed.
- **Why now:** the eight 2.20.0 part branches (ten issues) are done, and the owner decided one speed-versus-accuracy scheme for the release; one integration, one pull request, one release.

## Scope

This pull request integrates eight part branches, each cut from `9c81348` (`v2.19.0`) and merged `--no-ff` in this order:

| Change | Issue | Part branch |
| --- | --- | --- |
| CI: the Node matrix checked against the support policy; a runner-minute baseline | #231 | `e220-h-231` (`d62c16b`) |
| `calculateApertureDiameter`; `calculateCropToMatchFocalLength` | #577, #579 | `e220-b-577-579` (`c0ce650`) |
| `calculateDetailLimit`: which limits detail, the lens or the sensor | #575 | `e220-c-575` (`ad469f2`) |
| `calculatePrintSizeLimitWithBlurAndNoise` | #574 | `e220-d-574` (`1828e9a`) |
| The lens profile's vignetting area factor; lens corrections as optional DNG opcodes | #584, #587 | `e220-e-584-587` (`2cd47e9`) |
| Chart-boundary ties in the in-focus diffraction PSF quadrature | #565 | `e220-g-565` (`ec2378e`) |
| Each catalogue lens's own bokeh with `lens.defocus` | #567 | `e220-f-567` (`62ae7bb`) |
| Sensor characteristics and the mid-gray noise figure | #555, #535 | `e220-a-555-535` (`cf94f2a`) |
| Integration: the speed-versus-accuracy scheme and its registry, #535 in #574, the CI primary-leg pin, the #544 sign-offs, 2.20.0 preparation | all | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.20.0.

## Default changes

See the CHANGELOG's "Default changes (migration)" table. In short: `fast: false` restores 2.19.0's exact methods (and with it `gpu: "off"` on prepared views and the cat's eye on catalogue bokeh); `jpegQuantizationStep: 2` restores 2.19.0's JPEG bytes. The tests that pin pre-2.20.0 bytes pass those settings and still pass byte for byte.

## Integration of the parts

- **Conflicts:** only `CHANGELOG.md` (each part's block kept), `docs/USAGE.md` (B and C both appended a last section; both kept, in merge order) and `test/root-export-input-errors.test.ts` (both strict-input lists kept). `src/facade/simulate-capture.ts`, which A, E, F and G all changed, merged without conflict; the merged tree passed every part's tests before the scheme was applied. C's export block stays at the end of `src/index.ts`.
- **The scheme** (owner decisions, docs/API_STYLE.md "Exact and fast modes"): one resolver (`src/facade/fast-resolution.ts`: record `fast` > top-level `fast` > format default), one registry (`src/facade/fast-methods.ts`, not in any capture bundle) and one enforcing test (`test/fast-methods-registry.test.ts`). G's `rollingShutterLatticeTaps` and F's `catsEye` (both unreleased) became `lens.diffraction`'s and `lens.catalogue`'s fast methods and lost their option names; PNG now counts as an export for both, as the owner ruled.
- **Display view H1–H3:** the catalogue PSF zones, the AHD low-signal correction (2048 draws, threshold 0.01) and the quarter sampling of uniform pixels stay the view's default and are now reported as its fast methods; `fast: false` selects one PSF zone per site, 8192 draws with threshold 0, and full sampling. Measured (Apple M5 Pro, Node.js 24.19.0, one run, shared machine): a 12 × 8 AHD view of a 96 × 64 Siemens star took 56 ms fast and 235.8 s exact, because the exact correction corrects every pixel (96 against 0) and each state takes four times the draws.
- **A (#535):** the noise figure is computed only on exact requests (`fast: false`, the exports' default); its ADC rounding term is kept. The stale comment about the removed `isoAreaScaledReadout` now points at `characterizeReadout`.
- **D (#574):** `noise: { kind: "capture-noise-figure", midGrey }` takes a capture's figure through `resolvePixelSnr`.
- **H (#231):** the primary leg is pinned to Node 24; `lts/-1`, which resolves to the primary's release, skips its test work (its required `verify (lts/-1)` check still runs); the required `verify (lts/*)` check keeps its name (a rename would need a ruleset change).

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: every chunk of `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM, gzip level 9):

| Tree | Total gzip |
| --- | --- |
| 2.19.0 (`9c81348`) | 351,775 B |
| A (#555, #535) alone | 353,932 B (+2,157 B) |
| B, C, D, H alone | 351,775 B (no change in the worker) |
| E (#584, #587) alone | 352,972 B (+1,197 B) |
| F (#567) alone | 352,370 B (+595 B) |
| G (#565) alone | 351,972 B (+197 B) |
| All eight parts merged | 355,892 B |
| With the speed-versus-accuracy scheme | 356,409 B (+517 B) |
| **This pull request** (after sharing `approximatelyEqual`, −64 B) | **356,345 B** (entry 276,527 B; catalogue chunk 12,906 B; GPU session chunk 54,706 B) |
| Limit | 352,000 B (**not raised: 4,345 B over**; owner decision pending) |

**Savings tried.** Identical functions in the minified chunks add up to about 1 KB of text (the largest, a raster-rectangle check in two sensor modules, 278 B); textually identical private helpers in the source (one GPU abort check left); and far-apart repeated text (about 23 KB of 64-character runs more than 32 KiB apart, mostly record-literal field lists in the sensor and equipment parsers, which would need deeper refactoring of those parsers). One shared `approximatelyEqual` replaced six private copies (−64 B). Moving code into lazy chunks does not help, because the test counts every chunk. The parts' and the scheme's own code (#555's characteristics and report, #587's opcode writer and fit, the scheme's resolution and report) is new function, not duplication.

The display view's addition to a capture bundle: 46,008 B minified and 18,118 B gzip (2.19.0: 45,823 B and 18,153 B; budgets 46,500 B and 18,550 B, unchanged).

## Local gates

On the integrated tree before the last documentation and registry-export commit, Apple M5 Pro, one run each through the shared lock:

- `npm run check:static` (lint, typecheck, licence, licence-header, identity and browser-surface gates): passed. `npm run check:licenses`: "Dependency license policy passed: Apache-2.0=15, BlueOak-1.0.0=1, BSD-2-Clause=6, BSD-3-Clause=2, ISC=7, MIT=125, MPL-2.0=12". `package-lock.json` differs from 2.19.0's only in the version fields: no new or changed licence.
- `npm run coverage` on Node.js 24.19.0: 367 files passed (1 skipped), 4,265 tests passed (2 skipped), **1 failed: the capture-worker limit** (356,345 B against 352,000 B); 5.6 min. The coverage report is not written when a test fails, so the thresholds were not evaluated in this run. `test/shard-weights.json` re-recorded from this run (`scripts/record-shard-weights.mjs`); the 2.19.0 publish run's first coverage shard took 19.8 of its 20 minutes.
- The full suite on Node.js 26.13.0: the same result (367 passed, 1 skipped, the same 1 failure); 2.5 min.
- `npm run build` and `npm run release:consumer-check`: passed. `npm run docs:check` and `npm run pack:check` failed on this record's absence, the registry module's reachability and two relative links; all three are fixed in the last commit and both checks pass (re-run alone).
- CI tooling: `node --test` of `.github/test-node-ci-roles.mjs` (11), `test-node-lts-policy.mjs` (21) and `test-ci-tools.mjs` (5): passed; `node .github/node-ci-roles.mjs`: "The CI Node matrix matches the reviewed support policy" (lts/-1 skips; one notice: Node 22 tested only at its exact minimum).

## For the owner

- **Capture-worker limit: 4,345 B over** (356,345 B against 352,000 B). Raising the limit is the owner's decision; the alternatives are a deeper refactor of the parsers' repeated record-literal checks (uncertain yield) or moving features out of the app's worker imports.
- **The display view's exact AHD correction is very slow** (8192 draws and threshold 0: 235.8 s against 56 ms for a 12 × 8 view of a 96 × 64 star). It runs only with `fast: false` on a view. Recommendation: keep the 0.01 threshold in the exact method and take only the extra draws, unless the owner wants the correction on every pixel.
- **The required check `verify (lts/*)` keeps its name** although the primary leg is now pinned to Node 24; renaming it to `verify (24)` needs a ruleset change by the owner. Recommendation: keep the name.
- **#587 DNG spec references** (chapter "Opcode List Processing", OpcodeList3 tag 51022, opcode IDs 1 and 3, the DNG 1.3.0.0 version field) could not be re-read against the 1.7.1.0 PDF here (Adobe's server refused automated fetches); the owner's visual check of the sample DNG is still pending.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.20.0` (AGENTS.md rule 3), after the owner's visual check of the #587 sample DNG.

## Remaining release checklist

- [x] The eight part branches merged into this pull request.
- [x] Version surfaces aligned at 2.20.0 (`npm run release:prepare -- 2.20.0`). Root exports 1,890.
- [x] 2.19.0 recorded as published ([2.19.0 release record](RELEASE_2_19_0.md#publication)).
- [x] No `src/gpu` change: no WebGPU hardware gate.
- [ ] The capture-worker size limit settled (see [Sizes](#sizes)).
- [ ] The owner's visual check of the #587 sample DNG.
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.20.0`.
- [ ] The `v2.20.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
