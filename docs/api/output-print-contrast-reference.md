# output/print-contrast-reference.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePrintContrastReference

Estimates the detection threshold from the published model, within its limited range. It does not claim that detail is invisible to any particular person.

```ts
export function calculatePrintContrastReference(value: PrintContrastReferenceInput): CalculationResult<PrintContrastReference>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePrintContrastReferenceInput

Strictly parses and copies the explicit reference conditions. No defaults are filled in to imply an observer.

```ts
export function parsePrintContrastReferenceInput(value: unknown): PrintContrastReferenceInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PRINT_CONTRAST_REFERENCE_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PRINT_CONTRAST_REFERENCE_MODEL_VERSION = "0.1.0" as const
```

## PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION

Identifies the exact MIT-licensed model source. It is not a local calibration.

```ts
PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION = "f4b0b722af83001d7af979281e06ca642d36e4e8" as const
```

## PrintContrastReference

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PrintContrastReference {
  referenceId: string;
  engineApiVersion: string;
  modelVersion: typeof PRINT_CONTRAST_REFERENCE_MODEL_VERSION;
  upstreamRevision: typeof PRINT_CONTRAST_REFERENCE_UPSTREAM_REVISION;
  input: PrintContrastReferenceInput;
  status: "model-estimate" | "unsupported";
  blockers: string[];
  estimate: { contrastSensitivity: number; thresholdModulationMichelson: number; suppliedModulationToModelThresholdRatio: number } | null;
  observerApplicability: "population-reference-unverified-for-individual";
  naturalImageVisibility: "unassessed";
  printStimulusMatch: "unassessed";
  uncertainty: "not-quantified";
  overallPrintVerdict: "not-offered";
}
```

## PrintContrastReferenceInput

The narrow reference stimulus. It is separate from any measured photographic region of interest (ROI).
Positive values outside the model's range return "unsupported" instead of being extrapolated.

```ts
export interface PrintContrastReferenceInput {
  referenceId: string;
  stimulus: "static-neutral-d65-gabor";
  observer: "published-binocular-natural-pupil-reference";
  /** Mean luminance of the uniform D65 background and grating. Not the average of a photographic ROI. */
  meanLuminanceCdPerSquareMeter: number;
  spatialFrequencyCyclesPerDegree: number;
  gaussianEnvelopeSigmaDegrees: number;
  temporalFrequencyHz: number;
  eccentricityDegrees: number;
  /** Fractional amplitude of the neutral grating before the Gaussian envelope. Not taken from ROI minimum and maximum values. */
  modulationMichelson: number;
}
```
