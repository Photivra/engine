# capture/dng-opcodes.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## applyDngOpcodes

Applies an opcode list to a stage image in place (WarpRectilinear returns a new buffer in `image.data`). Returns one assumption
per opcode: what was applied, or why it was not.

```ts
export function applyDngOpcodes(image: DngStageImage, opcodes: readonly DngOpcode[], options: ApplyDngOpcodesOptions): string[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## ApplyDngOpcodesOptions

Options of {@link applyDngOpcodes}.

```ts
export interface ApplyDngOpcodesOptions {
  /** 1, 2 or 3: the list's stage (for the report). */
  stage: 1 | 2 | 3;
  /**
   * WarpRectilinear resampling: false (full quality) uses cubic convolution (Keys, a = −0.75, the DNG SDK's kernel); true uses
   * bilinear interpolation (fast). Registered as "dngImport.warpRectilinear" in SIMULATE_CAPTURE_FAST_METHODS.
   */
  fast: boolean;
  /** 1, or 0.5 for a half-size image: pixel-coordinate parameters are scaled; pitched areas and bad pixels are then not applied. */
  scale?: 1 | 0.5;
}
```

## DngOpcode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngOpcode {
  id: number;
  /** The specification's name, or "Unknown". */
  name: string;
  dngVersion: [number, number, number, number];
  /** Flag bit 0: a reader may skip it. */
  optional: boolean;
  /** Flag bit 1: may be skipped for preview-quality rendering. */
  previewSkip: boolean;
  /** Decoded parameters of an applied opcode; null for one this reader does not apply. */
  parameters: DngOpcodeParameters | null;
}
```

## DngOpcodeArea

The rectangle, plane range and pitch an area-based opcode acts on (stage pixel coordinates, bottom and right exclusive).

```ts
export interface DngOpcodeArea { top: number; left: number; bottom: number; right: number; plane: number; planes: number; rowPitch: number; colPitch: number }
```

## DngOpcodeParameters

Opcode parameters, by opcode.

```ts
export type DngOpcodeParameters =
  | { opcode: "WarpRectilinear"; planes: { radial: [number, number, number, number]; tangential: [number, number] }[]; centerX: number; centerY: number }
  | { opcode: "FixVignetteRadial"; coefficients: [number, number, number, number, number]; centerX: number; centerY: number }
  | { opcode: "FixBadPixelsConstant"; constant: number; bayerPhase: number }
  | { opcode: "FixBadPixelsList"; bayerPhase: number; points: [number, number][]; rects: [number, number, number, number][] }
  | { opcode: "MapTable"; area: DngOpcodeArea; table: Uint16Array }
  | { opcode: "MapPolynomial"; area: DngOpcodeArea; coefficients: number[] }
  | { opcode: "GainMap"; area: DngOpcodeArea; pointsV: number; pointsH: number; spacingV: number; spacingH: number; originV: number; originH: number; mapPlanes: number; gains: Float32Array }
  | { opcode: "DeltaPerRow" | "DeltaPerColumn" | "ScalePerRow" | "ScalePerColumn"; area: DngOpcodeArea; values: Float32Array };
```

## DngStageImage

A stage image: interleaved (row, column, plane), normalized values.

```ts
export interface DngStageImage { width: number; height: number; planes: number; data: Float32Array }
```

## parseDngOpcodeList

Parses an opcode list (the tag's bytes). Every count and length is checked against the bytes before allocation.

```ts
export function parseDngOpcodeList(bytes: Uint8Array): DngOpcode[];
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
