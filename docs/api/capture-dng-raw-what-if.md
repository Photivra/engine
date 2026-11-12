# capture/dng-raw-what-if.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## assessDngRawWhatIf

Whether a what-if is possible on this file, and every reason it is not (the same checks {@link simulateDngRawWhatIf} makes).

```ts
export function assessDngRawWhatIf(raw: ImportedDngRaw, request: DngRawWhatIfRequest): DngRawWhatIfAssessment;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DNG_WHAT_IF_MINIMUM_MEASURED_TO_PROFILE

A measured σ below this fraction of the NoiseProfile's means the file's noise was reduced after capture (design threshold; #607 phone RAW: 0.084).

```ts
DNG_WHAT_IF_MINIMUM_MEASURED_TO_PROFILE = 0.75
```

## DngRawWhatIfAssessment

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawWhatIfAssessment { allowed: boolean; refusals: DngRawWhatIfRefusal[] }
```

## DngRawWhatIfRefusal

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawWhatIfRefusal { reason: DngRawWhatIfRefusalReason; message: string }
```

## DngRawWhatIfRefusalReason

Why a what-if is refused.

```ts
export type DngRawWhatIfRefusalReason =
  | "not-a-mosaic" | "lossy-raw-data" | "no-noise-profile" | "half-size-preview" | "linearization-table"
  | "noise-profile-mismatch" | "iso-unknown" | "iso-below-photo" | "gain-mode-unknown" | "crosses-gain-switch";
```

## DngRawWhatIfRefusedError

A refused what-if: `refusals` lists every reason.

```ts
export class DngRawWhatIfRefusedError extends InvalidScientificInputError {
  readonly refusals: readonly DngRawWhatIfRefusal[];
  constructor(refusals: readonly DngRawWhatIfRefusal[]) {
    super("simulateDngRawWhatIf: " + refusals.map((r) => r.message).join(" "));
    this.name = "DngRawWhatIfRefusedError";
    this.refusals = refusals;
  }
}
```

## DngRawWhatIfRequest

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawWhatIfRequest {
  /**
   * Exposure change, stops (−10 to +10, default 0). Negative: less light reaches the sensor (a shorter shutter or smaller aperture),
   * simulated with consistent shot and read noise. Positive: "brightened in editing" (returned as `developmentPushStops`; the codes
   * keep their noise), never a longer exposure.
   */
  exposureStops?: number;
  /** The ISO setting to simulate, at least the photo's (default the photo's). With the same light the result is brighter. */
  iso?: number;
  /** The photo's ISO when the file does not state it (default `raw.exif.iso`). */
  sourceIso?: number;
  /**
   * The camera's dual-gain switch: the ISO setting from which it uses its high conversion gain, or null when it has one conversion
   * gain at every ISO. Needed for an ISO change (the file does not state it); an ISO change that crosses the switch is refused.
   */
  highGainFromIso?: number | null;
  /** uint32 seed of the added noise (deterministic: the same seed gives the same codes on every engine). */
  seed: number;
  /** Check the NoiseProfile against the measured noise and refuse a file whose noise was reduced (default true). */
  verifyNoiseProfile?: boolean;
}
```

## DngRawWhatIfResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawWhatIfResult {
  /** The simulated RAW: the same metadata with new codes and the target NoiseProfile (Exif still describes the original capture). */
  raw: ImportedDngRaw;
  /** "simulated-capture" (less light and/or a higher ISO), "brightened-in-editing" (only a push), both, or "unchanged". */
  kind: "simulated-capture" | "brightened-in-editing" | "simulated-capture-brightened-in-editing" | "unchanged";
  /** The label a preview must carry. */
  label: string;
  /** Light reaching the sensor relative to the photo (2^min(stops, 0)). */
  lightFactor: number;
  /** ISO relative to the photo (target ÷ photo ISO). */
  isoFactor: number;
  /** The push a development applies for a positive `exposureStops` (0 otherwise): brightened in editing, the same noise. */
  developmentPushStops: number;
  sourceIso: number | null;
  targetIso: number | null;
  /** Sites that reached the white level in the simulation and were below it in the photo. */
  newlyClippedSites: number;
  /** The measured ÷ stated σ of the check (green plane where there is one), or null when the check was off. */
  measuredToProfile: number | null;
  assumptions: string[];
}
```

## simulateDngRawWhatIf

The RAW of the same scene with less light and/or a higher ISO, seeded (see the module comment); a positive `exposureStops` is
returned as a development push, labeled "brightened in editing". Throws {@link DngRawWhatIfRefusedError} with every reason when the
file or the request cannot be shown accurately.

```ts
export function simulateDngRawWhatIf(raw: ImportedDngRaw, request: DngRawWhatIfRequest): DngRawWhatIfResult;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
