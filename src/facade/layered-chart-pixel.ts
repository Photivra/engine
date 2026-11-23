// SPDX-License-Identifier: Apache-2.0

/**
 * #747 (2.29.0, wave-3 wiring): the surface of a layered chart scene at an output pixel, through the request's lens. Its own module, so
 * that `calculateLayeredChartSurfaceAt` (`layered-chart-query.ts`) alone carries no lens mapping code.
 *
 * The pixel centre's sensor point goes through the lens with the engine's own mapping functions: the environment's lens field mapping
 * (`prepareEnvironmentLensFieldMapping`: the projection and the inverse distortion) in the capture's prepared lens geometry
 * (`prepareDefocusImageSpaceGeometry`, still camera), as a layered lattice point's frame point (`createLayeredLensMap`, then the
 * lattice geometry's `rasterFramePoint`, the mapping the display view's pilot reads). Then `calculateLayeredChartSurfaceAt`'s chief-ray
 * lookup at that frame point.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { parseLensProjectionModel } from "../camera/lens-projection.js";
import { prepareEnvironmentLensFieldMapping } from "../optics/sensor-environment-query.js";
import { prepareDefocusImageSpaceGeometry } from "./defocus-image-space-provider.js";
import { createLayeredLatticeGeometry, createLayeredLensMap } from "./layered-lattice-geometry.js";
import { calculateLayeredChartSurfaceAt, type LayeredChartSurfaceAt } from "./layered-chart-query.js";
import type { LayeredChartScene } from "./layered-chart-scene.js";

const fail = (message: string): never => { throw new InvalidConfigurationError(message); };
function record(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(name + " must be an object.");
  for (const key of Object.keys(value as object)) if (!keys.includes(key)) fail(name + " has unknown field \"" + key + "\".");
  return value as Record<string, unknown>;
}
function positive(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) fail(name + " must be a positive finite number.");
  return value as number;
}
function whole(value: unknown, name: string, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high) fail(name + " must be an integer from " + low + " to " + high + ".");
  return value as number;
}

/** The input of {@link calculateLayeredChartSurfaceAtPixel}: the request's values (see there). */
export interface LayeredChartSurfaceAtPixelInput {
  scene: LayeredChartScene;
  /** The capture's output size, pixels. */
  output: { width: number; height: number };
  /** The output pixel, from the top-left (0 to width − 1, 0 to height − 1); its centre is mapped. */
  pixel: { x: number; y: number };
  /** The sensor's pixel pitch (the request's `sensor.pixelPitchMicrometers`, or its camera's). */
  sensor: { pixelPitchMicrometers: number };
  /** The request's lens: focal length, focus (default `subjectDistanceM`), and its `projection` and `distortion` when it has them. */
  lens: { focalLengthMm: number; focusDistanceM?: number; projection?: string; distortion?: unknown };
  /** The request's `subjectDistanceM` (the frame's reference plane). */
  subjectDistanceM: number;
  /** The request's `chartSize`, when it has one: the scene's cards are then in chart units (u = ±1 at the chart's left and right edges). */
  chartSize?: { widthM: number; heightM?: number };
}

/**
 * From 2.29.0 (#747): the surface of a layered chart scene that output pixel (x, y)'s centre sees through the request's lens, or null
 * where the pixel sees no scene (at 90° and beyond, or outside a circular fisheye's image circle). The lens is the rectilinear thin lens,
 * or a `projection` and `distortion` as `simulateCapture` takes them (`lens.catalogue` is not taken). The answer is the surface the
 * display view's pilot and metering read at that pixel (`calculateLayeredChartSurfaceAt` at the mapped frame point; `framePoint` is that
 * point, in the scene's units). `distanceM` is the distance along the axis, the value of a `finite-surface` focus target. Validation as
 * `calculateLayeredChartSurfaceAt`, and `InvalidConfigurationError` for an invalid lens, pixel or size.
 */
