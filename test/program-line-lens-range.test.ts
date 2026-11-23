// SPDX-License-Identifier: Apache-2.0
/**
 * #583: in program mode the program line follows the lens's f-number range (`lens.ideal` widestFNumber/narrowestFNumber,
 * `lens.prime`, `lens.catalogue`). Requests whose range holds the line (f/4–f/16), and requests with no range, keep their bytes.
 * #585: a range narrower than about f/1 anchors the exposure at the body's shortest shutter; requests that resolved before keep theirs.
 * #673: a sensor profile whose base ISO is above 100 moves the anchor's shutter; its program line's stops are measured from that anchor.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveSensorProfile, SENSOR_PROFILES, simulateCapture, simulateDisplayView, type SensorProfile, type SimulateCaptureOptions,
  type SimulateCaptureResult } from "../src/index.js";
import { scaledTimeout } from "./helpers/test-timeout.js";

const sha = (data: ArrayBufferView | string): string => createHash("sha256")
  .update(typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
/** Developed samples, packed RAW codes and the result's settings and assumptions. */
const digest = (r: SimulateCaptureResult): Record<string, string> => ({ samples: sha(r.image.samples), codes: sha(r.raw.codes),
  exposure: sha(JSON.stringify(r.exposure)), assumptions: sha(JSON.stringify(r.assumptions)) });

