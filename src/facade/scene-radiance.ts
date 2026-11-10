// SPDX-License-Identifier: Apache-2.0

/**
 * Turns a facade scene and an illuminant into a scene radiance provider for the existing native
 * environment RAW contract (`NativeEnvironmentRawProvider.evaluateRadiance` and, for pupil sampling,
 * `evaluateApertureRadiance`). The scene is an engine chart, a caller reflectance function or a caller
 * radiance function.
 *
 * Geometry: one plane perpendicular to the optical axis at `distanceM` in front of the camera. A query's
 * outgoing direction o (scene toward camera, see docs/SENSOR_ENVIRONMENT_QUERY.md) gives the look
 * direction l = -o; the plane point is l·distanceM/l.z. With a pupil ray, the plane point is the ray from
 * its lens origin to z = distanceM.
 *
 * Radiometry: a Lambertian reflector of reflectance ρ(λ) under irradiance E(λ) has radiance
 * L(λ) = ρ(λ)·E(λ)/π (W·m⁻²·sr⁻¹·nm⁻¹). The illuminant spectral shape S(λ) is scaled so that the
 * plane illuminance is E_v = K_m ∫ E(λ) V(λ) dλ with K_m = 683 lm/W (CIE photometric definition) and
 * V(λ) = ȳ(λ) from the engine's analytic CIE 1931 fit. The light is uniform
 * over the plane, with no shadows. Inter-reflection, gloss and fluorescence are not modelled.
 * @see docs/QUICK_START.md
 */

import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireInputObject } from "../core/record-validation.js";
import { estimateCie1931ColorMatchingFunctions, prepareColorimetricSpectrum, type ColorimetricSpectrum,
  type PreparedColorimetricSpectrum } from "../color/color-matching-functions.js";
import { createCieIlluminantASpectrum, createCieDaylightSpectrum, createPlanckianSpectrum, createPortableCieDaylightSpectrum, createPortableCieIlluminantASpectrum,
  createPortablePlanckianSpectrum, type CieDaylightBasis } from "../color/illuminants.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import type { EvidenceProvenance } from "../core/evidence-provenance.js";
import type { SensorApertureRay } from "../optics/sensor-aperture-rays.js";
import { resolveChartMaterial, resolveChartScene, type ChartReflectance, type ChartScene, type ResolvedChartScene } from "./chart-scenes.js";
import { resolveChartMaterialLayers, type ChartMaterialLayerScene } from "./chart-material-layers.js";

/** CIE maximum luminous efficacy for photopic vision, lm/W. */
export const PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W = 683;
/** Wavelength range of every facade spectrum and of the facade sensor quadrature, nm. */
export const FACADE_SPECTRAL_RANGE_NANOMETERS = /* @__PURE__ */ Object.freeze({ minimum: 380, maximum: 780 });

/**
 * Illuminant choices. CIE D65 is not bundled: its S0/S1/S2 basis tables must come from the caller
 * (`daylight`). `planckian` is Planck's law; `cie-a` is CIE illuminant A from its defining formula.
 */
export type CaptureIlluminant =
  | "cie-a"
  | { kind: "planckian"; temperatureKelvin: number }
  | { kind: "cie-a" }
  | { kind: "daylight"; correlatedColorTemperatureKelvin: number; basis: CieDaylightBasis }
  | { kind: "spectrum"; spectrum: ColorimetricSpectrum; label?: string };

export interface ResolvedCaptureIlluminant {
  /** Short public description, for example "planckian-6500K". */
  id: string;
  description: string;
  /** Relative spectral shape (arbitrary scale) over at least 380-780 nm. */
  shape: PreparedColorimetricSpectrum;
  /** Original spectrum, for colorimetric white-balance calculations. */
  spectrum: ColorimetricSpectrum;
}

export function resolveCaptureIlluminant(value: CaptureIlluminant): ResolvedCaptureIlluminant {
  return resolveIlluminant(value, CAPTURE_SPECTRA);
}
/**
 * The spectrum constructors of the engine's own illuminant formulas: the capture's, or the portable ones (the display view).
 * They are passed in rather than chosen inside {@link resolveIlluminant}, so a bundle that only captures does not contain the
 * portable ones.
 */
