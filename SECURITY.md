# Security

Please do not open a public issue that contains vulnerability details.

## Supported versions

The published 1.0.0 release started the 1.x root-package compatibility line, and 2.0.0 started the 2.x line. The current release is **2.16.0**, published on November 7, 2026 (see [CHANGELOG.md](CHANGELOG.md)).

Security fixes target the current maintained development and release line. Do not assume that older 1.x releases, snapshots or pre-1.0 releases will receive fixes.

Node runtime support follows [NODE_SUPPORT.md](NODE_SUPPORT.md): maintained LTS lines plus Current. Older and end-of-life runtimes are not tested.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting ("Report a vulnerability" on the repository's Security tab) when it is available.

The repository is public. This policy is only complete once private vulnerability reporting is enabled. As of October 11, 2026 it is not yet enabled. If that entry point is unavailable, contact the repository owner privately before you disclose exploit details.

Where relevant, please include:

- the affected commit, package version or API version;
- reproduction steps or a minimal proof of concept;
- the impact and any preconditions;
- which part is affected: the browser-safe root package, the repository-local POC (proof-of-concept) API tooling, development tooling, or the supply chain.

## Security boundaries

The root `@photivra/engine` package is a calculation library. CI checks its browser-facing dependency graph, so Node-only modules and the POC HTTP transport cannot become reachable through the root export.

The repository-local `src/api` code is a separate, Node-only proof-of-concept development server. The published `@photivra/engine` package does not export or include it. Note that:

- it has no authentication;
- it binds to loopback (localhost) by default;
- it is not a production hosting recommendation;
- CORS is a browser policy, not authentication or authorization;
- exposing it on a non-loopback interface needs separate production-grade protection, which this repository does not provide.

## Release and publishing controls

The npm release workflow keeps the npm publishing identity away from verification and build tooling:

- Release tags must be protected, match the package version, and point at the current `main` commit.
- GitHub must report the `main` branch as protected before a publish is allowed.
- Verification, coverage, build and package creation run in a job without `id-token: write`.
- Only the small final publish job gets OIDC permission.
- The verified tarball moves between jobs as a short-lived Actions artifact. Its SHA-256 is checked before publication.
- GitHub Actions are pinned to immutable commit SHAs.
- Checkout credentials are not kept for later CI steps.
- Dependency installation uses the lockfile and `--ignore-scripts`.
- The public package has no runtime npm dependencies.

Repository administrators must keep release tags and the default branch protected. The publish workflow fails closed if either protection is missing.

For the strongest npm setup, also:

- use a protected GitHub deployment environment in the npm trusted-publisher configuration; and
- disable traditional token-based publishing once trusted publishing is verified.

## Development rules

- Never commit credentials, API keys, tokens, private keys, private datasets or proprietary calibration material.
- Keep runtime dependencies minimal. The root package currently has no runtime npm dependencies.
- Dependencies, models, data, and copied or adapted material need an explicit licence and provenance review before adoption.
- Treat material findings about dependencies, secrets, the supply chain, unsafe transport or the browser boundary as release blockers.
