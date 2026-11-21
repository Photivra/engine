// SPDX-License-Identifier: Apache-2.0

/**
 * Applies each resolved PSF (point-spread function, normalized to unit energy) as an inverse sum of
 * samples around each destination pixel.
 *
 * Support offsets in native sensor coordinates (+Y down) are converted explicitly to the optical
 * kernel orientation (+Y up). The edges are not extended. Missing support is not renormalized. No
 * extra throughput is applied. This approximation is not a field-dependent forward transport of
 * energy.
 * @see docs/PHYSICS_FOUNDATION.md for the equations, units, coordinate conventions, known blockers
 * and support limits.
 */

import { sensorPsfSourcePoint } from "./sensor-psf-support.js";
import { approximationResult, type CalculationResult } from "../core/calculation-result.js";
import { parseEvidenceList, type EvidenceProvenance } from "../core/evidence-provenance.js";
import { InvalidScientificInputError, InvalidScientificResultError } from "../core/validation.js";
import { bindSensorSpatioSpectralSamples, reduceSensorSpatioSpectralIrradiance,
  type ReduceSensorSpatioSpectralIrradianceInput, type SensorSpatioSpectralNodeIdentity } from "../sensor/spatio-spectral-reduction.js";
import { sensorSpatialQuadratureNodeIdentityKey } from "../sensor/spatial-sample-reduction.js";
import { resolveLensSampledPsf, type ResolveLensSampledPsfInput } from "./lens-psf-profile.js";
import { requireInputKeys, requireInputObject } from "../core/record-validation.js";

/** One pre-PSF incident irradiance value per explicitly identified kernel tap. */
export interface SensorPsfSourceSample {
  timeSecondsFromOpeningReference: number;
  kernelSampleX: number;
  kernelSampleY: number;
  /** Origin on the optical axis, +X right, +Y down, in millimetres. Not clipped to the native crop. */
  sourcePointNativeSensorMm: { x: number; y: number };
  spectralIrradianceWattsPerSquareMeterPerNanometer: number;
}

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

/**
 * Applies each resolved unit-energy PSF as an inverse sum of samples around
 * each destination pixel.
 *
 * Support in native coordinates (+Y down) is converted explicitly to the
 * optical kernel orientation (+Y up). The edges are not extended, missing
 * support is not renormalized and no extra throughput is applied. This
 * approximation is not a field-dependent forward transport of energy.
 */
