# output/print-region-statistics.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePrintRegionDifference

Measures how processing changed aligned samples. The residual is not automatically compression or noise.

```ts
export function calculatePrintRegionDifference(value: PrintRegionDifferenceInput): CalculationResult<PrintRegionStatisticsAssessment<PrintRegionDifferenceInput, PrintRegionDifferenceMeasurement>>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculatePrintRegionNoise

Measures the sample variance over time at each site (n-1 denominator), separately from spatial scene texture.

```ts
export function calculatePrintRegionNoise(value: PrintRegionNoiseInput): CalculationResult<PrintRegionStatisticsAssessment<PrintRegionNoiseInput, PrintRegionNoiseMeasurement>>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## MAX_PRINT_REGION_STATISTICS_SAMPLES

Maximum number of single-channel samples across all frames and references in one request.

```ts
MAX_PRINT_REGION_STATISTICS_SAMPLES = MAX_PRINT_DETAIL_REGION_SAMPLES
```

## parsePrintRegionDifferenceInput

Parses and copies an untrusted request that pairs two single-channel ROIs.

```ts
export function parsePrintRegionDifferenceInput(v: unknown): PrintRegionDifferenceInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePrintRegionNoiseInput

Parses and copies an untrusted set of repeat captures, with a limit on the total number of samples.

```ts
export function parsePrintRegionNoiseInput(v: unknown): PrintRegionNoiseInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PRINT_REGION_STATISTICS_MODEL_VERSION

Version of this protocol. Independent of the package version and of the print-detail protocol.

```ts
PRINT_REGION_STATISTICS_MODEL_VERSION = "0.1.0" as const
```

## PrintRegionDifferenceInput

Compares the same sample sites before and after processing, from the same noise draw.
A known range is a declared reference signal range, never a clipping threshold.

```ts
export interface PrintRegionDifferenceInput {
  assessmentId: string;
  before: PrintRegionRaster;
  after: PrintRegionRaster;
  purpose: "processing-change" | "decoded-file-change";
  realizationPolicy: "same-noise-realization" | "deterministic-reference";
  referenceRange: { lowerRelativeLuminance: number; upperRelativeLuminance: number } | null;
}
```

## PrintRegionDifferenceMeasurement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintRegionDifferenceMeasurement {
  meanSignedDifferenceRelativeLuminance: number;
  rmsDifferenceRelativeLuminance: number;
  maximumAbsoluteDifferenceRelativeLuminance: number;
  /** Null unless the caller supplied a reference range. It does not classify halos. */
  rangeExcursions: {
    beforeBelowRangeCount: number;
    beforeAboveRangeCount: number;
    afterBelowRangeCount: number;
    afterAboveRangeCount: number;
    beforeMaximumUndershootRelativeLuminance: number;
    beforeMaximumOvershootRelativeLuminance: number;
    afterMaximumUndershootRelativeLuminance: number;
    afterMaximumOvershootRelativeLuminance: number;
  } | null;
}
```

## PrintRegionNoiseInput

Statistics at aligned sites across separately acquired repeat captures.
Stationarity and independence are declared by the caller. A single frame is never treated as a noise sample set.

```ts
export interface PrintRegionNoiseInput {
  assessmentId: string;
  ensembleId: string;
  stationarySceneId: string;
  repeatPolicy: "independent-stationary-captures";
  frames: readonly PrintRegionRaster[];
}
```

## PrintRegionNoiseMeasurement

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintRegionNoiseMeasurement {
  frameCount: number;
  siteCount: number;
  meanRelativeLuminance: number;
  /** Mean of per-site sample variances with n-1 denominator, in squared linear units. */
  meanTemporalSampleVarianceRelativeLuminanceSquared: number;
  temporalRmsRelativeLuminance: number;
  /** Kept separate so scene texture and fixed-pattern variation are not mislabelled as temporal noise. */
  perSiteMeansRelativeLuminance: readonly number[];
  perSiteSampleVariancesRelativeLuminanceSquared: readonly number[];
}
```

## PrintRegionRaster

An exact, unwarped, single-channel linear region of interest (ROI). Checking the samples and their hash is up to the caller.

```ts
export interface PrintRegionRaster {
  print: PrintPlanInput;
  source: PrintDetailSource;
  region: PrintDetailRegion;
  samples: readonly number[];
}
```

## PrintRegionStatisticsAssessment

The measurements are diagnostics only. They are not a physical noise calibration or a print verdict.

```ts
export interface PrintRegionStatisticsAssessment<TInput, TMeasurement> {
  assessmentId: string;
  engineApiVersion: string;
  modelVersion: typeof PRINT_REGION_STATISTICS_MODEL_VERSION;
  input: TInput;
  status: "diagnostic-only" | "blocked" | "unsupported";
  blockers: string[];
  print: PrintPlan;
  measurement: TMeasurement | null;
  sourceArtifactVerification: "caller-declared-unverified";
  acquisitionQualification: "unassessed";
  uncertainty: "not-quantified";
  overallPrintVerdict: "not-offered";
}
```
