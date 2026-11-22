// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";
import { calculateSceneSensorEqeTemporalExposure, calculateSceneToSensorIrradianceQuadrature,
  calculateSensorEqeTemporalExposure, createSensorEqeTemporalPhotoSignal, simulateSensorRawFrame,
  createPhotographicExportPair, calculateSensorDarkCurrentCharge,
  type CalculateSceneSensorEqeTemporalExposureInput } from "../src/index.js";
import { input as sensorInput, producerSiteInput } from "./helpers/eqe-exposure-fixture.js";
import { sceneOpticalInput } from "./helpers/scene-optical-quadrature-fixture.js";
import { evidence } from "./helpers/eqe-response-fixture.js";
import { loadSensorRawProducerInput } from "./helpers/sensor-raw-producer-fixture.js";
import { loadPhotographicExportInput } from "./helpers/photographic-export-fixture.js";

function request(base = sensorInput(), intensities = [1, 3], offset = 0): CalculateSceneSensorEqeTemporalExposureInput {
  base.spectralResponseProfile.channels = base.spectralResponseProfile.channels.map(c =>
    c.kind === "separable-channel-filter-and-detector-eqe" ? c : { ...c,
      responseScope: "sensor-package-incident-effective-channel-response" });
  base.responseApplication.sourcePlane.value = "sensor-package-incident";
  const scene = sceneOpticalInput(base);
  const { irradianceSamples, stationarityProfile, ...sensor } = base;
  void irradianceSamples; void stationarityProfile;
  const duration = base.localExposure.exposureWindowInput.nominalExposureDurationSeconds.value;
  return { sensor, optics: scene.optics, sceneBindings: scene.sceneBindings,
    timeReference: "first-opening-boundary-phase",
    samples: intensities.map((intensity, temporalSampleIndex) => {
      const time = offset + (temporalSampleIndex + 0.5) * (duration / intensities.length);
      return { temporalSampleIndex, timeSecondsFromOpeningReference: time,
        sceneSamples: scene.samples.map(s => {
          const sampleId = `time-${temporalSampleIndex}-${s.sceneRadianceRequest.sampleId}`;
          return { ...structuredClone(s), sceneRadianceRequest: { ...s.sceneRadianceRequest, sampleId,
            timeSecondsFromExposureStart: time }, sceneRadianceResult: { ...s.sceneRadianceResult, sampleId,
            spectralRadianceWattsPerSquareMeterSteradianNanometer: intensity } };
        }) };
    }) };
}

it("integrates declared changing radiance with independent per-wavelength SI expectations", () => {
  const r = request(), saved = structuredClone(r);
  const result = calculateSceneSensorEqeTemporalExposure(r);
  const expected = [425, 475].reduce((sum, nm) => sum + 2 * Math.PI/64 * (0.8-(nm-400)*0.004)
    * 480000e-12 * 50 * nm*1e-9 / (6.62607015e-34 * 299792458) * (0.2+(nm-400)*0.004) * 0.01, 0);
  expect(result.value.exposure.value.expectedGeneratedElectronCount / expected).toBeCloseTo(1, 14);
  expect(result.value.exposure.value.timeStationarityEstablished).toBe(false);
  expect(result.value).toMatchObject({ sourceTargetProjectionVerified: false,
    sceneProviderExecutionVerified: false, psfRedistributionApplied: false });
  expect(r).toEqual(saved);
  expect(calculateSceneSensorEqeTemporalExposure({ ...r, samples: [...r.samples].reverse().map(s =>
    ({ ...s, sceneSamples: [...s.sceneSamples].reverse() })) })).toEqual(result);
  const snapshot = structuredClone(result);
  r.samples[0]!.sceneSamples[0]!.sceneRadianceResult.spectralRadianceWattsPerSquareMeterSteradianNanometer = 99;
  expect(result).toEqual(snapshot);
});

it("equals the explicit optical-to-temporal handoff without double area/transmission/exposure", () => {
  const r = request(), scene = sceneOpticalInput();
  const explicit = calculateSensorEqeTemporalExposure({ ...r.sensor, samples: r.samples.map(s => ({
    temporalSampleIndex: s.temporalSampleIndex, timeSecondsFromOpeningReference: s.timeSecondsFromOpeningReference,
    irradianceSamples: calculateSceneToSensorIrradianceQuadrature({ ...scene,
      timeSecondsFromExposureStart: s.timeSecondsFromOpeningReference, samples: s.sceneSamples }).value.irradianceSamples
  })) });
  expect(calculateSceneSensorEqeTemporalExposure(r).value.exposure).toEqual(explicit);
});

it("requires scene timestamps at rolling local midpoints, not global midpoints", () => {
  const base = sensorInput();
  const scan = { kind: "uniform-linear-native-scan" as const,
    directionNative: { value: "top-to-bottom" as const, evidence: evidence("test:direction") },
    traversalDurationSeconds: { value: 0.002, unit: "s" as const, evidence: evidence("test:scan") } };
  base.localExposure.exposureWindowInput.opening = scan;
  base.localExposure.exposureWindowInput.closing = scan;
  const result = calculateSceneSensorEqeTemporalExposure(request(base, [1, 3], 0.0005));
  expect(result.value.exposure.value.startOffsetSecondsFromOpeningReference).toBe(0.0005);
  expect(() => calculateSceneSensorEqeTemporalExposure(request(base))).toThrow(/midpoint/);
});

