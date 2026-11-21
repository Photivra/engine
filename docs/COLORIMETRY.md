# Colorimetry

Photivra's colorimetry primitives live in `src/color/`. They cover colour-matching functions (CMFs), spectral integration, illuminants and correlated colour temperature (CCT), chromatic adaptation, CIELAB colour differences, camera-matrix fitting, Kelvin + tint white balance, wide-gamut RGB spaces with SDR transfer functions (sRGB, BT.709, BT.1886), and perceptual gamut mapping. All of them are deterministic, browser-safe functions. Each one is labelled `calculated`, `approximation` or `estimated` exactly as described below.

These are standalone primitives. They do not change scene radiance, exposure, sensor capture or any existing default. The SDR/export stages own output wiring.

## Data policy: what is and is not bundled

The CIE distributes its tabulated datasets under **CC BY-SA 4.0**. These include the CIE 1931/1964 CMFs, the daylight basis S₀/S₁/S₂ and the D65/A tables; the dataset metadata (for example DOI 10.25039/CIE.DS.xvudnb9b) declares this licence. The ShareAlike condition would bind adaptations of those tables, and this conflicts with distributing the package under Apache-2.0 alone. **No CIE table is therefore bundled.** Instead:

- CIE 1931 2° CMFs are available as the engine's own **analytic approximation** (see below), or as caller-supplied tables (`{ kind: "tabulated", … }`). A caller may load the official CIE CSV themselves under its licence.
- CIE daylight spectra need a caller-supplied S₀/S₁/S₂ basis (`createCieDaylightSpectrum`). The daylight-locus chromaticity and the M₁/M₂ weights are equations and are built in.
- Illuminant A and Planckian radiators are computed from their defining formulas.
- The engine bundles no ColorChecker or other third-party reflectance tables, because their licences are unclear. Training reflectances for matrix fitting are supplied by the caller. From 2.14 it has its own [color patches](COLOR_PATCHES.md): 30 analytic spectra designed by Photivra, whose reference CIELAB under D65 is computed once from the CIE tables by a script that does not store them.

The tests assert no values taken from CIE tables (owner decision, October 17, 2026). They check internal consistency, normalization, round trips, and values computed inside the test from Planck's law and the daylight formula. The comparisons with CIE data below were computed once, outside the repository.

## Colour-matching functions and spectral integration

`estimateCie1931ColorMatchingFunctions(λ)` evaluates the engine's own analytic **approximation** of the CIE 1931 2° observer. Each function is a sum of split Gaussian lobes. A lobe has an amplitude a, a centre μ, and one standard deviation for wavelengths below the centre and another for wavelengths above it:

x̄(λ) = Σᵢ aᵢ exp(−½((λ − μᵢ)/σᵢ)²), with σᵢ = σᵢ,below for λ < μᵢ and σᵢ,above otherwise.

x̄ has three lobes (one of them negative), and ȳ and z̄ have two each. This kind of model, a sum of piecewise Gaussians, was proposed by Wyman, Sloan & Shirley (2013, JCGT 2(2)). The engine does not use that paper's coefficients (the paper is CC BY-ND 3.0; owner decision, October 17, 2026). It fits its own:

- **Data:** the CIE 1931 2° table, DOI 10.25039/CIE.DS.xvudnb9b (CC BY-SA 4.0), at 1 nm from 360 to 830 nm. `scripts/fit-cie-1931-cmf.mjs` downloads it into a temporary directory, checks its SHA-256, uses it and deletes it. No CIE value is stored in the repository.
- **Fit:** least squares with equal weights over the 471 samples, solved by Levenberg–Marquardt from 400 deterministic pseudo-random starts per function. A penalty keeps every function non-negative (checked on a 0.01 nm grid). The coefficients are rounded to six significant digits.
- **Domain:** accepted on 360–830 nm; fails closed outside it.

**Measured fit error**, our fit against the CIE 1931 table at its 471 wavelengths. The Wyman et al. (2013) coefficients were evaluated the same way, once and outside the repository, for comparison only:

| | x̄ | ȳ | z̄ |
| --- | --- | --- | --- |
| Engine fit: maximum absolute error | 0.0122 (516 nm) | 0.00733 (528 nm) | 0.0221 (434 nm) |
| Engine fit: RMS error | 0.00426 | 0.00265 | 0.00397 |
| Wyman et al. 2013: maximum absolute error | 0.0140 (631 nm) | 0.00800 (528 nm) | 0.0222 (434 nm) |
| Wyman et al. 2013: RMS error | 0.00559 | 0.00267 | 0.00399 |

