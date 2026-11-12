// SPDX-License-Identifier: Apache-2.0
/**
 * #604 research only (not shipped, not part of `npm test`): records the display-view inputs the AHD bias depends on for the
 * cases of docs/research/ahd-bias-correction.md — the readout scale and noise per channel, the white-balance gains, the
 * highlight clip, the development matrix, the tone curve, AHD's homogeneity matrix and the flat field's normalized channel
 * means at the frame center — and writes them to scripts/research/ahd-bias/setups.json for `ahd-bias.mjs`.
 *
 *   npx vitest run --config scripts/research/ahd-bias/vitest.research.config.ts
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { simulateDisplayViewWithInternals } from "../../../src/facade/simulate-display-view.js";
import type { SimulateCaptureOptions } from "../../../src/facade/simulate-capture.js";

const CASES: { id: string; label: string; options: SimulateCaptureOptions }[] = [
  { id: "phone-18-6400", label: "1.4 µm, 18 % grey, ISO 6400, f/8",
    options: { scene: { preset: "uniform", reflectance: 0.18 }, lens: { fNumber: 8 }, exposure: { iso: 6400, shutterSeconds: 1 / 8000 }, sensor: { pixelPitchMicrometers: 1.4 }, output: { width: 400, height: 300, demosaic: "ahd" } } },
  { id: "phone-03-6400", label: "1.4 µm, 3 % grey, ISO 6400, f/8",
    options: { scene: { preset: "uniform", reflectance: 0.03 }, lens: { fNumber: 8 }, exposure: { iso: 6400, shutterSeconds: 1 / 8000 }, sensor: { pixelPitchMicrometers: 1.4 }, output: { width: 400, height: 300, demosaic: "ahd" } } },
  { id: "ff-18-6400", label: "6 µm, 18 % grey, ISO 6400, f/8",
    options: { scene: { preset: "uniform", reflectance: 0.18 }, lens: { fNumber: 8 }, exposure: { iso: 6400, shutterSeconds: 1 / 8000 }, sensor: { pixelPitchMicrometers: 6 }, output: { width: 600, height: 400, demosaic: "ahd" } } },
  { id: "ff-03-6400", label: "6 µm, 3 % grey, ISO 6400, f/8",
    options: { scene: { preset: "uniform", reflectance: 0.03 }, lens: { fNumber: 8 }, exposure: { iso: 6400, shutterSeconds: 1 / 8000 }, sensor: { pixelPitchMicrometers: 6 }, output: { width: 600, height: 400, demosaic: "ahd" } } },
  { id: "ff-18-400", label: "6 µm, 18 % grey, ISO 400, f/8",
    options: { scene: { preset: "uniform", reflectance: 0.18 }, lens: { fNumber: 8 }, exposure: { iso: 400, shutterSeconds: 1 / 500 }, sensor: { pixelPitchMicrometers: 6 }, output: { width: 600, height: 400, demosaic: "ahd" } } }
];

it("records the AHD bias inputs of the research cases", async () => {
  const out = [];
  for (const c of CASES) {
    const { setup, signal } = await simulateDisplayViewWithInternals(c.options, { width: 48, height: 32 });
    const cx = 2 * Math.floor(setup.nativeWidth / 4), cy = 2 * Math.floor(setup.nativeHeight / 4);
    signal.window(cx - 4, cy - 4, cx + 4, cy + 4);
    // Bayer RGGB phase of the native raster: (even, even) red, (odd, odd) blue.
    const electrons = [signal.site(cx, cy), signal.site(cx + 1, cy), signal.site(cx + 1, cy + 1)];
    const mean = electrons.map((e, ch) => setup.readout[ch]!.perElectron * (e + setup.readout[ch]!.darkElectrons));
    out.push({ id: c.id, label: c.label, options: c.options, mean, readout: setup.readout, gains: setup.gains, clipLevel: setup.clipLevel, matrix: setup.matrix,
      toneCurve: setup.toneCurve, labMatrix: setup.ahdChoice!.labMatrix, nativeWidth: setup.nativeWidth, nativeHeight: setup.nativeHeight });
  }
  writeFileSync(new URL("./setups.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
}, 600_000);
