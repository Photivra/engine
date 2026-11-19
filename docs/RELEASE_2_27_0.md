# 2.27.0 release

> **Prepared November 18, 2026; not published.** npm publishing runs only from the owner's `v2.27.0` tag ([Release gates](#release-gates)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.27.0`, with `ENGINE_API_VERSION = "2.27.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **The issues of milestone 2.27.0:**
  - lower CPU cost of the display view with lens corrections and sharpening (#649), with camera rotation under a rolling shutter and
    defocus (#651), of defocused and long-lens Quality frames (#653), with catalogue lenses (#655, CPU) and with develop options (#656);
  - layered chart scenes: opaque cards at several distances in front of a back plane with point lights (#652).
- **Why a minor version:**
  - 14 new root exports, 2,096 → 2,110 (runtime exports 716 → 722), new options and new result fields. Nothing is removed or changed in kind.
  - Three display-view fast defaults change ([Default changes](#default-changes)).
- **Capture-worker sizes:** the on-demand limit is 52,000 B (owner approval; savings tracked in #658) ([Sizes](#sizes)).

## Scope

The `e227-int` integration branch is cut from `94f56f3` (`main` at the `v2.26.0` tag). Each part was built on its own branch and
merged without rebasing.

| Change | Issues | Source |
| --- | --- | --- |
| Spectral lattice tiles, the view-equivalence test helper and the display-view cost cases (`scripts/benchmark-display-view-cases.mjs`) | — | `85b934d` |
| In-focus tiles, rows on demand and pre-integrated radiance | #653 | `43ed4d2` |
| Shared passes of lens corrections and sharpening | #649 | `298fa10` |
| The 3-or-6 point chain rule | #656 | `c3a02f2` |
| Defocus regrouped through the lens, row bands, the catalogue lens's one kernel pass, uniform windows, the Newton inverse | #651, #655 | `8d3e5e7`, `a753b06` |
| Docs, changelog and re-recorded hash locks | — | `7c6564f` |
| Layered chart scenes | #652 | `79529bb`, `102aa2d` |
| Review fixes: one rolling-shutter method per request, `calculateLayeredChartDepths` on the scene as written, point lights within one site refused, one `lens.defocus` record for one card, the layered bundle and `lens.psf` refusal tests, docs; 2.27.0 preparation (version surfaces, the changelog heading, this record, the 2.26.0 publication record) | — | this branch |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.27.0, one section per issue. The new scene and the cost work are
documented in:
- [LAYERED_SCENES.md](LAYERED_SCENES.md);
- [DISPLAY_VIEW.md](DISPLAY_VIEW.md) ("2.27.0 cost cases" and the sections it links);
- [USAGE.md](USAGE.md) ("Layered chart scenes", "Display view of a capture");
- the generated [API reference](API_REFERENCE.md).

## New exports

14 root exports (6 runtime, 8 types), all from #652; nothing is removed and no existing export changes kind.

| Runtime exports | Types |
| --- | --- |
| `prepareLayeredChartScenes`, `resolveLayeredChartPreset`, `calculateLayeredChartDepths`, `LAYERED_CHART_LIMITS`, `LAYERED_CHART_PRESET_SCALES`, `LAYERED_CHART_PRESET_STEP_RATIO` | `LayeredChartScene`, `LayeredChartCard`, `LayeredChartBackPlane`, `LayeredChartPointLights`, `LayeredChartDepth`, `LayeredFrameRectangle`, `ResolvedLayeredChartScene`, `ResolvedLayeredSurface` |

**New options and fields on existing functions:**
- `scene: { kind: "layered-chart", cards, backPlane? }` in `simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and
  `prepareDisplayView`, after `prepareLayeredChartScenes()`; `result.scene.layers` (#652).
- `view.defocus.rollingBands`, `view.lensPsf.uniformWindows` and `view.rendering.chainPointsPerAxis: "3-or-6"` in the display
  view's assumptions (#651, #655, #656).

## Default changes

Each is the default for the display view and sRGB samples; `fast: false` (and the record's own flag) takes the full method.

1. **Row bands under a rolling shutter (#651, `motion.shutter.rolling/view-row-bands`).** With camera rotation and the defocus disc
   regrouped, rows are grouped into bands of at most 63 that read their middle row's instants (the in-focus image moves at most
   1/128 site). Every render of such a request takes the row blocks, whatever the region's size, so a region equals the whole view.
2. **Uniform windows for a catalogue lens (#655, `lens.catalogue/view-uniform-window`).** On chart and material scenes a site whose
   every tap reads one material takes the field factor to second order (within 2.7·10⁻⁸ relative of the full method).
3. **The chain rule of Recover (#656, `output.highlightMode.reconstruct/view-moments`).** 3 points per axis where it is safe, else 6.

Every other change gives the same results within rounding (per-site electrons within 1e-9 relative, 8-bit samples within one
code) and takes no flag. `fast: false` equals 2.26.0 bit for bit on the paths the plan leaves unchanged.

## Sizes

Measured on the app's capture-worker shape (`test/capture-bundle.test.ts`).

| Tree | Fast worker | On demand | Export kit |
| --- | --- | --- | --- |
| 2.26.0 (`94f56f3`) | 331,482 B | 49,382 B | 10,403 B |
| **This branch** | **338,378 B** | **51,999 B** | **10,399 B** |
| Limits | 338,900 B (unchanged) | 52,000 B (49,400 B before) | 10,500 B (unchanged) |

- The on-demand limit is the measurement of #649's shared passes and #656's chain rule rounded up to the next 100 B (owner
  approval); the savings are issue #658.
- The layered code is a lazy chunk that only `prepareLayeredChartScenes()` loads; no layered module reaches the capture worker's
  bundle (tested).

## Known limits

- Not met and open for 2.28.0 (owner-accepted): #656 Recover and +1 stop without Standard (1.22 s against 0.8 s), #651's
  192 × 128 region (4.7× its in-focus time against 3×), #655's 2 × 2 box (2.0× the point aperture against 1.3×).
- #649's ratios to the plain part vary with load (corrections 1.42–1.79×, both 2.40–2.91× over three runs); the absolute
  targets are met.
- Catalogue-lens and layered views render on the CPU (`gpu: "auto"` labels `unsupported-on-backend`).
- Layered scenes refuse motion, non-rectilinear projections, `lens.distortion`, `lens.vignetting`, `lens.catalogue`,
  `lens.pupilSampling`, `lens.psf`, `chartSize`, `illumination`, and point lights of which two lie within one site.

## Release gates

1. **GitHub CI** on the exact commit that is tagged. Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.27.0` (AGENTS.md rule 3).

## Remaining release checklist

- [x] #649, #651–#653, #655 and #656 merged into `e227-int` on `94f56f3`.
- [x] Version surfaces aligned at 2.27.0 (`npm run release:prepare -- 2.27.0`). Root exports 2,110.
- [x] 2.26.0 recorded as published ([2.26.0 release record](RELEASE_2_26_0.md#publication)).
- [x] The worker rows measured ([Sizes](#sizes)).
- [ ] Green CI on the pull request (the full suite, coverage and WebGPU), then on `main` after merge.
- [ ] The owner's approval to tag `v2.27.0`.
- [ ] The `v2.27.0` tag on the `main` commit that merges this record.
- [ ] After publication:
  - [ ] npm version, dist-tag, integrity and provenance verified;
  - [ ] GitHub release notes published;
  - [ ] publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md`, `docs/DEVELOPERS.md` and this record.
