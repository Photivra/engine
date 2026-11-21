// SPDX-License-Identifier: Apache-2.0
/**
 * #684: `prepareRgbGamutMapping(...).map` returns an in-gamut colour below the knee without the boundary search when its ray is
 * inside the cube a little beyond chroma / k (L* below 85, chroma above 1e-6). Gate: the result equals the search's, compared with
 * `Object.is` against a transcription of the search on the cube's surface (scaled), an interior lattice and two knees in all three
 * spaces; and the premise (each constant-L*, constant-hue ray's in-cube part is one interval below L* 85) holds on a ray grid.
 */
import { describe, expect, it, vi } from "vitest";
import { prepareRgbGamutMapping, type RgbColorSpaceId } from "../src/index.js";
import { cielabOfXyz, xyzOfCielab } from "../src/color/color-difference.js";
import { multiplyMatrixVector, vectorToXyz, xyzToVector, type ColorVector3 } from "../src/color/colorimetry-math.js";
import { resolveRgbColorSpace } from "../src/color/rgb-color-spaces.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

// Counts the boundary evaluations (each converts one L*a*b* point back to XYZ).
const evaluations = vi.hoisted(() => ({ count: 0 }));
vi.mock("../src/color/color-difference.js", async (original) => {
  const module = await original<typeof import("../src/color/color-difference.js")>();
  return { ...module, xyzOfCielab: (...args: Parameters<typeof module.xyzOfCielab>): ReturnType<typeof module.xyzOfCielab> => (evaluations.count++, module.xyzOfCielab(...args)) };
});

const SPACES: RgbColorSpaceId[] = ["srgb", "display-p3", "rec2020"];
const inCube = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-12 && v <= 1 + 1e-12);
/** 2.27.0's `map` (the search for every colour), transcribed. */
function searched(space: RgbColorSpaceId, k: number): (xyz: ColorVector3) => { linearRgb: number[]; adjusted: boolean; lightnessClipped: boolean } {
  const s = resolveRgbColorSpace(space).value, white = s.whiteXyz;
  const toRgb = (lStar: number, a: number, b: number): ColorVector3 => multiplyMatrixVector(s.xyzToRgb, xyzToVector(xyzOfCielab({ lStar, aStar: a, bStar: b }, white)));
  const clamp = (rgb: readonly number[]): number[] => rgb.map((v) => Math.min(1, Math.max(0, v)));
  return (xyzInput) => {
    const rgb = multiplyMatrixVector(s.xyzToRgb, xyzInput), lab = cielabOfXyz(vectorToXyz(xyzInput), white);
    if (!(lab.lStar > 0)) return { linearRgb: [0, 0, 0], adjusted: !rgb.every((v) => v === 0), lightnessClipped: true };
    if (lab.lStar >= 100) return { linearRgb: [1, 1, 1], adjusted: !rgb.every((v) => Math.abs(v - 1) <= 1e-12), lightnessClipped: lab.lStar > 100 };
    const chroma = Math.hypot(lab.aStar, lab.bStar), inside = inCube(rgb);
    if (chroma === 0 || (inside && k === 1)) return { linearRgb: clamp(rgb), adjusted: false, lightnessClipped: false };
    const ua = lab.aStar / chroma, ub = lab.bStar / chroma;
    let lo = 0, hi = chroma;
    if (inside) { hi = Math.max(chroma, 1); while (inCube(toRgb(lab.lStar, ua * hi, ub * hi)) && hi < 1e4) hi *= 2; }
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (inCube(toRgb(lab.lStar, ua * mid, ub * mid))) lo = mid; else hi = mid; }
    const cMax = lo, knee = k * cMax;
    let mapped = chroma;
    if (chroma > knee) { mapped = k === 1 || cMax === 0 ? cMax : knee + (1 - k) * cMax * Math.tanh((chroma - knee) / ((1 - k) * cMax)); mapped = Math.min(mapped, cMax); }
    if (mapped === chroma && inside) return { linearRgb: clamp(rgb), adjusted: false, lightnessClipped: false };
    return { linearRgb: clamp(toRgb(lab.lStar, ua * mapped, ub * mapped)), adjusted: true, lightnessClipped: false };
  };
}
const decode = (c: number): number => { const e = c / 255; return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4; };
/** 8-bit triples on the cube's surface (every fifth level) scaled by 0.5, 0.9, 0.99 and 1, and a 16³ interior lattice. */
function* colours(): Generator<ColorVector3> {
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) {
    const edge = r === 0 || g === 0 || b === 0 || r === 255 || g === 255 || b === 255;
    if (edge) for (const s of [0.5, 0.9, 0.99, 1]) yield [decode(r) * s, decode(g) * s, decode(b) * s];
  }
  for (let r = 8; r < 256; r += 16) for (let g = 8; g < 256; g += 16) for (let b = 8; b < 256; b += 16) yield [decode(r), decode(g), decode(b)];
}