const base = { scene: { preset: "siemens-star" as const }, output: { width: 16, height: 16 } };
/** Program-mode requests without a range, or with one that holds f/4–f/16: their digests from main 3f9d65b (2.18.0), before #583; and (#585) other modes. */
const UNCHANGED: Record<string, SimulateCaptureOptions> = {
  tierLens: { ...base, exposure: { mode: "program" } },
  tierLensAutoIso: { ...base, illuminanceLux: 20, exposure: { mode: "program", iso: "auto" } },
  idealNoRange: { ...base, lens: { ideal: { focalLengthMm: 50 } }, exposure: { mode: "program" } },
  idealHoldingRange: { ...base, illuminanceLux: 50, lens: { ideal: { focalLengthMm: 50, widestFNumber: 2, narrowestFNumber: 22 } }, exposure: { mode: "program" } },
  prime50: { ...base, lens: { prime: 50 }, exposure: { mode: "program" } },
  // 2.20.0: a catalogue lens resolves to its fast method by default for sRGB; fast: false keeps the pinned exact bytes.
  catalogue50: { ...base, lens: { catalogue: "pv-50-1.8" }, exposure: { mode: "program", iso: "auto" }, fast: false },
  // #585: other modes, three with the exposure anchor off f/8 at a shutter in the body's range (pinned from afefcb6, before the fix).
  idealAboveF8Manual: { ...base, lens: { ideal: { focalLengthMm: 50, widestFNumber: 9 }, fNumber: 11 } },
  idealBelowF8Aperture: { ...base, lens: { ideal: { focalLengthMm: 50, narrowestFNumber: 4 }, fNumber: 2 }, exposure: { mode: "aperture-priority" } },
  idealF1Shutter: { ...base, lens: { ideal: { focalLengthMm: 50, widestFNumber: 1, narrowestFNumber: 1 } }, exposure: { mode: "shutter-priority", shutterSeconds: 1 / 500, iso: "auto" } },
  prime800Manual: { ...base, output: { width: 8, height: 8 }, lens: { prime: 800, fNumber: 8 } }
};
// catalogue50's assumptions re-pinned for #567 (2.20.0): lens.catalogue.character reports the lens's bokeh; its image, RAW and exposure are unchanged.
// Every assumptions digest re-pinned for 2.22.0: raw.expectedSignal's method is "per-site-integrated-electrons" (before "tabulated-expected-electrons")
// and its explanation says so; samples, RAW codes and exposure are unchanged (the same on x64 and arm64).
// 2.28.0 (#674, the catalogue PSF's exact cell integration): catalogue50's samples, codes and assumptions re-pinned (x64 and arm64).
const PINNED: Record<string, Record<string, string>> = {
  tierLens: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "ace2bd2120a3f5b59e2076a289198be5f235ef19f3a35d399ca97f983633b28d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "c98b628d49c2f6abf9c292ac7780d0403f3d3fc4d3b4884c1528c6b0ca4a415d" },
  tierLensAutoIso: { samples: "d67e0c3eb390d3d7bb0c7c5a454feace7ead68e1a3c8fab97f655d360f6aa550", codes: "891682f8617420571ee190656f16f351d150dd560759e1f3dcb53d55340d1787",
    exposure: "d9f7046536ce47d72997a3d243b599602caaf35f4d66ba8e6bcb703579f76240", assumptions: "fb45d83b675778908dd78b1881a72132a128cd28336e745f13f47c0abc74aa64" },
  idealNoRange: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "ace2bd2120a3f5b59e2076a289198be5f235ef19f3a35d399ca97f983633b28d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "2ccf27347d8e2702059fa5abbfebe06cd27e04f8ef360334503b11d62d0a40ae" },
  idealHoldingRange: { samples: "12d562e5f22fdd95f074e5c322a526f690b116dfbb9ea0f4348ad3b4cd3a1743", codes: "46227fc4d9d9a4ba35ea007cd8c382c35081a22964b039c357733e269b6cadb4",
    exposure: "59758981082e8b5ded4f7d403abaeac2af94d67554b9fe7d5dee8a7d03cf592e", assumptions: "51b3668f0d3fb9ef43c24e71702bd479a6d678741e2e158dede05197b6dababe" },
  prime50: { samples: "81ffece58d5fe93ad4ba841aa425ad44be60829ed69cb242764d482369dff549", codes: "506b5c2e72835c75b5b14a22bf29ff8d358b4123ce0c5d58082dffc89932fe0d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "58bd7819e5fd0283537a752a17e3b66e233e270459d779a3f1e72554145bd8eb" },
  // #588 and #589: samples and codes re-pinned on the merged tree: the exact catalogue quadrature reads the star's ties at lattice
  // points (#588; test/simulate-capture-lens-catalogue-ties.test.ts), and the off-axis kernels carry the PSF's own centroid (#589).
  // #681 (2.28.0): exposure re-pinned, samples, codes and assumptions unchanged. Its ideal ISO is 99.99999999999997 (residual
  // -4.8e-16 stops), which reported clamped "minimum", "iso-minimum" and quantized; now clamped false, "none", not quantized.
  // The settings are unchanged (f/10.46, 1/125 s, ISO 100).
  catalogue50: { samples: "9445f3892b824c8b7aa7bf0f628a72fdc9addc9f1a0402b05f4731c8a05112ce", codes: "91f6a851bb85d0d89d22b1d1eed711f1c8e07ff71b85021bcec7c446581677a6",
    exposure: "90155d028eb540cd029ddc97732b06f646ce867d220f428fd75d7dee773fd9bb", assumptions: "c291630ab859394e96a919b4208451c02767bc4b66dae2059e1cf390b8b9f085" },
  idealAboveF8Manual: { samples: "5e929bb9533f1c4c0007f96a44bb58016f959311184609bf38fe4c99ba44eab3", codes: "a7c8a08b2e99486fcc001e4197343bb5ff6c24ed5251e8d0209857a47c739874",
    exposure: "006914fc3987a766d02070f5bb328685533ac903998205648c496168de997191", assumptions: "04fda0822bc4d44d082454c4d9fc52bcbe04d4e9f2f53249d28030b2a208c141" },
  idealBelowF8Aperture: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "c6d4a30f45b20872c38650cc5c0ce9e13595033744c365f4aa388879737d2d81",
    exposure: "f5639233332165644252b4f7ca082b0e991ce9c150289b943b003d16569921e3", assumptions: "d765911e57f381731bd5ca38bf55ab4834680a05d96b1a0255dacd72ccc8def3" },
  idealF1Shutter: { samples: "dc9f53838b7d18ce23e66946e27a84540ead46245f7c1e335a1d71e94882f3d1", codes: "e246d15d13332a6a893482bd8058816122eca72445425282efb56e1cec331bc1",
    exposure: "a5fde5bedd32d403bafdbe58aad1c8a598edf90d5efec466fdf947d5679c35b2", assumptions: "f4b90ecd547cdd367d696b16dfe21719d3b7fe4a04a36307dafcf4c33e63038f" },
  prime800Manual: { samples: "a7f9afc94a67b2716f04f128c77046cf86bd54dc998d2947132ea8d03f193398", codes: "6df8376768a166e2bee828d1de7cafdf7fcaf182b089510772f51a12d8789815",
    exposure: "47786c2b611d37b2719d16113b410737be5db13d29cd947d072fffa40eb7d90b", assumptions: "01eb8284a184f423ad63ef3bd99776b37e26eedf1ef9b240a53f236006cbea2a" }
};

const recorded = (result: { assumptions: readonly { id: string; value: unknown }[] }, id: string): unknown => result.assumptions.find((a) => a.id === id)!.value;

