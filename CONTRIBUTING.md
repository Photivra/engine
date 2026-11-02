# Contributing

Contributions are welcome. They must keep scientific integrity, source provenance, API consistency and the Apache-2.0 licensing boundary intact, and outside
contributions follow [Licensing of contributions](#licensing-of-contributions).

## Development setup

Use a supported Node.js release: maintained 22 (minimum 22.13), maintained 24, or 26 Current. Patched Node 24 is preferred for development and build tooling.

The reproducible npm path is:

```sh
npm ci
npm run check
npm run coverage
npm run build
npm run pack:check
```

What CI tests:

- The newest maintained LTS lines plus the newest Current release, through moving setup-node aliases (`lts/-1`, `lts/*`, `node`; today 22, 24 and 26).
- The `engines.node` minimum, 22.13.0. The minimum rises when its line reaches end of life.

See [the runtime policy](NODE_SUPPORT.md) and [1.0.1 migration and release preparation](docs/RELEASE_1_0_1.md).

For release preparation, also run `npm run docs:check` and `npm run release:consumer-check` after the build. The generated API reference must match the root exports. When public contracts change, regenerate it with `node scripts/generate-api-reference.mjs`.

### Git hooks

Run `npm run hooks:install` once per checkout. (From 2.0.0 the published manifest has no `prepare` or other lifecycle script, so this is not automatic.)

It points this checkout's Git hooks at `.githooks`. The `pre-push` hook runs `npm run prepush`: lint, typecheck, licence, SPDX-header, identity, browser-surface and generated-docs gates. It reports every failure at the end.

- It leaves an existing custom `core.hooksPath` unchanged.
- `git push --no-verify` skips it once.
- The test suite, coverage, build and package checks are still the commands above, plus CI.

### What runs where in CI

CI runs the static, coverage, documentation and package-surface gates once, on the primary `lts/*` leg. Every Node leg runs the test suite and the packed-consumer acceptance check.

Benchmark and browser-native profiling evidence runs in `native-performance.yml`: when its measured source or scripts change, nightly, and on manual dispatch.

### Preparing a release candidate

To align a release candidate's version numbers, run `npm run release:prepare -- <major.minor.patch>`. It:

- updates `package.json` and the lockfile root, `ENGINE_API_VERSION`, `CITATION.cff`, and the current-release mentions in `README.md` and `docs/DEVELOPERS.md`;
- then regenerates `docs/api`.

It never changes `POC_SIMULATION_API_VERSION` or any schema or model version, and it never tags or publishes. The changelog, release record and publication dates stay manual.

Tests derive the expected engine version from `package.json` and `ENGINE_API_VERSION`, so a version bump needs no test edits.

## Before submitting

- Follow [docs/API_STYLE.md](docs/API_STYLE.md).
- Follow [docs/NUMERICAL_CORRECTNESS.md](docs/NUMERICAL_CORRECTNESS.md).
- Follow [docs/PROVENANCE.md](docs/PROVENANCE.md).
- Add meaningful analytical or regression tests.
- Update the documentation, briefly, when behaviour, assumptions, limitations, schemas, version numbers or public APIs change.
- Keep the published package browser-safe. Node-only transport code is repository-only contributor tooling and must not become a public package export.
- Keep the npm package version and `ENGINE_API_VERSION` equal. Keep `POC_SIMULATION_API_VERSION` and schema and model versions independent.
- For sensor and capture work, preserve native coordinate conventions, the separation between active capture and output crop, optical-axis offsets, and independent X/Y sampling.
- For provenance and calibration work, keep where evidence came from separate from the right to reuse it. Never treat geometric sample pitch as photon-collection area.
- Do not submit copied or adapted third-party code or data unless its licence and provenance are explicitly compatible and recorded.
- If generative tools helped with code or prose, you remain responsible for originality, licensing, scientific accuracy, confidentiality and substantive human review.
- An AI system's statement that material is original, copyrightable, unpatented or licence-compatible is not legal evidence. Do not rely on it.

## Sensor/capture contribution checklist

Changes to sensor, capture, output or radiometry code should answer each question:

- Which coordinate space does each point, vector and rectangle use?
- Does the change keep native top-left / +X right / +Y down semantics?
- Are physical active capture and digital/output crop still separate?
- Does an off-center crop keep the optical-axis position?
- Are X/Y sampling differences preserved, or deliberately rejected?
- Does output resampling keep geometry unchanged unless an explicit transform says otherwise?
- Is physical focal length kept separate from diagonal-based 35 mm equivalence?
- Are unknown sensor facts left unknown instead of guessed?
- Is every evidence record legally usable in the way it is consumed?
- Is every approximate representation still labelled as an approximation?
- Could a radiometry change enable photon or noise claims without passing the readiness gate and without defensible calibration?

## Licensing of contributions

The engine has one copyright holder, Shackelford Creative, LLC (see `NOTICE`). Keeping it that way keeps open the
option of offering the engine under other licence terms as well as Apache-2.0. That option is lost the moment a
contribution by anyone else is merged without a grant covering it, so:

- **A contribution from anyone other than the owner is merged only after that contributor has signed the
  project's contributor licence agreement (CLA).** The CLA will let the contributor keep their copyright and
  grant the owner the right to license the contribution under any terms, including the Apache-2.0 release and
  any other licence the owner offers.
- **The CLA text is not published yet.** Until it is (as `CLA.md`, after legal review), outside pull requests
  are reviewed and discussed but not merged. Pull requests from the owner, and work by agents acting for the
  owner under the owner's sign-off, are not affected.
- **No CLA is needed** for issues, bug reports, reviews, discussion, or documentation fixes small enough to carry
  no copyright (a typo, a broken link).
- The CLA is in addition to the Developer Certificate of Origin below, not a replacement for it.

## Contributor certification

Contributions are made under the [Developer Certificate of Origin 1.1](DCO).

Every commit meant for inclusion should carry a `Signed-off-by` line. The simplest way is:

```sh
git commit -s
```

By signing off, you certify the DCO for that contribution. That includes your right to submit it under the project's open-source licence, and your acceptance that the contribution record is public and kept indefinitely.

## Scientific changes

A pull request that changes calculations should include:

- the equation or model being added or changed;
- assumptions, coordinate conventions and units;
- provenance and references;
- analytical or independently reproducible test cases;
- any change in numerical behaviour;
- uncertainty and approximation notes where relevant;
- the compatibility impact on the root engine API and/or the composed POC simulation API, if any;
- coordinate-system and invariance tests for geometry changes;
- for sensor and radiometry changes: the evidence, reuse rights, calibration or approximation status, and how uncertainty and limitations are handled.

Critical scientific regressions and unsupported scientific claims block a release.
