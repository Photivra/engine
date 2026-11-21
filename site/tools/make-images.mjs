// SPDX-License-Identifier: Apache-2.0
// Makes the site's raster icons and social image (a maintainer tool, not part of the build; docs/design/engine-site.md,
// decision 11). The outputs are committed in site/assets/. Run after make-icon-svg.py and make-fonts.py:
//
//   node site/tools/make-images.mjs
//
// - favicon.ico (32 × 32) and apple-touch-icon.png (180 × 180): site/assets/icon.svg drawn by headless Chromium.
// - social.png (1200 × 630): type only, the name, the abstract from CITATION.cff and the package name from package.json,
//   in Inter (the committed subsets) on the dark ground.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "../checks/chrome.mjs";
import { parseCitation } from "../lib/sources.mjs";
import { escapeHtml } from "../lib/html.mjs";

const site = fileURLToPath(new URL("..", import.meta.url));
const root = join(site, "..");
const assets = join(site, "assets");
const citation = parseCitation(readFileSync(join(root, "CITATION.cff"), "utf8"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const work = mkdtempSync(join(tmpdir(), "site-images-"));
copyFileSync(join(assets, "icon.svg"), join(work, "icon.svg"));
copyFileSync(join(assets, "fonts/inter-400.woff2"), join(work, "inter-400.woff2"));
copyFileSync(join(assets, "fonts/inter-600-700.woff2"), join(work, "inter-600-700.woff2"));
writeFileSync(join(work, "icon.html"), "<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img src=\"icon.svg\" alt=\"\">");
// The touch icon is opaque and square (the system rounds it), on the dark ground.
writeFileSync(join(work, "touch.html"), "<!doctype html><style>html,body{margin:0;background:#111113}img{display:block;width:100vw;height:100vh}</style><img src=\"icon.svg\" alt=\"\">");
writeFileSync(join(work, "social.html"), `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:400;src:url(inter-400.woff2)}
@font-face{font-family:Inter;font-weight:600 700;src:url(inter-600-700.woff2)}
html,body{margin:0;width:1200px;height:630px;background:#111113;color:#f2f2f7;font-family:Inter}
main{box-sizing:border-box;height:630px;padding:96px 104px;display:flex;flex-direction:column;justify-content:space-between}
h1{margin:0;font-size:128px;font-weight:700;letter-spacing:-3px;line-height:1}
p{margin:40px 0 0;font-size:44px;line-height:1.3;max-width:980px}
footer{font-size:36px;color:#aeaeb2}
</style><main><div><h1>${escapeHtml(citation.title)}</h1><p>${escapeHtml(citation.abstract)}</p></div><footer>${escapeHtml(pkg.name)}</footer></main>`);

const chrome = await launchChrome(["--force-device-scale-factor=1"]);
try {
  const page = await chrome.connect();
  await page.send("Page.enable");
  const shot = async (file, width, height, transparent) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    if (transparent) await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.navigate(pathToFileURL(join(work, file)).href);
    await page.evaluate("document.fonts.ready.then(() => true)");
    const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
    return Buffer.from(data, "base64");
  };
  writeFileSync(join(assets, "apple-touch-icon.png"), await shot("touch.html", 180, 180, false));
  const favicon = await shot("icon.html", 32, 32, true);
  writeFileSync(join(assets, "social.png"), await shot("social.html", 1200, 630, false));
  // An ICO file holding one 32 × 32 PNG image (ICONDIR, one ICONDIRENTRY, the PNG).
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(32, 6);
  header.writeUInt8(32, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(favicon.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync(join(assets, "favicon.ico"), Buffer.concat([header, favicon]));
  page.close();
} finally {
  await chrome.close();
  rmSync(work, { recursive: true, force: true });
}
for (const name of ["favicon.ico", "apple-touch-icon.png", "social.png"]) console.log(`${name}: ${readFileSync(join(assets, name)).length} bytes`);
