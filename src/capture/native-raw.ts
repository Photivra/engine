// SPDX-License-Identifier: Apache-2.0

/**
 * Native RAW capture with the existing per-site (scalar) RAW model: an up-front plan and limit check from
 * metadata only, then bounded tile-by-tile execution.
 */
import { EXPOSURE_BUILD_UP_STAGES, type ExposureBuildUpStage } from "./exposure-build-up-stage.js";
import { normalizeCaptureExposureMetadata, type SimulatedCaptureInput, type SimulatedCapture, type CaptureExposureSource } from "./simulated-capture.js";
import { ENGINE_API_VERSION } from "../core/version.js";
import { InvalidConfigurationError } from "../core/configuration-error.js";
import { requireAllowlistedRecord, requirePublicOpaqueId } from "../core/record-validation.js";
import { freezeOwnedData } from "../core/owned-data.js";
import { FULL_RESOLUTION_CEILING_PIXELS, resolveRaisedLimit, scaleBudgetCeiling } from "../core/pixel-limits.js";
import { calculateSiteEffectiveSaturationCode, createPhaseWhiteLevelAccumulator } from "./raw-white-level.js";
import { DEFAULT_HOST_YIELD_CADENCE, createHostYieldGate, type HostYieldCadence, type HostYieldGate } from "./host-yield-cadence.js";
import { parseCaptureModeProfile } from "../sensor/capture-mode.js";
import { parseSensorColorSamplingProfile } from "../sensor/color-sampling.js";
import { parseNativeEffectiveRasterColorSamplingBindingProfile, resolveCaptureModeColorSamplingContributors } from "../sensor/capture-color-sampling-binding.js";
import { calculateCaptureExposureWindows } from "../sensor/exposure-window.js";
import { SENSOR_RAW_PRODUCER_NOISE_MODEL, calculateNativeRawSite, parseNativeRawProducerSite,
  validateNativeRawReadoutIdentity, type NativeRawProducerFrameContext, type SensorRawProducerSiteInput,
  type SensorRawProducerExposureWindowInput } from "./sensor-raw-producer.js";

export const NATIVE_RAW_SCHEMA_VERSION = "0.1.0" as const;
/** `maximumPixels` is the default pixel limit; a request may raise it with its own `maximumPixels`, up to `ceilingPixels`. */
export const NATIVE_RAW_LIMITS = /* @__PURE__ */ Object.freeze({ maximumPixels: 24_000_000, ceilingPixels: FULL_RESOLUTION_CEILING_PIXELS, maximumDimension: 16_384,
  tileWidth: 256, tileHeight: 1, outputBytesPerPixel: 7 });
