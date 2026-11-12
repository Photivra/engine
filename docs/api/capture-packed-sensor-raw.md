# capture/packed-sensor-raw.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculatePackedSensorRawPlan

Validates the request (every array value once) and returns its plan.

```ts
export function calculatePackedSensorRawPlan(input: PackedSensorRawInput): PackedSensorRawPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PACKED_SENSOR_RAW_LIMITS

`maximumRegionSites` is the default region limit; a request may raise it with its own `maximumRegionSites`, up to `ceilingRegionSites`.

```ts
PACKED_SENSOR_RAW_LIMITS = Object.freeze({
  maximumRegionSites: 24_000_000,
  ceilingRegionSites: FULL_RESOLUTION_CEILING_PIXELS,
  maximumNativeSites: 0xffffffff,
  maximumDimension: 65_535,
  maximumAdcBitDepth: 16,
  maximumReadNoiseComponents: 16,
  maximumAdditionalChargeComponents: 8
})
```

## PACKED_SENSOR_RAW_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PACKED_SENSOR_RAW_SCHEMA_VERSION = "0.1.0" as const
```

## PackedSensorAdditionalChargeComponent

One additional stored-charge component, realized after photo and dark charge in declaration order.

```ts
export interface PackedSensorAdditionalChargeComponent {
  componentId: string;
  /** `poisson` draws from the charge stream; `deterministic-expected-electron-equivalent` adds the expectation. */
  model: SensorAdditionalChargeSamplingModel;
  /** Expected electrons per region site, row-major. Finite, ≥ 0. */
  expectedElectrons: Float32Array | Float64Array;
}
```

## PackedSensorFixedPatternNoise

Optional fixed-pattern noise for a packed region. The colour-sampling site of native site (X, Y) is
(X + siteOrigin.x, Y + siteOrigin.y); the pattern is seeded from those coordinates, as in
`calculateSensorFixedPatternSite`.

```ts
export interface PackedSensorFixedPatternNoise {
  profile: SensorFixedPatternNoiseProfile;
  /** Must equal `profile.colorSamplingProfileId`. */
  colorSamplingProfileId: string;
  siteOrigin: { x: number; y: number };
}
```

## PackedSensorRawDiagnostics

Per-region saturation and clamp counts, as in the per-site readout diagnostics.

```ts
export interface PackedSensorRawDiagnostics {
  physicalSaturationSiteCount: number;
  preAdcSaturationSiteCount: number;
  digitalSaturationSiteCount: number;
  lowerClampSiteCount: number;
}
```

## PackedSensorRawInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PackedSensorRawInput {
  schemaVersion: typeof PACKED_SENSOR_RAW_SCHEMA_VERSION;
  /** Full native raster. Site seeds use the absolute index `(region.y + row) * nativeWidth + region.x + column`. */
  nativeWidth: number;
  nativeHeight: number;
  /** Region of the native raster to simulate, in native sites. */
  region: { x: number; y: number; width: number; height: number };
  /** The committed capture's noise seed (`capture.noise.seedUint32`). */
  captureSeedUint32: number;
  /** Expected photo-generated electrons per region site (EQE and local exposure applied), row-major. Finite, ≥ 0. */
  photoElectrons: Float32Array | Float64Array;
  /** Expected dark electrons per region site, row-major. Finite, ≥ 0. */
  darkElectrons: Float32Array | Float64Array;
  /** Physical charge storage capacity in electrons, the same at every site. */
  physicalChargeCapacityElectrons: number;
  readoutProfile: SensorReadoutConversionProfile;
  regimeId: string;
  /** Optional (2.0). */
  fixedPatternNoise?: PackedSensorFixedPatternNoise;
  /** Optional (2.0), at most 8. */
  additionalChargeComponents?: readonly PackedSensorAdditionalChargeComponent[];
  /**
   * Optional opt-in region limit for large sensors: an integer from 1 to `PACKED_SENSOR_RAW_LIMITS.ceilingRegionSites`.
   * Default `PACKED_SENSOR_RAW_LIMITS.maximumRegionSites` (24 000 000). It does not change the result.
   */
  maximumRegionSites?: number;
}
```

## PackedSensorRawPlan

Validated plan. Arrays are borrowed, not copied.

```ts
export interface PackedSensorRawPlan {
  nativeWidth: number;
  nativeHeight: number;
  region: Readonly<{ x: number; y: number; width: number; height: number }>;
  siteCount: number;
  captureSeedUint32: number;
  physicalChargeCapacityElectrons: number;
  readout: ResolvedSensorReadoutRegime;
  noiseModel: typeof SENSOR_RAW_PRODUCER_NOISE_MODEL;
  seedSchedule: "murmur3-capture-seed-native-index-stream-v2";
  /** Largest expected photo and dark electron counts in the region (before fixed-pattern factors). */
  maximumPhotoElectrons: number;
  maximumDarkElectrons: number;
  /** Parsed fixed-pattern profile and colour-site origin, or null. */
  fixedPatternNoise: Readonly<{ profile: SensorFixedPatternNoiseProfile; siteOrigin: Readonly<{ x: number; y: number }> }> | null;
  /** Additional components (identity, model and largest expectation); their arrays stay on the input. */
  additionalChargeComponents: readonly Readonly<{ componentId: string; model: SensorAdditionalChargeSamplingModel; maximumExpectedElectrons: number }>[];
}
```

## PackedSensorRawResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface PackedSensorRawResult {
  plan: PackedSensorRawPlan;
  /** RAW codes, row-major over the region. */
  codes: Uint16Array;
  diagnostics: PackedSensorRawDiagnostics;
}
```

## simulatePackedSensorRaw

Synchronous float64 reference for a bounded region. Use the image-kernel accelerator for large
regions, host yields or the `webgpu-f32` backend.

```ts
export function simulatePackedSensorRaw(input: PackedSensorRawInput): PackedSensorRawResult;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
