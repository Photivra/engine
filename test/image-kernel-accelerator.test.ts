// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { calculateIrradianceConvolution, createImageKernelAccelerator, createNativeCaptureSdrTask, createNativeRawDevelopmentTask, getWebGpuEnabled, ImageKernelExecutionError,
  InvalidConfigurationError, setWebGpuEnabled,
  calculateIrradianceConvolutionPlan, WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND, WEBGPU_F32_UNIT_ROUNDOFF, type ImageKernelAccelerator, type IrradianceConvolutionInput,
  type NativeCaptureSdrInput, type NativeCaptureSdrProvider, type NativeCaptureSdrTile, type NativeRawDevelopmentInput } from "../src/index.js";
import { float32Gamma, integerCodeBound } from "../src/gpu/image-kernel-execution.js";
import { rawDevelopmentErrorBounds } from "../src/gpu/image-kernel-accelerator.js";
import { linearDispatch } from "../src/gpu/webgpu-runtime.js";
import { encodeSrgbComponent } from "../src/color/srgb-transfer.js";
import { createFakeGpu, type FakeGpuOptions } from "./helpers/fake-webgpu.js";
import { convolutionCorpus, copyRawDevelopmentInput, nonSrgbColorProfile, sdrCorpus, sdrInput, sdrProfile, syntheticRawDevelopment } from "./helpers/webgpu-fixtures.js";
import { loadPhotographicExportInput } from "./helpers/photographic-export-fixture.js";

function tiles(packed: Float32Array | Float64Array, width: number, hooks: Partial<NativeCaptureSdrProvider> = {}): NativeCaptureSdrProvider {
  return {
    async readTile(r): Promise<NativeCaptureSdrTile> {
      const samples = new (packed.constructor as Float64ArrayConstructor)(r.width * r.height * 3);
      for (let y = 0; y < r.height; y++) samples.set(packed.subarray(((r.y + y) * width + r.x) * 3, ((r.y + y) * width + r.x + r.width) * 3), y * r.width * 3);
      return { ...r, rowStrideSamples: r.width * 3, samples };
    },
    async yieldControl(): Promise<void> {},
    ...hooks
  };
}
async function sdrReference(input: NativeCaptureSdrInput, packed: Float32Array | Float64Array, width: number): Promise<Awaited<ReturnType<ReturnType<typeof createNativeCaptureSdrTask>["takeOutput"]>>> {
  const task = createNativeCaptureSdrTask(input, tiles(packed, width));
  await task.run();
  return task.takeOutput();
}
async function fake(options: FakeGpuOptions = {}, maximumBandBytes?: number): Promise<{ accelerator: ImageKernelAccelerator; controls: ReturnType<typeof createFakeGpu>["controls"] }> {
  const { gpu, controls } = createFakeGpu(options);
  const accelerator = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu, ...(maximumBandBytes ? { maximumBandBytes } : {}) });
  return { accelerator, controls };
}
async function reason(promise: Promise<unknown>): Promise<string> {
  return promise.then(() => "resolved", (error: unknown) => error instanceof ImageKernelExecutionError ? error.reason : (error as Error).name);
}
function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

