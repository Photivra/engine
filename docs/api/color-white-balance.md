# color/white-balance.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION =
  "0.1.0" as const
```

## ColorTemperatureWhiteBalanceCameraModel

Camera colour model used to turn a declared white into channel gains.

```ts
export interface ColorTemperatureWhiteBalanceCameraModel {
  profileId: string;
  profileVersion: string;
  /** Row-major CIE XYZ (white Y = 1) → relative pre-WB camera-linear RGB. */
  xyzToCameraRgb: ColorMatrix3x3;
}
```

## ColorTemperatureWhiteBalanceIntent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ColorTemperatureWhiteBalanceIntent {
  version: typeof COLOR_TEMPERATURE_WHITE_BALANCE_INTENT_VERSION;
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
  channelGainsResolved: false;
  requiresCameraProfileColorimetry: true;
  sceneIlluminationModified: false;
}
```

## createColorTemperatureWhiteBalanceIntent

Records independent color-temperature and tint intent.

No channel gains are fabricated here; use
`resolveColorTemperatureWhiteBalance()` with an explicit camera colour model to
resolve gains.

```ts
export function createColorTemperatureWhiteBalanceIntent(
  input: CreateColorTemperatureWhiteBalanceIntentInput
): ColorTemperatureWhiteBalanceIntent;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateColorTemperatureWhiteBalanceIntentInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateColorTemperatureWhiteBalanceIntentInput {
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
}
```

## createLockedWhiteBalanceState

Freezes a resolved WB state under a new stable identity.

Locking changes neither the scene nor the gains. Later AWB estimates may
differ, but this locked state stays the same.

```ts
export function createLockedWhiteBalanceState(
  input: CreateLockedWhiteBalanceStateInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CreateLockedWhiteBalanceStateInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CreateLockedWhiteBalanceStateInput {
  stateId: string;
  sourceState: ResolvedWhiteBalanceState;
}
```

## estimateAutoWhiteBalance

Estimates one global AWB state from declared pre-WB camera-linear samples.

It deliberately does not accept metadata about the true illuminant. A
grey-world neutralizing estimate is softened by the profile's
correctionStrength, so different generic AWB priorities can keep different
amounts of colour cast.

```ts
export function estimateAutoWhiteBalance(
  input: EstimateAutoWhiteBalanceInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateAutoWhiteBalanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateAutoWhiteBalanceInput {
  stateId: string;
  profile: WhiteBalanceProfile;
  policyId: string;
  sampleSet: PreWhiteBalanceRgbSampleSet;
}
```

## parseResolvedWhiteBalanceState

Parses a committed, resolved white-balance state from untrusted JSON,
without estimating WB again.

This is deliberately a state parser, not an AWB estimator. It keeps the
resolved gains, policy and measurement identity that a capture committed
earlier.

```ts
export function parseResolvedWhiteBalanceState(
  value: unknown
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseWhiteBalanceProfile

Parses generic WB presets and AWB policies.

The profile defines preset gains and AWB correction strength. A label is not
treated as a universal Kelvin value or as any manufacturer's behaviour.

```ts
export function parseWhiteBalanceProfile(
  value: unknown
): WhiteBalanceProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PreWhiteBalanceRgbSample

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PreWhiteBalanceRgbSample {
  sampleId: string;
  red: number;
  green: number;
  blue: number;
  weight: number;
  clipped: boolean;
}
```

## PreWhiteBalanceRgbSampleSet

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PreWhiteBalanceRgbSampleSet {
  imageStateId: string;
  inputDomain: WhiteBalanceInputDomain;
  samples: readonly PreWhiteBalanceRgbSample[];
}
```

## resolveColorTemperatureWhiteBalance

Resolves a Kelvin + tint WB intent into camera channel gains, for an explicit camera
colour model:
- white xy = locus(CCT), offset by Duv = tint along the Planckian-locus normal in CIE 1960 uv;
- camera neutral n = M_XYZ→camera · XYZ(white, Y = 1);
- gains = (n_G/n_R, 1, n_G/n_B).
A neutral surface lit by light of exactly that chromaticity then renders with equal channels.
The CCT and tint are the white the photographer declares, not a measured scene illuminant.
Accuracy is limited by the camera matrix (exact only under the Luther–Ives condition) and by
the locus model.

```ts
export function resolveColorTemperatureWhiteBalance(
  input: ResolveColorTemperatureWhiteBalanceInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveColorTemperatureWhiteBalanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveColorTemperatureWhiteBalanceInput {
  stateId: string;
  intent: ColorTemperatureWhiteBalanceIntent;
  /** Locus whose temperature defines the white: Planckian or CIE daylight. */
  whiteLocus: WhiteLocus;
  /** Tint is read as Duv in the CIE 1960 UCS (positive = above the Planckian locus, greenish). */
  tintInterpretation: "duv-cie-1960-uv";
  /** Defaults to Planck's law integrated against the engine's analytic CIE 1931 CMFs (`planck-analytic-cmf`). */
  planckianLocus?: PlanckianLocusModel;
  camera: ColorTemperatureWhiteBalanceCameraModel;
}
```

## resolveCustomWhiteBalance

