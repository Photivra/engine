// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal in-process WebGPU double for host-side tests of the image-kernel accelerator. Dispatches run a
 * JavaScript float32 emulation (Math.fround after every operation) of the first-party WGSL kernels, keyed
 * by pipeline label, so packing, banding, readback, counters and lifecycle are exercised without a GPU.
 * Real-GPU conformance lives in test/webgpu (npm run test:webgpu).
 */
import { SDR_COUNTER, SDR_TONE_MODE } from "../../src/gpu/wgsl-kernels.js";
import { createChartMaterialEmulator, emulateChart, emulateSensor, emulateTemporalSum, nearestArithmetic, type EmulationArithmetic } from "./fake-webgpu-stages.js";
import { emulateDisplayViewSpeed } from "./fake-webgpu-display-view.js";
import { emulateDisplayViewQualityLattice, emulateDisplayViewQualityPixels, emulateDisplayViewQualitySites, emulateDisplayViewQualitySitesBlocked, emulateImagePlaneQualitySites } from "./fake-webgpu-display-view-quality.js";

const f = Math.fround;
// #477: the composite chart kernel and its probe are emulated in their own module.
import { createCompositeDisplayViewMaterialEmulator, createImagePlaneDisplayViewMaterialEmulator, emulateComposite, emulateImagePlaneQualityLattice, NEAREST_COMPOSITE_ARITHMETIC, type CompositeArithmetic } from "./fake-webgpu-composite.js";
import { chartCompositeMaterialModuleId } from "../../src/gpu/display-view-composite-material-module.js";
import type { ChartCompositeProductPath } from "../../src/gpu/wgsl-chart-composite-kernel.js";

/** The product path of a display-view pipeline label that carries the composite material module, or null. */
function compositeModulePath(label: string, kernel: string): ChartCompositeProductPath | null {
  for (const path of ["dekker", "fma"] as const) if (label === kernel + ":" + chartCompositeMaterialModuleId(path)) return path;
  return null;
}

export interface FakeGpuControls {
  /** Buffers created / destroyed so far. */
  created: number;
  destroyed: number;
  /** Bytes in buffers that are not yet destroyed, and the largest value seen. */
  liveBytes: number;
  peakLiveBytes: number;
  /** Calls to `device.destroy()`. */
  deviceDestroyCalls: number;
  /** With `device: "deferred"`: resolves the pending `requestDevice` promise. */
  resolveDevice(): void;
  dispatches: number;
  /** Resolve `device.lost` (simulated loss). */
  loseDevice(): void;
  /** Next popErrorScope for this filter returns an error object. */
  failNextScope: "validation" | "out-of-memory" | null;
  failPipeline: boolean;
  /** How many times `requestAdapter` was called. */
  adapterRequests: number;
  /** Called before each dispatch (e.g. to abort or lose the device mid-run). */
  beforeDispatch?: ((count: number) => void) | undefined;
}
export interface FakeGpuOptions {
  adapter?: "none" | "throws";
  /** `deferred`: `requestDevice` stays pending until `controls.resolveDevice()`. */
  device?: "throws" | "deferred";
  maxStorageBufferBindingSize?: number;
  maxComputeWorkgroupsPerDimension?: number;
  /** The adapter's `info` (#481); `null` for an adapter without one. Default: a description that names the fake. */
  adapterInfo?: { vendor: string; architecture: string; device: string; description: string } | null;
  /** How the sensor and chart emulations round (default: to nearest; see `adversarialArithmetic`). */
  arithmetic?: EmulationArithmetic;
  /**
   * 2.11.0 (the M5 Pro finding): how the composite chart kernel, its probe and the display view's composite material module evaluate
   * (default: round to nearest, unfused, fused fma; `fused-contraction` and `reassociation` model what WGSL permits, see fake-webgpu-composite.ts).
   */
  compositeArithmetic?: CompositeArithmetic;
}
/** The default `GPUAdapterInfo` of the fake adapter. */
export const FAKE_ADAPTER_INFO = Object.freeze({ vendor: "photivra-test", architecture: "float32-emulation", device: "", description: "Fake WebGPU adapter (JavaScript float32 emulation)" });

