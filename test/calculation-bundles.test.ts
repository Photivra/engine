// SPDX-License-Identifier: Apache-2.0
/**
 * #765 (2.29.0): the pure calculations `calculateProgramLine` and the ideal-lens detail limit bundle without the code their
 * results do not need. Measured on 2.28.0's tree (e229-int at 783f38f; rolldown 1.2.14, minified ESM, Node.js zlib level 9):
 * `calculateProgramLine` alone 24,838 B (it imported the whole tier assets, and through them the RAW readout, ISO gain,
 * stabilization and other profiles), `calculateDetailLimit` alone 10,200 B (the lens catalogue for its catalogue branch), and
 * `calculateDepthOfField` 2,282 B for comparison. The program line now reads the tiers' exposure side only
 * (equipment/generic-tier-exposure.ts, built by the same functions as the tier assets' exposure side; sharing the objects
 * themselves measured +290 B on the capture worker's fast row); `calculateIdealLensDetailLimit` is the
 * ideal-lens branch in a module without the catalogue. Each limit is its row's measurement rounded up to the next 100 B.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { createHash } from "node:crypto";
import { calculateDetailLimit, calculateProgramLine, InvalidConfigurationError } from "../src/index.js";
import { calculateIdealLensDetailLimit } from "../src/optics/detail-limit-ideal.js";
import { genericTierExposure } from "../src/equipment/generic-tier-exposure.js";
import { GENERIC_TIER_ASSETS, genericTierAssets } from "../src/equipment/generic-tier-assets.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** The modules (paths below src/) and gzip size (level 9) of a minified, tree-shaken consumer of the named exports of `from` (below src/). */
async function bundle(names: string[], from = "index.ts"): Promise<{ modules: string[]; gzip: number }> {
  const dir = mkdtempSync(join(tmpdir(), "photivra-calculation-"));
  try {
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import { ${names.join(", ")} } from ${JSON.stringify(resolve("src", from))};\nglobalThis.keep = [${names.join(", ")}];\n`);
    const build = await rolldown({ input: entry, logLevel: "silent", resolve: { extensionAlias: { ".js": [".ts", ".js"] } } });
    const { output } = await build.generate({ format: "esm", minify: true });
    await build.close();
    const chunks = output.filter((c) => c.type === "chunk");
    return { modules: chunks.flatMap((c) => Object.keys(c.modules).map((id) => id.replace(/\\/g, "/").replace(/^.*\/src\//, ""))),
      gzip: chunks.reduce((sum, c) => sum + gzipSync(c.code, { level: 9 }).length, 0) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Modules a pure calculation must not carry: the tier assets and their RAW readout, ISO gain and stabilization, and the lens catalogue. */
const HEAVY = /(?:equipment\/generic-tier-assets|sensor\/raw-readout|sensor\/iso-gain|stabilization\/system|equipment\/generic-lens-catalogue)\.ts$/u;

describe("calculation bundles (#765)", () => {
  it("calculateProgramLine leaves out the tier assets, the RAW readout and stabilization", async () => {
    const line = await bundle(["calculateProgramLine"]);
    expect(line.modules.filter((id) => HEAVY.test(id))).toEqual([]);
    expect(line.modules).toContain("equipment/generic-tier-exposure.ts");
    // Measured 14,508 B (24,838 B on 2.28.0); 14,500 B once standardExposureLuminance took portableExp2 (2.29.0).
    expect(line.gzip).toBeLessThanOrEqual(14_600);
  }, testTimeout(120_000));

  it("calculateIdealLensDetailLimit leaves out the lens catalogue", async () => {
    const ideal = await bundle(["calculateIdealLensDetailLimit"], "optics/detail-limit-ideal.ts");
    expect(ideal.modules.filter((id) => HEAVY.test(id))).toEqual([]);
    // Measured 4,954 B (calculateDetailLimit, with the catalogue: 10,200 B on 2.28.0).
    expect(ideal.gzip).toBeLessThanOrEqual(5_000);
  }, testTimeout(120_000));

  it("calculateDetailLimit keeps the catalogue for its catalogue branch", async () => {
    const full = await bundle(["calculateDetailLimit"]);
    expect(full.modules).toContain("equipment/generic-lens-catalogue.ts");
    // Measured 10,299 B (10,200 B on 2.28.0: the shared code is now called across two modules).
    expect(full.gzip).toBeLessThanOrEqual(10_300);
  }, testTimeout(120_000));
});

describe("the moves change no result (#765)", () => {
  it("the tier assets' exposure side equals the exposure module's", () => {
    for (const version of ["2.0.0", "2.1.0"] as const) {
      const assets = genericTierAssets(version), exposure = genericTierExposure(version);
      expect(assets.map((p) => p.tier)).toEqual(exposure.map((e) => e.tier));
      assets.forEach((preset, i) => {
        expect(preset.body.exposure).toEqual(exposure[i]!.body.exposure);
        expect(preset.body.metering).toEqual(exposure[i]!.body.metering);
        expect(preset.lens.exposure).toEqual(exposure[i]!.lens.exposure);
        expect(Object.isFrozen(exposure[i]!.body.metering[0]!.profile)).toBe(true);
      });
    }
    expect(GENERIC_TIER_ASSETS).toBe(genericTierAssets("2.1.0"));
    // The presets of both versions, serialized, as recorded on 2.28.0 (783f38f) before the move.
    const tiers = JSON.stringify([GENERIC_TIER_ASSETS, genericTierAssets("2.0.0")]);
    expect(createHash("sha256").update(tiers).digest("hex").slice(0, 16) + ":" + tiers.length).toBe("af40b2aa4dd0d713:526943");
  });

  it("calculateIdealLensDetailLimit returns calculateDetailLimit's result for an ideal lens", () => {
    const sensor = { widthMm: 36, heightMm: 24, pixelWidth: 6000 };
    for (const fNumber of [1.4, 4, 11, 22]) {
      for (const extra of [{}, { focus: { focusDistanceM: 2, subjectDistanceM: 2.2 } }, { wavelengthNm: 450, fieldPosition: 0.7 },
        { sensor: { ...sensor, colorFilterArray: "none" as const } }]) {
        const input = { sensor, lens: { kind: "ideal" as const, focalLengthMm: 50 }, fNumber, ...extra };
        expect(calculateIdealLensDetailLimit(input)).toEqual(calculateDetailLimit(input));
      }
    }
  });

  it("calculateIdealLensDetailLimit refuses a catalogue lens and checks its input as calculateDetailLimit does", () => {
    const sensor = { widthMm: 36, heightMm: 24, pixelWidth: 6000 };
    expect(() => calculateIdealLensDetailLimit({ sensor, lens: { kind: "catalogue", lensId: "pv-50-1.8" } as never, fNumber: 4 })).toThrow(InvalidConfigurationError);
    expect(() => calculateIdealLensDetailLimit({ sensor, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 4, extra: 1 } as never))
      .toThrow(/calculateIdealLensDetailLimit/u);
    for (const bad of [{ fNumber: 0 }, { wavelengthNm: 300 }, { fieldPosition: 2 }, { lens: { kind: "ideal", focalLengthMm: -1 } }]) {
      const input = { sensor, lens: { kind: "ideal", focalLengthMm: 50 }, fNumber: 4, ...bad } as never;
      let expected = "";
      try { calculateDetailLimit(input); } catch (error) { expected = (error as Error).message; }
      expect(expected).not.toBe("");
      expect(() => calculateIdealLensDetailLimit(input)).toThrow(expected);
    }
  });

  it("calculateProgramLine is unchanged for every tier", () => {
    // 135 results (tiers × ISO × lens ranges × scene brightness), serialized; recorded on 2.28.0 (783f38f) before the move, then
    // re-recorded in 2.29.0 when standardExposureLuminance took portableExp2 (the same on Node 22, 24 and 26): the 27 results with
    // ev100 11.5 move on Node 24 and 26, their selection's luminanceCdPerSquareMeter by 1 ulp and its standardExposureDeviationStops
    // (a rounding residual near 1e-14) with it; the move itself (#765) changed no result.
    const out: unknown[] = [];
    for (const camera of ["consumer", "prosumer", "professional"] as const) for (const iso of [100, 200, 1600]) {
      for (const lens of [undefined, { widestFNumber: 2.8, narrowestFNumber: 22 }, { widestFNumber: 5.6, narrowestFNumber: 8 }]) {
        for (const brightness of [{}, { ev100: -3 }, { ev100: 11.5 }, { ev100: 20 }, { luminanceCdPerSquareMeter: 400 }]) {
          out.push(calculateProgramLine({ camera, iso, ...(lens ? { lens } : {}), ...brightness }));
        }
      }
    }
    expect(createHash("sha256").update(JSON.stringify(out)).digest("hex").slice(0, 16) + ":" + out.length).toBe("df106070b8804e94:135");
  });
});