it.each(["empty", "sparse", "duplicate", "budget", "time-reference", "plane", "node-time", "global-id", "instant-range"])("rejects %s", fault => {
  const r = request();
  if (fault === "empty") r.samples = [];
  if (fault === "sparse") r.samples = new Array(2);
  if (fault === "duplicate") r.samples = [r.samples[0]!, r.samples[0]!];
  if (fault === "budget") r.samples[0]!.sceneSamples = new Array(100001);
  if (fault === "time-reference") r.timeReference = "other" as typeof r.timeReference;
  if (fault === "plane") r.sensor.responseApplication.sourcePlane.value = "site-incident";
  if (fault === "node-time") r.samples[0]!.sceneSamples[0]!.sceneRadianceRequest.timeSecondsFromExposureStart = 0;
  if (fault === "global-id") {
    const id = r.samples[0]!.sceneSamples[0]!.sceneRadianceRequest.sampleId;
    r.samples[1]!.sceneSamples[0]!.sceneRadianceRequest.sampleId = id;
    r.samples[1]!.sceneSamples[0]!.sceneRadianceResult.sampleId = id;
  }
  if (fault === "instant-range") {
    // Mean flux fits, but the bright instant exceeds the declared maximum.
    r.sensor.operatingRangeProfile.inputRange.maximumInclusive = 2 * Math.PI/64 * 0.6 * 100 * 480000e-12 * 1.1;
  }
  expect(() => calculateSceneSensorEqeTemporalExposure(r)).toThrow();
});

it("connects changing declared scene radiance through temporal photo/RAW to exact paired DNG codes", async () => {
  const raw = loadSensorRawProducerInput();
  const sites = raw.sites.map(site => {
    const r = request(producerSiteInput(raw, site), [1e-9, 3e-9]);
    const result = calculateSceneSensorEqeTemporalExposure(r).value;
    const created = createSensorEqeTemporalPhotoSignal({ temporalIntegrationId: `scene-time-${site.charge.photoSignal.site.x}-${site.charge.photoSignal.site.y}`,
      exposure: { ...r.sensor, samples: result.opticalSamples.map(s => ({
        temporalSampleIndex: s.temporalSampleIndex, timeSecondsFromOpeningReference: s.timeSecondsFromOpeningReference,
        irradianceSamples: s.optics.value.irradianceSamples })) } });
    expect(created.value.exposure).toEqual(result.exposure);
    const photoSignal = created.value.photoSignal;
    const darkCharge = calculateSensorDarkCurrentCharge({ exposure: photoSignal, operatingTemperatureC: 20,
      darkCurrentProfile: { schemaVersion: "0.1.0", profileId: site.charge.darkCharge.darkCurrentProfileId,
        colorSamplingProfileId: photoSignal.colorSamplingProfileId, channelId: photoSignal.channelId,
        scientificStatus: "approximation", evidence: raw.frame.colorSamplingProfile.evidence,
        uncertainty: { kind: "not-quantified", limitation: "Owned synthetic fixture." },
        chargeMeaning: "pre-compensation-thermally-generated-electrons", siteApplicability: { kind: "exact-site", site: photoSignal.site },
        temperatureModel: { kind: "fixed-reference-temperature", referenceTemperatureC: 20, darkCurrentElectronsPerSecond: 4 },
        darkCurrentCompensationIncluded: false, spatialDarkCurrentNonuniformityModeled: true } }).value;
    return { ...site, charge: { ...site.charge, photoSignal, darkCharge } };
  });
  const produced = simulateSensorRawFrame({ ...raw, sites });
  expect(simulateSensorRawFrame({ ...raw, sites })).toEqual(produced);
  const output = loadPhotographicExportInput(); output.reconstruction.rawFrame = produced.value.frame;
  const pair = await createPhotographicExportPair(output);
  expect(await createPhotographicExportPair(output)).toEqual(pair);
  const bytes = pair.dng.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let strip = -1;
  for (let i = 0; i < view.getUint16(8, true); i++) {
    const offset = 10 + 12*i;
    if (view.getUint16(offset, true) === 273) strip = view.getUint32(offset+8, true);
  }
  expect(strip).toBeGreaterThan(0);
  expect(Array.from({ length: 4 }, (_, i) => view.getUint16(strip+2*i, true)))
    .toEqual(produced.value.frame.samples.map(s => s.rawCode));
});

it("rejects a null sensor record with a domain error (sensor-11, #701)", () => {
  expect(() => calculateSceneSensorEqeTemporalExposure({ ...request(), sensor: null as never })).toThrow(expect.objectContaining({ name: "InvalidScientificInputError" }));
});