interface IlluminantSpectra { planckian: typeof createPlanckianSpectrum; cieA: typeof createCieIlluminantASpectrum; daylight: typeof createCieDaylightSpectrum }
const CAPTURE_SPECTRA: IlluminantSpectra = { planckian: createPlanckianSpectrum, cieA: createCieIlluminantASpectrum, daylight: createCieDaylightSpectrum };
/**
 * Internal (not exported from the package): {@link resolveCaptureIlluminant} with the engine's own formulas (Planckian,
 * CIE A, daylight locus) evaluated with the portable power and e^x − 1 (`portablePow`, `portableExpm1`), so the spectrum
 * has the same bits in every JavaScript engine. The display view uses it; captures keep {@link resolveCaptureIlluminant}.
 * A caller spectrum is the caller's own.
 */
export function resolvePortableCaptureIlluminant(value: CaptureIlluminant): ResolvedCaptureIlluminant {
  return resolveIlluminant(value, { planckian: createPortablePlanckianSpectrum, cieA: createPortableCieIlluminantASpectrum, daylight: createPortableCieDaylightSpectrum });
}
function resolveIlluminant(value: CaptureIlluminant, spectra: IlluminantSpectra): ResolvedCaptureIlluminant {
  if (value === "cie-a") return resolveIlluminant({ kind: "cie-a" }, spectra);
  requireInputObject(value, "illuminant");
  const record = value as unknown as Record<string, unknown>;
  const allowed: Record<string, readonly string[]> = { planckian: ["kind", "temperatureKelvin"], "cie-a": ["kind"],
    daylight: ["kind", "correlatedColorTemperatureKelvin", "basis"], spectrum: ["kind", "spectrum", "label"] };
  const keys = typeof record.kind === "string" ? allowed[record.kind] : undefined;
  if (!keys) throw new InvalidConfigurationError("Unknown illuminant kind.");
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new InvalidConfigurationError("Unknown illuminant field: " + key + ".");
  let spectrum: ColorimetricSpectrum, id: string, description: string;
  try {
    switch (value.kind) {
      case "planckian": {
        const t = value.temperatureKelvin;
        if (typeof t !== "number" || !Number.isFinite(t) || t < 1000 || t > 25000) throw new InvalidConfigurationError("Planckian temperature must be 1000-25000 K.");
        spectrum = spectra.planckian({ temperatureKelvin: t, wavelengthRangeNanometers: { ...FACADE_SPECTRAL_RANGE_NANOMETERS } });
        id = "planckian-" + t + "K"; description = "Planck blackbody spectrum at " + t + " K (Planck's law).";
        break;
      }
      case "cie-a":
        spectrum = spectra.cieA(); id = "cie-a"; description = "CIE standard illuminant A from its defining formula: Planck's law with c2 = 1.435e-2 m·K and T = 2848 K, 100 at 560 nm.";
        break;
      case "daylight":
        spectrum = spectra.daylight({ correlatedColorTemperatureKelvin: value.correlatedColorTemperatureKelvin, coefficientRounding: "cie-three-decimals", basis: value.basis });
        id = "cie-daylight-" + value.correlatedColorTemperatureKelvin + "K"; description = "CIE daylight from the caller's S0/S1/S2 basis (" + value.basis.datasetId + ").";
        break;
      case "spectrum":
        spectrum = value.spectrum; id = "caller-spectrum";
        description = "Caller illuminant spectrum" + (typeof value.label === "string" ? " (" + value.label + ")" : "") + ".";
        break;
    }
  } catch (error) {
    if (error instanceof InvalidConfigurationError) throw error;
    throw new InvalidConfigurationError("Invalid illuminant: " + (error instanceof Error ? error.message : "invalid"));
  }
  let shape: PreparedColorimetricSpectrum;
  try { shape = prepareColorimetricSpectrum(spectrum, "illuminant"); } catch (error) {
    throw new InvalidConfigurationError("Invalid illuminant spectrum: " + (error instanceof Error ? error.message : "invalid"));
  }
  const range = shape.wavelengthRangeNanometers;
  if (range.minimum > FACADE_SPECTRAL_RANGE_NANOMETERS.minimum || range.maximum < FACADE_SPECTRAL_RANGE_NANOMETERS.maximum)
    throw new InvalidConfigurationError("The illuminant spectrum must cover 380-780 nm.");
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm += 1) {
    const s = shape.evaluate(nm);
    if (!(s >= 0)) throw new InvalidConfigurationError("The illuminant spectrum must be non-negative over 380-780 nm.");
  }
  return Object.freeze({ id, description, shape, spectrum });
}

