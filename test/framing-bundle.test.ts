// SPDX-License-Identifier: Apache-2.0
/**
 * #646 (2.26.0): the thin-lens framing helpers bundle without the lens catalogue or the sensor profiles. In 2.25.0
 * `subject-framing.ts` imported both statically, and through the profile parser the generic tier assets, so a bundle of
 * `calculateSubjectDistanceForFraming` alone took 32 modules and about 25.7 KB gzip. The thin-lens functions now live in a module
 * that imports neither; the full functions still take `catalogue` and `sensorProfile`, without the tier assets.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rolldown } from "rolldown";
import { calculateChartFraming, calculateSubjectDistanceForFraming, calculateThinLensChartFraming, calculateThinLensSubjectDistanceForFraming, InvalidConfigurationError,
  SENSOR_PROFILES } from "../src/index.js";
import { scaledTimeout as testTimeout } from "./helpers/test-timeout.js";

/** The modules (paths below src/) and gzip size (level 9) of a minified, tree-shaken consumer of the named root exports. */
async function bundle(names: string[]): Promise<{ modules: string[]; gzip: number }> {
  const dir = mkdtempSync(join(tmpdir(), "photivra-framing-"));
  try {
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import { ${names.join(", ")} } from ${JSON.stringify(resolve("src/index.ts"))};\nglobalThis.keep = [${names.join(", ")}];\n`);
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
const CATALOGUE_OR_PROFILE = /equipment\/(generic-lens-catalogue|generic-lens-framing|sensor-profile[\w-]*|sensor-profiles|generic-tier-assets)\.ts$/u;
const TIER_ASSETS = /equipment\/generic-tier-assets\.ts$|sensor\/raw-readout\.ts$/u;

describe("framing bundles (#646)", () => {
  it("leave the catalogue and the sensor profiles out of a thin-lens-only entry", async () => {
    const thin = await bundle(["calculateThinLensSubjectDistanceForFraming", "calculateThinLensChartFraming"]);
    expect(thin.modules.filter((id) => CATALOGUE_OR_PROFILE.test(id))).toEqual([]);
    expect(thin.modules).toContain("facade/subject-framing-thin-lens.ts");
    // Measured 5,752 B on 2.26.0's tree (rolldown, Node.js zlib level 9); 2.25.0's framing entry was 25,720 B.
    expect(thin.gzip).toBeLessThanOrEqual(6_500);
  }, testTimeout(120_000));

  it("keep the full framing functions free of the tier assets and the RAW readout", async () => {
    const full = await bundle(["calculateSubjectDistanceForFraming", "calculateChartFraming"]);
    expect(full.modules.filter((id) => TIER_ASSETS.test(id))).toEqual([]);
    // Measured 12,537 B (the catalogue and the profile parser; 25,720 B in 2.25.0).
    expect(full.gzip).toBeLessThanOrEqual(13_500);
  }, testTimeout(120_000));
});

describe("thin-lens framing functions (#646)", () => {
  const sensor = { widthMm: 36, heightMm: 24 }, chart = { widthM: 0.4 };
  it("return exactly what the full functions return for a thin lens", () => {
    for (const lens of [{ focalLengthMm: 50 }, { equivalentFocalLengthMm: 35 }, { focalLengthMm: 105 }]) {
      for (const fit of [undefined, "contain", "width", "height", "cover"] as const) {
        const input = { sensor, ...lens, chart, ...(fit ? { fit } : {}) };
        expect(calculateThinLensSubjectDistanceForFraming(input)).toEqual(calculateSubjectDistanceForFraming(input));
      }
      for (const extra of [{ subjectDistanceM: 2 }, { subjectDistanceM: 1.2, focusDistanceM: 1.5 }]) {
        const input = { sensor, ...lens, chart: { widthM: 0.3, heightM: 0.2 }, ...extra };
        expect(calculateThinLensChartFraming(input)).toEqual(calculateChartFraming(input));
      }
    }
  });

  it("refuse the catalogue and the sensor profile; the full functions still take them", () => {
    expect(() => calculateThinLensSubjectDistanceForFraming({ sensor, chart, catalogue: "pv-15-2.8-fisheye-pro" } as never)).toThrow(InvalidConfigurationError);
    expect(() => calculateThinLensChartFraming({ sensorProfile: { profile: SENSOR_PROFILES[0]!, width: 60, height: 40 }, focalLengthMm: 50, chart, subjectDistanceM: 2 } as never))
      .toThrow(/unknown field "sensorProfile"/);
    expect(() => calculateThinLensSubjectDistanceForFraming({ sensor, chart } as never)).toThrow(/exactly one of focalLengthMm and equivalentFocalLengthMm/);
    expect(calculateSubjectDistanceForFraming({ sensor, catalogue: "pv-15-2.8-fisheye-pro", chart }).lens?.lensId).toBeDefined();
    expect(calculateChartFraming({ sensorProfile: { profile: SENSOR_PROFILES[0]!, width: 60, height: 40 }, focalLengthMm: 50, chart, subjectDistanceM: 2 }).assumptions
      .some((a) => a.id === "sensor.profileView")).toBe(true);
  });
});
