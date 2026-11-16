# facade/subject-framing.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateChartFraming

How much of the frame a chart of a given physical size covers at any subject distance (2.5): magnification, framed plane size,
coverage fractions (above 1 when cropped), the chart's image size and the minimum-focus check. The same thin-lens framing as
`simulateCapture` (`scene.framing`, `result.scene.chart`) and `calculateSubjectDistanceForFraming`.

```ts
export function calculateChartFraming(input: CalculateChartFramingInput): ChartFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## calculateSubjectDistanceForFraming

The subject distance that fits a chart of a given physical size to the frame, with magnification, coverage and the minimum-focus check (2.3).

```ts
export function calculateSubjectDistanceForFraming(input: CalculateSubjectDistanceForFramingInput): SubjectFraming;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