/**
 * Factor k such that k·S(λ) (W·m⁻²·nm⁻¹) gives `illuminanceLux` on the plane: E_v = 683 ∫ k S ȳ dλ,
 * integrated with the 1 nm trapezoid rule over 380-780 nm (ȳ outside this range is below 4e-5 of its peak).
 */
export function calculateIlluminantIrradianceScale(shape: PreparedColorimetricSpectrum, illuminanceLux: number): number {
  if (typeof shape !== "object" || shape === null || typeof shape.evaluate !== "function") throw new InvalidConfigurationError("A prepared illuminant spectrum is required.");
  if (typeof illuminanceLux !== "number" || !Number.isFinite(illuminanceLux) || illuminanceLux <= 0 || illuminanceLux > 1e7)
    throw new InvalidConfigurationError("Illuminance must be a positive number of lux up to 1e7.");
  let sum = 0;
  for (let nm = FACADE_SPECTRAL_RANGE_NANOMETERS.minimum; nm <= FACADE_SPECTRAL_RANGE_NANOMETERS.maximum; nm++) {
    const w = nm === FACADE_SPECTRAL_RANGE_NANOMETERS.minimum || nm === FACADE_SPECTRAL_RANGE_NANOMETERS.maximum ? 0.5 : 1;
    sum += w * shape.evaluate(nm) * estimateCie1931ColorMatchingFunctions(nm).y;
  }
  if (!(sum > 0)) throw new InvalidConfigurationError("The illuminant has no luminous power.");
  return illuminanceLux / (PHOTOPIC_MAXIMUM_LUMINOUS_EFFICACY_LM_PER_W * sum);
}

/**
 * A point of the scene plane passed to caller scene functions: a new object for every call, which the engine does not read
 * after the call (not frozen: freezing cost about 40 % of a chart lookup).
 */
export interface ScenePlanePoint {
  /** Metres on the plane, from the optical axis: +x right, +y up (as seen from the camera). */
  xM: number;
  yM: number;
  /** The same point in frame units (u = ±1 at the left/right frame edges, v up on the same scale). */
  u: number;
  v: number;
  wavelengthNanometers: number;
  /**
   * 2.3, only with a fixed-size chart (`chartSize`): the point in chart-local frame units (±1 at the chart's
   * left/right edges, v up on the same scale, ±chart height/width at its top/bottom). The function is then
   * called only for points on the chart; the surround is the placement's surround reflectance.
   */
  chartU?: number;
  chartV?: number;
}
/** Caller Lambertian reflectance (in [0, 1]) lit by the facade illuminant. */
export interface CallerReflectanceScene { kind: "reflectance-function"; sceneId: string; evaluate(point: Readonly<ScenePlanePoint>): number }
/** Caller absolute spectral radiance in W·m⁻²·sr⁻¹·nm⁻¹; the facade illuminant is not used. */
export interface CallerRadianceScene { kind: "radiance-function"; sceneId: string; evaluate(point: Readonly<ScenePlanePoint>): number }
/** 2.7: a scene-plane point without a wavelength, passed to a material scene's `materialAt`. */
export type SceneMaterialPoint = Omit<ScenePlanePoint, "wavelengthNanometers">;
/**
 * 2.7 (#386): a piecewise-constant caller scene, lit by the facade illuminant like a reflectance function. `materials` are
 * reflectances as a chart's patches take them (a neutral number in [0, 1] or a reflectance spectrum covering 380–780 nm, at
 * most {@link CALLER_MATERIAL_SCENE_MAX_MATERIALS}); `materialAt` returns the index of the material at a plane point (an
 * integer from 0 to materials.length − 1). The radiance at a point is that material's, exactly as for a reflectance function
 * returning its reflectance, but renderers can tabulate each material once: the display view then takes the chart path.
 */
