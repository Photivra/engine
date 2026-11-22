// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { calculateSensorSpectralQuadrature, InvalidConfigurationError, InvalidScientificInputError } from "../src/index.js";
// Internal validator behind every public consumer of a caller-supplied spectral quadrature.
import { validateSensorSpectralQuadrature } from "../src/sensor/spectral-quadrature.js";
import { colorProfile, spectralProfile } from "./helpers/eqe-response-fixture.js";
import { expectRejection, type Json, type MixedRejectionCase } from "./helpers/rejection-table.js";

const request = (): Json => ({ channelId: "green", wavelengthBasis: "vacuum", wavelengthRangeNanometers: { minimum: 400, maximum: 500 },
  maximumSubintervalWidthNanometers: 50, colorSamplingProfile: colorProfile(), spectralResponseProfile: spectralProfile() });
/** One segment [400, 500] nm split into two 50 nm midpoint subintervals (nodes at 425 and 475 nm). */
const quadrature = (): Json => structuredClone(calculateSensorSpectralQuadrature(request()).value);

describe("spectral quadrature construction and validation rejection branches", () => {
  it("builds and validates the two-node midpoint quadrature", () => {
    const q = quadrature();
    expect(q.nodes.map((n: Json) => n.wavelengthNanometers)).toEqual([425, 475]);
    expect(() => validateSensorSpectralQuadrature(q)).not.toThrow();
  });

  it.each([
    ["a blank channel id", (r: Json): void => { r.channelId = " "; }, "channelId must be a non-empty string.", InvalidConfigurationError],
    ["an undeclared channel", (r: Json): void => { r.channelId = "violet"; }, "No spectral response is declared for the requested channelId."],
    ["a non-object wavelength range", (r: Json): void => { r.wavelengthRangeNanometers = null; }, "wavelengthRangeNanometers must be an object.", InvalidConfigurationError],
    ["non-array breakpoints", (r: Json): void => { r.additionalBreakpointsNanometers = 450; },
      "additionalBreakpointsNanometers must be an array when supplied.", InvalidConfigurationError]
  ] as MixedRejectionCase[])("construction rejects %s", (_name, mutate, message, errorClass) => {
    expectRejection(request, calculateSensorSpectralQuadrature, errorClass ?? InvalidScientificInputError, mutate, message);
  });

  const cases: MixedRejectionCase[] = [
    ["missing nodes", (q): void => { q.nodes = {}; }, "spectralQuadrature must contain a nodes array.", InvalidConfigurationError],
    ["a blank profile id", (q): void => { q.profileId = ""; }, "spectralQuadrature.profileId", InvalidConfigurationError],
    ["an unknown wavelength basis", (q): void => { q.wavelengthBasis = "glass"; }, "spectralQuadrature.wavelengthBasis is invalid.", InvalidConfigurationError],
    ["an inverted wavelength range", (q): void => { q.wavelengthRangeNanometers = { minimum: 500, maximum: 400 }; },
      "spectralQuadrature wavelength range minimum must be less than maximum."],
    ["a single boundary", (q): void => { q.segmentBoundariesNanometers = [400]; },
      "spectralQuadrature.segmentBoundariesNanometers must contain at least two boundaries."],
    ["boundaries that do not span the range", (q): void => { q.segmentBoundariesNanometers = [410, 500]; },
      "spectralQuadrature segment boundaries must exactly span the requested wavelength range."],
    ["a node count that disagrees with the nodes", (q): void => { q.totalNodeCount = 3; },
      "spectralQuadrature.totalNodeCount must be positive and exactly match spectralQuadrature.nodes.length."],
    ["a negative sample index", (q): void => { q.nodes[0].spectralSampleIndex = -1; }, " must be a non-negative safe integer."],
    ["a segment index outside the declared segments", (q): void => { q.nodes[1].segmentIndex = 5; },
      "spectralQuadrature node segmentIndex is outside the declared segment range."],
    ["a subdivision index beyond its count", (q): void => { q.nodes[1].subdivisionIndex = 2; },
      "spectralQuadrature node subdivision identity is invalid."],
    ["nodes that disagree on a segment's subdivision count", (q): void => { q.nodes[1].segmentSubdivisionCount = 3; },
      "spectralQuadrature nodes disagree on a segment subdivision count."],
    ["a node moved off its subinterval midpoint", (q): void => { q.nodes[1].wavelengthNanometers = 476; },
      "spectralQuadrature node geometry/measure does not match its declared segment/subdivision identity."],
    ["a missing subdivision", (q): void => { q.nodes = [q.nodes[0]]; q.totalNodeCount = 1; },
      "spectralQuadrature must contain every declared subdivision exactly once."]
  ];
  it.each(cases)("validation rejects %s", (_name, mutate, message, errorClass) => {
    expectRejection(quadrature, validateSensorSpectralQuadrature, errorClass ?? InvalidScientificInputError, mutate, message);
  });
});

describe("nested input errors (sensor-11, #701)", () => {
  const domain = expect.objectContaining({ name: expect.stringMatching(/^Invalid(Configuration|ScientificInput)Error$/) });
  it("rejects a missing wavelength range and a null node with a domain error", () => {
    const noRange = quadrature(); delete noRange.wavelengthRangeNanometers;
    expect(() => validateSensorSpectralQuadrature(noRange)).toThrow(domain);
    const nullNode = quadrature(); nullNode.nodes[0] = null;
    expect(() => validateSensorSpectralQuadrature(nullNode)).toThrow(domain);
  });
});
