# Representative light sources

From 2.22 the engine ships four light-source spectra designed by Photivra (#557): a tri-phosphor fluorescent tube and
three white LEDs. Two lights at the same color temperature can render colors differently (color rendering), as real
fluorescent and LED light does, and these spectra let an application show that with the engine's own data.

Each spectrum is labeled **"representative, not a named product"**. It is a smooth analytic function written below,
not a measurement of a lamp, and it uses no CIE, IES or manufacturer spectral data, names or tables. Real lamps of
each kind vary widely; these represent the construction, not any one lamp.

## The sources

| Id | Name | CCT | Why it is in the set |
| --- | --- | --- | --- |
| `tri-phosphor-fluorescent-4000k` | Tri-phosphor fluorescent, 4000 K | 4000 K | Three narrow emission bands in the blue, green and red on a low continuum, the construction of a tri-phosphor fluorescent tube, which leaves gaps between the bands. |
| `white-led-low-rendering-4000k` | White LED, low color rendering, 4000 K | 4000 K | A blue pump peak and one broad yellow phosphor band, the simplest white LED, which is weak in the cyan and the deep red. |
| `white-led-high-rendering-4000k` | White LED, high color rendering, 4000 K | 4000 K | A blue pump with a green and a red phosphor band that fill the cyan and the red, a white LED built for high color rendering at the same CCT as the low-rendering one. |
| `warm-white-led-2700k` | Warm white LED, 2700 K | 2700 K | The same pump and two-phosphor construction with more red phosphor and less pump, a warm white LED for home lighting. |

The three 4000 K sources share one CCT, so they are same-CCT pairs: the low- and high-rendering LEDs are the pair the
tests check ([Color rendering](#color-rendering)).

## Using the sources

`createRepresentativeLightSourceIlluminant({ sourceId })` returns a capture illuminant,
`{ kind: "spectrum", spectrum, label }`, which every `illuminant` option accepts.
`createRepresentativeLightSourceSpectrum({ sourceId })` returns the spectrum alone (a function spectrum on 360–830 nm,
relative units), for the colorimetry functions or to build the illuminant yourself. `getRepresentativeLightSourceSet()`
returns the set as a frozen record: each source's id, name, family, nominal CCT, label, reason and formula parameters.
An unknown id or field fails with `InvalidConfigurationError`; a wavelength outside 360–830 nm with
`InvalidScientificInputError`.

```ts
import { calculateCorrelatedColorTemperature, createRepresentativeLightSourceIlluminant, getRepresentativeLightSourceSet,
  integrateSpectrumToXyz, simulateIdealReference, type ChartScene } from "@photivra/engine";

// The same chart under two 4000 K white LEDs: the colors differ, the neutrals stay neutral.
const chart: ChartScene = { preset: "color-patches", patchIds: ["neutral-4", "red", "skin-medium", "teal"], columns: 4 };
const low = createRepresentativeLightSourceIlluminant({ sourceId: "white-led-low-rendering-4000k" });
const high = createRepresentativeLightSourceIlluminant({ sourceId: "white-led-high-rendering-4000k" });
const [a, b] = await Promise.all([low, high].map((illuminant) =>
  simulateIdealReference({ scene: chart, illuminant, sensor: { spectralStepNanometers: 5 }, output: { width: 64, height: 16 } })));

// The engine's own CCT of a source (CIE 1931 analytic fit, 1 nm nodes).
const nodes = Array.from({ length: 471 }, (_, i) => ({ wavelengthNanometers: 360 + i, wavelengthMeasureNanometers: 1 }));
const white = integrateSpectrumToXyz({ quadratureNodes: nodes, spectralDistribution: low.spectrum,
  colorMatchingFunctions: { kind: "analytic-cie-1931-multi-lobe-fit" }, normalization: { kind: "white-luminance-one" } }).value;
const cct = calculateCorrelatedColorTemperature({ chromaticity: white.chromaticity!, locus: { kind: "planck-analytic-cmf" } }).value;
console.log(low.label, cct.correlatedColorTemperatureKelvin, a?.image.width, b?.image.width, getRepresentativeLightSourceSet().sources.length);
```

**Quadrature.** Use `sensor.spectralStepNanometers: 5` or finer with these sources, as for all color work
([Color patches, Accuracy](COLOR_PATCHES.md#accuracy)). The fluorescent bands are 3.5 nm wide (σ); the facade's default
20 nm step samples them too coarsely and leaves a strong cast ([Measured through the facade](#measured-through-the-facade)).

The sources are not chart presets or named `illuminant` kinds of `simulateCapture`: the capture itself does not contain
them, so a capture bundle that does not import them is unchanged in size ([Cost](#cost)).

## The spectra

Each spectrum is a constant plus a sum of Gaussian bands on the wavelength λ in nanometers, in relative units (a capture
scales its illuminant to the requested lux):

S(λ) = b + Σₖ aₖ·exp(−½·((λ − μₖ)/σₖ)²)

on 360–830 nm, the domain of the CIE 1931 observer. Every spectrum is positive on that whole domain.

| Id | b | Bands aₖ·G(μₖ, σₖ), in nm |
| --- | --- | --- |
| `tri-phosphor-fluorescent-4000k` | 0.02 | 0.285·G(450, 6) blue band + 1·G(544, 3.5) green line + 1.02·G(611, 3.5) red line |
| `white-led-low-rendering-4000k` | 0 | 1.123·G(450, 9) blue pump + 1·G(579.1, 50) yellow phosphor |
| `white-led-high-rendering-4000k` | 0 | 1.306·G(450, 9) blue pump + 1·G(530, 35) green phosphor + 1.264·G(630, 40) red phosphor |
| `warm-white-led-2700k` | 0 | 0.795·G(450, 9) blue pump + 1·G(540, 38) green phosphor + 2.133·G(630, 40) red phosphor |

**Design method.** For each kind of lamp Photivra chose the band positions and widths from the construction it
represents, then solved two parameters (Newton's method on the CIE 1931 xy chromaticity, the engine's analytic
observer fit, 1 nm nodes) so that the spectrum lies on the Planckian locus at the stated CCT. The solved values were
rounded (amplitudes to 0.001, wavelengths to 0.1 nm), and those rounded values are the definition.

- **Tri-phosphor fluorescent.** Narrow green and red bands at 544 nm and 611 nm and a blue band at 450 nm, the three
  colors such a lamp's phosphors emit, on a constant continuum of 0.02 for the weak broad emission between them. The
  green amplitude is fixed at 1; the blue and red amplitudes were solved. σ = 3.5 nm (full width at half maximum
  8.2 nm) is wider than real phosphor lines, chosen so that the 5 nm quadrature integrates a band to within about 10⁻⁴
  of its area (the error of uniform sampling of a Gaussian falls as exp(−2π²σ²/h²) for spacing h).
- **White LED, low color rendering.** A blue pump band at 450 nm (σ = 9 nm, about 21 nm wide at half maximum) and one
  broad phosphor band (σ = 50 nm), the simplest phosphor-converted white LED. The pump amplitude and the phosphor's
  center were solved (center 579.1 nm). With one band the spectrum has a dip in the cyan and little deep red.
- **White LED, high color rendering.** The same pump with a green phosphor band at 530 nm (σ = 35 nm) and a red one at
  630 nm (σ = 40 nm) that fill the cyan and the red. The green amplitude is fixed at 1; the pump and red amplitudes were
  solved.
- **Warm white LED.** The same construction at 2700 K, with the green band moved to 540 nm (σ = 38 nm). It needs less
  pump and more than twice the red phosphor of the 4000 K source.

These are synthetic spectra. Their color rendering is that of these functions, not of any physical lamp.

## Checked color temperature

Computed with the engine's own code: the chromaticity from `integrateSpectrumToXyz` (the engine's analytic CIE 1931
fit, 1 nm nodes, 360–830 nm), then `calculateCorrelatedColorTemperature` (nearest point of the Planckian locus in CIE
1960 uv, locus `planck-analytic-cmf`) and `estimateCorrelatedColorTemperatureMcCamy` (McCamy 1992). Both rest on the
analytic observer fit, so they are approximations of the CIE 1931 values ([Colorimetry](COLORIMETRY.md)).

| Id | x | y | CCT (locus) | Duv | CCT (McCamy) |
| --- | --- | --- | --- | --- | --- |
| `tri-phosphor-fluorescent-4000k` | 0.3808 | 0.3767 | 4000.8 K | +0.000012 | 4000.1 K |
| `white-led-low-rendering-4000k` | 0.3808 | 0.3767 | 3999.6 K | −0.000013 | 3998.9 K |
| `white-led-high-rendering-4000k` | 0.3808 | 0.3767 | 4000.0 K | +0.000002 | 3999.3 K |
| `warm-white-led-2700k` | 0.4603 | 0.4105 | 2699.9 K | +0.000002 | 2690.5 K |

**Tolerance (tested).** The locus CCT is within 1 K of the stated CCT and |Duv| ≤ 0.0001 for every source; McCamy's
estimate is within 10 K (McCamy's own deviation from the locus is up to 10 K over 2856–6504 K and 19 K at 2000 K;
[Colorimetry](COLORIMETRY.md)).

## Color rendering

**What is computed.** For each of the 24 colored [color patches](COLOR_PATCHES.md) (the neutrals are left out), the
CIELAB color under a source and under a reference light, each relative to its own light's perfect diffuser (so each
light is its own white), and the CIEDE2000 difference ΔE00 between them (`calculateColorDifference`). The observer is
the engine's analytic CIE 1931 fit, 1 nm nodes. The reference light is a Planckian radiator at the source's own
computed CCT (Planck's law, `createPlanckianSpectrum`).

**What is not computed.** This is Photivra's own figure, not the CIE color rendering index (Ra) or the IES TM-30
fidelity index (Rf): those use test-sample reflectances (and, for TM-30, a color appearance space) that the engine does
not bundle because of their licenses (`THIRD_PARTY.md`). The figure is computed only from the engine's own patches and
formulas. It is not comparable to Ra or Rf values.

| Id | Mean ΔE00 to the Planckian reference | Largest (patch) |
| --- | --- | --- |
| `tri-phosphor-fluorescent-4000k` | 2.87 | 6.49 (PV-S2 Flashbulb Yellow) |
| `white-led-low-rendering-4000k` | 4.00 | 5.49 (PV-S4 Harbor Cyan) |
| `white-led-high-rendering-4000k` | 0.67 | 2.15 (PV-S5 Cyanotype Blue) |
| `warm-white-led-2700k` | 1.18 | 2.20 (PV-S6 Filter Magenta) |

**The same-CCT pair.** Under the low- and the high-rendering 4000 K LEDs (CCT 3999.6 K and 4000.0 K, Duv within
0.00002 of each other) the patch colors differ by, in ΔE00:

| PV-S1 Darkroom Red | PV-P2 Medium Portrait Tone | PV-G1 Sunset Flare Orange | PV-S4 Harbor Cyan | PV-M5 Estuary Teal | Mean (24 patches) | Smallest |
| --- | --- | --- | --- | --- | --- | --- |
| 5.05 | 4.67 | 5.86 | 5.02 | 4.25 | 3.68 | 1.36 (PV-G2 Blacklight Violet) |

The reds, oranges, cyans and skin tones shift most: the one-band LED has little deep red and a dip in the cyan. The neutral patches have a* = b* = 0 under both (within 10⁻⁹).
`test/representative-light-sources.test.ts` checks the PV-S1, PV-P2 and PV-G1 values and the mean to 0.01, the table
above to 0.01, and the CCT tolerance.

## Measured through the facade

`simulateIdealReference()` of the `color-patches` chart (the capture's development without noise, blur or mosaic,
scene-illuminant white balance), CIELAB of each patch center relative to the sRGB white scaled to the white neutral's
reflectance, as in [Color patches, Accuracy](COLOR_PATCHES.md#accuracy). Measured November 9, 2026, Node 24.19:

| Sensor step | Low vs high LED: PV-S1 | PV-P2 | Mean | Fluorescent PV-N4 a*, b* | Low LED PV-N4 a*, b* |
| --- | --- | --- | --- | --- | --- |
| 1 nm | 5.05 | 4.67 | 3.63 | −0.01, 0.00 | 0.00, 0.00 |
| 5 nm | 5.07 | 4.70 | 3.64 | −0.09, 0.06 | −0.06, 0.08 |
| 20 nm (the default) | 5.38 | 5.22 | 3.81 | +41.42, −4.27 | −0.29, −0.47 |

At 1 and 5 nm the rendered differences agree with the colorimetric ones within 0.05 ΔE00. At the default 20 nm the
scene-illuminant white balance is measured on 1 nm nodes while the sensor integrates on 20 nm nodes, which miss most of
the fluorescent source's narrow bands: its mid-gray renders strongly magenta. Use 5 nm. The test checks the pair
(ΔE00 above 4.8 on PV-S1 and 4.4 on PV-P2) and the neutrals (a*, b* within 0.2 for every neutral under the fluorescent
source) at 5 nm.

## Display view

The spectra evaluate their exponentials with the engine's portable `portableExp`, so a source's values have the same
bits in every JavaScript engine, in captures and in the display view
([Display view](DISPLAY_VIEW.md#same-bytes-in-every-engine)). A source passed to the display view is a caller spectrum
there, as in a capture.

## Cost

The sources are a pure module that only an import of one of their exports reaches. Measured with rolldown 1.2.9 as in
`test/capture-bundle.test.ts` (minified, gzip level 9): the app's capture-worker shape is 351,770 B gzip before and
after (no change); a bundle of `simulateCapture` and `simulateIdealReference` is unchanged; adding
`createRepresentativeLightSourceIlluminant` and `getRepresentativeLightSourceSet` to it adds 3,760 B minified and
1,553 B gzip. Values are memoized per wavelength, so a capture evaluates each formula once per node.
