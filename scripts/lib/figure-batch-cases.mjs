// SPDX-License-Identifier: Apache-2.0

/**
 * The batch-figure benchmark set of #670 (owner decision 2026-11-21: the plan's 17 cases and the five it named to add), shared by
 * `scripts/benchmark-figure-batch.mjs` (timings, informational) and `test/figure-batch-hash-locks.test.mjs` (the hash locks of the
 * same requests at small parts). Public options only.
 *
 * A figure is a request with the real sensor raster (6000 × 4000 at 6 µm unless the case is about the sensor), the options that
 * make it faithful (`lens.diffraction`, the four-spot filter, the 2 × 2 box pixel aperture, AHD) and one of two outputs:
 *
 * - `kind: "view"`: `prepareDisplayView(request, { gpu: "off" })`, then `render` of the case's files (`files`, by default 768 × 512
 *   and 1536 × 1024) in row bands (`view.region`). `part` is the band the part tier renders and `lock` the small region the hash
 *   locks render, both inside the case's first file.
 * - `kind: "capture"`: `simulateCapture` with `output.region` (a 100 % detail); `lock` is a smaller region inside it.
 *
 * `request(engine)` may be async (the layered scene loads its chunk first). The runners add `output.maximumPixels` and, for the
 * full-quality flag, `fast: false` (`figureRequest`).
 */
import { APP_CHART } from "./display-view-app-request.mjs";

export const FIGURE_CHART = APP_CHART;

/** The flags every case runs with: the default (`fast` omitted) and the full-quality path (`fast: false`, batch figure renders). */
export const FIGURE_FLAGS = Object.freeze(["exact", "default"]);

const faithful = (lens, extra = {}) => ({
  lens: { ...lens, ...(lens.catalogue ? {} : { diffraction: "circular-aperture" }) },
  sensor: { pixelPitchMicrometers: 6, antiAliasing: { kind: "four-spot" }, ...(lens.catalogue ? {} : { pixelAperture: { kind: "box", samplesPerAxis: 2 } }), ...(extra.sensor ?? {}) },
  output: { width: 6000, height: 4000, format: "srgb-8", demosaic: "ahd", ...(extra.output ?? {}) }
});
const req = (lens, { scene = FIGURE_CHART, exposure = { mode: "manual", iso: 100, shutterSeconds: 1 / 125 }, subjectDistanceM = 2, sensor, output, ...rest } = {}) =>
  ({ scene, subjectDistanceM, exposure, ...faithful(lens, { sensor, output }), ...rest });
const plain = (r) => ({ ...r, lens: { prime: 50, fNumber: 8 }, sensor: { pixelPitchMicrometers: 6 }, output: { ...r.output, demosaic: "bilinear" } });
const prime = (fNumber = 8, mm = 50) => ({ prime: mm, fNumber });
const AP = { mode: "aperture-priority", iso: 100 };
const FILES = [{ width: 768, height: 512, samplesPerAxis: 4 }, { width: 1536, height: 1024, samplesPerAxis: 4 }];
const FILES_S1 = FILES.map((f) => ({ ...f, samplesPerAxis: 1 }));
const band = (file, rows, y) => ({ ...file, region: { x: 0, y, width: file.width, height: rows } });
const lockOf = (file, x, y, width = 24, height = 4) => ({ ...file, region: { x, y, width, height } });
const DETAIL = { x: 2904, y: 1936, width: 192, height: 128 };
const LOCK_DETAIL = { x: 2984, y: 1984, width: 32, height: 32 };
const defocusNear = { ...prime(2), focusDistanceM: 1.6, defocus: { model: "geometric-disc" } };
const bokeh = { ...prime(2), focusDistanceM: 2.5, defocus: { model: "geometric-disc", blades: { count: 9, firstBladeEdgeAngleDegrees: 0, curvature: 0.3, circularAtOrBelowFNumber: 1.4 },
  sphericalAberration: { w040Micrometers: 0.5, atFNumber: 2 } } };
const catalogue = { catalogue: "pv-50-1.2-pro", fNumber: 1.4 };
const corrections = { lensCorrections: { distortion: true, lateralColor: true, vignetting: true } };

