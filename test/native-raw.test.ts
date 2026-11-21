// SPDX-License-Identifier: Apache-2.0
import {describe,it,expect,vi} from "vitest";
import {createNativeRawTask,calculateNativeRawPlan,simulateSensorRawFrame,type NativeRawTile} from "../src/index.js";
import {calculateNativeRawSite} from "../src/capture/sensor-raw-producer.js";
import {createNativeRawTaskWithCadence} from "../src/capture/native-raw.js";
import {nativeRawFixture} from "./helpers/native-raw-fixture.js";
describe("bounded packed native RAW",()=>{
  it("matches exact reference codes, signed black normalization inputs and separate saturation flags",async()=>{
    const f=nativeRawFixture(),expected=simulateSensorRawFrame(f.reference).value;
    const task=createNativeRawTask(f.input,f.provider);expect(task.state).toBe("ready");expect(task.plan.exposure).not.toHaveProperty("planes");
    await task.run();const out=task.takeOutput();expect(task.state).toBe("transferred");
    expect(Array.from(out.codes)).toEqual(expected.frame.samples.map(s=>s.rawCode));expect(Array.from(out.blackLevels)).toEqual([64,64,64,64]);
    expect(Array.from(out.digitalSaturationCodes)).toEqual([1023,1023,1023,1023]);expect(out.plan.outputBytes).toBe(28);
    expect(()=>task.takeOutput()).toThrow();await expect(task.run()).rejects.toThrow();task.dispose();expect(out.codes.length).toBe(4);
  });
  it("uses absolute full-native seeds and CFA across odd tile boundaries without output rotation",async()=>{
    const f=nativeRawFixture(259,3);f.input.exposure.noise.seedUint32=0xffffffff;
    const requests:number[]=[];const provider={...f.provider,readTile:async(r:Parameters<typeof f.provider.readTile>[0],signal:AbortSignal): Promise<NativeRawTile>=>{requests.push(r.x);return f.provider.readTile(r,signal);}};
    const task=createNativeRawTask(f.input,provider);await task.run();const out=task.takeOutput();expect(requests).toEqual([0,256,0,256,0,256]);
    for(const i of [0,255,256,258,259,514,515,776]){
      const s=f.site(i%259,Math.floor(i/259));expect(out.codes[i]).toBe(calculateNativeRawSite(s,0xffffffff,i).readout.value.rawCode);
    }
    expect(task.completedTileCount).toBe(6);
  });
  it("preserves every code, black level and saturation flag across explicit odd execution chunks",async()=>{
    const f=nativeRawFixture(259,3);f.input.exposure.noise.seedUint32=0xffffffff;
    const legacy=createNativeRawTask(f.input,f.provider);await legacy.run();const expected=legacy.takeOutput();
    expect(legacy.plan).not.toHaveProperty("tileWidth");
    for(const width of [1,3,64,256]){
      const read=vi.fn(f.provider.readTile),yieldControl=vi.fn(f.provider.yieldControl);
      // A zero budget restores the original yield after every tile.
      const task=createNativeRawTaskWithCadence({...f.input,tileWidth:width},{readTile:read,yieldControl},{budgetMilliseconds:0,now:()=>0});
      expect(task.plan.tileWidth).toBe(width);expect(task.plan.tileCount).toBe(Math.ceil(259/width)*3);
      await task.run();const out=task.takeOutput();
      for(const field of ["codes","blackLevels","digitalSaturationCodes","saturationFlags"] as const)expect(out[field]).toEqual(expected[field]);
      expect(task.completedTileCount).toBe(task.plan.tileCount);expect(yieldControl).toHaveBeenCalledTimes(task.plan.tileCount);
      expect(read.mock.calls.every(([r])=>r.width<=width&&r.height===1)).toBe(true);
    }
  });
  it("rejects malformed chunk widths before output or source callbacks and snapshots explicit widths",()=>{
    const f=nativeRawFixture(),read=vi.fn(f.provider.readTile);
    for(const width of [0,-1,257,1.5,NaN,Infinity,null,"64",true])
      expect(()=>createNativeRawTask({...f.input,tileWidth:width} as typeof f.input,{...f.provider,readTile:read})).toThrow("tile width");
    expect(read).not.toHaveBeenCalled();
    const input={...f.input,tileWidth:1},plan=calculateNativeRawPlan(input);input.tileWidth=64;
    expect(plan.tileWidth).toBe(1);expect(Object.isFrozen(plan)).toBe(true);
    expect(calculateNativeRawPlan({...f.input,tileWidth:undefined} as unknown as typeof f.input)).not.toHaveProperty("tileWidth");
  });
  it("withholds output and stops between smaller chunks when canceled",async()=>{
    const f=nativeRawFixture(7,2),read=vi.fn(f.provider.readTile);
    const task=createNativeRawTaskWithCadence({...f.input,tileWidth:3},{...f.provider,readTile:read,yieldControl:async():Promise<void>=>{task.cancel();}},{budgetMilliseconds:0,now:()=>0});
    await expect(task.run()).rejects.toThrow();expect(task.completedTileCount).toBe(1);expect(read).toHaveBeenCalledTimes(1);
    expect(task.state).toBe("cancelled");expect(()=>task.takeOutput()).toThrow();
  });
  it("admits a real megapixel raster without allocating a float master or invoking a provider",()=>{
    const f=nativeRawFixture(1000,1000),read=vi.fn(f.provider.readTile),task=createNativeRawTask(f.input,{...f.provider,readTile:read});
    expect(task.plan.pixelCount).toBe(1_000_000);expect(task.plan.outputBytes).toBe(7_000_000);expect(read).not.toHaveBeenCalled();task.dispose();
  });
  it("rejects raster, byte budget, mode, binding, schema and noise errors before callbacks",()=>{
    for(const mutate of [
      (f:ReturnType<typeof nativeRawFixture>): void=>{f.input.maximumOutputBytes=27;},
      (f:ReturnType<typeof nativeRawFixture>): void=>{f.input.exposure.noise.model={id:"wrong",version:"0.2.0"};},
      (f:ReturnType<typeof nativeRawFixture>): void=>{f.input.modeId="missing";},
      (f:ReturnType<typeof nativeRawFixture>): void=>{f.input.bindingProfile.nativeRaster.pixelWidth=3;},
      (f:ReturnType<typeof nativeRawFixture>): void=>{f.input.exposure.geometry.nativeRaster.pixelWidth=16_385;}
    ]){const f=nativeRawFixture();mutate(f);expect(()=>calculateNativeRawPlan(f.input)).toThrow();}
    const f=nativeRawFixture();expect(()=>calculateNativeRawPlan({...f.input,debug:true} as typeof f.input)).toThrow();
    expect(()=>calculateNativeRawPlan({...f.input,exposure:{...f.input.exposure,planes:[]}} as typeof f.input)).toThrow();
  });
  it("fails on corrupt late tiles and never releases partial output",async()=>{
    const f=nativeRawFixture(257,2);
    for(const bad of ["identity","site","seed-input","coverage","code","regime"]){
      const task=createNativeRawTask(f.input,{...f.provider,readTile:async (r,signal)=>{
        const tile=await f.provider.readTile(r,signal);if(r.x===256){
          if(bad==="identity")tile.frameId="wrong";
          if(bad==="site")tile.sites[0]!.charge.photoSignal.site.x=0;
          if(bad==="seed-input")tile.sites[0]!.charge.photoSignal.shotNoiseApplied=true as false;
          if(bad==="coverage")tile.sites=[];
          if(bad==="code")return {...tile,rawCodes:[1]} as NativeRawTile;
          if(bad==="regime")tile.sites[0]!.regimeId="missing";
        }return tile;
      }});await expect(task.run()).rejects.toThrow();expect(task.state).toBe("failed");expect(()=>task.takeOutput()).toThrow();expect(task.completedTileCount).toBe(1);
    }
  });
  it("cancels during a pending provider, rejects late output and aborts provider resources",async()=>{
    const f=nativeRawFixture();let resolve:(v:NativeRawTile)=>void=()=>{};let signal:AbortSignal|undefined;
    const task=createNativeRawTask(f.input,{...f.provider,readTile:(r,s)=>{signal=s;return new Promise(done=>{resolve=done;});}});
    const running=task.run();task.cancel();expect(signal?.aborted).toBe(true);resolve(await f.provider.readTile({captureId:f.input.exposure.captureId,frameId:f.input.frameId,x:0,y:0,width:2,height:1},new AbortController().signal));
    await expect(running).rejects.toThrow();expect(task.state).toBe("cancelled");expect(()=>task.takeOutput()).toThrow();
  });
  it("disposes during a yield and prevents completed output from escaping",async()=>{
    const f=nativeRawFixture();const task=createNativeRawTask(f.input,{...f.provider,yieldControl:async()=>{task.dispose();}});
    await expect(task.run()).rejects.toThrow();expect(task.state).toBe("disposed");expect(()=>task.takeOutput()).toThrow();
    const complete=createNativeRawTask(f.input,f.provider);await complete.run();complete.cancel();expect(()=>complete.takeOutput()).toThrow();
  });
});
describe("a raster smaller than one CFA repeat (capture-17, #698)",()=>{
  it("is refused by the plan, before any tile is read",()=>{
    for(const [w,h] of [[4,1],[1,4],[1,1],[3,1],[1,3]] as const)
      expect(()=>calculateNativeRawPlan(nativeRawFixture(w,h).input),w+"x"+h).toThrow("Native RAW requires exact noise identity and single-frame native periodic CFA.");
    for(const [w,h] of [[2,2],[4,3]] as const)expect(calculateNativeRawPlan(nativeRawFixture(w,h).input).pixelCount).toBe(w*h);
  });
});
