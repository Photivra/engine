# sensor/readout-exposure-linkage.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessReadoutExposureTimingLinkage

Checks an explicitly declared link between the rolling readout scan and one
or more electronic exposure-boundary scans.

This is deliberately weaker than time synchronization. It can show that two
schedules sweep the native sensor in the same order (or in reverse), but not
when readout happens relative to the start or end of exposure.

The total data-readout time is kept for diagnostics and never used to check
the link. The readout skew and the boundary sweep time may differ; their
ratio is reported without implying a shared clock.

```ts
export function assessReadoutExposureTimingLinkage(
  input: AssessReadoutExposureTimingLinkageInput
): CalculationResult<ReadoutExposureTimingLinkageAssessment>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## AssessReadoutExposureTimingLinkageInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface AssessReadoutExposureTimingLinkageInput {
  nativeRaster: NativeImageRaster;
  activeCaptureRect?: RasterRect;
  shutterMechanism: CaptureShutterMechanism;
  readout: SensorReadoutTimingDeclaration;
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  opening: ExposureBoundarySchedule;
  closing: ExposureBoundarySchedule;
  linkage: ReadoutExposureTimingLinkageDeclaration;
  samplePointsNative?: readonly RasterPoint[];
}
```

## createRollingShutterCaptureExposureSchedule

The exposure-schedule fields of a derived rolling-shutter schedule, without model metadata.

```ts
export function createRollingShutterCaptureExposureSchedule(
  schedule: ElectronicRollingShutterExposureSchedule
): Pick<CalculateCaptureExposureWindowsInput, "shutterMechanism" | "nominalExposureDurationSeconds" | "opening" | "closing">;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ELECTRONIC_ROLLING_SHUTTER_MODEL

Model identity of the electronic rolling-shutter (line reset → line read) exposure schedule.

```ts
ELECTRONIC_ROLLING_SHUTTER_MODEL = Object.freeze({
  id: "electronic-rolling-shutter-line-reset-read",
  version: "1.0.0"
} as const)
```

## ElectronicRollingShutterExposureSchedule

Exposure-window schedule of an electronic rolling shutter. Its `shutterMechanism`,
`nominalExposureDurationSeconds`, `opening` and `closing` fields form a complete exposure schedule, so
they can be passed as a native RAW / environment `exposureWindow` or spread into a production
`temporalCapture.exposureWindowInput` (see {@link createRollingShutterCaptureExposureSchedule}).

```ts
export interface ElectronicRollingShutterExposureSchedule {
  modelId: typeof ELECTRONIC_ROLLING_SHUTTER_MODEL.id;
  modelVersion: typeof ELECTRONIC_ROLLING_SHUTTER_MODEL.version;
  shutterMechanism: "electronic";
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  /** Line-reset scan: a native point at normalized scan position s starts integrating at s·τ. */
  opening: UniformLinearExposureBoundarySchedule;
  /** Line-read scan: the same point stops integrating at T + s·τ. */
  closing: UniformLinearExposureBoundarySchedule;
  /** Explicit linkage declaration accepted by {@link assessReadoutExposureTimingLinkage}. */
  linkage: Extract<ReadoutExposureTimingLinkageDeclaration, { kind: "spatial-phase-linked" }>;
  /** τ: offset between the first and last exposure starts (equal to the readout skew). */
  lineScanSkewSeconds: number;
  /** Every point integrates for exactly the nominal exposure duration T. */
  localExposureDurationSeconds: number;
  limitations: readonly string[];
}
```

## ReadoutExposureBoundaryId

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ReadoutExposureBoundaryId = "opening" | "closing";
```

## ReadoutExposureBoundarySpatialLink

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReadoutExposureBoundarySpatialLink {
  boundary: ReadoutExposureBoundaryId;
  /**
   * How the normalized position of the rolling readout scan relates to that
   * of the selected electronic exposure-boundary scan.
   *
   * "same": boundary normalized phase = readout normalized phase.
   * "reversed": boundary normalized phase = 1 - readout normalized phase.
   *
   * This does not establish absolute temporal synchronization.
   */
  phaseOrientation: ReadoutExposureSpatialPhaseOrientation;
  /**
   * Evidence for the link itself.
   *
   * The readout direction and timing, and the exposure-boundary direction and
   * timing, keep their own separate evidence.
   */
  evidence: readonly EvidenceProvenance[];
}
```

## ReadoutExposureBoundarySpatialLinkAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReadoutExposureBoundarySpatialLinkAssessment {
  boundary: ReadoutExposureBoundaryId;
  boundaryActuator: "electronic";
  phaseOrientation: ReadoutExposureSpatialPhaseOrientation;
  normalizedPhaseRelationship:
    | "boundary-phase-equals-readout-phase"
    | "boundary-phase-equals-one-minus-readout-phase";
  relationshipEvidence: readonly EvidenceProvenance[];
  readoutDirectionNative: NativeSensorReadoutScanDirection;
  boundaryDirectionNative: NativeSensorReadoutScanDirection;
  /**
   * Rolling readout skew: time from the first to the last scan position.
   */
  readoutSpatialSamplingSkewSeconds: SourcedSensorTimingSeconds;
  /**
   * Time for the exposure boundary to sweep from first to last position.
   */
  boundaryTraversalDurationSeconds: SourcedCaptureTimingSeconds;
  /**
   * A descriptive ratio only. A value of 1 does not prove time
   * synchronization or a common clock origin.
   */
  boundaryTraversalToReadoutSpatialSkewRatio: number;
  absoluteTemporalAlignment: "not-established";
}
```

