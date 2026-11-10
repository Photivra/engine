// SPDX-License-Identifier: Apache-2.0

/**
 * Host side of the composite-chart radiance kernel (#477, wgsl-chart-composite-kernel.ts): packs a resolved
 * chart's geometry (`chartGeometry`) and a declared scene's mask layers into the kernel's record arrays,
 * keeps the packed records and their GPU buffers per scene so a prepared view uploads them once, probes the
 * device's double-float32 arithmetic, dispatches in bands, and recomputes flagged points with the float64
 * reference. Internal; the public entry point is `ImageKernelAccelerator.evaluateChartRadiance`.
 */
import { createHostYieldGate } from "../capture/host-yield-cadence.js";
import type { ChartRadianceBatchPlan } from "../facade/chart-radiance-batch.js";
import { chartGeometry, type ChartGeometry, type ResolvedChartScene } from "../facade/chart-scenes.js";
import type { ResolvedChartMaskLayer } from "../facade/chart-material-layers.js";
import { ImageKernelExecutionError, webGpuExecution, type ChartCompositeProbeComponent, type ChartCompositeProbeMismatch, type ChartCompositeProbeRecord,
  type ImageKernelExecution } from "./image-kernel-execution.js";
import type { ChartRadianceResult } from "./image-kernel-accelerator.js";
import { BUFFER_USAGE, GpuResourceScope, linearDispatch, runComputePass, type WebGpuRuntime, throwIfAborted as checkAbort } from "./webgpu-runtime.js";
import { CHART_COMPOSITE_PROBE_LABEL, CHART_COMPOSITE_PROBE_OUTPUTS, CHART_COMPOSITE_PROBE_WGSL, CHART_COMPOSITE_WORKGROUP_SIZE, CHART_ELEMENT_KIND,
  CHART_PLACEMENT, CHART_RECORD_STRIDE, chartCompositeLabel, chartCompositeWgsl } from "./wgsl-chart-composite-kernel.js";

type PipelineSource = (label: string, code: string) => Promise<GPUComputePipeline>;
type YieldControl = ((signal: AbortSignal) => Promise<void>) | undefined;

const f = Math.fround;
const FLOAT32_SAFE_MAGNITUDE = 2 ** 120;
/** Frame-unit magnitude limit for GPU points (shared with the preset kernel). */
const MAXIMUM_COORDINATE = 2 ** 20;
/** The rough angle's allowance when the star's sector window is sized: the WGSL atan2 bound (4096 ULP, about 2^-10 rad) with a 4× margin. */
const STAR_ANGLE_ALLOWANCE = 2 ** -8;

// --- double-float32 in JavaScript (Math.fround after every operation): the probe's expected values and the test emulation ---
export type Dw = readonly [hi: number, lo: number];
export function dwSplit(x: number): Dw { const hi = f(x), lo = f(x - hi); return [hi, lo]; }
export function twoSum(a: number, b: number): Dw { const s = f(a + b), bb = f(s - a); return [s, f(f(a - f(s - bb)) + f(b - bb))]; }
export function quickTwoSum(a: number, b: number): Dw { const s = f(a + b); return [s, f(b - f(s - a))]; }
function veltkamp(a: number): Dw { const t = f(4097 * a), h = f(t - f(t - a)); return [h, f(a - h)]; }
export function twoProd(a: number, b: number): Dw {
  const p = f(a * b), [ah, al] = veltkamp(a), [bh, bl] = veltkamp(b);
  const e = f(f(f(f(f(ah * bh) - p) + f(ah * bl)) + f(al * bh)) + f(al * bl));
  return [p, e];
}
export function dwAdd(a: Dw, b: Dw): Dw {
  const s = twoSum(a[0], b[0]), t = twoSum(a[1], b[1]);
  const c = f(s[1] + t[0]), v = quickTwoSum(s[0], c);
  const w = f(v[1] + t[1]);
  return quickTwoSum(v[0], w);
}
export function dwSub(a: Dw, b: Dw): Dw { return dwAdd(a, [-b[0], -b[1]]); }
export function dwMul(a: Dw, b: Dw): Dw {
  const p = twoProd(a[0], b[0]), t = f(f(a[0] * b[1]) + f(a[1] * b[0])), l = f(p[1] + t);
  return quickTwoSum(p[0], l);
}

/**
 * fma on float32 operands with one rounding to nearest (ties to even), as a fused `fma` evaluates it: the product of two float32
 * values is exact in float64 (48 significant bits), the float64 TwoSum gives the sum's exact error, and the one case where rounding
 * the float64 sum to float32 differs from rounding the exact sum (the float64 sum lands on a float32 midpoint) is resolved by the error's sign.
 */
