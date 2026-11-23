// SPDX-License-Identifier: Apache-2.0

/**
 * #740 (2.29.0): a saturation change in linear light, out = Y + gain·(RGB − Y), with Y the luminance of the working space (the Y row
 * of its RGB → XYZ matrix, `luminanceWeights`). It scales each pixel's distance from the neutral of the same luminance: gain 1 leaves
 * the pixel as it is, gain 0 gives the neutral Y, a neutral pixel keeps its value for every gain, and Y itself is unchanged (the
 * weights sum to 1). It is the saturation matrix of Haeberli, "Matrix Operations for Image Processing" (Silicon Graphics Grafica
 * Obscura, 1993, free), out = (1 − s)·Y + s·RGB, applied in linear light with the working space's own luminance weights; a rendering
 * choice, not a perceptual model. Closed form per pixel; no table.
 * @see docs/PROCESSING.md, "Typical processing stages".
 */

/**
 * Applies the saturation gain to interleaved linear RGB in place. Y is formed as G + w_r·(R − G) + w_b·(B − G), which equals
 * w_r·R + w_g·G + w_b·B when w_r + w_g + w_b = 1 and is exactly G (so the pixel is unchanged) when R = G = B. Gain 1 returns at
 * once, so it is the identity bit for bit. Returns the number of output components below 0 (a gain above 1 can push a saturated
 * color out of the gamut; the caller's gamut handling deals with them).
 */
export function applySaturation(data: Float32Array | Float64Array, pixels: number, gain: number, weights: readonly [number, number, number]): number {
  if (gain === 1) return 0;
  const [wr, , wb] = weights;
  let negative = 0;
  for (let p = 0; p < pixels; p++) {
    const i = 3 * p, r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, y = g + wr * (r - g) + wb * (b - g);
    const R = y + gain * (r - y), G = y + gain * (g - y), B = y + gain * (b - y);
    data[i] = R; data[i + 1] = G; data[i + 2] = B;
    if (R < 0) negative++;
    if (G < 0) negative++;
    if (B < 0) negative++;
  }
  return negative;
}
