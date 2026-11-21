// SPDX-License-Identifier: Apache-2.0
/**
 * #594 (2.22.0): the CPU full-quality code and the opt-in features load on demand, where a request that asks for them is parsed.
 * A default request loads neither kit; a request with an opt-in feature loads only the opt-in kit; a full-quality option loads the
 * Quality kit. Results are unchanged by the split: the hash locks of every path (diffraction, AHD, defocus, profiles, mixed light,
 * moving subjects, coupled rendering) run through these loads. The bundle shape is checked in test/capture-bundle.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ImageKernelExecutionError, simulateCapture, simulateDisplayView } from "../src/index.js";
import * as kits from "../src/facade/on-demand-kits.js";
import * as qualityKitModule from "../src/facade/quality-kit.js";
import * as optInKitModule from "../src/facade/opt-in-kit.js";
import * as diffractionProfile from "../src/optics/diffraction-psf-profile.js";
import * as siteDiffraction from "../src/optics/site-diffraction-kernel.js";
import * as demosaic from "../src/processing/demosaic.js";
import * as bokehKernel from "../src/optics/defocus-bokeh-kernel.js";
import * as bokehZones from "../src/facade/defocus-bokeh-zones.js";
import * as largeLattice from "../src/facade/large-defocus-lattice.js";
import * as imageSpace from "../src/facade/defocus-image-space-provider.js";
import * as rendering from "../src/facade/display-view-rendering.js";
import * as neighbors from "../src/color/neighbor-highlight-reconstruction.js";
import * as offsetExpansion from "../src/facade/display-view-offset-expansion.js";
import * as profileBody from "../src/equipment/sensor-profile-body.js";
import * as mixed from "../src/facade/mixed-illumination.js";
import * as subjectMotion from "../src/motion/subject-motion.js";
import * as lensFilter from "../src/facade/lens-filter.js";
import * as catalogueOptics from "../src/facade/catalogue-lens-optics.js";
import * as detail from "../src/facade/display-view-detail.js";
import * as handShake from "../src/motion/hand-shake.js";

const { loadedKit, optInKit, qualityKit } = kits;
import { scaledTimeout } from "./helpers/test-timeout.js";

describe("on-demand CPU kits (#594)", () => {
  it("load only for the requests that need them", async () => {
    expect(() => loadedKit(qualityKit)).toThrow(ImageKernelExecutionError);
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 } });
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16, format: "png" }, fast: false });
    await simulateDisplayView({ scene: { preset: "slanted-edge" }, output: { width: 240, height: 160 } }, { width: 24, height: 16 });
    // The app's focus control (the geometric disc) stays on the fast path.
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, lens: { defocus: { model: "geometric-disc" }, focusDistanceM: 1 } });
    expect(qualityKit.loaded).toBeUndefined();
    expect(optInKit.loaded).toBeUndefined();
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, motion: { subject: { velocityMPerSec: { x: 0.1 } } } });
    expect(optInKit.loaded).toBeDefined();
    expect(qualityKit.loaded).toBeUndefined();
    await simulateCapture({ scene: { preset: "slanted-edge" }, output: { width: 24, height: 16 }, lens: { diffraction: "circular-aperture" } });
    expect(qualityKit.loaded).toBeDefined();
    expect(loadedKit(qualityKit)).toBe(await qualityKit.load());
  }, scaledTimeout(120_000));
  // ci-12 (#703): the path a browser takes when a lazily loaded chunk fails to download (offline, or a chunk name that changed
  // with a deployment). The three kits are built by kitLoader; it is tested directly, so no test hook adds code to a bundle row.
  it("turn a failed load into a domain error and retry it on the next call", async () => {
    let calls = 0;
    let release: (value: { id: number }) => void = () => undefined;
    const kit = kits.kitLoader("test", () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/quality-kit-1a2b.js"));
      return new Promise<{ id: number }>((resolve) => { release = resolve; });
    });
    const failed = await kit.load().then(() => undefined, (error: unknown) => error);
    expect(failed).toBeInstanceOf(ImageKernelExecutionError);
    expect((failed as ImageKernelExecutionError).reason).toBe("quality-code-unavailable");
    expect((failed as Error).message).toContain("the engine's test code could not be loaded: Failed to fetch dynamically imported module");
    expect(kit.loaded).toBeUndefined();
    // The failure is not remembered: the next call imports again, and two concurrent calls share that one import.
    const first = kit.load();
    const second = kit.load();
    expect(calls).toBe(2);
    expect(second).toBe(first);
    release({ id: 7 });
    expect(await first).toEqual({ id: 7 });
    expect(kit.loaded).toEqual({ id: 7 });
    expect(await kit.load()).toBe(kit.loaded);
    expect(calls).toBe(2);
    // A rejection that is not an Error is named too.
    const odd = kits.kitLoader("odd", () => Promise.reject("offline"));
    await expect(odd.load()).rejects.toThrow("the engine's odd code could not be loaded: offline");
  });
  // #658: each kit is one tuple read by position; every position constant names the export it stands for, and every slot is used.
  it("read every export at the position its constant names", () => {
    const positions = kits as unknown as Record<string, number>;
    const check = (tuple: readonly unknown[], modules: Record<string, unknown>, pairs: readonly (readonly [string, string])[]): void => {
      expect(pairs.map(([, constant]) => positions[constant]).sort((a, b) => a! - b!)).toEqual(tuple.map((_, i) => i));
      for (const [name, constant] of pairs) expect(tuple[positions[constant]!], name).toBe(modules[name]);
    };
    check(qualityKitModule.QUALITY_KIT, { ...diffractionProfile, ...siteDiffraction, ...demosaic, ...bokehKernel, ...bokehZones, ...largeLattice, ...imageSpace, ...rendering, ...neighbors, ...offsetExpansion }, [["createDiffractionLimitedPsfProfile", "QK_CREATE_DIFFRACTION_LIMITED_PSF_PROFILE"], ["registerDiffractionPsfKey", "QK_REGISTER_DIFFRACTION_PSF_KEY"], ["siteDiffractionKernel", "QK_SITE_DIFFRACTION_KERNEL"], ["createAhdDemosaicTask", "QK_CREATE_AHD_DEMOSAIC_TASK"], ["createDefocusBokehSiteKernel", "QK_CREATE_DEFOCUS_BOKEH_SITE_KERNEL"], ["resolveDefocusBokehOptions", "QK_RESOLVE_DEFOCUS_BOKEH_OPTIONS"], ["planDefocusBokehZones", "QK_PLAN_DEFOCUS_BOKEH_ZONES"], ["LARGE_DEFOCUS_CACHE_BYTES", "QK_LARGE_DEFOCUS_CACHE_BYTES"], ["createLargeDefocusNodeLattice", "QK_CREATE_LARGE_DEFOCUS_NODE_LATTICE"], ["calculateDefocusFieldVariation", "QK_CALCULATE_DEFOCUS_FIELD_VARIATION"], ["createDefocusImageSpaceProvider", "QK_CREATE_DEFOCUS_IMAGE_SPACE_PROVIDER"], ["prepareDefocusImageSpaceGeometry", "QK_PREPARE_DEFOCUS_IMAGE_SPACE_GEOMETRY"], ["createDisplayViewCoupledRendering", "QK_CREATE_DISPLAY_VIEW_COUPLED_RENDERING"], ["NEIGHBOR_HIGHLIGHT_RING", "QK_NEIGHBOR_HIGHLIGHT_RING"], ["NEIGHBOR_HIGHLIGHT_THRESHOLD", "QK_NEIGHBOR_HIGHLIGHT_THRESHOLD"], ["reconstructHighlightsFromNeighbors", "QK_RECONSTRUCT_HIGHLIGHTS_FROM_NEIGHBORS"], ["createOffsetExpansion", "QK_CREATE_OFFSET_EXPANSION"]] as const);
    check(optInKitModule.OPT_IN_KIT, { ...profileBody, ...mixed, ...subjectMotion, ...lensFilter, ...catalogueOptics, ...detail, ...handShake }, [["parseSensorProfile", "OK_PARSE_SENSOR_PROFILE"], ["sensorProfileBody", "OK_SENSOR_PROFILE_BODY"], ["sensorProfileSaturationIso", "OK_SENSOR_PROFILE_SATURATION_ISO"], ["flashAloneShutter", "OK_FLASH_ALONE_SHUTTER"], ["meterFlash", "OK_METER_FLASH"], ["rebindFlashAssumptions", "OK_REBIND_FLASH_ASSUMPTIONS"], ["requireFlashRows", "OK_REQUIRE_FLASH_ROWS"], ["resolveMixedIllumination", "OK_RESOLVE_MIXED_ILLUMINATION"], ["solveFlashShutter", "OK_SOLVE_FLASH_SHUTTER"], ["createSubjectMotionProvider", "OK_CREATE_SUBJECT_MOTION_PROVIDER"], ["subjectTravelM", "OK_SUBJECT_TRAVEL_M"], ["resolveLensFilter", "OK_RESOLVE_LENS_FILTER"], ["catalogueOpticsAssumptions", "OK_CATALOGUE_OPTICS_ASSUMPTIONS"], ["renderDisplayViewDetail", "OK_RENDER_DISPLAY_VIEW_DETAIL"], ["handShakeAssumption", "OK_HAND_SHAKE_ASSUMPTION"], ["handShakeQuadruples", "OK_HAND_SHAKE_QUADRUPLES"], ["resolveHandShake", "OK_RESOLVE_HAND_SHAKE"]] as const);
  });
});