/** Default whole-event radiance query budget ceiling of the native environment tasks; it scales with a raised `maximumPixels`. */
const DEFAULT_MAXIMUM_PROVIDER_EVALUATIONS = 2_000_000_000;
/** A shooting event and where its source came from. Not a finished float master or committed RAW frame. */
export type NativeRawExposureInput = Omit<SimulatedCaptureInput, "planes" | "source"> & {source:CaptureExposureSource};
export type NativeRawExposure = Omit<SimulatedCapture, "schemaVersion" | "planes" | "source"> & {source:CaptureExposureSource};
export interface NativeRawInput {
  exposure: NativeRawExposureInput;
  frameId: string;
  modeId: string;
  captureModeProfile: NativeRawProducerFrameContext["captureModeProfile"];
  colorSamplingProfile: NativeRawProducerFrameContext["colorSamplingProfile"];
  bindingProfile: NativeRawProducerFrameContext["bindingProfile"];
  exposureWindow?: SensorRawProducerExposureWindowInput;
  maximumOutputBytes: number;
  /** Optional tile width for execution, in native sites, 1–256. Default 256. It does not affect sampling. */
  tileWidth?: number;
  /**
   * Optional opt-in pixel limit for large sensors: an integer from 1 to `NATIVE_RAW_LIMITS.ceilingPixels`.
   * Default `NATIVE_RAW_LIMITS.maximumPixels` (24 000 000). `maximumOutputBytes` still applies. A raised limit
   * also raises the native environment tasks' whole-event query budget ceiling in proportion
   * (2 000 000 000 per 24 000 000 pixels). It does not affect sampling.
   */
  maximumPixels?: number;
}
export interface NativeRawPlan {
  schemaVersion: typeof NATIVE_RAW_SCHEMA_VERSION;
  exposure: NativeRawExposure;
  frame: NativeRawProducerFrameContext;
  exposureWindow?: SensorRawProducerExposureWindowInput;
  pixelCount: number;
  outputBytes: number;
  tileCount: number;
  /** Present only when an execution tile width was given. Otherwise the plan keeps its earlier shape. */
  tileWidth?: number;
  /** Present only when a pixel limit was given. Otherwise the plan keeps its earlier shape. */
  maximumPixels?: number;
  upstreamRadiometryVerified: false;
  seedSchedule: "murmur3-capture-seed-native-index-stream-v2";
}
/** Tile rectangle, in absolute full-sensor CFA coordinates, before orientation, active-area crop or output scaling. */
export interface NativeRawTileRequest { captureId: string; frameId: string; x: number; y: number; width: number; height: number }
export interface NativeRawTile extends NativeRawTileRequest { sites: readonly SensorRawProducerSiteInput[] }
export interface NativeRawProvider {
  readTile(request: Readonly<NativeRawTileRequest>, signal: AbortSignal): Promise<NativeRawTile>;
  yieldControl(signal: AbortSignal): Promise<void>;
}
/** Row-major arrays owned only by the output. They cannot be attached to the bounded SensorRawFrame type. */
export interface NativeRawOutput {
  plan: NativeRawPlan;
  codes: Uint16Array;
  blackLevels: Uint16Array;
  digitalSaturationCodes: Uint16Array;
  /** Saturation flags. Bit 0: physical charge clamp; bit 1: pre-ADC clamp; bit 2: digital saturation. */
  saturationFlags: Uint8Array;
  /**
   * Effective white (full-saturation) code for each absolute CFA repeat phase, indexed
   * `phaseY*repeatWidthSites+phaseX`: min(digital saturation, round(black + min(capacity, pre-ADC
   * saturation)/gain)). See `calculateEffectiveSaturationCode`. A few bytes, not one value per pixel.
   */
  effectiveSaturationCodes: Uint16Array;
}
/** Internal: lean per-site outputs of an engine-built site (see native-environment-lean.ts). */
export interface NativeRawLeanOutput { rawCode: number; blackLevelCode: number; digitalSaturationCode: number; flags: number; whiteCode: number }
/**
 * Internal hook for tiles the engine builds itself (native environment RAW).
 *
 * claim() recognizes only entries the hook itself created, for sites whose parsing and identity checks are
 * provably redundant. compute() returns the outputs calculateNativeRawSite would produce, falling back to it
 * internally. observe() sees every fully computed site.
 */
