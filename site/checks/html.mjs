// SPDX-License-Identifier: Apache-2.0
// HTML validation of every built page with html-validate (offline, in Node), configured by site/.htmlvalidate.json.
//
//   node site/checks/html.mjs [_site]
import { readFileSync } from "node:fs";
import process from "node:process";
import { HtmlValidate, FileSystemConfigLoader } from "html-validate";
import { Findings, readPages } from "./lib.mjs";

export async function checkHtml(pages, configPath = new URL("../.htmlvalidate.json", import.meta.url)) {
  const findings = new Findings("HTML validation (html.mjs)");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const validator = new HtmlValidate(new FileSystemConfigLoader({ ...config, root: true }));
  let checked = 0;
  for (const page of pages) {
    const report = await validator.validateString(page.html, page.path);
    checked++;
    for (const result of report.results) {
      for (const message of result.messages) findings.fail(`${page.url}:${message.line}:${message.column} ${message.ruleId}: ${message.message}`);
    }
  }
  findings.note(`${checked} pages validated`);
  return findings;
}

export async function main(directory = "_site") {
  (await checkHtml(readPages(directory))).report();
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv[2]);
