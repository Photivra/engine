// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";
import { calculateSensorEnvironmentRadianceQuery, calculateCameraRotationImageMapping,
  calculateSceneToSensorIrradianceQuadrature, type CalculateSensorEnvironmentRadianceQueryInput } from "../src/index.js";
import { sceneOpticalInput } from "./helpers/scene-optical-quadrature-fixture.js";

function request(): CalculateSensorEnvironmentRadianceQueryInput {
  const s=sceneOpticalInput().samples[0]!.sceneRadianceRequest;
  const { target, timeSecondsFromExposureStart, ...base }=s;
  void target; void timeSecondsFromExposureStart;
  return { sourcePointNativeSensorMm:{x:4,y:3}, focalLengthMm:50, focus:{kind:"infinity"},
    angularVelocityRadPerSec:{pitch:0,yaw:0,roll:0}, timeReference:"first-opening-boundary-phase",
    timeSecondsFromOpeningReference:.005, environmentDirectionConvention:"outgoing-radiance-toward-camera",request:base };
}

it("generates the opposite unit propagation direction from native coordinates without recentering",()=>{
  const r=request(),before=structuredClone(r),result=calculateSensorEnvironmentRadianceQuery(r).value;
  const length=Math.hypot(4,3,50);
  expect(result.referenceLookDirectionUnitVector).toEqual({x:4/length,y:-3/length,z:50/length});
  expect(result.request.target.outgoingDirectionUnitVector).toEqual({x:-4/length,y:3/length,z:-50/length});
  expect(result.sourcePointImagePlaneMm).toEqual({x:4,y:-3});
  expect(result.request.timeSecondsFromExposureStart).toBe(.005);
  expect(result).toMatchObject({geometricRayProjectionCalculated:true,sceneIntersectionCalculated:false,visibilityCalculated:false,providerExecuted:false});
  expect(r).toEqual(before);
  r.sourcePointNativeSensorMm.y=999;
  expect(result.sourcePointNativeSensorMm.y).toBe(3);
});

it("uses finite-focus thin-lens image distance without changing physical focal length",()=>{
  const r=request();r.focus={kind:"finite",distanceM:5};
  const result=calculateSensorEnvironmentRadianceQuery(r).value;
  const z=50*5000/(5000-50),length=Math.hypot(4,3,z);
  expect(result.projection!.value.projectionDistanceMm).toBeCloseTo(z,13);
  expect(result.referenceLookDirectionUnitVector.z).toBeCloseTo(z/length,14);
});

it.each(["pitch","yaw","roll"] as const)("reuses the analytic %s rotation and round-trips the reference ray",axis=>{
  const r=request();r.angularVelocityRadPerSec[axis]=2;
  const result=calculateSensorEnvironmentRadianceQuery(r).value;
  const forward=calculateCameraRotationImageMapping({focalLengthMm:r.focalLengthMm,
    imagePointMm:result.projection!.value.referenceImagePointMm,
    angularVelocityRadPerSec:r.angularVelocityRadPerSec,timeSecondsFromExposureStart:r.timeSecondsFromOpeningReference}).value;
  expect(forward.mappedImagePointMm.x).toBeCloseTo(4,12);
  expect(forward.mappedImagePointMm.y).toBeCloseTo(-3,12);
  // Independent axis-specific Rodrigues rotation of the captured look ray. The
  // camera basis (+X right, +Y up, +Z forward) is left-handed, so the physical
  // right-hand camera rotation is the component formula with a negated angle.
  const v={x:4,y:-3,z:50},a=-.01,c=Math.cos(a),s=Math.sin(a);
  const expected=axis==="pitch"?{x:v.x,y:c*v.y-s*v.z,z:s*v.y+c*v.z}:
    axis==="yaw"?{x:c*v.x+s*v.z,y:v.y,z:-s*v.x+c*v.z}:{x:c*v.x-s*v.y,y:s*v.x+c*v.y,z:v.z};
  const len=Math.hypot(expected.x,expected.y,expected.z);
  expect(result.referenceLookDirectionUnitVector.x).toBeCloseTo(expected.x/len,14);
  expect(result.referenceLookDirectionUnitVector.y).toBeCloseTo(expected.y/len,14);
  expect(result.referenceLookDirectionUnitVector.z).toBeCloseTo(expected.z/len,14);
});

