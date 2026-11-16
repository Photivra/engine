# motion/hand-shake.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateHandShakeAngularDisplacement

The camera's angular displacement at t seconds from the exposure start (rad; pitch, yaw, roll as `motion.angularVelocityRadPerSec`).

```ts
export function calculateHandShakeAngularDisplacement(input: CalculateHandShakeInput): CalculationResult<{ pitch: number; yaw: number; roll: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateHandShakeInput

Input of {@link calculateHandShakeAngularDisplacement} and {@link calculateHandShakeRmsDisplacement}.

```ts
export interface CalculateHandShakeInput {
  /** A trajectory from {@link createHandShakeTrajectory}. */
  trajectory: HandShakeTrajectory;
  /** Seconds from the exposure start (≥ 0). */
  timeSeconds: number;
}
```

## calculateHandShakeRmsDisplacement

The RMS displacement magnitude (rad) after `timeSeconds`, over the phases: √(Σ a_k²·(1 − cos 2πf_k·τ)) summed over both axes, the
trajectory's frequencies and amplitudes kept. It grows as the RMS velocity times τ at first and levels off.

```ts
export function calculateHandShakeRmsDisplacement(input: CalculateHandShakeInput): CalculationResult<{ rmsDisplacementRad: number }>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## createHandShakeTrajectory

Builds the trajectory of a seed and a stabilization (see the module comment).

```ts
export function createHandShakeTrajectory(options: HandShakeOptions = {}): HandShakeTrajectory;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS

The largest `stabilizationStops` accepted.

```ts
HAND_SHAKE_MAXIMUM_STABILIZATION_STOPS = 10
```

## HAND_SHAKE_MODEL_VERSION

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
HAND_SHAKE_MODEL_VERSION = "1.0.0" as const
```

## HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC

The RMS angular-velocity magnitude of the unstabilized trajectory, rad/s: 4.39 °/s (Xiao et al. 2009).

```ts
HAND_SHAKE_RMS_ANGULAR_SPEED_RAD_PER_SEC = (4.39 * Math.PI) / 180
```

## HandShakeComponent

One sinusoid of the trajectory: a·(sin 2π(f·t + φ) − sin 2πφ) on its axis.

```ts
export interface HandShakeComponent {
  axis: "pitch" | "yaw";
  amplitudeRad: number;
  frequencyHz: number;
  phaseTurns: number;
}
```

## HandShakeOptions

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface HandShakeOptions {
  /** The trajectory's seed, an integer 0 … 2³² − 1. Default 0. */
  seed?: number;
  /** Stabilization in stops, 0 … 10: the trajectory is scaled by 2^−stops. Default 0 (none). */
  stabilizationStops?: number;
}
```

## HandShakeTrajectory

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface HandShakeTrajectory {
  modelVersion: typeof HAND_SHAKE_MODEL_VERSION;
  seed: number;
  stabilizationStops: number;
  /** 2^−stops, applied to every amplitude. */
  scale: number;
  components: readonly HandShakeComponent[];
  /** |θ(t)| on each axis never exceeds this, at any t: 2·Σ a_k over the axis's components (rad). */
  boundRad: { pitch: number; yaw: number };
}
```
