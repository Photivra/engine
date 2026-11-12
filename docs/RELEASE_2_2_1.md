# 2.2.1 release candidate

> **Published October 18, 2026.** The owner tagged `v2.2.1` on `2a5825c` and published the GitHub release; npm publishing ran from the tag. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.2.1`, with `ENGINE_API_VERSION = "2.2.1"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a patch version:** one fix and one corrected explanation text. No input, output field or export is added or removed (1,680 root symbols), and no input that 2.2.0 accepted is rejected. Every capture that 2.2.0 completed gives the same RAW codes, image bytes, kernels and assumption values.
- **Why now:** the Photivra app's Quality preset turns on `lens.diffraction`, and with it `simulateCapture` threw for 32 of the app's 82 sensor-format, resolution and f-number combinations at f/8 and f/16.
- **What this release does not claim:** calibrated accuracy for any real camera, lens or sensor. The diffraction model is unchanged: ideal, scalar and aberration-free.

## Scope

| Change | Kind |
| --- | --- |
| `resolveLensPsfConvolutionKernels` maps each tap exactly when the kernel and site pitches are the same number, so `lens.diffraction` works at every pixel pitch | Fix (byte-identical where 2.2.0 succeeded) |
| The `lens.diffraction` assumption explanation says when the default window is capped at 32 sites; the quick start documents the cap and its tail energy | Corrected text |
| Version 2.2.1, changelog and this record | Release preparation |

## Fixed: diffraction failed at many pixel pitches

**Problem.** With `lens.diffraction`, `simulateCapture` threw `INVALID_CONFIGURATION` "Diffraction kernels must sample the site pitch exactly." or "The kernel radius is too small for the PSF support; no tap is dropped." for many real pixel pitches, for example 3.808864265927978 µm (44 mm / 11 552 px), 1.6 µm and 1.4 µm. Over the app's 109 distinct pitches at f/4, 5.6, 8, 11 and 16, 2.2.0 failed 182 of 545 combinations (19, 24, 41, 42 and 56 per f-number).

