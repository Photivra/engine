// SPDX-License-Identifier: Apache-2.0

/**
 * Checks that the published colors of the built-in Photivra color patches (`getColorPatchSet()`) do not match openly
 * published third-party colors (docs/COLOR_PATCHES.md, "Distinct from third-party colors").
 *
 * Reference sets, each downloaded from a pinned URL, checked by SHA-256, parsed in memory and discarded (nothing from
 * them is written to disk or stored in the repository; license policy, THIRD_PARTY.md):
 *   - css: the 148 CSS named colors (W3C CSS Color Module Level 4, Candidate Recommendation Draft 2025-04-24, §6.1);
 *   - colorchecker-srgb: the 24-patch ColorChecker Classic, the manufacturer's sRGB values as tabulated on Wikipedia,
 *     "ColorChecker" (revision 1367818471);
 *   - colorchecker-lab: the same chart's published CIELAB/xyY (ICC D50) values as collected in colour-science 0.4.6
 *     (terms in THIRD_PARTY.md): X-Rite before and after November 2014, GretagMacbeth 2005 and the BabelColor average;
 *   - ral: RAL Classic approximate sRGB values as tabulated on Wikipedia, "List of RAL colours" (revision 1369650571);
 *     only the RAL Classic sections, not RAL Effect or RAL Design System+;
 *   - brands: brand colors from Simple Icons 1.20.0, 2.19.0, 4.25.0, 9.21.0 and 16.36.0, so that brands
 *     removed from later releases are still checked.
 * Pantone's data is proprietary and is not checked.
 *
 * Rule, per patch: no reference color has the same 8-bit sRGB hex, and every reference color is at least ΔE00 2.0
 * (CIEDE2000, the engine's `calculateColorDifference`) from the patch's published CIELAB (D65). Neutral patches are flat
 * spectra, so they cannot avoid gray reference colors in hue: for them only the hex rule applies, and the closest
 * match is reported. Reference CIELAB: from sRGB hex with the CSS Color 4 matrix and the sRGB D65 white; ICC D50 values
 * are adapted to D65 with the Bradford transform (ICC.1:2010 Annex E). A reference given only as CIELAB or xyY is
 * also rounded to an 8-bit sRGB hex for the hex rule.
 *
 * Usage (needs `npm run build` first, and network access; behind an HTTPS proxy run Node with NODE_USE_ENV_PROXY=1):
 *   node scripts/check-color-patch-distinctness.mjs                # check the published values; exit 1 on a failure
 *   node scripts/check-color-patch-distinctness.mjs --print        # also print each patch's closest reference color
 *       # (a brands-set color by its kind and release, "a brand red (Simple Icons 9.21.0)", not by its brand: #756)
 *   node scripts/check-color-patch-distinctness.mjs --candidates /path/outside/repo/candidates.json
 *       # check candidate values instead: a JSON array of { patchId, group, cielabD65: [L, a, b], srgbHex }
 *   node scripts/check-color-patch-distinctness.mjs --source-dir /path/outside/repo   # use local copies of the files
 */

import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MINIMUM_DELTA_E00 = 2.0;
const SIMPLE_ICONS = [
  ["1.20.0", "_data", "16a944cfa2cee33a31fc6a38e56c0b4ed85e88715222ca5c05896ef3e683e9ea"],
  ["2.19.0", "_data", "14789c5ed82b55e9544cb8bef9fba416e7c21c849b3fe0ed550f24b13191e3a7"],
  ["4.25.0", "_data", "dc10371e66fa600ad8f6e0a73dc93d5f7e4eebdd7ca24faf23bfe0bf44a991e0"],
  ["9.21.0", "_data", "e57237bfaf3b028f00ec8606e669a56d8cbbd87ee817ffb46cd791e675847936"],
  ["16.36.0", "data", "be03e20c247be486f03b13fd960bf4c77170577d342ca95a73c1a56853a10062"]
];
/**
 * Each source: a pinned URL, a file name for `--source-dir`, the SHA-256 of the response as retrieved on 2026-11-01,
 * and a parser to { name, hex, lab? }.
 */
