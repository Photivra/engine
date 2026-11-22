# 2.28.0 release

> **Prepared November 21, 2026; not yet published.** npm publishing runs only from the owner's `v2.28.0` tag
> ([Before the tag](#before-the-tag)).

## At a glance

- **What is proposed:** publish `@photivra/engine@2.28.0`, with `ENGINE_API_VERSION = "2.28.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **The issues:**
  - lower CPU cost of full-quality and batch figure renders (#670), of captures with kernels (#731), of large defocus discs with
    diffraction (#734), mixed lighting (#735), perceptual gamut mapping (#684), environment-chain captures (#722) and other
    paths (#662, #676, #677, #685, #688, #689, #711, #721, #727, #729);
  - catalogue-lens display views on the GPU (#661) and image-plane GPU fixes (#715, #716);
  - two new functions: `simulateFalseColor` (#739) and `estimateDisplayViewRender` (#660);
  - output changes: the diffraction window follows the flag (#732), the catalogue PSF's exact cell integral (#674), the
    catalogue fast check read from the whole frame (#733), the box aperture's offsets to second order (#685), self-describing
    region parts (#728);
  - the low-severity fixes of the 2.27.0 review (#698–#703) and the other fixes listed in the changelog;
  - CI, gates and the documentation site (#659, #665, #666, #669, #693–#697, #703, #709, #713).
- **Why a minor version:**
  - 7 new root exports, 2,110 → 2,117 (runtime exports 722 → 725), new result fields and two new fast methods. Nothing is
    removed from the root and no export changes kind.
  - Some outputs, report fields and refusals change, and two registry entries of `SIMULATE_CAPTURE_FAST_METHODS` are removed
    ([Default and output changes](#default-and-output-changes)).
- **Capture-worker sizes:** fast worker 338,840 B (limit 338,900 B, 2.27.0's); on demand 51,977 B (limit 52,000 B, 2.27.0's);
  #658's 49,400 B target was not met and #658 stays open ([Sizes](#sizes)).

## Scope

`main` after the `v2.27.0` tag carries the 2.27.0 publication record (#667) and two CI changes. The `e228-int` branch is cut from
`7c07a5e` (`main` after #736); each part was built on its own branch and merged without rebasing
(`git log --first-parent 7c07a5e..e228-int`).

| Change | Issues | Source |
| --- | --- | --- |
| On `main`: the plain test legs in four parts and CI timeouts scaled by 3 | #668 | `b975d92` (#714) |
| On `main`: the coverage-parts gate, shard start order, the WebGPU release gate, split display-view sample locks | #665, #666, #693, #697, #713 | `7c07a5e` (#736) |
| Browser-surface gate, the WebAssembly boundary, shared heading ids, repository links, identity and licence policy for the site | #659, #694, #695, #696, #709 | `1d8b157` |
| Documentation site: generator, checks and Pages workflow | #669 | `73143f4` |
| Sensor: relative photosite powers, exposures met at a range end, deep freezes | #681, #682, #683, #712 | `c2853fd` |
| Capture, processing and output fixes | #671, #677–#680, #689, #717–#721, #723, `capture-20` | `7f8cc5b` |
| Optics fixes and the irradiance convolution gather | #686, #687, #724–#727 | `f611c3e` |
| Facade: Auto ISO and program mode on sensor profiles, still temporal samples, a subject at rest, the moving subject's lookup | #672, #673, #676, #683, #688, #729 | `7e0e925` |
| Display view: render estimate, the still camera's lens mapping, identity-tone chain slopes | #660, #662, #685 | `5d5abdb` |
| GPU and bundles: the session chunk's shader text, the bundler version, abort and fallback handling, the on-demand row | #658, #675, #690, #691, #692 | `fb9dacb` |
| The batch-figure benchmark, its hash locks and the 2.26.0 and 2.27.0 records | #670 | `890f739` |
| Integration of the parts above, and the render estimate's root-export classification | — | `48ab001`, `8ec59ee` |
| Output changes: the catalogue fast region, the exact regroupings in full-quality views, the per-tap sum with kernels, self-describing parts, the diffraction window, the catalogue PSF's cell integral, the box aperture's offset expansion, portable exposure math | #670, #674, #685, #728, #731, #732, #733, `foundation-06` | `a6c0f8d` |
| Image-plane GPU fixes and catalogue-lens views on the GPU | #661, #715, #716 | `8405ae2` |
| Mixed lighting per point, shared site records, perceptual gamut mapping's early-out | #684, #722, #735 | `353cda0` |
| Large defocus with diffraction, rolling-shutter blocks, the batch recipe and the four-node site sum, `simulateFalseColor` | #670, #711, #734, #739 | `417ee75` |
| Low-severity GPU and CI findings | #702, #703 | `9767636` |
| Low-severity capture, exposure, colour, optics and sensor findings | #698, #699, #700, #701 | `6a848eb` |
| Review fixes: typed quick-start examples; a radiance-function scene's surround with `chartSize` (#735); the canonical request key of a part (#728); `simulateFalseColor` refuses `fast: true` on an option record (#739); the GPU lens route's offset mapping documented (#661, #685); the Pages deploy gated on `PAGES_DEPLOY`, `main smoke` on Node 24, the CI tools' entry checks; the upload-artifact pin; a radiometry requirement's field set to `undefined` (#701) | — | `ab91476`, `4dddee2`, `1fd4e0e`, `d4e92d5`, `d9e33aa`, `4ab5cca`, `bce2f21`, `b37db2b` |
| 2.28.0 preparation (version surfaces, the changelog for release notes, this record) | — | `5ebfc07`, this branch |

The entry is in [CHANGELOG.md](../CHANGELOG.md) under 2.28.0, by area, with the migration list first. The changes are
documented in:
- [DISPLAY_VIEW.md](DISPLAY_VIEW.md) ("Estimating a render", "Bundle size" and the sections it links);
- [QUICK_START.md](QUICK_START.md) ("False color (2.28)", "Batch figure renders in Node");
- [USAGE.md](USAGE.md), [PROCESSING.md](PROCESSING.md) and [WEBGPU.md](WEBGPU.md);
- the generated [API reference](API_REFERENCE.md).

## New exports

7 root exports (3 runtime, 4 types), counted from `docs/api/exports.json` against the `v2.27.0` tag's; nothing is removed and
no existing export changes kind.

| Runtime exports | Types | Issue |
| --- | --- | --- |
| `simulateFalseColor`, `SIMULATE_FALSE_COLOR_LIMITS` | `SimulateFalseColorOptions`, `FalseColorResult` | #739 |
| `estimateDisplayViewRender` | `DisplayViewRenderEstimate`, `DisplayViewCountRange` | #660 |

**New fields on existing results:** `region.fast` and `region.requestKey` (#728), `view.lensPsf.offsetMapping` (#685), `view.execution.offsetMapping` on a `webgpu-f32` lens render with several query offsets,
`raw.expectedSignal.sum` (#731), `clippedSitesKept` in `simulateDngRawWhatIf` (#679), `exposureBracketRealizedOffsetStops`
(#680). `ExposureResolutionConstraint` and `DisplayViewGpuFallbackReason` gain two values each.

## Default and output changes

The full list is the changelog's "Output and behaviour changes (migration)" under 2.28.0: the diffraction window of fast
requests (#732, `lens.diffraction/kernel-window`), the catalogue-lens PSF (#674), `fast: false` display views and the two
removed registry entries (#670), the catalogue fast region (#733), the box aperture's offset expansion (#685,
`lens.catalogue/view-offset-expansion`), joins of region parts (#728), the widened unions, #658's shorter texts, metric print
sizes (#717), report fields (#681, #729, #688, `foundation-07`), portable exposure math (`foundation-06`), GPU results (#716,
#661, #692, `gpu-05`), deep freezes (#682, #683, #722, `optics-06`) and the consolidated list of newly refused inputs.

## Sizes

Measured on the capture worker's shape (`test/capture-bundle.test.ts`) with the measured bundler version (rolldown 1.2.14),
Node 26, gzip. 2.27.0's rows were measured with rolldown 1.2.9.

| Row | 2.27.0 (rolldown 1.2.9) | 2.28.0 | Limit (2.27.0's) |
| --- | --- | --- | --- |
| fast worker | 338,380 B | **338,840 B** | 338,900 B (338,900 B) |
| on demand | 51,999 B | **51,977 B** | 52,000 B (52,000 B) |
| export kit | 10,399 B | **10,395 B** | 10,400 B (10,500 B) |
| lens passes (#661) | (no row) | **10,200 B** | 10,200 B (none) |
| false color (#739) | (no row) | **5,094 B** | 5,100 B (none) |

- The fast worker measures 338,840 B on the release tree; its limit is 338,900 B (2.27.0's limit, owner decision 2026-11-21).
- #658's on-demand target of 49,400 B was not met; #658 stays open ([DISPLAY_VIEW.md, "Bundle size"](DISPLAY_VIEW.md#bundle-size)).
- The lens passes and the false-color body are on-demand chunks of their own; neither reaches the fast worker.

## Benchmarks

`docs/benchmarks/2026-11-21-figure-batch-2.27.0-2.28.0.json` records the #670 set (22 parts, `fast: false` first, then the
default flag) on 2.27.0 and 2.28.0 in paired runs, and the whole figures `frame-768` and `dof-near-s1` on 2.28.0.

| Measure | 2.27.0 | 2.28.0 | Ratio |
| --- | --- | --- | --- |
| 22 parts, `fast: false`, CPU s | 435.3 | 190.1 | 0.44× |
| 22 parts, default flag, CPU s | 94.2 | 57.1 | 0.61× |
| `frame-768` whole figure, `fast: false`, CPU s | 256.8 (2.26.0/2.27.0 record, another session) | 83.3 | — |
| `dof-near-s1` whole figure, `fast: false`, CPU s | 1,535.5 (2.26.0/2.27.0 record, another session) | 70.7 | — |

Per-part figures are in the record. Times are host-dependent; the benchmark is informational and not run by CI.

## Known limits

- #661's lens passes conform on the float32 emulation and SwiftShader; the hardware run is a step before the tag.
- #711: the 192 × 128 out-of-focus rolling-shutter region stays above 3× its in-focus time.
- #724/`optics-13`: the Brown–Conrady inverse throws for some targets within 1e-12 of the envelope that 2.27.0 inverted (7 of
  40,000 seeded cases).
- #688: a `motion.subject` at rest is no longer listed in `diagnostics.options`.

## Release gates

1. **GitHub CI** on the exact commit that is tagged (CI and WebGPU). Tag it only when its CI is green.
2. **The owner's explicit approval** to tag `v2.28.0` (AGENTS.md rule 3).

## Before the tag

- [ ] The owner's hardware GPU run on the release commit, recorded in [WEBGPU_DEVICES.md](WEBGPU_DEVICES.md) (the lens passes of
  #661 and #716's GPU results).
- [ ] The WebGPU conformance run on the release commit (all three parts; the publish workflow's `WebGPU conformance proofs` job
  requires them).
- [ ] The figure-batch record `docs/benchmarks/2026-11-21-figure-batch-2.27.0-2.28.0.json` committed and its figures entered in
  [Benchmarks](#benchmarks) and the changelog.
- [ ] The fast worker's limit set ([Sizes](#sizes)).
- [ ] The owner's GitHub Pages setup, then the repository variable `PAGES_DEPLOY` set to `true`
  ([DEVELOPERS.md](DEVELOPERS.md#documentation-site)).
- [ ] The owner's approval to tag `v2.28.0` (AGENTS.md rule 3).
