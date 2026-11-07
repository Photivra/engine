# Preview acceptance, November 7, 2026 (webgpu-f32 against cpu-reference (browser))

`node scripts/accept-display-view-gpu.mjs --gpu --hardware` (#480; 26 cases; raw lines in [results.jsonl](results.jsonl)), on commit
`ecb1068`. The candidate is `scripts/lib/display-view-gpu-producer.mjs`, the reference the CPU display view rendered in the same browser page (the GPU's realm; its difference from Node's reference is listed per case in results.jsonl as `realm`).
Each case renders the whole view with both producers in the app's request shape (24 MP 6 µm, 2 × 2 box, the chart 0.42 m wide at 0.63 m with the stand-in label as a declared `material-layers` layer, f/8, ISO 100) and compares
the noise-free expected images per pixel: ΔE2000 (Sharma, Wu and Dalal 2005) between the sRGB display colours, and the expected-value difference of each component in units of the
reference's noise σ. Method and thresholds: [Display view](../../DISPLAY_VIEW.md#preview-acceptance) and [WebGPU](../../WEBGPU.md#preview-acceptance).

Node v24.19.0, 18-vCPU Apple M5 Pro, darwin, one process per case, 1 at a time, load average 1.9 at the start; the run took about 26.1 minutes.

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
| app | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 25.04 % | no | no | 26.7 | 24.0 | pass |
| app | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 1.06 % | no | no | 13.3 | 5.2 | pass |
| app | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 24.50 % | no | no | 29.4 | 28.6 | pass |
| app-defocus | speed | 2028 × 1352 | 100.00 % | 0.0001 | 0.0000 | 0.000 | 0.00 | 0.00 % | no | no | 31.2 | 3.9 | pass |
| app-defocus | speed | 2800 × 1867 | 100.00 % | 0.0001 | 0.0000 | 0.000 | 0.00 | 0.00 % | no | no | 28.4 | 5.1 | pass |
| slanted-edge | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.02 % | no | no | 10.1 | 2.3 | pass |
| slanted-edge | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 1.12 % | no | no | 18.4 | 3.9 | pass |
| slanted-edge | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.6 | 3.8 | pass |
| slanted-edge | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 1.07 % | no | no | 20.8 | 5.6 | pass |
| siemens-star | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.21 % | no | no | 10.8 | 2.5 | pass |
| siemens-star | quality | 2028 × 1352 | 100.00 % | 0.0014 | 0.0000 | 0.001 | 0.00 | 10.74 % | no | no | 21.8 | 14.9 | pass |
| siemens-star | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.20 % | no | no | 11.9 | 4.1 | pass |
| siemens-star | quality | 2800 × 1867 | 100.00 % | 0.0018 | 0.0000 | 0.001 | 0.00 | 10.37 % | no | no | 24.0 | 18.0 | pass |
| bar-groups | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.2 | 2.3 | pass |
| bar-groups | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 6.51 % | no | no | 20.5 | 9.5 | pass |
| bar-groups | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 13.1 | 3.7 | pass |
| bar-groups | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 6.31 % | no | no | 22.9 | 11.8 | pass |
| dead-leaves | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 2.21 % | no | no | 11.2 | 3.8 | pass |
| dead-leaves | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.002 | 0.00 | 24.94 % | no | no | 26.0 | 27.7 | pass |
| dead-leaves | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 1.62 % | no | no | 12.7 | 5.6 | pass |
| dead-leaves | quality | 2800 × 1867 | 100.00 % | 0.0016 | 0.0001 | 0.001 | 0.00 | 23.37 % | no | no | 28.6 | 33.2 | pass |
| step-wedge | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 9.1 | 2.2 | pass |
| step-wedge | quality | 2028 × 1352 | 100.00 % | 0.0013 | 0.0001 | 0.001 | 0.00 | 3.25 % | no | no | 18.9 | 8.1 | pass |
| step-wedge | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 0.01 % | no | no | 11.3 | 3.7 | pass |
| step-wedge | quality | 2800 × 1867 | 100.00 % | 0.0015 | 0.0001 | 0.001 | 0.00 | 3.18 % | no | no | 21.2 | 10.0 | pass |