export interface CallerMaterialScene {
  kind: "material-function";
  sceneId: string;
  materials: readonly ChartReflectance[];
  materialAt(point: Readonly<SceneMaterialPoint>): number;
}
/** Most materials a {@link CallerMaterialScene} may list. */
export const CALLER_MATERIAL_SCENE_MAX_MATERIALS = 65_536;
/** Internal: a validated material scene with its materials prepared (and the caller inputs, for the scene digest). */
export interface ResolvedCallerMaterialScene {
  kind: "material-function";
  sceneId: string;
  materials: ResolvedChartScene["materials"];
  materialInputs: readonly unknown[];
  materialAt(point: Readonly<SceneMaterialPoint>): number;
}
/** Internal: a validated caller scene. */
export type ResolvedCallerScene = CallerReflectanceScene | CallerRadianceScene | ResolvedCallerMaterialScene;

export interface PlanarSceneGeometry {
  distanceM: number;
  /** Metres per frame unit on the plane (half the framed width). */
  metresPerFrameUnit: number;
  /**
   * 2.3, opt-in fixed-size chart: the chart is `widthM` × `heightM` on the plane, centred on the optical axis;
   * outside it the plane is a neutral Lambertian surround of `surroundReflectance`, lit by the same illuminant.
   * A chart preset is then resolved in its own frame (aspect heightM / widthM). Without it the chart fills the frame.
   */
  chart?: { widthM: number; heightM: number; surroundReflectance: number };
}

export interface PlanarSceneRadianceProvider {
  sceneId: string;
  providerProfileId: string;
  evaluateRadiance(request: Readonly<SceneRadianceEvaluationRequest>): SceneRadianceEvaluationResult;
  evaluateApertureRadiance(request: Readonly<SceneRadianceEvaluationRequest>, ray: Readonly<SensorApertureRay>): SceneRadianceEvaluationResult;
  /** Spectral radiance at a plane point (frame units), the same value the callbacks return. */
  radianceAt(u: number, v: number, wavelengthNanometers: number): number;
  /**
   * 2.3, chart scenes only: the chart material at a plane point (frame units), or `materials.length` for the
   * surround of a fixed-size chart; `materialRadiance` gives that material's spectral radiance, the same value
   * `radianceAt` returns at its points.
   */
  chartMaterialAt?(u: number, v: number): number;
  materialRadiance?(material: number, wavelengthNanometers: number): number;
}

/**
 * Internal (#394, not exported from the package): per provider of a chart preset or caller material scene, the material its
 * `evaluateRadiance` reads for an environment-direction query with a given outgoing direction (the same plane-point
 * arithmetic), or undefined where `evaluateRadiance` would throw. Its radiance is `materialRadiance(material, wavelength)`.
 */
const MATERIAL_OF_DIRECTION = new WeakMap<PlanarSceneRadianceProvider, (direction: Readonly<{ x: number; y: number; z: number }>) => number | undefined>();

/** Internal (#394): the material lookup of a provider built by {@link buildPlanarSceneRadianceProvider}, if it has one. */
export function planarProviderMaterialOfDirection(provider: PlanarSceneRadianceProvider):
  ((direction: Readonly<{ x: number; y: number; z: number }>) => number | undefined) | undefined {
  return MATERIAL_OF_DIRECTION.get(provider);
}

const UNCERTAINTY = /* @__PURE__ */ Object.freeze({ kind: "not-quantified" as const, limitation: "Analytic planar Lambertian scene; no measured scene, BRDF or illumination." });

/** Most distinct wavelengths {@link tabulatedSpectrum} keeps; later ones are evaluated on every call. */
const TABULATED_SPECTRUM_MAX_ENTRIES = 4096;

/**
 * Internal (#385): `spectrum.evaluate` remembered per distinct wavelength. A prepared spectrum is a pure function of the
 * wavelength, so the table returns the same double the call would; renderers ask for the same few spectral nodes millions
 * of times, and the illuminant's formula (two transcendental evaluations) was about 30 % of a caller-scene display view.
 */
export function tabulatedSpectrum(spectrum: Readonly<PreparedColorimetricSpectrum>): (wavelengthNanometers: number) => number {
  const table = new Map<number, number>();
  return (nm) => {
    let value = table.get(nm);
    if (value === undefined) {
      value = spectrum.evaluate(nm);
      if (table.size < TABULATED_SPECTRUM_MAX_ENTRIES) table.set(nm, value);
    }
    return value;
  };
}

/**
 * Wraps a chart or caller scene as a provider for the native environment RAW task. `irradianceScale` is
 * from {@link calculateIlluminantIrradianceScale}; caller radiance scenes ignore the illuminant.
 */
