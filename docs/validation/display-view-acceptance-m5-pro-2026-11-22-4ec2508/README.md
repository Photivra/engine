# Preview acceptance, November 22, 2026 (webgpu-f32 against cpu-reference (browser))

`node scripts/accept-display-view-gpu.mjs --gpu --hardware --charts app-lens --options speed` (#480; 2 cases; raw lines in [results.jsonl](results.jsonl)), on commit
`4ec2508`. The candidate is `scripts/lib/display-view-gpu-producer.mjs`, the reference the CPU display view rendered in the same browser page (the GPU's realm; its difference from Node's reference is listed per case in results.jsonl as `realm`).
Each case renders the whole view with both producers in the app's request shape (24 MP 6 µm, 2 × 2 box, the chart 0.42 m wide at 0.63 m with the stand-in label as a declared `material-layers` layer, f/8, ISO 100) and compares
the noise-free expected images per pixel: ΔE2000 (Sharma, Wu and Dalal 2005) between the sRGB display colours, and the expected-value difference of each component in units of the
reference's noise σ. Method and thresholds: [Display view](../../DISPLAY_VIEW.md#preview-acceptance) and [WebGPU](../../WEBGPU.md#preview-acceptance).

Node v26.13.1, 18-vCPU Apple M5 Pro, darwin, one process per case, 1 at a time, load average 4.4 at the start; the run took about 2.1 minutes.

**Status: every case passes every threshold** (thresholds: at least 99.00 % within ΔE2000 1, none above 2.3, no pixel beyond 1 σ).
Where the candidate ran (`diagnostics.fast.execution`): webgpu-f32 on {"vendor":"apple","architecture":"metal-3","device":"","description":""}, conformance self-check passed, Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36.


**Visual review.** The "no structured difference at 1:1" check is the owner's review of the difference images (|Δ| in 8-bit codes × 16, black is no difference; each PNG carries "Difference image, not a capture" in its text metadata):

- `00-app-lens-speed-2028x1352-difference.png`: app-lens, speed, 2028 × 1352 (all black: identical expected images)
- `01-app-lens-speed-2800x1867-difference.png`: app-lens, speed, 2800 × 1867 (all black: identical expected images)

The images were written to the run's `--out` directory, not into this folder (`--record-images` copies them; an all-black PNG of a whole view is several megabytes).

## Every case

| Chart | Options | View | Within ΔE 1 | Max ΔE2000 | Mean ΔE2000 | Max \|Δ\| / σ | Max codes | Identical pixels | Samples identical | σ identical | Reference s | Candidate s | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| app-lens | speed | 2028 × 1352 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 100.00 % | yes | yes | 4.5 | 4.5 | pass |
| app-lens | speed | 2800 × 1867 | 100.00 % | 0.0000 | 0.0000 | 0.000 | 0.00 | 100.00 % | yes | yes | 6.0 | 6.0 | pass |