type Node = { opticalExposureStopsFromReference: number; aperture: number; shutterSeconds: number };
/** The facade's generic line (f/16 1/2000 s … f/8 1/125 s … f/4 1.024 s), relative to f/8, 1/125 s. */
const LINE: Node[] = [[-6, 16, 1 / 2000], [-2, 16, 1 / 125], [0, 8, 1 / 125], [2, 4, 1 / 125], [9, 4, 128 / 125]]
  .map(([opticalExposureStopsFromReference, aperture, shutterSeconds]) => ({ opticalExposureStopsFromReference: opticalExposureStopsFromReference!, aperture: aperture!, shutterSeconds: shutterSeconds! }));
/** log2 aperture and shutter of a line at `value` stops (its log2 interpolation, held at its ends). */
function at(n: readonly Node[], value: number): { a: number; u: number } {
  const stops = Math.min(n[n.length - 1]!.opticalExposureStopsFromReference, Math.max(n[0]!.opticalExposureStopsFromReference, value));
  let i = 0;
  while (i < n.length - 2 && stops > n[i + 1]!.opticalExposureStopsFromReference) i++;
  const p = (stops - n[i]!.opticalExposureStopsFromReference) / (n[i + 1]!.opticalExposureStopsFromReference - n[i]!.opticalExposureStopsFromReference);
  return { a: Math.log2(n[i]!.aperture) + p * (Math.log2(n[i + 1]!.aperture) - Math.log2(n[i]!.aperture)),
    u: Math.log2(n[i]!.shutterSeconds) + p * (Math.log2(n[i + 1]!.shutterSeconds) - Math.log2(n[i]!.shutterSeconds)) };
}
const program = (ideal: { widestFNumber?: number; narrowestFNumber?: number }, lux = 2000): SimulateCaptureOptions =>
  ({ scene: { preset: "uniform" }, output: { width: 8, height: 8 }, illuminanceLux: lux, lens: { ideal: { focalLengthMm: 50, ...ideal } }, exposure: { mode: "program" } });
const nodesOf = (r: SimulateCaptureResult): Node[] => (recorded(r, "exposure.programLine") as { nodes: Node[] }).nodes;

