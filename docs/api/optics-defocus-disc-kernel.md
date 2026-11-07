# optics/defocus-disc-kernel.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDefocusDiscKernelRadius

Checks, before rendering, whether `lens.defocus: { model: "geometric-disc" }` can render a request: the geometric
defocus disc's diameter on the site lattice, the kernel radius it needs, and whether that radius is within
{@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES} (#532; 512 sites since 2.17.0, #564), and which convolution the renderers
would use. Pure and cheap: no kernel is built and nothing is rendered.

It runs the same resolution and the same limit test as `simulateCapture`, `simulateDisplayView` and `prepareDisplayView`
(the blur circle c = f²·|s − d| / (N·d·(s − f)) of `calculateDefocusCircle`, thin-lens model 1.1.0, divided by the pitch),
so for the same focal length, f-number, distances and pitch a request they refuse for its defocus size has
`withinLimit: false`, and one they accept has `withinLimit: true`. Pass the values the capture uses: in an automatic
exposure mode that is the resolved f-number. The limit applies to the disc alone; with `lens.diffraction` the diffraction
kernel (at most 32 sites) is applied with it and has no further limit. Other reasons a capture
refuses `lens.defocus` out of focus (pupil sampling, a caller PSF, camera rotation with a rolling shutter, a vignetting or
distortion profile that does not reach the kernel's radius beyond the frame, and in the display view a projection,
distortion, vignetting or rotation) are not checked here.

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

Largest kernel radius in sites of `lens.defocus: { model: "geometric-disc" }`, R ≤ 512 (#564, 2.17.0; 64 before): a disc of
at most 1025 sites across (6.15 mm at 6 µm). `simulateCapture`, `simulateDisplayView` and `prepareDisplayView` refuse a
request whose disc needs more, and never clip the disc; check a request first with {@link calculateDefocusDiscKernelRadius}.

Up to 64 sites the disc is convolved directly ((2R + 1)² taps per site,
byte-identical to 2.16.0). Above it the renderers use the exact run convolution (`site-kernel-runs.ts`: one prefix-sum
difference per kernel row plus the cells the circle crosses, about 12·R reads per site), whose cost grows with R instead of
R². 512 bounds that cost (6,145 reads per site, below the 16,641 taps of the direct gather at 64), the kernel's own
memory ((2R + 1)² doubles, 8.4 MB) and each tile's source ((64 + 2R)² doubles per field, 9.5 MB): measured in
docs/QUICK_START.md, "Optics".

```ts
DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES = 512
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
  /** {@link DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES}, 512 (64 before 2.17.0). */
  maximumKernelRadiusSites: number;
  /** Largest disc diameter in sites within the limit, 2·512 + 1 = 1025: within the limit exactly when `diameterSites` ≤ 1025. */
  maximumDiameterSites: number;
  /** True when `kernelRadiusSites` ≤ `maximumKernelRadiusSites`: `lens.defocus` renders the request; false: it refuses it. */
  withinLimit: boolean;
  /** How far past the limit the kernel radius is, max(0, R − 512) sites; 0 when within the limit. */
  excessKernelRadiusSites: number;
  /**
   * How the renderers convolve this disc (#564): `"direct"` for a kernel radius up to 64 sites (as in 2.16.0; also in focus),
   * `"runs"` above it (the exact run convolution, cost about proportional to R per site), null past the limit.
   */
  convolution: "direct" | "runs" | null;
}
```
