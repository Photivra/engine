// SPDX-License-Identifier: Apache-2.0
/**
 * #670: hash locks of the batch-figure benchmark set (`scripts/lib/figure-batch-cases.mjs`), both flags (`fast: false`, which batch
 * figure renders use, and the default), recorded at `main` 99782e7 (2.27.0) before any 2.28.0 source change. Each case renders its
 * `lock`: a small region of the figure's real request (a few display pixels of its first file, or 32 × 32 real pixels of its 100 %
 * detail), so the locks cover the benchmark's own requests at test cost.
 *
 * Three records per case and flag, split as #697 splits the display-view locks:
 * - `samples`: SHA-256 of `image.samples` only. A change that claims "samples unchanged" leaves every samples lock untouched.
 * - `internals`: SHA-256 of the float64 expected values and noise standard deviations (a view) or the RAW codes (a capture); these
 *   move with rounding and may be re-recorded with a change whose samples hold.
 * - work counts: `sampleCount`, `siteEvaluations`, `sceneLookups` (a view) or `providerEvaluationCount` (a capture), so a change of the
 *   work is seen apart from a change of the time.
 *
 * Architectures (docs/NUMERICAL_CORRECTNESS.md, "Test hash locks and platforms"; test/helpers/architecture-hash-locks.ts). The locks
 * are the x64 values; on arm64 a lock whose bytes differ there is checked against its recorded arm64 value. Recorded on Apple
 * silicon with `node scripts/benchmark-figure-batch.mjs locks` against a build of 99782e7: arm64 with Node 26.13.1 (the same on
 * 22.13.0 and 24.19.0), x64 with x64 Node 24.1.0 under Rosetta 2, which reproduces the six x64 locks of test/display-view.test.ts
 * on the same build. Every samples digest is the same on both; 28 internals digests differ (one-ulp Math results, #508), and the
 * layered scene's `sceneLookups` differs (its occlusion test reads Math results: 143,056 on x64, 135,540 on arm64; samples equal).
 * Linux x64 CI confirms the x64 values; macOS arm64 runs this file only where a workflow lists it.
 *
 * To record or re-record on another architecture: on that machine, `npm ci && npm run build`, then
 * `node scripts/benchmark-figure-batch.mjs locks > locks.json` (or `locks <case ids>`); its `locks[id][flag]` holds `samples`,
 * `internals` and `work`. On x64 the values replace LOCKS and WORK; on arm64 each value that differs from the x64 one goes into
 * ARM64_FIGURE_LOCKS (keyed by the x64 digest) or ARM64_WORK. Re-record only with a change that names the moved locks.
 *
 * Re-recorded in 2.28.0 step 5 (arm64 and x64 Node 24.1.0 under Rosetta 2; CHANGELOG.md, "Output changes"): #670 win 1, the
 * `fast: false` internals of 11 cases and the `fast: false` sceneLookups of dof-near-s1 and dof-near-s4 (no samples lock moved);
 * #732, the default flag's samples, internals and work of 11 cases and detail-noise's work; #674, the internals of catalogue-768
 * and catalogue-corrected, both flags (their samples hold).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as engine from "../src/index.ts";
import { renderPreparedDisplayViewWithInternals } from "../src/facade/simulate-display-view.ts";
import { FIGURE_CASES, FIGURE_FLAGS, figureCase, figureRequest, figureLockDigests } from "../scripts/lib/figure-batch-cases.mjs";
import { ARM64, hashLockOnThisArchitecture } from "./helpers/architecture-hash-locks.ts";
import { scaledTimeout } from "./helpers/test-timeout.ts";

const deps = { engine, renderWithInternals: renderPreparedDisplayViewWithInternals, createHash };

/** x64 locks: per case and flag, [samples, internals]. */
const LOCKS = {
  "frame-768": {
    exact: ["c557168b9b7bc9f9f9e79e5c8d6ba5e2a6d2b5104cf3daa1065e81735cf9e674", "49babd72e134645d991d4f57421f6b16d9aa85c1e23620ceba6ffc454e2e26a9"],
    default: ["511abc2b72e1304c50a078b1dbf1078c401d6b134b914c206c1c0ee01b4dce58", "23d73a220c88e941a1cb2ef8462b4f8a9fe4ac82f83cf2013b4658a8260ea94d"]
  },
  "frame-1536": {
    exact: ["203146b6e7d83eb1e30d3fa203e41f9d6ff7d221f8a82e7b056648828c320a25", "cd761e19efaf0d73948e2c990aab7924adc1a81f85e1cf12f4e61078defa4c81"],
    default: ["867d79f06acb08d40c0231b6d25e62012b3c6ffe482940d4e7ea3ff8e18e4578", "95573f4fabced3b427bb0526aebc7283297435ee25bdf0af73604f78cd5db884"]
  },
  "tele-200": {
    exact: ["1fd7cca770720ba58b718d213403ef169800b4a9123ab4496e7558615f131451", "03622735853e54763cec8c88bfd579d9a18d3178daac83e6a15c9ef75b6a62d9"],
    default: ["8fac01e73be86635a680de1ffae178a4be3ccc20c992c0e756a7652996799edf", "981f1498075136354e22b07a4049ed7c4b5503c1ae63f386ac4f815135cd02f4"]
  },
  "wide-24": {
    exact: ["3589b62721093b0f44297e32dca82bf644ef44ef39b2a9c1d6e7c81936c107d3", "fa394fa59ba6502b2bed0d8311ce4c21731e610eeca080d7341406cda6a04a51"],
    default: ["ce701263e115b981cda6b96f5759bbd326eb265e4745898504c9a35946ba0fc7", "94d079eda8ada6e38521b9ab2c07560aa71b7687af38adfe1e1dcf70213b6668"]
  },
  "sensor-phone": {
    exact: ["2b8363c008ff0849bd566436283571d585f0233da8e85e9bcee55cac0aa6ef2b", "396b97aaa4cf5eca6daf45406f4084b70d27bcb8e6f4e1d0e9b29fe266db6110"],
    default: ["e3972fcbe74dea48b89692fb0fff951594a4091acf41aaa372d207c726a1e03d", "4e7f2404c45c839c47f850889b31c263993f074a7587c3902ab560b5f76c1940"]
  },
  "dof-near-s1": {
    exact: ["337f79d6806de3a73a7fd2990d42ee388c7d62c2817d7d909e531d7f5504013a", "08abf955a8b4107ef3e6501e78792e4da26babb665eb08da2799219c01deb498"],
    default: ["337f79d6806de3a73a7fd2990d42ee388c7d62c2817d7d909e531d7f5504013a", "08abf955a8b4107ef3e6501e78792e4da26babb665eb08da2799219c01deb498"]
  },
  "dof-near-s4": {
    exact: ["a849ba841b9827e72bbb8cd705c3d9c9511c99d19917cf484d7282bf469499da", "0011a36dda84fa265a42ec8d0e5f311db14d5ec9849e4397ab20f04d11c9a2ac"],
    default: ["a849ba841b9827e72bbb8cd705c3d9c9511c99d19917cf484d7282bf469499da", "0011a36dda84fa265a42ec8d0e5f311db14d5ec9849e4397ab20f04d11c9a2ac"]
  },
  "bokeh-s1": {
    exact: ["8f48d4bc51d21fe647ffb26521117fc3aa6b01c8c12c72ed9e2827eae7789515", "0694ff9b20a190f91c6d8f45d84560da7d6990d2a7e20219caddbb25f6214c89"],
    default: ["8f48d4bc51d21fe647ffb26521117fc3aa6b01c8c12c72ed9e2827eae7789515", "0694ff9b20a190f91c6d8f45d84560da7d6990d2a7e20219caddbb25f6214c89"]
  },
  "motion-yaw": {
    exact: ["f593e09f8619341f4fcb5b0f183d7674e3e76c765afc93787a248a15f03c050b", "f9652d85200dc35677e0eb2743ae347149c8a525e28611072a864b9b572a7543"],
    default: ["f593e09f8619341f4fcb5b0f183d7674e3e76c765afc93787a248a15f03c050b", "6205bd2d20297e65f6c62b3665a556f8961c8539616706818b4d083dd725b204"]
  },
  "detail-subject-motion": {
    exact: ["7bdb816e020ae667438c11da3693395cc51c4da0d67b861d7753a29fdd519457", "f4a1ef9296e69c13a42d74ef2f0191d392e4d7e0d43349a4ea5c1a2945e80279"],
    default: ["5e9f4496738d46c0eb38ae2551846137db0677da9bea5649682ebfeb5e539559", "8253b5091d9d5df22401bfe6c809a391499d5db7bc1ffc6a2b7945e5013fa6eb"]
  },
  "noise-iso-frame": {
    exact: ["9414f38f9e8ffec64c77e2485bf816d73f9c09d09e3d7e294d87e6ec8f91ec29", "2175015025e86a889e089870293917db278bffbaf0e1ac6730b69833c9452c84"],
    default: ["5dafa90e102184801bd16ada61ec31c30f70dad9ca79a986c16ce07bbc89140d", "611ea5d870e78048bf6ddc7faf68636918a8827e8c31b2a6b1f69194553954e4"]
  },
  "detail-noise": {
    exact: ["0c4508f9dad26fdc3f9c2f198c7818e5495537a409214af1e06ee5fd6652f5ea", "1b402ef79d8c41ab7dac0a43946e237861d800916583326f6c5721c22bba4076"],
    default: ["0c4508f9dad26fdc3f9c2f198c7818e5495537a409214af1e06ee5fd6652f5ea", "1b402ef79d8c41ab7dac0a43946e237861d800916583326f6c5721c22bba4076"]
  },
  "dr-recover-push": {
    exact: ["93eb210743a85e2b1a96aad57de95812a6dc79cc0f6a29a01b5797a0c633e9d8", "72dfaa4e8a7d61561c07b352ecf36b90e17b20743f2c713dda784acb1a5b708a"],
    default: ["9934c6898507a19de6458ebed70a66dc99f3f69a35b6b849622f443697c425bc", "8b3197fd2a1954ea1eec9630dfd1db1309b7fc5766ffd208e4b305c13a0505cf"]
  },
  "catalogue-768": {
    exact: ["de4a03b4e6c178590e234b5052c143c8636158043d26f285d70765707827b47d", "63e31c64fc30d3f78a2b0c07c4dd885ad0f65651145f138ea1abddf509562e34"],
    default: ["d675d22f872060db8bbf6925e5123b612fcc60e596e541644f88040c0f96715c", "d6980cf5070fa813b59f3fd46c90c597d98fb95e0a019b8f681f36b50342a029"]
  },
  "catalogue-corrected": {
    exact: ["ba0c34caf04ad6ab3af89ff4cfd927dc83ae81de05c48720e74a46e2b99a5ddd", "42078a39f30255d74081e9b25804a8a71ba8089e765318c763f53b8d911cca10"],
    default: ["ebc1cfa2f3e6307ccf74af07fd33c29d65f5913000c59b15c2199212a94e5f55", "5454875494288df41860b37003853a6fd8ddbc994bf5b2506f6bc300f67a9b7b"]
  },
  "detail-star-f8": {
    exact: ["14abc6c28dbd908ed920ef3ebd98935060da35f54a96b9b1247f132af1794fb2", "719823d483c64ebaf14d1ab0ee1257bff140be64d917fd6c0708fa28b961b9b0"],
    default: ["e98cf6fdf4120a75629c02c5997c5a71646f9efeaa2545004e14d1f31cd1e708", "958deb01a828139793f99de4210a19f20dea8c289fcff05c9fd04bcdaab92dc0"]
  },
  "detail-star-f22": {
    exact: ["5f016ba05ce061173d0dc8199737c1c838d58a488d9c7ab133b5d6ef40bf9607", "febac25acee12af87588dbcd05e34d3845a8ddd4584f608a15a06ee47ce8cc19"],
    default: ["4a4d0a70df9ea760b5f719e486c65ede27d81ef2ac4f4334c18b7042705945c3", "753e9046270a1f67d962a978f365c6e2e02f1d6a7c9be6d67696d20e835813f7"]
  },
  "layered-tabletop": {
    exact: ["390566fd6aa45111251b6d1fe9e0ed984d0315adaca077f1bb2504f2e1931625", "15179d4c9413f6e67e5b80a7c368eaa46b789b2c6d08982e327bd643d594fb3b"],
    default: ["390566fd6aa45111251b6d1fe9e0ed984d0315adaca077f1bb2504f2e1931625", "15179d4c9413f6e67e5b80a7c368eaa46b789b2c6d08982e327bd643d594fb3b"]
  },
  "mixed-light": {
    exact: ["b72020429877951adf589d08a815f17d9d65ff05a500eaad2712d1d9bddef297", "a61931f457062e512670a3be62429fd6b6eb5f409811f60b84522fe2efbab295"],
    default: ["983f40da97b22c4fdd6da3504106fc0f4b15c2f6c0a290161c190a6422040764", "bd5f87f0b60b22bc81d4021614fede8a1ef9e699db60e2d37f4d124cef1a7eed"]
  },
  "detail-perceptual-png": {
    exact: ["4713df3725b48384af9de4ebee15c9c8f5dfcac595311bd2e277791c4e3eb972", "45338da623cc65c45ebe1d6070d709e95837f8a98a44fb271d203e90d0d722ab"],
    default: ["4713df3725b48384af9de4ebee15c9c8f5dfcac595311bd2e277791c4e3eb972", "45338da623cc65c45ebe1d6070d709e95837f8a98a44fb271d203e90d0d722ab"]
  },
  "rolling-yaw": {
    exact: ["005f16028721dfac16cd5d560c3435f223481891389432b3c9148bb4979f3939", "0d6c5f59da9f1117ddf93ba39f6f6a39d7c0e2138a3e63e34e487791773883e0"],
    default: ["fa0350ee23c303d68a6d9347698bd82f329ed8bcb0556e2a2af309ccdd76096d", "cd63c1f0dd4b5f101d46ff9c12563f543cb42ecbcb93cd33f957751de410e17d"]
  },
  "sensor-aps-c": {
    exact: ["c2e139ab3d9cd3bacc1b175a3e4227eb7909820e63dae727cb237bacbaa153c9", "b24a2aadbc493df029e4b6ed5b58ce54c2b041bc620b865ed3fa76d4771c0f2c"],
    default: ["3c73abac05249d345cbdecae39957c1995f04a685d493c26f7082277bb08e483", "abf2e6092cce2c4a1ce9ab65ba587ab46b8902ec202876bc32f37ec5f54e7c98"]
  }
};
/** x64 work counts: [sampleCount, siteEvaluations, sceneLookups] of a view, [providerEvaluationCount] of a capture. */
const WORK = {
  "frame-768": { exact: [1536, 41540, 256048], default: [1536, 41540, 216160] },
  "frame-1536": { exact: [1560, 42072, 104508], default: [1560, 42072, 83708] },
  "tele-200": { exact: [1536, 41540, 256048], default: [1536, 41540, 216160] },
  "wide-24": { exact: [1536, 41540, 256048], default: [1536, 41540, 216160] },
  "sensor-phone": { exact: [1536, 41616, 199056], default: [1536, 41616, 165480] },
  "dof-near-s1": { exact: [96, 2588, 198096], default: [96, 2588, 198096] },
  "dof-near-s4": { exact: [1536, 41540, 203992], default: [1536, 41540, 203992] },
  "bokeh-s1": { exact: [96, 2588, 381304], default: [96, 2588, 381304] },
  "motion-yaw": { exact: [1536, 41540, 1930353], default: [1536, 41540, 965488] },
  "detail-subject-motion": { exact: [103680], default: [51840] },
  "noise-iso-frame": { exact: [1536, 41540, 256048], default: [1536, 41540, 216160] },
  "detail-noise": { exact: [30192], default: [21792] },
  "dr-recover-push": { exact: [1536, 41540, 256048], default: [1536, 41540, 216160] },
  "catalogue-768": { exact: [384, 10324, 7541], default: [24, 648, 6560] },
  "catalogue-corrected": { exact: [4608, 124416, 23468], default: [72, 1948, 15608] },
  "detail-star-f8": { exact: [15120], default: [13280] },
  "detail-star-f22": { exact: [30192], default: [21792] },
  "layered-tabletop": { exact: [1536, 41540, 143056], default: [1536, 41540, 143056] },
  "mixed-light": { exact: [1536, 41540, 5115032], default: [1536, 41540, 4317272] },
  "detail-perceptual-png": { exact: [15120], default: [15120] },
  "rolling-yaw": { exact: [1536, 41540, 125411], default: [1536, 41540, 63019] },
  "sensor-aps-c": { exact: [1536, 41500, 262140], default: [1536, 41500, 221652] }
};
/** arm64 digests that differ from their x64 lock, keyed by the x64 lock. */
const ARM64_FIGURE_LOCKS = {
  "49babd72e134645d991d4f57421f6b16d9aa85c1e23620ceba6ffc454e2e26a9": "7f1c19e09f50dd057a89370d30dbc641fe85cb2007c6c2fc928a0442a9e9c9d0",
  "23d73a220c88e941a1cb2ef8462b4f8a9fe4ac82f83cf2013b4658a8260ea94d": "cf33aa7656e8bb640dc76527abf47aae148e5f102b7b608c858ea62156ab318c",
  "cd761e19efaf0d73948e2c990aab7924adc1a81f85e1cf12f4e61078defa4c81": "c6d915cc2d45dabbf89c8e1012df7bfc2088e3b8a4338442ed2160adb875f9be",
  "95573f4fabced3b427bb0526aebc7283297435ee25bdf0af73604f78cd5db884": "09bbdde84303f5350591d569e06916da2e124f92c2fb8db19896c2705bcbf56a",
  "03622735853e54763cec8c88bfd579d9a18d3178daac83e6a15c9ef75b6a62d9": "10df72f21723850d9acae154e1a4e25148bad896ab57b604fbeaa7d348228892",
  "981f1498075136354e22b07a4049ed7c4b5503c1ae63f386ac4f815135cd02f4": "cb34bafc2012a6855abbd5eb5c731331bea423b59baaf34d8993adb88abc9761",
  "fa394fa59ba6502b2bed0d8311ce4c21731e610eeca080d7341406cda6a04a51": "397c5af7b6bfe2470b5c05afad3065465b9b853f69d06741c80d1728de48b2c0",
  "94d079eda8ada6e38521b9ab2c07560aa71b7687af38adfe1e1dcf70213b6668": "48386e97b665e10330b8eb051d1244ea47bbb7170dbb63492d83786c9790639e",
  "396b97aaa4cf5eca6daf45406f4084b70d27bcb8e6f4e1d0e9b29fe266db6110": "e1a28e2ba68a6a0f8ac3c1dbead81b82d06be4ddb1a1a9cc6c18a6d4a6db7e47",
  "4e7f2404c45c839c47f850889b31c263993f074a7587c3902ab560b5f76c1940": "60266537b8905eb99ad00e30d1fa37352ad43af050200fd96ff392663d7147c8",
  "08abf955a8b4107ef3e6501e78792e4da26babb665eb08da2799219c01deb498": "d1af90fd8887fd13ca2580ef0f2aaca9002dfd73104ecba07767c486cacb0ed5",
  "0011a36dda84fa265a42ec8d0e5f311db14d5ec9849e4397ab20f04d11c9a2ac": "bb2726ceca3e4288af82e95281bd850b8af91bfb516d27fa2da01879b4bee1d3",
  "0694ff9b20a190f91c6d8f45d84560da7d6990d2a7e20219caddbb25f6214c89": "0504f757730c501eaa9dc8f12070a490fa3d55f3503c43faf7135456c79c8b29",
  "2175015025e86a889e089870293917db278bffbaf0e1ac6730b69833c9452c84": "2dde0a74839d63c861ef40ba76f51143c1afce733a33de008a5c3ecb19ef477f",
  "611ea5d870e78048bf6ddc7faf68636918a8827e8c31b2a6b1f69194553954e4": "0f3ac0fa7f80e81f6d0e2312690527820ef0a648e3b399ea5be35650f0679448",
  "72dfaa4e8a7d61561c07b352ecf36b90e17b20743f2c713dda784acb1a5b708a": "751535c192d4702ff365ea0e289dc20b00d62da48eeedf566f1018d978dbaf61",
  "8b3197fd2a1954ea1eec9630dfd1db1309b7fc5766ffd208e4b305c13a0505cf": "874506479fb2c7d888170e25ff840fa2b796cc4d3babdbcb17026920b026dbdd",
  "15179d4c9413f6e67e5b80a7c368eaa46b789b2c6d08982e327bd643d594fb3b": "39238054f0da472a9e32288d29f3d41bf370a8578f95689f7015ad6133d43040",
  "a61931f457062e512670a3be62429fd6b6eb5f409811f60b84522fe2efbab295": "e96bdb909b1b9ef9c99fad646321aa7fb6d28a3928b95bf66952b14b7c0298ea",
  "bd5f87f0b60b22bc81d4021614fede8a1ef9e699db60e2d37f4d124cef1a7eed": "08e9c503ff6aa894c32fde7a88b22397e77541315e9f05bdc108f122ba2c8676",
  "b24a2aadbc493df029e4b6ed5b58ce54c2b041bc620b865ed3fa76d4771c0f2c": "cc323cf0cf51e069291ced47faf7e7f7289b86412b8117f8cc1087e3d8f6f0ab",
  "abf2e6092cce2c4a1ce9ab65ba587ab46b8902ec202876bc32f37ec5f54e7c98": "c1da79dc44b5d6840afd3c06f5869d5124b85e940258194fc2c7a85a1541c247"
};
/** arm64 work counts that differ from the x64 ones. */
const ARM64_WORK = {
  "layered-tabletop": { exact: [1536, 41540, 135540], default: [1536, 41540, 135540] }
};

