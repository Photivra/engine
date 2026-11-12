# 2.3.0 release candidate

> **Published October 18, 2026.** The owner tagged `v2.3.0` on `0e7a046` and published the GitHub release; npm publishing ran from the tag. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.3.0`, with `ENGINE_API_VERSION = "2.3.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** every change is additive and opt-in. Without the new inputs every request, plan, RAW, image, encoded file, scene digest and hash lock is byte-identical to 2.2.1, apart from the engine version that captures record. No root export is removed, and no input that 2.2.1 accepted is rejected.
- **Why now:** the Photivra app needs test charts it can build from generic engine parts, charts at their physical size framed by real focal lengths, whole-frame overviews that do not alias falsely, tiles and 100 % crops of large frames, and an ideal reference to compare a capture against. The owner decided on October 18, 2026 that the planned 2.3 (charts, chart size, pixel aperture, regions, ideal reference) and 2.4 (generic primes and framing distance) ship together as 2.3.0. The proprietary brand label and the app's specific chart layouts stay in the app; the engine provides only generic, unbranded parts.
- **What this release does not claim:** calibrated accuracy for any real camera, lens, sensor or chart. The generic primes are educational lenses defined by three rules, not products. The minimum focus distance is a thin-lens approximation. Performance numbers come from one machine and are not a performance claim.

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| Chart elements: `dead-leaves`, `bar-groups`, `hyperbolic-wedge`, `zone-plate`, `slanted-squares`, `line-grid`, `fiducial`; `siemens-star` `profile: "sine"`; analysis helpers | `CHART_CONTINUOUS_LEVELS`, `calculateBarGroupTargets`, `calculateSlantedSquareEdges`, preset types | Additive, opt-in |
| `composite` charts: elements in placement rectangles over a background | `CompositeChartScene`, `CompositeChartElement`, `ChartElementScene` | Additive, opt-in |
| Fixed-size chart placement | `simulateCapture` / `createPlanarSceneRadianceProvider` `chartSize`, `ChartSizeOption`, `CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE`, `result.scene.chart` | Additive, opt-in |
| Box pixel aperture | `sensor.pixelAperture`, `SimulateCapturePixelAperture`, `SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES` | Additive, opt-in |
| Region rendering for tiles and crops | `output.region`, `result.region` | Additive, opt-in |
| Ideal reference images | `simulateIdealReference`, `IdealReferenceResult` | Additive |
| Generic prime lens family | `lens.prime`, `resolveGenericPrimeLens`, `GENERIC_PRIME_*`, `calculateGenericPrimeMinimumFocusDistanceM` | Additive, opt-in |
| Framing distance | `calculateSubjectDistanceForFraming` and its types | Additive |
| Version 2.3.0, changelog and this record | — | Release preparation |

Root exports grow from 1,680 to 1,713 symbols (33 added). Comparing the generated `docs/api/exports.json` with `v2.2.1` shows none removed.

## What changed, with evidence

### Chart elements and composite charts

Each element is an analytic reflectance pattern written for the engine; continuous patterns are quantized to 1024 neutral levels (step below 0.1 % of the range, far below sensor noise).

- **Dead leaves:** opaque disks with Poisson centres, radius density ∝ r⁻³, uniform grey, after F. Cao, F. Guichard and H. Hornung, "Dead leaves model for measuring texture quality on a digital camera", *Proc. SPIE* 7537 (2010), and A. B. Lee, D. Mumford and J. Huang, "Occlusion models for natural images", *IJCV* 41 (2001). Disks are drawn front to back until the area is covered, the backward perfect simulation of W. S. Kendall and E. Thönnes, "Perfect simulation in stochastic geometry", *Pattern Recognition* 32 (1999). Seeded with the engine's xorshift32 stream and only correctly rounded arithmetic; a test locks the texture's hash and disk count.
- **Bar groups:** the three-bar group of the USAF-1951 target (MIL-STD-150A, a US-government publication) in the engine's own arrangement, at LW/PH frequencies (ISO 12233 convention) with engine-drawn seven-segment numerals. Tests check bar widths PH/LW and the bar sequence.
- **Slanted squares:** rotated squares giving slanted edges for the method of P. D. Burns, "Slanted-Edge MTF for Digital Camera and Scanner Analysis", IS&T PICS 2000 (free). A test checks every reported edge against the pattern.
- **Zone plate** cos(π·k·r²) (the Fresnel zone plate chirp; J. W. Goodman, *Introduction to Fourier Optics*), **hyperbolic wedge**, **line grid**, **fiducial**, **sine star**: definitions and tests in `test/chart-elements.test.ts`.
- **Composite:** later elements cover earlier ones; LW/PH keeps the composite's picture height; nested defaults are reported by path; caller spectra in elements enter the scene digest.
- **GPU:** the `webgpu-f32` chart stage rejects the new presets with `unsupported-on-backend` (docs/WEBGPU.md explains why); `cpu-reference` covers them, and a test checks both.

### Fixed-size chart and framing distance

Thin lens throughout, the facade's existing framing: m = v/d = f/(d − f), so d = f·(1 + 1/m). `chartSize` places the chart at its physical size and reports coverage and magnification; `calculateSubjectDistanceForFraming` returns the fit distance (contain, width, height or cover). A test places a chart at the returned distance and gets `frameWidthFraction` 1. Full-frame A3 (0.42 × 0.28 m): 0.127 m at 10 mm, 0.633 m at 50 mm, 2.53 m at 200 mm, 15.2 m at 1200 mm; an A4 chart at 10 mm (0.093 m) is below the 0.10 m minimum focus.

### Generic prime lenses

