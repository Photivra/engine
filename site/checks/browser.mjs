// SPDX-License-Identifier: Apache-2.0
// The browser pass (docs/design/engine-site.md, section 15), in headless Chromium against the built site on 127.0.0.1:
//
// - every page: no request to another host, no cookie, no storage write, no console error or policy violation, no running
//   animation, no sideways scrolling at 320 px and 640 px wide (640 px is 1,280 px at 200 % zoom);
// - sampled pages (one per kind and the heaviest of each kind; every page with --all): axe-core's WCAG 2.0, 2.1 and 2.2 A
//   and AA rules in the light and the dark color scheme, the skip link as the first focusable element, a visible focus
//   outline on a link and a button;
// - the search page with its script: a query gives the expected first result, count and status text, and the address
//   carries the query.
//
//   node site/checks/browser.mjs [_site] [--all]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { launchChrome } from "./chrome.mjs";
import { serve } from "./serve.mjs";
import { pageKind } from "./budgets.mjs";
import { Findings, readPages } from "./lib.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** One page per kind plus the heaviest page of each kind (by gzip size of its HTML). */
export function samplePages(pages) {
  const byKind = new Map();
  for (const page of pages) {
    const kind = pageKind(page.url);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push({ ...page, size: gzipSync(page.html).length });
  }
  const sample = new Set();
  for (const list of byKind.values()) {
    sample.add(list[0].url);
    sample.add(list.reduce((a, b) => (b.size > a.size ? b : a)).url);
  }
  return [...sample].sort();
}

const frames = (count) => `new Promise((resolve) => { let n = ${count}; const step = () => (--n <= 0 ? resolve(true) : requestAnimationFrame(step)); requestAnimationFrame(step); })`;