describe("program line limited to the lens's f-number range (#583)", () => {
  it("keeps the bytes of program requests with no range or a range that holds f/4–f/16", async () => {
    const out: Record<string, Record<string, string>> = {};
    for (const [name, options] of Object.entries(UNCHANGED)) out[name] = digest(await simulateCapture(options));
    expect(out).toEqual(PINNED);
  }, scaledTimeout(60_000));

  it("limits the line to the range: the line's aperture clamped in log2 at the same exposure, from 1/2000 s to 1.024 s", async () => {
    for (const range of [{ widestFNumber: 2, narrowestFNumber: 22 }, { widestFNumber: 4, narrowestFNumber: 16 }, {}])
      expect(recorded(await simulateCapture(program(range)), "exposure.programLine")).toBe("facade-generic-program-line");
    for (const [w, n] of [[5.6, 32], [8, 32], [9, 32], [5.6, 11], [0.5, 4], [1, 1], [2, 2.8], [22, 32], [128, 128], [4, 11]] as const) {
      const capture = await simulateCapture(program({ widestFNumber: w, narrowestFNumber: n })), nodes = nodesOf(capture);
      expect(recorded(capture, "exposure.programLine")).toMatchObject({ profileId: "facade-generic-program-line-lens-range" });
      expect(nodes[0]!.shutterSeconds).toBe(1 / 2000);
      expect(nodes[nodes.length - 1]!.shutterSeconds).toBe(128 / 125);
      for (const node of nodes) {
        expect(node.aperture).toBeGreaterThanOrEqual(w);
        expect(node.aperture).toBeLessThanOrEqual(n);
        // The stops are the node's exposure against f/8, 1/125 s: log2((t/N²)/(1/8000)).
        expect(node.opticalExposureStopsFromReference).toBeCloseTo(Math.log2(8000 * node.shutterSeconds / node.aperture ** 2), 12);
      }
      // Where both lines run, the aperture is the old line's clamped to the range (and so, at the same stops, the same t/N²).
      const first = Math.max(-6, nodes[0]!.opticalExposureStopsFromReference), last = Math.min(9, nodes[nodes.length - 1]!.opticalExposureStopsFromReference);
      for (let k = 0; k <= 200; k++) {
        const stops = first + (last - first) * k / 200, now = at(nodes, stops), old = at(LINE, stops);
        expect(now.a).toBeCloseTo(Math.min(Math.log2(n), Math.max(Math.log2(w), old.a)), 9);
        expect(now.u - 2 * now.a).toBeCloseTo(old.u - 2 * old.a, 9);
      }
    }
    // 1200 mm prime-like f/8–f/32: f/16 1/2000 s, f/16 1/125 s, f/8 1/125 s, f/8 1.024 s.
    expect(nodesOf(await simulateCapture(program({ widestFNumber: 8, narrowestFNumber: 32 }))).map((node) => [node.opticalExposureStopsFromReference, node.aperture, node.shutterSeconds]))
      .toEqual([[-6, 16, 1 / 2000], [-2, 16, 1 / 125], [0, 8, 1 / 125], [7, 8, 128 / 125]]);
  }, scaledTimeout(60_000));

  it("resolves an exposure in program for ideal-lens ranges that do not hold f/4–f/16, with apertures only in the range", async () => {
    const options = program;
    for (const range of [{ widestFNumber: 8 }, { narrowestFNumber: 4 }, { widestFNumber: 5.6, narrowestFNumber: 11 }, { widestFNumber: 22, narrowestFNumber: 32 },
      { widestFNumber: 128 }, { narrowestFNumber: 1 }, { widestFNumber: 2, narrowestFNumber: 2 }]) {
      const w = range.widestFNumber ?? 0.5, n = range.narrowestFNumber ?? 128;
      for (const lux of [5, 2000, 200_000]) {
        const capture = await simulateCapture(options(range, lux));
        expect(capture.exposure.settings.fNumber).toBeGreaterThanOrEqual(w);
        expect(capture.exposure.settings.fNumber).toBeLessThanOrEqual(n);
        expect(recorded(capture, "exposure.programLine")).toMatchObject({ profileId: "facade-generic-program-line-lens-range" });
      }
    }
    // In daylight the 1200 mm-like f/8–f/128 range meters exactly as the open lens does where the line is unchanged (f/16 and narrower);
    // in dim light it holds f/8 and lengthens the shutter: f/8 at 4× the open lens's f/4 shutter, the same exposure.
    const bright = await simulateCapture(options({ widestFNumber: 8 }, 200_000)), brightOpen = await simulateCapture(options({}, 200_000));
    expect(bright.exposure.settings).toEqual(brightOpen.exposure.settings);
    const lux = 2000, dim = await simulateCapture(options({ widestFNumber: 8 }, lux)), dimOpen = await simulateCapture(options({}, lux));
    expect(dimOpen.exposure.settings.fNumber).toBe(4);
    expect(dim.exposure.settings.fNumber).toBe(8);
    expect(dim.exposure.settings.shutterSeconds).toBeCloseTo(4 * dimOpen.exposure.settings.shutterSeconds, 12);
    expect(dim.exposure.standardExposureDeviationStops).toBeCloseTo(dimOpen.exposure.standardExposureDeviationStops!, 9);
    // The display view follows the same line.
    const view = await simulateDisplayView(options({ widestFNumber: 8 }, lux), { width: 8, height: 8 });
    expect(view.exposure.settings).toEqual(dim.exposure.settings);
  }, scaledTimeout(60_000));

  it("applies to lens.prime and lens.catalogue ranges that do not hold f/4–f/16 (previously refused)", async () => {
    const prime = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 8, height: 8 }, illuminanceLux: 125, lens: { prime: 800 }, exposure: { mode: "program" } });
    expect(prime.exposure.settings.fNumber).toBe(5.6);
    expect(nodesOf(prime).map((node) => node.aperture)).toEqual([16, 16, 5.6, 5.6]);
    const catalogue = await simulateCapture({ scene: { preset: "uniform" }, output: { width: 64, height: 64 }, illuminanceLux: 125, lens: { catalogue: { kind: "pv-800-9", fast: true } },
      exposure: { mode: "program" } });
    expect(catalogue.exposure.settings.fNumber).toBe(9);
    expect(nodesOf(catalogue).map((node) => node.aperture)).toEqual([16, 16, 9, 9]);
  }, scaledTimeout(120_000));

  it("takes an ideal range narrower than about f/1 in every mode: the anchor at the body's shortest shutter (#585)", async () => {
    const lens = { ideal: { focalLengthMm: 50, widestFNumber: 0.5, narrowestFNumber: 0.9 } }, at = { scene: { preset: "uniform" as const }, output: { width: 8, height: 8 }, illuminanceLux: 20 };
    const open = { ideal: { focalLengthMm: 50 } };
    for (const exposure of [{ mode: "program" as const }, { mode: "aperture-priority" as const }, { mode: "shutter-priority" as const, shutterSeconds: 1 / 4000 },
      { mode: "manual" as const, shutterSeconds: 1 / 8000 }, { mode: "program" as const, iso: "auto" as const }]) {
      const fNumber = exposure.mode === "manual" || exposure.mode === "aperture-priority" ? { fNumber: 0.7 } : {};
      const capture = await simulateCapture({ ...at, lens: { ...lens, ...fNumber }, exposure });
      expect(capture.exposure.settings.fNumber).toBeGreaterThanOrEqual(0.5);
      expect(capture.exposure.settings.fNumber).toBeLessThanOrEqual(0.9);
      // f/0.9 at 1/125 s × (0.9/8)² ≈ 1/9877 s is shorter than the body's 1/8000 s: the anchor takes 1/8000 s, a lower N²/t.
      expect(recorded(capture, "exposure.referenceExposure")).toMatchObject({ aperture: 0.9, shutterSeconds: 1 / 8000, iso: 100 });
      expect(capture.assumptions.find((a) => a.id === "exposure.referenceExposure")!.explanation).toContain("the lens excludes f/8: the shortest shutter at f/0.9.");
      if (exposure.mode === "program") expect(recorded(capture, "exposure.programLine")).toMatchObject({ profileId: "facade-generic-program-line-lens-range" });
      // The anchor only sets where the stops are measured from: at the same settings the open ideal lens (anchored at f/8, 1/125 s) meters the same.
      if (exposure.mode === "aperture-priority" || exposure.mode === "shutter-priority") {
        const same = await simulateCapture({ ...at, lens: { ...open, ...fNumber }, exposure });
        expect(capture.exposure.settings.shutterSeconds).toBeCloseTo(same.exposure.settings.shutterSeconds, 12);
        expect(capture.exposure.settings.fNumber).toBeCloseTo(same.exposure.settings.fNumber, 12);
      }
      // Program and aperture priority reach the meter target in 20 lx (shutter priority at 1/4000 s and manual at 1/8000 s cannot).
      if (exposure.mode === "program" || exposure.mode === "aperture-priority") expect(Math.abs(capture.exposure.standardExposureDeviationStops!), exposure.mode).toBeLessThan(0.5);
    }
  }, scaledTimeout(60_000));
});