class FakeBuffer {
  data: ArrayBuffer;
  destroyed = false;
  constructor(readonly size: number, readonly label: string, private readonly controls: FakeGpuControls) {
    this.data = new ArrayBuffer(size); controls.created++;
    controls.liveBytes += size; controls.peakLiveBytes = Math.max(controls.peakLiveBytes, controls.liveBytes);
  }
  mapAsync(): Promise<void> { return this.destroyed ? Promise.reject(new Error("destroyed")) : Promise.resolve(); }
  getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer { return this.data.slice(offset, offset + size); }
  unmap(): void {}
  destroy(): void { if (!this.destroyed) { this.destroyed = true; this.controls.destroyed++; this.controls.liveBytes -= this.size; } }
}
interface Entry { binding: number; resource: { buffer: FakeBuffer } }

function encode(x: number): number {
  if (x === 1) return 1;
  if (x <= f(.0031308)) return f(x * f(12.92));
  return f(f(f(1.055) * f(Math.pow(x, f(1 / 2.4)))) - f(.055));
}
function renderSample(e: number, sourceNonzero: boolean, band0: number, band1: number, reinhard: boolean, reject: boolean, maximum: number, counters: Uint32Array): number {
  let gamut = (e === 0 && sourceNonzero) || (!reinhard && Math.abs(f(e - 1)) <= band1);
  if (band0 > 0 && Math.abs(e) <= band0) gamut = true;
  let uncertain = gamut || Math.abs(f(e - 1)) <= band1;
  if (reinhard && e > 0 && e < 9.5367431640625e-7) uncertain = true;
  if (uncertain) counters[SDR_COUNTER.uncertain]!++;
  if (gamut) counters[SDR_COUNTER.gamutUncertain]!++;
  if (e < 0) counters[SDR_COUNTER.negative]!++;
  if (e > 1) counters[SDR_COUNTER.above]!++;
  const mapped = reinhard && e > 0 ? f(e / f(1 + e)) : e;
  if (mapped !== e) counters[SDR_COUNTER.changed]!++;
  let linear = mapped;
  if (mapped < 0 || mapped > 1) {
    if (reject) counters[SDR_COUNTER.outOfGamut]!++;
    else if (mapped < 0) { counters[SDR_COUNTER.low]!++; linear = 0; } else { counters[SDR_COUNTER.high]!++; linear = 1; }
  }
  return Math.min(maximum, Math.max(0, Math.floor(f(f(encode(linear) * maximum) + .5))));
}

