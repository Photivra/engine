# capture/capture-export-metadata.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## CAPTURE_EXPORT_METADATA_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
CAPTURE_EXPORT_METADATA_SCHEMA_VERSION = "0.1.0" as const
```

## CaptureExportArtifactIdentity

Resource and saved-file UUIDs supplied by the caller. The engine never makes random IDs or reads the clock.

```ts
export interface CaptureExportArtifactIdentity { documentId: string; instanceId: string }
```

## CaptureExportMetadataInput

Input for pairing metadata only. The committed capture must already have a non-nil UUID as its CaptureID.

```ts
export interface CaptureExportMetadataInput {
  capture: SimulatedCapture;
  workflow: CaptureExportWorkflow;
  /** UTC time of the capture event, exactly YYYY-MM-DDTHH:mm:ss.sssZ. It is never scene time. */
  capturedAtUtc: string;
  raw: CaptureExportArtifactIdentity;
  jpeg: CaptureExportArtifactIdentity;
}
```

## CaptureExportMetadataPair

Matching metadata and distinct resource IDs do not prove that the JPEG pixels came from the RAW.

```ts
export interface CaptureExportMetadataPair {
  schemaVersion: typeof CAPTURE_EXPORT_METADATA_SCHEMA_VERSION;
  shared: CaptureExportSharedMetadata;
  raw: CaptureExportArtifactIdentity & { outputRole: "raw" };
  jpeg: CaptureExportArtifactIdentity & { outputRole: "jpeg" };
  imageDataPairing: "not-verified";
}
```

## CaptureExportSharedMetadata

The shared values, before they are packed into EXIF or DNG tags or an XMP packet.

```ts
export interface CaptureExportSharedMetadata {
  captureId: string;
  capturedAtUtc: string;
  workflow: CaptureExportWorkflow;
  digitalSourceTypeUri: string;
  simulatedCapture: true;
  make: "Photivra";
  model: "Photivra Virtual Camera";
  /** The engine API version that made the capture. It does not claim to be an npm package version. */
  software: string;
  creatorTool: string;
  engineApiVersion: string;
  captureContractVersion: SimulatedCapture["schemaVersion"];
  sceneStateId: string;
  sceneTimeSeconds: number;
  exposure: SimulatedCapture["exposure"];
  focus: SimulatedCapture["focus"];
  equivalentFocalLength35Mm: number;
  geometry: SimulatedCapture["geometry"];
  resolvedGeometry: SimulatedCapture["resolvedGeometry"];
  noise: SimulatedCapture["noise"];
  whiteBalanceIntent: SimulatedCapture["whiteBalanceIntent"];
  models: SimulatedCapture["models"];
}
```

## CaptureExportWorkflow

Only non-generative workflows. Sampled, AI-generated or composite media would need a separate, reviewed policy.

```ts
export type CaptureExportWorkflow = "human-directed-non-generative" | "fully-procedural-non-generative";
```

## createCaptureExportMetadataPair

Builds the known capture metadata once, for both the RAW and JPEG writers. It never encodes or checks image data.

```ts
export function createCaptureExportMetadataPair(input: CaptureExportMetadataInput): CaptureExportMetadataPair;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseCaptureExportMetadataInput

Strict parser. It rejects missing values and never fills in a default workflow, time, creator, physical device or file history.

```ts
export function parseCaptureExportMetadataInput(value: unknown): CaptureExportMetadataInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
