// SPDX-License-Identifier: Apache-2.0

/**
 * #632: the reports of the catalogue lens's opt-in optics (focus breathing, veiling glare), loaded with the opt-in kit
 * (`src/facade/opt-in-kit.ts`) only when a request uses them. The rendering itself is the lens signals' (`catalogue-lens-signal.ts`, `display-view-lens-signal.ts`) and the
 * plane distance the renderers read.
 */

import type { ResolvedGenericLens } from "../equipment/generic-lens-catalogue.js";

type Assume = (id: string, kind: "model", value: unknown, explanation: string) => void;

/** #632: the breathing and flare assumptions of a capture. */
export function catalogueOpticsAssumptions(assume: Assume, lens: ResolvedGenericLens, breathing: { scale: number; planeDistanceM: number } | undefined, flare: boolean,
  veil: { fraction: number; step: number } | undefined): void {
  if (breathing) assume("lens.catalogue.breathing", "model", { fieldOfViewChange: breathing.scale - 1, breathingScale: breathing.scale, planeDistanceM: breathing.planeDistanceM },
    "Focus breathing (#632): field of view × (1 + Δ) at the requested focus (rays meet the plane at d·(1 + Δ)); irradiance and metering unchanged.");
  const stray = lens.character.strayLight;
  if (flare) assume("lens.catalogue.flare", "model", { veilingGlareFraction: stray.veilingGlareFraction, ghostFraction: stray.ghostFraction, ghostsRendered: false,
    rendered: veil !== undefined, ...(veil ? { latticeStep: veil.step } : {}) },
  (veil ? "Veiling glare (#632): per site (1 − g)·μ + g·Σ A_c(λ)·Ē(λ), Ē the frame's mean of field factor × radiance on the site lattice. " : "Not in the ideal reference. ") +
    "Ghosts are not rendered: the catalogue gives only their power.");
}