Integrated with 1 nm nodes over 360–830 nm, the engine fit gives chromaticities that differ from those integrated with the CIE table by (Δx, Δy) = (+4.0e-4, −0.7e-4) for illuminant A and (+3.0e-4, −0.8e-4) for the equal-energy white. The Wyman fit gave (−1.3e-3, +1.2e-3) and (−3.6e-4, +3.8e-4). Use caller-tabulated CMFs when you need closer colorimetric agreement.

`integrateSpectrumToXyz()` evaluates X = k Σ S(λᵢ) R(λᵢ) x̄(λᵢ) Δλᵢ with caller-explicit quadrature nodes `{ wavelengthNanometers, wavelengthMeasureNanometers }`. This is a quadrature of the tristimulus integral X = ∫ L(λ) x̄(λ) dλ (and likewise Y, Z), as defined in Wyman, Sloan & Shirley (2013), Eq. 1 (free; also CIE 15:2018 §7), with the stimulus L = S·R. The normalization k and the nodes are explicit engine choices:

- Nodes from `calculateSensorSpectralQuadrature()` are structurally compatible.
- `createColorimetricMidpointQuadrature()` builds uniform midpoint nodes.
- A 1 nm / 5 nm node list reproduces the CIE summation convention.

Normalization is explicit:

- `white-luminance-one`: k = 1/Σ S ȳ Δλ, so the perfect diffuser has Y = 1.
- `scale`: a caller factor, for example 683.002 lm/W for photometric units.

Spectra are either tabulated (linear interpolation, fail-closed outside the table) or in-process functions over a declared range.

## Illuminants, Planckian locus and CCT

| Function | Model | Status |
| --- | --- | --- |
| `calculatePlanckianSpectralRadiance`, `createPlanckianSpectrum` | Planck's law L = 2hc²/λ⁵/(exp(hc/λkT) − 1) (BIPM *Mise en pratique* for the kelvin, Absolute Primary Radiometry, Eq. 1, free), exact SI h, c, k (SI Brochure 2019), so c₂ = hc/k = 1.438 776 877…e-2 m·K (NIST CODATA 2022), W·m⁻²·sr⁻¹·nm⁻¹, vacuum wavelength | calculated |
| `calculateCieIlluminantARelativeSpectralPower`, `createCieIlluminantASpectrum` | Planck's law relative to 560 nm, S_A(λ) = 100·(560/λ)⁵·(exp(c₂/(560·T)) − 1)/(exp(c₂/(λ·T)) − 1), with the CIE's defining constants c₂ = 1.435e-2 m·K and T = 2848 K (not the exact c₂; 2848 K × 1.438 776 877/1.435 ≈ 2855.5 K with the exact one), 300–830 nm. The constants are CIE 015:2018 Eq. 4.1 (paid); see the check below | calculated |
| `calculateCieDaylightComponentWeights` | CIE daylight-locus x_D(T) polynomials (4000–7000 K and 7000–25000 K), y_D = −3x² + 2.87x − 0.275, and the M₁/M₂ weights, from CIE 015:2018 §4.1.2 (paid; no free text found, see below). Optional CIE three-decimal rounding of M₁, M₂ | calculated |
| `createCieDaylightSpectrum` | S = S₀ + M₁S₁ + M₂S₂ from a caller basis | calculated from caller data |
| `estimatePlanckianLocusChromaticity` | Planck's law integrated against the engine's analytic CIE 1931 CMFs, 1 nm nodes 360–830 nm, 1000–100000 K (the default locus, `planck-analytic-cmf`) | approximation (from the CMF fit) |
| `calculatePlanckianChromaticity` | The default locus, or Planck × CMF integration with caller CMFs and nodes (`planck-integration`) | approximation / calculated |
| `estimateCorrelatedColorTemperatureMcCamy` | McCamy (1992), Color Res. Appl. 17(2):142–144: n = (x − 0.3320)/(0.1858 − y), CCT = 449n³ + 3525n² + 6823.3n + 5520.33 | approximation |
| `calculateCorrelatedColorTemperature` | Nearest point on the chosen Planckian locus in CIE 1960 uv (the CCT/Duv definition as stated in Smet et al. 2023, free; also CIE 15:2018): the root of the analytic temperature derivative of the squared uv distance, by safeguarded Newton iteration (see below). Signed Duv: positive above the locus (greenish), negative below (magenta). The sign follows Ohno (CORM 2011 slides, free, slide 5), and the engine documents and tests it. Fails closed for \|Duv\| > 0.05, the range over which Smet et al. evaluate CCT methods (CIE 15:2018, paid, gives the same limit) | follows the locus model |
| `calculateChromaticityFromCorrelatedColorTemperature` | Locus point (Planckian or CIE daylight) offset by Duv along the unit normal of the Planckian locus in uv. Fails closed when the offset point is not a chromaticity (x ≥ 0, y > 0, x + y ≤ 1), the same domain every chromaticity input must satisfy: for example 2000 K with Duv +0.02 would give x + y ≈ 1.06 | follows the locus model |

