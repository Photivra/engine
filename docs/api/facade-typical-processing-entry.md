# facade/typical-processing-entry.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## simulateTypicalProcessing

#740: phone-style processing of a burst of DNG frames, as a simulation of typical stages (not of a specific device): the mean of the
frames before the demosaic, `developDngImage`'s development to linear sRGB, bilateral noise reduction, Durand–Dorsey local tone
mapping and a saturation gain in linear light, then `developDngImage`'s tone curve and sRGB encoding. Each stage is on with its
defaults unless set to `false`; with one frame and every stage `false` the result equals `developDngImage`'s bit for bit (the
plain side of a side-by-side). A simulated capture enters as its DNG (`output.format: "dng"`, one capture per `sensor.noiseSeed`
for a burst). `fast` follows the format default (fast for "srgb-8" and "srgb-16"); `fast: false` or `localToneMapping.fast: false`
runs the direct bilateral base, refused above 2 · 10¹¹ tap evaluations. Asynchronous; `provider` (default: the host yield) is the
processing tasks' `{ yieldControl, onProgress? }`. Its code loads on demand.

```ts
export async function simulateTypicalProcessing(input: SimulateTypicalProcessingInput, provider?: ProcessingProvider): Promise<TypicalProcessingResult>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
