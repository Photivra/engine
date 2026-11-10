// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import * as engine from "../src/index.js";
import {
  InvalidConfigurationError,
  InvalidScientificInputError,
  InvalidScientificResultError
} from "../src/index.js";
import { probeSubObjects } from "./helpers/sub-object-probe.js";

/** Domain error classes a caller can handle; anything else escaping a root function is a defect. */
function isDomainError(error: unknown): boolean {
  return error instanceof InvalidConfigurationError ||
    error instanceof InvalidScientificInputError ||
    error instanceof InvalidScientificResultError;
}

const MALFORMED_INPUTS: readonly [string, unknown][] = [
  ["null", null], ["undefined", undefined], ["{}", {}], ["42", 42], ["\"x\"", "x"], ["[]", []]
];

const rootFunctions = Object.entries(engine)
  .filter((entry): entry is [string, (...args: unknown[]) => unknown] => typeof entry[1] === "function")
  // Exported error classes are constructors, not calculations.
  .filter(([, value]) => !/^class\b/u.test(Function.prototype.toString.call(value)));

describe("root exports reject malformed input with domain errors (API review #4)", () => {
  it("covers every root function", () => {
    expect(rootFunctions.length).toBeGreaterThan(250);
  });

  it("never lets a raw TypeError or RangeError escape for null, undefined, {}, 42, \"x\" or []", async () => {
    const escaped: string[] = [];
    for (const [name, fn] of rootFunctions) {
      for (const [label, input] of MALFORMED_INPUTS) {
        try {
          const result = fn(input);
          if (result instanceof Promise) await result;
        } catch (error) {
          if (!isDomainError(error)) {
            escaped.push(`${name}(${label}): ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)}`);
          }
        }
      }
    }
    expect(escaped).toEqual([]);
  });

  it("rejects unknown fields on the simple scalar calculators", () => {
    const strict = ["calculateEquivalentFocalLength35Mm", "calculateSensorEquivalence", "calculateBlurShareOfFrame", "calculateFieldOfView", "calculateFieldOfViewBounds", "calculateProjectedObjectSize",
      "calculateDepthOfField", "calculateDefocusCircle", "calculateDefocusDiscKernelRadius", "estimateEquivalentViewingCircleOfConfusion", "calculateAiryDisk",
      "calculateExposureValue100", "calculateRelativeOpticalExposure", "calculateRelativeRenderedExposure", "calculateEquivalentIso",
      "calculateThinLensImageDistance", "calculateIdealApertureGeometry", "calculatePixelPitch", "calculatePlanckianSpectralRadiance",
      "estimatePlanckianLocusChromaticity", "prepareBt1886Eotf", "calculateFilteredExposureTime", "calculateApertureDiameter", "calculateCropToMatchFocalLength",
      "calculateDetailLimit",
      "calculateSignalToNoise", "calculateProjectedMotionBlur"] as const;
    for (const name of strict) {
      const fn = engine[name] as (input: unknown) => unknown;
      expect(() => fn({ unexpectedField: 1 }), name).toThrow(new InvalidConfigurationError(`${name} input has unknown field "unexpectedField".`));
    }
  });

  it("rejects a misspelled or wrong-unit field next to valid fields (2.0.0: every calculator is strict)", () => {
    const cases: readonly [string, () => unknown, string][] = [
      ["calculateSignalToNoise", (): unknown => engine.calculateSignalToNoise({ signalElectrons: 100, readNoiseElectrons: 2,
        darkCurrentElectrons: 5 } as never), "darkCurrentElectrons"],
      ["calculateProjectedMotionBlur", (): unknown => engine.calculateProjectedMotionBlur({ focalLengthMm: 50, shutterSeconds: 1 / 100,
        positionM: { x: 0, y: 0, z: 10 }, velocityMps: { x: 1, y: 0, z: 0 }, focusDistanceMm: 10_000 } as never), "focusDistanceMm"],
      ["calculatePhotoelectrons", (): unknown => engine.calculatePhotoelectrons({ incidentPhotons: 100, quantumEfficiency: 0.5,
        quantumEfficiencyPercent: 50 } as never), "quantumEfficiencyPercent"],
      ["estimateCameraShakeBlur", (): unknown => engine.estimateCameraShakeBlur({ focalLengthMm: 50, shutterSeconds: 1 / 30,
        angularVelocityRadPerSec: { yaw: 0.01, pitch: 0 }, stabilizationStopsEquivalent: 0, pixelPitchMm: 0.004 } as never), "pixelPitchMm"],
      ["calculateCenteredCrop", (): unknown => engine.calculateCenteredCrop({ pixelWidth: 6000, pixelHeight: 4000, cropFactor: 1.5,
        cropFactorPercent: 150 } as never), "cropFactorPercent"]
    ];
    for (const [name, call, field] of cases) {
      expect(call, name).toThrow(new InvalidConfigurationError(`${name} input has unknown field ${JSON.stringify(field)}.`));
    }
    // The same calls without the extra field still succeed, so the extra field alone causes the rejection.
    expect(engine.calculateSignalToNoise({ signalElectrons: 100, readNoiseElectrons: 2 }).value.snrLinear).toBeCloseTo(100 / Math.sqrt(104), 12);
    expect(engine.calculateProjectedMotionBlur({ focalLengthMm: 50, shutterSeconds: 1 / 100, positionM: { x: 0, y: 0, z: 10 },
      velocityMps: { x: 1, y: 0, z: 0 } }).value.distanceMm).toBeGreaterThan(0);
  });

  /*
   * Every root function is classified. Functions that take an input object must reject an unknown
   * field. Most use the shared message "<name> input has unknown field ...". The others are listed
   * below with the reason, so a new root export must be classified here before it ships.
   */
  const STRICT_WITH_DOMAIN_MESSAGE = new Set([
    // Reject unknown fields through their own allowlist parser, with a domain message.
    "calculateCaptureColorTransform", "calculateCaptureCorrectedSdr", "calculateCaptureSdr", "calculateIdealPolygonDiffractionPsf",
    "calculateChartRadianceBatch", "calculateChartRadianceBatchPlan", "calculateIrradianceConvolution", "calculateIrradianceConvolutionPlan", "calculatePackedSensorRawPlan", "calculateTemporalExposureSum",
    "calculateTemporalExposureSumPlan", "calculateLinearCaptureEncoding", "calculateNativeCaptureSdrPlan",
    "calculateNativeRawPlan", "calculatePrintContrastReference", "calculatePrintPlan", "calculatePrintRegionDetail",
    "calculatePrintRegionDifference", "calculatePrintRegionNoise", "calculatePrintSizeLimit", "calculateProcessedSensorRaw",
    "calculateSdrRendering", "createAhdDemosaicTask", "createBilateralFilterTask", "createCaptureExportMetadataPair",
    "createCfaPlaneReconstructionTask", "createDiffractionLimitedPsfProfile", "createDurandDorseyToneMappingTask", "createExposureFusionTask", "createFocusStackTask",
    "createGenericEquipmentTierSelection", "createHdrBracketMergeTask", "createHdrImageEncodingTask", "createImageKernelAccelerator",
    "createIsoGainReadoutRegimes", "createNativeCaptureSdrTask", "createNativeEnvironmentRawPartitionTask", "createNativeEnvironmentRawTask", "createNativeEnvironmentSensorStageTask",
    "createNativeRawDevelopmentTask", "createNativeRawTask", "composeNativeEnvironmentRawPartitions", "createNonLocalMeansTask", "createPanoramaTask", "createPhotographicExportPair",
    "createPrintJpegStrip", "createPrintJpegTask", "composePrintJpegStrips", "createReinhardGlobalToneMappingTask", "createSensorRawFrame", "createSimulatedCapture",
    "createSyntheticFilmGrainTask", "mapEnvironmentDirectionsToChartPoints", "createUnsharpMaskTask", "resolveCaptureIlluminant", "resolveLensPsfConvolutionKernels", "resolveGenericEquipmentTierCatalog",
    "resolveGenericEquipmentTierLensProfiles", "resolveRawFrameReconstruction", "serializeNativeRawDng", "serializePngImage",
    "prepareDisplayView", "serializeSimulatedCaptureDngFromParts", "simulateCapture", "simulateCaptureFromParts", "simulateDisplayView", "simulateExposureBuildUp", "simulateIdealReference", "simulatePackedSensorRaw", "simulateSensorRawFrame"
  ]);
  const NO_INPUT_OBJECT = new Set([
    // Positional scalars or bound objects, a string id, raw bytes, result factories or no argument at all.
    "approximationResult", "composeRelativeErrorBounds", "assessShutterAngleRule", "calculateCieIlluminantARelativeSpectralPower", "calculateGenericPrimeMinimumFocusDistanceM", "calculateHighlightPriorityPlacementSignal",
    "calculateShutterAngleExposureSeconds", "calculateShutterAngleFromExposureSeconds", "calculatedResult", "calibratedResult",
    "createCieIlluminantASpectrum", "createSrgbIccProfile", "estimateCie1931ColorMatchingFunctions", "estimatedResult",
    "evaluateBt709InverseOetf", "evaluateBt709Oetf", "evaluateHlgInverseOetf", "evaluateHlgOetf", "evaluatePqEotf", "evaluatePqInverseEotf",
    "evaluateSrgbDecoding", "evaluateSrgbEncoding", "evaluateZernikePolynomial", "getImageFormationContract", "getPsfFoundationContract",
    "resolveCaptureColorModel", "resolveChromaticAdaptationConeMatrix", "resolveRgbColorSpace", "resolveZernikeNollOrder",
    // Parsers of a string, an array or raw bytes rather than a record.
    "parseColorimetricQuadratureNodes", "parseLensProjectionModel", "parseLosslessJpeg", "parseSpectralWavelengthBasis",
    // #447: the AHD correction states of the display view: no argument, and an array of { key, gridKeys, values } entries.
    "serializeDisplayViewCorrectionStates", "bindDisplayViewCorrectionStates",
    // #474: the realm's WebGPU switch: no argument, and one boolean.
    "getWebGpuEnabled", "setWebGpuEnabled",
    // #388: the text writers take a file's raw bytes and the text; the text rejects unknown fields as output.metadata does.
    "addJpegTextMetadata", "addPngTextMetadata",
    // 2.14: the built-in colour-patch set, a static contract with no argument.
    "getColorPatchSet"
  ]);
  /*
   * 2.0.0: the parse*() record parsers and the functions that take a whole engine or versioned record
   * are strict too. They name the path of the record and the field, for example
   * `sceneIlluminationProfile has unknown field "unexpectedField".` (or, where an existing domain
   * message is kept, `<message> Unknown field "unexpectedField".`).
   */
  const RECORD_FUNCTIONS = new Set([
    "assessMtfOnlyPsfRenderability", "assessRadiometryReadiness", "assessSceneMaterialResponseFidelity",
    "calculateNativeRawRowBands", "createRollingShutterCaptureExposureSchedule", "createTtlScaledFlashProfile", "integrateDiscreteSpectralLineMeasure",
    "prepareColorMatchingFunctions", "prepareColorimetricSpectrum", "resolveAntiAliasingSpatialKernel",
    "resolveSceneIlluminationDiscreteLineMeasure", "serializeProductionImageFormationPlan", "validateCalculationQuality"
  ]);
  const namesUnknownField = (message: string | undefined): boolean => /unknown field "unexpectedField"/iu.test(message ?? "");

  it("classifies every root function, and every input-object function outside the lists rejects unknown fields", async () => {
    const unclassified: string[] = [];
    const misclassified: string[] = [];
    const lenientRecords: string[] = [];
    for (const [name, fn] of rootFunctions) {
      let message: string | undefined;
      let isConfiguration = false;
      try {
        const result = fn({ unexpectedField: 1 });
        if (result instanceof Promise) await result;
      } catch (error) {
        isConfiguration = error instanceof InvalidConfigurationError;
        message = error instanceof Error ? error.message : undefined;
      }
      const shared = isConfiguration && message === `${name} input has unknown field "unexpectedField".`;
      const takesRecord = (name.startsWith("parse") || RECORD_FUNCTIONS.has(name)) && !NO_INPUT_OBJECT.has(name);
      const listed = STRICT_WITH_DOMAIN_MESSAGE.has(name) || NO_INPUT_OBJECT.has(name) || RECORD_FUNCTIONS.has(name);
      if (takesRecord && !(isConfiguration && namesUnknownField(message))) lenientRecords.push(`${name}: ${message ?? "no error"}`);
      if (shared && listed) misclassified.push(name);
      if (!shared && !listed && !takesRecord) unclassified.push(`${name}: ${message ?? "no error"}`);
    }
    expect(unclassified).toEqual([]);
    expect(misclassified).toEqual([]);
    expect(lenientRecords).toEqual([]);
  });
});

