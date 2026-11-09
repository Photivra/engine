// SPDX-License-Identifier: Apache-2.0

/**
 * Native RAW capture from a scene-radiance provider: source radiance → optics → EQE (external quantum
 * efficiency) → packed RAW codes for the full native sensor, within fixed work limits.
 */
import {internalRadianceAccess,isInternalNativeTileReader,isInternalSceneRadianceEvaluator} from "../core/internal-radiance-evaluator.js";
import { calculateNativeRawPlan, createNativeRawTaskWithCadence, nativeRawMaximumProviderEvaluations, type NativeRawInput, type NativeRawOutput,
  type NativeRawPlan, type NativeRawTask, type NativeRawTileRequest, type NativeRawTaskState } from "./native-raw.js";
import { createPhaseWhiteLevelAccumulator } from "./raw-white-level.js";
import type { SensorRawProducerSiteInput } from "./sensor-raw-producer.js";
import { createEnvironmentRawFrameCanonicalMemo, planEnvironmentRawSite, type SimulateEnvironmentSensorRawFrameInput } from "./environment-raw-producer.js";
import { DEFAULT_HOST_YIELD_CADENCE, createHostYieldGate, type HostYieldCadence } from "./host-yield-cadence.js";
import { executeEnvironmentSensorPhotoSignal, prebuildApertureRadianceQuery } from "../sensor/environment-photo-signal.js";
import { composeNativeEnvironmentSensorSite, createNativeEnvironmentOpticalStageRecorder, createSensorStageRawTask, parseNativeEnvironmentOpticalStageRetention, type NativeEnvironmentOpticalStage, type NativeEnvironmentOpticalStageRetention, type NativeEnvironmentSensorStageInput, type NativeEnvironmentSensorStageProvider, canonical } from "./native-environment-optical-stage.js";
import { parseEvidenceList } from "../core/evidence-provenance.js";
import { rejectUnknownFields, requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { createNativeEnvironmentLeanExecutor, createNativeEnvironmentSensorLean, isLeanEnvironmentPlan,
  type LeanEnvironmentPlan } from "./native-environment-lean.js";
import { prepareCaptureExposureWindowSampler } from "../sensor/exposure-window.js";
import type { SensorEqeTemporalPhotoSignal } from "../sensor/temporal-photo-signal.js";
import type { SceneRadianceEvaluationRequest, SceneRadianceEvaluationResult } from "../schema/scene-radiance.js";
import type { SensorApertureRay } from "../optics/sensor-aperture-rays.js";

type SitePlan = ReturnType<typeof planEnvironmentRawSite> | LeanEnvironmentPlan;
type PhotoSignal = SensorEqeTemporalPhotoSignal;

export interface NativeEnvironmentRawInput {
  raw: NativeRawInput;
  sceneBinding: SimulateEnvironmentSensorRawFrameInput["sceneBinding"];
  /** Budget of provider calls for the whole capture, checked before work starts; at most 2 billion. Staying within it does not imply convergence. */
  maximumProviderEvaluations: number;
  /**
   * Optional: keep the optical stage (per-site expected photo signal, tied to every optical input) on the
   * output, for createNativeEnvironmentSensorStageTask. If omitted, behaviour and output shape are unchanged.
   */
  opticalStage?: NativeEnvironmentOpticalStageRetention;
}
export interface NativeEnvironmentRawTile extends NativeRawTileRequest {
  sites: SimulateEnvironmentSensorRawFrameInput["sites"];
}
/** One radiance query of a batch: the frozen provider request and, for an ideal-pupil ray, its frozen aperture ray. */
export interface NativeEnvironmentRadianceQuery {
  request: Readonly<SceneRadianceEvaluationRequest>;
  apertureRay?: Readonly<SensorApertureRay>;
}
export interface NativeEnvironmentRawProvider {
  /** Supplies physical site profiles, not photo counts or precomputed RAW codes. */
  readTile(request: Readonly<NativeRawTileRequest>,signal:AbortSignal):Promise<NativeEnvironmentRawTile>;
  evaluateRadiance: SimulateEnvironmentSensorRawFrameInput["evaluateRadiance"];
  evaluateApertureRadiance?: SimulateEnvironmentSensorRawFrameInput["evaluateApertureRadiance"];
  /**
   * Optional batched light sampling (2.0, additive). When present, the engine makes one call per tile instead of one
   * evaluateRadiance or evaluateApertureRadiance call per query. `queries` holds every query of the tile's sites, in
   * exactly the order the per-query callbacks would be made, each with the same frozen request (and aperture ray).
   * Return one result per query, in the same order; a promise is allowed (for example a GPU readback). Each result
   * is validated by the same parser and binding checks as a per-query result, so for the same results the output is
   * byte-identical. The per-query evaluators stay required as the reference contract, but are not called.
   */
  evaluateRadianceBatch?(queries:readonly NativeEnvironmentRadianceQuery[],signal:AbortSignal):
    readonly SceneRadianceEvaluationResult[]|Promise<readonly SceneRadianceEvaluationResult[]>;
  /** Optional, bounded diagnostic callback. Counts are expected values before any noise, clipping or ADC (analogue-to-digital conversion). */
  observePhotoTile?(tile:Readonly<NativeEnvironmentPhotoTile>,signal:AbortSignal):void|Promise<void>;
  yieldControl(signal:AbortSignal):Promise<void>;
}
export interface NativeEnvironmentPhotoTile extends NativeRawTileRequest {
  sites:readonly {nativeIndex:number;expectedIncidentPhotonCount:number;expectedGeneratedElectronCount:number}[];
}
export interface NativeEnvironmentRawOutput {
  raw: NativeRawOutput;
  sceneBinding: NativeEnvironmentRawInput["sceneBinding"];
  providerEvaluationCount: number;
  upstreamOrigin: "executed-environment-query-provider-optics-psf-eqe";
  providerTransportVerified: false;
  productionPlanActivated: false;
  /** Present only when NativeEnvironmentRawInput.opticalStage was requested. The caller owns and disposes it. */
  opticalStage?: NativeEnvironmentOpticalStage;
}
export interface NativeEnvironmentRawTask extends Omit<NativeRawTask,"takeOutput"> {
  readonly providerEvaluationCount: number;
  takeOutput(): NativeEnvironmentRawOutput;
}
/** Site-environment fields that one native event shares across every site (same set as the optical-stage binding). */
const SHARED_STATE_KEYS = ["sceneBindings","optics","motion","psf","pupil","fieldThroughput"] as const;
type SiteEnvironment = SimulateEnvironmentSensorRawFrameInput["sites"][number]["environment"];
/** The frame's first accepted shared state: its canonical string and its engine-owned (cloned) values. */
interface SharedStateReference {
  readonly canonical: string;
  readonly values: readonly unknown[];
  /** Arrays of the reference already checked to carry no holes or extra properties. */
  readonly cleanArrays: WeakSet<object>;
}
/**
 * Strict structural equality of structured-clone output against the reference: Object.is for primitives (0 and
 * -0 differ), identical prototypes limited to plain records and arrays, identical own keys in identical order,
 * and arrays with no holes or non-index properties. Anything else is unequal unless it is the same reference.
 * Equal values therefore serialize to the same canonical string and are interchangeable for every reader, so a
 * site may adopt the reference values. Recursion is bounded by the reference, which serialized without error.
 */
function samePlainData(value: unknown, reference: unknown, cleanArrays: WeakSet<object>): boolean {
  if (Object.is(value, reference)) return true;
  if (typeof value !== "object" || typeof reference !== "object" || value === null || reference === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.getPrototypeOf(reference)) return false;
  if (prototype === Array.prototype) {
    const a = value as unknown[], b = reference as unknown[], length = a.length;
    if (length !== b.length) return false;
    for (let index = 0; index < length; index++) if (!(index in a) || !(index in b) || !samePlainData(a[index], b[index], cleanArrays)) return false;
    // Holes are excluded above, so equal key counts exclude non-index properties as well.
    if (Object.keys(a).length !== length) return false;
    if (!cleanArrays.has(b)) { if (Object.keys(b).length !== length) return false; cleanArrays.add(b); }
    return true;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const a = value as Record<string, unknown>, b = reference as Record<string, unknown>, keys = Object.keys(a), referenceKeys = Object.keys(b);
  if (keys.length !== referenceKeys.length) return false;
  for (let index = 0; index < keys.length; index++) if (keys[index] !== referenceKeys[index]) return false;
  for (let index = 0; index < keys.length; index++) if (!samePlainData(a[keys[index]!], b[keys[index]!], cleanArrays)) return false;
  return true;
}
/**
 * Replaces a site's private copy of the shared state with the frame's reference values when every field is
 * strictly equal (a 2.0 performance change). All sites then share one engine-owned shared state, so its sampled
 * PSF is parsed and frozen once per frame and duplicate copies can be garbage-collected at once. `verified`
 * holds copies in the current tile already shown equal, so sites the supplier built from one object compare in
 * O(1). Returns false, changing nothing, when any field differs; the caller then serializes as before.
 */
function adoptSharedState(environment: SiteEnvironment, reference: SharedStateReference, verified: unknown[]): boolean {
  const record = environment as unknown as Record<string, unknown>;
  for (let index = 0; index < SHARED_STATE_KEYS.length; index++) {
    const value = record[SHARED_STATE_KEYS[index]!];
    if (!(typeof value === "object" && value !== null && value === verified[index]) && !samePlainData(value, reference.values[index], reference.cleanArrays)) return false;
  }
  for (let index = 0; index < SHARED_STATE_KEYS.length; index++) {
    const key = SHARED_STATE_KEYS[index]!, value = record[key];
    if (value !== reference.values[index]) { verified[index] = value; record[key] = reference.values[index]; }
  }
  return true;
}
/**
 * Every radiance query the executors will make for these site plans, in their callback order: per site, per instant,
 * per group (spectral-major, spatial-minor), per tap, then per pupil ray. Pupil queries come from the executors' own
 * apertureRadianceQuery, which then hands the executor the same objects.
 */
function tileQueries(plans:readonly SitePlan[]):NativeEnvironmentRadianceQuery[] {
  const queries:NativeEnvironmentRadianceQuery[]=[];
  const add=(planned:{request?:SceneRadianceEvaluationRequest;apertureRays?:readonly SensorApertureRay[]}):void=>{
    // A batch never has material taps (#394), so every planned tap carries its request.
    const tap=planned as {request:SceneRadianceEvaluationRequest;apertureRays?:readonly SensorApertureRay[]};
    if(tap.apertureRays===undefined){queries.push({request:tap.request});return;}
    // The executor later receives these same objects (apertureRadianceQuery), so they are built once.
    for(const ray of tap.apertureRays)queries.push(prebuildApertureRadianceQuery(tap.request,ray));
  };
  for(const p of plans){
    if(isLeanEnvironmentPlan(p)){for(const instant of p.instants)for(const tap of instant.taps)add(tap);}
    else for(const instant of p.instants)for(const group of instant.groups)for(const tap of group.taps)add(tap);
  }
  return queries;
}
function parseSceneBinding(value: unknown): NativeEnvironmentRawInput["sceneBinding"] {
  const binding=requireAllowlistedRecord(value,["sceneStateId","providerSceneId","evidence"],"Invalid native scene binding.");
  return freezeOwnedData({sceneStateId:requirePublicOpaqueId(binding.sceneStateId,"Invalid scene-state ID."),providerSceneId:requirePublicOpaqueId(binding.providerSceneId,"Invalid provider-scene ID."),evidence:parseEvidenceList(binding.evidence,"nativeEnvironmentSceneBinding.evidence")});
}
/**
 * Creates the native RAW task. Every tile is planned and checked against the limits before its radiance
 * callbacks run, and no partial output is ever returned.
 *
 * The task also yields to the host between sites inside a tile once about 8 ms of work has passed (one budget
 * shared with the tile loop). Cancellation is checked after each such yield, so cancel() takes effect within
 * about one site's work. Yield timing never changes tile requests, limit checks, callbacks or output.
 */
export function createNativeEnvironmentRawTask(input:NativeEnvironmentRawInput,provider:NativeEnvironmentRawProvider):NativeEnvironmentRawTask {
  return createNativeEnvironmentRawTaskWithCadence(input,provider,DEFAULT_HOST_YIELD_CADENCE);
}
/** Internal: the same task with an explicit host-yield timing. Timing never changes tiles, callbacks or output. Not exported from the package. */
/** Validates a native environment input exactly as task creation does, before any callback. Internal (also the tabulated RAW path, #394). */
export function admitNativeEnvironmentInput(input:NativeEnvironmentRawInput):{plan:ReturnType<typeof calculateNativeRawPlan>;
  sceneBinding:NativeEnvironmentRawInput["sceneBinding"];retention:NativeEnvironmentOpticalStageRetention|undefined;maximum:number} {
  const r=requireAllowlistedRecord(input,["raw","sceneBinding","maximumProviderEvaluations","opticalStage"],"Invalid native environment input.");
  const plan=calculateNativeRawPlan(input.raw),sceneBinding=parseSceneBinding(r.sceneBinding);
  const retention=r.opticalStage===undefined?undefined:parseNativeEnvironmentOpticalStageRetention(r.opticalStage);
  if(sceneBinding.sceneStateId!==plan.exposure.sceneStateId||plan.exposure.sceneTimeSeconds!==0||!plan.exposureWindow||
    typeof r.maximumProviderEvaluations!=="number"||!Number.isSafeInteger(r.maximumProviderEvaluations)||r.maximumProviderEvaluations<plan.pixelCount||r.maximumProviderEvaluations>nativeRawMaximumProviderEvaluations(plan))
    throw new InvalidConfigurationError("Native environment requires opening-reference scene binding, an explicit shutter event and bounded full-event query budget.");
  return {plan,sceneBinding,retention,maximum:r.maximumProviderEvaluations};
}
/** Internal: a partition's row band, and the facts it records while running for the merge step. */
interface NativeEnvironmentPartitionProbe {
  readonly rows:NativeRawRowBand;
  /** Internal (2.3 region rendering): native columns [x, x + width); absent means every column. */
  readonly columns?:{readonly x:number;readonly width:number};
  /** Canonical string of the band's shared source/optical/motion state (the first site's). */
  shared?:string;
  /** The band's first parsed RAW site (its readout identity). */
  firstSite?:SensorRawProducerSiteInput;
}
export function createNativeEnvironmentRawTaskWithCadence(input:NativeEnvironmentRawInput,provider:NativeEnvironmentRawProvider,
  cadence:HostYieldCadence,partition?:NativeEnvironmentPartitionProbe):NativeEnvironmentRawTask {
  const {plan,sceneBinding,retention,maximum}=admitNativeEnvironmentInput(input);
  if(partition&&retention)throw new InvalidConfigurationError("A native environment partition cannot retain the optical stage.");
  if(!provider||typeof provider.readTile!=="function"||typeof provider.evaluateRadiance!=="function"||typeof provider.yieldControl!=="function"||
    (provider.evaluateApertureRadiance!==undefined&&typeof provider.evaluateApertureRadiance!=="function")||
    (provider.observePhotoTile!==undefined&&typeof provider.observePhotoTile!=="function")||
    (provider.evaluateRadianceBatch!==undefined&&typeof provider.evaluateRadianceBatch!=="function"))throw new InvalidConfigurationError("Native environment requires physical source callbacks and host yields.");
  // 2.6: an engine-built evaluator (simulateCapture chart scenes) lets the lean path skip re-parsing the fixed parts of
  // its results; read once, so the checked function is the one bound. Never with a batch, whose results are the caller's.
  const evaluateFunction=provider.evaluateRadiance,internalEvaluator=provider.evaluateRadianceBatch===undefined&&isInternalSceneRadianceEvaluator(evaluateFunction);
  const internalSites=isInternalNativeTileReader(provider.readTile),read=provider.readTile.bind(provider),evaluate=evaluateFunction.bind(provider),aperture=provider.evaluateApertureRadiance?.bind(provider),yieldControl=provider.yieldControl.bind(provider);
  const observe=provider.observePhotoTile?.bind(provider),batch=provider.evaluateRadianceBatch?.bind(provider);
  let evaluations=0,shared:string|undefined,reference:SharedStateReference|undefined;
  const recorder=retention?createNativeEnvironmentOpticalStageRecorder(plan,sceneBinding,retention):undefined;
  const memo=createEnvironmentRawFrameCanonicalMemo(plan.frame,plan.exposureWindow!),gate=createHostYieldGate(cadence);
  const layout=plan.frame.colorSamplingProfile.layout,relationship=plan.frame.bindingProfile.relationship;
  const leanFrame={frameId:plan.frame.frameId,nativeWidth:plan.exposure.geometry.nativeRaster.pixelWidth,
    nativeHeight:plan.exposure.geometry.nativeRaster.pixelHeight,repeatWidth:layout.kind==="periodic-mosaic"?layout.repeatWidthSites:0,
    repeatHeight:layout.kind==="periodic-mosaic"?layout.repeatHeightSites:0,
    identityBinding:relationship.sitesPerNativeSampleX===1&&relationship.sitesPerNativeSampleY===1&&relationship.anchor==="shared-native-top-left"};
  // #394: an engine-built evaluator's key lookup lets verified templates skip its calls (never with a batch).
  const lean=createNativeEnvironmentLeanExecutor(leanFrame,internalEvaluator?internalRadianceAccess(evaluateFunction):undefined);
  let nativeWindow:Parameters<typeof createNativeEnvironmentSensorLean>[2];
  try{nativeWindow=prepareCaptureExposureWindowSampler({...plan.exposureWindow!,nativeRaster:plan.exposure.geometry.nativeRaster});}catch{nativeWindow=undefined;}
  const sensorLean=createNativeEnvironmentSensorLean(leanFrame,plan.frame,nativeWindow);
  const task=createNativeRawTaskWithCadence(input.raw,{
    async readTile(request,signal){
      const supplied=await read(request,signal);
      if(signal.aborted)throw new InvalidConfigurationError("Native environment acquisition aborted.");
      const tile=requireAllowlistedRecord(supplied,["captureId","frameId","x","y","width","height","sites"],"Invalid physical source tile.");
      for(const key of Object.keys(request) as (keyof NativeRawTileRequest)[])if(tile[key]!==request[key])throw new InvalidConfigurationError("Physical source tile identity mismatch.");
      if(!Array.isArray(tile.sites)||tile.sites.length!==request.width||Array.from({length:request.width},(_,i)=>i in (tile.sites as unknown[])).includes(false))throw new InvalidConfigurationError("Physical source tile needs exact native coverage.");
      // Private copy: planning takes each site environment as engine-owned plan data without copying it again. Sites from an
      // engine-built reader (#394: fresh records per call, never shown to supplied code or changed) are already the engine's own.
      const sites=(internalSites?tile.sites:structuredClone(tile.sites)) as SimulateEnvironmentSensorRawFrameInput["sites"];
      // Yield to the host between sites on the shared time budget. Cancellation is honoured right after it.
      const pause=async():Promise<void>=>{
        if(!gate.due())return;
        await yieldControl(signal);
        if(signal.aborted)throw new InvalidConfigurationError("Native environment acquisition aborted.");
        gate.restart();
      };
      let tileCount=0;
      const plans:SitePlan[]=[],verified:unknown[]=[];
      for(let j=0;j<sites.length;j++){
        if(j>0)await pause();
        const site=sites[j]!;
        requireAllowlistedRecord(site,["environment","darkCurrentProfile","operatingTemperatureC","charge","readout"],"Invalid physical site input.");
        const e=site.environment,index=request.y*plan.exposure.geometry.nativeRaster.pixelWidth+request.x+j;
        if(e.temporalIntegrationId!==plan.frame.frameId+":native:"+index)throw new InvalidConfigurationError("Native environment IDs must bind the absolute native index.");
        // A site strictly equal to the frame's first shared state adopts it and skips serialization; otherwise the
        // canonical comparison runs exactly as before and decides acceptance or the same error.
        let state:string;
        if(reference!==undefined&&adoptSharedState(e,reference,verified))state=reference.canonical;
        else{
          state=canonical({sceneBindings:e.sceneBindings,optics:e.optics,motion:e.motion,psf:e.psf,pupil:e.pupil,fieldThroughput:e.fieldThroughput});
          shared??=state;if(partition)partition.shared??=shared;if(state!==shared)throw new InvalidConfigurationError("Native event requires one shared source/optical/motion state.");
          reference??={canonical:state,values:SHARED_STATE_KEYS.map(key=>(e as unknown as Record<string,unknown>)[key]),cleanArrays:new WeakSet()};
        }
        // A site matching a verified template gets a lean plan (identical requests and limit checks; see
        // native-environment-lean.ts). A template candidate keeps full query records for its self-check.
        // Otherwise only the photo signal is needed, so the plan keeps just each query's frozen request and image-plane point.
        const leanPlan=lean.plan(e,index);
        let p:SitePlan;
        if(typeof leanPlan==="object")p=leanPlan;
        else{
          p=planEnvironmentRawSite(site,index,plan.frame,sceneBinding,plan.exposureWindow!,"engine-owned",memo,leanPlan==="candidate"?"full":"photo-only");
          if(leanPlan==="candidate")lean.admitCandidate(e,index,p);
        }
        if(p.owned.pupil&&!aperture)throw new InvalidConfigurationError("Pupil capture requires origin-aware source visibility.");
        recorder?.admit(index,e,state);
        tileCount+=p.count;
        if(tileCount>100_000||evaluations+tileCount>maximum)throw new InvalidConfigurationError("Native environment exceeds tile or full-event query budget.");
        plans.push(p);
      }
      // Only value.photo is consumed, so per-evaluation diagnostics are not retained.
      const rawSites:(ReturnType<typeof composeNativeEnvironmentSensorSite>|object)[]=[],photos:PhotoSignal[]=[];
      sensorLean.beginTile();
      let evaluateCounted=(q:Parameters<typeof evaluate>[0]):ReturnType<typeof evaluate>=>{if(signal.aborted)throw new InvalidConfigurationError("Native source evaluation aborted.");evaluations++;return evaluate(q);};
      let apertureCounted=aperture?(q:Parameters<typeof aperture>[0],ray:Parameters<typeof aperture>[1]):ReturnType<typeof evaluate>=>{if(signal.aborted)throw new InvalidConfigurationError("Native aperture evaluation aborted.");evaluations++;return aperture(q,ray);}:undefined;
      let batched:{queries:readonly NativeEnvironmentRadianceQuery[];results:readonly SceneRadianceEvaluationResult[];next:number}|undefined;
      if(batch){
        // One call for the whole tile, with every planned query in per-query callback order (see tileQueries).
        const queries=tileQueries(plans);
        if(signal.aborted)throw new InvalidConfigurationError("Native source evaluation aborted.");
        const results=await batch(Object.freeze(queries),signal);
        if(signal.aborted)throw new InvalidConfigurationError("Native source evaluation aborted.");
        if(!Array.isArray(results)||results.length!==queries.length||Array.from({length:queries.length},(_,i)=>i in results).includes(false))
          throw new InvalidConfigurationError("Batched radiance must return one result per query, in query order.");
        const current={queries,results:results as readonly SceneRadianceEvaluationResult[],next:0};
        batched=current;
        // The executors ask for each query in the same order; every step is checked against the planned query.
        const take=(q:Readonly<SceneRadianceEvaluationRequest>,ray:Readonly<SensorApertureRay>|undefined):SceneRadianceEvaluationResult=>{
          const k=current.next++,planned=current.queries[k];
          if(planned===undefined||planned.request.sampleId!==q.sampleId||(planned.apertureRay===undefined)!==(ray===undefined))
            throw new InvalidConfigurationError("Batched radiance results are out of step with the planned queries.");
          evaluations++;
          return current.results[k]!;
        };
        evaluateCounted=(q):ReturnType<typeof evaluate>=>take(q,undefined);
        apertureCounted=aperture?(q,ray):ReturnType<typeof evaluate>=>take(q,ray):undefined;
      }
      for(let j=0;j<sites.length;j++){
        await pause();
        const index=request.y*plan.exposure.geometry.nativeRaster.pixelWidth+request.x+j;
        let p=plans[j]!,photoSignal:PhotoSignal|undefined;
        if(isLeanEnvironmentPlan(p)){
          // The full plan (deterministic, no callbacks) is built only when the lean path needs it.
          const fullPlan=():ReturnType<typeof planEnvironmentRawSite>=>planEnvironmentRawSite(sites[j]!,index,plan.frame,sceneBinding,plan.exposureWindow!,"engine-owned",memo,"photo-only");
          photoSignal=lean.execute(p,evaluateCounted,apertureCounted,fullPlan,internalEvaluator&&!batched,
            (n)=>{if(signal.aborted)throw new InvalidConfigurationError("Native source evaluation aborted.");evaluations+=n;});
          // An unverified template: plan this site in full now and execute it in full.
          if(photoSignal===undefined)p=fullPlan();
        }
        if(photoSignal===undefined){
          const full=p as ReturnType<typeof planEnvironmentRawSite>,candidate=lean.isCandidate(index);
          const result=executeEnvironmentSensorPhotoSignal(full,evaluateCounted,apertureCounted,candidate?"full":"photo-only");
          if(candidate)lean.verifyCandidate(index,full,result);
          photoSignal=result.value.photo.value.photoSignal;
        }
        recorder?.record(index,photoSignal);
        photos.push(photoSignal);
        // A site matching a verified sensor template becomes a lean entry: every check its composition and RAW
        // parse would run has been evaluated (see native-environment-lean.ts). Otherwise compose it in full.
        const claimed=sensorLean.claim(sites[j]!,photoSignal,index);
        if(claimed)rawSites.push(claimed);
        else{rawSites.push(composeNativeEnvironmentSensorSite(sites[j]!,photoSignal));sensorLean.remember(index,sites[j]!,photoSignal);}
      }
      if(batched&&batched.next!==batched.queries.length)throw new InvalidConfigurationError("Batched radiance results are out of step with the planned queries.");
      if(signal.aborted)throw new InvalidConfigurationError("Native photo observation aborted.");
      if(observe)await observe(freezeOwnedData({...request,sites:photos.map((s,j)=>({nativeIndex:request.y*plan.exposure.geometry.nativeRaster.pixelWidth+request.x+j,
        expectedIncidentPhotonCount:s.expectedIncidentPhotonCount,expectedGeneratedElectronCount:s.expectedGeneratedElectronCount}))}),signal);
      return {...request,sites:rawSites as ReturnType<typeof composeNativeEnvironmentSensorSite>[]};
    },yieldControl
  },cadence,gate,sensorLean.hook,partition?{y:partition.rows.y,height:partition.rows.height,firstSite:(site):void=>{partition.firstSite=site;},
    ...(partition.columns?{x:partition.columns.x,width:partition.columns.width}:{})}:undefined);
  // The frame reference is needed only while tiles are read; release it once the event settles.
  const settle=():void=>{reference=undefined;};
  return {plan:task.plan,get state():NativeRawTaskState{return task.state;},get completedTileCount():number{return task.completedTileCount;},get providerEvaluationCount():number{return evaluations;},
    run:():Promise<void>=>(recorder?task.run().catch((error:unknown)=>{if(task.state==="failed"||task.state==="cancelled"||task.state==="disposed")recorder.discard();throw error;}):task.run()).finally(settle),
    cancel:():void=>{if(task.state!=="transferred")recorder?.discard();task.cancel();},dispose:():void=>{if(task.state!=="transferred")recorder?.discard();task.dispose();},
    takeOutput():NativeEnvironmentRawOutput{
      // Finish retention first so a retention failure never strands the transferred RAW.
      const opticalStage=recorder&&task.state==="completed"?recorder.finish(evaluations):undefined;
      const raw=task.takeOutput();
      const base={raw,sceneBinding,providerEvaluationCount:evaluations,upstreamOrigin:"executed-environment-query-provider-optics-psf-eqe" as const,providerTransportVerified:false as const,productionPlanActivated:false as const};
      return opticalStage?{...base,opticalStage}:base;
    }
  };
}
/**
 * Internal (not exported from the package; 2.3 `simulateCapture` `output.region`): the task for one rectangle of
 * native sites [x, x + width) × [y, y + height) of the whole-frame input. Every site keeps its absolute native index,
 * so its noise seeds, CFA phase, exposure window (rolling-shutter row timing) and value are those of the whole-frame
 * task; the output arrays hold just the rectangle, row-major, and `effectiveSaturationCodes` holds 0 for a CFA
 * phase the rectangle does not contain. Optical-stage retention is not supported.
 */
export function createNativeEnvironmentRawRegionTask(input:NativeEnvironmentRawInput,region:{x:number;y:number;width:number;height:number},
  provider:NativeEnvironmentRawProvider):NativeEnvironmentRawTask {
  const plan=calculateNativeRawPlan(input?.raw),native=plan.exposure.geometry.nativeRaster;
  const r=requireAllowlistedRecord(region,["x","y","width","height"],"Invalid native RAW region.");
  if(![r.x,r.y,r.width,r.height].every(v=>typeof v==="number"&&Number.isSafeInteger(v))||(r.width as number)<1||(r.x as number)<0||(r.x as number)+(r.width as number)>native.pixelWidth)
    throw new InvalidConfigurationError("Native RAW region must lie inside the native raster.");
  const rows=parseRowBand({y:r.y,height:r.height},native.pixelHeight);
  return createNativeEnvironmentRawTaskWithCadence(input,provider,DEFAULT_HOST_YIELD_CADENCE,{rows,columns:{x:r.x as number,width:r.width as number}});
}
/** A band of whole native rows, [y, y + height), in absolute full-sensor coordinates. */
export interface NativeRawRowBand { y: number; height: number }
/**
 * Splits a plan's native rows into at most `count` contiguous bands of nearly equal height (the first
 * `height % count` bands are one row taller), in row order. Deterministic: it depends only on the raster height and
 * `count`. Use one band per worker with createNativeEnvironmentRawPartitionTask.
 */
export function calculateNativeRawRowBands(plan:Pick<NativeRawPlan,"exposure">,count:number):NativeRawRowBand[] {
  if(plan!==null&&typeof plan==="object")rejectUnknownFields(plan,["schemaVersion","exposure","frame","exposureWindow","pixelCount","outputBytes","tileCount",
    "tileWidth","upstreamRadiometryVerified","seedSchedule"],"Native RAW plan");
  const height=plan?.exposure?.geometry?.nativeRaster?.pixelHeight;
  if(typeof height!=="number"||!Number.isSafeInteger(height)||height<1)throw new InvalidConfigurationError("Native RAW partitioning requires a native RAW plan.");
  if(typeof count!=="number"||!Number.isSafeInteger(count)||count<1||count>1024)throw new InvalidConfigurationError("Native RAW partition count must be an integer from 1 to 1024.");
  const bands=Math.min(count,height),base=Math.floor(height/bands),extra=height%bands,result:NativeRawRowBand[]=[];
  for(let i=0,y=0;i<bands;i++){const h=base+(i<extra?1:0);result.push({y,height:h});y+=h;}
  return result;
}
/**
 * One partition's result: plain data and typed arrays only, so it can be posted from a worker (transfer the four
 * arrays' buffers). Merge every partition of a capture with composeNativeEnvironmentRawPartitions.
 */
export interface NativeEnvironmentRawPartition {
  rows: NativeRawRowBand;
  /** Canonical JSON of the capture input (raw, sceneBinding, maximumProviderEvaluations); the merge requires it to match. */
  inputCanonical: string;
  /** Canonical JSON of the band's shared source/optical/motion state; every partition must match. */
  sharedStateCanonical: string;
  /** Readout identity of the band's first site; every partition must match (one readout identity per frame). */
  readoutIdentity: { readoutProfileId: string; regimeId: string; fixedPatternProfileId: string | null; fixedPatternSeedUint32: number | null };
  /** The band's rows only, row-major, as in NativeRawOutput. */
  codes: Uint16Array;
  blackLevels: Uint16Array;
  digitalSaturationCodes: Uint16Array;
  saturationFlags: Uint8Array;
  /** Effective white code per CFA phase; 0 for a phase the band does not contain. */
  effectiveSaturationCodes: Uint16Array;
  providerEvaluationCount: number;
}
export interface NativeEnvironmentRawPartitionTask extends Omit<NativeRawTask,"takeOutput"> {
  readonly rows: NativeRawRowBand;
  readonly providerEvaluationCount: number;
  takeOutput(): NativeEnvironmentRawPartition;
}
function inputCanonical(input:NativeEnvironmentRawInput):string {
  return canonical({raw:input.raw,sceneBinding:input.sceneBinding,maximumProviderEvaluations:input.maximumProviderEvaluations});
}
function parseRowBand(value:unknown,height:number):NativeRawRowBand {
  const band=requireAllowlistedRecord(value,["y","height"],"Invalid native RAW row band.");
  if(typeof band.y!=="number"||typeof band.height!=="number"||!Number.isSafeInteger(band.y)||!Number.isSafeInteger(band.height)||
    band.y<0||band.height<1||band.y+band.height>height)throw new InvalidConfigurationError("Native RAW row band must lie inside the native raster.");
  return {y:band.y,height:band.height};
}
/**
 * Creates the task for one row band of a native environment capture (opt-in parallel execution, 2.0).
 *
 * Run one partition per worker (or one after another) with the same input, each worker using its own provider, then
 * merge them with composeNativeEnvironmentRawPartitions. The merged output is byte-identical to the single
 * createNativeEnvironmentRawTask output for the same input and a deterministic provider: noise seeds use absolute
 * native indices, and tiles, plans and per-site values are those of the whole-frame task.
 *
 * Each partition checks the same inputs and limits before its callbacks. maximumProviderEvaluations bounds each
 * partition's own work; the merge also rejects a total above it. Frame-wide checks that span sites (one shared
 * state, one readout identity, one white level per CFA phase) run inside each band and again across bands in the
 * merge. Callbacks are split across partitions, and when several partitions fail, which error is seen first depends
 * on the caller's scheduling. Optical-stage retention is not supported in a partition.
 *
 * The package bundles no worker code: the caller creates workers (Web Workers or Node worker threads), runs this
 * task inside each and posts the partition back.
 */
export function createNativeEnvironmentRawPartitionTask(input:NativeEnvironmentRawInput,rows:NativeRawRowBand,
  provider:NativeEnvironmentRawProvider):NativeEnvironmentRawPartitionTask {
  const plan=calculateNativeRawPlan(input?.raw),band=parseRowBand(rows,plan.exposure.geometry.nativeRaster.pixelHeight);
  const probe:NativeEnvironmentPartitionProbe={rows:band};
  const task=createNativeEnvironmentRawTaskWithCadence(input,provider,DEFAULT_HOST_YIELD_CADENCE,probe),text=inputCanonical(input);
  return {plan:task.plan,rows:band,get state():NativeRawTaskState{return task.state;},get completedTileCount():number{return task.completedTileCount;},
    get providerEvaluationCount():number{return task.providerEvaluationCount;},run:():Promise<void>=>task.run(),cancel:():void=>task.cancel(),dispose:():void=>task.dispose(),
    takeOutput():NativeEnvironmentRawPartition{
      if(task.state!=="completed"||probe.shared===undefined||probe.firstSite===undefined)throw new InvalidConfigurationError("Native RAW output unavailable.");
      const site=probe.firstSite,sharedStateCanonical=probe.shared,output=task.takeOutput(),raw=output.raw;
      return {rows:{...band},inputCanonical:text,sharedStateCanonical,readoutIdentity:{readoutProfileId:site.readoutProfile.profileId,regimeId:site.regimeId,
        fixedPatternProfileId:site.fixedPatternNoise?.profileId??null,fixedPatternSeedUint32:site.fixedPatternNoise?.sensorInstanceSeedUint32??null},
      codes:raw.codes,blackLevels:raw.blackLevels,digitalSaturationCodes:raw.digitalSaturationCodes,saturationFlags:raw.saturationFlags,
      effectiveSaturationCodes:raw.effectiveSaturationCodes,providerEvaluationCount:output.providerEvaluationCount};
    }
  };
}
/**
 * Assembles the partitions of one capture into the output createNativeEnvironmentRawTask would have returned for
 * the same input (byte-identical RAW arrays and white levels, the summed provider evaluation count).
 *
 * The partitions must be in row order and cover every native row exactly once, and each must come from
 * createNativeEnvironmentRawPartitionTask with this same input. It rejects, with InvalidConfigurationError, a
 * different input, a gap or overlap, wrong array types or lengths, a second shared state or readout identity, two
 * white levels for one CFA phase, a missing phase, or a total evaluation count above the input's budget. It cannot
 * verify how a partition was computed: posted partitions are the caller's own data.
 */
export function composeNativeEnvironmentRawPartitions(input:NativeEnvironmentRawInput,partitions:readonly NativeEnvironmentRawPartition[]):NativeEnvironmentRawOutput {
  const {plan,sceneBinding,retention,maximum}=admitNativeEnvironmentInput(input);
  if(retention)throw new InvalidConfigurationError("A native environment partition cannot retain the optical stage.");
  const native=plan.exposure.geometry.nativeRaster,width=native.pixelWidth,layout=plan.frame.colorSamplingProfile.layout;
  if(layout.kind!=="periodic-mosaic")throw new InvalidConfigurationError("Native RAW requires periodic CFA.");
  const phases=layout.repeatWidthSites*layout.repeatHeightSites,text=inputCanonical(input);
  if(!Array.isArray(partitions)||partitions.length<1||partitions.length>native.pixelHeight||Array.from({length:partitions.length},(_,i)=>i in partitions).includes(false))
    throw new InvalidConfigurationError("Native RAW merge requires a dense list of partitions.");
  const codes=new Uint16Array(plan.pixelCount),blackLevels=new Uint16Array(plan.pixelCount),digitalSaturationCodes=new Uint16Array(plan.pixelCount),saturationFlags=new Uint8Array(plan.pixelCount);
  const white=createPhaseWhiteLevelAccumulator(width,layout.repeatWidthSites,layout.repeatHeightSites);
  let y=0,total=0,shared:string|undefined,identity:string|undefined;
  for(const value of partitions){
    const p=requireAllowlistedRecord(value,["rows","inputCanonical","sharedStateCanonical","readoutIdentity","codes","blackLevels","digitalSaturationCodes",
      "saturationFlags","effectiveSaturationCodes","providerEvaluationCount"],"Invalid native RAW partition.");
    const band=parseRowBand(p.rows,native.pixelHeight),length=band.height*width;
    if(band.y!==y)throw new InvalidConfigurationError("Native RAW partitions must cover every row once, in row order.");
    if(p.inputCanonical!==text)throw new InvalidConfigurationError("Native RAW partition was computed from a different input.");
    if(!(p.codes instanceof Uint16Array)||!(p.blackLevels instanceof Uint16Array)||!(p.digitalSaturationCodes instanceof Uint16Array)||
      !(p.saturationFlags instanceof Uint8Array)||!(p.effectiveSaturationCodes instanceof Uint16Array)||p.codes.length!==length||p.blackLevels.length!==length||
      p.digitalSaturationCodes.length!==length||p.saturationFlags.length!==length||p.effectiveSaturationCodes.length!==phases||
      typeof p.providerEvaluationCount!=="number"||!Number.isSafeInteger(p.providerEvaluationCount)||p.providerEvaluationCount<0||typeof p.sharedStateCanonical!=="string")
      throw new InvalidConfigurationError("Invalid native RAW partition arrays.");
    const id=requireAllowlistedRecord(p.readoutIdentity,["readoutProfileId","regimeId","fixedPatternProfileId","fixedPatternSeedUint32"],"Invalid native RAW partition identity.");
    const idText=canonical(id);
    shared??=p.sharedStateCanonical;identity??=idText;
    if(p.sharedStateCanonical!==shared)throw new InvalidConfigurationError("Native event requires one shared source/optical/motion state.");
    if(idText!==identity)throw new InvalidConfigurationError("Frame requires one readout identity/regime, one fixed-pattern identity and a positive uint16 RAW code span.");
    const offset=band.y*width;
    codes.set(p.codes,offset);blackLevels.set(p.blackLevels,offset);digitalSaturationCodes.set(p.digitalSaturationCodes,offset);saturationFlags.set(p.saturationFlags,offset);
    for(let phase=0;phase<phases;phase++)white.recordPhase(phase,p.effectiveSaturationCodes[phase]!);
    total+=p.providerEvaluationCount;y+=band.height;
  }
  if(y!==native.pixelHeight)throw new InvalidConfigurationError("Native RAW partitions must cover every row once, in row order.");
  if(total>maximum)throw new InvalidConfigurationError("Native environment exceeds tile or full-event query budget.");
  const raw:NativeRawOutput={plan,codes,blackLevels,digitalSaturationCodes,saturationFlags,effectiveSaturationCodes:white.finish()};
  return {raw,sceneBinding,providerEvaluationCount:total,upstreamOrigin:"executed-environment-query-provider-optics-psf-eqe",providerTransportVerified:false,productionPlanActivated:false};
}
/**
 * Re-runs only the sensor stage from a retained optical stage. No radiance callback is called.
 *
 * Use it when only post-optics settings change: noise seed, ISO and its readout regime and gain,
 * fixed-pattern noise, charge, dark-current and capacity profiles, white-balance intent, capture identity
 * or tile width. White balance and rendering are then applied by createNativeRawDevelopmentTask as usual.
 *
 * RAW codes are bit-identical to a full createNativeEnvironmentRawTask with the same final inputs, as long
 * as the radiance provider is a deterministic function of its request.
 *
 * Any optical difference is rejected with InvalidConfigurationError before output. That includes scene
 * binding, geometry or orientation, focal length, aperture, shutter or exposure window, focus,
 * frame/CFA/binding profiles, and any site environment field such as PSF, field throughput, pupil, motion,
 * spectral or temporal sampling and provider profiles.
 *
 * providerEvaluationCount is 0. The caller still owns the stage; it is not used up.
 */
export function createNativeEnvironmentSensorStageTask(input:NativeEnvironmentSensorStageInput,opticalStage:NativeEnvironmentOpticalStage,
  provider:NativeEnvironmentSensorStageProvider):NativeEnvironmentRawTask {
  const {task,sceneBinding}=createSensorStageRawTask(input,opticalStage,provider,parseSceneBinding);
  return {plan:task.plan,get state():NativeRawTaskState{return task.state;},get completedTileCount():number{return task.completedTileCount;},get providerEvaluationCount():number{return 0;},
    run:():Promise<void>=>task.run(),cancel:():void=>task.cancel(),dispose:():void=>task.dispose(),
    takeOutput():NativeEnvironmentRawOutput{return {raw:task.takeOutput(),sceneBinding,providerEvaluationCount:0,upstreamOrigin:"executed-environment-query-provider-optics-psf-eqe",providerTransportVerified:false,productionPlanActivated:false};}
  };
}
