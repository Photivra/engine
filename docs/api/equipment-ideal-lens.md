# equipment/ideal-lens.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## IDEAL_LENS_LIMITS

Ideal lens (#576): the bounds of `simulateCapture`'s and the display view's `lens.ideal`, a plain aberration-free thin lens
named by its physical focal length, on any sensor. Its blur is that of the options the request gives, the same models as with
`lens.prime`: `lens.defocus` (the thin-lens blur circle, `calculateDefocusCircle`), `lens.diffraction` (the Airy pattern of a
circular pupil) and `lens.vignetting` (a caller profile). Without them it renders sharp and evenly lit.

- `fNumber.minimum` 0.5 is a physical limit: a lens in air that satisfies the Abbe sine condition (aplanatic) has
  N = 1/(2·n·sin θ′) with n = 1 and sin θ′ ≤ 1, so N ≥ 0.5 (the sine condition: Born & Wolf, *Principles of Optics*, 7th ed.;
  Kingslake & Johnson, *Lens Design Fundamentals*, 2nd ed.). The engine's thin-lens defocus and scalar Airy diffraction
  are paraxial models, so near f/0.5 they are approximations further from a real lens than at f/2.
- `fNumber.maximum` 128 and both focal-length bounds are engine bounds, not physical limits: 1 mm is shorter than phone
  camera lenses, 4000 mm longer than photographic lenses, and f/128 beyond large-format lenses' smallest stops.
- The ideal lens's f-number range is the whole of `fNumber`: manual and aperture priority take any `lens.fNumber` in it, and
  shutter priority and program may choose any aperture in it (in dim light, wider than real lenses open).

```ts
IDEAL_LENS_LIMITS = Object.freeze({
  focalLengthMm: Object.freeze({ minimum: 1, maximum: 4000 }),
  fNumber: Object.freeze({ minimum: 0.5, maximum: 128 })
})
```
