# facade/quality-paths.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/photivra/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## prepareQualityPaths

Loads the engine's on-demand full-quality code now instead of at the first request that needs it (#594): the CPU Quality kit
(diffraction, the capture's AHD demosaic, `lens.defocus` beyond the geometric disc, the image-space provider of lens projection,
distortion and vignetting, the display view's coupled tone, reconstruct and desaturation steps, the neighbor highlight
reconstruction), the opt-in kit (`sensor.profile`, `illumination`, `motion.subject`) and the display view's GPU full-quality code
(the Quality passes behind `prepareDisplayView(…, { gpu: "auto" | "require" })`), together with the GPU session it builds on.

Optional: without it, the first request that needs the code loads it. Safe to call at any time and from any number of places:
concurrent calls share one load, and a call after it loaded resolves at once and loads nothing. It changes no result. If the
load fails (for example a chunk download error) the promise rejects with `ImageKernelExecutionError` reason
`quality-code-unavailable`; nothing is remembered, so a later call or request tries again, and a render in the meantime runs
the CPU reference, labelled with that reason. A bundler that splits dynamic imports keeps this code out of the first load
whether or not this function is imported.

```ts
export function prepareQualityPaths(): Promise<void>;
```

This call is asynchronous; byte hashing uses the caller runtime's Web Crypto.
