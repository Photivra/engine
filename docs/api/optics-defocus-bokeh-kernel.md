# optics/defocus-bokeh-kernel.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDefocusBokehKernel

The defocus kernel of `lens.defocus` with bokeh options (#553), on the site lattice, for one field point: the same kernel
`simulateCapture` and the display view apply (on the field zone's centre with a cat's eye). Pure; for tests, previews and
lens catalogues. Fails with `InvalidScientificInputError` past {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} (spherical
aberration can widen the blur beyond the disc) or when the cat's eye closes the pupil, `InvalidConfigurationError` for
unknown fields. A geometric approximation: see the module comment of `defocus-bokeh-kernel.ts` and docs/QUICK_START.md,
"Bokeh character".

```ts
export function calculateDefocusBokehKernel(input: CalculateDefocusBokehKernelInput): CalculationResult<DefocusBokehKernel>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDefocusBokehKernelInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDefocusBokehKernelInput {
  /** Lens focal length, mm. */
  focalLengthMm: number;
  /** Working f-number. */
  aperture: number;
  /** Focus-plane distance, m. */
  focusDistanceM: number;
  /** Scene-plane distance, m. */
  subjectDistanceM: number;
  /** Sensor site pitch, µm: the lattice the kernel is sampled on. */
  pixelPitchMicrometers: number;
  /** The bokeh options, as `lens.defocus` takes them (blades, sphericalAberration, catsEye). */
  bokeh: DefocusBokehOptions;
  /** Field tangent tan θ·(cos φ, sin φ) in output-image axes (+X right, +Y up); only the cat's eye reads it. Default on axis. */
  fieldTangent?: { x: number; y: number };
}
```

## DEFOCUS_BOKEH_MAXIMUM_BLADES

Largest blade count of `lens.defocus.blades` (and of {@link DefocusBokehBlades}).

```ts
DEFOCUS_BOKEH_MAXIMUM_BLADES = 32
```

## DefocusBokehBlades

Aperture blades: a regular polygon, optionally with rounded blades and open at wide f-numbers.

```ts
export interface DefocusBokehBlades {
  /** Number of diaphragm blades, 3 to {@link DEFOCUS_BOKEH_MAXIMUM_BLADES}. */
  count: number;
  /** Rotation of the first blade edge, degrees counter-clockwise (`calculateIdealApertureGeometry`'s convention). Default 0. */
  firstBladeEdgeAngleDegrees?: number;
  /** Blade roundness κ in [0, 1]: each edge is an arc of radius 1/κ circumradii (0: straight blades, 1: a circle). Default 0. */
  curvature?: number;
  /** At or below this f-number the blades are open and the opening is circular (the lens's widest aperture). Default: never. */
  circularAtOrBelowFNumber?: number;
}
```

## DefocusBokehCatsEye

Mechanical vignetting (cat's eye): the open pupil clipped by each aperture at the field point.

```ts
export interface DefocusBokehCatsEye {
  /** One through eight clipping apertures. */
  apertures: readonly DefocusBokehClippingAperture[];
  /**
   * `lens.defocus` only: zones across the frame's long side (1 to {@link DEFOCUS_BOKEH_MAXIMUM_FIELD_ZONES}, default
   * {@link DEFOCUS_BOKEH_DEFAULT_FIELD_ZONES}); square zones, each with the kernel of its centre's field point.
   */
  fieldZonesAcrossLongSide?: number;
}
```

## DefocusBokehClippingAperture

One clipping aperture of the cat's eye, as `MechanicalVignettingAperture` of `calculateMechanicalVignetting`.

```ts
export interface DefocusBokehClippingAperture {
  /** Aperture radius referred to the entrance-pupil plane, mm. */
  radiusMm: number;
  /** Shift of its projected centre per unit tan(field angle), mm, toward the field point when positive. */
  shiftPerTanFieldMm: number;
}
```

## DefocusBokehKernel

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DefocusBokehKernel {
  /** "behind-focus" (subject farther than focus), "in-front-of-focus", or "in-focus" (no kernel). */
  side: "behind-focus" | "in-front-of-focus" | "in-focus";
  /** Thin-lens blur diameter c, µm and sites (`calculateDefocusCircle`, thin-lens model 1.1.0). */
  diameterMicrometers: number;
  diameterSites: number;
  /** Kernel radius R and window side 2R + 1 (0 and 1 in focus). */
  kernelRadiusSites: number;
  width: number;
  /** Row-major weights, index (j + R)·width + (i + R) for site offset (i right, j down) from the chief ray; null in focus. */
  weights: Float64Array | null;
  /** Open pupil area / unclipped opening area at the field point (the cat's eye's open fraction; 1 without one). */
  openAreaRatio: number;
  method: "exact-polygon-cell-area" | "pupil-ray-binning" | "none";
  /** Transverse spherical aberration of the marginal ray at the working f-number, sites (8·N·W040(N)/pitch). */
  sphericalAberrationSites: number;
  raySamples: number;
}
```

## DefocusBokehOptions

The bokeh options of `lens.defocus` (#553), each off when omitted; a lens catalogue entry can carry them as they are.

```ts
export interface DefocusBokehOptions {
  blades?: DefocusBokehBlades;
  sphericalAberration?: DefocusBokehSphericalAberration;
  catsEye?: DefocusBokehCatsEye;
}
```

## DefocusBokehSphericalAberration

Primary (Seidel) spherical aberration W = W040·ρ⁴, given at a reference f-number.

```ts
export interface DefocusBokehSphericalAberration {
  /** W040 in µm of optical path at the pupil edge of `atFNumber`; positive = undercorrected (marginal rays focus short). */
  w040Micrometers: number;
  /** The f-number at which `w040Micrometers` is given; the working value is W040·(atFNumber/N)⁴. */
  atFNumber: number;
}
```