describe("program mode on a sensor profile whose base ISO is above 100 (#673)", () => {
  const ff = resolveSensorProfile("full-frame-24mp-bsi-2020s");
  const base200: SensorProfile = { ...ff, id: "copy-200", baseIso: 200, maximumIso: 102400,
    readNoise: { lowGainElectrons: 3, highGainElectrons: 3, highGainFromIso: null }, highGainFullWellElectrons: null };
  const line = (r: SimulateCaptureResult): unknown => r.assumptions.find((a) => a.id === "exposure.programLine")!.value;
  it("resolves on every profile and on a base-200 copy, at the meter target, with the default ISO and with Auto ISO", async () => {
    for (const profile of [...SENSOR_PROFILES, base200]) for (const exposure of [{ mode: "program" as const }, { mode: "program" as const, iso: "auto" as const }]) {
      const r = await simulateCapture({ ...base, scene: { preset: "uniform" }, sensor: { profile }, exposure });
      expect(Math.abs(r.exposure.standardExposureDeviationStops!), profile.id).toBeLessThan(1e-6);
      if (profile.baseIso > 100) expect(line(r), profile.id).toMatchObject({ profileId: "facade-generic-program-line-base-iso", nodes: [{ aperture: 16, shutterSeconds: 1 / 2000 },
        { aperture: 16, shutterSeconds: 1 / 125 }, { aperture: 4, shutterSeconds: 1 / 125 }, { aperture: 4, shutterSeconds: 128 / 125 }] });
      else expect(line(r), profile.id).toBe("facade-generic-program-line");
    }
  }, scaledTimeout(60_000));
  it("measures the line's stops from the base-ISO anchor: f/8 at 1/125 s lies on it, 0.32 stops from the base-125 anchor", async () => {
    const r = await simulateCapture({ ...base, sensor: { profile: resolveSensorProfile("full-frame-24mp-stacked-sports-2020s") }, exposure: { mode: "program" } });
    const nodes = (line(r) as { nodes: { opticalExposureStopsFromReference: number; aperture: number; shutterSeconds: number }[] }).nodes;
    // The reference is f/8 at 1/125 s × 100/125, so f/16 at 1/125 s is log2(1.25 / 4) stops from it.
    expect(nodes[1]!.opticalExposureStopsFromReference).toBeCloseTo(Math.log2(1.25 / 4), 12);
    expect(nodes[2]!.opticalExposureStopsFromReference).toBeCloseTo(Math.log2(1.25 * 4), 12);
    expect((nodes[1]!.opticalExposureStopsFromReference + nodes[2]!.opticalExposureStopsFromReference) / 2).toBeCloseTo(Math.log2(1.25), 12);
  }, scaledTimeout(60_000));
});