export function buildPlanarSceneRadianceProvider(input: {
  scene: ResolvedChartScene | ResolvedCallerScene;
  sceneId: string;
  providerProfileId: string;
  illuminant: ResolvedCaptureIlluminant;
  irradianceScale: number;
  geometry: PlanarSceneGeometry;
  evidence: readonly EvidenceProvenance[];
  limitations: readonly string[];
  /**
   * #549, catalogue fisheyes only: a direction at or beyond 90° from the axis (or straight back) sees no scene and gets zero
   * radiance instead of failing; the plane fills the forward hemisphere only. Omitted: such a query fails, as before.
   */
  zeroBeyondHorizon?: true;
  /**
   * #550, mixed illumination: the plane's spectral irradiance at a plane point, given in chart units (chart-local with a fixed-size
   * chart, frame units without) and in metres from the optical axis, used instead of `irradianceScale`·S(λ). The provider then has no material access (the radiance at a point is
   * no longer a function of its material alone), so every renderer reads `radianceAt`. A radiance-function scene is refused.
   */
  irradianceAt?: (u: number, v: number, xM: number, yM: number, wavelengthNanometers: number) => number;
}): PlanarSceneRadianceProvider {
  const { scene, illuminant, irradianceScale, geometry } = input, zeroBeyondHorizon = input.zeroBeyondHorizon === true;
  const scale = geometry.metresPerFrameUnit, distance = geometry.distanceM, sceneId = input.sceneId, providerProfileId = input.providerProfileId;
  const evidence = input.evidence, limitations = input.limitations;
  const caller = "kind" in scene ? scene : undefined, chart = caller ? undefined : scene as ResolvedChartScene;
  const materialScene = caller?.kind === "material-function" ? caller : undefined, materials = chart ? chart.materials : materialScene?.materials;
  const placed = geometry.chart, half = placed ? placed.widthM / 2 : 0, chartAspect = placed ? placed.heightM / placed.widthM : 0;
  const shapeAt = tabulatedSpectrum(illuminant.shape);
  /** A material scene's material at a frame point: the caller's index, or `materials.length` for a fixed-size chart's surround. */
  function callerMaterialAt(u: number, v: number): number {
    const xM = u * scale, yM = v * scale;
    let point: SceneMaterialPoint;
    if (placed) {
      const cu = xM / half, cv = yM / half;
      if (!(Math.abs(cu) <= 1 && Math.abs(cv) <= chartAspect)) return materialScene!.materials.length;
      point = { xM, yM, u, v, chartU: cu, chartV: cv };
    } else point = { xM, yM, u, v };
    const index = materialScene!.materialAt(point);
    if (!Number.isInteger(index) || index < 0 || index >= materialScene!.materials.length) throw new InvalidConfigurationError("Scene materialAt must return an index into its materials.");
    return index;
  }
  const light = input.irradianceAt;
  if (light && caller?.kind === "radiance-function") throw new InvalidConfigurationError("illumination needs a lit scene; a radiance-function scene ignores the illuminant.");
  /** #550: reflectance × the blended irradiance at the point (chart-local units with a fixed-size chart) / π. */
  function litRadianceAt(u: number, v: number, nm: number): number {
    let cu = u, cv = v, reflectance: number;
    if (placed) { cu = u * scale / half; cv = v * scale / half; }
    if (materialScene) reflectance = materialReflectanceOf(callerMaterialAt(u, v), nm);
    else if (placed && !(Math.abs(cu) <= 1 && Math.abs(cv) <= chartAspect)) reflectance = placed.surroundReflectance;
    else if (chart) reflectance = chart.reflectanceAt(cu, cv, nm);
    else reflectance = callerReflectance(placed ? { xM: u * scale, yM: v * scale, u, v, wavelengthNanometers: nm, chartU: cu, chartV: cv } : { xM: u * scale, yM: v * scale, u, v, wavelengthNanometers: nm });
    return reflectance * light!(cu, cv, u * scale, v * scale, nm) / Math.PI;
  }
  function radianceAt(u: number, v: number, nm: number): number {
    if (materialScene) return materialRadianceOf(callerMaterialAt(u, v), nm);
    if (placed) {
      // Fixed-size chart (2.3): chart-local frame units from the plane point in metres.
      const xM = u * scale, yM = v * scale, cu = xM / half, cv = yM / half;
      if (!(Math.abs(cu) <= 1 && Math.abs(cv) <= chartAspect)) return placed.surroundReflectance * irradianceScale * shapeAt(nm) / Math.PI;
      if (chart) return chart.reflectanceAt(cu, cv, nm) * irradianceScale * shapeAt(nm) / Math.PI;
      return callerValue({ xM, yM, u, v, wavelengthNanometers: nm, chartU: cu, chartV: cv }, nm);
    }
    if (chart) return chart.reflectanceAt(u, v, nm) * irradianceScale * shapeAt(nm) / Math.PI;
    return callerValue({ xM: u * scale, yM: v * scale, u, v, wavelengthNanometers: nm }, nm);
  }
  function callerReflectance(point: Readonly<ScenePlanePoint>): number {
    const value = (caller as CallerReflectanceScene).evaluate(point);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new InvalidConfigurationError("Scene reflectance function must return a value in [0, 1].");
    return value;
  }
  function callerValue(point: Readonly<ScenePlanePoint>, nm: number): number {
    if (caller!.kind === "reflectance-function") return callerReflectance(point) * irradianceScale * shapeAt(nm) / Math.PI;
    const value = (caller as CallerRadianceScene).evaluate(point);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new InvalidConfigurationError("Scene radiance function must return a finite non-negative radiance.");
    return value;
  }
  function result(request: Readonly<SceneRadianceEvaluationRequest>, radiance: number): SceneRadianceEvaluationResult {
    return { schemaVersion: "0.1.0", sampleId: request.sampleId, sceneId, providerProfileId, wavelengthNanometers: request.wavelengthNanometers,
      wavelengthBasis: request.wavelengthBasis as SceneRadianceEvaluationResult["wavelengthBasis"], quantity: "outgoing-spectral-radiance", unit: "W/m^2/sr/nm",
      spectralRadianceWattsPerSquareMeterSteradianNanometer: radiance, scientificStatus: "approximation", uncertainty: UNCERTAINTY, evidence, limitations };
  }
  /** Spectral radiance of material `material` (`materials.length`: a fixed-size chart's surround), in the chart's expression order. */
  function materialRadianceOf(material: number, nm: number): number {
    return materialReflectanceOf(material, nm) * irradianceScale * shapeAt(nm) / Math.PI;
  }
  function materialReflectanceOf(material: number, nm: number): number {
    const m = materials![material];
    let value: number;
    if (m === undefined) value = placed ? placed.surroundReflectance : NaN;
    else if (m.kind === "neutral") value = m.reflectance;
    else {
      value = m.spectrum.evaluate(nm);
      if (!(value >= 0 && value <= 1)) throw new InvalidConfigurationError("Chart reflectance spectrum left [0, 1].");
    }
    if (!(value >= 0)) throw new InvalidConfigurationError("Unknown chart material.");
    return value;
  }
  function chartMaterialAt(u: number, v: number): number {
    if (!placed) return chart!.materialAt(u, v);
    const cu = u * scale / half, cv = v * scale / half;
    return Math.abs(cu) <= 1 && Math.abs(cv) <= chartAspect ? chart!.materialAt(cu, cv) : chart!.materials.length;
  }
  const chartAccess = light ? {} : chart ? { chartMaterialAt, materialRadiance: materialRadianceOf } :
    materialScene ? { chartMaterialAt: callerMaterialAt, materialRadiance: materialRadianceOf } : {};
  // #394: evaluateRadiance's own plane-point arithmetic; radianceAt is then materialRadianceOf(material, nm) for both scene forms.
  const materialAtPoint = light ? undefined : chart ? chartMaterialAt : materialScene ? callerMaterialAt : undefined;
  const materialOfDirection = materialAtPoint === undefined ? undefined : (o: Readonly<{ x: number; y: number; z: number }>): number | undefined => {
    const lz = -o.z;
    if (!(lz > 0)) return undefined;
    const t = distance / lz;
    return materialAtPoint(-o.x * t / scale, -o.y * t / scale);
  };
  const radiance = light ? litRadianceAt : radianceAt;
  const provider: PlanarSceneRadianceProvider = {
    sceneId, providerProfileId, radianceAt: radiance, ...chartAccess,
    evaluateRadiance(request): SceneRadianceEvaluationResult {
      const target = request.target;
      if (target.kind !== "environment-direction") throw new InvalidConfigurationError("Planar scene provider needs environment-direction queries.");
      const o = target.outgoingDirectionUnitVector, lz = -o.z;
      if (!(lz > 0)) {
        if (zeroBeyondHorizon && Number.isFinite(lz)) return result(request, 0);
        throw new InvalidConfigurationError("Planar scene query does not point toward the scene plane.");
      }
      const t = distance / lz;
      return result(request, radiance(-o.x * t / scale, -o.y * t / scale, request.wavelengthNanometers));
    },
    evaluateApertureRadiance(request, ray): SceneRadianceEvaluationResult {
      const d = ray.directionUnitVector, origin = ray.originM;
      if (!(d.z > 0)) throw new InvalidConfigurationError("Planar scene pupil ray does not point toward the scene plane.");
      const t = (distance - origin.z) / d.z;
      return result(request, radiance((origin.x + d.x * t) / scale, (origin.y + d.y * t) / scale, request.wavelengthNanometers));
    }
  };
  if (materialOfDirection) MATERIAL_OF_DIRECTION.set(provider, materialOfDirection);
  return provider;
}

