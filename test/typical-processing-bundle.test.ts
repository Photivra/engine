// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";
import { wgslMinifyPlugin } from "../scripts/lib/wgsl-minify.mjs";

/*
 * #740 (2.29.0 plan, owner decision 3): `simulateTypicalProcessing`'s body is its own on-demand chunk with a measured row ("typical
 * processing", limit its measurement rounded up to the next 100 B), and the stub's added first-load bytes are a second row. Measured
 * like test/capture-bundle.test.ts (rolldown 1.2.14, minified ESM, the shipped WGSL minifier, gzip level 9), with the app's
 * capture-worker shape and the root export.
 */

const WORKER_SHAPE = ["NATIVE_RAW_LIMITS", "prepareDisplayView", "serializeSimulatedCaptureDngFromParts", "simulateCapture", "simulateIdealReference"];
const BODY_MODULES = ["processing/image-ops.ts", "processing/tone-mapping.ts", "processing/denoise.ts", "capture/dng-opcodes.ts", "capture/dng-profile-maps.ts",
  "capture/dng-raw-measurements.ts", "capture/dng-stage-image.ts", "capture/dng-development.ts", "processing/frame-merge.ts", "processing/saturation.ts", "facade/typical-processing.ts"];
const srcPath = (id: string): string => id.replace(/\\/g, "/").replace(/^.*\/src\//, "");

interface Chunk { fileName: string; modules: string[]; gzip: number; isEntry: boolean; imports: readonly string[] }

async function bundle(withTypical: boolean): Promise<{ chunks: Chunk[]; eagerGzip: number; totalGzip: number }> {
  const dir = mkdtempSync(join(tmpdir(), "photivra-typical-"));
  try {
    const entry = join(dir, "entry.mjs");
    const names = withTypical ? [...WORKER_SHAPE, "simulateTypicalProcessing"] : WORKER_SHAPE;
    writeFileSync(entry, `import { ${names.join(", ")} } from ${JSON.stringify(resolve("src/index.ts"))};\nglobalThis.keep = [${names.join(", ")}];\n`);
    const build = await rolldown({ input: entry, logLevel: "silent", resolve: { extensionAlias: { ".js": [".ts", ".js"] } }, plugins: [wgslMinifyPlugin()] });
    const { output } = await build.generate({ format: "esm", minify: true });
    await build.close();
    const chunks: Chunk[] = output.filter((c) => c.type === "chunk").map((c) => ({ fileName: c.fileName, modules: Object.keys(c.modules).map(srcPath),
      gzip: gzipSync(c.code, { level: 9 }).length, isEntry: c.isEntry, imports: c.imports }));
    const eager = new Set(chunks.filter((c) => c.isEntry).map((c) => c.fileName));
    for (let grew = true; grew;) {
      grew = false;
      for (const c of chunks) if (eager.has(c.fileName)) for (const i of c.imports) if (!eager.has(i)) { eager.add(i); grew = true; }
    }
    const sum = (list: Chunk[]): number => list.reduce((t, c) => t + c.gzip, 0);
    return { chunks, eagerGzip: sum(chunks.filter((c) => eager.has(c.fileName))), totalGzip: sum(chunks) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("simulateTypicalProcessing bundles (#740)", () => {
  /**
   * Measured on the 2.29.0 integration tree (2026-11-23): the body 17,889 B gzip (limit 17,900 B); the stub adds 1,331 B to the first load (limit
   * 1,400 B), 874 B of it the correlated-color-temperature functions of color/illuminants.ts that the development's white balance
   * uses (that module is in the first load already, so its newly used exports render there). In a bundle with both, processing/demosaic.ts
   * leaves the CPU Quality kit for a chunk of its own that both import (+1,448 B over all chunks); the worker's own rows are unchanged.
   */
  it("keeps the body in one on-demand chunk and the worker without it", async () => {
    const worker = await bundle(false), withTypical = await bundle(true);
    for (const c of worker.chunks) expect(c.modules.filter((m) => m.startsWith("facade/typical-processing")), c.fileName).toEqual([]);
    const body = withTypical.chunks.filter((c) => c.modules.includes("facade/typical-processing.ts"));
    expect(body).toHaveLength(1);
    expect(body[0]!.isEntry).toBe(false);
    expect([...body[0]!.modules].sort()).toEqual([...BODY_MODULES].sort());
    expect(withTypical.chunks.filter((c) => c.imports.includes(body[0]!.fileName))).toEqual([]);
    expect(body[0]!.gzip).toBeLessThanOrEqual(17_900);
    expect(withTypical.eagerGzip - worker.eagerGzip).toBeLessThanOrEqual(1_400);
  }, testTimeout(120_000));
});
