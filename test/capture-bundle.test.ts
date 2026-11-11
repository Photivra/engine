// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/*
 * 2.22.0 (#594): with the on-demand kits the bundler moves modules that the entry shares with a kit into small chunks the entry
 * imports statically, so "what the first load runs" is the entry chunk plus the chunks it imports statically (its eager chunks),
 * not the entry chunk alone. Before 2.22.0 the entry imported no chunk in these shapes, so the eager chunks were the entry chunk
 * and every figure below measured the same thing (2.21.0's display-view addition: 46,270 B and 18,327 B either way).
 */
interface Bundle {
  /** The eager chunks' modules (paths relative to src/) with their rendered exports. */
  modules: Map<string, readonly string[]>;
  /** Modules of the chunks loaded only on demand (dynamic imports). */
  lazyModules: Set<string>;
  /** The eager chunks' minified size and gzip size (level 9), added up. */
  minified: number;
  gzip: number;
  /** Every chunk's gzip size (level 9) added up, the lazy ones included: what an application's total-JavaScript budget counts. */
  totalGzip: number;
  /** Every chunk: its modules, gzip size (level 9), whether it is the entry, and the chunks it imports statically and dynamically. */
  chunks: { fileName: string; modules: Set<string>; gzip: number; isEntry: boolean; imports: readonly string[]; dynamicImports: readonly string[] }[];
}
const srcPath = (id: string): string => id.replace(/\\/g, "/").replace(/^.*\/src\//, "");
/**
 * Bundles a consumer that imports only the named root exports (rolldown, the bundler Vite uses, minified ESM, tree-shaken,
 * dynamic imports split into their own chunks) and returns its entry chunk's modules and size and the lazy chunks' modules.
 */
async function bundle(names: string[]): Promise<Bundle> {
  const dir = mkdtempSync(join(tmpdir(), "photivra-bundle-"));
  try {
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import { ${names.join(", ")} } from ${JSON.stringify(resolve("src/index.ts"))};\nglobalThis.keep = [${names.join(", ")}];\n`);
    const build = await rolldown({ input: entry, logLevel: "silent", resolve: { extensionAlias: { ".js": [".ts", ".js"] } } });
    const { output } = await build.generate({ format: "esm", minify: true });
    await build.close();
    const result: Bundle = { modules: new Map(), lazyModules: new Set(), minified: 0, gzip: 0, totalGzip: 0, chunks: [] };
    const chunks = output.filter((c) => c.type === "chunk");
    // The eager chunks: the entry and, transitively, the chunks it imports statically.
    const eager = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName));
    for (let grew = true; grew;) {
      grew = false;
      for (const c of chunks) if (eager.has(c.fileName)) for (const i of c.imports) if (!eager.has(i)) { eager.add(i); grew = true; }
    }
    for (const chunk of chunks) {
      const gzip = gzipSync(chunk.code, { level: 9 }).length;
      result.totalGzip += gzip;
      result.chunks.push({ fileName: chunk.fileName, modules: new Set(Object.keys(chunk.modules).map(srcPath)), gzip, isEntry: chunk.isEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports });
      if (!eager.has(chunk.fileName)) { for (const id of Object.keys(chunk.modules)) result.lazyModules.add(srcPath(id)); continue; }
      for (const [id, m] of Object.entries(chunk.modules)) result.modules.set(srcPath(id), m.renderedExports);
      result.minified += Buffer.byteLength(chunk.code);
      result.gzip += gzip;
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The display view (2.6) and the portable functions it uses must not reach bundles that only capture (issue #380).
describe("capture-only bundles", () => {
  it("leave out the display view and the portable functions", async () => {
    const { modules } = await bundle(["simulateCapture", "simulateIdealReference"]);
    expect(modules.has("facade/simulate-capture.ts")).toBe(true);
    expect(modules.has("facade/display-view.ts")).toBe(false);
    expect(modules.has("facade/simulate-display-view.ts")).toBe(false);
    // 2.22.0 (#591, #598): the calculator's channel-response helper and the phone DNG import stay out of captures.
    for (const id of ["output/camera-channel-response.ts", "capture/dng-import.ts", "capture/lossy-jpeg.ts", "capture/jpeg-xl-tiles.ts", "capture/dng-opcodes.ts",
      "capture/dng-profile-maps.ts", "capture/dng-stage-image.ts"]) expect(modules.has(id), id).toBe(false);
    // Captures use only these portable-math exports: the two of 2.5.0 and V8's three-argument hypot sequence of the
    // capture's query arithmetic (#452), the arcsine of the defocus disc kernel the capture applies for lens.defocus (#492), and
    // the cosine and sine of the shaped defocus kernel's blade and circle vertices (lens.defocus bokeh options, #553).
    // 2.22.0 (#594): portableExp and portablePow (about 1 KB of source) are in the first load too, but only because the on-demand
    // Quality kit (diffraction, defocus extras) imports them from the chunk that portable-math shares with the capture; the
    // capture's own code does not call them.
    expect([...(modules.get("core/portable-math.ts") ?? [])].sort()).toEqual(["equalWithinUlps", "hypot3", "portableAsin", "portableCosTwoPi", "portableExp", "portableHypot",
      "portablePow", "portableSinTwoPi"]);
  }, testTimeout(60_000));

  it("keep them when the display view is imported", async () => {
    const { modules } = await bundle(["simulateDisplayView"]);
    expect(modules.has("facade/display-view.ts")).toBe(true);
    expect(modules.has("facade/simulate-display-view.ts")).toBe(true);
    expect(modules.get("core/portable-math.ts")).toEqual(expect.arrayContaining(["portablePow", "portableLog", "portableExp", "portableCbrt"]));
  }, testTimeout(60_000));
});

// The WebGPU display view (2.11) is loaded only when prepareDisplayView is asked for a GPU mode (issue #383): a bundler that
// splits dynamic imports keeps it out of the first load. A build that cannot split (for example Vite's default "iife" worker
// format) inlines it; docs/DISPLAY_VIEW.md, "Bundle size".
describe("display-view bundles", () => {
  it("load the GPU display view and the WebGPU kernels only on demand", async () => {
    const { modules, lazyModules } = await bundle(["simulateCapture", "simulateDisplayView", "prepareDisplayView"]);
    expect(modules.has("facade/simulate-display-view.ts")).toBe(true);
    expect([...modules.keys()].filter((id) => id.startsWith("gpu/") || id === "facade/display-view-gpu-session.ts")).toEqual([]);
    expect(lazyModules.has("facade/display-view-gpu-session.ts")).toBe(true);
    expect(lazyModules.has("gpu/display-view-quality-gpu.ts")).toBe(true);
  }, testTimeout(60_000));

  // 2.22.0: measured on the eager chunks (see Bundle): 38,370 B minified and 14,123 B gzip (2.21.0: 46,270 B and 18,327 B); the
  // coupled rendering steps (#593, #601) and the view's diffraction kernels load with the Quality kit (#594).
  // Issue #383: the size simulateDisplayView adds to a capture bundle, measured October 31, 2026 on 2.11.1's display view
  // (rolldown 1.2.9, Node.js zlib level 9) at 42,239 B minified and 16,888 B gzip. The budgets allow about 2 % for compressor
  // and bundler versions; a change that adds to the display view raises them here and records its delta in CHANGELOG.md.
  // Raised for #457's AHD choice (#527): measured October 31, 2026 at 45,546 B minified and 18,186 B gzip (+3,307 B and
  // +1,294 B, all in facade/display-view.ts); the budgets are about 2 % above that.
  it("keep the display view's added size within its budget", async () => {
    const base = await bundle(["simulateCapture", "simulateIdealReference"]);
    const view = await bundle(["simulateCapture", "simulateIdealReference", "simulateDisplayView"]);
    expect(view.minified - base.minified).toBeLessThanOrEqual(46_500);
    expect(view.gzip - base.gzip).toBeLessThanOrEqual(18_550);
  }, testTimeout(120_000));
});

// The app's capture worker (Photivra/apps, src/capture/capture.worker.ts and gpuWorker.ts) imports exactly these root exports.
// Its total JavaScript budget counts every chunk, lazy ones included, so this measures them all. Measured November 7, 2026 on
// 2.17.0: 347,775 B gzip in total (2.16.0: 323,428 B; 2.15.0: 311,439 B), the growth being the new options' own code, which
// `simulateCapture` and `prepareDisplayView` reach at run time (tree-shaking leaves out the unused root exports). The limit is that
// measurement plus a few hundred bytes, so a change that grows the app's worker shows here instead of in the app's build. Raising
// it is the owner's decision. Raised 348,000 → 352,000 B: owner-approved 2026-11-09 for engine 2.18.0 (#568 fast catalogue chunk);
// 2.18.0 measured 351,859 B (#568's lazily loaded fast catalogue code +2,907 B, #569's display-view catalogue PSF +550 B, #576's
// ideal lens and its f-number range, #569's fixes).
// 2.19.0 measured 351,775 B: the five parts merged measured 353,811 B (#570's lens corrections +1,735 B), and sharing the
// parsers' duplicated private field checks (docs/RELEASE_2_19_0.md, "Sizes") saved 2,036 B. The limit is unchanged.
// 2.21.0 part #581 measured +175 B on 2.19.0: the image-plane scene's module, lattice data and GPU code load only through
// prepareImagePlaneScenes(), which this shape does not import.
// 2.20.0 measured 355,994 B: the eight parts merged measured 355,892 B (#555/#535 sensor characteristics and noise figure +2,157 B,
// #587 DNG opcodes +1,197 B, #567 catalogue bokeh +595 B, #565 +197 B) and the speed-versus-accuracy scheme +517 B; sharing
// duplicated helpers and record-literal field lists saved 415 B (docs/RELEASE_2_20_0.md, "Sizes"). Raised 352,000 → 356,000 B
// (the measured total rounded up to the next 100 B): owner-approved 2026-11-09 for engine 2.20.0 only, for the 2.20.0 features.
//
// #594 (owner answers 2026-11-10): the shape has two rows. "Fast worker" is every chunk except the on-demand Quality chunks (the
// GPU Speed session, catalogue and lens-signal chunks included); "on demand" is the Quality chunks, found by module membership
// (QUALITY_ON_DEMAND_MODULES), so a chunk's file name does not matter. Each limit is its row's measurement rounded up to the next
// 100 B. Measured November 11, 2026 on 2.21.0 with the GPU Quality host split out (group E1 of 2.22.0; rolldown 1.2.9, Node.js
// zlib level 9): fast worker 344,237 B, on demand 20,025 B (the GPU Quality chunk), all chunks 364,262 B; with the load-failure
// fallback (owner, 2026-11-10) 344,287 B and 20,026 B (364,313 B). Owner-accepted 2026-11-10: these two rows replace the
// single all-chunk limit, and the all-chunk growth is accepted. Before the split
// (2.21.0, limit 363,700 B on all chunks): 363,695 B, all of it fast. The split moves 19,458 B out of the fast worker; the
// all-chunk total grows 567 B (a second chunk compresses without the first's dictionary, and the chunks name their shared
// bindings). The CPU Quality kit (#594, after groups A–D) adds its modules to QUALITY_ON_DEMAND_MODULES and re-measures both rows.
// bindings).
// 2.22.0 (#594, CPU split): the CPU full-quality code is one on-demand chunk (src/facade/quality-kit.ts: diffraction, the capture's
// AHD demosaic, lens.defocus beyond the geometric disc, the image-space provider, #593/#601's coupled rendering steps and #602's
// neighbor highlight reconstruction) and the opt-in features another (src/facade/opt-in-kit.ts: sensor.profile, illumination,
// motion.subject); #593's GPU coupled steps were already their own on-demand chunk. Measured November 11, 2026 on the integrated
// 2.22.0 tree (rolldown 1.2.9, Node.js zlib level 9): with the parts merged and before this split, fast worker 358,680 B (the
// coupled-step chunks counted as fast) and on demand 19,379 B; after it, fast worker 337,373 B and on demand 46,940 B (GPU Quality
// 19,364 B, CPU Quality kit 18,249 B, GPU coupled steps 5,159 B, opt-in kit 4,168 B), 384,313 B in all. The fast worker's
// first load is now the entry chunk (252,367 B) and ten small chunks it imports statically, which it shares with the kits. Each limit is its row's
// measurement rounded up to the next 100 B (owner answer 2, 2026-11-10).
const WORKER_SHAPE = ["NATIVE_RAW_LIMITS", "prepareDisplayView", "serializeSimulatedCaptureDngFromParts", "simulateCapture", "simulateIdealReference"];
/** The modules whose chunks load only at the first request that needs them (#594): the GPU Quality host, the GPU coupled steps and the two CPU kits. */
const QUALITY_ON_DEMAND_MODULES = ["gpu/display-view-quality-gpu.ts", "gpu/wgsl-display-view-quality-kernel.ts", "gpu/wgsl-display-view-coupled.ts",
  "facade/quality-kit.ts", "facade/opt-in-kit.ts"];
/** The modules each CPU kit holds (#594): none may reach the fast worker's chunks. */
const CPU_QUALITY_KIT_MODULES = ["facade/quality-kit.ts", "optics/diffraction-psf-profile.ts", "optics/site-diffraction-kernel.ts", "optics/lens-psf-kernels.ts", "processing/demosaic.ts",
  "facade/defocus-bokeh-zones.ts", "facade/large-defocus-lattice.ts", "facade/defocus-image-space-provider.ts", "facade/display-view-rendering.ts", "color/neighbor-highlight-reconstruction.ts"];
const OPT_IN_KIT_MODULES = ["facade/opt-in-kit.ts", "equipment/sensor-profile-body.ts", "facade/mixed-illumination.ts", "motion/subject-motion.ts"];
const isOnDemand = (chunk: Bundle["chunks"][number]): boolean => QUALITY_ON_DEMAND_MODULES.some((id) => chunk.modules.has(id));
describe("the app's capture-worker shape", () => {
  it("keeps the fast worker and the on-demand Quality chunks within their measured sizes", async () => {
    const worker = await bundle(WORKER_SHAPE);
    const onDemand = worker.chunks.filter(isOnDemand), fast = worker.chunks.filter((c) => !isOnDemand(c));
    const sum = (chunks: Bundle["chunks"]): number => chunks.reduce((total, c) => total + c.gzip, 0);
    expect(sum(fast)).toBeLessThanOrEqual(337_500);
    expect(sum(onDemand)).toBeLessThanOrEqual(47_000);
    expect(sum(fast) + sum(onDemand)).toBe(worker.totalGzip);
    // #581: the image-plane scene's module, lattice data and GPU module are reachable only through prepareImagePlaneScenes().
    expect([...worker.lazyModules, ...worker.modules.keys()].filter((id) => /image-plane(?!-support)/u.test(id))).toEqual([]);
    // #165: the C2PA export writers load only when an application imports them, never in the capture worker.
    expect([...worker.lazyModules, ...worker.modules.keys()]).not.toContain("capture/c2pa-embed.ts");
  }, testTimeout(120_000));

  // #594: the GPU Quality host is one chunk that only a dynamic import reaches, from the GPU session chunk; no other chunk imports
  // it statically, and it holds no module the fast paths need.
  it("loads the GPU Quality host only on demand, as one chunk", async () => {
    const worker = await bundle(WORKER_SHAPE);
    const quality = worker.chunks.filter((c) => c.modules.has("gpu/display-view-quality-gpu.ts"));
    expect(quality).toHaveLength(1);
    const chunk = quality[0]!;
    expect(chunk.isEntry).toBe(false);
    expect([...chunk.modules].sort()).toEqual(["gpu/display-view-quality-gpu.ts", "gpu/wgsl-display-view-quality-kernel.ts", "gpu/wgsl-exact-sum.ts"]);
    expect(worker.chunks.filter((c) => c.imports.includes(chunk.fileName))).toEqual([]);
    const loaders = worker.chunks.filter((c) => c.dynamicImports.includes(chunk.fileName));
    expect(loaders.map((c) => c.modules.has("gpu/display-view-gpu-renderer.ts"))).toEqual([true]);
  }, testTimeout(120_000));

  // #594 (owner, 2026-11-10): one Quality kit and one opt-in kit, each one chunk that only the entry's dynamic import reaches; the
  // fast worker never imports their modules statically.
  it("loads the CPU Quality kit and the opt-in kit only on demand, each as one chunk", async () => {
    const worker = await bundle(WORKER_SHAPE);
    for (const modules of [CPU_QUALITY_KIT_MODULES, OPT_IN_KIT_MODULES]) {
      const holders = worker.chunks.filter((c) => modules.some((id) => c.modules.has(id)));
      expect(holders).toHaveLength(1);
      const chunk = holders[0]!;
      expect(chunk.isEntry).toBe(false);
      expect([...chunk.modules].filter((id) => !id.endsWith("rolldown/runtime.js")).sort()).toEqual([...modules].sort());
      expect(worker.chunks.filter((c) => c.imports.includes(chunk.fileName))).toEqual([]);
      expect(worker.chunks.filter((c) => c.dynamicImports.includes(chunk.fileName)).map((c) => c.isEntry)).toEqual([true]);
      for (const id of modules) expect(worker.modules.has(id), id).toBe(false);
    }
  }, testTimeout(120_000));

  // #594: importing the optional preload keeps the Quality chunks on demand (it reaches them only through dynamic imports).
  it("keeps the Quality chunks on demand when prepareQualityPaths is imported", async () => {
    const worker = await bundle([...WORKER_SHAPE, "prepareQualityPaths"]);
    const eager = [...worker.modules.keys()];
    expect(eager.filter((id) => QUALITY_ON_DEMAND_MODULES.includes(id) || CPU_QUALITY_KIT_MODULES.includes(id) || OPT_IN_KIT_MODULES.includes(id) || id.startsWith("gpu/display-view"))).toEqual([]);
    expect(worker.chunks.filter(isOnDemand)).toHaveLength(4);
  }, testTimeout(120_000));

  // #554 (owner, 2026-11-09): sensor.profile takes the record, so the worker never bundles the profile catalogue, only its parser.
  it("leaves out the sensor profile catalogue", async () => {
    const worker = await bundle(WORKER_SHAPE);
    expect(worker.modules.has("equipment/sensor-profiles.ts") || worker.lazyModules.has("equipment/sensor-profiles.ts")).toBe(false);
    // 2.22.0 (#594): the parser and body builder load with the opt-in kit (2.21.0 imported them statically).
    expect(worker.modules.has("equipment/sensor-profile-body.ts")).toBe(false);
    expect(worker.lazyModules.has("equipment/sensor-profile-body.ts")).toBe(true);
  }, testTimeout(120_000));
});
