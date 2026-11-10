// SPDX-License-Identifier: Apache-2.0
/**
 * #583: in program mode the program line follows the lens's f-number range (`lens.ideal` widestFNumber/narrowestFNumber,
 * `lens.prime`, `lens.catalogue`). Requests whose range holds the line (f/4–f/16), and requests with no range, keep their bytes.
 * #585: a range narrower than about f/1 anchors the exposure at the body's shortest shutter; requests that resolved before keep theirs.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simulateCapture, simulateDisplayView, type SimulateCaptureOptions, type SimulateCaptureResult } from "../src/index.js";
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
const PINNED: Record<string, Record<string, string>> = {
  tierLens: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "ace2bd2120a3f5b59e2076a289198be5f235ef19f3a35d399ca97f983633b28d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "8a3e8a04e134e38e9775ce964e42b21e7f04bae2afecf89f92d367169ec952c6" },
  tierLensAutoIso: { samples: "d67e0c3eb390d3d7bb0c7c5a454feace7ead68e1a3c8fab97f655d360f6aa550", codes: "891682f8617420571ee190656f16f351d150dd560759e1f3dcb53d55340d1787",
    exposure: "d9f7046536ce47d72997a3d243b599602caaf35f4d66ba8e6bcb703579f76240", assumptions: "52c20138adca0410266e814066e9f3d8b50e6e349689b64799e3ca4d735bcb25" },
  idealNoRange: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "ace2bd2120a3f5b59e2076a289198be5f235ef19f3a35d399ca97f983633b28d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "cc47724a86aeafd9ecc14990b418cbcbbe3064e83a25ddca80b4330e8c0881c0" },
  idealHoldingRange: { samples: "12d562e5f22fdd95f074e5c322a526f690b116dfbb9ea0f4348ad3b4cd3a1743", codes: "46227fc4d9d9a4ba35ea007cd8c382c35081a22964b039c357733e269b6cadb4",
    exposure: "59758981082e8b5ded4f7d403abaeac2af94d67554b9fe7d5dee8a7d03cf592e", assumptions: "02eb6ca513304c98a5043233dd5897ca674065ed772a80e94b083470d20227a3" },
  prime50: { samples: "81ffece58d5fe93ad4ba841aa425ad44be60829ed69cb242764d482369dff549", codes: "506b5c2e72835c75b5b14a22bf29ff8d358b4123ce0c5d58082dffc89932fe0d",
    exposure: "00b53a317629402d6abb579d4805ec2dc134ff172ac6ab779162d2ab6e55f379", assumptions: "0bcef252a188774c8e36ef19ebfe51e45a54d7ac4ce4158120afddf156549214" },
  // #588: samples and codes re-pinned (the exact catalogue quadrature reads the star's ties at lattice points; the RAW equals the lattice
  // reading's, test/simulate-capture-lens-catalogue-ties.test.ts); the same digests as on the #588 branch.
  catalogue50: { samples: "fb04d3f9bc95d882705d53197069e8355dcbe87d640d7b1a1c2b6e13bf648ece", codes: "de8d8bd8d40d14b5340d2c1ae90929afa0213075b540fafc40482c280327dd36",
    exposure: "bb54027b8c93f83b0a5a524441a9e1ee0ee153a8c0eb9699fefe7806bc64ccd8", assumptions: "719ef58f535b470602ff35bd3af5a4588a0be6e3af25c8a1ede9928737975866" },
  idealAboveF8Manual: { samples: "5e929bb9533f1c4c0007f96a44bb58016f959311184609bf38fe4c99ba44eab3", codes: "a7c8a08b2e99486fcc001e4197343bb5ff6c24ed5251e8d0209857a47c739874",
    exposure: "006914fc3987a766d02070f5bb328685533ac903998205648c496168de997191", assumptions: "812aef066115982228591be5f3733ca6edd009aac48c65fc71a7f1bcc4e5a212" },
  idealBelowF8Aperture: { samples: "e93c1106936f4744f0e16b5718eb7c88f2d33844652e4e56dc168ecc3b1e91f8", codes: "c6d4a30f45b20872c38650cc5c0ce9e13595033744c365f4aa388879737d2d81",
    exposure: "f5639233332165644252b4f7ca082b0e991ce9c150289b943b003d16569921e3", assumptions: "fc0e51b14c6ab20d6f92d4e2c112a962e90befd85b916a5a3258b888c10b73c2" },
  idealF1Shutter: { samples: "dc9f53838b7d18ce23e66946e27a84540ead46245f7c1e335a1d71e94882f3d1", codes: "e246d15d13332a6a893482bd8058816122eca72445425282efb56e1cec331bc1",
    exposure: "a5fde5bedd32d403bafdbe58aad1c8a598edf90d5efec466fdf947d5679c35b2", assumptions: "49587ac9e5d73a039d6e2aa104048b6e5c07bc27b33509f25d6af55f31e7f0ed" },
  prime800Manual: { samples: "a7f9afc94a67b2716f04f128c77046cf86bd54dc998d2947132ea8d03f193398", codes: "6df8376768a166e2bee828d1de7cafdf7fcaf182b089510772f51a12d8789815",
    exposure: "47786c2b611d37b2719d16113b410737be5db13d29cd947d072fffa40eb7d90b", assumptions: "1fbe8f36ea43ff62fdd99d5178d622120d018759a082ff47809c30353425c49d" }
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
