// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { FLAT_LOOK, InvalidConfigurationError, STANDARD_LOOK, calculateSdrRendering, pinLookMidGray, simulateCapture,
  type NakaRushtonLook, type SdrRenderingProfile } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

/** f(L) = g(L)/g(Lw), g(L) = 1/(1 + (σ/L)ⁿ), the renderer's naka-rushton-luminance curve. */
function curve(look: NakaRushtonLook, l: number): number {
  const { exponent: n, semiSaturation: s, whiteLuminance: w } = look.toneCurveParameters, g = (x: number): number => 1/(1+(s/x)**n);
  return g(l)/g(w);
}
function profile(look: NakaRushtonLook | null): SdrRenderingProfile {
  return { schemaVersion: "0.1.0", profileId: "look", profileVersion: "1", renderingExposureEv: 0, ...(look ? { toneCurve: look.toneCurve,
    toneCurveParameters: { ...look.toneCurveParameters } } : { toneCurve: "identity" as const }), gamutHandling: "clip-components", outputDynamicRange: "sdr",
  transferFunction: "srgb", bitDepth: 16, rounding: "nearest-ties-up", dither: "none" };
}
/** The sRGB decoding (IEC 61966-2-1). */
function decodeSrgbComponent(v: number): number {
  return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
}
function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a-b), h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h-1]!+s[h]!)/2;
}
/** A fixed-seed linear congruential generator (Numerical Recipes constants). */
function random(seed: number): () => number {
  let x = seed >>> 0;
  return () => (x = (Math.imul(x, 1664525)+1013904223) >>> 0)/4294967296;
}

describe("look constants (#625)", () => {
  it("holds the documented Standard and Flat parameters, frozen, each keeping 18 % gray at 0.18", () => {
    expect(STANDARD_LOOK).toEqual({ toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1.5, semiSaturation: 0.5009, whiteLuminance: 8 } });
    expect(FLAT_LOOK).toEqual({ toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1, semiSaturation: 0.8465, whiteLuminance: 32 } });
    for (const look of [STANDARD_LOOK, FLAT_LOOK]) {
      expect(Object.isFrozen(look) && Object.isFrozen(look.toneCurveParameters)).toBe(true);
      expect(Math.abs(curve(look, .18)-.18)).toBeLessThan(5e-5);
      // The published σ is the closed-form solution at 0.18, rounded to four decimals.
      expect(pinLookMidGray(look, { linearMidGray: .18 }).toneCurveParameters.semiSaturation).toBeCloseTo(look.toneCurveParameters.semiSaturation, 4);
    }
  });
});

