// SPDX-License-Identifier: Apache-2.0
// Opt-in (PHOTIVRA_VALIDATE_MEGAPIXEL_RAW=1, 44 s on an Apple silicon host); run nightly by .github/workflows/native-performance.yml (ci-13 in #703).
import {gzipSync} from "node:zlib";
import {it,expect} from "vitest";
import {createHash} from "node:crypto";
import {writeFileSync,readFileSync} from "node:fs";
import {ENGINE_API_VERSION,createNativeRawTask,createNativeRawDevelopmentTask,createPrintJpegTask} from "../src/index.js";
import {calculateNativeRawSite} from "../src/capture/sensor-raw-producer.js";
import {loadPhotographicExportInput} from "./helpers/photographic-export-fixture.js";
import {nativeRawFixture} from "./helpers/native-raw-fixture.js";
const enabled=process.env.PHOTIVRA_VALIDATE_MEGAPIXEL_RAW==="1";
it.runIf(enabled)("executes a complete one-megapixel native RAW exposure with bounded producer tiles",async()=>{
  const f=nativeRawFixture(1000,1000),start=performance.now();let maximumSites=0;
  const task=createNativeRawTask(f.input,{readTile:async(request,signal)=>{
    const tile=await f.provider.readTile(request,signal);maximumSites=Math.max(maximumSites,tile.sites.length);return tile;
  },yieldControl:async(): Promise<void>=>{await new Promise<void>(done=>setTimeout(done,0));}});
  await task.run();const out=task.takeOutput();expect(out.codes.length).toBe(1_000_000);expect(maximumSites).toBe(256);expect(task.completedTileCount).toBe(4000);
  const checks=[0,255,256,999,1000,500_500,999_999];
  for(const i of checks)expect(out.codes[i]).toBe(calculateNativeRawSite(f.site(i%1000,Math.floor(i/1000)),f.input.exposure.noise.seedUint32,i).readout.value.rawCode);
  // Development takes ownership of the packed RAW; keep a copy to prove the returned RAW is unchanged.
  const codesBefore=out.codes.slice(),policy=loadPhotographicExportInput(),developStart=performance.now();
  const development=createNativeRawDevelopmentTask({raw:out,phaseProfiles:policy.reconstruction.phaseProfiles,colorProfile:policy.colorProfile,
    whiteBalance:policy.whiteBalance,rendering:policy.rendering,maximumRetainedPayloadBytes:10_000_000},async():Promise<void>=>{});
  await development.run();const developed=development.takeOutput(),developmentElapsedMs=performance.now()-developStart;
  expect(developed.integerSamples.length).toBe(3_000_000);expect(developed.raw.codes).toEqual(codesBefore);
  const samples=developed.integerSamples as Uint8Array,sourceSha=createHash("sha256").update(samples).digest("hex"),printStart=performance.now();
  const print=createPrintJpegTask({source:{captureId:out.plan.exposure.captureId,imageStateId:"megapixel-development",artifactId:"owned-megapixel-raw-sdr",sha256:sourceSha,width:1000,height:1000,encoding:"encoded-srgb-8-rgb"},
    crop:{x:0,y:0,width:1000,height:1000},outputWidth:500,outputHeight:500,quantizationStep:1,maximumEncodedBytes:4_000_000,maximumProviderReads:10_000},{
    readTile:async r=>{const packed=new Uint8Array(r.width*r.height*3);for(let y=0;y<r.height;y++)packed.set(samples.subarray(((r.y+y)*1000+r.x)*3,((r.y+y)*1000+r.x+r.width)*3),y*r.width*3);return {...r,samples:packed};},
    yieldControl:async():Promise<void>=>{}});
  await print.run();const jpeg=print.takeOutput();expect(jpeg.bytes.length).toBeGreaterThan(1000);
  if(process.env.PHOTIVRA_RAW_REPORT){writeFileSync(process.env.PHOTIVRA_RAW_REPORT+".jpg",jpeg.bytes);writeFileSync(process.env.PHOTIVRA_RAW_REPORT+".rgb.gz",gzipSync(samples));writeFileSync(process.env.PHOTIVRA_RAW_REPORT+".codes.u16le.gz",gzipSync(new Uint8Array(developed.raw.codes.buffer)));}
  const report={engineVersion:ENGINE_API_VERSION,generatorSha256:createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),developmentElapsedMs,printElapsedMs:performance.now()-printStart,sdrSamplesSha256:sourceSha,jpegBytes:jpeg.bytes.length,jpegSha256:createHash("sha256").update(jpeg.bytes).digest("hex"),schemaVersion:"0.1.0",pass:true,width:1000,height:1000,sites:1_000_000,maximumTileSites:maximumSites,
    completedTiles:task.completedTileCount,outputBytes:out.plan.outputBytes,elapsedMs:performance.now()-start,
    codesSha256:createHash("sha256").update(new Uint8Array(developed.raw.codes.buffer)).digest("hex"),sampleIndicesChecked:checks,
    scope:"Actual complete constructed EQE/dark native RAW execution; same packed RAW developed to integer SDR and cropped/downsampled ICC JPEG; not source radiometry, physical device or calibrated sensor qualification."};
  if(process.env.PHOTIVRA_RAW_REPORT)writeFileSync(process.env.PHOTIVRA_RAW_REPORT,JSON.stringify(report,null,2)+"\n");
  console.info(JSON.stringify(report));
},1_200_000);
