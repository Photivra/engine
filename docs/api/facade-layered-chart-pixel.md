# facade/layered-chart-pixel.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateLayeredChartSurfaceAtPixel

From 2.29.0 (#747): the surface of a layered chart scene that output pixel (x, y)'s centre sees through the request's lens, or null
where the pixel sees no scene (at 90° and beyond, or outside a circular fisheye's image circle). The lens is the rectilinear thin lens,
or a `projection` and `distortion` as `simulateCapture` takes them (`lens.catalogue` is not taken). The answer is the surface the
display view's pilot and metering read at that pixel (`calculateLayeredChartSurfaceAt` at the mapped frame point; `framePoint` is that
point, in the scene's units). `distanceM` is the distance along the axis, the value of a `finite-surface` focus target. Validation as
`calculateLayeredChartSurfaceAt`, and `InvalidConfigurationError` for an invalid lens, pixel or size.

```ts
export function calculateLayeredChartSurfaceAtPixel(input: LayeredChartSurfaceAtPixelInput): LayeredChartSurfaceAt | null;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## LayeredChartSurfaceAtPixelInput

The input of {@link calculateLayeredChartSurfaceAtPixel}: the request's values (see there).

```ts
export interface LayeredChartSurfaceAtPixelInput {
  scene: LayeredChartScene;
  /** The capture's output size, pixels. */
  output: { width: number; height: number };
  /** The output pixel, from the top-left (0 to width − 1, 0 to height − 1); its centre is mapped. */
  pixel: { x: number; y: number };
  /** The sensor's pixel pitch (the request's `sensor.pixelPitchMicrometers`, or its camera's). */
  sensor: { pixelPitchMicrometers: number };
  /** The request's lens: focal length, focus (default `subjectDistanceM`), and its `projection` and `distortion` when it has them. */
  lens: { focalLengthMm: number; focusDistanceM?: number; projection?: string; distortion?: unknown };
  /** The request's `subjectDistanceM` (the frame's reference plane). */
  subjectDistanceM: number;
  /** The request's `chartSize`, when it has one: the scene's cards are then in chart units (u = ±1 at the chart's left and right edges). */
  chartSize?: { widthM: number; heightM?: number };
}
```
