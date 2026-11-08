# Preview acceptance, November 8, 2026 (webgpu-f32 against cpu-reference (browser))

`node scripts/accept-display-view-gpu.mjs --gpu --hardware` (#480; 26 cases; raw lines in [results.jsonl](results.jsonl)), on commit
`ae0f8f4`. The candidate is `scripts/lib/display-view-gpu-producer.mjs`, the reference the CPU display view rendered in the same browser page (the GPU's realm; its difference from Node's reference is listed per case in results.jsonl as `realm`).
Each case renders the whole view with both producers in the app's request shape (24 MP 6 µm, 2 × 2 box, the chart 0.42 m wide at 0.63 m with the stand-in label as a declared `material-layers` layer, f/8, ISO 100) and compares
the noise-free expected images per pixel: ΔE2000 (Sharma, Wu and Dalal 2005) between the sRGB display colours, and the expected-value difference of each component in units of the
reference's noise σ. Method and thresholds: [Display view](../../DISPLAY_VIEW.md#preview-acceptance) and [WebGPU](../../WEBGPU.md#preview-acceptance).

Node v24.19.0, 18-vCPU Apple M5 Pro, darwin, one process per case, 1 at a time, load average 2.1 at the start; the run took about 25.4 minutes.

**Status: every case passes every threshold** (thresholds: at least 99.00 % within ΔE2000 1, none above 2.3, no pixel beyond 1 σ).
Where the candidate ran (`diagnostics.fast.execution`): webgpu-f32 on {"vendor":"apple","architecture":"metal-3","device":"","description":""}, conformance self-check passed, Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/157.0.0.0 Safari/537.36.


**Visual review.** The "no structured difference at 1:1" check is the owner's review of the difference images (|Δ| in 8-bit codes × 16, black is no difference; each PNG carries "Difference image, not a capture" in its text metadata):

- `00-app-speed-2028x1352-difference.png`: app, speed, 2028 × 1352
- `01-app-quality-2028x1352-difference.png`: app, quality, 2028 × 1352
- `02-app-speed-2800x1867-difference.png`: app, speed, 2800 × 1867
- `03-app-quality-2800x1867-difference.png`: app, quality, 2800 × 1867
- `04-app-defocus-speed-2028x1352-difference.png`: app-defocus, speed, 2028 × 1352
- `05-app-defocus-speed-2800x1867-difference.png`: app-defocus, speed, 2800 × 1867
- `06-slanted-edge-speed-2028x1352-difference.png`: slanted-edge, speed, 2028 × 1352
- `07-slanted-edge-quality-2028x1352-difference.png`: slanted-edge, quality, 2028 × 1352
- `08-slanted-edge-speed-2800x1867-difference.png`: slanted-edge, speed, 2800 × 1867
- `09-slanted-edge-quality-2800x1867-difference.png`: slanted-edge, quality, 2800 × 1867
- `10-siemens-star-speed-2028x1352-difference.png`: siemens-star, speed, 2028 × 1352
- `11-siemens-star-quality-2028x1352-difference.png`: siemens-star, quality, 2028 × 1352
- `12-siemens-star-speed-2800x1867-difference.png`: siemens-star, speed, 2800 × 1867
- `13-siemens-star-quality-2800x1867-difference.png`: siemens-star, quality, 2800 × 1867
- `14-bar-groups-speed-2028x1352-difference.png`: bar-groups, speed, 2028 × 1352
- `15-bar-groups-quality-2028x1352-difference.png`: bar-groups, quality, 2028 × 1352
- `16-bar-groups-speed-2800x1867-difference.png`: bar-groups, speed, 2800 × 1867
- `17-bar-groups-quality-2800x1867-difference.png`: bar-groups, quality, 2800 × 1867
- `18-dead-leaves-speed-2028x1352-difference.png`: dead-leaves, speed, 2028 × 1352
- `19-dead-leaves-quality-2028x1352-difference.png`: dead-leaves, quality, 2028 × 1352
- `20-dead-leaves-speed-2800x1867-difference.png`: dead-leaves, speed, 2800 × 1867
- `21-dead-leaves-quality-2800x1867-difference.png`: dead-leaves, quality, 2800 × 1867
- `22-step-wedge-speed-2028x1352-difference.png`: step-wedge, speed, 2028 × 1352
- `23-step-wedge-quality-2028x1352-difference.png`: step-wedge, quality, 2028 × 1352
- `24-step-wedge-speed-2800x1867-difference.png`: step-wedge, speed, 2800 × 1867
- `25-step-wedge-quality-2800x1867-difference.png`: step-wedge, quality, 2800 × 1867

The images were written to the run's `--out` directory, not into this folder (`--record-images` copies them; an all-black PNG of a whole view is several megabytes).

## Every case

| Chart | Options | View | Within ΔE 1 | Max ΔE2000 | Mean ΔE2000 | Max \|Δ\| / σ | Max codes | Identical pixels | Samples identical | σ identical | Reference s | Candidate s | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| app | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 1.32 % | no | no | 11.6 | 3.4 | pass |
| app | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 25.04 % | no | no | 27.1 | 24.2 | pass |
| app | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 1.06 % | no | no | 13.4 | 5.2 | pass |
| app | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 24.50 % | no | no | 29.9 | 28.7 | pass |
| app-defocus | speed | 2028 × 1352 | 100.00 % | 0.0001 | 0.0000 | 0.000 | 0.00 | 0.00 % | no | no | 22.5 | 3.1 | pass |
| app-defocus | speed | 2800 × 1867 | 100.00 % | 0.0001 | 0.0000 | 0.000 | 0.00 | 0.00 % | no | no | 24.4 | 4.4 | pass |
| slanted-edge | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.02 % | no | no | 9.4 | 2.3 | pass |
| slanted-edge | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 1.12 % | no | no | 18.7 | 3.9 | pass |
| slanted-edge | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.3 | 3.8 | pass |
| slanted-edge | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 1.07 % | no | no | 21.2 | 5.5 | pass |
| siemens-star | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.21 % | no | no | 10.2 | 2.6 | pass |
| siemens-star | quality | 2028 × 1352 | 100.00 % | 0.0014 | 0.0000 | 0.001 | 0.00 | 10.74 % | no | no | 21.8 | 15.0 | pass |
| siemens-star | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.20 % | no | no | 12.0 | 4.2 | pass |
| siemens-star | quality | 2800 × 1867 | 100.00 % | 0.0018 | 0.0000 | 0.001 | 0.00 | 10.37 % | no | no | 24.5 | 18.4 | pass |
| bar-groups | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.6 | 2.3 | pass |
| bar-groups | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 6.51 % | no | no | 20.7 | 9.5 | pass |
| bar-groups | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 12.8 | 3.8 | pass |
| bar-groups | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 6.31 % | no | no | 23.0 | 11.9 | pass |
| dead-leaves | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 2.21 % | no | no | 11.3 | 3.8 | pass |
| dead-leaves | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.002 | 0.00 | 24.94 % | no | no | 26.1 | 27.6 | pass |
| dead-leaves | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 1.62 % | no | no | 12.5 | 5.6 | pass |
| dead-leaves | quality | 2800 × 1867 | 100.00 % | 0.0016 | 0.0001 | 0.001 | 0.00 | 23.37 % | no | no | 28.8 | 33.3 | pass |
| step-wedge | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 9.2 | 2.2 | pass |
| step-wedge | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 3.25 % | no | no | 18.7 | 8.0 | pass |
| step-wedge | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.0 | 3.7 | pass |
| step-wedge | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 3.18 % | no | no | 21.4 | 10.4 | pass |

## Large disc with `gpu: "auto"` (2.17.0 release gate, #564)

`PHOTIVRA_WEBGPU_ADAPTER=hardware node scripts/accept-large-disc-gpu-fallback.mjs .` on the same build, the same machine and browser (November 7, 2026, local time), raw lines in [large-disc-gpu-auto.jsonl](large-disc-gpu-auto.jsonl). A Siemens star, 600 × 400 at 6 µm, 50 mm f/4, subject 2 m, shown at 300 × 200 through `prepareDisplayView(request, { gpu: "auto" })`:

| Case | `view.defocus` | Backend | Fallback reason and label |
| --- | --- | --- | --- |
| Focus 0.298 m: a disc of kernel radius 179 | `kernel: "disc"`, `defocusKernelRadiusSites: 179`, `convolution: "runs"` | `cpu-reference` (float64, bit-identical to the reference), on adapter `apple` / `metal-3` | `unsupported-on-backend`: "WebGPU was requested (gpu: "auto") and the CPU reference ran: the GPU display-view renderer "photivra-display-view" does not support this request: a defocus kernel radius above 64 sites (convolved by runs on the CPU, #564) is not on the GPU" |
| Control: the same request in focus (focus 2 m) | none (in focus) | `webgpu-f32`, a-priori bound, conformance passed | none |

The large disc is refused by the GPU renderer and renders on the labelled CPU reference; the same request in focus still reaches the GPU.
