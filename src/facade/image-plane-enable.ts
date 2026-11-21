// SPDX-License-Identifier: Apache-2.0

/**
 * `prepareImagePlaneScenes()` (2.21, #581), in a module of its own: the dynamic import below is the only reference to the
 * image-plane module, so a bundler includes that module (as a lazy chunk) only in bundles that import this function.
 */

import { imagePlaneSupport, setImagePlaneSupport } from "./image-plane-support.js";

/**
 * 2.21 (#581): enables `{ kind: "image-plane" }` scenes (a photo as a flat print, docs/IMAGE_PLANE.md) in this JavaScript realm by
 * loading their module (a lazy chunk of about 14 KB gzip with its lattice data). Call it once, in the worker that captures, before
 * the first request with such a scene; later calls resolve at once. A request with an image-plane scene before it fails with a
 * message saying so.
 */
export async function prepareImagePlaneScenes(): Promise<void> {
  if (!imagePlaneSupport()) setImagePlaneSupport(await import("./image-plane.js"));
}
