# output/print-detail.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePrintRegionDetail

Calculates the strength of one grating frequency in a region and its print reference scale.
How the image was acquired stays unknown. No MTF, noise, compression or perceptual pass is reported.

```ts
export function calculatePrintRegionDetail(value: PrintRegionDetailInput): CalculationResult<PrintRegionDetailAssessment>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MAX_PRINT_DETAIL_REGION_SAMPLES

Work limit for one dense region of interest (ROI). It does not say what a real device can handle.

```ts
MAX_PRINT_DETAIL_REGION_SAMPLES = 65536
```

## parsePrintRegionDetailInput

Parses and copies untrusted, bounded region, source and target data and the existing print geometry.
Unknown fields, sparse arrays and samples marked factual-reference-only are rejected.

```ts
export function parsePrintRegionDetailInput(value: unknown): PrintRegionDetailInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PRINT_REGION_DETAIL_MODEL_VERSION

Version of this metric and protocol. Independent of the engine version.

```ts
PRINT_REGION_DETAIL_MODEL_VERSION = "0.1.0" as const
```

## PrintDetailRegion

The selected half-open rectangle in the oriented, retained source image.
Depth is descriptive, in metres; null means unknown.

```ts
export interface PrintDetailRegion {
  id: string;
  rect: RasterRect;
  role: "selected-subject" | "field-diagnostic" | "intentional-defocus";
  subjectDistanceM: number | null;
  focusDistanceM: number | null;
}
```

## PrintDetailSource

The exact source image. The caller asserts the content hash and decoding; the engine does not check them.

```ts
export interface PrintDetailSource {
  captureId: string;
  representationId: string;
  contentSha256: string;
  raster: RasterDimensions;
  stage: "native-retained-linear" | "post-resampling-linear" | "post-encoding-decoded-linear";
  domain: "relative-linear-luminance" | "transfer-encoded-luma" | "unknown";
  registration: "oriented-retained-unwarped" | "correction-or-warp-unqualified";
  processing: { id: string; version: string };
  noiseRealizationId: string | null;
  evidence: readonly EvidenceProvenance[];
}
```

## PrintRegionDetailAssessment

Frozen result. It never reports a pass for the full system, artefacts, perception or print quality.

```ts
export interface PrintRegionDetailAssessment {
  assessmentId: string;
  engineApiVersion: string;
  modelVersion: typeof PRINT_REGION_DETAIL_MODEL_VERSION;
  input: PrintRegionDetailInput;
  status: "diagnostic-only" | "blocked" | "unsupported";
  blockers: string[];
  print: PrintPlan;
  measurement: PrintSinusoidalMeasurement | null;
  projection: {
    fieldPointMm: { x: number; y: number };
    frequencyCyclesPerMm: { x: number; y: number };
    physicalPeriodMm: number;
    angularPeriodAtImageCenterDegrees: number;
  } | null;
  assessedRasterMatchesRecommendation: boolean;
  sourceArtifactVerification: "caller-declared-unverified";
  assurance: ComposedScientificAssurance;
  unassessed: readonly ("captured-system-mtf" | "optical-motion-attribution" | "noise" | "aliasing" | "halos" | "compression" | "color" | "perceived-quality" | "printer-substrate")[];
  overallPrintVerdict: "not-offered";
}
```

## PrintRegionDetailInput

Input: single-channel, relative-linear ROI samples that are the caller's own or reusable data. No RGB or luma conversion is assumed.

```ts
export interface PrintRegionDetailInput {
  assessmentId: string;
  print: PrintPlanInput;
  source: PrintDetailSource;
  region: PrintDetailRegion;
  target: PrintSinusoidalTarget;
  samples: readonly number[];
}
```

## PrintSinusoidalMeasurement

Fitted coefficients for one declared grating. The residual is not a noise measurement.

```ts
export interface PrintSinusoidalMeasurement {
  meanRelativeLuminance: number;
  fundamentalAmplitudeRelativeLuminance: number;
  fundamentalModulation: number;
  declaredGratingTransfer: number;
  unexplainedResidualRmsRelativeToMean: number;
}
```

## PrintSinusoidalTarget

The target grating: a whole-number Fourier mode across the ROI (x right, y down), with any phase at the first ROI sample.
Input modulation is dimensionless, positive and at most one.

```ts
export interface PrintSinusoidalTarget {
  id: string;
  version: string;
  kind: "coherent-sinusoid";
  cyclesAcrossRegion: { x: number; y: number };
  referenceModulation: number;
}
```
