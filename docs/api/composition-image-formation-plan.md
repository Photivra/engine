# composition/image-formation-plan.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createProductionCaptureSnapshot

Records, by value, the resolved capture settings, the scene time and identity, the random seed,
and optional timing, focus and white-balance state. Later changes in the application cannot alter
this captured event.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function createProductionCaptureSnapshot(
  input:
    CreateProductionCaptureSnapshotInput
): ProductionCaptureSnapshot;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createProductionCaptureSnapshotFromReleaseFrame

Creates one immutable production snapshot directly from a committed release
frame (ResolvedReleaseFrame). The release frame supplies the exposure, focus,
automation and seed. The caller supplies only the scene and output state that
the release sequence does not.

```ts
export function createProductionCaptureSnapshotFromReleaseFrame(
  input:
    CreateProductionCaptureSnapshotFromReleaseFrameInput
): ProductionCaptureSnapshot;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateProductionCaptureSnapshotFromReleaseFrameInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateProductionCaptureSnapshotFromReleaseFrameInput {
  captureId: string;
  sceneStateId: string;
  sceneTimeSecondsFromExposureStart:
    number;
  outputStateId: string;
  releaseFrame:
    ResolvedReleaseFrame;
  whiteBalanceState?:
    ResolvedWhiteBalanceState;
  physicalSceneSample?:
    ProductionPhysicalSceneSample;
  temporalCapture?:
    ProductionTemporalCaptureInput;
}
```

## CreateProductionCaptureSnapshotInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateProductionCaptureSnapshotInput {
  captureId: string;
  releaseFrameId: string;
  sceneStateId: string;
  sceneTimeSecondsFromExposureStart:
    number;
  outputStateId: string;
  exposure: {
    aperture: number;
    shutterSeconds: number;
    iso: number;
  };
  stochasticSeedUint32: number;
  releaseFrameBinding?:
    ProductionReleaseFrameBinding;
  whiteBalanceState?:
    ResolvedWhiteBalanceState;
  physicalSceneSample?:
    ProductionPhysicalSceneSample;
  temporalCapture?:
    ProductionTemporalCaptureInput;
}
```

## createProductionImageFormationPlan

Builds the production plan. Adds dependencies to the requested stages using the stage graph,
checks the shared state and capability limits, then runs only supported, declared input routes.
Each requested effect is reported as active, zero, omitted or blocked, with child evidence. A
requested effect is never skipped silently.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function createProductionImageFormationPlan(
  input:
    CreateProductionImageFormationPlanInput
): ProductionImageFormationPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateProductionImageFormationPlanInput

Combines one validated prepared context and one immutable capture snapshot
with exactly one supported physical input route: a supplied sample, processing
of an attached RAW, or an executed environment capture. The environment route
brings its own synchronous provider callback. It may supply a processing
policy without a RAW; execution then provides the exact realized frame.
Incompatible route combinations are rejected. A complete record does not make
effects outside the supported range valid.

```ts
export interface CreateProductionImageFormationPlanInput {
  environmentCapture?: ProductionEnvironmentCaptureInput;
  /** Explicit RAW input after the ADC. Output processing cannot invent the upstream scene. */
  processedOutput?: ProductionProcessedOutputInput;
  preparedContext:
    PreparedImageFormationContext;
  captureSnapshot:
    ProductionCaptureSnapshot;
}
```

## IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION =
  "0.1.0" as const
```

## ImageFormationFidelityProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ImageFormationFidelityProfile {
  schemaVersion:
    typeof IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  requiredStages:
    readonly ImageFormationStageId[];
  requiredEffects:
    readonly RequiredImageFormationEffect[];
  rendererRequirements: {
    spectral:
      | "wavelength-resolved"
      | "wavelength-independent-approximation";
    sensorDomainProcessing: boolean;
    depth:
      | "none"
      | "per-layer";
  };
}
```

## parseImageFormationFidelityProfile

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function parseImageFormationFidelityProfile(
  value: unknown
): ImageFormationFidelityProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePreparedImageFormationContext

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function parsePreparedImageFormationContext(
  value: unknown
): PreparedImageFormationContext;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseProductionCaptureSnapshot

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function parseProductionCaptureSnapshot(
  value: unknown
): ProductionCaptureSnapshot;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseRendererCapabilityDeclaration

Validates an untrusted declaration and returns the normalized typed contract. Unknown enum values,
missing required fields and incompatible scientific data are rejected here.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function parseRendererCapabilityDeclaration(
  value: unknown
): RendererCapabilityDeclaration;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PlannedImageFormationEffect

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PlannedImageFormationEffect {
  effectId: ImageFormationEffectId;
  primaryStage: ImageFormationStageId;
  coupledStages:
    readonly ImageFormationStageId[];
  state:
    PlannedImageFormationEffectState;
  scientificStatus:
    PlannedScientificStatus;
  requiredByFidelity: boolean;
  modelId?: string;
  modelVersion?: string;
  blockerCodes:
    readonly ProductionImageFormationBlockerCode[];
}
```

## PlannedImageFormationEffectState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PlannedImageFormationEffectState =
  | "active"
  | "modeled-zero"
  | "omitted-by-fidelity"
  | "unsupported"
  | "blocked";
```

## PlannedImageFormationStage

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PlannedImageFormationStage {
  stageId: ImageFormationStageId;
  contractStatus:
    ReturnType<
      typeof getImageFormationContract
    >["stages"][number]["status"];
  state:
    PlannedImageFormationStageState;
  scientificStatus:
    PlannedScientificStatus;
  requiredByFidelity: boolean;
  requiredUpstreamStages:
    readonly ImageFormationStageId[];
  coupledStages:
    readonly ImageFormationStageId[];
  modelId?: string;
  modelVersion?: string;
  resultIdentity?: string;
  blockerCodes:
    readonly ProductionImageFormationBlockerCode[];
}
```

## PlannedImageFormationStageState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PlannedImageFormationStageState =
  | "active"
  | "modeled-zero"
  | "omitted-by-fidelity"
  | "unsupported"
  | "blocked";
```

## PlannedScientificStatus

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type PlannedScientificStatus =
  | "calibrated"
  | "approximation"
  | "not-applicable";
```

## PREPARED_IMAGE_FORMATION_CONTEXT_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PREPARED_IMAGE_FORMATION_CONTEXT_VERSION =
  "0.1.0" as const
```

## PreparedImageFormationContext

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PreparedImageFormationContext {
  version:
    typeof PREPARED_IMAGE_FORMATION_CONTEXT_VERSION;
  contextId: string;
  sceneId: string;
  sceneRadianceProviderProfileId:
    string;
  outputGeometryProfileId: string;
  equipmentCapabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  opticalBridgeProfile?:
    SceneToSensorIrradianceProfile;
  renderer:
    RendererCapabilityDeclaration;
  fidelity:
    ImageFormationFidelityProfile;
  fingerprint: {
    algorithm:
      "fnv1a-32-non-cryptographic";
    value: string;
  };
}
```

## prepareImageFormationContext

Parses, copies and freezes the declarations that change rarely (equipment, scene, renderer and
fidelity), so later immutable captures can reuse them. This prepares state; it does not render a
frame.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function prepareImageFormationContext(
  input:
    PrepareImageFormationContextInput
): PreparedImageFormationContext;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PrepareImageFormationContextInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrepareImageFormationContextInput {
  contextId: string;
  sceneId: string;
  sceneRadianceProviderProfileId:
    string;
  outputGeometryProfileId: string;
  equipmentCapabilities:
    ResolvedGenericEquipmentExposureCapabilities;
  opticalBridgeProfile?:
    SceneToSensorIrradianceProfile;
  renderer:
    RendererCapabilityDeclaration;
  fidelity:
    ImageFormationFidelityProfile;
}
```

## PRODUCTION_CAPTURE_SNAPSHOT_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PRODUCTION_CAPTURE_SNAPSHOT_VERSION =
  "0.3.0" as const
```

## PRODUCTION_IMAGE_FORMATION_PLAN_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PRODUCTION_IMAGE_FORMATION_PLAN_VERSION =
  "0.7.0" as const