export async function checkBrowser(directory, { all = false, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const findings = new Findings("Browser pass (browser.mjs)");
  const pages = readPages(directory);
  const sample = new Set(all ? pages.map((page) => page.url) : samplePages(pages));
  const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
  const server = await serve(directory);
  const chrome = await launchChrome();
  const session = await chrome.connect();
  let current = "";
  const started = Date.now();
  try {
    await session.send("Page.enable");
    await session.send("Network.enable");
    await session.send("Runtime.enable");
    await session.send("Log.enable");
    session.on("Network.requestWillBeSent", ({ request }) => {
      if (!request.url.startsWith(`${server.origin}/`) && !request.url.startsWith("data:") && request.url !== "about:blank") findings.fail(`${current}: a request to ${request.url}`);
    });
    session.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type === "error" || type === "warning" || type === "assert") findings.fail(`${current}: console ${type}: ${args.map((arg) => arg.value ?? arg.description).join(" ")}`);
    });
    session.on("Runtime.exceptionThrown", ({ exceptionDetails }) => findings.fail(`${current}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`));
    session.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error" || entry.level === "warning") findings.fail(`${current}: ${entry.source} ${entry.level}: ${entry.text}`);
    });
    const metrics = (width, height = 900) => session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    const scheme = (value) => session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const noSidewaysScroll = async (width) => {
      await metrics(width);
      const overflow = await session.evaluate(`${frames(1)}.then(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)`);
      if (overflow > 0) findings.fail(`${current}: scrolls sideways by ${overflow} px at ${width} px wide`);
    };
    let axeRuns = 0;
    for (const page of pages) {
      current = page.url;
      await scheme("light");
      await metrics(1280);
      await session.navigate(`${server.origin}${page.url}`);
      const state = await session.evaluate(`({ storage: localStorage.length + sessionStorage.length, animations: document.getAnimations().length,
        transitions: [...document.querySelectorAll("*")].filter((element) => { const style = getComputedStyle(element); return style.transitionDuration.split(",").some((d) => parseFloat(d) > 0) && style.transitionProperty !== "none"; }).length })`);
      if (state.storage) findings.fail(`${current}: wrote to storage`);
      if (state.animations) findings.fail(`${current}: ${state.animations} running animation(s)`);
      if (state.transitions) findings.fail(`${current}: ${state.transitions} element(s) with a transition`);
      const { cookies } = await session.send("Network.getCookies", { urls: [server.origin] });
      if (cookies.length) findings.fail(`${current}: set ${cookies.length} cookie(s)`);
      await noSidewaysScroll(320);
      await noSidewaysScroll(640);
      if (!sample.has(page.url)) continue;
      // Keyboard: the skip link first, a visible outline on a link and on a button.
      await metrics(1280);
      await session.navigate(`${server.origin}${page.url}`);
      const press = async () => {
        await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      };
      const focused = () => session.evaluate(`(() => { const e = document.activeElement; const s = getComputedStyle(e);
        return { tag: e.tagName, cls: e.className, href: e.getAttribute("href"), outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2 }; })()`);
      await press();
      const first = await focused();
      if (first.tag !== "A" || first.cls !== "skip" || first.href !== "#main") findings.fail(`${current}: the first focusable element is not the skip link (${JSON.stringify(first)})`);
      if (!first.outline) findings.fail(`${current}: the focused skip link has no visible outline`);
      let button;
      for (let index = 0; index < 40 && !button; index++) {
        await press();
        const element = await focused();
        if (element.tag === "BUTTON") button = element;
      }
      if (!button) findings.fail(`${current}: no button reached by keyboard`);
      else if (!button.outline) findings.fail(`${current}: a focused button has no visible outline`);
      // axe-core in both color schemes.
      for (const value of ["light", "dark"]) {
        await scheme(value);
        await session.navigate(`${server.origin}${page.url}`);
        await session.evaluate(`${axeSource}\ntrue`);
        const result = await session.evaluate(`axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ["violations"] })
          .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })))`);
        axeRuns++;
        for (const violation of result) findings.fail(`${current} (${value}): axe ${violation.id} (${violation.impact}): ${violation.help} at ${violation.nodes.join("; ")}`);
      }
    }
    // Search with its script.
    current = "/search/";
    await scheme("light");
    await metrics(1280);
    await session.navigate(`${server.origin}/search/?q=depth`);
    await session.evaluate(frames(2));
    const search = await session.evaluate(`({ status: document.getElementById("search-status").textContent, notice: !!document.getElementById("noscript-note"),
      first: document.querySelector('section[data-list="export"] ul.results:not([hidden]) li a')?.textContent, address: location.search,
      visible: [...document.querySelectorAll('section[data-list="export"] li')].filter((li) => li.offsetParent !== null).length })`);
    if (!/^\d+ matches for “depth”: 1 task, \d+ exports, 1 module and \d+ guide sections\.$/u.test(search.status)) findings.fail(`/search/?q=depth: status "${search.status}"`);
    if (search.first !== "DepthOfField") findings.fail(`/search/?q=depth: the first export is ${search.first}, not DepthOfField`);
    if (search.notice) findings.fail("/search/: the no-script notice is still shown with the script");
    if (search.address !== "?q=depth") findings.fail(`/search/: the address carries ${search.address}`);
    const typed = await session.evaluate(`(() => { const field = document.getElementById("sq"); field.value = "calculateDepthOfField"; field.dispatchEvent(new Event("input"));
      return ${frames(3)}.then(() => ({ status: document.getElementById("search-status").textContent, address: location.search,
        first: document.querySelector('section[data-list="export"] ul.results:not([hidden]) li a')?.textContent })); })()`);
    if (typed.first !== "calculateDepthOfField" || !/^\d+ matches for “calculateDepthOfField”: \d+ tasks? and 2 exports\.$/u.test(typed.status) || typed.address !== "?q=calculateDepthOfField") {
      findings.fail(`/search/: typing an exact name gives ${JSON.stringify(typed)}`);
    }
    const none = await session.evaluate(`(() => { const field = document.getElementById("sq"); field.value = "zzqqxx"; field.dispatchEvent(new Event("input"));
      return ${frames(3)}.then(() => document.getElementById("search-status").textContent); })()`);
    if (!none.startsWith("No matches for “zzqqxx”")) findings.fail(`/search/: no-match status "${none}"`);
    const cleared = await session.evaluate(`(() => { const field = document.getElementById("sq"); field.value = ""; field.dispatchEvent(new Event("input"));
      return ${frames(3)}.then(() => ({ rows: [...document.querySelectorAll('section[data-list="export"] li')].filter((li) => li.offsetParent !== null && li.querySelector(".what")).length, address: location.search })); })()`);
    if (cleared.address !== "" || cleared.rows < 2000) findings.fail(`/search/: clearing the query does not restore the index (${JSON.stringify(cleared)})`);
    findings.note(`${pages.length} pages loaded; axe on ${sample.size} pages in two color schemes (${axeRuns} runs); ${Math.round((Date.now() - started) / 1000)} s`);
  } finally {
    session.close();
    await chrome.close();
    await server.close();
  }
  log(`Requests served: ${server.requests.length}`);
  return findings;
}

export async function main(directory = "_site", all = false) {
  (await checkBrowser(directory, { all })).report();
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "_site", process.argv.includes("--all"));
