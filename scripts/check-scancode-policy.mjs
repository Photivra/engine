// SPDX-License-Identifier: Apache-2.0

// Licence and copyright policy over a ScanCode Toolkit JSON report.
//
// Usage: node scripts/check-scancode-policy.mjs <scancode.json>
//
// The report must come from ScanCode Toolkit 32.5.0 run with --license and
// --copyright (see docs/DEVELOPERS.md, "Licence and copyright scan"). Policy:
//
// - every detected licence (detections and low-confidence clues) must be
//   Apache-2.0;
// - every copyright holder must be William Shackelford or Photivra
//   contributors;
// - no file may have a scan error.
//
// Anything else fails unless the exact file and finding are on the allowlists
// below. An entry names one file and one licence expression (or one holder),
// so a new licence or holder in an allowlisted file still fails. Every entry
// gives its reason. Adding or widening an entry needs the owner's review in the
// pull request. An entry whose file is scanned but no longer has that finding
// also fails, so the lists stay current.

import { readFile } from "node:fs/promises";
import { argv, stdout } from "node:process";
import process from "node:process";

const EXPECTED_TOOL_VERSION = "32.5.0";
const ALLOWED_LICENSE = "Apache-2.0";
const ALLOWED_HOLDERS = new Set(["William Shackelford", "Photivra contributors"]);

const CASTLE = "castleCSF model material under its MIT notice, recorded in THIRD_PARTY.md (Print contrast numerical model material)";
const LICENCE_NAMES_IN_DOCS = "names licences of third-party material in prose (licence review); no licence text is included";
const LOCK_METADATA = "npm dependency licence metadata; dependency licences are gated by scripts/check-license-policy.mjs";
const COLOR_PATCH_SOURCES = "attribution of the reference colors' sRGB hex values in docs/COLOR_PATCHES.md (Result table), recorded in THIRD_PARTY.md (Distinctness check); names the sources' licences, no licence text";
const OWN_ALLOWLIST = "this script's allowlist names this key as data; no licence text";

/** Keys that ScanCode detects in this script's own allowlist strings (scan of this file). */
const OWN_KEYS = [
  "Apache-2.0 OR MIT", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "CC-BY-4.0", "CC-BY-ND-3.0",
  "CC-BY-SA-3.0", "CC-BY-SA-4.0", "CC0-1.0", "CDDL-1.0", "GPL-1.0-or-later", "ISC", "JSON",
  "LGPL-2.1-only", "LicenseRef-scancode-other-copyleft", "LicenseRef-scancode-proprietary-license",
  "LicenseRef-scancode-public-domain", "LicenseRef-scancode-unknown-license-reference", "MIT", "MPL-2.0", "PSF-2.0",
  "LicenseRef-scancode-generic-cla"
];