describe("isoplanatic irradiance convolution reference", () => {
  it("validates geometry, arrays, kernel energy and sample domain", () => {
    const valid = convolutionCorpus(8, 6, 1, 4, 3, 1);
    expect(calculateIrradianceConvolutionPlan(valid)).toMatchObject({ patchColumns: 2, patchRows: 2, tapCount: 9 });
    const bad: ((v: IrradianceConvolutionInput) => void)[] = [
      (v: IrradianceConvolutionInput): void => { (v as { schemaVersion: string }).schemaVersion = "9"; }, (v: IrradianceConvolutionInput): void => { (v as { boundary: string }).boundary = "reflect"; },
      (v: IrradianceConvolutionInput): void => { v.width = 0; }, (v: IrradianceConvolutionInput): void => { v.kernelRadius = 33; }, (v: IrradianceConvolutionInput): void => { v.kernelRadius = 1.5; }, (v: IrradianceConvolutionInput): void => { v.patchWidth = 9; },
      (v: IrradianceConvolutionInput): void => { v.samples = new Float64Array(3); }, (v: IrradianceConvolutionInput): void => { v.kernels = new Float64Array(3); }, (v: IrradianceConvolutionInput): void => { v.samples[2] = -1; },
      (v: IrradianceConvolutionInput): void => { v.samples[2] = NaN; }, (v: IrradianceConvolutionInput): void => { v.samples[2] = 2 ** 101; }, (v: IrradianceConvolutionInput): void => { v.kernels[0] = 2; }, (v: IrradianceConvolutionInput): void => { v.kernels.fill(.2); },
      (v: IrradianceConvolutionInput): void => { v.kernels[3] = -.1; }, (v: IrradianceConvolutionInput): void => { (v as unknown as Record<string, unknown>).extra = 1; }, (v: IrradianceConvolutionInput): void => { v.width = 20_000; },
      (v: IrradianceConvolutionInput): void => { v.width = 6000; v.height = 6000; }
    ];
    for (const mutate of bad) { const v = convolutionCorpus(8, 6, 1, 4, 3, 1); mutate(v); expect(() => calculateIrradianceConvolutionPlan(v)).toThrow(); }
    const many = { ...convolutionCorpus(130, 130, 0, 2, 2, 1) };
    expect(() => calculateIrradianceConvolutionPlan(many)).toThrow(/limits/u);
  });
  it("is the identity for a delta kernel and conserves energy away from the boundary", () => {
    const delta = convolutionCorpus(9, 7, 2, 9, 7, 3);
    delta.kernels.fill(0); delta.kernels[12] = 1;
    expect(Array.from(calculateIrradianceConvolution(delta).values)).toEqual(Array.from(delta.samples));
    const point = convolutionCorpus(21, 21, 3, 21, 21, 4);
    point.samples.fill(0); point.samples[10 * 21 + 10] = 5;
    const out = calculateIrradianceConvolution(point).values, kernelSum = Array.from(point.kernels).reduce((s, w) => s + w, 0);
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(5 * kernelSum, 12);
    // A shifted (u, v) displacement lands at source + (u, v).
    expect(out[(10 + 2) * 21 + 10 - 1]).toBeCloseTo(5 * point.kernels[(2 + 3) * 7 + (-1 + 3)]!, 15);
  });
  it("indexes kernels by the source site's patch, not the output site's", () => {
    const input = convolutionCorpus(8, 1, 1, 4, 1, 5);
    input.samples.fill(0); input.samples[3] = 1; // last site of patch 0, spreading into patch 1
    input.kernels.fill(0); input.kernels[3 + 2] = .5; input.kernels[9 + 3 + 2] = .25; // u = +1 in patch 0 and patch 1
    const out = calculateIrradianceConvolution(input).values;
    expect(out[4]).toBe(.5);
  });
});

describe("float32 error-bound arithmetic", () => {
  it("matches Higham's gamma and the integer-code derivation", () => {
    expect(Math.abs(float32Gamma(1) / WEBGPU_F32_UNIT_ROUNDOFF - 1)).toBeLessThan(1e-6);
    expect(float32Gamma(2 ** 25)).toBe(Infinity);
    expect(integerCodeBound(255, 0).maximumAbsoluteCodeDifference).toBe(1);
    expect(integerCodeBound(65535, float32Gamma(6)).maximumAbsoluteCodeDifference).toBe(1);
    expect(integerCodeBound(255, 2).maximumAbsoluteCodeDifference).toBe(255);
    expect(integerCodeBound(65535, 1e-4)).toMatchObject({ maximumAbsoluteCodeDifference: Math.floor(65535 * (12.92e-4 + WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND)) + 1 });
  });
  it("grows the RAW development bound with conditioning and highlight blending", () => {
    const base = { maximumTaps: 2, maximumWeightSum: 1, maximumSiteMagnitude: 1, maximumGain: 2, reconstruct: false, cameraToXyzNorm: 2, xyzToRgbNorm: 5, scale: 1 };
    const clip = rawDevelopmentErrorBounds(base), blend = rawDevelopmentErrorBounds({ ...base, reconstruct: true });
    expect(clip.exposed).toBeGreaterThan(0); expect(blend.exposed).toBeGreaterThan(clip.exposed);
    expect(rawDevelopmentErrorBounds({ ...base, scale: 4 }).exposed).toBeCloseTo(4 * clip.exposed, 20);
  });
  it("declares a transfer bound above the measured float64-vs-float32 sRGB encode difference", () => {
    let worst = 0;
    for (let i = 0; i <= 100_000; i++) { const x = i / 100_000; worst = Math.max(worst, Math.abs(Math.fround(encodeSrgbComponent(Math.fround(x))) - encodeSrgbComponent(x)) - 12.92 * Math.abs(Math.fround(x) - x)); }
    expect(worst).toBeLessThan(WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND);
  });
  it("splits large 1-D dispatches into two dimensions within limits", () => {
    expect(linearDispatch(1, 256, 65535)).toEqual([1, 1]);
    expect(linearDispatch(256 * 70000, 256, 65535)).toEqual([65535, 2]);
    expect(() => linearDispatch(256 * 65535 * 65536, 256, 65535)).toThrow(ImageKernelExecutionError);
  });
});

