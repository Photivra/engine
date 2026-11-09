# Photivra organization Node.js support policy

Adopted: 2026-09-26.

This policy applies to every Node.js repository in the Photivra organization. It covers contributor tooling, CI, build and deployment tooling, and supported Node.js execution environments. It does not change browser support or the browser-safe engine boundary.

## Maintained LTS plus Current

"Actively maintained LTS" means an official Node.js release line in **Active LTS** or **Maintenance LTS**, before its upstream end-of-life (EOL) date.

Starting with the 1.0.1 candidate, this repository supports:

- every upstream-supported Active LTS and Maintenance LTS line; and
- the official Current release line.

Prerelease and nightly builds, end-of-life lines, and releases that only have commercial extended support are not supported.

Use the official lifecycle as evidence of support. Do not use "latest", an even/odd version rule, or an open-ended minimum version. The official sources are:

- https://nodejs.org/en/about/previous-releases
- https://github.com/nodejs/Release
- https://github.com/nodejs/Release/blob/main/schedule.json

Snapshot, reverified against the official schedule on 2026-10-02 (original policy review 2026-09-26):

- Node 24 is Active LTS.
- Node 22 is Maintenance LTS.
- Node 26 is Current and is in the support set.

This is a dated snapshot. Review and test future lines as the official lifecycle changes. Node 26 stays supported when it enters LTS; from that date its runtime must carry the LTS marker, after the grace period described under "CI and dependency enforcement".

## Repository baselines

An upstream line being eligible does not mean this repository has tested it. The repository must record and test every line the policy covers. Use the newest tested Active LTS line for normal development and builds. Keep a tested Maintenance LTS line where compatibility is already supported.

This repository tests Node 22, 24 and 26. That includes the current patched release of each line and a regression job on the Node 22.13.0 minimum.

CI picks the patched lines with setup-node aliases that move by themselves:

| Alias | Line | Role |
| --- | --- | --- |
| `lts/*` | newest LTS | Primary leg. Also runs the static, coverage, documentation and package-surface gates. |
| `lts/-1` | the LTS line before it | Test leg. |
| `node` | newest stable release (Current, or the newest LTS while no Current line has a stable build) | Test leg. |

