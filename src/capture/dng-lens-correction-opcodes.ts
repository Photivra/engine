// SPDX-License-Identifier: Apache-2.0
// This product includes DNG technology under license by Adobe.

/**
 * @internal #587: a catalogue lens's generic corrections (`createGenericLensCorrectionProfile`, the same arithmetic as `output.lensCorrections`)
 * written as a DNG opcode list, so a RAW editor that applies DNG opcodes corrects the DNG non-destructively; the RAW codes are never
 * changed. Written from the Adobe DNG Specification (opcode lists were added in version 1.3.0.0; the repository's writer follows
 * 1.7.1.0), chapter "Opcode List Processing":
 *
 * - The list goes into OpcodeList3 (tag 51022, UNDEFINED), which a reader applies to the linear, demosaiced stage-3 image: the
 *   ActiveArea, which for `simulateCapture` is exactly the output frame. The list is big-endian whatever the file's byte order: a
 *   LONG opcode count, then per opcode its LONG id, the four-byte DNG version that introduced it (1.3.0.0), LONG flags and the LONG
 *   byte count of its parameters. Every opcode is written with flag bit 0 ("optional") set, so a reader that does not support it may
 *   skip it, and bit 1 (preview skip) clear.
 * - FixVignetteRadial (id 3) first, when vignetting is on: parameters k0…k4, cx, cy (DOUBLE); each pixel is multiplied by
 *   g = 1 + k0r² + k1r⁴ + k2r⁶ + k3r⁸ + k4r¹⁰, r the distance from the optical centre (cx, cy) normalized to 1 at the image's
 *   farthest corner. It runs before the warp, so it acts at the captured (source) position, where the capture applied the falloff.
 *   The target gain is the profile's (#584): G(ρ) = det J(ρ_i)/E(ρ), E = (1 − bρ²)² the lens's relative illumination at the
 *   capture's f-number and det J = (1 + k1ρ_i²)(1 + 3k1ρ_i²) at the ideal radius ρ_i with ρ_i(1 + k1ρ_i²) = ρ (the lens's own k1,
 *   whether or not distortion is corrected). G is not a polynomial in r², so k0…k4 are a near-minimax fit of g/G − 1 (Lawson's
 *   iteratively reweighted least squares) on 2 048 radii in [0, 1]; its largest |g/G − 1| there is reported, and a fit worse than
 *   0.1 % is refused (every catalogue lens fits within 0.07 %; GainMap, id 9, would be needed otherwise).
 * - WarpRectilinear (id 1) then, when distortion or lateral colour is on: N = 1 plane (no lateral colour) or 3 planes (red,
 *   green, blue; CFAPlaneColor 0 1 2), each kr0…kr3, kt0, kt1, then cx, cy (DOUBLE). For a destination pixel at normalized
 *   offset (dx, dy) from the centre, r² = dx² + dy², the source is the centre plus (dx, dy)·(kr0 + kr1r² + kr2r⁴ + kr3r⁶) plus the
 *   tangential terms (kt0 = kt1 = 0 here). `output.lensCorrections` reads channel c at s = q(1 + k1|q|²/R²), q = m·a_c·p (R the
 *   half-diagonal, a_c the channel's lateral-colour scale, m the zoom-to-fill factor): so kr0 = m·a_c, kr1 = k1·(m·a_c)³·(R_DNG/R)²,
 *   kr2 = kr3 = 0 represent it exactly (R_DNG the centre-to-corner distance of the stage-3 image; equal to R for `simulateCapture`).
 *   The zoom-to-fill of #570 is folded into kr0, so an editor's result has the corrected JPEG's framing.
 * - The optical centre is the image centre, cx = cy = 0.5 (0 the left or top edge, 1 the right or bottom edge).
 *
 * Limits: the gain is an approximation fitted to the profile (itself a labelled catalogue approximation); a reader's resampling
 * filter, and whether it applies opcodes at all, is the reader's. Some editors apply DNG opcodes automatically with no control in
 * the editor: the switch that is guaranteed is leaving a correction out of the DNG.
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { prepareDevelopedLensCorrection, type ChannelDispersion, type DevelopedLensCorrectionSelection } from "../output/developed-lens-corrections.js";

/** @internal An opcode as written (application order), for the assumptions. */
export type DngLensCorrectionOpcode =
  /** k0…k4 of g = 1 + k0r² + … + k4r¹⁰, and the largest |g/G − 1| on 2 048 radii in [0, 1]. */
  | { opcode: "FixVignetteRadial"; coefficients: number[]; maximumRelativeFitError: number }
  /** kr0…kr3, kt0, kt1 of one plane (all channels) or red, green, blue; the zoom-to-fill 1/m folded into kr0. */
  | { opcode: "WarpRectilinear"; planes: number[][]; magnification: number };

/** @internal Largest accepted |g/G − 1| of the FixVignetteRadial fit. */
export const DNG_VIGNETTE_FIT_TOLERANCE = 1e-3;

/**
 * @internal The OpcodeList3 bytes and the opcodes for a catalogue lens (`resolveGenericLens` at the capture's f-number, on the
 * W × H ActiveArea of pitch `pitchMm`) and the selected corrections, at least one on (see the module notes).
 */
