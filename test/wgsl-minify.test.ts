// SPDX-License-Identifier: Apache-2.0
/**
 * #536: the build strips comments and indentation from the `/* wgsl *\/` shader literals (scripts/lib/wgsl-minify.mjs),
 * and the tests run that shipped text (vitest.config.ts). These tests show it is safe by construction:
 * - every literal of src/ is minified, keeps its line count and keeps its WGSL tokens, counted by a tokenizer written here;
 * - every text anchor the engine uses to edit its own shader text matches the minified text exactly as often as the source;
 * - the shader modules the tests import are the minified ones;
 * - the edge cases (interpolations, nested block comments, escapes) are kept or minified as documented.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { minifyWgslTemplates } from "../scripts/lib/wgsl-minify.mjs";
import { CHART_RADIANCE_WGSL } from "../src/gpu/wgsl-chart-kernel.js";
import { SDR_WGSL } from "../src/gpu/wgsl-kernels.js";

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
const files = walk("src").map((path) => ({ path, source: readFileSync(path, "utf8") })).filter((f) => f.source.includes("/* wgsl */"));

/** WGSL tokens, written independently of the minifier: comments (block comments nest) are blankspace (WGSL §3). */
function tokens(text: string): string[] {
  let out = "", depth = 0;
  for (let i = 0; i < text.length;) {
    if (depth > 0) {
      if (text.startsWith("/*", i)) { depth++; i += 2; } else if (text.startsWith("*/", i)) { depth--; i += 2; out += " "; } else i++;
    } else if (text.startsWith("//", i)) { while (i < text.length && text[i] !== "\n") i++; }
    else if (text.startsWith("/*", i)) { depth = 1; i += 2; }
    else { out += text[i]; i++; }
  }
  return out.split(/\s+/u).filter(Boolean);
}
const countOf = (text: string, anchor: string | RegExp): number =>
  typeof anchor === "string" ? text.split(anchor).length - 1 : (text.match(new RegExp(anchor.source, anchor.flags.includes("g") ? anchor.flags : anchor.flags + "g")) ?? []).length;

