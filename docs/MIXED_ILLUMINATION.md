# Mixed lighting (2.22, #550)

`simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and `prepareDisplayView` take an opt-in `illumination`:
up to eight `sources`, each an illuminant (as `illuminant` takes it) at an illuminance, blended across the chart by a declared
function, and up to eight `points`, point light sources with inverse-square falloff (a step toward flash). A request needs two
or more sources, or at least one point; one source lights the whole plane and takes no blend. It replaces `illuminant` and `illuminanceLux` (a request with both is refused). Without it nothing
changes: no code is loaded for it, and every request keeps its bytes.

```ts
import { simulateCapture } from "@photivra/engine";

// Window daylight on the left, a tungsten lamp on the right, crossfading over the middle half of the frame.
const mixed = await simulateCapture({
  scene: { preset: "color-patches" },
  illumination: {
    sources: [
      { illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 8000 },
      { illuminant: "cie-a", illuminanceLux: 3000 }
    ],
    blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } }
  },
  output: { width: 96, height: 64 }
});
console.log(mixed.assumptions.find((a) => a.id === "scene.illumination")?.value);
```

## Model

Source i is the illuminant's spectral shape S_i(λ) scaled exactly as a single illuminant is: k_i such that
683 lm/W · ∫ k_i·S_i(λ)·ȳ(λ) dλ = E_i, its `illuminanceLux` (CIE photometric definition, the engine's analytic CIE 1931 ȳ fit,
1 nm trapezoid rule over 380–780 nm). The plane's spectral irradiance at a point p is the blend

E(p, λ) = Σ_i w_i(p)·k_i·S_i(λ), with w_i(p) ≥ 0 and Σ_i w_i(p) = 1,

so the illuminance at p is Σ_i w_i(p)·E_i, and a Lambertian surface of reflectance ρ(λ) has radiance ρ(λ)·E(p, λ)/π, as under
one illuminant. Where one weight is 1 the light is exactly that source's (its spectrum, so its chromaticity, and its
illuminance). The blend is a declared crossfade of irradiance: exact for what it declares, but not a model of how light falls
off from a real lamp or window (no inverse-square law, no cosine falloff, no shadows, no inter-reflection).

## Point sources

A point source is `{ illuminant, position: { xM, yM, heightM }, intensity }`: its spectrum, its position in metres (`xM`, `yM`
on the plane from the optical axis, +x right and +y up as seen from the camera; `heightM` > 0 in front of the plane, toward the
camera) and its luminous intensity, either `{ candela }` (up to 1e9) or `{ illuminanceLux, distanceM }`, the illuminance it gives
at normal incidence at that distance (I = E·r²). Its spectral intensity c·S(λ) has 683 lm/W · ∫ c·S(λ)·ȳ(λ) dλ = I. A plane point
at distance d from it, at angle θ from the plane's normal, receives

E(p, λ) = c·S(λ)·cos θ / d², with cos θ = heightM / d:

the inverse-square law with Lambert's cosine law. Both follow from the definitions of luminous intensity (flux per solid angle)
and illuminance (flux per area) and the solid angle dΩ = dA·cos θ/d² that a plane element dA subtends at the source (CIE S
017:2020, *ILV: International Lighting Vocabulary*, 2nd edition, entries "luminous intensity" and "illuminance", free at
[e-ilv.cie.co.at](https://e-ilv.cie.co.at/); BIPM, *The International System of Units*, 9th edition, 2019, Table 4, the
steradian). It is exact for an ideal isotropic point source; the source has no size, nothing occludes it (the camera casts no
shadow), and the light it reflects onto itself is not modelled. Points add to the blend:

E(p, λ) = Σ_i w_i(p)·k_i·S_i(λ) + Σ_j c_j·S_j(λ)·cos θ_j / d_j².

Positions are physical, in metres on the plane, whatever `chartSize` says; the blend's coordinates stay the chart's.

## Blends

Coordinates are the chart's. With `chartSize` they are chart-local units (u = ±1 at the chart's left and right edges, v up on
the same scale), extended linearly over the surround; without it they are frame units (u = ±1 at the frame's left and right
edges), which are the chart-local units of a chart that fills the frame. In both, (0, 0) is the frame center.

| `blend.kind` | Fields | Weights |
| --- | --- | --- |
| `"linear-gradient"` | `from`, `to` (points `{ u, v }`), `stops?` | t = ((p − from)·(to − from)) / ‖to − from‖², clamped to [0, 1] |
| `"radial"` | `center?` (default `{ u: 0, v: 0 }`), `radius`, `stops?` | t = ‖p − center‖ / radius, clamped to [0, 1] |
| `"regions"` | `regions` (1–64 of `{ source, uMin, uMax, vMin, vMax }`), `outsideSource` | the source of the first rectangle containing p (bounds inclusive), else `outsideSource` |

On a gradient or radial blend, `stops` lists one position per source, non-decreasing in [0, 1] (default evenly spaced from 0
to 1). Source 0 alone lights t ≤ stops[0], the last source alone t ≥ its stop, and between consecutive stops the two sources
crossfade linearly. Two equal stops make a hard edge; the later source takes the stop itself.

## Exposure and white balance

- **Scene-average metering** keeps its meaning: the meter's 16 × 16 zones read the lit scene over the frame.
- **Grey-card metering** (`exposure.metering: "grey-card"`): the card sits at the frame center and reads the light there,
  E(0) = Σ_i w_i(0)·E_i + Σ_j I_j·cos θ_j/d_j². Reported as the assumption `exposure.meteringCard`.
- `exposure.greyCardDeviationStops` and `exposure.standardExposureIlluminanceLux` use the frame center's illuminance E(0); the
  latter is the center illuminance at which the settings give the standard exposure when every source is scaled by the same
  factor. `scene.illuminant.illuminanceLux` reports E(0).
- **White balance** `"scene-illuminant"` is measured under the light strongest at the frame center: the largest of the
  sources' w_i(0)·E_i and the points' I_j·cos θ_j/d_j², the first on a tie (the sources come before the points). Reported as the assumption `output.whiteBalanceSource`; `scene.illuminant` names that source. An
  explicit white balance (`{ kelvin }`, `"none"`, `"auto"`) is used as given.
- The assumption `scene.illumination` reports the lights (`lights`: the sources, then the points with their position and
  intensity in candela), the blend with its defaults (null without one), the coordinates (`"frame"` or `"chart-local"`) and,
  at the frame center, the illuminance, the blend's weights, each light's illuminance and the strongest light.

## Scenes

Every reflective scene takes the blend: chart presets, fixed-size charts and their surround, `material-layers` scenes, caller
reflectance and material functions. A `radiance-function` scene is refused, because it ignores the illuminant. Under a blend a
point's radiance is no longer a function of its material alone, so no renderer tabulates each material once. A chart or material
scene still takes the capture's tabulated expected signal (#394), which then reads the radiance under the blend at every lattice
point and is verified per CFA phase against the environment chain (1e-9 relative, as for one illuminant); other scenes take the
chain itself. Measured once on an arm64 laptop (Node.js 24, 600 × 400 `color-patches`): the capture 139 ms under one
illuminant, 401 ms under a two-source gradient; a 300 × 200 display view 174 ms and 528 ms.

**Prints (#597, 2.22.0).** An `image-plane` print (#581) is lit like a chart: its reflectance spectrum at each point (the four
nearest pixels' spectra, bilinearly) times the blended irradiance, per spectral node. Its per-pixel channel signals assume one
illuminant, so under a blend no per-pixel signal is cached: every site integrates the lit radiance at use, and only the pixels'
reflectance spectra are cached (by row; the same values). Measured on an arm64 laptop (Node.js 24, a 320 × 240 photo on a
384 × 256 DNG with the 2 × 2 box, best of 4, two runs): the capture 73 ms under one illuminant, 760–780 ms under a two-source
gradient and 590–625 ms under one point source (about 1,240 and 1,070 ms before the spectra were cached); a 192 × 128 display
view 92, 840–850 and 660–700 ms.

## Display view

The display view (CPU) reads the radiance under the blend at every query point, with the capture's own arithmetic and the
view's portable illuminant formulas (docs/DISPLAY_VIEW.md, "Same bytes in every engine"), so each real site's expected
electrons are the capture's (tested to 1e-9). It uses no approximation for the light, so there is no fast method for it on the
CPU. The GPU renderers light chart materials with one illuminant, so a chart view with `illumination` is not rendered on the GPU:
`gpu: "auto"` runs the CPU reference labelled `unsupported-on-backend` with the reason, and `gpu: "require"` fails with it. No
device is requested.

An `image-plane` print under a blend renders on the GPU (#597, 2.22.0; registry entry `illumination/image-plane-gpu`): its
Quality passes (docs/IMAGE_PLANE.md, "On the GPU") take the light's parts and spectra at the nodes, and pass 1 lights each lattice
point per node, Speed requests (no site kernels) included. That is the fast method (`gpu: "auto"`, float32 within an a-priori bound,
flagged points resolved on the host); the exact method is the CPU reference (`gpu: "off"`, the default for `fast: false`).
