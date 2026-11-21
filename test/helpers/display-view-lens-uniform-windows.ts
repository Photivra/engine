// SPDX-License-Identifier: Apache-2.0
/**
 * Shared by test/display-view-lens-catalogue-regrouped-1.test.ts and -2.test.ts (#655, split for #693): the catalogue-lens view's
 * prepared signal input, and #655 step 6's go/no-go check of the uniform-window method against the full method.
 */
import { GENERIC_LENS_CATALOGUE, resolveGenericLens, type GenericLensCatalogueEntry, type SimulateCaptureOptions } from "../../src/index.js";
import { simulateDisplayViewWithInternals } from "../../src/facade/simulate-display-view.js";
import { lastDisplayViewLensSetup, prepareDisplayViewLensSignal, type DisplayViewLensSetup } from "../../src/facade/display-view-lens-signal.js";
import type { DisplayViewExpectedSignal, DisplayViewExpectedSignalInput } from "../../src/facade/expected-signal.js";
import { exposure, fullFrame } from "./display-view-lens-catalogue.js";

export interface Prepared { lens: DisplayViewLensSetup; W: number; H: number; input: DisplayViewExpectedSignalInput }
export async function prepare(options: SimulateCaptureOptions): Promise<Prepared> {
  const { signalInput } = await simulateDisplayViewWithInternals(options, { width: 4, height: 4, samplesPerAxis: 1 });
  const last = lastDisplayViewLensSetup()!;
  return { lens: last.lens, W: last.nativeWidth, H: last.nativeHeight, input: signalInput };
}

/**
 * The catalogue lenses the uniform-window check covers (every set but the phones), in two parts of about equal time (#693): the
 * professional set, and every other set. Under coverage on CI the whole check took 815 to 1,004 s in one test, which set its shard's
 * run time; measured locally without coverage the two parts take 30 s and 36 s. A lens added to the catalogue joins its set's part.
 */
export function uniformWindowLenses(part: 1 | 2): GenericLensCatalogueEntry[] {
  return GENERIC_LENS_CATALOGUE.filter((lens) => lens.set !== "phone" && (lens.set === "professional") === (part === 1));
}

/**
 * The uniform-window method (a site whose taps all read one material takes the field factor to second order) against the full method,
 * per site, at each lens's widest and narrowest aperture, on every 61st row of the frame (corners and edges included through the first
 * and last rows): the largest relative difference, and the uniform-window and total site counts.
 */
export async function uniformWindowCheck(lenses: readonly GenericLensCatalogueEntry[]): Promise<{ largest: number; uniformSites: number; total: number }> {
  let largest = 0, uniformSites = 0, total = 0;
  for (const lens of lenses) {
    const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
    for (const fNumber of [resolved.widestFNumber, resolved.narrowestFNumber]) {
      const options: SimulateCaptureOptions = { scene: { preset: "dead-leaves" }, output: fullFrame(12), sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80 },
        subjectDistanceM: resolved.minimumFocusDistanceM * 2, exposure: { ...exposure, shutterSeconds: (fNumber / 8) ** 2 / 125 }, lens: { catalogue: lens.lensId, fNumber } };
      const { lens: setup, W, H, input } = await prepare(options);
      const rows = [...Array.from({ length: Math.ceil(H / 61) }, (_, k) => 61 * k), H - 1];
      const full = prepareDisplayViewLensSignal({ ...setup, uniformWindows: false }, W, H, 0, "test")(input);
      const fast = prepareDisplayViewLensSignal({ ...setup, uniformWindows: true }, W, H, 0, "test")(input) as DisplayViewExpectedSignal & { uniformWindowSites: number };
      for (const y of rows) {
        full.window(0, y, W, y + 1); fast.window(0, y, W, y + 1);
        for (let x = 0; x < W; x++) { const a = fast.site(x, y), b = full.site(x, y); largest = Math.max(largest, b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / b); total++; }
      }
      uniformSites += fast.uniformWindowSites;
      if (process.env.UNIFORM_REPORT) process.stdout.write(lens.lensId + " f/" + fNumber + ": " + largest.toExponential(2) + "\n");
    }
  }
  if (process.env.UNIFORM_REPORT) process.stdout.write("uniform windows: largest " + largest.toExponential(3) + ", uniform " + uniformSites + " of " + total + " sites\n");
  return { largest, uniformSites, total };
}
