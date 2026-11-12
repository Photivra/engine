// SPDX-License-Identifier: Apache-2.0

/**
 * #549: `simulateCapture` with `lens.catalogue`. Each characteristic of the owner's table is measured on its chart, and the
 * professional lens is better than the consumer one where the table says so:
 * - sharpness across the frame: slanted edges at the centre and the corner of a full frame (10–90 % edge rise);
 * - coma: a point at the corner (outward centroid shift wide open minus stopped down, which leaves only coma: lateral colour
 *   does not change with the aperture and the other aberrations are symmetric);
 * - lateral colour: the blue–red edge offset at the corner (minus the centre's, the demosaic's own offset);
 * - distortion: the bow of a grid line near the frame edge; vignetting: a uniform field's corner fall-off;
 * - fisheyes: the circular image and the full-frame one. Plus `lens.defocus`, `lens.focusScatter` and the refusals.
 * 2.24.0: distortion, vignetting, the fisheyes and the options are in test/simulate-capture-lens-catalogue-2.test.ts (split so that each file
 * fits its coverage shard; the checks are unchanged), with the shared helpers in test/helpers/lens-catalogue-charts.ts.
 */
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "./helpers/test-timeout.js";
import { widest, frame, regionCapture, edge, slantedEdge, point, radialCentroidOffset, fastAgrees } from "./helpers/lens-catalogue-charts.js";

describe("simulateCapture lens.catalogue on the charts (#549)", () => {
  const PRO = "pv-24-1.4-pro", CONSUMER = "pv-24-1.8";

  it("sharpness across the frame: the pro lens's edges are sharper at the centre and the corner, and the consumer's corner is softer than its centre", async () => {
    const rise = async (id: string, where: "centre" | "corner", fNumber = widest(id)): Promise<number> => {
      const exact = edge(await regionCapture(id, fNumber, 6, 48, where, slantedEdge)).rise, fast = edge(await regionCapture(id, fNumber, 6, 48, where, slantedEdge, true)).rise;
      fastAgrees("rise", id + " " + where, fast, exact);
      return exact;
    };
    const proCentre = await rise(PRO, "centre"), proCorner = await rise(PRO, "corner"), consumerCentre = await rise(CONSUMER, "centre"), consumerCorner = await rise(CONSUMER, "corner");
    expect(proCorner).toBeLessThan(consumerCorner);
    expect(proCentre).toBeLessThanOrEqual(consumerCentre);
    expect(consumerCorner).toBeGreaterThan(consumerCentre + 0.2);
    // Measured 2026-11-09 (6 µm, 48 rows): pro 0.91 / 1.32 px, consumer 1.01 / 1.56 px (centre / corner). #589's centroid alignment
    // widened the corner kernels (2026-11-07, before it: pro 1.08 px, consumer 1.43 px at the corner).
    expect(consumerCorner - proCorner).toBeGreaterThan(0.2);
  }, scaledTimeout(120_000));

  it("coma: the consumer lens's corner point flares outward wide open; the pro lens's much less", async () => {
    const f = frame(3, 32, "corner"), shift = async (id: string, fast: boolean): Promise<number> =>
      radialCentroidOffset(await regionCapture(id, widest(id), 3, 32, "corner", point, fast), f.centre) - radialCentroidOffset(await regionCapture(id, 5.6, 3, 32, "corner", point, fast), f.centre);
    const comaShift = async (id: string): Promise<number> => { const exact = await shift(id, false); fastAgrees("coma", id, await shift(id, true), exact); return exact; };
    const consumer = await comaShift(CONSUMER), pro = await comaShift(PRO);
    // Measured 2026-11-09 (3 µm, 50 nm spectral step): consumer 0.35 px outward, pro 0.10 px (before #589's centroid alignment the
    // site cells quantized the pro lens's narrow PSF: 0.02 px).
    expect(consumer).toBeGreaterThan(0.25);
    expect(pro).toBeLessThan(consumer / 3);
  }, scaledTimeout(240_000));

  it("lateral colour: blue and red edges separate at the corner, more with the consumer lens", async () => {
    const offset = async (id: string, fast: boolean): Promise<number> => edge(await regionCapture(id, widest(id), 6, 48, "corner", slantedEdge, fast)).blueMinusRed -
      edge(await regionCapture(id, widest(id), 6, 48, "centre", slantedEdge, fast)).blueMinusRed;
    const ca = async (id: string): Promise<number> => { const exact = await offset(id, false); fastAgrees("lateral", id, await offset(id, true), exact); return exact; };
    const consumer = await ca(CONSUMER), pro = await ca(PRO);
    // Measured 2026-11-09: consumer 0.68 px, pro 0.44 px. The developed edge is not the lens's displacement (RAW, 0.80 and 0.22 px,
    // test/simulate-capture-lens-catalogue-lateral-color.test.ts): the color matrix that undoes the channels' overlap amplifies a
    // blue-green offset, which a narrow PSF keeps sharp and a wide one smooths, and the 50 % point is the LSF's median, not its mean.
    expect(consumer).toBeGreaterThan(0.5);
    expect(pro).toBeLessThan(consumer);
    expect(pro).toBeGreaterThan(0);
  }, scaledTimeout(120_000));
});
