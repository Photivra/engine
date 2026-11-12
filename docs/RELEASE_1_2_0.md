# 1.2.0 candidate review and migration

The additive package/root candidate is `@photivra/engine@1.2.0`. npm registry verification on 2026-10-03 found published 1.1.0 as the baseline; 1.2.0 was absent. This change prepares an unused minor release, without moving an existing tag or overwriting a distribution. Review the [native SDR contract](NATIVE_CAPTURE_SDR.md) and [validation evidence](NATIVE_CAPTURE_SDR_VALIDATION.md).

## Compatibility

Existing public APIs, small inline reference guards and scientific equations remain unchanged. The new metadata-only tiled executor supports explicitly resolved external linear-sRGB/D65 masters up to 24 MP, with bounded tile storage and single-transfer 8/16-bit output. It is not general scalable XYZ/WB/RAW/correction/resampling/JPEG execution. It does not activate production-plan stages, qualify producers/devices or complete Print quality acceptance. Existing post-1.1.0 bounded regional Print diagnostic work on main retains its stated limits and separate #196 qualification gates.

Package version, lock root, citation and `ENGINE_API_VERSION` are aligned at 1.2.0. Newly created capture/plan records carry this creator identity and their serialized identities/fingerprints/hashes may change. Archived captures retain the original creator identity, and historical fixtures/hashes/measurement records remain unchanged. Native SDR schema 0.1.0, capture/model/POC/production-plan versions remain independent. JPEG golden regression replays the manifest-recorded creator version through the existing archive parser; it also verifies current exports record the actual current creator and preserve integer pixels. Historical JPEG bytes/hashes and independent decoder records are not regenerated. Old consumers continue using their existing APIs; new consumers must import the reviewed 1.2.0 root surface rather than deep imports.

## Review and checks

Substantive human scientific/source review must cover supported color/WB states, source authentication/provider restrictions, geometry identity, typed-buffer ownership, cancellation/draining, measured resource limits, unchanged reference arithmetic and compatibility. Review contribution-specific DCO certification. An AI draft does not certify reusable source rights, device performance or calibration.

PR #216 received human scientific/source and contribution-specific DCO approval and was squash merged as `5dfb9a24c683dad5529cbd579ffecf2baeec2c27`. Its reviewed tree and supported Node CI were verified. The [technical review record](NATIVE_CAPTURE_SDR_REVIEW.md) preserves the evidence history. The follow-up strengthened float32/float64 policy parity, orientation pixels, pending WB/shared-buffer rejection, host-yield cancellation and maximum 24 MP/16-bit measurements. No tag or package was published.

The subsequent combined #195/#196 work received separate owner scientific/source and DCO approval at head `43e4e9e4baac90f7b16c6e068b7964c0546a8134` and was squash merged as `c58d9eb9dcba807f020df45be1ed5ec4f6c081e4` in [PR #217](https://github.com/Photivra/engine/pull/217). The approved tree is preserved, all 2,065 tests pass and post-merge CI is green on all four supported Node versions. #195 is complete. The old [candidate review record](PRINT_195_196_REVIEW.md) preserves its pre-approval evidence. The follow-up [engine #196 acceptance audit](PRINT_196_ENGINE_ACCEPTANCE.md) adds patterned-source native-capture qualification and separates engine acceptance from separate downstream product gates. That additional scientific/source material needs review and DCO certification before #196 engine acceptance; the requested engine release remains held for that acceptance and explicit publication approval.

Run from the exact candidate tree, then require green supported Node 22.13/22/24/26 CI:

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
npm run build
node scripts/generate-api-reference.mjs --check
npm run docs:check
npm run release:consumer-check
npm run pack:check
npm run bench:image-formation:built
node --expose-gc scripts/benchmark-native-capture-sdr.mjs
```

No gates or thresholds are weakened. Benchmark results are host-specific observations; device/provider/master/encoder memory must be measured separately before app activation.

## Owner publication

After human review and merge, verify final-main CI and the approved candidate tree. Confirm protected main/tag rules and npm trusted publishing are configured. Replace `FINAL_MAIN_SHA` below with the verified final merged commit. Recheck that 1.2.0 remains unused. This PR creates no tag and publishes no package.

```sh
git fetch origin main --tags
git switch main
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "FINAL_MAIN_SHA"
test "$(git rev-parse origin/main)" = "FINAL_MAIN_SHA"
test "$(node -p "require('./package.json').version")" = "1.2.0"
git tag -a v1.2.0 FINAL_MAIN_SHA -m "Photivra engine 1.2.0"
git push origin refs/tags/v1.2.0
```

The existing protected workflow verifies tag/main/version and release gates, produces the verified tarball, checks its SHA-256 and uses OIDC to publish only an absent version. Observe completion, verify npm 1.2.0 metadata/tarball integrity, then create the matching GitHub release with the approved changes and evidence. Preserve publication failures for investigation; do not bypass gates, move tags or mutate a published version. #215's publication acceptance remains pending until the reviewed distribution exists.