/** File plus licence expression (SPDX form as ScanCode reports it). */
const LICENSE_ALLOWLIST = [
  // castleCSF (MIT): notice, licence copy, adapter, generator and its evidence/docs.
  { path: "NOTICE", license: "MIT", reason: `${CASTLE}; NOTICE retains the required MIT notice` },
  { path: "docs/licenses/castleCSF-MIT.txt", license: "MIT", reason: `${CASTLE}; exact upstream licence copy` },
  { path: "src/output/print-contrast-reference.ts", license: "MIT", reason: `${CASTLE}; adapter source keeps the notice reference` },
  { path: "test/fixtures/print-detail/generate_contrast_reference.py", license: "MIT", reason: `${CASTLE}; reference generator keeps the notice reference` },
  { path: "docs/PRINT_CONTRAST_REFERENCE.md", license: "MIT", reason: `${CASTLE}; model protocol states the licence` },
  { path: "docs/PRINT_195_196_REVIEW.md", license: "MIT", reason: `${CASTLE}; review links the licence copy` },
  { path: "docs/PRINT_196_ENGINE_ACCEPTANCE.md", license: "MIT", reason: `${CASTLE}; acceptance record states the licence` },
  { path: "docs/api/output-print-contrast-reference.md", license: "MIT", reason: `${CASTLE}; generated API page from the adapter's JSDoc` },
  { path: "docs/validation/print-196-candidate-evidence.json", license: "MIT", reason: `${CASTLE}; evidence record field "license"` },

  // Developer Certificate of Origin.
  { path: "DCO", license: "LicenseRef-scancode-dco-1.1", reason: "verbatim Developer Certificate of Origin 1.1 used for sign-off" },
  { path: "CONTRIBUTING.md", license: "LicenseRef-scancode-free-unknown", reason: "clue on the DCO sign-off paragraph; no licence text" },

  // Contributor licence agreement policy (CONTRIBUTING.md, "Licensing of contributions"): the policy names the
  // agreement and "other licence terms"; the CLA text itself is not in the repository yet.
  { path: "CONTRIBUTING.md", license: "LicenseRef-scancode-generic-cla", reason: "names the contributor licence agreement rule; no agreement text" },
  { path: "CONTRIBUTING.md", license: "LicenseRef-scancode-unknown", reason: "clue on \"other licence terms as well as Apache-2.0\" in the policy; no licence text" },
  { path: "AGENTS.md", license: "LicenseRef-scancode-generic-cla", reason: "names the contributor licence agreement rule; no agreement text" },
  { path: "README.md", license: "LicenseRef-scancode-generic-cla", reason: "names the contributor licence agreement rule; no agreement text" },

  // Licence names mentioned in documentation and comments.
  { path: "README.md", license: "LicenseRef-scancode-unknown-license-reference", reason: "\"See LICENSE\" link to the project's Apache-2.0 licence" },
  { path: "CHANGELOG.md", license: "CC-BY-4.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "CHANGELOG.md", license: "MIT", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "Apache-2.0 OR MIT", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "BSD-2-Clause", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "BSD-3-Clause", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "CC-BY-ND-3.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "CC-BY-SA-3.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "CC-BY-SA-4.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "CC0-1.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "CDDL-1.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "GPL-1.0-or-later", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "LGPL-2.1-only", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "LicenseRef-scancode-other-copyleft", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "LicenseRef-scancode-proprietary-license", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "LicenseRef-scancode-public-domain", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "LicenseRef-scancode-unknown-license-reference", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "MIT", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "MIT AND BSD-2-Clause", reason: LICENCE_NAMES_IN_DOCS },
  { path: "THIRD_PARTY.md", license: "MPL-2.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/COLOR_PATCHES.md", license: "BSD-3-Clause", reason: COLOR_PATCH_SOURCES },
  { path: "docs/COLOR_PATCHES.md", license: "CC-BY-SA-4.0", reason: COLOR_PATCH_SOURCES },
  { path: "docs/COLOR_PATCHES.md", license: "CC0-1.0", reason: COLOR_PATCH_SOURCES },
  { path: "docs/COLOR_PATCHES.md", license: "LicenseRef-scancode-public-domain", reason: COLOR_PATCH_SOURCES },
  { path: "docs/COLOR_PATCHES.md", license: "LicenseRef-scancode-unknown-license-reference", reason: COLOR_PATCH_SOURCES },
  { path: "docs/COLORIMETRY.md", license: "CC-BY-ND-3.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/COLORIMETRY.md", license: "CC-BY-SA-4.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/COLORIMETRY.md", license: "LicenseRef-scancode-other-copyleft", reason: `${LICENCE_NAMES_IN_DOCS} ("ShareAlike")` },
  { path: "docs/COLORIMETRY.md", license: "LicenseRef-scancode-proprietary-license", reason: `${LICENCE_NAMES_IN_DOCS} (free-source note)` },
  { path: "docs/RELEASE_2_0_0.md", license: "BSD-2-Clause", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "BSD-3-Clause", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "CC-BY-4.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "CC-BY-ND-3.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "CC-BY-SA-4.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "LicenseRef-scancode-other-copyleft", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "LicenseRef-scancode-public-domain", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "LicenseRef-scancode-unknown-license-reference", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "MPL-2.0", reason: LICENCE_NAMES_IN_DOCS },
  { path: "docs/RELEASE_2_0_0.md", license: "PSF-2.0", reason: "false positive: the words \"PSF\" and \"2.0\" (point-spread function, release 2.0)" },
  { path: "docs/USAGE.md", license: "CC-BY-SA-4.0", reason: `${LICENCE_NAMES_IN_DOCS} (CIE datasets are caller-supplied)` },
  { path: "docs/PROVENANCE.md", license: "LicenseRef-scancode-unknown-license-reference", reason: "reuse-rights rules name licence categories; no licence text" },
  { path: "docs/PROVENANCE.md", license: "LicenseRef-scancode-public-domain", reason: "reuse-rights rules name licence categories; no licence text" },
  { path: "docs/PROVENANCE.md", license: "LicenseRef-scancode-proprietary-license", reason: "reuse-rights rules name licence categories; no licence text" },
  { path: "docs/licenses/adobe-dng-patent-license-record.txt", license: "LicenseRef-scancode-proprietary-license", reason: "Adobe DNG patent licence retrieval record (summary, not a copy); see THIRD_PARTY.md" },
  { path: "docs/licenses/adobe-dng-patent-license-record.txt", license: "LicenseRef-scancode-warranty-disclaimer", reason: "Adobe DNG patent licence retrieval record (summary, not a copy); see THIRD_PARTY.md" },
  { path: "scripts/fit-cie-1931-cmf.mjs", license: "CC-BY-SA-4.0", reason: "names the CIE dataset licence; the table is fetched at fit time only and never stored" },
  { path: "src/color/color-matching-functions.ts", license: "CC-BY-SA-4.0", reason: "comment explains the CIE tables are not bundled because of this licence" },
  { path: "src/color/illuminants.ts", license: "CC-BY-SA-4.0", reason: "comment explains the CIE basis is not bundled because of this licence" },
  { path: "src/sensor/stochastic-seed.ts", license: "LicenseRef-scancode-public-domain", reason: "comment cites MurmurHash3 as public domain; no code copied" },
  { path: "test/sensor-raw-noise-independence.test.ts", license: "LicenseRef-scancode-public-domain", reason: "comment cites MurmurHash3 as public domain; no code copied" },
  { path: "src/optics/complex-pupil-psf.ts", license: "PSF-2.0", reason: "false positive: the identifier \"psf\" next to a \"2.0\" version string" },

  // Test data that exercises licence labels.
  { path: "test/print-detail.test.ts", license: "CC0-1.0", reason: "licence label used as test data for provenance validation" },
  { path: "test/sensor-architecture.test.ts", license: "CC-BY-4.0", reason: "licence label used as test data for provenance validation" },
  { path: "test/sensor-architecture.test.ts", license: "CC0-1.0", reason: "licence label used as test data for provenance validation" },

  // Dependency metadata and the dependency licence gate.
  { path: "package-lock.json", license: "BSD-2-Clause", reason: LOCK_METADATA },
  { path: "package-lock.json", license: "BSD-3-Clause", reason: LOCK_METADATA },
  { path: "package-lock.json", license: "BlueOak-1.0.0", reason: LOCK_METADATA },
  { path: "package-lock.json", license: "ISC", reason: LOCK_METADATA },
  { path: "package-lock.json", license: "MIT", reason: LOCK_METADATA },
  { path: "package-lock.json", license: "MPL-2.0", reason: LOCK_METADATA },
  { path: "scripts/check-license-policy.mjs", license: "Apache-2.0 OR MIT", reason: "dependency licence gate lists the allowed keys" },
  { path: "scripts/check-license-policy.mjs", license: "MIT AND BSD-2-Clause", reason: "dependency licence gate lists the allowed keys" },
  { path: "scripts/check-license-policy.mjs", license: "BSD-3-Clause", reason: "dependency licence gate lists the allowed keys" },
  { path: "scripts/check-license-policy.mjs", license: "MPL-2.0", reason: "dependency licence gate lists the allowed keys" },

  // This script: its allowlist data names these keys.
  ...OWN_KEYS.map((license) => ({ path: "scripts/check-scancode-policy.mjs", license, reason: OWN_ALLOWLIST }))
];

/** File plus copyright holder as ScanCode reports it. */
const HOLDER_ALLOWLIST = [
  { path: "DCO", holder: "The Linux Foundation and its contributors", reason: "verbatim Developer Certificate of Origin 1.1" },
  { path: "NOTICE", holder: "Graphics and Displays group - University of Cambridge", reason: CASTLE },
  { path: "THIRD_PARTY.md", holder: "Graphics and Displays group - University of Cambridge", reason: CASTLE },
  { path: "docs/licenses/castleCSF-MIT.txt", holder: "Graphics and Displays group - University of Cambridge", reason: CASTLE },
  { path: "src/output/print-contrast-reference.ts", holder: "Graphics and Displays group - University of Cambridge", reason: CASTLE },
  { path: "test/fixtures/print-detail/generate_contrast_reference.py", holder: "Graphics and Displays group - University of Cambridge", reason: CASTLE },
  { path: "docs/PRINT_CONTRAST_REFERENCE.md", holder: "Graphics and Displays group, University of Cambridge. Keep", reason: CASTLE },
  { path: "THIRD_PARTY.md", holder: "ReportLab Inc", reason: "records the copyright holder of an offline PDF test-artifact tool (ReportLab/pypdf); the tool is not distributed" },
  { path: "THIRD_PARTY.md", holder: "Mathieu Fenniak", reason: "records the copyright holder of an offline PDF test-artifact tool (ReportLab/pypdf); the tool is not distributed" },
  { path: "THIRD_PARTY.md", holder: "Ashish Kulkarni and Steve Witham", reason: "records the copyright holder of an offline PDF test-artifact tool (ReportLab/pypdf); the tool is not distributed" },
  { path: "docs/COLOR_PATCHES.md", holder: "Colour Developers", reason: COLOR_PATCH_SOURCES },
  { path: "docs/RELEASE_2_0_0.md", holder: "work Wyant & Creath Rump", reason: "false positive: prose about a copyrighted textbook that is cited, not copied" }
];

function fail(message) {
  process.stderr.write(`ScanCode policy failed: ${message}\n`);
  process.exit(1);
}

const reportPath = argv[2];
if (reportPath === undefined) {
  fail("usage: node scripts/check-scancode-policy.mjs <scancode.json>");
}

let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  fail(`cannot read ${reportPath}: ${error instanceof Error ? error.message : String(error)}`);
}

