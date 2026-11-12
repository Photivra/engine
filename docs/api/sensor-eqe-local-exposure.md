# sensor/eqe-local-exposure.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorEqeLocalExposure

Runs irradiance reduction, the response applicability and range checks, EQE
conversion and constant-rate integration over the local exposure. The result
can be the photoSignal for accumulated charge. Dark current, completeness,
capacity and readout are separate later inputs. Invalid or unsupported
evidence is rejected.

```ts
export function calculateSensorEqeLocalExposure(
  input: CalculateSensorEqeLocalExposureInput
): CalculationResult<SensorEqeLocalExposure>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorEqeLocalExposureInput

Input: explicit irradiance samples after the optics, with evidence. No renderer or RGB conversion is involved.

```ts
export interface CalculateSensorEqeLocalExposureInput {
  /** Physical area, the site's aperture on its grid, anti-aliasing (AA) support and the destination site. */
  spatialSampling: Omit<CalculateSensorSpatialSamplingQuadratureInput,
    "colorSamplingProfile" | "colorSamplingBindingProfile" | "nativeRaster">;
  /** Wavelength basis and range, channel, and the budget for midpoint subdivisions. */
  spectralSampling: Omit<CalculateSensorSpectralQuadratureInput,
    "colorSamplingProfile" | "spectralResponseProfile">;
  /** One value in W/m²/nm for each identified spatial and spectral node, before anti-aliasing. */
  irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"];
  /** Evidence about the source plane, collection area and reference conditions of the response data. */
  responseApplication: Omit<AssessSensorResponseApplicationCompatibilityInput, "reduction">;
  /** Evidence-backed range in which the response is linear. No extrapolation beyond it is allowed. */
  operatingRangeProfile: AssessSensorResponseOperatingRangeInput["operatingRangeProfile"];
  /** The destination CFA site and channel, shared by every step. */
  colorSamplingProfile: CalculateSensorEqeElectronRateInput["colorSamplingProfile"];
  /** EQE response, given directly or as separable factors. A/W responsivity is not supported here. */
  spectralResponseProfile: CalculateSensorEqeElectronRateInput["spectralResponseProfile"];
  /** Required for air wavelengths: the explicit context for converting to photon energy. */
  airPhotonEnergyContext?: CalculateSensorEqeElectronRateInput["airPhotonEnergyContext"];
  /** One-to-one native site binding and one shutter opening and closing. */
  localExposure: Omit<BindSensorRateToLocalExposureInput, "rate" | "colorSamplingProfile">;
  /** A separate declaration that the rate is constant over this exact window. */
  stationarityProfile: SensorRateTemporalStationarityProfile;
}
```

## SensorEqeLocalExposure

Result. Each step's result keeps its own provenance, validity and uncertainty; uncertainties are not combined.

```ts
export interface SensorEqeLocalExposure {
  upstreamOrigin: "declared-spatio-spectral-irradiance-samples";
  upstreamSceneAndOpticsVerified: false;
  spatialQuadrature: ReturnType<typeof calculateSensorSpatialSamplingQuadrature>;
  spectralQuadrature: ReturnType<typeof calculateSensorSpectralQuadrature>;
  reduction: ReturnType<typeof reduceSensorSpatioSpectralIrradiance>;
  compatibility: ReturnType<typeof assessSensorResponseApplicationCompatibility>;
  operatingRange: ReturnType<typeof assessSensorResponseOperatingRange>;
  electronRate: ReturnType<typeof calculateSensorEqeElectronRate>;
  exposureBinding: ReturnType<typeof bindSensorRateToLocalExposure>;
  exposure: CalculationResult<SensorEqeExposureIntegration>;
}
```