export function calculateSensorPsfIrradianceQuadrature(
  input: CalculateSensorPsfIrradianceQuadratureInput
): CalculationResult<SensorPsfIrradianceQuadrature> {
  requireInputKeys(input, "calculateSensorPsfIrradianceQuadrature", ["timeSecondsFromOpeningReference", "spatialQuadrature", "spectralQuadrature", "psf", "psfWavelengthBasis", "spatialModel", "inputMeaning", "samples"]);
  if (!Number.isFinite(input.timeSecondsFromOpeningReference) || input.timeSecondsFromOpeningReference < 0) {
    throw new InvalidScientificInputError("PSF source time must be finite and nonnegative.");
  }
  if (input.inputMeaning !== "pre-psf-pre-sensor-stack-pre-aa-spectral-irradiance" ||
    input.spatialModel?.kind !== "destination-local-shift-invariant-approximation" ||
    typeof input.spatialModel.limitation !== "string" || !input.spatialModel.limitation.trim()) {
    throw new InvalidScientificInputError("PSF execution requires explicit pre-PSF light and a limited local shift-invariant approximation.");
  }
  // 2.28.0 (#726): missing records are domain errors, not TypeErrors from a property read.
  requireInputObject(input.spectralQuadrature, "spectralQuadrature");
  if ((input.psfWavelengthBasis?.value !== "air" && input.psfWavelengthBasis?.value !== "vacuum") ||
    input.psfWavelengthBasis.value !== input.spectralQuadrature.wavelengthBasis) {
    throw new InvalidScientificInputError("PSF wavelength basis must explicitly match the spectral plan.");
  }
  const spatialModelEvidence = parseEvidenceList(input.spatialModel.evidence, "psfSpatialModel.evidence");
  const wavelengthBasisEvidence = parseEvidenceList(input.psfWavelengthBasis.evidence, "psfWavelengthBasis.evidence");
  const bound = bindSensorSpatioSpectralSamples({ ...input, sampleValues: input.samples }, s => s);
  let count = 0;
  for (const sample of input.samples) {
    if (!Array.isArray(sample.sourceSamples)) throw new InvalidScientificInputError("PSF source samples must be a dense array.");
    count += sample.sourceSamples.length;
    if (count > 100000) throw new InvalidScientificInputError("PSF support exceeds the 100000-source-node budget.");
  }
  const samples: SensorPsfIrradianceQuadrature["samples"][number][] = [];
  const irradianceSamples: ReduceSensorSpatioSpectralIrradianceInput["sampleValues"][number][] = [];
  for (const spectral of input.spectralQuadrature.nodes) {
    for (const spatial of input.spatialQuadrature.nodes) {
      const spatialNode = { antiAliasingComponentIndex: spatial.antiAliasingComponentIndex,
        apertureSampleXIndex: spatial.apertureSampleXIndex, apertureSampleYIndex: spatial.apertureSampleYIndex };
      const node = { spatialNode, spectralSampleIndex: spectral.spectralSampleIndex, wavelengthNanometers: spectral.wavelengthNanometers };
      const declared = bound.valuesByKey.get(sensorSpatialQuadratureNodeIdentityKey(spatialNode) + "|" + spectral.spectralSampleIndex)!;
      const destination = spatial.preAntiAliasingSourcePointMm;
      requireInputObject(destination, "spatialQuadrature.nodes[].preAntiAliasingSourcePointMm");
      const psf = resolveLensSampledPsf({ ...input.psf, wavelengthNm: spectral.wavelengthNanometers,
        fieldPointMm: { x: destination.x, y: -destination.y } });
      const kernel = psf.value.kernel;
      if (declared.sourceSamples.length !== kernel.widthSamples * kernel.heightSamples) {
        throw new InvalidScientificInputError("PSF source coverage must include every kernel tap without renormalization.");
      }
      const byIndex = new Map<number, SensorPsfSourceSample>();
      for (const source of declared.sourceSamples) {
        if (!source || source.timeSecondsFromOpeningReference !== input.timeSecondsFromOpeningReference ||
          !Number.isSafeInteger(source.kernelSampleX) || !Number.isSafeInteger(source.kernelSampleY) ||
          source.kernelSampleX < 0 || source.kernelSampleX >= kernel.widthSamples ||
          source.kernelSampleY < 0 || source.kernelSampleY >= kernel.heightSamples ||
          !Number.isFinite(source.spectralIrradianceWattsPerSquareMeterPerNanometer) || source.spectralIrradianceWattsPerSquareMeterPerNanometer < 0) {
          throw new InvalidScientificInputError("PSF support requires valid unique tap indices and finite nonnegative irradiance.");
        }
        const index = source.kernelSampleY * kernel.widthSamples + source.kernelSampleX;
        const { x, y } = sensorPsfSourcePoint(destination, kernel, source.kernelSampleX, source.kernelSampleY);
        if (byIndex.has(index) || source.sourcePointNativeSensorMm?.x !== x || source.sourcePointNativeSensorMm?.y !== y) {
          throw new InvalidScientificInputError("PSF source coordinate must match the exact inverse kernel offset in native sensor axes.");
        }
        byIndex.set(index, { ...source, sourcePointNativeSensorMm: { x, y } });
      }
      const sourceSamples = Array.from({ length: declared.sourceSamples.length }, (_, i) => byIndex.get(i)!);
      const irradiance = sourceSamples.reduce((sum, s, i) => sum + kernel.normalizedIntensity[i]! * s.spectralIrradianceWattsPerSquareMeterPerNanometer, 0);
      if (!Number.isFinite(irradiance)) throw new InvalidScientificResultError("PSF weighted irradiance must remain finite.");
      samples.push({ node, psf, sourceSamples });
      irradianceSamples.push({ node, spectralIrradianceWattsPerSquareMeterPerNanometer: irradiance });
    }
  }
  const reduction = reduceSensorSpatioSpectralIrradiance({ spatialQuadrature: input.spatialQuadrature,
    spectralQuadrature: input.spectralQuadrature, sampleValues: irradianceSamples });
  return approximationResult({ timeSecondsFromOpeningReference: input.timeSecondsFromOpeningReference,
    wavelengthBasis: input.psfWavelengthBasis.value,
    sourcePlane: "sensor-package-incident", outputMeaning: "post-psf-pre-sensor-stack-pre-aa-irradiance-quadrature",
    psfRedistributionApplied: true, localShiftInvarianceEstablished: false, globalFieldEnergyConservationEstablished: false,
    pupilThroughputApplied: false, sceneProviderExecutionVerified: false, spatialModelEvidence, wavelengthBasisEvidence,
    spatialModelLimitation: input.spatialModel.limitation, samples, irradianceSamples, reduction
  }, "sensor-local-psf-irradiance-quadrature", "0.1.0", [
    "Destination-local shift invariance is a declared approximation, not a proof of full field-dependent energy transport.",
    "Normalized PSF shape is applied once; separate pupil throughput and source transport remain upstream responsibilities.",
    "Complete finite-kernel support does not establish infinite-support convergence or calibrated photographic accuracy."
  ]);
}