const header = Array.isArray(report?.headers) ? report.headers[0] : undefined;
if (header === undefined || !Array.isArray(report.files)) {
  fail("the report has no ScanCode headers or files");
}
if (header.tool_version !== EXPECTED_TOOL_VERSION) {
  fail(`expected ScanCode Toolkit ${EXPECTED_TOOL_VERSION}, got ${String(header.tool_version)}`);
}
const options = header.options ?? {};
if (options["--license"] !== true || options["--copyright"] !== true) {
  fail("the scan must be run with --license and --copyright");
}
if (options["--full-root"] === true) {
  fail("scan without --full-root");
}
const stripRoot = options["--strip-root"] === true;

/** Repository-relative path: ScanCode prefixes the input directory name unless --strip-root is set. */
function repositoryPath(scanPath) {
  if (stripRoot) {
    return scanPath;
  }
  const slash = scanPath.indexOf("/");
  return slash === -1 ? scanPath : scanPath.slice(slash + 1);
}

const licenseFindings = [];
const holderFindings = [];
const scanErrors = [];
let fileCount = 0;
const scannedPaths = new Set();

for (const entry of report.files) {
  if (entry?.type !== "file") {
    continue;
  }
  fileCount += 1;
  const path = repositoryPath(String(entry.path));
  scannedPaths.add(path);

  for (const error of entry.scan_errors ?? []) {
    scanErrors.push(`${path}: ${String(error).split("\n")[0]}`);
  }

  const matches = [
    ...(entry.license_detections ?? []).flatMap((detection) => detection.matches ?? []),
    ...(entry.license_clues ?? [])
  ];
  for (const match of matches) {
    const license = match.license_expression_spdx ?? match.license_expression;
    if (license !== ALLOWED_LICENSE) {
      licenseFindings.push({ path, license: String(license), line: match.start_line });
    }
  }

  const holders = entry.holders ?? [];
  for (const record of holders) {
    if (!ALLOWED_HOLDERS.has(record.holder)) {
      holderFindings.push({ path, holder: String(record.holder), line: record.start_line });
    }
  }
  // A copyright statement with no detected holder is checked on its text.
  for (const statement of entry.copyrights ?? []) {
    const hasHolder = holders.some((record) => record.start_line >= statement.start_line && record.start_line <= statement.end_line);
    const text = String(statement.copyright);
    if (!hasHolder && ![...ALLOWED_HOLDERS].some((name) => text.includes(name))) {
      holderFindings.push({ path, holder: text, line: statement.start_line });
    }
  }
}

