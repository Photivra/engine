# facade/chart-radiance-batch.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateChartRadianceBatch

Float64 CPU reference: every query's value(s), row-major (query, column).

```ts
export function calculateChartRadianceBatch(input: ChartRadianceBatchInput): { plan: ChartRadianceBatchPlan; values: Float64Array };
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateChartRadianceBatchPlan

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export function calculateChartRadianceBatchPlan(input: ChartRadianceBatchInput): ChartRadianceBatchPlan;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CHART_RADIANCE_BATCH_LIMITS

`maximumQueries` is the default batch limit; a request may raise it with its own `maximumQueries`, up to `ceilingQueries`.

```ts
CHART_RADIANCE_BATCH_LIMITS = Object.freeze({ maximumQueries: 24_000_000, ceilingQueries: FULL_RESOLUTION_CEILING_PIXELS, maximumWavelengths: 256,
  maximumChannels: 4 })
```

## CHART_RADIANCE_BATCH_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CHART_RADIANCE_BATCH_SCHEMA_VERSION = "0.1.0" as const
```

## ChartRadianceBatchInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ChartRadianceBatchInput {
  schemaVersion: typeof CHART_RADIANCE_BATCH_SCHEMA_VERSION;
  /** An engine chart preset, or (#477) a declared `material-layers` scene: a chart under shape-mask layers. Caller scene functions are not supported here. */
  scene: ChartScene | ChartMaterialLayerScene;
  illuminant: CaptureIlluminant;
  illuminanceLux: number;
  /** Frame height / width. */
  aspect: number;
  /** Frame points, interleaved [u0, v0, u1, v1, …]. Finite. */
  points: Float32Array | Float64Array;
  /** The wavelengths the queries use, in nanometres (1–256). */
  wavelengthsNanometers: readonly number[];
  /** Radiance queries: one wavelength index per point. Exactly one of this and `channelWeights`. */
  wavelengthIndices?: Uint8Array | Uint16Array;
  /** Spectral integration: per channel (1–4), one finite weight per wavelength. */
  channelWeights?: readonly (readonly number[])[];
  /**
   * Optional opt-in batch limit: an integer from 1 to `CHART_RADIANCE_BATCH_LIMITS.ceilingQueries`. Default
   * `CHART_RADIANCE_BATCH_LIMITS.maximumQueries` (24 000 000). It does not change the values.
   */
  maximumQueries?: number;
}
```

## ChartRadianceBatchPlan

Validated plan with the resolved chart, illuminant and irradiance scale. Arrays are borrowed.

```ts
export interface ChartRadianceBatchPlan {
  /** The resolved chart; with a `material-layers` scene, the chart under the layers. */
  chart: ResolvedChartScene;
  /** The resolved layers of a `material-layers` scene, or null for a chart preset. */
  layers: ResolvedChartMaterialLayers | null;
  /** Every material a query can resolve to: the chart's, then each layer's background and ink. */
  materials: ResolvedChartScene["materials"];
  illuminant: ResolvedCaptureIlluminant;
  irradianceScale: number;
  queryCount: number;
  /** Output values per query: 1 for radiance queries, the channel count for spectral integration. */
  columns: number;
  mode: "radiance" | "spectral-integral";
  wavelengthsNanometers: readonly number[];
  channelWeights: readonly (readonly number[])[] | null;
  /** Spectral radiance of one material at a wavelength: the provider's own radianceAt for that material. */
  materialRadiance(material: number, wavelengthNanometers: number): number;
  /** The reference value of one query and output column (radianceAt, and its wavelength-ordered sum). */
  queryValue(points: Float32Array | Float64Array, wavelengthIndices: Uint8Array | Uint16Array | undefined, query: number, column: number): number;
}
```

## mapEnvironmentDirectionsToChartPoints

Frame points of environment-direction queries on the chart plane, exactly as the planar provider's
`evaluateRadiance` computes them: look direction l = −o, plane point l·distance/l.z, in frame units.

```ts
export function mapEnvironmentDirectionsToChartPoints(input: { directions: Float32Array | Float64Array; distanceM: number; metresPerFrameUnit: number }): Float64Array;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