**The Planckian locus** is the chromaticity of a Planckian radiator, x(T) = X/(X + Y + Z) and y(T) = Y/(X + Y + Z) with X = Σ L(λᵢ, T) x̄(λᵢ) Δλᵢ (and likewise Y, Z), where L is Planck's law above. The constant 2hc² cancels. The default locus samples the CMFs and 1/λ⁵ once, so each temperature costs one exponential per node, and the CCT search caches its 201-point coarse scan per locus. The 2.0.0 default replaced the Kang et al. (2002) cubic spline (often called the Kim spline; see `THIRD_PARTY.md`), whose coefficients were removed by owner decision (October 17, 2026).

**The CCT search** finds the T where dF/dT = 0 for F = (u − u₀)² + (v − v₀)², the squared uv distance from the target (u₀, v₀). It works in x = 1/T (the roots are the same, since dx/dT = −1/T²). With aᵢ = c₂/λᵢ and rᵢ = 1/(exp(aᵢx) − 1), each node of X, Y, Z is proportional to λᵢ⁻⁵ rᵢ, and exactly dr/dx = −a(r + r²) and d²r/dx² = a²(r + 3r² + 2r³). These are summed in the same quadrature as X, Y, Z, so u, v and their first two derivatives cost one exponential per node. The coarse scan brackets the minimum, Newton's method on ½ dF/dx starts from the parabola through the three nearest scan points, and any step that would leave the bracket becomes a bisection. It stops once a step changes T by at most 1e-10 of T. If the scan minimum is a range limit, the result is that limit only when the nearest point lies outside it by no more than that tolerance; otherwise the call fails closed. Duv is measured along the analytic unit normal at the result. The inverse, `calculateChromaticityFromCorrelatedColorTemperature`, uses the same analytic normal. The 2.0.0 default replaced the Kim et al. (2002) cubic spline, whose coefficients were removed by owner decision (October 17, 2026).

Measured in the tests (no CIE table values):

- **Locus:** u decreases monotonically with T from 1000 to 100000 K, and the default locus equals the explicit Planck integral (`planck-integration` with the analytic CMFs on the same nodes) and `integrateSpectrumToXyz` of a Planckian spectrum.
- **Illuminant A:** its spectrum is proportional to Planck's law at 2848 K × c₂/1.435e-2 ≈ 2855.5 K, its chromaticity is the locus point at that temperature, and the CCT search recovers that temperature with |Duv| < 1e-9.
- **McCamy cross-check:** on the default locus McCamy's cubic agrees within 20 K over 2856–6504 K (measured maximum 15 K). McCamy's cubic itself deviates from a locus integrated with the CIE table by up to 10 K over that range, 19 K at 2000 K, 17 K at 8000 K, 118 K at 10000 K and 442 K at 12500 K (computed once, outside the repository).
- **Round trips:** CCT + Duv → chromaticity → CCT + Duv returns the inputs (CCT to 1e-9 relative, Duv to 1e-12) from 1000 to 100000 K, both limits included.
- **Exact root:** the CCT and Duv of 19 chromaticities from 1100 to 95000 K agree with a 50-digit reference of the same discrete locus (`test/fixtures/planckian-cct/generate_reference.py`: dense evaluation of F, then the exact root of dF/dx) to 1e-10 of T and 1e-13 in Duv. CCT increases monotonically along the locus, and points beyond either range limit fail closed.
- **Daylight polynomial:** it satisfies y = −3x² + 2.87x − 0.275, x falls with T, and the daylight locus lies above the Planckian locus (0 < Duv < 0.01) over 4000–25000 K.
- **A greenish light has a positive Duv:** chromaticities moved from the locus toward the BT.709 green primary give Duv > 0, and moved away give Duv < 0, at 2700, 4000 and 6500 K.

**Accuracy of the default locus** (computed once, outside the repository, against a locus integrated with the CIE 1931 1 nm table on the same nodes): the uv distance is at most 1.05e-3 at 1667 K, 5.5e-4 at 2000 K, and 2.83e-4 from 2856 to 25000 K. The removed Kang et al. spline was within 3.7e-4 of that table locus over 1667–25000 K, so it was closer above about 3000 K. For an exact table-based locus, pass CIE CMFs as `planck-integration`.