## ReadoutExposureSpatialPhaseOrientation

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ReadoutExposureSpatialPhaseOrientation =
  | "same"
  | "reversed";
```

## ReadoutExposureTimingLinkageAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ReadoutExposureTimingLinkageAssessment {
  linkageKind: ReadoutExposureTimingLinkageDeclaration["kind"];
  relationshipMeaning:
    | "no-readout-exposure-relationship-asserted"
    | "normalized-spatial-phase-relationship-asserted";
  readoutMode: "rolling" | "global";
  shutterMechanism: CaptureShutterMechanism;
  activeCaptureRect: RasterRect;
  absoluteTemporalAlignment: "not-established";
  /**
   * Data-readout time for the capture. Kept for diagnostics, but never used to
   * check an exposure-boundary link.
   */
  captureReadoutDurationSeconds: SourcedSensorTimingSeconds;
  links: readonly ReadoutExposureBoundarySpatialLinkAssessment[];
  componentProvenance: {
    sensorReadout: CalculationProvenance;
    exposureWindows: CalculationProvenance;
  };
}
```

## ReadoutExposureTimingLinkageDeclaration

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ReadoutExposureTimingLinkageDeclaration =
  | {
      /**
       * No link between readout and exposure is stated for this capture.
       * This is not evidence that the physical processes are independent.
       */
      kind: "unlinked";
      links?: never;
    }
  | {
      /**
       * One or more exposure boundaries are explicitly linked to the rolling
       * readout by their normalized position across the native sensor.
       */
      kind: "spatial-phase-linked";
      links: readonly ReadoutExposureBoundarySpatialLink[];
    };
```

## resolveElectronicRollingShutterExposureSchedule

Derives the exposure-window schedule of a fully electronic rolling shutter from its rolling readout
declaration.

In a CMOS rolling shutter, each line is reset, collects light for the exposure time T and is then
read. The reset pointer runs T ahead of the read pointer, and both move at the line rate (El Gamal &
Eltoukhy 2005; Liang, Chang & Chen 2008). With the uniform linear scan used throughout this engine, a
native point at normalized scan position s ∈ [0, 1] (along the declared scan direction, over the
active capture) collects light over [s·τ, s·τ + T], where τ is the declared first-to-last readout
skew. So both boundaries become uniform linear scans in the readout direction that take τ to sweep.

When this schedule feeds the per-site exposure windows, everything that samples motion, moving
sources or time-varying light at local exposure times (environment RAW, rotation quadrature,
temporal illumination integration) produces rolling-shutter skew, wobble, partial exposure and
flicker banding.

Approximation: constant line rate, no line-reset jitter, no hybrid of global reset with a mechanical
closing shutter, and the active-capture skew is declared by the caller (never scaled from a
full-frame value).

```ts
export function resolveElectronicRollingShutterExposureSchedule(
  input: ResolveElectronicRollingShutterExposureScheduleInput
): ElectronicRollingShutterExposureSchedule;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveElectronicRollingShutterExposureScheduleInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveElectronicRollingShutterExposureScheduleInput {
  /** Rolling readout declaration whose scan direction and spatial skew drive both exposure boundaries. */
  readout: RollingSensorReadoutTimingDeclaration;
  /** Per-line integration time between line reset and line read. */
  nominalExposureDurationSeconds: SourcedCaptureTimingSeconds;
  /**
   * Evidence that this capture uses a fully electronic, line-by-line (rolling) shutter whose reset
   * scan runs at the readout line rate. This explicit link is required before sensor readout timing
   * may set the exposure-window timing.
   */
  linkageEvidence: readonly EvidenceProvenance[];
}
```
