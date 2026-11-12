// SPDX-License-Identifier: Apache-2.0

/**
 * Version of the engine release. Since 1.0.1 it equals the npm package version.
 *
 * New captures and plans record this version as their creator. Archived records keep the
 * version they were made with. Proof-of-concept (POC), schema and model contracts have their
 * own versions. Release checks confirm it matches package.json and the packed package.
 * @see docs/RELEASE_1_0_1.md
 */
export const ENGINE_API_VERSION = "2.23.0" as const;
