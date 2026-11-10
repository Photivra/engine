# facade/scene-radiance.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CALLER_MATERIAL_SCENE_MAX_MATERIALS

Most materials a {@link CallerMaterialScene} may list.

```ts
CALLER_MATERIAL_SCENE_MAX_MATERIALS = 65_536
```

## CallerMaterialScene

2.7 (#386): a piecewise-constant caller scene, lit by the facade illuminant like a reflectance function. `materials` are
reflectances as a chart's patches take them (a neutral number in [0, 1] or a reflectance spectrum covering 380–780 nm, at
most {@link CALLER_MATERIAL_SCENE_MAX_MATERIALS}); `materialAt` returns the index of the material at a plane point (an
integer from 0 to materials.length − 1). The radiance at a point is that material's, exactly as for a reflectance function
returning its reflectance, but renderers can tabulate each material once: the display view then takes the chart path.

```ts
export interface CallerMaterialScene {
  kind: "material-function";
  sceneId: string;
  materials: readonly ChartReflectance[];
  materialAt(point: Readonly<SceneMaterialPoint>): number;
}
```

## CallerRadianceScene

Caller absolute spectral radiance in W·m⁻²·sr⁻¹·nm⁻¹; the facade illuminant is not used.

```ts
export interface CallerRadianceScene { kind: "radiance-function"; sceneId: string; evaluate(point: Readonly<ScenePlanePoint>): number }
```

## CallerReflectanceScene

Caller Lambertian reflectance (in [0, 1]) lit by the facade illuminant.

```ts
export interface CallerReflectanceScene { kind: "reflectance-function"; sceneId: string; evaluate(point: Readonly<ScenePlanePoint>): number }
```

## CaptureIlluminant

Illuminant choices. CIE D65 is not bundled: its S0/S1/S2 basis tables must come from the caller
(`daylight`). `planckian` is Planck's law; `cie-a` is CIE illuminant A from its defining formula.

```ts
export type CaptureIlluminant =
  | "cie-a"
  | { kind: "planckian"; temperatureKelvin: number }
  | { kind: "cie-a" }
  | { kind: "daylight"; correlatedColorTemperatureKelvin: number; basis: CieDaylightBasis }
  | { kind: "spectrum"; spectrum: ColorimetricSpectrum; label?: string };
```

## CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE

Default surround of a fixed-size chart: an 18 % grey plane.

```ts
CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE = 0.18
```

## ChartSizeOption

2.3: a chart's physical size on the scene plane (`simulateCapture` `chartSize`, `createPlanarSceneRadianceProvider` `chartSize`).

```ts
export interface ChartSizeOption {
  /** Chart width in metres, (0, 10 000]. */
  widthM: number;
  /** Chart height in metres. Default: widthM × the frame aspect (height / width), so the chart has the frame's shape. */
  heightM?: number;
  /** Neutral reflectance of the plane around the chart, lit by the same illuminant. Default 0.18. */
  surroundReflectance?: number;
}
```

## createPlanarSceneRadianceProvider

Public scene-preset provider. Places an engine chart (or a declared `material-layers` scene, #491, evaluated as
its `callerScene`; or a caller reflectance, radiance or material function) on
a plane `distanceM` in front of the camera and `framedWidthM` wide (frame units u = ±1 at its edges),
lit by `illuminant` at `illuminanceLux`. The returned `evaluateRadiance` and `evaluateApertureRadiance`
follow the native environment RAW provider contract. They answer requests for scene `sceneId` and
provider `providerProfileId`.