if (fileCount === 0) {
  fail("the report lists no files");
}

const usedLicenseEntries = new Set();
const usedHolderEntries = new Set();
const violations = [];

for (const finding of licenseFindings) {
  const index = LICENSE_ALLOWLIST.findIndex((item) => item.path === finding.path && item.license === finding.license);
  if (index === -1) {
    violations.push(`${finding.path}:${finding.line}: licence ${finding.license} is not Apache-2.0 and is not allowlisted`);
  } else {
    usedLicenseEntries.add(index);
  }
}
for (const finding of holderFindings) {
  const index = HOLDER_ALLOWLIST.findIndex((item) => item.path === finding.path && item.holder === finding.holder);
  if (index === -1) {
    violations.push(`${finding.path}:${finding.line}: copyright holder "${finding.holder}" is not allowed and is not allowlisted`);
  } else {
    usedHolderEntries.add(index);
  }
}
for (const error of scanErrors) {
  violations.push(`scan error in ${error}`);
}
// An entry whose file is in the scan but no longer has that finding is stale and
// fails. An entry whose file is not in the scan (an older or partial scan) only
// warns.
const absentEntries = [];
function checkUnused(list, used, describe) {
  list.forEach((item, index) => {
    if (used.has(index)) {
      return;
    }
    if (scannedPaths.has(item.path)) {
      violations.push(`stale allowlist entry: ${item.path} ${describe(item)} no longer matches; remove it`);
    } else {
      absentEntries.push(`${item.path} ${describe(item)}`);
    }
  });
}
checkUnused(LICENSE_ALLOWLIST, usedLicenseEntries, (item) => `licence ${item.license}`);
checkUnused(HOLDER_ALLOWLIST, usedHolderEntries, (item) => `holder "${item.holder}"`);

if (violations.length > 0) {
  fail(["", ...violations.map((violation) => `- ${violation}`)].join("\n"));
}

if (absentEntries.length > 0) {
  const lines = absentEntries.map((item) => `- ${item}`).join("\n");
  stdout.write(`Warning: ${absentEntries.length} allowlist entries name files that are not in this scan:\n${lines}\n`);
}
stdout.write(
  `ScanCode policy passed: ${fileCount} files; ${licenseFindings.length} licence and ${holderFindings.length} copyright findings, all on the reviewed allowlists (${LICENSE_ALLOWLIST.length} licence and ${HOLDER_ALLOWLIST.length} holder entries).\n`
);
