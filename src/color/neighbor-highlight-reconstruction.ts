// SPDX-License-Identifier: Apache-2.0

/**
 * #602 (2.22.0): highlight reconstruction from neighboring pixels, `highlightMode: "reconstruct-neighbors"` (opt-in; an estimate,
 * not a recovery of the clipped scene signal). The engine's own method, acting on the developed, white-balanced camera values
 * u = g·c of the whole image at use (no tables):
 *
 * 1. A pixel is clipped when one of its normalized camera channels c_k reaches `NEIGHBOR_HIGHLIGHT_THRESHOLD` of white; clipped
 *    pixels form regions (8-connected).
 * 2. Each unclipped pixel has the color ratios ρ = u/(u₀ + u₁ + u₂) (its chromaticity in white-balanced camera space). Pixels
 *    within `NEIGHBOR_HIGHLIGHT_MARGIN` pixels of a clipped one give no ratios: their demosaic reads clipped sites, which lowers
 *    the clipped channel (and noise selects them by the threshold); the regions below are the clipped pixels widened by it.
 * 3. The clipped region takes its ratios from its unclipped boundary. **Fast:** the mean of ρ over the unclipped pixels within
 *    `NEIGHBOR_HIGHLIGHT_RING` pixels (Chebyshev distance) of the region. **Full:** the discrete harmonic (Laplace) interpolation
 *    of ρ inward: ρ at each clipped pixel is the mean of its 4-neighbors', with the unclipped neighbors' ratios as Dirichlet
 *    boundary values (pixels outside the image are left out), solved by successive over-relaxation from the fast values. A region
 *    with no unclipped neighbor keeps the neutral ratios.
 * 4. A clipped pixel keeps its unclipped channels; its scale s = Σ_unclipped u_k / Σ_unclipped ρ_k, and each clipped channel
 *    becomes max(u_k, s·ρ_k) (never below what was recorded). Where every channel is clipped, s = max_k u_k/ρ_k.
 * The result is not clipped at the white level: the tone curve and gamut handling then render it.
 *
 * Mathematics only, general and free: the discrete Laplace equation and its Dirichlet problem, and successive over-relaxation
 * (e.g. G. Strang, MIT OpenCourseWare 18.086, "Mathematical Methods for Engineers II", finite differences for Laplace's equation
 * and iterative solvers, free at https://ocw.mit.edu/courses/18-086-mathematical-methods-for-engineers-ii-spring-2006/).
 */

/** Normalized channel level at which a channel counts as clipped. */
export const NEIGHBOR_HIGHLIGHT_THRESHOLD = 0.98;
/** Pixels this close (Chebyshev distance) to a clipped pixel give no ratios and are filled with the region. */
export const NEIGHBOR_HIGHLIGHT_MARGIN = 2;
/** The fast method's ring width in pixels around a (widened) clipped region. */
export const NEIGHBOR_HIGHLIGHT_RING = 2;
/** The full method's tolerance (the largest change of a sweep) and iteration cap; the relaxation factor is `neighborHighlightOmega`. */
export const NEIGHBOR_HIGHLIGHT_SOR = /* @__PURE__ */ Object.freeze({ tolerance: 1e-9, maximumIterations: 20000 });

/**
 * #605 (2.23.0): the relaxation factor for a region whose members span a × b pixels: the optimal ω = 2/(1 + √(1 − ρ²)) of SOR
 * for the discrete Laplace equation on the a × b rectangle, whose Jacobi iteration has spectral radius
 * ρ = (cos(π/(a + 1)) + cos(π/(b + 1)))/2 (Young's theory of successive over-relaxation; e.g. G. Strang, MIT OpenCourseWare
 * 18.086, and R. J. LeVeque, "Finite Difference Methods for Ordinary and Partial Differential Equations", SIAM 2007, §4.2).
 * A region inside the rectangle has a Jacobi radius at most that of the rectangle, so this ω is at or above its optimum (where
 * SOR converges at the rate ω − 1). The system (each member's neighbor count times its ratio minus its neighbors') is
 * symmetric positive definite, so SOR converges for every ω in (0, 2) (Ostrowski–Reich). 2.22.0 used ω = 1.8 for every region:
 * 5,728 sweeps on a 260 × 260 region against about 400 (docs/DISPLAY_VIEW.md).
 */
export function neighborHighlightOmega(a: number, b: number): number {
  const rho = (Math.cos(Math.PI / (a + 1)) + Math.cos(Math.PI / (b + 1))) / 2;
  return 2 / (1 + Math.sqrt(Math.max(0, 1 - rho * rho)));
}

export interface NeighborHighlightReport {
  method: "ring-average" | "harmonic-interpolation";
  /** Clipped pixels rebuilt, and the clipped regions. */
  reconstructedPixelCount: number;
  regionCount: number;
  /** Full method: the largest number of relaxation sweeps a region needed, and whether every region met the tolerance. */
  iterations: number;
  converged: boolean;
}

