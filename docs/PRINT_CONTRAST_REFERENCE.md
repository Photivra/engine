# Static neutral Print contrast reference — model 0.1.0

`calculatePrintContrastReference()` estimates how sensitive an average observer is to a simple test pattern. It evaluates a restricted case of the castleCSF contrast sensitivity function (CSF): a static, foveal (straight-ahead), neutral D65 Gabor pattern (a sine-wave grating inside a Gaussian window).

This is an **estimate from a population model**. It is separate from measured regional detail and from sampling sufficiency. It does not:

- classify a photograph;
- promise that anything is invisible;
- establish any one person's acuity;
- give an overall Print verdict.

Whether a real stimulus matches this reference stays unassessed.

## Model and source review

**Source code.** The numerical source is [castleCSF revision f4b0b722af83001d7af979281e06ca642d36e4e8](https://github.com/gfxdisp/castleCSF/tree/f4b0b722af83001d7af979281e06ca642d36e4e8), including `CSF_castleCSF.m`, `CSF_stelaCSF_lum_peak.m`, `CSF_castleCSF_chrom.m` and `CSF_base.m`. These files contain the model equations, numerical parameters, the neutral D65 background and the mechanism projections. Where the paper's printed equations differ from this code, the code wins: as printed, Eq. 21 reads `(1 − (1 + k_s4)/Y)^(−k_s5)` where the code has `1 − (1 + k_s4/Y)^(−k_s5)`, and Eq. 22 prints the exponent `+k_s3` where the code has `−k_s3`. Both printed forms give implausible results (Eq. 21 diverges at Y = 1; Eq. 22 would make chromatic sensitivity fall with luminance), so they appear to be typesetting errors.

**Licence.** The repository licence is MIT, copyright 2023 Graphics and Displays group, University of Cambridge. Keep the [exact licence](licenses/castleCSF-MIT.txt), the copyright in source and `NOTICE`, and the inventory in `THIRD_PARTY.md`.

**What is ours.** The scalar TypeScript adapter and the independent high-precision evaluator are newly written. The numerical model material is third-party material; it is not claimed as Photivra-owned calibration.

**Paper.** The [primary paper, Ashraf et al. (2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10996938/), describes sensitivity as a function of stimulus conditions, and reports how the population model was validated. Its fixed-size static achromatic Gabor reference is relevant to this restricted stimulus.

The adapter's coefficients are the same fitted values that the paper prints in its Appendix Tables 5–7 (rounded there to about four significant figures); they are taken at full precision from the MIT-licensed code, not copied from the tables. We do not reproduce the paper's text, figures or observational datasets. No CSV from the combined historical datasets is included; their reuse and collection history is not inferred from the code licence. The owner signed off the scientific, source and licence review of this numerical material on 2026-11-09 ([#544](https://github.com/Photivra/engine/issues/544)).

## Explicit conditions and quantities

**Inputs must be explicit.** Every input must name the stimulus, and the published reference assumption (binocular viewing, natural pupil). The label rests on the paper's datasets: it excluded the datasets measured with an artificial pupil (it models natural viewing), and its anchor dataset, the HDR CSF data of Wuerger et al. (2020), was measured binocularly with natural pupils; the other datasets' viewing differences are absorbed by per-dataset shifts (Eq. 32).

**Supported range** (model-evaluation limits, not a calibration certificate for every observer or combination):

| Condition | Range |
| --- | --- |
| Mean luminance | **1–1000 cd/m²** |
| Carrier frequency | **0.25–16 cycles/degree** |
| Gaussian envelope sigma | **exactly 1.5 degrees** |
| Temporal frequency | **zero** |
| Eccentricity | **zero** |

Positive values outside this range give `unsupported`; there is no extrapolation.

**Modulation and luminance.**

- Michelson modulation is a fraction you supply, in `[0,1]`.
- Luminance is never inferred from capture exposure, a display percentage, paper whiteness or image RGB.
- The luminance input is the uniform D65 background (carrier mean) used by the upstream model.
- The modulation is the fractional amplitude of the neutral sine-wave carrier, before its Gaussian window. It is not an average over an image region, a ratio of image extremes, a Fourier residual or RMS noise.

**Window shape matters.** A Gaussian window changes the spatial stimulus. The scalar adapter does not establish equivalence with a rectangular grating. The primary paper discusses aperture-equivalence assumptions and their limits. Its individual datasets use different windows at some frequencies, so the adapter's numerical range must not be presented as an evenly measured empirical calibration grid.

**How it is evaluated.**

- Equal fractional modulation of the upstream neutral D65 LMS (cone) background is selected. It is the direction of upstream's default `lms_delta` [0.6855, 0.2951, 0.0194] (0.9806 × the background, rounded to four decimals), but because of that rounding a plain upstream call with only `luminance` reads about 2.5e-4 (relative) higher sensitivity.
- The achromatic sustained and transient responses, and both opponent-mechanism projections, are kept. The neutral background has small nonzero opponent projections.
- The static temporal response and the Gaussian effective area `pi sigma²` follow the pinned model.
- Luminance-dependent hyperbolic terms are evaluated with log1p/expm1, to keep them accurate where k_s4/Y is small (about 5.6e-10 at 1000 cd/m²). This evaluates the mathematical equations directly; it does not copy MATLAB's cancellation in `1 - power(...)` bit for bit.

**Outputs.** The function returns three continuous model quantities:

- sensitivity;
- threshold modulation (the reciprocal of sensitivity);
- your supplied modulation divided by that threshold.

There is no `visible`, `invisible` or `pass` result, no personal vision score, and no automatic print-quality recommendation. It does not combine independent image-quality dimensions, and does not convert a Fourier residual or RMS noise into a Gabor contrast. Fitted population variation and upstream fit errors do not give an individual confidence interval. Uncertainty stays explicitly unquantified.

## Independent numerical protocol

**Reference generator.** The committed [reference generator](../test/fixtures/print-detail/generate_contrast_reference.py) evaluates the scalar equations with the Python standard library's Decimal type at 80 digits. It uses direct hyperbolic powers, an independently arranged area term and exact decimal parameters. It uses no engine output.

**Reference data.** The [reference artifact](../test/fixtures/print-detail/contrast-reference.json) covers 35 luminance/frequency points. The public-root test checks its SHA-256, source revision, protocol and conditions. Sensitivity and threshold are compared with a relative tolerance of `1e-12`. This is numerical conformance, not a claim about accuracy for observers.

Tests also cover domain boundaries, copied immutable input, explicit zero contrast, malformed conditions, and the absence of any visibility verdict.

**What has not been done.** This protocol did not run the upstream MATLAB code, and did not run new observer experiments. The upstream empirical results are the research basis; the independent Decimal reference validates only this scalar evaluation.

These remain separate and unvalidated:

- transfer to real photographic or printed stimuli;
- masking;
- differences in age and eyes;
- absolute print luminance;
- colour;
- glare;
- eccentricity;
- temporal presentation;
- the viewing device.

The coherent rectangular-grating diagnostic is not a Gaussian-window stimulus, so its modulation cannot be passed off as matched Gabor evidence. The full scope of acquisition and perceptual acceptance (issue #196) stays open until the capability ledger records the missing evidence and substantive human review.

## Complete public example

```ts
import { calculatePrintContrastReference } from "@photivra/engine";
const reference = calculatePrintContrastReference({
  referenceId: "example-population-reference", stimulus: "static-neutral-d65-gabor",
  observer: "published-binocular-natural-pupil-reference",
  meanLuminanceCdPerSquareMeter: 50, spatialFrequencyCyclesPerDegree: 4,
  gaussianEnvelopeSigmaDegrees: 1.5, temporalFrequencyHz: 0,
  eccentricityDegrees: 0, modulationMichelson: 0.01
}).value;
if (reference.status !== "model-estimate" || !reference.estimate) throw new Error("Unexpected reference domain");
if (reference.naturalImageVisibility !== "unassessed" || reference.overallPrintVerdict !== "not-offered") throw new Error("Unexpected quality claim");
console.log(reference.estimate, reference.observerApplicability);
```

This evaluates a declared reference stimulus. It is not evidence that a real photograph or print meets those stimulus and observer conditions.
