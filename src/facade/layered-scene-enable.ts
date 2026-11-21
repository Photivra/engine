// SPDX-License-Identifier: Apache-2.0

/**
 * `prepareLayeredChartScenes()` (2.27.0, #652), in a module of its own: the dynamic import below is the only reference to the
 * layered-scene code, so a bundler includes it (as a lazy chunk) only in bundles that import this function.
 */

import { layeredSceneSupport, setLayeredSceneSupport } from "./image-plane-support.js";
import { loadOnDemandCode } from "./on-demand-code.js";

/**
 * 2.27.0 (#652): enables `{ kind: "layered-chart" }` scenes (docs/LAYERED_SCENES.md) in this JavaScript realm by loading their
 * code (a lazy chunk of about 10 KB gzip). Call it once, in the worker that captures, before the first request with such a scene;
 * later calls resolve at once. A request with a layered scene before it fails with a message saying so.
 */
export async function prepareLayeredChartScenes(): Promise<void> {
  if (!layeredSceneSupport()) setLayeredSceneSupport(await loadOnDemandCode("layered scene", () => import("./layered-scene-setup.js")));
}
