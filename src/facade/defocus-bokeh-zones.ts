// SPDX-License-Identifier: Apache-2.0

/**
 * `lens.defocus` with a cat's eye (#553): the field zones of the capture's field-varying defocus kernel. The native raster is
 * cut into square zones (`fieldZonesAcrossLongSide` across its long side); each zone's kernel is the shaped kernel of the
 * field point at the zone's centre (`createDefocusBokehSiteKernel`), padded to the axis kernel's radius (the cat's eye only
 * removes light from the opening, so no zone's blur reaches further than the unclipped one). The gather
 * (`createZonedGather`) gives every site its zone's kernel: a piecewise-constant approximation of the space-variant blur,
 * whose step between neighbouring zones is reported (the largest change of the open-area ratio). Internal.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import type { SiteKernelFieldZones } from "./diffraction-provider.js";
import { openPupilAreaRatio, type DefocusBokehSiteKernel, type ResolvedDefocusBokehOptions } from "../optics/defocus-bokeh-kernel.js";

export interface DefocusBokehZonePlan {
  zones: SiteKernelFieldZones;
  /** Field tangent of each zone centre (output-image axes, +Y up), row-major. */
  fields: readonly { x: number; y: number }[];
  /** Smallest open-area ratio over the zone centres, and the largest change between two zones sharing an edge. */
  minimumOpenAreaRatio: number;
  largestAdjacentOpenAreaRatioChange: number;
}

/**
 * Plans the zones. `fieldOf(x, y)` is the field tangent of native point (x, y) in sites from the raster's top-left corner;
 * `kernelAt(field)` builds a zone's kernel (its radius at most `radius`). Kernels are built on first use by the gather.
 */
export function planDefocusBokehZones(input: { options: ResolvedDefocusBokehOptions; nativeWidth: number; nativeHeight: number; radius: number;
  fNumber: number; focalLengthMm: number; fieldOf: (x: number, y: number) => { x: number; y: number }; kernelAt: (field: { x: number; y: number }) => DefocusBokehSiteKernel }): DefocusBokehZonePlan {
  const { options, nativeWidth: W, nativeHeight: H, radius: R } = input;
  const across = options.catsEye!.fieldZonesAcrossLongSide, size = Math.ceil(Math.max(W, H) / across);
  const columns = Math.ceil(W / size), rows = Math.ceil(H / size), fields: { x: number; y: number }[] = [], ratios: number[] = [];
  for (let zy = 0; zy < rows; zy++) for (let zx = 0; zx < columns; zx++) {
    const field = input.fieldOf((zx * size + Math.min(W, (zx + 1) * size)) / 2, (zy * size + Math.min(H, (zy + 1) * size)) / 2);
    fields.push(field);
    ratios.push(openPupilAreaRatio(options, input.fNumber, input.focalLengthMm, field));
  }
  let minimum = Infinity, step = 0;
  for (let zy = 0; zy < rows; zy++) for (let zx = 0; zx < columns; zx++) {
    const r = ratios[zy * columns + zx]!;
    minimum = Math.min(minimum, r);
    if (zx + 1 < columns) step = Math.max(step, Math.abs(r - ratios[zy * columns + zx + 1]!));
    if (zy + 1 < rows) step = Math.max(step, Math.abs(r - ratios[(zy + 1) * columns + zx]!));
  }
  const width = 2 * R + 1;
  return {
    fields, minimumOpenAreaRatio: minimum, largestAdjacentOpenAreaRatioChange: step,
    zones: { size, columns, rows, kernelOf(zone: number): Float64Array {
      const k = input.kernelAt(fields[zone]!);
      if (k.radius === R) return k.weights;
      if (k.radius > R) throw new InvalidConfigurationError("lens.defocus: a cat's-eye zone kernel reaches beyond the unclipped kernel's radius.");
      const padded = new Float64Array(width * width), offset = R - k.radius;
      for (let j = 0; j < k.width; j++) for (let i = 0; i < k.width; i++) padded[(j + offset) * width + i + offset] = k.weights[j * k.width + i]!;
      return padded;
    } }
  };
}