describe("pinLookMidGray (#626)", () => {
  it("maps the given linear mid-gray to itself (or to outputLevel), keeping contrast and white", () => {
    for (const look of [STANDARD_LOOK, FLAT_LOOK]) for (const m of [.05, .1, .13, .18, .25, .4]) {
      const pinned = pinLookMidGray(look, { linearMidGray: m });
      expect(pinned.toneCurveParameters.exponent).toBe(look.toneCurveParameters.exponent);
      expect(pinned.toneCurveParameters.whiteLuminance).toBe(look.toneCurveParameters.whiteLuminance);
      expect(Math.abs(curve(pinned, m)-m)).toBeLessThan(1e-12);
      expect(curve(pinned, look.toneCurveParameters.whiteLuminance)).toBe(1);
      const lifted = pinLookMidGray(look, { linearMidGray: m, outputLevel: .18 });
      expect(Math.abs(curve(lifted, m)-.18)).toBeLessThan(1e-12);
    }
    // Unpinned, the Standard look renders a 13 % gray darker than a linear look and the Flat look brighter; pinned, neither does.
    expect(curve(STANDARD_LOOK, .13)).toBeLessThan(.12);
    expect(curve(FLAT_LOOK, .13)).toBeGreaterThan(.135);
  });

  it("preserves the median of a noisy mid-gray patch through the SDR renderer", () => {
    // Symmetric noise about m plus one sample at m (63 × 65 pixels, an odd count), so the input median is exactly m.
    const next = random(626), m = .13, samples: number[] = [m, m, m];
    for (let i = 0; i < (63*65-1)/2; i++) { const e = .08*(next()+next()+next()-1.5); samples.push(m*(1+e), m*(1+e), m*(1+e), m*(1-e), m*(1-e), m*(1-e)); }
    const render = (look: NakaRushtonLook | null): number => {
      const out = calculateSdrRendering({ sourceImageStateId: "gray", inputImageState: "color-transformed-linear-rgb", inputColorSpace: "linear-srgb-d65",
        whiteBalanceHandling: "not-required", pixelWidth: 63, pixelHeight: 65, referenceWhiteValue: 1, samples, profile: profile(look) }).value;
      return median(out.integerSamples.filter((_, i) => i % 3 === 1) as number[]);
    };
    const linear = render(null);
    for (const look of [STANDARD_LOOK, FLAT_LOOK]) {
      expect(Math.abs(render(look)-linear)).toBeGreaterThan(300);
      expect(render(pinLookMidGray(look, { linearMidGray: m }))).toBe(linear);
    }
  });

  it("keeps a capture's mid-gray luminance median at the linear look's when pinned at the level the capture develops it", async () => {
    const base = { scene: { preset: "uniform" as const, reflectance: .18 }, exposure: { mode: "manual" as const, iso: 100, shutterSeconds: 1/250 }, sensor: { spectralStepNanometers: 100 } };
    // Linear-sRGB/D65 relative luminance of each decoded pixel (the luminance the tone curve acts on).
    const luminance = async (look: NakaRushtonLook | null): Promise<number> => {
      const r = await simulateCapture({ ...base, output: { width: 32, height: 32, format: "srgb-16", ...(look ? { toneCurve: look.toneCurve, toneCurveParameters: { ...look.toneCurveParameters } } : {}) } });
      const s = r.image.samples, l: number[] = [];
      for (let i = 0; i < s.length; i += 3) l.push(.2126*decodeSrgbComponent(s[i]!/65535)+.7152*decodeSrgbComponent(s[i+1]!/65535)+.0722*decodeSrgbComponent(s[i+2]!/65535));
      return median(l);
    };
    const level = await luminance(null);
    expect(level).toBeGreaterThan(.02);
    expect(level).toBeLessThan(.6);
    const standard = await luminance(STANDARD_LOOK), pinned = await luminance(pinLookMidGray(STANDARD_LOOK, { linearMidGray: level }));
    expect(Math.abs(standard-level)/level).toBeGreaterThan(.01);
    expect(Math.abs(pinned-level)/level).toBeLessThan(2e-4);
  }, scaledTimeout(120_000));

  it("refuses invalid looks, levels and unreachable targets", () => {
    const bad: [unknown, unknown][] = [[null, { linearMidGray: .1 }], [{ toneCurve: "identity", toneCurveParameters: {} }, { linearMidGray: .1 }],
      [{ toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: .1, semiSaturation: 1, whiteLuminance: 8 } }, { linearMidGray: .1 }],
      [{ toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: 1, semiSaturation: 1, whiteLuminance: 0 } }, { linearMidGray: .1 }],
      [STANDARD_LOOK, null], [STANDARD_LOOK, { linearMidGray: .1, extra: 1 }], [STANDARD_LOOK, { linearMidGray: 0 }], [STANDARD_LOOK, { linearMidGray: 9 }],
      [STANDARD_LOOK, { linearMidGray: .1, outputLevel: 1 }], [STANDARD_LOOK, { linearMidGray: Number.NaN }],
      // n = 0.25: t·m⁻ⁿ ≤ Lw⁻ⁿ, no σ reaches the target.
      [{ toneCurve: "naka-rushton-luminance", toneCurveParameters: { exponent: .25, semiSaturation: 1, whiteLuminance: 8 } }, { linearMidGray: .13, outputLevel: .01 }],
      // A target so close to 0 that σ would exceed the renderer's range.
      [FLAT_LOOK, { linearMidGray: .5, outputLevel: .0157 }]];
    for (const [look, options] of bad) expect(() => pinLookMidGray(look as NakaRushtonLook, options as { linearMidGray: number })).toThrow(InvalidConfigurationError);
  });
});