Focal length = full-frame equivalent ÷ diagonal crop factor (`calculateEquivalentFocalLength35Mm`); f-number ranges by class (owner decision); marked third-stop values clipped to the range; minimum focus max(0.10 m, f·(1 + 1/0.15)), labelled a thin-lens approximation. No brand names. `simulateCapture` `lens.prime` rejects an f-number outside the range and a distance below minimum focus. Tests: `test/generic-primes.test.ts`.

### Box pixel aperture

An N × N midpoint rule over the square photosite (fill factor 1), using the environment's existing spatial quadrature. The ideal box aperture's MTF is |sinc(f·p)| (the detector footprint MTF; G. D. Boreman, *Modulation Transfer Function in Optical and Electro-Optical Systems*, SPIE Press 2001, chapter 2); the midpoint rule gives |sin(πfp)/(N·sin(πfp/N))|, within 2.6 % below Nyquist for N = 4. A test measures that response on the RAW for N = 2, 4 and 8 to two decimals; with diffraction the fast object-space convolution gives the same RAW codes as the per-tap quadrature. Measured cost of 4 × 4: 5.2× at 48 × 48 and 7.8× at 128 × 128.

### Region rendering

Each region keeps the whole frame's absolute native site indices (noise seeds, CFA phase, rolling-shutter row timing), renders the demosaic reach around it, and keeps the whole render's diffraction bands. Tests stitch irregular tile grids and compare byte for byte with the whole render for bilinear and AHD demosaics, mirror borders, diffraction with anti-aliasing and the box aperture, camera rotation with a rolling shutter, a fixed-size composite and a Display P3 PNG. A 768 × 512 chart capture rendered as four tiles in four workers was byte-identical to the whole render (16.4 s wall against 49.3 s).

### Ideal reference images

`simulateIdealReference` renders the same request without camera effects. Exposure-matched: each channel is the noise-free signal the capture's sensor would record at its resolved exposure, normalized like the RAW development and developed with the capture's white balance, matrices, tone curve and encoding. Tests check uniform patches against the capture's mean within one 8-bit code across shutter, ISO, f-number, pixel size, tone curve and a tungsten illuminant; region crops equal the whole reference. Labelled `kind: "ideal-reference"`, deterministic, no RAW simulated (0.44 s for a 768 × 512 composite).

## Compatibility

- **Additive:** 33 root symbols; optional inputs `chartSize`, `sensor.pixelAperture`, `output.region`, `lens.prime`; `siemens-star` `profile` (reported only when given); optional result fields `scene.chart` and `region`; optional provider methods `chartMaterialAt` and `materialRadiance` on chart providers; new cost options `sensor.pixelAperture.box` and `output.region`.
- **Unchanged at the defaults:** a fingerprint of ten default-path captures (samples, RAW, PNG/JPEG/DNG bytes, assumptions, plan, request, site input, scene digest) and the chart-radiance batch values for every 2.2 preset matched `main` at 2.2.1 byte for byte after every feature commit. The existing hash locks (including the 2.0.0 lock in `test/simulate-capture-optics.test.ts`, which writes the DNG Software tag's engine version back to the 2.0.0 name before hashing) pass unchanged.
- **Internal:** the native RAW task gains an internal column band next to its row band; no public task signature changes.

## Rights and licensing

- **No third-party code, data or constants added.** Every chart element, layout rule, numeral shape and lens rule is written for the engine. Cited papers and standards are used for definitions and relations, not copied. No chart layout of any vendor and no reflectance data set is included; the USAF-1951 three-bar concept comes from a US-government publication (MIL-STD-150A), and only the concept is used.
- **No new runtime dependency.** `package.json` and `package-lock.json` changed only in their version fields.

## Privacy and security

No network, persistence or telemetry is added. New inputs are validated strictly (unknown fields rejected, numeric ranges checked) before any work. The dead-leaves generator is bounded (at most 4 194 304 lookup cells and 4 000 000 disks) and fails closed.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] All 2.3.0 work on one branch with changelog entries.
- [x] Version surfaces aligned at 2.3.0 (`npm run release:prepare -- 2.3.0`); API reference regenerated (1,713 root symbols; none removed).
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#342), then on `main` after merge ([CI run 863](https://github.com/Photivra/engine/actions/runs/39092639495) on `0e7a046`).
- [x] **The owner's explicit approval to tag `v2.3.0`.** The owner tagged `v2.3.0` on `0e7a046`; `v2.2.1` is unchanged.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.3.0` → `0e7a0462220bc224f7beb88f4533714117b36800` (#342) |
| Publish workflow | [Publish npm run 19](https://github.com/Photivra/engine/actions/runs/39093409802), passed (completed 03:32:44 UTC); the provenance was signed at 03:32 UTC and the registry records publication at 03:34 UTC |
| npm | `@photivra/engine@2.3.0`, dist-tag `latest` |
| Integrity | `sha512-riFMD84pA70w2nGovnvoXaAw6KT51qA4zxebZlVMHFNQlBC4gcXlzEX3jssqcPKeoUNB+VDVjlL7fp3Wevs/Zg==` (shasum `f2caddace1f6fa7a0472b4f72a112002e3e4b4fa`) |
| Provenance | Signed SLSA provenance for `0e7a046` from `.github/workflows/publish.yml` at `refs/tags/v2.3.0` (Publish npm run 19), published to the Sigstore transparency log (log index 3305539678); `npm audit signatures` verifies the registry signature and the attestation |
| Tarball contents | Byte-identical (same shasum and integrity, 832 files) to `npm pack` of a clean local build of `v2.3.0` (checked October 18, 2026) |
| GitHub release | [@photivra/engine 2.3.0](https://github.com/Photivra/engine/releases/tag/v2.3.0) |
