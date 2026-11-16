// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.26.0 (owner decision 2026-11-16, "Move export code out"): the JPEG and PNG writers are the export kit (src/facade/export-kit.ts),
 * loaded where simulateCapture parses output.format "jpeg" or "png". From a fresh module graph (a cold worker) the kit is not loaded
 * until the first export asks for it, loads once, and gives the same bytes as a warm export.
 */
import type { SimulateCaptureOptions } from "../src/index.js";

const options = (format: "jpeg" | "png" | "srgb-8"): SimulateCaptureOptions => ({ scene: { preset: "siemens-star" }, output: { width: 24, height: 16, format,
  ...(format === "srgb-8" ? {} : { metadata: { description: "cold export", software: "test" } }) } });

describe("export kit (2.26.0)", () => {
  it("loads on the first JPEG or PNG export from a cold worker, once, with a warm export's bytes", async () => {
    vi.resetModules();
    const kits = await import("../src/facade/on-demand-kits.js"), engine = await import("../src/index.js");
    expect(kits.exportKit.loaded).toBeUndefined();
    await engine.simulateCapture(options("srgb-8"));
    expect(kits.exportKit.loaded).toBeUndefined();
    const started = performance.now(), cold = await engine.simulateCapture(options("jpeg")), coldMs = performance.now() - started;
    expect(kits.exportKit.loaded).toBeDefined();
    const loaded = kits.exportKit.loaded;
    const warm = await engine.simulateCapture(options("jpeg"));
    expect(kits.exportKit.loaded).toBe(loaded);
    expect(Array.from(cold.image.jpeg!)).toEqual(Array.from(warm.image.jpeg!));
    expect(cold.image.jpeg![0]).toBe(0xff);
    expect(coldMs).toBeGreaterThan(0);
    // A second cold graph: PNG first.
    vi.resetModules();
    const kits2 = await import("../src/facade/on-demand-kits.js"), engine2 = await import("../src/index.js");
    expect(kits2.exportKit.loaded).toBeUndefined();
    const png = await engine2.simulateCapture(options("png"));
    expect(kits2.exportKit.loaded).toBeDefined();
    expect(Array.from(png.image.png!)).toEqual(Array.from((await engine.simulateCapture(options("png"))).image.png!));
  }, scaledTimeout(60_000));
});
