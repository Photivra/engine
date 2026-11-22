// SPDX-License-Identifier: Apache-2.0
/*
 * #659: WebAssembly stays limited to the opt-in JPEG XL decoder. The engine never imports, fetches, compiles or
 * instantiates WebAssembly; an application that opens JPEG XL-compressed DNGs loads a decoder itself and passes it in
 * (`createJxlOxideDngDecoder`). The scanner is scripts/lib/webassembly-boundary.mjs; `npm run check:browser-surface` runs
 * it on every file under src/, and this test proves it can fail and that the tree holds the limit.
 *
 * Not covered, by design: a caller's module passed in at run time (the permitted path), and code that builds the
 * global's name from pieces (`globalThis["Web" + "Assembly"]`), which no static check can read.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSpecifiers } from "../scripts/lib/browser-surface.mjs";
import { WEBASSEMBLY_MENTION_ALLOWLIST, findWebAssemblyUse, mentionsWebAssembly } from "../scripts/lib/webassembly-boundary.mjs";

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter(Boolean);

describe("WebAssembly boundary (#659)", () => {
  it("the scanner catches what it must and nothing else", () => {
    const mustHit = [
      'import init from "jxl-oxide-wasm";',
      'const jxl = await import("jxl-oxide-wasm");',
      "const jxl = await import(`jxl-oxide-wasm`);",
      'export * from "jxl-oxide-wasm";',
      'import "./decoder.wasm";',
      'const jxl = require("jxl-oxide-wasm");',
      "await WebAssembly.instantiate(bytes);",
      "const w = globalThis.WebAssembly;",
      'const w = globalThis["WebAssembly"];',
      'const url = new URL("./jxl_bg.wasm", import.meta.url);',
      'await fetch("/assets/decoder.wasm");',
      "const url = `${base}/decoder.wasm`;",
      'const type = "application/wasm";',
      "const t = `${typeof WebAssembly}`;",
      "const t = `a${b}c${WebAssembly.Module}d`;"
    ];
    for (const snippet of mustHit) expect(findWebAssemblyUse(snippet), snippet).not.toEqual([]);
    const mustPass = [
      "// WebAssembly in a line comment",
      "/** Adapts the jxl-oxide WebAssembly package (`.wasm`), loaded by the caller. */\nexport const x = 1;",
      'throw new Error("createJxlOxideDngDecoder: module must be the initialized jxl-oxide-wasm module.");',
      'import { a } from "./a.js";\nconst b = await import("./b.js");',
      'type Kit = typeof import("./quality-kit.js");',
      'const word = "wasm";',
      "const re = /[\"'`]WebAssembly/u.source.length;"
    ];
    for (const snippet of mustPass) expect(findWebAssemblyUse(snippet), snippet).toEqual([]);
    expect(findWebAssemblyUse('import "node:http";', { allowNodeBuiltins: true })).toEqual([]);
    expect(findWebAssemblyUse('import "node:http";')).not.toEqual([]);
    expect(findWebAssemblyUse("const a = 1;\nawait WebAssembly.compile(b);")).toEqual(["line 2: identifier WebAssembly"]);
  });

  it("no engine module imports or instantiates WebAssembly", () => {
    const sources = tracked.filter((file) => file.startsWith("src/") && file.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(300);
    const failures = sources.flatMap((file) =>
      findWebAssemblyUse(readFileSync(file, "utf8"), { allowNodeBuiltins: file.startsWith("src/api/") }).map((hit) => `${file} ${hit}`)
    );
    expect(failures).toEqual([]);
    const mentions = sources.filter((file) => mentionsWebAssembly(readFileSync(file, "utf8"))).map((file) => file.slice(4));
    expect(mentions).toEqual(WEBASSEMBLY_MENTION_ALLOWLIST);
  });

  it("the repository keeps WebAssembly to the JPEG XL test", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown> & {
      devDependencies: Record<string, string>;
      files: string[];
    };
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "bundledDependencies", "bundleDependencies"]) {
      expect(manifest[field], field).toBeUndefined();
    }
    expect(Object.keys(manifest.devDependencies).filter((name) => /wasm/iu.test(name))).toEqual(["jxl-oxide-wasm"]);
    expect(manifest.files.filter((entry) => /wasm/iu.test(entry))).toEqual([]);
    const boundaryFiles = new Set(["test/webassembly-boundary.test.ts", "scripts/lib/webassembly-boundary.mjs"]);
    // Files that load WebAssembly: they import jxl-oxide-wasm or a .wasm file, or use the WebAssembly global. (Gate
    // messages and test snippets that only name it in strings do not load it.)
    const users = tracked
      .filter((file) => /^(?:test|scripts|\.github)\//u.test(file) && /\.(?:[cm]?[jt]s)$/u.test(file) && !boundaryFiles.has(file))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return extractSpecifiers(text).some((specifier) => specifier === "jxl-oxide-wasm" || specifier.endsWith(".wasm")) ||
          findWebAssemblyUse(text).some((hit) => hit.endsWith(": identifier WebAssembly"));
      });
    expect(users).toEqual(["test/dng-import-phone.test.ts"]);
  });
});
