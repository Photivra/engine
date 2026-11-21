# Mixed lighting (2.22, #550)

`simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and `prepareDisplayView` take an opt-in `illumination`:
up to eight `sources`, each an illuminant (as `illuminant` takes it) at an illuminance, blended across the chart by a declared
function, up to eight `points`, point light sources with inverse-square falloff, and (2.26.0) a `flash` ([Flash](#flash)). A request
needs two or more sources, at least one point or a flash; one source lights the whole plane and takes no blend. It replaces `illuminant` and `illuminanceLux` (a request with both is refused). Without it nothing
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

## Flash

`illumination.flash` (2.26.0, #639) is an electronic flash: an impulse of light from a point, with inverse-square falloff, whose
energy does not depend on the shutter time. It can be the only light (`illumination: { flash }`) or add to `sources` and `points`,
the ambient light.

```ts
import { simulateCapture } from "@photivra/engine";

// Slow sync: dim tungsten ambient light and a guide-number-32 flash on the camera, subject at 4 m, f/8, ISO 100.
const base = { scene: { preset: "uniform" as const }, subjectDistanceM: 4, lens: { fNumber: 8 }, output: { width: 32, height: 24 } };
const illumination = { sources: [{ illuminant: "cie-a" as const, illuminanceLux: 100 }], flash: { output: { guideNumberM: 32 } } };
for (const shutterSeconds of [1 / 250, 1 / 2]) {
  const capture = await simulateCapture({ ...base, illumination, exposure: { mode: "manual", iso: 100, shutterSeconds } });
  console.log(shutterSeconds, capture.exposure.greyCardDeviationStops); // about 0 at 1/250 s (the flash), about -0.37 at 1/2 s (ambient added)
}
```

| Field | Meaning |
| --- | --- |
| `output` | Full-power output, one of `{ guideNumberM }` (the guide number at ISO 100, metres, up to 1e4), `{ candelaSeconds }` (time-integrated luminous intensity Q, cd·s = lm·s/sr, up to 1e9) or `{ luxSeconds, distanceM }` (the luminous exposure H at normal incidence at that distance, Q = H·r²). |
| `powerFraction` | The manual power setting p in (0, 1], default 1 (full power); the flash gives p·Q, its guide number G·√p. |
| `position` | `{ xM, yM, heightM }` as for a point source; default on the optical axis at the camera, `heightM` the subject distance. |
| `illuminant` | Its spectrum, any `illuminant`; default a Planckian 5500 K stand-in. That is not a measured flash tube; pass a spectrum for one. |

**Model.** The flash emits Q = p·Q_full cd·s: luminous intensity integrated over the pulse, the photometric quantity behind luminous
exposure (CIE S 017:2020 ILV, entries "luminous intensity", "illuminance" and "luminous exposure", free at
[e-ilv.cie.co.at](https://e-ilv.cie.co.at/)). A plane point at distance d and angle θ from the normal receives the luminous exposure
H = Q·cos θ/d² lx·s, the inverse-square and cosine laws of [Point sources](#point-sources) applied to the time integral. The pulse
fires while every site integrates, so every site collects all of it whatever the shutter time T: a capture's signal is irradiance × T,
so the flash enters every render path (captures and their exports, `simulateIdealReference`, the display view with fast and exact
rendering, and a print's GPU light table) as a point source of intensity Q/T over the exposure window, with spectrum c·S(λ) scaled as a
point source's is. Its share of each site is then exactly Q·cos θ/d² times the site's response, independent of T; the ambient light's
share grows with T. That is slow sync (dragging the shutter): a longer shutter brightens the ambient-lit parts and leaves the flash's
part unchanged.

**Guide number.** G = d·N: the distance d at which the flash exposes a subject correctly at f-number N, at ISO 100. With the derivation
in [Guide number](SCENE_SENSOR_TEMPORAL_EXPOSURE.md#guide-number) (CIPA DC-004-2020: S = 10/H and the camera equation H = 0.65·L·t/N²,
free at <https://www.cipa.jp/e/std/std-sec.html>; the inverse-square law, NIST SP 250-37) and the facade's 18 % grey card as the
subject (the card behind `exposure.greyCardDeviationStops`), 0.65·0.18·Q/(π·d²·N²) = 10/100, so

Q = 10π·G² / (0.65 · 0.18 · 100) ≈ 2.685·G² cd·s.

So a flash of guide number G gives `greyCardDeviationStops` 0 at d·N = G at ISO 100, at any shutter time, and G·√(S/100) at ISO S. A
maker's quoted guide number rests on its own measurement conventions (reflectance, beam, calibration), which may differ from this one.

**Exposure.** The meter reads the flash as a pre-flash reading would: each zone the ambient luminance plus the flash's
time-integrated luminance over the shutter t (grey-card metering: the card at the frame center under E_ambient + H/t). Manual and
shutter priority know t. In aperture priority and program, t is unknown: the settings are those whose resolved shutter R(t), from the
reading at t, is t. ln R(eˣ) − x is ≥ 0 at the body's shortest shutter and ≤ 0 at its longest, so the facade takes the longest shutter
if it is such a point and otherwise bisects in x to 1e-12, then steps t ← R(t) a few times (for a body with discrete shutters). With
ambient light the result is the shutter at which ambient plus flash meet the target (for example ambient needing 4/125 s alone and a
flash giving half the target: t = 2/125 s); a flash that alone overexposes holds the shortest shutter. **Flash alone** (owner decision
2026-11-16): when the meter's ambient reading is zero (every zone, or the grey card's ambient illuminance), every shutter gives the
same exposure, so aperture priority and program take 1/125 s, held within the body's shutter range (every built-in body has
1/8000–30 s), and resolve the rest at it: aperture priority as manual (Auto ISO chooses the ISO), program as shutter priority (the
aperture, and with Auto ISO the ISO). Reported as the assumption `exposure.flashShutter`. Reports (`scene.illumination`, the deviations,
`exposure.meteringCard`) are those at the resolved shutter; the flash's light reports `intensityCandela` Q/t and
`flash: { candelaSeconds, powerFraction, guideNumberM, exposureWindowSeconds }`.

**Limits.** Refused: a flash with camera rotation or `motion.subject` (the pulse would freeze the motion at its instant, which the
temporal quadrature does not place), and with `motion.shutter: "rolling"` a shutter shorter than the readout skew (no instant at which
every row is open; `InvalidScientificInputError`). An isotropic point: no reflector beam pattern, no source size, no occlusion or
red-eye; no TTL, high-speed sync, pulse shape, recycle time or color shift with power (the lower-level flash contracts in
docs/USAGE.md, "Manual flash and ordinary sync", model some of these). In `simulateExposureBuildUp` every fraction holds the whole
pulse, as with front-curtain sync.

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
illuminant, 401 ms under a two-source gradient; a 300 × 200 display view 174 ms and 528 ms. Since 2.28.0 (#735) each point's
material and blend are resolved once for all its spectral nodes (the same values), which matters most at the 5 nm step: three
600 × 400 `color-patches` captures at `sensor.spectralStepNanometers: 5` with `fast: false` took 0.6–0.7 s under one illuminant
and 3.9–6.8 s under a gradient, a radial blend, 64 regions or a gradient with a point source before, 1.0–1.6 s after (paired runs on
a loaded machine).

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
