// SPDX-License-Identifier: Apache-2.0

/**
 * The package entry point: one browser-safe ES module that exports every public API.
 *
 * Import only from here. Deep imports into other files, the transport server and renderer
 * backends are not supported package APIs.
 * @see docs/DEVELOPERS.md for equations, coordinate/unit conventions, blockers and support limits.
 */

export { GENERIC_EQUIPMENT_TIER_PRESET_VERSION, GENERIC_EQUIPMENT_TIER_PRESET_VERSIONS, GENERIC_EQUIPMENT_TIERS, resolveGenericEquipmentTierCatalog,
  createGenericEquipmentTierSelection, parseGenericEquipmentTierSelection, resolveGenericEquipmentTierLensProfiles,
  type GenericEquipmentTierProfileReference, type GenericEquipmentTierSelection, type ResolvedGenericTierLensProfiles } from "./equipment/generic-tier-presets.js";
export type { GenericEquipmentTier, GenericEquipmentTierPreset, GenericVersionedAsset, GenericTierBodyAssets, GenericTierLensAssets } from "./equipment/generic-tier-assets.js";
export { SENSOR_RAW_PRODUCER_SCHEMA_VERSION, SENSOR_RAW_PRODUCER_NOISE_MODEL, parseSensorRawProducerInput, simulateSensorRawFrame,
  type SensorRawProducerExposureWindowInput, type SensorRawProducerSiteInput, type SensorRawProducerInput, type SensorRawProducerResult } from "./capture/sensor-raw-producer.js";
export { CAPTURE_CORRECTED_SDR_SCHEMA_VERSION, parseCaptureCorrectedSdrInput, calculateCaptureCorrectedSdr,
  type CaptureCorrectedSdrInput, type CaptureCorrectedSdrResult } from "./output/capture-corrected-sdr.js";
export { PHOTOGRAPHIC_EXPORT_SCHEMA_VERSION, PHOTOGRAPHIC_EXPORT_PIPELINE_VERSION, PROCESSED_SENSOR_RAW_MODEL_VERSION, parseExportSensorColorProfile,
  parsePhotographicExportInput, createPhotographicExportPair, type ExportSensorColorProfile, type PhotographicExportInput,
  type PhotographicExportOptions, type PhotographicExportPair } from "./capture/photographic-export.js";
export { calculateEffectiveSaturationCode, type EffectiveSaturationReadout } from "./capture/raw-white-level.js";
export { RAW_HIGHLIGHT_RECONSTRUCTION_START, SENSOR_COLOR_DEVELOPMENT_MODEL, type RawHighlightMode } from "./color/sensor-color-development.js";
export { CAPTURE_EXPORT_METADATA_SCHEMA_VERSION, parseCaptureExportMetadataInput, createCaptureExportMetadataPair,
  type CaptureExportWorkflow, type CaptureExportArtifactIdentity, type CaptureExportMetadataInput,
  type CaptureExportSharedMetadata, type CaptureExportMetadataPair } from "./capture/capture-export-metadata.js";
export { CAPTURE_SDR_SCHEMA_VERSION, parseCaptureSdrInput, calculateCaptureSdr, type CaptureSdrInput, type CaptureSdrResult } from "./output/capture-sdr.js";
export { RAW_FRAME_RECONSTRUCTION_SCHEMA_VERSION, parseRawFrameReconstructionInput, resolveRawFrameReconstruction,
  type RawFrameReconstructionPhaseProfile, type RawFrameReconstructionInput, type RawFrameReconstruction } from "./capture/raw-frame-reconstruction.js";
export { SENSOR_RAW_FRAME_SCHEMA_VERSION, createSensorRawFrame, parseSensorRawFrameInput,
  type SensorRawFrameInput, type SensorRawFrame } from "./capture/sensor-raw-frame.js";

export {
  parseOpticalProfileState,
  type OpticalProfileState,
  type GenericOpticalEvidence
} from "./optics/profile-contract.js";
export {
  parseLensStrayLightProfile,
  calculateLensStrayLightIrradiance,
  type LensStrayLightProfile,
  type ParametricStrayLightResponse,
  type StrayLightSource,
  type StrayLightIrradiance
} from "./optics/stray-light.js";
export {
  parseDigitalGeometricTransform,
  prepareGeometricMapping,
  calculateComposedGeometricMapping,
  calculateForwardGeometricMapping,
  calculateGeometricSamplingPlan,
  calculateGeometricResampling,
  type DigitalGeometricTransform,
  type AffineGeometricTransform,
  type RadialGeometricTransform,
  type BrownConradyGeometricTransform,
  type ProjectionRemapGeometricTransform,
  type GeometricProjectionDeclaration,
  type GeometricJacobian,
  type GeometricImageDomain,
  type PreparedGeometricMapping,
  type GeometricRaster,
  type GeometricResampler,
  type GeometricMappingPoint,
  type GeometricSamplingPlan
} from "./output/geometric-transforms.js";
export {
  parseGenericLensCorrectionProfile,
  resolveLensCorrectionPlan,
  calculatePeripheralIlluminationCorrection,
  calculateLensCorrectedCapture,
  type GenericLensCorrectionProfile,
  type LensCorrectionComponent,
  type LensCorrectionChannel,
  type GeometricLensCorrection,
  type LateralCaLensCorrection,
  type IlluminationLensCorrection,
  type ResolvedLensCorrectionPlan,
  type LensCorrectionCapture
} from "./output/lens-corrections.js";

export {
  SIMULATED_CAPTURE_SCHEMA_VERSION,
  createSimulatedCapture,
  parseSimulatedCapture,
  serializeSimulatedCapture,
  resolveSimulatedCapturePlane,
  createCaptureWhiteBalanceIntent,
  type SimulatedCapture,
  type SimulatedCaptureInput,
  type CaptureExposureSource,
  type CaptureLinearImageState,
  type CaptureLinearPlane,
  type CaptureFloatStorage,
  type CapturePublicProfileReference,
  type CaptureWhiteXyz,
  type CaptureWhiteBalanceIntent
} from "./capture/simulated-capture.js";

export {
  CAPTURE_COLOR_MODEL_VERSION,
  VIRTUAL_COLOR_CAMERA_PROFILE,
  LINEAR_CAPTURE_RGB_PROFILE,
  resolveCaptureColorModel,
  parseCaptureColorTransformInput,
  calculateCaptureColorTransform,
  type CaptureChromaticAdaptationTransform,
  type CaptureColorModel,
  type CaptureColorWhiteBalance,
  type CaptureColorTransformInput,
  type CaptureColorTransformResult
} from "./color/capture-color.js";

export { ENGINE_API_VERSION } from "./core/version.js";
export { FULL_RESOLUTION_DEFAULT_PIXELS, FULL_RESOLUTION_CEILING_PIXELS } from "./core/pixel-limits.js";

export {
  LINEAR_CAPTURE_ENCODING_SCHEMA_VERSION,
  LINEAR_CAPTURE_ENCODING_MODEL_VERSION,
  parseLinearCaptureEncoding,
  calculateLinearCaptureEncoding,
  type LinearCaptureEncoding,
  type LinearCaptureEncodingInput,
  type EncodedLinearCapture
} from "./capture/linear-encoding.js";

export {
  SDR_RENDERING_SCHEMA_VERSION,
  SDR_RENDERING_MODEL_VERSION,
  parseSdrRenderingProfile,
  parseSdrRenderingInput,
  calculateSdrRendering,
  type SdrRenderingProfile,
  type SdrToneCurve,
  type SdrToneCurveParameters,
  type SdrRenderingInput,
  type SdrRenderingResult
} from "./output/sdr-rendering.js";

export {
  approximationResult,
  calibratedResult,
  calculatedResult,
  estimatedResult,
  validateCalculationQuality,
  type AbsoluteUncertaintyEstimate,
  type CalculationProvenance,
  type CalculationQuality,
  type CalculationResult,
  type CalculationValidRange,
  type ProvenanceKind,
  type RelativeUncertaintyEstimate,
  type UncertaintyConfidence,
  type UncertaintyEstimate,
  type UncertaintySource
} from "./core/calculation-result.js";
export {
  InvalidScientificInputError,
  InvalidScientificResultError
} from "./core/validation.js";

export {
  parseSpectralWavelengthBasis,
  parseSpectralWavelengthRangeNanometers,
  parseSpectralWavelengthSample,
  type SpectralWavelengthBasis,
  type SpectralWavelengthRangeNanometers,
  type SpectralWavelengthSample
} from "./core/spectral.js";

export {
  composeSpectralCoverage,
  distributeIntegratedQuantityAcrossDiscreteSpectralLines,
  integrateDiscreteSpectralLineMeasure,
  parseNormalizedDiscreteSpectralLineDistribution,
  parseSpectralCoverageParticipant,
  type ComposeSpectralCoverageInput,
  type DiscreteSpectralLineMeasure,
  type DiscreteSpectralLineMeasureEntry,
  type DiscreteSpectralLineQuantityUnit,
  type DistributeIntegratedQuantityAcrossDiscreteLinesInput,
  type IntegratedDiscreteSpectralLineMeasure,
  type NormalizedDiscreteSpectralLine,
  type NormalizedDiscreteSpectralLineDistribution,
  type ResolvedSpectralWavelengthBasis,
  type SpectralCoverageComposition,
  type SpectralCoverageParticipant,
  type SpectralCoverageParticipantRole
} from "./core/spectral-composition.js";

export {
  SCIENTIFIC_ASSURANCE_CONTRACT_VERSION,
  composeScientificAssurance,
  type ComposeScientificAssuranceInput,
  type ComposedScientificAssurance,
  type ComposedScientificUncertaintyStatus,
  type ScientificAssuranceBasisKind,
  type ScientificAssuranceComponent,
  type ScientificAssuranceComponentUncertainty,
  type ScientificAssuranceSourceIdentity,
  type ScientificAssuranceSourceKind,
  type ScientificAssuranceStatus
} from "./core/scientific-assurance.js";

export {
  IMAGE_FORMATION_CONTRACT_VERSION,
  getImageFormationContract,
  type ImageFormationContract,
  type ImageFormationCoordinateSpaceContract,
  type ImageFormationCoordinateSpaceId,
  type ImageFormationDomainId,
  type ImageFormationEffectId,
  type ImageFormationEffectPlacement,
  type ImageFormationImplementationStatus,
  type ImageFormationRendererContract,
  type ImageFormationStageContract,
  type ImageFormationStageId,
  type ImageFormationTemporalContract
} from "./core/image-formation.js";

export {
  IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION,
  PREPARED_IMAGE_FORMATION_CONTEXT_VERSION,
  PRODUCTION_CAPTURE_SNAPSHOT_VERSION,
  PRODUCTION_IMAGE_FORMATION_PLAN_VERSION,
  RENDERER_CAPABILITY_SCHEMA_VERSION,
  createProductionCaptureSnapshot,
  createProductionCaptureSnapshotFromReleaseFrame,
  createProductionImageFormationPlan,
  parseImageFormationFidelityProfile,
  parsePreparedImageFormationContext,
  parseProductionCaptureSnapshot,
  parseRendererCapabilityDeclaration,
  prepareImageFormationContext,
  serializeProductionImageFormationPlan,
  type CreateProductionCaptureSnapshotFromReleaseFrameInput,
  type CreateProductionCaptureSnapshotInput,
  type CreateProductionImageFormationPlanInput,
  type ProductionProcessedOutputInput,
  type ProductionEnvironmentCaptureInput,
  type ImageFormationFidelityProfile,
  type PlannedImageFormationEffect,
  type PlannedImageFormationEffectState,
  type PlannedImageFormationStage,
  type PlannedImageFormationStageState,
  type PlannedScientificStatus,
  type PrepareImageFormationContextInput,
  type PreparedImageFormationContext,
  type ProductionCaptureSnapshot,
  type ProductionImageFormationBlocker,
  type ProductionImageFormationBlockerCode,
  type ProductionImageFormationPlan,
  type ProductionPhysicalSceneSample,
  type ProductionReleaseFrameBinding,
  type ProductionTemporalCaptureInput,
  type ProductionTemporalCaptureResult,
  type RendererCapabilityDeclaration,
  type RendererConsumerKind,
  type RequiredImageFormationEffect
} from "./composition/image-formation-plan.js";

