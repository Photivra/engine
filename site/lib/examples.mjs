// SPDX-License-Identifier: Apache-2.0
// Rendered examples (docs/design/engine-site.md, section 7): a figure is the output of the code block directly above it, run
// unchanged by the engine built from the same commit. The code is taken from the guide, never copied; the build adds no
// option and changes none, never resizes or re-encodes, and fails when a block throws or a budget is exceeded.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export const EXAMPLE_LIMITS = Object.freeze({
  imageBytes: 400_000,
  perPage: 3,
  examples: 12,
  allBytes: 4_000_000,
  oneSeconds: 10,
  allSeconds: 90,
  minimumWidth: 240
});

const BLOCK = /```(?:ts|typescript|js|javascript)\n([\s\S]*?)\n```/gu;

/** The `index`-th ts/js block of a Markdown file, counted as docs:check and documentation-fragments.json count them. */
export function codeBlock(text, index) {
  const blocks = [...text.matchAll(BLOCK)];
  if (!blocks[index]) throw new Error(`No code block ${index} (the file has ${blocks.length})`);
  return blocks[index][1];
}

/** Reads and checks the manifest. */
export function readManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, "site/examples/examples.json"), "utf8"));
  const examples = manifest.examples;
  if (examples.length > EXAMPLE_LIMITS.examples) throw new Error(`${examples.length} examples; the limit is ${EXAMPLE_LIMITS.examples}`);
  const names = new Set();
  for (const example of examples) {
    for (const field of ["name", "file", "result", "alt"]) if (typeof example[field] !== "string" || !example[field]) throw new Error(`Example without ${field}: ${JSON.stringify(example)}`);
    if (!Number.isInteger(example.block)) throw new Error(`Example ${example.name}: block must be an integer`);
    if (!/^[a-z0-9-]+$/u.test(example.name) || names.has(example.name)) throw new Error(`Example name ${example.name} is not a unique slug`);
    names.add(example.name);
    for (const fact of example.facts ?? []) if (!["exposure.settings", "scene.layers", "assumptions"].includes(fact)) throw new Error(`Example ${example.name}: unknown fact ${fact}`);
  }
  if (examples.filter((example) => example.home).length > 1) throw new Error("At most one example is on the home page");
  return examples;
}

/**
 * Runs every example with the engine in `<root>/dist` and returns the PNG bytes and the facts for each.
 * @param {string} root Repository root, holding the built engine.
 * @param {string} cacheDir A scratch directory for the transpiled blocks.
 * @param {string} version package.json's version; the built engine must report it.
 */
export async function runExamples(root, cacheDir, version, log = () => {}) {
  const examples = readManifest(root);
  const require = createRequire(join(root, "package.json"));
  const ts = require("typescript");
  const engineUrl = pathToFileURL(join(root, "dist/index.js")).href;
  const engine = await import(engineUrl);
  if (engine.ENGINE_API_VERSION !== version) throw new Error(`The built engine reports ${engine.ENGINE_API_VERSION}; package.json says ${version}. Run npm run build at the repository root.`);
  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });
  const results = [];
  let totalSeconds = 0;
  for (const example of examples) {
    const source = codeBlock(readFileSync(join(root, example.file), "utf8"), example.block);
    const program = `${source}\nexport { ${example.result} as __siteExampleResult };\n`;
    const javascript = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 }, fileName: `${example.name}.ts` }).outputText
      .replace(/(from\s+)(["'])@photivra\/engine\2/gu, `$1"${engineUrl}"`);
    const file = join(cacheDir, `${example.name}.mjs`);
    writeFileSync(file, javascript);
    const started = performance.now();
    let module;
    const logged = console.log;
    console.log = () => {}; // the block's own console output is not part of the site
    try {
      module = await import(pathToFileURL(file).href);
    } catch (error) {
      throw new Error(`Example ${example.name} (${example.file}, block ${example.block}) threw: ${error.stack ?? error}`, { cause: error });
    } finally {
      console.log = logged;
    }
    const seconds = (performance.now() - started) / 1000;
    totalSeconds += seconds;
    const result = module.__siteExampleResult;
    if (!result?.image) throw new Error(`Example ${example.name}: the binding ${example.result} holds no result with an image`);
    const image = result.image;
    let png, encodedBy;
    if (image.format === "png" && image.png) {
      png = image.png;
      encodedBy = "written by the engine with output.format: \"png\"";
    } else if (image.format === "srgb-8" && image.samples.length === image.width * image.height * 3) {
      png = engine.serializePngImage({ width: image.width, height: image.height, bitDepth: 8, samples: image.samples, colourEncoding: { kind: "srgb", renderingIntent: "perceptual" } });
      encodedBy = "its 8-bit sRGB samples written as a PNG with the engine's serializePngImage";
    } else {
      throw new Error(`Example ${example.name}: output format ${image.format} is not a PNG or 8-bit sRGB samples`);
    }
    png = Buffer.from(png);
    const picture = image.width >= EXAMPLE_LIMITS.minimumWidth;
    if (picture && png.length > EXAMPLE_LIMITS.imageBytes) throw new Error(`Example ${example.name}: ${png.length} bytes, over the ${EXAMPLE_LIMITS.imageBytes}-byte budget`);
    if (seconds > EXAMPLE_LIMITS.oneSeconds) log(`warning: example ${example.name} took ${seconds.toFixed(1)} s, over the ${EXAMPLE_LIMITS.oneSeconds} s budget`);
    log(`example ${example.name}: ${image.width} × ${image.height}, ${png.length} bytes, ${seconds.toFixed(1)} s`);
    results.push({
      ...example,
      picture,
      png,
      hash: createHash("sha256").update(png).digest("hex").slice(0, 10),
      width: image.width,
      height: image.height,
      encodedBy,
      label: typeof result.label === "string" ? result.label : undefined,
      kind: result.kind,
      facts: factsOf(example.facts ?? [], result)
    });
  }
  if (totalSeconds > EXAMPLE_LIMITS.allSeconds) throw new Error(`The examples took ${totalSeconds.toFixed(1)} s, over the ${EXAMPLE_LIMITS.allSeconds} s budget`);
  const allBytes = results.reduce((sum, result) => sum + (result.picture ? result.png.length : 0), 0);
  if (allBytes > EXAMPLE_LIMITS.allBytes) throw new Error(`Example images total ${allBytes} bytes, over ${EXAMPLE_LIMITS.allBytes}`);
  return results;
}

function factsOf(names, result) {
  const facts = {};
  for (const name of names) {
    if (name === "assumptions") {
      if (!Array.isArray(result.assumptions)) throw new Error("The result has no assumptions list");
      facts.assumptions = result.assumptions.length;
    } else if (name === "exposure.settings") {
      const settings = result.exposure?.settings;
      if (!settings) throw new Error("The result has no exposure.settings");
      facts.exposure = { fNumber: settings.fNumber, shutterSeconds: settings.shutterSeconds, iso: settings.iso };
    } else if (name === "scene.layers") {
      if (!Array.isArray(result.scene?.layers)) throw new Error("The result has no scene.layers");
      facts.layers = result.scene.layers.map((layer) => ({ kind: layer.kind, index: layer.index, distanceM: layer.distanceM, defocusDiameterSites: layer.defocusDiameterSites, withinDepthOfField: layer.withinDepthOfField }));
    }
  }
  return facts;
}
