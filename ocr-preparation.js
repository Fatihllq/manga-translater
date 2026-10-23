import {WorkerPool} from './worker-pool.js';
import {checkSignal} from './runtime-policy.js';
import {OCR_PREPROCESS_POLICY} from './ocr-preprocess-policy.js';
import {analyzePreparationPixels,recipeById,BASE_RECIPE,eligibleRecipe} from './ocr-preprocess.js';
let service;
const blobUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
function createPreparationWorker(){const worker=new Worker(new URL('./ocr-preprocess-worker.js',import.meta.url),{type:'module'});let sequence=0;
 return {run:job=>new Promise((resolve,reject)=>{const id=++sequence;worker.onmessage=({data})=>{if(data.id!==id)return;worker.onmessage=worker.onerror=null;data.error?reject(Error(data.error)):resolve(data);};worker.onerror=event=>{worker.onmessage=worker.onerror=null;reject(Error(event.message||'Preparation worker failed'));};worker.postMessage({...job,id},[job.buffer]);}),terminate:()=>worker.terminate()};}
export function createPreparationService({create=createPreparationWorker}={}){
 const pool=new WorkerPool({size:1,create,execute:(worker,job)=>worker.run(job)});
 return {async run(job,options){checkSignal(options?.signal);if(pool.queue.length>=2)return {busy:true};return pool.run({...job,key:'preparation-v2'},options);},dispose:()=>pool.dispose()};
}
export async function disposePreparation(){const prior=service;service=undefined;await prior?.dispose();}
export async function prepareOcrCanvas(canvas,originalDataUrl,options={}){
 const policy=options.preprocessingPolicy??OCR_PREPROCESS_POLICY;
 if(!policy.enabled&&!options.preprocessRecipe&&!options.analyzePreprocess)return undefined;
 const started=performance.now();checkSignal(options.signal);
 const base={policyVersion:policy.version,modelVersion:policy.modelVersion,originalWidth:canvas.width,originalHeight:canvas.height,width:canvas.width,height:canvas.height,padding:0,profile:BASE_RECIPE,kind:'original',imageDataUrl:originalDataUrl,thresholdingMethod:'0'};
 if(canvas.width*canvas.height>4194304)return {...base,fallbackReason:'preparation-pixel-budget',preparationMs:performance.now()-started};
 let copy;
 try{
  const t=performance.now(),s=Math.min(1,256/Math.max(canvas.width,canvas.height));copy=document.createElement('canvas');copy.width=Math.max(1,Math.round(canvas.width*s));copy.height=Math.max(1,Math.round(canvas.height*s));
  const ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,copy.width,copy.height);const analysis=analyzePreparationPixels(ctx.getImageData(0,0,copy.width,copy.height),policy.polarityProfile);
  const analysisMs=performance.now()-t,kind=analysis.kind,route=policy.routes?.[kind];
  const recipe=recipeById(options.preprocessRecipe??route?.recipe??BASE_RECIPE);
  if(!recipe||!analysis.features||(!options.preprocessRecipe&&!eligibleRecipe(recipe,kind)))return {...base,kind,analysis,analysisMs,fallbackReason:'uncertain-or-unsupported',preparationMs:performance.now()-started};
  const input={...base,kind,analysis,analysisMs,polarity:analysis.decision?.polarity,selectedChannel:recipe.tone==='channel'?analysis.features.channel:null,preparationReason:analysis.decision?.reason,profile:recipe.id,padding:recipe.padding,width:canvas.width+2*recipe.padding,height:canvas.height+2*recipe.padding,thresholdingMethod:recipe.thresholdingMethod};
  if(recipe.tone!=='original'||recipe.padding){
   checkSignal(options.signal);const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
   service??=createPreparationService();const result=await service.run({buffer:pixels.data.buffer,width:canvas.width,height:canvas.height,recipe,features:analysis.features},{signal:options.signal,priority:options.priority??0,sessionId:options.sessionId});
   checkSignal(options.signal);if(result.busy)return {...base,kind,analysis,analysisMs,fallbackReason:'preparation-queue-full',preparationMs:performance.now()-started};input.imageDataUrl=await blobUrl(result.blob);checkSignal(options.signal);
  }
  return {...input,preparationMs:performance.now()-started};
 }catch(error){if(error.name==='AbortError')throw error;return {...base,fallbackReason:String(error.message??error),preparationMs:performance.now()-started};}
 finally{if(copy)copy.width=copy.height=1;}
}
