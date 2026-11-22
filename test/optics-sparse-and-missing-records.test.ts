// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  calculateDefocusBokehKernel, calculateIlluminationVignetting, calculateInverseLateralChromaticAberrationMapping,
  calculateInverseRadialDistortionMapping, calculateInverseRadialDistortionMappings, calculateLateralChromaticAberrationMapping,
  calculateInverseLateralChromaticAberrationMappings, calculateLensComplexPupilPsf, calculateLongitudinalChromaticFocus,
  calculatePolygonPupilFraunhoferPsf, calculatePsfFoundationComponents, calculateRadialDistortionMapping,
  calculateSceneRadianceToSensorIrradiance, calculateSceneToSensorIrradianceQuadrature, calculateSensorApertureRays,
  calculateSensorEnvironmentRadianceQuery, calculateSensorPsfIrradianceQuadrature, createWavefrontPupilGrid, InvalidConfigurationError,
  InvalidScientificInputError, InvalidScientificResultError, parseFrontOfLensFilterProfile, parseLensMtfDiagnosticProfile,
  parseLensSampledPsfProfile, parseSceneToSensorIrradianceProfile, resolveFrontOfLensFilterTransmission, resolveLensPsfConvolutionKernels,
  resolveLensSampledPsf, type CalculateSensorApertureRaysInput, type CalculateSensorEnvironmentRadianceQueryInput
} from "../src/index.js";
import { complexPupilProfileForGrid } from "./helpers/complex-pupil-profile.js";
import { gaussianPsfProfile } from "./helpers/lens-psf-kernel-fixture.js";
import { psfInput } from "./helpers/psf-quadrature-fixture.js";
import { sceneOpticalInput } from "./helpers/scene-optical-quadrature-fixture.js";

/*
 * #726 (with optics-05 of #700): sparse arrays and missing nested records in the optics modules. Each row starts from an input
 * the function accepts, makes one array sparse or removes (or nulls) one record, and expects the engine's domain error. Before
 * 2.28.0 each of them threw a raw TypeError (or a DOMException), returned the hole inside a result, or passed the parser.
 */

const DOMAIN_ERRORS = [InvalidConfigurationError, InvalidScientificInputError, InvalidScientificResultError];
function expectDomainError(call: () => unknown, message?: RegExp): void {
  let thrown: unknown;
  try { call(); } catch (error) { thrown = error; }
  expect(thrown, "expected a domain error").toBeDefined();
  expect(DOMAIN_ERRORS.some((type) => thrown instanceof type), String(thrown)).toBe(true);
  if (message) expect((thrown as Error).message).toMatch(message);
}
/** A copy of `values` with index `hole` missing (not undefined: absent). */
function withHole<T>(values: readonly T[], hole: number): T[] {
  const copy = [...values];
  delete copy[hole];
  return copy;
}
const ev = (reference: string): { sourceOrigin: "photivra"; sourceReference: string; reuseStatus: "photivra-owned" }[] =>
  [{ sourceOrigin: "photivra", sourceReference: "test:" + reference, reuseStatus: "photivra-owned" }];

