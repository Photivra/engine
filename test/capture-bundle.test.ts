// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

interface Bundle {
  /** The entry chunk's modules (paths relative to src/) with their rendered exports. */
  modules: Map<string, readonly string[]>;
  /** Modules of the chunks loaded only on demand (dynamic imports). */
  lazyModules: Set<string>;
  /** The entry chunk's minified size and its gzip size (level 9). */
  minified: number;
  gzip: number;
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
    const result: Bundle = { modules: new Map(), lazyModules: new Set(), minified: 0, gzip: 0 };
    for (const chunk of output) if (chunk.type === "chunk") {
      if (!chunk.isEntry) { for (const id of Object.keys(chunk.modules)) result.lazyModules.add(srcPath(id)); continue; }
      for (const [id, m] of Object.entries(chunk.modules)) result.modules.set(srcPath(id), m.renderedExports);
      result.minified = Buffer.byteLength(chunk.code);
      result.gzip = gzipSync(chunk.code, { level: 9 }).length;
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
    // Captures use only these portable-math exports: the two of 2.5.0 and V8's three-argument hypot sequence of the
    // capture's query arithmetic (#452), and the arcsine of the defocus disc kernel the capture applies for lens.defocus (#492).
    expect([...(modules.get("core/portable-math.ts") ?? [])].sort()).toEqual(["equalWithinUlps", "hypot3", "portableAsin", "portableHypot"]);
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
