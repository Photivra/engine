// SPDX-License-Identifier: Apache-2.0
/**
 * Shared by test/display-view-lens-offset-expansion-1.test.ts to -6.test.ts (#685; split in six for #755 so that the weighted
 * sequencer can spread them over the coverage shards): the fast method `lens.catalogue/view-offset-expansion`
 * (display-view-lens-signal.ts, `offsetExpansion`) against the full method (each offset through the lens). Go/no-go (the
 * uniform-window method's own): every site within 1e-6 relative of the full method.
 */
import { GENERIC_LENS_CATALOGUE, resolveGenericLens, type GenericLensCatalogueEntry, type SimulateCaptureOptions } from "../../src/index.js";
import { prepareDisplayViewLensSignal } from "../../src/facade/display-view-lens-signal.js";
import { createOffsetExpansion } from "../../src/facade/display-view-offset-expansion.js";
import { exposure, fullFrame } from "./display-view-lens-catalogue.js";
import { prepare } from "./display-view-lens-uniform-windows.js";

export const BOUND = 1e-6;
export const BOX = { pixelAperture: { kind: "box", samplesPerAxis: 2 } };

/** The largest relative difference, expansion against the full method, on every `step`-th row (and the last). */
export async function check(options: SimulateCaptureOptions, step = 61): Promise<{ largest: number }> {
  const { lens: setup, W, H, input } = await prepare(options);
  const rows = [...Array.from({ length: Math.ceil(H / step) }, (_, k) => step * k), H - 1];
  const full = prepareDisplayViewLensSignal({ ...setup, uniformWindows: false, offsetExpansion: undefined }, W, H, 0, "test")(input);
  const fast = prepareDisplayViewLensSignal({ ...setup, uniformWindows: false, offsetExpansion: createOffsetExpansion }, W, H, 0, "test")(input);
  let largest = 0;
  for (const y of rows) {
    full.window(0, y, W, y + 1); fast.window(0, y, W, y + 1);
    for (let x = 0; x < W; x++) { const a = fast.site(x, y), b = full.site(x, y); largest = Math.max(largest, b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / b); }
  }
  return { largest };
}

/** Dead leaves on a full frame at 12 µm through a catalogue lens at `fNumber`, focused at twice its minimum focus distance. */
export const request = (lensId: string, fNumber: number, sensor: Record<string, unknown>): SimulateCaptureOptions => {
  const resolved = resolveGenericLens({ lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
  return { scene: { preset: "dead-leaves" }, output: fullFrame(12), sensor: { pixelPitchMicrometers: 12, spectralStepNanometers: 80, ...sensor },
    subjectDistanceM: resolved.minimumFocusDistanceM * 2, exposure: { ...exposure, shutterSeconds: (fNumber / 8) ** 2 / 125 }, lens: { catalogue: lensId, fNumber } };
};

/**
 * The catalogue lenses the every-lens check covers (every set but the phones; no fisheye: rays beyond 90° keep the full method),
 * dealt in catalogue order into four parts of about equal time (#755): measured locally without coverage, 15 to 18 s each and
 * 66 s together, about 5.2 times that under coverage (the long lenses at their narrowest f-number cost the most, and dealing
 * spreads them). A lens added to the catalogue joins the part its position deals it to.
 */
export function offsetExpansionLenses(part: 1 | 2 | 3 | 4): GenericLensCatalogueEntry[] {
  return GENERIC_LENS_CATALOGUE.filter((lens) => lens.set !== "phone" && lens.kind !== "fisheye").filter((_, index) => index % 4 === part - 1);
}

/** Every site within the bound on each lens of `lenses`, wide open and at its narrowest, with the 2 × 2 box; the largest difference. */
export async function everyLensCheck(lenses: readonly GenericLensCatalogueEntry[], expectWithin: (largest: number, label: string) => void): Promise<number> {
  let largest = 0;
  for (const lens of lenses) {
    const resolved = resolveGenericLens({ lensId: lens.lensId, activeImagingArea: { widthMm: 36, heightMm: 24 } });
    for (const fNumber of [resolved.widestFNumber, resolved.narrowestFNumber]) {
      const r = await check(request(lens.lensId, fNumber, BOX), 97);
      largest = Math.max(largest, r.largest);
      expectWithin(r.largest, lens.lensId + " f/" + fNumber);
    }
  }
  return largest;
}
