# optics/defocus-disc-kernel.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDefocusDiscKernelRadius

Checks, before rendering, whether `lens.defocus: { model: "geometric-disc" }` can render a request: the geometric
defocus disc's diameter on the site lattice, the kernel radius it needs, and whether that radius is within
{@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} (#532). Pure and cheap: no kernel is built and nothing is rendered.

It runs the same resolution and the same limit test as `simulateCapture`, `simulateDisplayView` and `prepareDisplayView`
(the blur circle c = f²·|s − d| / (N·d·(s − f)) of `calculateDefocusCircle`, thin-lens model 1.1.0, divided by the pitch),
so for the same focal length, f-number, distances and pitch a request they refuse for its defocus size has
`withinLimit: false`, and one they accept has `withinLimit: true`. Pass the values the capture uses: in an automatic
exposure mode that is the resolved f-number. The limit applies to the disc alone; with `lens.diffraction` the combined
kernel (diffraction radius plus defocus radius, at most 32 + 64 sites) has no further limit. Other reasons a capture
refuses `lens.defocus` out of focus (camera rotation, projection, distortion, vignetting, pupil sampling, a caller PSF)
are not checked here.

The blur circle is a geometric thin-lens approximation for an ideal uniform circular pupil (no diffraction, aberrations
or pupil vignetting). Inputs follow `calculateDefocusCircle`: all positive and finite, both distances beyond the focal
length; invalid values fail with `InvalidScientificInputError`, unknown fields with `InvalidConfigurationError`.

```ts
export function calculateDefocusDiscKernelRadius(input: CalculateDefocusDiscKernelRadiusInput): CalculationResult<DefocusDiscKernelRadius>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDefocusDiscKernelRadiusInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDefocusDiscKernelRadiusInput {
  /** Lens focal length in millimetres (`lens.focalLengthMm`). */
  focalLengthMm: number;
  /** F-number the capture uses: `lens.fNumber`, or in an automatic exposure mode the resolved `exposure.settings.fNumber`. */
  aperture: number;
  /** Focus-plane distance from the lens plane in metres (`lens.focusDistanceM`; `simulateCapture` defaults it to the subject distance). */
  focusDistanceM: number;
  /** Scene-plane distance from the lens plane in metres (`subjectDistanceM`). */
  subjectDistanceM: number;
  /** Sensor site pitch in micrometres (`sensor.pixelPitchMicrometers`), the lattice the disc is sampled on. */
  pixelPitchMicrometers: number;
}
```

## DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES

Largest kernel radius in sites of `lens.defocus: { model: "geometric-disc" }`, R ≤ 64: a disc of at most 129 sites
across (a 129 × 129 window, 16 641 taps per site; the diffraction kernels stop at 32). `simulateCapture`,
`simulateDisplayView` and `prepareDisplayView` refuse a request whose disc needs more, and never clip the disc; check a
request first with {@link calculateDefocusDiscKernelRadius}.

Set from the cost measured in the capture (#492, step 2a; docs/QUICK_START.md, "Optics"): the capture's time grows with
R² at every site the disc sees an edge from, and a 0.7 MP Siemens star took 0.37 s in focus, 2.9 s at R = 32, 4.7 s at
R = 41 and 11.6 s at R = 64 (Node, one thread). 64 keeps the issue's 1.4 µm example (50 mm f/2.8, subject 2 m, focus
1.6 m: R = 41) with room for larger blurs, at a cost the caller chooses and the docs state; past it the call fails.

```ts
DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES = 64
```

## DefocusDiscKernelRadius

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DefocusDiscKernelRadius {
  /** Geometric blur-circle diameter c at the sensor in micrometres (`calculateDefocusCircle`, thin-lens model 1.1.0); 0 in focus. */
  diameterMicrometers: number;
  /** c / pixel pitch: the disc's diameter in sites. */
  diameterSites: number;
  /** Kernel radius R in sites the renderer needs for this disc, ⌈c / (2·pitch) − ½⌉ (0 for a disc inside one site, and in focus). */
  kernelRadiusSites: number;
  /** {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}, 64. */
  maximumKernelRadiusSites: number;
  /** Largest disc diameter in sites within the limit, 2·64 + 1 = 129: within the limit exactly when `diameterSites` ≤ 129. */
  maximumDiameterSites: number;
  /** True when `kernelRadiusSites` ≤ `maximumKernelRadiusSites`: `lens.defocus` renders the request; false: it refuses it. */
  withinLimit: boolean;
  /** How far past the limit the kernel radius is, max(0, R − 64) sites; 0 when within the limit. */
  excessKernelRadiusSites: number;
}
```
