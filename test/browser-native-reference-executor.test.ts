// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  createBrowserNativeReferenceTask,
  type BrowserNativeReferenceExecutorProvider,
  type BrowserNativeReferencePhotoBatch,
  type BrowserNativeReferenceTask
} from "../src/capture/browser-native-reference-executor.js";
import {
  BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION
} from "../src/capture/browser-native-reference-geometry.js";
import {
  prepareBrowserNativeReferenceEventPlan
} from "../src/capture/browser-native-reference-plan.js";
import {
  prepareBrowserNativeReferenceSite
} from "../src/capture/browser-native-reference-site.js";
import {
  BROWSER_NATIVE_REFERENCE_SOURCE_VERSION,
  prepareBrowserNativeReferenceSource,
  type PreparedBrowserNativeReferenceSource
} from "../src/capture/browser-native-reference-source.js";
import type { NativeEnvironmentRawInput } from "../src/capture/native-environment-raw.js";
import { simulateEnvironmentSensorRawFrame } from "../src/capture/environment-raw-producer.js";
import {
  evaluator,
  frameInput
} from "./helpers/environment-raw-fixture.js";
import { evidence } from "./helpers/eqe-response-fixture.js";

function denseFixture(rolling: boolean): ReturnType<typeof frameInput> {
  const fixture = frameInput(rolling);
  const pupil = {
    kind: "ideal-uniform-circular-pupil" as const,
    radialSampleCount: 2,
    angularSampleCount: 16,
    evidence: evidence("test:249-pupil"),
    limitation: "Owned #249 exact-parity pupil."
  };
  const staticEvaluator = (
    request: Parameters<typeof evaluator>[0]
  ): ReturnType<typeof evaluator> => ({
    ...evaluator(request),
    spectralRadianceWattsPerSquareMeterSteradianNanometer: 1e-9,
    limitations: ["Owned static uniform spectral-radiance source."]
  });
  for (const site of fixture.sites) {
    site.environment.pupil = structuredClone(pupil);
    site.environment.motion.angularVelocityRadPerSec = {
      pitch: 0,
      yaw: 0,
      roll: 0
    };
    const bindings = site.environment.sceneBindings;
    const {
      illuminationTemporalProfileId: ignoredTemporalProfileId,
      ...providerProfile
    } = bindings.providerProfile;
    void ignoredTemporalProfileId;
    site.environment.sceneBindings = {
      providerProfile,
      illuminationProfile: bindings.illuminationProfile,
      materialResponseProfile: bindings.materialResponseProfile
    };
  }
  fixture.evaluateRadiance = staticEvaluator;
  fixture.evaluateApertureRadiance = (
    request
  ): ReturnType<typeof evaluator> => staticEvaluator(request);
  return fixture;
}

function eventInput(
  fixture: ReturnType<typeof denseFixture>,
  maximumProviderEvaluations = 100_000,
  tileWidth?: number
): NativeEnvironmentRawInput {
  const capture = fixture.frame.capture;
  const {
    schemaVersion,
    engineApiVersion,
    resolvedGeometry,
    equivalentFocalLength35Mm,
    planes,
    ...exposure
  } = capture;
  void schemaVersion;
  void engineApiVersion;
  void resolvedGeometry;
  void equivalentFocalLength35Mm;
  void planes;

  const {
    capture: ignoredCapture,
    containerBitDepth,
    ...frame
  } = fixture.frame;
  void ignoredCapture;
  void containerBitDepth;

  return {
    raw: {
      ...frame,
      exposure,
      exposureWindow: fixture.exposureWindow,
      maximumOutputBytes: 28,
      ...(tileWidth === undefined ? {} : { tileWidth })
    },
    sceneBinding: fixture.sceneBinding,
    maximumProviderEvaluations
  };
}

