# Color patches

From 2.14 the engine ships a set of 30 color patches designed by Photivra, so an application can build a color test
chart without supplying spectral data of its own. Each patch is a reflectance **spectrum**, not an RGB value: it is
lit by the capture's illuminant and passes through the same spectral pipeline as every other chart (illuminant ×
reflectance → the sensor's spectral response → white balance → development and output).

The set is Photivra's own design. It uses no ColorChecker or other commercial target's patch data, names, order,
layout or measured spectra; every spectrum is a smooth analytic function written below. Each patch has a Photivra
name and short code, and its published color is checked to differ from openly published third-party colors
([Distinct from third-party colors](#distinct-from-third-party-colors)).

## The patches

The published colors, with the reason each patch is on the chart. sRGB is the 8-bit sRGB color of the reflectance under
CIE illuminant D65; CIELAB is under D65 with the CIE 1931 2° observer ([Reference colorimetry](#reference-colorimetry)).
These describe the reflectance itself, not a camera's rendering of it.

| Code | Name | Group | sRGB | L* | a* | b* | C*ab | hab (°) | Why it is on the chart |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PV-N1 | Studio Gray 1 | neutral | `#F4F4F4` | 96.04 | 0.00 | 0.00 | 0.00 | — | The white end of the flat gray ramp (90.1 %): the reference for white balance, exposure and highlight clipping. |
| PV-N2 | Studio Gray 2 | neutral | `#C9C9C9` | 81.02 | 0.00 | 0.00 | 0.00 | — | A light flat gray about 15 L* below the white, for the upper tone curve and highlight roll-off. |
| PV-N3 | Studio Gray 3 | neutral | `#A1A1A1` | 66.06 | 0.00 | 0.00 | 0.00 | — | A light-mid flat gray that continues the ramp in equal lightness steps, for tone-curve and gamma checks. |
| PV-N4 | Studio Gray 4 | neutral | `#7B7B7B` | 51.50 | 0.00 | 0.00 | 0.00 | — | The mid-gray of the ramp, near an 18 % card's lightness, for exposure and neutral balance in the midtones. |
| PV-N5 | Studio Gray 5 | neutral | `#565656` | 36.56 | 0.00 | 0.00 | 0.00 | — | A dark flat gray that shows shadow tone separation, noise and any color cast in the shadows. |
| PV-N6 | Studio Gray 6 | neutral | `#353535` | 21.94 | 0.00 | 0.00 | 0.00 | — | The black end of the ramp (3.5 %), for black level, shadow noise and flare. |
| PV-S1 | Darkroom Red | strong | `#BF3428` | 43.70 | 54.15 | 39.93 | 67.28 | 36.4 | A strong red, for saturated reds, which clip and shift in hue easily in a camera's red channel. |
| PV-S2 | Flashbulb Yellow | strong | `#E6C02A` | 78.87 | -0.23 | 73.26 | 73.26 | 90.2 | A strong yellow, bright and high in chroma, that shows whether light saturated colors keep their hue. |
| PV-S3 | Hedgerow Green | strong | `#359C4C` | 57.08 | -47.07 | 33.20 | 57.60 | 144.8 | A strong mid green, for the green primary, where camera and display gamuts differ most. |
| PV-S4 | Harbor Cyan | strong | `#3C98AA` | 58.40 | -21.56 | -17.23 | 27.60 | 218.6 | A strong cyan between the green and blue primaries, a region where overlapping camera responses mix the channels. |
| PV-S5 | Cyanotype Blue | strong | `#3C4C9E` | 35.27 | 19.89 | -46.48 | 50.56 | 293.2 | A strong dark blue, for the blue channel, its noise and the shift of saturated blues toward purple. |
| PV-S6 | Filter Magenta | strong | `#B4408E` | 46.11 | 55.00 | -18.91 | 58.16 | 341.0 | A strong magenta, a non-spectral hue made of both ends of the spectrum, so it tests the red and blue channels together. |
| PV-T1 | Faded Print Red | soft | `#C77B78` | 59.63 | 29.17 | 14.19 | 32.44 | 25.9 | A soft red at lower chroma and higher lightness, for gentle reds that a color matrix should not oversaturate. |
| PV-T2 | Window Glow Yellow | soft | `#DCC985` | 81.15 | -2.88 | 36.43 | 36.54 | 94.5 | A soft light yellow, for pale warm tones whose hue drifts easily toward green or orange. |
| PV-T3 | Misty Hedgerow Green | soft | `#7FAE85` | 66.82 | -24.11 | 16.11 | 29.00 | 146.2 | A soft green, for the muted greens that fill much of a natural scene. |
| PV-T4 | Shallow Water Cyan | soft | `#7DB9C2` | 71.51 | -16.99 | -10.71 | 20.08 | 212.2 | A soft cyan, for pale blue-greens such as water and glass, where small hue errors are easy to see. |
| PV-T5 | Distant Hill Blue | soft | `#7486BD` | 56.48 | 7.42 | -30.88 | 31.76 | 283.5 | A soft blue, for the hazy blues of distance and open shade that white balance acts on. |
| PV-T6 | Faded Filter Magenta | soft | `#B984A8` | 61.36 | 26.09 | -10.98 | 28.31 | 337.2 | A soft magenta, for pinks and mauves that lie between the red and blue channels. |
| PV-P1 | Fair Portrait Tone | skin | `#E8C3AA` | 81.35 | 9.48 | 17.48 | 19.89 | 61.5 | A fair skin tone, the lightest of four, for portrait color, where viewers notice small errors. |
| PV-P2 | Medium Portrait Tone | skin | `#C99A7D` | 67.25 | 13.65 | 22.01 | 25.90 | 58.2 | A medium skin tone, the second of four that span a range of skin lightness at similar hue. |
| PV-P3 | Tan Portrait Tone | skin | `#A3714F` | 52.01 | 15.71 | 26.72 | 31.00 | 59.5 | A tan skin tone, the third of four, for warm midtone skin under different lights. |
| PV-P4 | Deep Portrait Tone | skin | `#6A4532` | 33.00 | 13.57 | 18.02 | 22.56 | 53.0 | A deep skin tone, the darkest of four, for skin color and detail in the darker tones of a portrait. |
| PV-M1 | Midday Sky | memory | `#6893CB` | 60.05 | 0.53 | -33.31 | 33.31 | 270.9 | A clear-sky blue, a memory color that viewers judge against what they remember of the sky. |
| PV-M2 | Canopy Green | memory | `#4B692C` | 40.81 | -22.40 | 30.31 | 37.69 | 126.5 | A leaf green with the steep rise of leaf reflectance at the red edge, a memory color that also exposes infrared leakage. |
| PV-M3 | Warehouse Brick | memory | `#9C4A3A` | 41.63 | 32.81 | 25.53 | 41.57 | 37.9 | A dull brick red, a common building color between the saturated reds and the skin tones. |
| PV-M4 | Low Tide Sand | memory | `#D5C29B` | 79.14 | 0.48 | 22.19 | 22.20 | 88.8 | A pale sand, a light warm near-neutral that shows small casts a gray patch would hide. |
| PV-M5 | Estuary Teal | memory | `#2E7F7C` | 48.43 | -24.88 | -5.64 | 25.51 | 192.8 | A dark blue-green between the green and cyan hues, for water and shaded foliage in that region. |
| PV-M6 | Wildflower Lilac | memory | `#A99BCB` | 66.69 | 14.80 | -22.70 | 27.10 | 303.1 | A pale blue-violet, a flower color that cameras often render too blue. |
| PV-G1 | Sunset Flare Orange | gamut-edge | `#DC511A` | 53.19 | 52.38 | 56.53 | 77.07 | 47.2 | A deep orange close to the sRGB gamut boundary, for gamut mapping and clipping of saturated warm colors. |
| PV-G2 | Blacklight Violet | gamut-edge | `#4C1E9C` | 26.42 | 48.90 | -59.69 | 77.16 | 309.3 | A deep violet close to the sRGB gamut boundary, for gamut mapping and the camera's response at short wavelengths. |

**Codes.** `PV-` and a group letter and number, numbered in chart order: N neutral, S strong, T soft (tint), P skin
(portrait), M memory, G gamut-edge. Codes and `patchId`s are stable; the `patchId`s are the API names and did not
change when the names and codes were added.

**Names.** Photivra's own descriptive names, in one style (a scene or studio word and a color word) and in US English
("Color", "Gray"). They do not reuse the patch names of the ColorChecker ("Dark Skin", "Foliage", "Blue Sky", "Bluish
Green" and so on), the CSS named colors or the RAL Classic and RAL Design System+ names (checked against the
sources listed below), and were chosen not to imitate Pantone or paint-brand names; paint-brand catalogs were spot-checked
by web search only, since no complete open list exists.

## Using the patches

A built-in patch is a chart reflectance, `{ kind: "color-patch", patchId }`. It is accepted wherever a chart takes a
reflectance spectrum: the `uniform` preset's `reflectance`, a `patches` entry, a material scene's `materials` and a
material-layers scene's reflectances. A scalar reflectance still means a spectrally flat gray and renders exactly as
before.

The `color-patches` preset draws the whole set (or a chosen list) as a grid, like `patches`:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `patchIds` | every patch, in `COLOR_PATCH_IDS` order | 1–30 distinct patch ids, row-major |
| `columns` | min(6, patch count) | Patches per row; the default layout is 6 × 5 |
| `gapFraction` | 0.1 | Gap between patches as a fraction of the cell, [0, 0.5) |
| `backgroundReflectance` | 0.18 | Neutral reflectance of the gaps and empty cells |

Unknown fields, unknown or repeated ids and out-of-range values fail with `InvalidConfigurationError`. Defaults are
reported in the capture's assumptions as for every chart, and the resolved parameters name the set and its version
(`patchSet: "photivra-color-patches"`, `patchSetVersion`). The patch spectra enter the scene digest.

`getColorPatchSet()` returns the set as a frozen record. Each patch has its `patchId`, `code` (for example `"PV-N4"`),
`name` (for example `"Studio Gray 4"`), `group`, `reason` (one sentence: why it is on the chart), formula parameters and
reference colorimetry. `evaluateColorPatchReflectance({ patchId, wavelengthNanometers })` evaluates one spectrum at
one wavelength (360–830 nm).

```ts
import { COLOR_PATCH_IDS, getColorPatchSet, simulateCapture, type ChartScene } from "@photivra/engine";

// The whole set as one element of a composite chart (6 × 5 cells, so width / height = 6 / 5 gives square cells).
const chart: ChartScene = { preset: "composite", background: { preset: "uniform", reflectance: 0.6 }, elements: [
  { scene: { preset: "color-patches" }, centerU: 0, centerV: 0, width: 1.2, height: 1 },
  // One patch on its own: a uniform element with a color-patch reflectance.
  { scene: { preset: "uniform", reflectance: { kind: "color-patch", patchId: "skin-medium" } }, centerU: 0.8, centerV: 0.3, width: 0.2, height: 0.2 }] };
const capture = await simulateCapture({ scene: chart, sensor: { spectralStepNanometers: 5 }, output: { width: 96, height: 64 } });
const labels = getColorPatchSet().patches.map((p) => p.code + " " + p.name);
console.log(COLOR_PATCH_IDS.length, labels[0], capture.scene.parameters);
```

For color work use `sensor.spectralStepNanometers: 5` (see [Accuracy](#accuracy)).

## The spectra

Each reflectance is a constant plus a sum of Gaussian bumps and logistic steps on the wavelength λ in nanometers:

R(λ) = min(1, max(0, b + Σₖ aₖ·φₖ(λ))), with

- G(μ, σ): φ(λ) = exp(−½·((λ − μ)/σ)²), a Gaussian bump centered at μ with standard deviation σ;
- S(λ₀, s): φ(λ) = 1/(1 + exp(−(λ − λ₀)/s)), a logistic step rising through ½ at λ₀ with scale s;
- F(λ₀, s): φ(λ) = 1 − S(λ₀, s), the falling step.

The spectra are defined on 360–830 nm, the domain of the CIE 1931 observer. Every spectrum lies in [0.03, 0.901] on that
whole domain (checked on a 0.25 nm grid), so the clamp never acts: it only states that a reflectance is between 0 and
1. There is no fluorescence: a patch reflects at each wavelength only light of that wavelength. The neutral patches
are constants, spectrally flat.

In `getColorPatchSet()` a term is `{ kind: "gaussian", amplitude, centerNanometers, standardDeviationNanometers }` or
`{ kind: "logistic-rise" | "logistic-fall", amplitude, midpointNanometers, scaleNanometers }`.

| Group | Codes | Contents |
| --- | --- | --- |
| `neutral` | PV-N1–N6 | Six flat grays from white (90.1 %) to black (3.5 %), in steps of about 15 L* |
| `strong` | PV-S1–S6 | Red, yellow, green, cyan, blue and magenta at high chroma |
| `soft` | PV-T1–T6 | The same six hues at lower chroma and higher lightness |
| `skin` | PV-P1–P4 | Four skin tones from fair to deep |
| `memory` | PV-M1–M6 | Sky blue, leaf green, brick red, sand, teal and lilac |
| `gamut-edge` | PV-G1–G2 | A deep orange and a deep violet close to the sRGB gamut boundary |

**Design method.** Photivra chose a target color for each patch, as an sRGB value of its own, and fitted the free
parameters of a one- or two-term form by Nelder–Mead minimization of ΔE*ab between the target and the spectrum's CIELAB
under D65, with penalties that keep σ ≥ 20 nm, s ≥ 10 nm (smooth spectra that a 5 nm quadrature integrates well) and
the reflectance in [0.02, 0.95]. The fitted values were rounded (amplitudes and constants to 0.001, wavelengths to
0.1 nm) and those rounded values are the definition. The neutral reflectances were chosen for L* of about 96, 81, 66,
51, 36 and 21, then moved by at most 0.003 so that no published hex equals a reference color's
([Distinct from third-party colors](#distinct-from-third-party-colors)). The foliage spectrum's rise at 717 nm models
the steep rise in leaf reflectance at the red edge, almost all of it beyond the visible range. These are smooth synthetic
spectra: they are not measurements of real paints, skin or plants, and their metamerism under other lights is that of
these functions, not of any physical material.

| Code | Id | Name | Group | b | Terms |
| --- | --- | --- | --- | --- | --- |
| PV-N1 | `neutral-1` | Studio Gray 1 | neutral | 0.901 | — |
| PV-N2 | `neutral-2` | Studio Gray 2 | neutral | 0.585 | — |
| PV-N3 | `neutral-3` | Studio Gray 3 | neutral | 0.354 | — |
| PV-N4 | `neutral-4` | Studio Gray 4 | neutral | 0.197 | — |
| PV-N5 | `neutral-5` | Studio Gray 5 | neutral | 0.093 | — |
| PV-N6 | `neutral-6` | Studio Gray 6 | neutral | 0.035 | — |
| PV-S1 | `red` | Darkroom Red | strong | 0.031 | 0.757·S(611.6, 16.2) |
| PV-S2 | `yellow` | Flashbulb Yellow | strong | 0.071 | 0.602·S(518.7, 13.2) |
| PV-S3 | `green` | Hedgerow Green | strong | 0.051 | 0.317·G(535.8, 36.9) |
| PV-S4 | `cyan` | Harbor Cyan | strong | 0.096 | 0.339·G(482.5, 60.4) |
| PV-S5 | `blue` | Cyanotype Blue | strong | 0.064 | 0.336·G(460.7, 24.7) |
| PV-S6 | `magenta` | Filter Magenta | strong | 0.05 | 0.258·G(440, 32.8) + 0.549·S(605, 15) |
| PV-T1 | `red-soft` | Faded Print Red | soft | 0.196 | 0.472·S(601.8, 13) |
| PV-T2 | `yellow-soft` | Window Glow Yellow | soft | 0.246 | 0.414·S(509, 17.6) |
| PV-T3 | `green-soft` | Misty Hedgerow Green | soft | 0.184 | 0.251·G(535.7, 47.4) |
| PV-T4 | `cyan-soft` | Shallow Water Cyan | soft | 0.246 | 0.339·G(487.4, 61.9) |
| PV-T5 | `blue-soft` | Distant Hill Blue | soft | 0.207 | 0.319·G(457.6, 34.7) |
| PV-T6 | `magenta-soft` | Faded Filter Magenta | soft | 0.196 | 0.231·G(440, 33.1) + 0.256·S(575.8, 15) |
| PV-P1 | `skin-pale` | Fair Portrait Tone | skin | 0.408 | 0.394·S(562.5, 31.7) |
| PV-P2 | `skin-medium` | Medium Portrait Tone | skin | 0.213 | 0.376·S(570.3, 30.4) |
| PV-P3 | `skin-tan` | Tan Portrait Tone | skin | 0.084 | 0.295·S(573.7, 31.3) |
| PV-P4 | `skin-deep` | Deep Portrait Tone | skin | 0.034 | 0.133·S(590.3, 32.4) |
| PV-M1 | `sky-blue` | Midday Sky | memory | 0.18 | 0.455·F(507.2, 29.7) |
| PV-M2 | `foliage-green` | Canopy Green | memory | 0.034 | 0.139·G(555, 30.7) + 0.411·S(716.8, 12) |
| PV-M3 | `brick-red` | Warehouse Brick | memory | 0.05 | 0.308·S(592.7, 16.2) |
| PV-M4 | `sand` | Low Tide Sand | memory | 0.272 | 0.371·S(504.9, 37.6) |
| PV-M5 | `teal` | Estuary Teal | memory | 0.085 | 0.197·G(498.2, 42) |
| PV-M6 | `lavender` | Wildflower Lilac | memory | 0.331 | 0.298·G(445, 30.4) + 0.137·S(623.4, 20) |
| PV-G1 | `deep-orange` | Sunset Flare Orange | gamut-edge | 0.03 | 0.74·S(591.3, 16.7) |
| PV-G2 | `deep-violet` | Blacklight Violet | gamut-edge | 0.031 | 0.37·G(441.6, 25.6) + 0.097·S(640, 20) |

## Reference colorimetry

`reference.cielabD65` and `reference.srgbHex` give each spectrum's color as a colorimetric fact about the reflectance,
independent of any camera:

- X = k Σ S(λ) R(λ) x̄(λ) Δλ (and Y, Z) with S = CIE standard illuminant D65 and x̄, ȳ, z̄ = the CIE 1931 2° observer,
  the CIE tables at 1 nm from 360 to 830 nm, and k = 100/Σ S(λ) ȳ(λ) Δλ (CIE 15:2018 §7);
- CIELAB with the perfect diffuser under D65 as white (constants as in [Colorimetry](COLORIMETRY.md#colour-difference-and-cielab));
- sRGB: the XYZ is scaled from the D65 table's white to the sRGB white (0.3127, 0.3290) (they differ by about 3·10⁻⁵ in
  x and y), converted with the CSS Color 4 matrix, encoded with the sRGB transfer function and rounded to 8 bits.

The CIE tables are datasets the engine does not bundle, because of their license ([Colorimetry](COLORIMETRY.md#data-policy-what-is-and-is-not-bundled);
attribution and license in `THIRD_PARTY.md`).
`scripts/compute-color-patch-reference.mjs` downloads them (D65: DOI 10.25039/CIE.DS.hjfjmt59; CIE 1931:
DOI 10.25039/CIE.DS.xvudnb9b) into a temporary directory, checks their SHA-256, computes these values from the built
package's spectra, compares them with the published ones and deletes the tables; `--print` prints the table in
[The patches](#the-patches). The repository stores only the computed values.

**Gamut.** All 30 patches are inside the sRGB gamut: every linear sRGB component lies in [0, 1]. None is marked as
outside. The two gamut-edge patches are close to the boundary: Sunset Flare Orange's smallest linear component (blue)
is 0.0105 and Blacklight Violet's (green) 0.0133.

## Distinct from third-party colors

The owner asked (2026-11-01) that the published color codes not match any official third-party color where possible.
`scripts/check-color-patch-distinctness.mjs` checks every patch's published hex and CIELAB against these openly
published reference sets:

| Set | Colors | Source |
| --- | --- | --- |
| `css` | 148 | The CSS named colors: W3C, CSS Color Module Level 4, Candidate Recommendation Draft 24 April 2025, §6.1 |
| `colorchecker-srgb` | 24 | The 24-patch ColorChecker Classic, the manufacturer's sRGB values as tabulated in Wikipedia, "ColorChecker" (revision 1367818471) |
| `colorchecker-lab` | 96 | The same 24 patches' published CIELAB/xyY (ICC D50) values: X-Rite before and after November 2014, GretagMacbeth 2005 and the BabelColor average, as collected in colour-science 0.4.6 |
| `ral` | 215 | RAL Classic approximate sRGB values as tabulated in Wikipedia, "List of RAL colours" (revision 1369650571); the RAL Classic sections only |
| `brands` | 10,386 | Brand colors from Simple Icons releases 1.20.0, 2.19.0, 4.25.0, 9.21.0 and 16.36.0: about 3,800 tech, social-media, retail, drinks and other brands, with brands removed from later releases kept from earlier ones |

Pantone's data is proprietary and was not used or checked; no openly published approximation of it was used. The
sources' terms are recorded in `THIRD_PARTY.md`.

**Rule.** For each patch: no reference color has the same 8-bit sRGB hex, and every reference color is at least
ΔE00 2.0 (CIEDE2000, the engine's `calculateColorDifference`) from the patch's published CIELAB. Neutral patches are
flat spectra, so they cannot avoid the many gray reference colors in hue: for them only the hex rule applies, and the
closest match is reported. A reference color given as sRGB is converted to CIELAB with the CSS Color 4 matrix and the
sRGB D65 white; ICC D50 values are adapted to D65 with the Bradford transform (ICC.1:2010 Annex E) and also rounded to an
8-bit sRGB hex for the hex rule.

**Method.** The script downloads each source from its pinned URL, checks its SHA-256, parses it in memory and discards
it: no third-party color data is written to disk or stored in the repository, the package or the tests (license policy,
`THIRD_PARTY.md`). Run `npm run build`, then `node scripts/check-color-patch-distinctness.mjs --print`; it exits 1 if a
patch fails. `--candidates file.json` checks proposed values before they are published.

**Nudged patches.** Thirteen of the first design's colors failed the rule (2026-11-01). Each target color was moved by the
smallest amount, searched on a 0.5-unit CIELAB grid, that clears the rule while keeping the patch's role, and its
spectrum was refit with the design method above, from its previous parameters and with the same terms; the published
values were then recomputed from the rounded spectrum. The neutrals were moved by 0.001–0.004 in reflectance, keeping
steps of 14.6–15.0 L*. ΔE00 is from the first design's published value to the new one.

| Code | Name | sRGB before → after | CIELAB before → after | ΔE00 | Too close before to |
| --- | --- | --- | --- | --- | --- |
| PV-N1 | Studio Gray 1 | `#F3F3F3` → `#F4F4F4` | 96.00, 0, 0 → 96.04, 0, 0 (R 0.900 → 0.901) | 0.02 | ColorChecker White, same hex |
| PV-N3 | Studio Gray 3 | `#A0A0A0` → `#A1A1A1` | 65.98 → 66.06 (R 0.353 → 0.354) | 0.06 | ColorChecker Neutral 6.5, same hex |
| PV-N4 | Studio Gray 4 | `#7A7A7A` → `#7B7B7B` | 51.04 → 51.50 (R 0.193 → 0.197) | 0.46 | ColorChecker Neutral 5, same hex |
| PV-N5 | Studio Gray 5 | `#555555` → `#565656` | 35.98 → 36.56 (R 0.090 → 0.093) | 0.49 | ColorChecker Neutral 3.5, same hex |
| PV-N6 | Studio Gray 6 | `#323232` → `#353535` | 20.83 → 21.94 (R 0.032 → 0.035) | 0.78 | ColorChecker black (X-Rite after 2014) and a brand gray, same hex |
| PV-S1 | Darkroom Red | `#C42B30` → `#BF3428` | 43.75, 59.12, 35.74 → 43.70, 54.15, 39.93 | 3.53 | brand reds (ΔE00 0.82) |
| PV-S3 | Hedgerow Green | `#3A9A4A` → `#359C4C` | 56.59, −45.57, 33.69 → 57.08, −47.07, 33.20 | 0.78 | a brand green (1.82) |
| PV-S4 | Harbor Cyan | `#1A9DB0` → `#3C98AA` | 59.38, −26.08, −19.25 → 58.40, −21.56, −17.23 | 2.39 | a brand cyan (0.52) |
| PV-S5 | Cyanotype Blue | `#2F4FA6` → `#3C4C9E` | 35.86, 18.89, −50.44 → 35.27, 19.89, −46.48 | 2.64 | a brand blue (0.58) |
| PV-M1 | Midday Sky | `#6B95C8` → `#6893CB` | 60.59, −0.50, −30.79 → 60.05, 0.53, −33.31 | 0.80 | a brand blue (1.70) |
| PV-M2 | Canopy Green | `#4D6A2C` → `#4B692C` | 41.26, −21.99, 30.95 → 40.81, −22.40, 30.31 | 0.59 | CSS `darkolivegreen` (1.90) |
| PV-M4 | Low Tide Sand | `#D6C29A` → `#D5C29B` | 79.13, 0.98, 22.72 → 79.14, 0.48, 22.19 | 0.56 | RAL 1014 Ivory (1.89) |
| PV-G1 | Sunset Flare Orange | `#F0520B` → `#DC511A` | 56.71, 58.31, 64.93 → 53.19, 52.38, 56.53 | 4.04 | brand oranges (1.14) |

Red and the deep orange needed the largest moves: saturated reds and oranges are where brand colors are densest, and
the deep orange cannot move outward past the sRGB boundary. The red's chroma floor was kept at 64 (it is 67.3, hue
36.4°); the deep orange kept its hue (47.2°) and its place near the gamut edge (smallest linear component 0.0105, chroma
77.1, from 87.3). The strong and soft hues still run red, yellow, green, cyan, blue, magenta in increasing hue angle, each
soft patch at lower chroma than its strong one.

**Result.** The closest reference color to each published patch:

| Code | Id | sRGB | Closest reference color | Set | Its sRGB | ΔE00 |
| --- | --- | --- | --- | --- | --- | --- |
| PV-N1 | `neutral-1` | `#F4F4F4` | White (19) | colorchecker-srgb | `#F3F3F3` | 0.12 |
| PV-N2 | `neutral-2` | `#C9C9C9` | Neutral 8 (20) | colorchecker-srgb | `#C8C8C8` | 0.29 |
| PV-N3 | `neutral-3` | `#A1A1A1` | Neutral 6.5 (21) | colorchecker-srgb | `#A0A0A0` | 0.16 |
| PV-N4 | `neutral-4` | `#7B7B7B` | Neutral 5 (22) | colorchecker-srgb | `#7A7A7A` | 0.28 |
| PV-N5 | `neutral-5` | `#565656` | Neutral 3.5 (23) | colorchecker-srgb | `#555555` | 0.35 |
| PV-N6 | `neutral-6` | `#353535` | Black (24) | colorchecker-srgb | `#343434` | 0.17 |
| PV-S1 | `red` | `#BF3428` | Firewalla (Simple Icons 9.21.0) | brands | `#C8332D` | 2.23 |
| PV-S2 | `yellow` | `#E6C02A` | yellow (X-Rite before Nov 2014) | colorchecker-lab | `#EEC614` | 2.27 |
| PV-S3 | `green` | `#359C4C` | Gunicorn (Simple Icons 9.21.0) | brands | `#499848` | 2.52 |
| PV-S4 | `cyan` | `#3C98AA` | Open Source Hardware (Simple Icons 9.21.0) | brands | `#0099B0` | 2.47 |
| PV-S5 | `blue` | `#3C4C9E` | Picard Surgelés (Simple Icons 9.21.0) | brands | `#2D4999` | 2.38 |
| PV-S6 | `magenta` | `#B4408E` | MusicBrainz (Simple Icons 2.19.0) | brands | `#BA478F` | 2.30 |
| PV-T1 | `red-soft` | `#C77B78` | RAL 3014 Antique pink | ral | `#D47479` | 3.88 |
| PV-T2 | `yellow-soft` | `#DCC985` | Glance (Simple Icons 16.36.0) | brands | `#D9C38C` | 3.31 |
| PV-T3 | `green-soft` | `#7FAE85` | RAL 6021 Pale green | ral | `#86A47C` | 4.24 |
| PV-T4 | `cyan-soft` | `#7DB9C2` | RAL 6034 Pastel turquoise | ral | `#7FB0B2` | 3.77 |
| PV-T5 | `blue-soft` | `#7486BD` | Discord (Simple Icons 1.20.0) | brands | `#7289DA` | 4.37 |
| PV-T6 | `magenta-soft` | `#B984A8` | Sass (Simple Icons 1.20.0) | brands | `#CC6699` | 9.14 |
| PV-P1 | `skin-pale` | `#E8C3AA` | Setapp (Simple Icons 9.21.0) | brands | `#E6C3A5` | 2.33 |
| PV-P2 | `skin-medium` | `#C99A7D` | Light skin (2) | colorchecker-srgb | `#C29682` | 3.45 |
| PV-P3 | `skin-tan` | `#A3714F` | Mocha (Simple Icons 2.19.0) | brands | `#8D6748` | 6.06 |
| PV-P4 | `skin-deep` | `#6A4532` | RAL 8007 Fawn brown | ral | `#6F4A2F` | 3.57 |
| PV-M1 | `sky-blue` | `#6893CB` | Goldman Sachs (Simple Icons 16.36.0) | brands | `#7399C6` | 2.47 |
| PV-M2 | `foliage-green` | `#4B692C` | darkolivegreen | css | `#556B2F` | 2.40 |
| PV-M3 | `brick-red` | `#9C4A3A` | RAL 3016 Coral red | ral | `#AC4034` | 4.04 |
| PV-M4 | `sand` | `#D5C29B` | RAL 1014 Ivory | ral | `#DDC49A` | 2.41 |
| PV-M5 | `teal` | `#2E7F7C` | teal | css | `#008080` | 2.40 |
| PV-M6 | `lavender` | `#A99BCB` | Refined GitHub (Simple Icons 16.36.0) | brands | `#9E95B7` | 4.71 |
| PV-G1 | `deep-orange` | `#DC511A` | Klout (Simple Icons 1.20.0) | brands | `#E44600` | 2.15 |
| PV-G2 | `deep-violet` | `#4C1E9C` | Kodular (Simple Icons 16.36.0) | brands | `#4527A0` | 2.17 |

**Sources of the "Its sRGB" column.** Each value is the closest reference color's own published sRGB hex, or for
`colorchecker-lab` a conversion of its published CIELAB, given as a factual result of the check. Nothing else from the
sources is reproduced here.

- `colorchecker-srgb` (7 values) and `ral` (6 values): from Wikipedia contributors,
  ["ColorChecker"](https://en.wikipedia.org/w/index.php?oldid=1367818471) (revision 1367818471) and
  ["List of RAL colours"](https://en.wikipedia.org/w/index.php?oldid=1369650571) (revision 1369650571), Wikipedia,
  licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The values are copied unchanged,
  one per patch.
- `colorchecker-lab` (1 value, PV-S2): the X-Rite (before November 2014) CIELAB value as collected in
  [colour-science 0.4.6](https://github.com/colour-science/colour/tree/v0.4.6), Copyright 2013 Colour Developers,
  BSD-3-Clause. The script adapted it from D50 to D65 (Bradford) and rounded it to an 8-bit sRGB hex.
- `css` (2 values): the CSS named colors, W3C, CSS Color Module Level 4 (Candidate Recommendation Draft, 24 April
  2025), under the [W3C Software and Document License](https://www.w3.org/copyright/software-license/).
- `brands` (14 values): [Simple Icons](https://github.com/simple-icons/simple-icons), whose data is dedicated to the
  public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

**Trademarks.** ColorChecker, RAL and the other product, company and brand names mentioned are trademarks of their
respective owners. They are used only to identify the color sets and products compared against or cited; Photivra is
not affiliated with or endorsed by them.

All 24 colored patches are at least ΔE00 2.15 from every reference color. The six neutrals have no equal hex but stay
within ΔE00 0.12–0.35 of the ColorChecker's neutral ramp, because that ramp, like this one, steps in about 15 L* from a
90 % white; a ramp distinct from it by ΔE00 2 would need a darker white or uneven steps.

## Accuracy

Measured with `simulateIdealReference()` (the capture's development without noise, blur or mosaic) of the
`color-patches` chart, CIELAB of each patch center relative to the sRGB white scaled to the white neutral's reflectance,
against the published values (ΔE00, CIEDE2000):

| Illuminant | Sensor quadrature | Maximum ΔE00 | Mean ΔE00 |
| --- | --- | --- | --- |
| CIE D65 (the CIE table passed as `{ kind: "spectrum" }`) | 1 nm | 0.19 (PV-S1) | 0.08 |
| CIE D65 (the same) | 5 nm | 0.24 (PV-S1) | 0.09 |
| CIE D65 (the same) | 20 nm (the default) | 1.41 (PV-N1) | 0.75 |
| Planckian 6500 K (the facade default) | 5 nm | 1.12 (PV-G1) | 0.39 |

- Under D65 the residual is the engine's analytic approximation of the CIE 1931 observer
  ([Colorimetry](COLORIMETRY.md#colour-matching-functions-and-spectral-integration)).
  `node scripts/compute-color-patch-reference.mjs --render` repeats the two D65 rows and fails above ΔE00 0.3.
- Under the default 6500 K Planckian the difference is the illuminant: its spectrum is not D65's, and the patches are
  white-balanced to that light.
- At the default 20 nm quadrature the scene-illuminant white balance is measured from the white diffuser on 1 nm nodes,
  while the sensor integrates on 20 nm nodes. For a spectrum with as much fine structure as the D65 table that leaves
  a neutral cast: a* −0.74, b* +0.95 on the white patch. It is small for the smooth built-in illuminants (6500 K
  Planckian: a* 0.17, b* 0.36; illuminant A: b* −0.17) and below 0.03 with 5 nm nodes. This is a property of the facade
  at its default quadrature, not of the patches.

`test/color-patches.test.ts` checks, without the CIE tables: the codes, names and reasons; the formula against the
published terms and the unused clamp; the neutral L* against 116·R^(1/3) − 16; the published hex against the published
CIELAB; the published hue order of the strong and soft patches and the skin tones; that the neutral patches stay neutral after white balance under the 6500 K Planckian and illuminant A (ideal reference and a noisy
capture); that the strong and the soft hues each run red, yellow, green, cyan, blue, magenta in increasing hue angle,
the soft ones at lower chroma, and the skin tones fall in lightness from fair to deep; that the rendered CIELAB under the
6500 K Planckian agrees with the published values within ΔE00 1.35 (mean 0.45); that `color-patches` renders exactly
what `patches` with the same reflectances renders; and that existing charts render bit-identically to 2.13.0.

## Display view and GPU

The display view takes the chart path for the patches, as for a caller spectrum. It evaluates the built-in spectra with
the engine's portable exponential, so the display view's chart presets give the same bits in every JavaScript engine
([Display view](DISPLAY_VIEW.md#same-bytes-in-every-engine)); captures use `Math.exp`, like their other continuous
formulas. Inside a caller material scene or a material-layers scene the display view uses `Math.exp`. The WebGPU chart
stage classifies a `color-patches` element with the `patches` geometry; reflectances are evaluated in float64 on the CPU.

## Cost

A built-in patch's values are memoized per wavelength, so a capture evaluates each patch's formula once per quadrature
node. Measured on one machine (Apple M5 Pro, Node 24.19, built `dist`, medians of 7 captures and 5 display views; not a
performance claim; measured on the first design of #537, whose formulas are the same): a 600 × 500 capture of the 30-patch chart took 95–101 ms, the same as a 30-patch `patches` chart
of neutral grays (93–95 ms) or of tabulated caller spectra (99 ms); a 300 × 250 display view of a 1200 × 1000 frame
took 375–397 ms against 350–412 ms for the neutral chart. Charts that do not use the patches run the same code as
before.

The patch table adds about 9,800 B minified (about 4,100 B gzip) to a bundle of `simulateCapture` and
`simulateIdealReference` (rolldown, as in `test/capture-bundle.test.ts`), about 1.1 % of it: 6,526 B (2,671 B gzip)
for the spectra and reference values, and 3,285 B (1,420 B gzip) for the codes, names and reasons. The display view's
addition to a capture bundle is unchanged (45,613 B minified, within its budget), and captures still use only the four portable-math functions that test allows.
