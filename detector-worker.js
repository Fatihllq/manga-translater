import {DETECTOR_SIZE,DEFAULT_OPTIONS,makeTiles,decodeDetections,assembleRegions} from './detection-geometry.js';
import {addDisplayGeometry} from './display-geometry.js';
import {refineSpeechRegions,REFINEMENT_VERSION} from './refine-bubbles.js';
let configPromise,sessionPromise,active,forceCpu=false,deviceLost=false,fallbackReason;
const config=()=>configPromise??=fetch(new URL('./detector-version.json',import.meta.url)).then(r=>r.json());
const digest=async buffer=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
async function createSession(options,preferGpu){
 const selected=await config(),variant=preferGpu?selected.gpu:selected;
 if(!variant)throw Error('GPU modeli pakette bulunamadı.');
 const ort=await import(preferGpu?'./vendor/onnx/ort.webgpu.min.mjs':'./vendor/onnx/ort.wasm.min.mjs');
 const threads=crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'?Math.max(1,options.threads||1):1;
 ort.env.wasm.numThreads=threads;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths=new URL('./vendor/onnx/',import.meta.url).href;
 let adapter;
 if(preferGpu){
  adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw Error('Uygun ekran kartı bulunamadı.');ort.env.webgpu.adapter=adapter;
 }
 const response=await fetch(new URL('./vendor/detector/'+variant.file,import.meta.url));
 if(!response.ok)throw Error('Balon algılama modeli açılamadı.');
 const buffer=await response.arrayBuffer();if(await digest(buffer)!==variant.sha256)throw Error('Algılama modeli doğrulanamadı.');
 let engine;
 try{engine=await ort.InferenceSession.create(buffer,{executionProviders:preferGpu?['webgpu','wasm']:['wasm'],graphOptimizationLevel:'all'});}
 catch(error){if(!preferGpu&&threads>1){error.retrySingleThread=true;}throw error;}
 if(preferGpu){const device=await ort.env.webgpu.device;void device.lost.then(()=>{deviceLost=true;forceCpu=true;});}
 return {ort,engine,config:selected,variant,backend:preferGpu?'webgpu':threads>1?'wasm-threads':'wasm',threads,adapter:adapter?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description}:undefined};
}
async function session(options){
 if(deviceLost&&active){await active.engine.release().catch(()=>{});active=undefined;sessionPromise=undefined;}
 if(active)return active;
 if(!sessionPromise)sessionPromise=(async()=>{
  const selected=await config();
  const gpu=Boolean(selected.gpu)&&!forceCpu&&(options.backend==='webgpu'||options.backend!=='wasm'&&options.backend!=='wasm-single'&&selected.gpu.validated===true);
  try{active=await createSession(options,gpu);}
  catch(error){if(!gpu)throw error;fallbackReason=error.message??String(error);forceCpu=true;active=await createSession(options,false);}
  return active;
 })().catch(error=>{sessionPromise=undefined;throw error;});
 return sessionPromise;
}
async function scan(blob,options,id){
 const start=performance.now(),modelStart=start,state=await session(options),modelMs=performance.now()-modelStart;
 let image,inferenceMs=0,refineMs=0,preprocessMs=0;
 try{
  image=await createImageBitmap(blob);if(image.width*image.height>40_000_000)throw Error('Bu görsel çok büyük.');
  const settings={...DEFAULT_OPTIONS,...state.config.options},tiles=makeTiles(image.width,image.height,settings),raw=[];
  const canvas=new OffscreenCanvas(DETECTOR_SIZE,DETECTOR_SIZE),ctx=canvas.getContext('2d',{willReadFrequently:true});
  for(let index=0;index<tiles.length;index++){
   self.postMessage({id,type:'progress',message:'Görsel taranıyor: '+(index+1)+' / '+tiles.length,current:index+1,total:tiles.length});
   const tile=tiles[index],p=performance.now();ctx.fillStyle='#fff';ctx.fillRect(0,0,DETECTOR_SIZE,DETECTOR_SIZE);
   ctx.drawImage(image,tile.x,tile.y,tile.width,tile.height,0,0,DETECTOR_SIZE,DETECTOR_SIZE);
   const rgba=ctx.getImageData(0,0,DETECTOR_SIZE,DETECTOR_SIZE).data,pixels=DETECTOR_SIZE*DETECTOR_SIZE,input=new Float32Array(pixels*3);
   for(let i=0;i<pixels;i++)for(let channel=0;channel<3;channel++)input[channel*pixels+i]=rgba[i*4+channel]/255;
   preprocessMs+=performance.now()-p;
   const tensor=new state.ort.Tensor('float32',input,[1,3,DETECTOR_SIZE,DETECTOR_SIZE]);
   const sizes=new state.ort.Tensor('int64',BigInt64Array.from([BigInt(tile.width),BigInt(tile.height)]),[1,2]);
   let outputs;const t=performance.now();
   try{outputs=await state.engine.run({[state.engine.inputNames[0]]:tensor,[state.engine.inputNames[1]]:sizes});inferenceMs+=performance.now()-t;raw.push(...decodeDetections(outputs,tile,settings));}
   catch(error){error.gpuExecution=state.backend==='webgpu';throw error;}
   finally{tensor.dispose();sizes.dispose();for(const value of Object.values(outputs??{}))value.dispose();}
  }
  const assembled=assembleRegions(raw,image.width,image.height,settings),r=performance.now(),refined=refineSpeechRegions(assembled,image);refineMs=performance.now()-r;
  const displayStart=performance.now(),regions=addDisplayGeometry(refined,image,raw),displayMs=performance.now()-displayStart;
  return {regions,width:image.width,height:image.height,tiles:tiles.length,detector:{version:state.config.version+(state.backend==='webgpu'?':fp32':''),sha256:state.variant.sha256,
   upstreamRevision:state.config.upstreamRevision,refinement:REFINEMENT_VERSION,backend:state.backend,threads:state.threads,adapter:state.adapter,fallbackReason},
   timings:{modelMs,inferenceMs,preprocessMs,refineMs,displayMs,totalMs:performance.now()-start}};
 }finally{image?.close();}
}
self.onmessage=async({data})=>{
 const {id,blob}=data,options={backend:data.backend||'auto',threads:data.threads};
 try{
  self.postMessage({id,type:'progress',message:'Yerel balon algılama modeli hazırlanıyor…'});
  if(data.type==='prepare'){const t=performance.now(),state=await session(options);self.postMessage({id,type:'result',ready:true,forceCpu,backend:state.backend,threads:state.threads,adapter:state.adapter,fallbackReason,modelMs:performance.now()-t});return;}
  let result;
  try{result=await scan(blob,options,id);}
  catch(error){
   if(active?.backend!=='webgpu'||!error.gpuExecution&&!deviceLost)throw error;
   fallbackReason=error.message??String(error);await active.engine.release().catch(()=>{});forceCpu=true;deviceLost=false;active=undefined;sessionPromise=undefined;
   self.postMessage({id,type:'progress',message:'Tarama işlemciyle sürüyor.'});result=await scan(blob,options,id);
  }
  self.postMessage({id,type:'result',forceCpu,...result});
 }catch(error){self.postMessage({id,type:'error',message:error.message??String(error),forceCpu,retrySingleThread:Boolean(error.retrySingleThread)});}
};