**Change from the Kang et al. spline default of earlier 2.0.0 drafts**: uv moves by at most 1.42e-3 at 1667 K and 7.0e-4 from 2000 to 25000 K. The CCT of the daylight-locus point at 6504 K moves from 6500.0 K (Duv 0.00323) to 6516.6 K (Duv 0.00345), and at 5000 K from 4996.2 K to 5011.5 K. Kelvin white-balance gains for an XYZ camera change by at most 0.5 % (blue at 2856 K).

**Cost** (`node scripts/benchmark-planckian-locus.mjs`, Node 24.21, linux-x64 container, median of 9 × 200 calls), Kim spline → Planck locus with golden-section search: locus point 0.5 → 6.8 µs, CCT/Duv search 21 → 391 µs, chromaticity from CCT + Duv 1.1 → 19 µs, Kelvin white balance 4.1 → 20.9 µs, and the first CCT call (which prepares the default locus) 0.9 → 7.0 ms. A `planck-integration` CCT call with caller CMFs on 471 nodes fell from 9.7 to 2.3 ms.

**The Newton root-find** (October 17, 2026; same script and machine, medians of three runs of 9 × 200 calls, 4-vCPU Xeon 2.1 GHz): the CCT/Duv search fell from 366 µs to 31.3 µs (11.7×), because it evaluates the locus about 4 times (at most 6) instead of 58. Chromaticity from CCT + Duv fell from 22.5 to 16.5 µs, and Kelvin white balance from 21.3 to 18.6 µs (an analytic normal instead of three finite-difference locus points). A `planck-integration` CCT call (analytic CMFs, 471 nodes; dominated by preparing the locus and its scan) measured 2.69 → 2.00 ms.

**Accuracy of the search** (659 chromaticities: 67 temperatures, 1000–100000 K, × 11 Duv values from −0.0499 to 0.0499, built with the inverse, against a 50-digit reference root): the Newton result is within 2.9e-7 K (3.3e-12 relative). The golden-section search it replaced was off by up to 1.9e-3 K below 10000 K, 6.0e-3 K at 10000–25000 K, 0.025 K at 25000–50000 K and 0.089 K (1.2e-6 relative, at 73564 K), because F is too flat near its minimum to locate by comparing values. Results therefore change by those amounts. Duv changes by at most 8.3e-16. The inverse moves xy by at most 9.3e-10 inside the range and 1.4e-7 at exactly 1000 or 100000 K, where the old finite-difference normal was one-sided; at Duv = 0 it is unchanged. Chromaticities whose nearest locus point lies just inside a range limit (beyond the last coarse-scan point) now resolve instead of failing.

