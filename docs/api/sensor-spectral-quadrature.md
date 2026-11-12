# sensor/spectral-quadrature.ts public contracts

The package and root API versions are recorded once in [Navigation](../API_REFERENCE.md) · [Developer guide](https://github.com/Photivra/engine/blob/main/docs/DEVELOPERS.md). Generated signatures retain independent schema/model versions. Only the exports listed here are root-package contracts; module-local helpers are not supported deep imports.

## calculateSensorSpectralQuadrature

Builds deterministic wavelength sample points for one exact sensor response
channel. It does not apply the response to any spectrum.

The requested range must lie fully inside the channel's declared usable
range. The response curve's breakpoints, plus any caller-supplied breakpoints
from the source spectrum or optics, split that range into segments. Each
segment is then subdivided so no midpoint subinterval is wider than
maximumSubintervalWidthNanometers.

wavelengthMeasureNanometers is dλ in nanometres, not a dimensionless response
weight. Multiply it only by a spectral density per nanometre, or convert
units explicitly first.

QE and A/W responsivity are deliberately not applied. They lead to different
signals: QE is photon-to-electron efficiency, while A/W responsivity relates
incident radiant power to electrical current. A later step must also match
responseScope to the source plane and collection area before integrating any
signal.

```ts
export function calculateSensorSpectralQuadrature(
  input:
    CalculateSensorSpectralQuadratureInput
): CalculationResult<SensorSpectralQuadrature>;
```

This call is synchronous; any supplied provider must follow its explicit synchronous contract.

## CalculateSensorSpectralQuadratureInput

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface CalculateSensorSpectralQuadratureInput {
  colorSamplingProfile: SensorColorSamplingProfile;
  spectralResponseProfile: SensorSpectralResponseProfile;
  channelId: string;
  wavelengthBasis: SpectralWavelengthBasis;
  /**
   * Wavelength interval to sample. It is checked only against the range the
   * sensor response supports, not against scene-spectrum or optical-transmission
   * coverage.
   */
  wavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  /**
   * Strict upper limit on the width of each midpoint subinterval.
   *
   * Response breakpoints and any additional breakpoints split the requested
   * range first. Each segment is then subdivided until every subinterval is
   * no wider than this value.
   */
  maximumSubintervalWidthNanometers: number;
  /**
   * Optional strictly increasing wavelength breakpoints from other continuous
   * spectral inputs, such as the interpolation points of a scene spectrum or of
   * optical transmission. Values must be strictly inside the requested range.
   *
   * Passing them does not claim those other inputs are available or valid over
   * the requested range.
   */
  additionalBreakpointsNanometers?:
    readonly number[];
}
```

## SensorSpectralQuadrature

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpectralQuadrature {
  profileId: string;
  colorSamplingProfileId: string;
  channelId: string;
  sourceResponseKind:
    SensorSpectralResponseProfile["channels"][number]["kind"];
  responseScope:
    SensorSpectralResponseProfile["channels"][number]["responseScope"];
  responseScientificStatus:
    SensorSpectralResponseScientificStatus;
  responseUncertainty:
    SensorSpectralResponseUncertainty;
  responseChannelBinding?: import("./spectral-response.js").SensorSpectralResponseChannelBinding;
  responseReferenceConditions?:
    SensorSpectralReferenceConditions;
  wavelengthBasis: SpectralWavelengthBasis;
  wavelengthBasisResolved: boolean;
  wavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  responseDeclaredWavelengthRangeNanometers:
    SensorSpectralWavelengthRangeNanometers;
  quadratureScheme:
    "response-breakpoint-aware-bounded-midpoint";
  segmentBoundarySource:
    "requested-range-plus-response-knots-plus-optional-additional-breakpoints";
  /**
   * Sorted, unique segment boundaries, including the ends of the requested range.
   */
  segmentBoundariesNanometers:
    readonly number[];
  maximumSubintervalWidthNanometers: number;
  segmentCount: number;
  totalNodeCount: number;
  normalizedWavelengthWeightSum: number;
  wavelengthMeasureSumNanometers: number;
  nodes: readonly SensorSpectralQuadratureNode[];
  responseKnotAlignmentIncluded: true;
  componentEvidence: {
    colorSamplingProfile: readonly EvidenceProvenance[];
    profile: readonly EvidenceProvenance[];
    channel: readonly EvidenceProvenance[];
    curves:
      readonly (readonly EvidenceProvenance[])[];
  };
  /**
   * Fixed statements of what this result does not include.
   */
  responseValuesIncluded: false;
  responseApplicationPerformed: false;
  sourceSpectralValuesIncluded: false;
  spectralIrradianceIncluded: false;
  spectralPhotonIrradianceIncluded: false;
  commonSpectralCoverageValidated: false;
  continuousSpectralDensityQuadratureOnly: true;
  discreteLineSpectrumIncluded: false;
  opticalTransmissionIncludedByQuadrature: false;
  wavelengthIntegrationPerformed: false;
  spatialIntegrationPerformed: false;
  temporalIntegrationPerformed: false;
  photonsCalculated: false;
  electronsCalculated: false;
  rawCodeValueProduced: false;
  convergenceErrorEstimated: false;
}
```

## SensorSpectralQuadratureNode

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export interface SensorSpectralQuadratureNode {
  spectralSampleIndex: number;
  segmentIndex: number;
  subdivisionIndex: number;
  segmentSubdivisionCount: number;
  /**
   * Midpoint wavelength for this subinterval. Units: nm in wavelengthBasis.
   */
  wavelengthNanometers: number;
  /**
   * dλ (wavelength width) this node stands for. Units: nm.
   *
   * It is only a wavelength width. It is not response-weighted throughput,
   * a photon count, radiant energy, current or a dimensionless probability.
   */
  wavelengthMeasureNanometers: number;
  /**
   * The wavelength width divided by the requested range width (dimensionless).
   *
   * Useful for averages, but it is not a sensor-response weight.
   */
  normalizedWavelengthWeight: number;
}
```

## SensorSpectralWavelengthRangeNanometers

The exact contract is declared below; use the domain guide for assumptions and staged integration.

```ts
export type SensorSpectralWavelengthRangeNanometers =
  SpectralWavelengthRangeNanometers;
```