const SOURCES = [
  { set: "css", file: "css-color-4-20250424.html", url: "https://www.w3.org/TR/2025/CRD-css-color-4-20250424/",
    sha256: "32f416053f48bdd1a11f83325323bed05ad40243d9534c5fbb2bf55f18f98a26", parse: parseCss },
  { set: "colorchecker-srgb", file: "wikipedia-colorchecker-1367818471.txt", url: "https://en.wikipedia.org/w/index.php?oldid=1367818471&action=raw",
    sha256: "77ab167e8178ded9166b9d60aff4055db845473befd412198f7c42052489eb6a", parse: parseColorCheckerWikipedia },
  { set: "colorchecker-lab", file: "colour-science-0.4.6-chromaticity_coordinates.py",
    url: "https://raw.githubusercontent.com/colour-science/colour/v0.4.6/colour/characterisation/datasets/colour_checkers/chromaticity_coordinates.py",
    sha256: "91dd681bf07c7ccc8a8b9d4fc8775082d99f694b37befbff660015950bf51d8c", parse: parseColourScience },
  { set: "ral", file: "wikipedia-ral-1369650571.txt", url: "https://en.wikipedia.org/w/index.php?oldid=1369650571&action=raw",
    sha256: "fd98cdd72861c723de5c1b76cb484230163944d7162923b303a2f67086e74e2c", parse: parseRal },
  ...SIMPLE_ICONS.map(([version, directory, sha256]) => ({ set: "brands", file: "simple-icons-" + version + ".json",
    url: "https://unpkg.com/simple-icons@" + version + "/" + directory + "/simple-icons.json", sha256, parse: (text) => parseSimpleIcons(text, version) }))
];

