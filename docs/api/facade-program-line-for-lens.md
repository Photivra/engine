# facade/program-line-for-lens.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateProgramLine

The capture facade's generic program line for a lens's f-number range (#614), and the pair it chooses for a scene
brightness (EV100 or luminance) at a fixed ISO, without running a capture.

The line is the one `simulateCapture` uses in `exposure.mode: "program"` (f/16 1/2000 s … f/8 1/125 s … f/4 1.024 s,
limited to a range that does not hold f/4–f/16 by clamping its f/4 and f/16 to the range, #583), built by the same code, and
the pair is resolved by the same `resolveProgramAutoExposureMode` on the tier's capabilities with the lens range, so a
capture of a uniform scene metered at the same luminance chooses the same settings (tested). It is a generic educational
line (an approximation), not a manufacturer's program. Auto ISO is not offered here.

EV100 and luminance are related by the engine's standard exposure: L = 10·N²/(0.65·t·S) (CIPA DC-004-2020 §3.2 and §5.5).

Example: f/8–f/32 at ISO 100 gives the nodes f/16 1/2000 s, f/16 1/125 s, f/8 1/125 s, f/8 1.024 s.

```ts
export function calculateProgramLine(input: CalculateProgramLineInput): CalculationResult<ProgramLine>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateProgramLineInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateProgramLineInput {
  /** Generic tier whose body (shutter and ISO grids) and lens apply, as `simulateCapture`'s `camera`. Default "professional". */
  camera?: GenericEquipmentTier;
  /**
   * The lens's f-number range, as `lens.ideal`'s `widestFNumber`/`narrowestFNumber` (within `IDEAL_LENS_LIMITS`, the widest no
   * larger than the narrowest). Omitted: the tier lens, as a capture without a lens range.
   */
  lens?: { widestFNumber: number; narrowestFNumber: number };
  /** ISO setting (fixed ISO). Default 100. Must be one of the tier's ISO settings. */
  iso?: number;
  /**
   * Scene brightness as EV at ISO 100 (EV100) of the standard exposure: log2(N²/t) of the settings that expose luminance L at
   * the standard exposure at ISO 100, L = 10·2^EV100/(0.65·100) cd/m². Give this or `luminanceCdPerSquareMeter` to get `selection`.
   */
  ev100?: number;
  /** Scene (metered) luminance in cd/m², instead of `ev100`. */
  luminanceCdPerSquareMeter?: number;
}
```

## ProgramLine

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface ProgramLine {
  camera: GenericEquipmentTier;
  iso: number;
  /** The lens range used, or null for the tier lens. */
  lens: { widestFNumber: number; narrowestFNumber: number } | null;
  /** "facade-generic-program-line", or "facade-generic-program-line-lens-range" when the range limits the line (#583). */
  profileId: string;
  limitedToLensRange: boolean;
  /** The exposure anchor the line's stops are measured from (#569, #585). */
  reference: { aperture: number; shutterSeconds: number; iso: number };
  /** The line's nodes, from the most light (shortest exposure) to the least; the line is log2-interpolated between them. */
  nodes: readonly ProgramLineNode[];
  /** The chosen pair; present when `ev100` or `luminanceCdPerSquareMeter` was given. */
  selection?: ProgramLineSelection;
}
```

## ProgramLineNode

One node of the program line: a wanted aperture/shutter pair.

```ts
export interface ProgramLineNode {
  aperture: number;
  shutterSeconds: number;
  /** Exposure value of the pair, log2(N²/t). */
  exposureValue: number;
  /** The scene EV100 for which the pair is the standard exposure at the request's ISO: exposureValue − log2(iso/100). */
  sceneEv100: number;
  /** Optical exposure t/N² relative to the anchor, in stops (the resolver's node coordinate). */
  opticalExposureStopsFromReference: number;
}
```

## ProgramLineSelection

The pair Program mode chooses for the scene brightness.

```ts
export interface ProgramLineSelection {
  sceneEv100: number;
  luminanceCdPerSquareMeter: number;
  aperture: number;
  shutterSeconds: number;
  iso: number;
  /** Where the scene falls on the line: within it, or beyond an end where the resolver holds the end's settings. */
  position: ProgramLineSelectionDiagnostics["position"];
  /** The line's pair before the aperture and shutter snap to their grids. */
  idealAperture: number;
  idealShutterSeconds: number;
  apertureClamped: ProgramLineSelectionDiagnostics["apertureClamped"];
  shutterClamped: ProgramLineSelectionDiagnostics["shutterClamped"];
  /**
   * Deviation of the chosen settings from the standard exposure for the luminance, in stops (positive is darker: under),
   * as `simulateCapture`'s `exposure.standardExposureDeviationStops`. Beyond the line's ends with a fixed ISO it is not zero.
   */
  standardExposureDeviationStops: number;
}
```
