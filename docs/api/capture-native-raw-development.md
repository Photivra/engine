# capture/native-raw-development.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## createNativeRawDevelopmentTask

Creates a native RAW development task.

It checks that every CFA phase has a reconstruction kernel and that every kernel neighbourhood is
available, takes ownership of the packed RAW (without copying where supported), and renders 256-pixel
output tiles with the fast typed kernel. Development scales each site to its CFA phase's effective white
level, clips flagged or white-level sites before white balance, and applies the selected highlight mode
(see `prepareSensorColorDevelopment`).

The RAW numbers are checked in bounded chunks at the start of `run()`, with host yields, so creating the
task costs only as much as reading the metadata. The task yields to the host at chunk and tile boundaries
once about 8 ms of work has passed since the last yield, and after the final tile. Yield timing never
changes the output.

`provider` is `{ yieldControl, onProgress? }`, the same shape as the other native task providers. A bare
yield function is still accepted in 2.x but is deprecated.

The tile width used at capture is kept when rebuilding the exact packed plan. That width changes neither
CFA or noise-seed coordinates nor the developed pixels, and says nothing about transport or what a device
can handle.

```ts
export function createNativeRawDevelopmentTask(input: NativeRawDevelopmentInput,
  provider: NativeRawDevelopmentProvider | ((signal:AbortSignal)=>Promise<void>)): NativeRawDevelopmentTask;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS

Accepted range of `NativeRawDevelopmentInput.exposureCompensationStops` and `simulateCapture`'s `output.exposureCompensationStops` (#556).

```ts
NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS = Object.freeze({ minimum: -2, maximum: 5 } as const)
```

## NativeRawDevelopmentInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawDevelopmentInput {
  /**
   * Packed RAW. Ownership passes to the task. On creation its five typed arrays are detached with
   * `ArrayBuffer.prototype.transfer` (no copy; the caller's arrays become length 0), or copied when
   * the runtime has no `transfer`. The developed output hands back the same RAW, now owned by the output.
   */
  raw: NativeRawOutput;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
  colorProfile: ExportSensorColorProfile;
  whiteBalance: "not-required" | "apply-resolved-sensor-gains";
  rendering: SdrRenderingProfile;
  /** Highlight handling. `clip` (default): clipped highlights become neutral. `reconstruct`: the documented blend toward neutral. */
  highlightMode?: RawHighlightMode;
  /**
   * Frame-edge handling. `reject` (default): every reconstruction neighbourhood must lie inside the
   * native RAW frame. `mirror`: a site outside the frame is read from its mirror image (reflect-101,
   * edge not repeated). This is allowed only when the mirrored site has the same CFA colour, which is
   * always true for a 2×2 Bayer pattern. Interior pixels are unchanged.
   */
  borderHandling?: RawReconstructionBorderHandling;
  /**
   * Development exposure push in stops (#556), from {@link NATIVE_RAW_DEVELOPMENT_EXPOSURE_RANGE_STOPS} −2 to +5; default 0.
   * Each site's black-subtracted, white-normalized value is multiplied by 2^stops before demosaic, white balance, the
   * highlight mode, colour and the tone curve, like a raw editor's exposure slider. A site whose pushed value reaches the
   * white level is clipped there and counted as saturated (so `highlightMode: "reconstruct"` rolls it off); values below
   * black stay signed. The RAW codes are not changed. 0 (or omitted) develops exactly as before, byte for byte.
   */
  exposureCompensationStops?: number;
  /** Counts the kept packed RAW plus the integer output. It does not count caller buffers, process heap or GPU memory. */
  maximumRetainedPayloadBytes: number;
}
```

## NativeRawDevelopmentOutput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawDevelopmentOutput {
  raw: NativeRawOutput;
  phaseProfiles: readonly RawFrameReconstructionPhaseProfile[];
  colorProfile: ExportSensorColorProfile;
  whiteBalance: NativeRawDevelopmentInput["whiteBalance"];
  width: number;
  height: number;
  integerSamples: Uint8Array | Uint16Array;
  diagnostics: SdrRenderingResult["diagnostics"];
  highlight: RawHighlightDiagnostics;
  borderHandling: RawReconstructionBorderHandling;
  outputEncoding: SdrRenderingResult["outputEncoding"];
  rendering: SdrRenderingProfile;
  displayAdaptation: SdrRenderingResult["displayAdaptation"];
  imageDataPairing: "derived-from-exact-packed-native-raw";
  producerOriginVerified: false;
}
```

## NativeRawDevelopmentProvider

Host callbacks, the same shape as the other native task providers but without a tile reader.

```ts
export interface NativeRawDevelopmentProvider {
  /** Must yield to the host event loop, so cancellation and input events can run between tiles. */
  yieldControl(signal: AbortSignal): Promise<void>;
  /** Optional callback after each committed 256-pixel output tile. It cannot change the output. */
  onProgress?(progress: NativeTaskProgress): void;
}
```

## NativeRawDevelopmentTask

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface NativeRawDevelopmentTask {
  readonly state: NativeRawTaskState;
  readonly completedTileCount: number;
  readonly totalTileCount: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  takeOutput(): NativeRawDevelopmentOutput;
}
```

## RawHighlightDiagnostics

RAW saturation handled before white balance. Counts are pixels or samples of the developed output.

```ts
export interface RawHighlightDiagnostics {
  /** #602: "reconstruct-neighbors" from `simulateCapture`'s whole-image neighbor reconstruction. */
  mode: RawHighlightMode | "reconstruct-neighbors";
  /** Output pixels with at least one contributing site at or above its white level, or flagged as saturated. */
  saturatedPixelCount: number;
  /** `clip`: WB-scaled samples clipped at the smallest gain. Always 0 for `reconstruct`. */
  whiteBalanceClippedSampleCount: number;
  /** `reconstruct`: pixels blended toward neutral. Always 0 for `clip`. */
  reconstructedPixelCount: number;
}
```
