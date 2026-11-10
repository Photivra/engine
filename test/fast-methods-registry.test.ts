// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIMULATE_CAPTURE_FAST_OPTIONS, prepareDisplayView, simulateCapture, simulateDisplayView, type SimulateCaptureOptions } from "../src/index.js";
import { FAST_METHODS } from "../src/facade/fast-methods.js";
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
    const overrides = new Set(FAST_METHODS.map((e) => e.override));
    const accepting = new Set<string>();
    for (const file of facade) for (const m of source(file).matchAll(/allowKeys\([^,]+,\s*"([^"]+)",\s*\[[^\]]*"fast"/gu)) accepting.add(m[1] === "simulateCapture options" ? "fast" : m[1]!);
    for (const m of source("src/facade/simulate-capture.ts").matchAll(/fastOverride\([^,]+,\s*"([^"]+)"\)/gu)) accepting.add(m[1]!);
    expect(accepting.size).toBeGreaterThan(4);
    for (const path of accepting) expect(overrides, path + " accepts fast without a registry entry").toContain(path);
    const applied = new Set(FAST_METHODS.map((e) => e.report.applied).filter((a) => a !== undefined));
    for (const option of SIMULATE_CAPTURE_FAST_OPTIONS) expect(applied, option).toContain(option);
  });

  it("gives every entry a resolver found in its source, a report, and the format default", () => {
    expect(new Set(FAST_METHODS.map((e) => e.id)).size).toBe(FAST_METHODS.length);
    for (const entry of FAST_METHODS) {
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
});
