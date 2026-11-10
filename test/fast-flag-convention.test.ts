// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIMULATE_CAPTURE_COST_OPTIONS, SIMULATE_CAPTURE_FAST_OPTIONS, simulateCapture, simulateDisplayView, type SimulateCaptureFastOption,
  type SimulateCaptureOptions } from "../src/index.js";
import { cpuExecution, webGpuExecution } from "../src/gpu/image-kernel-execution.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/*
 * #395: one exact-or-fast convention across the engine. The top-level `fast` sets every listed option; an option's record
 * `fast` overrides it for that option; `diagnostics.fast` reports what was requested and what ran. Only `lens.catalogue` has a
 * fast method (#568, tested in simulate-capture-lens-catalogue-fast.test.ts): every other option must give the exact result, byte
 * for byte, and report `false`; `lens.catalogue` reports `true` exactly when its effective flag is true.
 */
/** Options with a fast method. */
const WITH_FAST_METHOD: readonly SimulateCaptureFastOption[] = ["lens.catalogue", "motion.subject"];
type Options = Record<string, Record<string, unknown> | unknown>;
// 2.20.0: fast: false here, so a test's own fast overrides an exact request (the format default, fast for sRGB, is tested at the end
// and in fast-methods-registry.test.ts).
const base: Options = { scene: { preset: "siemens-star" }, output: { width: 32, height: 24 }, fast: false };
/** Two-level merge: `extra`'s groups (lens, sensor, output) are merged into the base's. */
const request = (extra: Options): SimulateCaptureOptions => {
  const out: Options = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = typeof value === "object" && value !== null && typeof out[key] === "object" ? { ...(out[key] as object), ...(value as object) } : value;
  }
  return out as unknown as SimulateCaptureOptions;
};
/** Each fast-capable option: the shorthand that turns it on, and its record form with `fast`. */
const FORMS: Record<SimulateCaptureFastOption, { shorthand: Options; record: (fast: boolean) => Options }> = {
  "lens.diffraction": { shorthand: { lens: { diffraction: "circular-aperture" } }, record: (fast) => ({ lens: { diffraction: { kind: "circular-aperture", fast } } }) },
  "lens.catalogue": { shorthand: { lens: { catalogue: "pv-50-1.8", fNumber: 8 } }, record: (fast) => ({ lens: { catalogue: { kind: "pv-50-1.8", fast }, fNumber: 8 } }) },
  "sensor.antiAliasing": { shorthand: { sensor: { antiAliasing: { kind: "four-spot" } } }, record: (fast) => ({ sensor: { antiAliasing: { kind: "four-spot", fast } } }) },
  "sensor.pixelAperture.box": { shorthand: { sensor: { pixelAperture: "box" } }, record: (fast) => ({ sensor: { pixelAperture: { kind: "box", fast } } }) },
  "output.demosaic.ahd": { shorthand: { output: { demosaic: "ahd" } }, record: (fast) => ({ output: { demosaic: { kind: "ahd", fast } } }) },
  // #551: a short streak (well under one site), so the fast method takes fewer temporal midpoints than the default 8.
  "motion.subject": { shorthand: { motion: { subject: { velocityMPerSec: { x: 0.001 } } } }, record: (fast) => ({ motion: { subject: { velocityMPerSec: { x: 0.001 }, fast } } }) }
};
const samples = (r: { image: { samples: Uint8Array | Uint16Array } }): number[] => Array.from(r.image.samples);