CI resolves `node` itself to the newest stable version in `https://nodejs.org/dist/index.json` (`.github/node-lts-lookahead.mjs --newest-stable`), because setup-node's alias takes the index's first entry, which can be a prerelease: `v27.0.0-alpha.0.0.0` was listed first on 2026-10-29 and every `node` job failed the guard with "Use a stable, exact Node/typings version" ([#511](https://github.com/photivra/photivra/pull/511)).

Every leg runs the test suite and the packed-consumer acceptance check.

- The minimum-version leg matches `engines.node`. It rises when that line reaches end of life.
- The policy guard runs before installation. If an alias moves to an unreviewed or end-of-life major, CI fails instead of adopting it. An alias cannot silently widen the support set.
- When Node 26 enters LTS (2026-10-28), `lts/-1` moves to 24. Node 22 then stays covered by the minimum-version leg until its end of life.
- Release publication (`publish.yml`) stays pinned to tooling major 24, so the release toolchain changes only through review.
- The normal tooling baseline and the pinned `@types/node` major remain **24**.

Use current patched releases for ordinary development and deployment. The historical minimum-version regression job is not a deployment recommendation.

Code that must run on Node 22 must not assume Node 24-only APIs just because contributor tooling uses Node 24 typings. Keep the Node 22 runtime tests and the public browser-safe package boundary.

A broad `engines.node` range is a compatibility hint. It is not evidence of support for untested or EOL lines. Any change to the manifest range must update the lockfile and go through package compatibility and release review. This policy does not rewrite packages that are already published.

## CI and dependency enforcement

`.github/node-lts-policy.mjs` runs before dependency installation. It checks:

- the actual Node build's LTS marker;
- this repository's approved set of majors;
- reviewed upstream LTS and Current date windows;
- the approved pinned typings major.

`.github/test-node-lts-policy.mjs` tests the acceptance and rejection boundaries, the grace period and the look-ahead against recorded release data. Both scripts run before dependency installation in every Node CI job. That includes each verification matrix leg and the `native-performance.yml` benchmark job (path-filtered and nightly).

`.github/node-ci-roles.mjs` derives the CI roles from the same snapshot: the exact `engines.node` minimum, the maintained LTS majors, the Current major, the primary leg (`lts/*`) and the tooling major. The `change scope` job checks the files against them on every pull request and merge-queue entry, so the matrix cannot drift from the policy unnoticed. It fails when the `test` and `verify` lines differ, when an exact-version leg is not the `engines.node` minimum, when the primary jobs or `publish.yml` leave their roles, when the alias table above differs from the matrix, or when a supported line has no leg. It reports two legs on one runtime, a primary leg off the tooling major and a line tested only at its minimum as notices for review. `.github/test-node-ci-roles.mjs` tests it on the repository's files across the lifecycle transitions.

The lifecycle snapshot is local and reviewed. Ordinary CI does not fetch it from the network. It uses UTC dates and fails closed on the recorded end-of-life date.

Reverify the official schedule:

- before changing the snapshot;
- before a baseline or release decision;
- during regular dependency maintenance.

Do not extend an expired window, or admit an unreviewed line, just to pass CI. The Current window ends when the line enters LTS; from then the runtime must carry an LTS marker. A new Current line needs a coordinated review of the snapshot and the CI matrix.

### LTS marker grace period

An LTS window opens at 00:00 UTC on the scheduled date, but Node publishes the line's first LTS build during that day, and setup-node can offer it only after that. In `https://nodejs.org/dist/index.json`, the first LTS build of every line from Node 4 to Node 24 is dated on its scheduled LTS date: 11 of 11 lines, none late. Node 26 had no LTS build at 02:48 UTC on 2026-10-28, its LTS date, so every job on the `node` alias failed with "An LTS Node build must carry its LTS marker."

For **7 days** from a line's LTS start, the guard therefore accepts a build of that line without the LTS marker. Seven days is a margin over that record, enough for a release that slips by a week. It is not a measured delay. After the grace period the marker is required again. The grace period changes nothing else:

- A Current build in its Current window still must not claim an LTS marker.
- Other majors, prereleases and end-of-life dates are checked as before.
- A build that carries the LTS marker passes as before.

### Checking ahead

No scheduled job checks the policy ahead of time; the guard in every CI job is the check, so a date boundary first shows as a failing required check on the first run after it. To see a boundary coming, for example before a release, run `node .github/node-lts-lookahead.mjs`. It fetches `https://nodejs.org/dist/index.json`, takes the newest stable release of each supported major, and runs the policy guard against it at 00:00 UTC on today and each of the next 14 days. A failing date names the major, the first failing date, the build and the reason. Do not widen a window just to clear it.

Routine minor and patch updates within an approved major may follow normal green-PR rules. Do not auto-merge a major upgrade of the Node runtime, a Node image, or `@types/node` on its own. Where Dependabot is configured, keep Node typings major upgrades out of its routine queue, while still allowing updates within supported majors.

## Lifecycle changes

Add a newly supported LTS or Current line in one coordinated review. That review covers the support policy and guard, CI, local version files, build environments, typings, manifest and lockfile compatibility, and tests. Update only files that exist and are relevant. Do not add a new runtime or infrastructure just for uniformity.

Remove a line from the support set and from CI before its upstream EOL, and document what that means for downstream compatibility. Never silently raise a library's minimum runtime, and never advertise an untested line.

All existing scientific, security, provenance, regression, artifact and release gates stay in force. This policy does not authorize npm publication, tags, a public release, or an upgrade of the default runtime major.
