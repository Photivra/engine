# WebGPU image-kernel backend (`webgpu-f32`)

Status: **2.0.0 development, optional and opt-in.**

- The float64 CPU paths stay the engine reference, and the default.
- The `webgpu-f32` backend is a separate, explicitly labelled float32 approximation of six stages: chart scene radiance and its spectral integration, isoplanatic PSF convolution (with kernels sampled from the engine's lens PSF profiles), the temporal exposure sum (exposure and motion), the sensor stage (seeded charge, fixed-pattern noise, extra charge, read noise and ADC), native capture SDR and packed RAW development (all four tone curves).
- Its results carry an error bound against the reference, worked out in advance (a priori); the luminance tone curves report a running bound, a fixed formula evaluated during the run. The [accuracy contract](#accuracy-contract) states each stage's bound and how the bounds compose. A conformance suite on a real WebGPU device tests them on fixed test images.
- The [per-fixture rollout](#per-fixture-rollout-method-error) measures the image-formation method's error against the per-site engine for every built-in chart preset.

It is the GPU image-formation path proposed in [#277](https://github.com/Photivra/photivra/issues/277) for the engine's chart scenes. **One hardware device has been run** (Apple M5 Pro, Metal). Its first conformance run (Chrome 155, [#471](https://github.com/Photivra/photivra/issues/471)) passed 82 of 89 tests; the 7 failures (sensor stage with non-unit gains, one Siemens-star boundary point) led to the arithmetic assumptions and margins below. The re-runs on that device after those changes and the composite rounding barrier (#507) passed 167 of 167 tests and 26 of 26 preview acceptance cases, at the 2.11.0 release gate on `main` at 78f2731 (October 28, 2026, [#509](https://github.com/Photivra/photivra/pull/509)). Other devices (a 4-core integrated-GPU laptop, a phone) are open in [#475](https://github.com/Photivra/photivra/issues/475). Every hardware run, timings and conformance alike, is recorded in the [hardware record](WEBGPU_DEVICES.md). The development container has no GPU (see [Running on hardware](#running-on-hardware)).

## Contract

```ts
import { createImageKernelAccelerator, type IrradianceConvolutionInput } from "@photivra/engine";

const width = 64, height = 48, kernelRadius = 2, size = 2 * kernelRadius + 1;
const input: IrradianceConvolutionInput = {
  schemaVersion: "0.1.0", width, height, kernelRadius, patchWidth: 32, patchHeight: 24, boundary: "zero-outside-grid",
  samples: new Float64Array(width * height).fill(1),
  // One normalized box kernel per patch (2 × 2 patches).
  kernels: new Float64Array(4 * size * size).fill(1 / (size * size))
};

// The caller opts in and chooses the fallback explicitly; nothing is substituted silently.
const accelerator = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "cpu-reference" });
const result = await accelerator.convolveIrradiance(input);
console.log(result.execution.backend, result.execution.fallbackReason); // "cpu-reference" "webgpu-unavailable" in Node
console.log(result.execution.errorBound); // null for the reference; a bound for webgpu-f32
console.log(result.inputSum - result.outputSum); // quantity scattered outside the grid
accelerator.dispose();
```

- **Operations:** `evaluateChartRadiance`, `convolveIrradiance`, `sumTemporalExposure`, `simulateSensorRaw`, `renderNativeCaptureSdr` and `developNativeRaw`. Their float64 references are `calculateChartRadianceBatch`, `calculateIrradianceConvolution`, `calculateTemporalExposureSum`, `simulatePackedSensorRaw`, `createNativeCaptureSdrTask` and `createNativeRawDevelopmentTask`. A sensor result also lists its `flaggedSiteIndices`; a chart-radiance result lists its `hostRecomputedQueryIndices`.
- `createImageKernelAccelerator({ backend })` is the only entry point. `backend: "cpu-reference"` never touches WebGPU. `backend: "webgpu-f32"` requires `fallback: "cpu-reference" | "fail"`. When WebGPU cannot be acquired, the accelerator either runs the reference and records `fallbackReason` (`webgpu-unavailable`, `webgpu-disabled`, `adapter-unavailable`, `device-request-failed`, `insufficient-limits`, `unsupported-platform-endianness`), or throws `ImageKernelExecutionError` with that `reason`.
- **One boolean instead of the two fields:** `{ webgpu: true }` is `backend: "webgpu-f32"` with `fallback: "cpu-reference"` (add `fallback: "fail"` to fail instead), and `{ webgpu: false }` is `backend: "cpu-reference"`. Give `webgpu` or `backend`, not both.
- **The realm's switch:** `setWebGpuEnabled(false)` keeps every accelerator in this JavaScript realm on the CPU reference whatever callers ask: a request for `webgpu-f32` then runs the reference with `fallbackReason: "webgpu-disabled"`, or throws that reason in fail mode, and no adapter is requested. `setWebGpuEnabled(true)` is the default; `getWebGpuEnabled()` reads it. A Web Worker has its own switch. Flipping it never changes a result already computed, and an accelerator created while the switch was on keeps its device until it is disposed. This is the one place a developer turns the engine's GPU use off, for debugging, measuring or reproducing a result; every GPU path added later (#474) consults the same switch.
- Fallback happens only at acquisition. After a device has been acquired, failures are errors: `device-lost`, `out-of-memory`, `gpu-validation`, `aborted`, `disposed`, `busy`, `unsupported-on-backend`, `unsupported-float32-domain` and `indeterminate-float32-classification`. The backend never re-runs work on the CPU mid-flight. Create a new accelerator to recover. Input validation keeps the reference's own errors (`InvalidConfigurationError`, `InvalidScientificResultError`), because the GPU path calls the same validators.
- Every result carries `execution: ImageKernelExecution`:
  - `backend`, `requestedBackend`, `fallbackReason`;
  - `arithmetic`: `float64` or `float32`;
  - `assurance`: `engine-reference` or `approximation-with-a-priori-bound`;
  - `bitIdenticalToReference`;
  - `errorBound`;
  - `diagnosticsExact` and `diagnosticUncertaintySampleCount`;
  - `limitations`.
- **Bit-exact identities are CPU-only.** SHA-256 artifact bindings, byte-parity fixtures, export evidence and cross-engine determinism hashes must be computed from `cpu-reference` output only. A `webgpu-f32` result is never bit-identical to the reference, and it states so.
- **Runtime resources:**
  - Single flight: an overlapping call rejects with `busy`.
  - `signal` (an `AbortSignal`) aborts acquisition or a run. Pending GPU waits race the signal and device loss, and every buffer is destroyed when the operation settles. A device that arrives after acquisition was aborted is destroyed on arrival.
  - `dispose()` destroys the device. `state` reports `ready`, `lost` or `disposed`.
  - `maximumBandBytes` (at least 4 KiB, default min(64 MiB, the device limit)) bounds each band buffer. Each band's buffers, readback included, are destroyed before the next band, so peak GPU memory follows the band size, not the image size. Banding changes memory use only, never results. The conformance suite checks that banded and unbanded GPU output are identical.
- The package stays dependency-free and browser-safe. WebGPU typings come from TypeScript's DOM library at build time, and no WebGPU type appears in the published declarations. In Node or any runtime without `navigator.gpu`, the backend reports `webgpu-unavailable`. You can pass a worker's `navigator.gpu` explicitly through `gpu`.
- Every `webgpu-f32` accelerator reports its `adapter` (2.11, #481): the browser's `GPUAdapter.info` as `{ vendor, architecture, device, description }` (empty strings where the browser withholds them), or null without `info`. Diagnostic only.

## The three GPU entry points

The engine's GPU use has three entry points (owner's refinement of #481). Each is opt-in, each consults the realm's switch, each labels its result in the same words, and none is on by default. Captures and exports have no GPU option of their own.

| Entry point | What asks for the GPU | What it may touch | How the result is labelled |
| --- | --- | --- | --- |
| **Accelerator** `createImageKernelAccelerator({ webgpu: true })` or `{ backend: "webgpu-f32", fallback }` | The caller, per accelerator | The six typed-array operations above, on inputs the caller gives | `result.execution` (`ImageKernelExecution`): `backend`, `requestedBackend`, `fallbackReason`, `arithmetic`, `assurance`, `fast`, `errorBound`, `limitations`; `accelerator.adapter` |
| **Preview option** `prepareDisplayView(request, { gpu: "auto" \| "require", gpuDevice })` (2.11, #481) | The app, per prepared display view; default `"off"` | The display view's renders only (a GPU display-view renderer, #478, when one exists); never a capture | `diagnostics.fast.execution` (`DisplayViewExecution`): the same fields plus `gpu` (the mode), `adapter` and `conformance`; `diagnostics.fast.assurance` follows it; a GPU render adds the `view.execution` assumption |
| **Fast flag** `fast: true` on a capture request, or an option's record `fast` (#395, 2.10) | The caller, per option | A listed option's fast method; no option has one yet (#482 would route `lens.diffraction` to the GPU convolution) | `diagnostics.fast = { requested, applied, assurance }` and a `fast.<path>` assumption per fast method that ran |

**One vocabulary.** The preview option's `"auto"` is `backend: "webgpu-f32"` with `fallback: "cpu-reference"`; `"require"` is `fallback: "fail"`; `"off"` is `backend: "cpu-reference"`. `setWebGpuEnabled(false)` vetoes all three entry points before any adapter is requested: the accelerator and the preview option report `webgpu-disabled` (or throw it in fail or require mode). No environment variable reaches the engine; `PHOTIVRA_WEBGPU_*` are test-runner settings.

**Preview option rules** (`docs/DISPLAY_VIEW.md`, "Rendering on the GPU", has the detail):

- *Device.* One device per prepared view, shared by its parts. `gpuDevice` hands the view a device to share: a worker's `navigator.gpu` to acquire from, or an `ImageKernelAccelerator` whose device the view uses and leaves to its owner. Without it the engine acquires from `globalThis.navigator.gpu` and `prepared.dispose()` releases it. The request's `signal` aborts the acquisition; a render's `signal` aborts that render.
- *Fallback (`"auto"`).* The accelerator's acquisition reasons (`webgpu-unavailable`, `webgpu-disabled`, `adapter-unavailable`, `device-request-failed`, `insufficient-limits`, `unsupported-platform-endianness`), plus `unsupported-on-backend` (no GPU display-view renderer in this version, or it does not support the request), `conformance-failed` (the device failed the run-time self-check), `device-lost` (the rest of the view runs on the CPU), `disposed`, and since 2.22.0 `quality-code-unavailable` (the on-demand GPU full-quality code did not load; that render runs on the CPU and the next one loads it again, #594). The CPU result is the reference, labelled `backend: "cpu-reference"`, `assurance: "engine-reference"`, with the reason and, when a device was involved, the adapter.
- *Fail (`"require"`).* Each of those events throws `ImageKernelExecutionError` with that reason instead: acquisition failures from `prepareDisplayView`, later ones from `render`.
- *Conformance at run time.* Before a device's first display-view render the view runs a short self-check once: the built-in cases run the `webgpu-f32` convolution kernel on two small seeded images and compare with the float64 reference within its a-priori bound; a renderer adds its own cases. A failure keeps the whole view on the CPU, and the label records the adapter, the cases and the one that failed. Since 2.22.0 (#594) the engine renderer runs only its Speed case there; the Quality host loads on demand, and its two cases run once, before the first render that takes the Quality passes (a failure keeps that render and every later one on the CPU).
- *Single flight.* GPU renders of one prepared view run one at a time on its device; concurrent renders wait their turn rather than reject with `busy`.

## Stages

The first three stages were chosen because they cost the most CPU time per pixel. The measurements come from the 2.0 performance review (`findings-perf`, Node 24, single run), and from in-browser CPU timings taken while developing this backend (Chromium, loaded 4-core host).

| Stage | CPU reference | Measured CPU cost | GPU mapping |
| --- | --- | --- | --- |
| Isoplanatic PSF convolution | `calculateIrradianceConvolution` (new, float64) | ≈ 4 µs/px at radius 7 (225 taps), 1024×768 in Chromium: 3.2 s. 24 MP at radius 15 would take minutes. The per-site PSF path it replaces costs 19 ms to 1 s per site. | One invocation per output site; highest arithmetic intensity |
| Native capture SDR | `createNativeCaptureSdrTask` | 98–146 ns/px (Node); 24 MP in 2.7–3.5 s | Pointwise per sample |
| Packed RAW development | `createNativeRawDevelopmentTask` (typed kernel, #295) | ≈ 1.0 µs/px in Chromium on this host (1024×768: 0.8 s); 24 MP in tens of seconds | One invocation per output pixel |

Two image-formation stages were added later for #277. Their CPU references are new typed-array functions. Neither CPU-reference cost below has been benchmarked, so none is claimed:

| Stage | CPU reference | GPU mapping |
| --- | --- | --- |
| Temporal exposure sum (exposure, motion, rolling or global readout) | `calculateTemporalExposureSum` (new, float64) | One invocation per output site; K nodes × 4 bilinear taps |
| Sensor stage (seeded Poisson charge, capacity, read noise, pre-ADC limit, ADC) | `simulatePackedSensorRaw` (new, float64; bit-identical to the per-site producer) | One invocation per site; integer random streams |

Two more stages were added for #277 in 2.0, scene radiance of the engine's chart scenes and the spectral integration of that radiance (`calculateChartRadianceBatch`, see [Scene radiance on the GPU](#scene-radiance-on-the-gpu)). The per-site engine's own radiance and pupil sampling for arbitrary providers stays on the CPU. The batched CPU provider API exists (`evaluateRadianceBatch`, see [native RAW](NATIVE_RAW_AND_PRINT.md#batched-light-sampling-evaluateradiancebatch-20)); the adapter from it to the GPU chart radiance is listed as deferred.

### Supported domain (fails closed outside it)

- **SDR and RAW development:**
  - All four tone curves (2.0: the luminance curves too). `naka-rushton-luminance` needs exponent n ≥ 1 on the GPU (below 1 its ratio f(L)/L is unbounded as L → 0, so no useful bound exists there; `unsupported-on-backend`), 1/g(Lw) ≤ 2^60 and σⁿ ≥ 2^-60; `extended-reinhard-luminance` needs Lw ≥ 2^-20 (`unsupported-float32-domain` otherwise).
  - A luminance-toned sample whose value plus bound exceeds 2^100 fails closed (`unsupported-float32-domain`).
  - Only `borderHandling: "reject"`. Mirror borders (`borderHandling: "mirror"`) reject with `unsupported-on-backend`; use `cpu-reference` for them.
  - No development exposure push (#556): `exposureCompensationStops` other than 0 rejects with `unsupported-on-backend`; use `cpu-reference` for it.
  - Sample magnitude times scale must stay ≤ 2^120 (`unsupported-float32-domain`).
  - In `reject-out-of-range` mode, any sample inside the float32 gamut classification band rejects with `indeterminate-float32-classification`. The backend fails closed rather than guessing whether the reference would reject.
- **RAW development** takes ownership of `input.raw` exactly like the reference task: the caller's arrays are detached. The a-priori exposed-value bound must not exceed 1.
- **Convolution:**
  - Samples must be finite, non-negative and ≤ 2^100.
  - Kernel weights must be in [0, 1], and each kernel must sum to ≤ 1 + 2^-20 (no energy creation).
  - Radius ≤ 32, ≤ 4096 patches, ≤ 4 194 304 weights, ≤ 24 MP (2.2: up to 2^27 with the input's `maximumPixels`).
- **Temporal exposure sum** (reference limits, which also bound the float32 range):
  - Samples finite, non-negative and ≤ 2^100; row weights in [0, 2^16]; 1–256 nodes; displacements within ±4096 sites; ≤ 24 MP (2.2: up to 2^27 with the input's `maximumPixels`).
- **Sensor stage:**
  - The packed input itself supports one readout regime with a uint16 ADC (≤ 16 bits), ≤ 16 read-noise components, one physical capacity for the frame, photo and dark charge, an optional fixed-pattern noise profile and up to 8 additional stored-charge components (2.0). The per-site producer allows 32 components; use `simulateSensorRawFrame` for more than 8.
  - On the GPU (`unsupported-float32-domain` otherwise): capacity ≤ 2^24 electrons (2.5: `simulateCapture`'s tier capacity, 60 000 e⁻ × pitch²/36 µm², reaches it at 100 µm, so whole-frame pitches above that need `cpu-reference`); expected photo and dark electrons (after the fixed-pattern factors) and each additional component < 2^30 per site; the deterministic components' sum < 2^30 per site; 2^-60 ≤ 1/gain ≤ 2^60 and capacity/gain ≤ 2^30; each read-noise RMS 0 or in [2^-100, 2^100], with 7·ΣRMS ≤ 2^28 electrons and ≤ 2^20 codes; |fixed-pattern readout offset| ≤ 2^28 electrons and ≤ 2^20 codes.

## Equations

**Convolution** (source-indexed, energy-conserving scatter written as a gather):

`out(x, y) = Σ_{v=-r..r} Σ_{u=-r..r} in(x − u, y − v) · K_{p(x − u, y − v)}(u, v)`

Here `p(s)` is the isoplanatic patch containing the *source* site, and `K_p(u, v)` is the fraction of that site's linear, additive quantity that lands at displacement (+u right, +v down).

- Incoherent imaging superposes intensity PSFs linearly ([MIT OpenCourseWare 2.71, lecture 22](https://ocw.mit.edu/courses/2-71-optics-spring-2009/resources/mit2_71s09_lec22/), free; isoplanatic subsections: van de Ketterij et al., [arXiv:2011.01738](https://arxiv.org/abs/2011.01738), sec. 1, free. Also see: Goodman, *Introduction to Fourier Optics*, 4th ed., 2017, §7.1).
- Treating the PSF as constant inside a patch is the declared piecewise shift-invariant approximation (isoplanatic patches; the method used by camera simulators such as ISETCam: Farrell et al., *Proc. SPIE* 8299, 2012). Patch size and kernels are the caller's declared choice.
- The grid is the whole source support. Quantity scattered outside it is lost; there is no padding or renormalization. `inputSum − outputSum` reports the loss.
- Kernels can come from the engine's sampled lens PSFs (2.0, next section); otherwise the caller supplies them. No PSF profile is inferred.

**Kernels from a lens PSF profile** (`resolveLensPsfConvolutionKernels`, schema 0.1.0):

- For each patch, the PSF is resolved with `resolveLensSampledPsf` at the patch centre's field point, in the per-site engine's own coordinates: native sensor millimetres from the optical axis (`grid.opticalAxisSite`, +Y down), field point (x, −y).
- Each PSF tap maps to a site displacement through the per-site quadrature's own inverse support (`sensorPsfSourcePoint`). Tap (kx, ky) lands at u = (kx − cx)·pₓ/sₓ, v = −(ky − cy)·p_y/s_y, where p is the PSF sample pitch and s the site pitch. When p equals s (the same number) the displacement is the tap offset itself, kx − cx and −(ky − cy), because the rounded quotient (n·p)/p can miss the integer n by one unit in the last place (2.2.1).
- **Exact site sampling** (`exactSiteSampling: true`): when every displacement is an integer, each tap's weight goes to one kernel cell. A destination whose PSF equals its patch's then gets exactly the per-site PSF quadrature with site-centre sources (tested at patch centres).
- **Labelled approximation, otherwise:** each weight is split over the four surrounding displacements with bilinear weights, the exact adjoint of bilinear interpolation. The convolution then equals the per-site quadrature applied to the bilinear interpolant of the site-centre samples (tested to 1e-12). Weights are conserved.
- **Several wavelengths:** the kernel is the weight-normalized sum of the per-wavelength kernels. For a spectrally neutral scene this is exactly the per-site engine's spectral sum when the weights are its spectral quadrature weights times the illuminant.
- The kernel radius is the smallest that holds every non-zero tap (at most 32). A smaller requested radius is rejected rather than dropping support. Each patch is accumulated in a fixed-size scratch map (radius 32), so memory stays proportional to the output; taps are added in kernel order, then the four bilinear corners. Relative pupil throughput is reported per patch and never folded into the unit-energy kernels, as in the per-site engine.
- The remaining approximation is the isoplanatic patch: one PSF per patch, indexed by the source site. Its method error is measured in the [per-fixture rollout](#per-fixture-rollout-method-error), not bounded.

**SDR** is exactly the `calculateSdrRendering` chain in the same order: rendering exposure, then per-channel tone, then gamut handling, then the sRGB transfer (W3C CSS Color 4; also IEC 61966-2-1), then nearest-ties-up quantization.

**RAW development** follows `raw-development-kernel.ts` and `prepareSensorColorDevelopment`:

1. Site normalization: a site is 1 when it is flagged or at/above its phase white level. Otherwise it is `(code − black)/(white − black)`, evaluated in float64 on the host and rounded once to float32.
2. CFA kernel sums, in declared contribution order.
3. Applied WB gains.
4. Highlight handling: clip at the smallest gain, or the declared neutral blend above 0.8.
5. Camera→XYZ, then XYZ→linear sRGB, in the documented row order.
6. The SDR chain above.

**Luminance tone curves** (2.0) follow `prepareSdrPixelTone`: when L = kr·r + kg·g + kb·b > 0 (the linear-sRGB/D65 luminance row), every component of the pixel is scaled by h(L) = f(L)/L; otherwise the pixel is unchanged. The kernel evaluates h directly, in a form algebraically equal to f(L)/L:

- extended Reinhard: h = (1 + L/Lw²)/(1 + L);
- Naka–Rushton: h = (1/g(Lw)) / (L·(1 + P)), P = (σ/L)ⁿ = exp2(n·log2(σ/L)); for P ≥ 1 the equal form (1/g(Lw))·P⁻¹/(L·(1 + P⁻¹)) keeps every intermediate finite.

The SDR kernel runs one invocation per pixel for these curves; RAW development applies them after XYZ → linear sRGB, as the reference does.

A saturated site normalizes to exactly 1, while every unsaturated value is ≤ 1 − 1/65535. The GPU can therefore detect saturated contributing sites exactly, so `highlight.saturatedPixelCount` is exact.

**Temporal exposure sum** (`calculateTemporalExposureSum`, schema 0.1.0):

`out(x, y) = Σ_k w_k(y) · E₀(x − dx_k, y − dy_k)`

- A site's exposure is the time integral of its rate over its own exposure window, H = ∫ E dt ([EMVA Standard 1288 Release 4.0 Linear](https://www.emva.org/wp-content/uploads/EMVA1288Linear_4.0Release.pdf), §2, free; [CIPA DC-004](https://www.cipa.jp/e/std/std-sec.html), §5.5, free).
- If the image translates rigidly by d(t), then E(x, t) = E₀(x − d(t)). A quadrature with nodes t_k and weights w_k gives the sum above. Motion blur is this superposition of displaced images (Szeliski, *Computer Vision: Algorithms and Applications*, 2nd ed., 2022, [free from the author](https://szeliski.org/Book/)).
- Row-dependent weights give a rolling shutter: each row starts and ends its exposure at a different time (Meingast, Geyer & Sastry, [arXiv:cs/0503076](https://arxiv.org/abs/cs/0503076), free). A global shutter uses the same weights on every row.
- **Declared approximations, owned by the caller:** the quadrature nodes and weights, and rigid translation (no rotation, warp or occlusion).
- **Labelled approximation:** a sub-site displacement uses bilinear interpolation between the four nearest site centres. This is linear interpolation, slightly low-pass, not exact resampling. Integer displacements need no interpolation (`plan.integerDisplacements`).
- Sources outside the grid are zero. There is no padding or renormalization.
- Summation order, shared with the WGSL kernel: node ascending, then taps 00, 10, 01, 11 left to right, then times the row weight.

**Sensor stage** (`simulatePackedSensorRaw`, schema 0.1.0, noise model `photivra-native-raw-noise` 0.4.0):

- **Equations:** the per-site producer's sensor steps on typed arrays, in its exact operation order (`calculateNativeRawSite`):
  1. Poisson photo and dark draws from the charge stream. With a fixed-pattern profile (`SENSOR_FIXED_PATTERN_NOISE_MODEL` 1.0.0) the means are first multiplied by the site's PRNU gain and DSNU or hot-pixel dark factor (`calculateSensorFixedPatternSite`, at colour-sampling site = native site + `fixedPatternNoise.siteOrigin`). Then each additional stored-charge component in declaration order: a Poisson draw from the same stream, or its deterministic expectation. The total is photo + dark + (sum of the components);
  2. min(realized, capacity);
  3. Box–Muller read noise from the read-noise stream, plus the fixed-pattern row and column offsets;
  4. the pre-ADC limit;
  5. `adcTransfer`: (signal/gain + black + INL), rounded half up, optional digital gain;
  6. the final clamp.
- **Seeds:** per-site stream seeds are MurmurHash3_x86_32 of (capture seed, absolute native row-major index, stream 0 or 1). A region or band never changes a code.
- **Reference identity:** for the same expected electrons and regime, the codes and saturation flags equal the per-site engine's bit for bit. `test/packed-sensor-raw.test.ts` checks this against `calculateNativeRawSite` for 160 sites in each of three regimes, covering INL, digital gain, fractional capacity and all four sampler branches (zero, multiplication, PTRS, normal approximation).
- The science and its sources are unchanged from the per-site model; see [Motion and signal](MOTION_AND_SIGNAL.md).

**How the GPU sensor stage reproduces the seeded noise:**

- **Integer state:** the MurmurHash3 seeds, the fmix32 scrambling and the xorshift32 streams are 32-bit integer arithmetic, so every random state is bit-identical to the reference.
- **Exact comparisons:** a comparison of a uniform value with a constant, or with another uniform value, is made exactly on the integer state. The reference's values there are exact dyadic rationals. This covers PTRS `uS ≥ 0.07`, `uS < 0.013` and `v > uS`.
- **Other decisions, with a bound:** every other decision is evaluated in float32 together with an a-priori bound on its distance from the float64 reference value. These are the multiplication-method threshold, the PTRS floor and acceptance tests, the physical and pre-ADC limits, and ADC and digital-gain rounding. A site where any decision falls inside its bound is **flagged**.
- **Accuracy techniques:**
  - PTRS's log-probability test is evaluated as k·g(t) − ½ ln k − ½ ln 2π − R(k), with g(t) = ln(1 + t) − t and t = (mean − k)/k. This is algebraically identical to the reference's −mean + k ln mean − log k! and avoids its cancellation. R(k) is the reference's own log k! minus Stirling's leading terms, tabulated in float64 for k < 256.
  - The ADC input (signal/gain + black) is formed as an exact integer part plus a float32 fraction. The host splits 1/gain and the digital gain (float64) into four 12-bit pieces m_j·2^(s_j) and sends m_j, s_j and 2^(s_j); the kernel multiplies the 12-bit halves of the integer signal by m_j in 32-bit integer arithmetic, shifts the integer part out and converts the masked low bits times 2^(s_j) to an exact float32 fraction below 1. No floating-point split can be broken by the evaluation order, and the kernel divides nowhere on this path (#471).
  - The INL offset is ao + (code − ac)·slope with the segment slopes computed on the host in float64, so the kernel does not divide there either.
  - WGSL's built-in `cos` has only a 2^-11 absolute bound, so the kernel uses its own octant-reduced Taylor polynomials.
- **Branch selection:** the zero and Poisson-branch categories (< 30, < 1e9, normal) are computed on the host in float64, so the GPU always takes the reference's branch. Means of 1e9 and above always exceed the capacity bound of 2^24, so their exact draw cannot change a code. Partial charge sums saturate at 2^30 on the GPU, above every supported capacity, so saturating cannot change a decision either.
- **Fixed-pattern noise and additional charge (2.0), same guarantee:**
  - The host evaluates every site's fixed-pattern values in float64 with the model's own functions (row and column offsets once per row and column). It packs the Poisson means already multiplied by the factors, which are exactly the reference's float64 products, so the Poisson branch and draws are unchanged.
  - The readout offset enters twice, both formed in float64 on the host: the pre-ADC test becomes afterPhysical − (threshold − offset) + noise > 0, and the ADC input gains offset/gain as an exact integer part plus a float32 fraction. Their bounds add the reference's own float64 rounding of the offset sum (2^-47 relative slack, as for the other terms) and the fraction's float32 rounding.
  - Deterministic components make the stored charge non-integer. Their sum enters as an exact integer part plus a float32 fraction, and the capacity test becomes a float32 difference with its own bound (both fractions' roundings and the reference's rounding of the total), so a near-tie at the capacity is flagged.
  - With either feature, the noise-free exact-tie mode is off, so every ADC rounding decision carries its bound.

## Scene radiance on the GPU

`accelerator.evaluateChartRadiance(input)` (2.0) answers many radiance queries on the engine's procedural chart scenes in one call. The float64 reference is `calculateChartRadianceBatch` (schema 0.1.0), and the query shape mirrors a batched provider: queries in, results in the same order.

- **Queries:** frame points (u right, v up, as in `resolveChartScene`), with either one wavelength index per point (spectral radiance in W·m⁻²·sr⁻¹·nm⁻¹) or 1–4 rows of channel weights over 1–256 wavelengths (the spectral integral Σ_j w_cj·L(u, v, λ_j), summed in wavelength order). `mapEnvironmentDirectionsToChartPoints` turns environment-direction queries into frame points exactly as the planar provider's `evaluateRadiance` does.
- **Reference:** every value comes from the planar provider's own `radianceAt`: a Lambertian reflectance ρ(λ) under the scaled illuminant, L = ρ·k·S(λ)/π (see `createPlanarSceneRadianceProvider`).
- **How the GPU evaluates it:** the charts are uniform-illuminant Lambertian patterns, so a query's value depends only on its material and wavelength (or channel). The GPU classifies each point's material in float32. For radiance queries it reads the material's radiance at the query's wavelength, formed on the host in float64 with the reference's own operations and order. For spectral integrals (2.21.0) signals are integrated from the material spectrum per query: the kernel returns each query's material, and the host integrates that material's spectrum (kept per material) against the query's channel weights in float64, in the reference's order, and rounds once; no per-material channel value is formed. The values are unchanged.
- **Classification bounds:** every decision (half-plane, disk, sector, cell and gap boundaries) carries an a-priori bound on the distance between the float32 decision value and the float64 reference value. The bound covers the point's float32 rounding, each float32 operation (ε = 2^-23, one WGSL rounding in either direction; see [Error bounds](#error-bounds-a-priori-reported-per-result)), the constants' float32 rounding and the reference's own float64 rounding (10^-14 relative slack). A point within four times its bound of a boundary is flagged.
- **Siemens star without `atan2`:** the sector boundaries b_k = π(k/cycles − 1) are directions (cos b_k, sin b_k) computed on the host in float64 and rounded once to float32. The sign of v picks the half-plane (v ≥ 0: boundaries cycles … 2·cycles; v < 0: 0 … cycles), where sign(v·cos b_k − u·sin b_k) = sign(θ − b_k), so a binary search over the half-plane's boundaries on these cross-product signs finds the sector; the two enclosing cross products then carry the bound ε·(3|v·cos b| + 3|u·sin b| + |d|) + 10^-14·(|u| + |v|): the point's and the direction's float32 roundings, the two products and the difference, the reference's float64 `atan2`, division and scaling (≤ 2.8·10^-15·ρ) and the float64 rounding of b_k. The kernel evaluates no transcendental function, so neither WGSL's 4096-ULP `atan2` bound nor the realm's float64 `Math.atan2` enters. A point on the u-axis (v = ±0) or on the ±π cut lies on boundary cycles or 0/2·cycles and is flagged by those checks.
- **The reference depends on the realm's `Math.atan2`.** ECMAScript does not fix the last bit of `Math.atan2`, and Node 24 and Chrome 153 differ by one ulp for some arguments. For a point placed exactly on a sector boundary the reference's `floor(phase · 2 · cycles)` can therefore fall on either side in different realms (#471: the conformance suite's point 60 039 classified light in Node and dark in the browser, on SwiftShader and on Metal alike). The GPU flags such points and recomputes them with the reference of its own realm, so a `webgpu-f32` result equals `cpu-reference` in the realm that produced it; the conformance suite compares against the browser realm's reference and reports the realm differences (all of them boundary points).
- **Flagged points are recomputed on the host** with the reference (`hostRecomputedQueryIndices`), and so are points whose material spectrum fails, which then raise the reference's own error.
- **Bound (`relative-to-reference`):** every value, flagged or not, is the reference value rounded once to float32: |v_gpu − v_ref| ≤ 2^-24·|v_ref| + 2^-126. This holds for negative channel weights too.
- **Domain (`unsupported-float32-domain` otherwise):** |u|, |v| ≤ 2^20 frame units; radiance values ≤ 2^120 (a spectral integral outside the float32 range is recomputed with the reference).
- **Presets:** the preset kernel (`src/gpu/wgsl-chart-kernel.ts`) classifies the eight 2.0 presets as plain charts, a Siemens star only with the bar profile. Everything else runs on the composite kernel below. The float64 reference (`calculateChartRadianceBatch`) covers every preset and scene form.
- **Measured on SwiftShader** (`test/webgpu/stages.webgpu.ts`, all eight presets, 60 000 random points plus boundary points, radiance and three-channel integration; Chrome for Testing 153 after #471): every value equalled the browser realm's reference rounded once to float32 (largest relative difference 5.9e-8). Boundary points were flagged and recomputed as designed (275 of the star's 60 219 points). Random points were recomputed at most 3 in 60 000 times, except for the 1024-level grey ramp (81 in 60 000; 42 before the margins were written in ε). One realm difference, the star boundary point of #471, was a flagged boundary point.

### Composite charts, chart elements and mask layers (#477)

A second kernel (`src/gpu/wgsl-chart-composite-kernel.ts`, host side `src/gpu/chart-composite-gpu.ts`) classifies `composite` charts, every 2.3 element as a plain chart (`dead-leaves`, `bar-groups`, `hyperbolic-wedge`, `zone-plate`, `slanted-squares`, `line-grid`, `fiducial`), the sine-profile Siemens star, and declared `material-layers` scenes. It is the prerequisite of the GPU preview (#473).

- **Supported elements** (as composite elements or plain charts): `uniform`, `slanted-edge`, `siemens-star` (bar and sine), `step-wedge`, `grey-ramp`, `checkerboard`, `point-grid`, `patches`, `dead-leaves`, `bar-groups` (with numerals), `hyperbolic-wedge`, `zone-plate`, `slanted-squares`, `line-grid`, `fiducial`; rectangle and ellipse placements; and the shape-mask layers of a `material-layers` scene. A composite cannot nest a composite (the reference refuses it too).
- **Refusals** (`unsupported-on-backend`): a caller scene function (`material-function`, `reflectance-function`, `radiance-function`; `calculateChartRadianceBatch` does not take them either: describe the scene as `material-layers` instead), and a device that fails the arithmetic probe below. `unsupported-float32-domain`: a point beyond 2^20 frame units or a chart constant beyond 2^120. `insufficient-limits`: records (a dead-leaves element's disks, a star's sector table) beyond the device's storage binding limit.
- **Declared material scenes (`material-layers`):** `{ kind: "material-layers", sceneId, chart, layers }`, resolved by `resolveChartMaterialLayers({ scene, aspect })`. Each layer maps its mask box `[0, unitsWidth] × [0, unitsHeight]` (y down) onto a frame rectangle and holds up to 4096 shapes: filled polygons (rings as flat `[x0, y0, …]` under the non-zero winding rule, a stroked polyline as its square-capped rectangles of one orientation) and annuli (stroked circles). Inside its rectangle a layer decides the material: ink where any shape contains the point, its background elsewhere; later layers cover earlier ones; the chart shows outside them. The resolved scene's `materials` are the chart's, then each layer's background and ink; `materialAt(u, v)` is the float64 reference, and `callerScene` is the same scene as a caller material scene for `simulateCapture` (it reads `chartU`/`chartV` when the chart has a size). Each layer carries a cell index of `CHART_MASK_INDEX_GRAIN` (64 × 16) cells, each listing the shapes whose bounding box meets the cell grown by one cell; the indexed test equals the full test at every point (a computed cell is off by at most one through rounding, and a shape left out lies a whole cell away). The engine holds no label of its own: an application describes its printed label here (Photivra/apps#112's exact index is the same construction).
- **How the kernel decides:** every float32 value carries an a-priori bound: a constant rounded from float64 carries E·|c| with E = 2^-23 (one WGSL rounding of `+ − ×`, which the specification lets fall in either direction), each `+ − ×` adds E·|v|, each `/` the WGSL 2.5-ULP bound, and a point its low float32 part (points are uploaded as hi + lo pairs, the float64 point to 2^-48). A sign, floor or comparison within four times its bound plus 10^-14 relative slack (the reference's own float64 rounding) flags the point, recomputed on the host. A placement's rectangle and ellipse tests, the layer rectangle, the mask transform and every edge comparison of the winding test carry bounds the same way; the mask's cell choice needs none (the one-cell margin).
- **No `sin`, `cos` or `atan2` decides anything.** The zone plate's phase k·r² and the stars' sector tests are evaluated in double-float32 (TwoSum, Veltkamp split, Dekker TwoProduct; Joldes, Muller and Popescu, "Tight and rigorous error bounds for basic building blocks of double-word arithmetic", ACM TOMS 44(2), 2017, free author copy on HAL: each operation within a few u² relative; the kernel declares 2^-40 relative per result). The zone plate reduces its phase to [−1, 1] cycles exactly (Sterbenz) and evaluates cos by quadrant folding and a Taylor polynomial in bound arithmetic (Lagrange remainder ≤ 4·10^-13 for cos and 2·10^-14 for sin on [0, π/4 + ε]). A Siemens star is a table of its sector boundary directions (host float64, split to hi + lo) with each sector's level read from the reference's own `materialAt` at the sector's mid-angle; a rough `atan2` and a bucket table give a search window, and the sector is decided by the signs of double-float32 cross products with the two bracketing boundaries. A point the rough guess misplaces beyond the window is flagged, never misclassified (the window is sized for the WGSL `atan2` bound with a 4× margin). Points exactly on a sector boundary are flagged by design.
- **The device probe.** Double-float32 needs the written evaluation order and round-to-nearest `+ − ×`. WGSL does not guarantee either (W3C WGSL, Candidate Recommendation Draft of 26 October 2026, free): § 15.7.4 "Floating Point Accuracy" lets a correctly rounded result be rounded up or down ("WGSL does not specify a rounding mode"); § 15.7.5 "Reassociation and Fusion" says "An implementation may reassociate operations" and "An implementation may fuse operations if the transformed expression is at least as accurate as the original formulation"; § 15.7.2 "Differences from IEEE-754" and § 17.5.32 `fma` let `fma` "expand to an ordinary multiply (including a rounding step) and an add (and another rounding step)". WGSL has no way to forbid a fusion or a reassociation in a shader, so before the kernel is used the host runs `CHART_COMPOSITE_PROBE_WGSL` once on the device (per accelerator, and per display-view renderer): on 16 inputs with non-zero low parts and with sums and products that directed rounding would place on the other neighbour, it evaluates the kernel's own functions: TwoSum (`s.l`), Dekker's TwoProduct (`m.l`), the double-word add (`a.l`) and the Dekker double-word multiply (`q`), and since 2.11.0 the fma TwoProduct (`mf.l`) and the fma double-word multiply (`qf`). TwoSum, both TwoProducts and the double-word add must equal their exact values bit for bit; a double-word multiply must equal the written-order evaluation for the cross-term sum t = a.h·b.l + a.l·b.h unfused or with either of its products fused into its addition (a contraction that is harmless there: t is an ordinary bounded sum). The probe is evidence for the compiled code on sampled inputs, not a proof over all inputs, and it covers the kernel's code paths only as far as the compiler treats them alike in the probe and in the kernel (the functions are the same text; their operands in the kernel are loads, double-word results and rounded integers, never raw products, as in the probe).
  - **The probe's record (2.11.0)** (`ChartCompositeProbeRecord`): `deviceClass` `exact` (the written order, round to nearest), `contracted` (TwoSum and the double-word add exact, a Dekker product path differs: consistent with a multiply and an add fused into one rounding), `reassociated` (a sum path differs and every differing sum low part is zero, the value an algebraic simplification of (a + b) − a to b gives), or `other` (a sum path that differs with non-zero low parts, as a rounding not to nearest gives, or a non-finite output); `productPath` (below); `fmaFused`; per component the count and the input indices that differ (`mismatchCounts`, `mismatchedInputs`) and the first eight differences with the float32 bits got and wanted (`mismatches`). A refusal (`ChartCompositeProbeError`, `unsupported-on-backend`) puts the class, the path, each differing component with its count and inputs, and the first difference into the message (one log line), and the record into `probe`; the display view records it in `diagnostics.fast.execution.compositeProbe` on a GPU render and on the CPU fallback of `"auto"` alike, and on the error `"require"` throws ([Display view](DISPLAY_VIEW.md)).
  - **Two product paths (2.11.0).** Dekker's TwoProduct (with Veltkamp's split) and the final Fast2Sum of the Dekker double-word product rely on every rounded product being rounded before it is added: a fusion of `sa.h*sb.h - p` with p = a·b, of Veltkamp's `t - (t - a)` with t = 4097·a, or of `p.h + l` with p.h = a.h·b.h (which then adds the product's error twice) changes them. The **fma path** never adds a rounded product: TwoProduct is p = a·b, e = fma(a, b, −p) (exact when `fma` is fused; Joldes, Muller & Popescu 2017, Algorithm 2), and the double-word product is s = fma(a.h, b.h, t), lo = fma(a.h, b.h, −s) + t with t = a.h·b.l + a.l·b.h, so the only additions of products left are inside t, whose fusion is harmless. Its error, to first order: t carries at most 2u·(|a.h·b.l| + |a.l·b.h|) ≤ 4u²|P| plus the dropped a.l·b.l (u²|P|); the rounding of fma(a.h, b.h, −s) is at most u·|a.h·b.h − s| ≤ u(|t| + u|s|) ≤ 3u²|P|; the final addition's at most u·|lo| ≤ u²|P| (+ second order): about 9u²|P| in all (u = 2^-24), inside the kernel's declared 2^-40 = 256u². Measured on 3 × 10^5 random normalized products in `test/chart-composite-contraction.test.ts`: at most 5.3u² for the fma path and 6.2u² for the Dekker path, for every allowed evaluation of t. The probe runs both paths; the kernel (and the display view's composite module) is compiled with **Dekker's when it passes** (so a device that passed before keeps its results and flags bit for bit), **else the fma one when it passes, else the device is refused**; the preset kernel still runs there. The other places that might rely on unfused evaluation: TwoSum, Fast2Sum and the double-word add hold no product; the zone plate's phase reduction subtracts 2·round(psi.h/2), an exact product, so a fused subtraction gives the same value; the stars' cross products, the placements' frame transforms and the lattice-point recovery of #491 are double-word sums and products (covered by the probe of the path the kernel is compiled with); the rough `atan2` sector guess and the mask's cell choice are guesses checked by bounded decisions. **The bound arithmetic stays valid under fusion:** each `+ − ×` adds E·|v| for one rounding of v; a fused multiply-add rounds once, so its result is within E·|v| of the exact value of the same expression, which the addition's term already covers (the product's own E·|v| term then bounds a rounding that did not happen); the bounds' own float32 evaluation may fuse too, which moves a bound by about one unit in its last place, inside the SAFETY factor of 4.
  - **The M5 Pro finding (October 27, 2026).** The owner's first hardware run of the preview acceptance harness on an Apple M5 Pro (`apple` / `metal-3`, Chrome, WebGPU on Metal; engine `main` at 14f9032, 2.11.0 prepared) refused all 26 cases (every case is a `material-layers` scene) with the probe's message of 2.10/2.11 ("does not evaluate the composite chart kernel's double-float32 arithmetic as written (reassociated or fused)"), 5 of them reported instead as the harness's browser cleanup error (`ENOTEMPTY`, below, fixed in 2.11.0); the same day's `test:webgpu:hardware` run failed its 27 composite tests with the same refusal and passed every other test ([hardware record](WEBGPU_DEVICES.md)). That probe did not say which component differed. Whether Metal fused (a contraction the fma path survives) or reassociated (which it does not) was a hypothesis until the re-run below, which found reassociation; nothing about Metal beyond these runs is claimed here. On the fake device's emulation of fused contraction (every multiplication whose result an addition or subtraction consumes, through `let` bindings and calls, fused into one rounding; first operand, second operand, or a seeded choice per site), the old probe's criterion fails as on the M5 Pro, the new probe reports `contracted` and picks the fma path, and the composite kernel and the Speed and Quality display views of the #491 fixtures render with the same flagged pixels as unfused, and in Speed the same samples (`test/chart-composite-contraction.test.ts`, `test/display-view-composite-contraction.test.ts`); with an unfused `fma` as well the device is refused as `contracted`, under the reassociation model as `reassociated`. **SwiftShader** (Chromium 141 headless) evaluates as written and keeps the Dekker path; its `fma` is **not fused** (fma(a, b, −a·b) returned 0 on 11 of the 16 inputs, `fmaFused: false`), so the fma path compiles there (the composite kernel and both display-view shaders) but its values could not be checked on a software adapter; it is checked on the emulation, and on hardware whose probe finds it exact (`test/webgpu/stages.webgpu.ts`).
  - **The re-run (October 27–28, 2026): reassociation, and the rounding barrier.** On the probe-fix commit the M5 Pro's probe reported class `reassociated`, product path none, `fmaFused: true`: TwoSum `s.l` differed on 15 of 16 inputs, Dekker's TwoProduct `m.l` on 12, the double-word add `a.l` on 15 and the Dekker double-word multiply `q` on 13, every differing low part `0x00000000` (for example `s.l` of input 0: got `0x00000000`, want `0x30800000`), the value an algebraic simplification of (a + b) − a to b gives; the fma components matched. The fma path does not survive that, so 2.11.0 adds an **opaque rounding barrier**: every operation of the error-free transforms (TwoSum, Fast2Sum, Veltkamp's split, both TwoProducts, both double-word products, the double-word add) and every value of the bound arithmetic is wrapped in `ob(x) = bitcast<f32>(bitcast<u32>(x) ^ zero)`, with `zero` a uniform word the host sets to 0 (`params.zero` in the composite kernel, `lattice.zero` in the display view's material module, `probe_zero` in the probe). A compiler cannot know `zero`, so it cannot regroup, simplify or fuse across `ob`, and each operation rounds once as written; the XOR with 0 changes no bit, so a device that already evaluates as written (SwiftShader, the emulation) gives the same values, flags and bytes as before. **Measured on the M5 Pro** (one run each, engine `9ce630b` with the barrier, before its commit): the probe reports `exact`, product path `dekker`, every component of all 16 inputs bit-exact; `test/webgpu/stages.webgpu.ts` finds both composite scenes (77 640 queries each) equal to the reference at every unflagged query (75 and 81 flagged, recomputed on the host); `npm run accept:gpu:hardware` passes all 26 cases on `webgpu-f32` with the self-check passed (100.00 % of pixels within ΔE2000 1 in every case; largest ΔE2000 0.0010; largest |Δ|/σ 0.002; the 8-bit display codes equal the reference's in every pixel of every case, so every difference image is black), `app-defocus` included; `npm run test:webgpu:hardware` passes 167 of 167. `test/chart-composite-barrier.test.ts` checks that every shader variant reads its zero word, that no operation of the transforms is left unwrapped, and that the host writes 0. This is evidence on one device; any other device is still judged by the probe, and refused if its compiler rewrites the arithmetic anyway.
  - **If a device still fails the probe with the barrier.** The next option is decisions that need no error-free transform: exact integer (fixed-point) arithmetic for the chirps' phase and the sector cross products, whose results WGSL defines exactly (§ 6.2.3 "Integer Types": "Expressions on concrete integer types that overflow produce a result that is modulo 2^bitwidth"; reassociation applies to floating point, § 15.7.5). Its size, estimated, not built: points and constants as 64-bit fixed-point values in `vec2<u32>` with 32 × 32 → 64-bit products from four 16-bit partial products (about 15 integer operations per multiply), the zone plate's k·r² and a star's cross product at about 3 to 5 multiplies each, so roughly 100–300 extra integer operations per chirp point, plus a host packing of the constants and a separate bound derivation; about a week of work with its own tests. Not built: the rounding barrier above, this paragraph's cheaper candidate, passed on the M5 Pro.
- **Uploaded once per scene:** a scene's records (placements as hi + lo pairs, the material offsets, each element's float64 constants and tables, the layers' shapes and cell lists) are packed from `chartGeometry` (internal) and uploaded once per accelerator, keyed by the scene's data and the aspect, and reused by later calls (a prepared view's parts); the four most recent scenes are kept until the accelerator is disposed. The material table (float64 values rounded once) is rebuilt per call, as its illuminant and wavelengths may change.
- **Bound:** as for the presets, every value is the reference rounded once to float32: |v_gpu − v_ref| ≤ 2^-24·|v_ref| + 2^-126, flagged points included (`hostRecomputedQueryIndices`).
- **Realm switch:** `evaluateChartRadiance` consults `getWebGpuEnabled()` on every call; when it is off, the reference runs and the result is labelled `backend: "cpu-reference"` with `fallbackReason: "webgpu-disabled"`, on an accelerator that otherwise keeps its device.
- **Measured** (flagged fraction = points the host recomputed over points queried, radiance and three-channel modes; `test/chart-composite-gpu.test.ts` on the float32 emulation, `test/webgpu/stages.webgpu.ts` on SwiftShader; the fixture places one element of every kind as an application lays out a test chart, aspect 2/3, and queries the pixel centres of a 2028 × 1352 view inside each element plus random points inside it). Every unflagged value equalled the reference rounded once. Flagged fractions on the emulation: 0 for `uniform`, `step-wedge`, `point-grid`, `slanted-squares`, both Siemens stars (64-cycle sine, 48-cycle bar), `bar-groups`, `fiducial`, `checkerboard`, `slanted-edge`, `patches` and `line-grid`; 0.02 % for `dead-leaves` and `hyperbolic-wedge`; 0.46 % for the zone plate (347 cycles per picture height; its margin is the bound-arithmetic cos) and 0.50 % for the 1024-level grey ramp; 0.013 % inside the label layer. None reaches the 1 % finding threshold. **On SwiftShader** (Chromium 141, every second pixel centre of the 2028 × 1352 view inside each element plus 5000 random points inside it; the all-elements composite at every third pixel plus 20 000 random frame points; the label layer at every pixel centre inside it plus 10 000): every unflagged value equalled Node's reference rounded once; flagged fractions 0 for `uniform`, `step-wedge`, `point-grid`, `slanted-squares`, `bar-groups`, `fiducial`, `checkerboard`, `slanted-edge`, `patches` and `line-grid`; 0.001 % for the sine star; 0.005 % for the hyperbolic wedge and 0.01 % for dead leaves; 0.21 % for the bar star (a star centred on the frame has pixel centres exactly on its 45° and 135° sector boundaries; 0.41 % in the all-elements composite at stride 3, where the diagonals are hit again); 0.39 % for the zone plate and 0.31 % for the grey ramp (0.57 % in the composite); 0.012 % inside the label layer. A 192 × 128 view centred on a star puts 72 of 2700 star points exactly on those diagonals; points on a sector boundary are flagged by design.
- **A finding, not of this kernel (#471):** at 8 of the bar star's 198 recomputed points on SwiftShader, Node's reference and the browser realm's reference disagree: V8's `Math.atan2` differs by one unit in the last place between Chromium 141 and Node 24 at some arguments, and these points lie within that rounding of a sector boundary. Both realms' references are the float64 reference, run in two realms; the stage test compares against the browser realm's reference (`reference: true`), records such points as `realmDisagreements` and requires each to be a flagged point. The GPU kernel itself never decides them (they are flagged). The same effect is the second failure of #471 in the preset kernel's star test.

## Display view (Speed) on the GPU

The display view's Speed path (#478: the exact area mean without diffraction, with the bilinear demosaic and chart materials; `docs/DISPLAY_VIEW.md`) has a WGSL kernel, `src/gpu/wgsl-display-view-speed-kernel.ts`, with its host side in `src/gpu/display-view-speed-gpu.ts`. It is internal and implements the renderer contract of #481 (`DisplayViewGpuRenderer`: `createDisplayViewSpeedGpuRenderer`, `displayViewSpeedGpuRendererFactory`); the GPU session module (`display-view-gpu-session.ts`, loaded when a prepared view first asks for the GPU) registers it unless a caller registered a renderer before, so `prepareDisplayView(request, { gpu: "auto" })` renders every engine chart and declared `material-layers` scene it covers on the device after the run-time self-check (#491: composite charts, the 2.3 elements and label layers through the composite material module below) and runs the CPU reference, labelled, for everything else (see "What remains" below). The float64 reference is `renderDisplayView`.

**What one invocation computes**, per display pixel, in float32 and in the reference's operation order where the order matters:

1. the real pixels the footprint covers and their overlap weights a_j = w_j / A: the host computes the 1-D overlaps divided by the scale and the closed-form axis sums of B_c divided by the squared scale in float64 (`overlaps`, `axisSums`), the kernel multiplies the two axes;
2. for every native site the footprint's real pixels read (the footprint plus one site of reach, each site once): the scene material at the pixel aperture's query offsets (the 2 × 2 box: four points) through the **material module** (`material_at`), the material's channel signal Σ_λ A_c(λ)·L_m(λ) (2.21.0: signals are integrated from the material spectrum per site: the kernel integrates it from the channel's response and the material's spectrum, both uploaded once rounded to float32, in blocks of 16 nodes), summed over the offsets in `directSite`'s order, plus the dark electrons; the query point of offset o at site (x, y) is (x + 0.5 + o_x − W/2)·g, formed as an exact float32 sum times a float64 scale rounded once (two roundings, ≤ 2E relative), and the host checks that model against the reference's own `queryPoint` at the frame's four corners (2^-40) and refuses a request it does not describe;
3. the readout moments (mean k·e, variance k²·e + c₀, third cumulant k³·e) and the clip at the white level;
4. per real pixel the bilinear kernels (weights, Σw² and 1/Σw² from the host), white balance and the highlight clip, the colour matrix, the tone curve (identity, or positive Reinhard by the reference's 4 × 16-point Gauss–Legendre rule with the host's nodes) and the clip to [0, 1] with the first-order skewness term;
5. the display pixel's expected value Σ_j a_j·E[L_j], the linear (Stein) covariance Σ_c B_c·σ_c²·a_c·a_cᵀ and the independent residual Σ_j a_j²·max(0, Var − aᵀCa).

It writes, per display pixel, the three means, the three variances (linear plus residual), the three covariances and two running bound terms (below), plus three flag words: a flag when a query point's classification was uncertain, and the highlight decision below. The whole region is one dispatch when it fits the band (`maximumBandBytes`, 56 bytes per display pixel since #533: the app's 2028 × 1352 view needs 154 MB, so it is one dispatch with a 256 MiB band and three with the 64 MiB default); banding never changes a byte (tested).

**Highlight count (#533).** The reference's saturated-pixel count is Σ_j w_j·P_j, with P_j = 1 − Π_k (1 − p_k) over the sites real pixel j reads, and p_k the site's clip probability (`docs/DISPLAY_VIEW.md`, "Highlight count"). The count is a diagnostic, and `diagnosticsExact` promises the reference's diagnostics, so the kernel does not estimate it in float32. It decides each real pixel only where the reference's value is exactly 0 or 1:

- **Each site.** The reference's p_k is exactly 0 beyond 8.5 σ below white and exactly 1 beyond 8.5 σ above it (the clip's slope). The kernel calls a site certain only beyond twice that distance, (1 − m ∓ 2Δm)² > 4·8.5²·(v + 2Δv). Here Δm and Δv bound the float32 mean and variance against the reference: 64 E relative in Speed (`DISPLAY_VIEW_SITE_RELATIVE_U`; the site sum, the dark electrons and the readout carry at most 26 E), and the site pass's running bounds in Quality. Every other site is undecided. The variance always holds the ADC's quantization term, so σ is at least 0.29 code over the code span. That keeps Δm far below the doubled margin.
- **Each real pixel.** It is saturated (P_j = 1) when a site it reads is certainly clipped. That is exact on both sides: one factor of the product is exactly 0. It is unsaturated when every site it reads is certainly below white. The kernel writes a bit per saturated real pixel j·nx + i (36 bits, two words) and flags the display pixel when a real pixel is neither.
- **The host.** It forms a decided display pixel's share from the bits with the reference's own arithmetic (`displayViewDecidedSaturation`), and takes an undecided one's share from a one-pixel reference render. The pixel's samples stay the kernel's. The region's count is their sum in the reference's order.

A flagged (recomputed) display pixel takes the reference's count with its samples. The emulation tests (`test/display-view-highlight.test.ts`) and the run-time self-check compare the count with the reference's bit for bit. In the checkerboard the light squares sit 3 stops over white, so the bits decide them; in the near-white grey the sites are undecided.

**The clipped-normal moments without cancellation.** The reference forms Var = E[Y²] − E[Y]² in float64; in float32 that subtraction loses the variance wherever the mean is far above the noise (m ≈ 1, s ≈ 10⁻³: an error of 5 % at the first attempt). The kernel evaluates algebraically equal forms in standardized units: for min(Y, t), Var = v·(Φ − zφ + z²Q − δ²) with z = (t − m)/s, Q = 1 − Φ and δ = φ − zQ; for clip(Y, 0, 1), with Z standard normal and g = clip(Z, a, b), E[g] = aΦ_a + φ_a − φ_b + bQ_b and E[g²] = a²Φ_a + (Φ_b − Φ_a) − (bφ_b − aφ_a) + b²Q_b, so E[W] = m + s·E[g] and Var = v·(E[g²] − E[g]²). The reference adds its Edgeworth skewness shift to E[Y] *before* squaring, so its variance also carries −shift·(2·E[Y] + shift); the kernel adds the same term. The Reinhard quadrature's nodes are formed in standardized units (z_k directly, x = m + s·z_k, weight = zhalf·w_k·φ(z_k)), which is the reference's weight half·w_k·φ((x − m)/s)/s without the cancellation x − m, and its variance is accumulated about h(m) (a shift, exact for normalized weights; the Gauss–Legendre weights sum to 1 − ε with ε from the quadrature of φ over ±8.5σ, below 10⁻¹² in a scan of the panel layouts).

**The material module (the seam of #477).** `DisplayViewGpuMaterialModule` is WGSL that defines `fn material_at(p: vec2<f32>) -> u32` and `var<private> material_uncertain: bool`, with its buffers in `@group(1)`; it must flag a point within its bound of a material boundary, the point carrying ≤ 2E + 10⁻¹⁴ relative error. The display pixel of a flagged point is **recomputed on the host** with the reference (a one-pixel region render of `renderDisplayView`, which is byte-identical to the whole view's pixel: tested), so flagged pixels are exact. `display-view-chart-material-module.ts` supplies the module for the eight 2.0 chart presets filling the frame by reusing the chart kernel's own classification (`wgsl-chart-kernel.ts`, its `material` function renamed and bound at group 1) with its SAFETY factor doubled from 4 to 8 for the second rounding of the point. Everything else the chart kernels classify goes through the composite material module (#491, below). Caller scene functions (`material-function`, `reflectance-function`, `radiance-function`) stay refused by `supports()` (`unsupported-on-backend`): describe such a scene as `material-layers`.

**The composite material module (#491).** `src/gpu/display-view-composite-material-module.ts` builds `material_at` from the composite chart kernel of #477 ("Composite charts, chart elements and mask layers" above): its `material()` with the bound arithmetic, double-float32, the cos polynomial, every element kind and the mask layers, renamed (`flagged` → `material_uncertain`) and with the scene's packed records (`packChartScene`) at `@group(1)`. It serves composite charts, every 2.3 element as a plain chart, the sine-profile Siemens star, fixed-size charts (`chartSize`; the eight 2.0 presets too) and declared `material-layers` scenes. `simulateCapture`, `simulateDisplayView`, `prepareDisplayView` and `createPlanarSceneRadianceProvider` now take a `material-layers` scene directly as their `scene`; it is evaluated as its `callerScene`, so every CPU result, digest and byte is that of passing the `callerScene` (tested), and the display view's GPU request names it `material-layers`, which `supports()` accepts.

**The image-plane module (#581).** `src/gpu/display-view-image-material-module.ts` renders an image-plane print ([Image-plane scene](IMAGE_PLANE.md)) in the Speed path. Since #581 the kernel reads a query point's channel signal through `scene_value(p, c)`. A material module gets the adapter `material_signal(material_at(p), c)`, the material's signal integrated from its spectrum in the kernel (2.21.0, above), recomputed when the material or channel changes. The image-plane module defines `scene_value` itself (its surround's three channel signals, integrated from the surround's spectrum like a pixel's, are the kernel's binding 3):

- **The pixel signals.** The host integrates each pixel's three channel signals S_j,c from its reconstructed spectrum (its cell's eight node spectra blended at each spectral node, then the paper, times the white, against each channel's response) in float64 and rounds them to float32, 4 MiB of rows at a time; the host keeps none of them (about 4 MiB of host memory for a 24 MP photo instead of 288 MB per kept scene).
  - **When they fit one storage binding**, they are uploaded once per scene and kept on the device.
  - **Otherwise the module bands them** (`DisplayViewGpuMaterialModule.band` and `bandRows`): each band of display rows binds only the pixel rows its native site rows reach, and the renderer caps a band's rows so they fit; each render builds its bands' rows again, copying the rows a band shares with the previous one from that band's buffer on the device (kept until the next band), so each row is built once per render. The shader indexes rows from the band's first (`photo.row0`), so the values, and every byte of the render, are those of the whole upload (tested).
- **The point.** The module recovers the exact query point as the composite module does (`LATTICE_POINT_WGSL`, now shared). It forms the print-local point and the pixel coordinates in double-float32 and decides the print's edge in the composite kernel's bound arithmetic. Points within their bound of the edge are flagged.
- **The weights.** Per axis it splits X − ½ exactly into an integer part and a fraction f. It rounds the smaller of f and 1 − f once and forms the other as 1 minus it, so each weight carries at most 2E relative error.
- **Moved weight.** The point's own error δ moves weight between neighbors. δ is 4·(2⁻⁴⁰·(|X| + 1)) pixels plus four times the reference's 10⁻¹⁴ slack in pixels. A value whose possible move (δx + δy)·2·max S exceeds E times itself is flagged and recomputed on the host. All S are non-negative.
- **The bound.** An unflagged value carries a relative error only, ten roundings beyond the table lookup's one (S 1, weights 2 + 2, two products and two sums 4, the flag's budget 1). The expected value's bound is γ_74 instead of γ_64, and the variance's γ_100 instead of γ_80, doubled (`extraSiteRoundings`).
- **Nearest.** `nearest` reads the pixel under the point and flags a point within its bound of a pixel edge (`bfloor`).
- **Device probe.** The module's double-float32 is the composite kernel's, so its device probe gates the module: a device that fails it renders photos on the CPU, labeled `unsupported-on-backend`.
- **Self-check.** The module checks itself on a device's first photo (`runImagePlaneConformance`: the Speed kernel, then the Quality passes with the four-spot filter and radius-1 kernels at three nodes), not among the renderer's cases, so a photo check never keeps that device's charts off the GPU. A failure refuses photos on that device (`unsupported-on-backend`).
- **Loading.** The module is loaded only after `prepareImagePlaneScenes()`, in its own chunk.
- **The Quality path.** A photo request that needs the Quality passes (diffraction, `lens.defocus`, AHD) takes the print's own passes 1 and 2 ([below](#image-plane-prints-in-the-quality-passes-581)). The measured agreement is in [Image-plane scene, On the GPU](IMAGE_PLANE.md#on-the-gpu).

- *The exact query point.* The Speed kernel hands the module p = fl(fl(x + c)·g) (two float32 roundings), but the composite kernel's chirp decisions (the zone plate's phase, the stars' sector cross products) need the point to about 2⁻⁴⁰; fed p directly, a 64-cycle sine star would flag most of its points. The module therefore recovers the lattice point: p / g_hi lies within 6E·|x + c| of the exact x + c, the offset constant c_o (uploaded hi + lo) whose lattice puts the quotient nearest an integer gives the site x, and the point is re-formed in double-float32 as (x + c_o)·g from the exact integer and the float64 constants (hi + lo). The host admits the lattice only when this is unambiguous: the reference's own query points match the model (x + c)·g at the frame's four corners within 2⁻⁴⁸·(|p| + 1), and the distinct fractional parts of the offsets (mod one site) lie more than four recovery tolerances apart, the tolerance being 8E·max|x + c| + 2⁻¹² (0.0005 sites for the 604-site test frame, 0.006 for 6000 sites, against the 2 × 2 box's quarter-site spacing); a point whose residual exceeds the tolerance on the device is flagged. A fixed-size chart's chart-local point (u·m/h) is a further double-float32 product, and its rectangle |cu| ≤ 1, |cv| ≤ aspect is tested in bound arithmetic (a point within its bound of the edge flags; outside it the material is the surround, the table's last entry).
- *The point error (the Speed kernel's contract held, no bound re-derived).* The recovered point differs from the exact lattice value by about 2⁻⁴⁶ relative (two double-float32 operations, the split constants' 2⁻⁴⁸), inside the composite kernel's own 2⁻⁴⁰ allowance per point (DW in `bd`). The reference's float64 query point differs from the exact lattice value by its own float64 rounding: measured at most 5.6·10⁻¹⁶ absolute (2⁻⁵⁰·⁷) over every site and offset of the frame-filling and fixed-size fixtures, inside the composite kernel's 10⁻¹⁴ slack for the reference's rounding. So the composite kernel's bounds and SAFETY factor (4) apply unchanged, the module's point error (≤ 2⁻⁴⁶ relative plus 6·10⁻¹⁶) is far inside the Speed kernel's contract (≤ 2E + 10⁻¹⁴), and no Speed bound term changes. Evidence: on the emulation, the module on the kernel's float32 points against the composite kernel on the reference's own points split hi + lo, at 197 544 query points (every site and offset in the label layer, the zone plate and the bar star, and a stride over the frame): every unflagged material equals the float64 reference, the flags are identical at every point (0 differences; 0.69 % flagged), and the unflagged materials of the two agree.
- *Records and probe.* The scene's records are uploaded once per renderer (one prepared view's device) and reused by every part of the view; the four most recent scenes are kept and released with the prepared view (`DisplayViewGpuRenderer.dispose`, new). The composite kernel's device probe (`CHART_COMPOSITE_PROBE_WGSL`, now `probeChartCompositeDevice`) runs once per renderer before the first composite render; a device that fails it throws `unsupported-on-backend` from `render`, which the session turns into a CPU render labelled `unsupported-on-backend` (or an error under `"require"`), and the probe is retried on the next render. The preset module still serves the eight 2.0 presets on such a device (tested). The module's lookup costs more than the preset module's: the double-float32 recovery per query point and the composite kernel's bound arithmetic.
- *Flagged display pixels.* A display pixel is recomputed on the host when any of its query points (36 for a 2.96 × 2.96 footprint with the 2 × 2 box, about 100 per display pixel with the edges) is flagged, so the per-pixel fraction is far above #477's per-point fraction where points flag densely: the 1024-level elements (zone plate, grey ramp; about 0.5 % of points each) and lattices that meet a boundary exactly (a centred bar star's diagonals; the label's glyph levels, see below). Every flagged pixel costs one CPU pixel and is then exact.
- *A finding: lattice points exactly on mask edges.* In the frame-filling fixture the label layer's 320 × 80 mask spans 0.44 frame units over 600 sites, so the mask's y = (v1 − v)·scaleY meets integer and third-unit glyph coordinates exactly on some site rows (3.8 % of the label's points, against 0.012 % for #477's view-centre points, which never meet them exactly); the winding test flags every point within its bound of an edge's level, so half the label's display pixels are recomputed there. In the fixed-size placement of the app's request shape (0.042 m chart at 0.63 m) no point meets them and the label flags nothing. It is a cost, not an error.

**The noise draw: on the host, bit for bit.** Three choices were open: draw z on the GPU from the integer streams, draw on the host, or draw on the host and finish on the GPU. The CPU's draw is `samplePortableStandardNormal` (`createDeterministicUniformStream(deriveNativeSiteStreamSeedUint32(seed, index, 33))`, two uniforms, the portable float64 log and cos in double-double), so a float32 Box–Muller on the GPU reproduces the uniforms' bits but not the normal's; only a host draw is bit-identical, and the kernel therefore ends at the moments. The host then runs the reference's own finishing per display pixel (`finishDisplayViewPixel`: the output quantization term `quantizationVariance`, the three draws, the Cholesky factor, `clipCentre`, `encodeSrgbComponentPortable` and the rounding, the same float64 functions in the same order), so the only approximation in a sample is the moments' bound; a sample equals the CPU's except where that bounded difference crosses a code boundary (at most one code; 0–3 of 82 215 samples in the small fixtures, 35 of 8.2 million at 2028 × 1352). **Measured cost of the host finishing** (Node 24, this 4-vCPU host, one thread, 2.74 million display pixels): 1.22 µs per display pixel, 3.36 s for a whole 2028 × 1352 view (of which the three draws 0.28 µs, the three encodes 0.22 µs and the quantization term's three `portablePow` evaluations 0.56 µs per pixel; `clipCentre`'s bisection, 4.2 µs, runs only where the noise reaches 0 or 1). That is a floor on the whole-view time of this design whatever the GPU takes (the CPU reference takes 39 s here); it parallelizes over the app's parts and workers, and two reductions are open without touching the draw: the quantization term on the GPU (its pow has the 2^-17 bound) and the encode on the GPU with the drawn z uploaded (12 bytes per pixel), leaving 0.28 µs per pixel on the host. Neither is built.

**Error bounds (a priori; `relative-to-reference` for the expected value, reported in `execution.errorBound`; the variance's in `varianceBound`).** E = 2⁻²³, one WGSL rounding of + − × in either direction (the table fixes no rounding direction; #471, #487), γ_k = k·E/(1 − k·E); division 2.5 ULP, sqrt ≤ 4.5 ULP, exp 3 + 2|x| ULP; no trigonometric built-in is used. Every bound is doubled (`MARGIN`).

| Step | Form | Roundings or bound |
| --- | --- | --- |
| Site signal, offset sum, dark | non-negative products and sums | 2.21.0: per signal 2 operand roundings, its products and at most 15 + 16 additions in blocks of 16 nodes (≤ 256 nodes), then 4 products, 3 sums, dark 1: within the unchanged site budget of 64E (`DISPLAY_VIEW_SITE_RELATIVE_U`) |
| #581 image-plane module: the value at a point | non-negative products and sums | 10 more: S 1, weights 2 + 2, products and sums 4, the moved-weight flag 1 (γ_74 on the mean, γ_100 on the variance, for that module only) |
| Readout mean k·e; variance k²e + c₀; κ₃ | non-negative | γ_11; γ_13; γ_13 |
| Demosaic Σ w·mean over ≤ 4 taps (weights exact) | non-negative | γ_15 (variance: squares, γ_17) |
| White balance g·m, highlight clip, matrix Σ r·m | g, r rounded once | γ_17; γ_21 (variance γ_25) |
| Weights a_j = (w_x/s_x)·(w_y/s_y) (host float64, two roundings) and the sum over ≤ 36 real pixels | non-negative | γ_3 + 35 additions |
| **Expected value, relative** | all of the above | γ_64 + 2⁻⁴⁰ (the reference's own float64 chains); + 256E with Reinhard (below) |
| **Variance, relative** | the squared chains | γ_80 + 2⁻⁴⁰; + 512E with Reinhard |
| φ(z) = 0.3989·exp(−z²/2), |z| ≤ 8.5 | z carries 8E (subtraction, sqrt 4.5 ULP, division 2.5 ULP) | |Δφ| ≤ φ·(16E·z² + 76E) ≤ 31E absolute (its maximum over z) |
| Q(z) by Abramowitz–Stegun 26.2.17 (t = 1/(1 + 0.2316x), a degree-5 Horner polynomial) | t: 13.5E relative; polynomial: |p′| ≤ 14.7 on [0, 1], evaluation 40E, coefficients 6E | |ΔQ| ≤ 147E absolute; Φ = 1 − Q the same |
| Clipped mean m − s·δ, δ = φ − zQ | |Δδ| ≤ 31E + 8.5·147E + 8.5·8E + 2E | ≤ 1 350E in units of s: **CLIP_MEAN_U = 1 400** (in units of E) per clip side (the reference's inputs enter through the 1-Lipschitz clip and |∂/∂s| ≤ 8.9, folded into the relative term) |
| Clipped variance v·(Φ − zφ + z²Q − δ²) | 148E + 267E + 72.25·147E + 2·8E·72.25 + 2·8.9·1 350E | ≤ 36 000E in units of v: **CLIP_VARIANCE_U = 36 000** per clip side |
| Two-sided clip to [0, 1] | both sides | 2 × the above |
| Reinhard quadrature (64 nodes, weights ∝ φ(z_k)) | weight error w_k(16E·z_k² + 80E), Σ w_k z_k² = 1 (the second moment of Z); 64-term sums γ_66 | ≤ 176E relative on the mean, declared 256E; 512E on the variance; the shift ε < 10⁻¹² |
| Host finishing: the output quantization term Σ_j (w_j/A)²·q(m), q(m) = s(e)²·Δ²/12 (`quantizationVariance`), evaluated at the GPU's mean (#496) | dq/dm = 2·s′(e)·Δ²/12 with s′ ≤ 3.02 on [0, 1] (0 on the linear segment); q non-decreasing with a jump ≤ 2.1·10⁻⁴·Δ²/12 at the segment join (m = 0.0031308) | Σ(w/A)²·(6.04·Δm + jump)·Δ²/12 per display pixel, Δm = the mean's bound of the largest component (relative·\|m\| + the pixel's absolute term; the jump only when the interval holds the join), doubled, added to the pixel's absolute variance term (`displayViewSpeedQuantizationBound`; the Quality host's term, #479). Before #496 it was covered only by the γ_80 relative term |
| Flagged material lookups | — | recomputed on the host: exact |

The clip terms are absolute in units of each clipped quantity's standard deviation (or variance) and propagate through weights that sum to one (demosaic, footprint), the gains and the matrix's absolute row sums; the kernel evaluates them per display pixel from its own float32 values as it goes (a fixed formula, as the luminance tone curves' running bound) and the host reports the largest term as `errorBound.absolute` and `varianceBound.absolute`, keeping every pixel's term for the tests (`expectedValueAbsoluteBound`, `varianceAbsoluteBound`). A pixel whose clips never act has a zero absolute term and only the relative bound: 2·γ_64 ≈ 1.5 × 10⁻⁵ of the value, about 0.004 of an 8-bit code at mid grey.

**Measured agreement with the CPU reference**, per display pixel, every component inside its bound (the bound's largest fraction used: 4.1 % for the expected value, 3.9 % for the variance; 4.0 % before #496 added the quantization term, which changed no value). ΔE2000 is between the GPU's and the CPU's expected values (linear sRGB clipped to [0, 1] → XYZ by the capture colour model → CIELAB, D65); σ units are |ΔE|/σ_cpu per component.

| Fixture (600 × 400 frame of 6 µm sites, 2 × 2 box, 203 × 135 view, 82 215 components) | ΔE2000 max / RMS | σ units max / RMS | σ relative max | Samples differing (≤ 1 code) | Flagged, recomputed |
| --- | --- | --- | --- | --- | --- |
| Slanted edge, ISO 100 | 2.3e-5 / 9.4e-6 | 7.0e-5 / 1.7e-5 | 2.9e-7 | 1 | 0 |
| Siemens star (bar), ISO 100 | 4.2e-5 / — | 9.2e-5 / — | 2.7e-6 | 1 | 597 (points exactly on the diagonals) |
| Step wedge, ISO 100 | 3.8e-5 / — | 8.2e-5 / — | 3.0e-7 | 0 | 0 |
| Checkerboard, ISO 100 | 4.3e-5 / — | 9.3e-5 / — | 4.0e-7 | 2 | 0 |
| Spectral patches, ISO 100 | 3.9e-5 / — | 9.1e-5 / — | 3.0e-7 | 0 | 0 |
| Step wedge at the white clip (1/15 s) | 3.6e-5 / — | 3.3e-4 / — | 2.9e-4 | 0 | 0 |
| Step wedge at ISO 6400 | 3.8e-5 / — | 1.0e-5 / — | 3.0e-7 | 1 | 0 |
| Step wedge, Reinhard | 2.6e-5 / — | 2.5e-4 / — | 5.9e-6 | 3 | 0 |
| Uniform 18 % grey | 2.2e-5 / — | 3.7e-5 / — | 3.0e-7 | 1 | 0 |
| **Checkerboard, 24 MP 6 µm 6000 × 4000, 2028 × 1352 (8.2 million components)** | 4.2e-5 / 1.0e-5 | 1.0e-4 / 1.9e-5 | 3.4e-7 | 35 | 0 |

The same numbers come from the float32 JavaScript emulation of the kernel (`test/helpers/fake-webgpu-display-view.ts`, every CI run: `test/display-view-speed-gpu.test.ts`, and the 2028 × 1352 fixture in `test/display-view-speed-gpu-full.test.ts`, 63 s on this host of which 39 s is the CPU reference) and from SwiftShader (`test/webgpu/display-view.webgpu.ts`, Chromium 141 headless, the small fixtures: the largest differences agree with the emulation's to the digits shown, so the emulation describes the device). On SwiftShader the browser's own CPU reference equals Node's bytes except on the Siemens star (81 of 82 215 samples: Chromium's `Math.atan2` in the star's geometry, docs/DISPLAY_VIEW.md "Same bytes in every engine"), so the device is compared with the reference of its own realm. The run-time self-check case of the renderer (`display-view:speed:checkerboard-13x9`, a 38 × 26 checkerboard with light squares at the white clip against `renderDisplayView` within the bounds) passes on the emulation and on SwiftShader.

**Measured agreement with the composite material module (#491)**, per display pixel against the CPU reference, on the float32 emulation (`test/display-view-composite-gpu.test.ts`) and on SwiftShader (`test/webgpu/display-view.webgpu.ts`, Chromium 141 headless, compared with the browser realm's reference). The two agree to every digit shown, flagged counts included. Every component lies inside its a-priori bound, every sample within one code, and every case passes the #480 acceptance thresholds with the harness's own reduction (`scripts/lib/display-view-acceptance.mjs`): 100 % of pixels within ΔE2000 1, none above 2.3, none beyond 1 σ. The composite fixture is #477's (`test/helpers/chart-composite-fixtures.ts`): one element of every kind as an application lays out a test chart, under a label layer of polygons and annuli, declared as `material-layers`; the frame is 600 × 400 sites of 6 µm with the 2 × 2 box, at 203 × 135.

| Fixture | ΔE2000 max / RMS | σ units max / RMS | σ relative max | Bound used (mean / variance) | Samples differing (≤ 1 code) | Flagged display pixels, recomputed |
| --- | --- | --- | --- | --- | --- | --- |
| Composite under the label layer, frame-filling | 4.7e-5 / 9.8e-6 | 3.7e-4 / 2.1e-5 | 2.5e-6 | 4.6 % / 3.0 % | 1 | 1 158 (4.2 %) |
| The same, fixed-size chart (0.042 m at 0.63 m) with surround | 2.3e-5 / 7.9e-6 | 6.9e-5 / 8.8e-6 | 7.3e-7 | 2.7 % / 3.3 % | 0 | 28 (0.10 %) |
| The same, Reinhard at the white clip (emulation) | 4.0e-5 / 5.2e-6 | 4.3e-4 / 7.0e-5 | 1.5e-2 | 0.5 % / 29 % | 3 | 1 158 (4.2 %) |
| Zone plate, 200 cycles per picture height | 2.9e-5 / 7.1e-6 | 5.7e-5 / 1.1e-5 | 4.2e-4 | 2.8 % / 3.1 % | 2 | 6 174 (22.5 %) |
| Siemens star, sine, 64 cycles | 3.8e-5 / 8.4e-6 | 2.7e-4 / 1.3e-5 | 1.3e-6 | 3.4 % / 3.1 % | 1 | 565 (2.1 %) |
| Dead leaves (emulation) | 4.2e-5 / 1.0e-5 | 7.6e-5 / 1.5e-5 | 5.7e-7 | 4.1 % / 4.0 % | 3 | 140 (0.5 %) |
| Bar groups with numerals (emulation) | 4.3e-5 / 2.1e-5 | 9.0e-5 / 3.5e-5 | 3.1e-7 | 4.1 % / 2.9 % | 1 | 565 (2.1 %) |
| Checkerboard, fixed-size chart (a 2.0 preset through the composite module; emulation) | 2.6e-5 / 7.9e-6 | 6.9e-5 / 8.8e-6 | 3.2e-7 | 2.5 % / 3.3 % | 0 | 0 |
| **The app's request shape, 24 MP 6 µm 6000 × 4000 at 2028 × 1352: its composite chart (`APP_CHART`) under the label layer as `material-layers`, 0.42 m at 0.63 m (emulation; 2.74 million pixels)** | 4.2e-5 / 2.3e-5 | 6.3e-5 / — | 4.8e-5 | 5.6 % / 4.2 % | 87 | 36 055 (1.3 %) |

Flagged display pixels per element of the frame-filling composite (fraction of each element's display pixels; the same on both): zone plate 59 %, label layer 51 %, grey ramp 16 %, Siemens star (bar) 9.3 %, bar groups 3.8 %, Siemens star (sine) 2.9 %, hyperbolic wedge 1.6 %, dead leaves 1.1 %, the line-grid background 0.02 %, and 0 for `uniform`, `step-wedge`, `point-grid`, `slanted-squares`, `fiducial`, `checkerboard`, `slanted-edge`, `patches` and `line-grid`. In the fixed-size placement only the bar star flags (1.0 %). The per-point fraction is #477's (0.69 % of 197 544 points in the recovery check); a display pixel is flagged when any of its points is. The browser realm's CPU reference differed from Node's in 6 of 82 215 samples of the frame-filling composite (0 in the other cases); the GPU is compared with the browser realm's reference, and where those 6 lie was not examined (#471 found the realms' `Math.atan2` differ in the last bit). SwiftShader took 7–83 s per 203 × 135 view, most of it the host recomputation of flagged pixels in the browser; that says nothing about a GPU.

**Timing: unmeasured.** No GPU time is recorded for this kernel; SwiftShader took 1.3–1.6 s per 203 × 135 view (27 405 display pixels, including upload, readback and the host finishing) on this loaded host, which says nothing about a GPU. The gain over the CPU pool is TBD-TIMING until a hardware timing run of this kernel is recorded in the [hardware record](WEBGPU_DEVICES.md) (#475):

```sh
PHOTIVRA_WEBGPU_REQUIRED=1 npm run test:webgpu -- test/webgpu/display-view.webgpu.ts   # SwiftShader: accuracy, and the software-adapter times in the report
npm run test:webgpu:hardware -- test/webgpu/display-view.webgpu.ts                      # the same on a hardware adapter (refuses SwiftShader); `softwareAdapterMilliseconds` is then the device's time
```

The report line `[test:webgpu display-view]` lists the adapter, per fixture the agreement and the wall-clock milliseconds of one render (upload, dispatch, readback and host finishing); a whole 2028 × 1352 view is `test/display-view-speed-gpu-full.test.ts` on the emulation and, for the device, the same request through `displayViewSpeed` of `test/webgpu/page-runner.ts` (not in the suite: 24 MP in the browser also runs the CPU reference there). Record the numbers as a row of the [hardware record](WEBGPU_DEVICES.md), with the GPU model, driver, browser and OS, and post them on #475.

**What remains for the integration.** The app's request (Photivra/apps#126) must give its scene as `material-layers` (its label as a shape-mask layer over its composite chart) rather than as a caller material function, which `supports()` keeps refusing; the engine side is in place (#491). The acceptance script `scripts/accept-display-view-gpu.mjs` renders the app's request as `material-layers` on the GPU with `--gpu` ([Preview acceptance](#preview-acceptance)); for #491 its reduction and thresholds were applied in the tests, on the emulation and SwiftShader and, opt-in, at the app's size. The host recomputation of flagged display pixels costs one CPU pixel each (597 of 27 405 on the bar star's diagonals; 1 158 of 27 405, 4.2 %, in the frame-filling composite with its label, 28 in the fixed-size placement), and it is the largest share of the module's cost where a 1024-level element or an exactly met boundary fills the view; reducing it (recomputing only the flagged sites rather than the pixel, or a CPU worker pool for them) is open. The host finishing's 1.2 µs per display pixel and its two possible reductions above; views coarser than the exact area mean (the stratified estimator) and footprints of more than 6 real pixels per axis refuse with `unsupported-on-backend`; AHD, diffraction and the four-spot filter are the Quality kernels ([below](#display-view-quality-on-the-gpu), #479); hardware timing and the probe on hardware devices are #475.

### Coupled rendering steps (#593, #601)

The luminance tone curves, `highlightMode: "reconstruct"` and `gamutHandling: "desaturate-to-luminance"` run in the Speed kernel
and the Quality pixel pass from one WGSL module (`src/gpu/wgsl-display-view-coupled.ts`, loaded on demand for a view that asks
for them; other views take a stub), the float32 form of the CPU's conditioning on luminance and 3-D Gauss–Hermite rule
([DISPLAY_VIEW.md](DISPLAY_VIEW.md#coupled-rendering-593-601)) with the request's fast or full rule (`fast: false` with an
explicit `gpu` runs the full rules). Its constants follow each kernel's aux table, so no binding is added.

**Bounds (first order, as the kernels' others).** Per node: the clipped-normal terms (`CLIP_MEAN_U`·r·σ, `CLIP_VARIANCE_U`·r²·σ²),
the conditional variance's cancellation (0.8·r·√(32·E·Σ_kk)), the node position through the slope, the tone ratio's relative
error η (log2 and exp2 per the WGSL accuracy table, as the image-kernel accelerator's tone analysis), and for the chain the
developed pixel's rounding (white balance and blend 8E of the largest channel, matrix 3E per term, η, desaturation 8E) and the
node point's rounding, both through the node's own slopes (the chain is continuous, so a kink taken on the other side moves the
output by at most slope × input error); then one E per node of the sums; the inputs' bounds through |slopes| (means) and
0.8·|slopes|·√δ (variances). A threshold decision the reference takes (the blend's reach, a component reaching 1 with the
desaturation, the fast rule's range, a node at L = 0 where the ratio jumps) that the float32 values cannot settle flags the
display pixel, which the host recomputes with the reference.

**Measured.** Float32 emulation (`test/display-view-speed-gpu.test.ts`, `test/display-view-coupled-gpu.test.ts`) and a hardware
adapter (Apple, Metal 3, Chrome headless, `PHOTIVRA_WEBGPU_ADAPTER=hardware npm run test:webgpu -- test/webgpu/display-view.webgpu.ts`):
every component inside its bound, at most one code; largest error 0.3–4.6 % of the bound on the device (Speed), 0.6 % (Quality
emulation). `highlightMode: "reconstruct-neighbors"` (#602) runs in both kernels since 2.23.0 ([below](#neighbor-highlight-reconstruction-605)).

**SwiftShader (2.22.0).** The kernels compile on SwiftShader too since the luminance branches read the colour matrix rows from one local array (`mm`) instead of calling `m_of` (a `switch`) inside their nested loops, which made SwiftShader's compiler end the GPU process after about 44 s; the values are the same. The SwiftShader suite runs every coupled case.

### Neighbor highlight reconstruction (#605)

`highlightMode: "reconstruct-neighbors"` runs in the Speed kernel and the Quality pixel pass, fast (the ring's mean ratios) and full
(their harmonic fill), as part of the coupled chain: the chain's highlight step becomes the rebuild of
`src/color/neighbor-highlight-reconstruction.ts` (`rebuildClippedPixel`; WGSL `nb_rebuild` in `src/gpu/wgsl-display-view-neighbors.ts`,
loaded on demand with the coupled steps), and the blend's reach threshold becomes the rebuild's 0.98 of white.

**Where the ratios are found: on the host, uploaded.** Each real pixel's ratios ρ come from the reference's own float64 code
(`DisplayViewCoupledRendering.ratioAt`: the noise-free channels, the 8-connected clipped regions widened by the margin, the ring
mean or its SOR fill), for exactly the real pixels whose chain needs them, so every region decision is the reference's and ρ
carries one float32 rounding. They travel in the band's flag buffer after its three flag words per pixel (an offset word per
display pixel and 3 floats per real pixel of its footprint): no binding is added, so the kernels keep within the 8 storage
buffers per stage (the Speed kernel with the composite module already uses all 8). Each band runs twice: the first dispatch skips
the chain where a ratio is missing and flags the pixel (bit 7); the host computes those pixels' ratios and dispatches the band
again with every other pixel marked to return at once (their first results stay in the output buffer). Since 2.23.0 a region's
members are taken in raster order (`display-view-rendering.ts`), so its ratios do not depend on which pixel reached it first: the
host's band order, a region render and the whole view give the same bits. A region above the search cap (65,536 pixels fast,
262,144 full) is solved per tile of 256 × 256 (fast) or 512 × 512 (full) pixels, its part in each tile on its own, which does
not depend on that order either.

**The alternative, measured: the harmonic fill on the device.** The issue asked whether to upload the ratios or compute them on the
GPU (for example the full method's Laplace fill by Jacobi or red-black iterations). `test/webgpu/neighbor-fill.timing.ts` solves
the same Dirichlet problem for a clipped square region in a smoothly colored field: the reference's full method on the host
(float64 SOR, ω = 1.8, to a change below 10⁻⁹) against red-black SOR in float32 on the device (one dispatch per color, the
optimal ω = 2/(1 + sin(π/(m + 1))) for the m × m unknown square, from the fast method's ring mean), reading back the largest
difference from the reference at checkpoints (Apple M5 Pro, Chromium 153 headless, November 11, 2026; host times in the same page):

| Region (unknown pixels) | Host: fast / full with 2.22.0's ω = 1.8 (sweeps) | Device, hardware (Apple, Metal 3): sweeps and ms to < 10⁻⁵, floor | Device, SwiftShader: ms to < 10⁻⁵, floor |
| --- | --- | --- | --- |
| 20 × 20 (400) | 0.3 / 2.8 ms (91) | 50 sweeps, 2.4 ms; 1.4–1.7 × 10⁻⁷ | 8 ms; 1.3–1.7 × 10⁻⁷ |
| 68 × 68 (4,624) | 0.7 / 70 ms (673) | 200 sweeps, 5.7 ms; 4.9–7.7 × 10⁻⁷ | 37 ms; 5.1–8.1 × 10⁻⁷ |
| 260 × 260 (67,600) | 5.1 / 4,860 ms (5,728) | 400 sweeps, 20.5 ms; 2.6–2.8 × 10⁻⁶ | 722 ms; 2.3–2.6 × 10⁻⁶ |

What the numbers decide:

- **The device fill is far faster for large regions** (20 ms against 4.9 s at 67,600 pixels; most of the host's time was its
  fixed ω = 1.8, which needs 5,728 sweeps where the optimal ω needs about 400), and about even for small ones once a dispatch's
  fixed cost is counted. Since 2.23.0 the host uses the optimal ω of each region's bounding rectangle
  (`neighborHighlightOmega`; `test/neighbor-highlight-sor.test.ts`: 250 sweeps instead of 673 at 68 × 68 and 458 instead of
  1,893 at 132 × 132, 3.2–4.9× faster, and 35–76× closer to the converged fill at the same 10⁻⁹ tolerance).
- **It does not reach the reference's values in float32**: its error stops at a floor that grows with the region (1.5 × 10⁻⁷ at
  400 pixels, 2.7 × 10⁻⁶ at 67,600: the Laplacian's condition number grows with the region's size squared), and that floor is a
  measurement, not an a-priori bound; a bound would need the solver's residual and the discrete Laplacian's inverse norm per region.
- **The rest of the method is not local**: the 8-connected regions (a labeling pass), the ring mean per region (a reduction per
  label) and the regions' sizes against the cap would need further passes, none of them built or measured here.
- **So the ratios are uploaded**: every region decision and every ratio is the reference's, with one rounding, which keeps the
  bound a priori and the region cap's behavior identical. The host's own time is the reference's (the CPU path pays the same), and
  in the measured views below it is small: 35–47 ms for 270,000 real pixels' ratios, fast or full, against 0.4–73 s for the GPU
  render. A device fill is not built (owner decision, 2026-11-11: no a-priori float32 bound); these measurements are kept for a
  later look at large regions in full mode.

**Bounds (first order, as the coupled steps').** The rebuild's own roundings are at most 10E of the largest rebuilt channel (the
products u = c·g, the two sums over the kept channels, the quotient's 2.5E, the product s·ρ, and ρ's upload rounding through
∂b/∂ρ, at most E·|b|; 6E where every channel is clipped); they enter the chain where the blend's 8E of the largest channel did,
and the node's slopes carry the node point's rounding as before. The rebuild is continuous except where a channel crosses the
threshold (kept or rebuilt): a node within its rounding bound, the channel mean's bound and 5·Σ√δ (the variance bounds, beyond
the largest Gauss–Hermite node) of 0.98 flags the display pixel, which the host recomputes with the reference.

**Measured.** The emulation's and the devices' cases (`test/display-view-neighbors-gpu*.test.ts` on the float32 emulation,
`test/webgpu/display-view-neighbors.webgpu.ts` on SwiftShader and on hardware with `PHOTIVRA_WEBGPU_ADAPTER=hardware`): the
spectral patches over the white clip (1/30 s at ISO 100: six clipped regions, none above the cap), 600 × 400 real pixels of 6 µm
at 203 × 135; the Speed fixtures' sensor, and for Quality the circular-aperture diffraction, the four-spot filter and AHD. The
emulation takes a 40 × 30 part (four clipped regions) for the full rule (its 4,096 nodes per real pixel are slow to emulate).
Every component inside its bound in every run; November 11, 2026, Apple M5 Pro, Chromium 153 headless:

| Case | Bound used (expected / variance): emulation, SwiftShader, hardware | Samples differing (≤ 1 code) | Flagged (recomputed) | Pixels given ratios; host ms |
| --- | --- | --- | --- | --- |
| Speed, fast | 3.6 % / 3.2 %; 3.6 % / 3.2 %; 3.6 % / 3.0 % | 0 | 0 | 17,482 (272,272 real pixels); 28–35 ms |
| Speed, full | 2.8 % / 2.6 % (part); 3.6 % / 3.2 %; 3.6 % / 3.0 % | 0 | 123 (14 in the part) | 17,482; 28–42 ms |
| Quality, fast | 0.50 % / 0.35 %; 0.50 % / 0.35 %; 0.50 % / 0.32 % | 2 | 7,704–7,747, nearly all AHD's choice (bit 5; 96 of 2,252 coupled flags in a 203 × 30 band) | 17,436; 29–47 ms |
| Quality, full | 0.49 % / 0.18 % (part); 0.49 % / 0.35 %; 0.49 % / 0.32 % | 0–2 | 8,082–8,125 (530 in the part) | 17,436; 30–36 ms |

ΔE2000 at most 5.3 × 10⁻⁵ (Speed) and 6.4 × 10⁻⁴ (Quality) against the reference. GPU render times on the hardware adapter:
Speed 0.37 s fast, 1.9 s full; Quality 8.5 s fast and 73 s full, of which the pixel pass is 84 ms and 275 ms and nearly all the
rest is the host's recomputation of AHD's flagged pixels (8.2 s and 72.8 s). That recomputation is the Quality kernels' existing
behavior with AHD, not the neighbor reconstruction's: on this scene about 28 % of the display pixels carry AHD's choice flag
(bit 5; [above](#display-view-quality-on-the-gpu)), and the coupled steps' own flags are 1–4 % of them. Each band runs two
dispatches (both passes once here: one band).

## Display view (Quality) on the GPU

The display view's Quality path (#479: the exact area mean with diffraction kernels, the anti-aliasing filter's spots, the AHD candidates; `docs/DISPLAY_VIEW.md`) has three WGSL kernels, `src/gpu/wgsl-display-view-quality-kernel.ts`, with their host side in `src/gpu/display-view-quality-gpu.ts`. They extend the Speed kernel: one renderer (`createDisplayViewGpuRenderer` in `src/gpu/display-view-gpu-renderer.ts`, id `photivra-display-view`, registered by the GPU session module; since 2.22.0 it imports the Quality host on demand, #594) runs the Speed kernel for the requests it covers and the Quality passes for everything else it supports (every engine chart and declared `material-layers` scene, through the material modules of #491; the identity or Reinhard tone curve, at most 64 query offsets; the exact area mean, footprints of at most 6 real pixels per axis, demosaic candidates within 3 sites with dyadic weights; and `lens.defocus` out of focus, for Speed and Quality requests: [below](#defocus-on-the-gpu-492)). One set of material modules serves both kernels per device, and `dispose()` releases the composite module's uploaded scene records. The float64 reference is `renderDisplayView` with `createDisplayViewExpectedSignal`.

**Three passes per band of display rows**, in float32:

1. **Lattice materials.** The reference groups the query offsets by their fractional shift (the 2 × 2 box with the four-spot filter: 16 offsets in four lattice groups) and evaluates each group's lattice point with the lattice formula (p + 0.5 + f_x − W/2)·g, −(q + 0.5 + f_y − H/2)·g. One invocation per lattice point of each group over the band's window classifies the material through the material module (`material_at`, the Speed seam: the 2.0 preset module, or #491's composite module for composite charts, the 2.3 elements, fixed-size charts and `material-layers` scenes) and stores it with the module's uncertainty flag in the top bit. The composite module recovers the exact lattice point from the kernel's float32 point using the request's query offsets and the scale of its query points; with diffraction the reference has no query points, so the host gives it the lattice groups as its offsets and the reference's lattice formula as its query points (`qualityMaterialSetup`, tested equal to `createDisplayViewExpectedSignal`'s formula), and the module's own checks (the model at the corners within 2⁻⁴⁸, the offsets' separation, at most 16 groups) apply unchanged. The constant 0.5 + f_x − W/2 is exact in float32 and the sum with the integer p is exact (checked by the host; a request whose offsets are not dyadic enough is refused), so the point carries two roundings as in Speed. Without diffraction the same pass classifies the offsets' query points (the lattice model is checked against the reference's `queryPoint` at the frame's corners, as Speed does).
2. **Site moments.** One invocation per native site of the band's window gathers the expected electrons Σ_t V_c(m_t, t) + dark_c over the taps t of every group, where V_c(m, t) = Σ_λ C_c(t, λ)·L_m(λ) is the tap's signal. 2.21.0: signals are integrated from the material spectrum per site. The host uploads the channel's per-node kernel values C_c(t, λ) = Σ_members w·A_c(λ)·K_λ(t) (the reference's `nodeKernels`; without diffraction the offset weight times A_c(λ)) and each material's spectrum L_m(λ), each rounded once; no per-material channel value is formed. The pass adds each tap's products into one partial per spectral node, then sums the node partials and the dark electrons in integer arithmetic (`src/gpu/wgsl-exact-sum.ts`: a 64-bit fixed-point sum, rounded once), so the bound below is unchanged. Diffraction at f/8 on 6 µm sites has radius 4, so the four groups of 2 × 2 members of the box with the four-spot filter give 4·(2·4 + 2)² = 400 taps per site (radius 5: 576), each of N products (N spectral nodes, at most 96 on the GPU). The pass then forms the readout moments (mean k·e, variance k²e + c₀, third cumulant k³e), the clip at the white level, and every quantity's running bound (below). It writes 8 floats per site: the three moments, their three bounds, a flag word and the electrons.
3. **Display pixels.** One invocation per display pixel reads the site moments of its footprint plus the demosaic reach (reflected at the raster's borders, as the reference) and runs the reference's per-real-pixel loop. #533: first, each real pixel's highlight decision from the site pass's clip bits (bits 1 and 2 of a site's flag word, set by the Speed kernel's rule with the site's running bounds), over the bilinear taps and every candidate entry, as the reference's sample reads them. Then: each candidate's camera-channel mean and full 3 × 3 covariance from its dense weights over the 7 × 7 window (AHD's two directional candidates; one bilinear candidate otherwise), white balance and the highlight clip, the colour matrix with the channel covariance, the tone curve and the clip to [0, 1] with the skewness term, the candidates' average, the Stein covariance with the closed-form B_c, the independent residual aᵀCa, AHD's choice variance ¼·Var(H − V) at the last candidate's slopes. It writes the Speed kernel's 11 floats per display pixel plus three flag words: the flags, then the 36-bit mask of saturated real pixels (#533).

**No correction states (2.22.0).** From #479 to 2.21 the pixel pass also added the AHD low-signal correction, interpolated in a table of states the host computed and uploaded (with a grid-key bitmap and a redispatch for missing states). 2.22.0 removed the correction on every path ([AHD at low signal](DISPLAY_VIEW.md#ahd-at-low-signal)); the pixel pass binds no state table or bitmap, and its flag bits 4, 8 and 16 are unused.

**Flags and host recomputation.** A display pixel is recomputed with the reference (a region render of the run of flagged pixels it belongs to along its row, byte-identical to the whole view's pixels; tested with the Quality options) when a site it read had an uncertain lattice material whose possible effect exceeds 2⁻¹⁰ of the site's electrons (`DISPLAY_VIEW_QUALITY_UNCERTAINTY_LIMIT`: each flagged tap adds its value spread over the materials, host float64, to the site's bound; smaller uncertainties stay in the bound instead of flagging), when a site index fell outside the band's window, when AHD's choice could move the pixel (#457, below), or when an output is not finite. The flag word per pixel is reported (`pixelFlags`).

**Running bounds (a priori; `relative-to-reference` with the relative term 2·2⁻⁴⁰, the reference's own float64 rounding, and the absolute term the largest per-pixel bound; `varianceBound` likewise).** The Speed kernel bounds non-negative chains with γ_k and the clips with running terms. The Quality chains are not non-negative: AHD's kernels have taps of −¼ and −⅛, the colour matrix mixes signs, and the correlation terms r_i·r_j·Γ_i·Γ_j·C_ij can cancel. The kernel therefore carries every quantity after the site table as a pair (value, absolute bound) in float32, first order:

| Operation | Bound of the result |
| --- | --- |
| a + b, a − b | Δa + Δb + E·\|result\| |
| a·b | \|a\|·Δb + \|b\|·Δa + E·\|result\| |
| a·w, w an exact constant (a kernel weight, ½, an integer) | \|w\|·Δa + E·\|result\| |
| a host constant (a gain, a matrix entry, B_c) | E·\|constant\| |
| a / b | (Δa + \|result\|·Δb)/\|b\| + 2.5E·\|result\| |
| √v | min(Δv/(2√v), √Δv) + 4.5E·√v |
| Site electrons Σ_t V + dark (2.21.0: two operand roundings and a product per term, T − 1 additions per node partial, one rounding of the integer sum: at most T + 2.5) | (T + 3)·E·e + the uncertain taps' spread + the sub-normal terms' mass |
| Site electrons with the defocus disc (#492: blocked sum over cw × ch rectangles of G groups, per spectral node since 2.21.0) | (cw_max + ch_max + G + 3)·E·e + (1 + that)·the uncertain taps' spread + the sub-normal terms' mass ([derivation](#defocus-on-the-gpu-492)) |
| Readout mean k·e, variance k²e + c₀, κ₃ = k³e | k·Δe + 2E·mean; k²·Δe + 4E·variance; k³·Δe + 5E·κ₃ |
| Clipped normal min(Y, t), with g = min(Z, z), E[g] = −δ, ρ = Var(g), ρ_z = 2Q(z + δ) | mean: Φ·Δm + φ·Δs + CLIP_MEAN_U·E·s; variance: s·\|ρ_z\|·Δm + s·\|2ρ − zρ_z\|·Δs + CLIP_VARIANCE_U·E·v; slope Φ: (φ·Δm + \|z\|φ·Δs)/s + CLIP_SLOPE_U·E (CLIP_SLOPE_U = 200: z's 8E through zφ ≤ 0.24 plus the Abramowitz–Stegun 147E), at most 1 |
| Clip to [0, 1] (both sides, a = −m/s, b = (1 − m)/s), ρ_a = 2Φ_a(a − E[g]), ρ_b = 2Q_b(b − E[g]) | mean: P(inside)·Δm + \|φ_a − φ_b\|·Δs + 2·CLIP_MEAN_U·E·s + Δshift; variance: s·\|ρ_a + ρ_b\|·Δm + s·\|2ρ − aρ_a − bρ_b\|·Δs + 2·CLIP_VARIANCE_U·E·v + 2·(Δshift·(\|E[Y]\| + \|shift\|) + \|shift\|·Δmean), capped by max(Var, X + ΔX) when shift > Δshift (the reference's Var = max(0, X − shift·(2E[Y] + shift)) then lies in [0, X_cpu]); slope: (\|φ_a − φ_b\|·Δm + \|aφ_a − bφ_b\|·Δs)/s + 2·CLIP_SLOPE_U·E |
| The Edgeworth shift (s·γ/6)(aφ_a − bφ_b), \|aφ_a − bφ_b\| ≤ 0.48, \|γ\| ≤ 1 | Δshift = 0.1·s·min(2, Δγ) + 0.1·\|γ\|·Δs (a wrong γ moves the shift by at most 0.16·s); Δγ from κ₃/(v·s) by the quotient rule |
| Without noise (v = 0 on the GPU, so the reference's variance is 0 too) | the slope is exact when m's interval [m − Δm, m + Δm] lies on one side of the clip level, else its bound is 1 |
| A channel whose sites are all exactly at white (bound 0) | its mean is exact: the dyadic weights sum exactly on both sides; at the clip-level gain the clipped channel is exactly at the clip level |
| Reinhard quadrature | mean: Δm + Δs + 256E·mean; variance: 2s·Δm + 2Δv + 512E·variance; slope E[h′]: 2Δm + 2Δs + 64E (h″ ≤ 2) |
| Correction interpolation | each grid coordinate g_i = (log₂ m_i + 12)·8: 8·(Δm_i/(m_i ln 2) + 2⁻²¹ + 36E) + 2E·(g + 1) (WGSL `log2`: 2⁻²¹ absolute on [½, 2], 3 ULP outside; on [2⁻¹², 1] at most 36E); the interpolant's dependence on g_i is bounded by the largest state difference along axis i over the cell's four edges; the states' single rounding and the weight products 12E·Σ\|w·value\| |
| Footprint sums Σ_j a_j·(…) | the pair rules, with a_j carrying 3E (two host roundings and the product) |

Every bound leaves the kernel per display pixel (the mean's as the largest over the three components; the variance's over the six covariance entries, the residual included) and the host doubles it (`MARGIN` = 2), which covers the second-order terms the rules drop (products of bounds) and the bound arithmetic's own float32 roundings. The derivatives of the clipped moments are first-order exact (for g = clip(Z, a, b): ∂E[g]/∂a = Φ_a, ∂E[g]/∂b = Q_b, ∂E[g²]/∂a = 2aΦ_a, ∂E[g²]/∂b = 2bQ_b, hence ρ_a and ρ_b above; ∂z/∂m = −1/s and ∂z/∂s = −z/s), and the clip constants are the Speed kernel's. Because the AHD kernels and the colour matrix are bounded by the magnitudes of their terms, the bound is wider than Speed's relative γ_64 where the terms cancel: on the fixtures below the largest per-pixel term is 5 × 10⁻⁵–1.6 × 10⁻³ of linear light (up to about 0.3 of an 8-bit code at mid grey) against a measured error two orders smaller: at most 3.0 % of the expected-value bound and 9.2 % of the variance bound is used (table below). The host adds one term the kernel cannot see: the output quantization variance q(m) = s(e)²·Δ²/12 is evaluated at the GPU's mean, so its change dq/dm = 2·s′(e)·Δ²/12 ≤ 6.04·Δ²/12 (s′ ≤ 3.02 on [0, 1]; q is non-decreasing in m, with a jump below 2.1 × 10⁻⁴·Δ²/12 at the sRGB segment join) times the mean's bound enters the variance bound; without it, components whose kernel bound is near zero (a clipped white, a Reinhard mid tone) exceeded their bound by about 10⁻¹³ (found by the white-clip and Reinhard fixtures). The site sum's (T + 3)·E with T = 400 taps is the largest single contribution (4.8 × 10⁻⁵ relative), then AHD's Σ\|w\| ≈ 2.5 and the matrix's absolute row sums ≈ 5.

**The AHD placement: measured; inconclusive without hardware, so the AHD stage is on the GPU and the CPU path is not built.** (Measured with 2.21's low-signal correction, removed in 2.22.0; its columns below are historical.) The issue asks whether AHD (the candidates' statistics, the covariance, the choice variance and the correction's interpolation: the reference's per-real-pixel loop after the expected signal) should run on the GPU or stay on the CPU with only the expected signal on the GPU. Per-stage wall-clock milliseconds, all in the same browser page on this host (Chromium 153 headless, 4 vCPUs shared with other work; `test/webgpu/display-view.webgpu.ts`, report field `browserCpuStageMilliseconds` and `softwareAdapterStageMilliseconds`), the 203 × 135 Quality fixtures (27 405 display pixels; the CPU on one thread; "after the signal" is the reference's render with its expected signal answered from precomputed site values and their one-material flags, bit-identical to the full render in every case; "cold states" is a render from an empty correction-state cache minus the warm render). SwiftShader is Google's Vulkan implementation on the CPU: **its times are not GPU performance**, and they include no hardware parallelism a GPU has. The GPU total adds about 2.3 s of pipeline compilation per render in this test (it builds a new pipeline cache each call):

| Fixture (27 405 display pixels) | CPU, warm: whole render | CPU: expected signal | CPU: after the signal (AHD stage) | CPU: correction states, cold | SwiftShader: lattice + sites | SwiftShader: pixel pass (AHD stage) | Host: states | Host: finishing | Host: recompute (flagged) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slanted edge | 410 | 72 | 322 | 11 | 109 + 1011 | 2103 | 0 | 32 | 0 (0 px) |
| Siemens star (bar) | 555 | 141 | 371 | 5 | 96 + 1035 | 2142 | 0 | 32 | 368 (2017 px) |
| step wedge | 466 | 100 | 339 | 0 | 110 + 986 | 2019 | 0 | 35 | 0 (0 px) |
| checkerboard | 578 | 130 | 396 | 4 | 94 + 954 | 2039 | 0 | 38 | 0 (0 px) |
| spectral patches | 519 | 134 | 376 | 95 | 82 + 982 | 2108 | 0 | 38 | 0 (0 px) |
| step wedge at the white clip | 563 | 104 | 462 | 0 | 150 + 945 | 2428 | 0 | 134 | 459 (2430 px) |
| step wedge at ISO 6400 (the low-signal correction) | 553 | 97 | 435 | 8500 | 94 + 962 | 6051 (2 dispatches) | 8368 | 67 | 0 (0 px) |
| step wedge, Reinhard | 948 | 110 | 805 | 0 | 98 + 976 | 2436 | 0 | 32 | 0 (0 px) |
| AHD without diffraction | 625 | 274 | 355 | 0 | 183 + 64 | 2087 | 0 | 32 | 0 (0 px) |

What the numbers decide and what they do not:

- **SwiftShader is slower than one CPU thread at both stages** (lattice + sites 1.0–1.1 s against 72–274 ms for the expected signal; the pixel pass 2.0–2.4 s against 0.32–0.81 s for the AHD stage, 6.1 s with the correction's two dispatches). That is a property of a CPU emulating a GPU and says nothing about a GPU; the hardware times are **TBD-TIMING (#475; [hardware record](WEBGPU_DEVICES.md))**.
- **The CPU-side numbers bound the alternative without hardware.** The stage after the expected signal is 57–85 % of the warm CPU render on these fixtures (lowest without diffraction, where the signal is a 16-tap gather), and 81 % on the app's own Quality request (24 MP 6 µm, f/8, the composite chart with the caller label, 2028 × 1352, six 96 × 96 parts in Node 24: 25.2 µs per display pixel warm, of which 20.5 µs after the signal; 9.8 µs for the signal on its own window). Moving only the expected signal to the GPU therefore caps the speed-up of a warm render at 1.2–1.75× however fast the GPU is, while the all-GPU path has no such cap. The correction states stay on the host in both placements (8.4–8.5 s cold for the ISO 6400 fixture, 79 s for six parts of the app request at ISO 6400: #447's cost, unchanged by either).
- **So the AHD stage runs on the GPU** (the path built, bounded and tested here), and whether the whole Quality render beats the 4- and 12-worker CPU pool is decided by the hardware run of #475, which reports these same stage fields. The "signal on the GPU, AHD on the CPU" path is **not built**: it needs the GPU's site electrons fed to the reference's loop and a bound for the loop's sensitivity to their error (a double-float site sum, Joldes–Muller–Popescu 2017, would make that error about 2⁻³⁵ relative, small enough for a coarse Lipschitz bound and a flag at the correction threshold). If the hardware run shows the pixel pass slower than the CPU, that path is the next step, and its gain is at most the 1.2–1.75× above.

**Measured agreement with the CPU reference**, per display pixel, every component inside its bound. ΔE2000 is between the GPU's and the CPU's expected values (linear sRGB clipped to [0, 1] → XYZ by the capture colour model → CIELAB, D65); σ units are |ΔE|/σ_cpu per component; flagged pixels were recomputed with the reference and so are exact. The fixtures are the Speed fixtures' charts with `lens.diffraction: "circular-aperture"`, `sensor.antiAliasing: { kind: "four-spot" }` (four lattice groups) and `output.demosaic: "ahd"`, 600 × 400 frame of 6 µm sites, the 2 × 2 box, 203 × 135 view (82 215 components), plus AHD without diffraction (16 one-tap groups). The Siemens star's flags are uncertain lattice materials (points exactly on its diagonals); the white clip's are correction-threshold ties (a pixel variance within its bound of 10⁻⁴, where the reference's decision could differ):

| Fixture | Taps per site | ΔE2000 max / RMS | σ units max / RMS | σ relative max | Samples differing (≤ 1 code) | Bound used: expected / variance | Flagged, recomputed | Corrected pixels (= CPU) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slanted edge | 400 | 1.1e-04 / 8.2e-05 | 3.1e-04 / 1.5e-04 | 1.1e-06 | 6 | 0.25 % / 0.76 % | 0 | 0 |
| Siemens star (bar) | 400 | 2.0e-04 / 9.7e-05 | 4.8e-04 / 1.0e-04 | 1.3e-05 | 4 | 0.30 % / 0.57 % | 2017 | 0 |
| step wedge | 400 | 4.1e-04 / 1.3e-04 | 5.9e-04 / 1.3e-04 | 1.3e-06 | 6 | 0.41 % / 0.54 % | 0 | 0 |
| checkerboard | 400 | 2.1e-04 / 1.2e-04 | 5.2e-04 / 1.7e-04 | 9.4e-06 | 4 | 0.30 % / 0.43 % | 0 | 0 |
| spectral patches | 400 | 3.4e-04 / 1.9e-04 | 6.9e-04 / 2.4e-04 | 2.2e-06 | 7 | 0.49 % / 0.71 % | 0 | 0 |
| step wedge at the white clip | 400 | 3.3e-04 / 1.2e-04 | 7.6e-04 / 1.7e-04 | 3.0e-03 | 2 | 2.98 % / 9.20 % | 2430 | 0 |
| step wedge at ISO 6400 (the low-signal correction) | 400 | 4.1e-04 / 1.3e-04 | 7.4e-05 / 1.7e-05 | 1.0e-06 | 5 | 0.36 % / 0.11 % | 0 | 27405 |
| step wedge, Reinhard | 400 | 2.0e-04 / 8.8e-05 | 4.7e-04 / 1.7e-04 | 7.6e-05 | 6 | 1.70 % / 0.76 % | 0 | 0 |
| AHD without diffraction | 16 | 6.6e-05 / 3.0e-05 | 1.2e-04 / 3.5e-05 | 4.9e-07 | 2 | 0.95 % / 2.32 % | 0 | 0 |
| **Checkerboard, 24 MP 6 µm 6000 × 4000, f/8, 2028 × 1352 (8.2 million components; emulation)** | 400 | 3.3e-04 / 2.0e-04 | 5.4e-04 / 2.4e-04 | 1.4e-06 | 1 035 | 0.43 % / 0.53 % | 0 | 0 |

The same numbers come from the float32 JavaScript emulation of the kernels (`test/helpers/fake-webgpu-display-view-quality.ts`, every CI run: `test/display-view-quality-gpu.test.ts`, and a full-width 32-row band of the 24 MP frame at 2028 × 1352 in `test/display-view-quality-gpu-full.test.ts`; the whole view was rendered once with `PHOTIVRA_DISPLAY_VIEW_WHOLE=1`, last row of the table: 24 minutes on this host, of which the CPU reference 34 s, since the emulation costs 0.5 ms per display pixel) and from SwiftShader (`test/webgpu/display-view.webgpu.ts`, the same nine fixtures). The run-time self-check case (`display-view:quality:checkerboard-13x9-diffraction-ahd`: a 38 × 26 checkerboard with the 2 × 2 box and a four-spot filter, synthetic radius-1 kernels at three nodes, the AHD candidates and the correction with 64 draws per state) passes on the emulation and on SwiftShader; since 2.22.0 (#594) it runs, with the defocus case, before a view's first render that takes the Quality passes, when the Quality host has loaded on demand. On SwiftShader every fixture gave the emulation's numbers to the digits shown except the Reinhard fixture's largest ΔE2000 (2.0 × 10⁻⁴ against 1.97 × 10⁻⁴: SwiftShader's `exp` is within the table's 3 + 2|x| ULP but not correctly rounded, as the emulation's is), and the browser's CPU reference equalled Node's bytes on all nine.

**AHD's choice on the noise-free mosaic is recomputed on the host (#457).** Since #457 the reference's expected value takes the candidate AHD chooses on the noise-free mosaic where the scene decides the choice, and the candidates' average only on a tie (docs/DISPLAY_VIEW.md, "AHD's choice where the scene decides it"). The pixel pass does not run AHD's homogeneity steps: it still renders the average, accumulates per component Σ_j a_j·½|h(H) − h(V)| (how far the reference's choice can move the value), adds ½(|h(H) − h(V)| + their bounds) to the expected value's bound, and flags the display pixel (`ahdChoice`, part of the recompute bits) when that move exceeds `DISPLAY_VIEW_QUALITY_CHOICE_SIGMA` = 2⁻¹⁰ of the pixel's own noise σ in some component. That tolerance is a design choice, a tenth of the 0.01 σ the float32 tests hold the GPU to. The host recomputes flagged pixels in runs along a row (one region render per run, byte-identical to the pixels' one-pixel renders). Measured on the emulation (October 31, 2026): 3 % (slanted edge) to 75 % (step wedge with the Reinhard curve) of the nine 203 × 135 fixtures' display pixels are flagged, and 21.6 % (14 040 of 64 896) of the 32-row band of the 24 MP checkerboard at 2028 × 1352, whose host recomputation took 0.86–1.75 s on a loaded host against 1.0 s for the CPU reference of the whole band. So where the scene is busy the GPU path now does a large part of its work on the CPU; computing AHD's choice in the pixel pass (the site window widened to 5 sites, float32 CIELAB with bounded decisions) is the follow-up. The agreement table above was recorded before #457; on the emulation every fixture still passes the same assertions (ΔE2000 below 0.01, σ units below 0.01, every component inside its bound, samples within one code).

**Known Quality limits are inherited, not hidden.** The GPU reproduces the reference's estimate, so it has the estimate's properties: the Quality noise model's excess colour noise at small footprints (#379: the B_c of the bilinear kernels, AHD's green-reading red and blue, the correlated choice; docs/DISPLAY_VIEW.md "Known limit"). A GPU render agrees with the CPU reference within its bound; it does not agree with the real AHD capture any better than the reference does.

**Timing: the stages on SwiftShader are not GPU performance.** The report line `[test:webgpu display-view]` lists, for each Quality fixture, the wall-clock milliseconds of one render and of each stage (`softwareAdapterStageMilliseconds`: lattice, sites, pixels, states, finishing, recompute, and the pixel redispatches). The hardware stage times are TBD-TIMING (#475): record them as a row of the [hardware record](WEBGPU_DEVICES.md) with the GPU model, driver, browser and OS, and post them on #475. The #480 harness (`scripts/accept-display-view-gpu.mjs`) gives the app's request as `material-layers` (#491); on the M5 Pro it passed 26 of 26 cases, Quality included ([hardware record](WEBGPU_DEVICES.md)).

**Composite and material-layers scenes (#491).** The frame-filling composite with every element under the label layer as a `material-layers` scene, with diffraction, the four-spot filter and AHD, and the same scene as a fixed-size chart with its surround (AHD without diffraction), render on the emulation within their bounds (48 × 36 regions, `test/display-view-quality-gpu.test.ts`), and the first on SwiftShader (a 64 × 48 region). Flagged pixels there follow #491's measurements (the 1024-level elements, the label's glyph edges met exactly by the lattice, the bar star's diagonals).

**`lens.defocus` (#492).** Out of focus the renderer gathers the defocus disc, or each node's diffraction kernel convolved with it, in this site pass, for Speed and Quality requests: [Defocus on the GPU](#defocus-on-the-gpu-492).

**What remains.** The app's request given as `material-layers` (Photivra/apps#126); the stratified estimator and footprints above 6 real pixels per axis (`unsupported-on-backend`); the host finishing's 1.2 µs per display pixel (Speed, above); a Siemens star's exact-boundary lattice points flag the sites within the kernel radius of its diagonals (2 017 of 27 405 display pixels on the bar star, each recomputed on the CPU: 0.37 s of the render on this host).

### Image-plane prints in the Quality passes (#581)

Owner decision, 2026-11-09: a photo's display view renders on WebGPU in the Quality path too. An image-plane print has no
materials. Its spectral radiance varies continuously over the print, so it replaces passes 1 and 2 with its own
(`src/gpu/display-view-image-quality.ts`, behind the `image` hook of `renderDisplayViewQualityOnGpu`). Pass 3, the AHD states and
the host finishing are unchanged.

- **What the reference computes** (expected-signal.ts, the radiance path).
  - With site kernels, per site of channel c: Σ_g Σ_d Σ_n C_n,c(d)·L_n(p + d). Here L_n is the print's spectral radiance at node
    n at the lattice point (the provider's `radianceAt` on the lattice formula), and C_n,c the reference's combined kernel per node
    (`perNode` of its tables).
  - Without kernels, per query offset: w·Σ_n A_c(λ_n)·L_n(p_o).
- **Pass 1 (lattice radiance).**
  - **The point.** One invocation per lattice point. It forms the exact point (p + c)·g in double-float32: p + c is exact in
    float32, checked by the host, and the scale's hi + lo come from float64. Then the print-local point and the print's edge (in the
    composite kernel's bound arithmetic), the pixel coordinates, and the bilinear weights as the Speed module forms them.
  - **The value.** For every node: L_n = W_n·Σ_j b_j·(ρ_black + (ρ_white − ρ_black)·Σ_corners w_jk·s_k(λ_n)).
  - **The records.** Each pixel's lattice cell and fractions come from the host (float64, as the reference decodes the pixel), per
    band for the pixel rows its lattice windows reach. A record is 16 bytes: the cell, and per channel the smaller of f and 1 − f
    rounded once, with a bit for which. So every corner weight carries at most 2E relative per channel.
  - **The bound.** All terms are non-negative. L_n carries at most 27 roundings, declared `IMAGE_PLANE_LATTICE_U` = 32:
    - s 1;
    - three channel weights 6;
    - the nested trilinear form 6;
    - the paper 3;
    - the bilinear weights 4;
    - their products and sums 4;
    - the moved-weight budget 1;
    - W_n 2.
  - **Flags.** A point is flagged when it lies on the print's edge or near a nearest-pixel edge, or when a bilinear weight moved by
    the point's error could change a node's value by more than E of it. That is the Speed module's rule, per node; it acts next to a
    pixel of reflectance 0.
- **Flagged points.**
  - **With site kernels** the reference evaluates the lattice formula itself. The host reads the band's lattice back, replaces a
    flagged point's values with the reference's own `radianceAt` there and clears its flag, as #492 resolves uncertain chart
    materials.
  - **Without kernels** the reference reads the environment's own query points. A site that reads a flagged point with a nonzero
    weight is flagged (bit 0), and its display pixels are recomputed on the host.
  - A print edge placed exactly on the lattice is tested both ways: 200 points resolved; 90 display pixels recomputed.
- **Pass 2 (sites).** The blocked sum of #492's order over each group's dense tap rectangle; without kernels the rectangle is the
  members' span, zero where no member sits. The cell term is Σ_n L_n·C_n,c(t), then the Quality site tail.
  - **Per term:** L's bound, the table's rounding and the product, the node sum's N − 1 additions, and the row, group and total
    additions.
  - **The site electrons** therefore carry (32 + N + cw + ch + G + 4)·E relative (`params.site_gamma`): 1.2 × 10⁻⁵ at 21 nodes with
    the 24 MP f/2.8 defocus case (1 764 taps per site).
  - **The table** is 3·N·T float32 values: 0.44 MB at 21 nodes and 1 764 taps. Above the device's storage binding
    limit it is refused with `insufficient-limits`, as for charts.
- **Loading.** The passes are in the image-plane GPU chunk, which only `prepareImagePlaneScenes()` makes reachable. The Quality
  renderer's hook and the routing cost the capture worker's counted shape nothing net: the GPU chunk is smaller than 2.19.0's after
  the shared code described in [Image-plane scene, Lazy loading and size](IMAGE_PLANE.md#lazy-loading-and-size).

### Defocus on the GPU (#492)

Out of focus, `lens.defocus` puts the geometric defocus disc into the expected signal's input as site kernels (#492 step 2b, `buildExpectedSignalInput`). Without diffraction every node takes the disc itself. With `lens.diffraction`, node λ takes its diffraction kernel convolved with the disc. The disc's radius on this path is at most 64 sites and the combined radius at most 96 (`docs/DISPLAY_VIEW.md`, "Defocus"). A larger disc (up to 512 sites since 2.17.0, #564) is convolved by runs on the CPU (`largeKernel` in the expected signal's input); no GPU renderer takes it: `supports()` refuses `DisplayViewGpuRequest.largeDefocus`, both kernels' render-time checks refuse a `largeKernel`, and `gpu: "auto"` renders the view on the CPU, labelled `unsupported-on-backend`. The renderer gathers exactly these kernels, the reference's float64 values rounded once to float32, in the Quality site pass (step 2c). `supports()` accepts `DisplayViewGpuRequest.defocus` for every Speed and Quality request it otherwise covers.

**Speed takes the Quality passes.** The Speed kernel has no gather. Out of focus the reference reads the scene on the lattice formula and has no `queryPoint`, so Speed's query arithmetic does not apply. Two designs were possible: add a lattice pass and a gather to the Speed kernel, or route a defocused Speed request through the Quality lattice and site passes. The second is the smaller correct change: the lattice, the gather, the composite module's lattice setup (`qualityMaterialSetup`) and the bounds already exist there. The Quality pixel pass then runs with one candidate per phase, the request's own bilinear kernels (the reference's `setup.demosaic`). The host finishing is the same function. The gather runs once per site, its taps each integrating the material's spectrum over the nodes (2.21.0). In-focus Speed stays on the Speed kernel, byte for byte (the renderer routes by `displayViewSpeedGpuUnsupportedReason`, which refuses site kernels).

**The defocus site pass** (`DISPLAY_VIEW_QUALITY_SITES_BLOCKED_WGSL`, chosen when `setup.gpu.defocusRadius` > 0; in focus the tap-list pass runs unchanged):

- **Spectral table (2.21.0).** The pass reads the in-focus pass's table: each channel's per-node kernel values, 3·T·N float32 values, and one spectrum per material, M·N values (signals are integrated from the material spectrum per site; no material is folded into the table). At radius 94 with 21 nodes that is about 36 MB of kernel values.
- **Blocked sum.** Every lattice group's taps form a dense cw × ch rectangle (cw = ch = 2R + 1 plus the group's member spread), so each site sums the taps of a row into a row partial per node, the rows into a group partial and the groups into the total, then the nodes in integer arithmetic. It reads no tap records: tap (dx, dy) of group g reads lattice offset (dx, dy) of the group's window, at table index first_g + dy·cw + dx.
- **Lattice resolution on the host.** With a wide disc nearly every site reads some lattice point that the material module flags as uncertain (the composite's label glyphs and 1024-level elements, a star's diagonals). A flagged tap adds its value spread over all the scene's materials, and with the composite's reflectance range that put 95–100 % of its display pixels above the 2⁻¹⁰ limit, so they were recomputed on the CPU (measured on the emulation before this step was added). In a defocused render the host reads the lattice back after pass 1 and resolves each flagged point: it calls the expected signal's own `materialAt` at the reference's lattice point ((p + 0.5 + f_x − W/2)·g, −(q + 0.5 + f_y − H/2)·g, written as `createDisplayViewExpectedSignal`'s `latticeU`/`latticeV`). It uploads the corrected lattice. Sites then read the reference's materials exactly, and no fixture pixel is flagged (`latticePointsResolved`: 62 on the star block, 242–361 on the composite blocks). The readback is one lattice per band, (siteW + cw − 1)·(siteH + ch − 1)·4 bytes per group.
- **Dispatch size.** A site gathers up to 150 544 taps (radius 96, four groups). The host splits a band's site pass into dispatches of whole workgroups of at most 2³⁰ taps (`DISPLAY_VIEW_QUALITY_SITE_TAPS_PER_DISPATCH`, `params.site_first`), so no single dispatch runs long enough for an operating system's GPU watchdog to reset it (Windows' default TDR delay is 2 s). This is a choice, not a measurement: 0.1 s at an assumed 10¹⁰ taps per second. At radius 94 it leaves about 7 100 sites (111 workgroups) per dispatch, fewer than a large GPU runs at once. The hardware run (#475) records the site pass's time and `siteDispatches`, and decides whether a gather split over several invocations per site is needed. In focus a band stays one dispatch. Splitting never changes a byte (tested).
- **Device limits.** The pass uses no workgroup memory and binds six storage buffers and the uniform (the WebGPU default allows eight per stage). The table (3·T·N·4 bytes plus the spectra: about 36 MB at radius 94 with 21 nodes) and every band buffer are checked against the device's storage binding limit. Past it the render throws `insufficient-limits` naming the table's size and the limit, and nothing is clipped. The GPU session treats `insufficient-limits` from a render like `unsupported-on-backend`: `gpu: "auto"` renders that part on the CPU, labelled, and `"require"` fails (tested).
- **Self-check.** `display-view:quality:checkerboard-13x9-defocus-blocked` renders the engine's 6.3-site disc (radius 3) on the bilinear route with the blocked sum, split over 18 dispatches, against `renderDisplayView` within the bounds. It runs with the Speed and Quality cases before a device's first display-view render.

**The bound of the defocused site electrons (derivation).** Every term is non-negative: the disc's and the site diffraction kernel's weights, the channel responses, the reflectances and the radiances are. A term's computed value is fl(r̂_m·N̂_c(t)), where r̂ and N̂ are host roundings to nearest of the float64 reflectance and combined value. That is at most u = 2⁻²⁴ relative each, the "float32 rounding of each weight" of the kernel. The product adds at most E = 2⁻²³. The sum of n non-negative terms in any order perturbs each term by at most n − 1 roundings (Rump & Jeannerod, *SIAM J. Matrix Anal. Appl.* 35(2), 2014, sec. 1, free author copy, as cited above; also see Higham, *Accuracy and Stability of Numerical Algorithms*, §4.2). In the blocked order a term passes at most cw − 1 additions in its row, ch − 1 in its group, G − 1 in the total and one for the dark electrons. To first order:

|ê − e| ≤ (2u + E + (cw + ch + G − 2)·E)·e ≤ (cw_max + ch_max + G + 3)·E·e = `site_gamma`·e.

This is the in-focus row's (T + 3)·E with T replaced by the block lengths. The second-order factor 1/(1 − n·E) is below 1.0001 for n ≤ 400 and is covered by the host's doubling (`MARGIN`). At radius 94 with the four-spot filter (cw = ch = 190, G = 4), `site_gamma` = 387·E = 4.6 × 10⁻⁵: below the in-focus 400-tap term (4.8 × 10⁻⁵). The tap-list order would give (T + 3)·E = 1.7 × 10⁻² at T = 144 400, so **the bound does not widen with the defocus radius; it grows with the kernel's width**: 1.5 × 10⁻⁶ (radius 1) to 4.6 × 10⁻⁵ (radius 94) on the fixtures below. Two further terms:

- **Flushed terms.** A device may flush a value below the float32 normal range 2⁻¹²⁶ to zero (WGSL allows it). The host adds `site_tiny`: Σ_t of the largest such term at tap t, rounded up and kept normal (0 on every fixture).
- **Uncertainty.** After the lattice resolution no tap is uncertain. The pass still carries the spread term, as the in-focus pass does, scaled by 1 + `site_gamma` for its own blocked sum.

Everything after the site electrons is the Quality pixel pass with its running bounds, unchanged.

**Measured agreement**, per display pixel, against the CPU reference of the same view. Every component is inside its bound and every case meets the #480 thresholds (`scripts/lib/display-view-acceptance.mjs`: 99 % within ΔE2000 1, none above 2.3, |Δ|/σ ≤ 1). No pixel is flagged, and the corrected-pixel counts equal the CPU's. The fixtures (`test/helpers/display-view-defocus-gpu-fixtures.ts`) follow the CPU display view's defocus cases. The frames are a 24 MP full frame at 6 µm with the 50 mm-equivalent prime and a 12 MP sensor at 1.4 µm with the 300 mm-equivalent. The subject is at 2 m. Speed uses the 2 × 2 box; Quality adds diffraction, the four-spot filter and AHD. The scene is the slanted-edge chart (5°), or the composite under the label layer as a `material-layers` scene, or the bar Siemens star. Each case renders a block of the view at a third of the frame's size (3 real pixels per display pixel): 16 × 12 display pixels, 24 × 16 on the composite and the star, and 8 × 6 at the caps. "Bound used" is the largest |Δ| over its bound, for the expected value and the variance:

| Case (kernel radius in sites) | Taps per site | Site sum bound (relative) | ΔE2000 max | \|Δ\|/σ max | Bound used: expected / variance | Samples differing (≤ 1 code) | Lattice points resolved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 µm f/2.8 focus 0.8× Speed (R 10) | 1 764 | 5.8 × 10⁻⁶ | 5.0 × 10⁻⁵ | 7.4 × 10⁻⁵ | 1.00 % / 1.02 % | 0 of 576 | 0 |
| 6 µm f/2.8 focus 0.8× Quality (R 12) | 2 704 | 7.0 × 10⁻⁶ | 2.9 × 10⁻⁵ | 4.9 × 10⁻⁵ | 0.28 % / 0.96 % | 0 of 576 | 0 |
| 6 µm f/2.8 focus 1.25× Speed (R 8) | 1 156 | 4.9 × 10⁻⁶ | 3.3 × 10⁻⁵ | 5.5 × 10⁻⁵ | 0.84 % / 1.60 % | 0 of 576 | 0 |
| 6 µm f/2.8 focus 1.25× Quality (R 10) | 1 936 | 6.1 × 10⁻⁶ | 4.3 × 10⁻⁵ | 7.6 × 10⁻⁵ | 0.28 % / 0.94 % | 0 of 576 | 0 |
| 6 µm f/8 focus 0.8× Speed (R 3) | 196 | 2.5 × 10⁻⁶ | 3.8 × 10⁻⁵ | 5.8 × 10⁻⁵ | 1.18 % / 2.42 % | 0 of 576 | 0 |
| 6 µm f/8 focus 0.8× Quality (R 7) | 1 024 | 4.6 × 10⁻⁶ | 4.0 × 10⁻⁵ | 6.6 × 10⁻⁵ | 0.50 % / 1.24 % | 0 of 576 | 0 |
| 6 µm f/8 focus 1.25× Speed (R 3) | 196 | 2.5 × 10⁻⁶ | 3.8 × 10⁻⁵ | 6.0 × 10⁻⁵ | 1.32 % / 2.47 % | 0 of 576 | 0 |
| 6 µm f/8 focus 1.25× Quality (R 7) | 1 024 | 4.6 × 10⁻⁶ | 2.5 × 10⁻⁵ | 6.7 × 10⁻⁵ | 0.33 % / 1.48 % | 0 of 576 | 0 |
| 6 µm f/16 focus 0.8× Speed (R 2) | 100 | 2.0 × 10⁻⁶ | 1.8 × 10⁻⁵ | 3.9 × 10⁻⁵ | 1.13 % / 1.79 % | 0 of 576 | 0 |
| 6 µm f/16 focus 0.8× Quality (R 9) | 1 600 | 5.6 × 10⁻⁶ | 3.5 × 10⁻⁵ | 5.4 × 10⁻⁵ | 0.29 % / 1.18 % | 0 of 576 | 0 |
| 6 µm f/16 focus 1.25× Speed (R 1) | 36 | 1.5 × 10⁻⁶ | 3.1 × 10⁻⁵ | 6.4 × 10⁻⁵ | 2.00 % / 2.83 % | 0 of 576 | 0 |
| 6 µm f/16 focus 1.25× Quality (R 8) | 1 296 | 5.1 × 10⁻⁶ | 2.6 × 10⁻⁵ | 5.5 × 10⁻⁵ | 0.29 % / 1.27 % | 0 of 576 | 0 |
| 1.4 µm f/2.8 focus 0.8× Speed (R 39) | 24 964 | 2.0 × 10⁻⁵ | 7.4 × 10⁻⁵ | 3.2 × 10⁻⁵ | 0.52 % / 0.70 % | 0 of 576 | 0 |
| 1.4 µm f/2.8 focus 0.8× Quality (R 45) | 33 856 | 2.3 × 10⁻⁵ | 6.9 × 10⁻⁵ | 2.6 × 10⁻⁵ | 0.17 % / 0.39 % | 0 of 576 | 0 |
| 1.4 µm f/2.8 focus 1.25× Speed (R 31) | 15 876 | 1.6 × 10⁻⁵ | 7.6 × 10⁻⁵ | 2.7 × 10⁻⁵ | 0.74 % / 0.78 % | 0 of 576 | 0 |
| 1.4 µm f/2.8 focus 1.25× Quality (R 37) | 23 104 | 1.9 × 10⁻⁵ | 7.6 × 10⁻⁵ | 2.5 × 10⁻⁵ | 0.24 % / 0.52 % | 0 of 576 | 0 |
| 1.4 µm f/8 focus 0.8× Speed (R 14) | 3 364 | 7.7 × 10⁻⁶ | 6.1 × 10⁻⁵ | 2.2 × 10⁻⁵ | 0.78 % / 1.11 % | 0 of 576 | 0 |
| 1.4 µm f/8 focus 0.8× Quality (R 29) | 14 400 | 1.5 × 10⁻⁵ | 4.0 × 10⁻⁵ | 1.5 × 10⁻⁵ | 0.20 % / 0.66 % | 1 of 576 | 0 |
| 1.4 µm f/8 focus 1.25× Speed (R 11) | 2 116 | 6.3 × 10⁻⁶ | 3.6 × 10⁻⁵ | 1.5 × 10⁻⁵ | 0.79 % / 1.14 % | 0 of 576 | 0 |
| 1.4 µm f/8 focus 1.25× Quality (R 26) | 11 664 | 1.4 × 10⁻⁵ | 5.6 × 10⁻⁵ (SwiftShader 5.8 × 10⁻⁵) | 1.8 × 10⁻⁵ | 0.18 % / 0.55 % (SwiftShader 0.20 % / 0.55 %) | 0 of 576 | 0 |
| 1.4 µm f/16 focus 0.8× Speed (R 7) | 900 | 4.4 × 10⁻⁶ | 3.9 × 10⁻⁵ | 1.8 × 10⁻⁵ | 0.87 % / 1.01 % | 0 of 576 | 0 |
| 1.4 µm f/16 focus 0.8× Quality (R 37) | 23 104 | 1.9 × 10⁻⁵ | 6.3 × 10⁻⁵ | 2.2 × 10⁻⁵ | 0.17 % / 0.54 % | 0 of 576 | 0 |
| 1.4 µm f/16 focus 1.25× Speed (R 5) | 484 | 3.5 × 10⁻⁶ | 2.0 × 10⁻⁵ | 9.0 × 10⁻⁶ | 0.51 % / 1.45 % | 0 of 576 | 0 |
| 1.4 µm f/16 focus 1.25× Quality (R 35) | 20 736 | 1.8 × 10⁻⁵ | 4.3 × 10⁻⁵ | 2.0 × 10⁻⁵ | 0.14 % / 0.49 % | 0 of 576 | 0 |
| composite under the label layer (material-layers)  6 µm f/2.8 focus 0.8× Quality (R 12) | 2 704 | 7.0 × 10⁻⁶ | 6.1 × 10⁻⁵ | 1.2 × 10⁻⁴ | 0.31 % / 1.09 % | 0 of 1152 | 361 |
| composite under the label layer (material-layers)  6 µm f/2.8 focus 0.8× Speed (R 10) | 1 764 | 5.8 × 10⁻⁶ | 7.0 × 10⁻⁵ | 1.0 × 10⁻⁴ | 0.95 % / 1.04 % | 0 of 1152 | 336 |
| Siemens star (bar)  6 µm f/2.8 focus 0.8× Quality (R 12) | 2 704 | 7.0 × 10⁻⁶ | 6.5 × 10⁻⁵ | 1.4 × 10⁻⁴ | 0.35 % / 1.01 % (SwiftShader 0.35 % / 1.06 %) | 0 of 1152 | 62 |
| disc at its cap  1.4 µm f/2.8 focus 0.71× Speed (R 64) | 66 564 | 3.2 × 10⁻⁵ | 1.7 × 10⁻⁴ | 4.5 × 10⁻⁵ | 0.71 % / 0.59 % | 0 of 144 | 0 |
| combined near the cap  1.4 µm f/16 focus 0.31× Quality (R 94 = 63 + 31) | 144 400 | 4.6 × 10⁻⁵ | 4.5 × 10⁻⁵ | 1.8 × 10⁻⁵ | 0.07 % / 0.20 % | 0 of 144 | 0 |
| composite under the label layer near the cap  1.4 µm (3:2 crop) f/16 focus 0.296× Quality (R 94) | 144 400 | 4.6 × 10⁻⁵ | 7.4 × 10⁻⁵ | 3.7 × 10⁻⁵ | 0.09 % / 0.16 % | 0 of 144 | 242 |

The emulation (`test/display-view-defocus-gpu.test.ts`, every CI run) and SwiftShader (`test/webgpu/display-view.webgpu.ts`) give the same numbers to the digits shown, except three: the 1.4 µm f/8 focus 1.25× Quality case (ΔE2000 5.8 × 10⁻⁵ and 0.20 % of the expected-value bound on SwiftShader, against 5.6 × 10⁻⁵ and 0.18 %) and the star's variance bound used (1.06 % against 1.01 %): the emulation's built-ins (`exp`, `sqrt`) are correctly rounded, while SwiftShader's need only meet the WGSL accuracy table, so last digits can differ, as on #479's Reinhard fixture. One sample of the 30 fixtures' 17 712 differs from the CPU, by one code. No pixel is flagged on either: every material-uncertain lattice point is resolved on the host before the site pass.

**Timing: SwiftShader is not GPU performance.** Per-stage wall-clock milliseconds on SwiftShader (Chromium headless, this 4-vCPU host shared with other work) are in the suite's report line (`softwareAdapterStageMilliseconds`, with `siteDispatches`). They are listed here for the record only:

| Case | Display pixels | Lattice (with readback and resolution) | Sites (dispatches) | Pixels | Finishing | Render, including pipeline creation |
| --- | --- | --- | --- | --- | --- | --- |
| 6 µm f/2.8 focus 0.8× Speed (R 10) | 192 | 10 ms | 98 ms (1) | 21 ms | 0.4 ms | 2.6 s |
| 6 µm f/2.8 focus 0.8× Quality (R 12) | 192 | 6 ms | 97 ms (1) | 25 ms | 0.3 ms | 2.6 s |
| 6 µm f/2.8 focus 1.25× Speed (R 8) | 192 | 7 ms | 38 ms (1) | 12 ms | 0.3 ms | 2.7 s |
| 6 µm f/2.8 focus 1.25× Quality (R 10) | 192 | 9 ms | 74 ms (1) | 38 ms | 0.3 ms | 2.9 s |
| 6 µm f/8 focus 0.8× Speed (R 3) | 192 | 5 ms | 5 ms (1) | 11 ms | 0.4 ms | 2.7 s |
| 6 µm f/8 focus 0.8× Quality (R 7) | 192 | 5 ms | 127 ms (1) | 40 ms | 0.4 ms | 2.9 s |
| 6 µm f/8 focus 1.25× Speed (R 3) | 192 | 10 ms | 8 ms (1) | 12 ms | 0.3 ms | 2.5 s |
| 6 µm f/8 focus 1.25× Quality (R 7) | 192 | 7 ms | 53 ms (1) | 33 ms | 0.4 ms | 2.9 s |
| 6 µm f/16 focus 0.8× Speed (R 2) | 192 | 5 ms | 4 ms (1) | 142 ms | 0.3 ms | 3.0 s |
| 6 µm f/16 focus 0.8× Quality (R 9) | 192 | 7 ms | 52 ms (1) | 32 ms | 0.3 ms | 2.6 s |
| 6 µm f/16 focus 1.25× Speed (R 1) | 192 | 5 ms | 4 ms (1) | 60 ms | 0.3 ms | 2.7 s |
| 6 µm f/16 focus 1.25× Quality (R 8) | 192 | 6 ms | 59 ms (1) | 28 ms | 0.3 ms | 2.8 s |
| 1.4 µm f/2.8 focus 0.8× Speed (R 39) | 192 | 12 ms | 776 ms (1) | 12 ms | 0.3 ms | 3.4 s |
| 1.4 µm f/2.8 focus 0.8× Quality (R 45) | 192 | 14 ms | 1206 ms (1) | 59 ms | 0.3 ms | 8.5 s |
| 1.4 µm f/2.8 focus 1.25× Speed (R 31) | 192 | 13 ms | 443 ms (1) | 21 ms | 0.3 ms | 3.2 s |
| 1.4 µm f/2.8 focus 1.25× Quality (R 37) | 192 | 16 ms | 648 ms (1) | 56 ms | 0.4 ms | 8.4 s |
| 1.4 µm f/8 focus 0.8× Speed (R 14) | 192 | 7 ms | 71 ms (1) | 13 ms | 0.3 ms | 2.8 s |
| 1.4 µm f/8 focus 0.8× Quality (R 29) | 192 | 16 ms | 446 ms (1) | 270 ms | 0.3 ms | 9.4 s |
| 1.4 µm f/8 focus 1.25× Speed (R 11) | 192 | 6 ms | 64 ms (1) | 16 ms | 0.4 ms | 2.8 s |
| 1.4 µm f/8 focus 1.25× Quality (R 26) | 192 | 12 ms | 383 ms (1) | 62 ms | 0.3 ms | 9.1 s |
| 1.4 µm f/16 focus 0.8× Speed (R 7) | 192 | 4 ms | 19 ms (1) | 142 ms | 0.2 ms | 2.7 s |
| 1.4 µm f/16 focus 0.8× Quality (R 37) | 192 | 14 ms | 709 ms (1) | 91 ms | 0.3 ms | 9.3 s |
| 1.4 µm f/16 focus 1.25× Speed (R 5) | 192 | 12 ms | 143 ms (1) | 12 ms | 0.3 ms | 2.7 s |
| 1.4 µm f/16 focus 1.25× Quality (R 35) | 192 | 16 ms | 584 ms (1) | 74 ms | 0.2 ms | 9.1 s |
| composite under the label layer (material-layers), 6 µm f/2.8 focus 0.8× Quality (R 12) | 384 | 76 ms | 248 ms (1) | 52 ms | 0.6 ms | 5.5 s |
| composite under the label layer (material-layers), 6 µm f/2.8 focus 0.8× Speed (R 10) | 384 | 129 ms | 107 ms (1) | 19 ms | 0.5 ms | 5.4 s |
| Siemens star (bar), 6 µm f/2.8 focus 0.8× Quality (R 12) | 384 | 13 ms | 156 ms (1) | 45 ms | 0.6 ms | 3.0 s |
| disc at its cap, 1.4 µm f/2.8 focus 0.71× Speed (R 64) | 48 | 18 ms | 401 ms (1) | 6 ms | 0.1 ms | 3.0 s |
| combined near the cap, 1.4 µm f/16 focus 0.31× Quality (R 94 = 63 + 31) | 48 | 36 ms | 1122 ms (1) | 22 ms | 0.1 ms | 5.3 s |
| composite under the label layer near the cap, 1.4 µm (3:2 crop) f/16 focus 0.296× Quality (R 94) | 48 | 582 ms | 904 ms (1) | 28 ms | 0.2 ms | 7.7 s |

The hardware numbers are **TBD-TIMING (#475; [hardware record](WEBGPU_DEVICES.md))**. The CPU display view's cost with defocus is in `docs/DISPLAY_VIEW.md` ("Cost", defocus): it grows about as R², to 0.68–0.86 ms per display pixel at radius 60–62 on one thread. The GPU site pass does the same per-tap work (T taps per site), so its hardware time per radius is the number #475 must record.

## Error bounds (a priori, reported per result)

**Assumptions: the WGSL accuracy table.** The bounds assume a device that meets the W3C WebGPU Shading Language specification, §15.7 *Floating Point Evaluation* ([W3C Candidate Recommendation Draft, 26 October 2026](https://www.w3.org/TR/WGSL/#floating-point-evaluation); the table is §15.7.4 *Floating Point Accuracy*, the ULP definition follows Muller 2005), and nothing more:

- WGSL specifies no rounding mode: a *correctly rounded* operation returns one of the two float32 neighbours of the exact result, up or down. One operation is therefore within one ULP, that is within **ε = 2^-23** relative (ULP(x) ≤ 2^-23·|x|). This applies to `+ − ×`, `floor`, `round`, `fma` as a product and a sum, and the conversions `f32(u32)`, `f32(i32)`.
- `x / y`: 2.5 ULP for |y| in [2^-126, 2^126], so ≤ 2.5ε relative. `sqrt(x)`: inherited from `1.0 / inverseSqrt(x)` with `inverseSqrt` at 2 ULP, so ≤ 4.5ε. `exp(x)`: (3 + 2|x|) ULP. `log(x)`: 2^-21 absolute on [0.5, 2], 3 ULP outside. `atan2`: 4096 ULP. `cos`, `sin`: 2^-11 absolute on [−π, π]. `pow`: inherited from `exp2(y·log2(x))`. The kernels use none of `atan2`, `cos`, `sin`; `pow` enters only the sRGB transfer, whose bound is stated separately below.
- An implementation **may reassociate** floating-point operations (§15.7.5), and may fuse a multiply and an add when the result is at least as accurate. Subnormal inputs and outputs may be flushed to zero.

Let γ_k = k·u/(1 − k·u) with u = 2^-24. These are the standard forward-error bounds for recursive summation and dot products (Rump & Jeannerod, *SIAM J. Matrix Anal. Appl.* 35(2), 2014, sec. 1, [free author copy](https://www.tuhh.de/ti3/paper/rump/RuJea13.pdf). Also see: Higham, *Accuracy and Stability of Numerical Algorithms*, 2nd ed., SIAM 2002, §2–§4; the summation bound of §4.2 holds for any order of the additions). The convolution, temporal-sum, SDR and RAW-development bounds below are written with u = 2^-24, the unit roundoff of round-to-nearest; on a device that rounds in another direction, the same derivations hold with u replaced by ε = 2^-23. Every device measured so far rounds `+ − ×` to nearest. The sensor-stage and chart margins are written directly in ε (next section, [Sensor-stage margins](#sensor-stage-margins-derivation)).

- **Convolution (`relative-to-reference`).** Every term is non-negative, so for every sample `|v_gpu − v_ref| ≤ (γ_{T+3} + 2^-40)·v_ref + 2·T·2^-126 + 2·S_max·Σ_t max_p w̃_{p,t}`, where T = (2r+1)² taps. The three extra roundings cover the f32 conversion of the sample, the weight and the product. The 2·T·2^-126 term covers subnormal flush-to-zero of samples and products.
  - The last term covers kernel weights below the float32 normal range. w̃_{p,t} is weight t of patch p when it lies in (0, 2^-126), and 0 otherwise; S_max is the largest input sample. The host conversion can round such a weight to zero or to a subnormal (an error of at most w), and the GPU may flush it, so the whole product w·s is at risk. The factor 2 covers that and the later roundings. The term is 0 when no weight lies in that range, so ordinary kernels keep the bound above. Gaussian tails do reach this range (the conformance corpora have weights near 10^-108), so the backend widens the bound instead of rejecting them.
- **Integer codes (`integer-code-difference`).** If the float32 linear value entering the transfer is within δ_L of the reference, then `|Δcode| ≤ ⌊max·(12.92·δ_L + δ_E)⌋ + 1`, capped at the code maximum.
  - 12.92 is the largest slope of the sRGB encode on [0, 1].
  - δ_E = 2^-17 is the declared bound on the WGSL encode. The worst case derived from the WGSL `log2`/`exp2` accuracy is about 2.5e-6, so the bound keeps a 3× margin. The sRGB segment join is discontinuous by only −2.85e-8.
  - **SDR:** δ_L = γ_6, so the bound is 1 code at 8 and 16 bits.
  - **RAW development:** δ_L is propagated through every step (channel sums γ_{n+2}, gains, clip or blend, two 3×3 products, exposure), using the run's largest normalized site magnitude, Σ|w|, the largest gain and the ∞-norms of both matrices. It is therefore input-dependent. For example, it was 1 code at 8 bits and 12–67 codes at 16 bits on the conformance corpora.
- **Luminance tone curves (`integer-code-difference`, a running bound).** The bound has the same form, with δ_L the largest per-sample linear bound of the run. The per-sample formula below is fixed in advance, but unlike the other stages its value is known only after the run: the kernel evaluates it from each pixel's own float32 values (a running error bound), inflated (×1.001, and ×1.01 on the factors) so that the float32 evaluation can only over-estimate, and collects the largest value with an atomic maximum. Every term is a non-negative bound in terms of the computed values, so the result is still a rigorous bound for every sample:
  - Inputs: each exposed component carries a bound ε (SDR: 4u·|e| for the source, scale and product roundings and the reference's own; RAW development: the propagated development bound). The luminance then carries λ = Σk·ε + 6u·Σk|e| (coefficient rounding, products and additions).
  - Branch: the reference maps a pixel only if L > 0. When |L̃| > 2λ both sides take the same branch. Inside that band either branch may run, and the bound covers both: 2(|e| + ε)(1 + sup h) over (0, 3λ], where sup h is max(1, 1/Lw²) for extended Reinhard and (1/g(Lw))·(3λ)^(n−1)/σⁿ for Naka–Rushton with n ≥ 1.
  - Mapped pixels: |m_gpu − m| ≤ H·ε·(1 + Fq) + (|e| + ε)·(H·(η + Fq) + a) + 2u|m|, where H bounds h(L̃), η and a are the relative and absolute errors of evaluating h in float32, q = λ/L̃ ≤ 1/2, and F = ((1 + q)/(1 − q))^T/(1 − q) bounds h's change over [L̃ − λ, L̃ + λ]. T bounds h's elasticity |d ln h/d ln L|: 1 for extended Reinhard, max(1, n − 1) for Naka–Rushton.
  - η: 14u for extended Reinhard, counting WGSL division as 2.5 ULP. For Naka–Rushton, η = 2ρ + 16u, where ρ is the relative error of P from the WGSL `log2` (2^-21 absolute or 3 ULP) and `exp2` (3 + 2|z| ULP) entries, plus slack for the reference's float64 `pow`. Below 2^-120 the power may flush to zero, which adds an absolute term.
  - Clipping is 1-Lipschitz, and a sample whose interval [m − δ, m + δ] lies entirely above 1 or below 0 contributes 0. In reject mode, a sample whose interval straddles 0 or 1 fails closed (`indeterminate-float32-classification`).
  - So the bound is tight for ordinary colours: 1 code at 8 bits and 3–30 codes at 16 bits on the conformance corpora. It grows near L = 0 when components have mixed signs (18–102 codes at 8 bits on the mixed-sign corpus), and with the absolute development bound in RAW development (152–1652 codes at 16 bits on random RAW codes). Measured differences were at most 1 code everywhere.
- **Diagnostics.** A sample is *uncertain* when its float32 value lies inside a classification band where float32 and float64 decisions can differ:
  - near 0 or 1, in band δ_e;
  - tiny positive Reinhard inputs below 2^-20;
  - zero results from non-zero sources (underflow);
  - the WB-clip level or the 0.8 reconstruction start (RAW);
  - luminance curves: a ratio h within its bound of 1 (the tone-changed count), a luminance inside its branch band, or a toned value whose bound interval straddles 0 or 1.

  Every diagnostic count then differs from the reference by at most `diagnosticUncertaintySampleCount`. When that count is 0, `diagnosticsExact` is true and the counts equal the reference.
- **Temporal exposure sum (`relative-to-reference`).** Every term is non-negative and carries at most K + 7 roundings (sample, bilinear weight, their product, three inner additions, row weight, its product, K − 1 outer additions). So `|v_gpu − v_ref| ≤ (γ_{K+8} + 2^-40)·v_ref + K·(8·w_max + 2)·2^-126 + R`, where K is the node count and w_max the largest row weight.
  - R covers weights below the float32 normal range, for the same reason as the convolution's last term: `R = 2·S_max·Σ_k (max_y ρ̃_k(y) + w_max·Σ_j β̃_{k,j})`. Here ρ̃_k(y) is node k's row weight for row y and β̃_{k,j} its four bilinear weights, each counted only when it lies in (0, 2^-126). R is 0 when no weight lies in that range.
- **Sensor stage (`exact-except-flagged-sites`).** Not a numeric tolerance. Every unflagged site has exactly the reference code and saturation flags. Only flagged sites (`errorBound.flaggedSiteCount`, listed in `flaggedSiteIndices`) may differ. Each diagnostic count differs by at most the flagged count. The per-decision margins are derived from the WGSL accuracy table (next section), then doubled; they are in `src/gpu/wgsl-sensor-kernel.ts`. Recomputing only the flagged sites with the reference makes the region bit-identical, and the tests do exactly that.

### Sensor-stage margins (derivation)

Notation: ε = 2^-23 (one WGSL rounding, either direction); a quantity "≤ kε" has relative error at most kε against the exact real value, first order in ε (products of errors are dropped; the kernel doubles every margin, `MARGIN = 2`, which covers them with room to spare). "The reference" is the float64 `simulatePackedSensorSite`; its own roundings enter through `CPU_REL = 2^-47` terms (64 float64 ulps). A sum of n float32 terms t_i, however associated, is within (n − 1)·ε·Σ|t_i| of the exact sum (Higham §4.2), so every multi-term margin below holds under reassociation. Integer arithmetic is exact. The emulation test `test/webgpu-adversarial-arithmetic.test.ts` evaluates the same kernel logic with each of these liberties taken adversarially (random rounding direction, 2.5-ULP division, table-bounded `sqrt`, `log`, `exp`, random summation order) and checks that no unflagged site changes.

- **Uniforms.** `unit(bits) = (f32(bits) + 0.5)·2^-32`: the conversion and the sum round, the power-of-two scale is exact: ≤ 2ε. Comparisons of uniforms with constants and with each other are made on the integer state and are exact.
- **Box–Muller normal.** `ln_unit`: for `unit < 1/2`, WGSL `log` of an argument ≤ 2ε off is within 3 ULP + 2ε, and |ln| ≥ ln 2, so ≤ 6ε. For `unit ≥ 1/2` the kernel evaluates 2·atanh(r), r = −w/(2 − w) with w = 1 − unit exact to 2ε: w (2ε), 2 − w (ε), the division (2.5ε): r ≤ 5.5ε, |r| ≤ 1/3; r² ≤ 12ε; the degree-11 Horner polynomial in r² with positive, decreasing coefficients adds ≤ 4ε (two roundings per step, weighted by (1/9)^steps, plus the coefficients' roundings and r²'s error through a derivative ≤ 0.4); the final product ε: ≤ 10.5ε. Take **ln_unit ≤ 11ε**. radius = sqrt(−2·ln): the scaling is exact, `sqrt` ≤ 4.5ε, half of ln's error: **radius ≤ 10ε**. `cos_unit`: the reduced argument g ≤ π/4 carries 4ε (conversion, sum, the constant 2π/2^32, the product), g² 9ε; the cosine polynomial's own roundings ≤ 3.3ε and g²'s error through a derivative ≤ 1/2 add ≤ 2.8ε; the sine branch, g·(1 + g²·s(g²)), ≤ 10ε relative on a value ≤ 0.71: **|cos_unit − cos| ≤ 8ε** absolute. z = radius·cos: radius·(10ε·|cos| + 8ε + ε) ≤ **20ε·radius** (`Z_ERR`). A read-noise term z·σ adds σ's float32 rounding and the product (2ε), and the sum of up to c terms in any order adds (c − 1)ε·Σ|z_c σ_c|; the kernel bounds each |z_c σ_c| by radius_c·σ_c: `noise_bound = Σ σ_c·radius_c·(20 + 2 + c)·ε`.
- **Multiplication method** (mean < 30). The float32 mean is within ε·(mean + 1) of the reference's (the host-rounded fraction and the sum), so exp(−mean) carries (3 + 2·mean) ULP + ε·(mean + 1) ≤ (4 + 3·mean)·ε. The product of n uniforms carries 3ε per factor (the uniform and the multiplication). Margin: (3n + 4 + 3·mean)·ε·max(product, threshold).
- **PTRS** (30 ≤ mean < 10^9). mean ≤ 2.1ε (f32(mi) for mi ≥ 2^24, the fraction, the sum; mean ≥ 30); sq = √mean ≤ 5.6ε; b = 0.931 + 2.53·sq: 2.53 (ε), the product (ε), 0.931 (ε, ≤ 0.063·b), the sum (ε): ≤ 8.7ε; a = −0.059 + 0.02483·b ≥ 0.308 with 0.02483·b ≤ 1.2·a: ≤ 14ε; inv_alpha = 1.1239 + 1.1328/(b − 3.4): b − 3.4 ≤ 12.3ε (b/(b − 3.4) ≤ 1.3), the quotient ≤ 15.8ε on a value ≤ 0.0994, the constant and the sum ε each: ≤ 3.9ε absolute, ≤ 3.5ε relative; v_r = 0.9277 − 3.6224/(b − 2): the quotient ≤ 14.6ε on ≤ 0.283, the constant and the difference: **≤ 6ε absolute**.
  - *Floor test.* scale = 2a/us + b: 2a/us ≤ 18.5ε (a 14ε, us 2ε, the division 2.5ε), plus b and the sum: ≤ 19.5ε; t = scale·u ≤ 22.5ε. x = (t + mf) + 0.43 in any order: ≤ 22.5ε|t| + 2ε(|t| + 1.43) + 2ε = **25ε|t| + 4ε**, plus the reference's float64 rounding of t + mean + 0.43, 4.5·10^-16·(|t| + mean + 1).
  - *Acceptance.* v ≤ 2ε·v, v_r ≤ 6ε: margin **7ε + 2ε·v**.
  - *Log-probability test.* lhs = log(v·inv_alpha/(a/us² + b)): us² 5ε, a/us² 21.5ε, the denominator ≤ 22.5ε, the numerator 6.5ε, the quotient 31.5ε; `log` adds 3 ULP outside [0.5, 2] or 2^-21 inside: **dl = 32ε + 2^-21 + 3ε|lhs|**. rhs for k = 0 is −mean: **3ε·mean**. For k > 0: kf = f32(k) exact below 2^24, else ε; dd = f32(mi − k) + mf ≤ 2ε|dd| + ε; t = dd/kf ≤ 5.5ε|t| + ε/kf. For |t| ≤ 1/2, g(t) = ln(1 + t) − t is evaluated as −t²/(2 + t) + 2s³(1/3 + s²/5 + …), s = t/(2 + t): the first term carries 4.5ε (two roundings and a division), the second 17.5ε (s 3.5ε, s² 8ε, the polynomial 4ε, two products) on at most 0.14 of |g|, the sum ε: ≤ 8.2ε|g| of evaluation error; the input's 5.5ε enters through g's elasticity |t·g′/g| ≤ 2.6 (14.3ε), its absolute part ε/kf through |g′| ≤ 2|t|: δg ≤ 22.5ε|g| + ε/kf, and kg = kf·g: **dk = 25ε|kg| + ε**. For |t| > 1/2, lr = log(mean/kf): the quotient 5.6ε, `log` 3 ULP or 2^-21; kg = kf·lr − dd: **dk = kf·(6ε + 2^-21 + 5ε|lr|) + 2ε|dd| + ε + ε|kg|**. lnk = log(kf) ≤ 2^-21 or 3ε·lnk, plus ε from kf; the Stirling remainder R(k) is tabulated (ε·|R| ≤ 0.1ε) or 1/(12k) − 1/(360k³) (≤ 0.01ε); ½ln 2π rounds (ε); three subtractions: **dr = dk + 2^-22 + 1.5ε·lnk + 2ε + 3ε(|kg| + ½lnk + 1) + 2^-47·(mean + k(|ln mean| + lnk + 1))**, the last term the reference's float64 evaluation of −mean + k·ln mean − log k!. The test flags when |lhs − rhs| ≤ 2(dl + dr).
- **Capacity test with a deterministic fraction.** dcap = w + (r_frac − c_frac) with w = f32(realized − ⌊capacity⌋) (ε|w|), the two host-rounded fractions (ε each) and a three-term sum in any order (2ε(|w| + 2)): **3ε|w| + 6ε + 2^-47·(realized + 1)**.
- **Pre-ADC test.** diff = (whole + (a_frac − t_frac)) + noise, four terms in any order: 3ε(|whole| + 2 + |noise|), whole's conversion ε|whole|, the two fractions 2ε, the noise bound: **noise_bound + 4ε|whole| + 3ε|noise| + 8ε + 2^-47·(a_int + |noise|)** plus the fixed-pattern slack (the reference's float64 threshold − offset) and the deterministic fraction's rounding.
- **ADC rounding.** The integer part of signal/gain comes from integer arithmetic (exact). The fraction is a sum of at most eleven float32 terms (the fixed-pattern offset fraction, the eight piece fractions, each below 1, frac_codes = a_frac·(1/gain) and noise_codes = noise·(1/gain)), then a floor split, with INL a second floor split, and the comparison with ½: 13 roundings in any association on terms whose magnitudes sum to at most 13 + frac_codes + |noise_codes|: **13ε·(13 + frac_codes + |noise_codes|)**. frac_codes carries 3ε (the fraction, 1/gain's float32 rounding, the product), noise_codes 2ε|noise_codes| + noise_bound/gain; the pieces leave 1/gain short by a residual below 2^-44/gain, which times a_int enters directly; the reference's float64 division and sum: 2^-47·(a_codes + |noise_codes| + black). With INL the margin is multiplied by (1 + slope_max) for the offset's dependence on the ideal code, and the offset evaluation adds slope_max·2ε·(|ideal| + 1 + max|knot code|) (the ideal's and the knot's roundings), 11ε·(max|offset| + 1) (the slope, the difference, the product, the knot offset, the sum and the second split in any association) and 2^-47·(|ideal| + max|offset|)·(1 + slope_max) for the reference's float64 interpolation. A noise-free power-of-two-gain regime with an integer capacity and no INL is exact on both sides, so its ties need no flag.
- **Digital gain.** |delta|·g from the integer pieces (exact integer part), eight fractions below 1 summed in any order with the floor split and the ½ comparison (≤ 10 roundings on values below 9): **90ε** + |delta|·residual + 2^-47·(|estimate| + black). A digital gain with at most 12 significant bits is exact on both sides and its ties need no flag.
- **Domain.** 1/gain and the digital gain in [2^-60, 2^60] keep every piece scale 2^(s_j) ≥ 2^-115, so no fraction is subnormal and flush-to-zero cannot act; capacity/gain ≤ 2^30 keeps the integer shifts below 31 bits.

## Accuracy contract

This section states what the `webgpu-f32` path promises for each stage, relative to the CPU reference, and how the stage bounds combine along the image-formation chain: optics → exposure and motion → sensor → development and SDR.

**Two kinds of error, kept separate:**

1. **Arithmetic error:** GPU float32 against the CPU float64 reference of the *same* equations. It is stated a priori in every result and tested below.
2. **Method error:** the image-formation method against today's per-site engine. The method uses isoplanatic convolution, temporal quadrature and bilinear shifts; the per-site engine uses per-site radiance queries, PSF quadrature and temporal sampling. The bounds here do not cover method error.
   - Each fixture's rollout measures it on sampled tiles against the per-site engine before the fast path is used for that fixture: see [Per-fixture rollout](#per-fixture-rollout-method-error). It is measured, not bounded.
   - The sensor stage is the exception: it has no method error, because its reference is bit-identical to the per-site producer. Scene radiance is the other exception: every value is the reference rounded once to float32.

**Per-stage bounds:**

| Stage | Quantity | `errorBound.kind` | Bound (a priori) | Tests |
| --- | --- | --- | --- | --- |
| Optics: convolution | expected irradiance or photons per site | `relative-to-reference` | (γ_{T+3} + 2^-40)·v + 2T·2^-126 (+ a term for weights below 2^-126, see above) | `test/image-kernel-accelerator.test.ts`, `test/webgpu/conformance.webgpu.ts` |
| Exposure and motion: temporal sum | expected exposure (photons or electrons) per site | `relative-to-reference` | (γ_{K+8} + 2^-40)·v + K·(8·w_max + 2)·2^-126 + R (R = 0 unless a weight is below 2^-126) | `test/temporal-exposure-sum.test.ts`, `test/webgpu/stages.webgpu.ts` |
| Sensor | RAW codes, saturation counts, noise moments | `exact-except-flagged-sites` | unflagged sites identical; counts within ± flagged; flagged sites listed | `test/packed-sensor-raw.test.ts`, `test/webgpu/stages.webgpu.ts` |
| Native capture SDR | 8- or 16-bit codes | `integer-code-difference` | 1 code | `test/image-kernel-accelerator.test.ts`, `test/webgpu/conformance.webgpu.ts` |
| RAW development | 8- or 16-bit codes | `integer-code-difference` | propagated per run (see above) | same |
| Luminance tone curves (SDR and RAW development) | 8- or 16-bit codes | `integer-code-difference` | largest per-sample bound of the run (see above) | `test/webgpu-luminance-tone.test.ts`, `test/webgpu/conformance.webgpu.ts` |
| Scene radiance and spectral integration (chart presets, composites, elements, mask layers) | spectral radiance or its channel integrals per query | `relative-to-reference` | 2^-24·v + 2^-126 (flagged points recomputed on the host) | `test/chart-radiance-batch.test.ts`, `test/chart-composite-gpu.test.ts`, `test/webgpu/stages.webgpu.ts` |
| Display view, Speed (#478; registered by the GPU session) | expected linear-light value and noise covariance per display pixel | `relative-to-reference` (plus `varianceBound`) | 2·(γ_64 + 2^-40)·value + the clip steps' running term (0 where no clip acts), γ with E = 2^-23; variance 2·(γ_80 + 2^-40)·V + its term; the noise draw bit-identical; flagged pixels recomputed | `test/display-view-speed-gpu.test.ts`, `test/display-view-speed-gpu-full.test.ts`, `test/webgpu/display-view.webgpu.ts` |
| Display view, Quality (#479; the same renderer) | expected linear-light value and noise covariance per display pixel, with diffraction, the filter's spots and AHD | `relative-to-reference` (plus `varianceBound`) | 2·2^-40·value + the per-pixel running absolute bound (every quantity carried as a value and its first-order bound, doubled), plus the quantization term's dependence on the mean; the noise draw bit-identical; the correction states the reference's own; flagged pixels recomputed | `test/display-view-quality-gpu.test.ts`, `test/display-view-quality-gpu-full.test.ts`, `test/webgpu/display-view.webgpu.ts` |

**How the bounds compose:**

- **Through linear stages** (optics, then exposure and motion):
  - `composeRelativeErrorBounds(first, second, W)` returns r = r₁ + r₂ + r₁r₂ and a = a₂ + W·a₁·(1 + r₂).
  - W is the second stage's largest weight sum per output: `plan.maximumRowWeightSum` for the temporal sum, `plan.maximumKernelSum` for the convolution.
  - **Proof.** The second stage has non-negative weights. With |ã − a| ≤ r₁a + a₁ elementwise, |B̃ã − Bã| ≤ r₂·Bã + a₂ and Bã ≤ (1 + r₁)Ba + W·a₁. Also |B(ã − a)| ≤ r₁Ba + W·a₁. Adding the two gives the result.
  - **Tests:** a randomized worst-case check, and the convolution → temporal-sum chain on the in-process device (`test/temporal-exposure-sum.test.ts`).
- **Into the sensor stage:**
  - For given expected electrons, the sensor contract is exact except at flagged sites.
  - When the expected electrons come from GPU stages with a relative bound (r, a), each site's realized code is a valid draw for its perturbed mean. A pointwise code bound does not exist, because a Poisson draw is not continuous in its mean.
  - The bound holds for expected values instead. The noise-free code, and the mean code of a uniform patch, shift by at most (r·e + a)/gain codes before quantization. The shot-noise variance shifts by at most (r·e + a)/gain² codes².
  - **Example:** r = 1e-5 at e = 60 000 electrons and gain 1 e⁻/code gives a mean shift of at most 0.6 codes, against a shot-noise σ of 245 codes.
- **Into development and SDR:** these stages consume integer RAW codes. Their own bounds apply to whichever codes they receive. Where the sensor codes equal the reference, the whole chain from codes onward is bounded by the development or SDR bound alone.

**Noise:** the GPU uses the same seeded model as the CPU (`photivra-native-raw-noise` 0.4.0, MurmurHash3 per-site seeds).

- Realized noise is exactly equal to the reference at every unflagged site.
- Exact equality is not guaranteed at flagged sites.
- A statistical-equivalence test covers the whole output, flagged sites included (`test/webgpu/stages.webgpu.ts`). Uniform patches of 4096 sites at 3 to 20 000 electrons must satisfy all of these:
  - the GPU patch mean is within 4·√(2σ²/N) of the reference mean;
  - the GPU variance is within 1 ± 4·√(2/(N − 1)) of the reference variance;
  - both GPU moments are within 5 sampling standard deviations of the model's mean E/g + black and variance (E + σ_read²)/g² + 1/12.
- A caller that needs bit identity recomputes the `flaggedSiteIndices` with the reference.

## Per-fixture rollout (method error)

For every built-in chart preset, `test/webgpu/rollout.webgpu.ts` measures the method error of the GPU image-formation path against the per-site CPU engine on sampled tiles. These are accuracy numbers, not speed. The setup is declared and synthetic (`test/helpers/rollout-fixture.ts`):

- **Frame:** `simulateCapture` defaults (professional tier, 50 mm at f/8, Planckian 6500 K), 192×128 output (194×130 native sites with the demosaic border), 6 µm sites, 40 nm spectral steps (10 nodes).
- **Lens PSF:** a synthetic, field-varying `LensSampledPsfProfile`: anisotropic Gaussians with σx = 4 + 10·r µm and σy = 4 + 6·r µm (r is the field radius in mm) and a centroid shift of 2 µm per mm. It is wavelength-independent. It is a stress test, not a measured lens: σ grows about 2.7× from the axis to the corner of this small frame.
- **Reference:** the per-site engine, `calculateEnvironmentSensorPhotoSignal` with the facade's own site inputs and the PSF as `sampled-local`. It makes radiance queries at every PSF tap and spectral node and reports expected generated electrons per site.
- **Method, GPU path:** `evaluateChartRadiance` (spectral integral per Bayer channel at site centres, with the per-site engine's own spectral weights read by probing it with single-wavelength radiance), then `convolveIrradiance` per channel plane with `resolveLensPsfConvolutionKernels` kernels (8-site patches), then each site's own channel. The scene is static, so the temporal sum is one node and adds no method error. The facade's optics factor is the same at every site (checked), so one weight row per channel is exact.
- **Tiles:** the frame centre (8×8 sites) and an off-axis tile at native (150, 20) (8×8) with 6 µm PSF samples (exact site sampling), and the off-axis tile (4×4) with 2 µm PSF samples (bilinear splatting).
- **Metric:** the largest |method − per-site| over the tile's peak, then the RMS over the peak.
- **Asserted:** the GPU path stays within the composed a-priori arithmetic bound of the float64 method at every site (bound 1.03e-5 relative; measured at most 8.1e-7), and each method error stays within its pinned value (measured plus 5 %, two significant digits; `ROLLOUT_PINNED_METHOD_ERROR`). `test/webgpu-rollout.test.ts` checks four of the cases in every CI run, on the in-process float32 emulation.

Measured on SwiftShader (Chromium 141 headless; float64 gives the same numbers to 1e-6):

| Preset | Exact sampling, centre: max / RMS of peak | Exact sampling, off-axis | Sub-site PSF, off-axis |
| --- | --- | --- | --- |
| uniform | 2.38 % / 0.95 % | 1.70 % / 0.70 % | 1.52 % / 0.82 % |
| slanted-edge | 1.79 % / 0.46 % | 1.65 % / 0.71 % | 1.48 % / 0.82 % |
| siemens-star | 24.9 % / 6.5 % | 1.65 % / 0.71 % | 1.48 % / 0.82 % |
| step-wedge | 2.36 % / 0.97 % | 1.46 % / 0.63 % | 1.48 % / 0.82 % |
| grey-ramp | 2.24 % / 0.93 % | 1.59 % / 0.69 % | 1.48 % / 0.82 % |
| checkerboard | 2.38 % / 0.76 % | 1.65 % / 0.71 % | 1.48 % / 0.83 % |
| point-grid | 2.55 % / 0.71 % | 1.22 % / 0.51 % | 16.8 % / 7.4 % |
| patches | 2.35 % / 0.89 % | 1.71 % / 0.71 % | 1.97 % / 0.98 % |

What the numbers show:

- **Isoplanatic patches (1.2–2.5 % everywhere):** even a uniform scene shows this error. The convolution scatters each source with its own patch's kernel, so where the kernel changes at a patch boundary a flat field is no longer flat, although energy is conserved overall. The per-site engine gathers with each destination's own PSF and stays flat. The error grows with the PSF change across one patch; this stress-test PSF changes by up to 12 % in width over 8 sites. Smaller patches or a slower-varying PSF reduce it.
- **Sub-site PSF sampling (point-grid, 16.8 %):** with 2 µm PSF samples the per-site engine samples the scene at points between site centres and resolves a disk edge inside the tile. The method sees only site-centre radiance and interpolates bilinearly.
- **Siemens-star centre (24.9 %):** near the centre the sectors are narrower than a site, and both paths take one radiance sample per site or per PSF tap. Diagonal site centres lie exactly on sector boundaries (36 cycles), where float rounding decides the material. This is point-sampling aliasing that neither path resolves, rather than an error of one path.
- **Rollout status:** each fixture's numbers above are what a caller accepts when using the fast path for that fixture with this kind of PSF. None of them is a bound, and none applies to another lens without measuring it again.

## Measured conformance (SwiftShader, Chromium 141 headless)

`npm run test:webgpu` (89 tests in three files, including the [rollout](#per-fixture-rollout-method-error)) runs the WGSL kernels on a real WebGPU device. It compares every sample against the float64 reference computed in Node and asserts the bound. Measured during development of this backend with Google SwiftShader (a Vulkan CPU implementation):

| Stage | Corpus | Measured maximum | Reported bound |
| --- | --- | --- | --- |
| Temporal sum, rolling and global, sub-site and integer motion | 257×129 K=1, 200×150 K=9, 160×120 K=32, 120×160 K=5; nine-decade samples | relative 2.1e-7 … 5.3e-7 | relative 5.4e-7 … 2.4e-6 |
| Sensor stage, six regimes (unit and fractional gain, 12–16 bit, three noise sources, INL, exact and inexact digital gain, noise-free) | 256×128 sites: zero, multiplication, PTRS and normal-approximation means; capacity and pre-ADC saturation; dark signal | 0 differing sites. 111–143 flagged (0.3–0.4 %; 95–117 before the #471 margins); 823 flagged (2.5 %; 804 before) with the inexact digital gain 1.3, whose products land on exact half-code ties | exact except flagged sites |
| Sensor stage with fixed-pattern noise (PRNU 1 %, DSNU 20 %, 1 % hot pixels × 40, row 1.5 e⁻ and column 0.75 e⁻ RMS) and three additional components (two Poisson, one fractional deterministic), five regimes | 256×128 sites, same corpus plus the extras | 0 differing sites. 131–154 flagged (0.4–0.5 %; 104–129 before #471); 1466 flagged (4.5 %; 1443 before) with the inexact digital gain 1.3 | exact except flagged sites |
| Sensor statistics | five uniform patches × 4096 sites, 3–20 000 e⁻ | GPU and reference moments identical (18 flagged sites); both within the model tolerances | statistical (above) |
| Convolution | 257×193 r=0 … 64×64 r=32, nine-decade grids, field-varying anisotropic kernels | relative 1.4e-7 (r=0) … 3.8e-6 (r=32) | relative 2.4e-7 … 2.5e-4 |
| SDR, 8 and 16 bit, identity/Reinhard, clip/reject, f32/f64 | 300×41 with code centres, near-ties, transfer breakpoints, ±0, clipping | 1 code (0.0–4.9 % of samples differ) | 1 code |
| RAW development, all four orientations, clip/reconstruct, ideal and non-white-normalized cameras, with and without WB gains | 96×64 synthetic Bayer RAW (random codes, black levels, flags, white levels) | 1 code (≤ 0.3 % of samples differ) | 1 (8 bit) … 67 (16 bit) |
| SDR, luminance tone curves: extended Reinhard Lw 2 and 0.5; Naka–Rushton n = 1, 1.6, 4 | 300×41: colours over eight decades of luminance, greys, zeros; 8 bit f32, 16 bit f64, and a mixed-sign 8-bit corpus with luminance cancelling to near zero | 1 code (≤ 0.08 % of samples differ) | 1 (8 bit); 3–30 (16 bit); 1–102 (mixed signs) |
| RAW development, luminance tone curves (same five), WB gains, clip (8 bit) and reconstruct (16 bit) | 96×64 synthetic Bayer RAW | 1 code (≤ 0.15 % of samples differ) | 1 (8 bit); 152–1652 (16 bit) |

Reject-mode corpora that contain samples exactly at 1 ± 2^-52 fail closed with `indeterminate-float32-classification`, as designed. Banded and unbanded GPU output are identical. Abort, busy, out-of-range rejection, and in-flight dispose return the documented domain errors on the real device.

**Speed: no GPU speedup is claimed.** SwiftShader emulates the GPU on the CPU, so its timings say nothing about GPU performance. On this loaded 4-core host it was *slower* than the CPU reference:

| Stage | CPU reference | webgpu-f32 on SwiftShader |
| --- | --- | --- |
| Convolution 1024×768, r=7 | 3.2 s | 5.2 s |
| SDR 1024×768 | 0.28 s | 4.2 s |
| RAW development 1024×768 | 0.8 s | 3.1 s |

The browser test prints these numbers on each run. No SwiftShader timings are given for the temporal sum or the sensor stage, because they would not describe a GPU either. Until hardware timings exist, choose the backend by measuring on the target device.

## Timings at 6–24 MP

**Hardware timings are recorded per device in the [hardware record](WEBGPU_DEVICES.md)**, with the adapter, browser, OS and engine commit of each run. One device, an Apple M5 Pro, has been measured so far: the 6–24 MP benchmark of October 26 and 27, 2026 ([#277](https://github.com/Photivra/photivra/issues/277)) and the 1024 × 768 stage timings of the conformance run in #471 (convolution r7 349 ms CPU / 7.6 ms GPU, SDR 19.2 / 15.5, RAW development 74.9 / 35.4). The development container has no hardware GPU, so no number below is a GPU measurement. `npm run bench:webgpu:hardware` is the reproducible measurement (steps in [Running on hardware](#running-on-hardware)); after its JSON report it prints one line per frame and stage with the GPU milliseconds, the CPU milliseconds (with `PHOTIVRA_WEBGPU_TIMING_CPU=1`) and their ratio CPU ÷ GPU, so a record row copies them without hand arithmetic.

**Workload** (built inside the page, so no large payload crosses the DevTools socket): one 3:2 frame per size. 6 MP is 3000×2000, 12 MP is 4242×2828 and 24 MP is 6000×4000. Each frame goes through:

- the temporal sum, with 8 sub-site nodes;
- the convolution, at radius 7 with 256-site patches;
- the sensor stage, with a 14-bit regime, 2.5 e⁻ read noise, a 50 000 e⁻ capacity and up to 22 800 expected electrons.

**What is measured:** wall-clock milliseconds per stage on the second run, with warm pipelines. Host packing, upload, dispatch and readback are included. The float64 CPU reference is timed on the same inputs only on request.

- The hardware run refuses a software adapter, so its numbers are GPU numbers. Still check the report's `adapter`: `softwareAdapter` must be false.
- The script was run in this container only at 0.06 MP on SwiftShader, to check that it works. That run measured nothing about GPUs, and its numbers are deliberately not recorded.

## Shipped shader text

From 2.14 (#536) the published package carries the engine's WGSL without comments or indentation. `npm run build` runs
`scripts/minify-wgsl-dist.mjs` after `tsc`; it rewrites only template literals tagged `/* wgsl */`
(`scripts/lib/wgsl-minify.mjs`), and only in ways that cannot change the WGSL token stream:

- line comments are removed and block comments (which nest in WGSL) become one space;
- spaces and tabs at the start and end of a line are removed;
- every newline stays, so line numbers, source maps and line-anchored edits such as `/^const SLACK: f32 = …\n/m` still hold;
- a line holding a `${…}` interpolation, the literal's first and last lines, and any literal where a block comment or an
  escape could interact with them are left exactly as written.

WGSL treats comments and whitespace only as token separators, and the build fails if any literal's tokens, line count or
count of tagged literals changes. The tests and the WebGPU suites run the same minified text (a Vite plugin in the Vitest
configs, and the conformance page's server); `PHOTIVRA_WGSL_MINIFY=0` runs the source text instead.
`test/wgsl-minify.test.ts` checks every literal with an independent tokenizer and every text anchor the engine uses to edit
its own shaders (`display-view-chart-material-module.ts`, `display-view-composite-material-module.ts`,
`wgsl-chart-composite-kernel.ts`). On the Apple M5 Pro (Chromium 153, hardware adapter), `npm run test:webgpu` passed all
167 tests with the minified and with the source text, and the 2,911 recorded values of the two runs (maxima, bounds,
differing and flagged counts) were identical; only the stage timings differ.

## Running on hardware

The conformance suite and the timing run are the two checks to make on a real GPU. Every hardware run goes into the [hardware record](WEBGPU_DEVICES.md) (device, adapter, driver, browser, OS, engine commit, result, timings file); so far one device, an Apple M5 Pro, has been run; its October 27, 2026 runs after the #471 changes passed every non-composite test and were refused by the composite probe, and its runs with the rounding barrier (#507), at the 2.11.0 release gate on `main` at 78f2731 (October 28, 2026) the 2.16.0 release gate on ecb1068 and last at the 2.17.0 release gate on ae0f8f4 (both November 7, 2026), passed 167 of 167 tests and 26 of 26 acceptance cases (below). Other devices are #475. In this container, `npm run test:webgpu:hardware` was run only to confirm that it refuses SwiftShader.

**Once:**

1. Use a machine with a WebGPU-capable GPU and an up-to-date Chrome or Chromium (WebGPU ships in Chrome 113+ on Windows and macOS; on Linux it needs Vulkan drivers).
2. In the repository: `npm ci`.

**Conformance (accuracy on your GPU):**

```sh
npm run test:webgpu:hardware
```

- This runs all three suite files with `PHOTIVRA_WEBGPU_ADAPTER=hardware` (hardware Chromium flags), `PHOTIVRA_WEBGPU_REQUIRED=1` (fail instead of skip) and `PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1`. A software adapter such as SwiftShader then fails every test instead of passing on the CPU. The script (`scripts/run-webgpu-hardware.mjs`) works the same on Linux, macOS and Windows.
- One file only: `npm run test:webgpu:hardware -- test/webgpu/conformance.webgpu.ts`. The rollout file spends about two minutes computing the per-site CPU reference.
- **If it reports a software adapter or no adapter:** first try a visible window, `PHOTIVRA_WEBGPU_HEADLESS=0` (headless mode exposes the GPU on fewer platforms). Then point to your browser with `PHOTIVRA_WEBGPU_BROWSER=/path/to/chrome`. Then set your own flags with `PHOTIVRA_WEBGPU_FLAGS="…"`. Chrome's `chrome://gpu` page shows whether WebGPU is hardware accelerated.
- A pass means every float32 result on your device was within its stated bound. A failure names the stage, the sample and the bound, which is the evidence for a non-conforming driver (see [Limitations](#limitations)).

**Timings (speed on your GPU):**

```sh
PHOTIVRA_WEBGPU_TIMING_OUT=webgpu-timings.json npm run bench:webgpu:hardware
```

- Optional settings: `PHOTIVRA_WEBGPU_TIMING_MP=6,12,24` (the default sizes) and `PHOTIVRA_WEBGPU_TIMING_CPU=1` (also time the float64 CPU reference on the same inputs; this takes minutes at 24 MP).
- On Windows `cmd`, set variables first: `set PHOTIVRA_WEBGPU_TIMING_OUT=webgpu-timings.json`, then `npm run bench:webgpu:hardware`.

- After the JSON report, the run prints one summary line per frame and stage: GPU milliseconds, CPU milliseconds (when timed) and the ratio CPU ÷ GPU, formatted for the record.

**The composite probe re-run (the M5 Pro finding of October 27, 2026).** On the commit with the probe fix (the branch `composite-probe-metal` until it is merged, then `main`):

```sh
npm ci && npm run build
npm run accept:gpu:hardware -- --record display-view-acceptance-m5-pro-<date> 2>&1 | tee accept-gpu.log
grep "composite probe" accept-gpu.log
PHOTIVRA_REPORT_FILE=webgpu-stages-report.json npm run test:webgpu:hardware -- test/webgpu/stages.webgpu.ts -t "composite chart probe"
npm run test:webgpu:hardware 2>&1 | tee test-webgpu-hardware.log
```

- The acceptance run prints one line per case, `case <id> <chart> <options>: composite probe class <class>, product path <path>, fma <fused|not fused>` with the differing components and their input indices, on a GPU render and on a refusal; the record (`--record`) keeps it in each case's execution label. The second command runs only the probe test (a minute) and writes the full record (classes, counts, input indices, the first eight differences' float32 bits) to `webgpu-stages-report.json`.
- **Reading it (with the rounding barrier, 2.11.0):** class `exact` with product path `dekker` and every case compared and passing is the expected result on the M5 Pro (measured, above). Without the barrier, the probe-fix commit read as follows: class `contracted` with product path `fma` would have confirmed the fusion hypothesis; then every case should be compared and pass. Class `exact` with path `dekker` would mean the earlier refusal was not reproduced. Class `reassociated` (or `other`) means the fma path does not apply ([the next option](#composite-charts-chart-elements-and-mask-layers-477)); post the line and the report file either way.

**Record** each run as a row of the [hardware record](WEBGPU_DEVICES.md) ("Adding a row" there), and post the same facts in the tracking issue (#475; #277, which tracked the capture path, is closed): the JSON report (it includes the adapter vendor and architecture), the GPU model, driver version, browser version, OS and engine commit. Only these runs can support a GPU speed claim. The suites never assert a speed.

## Preview acceptance

The release gate of the GPU display view (the app's preview, [Display view](DISPLAY_VIEW.md#preview-acceptance), where the owner's command for a Mac is): `scripts/accept-display-view-gpu.mjs` (#480) renders the app's request with a "reference" producer and a "candidate" producer and compares their noise-free expected images per pixel. The reference is always the CPU display view (`scripts/lib/display-view-cpu-producer.mjs`, in Node). The candidate is:

- **`--gpu`: the GPU** (`scripts/lib/display-view-gpu-producer.mjs`, with its browser half `scripts/lib/display-view-gpu-page.mjs`). It launches headless Chromium with the WebGPU suite's dependency-free driver (`test/webgpu/chromium.ts`, loaded through Node's TypeScript type stripping, Node 22.18 or later; the loopback server now also serves `dist/` and `scripts/lib/`), and in the page runs the built engine as an application does: one `createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail" })` owns the device and the view is prepared with `prepareDisplayView(request, { gpu: "require", gpuDevice })`, so the realm's switch, the self-check and every refusal behave as in the app. The whole view (or `--region`) is rendered once through the internal `renderPreparedDisplayViewWithInternals` (`src/facade/simulate-display-view.ts`: the same render as `render`, which also returns the renderer's expected values and noise σ) and read back to Node in 16 MiB chunks. The adapter is SwiftShader by default and the hardware one with `--hardware` (`PHOTIVRA_WEBGPU_ADAPTER=hardware` and `PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1`), with the suite's other switches (`PHOTIVRA_WEBGPU_BROWSER`, `PHOTIVRA_WEBGPU_FLAGS`, `PHOTIVRA_WEBGPU_HEADLESS`). `npm run accept:gpu` and `npm run accept:gpu:hardware` are the two forms.
- **It fails loudly.** A view the GPU cannot render throws the engine's reason under `"require"`, which fails the case. Each returned render must also carry `backend: "webgpu-f32"`, no fallback reason, `arithmetic: "float32"`, a passed conformance self-check and an error bound, and with `--hardware` a hardware adapter (`gpuRenderProblem` in `scripts/lib/display-view-acceptance.mjs`, tested); otherwise the case errors and the run prints `FAIL`. The execution label (backend, adapter, software adapter or not, conformance, bound, browser) of every case is printed and recorded. The one planned exception is listed as such: `app-defocus` (below) refused with `unsupported-on-backend` is an **expected fallback**, printed with the reason and not compared, until the GPU renders `lens.defocus` (#492, step 2c).
- **Otherwise the CPU display view again** (the self-check, which must show exact equality), or `--candidate path/to/producer.mjs`, whose contract (`createProducer(context, options)` returning `{ name, render(options, view), close? }` with the expected values, noise σ, samples and its own render time) is documented in the CPU producer.

```sh
npm run accept:gpu -- --sizes 2028x1352 --region 0,612,2028,128              # SwiftShader: a check of the kernels' arithmetic on a band of each view, not GPU performance
npm run accept:gpu:hardware -- --record display-view-acceptance-<device>-<date>   # every case on a hardware adapter
node scripts/accept-display-view-gpu.mjs --scene material-function            # the CPU self-check of #480 (exact equality)
```

- **Cases:** the app's composite chart (`app`: `APP_CHART` of `scripts/lib/display-view-app-request.mjs`), the same request focused at 0.8 × the subject distance with `lens.defocus: { model: "geometric-disc" }` (`app-defocus`, Speed only; #492) and the five fixture charts (slanted edge, Siemens star, bar groups, dead leaves, step wedge) at the app's view sizes 2028 × 1352 and 2800 × 1867, Speed and Quality, in the app's request shape (`scripts/benchmark-display-view.mjs --app`: 24 MP 6 µm, the 2 × 2 box, the chart 0.42 m wide at 0.63 m, f/8, ISO 100; Quality adds diffraction, the four-spot filter and AHD): 26 cases. `--sizes`, `--charts`, `--options`, `--region x,y,width,height` (one region of every view, rendered by both producers), `--f` and `--workers` select subsets and parallelism.
- **The scene: the app's form, with a generic label.** `--scene material-layers` (the default) gives the scene as the app gives it to the GPU (Photivra/apps#130): the chart under a printed label declared as a shape-mask layer, `{ kind: "material-layers", sceneId, chart, layers }` (#491). The app's own label (its logo and text outlines) is the app's artwork and is not reproduced in this repository; the harness uses a generic, engine-authored stand-in, `standInLabelLayer`: the label layer of the engine's composite fixtures (`test/helpers/chart-composite-fixtures.ts`, tested equal) in the same place (0.44 frame units wide, 0.03 from the left and bottom edges, a 0.05 plate printed in 0.8 ink) with polygons with holes, curved edges, stroked rectangles and an annulus. Its edge count and shapes differ from the app's label, so its lookup cost and flagged fraction do too. `--scene material-function` is #480's first form (the stand-in label `labelInk` in a caller function), which the GPU refuses; it runs the CPU self-check.
- **Metrics, per pixel:** ΔE2000 between the two noise-free expected sRGB display colours (the engine's own CIEDE2000 and CIELAB, the formula of `calculateColorDifference` after Sharma, Wu and Dalal 2005, with the sRGB matrix and D65 white of `resolveRgbColorSpace("srgb")`; the reduction is `scripts/lib/display-view-acceptance.mjs`, tested in `test/display-view-acceptance.test.mjs` on identities computed from the definitions, since no published CIEDE2000 test pairs are asserted in this repository, `THIRD_PARTY.md`), and the expected-value difference of each component in units of the reference's noise σ for that component. It also reports the maximum difference in 8-bit codes, the identical-pixel fraction and whether the drawn samples and the noise σ are identical.
- **The reference's realm (`--reference`).** With `--gpu` the candidate is judged against the CPU display view rendered in the same browser page (`browser`, the default), as `test:webgpu` judges the kernels: ECMAScript does not fix the last bit of `Math.atan2`, Chromium and Node differ there (#471), and a lattice point exactly on a Siemens star's sector boundary then falls in the other sector. On SwiftShader the GPU matched the browser's reference on the bar star (largest ΔE2000 below 10⁻⁴), while the browser's and Node's CPU references differed by up to ΔE2000 23 and 54 σ at 27 display pixels near the star's diagonals in a 2028 × 128 band. Node's CPU reference is still rendered: its difference from the browser's is printed and recorded per case (`realm`), as information, not a threshold. `--reference node` judges against Node's instead.
- **Thresholds** (parameters; the defaults are #473's, confirmed unchanged by the owner in #483 on October 27, 2026): at least 99 % of pixels within ΔE2000 1 (`--within-fraction`, `--within-de`), none above 2.3 (`--max-de`), no pixel's expected value moved by more than 1 σ (`--max-sigma`). The script prints pass or fail per threshold per case and exits non-zero on a failure or an errored case.
- **Difference images:** one PNG per case (the engine's own encoder; |Δ| in 8-bit codes × `--gain`, default 16, black is no difference) with "Difference image, not a capture" in its text metadata. The "no structured difference at 1:1" check is the owner's visual review of these images, which the product rules require for shipped imagery; the script lists the files and does not judge it.
- **SwiftShader is slow at this size.** On the 4-vCPU development host a full-width 32-row band of the app's Speed view at 2028 × 1352 took 75 s on SwiftShader (the composite material module's double-float32 lookups on a CPU), so a whole view would take about 50 minutes; a whole-view run was stopped after 41 minutes. A SwiftShader run therefore compares a band (`--region`); the whole views are the hardware run's. These are CPU times of a software adapter, not GPU performance.
- **Times:** the GPU producer reports the first render as the candidate's time (it includes the device's conformance self-check and the pipelines' compilation, which an app's first view pays too), and in `candidateTimings` the adapter and device acquisition, the prepare, later renders (`--repeat n`) and the page round trip with readback. On SwiftShader these are not GPU performance. **`--timing`:** next to them, the reference timed as the benchmark does (prepare once, sampled 96 × 96 parts, the whole view's CPU time extrapolated). The CPU pool's wall time to fully sharp with 4 and 12 workers is measured in the app (Photivra/apps), not here.
- **Record:** `--record <name>` writes `docs/validation/<name>/README.md` and `results.jsonl` in the format of [display-view-2026-10-26](validation/display-view-2026-10-26/README.md), with the execution label and any expected fallback; one folder per device and date. The self-check record is [display-view-acceptance-self-check-2026-10-27](validation/display-view-acceptance-self-check-2026-10-27/README.md). Hardware runs are the owner's: the M5 Pro's are recorded ([hardware record](WEBGPU_DEVICES.md)); the integrated-GPU laptop and a phone are #475.

## Browser support and running the suite

- WebGPU requires a secure context (HTTPS or localhost).
  - Shipped: Chromium-based browsers (Chrome/Edge 113+ on Windows, macOS and ChromeOS; Android 121+).
  - Behind flags or partial: Safari and Firefox, depending on version and platform.
  - Elsewhere the accelerator reports `webgpu-unavailable` and, with `fallback: "cpu-reference"`, runs the reference.
- Little-endian hosts only (all current WebGPU platforms).
- The device is requested with `maxStorageBufferBindingSize` and `maxBufferSize` set to the adapter maximum, capped at 1 GiB. Adapters below 16 MiB are refused (`insufficient-limits`).

To run the conformance suite on SwiftShader (the default; see [Running on hardware](#running-on-hardware) for a GPU):

```sh
npm run test:webgpu                       # skips with a message when no browser/adapter is available
PHOTIVRA_WEBGPU_REQUIRED=1 npm run test:webgpu   # fail instead of skip
```

How the suite finds and launches a browser:

- **Browser lookup:**
  1. `PHOTIVRA_WEBGPU_BROWSER` (path to a Chromium/Chrome binary);
  2. Playwright's Chromium under `PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`, `~/.cache/ms-playwright`, `~/Library/Caches/ms-playwright` or `%LOCALAPPDATA%\ms-playwright`;
  3. the usual Chrome and Chromium locations on Linux, macOS and Windows.
- **Default flags** expose SwiftShader in headless mode: `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader`. `PHOTIVRA_WEBGPU_ADAPTER=hardware` switches to hardware flags (`--enable-unsafe-webgpu --ignore-gpu-blocklist`, plus `--enable-features=Vulkan --use-angle=vulkan` on Linux; not verified here, since the container has no GPU). `PHOTIVRA_WEBGPU_FLAGS` overrides both, and `PHOTIVRA_WEBGPU_HEADLESS=0` opens a visible window.
- **Adapter policy:** each run reports the adapter and whether it is a software adapter. `PHOTIVRA_WEBGPU_REQUIRE_HARDWARE=1` turns a software adapter into a failure.
- **No dependencies:** the driver talks to the browser over the DevTools protocol and serves `src/` transpiled over loopback. It adds no npm dependency.

**CI.** The suite runs as its own workflow, [`webgpu.yml`](../.github/workflows/webgpu.yml) (two parallel jobs since 2.22.0, `webgpu conformance (SwiftShader, 1/2)` and `webgpu conformance (SwiftShader, 2/2)`: part 2 runs `test/webgpu/display-view-quality.webgpu.ts`, the display view's Quality and defocus cases, and part 1 every other suite file), on `ubuntu-latest` with `PHOTIVRA_WEBGPU_REQUIRED=1` in Playwright's Chromium, installed in the job with `npx playwright@1.63.0 install --with-deps chromium` (Chromium build 1243, Chrome for Testing 153.0.8010.12; the suite adds no npm dependency, and the pin is bumped only after a local run on the new build). It runs on every pull request that changes `src/gpu/`, `test/webgpu/`, `vitest.webgpu*.config.ts` or the workflow, on every push to `main`, and on manual dispatch; a run took about four minutes when the job was added (the three suite files took 184 s on the 4-core development host); with the display-view Speed, Quality and defocus fixtures it takes about 12 minutes without defocus (#495) and over 20 with it (#499), so the job's limit is 45 minutes. It is a software-adapter check of the kernels' arithmetic, not a GPU measurement; hardware runs are recorded in the [hardware record](WEBGPU_DEVICES.md). The in-process unit tests (`test/image-kernel-accelerator.test.ts`, `test/packed-sensor-raw.test.ts`, `test/packed-sensor-fixed-pattern.test.ts`, `test/temporal-exposure-sum.test.ts`, `test/webgpu-luminance-tone.test.ts`, `test/chart-radiance-batch.test.ts`, `test/lens-psf-kernels.test.ts`, `test/webgpu-rollout.test.ts`) run in every CI leg. They drive the complete host path (acquisition, banding, readback, counters, loss, error scopes, abort, dispose) against a float32 JavaScript emulation of the kernels.

## Limitations

- These are approximations within the stated bounds, not the reference. Use `cpu-reference` for evidence, hashes, fixtures and anything that needs bit identity.
- The bounds assume a device that meets the WGSL accuracy table ([Error bounds](#error-bounds-a-priori-reported-per-result)). A `log`, `exp`, `sqrt`, `pow` or flush-to-zero behaviour outside the table would void them; the conformance suite is how a device is checked, and an unflagged differing site in `test/webgpu/stages.webgpu.ts` is the evidence. The sensor-stage margins no longer assume correctly rounded division or a fixed summation order (#471): the integer parts of the ADC input are integer arithmetic and every sum carries an order-independent bound. What they still assume is that each `+`, `−`, `×` written in the kernel is one WGSL operation (one rounding, either direction) and that `floor` is exact; an implementation that evaluated `x − floor(x)` in extended precision or fused it with a neighbouring sum would not break them either, since the result could only be closer to exact. Polynomial evaluations (the Box–Muller logarithm and cosine, PTRS's g(t)) assume Horner order; another association changes their constants by a small factor that the doubled margin absorbs.
- The convolution, temporal-sum, SDR and RAW-development bounds take u = 2^-24 (round-to-nearest). On a device that rounds `+ − ×` in another direction, which WGSL permits, they hold with u = 2^-23, that is doubled. Every device measured so far rounds to nearest.
- The float64 reference itself is realm-dependent in one place: ECMAScript does not fix the last bit of `Math.atan2`, so the Siemens-star material of a point exactly on a sector boundary can differ between JavaScript engines (see [Scene radiance on the GPU](#scene-radiance-on-the-gpu)). `webgpu-f32` flags and recomputes such points in its own realm.
- The convolution is a primitive. `resolveLensPsfConvolutionKernels` builds its kernels from a `LensPsfProfile` (with spectral weighting); vignetting, depth-dependent defocus and occlusion are not part of it.
- The sensor stage's fixed-pattern values are evaluated on the host (float64, once per site). They depend only on the sensor instance, so a caller rendering many frames of one sensor pays this per frame; caching them across frames is not built. The temporal sum covers rigid translation only.
- GPU scene radiance covers the engine's chart presets, composites, elements and declared `material-layers` scenes (#477). Caller scene functions run on the CPU, and the native environment task's batched provider (#319) is not yet connected to `evaluateChartRadiance`; `mapEnvironmentDirectionsToChartPoints` is the seam.
- The rollout's method errors hold for its synthetic PSF, patch size and tiles only, and are not bounds.
- Still open (#475; #277 is closed): hardware timings and conformance on devices other than the M5 Pro, a 4-core integrated-GPU laptop and a phone. The M5 Pro's 6–24 MP timings and its conformance re-runs are in the [hardware record](WEBGPU_DEVICES.md).