**Checks against the free CIE datasets** (CC BY-SA 4.0; downloaded from <https://cie.co.at/data-tables> on October 17, 2026 for the check only, not bundled or copied):

- *Illuminant A* (DOI 10.25039/CIE.DS.8jsxjrsn, 300–830 nm in 1 nm steps, values rounded to six digits): the engine's formula reproduces all 531 values within a relative difference of 4.8e-6, which is the table's rounding.
- *Daylight M₁/M₂* (components DOI 10.25039/CIE.DS.w7zunnny; D55 DOI 10.25039/CIE.DS.qewfb3kp; D65 DOI 10.25039/CIE.DS.hjfjmt59): with the polynomial at 5503.06 K and 6503.62 K (5500 K and 6500 K × 1.4388/1.4380) and three-decimal rounding, M₁, M₂ = (−0.785, −0.198) for D55 and (−0.295, −0.689) for D65. S₀ + M₁S₁ + M₂S₂ then reproduces the D55 table within 5.0e-4 and the D65 table within 8.5e-4 at every 5 nm node, which is their rounding.

These checks confirm the coefficients, but not their source text. The daylight polynomial and M₁/M₂ come from Judd, MacAdam & Wyszecki (1964), *JOSA* 54(8):1031, and CIE 015:2018. No free-to-read copy of either was found (the publisher lists the paper as subscription-only), so this part of the citation audit stays open.

## Chromatic adaptation

`calculateChromaticAdaptationMatrix()` builds a linear von Kries-type transform:

M = C⁻¹ · diag(D·(Y_s/Y_d)·ρ_d/ρ_s + 1 − D) · C

This is the one-step two-illuminant form of Li et al. (2017), applied to every cone space. With D = 1 the source white maps exactly to the destination white, keeping the source-white luminance. With D = 0 the transform is the identity.

| `transform` | Cone matrix C (published constants) |
| --- | --- |
| `bradford` | Linearized Bradford: Lam (1985), Univ. of Bradford thesis; Luo & Rhodes (1999); ICC.1:2010 Annex E |
| `cat16` | Li, Li, Wang, Xu, Luo, Cui, Melgosa & Pointer (2016), *A Revision of CIECAM02 and its CAT and UCS*, IS&T CIC24, Eq. (15) (free; see below); journal version Li et al. (2017), Color Res. Appl. 42(6):703–718 |
| `xyz-scaling` | Identity: diagonal scaling in XYZ (the weakest model) |

The degree of adaptation D is a number the caller supplies (default 1, complete adaptation). The matrix is calculated exactly. How well a linear CAT predicts corresponding colours is a property of that model and is not claimed here. The test suite checks that the Bradford cone matrix equals ICC.1:2010 Annex E Eq. (E.1), and that the D65→D50 matrix equals the Annex E construction (Eq. E.2–E.4) evaluated independently in the test, to 1e-12. D65 comes from its ITU-R BT.709-6 chromaticity and D50 is the ICC PCS illuminant (0.9642, 1.0, 0.8249). ICC.1:2010 is free to download under a permissive ICC copyright licence.

**Free sources for the cone matrices.** The CAT16 matrix is printed as M16 in Eq. (15) of Li et al. (2016), *A Revision of CIECAM02 and its CAT and UCS*, IS&T 24th Color and Imaging Conference, pp. 208–212, doi:[10.2352/ISSN.2169-2629.2017.32.208](https://doi.org/10.2352/ISSN.2169-2629.2017.32.208). The paper is free to download from the IS&T library (<https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/cic/24/1/art00035>). On October 17, 2026 we downloaded it and checked that all nine coefficients of Eq. (15) equal the engine's `cat16` matrix (row 0: 0.401288, 0.650173, −0.051461). CAT02 is not part of 2.0: the same paper names the CAT02 matrix M02 but does not print it, and no free source we could confirm prints it (owner decision, October 17, 2026), so `transform: "cat02"` is rejected. For the same reason the von Kries Hunt–Pointer–Estévez transform (`"von-kries-hpe"`) and a helper computing D from the CIECAM02 formula are not part of 2.0: the paper names the HPE matrix but prints neither it nor that formula (owner decision, October 17, 2026). A public-record patent check found no patent claiming the CAT16 or CAT02 matrix (see the patent review in `THIRD_PARTY.md`).

### Scene adaptation in the capture colour transform

`calculateCaptureColorTransform()` keeps its default unchanged. `whiteBalance: { kind: "adopted-white-xyz-scaling" }` with no `transform` is still the original XYZ-diagonal scaling. Its model id stays `capture-color-xyz-diagonal-adaptation` and its applied-transform id stays `photivra-xyz-diagonal-adaptation`. That default is documented as an approximation, not as provisional.

Adding `transform: "bradford" | "cat16"` selects complete (D = 1) cone-space adaptation to D65:

- model id `capture-color-<transform>-adaptation`;
- applied-transform profile `photivra-<transform>-adaptation`;
- still labelled `approximation`.

The review measured how far XYZ scaling departs from Bradford for illuminant A → D65: ΔE76 up to about 17 on saturated colours. The cone-space option exists to avoid that error.

## Kelvin + tint white balance

`createColorTemperatureWhiteBalanceIntent()` still only records intent. `resolveColorTemperatureWhiteBalance()` turns that intent into channel gains for an explicit camera colour model `{ profileId, profileVersion, xyzToCameraRgb }`:

1. white xy = locus(CCT) offset by Duv = `tint` (`tintInterpretation: "duv-cie-1960-uv"`, |Duv| ≤ 0.05), using the `planckian` or `cie-daylight` locus. The default Planckian locus model is `planck-analytic-cmf` (Planck integrated against the analytic CMFs); `planck-integration` with tabulated CMFs is the exact alternative.
2. camera neutral n = M_XYZ→camera · XYZ(white, Y = 1).
3. gains = (n_G/n_R, 1, n_G/n_B).

The result is a `ResolvedWhiteBalanceState` with `source: "color-temperature"`. Its `colorTemperature` record keeps the white chromaticity and the camera neutral, and its `sourceProfile` is the camera profile. A grey card lit by a Planckian illuminant of the same temperature comes out neutral to 1e-10 when the locus and the camera matrix share the CMFs. With the default locus (1 nm nodes) and a camera integrated on 5 nm nodes, the residual cast is below 0.1 % in the tests. The CCT/tint describes the white the photographer declares, not a measured scene illuminant. Accuracy is bounded by the camera matrix, which is exact only under the Luther–Ives condition.

## Colour difference and CIELAB

- **CIELAB and LCh:** `calculateCielabFromXyz` / `calculateXyzFromCielab` and `calculateCielchFromCielab` / `calculateCielabFromCielch` implement CIELAB as defined in W3C CSS Color 4 §9 (also CIE 15:2018) with the exact constants ε = (6/29)³ and κ = (29/3)³.
- **`calculateColorDifference`** supports three formulas:
  - `cie76`: Euclidean ΔE*ab.
  - `cie94`: ΔE*94 = √((ΔL*/(k_L S_L))² + (ΔC*/(k_C S_C))² + (ΔH*/(k_H S_H))²) with S_L = 1, S_C = 1 + K₁C*₁ and S_H = 1 + K₂C*₁. C*₁ is the chroma of `reference`, so the formula is asymmetric in it, and ΔH*² = Δa*² + Δb*² − ΔC*². By default the engine uses the formula's published reference conditions: k_L = k_C = k_H = 1, K₁ = 0.045 and K₂ = 0.015 (often called "graphic arts"). For other conditions, pass all five factors in `cie94Factors: { lightness, chroma, hue, k1, k2 }` (k_L, k_C, k_H greater than zero; K₁, K₂ finite and not negative; unknown fields are rejected). The engine ships no other preset; the caller is responsible for the source of its factors. The primary source, CIE 116-1995, is not free. The tests check the closed forms for pure lightness (|ΔL*|/k_L), pure chroma (|ΔC*|/(k_C(1 + K₁C*₁))) and equal-chroma hue differences (|ΔH*|/(k_H(1 + K₂C*₁))), and the reference asymmetry, computed in the test, with the default and with caller-supplied factors.
  - `ciede2000`: implemented following the implementation notes of Sharma, Wu & Dalal (2005), Color Res. Appl. 30(1):21–30, freely available from the first author (also CIE 142-2001 / ISO/CIE 11664-6), with optional parametric factors k_L, k_C, k_H.

The tests no longer use Sharma et al.'s published test pairs: their data file carries no licence, and the page's only terms limit the authors' program and spreadsheet to personal or research use. Instead the tests check that CIEDE2000 reduces to its closed forms for pure lightness differences (ΔE00 = |ΔL*|/S_L), pure chroma differences on the a* axis and equal-chroma hue differences (including a pair whose hues straddle 0°), all written out in the test from the formula's definitions, plus symmetry, identity and the parametric factors.

## Camera colour-matrix fitting

`estimateCameraColorMatrix()` takes caller camera spectral sensitivities, training reflectances, an illuminant and CMFs. It integrates camera RGB and target XYZ, both normalized so that the perfect diffuser gives Y = 1 and camera green = 1. It then fits a 3×3 camera→XYZ matrix in one of two ways:

- **`least-squares`:** M = X Pᵀ (P Pᵀ)⁻¹.
- **`white-point-preserving-least-squares`:** the same fit with the exact constraint M·ρ_white = X_white, solved in closed form with a Lagrange multiplier per row (Finlayson & Drew 1997, IS&T/SID CIC5).

The report gives per-patch CIEDE2000, computed with CIELAB relative to the illuminant white and no adaptation, plus the mean and maximum ΔE00 and the RMS XYZ residual. The result is labelled `estimated`: a 3×3 matrix is exact only under the Luther–Ives condition, and the training residual does not bound the error for other spectra. The tests show an exact fit for a Luther camera, and a reported non-zero residual for a Gaussian-sensitivity camera.

## Wide-gamut and HDR output primitives

`resolveRgbColorSpace()` and `calculateRgbToXyzMatrices()` derive RGB↔XYZ matrices numerically from primaries and white. No matrix is copied.

**Derivation.** W3C CSS Color 4 (free) defines a linear-light RGB space by the chromaticities of its three primaries plus the chromaticity of the white point, "the color formed by all three primaries at full intensity" (§2), and converts linear RGB to CIE XYZ with a 3 × 3 matrix (§11 Converting Colors, and the matrices in §19 Sample code for Color Conversions). Writing that down gives the matrix:

1. Each primary i = R, G, B with chromaticity (xᵢ, yᵢ) has, at luminance Y = 1, the tristimulus vector Pᵢ = (xᵢ/yᵢ, 1, (1 − xᵢ − yᵢ)/yᵢ).
2. Linear RGB (r, g, b) means r·S_R·P_R + g·S_G·P_G + b·S_B·P_B, with an unknown luminance scale Sᵢ per primary. So M_RGB→XYZ = [P_R P_G P_B]·diag(S_R, S_G, S_B), with the Pᵢ as columns.
3. Full intensity (1, 1, 1) must give the white, W = (x_w/y_w, 1, (1 − x_w − y_w)/y_w) at Y = 1. So [P_R P_G P_B]·S = W, and S = [P_R P_G P_B]⁻¹·W. The white must lie strictly inside the primary triangle, which makes every Sᵢ positive; the engine checks this and fails closed otherwise.
4. M_XYZ→RGB is the inverse of M_RGB→XYZ.
5. The middle row of M_RGB→XYZ is (S_R, S_G, S_B): the luminance coefficients. For BT.709 primaries and D65 they round to 0.2126, 0.7152, 0.0722, and for BT.2020 primaries to 0.2627, 0.6780, 0.0593. ITU-R BT.709-6 (item 3.2) and BT.2020-2 (Table 4) publish exactly these coefficients (both free from the ITU).

The primaries and D65 white below are the published values of ITU-R BT.709-6 (item 1.3) and BT.2020-2 (Table 3), and of CSS Color 4 `display-p3`.

**Check.** `test/colorimetry-output-and-camera.test.ts` compares the derived matrices, both directions, with the rational matrices of the CSS Color 4 sample code (§19; `lin_sRGB_to_XYZ`, `lin_P3_to_XYZ`, `lin_2020_to_XYZ` and their inverses; Candidate Recommendation Draft of 9 October 2026). Every element agrees within 1e-12; the largest difference measured is 1.8e-15. The same method appears in SMPTE RP 177-1993 (paid); it is not needed to follow or check the derivation.

| Space | Primaries (x, y) R / G / B | White | Source |
| --- | --- | --- | --- |
| `srgb`, `rec709` | (0.64, 0.33) / (0.30, 0.60) / (0.15, 0.06) | D65 (0.3127, 0.3290) | ITU-R BT.709-6; W3C CSS Color 4 `srgb` (also IEC 61966-2-1) |
| `display-p3` | (0.680, 0.320) / (0.265, 0.690) / (0.150, 0.060) | D65 | W3C CSS Color 4 `display-p3`; ITU-T H.273 ColourPrimaries 12 (also SMPTE EG 432-1) |
| `rec2020` | (0.708, 0.292) / (0.170, 0.797) / (0.131, 0.046) | D65 | ITU-R BT.2020-2 |

The derived luminance rows match the published coefficients to 1e-4: BT.709 0.2126/0.7152/0.0722, BT.2020 0.2627/0.6780/0.0593 and P3 0.2290/0.6917/0.0793.

Transfer functions, all using the constants published in each standard:

- **sRGB / Display P3:** `evaluateSrgbEncoding` / `evaluateSrgbDecoding`.
- **BT.709 OETF:** `evaluateBt709Oetf` / `evaluateBt709InverseOetf`.
- **BT.1886 EOTF:** `prepareBt1886Eotf` (γ = 2.4, with the display's white and black luminance).
The ITU-R BT.2100 PQ (also SMPTE ST 2084) and HLG transfer functions are not part of 2.0 (owner decision, 2026-10-17): their patent holders offer only licence-on-request declarations, which fails the project's free-to-use rule. See the patent review in `THIRD_PARTY.md`.

## Perceptual gamut mapping

`prepareRgbGamutMapping()` / `calculateGamutMappedColor()` map D65-relative XYZ (white Y = 1) into a target RGB cube [0, 1]³:

- **Method:** L*ab and hue h_ab are held constant. The boundary chroma C_max(L*, h) is found by bisection, and chroma is reduced toward the neutral axis.
- **Knee:** with `kneeFraction` k, chroma above k·C_max is compressed as C′ = kC_max + (1 − k)C_max·tanh((C − kC_max)/((1 − k)C_max)). This is continuous, monotone and stays inside the boundary. k = 1 is hard chroma clipping along constant (L*, h).
- **Early-out below the knee (2.28.0, #684):** an in-gamut colour with L* below 85 and chroma above 1e-6 is first probed once at chroma / k × (1 + 1e-9); if that point is inside the cube, the colour is below the knee and is returned unchanged without the boundary search. This gives the search's result wherever the constant-L*, constant-hue ray's in-cube part is one interval. That is measured, not proven (owner decision 2026-11-21, accepted on the measurement): no result differed from the search's on 1,822,752 colours per space (the cube's 8-bit surface scaled by 0.5, 0.9, 0.99 and 1, and a 64³ interior lattice) for `srgb`, `display-p3` and `rec2020` at k = 0.25, 0.5, 0.75, 0.9 and 0.99, and a ray scan found rays that are not one interval only above L* 90.5 (`display-p3`), 93.25 (`srgb`) and 93.75 (`rec2020`). Without the L* limit, 3 colours per space differ at k = 0.9 (L* 90.7–93.1, near the yellow cusp).
- **Lightness:** values outside [0, 100] are clipped to black or white.
- **Method family:** constant-lightness/constant-hue chroma reduction, the same binary-search idea as W3C CSS Color 4 §14 (free), which uses OKLCh. Also see: Morovič 2008, *Color Gamut Mapping*, Wiley. This independent implementation uses CIELAB instead, so no additional third-party matrices are needed.
- **Known limitation:** CIELAB hue is not perceptually constant for saturated blues, so mapped blues can drift toward purple. The result is labelled `approximation`.

## References

- CIE 15:2018 *Colorimetry*, 4th ed.; CIE 018:2019; ISO/CIE 11664-1/-2/-4/-6 (paid; see the free sources below and the citation audit in [RELEASE_2_0_0.md](RELEASE_2_0_0.md#citation-audit-free-sources)). Free CIE datasets (CC BY-SA 4.0, not bundled) at <https://cie.co.at/data-tables> are used only to check computed values.
- C. Wyman, P.-P. Sloan, P. Shirley (2013), JCGT 2(2):1–11 (the piecewise-Gaussian model form and the tristimulus integral, Eq. 1; its coefficients are not used).
- CIE 1931 2° colour-matching functions, DOI 10.25039/CIE.DS.xvudnb9b (CC BY-SA 4.0), used at fit time only by `scripts/fit-cie-1931-cmf.mjs`.
- C. S. McCamy (1992), Color Res. Appl. 17(2):142–144.
- K. A. G. Smet et al. (2023), "Recommended method for determining the correlated color temperature and distance from the Planckian locus of a light source", LEUKOS, doi:10.1080/15502724.2023.2248397; free archival copy: <https://www.energy.gov/sites/default/files/2023-09/ssl-smet-etal-2023_method-cct-duv-light-source.pdf> (CCT and signed Duv, Duv range ±0.05).
- Y. Ohno (2011), "Calculation of CCT and Duv and Practical Conversion Formulae", slides, CORM 2011 Conference, Gaithersburg, MD, May 3–5, 2011, slide 5 (Duv sign: "+ sign for above and - sign for below the Planckian locus"); free at <https://cormusa.org/wp-content/uploads/2018/04/CORM_2011_Calculation_of_CCT_and_Duv_and_Practical_Conversion_Formulae.pdf>.
- K. M. Lam (1985), PhD thesis, University of Bradford; M. R. Luo, P. A. Rhodes (1999); ICC.1:2010 Annex E (ICC specifications are free at <https://www.color.org/>).
- N. Moroney et al. (2002), IS&T/SID 10th Color Imaging Conference, listed in the RIT open repository <https://repository.rit.edu/other/143> (full text not confirmed; see Chromatic adaptation); also CIE 159:2004 (paid).
- C. Li, Z. Li, Z. Wang, Y. Xu, M. R. Luo, G. Cui, M. Melgosa, M. Pointer (2016), "A Revision of CIECAM02 and its CAT and UCS", IS&T 24th Color and Imaging Conference, pp. 208–212, doi:10.2352/ISSN.2169-2629.2017.32.208 (free; Eq. (15) gives the CAT16 matrix). Journal version: C. Li et al. (2017), Color Res. Appl. 42(6):703–718 (paid); also CIE 248:2022 (paid).
- G. Sharma, W. Wu, E. N. Dalal (2005), Color Res. Appl. 30(1):21–30; paper at <https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/>. Also CIE 142-2001.
- CIE 116-1995, *Industrial colour-difference evaluation* (CIE94; paid, no free primary source).
- G. D. Finlayson, M. S. Drew (1997), IS&T/SID 5th Color Imaging Conference.
- W3C CSS Color Module Level 4 §14 (free). Also see: J. Morovič (2008), *Color Gamut Mapping*, Wiley.
- ITU-R BT.709-6 (primaries, D65 and luminance coefficients, items 1.3 and 3.2), BT.1886, BT.2020-2 (Tables 3 and 4) (free at <https://www.itu.int/rec/R-REC-BT>); W3C CSS Color Module Level 4 (`srgb`, `display-p3`, Lab, the RGB↔XYZ method and its sample-code matrices) <https://www.w3.org/TR/css-color-4/>; ITU-T H.273. Also specified in IEC 61966-2-1:1999, SMPTE EG 432-1 and SMPTE RP 177-1993.
- Planck's law: BIPM, *Mise en pratique for the definition of the kelvin*, Absolute Primary Radiometry (2018), Eq. (1), <https://www.bipm.org/utils/en/pdf/si-mep/MeP-K-2018_Absolute_Primary_Radiometry.pdf>; second radiation constant c₂ = hc/k = 1.438 776 877…e-2 m·K (exact), NIST CODATA 2022, <https://physics.nist.gov/cgi-bin/cuu/Value?c22ndrc>.
- BIPM, *The International System of Units*, 9th ed. (2019).