export function fmaF32(a: number, b: number, c: number): number {
  const p = a * b, s = p + c, bb = s - p, e = (p - (s - bb)) + (c - bb), r = f(s);
  if (e === 0 || r === s || !Number.isFinite(r)) return r;
  const other = nextFloat32(r, s > r ? 1 : -1);
  if (Math.abs(s - r) !== Math.abs(other - s)) return r;
  return (e > 0) === (other > r) ? other : r;
}
const bits32 = new Float32Array(1), int32 = new Int32Array(bits32.buffer);
/** The float32 neighbour of a finite float32 x toward +∞ (direction 1) or −∞ (−1). */
function nextFloat32(x: number, direction: 1 | -1): number {
  if (x === 0) return direction * 2 ** -149;
  bits32[0] = x;
  int32[0] = int32[0]! + ((x > 0) === (direction > 0) ? 1 : -1);
  return bits32[0]!;
}
/** The fma TwoProduct: p = fl(a·b) and its exact error fma(a, b, −p) (exact for a fused fma; Joldes, Muller & Popescu 2017, Algorithm 2). */
export function twoProdFma(a: number, b: number): Dw { const p = f(a * b); return [p, fmaF32(a, b, -p)]; }
/** The cross-term sum t = a.h·b.l + a.l·b.h of a double-word product: unfused (the default), or with one of the two products fused into the addition. */
export function dwCrossTerm(a: Dw, b: Dw, contraction: "none" | "first" | "second" = "none"): number {
  if (contraction === "first") return fmaF32(a[0], b[1], f(a[1] * b[0]));
  if (contraction === "second") return fmaF32(a[1], b[0], f(a[0] * b[1]));
  return f(f(a[0] * b[1]) + f(a[1] * b[0]));
}
/**
 * The fma path's double-word product (`d_mul_fma`): s = fma(a.h, b.h, t), lo = fl(fma(a.h, b.h, −s) + t), with t the cross-term
 * sum. No rounded product is an operand of an addition, so a contraction cannot change it; see docs/WEBGPU.md for its error bound.
 */
export function dwMulFma(a: Dw, b: Dw, t: number = dwCrossTerm(a, b)): Dw {
  const s = fmaF32(a[0], b[0], t);
  return [s, f(fmaF32(a[0], b[0], -s) + t)];
}
/** The Dekker path's double-word product with a given cross-term sum (`dwMul` is it with the unfused one). */
export function dwMulDekker(a: Dw, b: Dw, t: number = dwCrossTerm(a, b)): Dw {
  const p = twoProd(a[0], b[0]), l = f(p[1] + t);
  return quickTwoSum(p[0], l);
}

/**
 * Probe inputs (x, y, z, w): pairs whose TwoSum and TwoProduct low parts are non-zero, double words to add and multiply, and sums and
 * products that a directed (truncating or upward) rounding would place on the other neighbour than round-to-nearest: 1 + 3·2^-26
 * rounds up to 1 + 2^-23 (nearest) but down to 1 (truncation); −1 − 3·2^-26 the mirror; 1.25 · (1 + 2^-23) likewise. The last four
 * (2.11.0, the M5 Pro finding) are normalized double words whose products have non-zero TwoProduct errors on both operand pairs, so
 * a contraction of the Dekker path's final Fast2Sum (which then adds the product's error twice) shows in the double-word product.
 */
export const PROBE_INPUTS: readonly (readonly [number, number, number, number])[] = /* @__PURE__ */ Object.freeze([
  [1, 2 ** -30, 1.5, 2 ** -29], [3.7, 1e-8, -2.25, 3e-9], [0.1, 0.7, 12345.678, -0.0001], [1e6, 1e-3, 1e-6, 1e-9], [-5.5, 2 ** -26, 7, -(2 ** -27)],
  [0.3333333, 0.6666667, 1.0000001, 0.99999994], [1024.5, 1e-5, 0.0078125, 3e-10], [2.5e-3, 4.1e-11, 999.75, 2 ** -40],
  [1, 3 * 2 ** -26, 1.25, 1 + 2 ** -23], [-1, -3 * 2 ** -26, -1.25, 1 + 2 ** -23], [1 + 2 ** -23, 1.25, 1, 5 * 2 ** -26], [0.75, 2 ** -25 + 2 ** -27, 3, 2 ** -24 + 2 ** -26],
  [1.1, 2.2e-9, 1.3, -3.1e-9], [0.7071068, -1.2e-8, 0.7071067, 2.9e-8], [123.456, 3.3e-6, -0.0123, 4.4e-10], [3.14159274, -8.7422777e-8, 2.7182817, 8.2e-8]
]);
/** The components of the probe in output order (see `CHART_COMPOSITE_PROBE_WGSL`). */
export const PROBE_COMPONENTS: readonly ChartCompositeProbeComponent[] = /* @__PURE__ */ Object.freeze(["two-sum", "two-product", "double-word-add", "double-word-multiply", "fma-two-product", "fma-double-word-multiply"]);
/**
 * The probe's output per input on a device that evaluates as written, round to nearest, unfused, with a fused `fma`, in the shader's
 * order: [TwoSum lo, Dekker TwoProduct lo, double-word sum lo, fma TwoProduct lo, Dekker product hi, lo, fma product hi, lo].
 */
export function probeExpectation(input: readonly [number, number, number, number]): [number, number, number, number, number, number, number, number] {
  const [x, y, z, w] = input.map(f) as [number, number, number, number];
  const q = dwMulDekker([x, y], [z, w]), qf = dwMulFma([x, y], [z, w]);
  return [twoSum(x, y)[1], twoProd(x, y)[1], dwAdd([x, y], [z, w])[1], twoProdFma(x, y)[1], q[0], q[1], qf[0], qf[1]];
}
const hex32 = (x: number): string => { bits32[0] = x; return "0x" + (int32[0]! >>> 0).toString(16).padStart(8, "0"); };