describe("WGSL minification (#536)", () => {
  it("minifies every tagged literal of src/, keeping its lines and its WGSL tokens", () => {
    let literals = 0, before = 0, after = 0;
    for (const { path, source } of files) {
      const result = minifyWgslTemplates(source);
      expect(result.literals.length, path).toBe(source.split("/* wgsl */").length - 1);
      for (const literal of result.literals) {
        literals++;
        expect(literal.kept, path + " @" + literal.offset).toBe(false);
        expect(literal.minified.split("\n").length).toBe(literal.original.split("\n").length);
        expect(tokens(literal.minified)).toEqual(tokens(literal.original));
        before += literal.original.length;
        after += literal.minified.length;
      }
      expect(result.code.split("\n").length, path).toBe(source.split("\n").length);
      // The code outside the literals is unchanged.
      expect(minifyWgslTemplates(result.code).code).toBe(result.code);
    }
    // 2.21.0: + the display view's integer sum (src/gpu/wgsl-exact-sum.ts).
    expect(literals).toBe(22);
    expect(after).toBeLessThan(0.86 * before);
  });

  it("keeps every anchor the engine edits its shader text with", () => {
    // [file that defines the shader text, anchor, where the engine uses it]
    const anchors: [string, string | RegExp][] = [
      ["src/gpu/wgsl-chart-kernel.ts", "var<private> flagged: bool;"], // display-view-chart-material-module.ts:24
      ["src/gpu/wgsl-chart-kernel.ts", "@compute"],
      ["src/gpu/wgsl-chart-kernel.ts", "fn material("], // :27
      ["src/gpu/wgsl-chart-kernel.ts", /\bparams\./gu],
      ["src/gpu/wgsl-chart-kernel.ts", /\baux\[/gu],
      ["src/gpu/wgsl-chart-composite-kernel.ts", "const DW: f32"], // display-view-composite-material-module.ts:73
      ["src/gpu/wgsl-chart-composite-kernel.ts", "struct Params"],
      ["src/gpu/wgsl-chart-composite-kernel.ts", "const SEGMENT_BOX"],
      ["src/gpu/wgsl-chart-composite-kernel.ts", "@compute"],
      ["src/gpu/wgsl-chart-composite-kernel.ts", /^const SLACK: f32 = [^\n]*\n/mu], // :75
      ["src/gpu/wgsl-chart-composite-kernel.ts", /\bmargin\(/gu],
      ["src/gpu/wgsl-chart-composite-kernel.ts", /\bparams\.zero\b/gu],
      ["src/gpu/wgsl-chart-composite-kernel.ts", "d_mul_PRODUCT_PATH"], // wgsl-chart-composite-kernel.ts:176
      ["src/gpu/wgsl-chart-composite-kernel.ts", "BARRIER_ZERO"]
    ];
    for (const [path, anchor] of anchors) {
      const { literals } = minifyWgslTemplates(readFileSync(path, "utf8"));
      const original = literals.map((l) => l.original).join("\n"), minified = literals.map((l) => l.minified).join("\n");
      // Counted in code only: a renaming regex also matched words inside comments, which are now gone.
      const inCode = (text: string): string => minifyWgslTemplates("/* wgsl */ `\n" + text + "\n`").literals[0]!.minified;
      expect(countOf(inCode(original), anchor), path + " " + String(anchor)).toBeGreaterThan(0);
      expect(countOf(minified, anchor), path + " " + String(anchor)).toBe(countOf(inCode(original), anchor));
      if (typeof anchor === "string") expect(countOf(minified, anchor)).toBe(countOf(original.replace(/\/\/[^\n]*/gu, ""), anchor));
    }
  });

  it.skipIf(process.env.PHOTIVRA_WGSL_MINIFY === "0")("the shader modules the tests import are the minified text", () => {
    const source = minifyWgslTemplates(readFileSync("src/gpu/wgsl-chart-kernel.ts", "utf8")).literals[0]!;
    expect(CHART_RADIANCE_WGSL.split("\n").length).toBe(source.original.split("\n").length);
    // Only lines that hold an interpolation keep their indentation.
    const indented = CHART_RADIANCE_WGSL.split("\n").filter((line) => /^[ \t]+\S/u.test(line)).length;
    expect(indented).toBe(source.original.split("\n").filter((line) => line.includes("${") && /^[ \t]+\S/u.test(line)).length);
    expect(CHART_RADIANCE_WGSL).not.toMatch(/\/\//u);
    expect(SDR_WGSL).not.toMatch(/^\s*\/\//mu);
  });

  it("handles interpolations, nested block comments and escapes as documented", () => {
    const one = (body: string): { minified: string; kept: boolean } => minifyWgslTemplates("const s = /* wgsl */ `" + body + "`;").literals[0]!;
    expect(one("\n  // comment\n  let a = 1; // tail\n  /* x /* nested */ still */ let b = 2;\n").minified).toBe("\n\nlet a = 1;\nlet b = 2;\n");
    // A line with an interpolation stays as written, comment included.
    expect(one("\n  let a = ${x}; // keeps\n  let b = 2;\n").minified).toBe("\n  let a = ${x}; // keeps\nlet b = 2;\n");
    // A block comment open across an interpolation line: the literal is kept whole.
    expect(one("\n  /* open\n  ${x}\n  */\n").kept).toBe(true);
    // An escaped backtick inside a removed comment goes with the comment; one in code keeps the literal whole.
    expect(one("\n  // a \\`quote\\`\n  let a = 1;\n").minified).toBe("\n\nlet a = 1;\n");
    expect(one("\n  let a = \\`b\\`;\n  x;\n").kept).toBe(true);
    // Nested templates in an interpolation are copied unchanged, and the parser finds the right end.
    const nested = minifyWgslTemplates("const s = /* wgsl */ `\n  a\n  ${f(`\n  inner // not wgsl\n`, \"}\")}\n  b\n`; const t = 1;");
    expect(nested.code).toBe("const s = /* wgsl */ `\na\n  ${f(`\n  inner // not wgsl\n`, \"}\")}\nb\n`; const t = 1;");
    // Untagged templates are not touched.
    expect(minifyWgslTemplates("const s = `\n  // x\n`;").code).toBe("const s = `\n  // x\n`;");
  });
});
