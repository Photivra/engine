# Mixed lighting (2.22, #550)

`simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and `prepareDisplayView` take an opt-in `illumination`:
two to eight light sources, each an illuminant (as `illuminant` takes it) at an illuminance, blended across the chart by a
declared function. It replaces `illuminant` and `illuminanceLux` (a request with both is refused). Without it nothing
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
  E(0) = Σ_i w_i(0)·E_i. Reported as the assumption `exposure.meteringCard`.
- `exposure.greyCardDeviationStops` and `exposure.standardExposureIlluminanceLux` use the frame center's illuminance E(0); the
  latter is the center illuminance at which the settings give the standard exposure when every source is scaled by the same
  factor. `scene.illuminant.illuminanceLux` reports E(0).
- **White balance** `"scene-illuminant"` is measured under the source strongest at the frame center: the largest w_i(0)·E_i,
  the first on a tie. Reported as the assumption `output.whiteBalanceSource`; `scene.illuminant` names that source. An
  explicit white balance (`{ kelvin }`, `"none"`, `"auto"`) is used as given.
- The assumption `scene.illumination` reports the sources, the blend with its defaults, the coordinates (`"frame"` or
  `"chart-local"`) and the frame center's illuminance, weights and strongest source.

## Scenes

Every reflective scene takes the blend: chart presets, fixed-size charts and their surround, `material-layers` scenes, caller
reflectance and material functions. A `radiance-function` scene is refused, because it ignores the illuminant. Under a blend a
point's radiance is no longer a function of its material alone, so no renderer tabulates each material once. A chart or material
scene still takes the capture's tabulated expected signal (#394), which then reads the radiance under the blend at every lattice
point and is verified per CFA phase against the environment chain (1e-9 relative, as for one illuminant); other scenes take the
chain itself. Measured once on an arm64 laptop (Node.js 24, 600 × 400 `color-patches`): the capture 139 ms under one
illuminant, 401 ms under a two-source gradient; a 300 × 200 display view 174 ms and 528 ms. 2.21's `image-plane` print (#581) is lit like a chart (its reflectance at each point times the blended irradiance); its
tabulated per-pixel signals assume one illuminant, so under a blend it takes the same general path.

## Display view

The display view (CPU) reads the radiance under the blend at every query point, with the capture's own arithmetic and the
view's portable illuminant formulas (docs/DISPLAY_VIEW.md, "Same bytes in every engine"), so each real site's expected
electrons are the capture's (tested to 1e-9). It uses no approximation for the light, so there is no fast method for it. The GPU
renderers light chart materials with one illuminant, so a view with `illumination` is not rendered on the GPU: `gpu: "auto"`
runs the CPU reference labelled `unsupported-on-backend` with the reason, and `gpu: "require"` fails with it. No device is
requested.
