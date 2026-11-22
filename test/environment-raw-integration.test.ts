// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { calculateEnvironmentSensorPhotoSignal, simulateEnvironmentSensorRawFrame, createPhotographicExportPair,
  InvalidConfigurationError, type SceneRadianceEvaluationRequest, type SceneRadianceEvaluationResult } from "../src/index.js";
import { input as sensorInput } from "./helpers/eqe-exposure-fixture.js";
import { evidence } from "./helpers/eqe-response-fixture.js";
import { frameInput, siteInput, evaluator } from "./helpers/environment-raw-fixture.js";
import { loadPhotographicExportInput } from "./helpers/photographic-export-fixture.js";


it.each([false, true])("executes every source query and independently integrates SI photon/EQE counts (psf=%s)", psf => {
  const input = siteInput(sensorInput(), psf), { evaluateRadiance: _, ...data } = input;void _;
  const before = structuredClone(data), queries: SceneRadianceEvaluationRequest[] = [];
  input.evaluateRadiance = (q): SceneRadianceEvaluationResult => { expect(Object.isFrozen(q.target.outgoingDirectionUnitVector)).toBe(true);queries.push(q);return evaluator(q); };
  const result = calculateEnvironmentSensorPhotoSignal(input).value;
  const expected = [425,475].reduce((sum,nm) => sum + 2*Math.PI/64*(.8-(nm-400)*.004)*480000e-12*50*nm*1e-9/(6.62607015e-34*299792458)*(.2+(nm-400)*.004)*.01,0);
  expect(result.photo.value.photoSignal.expectedGeneratedElectronCount/expected).toBeCloseTo(1,14);
  expect(result.providerEvaluationCount).toBe(psf ? 144 : 16);
  expect(queries).toHaveLength(result.providerEvaluationCount);
  expect(new Set(queries.map(q=>q.sampleId)).size).toBe(queries.length);
  expect(result).toMatchObject({providerCallbackExecuted:true,providerTransportVerified:false,sceneVisibilityCalculated:false,productionPlanActivated:false});
  expect(result.instants[0]!.evaluations[0]!.query.value.sourcePointImagePlaneMm.y).toBe(-result.instants[0]!.evaluations[0]!.query.value.sourcePointNativeSensorMm.y);
  expect(data).toEqual(before);
});

it("angular environment gradients see distinct rotated inverse PSF rays including zero-weight taps",()=>{
  const input=siteInput(), seen: number[]=[];
  input.evaluateRadiance=(q): SceneRadianceEvaluationResult => {seen.push(q.target.outgoingDirectionUnitVector.x);const r=evaluator(q);r.spectralRadianceWattsPerSquareMeterSteradianNanometer=(2+q.target.outgoingDirectionUnitVector.x)*(1+200*q.timeSecondsFromExposureStart);return r;};
  const result=calculateEnvironmentSensorPhotoSignal(input).value;
  expect(new Set(seen).size).toBeGreaterThan(8);
  const instant=result.instants[0]!, psf=instant.psf!.value;
  for(let i=0;i<psf.samples.length;i++){
    const values=instant.evaluations.slice(i*9,(i+1)*9).map(e=>e.optics.value.sensorPlaneSpectralIrradianceWattsPerSquareMeterNanometer);
    const expected=.25*values[4]!+.25*values[5]!+.5*values[7]!;
    expect(psf.irradianceSamples[i]!.spectralIrradianceWattsPerSquareMeterPerNanometer).toBeCloseTo(expected,14);
  }
});

it.each([[false,false],[true,false],[false,true],[true,true]])("commits local times through dark/noise/ADC and paired DNG/JPEG (rolling=%s, psf=%s)",async (rolling,sampledPsf)=>{
  const input=frameInput(rolling,sampledPsf), result=simulateEnvironmentSensorRawFrame(input);
  expect(simulateEnvironmentSensorRawFrame(input)).toEqual(result);
  expect(result.value.raw.value.upstreamRadiometryVerified).toBe(false);
  const ids=result.value.sites.flatMap(s=>s.value.instants.flatMap(t=>t.evaluations.map(e=>e.query.value.request.sampleId)));
  expect(new Set(ids).size).toBe(ids.length);
  result.value.sites.forEach((s,i)=>{
    const p=s.value.photo.value.photoSignal;
    expect(result.value.raw.value.sites[i]!.accumulatedCharge.value.totalExpectedStoredElectronCount).toBe(p.expectedGeneratedElectronCount+4*p.localExposureDurationSeconds);
    if(rolling)expect(p.startOffsetSecondsFromOpeningReference).toBeGreaterThan(0);
  });
  const output=loadPhotographicExportInput();output.reconstruction.rawFrame=result.value.raw.value.frame;
  const pair=await createPhotographicExportPair(output);
  expect(await createPhotographicExportPair(output)).toEqual(pair);
  expect(pair.imageDataPairing).toBe("jpeg-generated-from-exact-attached-raw");
  const bytes=pair.dng.bytes, view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let strip=-1;
  for(let i=0;i<view.getUint16(8,true);i++){const o=10+12*i;if(view.getUint16(o,true)===273)strip=view.getUint32(o+8,true);}
  expect(strip).toBeGreaterThan(0);
  expect(Array.from({length:4},(_,i)=>view.getUint16(strip+2*i,true))).toEqual(result.value.raw.value.frame.samples.map(s=>s.rawCode));
});