export {
  PRODUCTION_PLAN_CONSUMER_MANIFEST_VERSION,
  createProductionPlanConsumerManifest,
  type CreateProductionPlanConsumerManifestInput,
  type ProductionPlanConsumerManifest
} from "./composition/plan-consumer.js";

export {
  calculateFieldOfView,
  calculateFieldOfViewBounds,
  type CalculateFieldOfViewBoundsInput,
  type CalculateFieldOfViewInput,
  type FieldOfView,
  type FieldOfViewBounds
} from "./camera/field-of-view.js";

export {
  LENS_PROJECTION_MODELS,
  calculateLensProjectionDirection,
  calculateLensProjectionFieldOfView,
  calculateLensProjectionFieldOfViewBounds,
  calculateLensProjectionImagePoint,
  parseLensProjectionModel,
  type CalculateLensProjectionDirectionInput,
  type CalculateLensProjectionFieldOfViewBoundsInput,
  type CalculateLensProjectionFieldOfViewInput,
  type CalculateLensProjectionImagePointInput,
  type LensDirection,
  type LensProjectionDirection,
  type LensProjectionFieldOfView,
  type LensProjectionFieldOfViewBounds,
  type LensProjectionImagePoint,
  type LensProjectionModel,
  type RadialLensProjectionModel
} from "./camera/lens-projection.js";

export {
  calculateProjectedObjectSize,
  type CalculateProjectedObjectSizeInput,
  type ProjectedObjectSize
} from "./camera/projected-object-size.js";

export {
  calculateEquivalentFocalLength35Mm,
  type CalculateEquivalentFocalLength35MmInput,
  type EquivalentFocalLength35Mm
} from "./camera/equivalent-focal-length.js";

export {
  calculateBlurShareOfFrame,
  calculateSensorEquivalence,
  type BlurShareOfFrame,
  type BlurShareOfPrint,
  type CalculateBlurShareOfFrameInput,
  type CalculateSensorEquivalenceInput,
  type EquivalenceExactness,
  type EquivalenceValueBasis,
  type SensorEquivalence,
  type SensorEquivalenceFieldOfView,
  type SensorEquivalenceQuantity
} from "./camera/sensor-equivalence.js";

export {
  COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION,
  WHITE_BALANCE_PROFILE_SCHEMA_VERSION,
  WHITE_BALANCE_STATE_VERSION,
  createColorTemperatureWhiteBalanceIntent,
  createLockedWhiteBalanceState,
  estimateAutoWhiteBalance,
  parseResolvedWhiteBalanceState,
  parseWhiteBalanceProfile,
  resolveCustomWhiteBalance,
  resolveManualWhiteBalance,
  resolvePresetWhiteBalance,
  type ColorTemperatureWhiteBalanceIntent,
  type CreateColorTemperatureWhiteBalanceIntentInput,
  type CreateLockedWhiteBalanceStateInput,
  type EstimateAutoWhiteBalanceInput,
  type PreWhiteBalanceRgbSample,
  type PreWhiteBalanceRgbSampleSet,
  type ResolveCustomWhiteBalanceInput,
  type ResolveManualWhiteBalanceInput,
  type ResolvePresetWhiteBalanceInput,
  type ResolvedWhiteBalanceState,
  type WhiteBalanceAwbIntent,
  type WhiteBalanceAwbPolicy,
  type WhiteBalanceChannelGains,
  type WhiteBalanceInputDomain,
  type WhiteBalancePresetDefinition,
  type WhiteBalanceProfile,
  resolveColorTemperatureWhiteBalance,
  type ColorTemperatureWhiteBalanceCameraModel,
  type ResolveColorTemperatureWhiteBalanceInput,
  type ResolvedColorTemperatureWhiteBalance
} from "./color/white-balance.js";

export type {
  Cie1960UvChromaticity,
  CieXyChromaticity,
  CieXyzTristimulus,
  ColorMatrix3x3,
  ColorVector3
} from "./color/colorimetry-math.js";

export {
  COLORIMETRY_MODEL_VERSION,
  MAX_COLORIMETRIC_QUADRATURE_NODES,
  MAX_COLORIMETRIC_TABLE_SAMPLES,
  ANALYTIC_CIE_1931_CMF_DOMAIN_NANOMETERS,
  createColorimetricMidpointQuadrature,
  estimateCie1931ColorMatchingFunctions,
  integrateSpectrumToXyz,
  parseColorimetricQuadratureNodes,
  prepareColorMatchingFunctions,
  prepareColorimetricSpectrum,
  type ColorMatchingFunctionsSource,
  type ColorimetricObserver,
  type ColorimetricQuadratureNode,
  type ColorimetricSpectralSample,
  type ColorimetricSpectrum,
  type CreateColorimetricMidpointQuadratureInput,
  type IntegrateSpectrumToXyzInput,
  type IntegratedSpectrumXyz,
  type PreparedColorMatchingFunctions,
  type PreparedColorimetricSpectrum,
  type TabulatedColorMatchingSample,
  type TristimulusNormalization
} from "./color/color-matching-functions.js";

export {
  BOLTZMANN_CONSTANT_JOULES_PER_KELVIN,
  CIE_DAYLIGHT_LOCUS_RANGE_KELVIN,
  CIE_ILLUMINANT_A_RANGE_NANOMETERS,
  PLANCKIAN_LOCUS_RANGE_KELVIN,
  MAX_CORRELATED_COLOR_TEMPERATURE_DUV,
  PLANCK_CONSTANT_JOULE_SECONDS,
  SECOND_RADIATION_CONSTANT_METER_KELVIN,
  SPEED_OF_LIGHT_METERS_PER_SECOND,
  calculateChromaticityFromCorrelatedColorTemperature,
  calculateCieDaylightComponentWeights,
  calculateCieIlluminantARelativeSpectralPower,
  calculateCorrelatedColorTemperature,
  calculatePlanckianChromaticity,
  calculatePlanckianSpectralRadiance,
  createCieDaylightSpectrum,
  createCieIlluminantASpectrum,
  createPlanckianSpectrum,
  estimateCorrelatedColorTemperatureMcCamy,
  estimatePlanckianLocusChromaticity,
  type CieDaylightBasis,
  type CieDaylightComponentWeights,
  type CorrelatedColorTemperatureResult,
  type PlanckianLocusModel,
  type WhiteLocus
} from "./color/illuminants.js";

export {
  CHROMATIC_ADAPTATION_TRANSFORMS,
  calculateChromaticAdaptationMatrix,
  calculateChromaticallyAdaptedXyz,
  resolveChromaticAdaptationConeMatrix,
  type CalculateChromaticAdaptationMatrixInput,
  type ChromaticAdaptationMatrix,
  type ChromaticAdaptationTransform
} from "./color/chromatic-adaptation.js";

export {
  calculateCielabFromCielch,
  calculateCielabFromXyz,
  calculateCielchFromCielab,
  calculateColorDifference,
  calculateXyzFromCielab,
  type CalculateColorDifferenceInput,
  type Cie94ParametricFactors,
  type Ciede2000ParametricFactors,
  type CielabColor,
  type CielchColor,
  type ColorDifferenceFormula
} from "./color/color-difference.js";

export {
  MAX_CAMERA_MATRIX_TRAINING_PATCHES,
  estimateCameraColorMatrix,
  type CameraColorMatrixFit,
  type CameraMatrixFitConstraint,
  type CameraMatrixPatchReport,
  type CameraMatrixTrainingPatch,
  type CameraSpectralSensitivities,
  type EstimateCameraColorMatrixInput
} from "./color/camera-color-matrix.js";

export {
  calculateRgbToXyzMatrices,
  evaluateBt709InverseOetf,
  evaluateSrgbDecoding,
  evaluateBt709Oetf,
  evaluateSrgbEncoding,
  prepareBt1886Eotf,
  resolveRgbColorSpace,
  type Bt1886Eotf,
  type RgbColorSpaceDefinition,
  type RgbColorSpaceId,
  type RgbPrimaryChromaticities,
  type RgbToXyzMatrices,
  type RgbTransferFunctionId
} from "./color/rgb-color-spaces.js";

export {
  calculateGamutMappedColor,
  prepareRgbGamutMapping,
  type GamutMappedColor,
  type GamutMappingMethod,
  type PrepareRgbGamutMappingInput,
  type PreparedRgbGamutMapping
} from "./color/gamut-mapping.js";

export {
  calculatePixelPitch,
  type CalculatePixelPitchInput,
  type PixelPitch
} from "./sensor/pixel-pitch.js";

export {
  calculateImagingAreaMetrics,
  calculateSensorGeometryMetrics,
  type CalculateSensorGeometryMetricsInput,
  type ImagingAreaMetrics,
  type NativeImageRaster,
  type RasterDimensions,
  type SensorGeometryMetrics,
  type SensorImagingArea
} from "./sensor/sensor-geometry.js";

export {
  SENSOR_ARCHITECTURE_PROFILE_SCHEMA_VERSION,
  parseSensorArchitectureProfile,
  type SensorArchitectureFactProvenance,
  type SensorArchitectureProfile,
  type SensorArchitectureProfileV0_2,
  type SensorArchitectureProfileV0_3,
  type SensorArchitectureReuseStatus,
  type SensorArchitectureSourceKind,
  type SensorColorSamplingFamily,
  type SensorIlluminationArchitecture,
  type SensorIntegrationArchitecture,
  type SensorReadoutArchitecture,
  type SensorTechnologyFamily,
  type SourcedSensorArchitectureFact
} from "./sensor/architecture.js";

export {
  parseSensorColorSamplingProfile,
  resolveColorSamplingSite,
  type LayeredColorSamplingLayout,
  type MonochromeColorSamplingLayout,
  type NativeColorSamplingSiteCoordinateSystem,
  type NativeColorSamplingSiteIndex,
  type SensorColorSamplingProfileCoordinateSystem,
  type PeriodicMosaicColorSamplingLayout,
  type ResolveColorSamplingSiteInput,
  type ResolvedColorSamplingSite,
  type SensorColorSamplingLayout,
  type SensorColorSamplingProfile
} from "./sensor/color-sampling.js";

export {
  parseNativeEffectiveRasterColorSamplingBindingProfile,
  resolveCaptureModeColorSamplingContributors,
  resolveNativeEffectiveRasterColorSamplingBinding,
  type CaptureModeFullFrameSampleIndex,
  type ColorSamplingChannelComposition,
  type ColorSamplingChannelSiteCount,
  type ColorSamplingSiteGridDimensions,
  type ColorSamplingSiteRect,
  type GroupedCaptureModeSamplingAnchorDeclaration,
  type NativeEffectiveRasterColorSamplingBindingProfile,
  type NativeEffectiveSampleRect,
  type ResolveCaptureModeColorSamplingContributorsInput,
  type ResolvedCaptureModeColorSamplingContributors,
  type ResolvedNativeEffectiveRasterColorSamplingBinding
} from "./sensor/capture-color-sampling-binding.js";