Resolves a user-declared neutral/gray custom-WB measurement.

The engine validates and reduces the selected pre-WB sample, but it does not
claim the selected object is spectrally neutral in the real scene.

```ts
export function resolveCustomWhiteBalance(
  input: ResolveCustomWhiteBalanceInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveCustomWhiteBalanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveCustomWhiteBalanceInput {
  stateId: string;
  sampleSet: PreWhiteBalanceRgbSampleSet;
}
```

## ResolvedColorTemperatureWhiteBalance

Locus/tint interpretation and camera neutral behind a Kelvin + tint WB state.

```ts
export interface ResolvedColorTemperatureWhiteBalance {
  intentId: string;
  colorTemperatureKelvin: number;
  tint: number;
  whiteLocus: WhiteLocus;
  tintInterpretation: "duv-cie-1960-uv";
  planckianLocusModel: "planck-analytic-cmf" | "planck-integration";
  /** CIE 1931 xy of the declared white (CCT + Duv). */
  adoptedWhiteChromaticity: CieXyChromaticity;
  /** Pre-WB camera response to that white (XYZ with Y = 1 through xyzToCameraRgb). */
  cameraNeutralRgb: WhiteBalanceChannelGains;
}
```

## ResolvedWhiteBalanceState

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvedWhiteBalanceState {
  version: typeof WHITE_BALANCE_STATE_VERSION;
  stateId: string;
  inputDomain: WhiteBalanceInputDomain;
  source:
    | "preset"
    | "manual-gains"
    | "custom-measurement"
    | "auto-white-balance"
    | "color-temperature";
  channelGains: WhiteBalanceChannelGains;
  locked: boolean;
  sourceProfile?: {
    profileId: string;
    profileVersion: string;
  };
  presetId?: string;
  awbPolicy?: {
    policyId: string;
    intent: WhiteBalanceAwbIntent;
    correctionStrength: number;
  };
  measurement?: {
    imageStateId: string;
    usableSampleCount: number;
    rejectedClippedSampleCount: number;
    weightedMeanPreWbSignal: {
      red: number;
      green: number;
      blue: number;
    };
  };
  /** Present for `color-temperature` states: the declared CCT/tint and its camera neutral. */
  colorTemperature?: ResolvedColorTemperatureWhiteBalance;
  sourceStateId?: string;
  trueIlluminantMetadataUsed: false;
  sceneIlluminationModified: false;
  rawCaptureDestructivelyModified: false;
  physicalExposureModified: false;
  focusModified: false;
  limitations: readonly string[];
}
```

## resolveManualWhiteBalance

Resolves explicit manual camera-linear channel gains.

```ts
export function resolveManualWhiteBalance(
  input: ResolveManualWhiteBalanceInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolveManualWhiteBalanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolveManualWhiteBalanceInput {
  stateId: string;
  channelGains: WhiteBalanceChannelGains;
}
```

## resolvePresetWhiteBalance

Resolves a WB preset defined by the profile. No universal label-to-Kelvin rule is applied.

```ts
export function resolvePresetWhiteBalance(
  input: ResolvePresetWhiteBalanceInput
): ResolvedWhiteBalanceState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ResolvePresetWhiteBalanceInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ResolvePresetWhiteBalanceInput {
  stateId: string;
  profile: WhiteBalanceProfile;
  presetId: string;
}
```

## WHITE_BALANCE_PROFILE_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
WHITE_BALANCE_PROFILE_SCHEMA_VERSION = "0.1.0" as const
```

## WHITE_BALANCE_STATE_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
WHITE_BALANCE_STATE_VERSION = "0.1.0" as const
```

## WhiteBalanceAwbIntent

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type WhiteBalanceAwbIntent =
  | "neutral-priority"
  | "standard"
  | "ambience-preserving";
```

## WhiteBalanceAwbPolicy

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface WhiteBalanceAwbPolicy {
  policyId: string;
  intent: WhiteBalanceAwbIntent;
  /**
   * How much of a grey-world neutralizing correction to apply, measured in
   * logarithmic gain space. 1 applies the full correction (neutral priority).
   * Lower values keep more of the observed colour cast.
   */
  correctionStrength: EvidenceBackedFact<number>;
  limitations?: readonly string[];
}
```

## WhiteBalanceChannelGains

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface WhiteBalanceChannelGains {
  red: number;
  green: number;
  blue: number;
}
```

## WhiteBalanceInputDomain

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type WhiteBalanceInputDomain =
  "relative-pre-wb-camera-linear-rgb";
```

## WhiteBalancePresetDefinition

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface WhiteBalancePresetDefinition {
  presetId: string;
  label: string;
  channelGains: EvidenceBackedFact<WhiteBalanceChannelGains>;
  nominalColorTemperatureKelvin?: number;
  nominalTint?: number;
  limitations?: readonly string[];
}
```

## WhiteBalanceProfile

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface WhiteBalanceProfile {
  schemaVersion: typeof WHITE_BALANCE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  profileVersion: string;
  scientificStatus: "approximation";
  inputDomain: WhiteBalanceInputDomain;
  presets: readonly WhiteBalancePresetDefinition[];
  awbPolicies: readonly WhiteBalanceAwbPolicy[];
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```
