# 2.9.0 release

> **Published October 26, 2026.** The owner tagged `v2.9.0` on `02df403` (#437) after `main` CI on that commit had passed, and published the GitHub release. npm publishing ran from the tag.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.9.0`, with `ENGINE_API_VERSION = "2.9.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** new root functions and their types (`serializeSimulatedCaptureDngFromParts` and `SimulateCaptureDngPart`; `createPrintJpegStrip`, `composePrintJpegStrips`, `PrintJpegStripInput`, `PrintJpegStrip` and `JpegStripBits`). Nothing is removed or changed in meaning.
- **Same results:** all 24 fingerprinted results equal 2.8.1's, with only the engine version normalized. That covers bytes, metadata, assumptions and provider evaluation counts. The one value change is in diffraction cells with β ≥ 32 (binned and whole-frame display views), which differ from 2.8.1 in the last bits (below 5.5e-13). No capture hash lock changed.

## Scope

| Change | Pull request |
| --- | --- |
| Diffraction: real-space Airy cells from β = 32 (was 192); J₀² + J₁² by Miller's recurrence below x = 300 | #424 |
| Display view: lattice materials kept across refinement windows; caller scene points no longer frozen | #425 |
| A whole-frame DNG from region parts: `serializeSimulatedCaptureDngFromParts` (#391) | #426 |
| Display view: taller lattice bands, cheaper `sceneLookups` count | #427 |
| Display view parts: request tables kept across renders of a prepared view; bands sized to the part | #432 |
| A Print JPEG written in strips: `createPrintJpegStrip`, `composePrintJpegStrips` | #433 |
| Captures of chart and material scenes: the sensor stage allocates less per site (#418) | #429 |
| Captures with AHD demosaic: development about 3× cheaper around the demosaic (#420) | #431 |

Out of scope: the Quality display-view noise limit (#379) is unchanged from 2.8.1.

## What changed, with evidence

### Real-space diffraction cells from β = 32 (#424)

**Why:** the frequency-domain cell integration costs grow as β² (β = cell side × cut-off frequency). The app's Quality preset puts whole-frame and binned views at β ≈ 60–190, where it took seconds for each new f-number.

**Change:** the real-space encircled-energy integration of 2.5 now runs from β = 32. Below x = 300 it evaluates J₀² + J₁² by Miller's backward recurrence, normalized by J₀ + 2ΣJ₂ₖ = 1 (DLMF §3.6(iii) and 10.12.4, free to use). From x = 300 it uses the Hankel expansion, as before.

**Values:**
- At β = 32–191, real-space cells agree with frequency-domain cells within 5.5e-13.
- J₀² + J₁² matches Bessel's integral within 1e-11 relative at x = 0.5–12,346.
- Native pitches up to 10 µm (β < 19) keep the frequency-domain cells, so captures at sensor pitch are unchanged.

**Measured** (Node, one thread, fresh process):
- The app's 48-pixel Quality quick frame: 3.99 s → 0.62 s.
- Nine f-stops of the 50 mm lens: 14.0 s → 4.4 s in all.

### Display view: lattice materials kept, points not frozen (#425)

**Change:**
- Each lattice group keeps up to 128 rows of looked-up material indices across a render's filled windows. Indices are Int16 where they fit, about 3 MB for four groups of a 6000-site row.
- Caller `materialAt` and `evaluate` callbacks now receive a plain point object instead of a frozen one. The point was never documented as frozen, and the engine does not read it after the call.

**Values:** all display-view hash locks pass.

**Measured** (Node, one thread, the app's 24 MP request):
- Quality coarse frame: 42.9 s → 30.2 s.
- One Quality refinement band: 10.1 s → 6.3 s.

### A whole-frame DNG from region parts (#426, issue #391)

**Change:** `serializeSimulatedCaptureDngFromParts(options, parts)` joins the native sites of region parts and writes the DNG exactly as `simulateCapture` would:
- parts must cover the native raster and agree where they overlap;
- a part from another request is refused;
- parts take a fixed white balance and no `output.dng`;
- auto white balance and the capture time are measured over the joined frame.

**Values:** tests compare the joined DNG with the whole-frame DNG byte for byte. They cover bilinear and AHD, diffraction with four-spot and box apertures, auto white balance with a capture time, a reflectance-function scene and the environment path. The app's 24 MP request gave the same bytes in both presets.

**Measured** in the Photivra app (Chromium, four workers, 24 MP):
- Speed DNG: 79.1 s → 23.8 s.
- Quality DNG: 158.0 s → 46.2 s.

### Display view: taller lattice bands, cheaper `sceneLookups` (#427)

**Change:**
- A filled window's lattice band is built twice as tall, so the next display rows reuse it. Materials and change counts inside a rectangle do not depend on the band's origin.
- The `sceneLookups` diagnostic is counted from a bit mask per window row (a union of dilations is the dilation of the union).

**Values:** same result hash (samples and diagnostics) on the app's 24 MP band. While developing, the count was checked against the old method on all 64,896 windows. The display-view hash locks, which include the diagnostics, pass.

**Measured** (Node, one thread): one Quality refinement band, 6.1 s → 4.1 s.

### Display view parts: kept tables, bands sized to the part (#432)

**Why:** a 1 × 1 render of the app's Quality view took 37 ms. Of that, 21 ms rebuilt request-only tables and 10 ms allocated a sensor-wide band. A Quality preview has about 1,200 parts.

**Change:**
- A prepared view's renders share its expected-signal tables (lattice groups, combined kernels, each material's uniform sum) and its lattice material rings. These are cached per input object in a WeakMap. A ring entry depends only on its lattice point, so concurrent renders may share the rings.
- A filled band is only as wide as the part's windows span.

**Values:** hashes of 24 of the app's parts (samples, diagnostics, assumptions) are unchanged. Concurrent renders of a Quality chart view equal separate calls.

**Measured:**
- Node, one thread: the app's 48 × 48 Quality parts take 94–112 µs per display pixel instead of 115–130 µs.
- Chromium, four workers: Quality fully sharp in 64.9 s instead of 84.8 s.

### A Print JPEG written in strips (#433)

**Change:**
- `createPrintJpegStrip` codes a 1:1 Print JPEG's rows apart from the rows before them, and `composePrintJpegStrips` joins the strips.
- The encoder's Huffman tables are fixed, so only the DC predictor and bit alignment cross blocks. The join codes each strip's first block against the previous DC and copies the rest of its bits through the same 0xFF-stuffing emitter.
- The whole-image writer and the strips share one block coder.

**Values:**
- The joined file equals `createPrintJpegTask`'s file for several splits, crops, quantization steps and a density.
- The existing JPEG byte-identity corpora pass.
- The app's 24 MP JPEG from strips equals the engine's whole-frame JPEG.

**Measured:**
- 24 MP, Node, one thread: the whole task takes 8.1 s; four strips take 1.9 s each, and the join 1.1 s.
- The app (Chromium, four workers): Speed JPEG export 32–35 s → about 20 s; Quality 53–59 s → about 40 s.

### Captures: the sensor stage allocates less per site (#429, issue #418)

**Change:** the tabulated RAW path's sensor stage now:
- reseeds its charge and read-noise streams in place for each site;
- sums the read-noise components in one loop;
- returns each site's record without a second copy.

The seeds, every draw and every addition are the same, in the same order.

**Values:** RAW codes and samples are identical (SHA-256) on a 24 MP Siemens star and a dead-leaves frame. The bit-identity hash locks pass. A new test checks that a reseeded stream draws what a new one does for 137 seeds.

**Measured** (Node, one thread, 24 MP full frame): whole frame 18.5 s → 16.4 s (RAW stage 15.5 s → 13.3 s).

### Captures with AHD: development about 3× cheaper around the demosaic (#431, issue #420)

**Change:** after the AHD demosaic, each output row steps from two transformed points, as the bilinear path already does. Saturated sites come from a row-dilated mask instead of a 7 × 7 scan per pixel. The demosaic itself is unchanged.

**Values:** samples, RAW and the highlight counts are identical (SHA-256) on a 24 MP Siemens star and on 2048² regions at seven exposures, from no clipped pixel to all of them. A new test checks the saturated-pixel count against a brute-force count.

**Measured** (Node, one thread, 24 MP full frame, AHD): whole frame 33.6 s → 28.5 s; development 18.0 s → 12.4 s.

### The app's preview, all changes together

Chromium headless, production build, 4-vCPU container, four workers, 24 MP full frame; seconds from the change:

| Step | 2.8.1: quick frame / sharp | 2.9.0: quick frame / sharp |
| --- | --- | --- |
| Cold load (Speed) | 0.76 / 40.1 | 0.74 / 33.6 |
| f/8 → f/11 (Speed) | 0.42 / 29.7 | 0.41 / 24.2 |
| Switch to Quality | 4.04 / 170.3 | 0.70 / 64.9 |
| f/11 → f/16 (Quality) | 2.21 / 205.7 | 0.56 / 70.7 |

## Compatibility

- Root exports: 1,734 (five added, none removed).
- No option, default, schema or result field changes.
- `quadrature.method` reports the real-space method for wavelengths whose cells have β ≥ 32.
- Caller scene callbacks receive unfrozen point objects.
- `createDisplayViewExpectedSignal`, which is internal, takes an optional `spanColumns` speed hint.

## Rights and licensing

No third-party code, data or dependencies are added. Miller's recurrence and the Bessel identities are cited from the NIST Digital Library of Mathematical Functions (free to use).

## Privacy and security

No network, persistence or telemetry is added. The new caches hold only numbers computed from requests: lattice material rows (bounded by `LATTICE_RING_ROWS`) and the existing band limit. A prepared view's tables and rings are held in a WeakMap keyed by its input, and released with the view.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.9.0 changes merged with their changelog entries (#424, #425, #426, #427, #432, #433, #429, #431).
- [x] Version surfaces aligned at 2.9.0 (`npm run release:prepare -- 2.9.0`). Root exports 1,734.
- [x] Fingerprint against `v2.8.1`: all 24 results identical, with only the engine version normalized (re-run on main at 2000e4f, with #429, #431, #432 and #433).
- [x] Owner's review of this record.
- [x] Green CI on the record pull requests (#428, #437), then on `main` after merge (CI run 1008 on `02df403` passed before the tag).
- [x] **The owner's explicit approval to tag `v2.9.0`.** The owner tagged it and published the release.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.9.0` → `02df4034224c984cf63b63a8754b2bbfd119598e` (#437), after `main` CI on that commit passed ([CI run 1008](https://github.com/Photivra/engine/actions/runs/40257985714)) |
| GitHub release | [@photivra/engine 2.9.0](https://github.com/Photivra/engine/releases/tag/v2.9.0), published 02:41:08 UTC |
| Publish workflow | [Publish npm run 27](https://github.com/Photivra/engine/actions/runs/40260315982): passed (completed 02:48:24 UTC) |
| npm | `@photivra/engine@2.9.0`, dist-tag `latest`, registry time 02:50:36 UTC |
| Integrity | `sha512-a7kqsk6QBDo+hwqJQfjZwUNh4HgKCOxy85A5ZDhsvNSRyjSTX+H8DFxhJUh6wCO/VfXFtSxdUAQvaeqvsxOfnQ==` (shasum `e2ad5b76a148f9dffeb01c763f4c430bc449baa4`, 858 files), the same as a local pack of `02df403` |
| Provenance | SLSA provenance from GitHub Actions for the tag, in the Sigstore transparency log ([log index 3476629465](https://search.sigstore.dev/?logIndex=3476629465)); the registry lists the provenance and publish attestations for 2.9.0 |
