# 2.0.0 release candidate

> **Published October 17, 2026.** The owner reviewed this record, tagged `v2.0.0` on `a9833ad` and published the GitHub release. npm publishing ran from the tag. See [Publication](#publication). The record below is kept as the release request it was.

## At a glance

- **What is proposed:** publish `@photivra/engine@2.0.0`, with `ENGINE_API_VERSION = "2.0.0"` and `POC_SIMULATION_API_VERSION = "1.0.0"`.
- **Why the version goes from 1 to 2:** the owner directed a single major release containing every fix, optimization and new feature from the 2.0 deep review, including breaking API and schema changes. Some of these changes alter results, stored identities (hashes, seeds) or the input that is accepted. Under the 1.0 root-package compatibility policy, such changes require a major version.
- **What is ready:** all work streams are merged, the version numbers are aligned, the changelog is written, and the citation audit is done.
- **What still needs the owner:** the [pending owner decisions](#pending-owner-decisions), a substantive human review of the AI-assisted changes and of this record, green CI on the exact release commit, and explicit approval to tag `v2.0.0`. See the [remaining release checklist](#remaining-release-checklist).
- **What this release does not claim:** calibrated physical accuracy for any real camera, lens or sensor. Tier presets remain synthetic.

## Candidate details

**Candidate base:** `origin/main` at `34f687d` (#328), the last merged change before this record update. This update also carries three small code changes, reviewed in its own PR: the owner's decision to remove the von Kries HPE transform and the CIECAM02 degree-of-adaptation helper, and a `nativeRaster` input check in `calculateSensorGeometryMetrics`. The tag goes on the `main` commit that merges this update, once its CI is green.

- `npm run release:prepare -- 2.0.0` had already aligned `package.json`, both lockfile root versions, `ENGINE_API_VERSION`, `CITATION.cff`, the current-release lines in `README.md` and `docs/DEVELOPERS.md`, and the generated `docs/api`.
- After the merge, the API reference was regenerated.
- No citation release date is stated before publication.

**All streams merged:** the lean per-site executor (#305), the `simulateCapture()` integration of the 2.0 features (#306) and the native RAW DNG writer (#307) are merged, as are the AGENTS.md reset (#308), the plain-language pass (#309–#312), the agent docs (#313), the free-source citations (#314), the WebGPU completion (#316, #323), strict inputs (#317, #322), the licence cleanup (#318, #320), further native RAW speed-ups (#319), the faster CCT/Duv (#321), the licence guard (#324) and the final review fixes (#325–#328). All are listed in the [changelog](https://github.com/Photivra/engine/blob/main/CHANGELOG.md).

## Scope

Changes since `v1.5.0`, all merged to `main`. In the "Kind" column, *Breaking* means existing users may get different results or errors; *Additive* means new features only; *Performance (bit-identical)* means faster with exactly the same output.

| PR | Issue | Change | Kind |
| --- | --- | --- | --- |
| [#278](https://github.com/Photivra/engine/pull/278) | #274 | Print JPEG pixels-per-inch and mandatory ExifVersion | Fix, additive API |
| [#279](https://github.com/Photivra/engine/pull/279) | #271 | Exact thin-lens depth-of-field limits | Breaking (values) |
| [#280](https://github.com/Photivra/engine/pull/280) | #273 | Capacity assessments bound to their charge; `>=` digital saturation flag | Fix (stricter validation) |
| [#281](https://github.com/Photivra/engine/pull/281) | #272 | Auto-ISO priority modes match exact grid values | Fix |
| [#282](https://github.com/Photivra/engine/pull/282) | #276 | Crop rounding, canonical JSON, result contract, POC server status codes | Breaking (values, strictness) |
| [#283](https://github.com/Photivra/engine/pull/283) | #270 | Independent per-site RAW noise seeding | Breaking (values, identities) |
| [#284](https://github.com/Photivra/engine/pull/284) | #276 | Camera rotation sign; complex-pupil PSF padding and sampling guard | Breaking (values, geometry) |
| [#285](https://github.com/Photivra/engine/pull/285)–[#288](https://github.com/Photivra/engine/pull/288) | #275, #276 | Native path, SDR, JPEG and stabilization speedups; optical-stage reuse | Performance (bit-identical), additive API |
| [#290](https://github.com/Photivra/engine/pull/290) | 2.0 review | ISO-to-gain mapping, fixed-pattern noise, generic presets 2.0.0, noise model 0.4.0 | Breaking (values, schemas) |
| [#291](https://github.com/Photivra/engine/pull/291) | 2.0 review | Colorimetry, chromatic adaptation, Kelvin white balance, wide-gamut transfers (PQ/HLG later removed) | Additive, union widening |
| [#292](https://github.com/Photivra/engine/pull/292) | #275 | Faster native environment RAW, yields between sites | Performance (bit-identical) |
| [#293](https://github.com/Photivra/engine/pull/293) | 2.0 review | Cross-engine determinism, review fixes, POC API 1.0.0, leaner package, input validation | Breaking (values, strictness, package) |
| [#294](https://github.com/Photivra/engine/pull/294) | #275 | Native environment site-plan retention | Performance (bit-identical) |
| [#295](https://github.com/Photivra/engine/pull/295) | 2.0 review | RAW development corrections, tone curves, DNG tags, typed kernel | Breaking (values, contract) |
| [#296](https://github.com/Photivra/engine/pull/296) | 2.0 review | Projections, distortion, axial CA, vignetting, Zernike, PSF interpolation, polarizer, haze | Additive, type widening |
| [#297](https://github.com/Photivra/engine/pull/297), [#301](https://github.com/Photivra/engine/pull/301) | 2.0 review | Rolling-shutter image formation, video, TTL/HSS flash, highlight-priority metering | Additive, union widening |
| [#298](https://github.com/Photivra/engine/pull/298) | 2.0 review | Exif 2.32 tags, JPEG encoder v2, Print JPEG 0.2.0, DNG import, PNG | Breaking (bytes, schema), additive |
| [#299](https://github.com/Photivra/engine/pull/299) | 2.0 review | Coverage, independent oracles, rejection tables | Tests only |
| [#300](https://github.com/Photivra/engine/pull/300) | 2.0 review | `simulateCapture()` facade and chart scenes | Additive |
| [#302](https://github.com/Photivra/engine/pull/302) | 2.0 review | Demosaic, HDR merge, tone mapping, fusion, stacking, panorama, denoise (Malvar–He–Cutler and PQ/HLG later removed) | Additive |
| [#303](https://github.com/Photivra/engine/pull/303) | 2.0 review | Brown–Conrady and projections wired into mapping and environment capture | Additive, type widening |
| [#304](https://github.com/Photivra/engine/pull/304) | #277 | Opt-in WebGPU float32 backend | Additive |
| [#305](https://github.com/Photivra/engine/pull/305) | #275 | Lean per-site executor for native environment RAW | Performance (identical output) |
| [#306](https://github.com/Photivra/engine/pull/306) | — | `simulateCapture()` uses the 2.0 features | Additive |
| [#307](https://github.com/Photivra/engine/pull/307) | — | Native RAW DNG writer, perceptual gamut mapping, PSF throughput rounding fix | Additive, fix |
| [#308](https://github.com/Photivra/engine/pull/308) | — | `AGENTS.md` reset to a short standard file; retired agent rule files | Repository only |
| [#309](https://github.com/Photivra/engine/pull/309)–[#312](https://github.com/Photivra/engine/pull/312) | — | Plain-language source comments and docs | Docs only (comment-stripped build identical) |
| [#313](https://github.com/Photivra/engine/pull/313) | — | `llms.txt`, agent guide and task index for AI agents | Docs, package contents |
| [#314](https://github.com/Photivra/engine/pull/314) | — | Free-source citations, runtime source strings, DC-004 facade exposure anchor, inventory fixes | Breaking (facade default illuminance), text |
| [#315](https://github.com/Photivra/engine/pull/315) | — | Release record: CI on `28f8b61`, owner decisions, DNG licence check | Docs only |
| [#316](https://github.com/Photivra/engine/pull/316) | #277 | WebGPU accuracy contract, sensor stage and temporal exposure sum | Additive |
| [#317](https://github.com/Photivra/engine/pull/317) | #276 | Strict inputs everywhere, read-only results, one rule for error classes | Breaking (strictness, error classes) |
| [#318](https://github.com/Photivra/engine/pull/318), [#320](https://github.com/Photivra/engine/pull/320) | — | Licence cleanup: own CMF fit, Planck-law locus, Malvar–He–Cutler, PQ and HLG removed; caller CIE94 factors; SPDX headers | Breaking (values, removals) |
| [#319](https://github.com/Photivra/engine/pull/319) | #275 | Lean PSF, lens-mapped and pupil sites; worker row-band partitions; batched light sampling | Performance (identical output), additive API |
| [#321](https://github.com/Photivra/engine/pull/321) | — | CCT/Duv by Newton root-find on the analytic derivative | Values (≤ 0.089 K), performance |
| [#322](https://github.com/Photivra/engine/pull/322) | #276 | Strict versioned records: every `parse*()` parser and record-taking function rejects unknown fields | Breaking (strictness) |
| [#323](https://github.com/Photivra/engine/pull/323) | #277 | WebGPU: FPN on the GPU sensor stage, luminance tone curves, PSF-profile kernels, chart radiance, per-fixture rollout | Additive |
| [#324](https://github.com/Photivra/engine/pull/324) | — | Licence guard: ScanCode CI job with a reviewed allowlist; PR-template rights line; free CAT16 citation | CI, docs |
| [#325](https://github.com/Photivra/engine/pull/325) | #277 | WebGPU fixes: tiny-weight error bounds, per-band memory, late-device destroy | Fix (GPU values unchanged) |
| [#326](https://github.com/Photivra/engine/pull/326) | — | Durand–Dorsey zero-luminance pixels; PSF kernel memory and corner lookup | Fix (values), performance (bit-identical) |
| [#327](https://github.com/Photivra/engine/pull/327) | — | CAT02 removed; CCT+Duv domain; strict nested colour and optics records; PNG enums and speed; HDR and chart-point finiteness | Breaking (removal, strictness), performance (byte-identical) |
| [#328](https://github.com/Photivra/engine/pull/328) | — | Sub-object errors; strict nested facade records; scene digest covers spectra; JPEG progress; faster auto white balance; unclamped host yields | Breaking (strictness, digests with caller spectra, JPEG XMP bytes), performance |
| This update | — | Von Kries HPE transform and CIECAM02 degree-of-adaptation helper removed (owner decision); `calculateSensorGeometryMetrics` input check; record refresh | Removal, fix, docs |

Commits #243–#267, between `v1.5.0` and the first review, are guidance, CI, documentation, hooks, `release:prepare` and repository-internal browser-native reference work. They change no public root contract. The full release notes, with a migration for each breaking change, are in the [changelog](../CHANGELOG.md).

## Science evidence

How to read this section: each entry names one change, the model and version it uses, the accepted science and sources behind it, and the committed deterministic tests that check it.

- Free sources are preferred, following the [citation audit](#citation-audit-free-sources). A paid standard appears only as "also specified in", or where no free equivalent was found.
- Nothing in this release establishes calibrated physical accuracy for any real camera, lens or sensor. Tier presets remain synthetic.

### RAW noise seeding (#283) and noise model (#290)

- **Model and version:** `photivra-native-raw-noise` 0.4.0; seed schedule v2; charge realization 3.0.0; RAW code 4.0.0.
- **Accepted science and sources:**
  - Linear camera model and photon-transfer noise of EMVA Standard 1288 Release 4.0 (free from emva.org): Poisson signal electrons, independent Gaussian read noise, gain, quantization.
  - Also see: J. R. Janesick, *Photon Transfer* (SPIE, 2007).
  - Poisson sampling by Hörmann's PTRS (1993) and Box–Muller (1958), with the normal approximation for very large means (NIST/SEMATECH e-Handbook §1.3.6.6.19 and SOCR, University of Michigan, free; also see Johnson, Kemp & Kotz, *Univariate Discrete Distributions*, 3rd ed.).
  - Seeds from the public-domain MurmurHash3_x86_32/`fmix32`. Independence is shown statistically.
- **Evidence in the repository:** `test/sensor-raw-noise-independence.test.ts` (Poisson mean/variance, spatial and cross-seed independence within pre-declared 5σ bands; the old schedule fails at lag correlation 0.84), `test/sensor-readout-v2.test.ts`.

### ISO-to-gain and fixed-pattern noise (#290)

- **Model and version:** `createIsoGainReadoutRegimes`; `photivra-sensor-fixed-pattern` 1.0.0; expected readout 2.0.0.
- **Accepted science and sources:**
  - Exposure index S = 10/H and focal-plane exposure H = 0.65·L·t/N² from CIPA DC-004-2020 (free; also ISO 12232:2019).
  - EMVA 1288 Release 4.0: system gain K, PRNU, DSNU, linearity, dark current versus temperature. (PRNU and DSNU are the pixel-to-pixel variations in response to light and in dark signal.)
  - Exponential dependence of dark current on temperature: EMVA 1288 Release 4.0 Linear §3.2 (free); also see Janesick (2007).
  - Dual conversion gain is a declared per-mode read noise, never derived from S.
- **Evidence in the repository:** `test/iso-brightness.test.ts`, `test/sensor-readout-v2.test.ts`, `test/independent-radiometric-oracle.test.ts` (independent camera-equation RAW oracle).

### Depth of field and defocus (#279, #293)

- **Model and version:** `thin-lens-depth-of-field` 1.1.0; defocus circle 1.1.0.
- **Accepted science and sources:** exact thin-lens limits from the blur-circle condition; J. E. Greivenkamp, OPTI-502 course notes, sec. 12 (free); also see S. F. Ray, *Applied Photographic Optics*, 3rd ed. (2002). The defocus closed form is an algebraic rearrangement of the same model. Geometric only.
- **Evidence in the repository:** `test/optics.test.ts` (exact rational references, a property test with 300+ cases, hyperfocal cases).

### Camera rotation sign (#284)

- **Model and version:** rotation and stabilization models 2.0.0.
- **Accepted science and sources:** right-hand-rule rigid rotation with standard rotation matrices. The camera basis is left-handed, so the physical matrix is the transpose of the component Rodrigues form.
- **Evidence in the repository:** `test/camera-rotation-sign-consistency.test.ts`.

### Complex-pupil PSF sampling (#284, #293)

PSF = point-spread function: the pattern a lens makes from a single point of light.

- **Model and version:** complex-pupil PSF 2.0.0.
- **Accepted science and sources:**
  - Incoherent PSF = \|FT{pupil}\|², OTF cutoff D/(λz), Nyquist Q = λN/pitch ≥ 2: MIT OpenCourseWare 2.71 lecture 22 and Ban et al., arXiv:2511.06936 (free); also see J. W. Goodman, *Introduction to Fourier Optics*, 4th ed. (2017).
  - Q notation from Fiete, *Opt. Eng.* 38(7) (1999).
  - The no-wrap condition M ≥ 2S − 1 follows from DFT circular convolution.
- **Evidence in the repository:** `test/lens-psf-framework.test.ts` (Dirichlet kernel, analytic Airy comparison, support rejection).

### Cross-engine determinism (#293)

The aim: the same inputs give bit-identical stored results in every JavaScript engine.

- **Model and version:** crop models 2.0.0; 35 mm crop factor.
- **Accepted science and sources:** IEEE 754-2019 §5.4 requires correct rounding of +, −, ×, ÷ and sqrt. ECMA-262 §21.3.2 leaves `Math` functions approximated by each implementation. Hashed paths therefore use only correctly rounded operations and portable kernels.
- **Evidence in the repository:** `test/portable-math.test.ts`, `test/crop-integer-rounding.test.ts`, the POC hash corpus, and the macOS hash-lock CI job.

### Colorimetry (#291)

- **Model and version:** `COLORIMETRY_MODEL_VERSION` 2.0.0.
- **Accepted science and sources:**
  - Analytic colour-matching functions (CMFs): the engine's own fit to the CIE 1931 2° data (labelled approximation); see "Licence cleanup" below.
  - Planck's law (BIPM *Mise en pratique* for the kelvin, Absolute Primary Radiometry, Eq. 1, free) with exact SI constants (BIPM SI Brochure, 9th ed., free).
  - Illuminant A: Planck's law with the CIE's constants c₂ = 1.435e-2 m·K and T = 2848 K; it reproduces the free CIE 1 nm table to its rounding. Daylight locus and M₁/M₂: accepted by the owner (2026-10-17) on the evidence of the free CIE D55 and D65 datasets, which the engine's values reproduce to their rounding.
  - Tristimulus integral: Wyman, Sloan & Shirley 2013, Eq. 1 (free).
  - CIE94: the formula's published reference conditions (k_L = k_C = k_H = 1, K₁ = 0.045, K₂ = 0.015) by default, or caller-supplied factors; the primary CIE 116-1995 is not free. Checked by closed-form cases computed in the test.
  - RGB↔XYZ matrices: derived from the ITU-R BT.709-6 / BT.2020-2 and CSS Color 4 primaries and D65; equal to the W3C CSS Color 4 matrices within 1e-12.
  - Planckian locus: Planck's law integrated against the engine's CMFs. McCamy, *Color Res. Appl.* 17(2) (1992), with its measured deviation documented.
  - CCT/Duv (correlated colour temperature and distance from the Planckian locus): Smet et al., LEUKOS 2023 (free DOE copy). Duv sign (positive above the locus): Ohno, CORM 2011 slides (free), slide 5; the engine documents and tests it.
  - Chromatic adaptation: Lam (1985), ICC.1:2010 Annex E (free, permissive ICC licence; the Bradford test follows it); CAT16 from Li et al., IS&T CIC24 2016, Eq. (15) (free; all nine coefficients checked), journal version *Color Res. Appl.* 42(6) (2017). CAT02, the von Kries HPE matrix and the CIECAM02 formula for D were removed (owner decisions, 2026-10-17): no free source we could confirm prints them. D is caller-supplied (default 1).
  - CIELAB: W3C CSS Color 4. CIEDE2000: Sharma, Wu & Dalal 2005 (free implementation notes; their test pairs are not used).
  - Camera matrix fit: Finlayson & Drew, CIC5 1997.
  - Gamut mapping: CSS Color 4 §14 (free); also see Morovič 2008.
  - Transfers: ITU-R BT.709-6, BT.1886, BT.2020-2 (free) and CSS Color 4 sRGB. PQ and HLG were removed (see Rights and licensing).
- **Evidence in the repository:** `test/colorimetry.test.ts`, `test/colorimetry-output-and-camera.test.ts` (CIEDE2000 closed-form cases, ICC Annex E Bradford construction, ITU-R luminance rows; no CIE table values).

### RAW development (#295)

- **Model and version:** development output and DNG tags.
- **Accepted science and sources:**
  - DNG Specification 1.7.1.0 (free): WhiteLevel, BlackLevel/ActiveArea origin, AsShotNeutral, ForwardMatrix1, BaselineExposure, NoiseProfile, AnalogBalance.
  - EMVA 1288 saturation point.
  - Tone curves: Reinhard et al., SIGGRAPH 2002; Naka & Rushton, *J. Physiol.* 185 (1966); Reinhard & Devlin, IEEE TVCG 11(1) (2005).
  - Highlight reconstruction is an approximation defined by the engine, informed by Guo, Cheng & Hu, CVPR 2010.
- **Evidence in the repository:** `test/raw-white-level.test.ts`, `test/photographic-export-development.test.ts`, `test/native-sdr-quantizer.test.ts`, `test/processing-raw-development-borders.test.ts`.

### Optics (#296, #303)

- **Model and version:** projections, Brown–Conrady, axial CA (chromatic aberration), vignetting, wavefronts, polarizer (filter schema 0.2.0), haze; mapping schema 0.2.0; environment photo-signal 0.4.0 when a mapping is present.
- **Accepted science and sources:**
  - Projections: Kannala & Brandt, IEEE TPAMI 28 (2006, free author copy); Snyder, USGS PP 1395 (1987, free); Miyamoto, JOSA 54 (1964).
  - Distortion: Conrady, MNRAS 79 (1919); Brown (1966, 1971).
  - Vignetting: cos⁴ and finite Lambertian disk (Foote 1915); cos⁴ and mechanical vignetting also in Greivenkamp, OPTI-502 course notes, sec. 10–11 (free); also see Kingslake & Johnson.
  - Wavefronts: Noll, JOSA 66 (1976); Mahajan, JOSA 72 (1982); Maréchal.
  - Dispersion: Cauchy/Abbe (Oh 2023, arXiv:2309.09375; Greivenkamp, OPTI-502 sec. 17 and 20; both free; also see Hecht; Born & Wolf); line wavelengths from SCHOTT TIE-29 (free).
  - Polarizer: Malus's law and Mueller matrices (OpenStax *University Physics* Vol. 3 §1.7; Gil, arXiv:2002.04105; both free; also see Chipman; Goldstein).
  - Haze: Koschmieder 1924; Middleton 1952; WMO-No. 8 (free).
  - The irradiance area factor 1/det J follows from flux conservation.
- **Evidence in the repository:** `test/lens-projection.test.ts`, `test/brown-conrady-distortion.test.ts`, `test/pupil-vignetting.test.ts`, `test/wavefront-aberrations.test.ts`, `test/lens-psf-interpolation.test.ts`, `test/front-of-lens-polarizer.test.ts`, `test/haze-and-geometric-breathing.test.ts`, `test/lens-geometry-wiring.test.ts`, `test/lens-field-mapping-environment.test.ts`, `test/optics-validator-extrema.test.ts`.

### Rolling shutter, video, flash, metering (#297)

- **Model and version:** `electronic-rolling-shutter-line-reset-read` 1.0.0; `flash-hss-quasi-continuous-burst` 1.0.0; flash sync schema 0.2.0; metering 1.1.0.
- **Accepted science and sources:**
  - Rolling shutter: El Gamal & Eltoukhy (2005); Liang, Chang & Chen, IEEE TIP 17(8) (2008); Meingast, Geyer & Sastry (2005, arXiv:cs/0503076, free); Ait-Aider et al., ECCV 2006.
  - Flicker: Poplin (2006). Modulation at twice the mains frequency follows from P ∝ sin²ωt.
  - Shutter angle: ASC *American Cinematographer Manual*.
  - Guide number GN = d·N, from the inverse-square law (NIST SP 250-37, free) and the camera equation (Greivenkamp, OPTI-502 sec. 11, free); also see Ray 2002; Jacobson et al. 2000.
  - HSS (high-speed sync) √(η·t_e/D) is derived and labelled an approximation.
  - TTL (through-the-lens flash metering) is a generic linear pre-flash solution.
  - Highlight priority: Hyndman & Fan (1996) quantiles.
- **Evidence in the repository:** `test/rolling-shutter-image-formation.test.ts`, `test/video-sequence.test.ts`, `test/flash-ttl-hss.test.ts`, `test/highlight-priority-metering.test.ts`.

### Export formats (#298)

- **Model and version:** Print JPEG 0.2.0; encoder `photivra-baseline-jpeg-444-v2`; `photivra-png-rgb-v1`; DNG import 1.0.0.
- **Accepted science and sources:**
  - Exif 2.32 (CIPA DC-008, free): mandatory tags and defaults.
  - ITU-T T.81 (free): DCT definition, Huffman coding, Annex H lossless.
  - DNG 1.7.1.0 and TIFF 6.0 (free).
  - W3C PNG Third Edition (free): cICP, mDCV, cLLI, sRGB gAMA/cHRM; RFC 1950/1951; ITU-T H.273 code points.
  - DCT cosines are mathematical values computed by the engine.
- **Evidence in the repository:** `test/export-jpeg-v2.test.ts` (independent reference encoder), `test/print-jpeg-strip-identity.test.ts`, `test/dng-import.test.ts`, `test/png-encoder.test.ts` (layouts cross-checked with Pillow).

### Processing (#302)

- **Model and version:** opt-in tasks; no change to the default path.
- **Accepted science and sources:** Hirakawa & Parks, IEEE TIP 14(3) (2005); Gunturk et al. (2005); Granados et al. and Hasinoff et al., CVPR 2010; Reinhard et al. and Durand & Dorsey, SIGGRAPH 2002; Mertens et al., PG 2007; Burt & Adelson (1983); Nayar & Nakagawa (1994); Brown & Lowe, IJCV 2007; Tomasi & Manduchi, ICCV 1998; Buades et al., CVPR 2005 and IPOL 2011 (free). Film grain is explicitly synthetic.
- **Evidence in the repository:** `test/processing-*.test.ts` (seven files). The Malvar–He–Cutler demosaic and the PQ/HLG encodings were removed before release (see Rights and licensing); `createHdrImageEncodingTask` outputs float32 linear BT.2020 only.

### `simulateCapture()` (#300)

- **Model and version:** facade 1.0.0.
- **Accepted science and sources:**
  - Composes existing models.
  - Exposure anchor by CIPA DC-004-2020 (free): standard output sensitivity S = 10/H and the camera equation H = 0.65·L·t/N², with the 18 % grey as the reference. The default illuminance is π·10·N²/(0.65·t·S·0.18) ≈ 21 480.98 lux.
  - Luther condition (Luther 1927).
  - Slanted-edge geometry after Burns, IS&T PICS 2000 (free).
  - K_cd = 683 lm/W (BIPM SI Brochure).
- **Evidence in the repository:** `test/simulate-capture.test.ts`, `test/chart-scenes.test.ts`.

### WebGPU backend (#304)

- **Model and version:** `webgpu-f32` execution label; irradiance convolution schema 0.1.0.
- **Accepted science and sources:**
  - Incoherent imaging as linear superposition with isoplanatic patches (MIT OpenCourseWare 2.71 lecture 22; van de Ketterij et al., arXiv:2011.01738; both free; also see Goodman 2017 §6.1); piecewise shift-invariant optics (Farrell et al., Proc. SPIE 8299, 2012).
  - Float32 forward-error bounds γ_k (Rump & Jeannerod, SIAM J. Matrix Anal. Appl. 35(2), 2014, free author copy; also see Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., §2–3); IEEE 754 binary32; W3C WGSL accuracy rules (free).
  - Never claimed bit-identical.
- **Evidence in the repository:** `test/image-kernel-accelerator.test.ts` (fake device), `test/webgpu/conformance.webgpu.ts` (real device, repository-only).

### WebGPU sensor stage and temporal exposure sum (#277)

- **Model and version:** packed sensor RAW schema 0.1.0 (noise model `photivra-native-raw-noise` 0.4.0, unchanged); temporal exposure sum schema 0.1.0; new execution label `exact-except-flagged-sites`.
- **Accepted science and sources:**
  - Sensor stage: no new science. It is the per-site producer's model on typed arrays, bit-identical to `calculateNativeRawSite` (tested).
  - Exposure as the time integral of the rate over each site's window (EMVA 1288 Release 4.0 Linear §2; CIPA DC-004 §5.5; both free). Motion blur as a superposition of displaced images (Szeliski 2022, free from the author). Rolling shutter as row-dependent windows (Meingast, Geyer & Sastry, arXiv:cs/0503076, free).
  - Bilinear sub-site shifts, rigid translation and caller-owned quadrature weights are labelled approximations.
- **Evidence in the repository:** `test/packed-sensor-raw.test.ts`, `test/temporal-exposure-sum.test.ts` (fake device), `test/webgpu/stages.webgpu.ts` (real device, repository-only; SwiftShader: no unflagged site differed, and temporal error stayed within its bound). No hardware-GPU timings were measured.

### Native RAW DNG (#307)

- **Model and version:** `NATIVE_RAW_DNG_SCHEMA_VERSION` 1.0.0.
- **Accepted science and sources:** Adobe DNG Specification 1.7.1.0 (free): tag semantics; BlackLevel/CFAPattern origin at the ActiveArea top-left (confirmed in the spec text); NoiseProfile definition. EMVA 1288 (free): shot, read and quantization noise.
- **Evidence in the repository:** `test/native-raw-dng.test.ts` (round trip through `parseDngRawImage`); LibRaw decode recorded in #307.

### Facade gamut mapping (#307)

- **Model and version:** —
- **Accepted science and sources:** CIELAB chroma reduction at constant L* and hue (W3C CSS Color 4 §14, free; also see Morovič 2008).
- **Evidence in the repository:** `test/simulate-capture-integration.test.ts`.

### Fixes and validation (#280, #281, #282, #293)

- **Model and version:** no physics change.
- **What they are:** consistency, tolerance, serialization and validation fixes.
- **Evidence in the repository:** `test/sensor-raw-pipeline.test.ts`, `test/priority-auto-iso-resolver.test.ts`, `test/canonical-json.test.ts`, `test/root-export-input-errors.test.ts`, the `*-rejections.test.ts` tables.

### Performance (#285–#288, #292, #294)

- **Model and version:** no model, equation or unit change.
- **What they are:** speed-ups with bit-identical output.
- **Evidence in the repository:** `test/native-environment-bit-identity.test.ts`, `test/native-environment-shared-state.test.ts`, `test/environment-photo-plan-retention.test.ts`, `test/native-capture-sdr-kernel-parity.test.ts`, `test/export-jpeg-byte-identity.test.ts`, `test/stabilization-evaluation-identity.test.ts`, `test/native-yield-cadence.test.ts`, `test/native-environment-optical-stage.test.ts`.

### Licence cleanup: own CMF fit and Planck-law locus (owner decision 2026-10-17)

- **Model and version:** `COLORIMETRY_MODEL_VERSION` 2.0.0. This replaces the CMF and Planckian-locus sources listed under Colorimetry (#291).
- **CMFs:** the engine's own least-squares fit of a sum of split Gaussians (the model form of Wyman, Sloan & Shirley 2013, free; none of its coefficients) to the CIE 1931 2° table, DOI 10.25039/CIE.DS.xvudnb9b, used at fit time only (`scripts/fit-cie-1931-cmf.mjs`). Measured maximum / RMS error against the table: x̄ 0.0122 / 0.00426, ȳ 0.00733 / 0.00265, z̄ 0.0221 / 0.00397, each at or below the Wyman coefficients' 0.0140 / 0.00559, 0.00800 / 0.00267 and 0.0222 / 0.00399. Labelled approximation.
- **Planckian locus:** chromaticity of Planck's law (BIPM *Mise en pratique* for the kelvin, free; exact c₂ = hc/k, CODATA) integrated against those CMFs on 1 nm nodes, 1000–100000 K. Against a locus integrated with the CIE table it is within 2.83e-4 in uv from 2856 to 25000 K (1.05e-3 at 1667 K). The CCT/Duv search uses it by default.
- **Evidence in the repository:** `test/colorimetry.test.ts` (non-negative, equal-area CMFs with a unit ȳ peak near 555 nm; monotonic locus equal to the explicit Planck integral; illuminant A as a Planckian radiator; McCamy within 20 K over 2856–6504 K; CCT/Duv round trips; Duv sign; CIEDE2000 closed forms), `test/colorimetry-output-and-camera.test.ts`, re-pinned digests in `test/simulate-capture-integration.test.ts`. Numbers and method in `docs/COLORIMETRY.md`. The tests contain no CIE table values.

### CCT/Duv root-find (owner approval 2026-10-17)

- **Model and version:** same CCT/Duv definition and locus; only the numerical method changes. No new science source: the derivative of Planck's law with respect to T is exact calculus of the cited law.
- **Method:** the root of the analytic d(uv distance²)/dT by safeguarded Newton iteration, converged to 1e-10 of T; analytic locus normal for Duv and the inverse.
- **Evidence in the repository:** `test/colorimetry.test.ts` (agreement with the 50-digit reference in `test/fixtures/planckian-cct/`, tight round trips at both range limits, monotonicity, fail-closed limits, Duv sign). Measured CCT change up to 0.089 K (1.2e-6 relative) above 50000 K, 6.0e-3 K below 25000 K; 11.7× faster. Numbers and method in `docs/COLORIMETRY.md`.

## Citation audit (free sources)

The owner's rule is that releases rely only on free-to-use sources. Every paid or paywalled standard cited by 2.0 work is listed below, with the free source used instead.

Free standards bodies and documents already in use need no change: CIPA (DC-003, DC-004, DC-008), ITU-R and ITU-T recommendations, EMVA 1288, the Adobe DNG and TIFF 6.0 specifications, ICC specifications, W3C recommendations, IETF RFCs, the BIPM SI Brochure, and the CIE free datasets.

In the Status column: **Replaced** means a free source now backs the fact. **Removed** means the engine no longer depends on the paid source: the fact is derived in the documentation or stated as the engine's own convention. **Accepted** means no free text of the formula exists, and the owner accepted it on free evidence (see [pending owner decisions](#pending-owner-decisions)).

| Paid source | Fact used | Free replacement | Status |
| --- | --- | --- | --- |
| ISO 12232:2019 | Exposure index S = 10/H; H ∝ 1/S; H = 0.65·L·t/N² | CIPA DC-004-Translation-2020, *Sensitivity of Digital Cameras*, §3.2–3.3 and §5.5 — <https://www.cipa.jp/e/std/std-sec.html> | Replaced |
| ISO 12232:2019 | Saturation-based speed S_sat = 78/H_sat (test oracle, Quick Start remark, highlight-priority headroom remark) | Removed. The ISO-brightness test now uses the CIPA DC-004-2020 standard output sensitivity H_m = 10/S (§3.2), whose reference level is an 18 % grey (§5.2, Explanation 1 and 2.2), so mid-grey is 0.18 of the white exposure — <https://www.cipa.jp/e/std/std-sec.html>. The Quick Start and highlight-priority remarks cite DC-004 and state the half-stop headroom as the engine's own documented choice. No engine output changed. | Replaced (owner decision 1) |
| ISO 2720:1974 | Reflected-light meter constant K = 12.5 cd·s/m² (facade exposure anchor) | Removed. The facade uses CIPA DC-004-2020 S = 10/H (§3.2) and H = 0.65·L·t/N² (§5.5 (4), Explanation 4) — <https://www.cipa.jp/e/std/std-sec.html>. This is equivalent to K = 10/0.65 ≈ 15.38. The default illuminance changes from π·12.5·64·125/18 ≈ 17 453.29 lux to π·80 000/11.7 ≈ 21 480.98 lux (recorded in `CHANGELOG.md`). | Replaced (owner decision 2) |
| ISO 12233:2017 | Slanted-edge chart geometry | P. D. Burns, "Slanted-Edge MTF for Digital Camera and Scanner Analysis", IS&T PICS 2000 — <https://www.imaging.org/common/uploaded%20files/pdfs/Papers/2000/PICS-0-81/1621.pdf> | Replaced |
| ISO 2827 | Guide-number measurement | Citation removed. `docs/SCENE_SENSOR_TEMPORAL_EXPOSURE.md` derives GN = d·N, the √p and the √(ISO/100) scaling from the inverse-square law and the DC-004 camera equation. The engine does not model how a guide number is measured; the caller supplies it. | Removed (owner decision 3) |
| ISO 7944 | Fraunhofer d, F, C line wavelengths | SCHOTT Technical Information TIE-29, *Refractive Index and Dispersion* (August 2023) — <https://media.schott.com/api/public/content/aaa572afd854434fb7b3faa4bc46103f> (587.5618, 486.1327, 656.2725 nm confirmed) | Replaced |
| ISO 12234-2 (TIFF/EP) | CFARepeatPatternDim, CFAPattern | Adobe DNG 1.7.1.0 and CIPA DC-008 (Exif CFAPattern) — <https://helpx.adobe.com/camera-raw/digital-negative.html>, <https://www.cipa.jp/e/std/std-sec.html> | Replaced |
| ISO/IEC 10918-1 | JPEG DCT, Huffman, lossless | ITU-T T.81 (identical text) — <https://www.w3.org/Graphics/JPEG/itu-t81.pdf> | Replaced |
| IEC 61966-2-1 | sRGB primaries, transfer and matrix | W3C CSS Color Module Level 4, `srgb` — <https://www.w3.org/TR/css-color-4/>; ICC sRGB registry — <https://registry.color.org/rgb-registry/files/sRGB.pdf>; ITU-R BT.709-6 | Replaced |
| CIE 15:2018 / ISO/CIE 11664-4 | CIELAB with exact ε, κ | W3C CSS Color 4 §9 (Lab) | Replaced |
| CIE 15:2018 / ISO/CIE 11664-1 | Tristimulus integration X = k Σ S R x̄ Δλ | Wyman, Sloan & Shirley 2013, JCGT 2(2), Eq. 1 (X = ∫ L(λ) x̄(λ) dλ; open access, CC BY-ND 3.0) — <https://jcgt.org/published/0002/02/01/paper.pdf>. The quadrature and the normalization k are explicit engine choices. | Replaced (owner decision 4) |
| CIE 15:2018 / ISO/CIE 11664-2 | Illuminant A formula | Planck's law: BIPM *Mise en pratique* for the kelvin, Absolute Primary Radiometry (2018), Eq. 1 — <https://www.bipm.org/utils/en/pdf/si-mep/MeP-K-2018_Absolute_Primary_Radiometry.pdf>. The engine uses the CIE's constants c₂ = 1.435e-2 m·K and T = 2848 K (the exact c₂ = hc/k = 1.438 776 877…e-2 m·K, NIST CODATA 2022, is used only for the Planckian radiator). These two constants have no free source text, but the formula reproduces all 531 values of the free CIE 1 nm table (DOI 10.25039/CIE.DS.8jsxjrsn) within 4.8e-6 relative, the table's rounding. | Replaced (owner decision 4); constants verified for free |
| CIE 15:2018 | Daylight-locus polynomial and M₁/M₂ | No free copy found. The source paper, Judd, MacAdam & Wyszecki, *JOSA* 54(8):1031 (1964), doi:10.1364/JOSA.54.001031, is subscription-only on the publisher's site; the only other copy found was an unauthorized upload. The coefficients were checked against the free CIE datasets: with three-decimal rounding they reproduce D55 within 5.0e-4 and D65 within 8.5e-4 at every 5 nm node (the tables' rounding). **Owner decision (2026-10-17):** accepted on that evidence. The datasets are free to download under CC BY-SA 4.0; they are cited and compared against, never bundled, so the licence does not bind the package (see [Rights and licensing](#rights-and-licensing)). The polynomial coefficients are scientific facts, not licensed material. | Accepted (owner decision); values verified for free |
| CIE 15:2018 | CCT as the nearest Planckian point in (u, v); signed Duv | Smet et al., LEUKOS 2023, doi:10.1080/15502724.2023.2248397; free DOE copy — <https://www.energy.gov/sites/default/files/2023-09/ssl-smet-etal-2023_method-cct-duv-light-source.pdf> | Replaced |
| ANSI C78.377 | Duv sign (positive above the locus) | Y. Ohno, "Calculation of CCT and Duv and Practical Conversion Formulae", slides, CORM 2011 Conference, Gaithersburg, MD, May 3–5, 2011, slide 5: Duv is the closest distance from the Planckian locus "with + sign for above and - sign for below the Planckian locus" (free) — <https://cormusa.org/wp-content/uploads/2018/04/CORM_2011_Calculation_of_CCT_and_Duv_and_Practical_Conversion_Formulae.pdf>. The sign follows these slides; the engine documents it (docs, runtime assumption text) and a test checks that a greenish light gives a positive Duv. Ohno, LEUKOS 10(1), 2014 is not cited: NIST's record of it (<https://www.nist.gov/publications/practical-use-and-calculation-cct-and-duv>) links only to the paywalled publisher copy. | Replaced (owner decision 5) |
| CIE 018:2019 | K_m = 683 lm/W | BIPM SI Brochure, 9th ed., definition of the candela (K_cd = 683 lm/W) — <https://www.bipm.org/en/publications/si-brochure> | Replaced |
| CIE 116-1995 | CIE94 ΔE weights | No free primary source. The engine uses the formula's published reference conditions (k_L = k_C = k_H = 1, K₁ = 0.045, K₂ = 0.015) by default and accepts caller-supplied factors; the textiles preset and the Wikipedia citation were removed (second licence audit, 2026-10-17). The tests check closed-form cases computed from the equations. | Replaced (owner decision 6; second audit) |
| CIE 142-2001 / ISO/CIE 11664-6 | CIEDE2000 | Sharma, Wu & Dalal (2005) implementation notes — <https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/>; CSS Color 4 `deltaE2000`. Their test data file has no licence, so it is not used; the tests check closed forms instead. | Replaced |
| CIE 159:2004 | CAT02 and HPE matrices; degree of adaptation D | Not applicable: CAT02, the von Kries HPE transform and the CIECAM02 degree-of-adaptation helper were removed from 2.0. The free CAT16 paper (Li et al., IS&T CIC24 2016) names M02 and M_HPE but prints neither matrix nor the D formula, and the free RIT copy of Moroney et al. (2002) sits behind a bot check, so it could not be confirmed. | Removed (owner decisions, 2026-10-17) |
| SMPTE ST 2084 | PQ EOTF and constants | Not applicable: PQ and HLG were removed from 2.0 (patent declarations are licence-on-request only) | Removed (owner decision) |
| SMPTE ST 2086 | Mastering display colour volume fields | W3C PNG Third Edition `mDCV` — <https://www.w3.org/TR/png-3/>; ITU-T H.265 Annex D SEI — <https://www.itu.int/rec/T-REC-H.265> | Replaced |
| CTA-861.3 | MaxCLL/MaxFALL | W3C PNG Third Edition `cLLI`; ITU-T H.265 Annex D content light level SEI | Replaced |
| SMPTE EG 432-1 | Display P3 primaries with D65 | W3C CSS Color 4 `display-p3`; ITU-T H.273 ColourPrimaries 12 — <https://www.itu.int/rec/T-REC-H.273> | Replaced |
| SMPTE RP 177-1993 | Deriving RGB↔XYZ matrices from primaries and white | W3C CSS Color 4 (method and matrices, §2, §11 and §19) — <https://www.w3.org/TR/css-color-4/>; ITU-R BT.709-6 and BT.2020-2 (primaries, D65 and luminance coefficients) — <https://www.itu.int/rec/R-REC-BT>. The derivation is written out in `docs/COLORIMETRY.md`, and a test shows the engine's matrices equal the CSS Color 4 matrices within 1e-12 (largest difference 1.8e-15). | Replaced (owner decision 7) |
| IEEE Std 1789-2015 | Lamps modulate at twice the mains frequency | Follows from P ∝ sin²ωt = (1 − cos 2ωt)/2; context on the US DOE flicker pages — <https://www.energy.gov/eere/ssl/flicker> | Replaced |

**What changed:** doc comments in `src/`, and the reference lists in `docs/` and `THIRD_PARTY.md`, now cite the free source first. The paid standard is kept only as "also specified in".

**Runtime strings (owner decision).** Provenance `sources` arrays, `assumptions` text and error messages that named paid standards now name the free sources above. This is a text-only output change; no number changed. Limitation and error strings that used internal ticket numbers as model names (#12, #14, #85, #110) now use the model names. See `CHANGELOG.md`. Test comments are not shipped and were left as they were. The result model id `rgb-xyz-matrix-smpte-rp177` of `calculateRgbToXyzMatrices` is an identifier, not a citation, and was not renamed.

**Resolved:** no flagged items remain. The CIE daylight locus and M₁/M₂ were accepted by the owner on the evidence of the free CIE datasets.

## Free sources for textbook citations

The owner's free-sources rule also covers paid textbooks. For each fact a paid book was cited for, a free source that states the same fact was found, read and added first. The book is kept as "also see". The change is limited to `docs/` and `src/` comments; runtime strings, tests and the standards rows above are unchanged.

"Free" here means free to read online. Two of the sources are author-hosted copies of copyrighted work (Wyant & Creath; Rump & Jeannerod), and the course notes are copyrighted by their authors or institutions. Only facts are cited; nothing is copied.

| Book (also see) | Fact cited | Free source added (checked October 17, 2026) |
| --- | --- | --- |
| Goodman, *Introduction to Fourier Optics* | Incoherent output intensity = input intensity convolved with the intensity PSF; intensity PSF = \|coherent PSF\|²; OTF = autocorrelation of the pupil (ATF), cutoff twice the coherent one | MIT OpenCourseWare 2.71 *Optics* (Spring 2009), lecture 22 — <https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/> |
| Goodman | DFT pupil sampling N·d_p = λf/d_c; sampling factor Q = λF/d_c; Nyquist needs Q ≥ 2 | Ban et al., "Mock Observations for the CSST Mission", arXiv:2511.06936, eqs. 6–9 — <https://arxiv.org/abs/2511.06936> |
| Goodman | A field-varying PSF treated as constant within isoplanatic subsections | van de Ketterij, Soloviev & Verhaegen, arXiv:2011.01738, sec. 1 — <https://arxiv.org/abs/2011.01738> |
| Goodman; Mahajan, *Optical Imaging and Aberrations* | Defocus dz at f-number N gives an edge-of-pupil wavefront of dz/(8N²) | Wyant & Creath, "Basic Wavefront Aberration Theory for Optical Metrology", *Applied Optics and Optical Engineering* XI (1992), ch. 1, eq. 18 (author copy) — <https://wp.optics.arizona.edu/jcwyant/wp-content/uploads/sites/13/2016/08/03-BasicAberrations_and_Optical_Testing.pdf>. The same chapter gives Strehl ≈ exp(−(2πσ)²), eq. 67. |
| Born & Wolf, *Principles of Optics* | Zernike radial polynomial R_n^m in Noll's nomenclature | Mathar, "Zernike Basis to Cartesian Transformations", arXiv:0809.2368, eq. 1 — <https://arxiv.org/abs/0809.2368> |
| Born & Wolf; Hecht, *Optics* | Two-term Cauchy dispersion n(λ) = A + B/λ² | Oh, Tufts PhD dissertation (2023), arXiv:2309.09375, sec. 2.3.1(b), eq. 2.61 — <https://arxiv.org/abs/2309.09375> |
| Hecht | Abbe number V_d = (n_d − 1)/(n_F − n_C) | Greivenkamp, *OPTI-502 Optical Design and Instrumentation I*, University of Arizona (2019), sec. 17 — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-17-Materials.pdf>; also SCHOTT TIE-29, eq. 3 |
| Hecht; Kingslake & Johnson, *Lens Design Fundamentals* | Singlet axial colour f_C − f_F ≈ f_d/V_d | Greivenkamp, OPTI-502, sec. 20 — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-20-Chromatic-Effects.pdf> |
| Kingslake & Johnson; Ray, *Applied Photographic Optics* | Paraxial thin-lens imaging; nodal points at the principal planes when object and image space are both air | Greivenkamp, OPTI-502, sec. 3 and sec. 5 (p. 5-24) — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-03-Imaging-with-a-Thin-Lens.pdf>, <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-05-Gaussian-Imagery.pdf> |
| Slater, *Photographic Systems for Engineers*; Kingslake & Johnson; Ray | Image irradiance falls off as cos⁴ of the field angle; camera equation E ∝ L/(f/#)² | Greivenkamp, OPTI-502, sec. 11 — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-11-Radiative-Transfer.pdf> |
| Kingslake & Johnson; Smith, *Modern Optical Engineering* | Mechanical vignetting: the off-axis bundle stays circular, centred on the chief ray, and is clipped by the other apertures | Greivenkamp, OPTI-502, sec. 10 — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-10-Vignetting.pdf> |
| Ray | Exact thin-lens depth-of-field limits from the image-plane blur criterion | Greivenkamp, OPTI-502, sec. 12 — <https://wp.optics.arizona.edu/jgreivenkamp/wp-content/uploads/sites/11/2019/08/502-12-Objectives.pdf> |
| Kingslake, *A History of the Photographic Lens*; Ray | Rectilinear, stereographic, equidistant, equisolid-angle and orthographic mapping functions | Kannala & Brandt (IEEE TPAMI 2006), author copy, eqs. 1–5 — <https://users.aalto.fi/~kannalj1/calibration/Kannala_Brandt_calibration.pdf> |
| Chipman, *Handbook of Optics*; Goldstein, *Polarized Light*; Born & Wolf | Mueller matrix of a linear diattenuator, and its rotation | Gil, "Polarimetric characterization of light and media", arXiv:2002.04105, eqs. 134–135 — <https://arxiv.org/abs/2002.04105> |
| Chipman; Goldstein | Malus's law I = I₀ cos²θ | OpenStax, *University Physics* Vol. 3, sec. 1.7 (CC BY 4.0) — <https://openstax.org/books/university-physics-volume-3/pages/1-7-polarization> |
| Janesick, *Photon Transfer* | Dark current rises roughly exponentially with temperature (doubling interval T_d) | EMVA 1288 Release 4.0 Linear, §3.2 — <https://www.emva.org/wp-content/uploads/EMVA1288Linear_4.0Release.pdf> |
| Janesick | Shot noise is Poisson: variance equals the mean electron count | EMVA 1288 Release 4.0 Linear, §2.4 (same URL) |
| Johnson, Kemp & Kotz, *Univariate Discrete Distributions* | Poisson skewness 1/√μ | NIST/SEMATECH *e-Handbook of Statistical Methods*, §1.3.6.6.19 — <https://www.itl.nist.gov/div898/handbook/eda/section3/eda366j.htm> |
| Johnson, Kemp & Kotz | Normal approximation to the Poisson for large means, with continuity correction | SOCR, University of Michigan — <https://wiki.socr.umich.edu/index.php/AP_Statistics_Curriculum_2007_Limits_Norm2Poisson> |
| Higham, *Accuracy and Stability of Numerical Algorithms* | γ_n = nu/(1 − nu), the classical factor in error bounds for floating-point sums and inner products | Rump & Jeannerod, *SIAM J. Matrix Anal. Appl.* 35(2) (2014), sec. 1 (author copy) — <https://www.tuhh.de/ti3/paper/rump/RuJea13.pdf> |
| Jacobson et al., *The Manual of Photography*; Ray | Guide number GN = d·N | Partial; see below. |
| Morovič, *Color Gamut Mapping* | Constant-lightness, constant-hue chroma reduction | W3C CSS Color Module Level 4, gamut-mapping section — <https://www.w3.org/TR/css-color-4/> (already cited; Morovič is now "also see") |

**Facts with no free source found:**

- **Guide number GN = d·N** (Jacobson et al.; Ray). No free source states the relation itself. Both of its parts are freely sourced: the inverse-square law (NIST SP 250-37, <https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication250-37.pdf>) and the camera equation (Greivenkamp, OPTI-502 sec. 11). The relation follows by algebra. The guide-number measurement procedure stays with ISO 2827, in the audit above.

**Not changed:**

- Test comments (`test/independent-radiometric-oracle.test.ts` and `test/native-environment-bit-identity.test.ts` cite Smith and Hecht for the camera equation; `test/sensor-raw-noise-independence.test.ts` cites Janesick). Test comments are not shipped, and tests are out of scope here. Greivenkamp OPTI-502 sec. 11 and EMVA 1288 §2.4 are free sources for those facts.
- `CHANGELOG.md` names "Goodman sampling Q > 2" in a dated entry. Ban et al. above is the free source.
- Paywalled journal papers that are not textbooks (for example Noll 1976, Mahajan 1982, Miyamoto 1964, Fiete 1999) are outside this pass.

## Rights and licensing

- **No CIE tables bundled.** The CIE 1931 colour-matching-function and daylight-component datasets are licensed CC BY-SA 4.0 (dataset metadata, e.g. DOI 10.25039/CIE.DS.xvudnb9b). ShareAlike is incompatible with Apache-2.0-only distribution. The engine therefore uses its own analytic CMF fit and tables supplied by the caller. The fit script downloads the CIE 1931 table into a temporary directory at fit time only; no CIE value is in the repository, the package or the tests (owner decision, 2026-10-17). The docs cite CIE datasets as external evidence with comparison numbers we computed. No ColorChecker or other reflectance data is included.
- **Removed by owner decision (2026-10-17):** the Wyman, Sloan & Shirley (2013) CMF coefficients (paper CC BY-ND 3.0), replaced by the engine's own fit; and the Kim/Kang et al. (2002) Planckian-locus cubic-spline coefficients (also claimed in US 7,024,034, which the USPTO record lists as lapsed on April 4, 2018), replaced by Planck's law integrated against the engine's CMFs. No coefficient of either set and no patent text remains in `src/`.
- **Patent review of 2.0 algorithms (2026-10-17):** see the new section of the same name in `THIRD_PARTY.md`. The Malvar–He–Cutler demosaic was removed because US 7,502,505 is still in force. PQ and HLG were removed because Dolby, the BBC and Thomson filed only licence-on-request declarations (free of charge or RAND), not licences or non-asserts; NHK filed no HLG declaration.
- **Unclear-licence test inputs replaced (2026-10-17):** the Bradford test no longer uses a matrix and D65/D50 whites from a secondary website. It follows ICC.1:2010 Annex E (free, permissive ICC licence), with D65 from its ITU-R BT.709-6 chromaticity and D50 the ICC PCS illuminant.
- **CIEDE2000 test pairs removed:** the Sharma, Wu & Dalal (2005) data file has no licence, and the page's only terms limit the authors' program and spreadsheet to personal or research use. The tests now check closed-form special cases computed from the formula.
- **Adobe DNG patent licence (verified 2026-10-17; owner decision).** Adobe's licence (Digital Negative page, <https://helpx.adobe.com/camera-raw/desktop/dng-and-file-formats/digital-negative.html>) is royalty-free, covers reading and writing DNG, and requires the notice "This product includes DNG technology under license by Adobe." in source code and documentation. It is now in `NOTICE`, `README.md` and all three DNG source files (the reader `dng-import.ts` was added). Its only condition beyond the notice is revocation for a licensee that sues Adobe over DNG patents. No conflict with Apache-2.0 was found. This is a document check, not legal advice. See `THIRD_PARTY.md`. A retrieval record (URL, date, page SHA-256, exact notice, summary) is kept at `docs/licenses/adobe-dng-patent-license-record.txt`. The full licence text is not copied, because Adobe's General Terms of Use (sections 3.2 and 6.2) do not clearly allow copying text from its websites.
- **Owner decisions (2026-10-17) on free, licence-compatible inputs:** ship DNG under Adobe's royalty-free licence. An earlier decision that day kept the Wyman et al. parameters and the Kang et al. coefficients; the owner then decided to remove every third-party number with any licence question, so both were removed (above).
- **DNG ActiveArea phase rule (confirmed).**
  - The Adobe DNG Specification 1.7.1.0 (September 2023) was downloaded from Adobe's Digital Negative page.
  - Under PhotometricInterpretation (PDF page 22) it states: "The origin of the repeating CFA pattern is the top-left corner of the ActiveArea rectangle". Under BlackLevel (PDF page 28): "The origin of this pattern is the top-left corner of the ActiveArea rectangle".
  - The #295 correction, which takes BlackLevel and CFAPattern phases relative to the ActiveArea origin, and the DNG importer both follow this rule.
  - Compatibility Issue 2 (16-bit lossless JPEG before DNG 1.1.0.0) is as cited in `docs/IMPORT_AND_PNG.md`.
  - The specification is free to download. It is © Adobe, and only factual tag definitions are used.
- **Colour constants without a confirmed free source removed (owner decisions, 2026-10-17):** CAT02, the von Kries Hunt–Pointer–Estévez matrix and the CIECAM02 degree-of-adaptation formula. Bradford (ICC.1:2010 Annex E) and CAT16 (free IS&T CIC24 2016 paper, Eq. (15)) remain.
- **Licence guard (#324).** CI runs ScanCode Toolkit 32.5.0 (Apache-2.0; every package pinned by version and SHA-256) and `scripts/check-scancode-policy.mjs`. The build fails on any licence other than Apache-2.0, any copyright holder other than the owner or Photivra contributors, scan errors, or stale allowlist entries. Each exception is one file plus one exact licence or holder, with a reason; adding or widening one needs owner review. The PR template asks every PR to state the source, licence and patent check of new algorithms, constants, datasets and file formats.
- **MurmurHash3** is an independent implementation of the public-domain algorithm (Austin Appleby, SMHasher), checked against published test vectors and recorded in `THIRD_PARTY.md`.
- **No third-party code, model weights or calibration data added.**
  - The JPEG DCT constants are computed by the engine.
  - The PNG zlib/DEFLATE encoder and the DNG/lossless JPEG readers are written in-house from free specifications.
  - AVIF and HEIC are not implemented, which avoids codec patent licensing.
  - Test oracles under `test/helpers/` are frozen copies of this repository's own Apache-2.0 code.
- **No new runtime dependency.** `npm ls --omit=dev` stays empty. The SPDX header, licence, identity and browser-surface gates run in `npm run check:static`.
- Every included commit carries the owner's DCO `Signed-off-by`, under the owner's October 11, 2026 policy. AI-assisted material still needs the owner's substantive human review before release.

## Privacy and security

- **No network, persistence or telemetry.** The root package makes no network request, stores nothing and collects nothing. In the browser it touches only `performance.now()`, for yield timing, and — only when the caller opts in — `navigator.gpu` (see WebGPU below). The browser-surface gate covers every reachable root module.
- **Parsers for untrusted input.** `parseDngRawImage` and `parseLosslessJpeg`:
  - bounds-check every offset and count;
  - detect IFD loops and aliases;
  - cap IFDs (default 64, at most 1,024) and pixels (default 64 MP, at most 200 MP) before allocating;
  - check a JPEG frame against the strip's sample count, to stop decompression bombs;
  - apply strict Huffman, marker and range checks.

  `serializePngImage` validates its input against `PNG_ENCODER_LIMITS`. JSON entry points reject non-plain objects, holes and unknown fields instead of silently hashing them; this also removes a way for different inputs to produce the same identity. There is no corpus of real-camera DNG files, so interoperability with camera files is not claimed.
- **WebGPU is opt-in.** `createImageKernelAccelerator()` touches `navigator.gpu` (or a GPU object supplied by the caller) only when called, never at import. Results are labelled `webgpu-f32` with an error bound, and the CPU reference stays the default. Shaders are fixed engine code; no caller code is compiled.
- **POC server (repository-only, not in the package).** Fixed messages for 413/422/500 and for malformed-JSON 400 reveal less than before. It stays loopback-oriented, unauthenticated and for development only.
- **Package surface.** The package no longer ships declaration maps, internal guides or unreachable modules. The JS source maps embed only this repository's TypeScript sources.

## Compatibility and migration

This is a breaking major release. The [changelog](../CHANGELOG.md#breaking-changes) lists each break with its migration. Version and identity changes:

| Identity | 1.5.0 | 2.0.0 |
| --- | --- | --- |
| Package and `ENGINE_API_VERSION` | 1.5.0 | **2.0.0** |
| `POC_SIMULATION_API_VERSION` | 0.20.0 | **1.0.0** |
| `SENSOR_RAW_PRODUCER_NOISE_MODEL` (`photivra-native-raw-noise`) | 0.2.0 | **0.4.0** (0.1.0–0.3.0 rejected) |
| Noise seed schedule | `capture-seed-plus-two-native-index-modulo-2-to-32-v1` | **`murmur3-capture-seed-native-index-stream-v2`** |
| Charge realization / stochastic RAW code / expected readout models | — | **3.0.0 / 4.0.0 / 2.0.0** |
| Generic tier `presetVersion` | 1.0.0 | **2.0.0** (1.0.0 rejected) |
| Spectral channel binding format | `…-canonical-json-v1` | **`…-canonical-json-v2`** (v1 rejected) |
| Crop models (centered, subject framing) | 1.0.0 | **2.0.0** |
| `thin-lens-depth-of-field` / defocus circle | 1.0.0 | **1.1.0 / 1.1.0** |
| Complex-pupil PSF | 1.1.0 | **2.0.0** |
| Rotation mapping and stabilization-equivalent models | 1.x | **2.0.0** |
| `PRINT_JPEG_SCHEMA_VERSION` | 0.1.0 | **0.2.0** (adds `encoderId`) |
| `EXPORT_JPEG_ENCODER_ID` | — | **`photivra-baseline-jpeg-444-v2`** |
| DNG output `DNGVersion` | 1.x writer value | **1.4.0.0** |
| Geometric mapping schema | 0.1.0 | 0.1.0, or **0.2.0** with the new transforms |
| Front-of-lens filter schema | 0.1.0 | 0.1.0, or **0.2.0** with a polarizer |
| Flash sync capability schema | 0.1.0 | 0.1.0, or **0.2.0** for HSS |
| Environment photo-signal model | 0.3.x | **0.4.0** only when `lensFieldMapping` is present |
| `relative-pre-exposure-metering` | 1.0.0 | **1.1.0** (no value change) |
| New identities | — | `SIMULATE_CAPTURE_FACADE_VERSION` 1.0.0, `COLORIMETRY_MODEL_VERSION` 2.0.0, `DNG_IMPORT_SCHEMA_VERSION` 1.0.0, `PNG_ENCODER_ID` `photivra-png-rgb-v1`, `IRRADIANCE_CONVOLUTION_SCHEMA_VERSION` 0.1.0, `SENSOR_FIXED_PATTERN_NOISE_MODEL` 1.0.0, `ELECTRONIC_ROLLING_SHUTTER_MODEL` 1.0.0, `HIGH_SPEED_SYNC_MODEL` 1.0.0 |

Other contract changes:

- new required RAW and sensor result fields;
- `createNativeRawDevelopmentTask` takes ownership of `input.raw`;
- stricter input validation: non-plain JSON, unknown fields at every level (scalar inputs, `parse*()` records and nested sub-objects), missing or null sub-objects (now `InvalidConfigurationError`), plan version/fingerprint mismatches;
- removed before release: the `"cat02"` and `"von-kries-hpe"` chromatic-adaptation transforms and `calculateDegreeOfAdaptation` (never in 1.x);
- widened unions (white-balance source, metering policy, readout synchronization, filter polarization, geometric transforms, blocker codes);
- a smaller package, without `prepare`, declaration maps or internal guides.

Root exports grow from 1,227 to 1,668 symbols. Comparing the generated `docs/api/exports.json` against `v1.5.0` shows none removed. New captures and plans record creator identity 2.0.0. Existing archives keep their identities, and fail closed where a bound identity changed.

## Known historical evidence not regenerated

These committed records are dated evidence tied to outputs from before 2.0.0. They are kept as written and are **not** 2.0.0 evidence:

- **`test/fixtures/producer-export-acceptance/` and `test/fixtures/paired-export-acceptance/`.** RAW, DNG and JPEG artifacts from engine 0.100 and 0.115, tied to external LibRaw/Adobe/editor review records. Regenerating them would orphan that evidence. Any new external review needs fresh 2.0.0 artifacts, which now differ in noise, white level, DNG tags and Exif.
- **`docs/validation/` records made with pre-2.0.0 behaviour**, such as `docs/validation/native-raw-print-2026-10-04/`, and the 1.2.0 #196 candidate inventory `docs/validation/print-196-candidate-evidence.json`. They remain valid records of the code that produced them. `docs/validation/tier-acceptance-report-v1.json` was regenerated in #284.

## Deferred items

Work that is known and deliberately left for later:

- **#305 follow-ups:** a provably identical fast path for provider-result validation; lean sensor-stage reuse.
- **#307 follow-ups:** real-camera DNG interoperability is not claimed (LibRaw decodes the files; no editor review yet); sharing the colour-tag code with the paired export.
- **#275:** a different native RAW default tile width (a plan-shape change); per-tap request retention (about 8 MB per site with a large PSF); parallel execution inside `simulateCapture()` (the engine-level row-band partitions are done).
- **#276 follow-up:** result values are frozen only at their top level (a deep freeze measured about 3× on hot scalar calls).
- **#277 and follow-ups from #304:**
  - an adapter from `NativeEnvironmentRawProvider.evaluateRadianceBatch` (#319) to `evaluateChartRadiance` (the seam, `mapEnvironmentDirectionsToChartPoints`, is built), and GPU radiance for caller scene functions;
  - hardware-GPU conformance runs and timings at 6–24 MP (`npm run test:webgpu:hardware` and `npm run bench:webgpu:hardware` are ready; nothing has been measured, because the development container has no GPU);
  - running `npm run test:webgpu` in CI.
- **#328 follow-up:** the browser speed-up from the unclamped host yields (avoiding the 4 ms nested-timer clamp) is expected but was not measured; in Node the gain is within run-to-run noise.
- **Optics follow-ups from #303:** lens field mapping in the browser-native executor, mappings combined with ideal pupil rays, calibrated finite-focus fisheye scale.
- **Motion follow-ups from #297:** derived rolling exposure schedules in tier presets; time-varying angular velocity (rolling-shutter wobble).

## Pending owner decisions

1. **Flagged citations: decided.** Six of the seven items are replaced or removed (see the [citation audit](#citation-audit-free-sources)). On 2026-10-17 the owner accepted the seventh, the CIE daylight locus, on the evidence of the free CIE datasets, provided it is completely free and licence-compatible: the datasets are only cited and compared against, never bundled, and the coefficients are facts. Runtime strings now name free sources.
2. **Agent instructions reset.** At the owner's request (2026-10-16), `AGENTS.md` was replaced with a short standard file. It keeps three rules:
   - changes and recommendations must be evidence-based;
   - only free-to-use sources, data, code and methods may be used;
   - the owner approves anything that goes to production.

   `docs/AGENT_DOMAIN_RULES.md`, `docs/AUTOMATION_COORDINATION.md` and the `.github` agent files were retired. Their scientific content already lives in the domain guides, and `.github/node-lts-policy.mjs` still enforces the CI Node policy.
3. **Human review** of the AI-assisted changes and of this record. The third-party inputs were decided on 2026-10-17: the Wyman et al. CMF coefficients were replaced by the engine's own fit; the Kang et al. locus by Planck's law; CIE table values were removed from the tests; the Malvar–He–Cutler demosaic, PQ and HLG were removed; CAT02, the von Kries HPE matrix and the CIECAM02 degree-of-adaptation formula were removed; DNG is kept under Adobe's royalty-free licence, with a licence record file (`docs/licenses/adobe-dng-patent-license-record.txt`). The owner also chose the ScanCode licence guard (#324) after a local full-repository ScanCode run found no licence or copyright other than the reviewed ones.
4. **JPEG file bytes from #328.** Correcting the JPEG progress total also corrects the read budget recorded in the XMP `PrintExportPlan`, so JPEG files taller than 32 rows or wider than 256 columns change bytes (image data identical from the quantization tables on). This was kept as a fix; the alternative is to correct only the progress counter.

## Release gates

The authoritative result is GitHub CI on the exact commit that is tagged: the `main` commit that merges this record update. This update changes code (the HPE/degree-of-adaptation removal and one input check), so it gets full CI on its PR and again on `main` after merge. Tag that `main` commit only when its CI is green.

| Gate | Result |
| --- | --- |
| Base before this update | `34f687da64e177a194fde8be0f25f681f282f1f1` (#328). Its pull-request CI passed on every job, including the licence scan; push CI on `main` passed: [CI run 832](https://github.com/Photivra/engine/actions/runs/39042289305) (all `verify` jobs on Node 22.13.0, lts/-1, lts/* and current, coverage, licence scan, macOS hash locks) and [Native performance run 90](https://github.com/Photivra/engine/actions/runs/39042289319). |
| GitHub CI on this update's PR (all jobs, all Node versions, licence scan, macOS hash locks) | Recorded on the PR. |
| GitHub CI on `main` after merge | To check before tagging. |

**Local results on this candidate** (`34f687d` plus this record update, Node 24.21.0, linux/x64). The host was memory-limited, so the full vitest suite and coverage were not run locally; CI provides them.

| Command | Result |
| --- | --- |
| `npm run check:static` | Passed: eslint, tsc, dependency licences (Apache-2.0 15, BlueOak-1.0.0 1, BSD-2-Clause 6, BSD-3-Clause 2, ISC 7, MIT 125, MPL-2.0 12), SPDX headers, identity, browser surface across 206 reachable modules. |
| `npm run build` | Passed (`tsc -p tsconfig.build.json`, from a clean `dist/`). |
| `npm run pack:check` | Passed: 813 files, 2,780,837 bytes packed, 12,678,150 unpacked; root export plus `./package.json`; 204 reachable modules; inline-source maps; no lifecycle scripts; local POC API excluded. |
| `npm run docs:check` | Passed: API reference current (1,668 root symbols across 180 modules); 284 Markdown files, 3,285 repository and local links, 105 importing examples, 26 explicit fragments. |
| `npm run release:consumer-check` | Passed: packed `@photivra/engine@2.0.0`; `require(esm)` and `lib: es2022`/DOM declaration consumers, 105 typed and running doc snippets, and the quick-start, simulate-capture and production/paired-export consumers. |
| ScanCode 32.5.0 plus `scripts/check-scancode-policy.mjs` on `git archive` of `23d75a8` (this candidate's code; later commits change only `CHANGELOG.md` and this record) | Passed: 988 files; 332 licence and 12 copyright findings, all on the reviewed allowlists (90 licence and 11 holder entries). |

## Remaining release checklist

- [x] Version surfaces aligned at 2.0.0; `POC_SIMULATION_API_VERSION` 1.0.0.
- [x] 2.0.0 changelog with breaking changes and migrations, additions, fixes, performance, tests and tooling.
- [x] Generated API reference regenerated after the merge.
- [x] Citation audit, with doc comments and docs updated to free sources.
- [x] All streams merged (#305–#328) and changelog entries written.
- [x] Final pre-release review: bugs and performance findings fixed with regression tests (#325–#328, this update).
- [x] Licence guard in CI (#324); local ScanCode run on this candidate recorded above.
- [x] Owner decisions on citations (decision 1).
- [x] Owner's substantive human review of the AI-assisted changes and of this record.
- [x] Green exact-head CI on the release PR (#329); then green CI on `main` after merge ([CI run 835](https://github.com/Photivra/engine/actions/runs/39044033656) on `a9833ad`).
- [x] **The owner's explicit approval to tag `v2.0.0`.** The owner tagged `v2.0.0` on `a9833ad`; `v1.5.0` is unchanged.
- [x] After publication: npm version, dist-tag, tarball integrity and provenance verified; GitHub release notes published; publication dates updated in `CHANGELOG.md`, `README.md`, `SECURITY.md` and this record (`docs/DEVELOPERS.md` states no release date).

## Publication

| Fact | Value |
| --- | --- |
| Tag | `v2.0.0` → `a9833adf3d4b107801c9bad4b04f3456e148ee99` (#329) |
| Publish workflow | [Publish npm run 15](https://github.com/Photivra/engine/actions/runs/39047383323), passed |
| npm | `@photivra/engine@2.0.0`, dist-tag `latest` |
| Integrity | `sha512-1snxRE7vNZjvXAg/ZwMMo+lq4SHEicWlHgORf4me4e+2fiBO7rJYyUx7CgcMhbWL61bDeT97E/GZHXdY5N1xyg==` |
| Provenance | SLSA provenance v1 attestation present on npm |
| Tarball contents | Identical, file for file, to `npm pack` of a local clean build of `a9833ad` (checked October 17, 2026) |
| GitHub release | [@photivra/engine 2.0.0](https://github.com/Photivra/engine/releases/tag/v2.0.0) |
