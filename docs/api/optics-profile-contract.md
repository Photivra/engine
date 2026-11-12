# optics/profile-contract.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## GenericOpticalEvidence

Evidence for a generic approximation. It never implies a measured calibration.

```ts
export interface GenericOpticalEvidence {
  kind: "generic-parametric";
  basis: string;
  residualNote: string;
  sources: readonly EvidenceProvenance[];
}
```

## OpticalProfileState

Exact, generic camera, lens and acquisition state. Nothing is interpolated implicitly.

```ts
export interface OpticalProfileState {
  bodyId: string;
  bodyVersion: string;
  lensId: string;
  lensVersion: string;
  focalLengthMm: number;
  aperture: number;
  focusDistanceM: number;
  captureMode: "still" | "video";
  outputWidth: number;
  outputHeight: number;
  frameRateHz: number;
  stabilizationMode: string;
}
```

## parseOpticalProfileState

Parses a complete exact-state binding, including still, video and output settings.

```ts
export function parseOpticalProfileState(value: unknown): OpticalProfileState;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