const LU = 2 ** -24, ULP1 = 2 ** -23;
const bits = (x: number): number => new Uint32Array(new Float32Array([x]).buffer)[0]!;
/** Mirrors LUMINANCE_FUNCTIONS (wgsl-kernels.ts); `tone`, `lum` are the uniform vectors. */
function toneH(l: number, mode: number, tone: Float32Array): [number, number, number] {
  if (mode === SDR_TONE_MODE.extendedReinhard) return [f(f(1 + f(l * tone[0]!)) / f(1 + l)), 14 * LU, 0];
  const lg = f(Math.log2(f(tone[0]! / l))), n = tone[1]!, z = f(n * lg);
  const dz = n * (4.76837158203125e-7 + 3 * ULP1 * Math.abs(lg) + 9 * LU) + 2 * LU * Math.abs(z);
  const rho = 0.7 * dz * (1 + dz) + (3 + 2 * Math.abs(z)) * ULP1 + 9.094947e-13 * (1 + Math.abs(z)), eta = 2 * rho + 16 * LU;
  if (z >= 0) {
    const p = f(2 ** -z), abs = p < 7.52316384526264e-37 ? tone[2]! * 3.009265538105056e-36 / l : 0;
    return [f(f(tone[2]! * p) / f(l * f(1 + p))), eta, abs];
  }
  const p = f(2 ** z);
  return [f(tone[2]! / f(l * f(1 + p))), eta, 0];
}
function luminanceTone(e: number[], eps: number[], mode: number, tone: Float32Array, lum: Float32Array): { m: number[]; delta: number[]; changed: boolean } {
  const ae = e.map(Math.abs), ea = ae.map((v, j) => v + eps[j]!);
  const s = f(f(f(lum[0]! * ae[0]!) + f(lum[1]! * ae[1]!)) + f(lum[2]! * ae[2]!));
  const l = f(f(f(lum[0]! * e[0]!) + f(lum[1]! * e[1]!)) + f(lum[2]! * e[2]!));
  const lambda = ((lum[0]! * eps[0]! + lum[1]! * eps[1]!) + lum[2]! * eps[2]! + 6 * LU * s) * 1.001;
  if (l < -2 * lambda || (l === 0 && lambda === 0)) return { m: e, delta: eps, changed: false };
  if (l > 2 * lambda) {
    const [h, eta, abs] = toneH(l, mode, tone), q = lambda / l, T = lum[3]!;
    const fq = T * (((1 + q) / (1 - q)) ** T / (1 - q) * 1.01) * q, hh = h * (1 + 2 * eta) + abs;
    const m = e.map(v => f(v * h));
    return { m, delta: m.map((v, j) => (eps[j]! * hh * (1 + fq) + ea[j]! * (hh * (eta + fq) + abs) + 2 * LU * Math.abs(v)) * 1.001),
      changed: Math.abs(h - 1) <= 2 * (eta + fq) * Math.max(1, h) + abs + 4 * LU };
  }
  const hsup = mode === SDR_TONE_MODE.nakaRushton ? tone[2]! * (3 * lambda) ** (tone[1]! - 1) / tone[3]! * 1.01 : Math.max(1, tone[0]!);
  const m = l > 0 ? e.map(v => f(v * toneH(l, mode, tone)[0])) : e;
  return { m, delta: ea.map(v => 2 * v * (1 + hsup * 1.001) * 1.001), changed: true };
}
function renderToned(e: number, sourceNonzero: boolean, band0: number, band1: number, m: number, delta: number, changedUncertain: boolean, reject: boolean,
  maximum: number, counters: Uint32Array): number {
  let uncertain = (e === 0 && sourceNonzero) || Math.abs(f(e - 1)) <= band1 || (band0 > 0 && Math.abs(e) <= band0) || (changedUncertain && e !== 0);
  const gamut = (m - delta < 0 && m + delta >= 0) || (m + delta > 1 && m - delta <= 1);
  if (gamut) { uncertain = true; counters[SDR_COUNTER.gamutUncertain]!++; }
  if (uncertain) counters[SDR_COUNTER.uncertain]!++;
  if (e < 0) counters[SDR_COUNTER.negative]!++;
  if (e > 1) counters[SDR_COUNTER.above]!++;
  if (m !== e) counters[SDR_COUNTER.changed]!++;
  if (!(Math.abs(m) + delta <= 1.2676506002282294e30)) counters[SDR_COUNTER.luminanceDomain]!++;
  let linear = m, bound = Math.min(delta, 1);
  if (m < 0 || m > 1) {
    if (reject) counters[SDR_COUNTER.outOfGamut]!++;
    else if (m < 0) { counters[SDR_COUNTER.low]!++; linear = 0; } else { counters[SDR_COUNTER.high]!++; linear = 1; }
  }
  if (!reject && (m - delta >= 1 || m + delta <= 0)) bound = 0;
  counters[SDR_COUNTER.linearBoundBits] = Math.max(counters[SDR_COUNTER.linearBoundBits]!, bits(Math.max(bound, 0)));
  return Math.min(maximum, Math.max(0, Math.floor(f(f(encode(linear) * maximum) + .5))));
}

