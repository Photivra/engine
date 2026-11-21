// SPDX-License-Identifier: Apache-2.0
// Lighthouse floors (docs/design/engine-site.md, section 11, decision 10): performance 95, accessibility 100, best
// practices 95, SEO 100, on Lighthouse's default mobile profile, the median of three runs, run locally against the built
// site on 127.0.0.1 for one page of each kind and the heaviest page of each kind. Nothing is sent anywhere: Lighthouse's
// error reporting is never turned on (site/stubs/sentry-node stands in for its optional package).
//
// Two exceptions, printed with every result and never silent:
// - Lighthouse's own robots-txt audit fetches /robots.txt from inside the page, and the pages' Content-Security-Policy
//   (default-src 'none', no connect-src; section 13) blocks that fetch. Crawlers read robots.txt directly; meta.mjs checks
//   its exact content. When that audit fails for that reason only, the SEO score is recomputed without it.
// - The not-found page is `noindex` by design, so it is not held to the SEO floor.
//
//   node site/checks/lighthouse.mjs [_site] [--runs 3]
import process from "node:process";
import lighthouse from "lighthouse";
import { launchChrome } from "./chrome.mjs";
import { serve } from "./serve.mjs";
import { samplePages } from "./browser.mjs";
import { Findings, readPages } from "./lib.mjs";

export const FLOORS = { performance: 95, accessibility: 100, "best-practices": 95, seo: 100 };

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function checkLighthouse(directory, { runs = 3, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const findings = new Findings("Lighthouse (lighthouse.mjs)");
  const urls = samplePages(readPages(directory));
  const server = await serve(directory);
  const chrome = await launchChrome();
  try {
    for (const url of urls) {
      const scores = Object.fromEntries(Object.keys(FLOORS).map((key) => [key, []]));
      const failedAudits = new Set();
      const notes = new Set();
      for (let run = 0; run < runs; run++) {
        const result = await lighthouse(`${server.origin}${url}`, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: Object.keys(FLOORS) });
        const { lhr } = result;
        if (lhr.runtimeError) findings.fail(`${url}: Lighthouse error ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
        const robots = lhr.audits["robots-txt"];
        const blockedByPolicy = robots && robots.score === 0 && /CSP violation/u.test(robots.explanation ?? "");
        if (blockedByPolicy) notes.add("robots-txt: Lighthouse's fetch was blocked by the page's Content-Security-Policy; SEO scored without that audit");
        for (const key of Object.keys(FLOORS)) {
          let score = lhr.categories[key]?.score ?? 0;
          if (key === "seo" && blockedByPolicy) {
            const references = lhr.categories.seo.auditRefs.filter((reference) => reference.id !== "robots-txt" && reference.weight > 0 && lhr.audits[reference.id].score !== null);
            const weight = references.reduce((sum, reference) => sum + reference.weight, 0);
            score = references.reduce((sum, reference) => sum + reference.weight * lhr.audits[reference.id].score, 0) / weight;
          }
          scores[key].push(Math.round(score * 100));
          for (const reference of lhr.categories[key]?.auditRefs ?? []) {
            const audit = lhr.audits[reference.id];
            if (reference.weight > 0 && audit.score !== null && audit.score < 1) failedAudits.add(`${reference.id} ${Math.round(audit.score * 100)}`);
          }
        }
      }
      const medians = Object.fromEntries(Object.entries(scores).map(([key, values]) => [key, median(values)]));
      log(`  ${url}: ${Object.entries(medians).map(([key, value]) => `${key} ${value}`).join(", ")}${failedAudits.size ? ` (below 100: ${[...failedAudits].join(", ")})` : ""}${notes.size ? `; ${[...notes].join("; ")}` : ""}`);
      for (const [key, floor] of Object.entries(FLOORS)) {
        if (key === "seo" && url === "/404.html") continue;
        if (medians[key] < floor) findings.fail(`${url}: ${key} ${medians[key]}, under the floor of ${floor}`);
      }
    }
    findings.note(`${urls.length} pages, ${runs} runs each, median scored`);
  } finally {
    await chrome.close();
    await server.close();
  }
  return findings;
}

export async function main(directory = "_site", runs = 3) {
  (await checkLighthouse(directory, { runs })).report();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runsIndex = process.argv.indexOf("--runs");
  await main(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "_site", runsIndex > 0 ? Number(process.argv[runsIndex + 1]) : 3);
}
