# 2.23.0 release

> **Prepared November 12, 2026; not published.** npm publishing runs only from the owner's `v2.23.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.23.0`, with `ENGINE_API_VERSION = "2.23.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **One engine issue and one research report:** `output.highlightMode: "reconstruct-neighbors"` on the WebGPU display view (#605), and the #604 report on a per-site AHD low-signal correction (closed; no engine change).
- **Why a minor version:**
  - A request that 2.22.0 ran on the CPU (`unsupported-on-backend`) now runs on the GPU when `gpu` is `"auto"` or `"require"`.
  - Some results change as corrections, each listed with its way back in [Default changes](#default-changes).
  - No root export is added or removed (1,981; runtime exports 672). No type changes.

## Scope

This pull request is cut from `4cb24a6` (`v2.22.0`) and carries:

| Change | Issues | Source |
| --- | --- | --- |
| GPU display view: neighbor highlight reconstruction in the Speed kernel and the Quality pixel pass, fast and full; the CPU region order in raster order; capped regions solved per tile; the full method's optimal SOR factor; the size test measures the shipped (minified) WGSL | #605 | `e223-605` (`0804f4d`), its changes since the `release-2.22.0` commit it merged (`f7d38bd`) |
| Research report: per-site estimators of the display view's AHD low-signal bias without a lookup table | #604 | `e223-604` (`2993b7d`) |
| 2.23.0 preparation: version surfaces, the 2.23.0 changelog entry, the 2.22.0 publication record | — | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.23.0. The design and its measurements are in [WEBGPU.md, "Neighbor highlight reconstruction (#605)"](WEBGPU.md#neighbor-highlight-reconstruction-605) and the report in [research/ahd-bias-correction.md](https://github.com/Photivra/photivra/blob/main/docs/research/ahd-bias-correction.md).

## Default changes

1. **The GPU display view renders `highlightMode: "reconstruct-neighbors"` (#605)** instead of falling back to the CPU. The host computes each clipped region's ratios with the reference's code and uploads them; the kernels rebuild the clipped channels in float32 within documented first-order bounds, and a pixel within its bound of the rebuild threshold is recomputed on the host. Way back: `gpu: "off"` (the CPU reference).
2. **The CPU display view takes a clipped region's members in raster order (#605)**, so a region's ratios no longer depend on which pixel reached it first. A region above the search cap (65,536 pixels fast, 262,144 full) is solved per tile of 256 × 256 (fast) or 512 × 512 (full) pixels; 2.22.0 took the part its search found from the first pixel that reached it. No way back (2.22.0's result depended on the render's order).
3. **The full method's SOR uses the optimal relaxation factor of each region's bounding rectangle** (`neighborHighlightOmega`) instead of 1.8, at the same 10⁻⁹ tolerance, in captures and the display view: 3.2–4.9× faster and 35–76× closer to the converged fill on the measured regions. Results change below the old tolerance's error (at most 2 × 10⁻⁷ in a ratio on the measured regions). No way back.

Requests that do not use `highlightMode: "reconstruct-neighbors"` keep their 2.22.0 bytes.

## Integration

- **How #605 was brought in.** `e223-605` was built on the `release-2.22.0` branch, which was squash-merged as `4cb24a6`, so its commits are not ancestors of `main`. Its changes since the `release-2.22.0` commit it last merged (`f7d38bd`) were applied to `4cb24a6` as one commit. `main`'s tree equals the final `release-2.22.0` tree (`21e5ee1`), so the three later 2.22.0 commits are kept unchanged.
- **Conflict:** `test/shard-weights.json` only. `main`'s weights (from #606's eight-shard run) are kept, with #605's two new test files added at their recorded weights.
- **#604 report:** taken as committed on `e223-604`, with the report's outcome line added and US spelling in its prose and the prototype's comments (recorded data and API values unchanged). Its source notes no longer state the random generators' license status (the ScanCode policy flags that wording; the allowlist is unchanged). The prototype lives in `scripts/research/ahd-bias/` and is not in the package.
- **Design-around check:** the GPU path uploads per-pixel ratios that the host computes from the request's own channels; no table keyed by channel signal levels is added. The #604 report recommends no correction, and none is built.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: `NATIVE_RAW_LIMITS`, `prepareDisplayView`, `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; rolldown 1.2.9, minified ESM, gzip level 9). Since 2.23.0 every row bundles the WGSL literals minified, as the published package ships them (owner decision 2026-11-11; `PHOTIVRA_WGSL_MINIFY=0` measures the source text).

| Tree | Fast worker | On demand | All chunks |
| --- | --- | --- | --- |
| 2.22.0, source WGSL (the 2.22.0 record) | 337,413 B | 46,977 B | 384,390 B |
| 2.22.0, shipped WGSL | 333,241 B | 43,456 B | 376,697 B |
| **This pull request** | **333,322 B** (+81) | **45,110 B** (+1,654) | 378,432 B |
| Limits (unchanged) | 337,500 B | 47,000 B | — |

The on-demand row is the GPU Quality host 16,514 B, the CPU Quality kit 18,563 B, the GPU coupled steps with the neighbor code 5,865 B and the opt-in kit 4,168 B. No limit is changed.

## Local gates

On this tree (Apple M5 Pro, Node.js 24.19.0), one run each:

- `npm run check:static` (lint, typecheck, license, license-header, identity and browser-surface gates): passed.
- `npm run build`: passed (32 WGSL literals minified).
- The #605 tests and the size test (`test/capture-bundle.test.ts`, `test/wgsl-minify.test.ts`, `test/neighbor-highlight-sor.test.ts`, `test/on-demand-kits.test.ts` and the #605 emulation files below): passed. The emulation files, one run each (seconds, run together): `display-view-neighbors-gpu` (region order and banding) 141, `-speed` 92, `-quality-1` and `-2` 55 and 64, `-quality-full-1` to `-4` 51, 45, 17 and 11. Every band is inside the a-priori bounds, at most one code apart. `npm run docs:check` and `npm run pack:check`: passed, after one fix (the changelog links the unpacked #604 report by its repository URL). The CI tool tests (`node --test .github/test-ci-tools.mjs .github/test-node-ci-roles.mjs`) and `node .github/node-ci-roles.mjs`: passed.
- **CI capacity (owner decision 2026-11-12: split the slow #605 cases and run more jobs).** On this pull request's CI, #605's emulation tests did not fit the 20-minute job limit. Under coverage the Quality full part took 1,045 s and the Speed cases 515 s, 6 to 11 times their local time. Without coverage the whole-view Quality fast case took 302 s, past its 300 s deadline. Two-part Node legs (up to 1,158 s of tests) and two of eight coverage shards reached the job limit (runs 43154091016 and 43157061067). Changes, with the same tests:
  - The emulation file is split by case: `test/display-view-neighbors-gpu.test.ts` (region order, capped regions, banding), `-speed` (Speed, fast and full), the Quality fast case as two bands of the whole view (`-quality-1`, `-quality-2`) and the Quality full case as four bands of its 40 × 30 part (`-quality-full-1` to `-4`). The check is shared (`test/helpers/display-view-neighbor-gpu-check.ts`, `neighborBands`). Region renders equal the whole view bit for bit (checked in the first file), so the bands check the same pixels. The Quality full part's flag-share check (bit 0 on under 5 % of its 1,200 pixels) is split between its bands (under 26, 21, 8 and 8, together at most 59; measured 24, 19, 7 and 7), because the flagged pixels sit in three columns of its top rows. The Quality fast bands keep 5 % each.
  - The Quality band cases' per-test deadline is `scaledTimeout(900_000)` (300 s before). The other cases keep 300 s.
  - The Node test legs run in three parts (`1/3`, `2/3`, `3/3`, two before) plus `package`; `verify (<line>)` requires all four. Coverage runs as ten shards in `ci.yml` and `publish.yml` (eight in 2.22.0); the coverage gate merges all ten.
  - `test/shard-weights.json` is re-recorded from the CI times of runs 43157061067 (six finished shards) and 43154091016 (seven); the split files take their local time × 10.7 (Quality) or × 6 (the first file), the ratios measured on those runs.
  - No test was removed and no job time limit was raised.
- The full suite, coverage and the SwiftShader WebGPU suite run on this pull request's CI. The WebGPU cases of #605 were run on `e223-605` on SwiftShader and on hardware ([WEBGPU.md](WEBGPU.md#neighbor-highlight-reconstruction-605), "Measured").

## Pending (after release)

- **Phone sample DNGs (#598):** unchanged from 2.22.0; verified against the owner's samples when they arrive.
- **External C2PA validation (#165):** unchanged from 2.22.0.
- **A device-side harmonic fill (#605):** not built (owner decision, 2026-11-11: no a-priori float32 bound); the measurements are kept in docs/WEBGPU.md.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.23.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #605 and the #604 report brought onto `4cb24a6`.
- [x] Version surfaces aligned at 2.23.0 (`npm run release:prepare -- 2.23.0`). Root exports 1,981.
- [x] 2.22.0 recorded as published ([2.22.0 release record](RELEASE_2_22_0.md#publication)).
- [x] The worker rows measured ([Sizes](#sizes)); no limit raised.
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.23.0`.
- [ ] The `v2.23.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.

## For the owner

Decided by the owner and applied here: the ratios are uploaded from the host (no device fill); every size row measures the shipped WGSL; capped regions are solved per tile; the full method uses the optimal SOR factor; #604 closed with the labeled approximation kept. Choices the owner may want to review: the 2.22.0 publication record's times are the registry's and GitHub's (UTC); the #604 report's spelling was changed to US English in this pull request.
