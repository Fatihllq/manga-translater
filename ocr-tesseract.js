import {OCR_PREPROCESS_POLICY} from './ocr-preprocess-policy.js';
import {validatedOcrInput,restorePreparationBoxes,BASE_RECIPE} from './ocr-preprocess.js';
import {WorkerPool} from './worker-pool.js';
import {checkSignal} from './runtime-policy.js';
import {classifyLayout} from './ocr-layout.js';
import {OCR_ROUTING_POLICY} from './ocr-routing-policy.js';
function collectLines(blocks){
 const lines=[];for(const block of blocks??[])for(const paragraph of block.paragraphs??[])for(const line of paragraph.lines??[]){
  lines.push({text:line.text?.trim()??'',confidence:Number(line.confidence??0),bbox:line.bbox,
   words:(line.words??[]).map(word=>({text:word.text?.trim()??'',confidence:Number(word.confidence??0),bbox:word.bbox}))});
 }return lines;
}
export function ocrPlan(layout,version,policy=OCR_ROUTING_POLICY){
 if(!policy.enabled||version!==policy.modelVersion)return {kind:'block',primary:'6',retry:null};
 const kind=typeof layout==='string'?layout:classifyLayout(layout,policy.profile);
 const route=policy.routes?.[kind];
 if(!route||route.enabled===false||(kind==='word'?route.primary!=='8':kind==='line'?route.primary!=='7':true))return {kind:'block',primary:'6',retry:null};
 const retry=kind==='word'&&route.retry==='6'?'6':kind==='line'&&route.retry==='13'?'13':null;
 return {kind,primary:String(route.primary),retry};
}
// Factory permits real queue tests without altering production globals or model files.
export function createOcrService({size,create,config,policy=OCR_ROUTING_POLICY,preprocessPolicy=OCR_PREPROCESS_POLICY}){
 const pool=new WorkerPool({size,create,execute:async(worker,job)=>{
  if(job.prepare)return;
  const started=performance.now();
  // An explicit per-job setting avoids the native Save/RestoreParameters copy.
  await worker.setParameters({tessedit_pageseg_mode:String(job.mode),thresholding_method:String(job.thresholdingMethod??'0')});
  const result=await worker.recognize(job.imageDataUrl,{}, {text:true,blocks:true});
  const lines=collectLines(result.data.blocks);
  return {text:result.data.text?.trim()??'',confidence:Number(result.data.confidence??0),lines,
   lowConfidenceWords:lines.flatMap(l=>l.words).filter(w=>w.text&&w.confidence<75),
   sourceLanguage:job.sourceLanguage,modelVersion:job.version,workerMs:performance.now()-started};
 }});
 return {
  async recognize(imageDataUrl,sourceLanguage,options={}){
   const started=performance.now();checkSignal(options.signal);
   const payload=await config(sourceLanguage);checkSignal(options.signal);
   const input=validatedOcrInput(options.ocrInput,payload.version,preprocessPolicy);
   const analysisInput=options.ocrInput?.policyVersion===preprocessPolicy.version&&options.ocrInput?.modelVersion===payload.version?options.ocrInput:null;
   const plan=input?{kind:'block',primary:'6',retry:null}:ocrPlan(options.layout,payload.version,policy),queueOptions={...options,priority:options.priority??0};
   const attempts=[];
   const run=async(mode,prepared=input)=>{checkSignal(options.signal);const begin=performance.now();
    const result=await pool.run({...payload,imageDataUrl:prepared?.imageDataUrl??imageDataUrl,mode,thresholdingMethod:prepared?.thresholdingMethod??'0'},queueOptions);checkSignal(options.signal);
    attempts.push({mode,profile:prepared?.profile??BASE_RECIPE,thresholdingMethod:prepared?.thresholdingMethod??'0',text:result.text,confidence:result.confidence,workerMs:result.workerMs,elapsedMs:performance.now()-begin});return result;};
   const initial=await run(plan.primary);let selected=initial,retryError;
   const retryMode=input?.retryOriginal&&input.profile!==BASE_RECIPE?'6':plan.retry;
   if(!initial.text&&retryMode){
    // Leave the slot before retrying so waiting manual work can run first.
    await Promise.resolve();checkSignal(options.signal);
    try{const retry=await run(retryMode,null);if(retry.text)selected=retry;}
    catch(error){if(error.name==='AbortError')throw error;retryError=String(error.message??error);}
   }
   checkSignal(options.signal);
   const restored=restorePreparationBoxes(selected,selected===initial?input:null);
   const preprocessing={policyVersion:preprocessPolicy.version,profile:input?.profile??BASE_RECIPE,selectedProfile:selected===initial?(input?.profile??BASE_RECIPE):BASE_RECIPE,kind:input?.kind??'original',polarity:analysisInput?.polarity??analysisInput?.analysis?.decision?.polarity,selectedChannel:input?.selectedChannel??null,reason:analysisInput?.preparationReason??analysisInput?.analysis?.decision?.reason,attemptCount:attempts.length+(retryError?1:0),analysisMs:input?.analysisMs??0,preparationMs:input?.preparationMs??0,fallbackReason:options.ocrInput?.fallbackReason??(!input&&options.ocrInput&&!(analysisInput?.profile===BASE_RECIPE)?'policy-or-input-mismatch':undefined)};
   return {...restored,preprocessing,method:{policyVersion:policy.version,kind:plan.kind,primaryMode:plan.primary,
    selectedMode:selected===initial?plan.primary:retryMode,attemptCount:attempts.length+(retryError?1:0),
    initialText:initial.text,attempts,retryError,durationMs:performance.now()-started,analysisMs:options.layout?.analysisMs??0}};
  },
  async prepare(sourceLanguage,options={}){
   const payload=await config(sourceLanguage);checkSignal(options.signal);
   return Promise.all(Array.from({length:size},()=>pool.run({...payload,prepare:true},{...options,priority:options.priority??1})));
  },
  dispose:()=>pool.dispose(),
 };
}
