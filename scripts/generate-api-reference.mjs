// SPDX-License-Identifier: Apache-2.0

/** Build public navigation from TypeScript's resolved root exports, never a guessed symbol list. */
import ts from "typescript";
import process from "node:process";
import console from "node:console";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { relative } from "node:path";
const checkOnly = process.argv.includes("--check");
function emit(path, content) {
  content = content.trimEnd() + "\n";
  if (checkOnly) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Stale generated reference: ${path}`);
  } else writeFileSync(path, content);
}
const config = ts.readConfigFile("tsconfig.build.json", ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ".");
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const root = program.getSourceFile("src/index.ts");
const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(root));
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const version = program.getSourceFile("src/core/version.ts").text.match(/ENGINE_API_VERSION = "([^"]+)"/u)[1];
const grouped = new Map();
for (const exported of exports) {
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = symbol.declarations?.[0];
  if (!declaration) throw new Error(`Missing declaration for ${exported.name}`);
  const file = relative(process.cwd(), declaration.getSourceFile().fileName).replaceAll("\\", "/");
  const rows = grouped.get(file) ?? [];
  rows.push({ name: exported.name, symbol, declaration, runtime: Boolean(symbol.flags & ts.SymbolFlags.Value) });
  grouped.set(file, rows);
}
const header = `# Public API reference\n\nGenerated from the exact root exports for **@photivra/engine ${packageVersion} / root contract ${version}** by \`node scripts/generate-api-reference.mjs\`. No module deep import is supported.\n\nUse [the developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md) for executable paths and scientific boundaries. Types are contracts, not runtime validation: parse untrusted data, preserve units/reference frames, read assessment blockers, and retain evidence/limitations. Optional properties do not imply a universal default. Model/schema IDs remain independent of the distribution.\n\n`;
// A short fixed task index for people and agents. Every name must be a runtime root export, and its
// link is derived from the export's resolved source file, so the index cannot go stale silently.
const TASK_INDEX = [
  ["Simulate a full photo (async)", ["simulateCapture"]],
  ["Preview a whole frame as the real capture resized (async)", ["simulateDisplayView"]],
  ["Exposure value and equivalent settings", ["calculateExposureValue100", "calculateEquivalentIso", "calculateRelativeRenderedExposure"]],
  ["Depth of field, hyperfocal distance and defocus blur", ["calculateDepthOfField", "calculateDefocusCircle"]],
  ["Field of view", ["calculateFieldOfView"]],
  ["Crop factor, 35 mm-equivalent focal length and crops", ["calculateEquivalentFocalLength35Mm", "calculateCenteredCrop"]],
  ["Equivalent f-number, sensor area and blur as a share of the frame", ["calculateSensorEquivalence", "calculateBlurShareOfFrame"]],
  ["Motion blur and shutter speed", ["calculateProjectedMotionBlur", "calculateShutterAngleExposureSeconds"]],
  ["Diffraction", ["calculateAiryDisk"]],
  ["Sensor signal, noise and SNR", ["calculatePhotoelectrons", "calculateSignalToNoise"]],
  ["Colour temperature", ["calculateChromaticityFromCorrelatedColorTemperature", "calculateCorrelatedColorTemperature"]],
  ["White balance from Kelvin and tint", ["createColorTemperatureWhiteBalanceIntent", "resolveColorTemperatureWhiteBalance"]]
];
const apiPage = (file) => `api/${file.slice(4).replace(/\.ts$/u, "").replaceAll("/", "-")}.md`;
const exportFiles = new Map();
for (const [file, rows] of grouped) for (const row of rows) exportFiles.set(row.name, { file, runtime: row.runtime });
let taskIndex = "## Task index\n\nStart here to find a function by task. [Using Photivra from an agent](AGENT_GUIDE.md) gives units, result reading and errors.\n\n| Task | Functions |\n| --- | --- |\n";
for (const [task, names] of TASK_INDEX) {
  const links = names.map((name) => {
    const entry = exportFiles.get(name);
    if (!entry || !entry.runtime) throw new Error(`Task index names ${name}, which is not a runtime root export.`);
    return `[\`${name}\`](${apiPage(entry.file)}#${name.toLowerCase()})`;
  });
  taskIndex += `| ${task} | ${links.join(", ")} |\n`;
}
let reference = header + taskIndex + "\n";
const manifest = [];
mkdirSync("docs/api", { recursive: true });
for (const [file, rows] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
  const id = file.slice(4).replace(/\.ts$/u, "").replaceAll("/", "-");
  const name = `api/${id}.md`;
  reference += `## ${file.slice(4)}\n\n[Detailed contracts](${name}) · [Source](https://github.com/Photivra/photivra/blob/main/${file})\n\n| Export | Kind |\n| --- | --- |\n`;
  let detail = `# ${file.slice(4)} public contracts\n\nThe package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.\n\n`;
  for (const row of rows.sort((a,b) => a.name.localeCompare(b.name))) {
    reference += `| [\`${row.name}\`](${name}#${row.name.toLowerCase()}) | ${row.runtime ? "Runtime" : "Type"} |\n`;
    const comment = ts.displayPartsToString(row.symbol.getDocumentationComment(checker));
    detail += `## ${row.name}\n\n${comment ? comment + "\n\n" : "The exact contract is declared below; use the domain guide for assumptions and staged integration.\n\n"}`;
    const declarations = row.symbol.declarations ?? [row.declaration];
    for (const declaration of declarations) {
      let text = declaration.getText();
      if (ts.isFunctionDeclaration(declaration) && declaration.body) text = text.slice(0, declaration.body.pos - declaration.getStart()).trimEnd() + ";";
      // Variable declarations carry literal constants/defaults. Interfaces retain every field and union.
      // #536: the bundler annotation on module-level frozen tables is not part of the contract.
      text = text.replaceAll("/* @__PURE__ */ ", "");
      detail += "```ts\n" + text + "\n```\n\n";
    }
    const type = checker.getTypeOfSymbolAtLocation(row.symbol, row.declaration);
    const signature = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0];
    if (signature) {
      detail += "This call is " + (checker.typeToString(checker.getReturnTypeOfSignature(signature)).startsWith("Promise<") ? "asynchronous; byte hashing uses the caller runtime's Web Crypto." : "synchronous; any supplied provider must follow its explicit synchronous contract.") + "\n\n";
    }
    manifest.push({ name: row.name, source: file, kind: row.runtime ? "runtime" : "type" });
  }
  emit("docs/" + name, detail);
  reference += "\n";
}
emit("docs/API_REFERENCE.md", reference);
emit("docs/api/exports.json", JSON.stringify({ packageVersion, engineApiVersion: version, exports: manifest.sort((a,b) => a.name.localeCompare(b.name)) }, null, 2) + "\n");
console.log(`Reference generated: ${manifest.length} root symbols across ${grouped.size} modules.`);
