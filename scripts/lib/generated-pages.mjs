// SPDX-License-Identifier: Apache-2.0

/**
 * The generated-kind files (`.md`, `.json`) of one generated directory that a generator run did not write: pages of modules
 * that no longer export through the root (ci-09 in #703). They would otherwise stay in the repository and the package.
 * @param {string} directory The directory, as the emitted paths spell it (for example `docs/api`).
 * @param {readonly string[]} listing The names of the files in that directory.
 * @param {ReadonlySet<string>} emitted The paths the generator wrote or checked.
 * @returns {string[]} The orphan paths, sorted.
 */
export function orphanPages(directory, listing, emitted) {
  return listing
    .filter((name) => /\.(?:md|json)$/u.test(name))
    .map((name) => `${directory}/${name}`)
    .filter((path) => !emitted.has(path))
    .sort();
}