describe("sparse arrays are refused before their entries are validated (#726 part A)", () => {
  it("Zernike coefficients and the aperture mask", () => {
    const base = { pupilDiameterMm: 12.5, samplesAcross: 5 };
    const term = { nollIndex: 5, coefficientMicrometers: 0.1 };
    expect(() => createWavefrontPupilGrid({ ...base, zernikeCoefficients: [term] })).not.toThrow();
    expectDomainError(() => createWavefrontPupilGrid({ ...base, zernikeCoefficients: withHole([term, term], 0) }), /zernikeCoefficients\[0\] must be an object/);
    expectDomainError(() => createWavefrontPupilGrid({ ...base, zernikeCoefficients: new Array(2) }), /zernikeCoefficients\[0\]/);
    const square = [{ x: -7, y: -7 }, { x: 7, y: -7 }, { x: 7, y: 7 }, { x: -7, y: 7 }];
    expect(() => createWavefrontPupilGrid({ ...base, apertureMaskVerticesMm: square })).not.toThrow();
    expectDomainError(() => createWavefrontPupilGrid({ ...base, apertureMaskVerticesMm: withHole(square, 1) }), /apertureMaskVerticesMm\[1\]/);
  });

  it("complex-pupil amplitude and optical path difference", () => {
    const grid = createWavefrontPupilGrid({ pupilDiameterMm: 12.5, samplesAcross: 5 }).value.grid;
    expect(() => calculateLensComplexPupilPsf({ profile: complexPupilProfileForGrid(grid) })).not.toThrow();
    expectDomainError(() => complexPupilProfileForGrid({ ...grid, relativeAmplitude: withHole(grid.relativeAmplitude, 12) }), /relativeAmplitude\[12\]/);
    expectDomainError(() => complexPupilProfileForGrid({ ...grid, opticalPathDifferenceMicrometers: withHole(grid.opticalPathDifferenceMicrometers, 3) }),
      /opticalPathDifferenceMicrometers\[3\]/);
  });

  it("sampled PSF nodes and kernel samples; the resolver never returns a non-number sample", () => {
    const valid = gaussianPsfProfile({ pitchMicrometers: 6, halfWidth: 2, fieldXmm: [-1, 1], fieldYmm: [-1, 1], focalLengthMm: 50, apertureFNumber: 4 });
    expect(() => parseLensSampledPsfProfile(valid)).not.toThrow();
    const nodes = structuredClone(valid);
    delete (nodes.nodes as unknown[])[1];
    expectDomainError(() => parseLensSampledPsfProfile(nodes), /nodes\[1\]/);
    // One hole whose value is moved to its neighbour, so the other samples still sum to 1.
    const kernel = structuredClone(valid), first = kernel.nodes[0]!.kernel, intensity = [...first.normalizedIntensity];
    intensity[1] = intensity[1]! + intensity[0]!;
    first.normalizedIntensity = withHole(intensity, 0);
    expectDomainError(() => parseLensSampledPsfProfile(kernel), /normalizedIntensity\[0\]/);
    for (const interpolation of ["bounded-regular-grid-centroid-aligned", "bounded-regular-grid-multilinear"] as const) {
      const profile = parseLensSampledPsfProfile({ ...valid, interpolation });
      const resolved = resolveLensSampledPsf({ profile, focalLengthMm: 50, focus: { kind: "infinity" }, apertureFNumber: 4, fieldPointMm: { x: -1, y: -1 },
        wavelengthNm: 380, signedDefocusImagePlaneMicrometers: 0 }).value.kernel.normalizedIntensity;
      expect(Array.from({ length: resolved.length }, (_, k) => typeof resolved[k] === "number").every(Boolean)).toBe(true);
    }
  });

  it("MTF diagnostic samples", () => {
    const valid = { schemaVersion: "0.1.0", profileId: "mtf", profileVersion: "1.0.0", opticalDomain: "lens-primary-optical-path-only",
      phaseInformationAvailable: false, magnitudeMeaning: "mtf-magnitude-only", fieldPointMm: { x: 0, y: 0 }, focalLengthMm: 50, focus: { kind: "infinity" },
      apertureFNumber: 4, wavelengthNm: null, samples: [{ spatialFrequencyCyclesPerMm: 0, sagittalMagnitude: 1, tangentialMagnitude: 1 },
        { spatialFrequencyCyclesPerMm: 20, sagittalMagnitude: 0.7, tangentialMagnitude: 0.6 },
        { spatialFrequencyCyclesPerMm: 40, sagittalMagnitude: 0.4, tangentialMagnitude: 0.3 }], evidence: ev("mtf"), limitations: ["Magnitude only."] };
    expect(() => parseLensMtfDiagnosticProfile(valid as never)).not.toThrow();
    expectDomainError(() => parseLensMtfDiagnosticProfile({ ...valid, samples: withHole(valid.samples, 1) } as never), /samples\[1\]/);
  });

  it("polygon diffraction image points", () => {
    const base = { pupilVerticesMm: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }], pupilToImageDistanceMm: 50, wavelengthNm: 550,
      wavelengthBasis: "air" as const };
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 1 }];
    expect(() => calculatePolygonPupilFraunhoferPsf({ ...base, imagePointsMicrometers: points })).not.toThrow();
    expectDomainError(() => calculatePolygonPupilFraunhoferPsf({ ...base, imagePointsMicrometers: withHole(points, 1) }), /imagePointsMicrometers\[1\]/);
  });

  it("front-of-lens filter and scene-to-sensor transmission samples (a hole inside, first or last)", () => {
    const samples = [{ wavelengthNanometers: 450, linearTransmissionFactor: 0.8 }, { wavelengthNanometers: 550, linearTransmissionFactor: 0.6 },
      { wavelengthNanometers: 650, linearTransmissionFactor: 0.4 }];
    const filter = (value: unknown[]): unknown => ({ schemaVersion: "0.1.0", filterId: "generic-spectral", profileVersion: "1.0.0",
      identityScope: "photivra-generic-unbranded", position: "front-of-lens", scientificStatus: "approximation", wavelengthBasis: "air",
      wavelengthRangeNanometers: { minimum: 450, maximum: 650 }, transmission: { kind: "spectral-transmission", samples: { value, evidence: ev("spectral-data") } },
      uncertainty: { kind: "not-quantified", limitation: "Generic spectral filter." }, polarizationModeled: false, wavelengthChangingBehaviorModeled: false,
      evidence: ev("spectral-filter"), limitations: [] });
    const profile = parseFrontOfLensFilterProfile(filter(samples) as never);
    expect(resolveFrontOfLensFilterTransmission({ profile, wavelengthNanometers: 500, wavelengthBasis: "air" }).linearTransmissionFactor).toBeCloseTo(0.7, 14);
    for (const hole of [0, 1, 2]) expectDomainError(() => parseFrontOfLensFilterProfile(filter(withHole(samples, hole)) as never), new RegExp("value\\[" + hole + "\\] must be an object"));
    const bridge = (value: unknown[]): unknown => ({ schemaVersion: "0.1.0", profileId: "optics-1", profileVersion: "1.0.0", lensProfileId: "lens-generic-1",
      scientificStatus: "approximation", applicability: { focalLengthMm: { minimum: 50, maximum: 50 }, nominalFNumber: { minimum: 1.4, maximum: 16 }, focus: { kind: "any" } },
      transmission: { kind: "spectral-transmission", scientificStatus: "approximation", wavelengthBasis: "air", samples: { value, evidence: ev("transmission") },
        uncertainty: { kind: "not-quantified", limitation: "Generic approximation." } },
      distortionAreaMappingOwnership: "not-applied-by-bridge", psfRedistributionOwnership: "downstream-normalized-energy-redistribution",
      sensorOpticalStackIncluded: false, strayLightIncluded: false, polarizationModeled: false, wavelengthChangingBehaviorModeled: false, volumetricScatteringModeled: false,
      evidence: ev("optical-profile"), limitations: ["Generic optical-throughput profile."] });
    expect(() => parseSceneToSensorIrradianceProfile(bridge(samples) as never)).not.toThrow();
    expectDomainError(() => parseSceneToSensorIrradianceProfile(bridge(withHole(samples, 1)) as never), /value\[1\] must be an object/);
    expectDomainError(() => parseSceneToSensorIrradianceProfile(bridge(new Array(5)) as never), /value\[0\] must be an object/);
  });

  it("longitudinal chromatic focal-shift samples, cat's-eye apertures and spectral weights", () => {
    const samples = [{ wavelengthNm: 450, focalLengthShiftMicrometers: 20 }, { wavelengthNm: 550, focalLengthShiftMicrometers: 0 },
      { wavelengthNm: 650, focalLengthShiftMicrometers: 15 }];
    const focus = (list: unknown[]): unknown => calculateLongitudinalChromaticFocus({ focalLengthMm: 50, referenceWavelengthNm: 550, wavelengthNm: 500,
      apertureFNumber: 4, focusDistanceM: 3, dispersion: { kind: "declared-focal-shift", samples: list as never } });
    expect(() => focus(samples)).not.toThrow();
    expectDomainError(() => focus(withHole(samples, 1)), /dispersion\.samples\[1\] must be an object/);
    const bokeh = (apertures: unknown[]): unknown => calculateDefocusBokehKernel({ focalLengthMm: 50, aperture: 2.8, focusDistanceM: 3, subjectDistanceM: 5,
      pixelPitchMicrometers: 6, bokeh: { catsEye: { apertures: apertures as never } } });
    const aperture = { radiusMm: 20, shiftPerTanFieldMm: 10 };
    expect(() => bokeh([aperture, aperture])).not.toThrow();
    expectDomainError(() => bokeh(withHole([aperture, aperture], 0)), /catsEye\.apertures\[0\]/);
    const profile = gaussianPsfProfile({ pitchMicrometers: 6, halfWidth: 2, fieldXmm: [-1.5, 1.5], fieldYmm: [-1.5, 1.5], focalLengthMm: 50, apertureFNumber: 4 });
    const kernels = (spectralWeights: unknown[]): unknown => resolveLensPsfConvolutionKernels({ schemaVersion: "0.1.0",
      psf: { profile, focalLengthMm: 50, focus: { kind: "infinity" }, apertureFNumber: 4, signedDefocusImagePlaneMicrometers: 0 }, spectralWeights: spectralWeights as never,
      grid: { width: 30, height: 20, sitePitchMicrometers: { x: 6, y: 6 }, opticalAxisSite: { x: 15, y: 10 } }, patchWidth: 15, patchHeight: 10 });
    const weight = { wavelengthNm: 550, weight: 1 };
    expect(() => kernels([weight])).not.toThrow();
    expectDomainError(() => kernels(withHole([weight, weight], 0)), /Invalid spectral weight/);
  });
});