const workArray = (work) => Object.values(work);

describe("batch-figure hash locks (#670)", () => {
  it("locks every case of the benchmark set, both flags", () => {
    expect(Object.keys(LOCKS)).toEqual(FIGURE_CASES.map((c) => c.id));
    expect(Object.keys(WORK)).toEqual(FIGURE_CASES.map((c) => c.id));
    expect(FIGURE_FLAGS).toEqual(["exact", "default"]);
    expect(FIGURE_CASES.filter((c) => c.added).map((c) => c.id)).toHaveLength(5);
    expect(new Set(FIGURE_CASES.map((c) => c.id)).size).toBe(22);
  });

  for (const c of FIGURE_CASES) {
    it(`${c.id}: samples, internals and work counts, fast: false and default`, async () => {
      for (const flag of FIGURE_FLAGS) {
        const digests = await figureLockDigests(deps, c, flag), [samples, internals] = LOCKS[c.id][flag];
        expect(digests.samples, `${flag} samples`).toBe(hashLockOnThisArchitecture(samples, ARM64_FIGURE_LOCKS));
        expect(digests.internals, `${flag} internals`).toBe(hashLockOnThisArchitecture(internals, ARM64_FIGURE_LOCKS));
        expect(workArray(digests.work), `${flag} work`).toEqual((ARM64 ? ARM64_WORK[c.id]?.[flag] : undefined) ?? WORK[c.id][flag]);
      }
    }, scaledTimeout(60_000));
  }

  // Bands are the unit of a batch (the #670 worker recipe): a region joined from row bands equals the region in one piece, through
  // one prepared view, for an in-focus frame, a defocused frame and a catalogue lens, both flags.
  it("joins row bands to the one-piece region: frame-768, dof-near-s1, catalogue-768", async () => {
    for (const [id, width, height, bands] of [["frame-768", 16, 6, [2, 3]], ["dof-near-s1", 16, 6, [2, 3]], ["catalogue-768", 12, 4, [1, 2]]]) {
      const c = figureCase(id), { x, y } = c.lock.region, file = { width: c.lock.width, height: c.lock.height, samplesPerAxis: c.lock.samplesPerAxis };
      for (const flag of FIGURE_FLAGS) {
        const prepared = await engine.prepareDisplayView(await figureRequest(engine, c, flag), { gpu: "off" });
        const one = (await prepared.render({ ...file, region: { x, y, width, height } })).image.samples;
        for (const rows of bands) {
          const joined = [];
          for (let y0 = y; y0 < y + height; y0 += rows) joined.push(...(await prepared.render({ ...file, region: { x, y: y0, width, height: Math.min(rows, y + height - y0) } })).image.samples);
          expect(joined, `${id} ${flag}, bands of ${rows} rows`).toEqual(Array.from(one));
        }
      }
    }
  }, scaledTimeout(120_000));
});