/** 2.3: a chart's physical size on the scene plane (`simulateCapture` `chartSize`, `createPlanarSceneRadianceProvider` `chartSize`). */
export interface ChartSizeOption {
  /** Chart width in metres, (0, 10 000]. */
  widthM: number;
  /** Chart height in metres. Default: widthM × the frame aspect (height / width), so the chart has the frame's shape. */
  heightM?: number;
  /** Neutral reflectance of the plane around the chart, lit by the same illuminant. Default 0.18. */
  surroundReflectance?: number;
}
/** Default surround of a fixed-size chart: an 18 % grey plane. */
export const CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE = 0.18;
/** Internal: validates a chart size and fills its defaults; `defaulted` names the fields taken from defaults. */
export function resolveChartSizeOption(value: unknown, frameAspect: number): { widthM: number; heightM: number; surroundReflectance: number; defaulted: ("heightM" | "surroundReflectance")[] } {
  requireInputObject(value, "chartSize");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!["widthM", "heightM", "surroundReflectance"].includes(key)) throw new InvalidConfigurationError("Unknown chartSize field: " + key + ".");
  const size = (x: unknown, name: string): number => {
    if (typeof x !== "number" || !Number.isFinite(x) || x <= 0 || x > 10_000) throw new InvalidConfigurationError("chartSize." + name + " must be a positive number of metres up to 10000.");
    return x;
  };
  const defaulted: ("heightM" | "surroundReflectance")[] = [];
  const widthM = size(record.widthM, "widthM");
  const heightM = record.heightM === undefined ? (defaulted.push("heightM"), widthM * frameAspect) : size(record.heightM, "heightM");
  const surround = record.surroundReflectance === undefined ? (defaulted.push("surroundReflectance"), CHART_SIZE_DEFAULT_SURROUND_REFLECTANCE) : record.surroundReflectance;
  if (typeof surround !== "number" || !Number.isFinite(surround) || surround < 0 || surround > 1) throw new InvalidConfigurationError("chartSize.surroundReflectance must be a reflectance in [0, 1].");
  return { widthM, heightM, surroundReflectance: surround, defaulted };
}