describe("exact-or-fast flag convention (#395)", () => {
  it("lists every fast-capable option once, as a cost option, with a test case here", () => {
    expect(new Set(SIMULATE_CAPTURE_FAST_OPTIONS).size).toBe(SIMULATE_CAPTURE_FAST_OPTIONS.length);
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) expect(SIMULATE_CAPTURE_COST_OPTIONS as readonly string[]).toContain(option);
    // A new fast-capable option must add its forms above, so the checks below cover it.
    expect(Object.keys(FORMS).sort()).toEqual([...SIMULATE_CAPTURE_FAST_OPTIONS].sort());
  });

  it("reports exact and nothing requested with fast: false, and the format's default without it (2.20.0)", async () => {
    const result = await simulateCapture(request({}));
    expect(result.diagnostics.fast).toEqual({ requested: false, defaultedFrom: "request", applied: {}, assurance: "engine-reference" });
    const withoutFast: Options = { ...base };
    delete withoutFast.fast;
    expect((await simulateCapture(withoutFast as unknown as SimulateCaptureOptions)).diagnostics.fast).toEqual({ requested: true, defaultedFrom: "format", applied: {}, assurance: "engine-reference" });
    expect((await simulateCapture({ ...withoutFast, output: { width: 32, height: 24, format: "png" } } as unknown as SimulateCaptureOptions)).diagnostics.fast)
      .toEqual({ requested: false, defaultedFrom: "format", applied: {}, assurance: "engine-reference" });
  });

  it("accepts the top-level flag and each option's record flag, runs exact unless the option has a fast method, and reports what ran", async () => {
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) {
      const form = FORMS[option], hasFast = WITH_FAST_METHOD.includes(option);
      const exact = await simulateCapture(request(form.shorthand));
      expect(exact.diagnostics.fast).toEqual({ requested: false, defaultedFrom: "request", applied: { [option]: false }, assurance: "engine-reference" });
      // [request, requested, effective flag of the option]
      for (const [extra, requested, effective] of [[{ ...form.shorthand, fast: true }, true, true], [form.record(true), true, true], [form.record(false), false, false],
        [{ ...form.record(false), fast: true }, true, false], [{ ...form.record(true), fast: false }, true, true]] as [Options, boolean, boolean][]) {
        const result = await simulateCapture(request(extra)), ran = hasFast && effective;
        if (!ran) expect(samples(result), option).toEqual(samples(exact));
        expect(result.diagnostics.fast, option).toEqual({ requested, defaultedFrom: "request", applied: { [option]: ran }, assurance: ran ? "approximation-with-a-priori-bound" : "engine-reference" });
      }
    }
  }, scaledTimeout(300_000));

  it("reports every fast-capable option a request uses, in list order", async () => {
    // lens.catalogue cannot be combined with lens.diffraction (the lens's PSF includes diffraction): it is reported from its own request.
    const all = request({ lens: { diffraction: { kind: "circular-aperture", fast: true } }, sensor: { antiAliasing: { kind: "four-spot" }, pixelAperture: "box" },
      output: { demosaic: { kind: "ahd" } }, fast: true });
    const result = await simulateCapture(all);
    // motion.subject (#551) has its own cases above; it would multiply this request's scene queries by its temporal midpoints.
    expect(Object.keys(result.diagnostics.fast.applied)).toEqual(SIMULATE_CAPTURE_FAST_OPTIONS.filter((option) => option !== "lens.catalogue" && option !== "motion.subject"));
    expect(Object.values(result.diagnostics.fast.applied).every((value) => value === false)).toBe(true);
    // With anti-aliasing (off the site centres) the catalogue's fast method does not apply, so it reports false.
    // An 8 × 8 region at an 80 nm spectral step keeps the exact catalogue quadrature (every tap a scene query) affordable on CI runners.
    const catalogue = await simulateCapture(request({ lens: { catalogue: "pv-50-1.8", fNumber: 8 }, sensor: { pixelPitchMicrometers: 750, spectralStepNanometers: 80, antiAliasing: { kind: "four-spot" }, pixelAperture: "box" },
      output: { demosaic: { kind: "ahd" }, region: { x: 0, y: 0, width: 8, height: 8 } }, fast: true }));
    expect(Object.keys(catalogue.diagnostics.fast.applied)).toEqual(SIMULATE_CAPTURE_FAST_OPTIONS.filter((option) => option !== "lens.diffraction" && option !== "motion.subject"));
    expect(Object.values(catalogue.diagnostics.fast.applied).every((value) => value === false)).toBe(true);
  }, scaledTimeout(120_000));

  it("keeps lens.diffraction's aperture key as a deprecated alias of kind, and refuses both", async () => {
    const byKind = await simulateCapture(request({ lens: { diffraction: { kind: "circular-aperture", kernelRadiusSamples: 3 } } }));
    const byAlias = await simulateCapture(request({ lens: { diffraction: { aperture: "circular-aperture", kernelRadiusSamples: 3 } } }));
    expect(samples(byAlias)).toEqual(samples(byKind));
    await expect(simulateCapture(request({ lens: { diffraction: { kind: "circular-aperture", aperture: "circular-aperture" } } }))).rejects.toThrow("not both");
  }, scaledTimeout(120_000));

  it("refuses a fast value that is not a Boolean", async () => {
    await expect(simulateCapture(request({ fast: "yes" }))).rejects.toThrow("fast must be true or false");
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) {
      const record = FORMS[option].record(true);
      const [group, values] = Object.entries(record)[0] as [string, Record<string, Record<string, unknown>>];
      const [key, value] = Object.entries(values)[0]!;
      await expect(simulateCapture(request({ [group]: { [key]: { ...value, fast: 1 } } })), option).rejects.toThrow(".fast must be true or false");
    }
  });

  it("gives the display view the same report", async () => {
    const view = { width: 16, height: 12 };
    const exact = await simulateDisplayView(request(FORMS["lens.diffraction"].shorthand), view);
    const fast = await simulateDisplayView(request({ ...FORMS["lens.diffraction"].record(true) }), view);
    expect(samples(fast)).toEqual(samples(exact));
    // #481: a display view's report also carries `execution`, where the render ran; the CPU reference here (simulateDisplayView has no GPU option).
    const execution = { gpu: "off", backend: "cpu-reference", requestedBackend: "cpu-reference", fallbackReason: null, assurance: "engine-reference", fast: false };
    expect(exact.diagnostics.fast).toMatchObject({ requested: false, applied: { "lens.diffraction": false }, assurance: "engine-reference", execution });
    expect(fast.diagnostics.fast).toMatchObject({ requested: true, applied: { "lens.diffraction": false }, assurance: "engine-reference", execution });
    expect(Object.keys(exact.diagnostics.fast).sort()).toEqual(["applied", "assurance", "defaultedFrom", "execution", "requested"]);
  }, scaledTimeout(120_000));

  it("names every fast-capable option in docs/API_STYLE.md", () => {
    const style = readFileSync(new URL("../docs/API_STYLE.md", import.meta.url), "utf8");
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) expect(style, option).toContain("`" + option + "`");
  });

  it("uses the same word on the WebGPU execution record", () => {
    expect(cpuExecution("cpu-reference", null).fast).toBe(false);
    expect(webGpuExecution(null, 0).fast).toBe(true);
  });
});