describe("missing or null nested records are domain errors (#726 part B, optics-05)", () => {
  it("resolveLensSampledPsf and calculatePsfFoundationComponents without a field point; only x and y are copied", () => {
    const profile = parseLensSampledPsfProfile(gaussianPsfProfile({ pitchMicrometers: 6, halfWidth: 2, fieldXmm: [-1, 1], fieldYmm: [-1, 1], focalLengthMm: 50,
      apertureFNumber: 4 }));
    const query = { profile, focalLengthMm: 50, focus: { kind: "infinity" as const }, apertureFNumber: 4, fieldPointMm: { x: 0, y: 0 }, wavelengthNm: 550,
      signedDefocusImagePlaneMicrometers: 0 };
    expect(() => resolveLensSampledPsf(query)).not.toThrow();
    for (const fieldPointMm of [undefined, null]) expectDomainError(() => resolveLensSampledPsf({ ...query, fieldPointMm } as never), /fieldPointMm/);
    const foundation = { focalLengthMm: 50, aperture: 4, focusDistanceM: 5, subjectDistanceM: 8, fieldPointMm: { x: 12, y: -5 }, fieldNormalizationRadiusMm: 20,
      spectralBasis: { kind: "monochromatic" as const, wavelengthNm: 550 } };
    expect(calculatePsfFoundationComponents({ ...foundation, fieldPointMm: { x: 12, y: -5, extra: 1 } as never }).value.context.field.imagePointMm).toEqual({ x: 12, y: -5 });
    for (const fieldPointMm of [undefined, null]) expectDomainError(() => calculatePsfFoundationComponents({ ...foundation, fieldPointMm } as never), /fieldPointMm/);
  });

  it("the scene-to-sensor irradiance bridge: focus, working f-number, field throughput and image point records", () => {
    const request = { schemaVersion: "0.1.0" as const, sampleId: "s", providerProfileId: "p", sceneId: "scene", illuminationProfileId: "i",
      materialResponseProfileId: "m", target: { kind: "environment-direction" as const, outgoingDirectionUnitVector: { x: 0, y: 0, z: 1 } },
      timeSecondsFromExposureStart: 0, wavelengthNanometers: 550, wavelengthBasis: "air" as const };
    const radiance = { schemaVersion: "0.1.0" as const, sampleId: "s", providerProfileId: "p", sceneId: "scene", wavelengthNanometers: 550,
      wavelengthBasis: "air" as const, quantity: "outgoing-spectral-radiance" as const, unit: "W/m^2/sr/nm" as const,
      spectralRadianceWattsPerSquareMeterSteradianNanometer: 10, scientificStatus: "approximation" as const,
      uncertainty: { kind: "not-quantified" as const, limitation: "test" }, evidence: ev("radiance"), limitations: ["Test."] };
    const profile = parseSceneToSensorIrradianceProfile({ schemaVersion: "0.1.0", profileId: "optics-1", profileVersion: "1.0.0", lensProfileId: "lens-1",
      scientificStatus: "approximation", applicability: { focalLengthMm: { minimum: 50, maximum: 50 }, nominalFNumber: { minimum: 1.4, maximum: 16 }, focus: { kind: "any" } },
      transmission: { kind: "spectral-transmission", scientificStatus: "approximation", wavelengthBasis: "air", samples: { value: [
        { wavelengthNanometers: 450, linearTransmissionFactor: 0.8 }, { wavelengthNanometers: 650, linearTransmissionFactor: 0.6 }], evidence: ev("t") },
      uncertainty: { kind: "not-quantified", limitation: "Generic." } }, distortionAreaMappingOwnership: "not-applied-by-bridge",
      psfRedistributionOwnership: "downstream-normalized-energy-redistribution", sensorOpticalStackIncluded: false, strayLightIncluded: false,
      polarizationModeled: false, wavelengthChangingBehaviorModeled: false, volumetricScatteringModeled: false, evidence: ev("profile"), limitations: ["Generic."] } as never);
    const vignetting = calculateIlluminationVignetting({ imagePointMm: { x: 10, y: 0 }, profile: { normalizationRadiusMm: 20, maximumNormalizedRadius: 1,
      coefficients: { r2: -0.5, r4: 0, r6: 0 } } }).value;
    const base = { sceneRadianceRequest: request, sceneRadianceResult: radiance, profile, focalLengthMm: 50, nominalFNumber: 4,
      focus: { kind: "infinity-focus" }, imagePointMm: { x: 10, y: 0 }, fieldThroughput: { kind: "illumination-vignetting-result", result: vignetting } };
    const run = (patch: Record<string, unknown>): unknown => calculateSceneRadianceToSensorIrradiance({ ...base, ...patch } as never);
    expect(() => run({})).not.toThrow();
    const supplied = { kind: "supplied-working-f-number", workingFNumber: { value: 4, evidence: ev("n") }, focus: { kind: "infinity" } };
    expect(() => run({ focus: supplied })).not.toThrow();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ focus: undefined }, /focus/], [{ focus: null }, /focus/],
      [{ focus: { ...supplied, workingFNumber: undefined } }, /focus\.workingFNumber/], [{ focus: { ...supplied, focus: undefined } }, /focus\.focus/],
      [{ fieldThroughput: undefined }, /fieldThroughput/], [{ fieldThroughput: { kind: "illumination-vignetting-result" } }, /fieldThroughput\.result/],
      [{ fieldThroughput: { kind: "illumination-vignetting-result", result: { ...vignetting, imagePointMm: undefined } } }, /fieldThroughput\.result\.imagePointMm/],
      [{ imagePointMm: undefined }, /imagePointMm/]];
    for (const [patch, message] of cases) expectDomainError(() => run(patch), message);
  });

  it("the environment query: source point (plain and mapped) and angular velocity with a non-rectilinear mapping", () => {
    const { target, timeSecondsFromExposureStart, ...request } = sceneOpticalInput().samples[0]!.sceneRadianceRequest;
    void target; void timeSecondsFromExposureStart;
    const query: CalculateSensorEnvironmentRadianceQueryInput = { sourcePointNativeSensorMm: { x: 4, y: 3 }, focalLengthMm: 20, focus: { kind: "infinity" },
      angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, timeReference: "first-opening-boundary-phase", timeSecondsFromOpeningReference: 0.005,
      environmentDirectionConvention: "outgoing-radiance-toward-camera", request };
    const fisheye = { projectionModel: "fisheye-equidistant" as const, distortion: { kind: "none" as const }, radiometricAreaCorrection: "inverse-distortion-jacobian" as const };
    expect(() => calculateSensorEnvironmentRadianceQuery(query)).not.toThrow();
    expect(() => calculateSensorEnvironmentRadianceQuery({ ...query, lensFieldMapping: fisheye })).not.toThrow();
    for (const lensFieldMapping of [undefined, fisheye]) {
      const mapping = lensFieldMapping ? { lensFieldMapping } : {};
      expectDomainError(() => calculateSensorEnvironmentRadianceQuery({ ...query, ...mapping, sourcePointNativeSensorMm: undefined } as never), /sourcePointNativeSensorMm/);
    }
    expectDomainError(() => calculateSensorEnvironmentRadianceQuery({ ...query, lensFieldMapping: fisheye, angularVelocityRadPerSec: undefined } as never),
      /angularVelocityRadPerSec/);
  });

  it("aperture rays and the kernel resolver: a missing source point, and values that cannot be copied", () => {
    const rays: CalculateSensorApertureRaysInput = { sourcePointNativeSensorMm: { x: 8, y: 3 }, focalLengthMm: 50, nominalFNumber: 2, focus: { kind: "finite", distanceM: 4 },
      angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0 }, timeSecondsFromOpeningReference: 0, pupil: { kind: "ideal-uniform-circular-pupil",
        radialSampleCount: 4, angularSampleCount: 16, evidence: ev("pupil"), limitation: "Constructed ideal geometric reference." } };
    expect(() => calculateSensorApertureRays(rays)).not.toThrow();
    expectDomainError(() => calculateSensorApertureRays({ ...rays, sourcePointNativeSensorMm: undefined } as never), /sourcePointNativeSensorMm/);
    expectDomainError(() => calculateSensorApertureRays({ ...rays, pupil: { ...rays.pupil, limitation: (() => "x") as never } }), /plain data/);
    const profile = gaussianPsfProfile({ pitchMicrometers: 6, halfWidth: 2, fieldXmm: [-1.5, 1.5], fieldYmm: [-1.5, 1.5], focalLengthMm: 50, apertureFNumber: 4 });
    expectDomainError(() => resolveLensPsfConvolutionKernels({ schemaVersion: "0.1.0", psf: { profile: { ...profile, profileId: (() => "x") as never },
      focalLengthMm: 50, focus: { kind: "infinity" }, apertureFNumber: 4, signedDefocusImagePlaneMicrometers: 0 }, spectralWeights: [{ wavelengthNm: 550, weight: 1 }],
      grid: { width: 30, height: 20, sitePitchMicrometers: { x: 6, y: 6 }, opticalAxisSite: { x: 15, y: 10 } }, patchWidth: 15, patchHeight: 10 }), /Invalid PSF state/);
  });

  it("the irradiance quadratures: scene bindings, spectral quadrature and a node's source point", () => {
    const scene = sceneOpticalInput();
    expect(() => calculateSceneToSensorIrradianceQuadrature(scene)).not.toThrow();
    expectDomainError(() => calculateSceneToSensorIrradianceQuadrature({ ...scene, sceneBindings: undefined } as never), /sceneBindings/);
    const psf = psfInput();
    expect(() => calculateSensorPsfIrradianceQuadrature(psf)).not.toThrow();
    expectDomainError(() => calculateSensorPsfIrradianceQuadrature({ ...psf, spectralQuadrature: undefined } as never), /spectralQuadrature/);
    const nodes = psf.spatialQuadrature.nodes.map((node, index) => index === 0 ? { ...node, preAntiAliasingSourcePointMm: undefined } : node);
    expectDomainError(() => calculateSensorPsfIrradianceQuadrature({ ...psf, spatialQuadrature: { ...psf.spatialQuadrature, nodes } } as never),
      /preAntiAliasingSourcePointMm/);
  });

  it("distortion, lateral colour and vignetting profiles without their records (optics-05)", () => {
    const imagePointMm = { x: 1, y: 1 }, radial = { normalizationRadiusMm: 20, maximumNormalizedRadius: 1 };
    const lateral = { normalizationRadiusMm: 20, maximumNormalizedRadius: 1 };
    const calls: (() => unknown)[] = [
      (): unknown => calculateIlluminationVignetting({ imagePointMm } as never),
      (): unknown => calculateIlluminationVignetting({ imagePointMm, profile: { normalizationRadiusMm: 20, maximumNormalizedRadius: 1 } } as never),
      (): unknown => calculateIlluminationVignetting({ imagePointMm, profile: null } as never),
      (): unknown => calculateRadialDistortionMapping({ imagePointMm, profile: radial } as never),
      (): unknown => calculateInverseRadialDistortionMapping({ distortedImagePointMm: imagePointMm, profile: { ...radial, coefficients: null } } as never),
      (): unknown => calculateInverseRadialDistortionMappings({ distortedImagePointsMm: [imagePointMm], profile: radial } as never),
      (): unknown => calculateLateralChromaticAberrationMapping({ imagePointMm, profile: {} } as never),
      (): unknown => calculateLateralChromaticAberrationMapping({ imagePointMm, profile: { ...lateral, baseDistortionCoefficients: { k1: 0, k2: 0, k3: 0 },
        redCoefficientOffset: null, blueCoefficientOffset: { k1: 0, k2: 0, k3: 0 } } } as never),
      (): unknown => calculateInverseLateralChromaticAberrationMapping({ distortedImagePointMm: imagePointMm, profile: lateral } as never),
      (): unknown => calculateInverseLateralChromaticAberrationMappings({ distortedImagePointsMm: [imagePointMm], profile: lateral } as never)];
    for (const call of calls) expectDomainError(call);
  });
});