function prepared(
  fixture: ReturnType<typeof denseFixture>,
  maximumProviderEvaluations = 100_000,
  tileWidth?: number
): {
  eventPlan: ReturnType<typeof prepareBrowserNativeReferenceEventPlan>;
  source: PreparedBrowserNativeReferenceSource;
  sites: ReturnType<typeof prepareBrowserNativeReferenceSite>[];
} {
  const event = eventInput(
    fixture,
    maximumProviderEvaluations,
    tileWidth
  );
  const eventPlan = prepareBrowserNativeReferenceEventPlan({
    event,
    geometry: {
      schemaVersion: BROWSER_NATIVE_REFERENCE_GEOMETRY_VERSION,
      sourceStateId: event.raw.exposure.sceneStateId,
      providerSceneId: event.sceneBinding.providerSceneId,
      sourceRevision: "test-249-large-plane-v1",
      primitives: [
        {
          kind: "axis-aligned-rectangle",
          primitiveId: "background",
          minimumM: { x: -1000, y: -1000, z: 10 },
          maximumM: { x: 1000, y: 1000, z: 10 }
        }
      ]
    }
  });
  const source = prepareBrowserNativeReferenceSource(
    eventPlan.geometry,
    {
      version: BROWSER_NATIVE_REFERENCE_SOURCE_VERSION,
      sourceStateId: eventPlan.geometry.sourceStateId,
      providerSceneId: eventPlan.geometry.providerSceneId,
      sourceRevision: eventPlan.geometry.sourceRevision,
      wavelengthBasis: "vacuum",
      primitives: [
        {
          primitiveId: "background",
          evidence: evidence("test:249-source"),
          limitation: "Owned constant spectral-radiance source for #249 parity.",
          spectrum: [
            {
              wavelengthNanometers: 425,
              spectralRadianceWattsPerSquareMeterSteradianNanometer: 1e-9
            },
            {
              wavelengthNanometers: 475,
              spectralRadianceWattsPerSquareMeterSteradianNanometer: 1e-9
            }
          ]
        }
      ]
    }
  );
  const sites = fixture.sites.map((site, index) =>
    prepareBrowserNativeReferenceSite(eventPlan, site, index)
  );
  return { eventPlan, source, sites };
}

function provider(
  observed: BrowserNativeReferencePhotoBatch["sites"][number][] = []
): BrowserNativeReferenceExecutorProvider {
  return {
    observePhotoBatch(
      batch: Parameters<
        NonNullable<BrowserNativeReferenceExecutorProvider["observePhotoBatch"]>
      >[0]
    ): void {
      expect(Object.isFrozen(batch)).toBe(true);
      for (const site of batch.sites) observed.push(site);
    },
    async yieldControl(): Promise<void> {}
  };
}