/**
 * Classifies the probe's output (`CHART_COMPOSITE_PROBE_OUTPUTS` floats per input of `PROBE_INPUTS`). TwoSum, both TwoProducts and the
 * double-word sum must equal their exact values bit for bit (each is error-free, or a fixed sequence of roundings to nearest); a
 * double-word product must equal the written-order evaluation for the unfused cross-term sum t = a.h·b.l + a.l·b.h or for either
 * product of t fused into its addition (a contraction WGSL permits, "Reassociation and Fusion", and harmless there: t is an ordinary
 * bounded sum). Anything else is a mismatch, recorded with the float32 bits.
 */
export function classifyChartCompositeProbe(got: Float32Array): ChartCompositeProbeRecord {
  const counts = Object.fromEntries(PROBE_COMPONENTS.map((c) => [c, 0])) as Record<ChartCompositeProbeComponent, number>;
  const inputs = Object.fromEntries(PROBE_COMPONENTS.map((c) => [c, [] as number[]])) as Record<ChartCompositeProbeComponent, number[]>;
  const mismatches: ChartCompositeProbeMismatch[] = [];
  let nonFinite = false, sumZero = true;
  const miss = (component: ChartCompositeProbeComponent, input: number, g: number, want: number): void => {
    counts[component]++;
    inputs[component].push(input);
    if (!Number.isFinite(g)) nonFinite = true;
    if ((component === "two-sum" || component === "double-word-add") && g !== 0) sumZero = false;
    if (mismatches.length < 8) mismatches.push({ component, input, got: hex32(g), want: hex32(want) });
  };
  PROBE_INPUTS.forEach((row, i) => {
    const [x, y, z, w] = row.map(f) as [number, number, number, number], o = got.subarray(8 * i, 8 * i + 8), want = probeExpectation(row);
    for (const [k, component] of [[0, "two-sum"], [1, "two-product"], [2, "double-word-add"]] as const) if (!Object.is(o[k], want[k])) miss(component, i, o[k]!, want[k]);
    const products = (mul: (a: Dw, b: Dw, t: number) => Dw, h: number, l: number, component: ChartCompositeProbeComponent): void => {
      const candidates = (["none", "first", "second"] as const).map((c) => mul([x, y], [z, w], dwCrossTerm([x, y], [z, w], c)));
      if (!candidates.some((c) => Object.is(c[0], h) && Object.is(c[1], l))) miss(component, i, Object.is(candidates[0]![0], h) ? l : h, Object.is(candidates[0]![0], h) ? candidates[0]![1] : candidates[0]![0]);
    };
    products(dwMulDekker, o[4]!, o[5]!, "double-word-multiply");
    if (!Object.is(o[3], want[3])) miss("fma-two-product", i, o[3]!, want[3]);
    products(dwMulFma, o[6]!, o[7]!, "fma-double-word-multiply");
  });
  mismatches.sort((a, b) => PROBE_COMPONENTS.indexOf(a.component) - PROBE_COMPONENTS.indexOf(b.component) || a.input - b.input);
  const sums = counts["two-sum"] + counts["double-word-add"], dekker = counts["two-product"] + counts["double-word-multiply"];
  const fma = counts["fma-two-product"] + counts["fma-double-word-multiply"];
  const deviceClass: ChartCompositeProbeRecord["deviceClass"] = nonFinite ? "other" : sums > 0 ? (sumZero ? "reassociated" : "other") : dekker > 0 ? "contracted" : "exact";
  const productPath = sums > 0 || nonFinite ? null : dekker === 0 ? "dekker" : fma === 0 ? "fma" : null;
  return Object.freeze({ deviceClass, productPath, fmaFused: counts["fma-two-product"] === 0, inputs: PROBE_INPUTS.length, mismatchCounts: Object.freeze(counts),
    mismatchedInputs: Object.freeze(Object.fromEntries(PROBE_COMPONENTS.map((c) => [c, Object.freeze(inputs[c])])) as Record<ChartCompositeProbeComponent, readonly number[]>),
    mismatches: Object.freeze(mismatches.map((m) => Object.freeze(m))) });
}

/** The components' names in a log line, with the probe output they are (s.l, m.l, a.l, q of the probe before 2.11.0; mf.l, qf of the fma path). */
const COMPONENT_NAMES: Record<ChartCompositeProbeComponent, string> = { "two-sum": "TwoSum (s.l)", "two-product": "TwoProduct (m.l)", "double-word-add": "double-word add (a.l)",
  "double-word-multiply": "double-word multiply (q)", "fma-two-product": "fma TwoProduct (mf.l)", "fma-double-word-multiply": "fma double-word multiply (qf)" };
/**
 * One log line for a probe record: the class, the chosen path, each differing component with its count and the probe input
 * indices that differ, and the first difference with its float32 bits.
 */