describe("accelerator backend selection", () => {
  it("rejects malformed options and never falls back without an explicit choice", async () => {
    for (const options of [{ backend: "gpu" }, { backend: "webgpu-f32" }, { backend: "cpu-reference", fallback: "fail" }, { backend: "cpu-reference", maximumBandBytes: 10 },
      { backend: "cpu-reference", powerPreference: "fast" }, { backend: "cpu-reference", signal: 3 }, { backend: "cpu-reference", extra: 1 }]) {
      await expect(createImageKernelAccelerator(options as never)).rejects.toThrow(/options/u);
    }
  });
  it("labels CPU fallback and its reason; fail mode throws a domain error", async () => {
    const fallback = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "cpu-reference" });
    expect([fallback.backend, fallback.requestedBackend, fallback.fallbackReason, fallback.state]).toEqual(["cpu-reference", "webgpu-f32", "webgpu-unavailable", "ready"]);
    expect(await reason(createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail" }))).toBe("webgpu-unavailable");
    for (const [options, expected] of [[{ adapter: "none" }, "adapter-unavailable"], [{ adapter: "throws" }, "adapter-unavailable"],
      [{ device: "throws" }, "device-request-failed"], [{ maxStorageBufferBindingSize: 1024 }, "insufficient-limits"]] as const) {
      expect(await reason(createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu: createFakeGpu(options).gpu }))).toBe(expected);
      const labelled = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "cpu-reference", gpu: createFakeGpu(options).gpu });
      expect(labelled.fallbackReason).toBe(expected);
    }
    const aborted = new AbortController(); aborted.abort();
    expect(await reason(createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu: createFakeGpu().gpu, signal: aborted.signal }))).toBe("aborted");
  });
  it("the one-boolean form resolves to the explicit form and excludes backend", async () => {
    const on = await createImageKernelAccelerator({ webgpu: true, gpu: createFakeGpu().gpu });
    expect([on.backend, on.requestedBackend, on.fallbackReason]).toEqual(["webgpu-f32", "webgpu-f32", null]);
    on.dispose();
    const fellBack = await createImageKernelAccelerator({ webgpu: true });
    expect([fellBack.backend, fellBack.requestedBackend, fellBack.fallbackReason]).toEqual(["cpu-reference", "webgpu-f32", "webgpu-unavailable"]);
    expect(await reason(createImageKernelAccelerator({ webgpu: true, fallback: "fail" }))).toBe("webgpu-unavailable");
    const off = await createImageKernelAccelerator({ webgpu: false, gpu: createFakeGpu().gpu });
    expect([off.backend, off.requestedBackend, off.fallbackReason]).toEqual(["cpu-reference", "cpu-reference", null]);
    for (const options of [{ webgpu: "yes" }, { webgpu: 1 }, { webgpu: true, backend: "webgpu-f32" }, { webgpu: false, backend: "cpu-reference" }, { webgpu: false, fallback: "fail" }]) {
      await expect(createImageKernelAccelerator(options as never)).rejects.toThrow(/options/u);
    }
  });
  describe("the realm's WebGPU switch", () => {
    afterEach(() => setWebGpuEnabled(true));
    it("is on by default, accepts only booleans, and reads back", () => {
      expect(getWebGpuEnabled()).toBe(true);
      for (const value of ["false", 0, null, undefined]) expect(() => setWebGpuEnabled(value as never)).toThrow(InvalidConfigurationError);
      expect(getWebGpuEnabled()).toBe(true);
      setWebGpuEnabled(false);
      expect(getWebGpuEnabled()).toBe(false);
      setWebGpuEnabled(true);
      expect(getWebGpuEnabled()).toBe(true);
    });
    it("off: a working GPU is never asked for, the label says webgpu-disabled, and fail mode throws that reason", async () => {
      setWebGpuEnabled(false);
      const { gpu, controls } = createFakeGpu();
      const labelled = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "cpu-reference", gpu });
      expect([labelled.backend, labelled.requestedBackend, labelled.fallbackReason, labelled.state]).toEqual(["cpu-reference", "webgpu-f32", "webgpu-disabled", "ready"]);
      expect(controls.adapterRequests).toBe(0);
      const viaBoolean = await createImageKernelAccelerator({ webgpu: true, gpu });
      expect(viaBoolean.fallbackReason).toBe("webgpu-disabled");
      expect(await reason(createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu }))).toBe("webgpu-disabled");
      // The reference path is untouched by the switch and gives the reference's bytes.
      const input = convolutionCorpus(16, 8, 1, 16, 8, 7);
      const result = await labelled.convolveIrradiance(input);
      expect(Array.from(result.values)).toEqual(Array.from(calculateIrradianceConvolution(input).values));
      expect(result.execution.bitIdenticalToReference).toBe(true);
    });
    it("on again: the same options acquire the GPU, and an accelerator created while on keeps its device", async () => {
      const { gpu } = createFakeGpu();
      const kept = await createImageKernelAccelerator({ webgpu: true, gpu });
      setWebGpuEnabled(false);
      expect([kept.backend, kept.state]).toEqual(["webgpu-f32", "ready"]);
      setWebGpuEnabled(true);
      const fresh = await createImageKernelAccelerator({ webgpu: true, gpu });
      expect(fresh.backend).toBe("webgpu-f32");
      kept.dispose(); fresh.dispose();
    });
    it("off after creation: an accelerator that has its device runs every operation on the reference, labelled webgpu-disabled (gpu-05 in #702)", async () => {
      const { gpu } = createFakeGpu();
      const kept = await createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu });
      const input = convolutionCorpus(16, 8, 1, 16, 8, 7);
      expect((await kept.convolveIrradiance(input)).execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
      setWebGpuEnabled(false);
      const off = await kept.convolveIrradiance(input);
      expect(off.execution).toMatchObject({ backend: "cpu-reference", requestedBackend: "webgpu-f32", fallbackReason: "webgpu-disabled", bitIdenticalToReference: true });
      expect(Array.from(off.values)).toEqual(Array.from(calculateIrradianceConvolution(input).values));
      const sdr = sdrInput(8, 3, 64, 1, sdrProfile(8, "identity", "clip-components", 0)), packed = sdrCorpus(8, 3, 64, sdr.profile, 1, 1);
      const rendered = await kept.renderNativeCaptureSdr(sdr, tiles(packed, 8));
      expect(rendered.execution).toMatchObject({ backend: "cpu-reference", fallbackReason: "webgpu-disabled" });
      // The accelerator keeps its device: switched on again, the next operation runs on it.
      setWebGpuEnabled(true);
      expect((await kept.convolveIrradiance(input)).execution).toMatchObject({ backend: "webgpu-f32", fallbackReason: null });
      kept.dispose();
    });
  });
  it("destroys a device that arrives after acquisition was aborted", async () => {
    const { gpu, controls } = createFakeGpu({ device: "deferred" }), controller = new AbortController();
    const pending = createImageKernelAccelerator({ backend: "webgpu-f32", fallback: "fail", gpu, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0)); // the adapter has resolved and requestDevice is pending
    controller.abort();
    expect(await reason(pending)).toBe("aborted");
    expect(controls.deviceDestroyCalls).toBe(0);
    controls.resolveDevice();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controls.deviceDestroyCalls).toBe(1);
  });
  it("CPU backend returns the unchanged references with a reference label", async () => {
    const a = await createImageKernelAccelerator({ backend: "cpu-reference" });
    const sdr = sdrInput(40, 9, 64, 1, sdrProfile(8, "identity", "clip-components", 0)), packed = sdrCorpus(40, 9, 64, sdr.profile, 1, 1);
    const out = await a.renderNativeCaptureSdr(sdr, tiles(packed, 40));
    expect(out.integerSamples).toEqual((await sdrReference(sdr, packed, 40)).integerSamples);
    expect(out.execution).toMatchObject({ backend: "cpu-reference", arithmetic: "float64", bitIdenticalToReference: true, errorBound: null, fallbackReason: null });
    const conv = convolutionCorpus(20, 10, 2, 7, 5, 2);
    const c = await a.convolveIrradiance(conv, { yieldControl: async () => {} });
    expect(c.values).toEqual(calculateIrradianceConvolution(conv).values);
    expect(c.outputSum).toBeLessThanOrEqual(c.inputSum);
    const raw = syntheticRawDevelopment({ width: 8, height: 6, orientation: "landscape", seed: 1 }, sdrProfile(8, "identity", "clip-components", 0), nonSrgbColorProfile(), "clip");
    const reference = createNativeRawDevelopmentTask(copyRawDevelopmentInput(raw), async () => {});
    await reference.run();
    expect((await a.developNativeRaw(raw, async () => {})).integerSamples).toEqual(reference.takeOutput().integerSamples);
    const controller = new AbortController(); controller.abort();
    expect(await reason(a.convolveIrradiance(conv, { signal: controller.signal }))).toBe("aborted");
    expect(await reason(a.renderNativeCaptureSdr(sdr, tiles(packed, 40, { readTile: async () => { controller.abort(); throw new Error("x"); } }), { signal: controller.signal }))).toBe("aborted");
    await expect(a.convolveIrradiance(conv, { bad: 1 } as never)).rejects.toThrow(/run options/u);
    a.dispose(); a.dispose();
    expect(await reason(a.convolveIrradiance(conv))).toBe("disposed");
  });
});