/**
 * The region ratios of an image: per pixel the ratios ρ its rebuild uses (`ratios`, 3 per pixel; for an unclipped pixel its own),
 * and which pixels are clipped. `clippedAt(i)` tells whether pixel i is clipped; `valueAt(i, out)` writes pixel i's u.
 * Pixels are i = y·width + x.
 */
export function neighborHighlightRatios(width: number, height: number, clippedAt: (i: number) => boolean, valueAt: (i: number, out: Float64Array) => void, fast: boolean):
  { clipped: Uint8Array; ratios: Float64Array; regionCount: number; iterations: number; converged: boolean } {
  const n = width * height, clipped = new Uint8Array(n), unknown = new Uint8Array(n), ratios = new Float64Array(3 * n), u = new Float64Array(3), D = NEIGHBOR_HIGHLIGHT_MARGIN;
  for (let i = 0; i < n; i++) if (clippedAt(i)) clipped[i] = 1;
  // The clipped pixels widened by the margin (a separable dilation).
  const rows = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (clipped[y * width + x] === 1) rows.fill(1, y * width + Math.max(0, x - D), y * width + Math.min(width, x + D + 1));
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) if (rows[y * width + x] === 1) for (let yy = Math.max(0, y - D); yy <= Math.min(height - 1, y + D); yy++) unknown[yy * width + x] = 1;
  for (let i = 0; i < n; i++) {
    if (unknown[i] === 1) continue;
    valueAt(i, u);
    const sum = u[0]! + u[1]! + u[2]!;
    if (sum > 0) { ratios[3 * i] = u[0]! / sum; ratios[3 * i + 1] = u[1]! / sum; ratios[3 * i + 2] = u[2]! / sum; }
    else { ratios[3 * i] = 1 / 3; ratios[3 * i + 1] = 1 / 3; ratios[3 * i + 2] = 1 / 3; }
  }
  const label = new Int32Array(n).fill(-1), stamp = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let regionCount = 0, iterations = 0, converged = true;
  for (let start = 0; start < n; start++) {
    if (unknown[start] === 0 || label[start]! >= 0) continue;
    // The region (8-connected), breadth first.
    const region = regionCount++;
    let head = 0, tail = 0;
    queue[tail++] = start; label[start] = region;
    while (head < tail) {
      const p = queue[head++]!, px = p % width, py = (p - px) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const q = y * width + x;
        if (unknown[q] === 1 && label[q]! < 0) { label[q] = region; queue[tail++] = q; }
      }
    }
    // Fast: the mean ratios over the ring (each unclipped pixel once).
    let r0 = 0, r1 = 0, r2 = 0, count = 0;
    const R = NEIGHBOR_HIGHLIGHT_RING;
    for (let k = 0; k < tail; k++) {
      const p = queue[k]!, px = p % width, py = (p - px) / width;
      for (let y = Math.max(0, py - R); y <= Math.min(height - 1, py + R); y++) for (let x = Math.max(0, px - R); x <= Math.min(width - 1, px + R); x++) {
        const q = y * width + x;
        if (unknown[q] === 1 || stamp[q] === region) continue;
        stamp[q] = region; r0 += ratios[3 * q]!; r1 += ratios[3 * q + 1]!; r2 += ratios[3 * q + 2]!; count++;
      }
    }
    const m0 = count > 0 ? r0 / count : 1 / 3, m1 = count > 0 ? r1 / count : 1 / 3, m2 = count > 0 ? r2 / count : 1 / 3;
    for (let k = 0; k < tail; k++) { const p = queue[k]!; ratios[3 * p] = m0; ratios[3 * p + 1] = m1; ratios[3 * p + 2] = m2; }
    if (fast || count === 0) continue;
    // Full: successive over-relaxation of the discrete Laplace equation over the region, in the region's breadth-first order.
    const { tolerance, maximumIterations } = NEIGHBOR_HIGHLIGHT_SOR;
    let x0 = width, x1 = -1, y0 = height, y1 = -1;
    for (let k = 0; k < tail; k++) { const p = queue[k]!, px = p % width, py = (p - px) / width; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    const omega = neighborHighlightOmega(x1 - x0 + 1, y1 - y0 + 1);
    let sweep = 0, change = Infinity;
    while (sweep < maximumIterations && change > tolerance) {
      change = 0; sweep++;
      for (let k = 0; k < tail; k++) {
        const p = queue[k]!, px = p % width, py = (p - px) / width;
        let a0 = 0, a1 = 0, a2 = 0, m = 0;
        for (let d = 0; d < 4; d++) {
          const x = px + (d === 0 ? -1 : d === 1 ? 1 : 0), y = py + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const q = y * width + x;
          a0 += ratios[3 * q]!; a1 += ratios[3 * q + 1]!; a2 += ratios[3 * q + 2]!; m++;
        }
        if (m === 0) continue;
        for (let c = 0; c < 3; c++) {
          const old = ratios[3 * p + c]!, target = (c === 0 ? a0 : c === 1 ? a1 : a2) / m, next = old + omega * (target - old);
          ratios[3 * p + c] = next;
          const delta = Math.abs(next - old);
          if (delta > change) change = delta;
        }
      }
    }
    iterations = Math.max(iterations, sweep);
    if (change > tolerance) converged = false;
  }
  return { clipped, ratios, regionCount, iterations, converged };
}

