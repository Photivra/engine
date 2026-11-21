// SPDX-License-Identifier: Apache-2.0

/** Test the real tarball in an isolated ESM consumer; never resolve imports through source paths. */
import process from "node:process";
import console from "node:console";
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { declaredDependencyFields } from "./lib/dependency-fields.mjs";
const scratch = mkdtempSync(join(tmpdir(), "photivra-packed-consumer-"));
try {
  const pack = JSON.parse(execFileSync("npm", ["pack", "--cache", join(scratch,"cache"), "--ignore-scripts", "--json", "--pack-destination", scratch], { encoding: "utf8" }))[0];
  writeFileSync(join(scratch,"package.json"), '{"type":"module","private":true}');
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--offline", "--cache", join(scratch,"cache"), join(scratch,pack.filename)], { cwd: scratch, stdio: "pipe" });
  const packageRoot = join(scratch,"node_modules/@photivra/engine");
  const manifest = JSON.parse(readFileSync(join(packageRoot,"package.json"),"utf8"));
  const sourceManifest = JSON.parse(readFileSync("package.json", "utf8"));
  // ci-22 (#703): every field npm installs through, not `dependencies` alone (an optional dependency it cannot fetch offline is skipped).
  if (manifest.version !== sourceManifest.version || declaredDependencyFields(manifest).length) throw new Error("Release package identity/dependencies changed");
  const packedApiVersion = execFileSync(process.execPath, ["--input-type=module", "-e", 'import { ENGINE_API_VERSION } from "@photivra/engine"; console.log(ENGINE_API_VERSION);'], { cwd: scratch, encoding: "utf8" }).trim();
  if (packedApiVersion !== manifest.version) throw new Error("Packed package/root API version drift");
  // CommonJS consumers resolve the "default" condition through require(esm); the manifest is exported.
  const required = execFileSync(process.execPath, ["-e", 'const e=require("@photivra/engine"),m=require("@photivra/engine/package.json");console.log(e.ENGINE_API_VERSION+" "+m.version+" "+typeof e.calculateDepthOfField);'], { cwd: scratch, encoding: "utf8" }).trim();
  if (required !== `${manifest.version} ${manifest.version} function`) throw new Error(`require() consumer failed: ${required}`);
  // The published declarations must type-check without DOM or @types/node (lib es2022 only) and
  // alongside the DOM lib, with skipLibCheck disabled.
  for (const lib of [["lib.es2022.d.ts"], ["lib.es2022.d.ts", "lib.dom.d.ts"]]) {
    const file = join(scratch, "declarations-consumer.ts");
    writeFileSync(file, 'import * as engine from "@photivra/engine";\nexport const count: number = Object.keys(engine).length;\nexport const signal: AbortSignal["aborted"] | undefined = undefined;\n');
    const declarationProgram = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, lib, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: false, noEmit: true, types: [] });
    const declarationDiagnostics = ts.getPreEmitDiagnostics(declarationProgram);
    if (declarationDiagnostics.length) throw new Error(`Declarations fail with lib ${lib.join(", ")}:\n` + ts.formatDiagnostics(declarationDiagnostics, { getCurrentDirectory:()=>scratch,getCanonicalFileName:f=>f,getNewLine:()=>"\n" }));
  }
  const fragments = JSON.parse(readFileSync("docs/validation/documentation-fragments.json","utf8"));
  const docs = ["README.md", ...readdirSync("docs").filter(p => p.endsWith(".md") && p !== "API_REFERENCE.md").map(p => "docs/" + p)];
  const entries = [];
  for (const path of docs) {
    let block = 0;
    for (const match of readFileSync(path,"utf8").matchAll(/```(?:ts|typescript|js|javascript)\n([\s\S]*?)\n```/gu)) {
      const index = block++, code = match[1];
      if (!code.includes("@photivra/engine") || fragments.some(f => f.file === path && f.block === index)) continue;
      const file = join(scratch,`example-${entries.length}.ts`);
      writeFileSync(file,code); entries.push({ path, index, file, code });
    }
  }
  const program = ts.createProgram(entries.map(e => e.file), { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: false, noEmit: true, types: [] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory:()=>scratch,getCanonicalFileName:f=>f,getNewLine:()=>"\n" }));
  for (const entry of entries) {
    const file = entry.file.replace(/\.ts$/u,".mjs");
    writeFileSync(file,ts.transpile(entry.code,{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}));
    try { execFileSync(process.execPath,[file],{cwd:scratch,stdio:"pipe",timeout:30000}); }
    catch(error) { throw new Error(`Packed example failed: ${entry.path} block ${entry.index}`,{cause:error}); }
  }
  for (const file of ["quick-start.mjs","simulate-capture.mjs","production-capture.mjs","production-request.json"]) copyFileSync(join(packageRoot,"docs/examples",file),join(scratch,file));
  for (const file of ["quick-start.mjs","simulate-capture.mjs","production-capture.mjs"]) execFileSync(process.execPath,[join(scratch,file)],{cwd:scratch,stdio:"pipe",timeout:30000});
  console.log(`Packed ${manifest.name}@${manifest.version}: require(esm) and lib-es2022/DOM declaration consumers, ${entries.length} strict typed/running doc snippets plus quick-start, simulate-capture and production/paired-export consumers passed; no source checkout/dependencies used.`);
} finally { rmSync(scratch,{recursive:true,force:true}); }
