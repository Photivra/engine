// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { createSimulatedCapture, calculateLinearCaptureEncoding, parseLinearCaptureEncoding, calculateCaptureColorTransform,
  parseSimulatedCapture, createCaptureWhiteBalanceIntent, resolveManualWhiteBalance,
  type LinearCaptureEncoding, type LinearCaptureEncodingInput } from "../src/index.js";
import { loadLinearCaptureInput } from "./helpers/linear-capture-fixture.js";
const encoding: LinearCaptureEncoding = { schemaVersion: "0.1.0", blackValue: 0, blackCode: 0, referenceWhiteCode: 1024,
  negativeValues: "preserve-if-representable", outOfRange: "clip", rounding: "nearest-ties-up" };
function request(samples: number[]): LinearCaptureEncodingInput {
  const input = loadLinearCaptureInput();
  input.planes = [{ ...input.planes[0]!, storage: { kind: "inline-float64", samples } }];
  return { capture: createSimulatedCapture(input).value, planeId: "source", requiredImageState: "scene-referred-xyz", encoding };
}
describe("deterministic linear uint16 encoding", () => {
  it("preserves reference white and headroom separately from capture/display saturation", () => {
    const input = request([0, 1, 2, 65535/1024, 80, -.1]); const before = JSON.stringify(input.capture);
    const r = calculateLinearCaptureEncoding(input).value;
    expect(r.samples).toEqual([0, 1024, 2048, 65535, 65535, 0]);
    expect(r.scale).toBe(1024); expect(r.maximumRepresentableValue).toBe(65535/1024);
    expect(r.headroomFactor).toBe(65535/1024); expect(r.maximumRoundingError).toBe(.5/1024);
    expect(r.clippedLowSampleCount).toBe(1); expect(r.clippedHighSampleCount).toBe(1);
    expect(r.defaultRenderingExposureEv).toBe(null); expect(r.sourcePlane.captureSaturation.kind).toBe("not-modeled");
    expect(JSON.stringify(input.capture)).toBe(before);
    expect(calculateLinearCaptureEncoding(input).value).toEqual(r);
  });
  it("rounds exact half ties toward larger codes and respects neighbors", () => {
    const r = calculateLinearCaptureEncoding(request([.5/1024, 1.5/1024, 2.5/1024,
      (.5-Number.EPSILON)/1024, (.5+Number.EPSILON)/1024, -0])).value;
    expect(r.samples).toEqual([1, 2, 3, 0, 1, 0]);
    expect(r.clippedLowSampleCount).toBe(0); expect(r.clippedHighSampleCount).toBe(0);
    // The largest double below 0.5 maps to exactly 0.49999999999999994 codes: nearest is 0
    // (Math.floor(x+0.5) returned 1 because x+0.5 rounds to 1 in binary64).
    expect(calculateLinearCaptureEncoding(request([0.49999999999999994/1024, 0, 0, 0, 0, 0])).value.samples[0]).toBe(0);
  });
  it("can preserve representable negatives with a black-code offset and reject negatives independently", () => {
    const input = request([-1, -.5, 0, .5, 1, 2]);
    input.encoding = { ...encoding, blackCode: 1024, referenceWhiteCode: 2048 };
    const r = calculateLinearCaptureEncoding(input).value;
    expect(r.samples).toEqual([0, 512, 1024, 1536, 2048, 3072]);
    expect(r.minimumRepresentableValue).toBe(-1); expect(r.clippedLowSampleCount).toBe(0);
    expect(() => calculateLinearCaptureEncoding({ ...input, encoding: { ...input.encoding, negativeValues: "reject" } })).toThrow();
    const extreme = request([-Number.MAX_VALUE, Number.MAX_VALUE, 0, 1, 2, 3]);
    expect(calculateLinearCaptureEncoding(extreme).value.samples.slice(0, 2)).toEqual([0, 65535]);
    expect(() => calculateLinearCaptureEncoding({ ...extreme, encoding: { ...encoding, outOfRange: "reject" } })).toThrow();
  });
  it("uses a uniform mapping in relative source units including nonzero black and nonunit reference", () => {
    const input = request([-.5, 0, .5, 1, 1.5, 2]);
    input.capture = parseSimulatedCapture({ ...input.capture, planes: [{ ...input.capture.planes[0]!, referenceWhiteValue: 2,
      captureSaturation: { kind: "declared-virtual-white", whiteLevel: 4, upstreamClippedSampleCount: 1 } }] });
    input.encoding = { ...encoding, blackValue: -.5, blackCode: 100, referenceWhiteCode: 1100, outOfRange: "reject" };
    const r = calculateLinearCaptureEncoding(input).value;
    expect(r.samples).toEqual([100, 300, 500, 700, 900, 1100]); expect(r.scale).toBe(400);
    expect(r.sourcePlane.captureSaturation).toEqual(input.capture.planes[0]!.captureSaturation);
    expect(r.referenceWhiteValue).toBe(2); expect(r.encoding.referenceWhiteCode).toBe(1100);
  });
  it("consumes transformed color without changing its explicit WB/profile/history", () => {
    const source = loadLinearCaptureInput();
    source.whiteBalanceIntent = createCaptureWhiteBalanceIntent({ state: resolveManualWhiteBalance({ stateId: "encoding-wb",
      channelGains: { red: 2, green: 1, blue: .5 } }) });
    source.adoptedWhiteXyz = { x: .9, y: 1, z: .7 };
    const capture = createSimulatedCapture(source).value;
    const color = calculateCaptureColorTransform({ capture, sourcePlaneId: "source", outputPlaneId: "rgb",
      outputImageStateId: "rgb-state", whiteBalance: { kind: "preserve-intent" } }).value.plane;
    const input: LinearCaptureEncodingInput = { capture: parseSimulatedCapture({ ...capture, planes: [color] }),
      planeId: "rgb", requiredImageState: "color-transformed-linear-rgb", encoding };
    const r = calculateLinearCaptureEncoding(input).value;
    expect(r.samples).toEqual([1024, 1024, 1024, 0, 0, 0]);
    expect(r.sourcePlane.colorProfile).toEqual(color.colorProfile); expect(r.sourcePlane.appliedTransforms).toEqual(color.appliedTransforms);
    expect(r.captureMetadata.whiteBalanceIntent).toEqual(capture.whiteBalanceIntent);
    expect(r.captureMetadata.adoptedWhiteXyz).toEqual(capture.adoptedWhiteXyz);
    expect(r.captureMetadata.models).toEqual(capture.models); expect(r.sourcePlane.whiteBalanceApplication).toBe("intent-only");
    expect(() => calculateLinearCaptureEncoding({ ...input, requiredImageState: "scene-referred-xyz" })).toThrow();
  });
  it("rejects malformed policies, ranges, non-finite/sparse data, external storage and incompatible states", () => {
    for (const patch of [{ schemaVersion: "2" }, { blackValue: NaN }, { blackValue: Infinity }, { blackCode: -.1 },
      { blackCode: 65535 }, { referenceWhiteCode: 0 }, { referenceWhiteCode: 65536 }, { referenceWhiteCode: 1.5 },
      { negativeValues: "guess" }, { outOfRange: "guess" }, { rounding: "nearest-even" }, { path: "/private" }]) {
      expect(() => parseLinearCaptureEncoding({ ...encoding, ...patch })).toThrow();
    }
    const input = request([0, 1, 2, 3, 4, 5]);
    for (const blackValue of [1, 2, -Number.MAX_VALUE]) expect(() => calculateLinearCaptureEncoding({ ...input, encoding: { ...encoding, blackValue } })).toThrow();
    expect(() => calculateLinearCaptureEncoding({ ...input, encoding: { ...encoding, blackValue: 1-Number.EPSILON, blackCode: 1, referenceWhiteCode: 65535 } })).toThrow();
    for (const values of [Array(6), [NaN, 1, 2, 3, 4, 5], [Infinity, 1, 2, 3, 4, 5]]) expect(() => request(values)).toThrow();
    expect(() => calculateLinearCaptureEncoding({ ...input, planeId: "absent" })).toThrow();
    expect(() => calculateLinearCaptureEncoding({ ...input, planeId: "/private" })).toThrow();
    expect(() => calculateLinearCaptureEncoding({ ...input, requiredImageState: "gamma-rgb" } as unknown as LinearCaptureEncodingInput)).toThrow();
    expect(() => calculateLinearCaptureEncoding({ ...input, debug: true } as LinearCaptureEncodingInput)).toThrow();
    input.capture = parseSimulatedCapture({ ...input.capture, planes: [{ ...input.capture.planes[0]!,
      storage: { kind: "external-float32", byteOrder: "little-endian", artifactId: "external", sha256: "a".repeat(64), sampleCount: 6 } }] });
    expect(() => calculateLinearCaptureEncoding(input)).toThrow();
  });
  // #718: with white code 65535 the largest code is reference white itself; 65535 / (65535 / 0.9) is one ulp below 0.9.
  it("encodes a full-scale white code for any reference white", () => {
    const plane = (white: number, samples: number[], e: Partial<LinearCaptureEncoding> = {}): LinearCaptureEncodingInput => {
      const input = request(samples);
      input.capture = parseSimulatedCapture({ ...input.capture, planes: [{ ...input.capture.planes[0]!, referenceWhiteValue: white }] });
      input.encoding = { ...encoding, referenceWhiteCode: 65535, ...e };
      return input;
    };
    const r = calculateLinearCaptureEncoding(plane(0.9, [0, 0.45, 0.9, 0.9, 1, -1])).value;
    expect(r.samples).toEqual([0, 32768, 65535, 65535, 65535, 0]);
    expect(r.maximumRepresentableValue).toBe(0.9); expect(r.clippedHighSampleCount).toBe(1);
    expect(calculateLinearCaptureEncoding(plane(2, [0.01, 1, 2, 2, 0, 0], { blackValue: 0.01 })).value.samples.slice(0, 3)).toEqual([0, 32603, 65535]);
    expect(calculateLinearCaptureEncoding(plane(1, [0.01, 1, 0, 0, 0, 0], { blackValue: 0.01, blackCode: 64 })).value.samples.slice(0, 2)).toEqual([64, 65535]);
    let seed = 718;
    const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let i = 0; i < 1000; i++) {
      const white = Math.round(1 + next() * 99_999) / 10_000;
      expect(calculateLinearCaptureEncoding(plane(white, [0, white, white / 2, 0, 0, 0])).value.samples[1]).toBe(65535);
    }
  });
});
