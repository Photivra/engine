# 2.15.0 release

> **Prepared November 7, 2026; not published.** npm publishing runs only from the owner's `v2.15.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.15.0`, with `ENGINE_API_VERSION = "2.15.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - #532 adds 4 root exports.
  - This release relaxes two public limits, from 64 to 400 wavelengths.
  - Nothing is removed or changed incompatibly, and no default changes.
- **Why now:** the app's color chart fails to render with diffraction ("wavelengthsNm must list 1 to 64 wavelengths.", owner report, 2026-11-06). The owner chose to wait for this engine fix rather than mark the combination unavailable in the app. The app's fix and this release ship together.

## Scope

Every pull request merged since `v2.14.1` (`4044ee4`), and this one:

| Change | Pull request |
| --- | --- |
| Docs: fix stale display-view, WebGPU and 2.14.1 release text | #559 |
| The defocus size limit and a pre-check as root exports, `calculateDefocusDiscKernelRadius` | #560 (#532) |
| `lens.diffraction` at every spectral step; 2.15.0 release preparation: version, changelog, this record | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.15.0.

## The diffraction fix

- **Cause.** `lens.diffraction` builds one Airy kernel per spectral node of the sensor quadrature. `sensor.spectralStepNanometers` s gives ⌈400/s⌉ nodes over 380–780 nm. The app's color chart uses 5 nm, which gives 80 nodes. `createDiffractionLimitedPsfProfile` refused more than 64 wavelengths, so every step under 6.25 nm failed with diffraction:
  - on every scene, not only the color chart;
  - in `simulateCapture`, `simulateDisplayView`, `prepareDisplayView` and `simulateIdealReference`.
- **Fix: exact, not approximated.** Both limits are now 400, the node count of the finest allowed step (1 nm). Each node keeps its own kernel at its own wavelength, bit-identical to a one-wavelength profile's.
- **Speed.** The per-node kernel set-up no longer clones and parses the whole profile for every node. Its cost went from O(N²) to O(N), with the same kernels.
- **Measurements and tests.** See [PSF foundation, "Spectral nodes (2.15.0)"](PSF_FOUNDATION.md#spectral-nodes-2150). For the app's case (5 nm, 4000 × 2666, 6 µm, f/16, Apple M5 Pro), diffraction adds about 0.4 s to a 3.9 s capture and 18 MiB of peak heap.

## Same package

The candidate's packed tarball (`npm pack`, 913 files) was compared file by file with the published `@photivra/engine@2.14.1` tarball (912 files).

**Added:** `docs/api/optics-defocus-disc-kernel.md` (#532).

**Changed:**

| Files | Difference |
| --- | --- |
| `dist/optics/defocus-disc-kernel.*`, `dist/facade/simulate-capture.*`, `dist/index.*`, `docs/USAGE.md`, `docs/AGENT_GUIDE.md`, `llms.txt`, `docs/api/facade-simulate-capture.md` | #532's root exports, and the capture's profile cache limit by size (this pull request) |
| `dist/optics/diffraction-psf-profile.*`, `dist/optics/lens-psf-kernels.*`, `dist/optics/site-diffraction-kernel.*`, `docs/api/optics-diffraction-psf-profile.md`, `docs/api/optics-lens-psf-kernels.md` | the diffraction fix: the 400-wavelength limits, the messages, the shared private profile clone and the cell-table cache size |
| `docs/QUICK_START.md` | both changes |
| `SECURITY.md` | the current release, 2.14.1 (#559) |
| `CHANGELOG.md`, `README.md`, `CITATION.cff` | the 2.15.0 entry and version |
| `package.json`, `dist/core/version.*`, `docs/API_REFERENCE.md`, `docs/api/core-version.md`, `docs/api/exports.json` | the version and the new exports |

**Compatibility:**
- Root exports go from 1,801 to 1,805; runtime exports from 611 to 613.
- `git diff v2.14.1 -- src/gpu` is empty, so no hardware gate applies. The display view's GPU Quality kernels are checked at 80 spectral nodes in float32 emulation (`test/diffraction-spectral-grid.test.ts`).

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.15.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #559 and #560 merged.
- [x] Version surfaces aligned at 2.15.0 (`npm run release:prepare -- 2.15.0`). Root exports 1,805.
- [x] Packed tarball compared with the published 2.14.1 (above).
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.15.0`.
- [ ] The `v2.15.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
