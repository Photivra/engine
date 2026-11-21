// SPDX-License-Identifier: Apache-2.0
// Repository path <-> site address. A link to a published file becomes its site address, with a fragment mapped through
// the split of long documents; any other repository link becomes its GitHub address; a link to a missing file fails the
// build (build plan in #669, "Links").
import { existsSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";

export class LinkMap {
  /**
   * @param {{ root: string, repository: string }} options
   */
  constructor({ root, repository }) {
    this.root = root;
    this.repository = repository;
    this.published = new Map();
    this.external = new Set();
    this.absolute = new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/(?:blob|tree)/main/([^#?]+)(?:#(.*))?$`, "iu");
  }

  /**
   * Registers a published file.
   * @param {string} path Repository-relative path.
   * @param {string} url Site address of the file (its first page).
   * @param {Map<string, string | null>} [fragments] Heading id -> site address holding it (with or without the fragment),
   *   or null for a heading whose part of the file is not published (the link then goes to GitHub).
   */
  publish(path, url, fragments = new Map()) {
    this.published.set(path, { url, fragments });
  }

  /** The site address for a repository path and fragment, or undefined when the file is not published. */
  siteAddress(path, fragment) {
    const entry = this.published.get(path);
    if (!entry) return undefined;
    if (!fragment) return entry.url;
    const target = entry.fragments.get(fragment);
    if (target === undefined) throw new Error(`Missing heading: ${path}#${fragment}`);
    return target ?? undefined; // null: a heading of a published file whose part is not on the site (GitHub instead)
  }

  /**
   * Rewrites one link found in the file `from` (repository-relative).
   * @param {string} href
   * @param {string} from
   */
  resolve(href, from) {
    let path, fragment;
    const absolute = href.match(this.absolute);
    if (absolute) {
      path = posix.normalize(decodeURI(absolute[1])).replace(/\/$/u, "");
      fragment = absolute[2];
    } else if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) {
      this.external.add(href);
      return href;
    } else {
      const [file, hash] = href.split("#");
      path = file ? posix.normalize(posix.join(dirname(from), decodeURI(file))).replace(/\/$/u, "") : from;
      fragment = hash;
    }
    if (path.startsWith("../")) throw new Error(`Link outside the repository: ${from} -> ${href}`);
    try {
      const site = this.siteAddress(path, fragment ? decodeURIComponent(fragment) : undefined);
      if (site !== undefined) return site;
    } catch (error) {
      throw new Error(`${error.message} (linked from ${from} as ${href})`, { cause: error });
    }
    const full = join(this.root, path);
    if (!existsSync(full)) throw new Error(`Missing navigation: ${from} -> ${href}`);
    const kind = statSync(full).isDirectory() ? "tree" : "blob";
    const address = `${this.repository}/${kind}/main/${path}${fragment ? `#${fragment}` : ""}`;
    this.external.add(address);
    return address;
  }
}
