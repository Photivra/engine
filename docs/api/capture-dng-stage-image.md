# capture/dng-stage-image.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## developDngStageImage

Builds the stage-2 (CFA) or stage-3 (LinearRaw) image of an imported DNG, normalized 0..1, interleaved by sample.

```ts
export function developDngStageImage(raw: ImportedDngRaw, options: DevelopDngStageImageOptions = {}): DngStageImageResult;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## DevelopDngStageImageOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DevelopDngStageImageOptions {
  /** The output the development is for ("srgb-8" or "srgb-16" on screen; "dng", "jpeg" or "png" exports). Default "png" (full quality). */
  format?: "srgb-8" | "srgb-16" | "dng" | "jpeg" | "png";
  /** The speed-versus-accuracy choice (WarpRectilinear resampling); default from `format` (fast on screen, full for exports). */
  fast?: boolean;
  /** Apply the opcode lists (default true). */
  opcodes?: boolean;
}
```

## DngStageImageResult

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface DngStageImageResult extends DngStageImage {
  /** 3 for LinearRaw (every opcode list applied), 2 for a CFA mosaic (OpcodeList3 left to the caller). */
  stage: 2 | 3;
  /** The resolved `fast` and where it came from. */
  fast: { requested: boolean; defaultedFrom: "request" | "format" };
  /** What was applied and what was not. */
  assumptions: string[];
}
```
