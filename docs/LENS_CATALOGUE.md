# Generic lens catalogue

The engine's own lenses (#549, owner specification of November 6, 2026): two sets of primes, **Professional** and **Consumer**, 30 lenses, and (#554) the three fixed lenses of the phone sensor profile, 33 in all, each with a focal length, an aperture range, a close-focus distance, a projection and a documented optical character. Every lens is a generic Photivra "PV" design: it is not modelled on any manufacturer's product, and **every number on this page is a labelled approximation** chosen by Photivra, not a measurement. The engine reports it as `scientificStatus: "approximation"` and in the capture's assumptions.

- Data: `GENERIC_LENS_CATALOGUE`, `GENERIC_LENS_IDS`, `GENERIC_LENS_SET_BASELINES` (`src/equipment/generic-lens-catalogue.ts`). The data are kept apart from the PSF built from them (`src/optics/generic-lens-psf.ts`), so other models, for example the bokeh shape of #553, read the same lenses. Each entry, and `resolveGenericLens`'s result, has a `summary`: a short plain-English description of the lens's character (at most 40 characters, US spelling) for lists and pickers. It is written from the lens's adjustments and reason in the table below, and a test checks each claim against them.
- One lens on a sensor, at an f-number and focus distance: `resolveGenericLens`. Its distortion and vignetting profiles reach 1.25 of the half-diagonal, past the corner, so they can be passed to `simulateCapture` and `simulateDisplayView` as `lens.distortion` and `lens.vignetting` (which read beyond the outer site centres); inside the frame the values are the same.
- A capture with it: `simulateCapture({ lens: { catalogue: "pv-50-1.2-pro", fNumber: 1.2 } })`.
- Its correction profile: `createGenericLensCorrectionProfile`. A seeded autofocus error: `simulateGenericLensFocusError`, or `lens.focusScatter` in a capture.

## Names

`PV <focal length> <maximum aperture>`, with **Pro** for the professional set and no suffix for consumer lenses; special lenses add **Macro** or **Fisheye** before Pro: *PV 50 1.2 Pro*, *PV 50 1.8*, *PV 100 2.8 Macro Pro*, *PV 8 3.5 Fisheye Pro*. The id is the name in lower case with hyphens: `pv-50-1.2-pro`, `pv-50-1.8`, `pv-100-2.8-macro-pro`. "PV" is Photivra's own name.

## The lenses

Focal lengths are full-frame equivalents (36 × 24 mm) and scale by the diagonal crop factor on other sensors, exactly as `lens.prime` does: in `simulateCapture` the sensor is the simulated frame (output width × height × pixel pitch). Close focus is the generic thin-lens rule max(0.10 m, f·(1 + 1/m)) with m = 0.15, except the professional macro, which reaches 1:1 (m = 1, at 2f). The smallest aperture is the generic prime rule of both sets: f/16 up to 16 mm, f/22 up to 135 mm, f/32 beyond. The two fisheyes use the equisolid-angle projection r = 2f·sin(θ/2): the 8 mm draws a 180° circle of radius 2·8·sin 45° = 11.3 mm inside the frame, and the 15 mm fills it.

