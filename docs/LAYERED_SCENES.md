# Layered chart scenes

A layered chart scene (#652, 2.27.0) puts several flat, opaque, fronto-parallel cards at different distances in one frame,
in front of an optional back plane with point lights, so that focus, background blur and the shape of out-of-focus
highlights can be seen side by side. Each site's defocus comes from the depth of the surface it sees, integrated per site
on every render path, with occlusion handled in both directions: a blurred front card spreads over the card behind it, and
a blurred background is cut off at a sharp front edge.

Source: `src/facade/layered-chart-scene.ts` (schema, validation, presets, depth report), `src/facade/layered-scene-signal.ts`
(the layered sum and the display view's expected signal), `src/facade/layered-scene-provider.ts` (the capture's and ideal
reference's scene provider).

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

Per card and for the back plane, nearest first: `{ distanceM, defocusDiameterSites, withinDepthOfField }`, with the blur
circle c = f²·|s − d| / (N·d·(s − f)) of `calculateDefocusCircle` divided by the site pitch, and `withinDepthOfField` true
between the near and far limits of `calculateDepthOfField` at the request's circle of confusion, so callers can label the
cards.

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
  that surface's single-plane sum. A site whose lattice points all see one surface takes the single-plane path of that
  surface (its tables, regrouped runs and caches) unchanged; the other sites ("edge sites") take the layered sum. Both use the
  same per-layer kernels, so there is no seam between them beyond rounding.
- **Point lights** are part of the back plane's radiance on the lattice: the lattice cell that holds a light has its radiance
  raised by I_e / A, A the cell's area on the back plane (paraxial, (g·m_B)² with g the frame units per site and m_B the back
  plane's metres per frame unit), so the cell emits the light's power. The sum then spreads it exactly as it spreads the back
  plane: a light renders as the back plane's aperture image (disc, blades, cat's eye) at the back plane's blur, cut by nearer
  cards. In focus a light's energy goes to the site that holds it. A light's position is quantized to its lattice cell (at
  most half a site), and two lights may not share a cell.
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
it, each showing a Siemens star and its depth label, and a back plane with a 12-column grid of point lights one step beyond
the farthest card.

- **Spacing** (owner decision): behind the focus plane the steps grow geometrically from the scale's first step by a ratio of
  1.5, d_i = s + first·(1 + 1.5 + … + 1.5^(i−1)): `macro` 1 mm, `tabletop` 1 cm (at about 1 m), `large` 0.25 m (at about 5 m).
  In front of it the cards are symmetric in defocus: c is proportional to |s − d|/d, so the card matching d_i is at
  s·d_i / (2·d_i − s), whatever the lens. More cards therefore sit where sharpness changes fastest.
- The lights' intensity, 0.05 cd per square metre of back-plane distance, gives each scale the same illuminance at the lens;
  it is a starting value, to be revisited with the spacing once the presets can be looked at.
- A preset whose nearest card would be within 1 % of the focal length is refused.

## Limits and refusals (2.27.0)

- No GPU path: a layered scene renders on the CPU, labelled `unsupported-on-backend` under `gpu: "auto"`.
- Refused with layered scenes: `motion` of any kind, `lens.projection` other than rectilinear, and a surface kernel radius
  above 64 sites in a scene of more than one surface (edge sites sum the kernel directly).
- The provider's lattice argument needs the still, rectilinear, distortion-free camera with one radiance-to-irradiance factor
  over the field, as the single-plane object-space convolution does.
- The ray map is the aberration-free linear one at every surface; with a shaped kernel, V is the share of the disc's rays in
  the tap's region (the kernel's weight carries the shape).

Cost, module level, for a 192 × 128-site region at a card corner of the tabletop preset (6000 × 4000 sites of 6 µm, 50 mm,
focused at 1 m, a 2 × 2 pixel aperture, one process, CPU time on a machine at load average 80–240): about 2–3 µs per site
for the view at f/2 (5.2 % edge sites) and f/8 (3.9 %), fast or full; reported, with no threshold in CI.