function emulate(label: string, buffers: Map<number, FakeBuffer>, arithmetic: EmulationArithmetic, composite: CompositeArithmetic): void {
  const u32 = (b: number): Uint32Array => new Uint32Array(buffers.get(b)!.data);
  const i32 = (b: number): Int32Array => new Int32Array(buffers.get(b)!.data);
  const f32 = (b: number): Float32Array => new Float32Array(buffers.get(b)!.data);
  if (label === "photivra-sdr") {
    const p = u32(0), pf = f32(0), source = f32(1), codes = u32(2), counters = u32(3);
    for (let i = 0; i < p[0]!; i++) {
      const s = source[i]!;
      codes[i] = renderSample(f(s * pf[4]!), s !== 0, 0, pf[6]!, p[1] !== 0, p[2] !== 0, pf[5]!, counters);
    }
  } else if (label === "photivra-sdr-luminance") {
    const p = u32(0), pf = f32(0), source = f32(1), codes = u32(2), counters = u32(3), tone = pf.subarray(8, 12), lum = pf.subarray(12, 16);
    for (let i = 0; i < p[0]!; i++) {
      const s = [0, 1, 2].map(j => source[i * 3 + j]!), e = s.map(v => f(v * pf[4]!));
      const eps = e.map((v, j) => 4 * LU * Math.abs(v) + (s[j] !== 0 && Math.abs(v) < 7.888609052210118e-31 ? 2.350988701644575e-38 * Math.max(1, pf[4]!) : 0));
      const t = luminanceTone(e, eps, p[2]!, tone, lum);
      for (let j = 0; j < 3; j++) codes[i * 3 + j] = renderToned(e[j]!, s[j] !== 0, 0, pf[6]!, t.m[j]!, t.delta[j]!, t.changed, p[1] !== 0, pf[5]!, counters);
    }
  } else if (label === "photivra-irradiance-convolution") {
    const p = u32(0), source = f32(1), kernels = f32(2), result = f32(3);
    const [width, height, radius, size, pw, ph, cols, rows, outRow0, outRows, inRow0, taps] = Array.from(p.subarray(0, 12)) as number[];
    for (let ly = 0; ly < outRows!; ly++) for (let x = 0; x < width!; x++) {
      const y = outRow0! + ly; let sum = 0;
      for (let v = -radius!; v <= radius!; v++) {
        const sy = y - v; if (sy < 0 || sy >= height!) continue;
        const patchRow = Math.min(Math.floor(sy / ph!), rows! - 1) * cols!;
        for (let u = -radius!; u <= radius!; u++) {
          const sx = x - u; if (sx < 0 || sx >= width!) continue;
          const patch = patchRow + Math.min(Math.floor(sx / pw!), cols! - 1);
          sum = f(sum + f(source[(sy - inRow0!) * width! + sx]! * kernels[patch * taps! + (v + radius!) * size! + u + radius!]!));
        }
      }
      result[ly * width! + x] = sum;
    }
  } else if (label === "photivra-raw-development") {
    const p = u32(0), pi = i32(0), pf = f32(0), normalized = f32(1), taps = buffers.get(2)!.data, phases = u32(3), codes = u32(4), counters = u32(5);
    const tapInts = new Int32Array(taps), tapFloats = new Float32Array(taps);
    const [width, count, row0, reinhard, reject, rw, rh, regionW] = Array.from(p.subarray(0, 8)) as number[];
    const [ox, oy, axx, axy, ayx, ayy, regionX, regionY] = Array.from(pi.subarray(8, 16)) as number[];
    const [scale, maximum, band0, band1, clip] = Array.from(pf.subarray(16, 21)) as number[];
    const reconstruct = p[21] !== 0, bandU = pf[22]!, bandS = pf[23]!, gains = pf.subarray(24, 27);
    const row3 = (o: number, v: number[]): number => f(f(f(f(0 + f(pf[o]! * v[0]!)) + f(pf[o + 1]! * v[1]!))) + f(pf[o + 2]! * v[2]!));
    for (let i = 0; i < count!; i++) {
      const col = i % width!, row = row0! + Math.floor(i / width!);
      const nx = ox! + axx! * col + axy! * row, ny = oy! + ayx! * col + ayy! * row;
      const phase = (ny % rh!) * rw! + nx % rw!;
      let saturated = false;
      const c = [0, 1, 2].map(ch => {
        const start = phases[(phase * 3 + ch) * 2]!, n = phases[(phase * 3 + ch) * 2 + 1]!;
        let value = 0;
        for (let k = 0; k < n; k++) {
          const t = (start + k) * 4, site = normalized[(ny + tapInts[t + 1]! - regionY!) * regionW! + nx + tapInts[t]! - regionX!]!;
          if (site === 1) saturated = true;
          value = f(value + f(site * tapFloats[t + 2]!));
        }
        return value;
      });
      if (saturated) counters[SDR_COUNTER.saturatedPixels]!++;
      const uu = c.map((v, j) => f(v * gains[j]!)), k = uu.map(v => v > clip! ? clip! : v);
      let b = k;
      if (!reconstruct) {
        for (const v of uu) { if (v > clip!) counters[SDR_COUNTER.whiteBalanceClipped]!++; if (Math.abs(f(v - clip!)) <= bandU) counters[SDR_COUNTER.uncertain]!++; }
      } else {
        const s = Math.max(...c);
        if (Math.abs(f(s - f(.8))) <= bandS) counters[SDR_COUNTER.uncertain]!++;
        if (s > f(.8)) {
          const t = s < 1 ? f(f(s - f(.8)) / f(1 - f(.8))) : 1, n = Math.max(...k);
          b = uu.map(v => f(f(f(1 - t) * v) + f(t * n)));
          counters[SDR_COUNTER.reconstructedPixels]!++;
        } else b = uu;
      }
      const xyz = [row3(28, b), row3(32, b), row3(36, b)], rgb = [row3(40, xyz), row3(44, xyz), row3(48, xyz)];
      if (p[52] === SDR_TONE_MODE.perChannel) {
        for (let j = 0; j < 3; j++) codes[i * 3 + j] = renderSample(f(rgb[j]! * scale!), false, band0!, band1!, reinhard !== 0, reject !== 0, maximum!, counters);
      } else {
        const e = rgb.map(v => f(v * scale!)), t = luminanceTone(e, [band0!, band0!, band0!], p[52]!, pf.subarray(56, 60), pf.subarray(60, 64));
        for (let j = 0; j < 3; j++) codes[i * 3 + j] = renderToned(e[j]!, false, band0!, band1!, t.m[j]!, t.delta[j]!, t.changed, reject !== 0, maximum!, counters);
      }
    }
  } else if (label === "photivra-sensor-raw") {
    const means = buffers.get(1)!.data;
    emulateSensor(u32(0), i32(0), f32(0), new Uint32Array(means), new Float32Array(means), f32(2), u32(3), arithmetic);
  } else if (label === "photivra-chart-radiance") {
    emulateChart(u32(0), f32(0), f32(1), f32(2), f32(3), u32(4), f32(5), u32(6), arithmetic);
  } else if (label === "photivra-temporal-sum") {
    emulateTemporalSum(u32(0), f32(1), buffers.get(2)!.data, f32(3), f32(4));
  } else if (label === "photivra-display-view-speed:image-plane" || label === "photivra-display-view-speed:image-plane-fma") {
    // #581: the image-plane module (group 1): the pixel signals at 100, the photo uniform at 101, the lattice uniform at 102, the offsets at 103; the surround is the site table (3).
    const material = createImagePlaneDisplayViewMaterialEmulator(u32(101), f32(101), f32(100), f32(3), u32(102), f32(102), f32(103), label.endsWith("-fma") ? "fma" : "dekker", composite);
    emulateDisplayViewSpeed(u32(0), f32(0), f32(1), f32(2), f32(3), f32(4), u32(5), material);
  } else if (compositeModulePath(label, "photivra-display-view-speed")) {
    // #491: the composite material module (group 1): the scene's float records at 100, integer records at 101, the lattice uniform at 102, the offsets at 103.
    const material = createCompositeDisplayViewMaterialEmulator(u32(102), f32(102), f32(103), f32(100), u32(101), compositeModulePath(label, "photivra-display-view-speed")!, composite);
    emulateDisplayViewSpeed(u32(0), f32(0), f32(1), f32(2), f32(3), f32(4), u32(5), material);
  } else if (label.startsWith("photivra-display-view-speed:")) {
    // The chart-preset material module (group 1): its uniform at 100, its aux table at 101.
    const material = createChartMaterialEmulator(u32(100), f32(100), f32(101), 8, arithmetic);
    emulateDisplayViewSpeed(u32(0), f32(0), f32(1), f32(2), f32(3), f32(4), u32(5), material);
  } else if (compositeModulePath(label, "photivra-display-view-quality-lattice")) {
    // #491's composite module in the Quality lattice pass (group 1 as in Speed: float records 100, integer records 101, lattice uniform 102, offsets 103).
    const material = createCompositeDisplayViewMaterialEmulator(u32(102), f32(102), f32(103), f32(100), u32(101), compositeModulePath(label, "photivra-display-view-quality-lattice")!, composite);
    emulateDisplayViewQualityLattice(u32(0), f32(0), u32(1), u32(2), material);
  } else if (label.startsWith("photivra-display-view-quality-lattice:")) {
    const material = createChartMaterialEmulator(u32(100), f32(100), f32(101), 8, arithmetic);
    emulateDisplayViewQualityLattice(u32(0), f32(0), u32(1), u32(2), material);
  } else if (label === "photivra-display-view-quality-sites") {
    emulateDisplayViewQualitySites(u32(0), f32(0), u32(1), u32(2), f32(3), u32(4), f32(5), f32(6));
  } else if (label === "photivra-display-view-quality-photo-lattice:image-plane" || label === "photivra-display-view-quality-photo-lattice:image-plane-fma") {
    // #581: the print's pass 1 (group 0: params, groups, values, flags; group 1: records 100, photo uniform 101, node table 102).
    emulateImagePlaneQualityLattice(u32(0), u32(1), f32(2), u32(3), u32(100), u32(101), f32(101), f32(102), label.endsWith("-fma") ? "fma" : "dekker", composite);
  } else if (label === "photivra-display-view-quality-photo-sites") {
    emulateImagePlaneQualitySites(u32(0), f32(0), u32(1), f32(3), f32(4), f32(5), u32(6));
  } else if (label === "photivra-display-view-quality-sites-blocked") {
    emulateDisplayViewQualitySitesBlocked(u32(0), f32(0), u32(1), f32(3), u32(4), f32(5), f32(6));
  } else if (label === "photivra-display-view-quality-pixels") {
    emulateDisplayViewQualityPixels(u32(0), f32(0), f32(1), f32(2), f32(3), i32(4), f32(5), u32(6), f32(7), u32(8));
  } else if (!emulateComposite(label, (b) => buffers.get(b)!.data, composite)) {
    throw new Error(`No emulator for ${label}`);
  }
}