| Lens | id | Summary (`summary`) | Aperture | Close focus (full frame) | Projection | Adjustments of the set baseline | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PV 8 3.5 Fisheye Pro | `pv-8-3.5-fisheye-pro` | Circular fisheye; softer toward the rim | f/3.5–f/16 | 0.1 m (0.15×) | equisolid fisheye, circular | distortion +0.5, astigmatism ×1.5, fieldCurvature ×1.5, lateralColor ×2, vignetting ×0.8, strayLight ×1.5, breathing ×0.3, closeFocus ×0.5 | Circular fisheye: astigmatism, field curvature and lateral colour grow towards the image circle; the exposed front element flares more; little breathing at 8 mm. Its distortion is the small departure from the equisolid projection. |
| PV 10 3.2 Pro | `pv-10-3.2-pro` | Strong barrel distortion; softer corners | f/3.2–f/16 | 0.1 m (0.15×) | rectilinear | distortion -2.5, astigmatism ×1.4, fieldCurvature ×1.3, lateralColor ×1.8, vignetting ×1.4, strayLight ×1.3 | Rectilinear ultra-wide: strong barrel distortion, softer corners, lateral colour and corner fall-off. |
| PV 15 2.8 Fisheye Pro | `pv-15-2.8-fisheye-pro` | Full-frame fisheye; softer edges | f/2.8–f/16 | 0.115 m (0.15×) | equisolid fisheye, full-frame | distortion +0.5, astigmatism ×1.4, fieldCurvature ×1.3, lateralColor ×1.8, vignetting ×0.9, strayLight ×1.5, breathing ×0.3, closeFocus ×0.5 | Full-frame fisheye: as the circular fisheye, with its image filling the frame. |
| PV 16 1.8 Pro | `pv-16-1.8-pro` | Fast ultra-wide; coma wide open | f/1.8–f/16 | 0.123 m (0.15×) | rectilinear | distortion -1.8, coma ×1.4, astigmatism ×1.3, lateralColor ×1.5, vignetting ×1.5, strayLight ×1.2 | Fast ultra-wide: coma and corner fall-off wide open, barrel distortion. |
| PV 20 1.4 Pro | `pv-20-1.4-pro` | Fast wide angle; coma wide open | f/1.4–f/22 | 0.153 m (0.15×) | rectilinear | distortion -1.3, coma ×1.4, astigmatism ×1.2, lateralColor ×1.3, vignetting ×1.4 | Fast wide angle: coma wide open, barrel distortion. |
| PV 24 1.4 Pro | `pv-24-1.4-pro` | Fast wide angle; some coma wide open | f/1.4–f/22 | 0.184 m (0.15×) | rectilinear | distortion -1, coma ×1.3, astigmatism ×1.1, lateralColor ×1.2, vignetting ×1.3 | Fast wide angle: some coma wide open. |
| PV 35 1.2 Pro | `pv-35-1.2-pro` | Very fast; axial color wide open | f/1.2–f/22 | 0.268 m (0.15×) | rectilinear | distortion -0.6, spherical ×1.3, coma ×1.2, axialColor ×1.3, vignetting ×1.3 | Very fast: spherical aberration and axial colour wide open. |
| PV 50 1.2 Pro | `pv-50-1.2-pro` | Very fast; nearly no distortion | f/1.2–f/22 | 0.383 m (0.15×) | rectilinear | distortion -0.3, spherical ×1.3, axialColor ×1.3, vignetting ×1.2 | Very fast normal lens: spherical aberration and axial colour wide open; nearly no distortion. |
| PV 85 1.2 Pro | `pv-85-1.2-pro` | Even across the frame; axial color | f/1.2–f/22 | 0.652 m (0.15×) | rectilinear | distortion +0.3, spherical ×1.2, axialColor ×1.4, coma ×0.8, astigmatism ×0.7, vignetting ×1.1 | Very fast short telephoto: axial colour wide open, a small field angle so less coma and astigmatism; slight pincushion. |
| PV 100 2.8 Macro Pro | `pv-100-2.8-macro-pro` | Flat field to 1:1; strong breathing | f/2.8–f/22 | 0.2 m (1:1) | rectilinear | distortion +0.1, spherical ×0.8, coma ×0.7, astigmatism ×0.7, fieldCurvature ×0.5, axialColor ×0.8, vignetting ×0.6, breathing ×1.5, closeFocus ×0.2 | Macro: a flat field and corrections optimised for close focus (to 1:1), but strong breathing. |
| PV 200 2 Pro | `pv-200-2-pro` | Fast telephoto; axial color wide open | f/2–f/32 | 1.533 m (0.15×) | rectilinear | distortion +0.4, axialColor ×1.5, lateralColor ×0.8, coma ×0.6, astigmatism ×0.6, vignetting ×0.9 | Fast long telephoto: axial colour; a small field angle. |
| PV 300 2.8 Pro | `pv-300-2.8-pro` | Long telephoto; axial color | f/2.8–f/32 | 2.3 m (0.15×) | rectilinear | distortion +0.4, axialColor ×1.4, coma ×0.5, astigmatism ×0.5, vignetting ×0.8 | Long telephoto: axial colour; a small field angle. |
| PV 400 2.8 Pro | `pv-400-2.8-pro` | Fast super telephoto; axial color | f/2.8–f/32 | 3.067 m (0.15×) | rectilinear | distortion +0.4, axialColor ×1.5, coma ×0.5, astigmatism ×0.5, vignetting ×0.9 | Fast super telephoto: axial colour. |
| PV 500 4 Pro | `pv-500-4-pro` | Super telephoto; low coma | f/4–f/32 | 3.833 m (0.15×) | rectilinear | distortion +0.3, axialColor ×1.2, coma ×0.5, astigmatism ×0.5, vignetting ×0.7 | Super telephoto. |
| PV 600 4 Pro | `pv-600-4-pro` | Super telephoto; low coma, axial color | f/4–f/32 | 4.6 m (0.15×) | rectilinear | distortion +0.3, axialColor ×1.3, coma ×0.5, astigmatism ×0.5, vignetting ×0.8 | Super telephoto. |
| PV 800 5.6 Pro | `pv-800-5.6-pro` | Slow super telephoto; low coma | f/5.6–f/32 | 6.133 m (0.15×) | rectilinear | distortion +0.3, axialColor ×1.2, coma ×0.5, astigmatism ×0.5, vignetting ×0.7 | Super telephoto. |
| PV 1200 8 Pro | `pv-1200-8-pro` | Slow extreme telephoto; little falloff | f/8–f/32 | 9.2 m (0.15×) | rectilinear | distortion +0.2, axialColor ×1.1, coma ×0.5, astigmatism ×0.5, vignetting ×0.6 | Slow extreme telephoto: little vignetting. |
| PV 16 2.8 | `pv-16-2.8` | Strong barrel distortion; soft corners | f/2.8–f/16 | 0.123 m (0.15×) | rectilinear | distortion -1.5, coma ×1.1, astigmatism ×1.2, fieldCurvature ×1.2, lateralColor ×1.3, vignetting ×1.2, strayLight ×1.2 | Ultra-wide: strong barrel distortion and soft corners, left to the correction profile. |
| PV 20 2 | `pv-20-2` | Barrel distortion; coma wide open | f/2–f/22 | 0.153 m (0.15×) | rectilinear | distortion -1.2, coma ×1.15, astigmatism ×1.1, lateralColor ×1.2, vignetting ×1.15 | Wide angle: barrel distortion, coma wide open. |
| PV 24 1.8 | `pv-24-1.8` | Barrel distortion; mild corner falloff | f/1.8–f/22 | 0.184 m (0.15×) | rectilinear | distortion -1, coma ×1.1, lateralColor ×1.1, vignetting ×1.1 | Wide angle: barrel distortion. |
| PV 35 1.8 | `pv-35-1.8` | The consumer baseline; mild barrel | f/1.8–f/22 | 0.268 m (0.15×) | rectilinear | distortion -0.6 | The consumer baseline. |
| PV 50 1.8 | `pv-50-1.8` | Simple, well-corrected normal lens | f/1.8–f/22 | 0.383 m (0.15×) | rectilinear | distortion -0.3, spherical ×0.7, coma ×0.7, astigmatism ×0.7, fieldCurvature ×0.7, axialColor ×0.8, lateralColor ×0.6, vignetting ×0.8 | A simple, well-corrected normal design: quite good for its set (owner's example). |
| PV 85 1.8 | `pv-85-1.8` | Short telephoto; axial color wide open | f/1.8–f/22 | 0.652 m (0.15×) | rectilinear | distortion +0.3, spherical ×0.9, axialColor ×1.1, coma ×0.8, astigmatism ×0.8 | Short telephoto: axial colour wide open. |
| PV 100 2 | `pv-100-2` | Short telephoto; axial color, pincushion | f/2–f/22 | 0.767 m (0.15×) | rectilinear | distortion +0.4, axialColor ×1.2, coma ×0.85 | Short telephoto: axial colour wide open. |
| PV 200 5.6 | `pv-200-5.6` | Lateral color and pincushion | f/5.6–f/32 | 1.533 m (0.15×) | rectilinear | distortion +0.6, axialColor ×0.9, lateralColor ×1.2, coma ×0.8, astigmatism ×0.9, vignetting ×0.8 | Slow telephoto: lateral colour, pincushion. |
| PV 300 5.6 | `pv-300-5.6` | Lateral color and pincushion | f/5.6–f/32 | 2.3 m (0.15×) | rectilinear | distortion +0.6, lateralColor ×1.3 | Slow telephoto: lateral colour, pincushion. |
| PV 400 5.6 | `pv-400-5.6` | Slow super telephoto; lateral color | f/5.6–f/32 | 3.067 m (0.15×) | rectilinear | distortion +0.6, lateralColor ×1.3, axialColor ×1.1 | Slow super telephoto: lateral and axial colour. |
| PV 500 5.6 | `pv-500-5.6` | Slow super telephoto; softer edges | f/5.6–f/32 | 3.833 m (0.15×) | rectilinear | distortion +0.6, lateralColor ×1.4, axialColor ×1.15, astigmatism ×1.1, fieldCurvature ×1.1 | Slow super telephoto: softer edges. |
| PV 600 6.3 | `pv-600-6.3` | Soft at the edges and wide open | f/6.3–f/32 | 4.6 m (0.15×) | rectilinear | distortion +0.6, spherical ×1.2, coma ×1.2, astigmatism ×1.25, fieldCurvature ×1.25, lateralColor ×1.4, axialColor ×1.2, vignetting ×1.2 | Soft at the edges and wide open (owner's example). |
| PV 800 9 | `pv-800-9` | Slow extreme telephoto; softer edges | f/9–f/32 | 6.133 m (0.15×) | rectilinear | distortion +0.5, astigmatism ×1.15, fieldCurvature ×1.15, lateralColor ×1.4, axialColor ×1.1 | Slow extreme telephoto: softer edges, lateral colour. |

## Optical character

Each set has a **baseline** (the owner's table below), and each lens multiplies it where its class typically differs (the adjustments above; a missing entry is ×1, and the distortion entry is a signed multiple of the baseline magnitude: − barrel, + pincushion). The baseline is the character at each lens's **widest aperture** and at the **frame corner** (normalised field height H = 1, the frame's half-diagonal).

| Characteristic | Professional | Consumer | Engine model |
| --- | --- | --- | --- |
| Centre sharpness | spherical W040 = 0.25 waves | 0.5 waves | Seidel wavefront, scalar Fraunhofer PSF |
| Edge and corner sharpness | astigmatism W222 = 0.3, field curvature W220 = 0.15 waves | 0.8, 0.45 waves | field-dependent Seidel terms |
| Sharpness wide open | the terms scale with the pupil: a⁴, a³, a², a² (a = N0/N) | the same, from larger values | diffraction takes over when stopped down |
| Chromatic aberration | axial 0.15 waves (F–C), lateral 0.008 % of the half-diagonal | 0.4 waves, 0.03 % | axial as defocus, lateral as a radial shift |
| Distortion | 1 % at the corner (× the lens's signed adjustment) | 3 % | radial r_d = r·(1 + k1ρ²) |
| Vignetting | 0.4 stops natural + 0.6 optical at the corner | 0.7 + 1.1 stops | E(ρ) = (1 − bρ²)², E(1) = 2^−stops |
| Coma (night photography) | W131 = 0.35 waves | 1.0 waves | Seidel coma |
| Flare and ghosting | veiling glare 0.5 %, ghosts 0.2 % | 2 %, 0.8 % | reported, not rendered |
| Bokeh quality | 9 rounded blades (curvature 0.7), its own W040; a cat's eye on the fast wides and normals | 7 blades (curvature 0.3), the same rules | #553's shaped defocus kernel with `lens.defocus` ([Bokeh](#bokeh-567)) |
| Focus breathing | −3 % field of view at minimum focus | −8 % | reported, not rendered |
| Focus consistency | σ = 0.1 of the depth of focus | 0.3 | seeded sampler, off by default |
| Close-focus performance | aberrations × (1 + 0.15·m/m_max) | × (1 + 0.5·m/m_max) | per-lens close-focus factor |

Resolved at each lens's widest aperture, focused at infinity, on a full frame (aberrations in waves at 550 nm at the corner; lateral colour is the F-to-C image-radius difference at the corner):

| Lens | Spherical | Coma | Astigmatism | Field curvature | Axial colour | Lateral colour (µm, F–C) | Distortion | Vignetting (stops) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PV 8 3.5 Fisheye Pro | 0.25 | 0.35 | 0.45 | 0.22 | 0.15 | 3.5 | 0.5 % | 0.80 |
| PV 10 3.2 Pro | 0.25 | 0.35 | 0.42 | 0.20 | 0.15 | 3.1 | -2.5 % | 1.40 |
| PV 15 2.8 Fisheye Pro | 0.25 | 0.35 | 0.42 | 0.20 | 0.15 | 3.1 | 0.5 % | 0.90 |
| PV 16 1.8 Pro | 0.25 | 0.49 | 0.39 | 0.15 | 0.15 | 2.6 | -1.8 % | 1.50 |
| PV 20 1.4 Pro | 0.25 | 0.49 | 0.36 | 0.15 | 0.15 | 2.2 | -1.3 % | 1.40 |
| PV 24 1.4 Pro | 0.25 | 0.45 | 0.33 | 0.15 | 0.15 | 2.1 | -1.0 % | 1.30 |
| PV 35 1.2 Pro | 0.33 | 0.42 | 0.30 | 0.15 | 0.20 | 1.7 | -0.6 % | 1.30 |
| PV 50 1.2 Pro | 0.33 | 0.35 | 0.30 | 0.15 | 0.20 | 1.7 | -0.3 % | 1.20 |
| PV 85 1.2 Pro | 0.30 | 0.28 | 0.21 | 0.15 | 0.21 | 1.7 | 0.3 % | 1.10 |
| PV 100 2.8 Macro Pro | 0.20 | 0.24 | 0.21 | 0.07 | 0.12 | 1.7 | 0.1 % | 0.60 |
| PV 200 2 Pro | 0.25 | 0.21 | 0.18 | 0.15 | 0.22 | 1.4 | 0.4 % | 0.90 |
| PV 300 2.8 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.21 | 1.7 | 0.4 % | 0.80 |
| PV 400 2.8 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.22 | 1.7 | 0.4 % | 0.90 |
| PV 500 4 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.18 | 1.7 | 0.3 % | 0.70 |
| PV 600 4 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.20 | 1.7 | 0.3 % | 0.80 |
| PV 800 5.6 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.18 | 1.7 | 0.3 % | 0.70 |
| PV 1200 8 Pro | 0.25 | 0.17 | 0.15 | 0.15 | 0.17 | 1.7 | 0.2 % | 0.60 |
| PV 16 2.8 | 0.50 | 1.10 | 0.96 | 0.54 | 0.40 | 8.4 | -4.5 % | 2.16 |
| PV 20 2 | 0.50 | 1.15 | 0.88 | 0.45 | 0.40 | 7.8 | -3.6 % | 2.07 |
| PV 24 1.8 | 0.50 | 1.10 | 0.80 | 0.45 | 0.40 | 7.1 | -3.0 % | 1.98 |
| PV 35 1.8 | 0.50 | 1.00 | 0.80 | 0.45 | 0.40 | 6.5 | -1.8 % | 1.80 |
| PV 50 1.8 | 0.35 | 0.70 | 0.56 | 0.32 | 0.32 | 3.9 | -0.9 % | 1.44 |
| PV 85 1.8 | 0.45 | 0.80 | 0.64 | 0.45 | 0.44 | 6.5 | 0.9 % | 1.80 |
| PV 100 2 | 0.50 | 0.85 | 0.80 | 0.45 | 0.48 | 6.5 | 1.2 % | 1.80 |
| PV 200 5.6 | 0.50 | 0.80 | 0.72 | 0.45 | 0.36 | 7.8 | 1.8 % | 1.44 |
| PV 300 5.6 | 0.50 | 1.00 | 0.80 | 0.45 | 0.40 | 8.4 | 1.8 % | 1.80 |
| PV 400 5.6 | 0.50 | 1.00 | 0.80 | 0.45 | 0.44 | 8.4 | 1.8 % | 1.80 |
| PV 500 5.6 | 0.50 | 1.00 | 0.88 | 0.50 | 0.46 | 9.1 | 1.8 % | 1.80 |
| PV 600 6.3 | 0.60 | 1.20 | 1.00 | 0.56 | 0.48 | 9.1 | 1.8 % | 2.16 |
| PV 800 9 | 0.50 | 1.00 | 0.92 | 0.52 | 0.44 | 9.1 | 1.5 % | 1.80 |
| PV 13 2.2 Phone | 0.50 | 1.00 | 1.04 | 0.65 | 0.30 | 13.0 | -4.5 % | 2.04 |
| PV 24 1.8 Phone | 0.50 | 1.00 | 0.80 | 0.50 | 0.30 | 8.7 | -1.5 % | 1.70 |
| PV 77 2.8 Phone | 0.50 | 0.70 | 0.64 | 0.50 | 0.36 | 8.7 | 1.2 % | 1.36 |

### Phone lenses (#554)

The phone sensor profile's three fixed lenses ([SENSOR_PROFILES.md](SENSOR_PROFILES.md)), a third set, **Phone**, named
*PV <focal length> <aperture> Phone*. Their equivalent focal lengths and apertures are the owner's (issue #554:
ultra-wide 13 mm f/2.2, main 24 mm f/1.8, telephoto 77 mm f/2.8, fixed apertures); every other number is a Photivra design
value. They render only with a sensor profile whose `fixedLenses` is `"phone"`, which in turn takes only them, and
`lens.fNumber` defaults to the fixed f-number. With a sensor profile, every catalogue lens, these included, is resolved on
the profile's whole sensor and the capture is its centred frame of the output's aspect
([SENSOR_PROFILES.md](SENSOR_PROFILES.md#catalogue-lenses-on-a-profiles-sensor)), so a phone lens shows its real field of
view.

| Lens | id | Summary (`summary`) | Aperture | Close focus (full frame) | Projection | Adjustments of the phone baseline | Why |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PV 13 2.2 Phone | `pv-13-2.2-phone` | Strong barrel distortion; soft corners | f/2.2 (fixed) | 0.1 m (0.15×) | rectilinear | distortion -1.5, astigmatism ×1.3, fieldCurvature ×1.3, lateralColor ×1.5, vignetting ×1.2, strayLight ×1.2 | Phone ultra-wide: strong barrel distortion, softer corners and lateral colour, left to the phone's software correction. |
| PV 24 1.8 Phone | `pv-24-1.8-phone` | The phone baseline; mild barrel | f/1.8 (fixed) | 0.184 m (0.15×) | rectilinear | distortion -0.5 | Phone main camera: the phone baseline. |
| PV 77 2.8 Phone | `pv-77-2.8-phone` | Telephoto; axial color, pincushion | f/2.8 (fixed) | 0.59 m (0.15×) | rectilinear | distortion +0.4, coma ×0.7, astigmatism ×0.8, axialColor ×1.2, vignetting ×0.8 | Phone telephoto: a small field angle, so less coma and astigmatism; axial colour; slight pincushion. |

The **phone baseline** (design values): the consumer baseline's aberrations (spherical 0.5, coma 1.0, astigmatism 0.8 waves),
field curvature 0.5 and axial colour 0.3 waves, lateral colour 0.04 % of the half-diagonal, distortion 3 % at the corner
(phones correct it in software; the correction profile applies as for the other lenses), 1.2 stops of natural and 0.5 of
optical vignetting (always present: the aperture is fixed), veiling glare 3 % and ghosts 1 %, breathing −5 %, focus
scatter σ = 0.3 of the depth of focus and close-focus factor 0.5. The close-focus row assumes full frame, like the table
above; on the phone sensor the 0.10 m floor applies.

### Models

All of these are approximations, with free sources:

- **Wavefront.** W = W020·ρ² + W040·ρ⁴ + W131·H·ρ³·cos(θ − φ) + W222·H²·ρ²·cos²(θ − φ) + W220·H²·ρ², the primary (Seidel) wave-aberration expansion (Hopkins 1950; Wyant & Creath 1992, *Basic Wavefront Aberration Theory for Optical Metrology*, Applied Optics and Optical Engineering XI ch. 1, free author copy), the expansion `createWavefrontPupilGrid` uses. W020 = −W040 balances the spherical aberration (the focus of least RMS wavefront error, Wyant & Creath 1992) plus the axial colour W_ax·a²·D(λ). H is held at 1 beyond the corner (only the PSF's reach goes there).
- **Stopping down** from N0 to N scales the pupil radius by a = N0/N, so each term W_klm·ρ^l scales by a^l.
- **Colour.** D(λ) = (1/λ² − 1/λ_d²)/(1/λ_F² − 1/λ_C²), the normalised Cauchy dispersion (0 at the d line, F minus C = 1). Lateral colour displaces the PSF radially by L·R·H·D(λ): shorter wavelengths outward.
- **Close focus.** Every aberration × (1 + c·m/m_max), with m the thin-lens magnification at the focus distance: a generic stand-in for the change of aberrations with conjugate distance, not a lens design.
- **Distortion and vignetting** are normalised to the frame's half-diagonal. Optical vignetting fades over the first four stops (N = 4·N0, since one stop is a factor √2 in N): s(N) = s_natural + s_optical·clamp(1 − log2(N/N0)/2, 0, 1).
- **Scaling to the sensor.** On a smaller sensor the design is scaled by the crop factor with its wavefront error in waves kept: the PSF has the same size in micrometres, while distortion, vignetting and lateral colour follow the frame.

### How `simulateCapture` renders it

`lens: { catalogue, fNumber }` replaces the tier lens's focal length and f-number range (its transmission is kept) and, once the f-number and focus are resolved, builds:

1. **The PSF**, as a sampled PSF for the environment PSF quadrature (one scene query per kernel tap). For each node the aberrated circular pupil (diameter f/N) is propagated to the thin-lens image distance by scalar Fraunhofer diffraction, a zero-padded radix-2 FFT on an image grid of pitch min(λ·N_w/2, p/4), and |U|² is integrated over each site's cell. The nodes are a 5 × 5 grid of field points (0, ±half the frame, ±the frame edge plus the PSF reach) × 5 wavelengths (380, 450, 550, 650, 780 nm), each at its own field azimuth, interpolated with the engine's centroid-aligned multilinear scheme. The kernel window is the smallest that leaves at most 3 % of any node's energy outside it (at most 12 sites); that energy is reported and put back by renormalisation, as for `lens.diffraction`. Diffraction is part of this PSF, so `lens.diffraction` is not combined with it.
2. **The distortion** as the lens field mapping, and **the vignetting** as field throughput, over the field the PSF reaches. A frame so small that the PSF's reach passes the vignetting profile's zero is refused, with the numbers.
3. **The fisheyes' projection.** Directions at or beyond 90° from the axis see no scene (zero radiance), and a sensor point outside the equisolid image circle (r ≥ 2f) looks straight back: so the circular fisheye's image ends at its 180° circle, and the 15 mm's extreme corners (92° on a full frame) are black. Both are opt-in parts of the provider and of `EnvironmentLensFieldMapping` (`outsideImageCircle: "backward-ray"`) that only catalogue fisheyes use.

The assumptions `lens.catalogue` (the lens) and `lens.catalogue.character` (the resolved coefficients, the PSF's window, truncated energy, nodes and FFT sizes, and what is not rendered) record it; `lens.psf`, `lens.distortion`, `lens.vignetting` and `lens.projection` name the catalogue as their source. `diagnostics.options` lists `lens.catalogue` with the components that ran.

**Ties on chart boundaries (2.21.0, [#588](https://github.com/Photivra/photivra/issues/588)).** The exact method's quadrature reads each tap's scene point at its site-lattice point (#548's lattice formula: the sensor point (i + ½ − W/2, j + ½ − H/2)·p mapped through the lens), as the fast method, the display view and `lens.diffraction`'s quadrature ([#565](https://github.com/Photivra/photivra/issues/565)) do. Before, each tap's point came from its own site's arithmetic, so a tap exactly on a chart boundary (a Siemens star's diagonals through a symmetric frame's center, its vertical spokes through an odd frame's center column) could resolve to the other material: on a 20 × 14 star at 60 µm through *PV 24 1.8* wide open, 20 of the 352 native sites differed, the largest by 15 times the lattice value. Elsewhere the two readings agree to rounding (below 3e-15 per site in the test). Outside a circular fisheye's image circle and beyond the horizon the reading is zero, as before. The reader adds no option and no approximation; in a CPU profile of a 96 × 64 exact capture (*PV 50 1.8* at f/8, 20 nm step) it takes about 2.5 % of the time (the per-tap lookup of each query's lattice point). With camera rotation under `motion.shutter: "rolling"` each row has its own instants, so the lattice is read once per instant (a band of lattice points per row and instant): there the per-tap points are `lens.catalogue`'s fast choice and the lattice reading its full method (owner decision, 2.21.0). The record's `fast` (`lens: { catalogue: { kind, fast } }`) decides, else the top-level `fast`, else the output: fast for on-screen sample arrays (`srgb-8`, `srgb-16`), full for a DNG, JPEG or PNG. The field-grid method never runs with rotation, so in this case `diagnostics.fast.applied["lens.catalogue"]` is `true` exactly when the per-tap points ran, `assurance` is then `approximation-with-a-priori-bound`, and the assumption `fast.lens.catalogue` says `method: "per-tap-source-points"` (the same as `lens.diffraction`'s) (the bound: the two readings differ only at taps exactly on a scene boundary; dead leaves give the same RAW either way). `requested` is the resolved top-level value and `defaultedFrom` says where it came from (2.20.0's scheme), so an on-screen default reports `requested: true, defaultedFrom: "format"` with `applied: true`. The lattice reading costs 1.07–1.09× the per-tap time there (48 × 32 at 750 µm, three temporal samples, pitch and yaw rotation: a Siemens star through *PV 24 1.8* wide open 2.38 s against 2.56 s, dead leaves through *PV 50 1.8* at f/8 2.40 s against 2.58 s, through the *PV 8 3.5 Fisheye Pro* 1.64 s against 1.79 s; medians of four interleaved runs, November 9, 2026, Apple M5 Pro, Node 24.19.0, load average 4–5). The RAW then depends on `output.format`, so region renders joined into one frame (`serializeSimulatedCaptureDngFromParts`, `simulateCaptureFromParts`) match the whole-frame render only if every part reads the same way: set `fast` explicitly on the parts and the whole request. Rotation with a global shutter always reads the lattice. Test: `test/simulate-capture-lens-catalogue-ties.test.ts` (fails on 2.19.0).

**`lens.defocus`** convolves the lens's own bokeh kernel ([Bokeh](#bokeh-567), since 2.20.0; a plain disc in 2.17.0–2.19.0) into every PSF node (a further approximation: the defocused aberrated wave PSF is not exactly the in-focus PSF convolved with a geometric kernel) and runs through the same quadrature; the `lens.defocus` assumption says `execution: "catalogue-lens-psf"` and reports the kernel's `bokeh: { method, sphericalAberrationSites, axisOpenAreaRatio }`. The combined kernel is limited to a radius of 16 sites (33² scene queries per site and spectral node); larger is refused with the reason (#564's run convolution above it is not used with a catalogue lens). #553's bokeh options (`blades`, `sphericalAberration`, `catsEye`) stay refused with `lens.catalogue`: the lens sets all three itself.

**Not combinable** with `lens.prime`, `focalLengthMm`, `projection`, `distortion`, `vignetting`, `psf`, `diffraction` or `pupilSampling` (the lens sets them). The display view (`simulateDisplayView`, `prepareDisplayView`) renders `lens.catalogue` since #569: the same distortion, projection and vignetting at every kernel tap, and the PSF the capture resolves, taken at the centre of each of up to 64 × 43 field zones (an approximation within 1 % per site of the capture; [Display view, Catalogue lenses](DISPLAY_VIEW.md#catalogue-lenses-569)). Flare and focus breathing are reported, not rendered; the display view reads the same PSF, so it shows the lens's bokeh too.

**Cost.** The quadrature runs one scene query per kernel tap and spectral node through the lens field mapping, so, like `lens.distortion`, a catalogue capture with the exact method is far slower than one without lens options. A 48 × 48 region of a full frame at 6 µm (Apple M5 Pro, Node.js 24.19.0, at each lens's widest aperture; the same region with `lens.prime` 24 takes 0.01 s):

| Lens | Kernel | 20 nm spectral step (default) | 50 nm step |
| --- | --- | --- | --- |
| PV 24 1.4 Pro | 3 × 3 | 1.3 s | 0.5 s |
| PV 50 1.2 Pro | 3 × 3 | 1.2 s | 0.5 s |
| PV 50 1.8 | 7 × 7 | 5.9 s | 2.4 s |
| PV 24 1.8 | 9 × 9 | 9.7 s | 3.9 s |

The time grows with the site count and the kernel: the kernel grows with the aberrations, with the f-number (the Airy pattern) and with smaller pixels. The catalogue's data and PSF builder are loaded on demand (`src/facade/generic-lens-capture.ts`), so a capture bundle that never asks for a catalogue lens does not carry them. For interactive captures use the fast method below.

### Bokeh (#567)

Each lens carries the bokeh character its class implies, as #553's options (`resolveGenericLens(...).character.bokeh`, a `DefocusBokehOptions` that `calculateDefocusBokehKernel` takes as it is). Every value is Photivra's own generic choice, an approximation:

| Part | Value | Reason |
| --- | --- | --- |
| Blades | professional: 9 blades, curvature 0.7; consumer: 7 blades, curvature 0.3; open to a circle at the lens's widest aperture (`circularAtOrBelowFNumber`) | More, rounder blades keep the stopped-down opening near a circle, the usual difference between the two classes; wide open the stop's own rim limits the beam. The blades and their curvature do not change with the f-number (a generic simplification). |
| Spherical aberration | the lens's own resolved W040 (the *spherical* column above × 0.55 µm, scaled by a⁴ and the close-focus factor), at the working f-number | The same W040 its in-focus PSF has: undercorrected (W040 > 0), so the blur behind the focus plane is soft-edged and the blur in front bright-rimmed (H. H. Nasse, *Depth of Field and Bokeh*, Carl Zeiss, 2010, free). |
| Cat's eye | the fast (f/2 or faster) rectilinear wides and normals (at most 50 mm equivalent): *PV 16 1.8 Pro*, *PV 20 1.4 Pro*, *PV 24 1.4 Pro*, *PV 35 1.2 Pro*, *PV 50 1.2 Pro*, *PV 20 2*, *PV 24 1.8*, *PV 35 1.8*, *PV 50 1.8* | One clipping circle of the widest pupil's radius f/(2·N0), shifted toward the field point by d·f/(2·N0) per (tan θ / tan θ_corner), with d chosen so that wide open the open pupil at the frame corner is 2^−s_o, s_o the lens's optical vignetting in stops: the corner light that the relative illumination already removes. Stopping down shrinks the pupil inside the clip. Open area at the full-frame corner wide open: 0.536, 0.559, 0.582, 0.582, 0.607, 0.416, 0.432, 0.467, 0.543. |

**The cat's eye is part of lens.catalogue's exact method** (owner rule for accuracy against rendering speed; 2.20.0 folded the part's `catsEye` flag into `fast`): it makes the PSF vary over the field, so the fast method (#568) needs a much finer field grid. Measured on the point grid with `fast: true` (medians of 3, Apple M5 Pro, Node.js 24.19.0, while other jobs ran): *PV 50 1.8* at f/4 in a 96 × 96 region 0.42 s without the cat's eye against 0.93 s with it, at f/1.8 0.17 s against 0.59 s; a whole 750 × 500 frame (24 µm) with *PV 35 1.2 Pro* at f/1.2 0.68 s against 1.68 s and *PV 35 1.8* at f/1.8 0.69 s against 2.33 s (2.19.0's disc: 0.39, 0.17, 0.68 and 0.70 s). On the exact method it costs nothing measurable (10.0 s against 9.6 s for a 32 × 32 region at f/1.8). So the fast method (`fast: true`, the default for sRGB samples and the display view) leaves it out, and the exact method (`fast: false`, the default for DNG, JPEG and PNG) has it; `lens.catalogue: { kind, fast }` or the top-level `fast` chooses. The blades and the spherical aberration always apply: they cost nothing measurable (fast: 0.31–0.42 s against 2.19.0's 0.35–0.39 s for the same regions). The `lens.defocus` assumption's `bokeh.catsEye` says whether it applied.

How the capture uses them: the kernel is #553's (`createDefocusBokehSiteKernel`) with these options, referred to the lens's own focus, the balanced one of its PSF (W020 = −W040): the ray map (σc/2 + bρ²)·P of the paraxial focus gains −(b/2)·P (b = 8·N·W040/pitch), so the kernel is the one for the signed blur σc − b. With a cat's eye each of the PSF's 5 × 5 field nodes has the kernel of its own field point (tangent x/f, y/f: the chief ray of a rectilinear lens, distortion neglected), interpolated between nodes as the PSF is; without one every node has the axis kernel. The kernel has unit sum, so the light the cat's eye clips is not counted twice: it is in the vignetting. In focus (blur 0) nothing is convolved, as before. Both catalogue methods read the same PSF profile: the exact method interpolates it per site, and the fast method resolves it on its field grid, which the cat's eye refines where the node kernels' centroids move (to 112 × 78 points instead of 33 × 19 for *PV 50 1.8* at f/4 on an 18 × 12 mm frame); its run-time check against the exact chain applies as for any catalogue capture, and the two agree within 2 % of the peak on the cat's-eye point (16 × 16 region). Measured on the point grid (`test/simulate-capture-lens-catalogue-bokeh.test.ts`): the *PV 50 1.8* at f/4 shows the heptagon's seven-fold outline in the kernel's orientation; wide open at the top-left point (with `catsEye: true`) its blur's centroid shift and tilt are the cat's eye's, and without it the centroid stays put; the *PV 200 5.6* is soft-edged behind the focus plane (rim over centre 0.45) and bright-rimmed in front (1.71).

### Fast method (`fast: true`, #568)

For interactive use the catalogue lens has a fast method behind the engine's exact-or-fast flag (#395; docs/API_STYLE.md): `fast: true` on the request, or the record form `lens: { catalogue: { kind: "pv-50-1.8", fast: true }, fNumber }`, whose `fast` overrides the top-level flag. Without the flag the exact method above runs and the image is unchanged.

**What it changes (the only approximation).** The exact method resolves the PSF at every site's own field point and spectral node (the centroid-aligned interpolation of the 5 × 5 × 5 node grid) and queries the scene once per kernel tap. The fast method resolves the same PSF exactly on a finer field grid (each interval between the profile's field nodes split into at least 4 cells on a fast request and at least 10 on an exact one (#603, 2.22.0; 2.21.0 used 10 always, 2.20.0 4), and into more where the node kernels' intensity centroids move by more than 0.05 site per cell, as lateral color does on small pixels) and gives each site the bilinear blend of its four grid points' kernels. The blend is linear, so the channel response folds into the grid kernels once per grid point and spectral node, and a site's expected electrons become Σ over the taps of the field factor (vignetting × distortion area factor) at the tap's lattice point times the blended kernel per node, integrated with the spectrum of the material there. Signals are integrated from the material spectrum per site (2.21.0): no material is folded into a kernel. Distortion, vignetting and the fisheye projection are the exact method's (the radial inverse is solved by Newton's method instead of bisection, the same root to rounding); outside a circular fisheye's image circle and beyond the horizon the scene radiance is zero, as in the exact method. The sensor stage (dark charge, Poisson draws, read noise, ADC) is the tabulated RAW path's, with each site's own seeds (`src/facade/catalogue-lens-signal.ts`).

**Where it runs.** A still camera (no `motion.angularVelocityRadPerSec`), site-center queries (no `sensor.antiAliasing`, `sensor.pixelAperture` "point") and a chart preset or caller material scene, in whole frames and regions, with or without `lens.defocus`. Elsewhere, or if the run-time check below fails, the exact method runs and `diagnostics.fast.applied["lens.catalogue"]` is `false`. The display view renders `lens.catalogue` with #569's per-zone PSF and never takes the fast method (`applied` is `false` there).

**Labels.** `diagnostics.fast` reports `applied: { "lens.catalogue": true }` and `assurance: "approximation-with-a-priori-bound"`; the assumption `fast.lens.catalogue` names the method (`field-grid-bilinear-psf`), the grid and its rules; `raw.expectedSignal` has the method `tabulated-expected-electrons-catalogue-psf-field-grid`, the tolerance and the measured verification difference.

**Run-time check.** One site of each CFA phase (the region's top-left 2 × 2 block) runs the exact chain, the environment PSF quadrature: its readout must be reproduced bit for bit and its expected electrons must agree with the fast ones within 0.5 % (`CATALOGUE_FAST_VERIFICATION_TOLERANCE`, internal), or the capture runs the exact method.

**Accuracy against the exact method** (November 9, 2026; `test/simulate-capture-lens-catalogue-fast.test.ts` and the chart tests):

| Check | Measured | Tested bound |
| --- | --- | --- |
| The fast sum with each site's exact kernels instead of the blend, against the exact chain at the verification sites (rectilinear wide open, a 6 µm corner region, both fisheyes, `lens.defocus`) | ≤ 1e-9 relative | 1e-9 |
| Expected electrons, blend against exact kernels, site by site: PV 24 1.8 at f/1.8 and PV 50 1.8 at f/8 on 768 × 512, PV 15 2.8 fisheye on 768 × 512, PV 24 1.8 at f/1.8 in 6 µm regions at the corner and mid-field | at most 2.0e-4 of the frame's peak; at most 3.4e-3 of a site's own value (since #589, at least 10 grid cells; before, 2.3e-4 and 2.0e-3) | 1e-3 of the peak; 5e-3 of the site |
| Slanted-edge 10–90 % rise, center and corner, both lenses (6 µm) | within 0.010 px | 0.02 px |
| Coma (corner point, 3 µm) | within 0.0001 px | 0.02 px |
| Lateral color (corner minus center, 6 µm) | within 0.003 px | 0.02 px |
| Distortion bow (120 µm) | 0.000 px | 0.02 px |
| Vignetting fall-off (300 µm), three cases | 0.000 stops | 0.005 stops |

In the images most codes are identical (96 % of a 96 × 64 frame at 375 µm since #589): where the blend's error moves a site's expected electrons across a Poisson draw's boundary, that site draws one electron more or less.

**Cost.** The issue's benchmark (`node scripts/benchmark-catalogue-capture.mjs`): Siemens star, whole full frame (36 × 24 mm), f/8, the default 20 nm spectral step, PV 50 1.8 (the app's default lens) against `lens.prime` 50, one thread, Apple M5 Pro, Node.js 24.19.0; medians of 5 rounds after a warm-up in one process, the captures alternating:

| Width × height (pixel pitch) | `lens.prime` 50 | `lens.catalogue` fast | Fast ÷ prime | `lens.catalogue` exact | Exact ÷ fast |
| --- | --- | --- | --- | --- | --- |
| 48 × 32 (750 µm) | 0.006 s | 0.042 s | 7.0 | 0.90 s | 21 |
| 192 × 128 (188 µm) | 0.013 s | 0.052 s | 3.9 | 12.0 s | 230 |
| 384 × 256 (94 µm) | 0.039 s | 0.084 s | 2.1 | 47.5 s | 570 |
| 768 × 512 (47 µm) | 0.145 s | 0.209 s | **1.44** | 185 s | 890 |

Load average 2–5 (a shared machine); the exact column is one run per width. The fast method's fixed cost, about 40 ms (the PSF profile's FFTs, shared with the exact method, and the grid's kernels), dominates the smallest frames; from 768 × 512 up it was within 2× of `lens.prime`, the issue's target. Since #589 (at least 10 grid cells per interval, so the run-time check never falls back; owner decision) the 768-wide captures take 36–40 % longer, 2.2–2.5× `lens.prime` (PV 50 1.8 at f/8: 0.26 s against 0.12 s, November 9, 2026, five lenses), past that target; at 6000 × 4000 the cost is unchanged (25.2 s against 24.7 s before #589). In those images the largest sRGB-16 code difference between fast and exact was 0, 57, 46 and 339 (single sites whose Poisson draw moved by an electron in the dark sectors).

### Kernel orientation

The environment PSF quadrature applies a kernel row index as image +Y (`sensorPsfSourcePoint`), and the catalogue builds its kernels that way, so coma flares and the blue image point away from the axis in the rendered image; a test checks it in every quadrant.

## Measured on the charts

`test/simulate-capture-lens-catalogue.test.ts` measures each characteristic on its chart (full frame 36 × 24 mm, regions at the centre and 120 pixels in from the top-right corner; *PV 24 1.4 Pro* against *PV 24 1.8*, each at its widest aperture unless stated; November 7, 2026, and November 9 for the rows #589 changed):

| Characteristic | Chart and measure | PV 24 1.4 Pro | PV 24 1.8 |
| --- | --- | --- | --- |
| Centre sharpness | slanted edge at the centre, 10–90 % edge rise (6 µm pixels) | 0.91 px | 1.01 px |
| Edge and corner sharpness | slanted edge at the corner, 10–90 % rise | 1.32 px | 1.56 px |
| Coma | a point at the corner (3 µm pixels): outward centroid shift wide open minus at f/5.6, which leaves only coma | 0.10 px | 0.35 px |
| Lateral colour | blue-minus-red edge position at the corner minus at the centre (the demosaic's own offset), 6 µm | 0.44 px | 0.68 px |
| Distortion | bow of the grid line at u = 0.9 between rows at v ≈ 0.22 and 0.62 (120 µm pixels; expected from k1 in brackets) | 0.00 px (0.31) | 0.60 px (0.92) |
| Vignetting | uniform field, corner/centre in stops (expected: the profile with the distortion's area factor) | 1.15 (1.15) | 1.64 (1.65); 0.74 (0.75) at f/5.6 |

At 120 µm pixels the line positions move in steps of a fraction of a pixel, so the distortion row is checked within 0.5 px of the expected bow. With `lens.defocus` (*PV 50 1.8* at f/4, subject 2 m, focus 1.9 m) the centre edge's rise grows from 0.99 to 2.50 px. The PSF builder itself is checked against the engine's diffraction-limited site kernels (an aberration-free lens gives the same cells to 0.004), for Nyquist sampling of every lens's wavefront (wide open, at minimum focus, at the corner, at 380 nm), and for the direction of coma and lateral colour in every quadrant (`test/generic-lens-catalogue.test.ts`).

## Lateral color in RAW (#589)

The rendered lateral color is measured where neither the blur nor the demosaic enters (`test/simulate-capture-lens-catalogue-lateral-color.test.ts`): an isolated source on one lattice point of a 48-pixel region at 6 µm, and the intensity centroid of each CFA channel's RAW sites, from their expected electrons (the mean the Poisson draws are made from), with the fast blend and with the exact method's per-site kernels (they agree to 0.002 px). A channel's sites see every second kernel tap, so the source is put on the four points of one 2 × 2 cell in turn; summed over the four, each channel sees every tap once and its centroid is the channel's kernel centroid exactly. A blur common to the channels drops out of the blue-minus-red difference.

The lens model predicts Δ = L·(D̄_blue − D̄_red)·(x, y) at the image point (x, y), with D̄_c each channel's effective dispersion: D weighted by the channel's own response × the illuminant at the capture's spectral nodes (`calculateChannelEffectiveDispersion`, below). With the default sensor and the default 20 nm step, D̄_red = 0.20 (the red channel reaches into the green and blue; about 566 nm) and D̄_blue = 1.04 (about 454 nm), so the displacement is 0.833 of the single-wavelength L·R·H·(D(465) − D(610)). Measured November 9, 2026, wide open, as a share of the model (x / y):

| Region | PV 24 1.4 Pro | PV 24 1.8 |
| --- | --- | --- |
| Corner (120 pixels in from the top-right) | 96 % / 97 % (0.22 / 0.15 px) | 101 % / 101 % (0.80 / 0.52 px) |
| Mid-field (half the half-width and half-height) | 99 % / 99 % | 101 % / 101 % |

So the consumer lens's large blur does not reduce its rendered lateral color. Its developed corner edge (0.68 px in the table above) is below the RAW 0.80 px, and the pro lens's (0.44 px) above its RAW 0.22 px, because the edge measure is not the lens's displacement: the color matrix that undoes the channels' spectral overlap amplifies the blue image's offset from the green one, which a narrow PSF keeps sharp and a wide one smooths; the 50 % point of an edge is the line spread function's median, which an asymmetric (comatic, axially colored) PSF moves away from its mean; and the demosaic interpolates each channel from its own sites.

**The centroid alignment.** Before #589 the same measure found pro corner 73 % / 38 %, pro mid-field 19 % / 12 %, consumer corner 101 % / 109 % and consumer mid-field 121 % / 83 %. A node kernel integrates the PSF over site cells, which leaves the centroid of a PSF narrower than a site on the nearest tap (the scene is queried only at lattice points, so nothing else restores it), and the window's truncation (at most 3 % of the energy, put back by renormalization) pulls a wide PSF's centroid inwards. Each node kernel is now shifted, by linear interpolation between neighboring taps, so that its centroid is the PSF's own first moment: the pupil-mean wavefront tilt 2·N_w·⟨∇W⟩ (the Fourier transform's moment theorem; Goodman, *Introduction to Fourier Optics*, ch. 4), of which only coma's term is non-zero, W131·H along the field azimuth, plus the lateral-color displacement L·R·H·D(λ). This first moment agrees with the moment of the computed |U|² over the FFT period to 0.009 sites (PV 24 1.4 Pro and PV 24 1.8, every off-axis node at 6 µm). Over every catalogue lens wide open at 1.5, 6 and 24 µm, every node kernel's centroid is within 0.0045 sites of it wherever it lies at least a site inside the window. On the axis the PSF is symmetric and the kernels are unchanged.

The shift is an approximation with a cost: a move of f sites widens the kernel by f·(1 − f) sites² of variance, since a scene queried only at lattice points cannot carry a sub-site displacement without spreading it over two taps. The corner edge rise went from 1.09 to 1.32 px (PV 24 1.4 Pro) and from 1.44 to 1.56 px (PV 24 1.8) at 6 µm; at the centre it is unchanged. Building the PSF profile takes the same time (34–41 ms for PV 50 1.8 and PV 24 1.8). It applies to the capture's exact and fast methods and to the display view, which share the profile.

**The fast method.** Its grid blends the aligned kernels bilinearly, while the exact method interpolates between nodes with centroid alignment, which resamples a narrow kernel; with the grid's earlier 4 cells per interval the two differed on 768-pixel frames (47 µm) by up to 1.13e-3 of the frame's peak and 2.3 % of a dark site's own value, so the run-time verification (0.5 %, the top-left 2 × 2 block) could send a capture to the exact method. Measured November 9, 2026 over every catalogue lens, wide open and at its narrowest f-number, on 14 chart presets (all but `patches` and `composite`), whole frames 192, 384, 768 and 6000 pixels wide (3,600 captures): with 4 cells 15 fell back (0.42 %), all *PV 15 2.8 Fisheye Pro* at f/2.8 on 192 pixels (5.7e-3 at the corner block); with at least 10 cells none (worst 8.0e-4), and the blend is within 2.0e-4 of the peak and 3.4e-3 of a site again. The grid has at least 10 cells (owner decision); its cost is in the table above. **2.22.0 (#603, owner decision): the grid follows the request's quality** (registry entry `lens.catalogue/field-grid-cells`): at least 4 cells on a fast request (on screen), at least 10 on an exact one (a DNG, JPEG or PNG export with `lens.catalogue: { kind, fast: true }`, or `fast: false`; the exact requests otherwise take the exact method). Measured before the change (November 11, 2026, arm64 laptop, Node.js 24, every catalogue lens but the three phone lenses, wide open and at max(f/8, widest), Siemens star and `color-patches`, whole frames, two runs each; 240 captures per width and grid): 768 × 512, 4 cells 332 ms mean against 417 ms for 10, no fallback; 384 × 256, 143 against 230 ms, no fallback; 192 × 128, 277 against 166 ms, because 4 of 240 captures (*PV 15 2.8 Fisheye Pro* at f/2.8) failed the run-time check and ran the exact method (11.6 s each). **Per-lens exception (owner decision, 2026-11-11):** a lens whose 4-cell fallbacks made its fast frames slower keeps 10 cells on fast requests too; the measured list is `CATALOGUE_FAST_GRID_FULL_ON_SCREEN` in `src/facade/catalogue-lens-signal.ts` (today only *PV 15 2.8 Fisheye Pro*: 4 of its 8 measured frames at 192 pixels fell back). Remeasure and edit that list when a lens's PSF changes. The assumption `fast.lens.catalogue` reports `minimumSubdivisions`. Lateral color (the #589 RAW measure, blue minus red against the model, x / y) is unchanged by the grid: *PV 24 1.4 Pro* corner 96.0 / 96.9 %, mid-field 98.7 / 99.3 % (99.2 % with 10 cells); *PV 24 1.8*, *PV 16 2.8* and *PV 10 3.2 Pro* corner 100.9 / 101.0 %, mid-field 101.3–101.4 / 101.2–101.3 %, both grids (the 0.05-site centroid step sets the cells there). The 4-cell blend is within 1.13e-3 of the frame's peak and 2.3 % of a dark site's own value (768 × 512, *PV 24 1.8* wide open).

### Channel effective dispersion

`calculateChannelEffectiveDispersion({ wavelengthsNm, channelResponse: { red, green, blue }, illuminant })` (#589, model `generic-lens-channel-effective-dispersion` 1.0.0) returns D̄_c = Σ w·D(λ) / Σ w, w = response_c(λ)·illuminant(λ) at the nodes, for each channel: the dispersion a neutral surface's image carries in that channel, so blue minus red is L·r·(D̄_blue − D̄_red). The response and the illuminant may be in any linear unit (their scales cancel). It is an approximation: a colored surface weights a channel's band differently. `createGenericLensCorrectionProfile` takes it as `channelDispersion` (scales 1 + L·D̄_c); without it the profile keeps D at 610, 540 and 465 nm. `simulateCapture`'s `output.lensCorrections` computes it from the capture's own channels (electrons per unit spectral radiance at its spectral nodes) and its illuminant, and reports it as `channelDispersion` in the `output.lensCorrections` assumption; for the default sensor the red channel's correction scale is 1 + 0.20·L instead of 1 − 0.11·L.

### A camera's channel response (#591)

`calculateCameraChannelResponse({ sensorProfile?, peakQuantumEfficiency?, spectralStepNanometers?, illuminant? })` (2.22.0, model `camera-channel-response` 1.0.0) returns the channels the capture itself uses, so the calculator can pass the capture's own `channelDispersion` to `calculateLateralColorFringe` without running a capture. Every tier body and every `SensorProfile` has the same synthetic colorimetric response shape, EQE_c(λ) = a_c·cmf_c(λ)·(555 nm/λ)·(peak QE / 0.5), with a = 0.5, 0.5, 0.25 and cmf the engine's CIE 1931 fit; the profile (its record or its id) or `peakQuantumEfficiency` only scales it. The result holds the capture's midpoint nodes over 380–780 nm at `spectralStepNanometers` (the capture's EQE breakpoints 380 + kΔ nm, Δ = 400/⌈400/step⌉, EQE at a node the mean of its two breakpoints) and each channel's electrons per joule of incident light, EQE_c(λ)·λ/(h·c). With `illuminant` (any `simulateCapture` illuminant) it also returns `channelDispersion`, the value `calculateChannelEffectiveDispersion` gives for these channels. It is pure and is not part of the capture worker.

The calculator runs at full quality, so the default step is 5 nm, the grid a spiky light needs; pass the capture's `sensor.spectralStepNanometers` to reproduce one capture. At the capture's step it agrees with the `channelDispersion` a capture reports in its `output.lensCorrections` assumption to 1e-9 (default body at 20 nm and a sensor profile at 10 nm, both under a 4200 K Planckian light; `test/camera-channel-response.test.ts`); the small difference is the capture's air-to-vacuum photon-energy factor, constant to about 1e-6, which the helper leaves out. Under a 6500 K Planckian light, PV 24 1.8's corner blue-minus-red displacement at 6 µm is 1.006 px radially with the 20 nm channels and 1.009 px with the 5 nm default. Like the capture's channels, it is the engine's idealized sensor, not a measured one.

## Lateral color as a fringe width

`calculateLateralColorFringe({ lensId, activeImagingArea, pixelPitchMicrometers, fieldPosition?, channelDispersion? })` (#580, model `generic-lens-lateral-color-fringe` 1.0.0) returns the lens's red–blue image displacement at one field position, in micrometers and in pixels of the given pitch, for the app's Guide page on color fringing. `fieldPosition` is `{ x, y }` in fractions of the frame's half-width and half-height (each in [−1, 1], +x right, +y up); the default `{ x: 1, y: 1 }` is the top-right corner. It reads the lens's own lateral-color model above, Δr(λ) = L·R·H·D(λ), by default at the lens corrections' channel wavelengths (`GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM`, 610 and 465 nm), so the blue-minus-red displacement is L·R·H·(D(465) − D(610)) = 1.015·L·R·H; with the optional `channelDispersion` (2.21.0; `calculateChannelEffectiveDispersion` for the camera's channels and the light, [Channel effective dispersion](#channel-effective-dispersion)) it is L·R·H·(D̄_blue − D̄_red), the displacement the capture renders in RAW. The result is radial and positive when blue lands farther from the axis; its x and y parts, the fringe width |Δr| and the lens's F-to-C displacement L·R·H are reported too. Lateral color does not change with the f-number or focus distance in this model. On a full frame, PV 24 1.8's corner fringe is 7.24 µm (1.21 px at 6 µm) and PV 24 1.4 Pro's 2.11 µm (0.35 px).

It is an approximation: a generic lens, single effective channel wavelengths where a real channel spans a band (or, with `channelDispersion`, a neutral surface's weighting of each channel's band), and the geometric displacement only. Against the RAW measure above (Lateral color in RAW; the horizontal part at the corner region's centre, 6 µm, the default sensor, light and 20 nm step), the capture's own channel dispersion predicts 0.232 px for PV 24 1.4 Pro (RAW 0.22 px) and 0.797 px for PV 24 1.8 (RAW 0.80 px); the single wavelengths give 0.278 and 0.957 px, 1/0.833 times more. The developed edge (0.44 and 0.68 px in the table above) differs from both for the reasons given there (`test/generic-lens-lateral-color.test.ts`).
## Focus consistency

`simulateGenericLensFocusError({ lensId, activeImagingArea, fNumber, focusDistanceM, seed, shotIndex?, circleOfConfusionMm? })` returns a seeded autofocus error for one shot: the image-side error z·σ·2Nc, with z a standard normal draw from (seed, shot index) (the MurmurHash3 stream seed, xorshift32 and Box–Muller generators of the capture's sensor noise, so a seed gives the same error every time), σ the lens's focus scatter as a fraction of the depth of focus, and c the circle of confusion (default: the diagonal / 1500). The thin-lens image distance moves by it and the focus distance is read back, held between the minimum focus distance and 1000 m. It is off unless called; `simulateCapture`'s `lens.focusScatter: { seed, shotIndex? }` (with `lens.catalogue`) applies it to the focus distance and records it in the `lens.focusScatter` assumption; it shows only with `lens.defocus`.

## Correction profiles

`createGenericLensCorrectionProfile({ lensId, activeImagingArea, state })` builds the lens's generic correction profile for one exact camera state (`OpticalProfileState`, with the catalogue id as `lensId` and the lens's focal length on that sensor): the lens's radial distortion as a correction map, a per-channel lateral-colour scale 1 + L·D̄_c, with `channelDispersion` the channels' effective dispersion (`calculateChannelEffectiveDispersion`, #589) or by default D at effective channel wavelengths of 610, 540 and 465 nm (`GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM`, a generic approximation), and the relative-illumination gain at the state's aperture (strength 1). It is applied after capture with `resolveLensCorrectionPlan` and `calculateLensCorrectedCapture` (docs/DIGITAL_OPTICS_FOUNDATION.md), whose costs #552 measured: corner resolution, corner noise, and longitudinal colour left in place. Consumer lenses rely on it more: their uncorrected distortion and vignetting are larger. `simulateCapture` does not apply it.

## Limitations

- Generic lenses: no product is modelled, no measured or branded data is used, and no paid dataset (`THIRD_PARTY.md` policy). The sources above are cited for their models and qualitative descriptions; no data is reproduced from them.
- Primary aberrations only, scalar diffraction, a thin-lens pupil at the image distance; no higher orders, no pupil aberrations or mechanical vignetting of the pupil shape (cat's eye), no polarisation.
- Between field and wavelength nodes the PSF is a centroid-aligned blend of the nodes, not a recomputed PSF.
- Flare, ghosting and focus breathing are not rendered. The bokeh is geometric (no onion rings, no wave defocus), one cat's-eye circle stands for every barrel and element rim, and the blades are the same for every lens of a set ([Bokeh](#bokeh-567)). The three fixed phone lenses that the owner added to this catalogue for the phone sensor profile are part of #554.

## Sources

- H. H. Hopkins, *Wave Theory of Aberrations*, Oxford 1950.
- J. C. Wyant and K. Creath, "Basic Wavefront Aberration Theory for Optical Metrology", *Applied Optics and Optical Engineering* XI, ch. 1, 1992 (free author copy).
- J. W. Goodman, *Introduction to Fourier Optics*, 3rd ed., ch. 4–6 (scalar Fraunhofer imaging).
- J. W. Cooley and J. W. Tukey, "An algorithm for the machine calculation of complex Fourier series", *Mathematics of Computation* 19, 1965.
- Wikipedia: Vignetting; Distortion (optics); Chromatic aberration; Coma (optics); Lens flare; Focus breathing (qualitative descriptions of how each effect varies with lens class and aperture).