export function describeChartCompositeProbe(probe: ChartCompositeProbeRecord): string {
  const differing = PROBE_COMPONENTS.filter((c) => probe.mismatchCounts[c] > 0).map((c) => COMPONENT_NAMES[c] + " ×" + probe.mismatchCounts[c] + " [" + probe.mismatchedInputs[c].join(",") + "]");
  const first = probe.mismatches[0];
  return "class " + probe.deviceClass + ", product path " + (probe.productPath ?? "none") + ", fma " + (probe.fmaFused ? "fused" : "not fused") +
    (differing.length ? "; differing of " + probe.inputs + " inputs: " + differing.join(", ") : "") +
    (first ? "; first: " + COMPONENT_NAMES[first.component] + " input " + first.input + " got " + first.got + " want " + first.want : "");
}

/** The probe's refusal: `unsupported-on-backend` with the probe record (`probe`) for the execution diagnostics. */
export class ChartCompositeProbeError extends ImageKernelExecutionError {
  constructor(readonly probe: ChartCompositeProbeRecord) {
    super("unsupported-on-backend", "This device does not evaluate the composite chart kernel's double-float32 arithmetic as written (" + describeChartCompositeProbe(probe) +
      "); use cpu-reference for composite charts, 2.3 elements and material-layers scenes.");
  }
}

/** Packed records of one scene: the kernel's float and integer arrays and its material count. */
export interface PackedChartScene { af: Float32Array<ArrayBuffer>; ai: Uint32Array<ArrayBuffer>; materials: number; elementCount: number; layerCount: number }

class Packer {
  readonly af: number[] = [];
  readonly ai: number[] = [];
  floats(values: readonly number[]): number { const at = this.af.length; for (const x of values) this.af.push(x); return at; }
  ints(values: readonly number[]): number { const at = this.ai.length; for (const x of values) this.ai.push(x); return at; }
  reserveInts(count: number): number { const at = this.ai.length; for (let i = 0; i < count; i++) this.ai.push(0); return at; }
}

/** Sector boundary table of a Siemens star (bar or sine profile): directions, per-sector levels from the reference, bucket index and search window. */
export function starSectorTable(chart: ResolvedChartScene, g: Extract<ChartGeometry, { kind: "siemens-star" }>):
  { thetas: Float64Array; levels: Uint32Array; buckets: Uint32Array; window: number } {
  const set = new Set<number>(), normalize = (t: number): number => { let x = t; while (x <= -Math.PI) x += 2 * Math.PI; while (x > Math.PI) x -= 2 * Math.PI; return x; };
  if (g.profile === "bar") {
    for (let k = 1; k <= 2 * g.cycles; k++) set.add(normalize(Math.PI * (k / g.cycles - 1)));
  } else {
    for (let L = 1; L < 1024; L++) {
      const a = Math.asin(L / 512 - 1);
      for (let m = 0; m < g.cycles; m++) { set.add(normalize((a + 2 * Math.PI * m) / g.cycles - Math.PI)); set.add(normalize((Math.PI - a + 2 * Math.PI * m) / g.cycles - Math.PI)); }
    }
  }
  const thetas = Float64Array.from(set).sort(), n = thetas.length, rho = g.r / 2;
  const levels = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    const next = k + 1 < n ? thetas[k + 1]! : thetas[0]! + 2 * Math.PI, mid = (thetas[k]! + next) / 2;
    levels[k] = chart.materialAt(rho * Math.cos(mid), rho * Math.sin(mid));
  }
  const buckets = new Uint32Array(n);
  for (let j = 0; j < n; j++) {
    const start = -Math.PI + 2 * Math.PI * j / n;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (thetas[mid]! >= start) hi = mid; else lo = mid + 1; }
    buckets[j] = lo;
  }
  // The window: the most boundaries any angular interval of the allowance (plus two buckets) can hold, capped so the window spans under a half turn.
  const reach = STAR_ANGLE_ALLOWANCE + 4 * Math.PI / n;
  let window = 1;
  for (let k = 0; k < n; k++) {
    let count = 0;
    for (let i = 1; i <= n; i++) { const t = k + i < n ? thetas[k + i]! : thetas[(k + i) % n]! + 2 * Math.PI; if (t - thetas[k]! <= 2 * reach) count++; else break; }
    window = Math.max(window, count + 1);
  }
  window = Math.min(window, Math.max(0, Math.floor(n / 4) - 1));
  return { thetas, levels, buckets, window };
}

