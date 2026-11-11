// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIMULATE_CAPTURE_FAST_OPTIONS, prepareDisplayView, serializeSimulatedCaptureDngFromParts, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { SIMULATE_CAPTURE_FAST_METHODS } from "../src/facade/fast-methods.js";
import { fastFormatDefault, resolveFast } from "../src/facade/fast-resolution.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * 2.20.0 (owner): the speed-versus-accuracy rule is enforced, not only followed. Every choice is in the registry
 * (src/facade/fast-methods.ts), resolves through the one resolver (record fast > top-level fast > format default) and is
 * reported; the format defaults are the owner's: fast for srgb-8/16 and the display view, exact for dng, jpeg, png and the ideal reference.
 */
const source = (file: string): string => readFileSync(file, "utf8");
const facade = readdirSync("src/facade").filter((f) => f.endsWith(".ts")).map((f) => "src/facade/" + f);

describe("the fast-method registry (2.20.0)", () => {
  it("has an entry for every record that accepts fast, and for every listed fast option", () => {
    const overrides = new Set(SIMULATE_CAPTURE_FAST_METHODS.map((e) => e.override));
    const accepting = new Set<string>();
    for (const file of facade) for (const m of source(file).matchAll(/allowKeys\([^,]+,\s*"([^"]+)",\s*\[[^\]]*"fast"/gu)) accepting.add(m[1] === "simulateCapture options" ? "fast" : m[1]!);
    for (const m of source("src/facade/simulate-capture.ts").matchAll(/fastOverride\([^,]+,\s*"([^"]+)"\)/gu)) accepting.add(m[1]!);
    expect(accepting.size).toBeGreaterThan(4);
    for (const path of accepting) expect(overrides, path + " accepts fast without a registry entry").toContain(path);
    const applied = new Set(SIMULATE_CAPTURE_FAST_METHODS.map((e) => e.report.applied).filter((a) => a !== undefined));
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) expect(applied, option).toContain(option);
  });

  it("gives every entry a resolver found in its source, a report, and the format default", () => {
    expect(new Set(SIMULATE_CAPTURE_FAST_METHODS.map((e) => e.id)).size).toBe(SIMULATE_CAPTURE_FAST_METHODS.length);
    for (const entry of SIMULATE_CAPTURE_FAST_METHODS) {
      expect(entry.followsFormatDefault, entry.id).toBe(true);
      expect(source(entry.resolver.file), entry.id + ": resolver call").toContain(entry.resolver.call);
      const { applied, assumption, field } = entry.report;
      expect(applied ?? assumption ?? field, entry.id + ": report").toBeTruthy();
      if (applied) expect(SIMULATE_CAPTURE_FAST_OPTIONS as readonly string[], entry.id).toContain(applied);
      if (assumption) expect(facade.some((f) => source(f).includes('"' + assumption + '"')), entry.id + ": assumption " + assumption).toBe(true);
      if (entry.methods === "fast-and-exact") expect(entry.fast.length * entry.exact.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("keeps no default logic of its own: every record flag goes through resolveFast", () => {
    const capture = source("src/facade/simulate-capture.ts");
    // The record flags (catalogueFast, diffractionFast, demosaicFast, ...) are read only through resolveFast or the fast report.
    expect(capture).not.toMatch(/Fast \?\? /u);
    expect(capture).not.toMatch(/format === "(dng|jpeg|png)"\s*\|\|\s*format === "(dng|jpeg|png)"\)?\s*(as boolean)?;?\s*$/mu);
    expect(capture).toContain("resolveFast(top.fast as boolean | undefined, fastFormatDefault(format,");
    expect(resolveFast(undefined, true)).toBe(true);
    expect(resolveFast(false, true)).toBe(false);
    expect(resolveFast(true, false)).toBe(true);
  });

  it("defaults each format as the owner's rule says", () => {
    for (const [format, fast] of [["srgb-8", true], ["srgb-16", true], ["dng", false], ["jpeg", false], ["png", false]] as const) expect(fastFormatDefault(format, "capture"), format).toBe(fast);
    expect(fastFormatDefault("srgb-8", "display-view")).toBe(true);
    expect(fastFormatDefault("srgb-8", "ideal-reference")).toBe(false);
    expect(fastFormatDefault("png", "ideal-reference")).toBe(false);
  });

  it("reports the resolved default and its origin on every run", async () => {
    const base: SimulateCaptureOptions = { scene: { preset: "uniform" }, output: { width: 8, height: 8 }, sensor: { spectralStepNanometers: 100 } };
    for (const [format, fast] of [["srgb-8", true], ["srgb-16", true], ["dng", false], ["jpeg", false], ["png", false]] as const) {
      const r = await simulateCapture({ ...base, output: { ...base.output, format } });
      expect(r.diagnostics.fast, format).toMatchObject({ requested: fast, defaultedFrom: "format" });
      expect((await simulateCapture({ ...base, output: { ...base.output, format }, fast: !fast })).diagnostics.fast, format).toMatchObject({ requested: !fast, defaultedFrom: "request" });
    }
    const view = await simulateDisplayView(base, { width: 4, height: 4 });
    expect(view.diagnostics.fast).toMatchObject({ requested: true, defaultedFrom: "format" });
    const prepared = await prepareDisplayView(base);
    expect((await prepared.render({ width: 4, height: 4 })).diagnostics.fast.execution.gpu).toBe("auto");
    await prepared.dispose();
    const exactView = await prepareDisplayView({ ...base, fast: false });
    expect((await exactView.render({ width: 4, height: 4 })).diagnostics.fast.execution.gpu).toBe("off");
    await exactView.dispose();
  }, scaledTimeout(120_000));

  it("saves JPEG at quantization step 1 by default (full quality, 2.20.0) and keeps step 2 on request", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "checkerboard" }, output: { width: 16, height: 16, format: "jpeg" } };
    const full = await simulateCapture(options), old = await simulateCapture({ ...options, output: { ...options.output, jpegQuantizationStep: 2 } });
    expect(full.assumptions.find((a) => a.id === "output.jpegQuantizationStep")?.value).toBe(1);
    expect(full.image.jpeg!.length).toBeGreaterThan(old.image.jpeg!.length);
  }, scaledTimeout(60_000));

  it("refuses fast parts in a join that resolves to exact, and takes them in one that resolves to fast", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 16, height: 12, format: "dng" }, sensor: { spectralStepNanometers: 100 } };
    const parts = [];
    for (const y of [0, 6]) {
      const r = await simulateCapture({ ...options, output: { width: 16, height: 12, region: { x: 0, y, width: 16, height: 6 } } });
      parts.push({ raw: r.raw, region: r.region!, fast: Object.values(r.diagnostics.fast.applied).includes(true) });
    }
    const exactBytes = (await serializeSimulatedCaptureDngFromParts(options, parts)).bytes;
    expect(exactBytes).toEqual((await simulateCapture(options)).image.dng);
    const flagged = parts.map((p) => ({ ...p, fast: true }));
    await expect(serializeSimulatedCaptureDngFromParts(options, flagged)).rejects.toThrow(/Part 0: a fast method rendered it/u);
    expect((await serializeSimulatedCaptureDngFromParts({ ...options, fast: true }, flagged)).bytes).toEqual(exactBytes);
  }, scaledTimeout(60_000));

  it("gives the display view's AHD low-signal correction an exact method (H3)", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "uniform" }, output: { width: 16, height: 12, demosaic: "ahd" }, sensor: { spectralStepNanometers: 100 } };
    const value = (r: { assumptions: readonly { id: string; value: unknown }[] }): unknown => r.assumptions.find((a) => a.id === "view.demosaic")!.value;
    const fast = await simulateDisplayView(options, { width: 4, height: 3 }), exact = await simulateDisplayView({ ...options, fast: false }, { width: 4, height: 3 });
    expect(value(fast)).toMatchObject({ correctionDrawsPerState: 2048, correctionThresholdLinearStd: 0.01 });
    expect(value(exact)).toMatchObject({ correctionDrawsPerState: 8192, correctionThresholdLinearStd: 0.01 });
    expect(fast.diagnostics.fast).toMatchObject({ applied: { "output.demosaic.ahd": true }, assurance: "approximation-with-a-priori-bound" });
    expect(exact.diagnostics.fast).toMatchObject({ applied: { "output.demosaic.ahd": false }, assurance: "engine-reference" });
  }, scaledTimeout(60_000));

  it("gives the display view's sampling of uniform pixels an exact method (H2)", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "siemens-star" }, output: { width: 96, height: 64 }, sensor: { spectralStepNanometers: 100 } };
    const value = (r: { assumptions: readonly { id: string; value: unknown }[] }): unknown => r.assumptions.find((a) => a.id === "view.estimation")!.value;
    const fast = await simulateDisplayView(options, { width: 12, height: 8, samplesPerAxis: 8 });
    const exact = await simulateDisplayView({ ...options, fast: false }, { width: 12, height: 8, samplesPerAxis: 8 });
    expect(value(fast)).toMatchObject({ samplesPerAxis: 8, uniformSamplesPerAxis: 2 });
    expect(value(exact)).toMatchObject({ samplesPerAxis: 8, uniformSamplesPerAxis: 8 });
    expect(exact.diagnostics.sampleCount).toBeGreaterThan(fast.diagnostics.sampleCount);
  }, scaledTimeout(60_000));

  it("gives a print under mixed lighting a GPU (fast) and a CPU (exact) method (#597)", async () => {
    const { prepareImagePlaneScenes } = await import("../src/index.js"), { createFakeGpu } = await import("./helpers/fake-webgpu.js");
    const { registerDisplayViewGpuRenderer } = await import("../src/gpu/display-view-quality-gpu.js"), { setDisplayViewGpuRendererFactory } = await import("../src/facade/display-view-gpu.js");
    await prepareImagePlaneScenes();
    const data = Uint8Array.from({ length: 8 * 6 * 3 }, (_, i) => (i * 37) % 256);
    const options: SimulateCaptureOptions = { scene: { kind: "image-plane", sceneId: "p", image: { width: 8, height: 6, channels: 3, encoding: "srgb-8", data } }, output: { width: 24, height: 16 },
      sensor: { spectralStepNanometers: 100 }, illumination: { sources: [{ illuminant: { kind: "cie-a" }, illuminanceLux: 3000 }, { illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 9000 }],
        blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } } } };
    const previous = registerDisplayViewGpuRenderer();
    try {
      // The fast default is gpu "auto" (checked above); here with a device to run on. Exact (fast: false) is gpu "off".
      const fast = await prepareDisplayView(options, { gpu: "auto", gpuDevice: createFakeGpu().gpu }), exact = await prepareDisplayView({ ...options, fast: false });
      try {
        const a = await fast.render({ width: 12, height: 8 }), b = await exact.render({ width: 12, height: 8 });
        expect(a.diagnostics.fast.execution).toMatchObject({ gpu: "auto", backend: "webgpu-f32", fallbackReason: null });
        expect(b.diagnostics.fast.execution).toMatchObject({ gpu: "off", backend: "cpu-reference" });
        for (let i = 0; i < a.image.samples.length; i++) expect(Math.abs(a.image.samples[i]! - b.image.samples[i]!)).toBeLessThanOrEqual(1);
      } finally { fast.dispose(); exact.dispose(); }
    } finally { setDisplayViewGpuRendererFactory(previous); }
  }, scaledTimeout(120_000));

  it("gives the display view's catalogue PSF zones an exact method, one site per zone (H1)", async () => {
    const options: SimulateCaptureOptions = { scene: { preset: "uniform" }, output: { width: 66, height: 44 }, lens: { catalogue: "pv-50-1.8" },
      sensor: { pixelPitchMicrometers: 36000 / 66, spectralStepNanometers: 100 } };
    const view = { width: 33, height: 22, region: { x: 16, y: 11, width: 1, height: 1 } };
    const zones = (r: { assumptions: readonly { id: string; value: unknown }[] }): unknown => (r.assumptions.find((a) => a.id === "view.lensPsf")!.value as { zoneSites: number }).zoneSites;
    const fast = await simulateDisplayView(options, view);
    expect(zones(fast)).toBe(2);
    expect(fast.diagnostics.fast.applied).toMatchObject({ "lens.catalogue": true });
    const exact = await simulateDisplayView({ ...options, fast: false }, view);
    expect(zones(exact)).toBe(1);
    expect(exact.diagnostics.fast.applied).toMatchObject({ "lens.catalogue": false });
  }, scaledTimeout(60_000));
});