/**
 * The cases. `files`: the whole figure (every band of every file); `part`: one band, the part tier; `lock`: the hash-locked region
 * (display pixels of the first file for a view, real pixels for a capture). `scale` multiplies a part's CPU time to order the cases
 * by an estimate of their whole file (rows of the file ÷ rows of the part); totals come from whole figures only. `sameFigureAs`: a part
 * of another case's figure (the whole tier renders that figure once).
 */
export const FIGURE_CASES = Object.freeze([
  // Baseline, lens and sensor comparisons
  { id: "frame-768", topic: "baseline frame, 768 wide", kind: "view", request: () => req(prime()), files: FILES, part: band(FILES[0], 43, 213), lock: lockOf(FILES[0], 372, 230), scale: 512 / 43 },
  { id: "frame-1536", topic: "baseline frame, 1536 wide (exact area mean)", kind: "view", request: () => req(prime()), sameFigureAs: "frame-768", part: band(FILES[1], 16, 424),
    lock: lockOf(FILES[1], 744, 460, 16, 4), scale: 1024 / 16 },
  { id: "tele-200", topic: "lens comparison: 200 mm on a fixed-size chart", kind: "view", request: () => req(prime(8, 200), { chartSize: { widthM: 3, heightM: 2 }, subjectDistanceM: 4.25, exposure: AP }),
    files: FILES, part: band(FILES[0], 43, 213), lock: lockOf(FILES[0], 372, 230), scale: 512 / 43 },
  { id: "wide-24", topic: "lens comparison: 24 mm on a fixed-size chart", kind: "view", request: () => req(prime(8, 24), { chartSize: { widthM: 3, heightM: 2 }, subjectDistanceM: 4.25, exposure: AP }),
    files: FILES, part: band(FILES[0], 43, 213), lock: lockOf(FILES[0], 372, 230), scale: 512 / 43 },
  { id: "sensor-phone", topic: "sensor comparison: 12 MP, 1.4 um sites", kind: "view",
    request: () => req({ ideal: { focalLengthMm: 6 }, fNumber: 1.8 }, { sensor: { pixelPitchMicrometers: 1.4 }, output: { width: 4000, height: 3000 }, subjectDistanceM: 1 }),
    files: [{ width: 768, height: 576, samplesPerAxis: 4 }, { width: 1536, height: 1152, samplesPerAxis: 4 }], part: band({ width: 768, height: 576, samplesPerAxis: 4 }, 11, 240),
    lock: lockOf({ width: 768, height: 576, samplesPerAxis: 4 }, 372, 270), scale: 576 / 11 },
  // Depth of field, bokeh
  { id: "dof-near-s1", topic: "depth of field: f/2 focused at 0.8x, 1 sample", kind: "view", request: () => req(defocusNear, { exposure: AP }), files: FILES_S1,
    part: band(FILES_S1[0], 43, 213), lock: lockOf(FILES_S1[0], 372, 230), scale: 512 / 43 },
  { id: "dof-near-s4", topic: "depth of field: f/2 focused at 0.8x, 4 x 4 samples", kind: "view", request: () => req(defocusNear, { exposure: AP }), files: FILES,
    part: band(FILES[0], 11, 229), lock: lockOf(FILES[0], 372, 230), scale: 512 / 11 },
  { id: "bokeh-s1", topic: "bokeh: 9 blades + spherical aberration, f/2 focused at 1.25x", kind: "view", request: () => req(bokeh, { exposure: AP }), files: FILES_S1,
    part: band(FILES_S1[0], 43, 213), lock: lockOf(FILES_S1[0], 372, 230), scale: 512 / 43 },
  // Motion blur
  { id: "motion-yaw", topic: "motion blur: camera yaw, 1/15 s", kind: "view",
    request: () => ({ ...req(prime(), { exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 15 }, motion: { angularVelocityRadPerSec: { yaw: 0.02 } } }), lens: prime() }),
    files: FILES, part: band(FILES[0], 11, 229), lock: lockOf(FILES[0], 372, 230), scale: 512 / 11 },
  { id: "detail-subject-motion", topic: "motion blur: moving subject, 100 % detail 96 x 64", kind: "capture",
    request: () => plain(req(prime(), { scene: { preset: "slanted-edge" }, exposure: { mode: "manual", iso: 100, shutterSeconds: 1 / 30 }, motion: { subject: { velocityMPerSec: { x: 0.05, y: 0 } } },
      output: { region: { x: 2952, y: 1968, width: 96, height: 64 } } })), lock: { x: 2984, y: 1984, width: 16, height: 16 }, scale: 4 },
  // Noise, dynamic range
  { id: "noise-iso-frame", topic: "noise: ISO 6400 frame", kind: "view", request: () => req(prime(), { exposure: { mode: "manual", iso: 6400, shutterSeconds: 1 / 8000 } }), files: FILES,
    part: band(FILES[0], 43, 213), lock: lockOf(FILES[0], 372, 230), scale: 512 / 43 },
  { id: "detail-noise", topic: "noise: dead leaves, f/22, 1/4000 s, ISO 25600", kind: "capture",
    request: () => req(prime(22), { scene: { preset: "dead-leaves" }, exposure: { mode: "manual", iso: 25600, shutterSeconds: 1 / 4000 }, output: { region: DETAIL } }), lock: LOCK_DETAIL, scale: 1 },
  { id: "dr-recover-push", topic: "dynamic range: Recover, +1 stop", kind: "view", request: () => req(prime(), { output: { highlightMode: "reconstruct", exposureCompensationStops: 1 } }), files: FILES,
    part: band(FILES[0], 43, 213), lock: lockOf(FILES[0], 372, 230), scale: 512 / 43 },
  // Vignetting, distortion, fringing
  { id: "catalogue-768", topic: "vignetting, distortion, fringing: catalogue lens wide open", kind: "view", request: () => req(catalogue, { exposure: AP }), files: FILES,
    part: band(FILES[0], 11, 20), lock: lockOf(FILES[0], 40, 20, 12, 2), scale: 512 / 11 },
  { id: "catalogue-corrected", topic: "the same with lens corrections", kind: "view", request: () => req(catalogue, { exposure: AP, output: corrections }), files: FILES,
    part: band(FILES[0], 11, 20), lock: lockOf(FILES[0], 40, 20, 12, 2), scale: 512 / 11 },
  // Diffraction, 100 %
  { id: "detail-star-f8", topic: "100 % detail: Siemens star, f/8", kind: "capture", request: () => req(prime(), { scene: { preset: "siemens-star" }, exposure: AP, output: { region: DETAIL } }),
    lock: LOCK_DETAIL, scale: 1 },
  { id: "detail-star-f22", topic: "diffraction: Siemens star, f/22", kind: "capture", request: () => req(prime(22), { scene: { preset: "siemens-star" }, exposure: AP, output: { region: DETAIL } }),
    lock: LOCK_DETAIL, scale: 1 },
  // The five added by the owner's decision of 2026-11-21 (#670 plan, "To add in the build").
  { id: "layered-tabletop", topic: "layered scene: tabletop cards, f/2 focused at 1 m", kind: "view", added: true,
    request: async (engine) => {
      await engine.prepareLayeredChartScenes();
      const scene = engine.resolveLayeredChartPreset({ scale: "tabletop", focusDistanceM: 1, lens: { focalLengthMm: 50 }, aspect: 4000 / 6000 });
      return req({ ...prime(2), focusDistanceM: 1 }, { scene, subjectDistanceM: 1, exposure: AP });
    }, files: FILES, part: band(FILES[0], 11, 229), lock: lockOf(FILES[0], 372, 230), scale: 512 / 11 },
  { id: "mixed-light", topic: "mixed illumination: daylight and tungsten across the frame", kind: "view", added: true,
    request: () => req(prime(), { illumination: { sources: [{ illuminant: { kind: "planckian", temperatureKelvin: 6500 }, illuminanceLux: 8000 }, { illuminant: "cie-a", illuminanceLux: 3000 }],
      blend: { kind: "linear-gradient", from: { u: -0.5, v: 0 }, to: { u: 0.5, v: 0 } } } }), files: FILES, part: band(FILES[0], 11, 229), lock: lockOf(FILES[0], 372, 230), scale: 512 / 11 },
  { id: "detail-perceptual-png", topic: "perceptual gamut mapping to PNG: color patches, 100 % detail", kind: "capture", added: true,
    request: () => req(prime(), { scene: { preset: "color-patches" }, exposure: AP, output: { region: DETAIL, format: "png", gamutMapping: "perceptual" } }), lock: LOCK_DETAIL, scale: 1 },
  // The four-spot filter, the box and diffraction under a rolling shutter exceed the environment's query budget per site, so the
  // rolling case keeps #651's lens and sensor (no diffraction, no filter, no box) with AHD.
  { id: "rolling-yaw", topic: "rolling shutter with camera yaw (#651's motion), 1/125 s", kind: "view", added: true,
    request: () => ({ ...req(prime(), { motion: { angularVelocityRadPerSec: { yaw: 0.0766 }, shutter: "rolling" } }), lens: prime(), sensor: { pixelPitchMicrometers: 6 } }),
    files: FILES, part: band(FILES[0], 11, 229), lock: lockOf(FILES[0], 372, 230), scale: 512 / 11 },
  { id: "sensor-aps-c", topic: "sensor comparison: APS-C 26 MP profile", kind: "view", added: true,
    request: (engine) => req({ ideal: { focalLengthMm: 33 }, fNumber: 5.6 }, { sensor: { profile: engine.resolveSensorProfile("aps-c-26mp-bsi-2020s"), pixelPitchMicrometers: undefined },
      output: { width: 6248, height: 4176 } }), files: [{ width: 768, height: 513, samplesPerAxis: 4 }, { width: 1536, height: 1027, samplesPerAxis: 4 }],
    part: band({ width: 768, height: 513, samplesPerAxis: 4 }, 11, 229), lock: lockOf({ width: 768, height: 513, samplesPerAxis: 4 }, 372, 230), scale: 513 / 11 }
]);

