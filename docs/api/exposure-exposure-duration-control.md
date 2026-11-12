# exposure/exposure-duration-control.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## bindResolvedExposureDurationToCaptureExposureInput

Puts a resolved duration into the capture exposure-window input.

The existing shutter mechanism and opening/closing schedules are left as
they are. Only the nominal duration, in seconds, is supplied.

```ts
export function bindResolvedExposureDurationToCaptureExposureInput(
  input:
    BindResolvedExposureDurationToCaptureExposureInput
): CalculateCaptureExposureWindowsInput;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## BindResolvedExposureDurationToCaptureExposureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface BindResolvedExposureDurationToCaptureExposureInput {
  resolution:
    Extract<
      ExposureDurationControlResolution,
      { status: "resolved" }
    >;
  durationEvidence:
    readonly EvidenceProvenance[];
  exposureWindowInput:
    Omit<
      CalculateCaptureExposureWindowsInput,
      "nominalExposureDurationSeconds"
    >;
}
```

## EXPOSURE_DURATION_CONTROL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
EXPOSURE_DURATION_CONTROL_VERSION =
  "0.1.0" as const
```

## ExposureDurationControl

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureDurationControl =
  | {
      kind: "fixed-duration";
      durationSeconds: number;
    }
  | {
      kind: "bulb";
      timeReference:
        "control-monotonic-seconds";
      pressSeconds: number;
      releaseSeconds?: number;
    }
  | {
      kind: "time";
      timeReference:
        "control-monotonic-seconds";
      startSeconds: number;
      stopSeconds?: number;
    };
```

## ExposureDurationControlResolution

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type ExposureDurationControlResolution =
  | (ExposureDurationControlResolutionBase & {
      status: "resolved";
      durationSeconds: number;
      physicalExposureIntegrationAuthorized:
        true;
    })
  | (ExposureDurationControlResolutionBase & {
      status: "active";
      durationSeconds: null;
      physicalExposureIntegrationAuthorized:
        false;
      waitingFor:
        | "bulb-release"
        | "time-stop";
    });
```

## resolveExposureDurationControl

Turns a shutter-duration control setting into a concrete, positive elapsed
duration, before the physical exposure is integrated.

Bulb and Time are only control behaviours. Neither implies a shutter
mechanism, an exposure-boundary layout, a tripod, a stabilization state,
long-exposure noise reduction (NR) or a temperature model.

```ts
export function resolveExposureDurationControl(
  control: ExposureDurationControl
): ExposureDurationControlResolution;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.
