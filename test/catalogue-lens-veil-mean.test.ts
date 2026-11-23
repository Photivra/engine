// SPDX-License-Identifier: Apache-2.0
/**
 * #730 facade-13: with a key, the veil's frame mean (`lens.catalogue.flare`) is kept across the signals of one request, so a second
 * region or part reads no lattice point for it; a new key computes it again.
 */
import { afterEach, describe, expect, it } from "vitest";
import { simulateCapture } from "../src/index.js";
import { createCatalogueLensSignal, setCatalogueLensSignalTestHook, type CatalogueLensSignalInput } from "../src/facade/catalogue-lens-signal.js";

afterEach(() => setCatalogueLensSignalTestHook(undefined));

describe("the veil's frame mean kept per request (facade-13)", () => {
  it("reads no lattice point for the second signal of a key and the same mean", async () => {
    let input: CatalogueLensSignalInput | undefined;
    setCatalogueLensSignalTestHook({ onInput: (given) => { input ??= given; } });
    await simulateCapture({ scene: { preset: "checkerboard", squaresAcross: 7 }, subjectDistanceM: 3, lens: { catalogue: { kind: "pv-16-2.8", flare: true }, fNumber: 8 },
      sensor: { pixelPitchMicrometers: 375, spectralStepNanometers: 50 }, output: { width: 96, height: 64, format: "srgb-16" }, fast: false });
    setCatalogueLensSignalTestHook(undefined);
    expect(input?.veil).toBeDefined();
    const keyed = (key: string): CatalogueLensSignalInput => ({ ...input!, veil: { ...input!.veil!, key } });
    const unkeyed = createCatalogueLensSignal(input!), first = createCatalogueLensSignal(keyed("a")), second = createCatalogueLensSignal(keyed("a"));
    expect(unkeyed.lookups).toBeGreaterThan(0);
    expect(first.lookups).toBe(unkeyed.lookups);
    expect(second.lookups).toBe(0);
    expect(second.veilMean).toEqual(unkeyed.veilMean);
    expect(Array.from(second.veilMean!.radiance)).toEqual(Array.from(unkeyed.veilMean!.radiance));
    expect(createCatalogueLensSignal(keyed("b")).lookups).toBe(unkeyed.lookups);
  });
});