export function createDngLensCorrectionOpcodes(lens: Parameters<typeof prepareDevelopedLensCorrection>[0] & { name: string; character: { vignetting: { cornerStops: number } } },
  selection: DevelopedLensCorrectionSelection, width: number, height: number, pitchMm: number, channels: ChannelDispersion): { opcodeList3: Uint8Array; opcodes: DngLensCorrectionOpcode[] } {
  const opcodes: DngLensCorrectionOpcode[] = [], params: number[][] = [];
  // R_DNG / R: the stage-3 image's centre-to-corner distance over the profile's half-diagonal (1 when the frame is the lens's area).
  const scale = Math.hypot(width, height) / 2 / (lens.halfDiagonalMm / pitchMm);
  if (selection.vignetting) {
    const b = 1 - 2 ** (-lens.character.vignetting.cornerStops / 2), k1 = lens.character.distortion.corner;
    const target = (r: number): number => {
      const rho = r * scale, e = 1 - b * rho * rho;
      let ri = rho;
      for (let n = 0; n < 8; n++) ri -= (ri * (1 + k1 * ri * ri) - rho) / (1 + 3 * k1 * ri * ri);
      return (1 + k1 * ri * ri) * (1 + 3 * k1 * ri * ri) / (e * e);
    };
    // Near-minimax fit of the relative error g/G − 1 (t = r²: rows t^j/G, j = 1…5, against 1 − 1/G) by Lawson's iteratively
    // reweighted least squares on 2 048 radii in [0, 1] (normal equations, positive definite); of 64 iterations the one with the
    // smallest largest error on those radii is kept.
    const radii = Array.from({ length: 2048 }, (_, i) => { const r = i / 2047; return [r * r, target(r), 1]; });
    let best = [0, 0, 0, 0, 0], worst = Infinity;
    for (let iteration = 0; iteration < 64; iteration++) {
      const a = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0, 0]), k = [0, 0, 0, 0, 0];
      for (const [t, G, w] of radii) {
        const row = [t!, t! ** 2, t! ** 3, t! ** 4, t! ** 5, G! - 1].map((v) => v / G!);
        for (let j = 0; j < 5; j++) for (let m = 0; m < 6; m++) a[j]![m]! += w! * row[j]! * row[m]!;
      }
      for (let j = 0; j < 5; j++) for (let i = j + 1; i < 5; i++) { const f = a[i]![j]! / a[j]![j]!; for (let m = j; m < 6; m++) a[i]![m]! -= f * a[j]![m]!; }
      for (let j = 4; j >= 0; j--) k[j] = (a[j]![5]! - a[j]!.slice(j + 1, 5).reduce((sum, v, m) => sum + v * k[j + 1 + m]!, 0)) / a[j]![j]!;
      const errors = radii.map(([t, G]) => Math.abs((1 + t! * (k[0]! + t! * (k[1]! + t! * (k[2]! + t! * (k[3]! + t! * k[4]!))))) / G! - 1)), max = Math.max(...errors);
      if (max < worst) { worst = max; best = k; }
      radii.forEach((p, i) => { p[2] = p[2]! * (errors[i]! / max + 1e-9); });
    }
    if (!(worst <= DNG_VIGNETTE_FIT_TOLERANCE)) throw new InvalidConfigurationError("output.dng.lensCorrectionOpcodes: FixVignetteRadial cannot hold " + lens.name + "'s vignetting gain within 0.1 %.");
    opcodes.push({ opcode: "FixVignetteRadial", coefficients: best, maximumRelativeFitError: worst });
    params.push([...best, 0.5, 0.5]);
  }
  if (selection.distortion || selection.lateralColor) {
    const c = prepareDevelopedLensCorrection(lens, { ...selection, vignetting: false }, width, height, pitchMm, channels);
    const planes = (selection.lateralColor ? c.scales : [1]).map((s) => { const a = c.fill * s; return [a, c.k1 * a ** 3 * scale * scale, 0, 0, 0, 0]; });
    opcodes.push({ opcode: "WarpRectilinear", planes, magnification: 1 / c.fill });
    params.push([planes.length, ...planes.flat(), 0.5, 0.5]);
  }
  // Big-endian: the count, then per opcode its id, DNG version 1.3.0.0, flags 1 (optional), parameter bytes and parameters
  // (all DOUBLE but WarpRectilinear's leading LONG plane count).
  const size = (i: number): number => params[i]!.length * 8 - (opcodes[i]!.opcode === "WarpRectilinear" ? 4 : 0);
  const bytes = new Uint8Array(4 + params.reduce((sum, _, i) => sum + 16 + size(i), 0)), view = new DataView(bytes.buffer);
  view.setUint32(0, opcodes.length);
  let at = 4;
  params.forEach((values, i) => {
    const warp = opcodes[i]!.opcode === "WarpRectilinear";
    view.setUint32(at, warp ? 1 : 3); view.setUint32(at + 4, 0x01030000); view.setUint32(at + 8, 1); view.setUint32(at + 12, size(i)); at += 16;
    values.forEach((v, j) => { if (warp && j === 0) { view.setUint32(at, v); at += 4; } else { view.setFloat64(at, v); at += 8; } });
  });
  return { opcodeList3: bytes, opcodes };
}