describe("perceptual gamut mapping: the early-out below the knee (#684)", () => {
  it("maps a near-neutral colour below the knee with one boundary evaluation instead of the search's 60 or more", () => {
    const mapper = prepareRgbGamutMapping({ colorSpace: "srgb", method: "cielab-hue-preserving-chroma-compression", kneeFraction: 0.9 });
    const M = resolveRgbColorSpace("srgb").value.rgbToXyz;
    for (const rgb of [[0.18, 0.181, 0.179], [0.5, 0.49, 0.51], [0.05, 0.051, 0.05]] as ColorVector3[]) {
      evaluations.count = 0;
      const result = mapper.map(multiplyMatrixVector(M, rgb));
      expect(result.adjusted).toBe(false);
      expect(evaluations.count).toBe(1);
    }
  });

  it("gives the search's result for every tested colour, knee and space", () => {
    for (const space of SPACES) {
      const M = resolveRgbColorSpace(space).value.rgbToXyz;
      for (const k of [0.5, 0.9]) {
        const mapper = prepareRgbGamutMapping({ colorSpace: space, method: "cielab-hue-preserving-chroma-compression", kneeFraction: k }), reference = searched(space, k);
        let count = 0, differ = 0;
        for (const rgb of colours()) {
          const xyz = multiplyMatrixVector(M, rgb), a = mapper.map(xyz), b = reference(xyz);
          count++;
          if (!(a.linearRgb.every((v, i) => Object.is(v, b.linearRgb[i])) && a.adjusted === b.adjusted && a.lightnessClipped === b.lightnessClipped)) differ++;
        }
        expect(count).toBeGreaterThan(40_000);
        expect(differ, space + ", k = " + k).toBe(0);
      }
    }
  }, scaledTimeout(240_000));

  it("rests on rays whose in-cube part is one interval below L* 85", () => {
    for (const space of SPACES) {
      const s = resolveRgbColorSpace(space).value;
      const toRgb = (l: number, a: number, b: number): ColorVector3 => multiplyMatrixVector(s.xyzToRgb, xyzToVector(xyzOfCielab({ lStar: l, aStar: a, bStar: b }, s.whiteXyz)));
      let broken = 0;
      for (let l = 1; l < 85; l += 4) for (let h = 0; h < 360; h += 4) {
        const ua = Math.cos(h * Math.PI / 180), ub = Math.sin(h * Math.PI / 180);
        let lo = 0, hi = 1;
        while (inCube(toRgb(l, ua * hi, ub * hi)) && hi < 1e4) hi *= 2;
        for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (inCube(toRgb(l, ua * m, ub * m))) lo = m; else hi = m; }
        // Inside all the way to the boundary, outside beyond it up to 4 × the boundary chroma (the probe reaches chroma / k).
        for (let j = 1; j <= 100; j++) if (!inCube(toRgb(l, ua * (j === 100 ? lo : lo * j / 100), ub * (j === 100 ? lo : lo * j / 100))) || inCube(toRgb(l, ua * hi * (1 + 3 * j / 100), ub * hi * (1 + 3 * j / 100)))) { broken++; break; }
      }
      expect(broken, space).toBe(0);
    }
  }, scaledTimeout(120_000));
});
