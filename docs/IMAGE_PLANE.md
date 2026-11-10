# Image-plane scene: a photo as a print

From 2.21 (#581) a capture's scene can be a photo: an sRGB or linear image printed flat, at a given size, on the scene plane in
front of the camera. The print is lit by the request's illuminant like a chart, so the camera's exposure, noise, diffraction,
defocus of the plane, distortion and vignetting all act on it. It works with `simulateCapture`, `simulateIdealReference`,
`simulateDisplayView` and `prepareDisplayView`, and the display view renders it on WebGPU ([On the GPU](#on-the-gpu)).
Call `await prepareImagePlaneScenes()` once first: it loads the scene's module ([Lazy loading and size](#lazy-loading-and-size)).

**An approximation, labeled as one.** The result is a photo *of a print of a photo*. The image was already processed, clipped
and blurred by the camera that took it. Its three numbers per pixel do not determine a spectrum, so the engine picks one smooth,
printable reflectance per color ([The print reflectance lattice](#the-print-reflectance-lattice)). Under CIE D65 that reflectance
gives back the pixel's sRGB. Under any other light its color is one plausible metamer of many ([Accuracy](#accuracy)). Every
result records this in its assumptions (`scene.imagePlane`).

```ts
import { prepareImagePlaneScenes, simulateCapture } from "@photivra/engine";

await prepareImagePlaneScenes(); // once, in the worker that captures
// An 8-bit sRGB image, for example a canvas's ImageData (RGBA).
const width = 4, height = 2, data = new Uint8ClampedArray(width * height * 4).fill(255);
data.set([200, 40, 30, 255, 40, 160, 60, 255], 0);
const capture = await simulateCapture({
  scene: { kind: "image-plane", sceneId: "my-photo", image: { width, height, channels: 4, encoding: "srgb-8", data } },
  chartSize: { widthM: 0.15 },          // a 15 cm wide print; its height follows the image (7.5 cm)
  subjectDistanceM: 0.5,
  illuminant: "cie-a",
  output: { width: 64, height: 48 }
});
console.log(capture.scene.preset, capture.scene.parameters.paperWhiteReflectance); // "image-plane", 0.9
```

## Input

| Field | Values | Notes |
| --- | --- | --- |
| `image.encoding` | `"srgb-8"`, `"srgb-16"`, `"linear-srgb"` | sRGB primaries and white (IEC 61966-2-1) in every encoding. `srgb-8` takes a `Uint8Array` or `Uint8ClampedArray` (a canvas's `ImageData.data`), `srgb-16` a `Uint16Array` (16-bit PNG samples), `linear-srgb` a `Float32Array`. |
| `image.channels` | 3 (RGB) or 4 (RGBA) | Rows from the top, `channels` samples per pixel; `data` holds exactly width × height × channels samples. EXIF orientation is the caller's: the engine prints the rows as given. |
| `image.width`, `image.height` | 1 to 65 536 | At most 24 000 000 pixels by default; `maximumPixels` raises the limit up to the full-resolution ceiling (134 217 728), as the other full-resolution stages do. |
| `paper` | `{ whiteReflectance?, blackReflectance? }` | The reflectance of sRGB white and black, 0 ≤ black < white ≤ 1. Defaults **0.90** and **0.01**: Photivra's assumptions, not measurements. 0.90 matches the white of the engine's Studio Gray 1 patch (0.901); 0.01 is an optical density of 2.0. Recorded as `scene.paper.*` default assumptions. |
| `interpolation` | `"bilinear"` (default), `"nearest"` | Between pixel centers; see [Placement and reconstruction](#placement-and-reconstruction). |

- **Decoding.** `srgb-8` and `srgb-16` go through the sRGB transfer function (the piecewise EOTF of IEC 61966-2-1), evaluated with the
  engine's portable power, so the same bits come out in every JavaScript engine. `linear-srgb` is taken as given. Samples outside
  [0, 1] are clipped to the print's range, because a print cannot be brighter than its paper or darker than its deepest ink.
  The clipped samples are counted in `scene.parameters.clippedSampleCount` and in the assumption `scene.image.clippedSamples`. A
  non-finite sample is refused.
- **Alpha** is linear coverage over the paper. A pixel with alpha a prints as a·c + (1 − a) in linear sRGB, so a transparent pixel is
  bare paper.
- **Display P3 and other gamuts** are not taken yet. A browser that draws a P3 photo into a default (sRGB) canvas converts it, so
  canvas `ImageData` is sRGB.
- The data is read on every lookup and never written or copied. Change it only after the call (or the prepared view) is done.
- The scene digest (`scene.sourceSha256`) covers the image's SHA-256, its size, channels and encoding, the paper, the
  interpolation, the lattice version and the framing.

## Placement and reconstruction

The print is a flat matte Lambertian plane perpendicular to the optical axis at `subjectDistanceM`, centered on the axis. It has no
gloss, paper texture, halftone, curl or fluorescence.

- **With `chartSize`** the print is `widthM` wide. `heightM` defaults to widthM × image height / image width, so the print has the
  image's shape. Outside the print the plane is the surround (`surroundReflectance`, default 18 % gray).
- **Without `chartSize`** the print has the image's shape and is fitted inside the frame, centered. It fills the frame's width or
  height, on the 18 % surround. This is recorded as the `chartSize` default assumption.
- **Pixels.** In the print's own coordinates (cu = ±1 at its left and right edges, cv up, ±aspect at its top and bottom) a point
  is at pixel coordinates X = (cu + 1)·W/2, Y = (aspect − cv)·H/(2·aspect). Pixel centers lie at half-integers.
- **`bilinear`** weights the four nearest pixels' **reflectance spectra** bilinearly, with the edge pixels extending to the print's
  edges. Under D65 this is exactly the bilinear interpolation of their linear sRGB, because XYZ is linear in the spectrum.
  **`nearest`** takes the pixel under the point.
- The camera's own sampling then applies (`sensor.pixelAperture`, `sensor.antiAliasing`): a print finer than the sensor's pixels
  aliases as a real print would, unless the pixel aperture averages it.

## The print reflectance lattice

Each pixel's color becomes a reflectance spectrum through a lattice of 5 × 5 × 5 spectra (owner decision, 2026-11-09):

1. **Nodes.** Per channel, the nodes sit at the sRGB code values 0, ¼, ½, ¾ and 1: uniform in encoded sRGB, so denser in the shadows.
   Their linear values are 0, 0.0508, 0.2140, 0.5225 and 1.
2. **The neutral axis** (r = g = b, black and white included) is flat: the node's linear value at every wavelength. These spectra are
   computed, not stored.
3. **The other 120 nodes** hold Photivra's own fit of the **LHTSS** method, the least hyperbolic tangent slope squared method of S. A.
   Burns, "Generating Reflectance Curves from sRGB Triplets", arXiv:1710.05732 v5 (2020), section "Least Hyperbolic Tangent Slope
   Squared (LHTSS) Method", pp. 24–26. It is the smoothest reflectance that is strictly inside (0, 1) and gives the node's sRGB:
   ρ = (tanh z + 1)/2, minimize Σ (zᵢ₊₁ − zᵢ)² subject to T ρ = rgb, solved by Newton's method on the Lagrangian's stationary
   conditions.
   - T maps the spectrum to linear sRGB under CIE D65 with the CIE 1931 2° observer. The D65 table's white is scaled to the sRGB white,
     and the result is converted with the CSS Color 4 matrix.
   - The paper samples 380–730 nm at 10 nm. This fit samples **380–780 nm at 10 nm** (41 values, the engine's facade range), and the
     spectrum is linear between samples.
   - The method is implemented from the paper's equations only. The paper's MATLAB code is CC BY-SA 4.0 and is not used.
   - At the nodes with a channel at 0 or 1, which the open interval cannot reach, the target is clamped to [10⁻⁴, 1 − 10⁻⁴]. Two
     least-norm corrections then make the node exact, one on the samples and one on the 16-bit codes.
4. **A pixel's spectrum** is the trilinear interpolation, in linear sRGB, of the spectra of the eight nodes of its cell. That is a
   convex combination of spectra in [0, 1], so it stays in [0, 1]. Because XYZ is linear in the spectrum and trilinear interpolation
   reproduces a linear function, the interpolated spectrum reproduces the pixel's sRGB under D65 to the nodes' own residual.
5. **The paper:** ρ = ρ_black + (ρ_white − ρ_black)·ρ_lattice. This is affine in RGB, so it is still exact (relative to the paper) and
   bounded.

The fit is `scripts/fit-image-plane-lattice.mjs`.
- It downloads the CIE D65 and CIE 1931 2° tables (CC BY-SA 4.0) to a temporary directory outside the repository, checks their
  SHA-256, uses them and deletes them, as the CMF fit and the color-patch references do (THIRD_PARTY.md).
- It writes `src/facade/image-plane-lattice-data.ts`: 120 × 41 16-bit codes, delta-coded along wavelength. These are Photivra's fitted
  spectra, not CIE values.
- Run it without arguments to refit and compare with the committed data, or with `--write` to replace it.

**Why this method** (from the #581 proposal, which surveyed five methods with free sources):

- **A linear fit is not printable.** The smoothest linear least-squares upsampling leaves [0, 1] for 44 % of the sRGB colors.
- **Three fixed basis spectra are coarser.** The three-basis spectral primary decomposition (Mallett & Yuksel, EGSR 2019, DOI
  10.2312/sr.20191216) is exact and bounded, but its spectra are block-like, about twice the lattice's error under other lights on
  smooth spectra.
- **Per-pixel methods would need a `fast` flag.** Per-pixel non-linear models (Burns' LHTSS itself; the sigmoid-of-a-quadratic of
  Jakob & Hanika, Computer Graphics Forum 38(2), 2019, DOI 10.1111/cgf.13626) need a spectral integral per pixel, or an approximating
  table and so a `fast` flag.
- **The lattice is exactly tabulatable.** It keeps LHTSS's smooth spectra and stays piecewise linear in RGB. A capture integrates
  each of the 125 node spectra once per channel, and each pixel is a weighted sum of those integrals, the same quantities summed in
  another order. So it needs no `fast` option and adds nothing to `SIMULATE_CAPTURE_FAST_OPTIONS`.
- **Sources read.** I read the Burns paper (arXiv v5, CC BY-SA 4.0). I could not open the full PDFs of Mallett & Yuksel (the digital
  library refused the request) or Jakob & Hanika (above the fetch size limit). Their claims here come from the authors' project
  pages and are not used by the method.

**Patents.** A basic free search on 2026-11-09 (Google Patents and web search, with the terms reflectance curve sRGB hyperbolic
tangent, spectral upsampling RGB reflectance lookup table trilinear interpolation, and converting RGB to reflectance spectrum
smoothest spectrum lattice) found no patent on smoothest-reflectance reconstruction from RGB or on interpolating precomputed
spectra in an RGB lattice. The nearest hit, US 7,835,032 B2 (Canon, priority 2006, listed "Expired - Fee Related"), computes
colorant amounts for a printer's color-separation table from measured reflectances, which is a different task. This is not a
freedom-to-operate opinion.

## Accuracy

- **Round trip under D65** (the fit's own check, CIE tables, the stored 16-bit lattice): CIEDE2000 at most 6.4·10⁻⁴, mean 3.9·10⁻⁵,
  over a 17³ grid of sRGB code values. No spectrum leaves [0, 1]. The largest node residual is 1.0·10⁻⁶ in linear sRGB.
- **In the engine** the colorimetry adds its own known residuals: the engine's analytic CIE 1931 fit (docs/COLORIMETRY.md; ΔE00 up to
  about 0.3 for the color patches) and the spectral quadrature (20 nm by default). D65 is not bundled. Under the default 6500 K
  Planckian light, white-balanced to it, the ideal reference of twelve color blocks reproduces their sRGB within ΔE00 1.18 at 5 nm
  (`test/image-plane.test.ts`). That figure includes the difference between a 6504 K Planckian and D65. Pass the CIE D65 table as a
  caller illuminant for D65 itself.
- **Under other lights** the colors are a metamer. Measured for the #581 proposal on smooth synthetic test spectra, because no
  measured reflectance database is free to use: the 30 color patches and 1 000 seeded random spectra. The test spectra were
  converted to sRGB, printed through the lattice and compared with the true spectra under each light, in CIEDE2000.
  - The proposal's set-up was the analytic CMF fit with a 6504 K Planckian standing in for D65.
  - The truth sets are smooth, which favors smooth methods.

  | Light | Color patches mean / max | Random spectra mean / p95 / max |
  | --- | --- | --- |
  | Planckian 2856 K (like CIE A) | 0.73 / 2.29 | 1.49 / 3.89 / 8.59 |
  | Planckian 4000 K | 0.40 / 1.54 | 0.78 / 2.15 / 4.78 |
  | Planckian 10 000 K | 0.25 / 1.08 | 0.44 / 1.25 / 2.72 |
  | A synthetic three-line lamp (narrow lines at 436, 546 and 611 nm) | 1.22 / 3.50 | 1.93 / 5.93 / 17.4 |

  Under a narrow-line lamp every method spreads this widely: three numbers do not fix a spectrum. With the default colorimetric
  sensor and a D65 light every exact method gives the same image; the choice shows under other lights and with non-colorimetric
  sensor responses.

## On the GPU

`prepareDisplayView(request, { gpu: "auto" | "require" })` renders a photo on WebGPU in the display view's **Speed** path, the
exact area mean without diffraction, `lens.defocus` or AHD. It uses the image-plane module (`src/gpu/display-view-image-material-module.ts`;
[WebGPU, Display view (Speed)](WEBGPU.md#display-view-speed-on-the-gpu)):

- **Host side.** The host computes every pixel's three channel signals in float64 and uploads them once as float32 (12 bytes per
  pixel, refused with `insufficient-limits` above the device's storage binding limit).
- **The point.** The module recovers the exact query point in double-float32, as the composite chart module does. It forms the
  pixel coordinates and the bilinear weights with only relative error, and flags the points it cannot decide (the print's edge, a
  weight moved next to a much brighter pixel, a nearest-pixel edge). The host recomputes a flagged display pixel with the
  reference.
- **The bound.** The kernel's a-priori bound grows by the module's ten roundings: γ₇₄ instead of γ₆₄ on the expected value, doubled.
- **The Quality path.** A request that needs the Quality passes (diffraction, defocus, AHD) runs on the CPU reference, labeled
  `unsupported-on-backend`. The Quality passes for photos are a later part.
- **Self-check.** The module checks itself on a device's first photo (`runImagePlaneConformance`: a 12 × 8 photo on a 38 × 26
  frame against the CPU reference within the bounds). A device that fails it renders photos on the CPU, labeled
  `unsupported-on-backend`. The renderer's own self-check cases are unchanged, so charts never wait for a photo check.

Measured agreement with the CPU reference, per display pixel, 600 × 400 frame of 6 µm sites, 2 × 2 box, 203 × 135 view (82 215
components), float32 emulation (`test/display-view-image-gpu.test.ts`). SwiftShader (Chromium headless, `test/webgpu/display-view.webgpu.ts`)
passes the same cases within the same bounds. Every component lies inside its bound and every sample within one code:

| Case | ΔE2000 max | σ units max | Bound used (mean / variance) | Samples differing | Flagged, recomputed |
| --- | --- | --- | --- | --- | --- |
| 160 × 120 sRGB photo, 42 mm print at 0.63 m, bilinear | 2.2e-5 | 4.4e-5 | 3.4 % / 2.6 % | 0 | 0 |
| The same, fitted inside the frame | 4.2e-5 | 8.6e-5 | 6.1 % / 3.0 % | 1 | 0 |
| The same, nearest pixel | 2.0e-5 | 3.1e-5 | 1.8 % / 2.6 % | 0 | 315 (1.1 %) |
| 600 × 400 photo, bilinear | 2.0e-5 | 4.7e-5 | 4.2 % / 2.6 % | 0 | 0 |
| Linear RGBA with half-transparent pixels, custom paper | 2.0e-5 | 4.2e-5 | 2.6 % / 2.6 % | 0 | 0 |
| Reinhard at the white clip | 3.7e-5 | 2.8e-4 | 3.1 % / 2.7 % | 0 | 0 |

Timing on a hardware adapter is not measured yet.

## Lazy loading and size

The scene's module, its lattice data (9.5 KB gzip as source) and its GPU module are reachable only through `prepareImagePlaneScenes()`.
That function is in a module of its own and loads them with a dynamic import: a lazy chunk of 13,633 B gzip, plus the GPU
module's own chunk of 3,523 B when a display view renders a photo on WebGPU (measured with the worker shape below plus the function:
17,597 B more in total, the rest being shared code that moves into the entry).
- **Without it.** A bundle that never imports the function carries none of these bytes, not even as a lazy chunk. A request with an
  image-plane scene then fails with a message that names the function.
- **Measured on the app's capture-worker shape** (`test/capture-bundle.test.ts`: `NATIVE_RAW_LIMITS`, `prepareDisplayView`,
  `serializeSimulatedCaptureDngFromParts`, `simulateCapture`, `simulateIdealReference`; every chunk counted): 351,979 B gzip, +204 B
  over 2.19.0, within the unchanged 352,000 B limit.
- **An application that enables photos adds that lazy chunk** to its total JavaScript.

`createPlanarSceneRadianceProvider` is synchronous and does not take the scene; it says so.