describe("bounded prepared browser-native Path-A executor", () => {
  it("matches global and native-scan reference photons/RAW while reusing exact visibility across wavelengths", async () => {
    for (const rolling of [false, true]) {
      const fixture = denseFixture(rolling);
      const reference = simulateEnvironmentSensorRawFrame(fixture);
      const { eventPlan, source, sites } = prepared(fixture);
      const observed: BrowserNativeReferencePhotoBatch["sites"][number][] = [];
      const task = createBrowserNativeReferenceTask(
        { eventPlan, source, sites, batchSize: 2 },
        provider(observed)
      );

      await task.run();
      const output = task.takeOutput();

      expect(Array.from(output.codes)).toEqual(
        reference.value.raw.value.frame.samples.map((sample) => sample.rawCode)
      );
      expect(observed.map((site) => site.nativeIndex)).toEqual([0, 1, 2, 3]);
      expect(
        observed.map((site) => ({
          photons: site.expectedIncidentPhotonCount,
          electrons: site.expectedGeneratedElectronCount
        }))
      ).toEqual(
        reference.value.sites.map((site) => ({
          photons: site.value.photo.value.photoSignal.expectedIncidentPhotonCount,
          electrons:
            site.value.photo.value.photoSignal.expectedGeneratedElectronCount
        }))
      );
      expect(task.work.logical.committedSourceSampleCount).toBe(
        reference.value.providerEvaluationCount
      );
      expect(task.work.actual.spectralOpticalCompositionAttempts).toBe(
        reference.value.providerEvaluationCount
      );
      expect(task.work.actual.sourceRadianceAttempts).toBe(
        reference.value.providerEvaluationCount
      );
      expect(task.work.actual.geometryAttempts).toBe(
        task.work.planned.uniqueGeometryRequests
      );
      expect(
        task.work.actual.geometryAttempts +
          task.work.actual.geometryReuseHits
      ).toBe(reference.value.providerEvaluationCount);
      expect(task.work.actual.geometryReuseHits).toBeGreaterThan(0);
      expect(task.work.actual.sensorSiteAttempts).toBe(4);
      expect(task.work.actual.completedBatchCount).toBe(2);
    }
  });

  it("keeps exact output invariant across legal prepared batch sizes", async () => {
    const fixtureA = denseFixture(false);
    const fixtureB = denseFixture(false);
    const a = prepared(fixtureA);
    const b = prepared(fixtureB);

    const one = createBrowserNativeReferenceTask(
      { ...a, batchSize: 1 },
      provider()
    );
    const four = createBrowserNativeReferenceTask(
      { ...b, batchSize: 4 },
      provider()
    );

    await one.run();
    await four.run();

    const outputOne = one.takeOutput();
    const outputFour = four.takeOutput();
    expect(Array.from(outputFour.codes)).toEqual(Array.from(outputOne.codes));
    expect(Array.from(outputFour.blackLevels)).toEqual(
      Array.from(outputOne.blackLevels)
    );
    expect(Array.from(outputFour.digitalSaturationCodes)).toEqual(
      Array.from(outputOne.digitalSaturationCodes)
    );
    expect(Array.from(outputFour.saturationFlags)).toEqual(
      Array.from(outputOne.saturationFlags)
    );
    expect(one.work.logical).toEqual(four.work.logical);
    expect(one.work.planned.uniqueGeometryRequests).toBe(
      four.work.planned.uniqueGeometryRequests
    );
    expect(one.work.actual.geometryAttempts).toBe(
      four.work.actual.geometryAttempts
    );
    expect(one.work.actual.spectralOpticalCompositionAttempts).toBe(
      four.work.actual.spectralOpticalCompositionAttempts
    );
    expect(one.work.actual.completedBatchCount).toBe(4);
    expect(four.work.actual.completedBatchCount).toBe(1);
  });

  it("rejects camera motion outside the frozen static qualification envelope", () => {
    const dynamicFixture = denseFixture(false);
    for (const site of dynamicFixture.sites) {
      site.environment.motion.angularVelocityRadPerSec = {
        pitch: 0.1,
        yaw: 0,
        roll: 0
      };
    }
    const preparedInput = prepared(dynamicFixture);

    expect(() =>
      createBrowserNativeReferenceTask(
        { ...preparedInput, batchSize: 1 },
        provider()
      )
    ).toThrow("static-source, zero-camera-motion");
  });

  it("rejects the whole event before scientific execution when dynamic work exceeds the unchanged budget", () => {
    const fixture = denseFixture(false);
    const { eventPlan, source, sites } = prepared(fixture, 4);
    let yields = 0;
    expect(() =>
      createBrowserNativeReferenceTask(
        { eventPlan, source, sites, batchSize: 1 },
        {
          async yieldControl(): Promise<void> {
            yields += 1;
          }
        }
      )
    ).toThrow("whole-event dynamic scientific-work budget");
    expect(yields).toBe(0);
  });

  it("preflights exact source wavelength coverage before scientific execution", () => {
    const fixture = denseFixture(false);
    const preparedInput = prepared(fixture);
    const incompleteSource = prepareBrowserNativeReferenceSource(
      preparedInput.eventPlan.geometry,
      {
        version: BROWSER_NATIVE_REFERENCE_SOURCE_VERSION,
        sourceStateId: preparedInput.eventPlan.geometry.sourceStateId,
        providerSceneId: preparedInput.eventPlan.geometry.providerSceneId,
        sourceRevision: preparedInput.eventPlan.geometry.sourceRevision,
        wavelengthBasis: "vacuum",
        primitives: [
          {
            primitiveId: "background",
            evidence: evidence("test:249-incomplete-source"),
            limitation: "Deliberately missing one committed wavelength.",
            spectrum: [
              {
                wavelengthNanometers: 425,
                spectralRadianceWattsPerSquareMeterSteradianNanometer: 1e-9
              }
            ]
          }
        ]
      }
    );

    expect(() =>
      createBrowserNativeReferenceTask(
        {
          eventPlan: preparedInput.eventPlan,
          source: incompleteSource,
          sites: preparedInput.sites,
          batchSize: 1
        },
        provider()
      )
    ).toThrow("cover every exact committed site wavelength");
  });

  it("counts attempted scientific work and withholds output on observer failure", async () => {
    const fixture = denseFixture(false);
    const preparedInput = prepared(fixture);
    const task = createBrowserNativeReferenceTask(
      { ...preparedInput, batchSize: 1 },
      {
        observePhotoBatch(): never {
          throw new Error("observer failed");
        },
        async yieldControl(): Promise<void> {}
      }
    );

    await expect(task.run()).rejects.toThrow("observer failed");
    expect(task.state).toBe("failed");
    expect(task.work.actual.geometryAttempts).toBeGreaterThan(0);
    expect(task.work.actual.sourceRadianceAttempts).toBeGreaterThan(0);
    expect(task.work.actual.spectralOpticalCompositionAttempts).toBe(
      task.work.actual.sourceRadianceAttempts
    );
    expect(task.work.actual.observerAttempts).toBe(1);
    expect(task.work.actual.sensorSiteAttempts).toBe(0);
    expect(() => task.takeOutput()).toThrow("unavailable");
  });

  it("stops new work on cancellation and keeps attempted counters visible", async () => {
    const fixture = denseFixture(false);
    const preparedInput = prepared(fixture);
    const holder: { task?: BrowserNativeReferenceTask } = {};
    const task = createBrowserNativeReferenceTask(
      { ...preparedInput, batchSize: 1 },
      {
        observePhotoBatch(): void {
          holder.task!.cancel();
        },
        async yieldControl(): Promise<void> {}
      }
    );
    holder.task = task;

    await expect(task.run()).rejects.toThrow("aborted");
    expect(task.state).toBe("cancelled");
    expect(task.work.actual.geometryAttempts).toBeGreaterThan(0);
    expect(task.work.actual.sourceRadianceAttempts).toBeGreaterThan(0);
    expect(task.work.actual.observerAttempts).toBe(1);
    expect(task.work.actual.sensorSiteAttempts).toBe(0);
    expect(() => task.takeOutput()).toThrow("unavailable");
  });

  it("rejects mixed source/optical prepared-site state before execution", () => {
    const fixture = denseFixture(false);
    fixture.sites[1]!.environment.fieldThroughput = {
      ...fixture.sites[1]!.environment.fieldThroughput,
      limitation: "Deliberately different event-wide throughput declaration."
    };
    const preparedInput = prepared(fixture);

    expect(() =>
      createBrowserNativeReferenceTask(
        { ...preparedInput, batchSize: 1 },
        provider()
      )
    ).toThrow("one shared source/optical/motion state");
  });

  it("rejects mismatched prepared event/site identity before execution", () => {
    const fixtureA = denseFixture(false);
    const fixtureB = denseFixture(false);
    const a = prepared(fixtureA);
    const b = prepared(fixtureB, 100_000, 2);
    const mismatched = [...a.sites];
    mismatched[0] = b.sites[0]!;

    expect(() =>
      createBrowserNativeReferenceTask(
        {
          eventPlan: a.eventPlan,
          source: a.source,
          sites: mismatched,
          batchSize: 1
        },
        provider()
      )
    ).toThrow("event/native index");
  });
});

