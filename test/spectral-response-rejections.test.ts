// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { InvalidConfigurationError, InvalidScientificInputError, parseSensorSpectralResponseProfile,
  resolveSensorSpectralResponseAtWavelength } from "../src/index.js";
import { colorProfile, spectralProfile } from "./helpers/eqe-response-fixture.js";
import { expectRejection, type Json, type RejectionCase } from "./helpers/rejection-table.js";

/** Channels: 0 direct EQE (green), 1 separable filter x detector EQE (red), 2 A/W responsivity (blue). */
function base(): Json {
  const profile: Json = structuredClone(spectralProfile("direct-eqe"));
  profile.channels = [
    { ...structuredClone(spectralProfile("direct-eqe").channels[0]), channelId: "green" },
    { ...structuredClone(spectralProfile("separable-eqe").channels[0]), channelId: "red" },
    { ...structuredClone(spectralProfile("responsivity").channels[0]), channelId: "blue" }
  ];
  return profile;
}

const cases: RejectionCase[] = [
  ["non-object reference conditions", (p): void => { p.channels[0].referenceConditions = 5; }, ".referenceConditions must be an object."],
  ["a non-finite reference temperature", (p): void => { p.channels[0].referenceConditions.temperatureC = Number.NaN; },
    ".temperatureC must be a finite number."],
  // #742: a temperature below absolute zero.
  ["a reference temperature below absolute zero", (p): void => { p.channels[0].referenceConditions.temperatureC = -300; },
    ".temperatureC must be above absolute zero (-273.15 °C)."],
  ["a zero sample wavelength", (p): void => { p.channels[0].externalQuantumEfficiency.samples[0].wavelengthNanometers = 0; },
    ".wavelengthNanometers must be greater than zero."],
  ["a negative uncertainty fraction", (p): void => { p.channels[0].uncertainty.fraction = -0.01; }, ".fraction must be greater than or equal to zero."],
  ["an unknown uncertainty kind", (p): void => { p.channels[0].uncertainty = { kind: "absolute" }; }, ".uncertainty.kind is invalid."],
  ["an incidence angle beyond 90 degrees", (p): void => { p.channels[0].referenceConditions.incidenceAngleDegreesFromNormal = 95; },
    ".incidenceAngleDegreesFromNormal must be from 0 through 90 degrees."],
  ["an unknown polarization", (p): void => { p.channels[0].referenceConditions.polarization = "linear"; }, ".polarization is invalid."],
  ["empty reference conditions", (p): void => { p.channels[0].referenceConditions = {}; }, " must declare at least one reference condition."],
  ["a micrometre wavelength unit", (p): void => { p.channels[0].externalQuantumEfficiency.wavelengthUnit = "um"; }, '.wavelengthUnit must be "nm".'],
  ["cubic interpolation", (p): void => { p.channels[0].externalQuantumEfficiency.interpolation = "cubic"; },
    '.interpolation must be "piecewise-linear".'],
  ["clamped extrapolation", (p): void => { p.channels[0].externalQuantumEfficiency.outsideRangeBehavior = "clamp"; },
    '.outsideRangeBehavior must be "fail-closed".'],
  ["a single EQE sample", (p): void => { p.channels[0].externalQuantumEfficiency.samples.pop(); }, " must contain at least two wavelength samples."],
  ["a single responsivity sample", (p): void => { p.channels[2].spectralResponsivity.samples.pop(); }, " must contain at least two wavelength samples."],
  ["non-increasing responsivity wavelengths", (p): void => { p.channels[2].spectralResponsivity.samples[1].wavelengthNanometers = 400; },
    " wavelengths must be strictly increasing."],
  ["a negative responsivity", (p): void => { p.channels[2].spectralResponsivity.samples[1].amperesPerWatt = -0.1; },
    "].amperesPerWatt must be greater than or equal to zero."],
  ["an unknown scientific status", (p): void => { p.channels[0].scientificStatus = "measured"; }, ".scientificStatus is invalid."],
  ["separable curves that do not overlap", (p): void => {
    p.channels[1].channelFilterTransmittance.samples[1].wavelengthNanometers = 450;
    p.channels[1].detectorExternalQuantumEfficiency.samples[0].wavelengthNanometers = 450;
  }, "Separable spectral-response component curves must have a non-empty overlapping wavelength interval."],
  ["modeled condition dependence", (p): void => { p.channels[0].conditionDependence = "modeled"; }, '.conditionDependence must be "not-modeled".'],
  ["an EQE scope on a direct channel", (p): void => { p.channels[0].responseScope = "sensor-wide"; }, "channels[0].responseScope is invalid."],
  ["a wrong separable scope", (p): void => { p.channels[1].responseScope = "site-incident-effective-channel-response"; },
    "channels[1].responseScope is invalid."],
  ["a wrong responsivity scope", (p): void => { p.channels[2].responseScope = "site-incident-channel-filter-times-detector-eqe"; },
    "channels[2].responseScope is invalid."],
  ["an additive separable combination", (p): void => { p.channels[1].combinationRule = "add"; }, '.combinationRule must be "multiply".'],
  ["an unknown channel kind", (p): void => { p.channels[0].kind = "photographic-sensitivity"; }, "channels[0].kind is invalid."],
  ["an unsupported schema version", (p): void => { p.schemaVersion = "0.2.0"; }, 'sensorSpectralResponse.schemaVersion must be "0.1.0".'],
  ["no channels", (p): void => { p.channels = []; }, "sensorSpectralResponse.channels must be a non-empty array."]
];

describe("sensor spectral-response profile rejection branches", () => {
  it("accepts direct, separable and responsivity channels together", () => {
    expect(parseSensorSpectralResponseProfile(base()).channels.map((c) => c.kind)).toEqual(["effective-external-quantum-efficiency",
      "separable-channel-filter-and-detector-eqe", "effective-spectral-responsivity"]);
  });
  it.each(cases)("rejects %s", (_name, mutate, message) => {
    expectRejection(base, parseSensorSpectralResponseProfile, InvalidConfigurationError, mutate, message);
  });

  it.each([
    ["separable", "red", "Requested wavelengthBasis must exactly match the separable response curves."],
    ["responsivity", "blue", "Requested wavelengthBasis must exactly match the response curve"]
  ])("does not convert wavelength basis implicitly for the %s channel", (_kind, channelId, message) => {
    // Fixture curves use the vacuum basis; an air-basis request must fail rather than convert.
    expectRejection(() => ({ colorSamplingProfile: colorProfile(), spectralResponseProfile: base(), channelId, wavelengthNanometers: 450,
      wavelengthBasis: "air" }), (i: Json) => resolveSensorSpectralResponseAtWavelength(i), InvalidScientificInputError, () => undefined, message);
  });
});

describe("fields of another kind (sensor-13, #701)", () => {
  it("refuses an EQE channel that also carries responsivity or separable fields", () => {
    expectRejection(base, parseSensorSpectralResponseProfile, InvalidConfigurationError, (p): void => { p.channels[0].spectralResponsivity = "garbage"; },
      'has unknown field "spectralResponsivity".');
    expectRejection(base, parseSensorSpectralResponseProfile, InvalidConfigurationError, (p): void => { p.channels[0].combinationRule = 42; },
      'has unknown field "combinationRule".');
  });
});