describe("webgpu-f32 host path (in-process float32 emulation of the WGSL kernels)", () => {
  it("convolution stays within the declared relative bound, with and without banding", async () => {
    const { accelerator, controls } = await fake();
    const input = convolutionCorpus(37, 29, 3, 10, 9, 8), reference = calculateIrradianceConvolution(input).values;
    const out = await accelerator.convolveIrradiance(input);
    expect(out.values).toBeInstanceOf(Float32Array);
    const bound = out.execution.errorBound!;
    expect(bound.kind).toBe("relative-to-reference");
    if (bound.kind === "relative-to-reference") for (let i = 0; i < reference.length; i++) expect(Math.abs(out.values[i]! - reference[i]!)).toBeLessThanOrEqual(bound.relative * reference[i]! + bound.absolute);
    const banded = await (await fake({}, 4096)).accelerator.convolveIrradiance(input, { yieldControl: async () => {} });
    expect(banded.values).toEqual(out.values);
    expect(controls.created).toBe(controls.destroyed);
    expect(out.execution).toMatchObject({ backend: "webgpu-f32", arithmetic: "float32", bitIdenticalToReference: false });
  });
  it("convolution bound covers kernel weights below 2^-126 (host rounding to zero, subnormals, GPU flush)", async () => {
    const input = (w: number, s = 2 ** 100): IrradianceConvolutionInput => ({ schemaVersion: "0.1.0", width: 4, height: 1, kernelRadius: 0, patchWidth: 2,
      patchHeight: 1, boundary: "zero-outside-grid", samples: new Float64Array(4).fill(s), kernels: Float64Array.from([w, 0.5]) });
    const { accelerator, controls } = await fake();
    // 2^-160 rounds to 0 in float32: error 2^-60 against the old absolute term 2·2^-126.
    for (const [w, s] of [[2 ** -160, 2 ** 100], [2 ** -130, 2 ** 100], [2 ** -126 - 2 ** -149, 3], [2 ** -126, 2 ** 100], [0, 2 ** 100]] as const) {
      const v = input(w, s), reference = calculateIrradianceConvolution(v).values, out = await accelerator.convolveIrradiance(v);
      const bound = out.execution.errorBound!;
      if (bound.kind !== "relative-to-reference") throw new Error("unexpected bound");
      for (let i = 0; i < 4; i++) expect(Math.abs(out.values[i]! - reference[i]!)).toBeLessThanOrEqual(bound.relative * reference[i]! + bound.absolute);
      // Unchanged for weights in the normal range or zero; the flush term scales with the largest sample.
      expect(bound.absolute).toBe(w > 0 && w < 2 ** -126 ? 2 * 2 ** -126 + 2 * s * w : 2 * 2 ** -126);
    }
    // A GPU that flushes the subnormal weight to zero stays inside the bound too.
    const v = input(2 ** -130), out = await accelerator.convolveIrradiance(v), bound = out.execution.errorBound!;
    if (bound.kind !== "relative-to-reference") throw new Error("unexpected bound");
    expect(calculateIrradianceConvolution(v).values[0]!).toBeLessThanOrEqual(bound.absolute);
    expect(controls.created).toBe(controls.destroyed);
  });
  it("convolution GPU memory is bounded by the band, not the image height", async () => {
    const peak = async (height: number): Promise<number> => {
      const { accelerator, controls } = await fake({}, 4096);
      const input = convolutionCorpus(64, height, 1, 64, height, 5);
      await accelerator.convolveIrradiance(input);
      expect(controls.liveBytes).toBe(0);
      return controls.peakLiveBytes;
    };
    const short = await peak(64), tall = await peak(512);
    expect(tall).toBe(short);
    // Kernels plus one band's buffers (source, result, readback, uniform), each at most the band size.
    expect(tall).toBeLessThanOrEqual(9 * 4 + 16 + 4 * 4096);
  });
  it.each([[8, "identity", 32], [16, "positive-reinhard-per-channel", 64], [8, "positive-reinhard-per-channel", 32]] as const)(
    "SDR %i-bit %s float%i within bound; banding-invariant; progress in tile units", async (bits, tone, precision) => {
      const sdr = sdrInput(300, 70, precision, 1.5, sdrProfile(bits, tone, "clip-components", .5)), packed = sdrCorpus(300, 70, precision, sdr.profile, 1.5, bits);
      const reference = await sdrReference(sdr, packed, 300);
      const progress: number[] = [];
      const { accelerator, controls } = await fake({}, 4096);
      const out = await accelerator.renderNativeCaptureSdr(sdr, tiles(packed, 300, { onProgress: p => { progress.push(p.completedTileCount); } }));
      const bound = out.execution.errorBound!;
      expect(bound.kind === "integer-code-difference" && maxDiff(out.integerSamples, reference.integerSamples) <= bound.maximumAbsoluteCodeDifference).toBe(true);
      for (const key of ["renderingNegativeSampleCount", "renderingAboveReferenceSampleCount", "toneChangedSampleCount", "gamutClippedLowSampleCount", "gamutClippedHighSampleCount"] as const) {
        expect(Math.abs(out.diagnostics[key] - reference.diagnostics[key])).toBeLessThanOrEqual(out.execution.diagnosticUncertaintySampleCount);
      }
      expect(progress.at(-1)).toBe(6);
      expect(controls.created).toBe(controls.destroyed);
      const whole = await (await fake()).accelerator.renderNativeCaptureSdr(sdr, tiles(packed, 300));
      expect(whole.integerSamples).toEqual(out.integerSamples);
    });
  it("SDR fails closed for Naka–Rushton below exponent 1, float32 overflow, reference errors and undecidable rejection", async () => {
    const { accelerator } = await fake();
    const luminance = sdrInput(4, 2, 64, 1, { ...sdrProfile(8, "identity", "clip-components", 0), toneCurve: "naka-rushton-luminance",
      toneCurveParameters: { exponent: 0.5, semiSaturation: 0.18, whiteLuminance: 2 } });
    expect(await reason(accelerator.renderNativeCaptureSdr(luminance, tiles(new Float64Array(24), 4)))).toBe("unsupported-on-backend");
    const plain = sdrInput(4, 2, 64, 1, sdrProfile(8, "identity", "clip-components", 0));
    expect(await reason(accelerator.renderNativeCaptureSdr(plain, tiles(new Float64Array(24).fill(1e300), 4)))).toBe("unsupported-float32-domain");
    expect(await reason(accelerator.renderNativeCaptureSdr({ ...plain, profile: { ...plain.profile, renderingExposureEv: 32 } }, tiles(new Float64Array(24).fill(1e300), 4)))).toBe("InvalidScientificResultError");
    const reject = sdrInput(4, 2, 64, 1, sdrProfile(8, "identity", "reject-out-of-range", 0));
    expect(await reason(accelerator.renderNativeCaptureSdr(reject, tiles(new Float64Array(24).fill(2), 4)))).toBe("InvalidConfigurationError");
    expect(await reason(accelerator.renderNativeCaptureSdr(reject, tiles(new Float64Array(24).fill(1), 4)))).toBe("indeterminate-float32-classification");
    const tiny = await accelerator.renderNativeCaptureSdr(plain, tiles(new Float64Array(24).fill(1e-300), 4));
    expect(tiny.execution.diagnosticUncertaintySampleCount).toBeGreaterThan(0);
    expect(tiny.execution.diagnosticsExact).toBe(false);
    await expect(accelerator.renderNativeCaptureSdr(plain, {} as never)).rejects.toThrow(/tile reader/u);
    await expect(accelerator.renderNativeCaptureSdr(plain, { ...tiles(new Float64Array(24), 4), onProgress: 1 } as never)).rejects.toThrow(/onProgress/u);
  });
  it.each([
    ["landscape", "clip", 8, "identity", undefined], ["portrait-clockwise", "reconstruct", 16, "positive-reinhard-per-channel", [1.8, 1, 1.3]],
    ["landscape-inverted", "clip", 16, "positive-reinhard-per-channel", undefined], ["portrait-counter-clockwise", "reconstruct", 8, "identity", undefined]
  ] as const)("RAW development %s %s %i-bit %s within bound and ownership semantics", async (orientation, highlight, bits, tone, gains) => {
    const input = syntheticRawDevelopment({ width: 24, height: 16, orientation, seed: bits, ...(gains ? { gains: [...gains] as [number, number, number] } : {}) },
      sdrProfile(bits, tone, "clip-components", tone === "identity" ? 0 : 1), nonSrgbColorProfile(), highlight);
    const task = createNativeRawDevelopmentTask(copyRawDevelopmentInput(input), async () => {});
    await task.run();
    const reference = task.takeOutput(), codesBefore = input.raw.codes.slice();
    const progress: number[] = [];
    const { accelerator, controls } = await fake({}, 4096);
    const out = await accelerator.developNativeRaw(input, { yieldControl: async () => {}, onProgress: p => { progress.push(p.completedTileCount); } });
    const bound = out.execution.errorBound!;
    expect(bound.kind === "integer-code-difference" && maxDiff(out.integerSamples, reference.integerSamples) <= bound.maximumAbsoluteCodeDifference).toBe(true);
    expect(out.highlight.saturatedPixelCount).toBe(reference.highlight.saturatedPixelCount);
    expect(Math.abs(out.highlight.whiteBalanceClippedSampleCount - reference.highlight.whiteBalanceClippedSampleCount)).toBeLessThanOrEqual(out.execution.diagnosticUncertaintySampleCount);
    expect(Math.abs(out.highlight.reconstructedPixelCount - reference.highlight.reconstructedPixelCount)).toBeLessThanOrEqual(out.execution.diagnosticUncertaintySampleCount);
    expect(out.diagnostics.captureSaturation).toBe("consumed-in-raw-development");
    expect([out.width, out.height]).toEqual([reference.width, reference.height]);
    expect(out.raw.codes).toEqual(codesBefore);
    expect(input.raw.codes.length).toBe(0); // ownership transferred like the reference task
    expect(progress.at(-1)).toBe(reference.height * Math.ceil(reference.width / 256));
    expect(controls.created).toBe(controls.destroyed);
  });
  it("RAW development rejects unsupported luminance tones and bad providers before taking ownership", async () => {
    const { accelerator } = await fake();
    const base = loadPhotographicExportInput();
    const lum = syntheticRawDevelopment({ width: 4, height: 2, orientation: "landscape", seed: 2 },
      { ...base.rendering, toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 0.5, semiSaturation: .5, whiteLuminance: 2 } }, base.colorProfile, "clip");
    expect(await reason(accelerator.developNativeRaw(lum, async () => {}))).toBe("unsupported-on-backend");
    expect(lum.raw.codes.length).toBe(8);
    await expect(accelerator.developNativeRaw(lum, {} as never)).rejects.toThrow(/yield/u);
    const bad = syntheticRawDevelopment({ width: 4, height: 2, orientation: "landscape", seed: 2 }, base.rendering, base.colorProfile, "clip");
    bad.raw.codes[0] = 2000;
    expect(await reason(accelerator.developNativeRaw(bad, async () => {}))).toBe("InvalidConfigurationError");
  });
  it("maps device loss, error scopes, compile failure, abort, busy and dispose onto domain errors and releases buffers", async () => {
    const input = convolutionCorpus(16, 16, 1, 8, 8, 3);
    let f = await fake();
    f.controls.beforeDispatch = (): void => f.controls.loseDevice();
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("device-lost");
    expect(f.accelerator.state).toBe("lost");
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("device-lost");
    for (const scope of ["validation", "out-of-memory"] as const) {
      f = await fake();
      await f.accelerator.convolveIrradiance(input);
      f.controls.failNextScope = scope;
      expect(await reason(f.accelerator.convolveIrradiance(input))).toBe(scope === "validation" ? "gpu-validation" : "out-of-memory");
      expect(f.controls.created).toBe(f.controls.destroyed);
    }
    f = await fake(); f.controls.failPipeline = true;
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("gpu-validation");
    f.controls.failPipeline = false; f.controls.failNextScope = "validation";
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("gpu-validation");
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("resolved");
    f = await fake({}, 4096);
    const controller = new AbortController();
    f.controls.beforeDispatch = (n): void => { if (n === 2) controller.abort(); };
    expect(await reason(f.accelerator.convolveIrradiance(convolutionCorpus(64, 64, 1, 8, 8, 3), { signal: controller.signal }))).toBe("aborted");
    expect(f.controls.created).toBe(f.controls.destroyed);
    f.controls.beforeDispatch = undefined;
    const first = f.accelerator.convolveIrradiance(input);
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("busy");
    await first;
    f.controls.beforeDispatch = (): void => f.accelerator.dispose();
    expect(await reason(f.accelerator.convolveIrradiance(input))).toBe("disposed");
    expect(f.accelerator.state).toBe("disposed");
  });
  it("rejects bands beyond device limits", async () => {
    const { accelerator } = await fake({ maxStorageBufferBindingSize: 16 * 1024 * 1024 });
    const huge = convolutionCorpus(16_384, 2, 32, 16_384, 2, 1, 32);
    huge.kernels.fill(0); huge.kernels[0] = 1;
    await expect(accelerator.convolveIrradiance(huge)).resolves.toBeDefined();
    const raw: NativeRawDevelopmentInput = syntheticRawDevelopment({ width: 4, height: 2, orientation: "landscape", seed: 2 },
      { ...sdrProfile(8, "identity", "clip-components", 0) }, loadPhotographicExportInput().colorProfile, "clip");
    expect(await reason((await fake({ maxStorageBufferBindingSize: 16 * 1024 * 1024 }, 4096)).accelerator.developNativeRaw(raw, async () => {}))).toBe("resolved");
  });
});