describe("readout ISO against the committed capture (capture-33, #698)", () => {
  it("refuses a readout regime whose exposure-index gain differs from the capture ISO, as the frame producer does", async () => {
    const fixture = denseFixture(false);
    const iso = fixture.frame.capture.exposure.iso;
    for (const site of fixture.sites) for (const regime of site.readout.readoutProfile.regimes as unknown as Record<string, unknown>[])
      regime.exposureIndexGain = { exposureIndex: 4 * iso, baseExposureIndex: iso, analogGain: 4, digitalGain: 1, conversionGainMode: "single-conversion-gain", evidence: evidence("test:capture-33") };
    expect(() => simulateEnvironmentSensorRawFrame(fixture)).toThrow("Readout regime ISO gain differs from the committed capture ISO.");
    const { eventPlan, source, sites } = prepared(fixture);
    const task = createBrowserNativeReferenceTask({ eventPlan, source, sites, batchSize: 2 }, provider());
    await expect(task.run()).rejects.toThrow("Readout regime ISO gain differs from the committed capture ISO.");
  });
  it("prepareBrowserNativeReferenceEventPlan refuses a missing event with a domain error", async () => {
    const { InvalidConfigurationError } = await import("../src/index.js");
    expect(() => prepareBrowserNativeReferenceEventPlan({} as never)).toThrow(InvalidConfigurationError);
    expect(() => prepareBrowserNativeReferenceEventPlan({ event: { raw: undefined } } as never)).toThrow(InvalidConfigurationError);
  });
});
