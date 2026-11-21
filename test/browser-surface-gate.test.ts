// SPDX-License-Identifier: Apache-2.0
/*
 * #695 (with `capture-12`): the browser-surface gate (scripts/check-browser-surface.mjs) followed static imports only,
 * knew eight Node module names and never opened the 15 published modules reached only by `import()`. Its walk now lives
 * in scripts/lib/browser-surface.mjs and is tested here on in-memory source trees; the rows of the ticket's table are the
 * cases that passed the gate before.
 */
import { describe, expect, it } from "vitest";
import { extractSpecifiers, isNodeBuiltin, isPublished, unvisitedPublished, walkSourceGraph } from "../scripts/lib/browser-surface.mjs";

const ROOT = "/repo/src";

function walk(files: Record<string, string>): { visited: string[]; violations: string[] } {
  const result = walkSourceGraph(`${ROOT}/index.ts`, {
    sourceRoot: ROOT,
    read: (file: string): string => {
      const text = files[file.slice(ROOT.length + 1)];
      if (text === undefined) throw new Error(`no file ${file}`);
      return text;
    }
  });
  return { visited: [...result.visited].map((file) => file.slice(ROOT.length + 1)).sort(), violations: result.violations };
}

describe("browser-surface gate (#695)", () => {
  it("follows dynamic imports into lazily loaded modules", () => {
    const result = walk({
      "index.ts": 'export { run } from "./core/run.js";\nexport const kit = (): Promise<unknown> => import("./facade/export-kit.js");\n',
      "core/run.ts": "export const run = 1;\n",
      "facade/export-kit.ts": 'import "node:fs";\nexport const k = 1;\n'
    });
    expect(result.visited).toEqual(["core/run.ts", "facade/export-kit.ts", "index.ts"]);
    expect(result.violations).toEqual(['facade/export-kit.ts imports Node-only module "node:fs" from the browser package graph.']);
  });

  it("rejects a dynamic import of a Node module", () => {
    const result = walk({ "index.ts": 'export const leak = await import("node:fs");\n' });
    expect(result.violations).toEqual(['index.ts imports Node-only module "node:fs" from the browser package graph.']);
  });

  it("rejects every Node built-in by its bare name, not eight of them", () => {
    const result = walk({ "index.ts": 'import zlib from "zlib";\nimport { readFile } from "fs/promises";\nvoid zlib; void readFile;\n' });
    expect(result.violations).toEqual([
      'index.ts imports Node-only module "zlib" from the browser package graph.',
      'index.ts imports Node-only module "fs/promises" from the browser package graph.'
    ]);
    expect(isNodeBuiltin("zlib")).toBe(true);
    expect(isNodeBuiltin("node:test")).toBe(true);
    expect(isNodeBuiltin("zlib-browser")).toBe(false);
  });

  it("rejects any bare specifier: the package has no runtime dependencies", () => {
    const result = walk({ "index.ts": 'export * from "some-package";\nconst lazy = (): Promise<unknown> => import(`other-package`);\nvoid lazy;\n' });
    expect(result.violations).toEqual([
      'index.ts imports package "some-package"; engine modules import engine modules only (relative paths).',
      'index.ts imports package "other-package"; engine modules import engine modules only (relative paths).'
    ]);
  });

  it("rejects the repository-only API reached from the package graph", () => {
    const result = walk({ "index.ts": 'export { serve } from "./api/server.js";\n', "api/server.ts": 'import "node:http";\n' });
    expect(result.violations).toEqual(["api/server.ts is Node-only POC API code reachable from the root package export."]);
  });

  it("reads specifiers of every import form, and none from comments or strings", () => {
    const source = [
      'import a from "./a.js";',
      'import "./b.js";',
      'export * from "./c.js";',
      'export type { D } from "./d.js";',
      'const e = await import("./e.js");',
      "const f = await import('./f.js');",
      "type G = typeof import(`./g.js`);",
      'const h = require("./h.js");',
      '// import "node:fs" in a comment',
      '/** See `import("@photivra/engine")`. */',
      'const message = "needs the " + name + " from " + where + ".";',
      'const quoted = `import("zlib")`;'
    ].join("\n");
    expect(extractSpecifiers(source)).toEqual(["./a.js", "./b.js", "./c.js", "./d.js", "./e.js", "./f.js", "./g.js", "./h.js"]);
  });

  it("names a published module that the walk did not reach", () => {
    const files = ["src/index.ts", "src/core/run.ts", "src/facade/orphan.ts", "src/api/server.ts", "src/capture/browser-native-reference-x.ts", "src/schema/camera.ts"];
    const patterns = ["dist/index.js", "dist/core", "dist/facade", "dist/capture", "dist/schema", "!dist/capture/browser-native-reference-*", "!dist/schema/camera.js", "README.md"];
    expect(isPublished("dist/facade/orphan.js", patterns)).toBe(true);
    expect(isPublished("dist/capture/browser-native-reference-x.js", patterns)).toBe(false);
    expect(isPublished("dist/schema/camera.js", patterns)).toBe(false);
    expect(isPublished("dist/motion/x.js", patterns)).toBe(false);
    expect(unvisitedPublished(files, new Set(["src/index.ts", "src/core/run.ts"]), patterns)).toEqual(["facade/orphan.ts"]);
  });
});