```

## ProductionCaptureSnapshot

Frozen state for one capture event. It links the capture, release, scene and
output IDs, the physical aperture, shutter and ISO, the scene time in seconds
and an explicit uint32 seed. Optional focus, white-balance and timing
bindings record their exact resolved state. This is a description of the
capture, not the generated image. If a UI value changes later, make a new
snapshot; never change a capture that is already planned.

```ts
export interface ProductionCaptureSnapshot {
  version:
    typeof PRODUCTION_CAPTURE_SNAPSHOT_VERSION;
  captureId: string;
  releaseFrameId: string;
  sceneStateId: string;
  sceneTimeSecondsFromExposureStart:
    number;
  outputStateId: string;
  exposure: {
    aperture: number;
    shutterSeconds: number;
    iso: number;
  };
  stochasticSeedUint32: number;
  releaseFrameBinding?:
    ProductionReleaseFrameBinding;
  whiteBalanceState?:
    ResolvedWhiteBalanceState;
  physicalSceneSample?:
    ProductionPhysicalSceneSample;
  temporalCapture?:
    ProductionTemporalCaptureInput;
  fingerprint: {
    algorithm:
      "fnv1a-32-non-cryptographic";
    value: string;
  };
}
```

## ProductionEnvironmentCaptureInput

Runs the existing bounded environment capture inside the plan. The callback is
synchronous local provider code and is never serialized. Replay is tied to the
returned provider samples and the realized RAW, not to the function's identity.

```ts
export interface ProductionEnvironmentCaptureInput {
  capture: SimulateEnvironmentSensorRawFrameInput;
  /** Optional post-capture policy. Only execution supplies the RAW source. */
  processing?: Omit<ProcessedSensorRawInput, "reconstruction"> & {
    reconstruction: Omit<ProcessedSensorRawInput["reconstruction"], "rawFrame">;
  };
}
```

## ProductionImageFormationBlocker

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionImageFormationBlocker {
  code:
    ProductionImageFormationBlockerCode;
  message: string;
  stageId?: ImageFormationStageId;
  effectId?: ImageFormationEffectId;
}
```

## ProductionImageFormationBlockerCode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ProductionImageFormationBlockerCode =
  | "environment-capture-evaluation-blocked"
  | "processed-output-evaluation-blocked"
  | "engine-stage-not-composed"
  | "engine-effect-not-composed"
  | "renderer-stage-unsupported"
  | "renderer-effect-unsupported"
  | "renderer-spectral-capability-insufficient"
  | "renderer-sensor-domain-processing-unavailable"
  | "renderer-depth-capability-insufficient"
  | "renderer-inverse-field-mapping-required"
  | "renderer-premultiplied-alpha-required"
  | "renderer-depth-order-preservation-required"
  | "missing-optical-bridge-profile"
  | "missing-physical-scene-sample"
  | "undeclared-field-throughput-effect"
  | "physical-radiometry-evaluation-blocked"
  | "missing-temporal-capture-input"
  | "temporal-evaluation-blocked"
  | "missing-camera-rotation-model"
  | "missing-lens-field-mapping"
  | "missing-sensor-readout-timing"
  | "renderer-temporal-sampling-insufficient";
