# 2.18.0 release

> **Prepared November 9, 2026; not published.** npm publishing runs only from the owner's `v2.18.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.18.0`, with `ENGINE_API_VERSION = "2.18.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:**
  - 13 new root exports (1,837 → 1,850; runtime exports 623 → 626).
  - New opt-in options. Requests that 2.17.0 refused now render: the display view with `lens.catalogue`, a subject at exactly twice the focal length, and *PV 800 9*.
  - Nothing is removed or changed incompatibly, and no default changes.
- **Why now:** the owner chose to publish these four parts as 2.18.0 (owner, 2026-11-09). #570, #571 and #566 move to 2.19.0.

## Scope

No pull request has merged since `v2.17.0` (`8bbe20c`). This pull request integrates four part branches, each cut from `8bbe20c` and merged `--no-ff` in this order:

| Change | Issue | Part branch |
| --- | --- | --- |
| `calculateSensorEquivalence`, `calculateBlurShareOfFrame` (pure functions, not in the capture path) | #573 | `e218-573` (`45642f9`) |
| `lens.ideal: { focalLengthMm }` and `IDEAL_LENS_LIMITS`; one frame-size helper and one f-number check for `lens.prime` and `lens.catalogue` | #576 | `e218-576` (`a5e7fd0`) |
| The display view renders catalogue lenses (PSF per field zone); the 2f subject-distance fix; the *PV 800 9* exposure-anchor fix | #569 | `e218-569` (`8d84d4b`) |
| A fast method for `lens.catalogue` (field-grid PSF, tabulated expected signal), loaded with the catalogue chunk | #568 | `e218-568` (`fadfc41`) |
| Integration; `lens.ideal.widestFNumber` / `narrowestFNumber` (owner's addition); the raised capture-worker limit (owner-approved); 2.18.0 release preparation | all four | this pull request |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.18.0.

## API

New root exports (13):

| Exports | Kind | Issue |
| --- | --- | --- |
| `calculateSensorEquivalence`, `calculateBlurShareOfFrame` | runtime | #573 |
| `CalculateSensorEquivalenceInput`, `SensorEquivalence`, `SensorEquivalenceFieldOfView`, `SensorEquivalenceQuantity`, `EquivalenceExactness`, `EquivalenceValueBasis`, `CalculateBlurShareOfFrameInput`, `BlurShareOfFrame`, `BlurShareOfPrint` | type | #573 |
| `IDEAL_LENS_LIMITS` | runtime | #576 |
| `SimulateCaptureLensCatalogueRecord` | type | #568 |

11 + 1 + 1 = 13, and 1,837 + 13 = 1,850, the count the regenerated reference reports ("1850 root symbols across 198 modules"; `docs/api/exports.json`: 626 runtime, 1,224 type).

Changed contracts, all additive:

- `SimulateCaptureOptions.lens` gains `ideal: { focalLengthMm, widestFNumber?, narrowestFNumber? }` (#576; the range is the owner's addition); `lens.catalogue` also takes `{ kind, fast }` and `SIMULATE_CAPTURE_FAST_OPTIONS` gains `lens.catalogue` (#568).
- `simulateDisplayView` and `prepareDisplayView` accept `lens.catalogue`, with the new `view.lensPsf` assumption (#569).
- New assumptions `lens.ideal` (#576) and, when the fast method runs, `fast.lens.catalogue` (#568).

## Integration of the parts

- **Conflicts:** `CHANGELOG.md` (the four part blocks), `src/facade/simulate-capture.ts` (#569 removed the display view's refusal of `lens.catalogue` next to its own copy of the frame-size code; the merge keeps #576's shared `frameMm()`, which #568 then auto-merged onto). The generated API reference was regenerated, not hand-merged.
- **#576 against #569's subject-distance fix:** the message is now "subjectDistanceM must be at least twice the focal length"; #576's test, doc comment, QUICK_START and changelog follow it.
- **#568 against #569:** #568's test expected the display view to refuse `lens.catalogue`. With #569 it renders; `lens.catalogue: { kind, fast: true }` in a display view now renders with the per-zone PSF and reports `applied: { "lens.catalogue": false }` (the fast method is the capture's only). The `lens.catalogue` doc comment and docs/LENS_CATALOGUE.md say so.
- **The ideal lens's f-number range (owner's addition):** `widestFNumber` and `narrowestFNumber` are validated within `IDEAL_LENS_LIMITS`, widest ≤ narrowest, and go through the shared f-number check. #569's exposure anchor now takes the aperture of the lens's range nearest f/8 (the same N²/t); that is *PV 800 9*'s widest, as #569 had it, and the narrowest for an ideal range below f/8. No other lens's range excludes f/8, so no other request changes. Program follows the engine's program line (f/4–f/16) and refuses a range that does not hold it, as it does for `lens.prime` and `lens.catalogue`.

## Sizes

The app's capture-worker shape (`test/capture-bundle.test.ts`: every chunk of the app worker's engine imports, rolldown 1.2.9, minified ESM, gzip level 9):

| Tree | Total gzip |
| --- | --- |
| 2.17.0 (`8bbe20c`) | 347,775 B |
| #573 + #576 | 348,174 B |
| All four parts | 351,731 B |
| After the integration's savings (19 B) | 351,712 B |
| **2.18.0 (with the ideal lens's f-number range)** | **351,859 B** |
| Limit | 352,000 B (was 348,000 B; owner-approved 2026-11-09 for engine 2.18.0, #568's fast catalogue chunk) |

Since 2.17.0: #568's lazily loaded fast catalogue code +2,907 B (the `generic-lens-capture` chunk, 7,741 → 10,648 B), #569's display-view catalogue PSF +550 B (the lens-signal chunk), the entry +397 B, the bundler's chunk split +81 B, the f-number range +147 B. No behaviour-neutral change recovers the 3.7 KB: gzip already removes the duplicated text between the parts (sharing the tabulated paths' tables saved 7 B), the fast method's assumption text is output, and reusing the capture's bisection inverse distortion in the fast method would change its rounding.

The display view's addition to a capture bundle: 45,807 B minified and 18,128 B gzip (2.17.0: 45,791 B and 18,159 B; budgets 46,500 B and 18,550 B, unchanged).

## Byte identity

Every request that 2.17.0 renders and that uses none of the new options renders byte-identically: all hash locks pass in the full suite. The `lens.ideal` assumption records the f-number range only when one is given.

## Performance

Apple M5 Pro, Node.js 24.19.0, load average about 2.5, on the integrated tree:

- **#568** (`WIDTHS=768 EXACT_MAX_WIDTH=0 REPEATS=3 node scripts/benchmark-catalogue-capture.mjs`): 768 × 512 Siemens star at f/8, `lens.prime` 50 0.146 s, `lens.catalogue` *PV 50 1.8* fast 0.210 s (1.44×, as on the part branch: 0.145 and 0.209 s).
- **#569** (`ROWS=0 PARTS=30 REPEATS=2 LENS=none,catalogue:pv-50-1.2-pro node scripts/benchmark-display-view.mjs --app`): Speed, *PV 50 1.2 Pro* at f/8, part median 418–420 ms, 44.8–45.0 µs per display pixel (the part branch, on a loaded host: 436–720 ms, 46.8–77.1 µs); without a lens 36 ms, 3.9 µs.

## GPU evidence

`git diff v2.17.0 -- src/gpu` is empty, so no WebGPU hardware gate applies. Catalogue lenses in the display view stay on the CPU reference (`gpu: "auto"` falls back with `unsupported-on-backend`).

## For the owner

- **Moved to 2.19.0:** #570, #571 and #566 (#566's breaking orientation fix, decided for 2.18.0 on 2026-11-07, moves with them).
- **The ideal lens in program mode:** the program line runs f/4–f/16, so an ideal range that does not hold it is refused in program mode (shutter priority, aperture priority and manual take any range). Making the program line follow a lens's range would also change *PV 800 9*'s program refusals; it is left as is.

## Release gates

1. **GitHub CI** on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.18.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] The four part branches merged into this pull request.
- [x] Version surfaces aligned at 2.18.0 (`npm run release:prepare -- 2.18.0`). Root exports 1,850.
- [x] No `src/gpu` change: no WebGPU hardware gate.
- [ ] Packed tarball compared file by file with the published 2.17.0 (not done here: it needs the published tarball downloaded).
- [ ] Green CI on this pull request, then on `main` after merge.
- [ ] The owner's approval to tag `v2.18.0`.
- [ ] The `v2.18.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