function packElement(p: Packer, chart: ResolvedChartScene, offset: number, header: number, placement: { mode: number; cu: number; cv: number; hw: number; hh: number; scale: number }): void {
  const g = chartGeometry(chart);
  const [cuH, cuL] = dwSplit(placement.cu), [cvH, cvL] = dwSplit(placement.cv), [sH, sL] = dwSplit(placement.scale);
  const foff = p.floats([cuH, cuL, cvH, cvL, placement.hw, placement.hh, sH, sL, 0, 0]);
  const kindName = g.kind === "composite" ? null : g.kind;
  if (kindName === null) throw new ImageKernelExecutionError("unsupported-on-backend", "A composite cannot be a composite element.");
  const kind = CHART_ELEMENT_KIND[kindName];
  let ioff = 0;
  switch (g.kind) {
    case "uniform": break;
    case "slanted-edge": p.floats([g.c, g.s]); break;
    case "siemens-star": {
      const table = starSectorTable(chart, g), n = table.thetas.length;
      const dirs: number[] = [];
      for (let k = 0; k < n; k++) { const t = table.thetas[k]!, c = dwSplit(Math.cos(t)), s = dwSplit(Math.sin(t)); dirs.push(c[0], c[1], s[0], s[1]); }
      p.floats([g.r * g.r]);
      const dirsOff = p.floats(dirs), levelsOff = p.ints(Array.from(table.levels)), bucketsOff = p.ints(Array.from(table.buckets));
      ioff = p.ints([n, dirsOff, levelsOff, bucketsOff, n, table.window, chart.materials.length - 1]);
      break;
    }
    case "step-wedge": ioff = p.ints([g.steps]); break;
    case "checkerboard": p.floats([g.size, chart.aspect]); break;
    case "point-grid": {
      p.floats([g.cellW, g.cellH, chart.aspect, g.radius * g.radius]);
      const centers = p.floats(g.centers.flatMap((c) => [c.u, c.v]));
      ioff = p.ints([g.columns, g.rows, centers]);
      break;
    }
    case "patches": p.floats([g.cellW, g.cellH, chart.aspect, g.gap / 2, 1 - g.gap / 2]); ioff = p.ints([g.columns, g.rows, g.count, g.backgroundIndex]); break;
    case "dead-leaves": {
      p.floats([g.u0, g.v0, g.cell]);
      const cells = g.nx * g.ny, csr = p.reserveInts(cells + 1), entries: number[] = [];
      for (let c = 0; c < cells; c++) {
        p.ai[csr + c] = entries.length;
        for (let e = g.head[c]!; e >= 0; e = g.next[e]!) entries.push(g.entryDisk[e]!);
      }
      p.ai[csr + cells] = entries.length;
      const entriesOff = p.ints(entries), disks: number[] = [];
      for (let d = 0; d < g.diskCount; d++) disks.push(g.X[d]!, g.Y[d]!, g.R2[d]!, g.level[d]!);
      const disksOff = p.floats(disks);
      ioff = p.ints([g.nx, g.ny, csr, entriesOff, disksOff, g.mean]);
      break;
    }
    case "bar-groups": {
      const digits: number[] = [], rows: number[] = [];
      for (const group of g.groups) {
        const b = group.verticalBars, h = group.horizontalBars, label = group.label;
        let digitIndex = 0;
        if (label) { digitIndex = digits.length; digits.push(label.text.length, ...Array.from(label.text, (ch) => ch.charCodeAt(0) - 48)); }
        rows.push(group.cell.u0, group.cell.u1, b.u0, b.v0, b.u1, b.v1, h.u0, h.v0, h.u1, h.v1, group.lineWidth, label ? 1 : 0,
          label?.u0 ?? 0, label?.v0 ?? 0, label?.height ?? 0, digitIndex);
      }
      const gf = p.floats(rows), digitsOff = p.ints(digits.length ? digits : [0]);
      ioff = p.ints([g.groups.length, gf, digitsOff]);
      break;
    }
    case "hyperbolic-wedge": p.floats([chart.aspect, g.ph, g.lw0, g.lw1 - g.lw0, 2 * chart.aspect]); ioff = p.ints([g.orientation === "horizontal" ? 0 : 1, g.lines]); break;
    case "zone-plate": { const [kH, kL] = dwSplit(g.k); p.floats([g.r * g.r, kH, kL]); break; }
    case "slanted-squares": p.floats([g.cellW, g.cellH, chart.aspect, g.c, g.s, g.half]); ioff = p.ints([g.columns, g.rows]); break;
    case "line-grid": p.floats([g.spacing, g.half]); break;
    case "fiducial": p.floats([g.r * g.r, g.inner * g.inner]); ioff = p.ints([g.inverted ? 1 : 0]); break;
    default: throw new ImageKernelExecutionError("unsupported-on-backend", "Unsupported chart element.");
  }
  p.ai[header] = kind; p.ai[header + 1] = offset; p.ai[header + 2] = ioff; p.ai[header + 3] = foff; p.ai[header + 4] = placement.mode;
}