```

## ProductionImageFormationPlan

Immutable record, owned by the engine, of what the scientific pipeline did.
Check the status and blockers before using any requested stage. Each stage
says whether it ran, was modelled as zero, was left out for fidelity, or had
unsupported inputs. Optional environment and processed results carry their
exact child lineage; sample-only routes keep their upstream blockers.
Versions identify independent contracts. The fingerprint is a canonical FNV
key for reproducibility; it does not protect against tampering. A replay also
needs identical provider responses. No renderer callback is serialized.

```ts
export interface ProductionImageFormationPlan {
  version:
    typeof PRODUCTION_IMAGE_FORMATION_PLAN_VERSION;
  status: "ready" | "blocked";
  versions: {
    engineApi: typeof ENGINE_API_VERSION;
    imageFormationContract:
      typeof IMAGE_FORMATION_CONTRACT_VERSION;
    plan:
      typeof PRODUCTION_IMAGE_FORMATION_PLAN_VERSION;
    preparedContext:
      typeof PREPARED_IMAGE_FORMATION_CONTEXT_VERSION;
    captureSnapshot:
      typeof PRODUCTION_CAPTURE_SNAPSHOT_VERSION;
    rendererCapability:
      typeof RENDERER_CAPABILITY_SCHEMA_VERSION;
    fidelityProfile:
      typeof IMAGE_FORMATION_FIDELITY_PROFILE_SCHEMA_VERSION;
    scientificAssurance:
      typeof SCIENTIFIC_ASSURANCE_CONTRACT_VERSION;
  };
  contextIdentity: {
    contextId: string;
    preparedContextFingerprint:
      string;
  };
  captureIdentity: {
    captureId: string;
    releaseFrameId: string;
    sceneStateId: string;
    releaseSequenceId?: string;
    releaseFrameIndex?: number;
    whiteBalanceStateId?: string;
    captureSnapshotFingerprint:
      string;
  };
  rendererIdentity: {
    rendererId: string;
    rendererVersion: string;
    consumerKind:
      RendererConsumerKind;
  };
  fidelityIdentity: {
    profileId: string;
    profileVersion: string;
  };
  stagePlan:
    readonly PlannedImageFormationStage[];
  effectPlan:
    readonly PlannedImageFormationEffect[];
  blockers:
    readonly ProductionImageFormationBlocker[];
  /** Non-cryptographic fingerprint of the execution data. Does not include the callback's identity. */
  environmentCaptureRequestFingerprint?: string;
  /** Lineage of the executed, bounded path from light source to ADC. The provider's transport is not verified. */
  environmentCaptureResult?: ReturnType<typeof simulateEnvironmentSensorRawFrame>;
  processedOutputResult?: ReturnType<typeof calculateProcessedSensorRaw>;
  physicalSceneToSensorResult?:
    SceneToSensorIrradianceResult;
  temporalCaptureResult?:
    ProductionTemporalCaptureResult;
  scientificAssurance?:
    ComposedScientificAssurance;
  stochastic: {
    captureSeedUint32: number;
    backendRandomnessMayRedefineScientificResult:
      false;
  };
  immutableCaptureSnapshot: true;
  legacyPocModified: false;
  fingerprint: {
    algorithm:
      "fnv1a-32-non-cryptographic";
    value: string;
    purpose:
      "deterministic-reproducibility-key-not-integrity-security";
  };
}
```

## ProductionPhysicalSceneSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionPhysicalSceneSample {
  sceneRadianceRequest:
    SceneRadianceEvaluationRequest;
  sceneRadianceResult:
    SceneRadianceEvaluationResult;
  focus:
    OpticalBridgeFocusContext;
  imagePointMm: {
    x: number;
    y: number;
  };
  fieldThroughput:
    OpticalBridgeFieldThroughput;
  frontOfLensFilters?:
    readonly FrontOfLensFilterProfile[];
}
```

## ProductionProcessedOutputInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionProcessedOutputInput {
  /** Explicit binding of numeric raster/crop policy to the committed output state. */
  outputStateId: string;
  processing: ProcessedSensorRawInput;
}
```

## ProductionReleaseFrameBinding

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionReleaseFrameBinding {
  releaseSequenceVersion:
    typeof RELEASE_SEQUENCE_VERSION;
  sequenceId: string;
  releaseFrameId: string;
  frameIndex: number;
  exposure: {
    aperture: number;
    shutterSeconds: number;
    iso: number;
  };
  stochasticSeedUint32: number;
  exposureStartTimeSeconds: number;
  exposureEndTimeSeconds: number;
  sceneTimeSecondsFromSequenceStart:
    number;
  startIntervalFromPreviousSeconds:
    number | null;
  timingConstraints:
    readonly ReleaseTimingConstraint[];
  focus:
    ResolvedReleaseFrame["focus"];
  automation:
    ResolvedReleaseFrame["automation"];
  whiteBalanceStateId?: string;
}
```

## ProductionTemporalCaptureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionTemporalCaptureInput {
  exposureWindowInput:
    CalculateCaptureExposureWindowsInput;
  imagingArea: SensorImagingArea;
  orientation: CaptureOrientation;
  readout?:
    SensorReadoutTimingDeclaration;
  /**
   * Optional explicit link from sensor readout to exposure timing. With the electronic
   * rolling-shutter model, the exposure-window schedule must equal
   * resolveElectronicRollingShutterExposureSchedule(readout). Then every per-site exposure window
   * (and the rotation time sampling) includes the per-line offset.
   */
  readoutExposureLinkage?: {
    kind: "electronic-rolling-shutter-line-reset-read";
    evidence: readonly EvidenceProvenance[];
  };
  rotation?: {
    angularVelocityRadPerSec:
      CameraAngularVelocityRadPerSec;
    focusDistanceM?: number;
    temporalSampleCount: number;
  };
}
```

## ProductionTemporalCaptureResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProductionTemporalCaptureResult {
  exposureWindows:
    CaptureExposureWindows;
  sensorReadoutTiming?:
    SensorReadoutTiming;
  rotationQuadrature?:
    CaptureRotationTemporalQuadrature;
  exposureTimeReference:
    "first-opening-boundary-phase";
  readoutExposureSynchronization:
    | "not-assumed"
    | "electronic-rolling-shutter-line-linked";
  sensorReadoutTimingRemainsSeparate:
    true;
  temporalRadianceIntegrated:
    false;
}
```

## RENDERER_CAPABILITY_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
RENDERER_CAPABILITY_SCHEMA_VERSION =
  "0.1.0" as const
```

## RendererCapabilityDeclaration

Plain-data declaration of what one rendering backend supports: scientific
domains, stages and effects, and its time-sample budget. It is validated
metadata. It is not executable renderer code and not proof of physical
correctness. If a capability is unknown or not enough, the requested
fidelity is blocked before any trusted provider code runs. Interactive and
reference backends keep the same committed science even when their fidelity
differs.

```ts
export interface RendererCapabilityDeclaration {
  schemaVersion:
    typeof RENDERER_CAPABILITY_SCHEMA_VERSION;
  rendererId: string;
  rendererVersion: string;
  consumerKind: RendererConsumerKind;
  supportedStages:
    readonly ImageFormationStageId[];
  supportedEffects:
    readonly ImageFormationEffectId[];
  spectralCapability:
    | "wavelength-resolved"
    | "wavelength-independent-approximation";
  temporalSampling:
    | {
        kind: "none";
      }
    | {
        kind: "bounded";
        maximumSamples: number;
      };
  depthCapability:
    | "none"
    | "per-layer";
  inverseFieldMapping: boolean;
  alphaRepresentation:
    | "premultiplied"
    | "straight";
  preservesDepthOrderAcrossWarps:
    boolean;
  sensorDomainProcessing: boolean;
}
```

## RendererConsumerKind

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type RendererConsumerKind =
  | "interactive-optimized"
  | "reference";
```

## RequiredImageFormationEffect

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface RequiredImageFormationEffect {
  effectId: ImageFormationEffectId;
  modelId: string;
  modelVersion: string;
}
```

## serializeProductionImageFormationPlan

Returns deterministic canonical JSON for a validated production plan. Object keys are sorted;
array order is kept. The JSON holds data only and leaves out provider callbacks. The plan version
and its fingerprint (recomputed over the content) must match, so an empty or edited object is
rejected instead of serialized.

The planner decides the order of the scientific stages, fixes each capture's identity so it cannot
change, and makes results reproducible. A well-formed but unsupported combination returns
structured blockers. A malformed declaration throws. The bounded environment route runs the
supplied radiance through native RAW and, optionally, output processing. The sample-only and
attached-RAW routes keep blockers for the upstream stages they lack. FNV fingerprints are keys for
reproducibility, not cryptographic proof of integrity.

```ts
export function serializeProductionImageFormationPlan(
  plan:
    ProductionImageFormationPlan
): string;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