**Cause.** The facade builds the Airy kernels on the site pitch p and converts them to site kernels with `resolveLensPsfConvolutionKernels`, which places tap n at the site displacement (n·p)/p. That rounded quotient is not always n: 3 × 1.6 / 1.6 gives 3.0000000000000004, and 3.808864265927978 µm misses for n = 5, 7, 10, 14, 20 and 28. Just below n, the tap was split bilinearly over two sites, so the kernel was no longer exactly site-sampled and the facade's object-space convolution refused it (first message). Just above n, a weight of about 10⁻¹⁶ landed one site past the outer ring, so the support needed radius R + 1 (second message). The facade's radius was never smaller than the real PSF support. It is the same class of error as the aperture-fit rounding fixed in 2.2.0 (#336): two float paths to the same exact value.

**Fix.** When the kernel's sample pitch and the site pitch are the same number, the displacement is the tap offset itself, kx − cx and −(ky − cy), with no division. Unequal pitches keep the existing formula and its labelled bilinear approximation. No tolerance is introduced and nothing else changes.

**Truncation at the 32-site cap.** The default window reaches the third dark ring at the longest spectral node, capped at 32 sites (the convolution limit). Small pixels at large f-numbers reach the cap first, so more of the Airy tail lies outside the window and is put back by the existing unit-sum renormalization: 7 % at 1 µm and f/16, 15 % at 0.5 µm and f/16 (2–6 % below the cap). The tail energy was already listed per wavelength; the explanation used to claim the third dark ring even when capped. It now says, for example, "capped at 32 sites; the third dark ring at the longest node needs 81". No energy is dropped silently.

## Evidence

- **App sweep, published 2.2.0 against this candidate** (scripts run on the built packages): the app's 41 format and resolution pairs at f/8 and f/16, 16 × 16 slanted edge: 2.2.0 fails 32 of 82, 2.2.1 fails none. The 109 pitches × f/4–f/16 plus 200 seeded pitches in 0.5–100 µm (one f-number each), aborted after the first RAW tile: 2.2.0 fails 182 of 745, 2.2.1 fails none.
- **Byte identity where 2.2.0 succeeded:** 27 pitches from 0.5 to 100 µm (including 6 µm and several former failures) × f/4, 5.6, 8, 11 and 16, 24 × 24 Siemens star with a 50 nm spectral step, full captures. 2.2.0 completes 86 of the 135. For all 86, RAW codes, image samples and the diffraction profile are identical. 80 have identical assumptions. The other 6 differ only in the explanation text of a capped window (0.5 µm at f/8–f/16, 0.75 µm at f/11–f/16, 1 µm at f/16). The 49 that 2.2.0 rejected now complete. This follows from the fix: a facade capture could only succeed in 2.2.0 if every quotient (n·p)/p was exactly n, and then the new mapping gives the same numbers.
- **`test/simulate-capture-diffraction-pitch.test.ts`** (new). It covers the 107 pitches of `test/simulate-capture-pitch.test.ts` plus the app's 41 current pairs, among them the 40 MP rasters 7740 × 5160 and 7296 × 5472 (109 distinct pitches), and 200 seeded pitches in 0.5–100 µm, at f/4, 5.6, 8, 11 and 16. It checks that every tap of the resolved PSF lands, unsplit, on its own site with exact site sampling, over a sweep where (n·p)/p ≠ n for 413 taps. It runs the facade at every app pitch and f-number (and each seeded pitch at one f-number), aborting after the first RAW tile. It completes a capped capture (0.686 µm, f/16) and checks the tail energy and the explanation. Its three behavioural tests fail on 2.2.0's source.
- **Unchanged locks:** the 2.0.0 hash lock in `test/simulate-capture-optics.test.ts` (six default-pitch captures, every output byte), the `simulateCapture` digest baseline in `test/simulate-capture-integration.test.ts`, the diffraction, anti-aliasing and object-space equivalence tests (1e-12 per site against the per-tap quadrature), `test/simulate-capture-pitch.test.ts` and `test/lens-psf-kernels.test.ts` all pass unchanged. The lock writes the DNG Software tag ("Photivra 2.2.1", same length) back to the 2.0.0 name, so the version bump needs no test change.

## Compatibility

- **Now accepted:** `lens.diffraction` at pixel pitches that 2.2.0 rejected by a rounding error.
- **Unchanged:** every capture that 2.2.0 completed: RAW, images, encoded files, kernels and assumption values. The default 6 µm captures and all hash locks are byte-identical.
- **Changed text:** the `lens.diffraction` assumption's explanation, only when the default window is capped at 32 sites (pixels of about 1 µm or smaller at large f-numbers).
- **Direct callers:** `resolveLensPsfConvolutionKernels` with equal kernel and site pitches now reports `exactSiteSampling: true` and one tap per site where 2.2.0 split a tap by about 10⁻¹⁶, or rejected an explicit radius. Unequal pitches are unchanged.

## Rights and licensing

No third-party code, data or constants added. No dependency change: `package.json` and `package-lock.json` change only in their version fields.

## Privacy and security

No network, persistence or telemetry is added. The fix changes arithmetic only. Inputs are validated as before, and no limit is raised.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this update. Tag it only when its CI is green.

- Local results on this candidate (Node 24.21.0, Linux): the focused Vitest suites above with `--maxWorkers=1`, `npm run check:static`, `npm run docs:check`, `npm run build` and `npm run pack:check` passed. The full `npm run check` and `npm run coverage` run in CI.

## Remaining release checklist

- [x] Fix with changelog entry; version surfaces aligned at 2.2.1 (`npm run release:prepare -- 2.2.1`); API reference regenerated.
- [x] Owner's review of this record.
- [x] Green CI on this update's pull request (#340), then on `main` after merge ([CI run 858](https://github.com/Photivra/engine/actions/runs/39086135717) on `2a5825c`).
- [x] **The owner's explicit approval to tag `v2.2.1`.** The owner tagged `v2.2.1` on `2a5825c`; `v2.2.0` is unchanged.
- [x] Owner steps after approval: the owner pushed the `v2.2.1` tag, the Publish npm workflow ran from it, and the owner created the GitHub release "@photivra/engine 2.2.1" from the tag.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.2.1` → `2a5825c3cc954f80e15251169ed8a1bc2fead8a5` (#340) |
| Publish workflow | [Publish npm run 18](https://github.com/Photivra/engine/actions/runs/39087857249), passed; the provenance was signed at 01:58 UTC and the registry records publication at 02:00 UTC |
| npm | `@photivra/engine@2.2.1`, dist-tag `latest` |
| Integrity | `sha512-EfO4Mwn1mZDaoKEkwLZ5Z72PsdjWOaGEj3Rwr/KkZwhzlzYhQc9QVgLyoeG+uxrIxJ7qDCJjwvl0nf3L6JASDQ==` (shasum `efcffbca08b2788b32031f0c91dc1f717ab7b4e2`) |
| Provenance | Signed SLSA provenance for `2a5825c` from `.github/workflows/publish.yml` at `refs/tags/v2.2.1`, published to the Sigstore transparency log (log index 3304263933) |
| Tarball contents | Byte-identical (same shasum and integrity, 824 files) to `npm pack` of a clean local build of `v2.2.1` (checked October 18, 2026) |
| GitHub release | [@photivra/engine 2.2.1](https://github.com/Photivra/engine/releases/tag/v2.2.1) |