export {
  parseSensorOpticalStackProfile,
  resolveAntiAliasingSpatialKernel,
  type AntiAliasingPointSplitComponent,
  type ResolvedAntiAliasingSpatialKernel,
  type SensorEffectiveAntiAliasingSpatialResponse,
  type SensorMicrolensDeclaration,
  type SensorOpticalStackComponent,
  type SensorOpticalStackComponentRole,
  type SensorOpticalStackProfile
} from "./sensor/optical-stack.js";

export {
  parseSensorSamplingApertureProfile,
  resolveSensorSamplingAperture,
  type NativeSensorPhysicalBoundsMm,
  type NativeSensorPhysicalPointMm,
  type ResolveSensorSamplingApertureInput,
  type ResolvedSensorSamplingAperture,
  type SensorGeometricSensitiveAperture,
  type SensorSamplingApertureProfile,
  type SensorSiteCenterLatticeRegistration
} from "./sensor/sampling-aperture.js";

export {
  calculateSensorSpatialSamplingQuadrature,
  type CalculateSensorSpatialSamplingQuadratureInput,
  type SensorSpatialSamplingQuadrature,
  type SensorSpatialSamplingQuadratureNode
} from "./sensor/spatial-sampling-quadrature.js";

export {
  reduceSensorSpatialSamplingQuadrature,
  type ReduceSensorSpatialSamplingQuadratureInput,
  type SensorSpatialQuadratureNodeIdentity,
  type SensorSpatialQuadratureNodeValue,
  type SensorSpatialSampleReduction,
  type SensorSpatialSampleReductionValue,
  type SensorSpatialSampleValueDomain
} from "./sensor/spatial-sample-reduction.js";

export {
  parseSensorSpectralResponseProfile,
  SENSOR_SPECTRAL_RESPONSE_CHANNEL_BINDING_FORMAT,
  resolveSensorSpectralResponseAtWavelength,
  type EffectiveSensorResponseScope,
  type ResolveSensorSpectralResponseAtWavelengthInput,
  type ResolvedSensorSpectralResponse,
  type ResolvedSensorSpectralResponseValue,
  type SensorSpectralChannelResponse,
  type SensorSpectralResponseChannelBinding,
  type SensorSpectralReferenceConditions,
  type SensorSpectralResponseProfile,
  type SensorSpectralResponseScientificStatus,
  type SensorSpectralResponseUncertainty,
  type SpectralFractionCurve,
  type SpectralFractionSample,
  type SpectralResponsivityCurve,
  type SpectralResponsivitySample
} from "./sensor/spectral-response.js";

export {
  calculateSensorSpectralQuadrature,
  type CalculateSensorSpectralQuadratureInput,
  type SensorSpectralQuadrature,
  type SensorSpectralQuadratureNode,
  type SensorSpectralWavelengthRangeNanometers
} from "./sensor/spectral-quadrature.js";

export {
  createSensorSpectralCoverageParticipant,
  type CreateSensorSpectralCoverageParticipantInput
} from "./sensor/spectral-coverage.js";

export {
  reduceSensorSpatioSpectralIrradiance,
  type ReduceSensorSpatioSpectralIrradianceInput,
  type SensorSpatioSpectralIrradianceReduction,
  type SensorSpatioSpectralIrradianceSample,
  type SensorSpatioSpectralNodeIdentity,
  type SensorSpatioSpectralWavelengthReduction
} from "./sensor/spatio-spectral-reduction.js";

export {
  assessSensorResponseApplicationCompatibility,
  parseSensorResponseApplicationProfile,
  type AssessSensorResponseApplicationCompatibilityInput,
  type SensorResponseApplicationCompatibilityAssessment,
  type SensorResponseApplicationCompatibilityBlocker,
  type SensorResponseApplicationProfile,
  type SensorResponseIncidentAreaBasis,
  type SensorResponseReferenceConditionPolicy,
  type SensorResponseSignalPath,
  type SensorResponseSourcePlane,
  type SensorResponseSpatialModel,
  type SourcedSensorResponseSourcePlane
} from "./sensor/response-application-compatibility.js";

export {
  assessSensorResponseOperatingRange,
  parseSensorResponseOperatingRangeProfile,
  type AssessSensorResponseOperatingRangeInput,
  type SensorResponseLinearityCriterion,
  type SensorResponseOperatingInputRange,
  type SensorResponseOperatingRangeAssessment,
  type SensorResponseOperatingRangeBlocker,
  type SensorResponseOperatingRangeProfile,
  type SensorResponseOperatingSpatialLinearityModel,
  type SensorResponseOperatingSpectralInputModel,
  type SensorResponseOperatingWavelengthApplicability
} from "./sensor/response-operating-range.js";

export {
  calculatePhotonEnergyFromWavelength,
  parseSourcedAirPhaseRefractiveIndex,
  type AirRefractiveIndexConditionPolicy,
  type AirRefractiveIndexReferenceConditions,
  type CalculatePhotonEnergyFromWavelengthInput,
  type PhotonEnergyFromWavelength,
  type SourcedAirPhaseRefractiveIndex
} from "./sensor/photon-energy.js";

export {
  calculateSensorEqeElectronRate,
  type CalculateSensorEqeElectronRateInput,
  type SensorEqeAirPhotonEnergyContext,
  type SensorEqeAirRefractiveIndexSample,
  type SensorEqeElectronRate,
  type SensorEqeWavelengthRateContribution
} from "./sensor/eqe-electron-rate.js";

export {
  calculateSensorResponsivityPhotocurrent,
  parseSensorResponsivityElectricalApplicabilityProfile,
  type CalculateSensorResponsivityPhotocurrentInput,
  type SensorResponsivityBiasCondition,
  type SensorResponsivityElectricalApplicabilityProfile,
  type SensorResponsivityElectricalConditionPolicy,
  type SensorResponsivityElectricalConditions,
  type SensorResponsivityPhotocurrent,
  type SensorResponsivityReadoutLoadCondition,
  type SensorResponsivityWavelengthCurrentContribution
} from "./sensor/responsivity-photocurrent.js";

export {
  bindSensorRateToLocalExposure,
  type BindSensorRateToLocalExposureInput,
  type SensorInstantaneousRateResult,
  type SensorRateLocalExposureBinding
} from "./sensor/local-exposure-binding.js";

export {
  integrateStationarySensorRateOverLocalExposure,
  parseSensorRateTemporalStationarityProfile,
  type IntegrateStationarySensorRateInput,
  type SensorEqeExposureIntegration,
  type SensorRateStationarityStatus,
  type SensorRateTemporalStationarityProfile,
  type SensorResponsivityExposureIntegration,
  type SensorStationaryRateExposureIntegration
} from "./sensor/constant-rate-temporal-integration.js";

export {
  calculateSensorDarkCurrentCharge,
  parseSensorDarkCurrentProfile,
  type CalculateSensorDarkCurrentChargeInput,
  type SensorDarkCurrentCharge,
  type SensorDarkCurrentProfile,
  type SensorDarkCurrentSiteApplicability,
  type SensorDarkCurrentTemperatureModel
} from "./sensor/dark-current.js";

export {
  composeSensorAccumulatedCharge,
  parseSensorAccumulatedChargeCompletenessProfile,
  parseSensorAdditionalStoredChargeComponent,
  type ComposeSensorAccumulatedChargeInput,
  type ComposeSensorPhotoAccumulatedChargeInput,
  type SensorAccumulatedChargeCompletenessProfile,
  type SensorAccumulatedChargeComposition,
  type SensorPhotoAccumulatedChargeComposition,
  type SensorAdditionalStoredChargeComponent,
  type SensorAdditionalStoredChargeKind
} from "./sensor/accumulated-charge.js";

export {
  assessSensorPhysicalChargeCapacity,
  parseSensorPhysicalChargeCapacityProfile,
  type AssessSensorPhysicalChargeCapacityInput,
  type SensorPhysicalChargeCapacityAssessment,
  type SensorPhysicalChargeCapacityProfile,
  type SensorPhysicalChargeCapacitySiteApplicability,
  type SensorPhysicalChargeCapacityTemperatureApplicability
} from "./sensor/physical-charge-capacity.js";

export {
  GENERIC_ISO_SIGNAL_CHAIN_PRESET_CATALOG_SCHEMA_VERSION,
  GENERIC_ISO_SIGNAL_CHAIN_PROFILE_SCHEMA_VERSION,
  parseGenericIsoSignalChainPresetCatalog,
  parseGenericIsoSignalChainProfile,
  resolveGenericIsoSignalChain,
  resolveGenericIsoSignalChainPreset,
  type GenericIsoCaptureModeSignalChainBinding,
  type GenericIsoExpandedRegimeBinding,
  type GenericIsoSignalChainPreset,
  type GenericIsoSignalChainPresetCatalog,
  type GenericIsoSignalChainProfile,
  type GenericIsoStandardRegimeBand,
  type ResolveGenericIsoSignalChainInput,
  type ResolvedGenericIsoSignalChain
} from "./sensor/iso-signal-chain.js";

export {
  SENSOR_CHARGE_SAMPLING_PROFILE_SCHEMA_VERSION,
  SENSOR_READOUT_CONVERSION_PROFILE_SCHEMA_VERSION,
  calculateExpectedSensorReadout,
  parseSensorChargeSamplingProfile,
  parseSensorReadoutConversionProfile,
  resolveSensorReadoutRegime,
  simulateSensorChargeRealization,
  simulateSensorRawCode,
  type CalculateExpectedSensorReadoutInput,
  type ResolveSensorReadoutRegimeInput,
  type ResolvedSensorReadoutRegime,
  type SensorAdditionalChargeSamplingModel,
  type SensorAdditionalChargeSamplingPolicy,
  type SensorChargeRealization,
  type SensorChargeSamplingProfile,
  type SensorElectronicReadNoiseComponent,
  type SensorExpectedReadoutSignal,
  type SensorRawCodeSample,
  type SensorReadoutConversionProfile,
  type SensorReadoutConversionRegime,
  type SensorAdcIntegralNonLinearity,
  type SensorReadoutExposureIndexGain,
  type SimulateSensorChargeRealizationInput,
  type SimulateSensorRawCodeInput
} from "./sensor/raw-readout.js";

export {
  createIsoGainReadoutRegimes,
  type CreateIsoGainReadoutRegimesInput,
  type IsoGainConversionGainMode,
  type IsoGainReadoutRegimes
} from "./sensor/iso-gain.js";

export {
  SENSOR_FIXED_PATTERN_NOISE_MODEL,
  SENSOR_FIXED_PATTERN_NOISE_PROFILE_SCHEMA_VERSION,
  calculateSensorFixedPatternSite,
  parseSensorFixedPatternNoiseProfile,
  type SensorFixedPatternNoiseProfile,
  type SensorFixedPatternSiteValues
} from "./sensor/fixed-pattern-noise.js";

export {
  SENSOR_RAW_CAPTURE_SAMPLE_VERSION,
  SENSOR_RAW_RECONSTRUCTION_PROFILE_SCHEMA_VERSION,
  createSensorRawCaptureSample,
  parseSensorRawReconstructionProfile,
  resolveSensorRawReconstruction,
  type CreateSensorRawCaptureSampleInput,
  type ResolveSensorRawReconstructionInput,
  type SensorRawCaptureSample,
  type SensorRawReconstructedPixel,
  type SensorRawReconstructionChannelKernel,
  type SensorRawReconstructionKernelContribution,
  type SensorRawReconstructionProfile
} from "./sensor/raw-reconstruction.js";

export {
  assessSensorCameraSaturationCapacity,
  parseSensorCameraSaturationCapacityProfile,
  type AssessSensorCameraSaturationCapacityInput,
  type SensorCameraSaturationCapacityAssessment,
  type SensorCameraSaturationCapacityProfile,
  type SensorCameraSaturationSiteApplicability,
  type SensorCameraSaturationTemperatureApplicability
} from "./sensor/camera-saturation-capacity.js";