/** The request a runner renders: the case's request with the raster ceiling and, for the full-quality flag, `fast: false`. */
export async function figureRequest(engine, c, flag, { region } = {}) {
  const r = await c.request(engine);
  const sensor = Object.fromEntries(Object.entries(r.sensor ?? {}).filter(([, v]) => v !== undefined));
  const output = { ...r.output, maximumPixels: engine.NATIVE_RAW_LIMITS.ceilingPixels, ...(region ? { region } : {}) };
  return { ...r, sensor, output, ...(flag === "exact" ? { fast: false } : {}) };
}

/** A case by id; throws with the list when unknown. */
export function figureCase(id) {
  const c = FIGURE_CASES.find((k) => k.id === id);
  if (!c) throw new Error(`Unknown figure case ${id}; known: ${FIGURE_CASES.map((k) => k.id).join(", ")}`);
  return c;
}

const sha256 = (createHash, arrays) => {
  const hash = createHash("sha256");
  for (const a of arrays) hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  return hash.digest("hex");
};

/**
 * The digests the hash locks record for one case and flag, split as #697 splits the display-view locks:
 *
 * - `samples`: SHA-256 of the output samples only (`image.samples`), the bytes a figure shows;
 * - `internals`: SHA-256 of the float64 expected values and noise standard deviations (a view) or of the RAW codes (a capture), which
 *   move with rounding when the samples need not;
 * - `work`: the render's own counts (a view: `sampleCount`, `siteEvaluations`, `sceneLookups`; a capture: `providerEvaluationCount`),
 *   so a speed-up that changes the work shows apart from one that does not. They are the same on every architecture.
 *
 * `engine` is the module of the build under test (its root exports) and `renderWithInternals` its
 * `renderPreparedDisplayViewWithInternals` (`facade/simulate-display-view`), so the test (source) and the recorder (`dist`) run the
 * same steps. `createHash` is `node:crypto`'s. `region` (display pixels of the lock's file, or real pixels) defaults to the lock's.
 */
export async function figureLockDigests({ engine, renderWithInternals, createHash }, c, flag, region = c.kind === "view" ? c.lock.region : c.lock) {
  if (c.kind === "view") {
    const prepared = await engine.prepareDisplayView(await figureRequest(engine, c, flag), { gpu: "off" });
    const { result, internals } = await renderWithInternals(prepared, { ...c.lock, region });
    const d = result.diagnostics;
    return { samples: sha256(createHash, [result.image.samples]), internals: sha256(createHash, [internals.expected, internals.noiseStd]),
      work: { sampleCount: d.sampleCount, siteEvaluations: d.siteEvaluations, sceneLookups: d.sceneLookups } };
  }
  const result = await engine.simulateCapture(await figureRequest(engine, c, flag, { region }));
  return { samples: sha256(createHash, [result.image.samples]), internals: sha256(createHash, [result.raw.codes]),
    work: { providerEvaluationCount: result.diagnostics.providerEvaluationCount } };
}