function parseCss(text) {
  const entries = [...text.matchAll(/id="valdef-color-([a-z]+)">\1<\/dfn>\s*<td>(#[0-9a-f]{6})/g)].map((m) => ({ name: m[1], hex: m[2].toUpperCase() }));
  if (entries.length !== 148) throw new Error("Expected the 148 CSS named colors, found " + entries.length + ".");
  return entries;
}
function parseColorCheckerWikipedia(text) {
  const entries = [...text.matchAll(/^\|\s*(\d+)\s*\|\|\s*([^|]+?)\s*\|\|[^\n]*\|(#[0-9a-fA-F]{6})\s*$/gm)].map((m) => ({ name: m[2] + " (" + m[1] + ")", hex: m[3].toUpperCase() }));
  if (entries.length !== 24) throw new Error("Expected the 24 ColorChecker patches, found " + entries.length + ".");
  return entries;
}
function parseColourScience(text) {
  const labels = [...(text.match(/^SAMPLE_LABELS_COLORCHECKER_CLASSIC: tuple = \(([\s\S]*?)^\)/m)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (labels.length !== 24) throw new Error("Unexpected ColorChecker labels in colour-science.");
  const block = (name) => {
    const body = text.match(new RegExp("^" + name + ": dict = dict\\(([\\s\\S]*?)^\\)", "m"))?.[1];
    const rows = [...(body ?? "").matchAll(/np\.array\(\[([^\]]+)\]\)/g)].map((m) => m[1].split(",").map(Number));
    if (rows.length !== 24 || rows.some((r) => r.length !== 3 || r.some((v) => !Number.isFinite(v)))) throw new Error("Unexpected " + name + " in colour-science.");
    return rows;
  };
  const entries = [];
  for (const [name, label] of [["DATA_COLORCHECKER24_BEFORE_NOV2014_CIE_LAB", "X-Rite before Nov 2014"], ["DATA_COLORCHECKER24_AFTER_NOV2014_CIE_LAB", "X-Rite after Nov 2014"]]) {
    block(name).forEach((lab, i) => entries.push({ name: labels[i] + " (" + label + ")", xyzD50: labToXyz(lab, D50) }));
  }
  for (const [name, label] of [["DATA_COLORCHECKER2005", "GretagMacbeth 2005"], ["DATA_BABELCOLOR_AVERAGE", "BabelColor average"]]) {
    block(name).forEach(([x, y, Y], i) => entries.push({ name: labels[i] + " (" + label + ")", xyzD50: [x * Y / y, Y, (1 - x - y) * Y / y] }));
  }
  return entries.map(({ name, xyzD50 }) => {
    const xyz = adaptD50ToD65(xyzD50);
    return { name, lab: xyzToLab(xyz, D65), hex: linearToHex(xyzToLinearSrgb(xyz)) };
  });
}
function parseRal(text) {
  const classic = text.slice(text.indexOf("==RAL Classic=="), text.indexOf("== RAL Effect =="));
  const seen = new Map();
  for (const line of classic.split("\n")) {
    const code = line.match(/^\|(RAL \d{4})\|/)?.[1], hex = line.match(/coltit\|([0-9A-Fa-f]{6})\}/)?.[1];
    if (!code || !hex || seen.has(code)) continue;
    // The second cell is the English name, after any cell style; wiki links [[target|label]] keep their label.
    const name = line.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").split("||")[1]?.split("|").pop()?.trim();
    seen.set(code, { name: code + " " + name, hex: "#" + hex.toUpperCase() });
  }
  if (seen.size !== 215) throw new Error("Expected the 215 RAL Classic colors of that revision, found " + seen.size + ".");
  return [...seen.values()];
}
function parseSimpleIcons(text, version) {
  const data = JSON.parse(text), icons = Array.isArray(data) ? data : data.icons;
  return icons.filter((i) => /^[0-9A-Fa-f]{6}$/.test(i.hex)).map((i) => ({ name: i.title + " (Simple Icons " + version + ")", hex: "#" + i.hex.toUpperCase() }));
}

/* Colorimetry: CSS Color 4 §19 matrices, sRGB D65 white, ICC D50 white, Bradford (ICC.1:2010 Annex E). */
const D65 = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
const D50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const XYZ_TO_LINEAR_SRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
const LINEAR_SRGB_TO_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const multiply = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const invert = (m) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map((r) => r.map((v) => v / det));
};
function adaptD50ToD65(xyz) {
  const source = multiply(BRADFORD, D50), target = multiply(BRADFORD, D65), cone = multiply(BRADFORD, xyz);
  return multiply(invert(BRADFORD), cone.map((v, i) => v * target[i] / source[i]));
}
const epsilon = (6 / 29) ** 3, kappa = (29 / 3) ** 3;
function xyzToLab(xyz, white) {
  const f = (t) => (t > epsilon ? Math.cbrt(t) : (kappa * t + 16) / 116), [fx, fy, fz] = xyz.map((v, i) => f(v / white[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToXyz([L, a, b], white) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, inv = (t) => (t ** 3 > epsilon ? t ** 3 : (116 * t - 16) / kappa);
  return [inv(fx) * white[0], inv(fy) * white[1], inv(fz) * white[2]];
}
const xyzToLinearSrgb = (xyz) => multiply(XYZ_TO_LINEAR_SRGB, xyz);
const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const decode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToHex = (linear) => "#" + linear.map((c) => Math.round(255 * encode(Math.min(1, Math.max(0, c)))).toString(16).padStart(2, "0").toUpperCase()).join("");
const hexToLab = (hex) => xyzToLab(multiply(LINEAR_SRGB_TO_XYZ, [1, 3, 5].map((i) => decode(parseInt(hex.slice(i, i + 2), 16) / 255))), D65);

/**
 * A generic word for a color's kind, from its CIELAB (D65): gray, white or black below chroma 8; otherwise its hue angle
 * (degrees) read as red, orange, yellow, green, cyan, blue, violet or magenta, with brown for a dark orange or yellow,
 * beige for a light low-chroma one, and pink for a light, moderate-chroma magenta or red. Wording only; the check does
 * not use it.
 */
export function colorKindWord([L, a, b]) {
  const chroma = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (chroma < 8) return L > 85 ? "white" : L < 25 ? "black" : "gray";
  const warm = hue >= 45 && hue < 105;
  if (warm && L < 50) return "brown";
  if (warm && L >= 70 && chroma < 25) return "beige";
  if ((hue >= 330 || hue < 45) && L >= 55 && chroma < 50) return "pink";
  if (hue < 20 || hue >= 330) return "magenta";
  if (hue < 45) return "red";
  if (hue < 75) return "orange";
  if (hue < 105) return "yellow";
  if (hue < 170) return "green";
  if (hue < 235) return "cyan";
  if (hue < 295) return "blue";
  return "violet";
}

/**
 * How the published docs name a reference color (#756): a brands-set color by its kind and its Simple Icons release
 * ("a brand red (Simple Icons 9.21.0)"), never by the brand; every other set by its own color name.
 */
export function describeReference(reference) {
  if (reference.set !== "brands") return reference.name;
  const release = /\(Simple Icons ([0-9.]+)\)$/.exec(reference.name)?.[1];
  return "a brand " + colorKindWord(reference.lab ?? hexToLab(reference.hex)) + (release ? " (Simple Icons " + release + ")" : "");
}

async function load(source, sourceDirectory) {
  let text;
  if (sourceDirectory) {
    text = readFileSync(path.join(sourceDirectory, source.file), "utf8");
  } else {
    const response = await globalThis.fetch(source.url);
    if (!response.ok) throw new Error("Download of " + source.url + " failed with HTTP " + response.status + ".");
    text = await response.text();
  }
  const digest = createHash("sha256").update(text).digest("hex");
  if (digest !== source.sha256) throw new Error("Unexpected content of " + source.url + " (SHA-256 " + digest + "); check the change before re-vetting.");
  return source.parse(text).map((entry) => ({ set: source.set, name: entry.name, hex: entry.hex, lab: entry.lab ?? hexToLab(entry.hex) }));
}

/**
 * The reference colors, each { set, name, hex, lab } with CIELAB under D65. `sourceDirectory`: local copies of the
 * pinned files (named as in SOURCES), which must be outside the repository.
 */
export async function loadReferenceColors(sourceDirectory) {
  if (sourceDirectory) {
    const directory = path.resolve(sourceDirectory);
    if (directory === REPOSITORY_ROOT || directory.startsWith(REPOSITORY_ROOT + path.sep)) throw new Error("Keep the reference sets outside the repository.");
  }
  return (await Promise.all(SOURCES.map((source) => load(source, sourceDirectory)))).flat();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

async function main() {
  const { getColorPatchSet, calculateColorDifference } = await import(path.join(REPOSITORY_ROOT, "dist", "index.js"));
  const sourceFlag = process.argv.indexOf("--source-dir");
  const references = await loadReferenceColors(sourceFlag === -1 ? undefined : process.argv[sourceFlag + 1] ?? "");
  const flag = process.argv.indexOf("--candidates");
  const patches = flag === -1 ? getColorPatchSet().patches.map((p) => ({ patchId: p.patchId, code: p.code, group: p.group, cielabD65: p.reference.cielabD65, srgbHex: p.reference.srgbHex }))
    : JSON.parse(readFileSync(path.resolve(process.argv[flag + 1] ?? ""), "utf8"));
  const deltaE00 = (a, b) => calculateColorDifference({ formula: "ciede2000", reference: { lStar: a[0], aStar: a[1], bStar: a[2] }, sample: { lStar: b[0], aStar: b[1], bStar: b[2] } }).value.deltaE;

  const counts = references.reduce((n, r) => ({ ...n, [r.set]: (n[r.set] ?? 0) + 1 }), {});
  console.log("Reference colors: " + Object.entries(counts).map(([set, n]) => set + " " + n).join(", ") + ".");
  let failures = 0;
  const report = [];
  for (const patch of patches) {
    const sameHex = references.filter((r) => r.hex === patch.srgbHex.toUpperCase());
    const distances = references.map((r) => ({ r, deltaE: deltaE00(patch.cielabD65, r.lab) })).sort((a, b) => a.deltaE - b.deltaE);
    const closest = distances[0], neutral = patch.group === "neutral";
    const pass = sameHex.length === 0 && (neutral || closest.deltaE >= MINIMUM_DELTA_E00);
    if (!pass) failures++;
    report.push({ patchId: patch.patchId, pass, closest, sameHex, nextColored: distances.find((d) => Math.hypot(d.r.lab[1], d.r.lab[2]) > 3) });
    if (!pass) console.error("Too close: " + patch.patchId + " " + patch.srgbHex + " — " + (sameHex.length ? "same hex as " + sameHex.map((r) => r.name + " [" + r.set + "]").join(", ") + "; " : "") +
      "closest " + closest.r.name + " [" + closest.r.set + "] " + closest.r.hex + " at ΔE00 " + closest.deltaE.toFixed(2) + ".");
  }
  if (process.argv.includes("--print")) {
    console.log("\n| Code | Id | sRGB | Closest reference color | Set | Its sRGB | ΔE00 |\n| --- | --- | --- | --- | --- | --- | --- |");
    for (const [i, row] of report.entries()) {
      console.log("| " + (patches[i].code ?? "") + " | `" + row.patchId + "` | `" + patches[i].srgbHex + "` | " + describeReference(row.closest.r) + " | " + row.closest.r.set + " | `" + row.closest.r.hex + "` | " + row.closest.deltaE.toFixed(2) + " |");
    }
  }
  console.log(failures === 0 ? "All " + patches.length + " patches are distinct from the reference colors (no equal hex; ΔE00 ≥ " + MINIMUM_DELTA_E00.toFixed(1) + " except neutrals)."
    : failures + " patches are too close to a reference color.");
  process.exitCode = failures === 0 ? 0 : 1;
}