it("binds distinct environment requests at actual pre-AA support through the optical node bridge",()=>{
  const scene=sceneOpticalInput();scene.timeSecondsFromExposureStart=.005;
  scene.samples=scene.samples.map(s=>{
    const p=scene.spatialQuadrature.nodes.find(p=>p.antiAliasingComponentIndex===s.node.spatialNode.antiAliasingComponentIndex&&
      p.apertureSampleXIndex===s.node.spatialNode.apertureSampleXIndex&&p.apertureSampleYIndex===s.node.spatialNode.apertureSampleYIndex)!;
    const {target,timeSecondsFromExposureStart,...base}=s.sceneRadianceRequest;
    void target;void timeSecondsFromExposureStart;
    const query=calculateSensorEnvironmentRadianceQuery({...request(),sourcePointNativeSensorMm:p.preAntiAliasingSourcePointMm,request:base}).value;
    return {...s,sceneRadianceRequest:query.request};
  });
  const result=calculateSceneToSensorIrradianceQuadrature(scene).value;
  expect(result.samples).toHaveLength(scene.samples.length);
  expect(result.sceneProviderExecutionVerified).toBe(false);
  for(const s of result.samples)expect(s.request.target.outgoingDirectionUnitVector.z).toBeLessThan(0);
});

it.each(["clock","direction","time","point","focus","focal","wavelength","behind"])("rejects %s",fault=>{
  const r=request();
  if(fault==="clock")r.timeReference="other" as typeof r.timeReference;
  if(fault==="direction")r.environmentDirectionConvention="other" as typeof r.environmentDirectionConvention;
  if(fault==="time")r.timeSecondsFromOpeningReference=-1;
  if(fault==="point")r.sourcePointNativeSensorMm.x=NaN;
  if(fault==="focus")r.focus={kind:"other"} as unknown as typeof r.focus;
  if(fault==="focal")r.focalLengthMm=0;
  if(fault==="wavelength")r.request.wavelengthBasis="unspecified" as typeof r.request.wavelengthBasis;
  if(fault==="behind")r.angularVelocityRadPerSec.yaw=400;
  expect(()=>calculateSensorEnvironmentRadianceQuery(r)).toThrow();
});

it.each(["fisheye-equidistant", "fisheye-equisolid-angle", "fisheye-stereographic", "fisheye-orthographic", "equirectangular"] as const)(
  "checks focal length, source point and angular velocity with the %s mapping as on the plain path (optics-18, #700)", (projectionModel) => {
    const mapped = (edit: (r: CalculateSensorEnvironmentRadianceQueryInput) => void) => {
      const r = { ...request(), lensFieldMapping: { projectionModel, distortion: { kind: "none" as const }, radiometricAreaCorrection: "inverse-distortion-jacobian" as const } };
      edit(r);
      return (): unknown => calculateSensorEnvironmentRadianceQuery(r);
    };
    expect(mapped(() => {})).not.toThrow();
    expect(mapped((r) => { r.focalLengthMm = -50; })).toThrow("focalLengthMm must be a finite number greater than zero.");
    expect(mapped((r) => { r.focalLengthMm = 0; })).toThrow("focalLengthMm must be a finite number greater than zero.");
    expect(mapped((r) => { (r as { focalLengthMm: unknown }).focalLengthMm = "50"; })).toThrow("focalLengthMm must be a finite number greater than zero.");
    expect(mapped((r) => { (r.sourcePointNativeSensorMm as unknown) = { x: "4", y: "3" }; })).toThrow("sourcePointNativeSensorMm.x must be finite.");
    expect(mapped((r) => { (r.angularVelocityRadPerSec as unknown) = { pitch: "1", yaw: 0, roll: 0 }; })).toThrow("angularVelocityRadPerSec.pitch must be finite.");
  });
