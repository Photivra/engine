// SPDX-License-Identifier: Apache-2.0
/**
 * #536: the build strips comments and indentation from the `/* wgsl *\/` shader literals (scripts/lib/wgsl-minify.mjs), and
 * since 2.29.0 (#658) the blankspace inside a line that cannot separate two tokens; the tests run that shipped text
 * (vitest.config.ts). These tests show it is safe by construction:
 * - every literal of src/ is minified, keeps its line count and keeps its WGSL tokens, read by a lexer written here;
 * - every text anchor the engine uses to edit its own shader text matches the minified text exactly as often as the source;
 * - the shader modules the tests import are the minified ones;
 * - the edge cases (interpolations, nested block comments, escapes) are kept or minified as documented.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { minifyWgslTemplates } from "../scripts/lib/wgsl-minify.mjs";
import { CHART_MATERIAL_WGSL, CHART_RADIANCE_WGSL } from "../src/gpu/wgsl-chart-kernel.js";
import { SDR_WGSL } from "../src/gpu/wgsl-kernels.js";

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
const files = walk("src").map((path) => ({ path, source: readFileSync(path, "utf8") })).filter((f) => f.source.includes("/* wgsl */"));

/**
 * WGSL tokens, written independently of the minifier's `wgslTokens`: comments (block comments nest) are blankspace (WGSL §3);
 * a token is an identifier, a number (digits, letters and the point, with a sign only right after the exponent letter), the
 * longest of WGSL's multi-character syntactic tokens (WGSL §3.5) at that position, or one other character.
 * Since #658 the minifier removes blankspace between tokens, so splitting on blankspace alone would no longer compare tokens.
 */