/**
 * Public scene-preset provider. Places an engine chart (or a declared `material-layers` scene, #491, evaluated as
 * its `callerScene`; or a caller reflectance, radiance or material function) on
 * a plane `distanceM` in front of the camera and `framedWidthM` wide (frame units u = ±1 at its edges),
 * lit by `illuminant` at `illuminanceLux`. The returned `evaluateRadiance` and `evaluateApertureRadiance`
 * follow the native environment RAW provider contract. They answer requests for scene `sceneId` and
 * provider `providerProfileId`.
 */
export function createPlanarSceneRadianceProvider(input: {
  scene: ChartScene | ChartMaterialLayerScene | CallerReflectanceScene | CallerRadianceScene | CallerMaterialScene;
  illuminant: CaptureIlluminant;
  illuminanceLux: number;
  distanceM: number;
  framedWidthM: number;
  /** Frame height / width. */
  aspect: number;
  sceneId: string;
  providerProfileId: string;
  /**
   * 2.3, opt-in: place the chart at this physical size, centred, instead of filling the frame; the chart preset
   * is resolved with aspect heightM / widthM and the rest of the plane is the surround.
   */
  chartSize?: ChartSizeOption;
}): PlanarSceneRadianceProvider & { chart: ResolvedChartScene | null } {
  requireInputObject(input, "createPlanarSceneRadianceProvider input");
  const keys = ["scene", "illuminant", "illuminanceLux", "distanceM", "framedWidthM", "aspect", "sceneId", "providerProfileId", "chartSize"];
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new InvalidConfigurationError("createPlanarSceneRadianceProvider input has unknown field \"" + key + "\".");
  for (const key of ["illuminanceLux", "distanceM", "framedWidthM", "aspect"] as const) {
    const value = input[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new InvalidConfigurationError(key + " must be a positive finite number.");
  }
  for (const key of ["sceneId", "providerProfileId"] as const) if (typeof input[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input[key])) throw new InvalidConfigurationError(key + " must be a public opaque ID.");
  requireInputObject(input.scene, "scene");
  const size = input.chartSize === undefined ? undefined : resolveChartSizeOption(input.chartSize, input.aspect), chartAspect = size ? size.heightM / size.widthM : input.aspect;
  const declared = (input.scene as { kind?: unknown }).kind === "material-layers" ? resolveChartMaterialLayers({ scene: input.scene as ChartMaterialLayerScene, aspect: chartAspect }) : undefined;
  const caller = declared ? requireCallerScene(declared.callerScene) : "kind" in input.scene ? requireCallerScene(input.scene) : undefined;
  const chart = caller ? null : resolveChartScene({ scene: input.scene as ChartScene, aspect: chartAspect });
  const illuminant = resolveCaptureIlluminant(input.illuminant);
  const provider = buildPlanarSceneRadianceProvider({ scene: chart ?? caller!, sceneId: input.sceneId, providerProfileId: input.providerProfileId, illuminant,
    irradianceScale: calculateIlluminantIrradianceScale(illuminant.shape, input.illuminanceLux),
    geometry: { distanceM: input.distanceM, metresPerFrameUnit: input.framedWidthM / 2,
      ...(size ? { chart: { widthM: size.widthM, heightM: size.heightM, surroundReflectance: size.surroundReflectance } } : {}) },
    evidence: [{ sourceOrigin: "photivra", sourceReference: "photivra:planar-scene-provider", reuseStatus: "photivra-owned" }],
    limitations: ["Planar Lambertian scene under uniform illumination; no shadows, inter-reflection, gloss or fluorescence."] });
  return { ...provider, chart };
}

/** Validates a caller scene record (a function scene as given; a material scene with its materials prepared). */
export function requireCallerScene(value: unknown): ResolvedCallerScene {
  requireInputObject(value, "scene");
  const record = value as Record<string, unknown>;
  if (record.kind === "material-function") {
    for (const key of Object.keys(record)) if (key !== "kind" && key !== "sceneId" && key !== "materials" && key !== "materialAt") throw new InvalidConfigurationError("Unknown scene field: " + key + ".");
    if (typeof record.materialAt !== "function" || typeof record.sceneId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(record.sceneId) ||
      !Array.isArray(record.materials) || record.materials.length < 1 || record.materials.length > CALLER_MATERIAL_SCENE_MAX_MATERIALS)
      throw new InvalidConfigurationError("A material scene needs a public sceneId, 1 to " + CALLER_MATERIAL_SCENE_MAX_MATERIALS + " materials and a materialAt function.");
    const inputs = [...record.materials as unknown[]];
    return Object.freeze({ kind: "material-function" as const, sceneId: record.sceneId, materialAt: record.materialAt as ResolvedCallerMaterialScene["materialAt"],
      materials: Object.freeze(inputs.map((m, index) => resolveChartMaterial(m, "scene.materials[" + index + "]"))),
      materialInputs: Object.freeze(inputs.map((m) => (typeof m === "number" ? undefined : m))) });
  }
  for (const key of Object.keys(record)) if (key !== "kind" && key !== "sceneId" && key !== "evaluate") throw new InvalidConfigurationError("Unknown scene field: " + key + ".");
  if ((record.kind !== "reflectance-function" && record.kind !== "radiance-function") || typeof record.evaluate !== "function" ||
    typeof record.sceneId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(record.sceneId)) throw new InvalidConfigurationError("A caller scene needs kind, a public sceneId and an evaluate function.");
  return record as unknown as CallerReflectanceScene | CallerRadianceScene;
}
