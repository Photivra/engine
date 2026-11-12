# optics/sensor-psf-quadrature.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorPsfIrradianceQuadrature

Applies each resolved unit-energy PSF as an inverse sum of samples around
each destination pixel.

Support in native coordinates (+Y down) is converted explicitly to the
optical kernel orientation (+Y up). The edges are not extended, missing
support is not renormalized and no extra throughput is applied. This
approximation is not a field-dependent forward transport of energy.

```ts
export function calculateSensorPsfIrradianceQuadrature(
  input: CalculateSensorPsfIrradianceQuadratureInput
): CalculationResult<SensorPsfIrradianceQuadrature>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorPsfIrradianceQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorPsfIrradianceQuadratureInput {
  /** One instant, measured on the declared shutter-opening time reference. */
  timeSecondsFromOpeningReference: number;
  spatialQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spatialQuadrature"];
  spectralQuadrature: ReduceSensorSpatioSpectralIrradianceInput["spectralQuadrature"];
  /** The adapter supplies the wavelength and image-plane field position for each node. */
  psf: Omit<ResolveLensSampledPsfInput, "fieldPointMm" | "wavelengthNm">;
  /** Schema 0.1.0 PSF profiles have no basis field, so the caller states what the source means. */
  psfWavelengthBasis: { value: "air" | "vacuum"; evidence: readonly EvidenceProvenance[] };
  /** Explicit local approximation. A PSF that varies across a grid is not a global convolution. */
  spatialModel: { kind: "destination-local-shift-invariant-approximation";
    evidence: readonly EvidenceProvenance[]; limitation: string };
  inputMeaning: "pre-psf-pre-sensor-stack-pre-aa-spectral-irradiance";
  /** All nodes and all kernel taps, including zero weights, must be supplied. */
  samples: readonly { node: SensorSpatioSpectralNodeIdentity; sourceSamples: readonly SensorPsfSourceSample[] }[];
}
```

## SensorPsfIrradianceQuadrature

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorPsfIrradianceQuadrature {
  timeSecondsFromOpeningReference: number;
  wavelengthBasis: "air" | "vacuum";
  sourcePlane: "sensor-package-incident";
  outputMeaning: "post-psf-pre-sensor-stack-pre-aa-irradiance-quadrature";
  psfRedistributionApplied: true;
  localShiftInvarianceEstablished: false;
  globalFieldEnergyConservationEstablished: false;
  pupilThroughputApplied: false;
  sceneProviderExecutionVerified: false;
  spatialModelEvidence: readonly EvidenceProvenance[];
  wavelengthBasisEvidence: readonly EvidenceProvenance[];
  spatialModelLimitation: string;
  irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"];
  reduction: ReturnType<typeof reduceSensorSpatioSpectralIrradiance>;
  samples: readonly { node: SensorSpatioSpectralNodeIdentity;
    psf: ReturnType<typeof resolveLensSampledPsf>; sourceSamples: readonly SensorPsfSourceSample[] }[];
}
```

## SensorPsfSourceSample

One pre-PSF incident irradiance value per explicitly identified kernel tap.

```ts
export interface SensorPsfSourceSample {
  timeSecondsFromOpeningReference: number;
  kernelSampleX: number;
  kernelSampleY: number;
  /** Origin on the optical axis, +X right, +Y down, in millimetres. Not clipped to the native crop. */
  sourcePointNativeSensorMm: { x: number; y: number };
  spectralIrradianceWattsPerSquareMeterPerNanometer: number;
}
```