export {
  CAPTURE_MODE_TIMING_PROFILE_SCHEMA_VERSION,
  parseCaptureModeTimingProfile,
  resolveCaptureModeTiming,
  type CaptureModeTimingProfile,
  type ResolveCaptureModeTimingInput,
  type ResolvedCaptureModeTiming
} from "./sensor/capture-mode-timing.js";

export {
  parseCaptureModeProfile,
  resolveCaptureMode,
  type CaptureModeAcquisition,
  type CaptureModeDefinition,
  type CaptureModeDependency,
  type CaptureModePerFrameSampling,
  type CaptureModeProfile,
  type CaptureModeReconstructionStage,
  type CaptureModeSampleCombinationDomain,
  type CaptureModeSensorOffsetNativeSamples,
  type DeclaredEffectiveCaptureSampling,
  type FixedMultiFrameCaptureAcquisition,
  type GroupedNativeCaptureSampling,
  type NativeEffectiveCaptureSampling,
  type ResolveCaptureModeInput,
  type ResolvedCaptureMode,
  type SingleFrameCaptureAcquisition,
  type SourcedCaptureModeFact,
  type VariableMultiFrameCaptureAcquisition
} from "./sensor/capture-mode.js";

export {
  calculateSensorReadoutTiming,
  type CalculateSensorReadoutTimingInput,
  type CaptureShutterMechanism,
  type GlobalSensorReadoutTimingDeclaration,
  type NativeSensorReadoutScanDirection,
  type RollingSensorReadoutTimingDeclaration,
  type SensorReadoutMode,
  type SensorReadoutTiming,
  type SensorReadoutTimingDeclaration,
  type SensorReadoutTimingSample,
  type SourcedSensorReadoutFact,
  type SourcedSensorTimingSeconds
} from "./sensor/readout-timing.js";

export {
  calculateCaptureExposureWindows,
  type CalculateCaptureExposureWindowsInput,
  type CaptureExposureBoundaryActuator,
  type CaptureExposureWindowSample,
  type CaptureExposureWindows,
  type ExposureBoundarySchedule,
  type ResolvedCaptureExposureBoundary,
  type SimultaneousExposureBoundarySchedule,
  type SourcedCaptureBoundaryDirection,
  type SourcedCaptureTimingSeconds,
  type UniformLinearExposureBoundarySchedule
} from "./sensor/exposure-window.js";

export {
  assessReadoutExposureTimingLinkage,
  resolveElectronicRollingShutterExposureSchedule,
  createRollingShutterCaptureExposureSchedule,
  ELECTRONIC_ROLLING_SHUTTER_MODEL,
  type ResolveElectronicRollingShutterExposureScheduleInput,
  type ElectronicRollingShutterExposureSchedule,
  type AssessReadoutExposureTimingLinkageInput,
  type ReadoutExposureBoundaryId,
  type ReadoutExposureBoundarySpatialLink,
  type ReadoutExposureBoundarySpatialLinkAssessment,
  type ReadoutExposureSpatialPhaseOrientation,
  type ReadoutExposureTimingLinkageAssessment,
  type ReadoutExposureTimingLinkageDeclaration
} from "./sensor/readout-exposure-linkage.js";

export {
  calculateCenteredCrop,
  type CalculateCenteredCropInput,
  type CenteredCrop
} from "./output/crop.js";

export {
  calculateSubjectFramingCrop,
  type CalculateSubjectFramingCropInput,
  type SubjectFramingCrop
} from "./output/subject-framing-crop.js";

export {
  calculateActiveCaptureFieldOfView,
  calculateOutputFieldOfView,
  mapImagePlanePointToOrientedPhysicalUv,
  mapOrientedPhysicalUvToImagePlanePoint,
  resolveCaptureGeometry,
  transformNativeRasterPointToOriented,
  transformNativeRasterRectToOriented,
  transformNativeRasterVectorToOriented,
  transformOrientedRasterPointToNative,
  transformOrientedRasterRectToNative,
  transformOrientedRasterVectorToNative,
  type ActiveCaptureFieldOfView,
  type CalculateActiveCaptureFieldOfViewInput,
  type CalculateOutputFieldOfViewInput,
  type CaptureOrientation,
  type ImagePlaneMetricPointMm,
  type MapImagePlanePointToOrientedPhysicalUvInput,
  type MapOrientedPhysicalUvToImagePlaneInput,
  type NormalizedRasterUv,
  type OutputFieldOfView,
  type PhysicalBoundsFromOpticalAxisMm,
  type RasterPoint,
  type RasterRect,
  type RasterVector,
  type ResolveCaptureGeometryInput,
  type ResolvedCaptureGeometry,
  type TransformRasterPointInput,
  type TransformRasterRectInput,
  type TransformRasterVectorInput
} from "./output/capture-geometry.js";

export {
  calculateIdealApertureGeometry,
  type ApertureVertex,
  type CalculateIdealApertureInput,
  type IdealApertureGeometry
} from "./optics/aperture.js";

export {
  calculateAiryDisk,
  type AiryDisk,
  type CalculateAiryDiskInput
} from "./optics/diffraction.js";

export {
  calculateIdealPolygonDiffractionPsf,
  calculatePolygonPupilFraunhoferPsf,
  type CalculateIdealPolygonDiffractionInput,
  type CalculatePolygonPupilFraunhoferPsfInput,
  type IdealPolygonDiffraction,
  type PolygonPupilFraunhoferPsf
} from "./optics/polygon-diffraction.js";

export {
  ZERNIKE_MAXIMUM_NOLL_INDEX,
  ZERNIKE_PUPIL_MAXIMUM_SAMPLES_ACROSS,
  calculateDefocusWavefront,
  createWavefrontPupilGrid,
  estimateMarechalStrehlRatio,
  evaluateZernikePolynomial,
  resolveZernikeNollOrder,
  type CalculateDefocusWavefrontInput,
  type CreateWavefrontPupilGridInput,
  type DefocusWavefront,
  type EstimateMarechalStrehlRatioInput,
  type SeidelFieldPosition,
  type SeidelWavefrontCoefficients,
  type WavefrontPupilGrid,
  type ZernikeCoefficient,
  type ZernikeOrder
} from "./optics/zernike-wavefront.js";

export {
  FRAUNHOFER_C_LINE_NM,
  FRAUNHOFER_D_LINE_NM,
  FRAUNHOFER_F_LINE_NM,
  calculateCauchyRefractiveIndex,
  calculateLongitudinalChromaticFocus,
  type CalculateLongitudinalChromaticFocusInput,
  type LongitudinalChromaticDispersion,
  type LongitudinalChromaticFocus
} from "./optics/longitudinal-chromatic-aberration.js";

export {
  calculateMechanicalVignetting,
  calculateNaturalVignetting,
  type CalculateMechanicalVignettingInput,
  type CalculateNaturalVignettingInput,
  type MechanicalVignetting,
  type MechanicalVignettingAperture,
  type NaturalVignetting,
  type NaturalVignettingModel
} from "./optics/pupil-vignetting.js";

export {
  estimateEquivalentViewingCircleOfConfusion,
  type EquivalentViewingCircleOfConfusion,
  type EstimateEquivalentViewingCircleOfConfusionInput
} from "./optics/circle-of-confusion.js";

export {
  calculateFocusPlaneImageDistance,
  parseFocusPlane,
  type CalculateFocusPlaneImageDistanceInput,
  type FocusPlane
} from "./optics/focus-state.js";

export {
  calculateThinLensImageDistance,
  type CalculateThinLensImageDistanceInput,
  type ThinLensImageDistance
} from "./optics/thin-lens.js";

export {
  calculateDefocusCircle,
  calculateDepthOfField,
  type CalculateDefocusCircleInput,
  type CalculateDepthOfFieldInput,
  type DefocusCircle,
  type DepthOfField
} from "./optics/depth-of-field.js";

export {
  DEFOCUS_DISC_KERNEL_MAXIMUM_RADIUS_SITES,
  calculateDefocusDiscKernelRadius,
  type CalculateDefocusDiscKernelRadiusInput,
  type DefocusDiscKernelRadius
} from "./optics/defocus-disc-kernel.js";

export {
  DEFOCUS_BOKEH_MAXIMUM_BLADES,
  calculateDefocusBokehKernel,
  type CalculateDefocusBokehKernelInput,
  type DefocusBokehKernel,
  type DefocusBokehOptions,
  type DefocusBokehBlades,
  type DefocusBokehSphericalAberration,
  type DefocusBokehCatsEye,
  type DefocusBokehClippingAperture
} from "./optics/defocus-bokeh-kernel.js";

export {
  calculateFocusBreathingFieldOfView,
  calculateFocusBreathingProjection,
  calculateGeometricFocusBreathing,
  type CalculateFocusBreathingFieldOfViewInput,
  type CalculateFocusBreathingProjectionInput,
  type CalculateGeometricFocusBreathingInput,
  type FocusBreathingFieldOfView,
  type FocusBreathingProjection,
  type GeometricFocusBreathing,
  type GeometricFocusingMethod
} from "./optics/focus-breathing.js";

export {
  calculateAtmosphericHaze,
  calculateExtinctionFromVisibility,
  type AtmosphericExtinctionModel,
  type AtmosphericHaze,
  type CalculateAtmosphericHazeInput,
  type CalculateExtinctionFromVisibilityInput
} from "./optics/atmospheric-haze.js";

export {
  calculateInverseRadialDistortionMapping,
  calculateInverseRadialDistortionMappings,
  calculateRadialDistortionMapping,
  type CalculateInverseRadialDistortionMappingInput,
  type CalculateInverseRadialDistortionMappingsInput,
  type CalculateRadialDistortionMappingInput,
  type InverseRadialDistortionMapping,
  type InverseRadialDistortionMappings,
  type LensFieldPointMm,
  type RadialDistortionCoefficients,
  type RadialDistortionMapping,
  type RadialDistortionProfile
} from "./optics/radial-distortion.js";

export {
  calculateBrownConradyDistortionMapping,
  calculateInverseBrownConradyDistortionMapping,
  type BrownConradyDistortionCoefficients,
  type BrownConradyDistortionMapping,
  type BrownConradyDistortionProfile,
  type CalculateBrownConradyDistortionMappingInput,
  type CalculateInverseBrownConradyDistortionMappingInput,
  type InverseBrownConradyDistortionMapping
} from "./optics/brown-conrady-distortion.js";

export {
  calculateInverseLateralChromaticAberrationMapping,
  calculateInverseLateralChromaticAberrationMappings,
  calculateLateralChromaticAberrationMapping,
  type CalculateInverseLateralChromaticAberrationMappingInput,
  type CalculateInverseLateralChromaticAberrationMappingsInput,
  type CalculateLateralChromaticAberrationMappingInput,
  type ChannelSeparationVectorMm,
  type InverseLateralChromaticAberrationChannelMapping,
  type InverseLateralChromaticAberrationMapping,
  type InverseLateralChromaticAberrationMappings,
  type LateralChromaticAberrationChannel,
  type LateralChromaticAberrationChannelMapping,
  type LateralChromaticAberrationMapping,
  type LateralChromaticAberrationProfile,
  type LateralChromaticAberrationSeparation
} from "./optics/lateral-chromatic-aberration.js";

