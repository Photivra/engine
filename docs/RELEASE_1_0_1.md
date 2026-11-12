# 1.0.1 release preparation and migration

**Candidate distribution and root API:** `@photivra/engine@1.0.1` and `ENGINE_API_VERSION = "1.0.1"`. The published predecessor is [1.0.0](https://github.com/Photivra/engine/releases/tag/v1.0.0), whose root API identity was 0.116.0. This change prepares the next release; 1.0.1 installation becomes available only after owner publication.

## Changes

- Support all upstream-supported Active LTS and Maintenance LTS Node.js lines plus Current. The reviewed 2026-10-02 set is maintained Node 22 (minimum 22.13), maintained Node 24 and Node 26 Current.
- Test patched 22/24/26 and minimum 22.13.0 in CI. Every matrix job runs lifecycle checks, locked installation, static/scientific tests, build, documentation, isolated packed consumers and package checks. Node 24 also runs coverage and the informational benchmark.
- Align the full package and root API version at 1.0.1. Automated checks prevent drift between source, package/lock/citation metadata, generated reference and the real packed consumer.

The preferred build/development baseline and pinned Node typings remain 24. The manifest minimum remains >=22.13.0; this broad range is not a qualification of unknown or EOL majors. Use current patches in ordinary development. See [the runtime policy](../NODE_SUPPORT.md) for Current-to-LTS and EOL boundaries, snapshot review and future-major maintenance.

## Migration and preserved contracts

No exported operation shape, scientific equation, default, seed schedule, dependency or accepted processing envelope changes. Schema/model/POC/production-plan contracts retain their independent versions; POC remains 0.20.0 and the production plan remains 0.7.0.

Starting with this release, `ENGINE_API_VERSION` identifies the same release as the npm package. Consumers that compared it with the literal 0.116.0 must update that comparison or use the exported constant. Do not equate this root release identity with an independent schema/model version.

Newly created captures and plans record creator root API 1.0.1. That metadata can change serialized bytes, plan fingerprints and capture/export identity hashes even when scientific values are equal. Archive parsers retain the creator identity recorded by earlier releases; they do not relabel an existing capture as 1.0.1. Historical fixtures, checksums, benchmark reports and introduction-time versions remain historical evidence. Any deliberate recomputation must create new artifacts with their actual creator/version identity.

The bounded V1 capabilities and scientific limitations are unchanged. See [developer navigation](DEVELOPERS.md), [the original 1.0 release contract](RELEASE_1_0.md), and each domain's current guidance. Node compatibility does not establish calibrated physics, browser performance or megapixel processing.

## Candidate validation

Use patched Node 24 for ordinary release preparation, then require green CI for all supported majors:

```sh
npm ci --ignore-scripts
node --test .github/test-node-lts-policy.mjs
node .github/node-lts-policy.mjs
npm run check
npm run coverage
npm run build
npm run docs:check
npm run release:consumer-check
npm run pack:check
npm run bench:image-formation:built
```

The exact submitted commit and CI outcome are recorded in the review PR. The known unchanged-main Mac `equivalence-38` hash difference remains explicit; Linux CI is the full-suite authority. No golden/assertion or scientific tolerance is relaxed for this release.

## Owner release procedure

After substantive human review, contribution-specific DCO certification and merge of the tested candidate, require green final-main CI and verify that its tree matches the approved candidate. Confirm npm trusted publishing and protected main/tag rules remain configured. This preparation performs no tag, npm publication or GitHub release.

From a clean owner checkout, replace `FINAL_MAIN_SHA` with that verified merged commit:

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "FINAL_MAIN_SHA"
test "$(git rev-parse origin/main)" = "FINAL_MAIN_SHA"
test "$(node -p "require('./package.json').version")" = "1.0.1"
git tag -a v1.0.1 FINAL_MAIN_SHA -m "Photivra engine 1.0.1"
git push origin refs/tags/v1.0.1
```

The tag push starts the existing protected publish workflow. Its verification job uses Node 24 and the Node support guard before dependency installation, checks tag/version/current-main identity and all existing release gates, and creates the verified tarball. The separate OIDC publication job checks that artifact's SHA-256 and publishes only if the exact version is absent. Do not change the published 1.0.0 release or move an existing protected tag.

Watch the workflow to completion, verify public npm exposes 1.0.1 and record tarball integrity, then create the GitHub release at v1.0.1 using the final commit and check evidence. Report any failure and investigate rather than bypassing a gate.