it.each(["count","clock","plane","basis","psf-state","psf-evidence","budget","behind","unity"])("rejects invalid site preflight before provider invocation: %s",fault=>{
  const r=siteInput();let calls=0;r.evaluateRadiance=(q): SceneRadianceEvaluationResult => {calls++;return evaluator(q);};
  if(fault==="count")r.temporalSampleCount=257;
  if(fault==="clock")r.motion.timeReference="other" as typeof r.motion.timeReference;
  if(fault==="plane")r.sensor.responseApplication.sourcePlane.value="site-incident";
  if(fault==="basis"&&r.psf.kind==="sampled-local")r.psf.configuration.psfWavelengthBasis.value="air";
  if(fault==="psf-state"&&r.psf.kind==="sampled-local")r.psf.configuration.psf.apertureFNumber=8;
  if(fault==="psf-evidence"&&r.psf.kind==="sampled-local")r.psf.configuration.spatialModel.evidence=[];
  if(fault==="budget"){r.temporalSampleCount=256;r.sensor.spatialSampling.spatialSampleCountX=16;r.sensor.spatialSampling.spatialSampleCountY=16;}
  if(fault==="behind")r.motion.angularVelocityRadPerSec.yaw=1000;
  if(fault==="unity")r.fieldThroughput.evidence=[];
  expect(()=>calculateEnvironmentSensorPhotoSignal(r)).toThrow();expect(calls).toBe(0);
});

it.each(["identity","basis","negative","promise","throw","mutation"])("fails closed on provider behavior: %s",fault=>{
  const r=siteInput();r.evaluateRadiance=(q): SceneRadianceEvaluationResult => {
    if(fault==="throw")throw Error("provider unavailable");
    if(fault==="mutation"){q.target.outgoingDirectionUnitVector.x=99;}
    const s=evaluator(q);if(fault==="identity")s.sampleId="stale";if(fault==="basis")s.wavelengthBasis="air";
    if(fault==="negative")s.spectralRadianceWattsPerSquareMeterSteradianNanometer=-1;
    return fault==="promise"?Promise.resolve(s) as unknown as SceneRadianceEvaluationResult:s;
  };expect(()=>calculateEnvironmentSensorPhotoSignal(r)).toThrow();
});

it.each(["missing","sparse","site","geometry","focus","scene","time","duration","duplicate","event","aggregate-budget","motion-drift","optics-drift","psf-drift"])("rejects frame mismatch before provider invocation: %s",fault=>{
  const {evaluateRadiance,...data}=frameInput();const r={...structuredClone(data),evaluateRadiance};let calls=0;r.evaluateRadiance=(q): SceneRadianceEvaluationResult => {calls++;return evaluator(q);};
  if(fault==="missing")r.sites=r.sites.slice(1);if(fault==="sparse")r.sites=new Array(4);
  if(fault==="site")r.sites[0]!.environment.sensor.spatialSampling.site.x=1;
  if(fault==="geometry")r.sites[0]!.environment.sensor.spatialSampling.imagingArea={...r.sites[0]!.environment.sensor.spatialSampling.imagingArea,widthMm:99};
  if(fault==="focus")r.sites[0]!.environment.optics.focus={kind:"ideal-symmetric-thin-lens",objectDistanceM:100,pupilMagnificationAssumption:"unity"};
  if(fault==="scene")r.sceneBinding.sceneStateId="stale";
  if(fault==="time")r.frame.capture.sceneTimeSeconds=1;
  if(fault==="duration")r.exposureWindow.nominalExposureDurationSeconds.value*=2;
  if(fault==="duplicate")r.sites[1]!.environment.temporalIntegrationId=r.sites[0]!.environment.temporalIntegrationId;
  if(fault==="event")r.sites[0]!.environment.sensor.localExposure.exposureWindowInput.closing={kind:"uniform-linear-native-scan",directionNative:{value:"top-to-bottom",evidence:evidence("test:scan")},traversalDurationSeconds:{value:.002,unit:"s",evidence:evidence("test:scan")}};
  if(fault==="motion-drift")r.sites[1]!.environment.motion.angularVelocityRadPerSec.yaw=9;
  if(fault==="optics-drift")r.sites[1]!.environment.optics.profile.profileVersion="other";
  if(fault==="psf-drift"&&r.sites[1]!.environment.psf.kind==="not-applied")r.sites[1]!.environment.psf.limitation="Different lens path.";
  if(fault==="aggregate-budget")for(const site of r.sites){site.environment.temporalSampleCount=256;site.environment.sensor.spatialSampling.spatialSampleCountX=8;site.environment.sensor.spatialSampling.spatialSampleCountY=8;}
  expect(()=>simulateEnvironmentSensorRawFrame(r)).toThrow();expect(calls).toBe(0);
});

it("snapshots caller state against callback changes and preserves canonical property ordering",()=>{
  const r=frameInput(), altered=r.sites[0]!.environment;
  const profile=altered.optics.profile;
  altered.optics.profile={...profile,profileId:profile.profileId};
  const expected=simulateEnvironmentSensorRawFrame(r);
  let changed=false;
  r.evaluateRadiance=(q): SceneRadianceEvaluationResult=>{
    if(!changed){changed=true;altered.optics.focalLengthMm=999;r.exposureWindow.nominalExposureDurationSeconds.value=9;}
    return evaluator(q,1e-9);
  };
  expect(simulateEnvironmentSensorRawFrame(r)).toEqual(expected);
});

it("refuses a missing frame, exposure window or scene binding with a domain error (capture-32, #698)",()=>{
  const base=frameInput(false,false);
  const cases:Record<string,unknown>[]=[{...base,frame:undefined},{...base,frame:{...base.frame,capture:undefined}},{...base,exposureWindow:{}},
    {...base,exposureWindow:undefined},{...base,sceneBinding:undefined},{evaluateRadiance:base.evaluateRadiance,sceneBinding:{},exposureWindow:{},sites:[]}];
  for(const c of cases)expect(()=>simulateEnvironmentSensorRawFrame(c as never)).toThrow(InvalidConfigurationError);
});