export {
  FRONT_OF_LENS_FILTER_PROFILE_SCHEMA_VERSION,
  FRONT_OF_LENS_POLARIZER_PROFILE_SCHEMA_VERSION,
  composeFrontOfLensFilterTransmission,
  parseFrontOfLensFilterProfile,
  resolveFrontOfLensFilterTransmission,
  type ComposeFrontOfLensFilterTransmissionInput,
  type ComposedFrontOfLensFilterTransmission,
  type FrontOfLensFilterProfile,
  type FrontOfLensFilterProfileSchemaVersion,
  type FrontOfLensFilterScientificStatus,
  type FrontOfLensFilterSpectralSample,
  type FrontOfLensFilterTransmissionModel,
  type FrontOfLensFilterUncertainty,
  type LinearPolarizationState,
  type ResolveFrontOfLensFilterTransmissionInput,
  type ResolvedFrontOfLensFilterTransmission
} from "./optics/front-of-lens-filter.js";

export {
  GENERIC_ND_FILTER_PROFILES,
  GENERIC_ND_FILTER_STOPS,
  type GenericNdFilterStops
} from "./optics/generic-nd-filter-presets.js";

export {
  FILTERED_EXPOSURE_DEFAULT_WAVELENGTH_NANOMETERS,
  calculateFilteredExposureTime,
  type CalculateFilteredExposureTimeInput,
  type FilteredExposureDialSetting,
  type FilteredExposureTime
} from "./exposure/filtered-exposure-time.js";

export {
  calculateIlluminationVignetting,
  type CalculateIlluminationVignettingInput,
  type IlluminationVignetting,
  type IlluminationVignettingCoefficients,
  type IlluminationVignettingProfile
} from "./optics/illumination-vignetting.js";

export {
  SCENE_TO_SENSOR_IRRADIANCE_PROFILE_SCHEMA_VERSION,
  calculateSceneRadianceToSensorIrradiance,
  parseSceneToSensorIrradianceProfile,
  type CalculateSceneRadianceToSensorIrradianceInput,
  type NumericRange,
  type OpticalBridgeFieldThroughput,
  type OpticalBridgeFocusApplicability,
  type OpticalBridgeFocusContext,
  type OpticalBridgeScientificStatus,
  type OpticalBridgeUncertainty,
  type OpticalTransmissionModel,
  type SceneToSensorIrradianceProfile,
  type SceneToSensorIrradianceResult,
  type SpectralTransmissionSample
} from "./optics/scene-to-sensor-irradiance.js";

export {
  LENS_SAMPLED_PSF_PROFILE_SCHEMA_VERSION,
  LENS_MTF_DIAGNOSTIC_PROFILE_SCHEMA_VERSION,
  assessMtfOnlyPsfRenderability,
  parseLensMtfDiagnosticProfile,
  parseLensSampledPsfProfile,
  resolveLensSampledPsf,
  type LensMtfDiagnosticProfile,
  type LensMtfDiagnosticSample,
  type LensPsfGridAxes,
  type LensPsfKernel,
  type LensPsfScientificStatus,
  type LensPsfUncertainty,
  type LensSampledPsfGridCoordinate,
  type LensSampledPsfGridNode,
  type LensSampledPsfInterpolation,
  type LensSampledPsfProfile,
  type MtfOnlyPsfRenderabilityAssessment,
  type ResolveLensSampledPsfInput,
  type ResolvedLensSampledPsf
} from "./optics/lens-psf-profile.js";

export {
  LENS_COMPLEX_PUPIL_PROFILE_SCHEMA_VERSION,
  calculateLensComplexPupilPsf,
  parseLensComplexPupilProfile,
  type CalculateLensComplexPupilPsfInput,
  type LensComplexPupilGrid,
  type LensComplexPupilProfile,
  type LensComplexPupilPsf,
  type LensComplexPupilPsfSampling
} from "./optics/complex-pupil-psf.js";

export {
  PSF_FOUNDATION_VERSION,
  calculatePsfFoundationComponents,
  getPsfFoundationContract,
  type CalculatePsfFoundationComponentsInput,
  type PsfContributionContract,
  type PsfContributionId,
  type PsfContributionStatus,
  type PsfFoundationComponents,
  type PsfFoundationContract
} from "./optics/psf-foundation.js";

export type {
  CameraConfiguration,
  CameraSupport,
  ExposureConfiguration,
  FocusConfiguration,
  LensConfiguration,
  SensorConfiguration,
  StabilizationConfiguration
} from "./schema/camera.js";

export type {
  SceneCapability,
  SceneDefinition,
  SceneMotion,
  SceneObject,
  SceneRadiometry,
  Vector3
} from "./schema/scene.js";

export {
  SCENE_ILLUMINATION_PROFILE_SCHEMA_VERSION,
  parseSceneIlluminationProfile,
  type SceneIlluminationMagnitude,
  type SceneIlluminationProfile,
  type SceneIlluminationRelativeSpectrumSample,
  type SceneIlluminationScientificStatus,
  type SceneIlluminationSource,
  type SceneIlluminationSourceFamily,
  type SceneIlluminationSourceGeometry,
  type SceneIlluminationSpectrum,
  type SceneIlluminationUncertainty
} from "./schema/illumination.js";

export {
  createSceneIlluminationSpectralCoverageParticipant,
  resolveSceneIlluminationDiscreteLineMeasure,
  type CreateSceneIlluminationSpectralCoverageParticipantInput,
  type SceneIlluminationDiscreteLineMeasure
} from "./schema/illumination-spectral.js";

export {
  SCENE_ILLUMINATION_TEMPORAL_PROFILE_SCHEMA_VERSION,
  evaluateSceneIlluminationTemporalMultiplier,
  integrateSceneIlluminationTemporalMultiplierOverExposureWindow,
  parseSceneIlluminationTemporalProfile,
  type EvaluateSceneIlluminationTemporalMultiplierInput,
  type IntegrateSceneIlluminationTemporalMultiplierInput,
  type SceneIlluminationTemporalExposureIntegration,
  type SceneIlluminationTemporalIntegrationNode,
  type SceneIlluminationTemporalMultiplierEvaluation,
  type SceneIlluminationTemporalProfile,
  type SceneIlluminationTemporalRegistrationUncertainty,
  type SceneIlluminationTemporalScientificStatus,
  type SceneIlluminationTemporalSourceBinding,
  type SceneIlluminationTemporalWaveform,
  type SceneIlluminationTemporalWaveformSample
} from "./schema/illumination-temporal.js";

export {
  SCENE_RADIANCE_TEMPORAL_SAMPLING_PLAN_VERSION,
  createSceneRadianceTemporalSamplingPlan,
  reduceSceneRadianceTemporalSamples,
  type CreateSceneRadianceTemporalSamplingPlanInput,
  type ReducedSceneRadianceTemporalExposure,
  type ReduceSceneRadianceTemporalSamplesInput,
  type SceneRadianceTemporalEvaluatedSample,
  type SceneRadianceTemporalQuery,
  type SceneRadianceTemporalSamplingNode,
  type SceneRadianceTemporalSamplingPlan
} from "./schema/scene-radiance-temporal.js";

export {
  SCENE_MATERIAL_RESPONSE_PROFILE_SCHEMA_VERSION,
  SCENE_RADIANCE_EVALUATION_SCHEMA_VERSION,
  SCENE_RADIANCE_PROVIDER_PROFILE_SCHEMA_VERSION,
  assessSceneMaterialResponseFidelity,
  parseSceneMaterialResponseProfile,
  parseSceneRadianceEvaluationRequest,
  parseSceneRadianceEvaluationResult,
  parseSceneRadianceProviderProfile,
  validateSceneRadianceEvaluationBindings,
  type SceneMaterialResponseDefinition,
  type SceneMaterialResponseFidelity,
  type SceneMaterialResponseProfile,
  type SceneMaterialResponseRepresentation,
  type SceneRadianceDataArtifactReference,
  type SceneRadianceEvaluationBindingAssessment,
  type SceneRadianceEvaluationRequest,
  type SceneRadianceEvaluationResult,
  type SceneRadianceEvaluationTarget,
  type SceneRadianceProviderProfile,
  type SceneRadianceProviderSpectralFidelity,
  type SceneRadianceProviderTransportFidelity,
  type SceneRadianceProviderVisibilityFidelity,
  type SceneRadianceScientificStatus,
  type SceneRadianceUncertainty,
  type ValidateSceneRadianceEvaluationBindingsInput
} from "./schema/scene-radiance.js";

export {
  calculateCaptureExtendedObjectTemporalProjection,
  calculateExtendedObjectProjectionTrajectory,
  type CalculateCaptureExtendedObjectTemporalProjectionInput,
  type CalculateExtendedObjectProjectionTrajectoryInput,
  type CaptureExtendedObjectMetricPoint,
  type CaptureExtendedObjectPointTrajectory,
  type CaptureExtendedObjectTemporalNode,
  type CaptureExtendedObjectTemporalProjection,
  type ExtendedObjectFrontoparallelPlaneDeclaration,
  type ExtendedObjectMetricPoint,
  type ExtendedObjectPlanarMagnificationDiagnostic,
  type ExtendedObjectPointProjectionTrajectory,
  type ExtendedObjectProjectionNode,
  type ExtendedObjectProjectionTrajectory
} from "./motion/extended-object-projection.js";

export {
  calculateProjectedMotionBlur,
  type CalculateProjectedMotionBlurInput,
  type ProjectedMotionBlur
} from "./motion/projected-motion.js";

export {
  calculateCameraRotationImageMapping,
  calculateInverseCameraRotationImageMapping,
  type AxisSamplingPitchMicrometers,
  type CalculateCameraRotationImageMappingInput,
  type CalculateInverseCameraRotationImageMappingInput,
  type CameraAngularVelocityRadPerSec,
  type CameraRotationImageMapping,
  type ImagePlanePointMm,
  type InverseCameraRotationImageMapping
} from "./motion/camera-rotation.js";

export {
  calculateCaptureRotationTrajectories,
  type CalculateCaptureRotationTrajectoriesInput,
  type CaptureRotationTrajectories,
  type CaptureRotationTrajectoryEndpoint,
  type CaptureRotationTrajectorySample
} from "./motion/capture-rotation-trajectory.js";

export {
  calculateCaptureRotationInverseMappings,
  type CalculateCaptureRotationInverseMappingsInput,
  type CaptureRotationInverseMappings,
  type CaptureRotationInverseMappingSample
} from "./motion/capture-rotation-inverse-mapping.js";

export {
  calculateCaptureTranslationParallaxTemporalQuadrature,
  type CalculateCaptureTranslationParallaxTemporalQuadratureInput,
  type CaptureTranslationParallaxSceneSample,
  type CaptureTranslationParallaxTemporalNode,
  type CaptureTranslationParallaxTemporalQuadrature,
  type CaptureTranslationParallaxTemporalSample
} from "./motion/capture-translation-parallax-temporal-quadrature.js";

export {
  calculateCaptureRotationTemporalQuadrature,
  type CalculateCaptureRotationTemporalQuadratureInput,
  type CaptureRotationTemporalQuadrature,
  type CaptureRotationTemporalQuadratureNode,
  type CaptureRotationTemporalQuadraturePoint
} from "./motion/capture-rotation-temporal-quadrature.js";

export {
  FLASH_SYNC_CAPABILITY_SCHEMA_VERSION,
  MANUAL_FLASH_PROFILE_SCHEMA_VERSION,
  FLASH_SYNC_CAPABILITY_HSS_SCHEMA_VERSION,
  HIGH_SPEED_SYNC_MODEL,
  createHighSpeedSyncIlluminationOverlay,
  createManualFlashIlluminationOverlay,
  parseFlashSyncCapabilityProfile,
  parseManualFlashProfile,
  resolveHighSpeedFlashSync,
  resolveManualFlashSync,
  type FlashOverlaySyncRegistration,
  type ResolveHighSpeedFlashSyncInput,
  type ResolvedHighSpeedFlashSync,
  type CreateManualFlashIlluminationOverlayInput,
  type FlashSyncCapabilityProfile,
  type ManualFlashIlluminationOverlay,
  type ManualFlashProfile,
  type ManualFlashPulseProfile,
  type ManualFlashSyncMode,
  type RequestedFlashSyncMode,
  type ResolveManualFlashSyncInput,
  type ResolvedManualFlashSync
} from "./exposure/flash.js";

