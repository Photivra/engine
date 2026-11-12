# output/sdr-rendering.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSdrRendering

Standalone SDR rendering: rendering exposure → tone → gamut → sRGB transfer → quantization.
No physical capture, metering, white balance, colour conversion, lens correction or display
adaptation runs.

```ts
export function calculateSdrRendering(input: SdrRenderingInput): CalculationResult<SdrRenderingResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSdrRenderingInput

Validates the declared image state and a bounded, finite, inline image. It never applies white balance or colour conversion.

```ts
export function parseSdrRenderingInput(value: unknown): SdrRenderingInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseSdrRenderingProfile

Validates a rendering and encoding profile. Unknown HDR or display modes are rejected.

```ts
export function parseSdrRenderingProfile(value: unknown): SdrRenderingProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## SDR_RENDERING_MODEL_VERSION

Version of the `generic-sdr-rendering-reference` model. 0.2.0 added luminance tone curves and fixed
round-to-nearest, ties up (`Math.round`; the old `Math.floor(x+.5)` rounded 0.49999999999999994 up).

```ts
SDR_RENDERING_MODEL_VERSION = "0.2.0" as const
```

## SDR_RENDERING_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
SDR_RENDERING_SCHEMA_VERSION = "0.1.0" as const
```

## SdrRenderingInput

Only linear-sRGB/D65 data that has been explicitly colour-transformed, with all three channels at each pixel, is accepted.

```ts
export interface SdrRenderingInput {
  sourceImageStateId: string;
  inputImageState: "color-transformed-linear-rgb";
  inputColorSpace: "linear-srgb-d65";
  whiteBalanceHandling: "already-applied-upstream" | "not-required";
  pixelWidth: number;
  pixelHeight: number;
  referenceWhiteValue: number;
  /** Relative linear RGB, row-major tightly interleaved red/green/blue. */
  samples: readonly number[];
  profile: SdrRenderingProfile;
}
```

## SdrRenderingProfile

Rendering choices made by the engine user. They are independent of physical exposure and display calibration.

```ts
export interface SdrRenderingProfile {
  schemaVersion: typeof SDR_RENDERING_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  renderingExposureEv: number;
  toneCurve: SdrToneCurve;
  /** Present exactly for `extended-reinhard-luminance` ({whiteLuminance}) and `naka-rushton-luminance`. */
  toneCurveParameters?: SdrToneCurveParameters;
  /**
   * After the tone curve: clip each component to [0, 1], reject an out-of-range pixel, or (#601, 2.22.0) desaturate a pixel whose
   * largest component exceeds 1 toward the gray of its own luminance until that component is 1 (`desaturateToLuminance`), then
   * clip what remains below 0.
   */
  gamutHandling: "clip-components" | "reject-out-of-range" | "desaturate-to-luminance";
  outputDynamicRange: "sdr";
  transferFunction: "srgb";
  bitDepth: 8 | 16;
  rounding: "nearest-ties-up";
  dither: "none";
}
```

## SdrRenderingResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SdrRenderingResult {
  schemaVersion: typeof SDR_RENDERING_SCHEMA_VERSION;
  sourceImageStateId: string;
  profile: SdrRenderingProfile;
  pixelWidth: number;
  pixelHeight: number;
  channelOrder: readonly ["red", "green", "blue"];
  whiteBalanceHandling: SdrRenderingInput["whiteBalanceHandling"];
  /** Relative normalized linear samples after exposure/tone, before gamut handling. */
  toneMappedLinearSamples: readonly number[];
  outputLinearSamples: readonly number[];
  outputEncodedSamples: readonly number[];
  integerSamples: readonly number[];
  outputEncoding: {
    imageState: "output-referred-sdr";
    colorSpace: "srgb";
    primariesXy: { red: readonly [number, number]; green: readonly [number, number]; blue: readonly [number, number] };
    whitePointXy: readonly [number, number];
    referenceWhiteLuminanceCdM2: 80;
    codeMinimum: 0;
    codeMaximum: number;
  };
  diagnostics: {
    renderingNegativeSampleCount: number;
    renderingAboveReferenceSampleCount: number;
    toneChangedSampleCount: number;
    gamutClippedLowSampleCount: number;
    gamutClippedHighSampleCount: number;
    /**
     * `not-consumed`: no upstream saturation data (full well, ADC or RAW) is available, and it is never
     * guessed from the output.
     * `consumed-in-raw-development`: RAW development already clipped or reconstructed flagged and
     * white-level samples before white balance (see its highlight diagnostics).
     */
    captureSaturation: "not-consumed" | "consumed-in-raw-development";
  };
  /** Describes the encoded output for the platform's colour management. No real display is assessed. */
  displayAdaptation: { kind: "external-platform"; applied: false; displayCapabilities: "unknown" };
}
```

## SdrToneCurve

Tone curves. A per-channel curve acts on each exposed component separately. A luminance curve
scales all three components of a pixel by f(L)/L, where L is the linear-sRGB/D65 relative
luminance, so the colour (chromaticity) is kept before gamut handling.
- `identity`: f(x)=x.
- `positive-reinhard-per-channel`: f(x)=x/(1+x) for x>0 (Reinhard et al. 2002, eq. 3), per channel.
- `extended-reinhard-luminance`: f(L)=L(1+L/Lw²)/(1+L) (Reinhard et al. 2002, eq. 4); L=Lw maps to 1.
- `naka-rushton-luminance`: f(L)=g(L)/g(Lw), g(L)=Lⁿ/(Lⁿ+σⁿ) (Naka & Rushton 1966; Reinhard & Devlin
  2005): a sigmoid in log luminance with contrast n and mid-response σ, i.e. a film-like S-curve.

```ts
export type SdrToneCurve = "identity" | "positive-reinhard-per-channel" | "extended-reinhard-luminance" | "naka-rushton-luminance";
```

## SdrToneCurveParameters

Required only by luminance curves; all values are relative linear luminance after rendering exposure.

```ts
export type SdrToneCurveParameters =
  | { whiteLuminance: number }
  | { exponent: number; semiSaturation: number; whiteLuminance: number };
```
