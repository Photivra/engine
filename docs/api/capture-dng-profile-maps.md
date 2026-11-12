# capture/dng-profile-maps.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## applyDngProfileGainTableMap

Applies ProfileGainTableMap(2): at each pixel the weight t = clamp(w·(R, G, B, min, max)·2^BaselineExposure, 0, 1)^γ selects a
gain by linear interpolation at t·N in the table (index clamped to N − 1, SDK), bilinear between map points at the pixel centre's
relative position (held at the map's edges); R, G and B are multiplied by it.

```ts
export function applyDngProfileGainTableMap(input: ApplyDngProfileGainTableMapInput): void;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ApplyDngProfileGainTableMapInput

Options of {@link applyDngProfileGainTableMap}.

```ts
export interface ApplyDngProfileGainTableMapInput {
  /** Linear ProPhoto (RIMM, D50) RGB, white-balanced, 1 = clipping white; changed in place. */
  image: DngRgbImage;
  map: DngProfileGainTableMap;
  /** BaselineExposure (stops) not yet applied to `image`: the weight is scaled by 2^stops, as the SDK does. Default 0. */
  baselineExposureStops?: number;
  /** Where `image` sits in the stage-3 (ActiveArea) image the map spans. Default: `image` is the whole stage-3 image. */
  region?: { x: number; y: number; stageWidth: number; stageHeight: number };
  /** Keep values above 1 (true) or clip to 0..1 (false, the SDR default). */
  overrange?: boolean;
}
```

## applyDngRgbTables

Applies RGBTables: each table maps ProPhoto RGB into its own primaries (clipped to 0..1, the clipped-off part kept and added back
when GamutExtension is "extend"), encodes it with the table's gamma, interpolates tetrahedrally in the 3D table, decodes and maps
back (SDK `RefRGBtoRGBTable3D`). The background table (empty name) applies to the whole image. Weighted sum: each masked table's
result weighted by its mask, the background (the background table's result, or the input) by 1 − min(1, Σ masks), normalized.
Sequential: each table in file order, blended into the running image by its mask (the background table by 1 − min(1, Σ other masks)).
A table whose mask is not supplied is skipped (as the SDK skips a name with no SemanticMask); the returned notes say so.

```ts
export function applyDngRgbTables(input: ApplyDngRgbTablesInput): string[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ApplyDngRgbTablesInput

Options of {@link applyDngRgbTables}.

```ts
export interface ApplyDngRgbTablesInput {
  /** ProPhoto-primaries RGB after the tone curve, 0..1; changed in place. */
  image: DngRgbImage;
  tables: DngRgbTables;
  /** Semantic masks by name (values 0..1, any size; stretched over the image with bilinear interpolation). */
  masks?: readonly { name: string; width: number; height: number; data: Float32Array }[];
}
```

## DngProfileGainTableMap

A parsed ProfileGainTableMap(2): N gains at each of V × H map points, decoded to 32-bit floats.

```ts
export interface DngProfileGainTableMap {
  /** 1 for ProfileGainTableMap (52525), 2 for ProfileGainTableMap2 (52544). */
  version: 1 | 2;
  pointsV: number; pointsH: number; spacingV: number; spacingH: number; originV: number; originH: number;
  /** MapPointsN: the table length at each map point. */
  tablePoints: number;
  /** MapInputWeights for red, green, blue, min(R,G,B) and max(R,G,B). */
  inputWeights: [number, number, number, number, number];
  /** PGTM2: the weight's gamma (1 for version 1). */
  gamma: number;
  /** Gains, row-major (v, h, table point). */
  gains: Float32Array;
}
```

## DngRgbImage

An RGB image, interleaved (row, column, channel).

```ts
export interface DngRgbImage { width: number; height: number; data: Float32Array }
```

## DngRgbTable

One table of RGBTables: a 3D table of `divisions`³ RGB samples (16-bit, 65535 = 1).

```ts
export interface DngRgbTable {
  /** TableSemanticName: the semantic mask it applies within; "" for the background table (the whole image). */
  semanticName: string;
  divisions: number;
  gamma: "linear" | "srgb" | "1.8" | "2.2" | "rec2020";
  primaries: "srgb" | "adobe-rgb" | "display-p3" | "rec2020" | "prophoto";
  gamut: "clip" | "extend";
  /** RGB per node, red slowest then green then blue, length divisions³ × 3. */
  samples: Uint16Array;
}
```

## DngRgbTables

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngRgbTables { compositeMethod: "weighted-sum" | "sequential"; tables: DngRgbTable[] }
```

## parseDngProfileGainTableMap

Parses ProfileGainTableMap (version 1) or ProfileGainTableMap2 (version 2). Layout: MapPointsV, MapPointsH (LONG), MapSpacingV,
MapSpacingH, MapOriginV, MapOriginH (DOUBLE), MapPointsN (LONG), MapInputWeights (5 FLOAT); version 2 adds DataType (LONG: 0 uint8,
1 uint16, 2 float16, 3 float32), Gamma, GainMin, GainMax (FLOAT); then the gains. Integer gains are GainMin + (x/max)·(GainMax −
GainMin). A single map point on an axis has spacing 1 and origin 0 (SDK).

```ts
export function parseDngProfileGainTableMap(bytes: Uint8Array, littleEndian: boolean, version: 1 | 2): DngProfileGainTableMap;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseDngRgbTables

Parses RGBTables (52543): table count (LONG, at most 20; 0 means none), CompositeMethod (LONG: 0 weighted sum, 1 sequential), then
per table LengthTableSemanticName (SHORT), the name's bytes, Divisions, PixelType (0 uint8, 1 uint16, 2 float32), GammaEncoding
(0 linear, 1 sRGB, 2 γ 1.8, 3 γ 2.2, 4 Rec. 2020), ColorPrimaries (0 sRGB, 1 Adobe RGB, 2 P3, 3 Rec. 2020, 4 ProPhoto) and
GamutExtension (0 clip, 1 extend), each a BYTE, then Divisions³ RGB samples (uint8 scaled by 256, float scaled by 65535).

```ts
export function parseDngRgbTables(bytes: Uint8Array, littleEndian: boolean): DngRgbTables | null;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