const OPERATORS = new Set(["&&", "||", "->", "<=", ">=", "==", "!=", "<<", ">>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
function tokens(text: string): string[] {
  let blank = "", depth = 0;
  for (let i = 0; i < text.length;) {
    if (depth > 0) {
      if (text.startsWith("/*", i)) { depth++; i += 2; } else if (text.startsWith("*/", i)) { depth--; i += 2; blank += " "; } else i++;
    } else if (text.startsWith("//", i)) { while (i < text.length && text[i] !== "\n") i++; }
    else if (text.startsWith("/*", i)) { depth = 1; i += 2; }
    else { blank += text[i]; i++; }
  }
  const out: string[] = [];
  for (let i = 0; i < blank.length;) {
    const c = blank[i]!, next = blank[i + 1] ?? "";
    if (/\s/u.test(c)) { i++; continue; }
    let j = i + 1;
    if (/[A-Za-z_]/u.test(c)) {
      while (j < blank.length && /\w/u.test(blank[j]!)) j++;
    } else if (/\d/u.test(c) || (c === "." && /\d/u.test(next))) {
      // A number: digits, letters (hex digits, exponent letters, suffixes) and the point; a sign only after the exponent letter.
      const exponent = /^0[xX]/u.test(c + next) ? /[pP]/u : /[eE]/u;
      while (j < blank.length && (/[\w.]/u.test(blank[j]!) || (/[+-]/u.test(blank[j]!) && exponent.test(blank[j - 1]!)))) j++;
    } else {
      while (j < blank.length && OPERATORS.has(blank.slice(i, j + 1))) j++;
    }
    out.push(blank.slice(i, j));
    i = j;
  }
  return out;
}
const countOf = (text: string, anchor: string | RegExp): number =>
  typeof anchor === "string" ? text.split(anchor).length - 1 : (text.match(new RegExp(anchor.source, anchor.flags.includes("g") ? anchor.flags : anchor.flags + "g")) ?? []).length;

describe("WGSL minification (#536)", () => {
  // 2.22.0: WGSL reserves many words (WGSL §15.3, "Reserved Words"); Chrome 153 rejects a module that declares one (#597's
  // image-plane light shader named a local `common`, which only the hardware run caught). Declarations in every literal are checked.
  it("declares no WGSL reserved word", () => {
    const reserved = new Set(("NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch class co_await co_return co_yield " +
      "coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do " +
      "dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import " +
      "inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation " +
      "non_coherent noncoherent noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected " +
      "pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared signed sizeof smooth snorm static static_assert static_cast " +
      "std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying " +
      "virtual volatile wgsl where with writeonly yield").split(" "));
    const declared: string[] = [];
    for (const { path, source } of files) for (const literal of minifyWgslTemplates(source).literals) {
      for (const m of literal.original.matchAll(/\b(?:let|var|const|fn|struct|alias)\s+([A-Za-z_]\w*)|[(,]\s*([A-Za-z_]\w*)\s*:/gu)) {
        const name = m[1] ?? m[2]!;
        if (reserved.has(name)) declared.push(path + ": " + name);
      }
    }
    expect(declared).toEqual([]);
  });

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
    // 2.21.0: + the display view's integer sum (src/gpu/wgsl-exact-sum.ts) and #581's two (the image-plane module and the scene-value adapter).
    // 2.22.0: + #597's mixed light in the image-plane Quality pass, and #593/#601's coupled steps (their shared declarations, the
    // stub and the on-demand module; the Quality pixel pass is now its body plus one of them, so it stays one literal).
    // 2.23.0: + #605's neighbor reconstruction (the kernels' stub, and the on-demand module's shared, off and full forms).
    // 2.28.0: + #658's six helper literals the Speed and Quality kernels share (src/gpu/wgsl-display-view-speed-kernel.ts), and #661's
    // catalogue-lens passes (the lens lattice, the pre-integrated points and the sites).
    // + #716's bilinear axis that the image-plane Speed module and Quality lattice pass share (src/gpu/display-view-image-quality.ts).
    // 2.29.0 (#658): + the chart kernel's material part and the composite kernel's material part and two common parts, the seams
    // the display view's material modules take instead of searching the kernels' text. + the six untagged shader literals of the
    // display view's material modules and the image-plane Quality lattice pass (chart preset, composite: lattice bindings, lattice
    // point and module; image plane: material module and lattice pass).
    expect(literals).toBe(52);
    // #658: 2.28.0's minifier (comments and indentation) measured after < 0.86 · before.
    expect(after).toBeLessThan(0.78 * before);
  });

  it("keeps every anchor the engine edits its shader text with", () => {
    // [file that defines the shader text, anchor, where the engine uses it]. Since #658 the material modules take their parts of
    // the chart kernels as seams (CHART_MATERIAL_WGSL, CHART_COMPOSITE_MATERIAL_WGSL, chartCompositeModuleCommonWgsl) instead of
    // searching their text, so only these word-anchored renames are left.
    const anchors: [string, string | RegExp][] = [
      ["src/gpu/wgsl-chart-kernel.ts", /\bparams\./gu], // display-view-chart-material-module.ts
      ["src/gpu/wgsl-chart-kernel.ts", /\baux\[/gu],
      ["src/gpu/wgsl-chart-kernel.ts", /\bflagged\b/gu],
      ["src/gpu/wgsl-chart-kernel.ts", "fn material("],
      ["src/gpu/wgsl-chart-composite-kernel.ts", /\bflagged\b/gu], // display-view-composite-material-module.ts
      ["src/gpu/wgsl-chart-composite-kernel.ts", /\bmargin\(/gu],
      ["src/gpu/wgsl-chart-composite-kernel.ts", "d_mul_PRODUCT_PATH"], // wgsl-chart-composite-kernel.ts, productPath
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
    const literals = minifyWgslTemplates(readFileSync("src/gpu/wgsl-chart-kernel.ts", "utf8")).literals;
    // The material part has no interpolation, so the imported text is its minified literal exactly.
    expect(CHART_MATERIAL_WGSL).toBe(literals[0]!.minified);
    expect(CHART_MATERIAL_WGSL).toContain("var<private>flagged:bool;");
    expect(CHART_RADIANCE_WGSL.split("\n").length).toBe(literals[1]!.original.split("\n").length + CHART_MATERIAL_WGSL.split("\n").length - 1);
    // No line keeps its indentation: since 2.29.0 (#658) the lines that hold an interpolation are tightened too, here the kernel's
    // two that use CHART_WORKGROUP_SIZE, with one space kept next to the interpolation.
    expect(CHART_RADIANCE_WGSL.split("\n").filter((line) => /^[ \t]+\S/u.test(line))).toEqual([]);
    expect(CHART_RADIANCE_WGSL).toContain("\nlet i=gid.x+gid.y*groups.x* 256u;\n");
    expect(CHART_RADIANCE_WGSL).not.toMatch(/\/\//u);
    expect(SDR_WGSL).not.toMatch(/^\s*\/\//mu);
  });

  it("handles interpolations, nested block comments and escapes as documented", () => {
    const one = (body: string): { minified: string; kept: boolean } => minifyWgslTemplates("const s = /* wgsl */ `" + body + "`;").literals[0]!;
    expect(one("\n  // comment\n  let a = 1; // tail\n  /* x /* nested */ still */ let b = 2;\n").minified).toBe("\n\nlet a=1;\nlet b=2;\n");
    // #658: blankspace next to an identifier or number and punctuation, or next to a bracket, comma or semicolon, goes; a space
    // between two other punctuation characters stays, so no operator or comment opener forms.
    expect(one("\n  fn f(a: vec2<f32>, b: f32) -> f32 {\n  let x = a.x - -b * 1.5e-3 / *p;\n  if (x >= 0.0 && y < z) { return x > = y; }\n").minified)
      .toBe("\nfn f(a:vec2<f32>,b:f32)->f32{\nlet x=a.x- -b*1.5e-3/ *p;\nif(x>=0.0&&y<z){return x> =y;}\n");
    expect(one("\n  @group(0) @binding(1) var<storage, read> t: array<f32>;\n  let m = a & &b;\n").minified).toBe("\n@group(0)@binding(1)var<storage,read>t:array<f32>;\nlet m=a& &b;\n");
    // A line with an interpolation and a comment stays as written, comment included.
    expect(one("\n  let a = ${x}; // keeps\n  let b = 2;\n").minified).toBe("\n  let a = ${x}; // keeps\nlet b=2;\n");
    expect(one("\n  let a = ${x}; /* keeps */\n  let b = 2;\n").kept).toBe(true);
    // #658: any other interpolation line is tightened between its interpolations; blankspace next to an interpolation stays one space.
    expect(one("\n    let a = f(${x}u + i, ${y}) * -${z};\n  ${w}  \n  fn g(i: u32) -> f32 { return k[${n}u  +  i]; }\n").minified)
      .toBe("\nlet a=f(${x}u+i, ${y})* -${z};\n${w}\nfn g(i:u32)->f32{return k[${n}u+i];}\n");
    expect(one("\n  a ${x}  ${y} b\n  c\n").minified).toBe("\na ${x} ${y} b\nc\n");
    // A block comment open across an interpolation line: the literal is kept whole.
    expect(one("\n  /* open\n  ${x}\n  */\n").kept).toBe(true);
    // An escaped backtick inside a removed comment goes with the comment; one in code keeps the literal whole.
    expect(one("\n  // a \\`quote\\`\n  let a = 1;\n").minified).toBe("\n\nlet a=1;\n");
    expect(one("\n  let a = \\`b\\`;\n  x;\n").kept).toBe(true);
    // Nested templates in an interpolation are copied unchanged, and the parser finds the right end.
    const nested = minifyWgslTemplates("const s = /* wgsl */ `\n  a\n  ${f(`\n  inner // not wgsl\n`, \"}\")}\n  b\n`; const t = 1;");
    expect(nested.code).toBe("const s = /* wgsl */ `\na\n${f(`\n  inner // not wgsl\n`, \"}\")}\nb\n`; const t = 1;");
    // Untagged templates are not touched.
    expect(minifyWgslTemplates("const s = `\n  // x\n`;").code).toBe("const s = `\n  // x\n`;");
  });
});