function packLayer(p: Packer, layer: ResolvedChartMaskLayer, header: number): void {
  const r = layer.rectangle;
  const foff = p.floats([r.u0, r.v0, r.u1, r.v1, layer.scaleX, layer.scaleY, layer.cellWidth, layer.cellHeight]);
  const shapesOff = p.reserveInts(CHART_RECORD_STRIDE.shape * layer.shapes.length);
  layer.shapes.forEach((shape, k) => {
    const h = shapesOff + CHART_RECORD_STRIDE.shape * k;
    if (shape.kind === "annulus") {
      p.ai[h] = 1; p.ai[h + 1] = p.floats([...shape.box, shape.centerX, shape.centerY, shape.inner2, shape.outer2]); p.ai[h + 2] = 0;
    } else {
      const data = p.floats([...shape.box]), edges = shape.edges.length / 4;
      for (let e = 0; e < edges; e++) p.floats([shape.edges[4 * e]!, shape.edges[4 * e + 1]!, shape.edges[4 * e + 2]!, shape.edges[4 * e + 3]!]);
      p.ai[h] = 0; p.ai[h + 1] = data; p.ai[h + 2] = edges;
    }
  });
  const cells = layer.cellsX * layer.cellsY, cellStart = p.reserveInts(cells + 1), list: number[] = [];
  for (let c = 0; c < cells; c++) { p.ai[cellStart + c] = list.length; list.push(...layer.cells[c]!); }
  p.ai[cellStart + cells] = list.length;
  const cellList = p.ints(list.length ? list : [0]);
  const words = [layer.cellsX, layer.cellsY, cellStart, cellList, shapesOff, layer.shapes.length, foff, layer.backgroundMaterial, layer.inkMaterial];
  words.forEach((w, i) => { p.ai[header + i] = w; });
}

/** Packs the plan's chart (a composite, an element preset, or the chart under layers) and its layers into the kernel's record arrays. */
export function packChartScene(plan: ChartRadianceBatchPlan): PackedChartScene {
  const p = new Packer(), chart = plan.chart, g = chartGeometry(chart), layers = plan.layers?.layers ?? [];
  const elements = g.kind === "composite" ? g.elements : [];
  const elementCount = elements.length + 1;
  p.reserveInts(4);
  const he = p.reserveInts(CHART_RECORD_STRIDE.element * elementCount), hl = p.reserveInts(CHART_RECORD_STRIDE.layer * layers.length);
  const frame = { mode: CHART_PLACEMENT.frame, cu: 0, cv: 0, hw: 0, hh: 0, scale: 1 };
  packElement(p, g.kind === "composite" ? g.background : chart, 0, he, frame);
  elements.forEach((e, i) => packElement(p, e.chart, e.offset, he + CHART_RECORD_STRIDE.element * (i + 1),
    { mode: e.ellipse ? CHART_PLACEMENT.ellipse : CHART_PLACEMENT.rectangle, cu: e.cu, cv: e.cv, hw: e.hw, hh: e.hh, scale: e.scale }));
  layers.forEach((layer, l) => packLayer(p, layer, hl + CHART_RECORD_STRIDE.layer * l));
  p.ai[0] = elementCount; p.ai[1] = layers.length; p.ai[2] = he; p.ai[3] = hl;
  for (const x of p.af) if (!(Math.abs(x) <= FLOAT32_SAFE_MAGNITUDE)) throw new ImageKernelExecutionError("unsupported-float32-domain", "A chart constant exceeds the float32 domain.");
  for (const x of p.ai) if (!(Number.isInteger(x) && x >= 0 && x <= 0xffffffff)) throw new ImageKernelExecutionError("unsupported-on-backend", "Chart records exceed the kernel's index range.");
  return { af: Float32Array.from(p.af), ai: Uint32Array.from(p.ai), materials: plan.materials.length, elementCount, layerCount: layers.length };
}

/**
 * The material table the chart kernels read. Radiance mode: each material's radiance at each wavelength in float64 (the reference's
 * operations), rounded once; a failing spectrum is NaN and its points are recomputed. Spectral-integral mode (2.21.0, signals are
 * integrated from the material spectrum per query): each material's index in every column (exact in float32), so the kernel
 * returns the material a query reads and the host integrates that query's spectrum against the channel weights
 * (`integrateChartQueries`); no per-material channel value is formed.
 */
export function chartMaterialTable(plan: ChartRadianceBatchPlan): Float32Array<ArrayBuffer> {
  const nm = plan.wavelengthsNanometers, stride = plan.mode === "radiance" ? nm.length : plan.columns, materials = plan.materials.length;
  const table = new Float32Array(materials * stride);
  if (plan.mode !== "radiance") {
    // A query whose integral leaves the float32 range is non-finite and recomputed by the reference (integrateChartQueries).
    for (let m = 0; m < table.length; m++) table[m] = Math.floor(m / stride);
    return table;
  }
  for (let m = 0; m < materials; m++) {
    for (let c = 0; c < stride; c++) {
      let value: number;
      try { value = plan.materialRadiance(m, nm[c]!); } catch { value = Number.NaN; }
      if (Math.abs(value) > FLOAT32_SAFE_MAGNITUDE) throw new ImageKernelExecutionError("unsupported-float32-domain", "Chart values exceed the float32 domain.");
      table[m * stride + c] = value;
    }
  }
  return table;
}

/**
 * Spectral-integral mode (2.21.0): replaces each query's material index (the kernel's output, `chartMaterialTable`) by its integral
 * Σ_j w_cj·L_m(λ_j) per column, formed from the material's spectrum (kept per material) in the reference's order and rounded
 * once, as the query is read. Queries already in `recomputed` are left to the reference; a query whose spectrum fails joins them.
 */
