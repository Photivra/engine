# capture/photographic-export.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateProcessedSensorRaw

Reconstructs the exact attached RAW, develops colour and WB once, corrects, orients and crops, and encodes SDR. No file or display I/O.

```ts
export function calculateProcessedSensorRaw(input: ProcessedSensorRawInput): CalculationResult<ProcessedSensorRawResult>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createPhotographicExportPair

Writes one RAW capture as a lossless, uncompressed CFA DNG and a separately encoded baseline JPEG.
Shared metadata comes from the committed capture. Orientation, WB and rendering never rewrite the
native RAW codes.

The DNG keeps one revalidated native RAW frame (after the ADC) unchanged. The JPEG develops that same
frame through explicit reconstruction, an approximate sensor-channel colour and WB conversion, and SDR
rendering. File identity and RAW data identity are separate. Hashing is asynchronous; input data is
copied before the first await. The full sensor is limited to 4096 sites.

```ts
export async function createPhotographicExportPair(input: PhotographicExportInput, options: PhotographicExportOptions = {}): Promise<PhotographicExportPair>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.

## ExportSensorColorProfile

Explicit, approximate conversion from normalized camera channels to scene XYZ (D65). Never guessed from RGB or CFA channel names.

```ts
export interface ExportSensorColorProfile {
  schemaVersion: "0.1.0";
  profileId: string;
  profileVersion: string;
  colorSamplingProfileId: string;
  channelIds: readonly ["red", "green", "blue"];
  scientificStatus: "approximation";
  referenceIlluminant: "D65";
  normalizedCameraChannelsToXyz: Matrix;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
}
```

## parseExportSensorColorProfile

Validates the separately supplied numeric colour-profile evidence, and ties the approximate profile to the exact CFA profile.

```ts
export function parseExportSensorColorProfile(value: unknown): ExportSensorColorProfile;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parsePhotographicExportInput

Adds file metadata and encoding checks to the shared RAW processing settings.

```ts
export function parsePhotographicExportInput(value: unknown): PhotographicExportInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## parseProcessedSensorRawInput

Revalidates one attached RAW snapshot and the explicit processing settings.

Crop sampling and reconstruction coverage problems fail here, before per-pixel work. Passing this
check does not prove kernel support at the edges, correction support or that the file can be encoded;
those are still checked during execution. The input is copied. No file or display code runs.

```ts
export function parseProcessedSensorRawInput(value: unknown): ProcessedSensorRawInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## PHOTOGRAPHIC_EXPORT_PIPELINE_VERSION

Version of the RAW and processed pipeline, recorded in XMP.

0.2.0: development scales to the effective white level, handles saturation, and fixes WB for colour
matrices that are not white-normalized. DNG output fixes WhiteLevel, AsShotNeutral and BlackLevel/CFA
phase, and adds the DNG 1.4 tags ForwardMatrix1, BaselineExposure, NoiseProfile and AnalogBalance.

```ts
PHOTOGRAPHIC_EXPORT_PIPELINE_VERSION = "0.2.0" as const
```

## PHOTOGRAPHIC_EXPORT_SCHEMA_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
PHOTOGRAPHIC_EXPORT_SCHEMA_VERSION = "0.1.0" as const
```

## PhotographicExportInput

Optional export settings. The engine uses no files, clocks, randomness, network or external encoder.

```ts
export interface PhotographicExportInput {
  reconstruction: RawFrameReconstructionInput;
  colorProfile: ExportSensorColorProfile;
  whiteBalance: "not-required" | "apply-resolved-sensor-gains";
  rendering: SdrRenderingProfile;
  metadata: Omit<CaptureExportMetadataInput, "capture">;
  /** Public scene ID and version declared by the caller. They must match the committed scene state. */
  sceneProfile: { id: string; version: string; sceneStateId: string };
  /** JPEG constant quantization step, 1..255. It is not an imitation of a manufacturer's "quality" scale. */
  jpegQuantizationStep: number;
  /** Optional lens correction in native optical coordinates, applied after colour. JPEG only; the RAW records it as information. */
  correction?: CaptureCorrectedSdrInput["correction"];
  /** How RAW highlights are handled before WB; default `clip`. See `prepareSensorColorDevelopment`. */
  highlightMode?: RawHighlightMode;
}
```