export interface NativeRawLeanSensorHook {
  claim(site: unknown): object | undefined;
  compute(handle: object, index: number, seed: number, timing: ReturnType<typeof calculateCaptureExposureWindows>["value"]["samples"][number] | undefined, b?: ExposureBuildUpStage): NativeRawLeanOutput;
  observe(index: number, parsed: SensorRawProducerSiteInput, result: ReturnType<typeof calculateNativeRawSite>, whiteCode: number, seed: number, b?: ExposureBuildUpStage): void;
}
export type NativeRawTaskState = "ready" | "running" | "completed" | "cancelled" | "failed" | "disposed" | "transferred";
export interface NativeRawTask {
  readonly plan: NativeRawPlan;
  readonly state: NativeRawTaskState;
  readonly completedTileCount: number;
  run(): Promise<void>;
  cancel(): void;
  dispose(): void;
  takeOutput(): NativeRawOutput;
}
function windows(exposure: NativeRawExposure, schedule: SensorRawProducerExposureWindowInput,
  points: readonly {x:number;y:number}[]): ReturnType<typeof calculateCaptureExposureWindows>["value"] {
  const r=requireAllowlistedRecord(schedule,["shutterMechanism","nominalExposureDurationSeconds","opening","closing"],"Invalid RAW exposure schedule.");
  requireAllowlistedRecord(r.nominalExposureDurationSeconds,["value","unit","evidence"],"Invalid RAW nominal exposure.");
  for(const boundary of [r.opening,r.closing]){
    const b=requireAllowlistedRecord(boundary,["kind","directionNative","traversalDurationSeconds"],"Invalid RAW exposure boundary.");
    if(b.directionNative!==undefined)requireAllowlistedRecord(b.directionNative,["value","evidence"],"Invalid RAW scan direction.");
    if(b.traversalDurationSeconds!==undefined)requireAllowlistedRecord(b.traversalDurationSeconds,["value","unit","evidence"],"Invalid RAW scan duration.");
  }
  const result=calculateCaptureExposureWindows({...schedule,nativeRaster:exposure.geometry.nativeRaster,samplePointsNative:points});
  if(result.value.nominalExposureDurationSeconds.value!==exposure.exposure.shutterSeconds)throw new InvalidConfigurationError("RAW schedule differs from exposure duration.");
  return result.value;
}
/** Plans the task and checks the image size, resources and profiles before any callback or output allocation. No placeholder plane is made. */
export function calculateNativeRawPlan(input: NativeRawInput): NativeRawPlan {
  const r=requireAllowlistedRecord(input,["exposure","frameId","modeId","captureModeProfile","colorSamplingProfile","bindingProfile","exposureWindow","maximumOutputBytes","tileWidth","maximumPixels"],"Invalid native RAW input.");
  if(r.tileWidth!==undefined&&(typeof r.tileWidth!=="number"||!Number.isSafeInteger(r.tileWidth)||r.tileWidth<1||r.tileWidth>NATIVE_RAW_LIMITS.tileWidth))
    throw new InvalidConfigurationError("Native RAW tile width must be an integer from 1 to 256.");
  const tileWidth=(r.tileWidth as number|undefined)??NATIVE_RAW_LIMITS.tileWidth;
  const maximumPixels=resolveRaisedLimit(r.maximumPixels,NATIVE_RAW_LIMITS.maximumPixels,NATIVE_RAW_LIMITS.ceilingPixels,
    "Native RAW maximumPixels must be an integer from 1 to "+NATIVE_RAW_LIMITS.ceilingPixels+".");
  const exposure=normalizeCaptureExposureMetadata(r.exposure,ENGINE_API_VERSION,true),native=exposure.geometry.nativeRaster;
  const pixelCount=native.pixelWidth*native.pixelHeight,outputBytes=pixelCount*NATIVE_RAW_LIMITS.outputBytesPerPixel;
  if(pixelCount>maximumPixels||native.pixelWidth>NATIVE_RAW_LIMITS.maximumDimension||native.pixelHeight>NATIVE_RAW_LIMITS.maximumDimension||
    !Number.isSafeInteger(r.maximumOutputBytes)||typeof r.maximumOutputBytes!=="number"||r.maximumOutputBytes<outputBytes)throw new InvalidConfigurationError("Native RAW raster exceeds output admission budget.");
  const frame={frameId:requirePublicOpaqueId(r.frameId,"Invalid RAW frame ID."),capture:exposure,
    modeId:requirePublicOpaqueId(r.modeId,"Invalid RAW mode ID."),containerBitDepth:16 as const,
    captureModeProfile:parseCaptureModeProfile(r.captureModeProfile),colorSamplingProfile:parseSensorColorSamplingProfile(r.colorSamplingProfile),
    bindingProfile:parseNativeEffectiveRasterColorSamplingBindingProfile(r.bindingProfile)};
  const mode=frame.captureModeProfile.modes.find(m=>m.modeId===frame.modeId);
  if(exposure.noise.model.id!==SENSOR_RAW_PRODUCER_NOISE_MODEL.id||exposure.noise.model.version!==SENSOR_RAW_PRODUCER_NOISE_MODEL.version||
    frame.colorSamplingProfile.layout.kind!=="periodic-mosaic"||mode?.acquisition.kind!=="single-frame"||mode.perFrameSampling.kind!=="native-effective-raster"||(mode.reconstructionStages?.length??0)!==0)
    throw new InvalidConfigurationError("Native RAW requires exact noise identity and single-frame native periodic CFA.");
  // The binding is one affine mapping for the whole frame, so checking both corners covers it. Do this before any provider work.
  for(const p of [{x:0,y:0},{x:native.pixelWidth-1,y:native.pixelHeight-1}]){
    const c=resolveCaptureModeColorSamplingContributors({nativeRaster:native,captureModeProfile:frame.captureModeProfile,modeId:frame.modeId,colorSamplingProfile:frame.colorSamplingProfile,bindingProfile:frame.bindingProfile,modeSampleIndexFullFrame:p});
    if(c.totalContributorSites!==1||c.channelComposition.kind!=="single-channel")throw new InvalidConfigurationError("Native RAW must preserve one native CFA site per sample.");
  }
  const schedule=r.exposureWindow===undefined?undefined:structuredClone(r.exposureWindow) as SensorRawProducerExposureWindowInput;
  // For the supported linear scans, the extreme values occur at the image corners. Check them before capture.
  if(schedule)windows(exposure,schedule,[{x:.5,y:.5},{x:native.pixelWidth-.5,y:.5},{x:.5,y:native.pixelHeight-.5},{x:native.pixelWidth-.5,y:native.pixelHeight-.5}]);
  return freezeOwnedData({schemaVersion:NATIVE_RAW_SCHEMA_VERSION,exposure,frame,pixelCount,outputBytes,
    tileCount:Math.ceil(native.pixelWidth/tileWidth)*native.pixelHeight,
    ...(r.tileWidth===undefined?{}:{tileWidth}),
    ...(r.maximumPixels===undefined?{}:{maximumPixels}),
    ...(schedule?{exposureWindow:schedule}:{}),upstreamRadiometryVerified:false as const,
    seedSchedule:"murmur3-capture-seed-native-index-stream-v2" as const});
}
/**
 * Internal: the largest whole-event radiance query budget a native environment task admits for this plan:
 * 2 000 000 000, scaled in proportion when the plan raised its pixel limit above 24 000 000. Not exported from the package.
 */