export function integrateChartQueries(plan: ChartRadianceBatchPlan, values: Float32Array, recomputed: number[]): void {
  if (plan.mode === "radiance") return;
  const nm = plan.wavelengthsNanometers, C = plan.columns, spectra = new Map<number, number[] | null>(), skip = new Set(recomputed);
  for (let q = 0; q < plan.queryCount; q++) {
    if (skip.has(q)) continue;
    const m = values[q * C]!;
    if (!spectra.has(m)) { try { spectra.set(m, nm.map((w) => plan.materialRadiance(m, w))); } catch { spectra.set(m, null); } }
    const L = spectra.get(m);
    let finite = !!L;
    for (let c = 0; c < C && L; c++) {
      let v = 0;
      plan.channelWeights![c]!.forEach((w, j) => { v += w * L[j]!; });
      values[q * C + c] = v;
      finite &&= Number.isFinite(values[q * C + c]!);
    }
    if (!finite) recomputed.push(q);
  }
}

/** The scene key of a batch input: the scene's data and the aspect (every record derives from them). */
export function chartSceneKey(scene: unknown, aspect: number): string { return aspect + "|" + JSON.stringify(scene); }

/**
 * The device's double-float32 probe (`CHART_COMPOSITE_PROBE_WGSL`, classified by `classifyChartCompositeProbe`): resolves with the probe
 * record (its `productPath` is the variant the composite kernel is compiled with), or rejects with `ChartCompositeProbeError`
 * (`unsupported-on-backend`, the record in `probe`) on a device that neither product path holds on. Run once per accelerator by
 * `ChartSceneUploads.probe`, and once per display-view renderer by the composite material module (#491).
 */
export async function probeChartCompositeDevice(runtime: WebGpuRuntime, pipelines: PipelineSource, signal: AbortSignal): Promise<ChartCompositeProbeRecord> {
  const pipeline = await pipelines(CHART_COMPOSITE_PROBE_LABEL, CHART_COMPOSITE_PROBE_WGSL), scope = new GpuResourceScope(runtime);
  const bytes = 4 * CHART_COMPOSITE_PROBE_OUTPUTS * PROBE_INPUTS.length;
  let record: ChartCompositeProbeRecord;
  try {
    const input = scope.upload("photivra-chart-probe-in", Float32Array.from(PROBE_INPUTS.flat()), BUFFER_USAGE.STORAGE);
    const output = scope.buffer("photivra-chart-probe-out", bytes, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
    // The rounding barrier's zero word (CHART_COMPOSITE_PROBE_WGSL `probe_zero`).
    const zero = scope.upload("photivra-chart-probe-zero", new Uint32Array(4), BUFFER_USAGE.UNIFORM);
    const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } },
      { binding: 2, resource: { buffer: zero } }] });
    const [data] = await runComputePass(runtime, scope, pipeline, bindGroup, [PROBE_INPUTS.length, 1], [{ buffer: output, bytes }], signal);
    record = classifyChartCompositeProbe(new Float32Array(data!, 0, CHART_COMPOSITE_PROBE_OUTPUTS * PROBE_INPUTS.length));
  } finally { scope.release(); }
  if (record.productPath === null) throw new ChartCompositeProbeError(record);
  return record;
}

interface UploadedScene { key: string; scope: GpuResourceScope; af: GPUBuffer; ai: GPUBuffer; packed: PackedChartScene }