export {
  TTL_FLASH_MODEL,
  createTtlScaledFlashProfile,
  calculateFlashGuideNumber,
  calculateFlashPowerForDistance,
  resolveTtlFlashExposure,
  type FlashGuideNumberInput,
  type FlashPowerForDistance,
  type FlashPowerForDistanceInput,
  type ResolveTtlFlashExposureInput,
  type TtlFlashExposure
} from "./exposure/flash-ttl.js";

export {
  calculateEquivalentIso,
  calculateExposureValue100,
  calculateRelativeOpticalExposure,
  calculateRelativeRenderedExposure,
  type CalculateEquivalentIsoInput,
  type CalculateExposureValue100Input,
  type CalculateRelativeOpticalExposureInput,
  type CalculateRelativeRenderedExposureInput,
  type RelativeOpticalExposure,
  type RelativeRenderedExposure
} from "./exposure/exposure.js";

export {
  EXPOSURE_DURATION_CONTROL_VERSION,
  bindResolvedExposureDurationToCaptureExposureInput,
  resolveExposureDurationControl,
  type BindResolvedExposureDurationToCaptureExposureInput,
  type ExposureDurationControl,
  type ExposureDurationControlResolution
} from "./exposure/exposure-duration-control.js";

export {
  EXPOSURE_METERING_PROFILE_SCHEMA_VERSION,
  calculateHighlightPriorityPlacementSignal,
  meterRelativeExposure,
  parseExposureMeteringProfile,
  type HighlightPriorityMeteringDiagnostics,
  type ExposureMeteringPolicy,
  type ExposureMeteringProfile,
  type ExposureMeteringResult,
  type ExposureMeteringSampleSet,
  type ExposureMeteringZoneSample,
  type MeterRelativeExposureInput
} from "./exposure/metering.js";

export {
  SCENE_RADIANCE_METERING_DERIVATION_SCHEMA_VERSION,
  createSceneRadianceDerivedExposureMeteringSampleSet,
  parseSceneRadianceMeteringDerivationProfile,
  type CreateSceneRadianceDerivedExposureMeteringSampleSetInput,
  type SceneRadianceDerivedExposureMeteringSampleSet,
  type SceneRadianceMeteringDerivationProfile,
  type SceneRadianceMeteringSourceContext,
  type SceneRadianceMeteringTemporalContext
} from "./exposure/metering-scene-radiance.js";

export {
  meterSceneRadianceTemporalExposure,
  type MeterSceneRadianceTemporalExposureInput,
  type SceneRadianceTemporalExposureMeteringResult,
  type SceneRadianceTemporalMeteringSample
} from "./exposure/metering-temporal.js";

export {
  EXPOSURE_METER_TARGET_SCHEMA_VERSION,
  createExposureMeterTargetFromMeteringResult,
  setExposureCompensationOnMeterTarget,
  type CreateExposureMeterTargetInput,
  type ExposureMeterSnapshotIdentity,
  type ExposureMeterTarget,
  type ExposureMeterTargetSourceKind,
  type ExposureMeterTargetSourceResult,
  type SetExposureCompensationOnMeterTargetInput
} from "./exposure/metering-target.js";

export {
  ISO_CAPABILITY_PROFILE_SCHEMA_VERSION,
  bindIsoCapabilityToExposureCapabilities,
  parseIsoCapabilityProfile,
  resolveIsoCapability,
  type BindIsoCapabilityToExposureCapabilitiesInput,
  type BoundIsoExposureCapabilities,
  type IsoAutoIsoCapability,
  type IsoCapabilityAvailability,
  type IsoCapabilityProfile,
  type IsoCaptureModePolicy,
  type IsoExpandedSetting,
  type IsoExposureIndexRange,
  type IsoStandardSettingGrid,
  type RequestedIsoSetting,
  type ResolveIsoCapabilityInput,
  type ResolvedIsoCapability
} from "./equipment/iso-capabilities.js";

export {
  GENERIC_EQUIPMENT_EXPOSURE_CAPABILITY_SCHEMA_VERSION,
  parseGenericBodyExposureCapabilityProfile,
  parseGenericLensExposureCapabilityProfile,
  resolveGenericEquipmentExposureCapabilities,
  type FocalLengthFNumberSample,
  type GenericBodyExposureCapabilityProfile,
  type GenericCapabilityAvailability,
  type GenericLensExposureCapabilityProfile,
  type NumericCapabilityRange,
  type NumericSettingGrid,
  type ResolveGenericEquipmentExposureCapabilitiesInput,
  type ResolvedGenericEquipmentExposureCapabilities,
  type ResolvedNumericSettingGrid,
  type WidestAvailableFNumberCapability
} from "./equipment/exposure-capabilities.js";

export {
  GENERIC_RELEASE_CAPABILITY_SCHEMA_VERSION,
  parseGenericReleaseCapabilityProfile,
  type GenericExposureBracketAxis,
  type GenericReleaseCapabilityProfile,
  type GenericReleaseDriveMode
} from "./equipment/release-capabilities.js";

export {
  FOCUS_CONTROL_PROFILE_SCHEMA_VERSION,
  FOCUS_CONTROL_STATE_VERSION,
  assessFocusReleaseGate,
  createFocusControlState,
  parseFocusControlProfile,
  resolveFocusTargetObservation,
  setFocusLock,
  setManualFocusState,
  type AssessFocusReleaseGateInput,
  type CreateFocusControlStateInput,
  type FocusAcquisitionState,
  type FocusControlMode,
  type FocusControlProfile,
  type FocusControlState,
  type FocusReleaseGateAssessment,
  type FocusReleasePriority,
  type FocusTargetControlEvent,
  type FocusTargetLossReason,
  type FocusTargetObservation,
  type FocusTargetResolution,
  type ResolveFocusTargetObservationInput,
  type SetFocusLockInput,
  type SetManualFocusStateInput
} from "./capture/focus-control.js";

export {
  RELEASE_SEQUENCE_VERSION,
  createCancelledReleaseSequence,
  resolveReleaseSequence,
  type CancelledReleaseSequence,
  type CancelReleaseSequenceInput,
  type ReleaseAutomationState,
  type ReleaseBaseCaptureState,
  type ReleaseBracketPolicy,
  type ReleaseDrivePolicy,
  type ReleaseTimingConstraint,
  type ResolveReleaseSequenceInput,
  type ResolvedReleaseFrame,
  type ResolvedReleaseSequence
} from "./capture/release-sequence.js";

export {
  VIDEO_FRAME_SEED_STREAM_ID,
  VIDEO_FRAME_SEQUENCE_MAXIMUM_FRAMES,
  VIDEO_FRAME_SEQUENCE_VERSION,
  assessShutterAngleRule,
  calculateShutterAngleExposureSeconds,
  calculateShutterAngleFromExposureSeconds,
  resolveVideoFrameSequence,
  type ResolveVideoFrameSequenceInput,
  type ShutterAngleRuleAssessment,
  type VideoFrameSequence
} from "./motion/video-sequence.js";

export {
  GENERIC_BODY_METERING_CAPABILITY_SCHEMA_VERSION,
  assessExposureMeteringProfileCompatibility,
  parseGenericBodyMeteringCapabilityProfile,
  type AssessExposureMeteringProfileCompatibilityInput,
  type GenericBodyMeteringCapabilityProfile,
  type GenericSupportedMeteringProfile,
  type MeteringCapabilityCompatibilityAssessment,
  type MeteringCapabilityCompatibilityBlocker
} from "./equipment/metering-capabilities.js";

export {
  EXPOSURE_PROGRAM_LINE_SCHEMA_VERSION,
  parseExposureProgramLineProfile,
  type ExposureProgramLineNode,
  type ExposureProgramLineProfile
} from "./exposure/program-line.js";

export {
  AUTO_ISO_SLOWEST_SHUTTER_MAXIMUM_BIAS_STOPS,
  AUTO_ISO_SLOWEST_SHUTTER_MODEL_VERSION,
  GENERIC_HANDHELD_ANGULAR_VELOCITY_RAD_PER_SEC,
  estimateAutoIsoSlowestShutter,
  type AutoIsoSlowestShutterBlurBudget,
  type AutoIsoSlowestShutterEstimate,
  type EstimateAutoIsoSlowestShutterInput
} from "./exposure/auto-iso-slowest-shutter.js";

export {
  EXPOSURE_MODE_RESOLVER_VERSION,
  resolveAperturePriorityAutoIsoExposureMode,
  resolveAperturePriorityExposureMode,
  resolveFullAutoExposureMode,
  resolveManualExposureMode,
  resolveProgramAutoExposureMode,
  resolveShutterPriorityExposureMode,
  type AperturePriorityAutoIsoExposureModeResolution,
  type AperturePriorityAutoIsoPolicy,
  type AperturePriorityExposureModeResolution,
  type AutoIsoBaselinePolicy,
  type AutoIsoLimits,
  type ExposureResolutionConstraint,
  type ExposureTargetResidual,
  type ExposureTargetResidualState,
  type FullAutoExposureModeResolution,
  type FullAutoExposurePolicy,
  type ManualExposureModeResolution,
  type ManualIsoControl,
  type ProgramAutoExposureModeResolution,
  type ProgramAutoIsoControl,
  type ProgramSlowestPreferredShutterPolicy,
  type ProgramLineSelectionDiagnostics,
  type RelativeExposureControlAnchor,
  type ResolveAperturePriorityAutoIsoExposureModeInput,
  type ResolveAperturePriorityExposureModeInput,
  type ResolveFullAutoExposureModeInput,
  type ResolveManualExposureModeInput,
  type ResolveProgramAutoExposureModeInput,
  type ResolveShutterPriorityExposureModeInput,
  type ShutterPriorityAutoIsoPolicy,
  type ShutterPriorityExposureModeResolution
} from "./exposure/exposure-mode-resolver.js";

export {
  STABILIZATION_DISTURBANCE_TRAJECTORY_VERSION,
  STABILIZATION_SYSTEM_PROFILE_SCHEMA_VERSION,
  calculateStabilizedCaptureTemporalSamples,
  calculateStabilizedRotationTrajectory,
  parseStabilizationDisturbanceTrajectory,
  parseStabilizationSystemProfile,
  type CalculateStabilizedCaptureTemporalSamplesInput,
  type CalculateStabilizedRotationTrajectoryInput,
  type PhysicalStabilizationArchitecture,
  type StabilizationAngularStateRad,
  type StabilizationAxisResolution,
  type StabilizationAxisResponseProfile,
  type StabilizationCaptureKind,
  type StabilizationCoordinatedAllocation,
  type StabilizationDisturbanceSample,
  type StabilizationDisturbanceTrajectory,
  type StabilizationPanningPolicy,
  type StabilizationRotationAxis,
  type StabilizationSystemProfile,
  type StabilizedCaptureTemporalNode,
  type StabilizedCaptureTemporalPoint,
  type StabilizedCaptureTemporalSamples,
  type StabilizedRotationSample,
  type StabilizedRotationTrajectory
} from "./stabilization/system.js";

export {
  estimateCameraShakeBlur,
  type CameraShakeBlurSample,
  type CameraShakeEstimate,
  type EstimateCameraShakeBlurInput
} from "./stabilization/camera-shake.js";

export {
  calculatePhotoelectrons,
  calculateSignalToNoise,
  type CalculatePhotoelectronsInput,
  type CalculateSignalToNoiseInput,
  type SignalToNoise
} from "./sensor/signal-noise.js";

