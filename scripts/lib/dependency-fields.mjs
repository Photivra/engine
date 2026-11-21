// SPDX-License-Identifier: Apache-2.0

/** Every manifest field through which npm installs a package along with this one (#659, ci-22 in #703). */
export const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

/**
 * The dependency fields a manifest declares. The engine has no runtime dependency, so its published manifest declares none of
 * them, not even empty (#659); `devDependencies` is not installed with the package and is not one of them.
 * @param {Record<string, unknown>} manifest
 * @returns {string[]}
 */
export function declaredDependencyFields(manifest) {
  return DEPENDENCY_FIELDS.filter((field) => manifest[field] !== undefined);
}
