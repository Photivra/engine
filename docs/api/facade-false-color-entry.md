# facade/false-color-entry.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## SIMULATE_FALSE_COLOR_LIMITS

Limits of {@link SimulateFalseColorOptions}: at most 8 thresholds, differences in (0, 200].

```ts
SIMULATE_FALSE_COLOR_LIMITS: { readonly maximumThresholds: 8; readonly maximumDifference: 200 } = Object.freeze({ maximumThresholds: 8, maximumDifference: 200 })
```

## simulateFalseColor

#739: the false color a demosaic produces for a capture request: its color error per output pixel against a full-color sensor
reading of the same capture (each site's expected electrons with all three channel responses, through the same optics, filter,
pixel aperture and exposure), both noise-free and developed alike, in CIELAB a*b* (see {@link FalseColorResult}). It takes the
request `simulateCapture` takes, always at full quality (`fast: false`, on the CPU; `fast: true`, top-level or on an option record
such as `lens.diffraction`, is refused), and refuses what changes color after the
demosaic or has no expected-signal path (luminance tone curves, highlight reconstruction, `desaturate-to-luminance`,
`output.lensCorrections`, `output.sharpening`, `output.diffractionCorrection`, `output.region` (use `measure.region`), JPEG, PNG and
DNG output, `whiteBalance: "auto"`, `lens.pupilSampling`, a caller `lens.psf`, `lens.defocus.catsEye`, `sensor.fixedPatternNoise`,
layered chart scenes). Asynchronous; it yields to the host and honors `options.signal`. Its code loads on demand.

```ts
export async function simulateFalseColor(options: SimulateCaptureOptions, measure?: SimulateFalseColorOptions): Promise<FalseColorResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