export {
  assessRadiometryReadiness,
  parseRadiometryReadinessProfile,
  type CalibrationArtifactReference,
  type ExposureIntegrationRequirement,
  type OpticalTransmissionRequirement,
  type PhotositeCollectionAreaRequirement,
  type PupilVignettingRequirement,
  type RadiometryReadinessAssessment,
  type RadiometryReadinessProfile,
  type RadiometryRequirement,
  type RadiometryRequirementId,
  type RadiometryScientificStatus,
  type RadiometryUncertaintyDeclaration,
  type SceneSpectralRadianceRequirement,
  type SensorResponseRequirement
} from "./sensor/radiometry-readiness.js";

export {
  POC_SIMULATION_API_VERSION,
  simulatePocCamera,
  type PocSimulationRequest,
  type PocSimulationResponse
} from "./simulation/poc-simulation.js";

export {
  InvalidConfigurationError,
  parseCameraConfiguration,
  parseSceneDefinition
} from "./schema/validation.js";

export { calculateSensorEqeLocalExposure, type CalculateSensorEqeLocalExposureInput,
  type SensorEqeLocalExposure } from "./sensor/eqe-local-exposure.js";

export { calculateSceneToSensorIrradianceQuadrature, type CalculateSceneToSensorIrradianceQuadratureInput,
  type SceneSensorQuadratureSample, type SceneToSensorIrradianceQuadrature } from "./optics/scene-to-sensor-quadrature.js";

export { calculateSceneSensorEqeTemporalExposure, type CalculateSceneSensorEqeTemporalExposureInput,
  type SceneSensorEqeTemporalExposure } from "./sensor/scene-eqe-temporal-exposure.js";
export { calculateSensorPsfIrradianceQuadrature, type CalculateSensorPsfIrradianceQuadratureInput,
  type SensorPsfSourceSample, type SensorPsfIrradianceQuadrature } from "./optics/sensor-psf-quadrature.js";
export { calculateSensorEnvironmentRadianceQuery, type CalculateSensorEnvironmentRadianceQueryInput,
  type EnvironmentLensFieldMapping, type SensorEnvironmentLensFieldMappingResult,
  type SensorEnvironmentRadianceQuery } from "./optics/sensor-environment-query.js";
export { calculateSensorEqeTemporalExposure, type CalculateSensorEqeTemporalExposureInput,
  type SensorEqeTemporalExposure } from "./sensor/eqe-temporal-exposure.js";

export { createSensorEqeTemporalPhotoSignal, parseSensorEqeTemporalPhotoSignal,
  type SensorEqeTemporalPhotoSignal, type SensorEqePhotoExposure } from "./sensor/temporal-photo-signal.js";

export type { SensorTemporalDarkCurrentCharge, SensorPhotoDarkCurrentCharge } from "./sensor/dark-current.js";

export { calculateEnvironmentSensorPhotoSignal, type CalculateEnvironmentSensorPhotoSignalInput,
  type EnvironmentSensorPhotoSignal, type EnvironmentRadianceEvaluator, type EnvironmentApertureRadianceEvaluator } from "./sensor/environment-photo-signal.js";
export { simulateEnvironmentSensorRawFrame, type SimulateEnvironmentSensorRawFrameInput,
  type EnvironmentSensorRawFrame } from "./capture/environment-raw-producer.js";

export { calculateProcessedSensorRaw, parseProcessedSensorRawInput, type ProcessedSensorRawInput,
  type ProcessedSensorRawResult } from "./capture/photographic-export.js";
export { calculatePrintPlan, calculatePrintSizeLimit, parsePrintPlanInput } from "./output/print-plan.js";
export type { PrintLength, PrintedImageSize, PrintSamplingCriterion, PrintNativeSource, PrintProviderConstraints, PrintPlanInput, PrintRasterSampling, PrintPlan, PrintSizeLimitInput, PrintSizeLimit } from "./output/print-plan.js";
export { PRINT_REGION_DETAIL_MODEL_VERSION, MAX_PRINT_DETAIL_REGION_SAMPLES, calculatePrintRegionDetail, parsePrintRegionDetailInput } from "./output/print-detail.js";
export type { PrintDetailSource, PrintDetailRegion, PrintSinusoidalTarget, PrintRegionDetailInput, PrintSinusoidalMeasurement, PrintRegionDetailAssessment } from "./output/print-detail.js";
export { PRINT_REGION_STATISTICS_MODEL_VERSION, MAX_PRINT_REGION_STATISTICS_SAMPLES,
  calculatePrintRegionDifference, calculatePrintRegionNoise, parsePrintRegionDifferenceInput, parsePrintRegionNoiseInput } from "./output/print-region-statistics.js";
export type { PrintRegionRaster, PrintRegionDifferenceInput, PrintRegionNoiseInput, PrintRegionDifferenceMeasurement,
  PrintRegionNoiseMeasurement, PrintRegionStatisticsAssessment } from "./output/print-region-statistics.js";
export { PRINT_CONTRAST_REFERENCE_MODEL_VERSION, PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION,
  calculatePrintContrastReference, parsePrintContrastReferenceInput } from "./output/print-contrast-reference.js";
export type { PrintContrastReferenceInput, PrintContrastReference } from "./output/print-contrast-reference.js";
export { NATIVE_RAW_SCHEMA_VERSION, NATIVE_RAW_LIMITS, calculateNativeRawPlan, createNativeRawTask } from "./capture/native-raw.js";
export { PRINT_JPEG_SCHEMA_VERSION, PRINT_JPEG_LIMITS, parsePrintJpegInput, createPrintJpegTask, createPrintJpegStrip, composePrintJpegStrips } from "./output/print-jpeg.js";
export type { PrintJpegSource, PrintJpegInput, PrintJpegTileRequest, PrintJpegTile, PrintJpegProvider, PrintJpegOutput, PrintJpegTask, PrintJpegStripInput, PrintJpegStrip } from "./output/print-jpeg.js";
export type { JpegStripBits } from "./capture/export-jpeg.js";
export { SRGB_ICC_PROFILE_VERSION, createSrgbIccProfile } from "./color/srgb-icc.js";
export { createNativeEnvironmentRawTask, createNativeEnvironmentSensorStageTask, calculateNativeRawRowBands, createNativeEnvironmentRawPartitionTask,
  composeNativeEnvironmentRawPartitions } from "./capture/native-environment-raw.js";
export type { NativeEnvironmentRawInput, NativeEnvironmentRawTile, NativeEnvironmentPhotoTile, NativeEnvironmentRawProvider, NativeEnvironmentRawOutput,
  NativeEnvironmentRawTask, NativeRawRowBand, NativeEnvironmentRawPartition, NativeEnvironmentRawPartitionTask, NativeEnvironmentRadianceQuery } from "./capture/native-environment-raw.js";
export { NATIVE_ENVIRONMENT_OPTICAL_STAGE_LIMITS } from "./capture/native-environment-optical-stage.js";
export type { NativeEnvironmentOpticalStage, NativeEnvironmentOpticalStageRetention, NativeEnvironmentSensorStageInput,
  NativeEnvironmentSensorStageProvider } from "./capture/native-environment-optical-stage.js";
export { createNativeRawDevelopmentTask, NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS } from "./capture/native-raw-development.js";
export type { NativeRawDevelopmentInput, NativeRawDevelopmentOutput, NativeRawDevelopmentProvider, NativeRawDevelopmentTask,
  RawHighlightDiagnostics } from "./capture/native-raw-development.js";
export type { NativeRawExposureInput, NativeRawExposure, NativeRawInput, NativeRawPlan, NativeRawTileRequest, NativeRawTile,
  NativeRawProvider, NativeRawOutput, NativeRawTaskState, NativeRawTask } from "./capture/native-raw.js";
export { NATIVE_CAPTURE_SDR_SCHEMA_VERSION, NATIVE_CAPTURE_SDR_LIMITS, calculateNativeCaptureSdrPlan, createNativeCaptureSdrTask } from "./output/native-capture-sdr.js";
export type { NativeCaptureSdrInput, NativeCaptureSdrTileRequest, NativeCaptureSdrTile, NativeCaptureSdrProvider, NativeCaptureSdrPlan,
  NativeCaptureSdrOutput, NativeCaptureSdrTaskState, NativeCaptureSdrTask, NativeTaskProgress } from "./output/native-capture-sdr.js";

export { IRRADIANCE_CONVOLUTION_SCHEMA_VERSION, IRRADIANCE_CONVOLUTION_LIMITS, calculateIrradianceConvolutionPlan, calculateIrradianceConvolution } from "./optics/irradiance-convolution.js";
export type { IrradianceConvolutionInput, IrradianceConvolutionPlan } from "./optics/irradiance-convolution.js";
export { LENS_PSF_CONVOLUTION_KERNELS_SCHEMA_VERSION, LENS_PSF_CONVOLUTION_KERNELS_MAXIMUM_WAVELENGTHS, resolveLensPsfConvolutionKernels } from "./optics/lens-psf-kernels.js";
export type { LensPsfConvolutionKernelsInput, LensPsfConvolutionKernels } from "./optics/lens-psf-kernels.js";
export { DIFFRACTION_LIMITED_PSF_PROFILE_MODEL, DIFFRACTION_LIMITED_PSF_PROFILE_LIMITS, createDiffractionLimitedPsfProfile } from "./optics/diffraction-psf-profile.js";
export type { CreateDiffractionLimitedPsfProfileInput, DiffractionLimitedPsfProfile, DiffractionLimitedPsfWavelength } from "./optics/diffraction-psf-profile.js";
export { PACKED_SENSOR_RAW_SCHEMA_VERSION, PACKED_SENSOR_RAW_LIMITS, calculatePackedSensorRawPlan, simulatePackedSensorRaw } from "./capture/packed-sensor-raw.js";
export type { PackedSensorRawInput, PackedSensorRawPlan, PackedSensorRawDiagnostics, PackedSensorRawResult, PackedSensorFixedPatternNoise,
  PackedSensorAdditionalChargeComponent } from "./capture/packed-sensor-raw.js";
export { TEMPORAL_EXPOSURE_SUM_SCHEMA_VERSION, TEMPORAL_EXPOSURE_SUM_LIMITS, calculateTemporalExposureSumPlan, calculateTemporalExposureSum } from "./motion/temporal-exposure-sum.js";
export type { TemporalExposureSumInput, TemporalExposureSumNode, TemporalExposureSumPlan } from "./motion/temporal-exposure-sum.js";
export { ImageKernelExecutionError, WEBGPU_F32_UNIT_ROUNDOFF, WEBGPU_F32_TRANSFER_ABSOLUTE_BOUND, composeRelativeErrorBounds } from "./gpu/image-kernel-execution.js";
export type { ImageKernelBackend, ImageKernelFallbackReason, ImageKernelFailureReason, ImageKernelExecution, ImageKernelCodeErrorBound,
  ImageKernelRelativeErrorBound, ImageKernelSeededRealizationBound, ImageKernelAdapterDescription,
  ChartCompositeProbeComponent, ChartCompositeProbeMismatch, ChartCompositeProbeRecord } from "./gpu/image-kernel-execution.js";
export { createImageKernelAccelerator } from "./gpu/image-kernel-accelerator.js";
export { getWebGpuEnabled, setWebGpuEnabled } from "./gpu/webgpu-switch.js";
export type { ImageKernelAccelerator, ImageKernelAcceleratorOptions, ImageKernelAcceleratorState, ImageKernelRunOptions,
  AcceleratedNativeCaptureSdrOutput, AcceleratedNativeRawDevelopmentOutput, IrradianceConvolutionResult, AcceleratedPackedSensorRawResult,
  TemporalExposureSumResult, ChartRadianceResult } from "./gpu/image-kernel-accelerator.js";