export function nativeRawMaximumProviderEvaluations(plan: Pick<NativeRawPlan,"maximumPixels">): number {
  return plan.maximumPixels===undefined?DEFAULT_MAXIMUM_PROVIDER_EVALUATIONS:scaleBudgetCeiling(DEFAULT_MAXIMUM_PROVIDER_EVALUATIONS,plan.maximumPixels);
}
/**
 * Runs validated per-site events (EQE photo signal, dark signal, charge completeness) through the shared
 * reference per-site physics.
 *
 * Tiles are read and committed one at a time. The task yields to the host at tile boundaries once about
 * 8 ms of work has passed since the last yield, and after the final tile. It checks for cancellation
 * before every tile, after every read and after every yield.
 */
export function createNativeRawTask(input: NativeRawInput,provider: NativeRawProvider): NativeRawTask {
  return createNativeRawTaskWithCadence(input,provider,DEFAULT_HOST_YIELD_CADENCE);
}
/** Internal: the same task with an explicit host-yield timing. Timing never changes tiles, seeds or output. Not exported from the package. */
export function createNativeRawTaskWithCadence(input: NativeRawInput,provider: NativeRawProvider,cadence: HostYieldCadence,
  /** Internal: a yield timer shared with a provider that also yields inside readTile, so both use one time budget. */
  sharedGate?: HostYieldGate,
  /** Internal: faster ("lean") per-site sensor execution for engine-built tiles. It never changes output or errors. */
  leanSensor?: NativeRawLeanSensorHook,
  /**
   * Internal: run only native rows [y, y + height) (a partition). The output arrays then hold just those rows, and
   * effectiveSaturationCodes holds 0 for CFA phases the rows do not contain; the merge step completes them.
   * Seeds, tiles and per-site values are those of the whole-frame task.
   */
  rows?: { readonly y: number; readonly height: number; readonly firstSite?: (site: SensorRawProducerSiteInput) => void;
    /** Internal (2.3 region rendering): also restrict to native columns [x, x + width). The output arrays are then that rectangle, row-major. */
    readonly x?: number; readonly width?: number }): NativeRawTask {
  const plan=calculateNativeRawPlan(input);
  if(!provider||typeof provider.readTile!=="function"||typeof provider.yieldControl!=="function")throw new InvalidConfigurationError("Native RAW requires reader and host event-loop yield.");
  const read=provider.readTile.bind(provider),yieldControl=provider.yieldControl.bind(provider),abort=new AbortController();
  const native=plan.exposure.geometry.nativeRaster,tileWidth=plan.tileWidth??NATIVE_RAW_LIMITS.tileWidth;
  const rowStart=rows?.y??0,rowEnd=rowStart+(rows?.height??native.pixelHeight),colStart=rows?.x??0,colEnd=colStart+(rows?.width??native.pixelWidth);
  if(colStart<0||colEnd>native.pixelWidth||colEnd<=colStart)throw new InvalidConfigurationError("Native RAW column band must lie inside the native raster.");
  const bandWidth=colEnd-colStart,length=(rowEnd-rowStart)*bandWidth;
  let state:NativeRawTaskState="ready",count=0,output:NativeRawOutput|null=null,first:SensorRawProducerSiteInput|undefined;
  function release(): void {if(output){output.codes.fill(0);output.blackLevels.fill(0);output.digitalSaturationCodes.fill(0);output.saturationFlags.fill(0);output.effectiveSaturationCodes.fill(0);}output=null;first=undefined;}
  function active(): void {if(abort.signal.aborted)throw new InvalidConfigurationError("Native RAW execution aborted.");}
  return {plan,get state(): NativeRawTaskState {return state;},get completedTileCount(): number {return count;},
    async run(): Promise<void> {
      if(state!=="ready")throw new InvalidConfigurationError("Native RAW task is single-use.");state="running";
      try{
        const gate=sharedGate??createHostYieldGate(cadence);sharedGate?.restart();
        const layout=plan.frame.colorSamplingProfile.layout;if(layout.kind!=="periodic-mosaic")throw new InvalidConfigurationError("Native RAW requires periodic CFA.");
        const white=createPhaseWhiteLevelAccumulator(native.pixelWidth,layout.repeatWidthSites,layout.repeatHeightSites);
        output={plan,codes:new Uint16Array(length),blackLevels:new Uint16Array(length),digitalSaturationCodes:new Uint16Array(length),saturationFlags:new Uint8Array(length),effectiveSaturationCodes:new Uint16Array(layout.repeatWidthSites*layout.repeatHeightSites)};
        for(let y=rowStart;y<rowEnd;y++)for(let x=colStart;x<colEnd;x+=tileWidth){
          active();const request=Object.freeze({captureId:plan.exposure.captureId,frameId:plan.frame.frameId,x,y,width:Math.min(tileWidth,colEnd-x),height:1});
          {
            const supplied=await read(request,abort.signal);active();
            const tile=requireAllowlistedRecord(supplied,["captureId","frameId","x","y","width","height","sites"],"Invalid native RAW tile.");
            for(const key of Object.keys(request) as (keyof NativeRawTileRequest)[])if(tile[key]!==request[key])throw new InvalidConfigurationError("Native RAW tile identity mismatch.");
            if(!Array.isArray(tile.sites)||tile.sites.length!==request.width||Array.from({length:request.width},(_,i)=>i in (tile.sites as unknown[])).includes(false))throw new InvalidConfigurationError("Native RAW tile needs exact dense coverage.");
            const timing=plan.exposureWindow?windows(plan.exposure,plan.exposureWindow,Array.from({length:request.width},(_,i)=>({x:x+i+.5,y:y+.5}))):undefined;
            // Lean entries (built by the engine, provably valid against an earlier verified template) skip parsing and
            // identity checks. They are only claimed once the frame's first site is fixed.
            const lean=leanSensor&&first!==undefined?(tile.sites as unknown[]).map(site=>leanSensor.claim(site)):undefined;
            const sites=tile.sites.map((site,j)=>lean?.[j]?undefined:parseNativeRawProducerSite(site,y*native.pixelWidth+x+j,plan.frame,timing?.samples[j]));
            if(first===undefined){first=sites[0];if(first)rows?.firstSite?.(first);}for(const s of sites)if(s)validateNativeRawReadoutIdentity(s,first!);
            // Every site in this tile is validated before any output is written. A failure never returns partial output.
            const seed=plan.exposure.noise.seedUint32,b=EXPOSURE_BUILD_UP_STAGES.get(input);
            for(let j=0;j<sites.length;j++){
              // index: absolute native index (seeds, CFA phase); at: position in this task's output arrays.
              const index=y*native.pixelWidth+x+j,at=(y-rowStart)*bandWidth+x+j-colStart,handle=lean?.[j];
              if(handle){
                const o=leanSensor!.compute(handle,index,seed,timing?.samples[j],b);
                output.codes[at]=o.rawCode;output.blackLevels[at]=o.blackLevelCode;output.digitalSaturationCodes[at]=o.digitalSaturationCode;
                output.saturationFlags[at]=o.flags;white.record(index,o.whiteCode);continue;
              }
              const result=calculateNativeRawSite(sites[j]!,seed,index,b),r=result.readout.value;
              output.codes[at]=r.rawCode;output.blackLevels[at]=r.blackLevelCode;output.digitalSaturationCodes[at]=r.digitalSaturationCode;
              output.saturationFlags[at]=Number(r.physicalScalarSaturationApplied)|Number(r.preAdcSaturationApplied)<<1|Number(r.digitalSaturationApplied)<<2;
              const whiteCode=calculateSiteEffectiveSaturationCode(r,sites[j]!.readoutProfile,sites[j]!.regimeId);
              white.record(index,whiteCode);
              leanSensor?.observe(index,sites[j]!,result,whiteCode,seed,b);
            }
            count++;
          }
          // Yield when the time budget is spent, and always after the final tile. Yield timing never changes output.
          if(gate.due()||(y===rowEnd-1&&x+tileWidth>=colEnd)){await yieldControl(abort.signal);active();gate.restart();}
        }
        output.effectiveSaturationCodes.set(rows?white.partial():white.finish());first=undefined;state="completed";
      }catch(error){release();if(!abort.signal.aborted){state="failed";abort.abort();}throw error;}
    },
    cancel(): void {if(state==="ready"||state==="running"||state==="completed"){state="cancelled";abort.abort();release();}},
    dispose(): void {if(state!=="transferred"){state="disposed";abort.abort();release();}},
    takeOutput(): NativeRawOutput {if(state!=="completed"||!output)throw new InvalidConfigurationError("Native RAW output unavailable.");const result=output;output=null;first=undefined;state="transferred";return result;}
  };
}