export function calculateLayeredChartSurfaceAtPixel(input: LayeredChartSurfaceAtPixelInput): LayeredChartSurfaceAt | null {
  const top = record(input, "calculateLayeredChartSurfaceAtPixel input", ["scene", "output", "pixel", "sensor", "lens", "subjectDistanceM", "chartSize"]);
  const output = record(top.output, "output", ["width", "height"]), W = whole(output.width, "output.width", 2, 65535), H = whole(output.height, "output.height", 2, 65535);
  const pixel = record(top.pixel, "pixel", ["x", "y"]), x = whole(pixel.x, "pixel.x", 0, W - 1), y = whole(pixel.y, "pixel.y", 0, H - 1);
  const pitch = positive(record(top.sensor, "sensor", ["pixelPitchMicrometers"]).pixelPitchMicrometers, "sensor.pixelPitchMicrometers");
  const lens = record(top.lens, "lens", ["focalLengthMm", "focusDistanceM", "projection", "distortion"]), focalLengthMm = positive(lens.focalLengthMm, "lens.focalLengthMm");
  const subjectDistanceM = positive(top.subjectDistanceM, "subjectDistanceM"), focusDistanceM = lens.focusDistanceM === undefined ? subjectDistanceM : positive(lens.focusDistanceM, "lens.focusDistanceM");
  if (!(focusDistanceM * 1000 > focalLengthMm)) fail("lens.focusDistanceM must be beyond the focal length.");
  let chart: { widthM: number; heightM: number } | undefined;
  if (top.chartSize !== undefined) {
    const c = record(top.chartSize, "chartSize", ["widthM", "heightM"]), widthM = positive(c.widthM, "chartSize.widthM");
    chart = { widthM, heightM: c.heightM === undefined ? widthM * H / W : positive(c.heightM, "chartSize.heightM") };
  }
  const projection = lens.projection === undefined ? "rectilinear" : parseLensProjectionModel(lens.projection);
  if (lens.distortion !== undefined && !["radial", "brown-conrady"].includes(record(lens.distortion, "lens.distortion", ["kind", "profile"]).kind as string))
    fail("lens.distortion.kind must be radial or brown-conrady.");
  // The facade's frame (simulate-capture.ts): metres per frame unit at the subject distance, by the thin lens at the focus distance.
  const imageDistanceMm = focalLengthMm * focusDistanceM * 1000 / (focusDistanceM * 1000 - focalLengthMm);
  const metresPerFrameUnit = (W * pitch / 2000) * subjectDistanceM / imageDistanceMm, g = 2 / W;
  let u = (x + 0.5 - W / 2) * g, v = -(y + 0.5 - H / 2) * g;
  const scene = top.scene as LayeredChartScene;
  if (projection !== "rectilinear" || lens.distortion !== undefined) {
    let mapping;
    try {
      mapping = prepareEnvironmentLensFieldMapping({ projectionModel: projection, distortion: lens.distortion ?? { kind: "none" }, radiometricAreaCorrection: "inverse-distortion-jacobian",
        ...(projection === "rectilinear" ? {} : { outsideImageCircle: "backward-ray" }) });
    } catch (error) { return fail("Invalid lens projection or distortion: " + (error as Error).message); }
    const geometry = prepareDefocusImageSpaceGeometry({ focalLengthMm, focusDistanceM, angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, lensMapping: mapping });
    const lensMap = createLayeredLensMap({ geometry, pitchMicrometers: pitch, distanceM: subjectDistanceM, metresPerFrameUnit, zeroBeyondHorizon: true });
    const lattice = createLayeredLatticeGeometry({ nativeWidth: W, nativeHeight: H, outputWidth: W, layers: [{ rect: null, blurRadiusSites: 0, kernel: null }], lensMap });
    const point = lattice.rasterFramePoint(u, v, { u: 0, v: 0, factor: 1 });
    if (point.factor === 0) return null;
    u = point.u; v = point.v;
  }
  if (chart) {
    // #761: chart units, as the request's layered scene reads them.
    const c = metresPerFrameUnit / (chart.widthM / 2);
    u *= c; v *= c;
  }
  const aspect = chart ? chart.heightM / chart.widthM : H / W;
  return calculateLayeredChartSurfaceAt({ scene, aspect, u, v });
}