export { BUILT_IN_BAYER_DEMOSAIC_MODEL_VERSION, createBuiltInBayerDemosaicProfiles, type BuiltInBayerDemosaicKernel, type BuiltInBayerDemosaicProfiles,
  type CreateBuiltInBayerDemosaicProfilesInput, type RawReconstructionBorderHandling } from "./sensor/raw-reconstruction.js";
export { PROCESSING_MAX_PIXELS, PROCESSING_MAX_FRAMES, PROCESSING_DEFAULT_MAXIMUM_WORKING_BYTES, PROCESSING_MODEL_VERSION,
  type ProcessingProvider, type ProcessingTask, type ProcessingTaskState, type ProcessingRgbImage, type ProcessingLinearColorSpace,
  type ProcessingProvenance } from "./processing/processing-task.js";
export { createCfaPlaneReconstructionTask, createAhdDemosaicTask, type CfaMosaicPlane, type CfaPlaneReconstructionInput,
  type CfaPlaneReconstructionOutput, type AhdDemosaicInput, type AhdDemosaicOutput } from "./processing/demosaic.js";
export { createHdrBracketMergeTask, createHdrImageEncodingTask, type HdrBracketFrame, type HdrBracketMergeInput, type HdrBracketMergeOutput,
  type HdrTransfer, type HdrImageEncodingInput, type HdrImageEncodingOutput } from "./processing/hdr.js";
export { createReinhardGlobalToneMappingTask, createDurandDorseyToneMappingTask, createExposureFusionTask, type ToneMappedImage,
  type ReinhardGlobalToneMappingInput, type ReinhardGlobalToneMappingOutput, type DurandDorseyToneMappingInput, type DurandDorseyToneMappingOutput,
  type ExposureFusionInput, type ExposureFusionOutput } from "./processing/tone-mapping.js";
export { createFocusStackTask, type FocusStackInput, type FocusStackOutput } from "./processing/focus-stacking.js";
export { createPanoramaTask, type PanoramaFrame, type PanoramaCanvas, type PanoramaInput, type PanoramaOutput } from "./processing/panorama.js";
export { SYNTHETIC_FILM_GRAIN_STREAM_ID, createBilateralFilterTask, createNonLocalMeansTask, createUnsharpMaskTask, createSyntheticFilmGrainTask,
  type ProcessedRgbImage, type BilateralFilterInput, type NonLocalMeansInput, type UnsharpMaskInput, type SyntheticFilmGrainInput,
  type SyntheticFilmGrainOutput } from "./processing/denoise.js";

export { calculateSensorApertureRays, type CalculateSensorApertureRaysInput, type IdealCircularPupil, type SensorApertureRay, type SensorApertureRays } from "./optics/sensor-aperture-rays.js";

export { SIMULATE_CAPTURE_FACADE_VERSION, SIMULATE_CAPTURE_DEFAULT_ILLUMINANCE_LUX, SIMULATE_CAPTURE_COST_OPTIONS, SIMULATE_CAPTURE_METERING_MODES, simulateCapture,
  type SimulateCaptureOptions, type SimulateCaptureResult, type SimulateCaptureAssumption, type SimulateCaptureProgress,
  type SimulateCaptureExposureMode, type SimulateCaptureMetering, type SimulateCaptureAutoIsoAfterMaximum, type SimulateCaptureAutoIsoReport, type SimulateCaptureAutomaticSlowestShutterOptions,
  type SimulateCaptureAutomaticSlowestShutterReport, type SimulateCaptureOutputFormat, type SimulateCaptureWhiteBalance, type SimulateCaptureColorEncoding,
  type SimulateCaptureDemosaic, type SimulateCaptureBorderHandling, type SimulateCaptureLensDistortion, type SimulateCaptureMotion,
  type SimulateCaptureSensorAntiAliasing, type SimulateCaptureCostOption, type SimulateCapturePixelAperture, SIMULATE_CAPTURE_BOX_APERTURE_DEFAULT_SAMPLES,
  SIMULATE_CAPTURE_FAST_OPTIONS, type SimulateCaptureFastOption, type SimulateCaptureFastReport, type SimulateCaptureDemosaicRecord, type SimulateCaptureLensCatalogueRecord,
  type SimulateCaptureSharpening, type SimulateCaptureDiffractionCorrection, type SimulateCaptureLensCorrections, type SimulateCaptureDetailDiagnostics,
  simulateIdealReference, type IdealReferenceResult, serializeSimulatedCaptureDngFromParts, type SimulateCaptureDngPart, type SimulateDisplayViewOptions, type DisplayViewResult,
  type DisplayViewHighlightDiagnostics, SIMULATE_DISPLAY_VIEW_DEFAULT_SAMPLES_PER_AXIS } from "./facade/simulate-capture.js";
export { simulateCaptureFromParts } from "./facade/develop-joined-parts.js";
export { simulateDisplayView, prepareDisplayView, type PreparedDisplayView, type PreparedDisplayViewRenderOptions, serializeDisplayViewCorrectionStates, bindDisplayViewCorrectionStates,
  type DisplayViewCorrectionStateKeys, type DisplayViewCorrectionStateSet } from "./facade/simulate-display-view.js";
export type { DisplayViewGpuMode, PrepareDisplayViewOptions, DisplayViewGpuFallbackReason, DisplayViewGpuConformance, DisplayViewExecution,
  DisplayViewFastReport } from "./facade/display-view-gpu.js";
export { type OutputTextMetadata, addJpegTextMetadata, addPngTextMetadata } from "./output/text-metadata.js";
export { GENERIC_THIRD_STOP_ISO_SETTINGS, GENERIC_THIRD_STOP_SHUTTER_SECONDS, GENERIC_WHOLE_STOP_ISO_SETTINGS, type GenericTierPresetVersion } from "./equipment/generic-tier-assets.js";
export { GENERIC_PRIME_EQUIVALENT_FOCAL_LENGTHS_MM, GENERIC_PRIME_THIRD_STOP_F_NUMBERS, GENERIC_PRIME_MINIMUM_FOCUS, resolveGenericPrimeLens,
  calculateGenericPrimeMinimumFocusDistanceM, type GenericPrimeLens, type GenericPrimeEquivalentFocalLengthMm } from "./equipment/generic-prime-lenses.js";
export { IDEAL_LENS_LIMITS } from "./equipment/ideal-lens.js";
export { GENERIC_LENS_CATALOGUE, GENERIC_LENS_IDS, GENERIC_LENS_SET_BASELINES, resolveGenericLens, simulateGenericLensFocusError, type GenericLensCatalogueEntry,
  type GenericLensSet, type GenericLensKind, type GenericLensCharacterValues, type GenericLensAdjustments, type GenericLensCharacter, type ResolvedGenericLens,
  type ResolveGenericLensInput, type SimulateGenericLensFocusErrorInput, type GenericLensFocusError } from "./equipment/generic-lens-catalogue.js";
export { createGenericLensCorrectionProfile, GENERIC_LENS_CORRECTION_CHANNEL_WAVELENGTHS_NM, type CreateGenericLensCorrectionProfileInput } from "./output/generic-lens-corrections.js";
export { calculateChartFraming, calculateSubjectDistanceForFraming, type CalculateChartFramingInput, type CalculateSubjectDistanceForFramingInput, type ChartFraming,
  type SubjectFraming, type SubjectFramingFit } from "./facade/subject-framing.js";
export { CHART_SCENE_PRESETS, CHART_SCENE_DEFAULTS, CHART_SPECTRAL_RANGE_NANOMETERS, resolveChartScene, calculateStepWedgeReflectances,
  calculatePointGridCenters, type ChartScene, type ChartScenePresetId, type ChartReflectance, type ResolvedChartScene, type UniformChartScene,
  type SlantedEdgeChartScene, type SiemensStarChartScene, type StepWedgeChartScene, type GreyRampChartScene, type CheckerboardChartScene,
  type PointGridChartScene, type PatchChartScene, CHART_CONTINUOUS_LEVELS, calculateBarGroupTargets, calculateSlantedSquareEdges,
  type DeadLeavesChartScene, type BarGroupsChartScene, type HyperbolicWedgeChartScene, type ZonePlateChartScene, type SlantedSquaresChartScene,
  type LineGridChartScene, type FiducialChartScene, type CompositeChartScene, type CompositeChartElement, type ChartElementScene,
  type ChartRectangle, type ChartBarGroupTarget, type ChartSlantedSquare, type ColorPatchReflectance, type ColorPatchesChartScene } from "./facade/chart-scenes.js";
export { COLOR_PATCH_SET_ID, COLOR_PATCH_SET_VERSION, COLOR_PATCH_IDS, COLOR_PATCH_WAVELENGTH_RANGE_NANOMETERS, getColorPatchSet, evaluateColorPatchReflectance,
  type ColorPatch, type ColorPatchId, type ColorPatchGroup, type ColorPatchSet, type ColorPatchSpectralTerm, type EvaluateColorPatchReflectanceInput } from "./facade/color-patches.js";
export { PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W, resolveCaptureIlluminant, createPlanarSceneRadianceProvider, CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE, CALLER_MATERIAL_SCENE_MAX_MATERIALS, type ChartSizeOption,
  type CaptureIlluminant, type ResolvedCaptureIlluminant, type CallerReflectanceScene, type CallerRadianceScene, type CallerMaterialScene, type ScenePlanePoint, type SceneMaterialPoint,
  type PlanarSceneRadianceProvider } from "./facade/scene-radiance.js";
export { CHART_RADIANCE_BATCH_SCHEMA_VERSION, CHART_RADIANCE_BATCH_LIMITS, calculateChartRadianceBatchPlan, calculateChartRadianceBatch,
  mapEnvironmentDirectionsToChartPoints, type ChartRadianceBatchInput, type ChartRadianceBatchPlan } from "./facade/chart-radiance-batch.js";
export { resolveChartMaterialLayers, CHART_MASK_INDEX_GRAIN, CHART_MATERIAL_LAYER_LIMITS, type ChartMaterialLayerScene, type ChartMaskLayer, type ChartMaskShape,
  type ChartMaskPolygon, type ChartMaskAnnulus, type ResolvedChartMaterialLayers, type ResolvedChartMaskLayer, type ResolvedChartMaskShape } from "./facade/chart-material-layers.js";
export { EXPORT_JPEG_ENCODER_ID } from "./capture/export-jpeg.js";
export { DNG_IMPORT_SCHEMA_VERSION, DNG_IMPORT_LIMITS, parseDngRawImage } from "./capture/dng-import.js";
export { NATIVE_RAW_DNG_SCHEMA_VERSION, serializeNativeRawDng, type SerializeNativeRawDngInput, type NativeRawDng, type NativeRawDngChannelNoise } from "./capture/native-raw-dng.js";
export type { DngImportInput, ImportedDngRaw, ImportedDngCfa, ImportedDngBlackLevel, ImportedDngRect } from "./capture/dng-import.js";
export { parseLosslessJpeg, type LosslessJpegImage, type LosslessJpegLimits } from "./capture/lossless-jpeg.js";
export { PNG_ENCODER_ID, PNG_ENCODER_LIMITS, serializePngImage } from "./output/png-encoder.js";
export type { PngEncodeInput, PngColourEncoding, PngCicpPrimaries, PngCicpTransfer, PngMasteringDisplay, PngContentLightLevel } from "./output/png-encoder.js";

declare global {
  /**
   * Minimal global AbortSignal type. It lets the published declarations type-check with
   * `lib: ["es2022"]` and no DOM or `@types/node` types. (Task and yield callbacks receive a signal
   * the engine creates.) It merges cleanly with the DOM, WebWorker and Node declarations, which
   * declare the same `aborted` member.
   */
  interface AbortSignal {
    readonly aborted: boolean;
  }
}