describe("a missing, null or non-object sub-object fails with a domain error (2.0.0 pre-release review)", () => {
  const ev = (reference: string): { sourceOrigin: "photivra"; sourceReference: string; reuseStatus: "photivra-owned" }[] =>
    [{ sourceOrigin: "photivra", sourceReference: "test:" + reference, reuseStatus: "photivra-owned" }];
  const raster = { pixelWidth: 60, pixelHeight: 40 };
  const bounds = { left: -18, right: 18, top: -12, bottom: 12 };
  const meteringProfile = engine.parseExposureMeteringProfile({ schemaVersion: "0.1.0", profileId: "ttl-meter", scientificStatus: "approximation",
    inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", policy: { kind: "multi-zone-uniform" },
    target: { kind: "relative-signal-reference", targetRelativeSignal: 0.18, evidence: ev("target") }, evidence: ev("meter"), limitations: ["test"] });
  const captureGeometry = engine.resolveCaptureGeometry({ imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: raster, orientation: "landscape" }).value;
  const zones = (signals: readonly number[], id: string): Record<string, unknown> => ({ measurementId: id, sceneStateId: "scene",
    inputDomain: "relative-pre-exposure-linear-signal", captureRegion: "oriented-active-capture", captureGeometry,
    processingState: { exposureSettingsApplied: false, whiteBalanceApplied: false, toneMappingApplied: false, displayGammaApplied: false, sharpeningApplied: false },
    samples: signals.map((value, i) => ({ sampleId: "z" + i, positionOrientedCaptureUv: { u: 0.25 + 0.5 * (i % 2), v: 0.25 + 0.5 * Math.floor(i / 2) },
      relativeLinearSignal: value, areaWeight: 1 })) });
  const rollingReadout = { readoutMode: "rolling", captureReadoutDurationSeconds: { value: 0.01, unit: "s", evidence: ev("r") },
    scanDirectionNative: { value: "top-to-bottom", evidence: ev("d") }, spatialSamplingSkewSeconds: { value: 0.01, unit: "s", evidence: ev("s") } };
  const video = { sequenceId: "clip-1", opticalState: { bodyId: "generic-body", bodyVersion: "1", lensId: "generic-50", lensVersion: "1", focalLengthMm: 50,
    aperture: 4, focusDistanceM: 5, captureMode: "video", outputWidth: 1920, outputHeight: 1080, frameRateHz: 24, stabilizationMode: "off" },
    shutterAngleDegrees: 180, frameCount: 3, sequenceSeedUint32: 1, iso: 400, automation: { ae: "locked", af: "manual", awb: "locked" }, timingEvidence: ev("t"),
    rollingShutter: { readout: rollingReadout, linkageEvidence: ev("l") } };
  const ttl = { meteringProfile, ambientSampleSet: zones([0.02, 0.02, 0.04, 0.04], "a"), preFlashSampleSet: zones([0.12, 0.12, 0.06, 0.06], "p"),
    preFlashPowerFraction: 1 / 32, ambientScaleToMainExposure: 0.5, flashExposureCompensationStops: 0, minimumPowerFraction: 1 / 128,
    guideNumber: { fullPowerGuideNumberMetersIso100: 40, iso: 100, apertureFNumber: 4 } };
  const rotation = { focalLengthMm: 50, imagePointMm: { x: 1, y: 2 }, timeSecondsFromExposureStart: 0.01,
    angularVelocityRadPerSec: { pitch: 0.1, yaw: 0.1, roll: 0.1 }, samplingPitchMicrometers: { x: 4, y: 4 } };
  const cases: readonly [string, Record<string, unknown>][] = [
    ["estimateCameraShakeBlur", { focalLengthMm: 50, shutterSeconds: 1 / 30, angularVelocityRadPerSec: { yaw: 0.01, pitch: 0 }, stabilizationStopsEquivalent: 0 }],
    ["calculateProjectedMotionBlur", { focalLengthMm: 50, shutterSeconds: 1 / 100, positionM: { x: 0, y: 0, z: 10 }, velocityMps: { x: 1, y: 0, z: 0 } }],
    ["calculateCameraRotationImageMapping", rotation],
    ["calculateInverseCameraRotationImageMapping", rotation],
    ["transformNativeRasterPointToOriented", { point: { x: 1, y: 1 }, nativeRaster: raster, orientation: "portrait-clockwise" }],
    ["transformOrientedRasterPointToNative", { point: { x: 1, y: 1 }, nativeRaster: raster, orientation: "portrait-clockwise" }],
    ["transformNativeRasterVectorToOriented", { vector: { x: 1, y: 1 }, orientation: "portrait-clockwise" }],
    ["transformOrientedRasterVectorToNative", { vector: { x: 1, y: 1 }, orientation: "portrait-clockwise" }],
    ["transformNativeRasterRectToOriented", { rect: { x: 1, y: 1, width: 4, height: 2 }, nativeRaster: raster, orientation: "portrait-clockwise" }],
    ["transformOrientedRasterRectToNative", { rect: { x: 1, y: 1, width: 4, height: 2 }, nativeRaster: raster, orientation: "portrait-clockwise" }],
    ["mapOrientedPhysicalUvToImagePlanePoint", { uv: { u: 0.25, v: 0.5 }, orientedPhysicalBoundsFromOpticalAxisMm: bounds, orientation: "landscape" }],
    ["mapImagePlanePointToOrientedPhysicalUv", { imagePlanePointMm: { x: 1, y: 1 }, orientedPhysicalBoundsFromOpticalAxisMm: bounds, orientation: "landscape" }],
    ["resolveCaptureGeometry", { imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: raster, orientation: "landscape",
      activeCaptureRect: { x: 0, y: 0, width: 60, height: 40 }, outputCropRect: { x: 0, y: 0, width: 60, height: 40 }, outputRaster: { pixelWidth: 30, pixelHeight: 20 } }],
    ["calculateActiveCaptureFieldOfView", { imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: raster, orientation: "landscape",
      activeCaptureRect: { x: 0, y: 0, width: 60, height: 40 }, focalLengthMm: 50 }],
    ["calculateOutputFieldOfView", { imagingArea: { widthMm: 36, heightMm: 24 }, nativeRaster: raster, orientation: "landscape",
      activeCaptureRect: { x: 0, y: 0, width: 60, height: 40 }, outputCropRect: { x: 0, y: 0, width: 60, height: 40 }, focalLengthMm: 50 }],
    ["resolveVideoFrameSequence", video],
    ["resolveTtlFlashExposure", ttl],
    ["meterRelativeExposure", { profile: meteringProfile, sampleSet: zones([0.1, 0.2, 0.3, 0.4], "m") }]
  ];

  it.each(cases)("%s: the valid input succeeds and every sub-object variant fails with a domain error", async (name, input) => {
    const fn = engine[name as keyof typeof engine] as (value: unknown) => unknown;
    expect(() => fn(input), name).not.toThrow();
    const { probedPaths, escaped } = await probeSubObjects(fn, input);
    expect(probedPaths).toBeGreaterThan(0);
    expect(escaped).toEqual([]);
  });

  it("simulateCapture: a camera preset object with a missing, null or non-object part fails with a domain error", async () => {
    const camera = structuredClone(engine.resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" })[2]!);
    const run = (options: unknown): unknown => engine.simulateCapture(options as never);
    await expect(engine.simulateCapture({ camera, scene: { preset: "uniform" }, output: { width: 1, height: 1 } })).resolves.toBeDefined();
    await expect(engine.simulateCapture({ camera: { body: 1, lens: 1 } as never, scene: { preset: "uniform" } }))
      .rejects.toThrow(InvalidConfigurationError);
    const { probedPaths, escaped } = await probeSubObjects(run, { camera, scene: { preset: "uniform" }, output: { width: 1, height: 1 } },
      { include: (path) => /^camera\.(body|lens)(\.[^.]+)?$/u.test(path) });
    expect(probedPaths).toBeGreaterThan(15);
    expect(escaped).toEqual([]);
    await expect(engine.simulateCapture({ scene: { preset: "uniform" }, output: { width: 1, height: 1, whiteBalance: { channelGains: null } as never } }))
      .rejects.toThrow(new InvalidConfigurationError("output.whiteBalance.channelGains must be an object."));
  });
});

describe("nested objects reject unknown fields (2.0.0 pre-release review)", () => {
  const ev = [{ sourceOrigin: "photivra", sourceReference: "test:e", reuseStatus: "photivra-owned" }];
  it("estimateCameraShakeBlur angularVelocityRadPerSec, calculateProjectedMotionBlur positionM/velocityMps and the rotation mappings", () => {
    expect(() => engine.estimateCameraShakeBlur({ focalLengthMm: 50, shutterSeconds: 1 / 30, angularVelocityRadPerSec: { yaw: 0, pitch: 0, roll: 5 },
      stabilizationStopsEquivalent: 0 } as never)).toThrow(new InvalidConfigurationError("angularVelocityRadPerSec has unknown field \"roll\"."));
    expect(() => engine.calculateProjectedMotionBlur({ focalLengthMm: 50, shutterSeconds: 0.01, positionM: { x: 0, y: 0, z: 10, w: 1 },
      velocityMps: { x: 1, y: 0, z: 0 } } as never)).toThrow(new InvalidConfigurationError("positionM has unknown field \"w\"."));
    expect(() => engine.calculateProjectedMotionBlur({ focalLengthMm: 50, shutterSeconds: 0.01, positionM: { x: 0, y: 0, z: 10 },
      velocityMps: { x: 1, y: 0, z: 0, speed: 1 } } as never)).toThrow(new InvalidConfigurationError("velocityMps has unknown field \"speed\"."));
    expect(() => engine.calculateCameraRotationImageMapping({ focalLengthMm: 50, imagePointMm: { x: 0, y: 0 }, timeSecondsFromExposureStart: 0,
      angularVelocityRadPerSec: { pitch: 0, yaw: 0, roll: 0, tilt: 1 } } as never)).toThrow(new InvalidConfigurationError("angularVelocityRadPerSec has unknown field \"tilt\"."));
  });

  it("resolveVideoFrameSequence automation and rollingShutter, and the TTL guideNumber", () => {
    const optical = { bodyId: "generic-body", bodyVersion: "1", lensId: "generic-50", lensVersion: "1", focalLengthMm: 50, aperture: 4, focusDistanceM: 5,
      captureMode: "video", outputWidth: 1920, outputHeight: 1080, frameRateHz: 24, stabilizationMode: "off" };
    const base = { sequenceId: "clip-1", opticalState: optical, shutterAngleDegrees: 180, frameCount: 3, sequenceSeedUint32: 1, iso: 400,
      automation: { ae: "locked", af: "manual", awb: "locked" }, timingEvidence: ev };
    expect(() => engine.resolveVideoFrameSequence({ ...base, automation: { ...base.automation, awbb: "continuous" } } as never))
      .toThrow(new InvalidConfigurationError("resolveVideoFrameSequence automation has unknown field \"awbb\"."));
    expect(() => engine.resolveVideoFrameSequence({ ...base, rollingShutter: { readout: {}, linkageEvidence: ev, skewSeconds: 99 } } as never))
      .toThrow(new InvalidConfigurationError("resolveVideoFrameSequence rollingShutter has unknown field \"skewSeconds\"."));
    expect(() => engine.resolveVideoFrameSequence({ ...base, rollingShutter: null } as never))
      .toThrow(new InvalidConfigurationError("resolveVideoFrameSequence rollingShutter must be an object."));
    expect(() => engine.resolveTtlFlashExposure({ guideNumber: { fullPowerGuideNumberMetersIso100: 40, iso: 100, apertureFNumber: 4, isoo: 400 },
      ambientSampleSet: {}, preFlashSampleSet: {} } as never))
      .toThrow(new InvalidConfigurationError("resolveTtlFlashExposure guideNumber has unknown field \"isoo\"."));
  });

  it("simulateCapture rejects unknown fields in a camera preset object and jpegQuantizationStep outside JPEG", async () => {
    const preset = engine.resolveGenericEquipmentTierCatalog({ presetVersion: "2.0.0" })[2]!;
    const withTop = { ...structuredClone(preset), bogusField: 1 };
    await expect(engine.simulateCapture({ camera: withTop as never, scene: { preset: "uniform" } }))
      .rejects.toThrow(new InvalidConfigurationError("camera has unknown field \"bogusField\"."));
    const withBody = structuredClone(preset) as unknown as { body: Record<string, unknown>; lens: Record<string, unknown> & { matchedReference: Record<string, unknown> } };
    withBody.body.bogus = 2;
    await expect(engine.simulateCapture({ camera: withBody as never, scene: { preset: "uniform" } }))
      .rejects.toThrow(new InvalidConfigurationError("camera.body has unknown field \"bogus\"."));
    const withLens = structuredClone(preset) as unknown as typeof withBody;
    withLens.lens.matchedReference.transmissionPercent = 90;
    await expect(engine.simulateCapture({ camera: withLens as never, scene: { preset: "uniform" } }))
      .rejects.toThrow(new InvalidConfigurationError("camera.lens.matchedReference has unknown field \"transmissionPercent\"."));
    const withProfileField = structuredClone(preset) as unknown as { body: { whiteBalance: Record<string, unknown> } };
    withProfileField.body.whiteBalance.bogus = 3;
    await expect(engine.simulateCapture({ camera: withProfileField as never, scene: { preset: "uniform" } })).rejects.toThrow(InvalidConfigurationError);
    await expect(engine.simulateCapture({ scene: { preset: "uniform" }, output: { width: 2, height: 2, format: "png", jpegQuantizationStep: 9999 } }))
      .rejects.toThrow(new InvalidConfigurationError("output.jpegQuantizationStep applies only to output.format \"jpeg\"."));
    await expect(engine.simulateCapture({ scene: { preset: "uniform" }, output: { width: 2, height: 2, jpegQuantizationStep: 2 } }))
      .rejects.toThrow(InvalidConfigurationError);
  });
});