/**
 * The rebuild of one clipped pixel (step 4) into b, with its slopes ∂b/∂c (row-major 3 × 3, a.e.) when `slopes` is given.
 * `c` are the normalized camera channels, `g` the white-balance gains, `rho` the pixel's ratios.
 */
export function rebuildClippedPixel(c0: number, c1: number, c2: number, g: ArrayLike<number>, rho: ArrayLike<number>, b: Float64Array | number[], slopes?: Float64Array): void {
  const H = NEIGHBOR_HIGHLIGHT_THRESHOLD, u0 = c0 * g[0]!, u1 = c1 * g[1]!, u2 = c2 * g[2]!;
  const k0 = c0 < H, k1 = c1 < H, k2 = c2 < H;
  if (slopes) slopes.fill(0);
  if (k0 && k1 && k2) {
    b[0] = u0; b[1] = u1; b[2] = u2;
    if (slopes) { slopes[0] = g[0]!; slopes[4] = g[1]!; slopes[8] = g[2]!; }
    return;
  }
  const r0 = rho[0]!, r1 = rho[1]!, r2 = rho[2]!;
  if (!k0 && !k1 && !k2) {
    const q0 = r0 > 0 ? u0 / r0 : 0, q1 = r1 > 0 ? u1 / r1 : 0, q2 = r2 > 0 ? u2 / r2 : 0, m = q0 > q1 ? (q0 > q2 ? 0 : 2) : (q1 > q2 ? 1 : 2), s = m === 0 ? q0 : m === 1 ? q1 : q2;
    b[0] = s * r0; b[1] = s * r1; b[2] = s * r2;
    if (slopes) { const rm = m === 0 ? r0 : m === 1 ? r1 : r2; if (rm > 0) for (let k = 0; k < 3; k++) slopes[k * 3 + m] = (k === 0 ? r0 : k === 1 ? r1 : r2) * g[m]! / rm; }
    return;
  }
  const su = (k0 ? u0 : 0) + (k1 ? u1 : 0) + (k2 ? u2 : 0), sr = (k0 ? r0 : 0) + (k1 ? r1 : 0) + (k2 ? r2 : 0), s = sr > 0 ? su / sr : 0;
  for (let k = 0; k < 3; k++) {
    const kept = k === 0 ? k0 : k === 1 ? k1 : k2, uk = k === 0 ? u0 : k === 1 ? u1 : u2, rk = k === 0 ? r0 : k === 1 ? r1 : r2;
    if (kept) { b[k] = uk; if (slopes) slopes[k * 4] = g[k]!; continue; }
    const estimate = s * rk;
    if (estimate > uk) {
      b[k] = estimate;
      if (slopes && sr > 0) for (let j = 0; j < 3; j++) if (j === 0 ? k0 : j === 1 ? k1 : k2) slopes[k * 3 + j] = rk * g[j]! / sr;
    } else { b[k] = uk; if (slopes) slopes[k * 4] = g[k]!; }
  }
}

/**
 * Rebuilds the clipped pixels of a white-balanced image u (3 per pixel, in place; becomes b), with the normalized channels
 * c = u/g deciding which channels are clipped.
 */
export function reconstructHighlightsFromNeighbors(u: Float64Array, width: number, height: number, gains: ArrayLike<number>, fast: boolean): NeighborHighlightReport {
  const H = NEIGHBOR_HIGHLIGHT_THRESHOLD, g0 = gains[0]!, g1 = gains[1]!, g2 = gains[2]!;
  const field = neighborHighlightRatios(width, height, (i) => u[3 * i]! / g0 >= H || u[3 * i + 1]! / g1 >= H || u[3 * i + 2]! / g2 >= H,
    (i, out) => { out[0] = u[3 * i]!; out[1] = u[3 * i + 1]!; out[2] = u[3 * i + 2]!; }, fast);
  const b = new Float64Array(3);
  let rebuilt = 0;
  for (let i = 0; i < width * height; i++) {
    if (field.clipped[i] === 0) continue;
    rebuildClippedPixel(u[3 * i]! / g0, u[3 * i + 1]! / g1, u[3 * i + 2]! / g2, gains, field.ratios.subarray(3 * i, 3 * i + 3), b);
    u[3 * i] = b[0]!; u[3 * i + 1] = b[1]!; u[3 * i + 2] = b[2]!;
    rebuilt++;
  }
  return { method: fast ? "ring-average" : "harmonic-interpolation", reconstructedPixelCount: rebuilt, regionCount: field.regionCount, iterations: field.iterations, converged: field.converged };
}
