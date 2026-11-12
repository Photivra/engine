# capture/dng-raw-measurements.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateDngRawClipping

Clipping on the RAW: per color plane, the sites at the white level and near it (see the module comment).

```ts
export function calculateDngRawClipping(raw: ImportedDngRaw, options: CalculateDngRawClippingOptions = {}): DngRawClipping;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateDngRawClippingOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateDngRawClippingOptions {
  /**
   * Near-white margin, a fraction of the code span below the white level (default 0.01: x ≥ 0.99, the threshold of the #607 research's
   * real-file inventory). A threshold choice, not a property of the file. 0 to 0.25.
   */
  marginFraction?: number;
}
```

## DngRawClipping

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawClipping {
  region: ImportedDngRect;
  marginFraction: number;
  planes: DngRawClippingPlane[];
  /** CFA: the share of all sites at the white level; LinearRaw: the share of pixels with any sample at it. */
  fractionAtWhiteLevel: number;
  fractionNearWhiteLevel: number;
  /** "exact": a CFA mosaic, losslessly stored; "processed": LinearRaw (a converter's demosaic and processing came first); "lossy": a lossy source. */
  confidence: "exact" | "processed" | "lossy";
  /** The claim the numbers support, in words. */
  label: string;
  assumptions: string[];
}
```

## DngRawClippingPlane

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawClippingPlane {
  plane: number;
  color: string;
  sites: number;
  /** Sites whose linearized code reaches WhiteLevel (exact by definition). */
  atWhiteLevel: number;
  /** Sites at x ≥ 1 − marginFraction (includes `atWhiteLevel`). */
  nearWhiteLevel: number;
  fractionAtWhiteLevel: number;
  fractionNearWhiteLevel: number;
}
```

## DngRawNoise

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawNoise {
  region: ImportedDngRect;
  planes: DngRawNoisePlane[];
  /** "measured": the σ the data shows at typical signal; it may read high on fine texture (an upper bound there). */
  confidence: "measured";
  label: string;
  assumptions: string[];
}
```

## DngRawNoiseBin

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawNoiseBin { meanSignal: number; variance: number; blocks: number }
```

## DngRawNoisePlane

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRawNoisePlane {
  plane: number;
  color: string;
  /** Blocks kept after the range and smoothness screens, of all 2 × 2 blocks of this plane. */
  blocksKept: number;
  blocksTotal: number;
  bins: DngRawNoiseBin[];
  /** The fitted var(x) = scale·x + offset, or null when fewer than two bins remain. The offset is poorly determined (#607). */
  fit: { scale: number; offset: number } | null;
  /** The plane's median signal x, and σ there (null without a fit or for a variance ≤ 0). */
  medianSignal: number;
  sigmaAtMedian: number | null;
  /** σ at each requested level (null where the fitted variance is ≤ 0 or there is no fit). */
  sigmaAtLevels: { signal: number; sigma: number | null }[];
  /** The file's NoiseProfile σ at the median signal, and measured ÷ stated, or null without a NoiseProfile. */
  profileSigmaAtMedian: number | null;
  measuredToProfile: number | null;
}
```

## estimateDngRawNoise

Noise level from the RAW mosaic (see the module comment). Refuses LinearRaw (demosaiced noise is correlated) and lossy data.

```ts
export function estimateDngRawNoise(raw: ImportedDngRaw, options: EstimateDngRawNoiseOptions = {}): DngRawNoise;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## EstimateDngRawNoiseOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface EstimateDngRawNoiseOptions {
  /** Normalized signal levels x (0 < x < 1) at which to report σ, in addition to each plane's median signal. At most 32. */
  signalLevels?: readonly number[];
  /** Equal-count bins of block means (default 16, 2–64). */
  bins?: number;
  /** Minimum blocks per bin (default 200, 20–100 000). */
  minimumBlocksPerBin?: number;
}
```