```ts
export function createPlanarSceneRadianceProvider(input: {
  /** An `image-plane` scene (#581) is refused: it is taken by the facade's capture and display-view functions, which load its module. */
  scene: ChartScene | ChartMaterialLayerScene | CallerReflectanceScene | CallerRadianceScene | CallerMaterialScene | ImagePlaneScene;
  illuminant: CaptureIlluminant;
  illuminanceLux: number;
  distanceM: number;
  framedWidthM: number;
  /** Frame height / width. */
  aspect: number;
  sceneId: string;
  providerProfileId: string;
  /**
   * 2.3, opt-in: place the chart at this physical size, centred, instead of filling the frame; the chart preset
   * is resolved with aspect heightM / widthM and the rest of the plane is the surround.
   */
  chartSize?: ChartSizeOption;
}): PlanarSceneRadianceProvider & { chart: ResolvedChartScene | null };
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ImagePlaneImage

2.21 (#581): an image the caller supplies, for an {@link ImagePlaneScene}. `data` holds `width × height` pixels row by row
from the top, `channels` (3: RGB, 4: RGBA) samples each, in the encoding's type: `srgb-8` Uint8Array or Uint8ClampedArray
(canvas `ImageData.data`), `srgb-16` Uint16Array, `linear-srgb` Float32Array. sRGB primaries and white (IEC 61966-2-1) in
every encoding; `srgb-8` and `srgb-16` are decoded with the sRGB transfer function, `linear-srgb` is already linear and is
clipped to [0, 1] (the clipped samples are counted). Alpha is linear coverage over the paper. The array is read, never
changed or kept beyond the call.

```ts
export interface ImagePlaneImage {
  width: number;
  height: number;
  channels: 3 | 4;
  encoding: "srgb-8" | "srgb-16" | "linear-srgb";
  data: Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array;
}
```

## ImagePlaneScene

2.21 (#581): a photo as a flat matte print on the scene plane, lit by the request's illuminant like a chart. Each pixel's
color becomes a reflectance spectrum through the engine's print reflectance lattice (docs/IMAGE_PLANE.md): an
approximation, a print of an image that was already processed, clipped and blurred by the camera that took it. The print's
physical size is `chartSize` (its height defaults to the image's aspect); without it the print is fitted inside the frame,
centered, on the 18 % surround.

```ts
export interface ImagePlaneScene {
  kind: "image-plane";
  sceneId: string;
  image: ImagePlaneImage;
  /** The paper and the deepest ink: reflectances of sRGB white and black, 0 ≤ black < white ≤ 1. Defaults 0.90 and 0.01. */
  paper?: { whiteReflectance?: number; blackReflectance?: number };
  /** How the print is reconstructed between pixel centers. Default `bilinear` (the pixels' spectra, bilinearly weighted). */
  interpolation?: "bilinear" | "nearest";
  /** Opt-in raised pixel limit: an integer up to the full-resolution ceiling. Default 24 000 000 pixels. */
  maximumPixels?: number;
}
```

## PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W

CIE maximum luminous efficacy for photopic vision, lm/W.

```ts
PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W = 683
```

## PlanarSceneRadianceProvider

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PlanarSceneRadianceProvider {
  sceneId: string;
  providerProfileId: string;
  evaluateRadiance(request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult;
  evaluateApertureRadiance(request: Readonly<SceneRadianceEvaluationRequest>, ray: Readonly<SensorApertureRay>): SceneRadianceEvaluationResult;
  /**
   * Spectral radiance at a plane point (frame units), the same value the callbacks return. #551: a moving subject's provider
   * reads it at time `t` (seconds from the first opening, default 0); a still scene ignores it.
   */
  radianceAt(u: number, v: number, wavelengthNanometers: number, t?: number): number;
  /**
   * 2.3, chart scenes only: the chart material at a plane point (frame units), or `materials.length` for the
   * surround of a fixed-size chart; `materialRadiance` gives that material's spectral radiance, the same value
   * `radianceAt` returns at its points.
   */
  chartMaterialAt?(u: number, v: number): number;
  materialRadiance?(material: number, wavelengthNanometers: number): number;
  /**
   * 2.21 (#581), image-plane scenes only: the tabulated expected signal's scene at these spectral nodes and channel responses, its
   * radiance per node and, for the direct path, Σ_n A_c(λ_n)·L(λ_n) integrated from each pixel's reconstructed spectrum
   * (`ResolvedImagePlaneScene.pixelSignals`, the surround's reflectance times the neutral signal outside the print).
   */
  imageSignalScene?(wavelengths: readonly number[], perNode: readonly Float64Array[]): ImagePlaneSignalScene;
}
```

## resolveCaptureIlluminant

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export function resolveCaptureIlluminant(value: CaptureIlluminant): ResolvedCaptureIlluminant;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvedCaptureIlluminant

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedCaptureIlluminant {
  /** Short public description, for example "planckian-6500K". */
  id: string;
  description: string;
  /** Relative spectral shape (arbitrary scale) over at least 380-780 nm. */
  shape: PreparedColorimetricSpectrum;
  /** Original spectrum, for colorimetric white-balance calculations. */
  spectrum: ColorimetricSpectrum;
}
```

## SceneMaterialPoint

2.7: a scene-plane point without a wavelength, passed to a material scene's `materialAt`.

```ts
export type SceneMaterialPoint = Omit<ScenePlanePoint, "wavelengthNanometers">;
```

## ScenePlanePoint

A point of the scene plane passed to caller scene functions: a new object for every call, which the engine does not read
after the call (not frozen: freezing cost about 40 % of a chart lookup).

```ts
export interface ScenePlanePoint {
  /** Metres on the plane, from the optical axis: +x right, +y up (as seen from the camera). */
  xM: number;
  yM: number;
  /** The same point in frame units (u = ±1 at the left/right frame edges, v up on the same scale). */
  u: number;
  v: number;
  wavelengthNanometers: number;
  /**
   * 2.3, only with a fixed-size chart (`chartSize`): the point in chart-local frame units (±1 at the chart's
   * left/right edges, v up on the same scale, ±chart height/width at its top/bottom). The function is then
   * called only for points on the chart; the surround is the placement's surround reflectance.
   */
  chartU?: number;
  chartV?: number;
}
```