## PhotographicExportOptions

Options for {@link createPhotographicExportPair}.

```ts
export interface PhotographicExportOptions {
  /** Aborting rejects with a domain error at the next step. No partial pair is returned. */
  signal?: AbortSignal;
}
```

## PhotographicExportPair

The byte arrays belong to the caller and can be changed. IDs and hashes refer to the exact bytes as first returned.

```ts
export interface PhotographicExportPair {
  schemaVersion: typeof PHOTOGRAPHIC_EXPORT_SCHEMA_VERSION;
  metadata: CaptureExportMetadataPair;
  simulationHashAlgorithm: "sha-256";
  simulationHash: string;
  rawDataUniqueId: string;
  uniqueCameraModel: string;
  source: CalculationResult<RawFrameReconstruction>;
  rendering: CalculationResult<SdrRenderingResult>;
  nativeDefaultCrop: RasterRect;
  /** The JPEG's rectangle in the oriented output. It never replaces the RAW's default crop. */
  processedOutputView: { rect: RasterRect; pixelWidth: number; pixelHeight: number };
  correction: CalculationResult<CaptureCorrectedSdrResult> | null;
  rawCorrectionIntent: CalculationResult<ResolvedLensCorrectionPlan> | null;
  /** RAW saturation handled before WB in the JPEG development. */
  highlight: RawHighlightDiagnostics;
  imageDataPairing: "jpeg-generated-from-exact-attached-raw";
  dng: { mediaType: "image/dng"; bytes: Uint8Array; sha256: string };
  jpeg: { mediaType: "image/jpeg"; bytes: Uint8Array; sha256: string };
  interoperability: "independent-decode-required-editor-validation-pending";
}
```

## PROCESSED_SENSOR_RAW_MODEL_VERSION

Version of the `processed-sensor-raw-sdr` model (0.2.0: scaling to effective white, saturation and WB fixes).

```ts
PROCESSED_SENSOR_RAW_MODEL_VERSION = "0.2.0" as const
```

## ProcessedSensorRawInput

Explicit RAW development settings (after the ADC), shared by the preview and the file output.

```ts
export type ProcessedSensorRawInput = Pick<PhotographicExportInput,
  "reconstruction" | "colorProfile" | "whiteBalance" | "rendering" | "correction" | "highlightMode">;
```

## ProcessedSensorRawResult

Processing record for the preview and JPEG, derived from the exact attached native RAW.

Each step (reconstruction, colour, WB, correction, rendering) reports its input and output domains and
its own clipping and cost diagnostics. The output view is oriented and cropped SDR. The native default
crop and the physical capture history are unchanged. The returned arrays are the pixels before file
encoding, not a decoded (lossy) JPEG.

```ts
export interface ProcessedSensorRawResult {
  inputDomain: "post-adc-native-sensor-raw";
  colorProfile: ExportSensorColorProfile;
  whiteBalancePolicy: ProcessedSensorRawInput["whiteBalance"];
  outputDomain: "output-referred-srgb-d65-sdr";
  physicalCaptureModified: false;
  displayAdaptationApplied: false;
  whiteBalance: "applied-here" | "not-required";
  source: CalculationResult<RawFrameReconstruction>;
  rendering: CalculationResult<SdrRenderingResult>;
  nativeDefaultCrop: RasterRect;
  processedOutputView: PhotographicExportPair["processedOutputView"];
  correction: CalculationResult<CaptureCorrectedSdrResult> | null;
  rawCorrectionIntent: CalculationResult<ResolvedLensCorrectionPlan> | null;
  /** RAW saturation handled before WB, over the developed image. */
  highlight: RawHighlightDiagnostics;
}
```
