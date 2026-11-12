# 2.5.0 release candidate

> **Published October 18, 2026.** The owner tagged `v2.5.0` on `c5a2a78` and published the GitHub release; npm publishing ran from the tag. The tag was pushed before `main` CI on that commit had finished; the publish workflow ran its own full verification, and `main` CI passed before the publish job started. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.5.0`, with `ENGINE_API_VERSION = "2.5.0"`. `POC_SIMULATION_API_VERSION` stays `1.0.0`.
- **Why a minor version:** both changes are additive. `simulateCapture` accepts pixel pitches up to 1000 µm, which it rejected before, and a new function reports chart coverage. Every request that 2.4.1 accepted gives byte-identical results, apart from the engine version that captures record. No root export is removed.
- **Why now:** applications want to show a whole sensor frame at a small output size (for example a full-frame sensor 48–768 pixels wide). For that, `lens.prime`, minimum focus and the framing distance must match the real sensor, and the app needs to report how much of the frame a chart covers at any distance. The owner approved both on October 18, 2026: "Engine 2.5.0 … whole-frame views at large pixel sizes (tested for brightness, diffraction, filter, averaging and exact tiles there), plus the coverage-at-any-distance function you approved for later". Whole-frame views merged in #350 (`05dfd3c`), `calculateChartFraming` in #351 (`b875ee8`), and the CI time limit in #348 (`0353e9d`).
- **What this release does not claim:** a whole-frame view is a downsized view. Its per-pixel noise is that of the real photosites binned into each output pixel, not the real sensor's per-pixel noise. The framing function is the same thin-lens approximation that the facade uses, not a real lens's specification.

## Scope

| Change | Public surface | Kind |
| --- | --- | --- |
| Pixel pitch 0.5–1000 µm (whole-frame views) | `simulateCapture` `sensor.pixelPitchMicrometers`; assumption `sensor.wholeFrameView` above 100 µm | Additive (wider accepted range) |
| Real-space integration of diffraction cells far larger than the Airy pattern | `createDiffractionLimitedPsfProfile` `quadrature.method` values `"real-space-encircled-energy-gauss-legendre"` and `"frequency-domain-and-real-space"`, `quadrature.realSpaceWavelengthsNm` | Additive; same model, values change only for β ≥ 192 |
| Chart coverage at any subject distance | `calculateChartFraming`, `CalculateChartFramingInput`, `ChartFraming` | Additive |
| CI verify job limit raised from 15 to 25 minutes (#348) | None (repository workflow) | Tooling |
| Version 2.5.0, changelog and this record | — | Release preparation |

Root exports grow from 1,714 to 1,717 symbols (3 added: `calculateChartFraming`, `CalculateChartFramingInput`, `ChartFraming`). Comparing the generated `docs/api/exports.json` with `v2.4.1` shows none removed.

## What changed, with evidence

### Whole-frame views (`sensor.pixelPitchMicrometers` up to 1000 µm)

The facade has always simulated a sensor that is output width × pitch wide. Setting the pitch to sensor width ÷ output width (36 mm at 48 pixels is 750 µm; 44 mm at 48 pixels is 917 µm) therefore renders the whole frame. The crop factor, generic prime, minimum focus and chart framing then follow the real sensor. A new option would have restated the same geometry, so the accepted range was widened instead. Above 100 µm, which is larger than any camera photosite, the assumption `sensor.wholeFrameView` records the frame size and states the noise caveat.

Science:

- **Brightness.** ISO speed is defined at the output, S = 10/H (CIPA DC-004-2020 §3.2, free). Collected charge is proportional to the pixel area (EMVA 1288 Release 4.0 Linear, §2.1, Eq. 3, free). The existing area normalization therefore multiplies conversion gain and saturation by pitch²/36 µm², up to 27 778 at 1000 µm, and the codes stay the same.
- **Noise.** Poisson counts add, so the shot noise of one large pixel equals that of the photosites it replaces, summed. Read noise and dark current are applied once per output pixel, so a whole-frame view understates a real sensor's binned read noise by √n for n photosites. The docs and the assumption both say so. The photon transfer relation σ² = μ_e/K² + σ_read²/K² + 1/12 code² (EMVA 1288 §2) is the test criterion.

Tests (`test/simulate-capture-whole-frame.test.ts`):

1. **ISO area normalization.** At 150, 458, 917 and 1000 µm against 6 µm: each CFA channel's mean RAW code is within half a code plus four standard errors of the reference, and the 8-bit sRGB mean is within one code. At ≥ 917 µm all codes of a channel lie within 2 codes, so the rounded expected value is kept without precision loss. Capacity is 1.67 × 10⁹ e⁻ at 1000 µm. A 64× overexposure clips to the same white codes and the same image at 6 and 1000 µm. Separately, the Poisson sampler's var/mean was 0.997 at 10⁸, 9.99 × 10⁸ and 1.5 × 10⁹, with 200 000 draws each.
2. **Diffraction far smaller than a pixel.** At 917 µm and f/1.4 the capture completes with object-space convolution, a 3 × 3 kernel and finite samples. The centre-cell leakage matches the asymptote 8√2/(π³β) within 0.2 %, and the image changes by under half a code. With f/8 and an explicit radius 2, a uniform field gives a byte-identical image (unit-sum kernels).
3. **Four-spot filter and AHD.** Both are covered by the equivalence test (item 7) and the region test (item 5).
4. **2 × 2 and 4 × 4 box apertures.** Covered by the same equivalence test and the region test.
5. **Region tiles.** Stitched tiles are byte-identical to the whole render at 917 µm (diffraction, four-spot filter, 2 × 2 box, AHD) and at 640 µm (rotation with a rolling shutter).
6. **Noise.** Photon transfer at ISO 12 800, at 150, 458 and 917 µm: the green code variance is within 12 % of the prediction. Signal electrons scale as pitch², so SNR scales with pitch.
7. **Motion and rolling shutter.** 917 µm against 9.17 µm with the same 50 mm-equivalent prime, so every site sees the same direction. The mean 8-bit difference is under 1 code, about the small pitch's own noise. This holds for the point aperture, both box apertures, the four-spot filter, 0.2 rad/s rotation blur over 1/4 s and a rolling shutter, and AHD is under 2.5 codes. Each of these differs from the still point-aperture view by more than 2 codes, so the comparison has power.
8. **WebGPU.** `simulateCapture` runs on the CPU. The optional `webgpu-f32` sensor stage accepts capacities up to 2^24 e⁻, which the tier reaches at 100 µm. Above that it fails closed with `ImageKernelExecutionError` reason `unsupported-float32-domain`, and the `cpu-reference` backend gives the same codes as `simulatePackedSensorRaw`. The convolution, temporal-sum and chart stages do not depend on the pitch.

### Diffraction cells far larger than the pattern

The 2.1 frequency-domain cell quadrature costs O(β²), where β = pitch/(λ·N_w). A 48 × 32 view of a 44 mm frame at f/1.4 with `lens.diffraction` took 296 s (74 s at f/2.8). From β ≥ 192 the same cell energies are now integrated in real space and that view takes 1.0 s. The method:

- **Encircled energy.** The Airy encircled energy is EE(r) = 1 − J₀(x)² − J₁(x)², with x = π·r/(λN_w). It follows from J₀′ = −J₁ and J₁′ = J₀ − J₁/x (DLMF §10.6(i), free).
- **Cells.** Each cell is a signed sum of quadrant rectangles. The energy of each rectangle is a 1-D θ integral of EE, done with 16-point Gauss–Legendre panels that each span at most 2 radians of phase.
- **Bessel functions.** J₀ and J₁ come from the Hankel expansion (DLMF 10.17.3, free) with x ≥ 301 and a remainder under 1 × 10⁻¹⁷ (DLMF §10.17(iii)).

Tests (`test/diffraction-psf-profile.test.ts`):

- The two methods agree within 2 × 10⁻¹² at β = 192–400, radius 1–3.
- Doubling the panel counts changes the real-space cells by under 10⁻¹⁷.
- J₀² + J₁² matches Bessel's integral (DLMF 10.9.2) within 10⁻¹¹ relative.
- The centre-cell leakage approaches 8√2/(π³β).

The threshold lies above every β that a pitch of 100 µm or less reaches (at most 100/(0.3805·1.4) ≈ 188), so those captures keep the 2.1 values. A test confirms that a 100 µm, f/1.4 capture still uses the frequency domain.

### Chart coverage at any distance (`calculateChartFraming`)

The function takes a sensor, a focal length (physical or full-frame-equivalent), a chart and a subject distance, with an optional focus distance. It returns:

- the thin-lens magnification v/d, with v = f·s/(s − f) at the focus distance s;
- the framed plane size;
- the chart's coverage of the frame width and height (above 1 when cropped);
- the chart's image size;
- the generic prime and the minimum-focus check.

It uses the same model and arithmetic as `simulateCapture` and `calculateSubjectDistanceForFraming`. Tests (`test/chart-framing.test.ts`):

- At the fit distance, coverage is 1 on the limiting side for every fit, three sensor shapes and four primes.
- At any distance, the result equals `simulateCapture`'s `result.scene.chart` within 10⁻¹² relative in five cases, including a separate focus distance.
- `belowMinimumFocus` is true exactly where `simulateCapture` with `lens.prime` refuses the request.

## Compatibility

- **Additive:** three root symbols, a wider pitch range, a new assumption above 100 µm, and two new `quadrature.method` values with an optional field.
- **Unchanged for every request 2.4.1 accepted:**
  - A fingerprint of 15 default-path results, taken on this candidate, matched `v2.4.1` byte for byte once the engine version is normalized. It covers 12 `simulateCapture` requests and 3 `simulateIdealReference` requests, and each result is compared whole: samples, RAW codes, encoded bytes, assumptions, plan, request, exposure, scene digest, diagnostics (timings zeroed) and provenance.
  - Every existing hash lock passes unchanged. The two locks that cover a DNG write the Software tag's engine version back to their locked name, as #345 set up, so the version bump needs no test change.
  - The 2.2.x pitch sweeps over 0.5–100 µm pass unchanged.
  - New code runs only for pitches above 100 µm and diffraction cells with β ≥ 192.
- **Direct callers of `createDiffractionLimitedPsfProfile`** with β ≥ 192 (cells over 192 cut-off periods wide) get real-space values. These agree with 2.4.1's within 2 × 10⁻¹², and `quadrature.method` reports the change.

## Rights and licensing

No third-party code, data or constants are added. The Hankel coefficients are computed from their defining product formula (DLMF 10.17.1). No dependency change: `package.json` and `package-lock.json` change only in their version fields.

## Privacy and security

No network, persistence or telemetry is added.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record. Tag it only when its CI is green. Local results on this candidate are recorded in its pull request.

## Remaining release checklist

- [x] The 2.5.0 features merged with their changelog entries (#350, #351), and the CI limit (#348).
- [x] Version surfaces aligned at 2.5.0 (`npm run release:prepare -- 2.5.0`); API reference regenerated (1,717 root symbols; none removed).
- [x] Owner's review of this record.
- [x] Green CI on this pull request (#352), then on `main` after merge ([CI run 888](https://github.com/Photivra/engine/actions/runs/39140433729) on `c5a2a78`, passed at 15:39:47 UTC).
- [x] **The owner's explicit approval to tag `v2.5.0`.** The owner tagged `v2.5.0` on `c5a2a78` at about 15:31 UTC, while `main` CI run 888 on that commit was still running, not after it was green as [Release gates](#release-gates) asks. The Publish npm workflow's verify job ran its own full verification of the tag commit (static and policy gates, coverage gate, build, documentation and packed consumer acceptance, package dry run) and passed; CI run 888 passed at 15:39:47 UTC, before the publish job started at 15:44:48 UTC.
- [x] After publication: npm version, dist-tag, integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record. `docs/DEVELOPERS.md` was made publication-neutral in #352 and points to this record, so it needs no date.

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.5.0` → `c5a2a7836037cad6fb58dd3cd0ef18e5cb51e84f` (#352), pushed at about 15:31 UTC, before `main` [CI run 888](https://github.com/Photivra/engine/actions/runs/39140433729) on that commit passed at 15:39:47 UTC |
| Publish workflow | [Publish npm run 22](https://github.com/Photivra/engine/actions/runs/39140845985), passed (completed 15:45:07 UTC); its verify job ran the full verification of the tag commit and passed at 15:44:45 UTC; the provenance was signed at 15:45 UTC and the registry records publication at 15:47 UTC |
| npm | `@photivra/engine@2.5.0`, dist-tag `latest` |
| Integrity | `sha512-6GD4AqcZOOqWqIaDjHdRakw2CaSOILMJF68BiiZVmevJe4BZyPCjnsXlAUaesz2TvY+0E3nhv6+ldQSIU8aGVQ==` (shasum `994ea89ca76c7d9fdde2cfebb952084e9b596d52`) |
| Provenance | Signed SLSA provenance for `c5a2a78` from `.github/workflows/publish.yml` at `refs/tags/v2.5.0` (Publish npm run 22), published to the Sigstore transparency log (log index 3313347488); `npm audit signatures` verifies the registry signature and the attestation |
| Tarball contents | Byte-identical (same shasum and integrity, 836 files) to `npm pack` of a clean local build of `v2.5.0` (checked October 18, 2026) |
| GitHub release | [@photivra/engine 2.5.0](https://github.com/Photivra/engine/releases/tag/v2.5.0) |
