# Layered chart scenes

A layered chart scene (#652, 2.27.0) puts several flat, opaque, fronto-parallel cards at different distances in one frame,
in front of an optional back plane with point lights, so that focus, background blur and the shape of out-of-focus
highlights can be seen side by side. Each site's defocus comes from the depth of the surface it sees, integrated per site
on every render path, with occlusion handled in both directions: a blurred front card spreads over the card behind it, and
a blurred background is cut off at a sharp front edge.

Source: `src/facade/layered-chart-scene.ts` (schema, validation, presets, depth report), `src/facade/layered-scene-signal.ts`
(the layered sum and the display view's expected signal), `src/facade/layered-scene-provider.ts` (the capture's and ideal
reference's scene provider).

## Using it

```ts
import { prepareLayeredChartScenes, resolveLayeredChartPreset, simulateCapture } from "@photivra/engine";

await prepareLayeredChartScenes(); // once per realm: loads the layered-scene code (a lazy chunk)
const scene = resolveLayeredChartPreset({ scale: "tabletop", focusDistanceM: 1, lens: { focalLengthMm: 50 } });
const result = await simulateCapture({ scene, subjectDistanceM: 1, lens: { focalLengthMm: 50, fNumber: 4, focusDistanceM: 1 },
  exposure: { mode: "manual", shutterSeconds: 1 / 125, iso: 100 }, output: { width: 600, height: 400 } });
result.scene.layers; // per card and the back plane: distance, blur diameter, within the depth of field
```

The centers of the Siemens stars hold detail finer than one pixel. With the defaults this capture samples each site at its
center, has no anti-aliasing filter and demosaics bilinearly, so that detail aliases: the star centers show false patterns and
false color. [Pixel aperture](QUICK_START.md#pixel-aperture-23) and [Anti-aliasing filter](QUICK_START.md#anti-aliasing-filter)
in the quick start describe the options that reduce it, and what each costs.

- `simulateCapture`, `simulateIdealReference`, `simulateDisplayView` and `prepareDisplayView` take `scene.kind: "layered-chart"`
  once `prepareLayeredChartScenes()` has run in the realm; before it a layered request fails with a message saying so. As for
  image-plane scenes (`prepareImagePlaneScenes()`), the dynamic import in that function is the only reference to the layered code,
  so a bundle that never imports it carries none of its bytes (about 10 KB gzip).
- A layered scene implies `lens.defocus: { model: "geometric-disc" }` (recorded as a `lens.defocus` default); the bokeh options
  of `lens.defocus` (blades, spherical aberration, the cat's eye) shape every surface's kernel.
- `subjectDistanceM` is the framing reference: the frame's width in metres is taken at that distance (frame units are angles, so
  each surface's metres per frame unit scale with its own distance). Each surface's defocus is that of its own distance.
- The result's `scene.layers` is the depth report below; `scene.preset` is `"layered-chart"`; the `scene.layers` assumption
  records the route, the occlusion rows, each surface's kernel radius and whether a cat's eye shapes them.
- Metering, white balance and the display view's pilot read, at each frame point, the surface its chief ray meets, sharp and
  without the point lights (the meter reads the scene before the lens; the lights are single lattice cells).
- The ideal reference of a layered scene reads the layered sum without diffraction (defocus and occlusion are the scene's depth
  structure) at the pixel-aperture nodes, with the full occlusion rows by default. It keeps the rectilinear, distortion-free
  lattice (no camera effects), whatever the request's lens.
- From 2.29.0 (#744): `lens.projection`, `lens.distortion` and `lens.vignetting` apply to layered scenes. The sum moves to the
  sensor's site lattice through the lens (see [Through a lens](#through-a-lens-2290)). A fisheye renders only while every point the
  request reads stays under 75° off the axis (15° inside the horizon); beyond that it is refused with the angle found.
- From 2.29.0 (#745): `illumination` (mixed lighting) lights each surface point by the blend and point sources at its own frame
  point, as one light field over the frame's angles: an approximation, with no shadows between surfaces and no falloff with depth.
  A back plane's point lights keep their own spectrum. Metering, white balance and the pilot read the chief ray's surface under the
  blend, as the single-plane mixed path does.
- From 2.29.0 (#761): `chartSize` sets the metres per frame unit of the cards: they are placed in chart units, u = ±1 at the chart's
  left and right edges at `subjectDistanceM` (and v = ±heightM / widthM at its top and bottom), and the far surface continues
  beyond the chart, as the frame does without it; there is no surround, so `chartSize.surroundReflectance` is refused.
  `scene.chart` reports the chart's image size as for a single-plane chart.
- From 2.29.0: `view.focusMask` on `simulateDisplayView` and `PreparedDisplayView.render` returns an in-focus guide per display
  pixel ([DISPLAY_VIEW.md](DISPLAY_VIEW.md#in-focus-mask-2290)): for a layered scene the chief ray's surface at each pixel centre,
  through the lens.

### Tap to focus (#747)

`calculateLayeredChartSurfaceAt({ scene, aspect, u, v })` gives the surface the chief ray through a frame point sees and its
distance along the axis (the `finite-surface` focus target). With a rectilinear lens a pixel centre (x, y) of a W × H frame is
u = (x + ½ − W/2)·2/W, v = −(y + ½ − H/2)·2/W:

```ts
const at = calculateLayeredChartSurfaceAt({ scene, aspect: H / W, u: (x + 0.5 - W / 2) * 2 / W, v: -(y + 0.5 - H / 2) * 2 / W });
const focused = await simulateCapture({ ...options, lens: { ...options.lens, focusDistanceM: at.distanceM } });
```

`calculateLayeredChartSurfaceAtPixel({ scene, output: { width, height }, pixel: { x, y }, sensor: { pixelPitchMicrometers }, lens:
{ focalLengthMm, focusDistanceM?, projection?, distortion? }, subjectDistanceM, chartSize? })` maps the output pixel's centre through
the request's lens with the engine's own mapping (the one the view's pilot reads) and returns the same record, or null where the
pixel sees no scene (90° and beyond, or outside a fisheye's image circle). It does not take `lens.catalogue`.

## The scene

```ts
scene: {
  kind: "layered-chart";
  cards: { distanceM: number; centerU: number; centerV: number; width: number; height: number;
           scene: ChartScene; depthLabel?: boolean }[];
  backPlane?: { distanceM: number; reflectance?: ChartReflectance;
                pointLights?: { seed: number; columns: number; rows: number; jitter?: number;
                                luminousIntensityCandela: number; spectrum?: CaptureIlluminant } };
}
```

- **Cards** (1 to 16) are listed nearest first, at strictly increasing distances. Each is placed in frame units **as seen
  from the lens** (u = ±1 at the frame's left and right edges, v up): a frame unit is the same angle at every depth, so a
  farther card covers more metres for the same frame units. A card's `scene` is any chart preset, resolved in the card's
  own frame (u = ±1 at its left and right edges, aspect = height / width), as a composite element is. Cards are opaque.
  `depthLabel: true` prints the card's distance in millimetres (seven-segment digits, dark on a light plate) in its top-right
  corner.
- **The back plane** is an unbounded surface beyond the farthest card, neutral or spectral (default reflectance 0.18), lit
  by the scene's illuminant like the cards.
- **The far surface** (the back plane, or the farthest card without one) has no edge: its print continues beyond its
  rectangle, as a single-plane chart's does. One card without a back plane is therefore a single-plane chart scene and
  renders on the single-plane path, byte for byte as before.
- **Point lights** are a seeded, jittered grid over the frame (`columns` × `rows`, each light within `jitter` × its grid cell
  of the cell's centre, default 0.5). Each light has luminous intensity I_v (cd) and the relative spectrum S of `spectrum`
  (default CIE illuminant A), so its spectral intensity is I_e(λ) = k·S(λ) W·sr⁻¹·nm⁻¹ with k = I_v / (683 ∫ S ȳ dλ), the
  photometric definition evaluated with the same 1 nm quadrature as the illuminant scale.

## The depth report

Per card and for the back plane, nearest first: `{ kind, index, distanceM, defocusDiameterSites, signedBlurRadiusSites,
withinDepthOfField }`. `kind` is `"card"` or `"back-plane"` and `index` the card's index in `cards` (−1 for the back plane);
`defocusDiameterSites` is the blur circle c = f²·|s − d| / (N·d·(s − f)) of `calculateDefocusCircle` divided by the site pitch;
`signedBlurRadiusSites` is +c/2 behind the focus plane and −c/2 in front of it (the layered sum's ray map); and
`withinDepthOfField` is true between the near and far limits of `calculateDepthOfField` at the request's circle of confusion,
so callers can label the cards. `result.scene.layers` reports these records, and `calculateLayeredChartDepths({ scene,
focalLengthMm, aperture, focusDistanceM, circleOfConfusionMm, pixelPitchMicrometers })` returns them for a scene as a request
writes it (validated as a request's is; the depths do not depend on the frame's aspect).

## Model

A thin lens focused at s, geometric optics. The ray through image point p and pupil point P (pupil-radius units) meets the
surface at depth d at p − ρ_d·P on the site lattice, with ρ_d = σ·c_d/2 the signed blur radius in sites (σ = +1 behind the
focus plane, −1 in front of it). Because frame units are angles, the chief ray's point is the same lattice point at every
depth, and the pupil's image turns over between the two sides of the focus plane. The irradiance at p is the mean over the
pupil of the radiance of the first surface each ray meets:

  E(p, λ) ∝ ∫ P(a) · L_first(p, a, λ) da / ∫ P(a) da.

This is the thin-lens camera of distributed ray tracing (Cook, Porter and Carpenter, "Distributed ray tracing", SIGGRAPH
1984; Pharr, Jakob and Humphreys, *Physically Based Rendering*, 4th ed., §5.2.3, free online; survey: Barsky and Kosloff,
"Algorithms for rendering depth of field effects in computer graphics", 2008). It is an approximation: geometric optics, an
ideal thin lens, flat opaque Lambertian cards, no light scattered between surfaces.

## Evaluation on the site lattice

Surface k's defocus kernel D_k is the single-plane path's own kernel at its depth: the disc of `lens.defocus` (the exact
cell areas of `createDefocusDiscSiteKernel`), or the shaped kernel of the blades and spherical aberration. Its tap t stands
for the pupil region P ∈ cell(t)/ρ_k (the whole pupil for a kernel of radius 0). The spectral radiance reaching lattice
point p is

  S(p)[n] = Σ_k Σ_t D_k(t) · V_k(p, t) · L_k(p − t)[n],

with V_k(p, t) the share of tap t's pupil region whose rays hit surface k (inside its rectangle) and pass every nearer
card. Cards are axis-aligned rectangles, so each card edge is a line of constant Px or Py in the pupil:

- V is 0 or 1 when the region's ray boxes lie inside or outside the rectangles.
- Otherwise the region is integrated in rows of Py. Along a row the open part is exact: the pupil's chord, minus (or within)
  each rectangle's interval in Px. The rows are split at every card edge's Py, so within a segment only the chord changes.
  There are n rows per site of the widest footprint the region's rays have on a card they cross, and at least n per region:
  n = 4 (fast) or 16 (full), midpoints weighted by row height.

Each site integrates its own channel response at the site, from the spectra, as on every other path:
μ_c(x) = Σ_o w_o Σ_n A_c(λ_n) · Σ_s K_n(s) · S(x + o − s)[n], over the query offsets o (pixel aperture, anti-aliasing spots)
and, with `lens.diffraction`, each node's diffraction kernel K_n (the single-plane path's "diffraction convolved with the
disc" approximation, applied per layer).

- **Away from card edges** a lattice point whose rays all reach one surface has V = 1 there and 0 elsewhere: its value is
  that surface's single-plane sum. A site whose lattice points all see one surface takes the single-plane sum of that
  surface with its combined kernels (the per-layer kernel convolved with each node's diffraction kernel; never the regrouped
  runs); the other sites ("edge sites") take the layered sum. Both use the
  same per-layer kernels, so there is no seam between them beyond rounding.
- **Point lights** are part of the back plane's radiance on the lattice: the lattice cell that holds a light has its radiance
  raised by I_e / A, A the cell's area on the back plane (paraxial, (g·m_B)² with g the frame units per site and m_B the back
  plane's metres per frame unit), so the cell emits the light's power. The sum then spreads it exactly as it spreads the back
  plane: a light renders as the back plane's aperture image (disc, blades, cat's eye) at the back plane's blur, cut by nearer
  cards. In focus a light's energy goes to the site that holds it. A light's position is quantized to its lattice cell (at
  most half a site), and two lights may not share a cell: a request where two lights lie closer than one site on both axes
  (a grid pitch of at most one site, or neighbours brought together by the jitter) is refused, rather than one light being
  lost.
- **The cat's eye** (`lens.defocus.catsEye`): the single-plane display view refuses it (its tables hold one kernel), but the
  layered sum reads each lattice point's kernel from the capture's field zones (each zone's shaped kernel at its centre's field
  point), so layered scenes render it in the view as the capture does. Those sites all take the layered sum.

### Fast and full

The row count is the one choice: `fast` takes 4 rows per site of footprint and the full method 16. They differ by more than
the equivalence tolerance, so both are kept, as `fast` (registry entry `scene.layers/occlusion-samples`): fast for the
display view and sRGB samples, full for exports, `simulateIdealReference` and `fast: false`.

### Caches

Spectral lattice tiles (`spectral-lattice-tiles.ts`, 32 × 32 points) hold, per surface and lattice group, each lattice
point's spectral radiance L_k at the nodes, and per lattice group the sum S at the nodes. Nothing holds a channel response
summed over the spectrum, and nothing is keyed by material or level. Every value depends only on its lattice point, so
regions and parts equal the whole view bit for bit, and tiles dropped and recomputed have the same bits. The store is
bounded (64 MiB by default).

### The capture

The capture's and ideal reference's provider answers each environment query of a lattice point with that point's value of
the same sum (after diffraction), and the environment declares no further PSF. Capture and view therefore form the same
per-site sum and agree within 1e-9 relative.

### Through a lens (2.29.0)

With `lens.projection`, `lens.distortion` or `lens.vignetting` (#744) the lattice is the sensor's site lattice in image space, as
the single-plane image-space path has it (#548). A lattice point's sensor point goes through the lens (the inverse distortion,
then the projection) to a field direction, which is one frame point on every surface (frame units are angles); its field factor
(vignetting throughput times the distortion's area factor) multiplies each surface's radiance there. Defocus and occlusion stay on
the lattice. Near a lattice point each card edge, a curve in image space, is taken as its tangent line, an approximation of second
order in the edge's curvature that is measured at every point; where it deviates by more than 1/32 site, each kernel tap takes its
own tangents. Every site takes the layered sum (the single-surface shortcut does not read the lens).

The capture's environment declares the request's lens field mapping and vignetting, and the provider keys each query by its
lattice point through the lens and divides by the query point's field factor, so the capture and the view form the same per-site
sum (within 1e-9 relative, `test/layered-scene-wiring.test.ts`). The display view's pilot reads the frame point its planar point
maps to.

Fisheyes: the frame coordinate (tan θ) grows without bound toward the horizon, so a layered request with a fisheye projection is
refused when any point it reads (the outer sites widened by the lattice's reach) looks 75° or more off the axis (owner decision,
2.29.0).

## Accuracy

Measured by the module tests (`test/layered-scene-*.test.ts`):

| Check | Full (16 rows) | Fast (4 rows) | Bound |
| --- | --- | --- | --- |
| One surface against the single-plane signal | bit for bit | bit for bit | identical |
| Edge spread of each card against the disc of `calculateDefocusCircle` (edge on a cell boundary) | < 1e-9 | < 1e-9 | lattice bound |
| Occlusion edges against a brute-force aperture integration (64 × 64 staggered pupil points per site; front edge over a far plane), worst share of the local swing | 0.09 % | 0.03 % | 0.5 % full, 2 % fast |
| The same against 1024 × 1024 pupil points | 0.005 % | 0.07 % | |
| Energy: white cards at four depths over a white back plane, worst deviation from flat | 0.009 % | 0.08 % | 0.2 % full, 1 % fast |
| A point light: summed electrons against the in-focus light | < 1e-9 relative | < 1e-9 relative | 1e-9 |
| A point light: radius from the second moment against c/2 | < 1 % | | |
| Capture against view, per site, with a pixel aperture and diffraction | < 1e-9 relative | < 1e-9 relative | 1e-9 |

The brute-force reference staggers its pupil grid (each row and column shifted by an irrational fraction of a step): an
aligned 64 × 64 grid moves a whole column of points across an axis-aligned card edge at once, an error of up to about 1 %
of the pupil on its own.

## Presets

`resolveLayeredChartPreset({ scale, cards?, focusDistanceM, lens, aspect?, pointLights? })` lays out a staircase: `cards`
cards (default 5) with one at the focus distance, each farther card up and to the right of the one in front and overlapping
it, each showing a Siemens star and its depth label, and a back plane with a 12-column grid of point lights two steps beyond
the farthest card (the steps continue the geometric series behind the focus plane: the back plane is at the distance the
series would give a card two places farther back).

- **Spacing** (owner decision): behind the focus plane the steps grow geometrically from the scale's first step by a ratio of
  1.5, d_i = s + first·(1 + 1.5 + … + 1.5^(i−1)): `macro` 1 mm, `tabletop` 1 cm (at about 1 m), `large` 0.25 m (at about 5 m).
  In front of it the cards are symmetric in defocus: c is proportional to |s − d|/d, so the card matching d_i is at
  s·d_i / (2·d_i − s), whatever the lens. More cards therefore sit where sharpness changes fastest.
- The lights' intensity, 0.05 cd per square metre of back-plane distance, gives each scale the same illuminance at the lens;
  it is a starting value, to be revisited with the spacing once the presets can be looked at.
- A preset whose nearest card would be within 1 % of the focal length is refused.

## Limits and refusals (2.29.0)

- No GPU path: a layered scene renders on the CPU, labelled `unsupported-on-backend` under `gpu: "auto"` (`"require"` fails).
- Refused with layered scenes, each with a message naming the option: `motion` of any kind, `lens.catalogue`,
  `lens.pupilSampling`, `lens.psf` (a caller PSF), and `lens.defocus.catsEye` with `lens.diffraction` (as for any scene). A
  single card without a back plane renders on the single-plane path, so `simulateDisplayView` refuses the cat's eye for it. Also
  refused: two lights that can fall in one site (closer than one site on both axes); a fisheye that reads a point 75° or more off
  the axis; `chartSize.surroundReflectance`; and `illumination` with `chartSize` (in 2.29.0: the blend would be placed in chart
  units while the scene's metering reads the frame).
- Kernel bounds in a scene of more than one surface (#749): a disc's kernel radius above 512 sites (the single-plane bound,
  `lens.defocus: The blur circle is …`) and a shaped kernel's above 128 (`lens.defocus: a surface's blur needs a kernel radius of …`)
  are refused, every surface checked before any kernel is built. `calculateLayeredChartKernelRadii` gives each surface's radius
  and whether it is within the bound.
- The ray map is the aberration-free linear one at every surface; with a shaped kernel, V is the share of the disc's rays in
  the tap's region (the kernel's weight carries the shape).

Cost through the public API (2.27.0, report only; `node scripts/benchmark-layered-scenes.mjs 2` after `npm run build`, on an
Apple M5 Pro, Node 26.13.1, one process, load average 13–19): the tabletop preset on a 6000 × 4000 sensor of 6 µm sites, an ideal
50 mm lens focused at 1 m, a 2 × 2 box pixel aperture, a 192 × 128 region on the right edge of the card at the focus
distance (2.6 % edge sites at f/2 and f/8), CPU time of the process, the second of two runs:

| f-number | View region 1:1, fast | View region 1:1, full | Capture region, fast | Capture region, full |
| --- | --- | --- | --- | --- |
| f/2 (kernel radii 3, 1, 0, 1, 3 and 8 sites) | 0.26 s | 0.20 s | 0.88 s | 0.80 s |
| f/8 (radii 1, 0, 0, 0, 1 and 2) | 0.05 s | 0.05 s | 0.79 s | 0.80 s |

The capture region runs the environment chain per site through the layered provider (never the single-plane tables).

Cost, module level, for a 192 × 128-site region at a card corner of the tabletop preset (6000 × 4000 sites of 6 µm, 50 mm,
focused at 1 m, a 2 × 2 pixel aperture, one process, CPU time on a machine at load average 80–240): about 2–3 µs per site
for the view at f/2 (5.2 % edge sites) and f/8 (3.9 %), fast or full; reported, with no threshold in CI.