/** Per accelerator: the uploaded records of recent scenes (a prepared view's scene is uploaded once) and the device probe. */
export class ChartSceneUploads {
  readonly #entries: UploadedScene[] = [];
  #probed: Promise<ChartCompositeProbeRecord> | null = null;
  constructor(private readonly runtime: WebGpuRuntime, private readonly keep = 4) {}
  /** The device's double-float32 probe, run once per accelerator (single flight; a refusal is retried on the next call): the record, or `ChartCompositeProbeError`. */
  probe(pipelines: PipelineSource, signal: AbortSignal): Promise<ChartCompositeProbeRecord> {
    this.#probed ??= probeChartCompositeDevice(this.runtime, pipelines, signal).catch((error: unknown) => { this.#probed = null; throw error; });
    return this.#probed;
  }
  get(plan: ChartRadianceBatchPlan, scene: unknown, aspect: number): UploadedScene {
    const key = chartSceneKey(scene, aspect), index = this.#entries.findIndex((e) => e.key === key);
    if (index >= 0) { const [entry] = this.#entries.splice(index, 1); this.#entries.push(entry!); return entry!; }
    const packed = packChartScene(plan);
    if (Math.max(packed.af.byteLength, packed.ai.byteLength) > this.runtime.maximumStorageBindingBytes) {
      throw new ImageKernelExecutionError("insufficient-limits", "Chart records exceed the device's storage binding limit.");
    }
    const scope = new GpuResourceScope(this.runtime);
    const entry: UploadedScene = { key, scope, af: scope.upload("photivra-chart-floats", packed.af, BUFFER_USAGE.STORAGE), ai: scope.upload("photivra-chart-records", packed.ai, BUFFER_USAGE.STORAGE), packed };
    this.#entries.push(entry);
    while (this.#entries.length > this.keep) this.#entries.shift()!.scope.release();
    return entry;
  }
  /** Scenes currently uploaded (for tests). */
  get size(): number { return this.#entries.length; }
  release(): void { for (const entry of this.#entries.splice(0)) entry.scope.release(); }
}

/** Points as float32 pairs (hi, lo) per coordinate: the float64 point to 2^-48. */
export function splitPoints(points: Float32Array | Float64Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) { const hi = f(points[i]!); out[2 * i] = hi; out[2 * i + 1] = f(points[i]! - hi); }
  return out;
}

export async function evaluateChartCompositeOnGpu(runtime: WebGpuRuntime, bandBytes: number, plan: ChartRadianceBatchPlan, scene: unknown, points: Float32Array | Float64Array,
  indices: Uint8Array | Uint16Array | undefined, abort: AbortController, yieldControl: YieldControl, pipelines: PipelineSource, uploads: ChartSceneUploads): Promise<ChartRadianceResult> {
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(points[i]!) > MAXIMUM_COORDINATE) throw new ImageKernelExecutionError("unsupported-float32-domain", "Chart points beyond 2^20 frame units are outside the float32 domain.");
  }
  const probe = await uploads.probe(pipelines, abort.signal), path = probe.productPath ?? "dekker";
  const uploaded = uploads.get(plan, scene, plan.chart.aspect), table = chartMaterialTable(plan), radianceMode = plan.mode === "radiance";
  const columns = plan.columns, stride = radianceMode ? plan.wavelengthsNanometers.length : columns, count = plan.queryCount;
  const bytesPerQuery = 16 + 4 * columns + 4 + 4, rows = Math.max(1, Math.floor(bandBytes / bytesPerQuery));
  if (Math.max(table.byteLength, Math.min(rows, count) * 4 * columns) > runtime.maximumStorageBindingBytes) {
    throw new ImageKernelExecutionError("insufficient-limits", "Chart tables or bands exceed the device's storage binding limit.");
  }
  const params = new ArrayBuffer(16), words = new Uint32Array(params);
  words[1] = stride; words[2] = radianceMode ? 1 : 0; words[3] = 0; // words[3]: the rounding barrier's zero (chartCompositeWgsl `params.zero`)
  const pipeline = await pipelines(chartCompositeLabel(path), chartCompositeWgsl(path));
  const values = new Float32Array(count * columns), recomputed: number[] = [], split = splitPoints(points);
  const scope = new GpuResourceScope(runtime);
  try {
    const tableBuffer = scope.upload("photivra-chart-table", table, BUFFER_USAGE.STORAGE), gate = createHostYieldGate();
    for (let first = 0; first < count; first += rows) {
      checkAbort(abort.signal);
      const n = Math.min(rows, count - first);
      words[0] = n;
      const band = new GpuResourceScope(runtime);
      try {
        const pointBuffer = band.upload("photivra-chart-points", split.subarray(4 * first, 4 * (first + n)), BUFFER_USAGE.STORAGE);
        const selectors = band.upload("photivra-chart-selectors", indices ? Uint32Array.from(indices.subarray(first, first + n)) : new Uint32Array(1), BUFFER_USAGE.STORAGE);
        const out = band.buffer("photivra-chart-values", n * 4 * columns, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const flagBuffer = band.buffer("photivra-chart-flags", n * 4, BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC);
        const uniform = band.upload("photivra-chart-params", new Uint8Array(params), BUFFER_USAGE.UNIFORM);
        const bindGroup = runtime.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: pointBuffer } }, { binding: 2, resource: { buffer: tableBuffer } },
          { binding: 3, resource: { buffer: uploaded.af } }, { binding: 4, resource: { buffer: uploaded.ai } }, { binding: 5, resource: { buffer: selectors } },
          { binding: 6, resource: { buffer: out } }, { binding: 7, resource: { buffer: flagBuffer } }] });
        const [valueData, flagData] = await runComputePass(runtime, band, pipeline, bindGroup, linearDispatch(n, CHART_COMPOSITE_WORKGROUP_SIZE, runtime.maximumWorkgroupsPerDimension),
          [{ buffer: out, bytes: n * 4 * columns }, { buffer: flagBuffer, bytes: n * 4 }], abort.signal);
        values.set(new Float32Array(valueData!, 0, n * columns), first * columns);
        const bandFlags = new Uint32Array(flagData!, 0, n);
        for (let i = 0; i < n; i++) {
          let recompute = bandFlags[i] !== 0;
          for (let c = 0; c < columns && !recompute; c++) if (!Number.isFinite(values[(first + i) * columns + c]!)) recompute = true;
          if (recompute) recomputed.push(first + i);
        }
      } finally { band.release(); }
      if (yieldControl && gate.due()) { await yieldControl(abort.signal); gate.restart(); }
    }
  } finally { scope.release(); }
  checkAbort(abort.signal);
  integrateChartQueries(plan, values, recomputed);
  for (const q of recomputed) for (let c = 0; c < columns; c++) values[q * columns + c] = plan.queryValue(points, indices, q, c);
  const execution: ImageKernelExecution = webGpuExecution({ kind: "relative-to-reference", relative: 2 ** -24, absolute: 2 ** -126 }, 0);
  return { plan, values, columns, execution, hostRecomputedQueryIndices: Uint32Array.from(recomputed) };
}
