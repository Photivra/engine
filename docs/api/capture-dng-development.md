# capture/dng-development.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## developDngImage

Full color development of an imported DNG (see the module comment).

```ts
export async function developDngImage(raw: ImportedDngRaw, options: DevelopDngImageOptions = {}): Promise<DevelopedDngImage>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## DevelopDngImageOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DevelopDngImageOptions {
  /** Default "as-shot" (AsShotNeutral, else AsShotWhiteXY, else D65 with an assumption). */
  whiteBalance?: DevelopDngImageWhiteBalance;
  /** Brightened (positive) or darkened in editing, stops (−10 to +10, default 0): the signal and its noise scale alike. */
  exposurePushStops?: number;
  /** Apply BaselineExposure (default true), as the DNG specification asks a renderer to. */
  baselineExposure?: boolean;
  /** The SDR tone curve (default "identity", as `simulateCapture`), with its parameters for the luminance curves. */
  toneCurve?: SdrToneCurve;
  toneCurveParameters?: SdrToneCurveParameters;
  /** Default "clip-components". */
  gamutHandling?: SdrRenderingProfile["gamutHandling"];
  /** "srgb-8" (default) or "srgb-16". */
  format?: "srgb-8" | "srgb-16";
  /**
   * Speed versus accuracy (registry entry `developDngImage/demosaic`): true uses the bilinear demosaic and bilinear WarpRectilinear,
   * false AHD and cubic convolution. Default from `format` (fast for the on-screen sRGB formats, as everywhere in the engine).
   */
  fast?: boolean;
  /** Apply the opcode lists (default true). */
  opcodes?: boolean;
  /** "default" (DefaultCrop, default) or "active-area". */
  crop?: "default" | "active-area";
  /** Apply the Orientation tag (default true). */
  orientation?: boolean;
}
```

## DevelopDngImageWhiteBalance

The white balance of a development: the file's as-shot white, a correlated color temperature, a chromaticity or a camera neutral.

```ts
export type DevelopDngImageWhiteBalance =
  | "as-shot"
  | { kelvin: number; duv?: number; whiteLocus?: WhiteLocus }
  | { chromaticity: CieXyChromaticity }
  | { cameraNeutral: readonly [number, number, number] };
```

## DevelopedDngImage

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DevelopedDngImage {
  width: number;
  height: number;
  format: "srgb-8" | "srgb-16";
  /** Interleaved sRGB-encoded RGB, row-major. */
  samples: Uint8Array | Uint16Array;
  whiteBalance: {
    source: "as-shot-neutral" | "as-shot-white-xy" | "default-d65" | "kelvin" | "chromaticity" | "camera-neutral";
    /** The camera neutral (max component 1) and the white's chromaticity, with its CCT where one is defined. */
    cameraNeutral: [number, number, number];
    chromaticity: CieXyChromaticity;
    correlatedColorTemperatureKelvin: number | null;
  };
  /** White-balanced reference-camera RGB → XYZ D50 (row-major 3 × 3); the white maps to Y = 1. */
  cameraToXyzD50: number[];
  exposure: { baselineExposureStops: number; pushStops: number; label: string | null };
  demosaic: "bilinear" | "ahd" | "none";
  fast: { requested: boolean; defaultedFrom: "request" | "format" };
  /** Pixels with a white-balanced channel clipped at 1, and output components clipped by the gamut handling. */
  clippedPixelCount: number;
  assumptions: string[];
}
```