/** Returns a `navigator.gpu`-shaped object and its controls. */
export function createFakeGpu(options: FakeGpuOptions = {}): { gpu: unknown; controls: FakeGpuControls } {
  let loseDevice = (): void => undefined;
  let resolveDevice = (): void => undefined;
  const controls: FakeGpuControls = { created: 0, destroyed: 0, liveBytes: 0, peakLiveBytes: 0, deviceDestroyCalls: 0, dispatches: 0,
    loseDevice: () => loseDevice(), resolveDevice: () => resolveDevice(), failNextScope: null, failPipeline: false, adapterRequests: 0 };
  const storage = options.maxStorageBufferBindingSize ?? 128 * 1024 * 1024;
  const limits = { maxStorageBufferBindingSize: storage, maxBufferSize: storage, maxComputeWorkgroupsPerDimension: options.maxComputeWorkgroupsPerDimension ?? 65535 };
  const scopes: string[] = [];
  const device = {
    limits, onuncapturederror: null as unknown,
    lost: new Promise(resolve => { loseDevice = (): void => resolve({ reason: "unknown", message: "lost" }); }),
    queue: {
      writeBuffer(buffer: FakeBuffer, offset: number, data: ArrayBuffer, dataOffset: number, size: number): void {
        new Uint8Array(buffer.data, offset, size).set(new Uint8Array(data, dataOffset, size));
      },
      submit(): void {}
    },
    createBuffer(d: { size: number; label: string }): FakeBuffer { return new FakeBuffer(d.size, d.label, controls); },
    createShaderModule(d: { label: string }): { label: string } { return { label: d.label }; },
    createComputePipelineAsync(d: { label: string }): Promise<unknown> {
      return controls.failPipeline ? Promise.reject(new Error("compile")) : Promise.resolve({ label: d.label, getBindGroupLayout: () => ({}) });
    },
    createBindGroup(d: { entries: Entry[] }): { entries: Entry[] } { return { entries: d.entries }; },
    createCommandEncoder(): unknown {
      const ops: (() => void)[] = [];
      return {
        beginComputePass: (): unknown => {
          let pipeline: { label: string } | null = null;
          const groups = new Map<number, { entries: Entry[] }>();
          return { setPipeline: (p: { label: string }): void => { pipeline = p; }, setBindGroup: (index: number, g: { entries: Entry[] }): void => { groups.set(index, g); },
            dispatchWorkgroups: (): void => { ops.push(() => {
              controls.dispatches++;
              controls.beforeDispatch?.(controls.dispatches);
              // Group 0's bindings keep their numbers; group g's binding b is keyed 100·g + b.
              const buffers = new Map<number, FakeBuffer>();
              for (const [index, group] of groups) for (const e of group.entries) buffers.set(100 * index + e.binding, e.resource.buffer);
              emulate(pipeline!.label, buffers, options.arithmetic ?? nearestArithmetic, options.compositeArithmetic ?? NEAREST_COMPOSITE_ARITHMETIC);
            }); }, end: (): void => {} };
        },
        copyBufferToBuffer: (src: FakeBuffer, so: number, dst: FakeBuffer, d0: number, size: number): void => {
          ops.push(() => new Uint8Array(dst.data, d0, size).set(new Uint8Array(src.data, so, Math.min(size, src.size - so))));
        },
        finish: (): unknown => ({ run: (): void => ops.forEach(op => op()) })
      };
    },
    pushErrorScope(filter: string): void { scopes.push(filter); },
    popErrorScope(): Promise<unknown> {
      const filter = scopes.pop();
      if (controls.failNextScope && controls.failNextScope === filter) { controls.failNextScope = null; return Promise.resolve({ message: "scope" }); }
      return Promise.resolve(null);
    },
    destroy(): void { controls.deviceDestroyCalls++; loseDevice(); }
  };
  (device.queue as { submit: (buffers: { run: () => void }[]) => void }).submit = (buffers): void => buffers.forEach(b => b.run());
  const info = options.adapterInfo === undefined ? FAKE_ADAPTER_INFO : options.adapterInfo;
  const adapter = { limits, ...(info ? { info } : {}), requestDevice: (): Promise<unknown> => options.device === "throws" ? Promise.reject(new Error("no device"))
    : options.device === "deferred" ? new Promise(resolve => { resolveDevice = (): void => resolve(device); }) : Promise.resolve(device) };
  const gpu = { requestAdapter: (): Promise<unknown> => {
    controls.adapterRequests++;
    return options.adapter === "throws" ? Promise.reject(new Error("adapter")) : Promise.resolve(options.adapter === "none" ? null : adapter);
  } };
  return { gpu, controls };
}
