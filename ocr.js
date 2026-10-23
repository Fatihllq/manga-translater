import './features.js';
import {getSourceLanguage} from './languages.js';
import {WorkerPool} from './worker-pool.js';
import {resourcePolicy,checkSignal} from './runtime-policy.js';
import {classifyLayout,LAYOUT_PROFILES} from './ocr-layout.js';
import {createPaddleWorker} from './paddle-client.js';
let modelVersionsPromise,service;
const modelVersions=()=>modelVersionsPromise??=fetch(chrome.runtime.getURL('model-version.json')).then(r=>r.json());
export const PADDLE_MODEL_VERSION='ppocr-v5-mobile-en-rapidocr-3.10.0';
export function getOcrModelVersion(sourceLanguage){return getSourceLanguage(sourceLanguage).paddleVersion;}
export function selectOcrRoute(layout,policy={...globalThis.__mangaFeatures,profile:'strict'}){
 if(policy.paddleOnly)return {engine:'paddle',path:'fast-block',kind:'block'};
 const fRows=layout?.features,boxes=layout?.rowBoxes;
 if(policy.paddleFastBlock&&fRows&&fRows.flat<.82&&fRows.chromaticFraction<=.015&&layout.width/layout.height<=1.6&&layout.height>=80)
  return {engine:'paddle',path:'fast-block',kind:'block'};
 // Bounded equal-width batches avoid DB detection and preserve every assigned row.
 if(policy.paddleRows&&fRows&&!fRows.invalid&&fRows.flat>=.66&&fRows.charHeight>=6&&Array.isArray(boxes)&&boxes.length>=2&&boxes.length<=8&&boxes.length===fRows.rows&&
    boxes.every((b,i)=>(!i||b.y0>=boxes[i-1].y1)&&[b.x0,b.y0,b.x1,b.y1,b.slope].every(Number.isFinite)&&b.x1>b.x0&&b.y1>b.y0&&Math.abs(b.slope)<=.15&&(b.x1-b.x0)/(b.y1-b.y0)<=6.4))
  return {engine:'paddle',path:'rows',kind:'block',rowBoxes:boxes};
 const kind=classifyLayout(layout,policy.profile??'strict');
 if(policy.paddleLine&&(kind==='word'||kind==='line'))return {engine:'paddle',path:'line',kind};
 const f=layout?.features,p=LAYOUT_PROFILES[policy.profile??'strict'];
 if(policy.paddleBlock&&p&&f&&!f.invalid&&f.rows>=2&&f.components>=4&&f.flat>=p.flat&&f.charHeight>=6&&Math.abs(f.slope)<=p.slope)
  return {engine:'paddle',path:'block',kind:'block'};
 return {engine:'tesseract',path:'block',kind:'block'};
}
function collectLines(blocks){
 const lines=[];for(const block of blocks??[])for(const paragraph of block.paragraphs??[])for(const line of paragraph.lines??[])
  lines.push({text:line.text?.trim()??'',confidence:Number(line.confidence??0),bbox:line.bbox,
   words:(line.words??[]).map(word=>({text:word.text?.trim()??'',confidence:Number(word.confidence??0),bbox:word.bbox}))});
 return lines;
}
// A slot owns both lazy engines. Routing does not change its key or evict a healthy engine.
export function createHybridOcrService({size,create,config,policy={...globalThis.__mangaFeatures,profile:'strict'}}){
 const pool=new WorkerPool({size,create,execute:async(adapter,job)=>{
  if(job.prepare){await adapter.prepare(job);return;}
  const started=performance.now();
  try{return {...await adapter.recognize(job),workerMs:performance.now()-started};}
  catch(error){if(error.name==='AbortError')throw error;await adapter.reset(job.engine);return {engineError:String(error.message??error),workerMs:performance.now()-started};}
 }});
 return {
  async recognize(imageDataUrl,sourceLanguage,options={}){
   const started=performance.now();checkSignal(options.signal);const payload=await config(sourceLanguage);checkSignal(options.signal);
   const route=sourceLanguage==='en'?selectOcrRoute(options.layout,policy):{engine:'paddle',path:'fast-block',kind:'block'},attempts=[];
   const run=async(engine,path)=>{checkSignal(options.signal);const begin=performance.now(),result=await pool.run({...payload,imageDataUrl,engine,path,rowBoxes:path==='rows'?route.rowBoxes:undefined},{...options,priority:options.priority??0});checkSignal(options.signal);
    attempts.push({engine,path,workerMs:result.workerMs,elapsedMs:performance.now()-begin,empty:!result.text?.trim(),error:result.engineError});return result;};
   let result=await run(route.engine,route.path),selectedEngine=route.engine,selectedPath=route.path,fallbackReason;
   if(route.engine==='paddle'&&(result.engineError||!result.text?.trim())){
    fallbackReason=result.engineError?'paddle-error':'paddle-empty';
    await Promise.resolve();checkSignal(options.signal);
    const paddleOnly=policy.paddleOnly||sourceLanguage!=='en';
    selectedEngine=paddleOnly?'paddle':'tesseract';selectedPath=paddleOnly?'line':'block';result=await run(selectedEngine,selectedPath);
   }
   if(result.engineError)throw Error(result.engineError);checkSignal(options.signal);
   const lines=result.lines??[];
   return {...result,text:result.text?.trim()??'',lines,lowConfidenceWords:lines.flatMap(l=>l.words??[]).filter(w=>w.text&&w.confidence<75),
    sourceLanguage,engine:selectedEngine,modelVersion:selectedEngine==='paddle'?getSourceLanguage(sourceLanguage).paddleVersion:payload.version,
    method:{policyVersion:policy.paddleOnly?'paddle-native-v1-045':'hybrid-ocr-v2-044',kind:route.kind,primaryEngine:route.engine,primaryPath:route.path,selectedEngine,
     selectedMode:selectedEngine==='tesseract'?'6':selectedPath,attemptCount:attempts.length,attempts,fallbackReason,
     durationMs:performance.now()-started,analysisMs:options.layout?.analysisMs??0}};
  },
  async prepare(sourceLanguage,options={}){const payload=await config(sourceLanguage);checkSignal(options.signal);
   const engine=sourceLanguage==='en'?selectOcrRoute(undefined,policy).engine:'paddle';
   return Promise.all(Array.from({length:size},()=>pool.run({...payload,prepare:true,engine},{...options,priority:options.priority??1})));},
  dispose:()=>pool.dispose(),
 };
}
async function payload(sourceLanguage){
 const language=getSourceLanguage(sourceLanguage);
 const version=sourceLanguage==='en'?((await modelVersions())[sourceLanguage]??language.modelVersion):language.modelVersion;
 return {language,version,sourceLanguage,key:sourceLanguage+':'+version+':hybrid-043'};
}
function createAdapter(job){
 let tesseract,paddle,closed=false;
 const getTesseract=async()=>{
  if(closed)throw new DOMException('Durduruldu.','AbortError');
  return tesseract??=globalThis.Tesseract.createWorker(job.language.ocrCode,1,{
   workerPath:chrome.runtime.getURL('vendor/worker.min.js'),corePath:chrome.runtime.getURL('vendor/core'),
   langPath:chrome.runtime.getURL('vendor/lang'),workerBlobURL:false,cachePath:'manga-ocr-'+job.version,
  });
 };
 const getPaddle=()=>{if(closed)throw new DOMException('Durduruldu.','AbortError');return paddle??=createPaddleWorker(job.sourceLanguage);};
 return {
  prepare:task=>task.engine==='paddle'?getPaddle().prepare():getTesseract(),
  async recognize(task){
   if(closed)throw new DOMException('Durduruldu.','AbortError');
   if(task.engine==='paddle')return getPaddle().recognize(task.imageDataUrl,task.path,task.rowBoxes);
   const worker=await getTesseract();
   await worker.setParameters({tessedit_pageseg_mode:'6',thresholding_method:'0'});
   const result=await worker.recognize(task.imageDataUrl,{}, {text:true,blocks:true});
   return {text:result.data.text?.trim()??'',confidence:Number(result.data.confidence??0),lines:collectLines(result.data.blocks)};
  },
  async reset(engine){if(engine==='paddle'){const prior=paddle;paddle=undefined;await prior?.terminate();}
   else{const prior=tesseract;tesseract=undefined;if(prior)await (await prior).terminate();}},
  async terminate(){closed=true;const prior=tesseract;tesseract=undefined;const p=paddle;paddle=undefined;
   await Promise.allSettled([prior?Promise.resolve(prior).then(w=>w.terminate()):undefined,p?.terminate()]);},
 };
}
function getService(){return service??=createHybridOcrService({size:resourcePolicy().ocrWorkers,config:payload,create:createAdapter});}
export function recognize(imageDataUrl,sourceLanguage,options={}){return getService().recognize(imageDataUrl,sourceLanguage,options);}
export function prepareOcr(sourceLanguage,options={}){return getService().prepare(sourceLanguage,options);}
export async function disposeOcr(){const prior=service;service=undefined;await prior?.dispose();}

// Existing development tools keep their explicit Tesseract-only factory contract.
export {createOcrService,ocrPlan} from './ocr-tesseract.js';
